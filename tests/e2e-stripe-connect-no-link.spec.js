// @ts-check
/**
 * startStripeConnect (js/cloud.js) with a reply that carries no link.
 *
 * Found by the handler sweep on #149 (2026-10-02): the Connect button's reply
 * had neither an error nor a url, location.href was set to undefined, and the
 * app navigated to "/undefined" a moment later, out from under whatever came
 * next. Only an https link may leave the app now; anything else says so and
 * stays put.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Stripe Connect: no link, no navigation', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Calls startStripeConnect with the onboard reply stubbed, and reports what
  // he would have seen and where the app would have gone.
  const connectWith = (reply) => page.evaluate(async (reply) => {
    const alerts = [];
    const za = window.zAlert, f = window.fetch, user = window._supaUser;
    window._supaUser = user || { id: 'stripe-no-link' };
    window.zAlert = (m) => alerts.push(String(m));
    window.fetch = (u, o) => /stripe-connect-onboard/.test(String(u))
      ? Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : f(u, o);
    const before = location.href;
    try { await startStripeConnect(); } finally { window.zAlert = za; window.fetch = f; window._supaUser = user; }
    await new Promise(r => setTimeout(r, 300));
    return { alerts, stayed: location.href === before, path: location.pathname };
  }, reply);

  for (const [label, reply] of [
    ['an empty reply', {}],
    ['a null url', { url: null }],
    ['a url that is not a string', { url: 42 }],
    ['a url that is not https', { url: 'javascript:alert(1)' }],
  ]) {
    test(label + ' says so and stays put', async () => {
      const r = await connectWith(reply);
      expect(r.stayed, 'no navigation').toBe(true);
      expect(r.path).not.toContain('undefined');
      expect(r.alerts).toEqual(['Stripe did not send back a sign-up link. Try again in a minute.']);
    });
  }

  test('an error from Stripe is still shown as the error', async () => {
    const r = await connectWith({ error: 'account restricted' });
    expect(r.stayed).toBe(true);
    expect(r.alerts).toEqual(['Stripe error: account restricted']);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'stripe connect no link');
  });
});
