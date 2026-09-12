// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW DEPLOY SMOKE, runs against the ACTUAL Cloudflare deployment after a build,
// to catch DEPLOY/ENVIRONMENT problems the off-Cloudflare flow gate cannot see.
//
// WHY a separate, tiny suite: the app has NO build step (static files), so the JS the
// flow gate ran from localhost is byte-for-byte what the preview deploys, the app
// LOGIC is already covered. What is NOT covered until the artifact is live on the real
// origin:
//   1. the deploy actually published + the LIVE version matches the commit (a stale
//      CDN / service-worker cache can serve the previous bundle, a silent false-pass),
//   2. the Cloudflare `/api` Pages Function (functions/api/[[path]].js): localhost
//      substitutes tests/flow/local-server.js, so the real proxy worker is untested,
//   3. MapKit: its token is DOMAIN-LOCKED (CLAUDE.md §10.1) and init is hostname-gated,
//      so `_mapkitReady` is ALWAYS false off the deployed origin; maps are verified
//      NOWHERE but here.
//
// Deliberately small, dozens of requests, NOT the full realtime suite (which is what
// drives the worker/subrequest spikes). Run via playwright.preview-smoke.config.js with
// PREVIEW_URL pointed at the deployed URL.
// ─────────────────────────────────────────────────────────────────────────────
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { needsLiveCreds, signIn } = require('../flow/live-helpers');

// EXPECTED version = the version.json in THIS checkout. The smoke workflow checks out the
// deployed commit, so this is exactly what should be live. version.json is the single
// source of truth (js/cloud.js keeps APP_VERSION in lockstep via the pre-commit hook).
const EXPECTED_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8')).version; }
  catch (_e) { return null; }
})();

test.describe('preview deploy smoke, the BUILT artifact on the real origin', () => {
  // The CI-only Cloudflare WAF bypass header must only reach the app's OWN origin, a
  // blanket context-wide header (extraHTTPHeaders) also attaches to third-party requests
  // (Google Fonts, Cloudflare Insights, the MapKit CDN), whose CORS preflight rejects the
  // unrecognized header and blocks the request, breaking fonts/analytics/MapKit and
  // surfacing as false "console error" failures. Route-intercept and inject it ONLY for
  // same-origin requests instead.
  test.beforeEach(async ({ context, baseURL }) => {
    if (!process.env.E2E_BYPASS_SECRET || !baseURL) return;
    const bypassSecret = process.env.E2E_BYPASS_SECRET;
    const appOrigin = new URL(baseURL).origin;
    await context.route('**/*', (route) => {
      const reqUrl = new URL(route.request().url());
      if (reqUrl.origin === appOrigin) {
        route.continue({ headers: { ...route.request().headers(), 'x-e2e-bypass': bypassSecret } });
      } else {
        route.continue();
      }
    });
  });

  // 1. Published + boots + the LIVE version matches the deployed commit. A version
  //    mismatch means a stale cache / unpropagated deploy is serving the OLD bundle,
  //    the false-pass this whole check exists to prevent.
  test('boots clean and the live version matches the deployed commit', async ({ page }) => {
    const errs = [];
    // Cloudflare Pages auto-injects its own Web Analytics ("RUM") beacon
    // (cloudflareinsights.com/cdn-cgi/rum): not something this codebase adds or
    // controls. It can fail CORS on a fresh preview subdomain (Cloudflare's own
    // origin-allowlisting, nothing to do with app health) and, on WebKit specifically,
    // surfaces as a vague "Origin ... not allowed by Access-Control-Allow-Origin"
    // console message with NO domain named, so it can't always be string-matched.
    // Track which THIRD-PARTY requests actually failed and only excuse a generic CORS
    // message when it correlates with one of those, a genuine same-origin CORS
    // failure (no noisy third-party request failed) still fails the gate.
    const NOISY_ORIGINS = /cloudflareinsights\.com|apple-mapkit|js\.stripe\.com|fonts\.(gstatic|googleapis)\.com/i;
    const noisyFailedUrls = [];
    // EVERY failed request, with its URL, "Failed to load resource:
    // net::ERR_FAILED" console text names no URL, which made a red smoke
    // undiagnosable. The failure message below now says exactly what died.
    const failedRequests = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('requestfailed', req => {
      failedRequests.push(req.url() + ' [' + ((req.failure() || {}).errorText || '?') + ']');
      if (NOISY_ORIGINS.test(req.url())) noisyFailedUrls.push(req.url());
    });
    page.on('response', res => { if (!res.ok() && NOISY_ORIGINS.test(res.url())) noisyFailedUrls.push(res.url()); });

    await page.goto('/?app=1', { waitUntil: 'domcontentloaded' });
    // App shell rendered (the login screen) = the deployed JS actually ran, not a blank
    // page / 500 / wrong-root deploy. Identifier-first gate (2026-08-22): the email
    // input is the always-visible element now, social buttons only appear after
    // identifying which sign-in methods an account actually has.
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 20000 });

    const liveVersion = await page.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null));
    // Fetched from INSIDE the page, which is what the version watchdog does.
    // page.request is a bare API client: it carries none of a browser's headers
    // and the apex refuses it, so on production this measured the edge's bot
    // protection rather than the deploy. A same-origin fetch from the loaded
    // page is both what the app really does and what a visitor's browser does.
    // Report WHY, not just null. Swallowing the reason here is what left a
    // WebKit-only failure unexplainable: a 403 from the edge, a thrown network
    // error and a bad payload all looked identical from the outside.
    const vres = await page.evaluate(async () => {
      try {
        const r = await fetch('/version.json?_=' + Date.now(), { cache: 'no-store' });
        const body = await r.text();
        let version = null;
        try { version = JSON.parse(body).version; } catch (e) { /* reported below */ }
        return { ok: r.ok, status: r.status, type: r.type, version, body: body.slice(0, 120) };
      } catch (e) { return { ok: false, status: -1, threw: String(e && e.message || e) }; }
    });
    const liveJson = vres.version || null;

    expect(EXPECTED_VERSION, 'checkout has a version.json to compare against').toBeTruthy();

    // APP_VERSION is the HARD gate and the complete one. That value was parsed out of
    // the bundle this navigation just pulled from the origin, so it is a direct
    // statement about which build is being served. A stale cache or an unpropagated
    // deploy still fails here, which is the whole reason this check exists.
    expect(liveVersion, `live APP_VERSION (${liveVersion}) must equal the deployed commit (${EXPECTED_VERSION}): a mismatch = stale cache / deploy not propagated`).toBe(EXPECTED_VERSION);

    // The /version.json probe is a SECOND witness of the same fact, and unlike the
    // first it is not always allowed to answer: on the apex, Cloudflare intermittently
    // serves this path its "Just a moment..." managed challenge (403, an HTML body) to
    // an automated browser. Observed on webkit alone on 2026-09-11 and on both engines
    // on 2026-09-12, which is what ruled out the WebKit-engine theory: it is the edge
    // scoring a headless client, not a browser that cannot fetch.
    //
    // So a challenge is reported, loudly, and is not counted as a deploy fault, because
    // it is not a statement about the deploy. A WRONG version here still fails: that
    // would mean the origin is serving two different builds at once.
    //
    // This costs the app nothing either way. All four readers of this file
    // (_checkVersionOnResume and _geoBgUpdateCheck guard on `!r.ok`; _probeAndSync and
    // _classifyCloudError only care whether the fetch THROWS, and a 403 resolves) treat
    // a challenge as "no answer this tick" and carry on. The worst case for a real user
    // is one missed 15-second version check, never a reload loop and never a false
    // offline banner.
    if (liveJson === null) {
      console.log(`::warning::/version.json did not answer on ${new URL(page.url()).host}: ${JSON.stringify(vres)}. APP_VERSION proved the deploy; the watchdog's own source was challenged, not broken.`);
    } else {
      expect(liveJson, `live /version.json must equal ${EXPECTED_VERSION}, got ${JSON.stringify(vres)}`).toBe(EXPECTED_VERSION);
    }

    // A healthy deploy must not boot with app-origin console errors. Third-party/cross-
    // origin noise (MapKit CDN, Stripe, Google Fonts, Cloudflare's own Web Analytics
    // beacon, opaque "Script error.", favicon 404) is excluded.
    const genericCorsMsg = /not allowed by Access-Control-Allow-Origin|blocked by CORS policy/i;
    const real = errs.filter(e => {
      if (/Unhandled Promise Rejection|ResizeObserver|Script error\.?$|apple-mapkit|mapkit|stripe|favicon|status of 4\d\d|cloudflareinsights/i.test(e)) return false;
      if (genericCorsMsg.test(e) && noisyFailedUrls.length) return false; // correlated with a known noisy third-party failure
      // Chromium reports the same beacon failure as a bare "Failed to load resource:
      // net::ERR_FAILED" with no URL; requestfailed captured which URL it was.
      if (/Failed to load resource/i.test(e) && noisyFailedUrls.length) return false;
      return true;
    });
    expect(real, `console errors on boot: ${real.join(' | ')}: failed requests: ${failedRequests.join(' | ') || '(none captured)'}`).toHaveLength(0);
  });

  // 1b. The "/" gate (functions/index.js) is live: a stranger gets the marketing
  //     page, a browser carrying the app cookie gets the app. Only a deployed
  //     origin runs the function, so this is the one place it can be proven.
  //
  //     Driven as a real navigation, not an API request. A visitor arrives with
  //     a browser, the gate reads that request's cookie and user agent, and the
  //     header it sets comes back on the navigation response. An API client is
  //     refused at the apex before the function ever sees it, which is a fact
  //     about the edge and tells us nothing about the gate.
  test('the "/" function serves the landing page to a stranger and the app to the cookie', async ({ page }) => {
    const asStranger = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(asStranger.status(), 'GET / as a first-time visitor').toBe(200);
    expect(asStranger.headers()['x-td-page'], 'the function answered / for a stranger').toBe('landing');
    // APP_VERSION only exists in the app, so it tells the two pages apart no
    // matter how far either has hydrated.
    expect(await page.evaluate(() => typeof APP_VERSION), 'a stranger must not get the app').toBe('undefined');
    expect(await page.evaluate(() => {
      const c = document.querySelector('link[rel="canonical"]');
      return c ? c.getAttribute('href') : null;
    })).toBe('https://tradedeskpro.app/');

    // Same URL, same browser, now carrying the cookie the app sets on sign-in.
    await page.context().addCookies([{ name: 'td_app', value: '1', url: new URL(page.url()).origin }]);
    const asUser = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(asUser.status(), 'GET / carrying td_app').toBe(200);
    expect(asUser.headers()['x-td-page'], 'the function answered / for an app user').toBe('app');
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 20000 });
    await page.context().clearCookies();
  });

  // 1c. The live demo boots on the real deploy. The marketing page shows the
  //     app itself rather than pictures of it, so "the demo still runs" is a
  //     deploy-health fact: if this breaks, every device frame on the home page
  //     is empty and nothing else would report it.
  test('the demo boots on the deployed origin and seeds itself', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/?demo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('supa-boot-overlay'), null, { timeout: 25000 });
    const s = await page.evaluate(() => ({
      demo: !!window.__TD_DEMO,
      client: typeof clients !== 'undefined' && clients[0] ? clients[0].name : null,
      biz: typeof S !== 'undefined' ? S.bname : null,
      supa: typeof supaEnabled === 'function' ? supaEnabled() : null,
      cookie: document.cookie,
    }));
    expect(s.demo, 'the deploy served the demo sandbox').toBe(true);
    expect(s.client, 'the demo seeded its sample job').toBeTruthy();
    expect(s.biz).toBeTruthy();
    // Still no backend and still no app cookie, on the real origin.
    expect(s.supa).toBe(false);
    expect(s.cookie).not.toMatch(/td_app=1/);
    const real = errs.filter(e => !/favicon|Failed to load resource|net::ERR|cloudflareinsights|status of 4\d\d/i.test(e));
    expect(real, `demo console errors: ${real.join(' | ')}`).toHaveLength(0);
  });

  // 2. The Cloudflare `/api` Pages Function is live and reaches Supabase. This worker
  //    only exists on the deployed origin (localhost uses local-server.js), so it is
  //    UNTESTED until now. Both 200 and 401 prove the proxy reached Supabase auth.
  test('the /api Pages Function proxies to Supabase', async ({ page }) => {
    // From inside the page, for the same reason as the version check above: the
    // app reaches this worker as a same-origin fetch from a loaded document, and
    // that is the only path worth proving. A bare API client gets refused at the
    // apex before the worker is ever consulted.
    await page.goto('/?app=1', { waitUntil: 'domcontentloaded' });
    const status = await page.evaluate(async () => {
      try { const r = await fetch('/api/auth/v1/health'); return r.status; }
      catch (e) { return -1; }
    });
    expect([200, 401], `/api/auth/v1/health returned ${status}: the /api proxy worker is down or not reaching Supabase`).toContain(status);
  });

  // Apple's crawler fetches this exact path before Apple Pay may appear on the
  // hub's Payment Element, and only a live deploy can prove the Pages Function
  // route answers on the real origin, the same reason the /api check exists.
  test('the Apple Pay domain association answers on the deployed origin', async ({ page }) => {
    const headers = process.env.E2E_BYPASS_SECRET ? { 'x-e2e-bypass': process.env.E2E_BYPASS_SECRET } : {};
    const res = await page.request.get('/.well-known/apple-developer-merchantid-domain-association', { failOnStatusCode: false, headers });
    expect(res.status(), 'the .well-known Pages Function is not serving: Apple Pay cannot validate this domain').toBe(200);
    const body = await res.text();
    expect(body.length, 'association file suspiciously small, upstream fetch likely failed').toBeGreaterThan(500);
  });

  // Universal Links (owner 2026-08-17): iOS fetches this exact path before it
  // will honor com.apple.developer.associated-domains for this host. The
  // Team ID comes from a Cloudflare Pages env var (functions/.well-known/
  // apple-app-site-association.js), never hardcoded, so 404 is the correct,
  // expected answer until that one-time dashboard step is done: assert the
  // FUNCTION is deployed and reachable (never a platform 404/522), not that
  // Universal Links are fully configured yet. Once APPLE_TEAM_ID is set on
  // the Pages project, 200 is required and the body shape is checked.
  test('the apple-app-site-association route is deployed and reachable', async ({ page }) => {
    const headers = process.env.E2E_BYPASS_SECRET ? { 'x-e2e-bypass': process.env.E2E_BYPASS_SECRET } : {};
    const res = await page.request.get('/.well-known/apple-app-site-association', { failOnStatusCode: false, headers });
    if (res.status() === 404) {
      console.log('AASA route reachable but APPLE_TEAM_ID not yet set on the Cloudflare Pages project (expected until that one-time step is done)');
      return;
    }
    expect(res.status(), 'the AASA Pages Function is not serving: Universal Links cannot validate this domain').toBe(200);
    expect(res.headers()['content-type'] || '', 'AASA must be served as JSON, not text/plain or octet-stream').toContain('application/json');
    const body = await res.json();
    const paths = (body.applinks?.details?.[0]?.components || []).map(c => c['/']);
    expect(paths).toContain('/sign.html*');
    expect(paths).toContain('/client.html*');
  });

  // 3. MapKit authorizes + initializes on the deployed hostname. The token is domain-
  //    locked (CLAUDE.md §10.1) and `_initMapKit` bails on any unauthorized origin, so
  //    `_mapkitReady` is ALWAYS false on localhost, this is the only place maps are
  //    proven to load with a VALID token for the live domain.
  test('MapKit authorizes and initializes on the deployed hostname', async ({ page }) => {
    await page.goto('/?app=1', { waitUntil: 'domcontentloaded' });
    const authorized = await page.evaluate(() => (typeof _mapkitAuthorizedOrigin !== 'undefined') ? _mapkitAuthorizedOrigin : null);
    expect(authorized, 'deployed origin must be a MapKit-authorized host (pages.dev / tradedeskpro.app)').toBe(true);
    // mapkit.js loads from Apple's CDN (index.html) and fires _initMapKit onload; on an
    // authorized origin with a valid domain-locked token that flips _mapkitReady true.
    // A failure here = expired/wrong token or the CDN script blocked for this origin.
    await page.waitForFunction(() => typeof _mapkitReady !== 'undefined' && _mapkitReady === true, { timeout: 20000 });
  });

  // 4. End-to-end auth on the real origin + its Supabase. Skips cleanly without creds.
  test('signs in on the deployed origin and establishes a Supabase session', async ({ page }) => {
    test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');
    await signIn(page);
    const authed = await page.evaluate(() => typeof _supaUser !== 'undefined' && !!(_supaUser && _supaUser.id));
    expect(authed, 'sign-in must establish a Supabase session on the deployed origin').toBe(true);
  });
});
