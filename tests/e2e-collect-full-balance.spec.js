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
      window._stripeConnectStatus = { charges_enabled: true };
      openPayPanel(bid);
      const opts = [...document.querySelectorAll('#mpay-type-btns button')]
        .map(b => ({ m: b.dataset.pmethod || null, t: b.textContent.replace(/\s+/g, ' ').trim() }));
      window._stripeConnectStatus = null;
      return { count: opts.length, opts };
    }, BID_25);
    expect(r.count).toBe(3);
    expect(r.opts[0].m).toBe('manual');
    expect(r.opts[0].t).toContain('Log it');
    expect(r.opts[1].m).toBe('stripe');
    expect(r.opts[1].t).toContain('Send link');
    expect(r.opts[2].m).toBe(null);          // tap to pay is not selectable yet
    expect(r.opts[2].t).toContain('Tap to pay');
  });

  // Owner rule 2026-08-15: "paying through client hub via card and tap to pay should
  // be grey until stripe is connected." Both charge through the connected account, so
  // neither can work without it. Greyed and locked, never hidden, and never dead.
  test('both card routes are locked and greyed until Stripe is connected', async () => {
    const r = await page.evaluate((bid) => {
      window._stripeConnectStatus = null;
      openPayPanel(bid);
      const btns = [...document.querySelectorAll('#mpay-type-btns button')];
      const hub = btns.find(b => /Send link/i.test(b.textContent));
      const tap = btns.find(b => /Tap to pay/i.test(b.textContent));
      const out = {
        // Locked: not selectable as a method, so selectPayType can never land on it
        hubSelectable: !!hub.dataset.pmethod,
        tapSelectable: !!tap.dataset.pmethod,
        hubLocked: hub.dataset.plocked || null,
        tapLocked: tap.dataset.plocked || null,
        hubOpacity: parseFloat(getComputedStyle(hub).opacity),
        tapOpacity: parseFloat(getComputedStyle(tap).opacity),
        hubText: hub.textContent.replace(/\s+/g, ' ').trim(),
        tapText: tap.textContent.replace(/\s+/g, ' ').trim(),
        // Not dead: both route to the one thing that unlocks them
        hubClick: hub.getAttribute('onclick'),
        tapClick: tap.getAttribute('onclick'),
      };
      // Manual is unaffected by the gate, cash never needed Stripe
      out.manualSelectable = !!btns.find(b => b.dataset.pmethod === 'manual');
      out.manualOpacity = parseFloat(getComputedStyle(btns[0]).opacity);
      closePayPanel();
      return out;
    }, BID_25);
    expect(r.hubSelectable).toBe(false);
    expect(r.tapSelectable).toBe(false);
    expect(r.hubLocked).toBe('stripe');
    expect(r.tapLocked).toBe('tap');
    expect(r.hubOpacity).toBeLessThan(0.7);
    expect(r.tapOpacity).toBeLessThan(0.7);
    // Grey is the whole signal (owner 2026-08-15: no LOCKED badge). The reason is
    // delivered by the tap, so what must hold is that the tap goes somewhere useful.
    expect(r.hubClick).toBe('_mpayNeedStripe()');
    expect(r.tapClick).toBe('_mpayNeedStripe()');
    expect(r.manualSelectable).toBe(true);
    expect(r.manualOpacity).toBeGreaterThanOrEqual(0.99);
  });

  test('connecting Stripe unlocks the hub route and leaves tap to pay unavailable', async () => {
    const r = await page.evaluate((bid) => {
      window._stripeConnectStatus = { charges_enabled: true };
      openPayPanel(bid);
      const btns = [...document.querySelectorAll('#mpay-type-btns button')];
      const hub = btns.find(b => /Send link/i.test(b.textContent));
      const tap = btns.find(b => /Tap to pay/i.test(b.textContent));
      const out = {
        hubSelectable: !!hub.dataset.pmethod,
        hubOpacity: parseFloat(getComputedStyle(hub).opacity),
        hubText: hub.textContent.replace(/\s+/g, ' ').trim(),
        tapText: tap.textContent.replace(/\s+/g, ' ').trim(),
        tapClick: tap.getAttribute('onclick'),
      };
      closePayPanel();
      window._stripeConnectStatus = null;
      return out;
    }, BID_25);
    expect(r.hubSelectable).toBe(true);
    expect(r.hubOpacity).toBeGreaterThanOrEqual(0.99);
    expect(r.hubText.toLowerCase()).not.toContain('locked');
    expect(r.tapClick).toBe('_tapToPaySoon()');   // Stripe is not tap-to-pay's only blocker
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
    expect(r.chip).toBe('Deposit $4,000');
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
      window._stripeConnectStatus = { charges_enabled: true };
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
      window._stripeConnectStatus = null;
      return out;
    }, BID_BAL);
    expect(r.detailsHidden).toBe(true);
    expect(r.hubShown).toBe(true);
    expect(r.type).toBe('stripe');
    expect(r.submit).toBe('Send the link');
    expect(r.backToManual).toBe(true);
  });

  // "How they paid" is pills, not a <select>: one tap instead of open-scroll-confirm.
  // #mpay-method stays a real field so logPayment and every caller read one value.
  test('payment method is one tap, and the reference placeholder follows it', async () => {
    const r = await page.evaluate((bid) => {
      openPayPanel(bid);
      const pills = [...document.querySelectorAll('#mpay-method-pills button[data-pmeth]')].map(b => b.dataset.pmeth);
      const out = { pills, initial: document.getElementById('mpay-method').value };
      out.initialPlaceholder = document.getElementById('mpay-ref').placeholder;
      document.querySelector('#mpay-method-pills button[data-pmeth="Venmo"]').click();
      out.afterTap = document.getElementById('mpay-method').value;
      out.venmoPlaceholder = document.getElementById('mpay-ref').placeholder;
      // The old <select> API still works for anything that sets the field directly
      document.getElementById('mpay-method').value = 'Cash';
      out.settable = document.getElementById('mpay-method').value;
      closePayPanel();
      return out;
    }, BID_BAL);
    expect(r.pills).toEqual(['Cash', 'Check', 'Venmo', 'Zelle', 'Card', 'Other']);
    expect(r.initial).toBe('Check');
    expect(r.initialPlaceholder).toContain('Check #');
    expect(r.afterTap).toBe('Venmo');          // ONE tap, no select to open
    expect(r.venmoPlaceholder).toContain('Reference');
    expect(r.settable).toBe('Cash');
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

  // The modal must never sit under the status bar / Dynamic Island, and its top
  // must stay reachable when it is taller than the screen (owner screenshot
  // 2026-08-15: the "Get paid" title was behind the clock). Centring a flex child
  // taller than its scroll container clips the top with no way to scroll up;
  // flex-start + margin:auto centres short modals and keeps tall ones reachable.
  for (const vh of [844, 640, 560]) {
    test(`modal clears the status bar and stays reachable at 390x${vh}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: vh }, bypassCSP: true });
      const p2 = await ctx.newPage();
      await mockAllExternal(p2);
      await p2.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitForAppBoot(p2);
      const r = await p2.evaluate(() => {
        clients.push({ id: 940900, name: 'Safe Area', phone: '3165550100', addr: '1 A St' });
        bids.push({ id: 940901, client_id: 940900, client_name: 'Safe Area', amount: 5000, deposit: 1250, status: 'Closed Won', completion_date: todayKey() });
        openPayPanel(940901);
        const ov = document.querySelector('.pay-modal-overlay');
        const m = ov.querySelector('.zmodal');
        const cs = getComputedStyle(ov);
        ov.scrollTop = -99999;                       // try as hard as possible to reach the top
        return {
          align: cs.alignItems,
          padTop: parseFloat(cs.paddingTop),
          modalTop: m.getBoundingClientRect().top,
          titleTop: m.querySelector('div').getBoundingClientRect().top,
          overflow: cs.overflowY,
        };
      });
      await ctx.close();
      expect(r.align).toBe('flex-start');            // never center: it clips tall modals
      expect(r.overflow).toBe('auto');
      // Phone widths use the 10px floor; on a notched device the same rule resolves
      // to env(safe-area-inset-top) + 8, which is what clears the Dynamic Island.
      expect(r.padTop).toBeGreaterThanOrEqual(10);
      // The card never starts above its own padding, so nothing hides under the notch
      expect(r.modalTop).toBeGreaterThanOrEqual(r.padTop - 1);
      expect(r.titleTop).toBeGreaterThan(0);
    });
  }
});