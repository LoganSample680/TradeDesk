import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const { contractorUserId, bidId, clientId, viewerType } = await req.json();

    if (!contractorUserId || !bidId) {
      return json({ error: 'contractorUserId and bidId required' }, 400);
    }

    // Use the atomic Postgres function so view counts are incremented in a single
    // INSERT ... ON CONFLICT DO UPDATE statement — no race condition.
    // Three distinct viewer types:
    //   'client-hub'  → hub_opened_at + hub_view_count++
    //   'client'      → client_opened_at + client_view_count++
    //   'contractor'  → contractor_opened_at (no count — not a real client view)
    const { error } = await supa.rpc('log_proposal_view_with_count', {
      p_contractor_user_id: contractorUserId,
      p_bid_id:             String(bidId),
      p_viewer_type:        viewerType || 'client',
      p_client_id:          clientId   || null,
    });

    if (error) {
      const msg = error.message || error.details || error.hint || JSON.stringify(error);
      console.error('log_proposal_view_with_count error:', JSON.stringify(error));
      return json({ error: msg, code: error.code, details: error.details }, 500);
    }

    // ── Push notifications (future) ───────────────────────────────────────────
    // When a contractor opts in, load their push subscription here and fire it.
    // The contractorUserId is already available — no additional auth needed.
    // Only notify on real client opens, not contractor previews.
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
