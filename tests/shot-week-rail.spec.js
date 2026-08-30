// Screenshot harness for the week rail (§0 step 0.5). Not a gate: the real
// assertions live in tests/e2e-timelog-week-rail.spec.js. This renders the
// component with the owner's real 08/27 geometry so the picture can be
// reviewed before anything is deployed.
const { test, mockAllExternal, waitForAppBoot } = require('./helpers');
const { WEEK_ROWS, WEEK_DAYS, renderWeekRail } = require('./week-rail-fixture');

async function shoot(page, path) {
  await mockAllExternal(page);
  await page.goto('/index.html');
  await waitForAppBoot(page);
  await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
  await page.waitForTimeout(300);
  await page.screenshot({ path, fullPage: false });
}

test.describe('week rail screenshot', () => {
  test('phone', async ({ page }) => { await shoot(page, 'week-rail-mobile.png'); });
});

test.describe('week rail screenshot, 320px', () => {
  test.use({ viewport: { width: 320, height: 760 } });
  test('narrow', async ({ page }) => { await shoot(page, 'week-rail-320.png'); });
});
