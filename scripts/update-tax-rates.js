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
const { execFile }  = require('child_process');

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

// Direct REST upsert with retry — avoids native fetch which fails on Proxmox TLS
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
  // Longer backoff for DNS failures — gives the resolver time to recover
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
// rather than guessing — SST changes naming conventions and publication dates unpredictably.

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

const MAX_RATE_FILE_MB = 30; // rate files are small; boundary files are streamed

async function _downloadAndExtract(fileEntry, destPath, stateDir) {
  await downloadFile(fileEntry.url, destPath);
  const isZip = fileEntry.name.toLowerCase().endsWith('.zip');
  if (isZip) {
    fs.mkdirSync(stateDir, { recursive: true });
    await unzipTo(destPath, stateDir);
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

  // If we have a separate boundary file — download both and join on jurisdiction code
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

  // No boundary file available — download rate file and attempt combined parse
  const rateCsvs = await _downloadAndExtract(rateEntry, ratePath, stateDir);
  process.stdout.write(`    → ${rateEntry.name}\n`);

  // Check if a single rate ZIP contained both boundary + rate CSVs
  if (rateCsvs.length >= 2) {
    const boundaryFile = rateCsvs.find(f => /boundary/i.test(path.basename(f)));
    const rateFile     = rateCsvs.find(f => !/boundary/i.test(path.basename(f)));
    if (boundaryFile && rateFile) return _processSSTFiles(st, boundaryFile, rateFile);
  }

  if (rateCsvs.length >= 1) return _processSSTCombinedCsv(st, rateCsvs[0]);
  throw new Error(`No CSVs extracted for ${st}`);
}

function _processSSTCombinedCsv(st, filePath) {
  const fSize = fs.statSync(filePath).size / (1024 * 1024);
  if (fSize > MAX_RATE_FILE_MB) {
    process.stdout.write(`[skip: rate-only ${fSize.toFixed(1)}MB > ${MAX_RATE_FILE_MB}MB] `);
    return [];
  }
  let text = fs.readFileSync(filePath, 'utf8');
  text = text.replace(/^﻿/, ''); // strip UTF-8 BOM
  const delim = text.slice(0, 500).includes('|') ? '|' : ',';
  const rows_raw = parseDelimited(text, delim);
  if (!rows_raw.length) return [];
  const col = (row, ...names) => {
    for (const n of names) {
      const k = Object.keys(row).find(k => k.toLowerCase().replace(/[_\s-]/g,'') === n.toLowerCase().replace(/[_\s-]/g,''));
      if (k !== undefined && row[k] !== undefined) return row[k];
    }
    return '';
  };
  const rows = [];
  const seen = new Set();
  for (const r of rows_raw) {
    const zip = (col(r,
      'ZIPCODE','ZIP5','ZIP','POSTALCODE','ZIPCODES','ZIPCD','ZIP_CODE','POSTAL'
    ) || '').replace(/\D/g, '').slice(0, 5);
    if (!zip || zip.length !== 5 || seen.has(zip)) continue;
    const stRate = parseFloat(col(r,
      'STATETAXRATE','STATERATE','STATE_RATE','STATESALESTAXRATE',
      'STATE_SALES_TAX_RATE','STATETAX','STRATE','STATRATE'
    )) || 0;
    const lcRate = parseFloat(col(r,
      'LOCALTAXRATE','LOCALRATE','LOCAL_RATE','LOCALSALESTAXRATE',
      'LOCAL_SALES_TAX_RATE','LOCALTAX','LCRATE','LOCALRATE'
    )) || 0;
    const combined = parseFloat(col(r,
      'COMBINEDTAXRATE','COMBINEDRATE','COMBINED_RATE','TOTALTAXRATE',
      'TOTAL_RATE','TOTALSALESTAXRATE','TOTAL_SALES_TAX_RATE','TOTALRATE','COMBINEDTOTAL'
    )) || (stRate + lcRate);
    seen.add(zip);
    rows.push({
      zip, state: st,
      state_rate: Math.round(stRate * 100 * 10000) / 10000,
      local_rate: Math.round((combined - stRate) * 100 * 10000) / 10000,
      source: `SST_${st}`, updated_at: new Date().toISOString(),
    });
  }
  if (!rows.length && rows_raw.length > 0) {
    process.stdout.write(`[cols: ${Object.keys(rows_raw[0]).join('|')}] `);
  }
  return rows;
}

async function _processSSTFiles(st, boundaryPath, ratePath) {
  const rSize = fs.statSync(ratePath).size / (1024 * 1024);
  if (rSize > MAX_RATE_FILE_MB) {
    process.stdout.write(`[skip: rate ${rSize.toFixed(1)}MB too large] `);
    return [];
  }

  // Rate file is small — load fully to build jCode → {state_rate, local_rate}
  let rText = fs.readFileSync(ratePath, 'utf8').replace(/^﻿/, '');
  const rDelim = rText.slice(0, 500).includes('|') ? '|' : ',';
  const rLines = rText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(l => l.trim());
  rText = null;

  if (!rLines.length) return [];

  // Build rate map keyed by jCode as integer string (no leading zeros) for fuzzy match
  const rateMap = {}; // key = parseInt(jCode).toString()

  const firstRField = rLines[0].split(rDelim)[0].replace(/["']/g, '').trim();
  if (!/^\d+$/.test(firstRField)) {
    // Has headers
    const parsed = parseDelimited(rLines.join('\n'), rDelim);
    const col = (row, ...names) => {
      for (const n of names) {
        const k = Object.keys(row).find(k => k.toLowerCase().replace(/[_\s-]/g,'') === n.toLowerCase().replace(/[_\s-]/g,''));
        if (k !== undefined && row[k] !== undefined) return row[k];
      }
      return '';
    };
    for (const r of parsed) {
      const jc = col(r,'JURISDICTIONCODE','COMPOSITESERCODE','JURISCD','JURCODE','SERIALIZEDCOMPOSITE','COMPOSITECODE');
      const stRate = parseFloat(col(r,'STATETAXRATE','GENERALRATESTATEPORTION','STATERATE','STATE_RATE')) || 0;
      const combined = parseFloat(col(r,'COMBINEDTAXRATE','GENERALRATE','COMBINEDRATE','TOTALRATE')) || stRate;
      const k = jc ? String(parseInt(jc, 10)) : null;
      if (k && k !== 'NaN') rateMap[k] = { state_rate: stRate * 100, local_rate: Math.max(0, combined - stRate) * 100 };
    }
  } else {
    // Headerless positional format. SST R files use two layouts:
    // Layout A (2-digit state FIPS first): stateFIPS|startDate|endDate|countyType|jCode|rate
    // Layout B (large serial first):       jSerial|startDate|endDate|stateFIPS|localType|rate
    // In both cases: find rate fields (0.0–0.2 with decimal), derive jCode from remaining cols.
    const jCodeCandidatesBySerial = {}; // for Layout B: serial → rate
    for (const line of rLines) {
      const fields = line.split(rDelim).map(f => f.replace(/["']/g, '').trim());
      const rateFields = fields.filter(f => {
        const v = parseFloat(f);
        return f.includes('.') && !isNaN(v) && v >= 0 && v <= 0.25;
      });
      // Skip lines with no rate
      if (!rateFields.length) continue;
      const total = rateFields.reduce((a,b) => a + parseFloat(b), 0);

      // Find all numeric non-date non-state-FIPS fields as candidate jCodes
      for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi];
        if (!/^\d+$/.test(f)) continue;          // must be all digits
        if (/^\d{8}$/.test(f)) continue;          // skip dates
        if (f.includes('.')) continue;            // skip rates
        const n = parseInt(f, 10);
        if (n < 1) continue;                      // skip zero
        const k = String(n);
        if (!rateMap[k]) {
          const stRate = rateFields.length >= 2 ? parseFloat(rateFields[0]) : 0;
          rateMap[k] = { state_rate: stRate * 100, local_rate: Math.max(0, total - stRate) * 100 };
        }
      }
    }
  }

  // Stream boundary file line-by-line — handles 300MB+ without OOM
  const rows = [];
  const seen = new Set();
  let bDelim = ',', lineCount = 0, bHasHeaders = false;
  let zipCol = -1, jCodeCol = -1;

  const rl = readline.createInterface({ input: fs.createReadStream(boundaryPath, { encoding: 'utf8' }), crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const line = lineCount === 0 ? rawLine.replace(/^﻿/, '') : rawLine;
    if (!line.trim()) { lineCount++; continue; }

    if (lineCount === 0) {
      bDelim = line.includes('|') ? '|' : ',';
      const f0 = line.split(bDelim)[0].replace(/["']/g, '').trim();
      bHasHeaders = !/^[A-Za-z0-9]{1}$/.test(f0) && !/^\d+$/.test(f0);
    }

    const fields = line.split(bDelim).map(f => f.replace(/["']/g, '').trim());

    if (lineCount === 0 && bHasHeaders) {
      const lower = fields.map(f => f.toLowerCase().replace(/[_\s-]/g,''));
      zipCol = lower.findIndex(h => ['zipcode','zip5','zip','postalcode'].includes(h));
      jCodeCol = lower.findIndex(h => ['compositesercode','jurisdictioncode','compositecode','serializedcomposite','juriscd'].includes(h));
      lineCount++;
      continue;
    }

    // Headerless SST boundary: detect record type from col 0
    // SST standard column layout (applies to both old and new format files):
    //   A-type (street address):  ZIP at col 15, jCode candidates at col 24 and col 25
    //   Z/z/4-type (ZIP range):   ZIP at col 17 (new) or col 14 (old), jCode at col 24
    if (!bHasHeaders) {
      const recType = fields[0].toLowerCase();
      if (recType === 'a') {
        // Street-level record
        zipCol = 15;
        // Try col 24, 25 as jCode candidates (col 24 = county juris code, col 25 = composite serial)
        const jc24 = fields[24] || '';
        const jc25 = fields[25] || '';
        const k24 = jc24 ? String(parseInt(jc24, 10)) : '';
        const k25 = jc25 ? String(parseInt(jc25, 10)) : '';
        const rEntry = (k24 && rateMap[k24]) || (k25 && rateMap[k25]);
        const zip = (fields[15] || '').replace(/\D/g,'').slice(0,5);
        if (zip && zip.length === 5 && !seen.has(zip) && rEntry) {
          seen.add(zip);
          rows.push({ zip, state: st, state_rate: Math.round(rEntry.state_rate*10000)/10000, local_rate: Math.round(rEntry.local_rate*10000)/10000, source:`SST_${st}`, updated_at: new Date().toISOString() });
        }
      } else if (recType === 'z' || recType === '4') {
        // ZIP-range record: ZIP at col 17 (new format) or col 14 (old format)
        const zip17 = (fields[17] || '').replace(/\D/g,'').slice(0,5);
        const zip14 = (fields[14] || '').replace(/\D/g,'').slice(0,5);
        const zip = /^\d{5}$/.test(zip17) ? zip17 : /^\d{5}$/.test(zip14) ? zip14 : '';
        if (zip && !seen.has(zip)) {
          const jc24 = fields[24] || '';
          const k24 = jc24 ? String(parseInt(jc24, 10)) : '';
          const rEntry = k24 && rateMap[k24];
          if (rEntry) {
            seen.add(zip);
            rows.push({ zip, state: st, state_rate: Math.round(rEntry.state_rate*10000)/10000, local_rate: Math.round(rEntry.local_rate*10000)/10000, source:`SST_${st}`, updated_at: new Date().toISOString() });
          }
        }
      }
    } else if (zipCol >= 0) {
      // Has headers — use detected column positions
      const zip = (fields[zipCol] || '').replace(/\D/g,'').slice(0,5);
      const jc = jCodeCol >= 0 ? (fields[jCodeCol] || '') : '';
      const k = jc ? String(parseInt(jc, 10)) : '';
      const rEntry = k && rateMap[k];
      if (zip && zip.length === 5 && !seen.has(zip) && rEntry) {
        seen.add(zip);
        rows.push({ zip, state: st, state_rate: Math.round(rEntry.state_rate*10000)/10000, local_rate: Math.round(rEntry.local_rate*10000)/10000, source:`SST_${st}`, updated_at: new Date().toISOString() });
      }
    }

    lineCount++;
  }

  if (!rows.length && lineCount > 5) {
    // Log what jCode candidates from B matched (or didn't) in rateMap for debugging
    const rKeys = Object.keys(rateMap).slice(0, 5).join(',');
    process.stdout.write(`[rateMap(${Object.keys(rateMap).length}):${rKeys}] `);
  }
  return rows;
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
      process.stdout.write(`SKIP — ${e.message}\n`);
      skipped.push(st);
    }
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`  SST complete: ${totalRows} ZIP rows across ${SST_STATES.length - skipped.length} states`);
  if (skipped.length) console.log(`  Skipped states (not found in SST directory): ${skipped.join(', ')}`);
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

  console.log('=== TradeDesk Tax Rate Updater ===');
  console.log('Run date:', new Date().toISOString());
  console.log('');

  // Phase 1 — always runs (hardcoded data, never fails)
  await seedStateBaseRates();
  await seedFloridaCountyRates();

  // Phase 2 — SST member states (23 states) + Texas
  await updateSSTStates();
  await updateTexasRates();

  // Phase 2.5 — Kansas KDOR hardcoded rates removed — KS is an SST member state and SST data
  // is authoritative. The hardcoded override was causing stale rates (e.g. Shawnee County
  // went 1.15% → 1.35% but hardcoded table wasn't updated). SST now wins for all KS ZIPs.

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
