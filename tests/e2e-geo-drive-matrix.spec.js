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
      savePlace({ name: 'Matrix Supply', kind: 'supply', lat: d.PLACE.lat, lon: d.PLACE.lon, confirmedBy: 'manual' });
      jobs.length = 0;
      jobs.push({ id: 8801, name: 'Matrix Job 1', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: d.JOB1.lat, lon: d.JOB1.lon });
      jobs.push({ id: 8802, name: 'Matrix Job 2', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: d.JOB2.lat, lon: d.JOB2.lon });
    }, { SHOP, PLACE, JOB1, JOB2 });
  });
  test.afterAll(async () => { await page.context().close(); });

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
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
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
        expect(out.drives.length, `expected one drive leg, got ${JSON.stringify(out.all)}`).toBe(1);
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

  test('no console errors across the matrix', async () => { await assertNoErrors(page); });
});
