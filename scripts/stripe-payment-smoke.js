#!/usr/bin/env node
// TradeDesk Stripe Payment Pipeline Smoke Test
//
// Owner ask (2026-08-19): "I want tests to fire to make sure Stripe works
// correctly." This fires REAL Stripe TEST-mode payments through the app's
// REAL edge functions (create-checkout, stripe-webhook, refund-payment)
// against the REAL Dev Supabase account, and proves the whole pipeline: not
// just "Stripe says it succeeded", but that a successful payment/refund
// actually LANDS in the app's own ledger (signed_proposals + zj_data.payments).
//
// Plain HTTP + the Stripe Node SDK only — no browser, no Stripe.js, no
// Playwright. Confirms each PaymentIntent server-side with Stripe's premade
// test PaymentMethod tokens (pm_card_visa / pm_card_chargeDeclined), exactly
// as Stripe's own docs describe for testing without a card-entry form.
//
//   ⚠ VERIFY BEFORE FIRST RUN: this environment has no route to Stripe's docs
//   to confirm PAY_METHOD_DECLINE below is still Stripe's current token name
//   for a generic decline. It was written from training knowledge, not a
//   live docs check — confirm at https://docs.stripe.com/testing before
//   relying on this job (see PAY_METHOD_DECLINE below, the constant is
//   isolated on purpose so a rename is a one-line fix).
//
// SCOPE: the embedded/Payment Element path (create-checkout embedded:true →
// a raw PaymentIntent, confirmed here directly) is the ONLY path this script
// can drive to completion headlessly — that's exactly the path the
// payment_intent.succeeded handler (added in c6f2b07) exists for, and exactly
// the bug this smoke test exists to keep fixed forever. The hosted Checkout
// Session path (embedded:false) has NO server-side "complete it" API — Stripe
// requires a real browser on the hosted page — so this script only smoke-
// tests that create-checkout's hosted branch still responds with a valid
// session (not that checkout.session.completed fires). A live flow test with
// a real browser (§12.8) is the right place to close that gap if it's ever
// needed; noted, not built here.
//
// SAFETY: signs in as the dedicated Dev account and hard-asserts the
// authenticated user id matches E2E_DEV_USER_ID before doing anything (same
// rule tests/flow/live-helpers.js's assertDevAccount enforces) — refuses to
// run against any other identity. Also asserts the publishableKey
// create-checkout returns starts with pk_test_ before confirming with the
// TEST secret key, so a misconfigured STRIPE_MODE override on the Supabase
// side fails LOUD (a mode mismatch 400s at confirm) instead of silently
// doing anything with a live key.
//
// NEVER CLEANS UP (§12.7, this repo's own house rule): every seed payment
// and refund this script creates is left in the Dev account, tagged with a
// distinct client name so the owner can spot and ignore it.
'use strict';

const fs = require('fs');
const path = require('path');

// ── Config / env ─────────────────────────────────────────────────────────────
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const STRIPE_TEST_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY;

// Same DEV1→DEV2 promotion rule as tests/flow/live-helpers.js (§7.3: reuse the
// existing pattern, don't hand-roll a parallel one): if E2E_DEV_* isn't fully
// configured, E2E_DEV2_* stands in as primary. Keeps this script working
// whichever secret triplet the repo currently has wired.
const _dev1 = { email: process.env.E2E_DEV_EMAIL, password: process.env.E2E_DEV_PASSWORD, uid: process.env.E2E_DEV_USER_ID };
const _dev2 = { email: process.env.E2E_DEV2_EMAIL, password: process.env.E2E_DEV2_PASSWORD, uid: process.env.E2E_DEV2_USER_ID };
const _dev1Present = !!(_dev1.email && _dev1.password && _dev1.uid);
const DEV_EMAIL = _dev1Present ? _dev1.email : _dev2.email;
const DEV_PASSWORD = _dev1Present ? _dev1.password : _dev2.password;
const DEV_USER_ID = _dev1Present ? _dev1.uid : _dev2.uid;

// Soft-skip (exit 0) when the live creds simply aren't configured yet — same
// convention as tests/flow/live-helpers.js's needsLiveCreds(), so this job
// doesn't turn red on a fork or a repo that hasn't wired the secrets yet.
if (!PROJECT_REF || !STRIPE_TEST_SECRET_KEY || !DEV_EMAIL || !DEV_PASSWORD || !DEV_USER_ID) {
  console.log('SKIP — live creds not fully configured (need SUPABASE_PROJECT_REF, STRIPE_TEST_SECRET_KEY, E2E_DEV_EMAIL, E2E_DEV_PASSWORD, E2E_DEV_USER_ID).');
  process.exit(0);
}

const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// The app's own anon/publishable key is not a secret (it's baked directly
// into index.html/sign.html/client.html for the browser to use). Read it
// from js/cloud.js at runtime rather than hand-copying it here, so this
// script can never carry a stale duplicate.
function readAnonKey() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  const m = src.match(/const SUPA_KEY\s*=\s*'([^']+)'/);
  if (!m) throw new Error("Could not find `const SUPA_KEY = '...'` in js/cloud.js — has it moved?");
  return m[1];
}
const ANON_KEY = readAnonKey();

// Owner's own personal login is off-limits everywhere flow tests run (§ live-helpers.js
// FORBIDDEN_TEST_EMAILS) — mirror that guard here too, this script authenticates the
// same way those tests do.
const FORBIDDEN_TEST_EMAILS = ['logansample97@gmail.com'];
if (FORBIDDEN_TEST_EMAILS.includes(String(DEV_EMAIL).trim().toLowerCase())) {
  console.error(`REFUSING TO RUN: E2E_DEV_EMAIL is the owner's personal account (${DEV_EMAIL}). Point it at the dedicated TradeDesk test login.`);
  process.exit(1);
}

// Stripe's premade test PaymentMethod tokens (no Elements/card form needed).
// pm_card_visa always succeeds. See the file-header note: PAY_METHOD_DECLINE
// needs a one-time confirm against Stripe's current testing docs.
const PAY_METHOD_SUCCESS = 'pm_card_visa';
const PAY_METHOD_DECLINE = 'pm_card_chargeDeclined';

// Distinct, greppable, tiny amounts + a recognizable client name so the owner
// can spot this run's rows in the Dev account and ignore them (§12.7: never
// clean this up). Bid ids are unique per run (timestamp + pid), same pattern
// tests/flow/refund-overage-flow.spec.js uses.
const RUN_STAMP = Date.now() * 1000 + (process.pid % 1000);
const TAG = 'CI Payment Smoke Test';
const BIZ_NAME = 'TradeDesk CI';

function bidId(offset) { return RUN_STAMP + offset; }

// ── tiny fetch/JSON helper ───────────────────────────────────────────────────
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (_e) { /* non-JSON body, leave null */ }
  return { status: res.status, body };
}

// ── Supabase auth (password grant) — no browser, just the auth REST API ─────
async function signIn() {
  const { status, body } = await fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
  });
  if (status !== 200 || !body || !body.access_token) {
    throw new Error(`Dev sign-in failed (status ${status}): ${JSON.stringify(body)}`);
  }
  const uid = body.user && body.user.id;
  // Hard guard, same rule as assertDevAccount() in live-helpers.js: refuse to
  // proceed against any identity other than the pinned Dev account.
  if (uid !== DEV_USER_ID) {
    throw new Error(`Signed-in user ${uid} !== E2E_DEV_USER_ID (${DEV_USER_ID}) — refusing to fire test payments against the wrong account.`);
  }
  return body.access_token;
}

// ── create-checkout ───────────────────────────────────────────────────────────
async function createCheckout(token, params) {
  return fetchJson(`${FUNCTIONS_URL}/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
}

// ── refund-payment ────────────────────────────────────────────────────────────
async function refundPayment(token, bid, amount) {
  return fetchJson(`${FUNCTIONS_URL}/refund-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bidId: bid, amount }),
  });
}

// ── PostgREST reads (RLS-scoped to the signed-in contractor) ────────────────
async function restGet(token, table, query) {
  const { status, body } = await fetchJson(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (status !== 200) throw new Error(`REST GET ${table} failed (status ${status}): ${JSON.stringify(body)}`);
  return body || [];
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Webhooks land asynchronously — poll the ledger for up to ~30s rather than
// assuming it's already there the instant Stripe's API call returns.
async function pollUntil(fn, { timeoutMs = 30000, intervalMs = 2000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(intervalMs);
  }
}

function extractPiId(clientSecret) {
  const i = String(clientSecret || '').indexOf('_secret_');
  if (i < 0) throw new Error(`Unexpected clientSecret shape: ${clientSecret}`);
  return clientSecret.slice(0, i);
}

// ── scenarios ─────────────────────────────────────────────────────────────────

// 1) SUCCESS — a real test-mode card payment, confirmed via the Stripe API,
// then proven to land in BOTH signed_proposals AND zj_data.payments (the two
// writes recordPayment() makes in stripe-webhook/index.ts).
async function scenarioSuccess(stripe, token) {
  const bid = String(bidId(1));
  console.log(`\n[success] bid ${bid} — creating embedded PaymentIntent ($1.11)…`);
  const { status, body } = await createCheckout(token, {
    amount: 111, currency: 'usd', paymentMethod: 'card', paymentType: 'full',
    clientName: `${TAG} — Success`, businessName: BIZ_NAME,
    bidId: bid, contractorUserId: DEV_USER_ID, embedded: true,
  });
  assertConnected(status, body, 'success');

  const piId = extractPiId(body.clientSecret);
  console.log(`[success] confirming ${piId} on connected account ${body.connectedAccountId} with ${PAY_METHOD_SUCCESS}…`);
  const pi = await stripe.paymentIntents.confirm(
    piId,
    { payment_method: PAY_METHOD_SUCCESS, return_url: 'https://tradedeskpro.app/' },
    { stripeAccount: body.connectedAccountId },
  );
  if (pi.status !== 'succeeded') throw new Error(`[success] expected PaymentIntent to succeed, got status=${pi.status}`);
  console.log(`[success] Stripe confirms succeeded (${pi.id}). Polling the app's ledger…`);

  const sp = await pollUntil(
    async () => {
      const rows = await restGet(token, 'signed_proposals', `bid_id=eq.${bid}&select=bid_id,payment_status,stripe_payment_intent,amount`);
      const row = rows[0];
      return (row && row.payment_status === 'paid' && row.stripe_payment_intent === piId) ? row : null;
    },
    { what: `signed_proposals row for bid ${bid} to show payment_status=paid` },
  );
  console.log(`[success] signed_proposals: payment_status=${sp.payment_status}, amount=${sp.amount} ✓`);

  const payments = await pollUntil(
    async () => {
      const rows = await restGet(token, 'zj_data', `user_id=eq.${DEV_USER_ID}&select=payments`);
      const list = JSON.parse((rows[0] && rows[0].payments) || '[]');
      const entry = list.find((p) => p.ref === piId && p.type === 'deposit');
      return entry || null;
    },
    { what: `zj_data.payments to contain a deposit entry for ${piId}` },
  );
  console.log(`[success] zj_data.payments: found deposit entry amount=$${payments.amount} client="${payments.client_name}" ✓`);
  return { bid, piId };
}

// 2) DECLINE — Stripe must actually decline it, AND the ledger must NOT show
// a paid entry for this bid (the pipeline must never record a failed charge
// as money received).
async function scenarioDecline(stripe, token) {
  const bid = String(bidId(2));
  console.log(`\n[decline] bid ${bid} — creating embedded PaymentIntent ($1.33)…`);
  const { status, body } = await createCheckout(token, {
    amount: 133, currency: 'usd', paymentMethod: 'card', paymentType: 'full',
    clientName: `${TAG} — Decline`, businessName: BIZ_NAME,
    bidId: bid, contractorUserId: DEV_USER_ID, embedded: true,
  });
  assertConnected(status, body, 'decline');

  const piId = extractPiId(body.clientSecret);
  console.log(`[decline] confirming ${piId} with ${PAY_METHOD_DECLINE} (expecting a decline)…`);
  let declined = false, declineCode = null;
  try {
    await stripe.paymentIntents.confirm(
      piId,
      { payment_method: PAY_METHOD_DECLINE, return_url: 'https://tradedeskpro.app/' },
      { stripeAccount: body.connectedAccountId },
    );
  } catch (e) {
    declined = e && e.type === 'StripeCardError';
    declineCode = e && (e.decline_code || e.code);
  }
  if (!declined) throw new Error(`[decline] expected a StripeCardError decline, got a different outcome for ${piId}`);
  console.log(`[decline] Stripe declined as expected (${declineCode}). Confirming the ledger stayed clean…`);

  // Give the (nonexistent) webhook write a moment, then assert it never showed up.
  await sleep(4000);
  const rows = await restGet(token, 'signed_proposals', `bid_id=eq.${bid}&select=bid_id,payment_status`);
  if (rows.length && rows[0].payment_status === 'paid') {
    throw new Error(`[decline] BUG: bid ${bid} shows payment_status=paid despite the card being declined — a decline must never be recorded as paid.`);
  }
  console.log(`[decline] confirmed no paid row exists for bid ${bid} ✓`);
  return { bid, piId };
}

// 3) REFUND — a fresh successful payment, then refund-payment issues a real
// partial refund, proven to land in both signed_proposals (stripe_refund_id +
// payment_status) and zj_data.payments (a negative 'refund' entry).
async function scenarioRefund(stripe, token) {
  const bid = String(bidId(3));
  console.log(`\n[refund] bid ${bid} — creating embedded PaymentIntent ($2.22) to refund from…`);
  const { status, body } = await createCheckout(token, {
    amount: 222, currency: 'usd', paymentMethod: 'card', paymentType: 'full',
    clientName: `${TAG} — Refund`, businessName: BIZ_NAME,
    bidId: bid, contractorUserId: DEV_USER_ID, embedded: true,
  });
  assertConnected(status, body, 'refund');

  const piId = extractPiId(body.clientSecret);
  const pi = await stripe.paymentIntents.confirm(
    piId,
    { payment_method: PAY_METHOD_SUCCESS, return_url: 'https://tradedeskpro.app/' },
    { stripeAccount: body.connectedAccountId },
  );
  if (pi.status !== 'succeeded') throw new Error(`[refund] setup payment did not succeed, status=${pi.status}`);
  console.log(`[refund] setup payment succeeded (${pi.id}). Waiting for it to land before refunding…`);

  await pollUntil(
    async () => {
      const rows = await restGet(token, 'signed_proposals', `bid_id=eq.${bid}&select=payment_status,stripe_payment_intent`);
      const row = rows[0];
      return (row && row.payment_status === 'paid' && row.stripe_payment_intent === piId) ? row : null;
    },
    { what: `signed_proposals row for bid ${bid} to show payment_status=paid before refunding` },
  );

  const refundAmount = 0.5; // a partial refund of the $2.22 payment — exact-amount check
  console.log(`[refund] calling refund-payment for $${refundAmount}…`);
  const rr = await refundPayment(token, bid, refundAmount);
  if (rr.status !== 200 || !rr.body || !rr.body.refund) {
    throw new Error(`[refund] refund-payment failed (status ${rr.status}): ${JSON.stringify(rr.body)}`);
  }
  const refundId = rr.body.refund.id;
  if (Math.abs(rr.body.refund.amount - refundAmount) > 0.001) {
    throw new Error(`[refund] refund amount mismatch: asked for $${refundAmount}, Stripe returned $${rr.body.refund.amount}`);
  }
  console.log(`[refund] Stripe refund ${refundId} issued for exactly $${rr.body.refund.amount}. Polling the ledger…`);

  const sp = await pollUntil(
    async () => {
      const rows = await restGet(token, 'signed_proposals', `bid_id=eq.${bid}&select=stripe_refund_id,payment_status`);
      const row = rows[0];
      return (row && row.stripe_refund_id === refundId) ? row : null;
    },
    { what: `signed_proposals row for bid ${bid} to show stripe_refund_id=${refundId}` },
  );
  if (sp.payment_status !== 'partial_refund') {
    throw new Error(`[refund] expected payment_status=partial_refund after a partial refund, got ${sp.payment_status}`);
  }
  console.log(`[refund] signed_proposals: stripe_refund_id=${sp.stripe_refund_id}, payment_status=${sp.payment_status} ✓`);

  const entry = await pollUntil(
    async () => {
      const rows = await restGet(token, 'zj_data', `user_id=eq.${DEV_USER_ID}&select=payments`);
      const list = JSON.parse((rows[0] && rows[0].payments) || '[]');
      return list.find((p) => p.ref === refundId && p.type === 'refund') || null;
    },
    { what: `zj_data.payments to contain a refund entry for ${refundId}` },
  );
  console.log(`[refund] zj_data.payments: found refund entry amount=$${entry.amount} (negative, exact) ✓`);
  return { bid, piId, refundId };
}

// 4) HOSTED PATH SMOKE — create-checkout's non-embedded (Checkout Session)
// branch still returns a valid session. This does NOT complete the payment
// (see file header: no headless way to drive Stripe's hosted page), it only
// proves the branch itself didn't break.
async function scenarioHostedSmoke(token) {
  const bid = String(bidId(4));
  console.log(`\n[hosted-smoke] bid ${bid} — creating a hosted Checkout Session (not completed, see file header)…`);
  const { status, body } = await createCheckout(token, {
    amount: 100, currency: 'usd', paymentMethod: 'card', paymentType: 'full',
    clientName: `${TAG} — Hosted (uncompleted)`, businessName: BIZ_NAME,
    bidId: bid, contractorUserId: DEV_USER_ID, embedded: false,
    successUrl: 'https://tradedeskpro.app/success', cancelUrl: 'https://tradedeskpro.app/cancel',
  });
  if (status !== 200 || !body || !body.url) {
    throw new Error(`[hosted-smoke] create-checkout (embedded:false) failed (status ${status}): ${JSON.stringify(body)}`);
  }
  console.log(`[hosted-smoke] got a session URL back ✓ (left uncompleted on purpose)`);
}

function assertConnected(status, body, label) {
  if (status === 409 && body && body.code === 'no_connected_account') {
    throw new Error(
      `[${label}] create-checkout refused: the Dev account (E2E_DEV_USER_ID) has no ENABLED Stripe ` +
      `Connect account. PREREQUISITE NOT MET — connect the Dev account to Stripe Connect TEST mode ` +
      `before this smoke test can run. (See the run's final report for the full checklist.)`
    );
  }
  if (status !== 200 || !body || !body.clientSecret || !body.connectedAccountId) {
    throw new Error(`[${label}] create-checkout did not return an embedded PaymentIntent (status ${status}): ${JSON.stringify(body)}`);
  }
  if (!String(body.publishableKey || '').startsWith('pk_test_')) {
    throw new Error(
      `[${label}] SAFETY ABORT: create-checkout returned a publishableKey that is NOT pk_test_ ` +
      `(${body.publishableKey || '(none)'}). Refusing to confirm with a TEST secret key against what ` +
      `may be a LIVE-mode PaymentIntent. Check whether STRIPE_MODE is overridden on the Supabase side.`
    );
  }
}

async function main() {
  const Stripe = require('stripe');
  const stripe = new Stripe(STRIPE_TEST_SECRET_KEY, { apiVersion: '2023-10-16' });

  console.log('=== Stripe payment pipeline smoke test (TEST mode, real Stripe + real Dev Supabase) ===');
  console.log(`Run stamp: ${RUN_STAMP} (bid ids ${bidId(1)}-${bidId(4)})`);
  const token = await signIn();
  console.log(`Signed in as Dev account ${DEV_USER_ID} ✓`);

  const results = {};
  results.success = await scenarioSuccess(stripe, token);
  results.decline = await scenarioDecline(stripe, token);
  results.refund = await scenarioRefund(stripe, token);
  await scenarioHostedSmoke(token);

  console.log('\n=== All scenarios passed ===');
  console.log('Seed data left in the Dev account on purpose (§12.7) — tagged "' + TAG + '" in client_name, safe to ignore or inspect:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('\nFAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
