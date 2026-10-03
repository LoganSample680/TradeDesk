// A week that crosses a month or a year is still ONE week (owner 2026-10-01).
//
// "Crossover bug in the week view. Click into timesheets: I only see one day
// even though this week is Sep 27 to Oct 3; it's saying Oct 1 is a new week."
//
// Root cause: _tlMonthBarsHtml filled each week column from the MONTH's rows,
// so on Oct 1 the October chart drew the week of Sep 27 as one 2h column (Oct 1
// alone) under a label that names seven days. The same cut happened one level
// up, at the year: the week drill, the timesheet review and the weekly OT all
// read the OPEN YEAR's rows, so Dec 27 to Jan 2 lost whichever side was not
// open. Every surface that totals one week now reads _tlWeekRows.
//
// Every date here is named, and "today" is set with page.clock, so the result
// cannot depend on the day CI happens to run (§5.2.2). clock:'off' because this
// spec owns window.Date itself.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const row = (id, date, minutes) => ({
  id, date, minutes, source: 'auto', rawSource: 'client', clientName: 'John Doe',
  startTime: date + 'T14:00:00.000Z', personUid: null,
});

const CASES = [
  {
    name: 'month boundary, Sun Sep 27 to Sat Oct 3 2026',
    now: '2026-10-01T17:00:00.000Z',          // Thu Oct 1, noon Central
    wk: '2026-09-27',
    days: ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
    rows: [row('c1', '2026-09-28', 480), row('c2', '2026-09-29', 420),
           row('c3', '2026-09-30', 360), row('c4', '2026-10-01', 120)],
    amts: ['—', '8h', '7h', '6h', '2h', '—', '—'],
    landMo: '2026-10', otherMo: '2026-09', otherYr: null,
    label: 'Week of Sep 27 – Oct 3', range: 'Sep 27 to Oct 3', col: '9/27–10/3',
    reviewDays: ['Mon, Sep 28', 'Tue, Sep 29', 'Wed, Sep 30', 'Thu, Oct 1'],
  },
  {
    name: 'year boundary, Sun Dec 27 2026 to Sat Jan 2 2027',
    now: '2027-01-01T18:00:00.000Z',          // Fri Jan 1, noon Central
    wk: '2026-12-27',
    days: ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'],
    rows: [row('y1', '2026-12-28', 480), row('y2', '2026-12-29', 420),
           row('y3', '2026-12-30', 360), row('y4', '2027-01-01', 120)],
    amts: ['—', '8h', '7h', '6h', '—', '2h', '—'],
    landMo: '2027-01', otherMo: '2026-12', otherYr: '2026',
    label: 'Week of Dec 27 – Jan 2', range: 'Dec 27 to Jan 2', col: '12/27–1/2',
    reviewDays: ['Mon, Dec 28', 'Tue, Dec 29', 'Wed, Dec 30', 'Fri, Jan 1'],
  },
];

async function boot(page, c) {
  await mockAllExternal(page, { clock: 'off' });
  // install, not setFixedTime: a frozen Date.now leaves the boot overlay up
  // forever on WebKit (its settle wait measures elapsed time), so it covers
  // every tap. Installed time starts at the named instant and keeps running.
  await page.clock.install({ time: new Date(c.now) });
  await page.goto('/index.html');
  await waitForAppBoot(page);
  await page.evaluate((rs) => {
    try { S.bizTz = 'America/Chicago'; } catch (_e) {}
    window._timeLogRows = async () => rs.map(r => ({ ...r }));
    goPg('pg-timelog');
  }, c.rows);
  await page.waitForTimeout(600);
}
const settle = (page) => page.waitForTimeout(350);
const amounts = (page) => page.$$eval('#pg-timelog .tl-wbar-amt', els => els.map(e => e.textContent.trim()));
const head = (page) => page.evaluate(() => ({
  level: _tlDrill.level, wk: _tlDrill.wk,
  lbl: (document.querySelector('#pg-timelog .tl-monav-lbl') || {}).textContent || '',
  tot: (document.querySelector('#pg-timelog .tl-monav-tot') || {}).textContent || '',
}));
// The week level, whichever door it came through: seven columns Sun to Sat,
// the three days on the far side carrying their hours, the label naming the
// week and the total being all of it (480+420+360+120 = 1380 = 23h).
async function expectWholeWeek(page, c) {
  const h = await head(page);
  expect(h.level).toBe('week');
  expect(h.wk).toBe(c.wk);
  expect(h.lbl).toBe(c.label);
  expect(h.tot.trim()).toBe('23h');
  expect(await amounts(page)).toEqual(c.amts);
  const dates = await page.evaluate(() => _tlWeekDayDates(_tlDrill.wk));
  expect(dates).toEqual(c.days);
}
const colSel = (wk) => `#pg-timelog [onclick*="_tlDrillTo('week','${wk}')"]`;

for (const c of CASES) {
  test.describe(c.name, () => {
    test.beforeEach(async ({ page }) => { await boot(page, c); });
    test.afterEach(async ({ page }) => { assertNoErrors(page, c.name); });

    test('default landing on today: the month column is the whole week, and tapping it opens all seven days', async ({ page }) => {
      const land = await page.evaluate(() => ({ today: todayKey(), level: _tlDrill.level, mo: _tlDrill.mo }));
      expect(land.today).toBe(c.now.slice(0, 10));
      expect(land).toMatchObject({ level: 'month', mo: c.landMo });
      // THE REGRESSION: one column, labelled as the week, holding the week.
      // It drew 2h here, the one day on this side of the boundary.
      const col = page.locator(colSel(c.wk));
      await expect(col).toHaveCount(1);
      await expect(col).toContainText(c.col);
      expect(await amounts(page)).toEqual(['23h']);
      await col.click();
      await settle(page);
      await expectWholeWeek(page, c);
    });

    test('month chart column tap from the other side of the boundary opens the same week', async ({ page }) => {
      if (c.otherYr) { await page.evaluate((y) => setTimeLogYear(y), c.otherYr); await settle(page); }
      await page.evaluate((m) => _tlDrillTo('month', m), c.otherMo);
      await settle(page);
      const col = page.locator(colSel(c.wk));
      await expect(col).toHaveCount(1);
      await expect(col).toContainText('23h');
      await col.click();
      await settle(page);
      await expectWholeWeek(page, c);
    });

    test('day to week up-drill lands on the whole week', async ({ page }) => {
      await page.evaluate((d) => _tlDrillTo('day', d), c.now.slice(0, 10));
      await settle(page);
      const back = page.locator('#pg-timelog .tl-drill-back');
      await expect(back).toHaveText('‹ ' + c.label);
      await back.click();
      await settle(page);
      await expectWholeWeek(page, c);
    });

    test('the timesheet review lists every worked day of the week and totals all of it', async ({ page }) => {
      await page.locator(colSel(c.wk)).click();
      await settle(page);
      await page.locator('#pg-timelog .tl-wbar-share').first().click();
      const sheet = page.locator('#ts-review');
      await expect(sheet).toBeVisible();
      const r = await page.evaluate(() => {
        const s = document.getElementById('ts-review');
        return {
          title: s.querySelector('.zmodal-title').textContent.trim(),
          days: [...s.querySelectorAll('.ts-day')].map(b => [
            b.querySelector('.ts-day-l').textContent.trim(), b.querySelector('.ts-day-h').textContent.trim()]),
          total: s.querySelector('.ts-total b').textContent.trim(),
        };
      });
      expect(r.title).toBe(c.range);
      expect(r.days).toEqual([[c.reviewDays[0], '8h'], [c.reviewDays[1], '7h'],
                              [c.reviewDays[2], '6h'], [c.reviewDays[3], '2h']]);
      expect(r.total).toBe('23h');
    });
  });
}

test.describe('weekly overtime across the new year', () => {
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'new year OT'); });
  test('44 hours split over Dec 28 to Jan 1 is overtime on the January side too', async ({ page }) => {
    const c = { now: '2027-01-01T18:00:00.000Z',
      rows: [row('o1', '2026-12-28', 660), row('o2', '2026-12-29', 660),
             row('o3', '2026-12-30', 660), row('o4', '2027-01-01', 660)] };
    await boot(page, c);
    // 2027 is open: only Jan 1 is in the year, and on its own it is 11h.
    const r = await page.evaluate(() => ({
      yr: _tlYear, ot: _tlLastRows.map(x => [x.date, x.weekOT]),
    }));
    expect(r.yr).toBe('2027');
    expect(r.ot).toEqual([['2027-01-01', true]]);
  });
});
