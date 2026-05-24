import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers — sign.html is served from a different origin than the function
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Service-role key bypasses all RLS — this is the "server-side" equivalent.
// The anon caller supplies only contractorUserId + bidId; we do the write.
const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req: Request) => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { contractorUserId, bidId } = await req.json();

    if (!contractorUserId || !bidId) {
      return json({ error: 'contractorUserId and bidId required' }, 400);
    }

    const now = new Date().toISOString();

    // Upsert: first view = INSERT, repeat view = UPDATE opened_at.
    // onConflict requires UNIQUE (contractor_user_id, bid_id) — see migration note below.
    const { error } = await supa
      .from('proposal_views')
      .upsert(
        { contractor_user_id: contractorUserId, bid_id: String(bidId), opened_at: now },
        { onConflict: 'contractor_user_id,bid_id' }
      );

    if (error) throw error;

    // ── Push notifications (future) ───────────────────────────────────────────
    // When a contractor opts in, load their push subscription here and fire it.
    // The contractorUserId is already available — no additional auth needed.
    // await sendPushToContractor(contractorUserId, { bidId, event: 'viewed' });
    // ─────────────────────────────────────────────────────────────────────────

    return json({ ok: true }, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('log-proposal-view error:', msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
