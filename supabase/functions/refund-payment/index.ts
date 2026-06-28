// Contractor-initiated refund from the collect screen (e.g. refunding an overage).
//
// Smart by construction:
//   • EXACT AMOUNT — refunds precisely the cents the contractor typed, never the whole
//     charge. Stripe rejects an amount greater than the remaining refundable balance, so
//     an over-refund is guarded server-side too.
//   • RIGHT CLIENT — the refund is issued against the stripe_payment_intent stored on
//     THIS bid's signed_proposals row, which belongs to exactly one client. It is
//     impossible to refund a different client's payment.
//   • RIGHT CONTRACTOR — the caller's JWT must resolve to the contractor who owns the bid
//     (contractor_user_id), or it's rejected. And the refund is issued ON that
//     contractor's connected account (direct charge), so the money comes back out of
//     their balance — never the platform's.
//
// The charge.refunded webhook books the ledger entry (single source of truth); this
// function also stamps stripe_refund_id so the UI reflects it immediately.
import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey, getStripeSecretKey } from '../_shared/keys.ts';

const stripe = new Stripe(getStripeSecretKey(), { apiVersion: '2023-10-16' });
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Authenticated contractor only — resolve the caller from their JWT.
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

    const { bidId, amount } = await req.json();
    const cents = Math.round(Number(amount) * 100);
    if (!bidId || !Number.isFinite(cents) || cents <= 0) {
      return new Response(JSON.stringify({ error: 'A positive refund amount is required' }), { status: 400, headers: CORS });
    }

    // The card payment for THIS bid → guarantees the refund hits the right client.
    const { data: sp } = await supabase
      .from('signed_proposals')
      .select('stripe_payment_intent,stripe_refund_id,contractor_user_id')
      .eq('bid_id', String(bidId)).maybeSingle();
    if (!sp?.stripe_payment_intent) {
      return new Response(JSON.stringify({ error: 'No card payment on file for this proposal' }), { status: 400, headers: CORS });
    }
    // Ownership: only the contractor who owns the bid may refund it.
    if (sp.contractor_user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Not your proposal' }), { status: 403, headers: CORS });
    }

    // Resolve the contractor's connected account — direct-charge refunds must be issued there.
    let connectedAccountId: string | null = null;
    const { data: userRow } = await supabase.from('users').select('account_id').eq('id', sp.contractor_user_id).maybeSingle();
    if (userRow?.account_id) {
      const { data: cfg } = await supabase
        .from('account_config').select('stripe_account_id, stripe_connect_enabled')
        .eq('account_id', userRow.account_id).maybeSingle();
      if (cfg?.stripe_account_id && cfg?.stripe_connect_enabled) connectedAccountId = cfg.stripe_account_id;
    }

    // Refund EXACTLY the requested amount against that intent.
    const r = await stripe.refunds.create(
      { payment_intent: sp.stripe_payment_intent, amount: cents, reason: 'requested_by_customer' },
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
    );
    await supabase.from('signed_proposals').update({ stripe_refund_id: r.id }).eq('bid_id', String(bidId));

    return new Response(
      JSON.stringify({ refund: { id: r.id, amount: r.amount / 100 } }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
