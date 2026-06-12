import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Verify the caller is an authenticated contractor who owns this bid
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  try {
    const { bidId } = await req.json();
    if (!bidId) return new Response(JSON.stringify({ error: 'bidId required' }), { status: 400, headers: CORS });

    const { data: sp, error: spErr } = await supabase
      .from('signed_proposals')
      .select('*')
      .eq('bid_id', String(bidId))
      .maybeSingle();

    if (spErr || !sp) {
      return new Response(JSON.stringify({ refunded: false, reason: 'no_record' }), { headers: CORS });
    }
    if (!sp.cancelled_at) {
      return new Response(JSON.stringify({ refunded: false, reason: 'not_cancelled' }), { headers: CORS });
    }
    if (!sp.stripe_payment_intent) {
      // Cash or check payment — no Stripe refund possible, contractor handles manually
      return new Response(JSON.stringify({ refunded: false, reason: 'no_stripe_payment' }), { headers: CORS });
    }
    if (sp.stripe_refund_id) {
      // Already refunded — idempotent
      return new Response(JSON.stringify({ refunded: true, already_refunded: true, refund_id: sp.stripe_refund_id }), { headers: CORS });
    }

    // Destination charge — refund on platform, Stripe auto-reverses the connected-account transfer
    const refund = await stripe.refunds.create({
      payment_intent: sp.stripe_payment_intent,
      reason: 'requested_by_customer',
    });

    await supabase
      .from('signed_proposals')
      .update({ stripe_refund_id: refund.id })
      .eq('bid_id', String(bidId));

    return new Response(
      JSON.stringify({ refunded: true, refund_id: refund.id, amount: refund.amount / 100 }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('cancel-refund error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
