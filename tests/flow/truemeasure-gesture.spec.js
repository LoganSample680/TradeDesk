// TrueMeasure GESTURE PROBE — measures the physical map-gesture mechanics
// against the REAL deployed app (real MapKit, which only initializes on the
// deployed pages.dev / tradedeskpro.app origins, never localhost).
//
// This deliberately deviates from the estimate-build step()/report() reference
// shape (§12.1): it is not a user-journey click-budget flow, it is a
// regression harness for the three live-device gesture bugs the owner
// reported 2026-08-20 (points landing away from the finger, the camera
// drifting during the precision hold, zoom-in not engaging). Every check is a
// numeric measurement of the map camera and placed-point geometry, driven by
// REAL trusted touch input via CDP Input.dispatchTouchEvent — synthetic
// dispatchEvent() JS events would not exercise MapKit's own gesture
// recognizers, which are the exact thing under test.
//
// Chromium-only: CDP touch injection is a Chromium capability. No sign-in:
// the map surface needs no account (openTrueMeasure with no client addr falls
// back to the default US-center coordinate), and the probe never saves
// anything, so it leaves zero rows behind (§12.7 moot).
const { test, expect } = require('./flow-test');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('TrueMeasure gesture probe (real MapKit)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch injection is Chromium-only');

  test('tap placement, hold-zoom engagement, camera hold during drag, drop accuracy', async ({ page, context }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });

    await page.evaluate(() => openTrueMeasure({ id: 991234, name: 'Gesture Probe', addr: '' }));
    // _tmState is a script-scoped `let` (like _mapkitReady, see
    // topeka-day-flow.spec.js) — it is NOT a window property, so it must be
    // read as a bare identifier, never window._tmState.
    await page.waitForFunction(
      () => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map,
      null, { timeout: 20000 },
    ).catch(async (e) => {
      const diag = await page.evaluate(() => ({
        overlay: !!document.getElementById('_tm-ov'),
        fallbackShown: (document.getElementById('tm-unavailable') || {}).style?.display,
        state: typeof _tmState !== 'undefined' && !!_tmState,
      }));
      throw new Error('TrueMeasure map never initialized: ' + JSON.stringify(diag) + ' :: ' + e.message);
    });
    await sleep(2500); // tiles + region settle

    const mapInfo = () => page.evaluate(() => ({
      center: { lat: _tmState.map.center.latitude, lng: _tmState.map.center.longitude },
      dist: _tmState.map.cameraDistance,
      pts: _tmState.points.length,
    }));
    const wrapBox = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: 1 })),
    });

    // ── A: a quick tap places a point directly under the finger ──────────
    const tapX = Math.round(wrapBox.x + wrapBox.w * 0.5);
    const tapY = Math.round(wrapBox.y + wrapBox.h * 0.4);
    await touch('touchStart', [{ x: tapX, y: tapY }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(600);
    const afterTap = await page.evaluate(() => {
      const p = _tmState.points[_tmState.points.length - 1];
      if (!p) return { placed: false };
      const pt = _tmState.map.convertCoordinateToPointOnPage(new mapkit.Coordinate(p.lat, p.lng));
      return { placed: true, pts: _tmState.points.length, screenX: pt.x, screenY: pt.y };
    });
    expect(afterTap.placed, 'quick tap must place a point').toBe(true);
    const tapErr = Math.hypot(afterTap.screenX - tapX, afterTap.screenY - tapY);
    console.log(`[probe] TAP: target=(${tapX},${tapY}) landed=(${afterTap.screenX.toFixed(1)},${afterTap.screenY.toFixed(1)}) errPx=${tapErr.toFixed(1)}`);
    expect(tapErr, 'tap point must land under the finger (px)').toBeLessThan(12);

    // ── B: press-and-hold engages the precision zoom-in ──────────────────
    const holdX = Math.round(wrapBox.x + wrapBox.w * 0.35);
    const holdY = Math.round(wrapBox.y + wrapBox.h * 0.55);
    const preHold = await mapInfo();
    await touch('touchStart', [{ x: holdX, y: holdY }]);
    await sleep(1300); // HOLD_MS(420) + entrance zoom animation
    const zoomed = await mapInfo();
    const crossVisible = await page.evaluate(() => document.getElementById('tm-crosshair').style.display === 'block');
    console.log(`[probe] HOLD: preDist=${preHold.dist.toFixed(0)}m zoomedDist=${zoomed.dist.toFixed(0)}m crosshair=${crossVisible}`);
    expect(crossVisible, 'crosshair must appear on hold').toBe(true);
    expect(zoomed.dist, 'hold must zoom the camera in').toBeLessThan(preHold.dist * 0.6);

    // ── C: dragging while held moves ONLY the crosshair, never the camera ─
    await sleep(400); // let the entrance animation fully settle
    const lockCenter = await mapInfo();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: holdX + i * 10, y: holdY + i * 4 }]);
      await sleep(90);
    }
    const midDrag = await mapInfo();
    const driftM = Math.hypot(
      (midDrag.center.lat - lockCenter.center.lat) * 111320,
      (midDrag.center.lng - lockCenter.center.lng) * 111320 * Math.cos(lockCenter.center.lat * Math.PI / 180),
    );
    const distRatio = midDrag.dist / lockCenter.dist;
    console.log(`[probe] DRAG: cameraDrift=${driftM.toFixed(1)}m distRatio=${distRatio.toFixed(2)}`);

    // ── D: releasing drops the point under the crosshair ─────────────────
    const endX = holdX + steps * 10, endY = holdY + steps * 4;
    // Sample the expected drop position BEFORE touchEnd: the camera eases
    // back out afterwards, which moves every screen<->coord mapping.
    const expectedDrop = await page.evaluate(([x, y]) => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      const OFFSET_Y = 70;
      const relY = y - r.y;
      const crossY = r.y + Math.max(20, relY - OFFSET_Y);
      const c = _tmState.map.convertPointOnPageToCoordinate(new DOMPoint(x, crossY));
      return { lat: c.latitude, lng: c.longitude };
    }, [endX, endY]);
    await touch('touchEnd', []);
    await sleep(400);
    const dropped = await page.evaluate(() => {
      const p = _tmState.points[_tmState.points.length - 1];
      return p ? { placed: true, lat: p.lat, lng: p.lng, pts: _tmState.points.length } : { placed: false };
    });
    expect(dropped.placed && dropped.pts === 2, 'hold-release must drop a 2nd point').toBe(true);
    const dropErrM = Math.hypot(
      (dropped.lat - expectedDrop.lat) * 111320,
      (dropped.lng - expectedDrop.lng) * 111320 * Math.cos(expectedDrop.lat * Math.PI / 180),
    );
    console.log(`[probe] DROP: errM=${dropErrM.toFixed(2)}m`);

    // Camera-hold is THE owner-reported bug: fail loudly with the measurement.
    expect(driftM, 'camera center must hold still during the precision drag (meters)').toBeLessThan(3);
    expect(distRatio, 'camera distance must hold during the precision drag').toBeGreaterThan(0.8);
    expect(distRatio).toBeLessThan(1.25);
    expect(dropErrM, 'dropped point must land under the crosshair (meters)').toBeLessThan(2);

    // Ease-back-out restores the pre-hold zoom level.
    await sleep(900);
    const released = await mapInfo();
    console.log(`[probe] RELEASE: dist=${released.dist.toFixed(0)}m (preHold=${preHold.dist.toFixed(0)}m)`);
    expect(released.dist, 'camera must ease back out after release').toBeGreaterThan(preHold.dist * 0.5);

    const relevant = errors.filter((t) => !/favicon|manifest|analytics|beacon/i.test(t));
    console.log(`[probe] console.errors during run: ${relevant.length}`, relevant.slice(0, 3));
  });
});
