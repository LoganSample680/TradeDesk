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

    const now = new Date().toISOString();
    const isContractor = viewerType === 'contractor';
    const isHubOpen   = viewerType === 'client-hub';

    const row: Record<string, unknown> = {
      contractor_user_id: contractorUserId,
      bid_id: String(bidId),
      // opened_at tracks the most recent open of ANY kind (backwards compat)
      opened_at: now,
      viewer_type: isContractor ? 'contractor' : 'client',
    };
    if (clientId) row.client_id = clientId;

    // Three distinct open events — each writes its own timestamp column:
    //   'client-hub'  → hub_opened_at   (client opened the shared hub link)
    //   'client'      → client_opened_at (client opened a specific proposal)
    //   'contractor'  → contractor_opened_at
    if (isHubOpen) {
      row.hub_opened_at = now;
    } else if (!isContractor) {
      row.client_opened_at = now;
    } else {
      row.contractor_opened_at = now;
    }

    // Upsert: first view = INSERT, repeat view = UPDATE.
    // UNIQUE (contractor_user_id, bid_id) — one row per bid.
    // On conflict update only the relevant timestamp field.
    const conflictUpdate: Record<string, unknown> = {
      opened_at: now,
      viewer_type: row.viewer_type,
    };
    if (isHubOpen)        conflictUpdate.hub_opened_at        = now;
    else if (!isContractor) conflictUpdate.client_opened_at   = now;
    else                  conflictUpdate.contractor_opened_at  = now;

    const { error } = await supa
      .from('proposal_views')
      .upsert({ ...row }, { onConflict: 'contractor_user_id,bid_id' });

    if (error) {
      const msg = error.message || error.details || error.hint || JSON.stringify(error);
      console.error('upsert error:', JSON.stringify(error));
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
