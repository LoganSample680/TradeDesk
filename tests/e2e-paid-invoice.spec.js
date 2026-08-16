// @ts-check
/**
 * Recording a payment routes the client to a PAID invoice in their hub.
 *
 * Owner 2026-08-15: "route the button to submit final invoice with paid marker on
 * it to client hub."
 *
 * The hub already owned an invoice view and logPayment already republished the hub,
 * so nothing new is stored. What was missing: the invoice was gated behind the job
 * being marked complete (so a bid could be paid in full and the client still could
 * not see the invoice), the document carried no PAID marker a client would recognise
 * months later in a saved PDF, and there was no way for the contractor to hand it
 * over at the moment the payment landed.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, FAKE_TOKEN, FAKE_USER_ID } = require('./helpers');

test.describe('Paid invoice: contractor side', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      clients.push({ id: 950001, name: 'Invoice Client', phone: '3165550150', addr: '5 Invoice Way', clientToken: 'tok-inv' });
      bids.push({ id: 950100, client_id: 950001, client_name: 'Invoice Client', amount: 1200, status: 'Closed Won', completion_date: todayKey() });
      bids.push({ id: 950200, client_id: 950001, client_name: 'Invoice Client', amount: 4000, status: 'Closed Won', completion_date: todayKey() });
    });
  });

  test.afterEach(() => { assertNoErrors(page, 'paid invoice'); });

  test('a payment that clears the balance offers to send the PAID invoice', async () => {
    const r = await page.evaluate(() => {
      openPayPanel(950100);
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const banners = [...document.querySelectorAll('button')].filter(b => /Send the paid invoice/i.test(b.textContent));
      return {
        balance: getBidBalance(bids.find(b => b.id === 950100)),
        btn: banners.length,
        onclick: banners[0] ? banners[0].getAttribute('onclick') : null,
      };
    });
    expect(r.balance).toBeCloseTo(0, 2);
    expect(r.btn).toBeGreaterThan(0);
    expect(r.onclick).toBe('_sendPaidInvoice(950100)');
  });

  test('a partial payment offers the receipt instead', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('[style*="slideDown"]').forEach(e => e.remove());
      openPayPanel(950200);
      document.getElementById('mpay-amount').value = '1,000.00';
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const btns = [...document.querySelectorAll('button')];
      return {
        balance: getBidBalance(bids.find(b => b.id === 950200)),
        receipt: btns.filter(b => /Send the receipt/i.test(b.textContent)).length,
        paidInvoice: btns.filter(b => /Send the paid invoice/i.test(b.textContent)).length,
      };
    });
    expect(r.balance).toBeCloseTo(3000, 2);
    expect(r.receipt).toBeGreaterThan(0);
    expect(r.paidInvoice).toBe(0);
  });

  test('the send action deep-links straight to the invoice, not the hub homepage', async () => {
    const r = await page.evaluate(async () => {
      document.querySelectorAll('.zmodal-overlay,[style*="slideDown"]').forEach(e => e.remove());
      await _sendPaidInvoice(950100);
      const box = document.querySelector('.zmodal-overlay .zmodal');
      const txt = box ? box.textContent : '';
      const url = (txt.match(/https?:\/\/\S+/) || [''])[0];
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      return { url, hasHash: /#invoice-950100$/.test(url), title: txt.slice(0, 40) };
    });
    expect(r.hasHash, `deep link must end in #invoice-950100, got ${r.url}`).toBe(true);
    expect(r.title).toMatch(/Paid invoice ready/i);
  });
});

test.describe('Paid invoice: what the client sees', () => {
  let page;

  const seedHub = async (p, paidInFull) => p.evaluate((full) => {
    _hub.bids = [{ id: 7001, amount: 2375, type: 'Interior repaint', bid_date: '2026-08-01' }];
    _hub.payments = full
      ? [{ bid_id: 7001, amount: 2375, date: '2026-08-15', type: 'final', method: 'Check' }]
      : [{ bid_id: 7001, amount: 500, date: '2026-08-15', type: 'deposit', method: 'Check' }];
    openInvoice(7001);
    return document.getElementById('inv-content').textContent;
  }, paidInFull);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/client.html?t=' + FAKE_TOKEN + '&u=' + FAKE_USER_ID + '&c=901', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
  });

  test('a settled invoice carries a PAID marker', async () => {
    const txt = await seedHub(page, true);
    expect(txt).toContain('PAID');
    expect(txt).toMatch(/Paid in full/i);
  });

  test('an unsettled invoice carries no PAID marker', async () => {
    const txt = await seedHub(page, false);
    expect(txt).not.toMatch(/\bPAID\b/);
    expect(txt).toMatch(/Balance due/i);
  });

  // Owner 2026-08-15: the invoice should land in Documents when they wrap up paying.
  test('a settled invoice files itself into Documents tagged Paid', async () => {
    const r = await page.evaluate(() => {
      _hub.bids = [{ id: 7001, amount: 2375, type: 'Interior repaint', status: 'Closed Won', bid_date: '2026-08-01', signedAt: '2026-08-01T15:00:00Z' }];
      _hub.payments = [{ bid_id: 7001, amount: 2375, date: '2026-08-15', type: 'final', method: 'Check' }];
      renderDocuments();
      const el = document.getElementById('view-documents');
      const html = el ? el.innerHTML : '';
      return {
        hasRow: /openInvoice\(7001\)/.test(html),
        paidTag: />Paid</.test(html),
        paidMeta: /Paid in full/.test(html),
        headerPaid: /Paid/.test(html),
      };
    });
    // No completion_date on the bid: only the paid state puts it in Documents
    expect(r.hasRow).toBe(true);
    expect(r.paidTag).toBe(true);
    expect(r.paidMeta).toBe(true);
  });

  // The accordion header used (bid.balance||0)<0.01, which is 0<0.01 on a snapshot
  // with no balance field, so an UNPAID job wore a Paid header.
  test('an unpaid bid never reads as Paid, even with no balance field in the snapshot', async () => {
    const r = await page.evaluate(() => {
      _hub.bids = [{ id: 7003, amount: 5000, type: 'Deck rebuild', status: 'Closed Won', bid_date: '2026-08-01', signedAt: '2026-08-01T15:00:00Z' }];
      _hub.payments = [];   // nothing paid, and no bid.balance anywhere
      renderDocuments();
      const html = (document.getElementById('view-documents') || {}).innerHTML || '';
      return { paid: _hubBidPaid(7003), saysBalanceDue: /Balance due/.test(html), saysPaid: />Paid</.test(html) };
    });
    expect(r.paid).toBe(false);
    expect(r.saysBalanceDue).toBe(true);
    expect(r.saysPaid).toBe(false);
  });

  // Research 2026-08-16: a trade invoice is expected to carry the licence number,
  // the business address, an itemised breakdown with a tax line, and payment terms.
  // A one-line "Services, $2,375" with no licence is the thing clients query.
  test('the invoice carries what a trade invoice is expected to carry', async () => {
    const txt = await page.evaluate(() => {
      Object.assign(_hub, {
        contractorName: 'Sample Brothers Painting', contractorPhone: '(785) 555-0142',
        contractorAddr: '2950 SW McClure Rd, Topeka KS 66614', contractorEmail: 'billing@samplebros.com',
        contractorLicense: 'KS-PC-44821', salesTaxRate: 9.15, warrantyPeriod: '2 years', financeChargePct: 1.5,
      });
      _hub.bids = [{ id: 7005, amount: 2375, type: 'Interior repaint', bid_date: '2026-08-01', completion_date: '2026-08-14',
        lineItems: [{ desc: 'Wall prep', qty: 3, rate: 185, amount: 555 }, { desc: 'Two coats', qty: 8, rate: 68.75, amount: 550 }] }];
      _hub.payments = [{ bid_id: 7005, amount: 594, date: '2026-08-02', type: 'deposit', method: 'Check', ref: '1042' }];
      openInvoice(7005);
      return document.getElementById('inv-content').textContent.replace(/\s+/g, ' ');
    });
    expect(txt).toContain('KS-PC-44821');                 // licence number, not just a chip
    expect(txt).toContain('2950 SW McClure Rd');           // business address
    expect(txt).toContain('billing@samplebros.com');
    expect(txt).toContain('Wall prep');                    // itemised, not one lump line
    expect(txt).toContain('Two coats');
    expect(txt).toMatch(/Sales tax \(9\.15%\)/);          // tax broken out
    expect(txt).toMatch(/Subtotal/);
    expect(txt).toMatch(/Check #1042/);                    // payment method and reference
    expect(txt).toMatch(/Due on receipt/);                 // terms stated on an unpaid invoice
    expect(txt).toMatch(/Workmanship warranty: 2 years/);
    expect(txt).toMatch(/1\.5% monthly service charge/);
  });

  test('subtotal plus tax always equals the contract total', async () => {
    const r = await page.evaluate(() => {
      _hub.salesTaxRate = 9.15;
      _hub.bids = [{ id: 7006, amount: 2375, type: 'Repaint', completion_date: '2026-08-14' }];
      _hub.payments = [];
      openInvoice(7006);
      // Scrape the TOTALS block only: the line-item table repeats the same figures
      // as rate and amount, so scanning the whole document reads the wrong numbers.
      const t = document.querySelector('.inv-totals').textContent.replace(/\s+/g, ' ');
      const nums = (t.match(/\$[\d,]+\.\d\d/g) || []).map(x => parseFloat(x.replace(/[$,]/g, '')));
      return { sub: nums[0], tax: nums[1], total: nums[2] };
    });
    expect(r.sub + r.tax).toBeCloseTo(r.total, 2);
    expect(r.total).toBeCloseTo(2375, 2);
  });

  test('no tax rate set means no tax line at all', async () => {
    const txt = await page.evaluate(() => {
      _hub.salesTaxRate = 0;
      _hub.bids = [{ id: 7007, amount: 1000, type: 'Repair', completion_date: '2026-08-14' }];
      _hub.payments = [];
      openInvoice(7007);
      return document.getElementById('inv-content').textContent;
    });
    expect(txt).not.toMatch(/Sales tax/);
  });

  test('a paid bid shows its invoice even when the job was never marked complete', async () => {
    const r = await page.evaluate(() => {
      // No completion_date on either bid: the old gate hid the invoice entirely
      _hub.bids = [{ id: 7001, amount: 2375, type: 'Interior repaint' }, { id: 7002, amount: 900, type: 'Deck stain' }];
      _hub.payments = [{ bid_id: 7001, amount: 2375, date: '2026-08-15', type: 'final', method: 'Check' }];
      return { paid: _hubBidPaid(7001), unpaid: _hubBidPaid(7002) };
    });
    expect(r.paid).toBe(true);    // → invoice link renders
    expect(r.unpaid).toBe(false); // → still gated behind completion, as before
  });
});
