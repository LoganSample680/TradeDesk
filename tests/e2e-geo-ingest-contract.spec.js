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
const fs = require('fs');
const path = require('path');
const readSrc = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SERVER = () => readSrc('supabase/functions/ingest-geo/index.ts');
const CLIENT = () => readSrc('js/geo-track.js');

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

  // ── ONE CLOCK, BOTH SIDES ────────────────────────────────────────────────
  // The key derivations below are useless if the two sides feed them different
  // numbers, and for four days they did. The phone opened its leg at the motion
  // edge (2026-08-31) and the server at the raw regionExit, nine seconds apart
  // on the owner's own drive, so base36(startMs) came out different and BOTH
  // rows landed: 3.2 mi "2015 SW Randolph -> 2950 SW McClure" from the phone,
  // 2.1 mi "Stop -> John Doe" from the server, for one 3.2-mile trip.
  //
  // A duplicate cannot be fixed with a better referee: the server's overlap
  // guard asks whether the other writer got there first, which on a
  // backgrounded phone is a coin flip on drain timing, and it lost that
  // morning. The two sides have to START FROM THE SAME EVENT. These freeze
  // that on both copies, because a drift of one second mints a different key.
  test('both engines hold a foot->automotive edge and spend it on the fence exit', () => {
    const srv = SERVER(), cli = CLIENT();
    expect(cli.includes('let _geoDrivePendingAt=null;'), 'client holds the pending edge').toBe(true);
    expect(/pending:\s*PendingDrive\s*\|\s*null/.test(srv), 'server holds the pending edge').toBe(true);
    // The server's has to survive between POSTs: the coprocessor can hand over
    // the edge in one flush and the fence exit in the next.
    expect(srv.includes('state: { dwell, leg, pending,'), 'and carries it across POSTs').toBe(true);
  });

  test('both sides ROUND the plugin float the same way, not one round one truncate', () => {
    const srv = SERVER(), cli = CLIENT();
    // The plugin sends a FLOAT ms (Date().timeIntervalSince1970 * 1000).
    // ingest-geo stores Math.round(e.ts). This side used to do
    // `new Date(Number(ev.ts))`, which TRUNCATES. The owner's 08-31 edge is
    // ...725328.x, so the phone minted a key off 328 and the server off 329:
    // one millisecond, one different base36 string, one whole extra mileage
    // row. Sharing the clock buys nothing if the two sides round differently.
    expect(cli.includes('Math.round(Number(ev.ts))'), 'client rounds the edge').toBe(true);
    expect(srv.includes('ts: Math.round(e.ts)'), 'server rounds the same value').toBe(true);
  });

  test('the staleness cap is the same number on both sides', () => {
    const cliCap = /_GEO_DRIVE_PENDING_MAX_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(CLIENT());
    const srvCap = /DRIVE_PENDING_MAX_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(SERVER());
    expect(cliCap, 'client cap not found').not.toBeNull();
    expect(srvCap, 'server cap not found').not.toBeNull();
    const ms = (m) => Number(m[1]) * Number(m[2]) * Number(m[3]);
    // 15 minutes. Past it the phone has been driving, stopping and starting,
    // and the edge no longer describes THIS departure.
    expect(ms(cliCap)).toBe(15 * 60 * 1000);
    expect(ms(srvCap), 'a cap that differs by a second mints a different key').toBe(ms(cliCap));
  });

  test('both sides refuse a future-stamped edge and cancel on coming to rest', () => {
    const srv = SERVER(), cli = CLIENT();
    // Forward is never allowed: a clock-skewed replay must not backdate a leg
    // into next week. Rest cancels: pulling forward ten feet and parking is not
    // the departure a later exit would be describing.
    expect(cli.includes('if(_at<=now){_geoDrivePendingAt='), 'client refuses a future edge').toBe(true);
    expect(srv.includes('if (e.ts <= nowMs) pending ='), 'server refuses a future edge').toBe(true);
    // The clause gained the flip id (2026-08-31): coming to rest cancels the
    // mark AND the id that named it, or a refused departure would still label
    // the next leg with a transition it was not opened from. Same rule, one
    // more thing to forget, so the assertion names both.
    expect(cli.includes("if(_foot(cur)||cur==='still'){_geoDrivePendingAt=null;_geoDrivePendingId=null;}"),
      'client cancels on rest, mark and id together').toBe(true);
    expect(/REST_KINDS\.has\(k\)\)\s*\{\s*\n\s*pending = null;/.test(srv),
      'server cancels on rest').toBe(true);
  });

  test('the server drops the generic `fence` twin of a named crossing', () => {
    const srv = SERVER();
    // iOS fires one crossing under every id covering the point. regionName maps
    // the bare literal 'fence' to the string "Stop", so taking whichever landed
    // first in the array is where every `Stop -> somewhere` row came from.
    expect(srv.includes('const namedCrossing = evs'), 'the twin filter exists').toBe(true);
    // A WINDOW, not an equality. The owner's two exits are 3 ms apart, so an
    // exact-ts match would never have fired once. Found by replaying his real
    // 08-31 tape before this shipped, and it is the whole reason the filter
    // works at all.
    expect(/TWIN_MS = 2000/.test(srv), 'the twin match is a window').toBe(true);
    expect(/Math\.abs\(n\.ts - e\.ts\) <= TWIN_MS/.test(srv), 'matched by distance, not equality').toBe(true);
    expect(/const walk = evs\.filter/.test(srv), 'the state machine walks the filtered list').toBe(true);
    // ...and the RAW insert still stores everything, so nothing is lost.
    expect(srv.indexOf('from("geo_events").upsert') < srv.indexOf('const namedCrossing'),
      'the filter must come AFTER the raw store, never before it').toBe(true);
  });

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

  // The survivor now has to be IN THE CLOUD before the server's copy is
  // destroyed, so this test seeds _syncedHash for it. That is not test
  // scaffolding for its own sake: it is the precondition the drop depends on,
  // and the test below proves what happens without it.
  test('a provisional row whose legKey the client engine already owns is dropped and its delete recorded', async () => {
    const r = await page.evaluate(async (row) => {
      const clientRow = { id: 991122, legKey: row.legKey, gps: true, miles: 4.1, calc_method: 'auto_route', fromCoord: row.fromCoord, toCoord: row.toCoord, startedIso: row.startedIso, endedIso: row.endedIso };
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome };
      mileage.length = 0; mileage.push(row, clientRow);
      _syncedHash.td_mileage = (_syncedHash.td_mileage || new Map()).set('991122', 'h');
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
      _syncedHash.td_mileage.delete('991122');
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home;
      window._mileServerRefineRan = false;
      return out;
    }, SRV_ROW());
    expect(r.count).toBe(1);
    expect(r.survivorId).toBe(991122);
    expect(r.deleteRecorded).toBe(true);
  });

  // ── The live incident this guard exists for ───────────────────────────────
  // Jack, 2026-08-30: the server recorded an 8.4-mile drive home while the app
  // was closed. He opened the app for EIGHT SECONDS. This sweep matched the
  // server's leg to the phone's own in-memory copy, deleted the server's, and
  // the phone's copy never reached the cloud. Both records of the drive were
  // gone: one deleted, one never saved. Same shape on 08-27.
  test('a survivor that is not in the cloud yet does NOT get to delete the server row', async () => {
    const r = await page.evaluate(async (row) => {
      const clientRow = { id: 991133, legKey: row.legKey, gps: true, miles: 4.1, calc_method: 'auto_route', fromCoord: row.fromCoord, toCoord: row.toCoord, startedIso: row.startedIso, endedIso: row.endedIso };
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome };
      mileage.length = 0; mileage.push(row, clientRow);
      // The whole point: 991133 is NOT in _syncedHash, i.e. the cloud has
      // never seen it. It is exactly the row that vanished on Jack's phone.
      if (_syncedHash.td_mileage) _syncedHash.td_mileage.delete('991133');
      window._mileServerRefineRan = false;
      _routeDistance = async () => ({ miles: 4.4, mins: 11 });
      _placeIsLikelyHome = () => false;
      await _mileServerRefine();
      const out = {
        count: mileage.length,
        ids: mileage.map(m => String(m.id)).sort(),
        deleteRecorded: !!(_locallyDeletedIds && _locallyDeletedIds.td_mileage && _locallyDeletedIds.td_mileage.has(String(row.id))),
        stillProvisional: !!(mileage.find(m => String(m.id) === String(row.id)) || {}).provisional,
      };
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home;
      window._mileServerRefineRan = false;
      return out;
    }, SRV_ROW());
    // BOTH rows survive. A duplicate for one session is the price, and it is
    // the right price: the alternative is the trip, permanently and silently.
    expect(r.count).toBe(2);
    expect(r.deleteRecorded, 'nothing may be queued for deletion').toBe(false);
    // And it stays provisional, so the NEXT session re-evaluates it properly
    // rather than promoting an orphan into a first-class duplicate.
    expect(r.stillProvisional).toBe(true);
  });

  test('_cloudHasRow answers only for rows the cloud has actually seen', async () => {
    const r = await page.evaluate(() => {
      const had = _syncedHash.td_mileage;
      _syncedHash.td_mileage = new Map([['abc', 'h']]);
      const out = {
        known: _cloudHasRow('td_mileage', 'abc'),
        numeric: _cloudHasRow('td_mileage', 'abc') === _cloudHasRow('td_mileage', String('abc')),
        unknown: _cloudHasRow('td_mileage', 'nope'),
        nullId: _cloudHasRow('td_mileage', null),
        undefId: _cloudHasRow('td_mileage', undefined),
        noTable: _cloudHasRow('td_nothing', 'abc'),
        noArgs: _cloudHasRow(),
      };
      if (had) _syncedHash.td_mileage = had; else delete _syncedHash.td_mileage;
      return out;
    });
    // A false yes costs data, so everything it is unsure about reads as no.
    expect(r.known).toBe(true);
    expect(r.numeric).toBe(true);
    expect([r.unknown, r.nullId, r.undefId, r.noTable, r.noArgs])
      .toEqual([false, false, false, false, false]);
  });

  // ── The real duplicate: two writers, two legKeys, one drive ───────────────
  // Owner 2026-08-27, live: every drive that day was written twice. The phone
  // dates the leg from the ping where JS noticed the departure, the server
  // from the raw regionExit; seconds apart, so the legKey test never fired and
  // the refine PROMOTED the orphan instead of dropping it.
  test('a DIFFERENT legKey for the same drive is still one drive, and the phone row wins', async () => {
    const r = await page.evaluate(async (row) => {
      // The exact shape observed: client start 3s later, its own key, real
      // name and mileage, same destination.
      const clientRow = { id: 1787870093125087, legKey: 'abcdefgh-leg-OTHER', gps: true, miles: 3.4,
        calc_method: 'auto_route', from_name: 'John Doe', to_name: 'Shop',
        fromCoord: row.fromCoord, toCoord: { lat: 39.0501, lng: -95.6501 },
        startedIso: '2026-08-27T14:00:03.000Z', endedIso: '2026-08-27T14:30:16.000Z' };
      const saved = { mileage: mileage.slice(), route: window._routeDistance, home: window._placeIsLikelyHome };
      mileage.length = 0; mileage.push(row, clientRow);
      // The phone row is already in the cloud, which is the precondition for
      // dropping the server's copy of the same drive (see the guard below).
      _syncedHash.td_mileage = (_syncedHash.td_mileage || new Map()).set('1787870093125087', 'h');
      window._mileServerRefineRan = false;
      _routeDistance = async () => ({ miles: 4.4, mins: 11 });
      _placeIsLikelyHome = () => false;
      await _mileServerRefine();
      const out = {
        count: mileage.length,
        survivorId: mileage[0] && mileage[0].id,
        survivorName: mileage[0] && mileage[0].from_name,
        deleteRecorded: !!(_locallyDeletedIds && _locallyDeletedIds.td_mileage && _locallyDeletedIds.td_mileage.has(String(row.id))),
      };
      _locallyDeletedIds.td_mileage.delete(String(row.id));
      _syncedHash.td_mileage.delete('1787870093125087');
      mileage.length = 0; saved.mileage.forEach(m => mileage.push(m));
      _routeDistance = saved.route; _placeIsLikelyHome = saved.home;
      window._mileServerRefineRan = false;
      return out;
    }, SRV_ROW());
    expect(r.count, 'the server orphan must be dropped, not promoted').toBe(1);
    expect(r.survivorId).toBe(1787870093125087);
    expect(r.survivorName, 'the phone row keeps the real name, never "Stop"').toBe('John Doe');
    expect(r.deleteRecorded).toBe(true);
  });

  test('_mileSameDrive: overlap AND destination, never either alone', async () => {
    const r = await page.evaluate(() => {
      const A = { startedIso: '2026-08-27T14:00:00Z', endedIso: '2026-08-27T14:30:00Z', toCoord: { lat: 39.05, lng: -95.65 } };
      const same = { startedIso: '2026-08-27T14:00:03Z', endedIso: '2026-08-27T14:30:16Z', toCoord: { lat: 39.0501, lng: -95.6501 } };
      // A there-and-back pair sharing only a boundary minute is TWO drives.
      const backToBack = { startedIso: '2026-08-27T14:30:00Z', endedIso: '2026-08-27T15:00:00Z', toCoord: { lat: 39.05, lng: -95.65 } };
      // Same shop, different afternoon: same destination, no overlap.
      const laterSameDest = { startedIso: '2026-08-27T18:00:00Z', endedIso: '2026-08-27T18:30:00Z', toCoord: { lat: 39.05, lng: -95.65 } };
      // Overlapping in time but ending miles apart: two crew, two drives.
      const elsewhere = { startedIso: '2026-08-27T14:01:00Z', endedIso: '2026-08-27T14:29:00Z', toCoord: { lat: 39.40, lng: -95.20 } };
      return {
        same: _mileSameDrive(A, same),
        backToBack: _mileSameDrive(A, backToBack),
        laterSameDest: _mileSameDrive(A, laterSameDest),
        elsewhere: _mileSameDrive(A, elsewhere),
        self: _mileSameDrive(A, A),
        junk: _mileSameDrive(null, A) || _mileSameDrive(A, {}) || _mileSameDrive({}, {}),
      };
    });
    expect(r.same, 'seconds apart, same destination: one drive').toBe(true);
    expect(r.backToBack, 'a shared boundary minute is not an overlap').toBe(false);
    expect(r.laterSameDest, 'same shop later is a second trip').toBe(false);
    expect(r.elsewhere, 'overlapping in time but ending elsewhere').toBe(false);
    expect(r.self, 'a row is never its own duplicate').toBe(false);
    expect(r.junk, 'null and empty input never claim a match').toBe(false);
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

  // ── ONE FLIP, ONE ID (owner rule 2026-08-31) ─────────────────────────────
  // The duplicate rows were never a race, they were arithmetic: the leg key is
  // base36 of the start millisecond, COMPUTED on both sides, and iOS emitted
  // four automotive samples for his 1:19pm departure. The phone keyed off
  // ...35.747, the server off ...35.529, and one drive home became two rows.
  // These pin the sides together at the source, which is the only place a
  // divergence like that can be caught without two devices and a real drive.

  test('both sides prefer the flip id over anything derived', async () => {
    const srv = SERVER(), cli = CLIENT();
    expect(srv, 'server keys off flipId when it has one').toMatch(/flipId \? String\(flipId\)/);
    expect(cli, 'client keys off flipId when it has one').toMatch(/if\(flipId\)return String\(flipId\);/);
  });

  test('both sides keep the derived fallback, byte for byte', async () => {
    // Rows already on the books carry the derived shape and a phone on an
    // older build sends no id, so dropping the fallback would orphan both.
    const shape = /slice\(0, ?8\) ?\+ ?"-leg-" ?\+ ?startMs\.toString\(36\)/;
    expect(SERVER()).toMatch(shape);
    expect(CLIENT()).toMatch(/slice\(0,8\)\+'-leg-'\+\(\(Date\.parse\(startedIso\)\|\|0\)\)\.toString\(36\)/);
  });

  test('both sides carry the id on the pending mark, not just on the event', async () => {
    // The mark is what survives between the flip and the fence exit that
    // spends it, and on the server it survives between two POSTs. An id that
    // does not ride the mark cannot name the leg it opens.
    expect(SERVER()).toMatch(/pending = \{ ts: e\.ts, lat: e\.lat, lon: e\.lng, flipId: e\.flipId \}/);
    expect(CLIENT()).toMatch(/_geoDrivePendingId=\(typeof ev\.flipId==='string'&&ev\.flipId\)\?ev\.flipId:null/);
  });

  test('both sides drop the id when the mark is refused', async () => {
    // A leg labelled with a transition it was not opened from is worse than an
    // unlabelled one: wrong, and it looks authoritative.
    expect(SERVER()).toMatch(/regionId: e\.regionId, flipId: null \}/);
    expect(CLIENT()).toMatch(/_geoLegFlipId=_useTape\?_geoDrivePendingId:null;/);
  });

  test('both sides take only a STRING id, so junk cannot become a key', async () => {
    expect(SERVER()).toMatch(/typeof e\.flipId === "string"/);
    expect(CLIENT()).toMatch(/typeof ev\.flipId==='string'/);
  });

  test('the plugin mints the id once per flip and remembers across re-arms', async () => {
    // The other half, and the actual origin of the four samples: the live
    // stream's memory of the last kind was in-memory and wiped on every
    // re-arm, and it is re-armed from three places. Durable now, or one state
    // change is reported once per re-arm forever.
    const sw = readSrc('native/td-geo/ios/Plugin/TdGeoPlugin.swift');
    expect(sw, 'the memory is durable, not per-process').toMatch(/lastMotionKindKey = "td_geo_last_motion_kind"/);
    expect(sw, 'and nothing wipes it on re-arm').not.toMatch(/lastMotionKind = ""/);
    expect(sw, 'a live flip is minted an id').toMatch(/"flipId": self\.newFlipId\(\)/);
    expect(sw, 'and so is one recovered from history').toMatch(/"hist": true, "flipId": self\.newFlipId\(\)/);
  });

  test('no console errors', async () => {
    await assertNoErrors(page);
  });
});
