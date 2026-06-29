// Supabase Edge Function: ingest-telemetry
// The single sink for client observability. Verifies the caller's JWT, derives an
// ANONYMIZED contractor_hash (the raw uid never lands in analytics), then writes:
//   • body.errors[] → error_log     (real uid — internal ops data)
//   • body.events[] → analytics_events (anonymized + aggregated counts, no PII)
// Both tables are deny-all to clients; this function holds the service role.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// One-way anonymized contractor hash — never store the raw uid in analytics.
async function chash(uid: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tdh:" + uid));
  return "c" + Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ ok: false, error: "no auth" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ ok: false, error: "invalid auth" }, 401);
    const uid = user.id;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const sid = body.session_id ? String(body.session_id).slice(0, 40) : null;
    const ver = body.app_version ? String(body.app_version).slice(0, 20) : null;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Errors → error_log (real uid, ops) ──
    let errCount = 0;
    if (Array.isArray(body.errors) && body.errors.length) {
      const rows = (body.errors as any[]).slice(0, 20).map((e) => ({
        user_id: uid,
        kind: String(e?.kind || "error").slice(0, 40),
        message: String(e?.message || "").slice(0, 2000),
        stack: e?.stack ? String(e.stack).slice(0, 4000) : null,
        url: e?.url ? String(e.url).slice(0, 500) : null,
        ua: (req.headers.get("user-agent") || "").slice(0, 300),
        context: e?.context ?? null,
        app_version: ver,
      }));
      const { error } = await svc.from("error_log").insert(rows);
      if (!error) errCount = rows.length;
    }

    // ── Telemetry → analytics_events (anonymized, aggregated) ──
    let evtCount = 0;
    if (Array.isArray(body.events) && body.events.length) {
      const ch = await chash(uid);
      const agg: Record<string, { event: string; ctx: string | null; n: number }> = {};
      const out: Record<string, unknown>[] = [];
      for (const ev of (body.events as any[]).slice(0, 500)) {
        const event = String(ev?.event || "event").slice(0, 40);
        const ctx = ev?.ctx != null ? String(ev.ctx).slice(0, 80) : null;
        if (typeof ev?.value === "number") { out.push({ contractor_hash: ch, session_id: sid, event, ctx, value: ev.value, meta: null }); continue; }
        const k = event + "|" + (ctx || "");
        (agg[k] ||= { event, ctx, n: 0 }).n++;
      }
      for (const k of Object.keys(agg)) out.push({ contractor_hash: ch, session_id: sid, event: agg[k].event, ctx: agg[k].ctx, value: agg[k].n, meta: null });
      if (out.length) { const { error } = await svc.from("analytics_events").insert(out); if (!error) evtCount = out.length; }
    }

    return json({ ok: true, errors: errCount, events: evtCount });
  } catch (e) {
    return json({ ok: false, error: String((e && (e as Error).message) || e) });
  }
});
