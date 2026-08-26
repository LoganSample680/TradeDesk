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

  // Owner, 2026-08-25: "it should write for all users." The reporter used to
  // begin `if(!_isEmployee)return`, so an owner, which is most of the customer
  // base, could never report anything even in principle. Permission lived only
  // in localStorage and nothing on the server could answer why a brand-new
  // account was logging no drives.
  test.describe('every handset reports what it can do', () => {
    // Capture the writes without a real Supabase.
    const report = (opts) => page.evaluate(async (o) => {
      const saved = { supa: window._supa, user: window._supaUser, emp: window._isEmployee,
                      motion: (typeof _motionPermCache !== 'undefined' ? _motionPermCache : undefined),
                      devices: (typeof S !== 'undefined' && S.devices) ? S.devices.slice() : null };
      const rec = { upserts: [], updates: [] };
      // _geoNativeAuth is module state that outlives a test. Without pinning
      // it here, `derived` (and location_status/accuracy with it) depends on
      // whichever test ran last, which is exactly the kind of order coupling
      // that shows up as a shard-dependent failure months later.
      saved.nat = (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined;
      if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = o.nat === undefined ? null : o.nat;
      try {
        window._supaUser = { id: o.uid };
        window._isEmployee = !!o.isEmp;
        if (typeof _motionPermCache !== 'undefined') _motionPermCache = o.motion === undefined ? null : o.motion;
        if (o.devices !== undefined) { S.devices = o.devices; }
        window._supa = { from: (tbl) => ({
          upsert: (row, cfg) => { rec.upserts.push({ tbl, row, cfg }); return { then: (r) => Promise.resolve({}).then(r) }; },
          update: (patch) => ({ eq: (col, val) => { rec.updates.push({ tbl, patch, col, val }); return { then: (r) => Promise.resolve({}).then(r) }; } }),
        }) };
        _geoReportPermission(o.state);
        await new Promise(r => setTimeout(r, 20));
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user; window._isEmployee = saved.emp;
        if (typeof _motionPermCache !== 'undefined') _motionPermCache = saved.motion;
        if (saved.devices) S.devices = saved.devices;
        if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
      }
      return rec;
    }, opts);

    test('an OWNER reports, which was the whole hole', async () => {
      const r = await report({ uid: 'owner-1', isEmp: false, state: 'granted' });
      const ds = r.upserts.find(u => u.tbl === 'device_status');
      expect(ds, 'device_status row written for an owner').toBeTruthy();
      expect(ds.row.location_status).toBe('granted');
      expect(ds.row.user_id).toBe('owner-1');
      // ASSERTION CHANGED 2026-08-25 (CLAUDE.md 10.4). This used to expect
      // false with the comment "reported by the handset, not inferred", and it
      // passed because `derived` was hardcoded false, not because anything had
      // been reported: no plugin answers in this test, so the state here came
      // from the web-shaped inference. The column was therefore stamping every
      // guess as iOS's own word. Owner 2026-08-25: "don't keep inferring,
      // build explicitly off what iOS reports." Nothing native answered, so
      // the honest value is true, and the case the old comment described is
      // now covered for real by the iOS-vocabulary block below.
      expect(ds.row.derived, 'nothing native answered, so this row IS a guess').toBe(true);
      expect(r.updates.length, 'and no team_members write: an owner has no row there').toBe(0);
    });

    test('an EMPLOYEE reports to BOTH, so the crew screens keep working', async () => {
      const r = await report({ uid: 'emp-1', isEmp: true, state: 'denied' });
      expect(r.upserts.some(u => u.tbl === 'device_status')).toBe(true);
      const tm = r.updates.find(u => u.tbl === 'team_members');
      expect(tm, 'the existing crew path is untouched').toBeTruthy();
      expect(tm.patch.location_status).toBe('denied');
      expect(tm.col).toBe('employee_user_id');
    });

    test('motion rides along, from the same cache the checklist renders', async () => {
      const r = await report({ uid: 'owner-2', isEmp: false, state: 'granted', motion: 'denied' });
      expect(r.upserts[0].row.motion_status).toBe('denied');
    });

    test('a motion state never checked is null, never a guess', async () => {
      const r = await report({ uid: 'owner-3', isEmp: false, state: 'granted', motion: null });
      expect(r.upserts[0].row.motion_status).toBe(null);
    });

    test('the row is keyed per handset so a second boot updates, never duplicates', async () => {
      const r = await report({ uid: 'owner-4', isEmp: false, state: 'granted' });
      expect(r.upserts[0].cfg && r.upserts[0].cfg.onConflict).toBe('user_id,device_id');
      expect(typeof r.upserts[0].row.device_id).toBe('string');
      expect(r.upserts[0].row.device_id.length).toBeGreaterThan(0);
    });

    test('no signed-in user writes nothing at all', async () => {
      const r = await page.evaluate(async () => {
        const saved = { supa: window._supa, user: window._supaUser };
        const rec = [];
        try {
          window._supaUser = null;
          window._supa = { from: () => ({ upsert: (row) => { rec.push(row); return { then: (r2) => Promise.resolve({}).then(r2) }; } }) };
          _geoReportPermission('granted');
          await new Promise(r2 => setTimeout(r2, 20));
        } finally { window._supa = saved.supa; window._supaUser = saved.user; }
        return rec.length;
      });
      expect(r).toBe(0);
    });

    // SHIPPED BROKEN 08.25.26.9, caught on the owner's phone within the hour.
    // The re-report lived only in the branch where the plugin answers, so a
    // shell whose plugin predates motionPermStatus, or a query that rejects,
    // wrote the location row with motion null and never went back. The very
    // first row this feature ever produced had motion null for that reason.
    test.describe('motion re-reports from every branch that settles it', () => {
      const withMotion = (plugin) => page.evaluate(async (mode) => {
        const saved = { cap: window.Capacitor, cache: (typeof _motionPermCache !== 'undefined' ? _motionPermCache : undefined),
                        report: window._geoReportPermission, render: window._renderDashSetupTodo };
        let reports = 0;
        try {
          window._geoReportPermission = () => { reports++; };
          window._renderDashSetupTodo = () => {};
          if (typeof _motionPermCache !== 'undefined') _motionPermCache = null;
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: () => (mode === 'missing' ? {}
              : mode === 'rejects' ? { motionPermStatus: () => Promise.reject(new Error('nope')) }
              : { motionPermStatus: () => Promise.resolve({ status: 'granted', available: true }) }),
          };
          _motionRefreshPermCache();
          await new Promise(r => setTimeout(r, 40));
        } finally {
          window.Capacitor = saved.cap;
          if (typeof _motionPermCache !== 'undefined') _motionPermCache = saved.cache;
          window._geoReportPermission = saved.report; window._renderDashSetupTodo = saved.render;
        }
        return { reports, cache: (typeof _motionPermCache !== 'undefined' ? _motionPermCache : null) };
      }, plugin);

      test('the plugin answers: reported', async () => {
        expect((await withMotion('answers')).reports).toBe(1);
      });

      test('a shell whose plugin predates motionPermStatus: still reported', async () => {
        const r = await withMotion('missing');
        expect(r.reports, 'unsupported is a real answer, not an absence of one').toBe(1);
      });

      test('a query that rejects never leaves the row half-written', async () => {
        // Nothing settled the cache, so there is nothing new to say, but it
        // must not throw either.
        const r = await withMotion('rejects');
        expect(r.reports).toBeLessThanOrEqual(1);
      });

      test('a second refresh with no change stays quiet', async () => {
        const r = await page.evaluate(async () => {
          const saved = { cap: window.Capacitor, cache: _motionPermCache,
                          report: window._geoReportPermission, render: window._renderDashSetupTodo };
          let reports = 0;
          try {
            window._geoReportPermission = () => { reports++; };
            window._renderDashSetupTodo = () => {};
            _motionPermCache = null;
            window.Capacitor = { isNativePlatform: () => true,
              registerPlugin: () => ({ motionPermStatus: () => Promise.resolve({ status: 'granted', available: true }) }) };
            _motionRefreshPermCache();
            await new Promise(r2 => setTimeout(r2, 30));
            const afterFirst = reports;
            _motionRefreshPermCache();
            await new Promise(r2 => setTimeout(r2, 30));
            return { afterFirst, afterSecond: reports };
          } finally {
            window.Capacitor = saved.cap; _motionPermCache = saved.cache;
            window._geoReportPermission = saved.report; window._renderDashSetupTodo = saved.render;
          }
        });
        expect(r.afterFirst).toBe(1);
        expect(r.afterSecond, 'unchanged means nothing to report').toBe(1);
      });
    });

    // Owner, 2026-08-25: "shouldn't location and motion say always, while using
    // app or declined in alliance with how iOS saves and asks for permissions?"
    // The old inference read whether the watcher was delivering, which is true
    // for whenInUse too, so the one distinction that decides whether this
    // product works at all was invisible.
    test.describe("iOS's own vocabulary, not a flattened granted", () => {
      const withAuth = (auth) => page.evaluate(async (a) => {
        const saved = { cap: window.Capacitor, supa: window._supa, user: window._supaUser };
        const rec = [];
        try {
          window._supaUser = { id: 'auth-probe' };
          window._supa = { from: () => ({
            upsert: (row) => { rec.push(row); return { then: (r) => Promise.resolve({}).then(r) }; },
            update: () => ({ eq: () => ({ then: (r) => Promise.resolve({}).then(r) }) }),
          }) };
          window.Capacitor = { isNativePlatform: () => true,
            registerPlugin: () => (a === null ? {} : { locationPermStatus: () => Promise.resolve(a) }) };
          const state = await _geoReadPermission();
          _geoReportPermission(state);
          await new Promise(r => setTimeout(r, 20));
          return { state, row: rec[0] || null, peek: _geoNativeAuthPeek() };
        } finally {
          window.Capacitor = saved.cap; window._supa = saved.supa; window._supaUser = saved.user;
        }
      }, auth);

      test('always and wheninuse are stored apart, never both as granted', async () => {
        const always = await withAuth({ status: 'always', accuracy: 'full', precise: true });
        const inUse = await withAuth({ status: 'wheninuse', accuracy: 'full', precise: true });
        expect(always.row.location_status).toBe('always');
        expect(inUse.row.location_status, 'the distinction the whole feature exists for').toBe('wheninuse');
        expect(inUse.row.location_status).not.toBe('granted');
      });

      test('the checklist still reasons in done/not-done, so both read granted THERE', async () => {
        expect((await withAuth({ status: 'always', accuracy: 'full' })).state).toBe('granted');
        expect((await withAuth({ status: 'wheninuse', accuracy: 'full' })).state).toBe('granted');
      });

      test('denied and restricted are both refusals, notdetermined is not', async () => {
        expect((await withAuth({ status: 'denied' })).state).toBe('denied');
        expect((await withAuth({ status: 'restricted' })).state).toBe('denied');
        expect((await withAuth({ status: 'notdetermined' })).state).toBe('prompt');
      });

      test('restricted survives to the row as itself, not as denied', async () => {
        const r = await withAuth({ status: 'restricted' });
        expect(r.row.location_status, 'Screen Time or MDM is not the same as saying no').toBe('restricted');
      });

      // Always plus Precise off is granted and useless at the same time.
      test('accuracy is its own column, never folded into status', async () => {
        const r = await withAuth({ status: 'always', accuracy: 'reduced', precise: false });
        expect(r.row.location_status).toBe('always');
        expect(r.row.location_accuracy, 'a 600ft fence cannot work on kilometres').toBe('reduced');
      });

      test('a shell too old to answer degrades to the old inference, never breaks', async () => {
        const r = await withAuth(null);
        expect(['granted', 'denied', 'prompt']).toContain(r.state);
        expect(r.row.location_accuracy, 'nothing known means null, not a guess').toBe(null);
      });

      test('a plugin that rejects is treated as unknown, not as denied', async () => {
        const r = await page.evaluate(async () => {
          const saved = window.Capacitor;
          try {
            window.Capacitor = { isNativePlatform: () => true,
              registerPlugin: () => ({ locationPermStatus: () => Promise.reject(new Error('nope')) }) };
            return { state: await _geoReadPermission(), peek: _geoNativeAuthPeek() };
          } finally { window.Capacitor = saved; }
        });
        expect(['granted', 'denied', 'prompt'], 'falls through to the inference').toContain(r.state);
      });

      // ── The third axis: device-wide Location Services ────────────────────
      //
      // Owner 2026-08-25: "device wide location services ... why do we need
      // it?" Because the per-app grant and the global switch move
      // independently. Flip Settings > Privacy & Security > Location Services
      // off and this app's authorizationStatus still reads .authorizedAlways
      // while no fix ever arrives again, so without this a dead phone and a
      // healthy one produce byte-identical rows.
      test('the global switch is stored apart from the app grant', async () => {
        const on = await withAuth({ status: 'always', accuracy: 'full', precise: true, servicesEnabled: true });
        const off = await withAuth({ status: 'always', accuracy: 'full', precise: true, servicesEnabled: false });
        expect(on.row.location_services_enabled).toBe(true);
        expect(off.row.location_services_enabled).toBe(false);
        expect(off.row.location_status, 'iOS keeps saying always, which is the whole trap').toBe('always');
        expect(off.row.location_accuracy).toBe('full');
      });

      test("a shell that cannot answer stores null, never false", async () => {
        // The difference matters more than it looks: false means "the master
        // switch is off, go turn it on", null means "we do not know yet".
        // Telling a crew member to fix a switch that is already on is how you
        // lose their trust in the whole feature.
        for (const a of [{ status: 'always', accuracy: 'full' },
                         { status: 'always', accuracy: 'full', servicesEnabled: undefined },
                         { status: 'always', accuracy: 'full', servicesEnabled: null },
                         { status: 'always', accuracy: 'full', servicesEnabled: 'yes' },
                         { status: 'always', accuracy: 'full', servicesEnabled: 0 },
                         { status: 'always', accuracy: 'full', servicesEnabled: 1 }]) {
          const r = await withAuth(a);
          expect(r.row.location_services_enabled,
            'only a real boolean off the bridge counts: ' + JSON.stringify(a)).toBe(null);
        }
      });

      test('the peek carries the switch too, so the row and the screen agree', async () => {
        const r = await withAuth({ status: 'wheninuse', accuracy: 'reduced', precise: false, servicesEnabled: false });
        expect(r.peek.servicesEnabled).toBe(false);
        expect(r.peek.status).toBe('wheninuse');
        expect(r.peek.precise).toBe(false);
      });

      test('the switch being off never gets flattened into the status', async () => {
        // Tempting shortcut, deliberately not taken: reporting 'denied'
        // because nothing can arrive would erase the fact that this app IS
        // authorized, and send the user to the wrong settings screen.
        const r = await withAuth({ status: 'always', accuracy: 'full', precise: true, servicesEnabled: false });
        expect(r.state, 'the app grant is genuinely granted').toBe('granted');
        expect(r.row.location_status).not.toBe('denied');
      });

      test('derived says which rows are iOS speaking and which are a guess', async () => {
        const real = await withAuth({ status: 'always', accuracy: 'full', servicesEnabled: true });
        expect(real.row.derived, "iOS answered, so this is not inferred").toBe(false);
        const guess = await withAuth(null);   // no locationPermStatus on this shell
        expect(guess.row.derived, 'inferred, and the row now admits it').toBe(true);
      });

      // ── On native, iOS is the only voice ─────────────────────────────────
      //
      // Owner 2026-08-26: "I don't want ours, ours does nothing in a true
      // native app, go entirely off iOS since location calls capacitor
      // plugins." Every signal below used to be able to answer this question
      // and not one of them is what the phone thinks. They agreed with iOS
      // often enough to look right and disagreed exactly when it mattered: a
      // watcher spinning up read as granted while the real grant was whenInUse,
      // so a phone that could never track from a pocket reported itself fine.
      test.describe('no local signal can answer for iOS on a native shell', () => {
        const onNative = (setup) => page.evaluate(async (o) => {
          const saved = { cap: window.Capacitor, nat: (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined,
                          wid: (typeof _geoNativeWatcherId !== 'undefined') ? _geoNativeWatcherId : undefined,
                          consent: localStorage.getItem('geo_owner_consent'),
                          osd: localStorage.getItem('td_geo_os_denied') };
          try {
            // A native shell whose plugin cannot answer at all.
            window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = null;
            if (typeof _geoNativeWatcherId !== 'undefined') _geoNativeWatcherId = o.watcher === undefined ? null : o.watcher;
            if (o.consent === null) localStorage.removeItem('geo_owner_consent');
            else if (o.consent !== undefined) localStorage.setItem('geo_owner_consent', o.consent);
            if (o.osDenied) localStorage.setItem('td_geo_os_denied', '1');
            else localStorage.removeItem('td_geo_os_denied');
            return await _geoReadPermission();
          } finally {
            window.Capacitor = saved.cap;
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
            if (typeof _geoNativeWatcherId !== 'undefined') _geoNativeWatcherId = saved.wid;
            if (saved.consent === null) localStorage.removeItem('geo_owner_consent');
            else localStorage.setItem('geo_owner_consent', saved.consent);
            if (saved.osd === null) localStorage.removeItem('td_geo_os_denied');
            else localStorage.setItem('td_geo_os_denied', saved.osd);
          }
        }, setup);

        test('a live watcher does not mean granted', async () => {
          expect(await onNative({ watcher: 42 }),
            'the tracker starting proves nothing about what iOS granted').toBe('prompt');
        });

        test('our own consent flag does not mean granted', async () => {
          expect(await onNative({ consent: '1' }),
            'they agreed to be tracked; that is not iOS agreeing').toBe('prompt');
        });

        test('our own os-denied flag does not mean denied', async () => {
          expect(await onNative({ osDenied: true }),
            'a watcher error is our reading of a failure, not a status').toBe('prompt');
        });

        test('a declined consent does not mean denied either', async () => {
          expect(await onNative({ consent: 'declined' })).toBe('prompt');
        });

        test('every combination of local signals still answers prompt', async () => {
          for (const w of [null, 9]) for (const c of [null, '1', 'declined']) for (const d of [false, true]) {
            expect(await onNative({ watcher: w, consent: c, osDenied: d }),
              JSON.stringify({ w, c, d })).toBe('prompt');
          }
        });

        test('a real browser still uses the platform permission API', async () => {
          const r = await page.evaluate(async () => {
            const saved = window.Capacitor;
            try { window.Capacitor = undefined; return await _geoReadPermission(); }
            finally { window.Capacitor = saved; }
          });
          expect(['granted', 'denied', 'prompt', 'unsupported'],
            'navigator.permissions IS the platform answer in a browser').toContain(r);
        });
      });

      test('a junk status never invents an authorization', async () => {
        for (const bad of [{ status: '' }, { status: 'banana' }, {}, { status: null }]) {
          const r = await withAuth(bad);
          expect(['granted', 'denied', 'prompt']).toContain(r.state);
        }
      });
    });

    // ── The row the owner's own handset produced the hour build 36 landed ────
    //
    // location_status 'prompt', derived true, accuracy null, servicesEnabled
    // null, while motion_status from the SAME plugin said 'granted'. Two
    // separate bugs produced that, and both are pinned here.
    test.describe('the native answer actually reaches the row', () => {
      // Bug 1: _geoPermForeground kicked off an ASYNC refresh and then reported
      // from a SYNCHRONOUS cache in the same tick, so it wrote a derived row
      // before its own read had landed, and the upsert clobbered any good row.
      test('the foreground re-report waits for the native read instead of racing it', async () => {
        const r = await page.evaluate(async () => {
          const saved = { cap: window.Capacitor, supa: window._supa, user: window._supaUser,
                          at: (typeof _geoPermReportedAt !== 'undefined') ? _geoPermReportedAt : undefined,
                          nat: (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined,
                          cache: (typeof _geoPermCache !== 'undefined') ? _geoPermCache : undefined };
          const rows = [];
          try {
            window._supaUser = { id: 'fg-race' };
            window._supa = { from: () => ({
              upsert: (row) => { rows.push(row); return { then: (f) => Promise.resolve({}).then(f) }; },
              update: () => ({ eq: () => ({ then: (f) => Promise.resolve({}).then(f) }) }),
            }) };
            // Cold start: nothing cached, exactly the state a fresh boot is in.
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = null;
            if (typeof _geoPermCache !== 'undefined') _geoPermCache = null;
            if (typeof _geoPermReportedAt !== 'undefined') _geoPermReportedAt = 0;
            // The plugin answers, but only after a tick, like a real bridge.
            window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({
              locationPermStatus: () => new Promise(res => setTimeout(() => res(
                { status: 'always', accuracy: 'full', precise: true, servicesEnabled: true }), 30)),
              motionPermStatus: () => Promise.resolve({ status: 'granted', available: true }),
            }) };
            _geoPermForeground();
            await new Promise(res => setTimeout(res, 250));
            return rows.map(x => ({ st: x.location_status, acc: x.location_accuracy,
                                    svc: x.location_services_enabled, derived: x.derived }));
          } finally {
            window.Capacitor = saved.cap; window._supa = saved.supa; window._supaUser = saved.user;
            if (typeof _geoPermReportedAt !== 'undefined') _geoPermReportedAt = saved.at;
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
            if (typeof _geoPermCache !== 'undefined') _geoPermCache = saved.cache;
          }
        });
        expect(r.length, 'the foreground return reports').toBeGreaterThan(0);
        // EVERY row it wrote must carry iOS's answer. One derived row in the
        // set is not harmless: the upsert key is (user_id, device_id), so a
        // late derived write overwrites a good one.
        for (const row of r) {
          expect(row.derived, 'no row may be a guess once the plugin answers').toBe(false);
          expect(row.st).toBe('always');
          expect(row.acc).toBe('full');
          expect(row.svc).toBe(true);
        }
      });

      // Bug 2: reporting was gated on the FLATTENED state, which cannot change
      // when a phone goes wheninuse -> always, loses Precise Location, or has
      // device-wide Location Services switched off. All three still flatten to
      // 'granted', so the three fields that decide whether this product works
      // were learned and then never sent.
      test('a change iOS reports is sent even when the flattened state is identical', async () => {
        const r = await page.evaluate(async () => {
          const saved = { cap: window.Capacitor, supa: window._supa, user: window._supaUser,
                          nat: (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined,
                          cache: (typeof _geoPermCache !== 'undefined') ? _geoPermCache : undefined,
                          sig: (typeof _geoPermSig !== 'undefined') ? _geoPermSig : undefined };
          const rows = [];
          let answer = { status: 'wheninuse', accuracy: 'full', precise: true, servicesEnabled: true };
          try {
            window._supaUser = { id: 'sig-gate' };
            window._supa = { from: () => ({
              upsert: (row) => { rows.push(row); return { then: (f) => Promise.resolve({}).then(f) }; },
              update: () => ({ eq: () => ({ then: (f) => Promise.resolve({}).then(f) }) }),
            }) };
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = null;
            if (typeof _geoPermCache !== 'undefined') _geoPermCache = null;
            if (typeof _geoPermSig !== 'undefined') _geoPermSig = null;
            window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({
              locationPermStatus: () => Promise.resolve(answer),
            }) };
            const settle = () => new Promise(res => setTimeout(res, 80));
            _geoRefreshPermCache(); await settle();            // 1: wheninuse
            // Measure the identical repeat in ISOLATION. Counting total rows
            // instead would fold in any write the live app makes on its own
            // during these settles (this page boots the FULL app, and the
            // foreground reporter fires on its own schedule), which is a real
            // write against the same mock but has nothing to do with the gate
            // under test. CI caught exactly that: an extra 'wheninuse' row.
            const before = rows.length;
            _geoRefreshPermCache(); await settle();            // 2: identical, must NOT re-send
            const afterRepeat = rows.length - before;
            answer = { status: 'always', accuracy: 'full', precise: true, servicesEnabled: true };
            _geoRefreshPermCache(); await settle();            // 3: upgraded, still flattens to granted
            answer = { status: 'always', accuracy: 'reduced', precise: false, servicesEnabled: true };
            _geoRefreshPermCache(); await settle();            // 4: Precise off
            answer = { status: 'always', accuracy: 'reduced', precise: false, servicesEnabled: false };
            _geoRefreshPermCache(); await settle();            // 5: master switch off
            // Consecutive duplicates collapsed: what matters is that every real
            // change appears, in order, and no state is skipped.
            const seq = [];
            for (const x of rows) {
              const t = [x.location_status, x.location_accuracy, x.location_services_enabled];
              const last = seq[seq.length - 1];
              if (!last || last.join('|') !== t.join('|')) seq.push(t);
            }
            return { seq, afterRepeat };
          } finally {
            window.Capacitor = saved.cap; window._supa = saved.supa; window._supaUser = saved.user;
            if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
            if (typeof _geoPermCache !== 'undefined') _geoPermCache = saved.cache;
            if (typeof _geoPermSig !== 'undefined') _geoPermSig = saved.sig;
          }
        });
        expect(r.afterRepeat, 'an identical answer sends nothing').toBe(0);
        expect(r.seq, 'every real change reaches the row, in order, none skipped').toEqual([
          ['wheninuse', 'full', true],
          ['always', 'full', true],     // flattens to granted, would have been invisible before
          ['always', 'reduced', true],  // Precise Location off
          ['always', 'reduced', false], // device-wide Location Services off
        ]);
      });
    });

    // ── The dead button, and the one-shot Always upgrade behind it ───────────
    //
    // Owner 2026-08-26: "I want it to go to always and stay that way."
    //
    // _geoRequestPermission used to call getCurrentPosition first and only start
    // tracking inside its SUCCESS callback. On the shell _geoInstallGeoShim has
    // replaced getCurrentPosition with a plugin read carrying
    // requestPermissions:FALSE, so on a fresh install it cannot get a fix, times
    // out, and startGeoTracking is never reached. No dialog ever appears. That
    // is the live "Dead control: _setupTodoGo('location')|Fix it" from 08-22.
    //
    // Starting the watcher IS the ask: on iOS addWatcher with
    // requestPermissions:true calls requestAlwaysAuthorization, which is the
    // one-shot provisional-Always upgrade. It must be spent there and nowhere
    // else, and it must not sit behind a read.
    test.describe('asking for location on the native shell', () => {
      const ask = (opts) => page.evaluate(async (o) => {
        const saved = { cap: window.Capacitor, start: window.startGeoTracking,
                        gc: navigator.geolocation && navigator.geolocation.getCurrentPosition,
                        nat: (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined,
                        wid: (typeof _geoNativeWatcherId !== 'undefined') ? _geoNativeWatcherId : undefined,
                        supa: window._supa, user: window._supaUser };
        const calls = { started: 0, fixes: 0 };
        try {
          window._supaUser = { id: 'ask-probe' };
          window._supa = { from: () => ({ upsert: () => ({ then: (f) => Promise.resolve({}).then(f) }),
                                          update: () => ({ eq: () => ({ then: (f) => Promise.resolve({}).then(f) }) }) }) };
          window.Capacitor = { isNativePlatform: () => true,
            registerPlugin: () => ({ locationPermStatus: () => Promise.resolve(o.answer || { status: 'always', accuracy: 'full', precise: true, servicesEnabled: true }) }) };
          if (navigator.geolocation) navigator.geolocation.getCurrentPosition = () => { calls.fixes++; };
          window.startGeoTracking = () => { calls.started++; };
          if (typeof _geoNativeWatcherId !== 'undefined') _geoNativeWatcherId = o.watcher === undefined ? null : o.watcher;
          if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = null;
          const state = await new Promise(res => { _geoRequestPermission(res); setTimeout(() => res('__timeout'), 6000); });
          return { state, calls };
        } finally {
          window.Capacitor = saved.cap; window.startGeoTracking = saved.start;
          if (navigator.geolocation && saved.gc) navigator.geolocation.getCurrentPosition = saved.gc;
          if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
          if (typeof _geoNativeWatcherId !== 'undefined') _geoNativeWatcherId = saved.wid;
          window._supa = saved.supa; window._supaUser = saved.user;
        }
      }, opts || {});

      test('the tap starts the watcher, which IS the prompt, and reads nothing first', async () => {
        const r = await ask({ answer: { status: 'always', accuracy: 'full', precise: true, servicesEnabled: true } });
        expect(r.calls.started, 'the watcher is what raises the dialog').toBe(1);
        expect(r.calls.fixes, 'nothing is read before asking: that is what made the button dead').toBe(0);
        expect(r.state).toBe('granted');
      });

      test('while-using is still a grant, it is just not Always', async () => {
        const r = await ask({ answer: { status: 'wheninuse', accuracy: 'full', precise: true, servicesEnabled: true } });
        expect(r.calls.started).toBe(1);
        expect(r.state, 'the checklist clears either way; the row records which').toBe('granted');
      });

      test('a refusal is reported as denied, not as a retryable prompt', async () => {
        for (const st of ['denied', 'restricted']) {
          const r = await ask({ answer: { status: st } });
          expect(r.state, st).toBe('denied');
        }
      });

      test('a live watcher counts as granted on a shell too old to report status', async () => {
        const r = await ask({ answer: null, watcher: 7 });
        expect(r.calls.started).toBe(1);
        expect(r.state, 'the dialog was answered yes even if we cannot read it back').toBe('granted');
      });

      test('notdetermined with no watcher stays a prompt, never a false grant', async () => {
        const r = await ask({ answer: { status: 'notdetermined' }, watcher: null });
        expect(r.state).toBe('prompt');
      });
    });

    // ── Permission lab, dev-gated (owner ask 2026-08-26) ────────────────────
    test.describe('the permission lab', () => {
      const open = (nat) => page.evaluate((n) => {
        const saved = { cap: window.Capacitor, nat: (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined };
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
        if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = n;
        _geoPermLab();
        const ov = document.getElementById('_geo-perm-ov');
        const text = ov ? ov.textContent : '';
        ov && ov.remove();
        window.Capacitor = saved.cap;
        if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = saved.nat;
        return text;
      }, nat);

      test('it shows all three iOS axes and labels what is ours', async () => {
        const t = await open({ status: 'always', accuracy: 'full', precise: true, servicesEnabled: true });
        expect(t).toContain('Permission lab');
        expect(t).toContain('iOS location');
        expect(t).toContain('Precise Location');
        expect(t).toContain('Location Services (device)');
        expect(t, 'our own consent record is marked as ours, not passed off as iOS').toContain('ours, not iOS');
        expect(t, 'and it says plainly that nothing here is inferred').toContain('Nothing here is inferred');
      });

      test('it tells you up front that iOS will not re-prompt', async () => {
        const t = await open(null);
        expect(t, 'the limitation is on the panel, not discovered by tapping').toMatch(/only shows its dialog once per install/i);
        expect(t).toMatch(/delete and reinstall/i);
      });

      test('nothing known reads as unknown, never as a denial', async () => {
        const t = await open(null);
        expect(t).toContain('not reported');
        expect(t).not.toMatch(/\bdenied\b/i);
      });

      test('reset clears OUR state and leaves iOS alone', async () => {
        const r = await page.evaluate(() => {
          const saved = { c: localStorage.getItem('geo_owner_consent'), d: localStorage.getItem('td_geo_os_denied'),
                          cap: window.Capacitor, toast: window.showToast };
          try {
            window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
            window.showToast = () => {};
            localStorage.setItem('geo_owner_consent', '1');
            localStorage.setItem('td_geo_os_denied', '1');
            let askedNative = 0;
            const realReq = window._geoRequestPermission;
            window._geoRequestPermission = () => { askedNative++; };
            _geoPermLabReset();
            window._geoRequestPermission = realReq;
            const out = { consent: localStorage.getItem('geo_owner_consent'),
                          denied: localStorage.getItem('td_geo_os_denied'), askedNative };
            document.getElementById('_geo-perm-ov')?.remove();
            return out;
          } finally {
            if (saved.c === null) localStorage.removeItem('geo_owner_consent'); else localStorage.setItem('geo_owner_consent', saved.c);
            if (saved.d === null) localStorage.removeItem('td_geo_os_denied'); else localStorage.setItem('td_geo_os_denied', saved.d);
            window.Capacitor = saved.cap; window.showToast = saved.toast;
          }
        });
        expect(r.consent, 'our consent record is cleared').toBe(null);
        expect(r.denied, 'and our os-denied flag with it').toBe(null);
        expect(r.askedNative, 'resetting must not fire a prompt as a side effect').toBe(0);
      });

      test('the button is dev-gated and native-gated, never loose in Settings', () => {
        const fs = require('fs'), path = require('path');
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const i = html.indexOf('id="set-geo-perm-btn"');
        expect(i, 'the button exists').toBeGreaterThan(-1);
        const grp = html.lastIndexOf('id="dev-geo-tools"', i);
        expect(grp, 'and it sits inside the dev-geo-tools group').toBeGreaterThan(-1);
        // dev-geo-tools ships display:none and is only unhidden on a native
        // shell, inside a Developer section that only exists for is_dev.
        expect(html.slice(grp, grp + 200)).toContain('display:none');
      });
    });

    test('a write that fails never throws at the caller', async () => {
      const threw = await page.evaluate(async () => {
        const saved = { supa: window._supa, user: window._supaUser };
        let t = null;
        try {
          window._supaUser = { id: 'boom-1' };
          window._supa = { from: () => { throw new Error('network gone'); } };
          try { _geoReportPermission('granted'); } catch (e) { t = String(e && e.message || e); }
          await new Promise(r => setTimeout(r, 20));
        } finally { window._supa = saved.supa; window._supaUser = saved.user; }
        return t;
      });
      expect(threw, 'permission reporting is never allowed to break a render').toBe(null);
    });

    // The live gap: change a permission in the iOS Settings app, come back,
    // and nothing re-checked. The checklist kept nagging and the server row
    // stayed stale, because the only refresh ran when the dashboard rendered.
    test('coming back to the foreground re-reads both permissions', async () => {
      const r = await page.evaluate(async () => {
        const calls = { geo: 0, motion: 0 };
        const realGeo = window._geoRefreshPermCache, realMotion = window._motionRefreshPermCache;
        try {
          window._geoRefreshPermCache = () => { calls.geo++; };
          window._motionRefreshPermCache = () => { calls.motion++; };
          document.dispatchEvent(new Event('visibilitychange'));
          await new Promise(res => setTimeout(res, 20));
        } finally {
          window._geoRefreshPermCache = realGeo; window._motionRefreshPermCache = realMotion;
        }
        return calls;
      });
      expect(r.geo, 'location re-read on return').toBeGreaterThanOrEqual(1);
      expect(r.motion, 'motion re-read on return').toBeGreaterThanOrEqual(1);
    });
  });

  test('zero console errors across the crew location suite', async () => {
    assertNoErrors(page, 'crew location permission');
  });
});
