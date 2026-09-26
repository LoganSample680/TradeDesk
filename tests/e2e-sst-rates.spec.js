// @ts-check
// ── SALES TAX: THE COMBINED RATE, AND THE COUNTY FALLBACK ───────────────────
//
// 2026-09-25. 643 Kansas ZIPs read 4 to 5.4 percent in tax_rates when the real
// rate is 9 to 10. The SST import stored ONE jurisdiction's rate as if it were
// the whole rate and never added the 6.5 percent state rate. Separately, the
// monthly job had not refreshed a single SST state since June: it shelled out
// to `unzip`, the runner has none, and every state failed while the job stayed
// green.
//
// Part 1 runs scripts/sst-rates.js (pure, no network) against rows copied
// verbatim from the published KS files (KSR/KSB 2026Q4AUG19), so the numbers
// asserted are the ones the Kansas Department of Revenue publishes:
//   Topeka      6.5 state + 1.35 Shawnee + 1.5 Topeka          = 9.35
//   Berryton    6.5 state + 1.35 Shawnee (no city)             = 7.85
//   Lawrence    6.5 + 1.25 Douglas + 1.6 Lawrence + 2.0 CID    = 11.35
//
// Part 2 drives lookupSalesTaxRate in the app against a mocked td_tax_rate RPC:
// the ZIP row, the ZIP whose addresses straddle a city line, the county
// fallback (the county data), the state base, and the network failing.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { parseSSTRates, combineBoundaryRecord, createZipAggregator, countyRows } = require('../scripts/sst-rates');

const AS_OF = new Date('2026-09-25T12:00:00Z');

// Rate file rows, verbatim. Two dated rows for the state, Shawnee and Lawrence:
// only the one in force on AS_OF may count.
const RATES = [
  '20,45,20,0.06500,0.06500,0.06500,0.06500,20150701,20221231',
  '20,45,20,0.06500,0.06500,0.00000,0.00000,20230101,20991231',
  '20,00,177,0.01350,0.01350,0.01350,0.01350,20230401,20991231',
  '20,00,177,0.01150,0.01150,0.01150,0.01150,20051001,20230331',
  '20,01,71000,0.01500,0.01500,0.01500,0.01500,20091001,20991231',
  '20,00,045,0.01250,0.01250,0.01250,0.01250,20190401,20991231',
  '20,01,38900,0.01550,0.01550,0.01550,0.01550,20091001,20250331',
  '20,01,38900,0.01600,0.01600,0.01600,0.01600,20250401,20991231',
  '20,63,21215,0.02000,0.02000,0.02000,0.02000,20260101,20991231',
].join('\n');

const pad = (a) => a.concat(Array(Math.max(0, 89 - a.length)).fill(''));
// Boundary records, verbatim apart from trailing empty columns.
const TOPEKA   = 'A,20051001,20991231,3700,3716,E,SW,10TH,AVE,,,,,,TOPEKA,66604,1908,,,,,TOPSN,20,20,177,71000,,,,,,,';
const SHAWNEE  = 'A,20051001,20991231,9201,9299,O,SW,HAMERENS,ST,,,,,,TOPEKA,66604,1777,,,,,SHACO,20,20,177,,,,,,,,';
const BERRYTON = 'Z,20051001,20991231,,,,,,,,,,,,,,,66409,,66409,,SHACO,20,20,177,,,,,,,,';
const LAWRENCE = 'A,20260101,20991231,1130,1130,E,W,11TH,ST,,,,,,LAWRENCE,66044,3259,,,,,LAWC2,20,20,045,38900,,,,st,21215,63';
const rec = (line) => combineBoundaryRecord(pad(line.split(',')), parseSSTRates(RATES, AS_OF), AS_OF);
const total = (r) => Math.round((r.state_rate + r.local_rate) * 1000) / 1000;

test.describe('SST import: every rate is the combined rate', () => {

  test('the rate file keeps only the row in force on the day', () => {
    const r = parseSSTRates(RATES, AS_OF);
    expect(r['45:20']).toBe(6.5);
    expect(r['00:177']).toBe(1.35);     // not the 1.15 that expired 2023-03-31
    expect(r['01:38900']).toBe(1.6);    // not the 1.55 that expired 2025-03-31
    // Same code, different namespace: county 177 is not a city 177.
    expect(r['01:177']).toBeUndefined();
  });

  test('a Topeka address is state + county + city', () => {
    const r = rec(TOPEKA);
    expect(r.zip).toBe('66604');
    expect(r.state_rate).toBe(6.5);
    expect(total(r)).toBe(9.35);
  });

  test('an unincorporated Shawnee address is state + county, no city', () => {
    expect(total(rec(SHAWNEE))).toBe(7.85);
    expect(total(rec(BERRYTON))).toBe(7.85);
  });

  test('a special district (Lawrence CID) is added on top', () => {
    expect(total(rec(LAWRENCE))).toBe(11.35);
  });

  test('THE REGRESSION: no Kansas record can come out below the 6.5 state rate', () => {
    for (const line of [TOPEKA, SHAWNEE, BERRYTON, LAWRENCE]) {
      expect(total(rec(line))).toBeGreaterThanOrEqual(6.5);
    }
  });

  test('a record not in force, or with no state rate, produces nothing', () => {
    const expired = TOPEKA.replace('20051001,20991231', '20051001,20200101');
    expect(rec(expired)).toBeNull();
    const rates = parseSSTRates(RATES.split('\n').filter(l => !l.startsWith('20,45')).join('\n'), AS_OF);
    expect(combineBoundaryRecord(pad(TOPEKA.split(',')), rates, AS_OF)).toBeNull();
  });

  test('null, empty and malformed input never throw', () => {
    expect(parseSSTRates(null, AS_OF)).toEqual({});
    expect(parseSSTRates('', AS_OF)).toEqual({});
    expect(parseSSTRates('not,a,rate,file\n{{{', AS_OF)).toEqual({});
    const rates = parseSSTRates(RATES, AS_OF);
    expect(combineBoundaryRecord([], rates, AS_OF)).toBeNull();
    expect(combineBoundaryRecord(['X'], rates, AS_OF)).toBeNull();
    expect(combineBoundaryRecord(pad(TOPEKA.replace('66604', 'ABCDE').split(',')), rates, AS_OF)).toBeNull();
  });

  test('a ZIP that crosses a city line stores what most addresses pay, plus the range', () => {
    const agg = createZipAggregator();
    agg.add(rec(TOPEKA)); agg.add(rec(TOPEKA)); agg.add(rec(SHAWNEE));
    agg.add(null);
    const [row] = agg.zipRows('KS');
    expect(row.zip).toBe('66604');
    expect(row.state_rate + row.local_rate).toBeCloseTo(9.35, 4);
    expect(row.rate_low).toBe(7.85);
    expect(row.rate_high).toBe(9.35);
  });

  test('a ZIP range record covers every ZIP in the range (Indiana is one record)', () => {
    const rates = parseSSTRates('18,45,18,0.07,0.07,0.07,0.07,20080401,29991231', AS_OF);
    const z = combineBoundaryRecord(pad('Z,20050101,29991231,,,,,,,,,,,,,,,46001,,46005,,,18,18,,'.split(',')), rates, AS_OF);
    const agg = createZipAggregator(); agg.add(z);
    const rows = agg.zipRows('IN');
    expect(rows.map(r => r.zip)).toEqual(['46001', '46002', '46003', '46004', '46005']);
    expect(rows.every(r => r.state_rate === 7 && r.local_rate === 0)).toBe(true);
  });

  test('every county gets an outside-city-limits row keyed on its FIPS', () => {
    const rows = countyRows('KS', '20', parseSSTRates(RATES, AS_OF));
    const shawnee = rows.find(r => r.zip === 'COUNTY-20177');
    expect(shawnee.state_rate + shawnee.local_rate).toBeCloseTo(7.85, 4);
    expect(rows.find(r => r.zip === 'COUNTY-20045')).toBeTruthy();
    expect(rows.some(r => r.zip.startsWith('COUNTY-20') && r.zip.length !== 12)).toBe(false);
    expect(countyRows('KS', '20', {})).toEqual([]);
  });

  // The runner has no `unzip`. §7.1: the shell-out is gone, not merely unused.
  test('the updater unzips in Node and fails loudly when a state breaks', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'update-tax-rates.js'), 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/execFile/);
    expect(src).toMatch(/zlib\.inflateRawSync/);
    expect(src).toMatch(/process\.exitCode = 1/);
    expect(src).not.toMatch(/_processSSTCombinedCsv/);
    expect(src).toMatch(/require\('\.\/sst-rates'\)/);
  });

  test('the migration is additive and grants the lookup to the app', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261041_tax_rates_combined_county.sql'), 'utf8');
    expect(sql).toMatch(/add column if not exists rate_low/);
    expect(sql).toMatch(/add column if not exists rate_high/);
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).toMatch(/td_county_zips/);
    expect(sql).toMatch(/'COUNTY-' \|\| cz\.county_fips/);
    expect(sql).toMatch(/grant execute on function td_tax_rate\(text, text\) to anon, authenticated/);
  });
});

test.describe('lookupSalesTaxRate: ZIP, then county, then state', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // Swap in an rpc that answers td_tax_rate with `row` (or fails), run one
  // lookup, put the real client back. Returns the result and what was asked.
  const lookup = (zip, state, row, mode) => page.evaluate(async ({ zip, state, row, mode }) => {
    const orig = _supa.rpc;
    const calls = [];
    _supa.rpc = (fn, args) => {
      calls.push({ fn, args });
      if (mode === 'throw') return Promise.reject(new Error('network down'));
      if (mode === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: row ? [row] : [], error: null });
    };
    try { return { r: await lookupSalesTaxRate(zip, state), calls }; }
    finally { _supa.rpc = orig; }
  }, { zip, state, row, mode });

  test('a ZIP with one rate returns it with no warning', async () => {
    const { r, calls } = await lookup('66409', 'KS', { combined: '7.8500', rate_low: '7.85', rate_high: '7.85', source: 'db_zip' });
    expect(calls).toEqual([{ fn: 'td_tax_rate', args: { p_zip: '66409', p_state: 'KS' } }]);
    expect(r).toEqual({ rate: 7.85, source: 'db_zip' });
  });

  test('a ZIP that crosses a city line says so and gives the range', async () => {
    const { r } = await lookup('66604', 'KS', { combined: '9.3500', rate_low: '7.85', rate_high: '11.35', source: 'db_zip' });
    expect(r.rate).toBe(9.35);
    expect(r.low).toBe(7.85);
    expect(r.high).toBe(11.35);
    expect(r.warning).toContain('7.85% to 11.35%');
    expect(r.warning).toContain('city limits');
  });

  test('a ZIP with no row falls to the county the county data puts it in', async () => {
    const { r } = await lookup('66652', 'KS', { combined: '7.8500', source: 'db_county', county_name: 'Shawnee' });
    expect(r.rate).toBe(7.85);
    expect(r.source).toBe('db_county');
    expect(r.warning).toContain('Shawnee County');
  });

  test('no ZIP and no county falls to the state base', async () => {
    const { r } = await lookup('', 'KS', { combined: '6.5000', source: 'db_state' });
    expect(r.rate).toBe(6.5);
    expect(r.source).toBe('db_state');
    expect(r.warning).toContain('Kansas');
  });

  test('a malformed ZIP is not sent to the database', async () => {
    const { calls } = await lookup('6660', 'ks', { combined: '6.5', source: 'db_state' });
    expect(calls[0].args).toEqual({ p_zip: '', p_state: 'KS' });
  });

  test('an error, a throw or an empty answer all fall back to the hardcoded base', async () => {
    for (const [row, mode] of [[null, 'error'], [null, 'throw'], [null, 'ok']]) {
      const { r } = await lookup('66604', 'KS', row, mode);
      expect(r.source).toBe('hardcoded');
      expect(r.rate).toBe(6.5);
    }
  });

  test('a no-tax state never asks the database', async () => {
    const { r, calls } = await lookup('97401', 'OR', null, 'ok');
    expect(r).toEqual({ rate: 0, source: 'no_tax' });
    expect(calls).toEqual([]);
  });

  test('ten lookups at once all resolve', async () => {
    const n = await page.evaluate(async () => {
      const rs = await Promise.all(Array.from({ length: 10 }, () => lookupSalesTaxRate('66604', 'KS')));
      return rs.filter(r => r && typeof r.rate === 'number').length;
    });
    expect(n).toBe(10);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
