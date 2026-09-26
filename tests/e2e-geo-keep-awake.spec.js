// @ts-check
// ── The mix: awake through the shift, asleep off the clock (owner 2026-09-26) ─
//
// "Do it Life360 style but still get events in 10 seconds." iOS never wakes a
// sleeping app because the motion chip changed, so a flip only reaches the
// server live if the app is already awake. 9/25: the owner's phone, awake all
// day, 93% of flips inside 10s; Jack's, asleep, 8%.
//
// Two halves, both in js/geo-track.js:
//   * _geoKeepAwakeMs / _geoHeartbeatSync: inside working hours the shift beat
//     holds the 3km keep-awake (no GPS) with a ttl that ends it at the close
//     of the shift by itself; off the clock, on a day off, on Time off and at
//     home it holds nothing.
//   * _geoEnterParkMode: the GPS release and the keep-awake happen in the same
//     tick the park is sent, not when iOS answers. Parking mostly happens as
//     the app backgrounds, iOS pauses the page a moment later, and the answer
//     waited twelve hours for the next open: his GPS ran 7:37am to 8:09pm.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the mix', () => {
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

  // A Wednesday, in the page's own local time, which is what the gate reads.
  const at = (h, m, day = 23) => `new Date(2026, 8, ${day}, ${h}, ${m}).getTime()`;

  test.describe('how long to stay awake', () => {
    const awake = (nowSrc, setup = '') => page.evaluate(`(() => {
      const keep = { wh: S.workHours, off: S.timeOff };
      try { ${setup}; return _geoKeepAwakeMs(${nowSrc}); }
      finally { S.workHours = keep.wh; S.timeOff = keep.off; }
    })()`);

    test('mid-shift: the rest of the working day', async () => {
      expect(await awake(at(10, 0), "S.workHours = { start: '06:00', end: '20:00', days: [1,2,3,4,5,6] }; S.timeOff = []"))
        .toBe(10 * 3600000);
    });
    test('before the shift and after it: asleep', async () => {
      const set = "S.workHours = { start: '06:00', end: '20:00', days: [1,2,3,4,5,6] }; S.timeOff = []";
      expect(await awake(at(5, 59), set)).toBe(0);
      expect(await awake(at(20, 0), set)).toBe(0);
      expect(await awake(at(23, 30), set)).toBe(0);
    });
    test('the last minute of the shift is still awake, and only for that minute', async () => {
      expect(await awake(at(19, 59), "S.workHours = { start: '06:00', end: '20:00', days: [3] }; S.timeOff = []"))
        .toBe(60000);
    });
    test('a day that is not a working day: asleep', async () => {
      // 2026-09-27 is a Sunday.
      expect(await awake(at(10, 0, 27), "S.workHours = { start: '06:00', end: '20:00', days: [1,2,3,4,5,6] }; S.timeOff = []"))
        .toBe(0);
    });
    test('Time off: asleep, and only on the days it covers', async () => {
      const set = "S.workHours = { start: '06:00', end: '20:00', days: [1,2,3,4,5,6] }; S.timeOff = [{ start: '2026-09-23', end: '2026-09-24' }]";
      expect(await awake(at(10, 0, 23), set)).toBe(0);
      expect(await awake(at(10, 0, 24), set)).toBe(0);
      expect(await awake(at(10, 0, 25), set)).toBeGreaterThan(0);
    });
    test('the company\'s own hours win over the defaults', async () => {
      expect(await awake(at(16, 0), "S.workHours = { start: '07:00', end: '15:30', days: [3] }; S.timeOff = []")).toBe(0);
      expect(await awake(at(15, 0), "S.workHours = { start: '07:00', end: '15:30', days: [3] }; S.timeOff = []")).toBe(30 * 60000);
    });
    test('junk settings fall back to the defaults, and junk time never throws', async () => {
      expect(await awake(at(10, 0), "S.workHours = { start: 'x', end: null, days: 'no' }; S.timeOff = 'bad'"))
        .toBe(10 * 3600000);
      expect(await awake('NaN', "S.timeOff = [null, {}, { start: 5 }]")).toBe(0);
      expect(await awake(at(10, 0), "S.workHours = { start: '12:00', end: '09:00', days: [3] }")).toBe(0);
    });
  });

  test.describe('the beat holds the keep-awake only through the shift', () => {
    const beat = (script) => page.evaluate(`(() => {
      const saved = { td: _geoTdPlugin, home: _placeIsLikelyHome, aw: _geoKeepAwakeMs };
      const calls = { start: [], stop: [] };
      _geoTdPlugin = () => ({
        startHeartbeat: (o) => { calls.start.push(o); return Promise.resolve({ on: true }); },
        stopHeartbeat: (o) => { calls.stop.push(o); return Promise.resolve({ on: false }); },
      });
      _placeIsLikelyHome = (c) => !!(c && c.lat === 39.9);
      _geoHbArmedAtMs = 0; _geoHbKeepAwake = null;
      try { ${script}; return calls; }
      finally { _geoTdPlugin = saved.td; _placeIsLikelyHome = saved.home; _geoKeepAwakeMs = saved.aw; _geoHbArmedAtMs = 0; _geoHbKeepAwake = null; }
    })()`);

    test('in the shift: the 3km keep-awake, ending itself when the shift does', async () => {
      const c = await beat('_geoKeepAwakeMs = () => 4 * 3600000; _geoHeartbeatSync(null)');
      expect(c.start).toEqual([{ intervalMs: 30 * 60000, ttlMs: 4 * 3600000, keepalive: true, reason: 'shift keep-awake' }]);
    });
    test('off the clock: the bare tick, nothing holding the phone awake', async () => {
      const c = await beat('_geoKeepAwakeMs = () => 0; _geoHeartbeatSync(null)');
      expect(c.start).toEqual([{ intervalMs: 30 * 60000, ttlMs: 12 * 3600000, keepalive: false, reason: 'shift start' }]);
    });
    test('a change of answer re-arms at once; the same answer inside a minute does not', async () => {
      const c = await beat(`
        _geoKeepAwakeMs = () => 3600000; _geoHeartbeatSync(null); _geoHeartbeatSync(null);
        _geoKeepAwakeMs = () => 0; _geoHeartbeatSync(null)`);
      expect(c.start.map(o => o.keepalive)).toEqual([true, false]);
    });
    test('home ends it, whatever the hour', async () => {
      const c = await beat('_geoKeepAwakeMs = () => 3600000; _geoHeartbeatSync(null); _geoHeartbeatSync({ lat: 39.9, lng: -94.9 })');
      expect(c.stop).toEqual([{ reason: 'parked at home' }]);
    });
  });

  test.describe('parking lets go of the GPS in the same moment', () => {
    // The answer from iOS NEVER arrives here, which is exactly the phone in the
    // pocket: everything that matters must already have happened.
    const park = (startEvents, opts = {}) => page.evaluate(async ({ startEventsSrc, native }) => {
      const saved = { td: _geoTdPlugin, on: _geoAppOnScreen, wid: _geoNativeWatcherId, park: _geoParkModeOn,
        hb: _geoHeartbeatSync, drop: _geoDropWatchers, nat: _geoNativePlugin, start: startGeoTracking };
      const seen = { drop: [], hb: [], started: 0 };
      // eslint-disable-next-line no-new-func
      const se = new Function('return ' + startEventsSrc)();
      _geoTdPlugin = () => ({ startEvents: se, startParked: se, setWakeOnMove: () => Promise.resolve({ on: false }) });
      _geoAppOnScreen = () => false; _geoNativeWatcherId = 'w-live'; _geoParkModeOn = false; _geoClearParkTimer();
      _geoHeartbeatSync = (s) => { seen.hb.push(s && s.name); };
      _geoDropWatchers = (why) => { seen.drop.push(why); return 1; };
      _geoNativePlugin = () => (native ? { addWatcher: () => Promise.resolve('w2') } : null);
      startGeoTracking = () => { seen.started++; };
      try {
        _geoEnterParkMode({ lat: 39.1, lng: -94.1, name: 'Smith job' });
        const sync = { drop: seen.drop.slice(), hb: seen.hb.slice(), on: _geoParkModeOn };
        await new Promise(r => setTimeout(r, 30));
        return { sync, later: { on: _geoParkModeOn, started: seen.started, timer: _geoParkTimer != null } };
      } finally {
        _geoTdPlugin = saved.td; _geoAppOnScreen = saved.on; _geoNativeWatcherId = saved.wid; _geoParkModeOn = saved.park;
        _geoHeartbeatSync = saved.hb; _geoDropWatchers = saved.drop; _geoNativePlugin = saved.nat; startGeoTracking = saved.start;
        _geoClearParkTimer();
        try { localStorage.removeItem('zp3_geo_park'); } catch (e) {}
      }
    }, { startEventsSrc: startEvents, native: !!opts.native });

    test('the GPS watcher is released and the keep-awake armed before iOS answers', async () => {
      const r = await park('() => new Promise(() => {})');
      expect(r.sync).toEqual({ drop: ['park: Smith job'], hb: ['Smith job'], on: true });
    });
    test('a park iOS refuses puts the live watcher back and tries again', async () => {
      const r = await park("() => Promise.reject(new Error('no'))", { native: true });
      expect(r.later).toEqual({ on: false, started: 1, timer: true });
    });
    test('a park iOS accepts stays parked, and nothing restarts the GPS', async () => {
      const r = await park('() => Promise.resolve({ armed: 3 })', { native: true });
      expect(r.later).toEqual({ on: true, started: 0, timer: false });
    });
  });

  test('no console errors, the mix', async () => { assertNoErrors(page); });
});
