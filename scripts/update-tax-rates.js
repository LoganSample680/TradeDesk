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
const { execFile }  = require('child_process');
const { createClient } = require('@supabase/supabase-js');

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

let supa; // initialized after resolveServiceKey()

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
      const opts = Object.keys(headers).length
        ? Object.assign(require('url').parse(u), { headers })
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      https.get(u, res => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects < 5) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

function unzipTo(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('unzip', ['-o', '-q', zipPath, '-d', destDir], err => {
      if (err) reject(err); else resolve();
    });
  });
}

// Simple CSV/pipe parser — handles quoted fields
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
    const { error } = await supa.from('tax_rates').upsert(batch, { onConflict: 'zip' });
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
// URL pattern: https://www.streamlinedsalestax.org/files/docs/rates/{ST}RateBoundary{YYYYMMDD}.zip
// Effective dates: Jan 1, Apr 1, Jul 1, Oct 1 of each year.
// Verify current filenames at: https://www.streamlinedsalestax.org/Shared-Pages/rate-and-boundary-files

function getSSTQuarterDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  // Find the most recently past effective date
  const quarters = [
    new Date(y, 0, 1),   // Jan 1
    new Date(y, 3, 1),   // Apr 1
    new Date(y, 6, 1),   // Jul 1
    new Date(y, 9, 1),   // Oct 1
    new Date(y - 1, 9, 1), // Oct 1 previous year (fallback)
  ].filter(d => d <= now).sort((a, b) => b - a);
  const d = quarters[0];
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

async function updateSSTState(st, dateStr, tmpDir) {
  const url = `https://www.streamlinedsalestax.org/files/docs/rates/${st}RateBoundary${dateStr}.zip`;
  const zipPath = path.join(tmpDir, `${st}.zip`);
  const stateDir = path.join(tmpDir, st);

  await downloadFile(url, zipPath);
  fs.mkdirSync(stateDir, { recursive: true });
  await unzipTo(zipPath, stateDir);

  // Find boundary and rate files — naming varies slightly by state
  const files = fs.readdirSync(stateDir);
  const boundaryFile = files.find(f => /boundary/i.test(f) && /\.(csv|txt)$/i.test(f));
  const rateFile     = files.find(f => /rate/i.test(f) && !/boundary/i.test(f) && /\.(csv|txt)$/i.test(f));

  if (!boundaryFile || !rateFile) {
    throw new Error(`Could not find boundary/rate files in ${stateDir}: [${files.join(', ')}]`);
  }

  // Determine delimiter — SST uses pipe (|) for most states, some use comma
  const sampleBoundary = fs.readFileSync(path.join(stateDir, boundaryFile), 'utf8').slice(0, 500);
  const delim = sampleBoundary.includes('|') ? '|' : ',';

  const boundary = parseDelimited(fs.readFileSync(path.join(stateDir, boundaryFile), 'utf8'), delim);
  const rates    = parseDelimited(fs.readFileSync(path.join(stateDir, rateFile), 'utf8'), delim);

  // Build jurisdiction code → rates map
  // Rate file columns (SST standard): STATECODE, JURISDICTIONCODE, JURISDICTIONNAME, STATETAXRATE, LOCALTAXRATE, COMBINEDTAXRATE
  // Column names vary — find them case-insensitively
  const col = (row, ...names) => {
    for (const n of names) {
      const k = Object.keys(row).find(k => k.toLowerCase().replace(/[_\s]/g,'') === n.toLowerCase().replace(/[_\s]/g,''));
      if (k !== undefined && row[k] !== undefined) return row[k];
    }
    return '';
  };

  const rateMap = {};
  for (const r of rates) {
    const jCode = col(r, 'JURISDICTIONCODE', 'JURISCD', 'JURCODE', 'CODE');
    const stRate = parseFloat(col(r, 'STATETAXRATE', 'STATERATE', 'STATE_RATE')) || 0;
    const lcRate = parseFloat(col(r, 'LOCALTAXRATE', 'LOCALRATE', 'LOCAL_RATE')) || 0;
    const combined = parseFloat(col(r, 'COMBINEDTAXRATE', 'COMBINEDRATE', 'COMBINED_RATE')) || (stRate + lcRate);
    if (jCode) rateMap[jCode] = { state_rate: stRate * 100, local_rate: (combined - stRate) * 100 };
  }

  // Build ZIP → rate rows from boundary file
  // Boundary columns (SST standard): ZIPCODE (or ZIP5), JURISDICTIONCODE, STATECODE
  const rows = [];
  const seen = new Set();
  for (const b of boundary) {
    const zip = (col(b, 'ZIPCODE', 'ZIP5', 'ZIP', 'POSTALCODE') || '').replace(/\D/g, '').slice(0, 5);
    const jCode = col(b, 'JURISDICTIONCODE', 'JURISCD', 'JURCODE', 'CODE');
    if (!zip || zip.length !== 5 || !jCode || seen.has(zip)) continue;
    const r = rateMap[jCode];
    if (!r) continue;
    seen.add(zip);
    rows.push({
      zip, state: st,
      state_rate: Math.round(r.state_rate * 10000) / 10000,
      local_rate: Math.round(r.local_rate * 10000) / 10000,
      source: `SST_${st}`, updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

async function updateSSTStates() {
  const dateStr = getSSTQuarterDate();
  console.log(`SST member state ZIP files (quarter: ${dateStr})...`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sst-'));

  let totalRows = 0;
  let skipped = [];

  for (const st of SST_STATES) {
    process.stdout.write(`  ${st}... `);
    try {
      const rows = await updateSSTState(st, dateStr, tmpDir);
      if (rows.length) {
        const ok = await upsertBatch(rows);
        if (ok) { totalRows += rows.length; process.stdout.write(`${rows.length} ZIPs\n`); }
        else skipped.push(st + '(upsert error)');
      } else {
        process.stdout.write('0 ZIPs (empty)\n');
        skipped.push(st + '(empty)');
      }
    } catch (e) {
      process.stdout.write(`SKIP — ${e.message}\n`);
      skipped.push(st);
    }
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`  SST complete: ${totalRows} ZIP rows across ${SST_STATES.length - skipped.length} states`);
  if (skipped.length) console.log(`  Skipped (check URLs at streamlinedsalestax.org): ${skipped.join(', ')}`);
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
    console.log(`  SKIP — could not fetch TX rates (${e.message})`);
    console.log('  Verify URL at: https://comptroller.texas.gov/taxes/sales/rates/');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP — empty TX rates file'); return; }

  // TX file columns: City, County, SPD (Special Purpose District), combined rate
  // We need ZIP-level data — TX also publishes a ZIP-to-jurisdiction crosswalk
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
// (verify at the rates page — file is updated quarterly)

async function updateCaliforniaRates() {
  console.log('California CDTFA rates...');
  const CA_CSV = 'https://www.cdtfa.ca.gov/formspubs/cdtfa95.csv';
  const CA_STATE_RATE = 7.25;

  let text;
  try {
    text = await fetchText(CA_CSV);
  } catch (e) {
    console.log(`  SKIP — could not fetch CA rates (${e.message})`);
    console.log('  Verify URL at: https://www.cdtfa.ca.gov/taxes-and-fees/rates.html');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP — empty CA rates file'); return; }

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
// Source: https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf (PDF — harder)
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
    console.log(`  SKIP — could not fetch NY rates (${e.message})`);
    console.log('  Verify URL at: https://www.tax.ny.gov/bus/st/qrtrly_rate.htm');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP — empty NY rates file'); return; }

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
    console.log(`  SKIP — could not fetch IL rates (${e.message})`);
    console.log('  Verify URL at: https://tax.illinois.gov/research/taxinformation/sales/rot.html');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP — empty IL rates file'); return; }

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
    console.log(`  SKIP — could not fetch CO rates (${e.message})`);
    console.log('  Verify URL at: https://tax.colorado.gov/sales-use-tax-rates');
    return;
  }

  const records = parseDelimited(text, ',');
  if (!records.length) { console.log('  SKIP — empty CO rates file'); return; }

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
  supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log('=== TradeDesk Tax Rate Updater ===');
  console.log('Run date:', new Date().toISOString());
  console.log('');

  // Phase 1 — always runs (hardcoded data, never fails)
  await seedStateBaseRates();
  await seedFloridaCountyRates();

  // Phase 2 — SST member states (23 states) + Texas
  await updateSSTStates();
  await updateTexasRates();

  // Phase 3 — large non-SST states with DOR CSV files
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
