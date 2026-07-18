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

  const { data: zjRow } = await supabase.from('zj_data').select('payments').eq('user_id', sp.contractor_user_id).maybeSingle();
  if (!zjRow) return;
  const payments = JSON.parse(zjRow.payments || '[]');
  let changed = false, i = 0;
  for (const rf of refunds) {
    if (payments.some((p: any) => p.ref === rf.id)) continue;     // idempotent — never double-book
    payments.push({
      id: Date.now() + (i++),
      bid_id: sp.bid_id,
      client_name: sp.client_name,            // the RIGHT client (resolved from the payment intent)
      date: new Date().toISOString().slice(0, 10),
      type: 'refund',
      amount: -(rf.amount / 100),             // negative + EXACT refunded amount
      method: 'Card',
      ref: rf.id,
    });
    changed = true;
  }
  if (changed) {
    await supabase.from('zj_data')
      .update({ payments: JSON.stringify(payments), updated_at: new Date().toISOString() })
      .eq('user_id', sp.contractor_user_id);
  }
}

// ── Platform subscription billing (TradeDesk billing the CONTRACTOR for the
//    app itself — the platform Stripe account, never Connect. Connect above
//    is client-to-contractor money and never touches these tables). ─────────
//
// metadata.tradedesk_user_id is stamped on the subscription at checkout
// creation time (create-billing-checkout), so every event here resolves
// straight back to the account with no separate lookup table.
async function upsertSubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.tradedesk_user_id;
  if (!userId) return; // not one of ours — ignore
  await supabase.from('td_subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: String(sub.customer),
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  }, { onConflict: 'user_id' });
}

// Owner spec 2026-07-17: Books/Time Log exports unlock after 2 CONSECUTIVE,
// UNBROKEN paid monthly cycles. A failed/lapsed invoice resets the streak to
// zero — recorded here and read back by td_exports_unlocked() (see the
// 20260804_platform_billing migration) which the app calls to gate exports.
async function recordSubscriptionInvoice(invoice: Stripe.Invoice, status: 'paid' | 'payment_failed') {
  const subId = String(invoice.subscription || '');
  if (!subId) return; // one-off invoice, not a subscription cycle — nothing to count

  // Idempotent by invoice id: a webhook retry must never double-count a cycle.
  const { data: existing } = await supabase
    .from('td_subscription_invoices')
    .select('id').eq('stripe_invoice_id', invoice.id).maybeSingle();
  if (existing) return;

  const { data: sub } = await supabase
    .from('td_subscriptions')
    .select('user_id, consecutive_paid_cycles')
    .eq('stripe_subscription_id', subId).maybeSingle();
  if (!sub) return; // subscription.created hasn't landed yet — a later retry catches it

  await supabase.from('td_subscription_invoices').insert({
    user_id: sub.user_id,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subId,
    status,
    amount_paid: (invoice.amount_paid || 0) / 100,
    period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
  });

  const nextCount = status === 'paid' ? (sub.consecutive_paid_cycles || 0) + 1 : 0;
  await supabase.from('td_subscriptions')
    .update({ consecutive_paid_cycles: nextCount })
    .eq('stripe_subscription_id', subId);
}

async function recordCompletedPayment(stripe: Stripe, session: Stripe.Checkout.Session, connectedAccountId?: string) {
  const meta = session.metadata!;
  const amountPaid = (session.amount_total || 0) / 100;
  const paymentMethod = meta.paymentMethod || session.payment_method_types?.[0] || 'card';
  const piRef = String(session.payment_intent);
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
  }, { onConflict: 'bid_id' });

  const { data: zjRow } = await supabase
    .from('zj_data')
    .select('payments,expenses')
    .eq('user_id', meta.contractorUserId)
    .maybeSingle();

  if (zjRow) {
    const payments = JSON.parse(zjRow.payments || '[]');
    const expenses = JSON.parse(zjRow.expenses || '[]');

    // Idempotency guard — don't double-record if webhook fires twice
    if (payments.some((p: any) => p.ref === piRef)) return;

    payments.push({
      id: Date.now(),
      bid_id: meta.bidId,
      client_name: meta.clientName,
      date: ts.slice(0, 10),
      type: 'deposit',
      amount: amountPaid,
      method: paymentMethod,
      ref: piRef,
    });
    expenses.push({
      id: Date.now() + 1,
      date: ts.slice(0, 10),
      desc: `Stripe fee — ${meta.clientName}`,
      amount: stripeFee,
      cat: 'fees',
      deductible: true,
    });
    await supabase
      .from('zj_data')
      .update({ payments: JSON.stringify(payments), expenses: JSON.stringify(expenses), updated_at: ts })
      .eq('user_id', meta.contractorUserId);
  }
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
      await recordCompletedPayment(stripe, session, event.account || undefined);
    }
    // payment_status === 'unpaid' means ACH — wait for async_payment_succeeded
  }

  // ── ACH settles days later — record when money actually clears ────────────
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    await recordCompletedPayment(stripe, session, event.account || undefined);
  }

  // ── Refund issued (collect-screen overage, client cancel, or contractor's own
  //    Stripe dashboard) — book it into the contractor's ledger as a negative entry.
  //    Idempotent by refund id, so the same refund is never double-booked regardless
  //    of how many times charge.refunded fires or who triggered it. ─────────────────
  if (event.type === 'charge.refunded') {
    await recordRefund(stripe, event.data.object as Stripe.Charge, event.account || undefined);
  }

  // ── Platform subscription billing (contractor's own TradeDesk plan) ──────
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    await upsertSubscription(event.data.object as Stripe.Subscription);
  }
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    await supabase.from('td_subscriptions').update({ status: 'canceled' }).eq('stripe_subscription_id', sub.id);
  }
  if (event.type === 'invoice.paid') {
    const inv = event.data.object as Stripe.Invoice;
    if (inv.subscription) await recordSubscriptionInvoice(inv, 'paid');
  }
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as Stripe.Invoice;
    if (inv.subscription) await recordSubscriptionInvoice(inv, 'payment_failed');
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
