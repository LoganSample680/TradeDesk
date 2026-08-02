// @ts-check
// ── Every drive leg a working day can contain ────────────────────────────────
//
// Owner question (2026-08-01): "Are we grabbing drive time between shop and job
// or job to job, or supply house to job or supply house to shop... there's so
// many iterations of automated driving logs and they all need to calculate down
// to the minute."
//
// There are four things that can contain a truck, so there are sixteen ordered
// pairs of them, and every one is a real trip somebody drives:
//
//        to →   SHOP      PLACE     JOB       STOP
//   SHOP        S→S       S→P       S→J       S→U
//   PLACE       P→S       P→P       P→J       P→U
//   JOB         J→S       J→P       J→J       J→U
//   STOP        U→S       U→P       U→J       U→U
//
// SHOP is the contractor's own yard, PLACE is a saved location (supply house,
// home office), JOB is a scheduled job's fence, STOP is a dwell of 5+ minutes
// somewhere the app has never heard of (lunch).
//
// Each pair is driven TWICE, because the app sees the world through GPS pings
// and the number of pings changes what it knows:
//
//   • VIA THE ROAD, a ping lands outside everything between the two fences.
//     The machine sees a departure and then an arrival.
//   • DIRECT, the next ping after the origin fence already lands inside the
//     destination fence. This is not an edge case: a phone in a pocket
//     backgrounds, and pings arrive minutes apart, so a 15-minute drive
//     routinely produces no ping in between.
//
// Both have to log the same trip. A leg that only exists when the GPS happened
// to sample mid-drive is a mileage deduction that depends on luck.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Far enough apart that no fence overlaps another (the job fence is 600ft).
const SHOP  = { lat: 39.0000, lon: -95.0000 };
const PLACE = { lat: 39.0300, lon: -95.0300 };
const JOB1  = { lat: 39.0600, lon: -95.0600 };
const JOB2  = { lat: 39.0900, lon: -95.0900 };
const STOP  = { lat: 39.1200, lon: -95.1200 };
// A second unknown stop, so stop -> stop is a real trip rather than sitting still.
const STOP2 = { lat: 39.1500, lon: -95.1500 };
const ROAD  = { lat: 39.4000, lon: -95.4000 };
// Waypoints for the all-day run. Two constraints, and the second is easy to get
// wrong: every minute of driving must move more than the 350ft stationary radius
// (these are 1,100-3,400 ft/min), AND no route may pass through another fence.
// An evenly-spaced diagonal fails the second: the job-to-lunch line ran straight
// through the supply yard, so the machine correctly split that drive in two and
// dropped the sub-2-minute pass-through, losing three minutes from the day. The
// bug was the test's geometry, not the app. These four are deliberately
// non-collinear.
const DAY_SHOP   = { lat: 40.0000, lon: -96.0000 };
const DAY_JOB    = { lat: 40.0800, lon: -96.0000 };   // due north of the shop
const DAY_SUPPLY = { lat: 40.0000, lon: -96.1000 };   // due west of the shop
const DAY_LUNCH  = { lat: 40.1000, lon: -96.1200 };   // north-west, off every line

test.describe('Drive matrix: every origin to every destination', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    // One fixture set for the whole matrix.
    await page.evaluate((d) => {
      S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
      S.teamTracking = true;
      if (typeof places !== 'undefined') places.length = 0;
      // Explicit id so the per-leg rebuild below can top this same row up
      // rather than stacking a duplicate at the same coordinate.
      savePlace({ id: 'matrix-supply', name: 'Matrix Supply', kind: 'supply', lat: d.PLACE.lat, lon: d.PLACE.lon, confirmedBy: 'manual' });
      // The all-day run drives its own widely-spaced waypoints, so its supply
      // house needs a row of its own or that dwell resolves to nothing.
      savePlace({ name: 'All-day Supply', kind: 'supply', lat: d.DAY_SUPPLY.lat, lon: d.DAY_SUPPLY.lon, confirmedBy: 'manual' });
      jobs.length = 0;
      jobs.push({ id: 8801, name: 'Matrix Job 1', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: d.JOB1.lat, lon: d.JOB1.lon });
      jobs.push({ id: 8802, name: 'Matrix Job 2', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: d.JOB2.lat, lon: d.JOB2.lon });
      // ── Why the places fixture went missing, when it goes missing ──────────
      // `shop → place` failed once on WebKit with places:0 and then passed on a
      // re-run (2026-08-02), so something empties this array intermittently and
      // a bare count cannot say what. Two suspects, and they leave different
      // fingerprints:
      //   • the sync fabric's td_places setter clears IN PLACE and refills, so
      //     the array object survives and this tag is still on it
      //   • the account-switch and sign-out paths REASSIGN places=[], so the
      //     tagged array is thrown away entirely
      // The sampler catches an emptiness that lasts long enough for a test to
      // read it, which is exactly the case that fails. A wipe and refill inside
      // one synchronous turn is invisible to it AND to the test, so it is not
      // the bug being hunted.
      places.__matrixTag = 'seed';
      window.__placeLog = [{ n: places.length, tagged: true, t: Date.now() }];
      window.__placeWatch = setInterval(() => {
        const arr = (typeof places !== 'undefined' && places) ? places : null;
        const n = arr ? arr.length : -1;
        const tagged = !!(arr && arr.__matrixTag === 'seed');
        const last = window.__placeLog[window.__placeLog.length - 1];
        if (!last || last.n !== n || last.tagged !== tagged) window.__placeLog.push({ n, tagged, t: Date.now() });
      }, 25);
    }, { SHOP, PLACE, JOB1, JOB2, DAY_SUPPLY });
  });
  test.afterAll(async () => {
    try { await page.evaluate(() => clearInterval(window.__placeWatch)); } catch (e) {}
    await page.context().close();
  });

  // Drive one ordered pair and return the drive rows it produced.
  //   from/to: 'shop' | 'place' | 'job1' | 'job2' | 'stop'
  //   viaRoad: whether a ping lands outside every fence in between
  // The origin is established, then the clock is rewound by `mins` so the leg
  // clears the 2-minute floor, then the destination ping lands.
  async function leg(from, to, viaRoad, mins) {
    return page.evaluate(async ({ from, to, viaRoad, mins, C }) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _supaUser = { id: 'u-matrix' };
      _geoEnqueue = (tbl, row) => rows.push(row);
      const K = { shop: 'SHOP', place: 'PLACE', job1: 'JOB1', job2: 'JOB2', stop: 'STOP' };
      const at = (n) => C[K[n]];
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      // Rewind whatever clock is currently open by `m` minutes, so a trip that
      // takes seconds in a test reads as a real one. _geoLastFenceAt is rewound
      // too: on a DIRECT transition that timestamp IS the leg start.
      const rewind = (m) => {
        const t = new Date(Date.now() - m * 60000).toISOString();
        if (_geoDriveStartedAt) _geoDriveStartedAt = t;
        if (_geoLastFenceAt) _geoLastFenceAt = t;
      };
      // Park the truck: dwelt `mins` minutes, and pulled out `agoMins` ago.
      // Both edges of a stop are load-bearing. The inbound leg is split off AT
      // the moment they parked and the outbound leg starts when they pulled out,
      // so setting one without the other produces a negative leg.
      const setStop = (mins, agoMins) => {
        if (!_geoStopAnchor) return;
        _geoStopAnchor.at = new Date(Date.now() - (agoMins + mins) * 60000).toISOString();
        _geoStopAnchor.lastAt = new Date(Date.now() - agoMins * 60000).toISOString();
      };
      const DWELL = 40;
      try {
        // Clean machine, or the previous pair's open leg bleeds into this one.
        //
        // Later tests in this file PUSH jobs and rewrite S.officeLat, and every
        // one of them depends on the shop fence and today's job list still being
        // what beforeAll set. Rebuilding the fixture per leg costs nothing and
        // removes a whole class of "this passed alone and failed in the suite".
        S.officeLat = C.SHOP.lat; S.officeLon = C.SHOP.lon;
        S.teamTracking = true;
        jobs.length = 0;
        jobs.push({ id: 8801, name: 'Matrix Job 1', eventType: 'job', status: 'upcoming',
                    start: todayKey(), days: 1, lat: C.JOB1.lat, lon: C.JOB1.lon });
        jobs.push({ id: 8802, name: 'Matrix Job 2', eventType: 'job', status: 'upcoming',
                    start: todayKey(), days: 1, lat: C.JOB2.lat, lon: C.JOB2.lon });
        // PLACES TOO. This rebuild already covered jobs and the shop fence for
        // exactly the reason in the comment above, and places were the one
        // fixture left out: `shop → place` failed once on WebKit with places:0
        // and passed on a straight re-run (2026-08-02). The app empties this
        // array on an account switch or a sign-out, which is correct behaviour,
        // and the beforeAll seeds it once, so anything that fires between the
        // two leaves every later place leg with nothing to arrive at. Idempotent:
        // savePlace updates in place when the id already exists.
        if (typeof places !== 'undefined' && !places.some(p => String(p.id) === 'matrix-supply')) {
          savePlace({ id: 'matrix-supply', name: 'Matrix Supply', kind: 'supply',
                      lat: C.PLACE.lat, lon: C.PLACE.lon, confirmedBy: 'manual' });
        }
        _geoJobCoords = {};        // keyed by job id, so a rebuilt jobs array needs a fresh cache
        _geoPingBusy = false;      // a ping dropped by the re-entrancy guard logs nothing at all
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        _geoHomeDwell = null; _geoWasAtHome = false;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}

        // ── establish the origin ──
        if (from === 'stop') {
          await ping(C.ROAD);
          await ping(C.STOP);
          await ping({ lat: C.STOP.lat + 0.00004, lon: C.STOP.lon });
          setStop(DWELL, mins);            // dwelt 40 min, pulled out `mins` ago
        } else {
          await ping(at(from));
        }
        rows.length = 0;                    // ignore anything the setup logged

        // ── travel ──
        if (viaRoad) { await ping(C.ROAD); }
        if (from !== 'stop') rewind(mins);
        if (to === 'stop') {
          await ping(C.STOP2);
          setStop(DWELL, 0);               // parked 40 min, still there
          // They drove `mins` to get here and have sat DWELL since, so the leg
          // must start before both.
          _geoDriveStartedAt = new Date(Date.now() - (mins + DWELL) * 60000).toISOString();
          await ping(C.ROAD);              // leaving settles the stop + its inbound leg
        } else {
          await ping(at(to));
        }
        return {
          drives: rows.filter(r => /^drive/.test(r.source || '')).map(r => ({ m: r.minutes, dest: r.dest_place, job: r.job_id })),
          // Self-diagnosing on purpose: this spec has failed on WebKit only,
          // which cannot be run in the dev container, so a bare "expected 1 got
          // 0" costs a full CI round trip per guess. The machine state names the
          // link that broke: no fence matched, no origin recorded, no leg opened.
          dbg: { shop: [S.officeLat, S.officeLon], jobs: jobs.length, places: (places || []).length,
                 // 'seed' means the array the fixture filled is still the live
                 // one and something emptied it in place; 'REPLACED' means the
                 // whole array was swapped out, which only the account-switch
                 // and sign-out paths do.
                 placesTag: (places && places.__matrixTag) || 'REPLACED',
                 placeLog: (window.__placeLog || []).slice(-6),
                 fenceJob: _geoCurrentJob, inShop: _geoWasInShop, place: _geoCurrentPlace,
                 legOrigin: _geoLegOrigin && _geoLegOrigin.kind, lastFence: !!_geoLastFenceLoc,
                 driveOpen: !!_geoDriveStartedAt, pingBusy: _geoPingBusy, user: !!_supaUser },
          all: rows.map(r => r.source + ':' + r.minutes),
        };
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
    }, { from, to, viaRoad, mins, C: { SHOP, PLACE, JOB1, JOB2, STOP, STOP2, ROAD } });
  }

  const PAIRS = [
    ['shop', 'job1'], ['shop', 'place'], ['shop', 'stop'], ['shop', 'shop'],
    ['place', 'job1'], ['place', 'shop'], ['place', 'place'], ['place', 'stop'],
    ['job1', 'job2'], ['job1', 'place'], ['job1', 'shop'], ['job1', 'stop'],
    ['stop', 'job1'], ['stop', 'place'], ['stop', 'shop'], ['stop', 'stop'],
  ];

  for (const [from, to] of PAIRS) {
    // shop→shop and place→place mean leaving and coming back, which needs the
    // road ping to be a trip at all; same coordinate twice is just sitting there.
    const modes = (from === to && from !== 'stop') ? [true] : [true, false];
    for (const viaRoad of modes) {
      test(`${from} → ${to} ${viaRoad ? 'via the road' : 'DIRECT (no ping in between)'} logs the leg`, async () => {
        const out = await leg(from, to, viaRoad, 17);
        // Self-diagnosing on purpose: this assertion has failed on WebKit only,
        // which cannot be run in the dev container, so a bare "expected 1 got 0"
        // costs a whole CI round trip per guess. The machine state says which
        // link broke: no fence matched, no origin recorded, or no leg opened.
        expect(out.drives.length,
          `expected one drive leg.\n  rows=${JSON.stringify(out.all)}\n  state=${JSON.stringify(out.dbg)}`).toBe(1);
        // To the minute: a 17-minute drive is 17 minutes, not 0 and not 17 plus
        // however long the truck was parked at either end.
        expect(out.drives[0].m, `leg minutes, rows=${JSON.stringify(out.all)}`).toBe(17);
      });
    }
  }

  // ── Dwell, not just travel ────────────────────────────────────────────────
  // The matrix above proves every LEG. Time spent standing still is the other
  // half of the day and has its own row per fence type, so it gets asserted too:
  // a complete set of legs with a missing dwell still loses paid hours.
  test('the shop logs shop time, on its own table, whenever they are at the yard', async () => {
    const out = await page.evaluate(async (C) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _supaUser = { id: 'u-matrix' };
      _geoEnqueue = (tbl, row) => rows.push({ tbl, source: row.source, m: row.minutes });
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      try {
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoCurrentPlace = null;
        _geoPlaceArrivedAt = null; _geoStopAnchor = null; _geoLastFenceAt = null; _geoLegAtShop = false;
        await ping(C.SHOP);
        _geoShopArrivedAt = new Date(Date.now() - 34 * 60000).toISOString();
        await ping(C.ROAD);                       // leaving the yard closes it
        return rows;
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
    }, { SHOP, ROAD });
    const shop = out.filter(r => r.tbl === 'shop_time_entries');
    expect(shop.length, `expected one shop_time_entries row, got ${JSON.stringify(out)}`).toBe(1);
    expect(shop[0].m).toBe(34);
  });

  test('a job fenced at the yard logs BOTH job time and shop time', async () => {
    // Owner call 2026-08-01: being at the yard logs shop time regardless of what
    // else is happening there. A job that happens to sit inside the shop fence
    // does not silence it. An earlier revision made JOB exclusive and swallowed
    // the shop row, which is why this case is pinned.
    const out = await page.evaluate(async (C) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      const savedJobs = jobs.slice();
      _supaUser = { id: 'u-matrix' };
      _geoEnqueue = (tbl, row) => rows.push({ tbl, source: row.source, m: row.minutes });
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      try {
        // A job AT the shop coordinate.
        jobs.length = 0;
        jobs.push({ id: 8803, name: 'Yard Job', eventType: 'job', status: 'upcoming',
                    start: todayKey(), days: 1, lat: C.SHOP.lat, lon: C.SHOP.lon });
        _geoJobCoords = {};
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoCurrentPlace = null;
        _geoPlaceArrivedAt = null; _geoStopAnchor = null; _geoLastFenceAt = null; _geoLegAtShop = false;
        await ping(C.SHOP);
        const both = { job: !!_geoCurrentJob, shop: !!_geoWasInShop };
        _geoArrivedAt = new Date(Date.now() - 50 * 60000).toISOString();
        _geoShopArrivedAt = new Date(Date.now() - 50 * 60000).toISOString();
        await ping(C.ROAD);
        return { rows, both };
      } finally {
        _geoEnqueue = realEnq; _supaUser = realUser;
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j)); _geoJobCoords = {};
      }
    }, { SHOP, ROAD });
    // Both clocks run at once.
    expect(out.both).toEqual({ job: true, shop: true });
    const shop = out.rows.filter(r => r.tbl === 'shop_time_entries');
    const job = out.rows.filter(r => r.tbl === 'job_time_entries' && /^geofence/.test(r.source || ''));
    expect(shop.length, `shop row missing: ${JSON.stringify(out.rows)}`).toBe(1);
    expect(job.length, `job row missing: ${JSON.stringify(out.rows)}`).toBe(1);
    expect(shop[0].m).toBe(50);
    expect(job[0].m).toBe(50);
  });

  test('a supply house logs its own dwell, attributed to no job', async () => {
    const out = await page.evaluate(async (C) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _supaUser = { id: 'u-matrix' };
      _geoEnqueue = (tbl, row) => rows.push({ tbl, source: row.source, m: row.minutes, dest: row.dest_place, job: row.job_id });
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      try {
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoCurrentPlace = null;
        _geoPlaceArrivedAt = null; _geoStopAnchor = null; _geoLastFenceAt = null; _geoLegAtShop = false;
        await ping(C.PLACE);
        _geoPlaceArrivedAt = new Date(Date.now() - 23 * 60000).toISOString();
        await ping(C.ROAD);
        return rows;
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
    }, { PLACE, ROAD });
    const dwell = out.filter(r => r.source === 'place');
    expect(dwell.length, `expected one place dwell, got ${JSON.stringify(out)}`).toBe(1);
    expect(dwell[0].m).toBe(23);
    expect(dwell[0].dest).toBe('Matrix Supply');
    expect(dwell[0].job).toBe(null);          // paid work, but not labor on any one job
  });

  // ── The whole day, app open, pinging the entire time ──────────────────────
  // Owner (2026-08-01): "say the app is open forever and you're driving about
  // your day, need everything to log correctly and track the time correctly."
  //
  // Every other test here transitions in two or three pings. A real phone left
  // open pings all day, so this drives 481 consecutive minutes through the same
  // handler on a controlled clock, MOVING during every drive. That last part is
  // what makes it a real test: a truck that pings from the same spot for ten
  // minutes IS parked, so a drive has to keep moving or the machine is right to
  // call it a stop, and the segments below interpolate between waypoints at
  // roughly a thousand feet per minute to prove it does not.
  //
  // The assertion is the day's arithmetic. Individual buckets may shift by one
  // minute, because a stop is bounded by the pings that VERIFIED it (first fix
  // parked, last fix still parked) and the minute of departure lands on the
  // drive instead. That is correct behaviour, not slack: nothing is invented and
  // nothing is lost, so the TOTAL is exact.
  test('a full day with the app open the whole time accounts for every minute', async () => {
    const out = await page.evaluate(async (C) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser, RealDate = Date;
      const savedJobs = jobs.slice();
      // A controlled clock. The machine stamps everything from Date.now() and
      // bare `new Date()`, so both have to move together or the durations are
      // measured against wall time and the day collapses into seconds.
      let clock = RealDate.parse('2026-06-15T07:00:00.000Z');
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
        static now() { return clock; }
        static parse(x) { return RealDate.parse(x); }
        static UTC(...a) { return RealDate.UTC(...a); }
      }
      try {
        window.Date = FakeDate;
        _supaUser = { id: 'u-allday' };
        _geoEnqueue = (tbl, row) => rows.push({ tbl, source: row.source, m: row.minutes });
        jobs.length = 0;
        jobs.push({ id: 8811, name: 'All-day Job', eventType: 'job', status: 'upcoming',
                    start: todayKey(), days: 1, lat: C.JOB.lat, lon: C.JOB.lon });
        _geoJobCoords = {};
        S.officeLat = C.SHOP.lat; S.officeLon = C.SHOP.lon;
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoCurrentPlace = null;
        _geoPlaceArrivedAt = null; _geoStopAnchor = null; _geoLastFenceAt = null; _geoLegAtShop = false;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}

        // minute-offset → where the truck is. Dwell segments hold a fence
        // coordinate; drive segments interpolate so every ping has moved.
        const P = { shop: C.SHOP, job: C.JOB, supply: C.SUPPLY, lunch: C.LUNCH };
        const SEGS = [
          { n: 'shop',  a: 0,   b: 45  },
          { n: 'drive', a: 45,  b: 70,  from: 'shop',   to: 'job' },
          { n: 'job',   a: 70,  b: 235 },
          { n: 'drive', a: 235, b: 250, from: 'job',    to: 'supply' },
          { n: 'sup',   a: 250, b: 270 },
          { n: 'drive', a: 270, b: 282, from: 'supply', to: 'job' },
          { n: 'job',   a: 282, b: 365 },
          { n: 'drive', a: 365, b: 375, from: 'job',    to: 'lunch' },
          { n: 'lunch', a: 375, b: 420 },
          { n: 'drive', a: 420, b: 430, from: 'lunch',  to: 'job' },
          { n: 'job',   a: 430, b: 455 },
          { n: 'drive', a: 455, b: 480, from: 'job',    to: 'shop' },
          { n: 'shop',  a: 480, b: 481 },
        ];
        const posAt = (m) => {
          const s = SEGS.find(x => m >= x.a && m < x.b);
          if (s.n === 'drive') {
            const f = (m - s.a + 1) / (s.b - s.a);      // +1: already moving on the first fix
            const A = P[s.from], B = P[s.to];
            return { lat: A.lat + (B.lat - A.lat) * f, lon: A.lon + (B.lon - A.lon) * f };
          }
          return { shop: P.shop, job: P.job, sup: P.supply, lunch: P.lunch }[s.n];
        };
        for (let m = 0; m <= 480; m++) {
          clock = RealDate.parse('2026-06-15T07:00:00.000Z') + m * 60000;
          const c = posAt(m);
          await _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        }
        const sum = (f) => rows.filter(f).reduce((t, r) => t + (r.m || 0), 0);
        return {
          shop:   sum(r => r.tbl === 'shop_time_entries'),
          drive:  sum(r => /^drive/.test(r.source || '')),
          job:    sum(r => /^geofence/.test(r.source || '')),
          place:  sum(r => r.source === 'place'),
          stop:   sum(r => r.source === 'stop'),
          driveN: rows.filter(r => /^drive/.test(r.source || '')).length,
          jobN:   rows.filter(r => /^geofence/.test(r.source || '')).length,
          all:    rows.map(r => (r.source || r.tbl) + ':' + r.m).join(','),
          shopStillOpen: !!_geoShopArrivedAt,
        };
      } finally {
        window.Date = RealDate;
        _geoEnqueue = realEnq; _supaUser = realUser;
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j)); _geoJobCoords = {};
      }
    }, { SHOP: DAY_SHOP, JOB: DAY_JOB, SUPPLY: DAY_SUPPLY, LUNCH: DAY_LUNCH });

    // The clock is fully controlled, so these are exact rather than approximate.
    // Two effects make them differ from the naive segment lengths, and both are
    // the machine being right:
    //   • the truck REACHES a site on the final minute of the drive, so each job
    //     visit is one minute longer and its inbound leg one minute shorter than
    //     the nominal split (166/84/26 on-site, not 165/83/25);
    //   • a stop is bounded by the pings that VERIFIED it, so the minute of
    //     pulling out belongs to the drive rather than to lunch.
    // Neither invents or loses a minute, which is what the total proves.
    const detail = ` rows=${out.all}`;
    expect(out.driveN, 'drive legs' + detail).toBe(6);
    expect(out.jobN, 'job visits' + detail).toBe(3);
    expect(out.shop,  'shop time' + detail).toBe(45);
    expect(out.drive, 'drive time' + detail).toBe(92);
    expect(out.job,   'on-site time' + detail).toBe(276);
    expect(out.place, 'supply time' + detail).toBe(21);
    expect(out.stop,  'off-job time' + detail).toBe(45);
    // 480 minutes were driven. 479 are closed and filed; the last one is the
    // shop dwell they are still sitting in, which closes when they leave. So:
    // nothing invented, nothing lost, and the only unfiled minute is the one
    // that has not finished happening.
    expect(out.shop + out.drive + out.job + out.place + out.stop, 'the day' + detail).toBe(479);
    expect(out.shopStillOpen, 'final shop dwell still running' + detail).toBe(true);
  });

  test('no console errors across the matrix', async () => { await assertNoErrors(page); });
});
