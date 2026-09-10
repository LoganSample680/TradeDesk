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

// ENABLING A CAPABILITY IS NOT ASSIGNING THE GROUP TO IT, and that gap is the
// whole reason the share extension failed to export three times (builds ~19,
// 2026-08-17, and 37 on 2026-08-26), every one of them "Authentication failed
// / No profiles for 'app.tradedesk.beta.share' were found".
//
// In the portal these are two clicks: tick App Groups, then Edit and tick the
// group itself. Over the API they are two calls. This script only ever made
// the first one. The extension's entitlements ask for a SPECIFIC group
// (group.app.tradedesk.beta, ShareExt.entitlements), and a profile cannot form
// for a capability that has no group attached, so signing failed with a
// message that named the profile and never the reason.
//
// That also explains why the two manual attempts did not fix it: registering
// the App Group (attempt 2) and creating the App ID (attempt 3) are both real,
// and neither one LINKS them.
const APP_GROUP = 'group.app.tradedesk.beta';

// What must exist, and which capabilities each id's entitlements demand.
// Capabilities mirror the entitlements the workflow writes: the app carries
// applesignin + aps-environment + the share App Group; the extensions carry
// only what their own entitlement files use.
const WANT = [
  { id: 'app.tradedesk.beta', name: 'TradeDesk Beta',
    caps: ['PUSH_NOTIFICATIONS', 'APPLE_ID_AUTH', 'APP_GROUPS', 'ASSOCIATED_DOMAINS'],
    groups: [APP_GROUP] },
  { id: 'app.tradedesk.beta.share', name: 'TradeDesk Beta Share',
    caps: ['APP_GROUPS'], groups: [APP_GROUP] },
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
    console.log(`::notice::asc: registered ${want.id}`);
  } else {
    console.log(`::notice::asc: exists ${want.id}`);
  }

  const have = new Set((q.json.included || [])
    .filter((i) => i.type === 'bundleIdCapabilities')
    .filter((i) => (rec.relationships?.bundleIdCapabilities?.data || []).some((r) => r.id === i.id))
    .map((i) => i.attributes?.capabilityType));
  for (const cap of want.caps) {
    if (have.has(cap)) { console.log(`::notice::asc: ${want.id} ${cap} already on`); continue; }
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
    if (e.status === 201 || e.status === 409) console.log(`::notice::asc: ${want.id} ${cap} ensured (${e.status})`);
    else console.warn(`::warning::${want.id}: enabling ${cap} returned ${e.status}: ${e.text.slice(0, 200)}`);
  }

  // ── THE GROUP, NOT JUST THE CAPABILITY ────────────────────────────────────
  // Read back what is ACTUALLY attached and say so out loud. This is the part
  // that has never been checked, and a build is expensive enough that finding
  // out here beats finding out after a 12-minute archive.
  if (want.groups && want.groups.length) {
    const gq = await api('GET', `/v1/appGroups?filter[identifier]=${encodeURIComponent(APP_GROUP)}&limit=10`);
    const grp = gq.status === 200
      ? (gq.json.data || []).find((g) => g.attributes?.identifier === APP_GROUP)
      : null;
    if (!grp) {
      // NOT proof of anything, and this must never fail the build.
      //
      // Build 46 did exactly that: it read a 404 from /v1/appGroups and
      // reported "the App Group does not exist on this team", and the owner
      // had the group on screen in the portal while it said so. App Groups are
      // not exposed through the App Store Connect API the way bundleIds and
      // bundleIdCapabilities are, so the 404 is the ENDPOINT answering, not the
      // resource. A check that cannot see the thing it is checking has no
      // business blocking a build over it.
      //
      // So: say what we could not determine, and let SIGNING be the arbiter,
      // which is the one test that actually knows. If the group is genuinely
      // missing or unattached, the export fails with "No profiles for
      // app.tradedesk.beta.share" and the verdict step already routes that to
      // the share extension.
      console.log(`::notice::asc: cannot verify ${APP_GROUP} through the API (appGroups lookup ${gq.status}); App Groups are not exposed there. Signing will be the test.`);
      console.log(`::notice::asc: if the export later fails on profiles, check by hand: Identifiers -> App Groups -> ${APP_GROUP} exists, and ${want.id} -> App Groups -> Edit has it ticked.`);
    } else {
      // Which capability record is the APP_GROUPS one for THIS bundle id, and
      // what groups hang off it.
      const capQ = await api('GET', `/v1/bundleIds/${rec.id}/bundleIdCapabilities?limit=50`);
      const capRec = capQ.status === 200
        ? (capQ.json.data || []).find((c) => c.attributes?.capabilityType === 'APP_GROUPS')
        : null;
      let attached = [];
      if (capRec) {
        const rel = await api('GET', `/v1/bundleIdCapabilities/${capRec.id}/appGroups?limit=50`);
        if (rel.status === 200) attached = (rel.json.data || []).map((g) => g.attributes?.identifier).filter(Boolean);
      }
      if (attached.includes(APP_GROUP)) {
        console.log(`::notice::asc: ${want.id} APP_GROUPS -> ${APP_GROUP} attached`);
      } else {
        // Best effort to attach it. Apple's write shape for this relationship
        // is thinly documented and has changed, so a failure here is REPORTED
        // with the two manual clicks rather than swallowed or guessed past.
        const patch = capRec
          ? await api('PATCH', `/v1/bundleIdCapabilities/${capRec.id}`, {
              data: {
                type: 'bundleIdCapabilities', id: capRec.id,
                attributes: { capabilityType: 'APP_GROUPS' },
                relationships: { appGroups: { data: [{ type: 'appGroups', id: grp.id }] } },
              },
            })
          : { status: 0, text: 'no APP_GROUPS capability record to patch' };
        const ok = patch.status === 200 || patch.status === 201 || patch.status === 204;
        if (ok) {
          console.log(`::notice::asc: ${want.id} APP_GROUPS -> ${APP_GROUP} attached now (${patch.status})`);
        } else {
          // Warning, not an error, for the same reason as above: this write
          // shape is thinly documented and a rejection here does not prove the
          // portal is wrong. Signing decides.
          console.warn(`::warning::asc: could not attach ${APP_GROUP} to ${want.id} over the API (${patch.status}): ${String(patch.text).slice(0, 200)}`);
          console.warn(`::warning::If the export fails on profiles, do it by hand: Identifiers -> ${want.id} -> App Groups -> Edit -> tick ${APP_GROUP} -> Save. Ticking the capability alone is not enough.`);
        }
      }
    }
  }
}
if (hardFail) {
  console.error('::error::Portal preflight failed. NOTHING was archived, so this cost seconds, not a build.');
}
process.exit(hardFail ? 1 : 0);
