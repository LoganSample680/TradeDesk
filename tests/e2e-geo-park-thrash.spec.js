// @ts-check
// ── THE PARK THAT COULD NOT STAY PARKED (owner 2026-09-21, on Jack's phone) ──
//
// "saw his phone is at 45 percent, did we kill his battery today?"
//
// Yes. His engine went into a park arm/exit loop: about 2,300 laps in eleven
// minutes, roughly three and a half a second, of
//
//   tracking start -> park armed -> park exit -> park: stop -> tracking start
//
// 13,794 `radio` rows in one hour against a normal one to three a minute, and
// 11,928 GPS receiver starts across the day.
//
// Root cause: _geoTdEvent asked whether the fix had left `_geoLastFenceLoc` at
// the plain fence radius. That variable is the last fence the phone was INSIDE
// and it is never cleared on leaving one, so a park at an address nobody saved
// was measured against a customer he had driven away from twenty minutes
// earlier. Every fix read as "outside the fence", the park exited on the spot,
// exiting restarts tracking, the stop detector parks again, and the next fix
// exits again.
//
// It also froze his timesheet: every derive re-reads the whole day's events
// and his day reached about 25,000 of them. That half is guarded in
// tests/e2e-geo-derive-server.spec.js.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// A customer he left, and the kerb he parked at four minutes up the road.
const FENCE = { lat: 39.0123292, lng: -95.7464936, name: 'Tagen Lindstrom', kind: 'client' };
const KERB = { lat: 39.0307066, lng: -95.7112082, name: 'stop' };

test.describe('a park stays parked where it armed', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { try { await page.context().close(); } catch (_e) { } });

  // Drive one fix through _geoTdEvent with the engine parked at `park`, and
  // report whether the park survived it. _geoExitParkMode is stubbed: it is
  // the thing under test, and letting the real one run would restart tracking
  // and take the rest of the engine with it.
  const feed = (park, radiusM, fix, lastFence) => page.evaluate(async ([park, radiusM, fix, lastFence]) => {
    const saved = { exit: window._geoExitParkMode, on: _geoParkModeOn,
      spot: _geoParkSpot, r: _geoParkRadiusM, lf: _geoLastFenceLoc };
    let exits = 0;
    try {
      window._geoExitParkMode = () => { exits++; };
      _geoParkModeOn = true;
      _geoParkSpot = park;
      _geoParkRadiusM = radiusM;
      _geoLastFenceLoc = lastFence;
      await _geoTdEvent({ type: 'fix', ts: Date.now(), lat: fix.lat, lng: fix.lng, accuracy: 8 }, false);
      return { exits };
    } finally {
      window._geoExitParkMode = saved.exit; _geoParkModeOn = saved.on;
      _geoParkSpot = saved.spot; _geoParkRadiusM = saved.r; _geoLastFenceLoc = saved.lf;
    }
  }, [park, radiusM, fix, lastFence]);

  test("Jack's loop: sitting still at the kerb no longer exits the park", async () => {
    // The exact shape of it. Parked at an anonymous stop with a 250m region,
    // and the last fence he was inside is a customer two miles away. Before
    // the fix this exited on every single fix.
    const r = await feed(KERB, 250, KERB, FENCE);
    expect(r.exits, 'he has not moved: the park holds').toBe(0);
  });

  test('and it holds anywhere inside the region it actually armed', async () => {
    // 150m from the kerb, well inside a 250m park and well OUTSIDE a 600ft
    // fence, which is the gap the old test fell through. A person parked on
    // foot wanders, which is why the anonymous stop arms at a 250m floor in
    // the first place; judging its exit at 600ft threw that away.
    const near = { lat: KERB.lat + 0.00135, lng: KERB.lng };
    const r = await feed(KERB, 250, near, FENCE);
    expect(r.exits).toBe(0);
  });

  test('leaving the park really does still exit it', async () => {
    // The rule is narrower, not weaker. Half a mile away is gone.
    const away = { lat: KERB.lat + 0.008, lng: KERB.lng + 0.008 };
    const r = await feed(KERB, 250, away, FENCE);
    expect(r.exits).toBe(1);
  });

  test('a region exit from iOS still exits, wherever the fix says it is', async () => {
    const r = await page.evaluate(async () => {
      const saved = { exit: window._geoExitParkMode, on: _geoParkModeOn, spot: _geoParkSpot, r: _geoParkRadiusM };
      let exits = 0;
      try {
        window._geoExitParkMode = () => { exits++; };
        _geoParkModeOn = true; _geoParkSpot = { lat: 39.0307066, lng: -95.7112082 }; _geoParkRadiusM = 250;
        await _geoTdEvent({ type: 'regionExit', ts: Date.now(), region_id: 'fence' }, false);
        return exits;
      } finally {
        window._geoExitParkMode = saved.exit; _geoParkModeOn = saved.on;
        _geoParkSpot = saved.spot; _geoParkRadiusM = saved.r;
      }
    });
    expect(r).toBe(1);
  });

  test('a park this JS never armed falls back to the old pair, unchanged', async () => {
    // A restore from a build before the radius was persisted. Every version
    // before today behaved exactly this way and must keep doing so.
    const r = await feed(null, 0, KERB, FENCE);
    expect(r.exits, 'no park spot, so the last fence decides as it always did').toBe(1);
    const near = await feed(null, 0, { lat: FENCE.lat, lng: FENCE.lng }, FENCE);
    expect(near.exits).toBe(0);
  });

  test('the park records where and how wide it armed', async () => {
    // The exit test can only ask the park's own question if the park answered
    // it. Read off the source rather than driving a real arm, which needs the
    // native plugin.
    const src = await page.evaluate(() => _geoEnterParkMode.toString());
    expect(src).toContain('_geoParkSpot=_at');
    expect(src).toContain('_geoParkRadiusM=radiusM');
  });

  test('and forgets the radius the moment the park ends', async () => {
    const r = await page.evaluate(() => {
      const saved = { on: _geoParkModeOn, r: _geoParkRadiusM, td: window._geoTdPlugin };
      try {
        window._geoTdPlugin = () => null;      // no plugin: stopAll is skipped
        _geoParkModeOn = true; _geoParkRadiusM = 250;
        _geoExitParkMode();
        return _geoParkRadiusM;
      } finally { _geoParkModeOn = saved.on; _geoParkRadiusM = saved.r; window._geoTdPlugin = saved.td; }
    });
    expect(r, 'a stale radius would judge the NEXT park by the last one').toBe(0);
  });

  test('junk never throws and never exits a park by accident', async () => {
    const r = await page.evaluate(async () => {
      const saved = { exit: window._geoExitParkMode, on: _geoParkModeOn, spot: _geoParkSpot, r: _geoParkRadiusM };
      let exits = 0, threw = 0;
      try {
        window._geoExitParkMode = () => { exits++; };
        _geoParkModeOn = true;
        for (const [spot, rad] of [[null, 0], [{}, 250], [{ lat: 'x', lng: 'y' }, 250],
                                   [{ lat: 39, lng: -95 }, 'nope'], [{ lat: 39, lng: -95 }, -1]]) {
          _geoParkSpot = spot; _geoParkRadiusM = rad;
          for (const ev of [{ type: 'fix', ts: Date.now() }, { type: 'fix', ts: Date.now(), lat: null, lng: null }]) {
            try { await _geoTdEvent(ev, false); } catch (_e) { threw++; }
          }
        }
        return { exits, threw };
      } finally {
        window._geoExitParkMode = saved.exit; _geoParkModeOn = saved.on;
        _geoParkSpot = saved.spot; _geoParkRadiusM = saved.r;
      }
    });
    expect(r.threw).toBe(0);
    expect(r.exits, 'a fix with no position says nothing about where he is').toBe(0);
  });

  test('no console errors', () => { assertNoErrors(page, 'park-thrash'); });
});
