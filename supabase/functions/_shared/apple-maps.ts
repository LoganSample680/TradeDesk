// ── APPLE MAPS, SERVER SIDE (owner 2026-09-14) ─────────────────────────────
//
// "how can I get server side to accept mapkit?"
//
// MapKit JS cannot run here: it is a browser library and it wants a window.
// The Apple Maps Server API is its server-side counterpart, same developer
// account, same key, and it answers with BOTH the distance and the geometry,
// as raw coordinates rather than an encoded polyline. So the server can now
// produce the miles AND the line the phone used to be the only source of.
//
// THE 401 THAT SENT ME LOOKING. The app already ships a MapKit token and it
// was refused here with PERMISSIONS_CHECK_FAILURE, which reads like a missing
// capability and is not one. That token carries scope "mapkit_js"; this API
// wants scope "server_api". Same key, different claim. Apple also states the
// server scope is the one framework that may NOT use a static token, which is
// why this signs one per process instead of shipping a long-lived string.
//
// Three secrets, set by the owner in the Supabase dashboard so the private key
// never passes through a chat log or a commit:
//   APPLE_MAPS_KEY      the whole .p8, BEGIN and END lines included
//   APPLE_MAPS_KEY_ID   the 10-character key id
//   APPLE_MAPS_TEAM_ID  the 10-character team id
//
// QUOTA IS THE REAL CONSTRAINT, not latency. Apple gives 25,000 service calls
// a day PER TEAM and MapKit JS on the phones draws from the same bucket, so
// server-first-phone-second doubles consumption on every leg. Nothing in here
// should be called without going through the geo_route_miles cache first.

const TOKEN_URL = "https://maps-api.apple.com/v1/token";
const DIRECTIONS_URL = "https://maps-api.apple.com/v1/directions";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string { return b64url(new TextEncoder().encode(s)); }

// A .p8 is PKCS#8 PEM. Strip the armour, decode, import as P-256.
function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// WebCrypto's ECDSA signature is already the raw r||s pair JWS ES256 wants, so
// there is no DER unwrapping here and there should not be: a DER-to-raw step
// bolted onto this is a sign someone reached for a Node example.
async function signJwt(keyPem: string, kid: string, teamId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(keyPem).buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid, typ: "JWT" };
  // No origin claim. Apple requires one only for mapkit_js, web_snapshots and
  // embed_api; a server has no origin, and sending one here is how a token
  // that looks correct gets refused.
  const payload = { iss: teamId, iat: now, exp: now + 30 * 60, scope: "server_api" };
  const signing = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signing),
  );
  return signing + "." + b64url(new Uint8Array(sig));
}

// One access token per process, reused until it is nearly expired. Apple hands
// back roughly half an hour; the exchange itself is a service call and paying
// for one per request would spend the daily quota on authentication.
let _tok: { v: string; exp: number } | null = null;

export function appleMapsConfigured(): boolean {
  return !!(Deno.env.get("APPLE_MAPS_KEY") && Deno.env.get("APPLE_MAPS_KEY_ID") && Deno.env.get("APPLE_MAPS_TEAM_ID"));
}

export async function appleMapsToken(): Promise<string | null> {
  const now = Date.now();
  if (_tok && _tok.exp - 60000 > now) return _tok.v;
  const keyPem = Deno.env.get("APPLE_MAPS_KEY");
  const kid = Deno.env.get("APPLE_MAPS_KEY_ID");
  const team = Deno.env.get("APPLE_MAPS_TEAM_ID");
  if (!keyPem || !kid || !team) return null;
  try {
    const jwt = await signJwt(keyPem, kid, team);
    const r = await fetch(TOKEN_URL, { headers: { Authorization: "Bearer " + jwt } });
    if (!r.ok) { console.error("apple-maps token " + r.status + " " + (await r.text()).slice(0, 200)); return null; }
    const j = await r.json();
    const v = j?.accessToken;
    if (!v) return null;
    const ttl = Number(j?.expiresInSeconds) > 0 ? Number(j.expiresInSeconds) * 1000 : 25 * 60000;
    _tok = { v, exp: now + ttl };
    return v;
  } catch (e) { console.error("apple-maps token: " + (e as Error).message); return null; }
}

export type Pt = { lat: number; lng: number };
export type Route = { miles: number; mins: number; path: number[][] };

// The response shape is three parallel lists and it is not obvious: a route
// carries stepIndexes into `steps`, each step carries a stepPathIndex into
// `stepPaths`, and each stepPath is an array of {latitude,longitude}. Walking
// that chain in order is what produces the drawn line; reading stepPaths
// straight through would concatenate every ALTERNATE route as well, which is
// how a three-mile drive becomes a scribble over the whole city.
function routeOf(j: unknown): Route | null {
  const d = j as {
    routes?: { distanceMeters?: number; durationSeconds?: number; stepIndexes?: number[] }[];
    steps?: { stepPathIndex?: number }[];
    stepPaths?: { latitude: number; longitude: number }[][];
  };
  const r = d?.routes?.[0];
  if (!r) return null;
  const miles = Number(r.distanceMeters) > 0 ? Math.round(Number(r.distanceMeters) / 1609.344 * 10) / 10 : 0;
  const mins = Number(r.durationSeconds) > 0 ? Math.round(Number(r.durationSeconds) / 60) : 0;
  const path: number[][] = [];
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const paths = Array.isArray(d.stepPaths) ? d.stepPaths : [];
  for (const si of (Array.isArray(r.stepIndexes) ? r.stepIndexes : [])) {
    const sp = steps[si]?.stepPathIndex;
    if (typeof sp !== "number") continue;
    for (const c of (paths[sp] || [])) {
      if (c && isFinite(c.latitude) && isFinite(c.longitude)) path.push([c.latitude, c.longitude]);
    }
  }
  return { miles, mins, path };
}

// One road. Returns null on anything at all going wrong, because a missing
// road must leave the row exactly as it was: the caller's existing number is
// always more honest than a zero from here.
export async function appleRoute(from: Pt, to: Pt, timeoutMs = 8000): Promise<Route | null> {
  if (!from || !to || !isFinite(from.lat) || !isFinite(to.lat)) return null;
  const tok = await appleMapsToken();
  if (!tok) return null;
  const u = new URL(DIRECTIONS_URL);
  u.searchParams.set("origin", from.lat + "," + from.lng);
  u.searchParams.set("destination", to.lat + "," + to.lng);
  u.searchParams.set("transportType", "Automobile");
  try {
    const r = await fetch(u, {
      headers: { Authorization: "Bearer " + tok },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 429 is the daily quota, shared with every phone on the team. Say it out
    // loud: it is the one failure here that is a capacity decision and not a
    // bug, and it will otherwise look like the router quietly getting worse.
    if (r.status === 429) { console.error("apple-maps 429: daily quota exhausted (25k/team, shared with MapKit JS)"); return null; }
    if (!r.ok) { console.error("apple-maps directions " + r.status); return null; }
    return routeOf(await r.json());
  } catch (e) { console.error("apple-maps directions: " + (e as Error).message); return null; }
}
