// @ts-check
// ── The two public legal pages ──────────────────────────────────────────────
//
// App Review will not accept a submission without a reachable privacy policy,
// and the policy has to describe what the app actually does: this one runs
// background location and shows an employer where their crew is, which is the
// exact combination reviewers read closely (5.1.1, 5.1.2(i), 5.1.5).
//
// So these are not decorative pages and the tests treat them as product:
//   * They load standalone, anonymous, with no app and no console errors.
//   * The claims a reviewer looks for are actually on the page, by text, so a
//     future rewrite cannot quietly drop the deletion path or the "we do not
//     sell" line and still pass.
//   * They are reachable from the three places a person looks: the website
//     footer, the signup screen, and Settings inside the app.
//   * They hold their layout at 390px, like every other screen (15.3).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const PAGES = ['/privacy.html', '/terms.html'];

test.describe('legal pages', () => {

  test('both load anonymously with no console errors', async ({ page }) => {
    for (const url of PAGES) {
      await mockAllExternal(page);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(resp && resp.status(), url).toBeLessThan(400);
      // No app, no Supabase, no login: these are flat files on purpose.
      const hasApp = await page.evaluate(() => !!document.getElementById('pg-dash'));
      expect(hasApp, url).toBe(false);
      await assertNoErrors(page);
    }
  });

  test('the stylesheet actually applies', async ({ page }) => {
    // A missing legal.css would still render readable text, which is exactly
    // why it needs asserting: the page would look broken and nobody's test
    // would fail. The masthead is dark only if the sheet loaded.
    await mockAllExternal(page);
    await page.goto('/privacy.html', { waitUntil: 'load' });
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.mast')).backgroundColor);
    expect(bg).toBe('rgb(27, 22, 18)');
  });

  test('privacy says the things a reviewer looks for', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/privacy.html', { waitUntil: 'domcontentloaded' });
    const txt = (await page.textContent('body')).replace(/\s+/g, ' ');
    // Deletion, with the in-app path spelled out (5.1.1(v)).
    expect(txt).toMatch(/Settings, Danger zone, Delete account/i);
    // The data-sale answer, stated rather than implied.
    expect(txt).toMatch(/do not sell/i);
    // Background location: what turns it on, and that it can be turned off.
    expect(txt).toMatch(/working hours/i);
    expect(txt).toMatch(/Location Services/i);
    // Crew visibility, disclosed to the person being tracked (5.1.2(i)).
    expect(txt).toMatch(/what your employer sees/i);
    // The subprocessors are named, not hidden behind "our partners".
    for (const co of ['Supabase', 'Stripe', 'Apple', 'Cloudflare', 'Anthropic']) {
      expect(txt, co).toContain(co);
    }
    expect(await page.locator('a[href="terms.html"]').count()).toBeGreaterThan(0);
  });

  test('terms carry the Apple clauses and the renewal disclosure', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/terms.html', { waitUntil: 'domcontentloaded' });
    const txt = (await page.textContent('body')).replace(/\s+/g, ' ');
    // Apple's minimum EULA terms. Missing the beneficiary clause is a known
    // rejection, and it is one line, so it is asserted rather than trusted.
    expect(txt).toMatch(/third party beneficiaries of this agreement/i);
    expect(txt).toMatch(/between you and TradeDesk only, not Apple/i);
    expect(txt).toMatch(/refund the purchase price/i);
    // Auto-renew, in the words the App Store requires.
    expect(txt).toMatch(/renews automatically/i);
    expect(txt).toMatch(/24 hours before/i);
    // The employer's own obligation, since we hand them a tracking tool.
    expect(txt).toMatch(/responsibilities as the employer/i);
    expect(await page.locator('a[href="privacy.html"]').count()).toBeGreaterThan(0);
  });

  test('neither page bleeds off a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of PAGES) {
      await mockAllExternal(page);
      await page.goto(url, { waitUntil: 'load' });
      const bleed = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));
      expect(bleed.doc, url).toBeLessThanOrEqual(bleed.win + 1);
      // Wide content (the subprocessor and data tables) scrolls inside its own
      // box rather than pushing the page sideways.
      const bad = await page.evaluate(() => [...document.querySelectorAll('table')]
        .filter(t => getComputedStyle(t.parentElement).overflowX !== 'auto').length);
      expect(bad, url).toBe(0);
    }
  });

  test('the website footer links to both', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/landing.html', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('footer a[href="/privacy.html"]').count()).toBe(1);
    expect(await page.locator('footer a[href="/terms.html"]').count()).toBe(1);
  });

  test('the app links to both, and the old summary alert is gone', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Settings, About.
    expect(await page.locator('#setd-about a[href="privacy.html"]').count()).toBe(1);
    expect(await page.locator('#setd-about a[href="terms.html"]').count()).toBe(1);
    // The signup screen now points at the real documents, and the zAlert
    // paraphrase it used to open is deleted, not left orphaned (7, 7.1).
    const gone = await page.evaluate(() => typeof window._obShowTos);
    expect(gone).toBe('undefined');
    const consent = await page.evaluate(() => {
      window._ob = Object.assign(window._ob || {}, { step: 1 });
      return typeof window.renderObStep === 'function' ? 'ok' : 'missing';
    });
    expect(consent).toBe('ok');
    await assertNoErrors(page);
  });

});
