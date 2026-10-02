// Fills in the App Store listing for the store app from docs/app-store/listing.json,
// through the App Store Connect API, with the same key the iOS build uses.
// Run by .github/workflows/asc-listing.yml. Idempotent: every call sets a value,
// so running it twice changes nothing the second time.
//
// What Apple does NOT expose through the API, so this cannot do it and says so:
// creating the app record itself, the App Privacy answers, screenshots, and
// the final "Submit for Review" tap. Those stay on the owner's phone.
//
// Each step stands alone: one Apple refusal (a field renamed, a state that does
// not allow an edit yet) is reported and the rest still run, so a single run
// fills in everything it can and the summary names exactly what is left.
import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY = process.env.APPSTORE_API_KEY || '';
const KID = process.env.APPSTORE_KEY_ID || '';
const ISS = process.env.APPSTORE_ISSUER_ID || '';
if (!KEY || !KID || !ISS) {
  console.error('::error::APPSTORE_API_KEY / _KEY_ID / _ISSUER_ID missing');
  process.exit(1);
}
const L = JSON.parse(fs.readFileSync(new URL('../docs/app-store/listing.json', import.meta.url), 'utf8'));

const b64u = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISS, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }))}`;
const jwt = `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key: KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

async function api(method, path, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, json, text };
}
const why = (r) => {
  const e = r.json && r.json.errors && r.json.errors[0];
  return e ? `${r.status} ${e.title || ''}: ${e.detail || ''}`.slice(0, 300) : `${r.status} ${String(r.text).slice(0, 300)}`;
};

const done = [], left = [];
async function step(name, fn) {
  try {
    const msg = await fn();
    done.push(`${name}${msg ? ': ' + msg : ''}`);
    console.log(`::notice::${name}${msg ? ': ' + msg : ''}`);
  } catch (e) {
    left.push(`${name}: ${e.message}`);
    console.log(`::warning::${name}: ${e.message}`);
  }
}
const must = (r, what) => { if (!r.ok) throw new Error(`${what} ${why(r)}`); return r; };

function summary(appFound) {
  const out = [
    '## App Store listing',
    '',
    appFound ? '' : '**No app record for `' + L.bundleId + '` yet.** Create it in App Store Connect (Apps, "+", New App, bundle ID `' + L.bundleId + '`), then run this again.',
    '',
    '### Filled in',
    ...done.map((d) => '- ' + d),
    '',
    '### Still to do',
    ...left.map((d) => '- ' + d),
    '- App Privacy answers (Apple keeps these out of the API; the kit lists them)',
    '- Screenshots, iPhone 6.9" and iPad 13"',
    '- Demo account login and your name and phone under App Review Information',
    '- Submit for Review',
  ].join('\n');
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
}

// ── The app record ───────────────────────────────────────────────────────────
const appQ = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(L.bundleId)}&limit=5`);
if (appQ.status === 401 || appQ.status === 403) { console.error(`::error::App Store Connect refused the key: ${why(appQ)}`); process.exit(1); }
const app = (appQ.json && appQ.json.data || []).find((a) => a.attributes && a.attributes.bundleId === L.bundleId);
if (!app) { summary(false); process.exit(0); }
const APP = app.id;
console.log(`::notice::app record ${APP} (${app.attributes.name})`);

await step('Content rights (no third-party content)', async () => {
  must(await api('PATCH', `/v1/apps/${APP}`, { data: { type: 'apps', id: APP, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } } }), 'patch app');
});

// ── App Information: categories, subtitle, privacy URL, age rating ───────────
const infos = must(await api('GET', `/v1/apps/${APP}/appInfos`), 'appInfos').json.data;
// The editable one is whichever is not live yet; on a brand-new app there is one.
const info = infos.find((i) => !/READY_FOR_DISTRIBUTION|READY_FOR_SALE/.test(i.attributes.appStoreState || i.attributes.state || '')) || infos[0];

await step(`Categories (${L.primaryCategory}, ${L.secondaryCategory})`, async () => {
  must(await api('PATCH', `/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: {
    primaryCategory: { data: { type: 'appCategories', id: L.primaryCategory } },
    secondaryCategory: { data: { type: 'appCategories', id: L.secondaryCategory } },
  } } }), 'patch appInfo');
});

await step('Subtitle and privacy policy URL', async () => {
  const locs = must(await api('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`), 'appInfoLocalizations').json.data;
  const loc = locs.find((l) => l.attributes.locale === L.locale);
  const attributes = { subtitle: L.subtitle, privacyPolicyUrl: L.privacyPolicyUrl };
  if (loc) must(await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, { data: { type: 'appInfoLocalizations', id: loc.id, attributes } }), 'patch');
  else must(await api('POST', '/v1/appInfoLocalizations', { data: { type: 'appInfoLocalizations', attributes: { locale: L.locale, ...attributes }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } } }), 'create');
});

await step('Age rating (4+, every answer None / No)', async () => {
  const q = must(await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`), 'ageRatingDeclaration').json.data;
  // Answer every question the declaration actually has, so a question Apple adds
  // later is answered too. Frequency questions take NONE, yes/no ones take false.
  const FREQ = /Themes|References|Humor|Nudity|Violence|Realistic|Simulated|Contests|Information|Override|Topics/i;
  const attributes = {};
  for (const k of Object.keys(q.attributes || {})) {
    // Not questions: the kids band and any link field (Apple added an info
    // URL that must be a real link or absent).
    if (k === 'kidsAgeBand' || /url/i.test(k)) continue;
    attributes[k] = FREQ.test(k) && k !== 'gambling' && k !== 'unrestrictedWebAccess' ? 'NONE' : false;
  }
  // Apple keeps adding questions and only names a missing one in the 409. So:
  // send, read the name it asks for, answer it (No first, None if a yes/no
  // value is refused), send again. Bounded, so a question nobody can guess
  // ends in a clear message rather than a loop.
  for (let i = 0; i < 25; i++) {
    const r = await api('PATCH', `/v1/ageRatingDeclarations/${q.id}`, { data: { type: 'ageRatingDeclarations', id: q.id, attributes } });
    if (r.ok) return Object.keys(attributes).length + ' questions answered';
    const msg = why(r);
    const k = (msg.match(/attribute '(\w+)'/) || [])[1];
    if (!k) {
      // "wrong type" without a name: drop the newest guess and try again.
      const last = Object.keys(attributes).pop();
      if (last && /wrong type/i.test(msg)) { delete attributes[last]; continue; }
      throw new Error(msg);
    }
    if (!(k in attributes)) attributes[k] = false;
    else if (attributes[k] === false) attributes[k] = 'NONE';
    else if (attributes[k] === 'NONE') delete attributes[k];
    else throw new Error(msg);
  }
  throw new Error('age rating: Apple kept asking for more after 25 tries');
});

// ── Price and where it is sold ───────────────────────────────────────────────
await step('Price: Free', async () => {
  const pts = must(await api('GET', `/v1/apps/${APP}/appPricePoints?filter[territory]=USA&limit=200`), 'price points').json.data;
  const free = pts.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('no free price point found');
  must(await api('POST', '/v1/appPriceSchedules', {
    data: { type: 'appPriceSchedules', relationships: {
      app: { data: { type: 'apps', id: APP } },
      baseTerritory: { data: { type: 'territories', id: 'USA' } },
      manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] },
    } },
    included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } } }],
  }), 'price schedule');
});

await step(`Availability (${L.territories.join(', ')})`, async () => {
  // Apple wants EVERY territory named, sold or not (a USA-only request is
  // refused for the first one left out), so list them all and mark which sell.
  const all = [];
  let next = '/v1/territories?limit=200';
  while (next) {
    const t = must(await api('GET', next), 'territories').json;
    all.push(...t.data.map((d) => d.id));
    next = t.links && t.links.next ? t.links.next.replace('https://api.appstoreconnect.apple.com', '') : null;
  }
  const sell = new Set(L.territories);
  const ids = all.map((t, i) => ({ t, ref: '${t' + i + '}', on: sell.has(t) }));
  must(await api('POST', '/v2/appAvailabilities', {
    data: { type: 'appAvailabilities', attributes: { availableInNewTerritories: false }, relationships: {
      app: { data: { type: 'apps', id: APP } },
      territoryAvailabilities: { data: ids.map((x) => ({ type: 'territoryAvailabilities', id: x.ref })) },
    } },
    included: ids.map((x) => ({ type: 'territoryAvailabilities', id: x.ref, attributes: { available: x.on }, relationships: { territory: { data: { type: 'territories', id: x.t } } } })),
  }), 'availability');
});

// ── Version 1.0: text, URLs, copyright, release, review notes, build ─────────
const vq = must(await api('GET', `/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&limit=10`), 'versions').json.data;
const ver = vq.find((v) => /PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED|METADATA_REJECTED/.test(v.attributes.appStoreState || v.attributes.appVersionState || ''));
if (!ver) {
  left.push('No editable iOS version found (expected 1.0 in Prepare for Submission)');
} else {
  const V = ver.id;
  await step(`Version ${ver.attributes.versionString}: copyright, manual release`, async () => {
    must(await api('PATCH', `/v1/appStoreVersions/${V}`, { data: { type: 'appStoreVersions', id: V, attributes: { copyright: L.copyright, releaseType: 'MANUAL' } } }), 'patch version');
  });

  await step('Description, keywords, promotional text, support and marketing URLs', async () => {
    const locs = must(await api('GET', `/v1/appStoreVersions/${V}/appStoreVersionLocalizations`), 'version localizations').json.data;
    const loc = locs.find((l) => l.attributes.locale === L.locale);
    const attributes = { description: L.description, keywords: L.keywords, promotionalText: L.promotionalText, supportUrl: L.supportUrl, marketingUrl: L.marketingUrl };
    if (loc) must(await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes } }), 'patch');
    else must(await api('POST', '/v1/appStoreVersionLocalizations', { data: { type: 'appStoreVersionLocalizations', attributes: { locale: L.locale, ...attributes }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: V } } } } }), 'create');
  });

  await step('Review notes and contact email', async () => {
    const attributes = { notes: L.reviewNotes, contactEmail: L.contactEmail, demoAccountRequired: true };
    // Filled from repo secrets when the owner adds them; otherwise typed on the phone.
    const env = process.env;
    if (env.ASC_REVIEW_FIRST) attributes.contactFirstName = env.ASC_REVIEW_FIRST;
    if (env.ASC_REVIEW_LAST) attributes.contactLastName = env.ASC_REVIEW_LAST;
    if (env.ASC_REVIEW_PHONE) attributes.contactPhone = env.ASC_REVIEW_PHONE;
    if (env.ASC_DEMO_USER) attributes.demoAccountName = env.ASC_DEMO_USER;
    if (env.ASC_DEMO_PASS) attributes.demoAccountPassword = env.ASC_DEMO_PASS;
    const cur = await api('GET', `/v1/appStoreVersions/${V}/appStoreReviewDetail`);
    const id = cur.ok && cur.json && cur.json.data && cur.json.data.id;
    if (id) must(await api('PATCH', `/v1/appStoreReviewDetails/${id}`, { data: { type: 'appStoreReviewDetails', id, attributes } }), 'patch');
    else must(await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: V } } } } }), 'create');
    return env.ASC_DEMO_USER ? 'demo login included' : 'demo login not set, type it on the page';
  });

  await step('Attach the newest processed build', async () => {
    const b = must(await api('GET', `/v1/builds?filter[app]=${APP}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`), 'builds').json.data[0];
    if (!b) throw new Error('no processed build yet (fire the store build, wait for Apple to finish processing, run this again)');
    must(await api('PATCH', `/v1/appStoreVersions/${V}/relationships/build`, { data: { type: 'builds', id: b.id } }), 'attach');
    return `build ${b.attributes.version}`;
  });
}

summary(true);
