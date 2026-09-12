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
const SUMMARY = { days: 30, people: 3, accounts: 2, active_days: 40, days_clocked: 22, avg_day_min: 480, total_miles: 512.4, avg_visit_min: 63, unnamed_legs: 4 };

// The page builds its client the moment the vendor script defines window.supabase.
// Intercepting that assignment is the only seam that exists before boot runs, and
// it keeps the stub inside this spec instead of in shared helpers (§10.3).
function stubRpc(page, { roster = ROSTER, summary = SUMMARY, by = BY } = {}) {
  return page.addInitScript(({ roster, summary, by }) => {
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
              return realRpc(fn, args);
            };
            return c;
          }
        };
      }
    });
  }, { roster, summary, by });
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
      await expect(page.locator('#biz-tiles .tile').first()).toBeVisible();
      // Back returns to the trade you came through, not the top.
      await page.locator('#biz-back').click();
      await expect(page.locator('#lvl-trade')).toBeVisible();
      await page.locator('#trade-back').click();
    });

    test('the activity tiles read from ops_summary', async () => {
      await expect(page.locator('#tiles .tile').first()).toBeVisible();
      await expect(page.locator('#tiles')).toContainText('512.4');
      await expect(page.locator('#tiles')).toContainText('Businesses');
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
