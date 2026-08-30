// Screenshot harness for the week rail (§0 step 0.5). Not a gate: the real
// assertions live in tests/e2e-timelog-week-rail.spec.js. This renders the
// component with the owner's real 08/27 geometry so the picture can be
// reviewed before anything is deployed.
const { test, mockAllExternal, waitForAppBoot } = require('./helpers');
const { mountWeekBars, mountMonth, mountDay } = require('./week-bars-fixture');

async function shoot(page, path) {
  await mockAllExternal(page);
  await page.goto('/index.html');
  await waitForAppBoot(page);
  await mountWeekBars(page);
  await page.screenshot({ path, fullPage: false });
}

test.describe('week rail screenshot', () => {
  test('phone', async ({ page }) => { await shoot(page, 'week-bars-mobile.png'); });
});

// The month level: the picker, the weekly bars, and the weeks underneath.
test.describe('month screenshot', () => {
  test('phone', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountMonth(page);
    await page.screenshot({ path: 'drill-1-month.png', fullPage: false });
    // Down a level: the week.
    await page.evaluate(() => _tlDrillTo('week', '2026-08-23'));
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'drill-2-week.png', fullPage: false });
    // Down again: the day.
    await page.evaluate(() => _tlDrillTo('day', '2026-08-27'));
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'drill-3-day.png', fullPage: false });
  });
});

test.describe('week rail screenshot, 320px', () => {
  test.use({ viewport: { width: 320, height: 760 } });
  test('narrow', async ({ page }) => { await shoot(page, 'week-bars-320.png'); });
});

// The affordance work, close up (owner 2026-08-30: "screenshot what the
// physiological stuff looks like to get people to click into them"). Shot at
// 3x and cropped to the chart itself, because the whole point is a 1px
// highlight and a 2px shadow: at 1x on a full page they are real but they are
// not reviewable.
test.describe('bar affordance close-up', () => {
  test.use({ deviceScaleFactor: 3 });
  test('month and week charts', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountMonth(page);
    await page.waitForTimeout(400);
    await page.locator('.tl-wbar-wrap').first().screenshot({ path: 'afford-1-month.png' });
    await page.evaluate(() => _tlDrillTo('week', '2026-08-23'));
    await page.waitForTimeout(400);
    await page.locator('.tl-wbar-wrap').first().screenshot({ path: 'afford-2-week.png' });
    // Hover the tallest column: the raised state is half the affordance and it
    // is invisible in a resting screenshot.
    await page.locator('.tl-wbar-hit').nth(3).hover();
    await page.waitForTimeout(200);
    await page.locator('.tl-wbar-wrap').first().screenshot({ path: 'afford-3-hover.png' });
  });
});
