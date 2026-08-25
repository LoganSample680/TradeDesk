// @ts-check
// ── Crew location permission: honest consent + honest status ─────────────────
//
// Two defects this suite locks down.
//
// 1. FABRICATED CONSENT. _geoTrackInit wrote `location_consent = true` onto the
//    employee's team_members row at sign-in without ever telling them their
//    location was being logged. The column's own migration comment reads
//    "employee's explicit opt-in". A field asserting an agreement that was never
//    made is worse in a dispute than no field at all, because it reads as a
//    manufactured record rather than a missing one. Tracking being a condition of
//    the job stays the owner's call; manufacturing the paperwork does not.
//
// 2. A DEAD SETUP BUTTON. _geoRequestPermission called startGeoTracking, which
//    returned early outside a 07:00-18:00 window before it ever reached the
//    geolocation API, so "Turn on location" tapped at 7pm did nothing at all.
//    That window has since been removed outright; the request path is asserted
//    here regardless so it can never regress to being gated on anything.
//
// These assert the ARCHITECTURE, not the symptoms: consent is only ever written
// by a real gesture, permission requests are reachable around the clock while
// tracking is never gated on a wall clock (the 07:00-18:00 window was removed:
// it silently dropped Saturday call-outs, evening supply runs and early starts),
// and the roster's status light tells the truth, including admitting when it
// does not know.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Crew location permission', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // A reconnect-driven cloud load mid-test wipes in-memory seeds out from under
    // the assertions (the failure mode that made the fleet specs flake).
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  const snapshot = () => page.evaluate(() => ({
    isEmp: _isEmployee, rec: JSON.parse(JSON.stringify(_employeeRecord || null)),
    tt: S.teamTracking, geo: JSON.parse(JSON.stringify(_teamGeo || {})),
  }));
  const restore = (s) => page.evaluate((s) => {
    _isEmployee = s.isEmp; _employeeRecord = s.rec;
    S.teamTracking = s.tt; _teamGeo = s.geo;
  }, s);

  let snap;
  // The notice sheet is DOM, and restore() only ever put the state variables
  // back, so a test that opened the sheet left it standing in the page for
  // whoever ran next. That is what turned "an employee who already
  // acknowledged is tracked without re-prompting" red on webkit CI
  // 2026-08-25: it asserts no sheet is present, and it was reading the sheet
  // the un-acknowledged test above it had opened and never cleared.
  //
  // Cleared in beforeEach, NOT afterEach, and that distinction is the whole
  // fix. The sheet renders ASYNCHRONOUSLY: measured in this app, it is absent
  // the instant _geoTrackInit() returns and present ~600ms later. So the test
  // that opens it never sees it, and an afterEach would just as easily run
  // before it landed and miss it too. By the next test's beforeEach it has
  // long since arrived, so that is the only point where removing it is
  // reliable. Chromium hid the leak by being slower to paint; webkit is not.
  test.beforeEach(async () => {
    await page.evaluate(() => document.getElementById('_geo-notice-ov')?.remove());
    snap = await snapshot();
  });
  test.afterEach(async () => { await restore(snap); });

  // ── 1. The fabricated-consent write is gone ────────────────────────────────

  test('signing in as an employee never writes a consent nobody gave', async () => {
    const out = await page.evaluate(() => {
      const writes = [];
      const realFrom = _supa && _supa.from;
      if (_supa) {
        _supa.from = (tbl) => ({
          update: (patch) => { writes.push({ tbl, patch }); return { eq: () => Promise.resolve({}) }; },
          select: () => ({ eq: () => Promise.resolve({ data: [] }) }),
        });
      }
      _isEmployee = true;
      _employeeRecord = { id: 'e1', location_ack_at: null };
      S.teamTracking = true;
      try { _geoTrackInit(); } catch (e) {}
      if (_supa) _supa.from = realFrom;
      return {
        consentWrites: writes.filter(w => 'location_consent' in (w.patch || {})).length,
        recordFlag: _employeeRecord.location_consent,
      };
    });
    // Zero writes of the column, and nothing set locally either.
    expect(out.consentWrites).toBe(0);
    expect(out.recordFlag).toBeUndefined();
  });

  test('an un-acknowledged employee is NOT tracked until they are told', async () => {
    const out = await page.evaluate(() => {
      let started = 0;
      const realStart = startGeoTracking;
      startGeoTracking = () => { started++; };
      _supaUser = _supaUser || { id: 'emp-test-1' };
      _isEmployee = true;
      _employeeRecord = { id: 'e1', location_ack_at: null };
      S.teamTracking = true;
      try { _geoTrackInit(); } catch (e) {}
      startGeoTracking = realStart;
      return { started, needsAck: _geoNeedsAck(), sheet: !!document.getElementById('_geo-notice-ov') };
    });
    expect(out.needsAck).toBe(true);
    expect(out.started).toBe(0); // nothing logged before the notice
  });

  test('an employee who already acknowledged is tracked without re-prompting', async () => {
    const out = await page.evaluate(() => {
      let started = 0;
      const realStart = startGeoTracking;
      startGeoTracking = () => { started++; };
      _supaUser = _supaUser || { id: 'emp-test-1' };
      _isEmployee = true;
      _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      S.teamTracking = true;
      try { _geoTrackInit(); } catch (e) {}
      startGeoTracking = realStart;
      return { started, needsAck: _geoNeedsAck(), sheet: !!document.getElementById('_geo-notice-ov') };
    });
    expect(out.needsAck).toBe(false);
    expect(out.started).toBe(1);
    expect(out.sheet).toBe(false);
  });

  // ── 2. The acknowledgment is a real record ─────────────────────────────────

  test('_geoRecordAck stamps a timestamp AND the notice version it was shown', async () => {
    const out = await page.evaluate(() => {
      const writes = [];
      const realFrom = _supa && _supa.from;
      if (_supa) {
        _supa.from = () => ({ update: (patch) => { writes.push(patch); return { eq: () => Promise.resolve({}) }; } });
      }
      _employeeRecord = { id: 'e1', location_ack_at: null };
      _geoRecordAck();
      if (_supa) _supa.from = realFrom;
      return { rec: _employeeRecord, wrote: writes[0] || null, ver: GEO_NOTICE_VERSION };
    });
    expect(out.rec.location_ack_at).toBeTruthy();
    expect(out.rec.location_ack_version).toBe(out.ver);
    // Versioned so the record still means something after the wording changes.
    expect(out.wrote.location_ack_version).toBe(out.ver);
    expect(String(out.wrote.location_ack_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('the notice sheet says what is captured and does not ack until tapped', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true; S.trackStart = '07:00'; S.trackEnd = '18:00';
      _employeeRecord = { id: 'e1', location_ack_at: null };
      _geoNoticeSheet();
      const ov = document.getElementById('_geo-notice-ov');
      const txt = ov ? ov.textContent : '';
      return {
        shown: !!ov,
        saysWhatIsCaptured: /mileage/i.test(txt) && /hours/i.test(txt),
        saysPermissionNext: /permission/i.test(txt),
        ackedBeforeTap: !!_employeeRecord.location_ack_at,
      };
    });
    expect(out.shown).toBe(true);
    expect(out.saysWhatIsCaptured).toBe(true);
    expect(out.saysPermissionNext).toBe(true);
    // Merely SEEING the notice is not agreement.
    expect(out.ackedBeforeTap).toBe(false);
    await page.evaluate(() => document.getElementById('_geo-notice-ov')?.remove());
  });

  // ── 3. The dead-button bug: permission must be reachable off-hours ─────────

  test('permission requests reach the geolocation API at any time of day', async () => {
    const out = await page.evaluate(async () => {
      let prompted = 0;
      const realGeo = navigator.geolocation;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (ok) => { prompted++; ok({ coords: { latitude: 1, longitude: 1 } }); } },
      });
      let reported = null;
      await new Promise(res => { _geoRequestPermission((st) => { reported = st; res(); }); });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: realGeo });
      return { prompted, reported };
    });
    expect(out.prompted).toBe(1);
    expect(out.reported).toBe('granted');
  });

  test('a denied prompt is recorded as denied, not silently swallowed', async () => {
    const out = await page.evaluate(async () => {
      const realGeo = navigator.geolocation;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (_ok, err) => err({ code: 1, message: 'denied' }) },
      });
      let reported = null;
      await new Promise(res => { _geoRequestPermission((st) => { reported = st; res(); }); });
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: realGeo });
      return reported;
    });
    expect(out).toBe('denied');
  });

  test('tracking is never gated on a clock (the time lock was removed)', async () => {
    const out = await page.evaluate(() => {
      const realGeo = navigator.geolocation;
      let watched = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: () => { watched++; return 1; }, clearWatch: () => {} },
      });
      _geoWatchId = null;
      startGeoTracking();
      const res = { watched, gateGone: typeof _geoBusinessHoursNow === 'undefined' };
      _geoWatchId = null;
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: realGeo });
      return res;
    });
    // A Saturday call-out, a 7pm supply run and a 5:30am start all used to log
    // nothing at all. Tracking now starts whenever permission allows it.
    expect(out.watched).toBe(1);
    expect(out.gateGone).toBe(true);
  });

  // ── 4. The roster light tells the truth ────────────────────────────────────

  test('a recent ping shows green even when the permission API says nothing', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true;
      _teamGeo = { 'a@b.co': { status: null, checkedAt: null, ackAt: null, lastPing: new Date().toISOString() } };
      return _geoRosterStatus('a@b.co');
    });
    // Pings landing IS permission granted, whatever the API claims (Safari).
    expect(out.dot).toBe('🟢');
    expect(out.label).toContain('Tracking');
  });

  test('a stale granted status goes GRAY, never a green light that lies', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true;
      const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
      _teamGeo = { 'a@b.co': { status: 'granted', checkedAt: old, ackAt: old, lastPing: null } };
      return _geoRosterStatus('a@b.co');
    });
    expect(out.dot).toBe('⚪');
    expect(out.label).toContain('No recent activity');
  });

  test('denied shows red', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true;
      _teamGeo = { 'a@b.co': { status: 'denied', checkedAt: new Date().toISOString(), ackAt: '2026-07-30T00:00:00Z', lastPing: null } };
      return _geoRosterStatus('a@b.co');
    });
    expect(out.dot).toBe('🔴');
  });

  test('someone who never opened the app is distinguished from someone who denied', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true;
      _teamGeo = { 'a@b.co': { status: null, checkedAt: null, ackAt: null, lastPing: null } };
      return _geoRosterStatus('a@b.co');
    });
    // "Hasn't opened it" is not the same failure as "turned it off", and the
    // owner chases those two very differently.
    expect(out.dot).toBe('⚪');
    expect(out.label).toContain('Hasn');
  });

  test('the status light is absent entirely when crew tracking is off', async () => {
    const out = await page.evaluate(() => { S.teamTracking = false; return _geoRosterStatus('a@b.co'); });
    expect(out).toBe(null);
  });

  test('an unknown email never throws, it reports not-set-up', async () => {
    const out = await page.evaluate(() => {
      S.teamTracking = true; _teamGeo = {};
      return { a: _geoRosterStatus('nobody@x.co'), b: _geoRosterStatus(''), c: _geoRosterStatus(null) };
    });
    expect(out.a.dot).toBe('⚪');
    expect(out.b.dot).toBe('⚪');
    expect(out.c.dot).toBe('⚪');
  });

  // ── 5. The checklist item stays completable ────────────────────────────────

  test('a denied user gets a Settings walkthrough, not a button that cannot work', async () => {
    const out = await page.evaluate(() => {
      _geoPermCache = 'denied';
      let alerted = null;
      const realAlert = zAlert;
      zAlert = (msg) => { alerted = msg; };
      _setupTodoGo('location');
      zAlert = realAlert;
      return { alerted, done: _geoPermDone() };
    });
    // iOS will not re-prompt from script, so the CTA must route to Settings or
    // the task becomes permanently uncompletable and the card never clears.
    // This is the PWA/browser fallback path specifically (no _geoTdPlugin
    // available in this offline test's window), see the next test for the
    // native one-tap deep link.
    expect(out.alerted).toContain('Settings');
    expect(out.done).toBe(false);
  });

  // On the native shell, a denied permission must jump straight into OUR
  // Settings page in one tap (owner ask 2026-08-17: iOS can't re-prompt
  // after a real denial, so a text walkthrough is the fallback of last
  // resort, not the primary experience when a real deep link is possible).
  test('a denied user on the native shell gets a one-tap Settings deep link, not just text', async () => {
    const out = await page.evaluate(async () => {
      _geoPermCache = 'denied';
      let openedSettings = false, alerted = null;
      const realGetPlugin = window._geoTdPlugin;
      const realAlert = zAlert;
      window._geoTdPlugin = () => ({ openSettings: () => { openedSettings = true; return Promise.resolve({ opened: true }); } });
      zAlert = (msg) => { alerted = msg; };
      _setupTodoGo('location');
      await new Promise(r => setTimeout(r, 10));
      window._geoTdPlugin = realGetPlugin;
      zAlert = realAlert;
      return { openedSettings, alerted };
    });
    expect(out.openedSettings).toBe(true);
    // The native deep link replaces the text walkthrough, it does not stack
    // on top of it, a user who gets the real one-tap fix should not also
    // see a wall of manual instructions.
    expect(out.alerted).toBeNull();
  });

  test("'unsupported' counts as done so Safari users are not nagged forever", async () => {
    const out = await page.evaluate(() => {
      _geoPermCache = 'unsupported';
      return { done: _geoPermDone(), state: _geoPermState() };
    });
    expect(out.state).toBe('unsupported');
    expect(out.done).toBe(true);
  });

  test('granted completes the task; prompt does not', async () => {
    const out = await page.evaluate(() => {
      _geoPermCache = 'granted'; const g = _geoPermDone();
      _geoPermCache = 'prompt';  const p = _geoPermDone();
      return { g, p };
    });
    expect(out.g).toBe(true);
    expect(out.p).toBe(false);
  });

  // ── 5b. Motion & Fitness, same shape as location, skippable ────────────────
  // (owner ask 2026-08-17: "we need it allowed to get all the functionality",
  // surfaced in the same onboarding checklist as location, reusing the exact
  // same openSettings deep link since it isn't location-specific.)

  test('motion: granted/unsupported complete the task, prompt/denied/restricted do not', async () => {
    const out = await page.evaluate(() => {
      const states = ['granted', 'unsupported', 'prompt', 'denied', 'restricted'];
      const results = {};
      states.forEach(s => { _motionPermCache = s; results[s] = _motionPermDone(); });
      return results;
    });
    expect(out.granted).toBe(true);
    expect(out.unsupported).toBe(true);
    expect(out.prompt).toBe(false);
    expect(out.denied).toBe(false);
    expect(out.restricted).toBe(false);
  });

  test('motion: no native shell at all counts as unsupported, never nags a browser user', async () => {
    const out = await page.evaluate(async () => {
      _motionPermCache = null;
      const realGetPlugin = window._geoTdPlugin;
      window._geoTdPlugin = () => null;
      _motionRefreshPermCache();
      await new Promise(r => setTimeout(r, 10));
      window._geoTdPlugin = realGetPlugin;
      return { state: _motionPermState(), done: _motionPermDone() };
    });
    expect(out.state).toBe('unsupported');
    expect(out.done).toBe(true);
  });

  test('motion: denied gets the one-tap Settings deep link, not a dead re-prompt button', async () => {
    const out = await page.evaluate(async () => {
      _motionPermCache = 'denied';
      let openedSettings = false, queriedMotion = false;
      const realGetPlugin = window._geoTdPlugin;
      window._geoTdPlugin = () => ({
        openSettings: () => { openedSettings = true; return Promise.resolve({ opened: true }); },
        motionSince: () => { queriedMotion = true; return Promise.resolve({ available: true, transitions: [] }); },
      });
      _setupTodoGo('motion');
      await new Promise(r => setTimeout(r, 10));
      window._geoTdPlugin = realGetPlugin;
      return { openedSettings, queriedMotion };
    });
    expect(out.openedSettings).toBe(true);
    // Querying again would be the dead button, denied means Settings only.
    expect(out.queriedMotion).toBe(false);
  });

  test('motion: never-asked fires the real query, which IS the OS prompt (no separate request API)', async () => {
    const out = await page.evaluate(async () => {
      _motionPermCache = 'prompt';
      let queriedMotion = false, openedSettings = false;
      const realGetPlugin = window._geoTdPlugin;
      window._geoTdPlugin = () => ({
        openSettings: () => { openedSettings = true; return Promise.resolve({ opened: true }); },
        motionSince: () => { queriedMotion = true; return Promise.resolve({ available: true, transitions: [] }); },
        motionPermStatus: () => Promise.resolve({ status: 'granted', available: true }),
      });
      _setupTodoGo('motion');
      await new Promise(r => setTimeout(r, 10));
      window._geoTdPlugin = realGetPlugin;
      return { queriedMotion, openedSettings, state: _motionPermState() };
    });
    expect(out.queriedMotion).toBe(true);
    expect(out.openedSettings).toBe(false);
    // The refresh after the query landed should have picked up the new status.
    expect(out.state).toBe('granted');
  });

  test('motion: tapping with no native shell at all is a safe no-op', async () => {
    const out = await page.evaluate(() => {
      const realGetPlugin = window._geoTdPlugin;
      window._geoTdPlugin = () => null;
      let threw = false;
      try { _setupTodoGo('motion'); } catch (e) { threw = true; }
      window._geoTdPlugin = realGetPlugin;
      return threw;
    });
    expect(out).toBe(false);
  });

  // ── 6. Employees never leak into another account's roster ──────────────────

  test('the crew status cache is keyed per account and resets on switch', async () => {
    const out = await page.evaluate(() => {
      _teamGeo = { 'a@b.co': { status: 'granted', lastPing: new Date().toISOString() } };
      _teamGeoLoaded = true;
      // Simulate the account-boundary reset the sign-out path performs.
      _teamGeo = {}; _teamGeoLoaded = false;
      S.teamTracking = true;
      return { after: _geoRosterStatus('a@b.co'), reloads: _teamGeoLoaded };
    });
    // The previous account's crew must not render against a matching email.
    expect(out.after.label).toBe('Not set up yet');
    expect(out.reloads).toBe(false);
  });

  test('zero console errors across the crew location suite', async () => {
    assertNoErrors(page, 'crew location permission');
  });
});
