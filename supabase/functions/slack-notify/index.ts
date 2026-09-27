// Supabase Edge Function: slack-notify
// POST { text, blocks? } → forwards to the Slack Incoming Webhook in SLACK_WEBHOOK_URL
// (a Supabase function secret). Keeps the webhook URL server-side — never in client
// code. Everything that wants to push to Slack (DB webhook on error_log, the flow-test
// reporter, the Proxmox heartbeat, Cloudflare-usage poller) calls this one endpoint.
//
// Setup (owner):
//   supabase secrets set SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
//   (then deploy-functions.yml ships it, or: supabase functions deploy slack-notify)
//
// WHO MAY CALL IT (20261049, H1). It used to forward any text to any channel
// for any caller holding any JWT, which made the company Slack writable by
// every signed-up account and every page with the public anon key. A caller
// must now send the shared secret in the x-slack-notify-secret header (the
// SLACK_NOTIFY_SECRET function secret; the error_log DB webhook, the flow-test
// reporter and the Proxmox heartbeat set it) or authenticate as the service
// role. Anything else is a 401 and nothing reaches Slack. With neither secret
// configured it refuses everyone: it fails closed, never open.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleKey } from "../_shared/keys.ts";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";
const SLACK_NOTIFY_SECRET = Deno.env.get("SLACK_NOTIFY_SECRET") || "";

// Constant-time compare so the secret cannot be guessed byte by byte.
function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function authorized(req: Request): boolean {
  const secret = req.headers.get("x-slack-notify-secret") || "";
  if (SLACK_NOTIFY_SECRET && same(secret, SLACK_NOTIFY_SECRET)) return true;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const svc = getServiceRoleKey();
  return !!svc && same(bearer, svc);
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-slack-notify-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
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
