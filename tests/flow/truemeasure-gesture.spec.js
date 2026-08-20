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
// GROUND TRUTH RULE (learned the hard way, 2026-08-20): placement assertions
// must NEVER route through MapKit's converters. Feeding a tap through
// convertPointOnPageToCoordinate and checking it back through
// convertCoordinateToPointOnPage is self-referential: a shared frame-origin
// error cancels out and reads 0.0px while the rendered shape sits a house
// away (the owner's displaced-shape bug hid behind exactly that check).
// Placement is now asserted against the app's OWN rendered SVG dot layer
// (#tm-draw-svg .tm-dot): the dot's getBoundingClientRect is literally what
// the user sees. Scale is asserted against a meters-ratio ground truth via
// _tmUnproject. MapKit's converter appears below only where its DISAGREEMENT
// with the own projection is itself the thing being measured.
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

// Benign console noise from third-party CDNs / CI network jitter — the same
// list page-crawler-flow.spec.js and realtime-glitch-free-flow.spec.js already
// use (§7.3: reuse the existing pattern rather than a narrower one-off list
// that flakes on the next noisy resource, e.g. a stray "net::ERR_FAILED" with
// no URL attached, seen chasing MapKit tiles under CI's network during this
// spec's heavy rapid-gesture load).
const BENIGN = [
  'favicon', 'net::ERR', 'ERR_CONNECTION', 'Failed to load resource', 'apple-mapkit',
  'cdn.apple-mapkit', 'js.stripe.com', 'cdn.jsdelivr', 'AggregateError', 'JSON Parse error',
  'Unhandled Promise Rejection', 'mapkit', '401', '403', 'manifest', 'analytics', 'beacon',
  'cloudflareinsights',
];
function realError(text) { return !BENIGN.some((b) => text.includes(b)); }

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

    // §7.1: the retired MapKit-converter pipeline must be GONE, not just
    // unused: these were global entry points (top-level function
    // declarations, so bare-identifier typeof is the right probe, same
    // script-scope rule as _tmState above).
    const legacy = await page.evaluate(() => ({
      pageToCoord: typeof _tmPageToCoord,
      coordToPagePt: typeof _tmCoordToPagePt,
      unscalePt: typeof _tmUnscalePt,
      scalePt: typeof _tmScalePt,
      updateAreaLabel: typeof _tmUpdateAreaLabel,
    }));
    for (const [name, t] of Object.entries(legacy)) {
      expect(t, `retired converter-path global ${name} must be deleted`).toBe('undefined');
    }

    // ── A: a quick tap places a point directly under the finger ──────────
    // Ground truth = the rendered SVG dot's own DOM position (what the user
    // sees), never MapKit's converter (see the header comment).
    const tapX = Math.round(wrapBox.x + wrapBox.w * 0.5);
    const tapY = Math.round(wrapBox.y + wrapBox.h * 0.4);
    await touch('touchStart', [{ x: tapX, y: tapY }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(600);
    const afterTap = await page.evaluate(() => {
      const p = _tmState.points[_tmState.points.length - 1];
      if (!p) return { placed: false };
      const dots = document.querySelectorAll('#tm-draw-svg .tm-dot');
      const dot = dots[dots.length - 1];
      if (!dot) return { placed: true, rendered: false };
      const r = dot.getBoundingClientRect();
      return { placed: true, rendered: true, pts: _tmState.points.length, screenX: r.x + r.width / 2, screenY: r.y + r.height / 2 };
    });
    expect(afterTap.placed, 'quick tap must place a point').toBe(true);
    expect(afterTap.rendered, 'the placed point must render as a dot in the own SVG layer').toBe(true);
    const tapErr = Math.hypot(afterTap.screenX - tapX, afterTap.screenY - tapY);
    console.log(`[probe] TAP: target=(${tapX},${tapY}) landed=(${afterTap.screenX.toFixed(1)},${afterTap.screenY.toFixed(1)}) errPx=${tapErr.toFixed(1)}`);
    expect(tapErr, 'the rendered dot must sit under the finger (px)').toBeLessThan(12);

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

    // Round-trip the OWN projection while the digital zoom is applied. This
    // is a consistency check by construction (_tmProject/_tmUnproject are
    // exact inverses), not ground truth: the ground truth for placement is
    // the SVG-dot checks and the meters-ratio scale checks in this file. It
    // still catches a broken inverse (sign error, digi applied on one side
    // only) instantly.
    const rt = await page.evaluate(([x, y]) => {
      const c = _tmUnproject(x, y);
      const p = _tmProject(c.latitude, c.longitude);
      const r = document.getElementById('tm-canvas-wrap').getBoundingClientRect();
      return { dx: r.left + p.x - x, dy: r.top + p.y - y };
    }, [holdX + 30, holdY - 40]);
    const rtErr = Math.hypot(rt.dx, rt.dy);
    console.log(`[probe] ROUNDTRIP at digi=${zoomedDigi.toFixed(2)}: err=${rtErr.toFixed(1)}px`);
    expect(rtErr, 'own-projection round-trip under digital zoom (px)').toBeLessThan(3);

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
      // crosshair screen position, then the digi-aware own projection.
      const r = document.getElementById('tm-canvas-wrap').getBoundingClientRect();
      const OFFSET_Y = 70;
      const relY = y - r.y;
      const crossY = r.y + Math.max(20, relY - OFFSET_Y);
      const c = _tmUnproject(x, crossY);
      return { lat: c.latitude, lng: c.longitude };
    }, [endX, endY]);
    await touch('touchEnd', []);
    await sleep(400);
    const dropped = await page.evaluate(() => {
      const p = _tmState.points[_tmState.points.length - 1];
      return p ? { placed: true, lat: p.lat, lng: p.lng, pts: _tmState.points.length } : { placed: false };
    });
    expect(dropped.placed && dropped.pts === 2, 'hold-release must drop a 2nd point').toBe(true);

    // §7.1, the render half: with a 2-point trace live, MapKit must be
    // carrying ZERO overlays and ZERO annotations: the trace (and its
    // labels) render only in the app's own SVG layer now.
    const mkLayers = await page.evaluate(() => ({
      overlays: (_tmState.map.overlays || []).length,
      annotations: (_tmState.map.annotations || []).length,
      svgDots: document.querySelectorAll('#tm-draw-svg .tm-dot').length,
    }));
    console.log(`[probe] RENDER LAYERS: ${JSON.stringify(mkLayers)}`);
    expect(mkLayers.overlays, 'trace must not render as MapKit overlays anymore').toBe(0);
    expect(mkLayers.annotations, 'trace labels must not render as MapKit annotations anymore').toBe(0);
    expect(mkLayers.svgDots, 'both placed points must render as SVG dots').toBe(2);
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

    // cloudflareinsights.com/cdn-cgi/rum: Cloudflare's own RUM beacon, CORS-
    // blocked on the uat.* preview domain, not something this codebase adds
    // or can fix — same known-noise exclusion preview-smoke.spec.js already
    // uses for it.
    const relevant = errors.filter(realError);
    console.log(`[probe] console.errors during run: ${relevant.length}`, relevant.slice(0, 3));
  });

  // ── Adversarial: ordinary finger jitter during a plain quick tap ─────────
  // Owner screenshot 2026-08-20: a two-point trace landed a whole house-width
  // off the actual tap locations, in a straight line across the roof — no
  // hold involved, plain quick taps. Every prior probe's "tap" sent
  // touchStart then touchEnd with ZERO touchmove events in between, which a
  // real finger can never do (a few pixels of hand tremor between touchdown
  // and liftoff is unavoidable). The app's own tap-vs-hold logic only
  // classifies a touch as a "drag" once it crosses THRESH (js/true-measure.js),
  // but MapKit's own native pan-gesture recognizer has no obligation to share
  // that threshold — a touchmove comfortably under OUR threshold could still
  // be enough to trip MapKit's, silently panning the camera under the finger
  // before the tap's coordinate conversion runs. This fires a real touchMove
  // (well under THRESH) between touchStart and touchEnd on every tap, the one
  // thing every prior probe never did.
  test('quick tap survives ordinary finger jitter (sub-threshold touchmove)', async ({ page, context }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991236, name: 'Jitter Probe', addr: '' }));
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

    // Two taps, roofline-corner-ish, each with a small jittery touchmove
    // (3-4px, well under THRESH) before lifting.
    const targets = [
      { x: Math.round(wrapBox.x + wrapBox.w * 0.35), y: Math.round(wrapBox.y + wrapBox.h * 0.35) },
      { x: Math.round(wrapBox.x + wrapBox.w * 0.55), y: Math.round(wrapBox.y + wrapBox.h * 0.55) },
    ];
    const results = [];
    for (const t of targets) {
      await touch('touchStart', [{ x: t.x, y: t.y }]);
      await touch('touchMove', [{ x: t.x + 3, y: t.y - 2 }]);
      await sleep(30);
      await touch('touchMove', [{ x: t.x - 2, y: t.y + 3 }]);
      await sleep(40);
      await touch('touchEnd', []);
      await sleep(400);
      // Ground truth = the rendered SVG dot, not MapKit's converter (see the
      // header comment: the converter check was blind to the real bug).
      const p = await page.evaluate(() => {
        const pt = _tmState.points[_tmState.points.length - 1];
        if (!pt) return null;
        const dots = document.querySelectorAll('#tm-draw-svg .tm-dot');
        const dot = dots[dots.length - 1];
        if (!dot) return null;
        const r = dot.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      results.push({ target: t, landed: p, errPx: p ? Math.hypot(p.x - t.x, p.y - t.y) : null });
    }

    console.log('[probe] JITTER-TAP results:', JSON.stringify(results.map((r) => ({ errPx: r.errPx && +r.errPx.toFixed(1) }))));
    for (const r of results) {
      expect(r.landed, 'a jittery tap must still place a point and render its dot').toBeTruthy();
      expect(r.errPx, 'a jittery tap\'s rendered dot must sit under the finger, not wherever MapKit panned to (px)').toBeLessThan(12);
    }

    const relevant = errors.filter(realError);
    expect(relevant.length, 'zero console errors during the jitter probe: ' + relevant.slice(0, 3).join(' | ')).toBe(0);
  });

  // ── Adversarial: ordinary tremor while PRESSING must not cancel the hold ─
  // Owner report 2026-08-20, live device, right after the jitter-tap fix
  // above: attempting to hold-and-drop a point panned the map instead of
  // zooming in. Root cause: THRESH decides hold-vs-pan ONCE, permanently,
  // for the whole touch — the instant raw drift crosses it, moved=true and
  // cancelTimer() fire, the hold timer can never fire again for that touch,
  // and it is handed to MapKit's pan for good. The old THRESH (8px) had no
  // allowance for the ordinary hand tremor of holding a thumb down for the
  // FULL 420ms HOLD_MS a genuine hold has to survive — a real thumb pressed
  // down and held for nearly half a second while aiming routinely drifts
  // more than that, even when the user's intent is "hold still," not "pan."
  // This fires small jitter (12-15px: over the OLD 8px threshold, under the
  // new one) during the press window and asserts the hold still engages.
  test('holding still (with ordinary tremor) still engages the zoom, does not pan', async ({ page, context }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991237, name: 'Tremor Probe', addr: '' }));
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

    const holdX = Math.round(wrapBox.x + wrapBox.w * 0.45);
    const holdY = Math.round(wrapBox.y + wrapBox.h * 0.45);
    const preDigi = await page.evaluate(() => (_tmState.digiZoom || 1));

    await touch('touchStart', [{ x: holdX, y: holdY }]);
    // Ordinary hand tremor spread across the press window: small back-and-
    // forth drift, never exceeding ~15px from the down point, well past the
    // old 8px threshold but comfortably under the new one.
    const jitter = [[5, -4], [-6, 3], [4, 6], [-3, -5], [6, -2], [-4, 4]];
    for (const [dx, dy] of jitter) {
      await touch('touchMove', [{ x: holdX + dx, y: holdY + dy }]);
      await sleep(55); // ~330ms of tremor total, still under HOLD_MS(420)
    }
    await sleep(700); // let the hold timer fire and the entrance zoom settle
    const crossVisible = await page.evaluate(() => document.getElementById('tm-crosshair').style.display === 'block');
    const digi = await page.evaluate(() => (_tmState.digiZoom || 1));
    console.log(`[probe] TREMOR-HOLD: crosshair=${crossVisible} preDigi=${preDigi} digi=${digi}`);
    expect(crossVisible, 'ordinary tremor while pressing must not cancel the hold').toBe(true);
    expect(digi, 'the hold must still zoom in despite tremor during the press').toBeGreaterThan(preDigi);

    // Release cleanly so this test doesn't leave the gesture engaged.
    await touch('touchEnd', []);
    await sleep(400);

    const relevant = errors.filter(realError);
    expect(relevant.length, 'zero console errors during the tremor-hold probe: ' + relevant.slice(0, 3).join(' | ')).toBe(0);
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
      const before = await page.evaluate(() => _tmState.points.length);
      await touch('touchStart', [c]);
      // Sample the target AFTER touchStart, not before: the app freezes the
      // digital scale the instant its own pointerdown fires (in response to
      // this exact touchStart), so this is the same instant the app's math
      // uses — sampling earlier would measure a still-moving scale the app
      // was never going to use either.
      const target = await page.evaluate(([x, y]) => {
        const t = _tmUnproject(x, y);
        return { lat: t.latitude, lng: t.longitude };
      }, [c.x, c.y]);
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

    // cloudflareinsights.com/cdn-cgi/rum: Cloudflare's own RUM beacon, CORS-
    // blocked on the uat.* preview domain, not something this codebase adds
    // or can fix — same known-noise exclusion preview-smoke.spec.js already
    // uses for it.
    const relevant = errors.filter(realError);
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

  // ── Adversarial: pinch-zoom, then plain taps at the resulting scale ──────
  // Owner screenshot 2026-08-20 (2015 SW Randolph Ave): traced a "roof" that
  // came out as a small 547 sq ft sliver nowhere near the visible house, with
  // the on-screen debug panel showing digi=2.52 (not the hold gesture's fixed
  // 1/ZOOM_FACTOR=3.33 ratio — this trace never held, it PINCHED) and every
  // individual tap's own round-trip error at 0.0px. That round-trip check is
  // structurally blind to a scale/origin bug: it feeds a page point through
  // _tmPageToCoord then straight back through _tmCoordToPagePt, so a shared
  // wrong assumption in BOTH directions cancels out and still reads 0. Never
  // exercised until now: nothing in this file drove a real two-finger pinch
  // (js/true-measure.js's OWN pinch path — the `pinchOwn` branch in
  // wrap.addEventListener('touchstart'/'touchmove',...) — was previously
  // untested end to end). This proves scale correctness against an
  // INDEPENDENT ground truth instead: the same fixed PIXEL gap between two
  // points must imply proportionally LESS real-world distance after zooming
  // in, by very close to the actual achieved zoom ratio. A scale-compensation
  // bug that a round-trip can't see would show up here as the wrong ratio.
  test('pinch-zoom then tap: same pixel gap implies proportionally less real-world distance', async ({ page, context }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991237, name: 'Pinch Probe', addr: '' }));
    await page.waitForFunction(() => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map, null, { timeout: 20000 });
    await sleep(2500);

    const wrapBox = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id || 1 })),
    });
    const metersBetween = (a, b) => Math.hypot(
      (a.lat - b.lat) * 111320,
      (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180),
    );

    const cx = wrapBox.x + wrapBox.w * 0.5, cy = wrapBox.y + wrapBox.h * 0.5;
    const GAP = 100; // fixed screen-pixel gap, measured before AND after the pinch
    // Through the OWN projection: this is the scale ground truth for the
    // same math every real tap now goes through.
    const probePts = () => page.evaluate(([x0, x1, y]) => {
      const a = _tmUnproject(x0, y), b = _tmUnproject(x1, y);
      return { a: { lat: a.latitude, lng: a.longitude }, b: { lat: b.latitude, lng: b.longitude } };
    }, [cx - GAP / 2, cx + GAP / 2, cy]);

    const before = await probePts();
    const D1 = metersBetween(before.a, before.b);
    const camBefore = await page.evaluate(() => _tmState.map.cameraDistance);
    const digiBefore = await page.evaluate(() => _tmCurrentDigi());

    // A real two-finger pinch centered on the map: start 80px apart, spread
    // out to 400px over several steps (a deliberate, unhurried zoom-in, not a
    // flick), then lift both fingers.
    const steps = 10, d0 = 80, d1 = 400;
    await touch('touchStart', [
      { id: 1, x: cx - d0 / 2, y: cy },
      { id: 2, x: cx + d0 / 2, y: cy },
    ]);
    for (let i = 1; i <= steps; i++) {
      const d = d0 + (d1 - d0) * (i / steps);
      await touch('touchMove', [
        { id: 1, x: cx - d / 2, y: cy },
        { id: 2, x: cx + d / 2, y: cy },
      ]);
      await sleep(60);
    }
    await touch('touchEnd', []);
    await sleep(500);

    const camAfter = await page.evaluate(() => _tmState.map.cameraDistance);
    const digiAfter = await page.evaluate(() => _tmCurrentDigi());
    const effective = (camBefore / camAfter) * (digiAfter / digiBefore);

    const after = await probePts();
    const D2 = metersBetween(after.a, after.b);
    const achievedRatio = D1 / D2;
    console.log(`[probe] PINCH: cam ${camBefore.toFixed(0)}m->${camAfter.toFixed(0)}m digi ${digiBefore.toFixed(2)}->${digiAfter.toFixed(2)} effective=${effective.toFixed(2)}x D1=${D1.toFixed(2)}m D2=${D2.toFixed(2)}m achievedRatio=${achievedRatio.toFixed(2)}x`);

    expect(effective, 'pinch must actually zoom in').toBeGreaterThan(1.3);
    // Generous tolerance (30%): this is a ground-truth cross-check, not a
    // precision measurement — the point is catching a GROSS scale mismatch
    // (2x off, or inverted, or flat), not sub-percent drift.
    expect(achievedRatio, 'the same pixel gap must now imply ~1/effective the real-world distance').toBeGreaterThan(effective * 0.7);
    expect(achievedRatio).toBeLessThan(effective * 1.3);

    // Now place a real tap at the post-pinch scale and confirm it still lands
    // under the finger — this is exactly what the owner did next (tap to
    // trace corners after pinching in).
    const tapX = Math.round(cx), tapY = Math.round(cy + 60);
    await touch('touchStart', [{ x: tapX, y: tapY }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(400);
    const tap = await page.evaluate(() => {
      const p = _tmState.points[_tmState.points.length - 1];
      if (!p) return { placed: false };
      const dots = document.querySelectorAll('#tm-draw-svg .tm-dot');
      const dot = dots[dots.length - 1];
      if (!dot) return { placed: true, rendered: false };
      const r = dot.getBoundingClientRect();
      return { placed: true, rendered: true, screenX: r.x + r.width / 2, screenY: r.y + r.height / 2 };
    });
    expect(tap.placed, 'a tap after pinching must still place a point').toBe(true);
    expect(tap.rendered, 'the post-pinch point must render as an SVG dot').toBe(true);
    const tapErrPx = Math.hypot(tap.screenX - tapX, tap.screenY - tapY);
    console.log(`[probe] POST-PINCH TAP: target=(${tapX},${tapY}) errPx=${tapErrPx.toFixed(1)}`);
    expect(tapErrPx, 'the post-pinch dot must sit under the finger (px)').toBeLessThan(12);

    const relevant = errors.filter(realError);
    expect(relevant.length, 'zero console errors during pinch+tap: ' + relevant.slice(0, 3).join(' | ')).toBe(0);
  });

  // ── Regression: the owner's exact displaced-shape scenario ───────────────
  // Live repro 2026-08-20: pinch-zoomed to digi=2.52, tapped his roof's
  // corners, and the traced box came out roughly the right SIZE but across
  // the street, while the debug panel's converter round-trip read 0.0px on
  // every tap. This drives that same scenario end to end and asserts against
  // the two ground truths the converter check was blind to: (a) every
  // rendered SVG dot sits under its tap, and (b) the STORED quadrilateral's
  // centroid, re-projected through _tmProject, sits at the taps' own pixel
  // centroid (right size AND right place). The camera is pinned to MapKit's
  // satellite floor first so the two-finger pinch is guaranteed to engage the
  // app's own digital pinch path (pinchOwn), the exact path that produced
  // digi=2.52 on the owner's phone.
  test('digi~2.5 displacement: dots land under the taps and the shape sits where the fingers went', async ({ page, context }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => openTrueMeasure({ id: 991238, name: 'Displacement Probe', addr: '' }));
    await page.waitForFunction(() => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map, null, { timeout: 20000 });
    await sleep(2500);

    const wrapBox = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id || 1 })),
    });
    const metersBetween = (a, b) => Math.hypot(
      (a.lat - b.lat) * 111320,
      (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180),
    );

    // Pin the camera at MapKit's satellite floor (the setter clamps 50m up
    // to ~82.5m) so the pinch below is the app's OWN digital pinch, not
    // MapKit's camera pinch, matching the owner's phone, which showed
    // cam=75m (its floor) + digi=2.52.
    await page.evaluate(() => { _tmState.map.cameraDistance = 50; });
    await sleep(800);

    // Pre-pinch scale sample for the meters-ratio ground truth.
    const cx = wrapBox.x + wrapBox.w * 0.5, cy = wrapBox.y + wrapBox.h * 0.5;
    const GAP = 100;
    const probePts = () => page.evaluate(([x0, x1, y]) => {
      const a = _tmUnproject(x0, y), b = _tmUnproject(x1, y);
      return { a: { lat: a.latitude, lng: a.longitude }, b: { lat: b.latitude, lng: b.longitude } };
    }, [cx - GAP / 2, cx + GAP / 2, cy]);
    const before = await probePts();
    const D1 = metersBetween(before.a, before.b);

    // Real two-finger pinch, 100px -> 250px: the digital pinch tracks the
    // finger-distance ratio, landing digi≈2.5 (the owner's 2.52).
    const steps = 8, d0 = 100, d1 = 250;
    await touch('touchStart', [
      { id: 1, x: cx - d0 / 2, y: cy },
      { id: 2, x: cx + d0 / 2, y: cy },
    ]);
    for (let i = 1; i <= steps; i++) {
      const d = d0 + (d1 - d0) * (i / steps);
      await touch('touchMove', [
        { id: 1, x: cx - d / 2, y: cy },
        { id: 2, x: cx + d / 2, y: cy },
      ]);
      await sleep(60);
    }
    await touch('touchEnd', []);
    await sleep(400);
    const digi = await page.evaluate(() => _tmCurrentDigi());
    const after = await probePts();
    const D2 = metersBetween(after.a, after.b);
    const achievedRatio = D1 / D2;
    console.log(`[probe] DISPLACEMENT setup: digi=${digi.toFixed(2)} D1=${D1.toFixed(2)}m D2=${D2.toFixed(2)}m ratio=${achievedRatio.toFixed(2)}x`);
    expect(digi, 'the pinch must land in the owner-reported digital-zoom regime').toBeGreaterThan(2);
    // Camera is pinned at the floor, so the meters-ratio must track digi.
    expect(achievedRatio).toBeGreaterThan(digi * 0.7);
    expect(achievedRatio).toBeLessThan(digi * 1.3);

    // Tap 4 corners of a ~60px square, deliberately OFF-CENTER: an origin
    // error is invisible at the scale center and maximal away from it.
    const bx = Math.round(wrapBox.x + wrapBox.w * 0.38);
    const by = Math.round(wrapBox.y + wrapBox.h * 0.36);
    const sq = [
      { x: bx, y: by },
      { x: bx + 60, y: by },
      { x: bx + 60, y: by + 60 },
      { x: bx, y: by + 60 },
    ];
    const dotErrs = [];
    for (const t of sq) {
      await touch('touchStart', [{ x: t.x, y: t.y }]);
      await sleep(70);
      await touch('touchEnd', []);
      await sleep(350);
      const dot = await page.evaluate(() => {
        const dots = document.querySelectorAll('#tm-draw-svg .tm-dot');
        const d = dots[dots.length - 1];
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      dotErrs.push(dot ? Math.hypot(dot.x - t.x, dot.y - t.y) : null);
    }
    console.log('[probe] DISPLACEMENT dot errors (px):', JSON.stringify(dotErrs.map((e) => e === null ? null : +e.toFixed(1))));
    for (const e of dotErrs) {
      expect(e, 'every tap must place a point that renders as an SVG dot').not.toBeNull();
      expect(e, 'every rendered dot must sit under its tap (px)').toBeLessThan(12);
    }

    // (b) Right PLACE, not merely right size: the stored quadrilateral's
    // centroid, re-projected through _tmProject, must sit at the taps' own
    // pixel centroid.
    const centroid = await page.evaluate(() => {
      const pts = _tmState.points.slice(-4);
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      const pr = _tmProject(lat, lng);
      const r = document.getElementById('tm-canvas-wrap').getBoundingClientRect();
      return { x: r.left + pr.x, y: r.top + pr.y, n: _tmState.points.length };
    });
    const px = sq.reduce((s, p) => s + p.x, 0) / 4, py = sq.reduce((s, p) => s + p.y, 0) / 4;
    const centErr = Math.hypot(centroid.x - px, centroid.y - py);
    console.log(`[probe] DISPLACEMENT centroid: expected=(${px},${py}) got=(${centroid.x.toFixed(1)},${centroid.y.toFixed(1)}) errPx=${centErr.toFixed(1)}`);
    expect(centroid.n, 'all four corners must have placed').toBeGreaterThanOrEqual(4);
    expect(centErr, 'the traced shape must sit AT the taps, not displaced (px)').toBeLessThan(12);

    // The trace never touches MapKit's render pipeline anymore (§7.1).
    const mk = await page.evaluate(() => ({
      overlays: (_tmState.map.overlays || []).length,
      annotations: (_tmState.map.annotations || []).length,
    }));
    expect(mk.overlays, 'zero MapKit overlays: the trace lives in the own SVG layer').toBe(0);
    expect(mk.annotations, 'zero MapKit annotations: labels live in the own layer too').toBe(0);

    const relevant = errors.filter(realError);
    expect(relevant.length, 'zero console errors during the displacement probe: ' + relevant.slice(0, 3).join(' | ')).toBe(0);
  });
});
