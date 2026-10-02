// @ts-check
/**
 * Hotfix lane, error_log 284, 286, 287, 288 (2026-10-02, production v10.01.26.30).
 *
 * Two dead taps reported by js/observability.js:
 *
 *  - 287/288: a Jobs card for a proposal whose customer is not on this device.
 *    Both boards draw it with a stand-in customer ({id: b.client_id}) and the
 *    card called openJobSheet(client_id), which finds no customer and returns
 *    silently. The card now opens the proposal (openBidDetail), which copes
 *    with a missing customer (_jobsCardOpen, js/jobs.js).
 *
 *  - 284/286: the mobile top bar brand. With one hat it is the logo easter egg,
 *    which needs SEVEN taps, so taps one to six do nothing on purpose. The
 *    detector now skips it (data-obs-quiet) while it is the egg, and watches it
 *    again when it is the hat switcher, which opens a menu on one tap.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('hotfix: no dead taps on the Jobs board or the top bar brand', () => {
  let page;
  const LOST = 1788745147905234;   // the customer id from error_log 287
  const SENT = 9915801, WON = 9915802;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Seeded inside the same evaluate that renders, so a late cache load cannot
  // land between the seed and the render (see e2e-jobs-exhaustive's note).
  const render = (filter) => page.evaluate(({ LOST, SENT, WON, filter }) => {
    clients = clients.filter(c => c.id !== LOST);
    bids = bids.filter(b => b.id !== SENT && b.id !== WON);
    bids.push(
      { id: SENT, client_id: LOST, name: 'Client13 Custom Row', amount: 2055, status: 'Pending',
        signingToken: 'tok-hotfix-287', bid_date: '2026-09-07', type: 'Custom estimate' },
      { id: WON, client_id: LOST, client_name: 'Client11 Hourly Way', amount: 5525, status: 'Closed Won',
        bid_date: '2026-09-07', signedAt: '2026-09-08T00:00:00Z', type: 'T&M estimate' });
    document.querySelector('[data-bdov]')?.remove();
    goPg('pg-jobs');
    jobFilter = filter;
    renderJobsPage();
    return true;
  }, { LOST, SENT, WON, filter });

  test('the card for a proposal whose customer is gone opens the proposal, on the board', async () => {
    await render('all');
    const card = page.locator('.k-card[data-lp-id="' + SENT + '"]');
    await expect(card).toHaveCount(1);
    expect(await card.getAttribute('onclick')).toBe('openBidDetail(' + SENT + ')');
    await card.click();
    await expect(page.locator('[data-bdov]')).toHaveCount(1);
    await page.evaluate(() => document.querySelector('[data-bdov]')?.remove());
  });

  test('and in the filtered list', async () => {
    await render('scheduled');
    const card = page.locator('.tf-card[data-lp-id="' + WON + '"]');
    await expect(card).toHaveCount(1);
    expect(await card.getAttribute('onclick')).toBe('openBidDetail(' + WON + ')');
    await card.click();
    await expect(page.locator('[data-bdov]')).toHaveCount(1);
    await page.evaluate(() => document.querySelector('[data-bdov]')?.remove());
  });

  test('a card whose customer IS here still opens the job sheet', async () => {
    const r = await page.evaluate(({ LOST }) => {
      clients = clients.filter(c => c.id !== 9915809).concat([{ id: 9915809, name: 'Here Customer', addr: '1 Here St' }]);
      return { here: _jobsCardOpen({ id: 1, client_id: 9915809 }), gone: _jobsCardOpen({ id: 2, client_id: LOST }),
        none: _jobsCardOpen(null), undef: _jobsCardOpen(undefined) };
    }, { LOST });
    expect(r.here).toBe('openJobSheet(9915809)');
    expect(r.gone).toBe('openBidDetail(2)');
    expect(r.none).toBe('void(0)');
    expect(r.undef).toBe('void(0)');
  });

  test('the brand is quiet while it is the seven-tap egg, and watched as the hat switcher', async () => {
    const r = await page.evaluate(() => {
      const brand = document.getElementById('mobile-topbar-brand');
      const saved = window._hatCrewLinks;
      const out = { markup: brand && brand.hasAttribute('data-obs-quiet') };
      try {
        window._hatCrewLinks = [];
        _applyEmployeeNavGating();
        out.egg = brand.hasAttribute('data-obs-quiet');
        window._hatCrewLinks = [{ contractor_user_id: 'x', name: 'Dad' }];
        _applyEmployeeNavGating();
        out.switcher = brand.hasAttribute('data-obs-quiet');
      } finally {
        window._hatCrewLinks = saved;
        _applyEmployeeNavGating();
      }
      return out;
    });
    expect(r.markup, 'quiet from the first paint, before nav gating runs').toBe(true);
    expect(r.egg).toBe(true);
    expect(r.switcher).toBe(false);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'hotfix dead taps');
  });
});
