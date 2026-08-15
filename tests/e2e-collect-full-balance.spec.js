// @ts-check
/**
 * The pay panel: three ways to get paid, and the full amount is always payable.
 *
 * Owner directive 2026-08-15: "the current payment screen on collect which action and
 * everywhere else has a ton of shit bolted on it... manual way to log money (Venmo,
 * cash, check), a way to send them their client hub where they can pay online (middle
 * option), and last one, tap to pay."
 *
 * The panel it replaced stacked a full-balance button, a tap-to-pay strip, a card-link
 * tile, a QR tile, a deposit preset and a custom-amount button on one screen, and the
 * amount field was readOnly for the deposit and final types, so "it only lets me hit
 * the deposit": whatever number the app computed was the only number recordable.
 *
 * These tests are the permanent guard (CLAUDE.md §13.4): they fail if a fourth option
 * gets bolted on, if the amount field is ever locked again, if picking an amount chip
 * traps the panel on that amount, or if the deposit preset stops honouring bid.deposit.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CLIENT_ID = 940001;
const BID_25 = 940100;   // no explicit deposit → falls back to 25%
const BID_50 = 940200;   // contracted 50% deposit
const BID_BAL = 940300;  // completed job, part paid, balance owing

test.describe('Pay panel: three options, full amount always payable', () => {
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

  test.afterEach(() => { assertNoErrors(page, 'pay panel'); });

  test('exactly three ways to pay, in order: manual, their link, tap to pay', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
      const opts = [...document.querySelectorAll('#mpay-type-btns button')]
        .map(b => ({ m: b.dataset.pmethod || null, t: b.textContent.replace(/\s+/g, ' ').trim() }));
      return { count: opts.length, opts };
    }, BID_25);
    expect(r.count).toBe(3);
    expect(r.opts[0].m).toBe('manual');
    expect(r.opts[0].t).toContain('Log a payment');
    expect(r.opts[0].t).toMatch(/Cash, check, Venmo/);
    expect(r.opts[1].m).toBe('stripe');
    expect(r.opts[1].t).toContain('Send their payment link');
    expect(r.opts[2].m).toBe(null);          // tap to pay is not selectable yet
    expect(r.opts[2].t).toContain('Tap to pay');
  });

  test('manual is pre-selected with the balance filled in and editable', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
      const amt = document.getElementById('mpay-amount');
      return {
        detailsShown: document.getElementById('mpay-detail-fields').style.display !== 'none',
        value: amt.value,
        readOnly: amt.readOnly,
        type: document.getElementById('mpay-type').value,
        submit: document.getElementById('mpay-submit-btn').textContent,
      };
    }, BID_25);
    expect(r.detailsShown).toBe(true);
    expect(r.value).toBe('5,000.00');
    expect(r.readOnly).toBe(false);
    expect(r.type).toBe('final');
    expect(r.submit).toBe('Record payment');
  });

  test('a deposit entry point fills the deposit but never locks the panel to it', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid, 'deposit');
      const before = document.getElementById('mpay-amount').value;
      // The client handed over the whole job: one tap on the balance chip
      document.getElementById('mpay-btn-final').click();
      return {
        before,
        after: document.getElementById('mpay-amount').value,
        readOnly: document.getElementById('mpay-amount').readOnly,
        type: document.getElementById('mpay-type').value,
      };
    }, BID_25);
    expect(r.before).toBe('1,250.00');   // 25% fallback when the bid set no deposit
    expect(r.after).toBe('5,000.00');
    expect(r.readOnly).toBe(false);
    expect(r.type).toBe('final');
  });

  test('the deposit chip honours the deposit the bid contracted for', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid, 'deposit');
      const chip = document.getElementById('mpay-btn-deposit');
      return {
        amount: document.getElementById('mpay-amount').value,
        chip: chip ? chip.textContent.replace(/\s+/g, ' ').trim() : null,
      };
    }, BID_50);
    expect(r.amount).toBe('4,000.00');      // not 25% ($2,000)
    expect(r.chip).toBe('Deposit $4,000.00');
  });

  test('the whole job can be collected from a deposit entry point', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid, 'deposit');
      document.getElementById('mpay-btn-final').click();
      document.getElementById('mpay-date').value = todayKey();
      logPayment();
      const err = document.getElementById('mpay-err');
      return {
        errShown: err ? err.style.display !== 'none' : false,
        paid: getBidPaid(bid),
        balance: getBidBalance(bids.find(b => b.id === bid)),
      };
    }, BID_25);
    expect(r.errShown).toBe(false);
    expect(r.paid).toBeCloseTo(5000, 2);
    expect(r.balance).toBeCloseTo(0, 2);
  });

  test('a typed partial amount against the balance is recorded', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
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
    const r = await page.evaluate((bid) => {
      const before = payments.filter(p => p.bid_id === bid).length;
      openPayPanel(bid);
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

  test('the payment-link option swaps the form for the hub explainer', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
      document.querySelector('#mpay-type-btns button[data-pmethod="stripe"]').click();
      const out = {
        detailsHidden: document.getElementById('mpay-detail-fields').style.display === 'none',
        hubShown: document.getElementById('mpay-hub-fields').style.display !== 'none',
        type: document.getElementById('mpay-type').value,
        submit: document.getElementById('mpay-submit-btn').textContent,
      };
      // ...and going back to manual restores the money form
      document.querySelector('#mpay-type-btns button[data-pmethod="manual"]').click();
      out.backToManual = document.getElementById('mpay-detail-fields').style.display !== 'none'
        && document.getElementById('mpay-hub-fields').style.display === 'none';
      closePayPanel();
      return out;
    }, BID_BAL);
    expect(r.detailsHidden).toBe(true);
    expect(r.hubShown).toBe(true);
    expect(r.type).toBe('stripe');
    expect(r.submit).toBe('Send the link');
    expect(r.backToManual).toBe(true);
  });

  test('refunds stay tucked behind one text link, not bolted onto the panel', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
      const adj = document.getElementById('_mpay-adj-btns');
      const hiddenAtRest = adj.style.display === 'none';
      _mpayToggleAdj();
      const shown = adj.style.display !== 'none';
      const refundBtn = adj.querySelector('[data-pmethod="refund"]');
      refundBtn.click();
      const out = {
        hiddenAtRest, shown,
        type: document.getElementById('mpay-type').value,
        submit: document.getElementById('mpay-submit-btn').textContent,
      };
      closePayPanel();
      return out;
    }, BID_BAL);
    expect(r.hiddenAtRest).toBe(true);
    expect(r.shown).toBe(true);
    expect(r.type).toBe('refund');
    expect(r.submit).toBe('Issue refund');
  });
});
