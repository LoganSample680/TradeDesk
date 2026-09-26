'use strict';
// ── Streamlined Sales Tax (SST) rate + boundary parsing ─────────────────────
//
// Pure functions, no I/O, so the offline shard can run them against a real
// file slice (tests/e2e-sst-rates.spec.js). update-tax-rates.js does the
// downloading and the upserting.
//
// WHY THIS EXISTS (2026-09-25). The old parser treated each jurisdiction's rate
// as if it were the whole rate. SST publishes one rate per JURISDICTION (the
// state, the county, the city, each special district) and the boundary file
// says which of them cover an address. The tax on a job is their SUM. Reading
// only one of them put 643 Kansas ZIPs at 4 to 5.4 percent when the real rate
// is 9 to 10, because the 6.5 percent state rate was never added. It also took
// whichever dated row came first, so expired rates could win.
//
// Formats, read off the published KS files (KSR/KSB 2026Q4), not guessed:
//
// RATE file, headerless CSV:
//   0 state FIPS | 1 jurisdiction type | 2 jurisdiction code |
//   3 general rate intrastate | 4 general interstate | 5 food intrastate |
//   6 food interstate | 7 begin YYYYMMDD | 8 end YYYYMMDD
//   Types: 45 state, 00 county, 01 city, anything else a special district.
//   One jurisdiction has several dated rows; exactly one covers a given day.
//
// BOUNDARY file, headerless CSV, 89 columns:
//   0 record type: A (street range), 4 (ZIP+4 range), Z (whole ZIP)
//   1 begin | 2 end
//   15 ZIP (A records) | 17 ZIP low, 19 ZIP high (4 and Z records; Indiana
//   covers the whole state with one Z record, 46001 to 47997)
//   22 state FIPS | 24 county FIPS (3) | 25 place FIPS (5, blank = unincorporated)
//   29.. special districts in triplets: source, code, type (up to 20)

const SPECIAL_START = 29;
const SPECIAL_SLOTS = 20;

function _ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
}

function _covers(begin, end, day) {
  const b = parseInt(begin, 10), e = parseInt(end, 10);
  if (!(b > 0) || !(e > 0)) return false;
  return b <= day && day <= e;
}

// "type:code" → general intrastate rate as a percent, for the rows in force on
// `asOf`. Codes are kept as published strings: county "177" and city "71000"
// are different namespaces, and the type in the key keeps them apart.
function parseSSTRates(text, asOf) {
  const day = _ymd(asOf || new Date());
  const map = {};
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split(',').map(s => s.trim());
    if (f.length < 9) continue;
    if (!_covers(f[7], f[8], day)) continue;
    const rate = parseFloat(f[3]);
    if (!isFinite(rate) || rate < 0 || rate > 0.25) continue;
    map[f[1] + ':' + f[2]] = Math.round(rate * 100 * 10000) / 10000;
  }
  return map;
}

// One boundary record → {zip, state_rate, local_rate} in percent, or null when
// the record is not in force on `asOf` or names no state rate. A county, city or
// district the rate file does not list contributes nothing rather than failing
// the record: SST lists zero-rate cities (e.g. 01:00100 at 0.00000), so a
// missing one is also zero.
function combineBoundaryRecord(fields, rates, asOf) {
  const f = fields;
  const type = (f[0] || '').toUpperCase();
  if (type !== 'A' && type !== '4' && type !== 'Z') return null;
  if (!_covers(f[1], f[2], _ymd(asOf || new Date()))) return null;
  const zipRaw = type === 'A' ? f[15] : f[17];
  const zip = String(zipRaw || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) return null;
  let zipHigh = type === 'A' ? zip : String(f[19] || '').replace(/\D/g, '').slice(0, 5);
  if (zipHigh.length !== 5 || zipHigh < zip) zipHigh = zip;
  const stFips = String(f[22] || '').trim();
  const state = rates['45:' + stFips];
  if (state == null) return null;
  let local = 0;
  const county = String(f[24] || '').trim();
  if (county) local += rates['00:' + county] || 0;
  const place = String(f[25] || '').trim();
  if (place) local += rates['01:' + place] || 0;
  for (let s = 0; s < SPECIAL_SLOTS; s++) {
    const code = String(f[SPECIAL_START + s * 3 + 1] || '').trim();
    const t = String(f[SPECIAL_START + s * 3 + 2] || '').trim();
    if (code && t) local += rates[t + ':' + code] || 0;
  }
  return {
    zip, zipHigh,
    county_fips: stFips && county ? stFips + county : '',
    state_rate: state,
    local_rate: Math.round(local * 10000) / 10000,
  };
}

// A ZIP crosses city lines, so its records carry more than one combined rate.
// The row stores the rate most addresses in the ZIP pay (the one the most
// boundary records carry), plus the low and high so the app can say "check
// city limits" instead of quietly picking for the contractor.
function createZipAggregator() {
  const zips = new Map();
  return {
    add(rec) {
      if (!rec) return;
      const combined = Math.round((rec.state_rate + rec.local_rate) * 10000) / 10000;
      const lo = parseInt(rec.zip, 10), hi = parseInt(rec.zipHigh || rec.zip, 10);
      for (let n = lo; n <= hi; n++) {
        const zip = String(n).padStart(5, '0');
        let z = zips.get(zip);
        if (!z) { z = { counts: new Map(), parts: new Map() }; zips.set(zip, z); }
        z.counts.set(combined, (z.counts.get(combined) || 0) + 1);
        if (!z.parts.has(combined)) z.parts.set(combined, rec);
      }
    },
    zipRows(st) {
      const out = [];
      for (const [zip, z] of zips) {
        let best = null, bestN = -1;
        for (const [rate, n] of z.counts) {
          if (n > bestN || (n === bestN && rate > best)) { best = rate; bestN = n; }
        }
        const rates = [...z.counts.keys()];
        const rec = z.parts.get(best);
        out.push({
          zip, state: st,
          state_rate: rec.state_rate, local_rate: rec.local_rate,
          rate_low: Math.min(...rates), rate_high: Math.max(...rates),
        });
      }
      return out;
    },
  };
}

// The unincorporated rate for every county in the file: state plus county,
// no city. This is what an address outside city limits pays, and it is the
// honest fallback when a ZIP has no row of its own. Keyed "COUNTY-<5 digit
// FIPS>", the same FIPS td_county_zips and td_county_parcels carry.
function countyRows(st, stFips, rates) {
  const state = rates['45:' + stFips];
  if (state == null) return [];
  const out = [];
  for (const k of Object.keys(rates)) {
    if (!k.startsWith('00:')) continue;
    const county = k.slice(3);
    out.push({
      zip: 'COUNTY-' + stFips + county, state: st,
      state_rate: state, local_rate: rates[k],
      rate_low: null, rate_high: null,
    });
  }
  return out;
}

module.exports = { parseSSTRates, combineBoundaryRecord, createZipAggregator, countyRows };
