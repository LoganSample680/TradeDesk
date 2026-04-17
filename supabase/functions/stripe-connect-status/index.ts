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

    const { data: userRow } = await supaAdmin
      .from('users')
      .select('account_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!userRow?.account_id) {
      return new Response(
        JSON.stringify({ connected: false, reason: 'no_account' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const { data: cfg } = await supaAdmin
      .from('account_config')
      .select('stripe_account_id, stripe_connect_enabled')
      .eq('account_id', userRow.account_id)
      .maybeSingle();

    if (!cfg?.stripe_account_id) {
      return new Response(
        JSON.stringify({ connected: false, reason: 'no_stripe_account' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Check live status directly from Stripe
    const acct = await stripe.accounts.retrieve(cfg.stripe_account_id);

    // Sync status to DB if it changed
    if (acct.charges_enabled && !cfg.stripe_connect_enabled) {
      await supaAdmin
        .from('account_config')
        .update({ stripe_connect_enabled: true })
        .eq('account_id', userRow.account_id);
    }

    return new Response(
      JSON.stringify({
        connected: true,
        charges_enabled: acct.charges_enabled,
        details_submitted: acct.details_submitted,
        stripe_account_id: cfg.stripe_account_id,
        payouts_enabled: acct.payouts_enabled,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('stripe-connect-status error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
