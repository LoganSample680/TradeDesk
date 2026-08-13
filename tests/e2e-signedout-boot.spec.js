// @ts-check
/**
 * Signed-out boot gate (owner 2026-08-10): "when I force closed the app after
 * signing out and reopened it quickly it brought up a bunch of zeros on the
 * screen when it should always bring up the sign in screen first."
 *
 * A deliberate sign-out removes the stored Supabase auth token first and wipes
 * the local footprint after; killing the app between those steps left a
 * half-wiped zp3_cloud_cache that booted as a dashboard of zeros with no login.
 * The gate: the cache is only trusted when a stored sb-*-auth-token exists
 * (the offline-blip case). No token = signed out on purpose = login screen.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('signed-out boot always lands on the sign-in screen', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    // Seed the half-wiped state BEFORE the app boots: a cache with data but
    // no sb- auth token anywhere, exactly what an interrupted sign-out leaves.
    await page.addInitScript(() => {
      // The default shim fakes a signed-in session; this spec needs the clean
      // signed-out shape the real client returns after sign-out.
      window.__noSession = true;
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('__seeded', '1');
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({
          _owner: 'ghost-user', bids: [{ id: 'zombie-1', amount: 4200 }], clients: [], jobs: [],
        }));
      }
    });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('no stored token: the login screen shows and the zombie cache is gone', async () => {
    const r = await page.evaluate(() => ({
      loginShown: !!document.getElementById('supa-login-overlay'),
      cacheCleared: localStorage.getItem('zp3_cloud_cache') === null,
      zombieNotLoaded: !bids.some(b => String(b.id) === 'zombie-1'),
    }));
    expect(r.loginShown, 'signed out on purpose means sign in first, always').toBe(true);
    expect(r.cacheCleared, 'the half-wiped cache is finished off, not resurrected').toBe(true);
    expect(r.zombieNotLoaded, 'ghost data never reaches the arrays').toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
