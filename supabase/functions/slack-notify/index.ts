// Supabase Edge Function: slack-notify
// POST { text, blocks? } → forwards to the Slack Incoming Webhook in SLACK_WEBHOOK_URL
// (a Supabase function secret). Keeps the webhook URL server-side — never in client
// code. Everything that wants to push to Slack (DB webhook on error_log, the flow-test
// reporter, the Proxmox heartbeat, Cloudflare-usage poller) calls this one endpoint.
//
// Setup (owner):
//   supabase secrets set SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
//   (then deploy-functions.yml ships it, or: supabase functions deploy slack-notify)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SLACK_WEBHOOK_URL) return json({ ok: false, error: "SLACK_WEBHOOK_URL not configured" });
  try {
    const body = await req.json().catch(() => ({}));
    const text = body && body.text ? String(body.text).slice(0, 3500) : "(no text)";
    const payload: Record<string, unknown> = { text };
    if (body && body.blocks) payload.blocks = body.blocks;
    if (body && body.username) payload.username = body.username;
    if (body && body.channel) payload.channel = body.channel;
    const r = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json({ ok: r.ok, status: r.status });
  } catch (e) {
    return json({ ok: false, error: String((e && (e as Error).message) || e) });
  }
});
