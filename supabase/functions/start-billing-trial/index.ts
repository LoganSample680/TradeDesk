// Silently starts a contractor's 14-day free trial the moment their account
// is created (called once from obSubmit right after signup). No checkout
// redirect, no card prompt: a full trial has nothing due today, so there is
// nothing to collect. This is what makes "day 15" a real, unavoidable
// deadline instead of something that only starts if a contractor happens to
// find the Subscribe button in Settings (owner spec 2026-07-17).
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

    // Never-charge allowlist — no trial, no subscription, nothing to track.
    const { data: exempt } = await supaAdmin
      .from('billing_exempt_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (exempt) {
      return new Response(JSON.stringify({ ok: true, exempt: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Idempotent: a retried/duplicate call (flaky network mid-onboarding)
    // must never spin up a second Stripe subscription for the same account.
    // This also makes create-billing-checkout's later trial-repeat guard
    // work correctly, once this row exists that function never grants a
    // second free trial.
    const { data: existing } = await supaAdmin
      .from('td_subscriptions')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, already: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const mode = resolveStripeMode(req);
    const stripe = new Stripe(stripeSecretKey(mode), { apiVersion: '2023-10-16' });
    const priceId = mode === 'test' ? Deno.env.get('STRIPE_PRICE_ID_TEST') : Deno.env.get('STRIPE_PRICE_ID');
    if (!priceId) {
      // Billing not configured yet in this environment — not a signup
      // blocker, the Settings "Subscribe" button remains a manual fallback
      // once it is.
      return new Response(JSON.stringify({ ok: false, error: 'Billing is not configured yet.' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: { tradedesk_user_id: user.id },
    });
    // No default_payment_method — nothing is due during a full trial, so
    // Stripe never asks for one. trial_settings.end_behavior cancels
    // cleanly on day 14 if one still hasn't been added by then (the app's
    // gridlock gate is what actually prompts for one before that happens).
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 14,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { tradedesk_user_id: user.id },
    });

    return new Response(
      JSON.stringify({ ok: true, subscriptionId: subscription.id }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('start-billing-trial error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
