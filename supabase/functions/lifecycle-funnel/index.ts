import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

// Owner-wide funnel timings across EVERY account.
//
// A contractor cannot get this by calling the RPC directly: lifecycle_funnel is
// SECURITY INVOKER, so row-level security still limits them to their own rows no
// matter what scope they ask for. That is deliberate, one contractor must never
// see across accounts. This function is the only path to the cross-account
// numbers, and it runs the query with the service role ONLY after confirming the
// caller is on the owner allowlist.
//
// Set ANALYTICS_OWNER_UIDS (comma-separated auth uids) as a function secret. If
// it is unset, this returns 403 for everyone rather than defaulting to open.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supa = createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    // Identify the caller from their own token, never from the request body.
    const { data: userRes, error: userErr } = await supa.auth.getUser(jwt);
    const uid = userRes?.user?.id;
    if (userErr || !uid) return json({ error: 'unauthorized' }, 401);

    const allow = (Deno.env.get('ANALYTICS_OWNER_UIDS') || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!allow.length || !allow.includes(uid)) return json({ error: 'forbidden' }, 403);

    let since: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.since === 'string') since = body.since;
    } catch (_e) { /* body is optional */ }

    const { data, error } = await supa.rpc('lifecycle_funnel', { p_scope: 'all', p_since: since });
    if (error) {
      console.error('lifecycle_funnel error:', error.message);
      return json({ error: error.message }, 500);
    }
    return json({ stages: data || [] }, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('lifecycle-funnel error:', msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
