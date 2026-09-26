// @ts-check
// ── Tracking starts once the account has arrived, not once the clock says so ──
//
// Jack, 2026-09-25: he opened the app at 9:19 and used it for three minutes,
// and tracking never started. The boot asked _geoTrackInit exactly once, 2.4s
// in. A crew phone boots from its cached identity, which says "employee"
// before the crew row is back from the server; _geoTrackInit met _isEmployee
// with no _employeeRecord, returned, and nothing ever asked again. With no
// watcher running, iOS slept the app the moment he left it, and every motion
// flip that morning waited for the backfill.
//
// _geoTrackInitSoon (js/geo-track.js) now owns the boot's question: ask now,
// again every few seconds while the answer is still on its way, and again on
// every return to the screen.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('tracking start waits for the crew row', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Every test starts from a phone whose boot has not asked yet, and whose
  // tracker start is counted rather than run.
  let snap;
  test.beforeEach(async () => {
    snap = await page.evaluate(() => {
      const s = { isEmp: _isEmployee, rec: _employeeRecord, tt: S.teamTracking, user: _supaUser, start: startGeoTracking };
      if (_geoTrackInitT) clearTimeout(_geoTrackInitT);
      _geoTrackInitOk = false; _geoTrackInitTries = 0; _geoTrackInitT = null;
      window._geoStarts = 0;
      startGeoTracking = () => { window._geoStarts++; };
      _supaUser = _supaUser || { id: 'crew-init-1' };
      S.teamTracking = true;
      window._geoInitSnap = s;
      return true;
    });
  });
  test.afterEach(async () => {
    await page.evaluate(() => {
      const s = window._geoInitSnap;
      if (_geoTrackInitT) clearTimeout(_geoTrackInitT);
      _geoTrackInitT = null;
      _isEmployee = s.isEmp; _employeeRecord = s.rec; S.teamTracking = s.tt; _supaUser = s.user;
      startGeoTracking = s.start;
      document.getElementById('_geo-notice-ov')?.remove();
    });
  });

  test('a crew phone booted from cache, crew row not back yet: waits instead of giving up', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = null;
      const direct = _geoTrackInit();
      const soon = _geoTrackInitSoon();
      return { direct, soon, starts: window._geoStarts, pending: !!_geoTrackInitT, ok: _geoTrackInitOk };
    });
    expect(r).toEqual({ direct: false, soon: false, starts: 0, pending: true, ok: false });
  });

  test('the crew row lands, and the next ask starts tracking (Jack, 9:19am)', async () => {
    const r = await page.evaluate(async () => {
      _isEmployee = true; _employeeRecord = null;
      _geoTrackInitSoon();
      const before = window._geoStarts;
      _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      await new Promise(res => setTimeout(res, _GEO_INIT_RETRY_MS + 600));
      return { before, after: window._geoStarts, ok: _geoTrackInitOk, pending: !!_geoTrackInitT };
    });
    expect(r).toEqual({ before: 0, after: 1, ok: true, pending: false });
  });

  test('coming back to the screen asks straight away', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = null;
      _geoTrackInitSoon();
      _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      document.dispatchEvent(new Event('visibilitychange'));
      return { starts: window._geoStarts, ok: _geoTrackInitOk, pending: !!_geoTrackInitT };
    });
    expect(r).toEqual({ starts: 1, ok: true, pending: false });
  });

  test('once it has run it never runs again, however many times it is asked', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      for (let i = 0; i < 10; i++) _geoTrackInitSoon();
      document.dispatchEvent(new Event('visibilitychange'));
      return { starts: window._geoStarts, pending: !!_geoTrackInitT };
    });
    expect(r).toEqual({ starts: 1, pending: false });
  });

  test('the company switch and the signed-in user are waited on too', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      S.teamTracking = false;
      const off = _geoTrackInit();
      S.teamTracking = true;
      const keepUser = _supaUser; _supaUser = null;
      const noUser = _geoTrackInit();
      _supaUser = keepUser;
      return { off, noUser, starts: window._geoStarts };
    });
    expect(r).toEqual({ off: false, noUser: false, starts: 0 });
  });

  test('a decision already made (un-acknowledged crew) is not "still loading": no retry loop', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = { id: 'e1', location_ack_at: null };
      const ok = _geoTrackInitSoon();
      return { ok, starts: window._geoStarts, pending: !!_geoTrackInitT };
    });
    expect(r).toEqual({ ok: true, starts: 0, pending: false });
  });

  test('it gives up after three minutes and waits for the next time the app is opened', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = null;
      _geoTrackInitTries = _GEO_INIT_TRIES - 1;
      _geoTrackInitSoon();
      const pendingAtCap = !!_geoTrackInitT;
      _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      document.dispatchEvent(new Event('visibilitychange'));
      return { pendingAtCap, starts: window._geoStarts, ok: _geoTrackInitOk };
    });
    expect(r).toEqual({ pendingAtCap: false, starts: 1, ok: true });
  });

  test('a throw inside init is not treated as "still loading"', async () => {
    const r = await page.evaluate(() => {
      const keep = _geoTrackInit;
      _geoTrackInit = () => { throw new Error('boom'); };
      try { return { ok: _geoTrackInitSoon(), pending: !!_geoTrackInitT }; }
      finally { _geoTrackInit = keep; }
    });
    expect(r).toEqual({ ok: true, pending: false });
  });

  test('signing out resets it, so the next person on this page is asked for', async () => {
    const r = await page.evaluate(() => {
      _isEmployee = true; _employeeRecord = { id: 'e1', location_ack_at: '2026-07-30T12:00:00Z' };
      _geoTrackInitSoon();
      const first = _geoTrackInitOk;
      stopGeoTracking();
      return { first, after: _geoTrackInitOk, tries: _geoTrackInitTries };
    });
    expect(r).toEqual({ first: true, after: false, tries: 0 });
  });

  test('the boot asks through the waiting door, not the one-shot', async () => {
    const src = await page.evaluate(() => _removeBootOverlay.toString());
    expect(src).toContain('_geoTrackInitSoon');
    expect(src).not.toContain('setTimeout(_geoTrackInit,');
  });

  test('no console errors, init retry', async () => { assertNoErrors(page); });
});
