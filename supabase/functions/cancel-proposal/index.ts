// Client-initiated cancellation from the hub.
//
// The hub cancellation and a forced-cancel attack are both anonymous writes that
// set cancelled_at by bid_id, so RLS can't tell them apart — and cancelled_at
// triggers an auto-refund. This function is the only path allowed to set it
// (a DB trigger blocks the anon role from changing cancelled_at directly).
//
// Authorization: the caller must possess the hub link's secret token. The hub JSON
// only exists at client-hub/{u}/{c}_{t}.json when t/u/c are valid, so a successful
// download proves the caller has the link. An attacker who only guesses a bid_id
// cannot produce a valid token.
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
    const { bidId, u, c, t, signerName } = await req.json();
    if (!bidId || !u || !c || !t) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS });
    }
    const name = String(signerName || '').trim();
    if (name.length < 3) {
      return new Response(JSON.stringify({ error: 'Signer name required' }), { status: 400, headers: CORS });
    }

    // Authorize via the hub token: the hub JSON only exists at this exact key when
    // t/u/c are valid. Downloading it proves the caller has the real hub link.
    const hubKey = `client-hub/${u}/${c}_${t}.json`;
    const { data: hubBlob, error: hubErr } = await supabase.storage.from('proposals').download(hubKey);
    if (hubErr || !hubBlob) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }
    let hub: any = null;
    try { hub = JSON.parse(await hubBlob.text()); } catch { hub = null; }

    // The bid must belong to this client's hub — a valid token for one client must
    // not be usable to cancel an unrelated proposal.
    const ownsBid = hub && Array.isArray(hub.bids) && hub.bids.some((b: any) => String(b.id) === String(bidId));
    if (!ownsBid) {
      return new Response(JSON.stringify({ error: 'Proposal not found for this hub' }), { status: 403, headers: CORS });
    }

    const ts = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('signed_proposals')
      .update({ cancelled_at: ts, cancelled_signed_name: name })
      .eq('bid_id', String(bidId));
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: CORS });
    }

    // Auto-refund any card payment already collected (mirrors cancel-refund; idempotent
    // via the stripe_refund_id guard). Cash/check proposals have no payment intent.
    let refund: { id: string; amount: number } | null = null;
    try {
      const { data: sp } = await supabase
        .from('signed_proposals').select('stripe_payment_intent,stripe_refund_id,contractor_user_id')
        .eq('bid_id', String(bidId)).maybeSingle();
      if (sp?.stripe_payment_intent && !sp.stripe_refund_id) {
        // Direct charges live on the contractor's connected account, so the refund must
        // be issued THERE too — a platform-level refund can't find the payment_intent.
        // Look up the connected account the same way create-checkout routes the charge;
        // fall back to a platform refund for legacy destination/platform charges.
        let connectedAccountId: string | null = null;
        if (sp.contractor_user_id) {
          const { data: userRow } = await supabase
            .from('users').select('account_id').eq('id', sp.contractor_user_id).maybeSingle();
          if (userRow?.account_id) {
            const { data: cfg } = await supabase
              .from('account_config').select('stripe_account_id, stripe_connect_enabled')
              .eq('account_id', userRow.account_id).maybeSingle();
            if (cfg?.stripe_account_id && cfg?.stripe_connect_enabled) connectedAccountId = cfg.stripe_account_id;
          }
        }
        const r = await stripe.refunds.create(
          { payment_intent: sp.stripe_payment_intent, reason: 'requested_by_customer' },
          connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
        );
        await supabase.from('signed_proposals').update({ stripe_refund_id: r.id }).eq('bid_id', String(bidId));
        refund = { id: r.id, amount: r.amount / 100 };
      }
    } catch (e) {
      console.warn('cancel-proposal refund:', (e as Error).message);
    }

    return new Response(
      JSON.stringify({ cancelled: true, refund }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
