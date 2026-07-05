// @ts-check
// Observability/telemetry — the analytics + console-error capture layer.
// HARD RULE under test: observability is INERT on localhost (the test origin),
// so it can never add load, noise, or console-wrapping during any test run —
// and the app must tolerate its absence everywhere it's referenced.
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Telemetry layer', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('observability is inert on localhost — no _obs, no console.error wrapper', async () => {
    const r = await page.evaluate(() => ({
      obs: typeof window._obs,
      // Native console.error must be untouched on the test origin so Playwright's
      // console listeners and assertNoErrors see the real thing.
      consoleNative: String(console.error).includes('[native code]'),
    }));
    expect(r.obs).toBe('undefined');
    expect(r.consoleNative).toBe(true);
  });

  test('goPg page-view hook tolerates absent _obs (navigation still works)', async () => {
    await goPg(page, 'pg-team');
    const active = await page.evaluate(() => document.querySelector('.pg.active')?.id);
    expect(active).toBe('pg-team');
    await goPg(page, 'pg-dash');
    assertNoErrors(page, 'goPg with no _obs');
  });
});
