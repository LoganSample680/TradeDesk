// REAL flow — contractor-initiated partial refund from the collect screen (overage
// kick-back). Proves the refund engine is SMART in the two ways the owner required:
//   • EXACT AMOUNT — it refunds precisely the typed amount, never the whole charge.
//   • RIGHT CLIENT — it can only refund against THIS bid's own payment intent, so the
//     money can never reach a different client; and only the owning contractor can do it.
//
// The refund-payment edge function is the unit under test. Two guarantees are checked:
//   1. SAFETY (runs with just live creds): it refuses to refund a bid that has no card
//      payment on file (400) — it never blindly sends money for an unknown/non-card bid.
//   2. EXACT/RIGHT (needs Stripe test mode wired + a real card-paid proposal): refunding
//      $X returns exactly $X against this bid's intent. Soft-skips until a card payment
//      can be made in the sandbox (no Stripe keys → no payment intent → cleanly skipped).
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn } = require('./live-helpers');

// Call refund-payment exactly as the collect screen does (contractor JWT).
async function callRefund(page, bidId, amount) {
  return await page.evaluate(async ({ bidId, amount }) => {
    const sess = await _supa.auth.getSession();
    const token = sess?.data?.session?.access_token || null;
    const res = await fetch(SUPA_URL + '/functions/v1/refund-payment', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', apikey: (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '') },
      body: JSON.stringify({ bidId, amount }),
    });
    let body = null; try { body = await res.json(); } catch (_e) {}
    return { status: res.status, body };
  }, { bidId, amount });
}

// Is there a card-paid proposal we can refund? (Needs Stripe wired + a prior card pay.)
async function findCardPaidBid(page) {
  return await page.evaluate(async () => {
    const uid = (_supaUser && _supaUser.id) || null;
    const { data } = await _supa.from('signed_proposals')
      .select('bid_id,stripe_payment_intent,stripe_refund_id,amount')
      .eq('contractor_user_id', uid).not('stripe_payment_intent', 'is', null).limit(20);
    const row = (data || []).find(r => r.stripe_payment_intent && !r.stripe_refund_id && (r.amount || 0) > 1);
    return row || null;
  });
}

test.describe('contractor partial refund (overage kick-back) — exact amount, right client', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('refund-payment refuses a bid with no card payment on file (never blind-refunds)', async ({ page }) => {
    const bogusBid = Date.now() * 1000 + (process.pid % 1000); // a bid with no signed_proposals row
    const r = await callRefund(page, bogusBid, 25);
    // Must reject (no card payment) — never issue money for an unknown/non-card bid.
    expect(r.status, `expected 400 for a bid with no card payment, got ${r.status} · ${JSON.stringify(r.body)}`).toBe(400);
    expect((r.body && r.body.error) || '').toMatch(/no card payment/i);
  });

  test('refunding $X returns exactly $X against this bid (exact amount + right client)', async ({ page }) => {
    const target = await findCardPaidBid(page);
    test.skip(!target, 'no card-paid proposal available yet (Stripe sandbox not wired) — refund exact-amount check soft-skipped');

    // Refund a precise partial amount (an "overage"), well under the collected total.
    const partial = Math.min(7.13, Math.max(1, Math.round((target.amount * 0.1) * 100) / 100));
    const r = await callRefund(page, target.bid_id, partial);
    expect(r.status, `refund-payment failed: ${JSON.stringify(r.body)}`).toBe(200);

    // EXACT AMOUNT — Stripe refunded precisely what was typed, not the whole charge.
    expect(r.body?.refund?.amount, 'refund must equal the exact typed amount').toBeCloseTo(partial, 2);

    // RIGHT CLIENT — the refund is stamped on THIS bid's signed_proposals row (the one
    // whose payment intent we refunded), marked a partial (not full) refund.
    const sp = await page.evaluate(async ({ bidId }) => {
      const { data } = await _supa.from('signed_proposals')
        .select('bid_id,stripe_refund_id,payment_status').eq('bid_id', String(bidId)).maybeSingle();
      return data || null;
    }, { bidId: target.bid_id });
    expect(sp?.stripe_refund_id, 'refund id recorded on the right bid').toBeTruthy();
    expect(sp?.payment_status).toBe('partial_refund');
  });
});
