import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

// Unlink Stripe from this account. This ONLY clears the pointer we store
// (account_config.stripe_account_id / stripe_connect_enabled) — it does NOT
// delete or deauthorize the Stripe account itself, which may be the owner's real
// personal account. After unlinking, stripe-connect-onboard sees no id and starts
// a fresh onboarding, so this is the in-app equivalent of the manual DB clear we
// used to need before reconnecting.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Service role client verifies the token (works with HS256 + ES256) and
    // performs the update, bypassing the owner-vs-member RLS split.
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

    const { error: updErr } = await supaAdmin
      .from('account_config')
      .update({ stripe_account_id: null, stripe_connect_enabled: false })
      .eq('account_id', userRow.account_id);

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ disconnected: true }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('stripe-connect-disconnect error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
