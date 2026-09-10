// Supabase Edge Function: ingest-telemetry
// The single sink for client observability. Verifies the caller's JWT, resolves
// which ACCOUNT the signed-in person belongs to, then writes:
//   • body.errors[] → error_log        (real uid, internal ops data)
//   • body.events[] → analytics_events (account + role + the anonymized hash)
// Both tables are deny-all to clients; this function holds the service role.
//
// THE ACCOUNT, NOT THE PHONE (owner 2026-09-10). This used to hash whoever was
// signed in and store nothing else, so a crew member's events hashed to a
// different value than their own boss's and every per-account rollup split one
// business into one bucket per phone. The account is resolved through
// team_members here, once, and cached per instance.
//
// The hash stays alongside it. It is what anything leaving the company shows;
// the uid is for the internal dashboard, on a table no client can read.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// INSTANT hot lane (optional): a fine-grained GitHub PAT (Actions: write) lets
// this function fire the error-watch workflow the moment an error row lands,
// instead of waiting for its 15-min cron. Unset → cron remains the only trigger.
const GH_DISPATCH_TOKEN = Deno.env.get("GH_DISPATCH_TOKEN") || "";
const GH_DISPATCH_REPO = Deno.env.get("GH_DISPATCH_REPO") || "LoganSample680/TradeDesk";
let _lastDispatch = 0; // per-instance throttle: error bursts fire ONE dispatch/min

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// One-way anonymized contractor hash. Kept for anything shown outside.
async function chash(uid: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tdh:" + uid));
  return "c" + Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Which account this person belongs to, and what they are to it. A crew member
// has a team_members row naming their employer; anybody else IS the account.
// Cached per instance: a phone posts telemetry every 30 seconds and this answer
// changes about once in a person's employment.
type Who = { cid: string; role: string };
const _whoCache = new Map<string, { who: Who; at: number }>();
const WHO_TTL_MS = 10 * 60_000;
async function whoIs(svc: any, uid: string): Promise<Who> {
  const hit = _whoCache.get(uid);
  if (hit && Date.now() - hit.at < WHO_TTL_MS) return hit.who;
  let who: Who = { cid: uid, role: "owner" };
  try {
    const { data } = await svc.from("team_members")
      .select("contractor_user_id")
      .eq("employee_user_id", uid).eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    // A LINK TO YOURSELF IS NOT A CREW LINK. An owner who added themselves to
    // their own team would otherwise be filed as crew on their own account.
    if (data?.contractor_user_id && String(data.contractor_user_id) !== uid) {
      who = { cid: String(data.contractor_user_id), role: "crew" };
    }
  } catch (_e) { /* an unreachable lookup files them as their own account */ }
  _whoCache.set(uid, { who, at: Date.now() });
  return who;
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
      // Instant trigger: wake error-watch NOW (throttled, never blocks the response).
      if (errCount > 0 && GH_DISPATCH_TOKEN && Date.now() - _lastDispatch > 60_000) {
        _lastDispatch = Date.now();
        fetch(`https://api.github.com/repos/${GH_DISPATCH_REPO}/dispatches`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${GH_DISPATCH_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ event_type: "live-error" }),
        }).catch(() => {});
      }
    }

    // ── Telemetry → analytics_events (account, role, aggregated) ──
    let evtCount = 0;
    if (Array.isArray(body.events) && body.events.length) {
      // The app version rides on EVERY analytics row (meta.v), not just
      // error_log. Without it there is no way to tell whether a device is
      // running the build you just shipped, and on 2026-09-03 that turned a
      // day of debugging into guesswork: no liveact_* events were arriving
      // and nothing could distinguish "the fix is not on the phone yet" from
      // "the fix is on the phone and the code path never runs". meta is an
      // existing jsonb column, so this needs no migration.
      const ch = await chash(uid);
      const who = await whoIs(svc, uid);
      // WHAT WROTE THIS. The flow suite drives the deployed app with a real
      // login, so its steps reach here exactly like a customer's taps do
      // (tests/flow/live-helpers.js calls _obs.track). The caller says which
      // it is and only 'test' is taken on trust: anything else, including a
      // caller that says nothing, is treated as a person using the product.
      const source = String((body as any).source || "app") === "test" ? "test" : "app";
      const stamp = { contractor_hash: ch, contractor_user_id: who.cid,
                      employee_user_id: uid, role: who.role, source,
                      session_id: sid, meta: ver ? { v: ver } : null };
      const agg: Record<string, { event: string; ctx: string | null; n: number }> = {};
      const out: Record<string, unknown>[] = [];
      for (const ev of (body.events as any[]).slice(0, 500)) {
        const event = String(ev?.event || "event").slice(0, 40);
        const ctx = ev?.ctx != null ? String(ev.ctx).slice(0, 80) : null;
        if (typeof ev?.value === "number") { out.push({ ...stamp, event, ctx, value: ev.value }); continue; }
        const k = event + "|" + (ctx || "");
        (agg[k] ||= { event, ctx, n: 0 }).n++;
      }
      for (const k of Object.keys(agg)) out.push({ ...stamp, event: agg[k].event, ctx: agg[k].ctx, value: agg[k].n });
      if (out.length) { const { error } = await svc.from("analytics_events").insert(out); if (!error) evtCount = out.length; }
    }

    return json({ ok: true, errors: errCount, events: evtCount });
  } catch (e) {
    return json({ ok: false, error: String((e && (e as Error).message) || e) });
  }
});
