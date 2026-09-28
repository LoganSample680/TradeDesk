// Supabase Edge Function: update-live-activity
//
// Changes or ends a Live Activity card on someone's lock screen FROM THE
// SERVER, with their app closed. The phone-driven half (js/live-activity.js)
// covers everything the phone itself knows; this covers what it cannot know:
// the office acted. First consumer: force clock-out. A manager closing a
// forgotten clock from Time Log ends the crew phone's CLOCKED IN card, which
// until this kept ticking on the lock screen until the app was next opened,
// the exact lie the card exists to prevent.
//
// AUTH mirrors send-push: the caller's JWT resolves the account they belong
// to, and the target row must belong to THAT account. The token is looked up
// server-side by (user, channel), never taken from the request, so nobody can
// address a card on a stranger's phone.
//
// The content-state sent here MUST decode into the Swift ContentState
// (TdLiveAttributes.swift): every field present, exact key names. A missing
// field makes iOS drop the push silently, so defaults are filled server-side.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { APNS_TOPIC, apnsConfigured, apnsJwt, apnsSend } from "../_shared/apns.ts";
// ONE FIELD LIST, NOT THREE (2026-09-16). ActivityKit drops a push silently
// when one content-state key is missing, so the list was copied here, into
// js/live-activity.js and into live-push.ts: three places to forget the next
// time TdLiveAttributes.ContentState gains a field. It is one function now.
import { liveContentState } from "../_shared/live-card.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!apnsConfigured()) return json({ ok: false, error: "APNs not configured" }, 503);

    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ ok: false, error: "no auth" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ ok: false, error: "invalid auth" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const channel = String(body.channel || "clock");
    const targetUser = String(body.user || user.id);
    const event = body.event === "end" ? "end" : "update";

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // The caller's account, derived from their JWT exactly as send-push does.
    let account = user.id;
    const { data: emp } = await admin
      .from("team_members").select("contractor_user_id")
      .eq("user_id", user.id).maybeSingle();
    if (emp?.contractor_user_id) account = emp.contractor_user_id;

    // The target card must live inside that same account. A manager can end a
    // crew member's card; nobody can touch a card outside their account.
    const { data: row } = await admin
      .from("live_activity_tokens")
      .select("token,contractor_user_id")
      .eq("user_id", targetUser).eq("channel", channel)
      .maybeSingle();
    if (!row) return json({ ok: true, sent: 0, note: "no live card" });
    if (String(row.contractor_user_id) !== String(account)) {
      return json({ ok: false, error: "not your account" }, 403);
    }

    const st = (body.state && typeof body.state === "object" ? body.state : {}) as Record<string, unknown>;
    const contentState = liveContentState(st);

    const payload: Record<string, unknown> = {
      aps: {
        timestamp: Math.floor(Date.now() / 1000),
        event,
        "content-state": contentState,
        ...(event === "end" ? { "dismissal-date": Math.floor(Date.now() / 1000) } : {}),
      },
    };

    // Through apnsSend and its other-gateway retry, the same as every other
    // push (see _shared/live-push.ts for what skipping it cost, 2026-09-28).
    const jwt = await apnsJwt();
    const out = await apnsSend(jwt, row.token, JSON.stringify(payload), {
      // Live Activity pushes use their own topic suffix and push type; the
      // plain bundle-id topic silently does nothing.
      "apns-topic": `${APNS_TOPIC}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    });

    if (!out.ok) {
      // A dead activity token means the card is already gone (swiped away, or
      // iOS ended it). Delete the row so the next attempt short-circuits.
      if (out.dead) {
        await admin.from("live_activity_tokens")
          .delete().eq("user_id", targetUser).eq("channel", channel);
        return json({ ok: true, sent: 0, note: "card already gone" });
      }
      return json({ ok: false, error: "apns failed" }, 502);
    }

    // An ended card's token is dead by definition; forget it now.
    if (event === "end") {
      await admin.from("live_activity_tokens")
        .delete().eq("user_id", targetUser).eq("channel", channel);
    }
    return json({ ok: true, sent: 1 });
  } catch (e) {
    console.error(`[update-live-activity] ${String(e).slice(0, 300)}`);
    return json({ ok: false, error: "send failed" }, 500);
  }
});
