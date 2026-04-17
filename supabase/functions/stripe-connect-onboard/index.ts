import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
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

    // Verify caller is an authenticated Supabase user
    const supaAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await supaAnon.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { returnUrl } = await req.json().catch(() => ({ returnUrl: null }));

    // Get user's account_id
    const { data: userRow } = await supaAdmin
      .from('users')
      .select('account_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!userRow?.account_id) {
      return new Response(JSON.stringify({ error: 'No account found for this user' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Get or create stripe_account_id
    const { data: cfg } = await supaAdmin
      .from('account_config')
      .select('stripe_account_id, stripe_connect_enabled')
      .eq('account_id', userRow.account_id)
      .maybeSingle();

    let stripeAccountId: string = cfg?.stripe_account_id;

    if (!stripeAccountId) {
      // Create a new Express connected account
      const acct = await stripe.accounts.create({
        type: 'express',
        metadata: { supabase_account_id: userRow.account_id, supabase_user_id: user.id },
      });
      stripeAccountId = acct.id;

      await supaAdmin
        .from('account_config')
        .update({ stripe_account_id: stripeAccountId, stripe_connect_enabled: false })
        .eq('account_id', userRow.account_id);
    }

    // Build onboarding link — use passed returnUrl or fall back to app URL env
    const baseUrl = returnUrl || Deno.env.get('APP_URL') || 'https://tradedesk.app';
    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: baseUrl + '#stripe-reauth',
      return_url: baseUrl + '#stripe-return',
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({ url: link.url, stripe_account_id: stripeAccountId }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('stripe-connect-onboard error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
