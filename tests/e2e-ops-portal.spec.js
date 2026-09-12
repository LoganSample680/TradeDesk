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
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', person_user_id: 'u-logan', person_name: 'Logan Sample', person_email: 'l@x.com', role: 'owner', permissions: {}, active: true },
  { contractor_user_id: 'biz-a', business: 'Sample Plumbing', person_user_id: 'u-jack', person_name: 'Jack Rivera', person_email: 'j@x.com', role: 'crew', permissions: { estimate: true }, active: true },
  { contractor_user_id: 'biz-b', business: 'Zach Painting', person_user_id: 'u-zach', person_name: 'Zach Miller', person_email: 'z@x.com', role: 'owner', permissions: {}, active: true },
];
const SUMMARY = { days: 30, people: 3, accounts: 2, active_days: 40, days_clocked: 22, avg_day_min: 480, total_miles: 512.4, avg_visit_min: 63, unnamed_legs: 4 };

// The page builds its client the moment the vendor script defines window.supabase.
// Intercepting that assignment is the only seam that exists before boot runs, and
// it keeps the stub inside this spec instead of in shared helpers (§10.3).
function stubRpc(page, { roster = ROSTER, summary = SUMMARY } = {}) {
  return page.addInitScript(({ roster, summary }) => {
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
              return realRpc(fn, args);
            };
            return c;
          }
        };
      }
    });
  }, { roster, summary });
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

  test.describe('with a roster', () => {
    let ctx, page;

    test.beforeAll(async ({ browser }) => {
      ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
      page = await ctx.newPage();
      await mockAllExternal(page);
      await stubRpc(page);
      await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
      await page.locator('.person').first().waitFor();
    });

    test.afterAll(async () => { await ctx.close(); });

    test('every business and every person on it is listed', async () => {
      await expect(page.locator('.biz')).toHaveCount(2);
      await expect(page.locator('.person')).toHaveCount(3);
      await expect(page.locator('.biz-name').first()).toHaveText('Sample Plumbing');
      await expect(page.locator('.person', { hasText: 'Jack Rivera' })).toHaveCount(1);
    });

    test('the activity tiles read from ops_summary', async () => {
      await expect(page.locator('#tiles .tile').first()).toBeVisible();
      await expect(page.locator('#tiles')).toContainText('512.4');
      await expect(page.locator('#tiles')).toContainText('Businesses');
    });

    test('picking a person opens the frame on that person, read only', async () => {
      await page.locator('.person', { hasText: 'Jack Rivera' }).click();
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
      expect(await page.locator('#view-frame').getAttribute('src')).toBe(before);   // same frame, no reload
    });

    test('Exit closes the view and blanks the frame', async () => {
      await page.locator('#view-exit').click();
      await expect(page.locator('#view')).not.toHaveClass(/on/);
      await expect.poll(() => page.locator('#view-frame').getAttribute('src')).toBe('about:blank');
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    });

    test('Escape closes it too', async () => {
      await page.locator('.person', { hasText: 'Zach Miller' }).click();
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
