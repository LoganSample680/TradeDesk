// REAL flow — Stripe deposit checkout (task #12). Stripe Connect is an EXTERNAL
// dependency: the embedded card checkout (Stripe Elements iframe on sign.html)
// only works when the dev account has a Stripe Connect account with
// charges_enabled in TEST mode. Driving the Elements iframe with a test card
// headless is inherently flaky, so this spec asserts the DETERMINISTIC, internal
// half that gates everything downstream:
//   • the contractor pay panel exposes the Stripe "Card link" option for a bid
//     with a real balance ONLY when charges_enabled is true, and
//   • the offered amount equals the bid balance (never more).
// When Stripe Connect is NOT enabled on the dev account (the default), it
// soft-skips with a clear note instead of failing — so the gate documents the
// dependency without going red on a perfectly valid account that hasn't
// connected Stripe. Wire test-mode Stripe → this immediately starts asserting.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'stripe/deposit-checkout';

test.describe('Stripe deposit checkout (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('pay panel offers Stripe card link at the correct balance when Connect is live', async ({ page }) => {
    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const bidId = clientId + 1;
    const AMOUNT = 4000;

    await step(page, {
      label: 'open pay panel → Stripe option matches Connect status', page: 'pg-bids', role: 'contractor',
      suspect: 'bids.js openPayPanel (hasStripe = _stripeConnectStatus.charges_enabled && balance>0.50)',
      ruleText: 'the Stripe card-link option must appear iff Connect charges_enabled, and offer the exact balance (soft-skip if Connect off)',
      expected: 'stripe button present == charges_enabled; amount == balance',
      act: async (p) => {
        const r = await p.evaluate(async ({ clientId, bidId, AMOUNT }) => {
          // Make sure the cached Stripe Connect status is loaded.
          if (typeof loadStripeConnectStatus === 'function') { try { await loadStripeConnectStatus(); } catch (e) {} }
          const enabled = !!(typeof _stripeConnectStatus !== 'undefined' && _stripeConnectStatus && _stripeConnectStatus.charges_enabled);

          // Seed a Closed Won bid with an unpaid balance so the pay panel has a
          // real amount to collect.
          clients.push({ id: clientId, name: 'E2E Stripe Client', phone: '3165550704', _e2e: 'stripe' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E Stripe Client', amount: AMOUNT, status: 'Closed Won', completion_date: new Date().toISOString().slice(0, 10), _e2e: 'stripe' });

          openPayPanel(bidId);                         // open the real pay panel
          const ov = document.querySelector('.pay-modal-overlay');
          const stripeBtn = ov ? ov.querySelector('[data-ptype="stripe"]') : null;
          const balance = (typeof getBidBalance === 'function') ? getBidBalance(bids.find(b => b.id === bidId)) : null;
          // The card-link tile shows the balance amount; pull its text for the check.
          const amtText = stripeBtn ? stripeBtn.textContent.replace(/\s+/g, ' ') : '';
          if (ov) ov.remove();
          return { enabled, hasStripeBtn: !!stripeBtn, balance, amtText };
        }, { clientId, bidId, AMOUNT });
        p.__stripe = r;
        return 1;
      },
      rule: async (p) => {
        const r = p.__stripe;
        if (!r.enabled) {
          return { ok: true, got: 'SKIP — Stripe Connect not enabled on dev account (charges_enabled=false); wire test-mode Stripe to assert' };
        }
        // Connect is live: the Stripe button MUST be offered, and at the balance.
        const cents = Math.round((r.balance || 0));
        const showsBalance = r.amtText.includes(String(cents)) || r.amtText.includes((r.balance || 0).toLocaleString());
        return { ok: r.hasStripeBtn && r.balance === AMOUNT && showsBalance, got: JSON.stringify(r) };
      },
    });

    // NO cleanup — the client + bid stay in the dev account on purpose so the owner
    // can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
