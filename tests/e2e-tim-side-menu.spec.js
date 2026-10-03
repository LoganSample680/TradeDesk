// @ts-check
// ── Tim on the side menu (iPad and laptop) ──────────────────────────────────
//
// Owner 2026-10-03: "Tim is not on iPad view". From 768px up the bottom bar,
// and Tim's raised key with it, gives way to the side menu, which had no Tim.
// An iPad (and the App Store reviewer on one) could not reach him at all.
// #nb-tim is the same key on the side menu, under the same rules:
// timDockRender shows it, hides it for crew, and puts the finding count on it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
  await page.evaluate(() => timDockRender());
  return page;
}

test.describe('Tim on the side menu', () => {
  test('iPad width: Tim is on the side menu, opens his sheet, and the bottom bar is not drawn', async ({ browser }) => {
    const page = await boot(browser, 820, 1180);
    await expect(page.locator('#nb-tim')).toBeVisible();
    await expect(page.locator('#nb-tim-mark img'), 'his mark, not an empty box').toHaveCount(1);
    await expect(page.locator('#mtb-tim')).toBeHidden();
    await page.click('#nb-tim');
    await expect(page.locator('#_tim-sheet')).toBeVisible();
    assertNoErrors(page, 'tim side menu, ipad');
    await page.context().close();
  });

  test('laptop width: the same', async ({ browser }) => {
    const page = await boot(browser, 1280, 800);
    await expect(page.locator('#nb-tim')).toBeVisible();
    await page.context().close();
  });

  test('phone width: the side menu is not drawn and the raised key is', async ({ browser }) => {
    const page = await boot(browser, 390, 844);
    await expect(page.locator('#nb-tim')).toBeHidden();
    await expect(page.locator('#mtb-tim')).toBeVisible();
    await page.context().close();
  });

  test('crew get no Tim on the side menu either', async ({ browser }) => {
    const page = await boot(browser, 820, 1180);
    const hidden = await page.evaluate(() => {
      const was = window._timCrew;
      window._timCrew = () => true;
      try { timDockRender(); return document.getElementById('nb-tim').hidden; }
      finally { window._timCrew = was; timDockRender(); }
    });
    expect(hidden).toBe(true);
    await page.context().close();
  });

  test('the badge carries the finding count, and nothing when there is nothing', async ({ browser }) => {
    const page = await boot(browser, 820, 1180);
    const r = await page.evaluate(() => {
      const was = window._timDockFinds;
      const badge = () => { const b = document.getElementById('nb-tim-badge'); return { text: b.textContent, shown: getComputedStyle(b).display !== 'none' }; };
      try {
        window._timDockFinds = () => [{ id: 'a' }, { id: 'b' }];
        timDockRender();
        const two = badge();
        window._timDockFinds = () => [];
        timDockRender();
        return { two, none: badge() };
      } finally { window._timDockFinds = was; timDockRender(); }
    });
    expect(r.two).toEqual({ text: '2', shown: true });
    expect(r.none).toEqual({ text: '', shown: false });
    await page.context().close();
  });
});
