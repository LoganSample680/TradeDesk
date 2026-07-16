// @ts-check
/**
 * Regression guard, the dashboard "Maintenance Due" card must open the ACTUAL
 * maintenance contract, not the client record (§7.1: behavior change → assert the
 * new entry point AND that the old one is gone).
 *
 * Before: tapping a due item ran openClientDetail(clientId) → contracts tab.
 * After:  tapping a due item runs editContractModal(ct.id) → the contract itself.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('dashboard Maintenance Due → opens the contract', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('tapping a due item opens editContractModal(ct.id), not the client record', async () => {
    const r = await page.evaluate(() => {
      const cid = 99000001, ctid = 99000002;
      const today = new Date().toISOString().slice(0, 10);
      clients.push({ id: cid, name: 'Maint Regression Client' });
      contracts.push({ id: ctid, clientId: cid, title: 'Quarterly HVAC tune-up', amount: 250, active: true, freq: 'quarterly', startDate: today, nextDate: today });

      // The card renders into #dash-contracts; ensure the host exists then render.
      let host = document.getElementById('dash-contracts');
      if (!host) { host = document.createElement('div'); host.id = 'dash-contracts'; document.body.appendChild(host); }
      renderContractsDash();

      const row = document.querySelector('#dash-contracts [onclick*="editContractModal"]');
      const onclick = row ? row.getAttribute('onclick') : '';
      if (row) row.click();

      const modal = document.getElementById('_ct-modal-ov');
      const modalText = modal ? modal.textContent : '';
      // clean up the seeded rows so we don't leak into other specs sharing the page
      contracts = contracts.filter(c => c.id !== ctid);
      clients = clients.filter(c => c.id !== cid);
      if (modal) modal.remove();

      return {
        rowRendered: !!row,
        onclickTargetsContract: onclick.includes('editContractModal'),
        onclickDropsClientDetail: !onclick.includes('openClientDetail'),
        contractModalOpened: !!modal,
        modalShowsTheContract: modalText.includes('Quarterly HVAC tune-up') || modalText.includes('Edit Contract'),
      };
    });

    expect(r.rowRendered, 'a due contract renders a clickable row in #dash-contracts').toBe(true);
    expect(r.onclickTargetsContract, 'the row click calls editContractModal(ct.id)').toBe(true);
    expect(r.onclickDropsClientDetail, 'the row no longer routes through openClientDetail (old behavior gone)').toBe(true);
    expect(r.contractModalOpened, 'clicking opens the contract modal (#_ct-modal-ov)').toBe(true);
    expect(r.modalShowsTheContract, 'the opened modal is the maintenance contract').toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
