// @ts-check
// 1099 subcontractor payment tracking — per-payee yearly ledger with job
// addresses, the $600 1099-NEC threshold, W-9/EIN status, and the
// markSubPaid → contract-labor-expense bridge.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('1099 contractor tracking', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      bypassCSP: true,
    });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('_sub1099Report aggregates expenses + legacy job payouts per payee with job address', async () => {
    const r = await page.evaluate(() => {
      if (typeof _sub1099Report !== 'function') return null;
      const YR = '2035';
      const cSnap = [...clients], bSnap = [...bids], jSnap = [...jobs], eSnap = [...expenses];
      const subsSnap = S.subcontractors;
      S.subcontractors = [
        { id: 501, name: 'Mike Garcia', trade: 'Drywall', ein: '12-3456789', w9: true },
        { id: 502, name: 'Tom Sparks', trade: 'Electrical' }, // no W-9/EIN
      ];
      clients.push({ id: 601, name: 'Addr Client', addr: '123 Oak St, Wichita, KS' });
      bids.push({ id: 602, client_id: 601, client_name: 'Addr Client', addr: '123 Oak St, Wichita, KS', status: 'Closed Won', amount: 9000 });
      // Source 1: an expense row (as markSubPaid writes) — Mike, $500
      expenses.push({ id: 603, date: YR + '-04-01', cat: 'subs', catLabel: 'Subcontractors', vendor: 'Mike Garcia', amount: 500, subId: 501, subPayKey: '610:0', job_id: 602, job_name: 'Oak St repaint', client_id: 601 });
      // The job.subs entry BEHIND that expense — must be deduped by subPayKey
      jobs.push({ id: 610, client_id: 601, bid_id: 602, name: 'Oak St repaint', subs: [
        { subId: 501, subName: 'Mike Garcia', desc: 'Drywall', amount: 500, paid: true, paidDate: YR + '-04-01' },
        // Source 2: a LEGACY paid entry with no expense — Tom, $650 (crosses $600)
        { subId: 502, subName: 'Tom Sparks', desc: 'Panel swap', amount: 650, paid: true, paidDate: YR + '-05-01' },
      ]});
      // Quick-modal category string also counts — Mike, $200
      expenses.push({ id: 604, date: YR + '-06-01', cat: 'Subcontractors', vendor: 'mike garcia', amount: 200 });
      const rep = _sub1099Report(YR);
      clients.length = 0; cSnap.forEach(x => clients.push(x));
      bids.length = 0; bSnap.forEach(x => bids.push(x));
      jobs.length = 0; jSnap.forEach(x => jobs.push(x));
      expenses.length = 0; eSnap.forEach(x => expenses.push(x));
      S.subcontractors = subsSnap;
      return rep;
    });
    expect(r).not.toBeNull();
    const mike = r.payees.find(p => p.name === 'Mike Garcia');
    const tom = r.payees.find(p => p.name === 'Tom Sparks');
    expect(mike.total).toBe(700);            // 500 expense + 200 quick — job.subs twin deduped
    expect(mike.needs1099).toBe(true);       // ≥ $600
    expect(mike.w9 && !!mike.ein).toBe(true);
    expect(mike.rows[0].addr).toBe('123 Oak St, Wichita, KS'); // job address resolved
    expect(tom.total).toBe(650);             // legacy job.subs payout still counts
    expect(tom.needs1099).toBe(true);
    expect(tom.w9).toBe(false);              // flagged: get a W-9
    expect(r.flagged).toBe(2);
    expect(r.missingW9).toBe(1);
    assertNoErrors(page, '1099 report aggregation');
  });

  test('markSubPaid logs a contract-labor expense exactly once', async () => {
    const r = await page.evaluate(() => {
      if (typeof markSubPaid !== 'function') return null;
      const jSnap = [...jobs], eSnap = [...expenses];
      clients.push({ id: 701, name: 'Pay Client' });
      jobs.push({ id: 710, client_id: 701, name: 'Pay job', subs: [
        { subId: 999, subName: 'Once Only', desc: 'Trim', amount: 300, paid: false, paidDate: '' },
      ]});
      markSubPaid(710, 0, 701);
      const afterFirst = expenses.filter(e => e.subPayKey === '710:0').length;
      // Mark paid again (idempotent path) — must NOT double-log
      markSubPaid(710, 0, 701);
      const afterSecond = expenses.filter(e => e.subPayKey === '710:0').length;
      const exp = expenses.find(e => e.subPayKey === '710:0');
      const res = { afterFirst, afterSecond, cat: exp && exp.cat, vendor: exp && exp.vendor, amount: exp && exp.amount, paid: jobs.find(j => j.id === 710).subs[0].paid };
      jobs.length = 0; jSnap.forEach(x => jobs.push(x));
      expenses.length = 0; eSnap.forEach(x => expenses.push(x));
      clients = clients.filter(c => c.id !== 701);
      document.querySelectorAll('.zmodal-overlay,#job-sheet-overlay').forEach(el => el.remove());
      return res;
    });
    expect(r).not.toBeNull();
    expect(r.afterFirst).toBe(1);
    expect(r.afterSecond).toBe(1);           // dedupe held
    expect(r.cat).toBe('subs');              // Schedule C Line 11 category
    expect(r.vendor).toBe('Once Only');
    expect(r.amount).toBe(300);
    expect(r.paid).toBe(true);
  });

  test('open1099Report renders the modal without console errors', async () => {
    const ok = await page.evaluate(() => {
      if (typeof open1099Report !== 'function') return null;
      open1099Report(2035);
      const ov = document.getElementById('_1099-ov');
      const has = !!ov && ov.textContent.includes('1099 contractor payments');
      ov?.remove();
      return has;
    });
    expect(ok).toBe(true);
    assertNoErrors(page, '1099 report modal');
  });

  test('sub roster modal has the 1099 filing fields (EIN, W-9, address)', async () => {
    const r = await page.evaluate(() => {
      if (typeof _openSubModal !== 'function') return null;
      _openSubModal({ name: 'Field Check', ein: '98-7654321', addr: '9 Elm St', w9: true }, 0);
      const res = {
        ein: document.getElementById('sub-ein')?.value,
        addr: document.getElementById('sub-addr')?.value,
        w9: document.getElementById('sub-w9')?.checked,
      };
      document.getElementById('_sub-modal-ov')?.remove();
      return res;
    });
    expect(r).not.toBeNull();
    expect(r.ein).toBe('98-7654321');
    expect(r.addr).toBe('9 Elm St');
    expect(r.w9).toBe(true);
    assertNoErrors(page, 'sub modal 1099 fields');
  });
});
