// @ts-check
// ── One login, whichever road the requests take ──────────────────────────────
// Owner report 2026-09-27: Jack, on a slow Wi-Fi, force-closed the app over and
// over and only ever got the login screen. The server logs show every request
// from that Wi-Fi answered 200, so the network was fine. The phone was not:
// when the 0.9s startup probe to Supabase timed out, the app switched to the
// /api fallback, and supabase-js names its saved session after the URL's host
// (sb-<first label>-auth-token). The direct client had saved Jack's login under
// sb-mwtsmctajhrrybblgorf-auth-token; the fallback looked under sb-uat-auth-token,
// found nothing, and showed the login screen for a session that was still good.
//
// The rules these tests defend:
//   - The app pins the session key to the direct host, so both roads read the
//     same login (proven against the REAL supabase-js, not the test mock).
//   - A login saved under a fallback name before this fix is moved onto the
//     pinned key once, so nobody gets signed out by the fix itself.
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const DIRECT_KEY = 'sb-mwtsmctajhrrybblgorf-auth-token';
const SDK = path.join(__dirname, '..', 'js', 'vendor', 'supabase-js-2.112.3.min.js');

test.describe('Supabase session key: the fallback reads the same login', () => {
  test('the real SDK finds the saved login on the /api road only with the pinned key', async ({ page }) => {
    // A plain same-origin page (no app, no mocks) so the real SDK runs.
    await page.goto('/version.json');
    await page.addScriptTag({ path: SDK });
    const r = await page.evaluate(async (DIRECT_KEY) => {
      localStorage.clear();
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const session = {
        access_token: 'a.b.c', refresh_token: 'r1', token_type: 'bearer', expires_in: 3600, expires_at: exp,
        user: { id: 'jack-uid', aud: 'authenticated', email: 'jack@example.com' },
      };
      // Saved by the direct client, exactly where the SDK puts it by default.
      localStorage.setItem(DIRECT_KEY, JSON.stringify(session));
      const KEY = 'sb_publishable_test';
      const opts = (extra) => ({ auth: Object.assign({ persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: window.localStorage }, extra) });
      const proxyUrl = location.origin + '/api';
      const direct = window.supabase.createClient('https://mwtsmctajhrrybblgorf.supabase.co', KEY, opts({}));
      const proxyOld = window.supabase.createClient(proxyUrl, KEY, opts({}));
      const proxyNew = window.supabase.createClient(proxyUrl, KEY, opts({ storageKey: DIRECT_KEY }));
      const uid = async (c) => ((await c.auth.getSession()).data.session || {}).user?.id || null;
      return { direct: await uid(direct), proxyOld: await uid(proxyOld), proxyNew: await uid(proxyNew) };
    }, DIRECT_KEY);
    expect(r.direct).toBe('jack-uid');
    expect(r.proxyOld, 'this is the bug: the fallback looked under its own name and saw nobody').toBe(null);
    expect(r.proxyNew, 'with the pinned key the fallback reads the same login').toBe('jack-uid');
  });
});

test.describe('Supabase session key: the app', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the key is pinned to the direct host, and the client is built with it', async () => {
    const r = await page.evaluate(async () => {
      const src = await (await fetch('/js/cloud.js', { cache: 'no-store' })).text();
      return {
        key: _SUPA_AUTH_KEY,
        proxy: _SUPA_PROXY_URL,
        passed: /createClient\(SUPA_URL,SUPA_KEY,\{\s*auth:\{[^}]*storageKey:_SUPA_AUTH_KEY/.test(src),
      };
    });
    expect(r.key).toBe('sb-mwtsmctajhrrybblgorf-auth-token');
    expect(r.proxy.endsWith('/api')).toBe(true);
    expect(r.passed, 'the main client must be built with the pinned key').toBe(true);
  });

  test('a login saved under a fallback name moves onto the pinned key once', async () => {
    const r = await page.evaluate((DIRECT_KEY) => {
      const keep = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); keep[k] = localStorage.getItem(k); }
      try {
        localStorage.removeItem(DIRECT_KEY);
        const stray = JSON.stringify({ access_token: 'x', refresh_token: 'r-stray', user: { id: 'u1' } });
        localStorage.setItem('sb-uat-auth-token', stray);
        const moved = _supaAdoptAuthKey();
        const now = localStorage.getItem(DIRECT_KEY);
        const strayLeft = localStorage.getItem('sb-uat-auth-token');
        // Once there is a login on the pinned key, nothing else ever overwrites it.
        localStorage.setItem('sb-tradedeskpro-auth-token', JSON.stringify({ refresh_token: 'r-other' }));
        const again = _supaAdoptAuthKey();
        const kept = JSON.parse(localStorage.getItem(DIRECT_KEY)).refresh_token;
        return { moved, same: now === stray, strayLeft, again, kept };
      } finally {
        localStorage.clear(); Object.keys(keep).forEach(k => localStorage.setItem(k, keep[k]));
      }
    }, DIRECT_KEY);
    expect(r.moved).toBe(true);
    expect(r.same).toBe(true);
    expect(r.strayLeft, 'the old copy is removed so the two can never disagree').toBe(null);
    expect(r.again).toBe(false);
    expect(r.kept).toBe('r-stray');
  });

  test('bad input never throws and never adopts something that is not a login', async () => {
    const r = await page.evaluate((DIRECT_KEY) => {
      const keep = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); keep[k] = localStorage.getItem(k); }
      const out = {};
      try {
        localStorage.clear();
        out.empty = _supaAdoptAuthKey();
        localStorage.setItem('sb-uat-auth-token', '{NOT JSON{{');
        out.corrupt = _supaAdoptAuthKey();
        localStorage.clear();
        localStorage.setItem('sb-uat-auth-token', JSON.stringify({ access_token: 'x' }));   // no refresh token
        out.noRefresh = _supaAdoptAuthKey();
        localStorage.clear();
        localStorage.setItem('sb-sign-isolated', JSON.stringify({ refresh_token: 'r' }));   // another page's own key
        out.isolated = _supaAdoptAuthKey();
        out.pinnedEmpty = localStorage.getItem(DIRECT_KEY) === null;
        localStorage.clear();
        localStorage.setItem('sb-uat-auth-token', JSON.stringify({ currentSession: { refresh_token: 'r-old-shape' } }));
        out.oldShape = _supaAdoptAuthKey();
      } catch (e) { out.threw = e.message; }
      finally { localStorage.clear(); Object.keys(keep).forEach(k => localStorage.setItem(k, keep[k])); }
      return out;
    }, DIRECT_KEY);
    expect(r.threw).toBeUndefined();
    expect(r.empty).toBe(false);
    expect(r.corrupt).toBe(false);
    expect(r.noRefresh).toBe(false);
    expect(r.isolated).toBe(false);
    expect(r.pinnedEmpty).toBe(true);
    expect(r.oldShape, 'the SDK\'s older saved shape is still a login').toBe(true);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'supa auth key');
  });
});
