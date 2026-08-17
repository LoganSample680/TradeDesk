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
export const APNS_HOST = (Deno.env.get("APNS_ENV") || "sandbox") === "production"
  ? "https://api.push.apple.com"
  : "https://api.sandbox.push.apple.com";

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
