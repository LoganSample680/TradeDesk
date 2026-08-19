#!/usr/bin/env node
// TradeDesk Stripe Webhook Event Sync
//
// Owner ask (2026-08-19): "I don't want to manage Stripe webhook config
// manually, I want GitHub to do it." This script makes the webhook endpoint's
// subscribed event list a CODE artifact, kept in sync by CI, instead of
// something clicked together by hand in the Stripe Dashboard.
//
// The required event list is DERIVED, never hand-typed: it's parsed straight
// out of supabase/functions/stripe-webhook/index.ts's own `event.type === '...'`
// checks (see requiredEvents() below), so this script and the webhook handler
// can never silently drift apart. Add a new `if (event.type === '...')` branch
// to the webhook and the very next sync run picks it up automatically.
//
// Idempotent: finds the existing webhook endpoint(s) whose URL matches the
// deployed stripe-webhook function and sets enabled_events to EXACTLY the
// required list (adds what's missing, removes anything stray). A run that
// finds everything already correct says so and changes nothing.
//
// Runs once per Stripe mode:
//   TEST — STRIPE_TEST_SECRET_KEY (already an existing repo secret, a normal
//          Stripe TEST-mode secret key, plenty of permission to manage
//          webhook endpoints in test mode).
//   LIVE — STRIPE_LIVE_RESTRICTED_KEY_WEBHOOKS (NEW secret, not yet added as
//          of this script's introduction — recommended as a Stripe
//          "restricted key" scoped to ONLY Webhook Endpoints (read+write), so
//          this workflow can never touch charges/customers/payouts even if
//          the secret leaked). Skips that mode gracefully, with a clear log
//          line, until the secret exists.
'use strict';

const fs = require('fs');
const path = require('path');

const WEBHOOK_SOURCE = path.join(__dirname, '..', 'supabase', 'functions', 'stripe-webhook', 'index.ts');

// Parse the webhook handler's own `event.type === '...'` checks. This is the
// single source of truth for "what this endpoint needs to be subscribed to" —
// never hand-maintain a parallel list here, it will eventually drift.
function requiredEvents() {
  const src = fs.readFileSync(WEBHOOK_SOURCE, 'utf8');
  const re = /event\.type\s*===\s*'([^']+)'/g;
  const set = new Set();
  let m;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  if (!set.size) {
    throw new Error(
      `No 'event.type === ...' checks found in ${WEBHOOK_SOURCE} — the webhook file's shape ` +
      `changed and this parser needs updating (it must never silently produce an empty list).`
    );
  }
  return Array.from(set).sort();
}

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
if (!PROJECT_REF) {
  console.error('ERROR: set SUPABASE_PROJECT_REF (the Supabase project ref, e.g. mwtsmctajhrrybblgorf)');
  process.exit(1);
}
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const as = a.slice().sort(), bs = b.slice().sort();
  return as.every((v, i) => v === bs[i]);
}

function anyDisabled(matches) {
  return matches.some((e) => e.status && e.status !== 'enabled');
}

async function syncMode(label, secretKey, secretName) {
  if (!secretKey) {
    console.log(`\n[${label}] SKIP — ${secretName} is not set yet. Add it as a repo secret to enable ${label}-mode sync.`);
    return;
  }

  const Stripe = require('stripe');
  const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });
  const required = requiredEvents();
  console.log(`\n[${label}] webhook URL: ${WEBHOOK_URL}`);
  console.log(`[${label}] required events (${required.length}): ${required.join(', ')}`);

  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const matches = list.data.filter((e) => e.url === WEBHOOK_URL);

  if (!matches.length) {
    console.log(`[${label}] no existing endpoint found for this URL — creating one`);
    const created = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: required,
      description: 'TradeDesk (managed by scripts/sync-stripe-webhooks.js — do not hand-edit enabled_events)',
    });
    console.log(`[${label}] created endpoint ${created.id} with ${required.length} events`);
    console.log(
      `[${label}] IMPORTANT — a brand-new endpoint gets a brand-new signing secret, shown ` +
      `ONLY on this response. Set it now as the Supabase secret STRIPE_WEBHOOK_SECRET${label === 'live' ? '' : '_TEST'}: ` +
      `${created.secret || '(not returned — retrieve it from the Stripe Dashboard instead)'}`
    );
    return;
  }

  for (const ep of matches) {
    const current = ep.enabled_events || [];
    if (sameSet(current, required)) {
      console.log(`[${label}] endpoint ${ep.id} already matches (${current.length} events, status=${ep.status}) — no-op`);
      continue;
    }
    const added = required.filter((e) => !current.includes(e));
    const removed = current.filter((e) => !required.includes(e));
    await stripe.webhookEndpoints.update(ep.id, { enabled_events: required });
    console.log(`[${label}] endpoint ${ep.id} updated (status=${ep.status})`);
    if (added.length) console.log(`[${label}]   + subscribed: ${added.join(', ')}`);
    if (removed.length) console.log(`[${label}]   - unsubscribed: ${removed.join(', ')}`);
  }

  if (anyDisabled(matches)) {
    console.log(
      `[${label}] NOTE: at least one matching endpoint has status != enabled — this script only ` +
      `manages enabled_events, it does not enable/disable endpoints. Check the Stripe Dashboard if that's unexpected.`
    );
  }
}

async function main() {
  console.log('=== Stripe webhook event sync ===');
  await syncMode('test', process.env.STRIPE_TEST_SECRET_KEY, 'STRIPE_TEST_SECRET_KEY');
  await syncMode('live', process.env.STRIPE_LIVE_RESTRICTED_KEY_WEBHOOKS, 'STRIPE_LIVE_RESTRICTED_KEY_WEBHOOKS');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err && err.message ? err.message : err);
  process.exit(1);
});
