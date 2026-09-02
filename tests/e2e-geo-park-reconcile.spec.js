// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// Park detection + time-log reconciliation (js/geo-track.js, owner design
// 2026-08-20).
//
// PARK: the job fence is tight (600ft) and GPS wander means a truck parked AT
// the job can sit outside it fix after fix, so the visit never opens and the
// drive leg stays open. When a drive is open and the fixes go stationary for
// _GEO_PARK_MS, the drive is dead: killed and stamped at the moment motion
// stopped, and if the stationary cluster's CENTROID lands within the fence
// plus _GEO_PARK_JOB_EXTRA_FT of a job, that is an arrival at that job,
// backdated to when they parked. Departure follows the existing rule: the
// visit persists until driving-speed evidence.
//
// RECONCILIATION: when live fence detection missed an arrival/departure, the
// mileage legs on either side pin the truth (leg N ended at the job, leg N+1
// left from the same spot), so the span between IS on-site time.
// _geoReconcileFromMileage repairs the log from those anchors: extends a
// truncated geofence row, inserts a 'geofence-reconciled' row when nothing
// covers the window, and always defers to a human's manual clock record.
//
// Harness mirrors e2e-geo-send-coverage.spec.js: one page booted via
// mockAllExternal + waitForAppBoot, a geoReset() that installs a recording
// _supa (window.__rec), seed data snapshotted/restored per test, and a
// closing assertNoErrors().
// ═══════════════════════════════════════════════════════════════════════════════

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Geo park detection + mileage reconciliation', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Name the business zone: the day-key and clock-stamp helpers follow the
    // business address now, not a hardcoded Central (owner 2026-08-30), so a
    // spec that does not say where the business is inherits the runner's zone
    // (UTC in CI, Central on a Kansas laptop) and its result stops being about
    // the code. Same rule as the clock pin, CLAUDE.md 5.2.2.
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    // The app's own cross-device reconcile heartbeat (js/cloud.js
    // _heartbeatTick, every ~5s once _cloudTimersStarted) self-reschedules
    // forever after a signed-in boot and never stops on its own. It can call
    // supaLoadFromCloud({silent:true}) at any later point in this file's
    // ~150-test run, which now internally awaits _geoDedupTimeEntries then
    // _geoMergeAdjacentVisits (owner rule 2026-08-23) using WHATEVER _supa
    // mock and window.__selRows the CURRENTLY RUNNING test happens to have
    // installed at that moment, not this file's own harness, corrupting an
    // unrelated test's recording or racing its busy guard. This file's tests
    // exercise those functions directly against a controlled mock; the live
    // heartbeat has nothing to do with any of them, so it's neutralized once
    // for the whole file rather than raced against every single test.
    await page.evaluate(() => { window._scheduleReconcile = () => {}; });
    // Same reasoning, one layer up: js/cloud.js fires
    // _geoTimeEntriesSettleChain (repair, then dedup, then merge) from three
    // separate places on cloud load and reconnect, so a background pass can
    // be mid-flight against this file's mock whenever one of those paths
    // happens to run. Every sweep in that chain is driven DIRECTLY and
    // deliberately by the tests below against seeded rows, so a background
    // copy contributes nothing but a race: it holds the re-entrancy guard a
    // direct call then has to wait out, and on a loaded CI runner that wait
    // is what expires. That is the shape of shard 6's intermittent zero on
    // the merge test (2026-08-24, twice, green every time in isolation).
    // Neutralized once for the whole file, exactly like the heartbeat above,
    // rather than raced against in every individual test.
    await page.evaluate(() => { window._geoTimeEntriesSettleChain = async () => {}; });
    // js/cloud.js fires _milePersonalStopSweep() in the background on its
    // reconnect path (line ~7890), and the guard that normally keeps two
    // passes apart is a single global boolean this file's harness has to
    // CLEAR to drive its own call. Clearing it also lets a background pass in,
    // and then both walk the same `mileage`: whichever gets there first does
    // the collapse and the other correctly reports zero, which is a test
    // failing on work that actually happened (locally 2026-08-24, roughly one
    // run in four). Every sweep here is driven deliberately, so the background
    // caller is gated out entirely and only the harness can open the gate.
    // All three, not just the personal-stop one: js/cloud.js fires
    // _mileDedupTrips, _mileMotionHealSweep and _milePersonalStopSweep from
    // the same reconnect path, and every one of them SPLICES `mileage`. A
    // seeded fixture row disappearing mid-test then reads as "the sweep under
    // test did nothing", when in fact the collapse happened and a different
    // sweep did it (locally 2026-08-24: the leg was gone, the result was zero,
    // and the two facts contradicted each other). None of them is ever wanted
    // here in the background, so all three are gated and only the harness
    // opens the gate.
    await page.evaluate(() => {
      window.__sweepAllowed = false;
      // _geoCollapseDetours is the fourth, and the one that was still doing it
      // after the other three were gated: it is the LIVE counterpart of the
      // personal-stop sweep (js/geo-track.js), it splices `mileage` for any
      // leg ending at the current 'stop' origin, and it rides the ping path,
      // so a geocode resolving late from an earlier test in this shared page
      // can fire it in the middle of an unrelated one. Its fingerprint was
      // the seeded leg gone from `mileage` while the sweep under test
      // reported zero: the collapse happened, something else did it.
      for (const fn of ['_geoCollapseDetours']) {
        const real = window[fn];
        if (typeof real !== 'function') continue;
        window['__real' + fn] = real;
        // Consumed synchronously ON ENTRY, not held for the duration of the
        // call. A flag left true across the harness's own await is a gate
        // standing open: a background caller landing in that window runs the
        // REAL sweep alongside it, does the collapse, and the harness's call
        // then correctly reports zero on work that already happened. That is
        // the same failure the gate was added to stop, one level down, and it
        // is why gating all three sweeps did not fix it on its own.
        window[fn] = function () {
          if (!window.__sweepAllowed) return 0;
          window.__sweepAllowed = false;
          return window['__real' + fn].apply(null, arguments);
        };
      }
    });
    await page.evaluate(([snap, since]) => {
      window.__noteSnap = new Function('return ' + snap);
      window.__noteSince = new Function('return ' + since)();
    }, [NOTE_SNAP, NOTE_SINCE]);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Fresh geo state + a scriptable _supa recorder for every test. Same shape
  // as e2e-geo-send-coverage's geoReset, extended with the chainable
  // select/update the reconciliation code path needs: select resolves
  // {data: window.__selRows, error: window.__selErr} whatever filters were
  // chained, and update(...).eq(...) records into window.__rec.updates.
  const geoReset = () => page.evaluate(async () => {
    const settleStart = Date.now();
    while (typeof _geoDrainBusy !== 'undefined' && _geoDrainBusy && Date.now() - settleStart < 2000) {
      await new Promise(res => setTimeout(res, 10));
    }
    // The one-time boot-settle chain (js/cloud.js _bootSyncSettled, now
    // _geoTimeEntriesSettleChain: dedup, then merge, then gap-absorb) fires
    // once, using whatever _supa mock is CURRENT when its own promise
    // finally resolves, not the mock installed when it was kicked off. If
    // it's still in flight when the first test(s) here start, wait it out
    // (same pattern as _geoDrainBusy above) rather than force-clearing the
    // flag mid-run, which would let two concurrent sweeps interleave writes
    // into window.__rec.
    while (typeof _geoTimeDedupBusy !== 'undefined' && _geoTimeDedupBusy && Date.now() - settleStart < 2000) {
      await new Promise(res => setTimeout(res, 10));
    }
    while (typeof _geoMergeBusy !== 'undefined' && _geoMergeBusy && Date.now() - settleStart < 2000) {
      await new Promise(res => setTimeout(res, 10));
    }
    while (typeof _geoGapAbsorbBusy !== 'undefined' && _geoGapAbsorbBusy && Date.now() - settleStart < 2000) {
      await new Promise(res => setTimeout(res, 10));
    }
    localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_open');
    localStorage.removeItem('zp3_geo_manual'); localStorage.removeItem('zp3_geo_prune_day');
    _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
    _geoDriveStartedAt = null; _geoGapHiddenAt = null; _geoExitPending = null;
    _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
    _geoStopAnchor = null; _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoLegOrigin = null;
    _geoLegAtShop = false; _geoHomeDwell = null; _geoWasAtHome = false; _geoDrivebyRun = 0;
    _geoParkCluster = null; _geoSoftJob = null; _geoSoftJobSpeedRun = 0;
    _geoSoftShop = null; _geoSoftShopSpeedRun = 0; _geoParkBackdate = null;
    _geoLastPingTs = 0; _geoPingBusy = false; _geoDriveReset();
    if (typeof _geoReconBusy !== 'undefined') _geoReconBusy = false;
    // Fallback if the wait above timed out rather than settled naturally:
    // force clear so a genuinely stuck flag can't wedge every later test.
    if (typeof _geoMergeBusy !== 'undefined') _geoMergeBusy = false;
    if (typeof _geoTimeDedupBusy !== 'undefined') _geoTimeDedupBusy = false;
    if (typeof _geoGapAbsorbBusy !== 'undefined') _geoGapAbsorbBusy = false;
    if (typeof _geoStopRepairBusy !== 'undefined') _geoStopRepairBusy = false;
    // The extracted cleanup chain carries its own busy flag AND a 10s
    // recency skip, so without clearing both here the SECOND test in this
    // file would silently no-op on a chain the first one just ran.
    if (typeof _geoCleanupBusy !== 'undefined') _geoCleanupBusy = false;
    if (typeof _geoCleanupAt !== 'undefined') _geoCleanupAt = 0;
    // The retroactive verifier skips a row it already judged TODAY, kept in
    // localStorage. Without clearing it, the second test that seeds a row
    // would silently verify nothing and read as a passing no-op.
    if (typeof _geoVerifyBusy !== 'undefined') _geoVerifyBusy = false;
    localStorage.removeItem('zp3_geo_recon_seen');
    window._isEmployee = false;
    window._supaUser = { id: 'geo-park-user-1', email: 'p@t.com' };
    window.__rec = { upserts: [], inserts: [], deletes: [], updates: [] };
    // Table-aware seeding: shop_time_entries selects resolve __selShopRows,
    // location_pings resolve __selPings (the reconciler now checks its claim
    // against the recorded breadcrumbs, owner 2026-08-25), td_mileage resolves
    // __selMileage (the drive sweep asks the CLOUD which legs survive rather
    // than this device's memory, owner 2026-09-01), everything else resolves
    // __selRows. One shared array would feed job rows in as shop rows, or
    // worse, as GPS fixes with no lat/lon at all.
    window.__selRows = []; window.__selShopRows = []; window.__selPings = [];
    window.__selMileage = null;   // null = "not seeded", see rowsFor below
    window.__selErr = null;
    window.__origSupa = window.__origSupa || window._supa;
    window._supa = {
      from: (tbl) => ({
        select: () => {
          const rowsFor = () => (tbl === 'shop_time_entries' ? (window.__selShopRows || [])
                              : tbl === 'location_pings' ? (window.__selPings || [])
                              // Unseeded td_mileage mirrors the local array, so
                              // every test written before the sweep read the
                              // cloud keeps meaning what it meant. A test that
                              // wants them to DISAGREE (which is the whole bug)
                              // sets __selMileage explicitly.
                              : tbl === 'td_mileage'
                                ? (window.__selMileage
                                   || (Array.isArray(mileage) ? mileage.map(m => ({ data: m })) : []))
                              : (window.__selRows || []));
          const q = {
            eq: () => q, neq: () => q, lt: () => q, gt: () => q, gte: () => q, lte: () => q,
            in: () => q, is: () => q, order: () => q, limit: () => q,
            // The periodic whole-account cloud load (js/cloud.js, zj_data)
            // chains .select(...).eq(...).maybeSingle() off its own query,
            // unrelated to geo/mileage but it can fire mid-test since this
            // file boots the FULL app. Without these the TypeError is a real
            // console.error and fails assertNoErrors() (seen in CI 2026-08-21).
            single: () => Promise.resolve({ data: rowsFor()[0] || null, error: (window.__selErr || null) }),
            maybeSingle: () => Promise.resolve({ data: rowsFor()[0] || null, error: (window.__selErr || null) }),
            then: (res, rej) => Promise.resolve({ data: rowsFor(), error: (window.__selErr || null) }).then(res, rej),
          };
          return q;
        },
        // Chainable AND directly awaitable: the reconciliation code this file
        // exercises just awaits upsert()/insert() bare, but this test boots
        // the FULL app (waitForAppBoot), so the periodic whole-account cloud
        // save (js/cloud.js supaSaveToCloud, unrelated to geo/mileage) can
        // fire mid-test and chains .select('updated_at').single() off its own
        // zj_data upsert. A bare Promise has no .select, that TypeError is a
        // real console.error and fails assertNoErrors() (seen in CI). Mirror
        // the select() query builder's shape above so any chain resolves safely.
        upsert: (row, opts) => {
          window.__rec.upserts.push({ tbl, row, opts });
          const q = { select: () => q, single: () => Promise.resolve({ data: null, error: null }),
                      maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
          return q;
        },
        insert: (row) => {
          window.__rec.inserts.push({ tbl, row });
          const q = { select: () => q, single: () => Promise.resolve({ data: null, error: null }),
                      maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
          return q;
        },
        // Chainable on MULTIPLE .eq() calls (the duplicate-key drain fix
        // matches on both contractor_user_id AND client_key), and directly
        // awaitable bare, same reasoning as upsert/insert above.
        // A SOFT DELETE IS A DELETE, as far as these tests are concerned
        // (2026-08-26). Every sweep now stamps deleted_at through
        // _tdSoftDelete instead of issuing a DELETE, so a recorder that only
        // watched .delete() saw nothing happen and 25 assertions about
        // __rec.deletes read undefined. Recording the stamp into the SAME
        // ledger keeps every one of those assertions meaningful and unchanged:
        // they were always about "was this row removed", never about the verb.
        // Genuine field updates (a trim, a merge widening a span) still land in
        // __rec.updates as before, because they carry no deleted_at.
        update: (patch) => {
          const rec = { tbl, patch, filters: {} };
          const soft = !!(patch && patch.deleted_at);
          if (!soft) window.__rec.updates.push(rec);
          const q = {
            eq: (col, val) => {
              rec.filters[col] = val;
              if (soft) window.__rec.deletes.push({ tbl, col, val });
              return q;
            },
            in: (col, vals) => {
              rec.filters[col] = vals;
              if (soft) (vals || []).forEach(v => window.__rec.deletes.push({ tbl, col, val: v }));
              return q;
            },
            then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
          return q;
        },
        // Chainable AND directly awaitable, same reasoning as upsert/insert
        // above: location_pings pruning chains .eq().lt().then(), while
        // _geoDedupTimeEntries just awaits .eq(col,val) bare.
        delete: () => ({
          eq: (col, val) => {
            window.__rec.deletes.push({ tbl, col, val });
            const q = { lt: () => q, then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
            return q;
          },
        }),
      }),
    };
    // Remembered so a direct-call harness can re-assert it immediately before
    // driving a sweep. This page lives for the whole ~150-test file and the
    // app can rebuild its own client at any moment (supaInit runs on a
    // realtime reconnect, among other paths), which silently swaps _supa out
    // from under a test between its seeding step and its call. The sweep then
    // reads the app's client instead of this harness, finds no rows, and
    // returns 0 having done nothing wrong: the exact shape of CI shard 6's
    // intermittent "Expected: 1, Received: 0" on the merge test (2026-08-24,
    // twice, never reproducible in isolation). Re-asserting costs one
    // assignment and removes the whole class.
    window.__harnessSupa = window._supa;
  });
  const geoRestore = () => page.evaluate(() => { if (window.__origSupa) window._supa = window.__origSupa; });
  // _geoParkLog is a 30-entry RING: _geoParkNote pushes then trims back to 30,
  // so a "remember the length, slice from it afterwards" capture sees NOTHING
  // once the log is full, because the push and the trim cancel out. That is
  // not a subtle failure mode, it silently reports an empty note list and any
  // assertion built on it becomes vacuous (which is exactly what it did to the
  // first version of these diagnostics, 2026-08-24). Diff by content instead.
  const NOTE_SNAP = `(function(){try{return (typeof _geoParkLog!=='undefined'&&Array.isArray(_geoParkLog))?_geoParkLog.map(function(n){return n.t+'|'+n.ev+'|'+n.x;}):[];}catch(e){return [];}})()`;
  const NOTE_SINCE = `(function(seen){try{if(typeof _geoParkLog==='undefined'||!Array.isArray(_geoParkLog))return [];var s=new Set(seen);return _geoParkLog.filter(function(n){return !s.has(n.t+'|'+n.ev+'|'+n.x);}).map(function(n){return n.ev+(n.x?': '+n.x:'');});}catch(e){return [];}})`;

  // ── Park detection ──────────────────────────────────────────────────────────

  // Seed one job, open a drive 20 minutes ago, and park OUTSIDE the strict
  // fence but inside fence + 350ft: two stationary fixes with the cluster
  // clock rewound 5 minutes between them resolve the park. Shared by the
  // arrival and release tests; returns everything asserted on.
  const parkAtJob = (jobId) => page.evaluate(async (jid) => {
    window.__origJobs = jobs.slice(); jobs.length = 0;
    const JOB = { lat: 37.6872, lon: -97.3301 };
    jobs.push({ id: jid, name: 'Park Job', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
    _geoJobCoords = {};
    S.officeLat = null; S.officeLon = null;
    // A drive already 20 minutes underway, with a real far-away origin so the
    // fence-bounce guard (same-spot, <400ft) can never eat the leg.
    _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
    _geoLegOrigin = { lat: 37.7500, lng: -97.4500, name: 'Shop', kind: 'shop', addr: '1 Yard Rd' };
    // Parked spot: read the fence at runtime, sit 150ft beyond it (outside the
    // strict fence, inside the +350ft wander margin).
    const fence = _geoFenceFt();
    const spot = { lat: JOB.lat + (fence + 150) / 364584, lng: JOB.lon };
    const spotFt = _geoDistFt(spot, { lat: JOB.lat, lng: JOB.lon });
    const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
    await ping(spot, 0);
    const clusterAfterFirst = _geoParkCluster ? { n: _geoParkCluster.n } : null;
    // The truck has been sitting here 5 minutes (rewind the cluster's birth,
    // the same backdating pattern the suite uses on _geoStopAnchor.at).
    if (_geoParkCluster) _geoParkCluster.sinceMs = Date.now() - 5 * 60000;
    await ping(spot, 0);
    await new Promise(res => setTimeout(res, 60));
    const driveRow = (window.__rec.upserts.find(u => u.tbl === 'job_time_entries' && /^drive/.test(u.row.source || '')) || {}).row || null;
    return {
      fence, spotFt, clusterAfterFirst, spot,
      // The PAGE's clock, returned so the backdating assertion below compares
      // two readings of the same clock. tests/helpers.js pins the page to a
      // fixed Central time and the Node test runner is NOT pinned, so an
      // assertion that reads Date.now() on the Node side is comparing two
      // different clocks and means nothing (webkit and chromium shard 6,
      // 2026-08-26: nine hours apart, so it failed outright).
      now: Date.now(),
      cur: _geoCurrentJob, arrivedAt: _geoArrivedAt, softJob: _geoSoftJob,
      driveOpen: _geoDriveStartedAt != null, driveRow,
    };
  }, jobId);

  const restoreJobs = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    _geoJobCoords = {};
  });



  test('park no-match: parking nowhere near any job leaves the stop machinery alone', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      window.__origJobs = jobs.slice(); jobs.length = 0; // no jobs at all today
      _geoJobCoords = {};
      S.officeLat = null; S.officeLon = null;
      _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
      _geoLegOrigin = { lat: 37.7500, lng: -97.4500, name: 'Shop', kind: 'shop' };
      const spot = { lat: 38.9000, lng: -96.9000 };
      const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
      await ping(spot, 0);
      if (_geoParkCluster) _geoParkCluster.sinceMs = Date.now() - 5 * 60000;
      await ping(spot, 0);
      await new Promise(res => setTimeout(res, 60));
      return {
        cur: _geoCurrentJob, soft: _geoSoftJob, backdate: _geoParkBackdate,
        cluster: !!_geoParkCluster, anchor: !!_geoStopAnchor,
        jobRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && /^geofence/.test(u.row.source || '')).length,
      };
    });
    expect(r.cur).toBeNull();               // never treated as a job arrival
    expect(r.soft).toBeNull();
    expect(r.backdate).toBeNull();          // nothing armed to leak onto a later entry
    expect(r.jobRows).toBe(0);
    expect(r.cluster, 'the cluster stays, later pings just re-check').toBe(true);
    expect(r.anchor, 'the anonymous-stop machinery still owns this park').toBe(true);
    await restoreJobs();
    await geoRestore();
  });

  // ── Park detection: the Shop (owner report 2026-08-22) ──────────────────────
  // A job parked outside its strict fence already got a +350ft forgiving
  // margin (above); the Shop never did, only the raw 600ft check on every
  // ping. A Shop/Home-office account whose actual parking spot (a driveway, a
  // detached garage, a second building) sits past that circle never
  // registered a Shop dwell at all, leaving the day's drive back there
  // orphaned with nothing to prove they'd returned. Same harness as
  // parkAtJob above, for the Shop instead.
  const parkAtShop = () => page.evaluate(async () => {
    window.__origJobs = jobs.slice(); jobs.length = 0;   // no jobs today: only the Shop can match
    _geoJobCoords = {};
    const SHOP = { lat: 37.6872, lon: -97.3301 };
    S.officeLat = SHOP.lat; S.officeLon = SHOP.lon;
    _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
    _geoLegOrigin = { lat: 37.7500, lng: -97.4500, name: 'Ace Supply', kind: 'place' };
    const fence = _geoFenceFt();
    const spot = { lat: SHOP.lat + (fence + 150) / 364584, lng: SHOP.lon };
    const spotFt = _geoDistFt(spot, { lat: SHOP.lat, lng: SHOP.lon });
    const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
    await ping(spot, 0);
    const clusterAfterFirst = _geoParkCluster ? { n: _geoParkCluster.n } : null;
    if (_geoParkCluster) _geoParkCluster.sinceMs = Date.now() - 5 * 60000;
    await ping(spot, 0);
    await new Promise(res => setTimeout(res, 60));
    const driveRow = (window.__rec.upserts.find(u => u.tbl === 'job_time_entries' && /^drive/.test(u.row.source || '')) || {}).row || null;
    return {
      fence, spotFt, clusterAfterFirst, spot,
      now: Date.now(),   // the page's clock, same reason as parkAtJob above
      wasInShop: _geoWasInShop, shopArrivedAt: _geoShopArrivedAt, softShop: _geoSoftShop,
      driveOpen: _geoDriveStartedAt != null, driveRow,
    };
  });

  const restoreShop = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    _geoJobCoords = {};
    S.officeLat = null; S.officeLon = null;
  });



  test('park priority: when a job AND the Shop are both in reach, the job wins, matching live strict-fence priority', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      const SHOP = { lat: 37.6872, lon: -97.3301 };
      const JOB = { lat: 37.6872, lon: -97.3301 };   // same property: a job fenced right at the shop
      jobs.push({ id: 885201, name: 'Job At The Shop', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      _geoJobCoords = {};
      S.officeLat = SHOP.lat; S.officeLon = SHOP.lon;
      _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
      _geoLegOrigin = { lat: 37.7500, lng: -97.4500, name: 'Ace Supply', kind: 'place' };
      const fence = _geoFenceFt();
      const spot = { lat: SHOP.lat + (fence + 150) / 364584, lng: SHOP.lon };
      const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
      await ping(spot, 0);
      if (_geoParkCluster) _geoParkCluster.sinceMs = Date.now() - 5 * 60000;
      await ping(spot, 0);
      await new Promise(res => setTimeout(res, 60));
      return { cur: _geoCurrentJob, wasInShop: _geoWasInShop, softJob: _geoSoftJob, softShop: _geoSoftShop };
    });
    expect(String(r.cur), 'a job always outranks the Shop when both are in reach').toBe('885201');
    expect(r.wasInShop).toBe(false);
    expect(r.softJob && String(r.softJob.id)).toBe('885201');
    expect(r.softShop).toBeNull();
    await restoreShop();
    await geoRestore();
  });

  test('park no-match: the Shop is set but out of reach, the anonymous-stop machinery still owns the park', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      _geoJobCoords = {};
      S.officeLat = 37.6872; S.officeLon = -97.3301;   // the Shop exists, just nowhere near this park
      _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
      _geoLegOrigin = { lat: 37.7500, lng: -97.4500, name: 'Ace Supply', kind: 'place' };
      const spot = { lat: 38.9000, lng: -96.9000 };
      const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
      await ping(spot, 0);
      if (_geoParkCluster) _geoParkCluster.sinceMs = Date.now() - 5 * 60000;
      await ping(spot, 0);
      await new Promise(res => setTimeout(res, 60));
      return {
        wasInShop: _geoWasInShop, softShop: _geoSoftShop, backdate: _geoParkBackdate,
        cluster: !!_geoParkCluster, anchor: !!_geoStopAnchor,
      };
    });
    expect(r.wasInShop).toBe(false);
    expect(r.softShop).toBeNull();
    expect(r.backdate).toBeNull();
    expect(r.cluster, 'the cluster stays, later pings just re-check').toBe(true);
    expect(r.anchor, 'the anonymous-stop machinery still owns this park').toBe(true);
    await restoreShop();
    await geoRestore();
  });

  // ── Reconciliation ──────────────────────────────────────────────────────────

  // Two auto legs anchored at the same job: A arrives at T-3h, B leaves from
  // the same spot at T-1h, so the 2-hour window between them is on-site time.
  // Seeds the job + mileage and snapshots what it replaced.
  const seedReconPair = (jobId, opts) => page.evaluate(([jid, o]) => {
    window.__origJobs = jobs.slice(); jobs.length = 0;
    window.__origMileage = mileage.slice(); mileage.length = 0;
    window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
    const JOB = { lat: 37.6872, lon: -97.3301 };
    _geoJobCoords = {};
    // Anchor the whole seeded span inside ONE Central calendar day: the
    // reconciler's honesty rule refuses windows that cross midnight, so a
    // raw Date.now() anchor makes this seed flaky for any CI run in the
    // small hours (same determinism fix the overnight test already got).
    let T = Date.now();
    const gapHrs = (o && o.gapHrs) || 2;
    while (_bizDateStr(new Date(T - (gapHrs + 2) * 3600000)) !== _bizDateStr(new Date(T))) T -= 4 * 3600000;
    // The job is dated to the WINDOW'S day (its Central day-key), which is
    // what the reconciler's day-scoped job match compares against.
    jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _bizDateStr(new Date(T - (gapHrs + 1) * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
    const iso = (ms) => new Date(ms).toISOString();
    const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - (gapHrs + 2) * 3600000), endedIso: iso(T - (gapHrs + 1) * 3600000),
                fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: _bizDateStr(new Date(T)) };
    const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: _bizDateStr(new Date(T)) };
    mileage.push(A, B);
    return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, jid: String(jid) };
  }, [jobId, opts || {}]);

  const restoreReconSeed = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; }
    if (window.__origTimeEntries) { timeEntries.length = 0; window.__origTimeEntries.forEach(t => timeEntries.push(t)); window.__origTimeEntries = null; }
    _geoJobCoords = {};
  });

  // WAIT FOR THE DRAIN, DO NOT GUESS AT IT.
  //
  // This was `setTimeout(60)`, a guessed number, and 29 tests read their result
  // through it. The enqueue drain is asynchronous, so on a runner that is busy
  // enough the row simply has not landed in the recorder yet when the assertion
  // reads it, and the failure is ZERO rows rather than wrong ones: "expected 1,
  // received 0" (CI shard 2, webkit, 2026-08-30). A test that fails because the
  // machine was slow is not testing the reconciler.
  //
  // So: settle on the CONDITION. Return the moment a reconciled row lands, and
  // otherwise return once the recorder has been quiet for three consecutive
  // polls, which is the same ~60ms of stillness the old sleep was reaching for
  // and is what the handful of tests expecting no rows actually need. The 2s
  // cap keeps a genuinely broken reconciler failing fast instead of hanging.
  // A REFUSED PASS IS NOT A PASS THAT WROTE NOTHING.
  //
  // _geoReconcileFromMileage returns FALSE when it declines to run at all
  // (another pass or a GPS ping in flight), and its own doc comment says so:
  // renderTimeLog retries a couple of times on false for exactly this reason.
  // Both helpers here threw that answer away, so a refused call looked
  // identical to a call that ran and found nothing, and the settle loop below
  // then waited out its 200ms "nothing was ever queued" grace and reported
  // zero rows. Load-dependent by construction, which is why it passes under
  // one file and fails on a shard running five (chromium, 2026-08-31, the
  // third failure in this file with the same "expected 1, received 0"
  // signature; the two before it hardened the WAIT and left this alone).
  //
  // So: retry the call the way production does, and hand the outcome back so
  // a never-ran fails as a never-ran instead of as a wrong assertion.
  const runRecon = () => page.evaluate(async () => {
    // RE-ASSERT THE HARNESS MOCK FIRST.
    //
    // Sixth failure in this file with the same "expected 1, received 0"
    // signature (webkit shard 2, 2026-09-01), and the fifth different theory.
    // The first three hardened the WAIT; the fourth counted the ENQUEUES; all
    // four were downstream of the actual problem, which geoReset's own comment
    // has described the whole time and which only the merge helper ever acted
    // on:
    //
    //   this page lives for the whole ~150-test file and the app can rebuild
    //   its own Supabase client at any moment (supaInit runs on a realtime
    //   reconnect, among other paths), which silently swaps _supa out from
    //   under a test between its seeding step and its call.
    //
    // Every step between geoReset and here is an await point, so there is a
    // real window for that swap. When it happens the reconciler runs
    // correctly and writes through the APP's client instead of this harness:
    // window.__rec never sees the upsert, the enqueue counter (which watches
    // _geoEnqueue, not the client) still counts the work, the settle loop
    // waits out its full 4s, and the helper reports zero rows for a row that
    // was written. `ran` is true because nothing refused, which is why the
    // failure always lands on the row assertion and never on the ran one.
    //
    // That is the whole shape: intermittent, engine- and shard-dependent,
    // never reproducible under one file, and invisible to any amount of extra
    // waiting. One assignment removes it, the same one _geoMergeSweep's helper
    // already makes for the same reason (7.3). mockSwapped is returned rather
    // than silently corrected so a future failure can say which class it is.
    const mockSwapped = !!window.__harnessSupa && window._supa !== window.__harnessSupa;
    if (window.__harnessSupa) window._supa = window.__harnessSupa;
    // COUNT THE ENQUEUES. DO NOT SAMPLE THE QUEUE.
    //
    // Fourth failure in this file with the same "expected 1, received 0"
    // signature (chromium shard 5, 2026-09-01), and the first three all
    // hardened the WAIT: a longer sleep, then stillness polling, then a settle
    // window after the queue drained. Every one of them was the wrong end.
    //
    // The actual defect is that the helper decided "the reconciler queued
    // nothing" by sampling _geoQueueRead().length every 20ms. _geoEnqueue
    // writes the queue synchronously and then kicks off _geoDrainQueue, which
    // shifts the item off and THEN awaits the upsert. If the drain wins that
    // microtask race, the very first poll already reads an empty queue: sawWork
    // never goes true, the 200ms "nothing was ever queued" grace expires, and
    // the helper reports zero rows for a write that was in flight and about to
    // land. Whether it happens is pure scheduling luck, which is why it moves
    // between engines and shards and never reproduces under one file.
    //
    // A count cannot be raced. _geoEnqueue is a top-level function declaration,
    // so it is a property of window and wrapping it is enough to observe every
    // call the reconciler makes. queued > 0 means work exists and the only
    // honest answer is the ROW; queued === 0 means the reconciler genuinely
    // decided to write nothing, which is what the tests expecting zero rows are
    // actually asserting.
    const origEnq = window._geoEnqueue;
    let queued = 0;
    window._geoEnqueue = function () { queued++; return origEnq.apply(this, arguments); };
    try {
      // _geoReconcileFromMileage returns FALSE when it declines to run at all
      // (another pass or a GPS ping in flight), and its own doc comment says so:
      // renderTimeLog retries a couple of times on false for exactly this
      // reason. This used to throw that answer away, so a refused call looked
      // identical to a call that ran and found nothing. Retry the way
      // production does, and hand the outcome back so a never-ran fails as a
      // never-ran instead of as a wrong assertion.
      const ran = await (async () => {
        for (let i = 0; i < 40; i++) {
          if (await _geoReconcileFromMileage() !== false) return true;
          await new Promise(res => setTimeout(res, 25));
        }
        return false;
      })();
      const rows = () => window.__rec.upserts.filter(u =>
        u.tbl === 'job_time_entries' && (u.row.source || '') === 'geofence-reconciled');
      for (let i = 0; i < 200; i++) {          // 4s cap: a broken reconciler still fails fast
        if (rows().length) break;              // the write landed, the only real success
        if (!queued && i >= 10) break;         // 200ms and the reconciler queued nothing at all
        await new Promise(res => setTimeout(res, 20));
      }
      return {
        ran, mockSwapped, queued,
        recRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && (u.row.source || '') === 'geofence-reconciled').map(u => u.row),
        updates: window.__rec.updates.slice(),
      };
    } finally { window._geoEnqueue = origEnq; }
  });

  // ── The claim is checked against the breadcrumbs we already keep ──────────
  //
  // Owner, 2026-08-25: "I thought you already have shit built to reconcile
  // versus actual gps points and geofences arrival and departure, why can't we
  // use what we have already versus more ai slop code."
  //
  // Right, and the gap was real. location_pings has held a lat/lon breadcrumb
  // for every fix for 90 days and the reconciler never read it: it matched a
  // job by where ONE mileage leg ended, then claimed the whole gap to the next
  // leg as time on site. On 2026-08-24 that billed 541 minutes to one job while
  // 217 recorded pings walk Topeka to Kansas City to Colorado to Salt Lake.
  //
  // Fence margin here is _geoFenceFt() 600 + _GEO_PARK_JOB_EXTRA_FT 350 = 950ft,
  // the same figure the live machine uses. Offsets below are in degrees of
  // latitude, roughly 364,000ft per degree.
  const JOB_AT = { lat: 37.6872, lng: -97.3301 };
  const seedPings = (list) => page.evaluate((l) => { window.__selPings = l; }, list);
  // Fixes at EXACT minute offsets from the arrival, which pingsAcross cannot
  // express. Needed because the rule now ignores anything within 10 minutes of
  // either anchor, and the real-world tape puts its only fixes right there.
  const pingsAt = (seed, specs) => {
    const t1 = Date.parse(seed.A.endedIso);
    return specs.map(sp => ({
      ts: new Date(t1 + sp.min * 60000).toISOString(),
      lat: JOB_AT.lat + (sp.dLat || 0), lon: JOB_AT.lng, accuracy: sp.acc == null ? 8 : sp.acc,
    }));
  };
  // Fixes evenly spread across the window, so a test can say "on site for the
  // first quarter, then gone" without hand-computing timestamps.
  const pingsAcross = (seed, specs) => {
    const t1 = Date.parse(seed.A.endedIso), t2 = Date.parse(seed.B.startedIso);
    return specs.map((sp, i) => ({
      ts: new Date(t1 + Math.round((t2 - t1) * ((i + 1) / (specs.length + 1)))).toISOString(),
      lat: JOB_AT.lat + (sp.dLat || 0), lon: JOB_AT.lng + (sp.dLng || 0),
      accuracy: sp.acc == null ? 8 : sp.acc,
    }));
  };























  // ── Client-address reconciliation (owner report 2026-08-21) ─────────────
  // A client visit's arrival clock has no crash/reload durability at all
  // (_geoPersistOpen/_geoRestoreOpen only ever covered job/shop/drive state),
  // so a mid-visit reload silently resets it to "now" with the real hours
  // gone from memory. The mileage legs bounding the SAME visit are durable
  // (queued before any reload could touch them), so the fix is the exact
  // pattern already proven for jobs: no job scheduled anywhere explains the
  // window, but a client's cached geocode does, so the reconciler now tries
  // a client as a fallback and writes the SAME shape a live client close
  // already uses (_geoCloseClientEntry: job_id null, dest_place, source
  // 'place') tagged 'place-reconciled' to keep it diagnosable from a live one.
  const seedReconClientPair = (clientId, opts) => page.evaluate(([cid, o]) => {
    window.__origJobs = jobs.slice(); jobs.length = 0;
    window.__origClients = clients.slice(); clients.length = 0;
    window.__origMileage = mileage.slice(); mileage.length = 0;
    window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
    window.__origNearbyCache = localStorage.getItem('zp3_nearby_geo');
    const CL = { lat: 37.6872, lon: -97.3301 };
    const addr = '123 Client St';
    clients.push({ id: cid, name: 'Recon Client', addr });
    localStorage.setItem('zp3_nearby_geo', JSON.stringify({ [cid]: { lat: CL.lat, lon: CL.lon, addr } }));
    let T = Date.now();
    const gapHrs = (o && o.gapHrs) || 2;
    while (_bizDateStr(new Date(T - (gapHrs + 2) * 3600000)) !== _bizDateStr(new Date(T))) T -= 4 * 3600000;
    const iso = (ms) => new Date(ms).toISOString();
    const A = { id: 'mlc-A', gps: true, legKey: 'lgcA-' + cid, startedIso: iso(T - (gapHrs + 2) * 3600000), endedIso: iso(T - (gapHrs + 1) * 3600000),
                fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: CL.lat, lng: CL.lon }, miles: 9, date: _bizDateStr(new Date(T)) };
    const B = { id: 'mlc-B', gps: true, legKey: 'lgcB-' + cid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                fromCoord: { lat: CL.lat, lng: CL.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: _bizDateStr(new Date(T)) };
    mileage.push(A, B);
    return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, cid: String(cid) };
  }, [clientId, opts || {}]);

  const restoreReconClientSeed = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    if (window.__origClients) { clients.length = 0; window.__origClients.forEach(c => clients.push(c)); window.__origClients = null; }
    if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; }
    if (window.__origTimeEntries) { timeEntries.length = 0; window.__origTimeEntries.forEach(t => timeEntries.push(t)); window.__origTimeEntries = null; }
    if (window.__origNearbyCache == null) localStorage.removeItem('zp3_nearby_geo'); else localStorage.setItem('zp3_nearby_geo', window.__origNearbyCache);
    window.__origNearbyCache = undefined;
    _geoJobCoords = {};
  });

  const runReconClient = () => page.evaluate(async () => {
    // Same contract, same defect, same fix: see the note on runRecon above.
    // This one still sampled the queue and so carried the identical blind spot,
    // which is why 10.4 says fix every place that asserts the same behaviour and
    // not just the one that happened to go red. The client-swap class is that
    // same story a second time: this helper drives the same sweep across the
    // same await points, so it needs the same re-assertion, and it needs it
    // BEFORE the enqueue wrapper so a swap can never sit between the two.
    const mockSwapped = !!window.__harnessSupa && window._supa !== window.__harnessSupa;
    if (window.__harnessSupa) window._supa = window.__harnessSupa;
    const origEnq = window._geoEnqueue;
    let queued = 0;
    window._geoEnqueue = function () { queued++; return origEnq.apply(this, arguments); };
    try {
      const ran = await (async () => {
        for (let i = 0; i < 40; i++) {
          if (await _geoReconcileFromMileage() !== false) return true;
          await new Promise(res => setTimeout(res, 25));
        }
        return false;
      })();
      const rows = () => window.__rec.upserts.filter(u =>
        u.tbl === 'job_time_entries' && (u.row.source || '') === 'place-reconciled');
      for (let i = 0; i < 200; i++) {
        if (rows().length) break;
        if (!queued && i >= 10) break;
        await new Promise(res => setTimeout(res, 20));
      }
      return { ran, mockSwapped, queued, recRows: rows().map(u => u.row) };
    } finally { window._geoEnqueue = origEnq; }
  });



  // ── _geoAwaitQueueDrained (owner report 2026-08-21) ──────────────────────
  // _geoEnqueue's own drain is fire-and-forget by design (a write must never
  // block on network), so a dedup pass launched immediately after enqueueing
  // reconciliation writes used to race those exact writes and read the
  // server before they landed: the SAME window got written twice, 90 seconds
  // apart, with no dedup cleanup in between (the owner's own live diagnostic
  // paste). This closes that race with a bounded wait for the queue to
  // actually finish before dedup runs.
  test('_geoAwaitQueueDrained: resolves immediately when nothing is queued', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      const t0 = Date.now();
      const ok = await _geoAwaitQueueDrained(4000);
      return { ok, ms: Date.now() - t0 };
    });
    expect(r.ok).toBe(true);
    expect(r.ms, 'no reason to wait out the timeout when the queue is already empty').toBeLessThan(1000);
    await geoRestore();
  });

  test('_geoAwaitQueueDrained: waits for _geoDrainBusy to clear before returning true', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      _geoDrainBusy = true;
      setTimeout(() => { _geoDrainBusy = false; }, 300);
      const t0 = Date.now();
      const ok = await _geoAwaitQueueDrained(4000);
      return { ok, ms: Date.now() - t0 };
    });
    expect(r.ok).toBe(true);
    expect(r.ms, 'actually waited for the busy flag to clear, not a no-op').toBeGreaterThanOrEqual(250);
    await geoRestore();
  });

  test('_geoAwaitQueueDrained: gives up at the bound rather than hanging forever', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      _geoDrainBusy = true; // never clears
      const t0 = Date.now();
      const ok = await _geoAwaitQueueDrained(500);
      _geoDrainBusy = false;
      return { ok, ms: Date.now() - t0 };
    });
    expect(r.ok, 'times out honestly rather than resolving true on a stuck queue').toBe(false);
    expect(r.ms).toBeGreaterThanOrEqual(450);
    await geoRestore();
  });

  // ── _geoDrainQueue: the already-written duplicate must never block the
  // queue, AND must never silently discard a newer, more complete
  // recompute (owner report 2026-08-21, live device, two rounds) ──────────
  // job_time_entries_ckey_uq is a PARTIAL unique index, so PostgREST's
  // on_conflict can never target it: the first upsert attempt fails with
  // "constraint" on every single row, always (not an edge case), which is
  // exactly what the plain-insert fallback exists to route around. But if
  // THAT row's own client_key was already written by an earlier successful
  // pass, the plain insert collides with the same partial index and throws
  // its own "duplicate key value violates unique constraint" error, one the
  // drain loop had no handling for: it broke and left every row enqueued
  // after it permanently stuck (round one: the owner's live diagnostic
  // showed 71 pending rows and the exact error text below). Round two, live
  // an hour later: a same-key duplicate isn't always a re-send of the SAME
  // window, a still-open visit's window is keyed on its ARRIVAL leg and
  // grows as later mileage legs arrive, so a duplicate can mean "a newer,
  // more complete recompute of the same visit." The fix is an UPDATE keyed
  // on (contractor_user_id, client_key), never a no-op.
  test('_geoDrainQueue: a duplicate-key error on our own client_key UPDATEs the row instead of blocking or discarding it', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      localStorage.setItem('zp3_geo_queue', JSON.stringify([
        { tbl: 'job_time_entries', row: { contractor_user_id: 'geo-park-user-1', employee_user_id: 'geo-park-user-1', job_id: '77', arrived_at: '2026-08-21T12:55:00.000Z', departed_at: '2026-08-21T22:07:00.000Z', minutes: 551, dest_place: null, client_key: 'rec-dup1', source: 'geofence-reconciled' } },
      ]));
      window.__origSupaDrain = window._supa;
      window._supa = {
        from: (tbl) => ({
          upsert: () => Promise.resolve({ error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } }),
          insert: () => Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "job_time_entries_ckey_uq"' } }),
          update: (patch) => {
            const rec = { tbl, patch, filters: {} };
            window.__rec.updates.push(rec);
            const q = { eq: (col, val) => { rec.filters[col] = val; return q; },
                        then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej) };
            return q;
          },
        }),
      };
      await _geoDrainQueue();
      const result = { lastError: _geoQueueLastError, pending: _geoQueueRead().length, updates: window.__rec.updates.slice() };
      window._supa = window.__origSupaDrain;
      return result;
    });
    expect(r.lastError, 'a duplicate on our own key is durability already achieved, not a failure').toBe(null);
    expect(r.pending, 'the item is removed, nothing left stuck behind it').toBe(0);
    expect(r.updates.length, 'the collision triggers an UPDATE, not a silent no-op').toBe(1);
    expect(r.updates[0].filters, 'matched on the deterministic key, never a bare table-wide update').toEqual({ contractor_user_id: 'geo-park-user-1', client_key: 'rec-dup1' });
    expect(r.updates[0].patch.minutes, 'the newer, more complete recompute wins, the stale row does not').toBe(551);
    expect(r.updates[0].patch.departed_at).toBe('2026-08-21T22:07:00.000Z');
    expect(r.updates[0].patch.contractor_user_id, 'the match keys never ride along inside the patch itself').toBeUndefined();
    expect(r.updates[0].patch.client_key).toBeUndefined();
    await geoRestore();
  });

  test('_geoDrainQueue: a genuine unrelated error still stops the queue and records why', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      localStorage.setItem('zp3_geo_queue', JSON.stringify([
        { tbl: 'job_time_entries', row: { contractor_user_id: 'geo-park-user-1', employee_user_id: 'geo-park-user-1', job_id: '77', arrived_at: new Date().toISOString(), departed_at: new Date().toISOString(), minutes: 5, client_key: 'rec-dup2', source: 'geofence-reconciled' } },
      ]));
      window.__origSupaDrain = window._supa;
      window._supa = {
        from: (tbl) => ({
          upsert: () => Promise.resolve({ error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } }),
          insert: () => Promise.resolve({ error: { message: 'permission denied for table job_time_entries' } }),
        }),
      };
      await _geoDrainQueue();
      const result = { lastError: _geoQueueLastError, pending: _geoQueueRead().length };
      window._supa = window.__origSupaDrain;
      return result;
    });
    expect(r.lastError, 'a real failure still surfaces, this fix only excuses OUR OWN duplicate key').not.toBe(null);
    expect(r.pending, 'the item stays queued to retry, never silently dropped').toBe(1);
    await geoRestore();
  });

  // ── _geoDedupTimeEntries (owner rule 2026-08-21) ─────────────────────────
  // The replacement for the removed coverage-check: same job/place + person +
  // overlapping windows collapses to the longest, mirroring _mileDedupTrips
  // for mileage. Runs against the server directly (no local job_time_entries
  // array like mileage has), so these seed window.__selRows as the server's
  // current rows and assert on window.__rec.deletes.
  const dedupCall = () => page.evaluate(async () => {
    window.__rec.deletes.length = 0; window.__rec.updates.length = 0; window.__rec.inserts.length = 0;
    const dropped = await _geoDedupTimeEntries();
    return { dropped, deletes: window.__rec.deletes.slice(), updates: window.__rec.updates.slice(), inserts: window.__rec.inserts.slice() };
  });
















  // ── _geoMergeAdjacentVisits (owner rule 2026-08-23) ──────────────────────
  // "See all the John Doe stuff? From 7:55 am - 11:37 am those can all be
  // merged... that's the reconciliation I want." Unlike _geoDedupTimeEntries
  // above (which only fires on real time OVERLAP), this fires on ADJACENCY:
  // same person, same resolved place (job_id resolved to its client name via
  // _tlJobClientInfo, or the raw dest_place text), gap at or under the
  // true-back-to-back floor. Same recording _supa/window.__selRows harness.
  const mergeCallRaw = () => page.evaluate(async () => {
    window.__rec.deletes.length = 0; window.__rec.updates.length = 0;
    // Merge is live again in the boot settle chain (js/geo-track.js
    // _geoTimeEntriesSettleChain), so a background pass can be mid-flight
    // holding _geoMergeBusy when a test drives the function directly, and
    // the re-entrancy guard then returns 0 without doing anything (CI shard
    // 6, 2026-08-24: zero deletes on a pair that merges every time in
    // isolation). While it was disabled no competing pass existed, which is
    // why this only started flaking now. Wait it out, then force-clear:
    // same wait-then-clear shape geoReset already uses for these flags.
    const t0 = Date.now();
    while (typeof _geoMergeBusy !== 'undefined' && _geoMergeBusy && Date.now() - t0 < 2000) {
      await new Promise(res => setTimeout(res, 10));
    }
    if (typeof _geoMergeBusy !== 'undefined') _geoMergeBusy = false;
    // Re-assert the harness mock (see the note in geoReset): the wait above
    // is an await point, so anything that rebuilds the app's Supabase client
    // gets a window to swap it in right here, between seeding and the call.
    const mockWasSwapped = !!window.__harnessSupa && window._supa !== window.__harnessSupa;
    if (window.__harnessSupa) window._supa = window.__harnessSupa;
    // The rewritten merge consults the live mileage array for gap evidence;
    // park it empty for the call so unrelated suite data can never block or
    // allow a merge. Tests that WANT a leg in the gap seed it themselves
    // via window.__mergeTestLegs.
    const saved = (typeof mileage !== 'undefined') ? mileage.slice() : null;
    if (saved) { mileage.length = 0; (window.__mergeTestLegs || []).forEach(m => mileage.push(m)); }
    // The last two unknowns, captured at the moment of the call rather than
    // inferred afterwards: whether the re-entrancy guard was actually clear,
    // and how many rows the harness mock hands back for the very select the
    // sweep is about to make.
    const busyAtCall = (typeof _geoMergeBusy !== 'undefined') ? _geoMergeBusy : null;
    let mockRows = null;
    try { const probe = await _supa.from('job_time_entries').select('id').eq('contractor_user_id', 'x').gte('arrived_at', 'x');
      mockRows = (probe && Array.isArray(probe.data)) ? probe.data.length : -1; } catch (e) { mockRows = -2; }
    const noteSeen = window.__noteSnap();
    let changed;
    try { changed = await _geoMergeAdjacentVisits(); }
    finally { if (saved) { mileage.length = 0; saved.forEach(m => mileage.push(m)); } window.__mergeTestLegs = null; }
    // A throw inside the sweep used to vanish into its catch and read exactly
    // like an empty result; it now records 'time-merge-err' and this surfaces it.
    const notes = window.__noteSince(noteSeen);
    // rowsSeen/mockWasSwapped ride along so a future failure names its own
    // cause instead of only reporting a zero count.
    return { changed, deletes: window.__rec.deletes.slice(), updates: window.__rec.updates.slice(),
      rowsSeen: (window.__selRows || []).length, mockWasSwapped, selErr: window.__selErr || null,
      busyAtCall, mockRows, notes };
  });
  // Preconditions belong to the HARNESS, not copy-pasted into ten merge tests:
  // whichever one happens to be running when interference lands is the one that
  // fails, so every call has to be able to explain itself. Throws with the
  // whole picture rather than letting the test report a bare zero.
  const mergeCall = async () => {
    const r = await mergeCallRaw();
    const bad = [];
    if (r.mockWasSwapped) bad.push('the harness Supabase mock was swapped out before the call');
    if (r.selErr) bad.push('a simulated fetch error was still set: ' + JSON.stringify(r.selErr));
    if (r.busyAtCall) bad.push('the re-entrancy guard was still held at call time');
    if (r.mockRows !== r.rowsSeen) bad.push('the mock returned ' + r.mockRows + ' rows for its own select but __selRows holds ' + r.rowsSeen);
    const errs = (r.notes || []).filter(n => /err/.test(n));
    if (errs.length) bad.push('the sweep swallowed a throw: ' + errs.join(' | '));
    if (bad.length) throw new Error('merge harness precondition failed: ' + bad.join('; ') +
      ' [rowsSeen=' + r.rowsSeen + ' mockRows=' + r.mockRows + ' busy=' + r.busyAtCall +
      ' changed=' + r.changed + ' notes=' + JSON.stringify(r.notes) + ']');
    return r;
  };




















  // ── _geoAbsorbGapsIntoStops (owner rule 2026-08-23) ──────────────────────
  // Owner screenshot, 2026-08-23: a clean 4m33s hole between "Clock Out
  // 11:37 AM" on a job card and "Clock In 11:42 AM" on the Unpaid card next
  // to it, no mileage leg, no drive row, nothing on record for that
  // stretch. Confirmed via SQL that departed_at is the GPS-confirmed exit
  // moment, not a guess: the owner's call was that stretch belongs to the
  // adjacent unpaid stop, never silently invisible. Same recording _supa
  // harness as merge/dedup above.
  const gapCall = () => page.evaluate(async () => {
    window.__rec.updates.length = 0;
    const changed = await _geoAbsorbGapsIntoStops();
    return { changed, updates: window.__rec.updates.slice() };
  });










  // ── _geoSyncDriveTimeEntries (owner rule 2026-08-22) ─────────────────────
  // Paid drive time must match a leg mileage itself would still stand
  // behind: _geoDriveEntry mints ONE legKey and stamps it on both the
  // job_time_entries row (client_key) and the mileage row (legKey), so this
  // is a straight comparison against the local, already-deduped/collapsed
  // mileage array, never a re-derivation. Same harness as the dedup tests
  // above (window.__selRows feeds the server rows), plus seeding the local
  // `mileage` array the way the reconciliation tests below already do.
  const syncCall = () => page.evaluate(async () => {
    window.__rec.deletes.length = 0;
    const dropped = await _geoSyncDriveTimeEntries();
    return { dropped, deletes: window.__rec.deletes.slice() };
  });















  // ── _geoDedupShopTimeEntries (owner audit 2026-08-23) ────────────────────
  // shop_time_entries never had ANY dedup coverage: same twin-write race as
  // job_time_entries, just on the shop table, and no other sweep touches it.
  const shopDedupCall = () => page.evaluate(async () => {
    window.__rec.deletes.length = 0;
    const dropped = await _geoDedupShopTimeEntries();
    return { dropped, deletes: window.__rec.deletes.slice() };
  });






  // ── _milePersonalStopSweep: unnamed 'Stop' legs (owner report 2026-08-22) ──
  // A durable, on-load sweep pairing two adjacent completed mileage rows
  // (leg IN to a waypoint, leg OUT of the same waypoint) and deciding if the
  // waypoint was business or personal. Used to bail immediately whenever the
  // waypoint's name was literally the 'Stop' placeholder (unresolved POI),
  // on the theory that _geoCollapseDetours (js/geo-track.js) already owns
  // that case live. It doesn't when the app gets backgrounded/killed mid
  // stop, which breaks _geoCollapseDetours' in-memory origin chain, the
  // exact live shape of the owner's report: a Shop -> Stop leg saved to
  // mileage that should have collapsed. This sweep is the only other thing
  // that ever re-examines a closed pair, so it must not skip unnamed ones.
  // Seeds with the guard LOCKED (true), not cleared. js/cloud.js's own
  // reconnect handler fires _milePersonalStopSweep() in the background (line
  // ~7888), and this file boots the FULL app, so a stray reconnect landing
  // anywhere between this seed and the test's own sweepCall() (across the
  // real IPC round-trips of setLastFence, etc.) can find the freshly-seeded
  // rows AND already-set fence vars, do the fix ITSELF, and leave sweepCall's
  // own count at 0 with nothing left to find (CI flake 2026-08-23: resetting
  // the guard only inside sweepCall wasn't enough, the mutation already
  // happened by then). Locked here, unlocked only inside sweepCall's own
  // evaluate in the same synchronous tick as the call it guards, so nothing
  // else can ever run against this test's seeded state first.
  // Everything _milePersonalStopSweep's "is this actually business" test can
  // consult has to be emptied, or a leftover from an earlier test in this
  // shared page decides the verdict. `places` was the one missing: the sweep
  // protects a stop sitting on a saved BUSINESS place (placeAt, js/places.js),
  // `places` is a global this file's place-visit tests write, and nothing here
  // was putting it back. A saved place near the fixture pin then made the
  // sweep correctly refuse to collapse a leg the test had every reason to
  // expect collapsed, intermittently, depending on which tests ran first
  // (CI shard 6 and locally, 2026-08-24). `bids` rides along because a job's
  // own bid address is part of the same business test.
  const stopSweepSeed = (rows) => page.evaluate((rows) => {
    window.__origMileage = mileage.slice(); mileage.length = 0;
    window.__origJobs = jobs.slice(); jobs.length = 0;
    window.__origClients = clients.slice(); clients.length = 0;
    window.__origExpenses = expenses.slice(); expenses.length = 0;
    window.__origPlaces = places.slice(); places.length = 0;
    window.__origBids = bids.slice(); bids.length = 0;
    window._milePersonalSweepRan = true;
    rows.forEach(r => mileage.push(r));
  }, rows);
  const stopSweepRestore = () => page.evaluate(() => {
    if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; }
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    if (window.__origClients) { clients.length = 0; window.__origClients.forEach(c => clients.push(c)); window.__origClients = null; }
    if (window.__origExpenses) { expenses.length = 0; window.__origExpenses.forEach(e => expenses.push(e)); window.__origExpenses = null; }
    if (window.__origPlaces) { places.length = 0; window.__origPlaces.forEach(p => places.push(p)); window.__origPlaces = null; }
    if (window.__origBids) { bids.length = 0; window.__origBids.forEach(b => bids.push(b)); window.__origBids = null; }
  });
  // Unlocks the guard stopSweepSeed locked, sets the fence position (when a
  // pass-2 test needs one), then calls, ALL in one synchronous tick: no
  // await separates any of these from the call below, so nothing else can
  // interleave. A prior version set the fence via a separate setLastFence()
  // round-trip before this call; that left a real await gap between "fence
  // set" and "sweep runs" for something else (a live ping handler writing
  // _geoLastFenceLoc, js/geo-track.js ~line 1310, this file boots the FULL
  // app) to land in and change the fence out from under this call (CI flake
  // 2026-08-23, round two: the seed-time guard lock fixed the first
  // interference source, this closes a second, different one). Optional
  // `fence` is {loc, atIso}; when passed, the ORIGINAL fence is saved for
  // restoreLastFence() to put back, exactly like setLastFence used to.
  const sweepCall = (fence) => page.evaluate(async (fence) => {
    if (fence) {
      window.__origLastFenceLoc = _geoLastFenceLoc; window.__origLastFenceAt = _geoLastFenceAt;
      _geoLastFenceLoc = fence.loc; _geoLastFenceAt = fence.atIso;
    }
    window._milePersonalSweepRan = false;
    // Captured BEFORE the call: this file boots the full app, so a background
    // pass of the same sweep can collapse the seeded row first and leave this
    // call with nothing to do. That reads as a bare "expected 1, got 0" with
    // no hint why (seen locally 2026-08-24). The tests assert on `before`.
    const before = mileage.map(m => m.id);
    // The sweep's own trail ('stop-sweep rows=N') says how many rows it even
    // considered, which separates "returned at the floor" from "considered
    // them and declined". The fence pair is the pass-2 evidence, read back
    // afterwards to prove nothing moved it mid-sweep.
    const noteSeen = window.__noteSnap();
    const fenceBefore = JSON.stringify([_geoLastFenceLoc, _geoLastFenceAt]);
    // Who actually removes the row: five separate gates later the fingerprint
    // was unchanged, so stop inferring and watch the array. Records a stack
    // for every splice that happens while this call is in flight.
    const splices = [];
    const realSplice = mileage.splice;
    mileage.splice = function () {
      try { splices.push(String(new Error('splice').stack || '').split('\n').slice(1, 6).join(' | ')); } catch (e) {}
      return realSplice.apply(this, arguments);
    };
    window.__sweepAllowed = true;
    let fixed;
    try { fixed = await _milePersonalStopSweep(); }
    finally { window.__sweepAllowed = false; mileage.splice = realSplice; }
    const fenceAfter = JSON.stringify([_geoLastFenceLoc, _geoLastFenceAt]);
    const notes = window.__noteSince(noteSeen);
    // Every pass-2 condition, evaluated for the seeded leg exactly as the sweep
    // evaluates it, so a refusal names the clause that refused instead of
    // leaving the next reader to re-derive the whole function.
    // Every pass-2 condition, evaluated for the seeded leg exactly as the sweep
    // evaluates it, plus the surrounding array state, so a refusal names the
    // clause that refused instead of leaving the next reader to re-derive the
    // whole function. Populated even when the leg has vanished, because "it is
    // not in `mileage` any more and nothing here removed it" is itself the
    // answer on a shared page.
    let why = { mileageIds: mileage.map(m => m && m.id), sweepRan: !!window._milePersonalSweepRan,
      placeCount: Array.isArray(places) ? places.length : -1, jobCount: Array.isArray(jobs) ? jobs.length : -1,
      clientCount: Array.isArray(clients) ? clients.length : -1,
      expenseCount: Array.isArray(expenses) ? expenses.length : -1 };
    try {
      const inb = mileage.find(m => m && m.id === 'sw-inb');
      if (inb && fence) {
        const _n = (c1, c2) => !!(c1 && c2 && c1.lat != null && c2.lat != null &&
          _geoDistFt({ lat: c1.lat, lng: c1.lng }, { lat: c2.lat, lng: c2.lng }) <= _MILE_DEDUP_DEST_FT);
        const endedMs = Date.parse(inb.endedIso || inb.loggedAt || '') || 0;
        Object.assign(why, {
          hasPartner: mileage.some(r => r !== inb && _n(inb.toCoord, r.fromCoord)),
          fenceAfterEnd: (Date.parse(_geoLastFenceAt) || 0) > endedMs,
          backAtOrigin: _n(_geoLastFenceLoc, inb.fromCoord),
          name: String(inb.to_name || '').trim(),
          atJob: Array.isArray(jobs) && jobs.some(j => j && j.lat != null && _n({ lat: j.lat, lng: j.lon }, inb.toCoord)),
          atClient: Array.isArray(clients) && clients.some(c => c && c.lat != null && _n({ lat: c.lat, lng: c.lng != null ? c.lng : c.lon }, inb.toCoord)),
          savedPlace: (typeof placeAt === 'function' ? (placeAt({ lat: inb.toCoord.lat, lon: inb.toCoord.lng }) || null) : null),
        });
      }
    } catch (e) { why.probeError = String(e && e.message || e); }
    return { fixed, before, left: mileage.map(m => m.id), notes, fenceBefore, fenceAfter,
      fenceMoved: fenceBefore !== fenceAfter, why, splices };
  }, fence);
  const STOP = { lat: 9.10, lon: 9.10 };
  const SHOPX = { lat: 9.00, lon: 9.00 };
  const BIZX = { lat: 9.50, lon: 9.50 };
  const now = () => Date.now();
  const stopLegRows = () => ([
    { id: 'sw-inb', gps: true, legKey: 'sw-lg-1', fromCoord: { lat: SHOPX.lat, lng: SHOPX.lon }, toCoord: { lat: STOP.lat, lng: STOP.lon },
      from_name: 'Shop', to_name: 'Stop', miles: 3.5, date: todayKeySafe(), startedIso: new Date(now() - 3600000).toISOString(), endedIso: new Date(now() - 3300000).toISOString() },
    { id: 'sw-out', gps: true, legKey: 'sw-lg-2', fromCoord: { lat: STOP.lat, lng: STOP.lon }, toCoord: { lat: SHOPX.lat, lng: SHOPX.lon },
      from_name: 'Stop', to_name: 'Shop', miles: 3.4, date: todayKeySafe(), startedIso: new Date(now() - 3000000).toISOString(), endedIso: new Date(now() - 2700000).toISOString() },
  ]);
  function todayKeySafe() { return new Date().toISOString().slice(0, 10); }
  // A second, unrelated, already-final row so the sweep's own "at least 2
  // eligible rows" floor (nothing to pair yet, try again next load) is met
  // without it ever being swept itself. Protected by client_id, not by its
  // coordinates staying clear of whatever _geoLastFenceLoc a given pass-2
  // test sets: a coordinate-only "control" row collided with the
  // 'somewhere else' test's own fence location (both used BIZX), which made
  // the sweep correctly, if confusingly, collapse the filler instead of
  // leaving it alone. client_id is checked first and never depends on where
  // any test decides the device last was.
  const FILLER = () => ({ id: 'sw-filler', gps: true, legKey: 'sw-lg-filler', client_id: 9999,
    fromCoord: { lat: BIZX.lat, lng: BIZX.lon }, toCoord: { lat: BIZX.lat + 0.5, lng: BIZX.lon + 0.5 },
    from_name: 'Ace Supply', to_name: 'Another Business', miles: 2.0, date: todayKeySafe(),
    startedIso: new Date(now() - 200000).toISOString(), endedIso: new Date(now() - 100000).toISOString() });
  const restoreLastFence = () => page.evaluate(() => {
    _geoLastFenceLoc = window.__origLastFenceLoc; _geoLastFenceAt = window.__origLastFenceAt;
    window.__origLastFenceLoc = null; window.__origLastFenceAt = null;
  });





















  // ── Visit-close idempotency (owner report 2026-08-21) ───────────────────────
  // _geoLegKey already made a re-delivered DRIVE close idempotent (2026-08-11:
  // same person + same leg start = same key, so a replayed native event can't
  // mint a second row). The VISIT closers (job/shop/place/client/stop) never
  // got the same treatment: _geoEnqueue minted a random client_key every call
  // (_geoClientKey()), so the exact live/replay duplicate-delivery bug fixed
  // today for drives (__tdTs) could still double-write a Time Log entry with
  // nothing to catch it, because two different random keys both pass the
  // server's unique (contractor_user_id,client_key) index. This is why GPS
  // mileage self-healed (deterministic legKey + _mileDedupTrips) but Time Log
  // never did: it had no deterministic key to heal around in the first place.
  // _geoVisitKey (person + kind + id + arrived_at) closes that gap the same
  // way _geoLegKey already closed it for drives.
  test.describe('visit-close idempotency: a re-delivered close writes the same client_key twice', () => {





    // Owner rule 2026-08-24: a stop spanning Central midnight is an
    // end-of-day park (truck home for the night), never an unpaid leg of a
    // workday. Writing those rows is what let one calendar day total more
    // than 24 hours once gap-absorb stretched them further.
    test('_geoCloseStop: a stop spanning Central midnight writes NO unpaid row', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        // 01:00Z -> 13:00Z is the SAME UTC day but 8:00pm -> 8:00am across
        // Central midnight: proves the guard uses the app's Central-day
        // convention, not a UTC date compare.
        _geoCloseStop({ at: '2026-08-21T01:00:00.000Z', lastAt: '2026-08-21T13:00:00.000Z', lat: 37.7, lng: -97.3, legClosed: true });
        // Same thing through the not-yet-settled branch.
        _geoCloseStop({ at: '2026-08-21T01:00:00.000Z', lastAt: '2026-08-21T13:00:00.000Z', lat: 37.7, lng: -97.3, legClosed: false });
        await new Promise(res => setTimeout(res, 60));
        const stops = window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && u.row.source === 'stop');
        return { stops: stops.length, skipped: (_geoParkLog || []).some(e => e.ev === 'stop-skip') };
      });
      expect(r.stops, 'no stop row on either branch').toBe(0);
      expect(r.skipped, 'the skip is journaled for the diagnostics panel').toBe(true);
      await geoRestore();
    });


    test('_geoCloseEntry with no departure and no verified ping writes nothing', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        _geoArrivedAt = new Date(Date.now() - 9 * 3600000).toISOString();
        _geoLastFenceAt = null;
        const wrote = await _geoCloseEntry('job-no-ping');
        await new Promise(res => setTimeout(res, 60));
        return { wrote, rows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries').length,
                 skipped: (_geoParkLog || []).some(e => e.ev === 'close-skip') };
      });
      expect(r.wrote).toBe(false);
      expect(r.rows, 'an unobserved span is never invented').toBe(0);
      expect(r.skipped, 'the skip is journaled for the diagnostics panel').toBe(true);
      await geoRestore();
    });

    test('_geoStopCrossesMidnight: same Central day false, across false-midnight (UTC) true', async () => {
      const r = await page.evaluate(() => ({
        sameDay: _geoStopCrossesMidnight('2026-08-21T15:00:00.000Z', '2026-08-21T22:00:00.000Z'),   // 10am->5pm CT
        overnight: _geoStopCrossesMidnight('2026-08-22T00:30:00.000Z', '2026-08-22T13:00:00.000Z'), // 7:30pm CT 8/21 -> 8am CT 8/22
        utcOnly: _geoStopCrossesMidnight('2026-08-21T20:00:00.000Z', '2026-08-22T01:00:00.000Z'),   // 3pm->8pm CT, same CT day, different UTC days
      }));
      expect(r.sameDay).toBe(false);
      expect(r.overnight).toBe(true);
      expect(r.utcOnly, 'a UTC date change inside one Central day is NOT midnight').toBe(false);
    });


    test('_geoVisitKey: different kinds and ids never collide even at the same instant', async () => {
      const r = await page.evaluate(() => {
        const t = new Date().toISOString();
        return {
          jobVsShop: _geoVisitKey('job', 1, t) === _geoVisitKey('shop', null, t),
          jobIdMatters: _geoVisitKey('job', 1, t) === _geoVisitKey('job', 2, t),
          sameEverything: _geoVisitKey('job', 1, t) === _geoVisitKey('job', 1, t),
        };
      });
      expect(r.jobVsShop, 'kind is part of the key').toBe(false);
      expect(r.jobIdMatters, 'id is part of the key').toBe(false);
      expect(r.sameEverything, 'identical inputs are deterministic').toBe(true);
    });
  });




  test('no console errors during park/reconcile tests', async () => {
    assertNoErrors(page, 'geo park/reconcile');
  });
});
