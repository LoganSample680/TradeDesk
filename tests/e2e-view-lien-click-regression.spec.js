// @ts-check
/**
 * Regression guard — the unpaid-balance popup's "⚖️ View lien" button must open
 * the ACTUAL filed lien document, not the client record (§7.1: behavior change →
 * assert the new entry point AND that the old one is gone).
 *
 * Before: tapping "View lien" ran openClientDetail(b.client_id) → the client record.
 * After:  tapping "View lien" runs printKansasLien(b.id) → the recorded lien doc,
 *         the same action the filed-lien card button uses ("View lien doc").
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('dashboard unpaid popup "View lien" → opens the lien, not the client', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('"View lien" onclick calls printKansasLien(b.id), not openClientDetail', async () => {
    const r = await page.evaluate(() => {
      const cid = 98000001, bidId = 98000002;

      // Isolate the popup's input to exactly one unpaid, lien-FILED bid so the modal
      // is guaranteed to render that bid (checkUnpaidOnLoad shows only unpaid[0]).
      const savedBids = bids.slice(), savedLiens = liens.slice(), savedClients = clients.slice();
      const savedShown = window._collOnLoadShown;
      const origPrint = window.printKansasLien, origOpenClient = window.openClientDetail;
      let printedId = null, clientOpened = null;
      window.printKansasLien = (id) => { printedId = id; };
      window.openClientDetail = (id) => { clientOpened = id; };

      clients = [{ id: cid, name: 'Lien Regression Client', phone: '316-555-0100', addr: '9 Lien St, Wichita KS 67202' }];
      bids = [{ id: bidId, client_id: cid, status: 'Closed Won', amount: 5000, deposit: 0,
                completion_date: '2015-01-01' }];  // very old → most-overdue → unpaid[0]
      liens = [{ bid_id: bidId, status: 'filed', county: 'Sedgwick County', amount: 5000, date: '2015-02-01' }];

      window._collOnLoadShown = false;
      checkUnpaidOnLoad();

      const overlay = document.querySelector('.zmodal-overlay');
      const btns = overlay ? [...overlay.querySelectorAll('button')] : [];
      const viewLienBtn = btns.find(b => b.textContent.includes('View lien'));
      const onclick = viewLienBtn ? viewLienBtn.getAttribute('onclick') : '';

      if (viewLienBtn) viewLienBtn.click();
      const overlayGoneAfterClick = !document.querySelector('.zmodal-overlay');

      // restore
      if (overlay) overlay.remove();
      bids = savedBids; liens = savedLiens; clients = savedClients;
      window._collOnLoadShown = savedShown;
      window.printKansasLien = origPrint; window.openClientDetail = origOpenClient;

      return {
        popupRendered: !!overlay,
        viewLienRendered: !!viewLienBtn,
        onclickTargetsLien: onclick.includes('printKansasLien(' + bidId + ')'),
        onclickDropsClientDetail: !onclick.includes('openClientDetail'),
        printCalledWithBidId: printedId === bidId,
        clientDetailNotOpened: clientOpened === null,
        overlayClosedOnClick: overlayGoneAfterClick,
      };
    });

    expect(r.popupRendered, 'the unpaid-balance popup renders for a filed-lien bid').toBe(true);
    expect(r.viewLienRendered, 'the "View lien" button is present').toBe(true);
    expect(r.onclickTargetsLien, 'the button calls printKansasLien(b.id)').toBe(true);
    expect(r.onclickDropsClientDetail, 'the button no longer routes through openClientDetail (old behavior gone)').toBe(true);
    expect(r.printCalledWithBidId, 'clicking opens the lien document for the correct bid').toBe(true);
    expect(r.clientDetailNotOpened, 'clicking does NOT open the client record').toBe(true);
    expect(r.overlayClosedOnClick, 'clicking dismisses the popup').toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
