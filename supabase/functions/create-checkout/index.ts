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

    const metadata = {
      proposalKey, bidId, contractorUserId,
      notifyEmail, signerName, clientName, businessName,
      paymentMethod: paymentMethod || 'card',
    };

    let sessionParams: Stripe.Checkout.SessionCreateParams;

    // ACH and Cash App Pay need explicit method types.
    // Card/debit/applepay use automatic_payment_methods so Apple Pay, Google Pay,
    // and Link all surface automatically based on device/browser support.
    const explicitMethodTypes = paymentMethod === 'us_bank_account'
      ? (['us_bank_account'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[])
      : paymentMethod === 'cashapp'
      ? (['cashapp'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[])
      : null;

    if (embedded) {
      sessionParams = {
        mode: 'payment',
        line_items: lineItems,
        metadata,
        ui_mode: 'embedded',
        return_url: successUrl,
        ...(explicitMethodTypes
          ? { payment_method_types: explicitMethodTypes }
          : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' } }),
      };
    } else {
      sessionParams = {
        mode: 'payment',
        line_items: lineItems,
        metadata,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(explicitMethodTypes
          ? { payment_method_types: explicitMethodTypes }
          : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' } }),
      };
    }

    // Statement descriptor: "SAMPLE-DEPOSIT" or "SAMPLE-FULL" (max 22 chars)
    const _lastName = ((clientName||'').trim().split(/\s+/).pop()||'CLIENT').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const _suffix = paymentType === 'full' ? 'FULL' : 'DEPOSIT';
    const statementDescriptor = (_lastName + '-' + _suffix).substring(0, 22) || 'PAYMENT';

    // Route payment to contractor's connected account if available
    if (stripeAccountId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: 0,
        transfer_data: { destination: stripeAccountId },
        statement_descriptor: statementDescriptor,
      };
    } else {
      sessionParams.payment_intent_data = { statement_descriptor: statementDescriptor };
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

    if (embedded) {
      return new Response(
        JSON.stringify({
          clientSecret: session.client_secret,
          publishableKey: Deno.env.get('STRIPE_PUBLISHABLE_KEY')!,
          connect_enabled: !!stripeAccountId,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

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
