// @ts-check
/**
 * The NEC module: procedures over a dataset nobody has verified yet.
 *
 * THE THING THIS SPEC EXISTS TO PROVE, above everything else: the shipped
 * codes/nec-2023.json answers NOTHING. Every value in it is null, `verified`
 * is false, and codeEval refuses. A wrong ampacity on a permit is the worst
 * thing this product could ship, so the gate gets tested harder than the math.
 *
 * THE MATH still has to be proved, so this spec registers a FIXTURE edition
 * ('test-fixture') whose numbers are deliberately, obviously invented: 10 VA
 * per square foot, a 6 kW range demand, an ampacity of 300 on a 12 AWG. They
 * are round so the arithmetic is checkable by eye and absurd so nobody can
 * ever mistake them for the code. The fixture proves the PROCEDURE. Only the
 * Annex D vectors below can prove the VALUES, and they cannot run yet.
 *
 * WHY THE ANNEX D VECTORS ARE test.fixme. The correctness proof for a code
 * engine is the code's own published worked examples. Every source that
 * carries them (nfpa.org, the trade press, the inspector associations, even
 * ecfr.gov) is blocked by this environment's egress policy, so not one number
 * in Annex D could be read from a citable source. Encoding them from memory is
 * exactly the failure mode codes/README.md forbids: it would look right and be
 * wrong. So each vector is a named, skipped test saying precisely what a human
 * holding NEC 2023 has to type in to switch it on.
 *
 * What we verify:
 *  1. The unverified gate: every rule, every path, no value ever escapes
 *  2. The dataset ships with zero numbers in it and a todo list that names
 *     every table a human still owes
 *  3. Each rule's procedure, against the fixture edition
 *  4. Refusals are specific: missing-data names the path, bad-input names the
 *     field, out-of-range and unsupported mean what they say
 *  5. The §11.1 input classes on every rule: null, empty, boundary, type
 *     mismatch, concurrent, post-error
 *  6. Purity: same in, same out, no mutation of the dataset, no DOM
 */

const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'codes', 'nec-2023.json'), 'utf8'));

const RULE_IDS = ['dwelling-load', 'conductor-ampacity', 'voltage-drop', 'conduit-fill', 'box-fill'];

const FIX = 'test-fixture';

// ── The fixture edition ─────────────────────────────────────────────────────
//
// INVENTED NUMBERS. Not the NEC, not close to the NEC, on purpose. Round so
// the expected answers below can be checked in your head; wrong so that a
// copy-paste into codes/ would be caught immediately by anyone who has held
// the book. This object must never be treated as a source for anything.
const FIXTURE = {
  family: 'nec',
  edition: FIX,
  verified: true,
  verifiedBy: 'test fixture, invented numbers',
  verifiedAt: '2026-09-07',
  sources: {},
  todo: [],
  data: {
    dwelling: {
      generalLightingVaPerSqft: 10,
      smallApplianceCircuitVa: 1000,
      smallApplianceCircuitsMin: 2,
      laundryCircuitVa: 500,
      laundryCircuitsMin: 1,
      generalDemandRows: [
        { uptoVa: 5000, pct: 100 },
        { uptoVa: null, pct: 50 }
      ],
      fixedAppliance: { triggerCount: 4, pct: 80 },
      dryer: {
        minVa: 1000,
        demandRows: [{ count: 1, pct: 100 }, { countFrom: 2, countTo: null, pct: 50 }]
      },
      cooking: {
        colARows: [{ count: 1, pct: 80 }],
        colBRows: [{ count: 1, pct: 90 }],
        colCRows: [{ count: 1, kw: 6 }, { countFrom: 2, countTo: 5, kwBase: 8, kwPerUnit: 1, countOver: 1 }],
        colALimitKw: 2,
        colBLimitKw: 5,
        colCLimitKw: 10,
        colCMaxKw: 20,
        note1: { perKwPct: 10 }
      },
      heatPct: 100,
      acPct: 100,
      largestMotorPct: 25,
      optional: {
        minServiceAmps: 100,
        generalFirstVa: 8000,
        generalFirstPct: 100,
        generalRemainderPct: 50,
        hvacPct: {
          ac: 50, heatPumpWithSupplemental: 60, heatPumpNoSupplemental: 70,
          spaceHeatUnder: 80, spaceHeatAtOrOver: 90, centralSpaceHeat: 100
        },
        heatUnitThreshold: 4
      },
      serviceMinAmps: 60
    },

    standardOcpdAmps: [50, 100, 150, 200, 400],
    smallConductorMaxOcpd: { cu: { '12': 20 }, al: {} },
    continuousPct: 125,

    ampacity: {
      cu: {
        '14': { '60': 50, '75': 100, '90': 150 },
        '12': { '60': 100, '75': 200, '90': 300 },
        '10': { '60': null, '75': null, '90': null }
      },
      al: { '12': { '60': 50, '75': 100, '90': 150 } }
    },
    ampacityBaseAmbientC: 30,
    tempCorrectionRows: [
      { minC: null, maxC: 30, f60: 1, f75: 1, f90: 1 },
      { minC: 31, maxC: 40, f60: 0.5, f75: 0.5, f90: 0.5 }
    ],
    adjustmentRows: [
      { countFrom: 4, countTo: 6, pct: 80 },
      { countFrom: 7, countTo: 9, pct: 70 }
    ],
    terminationDefaultC: 75,
    terminationSplitAmps: 100,

    conductorProps: {
      cu: {
        '12': { circularMils: 1000, dcOhmsPerKft: 4, acOhmsPerKftPvc: 2, acOhmsPerKftAlum: 3, acOhmsPerKftSteel: 5 },
        '10': { circularMils: null, dcOhmsPerKft: null, acOhmsPerKftPvc: null, acOhmsPerKftAlum: null, acOhmsPerKftSteel: null }
      },
      al: { '12': { circularMils: 1000, dcOhmsPerKft: 8, acOhmsPerKftPvc: 4, acOhmsPerKftAlum: 6, acOhmsPerKftSteel: 10 } }
    },
    conductorAreaSqIn: {
      'thhn-thwn-2': { '12': 0.01, '10': 0.02, '8': null },
      'xhhw-2': { '12': 0.02 }
    },
    conduitArea: {
      emt: {
        '1/2': { totalSqIn: 1, over2SqIn: 0.4, twoSqIn: 0.31, oneSqIn: 0.53, nippleSqIn: 0.6 },
        '3/4': { totalSqIn: 2, over2SqIn: 0.8, twoSqIn: 0.62, oneSqIn: 1.06, nippleSqIn: 1.2 },
        '1': { totalSqIn: 4, over2SqIn: 1.6, twoSqIn: 1.24, oneSqIn: 2.12, nippleSqIn: 2.4 }
      },
      // No printed columns at all: forces the computed fallback path.
      pvc40: {
        '1/2': { totalSqIn: 2, over2SqIn: null, twoSqIn: null, oneSqIn: null, nippleSqIn: null }
      },
      // Nothing usable at all: forces missing-data.
      rmc: { '1/2': { totalSqIn: null, over2SqIn: null, twoSqIn: null, oneSqIn: null, nippleSqIn: null } }
    },
    fillPct: { one: 53, two: 31, overTwo: 40, nipple: 60 },

    boxVolumeAllowanceCuIn: { '14': 2, '12': 3, '10': 4, '8': null },
    boxDeviceMultiplier: 2,
    boxVolumeCuIn: { 'device-3x2x2': 20, 'square-4x1.5': null },

    voltageDropAdviceBranchPct: 3,
    voltageDropAdviceTotalPct: 5
  }
};

test.describe('NEC code module', () => {
  let page;

  /** codeEval through the engine, which is the only supported way in. */
  const ev = (rule, inputs, edition) => page.evaluate(
    ({ rule: r, inputs: i, edition: e }) => codeEval('nec', r, i, e ? { edition: e } : undefined),
    { rule, inputs, edition }
  );

  /** The fixture edition. */
  const fx = (rule, inputs) => ev(rule, inputs, FIX);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });

    // The spec installs whichever of the two files index.html is not carrying
    // yet, and only those. Injecting one index.html already loaded redeclares
    // its top-level consts and throws a SyntaxError into the page, which is
    // exactly what happened the first time this ran. __necNoAutoLoad keeps
    // registration explicit: several tests below care about the exact moment
    // the dataset lands.
    await page.evaluate(() => { window.__necNoAutoLoad = true; });
    if (!await page.evaluate(() => typeof window.codeEval === 'function')) {
      await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'code-engine.js') });
    }
    if (!await page.evaluate(() => typeof window.necRegisterDataset === 'function')) {
      await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'code-nec.js') });
    }
    await page.evaluate((f) => { window.necRegisterDataset(f); }, FIXTURE);
    await page.evaluate((j) => { window.necRegisterDataset(j); }, SHIPPED);
    await page.evaluate(() => { S.codeEditions = { nec: '2023' }; });
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The gate. Nothing unverified ever reaches a result ─────────────────

  test('every rule refuses on the shipped 2023 dataset, with no value', async () => {
    for (const rule of RULE_IDS) {
      const r = await ev(rule, { sqft: 2000, size: '12', amps: 20, lengthFt: 100, conduit: 'emt', conductors: [{ size: '12', count: 4 }] }, '2023');
      expect(r.ok, rule + ' must refuse').toBe(false);
      expect(r.reason, rule).toBe('unverified');
      expect(r.value, rule + ' must carry no number at all').toBe(null);
      expect(r.edition).toBe('2023');
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  test('the account edition is what gets refused, not just an explicit one', async () => {
    // S.codeEditions says 2023, so a caller who passes no opts still hits the gate.
    const r = await ev('dwelling-load', { sqft: 2000 }, null);
    expect(r.reason).toBe('unverified');
    expect(r.edition).toBe('2023');
  });

  test('no edition confirmed means no answer, and it says so', async () => {
    const r = await page.evaluate(() => {
      const keep = S.codeEditions; S.codeEditions = null;
      const out = codeEval('nec', 'dwelling-load', { sqft: 2000 });
      S.codeEditions = keep;
      return out;
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-edition');
    expect(r.value).toBe(null);
  });

  test('an edition we do not have is no-dataset, an unknown rule is no-rule', async () => {
    const a = await ev('dwelling-load', { sqft: 2000 }, '1999');
    expect(a.reason).toBe('no-dataset');
    const b = await ev('grounding-electrode', { sqft: 2000 }, FIX);
    expect(b.reason).toBe('no-rule');
    expect(b.value).toBe(null);
  });

  test('verified is the file\'s own boolean: a truthy string does not open the gate', async () => {
    const r = await page.evaluate(() => {
      necRegisterDataset({ family: 'nec', edition: 'sneaky', verified: 'yes', data: { dwelling: {} } });
      return { flag: codeSet('nec', 'sneaky').verified, out: codeEval('nec', 'dwelling-load', { sqft: 100 }, { edition: 'sneaky' }) };
    });
    expect(r.flag).toBe(false);
    expect(r.out.reason).toBe('unverified');
  });

  test('necRegisterDataset refuses anything that is not a NEC edition file', async () => {
    const r = await page.evaluate(() => ({
      nothing: necRegisterDataset(null),
      wrongFamily: necRegisterDataset({ family: 'ipc', edition: '2021' }),
      noEdition: necRegisterDataset({ family: 'nec' }),
      notAnObject: necRegisterDataset('nec-2023')
    }));
    expect(r).toEqual({ nothing: false, wrongFamily: false, noEdition: false, notAnObject: false });
  });

  test('necLoadCodes fetches the real file and registers it, still unverified', async () => {
    const r = await page.evaluate(async () => {
      const ok = await necLoadCodes('codes/nec-2023.json');
      const set = codeSet('nec', '2023');
      return { ok, verified: set.verified, todo: set.todo.length };
    });
    expect(r.ok).toBe(true);
    expect(r.verified, 'loading it must never flip the flag').toBe(false);
    expect(r.todo).toBeGreaterThan(0);
  });

  test('necLoadCodes on a missing file returns false and does not throw', async () => {
    const r = await page.evaluate(() => necLoadCodes('codes/no-such-edition-9999.json'));
    expect(r).toBe(false);
  });

  // ── 2. The shipped dataset holds no numbers, and says what it owes ────────

  test('codes/nec-2023.json ships unverified, unsigned and undated', () => {
    expect(SHIPPED.family).toBe('nec');
    expect(SHIPPED.edition).toBe('2023');
    expect(SHIPPED.verified).toBe(false);
    expect(SHIPPED.verifiedBy).toBe('');
    expect(SHIPPED.verifiedAt).toBe('');
  });

  test('not one numeric value exists anywhere in the shipped dataset', () => {
    const found = [];
    (function walk(o, p) {
      if (o === null) return;
      if (typeof o === 'number') { found.push(p + ' = ' + o); return; }
      if (Array.isArray(o)) { o.forEach((v, i) => walk(v, p + '[' + i + ']')); return; }
      if (typeof o === 'object') { Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k)); }
    })(SHIPPED.data, '');
    expect(found, 'an LLM may not author these values, see codes/README.md').toEqual([]);
  });

  test('every table a human still owes is named in todo, and sources is empty', () => {
    const todo = SHIPPED.todo.join('\n');
    for (const section of ['220.41', '220.52', 'Table 220.45', '220.53', '220.54', 'Table 220.55',
      '220.82', '230.79(C)', '240.6(A)', '240.4(D)', 'Table 310.16', 'Table 310.15(B)(1)',
      'Table 310.15(C)(1)', '110.14(C)', 'Table 8', 'Table 9', 'Table 5', 'Table 4',
      'Table 1', 'Table 314.16(B)', 'Table 314.16(A)']) {
      expect(todo, section + ' must be named as outstanding work').toContain(section);
    }
    expect(Object.keys(SHIPPED.sources), 'nothing was citable, so nothing is cited').toEqual([]);
  });

  test('every key the rules read exists in the shipped shape, so the todo list is complete', async () => {
    // A rule asking for a path the file does not even have would refuse with a
    // message nobody could act on. Walk the shipped data and confirm the
    // top-level groups every rule names are all present.
    const keys = Object.keys(SHIPPED.data);
    for (const k of ['dwelling', 'standardOcpdAmps', 'smallConductorMaxOcpd', 'ampacity',
      'ampacityBaseAmbientC', 'tempCorrectionRows', 'adjustmentRows', 'terminationDefaultC',
      'conductorProps', 'conductorAreaSqIn', 'conduitArea', 'fillPct',
      'boxVolumeAllowanceCuIn', 'boxDeviceMultiplier', 'boxVolumeCuIn',
      'voltageDropAdviceBranchPct', 'voltageDropAdviceTotalPct']) {
      expect(keys, k).toContain(k);
    }
  });

  test('a half-filled dataset refuses by naming the exact path, not by guessing', async () => {
    const r = await page.evaluate(() => {
      const half = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      half.dwelling.generalLightingVaPerSqft = null;
      necRegisterDataset({ family: 'nec', edition: 'half', verified: true, data: half });
      return codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'half' });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-data');
    expect(r.value).toBe(null);
    expect(r.warnings[0]).toContain('dwelling.generalLightingVaPerSqft');
  });

  test('an empty band table is as unusable as a null one', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      d.dwelling.generalDemandRows = [];
      necRegisterDataset({ family: 'nec', edition: 'emptyrows', verified: true, data: d });
      return codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'emptyrows' });
    });
    expect(r.reason).toBe('missing-data');
    expect(r.warnings[0]).toContain('generalDemandRows');
  });

  test('a band table that does not ascend refuses as bad-data rather than under-calculating', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      d.dwelling.generalDemandRows = [{ uptoVa: null, pct: 50 }, { uptoVa: 5000, pct: 100 }];
      necRegisterDataset({ family: 'nec', edition: 'badrows', verified: true, data: d });
      return codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'badrows' });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-data');
    expect(r.value).toBe(null);
  });

  test('a bad band table is bad for every load, not just a big one', async () => {
    // Regression. The first version validated the rows as it consumed them and
    // stopped early once the load was covered, so an out-of-order table was
    // caught for a large dwelling and silently under-calculated a small one.
    // An undersized service is the exact failure this module exists to stop.
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      d.dwelling.generalDemandRows = [{ uptoVa: null, pct: 50 }, { uptoVa: 5000, pct: 100 }];
      necRegisterDataset({ family: 'nec', edition: 'badrows2', verified: true, data: d });
      return [10, 1000, 100000].map(sqft => codeEval('nec', 'dwelling-load', { sqft }, { edition: 'badrows2' }));
    });
    for (const one of r) {
      expect(one.ok).toBe(false);
      expect(one.reason).toBe('bad-data');
      expect(one.value).toBe(null);
    }
  });

  test('a band table with no open top band refuses rather than running out under a load', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      d.dwelling.generalDemandRows = [{ uptoVa: 5000, pct: 100 }, { uptoVa: 9000, pct: 50 }];
      necRegisterDataset({ family: 'nec', edition: 'nocap', verified: true, data: d });
      return { small: codeEval('nec', 'dwelling-load', { sqft: 10 }, { edition: 'nocap' }), big: codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'nocap' }) };
    });
    expect(r.small.reason, 'the table is unusable regardless of how small the load is').toBe('bad-data');
    expect(r.big.reason).toBe('bad-data');
  });

  // ── 3. dwelling-load, the flagship ────────────────────────────────────────
  //
  // Fixture arithmetic, all of it checkable by eye:
  //   1000 sq ft x 10 VA          = 10,000
  //   2 small appliance x 1000    =  2,000
  //   1 laundry x 500             =    500
  //                        total  = 12,500
  //   band: 5,000 at 100% + 7,500 at 50% = 8,750 VA
  //   8,750 / 240 V = 36.5 A -> next standard 50 A -> floor 60 A

  test('standard method: area, small appliance and laundry, banded', async () => {
    const r = await fx('dwelling-load', { sqft: 1000 });
    expect(r.ok).toBe(true);
    expect(r.value.calculatedVa).toBe(8750);
    expect(r.value.calculatedAmps).toBe(36.5);
    expect(r.value.serviceAmps, 'the dwelling floor beats the 50 A the math wanted').toBe(60);
    expect(r.unit).toBe('A');
    expect(r.cite).toContain('220');
    expect(r.value.breakdown[0].cite).toContain('Table 220.45');
  });

  test('every default it applied is listed, by key, in assumed', async () => {
    const r = await fx('dwelling-load', { sqft: 1000 });
    const keys = r.assumed.map(a => a.key);
    expect(keys).toContain('method');
    expect(keys).toContain('volts');
    expect(keys).toContain('smallApplianceCircuits');
    expect(keys).toContain('laundryCircuits');
    for (const a of r.assumed) {
      expect(a.value, a.key + ' must carry the value that was applied').not.toBe(undefined);
      expect(String(a.label).length, a.key + ' must be printable').toBeGreaterThan(0);
    }
  });

  test('the items it returns are lines, never prices', async () => {
    const r = await fx('dwelling-load', { sqft: 1000 });
    expect(r.items.length).toBe(1);
    expect(r.items[0].label).toContain('60 A');
    expect(r.items[0].qty).toBe(1);
    expect(r.items[0].unit).toBe('ea');
    expect(r.items[0].why).toContain('VA');
    expect(Object.keys(r.items[0]).sort()).toEqual(['label', 'qty', 'unit', 'why']);
  });

  test('a supplied circuit count is used, and one below the code minimum is raised', async () => {
    const more = await fx('dwelling-load', { sqft: 1000, smallApplianceCircuits: 4 });
    // 10,000 + 4,000 + 500 = 14,500 -> 5,000 + 9,500 x 50% = 9,750
    expect(more.value.calculatedVa).toBe(9750);
    expect(more.assumed.map(a => a.key)).not.toContain('smallApplianceCircuits');

    const under = await fx('dwelling-load', { sqft: 1000, smallApplianceCircuits: 1 });
    expect(under.value.calculatedVa, 'raised back to the minimum of 2').toBe(8750);
    expect(under.assumed.find(a => a.key === 'smallApplianceCircuits').value).toBe(2);
  });

  test('a range inside column C takes the column C demand, not its nameplate', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, rangeKw: 8 });
    // column C, one appliance = 6 kW, not the 8 kW nameplate
    expect(r.value.calculatedVa).toBe(8750 + 6000);
    expect(r.value.breakdown.find(b => b.label === 'Cooking appliances').cite).toBe('Table 220.55');
  });

  test('two ranges use the count row, not twice the one-range demand', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, ranges: [{ kw: 8 }, { kw: 8 }] });
    // {countFrom:2, kwBase:8, kwPerUnit:1, countOver:1} -> 8 + 1 x (2-1) = 9 kW
    expect(r.value.calculatedVa).toBe(8750 + 9000);
  });

  test('a range above the column C limit gets the note 1 step, by major fraction', async () => {
    const exact = await fx('dwelling-load', { sqft: 1000, rangeKw: 15 });
    // 5 kW over the 10 kW limit, 10% each -> 6 kW x 1.5 = 9 kW
    expect(exact.value.calculatedVa).toBe(8750 + 9000);

    const half = await fx('dwelling-load', { sqft: 1000, rangeKw: 12.5 });
    // exactly half a kW is not a MAJOR fraction, so 2 steps, not 3
    expect(half.value.calculatedVa).toBe(8750 + 6000 * 1.2);

    const over = await fx('dwelling-load', { sqft: 1000, rangeKw: 12.6 });
    expect(over.value.calculatedVa).toBe(8750 + 6000 * 1.3);
  });

  test('a range off the top of the table refuses instead of extrapolating', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, rangeKw: 25 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-range');
    expect(r.value).toBe(null);
  });

  test('unequal large ranges are note 2 territory and we say we do not do it', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, ranges: [{ kw: 15 }, { kw: 12 }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported');
    expect(r.warnings[0]).toContain('Note 2');
  });

  test('small ranges take the column A or column B percentage of nameplate', async () => {
    const a = await fx('dwelling-load', { sqft: 1000, rangeKw: 1.5 });
    expect(a.value.calculatedVa).toBe(8750 + 1500 * 0.8);
    const b = await fx('dwelling-load', { sqft: 1000, rangeKw: 4 });
    expect(b.value.calculatedVa).toBe(8750 + 4000 * 0.9);
  });

  test('a dryer below the code minimum is raised to it, and two dryers get the count factor', async () => {
    const small = await fx('dwelling-load', { sqft: 1000, dryerVa: 500 });
    expect(small.value.calculatedVa, 'the 1000 VA floor, not the 500 VA nameplate').toBe(8750 + 1000);
    const one = await fx('dwelling-load', { sqft: 1000, dryerVa: 4000 });
    expect(one.value.calculatedVa).toBe(8750 + 4000);
    const two = await fx('dwelling-load', { sqft: 1000, dryers: [{ va: 4000 }, { va: 4000 }] });
    expect(two.value.calculatedVa, '8000 at 50%').toBe(8750 + 4000);
  });

  test('the four-or-more rule on fastened-in-place appliances', async () => {
    const three = await fx('dwelling-load', { sqft: 1000, appliances: [1, 2, 3].map(i => ({ label: 'A' + i, va: 1000 })) });
    expect(three.value.calculatedVa, 'three appliances get no demand factor').toBe(8750 + 3000);
    const four = await fx('dwelling-load', { sqft: 1000, appliances: [1, 2, 3, 4].map(i => ({ label: 'A' + i, va: 1000 })) });
    expect(four.value.calculatedVa, 'four trips the factor').toBe(8750 + 4000 * 0.8);
  });

  test('heat and cooling are noncoincident: only the larger one counts', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, hvac: { spaceHeatVa: 9000, acVa: 3000 } });
    expect(r.value.calculatedVa).toBe(8750 + 9000);
    const flip = await fx('dwelling-load', { sqft: 1000, hvac: { spaceHeatVa: 1000, acVa: 3000 } });
    expect(flip.value.calculatedVa).toBe(8750 + 3000);
    expect(flip.value.breakdown.find(b => b.cite === '220.60').label).toContain('Air conditioning');
  });

  test('the largest motor uplift lands on top of the motors themselves', async () => {
    const r = await fx('dwelling-load', {
      sqft: 1000,
      appliances: [{ label: 'Pump', va: 1000, kind: 'motor' }, { label: 'Compressor', va: 2000, kind: 'motor' }]
    });
    expect(r.value.calculatedVa).toBe(8750 + 3000 + 500);
    expect(r.value.breakdown.find(b => b.cite === '430.24').va).toBe(500);
  });

  test('optional method bands the whole nameplate pile once', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, method: 'optional' });
    // 12,500 nameplate -> 8,000 at 100% + 4,500 at 50% = 10,250
    expect(r.value.calculatedVa).toBe(10250);
    expect(r.inputs.method).toBe('optional');
    expect(r.warnings.join(' ')).toContain('120/240');
  });

  test('optional method gives the range and dryer no separate demand factor', async () => {
    const r = await fx('dwelling-load', { sqft: 1000, method: 'optional', rangeKw: 12, dryerVa: 5000 });
    // nameplate 12,500 + 12,000 + 5,000 = 29,500 -> 8,000 + 21,500 x 50% = 18,750
    expect(r.value.calculatedVa).toBe(18750);
  });

  test('optional method takes the largest of the six heating and cooling selections', async () => {
    const r = await fx('dwelling-load', {
      sqft: 1000, method: 'optional',
      hvac: { acVa: 10000, spaceHeatVa: 10000, spaceHeatUnits: 2 }
    });
    // ac 10,000 x 50% = 5,000 against space heat 10,000 x 80% = 8,000
    expect(r.value.calculatedVa).toBe(10250 + 8000);
    expect(r.value.breakdown[1].label).toContain('Electric space heating');
  });

  test('the space heating unit threshold picks a different percentage', async () => {
    const few = await fx('dwelling-load', { sqft: 1000, method: 'optional', hvac: { spaceHeatVa: 10000, spaceHeatUnits: 3 } });
    expect(few.value.calculatedVa).toBe(10250 + 8000);
    const many = await fx('dwelling-load', { sqft: 1000, method: 'optional', hvac: { spaceHeatVa: 10000, spaceHeatUnits: 4 } });
    expect(many.value.calculatedVa).toBe(10250 + 9000);
  });

  test('a heat pump with supplemental heat is one selection, without is another', async () => {
    const withSup = await fx('dwelling-load', { sqft: 1000, method: 'optional', hvac: { heatPumpVa: 5000, supplementalHeatVa: 5000 } });
    expect(withSup.value.calculatedVa).toBe(10250 + 10000 * 0.6);
    const noSup = await fx('dwelling-load', { sqft: 1000, method: 'optional', hvac: { heatPumpVa: 5000 } });
    expect(noSup.value.calculatedVa).toBe(10250 + 5000 * 0.7);
  });

  test('a load past the largest standard device refuses rather than inventing a service', async () => {
    const r = await fx('dwelling-load', { sqft: 100000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-range');
    expect(r.value).toBe(null);
  });

  // ── 4. conductor-ampacity ─────────────────────────────────────────────────

  test('base ampacity with no correction and no adjustment, capped by the terminations', async () => {
    const r = await fx('conductor-ampacity', { size: '12', material: 'cu', insulationC: 90 });
    expect(r.value.baseAmps).toBe(300);
    expect(r.value.tempFactor).toBe(1);
    expect(r.value.adjustPct).toBe(100);
    expect(r.value.correctedAmps).toBe(300);
    expect(r.value.terminationLimitAmps, 'the 75 C column').toBe(200);
    expect(r.value.allowedAmps, '110.14(C) is what actually decides it').toBe(200);
    expect(r.warnings.join(' ')).toContain('110.14(C)');
  });

  test('ambient correction and conductor count adjustment both apply', async () => {
    const r = await fx('conductor-ampacity', { size: '12', material: 'cu', insulationC: 90, ambientC: 35, currentCarrying: 5 });
    expect(r.value.tempFactor).toBe(0.5);
    expect(r.value.adjustPct).toBe(80);
    expect(r.value.correctedAmps, '300 x 0.5 x 0.8').toBe(120);
    expect(r.value.allowedAmps, 'now the conductor limits it, not the terminal').toBe(120);
  });

  test('three or fewer conductors is no adjustment at all', async () => {
    for (const n of [1, 2, 3]) {
      const r = await fx('conductor-ampacity', { size: '12', insulationC: 90, currentCarrying: n });
      expect(r.value.adjustPct, n + ' conductors').toBe(100);
    }
  });

  test('an ambient nobody tabulated is out-of-range, not an extrapolation', async () => {
    const r = await fx('conductor-ampacity', { size: '12', insulationC: 90, ambientC: 95 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-range');
    expect(r.value).toBe(null);
  });

  test('a conductor count off the top of the adjustment table is out-of-range', async () => {
    const r = await fx('conductor-ampacity', { size: '12', insulationC: 90, currentCarrying: 40 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-range');
  });

  test('240.4(D) is reported for a small conductor even though it is not an ampacity', async () => {
    const r = await fx('conductor-ampacity', { size: '12', material: 'cu', insulationC: 90 });
    expect(r.value.maxOcpdAmps).toBe(20);
    expect(r.warnings.join(' ')).toContain('240.4(D)');
    const big = await fx('conductor-ampacity', { size: '14', material: 'cu', insulationC: 90 });
    expect(big.value.maxOcpdAmps, 'nothing tabulated for this one in the fixture').toBe(null);
  });

  test('a size the table does not have is a bad input, a size with a null cell is missing data', async () => {
    const nope = await fx('conductor-ampacity', { size: '4/0', insulationC: 90 });
    expect(nope.reason).toBe('bad-input');
    const empty = await fx('conductor-ampacity', { size: '10', insulationC: 90 });
    expect(empty.reason).toBe('missing-data');
    expect(empty.warnings[0]).toContain('ampacity.cu.10.90');
  });

  test('material and insulation defaults are recorded, never silent', async () => {
    const r = await fx('conductor-ampacity', { size: '12' });
    const keys = r.assumed.map(a => a.key);
    expect(keys).toContain('material');
    expect(keys).toContain('insulationC');
    expect(keys).toContain('ambientC');
    expect(keys).toContain('currentCarrying');
    expect(keys).toContain('terminationC');
  });

  test('a length turns the answer into a line the job can use', async () => {
    const r = await fx('conductor-ampacity', { size: '12', insulationC: 90, lengthFt: 120, conductorsPerRun: 3 });
    expect(r.items[0]).toEqual({
      label: '12 CU conductor, 90 C', qty: 360, unit: 'ft', why: '120 ft run, 3 conductors'
    });
  });

  // ── 5. voltage-drop ───────────────────────────────────────────────────────

  test('single phase drop is the two-way run', async () => {
    const r = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '12', material: 'cu', volts: 240 });
    // 2 x 20 A x 0.002 ohm/ft x 100 ft = 8 V
    expect(r.value.dropVolts).toBe(8);
    expect(r.value.percent).toBe(3.33);
    expect(r.value.endVolts).toBe(232);
    expect(r.value.ohmsPerKft).toBe(2);
  });

  test('three phase uses the root-three form', async () => {
    const r = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '12', phase: 3, volts: 208 });
    expect(r.value.dropVolts).toBe(6.93);
  });

  test('parallel sets split the drop', async () => {
    const r = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '12', volts: 240, parallelSets: 2 });
    expect(r.value.dropVolts).toBe(4);
  });

  test('the raceway metal picks a different impedance column', async () => {
    const pvc = await fx('voltage-drop', { amps: 10, lengthFt: 100, size: '12', volts: 240, raceway: 'pvc' });
    const steel = await fx('voltage-drop', { amps: 10, lengthFt: 100, size: '12', volts: 240, raceway: 'steel' });
    const dc = await fx('voltage-drop', { amps: 10, lengthFt: 100, size: '12', volts: 240, resistance: 'dc' });
    expect(pvc.value.ohmsPerKft).toBe(2);
    expect(steel.value.ohmsPerKft).toBe(5);
    expect(dc.value.ohmsPerKft).toBe(4);
  });

  test('it always says voltage drop is advice, not a code requirement', async () => {
    const r = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '12', volts: 240 });
    expect(r.warnings.join(' ')).toContain('Informational Note');
    expect(r.value.adviceMaxPct).toBe(3);
    expect(r.value.withinAdvice, '3.33% is past the 3% advice').toBe(false);
    const scoped = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '12', volts: 240, scope: 'feeder-and-branch' });
    expect(scoped.value.adviceMaxPct).toBe(5);
    expect(scoped.value.withinAdvice).toBe(true);
  });

  test('a size with no impedance typed in yet refuses by path', async () => {
    const r = await fx('voltage-drop', { amps: 20, lengthFt: 100, size: '10' });
    expect(r.reason).toBe('missing-data');
    expect(r.warnings[0]).toContain('conductorProps.cu.10.acOhmsPerKftPvc');
  });

  // ── 6. conduit-fill ───────────────────────────────────────────────────────

  test('over two conductors uses the printed over-2 column and reports percent of the raceway', async () => {
    const r = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', insulation: 'thhn-thwn-2', count: 10 }] });
    expect(r.value.conductorCount).toBe(10);
    expect(r.value.conductorAreaSqIn).toBe(0.1);
    expect(r.value.allowedAreaSqIn).toBe(0.4);
    expect(r.value.percentFill).toBe(10);
    expect(r.value.fits).toBe(true);
    expect(r.value.minTradeSize).toBe('1/2');
  });

  test('one conductor and two conductors take their own columns', async () => {
    const one = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', count: 1 }] });
    expect(one.value.allowedAreaSqIn).toBe(0.53);
    const two = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', count: 2 }] });
    expect(two.value.allowedAreaSqIn).toBe(0.31);
  });

  test('a nipple gets the nipple column', async () => {
    const r = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', nipple: true, conductors: [{ size: '12', count: 10 }] });
    expect(r.value.allowedAreaSqIn).toBe(0.6);
  });

  test('a bundle that does not fit says so and names the size that does', async () => {
    const r = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', count: 50 }] });
    expect(r.value.fits).toBe(false);
    expect(r.value.minTradeSize).toBe('3/4');
    expect(r.warnings.join(' ')).toContain('3/4');
  });

  test('trade sizes are ordered by size, never by object key order', async () => {
    // Regression. JavaScript hoists integer-like object keys ahead of string
    // ones, so Object.keys on a raceway table yields '1' before '1/2' and the
    // "smallest that fits" answer came back a full size too big. The order the
    // dataset happens to be written in must not change the answer.
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('nec', 'test-fixture').data));
      // Same three sizes, deliberately scrambled.
      d.conduitArea.emt = {
        '1': { totalSqIn: 4, over2SqIn: 1.6, twoSqIn: 1.24, oneSqIn: 2.12, nippleSqIn: 2.4 },
        '3/4': { totalSqIn: 2, over2SqIn: 0.8, twoSqIn: 0.62, oneSqIn: 1.06, nippleSqIn: 1.2 },
        '1/2': { totalSqIn: 1, over2SqIn: 0.4, twoSqIn: 0.31, oneSqIn: 0.53, nippleSqIn: 0.6 }
      };
      necRegisterDataset({ family: 'nec', edition: 'scrambled', verified: true, data: d });
      return {
        small: codeEval('nec', 'conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 10 }] }, { edition: 'scrambled' }),
        mid: codeEval('nec', 'conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 50 }] }, { edition: 'scrambled' }),
        big: codeEval('nec', 'conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 100 }] }, { edition: 'scrambled' })
      };
    });
    expect(r.small.value.minTradeSize).toBe('1/2');
    expect(r.mid.value.minTradeSize).toBe('3/4');
    expect(r.big.value.minTradeSize).toBe('1');
  });

  test('with no trade size given it sizes the raceway for you and says it assumed that', async () => {
    const r = await fx('conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 100 }] });
    expect(r.inputs.tradeSize).toBe('1');
    expect(r.value.fits).toBe(true);
    expect(r.assumed.find(a => a.key === 'tradeSize').value).toBe('1');
  });

  test('mixed sizes and insulations add up', async () => {
    const r = await fx('conduit-fill', {
      conduit: 'emt', tradeSize: '3/4',
      conductors: [{ size: '12', insulation: 'thhn-thwn-2', count: 3 }, { size: '10', insulation: 'thhn-thwn-2', count: 2 }, { size: '12', insulation: 'xhhw-2', count: 1 }]
    });
    // 3 x 0.01 + 2 x 0.02 + 1 x 0.02 = 0.09
    expect(r.value.conductorAreaSqIn).toBe(0.09);
    expect(r.value.conductorCount).toBe(6);
  });

  test('with no printed column it computes from the fill percentage and warns that it did', async () => {
    const r = await fx('conduit-fill', { conduit: 'pvc40', tradeSize: '1/2', conductors: [{ size: '12', count: 10 }] });
    expect(r.value.allowedAreaSqIn, '40% of 2 sq in').toBe(0.8);
    expect(r.warnings.join(' ')).toContain('printed fill column');
  });

  test('a raceway with nothing typed in yet refuses', async () => {
    const r = await fx('conduit-fill', { conduit: 'rmc', tradeSize: '1/2', conductors: [{ size: '12', count: 4 }] });
    expect(r.reason).toBe('missing-data');
  });

  test('an insulation or conductor size the tables do not carry is a bad input', async () => {
    const badInsul = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', insulation: 'unicorn', count: 2 }] });
    expect(badInsul.reason).toBe('bad-input');
    const badSize = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '4/0', count: 2 }] });
    expect(badSize.reason).toBe('bad-input');
    const badConduit = await fx('conduit-fill', { conduit: 'unobtanium', tradeSize: '1/2', conductors: [{ size: '12', count: 2 }] });
    expect(badConduit.reason).toBe('bad-input');
    const nullArea = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '8', count: 2 }] });
    expect(nullArea.reason).toBe('missing-data');
  });

  test('a length turns it into a conduit line', async () => {
    const r = await fx('conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 10 }], lengthFt: 85 });
    expect(r.items[0].unit).toBe('ft');
    expect(r.items[0].qty).toBe(85);
    expect(r.items[0].label).toContain('EMT');
    expect(r.items[0]).not.toHaveProperty('price');
  });

  // ── 7. box-fill ───────────────────────────────────────────────────────────

  test('conductors, clamps, a device and the grounds, each on its own line', async () => {
    const r = await fx('box-fill', {
      conductors: [{ size: '12', count: 6 }],
      clamps: true, devices: 1,
      grounds: { size: '14', count: 3 },
      boxCuIn: 20
    });
    // 6 x 3 = 18, clamps 3, one yoke 2 x 3 = 6, all grounds together 1 x 2 = 2
    expect(r.value.requiredCuIn).toBe(29);
    expect(r.value.boxCuIn).toBe(20);
    expect(r.value.fits).toBe(false);
    expect(r.value.spareCuIn).toBe(-9);
    expect(r.value.allowances.map(a => a.cite)).toEqual([
      '314.16(B)(1)', '314.16(B)(2)', '314.16(B)(4)', '314.16(B)(5)'
    ]);
    expect(r.items[0].label).toContain('29 cu in');
  });

  test('all the grounds together count once, not once each', async () => {
    const one = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], grounds: { size: '14', count: 1 }, boxCuIn: 100 });
    const many = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], grounds: { size: '14', count: 8 }, boxCuIn: 100 });
    expect(one.value.requiredCuIn).toBe(many.value.requiredCuIn);
    expect(many.value.requiredCuIn).toBe(8);
  });

  test('an isolated ground adds exactly one more allowance', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], grounds: { size: '14', count: 4 }, isolatedGround: true, boxCuIn: 100 });
    expect(r.value.requiredCuIn).toBe(6 + 4);
  });

  test('clamps count once no matter how many there are', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], clamps: true, boxCuIn: 100 });
    expect(r.value.requiredCuIn).toBe(6 + 3);
    expect(r.value.allowances.filter(a => a.cite === '314.16(B)(2)').length).toBe(1);
  });

  test('support fittings count one each, against the largest conductor', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '14', count: 2 }, { size: '10', count: 1 }], supportFittings: 2, boxCuIn: 100 });
    // 2 x 2 + 1 x 4 = 8 conductors, fittings 2 x 4 (10 AWG is the largest) = 8
    expect(r.value.requiredCuIn).toBe(16);
  });

  test('devices are sized on the largest conductor unless told otherwise', async () => {
    const dflt = await fx('box-fill', { conductors: [{ size: '14', count: 2 }, { size: '10', count: 2 }], devices: 1, boxCuIn: 100 });
    expect(dflt.value.requiredCuIn, '4 + 8 conductors, yoke 2 x 4').toBe(20);
    expect(dflt.assumed.find(a => a.key === 'deviceConductorSize').value).toBe('10');
    const told = await fx('box-fill', { conductors: [{ size: '14', count: 2 }, { size: '10', count: 2 }], devices: 1, deviceConductorSize: '14', boxCuIn: 100 });
    expect(told.value.requiredCuIn).toBe(16);
  });

  test('a named box reads its volume out of the dataset', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], box: 'device-3x2x2' });
    expect(r.value.boxCuIn).toBe(20);
    expect(r.value.fits).toBe(true);
    const nullBox = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], box: 'square-4x1.5' });
    expect(nullBox.reason).toBe('missing-data');
    const noBox = await fx('box-fill', { conductors: [{ size: '12', count: 2 }], box: 'not-a-box' });
    expect(noBox.reason).toBe('bad-input');
  });

  test('with no box at all it still answers the required volume and says the box is unknown', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '12', count: 4 }] });
    expect(r.ok).toBe(true);
    expect(r.value.requiredCuIn).toBe(12);
    expect(r.value.fits).toBe(null);
    expect(r.warnings.join(' ')).toContain('No box volume');
  });

  test('a conductor size with no allowance typed in yet refuses by path', async () => {
    const r = await fx('box-fill', { conductors: [{ size: '8', count: 2 }], boxCuIn: 100 });
    expect(r.reason).toBe('missing-data');
    expect(r.warnings[0]).toContain('boxVolumeAllowanceCuIn.8');
  });

  // ── 8. §11.1 input classes, on every rule ─────────────────────────────────

  test('null, undefined and no arguments at all: every rule refuses without throwing', async () => {
    const out = await page.evaluate((rules) => rules.map(r => ({
      rule: r,
      nul: codeEval('nec', r, null, { edition: 'test-fixture' }),
      undef: codeEval('nec', r, undefined, { edition: 'test-fixture' }),
      none: codeEval('nec', r, {}, { edition: 'test-fixture' })
    })), RULE_IDS);
    for (const o of out) {
      for (const k of ['nul', 'undef', 'none']) {
        expect(o[k].ok, o.rule + ' ' + k).toBe(false);
        expect(o[k].reason, o.rule + ' ' + k).toBe('bad-input');
        expect(o[k].value, o.rule + ' ' + k).toBe(null);
        expect(o[k].warnings.length, o.rule + ' ' + k + ' must explain itself').toBeGreaterThan(0);
      }
    }
  });

  test('empty inputs: zero and empty arrays', async () => {
    const zero = await fx('dwelling-load', { sqft: 0 });
    expect(zero.ok, 'zero square feet is a real answer, not an error').toBe(true);
    expect(zero.value.calculatedVa, 'small appliance and laundry survive').toBe(2500);
    expect(zero.value.serviceAmps).toBe(60);

    const emptyAppl = await fx('dwelling-load', { sqft: 1000, appliances: [], ranges: [], dryers: [] });
    expect(emptyAppl.value.calculatedVa).toBe(8750);

    const emptyConductors = await fx('conduit-fill', { conduit: 'emt', conductors: [] });
    expect(emptyConductors.reason).toBe('bad-input');
    const emptyBox = await fx('box-fill', { conductors: [] });
    expect(emptyBox.reason).toBe('bad-input');
    const zeroCount = await fx('conduit-fill', { conduit: 'emt', tradeSize: '1/2', conductors: [{ size: '12', count: 0 }] });
    expect(zeroCount.reason, 'a list that adds up to nothing is not a fill').toBe('bad-input');
  });

  test('boundary: negatives are refused, and the biggest safe integer does not crash anything', async () => {
    const neg = await fx('dwelling-load', { sqft: -1 });
    expect(neg.reason).toBe('bad-input');
    const negAmps = await fx('voltage-drop', { amps: -5, lengthFt: 10, size: '12' });
    expect(negAmps.reason).toBe('bad-input');
    const negCount = await fx('box-fill', { conductors: [{ size: '12', count: -2 }] });
    expect(negCount.reason).toBe('bad-input');

    const huge = await fx('dwelling-load', { sqft: Number.MAX_SAFE_INTEGER });
    expect(huge.ok).toBe(false);
    expect(huge.reason, 'off the top of the device table, not a made-up service').toBe('out-of-range');

    const zeroLen = await fx('voltage-drop', { amps: 20, lengthFt: 0, size: '12', volts: 240 });
    expect(zeroLen.ok).toBe(true);
    expect(zeroLen.value.dropVolts).toBe(0);
    expect(zeroLen.value.percent).toBe(0);
  });

  test('type mismatch: a numeric string works, anything else is refused by name', async () => {
    const str = await fx('dwelling-load', { sqft: '1000' });
    expect(str.ok, 'a form field hands us a string, that is not the caller being wrong').toBe(true);
    expect(str.value.calculatedVa).toBe(8750);

    for (const bad of ['abc', {}, [], NaN, Infinity, true]) {
      const r = await fx('dwelling-load', { sqft: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.reason, JSON.stringify(bad)).toBe('bad-input');
      expect(r.value).toBe(null);
    }

    const badMethod = await fx('dwelling-load', { sqft: 1000, method: 'whatever' });
    expect(badMethod.reason).toBe('bad-input');
    const badPhase = await fx('voltage-drop', { amps: 10, lengthFt: 10, size: '12', phase: 2 });
    expect(badPhase.reason).toBe('bad-input');
    const badMaterial = await fx('conductor-ampacity', { size: '12', material: 'unobtanium' });
    expect(badMaterial.reason).toBe('bad-input');
    const badInsul = await fx('conductor-ampacity', { size: '12', insulationC: 105 });
    expect(badInsul.reason).toBe('bad-input');
    const badConductors = await fx('conduit-fill', { conduit: 'emt', conductors: 'twelve of them' });
    expect(badConductors.reason).toBe('bad-input');
  });

  test('missing DOM: no rule touches the page', async () => {
    const r = await page.evaluate((rules) => {
      const before = document.body.innerHTML;
      rules.forEach(rule => codeEval('nec', rule, { sqft: 1000, size: '12', amps: 20, lengthFt: 50, conduit: 'emt', conductors: [{ size: '12', count: 4 }] }, { edition: 'test-fixture' }));
      return { same: document.body.innerHTML === before };
    }, RULE_IDS);
    expect(r.same).toBe(true);
  });

  test('concurrent calls: ten at once, all identical, nothing serialized behind a guard', async () => {
    const r = await page.evaluate(() => {
      const outs = [];
      for (let i = 0; i < 10; i++) {
        outs.push(JSON.stringify(codeEval('nec', 'dwelling-load', { sqft: 1000, rangeKw: 8 }, { edition: 'test-fixture' })));
      }
      return { n: outs.length, allSame: outs.every(o => o === outs[0]), first: JSON.parse(outs[0]).value.calculatedVa };
    });
    expect(r.n).toBe(10);
    expect(r.allSame).toBe(true);
    expect(r.first).toBe(14750);
  });

  test('post-error state: a refusal, a thrown rule and a bad dataset leave the next call clean', async () => {
    const r = await page.evaluate(() => {
      const opts = { edition: 'test-fixture' };
      codeEval('nec', 'dwelling-load', { sqft: 'abc' }, opts);
      codeEval('nec', 'conductor-ampacity', { size: '4/0' }, opts);
      // A rule that blows up must be contained by the engine, not by luck.
      codeRegister({ family: 'nec', edition: 'boom', verified: true, data: {}, rules: { 'dwelling-load': () => { throw new Error('boom'); } } });
      const threw = codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'boom' });
      const after = codeEval('nec', 'dwelling-load', { sqft: 1000 }, opts);
      return { threw: threw.reason, threwValue: threw.value, after: after.value.calculatedVa, ok: after.ok };
    });
    expect(r.threw).toBe('threw');
    expect(r.threwValue).toBe(null);
    expect(r.ok).toBe(true);
    expect(r.after).toBe(8750);
  });

  test('a rule that returns nothing is caught by the engine, not rendered', async () => {
    const r = await page.evaluate(() => {
      codeRegister({ family: 'nec', edition: 'silent', verified: true, data: {}, rules: { 'dwelling-load': () => undefined } });
      return codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'silent' });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-result');
    expect(r.value).toBe(null);
  });

  // ── 9. Purity ─────────────────────────────────────────────────────────────

  test('same in, same out, and the dataset is never mutated', async () => {
    const r = await page.evaluate(() => {
      const before = JSON.stringify(codeSet('nec', 'test-fixture').data);
      const inputs = { sqft: 1234, rangeKw: 8, dryerVa: 5000, appliances: [{ label: 'WH', va: 4500 }] };
      const a = JSON.stringify(codeEval('nec', 'dwelling-load', inputs, { edition: 'test-fixture' }));
      const b = JSON.stringify(codeEval('nec', 'dwelling-load', inputs, { edition: 'test-fixture' }));
      const after = JSON.stringify(codeSet('nec', 'test-fixture').data);
      return { same: a === b, dataUntouched: before === after };
    });
    expect(r.same).toBe(true);
    expect(r.dataUntouched).toBe(true);
  });

  test('the caller\'s own input object is not modified either', async () => {
    const r = await page.evaluate(() => {
      const inputs = { sqft: 1000 };
      codeEval('nec', 'dwelling-load', inputs, { edition: 'test-fixture' });
      return Object.keys(inputs);
    });
    expect(r).toEqual(['sqft']);
  });

  test('every result carries the whole audit trail, on refusal as much as on success', async () => {
    const both = await page.evaluate(() => [
      codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'test-fixture' }),
      codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: '2023' })
    ]);
    for (const r of both) {
      for (const k of ['ok', 'reason', 'value', 'unit', 'inputs', 'family', 'edition', 'cite', 'assumed', 'items', 'warnings']) {
        expect(Object.keys(r), k).toContain(k);
      }
      expect(r.family).toBe('nec');
      expect(Array.isArray(r.assumed)).toBe(true);
      expect(Array.isArray(r.items)).toBe(true);
      expect(Array.isArray(r.warnings)).toBe(true);
    }
  });

  test('a citation is a pointer, never a paragraph of the book', async () => {
    for (const rule of RULE_IDS) {
      const r = await fx(rule, { sqft: 1000, size: '12', amps: 20, lengthFt: 50, conduit: 'emt', conductors: [{ size: '12', count: 4 }] });
      expect(r.cite.length, rule + ' must cite something').toBeGreaterThan(0);
      expect(r.cite.length, rule + ': a cite over 120 characters is quoting, not citing').toBeLessThan(120);
      expect(r.cite, rule).toMatch(/\d/);
    }
  });

  test('no item anywhere carries a price', async () => {
    const results = await page.evaluate(() => [
      codeEval('nec', 'dwelling-load', { sqft: 1000 }, { edition: 'test-fixture' }),
      codeEval('nec', 'conductor-ampacity', { size: '12', lengthFt: 100 }, { edition: 'test-fixture' }),
      codeEval('nec', 'conduit-fill', { conduit: 'emt', conductors: [{ size: '12', count: 4 }], lengthFt: 50 }, { edition: 'test-fixture' }),
      codeEval('nec', 'box-fill', { conductors: [{ size: '12', count: 9 }], boxCuIn: 20 }, { edition: 'test-fixture' })
    ]);
    for (const r of results) {
      for (const it of r.items) {
        expect(Object.keys(it).sort(), 'his book prices it, not us').toEqual(['label', 'qty', 'unit', 'why']);
      }
    }
  });

  // ── 10. The real correctness proof: NEC Annex D, and it cannot run yet ────
  //
  // Every one of these is the same shape: drive codeEval with the example's
  // stated inputs against a VERIFIED nec:2023, and require our number to match
  // the book's published number exactly. That is the only test in this file
  // that proves the VALUES rather than the procedure.
  //
  // They are skipped because this environment could not reach one citable copy
  // of Annex D. Every source was refused by the egress proxy: nfpa.org,
  // ecfr.gov, the inspector associations, the trade press. Writing the numbers
  // from memory is precisely what codes/README.md forbids, so nothing was
  // written.
  //
  // TO TURN ONE ON, a human holding NEC 2023 supplies, for that example only:
  //   1. every stated input (floor area, appliance kW and VA, HVAC, unit count)
  //   2. every published intermediate the example prints
  //   3. the published total VA, the amperes, and the service or feeder size
  //   4. the corresponding values in codes/nec-2023.json, and `verified` flipped
  // Then replace the body, delete the .fixme, and it guards this engine forever.

  test.fixme('Annex D Example D1(a): one-family dwelling, standard calculation', async () => {
    // Needs: the example's floor area, its range kW, its dryer kW, and the
    // published net calculated load, service amperes and feeder sizes,
    // including the separately calculated neutral. Type them from the book.
  });

  test.fixme('Annex D Example D1(b): the same dwelling, optional calculation under 220.82', async () => {
    // Needs: the same stated inputs plus the published optional-method total
    // and service size. D1(a) and D1(b) share a dwelling on purpose, so this
    // vector is also the proof that our two methods disagree by the right
    // amount on identical input.
  });

  test.fixme('Annex D Example D2(a): optional one-family dwelling, heating larger than air conditioning', async () => {
    // Needs: floor area, range kW, water heater kW, dishwasher kW, the space
    // heating kW and how many separately controlled units it is in, the dryer
    // kW, the room air conditioner amperes and volts, and the published total
    // and service size. This is the vector that proves the 220.82(C) selection
    // picks heating over cooling for the right reason.
  });

  test.fixme('Annex D Example D2(b): optional one-family dwelling with a heat pump', async () => {
    // Needs: the same class of inputs plus the compressor and supplemental
    // heat ratings, and the published total. This is the vector that separates
    // the with-supplemental selection from the without-supplemental one.
  });

  test.fixme('Annex D Example D2(c): optional calculation for an EXISTING dwelling, 220.83', async () => {
    // Needs the example's inputs and totals AND a rule we have not written:
    // 220.83 is a different procedure from 220.82 with its own two cases
    // (additional air conditioning or heating, and not). Add the rule with
    // this vector, not before.
  });

  test.fixme('Annex D Examples D4(a) and D4(b): multifamily dwelling, standard and optional', async () => {
    // Out of scope for dwelling-load, which is written for one family. These
    // need a multifamily rule using Table 220.45 across N units, Table 220.55
    // for many ranges, and 220.84. Worth building, worth having the book open.
  });

  test.fixme('Chapter 9 conduit fill: a published Annex C combination', async () => {
    // Annex C is the pre-computed answer to exactly what conduit-fill computes:
    // how many conductors of one size and insulation fit in each raceway. Pick
    // several cells across raceway types and sizes and assert our arithmetic
    // reproduces the published count. Needs the tables typed in first.
  });

  test.fixme('Table 310.16 with correction and adjustment: a published worked ampacity', async () => {
    // Needs a citable worked example carrying a base ampacity, an ambient
    // correction from Table 310.15(B)(1), an adjustment from Table
    // 310.15(C)(1) and the 110.14(C) termination limit, with its published
    // final ampacity. The four-way interaction is where this rule can be
    // wrong in a way the fixture cannot catch.
  });

  test.fixme('314.16 box fill: a published worked box volume', async () => {
    // Needs a citable example with conductors, clamps, a yoke and the grounds,
    // and its published cubic inches, so the "all grounds count once" and
    // "clamps count once" rules are proved against the book and not just
    // against our reading of it.
  });

  // ── Errors ────────────────────────────────────────────────────────────────

  test('no console errors', async () => {
    assertNoErrors(page);
  });
});
