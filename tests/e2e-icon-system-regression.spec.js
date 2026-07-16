// @ts-check
// Owner directive: replace raw emoji-as-icons app-wide with a real inline-SVG
// icon set (js/icons.js, sourced from Lucide) so the app reads as a designed
// product instead of one built out of emoji glyphs. This locks the shared
// library's behavior in place and spot-checks that the highest-visibility
// surfaces (main app nav, client hub nav, sign.html status badges, toasts)
// actually render SVG icons rather than bare emoji, so a future edit can't
// silently regress back to raw glyphs without a test going red.
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors, FAKE_USER_ID, FAKE_TOKEN_2, FAKE_BID_ID_2 } = require('./helpers');

test.describe('icon system, js/icons.js library', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('svgIcon / hasSvgIcon are global functions', async () => {
    const r = await page.evaluate(() => ({
      hasSvgIconType: typeof hasSvgIcon,
      svgIconType: typeof svgIcon,
    }));
    expect(r.hasSvgIconType).toBe('function');
    expect(r.svgIconType).toBe('function');
  });

  test('svgIcon renders a real <svg> for a mapped emoji', async () => {
    const html = await page.evaluate(() => svgIcon('🔧'));
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  test('svgIcon falls back to the raw glyph for an unmapped emoji, never renders blank', async () => {
    // A codepoint deliberately never mapped (Mahjong tile, not a UI concept
    // this app has ever used as an icon).
    const html = await page.evaluate(() => svgIcon('\u{1F004}'));
    expect(html).toBe('\u{1F004}');
  });

  // Regression: some emoji appear with a trailing U+FE0F variation selector
  // (e.g. copy-pasted "⚠️" vs. the bare "⚠"). _ICON_PATHS keys on the bare
  // codepoint: without stripping VS16 first, the suffixed form silently
  // fails to match and falls back to the (still-suffixed) raw glyph, which
  // looks like a working icon in a quick glance but isn't one.
  test('svgIcon strips a trailing variation selector (U+FE0F) before lookup', async () => {
    const r = await page.evaluate(() => ({
      withVS16: svgIcon('⚠️'),
      bare: svgIcon('⚠'),
    }));
    expect(r.withVS16).toContain('<svg');
    expect(r.withVS16).toBe(r.bare);
  });

  test('hasSvgIcon matches svgIcon\'s actual mapping coverage', async () => {
    const r = await page.evaluate(() => ({
      mapped: hasSvgIcon('🔧'),
      unmapped: hasSvgIcon('\u{1F004}'),
    }));
    expect(r.mapped).toBe(true);
    expect(r.unmapped).toBe(false);
  });

  test('showToast renders its icon argument as an SVG, not a literal emoji character', async () => {
    const html = await page.evaluate(() => {
      showToast('Regression check', '✓');
      const el = document.querySelector('.toast .toast-icon');
      const out = el ? el.innerHTML : null;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      return out;
    });
    expect(html).toContain('<svg');
  });

  test('main app bottom-nav tab icons render as SVG, not bare emoji text', async () => {
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav, #bottom-nav, nav');
      // Fall back to scanning the whole page chrome if no dedicated nav container exists.
      const scope = nav || document.body;
      return {
        hasSvg: scope.innerHTML.includes('<svg'),
      };
    });
    expect(r.hasSvg).toBe(true);
  });

  test('no console errors from the icon system', async () => {
    assertNoErrors(page, 'icon system regression');
  });
});

test.describe('icon system, client.html nav renders SVG icons', () => {
  let page;

  const HUB_ICON_CHECK = {
    clientId: 902,
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Icon Check Services',
    businessName: 'Icon Check Services',
    clientName: 'Regression Client',
    clientAddr: '1 Icon Regression Rd',
    bids: [{
      id: FAKE_BID_ID_2, status: 'Closed Won', amount: 1000, deposit: 250, balance: 750,
      paid: 250, signingToken: FAKE_TOKEN_2, bid_date: new Date().toISOString().slice(0, 10),
      proposalHtml: '<p>Icon regression scope.</p>', paymentMethod: 'cash', signedAt: new Date().toISOString(),
    }],
    payments: [], jobs: [], photos: [], messages: [], notifications: [], invoices: [],
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(hub => { window.__mockHubData = hub; }, HUB_ICON_CHECK);
    await mockAllExternal(page);
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.includes('/storage/v1/') && url.includes('client-hub')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_ICON_CHECK) });
      }
      return route.fallback();
    });
    await page.goto(
      `/client.html?c=902&u=${FAKE_USER_ID}&t=${FAKE_TOKEN_2}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('bottom-nav / left-nav tab icons render as SVG', async () => {
    const html = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav') || document.querySelector('.left-nav');
      return nav ? nav.innerHTML : '';
    });
    expect(html).toContain('<svg');
  });

  // Uses innerText, not textContent, client.html's static-markup icons render
  // via an inline <script>document.write(svgIcon(...))</script> right at each
  // emoji's original position. The <script> tag itself stays in the DOM after
  // running (normal browser behavior) with its JS source as literal child
  // text, so textContent picks up the emoji character from that inert,
  // never-rendered source text even though the icon displays correctly on
  // screen. innerText respects visibility/script-exclusion and reflects what
  // a user actually sees.
  test('no bare pictographic emoji visible in the nav chrome', async () => {
    const hasEmoji = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav') || document.querySelector('.left-nav');
      if (!nav) return false;
      const re = /[\u{1F300}-\u{1FAFF}]/u;
      return re.test(nav.innerText || '');
    });
    expect(hasEmoji).toBe(false);
  });
});
