#!/usr/bin/env node
// TradeDesk Tax Rate Updater
// Run monthly (1st of month) via cron or GitHub Actions scheduled workflow
// Populates Supabase tax_rates table from free government sources
//
// Phase 1 (complete): State base rates + FL county rates
// Phase 2 (complete): SST member state ZIP files (23 states) + TX Comptroller
// Phase 3 (complete): CA CDTFA, NY DOR, IL DOR, CO DOR

'use strict';

const https         = require('https');
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const readline      = require('readline');
const zlib          = require('zlib');
const { parseSSTRates, combineBoundaryRecord, createZipAggregator, countyRows } = require('./sst-rates');

// Accept either explicit URL+key OR project-ref+access-token (matches existing CI secrets)
const SUPABASE_URL         = process.env.SUPABASE_URL
  || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_PROJECT_REF  = process.env.SUPABASE_PROJECT_REF;
let   SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error('ERROR: set SUPABASE_URL or SUPABASE_PROJECT_REF');
  process.exit(1);
}

async function resolveServiceKey() {
  if (SUPABASE_SERVICE_KEY) return;
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) {
    console.error('ERROR: set SUPABASE_SERVICE_KEY, or both SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN');
    process.exit(1);
  }
  const text = await fetchText(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys`,
    { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` }
  );
  const keys = JSON.parse(text);
  const svcKey = keys.find(k => k.name === 'service_role');
  if (!svcKey) { console.error('ERROR: service_role key not found in Management API response'); process.exit(1); }
  SUPABASE_SERVICE_KEY = svcKey.api_key;
}

// Direct REST upsert with retry, avoids native fetch which fails on Proxmox TLS
function _supaPostOnce(apiPath, bodyStr, extraHeaders) {
  return new Promise((resolve) => {
    const host = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const options = {
      hostname: host,
      path: apiPath,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...extraHeaders,
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ error: null });
        } else {
          resolve({ error: { message: `HTTP ${res.statusCode}: ${data.slice(0, 200)}` } });
        }
      });
    });
    req.on('error', err => resolve({ error: { message: err.message } }));
    req.write(bodyStr);
    req.end();
  });
}

async function supaPost(apiPath, body, extraHeaders = {}) {
  const bodyStr = JSON.stringify(body);
  // Longer backoff for DNS failures, gives the resolver time to recover
  const delays = [2000, 4000, 8000, 16000, 30000, 30000];
  let result;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    result = await _supaPostOnce(apiPath, bodyStr, extraHeaders);
    if (!result.error || !(/EAI_AGAIN|ENOTFOUND|ETIMEDOUT/.test(result.error.message))) return result;
    if (attempt < delays.length) {
      process.stdout.write(`[DNS retry ${attempt+1}/${delays.length} in ${delays[attempt]/1000}s] `);
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  return result;
}

// ── State base rates ─────────────────────────────────────────────────────────
const STATE_BASE_RATES = {
  AL:{state:4.000}, AK:{state:0},     AZ:{state:5.600}, AR:{state:6.500},
  CA:{state:7.250}, CO:{state:2.900}, CT:{state:6.350}, DE:{state:0},
  FL:{state:6.000}, GA:{state:4.000}, HI:{state:4.000}, ID:{state:6.000},
  IL:{state:6.250}, IN:{state:7.000}, IA:{state:6.000}, KS:{state:6.500},
  KY:{state:6.000}, LA:{state:4.450}, ME:{state:5.500}, MD:{state:6.000},
  MA:{state:6.250}, MI:{state:6.000}, MN:{state:6.875}, MS:{state:7.000},
  MO:{state:4.225}, MT:{state:0},     NE:{state:5.500}, NV:{state:6.850},
  NH:{state:0},     NJ:{state:6.625}, NM:{state:5.125}, NY:{state:4.000},
  NC:{state:4.750}, ND:{state:5.000}, OH:{state:5.750}, OK:{state:4.500},
  OR:{state:0},     PA:{state:6.000}, RI:{state:7.000}, SC:{state:6.000},
  SD:{state:4.200}, TN:{state:7.000}, TX:{state:6.250}, UT:{state:6.100},
  VT:{state:6.000}, VA:{state:5.300}, WA:{state:6.500}, WV:{state:6.000},
  WI:{state:5.000}, WY:{state:4.000}, DC:{state:6.000},
};

// ── Florida county discretionary surtax rates ────────────────────────────────
const FL_COUNTY_SURTAX = {
  ALACHUA:0.50,   BAKER:0.75,   BAY:0.50,      BRADFORD:1.00, BREVARD:1.00,
  BROWARD:1.00,   CALHOUN:1.50, CHARLOTTE:1.00, CITRUS:1.00,   CLAY:1.00,
  COLLIER:1.00,   COLUMBIA:1.50,DESOTO:1.00,    DIXIE:1.00,    DUVAL:1.00,
  ESCAMBIA:1.50,  FLAGLER:1.00, FRANKLIN:0.50,  GADSDEN:1.50,  GILCHRIST:1.00,
  GLADES:1.00,    GULF:0.50,    HAMILTON:1.00,  HARDEE:1.00,   HENDRY:1.00,
  HERNANDO:1.50,  HIGHLANDS:1.00,HILLSBOROUGH:1.50,HOLMES:1.50,INDIANRIVER:1.00,
  JACKSON:1.00,   JEFFERSON:1.50,LAFAYETTE:1.00, LAKE:1.00,     LEE:0.50,
  LEON:1.50,      LEVY:1.00,    LIBERTY:1.00,   MADISON:1.00,  MANATEE:1.00,
  MARION:1.00,    MARTIN:1.00,  MIAMIDADE:1.00, MONROE:1.50,   NASSAU:1.00,
  OKALOOSA:0.50,  OKEECHOBEE:0.50,ORANGE:0.50,  OSCEOLA:1.00,  PALMBEACH:1.00,
  PASCO:1.00,     PINELLAS:1.00,POLK:1.00,      PUTNAM:1.00,   STJOHNS:0.50,
  STLUCIE:1.00,   SANTAROSA:0.50,SARASOTA:1.00,  SEMINOLE:1.00, SUMTER:1.00,
  SUWANNEE:1.00,  TAYLOR:1.00,  UNION:1.00,     VOLUSIA:0.50,  WAKULLA:1.50,
  WALTON:1.00,    WASHINGTON:1.00,
};

// ── SST member states ────────────────────────────────────────────────────────
// 23 states providing free quarterly rate+boundary ZIP files
// Source: https://www.streamlinedsalestax.org/Shared-Pages/rate-and-boundary-files
const SST_STATES = [
  'AR','GA','IN','IA','KS','KY','MI','MN','NE','NV','NJ',
  'NC','ND','OH','OK','RI','SD','UT','VT','WA','WV','WI','WY',
];

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      const parsed = new URL(u);
      const opts = Object.keys(headers).length
        ? { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search, headers }
        : u;
      https.get(opts, res => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects < 5) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    get(url);
  });
}

function downloadFile(url, destPath, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { done = true; reject(new Error(`Download timeout (${timeoutMs/1000}s)`)); }, timeoutMs);
    const get = (u, redirects = 0) => {
      if (done) return;
      const req = https.get(u, res => {
        if (done) return;
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects < 5) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => { clearTimeout(timer); out.close(resolve); });
        out.on('error', e => { clearTimeout(timer); reject(e); });
      });
      req.on('error', e => { if (!done) { clearTimeout(timer); reject(e); } });
      req.setTimeout(timeoutMs, () => { req.destroy(); });
    };
    get(url);
  });
}

// Unzip with Node's own zlib. It used to shell out to `unzip`, which the
// self-hosted runner does not have: every zipped SST state failed with
// "spawn unzip ENOENT" from June on while the job still reported success.
// SST zips hold one or two plain files, stored or deflated, so reading the
// central directory is all this needs.
function unzipTo(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: ' + path.basename(zipPath));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  fs.mkdirSync(destDir, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.slice(start, start + csize);
    const out = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!out) throw new Error('unsupported zip method ' + method);
    fs.writeFileSync(path.join(destDir, path.basename(name)), out);
  }
}

// Simple CSV/pipe parser, handles quoted fields
function parseDelimited(text, delimiter = ',') {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (!lines.length) return [];
  const clean = s => s.replace(/^["']|["']$/g, '').trim();
  const headers = lines[0].split(delimiter).map(clean);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(delimiter).map(clean);
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] !== undefined ? vals[i] : '');
    return obj;
  });
}

// ── Supabase upsert ──────────────────────────────────────────────────────────
async function upsertBatch(rows) {
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supaPost('/rest/v1/tax_rates?on_conflict=zip', batch, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (error) { console.error('  Upsert error:', error.message); return false; }
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${rows.length} rows`);
  }
  process.stdout.write('\n');
  return true;
}

// ── Phase 1: State base rates ────────────────────────────────────────────────
async function seedStateBaseRates() {
  console.log('Seeding state base rates...');
  const rows = Object.entries(STATE_BASE_RATES).map(([st, r]) => ({
    zip: 'STATE-' + st, state: st, state_rate: r.state, local_rate: 0,
    source: 'STATE_BASE', updated_at: new Date().toISOString(),
  }));
  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} state base rate rows`);
  return ok;
}

// ── Phase 1: Florida county rates ────────────────────────────────────────────
async function seedFloridaCountyRates() {
  console.log('Seeding Florida county rates...');
  const rows = Object.entries(FL_COUNTY_SURTAX).map(([county, surtax]) => ({
    zip: 'FL-COUNTY-' + county, state: 'FL', state_rate: 6.0, local_rate: surtax,
    source: 'FL_DOR_COUNTY', updated_at: new Date().toISOString(),
  }));
  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} FL county rate rows`);
  return ok;
}

// ── Phase 2: SST member state ZIP files ─────────────────────────────────────
// SST publishes quarterly boundary (ZIP→jurisdiction) + rate (jurisdiction→rates) files.
// Files are free, no API key required.
// Directory: https://www.streamlinedsalestax.org/ratesandboundry/Rates/
// The script scrapes the directory listing to find the current filename for each state
// rather than guessing, SST changes naming conventions and publication dates unpredictably.

const SST_RATE_DIR     = 'https://www.streamlinedsalestax.org/ratesandboundry/Rates/';
const SST_BOUNDARY_DIR = 'https://www.streamlinedsalestax.org/ratesandboundry/Boundary/';
let _sstRateDirCache     = null;
let _sstBoundaryDirCache = null;

async function getSSTDirectory(dirUrl, cacheRef) {
  if (cacheRef.v) return cacheRef.v;
  const html = await fetchText(dirUrl);
  const files = [];
  const re = /href="([^"]+\.(zip|csv))"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    const url = raw.startsWith('http') ? raw : dirUrl + raw.split('/').pop();
    const name = raw.split('/').pop();
    files.push({ name, url });
  }
  cacheRef.v = files;
  return files;
}

const _rateDirRef     = {};
const _boundaryDirRef = {};

function getSSTRateDir()     { return getSSTDirectory(SST_RATE_DIR,     _rateDirRef); }
function getSSTBoundaryDir() { return getSSTDirectory(SST_BOUNDARY_DIR, _boundaryDirRef); }


async function _downloadAndExtract(fileEntry, destPath, stateDir) {
  await downloadFile(fileEntry.url, destPath);
  const isZip = fileEntry.name.toLowerCase().endsWith('.zip');
  if (isZip) {
    fs.mkdirSync(stateDir, { recursive: true });
    unzipTo(destPath, stateDir);
    const innerFiles = fs.readdirSync(stateDir);
    return innerFiles.filter(f => /\.(csv|txt)$/i.test(f)).map(f => path.join(stateDir, f));
  }
  return [destPath];
}

async function updateSSTState(st, _unused, tmpDir) {
  const [rateFiles, boundaryFiles] = await Promise.all([
    getSSTRateDir().then(files => files.filter(f => f.name.toUpperCase().startsWith(st + 'R'))),
    getSSTBoundaryDir().catch(() => []).then(files => files.filter(f => f.name.toUpperCase().startsWith(st + 'B'))),
  ]);

  if (!rateFiles.length) throw new Error(`No rate file for ${st} in SST directory`);
  rateFiles.sort((a, b) => b.name.localeCompare(a.name));
  boundaryFiles.sort((a, b) => b.name.localeCompare(a.name));

  const rateEntry = rateFiles[0];
  const boundaryEntry = boundaryFiles[0] || null;

  const stateDir = path.join(tmpDir, st);
  const ratePath = path.join(tmpDir, `${st}_R${rateEntry.name.toLowerCase().endsWith('.zip') ? '.zip' : '.csv'}`);

  // If we have a separate boundary file, download both and join on jurisdiction code
  if (boundaryEntry) {
    const boundaryPath = path.join(tmpDir, `${st}_B${boundaryEntry.name.toLowerCase().endsWith('.zip') ? '.zip' : '.csv'}`);
    const bdirPath = path.join(stateDir, 'boundary');

    // Download rate file first (small), then boundary
    const rateCsvs = await _downloadAndExtract(rateEntry, ratePath, path.join(stateDir, 'rate'));
    const boundaryCsvs = await _downloadAndExtract(boundaryEntry, boundaryPath, bdirPath);
    process.stdout.write(`    → ${rateEntry.name} + ${boundaryEntry.name}\n`);
    if (rateCsvs.length && boundaryCsvs.length) {
      return _processSSTFiles(st, boundaryCsvs[0], rateCsvs[0]);
    }
  }

  // A rate file alone names jurisdictions, not ZIPs: without the boundary file
  // there is nothing to key a row on, so the state is skipped, not guessed.
  throw new Error(`No boundary file for ${st}`);
}

// Rate + boundary → one row per ZIP (the combined rate most addresses pay, with
// the low and high) and one row per county (state plus county, no city). The
// parsing rules live in scripts/sst-rates.js, which says why they changed.
async function _processSSTFiles(st, boundaryPath, ratePath) {
  const asOf = new Date();
  const rates = parseSSTRates(fs.readFileSync(ratePath, 'utf8'), asOf);
  const stateKey = Object.keys(rates).find(k => k.startsWith('45:'));
  if (!stateKey) {
    process.stdout.write('[no state rate in rate file] ');
    return [];
  }
  const stFips = stateKey.slice(3);
  const agg = createZipAggregator();
  // Stream the boundary file: KS alone is 105MB and 685k records.
  const rl = readline.createInterface({ input: fs.createReadStream(boundaryPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) agg.add(combineBoundaryRecord(line.split(','), rates, asOf));
  }
  const now = new Date().toISOString();
  const stamp = r => Object.assign(r, { source: `SST_${st}`, updated_at: now });
  return agg.zipRows(st).map(stamp).concat(countyRows(st, stFips, rates).map(stamp));
}

async function updateSSTStates() {
  console.log(`SST member state ZIP files (scraping directory listing)...`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sst-'));

  let totalRows = 0;
  let skipped = [];

  for (const st of SST_STATES) {
    process.stdout.write(`  ${st}... `);
    try {
      const rows = await updateSSTState(st, null, tmpDir);
      if (rows.length) {
        const ok = await upsertBatch(rows);
        if (ok) { totalRows += rows.length; process.stdout.write(`${rows.length} ZIPs\n`); }
        else skipped.push(st + '(upsert error)');
      } else {
        process.stdout.write('0 ZIPs (empty)\n');
        skipped.push(st + '(empty)');
      }
    } catch (e) {
      process.stdout.write(`SKIP, ${e.message}\n`);
      skipped.push(st);
      // A state that throws is a broken updater, not a quiet month. Fail the
      // job so it shows red: the unzip failure hid for three months behind a
      // green check.
      process.exitCode = 1;
    }
    // Boundary files run to 100MB+ unzipped; 23 of them at once fills the runner.
    for (const p of [path.join(tmpDir, st), path.join(tmpDir, st + '_R.zip'), path.join(tmpDir, st + '_B.zip')]) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`  SST complete: ${totalRows} ZIP rows across ${SST_STATES.length - skipped.length} states`);
  if (skipped.length) console.log(`  Skipped states: ${skipped.join(', ')}`);
}

// ── Phase 2: Texas Comptroller ───────────────────────────────────────────────
// TX publishes combined area transit (CAT) rate files monthly.
// Download: https://comptroller.texas.gov/taxes/sales/rates/
// Direct CSV: https://comptroller.texas.gov/taxes/sales/rates/combined-area-transit.csv
// (If CSV link changes, find it at the rates page under "Download Rates")

async function updateTexasRates() {
  console.log('Texas Comptroller rates...');
  const TX_RATES_CSV = 'https://comptroller.texas.gov/taxes/sales/rates/combined-area-transit.csv';
  const TX_STATE_RATE = 6.25;

  let text;
  try {
    text = await fetchText(TX_RATES_CSV);
  } catch (e) {
    console.log(`  SKIP, could not fetch TX rates (${e.message})`);
    console.log('  Verify URL at: https://comptroller.texas.gov/taxes/sales/rates/');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP, empty TX rates file'); return; }

  // TX file columns: City, County, SPD (Special Purpose District), combined rate
  // We need ZIP-level data, TX also publishes a ZIP-to-jurisdiction crosswalk
  // For now seed city-level rates keyed as TX-CITY-{NAME} (ZIP-level in Phase 2b)
  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const col = (row, ...names) => {
      for (const n of names) {
        const k = Object.keys(row).find(k => k.toLowerCase().includes(n.toLowerCase()));
        if (k !== undefined) return row[k];
      }
      return '';
    };
    const city = (col(r, 'city', 'name') || '').toUpperCase().trim().replace(/\s+/g, '_');
    const rate = parseFloat(col(r, 'combined', 'total', 'rate')) || 0;
    if (!city || !rate || seen.has(city)) continue;
    seen.add(city);
    const localRate = Math.max(0, rate - TX_STATE_RATE);
    rows.push({
      zip: `TX-CITY-${city}`, state: 'TX',
      state_rate: TX_STATE_RATE, local_rate: Math.round(localRate * 10000) / 10000,
      source: 'TX_COMPTROLLER', updated_at: new Date().toISOString(),
    });
  }

  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} TX city rate rows`);
}

// ── Phase 3: California CDTFA ────────────────────────────────────────────────
// CDTFA publishes a downloadable tax rate file by ZIP code.
// Source: https://www.cdtfa.ca.gov/taxes-and-fees/rates.html
// Direct CSV: https://www.cdtfa.ca.gov/formspubs/cdtfa95.csv
// (verify at the rates page, file is updated quarterly)

async function updateCaliforniaRates() {
  console.log('California CDTFA rates...');
  const CA_CSV = 'https://www.cdtfa.ca.gov/formspubs/cdtfa95.csv';
  const CA_STATE_RATE = 7.25;

  let text;
  try {
    text = await fetchText(CA_CSV);
  } catch (e) {
    console.log(`  SKIP, could not fetch CA rates (${e.message})`);
    console.log('  Verify URL at: https://www.cdtfa.ca.gov/taxes-and-fees/rates.html');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP, empty CA rates file'); return; }

  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const col = (...names) => {
      for (const n of names) {
        const k = Object.keys(r).find(k => k.toLowerCase().includes(n.toLowerCase()));
        if (k !== undefined) return r[k];
      }
      return '';
    };
    const zip = (col('zip', 'postal') || '').replace(/\D/g, '').slice(0, 5);
    const rate = parseFloat(col('total', 'combined', 'rate')) || 0;
    if (!zip || zip.length !== 5 || !rate || seen.has(zip)) continue;
    seen.add(zip);
    rows.push({
      zip, state: 'CA',
      state_rate: CA_STATE_RATE,
      local_rate: Math.round(Math.max(0, rate - CA_STATE_RATE) * 10000) / 10000,
      source: 'CA_CDTFA', updated_at: new Date().toISOString(),
    });
  }

  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} CA ZIP rate rows`);
}

// ── Phase 3: New York ────────────────────────────────────────────────────────
// NY Dept of Tax & Finance publishes quarterly ZIP-level rate schedules.
// Source: https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf (PDF, harder)
//         or the jurisdiction rate table:
// Direct CSV: https://www.tax.ny.gov/data/stats/zip_code_sales_tax_rates.csv
// (verify at: https://www.tax.ny.gov/bus/st/qrtrly_rate.htm)

async function updateNewYorkRates() {
  console.log('New York DOR rates...');
  const NY_CSV = 'https://www.tax.ny.gov/data/stats/zip_code_sales_tax_rates.csv';
  const NY_STATE_RATE = 4.0;

  let text;
  try {
    text = await fetchText(NY_CSV);
  } catch (e) {
    console.log(`  SKIP, could not fetch NY rates (${e.message})`);
    console.log('  Verify URL at: https://www.tax.ny.gov/bus/st/qrtrly_rate.htm');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP, empty NY rates file'); return; }

  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const col = (...names) => {
      for (const n of names) {
        const k = Object.keys(r).find(k => k.toLowerCase().includes(n.toLowerCase()));
        if (k !== undefined) return r[k];
      }
      return '';
    };
    const zip = (col('zip', 'postal') || '').replace(/\D/g, '').slice(0, 5);
    const rate = parseFloat(col('total', 'combined', 'rate')) || 0;
    if (!zip || zip.length !== 5 || !rate || seen.has(zip)) continue;
    seen.add(zip);
    rows.push({
      zip, state: 'NY',
      state_rate: NY_STATE_RATE,
      local_rate: Math.round(Math.max(0, rate - NY_STATE_RATE) * 10000) / 10000,
      source: 'NY_DOR', updated_at: new Date().toISOString(),
    });
  }

  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} NY ZIP rate rows`);
}

// ── Phase 3: Illinois ────────────────────────────────────────────────────────
// IL DOR publishes a ZIP-level rate table.
// Source: https://tax.illinois.gov/research/taxinformation/sales/rot.html
// Direct CSV: https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxinformation/sales/documents/rot-zip-rates.csv

async function updateIllinoisRates() {
  console.log('Illinois DOR rates...');
  const IL_CSV = 'https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxinformation/sales/documents/rot-zip-rates.csv';
  const IL_STATE_RATE = 6.25;

  let text;
  try {
    text = await fetchText(IL_CSV);
  } catch (e) {
    console.log(`  SKIP, could not fetch IL rates (${e.message})`);
    console.log('  Verify URL at: https://tax.illinois.gov/research/taxinformation/sales/rot.html');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP, empty IL rates file'); return; }

  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const col = (...names) => {
      for (const n of names) {
        const k = Object.keys(r).find(k => k.toLowerCase().includes(n.toLowerCase()));
        if (k !== undefined) return r[k];
      }
      return '';
    };
    const zip = (col('zip', 'postal') || '').replace(/\D/g, '').slice(0, 5);
    const rate = parseFloat(col('total', 'combined', 'rate', 'pct')) || 0;
    if (!zip || zip.length !== 5 || !rate || seen.has(zip)) continue;
    seen.add(zip);
    rows.push({
      zip, state: 'IL',
      state_rate: IL_STATE_RATE,
      local_rate: Math.round(Math.max(0, rate - IL_STATE_RATE) * 10000) / 10000,
      source: 'IL_DOR', updated_at: new Date().toISOString(),
    });
  }

  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} IL ZIP rate rows`);
}

// ── Phase 3: Colorado ────────────────────────────────────────────────────────
// CO DOR publishes city/county rates. ZIP-level requires their address lookup API
// (free, no key). For now seed the county averages from the downloadable CSV.
// Source: https://tax.colorado.gov/sales-use-tax-rates
// Direct CSV: https://tax.colorado.gov/sites/tax/files/documents/DR1002_2024.csv

async function updateColoradoRates() {
  console.log('Colorado DOR rates...');
  const CO_CSV = 'https://tax.colorado.gov/sites/tax/files/documents/DR1002.csv';
  const CO_STATE_RATE = 2.9;

  let text;
  try {
    text = await fetchText(CO_CSV);
  } catch (e) {
    console.log(`  SKIP, could not fetch CO rates (${e.message})`);
    console.log('  Verify URL at: https://tax.colorado.gov/sales-use-tax-rates');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP, empty CO rates file'); return; }

  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const col = (...names) => {
      for (const n of names) {
        const k = Object.keys(r).find(k => k.toLowerCase().includes(n.toLowerCase()));
        if (k !== undefined) return r[k];
      }
      return '';
    };
    const jurisdiction = (col('city', 'county', 'jurisdiction', 'name') || '').toUpperCase().trim().replace(/\s+/g, '_');
    const rate = parseFloat(col('total', 'combined', 'rate')) || 0;
    if (!jurisdiction || !rate || seen.has(jurisdiction)) continue;
    seen.add(jurisdiction);
    rows.push({
      zip: `CO-CITY-${jurisdiction}`, state: 'CO',
      state_rate: CO_STATE_RATE,
      local_rate: Math.round(Math.max(0, rate - CO_STATE_RATE) * 10000) / 10000,
      source: 'CO_DOR', updated_at: new Date().toISOString(),
    });
  }

  const ok = await upsertBatch(rows);
  if (ok) console.log(`  Seeded ${rows.length} CO jurisdiction rate rows`);
}


// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await resolveServiceKey();

  console.log('=== TradeDesk Tax Rate Updater ===');
  console.log('Run date:', new Date().toISOString());
  console.log('');

  // Phase 1, always runs (hardcoded data, never fails)
  await seedStateBaseRates();
  await seedFloridaCountyRates();

  // Phase 2, SST member states (23 states) + Texas
  await updateSSTStates();
  await updateTexasRates();

  // Phase 2.5, Kansas KDOR hardcoded rates removed, KS is an SST member state and SST data
  // is authoritative. The hardcoded override was causing stale rates (e.g. Shawnee County
  // went 1.15% → 1.35% but hardcoded table wasn't updated). SST now wins for all KS ZIPs.

  // Phase 3, large non-SST states with DOR CSV files
  await updateCaliforniaRates();
  await updateNewYorkRates();
  await updateIllinoisRates();
  await updateColoradoRates();

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
