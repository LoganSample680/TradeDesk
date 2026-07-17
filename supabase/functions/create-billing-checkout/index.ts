// Creates a Stripe Checkout Session for TradeDesk's OWN $99/mo platform
// subscription — the contractor paying for the app itself, never Stripe
// Connect (that's client-to-contractor money, see stripe-connect-onboard).
//
// Owner spec 2026-07-17: a small allowlist of accounts (dev accounts, early
// testers) is never charged, enforced HERE, server-side, not just hidden in
// the UI — a hand-rolled call against this function can't bypass it either.
import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey, resolveStripeMode, stripeSecretKey } from '../_shared/keys.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getServiceRoleKey()
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supaAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Never-charge allowlist — checked before a real Stripe session is ever
    // created, so an exempt account can't be billed through any path.
    const { data: exempt } = await supaAdmin
      .from('billing_exempt_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (exempt) {
      return new Response(JSON.stringify({ error: 'This account does not require billing.' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const mode = resolveStripeMode(req);
    const stripe = new Stripe(stripeSecretKey(mode), { apiVersion: '2023-10-16' });
    const priceId = mode === 'test' ? Deno.env.get('STRIPE_PRICE_ID_TEST') : Deno.env.get('STRIPE_PRICE_ID');
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Billing is not configured yet.' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Reuse the existing Stripe customer if this account has subscribed
    // before (e.g. re-subscribing after a cancel) — one customer per account,
    // never a duplicate.
    const { data: existingSub } = await supaAdmin
      .from('td_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const { returnUrl } = await req.json().catch(() => ({ returnUrl: null }));
    const baseUrl = returnUrl || 'https://logansample680.github.io/TradeDesk/';

    // Owner spec 2026-07-17: card is collected at signup (Stripe Checkout
    // subscription mode always does this), but the FIRST CHARGE is 14 days
    // out, not immediate, standard trial pattern so a contractor can back out
    // free. After that, every contractor bills on the 1st of the month, not
    // their own signup/trial-end anniversary: trial_end lands the first real
    // charge on the 1st that's on-or-after day 14, never mid-trial (Stripe
    // requires billing_cycle_anchor >= trial_end, so the anchor is computed
    // from the trial end date, not from "now").
    const trialEndMs = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const trialEnd = new Date(trialEndMs);
    let anchorYear = trialEnd.getUTCFullYear(), anchorMonth = trialEnd.getUTCMonth();
    if (trialEnd.getUTCDate() > 1) anchorMonth += 1; // trial ends mid-month → the FOLLOWING month's 1st
    const billingCycleAnchor = Math.floor(Date.UTC(anchorYear, anchorMonth, 1, 0, 0, 0) / 1000);
    const trialEndUnix = Math.floor(trialEndMs / 1000);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: existingSub?.stripe_customer_id || undefined,
      customer_email: existingSub?.stripe_customer_id ? undefined : (user.email || undefined),
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: {
        metadata: { tradedesk_user_id: user.id },
        trial_end: trialEndUnix,
        billing_cycle_anchor: billingCycleAnchor,
      },
      success_url: baseUrl + '?billing=success',
      cancel_url: baseUrl + '?billing=cancel',
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('create-billing-checkout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
