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

    // Owner spec 2026-07-17 (revised): a genuine free trial, no card required
    // to start it. 14 days, bills on the trial-end anniversary from then on
    // (no forced calendar-day anchor, that's not how most SaaS does it and it
    // isn't worth the added complexity). payment_method_collection:'if_required'
    // is the actual Stripe mechanism for this: since nothing is due today
    // (full trial, $0), Checkout skips the card form entirely. A card only
    // gets asked for once Stripe actually needs one, at trial end, via the
    // billing portal (see openBillingPortal, js/cloud.js) or Stripe's own
    // trial-ending reminder email.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: existingSub?.stripe_customer_id || undefined,
      customer_email: existingSub?.stripe_customer_id ? undefined : (user.email || undefined),
      payment_method_collection: 'if_required',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: {
        metadata: { tradedesk_user_id: user.id },
        trial_period_days: 14,
        // No card was collected at signup, so if one still hasn't been added
        // by day 14, cancel cleanly instead of leaving a dangling unpaid
        // invoice and a past_due subscription nobody asked for. Exports were
        // already locked the whole time either way (0 paid cycles).
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
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
