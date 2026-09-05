// Supabase Edge Function: push-geo-ping
//
// The 30-minute liveness nudge (owner 2026-08-27: "iOS pings with real time
// pushes to supabase no matter what with 30 minute gps background pings").
// A GitHub Actions cron (.github/workflows/geo-ping-cron.yml) POSTs here
// every half hour; this sends a CONTENT-AVAILABLE (silent) push to every
// registered device. iOS wakes the backgrounded app, the AppDelegate forwards
// to TdGeo (TdSilentPush), which records a push-ping event with the current
// fix and flushes it through ingest-geo into geo_events. Result: a phone
// sitting in a pocket at a job reports in every ~30 minutes.
//
// HONEST LIMIT: Apple does not deliver silent pushes to an app the user
// FORCE-QUIT. That case stays covered by the region/SLC wake net only.
//
// AUTH: none beyond the rate gate, deliberately. Every function here deploys
// --no-verify-jwt, the caller is a public cron, and the only thing this can
// do is emit empty background pushes to devices that installed the app: no
// data goes out, nothing is read back. The cron_watermarks gate (20 min)
// bounds abuse at worst-case 3 wakes/hour, the same order as organic wakes.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsConfigured, apnsJwt, apnsSend } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    if (!apnsConfigured()) return json({ ok: false, error: "APNs not configured" }, 503);
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // Rate gate: whatever calls this, devices are nudged at most every 20
    // minutes. The read-then-write race window is a few ms against a
    // 30-minute cron; a rare double tick costs one extra silent push.
    const { data: wm } = await svc.from("cron_watermarks")
      .select("ran_at").eq("name", "geo-ping").maybeSingle();
    if (wm && Date.now() - Date.parse(wm.ran_at) < 20 * 60000) {
      return json({ ok: true, skipped: "rate-gated" });
    }
    await svc.from("cron_watermarks")
      .upsert({ name: "geo-ping", ran_at: new Date().toISOString() });

    const { data: rows, error: qerr } = await svc.from("device_tokens")
      .select("token").is("invalid_at", null).limit(500);
    if (qerr) return json({ ok: false, error: qerr.message }, 500);
    if (!rows?.length) return json({ ok: true, sent: 0, note: "no devices" });

    const jwt = await apnsJwt();
    // aps is Apple's namespace; td is ours, read by the AppDelegate forward.
    const payload = JSON.stringify({ aps: { "content-available": 1 }, td: "geo-ping" });
    const dead: string[] = [];
    let sent = 0;
    await Promise.all(rows.map(async (r) => {
      try {
        // Background pushes MUST be priority 5; Apple rejects 10 for
        // content-available-only payloads. Expire before the next tick: a
        // nudge delivered 40 minutes late is the next nudge's job.
        const out = await apnsSend(jwt, r.token, payload, {
          "apns-push-type": "background",
          "apns-priority": "5",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 1500),
        });
        if (out.ok) sent++;
        else if (out.dead) dead.push(r.token);
      } catch (e) {
        console.error(`[push-geo-ping] ${String(e).slice(0, 200)}`);
      }
    }));
    if (dead.length) {
      await svc.from("device_tokens")
        .update({ invalid_at: new Date().toISOString() }).in("token", dead);
    }
    return json({ ok: true, sent, pruned: dead.length });
  } catch (e) {
    console.error(`[push-geo-ping] ${String(e).slice(0, 300)}`);
    return json({ ok: false, error: "failed" }, 500);
  }
});
