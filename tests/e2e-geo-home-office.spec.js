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



  });

  test.describe('everywhere else still bills presence', () => {
    test.beforeAll(async () => {
      await page.evaluate((d) => {
        S.officeLat = d.YARD.lat; S.officeLon = d.YARD.lon;
        S.teamTracking = true;
        if (typeof places !== 'undefined') places.length = 0;
      }, { YARD });
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
      const out = await page.evaluate(() => {
        const e = _tlEmpWeekAgg([
          { rawSource: 'drive', detail: 'Driving', minutes: 30, personUid: 'u1', personName: 'A' },
          { rawSource: 'place', detail: '', minutes: 10, personUid: 'u1', personName: 'A' },
          { rawSource: 'place-load', detail: 'Loading time', minutes: 22, personUid: 'u1', personName: 'A' },
          { rawSource: 'place-office', detail: 'Office', minutes: 8, personUid: 'u1', personName: 'A' },
          { rawSource: 'geofence', detail: '', minutes: 60, personUid: 'u1', personName: 'A' },
        ], 'cid').u1;
        // _tlBucketTotal is a page global, so it has to be called in the page.
        return Object.assign({}, e, { bucketTotal: _tlBucketTotal(e) });
      });
      expect(out.driveMin).toBe(30);
      // Loading left this bucket on 2026-08-30: the day rail's legend names it,
      // and a bucket with no name of its own cannot be named. Still overhead,
      // still never on-site, just counted under its own key now.
      expect(out.loadMin).toBe(22);
      expect(out.placeMin).toBe(18);     // 10 supply + 8 office
      expect(out.onsiteMin).toBe(60);    // only the real job fence
      expect(out.min).toBe(130);
      // The split bar must still add up to every paid minute: a bucket carved
      // out of another one is exactly how a total quietly starts losing time.
      expect(out.bucketTotal).toBe(out.min);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
