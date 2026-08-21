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
    localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_open');
    localStorage.removeItem('zp3_geo_manual'); localStorage.removeItem('zp3_geo_prune_day');
    _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
    _geoDriveStartedAt = null; _geoGapHiddenAt = null; _geoExitPending = null;
    _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
    _geoStopAnchor = null; _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoLegOrigin = null;
    _geoLegAtShop = false; _geoHomeDwell = null; _geoWasAtHome = false; _geoDrivebyRun = 0;
    _geoParkCluster = null; _geoSoftJob = null; _geoSoftJobSpeedRun = 0; _geoParkBackdate = null;
    _geoLastPingTs = 0; _geoPingBusy = false; _geoDriveReset();
    if (typeof _geoReconBusy !== 'undefined') _geoReconBusy = false;
    window._isEmployee = false;
    window._supaUser = { id: 'geo-park-user-1', email: 'p@t.com' };
    window.__rec = { upserts: [], inserts: [], deletes: [], updates: [] };
    window.__selRows = []; window.__selErr = null;
    window.__origSupa = window.__origSupa || window._supa;
    window._supa = {
      from: (tbl) => ({
        select: () => {
          const q = {
            eq: () => q, neq: () => q, lt: () => q, gt: () => q, gte: () => q, lte: () => q,
            in: () => q, is: () => q, order: () => q, limit: () => q,
            then: (res, rej) => Promise.resolve({ data: (window.__selRows || []), error: (window.__selErr || null) }).then(res, rej),
          };
          return q;
        },
        upsert: (row, opts) => { window.__rec.upserts.push({ tbl, row, opts }); return Promise.resolve({ error: null }); },
        insert: (row) => { window.__rec.inserts.push({ tbl, row }); return Promise.resolve({ error: null }); },
        update: (patch) => ({ eq: (col, val) => { window.__rec.updates.push({ tbl, patch, col, val }); return Promise.resolve({ data: null, error: null }); } }),
        delete: () => ({ eq: () => ({ lt: () => ({ then: (res) => { res && res({}); return { catch: () => {} }; } }) }) }),
      }),
    };
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

  // ── Reconciliation ──────────────────────────────────────────────────────────

  // Two auto legs anchored at the same job: A arrives at T-3h, B leaves from
  // the same spot at T-1h, so the 2-hour window between them is on-site time.
  // Seeds the job + mileage and snapshots what it replaced.
  const seedReconPair = (jobId, opts) => page.evaluate(([jid, o]) => {
    window.__origJobs = jobs.slice(); jobs.length = 0;
    window.__origMileage = mileage.slice(); mileage.length = 0;
    window.__origTimeEntries = timeEntries.slice(); timeEntries.length = 0;
    const JOB = { lat: 37.6872, lon: -97.3301 };
    jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
    _geoJobCoords = {};
    const T = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const gapHrs = (o && o.gapHrs) || 2;
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
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      _geoJobCoords = {};
      const T = Date.now();
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
      jobs.push({ id: jid, name: 'Recon Job', lat: JOB.lat, lon: JOB.lon, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      _geoJobCoords = {};
      const T = Date.now();
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

  test('reconciliation: a window the server already covers writes nothing', async () => {
    await geoReset();
    const seed = await seedReconPair(886002);
    await page.evaluate((s) => {
      window.__selRows = [{ id: 11, client_key: 'k11', job_id: s.jid, arrived_at: s.A.endedIso, departed_at: s.B.startedIso, minutes: 120, source: 'geofence' }];
    }, seed);
    const r = await runRecon();
    expect(r.recRows.length).toBe(0);
    expect(r.updates.length).toBe(0);
    await restoreReconSeed();
    await geoRestore();
  });

  test('reconciliation: a truncated geofence row for the same job is EXTENDED to the union, not doubled', async () => {
    await geoReset();
    const seed = await seedReconPair(886003);
    // The owner's screenshot case: a 9-minute row for what was a 2-hour visit.
    await page.evaluate((s) => {
      const t1 = Date.parse(s.A.endedIso);
      window.__selRows = [{ id: 77, client_key: 'k77', job_id: s.jid, arrived_at: s.A.endedIso,
                            departed_at: new Date(t1 + 9 * 60000).toISOString(), minutes: 9, source: 'geofence' }];
    }, seed);
    const r = await runRecon();
    expect(r.updates.length, 'the stub row was extended in place').toBe(1);
    const u = r.updates[0];
    expect(u.tbl).toBe('job_time_entries');
    expect(u.col).toBe('id');
    expect(u.val).toBe(77);
    expect(u.patch.arrived_at).toBe(seed.A.endedIso);          // union start = the row's own arrival
    expect(u.patch.departed_at).toBe(seed.B.startedIso);       // union end = when leg B pulled away
    expect(u.patch.minutes).toBe(120);
    expect(u.patch.source).toBe('geofence-reconciled');
    expect(r.recRows.length, 'no second overlapping row stacked on the stub').toBe(0);
    await restoreReconSeed();
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

  test('no console errors during park/reconcile tests', async () => {
    assertNoErrors(page, 'geo park/reconcile');
  });
});
