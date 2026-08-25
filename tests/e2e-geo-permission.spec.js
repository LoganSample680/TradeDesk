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
      }
      return rec;
    }, opts);

    test('an OWNER reports, which was the whole hole', async () => {
      const r = await report({ uid: 'owner-1', isEmp: false, state: 'granted' });
      const ds = r.upserts.find(u => u.tbl === 'device_status');
      expect(ds, 'device_status row written for an owner').toBeTruthy();
      expect(ds.row.location_status).toBe('granted');
      expect(ds.row.user_id).toBe('owner-1');
      expect(ds.row.derived, 'reported by the handset, not inferred').toBe(false);
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
