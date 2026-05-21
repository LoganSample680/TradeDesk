import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const {
      amount, currency, paymentMethod, paymentType,
      surchargeAmount,
      proposalKey, clientName, businessName,
      bidId, contractorUserId, notifyEmail,
      signatureDataUrl, signerName,
      successUrl, cancelUrl,
      embedded,
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

    const metadata = {
      proposalKey, bidId, contractorUserId,
      notifyEmail, signerName, clientName, businessName,
      paymentMethod: paymentMethod || 'card',
    };

    // statement_descriptor → client's card statement (max 22 chars)
    const _lastName = ((clientName||'').trim().split(/\s+/).pop()||'CLIENT').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const _suffix = paymentType === 'full' ? 'FULL' : 'DEPOSIT';
    const statementDescriptor = (_lastName + '-' + _suffix).substring(0, 22) || 'PAYMENT';

    // description → contractor's Stripe dashboard
    const _payLabel = paymentType === 'full' ? 'Full payment' : 'Deposit';
    const piDescription = `${clientName || 'Client'} — ${_payLabel} — ${businessName || ''}`.trim().replace(/—\s*$/, '');

    // Save signature to storage (called after PI/session creation)
    async function saveSignature() {
      if (!signatureDataUrl || !proposalKey) return;
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

    // Embedded: PaymentIntent + Payment Element (supports accordion/collapsed layout)
    if (embedded) {
      const totalAmt = amount + (surchargeAmount || 0);
      const piParams: Stripe.PaymentIntentCreateParams = {
        amount: totalAmt,
        currency: currency || 'usd',
        automatic_payment_methods: { enabled: true, allow_redirects: 'always' },
        metadata,
        statement_descriptor: statementDescriptor,
        description: piDescription,
      };
      if (stripeAccountId) {
        piParams.application_fee_amount = 0;
        piParams.transfer_data = { destination: stripeAccountId };
      }
      const pi = await stripe.paymentIntents.create(piParams);
      await saveSignature();
      return new Response(
        JSON.stringify({
          clientSecret: pi.client_secret,
          publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY')!,
          connect_enabled: !!stripeAccountId,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Non-embedded: hosted Checkout Session
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
      price_data: {
        currency: currency || 'usd',
        product_data: {
          name: `${businessName} — Payment`,
          description: `Payment for ${clientName}`,
        },
        unit_amount: amount,
      },
      quantity: 1,
    }];

    if (surchargeAmount && surchargeAmount > 0) {
      const surchargePct = Math.round((surchargeAmount / amount) * 100);
      lineItems.push({
        price_data: {
          currency: currency || 'usd',
          product_data: {
            name: 'Credit card processing fee',
            description: `${surchargePct}% fee — covers card processing costs`,
          },
          unit_amount: surchargeAmount,
        },
        quantity: 1,
      });
    }

    // ACH and Cash App Pay need explicit method types; everything else uses automatic
    const explicitMethodTypes = paymentMethod === 'us_bank_account'
      ? (['us_bank_account'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[])
      : paymentMethod === 'cashapp'
      ? (['cashapp'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[])
      : null;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: lineItems,
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(explicitMethodTypes
        ? { payment_method_types: explicitMethodTypes }
        : { automatic_payment_methods: { enabled: true, allow_redirects: 'always' } }),
    };

    if (stripeAccountId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: 0,
        transfer_data: { destination: stripeAccountId },
        statement_descriptor: statementDescriptor,
        description: piDescription,
      };
    } else {
      sessionParams.payment_intent_data = {
        statement_descriptor: statementDescriptor,
        description: piDescription,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    await saveSignature();

    return new Response(
      JSON.stringify({ url: session.url, connect_enabled: !!stripeAccountId }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('create-checkout error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
