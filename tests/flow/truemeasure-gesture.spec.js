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
// Chromium-only: CDP touch injection is a Chromium capability. Signs in with
// the dedicated flow-test account — NOT because the probe touches account
// data (it never saves anything, zero rows left behind, §12.7 moot), but
// because the live app stacks its sign-in overlay above everything when
// unauthenticated, and the first probe rounds' CDP touches all landed on that
// login wall instead of the map.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('TrueMeasure gesture probe (real MapKit)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch injection is Chromium-only');

  test('tap placement, hold-zoom engagement, camera hold during drag, drop accuracy', async ({ page, context }) => {
    test.setTimeout(150000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
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
    const preDigi = await page.evaluate(() => (_tmState.digiZoom || 1));
    await touch('touchStart', [{ x: holdX, y: holdY }]);
    await sleep(1300); // HOLD_MS(420) + entrance zoom animation
    const zoomed = await mapInfo();
    const zoomedDigi = await page.evaluate(() => (_tmState.digiZoom || 1));
    const crossVisible = await page.evaluate(() => document.getElementById('tm-crosshair').style.display === 'block');
    // Effective magnification = camera zoom (clamped at MapKit's ~82.5m
    // satellite floor) x the digital scale layer that covers the remainder.
    const effective = (preHold.dist / zoomed.dist) * (zoomedDigi / preDigi);
    console.log(`[probe] HOLD: preDist=${preHold.dist.toFixed(0)}m zoomedDist=${zoomed.dist.toFixed(0)}m digi=${zoomedDigi.toFixed(2)} effective=${effective.toFixed(2)}x crosshair=${crossVisible}`);
    expect(crossVisible, 'crosshair must appear on hold').toBe(true);
    expect(effective, 'hold must magnify ~1/ZOOM_FACTOR overall (camera + digital)').toBeGreaterThan(2.5);

    // Round-trip the conversion helpers while the digital zoom is applied:
    // a visual point -> coordinate -> back must land on itself, or every
    // placement at digital zoom is silently off.
    const rt = await page.evaluate(([x, y]) => {
      const c = _tmPageToCoord(x, y);
      const p = _tmCoordToPagePt(c.latitude, c.longitude);
      return { dx: p.x - x, dy: p.y - y };
    }, [holdX + 30, holdY - 40]);
    const rtErr = Math.hypot(rt.dx, rt.dy);
    console.log(`[probe] ROUNDTRIP at digi=${zoomedDigi.toFixed(2)}: err=${rtErr.toFixed(1)}px`);
    expect(rtErr, 'point<->coordinate round-trip under digital zoom (px)').toBeLessThan(3);

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
      // The crosshair lives OUTSIDE the digital-zoom layer (visual space,
      // relative to the unscaled canvas frame) — mirror the app's own math:
      // crosshair screen position, then the digi-aware conversion helper.
      const r = document.getElementById('tm-canvas-wrap').getBoundingClientRect();
      const OFFSET_Y = 70;
      const relY = y - r.y;
      const crossY = r.y + Math.max(20, relY - OFFSET_Y);
      const c = _tmPageToCoord(x, crossY);
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

  // ── Adversarial: a real user tracing several corners FAST ────────────────
  // The single-gesture test above passed clean while the owner's live
  // multi-corner trace still put a point a whole property away. The
  // difference: this fires the NEXT gesture immediately after the previous
  // one's touchEnd, deliberately racing _tmDigiSet's 280ms ease-back-out
  // transition instead of waiting it out — exactly how someone tracing a
  // roofline actually taps. Every placed point's error against its true
  // target is measured individually so ONE bad point (the owner's actual
  // symptom, one long spike off an otherwise-correct outline) fails loudly
  // instead of averaging out.
  test('rapid successive corners: no gesture waits out the previous one\'s animation', async ({ page, context }) => {
    test.setTimeout(150000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991235, name: 'Stress Probe', addr: '' }));
    await page.waitForFunction(() => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map, null, { timeout: 20000 });
    await sleep(2000);

    const wrapBox = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: 1 })),
    });

    // A small hexagon of screen points, roughly tracing "a house" — every
    // corner placed as a QUICK TAP (no hold), fired with only a short,
    // FIXED gap after the previous point (not the 280ms+ a patient user
    // would leave), racing the digital-zoom reset from any PRIOR hold.
    const corners = [0.30, 0.40, 0.50, 0.45, 0.35, 0.30].map((fx, i) => ({
      x: Math.round(wrapBox.x + wrapBox.w * fx),
      y: Math.round(wrapBox.y + wrapBox.h * (0.35 + i * 0.06)),
    }));

    // Prime the race: one hold-drop first (this is what leaves digiZoom
    // mid-transition for the taps that immediately follow).
    const holdPt = { x: Math.round(wrapBox.x + wrapBox.w * 0.5), y: Math.round(wrapBox.y + wrapBox.h * 0.5) };
    await touch('touchStart', [holdPt]);
    await sleep(900); // engage the hold + entrance zoom
    await touch('touchEnd', []);
    // Deliberately NOT waiting out the 280ms ease-back-out — the very next
    // interaction starts 80ms later, squarely inside the old race window.
    await sleep(80);

    const results = [];
    for (const c of corners) {
      const target = await page.evaluate(([x, y]) => {
        const t = _tmPageToCoord(x, y);
        return { lat: t.latitude, lng: t.longitude };
      }, [c.x, c.y]);
      const before = await page.evaluate(() => _tmState.points.length);
      await touch('touchStart', [c]);
      await sleep(60); // well under HOLD_MS(420) — a genuine quick tap
      await touch('touchEnd', []);
      await sleep(70); // short, fixed — NOT waiting for any transition to settle
      const after = await page.evaluate(() => {
        const pts = _tmState.points;
        return { len: pts.length, last: pts[pts.length - 1] };
      });
      if (after.len !== before + 1 || !after.last) {
        results.push({ c, errM: null, placed: false });
        continue;
      }
      const errM = Math.hypot(
        (after.last.lat - target.lat) * 111320,
        (after.last.lng - target.lng) * 111320 * Math.cos(target.lat * Math.PI / 180),
      );
      results.push({ c, errM, placed: true });
    }

    console.log('[probe] RAPID-TRACE per-point results:', JSON.stringify(results.map((r) => ({ errM: r.errM && +r.errM.toFixed(2), placed: r.placed }))));
    const missing = results.filter((r) => !r.placed);
    const bad = results.filter((r) => r.placed && r.errM > 3); // 3m — one blown corner is the whole bug
    if (missing.length || bad.length) {
      console.log('[probe] FAILURES:', JSON.stringify({ missing: missing.length, bad: bad.map((r) => r.errM) }));
    }
    expect(missing.length, 'every rapid tap must place a point').toBe(0);
    expect(bad.length, 'every rapid tap must land within 3m of its true target, no isolated flung points').toBe(0);

    const relevant = errors.filter((t) => !/favicon|manifest|analytics|beacon/i.test(t));
    expect(relevant.length, 'zero console errors during the rapid trace: ' + relevant.slice(0, 3).join(' | ')).toBe(0);
  });

  // ── Adversarial: back-to-back holds must not compound the zoom level ────
  // "the zoom in moves very fast" (owner, 2026-08-20): if a hold starts
  // before the PREVIOUS hold's reset has visually finished, reading the
  // stale JS target instead of the true in-flight value would compound
  // (each hold zooming from an already-elevated base instead of a clean
  // one), racing toward the 8x cap unpredictably. Every hold in a fast
  // back-to-back sequence should land at essentially the SAME effective
  // magnification, not an escalating one.
  test('back-to-back holds land at the same magnification, never compounding', async ({ page, context }) => {
    test.setTimeout(150000);
    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991236, name: 'Compound Probe', addr: '' }));
    await page.waitForFunction(() => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map, null, { timeout: 20000 });
    await sleep(2000);

    const wrapBox = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: 1 })),
    });

    const pts = [0.35, 0.5, 0.65].map((fx) => ({
      x: Math.round(wrapBox.x + wrapBox.w * fx),
      y: Math.round(wrapBox.y + wrapBox.h * 0.5),
    }));
    const digiReadings = [];
    for (const p of pts) {
      await touch('touchStart', [p]);
      await sleep(900); // hold engages, entrance zoom completes
      const digi = await page.evaluate(() => _tmCurrentDigi());
      digiReadings.push(digi);
      await touch('touchEnd', []);
      await sleep(80); // fires the NEXT hold before the reset settles
    }
    console.log('[probe] COMPOUND CHECK digi per hold:', digiReadings.map((d) => d.toFixed(2)).join(', '));
    const max = Math.max(...digiReadings), min = Math.min(...digiReadings);
    expect(max / min, 'every back-to-back hold must reach ~the same zoom, not an escalating one').toBeLessThan(1.5);
    expect(max, 'must never blow past the digital zoom cap even under rapid repeats').toBeLessThanOrEqual(8.01);
  });
});
