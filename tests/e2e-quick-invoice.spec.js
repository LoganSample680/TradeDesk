// @ts-check
/**
 * Quick invoice (js/quick-invoice.js, owner 2026-09-26): bill a customer with
 * no proposal. Home > Invoice > pick who > Hourly (tracked time + receipts,
 * each person at their own rate) or Set price (typed lines, price book) >
 * Send. Saved as a won bid (the diagnostic-charge shape) so Collect and the
 * customer's hub pick it up, and the next invoice starts after it.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const T0 = '2026-09-24T14:00:00.000Z';

async function boot(page, w) {
  if (w) await page.setViewportSize({ width: w, height: 800 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate((T0) => {
    const mk = (id, name, addr, phone) => ({ id, name, addr, phone: phone || '', status: 'Client' });
    clients.splice(0, clients.length,
      mk(901, 'John Doe', '1418 Maple Ave, Springfield, IL', '5555550101'),
      mk(902, 'Mary Smith', '77 Lakeview Dr, Springfield, IL'),
      mk(903, 'Karen Smith', '310 W Oak St, Rochester, IL'));
    jobs.push({ id: 'j901', client_id: 901, start: todayKey(), days: 1 }, { id: 'j902', client_id: 902, start: todayKey(), days: 1 });
    S.laborRate = 70;
    S.ownerName = 'Mike Sample';
    S.employees = [{ name: 'Jack Sample', email: 'jack@x.com', billRate: 85 }];
    S.priceBook = { plumbing: [{ desc: 'Replace water heater', rate: 1400, unit: 'ea', n: 3 }, { desc: 'Haul away old unit', rate: 75, unit: 'ea', n: 2 }] };
    const t = Date.parse(T0), h = 3600e3;
    window._jobTimeEntriesByJob = {
      j901: [
        { arrivedAt: new Date(t).toISOString(), departedAt: new Date(t + 6.5 * h).toISOString(), minutes: 390, employeeName: 'Jack Sample' },
        { arrivedAt: new Date(t).toISOString(), departedAt: new Date(t + 6.5 * h).toISOString(), minutes: 390, employeeName: 'Mike Sample' },
      ],
      j902: [{ arrivedAt: new Date(t - 86400e3).toISOString(), departedAt: new Date(t - 86400e3 + h).toISOString(), minutes: 60, employeeName: 'Mike Sample' }],
    };
    expenses.push({ id: 'e1', client_id: 901, vendor: 'Ferguson', amount: 300, date: '2026-09-24' }, { id: 'e2', client_id: 902, vendor: 'Menards', amount: 40, date: '2026-09-23' });
  }, T0);
}

test.describe('Quick invoice', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'quick invoice'); });

  test('Invoice sits on the home screen right after Proposal', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#dash-quick .qa')].map(b => b.textContent.trim());
      return { i: btns.indexOf('Invoice'), p: btns.indexOf('Proposal') };
    });
    expect(r.i).toBe(r.p + 1);
  });

  test('the picker: "Worked this week" lists recent customers with their street, and search finds the rest', async ({ page }) => {
    await boot(page);
    await page.click('#qa-invoice-btn');
    const r = await page.evaluate(() => {
      const box = document.querySelector('.zmodal');
      return { text: box.textContent, first: box.querySelector('[data-action="invoice"]').textContent };
    });
    expect(r.text).toContain('Quick invoice');
    expect(r.text).toContain('Worked this week');
    expect(r.first).toContain('John Doe');
    expect(r.first).toContain('1418 Maple Ave');
    expect(r.text).not.toContain('Karen Smith');
    await page.fill('#qp-search', 'karen');
    expect(await page.locator('#qp-results').textContent()).toContain('310 W Oak St');
  });

  test('Hourly: each person at their own rate, receipts, and the total', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => openQuickInvoice(901));
    const r = await page.evaluate(() => ({
      active: document.querySelector('.pg.active').id,
      seg: document.querySelector('#qi-page .qi-seg .on').textContent,
      text: document.getElementById('qi-page').textContent,
      total: document.getElementById('qi-total').textContent,
      send: document.getElementById('qi-send').textContent,
    }));
    expect(r.active).toBe('pg-qi');
    expect(r.seg).toBe('Hourly');
    expect(r.text).toContain('Jack Sample');
    expect(r.text).toContain('6h 30m on site at');
    expect(r.text).toContain('$552.50');           // 6.5h x $85
    expect(r.text).toContain('$455.00');           // owner at the labor rate, 6.5h x $70
    expect(r.text).toContain('Ferguson');
    expect(r.total).toBe('$1,307.50');
    expect(r.send).toBe('Text it to John');
  });

  test('changing a rate reprices that line and the total', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => openQuickInvoice(901));
    await page.fill('input[aria-label="Rate for Mike Sample"]', '90');
    expect(await page.textContent('#qi-total')).toBe('$1,437.50');
  });

  test('Set price: typed lines and the price book, no tracked time on the bill', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { openQuickInvoice(901); _qiSetMode('set'); });
    expect(await page.textContent('#qi-page')).not.toContain('Jack Sample');
    await page.click('text=Add from price book');
    await page.click('.qi-pb button:has-text("Replace water heater")');
    expect(await page.textContent('#qi-total')).toBe('$1,400.00');
    await page.click('text=Add a line');
    await page.locator('.qi-desc').nth(1).fill('Haul away');
    await page.locator('#qi-page .ios-val input').nth(1).fill('75');
    expect(await page.textContent('#qi-total')).toBe('$1,475.00');
  });

  test('Send saves a won invoice Collect can see, remembers the mode, and never bills the same work twice', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiSend();
      const again = _qiUnbilled(901);
      return {
        bid: { kind: bid.kind, status: bid.status, amount: bid.amount, lines: bid.lineItems.length, exp: bid.qiExpenseIds, through: !!bid.qiTimeThrough },
        balance: getBidBalance(bid),
        inCollect: bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01).some(b => b.id === bid.id),
        mode: getClientById(901).qiMode,
        again: again.lines.length,
        page: document.querySelector('.pg.active').id,
      };
    });
    expect(r.bid).toEqual({ kind: 'quick_invoice', status: 'Closed Won', amount: 1307.5, lines: 3, exp: ['e1'], through: true });
    expect(r.balance).toBe(1307.5);
    expect(r.inCollect).toBe(true);
    expect(r.mode).toBe('hourly');
    expect(r.again).toBe(0);
    expect(r.page).toBe('pg-dash');
  });

  test('a customer with nothing tracked opens on Set price; an empty invoice will not send', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const n = bids.length;
      openQuickInvoice(903);
      const seg = document.querySelector('#qi-page .qi-seg .on').textContent;
      const out = qiSend();
      return { seg, sent: !!out, grew: bids.length !== n };
    });
    expect(r.seg).toBe('Set price');
    expect(r.sent).toBe(false);
    expect(r.grew).toBe(false);
  });

  test('time on a job with a proposal stays off, and the screen says to bill it from that job', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      bids.push({ id: 'b77', client_id: 901, type: 'Time & Materials', isTM: true, status: 'Closed Won', amount: 2000 });
      payments.push({ id: 'p77', bid_id: 'b77', amount: 500, date: '2026-09-20', method: 'Card' });
      jobs.find(j => j.id === 'j901').bid_id = 'b77';
      openQuickInvoice(901);
      return { text: document.getElementById('qi-page').textContent, total: document.getElementById('qi-total').textContent };
    });
    expect(r.text).not.toContain('Jack Sample');
    expect(r.text).toContain('John has a');
    expect(r.text).toContain('$500 paid');
    expect(r.text).toContain('Bill that one from the job');
    expect(r.total).toBe('$300.00');                 // only the receipt is left
  });

  test('a proposal job paid in full says nothing', async ({ page }) => {
    await boot(page);
    const t = await page.evaluate(() => {
      bids.push({ id: 'b78', client_id: 901, type: 'Build Your Own Estimate', isFreeForm: true, status: 'Closed Won', amount: 800 });
      payments.push({ id: 'p78', bid_id: 'b78', amount: 800, date: '2026-09-20', method: 'Cash' });
      jobs.find(j => j.id === 'j901').bid_id = 'b78';
      openQuickInvoice(901);
      return document.getElementById('qi-page').textContent;
    });
    expect(t).not.toContain('Bill that one from the job');
  });

  test('See it opens the invoice in the proposal\'s own letterhead, before anything is saved', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const n = bids.length;
      openQuickInvoice(901);
      qiSeeIt();
      const ov = document.getElementById('_prop-preview-ov');
      return { text: ov && ov.textContent, cover: !!(ov && ov.querySelector('.prop-cover')), saved: bids.length !== n };
    });
    expect(r.cover, 'the same cover the proposal opens on').toBe(true);
    expect(r.text).toContain('Billed to');
    expect(r.text).toContain('Jack Sample: 6h 30m on site');
    expect(r.text).toContain('Total due');
    expect(r.text).toContain('$1,307.50');
    expect(r.text).not.toContain('Valid until');
    expect(r.saved).toBe(false);
  });

  test('Pay now saves the invoice and opens the pay panel on it', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiPayNow();
      return { kind: bid && bid.kind, active: window.activePayBidId === bid.id || (typeof activePayBidId !== 'undefined' && activePayBidId === bid.id) };
    });
    expect(r.kind).toBe('quick_invoice');
    expect(r.active).toBe(true);
    expect(await page.locator('#mpay-btn-deposit').count(), 'no deposit on a finished job').toBe(0);
  });

  test('each customer says whether the work is going on, coming up, or done', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      jobs.push({ id: 'jnow', client_id: 902, start: todayKey(), days: 2 });
      jobs.push({ id: 'jnext', client_id: 903, start: addDays(todayKey(), 5), days: 1 });
      jobs.find(j => j.id === 'j901').status = 'done';
      jobs.find(j => j.id === 'j901').completion_date = '2026-09-24';
      jobs.find(j => j.id === 'j901').start = '2026-09-20';
      openQuickInvoice(902);
      const pill902 = document.querySelector('#qi-page .qi-st').textContent;
      return { s901: _qiStatus(901), s902: pill902, s903: _qiStatus(903).label, none: _qiStatus(999) };
    });
    expect(r.s901.label).toBe('Done Sep 24');
    expect(r.s902).toBe('Working now');
    expect(r.s903).toMatch(/^Scheduled /);
    expect(r.none).toBe(null);
  });

  test('the printed invoice lists each line', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiSend();
      let out = '';
      const orig = window.open;
      window.open = () => ({ document: { write: (s) => { out += s; }, close() {} }, focus() {}, print() {} });
      try { printInvoice(bid.id); } catch (_e) {}
      window.open = orig;
      return out;
    });
    expect(html).toContain('Jack Sample: 6h 30m on site');
    expect(html).toContain('Ferguson receipt');
  });

  test('crew never reach the invoice screen', async ({ page }) => {
    await boot(page);
    const id = await page.evaluate(() => {
      const was = window._isEmployee;
      window._isEmployee = true;
      try { goPg('pg-qi'); } finally { window._isEmployee = was; }
      return document.querySelector('.pg.active').id;
    });
    expect(id).not.toBe('pg-qi');
  });

  for (const w of [320, 390]) {
    test('no bleed at ' + w + 'px', async ({ page }) => {
      await boot(page, w);
      await page.evaluate(() => openQuickInvoice(901));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
});
