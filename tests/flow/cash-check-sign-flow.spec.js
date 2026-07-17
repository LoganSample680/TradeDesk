// REAL money-chain flow, a sent proposal gets SIGNED and marked paid by cash/check,
// with the full audit record. No Stripe required (the cash/check path writes the
// signature + payment intent directly). This is the "legit proposals actually signed
// and marked paid, visible in the account" proof.
//
// Drives the REAL sign.html as the client:
//   Approve & Sign → (color pick) → Continue to sign → type legal name + accept UETA
//   → Continue to payment → 💵 Cash / 📝 Check → Confirm
// Then asserts the signed_proposals audit row: signed_at, client_signed_name,
// payment_method, payment_status=pending_<method>, signature_data present.
//
//   suspect chain: sign.html goToPayment → _paySign(cash|check) → submitCash
//   (signed_proposals upsert).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'sign/cash-check-paid';

// Drive sign.html through to a cash/check confirmation, return what landed.
async function signAndPay(p, ctx, bidId, method) {
  const signPage = await p.context().newPage();
  const url = `/sign.html?t=${ctx.token}&u=${ctx.uid}&b=${bidId}`;
  let got = '', done = false;
  for (let i = 0; i < 3 && !done; i++) {
    await signPage.goto(url + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const loaded = await signPage.waitForSelector('#approve-btn', { state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
    if (!loaded) { got = `attempt=${i + 1} proposal did not load`; await signPage.waitForTimeout(2000); continue; }
    // Approve → (painting+surfaces) color pick → Continue to sign → sign pad.
    await signPage.locator('#approve-btn').click({ timeout: 8000 }).catch(() => {});
    const onColor = await signPage.waitForSelector('#pg-color-pick', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (onColor) await signPage.locator('#pg-color-pick button.btn').click({ timeout: 8000 }).catch(() => {});
    const padReady = await signPage.waitForSelector('#sig-name', { state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!padReady) { got = `attempt=${i + 1} sign pad never revealed`; await signPage.waitForTimeout(2000); continue; }
    // Type the legal name → Continue to payment unlocks (no separate agreement checkbox).
    await signPage.locator('#sig-name').click({ timeout: 8000 }).catch(() => {});
    await signPage.locator('#sig-name').pressSequentially('Jordan E Client', { delay: 0 }).catch(() => {});
    await signPage.waitForTimeout(300);
    if (!(await signPage.locator('#sign-btn').isEnabled().catch(() => false))) { got = `attempt=${i + 1} Continue-to-payment never enabled`; await signPage.waitForTimeout(1500); continue; }
    await signPage.locator('#sign-btn').click({ timeout: 8000 }).catch(() => {});            // → pg-pay
    // Pick the manual method (💵 Cash / 📝 Check) → reveals the confirm button.
    const label = method === 'cash' ? 'Cash' : 'Check';
    await signPage.waitForSelector('#sign-pay-btns', { state: 'visible', timeout: 8000 }).catch(() => {});
    await signPage.locator('#sign-pay-btns button', { hasText: label }).first().click({ timeout: 8000 }).catch(() => {});
    const confirmReady = await signPage.waitForSelector('#sec-cash-confirm-btn', { state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
    if (!confirmReady) { got = `attempt=${i + 1} cash/check confirm button never shown`; await signPage.waitForTimeout(1500); continue; }
    await signPage.locator('#sec-cash-confirm-btn').click({ timeout: 8000 }).catch(() => {});  // → submitCash
    // Confirmation screen (showDone) means the signed_proposals upsert went through.
    done = await signPage.waitForSelector('#pg-done, .sign-done, #sign-done', { state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
    got = `attempt=${i + 1} confirmed=${done}`;
    if (!done) await signPage.waitForTimeout(1500);
  }
  await signPage.close().catch(() => {});
  return { got, count: 'Jordan E Client'.length + 5 }; // approve + continue + name-tap + UETA + method + confirm
}

// Read the signed_proposals audit row for a bid from the contractor session.
async function signedRow(p, bidId) {
  return await p.evaluate(async ({ bidId }) => {
    if (typeof _supa === 'undefined' || !_supa) return null;
    const { data } = await _supa.from('signed_proposals')
      .select('bid_id,signed_at,client_signed_name,payment_method,payment_status,signature_data')
      .eq('bid_id', String(bidId)).maybeSingle();
    return data || null;
  }, { bidId });
}

test.describe('cash/check signing, proposal signed + marked paid (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  for (const method of ['cash', 'check']) {
    test(`a sent proposal is signed and marked paid by ${method}, full audit record`, async ({ page }) => {
      const clientId = Date.now() * 1000 + (process.pid % 1000) + (method === 'check' ? 7 : 0);
      const bidId = clientId + 1;
      let ctx = {};

      await step(page, {
        label: 'send a real proposal', page: 'cloud', role: 'contractor',
        suspect: 'seedProposal storage upload + td_bids',
        ruleText: 'sending the proposal must upload the signing snapshot + return token/uid',
        expected: 'token + uid present, no upload error',
        act: async (p) => { ctx = await seedProposal(p, { clientId, bidId, amount: 4200, tag: 'paid-' + method }); return 1; },
        rule: async () => ({ ok: !ctx.uploadErr && !!ctx.token && !!ctx.uid, got: `err=${ctx.uploadErr} token=${!!ctx.token}` }),
      });

      await step(page, {
        label: `client signs + confirms ${method} → audit record written`, page: 'sign.html', role: 'client',
        suspect: 'sign.html goToPayment → _paySign + submitCash (signed_proposals upsert)',
        ruleText: `after signing and confirming ${method}, signed_proposals must hold the audit record (signer, payment_method, pending_${method})`,
        expected: `signed_proposals: client_signed_name set, payment_method=${method}, payment_status=pending_${method}, signature_data present`,
        act: async (p) => { const r = await signAndPay(p, ctx, bidId, method); p.__signGot = r.got; return r.count; },
        rule: async (p) => {
          const row = await signedRow(p, bidId);
          const ok = !!row && !!row.signed_at && (row.client_signed_name || '').length > 2
            && row.payment_method === method && row.payment_status === `pending_${method}` && !!row.signature_data;
          return { ok, got: row ? JSON.stringify({ ...row, signature_data: row.signature_data ? `len=${String(row.signature_data).length}` : null }) : `NO signed_proposals row · sign=${p.__signGot}` };
        },
      });

      // NO cleanup, the signed proposal stays in the dev account on purpose so the
      // owner can open it and see it executed (CLAUDE.md §13.7).
      const rep = report(FLOW, BASELINE, page);
      expect(rep.totalClicks).toBeGreaterThan(0);
    });
  }
});
