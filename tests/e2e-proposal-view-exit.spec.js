// @ts-check
/**
 * The proposal preview can always be closed on an iPhone.
 *
 * Jack, 2026-09-23 (via the owner): the proposal preview "was in the dynamic
 * island space and can't be exited". The app runs viewport-fit=cover, so a bar
 * pinned to top:0 with 12px of padding put its Close button under the Dynamic
 * Island, where iOS takes the tap. Chromium reports env(safe-area-inset-top)
 * as 0, so these hold the rule the way the rest of the suite does (the inset
 * is in the bar's own style) and then prove each way out actually closes it.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the proposal preview, on an iPhone', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const openPreview = () => page.evaluate(() => {
    document.getElementById('_prop-preview-ov')?.remove();
    _showProposalPreviewOverlay('<div style="height:200px">Proposal</div>');
  });
  const isOpen = () => page.evaluate(() => !!document.getElementById('_prop-preview-ov'));

  test('the bar clears the Dynamic Island, and Close is a thumb-sized target', async () => {
    await openPreview();
    const r = await page.evaluate(() => {
      const ov = document.getElementById('_prop-preview-ov');
      const bar = ov.firstElementChild;
      const btn = bar.querySelector('button');
      return { style: bar.getAttribute('style'), body: ov.children[1].getAttribute('style'), h: btn.getBoundingClientRect().height };
    });
    expect(r.style).toContain('env(safe-area-inset-top');
    expect(r.body, 'the page scrolls clear of the home bar too').toContain('env(safe-area-inset-bottom');
    expect(r.h).toBeGreaterThanOrEqual(44);
  });

  test('Close closes it', async () => {
    await openPreview();
    await page.locator('#_prop-preview-ov button', { hasText: 'Close' }).tap();
    expect(await isOpen()).toBe(false);
  });

  test('a tap on the dim below a short proposal closes it, a tap on the proposal does not', async () => {
    await openPreview();
    await page.locator('#_prop-preview-ov').click({ position: { x: 196, y: 800 } });
    expect(await isOpen()).toBe(false);
    await openPreview();
    await page.locator('#_prop-preview-ov > div:nth-child(2) > div').click();
    expect(await isOpen()).toBe(true);
  });

  test('Escape closes it', async () => {
    await openPreview();
    await page.keyboard.press('Escape');
    expect(await isOpen()).toBe(false);
  });

  test('presentation mode: its exit clears the island too, and is thumb-sized', async () => {
    const r = await page.evaluate(() => {
      const d = document.createElement('div'); d.innerHTML = _presentHdr('Option A');
      document.body.appendChild(d);
      const bar = d.firstElementChild, btn = d.querySelector('#present-exit');
      const out = { style: bar.getAttribute('style'), w: btn.getBoundingClientRect().width, h: btn.getBoundingClientRect().height };
      d.remove();
      return out;
    });
    expect(r.style).toContain('env(safe-area-inset-top');
    expect(r.w).toBeGreaterThanOrEqual(44);
    expect(r.h).toBeGreaterThanOrEqual(44);
  });

  test('no console errors', async () => { assertNoErrors(page, 'proposal view exit'); });
});
