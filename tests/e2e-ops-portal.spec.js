// @ts-check
// ── ops.html: the internal ops portal, with the support view embedded ──
//
// Owner 2026-09-12: "I want it embedded in the ops portal html." So the portal
// is the way in, and the app runs in a frame under one bar of chrome: who you
// are looking at, the other people on that account, and the way out.
//
// Pinned here:
//   1. Signed out shows the gate, an empty roster shows the denial. The RPC
//      returning zero rows IS the denial (it does that for anyone off the ops
//      allowlist), so the page must read it as one and not as an error.
//   2. The roster groups by business and lists every person on it.
//   3. Picking a person opens the frame at that person's URL, and the chrome
//      names them.
//   4. Switching people repaints the chrome without reopening the frame.
//   5. Exit and Escape both close it and blank the frame.
//   6. No horizontal bleed at 390 (§15.3).
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const ROSTER = [
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: 'plumbing,hvac', person_user_id: 'u-logan', person_name: 'Logan Sample', person_email: 'l@x.com', role: 'owner', permissions: {}, active: true },
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing', trade_lines: 'plumbing,hvac', person_user_id: 'u-jack', person_name: 'Jack Rivera', person_email: 'j@x.com', role: 'crew', permissions: { estimate: true }, active: true },
  { contractor_user_id: 'biz-b', business: 'Zach Painting', trade: 'painting', trade_lines: null, person_user_id: 'u-zach', person_name: 'Zach Miller', person_email: 'z@x.com', role: 'owner', permissions: {}, active: true },
  { contractor_user_id: 'biz-c', business: 'Rivera Plumbing', trade: 'plumbing', trade_lines: null, person_user_id: 'u-marco', person_name: 'Marco Rivera', person_email: 'm@x.com', role: 'owner', permissions: {}, active: true },
];
// ops_by_contractor drives the "top user to least" order and each row's number.
const BY = [
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', people: 2, active_days: 22, days_clocked: 18, avg_day_min: 500, total_miles: 900.55, visits: 30, avg_visit_min: 70, unnamed_legs: 2, last_active: new Date().toISOString().slice(0, 10) },
  { contractor_user_id: 'biz-c', business: 'Rivera Plumbing', people: 1, active_days: 3, days_clocked: 2, avg_day_min: 300, total_miles: 40, visits: 4, avg_visit_min: 50, unnamed_legs: 0, last_active: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) },
  { contractor_user_id: 'biz-b', business: 'Zach Painting', people: 1, active_days: 11, days_clocked: 9, avg_day_min: 420, total_miles: 210, visits: 12, avg_visit_min: 61, unnamed_legs: 1, last_active: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10) },
];
// ops_account_brief is the one call the business page (and any agent) reads for
// everything about a single account, so the stub carries every section it paints.
const BRIEF = {
  contractor_user_id: 'biz-a', business: 'Sample Plumbing', trade: 'plumbing',
  range: { from: '2026-08-14', to: '2026-09-13', days: 31 },
  work: { people: 2, crew: 1, active_days: 22, days_clocked: 18, avg_day_min: 500, total_miles: 900.55, visits: 30, avg_visit_min: 70, unnamed_legs: 2, last_active: '2026-09-13' },
  usage: { sessions: 88, active_days: 22, page_views: 640, clicks: 1900, avg_session_min: 7.4, avg_screens: 7.3, clicks_per_session: 21.6, last_version: '09.13.26.2', last_seen: '2026-09-13T15:00:00Z' },
  funnel: { leads: 40, bids_sent: 31, sent_opened: 26, sent_signed: 14, signed_total: 14, signed_paid: 9, open_rate: 83.9, close_rate: 45.2, signed_value: 92400, avg_ticket: 6600 },
  money: { signed_count: 14, signed_value: 92400, avg_ticket: 6600, median_ticket: 5200, deposits: 18000, stripe_fees: 812.44, paid_count: 9, pending_count: 5, declined: 1, cancelled: 0, by_cash: 2, by_check: 3, by_card: 9 },
  // The page renders whatever `sections` contains: this is the shape
  // ops_metric_defs produces, and the spec below proves an UNKNOWN metric added
  // to it still renders, which is the whole point of the indirection.
  sections: [
    { key: 'work', label: 'Work', sort: '001', metrics: [
      { key: 'people', label: 'People', fmt: 'int', value: 2 },
      { key: 'avg_day_min', label: 'Average day', fmt: 'hours', value: 500 },
      { key: 'total_miles', label: 'Miles', fmt: 'num', value: 900.55 },
    ] },
    { key: 'funnel', label: 'Proposals', sort: '002', metrics: [
      { key: 'bids_sent', label: 'Proposals sent', fmt: 'int', value: 31 },
      { key: 'open_rate', label: 'Open rate', fmt: 'pct', value: 83.9 },
      { key: 'close_rate', label: 'Close rate', fmt: 'pct', value: 45.2 },
      { key: 'signed_value', label: 'Signed value', fmt: 'usd', value: 92400 },
    ] },
    { key: 'money', label: 'Money', sort: '003', metrics: [
      { key: 'median_ticket', label: 'Median ticket', fmt: 'usd', value: 5200 },
      { key: 'pending_count', label: 'Awaiting payment', fmt: 'int', value: 5 },
    ] },
    { key: 'usage', label: 'App usage', sort: '004', metrics: [
      { key: 'clicks_per_session', label: 'Taps per session', fmt: 'num', value: 21.6 },
      { key: 'last_version', label: 'Version', fmt: 'text', value: '09.13.26.2' },
      { key: 'never_computed', label: 'Not measured yet', fmt: 'int', value: null },
    ] },
  ],
  timing: [
    { stage: 'lead to proposal', n: 22, median_min: 190, p25_min: 60, p75_min: 1440 },
    { stage: 'writing the proposal', n: 22, median_min: 34, p25_min: 18, p75_min: 70 },
    { stage: 'saved to sent', n: 31, median_min: 12, p25_min: 3, p75_min: 300 },
    { stage: 'sent to opened', n: 26, median_min: 46, p25_min: 9, p75_min: 400 },
    { stage: 'opened to signed', n: 14, median_min: 2880, p25_min: 300, p75_min: 8000 },
    { stage: 'signed to paid', n: 9, median_min: 4320, p25_min: 1440, p75_min: 10080 },
  ],
};
// ops_live_status. Four lights, one per person, so the spec can prove each
// class renders and that red never appears without its evidence.
const LIVE = [
  { person_user_id: 'u-logan', state: 'active', presence: 'foreground', detail: null,
    last_open: '2026-09-13T14:30:00Z', last_bg: null, last_terminate: null, quiet_min: 0 },
  { person_user_id: 'u-jack', state: 'background', presence: 'background', detail: null,
    last_open: '2026-09-13T12:05:00Z', last_bg: '2026-09-13T12:40:00Z', last_terminate: null, quiet_min: 12 },
];
const SUMMARY = { days: 30, people: 3, accounts: 2, active_days: 40, days_clocked: 22, avg_day_min: 480, total_miles: 512.4, avg_visit_min: 63, unnamed_legs: 4 };

// The page builds its client the moment the vendor script defines window.supabase.
// Intercepting that assignment is the only seam that exists before boot runs, and
// it keeps the stub inside this spec instead of in shared helpers (§10.3).
function stubRpc(page, { roster = ROSTER, summary = SUMMARY, by = BY, brief = BRIEF, live = LIVE, invoke = null } = {}) {
  return page.addInitScript(({ roster, summary, by, brief, live, invoke }) => {
    // Every functions.invoke the page makes, recorded, so a test can assert
    // WHAT it asked for as well as what it did with the answer. The reply is
    // whatever `invoke` names for that function, defaulting to a plain success.
    window.__invoked = [];
    let held;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return held; },
      set(v) {
        held = {
          createClient: (u, k, o) => {
            const c = v.createClient(u, k, o);
            const realRpc = c.rpc.bind(c);
            c.rpc = (fn, args) => {
              if (fn === 'ops_view_roster') return Promise.resolve({ data: roster, error: null });
              if (fn === 'ops_summary') return Promise.resolve({ data: [summary], error: null });
              if (fn === 'ops_by_contractor') return Promise.resolve({ data: by, error: null });
              if (fn === 'ops_account_brief') return Promise.resolve({ data: brief, error: null });
              if (fn === 'ops_live_status') return Promise.resolve({ data: live, error: null });
              return realRpc(fn, args);
            };
            c.functions = {
              invoke: (fn, opts) => {
                window.__invoked.push({ fn, body: (opts || {}).body || null });
                // Read at CALL time, not at setup time, so a test can change
                // the answer between clicks without rebooting the page.
                const r = (window.__invokeReply && window.__invokeReply[fn]) || (invoke && invoke[fn]);
                if (r && r.throw) return Promise.reject(new Error(r.throw));
                return Promise.resolve(r || { data: { ok: true, days: [{ day: '2026-09-14', wrote: true, time: 9, shop: 3, miles: 5, sweep: true }] }, error: null });
              }
            };
            return c;
          }
        };
      }
    });
  }, { roster, summary, by, brief, live, invoke });
}

test.describe('Ops portal: the support view, embedded', () => {

  test('signed out shows the gate, not the roster', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await page.addInitScript(() => { window.__noSession = true; });
    await stubRpc(page);
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gate')).toBeVisible();
    await expect(page.locator('#main')).toBeHidden();
    await ctx.close();
  });

  test('an empty roster is a denial, not an error', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await stubRpc(page, { roster: [] });
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#denied')).toBeVisible();
    await expect(page.locator('#main')).toBeHidden();
    await ctx.close();
  });

  test('a roster that ERRORS says so, and does not claim you lack permission', async ({ browser }) => {
    // These were one card, which sent you hunting for a permissions problem when
    // the network was at fault. Empty means not on the allowlist; an error is an
    // error.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await page.addInitScript(() => {
      let held;
      Object.defineProperty(window, 'supabase', {
        configurable: true,
        get() { return held; },
        set(v) {
          held = { createClient: (u, k, o) => {
            const c = v.createClient(u, k, o);
            c.rpc = (fn) => fn === 'ops_view_roster'
              ? Promise.resolve({ data: null, error: { message: 'network is down' } })
              : Promise.resolve({ data: null, error: null });
            return c;
          } };
        }
      });
    });
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#denied')).toBeVisible();
    await expect(page.locator('#denied')).toContainText('Could not load');
    await expect(page.locator('#denied')).toContainText('network is down');
    await expect(page.locator('#denied')).not.toContainText('not on the ops allowlist');
    await ctx.close();
  });

  test('four hundred businesses: pages instead of rendering them all', async ({ browser }) => {
    const many = [], byMany = [];
    const trades = ['plumbing', 'electrical', 'hvac', 'painting'];
    for (let i = 0; i < 400; i++) {
      const id = 'biz-' + i, trade = trades[i % trades.length];
      many.push({ contractor_user_id: id, business: 'Business ' + i, trade, trade_lines: null, person_user_id: id + '-o', person_name: 'Owner ' + i, person_email: 'o' + i + '@x.com', role: 'owner', permissions: {}, active: true });
      many.push({ contractor_user_id: id, business: 'Business ' + i, trade, trade_lines: null, person_user_id: id + '-c', person_name: 'Crew ' + i, person_email: 'c' + i + '@x.com', role: 'crew', permissions: {}, active: true });
      byMany.push({ contractor_user_id: id, business: 'Business ' + i, people: 2, active_days: i % 30, total_miles: i, last_active: '2026-09-01' });
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await stubRpc(page, { roster: many, by: byMany });
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#trades .row').first().waitFor();

    // Four trades over 400 businesses: the top level is four rows, whatever the
    // account count does.
    await expect(page.locator('#trades .row')).toHaveCount(4);
    await expect(page.locator('#count')).toContainText('4 trades, 400 businesses, 800 people');

    // Inside a trade, 100 businesses page 40 at a time.
    await page.locator('#trades .row').first().click();
    expect(await page.locator('#trade-biz .row').count()).toBe(40);
    await expect(page.locator('#trade-more')).toBeVisible();
    await page.locator('#trade-more').click();
    expect(await page.locator('#trade-biz .row').count()).toBe(80);
    await page.locator('#trade-back').click();

    // Search reaches every account without any of them being rendered.
    await page.locator('#q').fill('Business 399');
    await expect(page.locator('#results .row')).toHaveCount(1);
    await page.locator('#q').fill('Crew 250');
    await expect(page.locator('#results .row')).toHaveCount(1);
    await expect(page.locator('#results .row')).toContainText('Business 250');
    await ctx.close();
  });

  test.describe('with a roster', () => {
    let ctx, page;

    test.beforeAll(async ({ browser }) => {
      ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
      page = await ctx.newPage();
      await mockAllExternal(page);
      await stubRpc(page);
      await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await page.locator('#trades .row').first().waitFor();
    });

    test.afterAll(async () => { await ctx.close(); });

    test('the top level is trades, with how many businesses in each', async () => {
      // Two trades over three businesses. Plumbing has two, so it sorts first.
      await expect(page.locator('#trades .row')).toHaveCount(2);
      await expect(page.locator('#count')).toContainText('2 trades, 3 businesses, 4 people');
      const first = page.locator('#trades .row').first();
      await expect(first).toContainText('Plumbing');
      await expect(first).toContainText('2businesses');
      await expect(page.locator('#trades .row').nth(1)).toContainText('Painting');
    });

    test('a trade opens its businesses, hardest user first', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await expect(page.locator('#lvl-trade')).toBeVisible();
      await expect(page.locator('#trade-name')).toHaveText('Plumbing');
      await expect(page.locator('#trade-biz .row')).toHaveCount(2);
      // 22 days used beats 3, so Sample leads by default.
      await expect(page.locator('#trade-biz .row').first()).toContainText('Sample Plumbing');
      await expect(page.locator('#trade-biz .row').first()).toContainText('22days used');

      // Flip it: least active first.
      await page.locator('#sort').selectOption('active-asc');
      await expect(page.locator('#trade-biz .row').first()).toContainText('Rivera Plumbing');

      await page.locator('#sort').selectOption('active-desc');
      await page.locator('#trade-back').click();
      await expect(page.locator('#lvl-all')).toBeVisible();
    });

    test('a trade never shows another trade\'s businesses', async () => {
      await page.locator('#trades .row', { hasText: 'Painting' }).click();
      await expect(page.locator('#trade-biz .row')).toHaveCount(1);
      await expect(page.locator('#trade-biz')).toContainText('Zach Painting');
      await expect(page.locator('#trade-biz')).not.toContainText('Plumbing');
      await page.locator('#trade-back').click();
    });

    test('search cuts straight past the trades to a person', async () => {
      await page.locator('#q').fill('jack');
      await expect(page.locator('#trades')).toBeHidden();
      await expect(page.locator('#results .row')).toHaveCount(1);
      await expect(page.locator('#results .row')).toContainText('Jack Rivera');
      await expect(page.locator('#results .row .kind')).toHaveText('Person');
      await expect(page.locator('#count')).toContainText('1 match');
      await page.locator('#q').fill('');
      await expect(page.locator('#trades')).toBeVisible();
    });

    test('searching a business matches the business, and names its trade', async () => {
      await page.locator('#q').fill('sample');
      await expect(page.locator('#results .row')).toHaveCount(1);
      await expect(page.locator('#results .row .kind')).toHaveCount(0);
      await expect(page.locator('#results .row')).toContainText('Plumbing');
      await page.locator('#q').fill('');
    });

    test('a search that matches nothing says so', async () => {
      await page.locator('#q').fill('zzzz');
      await expect(page.locator('#results')).toContainText('Nothing matches');
      await page.locator('#q').fill('');
    });

    test('a business shows its trade, its numbers and its people', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await expect(page.locator('#lvl-biz')).toBeVisible();
      await expect(page.locator('#biz-name')).toHaveText('Sample Plumbing');
      await expect(page.locator('#biz-sub')).toContainText('Plumbing');
      await expect(page.locator('#biz-sub')).toContainText('plumbing,hvac');   // multi-trade shop
      await expect(page.locator('#biz-people .row')).toHaveCount(2);
      await expect(page.locator('#biz-sections .tile').first()).toBeVisible();
      // Back returns to the trade you came through, not the top.
      await page.locator('#biz-back').click();
      await expect(page.locator('#lvl-trade')).toBeVisible();
      await page.locator('#trade-back').click();
    });

    test('the way into their app sits above every number, on the owner by default', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      // The open button is the first interactive thing under the title, above
      // the metrics: clicking in to see their screen is the point of the page.
      const openBox = await page.locator('#biz-open').boundingBox();
      const tileBox = await page.locator('#biz-sections .tile').first().boundingBox();
      expect(openBox.y).toBeLessThan(tileBox.y);
      // One chip per person, the owner pre-selected.
      await expect(page.locator('#biz-chips .chip')).toHaveCount(2);
      await expect(page.locator('#biz-chips .chip.on')).toHaveText('Logan');
      await page.locator('#biz-open').click();
      await expect(page.locator('#view')).toHaveClass(/on/);
      expect(await page.locator('#view-frame').getAttribute('src')).toContain('p=u-logan');
      await page.locator('#view-exit').click();
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    // ── Rebuild a day (owner 2026-09-15) ──────────────────────────────────
    // The server derives on every flush, but only for the days the incoming
    // events are stamped with, so a day that is already wrong is never handed
    // back to it. This is the door: run the deriver again for one person, one
    // day, from here, instead of waiting on that person to open the app.
    test.describe('rebuilding a day', () => {
      test.beforeEach(async () => {
        await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
        await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
        await page.evaluate(() => { window.__invoked = []; window.__invokeReply = null; });
      });
      test.afterEach(async () => {
        await page.locator('#biz-back').click();
        await page.locator('#trade-back').click();
      });

      test('it rebuilds the person the chips have selected, on the day you picked', async () => {
        await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
        await page.locator('#rb-day').fill('2026-09-14');
        await page.locator('#rb-go').click();
        await expect(page.locator('#rb-out')).toContainText('Rebuilt');
        const calls = await page.evaluate(() => window.__invoked);
        expect(calls).toHaveLength(1);
        expect(calls[0].fn).toBe('rebuild-day');
        // The person from the chips, the business from the page, the day from
        // the field. Nothing here invents an id.
        expect(calls[0].body).toEqual({
          contractor_user_id: 'biz-a', employee_user_id: 'u-jack', day: '2026-09-14',
        });
      });

      test('the day defaults to the business day, not this browser\'s', async () => {
        const want = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago',
          year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        await expect(page.locator('#rb-day')).toHaveValue(want);
      });

      test('a rebuild that could not sweep says so instead of claiming it cleaned up', async () => {
        // The difference is the whole reason for pressing it, so it cannot be
        // reported as the same thing.
        await page.evaluate(() => { window.__invokeReply = { 'rebuild-day':
          { data: { ok: true, days: [{ day: '2026-09-14', wrote: true, time: 9, shop: 3, miles: 5, sweep: false }] }, error: null } }; });
        await page.locator('#rb-day').fill('2026-09-14');
        await page.locator('#rb-go').click();
        await expect(page.locator('#rb-out')).toContainText('Nothing retired');
      });

      test('no day picked is a message, not a call', async () => {
        await page.locator('#rb-day').fill('');
        await page.locator('#rb-go').click();
        await expect(page.locator('#rb-out')).toContainText('Pick a day');
        expect(await page.evaluate(() => window.__invoked)).toHaveLength(0);
      });

      test('a refusal from the function is shown, never swallowed as success', async () => {
        await page.evaluate(() => { window.__invokeReply = { 'rebuild-day':
          { data: { ok: false, error: 'not an ops admin' }, error: null } }; });
        await page.locator('#rb-day').fill('2026-09-14');
        await page.locator('#rb-go').click();
        await expect(page.locator('#rb-out')).toContainText('not an ops admin');
        await expect(page.locator('#rb-out')).not.toContainText('Rebuilt');
      });

      test('a day the deriver refused to write is reported with its reason', async () => {
        await page.evaluate(() => { window.__invokeReply = { 'rebuild-day':
          { data: { ok: true, days: [{ day: '2026-09-14', wrote: false, reason: 'no evidence' }] }, error: null } }; });
        await page.locator('#rb-day').fill('2026-09-14');
        await page.locator('#rb-go').click();
        await expect(page.locator('#rb-out')).toContainText('no evidence');
      });

      test('the control does not bleed off a phone', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(w[0]).toBeLessThanOrEqual(w[1] + 1);
        await page.setViewportSize({ width: 1280, height: 800 });
      });
    });

    test('a crew chip opens the app as the crew member, not the owner', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await page.locator('#biz-chips .chip', { hasText: 'Jack' }).click();
      await expect(page.locator('#biz-chips .chip.on')).toHaveText('Jack · crew');
      await page.locator('#biz-open').click();
      expect(await page.locator('#view-frame').getAttribute('src')).toContain('p=u-jack');
      await page.locator('#view-exit').click();
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    test('one call fills every section, in the order the answer names', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await expect(page.locator('#biz-sections .section-title')).toHaveText(
        ['Work', 'Proposals', 'Money', 'App usage']);
      const secs = page.locator('#biz-sections');
      await expect(secs).toContainText('83.9%');        // pct
      await expect(secs).toContainText('45.2%');
      await expect(secs).toContainText('$92,400');      // usd
      await expect(secs).toContainText('$5,200');
      // 10.4: this read '8.3h' until 2026-09-14. Owner: "average visit time is
      // in minutes and can say something like 269 minutes, I want it broken to
      // minutes then hours and minutes if it goes over 60." One formatter now
      // says every duration on the page, so 500 minutes reads the way the app
      // has always said it (_fmtMin, js/jobs.js). Same number, plainer words.
      await expect(secs).toContainText('8h 20m');       // hours, from 500 minutes
      await expect(secs).toContainText('09.13.26.2');   // text
      await expect(secs).toContainText('21.6');         // num
      // Raw floats never reach the page (the 993.5999999999999 lesson).
      await expect(page.locator('#lvl-biz')).not.toContainText('.55999');
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    // The reason the metric list lives in SQL: this metric exists in no branch
    // of this page's code, and it still renders, labelled, in the right place.
    test('a metric the page has never heard of renders anyway', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const idx = await page.evaluate(() => Array.from(
        document.querySelectorAll('#biz-sections .tile-k')).map(e => e.textContent));
      expect(idx).toContain('Not measured yet');
      // A value the brief did not compute reads as a dash, never as a zero:
      // "we did not measure this" and "this is zero" are different answers.
      const tile = page.locator('#biz-sections .tile', { hasText: 'Not measured yet' });
      await expect(tile.locator('.tile-v')).toHaveText('—');
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    test('the four lights: open, background, force closed, nothing', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      // Two people on Sample Plumbing; a third state and a fourth need their own
      // rows, so this stub answers for both and omits nobody.
      await stubRpc(p2, { live: [
        { person_user_id: 'u-logan', state: 'closed', presence: 'force-closed', quiet_min: 187,
          detail: 'App reported its own termination after the last push it answered.',
          last_open: '2026-09-12T13:02:00Z', last_bg: '2026-09-12T16:48:00Z', last_terminate: '2026-09-12T16:48:00Z' },
        { person_user_id: 'u-jack', state: 'active', presence: 'foreground', quiet_min: 0,
          last_open: '2026-09-13T14:59:00Z', last_bg: null, last_terminate: null },
      ] });
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const logan = p2.locator('#biz-people .row', { hasText: 'Logan Sample' });
      const jack  = p2.locator('#biz-people .row', { hasText: 'Jack Rivera' });
      await expect(logan.locator('.dot')).toHaveClass(/dot-closed/);
      await expect(jack.locator('.dot')).toHaveClass(/dot-active/);
      // Red never travels alone: the row says how long it has been quiet,
      // because a force quit leaves no event and the time IS the evidence.
      await expect(logan).toContainText('Force closed');
      // Owner 2026-09-13: a red light has to carry BOTH edges, dated, because
      // that pair is the whole account of the session that ended.
      await expect(logan).toContainText(/opened \w{3} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)/);
      await expect(logan).toContainText(/backgrounded \w{3} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)/);
      await expect(logan).toContainText('quiet 3.1h');
      await expect(jack).toContainText('Open now');
      // The chips carry the same light.
      await expect(p2.locator('#biz-chips .chip', { hasText: 'Logan' }).locator('.dot')).toHaveClass(/dot-closed/);
      await c.close();
    });

    // app_presence separates these two and the portal must not flatten them: a
    // phone still writing its own fixes is RUNNING, and a missing silent push
    // there is a delivery problem, not somebody closing the app.
    test('push-blocked is amber and says it is still running, not backgrounded', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      await stubRpc(p2, { live: [
        { person_user_id: 'u-logan', state: 'background', presence: 'push-blocked', quiet_min: 50,
          detail: 'Device is still writing on its own but is not taking silent pushes. Check Background App Refresh and Low Power Mode, not the user.',
          last_open: '2026-09-13T12:05:00Z', last_bg: '2026-09-13T12:40:00Z', last_terminate: null },
      ] });
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const logan = p2.locator('#biz-people .row', { hasText: 'Logan Sample' });
      await expect(logan.locator('.dot')).toHaveClass(/dot-background/);
      await expect(logan).toContainText('Running, not taking pushes');
      await expect(logan).not.toContainText('In the background');
      // The whole explanation is carried, not summarised away.
      await expect(logan.locator('.row-live')).toHaveAttribute('title', /Background App Refresh/);
      await c.close();
    });

    // The two states where silence is not evidence of anything. Neither may
    // ever go red, or the red light stops meaning what it says.
    test('a dead ping cron and a missing push token are grey, never red', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      await stubRpc(p2, { live: [
        { person_user_id: 'u-logan', state: 'unknown', presence: 'unknown-cron-down', quiet_min: 900,
          detail: 'The geo-ping cron has not run recently.', last_open: null, last_bg: null },
        { person_user_id: 'u-jack', state: 'unknown', presence: 'no-push-token', quiet_min: null,
          detail: 'No registered device token.', last_open: null, last_bg: null },
      ] });
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const logan = p2.locator('#biz-people .row', { hasText: 'Logan Sample' });
      const jack  = p2.locator('#biz-people .row', { hasText: 'Jack Rivera' });
      await expect(logan.locator('.dot')).toHaveClass(/dot-unknown/);
      await expect(jack.locator('.dot')).toHaveClass(/dot-unknown/);
      await expect(logan).toContainText('Ping cron is down');
      await expect(logan).toContainText('silence proves nothing');
      await expect(jack).toContainText('No push token');
      await c.close();
    });

    test('a person the live call says nothing about stays grey, not green', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      await stubRpc(p2, { live: [] });
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await expect(p2.locator('#biz-people .row').first().locator('.dot')).toHaveClass(/dot-unknown/);
      await expect(p2.locator('#biz-people .row').first()).not.toContainText('Open now');
      await c.close();
    });

    test('backgrounded is amber and says so', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const jack = page.locator('#biz-people .row', { hasText: 'Jack Rivera' });
      await expect(jack.locator('.dot')).toHaveClass(/dot-background/);
      await expect(jack).toContainText('In the background');
      // Backgrounded needs the last time they actually had it open.
      await expect(jack).toContainText(/opened \w{3} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)/);
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    test('timing names every stage in plain time, longest bar is the slowest step', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const stages = page.locator('#biz-timing .stage');
      await expect(stages).toHaveCount(6);
      // The two stages that were logged but never had a reader.
      await expect(page.locator('#biz-timing')).toContainText('lead to proposal');
      await expect(page.locator('#biz-timing')).toContainText('writing the proposal');
      // 34 minutes reads as minutes, 4320 as days, never as a raw number.
      // '34 min' until 2026-09-14, see the note above: one formatter, one shape.
      await expect(stages.nth(1)).toContainText('34m');
      await expect(stages.nth(5)).toContainText('3 days');
      await expect(stages.nth(0)).toContainText('22 times');
      // Slowest stage owns the full bar; the fastest is a sliver.
      const widths = await page.locator('#biz-timing .stage-bar i').evaluateAll(
        els => els.map(e => e.getBoundingClientRect().width));
      expect(Math.max(...widths)).toBe(widths[5]);
      expect(widths[2]).toBeLessThan(widths[5]);
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    test('the brief copies as the same JSON an agent would read', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      const copied = await page.evaluate(async () => {
        let got = null;
        navigator.clipboard.writeText = async t => { got = t; };
        document.getElementById('biz-copy').click();
        await new Promise(r => setTimeout(r, 40));
        return got;
      });
      const parsed = JSON.parse(copied);
      expect(parsed.business).toBe('Sample Plumbing');
      expect(parsed.funnel.close_rate).toBe(45.2);
      expect(parsed.timing).toHaveLength(6);
      // The agent gets the labels and formats too, not just raw keys.
      expect(parsed.sections[1].metrics.find(m => m.key === 'close_rate'))
        .toMatchObject({ label: 'Close rate', fmt: 'pct', value: 45.2 });
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
    });

    test('a brief that fails says so instead of showing stale numbers', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      await stubRpc(p2, { brief: null });
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await expect(p2.locator('#biz-sections')).toContainText('Could not load');
      await expect(p2.locator('#biz-timing')).toContainText('No answer');
      await c.close();
    });

    test('the activity tiles read from ops_summary', async () => {
      await expect(page.locator('#tiles .tile').first()).toBeVisible();
      await expect(page.locator('#tiles')).toContainText('512.4');
      await expect(page.locator('#tiles')).toContainText('Businesses');
      // Owner 2026-09-14: "average visit time is in minutes and can say
      // something like 269 minutes, I want it broken to minutes then hours and
      // minutes if it goes over 60." 63 minutes is an hour and three, and 480
      // is a flat eight hours with no stray '0m' hanging off it.
      await expect(page.locator('#tiles')).toContainText('1h 3m');   // avg_visit_min 63
      await expect(page.locator('#tiles')).toContainText('8h');      // avg_day_min 480
      // The raw minute count never reaches the screen again.
      await expect(page.locator('#tiles')).not.toContainText('63m');
      await expect(page.locator('#tiles')).not.toContainText('480');
    });

    test('picking a person opens the frame on that person, read only', async () => {
      await page.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      await page.locator('#biz-people .row', { hasText: 'Jack Rivera' }).click();
      await expect(page.locator('#view')).toHaveClass(/on/);
      const src = await page.locator('#view-frame').getAttribute('src');
      expect(src).toContain('index.html?ops=1');
      expect(src).toContain('t=biz-a');
      expect(src).toContain('p=u-jack');
      await expect(page.locator('#view-bar')).toContainText('READ ONLY');
      await expect(page.locator('#view-who')).toContainText('Jack Rivera');
      // The page behind must not scroll under the view.
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    });

    test('the chrome offers every person on that account, and only that account', async () => {
      const chips = page.locator('#view-people button');
      await expect(chips).toHaveCount(2);              // Logan and Jack, never Zach
      await expect(page.locator('#view-people button.on')).toHaveText('Jack');
    });

    test('switching people repaints the chrome without reopening the frame', async () => {
      const before = await page.locator('#view-frame').getAttribute('src');
      await page.locator('#view-people button', { hasText: 'Logan' }).click();
      await expect(page.locator('#view-who')).toContainText('Logan Sample');
      await expect(page.locator('#view-people button.on')).toHaveText('Logan');
      expect(await page.locator('#view-frame').getAttribute('src')).toBe(before);   // same account, no reload
    });

    test('Exit closes the view and blanks the frame', async () => {
      await page.locator('#view-exit').click();
      await expect(page.locator('#view')).not.toHaveClass(/on/);
      await expect.poll(() => page.locator('#view-frame').getAttribute('src')).toBe('about:blank');
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    });

    test('Escape closes it too', async () => {
      await page.locator('#biz-back').click();
      await page.locator('#trade-back').click();
      await page.locator('#trades .row', { hasText: 'Painting' }).click();
      await page.locator('#trade-biz .row', { hasText: 'Zach Painting' }).click();
      await page.locator('#biz-people .row', { hasText: 'Zach Miller' }).click();
      await expect(page.locator('#view')).toHaveClass(/on/);
      await page.keyboard.press('Escape');
      await expect(page.locator('#view')).not.toHaveClass(/on/);
    });

    // Owner 2026-09-13 picked "follow my phone", so BOTH palettes ship and the
    // device chooses. The risk that buys is drift: a colour written straight
    // into a rule looks right in whichever theme it was written for and wrong
    // in the other. So nothing may hold a literal colour but the token blocks.
    test('every colour is a token, so neither theme can be half-styled', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
      const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
      // Strip the two palette blocks: they are the only place a literal belongs.
      const rules = css.replace(/:root\s*\{[\s\S]*?\}/g, '')
                       .replace(/@media \(prefers-color-scheme[\s\S]*?\n\}\n/g, '');
      const literals = (rules.match(/#[0-9A-Fa-f]{3,8}\b/g) || []);
      expect(literals, 'colours outside the palette blocks: ' + literals.join(', ')).toEqual([]);
      // And the palette actually has a dark half.
      expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
      // The browser chrome follows too, or the notch stays the old colour.
      expect(html).toMatch(/theme-color[^>]*prefers-color-scheme: dark/);
    });

    test('the dark palette defines every token the light one does', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
      const names = b => [...b.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
      const light = names(html.slice(html.indexOf(':root{'), html.indexOf('@media (prefers-color-scheme: dark)')));
      const darkBlock = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'));
      const dark = names(darkBlock.slice(0, darkBlock.indexOf('\n}\n')));
      // --bar is a size, not a colour, and is deliberately shared.
      const missing = light.filter(n => n !== '--bar' && !dark.includes(n));
      expect(missing, 'tokens with no dark value: ' + missing.join(', ')).toEqual([]);
    });

    test('the phone\'s setting is what picks, on the real page', async ({ browser }) => {
      const read = async (scheme) => {
        const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true, colorScheme: scheme });
        const p2 = await c.newPage();
        await mockAllExternal(p2);
        await stubRpc(p2);
        await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
        const v = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await c.close();
        return v;
      };
      const light = await read('light'), dark = await read('dark');
      expect(light).not.toBe(dark);
      // Light really is light and dark really is dark, rather than two tints
      // of the same thing that happen to differ.
      const lum = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r + g + b) / 3; };
      expect(lum(light)).toBeGreaterThan(200);
      expect(lum(dark)).toBeLessThan(40);
    });

    test('tiles stay two-up on a phone instead of one long column', async ({ browser }) => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
      const p2 = await c.newPage();
      await mockAllExternal(p2);
      await stubRpc(p2);
      await p2.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await p2.locator('#trades .row', { hasText: 'Plumbing' }).click();
      await p2.locator('#trade-biz .row', { hasText: 'Sample Plumbing' }).click();
      // A 200px cap is a laptop concern; on a phone it halved the columns and
      // doubled the page height. Two tiles must share the first row.
      const tops = await p2.locator('#biz-sections .tiles').first().locator('.tile')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(tops.filter(t => t === tops[0]).length).toBeGreaterThanOrEqual(2);
      await c.close();
    });

    test('no horizontal bleed at 390', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      const bleed = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(bleed).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('there is a way back to your own app that is not signing out', async () => {
      // Sign out was the only exit and it dropped you at a login screen, which
      // is not what "go back" means (owner, on a phone).
      const link = page.locator('#to-app');
      await expect(link).toBeVisible();
      expect(await link.getAttribute('href')).toBe('index.html?app=1');
      // ?app=1 matters: the "/" gate reads a query string as "the app, please",
      // so this cannot land on the marketing page.
      await expect(page.locator('#signout')).toBeVisible();     // still there, just not the only door
    });

    // Owner 2026-09-14, with a screenshot: "the portal view is fucking zoomed in
    // massively and not scaled to mobile." Nothing had reflowed. The tile grid
    // was still two-up and every gap and radius was magnified by one factor, so
    // the page had ZOOMED, and it was scrolled right, which cut the left edge
    // off every row. A double-tap does that, and nothing put it back.
    //
    // This page was the only app-facing screen whose viewport allowed it.
    // The guard is permanent because the symptom is invisible in CI: a page
    // that CAN zoom renders identically to one that cannot, right up until a
    // thumb lands on it (13 step 4).
    test('the page cannot be zoomed, the same way no other app screen can', async () => {
      const vp = await page.evaluate(() =>
        document.querySelector('meta[name=viewport]')?.content || '');
      expect(vp).toContain('width=device-width');
      expect(vp).toContain('maximum-scale=1.0');
      expect(vp).toContain('user-scalable=no');
      // viewport-fit must survive the edit, or the notch test above starts
      // passing for the wrong reason.
      expect(vp).toContain('viewport-fit=cover');
      // The half the viewport tag cannot do: kill double-tap, and stop iOS
      // inflating type. Straight off index.html.
      const t = await page.evaluate(() => ({
        html: getComputedStyle(document.documentElement).touchAction,
        body: getComputedStyle(document.body).touchAction,
        adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
        ox: getComputedStyle(document.body).overflowX,
      }));
      expect(t.html).toBe('pan-y');
      expect(t.body).toBe('pan-y');
      expect(t.ox).toBe('hidden');
    });

    test('the header clears the notch on a phone', async () => {
      // viewport-fit=cover plus a translucent status bar draws the page behind
      // the notch; the wrap has to reserve the inset or the header is cut off.
      const pad = await page.evaluate(() => {
        const el = document.querySelector('.wrap');
        return { top: getComputedStyle(el).paddingTop, css: [...document.styleSheets]
          .flatMap(sh => { try { return [...sh.cssRules].map(r => r.cssText); } catch (e) { return []; } })
          .filter(t => t.includes('.wrap')).join(' ') };
      });
      expect(pad.css).toContain('safe-area-inset-top');
      expect(parseFloat(pad.top)).toBeGreaterThanOrEqual(20);
    });

    test('zero console errors', async () => {
      assertNoErrors(page, 'ops portal');
    });

    // The failure that test caught on 2026-09-12 (shard 3, webkit): the frame
    // threw "Can't find variable: _initMapKit". index.html's MapKit tag called
    // it straight from onload, and the CDN request is stubbed offline, so the
    // load event can beat js/mileage.js to defining it. Static, because the
    // race only shows up on the timing of the day and a guard that only fires
    // when it does is no guard at all.
    test('the MapKit script cannot call into the app before the app exists', () => {
      const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
      const tag = (idx.match(/<script[^>]*apple-mapkit[^>]*><\/script>/) || [])[0];
      expect(tag, 'the MapKit script tag is still there').toBeTruthy();
      expect(tag, 'onload does not call a bare _initMapKit()').not.toMatch(/onload="_initMapKit\(\)"/);
      expect(tag, 'it checks the function exists first').toMatch(/window\._initMapKit/);
      const mil = fs.readFileSync(path.join(__dirname, '..', 'js', 'mileage.js'), 'utf8');
      expect(mil, 'mileage.js honors the flag the onload leaves').toMatch(/__mapkitLoaded/);
    });
  });

  // ── Getting back to it ──────────────────────────────────────────────────────
  // Two ways in, both of which have to keep working: a home-screen icon of its
  // own, and a row inside the app for a device already signed in.

  test('the portal installs as its own icon, not the app\'s', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="ops-manifest.json"');
    expect(html).toContain('apple-touch-icon');
    const mf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ops-manifest.json'), 'utf8'));
    expect(mf.start_url).toBe('/ops.html');
    expect(mf.display).toBe('standalone');
    // A distinct name and icon: the whole point is not confusing it with the app
    // on a home screen while looking at somebody's data.
    expect(mf.short_name).not.toBe('TradeDesk');
    mf.icons.forEach(i => {
      expect(i.src).toContain('/icons/ops-');
      expect(fs.existsSync(path.join(__dirname, '..', i.src.replace(/^\//, '')))).toBe(true);
    });
    // noindex stays: this page is never something search should rank.
    expect(html).toContain('name="robots" content="noindex,nofollow"');
  });

  test('the Settings row appears only when is_ops_admin says yes', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppBoot(page);

    // Default: hidden, and hidden is the state a customer's session lands in.
    expect(await page.locator('#ops-portal-row').isVisible()).toBe(false);

    // The server says no.
    await page.evaluate(async () => {
      const r = _supa.rpc.bind(_supa);
      _supa.rpc = (fn, a) => fn === 'is_ops_admin' ? Promise.resolve({ data: false, error: null }) : r(fn, a);
      goPg('pg-settings');                           // the row lives on the settings page
      _openSetDetail('dev');
      await new Promise(res => setTimeout(res, 250));
    });
    expect(await page.locator('#ops-portal-row').isVisible()).toBe(false);

    // The server says yes.
    await page.evaluate(async () => {
      window._opsAdminAnswer = null;                 // forget the cached no
      const r = _supa.rpc.bind(_supa);
      _supa.rpc = (fn, a) => fn === 'is_ops_admin' ? Promise.resolve({ data: true, error: null }) : r(fn, a);
      goPg('pg-settings');
      _openSetDetail('dev');                         // the panel has to be the open one
      await _opsAdminRow();
      await new Promise(res => setTimeout(res, 100));
    });
    const row = page.locator('#ops-portal-row');
    expect(await row.isVisible()).toBe(true);
    expect(await row.getAttribute('href')).toBe('ops.html');
    assertNoErrors(page, 'ops row in settings');
    await ctx.close();
  });
});
