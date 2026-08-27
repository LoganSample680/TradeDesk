// Shared APNs plumbing for every function that talks to Apple's push service
// (send-push for device alerts, update-live-activity for lock-screen cards).
//
// Auth is a JWT signed with the team's .p8 key (ES256), NOT a certificate:
// certificates expire annually and take the whole notification system down
// with them at 2am. Apple permits reusing a provider token for up to an hour
// and REJECTS clients that mint one per request (TooManyProviderTokenUpdates),
// hence the per-instance cache.
//
// Function secrets (set once from the Apple Developer account):
//   APNS_KEY      the .p8 file's contents
//   APNS_KEY_ID   the key's id
//   APNS_TEAM_ID  the developer team id
//   APNS_TOPIC    bundle id (defaults to the TestFlight shell's)
//   APNS_ENV      'sandbox' (TestFlight, the default) or 'production'

export const APNS_KEY = (Deno.env.get("APNS_KEY") || "").replace(/\\n/g, "\n");
export const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";
export const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || "";
export const APNS_TOPIC = Deno.env.get("APNS_TOPIC") || "app.tradedesk.beta";
// TestFlight builds are served by the SANDBOX gateway; the App Store build is
// production. Sending to the wrong one returns BadDeviceToken for every
// device, which looks exactly like a broken token list, so it is a setting,
// not a guess. Flip together with the aps-environment entitlement.
export const APNS_PROD_HOST = "https://api.push.apple.com";
export const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
export const APNS_HOST = (Deno.env.get("APNS_ENV") || "sandbox") === "production"
  ? APNS_PROD_HOST
  : APNS_SANDBOX_HOST;

// A token minted by a TestFlight build is a SANDBOX token; the same app from
// the App Store mints a PRODUCTION one. Sending to the wrong gateway returns
// BadDeviceToken, which looks exactly like an uninstalled app, so a single
// static APNS_ENV silently drops every push for half the fleet during any
// rollout where both builds are in the wild (owner 2026-08-27: "when we go to
// production will it automatically handle itself?"). It would not have.
//
// So the environment stops being a global setting and becomes a per-token
// fact: send to the configured host, and on a BadDeviceToken retry the other
// one before writing the token off. Costs one extra request only for tokens
// on the other side, and means the App Store cutover needs no secret flip and
// no 2am outage.
export const APNS_OTHER_HOST = APNS_HOST === APNS_PROD_HOST ? APNS_SANDBOX_HOST : APNS_PROD_HOST;
const badToken = (status: number, txt: string) =>
  status === 400 && /BadDeviceToken/i.test(txt);

export type ApnsSend = { ok: boolean; dead: boolean };

// One push to one token, with the environment fallback. `headers` carries the
// per-call apns-push-type / priority / expiration; the topic and auth are
// added here so no caller can get them wrong.
export async function apnsSend(
  jwt: string,
  token: string,
  payload: string,
  headers: Record<string, string>,
): Promise<ApnsSend> {
  const hit = async (host: string) => {
    const res = await fetch(`${host}/3/device/${token}`, {
      method: "POST",
      headers: { authorization: `bearer ${jwt}`, "apns-topic": APNS_TOPIC, ...headers },
      body: payload,
    });
    return { status: res.status, txt: res.ok ? "" : await res.text() };
  };
  let r = await hit(APNS_HOST);
  if (r.status === 200) return { ok: true, dead: false };
  // Wrong gateway for this token: try the other before condemning it.
  if (badToken(r.status, r.txt)) {
    const alt = await hit(APNS_OTHER_HOST);
    if (alt.status === 200) return { ok: true, dead: false };
    r = alt;
  }
  // 410 Gone, or BadDeviceToken from BOTH gateways: the app is really gone.
  if (r.status === 410 || badToken(r.status, r.txt) || /Unregistered/i.test(r.txt)) {
    return { ok: false, dead: true };
  }
  console.error(`[apns] ${r.status} ${r.txt.slice(0, 200)}`);
  return { ok: false, dead: false };
}

export const apnsConfigured = () => !!(APNS_KEY && APNS_KEY_ID && APNS_TEAM_ID);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

let _tok = { jwt: "", at: 0 };

export async function apnsJwt(): Promise<string> {
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
