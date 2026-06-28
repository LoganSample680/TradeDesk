// @ts-check
/**
 * Regression guard — fetchWeather() must NEVER resolve to null/undefined (§14).
 *
 * BUG — "Cannot read properties of null (reading '2026-06-01')" unhandled rejection
 *       fired on pg-cal navigation and during realtime-triggered re-renders.
 *       Root cause: fetchWeather() (data.js) returns `_weatherCache` while a fetch
 *       is in-flight (`_weatherLoading`), but `_weatherCache` is null until the
 *       first fetch resolves — so a concurrent caller got null, and the calendar
 *       renderers (finance.js / proposals.js) deref `weather[dateKey]` on it.
 *       Fix: fetchWeather() returns `_weatherCache||{}`; the two call sites also
 *       guard with `||{}`.
 *
 * This forces the exact race (loading + empty cache) and asserts the contract.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('fetchWeather null-safety', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('returns an object (never null) while a fetch is in-flight with an empty cache', async () => {
    const r = await page.evaluate(async () => {
      // Reproduce the exact crash window: a fetch is "loading" and nothing cached yet.
      window._weatherCache = null;
      window._weatherLoading = true;
      const w = await fetchWeather();
      window._weatherLoading = false;
      // The crash was `weather[dateKey]` on null — prove that deref is now safe.
      let threw = false;
      try { const _ = w['2026-06-01']; } catch (e) { threw = true; }
      return { isObject: w !== null && w !== undefined && typeof w === 'object', threw };
    });
    expect(r.isObject, 'fetchWeather must resolve to an object, never null/undefined').toBe(true);
    expect(r.threw, 'indexing the weather map by a date key must not throw').toBe(false);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
