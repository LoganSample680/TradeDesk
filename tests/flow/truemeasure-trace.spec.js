// TrueMeasure REAL-PROPERTY TRACE (owner-directed demo, 2026-08-20): on the
// deployed app's real satellite imagery of 2015 SW Randolph Ave, Topeka:
//   1. drop the FIRST house corner with the press-and-hold precision gesture,
//   2. tap the remaining roof corners to close the house outline,
//   3. clear, then tap-trace the lawn and read its square footage.
// Corner screen coordinates were picked by eye off the truemeasure-recon
// scene capture (same signed-in account, same fixed SPAN framing, same
// Pixel 7 viewport, so recon pixels map 1:1 to this run's screen).
// Emits a scene JPEG after each trace through the CI log (base64).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPAN = 0.0008;

// Screen CSS-px coordinates (Pixel 7 viewport; map box x:0 y:67 w:412 h:636,
// verified identical in both recon runs). Picked off randolph-scene2.jpg
// (image px / 2.625 dpr + map box offset).
const HOUSE = [
  { x: 167, y: 333 },  // NW roof corner (precision-hold drop)
  { x: 219, y: 342 },  // NE
  { x: 210, y: 390 },  // SE
  { x: 158, y: 378 },  // SW
];
const LAWN = [
  { x: 91, y: 330 },   // yard west of the house
  { x: 164, y: 333 },
  { x: 164, y: 410 },
  { x: 93, y: 412 },
];

test.describe('TrueMeasure real-property trace (2015 SW Randolph)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch injection is Chromium-only');

  test('hold-drop + tap-trace the house, then the lawn', async ({ page, context }) => {
    test.setTimeout(180000);
    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991301, name: 'Trace Demo', addr: '2015 SW Randolph Ave, Topeka, KS 66604' }));
    await page.waitForFunction(() => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map, null, { timeout: 30000 });
    await sleep(2000);

    const setFrame = () => page.evaluate((span) => {
      // Re-frame to the exact recon framing (geocode center + fixed span).
      // Also used to recover after the precision-hold's recenter (the
      // camera zoom eases back on release, the center deliberately stays).
      if (!_tmState._frame) _tmState._frame = { lat: _tmState.map.center.latitude, lng: _tmState.map.center.longitude };
      const f = _tmState._frame;
      _tmState.map.region = new mapkit.CoordinateRegion(new mapkit.Coordinate(f.lat, f.lng), new mapkit.CoordinateSpan(span, span));
      return f;
    }, SPAN);
    const frame = await setFrame();
    console.log(`[trace] frame center ${JSON.stringify(frame)}`);
    await sleep(4000);

    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: 1 })),
    });
    const emitShot = async (tag) => {
      const box = await page.evaluate(() => {
        const r = document.getElementById('tm-canvas-wrap').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const shot = await page.screenshot({ type: 'jpeg', quality: 60, clip: box });
      const b64 = shot.toString('base64');
      console.log(`[trace] ${tag} jpeg bytes=${shot.length}`);
      console.log(`[${tag}-b64-begin]`);
      for (let i = 0; i < b64.length; i += 8000) console.log(b64.slice(i, i + 8000));
      console.log(`[${tag}-b64-end]`);
    };

    // ── 1. First house corner via precision hold ─────────────────────────
    const t0 = HOUSE[0];
    // The geo coordinate under the target BEFORE the hold moves the camera.
    const targetCoord = await page.evaluate(([x, y]) => {
      const c = _tmState.map.convertPointOnPageToCoordinate(new DOMPoint(x, y));
      return { lat: c.latitude, lng: c.longitude };
    }, [t0.x, t0.y]);
    await touch('touchStart', [{ x: t0.x, y: t0.y + 70 }]); // crosshair sits 70px above the finger
    await sleep(1500); // hold engages + camera settles
    // Where is the target geo on the (possibly recentered/zoomed) camera now?
    const tNow = await page.evaluate((tc) => {
      const p = _tmState.map.convertCoordinateToPointOnPage(new mapkit.Coordinate(tc.lat, tc.lng));
      return { x: p.x, y: p.y };
    }, targetCoord);
    // Walk the finger so the crosshair covers the target, then release.
    await touch('touchMove', [{ x: (t0.x + tNow.x) / 2, y: (t0.y + tNow.y) / 2 + 70 }]);
    await sleep(120);
    await touch('touchMove', [{ x: tNow.x, y: tNow.y + 70 }]);
    await sleep(250);
    await touch('touchEnd', []);
    await sleep(900);
    const p1 = await page.evaluate(() => _tmState.points[0] || null);
    expect(p1, 'precision hold must drop the first corner').not.toBeNull();
    const p1ErrM = Math.hypot(
      (p1.lat - targetCoord.lat) * 111320,
      (p1.lng - targetCoord.lng) * 111320 * Math.cos(targetCoord.lat * Math.PI / 180),
    );
    console.log(`[trace] hold-drop corner err=${p1ErrM.toFixed(2)}m`);

    // ── 2. Tap the remaining roof corners ────────────────────────────────
    await setFrame();
    await sleep(900);
    for (const c of HOUSE.slice(1)) {
      await touch('touchStart', [{ x: c.x, y: c.y }]);
      await sleep(70);
      await touch('touchEnd', []);
      await sleep(450);
    }
    const house = await page.evaluate(() => ({ pts: _tmState.points.length, m: _tmMeasure() }));
    console.log(`[trace] HOUSE: ${house.pts} points, ${house.m.value} ${house.m.unit}`);
    expect(house.pts).toBe(4);
    expect(house.m.value).toBeGreaterThan(200); // a real roof, not a degenerate sliver
    await sleep(600);
    await emitShot('house');

    // ── 3. Clear, trace the lawn ─────────────────────────────────────────
    await page.evaluate(() => { _tmState.points = []; _tmRedraw(); });
    await setFrame();
    await sleep(900);
    for (const c of LAWN) {
      await touch('touchStart', [{ x: c.x, y: c.y }]);
      await sleep(70);
      await touch('touchEnd', []);
      await sleep(450);
    }
    const lawn = await page.evaluate(() => ({ pts: _tmState.points.length, m: _tmMeasure() }));
    console.log(`[trace] LAWN: ${lawn.pts} points, ${lawn.m.value} ${lawn.m.unit}`);
    expect(lawn.pts).toBe(4);
    expect(lawn.m.value).toBeGreaterThan(500);
    await sleep(600);
    await emitShot('lawn');
  });
});
