// Opens Stripe's hosted Billing Portal for an existing subscriber to manage
// payment method, view invoices, or cancel. Same auth/allowlist shape as
// create-billing-checkout, mirrored for consistency.
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

    const { data: sub } = await supaAdmin
      .from('td_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No subscription on file for this account.' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const mode = resolveStripeMode(req);
    const stripe = new Stripe(stripeSecretKey(mode), { apiVersion: '2023-10-16' });
    const { returnUrl } = await req.json().catch(() => ({ returnUrl: null }));
    const baseUrl = returnUrl || 'https://logansample680.github.io/TradeDesk/';

    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: baseUrl,
    });

    return new Response(
      JSON.stringify({ url: portal.url }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('create-billing-portal error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
