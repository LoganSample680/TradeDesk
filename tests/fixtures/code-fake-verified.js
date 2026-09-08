// A deliberately FAKE verified code dataset, for tests only.
//
// Why this exists: every real dataset under codes/ ships verified:false with
// every value null, and codeEval refuses to return anything from one. That is
// correct and it is not negotiable (codes/README.md). But it also means nothing
// downstream of the engine can be tested until somebody buys a book and types
// three hundred numbers in, and "we will test the wiring later" is how wiring
// ships broken.
//
// So: a dataset with the right SHAPE and knowingly wrong NUMBERS. Every value
// here is a round number chosen to be obviously invented, and the edition is
// named 'FAKE' so it can never be mistaken for a real one, never collide with a
// real edition key, and never be selected by a contractor: the settings picker
// lists whatever is registered, and a row reading "FAKE" is its own alarm.
//
// RULES FOR THIS FILE
//   1. It is never loaded by index.html and never fetched by the app. Tests
//      register it by hand.
//   2. No number in it may be plausible. If a value here ever looks like it
//      came out of a code book, it is wrong on purpose and should be made
//      rounder, not more realistic.
//   3. It proves wiring, never arithmetic. A test that asserts a load
//      calculation is CORRECT belongs against the published worked examples,
//      not against this.

const FAKE_NEC = {
  family: 'nec',
  edition: 'FAKE',
  // The one place in the codebase where this is true, and only because the
  // numbers below are invented rather than read.
  verified: true,
  verifiedBy: 'test fixture, not a person',
  verifiedAt: '2000-01-01',
  sources: {},
  todo: [],
  data: {
    dwelling: {
      generalLightingVaPerSqft: 1,
      smallApplianceCircuitVa: 1000,
      smallApplianceCircuitsMin: 2,
      laundryCircuitVa: 1000,
      laundryCircuitsMin: 1,
      generalDemandRows: [{ uptoVa: 10000, pct: 100 }, { uptoVa: null, pct: 50 }],
      fixedAppliance: { triggerCount: 4, pct: 50 },
      dryer: { minVa: 5000, demandRows: [{ count: 1, pct: 100 }] },
      cooking: {
        colARows: [], colBRows: [], colCRows: [{ count: 1, kw: 10 }],
        colALimitKw: 10, colBLimitKw: 10, colCLimitKw: 10, colCMaxKw: 10,
        note1: { perKwPct: 5 }
      },
      heatPct: 100,
      acPct: 100,
      largestMotorPct: 25,
      optional: {
        minServiceAmps: 100,
        generalFirstVa: 10000,
        generalFirstPct: 100,
        generalRemainderPct: 40,
        hvacPct: {
          ac: 100, heatPumpWithSupplemental: 100, heatPumpNoSupplemental: 100,
          spaceHeatUnder: 100, spaceHeatAtOrOver: 100, centralSpaceHeat: 100
        },
        heatUnitThreshold: 4
      },
      serviceMinAmps: 100
    },
    standardOcpdAmps: [100, 200, 300, 400],
    smallConductorMaxOcpd: { '14': 10, '12': 20, '10': 30 },
    continuousPct: 125,
    ampacity: {
      // Round tens, ascending by size. Nothing here is Table 310.16.
      cu: { '14': { 60: 10, 75: 10, 90: 10 }, '12': { 60: 20, 75: 20, 90: 20 },
            '10': { 60: 30, 75: 30, 90: 30 }, '8': { 60: 40, 75: 40, 90: 40 },
            '6': { 60: 50, 75: 50, 90: 50 }, '4': { 60: 60, 75: 60, 90: 60 },
            '3': { 60: 70, 75: 70, 90: 70 }, '2': { 60: 80, 75: 80, 90: 80 },
            '1': { 60: 90, 75: 90, 90: 90 } },
      al: { '14': { 60: 10, 75: 10, 90: 10 }, '12': { 60: 20, 75: 20, 90: 20 },
            '10': { 60: 30, 75: 30, 90: 30 }, '8': { 60: 40, 75: 40, 90: 40 },
            '6': { 60: 50, 75: 50, 90: 50 }, '4': { 60: 60, 75: 60, 90: 60 },
            '3': { 60: 70, 75: 70, 90: 70 }, '2': { 60: 80, 75: 80, 90: 80 },
            '1': { 60: 90, 75: 90, 90: 90 } }
    },
    ampacityBaseAmbientC: 30,
    tempCorrectionRows: [{ minC: 0, maxC: 100, f60: 1, f75: 1, f90: 1 }],
    adjustmentRows: [{ countFrom: 1, countTo: 100, pct: 100 }],
    terminationDefaultC: 60,
    terminationSplitAmps: 100,
    conductorProps: {},
    conductorAreaSqIn: {},
    conduitArea: {},
    fillPct: { 1: 50, 2: 50, over2: 40, nipple: 60 },
    boxVolumeAllowanceCuIn: { '14': 2, '12': 2, '10': 2 },
    boxDeviceMultiplier: 2,
    boxVolumeCuIn: {},
    voltageDropAdviceBranchPct: 3,
    voltageDropAdviceTotalPct: 5,
    // Round tens again, and deliberately NOT the real spacing, so a test that
    // expects the true NEC numbers fails here instead of passing by accident.
    receptacleSpacing: { maxGapFt: 10, fromBreakFt: 5, minWallSpaceFt: 5 },
    gfciRoomKinds: [{ kind: 'kitchen' }, { kind: 'bath' }]
  }
};

/**
 * Register the fake dataset in a page and point the account at it.
 * Returns what the app can now answer, so a test can assert the wiring rather
 * than trusting it.
 */
async function useFakeCodes(page, fixture) {
  return page.evaluate(function (set) {
    // The real modules self-load their own files at boot; this adds one more
    // edition beside them rather than replacing anything.
    // Borrow the real rule functions. The whole point is to exercise the
    // shipped arithmetic against known-fake data, so the rules must be the real
    // ones and only the numbers invented.
    const withRules = Object.assign({}, set, { rules: window.necRules || {} });
    const ok = window.codeRegister(withRules);
    // Go through the app's own setter rather than poking at S. The engine reads
    // the real binding, and a test that writes window.S writes a different
    // object when S is declared with const, which is silent and looks like the
    // engine ignoring a perfectly good edition.
    window.setCodeEdition(set.family, set.edition);
    return { registered: ok, editions: window.codeEditions(set.family) };
  }, fixture || FAKE_NEC);
}

module.exports = { FAKE_NEC, useFakeCodes };
