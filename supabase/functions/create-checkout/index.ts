import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const {
      amount, currency, paymentMethod,
      proposalKey, clientName, businessName,
      bidId, contractorUserId, notifyEmail,
      signatureDataUrl, signerName,
      successUrl, cancelUrl,
    } = body;

    // Look up contractor's connected Stripe account (if any)
    let stripeAccountId: string | null = null;
    if (contractorUserId) {
      const { data: userRow } = await supabase
        .from('users')
        .select('account_id')
        .eq('id', contractorUserId)
        .maybeSingle();

      if (userRow?.account_id) {
        const { data: cfg } = await supabase
          .from('account_config')
          .select('stripe_account_id, stripe_connect_enabled')
          .eq('account_id', userRow.account_id)
          .maybeSingle();

        if (cfg?.stripe_account_id && cfg?.stripe_connect_enabled) {
          stripeAccountId = cfg.stripe_account_id;
        }
      }
    }

    const paymentMethodTypes = paymentMethod === 'us_bank_account'
      ? ['us_bank_account']
      : ['card'];

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: paymentMethodTypes as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      line_items: [{
        price_data: {
          currency: currency || 'usd',
          product_data: {
            name: `${businessName} — Deposit`,
            description: `25% deposit for ${clientName}`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      metadata: {
        proposalKey,
        bidId,
        contractorUserId,
        notifyEmail,
        signerName,
        clientName,
        businessName,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    // Route payment to contractor's connected account if available
    if (stripeAccountId) {
      sessionParams.payment_intent_data = {
        transfer_data: { destination: stripeAccountId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Save signature to storage now (before payment completes)
    if (signatureDataUrl && proposalKey) {
      try {
        const { data: existing } = await supabase.storage.from('proposals').download(proposalKey);
        if (existing) {
          const text = await existing.text();
          const proposal = JSON.parse(text);
          const updated = {
            ...proposal,
            signatureDataUrl, signerName,
            status: 'signed_awaiting_payment',
            signedAt: new Date().toISOString(),
            stripeConnectAccountId: stripeAccountId || null,
          };
          await supabase.storage.from('proposals').upload(
            proposalKey, JSON.stringify(updated),
            { contentType: 'application/json', upsert: true }
          );
        }
      } catch (e) { console.warn('Signature save failed:', e); }
    }

    return new Response(
      JSON.stringify({ url: session.url, connect_enabled: !!stripeAccountId }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
