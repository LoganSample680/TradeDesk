import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey, stripeSecretKey, stripeWebhookSecret } from '../_shared/keys.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

// Fetch actual Stripe fee from balance transaction; fall back to estimate by method.
async function getActualFee(stripe: Stripe, paymentIntentId: string, amountPaid: number, method: string, connectedAccountId?: string): Promise<number> {
  try {
    // Direct charge: the PaymentIntent lives on the contractor's connected account, so
    // it must be retrieved WITH that account header or the lookup 404s. event.account
    // carries it for Connect events; absent for platform charges (the fallback path).
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    }, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);
    const bt = (pi.latest_charge as Stripe.Charge)?.balance_transaction as Stripe.BalanceTransaction;
    if (bt?.fee != null) return bt.fee / 100;
  } catch (_) { /* fall through to estimate */ }
  if (method === 'us_bank_account') return Math.min(+(amountPaid * 0.008).toFixed(2), 5.00);
  return +(amountPaid * 0.029 + 0.30).toFixed(2);
}

// THE LEDGER THE APP READS (2026-10-01). Payments and fees used to be written
// into zj_data.payments / zj_data.expenses, JSON columns the app stopped reading
// when every record moved to its own td_* table, so a card payment on the
// customer's page never showed in the app as paid. Each one is now its own
// td_payments / td_expenses row, keyed (id, user_id) like every row the app
// writes, and stamped onto the sync cursor so open devices pull it.
// Idempotent by the Stripe reference: a webhook that fires twice books once.
async function bookRow(table: 'td_payments' | 'td_expenses', uid: string, row: Record<string, unknown>): Promise<boolean> {
  const ref = String(row.ref || '');
  if (ref) {
    const { data: have } = await supabase.from(table).select('id')
      .eq('user_id', uid).eq('data->>ref', ref).is('deleted_at', null).limit(1);
    if (have && have.length) return false;
  }
  const { error } = await supabase.from(table).insert({ id: String(row.id), user_id: uid, data: row });
  if (error) { console.error('bookRow ' + table, error.message); return false; }
  return true;
}
async function touchCursor(uid: string) {
  await supabase.from('zj_data').update({ updated_at: new Date().toISOString() }).eq('user_id', uid);
}
// The bid id the app keys payments by is a number (getBidPaid compares with ===).
function bidKey(v: unknown): number | string { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? n : String(v ?? ''); }

// Book a refund into the contractor's ledger. The charge's payment_intent uniquely
// identifies ONE signed proposal, so we resolve the exact bid + client + contractor it
// belongs to — a refund can never land on the wrong client or the wrong contractor's
// books. Idempotent by refund id, and it records the EXACT refunded amount (which equals
// the amount the contractor typed on the collect screen), never the whole charge.
async function recordRefund(stripe: Stripe, charge: Stripe.Charge, connectedAccountId?: string) {
  const piRef = String(charge.payment_intent || '');
  if (!piRef) return;

  const { data: sp } = await supabase
    .from('signed_proposals')
    .select('bid_id,contractor_user_id,client_name')
    .eq('stripe_payment_intent', piRef).maybeSingle();
  if (!sp?.contractor_user_id) return;

  // Refunds on this charge, retrieved on the connected account (direct charges live there).
  let refunds: Stripe.Refund[] = [];
  try {
    const list = await stripe.refunds.list(
      { charge: String(charge.id), limit: 100 },
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
    );
    refunds = list.data || [];
  } catch { refunds = (charge.refunds?.data as Stripe.Refund[]) || []; }
  if (!refunds.length) return;

  const fullyRefunded = (charge.amount_refunded || 0) >= (charge.amount || 0);
  await supabase.from('signed_proposals')
    .update({ stripe_refund_id: refunds[0].id, payment_status: fullyRefunded ? 'refunded' : 'partial_refund' })
    .eq('bid_id', sp.bid_id);

  const uid = String(sp.contractor_user_id);
  let changed = false, i = 0;
  for (const rf of refunds) {
    const booked = await bookRow('td_payments', uid, {
      id: Date.now() * 1000 + (i++),
      bid_id: bidKey(sp.bid_id),
      client_name: sp.client_name,            // the RIGHT client (resolved from the payment intent)
      date: new Date().toISOString().slice(0, 10),
      loggedAt: new Date().toISOString(),
      type: 'refund',
      amount: -(rf.amount / 100),             // negative + EXACT refunded amount
      method: 'Card',
      ref: rf.id,                             // idempotent: never double-book
    });
    changed = changed || booked;
  }
  if (changed) await touchCursor(uid);
}

// The one place that decides what "a payment completed" means. Both entry
// points below (a hosted Checkout Session, or a raw PaymentIntent from the
// embedded/Payment Element flow) extract the same shape from their own Stripe
// object and hand it here, so there is only ever one write path to keep
// correct, not two that can quietly drift apart from each other.
async function recordPayment(stripe: Stripe, meta: Stripe.Metadata, amountPaid: number, paymentMethod: string, piRef: string, connectedAccountId?: string) {
  const ts = new Date().toISOString();

  const stripeFee = await getActualFee(stripe, piRef, amountPaid, paymentMethod, connectedAccountId);

  await supabase.from('signed_proposals').upsert({
    bid_id: meta.bidId,
    contractor_user_id: meta.contractorUserId,
    client_name: meta.clientName,
    client_signed_name: meta.signerName,
    amount: amountPaid,
    deposit: amountPaid,
    payment_method: paymentMethod,
    payment_status: 'paid',
    stripe_payment_intent: piRef,
    stripe_fee: stripeFee,
    signed_at: ts,
    notify_email: meta.notifyEmail,
    storage_key: meta.proposalKey,
    // create-checkout reads these off the stored proposal (20261049); the
    // card path used to write them from the browser, which can no longer
    // touch this table.
    ...(meta.epa === '1' ? { epa_required: true, epa_ack_at: ts } : {}),
    ...(meta.senior === '1' ? { buyer_senior: true } : {}),
  }, { onConflict: 'bid_id' });

  const uid = String(meta.contractorUserId || '');
  if (!uid) return;
  // Idempotent by the payment intent: a webhook that fires twice books once.
  const booked = await bookRow('td_payments', uid, {
    id: Date.now() * 1000,
    bid_id: bidKey(meta.bidId),
    client_name: meta.clientName,
    date: ts.slice(0, 10),
    loggedAt: ts,
    // A proposal signed and paid is its deposit; a payment from the hub is
    // toward the balance.
    type: meta.proposalKey ? 'deposit' : 'payment',
    amount: amountPaid,
    method: paymentMethod,
    ref: piRef,
  });
  if (!booked) return;
  await bookRow('td_expenses', uid, {
    id: Date.now() * 1000 + 1,
    date: ts.slice(0, 10),
    desc: `Stripe fee: ${meta.clientName}`,
    amount: stripeFee,
    cat: 'fees',
    deductible: true,
    ref: 'fee:' + piRef,
  });
  await touchCursor(uid);
}

// Hosted Checkout Session path (non-embedded: sign.html's "pay by link" style flow).
async function recordCompletedPaymentFromSession(stripe: Stripe, session: Stripe.Checkout.Session, connectedAccountId?: string) {
  const meta = session.metadata!;
  const amountPaid = (session.amount_total || 0) / 100;
  const paymentMethod = meta.paymentMethod || session.payment_method_types?.[0] || 'card';
  const piRef = String(session.payment_intent);
  await recordPayment(stripe, meta, amountPaid, paymentMethod, piRef, connectedAccountId);
}

// Embedded/Payment Element path (create-checkout's embedded:true branch creates a raw
// PaymentIntent, never a Checkout Session, so it never fires checkout.session.completed.
// This is the ONLY path that records an embedded payment; without it, a card charge taken
// through the embedded screen succeeds on Stripe's side but never reaches signed_proposals
// or the payments ledger. Guarded on metadata.bidId being present so an unrelated
// PaymentIntent on this Stripe account, if one is ever created outside create-checkout,
// is silently skipped rather than writing a garbage ledger row.
async function recordCompletedPaymentFromIntent(stripe: Stripe, pi: Stripe.PaymentIntent, connectedAccountId?: string) {
  const meta = pi.metadata;
  if (!meta?.bidId) return;
  const amountPaid = (pi.amount_received || pi.amount || 0) / 100;
  const paymentMethod = meta.paymentMethod || pi.payment_method_types?.[0] || 'card';
  await recordPayment(stripe, meta, amountPaid, paymentMethod, pi.id, connectedAccountId);
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text();

  // Auto mode for webhooks: Stripe sends no origin, so verify the signature against
  // whichever secret matches (live first, then test) and let the event's own livemode
  // flag pick the keys. A throwaway client is fine for verification — constructEventAsync
  // only HMACs the body+secret, it never calls the API.
  const verifier = new Stripe(stripeSecretKey('live') || stripeSecretKey('test') || 'sk_placeholder', { apiVersion: '2023-10-16' });
  let event: Stripe.Event | null = null;
  for (const m of ['live', 'test'] as const) {
    const secret = stripeWebhookSecret(m);
    if (!secret) continue;
    try { event = await verifier.webhooks.constructEventAsync(body, signature, secret); break; }
    catch (_e) { /* try the other mode's secret */ }
  }
  if (!event) return new Response('Webhook signature verification failed', { status: 400 });

  // Pick keys by the event's own mode — live events → live keys, test events → test keys.
  const stripe = new Stripe(stripeSecretKey(event.livemode ? 'live' : 'test'), { apiVersion: '2023-10-16' });

  // ── Instant payments (card, Venmo, Cash App, etc.) ────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === 'paid') {
      await recordCompletedPaymentFromSession(stripe, session, event.account || undefined);
    }
    // payment_status === 'unpaid' means ACH — wait for async_payment_succeeded
  }

  // ── ACH settles days later — record when money actually clears ────────────
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    await recordCompletedPaymentFromSession(stripe, session, event.account || undefined);
  }

  // ── Embedded/Payment Element checkout (sign.html's in-page card form, and the
  //    in-person collect screen): this flow never creates a Checkout Session, so
  //    it never fires the two events above. This is its only completion event. ──
  if (event.type === 'payment_intent.succeeded') {
    await recordCompletedPaymentFromIntent(stripe, event.data.object as Stripe.PaymentIntent, event.account || undefined);
  }

  // ── Refund issued (collect-screen overage, client cancel, or contractor's own
  //    Stripe dashboard) — book it into the contractor's ledger as a negative entry.
  //    Idempotent by refund id, so the same refund is never double-booked regardless
  //    of how many times charge.refunded fires or who triggered it. ─────────────────
  if (event.type === 'charge.refunded') {
    await recordRefund(stripe, event.data.object as Stripe.Charge, event.account || undefined);
  }

  // ── Connect onboarding completed ──────────────────────────────────────────
  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account;
    if (acct.charges_enabled) {
      const { data: cfg } = await supabase
        .from('account_config')
        .select('account_id, stripe_connect_enabled')
        .eq('stripe_account_id', acct.id)
        .maybeSingle();
      if (cfg && !cfg.stripe_connect_enabled) {
        await supabase
          .from('account_config')
          .update({ stripe_connect_enabled: true })
          .eq('account_id', cfg.account_id);
        console.log(`Connect enabled for account ${cfg.account_id} via Stripe account ${acct.id}`);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
