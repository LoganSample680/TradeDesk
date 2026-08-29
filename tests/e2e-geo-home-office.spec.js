// @ts-check
// ── A shop at the house must not bill the night ──────────────────────────────
//
// Owner idea (2026-08-01): "if the app is open and the contractor is doing work
// then we count that as working hours, but this only works if their home is
// tagged as a home office."
//
// The hole this closes was measured, not theorised. With the shop coordinates
// set to the contractor's own house, a probe left the fence occupied overnight
// and the app produced:
//
//     open dwell at 7am: 840 min = 14.0h
//     shop_time_entries logged: [845]
//
// Fourteen hours of sleep, invoiced as shop overhead, in one row. _geoCloseShopEntry
// had a 2-minute floor and no ceiling, and from GPS alone "in the shop working"
// and "asleep upstairs" are the same coordinate.
//
// A time-of-day gate is NOT the fix and is not what these tests assert. That gate
// existed, was deliberately deleted because it silently dropped Saturday call-outs
// and 7pm supply runs, and re-adding it would undo that for the same bad reason.
//
// The rule these tests pin down instead: at a place the contractor has THEMSELVES
// marked kind:'home_office', time accrues only while the app is actually being
// used. That measure is right for a home office specifically, because the work
// done at one IS the paperwork. Every other location (the shop proper, a supply
// house, a job) still bills presence, and the last three tests exist to prove
// this change did not quietly move that line.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const HOME = { lat: 41.5000, lon: -93.5000 };   // shop == house, the whole problem
const YARD = { lat: 41.6000, lon: -93.6000 };   // a real yard, nobody sleeps here
const ROAD = { lat: 41.9000, lon: -93.9000 };   // outside every fence

test.describe('Home office: presence is not work', () => {
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

  // Occupy `origin` for `dwellMins`, then drive to ROAD, and return every row
  // the machine wrote. `activeEveryMs` simulates the contractor tapping around
  // the app: the sampler credits a ping only if the app is visible AND was
  // touched inside the idle window, so leaving interaction stale is what
  // "asleep upstairs" looks like from here.
  async function occupy({ origin, dwellMins, pings, interact, hidden }) {
    return page.evaluate(async (a) => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _supaUser = { id: 'u-home' };
      _geoEnqueue = (tbl, row) => rows.push(Object.assign({ _tbl: tbl }, row));
      // A controlled clock: the dwell has to be hours long and the test seconds.
      const realNow = Date.now, t0 = realNow.call(Date);
      let cursor = t0;
      Date.now = () => cursor;
      try {
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}

        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        // Fake document.hidden for the backgrounded case.
        const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
        if (a.hidden) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });

        const stepMs = Math.round((a.dwellMins * 60000) / a.pings);
        for (let i = 0; i < a.pings; i++) {
          if (a.interact) _geoLastInteractAt = cursor;   // a tap right now
          await ping(a.origin);
          cursor += stepMs;
        }
        // Rewind the arrival to `dwellMins` before the CURSOR. Same clock the
        // closers now stamp departure with: the closing ping's own nowMs (so a
        // TdGeo buffer replay closes a visit at the moment it actually
        // happened), which routes through the overridden Date.now here. The
        // guards all survive the clock switch: a wall-clock-billing regression
        // at a home office reads cursor-to-cursor and bills the full dwell
        // (fails the 0-minute tests), and a revert to new Date() departure
        // reads real-now minus a cursor-past arrival, ~zero minutes, and fails
        // the full-dwell tests below.
        const startIso = new Date(cursor - a.dwellMins * 60000).toISOString();
        if (_geoShopArrivedAt) _geoShopArrivedAt = startIso;
        if (_geoPlaceArrivedAt) _geoPlaceArrivedAt = startIso;

        rows.length = 0;                     // ignore whatever the arrival logged
        // Pull out: two pings, not one. A place/client fence now needs the
        // pending-then-confirming pair every departure does (owner mandate
        // 2026-08-20) before it closes; the shop-dwell mechanism this same
        // helper also drives (S.officeLat / _geoWasInShop) is unaffected and
        // still closes on the very first one, so the second is a harmless
        // no-op there.
        await ping(a.road);
        await ping(a.road);
        if (hiddenDesc) Object.defineProperty(document, 'hidden', hiddenDesc);
        return rows;
      } finally {
        Date.now = realNow; _geoEnqueue = realEnq; _supaUser = realUser;
      }
    }, { origin, dwellMins, pings, interact: !!interact, hidden: !!hidden, road: ROAD });
  }

  const shopMins = (rows) => rows.filter(r => r._tbl === 'shop_time_entries')
                                 .reduce((n, r) => n + (r.minutes || 0), 0);
  const placeMins = (rows) => rows.filter(r => r._tbl === 'job_time_entries' && r.source === 'place')
                                  .reduce((n, r) => n + (r.minutes || 0), 0);

  test.describe('the shop is the house', () => {
    // beforeEACH, not beforeAll: the sync fabric can replace the `places`
    // array mid-file (the documented WebKit places-wipe flake, see the note in
    // e2e-geo-drive-matrix). Losing the Home Office fixture silently turns
    // this describe's activeMs billing into wall-clock billing, and
    // "fourteen hours asleep" bills 840 (the exact 2026-08-09 shard-3
    // failure). Re-seeding per test makes the fixture unstealable.
    test.beforeEach(async () => {
      await page.evaluate((d) => {
        S.officeLat = d.HOME.lat; S.officeLon = d.HOME.lon;
        S.teamTracking = true;
        if (typeof places !== 'undefined') places.length = 0;
        savePlace({ id: 'homeoffice-fixture', name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
      }, { HOME });
    });

    test('fourteen hours asleep bills nothing', async () => {
      // The exact scenario the probe measured at 845 minutes. The app is on the
      // nightstand: never touched, so no ping is credited.
      const rows = await occupy({ origin: HOME, dwellMins: 14 * 60, pings: 24, interact: false });
      expect(shopMins(rows)).toBe(0);
      // and no row at all, rather than a zero-minute row somebody has to explain
      expect(rows.filter(r => r._tbl === 'shop_time_entries').length).toBe(0);
    });

    test('the same night with the phone left face-up still bills nothing', async () => {
      // Visible but untouched. Visibility alone must never be the signal, or a
      // phone charging screen-up on the workbench bills the shift.
      const rows = await page.evaluate(async (a) => {
        const realNow = Date.now; let cursor = realNow.call(Date);
        Date.now = () => cursor;
        try {
          _geoLastInteractAt = cursor - 60 * 60000;    // last touched an hour ago
          const active = [];
          for (let i = 0; i < 6; i++) { active.push(_geoAppActive(cursor)); cursor += 60 * 60000; }
          return active;
        } finally { Date.now = realNow; }
      }, {});
      expect(rows.every(v => v === false)).toBe(true);
    });

    test('a real evening of paperwork bills the minutes worked', async () => {
      // Two hours at the desk, tapping through estimates the whole time. This is
      // the half of the owner's idea that has to WORK, not just the half that
      // has to stop: a fix that bills nothing at a home office is not a fix.
      const rows = await occupy({ origin: HOME, dwellMins: 120, pings: 25, interact: true });
      const m = shopMins(rows);
      // 24 credited samples of 5 min each, and the per-sample cap is what keeps
      // this honest rather than letting one tap claim the whole dwell.
      expect(m).toBeGreaterThanOrEqual(110);
      expect(m).toBeLessThanOrEqual(120);
    });

    test('backgrounded for half of it bills only the half worked', async () => {
      // An hour of real work, then the phone goes in a pocket for an hour. The
      // web app stops getting pings when backgrounded, which is exactly the
      // wanted behaviour, and the per-sample cap stops the gap being back-credited.
      const rows = await page.evaluate(async (a) => {
        const realEnq = _geoEnqueue, realUser = _supaUser, realNow = Date.now;
        const out = [];
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => out.push(Object.assign({ _tbl: tbl }, row));
        const t0 = realNow.call(Date); let cursor = t0;
        Date.now = () => cursor;
        try {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          for (let i = 0; i < 13; i++) {           // 12 x 5min credited = 60 min
            _geoLastInteractAt = cursor;
            await ping(a.HOME);
            cursor += 5 * 60000;
          }
          cursor += 60 * 60000;                     // pocketed: no pings at all
          // Cursor clock, for the same reason occupy() uses it: a wall-clock
          // fallback would bill cursor-to-cursor, 120 minutes, and fail the
          // 55-65 band below.
          _geoShopArrivedAt = new Date(cursor - 120 * 60000).toISOString();
          out.length = 0;
          await ping(a.ROAD);                       // walks back out two hours later
          return out;
        } finally { Date.now = realNow; _geoEnqueue = realEnq; _supaUser = realUser; }
      }, { HOME, ROAD });
      const m = shopMins(rows);
      expect(m).toBeGreaterThanOrEqual(55);
      expect(m).toBeLessThanOrEqual(65);      // NOT the 120 minutes of wall clock
    });

    // Owner audit finding, 2026-08-23: a live account (Shop == the contractor's
    // house, exactly this describe's scenario) showed a 9-second
    // shop_time_entries dwell billed as 5 minutes. Root cause: returning home
    // before the sampler's "second consecutive away ping" ever got to null the
    // old dwell object handed the new, unrelated visit the old one's
    // already-billed activeMs. The closer marking the object `.closed`
    // (instead of nulling it outright, which would have broken "the tally
    // survives exactly the ping that closes the visit" below) and the sampler
    // starting fresh on `.closed` is the fix; this proves it holds. Uses the
    // Shop departure path deliberately, not a saved PLACE: a place/client exit
    // into open road now needs two confirming pings (owner mandate
    // 2026-08-20), but Shop still closes on the very first one (see
    // "backgrounded for half of it" above), so this stays a clean one-ping
    // close-then-reopen, same shape as the production data.
    test('a quick return before the second away-ping does not inherit the closed dwell\'s minutes', async () => {
      const rows = await page.evaluate(async (a) => {
        const realEnq = _geoEnqueue, realUser = _supaUser, realNow = Date.now;
        const out = [];
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => out.push(Object.assign({ _tbl: tbl }, row));
        let cursor = realNow.call(Date);
        Date.now = () => cursor;
        try {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          // Dwell #1: real paperwork, ~5 active minutes, tapping the whole time.
          for (let i = 0; i < 5; i++) { _geoLastInteractAt = cursor; await ping(a.HOME); cursor += 60000; }
          if (_geoShopArrivedAt) _geoShopArrivedAt = new Date(cursor - 5 * 60000).toISOString();
          out.length = 0;
          await ping(a.ROAD);   // closes dwell #1, one ping, same as "backgrounded for half of it"
          cursor += 1000;
          const afterFirstClose = out.slice();
          out.length = 0;
          await ping(a.HOME);   // right back home, one ping, no tap this time
          cursor += 1000;
          await ping(a.ROAD);   // closes dwell #2 almost immediately
          return { afterFirstClose, afterSecondClose: out.slice() };
        } finally { Date.now = realNow; _geoEnqueue = realEnq; _supaUser = realUser; }
      }, { HOME, ROAD });
      const firstMins = shopMins(rows.afterFirstClose);
      expect(firstMins).toBeGreaterThanOrEqual(4);
      expect(firstMins).toBeLessThanOrEqual(5);
      // Dwell #2 was one ping with no interaction: effectively zero active ms,
      // under the 2-minute floor. It must bill NOTHING, not dwell #1's 5 minutes.
      expect(shopMins(rows.afterSecondClose)).toBe(0);
      expect(rows.afterSecondClose.filter(r => r._tbl === 'shop_time_entries').length).toBe(0);
    });
  });

  test.describe('everywhere else still bills presence', () => {
    test.beforeAll(async () => {
      await page.evaluate((d) => {
        S.officeLat = d.YARD.lat; S.officeLon = d.YARD.lon;
        S.teamTracking = true;
        if (typeof places !== 'undefined') places.length = 0;
      }, { YARD });
    });

    test('an untagged shop bills the full dwell', async () => {
      // The regression guard for the whole change: an ordinary yard is not a
      // home office, so eight hours there is eight hours, untouched app or not.
      const rows = await occupy({ origin: YARD, dwellMins: 8 * 60, pings: 6, interact: false });
      const m = shopMins(rows);
      expect(m).toBeGreaterThanOrEqual(478);
      expect(m).toBeLessThanOrEqual(482);
    });

    test('a supply house bills the full dwell', async () => {
      await page.evaluate((d) => {
        S.officeLat = 41.0; S.officeLon = -92.0;     // shop far away, out of the picture
        places.length = 0;
        savePlace({ name: 'Home Depot', kind: 'supply', lat: d.YARD.lat, lon: d.YARD.lon, confirmedBy: 'manual' });
      }, { YARD });
      const rows = await occupy({ origin: YARD, dwellMins: 40, pings: 4, interact: false });
      const m = placeMins(rows);
      expect(m).toBeGreaterThanOrEqual(38);
      expect(m).toBeLessThanOrEqual(42);
    });
  });

  test.describe('a home office that is NOT the shop', () => {
    // The configuration the first beta user actually has: a home_office place
    // at the house and the business address ten miles away. The describes
    // above all put the shop ON the house, where the shop fence wins and the
    // place path never runs at all, which is exactly why they stayed green
    // through the defect below for nine days.
    test.beforeEach(async () => {
      await page.evaluate((d) => {
        S.officeLat = 41.0; S.officeLon = -92.0;      // yard far away, out of the picture
        S.teamTracking = true;
        if (typeof places !== 'undefined') places.length = 0;
        savePlace({ id: 'ho-2ping', name: 'Home Office', kind: 'home_office',
                    lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
      }, { HOME });
    });

    test('the office minutes survive a two-ping exit, which is the only kind a place fence has', async () => {
      // Caught by the live flow test on the self-hosted runner, 2026-08-29:
      // the Loading row landed and the Office row did not exist at all.
      //
      // The sampler's comment said the tally "deliberately SURVIVES the first
      // ping outside the fence... the closers run later in this same ping".
      // True when written, wrong from 2026-08-20, when a place/client exit
      // started requiring the pending-then-confirming PAIR: the place closer
      // then ran on the SECOND outside ping, by which time `!_geoWasAtHome`
      // had already nulled the tally. Every home-office visit closed through
      // the place path silently lost its paperwork minutes.
      // Ten pings across forty minutes, so each sample is four minutes and the
      // sampler's five-minute per-sample cap never binds: nine credited gaps of
      // four minutes is 36, and that is the number the row must carry. (At five
      // pings the same forty minutes correctly credits only 20, because the cap
      // is what stops a phone pocketed for an hour dumping the hour in on one
      // tap. Worth knowing before reading this number as a bug.)
      const rows = await occupy({ origin: HOME, dwellMins: 40, pings: 10, interact: true });
      const place = rows.filter(r => r._tbl === 'job_time_entries' && /^place/.test(r.source || ''));
      expect(place.length, 'the place path wrote a row at all').toBeGreaterThan(0);
      const office = place.find(r => r.source === 'place-office');
      expect(office, 'the paperwork row exists').toBeTruthy();
      expect(office.minutes).toBeGreaterThanOrEqual(34);
      expect(office.minutes).toBeLessThanOrEqual(38);
    });

    test('and the night still bills nothing through that same two-ping exit', async () => {
      // The other half: the fix must not have bought the office minutes back
      // by handing the closer a wall-clock fallback again.
      const rows = await occupy({ origin: HOME, dwellMins: 14 * 60, pings: 6, interact: false });
      const place = rows.filter(r => r._tbl === 'job_time_entries' && /^place/.test(r.source || ''));
      expect(place.length).toBe(0);
    });
  });

  test.describe('the two predicates', () => {
    test('home office is recognised only where the contractor tagged one', async () => {
      const out = await page.evaluate((d) => {
        places.length = 0;
        savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
        savePlace({ name: 'Supply', kind: 'supply', lat: d.YARD.lat, lon: d.YARD.lon, confirmedBy: 'manual' });
        return {
          home: _geoAtHomeOffice({ lat: d.HOME.lat, lng: d.HOME.lon }),
          homeLonKey: _geoAtHomeOffice({ lat: d.HOME.lat, lon: d.HOME.lon }),
          supply: _geoAtHomeOffice({ lat: d.YARD.lat, lng: d.YARD.lon }),
          road: _geoAtHomeOffice({ lat: d.ROAD.lat, lng: d.ROAD.lon }),
          nul: _geoAtHomeOffice(null),
          undef: _geoAtHomeOffice(undefined),
          empty: _geoAtHomeOffice({}),
        };
      }, { HOME, YARD, ROAD });
      expect(out.home).toBe(true);
      // Pings carry .lng, saved places carry .lon: both spellings must resolve
      // or the whole rule silently stops applying.
      expect(out.homeLonKey).toBe(true);
      expect(out.supply).toBe(false);
      expect(out.road).toBe(false);
      expect(out.nul).toBe(false);
      expect(out.undef).toBe(false);
      expect(out.empty).toBe(false);
    });

    test('active means on screen AND touched recently, both halves', async () => {
      const out = await page.evaluate(() => {
        const realNow = Date.now; const t = realNow.call(Date);
        const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
        try {
          _geoLastInteractAt = t;
          const visibleFresh = _geoAppActive(t);
          const visibleStale = _geoAppActive(t + 6 * 60000);
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          const hiddenFresh = _geoAppActive(t);
          return { visibleFresh, visibleStale, hiddenFresh };
        } finally {
          if (hiddenDesc) Object.defineProperty(document, 'hidden', hiddenDesc);
        }
      });
      expect(out.visibleFresh).toBe(true);
      expect(out.visibleStale).toBe(false);   // untouched past the idle window
      expect(out.hiddenFresh).toBe(false);    // backgrounded, however recent the tap
    });

    // ── _geoTapeSegments: the motion tape owns every boundary ──────────────────
  // Owner spec 2026-08-29, in his words: the last motion before a drive is
  // loading time, the drive starts when CoreMotion says driving, and time on
  // site runs from "this guy's moving" to "this guy is now driving". The
  // geofence only ever answers WHERE, never when.
  //
  // The fixture is Jack's real 8/28 shape (home office 09:46, at Laurie's
  // 09:49, parts run, back, home 14:18), because that is the day the fence
  // edges got wrong by eight minutes.
  test('_geoTapeSegments splits a day into load, drive and on-site by motion alone', async () => {
    const r = await page.evaluate(() => {
      const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
      // still → walk (load) → drive → walk (arrive) → still (working) → drive home
      const tape = [
        { kind: 'still',   ts: T(9, 30) },
        { kind: 'onFoot',  ts: T(9, 42) },   // loading the truck
        { kind: 'driving', ts: T(9, 46) },   // pulls out
        { kind: 'onFoot',  ts: T(9, 49) },   // parks at Laurie's
        { kind: 'still',   ts: T(9, 55) },   // working, phone on a bench
        { kind: 'onFoot',  ts: T(12, 10) },
        { kind: 'driving', ts: T(12, 14) },  // leaves
        { kind: 'onFoot',  ts: T(12, 18) },  // home
        { kind: 'still',   ts: T(12, 30) },
      ];
      const segs = _geoTapeSegments(tape, T(9, 30), T(12, 30));
      const min = (x) => Math.round((x.b - x.a) / 60000);
      return {
        seq: segs.map(x => x.kind + ':' + min(x)),
        loads: segs.filter(x => x.kind === 'load').length,
        drives: segs.filter(x => x.kind === 'drive').length,
      };
    });
    // Loading is its own line item (owner 2026-08-29), 09:42 to 09:46.
    expect(r.seq).toContain('load:4');
    // The drive out is 09:46 to 09:49, the drive home 12:14 to 12:18.
    expect(r.seq).toContain('drive:3');
    expect(r.seq).toContain('drive:4');
    // On site runs first-footstep to next-drive and INCLUDES the still time:
    // 09:49 to 12:10 is 141 minutes of a man working at a bench.
    // RAW shape: both walks-into-a-drive are load-outs, because the tape
    // cannot tell the shop from a customer's driveway. On site is 09:49 to
    // 12:10 here, with the 12:10 walk still carved out.
    expect(r.seq).toContain('onsite:141');
    expect(r.drives).toBe(2);
    expect(r.loads).toBe(2);
  });

  // ── The seven-day re-derive (owner 2026-08-29) ─────────────────────────────
  // "I also want the code to retroactively clean up by using the core motion
  // tape", automatically, for everyone. It runs on the build already in his
  // pocket: motionSince has shipped since 08-11, so nothing here waits on iOS.
  test('_geoTapeRegradeSweep re-stamps a fence-clipped visit from the tape and leaves an honest one alone', async () => {
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, td: _geoTdPlugin, enq: _geoEnqueue, places: window.getPlaces };
      const enq = [];
      try {
        const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
        // The fence recorded 09:52 to 12:08. The truck was actually stopped
        // 09:49 to 12:14, which is Jack's real eight minutes.
        const rows = [
          { id: 'row-clipped', arrived_at: new Date(T(9, 52)).toISOString(),
            departed_at: new Date(T(12, 8)).toISOString(), minutes: 136,
            source: 'client', dest_place: 'Laurie Schonfeldt', client_key: 'k1', job_id: null },
          // Already agrees with the tape inside the noise floor: must not be touched.
          { id: 'row-honest', arrived_at: new Date(T(14, 0)).toISOString(),
            departed_at: new Date(T(14, 30)).toISOString(), minutes: 30,
            source: 'client', dest_place: 'Laurie Schonfeldt', client_key: 'k2', job_id: null },
        ];
        const q = { _d: { data: rows, error: null } };
        q.then = (res, rej) => Promise.resolve(q._d).then(res, rej);
        ['select', 'is', 'eq', 'gte'].forEach(m => { q[m] = () => q; });
        _supa = { from: () => q };
        _supaUser = { id: 'u-regrade' };
        window.getPlaces = () => [];          // Laurie's is NOT his own place
        _geoEnqueue = (tbl, row) => enq.push({ tbl, row });
        _geoTdPlugin = () => ({
          motionSince: () => Promise.resolve({ available: true, transitions: [
            { kind: 'driving', ts: T(9, 46) },
            { kind: 'onFoot',  ts: T(9, 49) },   // truck actually stops
            { kind: 'still',   ts: T(9, 58) },
            { kind: 'onFoot',  ts: T(12, 10) },
            { kind: 'driving', ts: T(12, 14) },  // actually pulls out
            { kind: 'onFoot',  ts: T(12, 18) },
            { kind: 'still',   ts: T(14, 2) },
            { kind: 'onFoot',  ts: T(14, 28) },
          ] }),
        });
        window._geoTapeRegradeRan = false;
        const changed = await _geoTapeRegradeSweep();
        const upd = enq.find(x => x.row && x.row.id === 'row-clipped');
        return {
          changed,
          touchedHonest: enq.some(x => x.row && x.row.id === 'row-honest'),
          mins: upd ? upd.row.minutes : null,
          arrived: upd ? upd.row.arrived_at : null,
          keptId: upd ? upd.row.id : null,
          keptKey: upd ? upd.row.client_key : null,
          loads: enq.filter(x => x.row && x.row.source === 'place-load').length,
        };
      } finally {
        _supa = saved.supa; _supaUser = saved.user; _geoTdPlugin = saved.td;
        _geoEnqueue = saved.enq; window.getPlaces = saved.places;
        window._geoTapeRegradeRan = true;
      }
    });
    expect(r.changed).toBe(1);
    // 09:49 to 12:14 is 145 minutes, the number the fence lost.
    expect(r.mins).toBe(145);
    expect(r.arrived).toBe('2026-08-28T09:49:00.000Z');
    // Re-stamped IN PLACE: the id and client_key survive, so a job link or a
    // human correction is never thrown away and rebuilt.
    expect(r.keptId).toBe('row-clipped');
    expect(r.keptKey).toBe('k1');
    // A row the tape agrees with is left alone entirely.
    expect(r.touchedHonest).toBe(false);
    // Laurie's is not his own place, so packing up stays on site, no load row.
    expect(r.loads).toBe(0);
  });

  test('_geoTapeRegradeSweep will not move a boundary no drive anchors', async () => {
    // Caught in review, not theorised: with no drive inside the padded window
    // the tape only proves he was not driving, never where the visit began or
    // ended. Taking the span anyway stretched an honest 30-minute row to fill
    // the whole 20-minute pad on both sides, which is a lie in the direction
    // of more billable time.
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, td: _geoTdPlugin, enq: _geoEnqueue, places: window.getPlaces };
      const enq = [];
      try {
        const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
        const rows = [{ id: 'row-unanchored', arrived_at: new Date(T(14, 0)).toISOString(),
          departed_at: new Date(T(14, 30)).toISOString(), minutes: 30,
          source: 'client', dest_place: 'Laurie Schonfeldt', client_key: 'k', job_id: null }];
        const q = { _d: { data: rows, error: null } };
        q.then = (res, rej) => Promise.resolve(q._d).then(res, rej);
        ['select', 'is', 'eq', 'gte'].forEach(m => { q[m] = () => q; });
        _supa = { from: () => q }; _supaUser = { id: 'u-anchor' };
        window.getPlaces = () => [];
        _geoEnqueue = (t, row) => enq.push(row);
        // Walking and standing still all afternoon. Not one drive.
        _geoTdPlugin = () => ({ motionSince: () => Promise.resolve({ available: true, transitions: [
          { kind: 'onFoot', ts: T(13, 30) }, { kind: 'still', ts: T(14, 2) }, { kind: 'onFoot', ts: T(14, 28) },
        ] }) });
        window._geoTapeRegradeRan = false;
        const changed = await _geoTapeRegradeSweep();
        return { changed, wrote: enq.length };
      } finally {
        _supa = saved.supa; _supaUser = saved.user; _geoTdPlugin = saved.td;
        _geoEnqueue = saved.enq; window.getPlaces = saved.places; window._geoTapeRegradeRan = true;
      }
    });
    expect(r.changed).toBe(0);
    expect(r.wrote).toBe(0);
  });

  // ── The same visit, written twice (owner's real 8/27) ──────────────────────
  // His day read 15h 25m and about 4h 34m of it was duplicate, including one
  // John Doe visit logged at 242 minutes TWICE. The keys were minted 149.6
  // seconds apart while both rows stored the identical arrived_at, so the
  // unique index never fired. Fixture is those exact rows.
  test('_geoDupeSweep drops the twin and keeps the hours, not the label', async () => {
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, del: window._tdSoftDelete };
      const deleted = [], updated = [];
      try {
        const T = (h, m, s2) => Date.UTC(2026, 7, 27, h, m, s2 || 0);
        const row = (id, src, dest, a, b, job) => ({
          id, source: src, dest_place: dest, job_id: job || null, client_key: 'k' + id,
          arrived_at: new Date(a).toISOString(), departed_at: new Date(b).toISOString(),
          minutes: Math.round((b - a) / 60000),
        });
        const rows = [
          // The 242-minute John Doe visit, twice, one without a name.
          row('A', 'client', null,       T(12, 59, 6), T(17, 1, 35)),
          row('B', 'client', 'John Doe', T(12, 59, 6), T(17, 1, 35)),
          // The 269-minute visit with the 14-minute fragment nested in it.
          row('C', 'client', null,       T(17, 57, 43), T(22, 26, 48)),
          row('D', 'client', 'John Doe', T(22, 13, 40), T(22, 28, 9)),
          // Two observations of one stop, 35 seconds apart.
          row('E', 'stop', null, T(22, 59, 10), T(23, 12, 56)),
          row('F', 'stop', null, T(22, 59, 45), T(23, 12, 56)),
          // NOT duplicates: same source, no overlap at all.
          row('G', 'stop', null, T(23, 59, 32), T(24 % 24 === 0 ? 23 : 23, 59, 59)),
          // NOT duplicates: overlapping but tied to DIFFERENT jobs.
          row('H', 'client', null, T(9, 0, 0), T(10, 0, 0), 11),
          row('I', 'client', null, T(9, 0, 0), T(10, 0, 0), 22),
        ];
        const q = { _d: { data: rows, error: null } };
        q.then = (res, rej) => Promise.resolve(q._d).then(res, rej);
        ['select', 'is', 'eq', 'gte'].forEach(m => { q[m] = () => q; });
        const upd = { eq: (col, v) => { updated.push(v); return Promise.resolve({ error: null }); } };
        _supa = { from: () => Object.assign(Object.create(q), q, { update: (patch) => { updated.patch = patch; return upd; } }) };
        _supaUser = { id: 'u-dupe' };
        window._tdSoftDelete = async (tbl, id) => { deleted.push(id); };
        window._geoDupeSweepRan = false;
        const n = await _geoDupeSweep();
        return { n, deleted, updated: updated.slice(), patch: updated.patch };
      } finally {
        _supa = saved.supa; _supaUser = saved.user;
        window._tdSoftDelete = saved.del; window._geoDupeSweepRan = true;
      }
    });
    // Three duplicates found: the John Doe twin, the nested fragment, one stop.
    expect(r.n).toBe(3);
    // A and B are the same 242 minutes. Equal length, so the NAMED one wins.
    expect(r.deleted).toContain('A');
    expect(r.deleted).not.toContain('B');
    // The 14-minute fragment goes, the 269-minute visit stays. Preferring the
    // better NAME first here would have destroyed four and a half hours.
    expect(r.deleted).toContain('D');
    expect(r.deleted, 'the long visit must never lose to a fragment').not.toContain('C');
    // ...and C inherits the name it lacked rather than rendering as a dash.
    expect(r.updated).toContain('C');
    expect(r.patch).toEqual({ dest_place: 'John Doe' });
    // One of the two stop observations goes; the longer survives.
    expect(r.deleted.filter(x => x === 'E' || x === 'F').length).toBe(1);
    expect(r.deleted).toContain('F');
    // Different jobs are never the same event, however the clocks line up.
    expect(r.deleted).not.toContain('H');
    expect(r.deleted).not.toContain('I');
  });

  test('_geoDupeSweep collapses one drive written under two source labels', async () => {
    // His 08-27 17:28 leg: the server deriver wrote 'drive' and the phone
    // wrote 'drive-unassigned', 2.4 seconds apart, 0.992 overlap. Matching the
    // source string exactly left both standing forever. They disagree about
    // whether the leg is assigned to a job, not about whether it happened.
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, del: window._tdSoftDelete };
      const deleted = [], updated = [];
      try {
        const T = (h, m, s2) => Date.UTC(2026, 7, 27, h, m, s2 || 0);
        const row = (id, src, dest, a, b) => ({
          id, source: src, dest_place: dest, job_id: null, client_key: 'k' + id,
          arrived_at: new Date(a).toISOString(), departed_at: new Date(b).toISOString(),
          minutes: Math.round((b - a) / 60000),
        });
        const rows = [
          // 17:28:08 -> 17:34:37, server, named off a stale fence fix.
          row('S', 'drive', '2015 SW Randolph Ave', T(22, 28, 8), T(22, 34, 37)),
          // 17:28:11 -> 17:34:53, phone, named off the place it resolved to.
          row('P', 'drive-unassigned', 'TradeDesk shop', T(22, 28, 11), T(22, 34, 53)),
          // A stop overlapping a drive is NOT the same event, whatever the clocks say.
          row('X', 'stop', null, T(22, 28, 9), T(22, 34, 50)),
        ];
        const q = { _d: { data: rows, error: null } };
        q.then = (res, rej) => Promise.resolve(q._d).then(res, rej);
        ['select', 'is', 'eq', 'gte'].forEach(m => { q[m] = () => q; });
        const upd = { eq: (col, v) => { updated.push(v); return Promise.resolve({ error: null }); } };
        _supa = { from: () => Object.assign(Object.create(q), q, { update: (patch) => { updated.patch = patch; return upd; } }) };
        _supaUser = { id: 'u-cls' };
        window._tdSoftDelete = async (tbl, id) => { deleted.push(id); };
        window._geoDupeSweepRan = false;
        const n = await _geoDupeSweep();
        return { n, deleted, updated: updated.slice() };
      } finally {
        _supa = saved.supa; _supaUser = saved.user;
        window._tdSoftDelete = saved.del; window._geoDupeSweepRan = true;
      }
    });
    expect(r.n, 'exactly one collapse: the two drives').toBe(1);
    // The longer row survives, which here is also the one named off the place
    // rather than off a fix that was 3,044 ft stale.
    expect(r.deleted).toEqual(['S']);
    expect(r.deleted, 'a stop is still not a drive').not.toContain('X');
  });

  test('_geoDupeSweep is a no-op with nothing to do, and never runs twice', async () => {
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, del: window._tdSoftDelete };
      const deleted = [];
      try {
        const q = { _d: { data: [], error: null } };
        q.then = (res, rej) => Promise.resolve(q._d).then(res, rej);
        ['select', 'is', 'eq', 'gte'].forEach(m => { q[m] = () => q; });
        _supa = { from: () => q }; _supaUser = { id: 'u-none' };
        window._tdSoftDelete = async (t, id) => { deleted.push(id); };
        window._geoDupeSweepRan = false;
        const first = await _geoDupeSweep();
        const second = await _geoDupeSweep();
        return { first, second, deleted };
      } finally {
        _supa = saved.supa; _supaUser = saved.user;
        window._tdSoftDelete = saved.del; window._geoDupeSweepRan = true;
      }
    });
    expect(r.first).toBe(0);
    expect(r.second).toBe(0);
    expect(r.deleted.length).toBe(0);
  });

  test('_geoTapeRegradeSweep does nothing when there is no tape, and never runs twice', async () => {
    const r = await page.evaluate(async () => {
      const saved = { td: _geoTdPlugin, enq: _geoEnqueue };
      const enq = [];
      try {
        _geoEnqueue = (t, row) => enq.push(row);
        // No coprocessor: a fenceless guess is exactly what this replaces.
        _geoTdPlugin = () => ({ motionSince: () => Promise.resolve({ available: false, transitions: [] }) });
        window._geoTapeRegradeRan = false;
        const noTape = await _geoTapeRegradeSweep();
        // Latch: a second call in the same session is a no-op.
        const second = await _geoTapeRegradeSweep();
        return { noTape, second, wrote: enq.length };
      } finally { _geoTdPlugin = saved.td; _geoEnqueue = saved.enq; window._geoTapeRegradeRan = true; }
    });
    expect(r.noTape).toBe(0);
    expect(r.second).toBe(0);
    expect(r.wrote).toBe(0);
  });

  test('_geoFoldLoadIntoOnsite: packing up at a customer is on-site, at your own place it is loading', async () => {
    const r = await page.evaluate(() => {
      const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
      const tape = [
        { kind: 'still',   ts: T(9, 30) },
        { kind: 'onFoot',  ts: T(9, 42) },
        { kind: 'driving', ts: T(9, 46) },
        { kind: 'onFoot',  ts: T(9, 49) },
        { kind: 'still',   ts: T(9, 55) },
        { kind: 'onFoot',  ts: T(12, 10) },
        { kind: 'driving', ts: T(12, 14) },
        { kind: 'onFoot',  ts: T(12, 18) },
        { kind: 'still',   ts: T(12, 30) },
      ];
      const segs = _geoTapeSegments(tape, T(9, 30), T(12, 30));
      const min = (x) => Math.round((x.b - x.a) / 60000);
      const shape = (a) => a.map(x => x.kind + ':' + min(x));
      return {
        customer: shape(_geoFoldLoadIntoOnsite(segs, false)),
        own: shape(_geoFoldLoadIntoOnsite(segs, true)),
      };
    });
    // At a customer: on site runs moving-to-driving, 09:49 through 12:14,
    // which is the 145 minutes the owner's spec asks for and 8 more than the
    // fence-stamped row recorded on Jack's 8/28.
    expect(r.customer).toContain('onsite:145');
    expect(r.customer.some(x => x.startsWith('load:'))).toBe(false);
    // At his own place the load-out survives as its own line item.
    expect(r.own).toContain('load:4');
  });

  test('_geoTapeSegments stitches a drive across a long light, never splits it', async () => {
    const r = await page.evaluate(() => {
      const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
      const tape = [
        { kind: 'onFoot',  ts: T(8, 0) },
        { kind: 'driving', ts: T(8, 5) },
        { kind: 'still',   ts: T(8, 12) },   // 90 seconds at a rail crossing
        { kind: 'driving', ts: T(8, 13) },
        { kind: 'onFoot',  ts: T(8, 25) },
      ];
      const segs = _geoTapeSegments(tape, T(8, 0), T(8, 30));
      return segs.filter(x => x.kind === 'drive').map(x => Math.round((x.b - x.a) / 60000));
    });
    // One drive of 20 minutes, not two of 7 and 12.
    expect(r).toEqual([20]);
  });

  test('_geoTapeSegments: a walk that never reaches a drive is not loading', async () => {
    const r = await page.evaluate(() => {
      const T = (h, m) => Date.UTC(2026, 7, 28, h, m, 0);
      // Walks the yard at 8:00, sits back down, drives an hour later. That
      // walk is not a load-out and must not bill as one.
      const tape = [
        { kind: 'still',   ts: T(7, 30) },
        { kind: 'onFoot',  ts: T(8, 0) },
        { kind: 'still',   ts: T(8, 5) },
        { kind: 'driving', ts: T(9, 5) },
        { kind: 'onFoot',  ts: T(9, 20) },
      ];
      const segs = _geoTapeSegments(tape, T(7, 30), T(9, 30));
      return { loads: segs.filter(x => x.kind === 'load').length };
    });
    expect(r.loads).toBe(0);
  });

  test('_geoTapeSegments survives junk: empty, null, inverted and unsorted input', async () => {
    const r = await page.evaluate(() => {
      const call = (t, s, e) => { try { return { n: _geoTapeSegments(t, s, e).length }; } catch (err) { return { threw: String(err) }; } };
      const T = (h) => Date.UTC(2026, 7, 28, h, 0, 0);
      return {
        nullTape: call(null, T(8), T(9)),
        empty: call([], T(8), T(9)),
        notArray: call('nope', T(8), T(9)),
        inverted: call([{ kind: 'driving', ts: T(8) }], T(9), T(8)),
        junkRows: call([null, { ts: T(8) }, { kind: 'driving' }], T(8), T(9)),
        // Out of order on the wire must still segment correctly.
        unsorted: call([{ kind: 'onFoot', ts: T(9) }, { kind: 'driving', ts: T(8) }], T(8), T(10)),
      };
    });
    expect(r.nullTape).toEqual({ n: 0 });
    expect(r.empty).toEqual({ n: 0 });
    expect(r.notArray).toEqual({ n: 0 });
    expect(r.inverted).toEqual({ n: 0 });
    expect(r.junkRows.threw).toBeUndefined();
    expect(r.unsorted.threw).toBeUndefined();
    expect(r.unsorted.n).toBeGreaterThan(0);
  });

  test('the tally survives exactly the ping that closes the visit', async () => {
      // The ordering trap: the sampler runs BEFORE the fence machine, so if it
      // cleared on first sight of an outside coordinate, the closer running
      // later in that same ping would read null and fall straight back to wall
      // clock, putting the whole night back.
      //
      // "One ping of carry-over, then gone" is what this used to assert, and
      // that fixed ping count is the assumption the 2026-08-29 defect was made
      // of: a place exit takes TWO outside pings to confirm, so the closer runs
      // on the second and the tally was already gone. The tally now lives as
      // long as the VISIT does. It survives every ping the exit confirmation
      // takes, and goes once the visit is closed and we are still away.
      const out = await page.evaluate((d) => {
        places.length = 0;
        savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
        const realUser = _supaUser; _supaUser = { id: 'u-home' };
        const realEnq = _geoEnqueue; _geoEnqueue = () => {};
        try {
          _geoHomeDwell = null; _geoWasAtHome = false;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          return (async () => {
            await ping(d.HOME);
            const atHome = !!_geoHomeDwell;
            await ping(d.ROAD);
            const firstOut = !!_geoHomeDwell;
            await ping(d.ROAD);          // this one confirms the exit and closes the visit
            const secondOut = !!_geoHomeDwell;
            await ping(d.ROAD);          // nothing open any more
            const thirdOut = !!_geoHomeDwell;
            return { atHome, firstOut, secondOut, thirdOut };
          })();
        } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
      }, { HOME, ROAD });
      expect(out.atHome).toBe(true);
      expect(out.firstOut).toBe(true);
      expect(out.secondOut, 'the ping that CLOSES the visit must still see it').toBe(true);
      expect(out.thirdOut, 'and once nothing is open it goes').toBe(false);
    });

    // The home-dwell stale-minutes regression test lives in "the shop is the
    // house" describe above, on the Shop departure path: a place/client exit
    // into open road now needs two confirming pings (owner mandate
    // 2026-08-20) and this describe's HOME/ROAD pings never carry a speed
    // reading, so a single ping here no longer closes the visit the way it
    // did when that test was first written. Shop still closes on one ping
    // (see "backgrounded for half of it" in that describe), which is also
    // the exact path the live account's anomaly was found in.
  });

  // ── Loading vs paperwork: the home office is two kinds of work ─────────────
  //
  // Owner rule (2026-08-29): "home office should call the last motion event
  // from start time to end time before a drive, that's truck loading time...
  // then home office counts app open time while in home office geofence, that
  // means work is actively being done so it needs counted as its own thing."
  //
  // Both halves were unbillable before this. Presence billed nothing at a home
  // office (correct, that is the night rule above), and app-active time billed
  // as one anonymous 'place' row that Crew Cost could not tell from a supply
  // run. A man loading his truck for forty minutes with the phone in his
  // pocket earned nothing at all, because no rule in the file described the
  // work he was doing.
  //
  // The anchor is the coprocessor's own 'driving' transition rather than the
  // geofence exit, because the fence trips several hundred feet down the road
  // and a real load-out measured back from it looks late. These tests pin that
  // distinction down: the gap cases below are the ones that break if anybody
  // ever "simplifies" the anchor back to the departure timestamp.
  test.describe('loading up and office work', () => {
    const T = Date.parse('2026-08-21T12:00:00.000Z');     // named, never derived (CLAUDE.md 5.2.2)
    const m = (n) => T + n * 60000;
    const win = (s, e) => page.evaluate((a) => {
      const w = _geoHomeLoadWindow(a.tape, a.s, a.e);
      return w ? [w[0] - a.t0, w[1] - a.t0] : null;       // minutes-from-T, so a failure reads
    }, { tape: s, s: e[0], e: e[1], t0: T });

    test('the walk that runs into the drive is the load-out', async () => {
      const out = await win(
        [{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(32) }, { kind: 'driving', ts: m(34) }],
        [T, m(36)]);
      expect(out).toEqual([10 * 60000, 32 * 60000]);
    });

    test('a short still in the cab does not extend the load-out', async () => {
      // Buckling in is not loading. The window ends where the walking ends,
      // never at the driving transition itself.
      const out = await win(
        [{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(20) }, { kind: 'driving', ts: m(24) }],
        [T, m(30)]);
      expect(out).toEqual([10 * 60000, 20 * 60000]);
    });

    test('a walk that did not run into the drive is not loading', async () => {
      // Forty minutes of stillness between the walk and the drive: that walk
      // was some other errand and the truck was loaded before or not at all.
      const out = await win(
        [{ kind: 'onFoot', ts: m(5) }, { kind: 'still', ts: m(15) }, { kind: 'driving', ts: m(55) }],
        [T, m(60)]);
      expect(out).toBeNull();
    });

    test('the LAST walk wins, not the first', async () => {
      // The dog walk at 7am is not the load-out at 9am. This is the case the
      // owner's own "last motion event before a drive" wording names.
      const out = await win(
        [{ kind: 'onFoot', ts: m(2) }, { kind: 'still', ts: m(12) },
         { kind: 'onFoot', ts: m(50) }, { kind: 'driving', ts: m(58) }],
        [T, m(60)]);
      expect(out).toEqual([50 * 60000, 58 * 60000]);
    });

    test('with no driving transition the departure anchors it, within a minute', async () => {
      // The weaker fallback path: an older shell, or motion refused. The
      // owner's original rule applies because motion stops being reported the
      // second a drive starts.
      const near = await win([{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(29.5) }], [T, m(30)]);
      expect(near).toEqual([10 * 60000, 29.5 * 60000]);
      const far = await win([{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(15) }], [T, m(30)]);
      expect(far).toBeNull();
    });

    test('a driving transition outside the visit is not this visit\'s drive', async () => {
      const out = await win(
        [{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(12) }, { kind: 'driving', ts: m(90) }],
        [T, m(30)]);
      expect(out).toBeNull();       // falls back to the departure, and m(12) is 18 min short
    });

    test('stillness alone is never loading', async () => {
      const out = await win([{ kind: 'still', ts: m(1) }, { kind: 'driving', ts: m(20) }], [T, m(25)]);
      expect(out).toBeNull();
    });

    test('no tape, empty tape, junk tape and a zero window all return null', async () => {
      // The §11.1 input classes. None of these may throw: a tape is optional
      // evidence and its absence must read as "nothing observed", never as an
      // exception out of a visit close that would lose the whole entry.
      const out = await page.evaluate((a) => {
        const call = (t, s, e) => { try { return { v: _geoHomeLoadWindow(t, s, e) }; } catch (err) { return { threw: String(err) }; } };
        return [
          call(null, a.s, a.e), call(undefined, a.s, a.e), call([], a.s, a.e),
          call('nonsense', a.s, a.e), call([{}, null, { kind: 'onFoot' }], a.s, a.e),
          call([{ kind: 'onFoot', ts: a.s }], a.e, a.s),        // e before s
          call([{ kind: 'onFoot', ts: a.s }], a.s, a.s),        // zero width
        ];
      }, { s: T, e: m(30) });
      out.forEach(r => { expect(r.threw).toBeUndefined(); expect(r.v).toBeNull(); });
    });

    test('office time is the app-active spans, with the load-out cut back out', async () => {
      // A minute is never paid twice. The two measures barely overlap in
      // practice (the screen is down while you carry a ladder), but payroll is
      // not the place to lean on "in practice".
      const out = await page.evaluate((a) => {
        const r = _geoHomeSplit(a.tape, a.s, a.e, { spans: [[a.s + 5 * 60000, a.s + 15 * 60000]] });
        return { load: r.load && [r.load[0] - a.s, r.load[1] - a.s], office: r.office.map(x => [x[0] - a.s, x[1] - a.s]) };
      }, { tape: [{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(32) }, { kind: 'driving', ts: m(34) }], s: T, e: m(36) });
      expect(out.load).toEqual([10 * 60000, 32 * 60000]);
      expect(out.office).toEqual([[5 * 60000, 10 * 60000]]);    // the 10-15 half is inside the load-out
    });

    test('contiguous active samples merge into one stretch, not one row per ping', async () => {
      const out = await page.evaluate(() => {
        const sp = [];
        _geoAddSpan(sp, 1000, 2000); _geoAddSpan(sp, 2000, 3000); _geoAddSpan(sp, 2500, 4000);
        _geoAddSpan(sp, 9000, 9500); _geoAddSpan(sp, 5000, 4000);   // zero/negative is ignored
        return sp;
      });
      expect(out).toEqual([[1000, 4000], [9000, 9500]]);
    });

    // ── The two rows, written for real ──────────────────────────────────────
    async function closeHome({ tape, spans, dwellMins, kind }) {
      return page.evaluate(async (a) => {
        const rows = [], realEnq = _geoEnqueue, realUser = _supaUser;
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => rows.push(Object.assign({ _tbl: tbl }, row));
        try {
          places.length = 0;
          savePlace({ id: 'ho-split', name: 'Home Office', kind: a.kind, lat: 41.5, lon: -93.5, confirmedBy: 'manual' });
          _geoHomeDwell = a.spans ? { activeMs: 0, lastSampleMs: 0, spans: a.spans.map(x => x.slice()) } : null;
          _geoClosePlaceEntry('ho-split', new Date(a.s).toISOString(), new Date(a.e).toISOString(), a.tape);
          return rows;
        } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
      }, { tape, spans, kind: kind || 'home_office', s: T, e: T + dwellMins * 60000 });
    }

    test('a morning of paperwork then a load-out writes exactly two labelled rows', async () => {
      const rows = await closeHome({
        tape: [{ kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(32) }, { kind: 'driving', ts: m(34) }],
        spans: [[T, m(8)]], dwellMins: 36,
      });
      const by = (src) => rows.filter(r => r.source === src);
      expect(by('place-load').length).toBe(1);
      expect(by('place-office').length).toBe(1);
      expect(by('place').length).toBe(0);            // never the old anonymous row
      expect(by('place-load')[0].minutes).toBe(22);
      expect(by('place-office')[0].minutes).toBe(8);
      // Both carry the place name and their own dedupe key, so the drain can
      // never collapse the two rows of one visit into one.
      expect(by('place-load')[0].dest_place).toBe('Home Office');
      expect(by('place-load')[0].client_key).not.toBe(by('place-office')[0].client_key);
    });

    test('THE OVERNIGHT ROW: asleep at the home office bills nothing at all', async () => {
      // The regression guard for the live defect this work was found by. Jack
      // Schonfeldt's job_time_entries row for 2026-08-27 reads 7:56pm to
      // 5:23am, source 'place', 567 minutes: nine and a half hours of sleep
      // billed as work, because _geoClosePlaceEntry chose its rule from
      // whether _geoHomeDwell happened to be in memory rather than from the
      // place's own kind. No walking, no app-active time, so nothing was
      // observed and nothing may be billed. If this ever writes a row again,
      // somebody has restored the wall-clock fallback.
      const rows = await closeHome({ tape: null, spans: null, dwellMins: 567 });
      expect(rows.length).toBe(0);
    });

    test('the same night with a tape full of stillness still bills nothing', async () => {
      const rows = await closeHome({
        tape: [{ kind: 'still', ts: m(30) }, { kind: 'still', ts: m(300) }],
        spans: null, dwellMins: 567,
      });
      expect(rows.length).toBe(0);
    });

    test('a load-out under the two-minute floor is a pass-through, not a row', async () => {
      const rows = await closeHome({
        tape: [{ kind: 'onFoot', ts: m(10) }, { kind: 'driving', ts: m(11) }],
        spans: null, dwellMins: 20,
      });
      expect(rows.length).toBe(0);
    });

    test('a supply house is untouched: one place row, the full dwell', async () => {
      // The line this change must not move. A tape is handed in and ignored,
      // because presence at a supply house has always been the work.
      const rows = await closeHome({
        tape: [{ kind: 'onFoot', ts: m(10) }, { kind: 'driving', ts: m(34) }],
        spans: [[T, m(8)]], dwellMins: 36, kind: 'supply',
      });
      expect(rows.length).toBe(1);
      expect(rows[0].source).toBe('place');
      expect(rows[0].minutes).toBe(36);
    });

    test('every home-office source counts as overhead, never as job labour', async () => {
      // The trap this change had to clear: _geoIsPlaceSource was an exact
      // match on 'place', so both new sources would have fallen through every
      // money view's else branch and been billed as ON-SITE JOB LABOUR. Same
      // defect 'drive-personal' already had, same fix, one predicate.
      const out = await page.evaluate(() => ({
        place: _geoIsPlaceSource('place'),
        load: _geoIsPlaceSource('place-load'),
        office: _geoIsPlaceSource('place-office'),
        drive: _geoIsPlaceSource('drive'),
        geofence: _geoIsPlaceSource('geofence'),
        empty: _geoIsPlaceSource(''),
        nul: _geoIsPlaceSource(null),
        undef: _geoIsPlaceSource(undefined),
        label: _tlSourceLabel('place-load') + '|' + _tlSourceLabel('place-office') + '|' + _tlSourceLabel('place'),
      }));
      expect(out.place).toBe(true);
      expect(out.load).toBe(true);
      expect(out.office).toBe(true);
      expect(out.drive).toBe(false);
      expect(out.geofence).toBe(false);
      expect(out.empty).toBe(false);
      expect(out.nul).toBe(false);
      expect(out.undef).toBe(false);
      // 'Loading time', renamed 2026-08-29: the bare word reads as a spinner.
      expect(out.label).toBe('Loading time|Office|');
    });

    // ── The tape goes to the server, and old visits get re-graded from it ──
    test('the tape upload no-ops without a device key, and never throws', async () => {
      // A browser, or a phone whose plugin flush was never configured, has
      // nothing to authenticate with. It must return zero, not throw out of a
      // boot settle point and take the sweeps after it down with it.
      const out = await page.evaluate(async () => {
        const key = localStorage.getItem('zp3_geo_flush_key');
        localStorage.removeItem('zp3_geo_flush_key');
        window._geoTapeSyncRan = false;
        try { return { v: await _geoTapeSync() }; }
        catch (e) { return { threw: String(e) }; }
        finally { if (key) localStorage.setItem('zp3_geo_flush_key', key); }
      });
      expect(out.threw).toBeUndefined();
      expect(out.v).toBe(0);
    });

    test('the tape upload runs once per session, not once per settle', async () => {
      const out = await page.evaluate(async () => {
        window._geoTapeSyncRan = false;
        const a = await _geoTapeSync();
        const b = await _geoTapeSync();     // second call must short-circuit
        return { a, b };
      });
      expect(out.b).toBe(0);
    });

    test('the re-grade no-ops with no home office saved, and never throws', async () => {
      const out = await page.evaluate(async () => {
        places.length = 0;                  // nothing tagged home_office
        window._geoHomeRegradeRan = false;
        try { return { v: await _geoHomeRegradeSweep() }; }
        catch (e) { return { threw: String(e) }; }
      });
      expect(out.threw).toBeUndefined();
      expect(out.v).toBe(0);
    });

    test('the re-grade recovers the load-out and drops the dwell row', async () => {
      // The live shape: a home-office visit that closed under the old rule as
      // one raw-dwell 'place' row. The tape still proves a walk ran into the
      // drive, so that becomes a Loading row and the dwell row goes.
      //
      // The paperwork half is deliberately NOT recovered: app-active time was
      // only ever in memory, so a visit that closed before the rule existed
      // has no evidence of it and this must never invent one.
      const out = await page.evaluate(async () => {
        const T = Date.parse('2026-08-21T12:00:00.000Z'), m = n => T + n * 60000;
        const enq = [], del = [];
        const realEnq = _geoEnqueue, realUser = _supaUser, realSupa = _supa;
        const realTape = window._geoMotionTape, realDel = window._tdSoftDelete;
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => enq.push(Object.assign({ _tbl: tbl }, row));
        window._tdSoftDelete = async (tbl, id) => { del.push(id); };
        window._geoMotionTape = async () => ([
          { kind: 'onFoot', ts: m(10) }, { kind: 'still', ts: m(32) }, { kind: 'driving', ts: m(34) },
        ]);
        _supa = { from: () => ({ select: () => ({ is: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({
          data: [{ id: 'old-row-1', arrived_at: new Date(T).toISOString(),
                   departed_at: new Date(m(36)).toISOString(), minutes: 36,
                   source: 'place', dest_place: 'Home Office', client_key: 'k1' }] }) }) }) }) }) }) };
        try {
          places.length = 0;
          savePlace({ id: 'ho-regrade', name: 'Home Office', kind: 'home_office', lat: 41.5, lon: -93.5, confirmedBy: 'manual' });
          window._geoHomeRegradeRan = false;
          const n = await _geoHomeRegradeSweep();
          return { n, enq, del };
        } finally {
          _geoEnqueue = realEnq; _supaUser = realUser; _supa = realSupa;
          window._geoMotionTape = realTape; window._tdSoftDelete = realDel;
        }
      });
      expect(out.n).toBe(1);
      expect(out.del).toEqual(['old-row-1']);          // the raw-dwell row goes
      expect(out.enq.length).toBe(1);                  // exactly one replacement
      expect(out.enq[0].source).toBe('place-load');
      expect(out.enq[0].minutes).toBe(22);             // the walk, not the 36-minute visit
      expect(out.enq.find(r => r.source === 'place-office'), 'paperwork is never invented').toBeFalsy();
    });

    test('the re-grade drops a dwell row the tape cannot vouch for, and adds nothing', async () => {
      // The overnight case, retroactively: no walking on the tape, so there is
      // no load-out to recover and the row that billed the night still goes.
      const out = await page.evaluate(async () => {
        const T = Date.parse('2026-08-21T02:00:00.000Z');
        const enq = [], del = [];
        const realEnq = _geoEnqueue, realUser = _supaUser, realSupa = _supa;
        const realTape = window._geoMotionTape, realDel = window._tdSoftDelete;
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => enq.push(Object.assign({ _tbl: tbl }, row));
        window._tdSoftDelete = async (tbl, id) => { del.push(id); };
        window._geoMotionTape = async () => ([{ kind: 'still', ts: T + 60000 }]);
        _supa = { from: () => ({ select: () => ({ is: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({
          data: [{ id: 'night-row', arrived_at: new Date(T).toISOString(),
                   departed_at: new Date(T + 567 * 60000).toISOString(), minutes: 567,
                   source: 'place', dest_place: 'Home Office', client_key: 'k2' }] }) }) }) }) }) }) };
        try {
          places.length = 0;
          savePlace({ id: 'ho-regrade2', name: 'Home Office', kind: 'home_office', lat: 41.5, lon: -93.5, confirmedBy: 'manual' });
          window._geoHomeRegradeRan = false;
          await _geoHomeRegradeSweep();
          return { enq, del };
        } finally {
          _geoEnqueue = realEnq; _supaUser = realUser; _supa = realSupa;
          window._geoMotionTape = realTape; window._tdSoftDelete = realDel;
        }
      });
      expect(out.del).toEqual(['night-row']);
      expect(out.enq.length).toBe(0);
    });

    // ── A drive row is paid for the part that was actually driving ─────────
    test('a long still inside a drive comes off, a red light does not', async () => {
      // Owner 2026-08-29: "we go off the background core motion tape for
      // walking still and driving, so why can't this fix it too?" _GEO_STOP_MS
      // is this file's existing line between a red light and a stop, so the
      // allowance under it stays paid and everything over it comes off.
      const out = await page.evaluate(() => {
        const T = Date.parse('2026-08-21T10:00:00.000Z'), m = n => T + n * 60000;
        const mins = ms => Math.round(ms / 60000);
        return {
          // Jack's real shape: rolls at 0, parked 3 to 58, drives on to 62.
          parked: mins(_geoStillOverage([
            { kind: 'driving', ts: m(0) }, { kind: 'still', ts: m(3) }, { kind: 'driving', ts: m(58) },
          ], T, m(62))),
          // Three red lights, none over the allowance: nothing comes off.
          lights: mins(_geoStillOverage([
            { kind: 'driving', ts: m(0) }, { kind: 'still', ts: m(4) }, { kind: 'driving', ts: m(6) },
            { kind: 'still', ts: m(12) }, { kind: 'driving', ts: m(15) },
          ], T, m(20))),
          none: mins(_geoStillOverage([{ kind: 'driving', ts: m(0) }], T, m(30))),
          empty: _geoStillOverage([], T, m(30)),
          nulls: _geoStillOverage(null, T, m(30)),
          backwards: _geoStillOverage([{ kind: 'still', ts: m(1) }], m(30), T),
        };
      });
      expect(out.parked, '55 min parked, less the 5 min allowance').toBe(50);
      expect(out.lights, 'traffic is still driving').toBe(0);
      expect(out.none).toBe(0);
      expect(out.empty).toBe(0);
      expect(out.nulls).toBe(0);
      expect(out.backwards).toBe(0);
    });

    test('the drive trim only ever reduces, and leaves a tapeless row alone', async () => {
      const out = await page.evaluate(async () => {
        const T = Date.parse('2026-08-21T10:00:00.000Z'), m = n => T + n * 60000;
        const realSupa = _supa, realUser = _supaUser, realTape = window._geoMotionTape;
        const updates = [];
        _supaUser = { id: 'u-home' };
        _supa = { from: () => ({
          select: () => ({ is: () => ({ eq: () => ({ gte: async () => ({ data: [
            { id: 'parked', arrived_at: new Date(T).toISOString(), departed_at: new Date(m(62)).toISOString(), minutes: 63, source: 'drive' },
            { id: 'clean', arrived_at: new Date(T).toISOString(), departed_at: new Date(m(20)).toISOString(), minutes: 20, source: 'drive' },
            { id: 'onsite', arrived_at: new Date(T).toISOString(), departed_at: new Date(m(99)).toISOString(), minutes: 99, source: 'geofence' },
          ] }) }) }) }),
          update: (patch) => ({ eq: async (_c, id) => { updates.push({ id, patch }); return {}; } }),
        }) };
        window._geoMotionTape = async (s, e) => (e - s > 30 * 60000)
          ? [{ kind: 'driving', ts: T }, { kind: 'still', ts: m(3) }, { kind: 'driving', ts: m(58) }]
          : [{ kind: 'driving', ts: T }];      // the short leg never stopped
        try {
          window._geoDriveTrimRan = false;
          const n = await _geoDriveTapeTrim();
          return { n, updates };
        } finally { _supa = realSupa; _supaUser = realUser; window._geoMotionTape = realTape; }
      });
      expect(out.n).toBe(1);
      expect(out.updates.length, 'the clean leg and the on-site row are untouched').toBe(1);
      expect(out.updates[0].id).toBe('parked');
      expect(out.updates[0].patch).toEqual({ minutes: 13 });   // 63 paid, 50 parked
    });

    test('the relabel fixes customer visits already written as supply runs', async () => {
      // Owner 2026-08-29: "code should fix Laurie and today's jobs." Keyed on
      // client_key, which both writers have always stamped '-vis-client-'
      // into, so a saved place that happens to share a customer's name is
      // never swept up by accident.
      const out = await page.evaluate(async () => {
        const realSupa = _supa, realUser = _supaUser;
        const updated = [];
        _supaUser = { id: 'u-home' };
        _supa = { from: () => ({
          select: () => ({ is: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ data: [
            { id: 'r1', client_key: '987ebc83-vis-client-1787361287073-aaa', source: 'place', dest_place: 'Laurie Schonfeldt' },
            { id: 'r2', client_key: '987ebc83-vis-client-1787361287073-bbb', source: 'place', dest_place: 'Laurie Schonfeldt' },
            { id: 'r3', client_key: '987ebc83-vis-place-1787001824911-ccc', source: 'place', dest_place: 'The Home Depot' },
            { id: 'r4', client_key: '', source: 'place', dest_place: 'Mystery' },
          ] }) }) }) }) }),
          update: (patch) => ({ in: async (_c, ids) => { updated.push({ patch, ids }); return {}; } }),
        }) };
        try {
          window._geoClientRelabelRan = false;
          const n = await _geoClientRelabelSweep();
          return { n, updated };
        } finally { _supa = realSupa; _supaUser = realUser; }
      });
      expect(out.n).toBe(2);
      expect(out.updated.length).toBe(1);
      expect(out.updated[0].patch).toEqual({ source: 'client' });
      expect(out.updated[0].ids.sort(), 'the supply house and the keyless row are left alone').toEqual(['r1', 'r2']);
    });

    test('the relabel runs once per session and no-ops with nothing to fix', async () => {
      const out = await page.evaluate(async () => {
        const realSupa = _supa, realUser = _supaUser;
        _supaUser = { id: 'u-home' };
        _supa = { from: () => ({ select: () => ({ is: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ data: [] }) }) }) }) }) }) };
        try {
          window._geoClientRelabelRan = false;
          const a = await _geoClientRelabelSweep();
          window._geoClientRelabelRan = false;
          let threw = null;
          _supa = null;                                   // signed out mid-session
          try { await _geoClientRelabelSweep(); } catch (e) { threw = String(e); }
          return { a, threw };
        } finally { _supa = realSupa; _supaUser = realUser; }
      });
      expect(out.a).toBe(0);
      expect(out.threw).toBeNull();
    });

    test('a customer visit is on-site work, never a supply run', async () => {
      // Owner 2026-08-29: "why did Laurie go as supply run when she was a
      // lead? That shouldn't happen." _geoCloseClientEntry wrote 'place', the
      // same value a Home Depot visit gets, so a real beta user's 2h07m at a
      // customer's house was pooled with the parts counter and billed as
      // overhead. No bid or job is required for it to be work: the owner's
      // rule is "Jack did work with no bid and that's fine."
      const out = await page.evaluate(async () => {
        const rows = [], realEnq = _geoEnqueue, realUser = _supaUser;
        _supaUser = { id: 'u-home' };
        _geoEnqueue = (tbl, row) => rows.push(Object.assign({ _tbl: tbl }, row));
        try {
          if (typeof clients !== 'undefined') { clients.length = 0; clients.push({ id: 'c-laurie', name: 'Laurie Schonfeldt' }); }
          const t = Date.parse('2026-08-21T14:00:00.000Z');
          _geoCloseClientEntry('c-laurie', new Date(t).toISOString(), new Date(t + 99 * 60000).toISOString());
          return rows;
        } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
      });
      expect(out.length).toBe(1);
      expect(out[0].source).toBe('client');
      expect(out[0].minutes).toBe(99);
      expect(out[0].dest_place).toBe('Laurie Schonfeldt');
    });

    test('client time lands in on-site labour, not the overhead bucket', async () => {
      const out = await page.evaluate(() => ({
        isPlace: _geoIsPlaceSource('client'),        // must NOT pool with supply
        isDrive: _geoIsDriveSource('client'),
        label: _tlSourceLabel('client'),             // the row shows the person's name instead
        agg: _tlEmpWeekAgg([
          { rawSource: 'client', detail: '', minutes: 127, personUid: 'u1', personName: 'Jack' },
          { rawSource: 'place', detail: '', minutes: 15, personUid: 'u1', personName: 'Jack' },
        ], 'cid').u1,
      }));
      expect(out.isPlace).toBe(false);
      expect(out.isDrive).toBe(false);
      expect(out.label).toBe('');
      expect(out.agg.onsiteMin, "the customer's house is on-site work").toBe(127);
      expect(out.agg.placeMin, 'only the supply house is overhead').toBe(15);
    });

    test('a client visit still dedupes and still merges, same as it always did', async () => {
      // The trap in splitting the source off 'place': two sweeps keyed on the
      // old string by name. The merge sweep's original ask was literally a day
      // of John Doe visits, and John Doe is a client.
      const out = await page.evaluate(() => {
        const onSite = s => /^(geofence|stop|manual|place|client)$/.test(String(s || '')) || /^(geofence|place|client)-/.test(String(s || ''));
        const isCandidate = s => /^(geofence|geofence-gap|place|client)$/.test(String(s || ''));
        return { dedup: onSite('client'), merge: isCandidate('client'), notDrive: onSite('drive') };
      });
      expect(out.dedup).toBe(true);
      expect(out.merge).toBe(true);
      expect(out.notDrive).toBe(false);
    });

    test('the weekly split bar reads the raw column, not the friendly label', async () => {
      // The bug found while wiring this up, and the reason the assertion above
      // is not enough on its own: _tlEmpWeekAgg fed `detail` ('Driving', '',
      // 'Loading') to predicates that test the RAW source, so every GPS drive
      // leg and supply visit was silently counted as on-site labour while Crew
      // Cost, reading the raw column, put them in overhead. The two reports
      // are supposed to be incapable of disagreeing.
      const out = await page.evaluate(() => _tlEmpWeekAgg([
        { rawSource: 'drive', detail: 'Driving', minutes: 30, personUid: 'u1', personName: 'A' },
        { rawSource: 'place', detail: '', minutes: 10, personUid: 'u1', personName: 'A' },
        { rawSource: 'place-load', detail: 'Loading time', minutes: 22, personUid: 'u1', personName: 'A' },
        { rawSource: 'place-office', detail: 'Office', minutes: 8, personUid: 'u1', personName: 'A' },
        { rawSource: 'geofence', detail: '', minutes: 60, personUid: 'u1', personName: 'A' },
      ], 'cid').u1);
      expect(out.driveMin).toBe(30);
      expect(out.placeMin).toBe(40);     // 10 supply + 22 loading + 8 office, all overhead
      expect(out.onsiteMin).toBe(60);    // only the real job fence
      expect(out.min).toBe(130);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
