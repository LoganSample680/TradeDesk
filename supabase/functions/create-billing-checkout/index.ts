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
    const withParam = (url: string, kv: string) => url + (url.includes('?') ? '&' : '?') + kv;

    // Owner spec 2026-07-17 (revised again): the trial itself now starts
    // silently at signup (start-billing-trial, called once from obSubmit),
    // so by the time anyone reaches THIS checkout call they almost always
    // already have a td_subscriptions row — either still trialing (they
    // wouldn't see a Subscribe button), or lapsed/canceled/past_due. A
    // second free trial_period_days here would let a lapsed trial reset
    // itself indefinitely just by clicking Subscribe again. Only grant a
    // trial when this account has genuinely never had a subscription record
    // at all (the silent start-billing-trial call never landed — billing
    // wasn't configured yet, or this is a pre-existing account from before
    // this feature shipped).
    const isFirstEverSubscription = !existingSub;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: existingSub?.stripe_customer_id || undefined,
      customer_email: existingSub?.stripe_customer_id ? undefined : (user.email || undefined),
      // payment_method_collection:'if_required' is what lets a genuine full
      // trial skip the card form entirely (nothing due today, $0). A
      // resubscribe with no trial always has something due today, so
      // Checkout collects a card as normal either way.
      payment_method_collection: 'if_required',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: {
        metadata: { tradedesk_user_id: user.id },
        ...(isFirstEverSubscription ? {
          trial_period_days: 14,
          // No card was collected at signup, so if one still hasn't been
          // added by day 14, cancel cleanly instead of leaving a dangling
          // unpaid invoice and a past_due subscription nobody asked for.
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        } : {}),
      },
      success_url: withParam(baseUrl, 'billing=success'),
      cancel_url: withParam(baseUrl, 'billing=cancel'),
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
