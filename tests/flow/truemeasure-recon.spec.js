// TrueMeasure RECON (temporary diagnostic, companion to truemeasure-gesture):
// opens TrueMeasure on the REAL deployed app centered on a real address, frames
// the property at a FIXED region, and streams a JPEG of the map through the CI
// log as base64 so the operator can pick house-corner/lawn pixel coordinates
// for the scripted trace run. Chromium-only, no sign-in, writes no rows.
const { test } = require('./flow-test');
const { needsLiveCreds, signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fixed framing shared with truemeasure-trace.spec.js: same span + viewport
// (Pixel 7) means a pixel picked on this recon image maps to the same geo
// coordinate in the trace run.
const SPAN = 0.0008;

test.describe('TrueMeasure recon (real address framing)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');
  test.skip(({ browserName }) => browserName !== 'chromium', 'companion to the chromium CDP trace');

  test('frame 2015 SW Randolph and emit the scene', async ({ page }) => {
    test.setTimeout(150000);
    // Signed in so the login overlay doesn't cover the map (first recon run
    // screenshotted the sign-in wall, not the satellite scene).
    await signIn(page);
    await page.waitForFunction(() => typeof openTrueMeasure === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, null, { timeout: 30000 });

    await page.evaluate(() => openTrueMeasure({ id: 991300, name: 'Recon', addr: '2015 SW Randolph Ave, Topeka, KS 66604' }));
    await page.waitForFunction(
      () => typeof _tmState !== 'undefined' && _tmState && !!_tmState.map,
      null, { timeout: 30000 },
    );
    await sleep(2000);

    // Measure MapKit's REAL zoom floor on satellite imagery: request an
    // absurdly close camera and read back where it actually settles. The
    // owner keeps hitting "can't zoom in any further" even with
    // cameraZoomRange(1,3000), so something below our requested floor is
    // clamping — this tells us exactly where, which decides whether a
    // digital-zoom-past-the-floor layer is needed.
    const floor = await page.evaluate(async () => {
      const m = _tmState.map;
      const out = {};
      try { m.cameraZoomRange = new mapkit.CameraZoomRange(0.1, 3000); out.rangeMin = m.cameraZoomRange.minCameraDistance; } catch (e) { out.rangeErr = String(e).slice(0, 120); }
      m.cameraDistance = 1;
      await new Promise((r) => setTimeout(r, 1500));
      out.settledAt1 = m.cameraDistance;
      m.cameraDistance = 50;
      await new Promise((r) => setTimeout(r, 1500));
      out.settledAt50 = m.cameraDistance;
      return out;
    });
    console.log(`[recon] zoom floor probe: ${JSON.stringify(floor)}`);

    const framed = await page.evaluate((span) => {
      const c = _tmState.map.center;
      _tmState.map.region = new mapkit.CoordinateRegion(
        new mapkit.Coordinate(c.latitude, c.longitude),
        new mapkit.CoordinateSpan(span, span),
      );
      return { lat: c.latitude, lng: c.longitude };
    }, SPAN);
    console.log(`[recon] geocoded center lat=${framed.lat} lng=${framed.lng} span=${SPAN}`);
    await sleep(5000); // satellite tiles at the new zoom

    const box = await page.evaluate(() => {
      const r = document.getElementById('tm-map').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    console.log(`[recon] map box ${JSON.stringify(box)}`);
    const shot = await page.screenshot({
      type: 'jpeg', quality: 55,
      clip: box,
    });
    const b64 = shot.toString('base64');
    console.log(`[recon] scene jpeg bytes=${shot.length} b64len=${b64.length}`);
    console.log('[recon-b64-begin]');
    for (let i = 0; i < b64.length; i += 8000) console.log(b64.slice(i, i + 8000));
    console.log('[recon-b64-end]');
  });
});
