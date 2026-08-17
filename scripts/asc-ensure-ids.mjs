// Ensure every bundle id this app ships exists in the Apple Developer portal
// with the capabilities its entitlements need, via the App Store Connect API.
//
// WHY: cloud signing (xcodebuild -allowProvisioningUpdates) can DOWNLOAD
// profiles but this account's runs have twice shown it cannot CREATE portal
// records: the share extension needed its bundle id made by hand (build ~19),
// and build 25/26 died the same way when the Live Activity extension and the
// new push entitlement needed portal entries. The owner is right that a build
// should not require portal clicks, so this step does them through the same
// API key the upload already uses. Idempotent: existing records are left
// alone, and a capability that is already on is not an error.
//
// If the key's role genuinely cannot manage identifiers (Apple requires Admin
// for these endpoints), this fails loudly with the exact manual steps, which
// then really are the floor Apple leaves us.
import crypto from 'node:crypto';

const KEY = process.env.APPSTORE_API_KEY || '';
const KID = process.env.APPSTORE_KEY_ID || '';
const ISS = process.env.APPSTORE_ISSUER_ID || '';
if (!KEY || !KID || !ISS) {
  console.error('::error::APPSTORE_API_KEY / _KEY_ID / _ISSUER_ID missing');
  process.exit(1);
}

// What must exist, and which capabilities each id's entitlements demand.
// Capabilities mirror the entitlements the workflow writes: the app carries
// applesignin + aps-environment + the share App Group; the extensions carry
// only what their own entitlement files use.
const WANT = [
  { id: 'app.tradedesk.beta', name: 'TradeDesk Beta',
    caps: ['PUSH_NOTIFICATIONS', 'APPLE_ID_AUTH', 'APP_GROUPS'] },
  { id: 'app.tradedesk.beta.share', name: 'TradeDesk Beta Share',
    caps: ['APP_GROUPS'] },
  { id: 'app.tradedesk.beta.live', name: 'TradeDesk Beta Live',
    caps: [] },
];

const b64u = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISS, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: KEY, dsaEncoding: 'ieee-p1363' });
const jwt = `${unsigned}.${sig.toString('base64url')}`;

async function api(method, path, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: res.status, json, text };
}

const MANUAL = `::error::The App Store Connect key cannot manage identifiers (needs the Admin role).
Manual fallback (2 minutes, one time): developer.apple.com -> Certificates, Identifiers & Profiles -> Identifiers:
  1. Open app.tradedesk.beta -> enable Push Notifications -> Save
  2. "+" -> App IDs -> App -> explicit id app.tradedesk.beta.live (TradeDesk Live) -> Register
Or: create a new API key with the Admin role and update the APPSTORE_* secrets.`;

let hardFail = false;
for (const want of WANT) {
  // Exact-match lookup: the identifier filter is a prefix match, so a query
  // for the app id also returns its extensions.
  const q = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(want.id)}&include=bundleIdCapabilities&limit=100`);
  if (q.status === 401 || q.status === 403) { console.error(MANUAL); process.exit(1); }
  if (q.status !== 200) { console.error(`::error::bundleIds lookup ${q.status}: ${q.text.slice(0, 300)}`); process.exit(1); }
  let rec = (q.json.data || []).find((d) => d.attributes?.identifier === want.id);

  if (!rec) {
    const c = await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: want.id, name: want.name, platform: 'IOS' } },
    });
    if (c.status === 403) { console.error(MANUAL); process.exit(1); }
    if (c.status !== 201) {
      console.error(`::error::could not register ${want.id}: ${c.status} ${c.text.slice(0, 300)}`);
      hardFail = true; continue;
    }
    rec = c.json.data;
    console.log(`registered ${want.id}`);
  } else {
    console.log(`exists ${want.id}`);
  }

  const have = new Set((q.json.included || [])
    .filter((i) => i.type === 'bundleIdCapabilities')
    .filter((i) => (rec.relationships?.bundleIdCapabilities?.data || []).some((r) => r.id === i.id))
    .map((i) => i.attributes?.capabilityType));
  for (const cap of want.caps) {
    if (have.has(cap)) { console.log(`  ${cap} already on`); continue; }
    const e = await api('POST', '/v1/bundleIdCapabilities', {
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: cap },
        relationships: { bundleId: { data: { type: 'bundleIds', id: rec.id } } },
      },
    });
    // 409 means it is already enabled (the include-matching above is best
    // effort); anything else on a capability is reported but does not kill
    // the build here, the export will say plainly if a profile cannot form.
    if (e.status === 201 || e.status === 409) console.log(`  ${cap} ensured`);
    else console.warn(`::warning::${want.id}: enabling ${cap} returned ${e.status}: ${e.text.slice(0, 200)}`);
  }
}
process.exit(hardFail ? 1 : 0);
