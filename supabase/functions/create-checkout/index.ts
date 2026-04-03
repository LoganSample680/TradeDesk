import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });

  try {
    const body = await req.json();
    const {
      amount, currency, paymentMethod,
      proposalKey, clientName, businessName,
      bidId, contractorUserId, notifyEmail,
      signatureDataUrl, signerName,
      successUrl, cancelUrl
    } = body;

    const paymentMethodTypes = paymentMethod === 'us_bank_account'
      ? ['us_bank_account']
      : ['card'];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: paymentMethodTypes,
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
      customer_email: undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    // Save signature to storage now (before payment completes)
    if (signatureDataUrl && proposalKey) {
      try {
        const { data: existing } = await supabase.storage.from('proposals').download(proposalKey);
        if (existing) {
          const text = await existing.text();
          const proposal = JSON.parse(text);
          const updated = { ...proposal, signatureDataUrl, signerName, status: 'signed_awaiting_payment', signedAt: new Date().toISOString() };
          await supabase.storage.from('proposals').upload(proposalKey, JSON.stringify(updated), { contentType: 'application/json', upsert: true });
        }
      } catch (e) { console.warn('Signature save failed:', e); }
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
