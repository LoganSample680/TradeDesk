import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

// CORS headers — sign.html is served from a different origin than the function
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Service-role key bypasses all RLS — this is the "server-side" equivalent.
// The anon caller supplies only contractorUserId + bidId; we do the write.
const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

Deno.serve(async (req: Request) => {
  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { contractorUserId, bidId, clientId, viewerType, step } = await req.json();

    if (!contractorUserId || !bidId) {
      return json({ error: 'contractorUserId and bidId required' }, 400);
    }

    // Audit capture: the client's real IP + device, read server-side from the
    // request headers (the browser can't set these), so a signed-proposal audit
    // report can show where the open/signature came from. x-forwarded-for is a
    // comma list, client first; fall back to Cloudflare's header.
    const ip = ((req.headers.get('x-forwarded-for') || '').split(',')[0].trim())
             || req.headers.get('cf-connecting-ip') || null;
    const ua = req.headers.get('user-agent') || null;

    // Step ping — sign-flow funnel ('approved' | 'signature_ready' |
    // 'payment_viewed' | 'method_selected' | 'signed'). Monotonic upsert onto
    // proposal_views.furthest_step + one anonymized analytics_events row; the
    // RPC ignores unknown step names.
    if (step) {
      const { error } = await supa.rpc('log_proposal_step', {
        p_contractor_user_id: contractorUserId,
        p_bid_id:             String(bidId),
        p_step:               String(step),
      });
      if (error) {
        const msg = error.message || error.details || error.hint || JSON.stringify(error);
        console.error('log_proposal_step error:', JSON.stringify(error));
        return json({ error: msg, code: error.code, details: error.details }, 500);
      }
      // Stamp the signature with the signer's IP + device for the audit report.
      // Update-only: the client upserts signed_proposals around the same moment;
      // whichever lands second doesn't clobber the other (each writes its own
      // columns), so the IP ends up recorded regardless of ordering.
      if (String(step) === 'signed' && ip) {
        const { error: sigErr } = await supa
          .from('signed_proposals')
          .update({ ip_address: ip, user_agent: ua })
          .eq('contractor_user_id', contractorUserId)
          .eq('bid_id', String(bidId));
        if (sigErr) console.error('signed_proposals ip stamp error:', sigErr.message);
      }
      return json({ ok: true }, 200);
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
      p_client_id:          clientId != null ? String(clientId) : null,  // numeric IDs stored as text
      p_ip:                 ip,
      p_ua:                 ua,
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
