// Supabase Edge Function: rebuild-day
//
// Owner 2026-09-15: "I want Jack to wake up to a clean record of today."
//
// THE DOOR THAT WAS MISSING. The deriver runs server-side on every flush, but
// only for the days the incoming events are stamped with (daysToDerive,
// ../_shared/derive-day.mjs). A day that is already wrong is never handed back
// to it: no new events will ever carry yesterday's date, so yesterday stays
// exactly as the derive that got it wrong left it, until the phone's own boot
// rebuild reaches it. That put "fix a crew member's day" behind "wait for that
// crew member to open the app", which is the wrong way round for a tool whose
// whole point is that the owner can see and fix his own business.
//
// This is that one missing call. It derives ONE person's ONE day with the
// rules as they stand right now, and it is the only server path allowed to
// sweep, because it is the only one a person asked for. See the sweep guard in
// deriveDayServer for what still has to be true.
//
// WHO MAY CALL IT. is_ops_admin(), the same gate the ops portal itself is
// behind (20260923_ops_admin_uid_cast.sql), checked against the CALLER's own
// JWT rather than anything in the body. The service key never leaves this
// function and is used only after that check passes, so a signed-in user who
// is not on the ops allowlist can rebuild nothing, including their own day.
//
// WHAT IT IS NOT. It is not a second writer and not a reconciler (CLAUDE.md
// 17). It runs the same geoDeriveDay over the same evidence and hands the same
// rows to the same geo_replace_day. The only thing it adds is a reason to run.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deriveDayServer } from "../_shared/derive-day.mjs";
import { makeRoute } from "../_shared/route-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// A Central day key and nothing else. The bounds come from centralDayBounds
// inside the deriver, so this only has to refuse a string that is not a date.
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// A rebuild reads a day of events and writes a day of rows. Ten in one call is
// a week and a half, which covers "his whole tape is wrong" without letting a
// single request walk the year.
const MAX_DAYS = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    // ── The caller, from their own token ────────────────────────────────────
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "sign in first" }, 401);
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: me, error: meErr } = await asUser.auth.getUser();
    if (meErr || !me?.user) return json({ ok: false, error: "sign in first" }, 401);
    // is_ops_admin() reads auth.uid(), so asking it through the caller's own
    // client IS the check. Asking through the service key would answer about
    // nobody and always say no, which is the safe way to get this wrong.
    const { data: allowed, error: gateErr } = await asUser.rpc("is_ops_admin");
    if (gateErr) return json({ ok: false, error: "gate: " + gateErr.message }, 500);
    if (allowed !== true) return json({ ok: false, error: "not an ops admin" }, 403);

    // ── What to rebuild ────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const uid = String(body?.employee_user_id || "");
    const cid = String(body?.contractor_user_id || "");
    if (!isUuid(uid) || !isUuid(cid)) {
      return json({ ok: false, error: "employee_user_id and contractor_user_id required" }, 400);
    }
    const days = (Array.isArray(body?.days) ? body.days : [body?.day])
      .map((d: unknown) => String(d || "")).filter(isDay);
    if (!days.length) return json({ ok: false, error: "day required, as YYYY-MM-DD" }, 400);
    if (days.length > MAX_DAYS) return json({ ok: false, error: "at most " + MAX_DAYS + " days" }, 400);
    // Default ON, because a rebuild that cannot remove the rows somebody asked
    // to have removed has not rebuilt anything. `sweep: false` is there for
    // looking at what a re-derive WOULD write without touching what is stored.
    const sweep = body?.sweep !== false;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    // THE ROUTER IS NOT OPTIONAL ON THIS PATH. geo_replace_day lets a sweeping
    // caller rewrite a mileage leg, on the reasoning that a caller who can see
    // the whole day has the better number (20261002_geo_replace_day_keep_miles).
    // A rebuild sweeps, so a rebuild WITHOUT a router would overwrite a routed
    // leg with a breadcrumb sum and quietly cost the day real miles: Jack's
    // 14.8-mile run home is a routed number. Same resolver and same cache as
    // the ingest path, so a road already paid for is free here.
    const route = makeRoute(svc, cid);
    const out = [];
    // In order, one at a time. Each day is its own transaction inside
    // geo_replace_day, and a rebuild is a human waiting on an answer, not a
    // throughput problem.
    for (const day of days.sort()) {
      try {
        out.push(await deriveDayServer(svc, cid, uid, day, Date.now(), route, { sweep }));
      } catch (e) {
        out.push({ day, wrote: false, reason: String((e as Error)?.message || e) });
      }
    }
    return json({ ok: true, employee_user_id: uid, days: out });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
