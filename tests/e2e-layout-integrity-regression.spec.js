// @ts-check
/**
 * Layout & Visual Integrity guard (CLAUDE.md §16.3). Catches the class of bug where a
 * screen renders "all fuckered up" — duplicate/overlapping controls or content that
 * bleeds off-screen on mobile.
 *
 * Specific regression locked in here: the BYO/T&M summary rail had a second, half-wired
 * `#byo-mob-bar` (position:fixed) that showed a stale $0 total and OVERLAPPED the rail's
 * own Send/Sign buttons on phones. It's retired (display:none); this proves it stays gone
 * and that the app doesn't bleed past the viewport at mobile width.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('layout integrity — mobile', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('the broken duplicate BYO sticky bar (#byo-mob-bar) is never shown on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await page.evaluate(() => {
      const bar = document.getElementById('byo-mob-bar');
      return {
        exists: !!bar,
        shown: bar ? getComputedStyle(bar).display !== 'none' : false,
      };
    });
    // The element may exist in the DOM, but it must never render (it's a half-wired
    // duplicate of the summary rail's actions). If someone re-adds a display:block
    // media rule, this fails.
    expect(r.shown, '#byo-mob-bar must stay display:none — it duplicated/overlapped the rail actions').toBe(false);
  });

  test('the app does not bleed past the viewport width on mobile (390px)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no element may cause horizontal scroll / bleed off-screen at 390px').toBeLessThanOrEqual(1);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
