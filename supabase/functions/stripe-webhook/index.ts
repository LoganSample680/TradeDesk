import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!;
  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  // ── checkout.session.completed ─────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata!;
    const amountPaid = (session.amount_total || 0) / 100;
    const stripeFee = Math.round((amountPaid * 0.029 + 0.30) * 100) / 100;
    const ts = new Date().toISOString();

    await supabase.from('signed_proposals').upsert({
      bid_id: meta.bidId,
      contractor_user_id: meta.contractorUserId,
      client_name: meta.clientName,
      client_signed_name: meta.signerName,
      amount: amountPaid / 0.25,
      deposit: amountPaid,
      payment_method: session.payment_method_types?.[0] || 'card',
      payment_status: 'paid',
      stripe_payment_intent: String(session.payment_intent),
      stripe_fee: stripeFee,
      signed_at: ts,
      notify_email: meta.notifyEmail,
      storage_key: meta.proposalKey,
    });

    const { data: zjRow } = await supabase
      .from('zj_data')
      .select('payments,expenses')
      .eq('user_id', meta.contractorUserId)
      .maybeSingle();

    if (zjRow) {
      const payments = JSON.parse(zjRow.payments || '[]');
      const expenses = JSON.parse(zjRow.expenses || '[]');
      payments.push({
        id: Date.now(),
        bid_id: meta.bidId,
        client_name: meta.clientName,
        date: ts.slice(0, 10),
        type: 'deposit',
        amount: amountPaid,
        method: 'stripe',
        ref: String(session.payment_intent),
      });
      expenses.push({
        id: Date.now() + 1,
        date: ts.slice(0, 10),
        desc: `Stripe fee — ${meta.clientName} deposit`,
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

  // ── account.updated (Connect onboarding completed) ─────────────────────────
  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account;

    // Only act when charges_enabled flips to true
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
