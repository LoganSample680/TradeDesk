// @ts-check
/**
 * Earl's money audit (2026-09-27). Earl is a 58-year-old plumber on an iPhone
 * SE (375x667). He collected $1,347.50 on a $1,847.50 job, spent $180 on
 * parts, and the app then disagreed with itself about his money:
 *
 *   - Books said Income $0 and "Net profit -$180.00" (job payments missing).
 *   - Home said taxes $165, the Taxes screen "Set aside $176.00 from every
 *     payment" (it was the whole year's reserve), the payment banner $203.
 *   - The banner said "Paid in full, $1,847.50 received" when he took $1,347.50,
 *     and sat over the top of the screen for 9 seconds.
 *   - "Send all reminders" threw "onYes is not a function".
 *   - A double tap on Record payment landed its second tap on the button
 *     under his thumb once the sheet closed.
 *   - Log cost saved "Paint & supplies" as plain text, Schedule C line 27.
 *   - Meals deducted at 100%, the lien form said "Sedgwick County" for everyone,
 *     the quarterly card said "Jun 16" and listed four amounts.
 *
 * Every number here is asserted to the cent, and every surface that shows a
 * tax figure is asserted to show the SAME figure (taxYearSnapshot / taxSetAside).
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CID = 7710001;
const BID = 7710002;

async function boot(page) {
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
}

// Earl's year: one $1,847.50 job, $1,347.50 of it collected, $180 of parts.
async function seedEarl(page, opts = {}) {
  await page.evaluate(({ CID, BID, opts }) => {
    const yr = String(new Date().getFullYear());
    income.length = 0; payments.length = 0; expenses.length = 0; mileage.length = 0;
    clients.push({ id: CID, name: 'Earl Customer', phone: '3165550142', addr: '12 Oak St, Topeka, KS 66603' });
    bids.push({ id: BID, client_id: CID, client_name: 'Earl Customer', amount: 1847.5, status: 'Closed Won', addr: '12 Oak St, Topeka, KS 66603' });
    if (opts.paid !== false) payments.push({ id: 7710100, bid_id: BID, client_id: CID, client_name: 'Earl Customer', date: yr + '-06-10', type: 'deposit', amount: 1347.5, method: 'Cash' });
    expenses.push({ id: 7710200, date: yr + '-06-11', cat: 'materials', catLabel: 'Materials & supplies', vendor: 'Ferguson', amount: 180 });
    ['tx-spouse', 'tx-paid', 'tx-prior-yr', 'tx-prior-yr-agi'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
    const st = document.getElementById('tx-status'); if (st) st.value = 'single';
    S.txStatus = 'single'; S.state = 'KS';
  }, { CID, BID, opts });
}

test.describe('Earl: one definition of his money', () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'earl money'); });

  test('Books summary counts job payments: $1,347.50 in, $180 out, tax $165, profit $1,002.50', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(() => {
      trackerYear = new Date().getFullYear();
      renderSummary();
      const T = taxYearSnapshot(String(trackerYear));
      return { text: document.getElementById('sum-mets').textContent, inc: document.getElementById('sum-inc').textContent, tIn: T.tIn, tax: T.totalOwed };
    });
    expect(r.tIn).toBe(1347.5);
    // SE tax on (1347.50 - 180) x 92.35% x 15.3%, rounded up; no income tax under the standard deduction.
    expect(r.tax).toBe(165);
    expect(r.text).toContain('Income$1,347.50');
    expect(r.text).toContain('Expenses$180.00');
    expect(r.text).toContain('Est. tax$165.00');
    expect(r.text).toContain('Net profit$1,002.50');
    expect(r.text).not.toContain('-$180.00');
    expect(r.inc).toContain('Job payments');
  });

  test('Home, Taxes and the payment banner show the same tax number', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(() => {
      const yr = new Date().getFullYear();
      dashPeriod = 'year'; dashYear = yr;
      _taxPageYear = yr; calcTax();
      return {
        reserve: document.getElementById('tx-reserve-amt').textContent,
        rateLine: document.getElementById('tx-reserve-rate').textContent,
        home: taxSetAside(1347.5, yr),
        homeTile: (() => { renderDash(); const el = document.querySelector('[data-kpi="taxes"] .met-v'); return el ? el.textContent : null; })(),
      };
    });
    expect(r.reserve).toBe('$165.00');
    expect(r.home).toBe(165);
    if (r.homeTile !== null) expect(r.homeTile).toContain('165');
    // It says what it is: a percentage of every payment, not "$176 from every payment".
    expect(r.rateLine).toMatch(/^Set aside 12\.2% of every payment/);
    expect(r.rateLine).not.toContain('$');
  });

  test('recording a partial payment: the banner shows THIS payment, the balance, and the set-aside to the cent', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    const r = await page.evaluate((BID) => {
      openPayPanel(BID);
      document.getElementById('mpay-amount').value = '1,347.50';
      _mpayPickMethod('Cash');
      logPayment();
      const b = document.getElementById('_pay-banner');
      const yr = String(new Date().getFullYear());
      return { text: b ? b.textContent : '', aside: taxSetAside(1347.5, yr), n: payments.filter(p => p.bid_id === BID).length };
    }, BID);
    expect(r.n).toBe(1);
    expect(r.text).toContain('$1,347.50 received');
    expect(r.text).toContain('$500.00 still owed');
    expect(r.text).toContain('Set aside $165.00 of this payment for taxes (12.2%)');
    expect(r.aside).toBe(165);
  });

  test('the payment that clears the job says what came in, not the job total', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate((BID) => {
      openPayPanel(BID);
      document.getElementById('mpay-amount').value = '500.00';
      logPayment();
      const yr = String(new Date().getFullYear());
      const T = taxYearSnapshot(yr);
      return { text: document.getElementById('_pay-banner').textContent, aside: taxSetAside(500, yr), tot: T.totalOwed, tIn: T.tIn };
    }, BID);
    expect(r.text).toContain('$500.00 received, paid in full');
    expect(r.text).not.toContain('$1,847.50 received');
    expect(r.tIn).toBe(1847.5);
    // 1,847.50 - 180 = 1,667.50 net, SE tax rounds up to $236; this payment's share is 500/1847.50 of it: $63.87.
    expect(r.tot).toBe(236);
    expect(r.aside).toBe(63.87);
    expect(r.text).toContain('Set aside $63.87 of this payment');
  });

  test('the banner never blocks: taps reach the expense sheet under it, and a tap dismisses it', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    await page.evaluate((BID) => { openPayPanel(BID); document.getElementById('mpay-amount').value = '100.00'; logPayment(); openExpenseFlow(); }, BID);
    const banner = page.locator('#_pay-banner');
    await expect(banner).toBeVisible();
    const hit = await page.evaluate(() => {
      const btn = document.querySelector('#expense-modal button[aria-label="Close"]');
      const r = btn.getBoundingClientRect();
      const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const b = document.getElementById('_pay-banner').getBoundingClientRect();
      return { overlaps: r.top < b.bottom, reachable: btn === under || btn.contains(under), pe: getComputedStyle(document.getElementById('_pay-banner')).pointerEvents };
    });
    expect(hit.pe).toBe('none');
    expect(hit.reachable).toBe(true);
    await page.locator('#expense-modal button[aria-label="Close"]').click();
    await expect(page.locator('#expense-modal')).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });

  test('the banner goes by itself in 5 seconds, not 9', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    await page.evaluate((BID) => { openPayPanel(BID); document.getElementById('mpay-amount').value = '100.00'; logPayment(); }, BID);
    await expect(page.locator('#_pay-banner')).toHaveCount(1);
    await page.waitForTimeout(5300);
    await expect(page.locator('#_pay-banner')).toHaveCount(0);
  });

  test('double tap on Record payment: one payment, and the second tap does not land on what is under it', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    await page.evaluate((BID) => { openPayPanel(BID); document.getElementById('mpay-amount').value = '200.00'; }, BID);
    const box = await page.locator('#mpay-submit-btn').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    // A probe where the Tim button would be: under the sheet, at the same spot.
    await page.evaluate(([x, y]) => {
      const p = document.createElement('button'); p.id = 'zz-under-probe';
      p.style.cssText = 'position:fixed;left:' + (x - 30) + 'px;top:' + (y - 22) + 'px;width:60px;height:44px;z-index:1';
      window.__probeHits = 0; p.onclick = () => { window.__probeHits++; };
      document.body.appendChild(p);
    }, [x, y]);
    await page.mouse.click(x, y);
    await page.mouse.click(x, y);
    const r = await page.evaluate((BID) => ({ n: payments.filter(p => p.bid_id === BID).length, hits: window.__probeHits }), BID);
    expect(r.n).toBe(1);
    expect(r.hits).toBe(0);
    // The guard is short: a deliberate tap after it lapses goes through.
    await page.waitForTimeout(450);
    // The "schedule this job?" prompt a partial payment raises is not what is under test.
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()));
    await page.mouse.click(x, y);
    expect(await page.evaluate(() => window.__probeHits)).toBe(1);
  });

  test('pay method remembers his last one per business, and a remembered Venmo stays quiet', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    const r = await page.evaluate((BID) => {
      delete S.lastPayMethod;
      openPayPanel(BID);
      const fresh = document.getElementById('mpay-method').value;
      _mpayPickMethod('Zelle');
      document.getElementById('mpay-amount').value = '100.00';
      logPayment();
      document.getElementById('_pay-banner')?.remove();
      openPayPanel(BID);
      const again = document.getElementById('mpay-method').value;
      const pill = document.querySelector('#mpay-method-pills button[data-pmeth="Zelle"]').style.borderColor;
      closePayPanel();
      S.lastPayMethod = 'Venmo'; S.venmoUser = 'earl-plumbing';
      openPayPanel(BID);
      const venmo = { method: document.getElementById('mpay-method').value, qr: !!document.getElementById('_venmo-qr-ov') };
      closePayPanel();
      return { fresh, again, pill, saved: S.lastPayMethod === 'Venmo', venmo };
    }, BID);
    expect(r.fresh).toBe('Check');
    expect(r.again).toBe('Zelle');
    expect(r.pill).toBe('var(--green)');
    expect(r.venmo.method).toBe('Venmo');
    expect(r.venmo.qr).toBe(false);
  });

  test('pay sheet targets are 44px at 375 wide', async ({ page }) => {
    await boot(page);
    await seedEarl(page, { paid: false });
    await page.evaluate((BID) => openPayPanel(BID), BID);
    const r = await page.evaluate(() => ({
      // offsetHeight: the laid-out size, not the size mid-way through the sheet's scale-in.
      pills: [...document.querySelectorAll('#mpay-method-pills button')].map(b => b.offsetHeight),
      adj: [...document.querySelectorAll('.pay-modal-overlay button')].find(b => /Adjustments/.test(b.textContent)).offsetHeight,
      bleed: document.documentElement.scrollWidth <= innerWidth + 1,
    }));
    r.pills.forEach(h => expect(h).toBeGreaterThanOrEqual(44));
    expect(r.adj).toBeGreaterThanOrEqual(44);
    expect(r.bleed).toBe(true);
  });

  test('Send all reminders opens a reminder for every client it can text', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      bids.push({ id: 7719001, client_id: 7719101, client_name: 'Owes One', amount: 800, status: 'Closed Won', completion_date: '2026-08-01' });
      bids.push({ id: 7719002, client_id: 7719102, client_name: 'Owes Two', amount: 400, status: 'Closed Won', completion_date: '2026-08-02' });
      bids.push({ id: 7719003, client_id: 7719103, client_name: 'No Phone', amount: 300, status: 'Closed Won', completion_date: '2026-08-03' });
      clients.push({ id: 7719101, name: 'Owes One', phone: '3165550001' }, { id: 7719102, name: 'Owes Two', phone: '3165550002' }, { id: 7719103, name: 'No Phone' });
      collSendAllReminders();
    });
    const yes = page.locator('#zmodal-yes');
    await expect(yes).toHaveText(/Send \d+/);
    const n = parseInt((await yes.textContent()).replace(/\D/g, ''), 10);
    await yes.click();
    const sheets = page.locator('.zmodal-overlay', { hasText: 'Send via Messages' });
    await expect(sheets).toHaveCount(n);
    const names = await sheets.allTextContents();
    expect(names.some(t => t.includes('Owes One'))).toBe(true);
    expect(names.some(t => t.includes('Owes Two'))).toBe(true);
    expect(names.some(t => t.includes('No Phone'))).toBe(false);
  });

  test('Log cost from a job saves the real tax category, and he stays where he was', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(({ CID, BID }) => {
      goPg('pg-money');
      showQuickExpenseModal(CID, BID);
      const opts = [...document.querySelectorAll('#qe-cat option')].map(o => ({ v: o.value, t: o.textContent }));
      const _cb = document.querySelector('.zmodal button[aria-label="Close"]'); const closeBox = { width: _cb.offsetWidth, height: _cb.offsetHeight };
      document.getElementById('qe-vendor').value = 'Ferguson';
      document.getElementById('qe-amount').value = '42.19';
      saveQuickExpense(CID);
      const e = expenses.find(x => x.vendor === 'Ferguson' && x.amount === 42.19);
      return { opts, e, page: document.querySelector('.pg.active').id, closeW: closeBox.width, closeH: closeBox.height };
    }, { CID, BID });
    expect(r.opts[0]).toEqual({ v: 'materials', t: 'Materials & supplies' });
    expect(r.opts.some(o => /Paint/.test(o.t))).toBe(false);
    expect(r.opts.some(o => o.v === 'vehicle_purchase')).toBe(false);
    expect(r.e.cat).toBe('materials');
    expect(r.e.catLabel).toBe('Materials & supplies');
    expect(r.e.job_id).toBe(BID);
    expect(r.page).toBe('pg-money');
    expect(r.closeW).toBeGreaterThanOrEqual(44);
    expect(r.closeH).toBeGreaterThanOrEqual(44);
  });

  test('a quick meal needs a purpose and is flagged for the 50% limit', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(({ CID, BID }) => {
      showQuickExpenseModal(CID, BID);
      document.getElementById('qe-vendor').value = 'Diner';
      document.getElementById('qe-amount').value = '30.00';
      document.getElementById('qe-cat').value = 'meals';
      _qeCatChange('meals');
      saveQuickExpense(CID);
      const blocked = !expenses.some(x => x.vendor === 'Diner');
      document.querySelectorAll('.zmodal-overlay').forEach(o => { if (/business purpose/i.test(o.textContent) && !o.querySelector('#qe-cat')) o.remove(); });
      document.getElementById('qe-meal-purpose').value = 'Walkthrough with the GC';
      saveQuickExpense(CID);
      const e = expenses.find(x => x.vendor === 'Diner');
      return { blocked, cat: e && e.cat, m50: e && e.meals_50, purpose: e && e.meal_purpose };
    }, { CID, BID });
    expect(r.blocked).toBe(true);
    expect(r.cat).toBe('meals');
    expect(r.m50).toBe(true);
    expect(r.purpose).toBe('Walkthrough with the GC');
  });

  test('meals deduct at 50% in the tax math, and the Taxes screen says so', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(() => {
      const yr = String(new Date().getFullYear());
      expenses.push({ id: 7710300, date: yr + '-06-12', cat: 'meals', meals_50: true, vendor: 'Diner', amount: 200 });
      const T = taxYearSnapshot(yr);
      _taxPageYear = parseInt(yr, 10); calcTax();
      return { raw: T.tExRaw, dis: T.mealsDisallowed, tEx: T.tEx, net: T.netSelf, row: (document.getElementById('tx-meals-50') || {}).textContent || '' };
    });
    expect(r.raw).toBe(380);
    expect(r.dis).toBe(100);
    expect(r.tEx).toBe(280);
    expect(r.net).toBe(1067.5);
    expect(r.row).toContain('Meals count at 50%: $100.00 of $200.00 left out');
  });

  test('Books uses readable category names and knows a payments-only year', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(() => {
      payments.push({ id: 7710400, bid_id: 7710002, date: '2023-05-01', amount: 900 });
      trackerYear = new Date().getFullYear(); renderSummary();
      return { exp: document.getElementById('sum-exp').textContent, years: getTrackerYears() };
    });
    expect(r.exp).toContain('Materials & supplies');
    expect(r.exp).not.toMatch(/\bmaterials\b/);
    expect(r.years).toContain(2023);
  });
});

test.describe('Earl: quarterly estimates', () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'earl quarters'); });

  test('2026 due dates are Apr 15, Jun 15, Sep 15 and Jan 15 2027', async ({ page }) => {
    await boot(page);
    const d = await page.evaluate(() => taxQuarterDates(2026).map(q => q.q + ' ' + q.date.getFullYear() + '-' + String(q.date.getMonth() + 1).padStart(2, '0') + '-' + String(q.date.getDate()).padStart(2, '0')));
    expect(d).toEqual(['Q1 2026-04-15', 'Q2 2026-06-15', 'Q3 2026-09-15', 'Q4 2027-01-15']);
  });

  test('a weekend or holiday moves the date to the next business day', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return {
        apr2028: iso(irsDueDate(2028, 3, 15)),   // Sat, then Emancipation Day observed Mon 17: Tue 18
        jan2028: iso(irsDueDate(2028, 0, 15)),   // Sat, then MLK Day Mon 17: Tue 18
        jun2025: iso(irsDueDate(2025, 5, 15)),   // Sunday: Mon 16
        sep2029: iso(irsDueDate(2029, 8, 15)),   // Saturday: Mon 17
        apr2027: iso(irsDueDate(2027, 3, 15)),   // Thursday: stays
      };
    });
    expect(r).toEqual({ apr2028: '2028-04-18', jan2028: '2028-01-18', jun2025: '2025-06-16', sep2029: '2029-09-17', apr2027: '2027-04-15' });
  });

  test('the next quarter: one installment, federal only, with the catch-up if he is behind', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      income.length = 0; payments.length = 0; expenses.length = 0; mileage.length = 0;
      payments.push({ id: 1, bid_id: 1, date: '2026-03-01', amount: 60000 });
      ['tx-spouse', 'tx-prior-yr', 'tx-prior-yr-agi'].forEach(id => { document.getElementById(id).value = '0'; });
      document.getElementById('tx-paid').value = '0';
      const T = taxYearSnapshot('2026');
      const behind = taxNextQuarter(T, new Date(2026, 6, 1));   // July 1: Q3 is next
      document.getElementById('tx-paid').value = String(Math.ceil(T.fedTotal * 2 / 4));
      const caughtUp = taxNextQuarter(taxYearSnapshot('2026'), new Date(2026, 6, 1));
      const done = taxNextQuarter(T, new Date(2027, 1, 1));
      document.getElementById('tx-paid').value = '0';
      return { fed: T.fedTotal, state: T.stateTotal, behind, caughtUp, done };
    });
    const inst = Math.ceil(r.fed / 4);
    const dueBy = n => Math.ceil(r.fed * n / 4);   // cumulative: four quarters add up to the year exactly
    expect(r.behind.q).toBe('Q3');
    expect(r.behind.installment).toBe(inst);
    expect(r.behind.amount).toBe(dueBy(3));
    expect(r.behind.catchUp).toBe(dueBy(2));
    expect(r.behind.stateInstallment).toBe(Math.ceil(r.state / 4));
    expect(r.caughtUp.amount).toBe(dueBy(3) - dueBy(2));
    expect(r.caughtUp.catchUp).toBe(0);
    expect(r.done).toBe(null);
  });

  test('the Taxes card shows one quarter and no hardcoded Jun 16', async ({ page }) => {
    await boot(page);
    await seedEarl(page);
    const r = await page.evaluate(() => {
      _taxPageYear = new Date().getFullYear(); calcTax();
      const el = document.getElementById('tx-quarters');
      const T = taxYearSnapshot(String(_taxPageYear));
      const nq = taxNextQuarter(T, new Date());
      const earl = taxNextQuarter(T, new Date(_taxPageYear, 8, 27));   // Sep 27: Q3 has passed, Q4 is next, nothing paid
      return { html: el.innerHTML, next: !!document.getElementById('tx-next-q'), amts: el.querySelectorAll('#tx-next-q-amt').length,
        shown: (document.getElementById('tx-next-q-amt') || {}).textContent || null, want: nq ? fmt(nq.amount) : null, earl };
    });
    if (r.want) expect(r.shown).toBe(r.want);
    expect(r.earl.q).toBe('Q4');
    expect(r.earl.amount).toBe(165);
    expect(r.earl.catchUp).toBe(124);
    expect(r.next).toBe(true);
    expect(r.amts).toBeLessThanOrEqual(1);
    expect(r.html).not.toContain('Jun 16');
    expect(r.html).toContain('Jun 15');
  });
});

test.describe('Earl: expenses, lien and sync', () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'earl expenses'); });

  test('expense sheet: 44px close, a native date input on today, and save keeps him on Home', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      goPg('pg-dash');
      openExpenseFlow();
      const c = document.querySelector('#expense-modal button[aria-label="Close"]').getBoundingClientRect();
      const d = document.getElementById('em-date');
      return { w: c.width, h: c.height, type: d.type, val: d.value, today: todayKey() };
    });
    expect(r.w).toBeGreaterThanOrEqual(44);
    expect(r.h).toBeGreaterThanOrEqual(44);
    expect(r.type).toBe('date');
    expect(r.val).toBe(r.today);
    const saved = await page.evaluate(async () => {
      document.getElementById('em-vendor').value = 'Ferguson Stay';
      document.getElementById('em-amount').value = '12.34';
      await expSave();
      return { page: document.querySelector('.pg.active').id, e: !!expenses.find(x => x.vendor === 'Ferguson Stay') };
    });
    expect(saved.e).toBe(true);
    expect(saved.page).toBe('pg-dash');
  });

  test('a possible duplicate asks in the app, never the browser, and Save anyway saves it', async ({ page }) => {
    await boot(page);
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.dismiss(); });
    await page.evaluate(async () => {
      expenses.push({ id: 7710500, date: todayKey(), cat: 'materials', vendor: 'Dup Supply', amount: 55 });
      openExpenseFlow();
      document.getElementById('em-vendor').value = 'Dup Supply';
      document.getElementById('em-amount').value = '55';
      await expSave();
    });
    const ask = page.locator('.zmodal-overlay', { hasText: 'Possible duplicate' });
    await expect(ask).toHaveCount(1);
    expect(await page.evaluate(() => expenses.filter(x => x.vendor === 'Dup Supply').length)).toBe(1);
    await ask.locator('#zmodal-yes').click();
    await expect.poll(() => page.evaluate(() => expenses.filter(x => x.vendor === 'Dup Supply').length)).toBe(2);
    expect(dialogs).toBe(0);
  });

  test('the lien form fills the job county from the county record, and is blank when unknown', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      clients.push({ id: 7718001, name: 'Topeka Owner', addr: '12 Oak St, Topeka, KS 66603', propDataCounty: 'Shawnee, KS' });
      clients.push({ id: 7718002, name: 'Texas Owner', addr: '9 Elm St, Austin, TX 78701' });
      bids.push({ id: 7718101, client_id: 7718001, client_name: 'Topeka Owner', amount: 900, status: 'Closed Won', addr: '12 Oak St, Topeka, KS 66603' });
      bids.push({ id: 7718102, client_id: 7718002, client_name: 'Texas Owner', amount: 900, status: 'Closed Won', addr: '9 Elm St, Austin, TX 78701' });
      openLienPanel(7718101);
      const a = document.getElementById('lien-county').value;
      openLienPanel(7718102);
      const b = document.getElementById('lien-county').value;
      closeLienPanel();
      return { a, b, ph: document.getElementById('lien-county').placeholder };
    });
    expect(r.a).toBe('Shawnee County');
    expect(r.b).toBe('');
    expect(r.ph).not.toContain('Sedgwick');
  });

  // Root cause (js/cloud.js _opShadowDerive): the first save of a session
  // baselined live memory as "already known", so a row created before the first
  // cloud load finished never got a CREATE op, and the load's array replace
  // (which only re-appends pending creates) dropped it for good.
  test('money recorded before the first cloud load finishes survives that load', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      income.push({ id: 7717001, date: todayKey(), amount: 250, type: 'Cash job' });
      saveAll();
    });
    await expect.poll(() => page.evaluate(() => _loadedDataOwner), { timeout: 15000 }).toBeTruthy();
    const r = await page.evaluate(() => income.filter(x => x.id === 7717001).length);
    expect(r).toBe(1);
  });
});
