// @ts-check
// ── ops.html: one person's phone (owner 2026-10-01) ──
//
// "An RPC graph that grabs iOS statistics for each device ... a card so I can
// click into Jack and see how his phone is performing and batteries degrading
// without polling you."
//
// Pinned here:
//   1. The Phone section follows the person picked in the chips, a row per day.
//   2. Every label and format comes from ops_metric_defs (CLAUDE.md 18): rename
//      a label in the registry and the page says the new one, with no edit here.
//   3. A tap opens the day: every Phones metric plus the hour chart, and a
//      second tap shuts it.
//   4. Empty and failed answers say so, never a blank or an endless shimmer.
//   5. No horizontal bleed at 390 with a day open (§15.3).
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, assertNoErrors } = require('./helpers');

const ROSTER = [
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: null, person_user_id: 'u-logan', person_name: 'Logan Sample', person_email: 'l@x.com', role: 'owner', permissions: {}, active: true },
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: null, person_user_id: 'u-jack', person_name: 'Jack Rivera', person_email: 'j@x.com', role: 'crew', permissions: {}, active: true },
];
const BY = [{ contractor_user_id: 'biz-a', business: 'Sample Plumbing', people: 2, active_days: 5, last_active: '2026-09-30' }];
const SUMMARY = { days: 30, people: 2, accounts: 1, active_days: 5 };
const BRIEF = { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', sections: [], timing: [] };

// The registry's Phones rows, exactly the shape ops_metric_defs returns.
const DEFS = [
  ['drain_hr', 'Drain per hour', 'pct', 1],
  ['batt_low', 'Lowest battery', 'pct', 2],
  ['gps_min', 'GPS on', 'mins', 3],
  ['kills', 'Closed by iOS', 'int', 4],
  ['wakes', 'Wakes answered', 'int', 5],
  ['heat', 'Hottest', 'text', 6],
  ['low_power_days', 'Low Power Mode days', 'int', 7],
  ['bg_refresh', 'Background refresh', 'text', 8],
  ['cpu_max', 'App CPU peak', 'pct', 9],
  ['mem_max', 'App memory peak', 'mb', 10],
  ['apple_gps_min', 'Precise GPS (Apple)', 'mins', 11],
  ['apple_bg_loc_min', 'Background location (Apple)', 'mins', 12],
  ['apple_cpu_min', 'CPU time (Apple)', 'mins', 13],
  ['ios_ended', 'Ended by iOS (Apple)', 'int', 14],
  ['ended_why', 'Why iOS ended it', 'text', 15],
  ['crashes', 'Crashes and hangs', 'int', 16],
  ['cell_mb', 'Cellular data', 'mb', 17],
  ['bars', 'Signal bars', 'num', 18],
  ['loc_perm', 'Location permission', 'text', 19],
  ['network', 'Network', 'text', 20],
].map(([key, label, fmt, sort]) => ({ section: 'device', section_label: 'Phones', section_sort: 6, key, label, fmt, sort }))
  .concat([{ section: 'work', section_label: 'Work', section_sort: 1, key: 'people', label: 'People', fmt: 'int', sort: 1 }]);

const day = (d, o = {}) => Object.assign({
  person_user_id: 'u-jack', contractor_user_id: 'biz-a', day: d, drain_hr: 6.8, batt_first: 100, batt_last: 45,
  batt_low: 30, heat: 'serious', low_power_days: 0, bg_refresh: 'on', gps_min: 823, kills: 2, wakes: 47,
  cpu_max: 12.5, mem_max: 210, apple_gps_min: 95, apple_bg_loc_min: 410, apple_cpu_min: 3.5, ios_ended: 4,
  ended_why: 'watchdog', crashes: 0, cell_mb: 41.2, bars: 3.1, loc_perm: 'always', network: 'LTE',
}, o);
const DAYS = {
  'u-logan': [day('2026-09-30', { person_user_id: 'u-logan', drain_hr: 5.9, batt_low: 55, gps_min: 458, kills: 0, heat: 'nominal' })],
  'u-jack': [day('2026-09-30'), day('2026-09-29', { drain_hr: 6.6, batt_low: 55, gps_min: 884, kills: 3 })],
};
// Months and years, the shape ops_device_periods returns.
const per = (period, days, o = {}) => Object.assign(day(period, o), { period, days });
const PERIODS = {
  month: [per('2026-09-01', 23, { drain_hr: 6.1 }), per('2026-08-01', 21, { drain_hr: 5.2 }), per('2026-07-01', 22, { drain_hr: 4.8 })],
  year: [per('2026-01-01', 66, { drain_hr: 5.4 })],
};
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  hour: h, batt: h < 8 ? null : Math.max(30, 100 - (h - 8) * 7), gps_min: h === 8 ? 30 : h === 12 ? 60 : 0,
  flips: h === 8 ? 1 : 0, kills: h === 10 ? 1 : 0, wakes: h >= 8 && h <= 17 ? 2 : 0,
  heat: h === 9 ? 'serious' : null, cpu_max: h === 9 ? 12.5 : null,
}));

// The same seam e2e-ops-portal.spec.js uses: the page builds its client the
// moment the vendor script defines window.supabase. Every device call is
// recorded so a test can prove WHO it asked about.
function stubRpc(page, { defs = DEFS, days = DAYS, hours = HOURS, daysError = null, brief = BRIEF, periods = PERIODS, roster = ROSTER } = {}) {
  return page.addInitScript(({ ROSTER, BY, SUMMARY, brief, defs, days, hours, daysError, periods }) => {
    window.__dev = [];
    window.__defs = defs;
    let held;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return held; },
      set(v) {
        held = { createClient: (u, k, o) => {
          const c = v.createClient(u, k, o);
          c.rpc = (fn, args) => {
            if (fn === 'ops_view_roster') return Promise.resolve({ data: ROSTER, error: null });
            if (fn === 'ops_summary') return Promise.resolve({ data: [SUMMARY], error: null });
            if (fn === 'ops_by_contractor') return Promise.resolve({ data: BY, error: null });
            if (fn === 'ops_account_brief') return Promise.resolve({ data: brief, error: null });
            if (fn === 'ops_live_status') return Promise.resolve({ data: [], error: null });
            if (fn === 'ops_metric_defs') return Promise.resolve({ data: window.__defs, error: null });
            if (fn === 'ops_device_days') {
              window.__dev.push({ fn, args });
              if (daysError) return Promise.resolve({ data: null, error: { message: daysError } });
              return Promise.resolve({ data: days[args.p_person] || [], error: null });
            }
            if (fn === 'ops_device_hours') { window.__dev.push({ fn, args }); return Promise.resolve({ data: hours, error: null }); }
            if (fn === 'ops_device_periods') {
              window.__dev.push({ fn, args });
              // 'CUR' stands for whichever month the page thinks is now, so a
              // test about the running month holds on any date.
              const n = new Date(), cur = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-01';
              const rows = (periods[args.p_grain] || []).map(r => r.period === 'CUR' ? Object.assign({}, r, { period: cur, day: cur }) : r);
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          };
          return c;
        } };
      }
    });
  }, { ROSTER: roster, BY, SUMMARY, brief, defs, days, hours, daysError, periods });
}

async function openBiz(page) {
  await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
  await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
  await expect(page.locator('#lvl-biz')).toBeVisible();
}

async function boot(browser, opts = {}, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await stubRpc(page, opts);
  await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#trades .row').first().waitFor();
  return { ctx, page };
}

test.describe('Ops portal: one person\'s phone', () => {

  test('follows the person picked in the chips, a row per day', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    // The owner is picked by default, so it is the owner's phone first.
    await expect(page.locator('#phone-title')).toHaveText("Logan's phone");
    await expect(page.locator('#biz-phone .pday')).toHaveCount(1);
    await expect(page.locator('#biz-phone .pday').first()).toContainText('5.9%');

    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    await expect(page.locator('#phone-title')).toHaveText("Jack's phone");
    await expect(page.locator('#biz-phone .pday')).toHaveCount(2);
    const first = page.locator('#biz-phone .pday').first();
    await expect(first).toContainText('Wed 9/30');            // newest first
    await expect(first).toContainText('6.8%');                // pct
    await expect(first).toContainText('30%');                 // pct
    await expect(first).toContainText('14h');                 // mins: 823 rounds to whole hours in the row
    await first.locator('.pday-head').click();
    await expect(first.locator('.pstat', { hasText: 'GPS on' })).toContainText('13h 43m');   // exact when open
    await first.locator('.pday-head').click();
    // The column names are said once, in the header, not under every number.
    await expect(page.locator('#biz-phone .phone-cols')).toContainText('Closed by iOS');
    await expect(first).not.toContainText('Closed by iOS');
    const asked = await page.evaluate(() => window.__dev.filter(c => c.fn === 'ops_device_days').map(c => c.args.p_person));
    expect(asked).toEqual(['u-logan', 'u-jack']);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('the columns are the registry\'s first four, in the registry\'s order', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await expect(page.locator('#biz-phone .pday')).toHaveCount(1);
    const labels = await page.locator('#biz-phone .phone-cols span').allTextContents();
    expect(labels).toEqual(['Day', 'Drain per hour', 'Lowest battery', 'GPS on', 'Closed by iOS', '']);
    // Each value sits under its own column.
    const box = async (sel) => (await page.locator(sel).boundingBox());
    const head = await box('#biz-phone .phone-cols span:nth-child(3)');
    const val = await box('#biz-phone .pday .pday-v:nth-child(3)');
    expect(Math.abs((head.x + head.width) - (val.x + val.width))).toBeLessThan(2);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('a label renamed in the registry is the label on the page (CLAUDE.md 18)', async ({ browser }) => {
    const defs = DEFS.map(d => d.key === 'drain_hr' ? Object.assign({}, d, { label: 'Battery used each hour' }) : d);
    const { ctx, page } = await boot(browser, { defs });
    await openBiz(page);
    await expect(page.locator('#biz-phone .phone-cols')).toContainText('Battery used each hour');
    await expect(page.locator('#biz-phone')).not.toContainText('Drain per hour');
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('the page itself names none of the Phones metrics', async () => {
    // The registry is the only author. If one of these strings turns up in the
    // page source, a second definition has started.
    const src = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
    for (const d of DEFS.filter(x => x.section === 'device')) {
      expect(src, d.label).not.toContain(d.label);
    }
  });

  test('a tap opens the day with every metric and its hours, a second tap shuts it', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    const first = page.locator('#biz-phone .pday').first();
    await first.locator('.pday-head').click();
    await expect(first.locator('.pday-head')).toHaveAttribute('aria-expanded', 'true');
    await expect(first.locator('.pstat')).toHaveCount(20);
    await expect(first.locator('.pstat', { hasText: 'Why iOS ended it' })).toContainText('watchdog');
    await expect(first.locator('.pstat', { hasText: 'Background location (Apple)' })).toContainText('6h 50m');
    await expect(first.locator('.pstat', { hasText: 'App memory peak' })).toContainText('210 MB');
    await expect(first.locator('.pstat', { hasText: 'App CPU peak' })).toContainText('12.5%');
    await expect(first.locator('.pstat dd.hot')).toHaveText('serious');
    await expect(first.locator('svg.hours polygon.area')).toHaveCount(1);
    await expect(first.locator('svg.hours polyline.batt')).toHaveCount(1);
    await expect(first.locator('svg.hours circle.kill')).toHaveCount(1);
    await expect(first.locator('svg.hours rect.gps')).toHaveCount(2);
    await expect(first.locator('.hours-key')).toContainText('GPS on');
    // The chart comes before the numbers.
    const chartY = (await first.locator('svg.hours').boundingBox()).y;
    const statsY = (await first.locator('.pstats').boundingBox()).y;
    expect(chartY).toBeLessThan(statsY);
    const hours = await page.evaluate(() => window.__dev.filter(c => c.fn === 'ops_device_hours').map(c => c.args));
    expect(hours).toEqual([{ p_person: 'u-jack', p_day: '2026-09-30' }]);
    // Only one day open at a time, and the other stays shut.
    await expect(page.locator('#biz-phone .pday-body')).toHaveCount(1);
    await first.locator('.pday-head').click();
    await expect(page.locator('#biz-phone .pday-body')).toHaveCount(0);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('switching person shuts the open day', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    await page.locator('#biz-phone .pday-head').first().click();
    await expect(page.locator('#biz-phone .pday-body')).toHaveCount(1);
    await page.locator('#biz-chips .chip', { hasText: 'Logan' }).click();
    await expect(page.locator('#phone-title')).toHaveText("Logan's phone");
    await expect(page.locator('#biz-phone .pday-body')).toHaveCount(0);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('the account owner is picked first even when a co-owner sorts ahead of them', async ({ browser }) => {
    // Logan's own business on 2026-10-01: Blake is a co-owner (role owner on
    // team_members), sorts first by name, and the page opened on his phone.
    // Logan's profile name is his email, so his chip reads the part before @.
    const roster = [
      { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: null, person_user_id: 'u-blake', person_name: 'Blake Sample', person_email: 'b@x.com', role: 'owner', permissions: {}, active: true },
      { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: null, person_user_id: 'biz-a', person_name: 'logansample97@gmail.com', person_email: 'logansample97@gmail.com', role: 'owner', permissions: {}, active: true },
    ];
    const days = { 'biz-a': [day('2026-09-30', { person_user_id: 'biz-a' })], 'u-blake': [] };
    const { ctx, page } = await boot(browser, { roster, days });
    await openBiz(page);
    await expect(page.locator('#biz-chips .chip.on')).toHaveText('logansample97');
    await expect(page.locator('#phone-title')).toHaveText("logansample97's phone");
    await expect(page.locator('#biz-phone .pday')).toHaveCount(1);
    await expect(page.locator('#biz-chips .chip', { hasText: 'Blake' })).toHaveCount(1);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('no reports says so', async ({ browser }) => {
    const { ctx, page } = await boot(browser, { days: {} });
    await openBiz(page);
    // The switch stays, so an empty month can still be grouped another way.
    await expect(page.locator('#biz-phone .phone')).toHaveText('No phone reports in this range.');
    await expect(page.locator('#biz-phone .pseg-b')).toHaveCount(3);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('a failed call says so instead of shimmering forever', async ({ browser }) => {
    const { ctx, page } = await boot(browser, { daysError: 'network is down' });
    await openBiz(page);
    await expect(page.locator('#biz-phone')).toContainText('Could not load');
    await expect(page.locator('#biz-phone')).toContainText('network is down');
    await expect(page.locator('#biz-phone .skel')).toHaveCount(0);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('the business page does not repeat the Phones numbers as tiles', async ({ browser }) => {
    const brief = Object.assign({}, BRIEF, { sections: [
      { key: 'work', label: 'Work', sort: '001', metrics: [{ key: 'people', label: 'People', fmt: 'int', value: 2 }] },
      { key: 'device', label: 'Phones', sort: '006', metrics: [{ key: 'drain_hr', label: 'Drain per hour', fmt: 'pct', value: 6 }] },
    ] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await stubRpc(page, { brief });
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#trades .row').first().waitFor();
    await openBiz(page);
    await expect(page.locator('#biz-sections .section-title')).toHaveText(['Work']);
    await expect(page.locator('#biz-sections')).not.toContainText('Phones');
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('months roll the days up, lead with the drain trend, and open into their days', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    await page.locator('#biz-phone [data-grain="month"]').click();
    await expect(page.locator('#biz-phone .pseg-b.on')).toHaveText('Months');
    await expect(page.locator('#biz-phone .phone-cols span').first()).toHaveText('Month');
    await expect(page.locator('#biz-phone .pday')).toHaveCount(3);
    const first = page.locator('#biz-phone .pday').first();
    await expect(first).toContainText('Sep 2026');
    await expect(first).toContainText('23 days');
    await expect(first).toContainText('6.1%');
    // The wear line: the first registry metric, oldest to newest.
    await expect(page.locator('#biz-phone .ptrend-k')).toHaveText('Drain per hour, by month');
    await expect(page.locator('#biz-phone .ptrend circle.dot')).toHaveCount(3);
    const asked = await page.evaluate(() => window.__dev.filter(c => c.fn === 'ops_device_periods').map(c => [c.args.p_person, c.args.p_grain]));
    expect(asked).toEqual([['u-jack', 'month']]);

    // Open September: every metric, then the way into its days.
    await first.locator('.pday-head').click();
    await expect(first.locator('.pstat')).toHaveCount(20);
    await first.locator('[data-drill]').click();
    await expect(page.locator('#biz-phone .pcrumb')).toHaveText('Sep 2026');
    await expect(page.locator('#biz-phone .pseg-b.on')).toHaveCount(0);
    await expect(page.locator('#biz-phone .phone-cols span').first()).toHaveText('Day');
    const days = await page.evaluate(() => window.__dev.filter(c => c.fn === 'ops_device_days').map(c => c.args).pop());
    expect(days).toEqual({ p_person: 'u-jack', p_from: '2026-09-01', p_to: '2026-09-30' });

    // And back to the months, where it was.
    await page.locator('#biz-phone [data-back]').click();
    await expect(page.locator('#biz-phone .pseg-b.on')).toHaveText('Months');
    await expect(page.locator('#biz-phone .pday').first().locator('.pstat')).toHaveCount(20);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('the month still running is marked as so far, and a month of GPS reads in hours', async ({ browser }) => {
    const periods = { month: [per('CUR', 1, { drain_hr: 2.5, gps_min: 120 }), per('2026-05-01', 22, { drain_hr: 6.1, gps_min: 9840 }),
                              per('2026-04-01', 21, { drain_hr: 5.2 })], year: [] };
    const { ctx, page } = await boot(browser, { periods });
    await openBiz(page);
    await page.locator('#biz-phone [data-grain="month"]').click();
    await expect(page.locator('#biz-phone .ptrend .batt.live')).toHaveCount(1);
    await expect(page.locator('#biz-phone .ptrend')).toContainText('so far');
    await expect(page.locator('#biz-phone .ptrend polyline.batt'), 'the finished months stay one solid line').toHaveCount(1);
    await expect(page.locator('#biz-phone .pday').nth(1).locator('.pday-v').nth(2), 'whole hours in the narrow row').toHaveText('164h');
    await page.locator('#biz-phone .pday-head').nth(1).click();
    await expect(page.locator('#biz-phone .pstat', { hasText: 'GPS on' })).toContainText('164h');
    await expect(page.locator('#biz-phone')).not.toContainText('6.8 days');
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('a year opens into its months, and back', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await page.locator('#biz-phone [data-grain="year"]').click();
    await expect(page.locator('#biz-phone .pday')).toHaveCount(1);
    await expect(page.locator('#biz-phone .pday')).toContainText('2026');
    await expect(page.locator('#biz-phone .pday')).toContainText('66 days');
    await expect(page.locator('#biz-phone .ptrend'), 'one point is not a trend').toHaveCount(0);
    await page.locator('#biz-phone .pday-head').click();
    await page.locator('#biz-phone [data-drill]').click();
    await expect(page.locator('#biz-phone .pcrumb')).toHaveText('2026');
    await expect(page.locator('#biz-phone .phone-cols span').first()).toHaveText('Month');
    const last = await page.evaluate(() => window.__dev.filter(c => c.fn === 'ops_device_periods').map(c => c.args).pop());
    expect(last.p_grain).toBe('month');
    expect(last.p_from).toBe('2026-01-01');
    await page.locator('#biz-phone [data-back]').click();
    await expect(page.locator('#biz-phone .pseg-b.on')).toHaveText('Years');
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('switching person keeps the grouping but drops the drill-down', async ({ browser }) => {
    const { ctx, page } = await boot(browser);
    await openBiz(page);
    await page.locator('#biz-phone [data-grain="month"]').click();
    await page.locator('#biz-phone .pday-head').first().click();
    await page.locator('#biz-phone [data-drill]').click();
    await expect(page.locator('#biz-phone .pcrumb')).toHaveCount(1);
    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    await expect(page.locator('#biz-phone .pcrumb')).toHaveCount(0);
    await expect(page.locator('#biz-phone .pseg-b.on')).toHaveText('Months');
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('no bleed at 390 in the month view', async ({ browser }) => {
    const { ctx, page } = await boot(browser, {}, { width: 390, height: 844 });
    await openBiz(page);
    await page.locator('#biz-phone [data-grain="month"]').click();
    await page.locator('#biz-phone .pday-head').first().click();
    await expect(page.locator('#biz-phone .ptrend svg')).toBeVisible();
    const m = await page.evaluate(() => {
      const right = [...document.querySelectorAll('#biz-phone *')].reduce((r, el) => Math.max(r, el.getBoundingClientRect().right), 0);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, right };
    });
    expect(m.sw).toBeLessThanOrEqual(m.iw + 1);
    expect(m.right).toBeLessThanOrEqual(m.iw + 1);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });

  test('no bleed at 390 with a day open', async ({ browser }) => {
    const { ctx, page } = await boot(browser, {}, { width: 390, height: 844 });
    await openBiz(page);
    await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
    await page.locator('#biz-phone .pday-head').first().click();
    await expect(page.locator('#biz-phone svg.hours')).toBeVisible();
    const m = await page.evaluate(() => {
      const right = [...document.querySelectorAll('#biz-phone *')].reduce((r, el) => Math.max(r, el.getBoundingClientRect().right), 0);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, right };
    });
    expect(m.sw).toBeLessThanOrEqual(m.iw + 1);
    expect(m.right).toBeLessThanOrEqual(m.iw + 1);
    assertNoErrors(page, 'ops phone');
    await ctx.close();
  });
});
