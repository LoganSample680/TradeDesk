// Supabase Edge Function: send-push
//
// Sends an Apple push to every live device on one account. This is the half
// td-notify cannot do: local notifications only ever announce what the phone
// already knew, so anything that happens server-side (a client signed, a
// payment landed, a crew member was dispatched) had no way to reach the phone.
//
// AUTH: the caller's JWT is verified and the push is scoped to the account
// they belong to. A contractor can notify their own devices and their crew's;
// nobody can address a stranger's phone, because the recipient list is derived
// from the token, never taken from the request body.
//
// APNs auth is a JWT signed with the team's .p8 key (ES256), NOT a
// certificate: certificates expire annually and take the whole notification
// system down with them at 2am. A key-based token is good until it is revoked
// and Apple allows reusing it for an hour, which is what the cache below does.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Set these three as function secrets from the Apple Developer account.
const APNS_KEY = (Deno.env.get("APNS_KEY") || "").replace(/\\n/g, "\n"); // .p8 contents
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || "";
const APNS_TOPIC = Deno.env.get("APNS_TOPIC") || "app.tradedesk.beta";
// TestFlight builds are served by the SANDBOX gateway; the App Store build is
// production. Sending to the wrong one returns BadDeviceToken for every device,
// which looks exactly like a broken token list, so it is a setting, not a guess.
const APNS_HOST = (Deno.env.get("APNS_ENV") || "sandbox") === "production"
  ? "https://api.push.apple.com"
  : "https://api.sandbox.push.apple.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

// Apple permits reusing a provider token for up to an hour and REJECTS clients
// that mint one per request (TooManyProviderTokenUpdates). Cached per instance.
let _tok = { jwt: "", at: 0 };

async function apnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tok.jwt && now - _tok.at < 2400) return _tok.jwt; // refresh at 40 min
  const pem = APNS_KEY.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const head = b64urlStr(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
  const body = b64urlStr(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`),
  );
  _tok = { jwt: `${head}.${body}.${b64url(new Uint8Array(sig))}`, at: now };
  return _tok.jwt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) {
      // Explicit, not silent: an unconfigured function that returns ok would
      // make every missing notification look like a device problem.
      return json({ ok: false, error: "APNs not configured" }, 503);
    }

    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ ok: false, error: "no auth" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ ok: false, error: "invalid auth" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const title = String(body.title || "").slice(0, 120);
    const message = String(body.body || "").slice(0, 300);
    if (!title && !message) return json({ ok: false, error: "empty notification" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // WHOSE devices. The account is derived from the caller, never trusted from
    // the body, or anyone with a login could push to anyone else's phone. An
    // employee's team_members row names the account they belong to; an owner
    // simply is the account.
    let account = user.id;
    const { data: emp } = await admin
      .from("team_members").select("contractor_user_id")
      .eq("user_id", user.id).maybeSingle();
    if (emp?.contractor_user_id) account = emp.contractor_user_id;

    // Optionally narrow to specific people inside that account (dispatching one
    // crew member). Still constrained to the account resolved above.
    let q = admin.from("device_tokens").select("token,user_id")
      .eq("contractor_user_id", account).is("invalid_at", null);
    if (Array.isArray(body.to) && body.to.length) q = q.in("user_id", body.to.map(String).slice(0, 50));
    const { data: rows, error: qerr } = await q;
    if (qerr) return json({ ok: false, error: qerr.message }, 500);
    if (!rows?.length) return json({ ok: true, sent: 0, note: "no registered devices" });

    const jwt = await apnsJwt();
    const payload = JSON.stringify({
      aps: {
        alert: { title, body: message },
        sound: "default",
        ...(body.badge != null ? { badge: Number(body.badge) } : {}),
      },
      // The routing the app reads on tap (js/push.js _pushRoute). Kept OUTSIDE
      // `aps` because Apple owns that namespace.
      route: body.route ? String(body.route) : "",
      id: body.id ?? null,
      client_id: body.client_id ?? null,
    });

    const dead: string[] = [];
    let sent = 0;
    // Deno's fetch speaks HTTP/2, which APNs requires. Sent in parallel: a
    // crew of ten should not wait on ten sequential round trips.
    await Promise.all(rows.map(async (r) => {
      try {
        const res = await fetch(`${APNS_HOST}/3/device/${r.token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": APNS_TOPIC,
            "apns-push-type": "alert",
            "apns-priority": "10",
          },
          body: payload,
        });
        if (res.ok) { sent++; return; }
        const txt = await res.text();
        // 410 Gone, or 400 BadDeviceToken: the app was deleted from that phone.
        // Marked so every future send skips it instead of paying for it forever.
        if (res.status === 410 || /BadDeviceToken|Unregistered/i.test(txt)) dead.push(r.token);
        else console.error(`[send-push] ${res.status} ${txt.slice(0, 200)}`);
      } catch (e) {
        console.error(`[send-push] ${String(e).slice(0, 200)}`);
      }
    }));

    if (dead.length) {
      await admin.from("device_tokens")
        .update({ invalid_at: new Date().toISOString() }).in("token", dead);
    }
    return json({ ok: true, sent, pruned: dead.length });
  } catch (e) {
    console.error(`[send-push] ${String(e).slice(0, 300)}`);
    return json({ ok: false, error: "send failed" }, 500);
  }
});
