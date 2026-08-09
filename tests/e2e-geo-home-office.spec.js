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
        await ping(a.road);                  // pull out: this ping closes the visit
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
    test.beforeAll(async () => {
      await page.evaluate((d) => {
        S.officeLat = d.HOME.lat; S.officeLon = d.HOME.lon;
        S.teamTracking = true;
        if (typeof places !== 'undefined') places.length = 0;
        savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
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

    test('the tally survives exactly the ping that closes the visit', async () => {
      // The ordering trap: the sampler runs BEFORE the fence machine, so if it
      // cleared on first sight of an outside coordinate, the closer running later
      // in that same ping would read null and fall straight back to wall clock,
      // putting the whole night back. One ping of carry-over, then gone.
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
            await ping(d.ROAD);
            const secondOut = !!_geoHomeDwell;
            return { atHome, firstOut, secondOut };
          })();
        } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
      }, { HOME, ROAD });
      expect(out.atHome).toBe(true);
      expect(out.firstOut).toBe(true);
      expect(out.secondOut).toBe(false);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
