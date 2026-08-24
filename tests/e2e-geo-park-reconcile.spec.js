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
    window._isEmployee = false;
    window._supaUser = { id: 'geo-park-user-1', email: 'p@t.com' };
    window.__rec = { upserts: [], inserts: [], deletes: [], updates: [] };
    // Table-aware seeding: shop_time_entries selects resolve __selShopRows,
    // everything else resolves __selRows (the repair sweep reads BOTH tables
    // in one pass, so one shared array would feed job rows in as shop rows).
    window.__selRows = []; window.__selShopRows = []; window.__selErr = null;
    window.__origSupa = window.__origSupa || window._supa;
    window._supa = {
      from: (tbl) => ({
        select: () => {
          const rowsFor = () => (tbl === 'shop_time_entries' ? (window.__selShopRows || []) : (window.__selRows || []));
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
        update: (patch) => {
          const rec = { tbl, patch, filters: {} };
          window.__rec.updates.push(rec);
          const q = { eq: (col, val) => { rec.filters[col] = val; return q; },
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
      cur: _geoCurrentJob, arrivedAt: _geoArrivedAt, softJob: _geoSoftJob,
      driveOpen: _geoDriveStartedAt != null, driveRow,
    };
  }, jobId);

  const restoreJobs = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    _geoJobCoords = {};
  });

  test('park detection: a stationary drive outside the strict fence resolves to a backdated job arrival', async () => {
    await geoReset();
    const r = await parkAtJob(885101);
    // The fixture actually sits in the intended band: outside the fence,
    // inside fence + 350ft, or this whole test is testing nothing.
    expect(r.spotFt).toBeGreaterThan(r.fence);
    expect(r.spotFt).toBeLessThan(r.fence + 350);
    expect(r.clusterAfterFirst, 'first stationary fix starts the cluster').not.toBeNull();
    // The park resolved: the visit is open on the job, held by the soft lock.
    expect(String(r.cur)).toBe('885101');
    expect(r.softJob && String(r.softJob.id)).toBe('885101');
    // Backdated to when motion stopped (5 min ago), not to when the resolver
    // noticed. 4.5 min of slack covers the eval's own runtime.
    expect(Date.parse(r.arrivedAt)).toBeLessThanOrEqual(Date.now() - 4.5 * 60000);
    // The drive was killed and its leg written, ending at the SAME backdated
    // moment the arrival starts: no gap, no overlap, "kill the drive and
    // capture the end time".
    expect(r.driveOpen).toBe(false);
    expect(r.driveRow, 'the 20-minute leg was written').not.toBeNull();
    expect(r.driveRow.departed_at).toBe(r.arrivedAt);
    expect(r.driveRow.minutes).toBeGreaterThanOrEqual(14);
    expect(r.driveRow.minutes).toBeLessThanOrEqual(16);
    await restoreJobs();
    await geoRestore();
  });

  test('park release: driving-speed fixes close the soft-locked visit, one phantom fix does not', async () => {
    await geoReset();
    await parkAtJob(885102);
    const r = await page.evaluate(async () => {
      const spot = { lat: 37.6872 + (_geoFenceFt() + 150) / 364584, lng: -97.3301 };
      const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
      // FIRST driving-speed fix: the same one-phantom-fix debounce the driveby
      // guard gives an established occupant, the visit must survive it.
      await ping({ lat: spot.lat + 0.0002, lng: spot.lng }, 8);
      const afterOne = { cur: _geoCurrentJob, soft: !!_geoSoftJob };
      // SECOND consecutive driving fix: they pulled out, the lock releases and
      // the exit machinery trusts the driving-speed reading immediately.
      await ping({ lat: spot.lat + 0.0004, lng: spot.lng }, 8);
      await new Promise(res => setTimeout(res, 60));
      const visitRow = (window.__rec.upserts.find(u => u.tbl === 'job_time_entries' && /^geofence/.test(u.row.source || '')) || {}).row || null;
      return { afterOne, cur: _geoCurrentJob, soft: _geoSoftJob, visitRow };
    });
    expect(String(r.afterOne.cur), 'one phantom driving fix never closes the visit').toBe('885102');
    expect(r.afterOne.soft).toBe(true);
    expect(r.cur, 'second consecutive driving fix closes it').toBeNull();
    expect(r.soft).toBeNull();
    expect(r.visitRow, 'the visit wrote its geofence row').not.toBeNull();
    expect(String(r.visitRow.job_id)).toBe('885102');
    expect(r.visitRow.minutes).toBeGreaterThanOrEqual(4); // backdated arrival ~5 min ago
    await restoreJobs();
    await geoRestore();
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
      wasInShop: _geoWasInShop, shopArrivedAt: _geoShopArrivedAt, softShop: _geoSoftShop,
      driveOpen: _geoDriveStartedAt != null, driveRow,
    };
  });

  const restoreShop = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    _geoJobCoords = {};
    S.officeLat = null; S.officeLon = null;
  });

  test('park detection: a stationary drive outside the strict Shop fence resolves to a backdated Shop arrival', async () => {
    await geoReset();
    const r = await parkAtShop();
    expect(r.spotFt).toBeGreaterThan(r.fence);
    expect(r.spotFt).toBeLessThan(r.fence + 350);
    expect(r.clusterAfterFirst, 'first stationary fix starts the cluster').not.toBeNull();
    expect(r.wasInShop, 'the park resolved to the Shop, no job existed to compete for it').toBe(true);
    expect(r.softShop && r.softShop.lat).toBeCloseTo(r.spot.lat, 4);
    expect(Date.parse(r.shopArrivedAt)).toBeLessThanOrEqual(Date.now() - 4.5 * 60000);
    expect(r.driveOpen).toBe(false);
    expect(r.driveRow, 'the 20-minute leg into the Shop was written').not.toBeNull();
    expect(r.driveRow.departed_at).toBe(r.shopArrivedAt);
    expect(r.driveRow.minutes).toBeGreaterThanOrEqual(14);
    expect(r.driveRow.minutes).toBeLessThanOrEqual(16);
    await restoreShop();
    await geoRestore();
  });

  test('park release: driving-speed fixes close a soft-locked Shop visit, one phantom fix does not', async () => {
    await geoReset();
    await parkAtShop();
    const r = await page.evaluate(async () => {
      const spot = { lat: 37.6872 + (_geoFenceFt() + 150) / 364584, lng: -97.3301 };
      const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed: spd } });
      await ping({ lat: spot.lat + 0.0002, lng: spot.lng }, 8);
      const afterOne = { wasInShop: _geoWasInShop, soft: !!_geoSoftShop };
      await ping({ lat: spot.lat + 0.0004, lng: spot.lng }, 8);
      await new Promise(res => setTimeout(res, 60));
      const visitRow = (window.__rec.upserts.find(u => u.tbl === 'shop_time_entries') || {}).row || null;
      return { afterOne, wasInShop: _geoWasInShop, soft: _geoSoftShop, visitRow };
    });
    expect(r.afterOne.wasInShop, 'one phantom driving fix never closes the Shop visit').toBe(true);
    expect(r.afterOne.soft).toBe(true);
    expect(r.wasInShop, 'second consecutive driving fix closes it').toBe(false);
    expect(r.soft).toBeNull();
    expect(r.visitRow, 'the visit wrote its shop_time_entries row').not.toBeNull();
    expect(r.visitRow.minutes).toBeGreaterThanOrEqual(4);
    await restoreShop();
    await geoRestore();
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
    while (_ctDateStr(new Date(T - (gapHrs + 2) * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
    // The job is dated to the WINDOW'S day (its Central day-key), which is
    // what the reconciler's day-scoped job match compares against.
    jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _ctDateStr(new Date(T - (gapHrs + 1) * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
    const iso = (ms) => new Date(ms).toISOString();
    const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - (gapHrs + 2) * 3600000), endedIso: iso(T - (gapHrs + 1) * 3600000),
                fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
    const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
    mileage.push(A, B);
    return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, jid: String(jid) };
  }, [jobId, opts || {}]);

  const restoreReconSeed = () => page.evaluate(() => {
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; }
    if (window.__origTimeEntries) { timeEntries.length = 0; window.__origTimeEntries.forEach(t => timeEntries.push(t)); window.__origTimeEntries = null; }
    _geoJobCoords = {};
  });

  const runRecon = () => page.evaluate(async () => {
    await _geoReconcileFromMileage();
    await new Promise(res => setTimeout(res, 60)); // let the enqueue drain hit the recorder
    return {
      recRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && (u.row.source || '') === 'geofence-reconciled').map(u => u.row),
      updates: window.__rec.updates.slice(),
    };
  });

  test('reconciliation: an uncovered job-anchored window between two legs is inserted whole', async () => {
    await geoReset();
    const seed = await seedReconPair(886001);
    const r = await runRecon(); // __selRows = [], the server holds nothing
    expect(r.recRows.length, 'exactly one reconciled row').toBe(1);
    const row = r.recRows[0];
    expect(row.client_key).toBe('rec-' + seed.A.legKey);       // deterministic: re-runs are idempotent
    expect(row.job_id).toBe(seed.jid);
    expect(row.arrived_at).toBe(seed.A.endedIso);              // the moment leg A parked at the job
    expect(row.departed_at).toBe(seed.B.startedIso);           // the moment leg B pulled away
    expect(row.minutes).toBe(120);
    expect(r.updates.length).toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner ask 2026-08-23: the recon-win journal tag (the "08-21T12:55→22:07Z"
  // shape pasted straight off a live device) showed raw UTC, confusing to
  // read against a phone on Central time. _wTag now builds off _ctStamp/
  // _ctHM instead of a raw ISO slice.
  test('reconciliation: the recon-win journal tag shows Central time, not raw UTC', async () => {
    await geoReset();
    const seed = await seedReconPair(886005);
    await runRecon();
    const r = await page.evaluate((seed) => {
      const entry = _geoParkLog.slice().reverse().find(x => x.ev === 'recon-win' && x.x && x.x.indexOf('→') >= 0);
      return {
        entryText: entry ? entry.x : null,
        expectedStart: _ctStamp(new Date(seed.A.endedIso)).slice(0, -3),
        expectedEnd: _ctHM(new Date(seed.B.startedIso)),
      };
    }, seed);
    expect(r.entryText, 'a window tag was journaled for this recon pass').toBeTruthy();
    expect(r.entryText).not.toContain('Z');
    expect(r.entryText).toContain(r.expectedStart);
    expect(r.entryText).toContain(r.expectedEnd);
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner correction (2026-08-21): leg B's OWN logged origin must never be
  // required to match the job. If GPS was spotty leaving the site, the
  // departure leg is exactly as likely to carry a missing or wrong fromCoord
  // as the arrival was to be missed in the first place, that is the SAME bug
  // this feature exists to route around. What proves the visit ended by t2
  // is that B exists at all, not where B says it started.
  test('reconciliation: leg B with no fromCoord at all still closes the window', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      // Same-Central-day anchor + job dated to the window's own Central
      // day-key: the reconciler's day rules (midnight refusal, day-scoped
      // job match) both read Central time, a raw now/UTC date drifts on CI.
      let T = Date.now();
      while (_ctDateStr(new Date(T - 3 * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _ctDateStr(new Date(T - 2 * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 3 * 3600000), endedIso: iso(T - 2 * 3600000),
                  fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      // B's departure leg never got a clean fix leaving the site: no
      // fromCoord at all, same shape a stale/gap-inferred leg can carry.
      const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                  toCoord: { lat: 39.0, lng: -95.0 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      mileage.push(A, B);
      return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, jid: String(jid) };
    }, [886005]);
    const r = await runRecon();
    expect(r.recRows.length, 'the window closes on B\'s mere existence, not its origin').toBe(1);
    expect(r.recRows[0].departed_at).toBe(seed.B.startedIso);
    await restoreReconSeed();
    await geoRestore();
  });

  test('reconciliation: leg B logged a WRONG origin, miles from the job, still closes the window', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      // Same-Central-day anchor + job dated to the window's own Central
      // day-key, same reasoning as the no-fromCoord seed above.
      let T = Date.now();
      while (_ctDateStr(new Date(T - 3 * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _ctDateStr(new Date(T - 2 * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 3 * 3600000), endedIso: iso(T - 2 * 3600000),
                  fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      // B thinks it started 20+ miles away, a stale/garbage origin fix.
      const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                  fromCoord: { lat: 38.0, lng: -96.0 }, toCoord: { lat: 39.0, lng: -95.0 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      mileage.push(A, B);
      return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, jid: String(jid) };
    }, [886006]);
    const r = await runRecon();
    expect(r.recRows.length, 'a wrong-looking B origin no longer refuses the pairing').toBe(1);
    expect(r.recRows[0].departed_at).toBe(seed.B.startedIso);
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner correction (2026-08-21): the coverage-check/extend-in-place design
  // below (skip when an existing row covers ≥80%, extend a truncated stub
  // rather than insert) was itself the bug, two real duplicate rows landed
  // on the SAME visit in production despite this exact check. Rather than
  // debug an increasingly clever write-time decision, the reconciler now
  // just writes plain, every time, the same way every other source in this
  // file does, and a SEPARATE dedup sweep (_geoDedupTimeEntries, tested
  // below) cleans up whatever overlaps afterward, mirroring how mileage
  // duplicates are handled. These two tests used to assert the removed
  // skip/extend behavior; they now assert the reconciler no longer tries to
  // be clever at write time at all.
  test('reconciliation: writes its window even when the server already holds a covering row (dedup cleans up after, not a write-time skip)', async () => {
    await geoReset();
    const seed = await seedReconPair(886002);
    await page.evaluate((s) => {
      window.__selRows = [{ id: 11, client_key: 'k11', job_id: s.jid, arrived_at: s.A.endedIso, departed_at: s.B.startedIso, minutes: 120, source: 'geofence' }];
    }, seed);
    const r = await runRecon();
    expect(r.recRows.length, 'no more coverage-check skip: the window always writes').toBe(1);
    expect(r.updates.length, 'no more extend-in-place branch at all').toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  test('reconciliation: never extends a truncated stub in place anymore, it inserts its own row', async () => {
    await geoReset();
    const seed = await seedReconPair(886003);
    // The owner's screenshot case: a 9-minute row for what was a 2-hour visit.
    await page.evaluate((s) => {
      const t1 = Date.parse(s.A.endedIso);
      window.__selRows = [{ id: 77, client_key: 'k77', job_id: s.jid, arrived_at: s.A.endedIso,
                            departed_at: new Date(t1 + 9 * 60000).toISOString(), minutes: 9, source: 'geofence' }];
    }, seed);
    const r = await runRecon();
    expect(r.updates.length, 'the update/extend branch is gone').toBe(0);
    expect(r.recRows.length, 'its own full-window row is inserted instead').toBe(1);
    expect(r.recRows[0].arrived_at).toBe(seed.A.endedIso);
    expect(r.recRows[0].departed_at).toBe(seed.B.startedIso);
    expect(r.recRows[0].minutes).toBe(120);
    await restoreReconSeed();
    await geoRestore();
  });

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
    while (_ctDateStr(new Date(T - (gapHrs + 2) * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
    const iso = (ms) => new Date(ms).toISOString();
    const A = { id: 'mlc-A', gps: true, legKey: 'lgcA-' + cid, startedIso: iso(T - (gapHrs + 2) * 3600000), endedIso: iso(T - (gapHrs + 1) * 3600000),
                fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: CL.lat, lng: CL.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
    const B = { id: 'mlc-B', gps: true, legKey: 'lgcB-' + cid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
                fromCoord: { lat: CL.lat, lng: CL.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
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
    await _geoReconcileFromMileage();
    await new Promise(res => setTimeout(res, 60));
    return {
      recRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && (u.row.source || '') === 'place-reconciled').map(u => u.row),
    };
  });

  test('reconciliation: a client-anchored window with NO job scheduled anywhere still repairs (the reload-reset case)', async () => {
    await geoReset();
    const seed = await seedReconClientPair(886101);
    const r = await runReconClient();
    expect(r.recRows.length, 'exactly one reconciled client row').toBe(1);
    const row = r.recRows[0];
    expect(row.client_key).toBe('rec-' + seed.A.legKey);
    expect(row.job_id).toBe(null);
    expect(row.dest_place).toBe('Recon Client');
    expect(row.arrived_at).toBe(seed.A.endedIso);
    expect(row.departed_at).toBe(seed.B.startedIso);
    expect(row.minutes).toBe(120);
    await restoreReconClientSeed();
    await geoRestore();
  });

  test('reconciliation: a scheduled JOB still wins over a client at the same coordinates', async () => {
    await geoReset();
    const seed = await seedReconClientPair(886102);
    // A job at the exact same spot, same day, outranks the client fallback
    // (job is the strongest fence everywhere else in this file too).
    await page.evaluate((cid) => {
      jobs.push({ id: 'job-' + cid, name: 'Same Spot Job', lat: 37.6872, lon: -97.3301, start: _ctDateStr(new Date()), days: 1, status: 'upcoming', eventType: 'job' });
      _geoJobCoords = {};
    }, seed.cid);
    const r = await page.evaluate(async () => {
      await _geoReconcileFromMileage();
      await new Promise(res => setTimeout(res, 60));
      return {
        jobRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && (u.row.source || '') === 'geofence-reconciled'),
        placeRows: window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && (u.row.source || '') === 'place-reconciled'),
      };
    });
    expect(r.jobRows.length, 'the job wins the window').toBe(1);
    expect(r.placeRows.length, 'the client never gets a turn once a job matches').toBe(0);
    await restoreReconClientSeed();
    await geoRestore();
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

  // Old behavior (through 2026-08-22): "longest measured wins" whatever the
  // two sources were, so a slightly-longer geofence-reconciled row (502)
  // beat a shorter but directly-observed geofence row (501). That was wrong:
  // 2026-08-23 owner screenshot, a mileage-anchored reconciled guess
  // overlapping and outlasting a real visit. New rule: a live detection
  // always beats an inferred reconciliation, regardless of duration, a
  // reconciled row is a guess anchored to mileage legs, never something the
  // fence machine (or a human) actually observed.
  test('dedup: a live geofence row always beats an overlapping geofence-reconciled row, even if shorter', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 501, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 502, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 3.05 * 3600000).toISOString(), departed_at: new Date(now - 0.9 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes.length).toBe(1);
    expect(r.deletes[0].val, 'the reconciled guess (502) loses to the live detection (501), even though 502 measured longer').toBe(502);
    await geoRestore();
  });

  // 'place' (a live client/saved-place visit) and 'place-reconciled' were
  // missing from the dedup sweep's onSite matcher entirely (owner report
  // 2026-08-21: a client visit reconciled twice by two passes never got
  // cleaned up, the exact bug this fix closes for job/geofence rows already,
  // just never extended to clients when this was first written). Same
  // live-beats-reconciled rule as the geofence pair above (owner screenshot
  // 2026-08-23): the live 'place' visit is never the one that drops.
  test('dedup: a live place row always beats an overlapping place-reconciled row, even if shorter', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 511, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 512, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place-reconciled',
          arrived_at: new Date(now - 3.05 * 3600000).toISOString(), departed_at: new Date(now - 0.9 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes[0].val, 'the reconciled guess (512) loses to the live visit (511), even though 512 measured longer').toBe(512);
    await geoRestore();
  });

  test('dedup: a manual bookend never loses, an overlapping automatic row does', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 601, employee_user_id: 'geo-park-user-1', job_id: '88', dest_place: null, source: 'manual',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        // Longer than the manual row on both sides, manual wins the
        // overlap, but the reconciled row's genuinely uncovered edges (30
        // min before and after, same shape as the owner's 08/21 report)
        // still survive: a human's clock record beats a guess for the time
        // it actually covers, it does not erase time the guess claims that
        // the human record never touched at all.
        { id: 602, employee_user_id: 'geo-park-user-1', job_id: '88', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 4.5 * 3600000).toISOString(), departed_at: new Date(now - 0.5 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.deletes.length, 'nothing is deleted outright, the reconciled row is trimmed instead').toBe(0);
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id, 'the row already in hand updates to its first surviving fragment').toBe(602);
    expect(new Date(r.updates[0].patch.arrived_at).getTime(), 'trimmed to the 30 min before the manual entry').toBe(now - 4.5 * 3600000);
    expect(new Date(r.updates[0].patch.departed_at).getTime()).toBe(now - 4 * 3600000);
    expect(r.inserts.length, 'the 30 min after the manual entry becomes its own fragment').toBe(1);
    expect(r.inserts[0].row.job_id).toBe('88');
    expect(new Date(r.inserts[0].row.arrived_at).getTime()).toBe(now - 1 * 3600000);
    expect(new Date(r.inserts[0].row.departed_at).getTime()).toBe(now - 0.5 * 3600000);
    await geoRestore();
  });

  test('dedup: two genuinely separate visits to the same job (no time overlap) are both kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 701, employee_user_id: 'geo-park-user-1', job_id: '99', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 5 * 3600000).toISOString() },
        { id: 702, employee_user_id: 'geo-park-user-1', job_id: '99', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'a gap between visits is not a duplicate').toBe(0);
    await geoRestore();
  });

  test('dedup: different jobs never merge, however close in time', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 801, employee_user_id: 'geo-park-user-1', job_id: '111', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 802, employee_user_id: 'geo-park-user-1', job_id: '222', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'identical windows at two different jobs are not the same visit').toBe(0);
    await geoRestore();
  });

  // The exact owner screenshot shape (2026-08-23, 08/20 data): a job-tagged
  // 'geofence-reconciled' row (job_id set, dest_place null) sitting almost
  // exactly on top of the real, live 'place' visit for the same client
  // (job_id null, dest_place set). Different "targets" by the strict rule
  // above, so the OLD sameTarget check never even evaluated this pair for
  // overlap, the reconciled row survived forever alongside the real one. A
  // reconciled row is now a duplicate candidate against ANY overlapping
  // on-site row for the same person, target match or not.
  test('dedup: a job-tagged geofence-reconciled row is dropped against an overlapping live place visit, different targets', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 901, employee_user_id: 'geo-park-user-1', job_id: '1787004045294092', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 3.72 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
        { id: 902, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 3.7 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes[0].val, 'the reconciled guess drops, the live visit underneath it survives, even though the targets never matched').toBe(901);
    await geoRestore();
  });

  // Real gap on ONE side only: the reconciled row started reconciling
  // before the live visit began, and both end at the same moment (the
  // reconciler and the live visit agree on the departure, just not the
  // arrival). Trimmed to the uncovered lead-in, nothing to insert.
  test('dedup: a reconciled row with real uncovered time on only one side is trimmed, not deleted', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 1201, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 5 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
        { id: 1202, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.deletes.length).toBe(0);
    expect(r.inserts.length, 'the whole window is one contiguous surviving fragment, nothing left over to split off').toBe(0);
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id).toBe(1201);
    expect(new Date(r.updates[0].patch.arrived_at).getTime()).toBe(now - 5 * 3600000);
    expect(new Date(r.updates[0].patch.departed_at).getTime(), 'trimmed to right where the live visit picks up').toBe(now - 2 * 3600000);
    // Re-keyed off its OWN row id, not the original 'rec-'+legKey it arrived
    // with: the reconciler's own deterministic key is exactly what
    // _geoDrainQueue's duplicate-key fallback treats as "same visit, take
    // the newer numbers" and would resurrect this trim back to its full
    // untrimmed span the next time the reconciler re-proposes the same
    // mileage-leg gap (every Time Log open, nothing throttles it).
    expect(r.updates[0].patch.client_key, "trimmed rows move off the reconciler's key so a future re-run can never resurrect them").toBe('1201-frag0');
    await geoRestore();
  });

  // The exact 08/21 live shape (owner report 2026-08-23, the round after the
  // first version of this fix shipped): a real visit landed in the MIDDLE of
  // the reconciled window, not at either edge. A single delete-the-loser
  // sweep had already wiped BOTH the 7:55-10:57am AND 12:25-4:16pm stretches
  // just for overlapping the 10:57-11:37am visit in between, hours nothing
  // else had ever recorded. Both edges must survive: one as the trimmed
  // update, the other as a new fragment.
  test('dedup: a reconciled row with real uncovered time on BOTH sides of a live visit keeps both (the 08/21 regression)', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 1301, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 9 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
        { id: 1302, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 5 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.deletes.length, 'neither uncovered edge is a plain duplicate, nothing is deleted outright').toBe(0);
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id, 'the row already in hand becomes the first (earlier) fragment').toBe(1301);
    expect(new Date(r.updates[0].patch.arrived_at).getTime()).toBe(now - 9 * 3600000);
    expect(new Date(r.updates[0].patch.departed_at).getTime()).toBe(now - 6 * 3600000);
    expect(r.updates[0].patch.client_key, 'moved off the reconciler\'s key, immune to resurrection on the next re-run').toBe('1301-frag0');
    expect(r.inserts.length, 'the later fragment, after the live visit, becomes its own new row').toBe(1);
    expect(r.inserts[0].row.job_id, 'the fragment keeps the original reconciled row\'s target and source').toBe('77');
    expect(r.inserts[0].row.source).toBe('geofence-reconciled');
    expect(r.inserts[0].row.employee_user_id).toBe('geo-park-user-1');
    expect(new Date(r.inserts[0].row.arrived_at).getTime()).toBe(now - 5 * 3600000);
    expect(new Date(r.inserts[0].row.departed_at).getTime()).toBe(now);
    expect(r.inserts[0].row.client_key, 'deterministic per-fragment key, a re-run can never double-insert it').toBe('1301-frag1');
    await geoRestore();
  });

  // The self-heal case the re-key exists for: the reconciler re-fires (every
  // Time Log open, nothing throttles it) and re-proposes the SAME full-span
  // window under its OWN deterministic key, landing as a genuinely NEW row
  // since the original already moved off that key onto '<id>-frag0'/'-frag1'.
  // This fresh, longer duplicate must be the one that gets deleted, never the
  // shorter, already-correct trim/fragment sitting inside it, even though
  // both are 'geofence-reconciled' and both technically overlap each other
  // in the SAME pass off the SAME snapshot.
  test('dedup: a resurrected full-span duplicate is deleted, the already-trimmed fragments inside it survive untouched', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        // Already settled: the front trim and the back fragment from an
        // earlier pass, at their correct, final boundaries.
        { id: 2001, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 9 * 3600000).toISOString(), departed_at: new Date(now - 6 * 3600000).toISOString() },
        { id: 2002, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 5 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
        // The live visit sitting between them.
        { id: 2003, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 5 * 3600000).toISOString() },
        // The resurrection: a fresh full-span proposal under the reconciler's
        // OWN key, covering all three of the rows above.
        { id: 2004, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 9 * 3600000).toISOString(), departed_at: new Date(now).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.deletes.length, 'only the resurrected duplicate is removed').toBe(1);
    expect(r.deletes[0].val).toBe(2004);
    expect(r.updates.length, 'the already-correct fragments are never touched again').toBe(0);
    expect(r.inserts.length).toBe(0);
    await geoRestore();
  });

  // Edge jitter under the floor (a reconciled window a few minutes wider
  // than the live visit it's really the same visit as) must still collapse
  // to a plain delete, not spawn tiny meaningless fragment rows.
  test('dedup: edge jitter under the 15-minute floor still deletes outright, no fragment rows', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 1401, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 3.1 * 3600000).toISOString(), departed_at: new Date(now - 0.9 * 3600000).toISOString() },
        { id: 1402, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.deletes.length).toBe(1);
    expect(r.deletes[0].val).toBe(1401);
    expect(r.updates.length).toBe(0);
    expect(r.inserts.length).toBe(0);
    await geoRestore();
  });

  // A hand-fixed row counts as a human clock record in dedup too: it must
  // never lose to the longer automatic guess it was written to correct
  // (owner rule 2026-08-24, when GPS rows became editable).
  test('dedup: a hand-fixed row beats a longer overlapping automatic row', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 1501, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          client_key: 'fixed-1501', arrived_at: '2026-08-12T18:06:57.587Z', departed_at: '2026-08-12T22:15:00.000Z' },
        // The original, still claiming the flush-stamped 9:37pm close.
        { id: 1502, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          client_key: 'live-1502', arrived_at: '2026-08-12T18:06:57.587Z', departed_at: '2026-08-13T02:37:29.394Z' },
      ];
    });
    const r = await dedupCall();
    expect(r.deletes.length).toBe(1);
    expect(r.deletes[0].val, 'the longer automatic row loses to the human correction').toBe(1502);
    await geoRestore();
  });

  // Two crew members can each be mid-reconciliation on genuinely different
  // jobs at the same moment: the cross-target rule above must not merge
  // DIFFERENT people's reconciled rows into one, same guard as the live-row
  // case (dedup: two DIFFERENT employees..., below).
  test('dedup: two different employees each with a reconciled row at the same time are both kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 911, employee_user_id: 'crew-member-a', job_id: '111', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 912, employee_user_id: 'crew-member-b', job_id: '222', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'two different people, cross-target merging never spans employees').toBe(0);
    await geoRestore();
  });

  test('dedup: drive-sourced rows are never touched, even overlapping an on-site row', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 901, employee_user_id: 'geo-park-user-1', job_id: '333', dest_place: null, source: 'drive-unassigned',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 902, employee_user_id: 'geo-park-user-1', job_id: '333', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 2.9 * 3600000).toISOString(), departed_at: new Date(now - 0.9 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'wheel time and on-site time overlapping in transition is normal, not a duplicate').toBe(0);
    await geoRestore();
  });

  // Owner ask (2026-08-21): "everything that should stay actually stays."
  // Two crew members can legitimately be on the SAME job at the SAME time
  // (a two-person crew), and their identical windows must never read as one
  // person's duplicate.
  test('dedup: two DIFFERENT employees at the same job, same window, both kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 1001, employee_user_id: 'crew-member-a', job_id: '444', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 1002, employee_user_id: 'crew-member-b', job_id: '444', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'a two-person crew at the same job is not a duplicate of itself').toBe(0);
    await geoRestore();
  });

  // The actual GPS-drop shape: live detection never wrote anything for a
  // visit at all (the fence fired, then GPS died mid-visit and the confirm
  // ping never arrived), so the ONLY record is the reconciler's mileage-
  // anchored inference. Dedup must be a pure no-op with nothing to compare
  // against, the hours must not vanish.
  test('dedup: a GPS-drop visit with only ONE record (nothing to compare) is left untouched', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 1101, employee_user_id: 'geo-park-user-1', job_id: '555', dest_place: null, source: 'geofence-reconciled',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 0.5 * 3600000).toISOString() },
      ];
    }, now);
    const r = await dedupCall();
    expect(r.dropped, 'a single record has nothing to dedup against, the hours survive').toBe(0);
    await geoRestore();
  });

  // ── _geoMergeAdjacentVisits (owner rule 2026-08-23) ──────────────────────
  // "See all the John Doe stuff? From 7:55 am - 11:37 am those can all be
  // merged... that's the reconciliation I want." Unlike _geoDedupTimeEntries
  // above (which only fires on real time OVERLAP), this fires on ADJACENCY:
  // same person, same resolved place (job_id resolved to its client name via
  // _tlJobClientInfo, or the raw dest_place text), gap at or under the
  // true-back-to-back floor. Same recording _supa/window.__selRows harness.
  const mergeCall = () => page.evaluate(async () => {
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
    let changed;
    try { changed = await _geoMergeAdjacentVisits(); }
    finally { if (saved) { mileage.length = 0; saved.forEach(m => mileage.push(m)); } window.__mergeTestLegs = null; }
    // rowsSeen/mockWasSwapped ride along so a future failure names its own
    // cause instead of only reporting a zero count.
    return { changed, deletes: window.__rec.deletes.slice(), updates: window.__rec.updates.slice(),
      rowsSeen: (window.__selRows || []).length, mockWasSwapped, selErr: window.__selErr || null };
  });

  test('merge: two true back-to-back geofence rows at the same job fold into one', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2001, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        // Picks back up 45 seconds after the first row's departure, a fence
        // blip, not a real gap. Fixed mid-day Central instants: the merged
        // span must sit in one Central day, so now-relative times would
        // flake around midnight.
        { id: 2002, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T16:00:45.000Z', departed_at: '2026-08-21T17:00:00.000Z' },
      ];
    }, now);
    const r = await mergeCall();
    // Preconditions first, so an intermittent failure here names its own
    // cause instead of only saying "expected 1, got 0" (CI shard 6 did
    // exactly that twice on 2026-08-24 and neither run said why).
    expect(r.rowsSeen, 'the sweep still reads the two rows this test seeded').toBe(2);
    expect(r.mockWasSwapped, 'the harness Supabase mock was still installed').toBe(false);
    expect(r.selErr, 'no stale simulated fetch error was left set').toBe(null);
    expect(r.deletes.length).toBe(1);
    expect(r.deletes[0].val, 'the earlier row survives, the later one folds into it').toBe(2002);
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id).toBe(2001);
    expect(r.updates[0].patch.arrived_at).toBe('2026-08-21T14:00:00.000Z');
    expect(r.updates[0].patch.departed_at, 'spans through to the later row\'s own departure').toBe('2026-08-21T17:00:00.000Z');
    expect(r.updates[0].patch.client_key, 're-keyed off its own id, immune to any future resurrection').toBe('merge-2001');
    await geoRestore();
  });

  // Owner rule change 2026-08-24 (supersedes the 2026-08-23 "only true
  // back-to-back" floor): a larger gap ALSO merges, but only when provably
  // empty, "no real drive events picked up between them, just loss of gps
  // geofence." Anything recorded in the gap blocks the merge instead.
  test('merge: an empty GPS-loss gap between two visits to the same job merges', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2011, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        // 14 minutes later, nothing on record in between: the real Mon 8/17
        // shape, a shop bounce whose drive legs were both deleted as dups.
        { id: 2012, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T16:14:00.000Z', departed_at: '2026-08-21T22:00:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.updates.length, 'a short empty gap is lost GPS, one continuous visit').toBe(1);
    expect(r.updates[0].patch.arrived_at).toBe('2026-08-21T14:00:00.000Z');
    expect(r.updates[0].patch.departed_at).toBe('2026-08-21T22:00:00.000Z');
    expect(r.deletes.length).toBe(1);
    await geoRestore();
  });

  // Found in review 2026-08-24: an empty gap of ANY size used to merge, so
  // Mon 8/17 folded correctly only because the repair had filled the middle
  // first. A long unobserved window is an absence, not a fence blip, and
  // belongs to the mileage-anchored reconciler which has real evidence.
  test('merge: an empty gap longer than an hour is an absence, never bridged', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2201, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T13:00:00.000Z', departed_at: '2026-08-21T14:04:00.000Z' },
        // 8h19m later, nothing on record: exactly Mon 8/17 WITHOUT the repair.
        { id: 2202, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T22:23:00.000Z', departed_at: '2026-08-21T23:17:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.changed, 'eight unobserved hours are never folded into one visit').toBe(0);
    await geoRestore();
  });

  test('merge: right at the one-hour ceiling still merges, past it does not', async () => {
    await geoReset();
    const run = (gapMin) => page.evaluate(async (gapMin) => {
      const start = Date.parse('2026-08-21T14:00:00.000Z');
      const endA = start + 60 * 60000;
      const startB = endA + gapMin * 60000;
      window.__selRows = [
        { id: 2301, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: new Date(start).toISOString(), departed_at: new Date(endA).toISOString() },
        { id: 2302, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: new Date(startB).toISOString(), departed_at: new Date(startB + 60 * 60000).toISOString() },
      ];
      window.__rec.deletes.length = 0; window.__rec.updates.length = 0;
      const saved = (typeof mileage !== 'undefined') ? mileage.slice() : null;
      if (saved) mileage.length = 0;
      let changed;
      try { changed = await _geoMergeAdjacentVisits(); }
      finally { if (saved) { mileage.length = 0; saved.forEach(m => mileage.push(m)); } }
      return changed;
    }, gapMin);
    expect(await run(60), 'exactly an hour still counts as a blip').toBeGreaterThan(0);
    await geoReset();
    expect(await run(61), 'a minute past the ceiling is an absence').toBe(0);
    await geoRestore();
  });

  test('merge: a drive row recorded in the gap blocks the merge (they really left)', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2013, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2014, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'DEV A shop', source: 'drive-unassigned',
          arrived_at: '2026-08-21T16:05:00.000Z', departed_at: '2026-08-21T16:20:00.000Z' },
        { id: 2015, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T20:10:00.000Z', departed_at: '2026-08-21T22:00:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.changed, 'a recorded drive between them means two real visits').toBe(0);
    await geoRestore();
  });

  test('merge: a mileage GPS leg in the gap blocks the merge', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2016, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2017, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T20:10:00.000Z', departed_at: '2026-08-21T22:00:00.000Z' },
      ];
      // geo-park-user-1 IS the contractor in this harness (geoReset), so the
      // owner's own legs carry logged_by_id null, same convention as live.
      window.__mergeTestLegs = [{ gps: true, logged_by_id: null, legKey: 'x1',
        startedIso: '2026-08-21T16:30:00.000Z', endedIso: '2026-08-21T16:45:00.000Z' }];
    });
    const r = await mergeCall();
    expect(r.changed, 'the truck moved, per mileage: two real visits').toBe(0);
    await geoRestore();
  });

  test('merge: a shop session in the gap blocks the merge', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2018, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2019, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T20:10:00.000Z', departed_at: '2026-08-21T22:00:00.000Z' },
      ];
      window.__selShopRows = [{ employee_user_id: 'geo-park-user-1',
        arrived_at: '2026-08-21T17:00:00.000Z', departed_at: '2026-08-21T18:00:00.000Z' }];
    });
    const r = await mergeCall();
    expect(r.changed, 'they were at the shop mid-gap: two real visits').toBe(0);
    await geoRestore();
  });

  // A row the owner corrected by hand is a human clock record: no sweep may
  // widen it again (owner rule 2026-08-24, when GPS rows became editable).
  test('merge: a hand-fixed row is never a merge candidate', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 3001, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          client_key: 'fixed-3001', arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 3002, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          client_key: 'live-3002', arrived_at: '2026-08-21T16:00:30.000Z', departed_at: '2026-08-21T18:00:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.changed, 'the hand-set boundary stands, nothing folds into it').toBe(0);
    await geoRestore();
  });

  test('merge: an empty gap crossing Central midnight never merges', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        // 8pm CT one day, 8am CT the next, same UTC day: proves the bound is
        // the Central day, not a UTC compare.
        { id: 2010, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T00:30:00.000Z', departed_at: '2026-08-21T01:00:00.000Z' },
        { id: 2020, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T13:00:00.000Z', departed_at: '2026-08-21T14:30:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.changed, 'a day never absorbs the night before it').toBe(0);
    await geoRestore();
  });

  test('merge: a gap right at the 2-minute tolerance edge still merges', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2021, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2022, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: '2026-08-21T16:02:00.000Z', departed_at: '2026-08-21T17:00:00.000Z' },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.deletes.length).toBe(1);
    expect(r.updates.length).toBe(1);
    await geoRestore();
  });

  test('merge: different employees at the same place, back-to-back, never merge into each other', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2031, employee_user_id: 'crew-member-a', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 2032, employee_user_id: 'crew-member-b', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 2 * 3600000 + 5000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.changed, 'two different people at the same place is not one visit').toBe(0);
    await geoRestore();
  });

  test('merge: different places, back-to-back, never merge', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2041, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 2042, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'Riverside Remodel', source: 'place',
          arrived_at: new Date(now - 2 * 3600000 + 5000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.changed, 'a genuinely different place, however close in time, is not the same visit').toBe(0);
    await geoRestore();
  });

  // INVERTED 2026-08-24 (this used to assert the opposite): a reconciled
  // row is never a merge candidate anymore. On 2026-08-23 a reconciled
  // full-day guess resolved to the same client as the live visits,
  // overlapped both, and bridged a real 47-minute lunch into one 551-minute
  // row on the owner's live account. Reconciled-vs-live overlap belongs to
  // dedup's trim phase; merge is live detections only.
  test('merge: a reconciled row is never a merge candidate, however adjacent', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2051, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence-reconciled',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2052, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T16:00:30.000Z', departed_at: '2026-08-21T18:00:00.000Z' },
      ];
    });
    const r = await mergeCall();
    expect(r.changed, 'the reconciled guess stays out of merge entirely').toBe(0);
    await geoRestore();
  });

  // The actual bug class this closes: a job-tagged live row and a
  // dest_place-tagged live row for the SAME real client never compared
  // under the old same-target dedup rule at all (different "targets"). Once
  // resolved through _tlJobClientInfo (job_id -> client name), they're the
  // same place, and adjacency merges them, keeping the job_id (the
  // structured reference) on the survivor.
  test('merge: a job-tagged row and a dest_place-tagged row for the same real client merge, keeping the job_id', async () => {
    await geoReset();
    const now = Date.now();
    const jid = 'geo-merge-job-1';
    await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); window.__origClients = clients.slice(); window.__origBids = bids.slice();
      const cid = 990201;
      clients.push({ id: cid, name: 'John Doe' });
      jobs.push({ id: jid, name: 'John Doe job', client_id: cid, bid_id: null, start: _ctDateStr(new Date()), days: 1, status: 'upcoming', eventType: 'job' });
    }, [jid]);
    await page.evaluate(([jid]) => {
      window.__selRows = [
        { id: 2061, employee_user_id: 'geo-park-user-1', job_id: jid, dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:00:00.000Z' },
        { id: 2062, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: '2026-08-21T16:00:30.000Z', departed_at: '2026-08-21T17:00:00.000Z' },
      ];
    }, [jid]);
    const r = await mergeCall();
    expect(r.updates.length, 'the job_id-tagged and dest_place-tagged rows resolve to the same client and merge').toBe(1);
    expect(r.updates[0].filters.id, 'the job_id-tagged row wins the structured reference').toBe(2061);
    expect(r.updates[0].patch.job_id).toBe(jid);
    expect(r.updates[0].patch.dest_place).toBe(null);
    expect(r.deletes[0].val).toBe(2062);
    await page.evaluate(() => {
      if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
      if (window.__origClients) { clients.length = 0; window.__origClients.forEach(c => clients.push(c)); window.__origClients = null; }
      if (window.__origBids) { bids.length = 0; window.__origBids.forEach(b => bids.push(b)); window.__origBids = null; }
    });
    await geoRestore();
  });

  test('merge: a manual bookend is never a merge candidate, even adjacent to a live row at the same job', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2071, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'manual',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 2072, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 2 * 3600000 + 5000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.changed, 'a manual clock record never becomes a merge candidate, and with nothing else at 77 to merge, the live row is untouched too').toBe(0);
    await geoRestore();
  });

  // Owner request 2026-08-23: an unpaid ('stop') stretch stays its own
  // visible line even at the literal same GPS spot as the job before/after
  // it, a lunch stop across the street from the job is still lunch.
  test('merge: a "stop" (unpaid) row is never folded into an adjacent job visit at the same place', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2081, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 3 * 3600000).toISOString() },
        { id: 2082, employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'stop',
          arrived_at: new Date(now - 3 * 3600000 + 5000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.changed, 'the stop row is excluded from merge candidacy entirely, nothing to fold it into').toBe(0);
    await geoRestore();
  });

  test('merge: a single row with nothing to merge against is left untouched, no throw', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2091, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.changed).toBe(0);
    await geoRestore();
  });

  test('merge: empty rows, no throw', async () => {
    await geoReset();
    await page.evaluate(() => { window.__selRows = []; });
    const r = await mergeCall();
    expect(r.changed).toBe(0);
    await geoRestore();
  });

  // Owner-chosen threshold applies chronologically per group, so a THREE-row
  // chain (7:55-11:37, gap, then two more true back-to-back segments) still
  // collapses to one row across the whole run, not just pairwise.
  test('merge: a three-row true back-to-back chain at the same job collapses into one row', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 2101, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T13:00:00.000Z', departed_at: '2026-08-21T15:00:00.000Z' },
        { id: 2102, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T15:00:20.000Z', departed_at: '2026-08-21T17:00:00.000Z' },
        { id: 2103, employee_user_id: 'geo-park-user-1', job_id: '77', dest_place: null, source: 'geofence',
          arrived_at: '2026-08-21T17:00:40.000Z', departed_at: '2026-08-21T18:00:00.000Z' },
      ];
    }, now);
    const r = await mergeCall();
    expect(r.updates.length, 'one surviving row for the whole chain').toBe(1);
    expect(r.deletes.length).toBe(2);
    expect(r.updates[0].patch.arrived_at).toBe('2026-08-21T13:00:00.000Z');
    expect(r.updates[0].patch.departed_at).toBe('2026-08-21T18:00:00.000Z');
    await geoRestore();
  });

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

  // The exact 08/21 shape: John Doe ends 11:37:36, the stop starts
  // 11:42:09, nothing fills the 4m33s between them.
  test('gap-absorb: a leading gap before a stop extends the stop backward to meet it', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3001, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 3002, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 2 * 3600000 + 273000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id).toBe(3002);
    expect(new Date(r.updates[0].patch.arrived_at).getTime(), 'the stop absorbs the gap, stretching back to the job\'s own departure').toBe(now - 2 * 3600000);
    expect(new Date(r.updates[0].patch.departed_at).getTime(), 'the far edge is untouched').toBe(now - 1 * 3600000);
    expect(r.updates[0].patch.minutes, 'the absorbed span, start to end, not the original duration plus the gap').toBe(60);
    await geoRestore();
  });

  test('gap-absorb: a trailing gap after a stop extends the stop forward to meet the next row', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3011, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 3 * 3600000).toISOString() },
        { id: 3012, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 3 * 3600000 + 300000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].filters.id).toBe(3011);
    expect(new Date(r.updates[0].patch.arrived_at).getTime(), 'the near edge is untouched').toBe(now - 4 * 3600000);
    expect(new Date(r.updates[0].patch.departed_at).getTime(), 'stretches forward to meet the next row\'s own arrival').toBe(now - 3 * 3600000 + 300000);
    await geoRestore();
  });

  test('gap-absorb: no gap at all (rows already touch), no update', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3021, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 3022, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.changed).toBe(0);
    await geoRestore();
  });

  test('gap-absorb: a paid (non-stop) row is never extended, even with a gap on either side', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3031, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 4 * 3600000).toISOString() },
        { id: 3032, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.changed, 'a gap between two PAID rows is left alone, only a stop ever absorbs').toBe(0);
    await geoRestore();
  });

  test('gap-absorb: a drive row filling the gap means there is nothing for the stop to absorb', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3041, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 4 * 3600000).toISOString() },
        { id: 3042, employee_user_id: 'geo-park-user-1', source: 'drive-unassigned',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 3.9 * 3600000).toISOString() },
        { id: 3043, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 3.9 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.changed, 'the drive row already sits between them, nothing left to absorb').toBe(0);
    await geoRestore();
  });

  test('gap-absorb: two different stops each absorb their own adjacent gap independently', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3051, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 10 * 3600000).toISOString(), departed_at: new Date(now - 9 * 3600000).toISOString() },
        { id: 3052, employee_user_id: 'geo-park-user-1', source: 'place',
          arrived_at: new Date(now - 8 * 3600000).toISOString(), departed_at: new Date(now - 4 * 3600000).toISOString() },
        { id: 3053, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.updates.length).toBe(2);
    const byId = Object.fromEntries(r.updates.map(u => [u.filters.id, u.patch]));
    expect(new Date(byId[3051].departed_at).getTime(), 'the first stop absorbs forward to the place row').toBe(now - 8 * 3600000);
    expect(new Date(byId[3053].arrived_at).getTime(), 'the second stop absorbs backward from the place row').toBe(now - 4 * 3600000);
    await geoRestore();
  });

  test('gap-absorb: different employees never absorb each other\'s gaps', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3061, employee_user_id: 'crew-member-a', source: 'place',
          arrived_at: new Date(now - 4 * 3600000).toISOString(), departed_at: new Date(now - 2 * 3600000).toISOString() },
        { id: 3062, employee_user_id: 'crew-member-b', source: 'stop',
          arrived_at: new Date(now - 2 * 3600000 + 60000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.changed, 'a different person\'s row is never a neighbor for this purpose').toBe(0);
    await geoRestore();
  });

  test('gap-absorb: a single row, nothing to absorb, no throw', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selRows = [
        { id: 3071, employee_user_id: 'geo-park-user-1', source: 'stop',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await gapCall();
    expect(r.changed).toBe(0);
    await geoRestore();
  });

  test('gap-absorb: empty rows, no throw', async () => {
    await geoReset();
    await page.evaluate(() => { window.__selRows = []; });
    const r = await gapCall();
    expect(r.changed).toBe(0);
    await geoRestore();
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

  test('drive-sync: a drive row whose leg still survives in mileage is kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__origMileage = mileage.slice(); mileage.length = 0;
      mileage.push({ id: 'ml-keep', gps: true, legKey: 'lg-keep', startedIso: new Date(now - 3600000).toISOString(), endedIso: new Date(now - 3300000).toISOString(), fromCoord: { lat: 1, lng: 1 }, toCoord: { lat: 2, lng: 2 }, miles: 3, date: new Date().toISOString().slice(0, 10) });
      window.__selRows = [
        { id: 2001, source: 'drive-unassigned', client_key: 'lg-keep' },
      ];
    }, now);
    const r = await syncCall();
    expect(r.dropped, 'the leg is still a real, surviving mileage row, its paid time stays').toBe(0);
    await page.evaluate(() => { if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; } });
    await geoRestore();
  });

  // The exact shape of the owner's 2026-08-21 live diagnostic: seven paid
  // "Driving" rows with zero matching mileage leg in one day, because
  // mileage's own personal-stop collapse or dedup sweep deleted the leg
  // AFTER the payroll row already wrote.
  test('drive-sync: a drive row whose leg no longer exists in mileage (collapsed/deduped away) is dropped', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__origMileage = mileage.slice(); mileage.length = 0;
      // mileage is empty: this leg was collapsed away (Home Depot -> Sam's
      // Club example) or merged into a survivor under a different legKey.
      window.__selRows = [
        { id: 2002, source: 'drive-unassigned', client_key: 'lg-collapsed-away' },
      ];
    });
    const r = await syncCall();
    expect(r.dropped, 'no surviving mileage leg means no paid drive time either').toBe(1);
    expect(r.deletes[0].val).toBe(2002);
    await page.evaluate(() => { if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; } });
    await geoRestore();
  });

  // Owner audit 2026-08-24: dup drive rows from 8/9-8/14 sat as double-paid
  // time forever because the old 7-day fetch window aged them out of this
  // sweep's reach before their duplicate legs died. The window is 90 days
  // now (same widening, same reason as _geoDedupTimeEntries). The mock
  // ignores query filters, so this guards the SOURCE, the same way the
  // heal-wiring test in e2e-geo-auto-mileage does.
  test('drive-sync: fetch window is 90 days, not 7 (old dup drive rows must stay reachable)', async () => {
    const src = await page.evaluate(async () => (await (await fetch('/js/geo-track.js')).text()));
    const fnStart = src.indexOf('async function _geoSyncDriveTimeEntries');
    const fnBody = src.slice(fnStart, fnStart + 1500);
    expect(fnStart).toBeGreaterThan(0);
    expect(fnBody).toContain('90*86400000');
    expect(fnBody).not.toContain('7*86400000');
  });

  // The other half of the same live diagnostic: one physical drive, two
  // near-duplicate mileage legs (6ms apart), each with its own paid
  // job_time_entries row. Once only ONE of the two legs survives locally
  // (whether from _mileDedupTrips healing it, or this device simply never
  // having synced the loser), the orphaned twin's pay drops, the survivor's
  // does not, one drive pays once.
  test('drive-sync: of two duplicate-leg drive rows, only the one matching a surviving leg is kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__origMileage = mileage.slice(); mileage.length = 0;
      // Only the winner of the (already-run) mileage dedup survives locally.
      mileage.push({ id: 'ml-winner', gps: true, legKey: 'lg-dup-winner', startedIso: new Date(now - 3600000).toISOString(), endedIso: new Date(now - 3540000).toISOString(), fromCoord: { lat: 1, lng: 1 }, toCoord: { lat: 2, lng: 2 }, miles: 3, date: new Date().toISOString().slice(0, 10) });
      window.__selRows = [
        { id: 2101, source: 'drive-unassigned', client_key: 'lg-dup-winner' },
        { id: 2102, source: 'drive-unassigned', client_key: 'lg-dup-loser' },
      ];
    }, now);
    const r = await syncCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes[0].val, 'the loser leg of the duplicate pair loses its paid time, the winner keeps its').toBe(2102);
    await page.evaluate(() => { if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; } });
    await geoRestore();
  });

  test('drive-sync: on-site sources (geofence/place/stop/manual) are never touched, even with no matching leg', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__origMileage = mileage.slice(); mileage.length = 0;   // nothing survives locally
      window.__selRows = [
        { id: 2201, source: 'geofence', client_key: 'not-a-drive-leg' },
        { id: 2202, source: 'geofence-reconciled', client_key: 'rec-something' },
        { id: 2203, source: 'place', client_key: 'place-key' },
        { id: 2204, source: 'stop', client_key: 'stop-key' },
        { id: 2205, source: 'manual', client_key: null },
      ];
    });
    const r = await syncCall();
    expect(r.dropped, 'this sweep only ever considers drive-sourced rows').toBe(0);
    await page.evaluate(() => { if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; } });
    await geoRestore();
  });

  test('drive-sync: a drive row with no client_key at all is treated as an orphan (no proof, no pay)', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__origMileage = mileage.slice(); mileage.length = 0;
      mileage.push({ id: 'ml-x', gps: true, legKey: 'lg-x', startedIso: new Date(now - 3600000).toISOString(), endedIso: new Date(now - 3300000).toISOString(), fromCoord: { lat: 1, lng: 1 }, toCoord: { lat: 2, lng: 2 }, miles: 3, date: new Date().toISOString().slice(0, 10) });
      window.__selRows = [
        { id: 2301, source: 'drive', client_key: null },
      ];
    }, now);
    const r = await syncCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes[0].val).toBe(2301);
    await page.evaluate(() => { if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; } });
    await geoRestore();
  });

  test('drive-sync: no drive-sourced rows at all is a clean no-op', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 2401, source: 'geofence', client_key: 'k1' },
      ];
    });
    const r = await syncCall();
    expect(r.dropped).toBe(0);
    await geoRestore();
  });

  // ── _geoDedupShopTimeEntries (owner audit 2026-08-23) ────────────────────
  // shop_time_entries never had ANY dedup coverage: same twin-write race as
  // job_time_entries, just on the shop table, and no other sweep touches it.
  const shopDedupCall = () => page.evaluate(async () => {
    window.__rec.deletes.length = 0;
    const dropped = await _geoDedupShopTimeEntries();
    return { dropped, deletes: window.__rec.deletes.slice() };
  });

  test('shop-dedup: two overlapping rows for the same person collapse to one', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selShopRows = [
        { id: 4001, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        // Arrived later, same dwell re-written by the twin-write race.
        { id: 4002, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 2.95 * 3600000).toISOString(), departed_at: new Date(now - 0.95 * 3600000).toISOString() },
      ];
    }, now);
    const r = await shopDedupCall();
    expect(r.dropped).toBe(1);
    expect(r.deletes[0]).toEqual({ tbl: 'shop_time_entries', col: 'id', val: 4002 });
    await geoRestore();
  });

  test('shop-dedup: two rows for DIFFERENT people at the same time are both kept', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selShopRows = [
        { id: 4101, employee_user_id: 'crew-member-a',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 4102, employee_user_id: 'crew-member-b',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await shopDedupCall();
    expect(r.dropped, 'two different people clocked in at the shop at once is not a duplicate').toBe(0);
    await geoRestore();
  });

  test('shop-dedup: a brief, sub-floor overlap (real back-to-back handoff) is left alone', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selShopRows = [
        // Ends at now-1h; the next row starts 2 minutes before that (clock
        // drift at a handoff), well under the 4-minute floor.
        { id: 4201, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 3 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
        { id: 4202, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 1 * 3600000 - 120000).toISOString(), departed_at: new Date(now).toISOString() },
      ];
    }, now);
    const r = await shopDedupCall();
    expect(r.dropped, 'a 2-minute overlap at a handoff is under the floor, not the same dwell logged twice').toBe(0);
    await geoRestore();
  });

  test('shop-dedup: a gap between visits (no overlap) is not a duplicate', async () => {
    await geoReset();
    const now = Date.now();
    await page.evaluate((now) => {
      window.__selShopRows = [
        { id: 4301, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 6 * 3600000).toISOString(), departed_at: new Date(now - 5 * 3600000).toISOString() },
        { id: 4302, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date(now - 2 * 3600000).toISOString(), departed_at: new Date(now - 1 * 3600000).toISOString() },
      ];
    }, now);
    const r = await shopDedupCall();
    expect(r.dropped).toBe(0);
    await geoRestore();
  });

  test('shop-dedup: fewer than two rows is a clean no-op', async () => {
    await geoReset();
    await page.evaluate(() => {
      window.__selRows = [
        { id: 4401, employee_user_id: 'geo-park-user-1',
          arrived_at: new Date().toISOString(), departed_at: new Date().toISOString() },
      ];
    });
    const r = await shopDedupCall();
    expect(r.dropped).toBe(0);
    await geoRestore();
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
  const stopSweepSeed = (rows) => page.evaluate((rows) => {
    window.__origMileage = mileage.slice(); mileage.length = 0;
    window.__origJobs = jobs.slice(); jobs.length = 0;
    window.__origClients = clients.slice(); clients.length = 0;
    window.__origExpenses = expenses.slice(); expenses.length = 0;
    window._milePersonalSweepRan = true;
    rows.forEach(r => mileage.push(r));
  }, rows);
  const stopSweepRestore = () => page.evaluate(() => {
    if (window.__origMileage) { mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null; }
    if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; }
    if (window.__origClients) { clients.length = 0; window.__origClients.forEach(c => clients.push(c)); window.__origClients = null; }
    if (window.__origExpenses) { expenses.length = 0; window.__origExpenses.forEach(e => expenses.push(e)); window.__origExpenses = null; }
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
    // no hint why (seen once locally 2026-08-24 under five full-app spec files
    // on one runner). The tests assert on `before` so a recurrence says so.
    const before = mileage.map(m => m.id);
    const fixed = await _milePersonalStopSweep();
    return { fixed, before, left: mileage.map(m => m.id) };
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

  // ── _milePersonalStopSweep pass 2: a lone leg with NO return row at all ──
  // (owner live report, 2026-08-22, 3.5mi Shop -> Stop, no return leg in the
  // log). This is the CORRECT result of the live sameSpot guard in
  // _geoDriveEntry (js/geo-track.js): landing back at the exact fence a leg
  // left from suppresses that RETURN leg's own mileage row on purpose (a
  // round trip claims no miles), which is exactly why pass 1 above, which
  // requires a partner row, can never reach this leg. _geoLastFenceLoc /
  // _geoLastFenceAt are the durable substitute for that missing partner row:
  // a real fence arrival, timestamped after this leg ended, at the same
  // place the leg left from.
  test('stop-sweep pass 2: a lone Shop -> Stop leg with no return row collapses once the device is proven back at Shop', async () => {
    await geoReset();
    const row = stopLegRows()[0]; // 'sw-inb' only, no outbound partner
    await stopSweepSeed([row, FILLER()]);
    const r = await sweepCall({ loc: { lat: SHOPX.lat, lng: SHOPX.lon, name: 'Shop' }, atIso: new Date(now() - 60000).toISOString() });
    expect(r.before, 'the seeded leg was still there when this sweep started').toEqual(['sw-inb', 'sw-filler']);
    expect(r.fixed, 'the live guard already suppressed the return row, this durable pass covers the orphaned outbound leg').toBe(1);
    expect(r.left).toEqual(['sw-filler']);
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep pass 2: a lone leg is left alone while the device has not been seen back at the origin fence since it left', async () => {
    await geoReset();
    const row = stopLegRows()[0];
    await stopSweepSeed([row, FILLER()]);
    // The last known fence arrival predates the leg's own end: still out there.
    const r = await sweepCall({ loc: { lat: SHOPX.lat, lng: SHOPX.lon, name: 'Shop' }, atIso: new Date(now() - 7200000).toISOString() });
    expect(r.fixed, 'a stale fence position from before departure proves nothing, the trip may still be in progress').toBe(0);
    expect(r.left.sort()).toEqual(['sw-filler', 'sw-inb']);
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep pass 2: a lone leg is left alone when the device is back somewhere ELSE, not the origin', async () => {
    await geoReset();
    const row = stopLegRows()[0];
    await stopSweepSeed([row, FILLER()]);
    const r = await sweepCall({ loc: { lat: BIZX.lat, lng: BIZX.lon, name: 'Ace Supply' }, atIso: new Date(now() - 60000).toISOString() });
    expect(r.fixed, 'back somewhere else is not proof this stop had nothing business in it').toBe(0);
    expect(r.left.sort()).toEqual(['sw-filler', 'sw-inb']);
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep pass 2: a receipted lone leg is still protected even with matching return-fence evidence', async () => {
    await geoReset();
    const row = stopLegRows()[0];
    await stopSweepSeed([row, FILLER()]);
    await page.evaluate(() => {
      window.__origBizReceipt = _bizReceiptForStop;
      window._bizReceiptForStop = _bizReceiptForStop = () => ({ id: 998, vendor: 'Test' });
    });
    const r = await sweepCall({ loc: { lat: SHOPX.lat, lng: SHOPX.lon, name: 'Shop' }, atIso: new Date(now() - 60000).toISOString() });
    expect(r.fixed).toBe(0);
    expect(r.left.sort()).toEqual(['sw-filler', 'sw-inb']);
    await page.evaluate(() => { _bizReceiptForStop = window._bizReceiptForStop = window.__origBizReceipt; window.__origBizReceipt = null; });
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  // ── Boot-order regression: _geoRestoreOpen must run before the sweep ──────
  // The four tests above prove pass 2's RULES are correct once
  // _geoLastFenceLoc/_geoLastFenceAt are populated. They all populate those
  // globals directly (setLastFence), which is exactly what let a real bug
  // hide behind them: on an actual boot, that state comes from
  // _geoRestoreOpen() reading localStorage's zp3_geo_open, and that call used
  // to only happen ~2.4s into boot via _geoTrackInit's own delay chain
  // (js/cloud.js _removeBootOverlay: 320ms + 700ms + 1400ms, sequenced after
  // the vehicle picker on purpose), while supaLoadFromCloud() called the
  // sweep synchronously, long before that timer chain even started. So
  // _geoLastFenceLoc was always still null when pass 2 checked it, on every
  // real boot, no matter how many times the app was relaunched (owner live
  // report 2026-08-22: force-quit and reopen made no difference). This test
  // does not set the globals directly, it seeds the SAME localStorage record
  // _geoPersistOpen would have written while genuinely standing in the shop,
  // and proves the fix: supaLoadFromCloud now calls _geoRestoreOpen() before
  // the sweep (js/cloud.js), so the sweep sees real evidence on a real boot.
  test('stop-sweep pass 2: fence evidence restored from localStorage (not set directly) still collapses the lone leg, proving the boot order fix', async () => {
    await geoReset();
    const row = stopLegRows()[0];
    await stopSweepSeed([row, FILLER()]);
    await page.evaluate(({ shopLat, shopLon, endedIso }) => {
      window._geoOpenRestored = false;   // fresh session: the one-shot restore has not run yet
      localStorage.setItem('zp3_geo_open', JSON.stringify({
        job: null, arrivedAt: null,
        wasInShop: true, shopArrivedAt: new Date(Date.now() - 30 * 60000).toISOString(),
        driveStartedAt: null, legOrigin: null,
        lastFenceLoc: { lat: shopLat, lng: shopLon, name: 'Shop' },
        lastFenceAt: endedIso,   // after the leg ended, same as the live shop_time_entries proof
        stopAnchor: null, driveMovingAt: 0, driveMiles: 0, driveSteps: 0, driveMph: 0, driveLastFix: null,
        hiddenAt: new Date().toISOString(), uid: 'geo-park-user-1', day: new Date().toISOString().slice(0, 10),
      }));
    }, { shopLat: SHOPX.lat, shopLon: SHOPX.lon, endedIso: new Date(now() - 60000).toISOString() });
    // The exact order supaLoadFromCloud now uses: restore, then sweep.
    await page.evaluate(() => { _geoRestoreOpen(); });
    const r = await sweepCall();
    expect(r.fixed, 'localStorage-restored fence evidence must reach pass 2, the same as evidence set directly').toBe(1);
    expect(r.left).toEqual(['sw-filler']);
    // Calling it again (mirroring _geoTrackInit's own later call) must be a no-op, not a second restore or a crash.
    await page.evaluate(() => { _geoRestoreOpen(); });
    await page.evaluate(() => { localStorage.removeItem('zp3_geo_open'); });
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep pass 2: with no _geoRestoreOpen call at all, a real boot leaves the lone leg unswept (documents the bug this fix closes)', async () => {
    await geoReset();
    const row = stopLegRows()[0];
    await stopSweepSeed([row, FILLER()]);
    await page.evaluate(({ shopLat, shopLon, endedIso }) => {
      window._geoOpenRestored = false;
      localStorage.setItem('zp3_geo_open', JSON.stringify({
        job: null, arrivedAt: null,
        wasInShop: true, shopArrivedAt: new Date(Date.now() - 30 * 60000).toISOString(),
        driveStartedAt: null, legOrigin: null,
        lastFenceLoc: { lat: shopLat, lng: shopLon, name: 'Shop' },
        lastFenceAt: endedIso,
        stopAnchor: null, driveMovingAt: 0, driveMiles: 0, driveSteps: 0, driveMph: 0, driveLastFix: null,
        hiddenAt: new Date().toISOString(), uid: 'geo-park-user-1', day: new Date().toISOString().slice(0, 10),
      }));
    }, { shopLat: SHOPX.lat, shopLon: SHOPX.lon, endedIso: new Date(now() - 60000).toISOString() });
    // Deliberately skip _geoRestoreOpen(): _geoLastFenceLoc stays null, exactly
    // like a sweep that runs before the old ~2.4s-delayed restore had fired.
    const r = await sweepCall();
    expect(r.fixed, 'without a restore, the evidence sitting in localStorage never reaches pass 2').toBe(0);
    expect(r.left.sort()).toEqual(['sw-filler', 'sw-inb']);
    await page.evaluate(() => { localStorage.removeItem('zp3_geo_open'); });
    await restoreLastFence();
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep: unnamed Stop, round trip back to the same origin, no business match, both legs collapse', async () => {
    await geoReset();
    await stopSweepSeed(stopLegRows());
    const r = await sweepCall();
    expect(r.fixed, 'the owner report shape: a Shop -> Stop -> Shop trip with nothing business in it').toBe(1);
    expect(r.left).toEqual([]);
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep: unnamed Stop between two DIFFERENT businesses collapses to one direct leg, not a round trip', async () => {
    await geoReset();
    const rows = [
      { id: 'sw-inb2', gps: true, legKey: 'sw-lg-3', fromCoord: { lat: SHOPX.lat, lng: SHOPX.lon }, toCoord: { lat: STOP.lat, lng: STOP.lon },
        from_name: 'Shop', to_name: 'Stop', miles: 3.5, date: todayKeySafe(), startedIso: new Date(now() - 3600000).toISOString(), endedIso: new Date(now() - 3300000).toISOString() },
      { id: 'sw-out2', gps: true, legKey: 'sw-lg-4', fromCoord: { lat: STOP.lat, lng: STOP.lon }, toCoord: { lat: BIZX.lat, lng: BIZX.lon },
        from_name: 'Stop', to_name: 'Ace Supply', miles: 6.0, date: todayKeySafe(), startedIso: new Date(now() - 3000000).toISOString(), endedIso: new Date(now() - 2700000).toISOString() },
    ];
    await stopSweepSeed(rows);
    await page.evaluate(() => { window.__origRouteDistance = _routeDistance; window._routeDistance = _routeDistance = async () => ({ miles: 5.1, mins: 12 }); });
    const r = await sweepCall();
    expect(r.fixed).toBe(1);
    expect(r.left).toEqual(['sw-out2']);
    const survivor = await page.evaluate(() => mileage.find(m => m.id === 'sw-out2'));
    expect(survivor.from_name, 'the surviving leg now runs endpoint to endpoint, origin to the far business').toBe('Shop');
    expect(survivor.passedThrough && survivor.passedThrough.stop && survivor.passedThrough.stop.name).toBe('Stop');
    await page.evaluate(() => { _routeDistance = window._routeDistance = window.__origRouteDistance; window.__origRouteDistance = null; });
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep: unnamed Stop with a same-day receipt at its pin stays, both legs survive', async () => {
    await geoReset();
    await stopSweepSeed(stopLegRows());
    await page.evaluate(() => {
      window.__origBizReceipt = _bizReceiptForStop;
      window._bizReceiptForStop = _bizReceiptForStop = () => ({ id: 999, vendor: 'Test' });
    });
    const r = await sweepCall();
    expect(r.fixed, 'a receipt at the pin is proof of business, the sweep must not touch it').toBe(0);
    expect(r.left.sort()).toEqual(['sw-inb', 'sw-out']);
    await page.evaluate(() => { _bizReceiptForStop = window._bizReceiptForStop = window.__origBizReceipt; window.__origBizReceipt = null; });
    await stopSweepRestore();
    await geoRestore();
  });

  test('stop-sweep: a genuinely blank to_name (not even the Stop placeholder) is still left alone', async () => {
    await geoReset();
    const rows = stopLegRows();
    rows[0].to_name = '';
    await stopSweepSeed(rows);
    const r = await sweepCall();
    expect(r.fixed, 'nothing to test or show for a truly empty label').toBe(0);
    expect(r.left.sort()).toEqual(['sw-inb', 'sw-out']);
    await stopSweepRestore();
    await geoRestore();
  });

  test('reconciliation: a manual clock record overlapping the window wins, nothing is written', async () => {
    await geoReset();
    const seed = await seedReconPair(886004);
    await page.evaluate((s) => {
      const t1 = Date.parse(s.A.endedIso);
      // The owner clocked this span by hand (logged_by_uid null = owner,
      // js/jobs.js clockIn convention). A human's record always wins.
      timeEntries.push({ id: 'te-1', job_id: s.jid, date: new Date().toISOString().slice(0, 10),
                         start_time: new Date(t1 + 10 * 60000).toISOString(),
                         end_time: new Date(t1 + 60 * 60000).toISOString(),
                         minutes: 50, logged_by_uid: null, logged_by_name: 'Owner', open: false });
    }, seed);
    const r = await runRecon();
    expect(r.recRows.length).toBe(0);
    expect(r.updates.length).toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  test('reconciliation: an overnight gap is never claimed (unobserved hours honesty rule)', async () => {
    await geoReset();
    // The gap ceiling is now CALENDAR DAY (Central time), not a flat
    // duration (see js/geo-track.js _geoReconcileFromMileage, owner
    // 2026-08-21). A hardcoded "14 hours ago" no longer reliably proves
    // anything: depending on the wall-clock time CI happens to run, 14 real
    // hours may or may not cross a Central-time midnight. So walk t1
    // backward from t2 using the app's own _ctDateStr until the day string
    // actually differs, this is deterministic regardless of when the test runs.
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      _geoJobCoords = {};
      const iso = (ms) => new Date(ms).toISOString();
      const t2 = Date.now() - 1 * 3600000; // leg B leaves 1h ago, same anchor every other recon test uses
      let t1 = t2;
      const STEP = 30 * 60000;
      while (_ctDateStr(new Date(t1)) === _ctDateStr(new Date(t2))) t1 -= STEP;
      const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(t1 - 3600000), endedIso: iso(t1),
                  fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date(t1).toISOString().slice(0, 10) };
      const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(t2), endedIso: iso(t2 + 1800000),
                  fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: new Date(t2).toISOString().slice(0, 10) };
      mileage.push(A, B);
      return { A: { legKey: A.legKey, endedIso: A.endedIso }, B: { startedIso: B.startedIso }, jid: String(jid) };
    }, [886005]);
    const r = await runRecon();
    expect(r.recRows.length, 'a gap crossing into a new calendar day is never claimed').toBe(0);
    expect(r.updates.length).toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner report (2026-08-21, live account): a real morning produced a
  // near-duplicate leg pair (two "Driving" rows both starting ~7:52am, ending
  // 2 minutes apart) instead of one clean leg, and the genuine 4h+ on-site
  // gap right after that pair NEVER reconciled, because the old pairer only
  // ever compared STRICTLY ADJACENT legs: the one adjacent pair spanning the
  // real gap paired the WRONG member of the duplicate cluster half the time.
  // _geoReconcileFromMileage now folds legs under the min-gap apart into one
  // cluster before pairing, and scans every member's toCoord for a job match
  // rather than trusting only whichever leg sorted last.
  test('reconciliation: a duplicate/near-duplicate leg cluster no longer blinds the pairer to the real gap after it', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      // Same-Central-day anchor + job dated to the window's own Central
      // day-key, same reasoning as the fromCoord seeds above.
      let T = Date.now();
      while (_ctDateStr(new Date(T - 5 * 3600000)) !== _ctDateStr(new Date(T))) T -= 6 * 3600000;
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _ctDateStr(new Date(T - 4.8 * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      // The morning cluster: two legs starting at the SAME instant (the
      // reported duplicate), pushed in this order so a stable sort keeps
      // legA first. Both end at the job.
      const legA = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 5 * 3600000), endedIso: iso(T - 4.833 * 3600000),
                     fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      const legA2 = { id: 'ml-A2', gps: true, legKey: 'lgA2-' + jid, startedIso: iso(T - 5 * 3600000), endedIso: iso(T - 4.8 * 3600000),
                      fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      // The real leg well after the cluster: proof the visit ended.
      const legB = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.9 * 3600000),
                     fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      mileage.push(legA, legA2, legB);
      return { legA2End: legA2.endedIso, legBStart: legB.startedIso, jid: String(jid) };
    }, [886010]);
    const r = await runRecon();
    expect(r.recRows.length, 'the gap after the duplicate cluster still reconciles').toBe(1);
    const row = r.recRows[0];
    expect(row.job_id).toBe(seed.jid);
    // Arrival anchors to the LATEST end in the cluster (the last confirmed
    // movement stop), not whichever leg happened to sort first.
    expect(row.arrived_at).toBe(seed.legA2End);
    expect(row.departed_at).toBe(seed.legBStart);
    await restoreReconSeed();
    await geoRestore();
  });

  // Same shape, but the leg that sorts adjacent to B (legA2) has a GARBAGE
  // toCoord (spotty GPS on the way out of the cluster), while its sibling
  // (legA, only reachable via the invalid same-cluster pair under the old
  // adjacency rule) has the real one. The reconciler must scan every member
  // of the cluster for a job match, not just the one leg strict adjacency
  // would have handed it.
  test('reconciliation: a cluster member with a bad toCoord does not block a sibling member from proving the arrival', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      // Same-Central-day anchor + job dated to the window's own Central
      // day-key, same reasoning as the fromCoord seeds above.
      let T = Date.now();
      while (_ctDateStr(new Date(T - 5 * 3600000)) !== _ctDateStr(new Date(T))) T -= 6 * 3600000;
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: _ctDateStr(new Date(T - 4.8 * 3600000)), days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      const legA = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 5 * 3600000), endedIso: iso(T - 4.833 * 3600000),
                     fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      // legA2 sorts second (same start as legA) and is the leg immediately
      // adjacent to legB: a GARBAGE toCoord, 20+ miles from the job.
      const legA2 = { id: 'ml-A2', gps: true, legKey: 'lgA2-' + jid, startedIso: iso(T - 5 * 3600000), endedIso: iso(T - 4.8 * 3600000),
                      fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: 39.0, lng: -95.0 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      const legB = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.9 * 3600000),
                     fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: new Date().toISOString().slice(0, 10) };
      mileage.push(legA, legA2, legB);
      return { legA2End: legA2.endedIso, legBStart: legB.startedIso, legAKey: legA.legKey, jid: String(jid) };
    }, [886011]);
    const r = await runRecon();
    expect(r.recRows.length, 'legA (the good member) still proves the arrival').toBe(1);
    const row = r.recRows[0];
    expect(row.job_id).toBe(seed.jid);
    expect(row.arrived_at).toBe(seed.legA2End);     // still the cluster's latest end
    expect(row.departed_at).toBe(seed.legBStart);
    expect(row.client_key).toBe('rec-' + seed.legAKey);  // keyed off the MATCHING member
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner report 2026-08-21 ("still not seeing the reconciliation fire, not
  // for yesterday or today"): the reconciler matched arrivals against
  // _geoMyJobs(), the LIVE fence list, which is pinned to jobs active TODAY
  // and excludes done jobs. So a window at a job scheduled yesterday, or at a
  // job since marked done (the normal finish-then-review flow), matched
  // nothing and silently never repaired, despite the 7-day leg sweep. Now
  // matched by proximity alone (_geoReconcilableJobs), no date filter at all,
  // see the overrun test below for why even a day-scoped fix wasn't enough.
  test('reconciliation: a window at YESTERDAY\'s job still reconciles today', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      // Walk back to a moment on a PREVIOUS Central day whose 4-hour window
      // sits entirely inside that day, using the app's own _ctDateStr so no
      // timezone/DST assumption is baked in.
      const today = _ctDateStr(new Date());
      let T = Date.now() - 6 * 3600000;
      while (_ctDateStr(new Date(T)) === today || _ctDateStr(new Date(T - 4 * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
      const winDay = _ctDateStr(new Date(T - 3 * 3600000));
      // The job's span was YESTERDAY (the window's day), one day only: under
      // the old _geoMyJobs matching this is invisible today, red before the fix.
      jobs.push({ id: jid, name: 'Yesterday Job', lat: JOB.lat, lon: JOB.lon, start: winDay, days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      const A = { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 4 * 3600000), endedIso: iso(T - 3 * 3600000),
                  fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: winDay };
      const B = { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T), endedIso: iso(T + 0.3 * 3600000),
                  fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: winDay };
      mileage.push(A, B);
      return { AEnd: A.endedIso, BStart: B.startedIso, jid: String(jid) };
    }, [886020]);
    const r = await runRecon();
    expect(r.recRows.length, 'yesterday\'s window repairs even though the job is not on today\'s fence list').toBe(1);
    expect(r.recRows[0].job_id).toBe(seed.jid);
    expect(r.recRows[0].arrived_at).toBe(seed.AEnd);
    expect(r.recRows[0].departed_at).toBe(seed.BStart);
    await restoreReconSeed();
    await geoRestore();
  });

  test('reconciliation: a job since marked DONE still reconciles; a cancelled one never does', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      let T = Date.now();
      while (_ctDateStr(new Date(T - 3 * 3600000)) !== _ctDateStr(new Date(T))) T -= 4 * 3600000;
      const winDay = _ctDateStr(new Date(T - 2 * 3600000));
      // Worked this morning, marked done since: the exact finish-then-review
      // flow that used to erase reconcilability (_jobActiveOn excludes done).
      jobs.push({ id: jid, name: 'Done Job', lat: JOB.lat, lon: JOB.lon, start: winDay, days: 1, status: 'done', completion_date: winDay, eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      mileage.push(
        { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 3 * 3600000), endedIso: iso(T - 2 * 3600000),
          fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: winDay },
        { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
          fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: winDay }
      );
      return { jid: String(jid) };
    }, [886021]);
    let r = await runRecon();
    expect(r.recRows.length, 'a done job\'s hours still repair').toBe(1);
    expect(r.recRows[0].job_id).toBe(seed.jid);
    // Cancelled is different: nobody worked a cancelled job, its fence must
    // never claim hours. Same window, job flipped to cancelled, zero rows.
    await page.evaluate(() => {
      jobs[0].status = 'upcoming'; delete jobs[0].completion_date; jobs[0].cancelled = true;
      window.__rec.upserts.length = 0; window.__rec.updates.length = 0;
      _geoReconBusy = false;
    });
    r = await runRecon();
    expect(r.recRows.length, 'a cancelled job never claims hours').toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  // Owner's own diagnostic paste, round two (2026-08-21): the first day-scoped
  // fix above still failed on the owner's REAL account. Evidence straight off
  // the device's tracking journal: a window at "John Doe" matched fine two
  // days running, then on the THIRD day (the exact 8am-12:29pm gap originally
  // reported) came back "no job match, 0 day jobs". The job was booked for
  // 2 days but the crew was still there on day 3, routine in trades work
  // ("supposed to be two days"), and the calendar's plan is not where the
  // truck physically was. Matching is proximity-only now (_geoReconcilableJobs,
  // no date filter at all), so an overrun day reconciles exactly like the
  // booked days on either side of it.
  test('reconciliation: a job that ran a day PAST its scheduled span still reconciles that overrun day', async () => {
    await geoReset();
    const seed = await page.evaluate(([jid]) => {
      window.__origJobs = jobs.slice(); jobs.length = 0;
      window.__origMileage = mileage.slice(); mileage.length = 0;
      window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
      const JOB = { lat: 37.6872, lon: -97.3301 };
      _geoJobCoords = {};
      let T = Date.now();
      while (_ctDateStr(new Date(T - 5 * 3600000)) !== _ctDateStr(new Date(T))) T -= 6 * 3600000;
      const overrunDay = _ctDateStr(new Date(T - 4.8 * 3600000));
      // Booked for 2 days ending the day BEFORE the window: exactly the
      // "supposed to be two days" overrun, invisible under the old
      // day-scoped match (which would find 0 jobs active on overrunDay).
      const bookedStart = new Date(new Date(overrunDay + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      jobs.push({ id: jid, name: 'Overran Job', lat: JOB.lat, lon: JOB.lon, start: bookedStart, days: 1, status: 'upcoming', eventType: 'job' });
      const iso = (ms) => new Date(ms).toISOString();
      mileage.push(
        { id: 'ml-A', gps: true, legKey: 'lgA-' + jid, startedIso: iso(T - 5 * 3600000), endedIso: iso(T - 4.8 * 3600000),
          fromCoord: { lat: 37.7500, lng: -97.4500 }, toCoord: { lat: JOB.lat, lng: JOB.lon }, miles: 9, date: overrunDay },
        { id: 'ml-B', gps: true, legKey: 'lgB-' + jid, startedIso: iso(T - 1 * 3600000), endedIso: iso(T - 0.5 * 3600000),
          fromCoord: { lat: JOB.lat, lng: JOB.lon }, toCoord: { lat: 37.7500, lng: -97.4500 }, miles: 9, date: overrunDay }
      );
      return { jid: String(jid), bookedStart, overrunDay };
    }, [886022]);
    expect(seed.bookedStart < seed.overrunDay, 'sanity: the job\'s booked span really does end before the window\'s day').toBe(true);
    const r = await runRecon();
    expect(r.recRows.length, 'the overrun day reconciles even though the job was booked for the day before').toBe(1);
    expect(r.recRows[0].job_id).toBe(seed.jid);
    await restoreReconSeed();
    await geoRestore();
  });

  // renderTimeLog's one-shot call was silently dropped whenever a GPS ping
  // happened to be mid-flight (_geoPingBusy), which on a phone with live
  // tracking is exactly when someone opens Time Log right after a drive. The
  // return value is the retry signal: false = skipped, retry; anything else =
  // the pass ran (found work or legitimately found none).
  test('reconciliation: returns false when skipped for a busy ping, non-false when it actually runs', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      _geoPingBusy = true;
      const skipped = await _geoReconcileFromMileage();
      _geoPingBusy = false;
      const ran = await _geoReconcileFromMileage();
      return { skipped, ran };
    });
    expect(r.skipped, 'a ping in flight skips the pass and says so').toBe(false);
    expect(r.ran, 'an idle pass never reads as skipped').not.toBe(false);
    await geoRestore();
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
    test('_geoCloseEntry (job)', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        const arrived = new Date(Date.now() - 10 * 60000).toISOString();
        _geoArrivedAt = arrived; await _geoCloseEntry(991001, new Date().toISOString());
        _geoArrivedAt = arrived; await _geoCloseEntry(991001, new Date().toISOString());
        const otherArrived = new Date(Date.now() - 30 * 60000).toISOString();
        _geoArrivedAt = otherArrived; await _geoCloseEntry(991001, new Date().toISOString());
        await new Promise(res => setTimeout(res, 60));
        const rows = window.__rec.upserts.filter(u => u.tbl === 'job_time_entries').map(u => u.row.client_key);
        return { rows };
      });
      expect(r.rows.length).toBe(3);
      expect(r.rows[0]).toBe(r.rows[1]);
      expect(r.rows[0]).not.toBe(r.rows[2]);
      await geoRestore();
    });

    test('_geoCloseShopEntry (shop)', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        const arrived = new Date(Date.now() - 10 * 60000).toISOString();
        _geoCloseShopEntry(arrived, new Date().toISOString());
        _geoCloseShopEntry(arrived, new Date().toISOString());
        await new Promise(res => setTimeout(res, 60));
        const rows = window.__rec.upserts.filter(u => u.tbl === 'shop_time_entries').map(u => u.row.client_key);
        return { rows };
      });
      expect(r.rows.length).toBe(2);
      expect(r.rows[0]).toBeTruthy();
      expect(r.rows[0]).toBe(r.rows[1]);
      await geoRestore();
    });

    test('_geoClosePlaceEntry (place)', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        const arrived = new Date(Date.now() - 10 * 60000).toISOString();
        _geoClosePlaceEntry(991002, arrived, new Date().toISOString());
        _geoClosePlaceEntry(991002, arrived, new Date().toISOString());
        await new Promise(res => setTimeout(res, 60));
        const rows = window.__rec.upserts.filter(u => u.tbl === 'job_time_entries').map(u => u.row.client_key);
        return { rows };
      });
      expect(r.rows.length).toBe(2);
      expect(r.rows[0]).toBe(r.rows[1]);
      await geoRestore();
    });

    test('_geoCloseClientEntry (client)', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        const arrived = new Date(Date.now() - 10 * 60000).toISOString();
        _geoCloseClientEntry(991003, arrived, new Date().toISOString());
        _geoCloseClientEntry(991003, arrived, new Date().toISOString());
        await new Promise(res => setTimeout(res, 60));
        const rows = window.__rec.upserts.filter(u => u.tbl === 'job_time_entries').map(u => u.row.client_key);
        return { rows };
      });
      expect(r.rows.length).toBe(2);
      expect(r.rows[0]).toBe(r.rows[1]);
      await geoRestore();
    });

    test('_geoCloseStop (stop)', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        // Fixed mid-day Central timestamps, not now-relative ones: a relative
        // pair straddles Central midnight when CI happens to run in that
        // window, and the midnight guard below would then (correctly) refuse
        // the row and flake this test.
        const at = '2026-08-21T15:00:00.000Z';       // 10:00am CT
        const lastAt = '2026-08-21T15:07:00.000Z';   // 7 min, clears _GEO_STOP_MS
        _geoCloseStop({ at, lastAt, lat: 37.7, lng: -97.3, legClosed: true });
        _geoCloseStop({ at, lastAt, lat: 37.7, lng: -97.3, legClosed: true });
        await new Promise(res => setTimeout(res, 60));
        const rows = window.__rec.upserts.filter(u => u.tbl === 'job_time_entries' && u.row.source === 'stop').map(u => u.row.client_key);
        return { rows };
      });
      expect(r.rows.length).toBe(2);
      expect(r.rows[0]).toBeTruthy();
      expect(r.rows[0]).toBe(r.rows[1]);
      await geoRestore();
    });

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

    // Owner report 2026-08-24 (Wed 8/12): a visit read 1:06pm to 9:37pm
    // because the app woke at 9:37pm and flushed the whole day's queue at
    // once, five records inside 21ms, and the shutdown close stamped `now`.
    // A close with no verified departure must use the last OBSERVED in-fence
    // ping instead, and write nothing at all when there isn't one.
    test('_geoCloseEntry with no departure closes at the last VERIFIED ping, never now', async () => {
      await geoReset();
      const r = await page.evaluate(async () => {
        window.__rec.upserts.length = 0;
        _geoArrivedAt = '2026-08-12T18:06:57.587Z';
        _geoLastFenceAt = '2026-08-12T22:15:00.000Z';   // last ping seen on site
        await _geoCloseEntry('job-8-12');
        await new Promise(res => setTimeout(res, 60));
        const row = (window.__rec.upserts.find(u => u.tbl === 'job_time_entries') || {}).row || null;
        return { row };
      });
      expect(r.row, 'the visit is written').toBeTruthy();
      expect(r.row.departed_at, 'the observed ping, not the flush instant').toBe('2026-08-12T22:15:00.000Z');
      expect(r.row.minutes, '18:06:57.587Z to 22:15Z, rounded').toBe(248);
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

    // ── _geoRepairStopRows: the one-shot 2026-08 incident repair ────────────
    // Seed rows modeled on the ACTUAL corruption polled from the live
    // database 2026-08-24: a merge- survivor exactly duplicating the
    // reconciled work row it bridged, stops stretched across midnight, and a
    // stop stretched sideways on top of real on-site time.
    test.describe('_geoRepairStopRows', () => {
      const EMP = 'geo-park-user-1';
      const seedIncident = () => ([
        // The real 8/21 shape: reconciled full-day work row (KEEP)...
        { id: 'rec1', employee_user_id: EMP, job_id: 'j1', dest_place: null, source: 'geofence-reconciled', client_key: 'rec-abc', arrived_at: '2026-08-21T12:55:00.000Z', departed_at: '2026-08-21T22:07:00.000Z' },
        // ...its merge- duplicate spanning the identical window (DROP: double-count)...
        { id: 'mrg1', employee_user_id: EMP, job_id: null, dest_place: 'John Doe', source: 'place', client_key: 'merge-mrg1', arrived_at: '2026-08-21T12:55:00.000Z', departed_at: '2026-08-21T22:07:00.000Z' },
        // ...a stop stretched over the same work window (DROP: on-site wins)...
        { id: 'st1', employee_user_id: EMP, job_id: null, dest_place: null, source: 'stop', client_key: 'k-st1', arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T22:07:00.000Z' },
        // ...and the overnight monster crossing Central midnight (DROP).
        { id: 'ov1', employee_user_id: EMP, job_id: null, dest_place: null, source: 'stop', client_key: 'k-ov1', arrived_at: '2026-08-21T22:14:00.000Z', departed_at: '2026-08-22T15:28:00.000Z' },
        // A legit same-day lunch stop in open air (KEEP).
        { id: 'ok1', employee_user_id: EMP, job_id: null, dest_place: null, source: 'stop', client_key: 'k-ok1', arrived_at: '2026-08-22T17:00:00.000Z', departed_at: '2026-08-22T17:45:00.000Z' },
        // Two stops claiming the same window: the shorter is the artifact
        // (DROP ss2, KEEP ss1).
        { id: 'ss1', employee_user_id: EMP, job_id: null, dest_place: null, source: 'stop', client_key: 'k-ss1', arrived_at: '2026-08-22T20:00:00.000Z', departed_at: '2026-08-22T23:53:00.000Z' },
        { id: 'ss2', employee_user_id: EMP, job_id: null, dest_place: null, source: 'stop', client_key: 'k-ss2', arrived_at: '2026-08-22T20:15:00.000Z', departed_at: '2026-08-22T21:53:00.000Z' },
        // A merge- row NOTHING else covers (the real 8/14 335m case): kept,
        // deleting it would erase hours no other row ever recorded.
        { id: 'mrg2', employee_user_id: EMP, job_id: null, dest_place: 'John Doe', source: 'place', client_key: 'merge-mrg2', arrived_at: '2026-08-14T16:58:00.000Z', departed_at: '2026-08-14T22:33:00.000Z' },
      ]);

      test('deletes exactly the incident fingerprints, keeps everything real, then marks itself done', async () => {
        await geoReset();
        const r = await page.evaluate(async (rows) => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = rows;
          const n = await _geoRepairStopRows();
          const deleted = window.__rec.deletes.filter(d => d.tbl === 'job_time_entries' && d.col === 'id').map(d => d.val).sort();
          return { n, deleted, flag: !!localStorage.getItem('td_geo_stop_repair_v1') };
        }, seedIncident());
        expect(r.deleted).toEqual(['mrg1', 'ov1', 'ss2', 'st1']);
        expect(r.n).toBe(4);
        expect(r.flag, 'one-shot flag set after a clean pass').toBe(true);
        await geoRestore();
      });

      // The Fri 8/21 forensic rebuild: the merge survivor becomes the
      // morning visit (7:55am-11:37am), the stretched lunch stop is trimmed
      // back to what the raw GPS pings recorded (11:42am-12:31pm), and the
      // afternoon visit (12:45pm-5:07pm) is re-inserted. Keyed to the exact
      // live client_keys, so only the real corrupted rows ever match.
      test('rebuilds Fri 8/21 from the ping record instead of deleting the lunch', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [
            { id: 'live-merge', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place', client_key: 'merge-27962a20-be14-495b-b172-c0b4b8fccb22', arrived_at: '2026-08-21T12:55:55.101Z', departed_at: '2026-08-21T22:07:06.228Z' },
            { id: 'live-stop', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: null, source: 'stop', client_key: '30a2b589-mt386omz-3bm8', arrived_at: '2026-08-21T16:42:09.105Z', departed_at: '2026-08-21T22:07:06.228Z' },
            { id: 'live-ov', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: null, source: 'stop', client_key: '30a2b589-vis-stop-x-mt3oxudw', arrived_at: '2026-08-21T22:14:11.676Z', departed_at: '2026-08-22T15:28:29.104Z' },
          ];
          const n = await _geoRepairStopRows();
          const upd = window.__rec.updates.filter(u => u.tbl === 'job_time_entries');
          const ins = window.__rec.inserts.filter(i => i.tbl === 'job_time_entries');
          const del = window.__rec.deletes.filter(d => d.tbl === 'job_time_entries').map(d => d.val);
          return { n, upd, ins, del, flag: !!localStorage.getItem('td_geo_stop_repair_v1') };
        });
        // Morning: trimmed to the confirmed 11:37am fence exit, re-keyed.
        const am = r.upd.find(u => u.filters.id === 'live-merge');
        expect(am).toBeTruthy();
        expect(am.patch.departed_at).toBe('2026-08-21T16:37:00.000Z');
        expect(am.patch.minutes).toBe(221);
        expect(am.patch.client_key).toBe('repair-0821-am');
        // Lunch: kept, trimmed back to the ping-recorded departure.
        const lunch = r.upd.find(u => u.filters.id === 'live-stop');
        expect(lunch).toBeTruthy();
        expect(lunch.patch.departed_at).toBe('2026-08-21T17:31:46.000Z');
        expect(lunch.patch.minutes).toBe(50);
        expect(r.del, 'the lunch stop is never deleted').not.toContain('live-stop');
        // Afternoon: rebuilt.
        expect(r.ins.length).toBe(1);
        expect(r.ins[0].row.client_key).toBe('repair-0821-pm');
        expect(r.ins[0].row.arrived_at).toBe('2026-08-21T17:45:50.000Z');
        expect(r.ins[0].row.departed_at).toBe('2026-08-21T22:07:06.228Z');
        // The overnight monster still dies.
        expect(r.del).toContain('live-ov');
        expect(r.flag).toBe(true);
        await geoRestore();
      });

      // Mon 8/17: the missed 8:18am arrival is repaired by EXTENDING the
      // surviving 4:23pm live row back to the arrival (one continuous visit,
      // one card, owner question 2026-08-24), never by inserting a second
      // row split at 4:23. Gated on that row's own client_key so it can
      // never fire anywhere else, and a re-run sees it already extended.
      test('extends the Mon 8/17 live row back to the 8:18am arrival, one entry', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [
            { id: 'mon-live', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place', client_key: '30a2b589-msxzqfrk-e7xe', arrived_at: '2026-08-17T21:23:25.093Z', departed_at: '2026-08-17T22:17:14.161Z' },
          ];
          const n = await _geoRepairStopRows();
          const upd = window.__rec.updates.filter(u => u.tbl === 'job_time_entries');
          const ins = window.__rec.inserts.filter(i => i.tbl === 'job_time_entries');
          return { n, upd, inserts: ins.length };
        });
        expect(r.inserts, 'extended, never a second card').toBe(0);
        const mon = r.upd.find(u => u.filters.id === 'mon-live');
        expect(mon).toBeTruthy();
        expect(mon.patch.arrived_at).toBe('2026-08-17T13:18:28.100Z');
        expect(mon.patch.minutes).toBe(539);
        await geoRestore();
      });

      test('Mon 8/17 row already extended (re-run) or absent (other account): untouched', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [
            // Already extended: arrival at the repaired timestamp.
            { id: 'mon-live', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place', client_key: '30a2b589-msxzqfrk-e7xe', arrived_at: '2026-08-17T13:18:28.100Z', departed_at: '2026-08-17T22:17:14.161Z' },
            { id: 'other', employee_user_id: 'someone-else', job_id: null, dest_place: 'Elsewhere', source: 'place', client_key: 'unrelated-key', arrived_at: '2026-08-17T15:00:00.000Z', departed_at: '2026-08-17T16:00:00.000Z' },
          ];
          const n = await _geoRepairStopRows();
          return { n, updates: window.__rec.updates.filter(u => u.tbl === 'job_time_entries').length,
                   inserts: window.__rec.inserts.filter(i => i.tbl === 'job_time_entries').length };
        });
        expect(r.updates).toBe(0);
        expect(r.inserts).toBe(0);
        await geoRestore();
      });

      // Found by the read-only dry run against the live data (2026-08-24): a
      // stop stretched over hours of recorded SHOP presence, invisible to
      // the job_time_entries fetch alone.
      test('a stop lying over a shop session is dropped', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [
            { id: 'shop-stop', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: null, source: 'stop', client_key: 'k-shopstop', arrived_at: '2026-08-22T17:12:06.546Z', departed_at: '2026-08-22T21:05:13.027Z' },
            { id: 'gap-stop', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: null, source: 'stop', client_key: 'k-gapstop', arrived_at: '2026-08-22T21:05:13.027Z', departed_at: '2026-08-22T21:22:18.110Z' },
          ];
          window.__selShopRows = [
            { employee_user_id: 'geo-park-user-1', arrived_at: '2026-08-22T17:48:36.614Z', departed_at: '2026-08-22T20:30:58.244Z' },
          ];
          const n = await _geoRepairStopRows();
          const del = window.__rec.deletes.filter(d => d.tbl === 'job_time_entries').map(d => d.val);
          return { n, del };
        });
        expect(r.del).toContain('shop-stop');
        expect(r.del, 'the stop with no shop overlap survives').not.toContain('gap-stop');
        await geoRestore();
      });

      test('a re-run after the rebuild already landed never double-inserts the afternoon row', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [
            { id: 'am', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place', client_key: 'repair-0821-am', arrived_at: '2026-08-21T12:55:55.101Z', departed_at: '2026-08-21T16:37:00.000Z' },
            { id: 'lunch', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: null, source: 'stop', client_key: '30a2b589-mt386omz-3bm8', arrived_at: '2026-08-21T16:42:09.105Z', departed_at: '2026-08-21T17:31:46.000Z' },
            { id: 'pm', employee_user_id: 'geo-park-user-1', job_id: null, dest_place: 'John Doe', source: 'place', client_key: 'repair-0821-pm', arrived_at: '2026-08-21T17:45:50.000Z', departed_at: '2026-08-21T22:07:06.228Z' },
          ];
          const n = await _geoRepairStopRows();
          const ins = window.__rec.inserts.filter(i => i.tbl === 'job_time_entries');
          const del = window.__rec.deletes.filter(d => d.tbl === 'job_time_entries');
          return { n, inserts: ins.length, deletes: del.length };
        });
        expect(r.inserts, 'no duplicate afternoon insert').toBe(0);
        expect(r.deletes, 'the corrected day has nothing left to delete').toBe(0);
        await geoRestore();
      });

      test('one-shot: once the flag is set, a second call touches nothing', async () => {
        await geoReset();
        const r = await page.evaluate(async (rows) => {
          localStorage.setItem('td_geo_stop_repair_v1', new Date().toISOString());
          window.__selRows = rows;
          const n = await _geoRepairStopRows();
          return { n, deletes: window.__rec.deletes.length };
        }, seedIncident());
        expect(r.n).toBe(0);
        expect(r.deletes).toBe(0);
        await geoRestore();
      });

      test('an employee device never runs the repair (RLS: no delete grant)', async () => {
        await geoReset();
        const r = await page.evaluate(async (rows) => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window._isEmployee = true;
          window.__selRows = rows;
          const n = await _geoRepairStopRows();
          const out = { n, deletes: window.__rec.deletes.length, flag: !!localStorage.getItem('td_geo_stop_repair_v1') };
          window._isEmployee = false;
          return out;
        }, seedIncident());
        expect(r.n).toBe(0);
        expect(r.deletes).toBe(0);
        expect(r.flag, 'flag stays unset so the OWNER device still repairs').toBe(false);
        await geoRestore();
      });

      test('a fetch error leaves the flag unset so the next boot retries', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = []; window.__selErr = { message: 'network down' };
          const n = await _geoRepairStopRows();
          window.__selErr = null;
          return { n, flag: !!localStorage.getItem('td_geo_stop_repair_v1') };
        });
        expect(r.n).toBe(0);
        expect(r.flag).toBe(false);
        await geoRestore();
      });

      test('an already-clean window (no rows) marks itself done without deleting', async () => {
        await geoReset();
        const r = await page.evaluate(async () => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = [];
          const n = await _geoRepairStopRows();
          return { n, deletes: window.__rec.deletes.length, flag: !!localStorage.getItem('td_geo_stop_repair_v1') };
        });
        expect(r.n).toBe(0);
        expect(r.deletes).toBe(0);
        expect(r.flag).toBe(true);
        await geoRestore();
      });

      test('concurrent calls: the busy guard lets exactly one pass run', async () => {
        await geoReset();
        const r = await page.evaluate(async (rows) => {
          localStorage.removeItem('td_geo_stop_repair_v1');
          window.__selRows = rows;
          const results = await Promise.all([_geoRepairStopRows(), _geoRepairStopRows(), _geoRepairStopRows()]);
          const deleted = window.__rec.deletes.filter(d => d.tbl === 'job_time_entries').map(d => d.val);
          return { results, deleted: deleted.sort() };
        }, seedIncident());
        expect(r.deleted, 'no double-deletes from overlapping passes').toEqual(['mrg1', 'ov1', 'ss2', 'st1']);
        await geoRestore();
      });
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
