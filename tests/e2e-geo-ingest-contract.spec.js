// ── The server/client geofence contract ─────────────────────────────────────
// The ingest-geo edge function (supabase/functions/ingest-geo/index.ts)
// writes rows the JS engine must recognize as its own: it mints the SAME
// deterministic keys (_geoLegKey / _geoVisitKey) so the unique index on
// (contractor_user_id, client_key) and the client's legKey checks dedupe
// server and client writes against each other in both directions.
//
// That only holds while the client derivations never drift. This spec
// freezes them: if a refactor changes a key shape, this fails with a message
// pointing at the server copy that has to change in the same commit.
//
// The second half covers _mileServerRefine (js/mileage.js): the sweep that
// promotes a server-provisional mileage row into a first-class one (real
// routed miles), drops it when the client engine already owns the leg, and
// applies the commute rule the server cannot.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('geofence ingest contract', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  // ── Key derivations: the exact strings the server mints ───────────────────
  test('_geoLegKey is uid8-leg-base36(startMs), byte for byte', async () => {
    const r = await page.evaluate(() => {
      const saved = _supaUser;
      _supaUser = { id: 'abcdefgh-1234-5678-9abc-def012345678' };
      const key = _geoLegKey('2026-08-27T14:30:00.000Z');
      _supaUser = saved;
      return { key, expectMs: Date.parse('2026-08-27T14:30:00.000Z') };
    });
    // Server copy: legKeyOf() in supabase/functions/ingest-geo/index.ts.
    expect(r.key).toBe('abcdefgh-leg-' + r.expectMs.toString(36));
  });

  test('_geoVisitKey is uid8-vis-kind-id-base36, null id renders as x', async () => {
    const r = await page.evaluate(() => {
      const saved = _supaUser;
      _supaUser = { id: 'abcdefgh-1234-5678-9abc-def012345678' };
      const arr = '2026-08-27T09:15:00.000Z';
      const out = {
        job: _geoVisitKey('job', 42, arr),
        client: _geoVisitKey('client', 'c9', arr),
        shop: _geoVisitKey('shop', null, arr),
        ms: Date.parse(arr),
      };
      _supaUser = saved;
      return out;
    });
    // Server copy: visKeyOf() in supabase/functions/ingest-geo/index.ts.
    const b36 = r.ms.toString(36);
    expect(r.job).toBe('abcdefgh-vis-job-42-' + b36);
    expect(r.client).toBe('abcdefgh-vis-client-c9-' + b36);
    expect(r.shop).toBe('abcdefgh-vis-shop-x-' + b36);
  });

  test('a drive time row carries the legKey AS its client_key (the dedup hinge)', async () => {
    // _geoDriveEntry enqueues job_time_entries with client_key = the legKey.
    // The server relies on this to make its drive rows collide with client
    // replays of the same leg. Assert against the enqueue itself.
    const r = await page.evaluate(() => {
      const rows = [];
      const savedEnq = _geoEnqueue, savedUser = _supaUser, savedOrigin = _geoLegOrigin, savedMiles = _geoDriveMiles;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'abcdefgh-1234-5678-9abc-def012345678' };
      const start = new Date(Date.now() - 40 * 60000).toISOString();
      const end = new Date(Date.now() - 5 * 60000).toISOString();
      _geoLegOrigin = { lat: 39.0, lng: -95.7, kind: 'stop', name: 'Stop' };
      _geoDriveMiles = 5;
      try {
        _geoDriveEntry(null, start, 'Ace Supply', end, false, { lat: 39.05, lng: -95.65, kind: 'stop', name: 'Ace Supply' });
      } catch (e) { return { error: e.message }; }
      finally {
        _geoEnqueue = savedEnq; _supaUser = savedUser; _geoLegOrigin = savedOrigin; _geoDriveMiles = savedMiles;
      }
      const drive = rows.find(x => /^drive/.test(x.row.source || ''));
      return { key: drive && drive.row.client_key, expected: _geoLegKeyForTest(start) };
      function _geoLegKeyForTest(iso) { return 'abcdefgh-leg-' + Date.parse(iso).toString(36); }
    });
    if (r && r.error) throw new Error(r.error);
    expect(r.key).toBe(r.expected);
  });

  // ── _mileServerRefine ─────────────────────────────────────────────────────
  const SRV_ROW = (over) => Object.assign({
    id: 'srv-abcdefgh-leg-test1', legKey: 'abcdefgh-leg-test1', gps: true, provisional: true,
    calc_method: 'server_est', miles: 3.9, gpsMiles: 0,
    date: '2026-08-27', startedIso: '2026-08-27T14:00:00.000Z', endedIso: '2026-08-27T14:30:00.000Z',
    mins: 30, from_name: 'Stop', from: 'Stop', to_name: 'Job A', to: 'Job A',
    fromCoord: { lat: 39.0, lng: -95.7 }, toCoord: { lat: 39.05, lng: -95.65 },
    purpose: 'Business',
  }, over || {});

  test('a lone provisional row is promoted: routed miles land, the flag comes off', async () => {
    const r = await page.evaluate(async (row) => {
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome };
      mileage.length = 0; mileage.push(row);
      window._mileServerRefineRan = false;
      _routeDistance = async () => ({ miles: 4.4, mins: 11 });
      _placeIsLikelyHome = () => false;
      await _mileServerRefine();
      const out = { miles: mileage[0] && mileage[0].miles, prov: mileage[0] && mileage[0].provisional, calc: mileage[0] && mileage[0].calc_method, count: mileage.length };
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home;
      window._mileServerRefineRan = false;
      return out;
    }, SRV_ROW());
    expect(r.count).toBe(1);
    expect(r.miles).toBe(4.4);
    expect(r.prov).toBeUndefined();
    expect(r.calc).toBe('auto_route');
  });

  test('a provisional row whose legKey the client engine already owns is dropped and its delete recorded', async () => {
    const r = await page.evaluate(async (row) => {
      const clientRow = { id: 991122, legKey: row.legKey, gps: true, miles: 4.1, calc_method: 'auto_route', fromCoord: row.fromCoord, toCoord: row.toCoord, startedIso: row.startedIso, endedIso: row.endedIso };
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome };
      mileage.length = 0; mileage.push(row, clientRow);
      window._mileServerRefineRan = false;
      _routeDistance = async () => ({ miles: 4.4, mins: 11 });
      _placeIsLikelyHome = () => false;
      await _mileServerRefine();
      const out = {
        count: mileage.length,
        survivorId: mileage[0] && mileage[0].id,
        deleteRecorded: !!(_locallyDeletedIds && _locallyDeletedIds.td_mileage && _locallyDeletedIds.td_mileage.has(String(row.id))),
      };
      _locallyDeletedIds.td_mileage.delete(String(row.id));
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home;
      window._mileServerRefineRan = false;
      return out;
    }, SRV_ROW());
    expect(r.count).toBe(1);
    expect(r.survivorId).toBe(991122);
    expect(r.deleteRecorded).toBe(true);
  });

  test('a provisional home-origin leg is a commute: dropped unless the owner declared a home office', async () => {
    const r = await page.evaluate(async (row) => {
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome, ho: S.homeOffice };
      _routeDistance = async () => ({ miles: 4.4, mins: 11 });
      _placeIsLikelyHome = () => true;
      // No home office: the commute is deleted.
      S.homeOffice = false;
      mileage.length = 0; mileage.push(JSON.parse(JSON.stringify(row)));
      window._mileServerRefineRan = false;
      await _mileServerRefine();
      const withoutOffice = mileage.length;
      _locallyDeletedIds.td_mileage.delete(String(row.id));
      // Home office declared: the same leg is deductible business travel.
      S.homeOffice = true;
      mileage.length = 0; mileage.push(JSON.parse(JSON.stringify(row)));
      window._mileServerRefineRan = false;
      await _mileServerRefine();
      const withOffice = mileage.length;
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home; S.homeOffice = saved.ho;
      window._mileServerRefineRan = false;
      return { withoutOffice, withOffice };
    }, SRV_ROW());
    expect(r.withoutOffice).toBe(0);
    expect(r.withOffice).toBe(1);
  });

  test('the sweep runs once per session and never throws on garbage rows', async () => {
    const r = await page.evaluate(async () => {
      const saved = { mileage: mileage.slice() };
      mileage.length = 0;
      mileage.push({ id: 'srv-x', provisional: true });                        // no legKey/coords
      mileage.push({ id: 'srv-y', provisional: true, legKey: 'k', fromCoord: null, toCoord: null });
      window._mileServerRefineRan = false;
      let threw = false;
      try { await _mileServerRefine(); } catch (e) { threw = true; }
      const first = window._mileServerRefineRan;
      // Second call in the same session must be a no-op even with fresh rows.
      mileage.push(Object.assign({}, { id: 'srv-z', legKey: 'zz', provisional: true, fromCoord: { lat: 1, lng: 1 }, toCoord: { lat: 2, lng: 2 } }));
      const second = await _mileServerRefine();
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      window._mileServerRefineRan = false;
      return { threw, first, second };
    });
    expect(r.threw).toBe(false);
    expect(r.first).toBe(true);
    expect(r.second).toBe(0);
  });

  test('no console errors', async () => {
    await assertNoErrors(page);
  });
});
