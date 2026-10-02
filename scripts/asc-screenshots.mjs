// Uploads App Store screenshots straight to App Store Connect from
// docs/app-store/screenshots/<slot>/*.png, so the exact pixels Apple asks for
// arrive as made. (Uploading from a phone's browser resized them on the way
// and Apple refused the size, 2026-10-01.) Replaces whatever the slot held.
// Run by .github/workflows/asc-screenshots.yml with the build's API key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.APPSTORE_API_KEY || '';
const KID = process.env.APPSTORE_KEY_ID || '';
const ISS = process.env.APPSTORE_ISSUER_ID || '';
if (!KEY || !KID || !ISS) { console.error('::error::APPSTORE_API_KEY / _KEY_ID / _ISSUER_ID missing'); process.exit(1); }

const BUNDLE = 'app.tradedesk';
const LOCALE = 'en-US';
// Folder name -> App Store Connect display type.
const SLOTS = { 'ipad-13': 'APP_IPAD_PRO_3GEN_129', 'iphone-69': 'APP_IPHONE_67' };
const ROOT = new URL('../docs/app-store/screenshots/', import.meta.url).pathname;

const b64u = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISS, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }))}`;
const jwt = `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key: KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

async function api(method, p, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + p, {
    method, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* raw */ }
  if (res.status >= 300) throw new Error(`${method} ${p} ${res.status} ${text.slice(0, 300)}`);
  return json;
}

const app = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE}`)).data.find((a) => a.attributes.bundleId === BUNDLE);
if (!app) { console.error(`::error::no app record for ${BUNDLE}`); process.exit(1); }
const ver = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data
  .find((v) => /PREPARE_FOR_SUBMISSION|REJECTED/.test(v.attributes.appVersionState || v.attributes.appStoreState || ''));
if (!ver) { console.error('::error::no editable iOS version'); process.exit(1); }
const loc = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data
  .find((l) => l.attributes.locale === LOCALE);
if (!loc) { console.error(`::error::no ${LOCALE} localization`); process.exit(1); }
const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;

let failed = false;
for (const [dir, type] of Object.entries(SLOTS)) {
  const folder = path.join(ROOT, dir);
  if (!fs.existsSync(folder)) continue;
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) continue;
  try {
    let set = sets.find((s) => s.attributes.screenshotDisplayType === type);
    if (!set) {
      set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } })).data;
    }
    // Replace, not add: clear what the slot held first.
    for (const old of (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data) {
      await api('DELETE', `/v1/appScreenshots/${old.id}`);
    }
    for (const f of files) {
      const buf = fs.readFileSync(path.join(folder, f));
      const shot = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data;
      for (const op of shot.attributes.uploadOperations) {
        const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
        const r = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
        if (r.status >= 300) throw new Error(`upload part ${r.status}`);
      }
      await api('PATCH', `/v1/appScreenshots/${shot.id}`, { data: { type: 'appScreenshots', id: shot.id,
        attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') } } });
      console.log(`::notice::${type}: uploaded ${f}`);
    }
  } catch (e) {
    failed = true;
    console.log(`::error::${type}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
