// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW DEPLOY SMOKE — runs against the ACTUAL Cloudflare deployment after a build,
// to catch DEPLOY/ENVIRONMENT problems the off-Cloudflare flow gate cannot see.
//
// WHY a separate, tiny suite: the app has NO build step (static files), so the JS the
// flow gate ran from localhost is byte-for-byte what the preview deploys — the app
// LOGIC is already covered. What is NOT covered until the artifact is live on the real
// origin:
//   1. the deploy actually published + the LIVE version matches the commit (a stale
//      CDN / service-worker cache can serve the previous bundle — a silent false-pass),
//   2. the Cloudflare `/api` Pages Function (functions/api/[[path]].js) — localhost
//      substitutes tests/flow/local-server.js, so the real proxy worker is untested,
//   3. MapKit — its token is DOMAIN-LOCKED (CLAUDE.md §10.1) and init is hostname-gated,
//      so `_mapkitReady` is ALWAYS false off the deployed origin; maps are verified
//      NOWHERE but here.
//
// Deliberately small — dozens of requests, NOT the full realtime suite (which is what
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

test.describe('preview deploy smoke — the BUILT artifact on the real origin', () => {
  // 1. Published + boots + the LIVE version matches the deployed commit. A version
  //    mismatch means a stale cache / unpropagated deploy is serving the OLD bundle —
  //    the false-pass this whole check exists to prevent.
  test('boots clean and the live version matches the deployed commit', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // App shell rendered (the login screen) = the deployed JS actually ran, not a blank
    // page / 500 / wrong-root deploy.
    await expect(page.locator('#supa-email')).toBeVisible({ timeout: 20000 });

    const liveVersion = await page.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null));
    const jsonRes = await page.request.get('/version.json');
    const liveJson = jsonRes.ok() ? (await jsonRes.json()).version : null;

    expect(EXPECTED_VERSION, 'checkout has a version.json to compare against').toBeTruthy();
    expect(liveVersion, `live APP_VERSION (${liveVersion}) must equal the deployed commit (${EXPECTED_VERSION}) — a mismatch = stale cache / deploy not propagated`).toBe(EXPECTED_VERSION);
    expect(liveJson, `live /version.json (${liveJson}) must equal ${EXPECTED_VERSION}`).toBe(EXPECTED_VERSION);

    // A healthy deploy must not boot with app-origin console errors. Third-party/cross-
    // origin noise (MapKit CDN, Stripe, opaque "Script error.", favicon 404) is excluded.
    const real = errs.filter(e => !/Unhandled Promise Rejection|ResizeObserver|Script error\.?$|apple-mapkit|mapkit|stripe|favicon|status of 4\d\d/i.test(e));
    expect(real, `console errors on boot: ${real.join(' | ')}`).toHaveLength(0);
  });

  // 2. The Cloudflare `/api` Pages Function is live and reaches Supabase. This worker
  //    only exists on the deployed origin (localhost uses local-server.js), so it is
  //    UNTESTED until now. Both 200 and 401 prove the proxy reached Supabase auth.
  test('the /api Pages Function proxies to Supabase', async ({ page }) => {
    const res = await page.request.get('/api/auth/v1/health', { failOnStatusCode: false });
    expect([200, 401], `/api/auth/v1/health returned ${res.status()} — the /api proxy worker is down or not reaching Supabase`).toContain(res.status());
  });

  // 3. MapKit authorizes + initializes on the deployed hostname. The token is domain-
  //    locked (CLAUDE.md §10.1) and `_initMapKit` bails on any unauthorized origin, so
  //    `_mapkitReady` is ALWAYS false on localhost — this is the only place maps are
  //    proven to load with a VALID token for the live domain.
  test('MapKit authorizes and initializes on the deployed hostname', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
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
