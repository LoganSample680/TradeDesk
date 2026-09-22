#!/usr/bin/env node
// ── LOAD ONE COUNTY'S PUBLIC ASSESSOR RECORD INTO SUPABASE ──────────────────
//
// Replaces scripts/property-proxy.js, which scraped Zillow for numbers that
// started life in a county assessor's office. Zillow serves 403 to it now, and
// no header spoofing beats behavioral fingerprinting, so we go to the source
// Zillow itself buys from. This is the same thing Zillow's "County Direct"
// program does, scoped to the counties our contractors actually work in.
//
// USAGE
//   node scripts/county-load.js ks-shawnee              # bulk load the county
//   node scripts/county-load.js ks-shawnee --dry-run    # fetch + parse, write nothing
//   node scripts/county-load.js ks-shawnee --limit 500  # first N parcels only
//   node scripts/county-load.js ks-shawnee --enrich 200 # also fill year built for N
//
// Config lives in scripts/counties/<name>.json. Adding a county is a config
// file, not a code change, which is the entire point of the shape.
//
// POLITENESS IS A CORRECTNESS REQUIREMENT HERE, not a nicety. These are small
// county servers with no rate limiting and no commercial interest in us. A
// county IT admin who sees an anonymous client hammering the appraiser search
// blocks the range and never tells anybody, and we would not find out until a
// contractor's property card went blank. So: a real User-Agent naming TradeDesk
// with a contact, a page size well under the server's max, and a deliberate
// pause between every request.

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const ARGS       = process.argv.slice(2);
const COUNTY     = ARGS.find(a => !a.startsWith('-'));
const DRY_RUN    = ARGS.includes('--dry-run');
// Dump the first few mapped rows and stop. This is the first thing to run when
// onboarding a new county: it proves the field map before anything is written,
// and a wrong field map is the failure mode that actually happens (a county
// names its year column BUILT_YR, YRBLT, or ACTUALYEARBUILT, and a typo shows
// up as a column of nulls rather than as an error).
const PRINT      = ARGS.includes('--print');
const LIMIT      = intArg('--limit', 0);
const ENRICH     = intArg('--enrich', 0);
// Deliberate floor for the BULK layer (a county's ArcGIS endpoint, 16 paged
// requests for the whole county). 250ms is fine there: that API is built to be
// read in bulk and nobody mistakes 16 requests for an attack.
const PAUSE_MS   = intArg('--pause', 250);
// The circuit breaker, shared with the live API route through td_county_asks so
// both paths draw on ONE budget. Not a throttle for normal use (an address is
// asked once ever); this is what caps the damage when something loops.
const DAILY_CAP  = intArg('--daily-cap', parseInt(process.env.COUNTY_DAILY_CAP || '1000', 10));

// ── HUMAN PACING, for the per-address enrichment ────────────────────────────
//
// Owner, 2026-09-22: "I want every single one to load itself in, not all at once
// but a slow human style lookup so we don't get our shit blocked."
//
// He is right and the fixed --pause was wrong for this layer. 77,006 addresses
// at a flat 250ms is 5.3 hours of perfectly metronomic requests, four a second,
// and A METRONOME IS THE GIVEAWAY. What gets a range blocked is not the total,
// it is the rate and the regularity: no person has ever produced a request
// exactly every 250ms for five hours, and any log review spots that instantly.
//
// So the drip does what a title clerk's afternoon looks like. Most lookups a few
// tens of seconds apart, an occasional few-minute gap where they went and did
// something else, nothing at all overnight, and never two requests on the same
// interval twice in a row. At ~52s average across a 14-hour day that is roughly
// a thousand addresses a day, so a whole county lands in about eleven weeks
// without a single hour that looks unusual from the other side.
const HUMAN      = ARGS.includes('--human');
// A run stops after this long whatever is left, so the drip is made of many
// short visits rather than one endless session. Another giveaway removed: a
// client that is connected every minute of every day is not a person.
const MAX_MIN    = intArg('--max-minutes', 0);
// Local hours the drip is willing to work. Nobody looks up parcels at 4am, and
// traffic that only ever arrives in office hours reads as office traffic.
const HOUR_START = intArg('--start-hour', 7);
const HOUR_END   = intArg('--end-hour', 21);

// One gap. 90% of the time a normal few-tens-of-seconds pause; 10% of the time
// the clerk got up. Every value is drawn fresh, so no two gaps match and the
// sequence has no period to detect.
function humanGapMs() {
  return Math.random() < 0.10
    ? Math.round(90000 + Math.random() * 210000)   // 1.5 to 5 minutes
    : Math.round(12000 + Math.random() * 48000);   // 12 to 60 seconds
}

function withinWorkingHours(d = new Date()) {
  const h = d.getHours();
  return HOUR_START <= HOUR_END
    ? (h >= HOUR_START && h < HOUR_END)
    : (h >= HOUR_START || h < HOUR_END);   // a window that wraps midnight
}

function intArg(flag, dflt) {
  const i = ARGS.indexOf(flag);
  if (i === -1 || !ARGS[i + 1]) return dflt;
  const n = parseInt(ARGS[i + 1], 10);
  return Number.isFinite(n) ? n : dflt;
}

if (!COUNTY) {
  console.error('usage: node scripts/county-load.js <county-config> [--dry-run] [--limit N] [--enrich N]');
  console.error('available:', fs.readdirSync(path.join(__dirname, 'counties')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).join(', '));
  process.exit(1);
}

const CFG_PATH = path.join(__dirname, 'counties', `${COUNTY}.json`);
if (!fs.existsSync(CFG_PATH)) { console.error(`ERROR: no config at ${CFG_PATH}`); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

// Identify ourselves. A county admin looking at a log should be able to tell who
// this is and who to email, rather than seeing an anonymous client and blocking.
const UA = 'TradeDeskCRM/1.0 (county assessor public record loader; +https://tradedesk-cyp.pages.dev)';

// Same Supabase credential resolution as scripts/update-tax-rates.js, so CI
// secrets already set for that workflow work here unchanged (§7.3).
const SUPABASE_URL = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_PROJECT_REF  = process.env.SUPABASE_PROJECT_REF;
let   SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ── HTTP ────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(url, { headers = {}, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json', ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpJson(new URL(res.headers.location, url).toString(), { headers, timeout }));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url.slice(0, 120)}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`bad JSON from ${url.slice(0, 120)}: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Retry only what is worth retrying. A 404 means the layer moved and retrying it
// five times just means being wrong five times at somebody else's expense.
async function httpJsonRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await httpJson(url, opts); }
    catch (e) {
      last = e;
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e;
      if (i < tries - 1) await sleep(1000 * Math.pow(2, i));
    }
  }
  throw last;
}

// ── Supabase ────────────────────────────────────────────────────────────────
async function resolveServiceKey() {
  if (SUPABASE_SERVICE_KEY) return;
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) {
    console.error('ERROR: set SUPABASE_SERVICE_KEY, or both SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN');
    process.exit(1);
  }
  const keys = await httpJson(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys`,
    { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } });
  const svc = keys.find(k => k.name === 'service_role');
  if (!svc) { console.error('ERROR: service_role key not in Management API response'); process.exit(1); }
  SUPABASE_SERVICE_KEY = svc.api_key;
}

function supaReq(method, apiPath, body, extraHeaders = {}) {
  return new Promise((resolve) => {
    const bodyStr = body == null ? null : JSON.stringify(body);
    const host = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const req = https.request({
      hostname: host, path: apiPath, method,
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...extraHeaders,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(
        res.statusCode >= 200 && res.statusCode < 300
          ? { error: null, data }
          : { error: { message: `HTTP ${res.statusCode}: ${data.slice(0, 300)}` }, data }
      ));
    });
    req.on('error', e => resolve({ error: { message: e.message } }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// DNS wobble on the runner is not a data error; everything else is.
async function supaRetry(method, apiPath, body, extraHeaders) {
  const delays = [2000, 4000, 8000, 16000];
  let r;
  for (let i = 0; i <= delays.length; i++) {
    r = await supaReq(method, apiPath, body, extraHeaders);
    if (!r.error || !/EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(r.error.message)) return r;
    if (i < delays.length) await sleep(delays[i]);
  }
  return r;
}

// ── Source adapters ─────────────────────────────────────────────────────────
//
// Each returns rows in the SAME shape, so everything downstream (normalization,
// upsert, status) is written once regardless of how a county publishes. A new
// county needing a new kind adds a function here and a "kind" in its config.

const SOURCES = {
  // A county's ArcGIS FeatureServer/MapServer layer. This is a real JSON API
  // with server-side pagination, not a scrape, which is why it is preferred
  // whenever a county has one.
  async arcgis(bulk, onPage) {
    const pageSize = Math.min(bulk.page_size || 2000, 5000);
    const outFields = Object.values(bulk.fields).join(',');
    let offset = 0, total = 0;

    for (;;) {
      const url = `${bulk.url}?${new URLSearchParams({
        where: bulk.where || '1=1',
        outFields,
        returnGeometry: 'false',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        orderByFields: bulk.order_by || 'OBJECTID',
        f: 'json',
      })}`;

      const res = await httpJsonRetry(url, {});
      if (res.error) throw new Error(`ArcGIS error: ${JSON.stringify(res.error).slice(0, 200)}`);
      const feats = res.features || [];
      if (!feats.length) break;

      const rows = feats.map(f => mapFields(f.attributes, bulk.fields)).filter(r => r.street);
      total += rows.length;
      await onPage(rows);

      offset += feats.length;
      process.stdout.write(`\r  fetched ${offset} parcels…`);
      // exceededTransferLimit false (or absent with a short page) means done.
      if (feats.length < pageSize && !res.exceededTransferLimit) break;
      if (LIMIT && total >= LIMIT) break;
      await sleep(PAUSE_MS);
    }
    process.stdout.write('\n');
    return total;
  },
};

// Per-address enrichment. Separate from bulk because it is one request per
// address: it fills what the bulk layer does not publish (here, year built).
const ENRICHERS = {
  // Tyler/Epona "ARES" public real estate search. The page renders client side
  // from this JSON endpoint, so we ask it directly rather than parsing HTML.
  async ares(enrich, street) {
    const url = `${enrich.url}?${new URLSearchParams({
      searchCriteria: street,
      countyCode: enrich.county_code,
      listMode: 'card',
      searchBy: 'address',
    })}`;
    const res = await httpJsonRetry(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 2);
    const rows = Array.isArray(res) ? res : (res.data || []);
    // Exactly one hit or it is ambiguous, and a guess on year built is worse
    // than no answer: this number gates a federal lead-paint disclosure.
    if (rows.length !== 1) return null;
    const r = rows[0];
    const f = enrich.fields;

    const full = r[f.address] || '';
    const zipM = full.match(/\b(\d{5})(?:-\d{4})?\s*$/);
    const cityM = full.match(/,\s*([^,]+),\s*[A-Z]{2}\s/);
    const full_baths = num(r[f.baths_full]);
    const half_baths = num(r[f.baths_half]);

    return {
      year_built: num(r[f.year_built]),
      sqft:       num(r[f.sqft]),
      beds:       num(r[f.beds]),
      // Half baths are half. A county reporting 1 full + 1 half is 1.5, and
      // rounding it to 1 or 2 makes us wrong about somebody's house.
      baths:      full_baths == null && half_baths == null ? null
                    : (full_baths || 0) + (half_baths || 0) * 0.5,
      city:       cityM ? cityM[1].trim() : null,
      zip:        zipM ? zipM[1] : null,
    };
  },
};

function mapFields(attrs, fields) {
  const out = {};
  for (const [col, src] of Object.entries(fields)) out[col] = attrs[src];
  // Trim every string the county hands us. Fixed-width exports pad, and a
  // trailing space is a key that matches nothing.
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim() || null;
  return out;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// A year the assessor never set reads as 0 or 1, and 1900 is the placeholder a
// surprising number of CAMA systems use for "we do not know". Passing those
// through would silently arm or disarm the pre-1978 lead gate on a guess.
function cleanYear(y) {
  const n = num(y);
  if (n == null) return null;
  if (n < 1700 || n > new Date().getFullYear() + 1) return null;
  return Math.round(n);
}

// ── Upsert ──────────────────────────────────────────────────────────────────
async function upsertParcels(rows) {
  if (!rows.length) return 0;
  const payload = rows.map(r => ({
    county_fips: CFG.county_fips,
    state:       CFG.state,
    county_name: CFG.county_name,
    parcel_id:   r.parcel_id != null ? String(r.parcel_id) : null,
    street:      r.street,
    city:        r.city || null,
    zip:         r.zip || null,
    year_built:  cleanYear(r.year_built),
    sqft:        r.sqft != null ? Math.round(num(r.sqft)) : null,
    beds:        num(r.beds),
    baths:       num(r.baths),
    acres:       num(r.acres),
    // A value of 0 is a real assessment (exempt property), so it is kept; only
    // a missing field becomes null.
    assessed_value:    r.assessed_value    != null ? Math.round(num(r.assessed_value))    : null,
    land_value:        r.land_value        != null ? Math.round(num(r.land_value))        : null,
    improvement_value: r.improvement_value != null ? Math.round(num(r.improvement_value)) : null,
    owner_name:  r.owner_name || null,
    source:      CFG.source,
    source_url:  CFG.source_url || null,
    loaded_at:   new Date().toISOString(),
  })).filter(r => r.street && r.parcel_id);

  if (DRY_RUN) return payload.length;

  // on_conflict on (county_fips, parcel_id) so a re-run updates in place rather
  // than duplicating the county every year.
  const r = await supaRetry('POST',
    '/rest/v1/td_county_parcels?on_conflict=county_fips,parcel_id',
    payload,
    { Prefer: 'resolution=merge-duplicates,return=minimal' });
  if (r.error) throw new Error(`upsert failed: ${r.error.message}`);
  return payload.length;
}

async function upsertZips() {
  const zips = CFG.zips || [];
  if (!zips.length || DRY_RUN) return 0;
  const r = await supaRetry('POST', '/rest/v1/td_county_zips?on_conflict=zip,county_fips',
    zips.map(z => ({ zip: z, county_fips: CFG.county_fips, state: CFG.state, county_name: CFG.county_name })),
    { Prefer: 'resolution=merge-duplicates,return=minimal' });
  if (r.error) throw new Error(`zip upsert failed: ${r.error.message}`);
  return zips.length;
}

async function writeStatus(count) {
  if (DRY_RUN) return;
  const pub = CFG.publishes || {};
  const r = await supaRetry('POST', '/rest/v1/td_county_status?on_conflict=county_fips', [{
    county_fips:    CFG.county_fips,
    state:          CFG.state,
    county_name:    CFG.county_name,
    parcel_count:   count,
    has_year_built: !!pub.year_built,
    has_sqft:       !!pub.sqft,
    has_beds:       !!pub.beds,
    source:         CFG.source,
    loaded_at:      new Date().toISOString(),
  }], { Prefer: 'resolution=merge-duplicates,return=minimal' });
  if (r.error) throw new Error(`status upsert failed: ${r.error.message}`);
}

// ── Enrichment pass ─────────────────────────────────────────────────────────
// Fills what the bulk layer does not publish, one address at a time, for rows
// that do not have it yet. Bounded by --enrich N and resumable by construction:
// the queue excludes every address already asked about, so re-running continues
// rather than restarting, and a run killed halfway loses nothing.
async function enrichPass(n) {
  const enrich = CFG.enrich;
  if (!enrich || !ENRICHERS[enrich.kind]) { console.log('  (no enricher configured, skipping)'); return 0; }

  const startedAt = Date.now();
  if (HUMAN && !withinWorkingHours()) {
    console.log(`  outside working hours (${HOUR_START}:00-${HOUR_END}:00 local), nothing to do this visit`);
    return 0;
  }

  // county_enrich_queue, NOT a bare "year_built is null" select. That was the
  // third re-ask hole (20261033): an address the county cannot answer stays null
  // forever, so selecting on null walked straight back over every previous
  // failure on every run. The queue excludes anything already asked about.
  const sel = await supaRetry('POST', '/rest/v1/rpc/county_enrich_queue',
    { p_fips: CFG.county_fips, p_limit: n });
  if (sel.error) throw new Error(`enrich queue failed: ${sel.error.message}`);
  const rows = JSON.parse(sel.data || '[]');
  if (!rows.length) { console.log('  nothing left to enrich (every remaining row has already been asked about)'); return 0; }

  let filled = 0, missed = 0, skipped = 0;
  for (const row of rows) {
    // Claim before contacting, exactly as the API route does. The queue above
    // already excludes asked addresses, but the claim is what makes that true
    // under concurrency: a contractor tapping "Look up property" while this pass
    // is running must not produce a second request for the same address, and the
    // daily cap has to count both paths or it counts neither.
    const claim = await supaRetry('POST', '/rest/v1/rpc/county_claim_ask',
      { p_fips: CFG.county_fips, p_addr: row.street, p_daily_cap: DAILY_CAP });
    const verdict = (claim.data || '').replace(/"/g, '').trim();
    if (claim.error || verdict !== 'go') {
      skipped++;
      // 'capped' means the county's budget for today is spent. Stopping is the
      // point of the cap, so stop rather than spinning through the rest of the
      // list collecting refusals.
      if (verdict === 'capped') {
        process.stdout.write(`\n  daily cap reached for this county, stopping. Re-run tomorrow to continue.\n`);
        break;
      }
      continue;
    }

    try {
      const got = await ENRICHERS[enrich.kind](enrich, row.street);
      if (got && (got.year_built != null || got.sqft != null)) {
        const patch = {
          year_built: cleanYear(got.year_built),
          sqft:  got.sqft != null ? Math.round(got.sqft) : null,
          beds:  got.beds,
          baths: got.baths,
          city:  got.city,
          zip:   got.zip,
        };
        Object.keys(patch).forEach(k => patch[k] == null && delete patch[k]);
        if (Object.keys(patch).length && !DRY_RUN) {
          const up = await supaRetry('PATCH', `/rest/v1/td_county_parcels?id=eq.${row.id}`, patch,
            { Prefer: 'return=minimal' });
          if (up.error) throw new Error(up.error.message);
        }
        filled++;
        await recordAsk(row.street, 'hit');
      } else {
        // The county answered and had nothing, or had no year for this parcel.
        // Recording that is what retires the address: without it, the next run
        // asks again, and the run after that, forever.
        missed++;
        await recordAsk(row.street, 'empty');
      }
    } catch (e) {
      // A thrown request is not proof the county has nothing, so the claim is
      // left 'pending' rather than closed as empty. It re-opens in an hour.
      missed++;
      if (missed <= 3) console.warn(`\n  enrich failed for "${row.street}": ${e.message}`);
    }
    process.stdout.write(`\r  enriched ${filled}, no data ${missed}${skipped ? `, already asked ${skipped}` : ''} of ${rows.length}…`);

    // End the visit rather than the work. The queue is resumable, so a short
    // session that stops mid-list is exactly what the next one picks up.
    if (MAX_MIN && (Date.now() - startedAt) > MAX_MIN * 60000) {
      process.stdout.write(`\n  ${MAX_MIN} minute visit is up, stopping here. The queue resumes where this left off.\n`);
      break;
    }
    if (HUMAN && !withinWorkingHours()) {
      process.stdout.write(`\n  reached ${HOUR_END}:00 local, stopping for the day.\n`);
      break;
    }
    await sleep(HUMAN ? humanGapMs() : PAUSE_MS);
  }
  process.stdout.write('\n');
  return filled;
}

async function recordAsk(street, outcome) {
  if (DRY_RUN) return;
  await supaRetry('POST', '/rest/v1/rpc/county_record_ask',
    { p_fips: CFG.county_fips, p_addr: street, p_outcome: outcome });
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  console.log(`\n[county-load] ${CFG.county_name} County, ${CFG.state} (FIPS ${CFG.county_fips})`);
  console.log(`[county-load] source: ${CFG.source}${DRY_RUN ? '  (DRY RUN, nothing is written)' : ''}`);

  // --print and --dry-run never write, so they must never need a credential
  // either: checking the field map for a new county is the one step you want to
  // be able to run from anywhere, before any secret exists.
  if (!DRY_RUN && !PRINT) {
    if (!SUPABASE_URL) { console.error('ERROR: set SUPABASE_URL or SUPABASE_PROJECT_REF'); process.exit(1); }
    await resolveServiceKey();
  }

  const src = SOURCES[CFG.bulk.kind];
  if (!src) { console.error(`ERROR: unknown bulk source kind "${CFG.bulk.kind}"`); process.exit(1); }

  if (PRINT) {
    let shown = 0;
    await src(CFG.bulk, async rows => {
      for (const r of rows) {
        if (shown >= (LIMIT || 5)) return;
        console.log(`\n  --- parcel ${++shown} ---`);
        for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(18)} ${v === null ? '(null)' : v}`);
      }
    });
    console.log('\n[county-load] --print: nothing written. Check the field map above, then re-run without it.\n');
    // An enricher is only proven by a real address, so print one lookup too.
    if (CFG.enrich && ENRICHERS[CFG.enrich.kind] && process.env.TD_PRINT_ADDR) {
      const got = await ENRICHERS[CFG.enrich.kind](CFG.enrich, process.env.TD_PRINT_ADDR);
      console.log(`  enrich("${process.env.TD_PRINT_ADDR}") =>`, got);
    }
    return;
  }

  let written = 0;
  const seen = await src(CFG.bulk, async rows => {
    const slice = LIMIT ? rows.slice(0, Math.max(0, LIMIT - written)) : rows;
    if (slice.length) written += await upsertParcels(slice);
  });

  console.log(`[county-load] parcels: ${seen} fetched, ${written} written`);
  const zipCount = await upsertZips();
  if (zipCount) console.log(`[county-load] zips: ${zipCount}`);

  if (ENRICH) {
    console.log(`[county-load] enriching up to ${ENRICH} addresses (year built)…`);
    const filled = await enrichPass(ENRICH);
    console.log(`[county-load] enriched: ${filled}`);
  }

  await writeStatus(written);
  console.log(`[county-load] done in ${Math.round((Date.now() - t0) / 1000)}s\n`);
})().catch(e => {
  console.error(`\n[county-load] FAILED: ${e.message}`);
  process.exit(1);
});
