// @ts-check
/**
 * Collect panel: the full amount is always payable.
 *
 * Owner report 2026-08-15: "collect screen in make money today doesn't allow the
 * full thing to be paid." Root cause was two-fold in js/bids.js:
 *   1. selectPayType() set readOnly=true on #mpay-amount for the deposit and
 *      final types, so a client who handed over the WHOLE job at deposit time
 *      (or a partial cheque against the balance) could not be recorded at all.
 *   2. The unselected "Collect <full balance>" button was drawn as solid green at
 *      45% opacity, which reads as a disabled control.
 * Plus a related wrong-number bug: the deposit preset was hardcoded to 25% of the
 * total, ignoring the deposit the bid actually contracted for.
 *
 * These tests are the permanent guard (CLAUDE.md §13.4): they fail if the amount
 * field is ever locked again, if the full-balance button is dimmed, or if the
 * deposit preset stops honouring bid.deposit.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CLIENT_ID = 940001;
const BID_25 = 940100;   // no explicit deposit → falls back to 25%
const BID_50 = 940200;   // contracted 50% deposit
const BID_BAL = 940300;  // completed job, part paid, balance owing

test.describe('Collect panel: full amount is always payable', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(([cid, b25, b50, bbal]) => {
      clients.push({ id: cid, name: 'Collect Test Client', phone: '3165550199', addr: '9 Test St' });
      bids.push({ id: b25, client_id: cid, client_name: 'Collect Test Client', amount: 5000, status: 'Closed Won' });
      bids.push({ id: b50, client_id: cid, client_name: 'Collect Test Client', amount: 8000, deposit: 4000, status: 'Closed Won' });
      bids.push({ id: bbal, client_id: cid, client_name: 'Collect Test Client', amount: 5000, deposit: 1250, status: 'Closed Won', completion_date: todayKey() });
      payments.push({ id: 9401000, bid_id: bbal, client_id: cid, date: todayKey(), type: 'deposit', amount: 1250, method: 'Check' });
    }, [CLIENT_ID, BID_25, BID_50, BID_BAL]);
  });

  test.afterEach(() => { assertNoErrors(page, 'collect panel'); });

  test('deposit auto-select still shows the full balance as a live green button', async () => {
    const r = await page.evaluate(async (bid) => {
      openPayPanel(bid, 'deposit');
      await new Promise(res => setTimeout(res, 150));
      const cb = document.getElementById('mpay-btn-final');
      const st = getComputedStyle(cb);
      return {
        exists: !!cb,
        text: cb.textContent.replace(/\s+/g, ' ').trim(),
        opacity: parseFloat(st.opacity),
        selectedType: document.getElementById('mpay-type').value,
      };
    }, BID_25);
    expect(r.exists).toBe(true);
    // The full contract value, offered even though deposit is the selected type
    expect(r.text).toContain('$5,000.00');
    // Never dimmed: a 45%-opacity green button reads as disabled
    expect(r.opacity).toBeGreaterThanOrEqual(0.99);
    expect(r.selectedType).toBe('deposit');
  });

  test('deposit amount is editable, not locked', async () => {
    const r = await page.evaluate(async (bid) => {
      openPayPanel(bid, 'deposit');
      await new Promise(res => setTimeout(res, 150));
      const amt = document.getElementById('mpay-amount');
      return { readOnly: amt.readOnly, value: amt.value };
    }, BID_25);
    expect(r.readOnly).toBe(false);
    expect(r.value).toBe('1,250.00'); // 25% fallback when the bid set no deposit
  });

  test('deposit preset honours the deposit the bid contracted for', async () => {
    const r = await page.evaluate(async (bid) => {
      openPayPanel(bid, 'deposit');
      await new Promise(res => setTimeout(res, 150));
      const secondary = document.getElementById('mpay-btn-deposit');
      return {
        amount: document.getElementById('mpay-amount').value,
        label: secondary ? secondary.textContent.replace(/\s+/g, ' ').trim() : null,
      };
    }, BID_50);
    expect(r.amount).toBe('4,000.00');       // not 25% ($2,000)
    expect(r.label).toContain('Deposit 50%');
  });

  test('the whole job can be collected from the deposit card', async () => {
    const r = await page.evaluate(async (bid) => {
      openPayPanel(bid, 'deposit');
      await new Promise(res => setTimeout(res, 150));
      // The contractor was handed the WHOLE job, so they tap the full-balance button
      document.getElementById('mpay-btn-final').click();
      const amt = document.getElementById('mpay-amount');
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const err = document.getElementById('mpay-err');
      return {
        typed: amt ? amt.value : null,
        errShown: err ? err.style.display !== 'none' : false,
        errText: err ? err.textContent : '',
        paid: getBidPaid(bid),
        balance: getBidBalance(bids.find(b => b.id === bid)),
      };
    }, BID_25);
    expect(r.errShown).toBe(false);
    expect(r.paid).toBeCloseTo(5000, 2);
    expect(r.balance).toBeCloseTo(0, 2);
  });

  test('a typed partial amount against the balance is recorded', async () => {
    const r = await page.evaluate(async (bid) => {
      openPayPanel(bid);
      await new Promise(res => setTimeout(res, 150));
      document.getElementById('mpay-btn-final').click();
      const amt = document.getElementById('mpay-amount');
      amt.value = '1,000.00';   // client paid part of the $3,750 balance
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const err = document.getElementById('mpay-err');
      return {
        errShown: err ? err.style.display !== 'none' : false,
        paid: getBidPaid(bid),
        balance: getBidBalance(bids.find(b => b.id === bid)),
      };
    }, BID_BAL);
    expect(r.errShown).toBe(false);
    expect(r.paid).toBeCloseTo(2250, 2);   // 1250 deposit + 1000
    expect(r.balance).toBeCloseTo(2750, 2);
  });

  test('editable field still refuses more than the balance', async () => {
    const r = await page.evaluate(async (bid) => {
      const before = payments.filter(p => p.bid_id === bid).length;
      openPayPanel(bid);
      await new Promise(res => setTimeout(res, 150));
      document.getElementById('mpay-btn-final').click();
      document.getElementById('mpay-amount').value = '99,999.00';
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const err = document.getElementById('mpay-err');
      const after = payments.filter(p => p.bid_id === bid).length;
      closePayPanel();
      return { before, after, errShown: err ? err.style.display !== 'none' : false, errText: err ? err.textContent : '' };
    }, BID_BAL);
    expect(r.after).toBe(r.before);
    expect(r.errShown).toBe(true);
    expect(r.errText).toContain('exceeds balance');
  });
});
