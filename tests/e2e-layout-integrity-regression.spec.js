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

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, goPg } = require('./helpers');

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

  // Regression: settings' city/state/zip row used 1fr 60px 80px while the identical
  // control elsewhere in the app (intake.html, client.html) used 1fr 56px 90px — the
  // zip box was a visibly different size from every other zip box in the product.
  // Separately, the phone/email row split 1fr 1fr on mobile, so the (much longer)
  // email address got clipped mid-string on a 390px phone. Fixed: settings now matches
  // the app-wide 56px/90px convention, and phone/email stacks on mobile via .set-form-2col.
  test('settings: zip matches the app-wide city/state/zip proportions, and email never clips on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goPg(page, 'pg-settings'); // navigates + waits for the .pg.active transition to settle
    // Settings is index→detail: pg-settings only shows the category LIST. The
    // actual form fields live in the "Business info" detail sub-view, revealed by
    // _openSetDetail('biz') (adds .active to #setd-biz, hides #set-index-view).
    // Without this the fields are real but 0×0 (parent detail panel hidden) — the
    // root cause of this test's own initial flake.
    await page.evaluate(() => { _openSetDetail('biz'); });
    const r = await page.evaluate(() => {
      const zip = document.getElementById('set-bzip');
      const state = document.getElementById('set-bstate-display');
      const phone = document.getElementById('set-bphone');
      const email = document.getElementById('set-bemail');
      if (!zip || !state || !phone || !email) return { missing: true };
      // The actual reported value (owner's real email, 24 chars) — long enough to
      // clip in the old half-width split, short enough to fit once stacked full-width.
      // A single-line <input> never wraps, so an arbitrarily long stress string would
      // clip at ANY width — that's normal input behavior, not a layout bug.
      email.value = 'logansample97@gmail.com';
      const zr = zip.getBoundingClientRect(), sr = state.getBoundingClientRect();
      const pr = phone.getBoundingClientRect(), er = email.getBoundingClientRect();
      return {
        missing: false,
        detailActive: document.getElementById('setd-biz')?.classList.contains('active') || false,
        zipWiderThanState: zr.width > sr.width,       // 90px > 56px — matches app convention
        stacked: Math.abs(pr.top - er.top) > 5,        // email drops to its own row on mobile
        // Once stacked, phone and email each get the FULL row width (equal to each
        // other) rather than splitting it — email must be within a few px of phone's
        // width, not still constrained to half the row.
        emailFullWidth: Math.abs(er.width - pr.width) <= 2,
        emailMajorityOfViewport: er.width >= window.innerWidth * 0.6,
        emailFitsViewport: er.right <= window.innerWidth + 1,
        scrollValue: email.scrollWidth,
        clientValue: email.clientWidth,
      };
    });
    expect(r.missing, 'zip/state/phone/email inputs must exist on the settings page').toBe(false);
    expect(r.detailActive, 'the Business info detail sub-view (#setd-biz) must be open before measuring layout').toBe(true);
    expect(r.zipWiderThanState, 'zip box must use the same 56px/90px proportions as every other city/state/zip control in the app').toBe(true);
    expect(r.stacked, 'phone and email must stack on mobile so email gets full row width').toBe(true);
    expect(r.emailFullWidth, 'email box must match phone box width (both get the full stacked row), not still be half-split').toBe(true);
    expect(r.emailMajorityOfViewport, 'email box must actually span most of the viewport width once stacked').toBe(true);
    expect(r.emailFitsViewport, 'email box must not bleed past the viewport edge').toBe(true);
    expect(r.scrollValue - r.clientValue, 'a long email must not overflow its own box (no clipped text)').toBeLessThanOrEqual(2);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
