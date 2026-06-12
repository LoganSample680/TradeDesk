import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Fetch actual Stripe fee from balance transaction; fall back to estimate by method.
async function getActualFee(paymentIntentId: string, amountPaid: number, method: string): Promise<number> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const bt = (pi.latest_charge as Stripe.Charge)?.balance_transaction as Stripe.BalanceTransaction;
    if (bt?.fee != null) return bt.fee / 100;
  } catch (_) { /* fall through to estimate */ }
  if (method === 'us_bank_account') return Math.min(+(amountPaid * 0.008).toFixed(2), 5.00);
  return +(amountPaid * 0.029 + 0.30).toFixed(2);
}

async function recordCompletedPayment(session: Stripe.Checkout.Session) {
  const meta = session.metadata!;
  const amountPaid = (session.amount_total || 0) / 100;
  const paymentMethod = meta.paymentMethod || session.payment_method_types?.[0] || 'card';
  const piRef = String(session.payment_intent);
  const ts = new Date().toISOString();

  const stripeFee = await getActualFee(piRef, amountPaid, paymentMethod);

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
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  // ── Instant payments (card, Venmo, Cash App, etc.) ────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === 'paid') {
      await recordCompletedPayment(session);
    }
    // payment_status === 'unpaid' means ACH — wait for async_payment_succeeded
  }

  // ── ACH settles days later — record when money actually clears ────────────
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    await recordCompletedPayment(session);
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
