// Supabase Edge Function: wake-quiet
//
// Every two minutes (pg_cron, migration 20261052), find each phone whose last
// word to the server was "backgrounded" three to twenty minutes ago, inside
// the working day, and send it one silent push. An app iOS closed is
// relaunched by it; a running one logs a position. Owner 2026-09-28: Jack's
// app sat dark for up to 18 minutes after a close because nothing woke it
// until the half-hour ping. The rules are pure and tested in
// _shared/terminate-wake.mjs (quietWakeDue); this is only the plumbing.
//
// HONEST LIMIT, same as push-geo-ping: Apple does not deliver silent pushes to
// an app the user swiped away. The fence and significant-change wakes still
// cover that.
//
// AUTH: none beyond the rate gate, like push-geo-ping. The caller is a public
// cron and the only thing this can do is send empty background pushes to
// phones that installed the app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsConfigured } from "../_shared/apns.ts";
import { sendSilentWake } from "../_shared/silent-push.ts";
import { quietWakeDue, workHoursFromSettings } from "../_shared/terminate-wake.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    if (!apnsConfigured()) return json({ ok: false, error: "APNs not configured" }, 503);
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: gate } = await svc.from("cron_watermarks")
      .select("ran_at").eq("name", "wake-quiet").maybeSingle();
    if (gate && Date.now() - Date.parse(gate.ran_at) < 90000) {
      return json({ ok: true, skipped: "rate-gated" });
    }
    await svc.from("cron_watermarks").upsert({ name: "wake-quiet", ran_at: new Date().toISOString() });

    // Only people with a phone we can push to; a handful of rows.
    const { data: toks, error: terr } = await svc.from("device_tokens")
      .select("token,user_id").is("invalid_at", null).limit(500);
    if (terr) return json({ ok: false, error: terr.message }, 500);
    const byUser = new Map<string, string[]>();
    for (const t of toks || []) {
      const list = byUser.get(t.user_id) || [];
      list.push(t.token);
      byUser.set(t.user_id, list);
    }

    const now = Date.now();
    let woke = 0;
    const settingsCache = new Map<string, unknown>();
    for (const [uid, tokens] of byUser) {
      try {
        // The newest thing the server heard from this person
        // (geo_events_person_created_idx).
        const { data: last } = await svc.from("geo_events")
          .select("type,created_at,contractor_user_id")
          .eq("employee_user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!last || last.type !== "app-background") continue;
        const cid = String(last.contractor_user_id || uid);
        if (!settingsCache.has(cid)) {
          const { data: cfg } = await svc.from("zj_data").select("settings").eq("user_id", cid).maybeSingle();
          settingsCache.set(cid, cfg?.settings ?? null);
        }
        const key = "wake:" + uid;
        const { data: wm } = await svc.from("cron_watermarks").select("ran_at").eq("name", key).maybeSingle();
        const lastWake = wm?.ran_at ? Date.parse(wm.ran_at) : NaN;
        if (!quietWakeDue(last, now, workHoursFromSettings(settingsCache.get(cid)), lastWake)) continue;
        await svc.from("cron_watermarks").upsert({ name: key, ran_at: new Date().toISOString() });
        // Short expiry: a wake that lands ten minutes late is the next check's job.
        const out = await sendSilentWake(svc, tokens, "geo-wake", 300);
        woke += out.sent;
        console.log("[wake-quiet]", { uid, sent: out.sent, pruned: out.pruned });
      } catch (e) {
        console.error(`[wake-quiet] ${String(e).slice(0, 200)}`);
      }
    }
    return json({ ok: true, people: byUser.size, woke });
  } catch (e) {
    console.error(`[wake-quiet] ${String(e).slice(0, 300)}`);
    return json({ ok: false, error: "failed" }, 500);
  }
});
