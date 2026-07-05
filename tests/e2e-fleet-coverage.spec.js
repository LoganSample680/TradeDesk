// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// FLEET COVERAGE — exhaustive tests for js/fleet.js (CLAUDE.md §12)
//
// Targets the previously-uncovered fleet functions: P&L math, downtime math,
// date helpers, maintenance-due logic, the maintenance-record mutation, and every
// render*/overlay helper. Pure functions assert EXACT values across null / empty /
// boundary / golden inputs; render functions assert no-throw + HTML markers with
// both empty and seeded data, plus the missing-DOM-target case.
//
// Pattern mirrors tests/e2e-functions1.spec.js exactly: page.evaluate calling the
// function, try/catch returning {ok:true} on no-throw, behavioral assertions, and
// an assertNoErrors() call ending every describe block.
// ═══════════════════════════════════════════════════════════════════════════════
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

// Shared seed helper — runs inside the page. Populates S.vehicles + maintenance +
// mileage with realistic fleet data the render/calc functions read from globals.
function seedFleet() {
  // NOTE: the app's settings object `S` is a module-scoped `let` (js/data.js) that is
  // NOT mirrored onto `window`. A bare `S` reference inside page.evaluate resolves to
  // that same lexically-scoped object the app reads — `window.S` would create a
  // separate orphan the app never sees. So we MUST assign via bare `S` here.
  S.irsRate = 0.67;
  S.vehicleOdoLog = S.vehicleOdoLog || {};
  S.vehicles = [
    {
      name: '2019 F-150', nickname: 'Work Truck', status: 'active',
      color: 'White', plate: 'ABC-1234', vin: '1FTFW1ET0000TEST0',
      purchasePrice: 40000, purchaseDate: '2024-01-15', purchaseOdo: 10000,
      bizUse: 80, gvwr: 'heavy_truck', deductionMethod: 'mileage',
      downtimeLog: [{ start: '2026-02-01', end: '2026-02-10', reason: 'Engine work' }],
    },
    {
      name: '2021 Transit', nickname: '', status: 'down',
      purchasePrice: 35000, purchaseDate: '2023-06-01',
      bizUse: 100, gvwr: 'commercial', deductionMethod: 'actual',
      downtimeLog: [{ start: '2026-05-01', end: null, reason: 'Transmission' }],
    },
    {
      name: '2018 Civic', nickname: 'Sold Car', status: 'sold',
      purchasePrice: 20000, salePrice: 12000, saleDate: '2026-03-15',
      bizUse: 50, gvwr: 'light', deductionMethod: 'mileage', downtimeLog: [],
    },
  ];
  window.maintenance = [
    { id: 101, vehicleName: '2019 F-150', date: '2026-01-10', type: 'oil_change',
      typeLabel: 'Oil Change', cost: 60, odo: 12000, vendor: 'Jiffy Lube',
      oilType: '5W-30 Full Synthetic', oilBrand: 'Mobil 1', nextOilMiles: 17000,
      nextOilDate: '2026-07-10', notes: 'Routine', photo: null },
    { id: 102, vehicleName: '2019 F-150', date: '2026-04-05', type: 'brakes',
      typeLabel: 'Brakes', cost: 350, odo: 15000, vendor: 'Midas',
      brakeAxle: 'front', notes: '', photo: 'data:image/png;base64,iVBORw0KGgo=' },
    { id: 103, vehicleName: '2021 Transit', date: '2026-05-02', type: 'tires',
      typeLabel: 'Tire Replacement', cost: 800, odo: 40000, vendor: 'Discount Tire',
      tireBrand: 'Michelin', tireSize: '265/70R17', tireCount: 4, notes: '', photo: null },
  ];
  window.mileage = [
    { id: 'mi-1', vehicle: '2019 F-150', miles: 100, date: '2026-01-20', purpose: 'Job' },
    { id: 'mi-2', vehicle: '2019 F-150', miles: 50, date: '2026-02-15', purpose: 'Estimate' },
    { id: 'mi-3', vehicle: '2021 Transit', miles: 200, date: '2026-05-10', purpose: 'Job' },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 1: Pure math / date / format helpers — EXACT value assertions
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet pure helpers — date / downtime / format math', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_fleetAddMonths — adds months, returns exact YYYY-MM-DD', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetAddMonths !== 'function') return { skip: true };
      return {
        plusSix: _fleetAddMonths('2026-01-15', 6),   // → 2026-07-15
        crossYear: _fleetAddMonths('2026-10-01', 6),  // → 2027-04-01
        zero: _fleetAddMonths('2026-03-20', 0),       // → 2026-03-20
      };
    });
    if (result.skip) return;
    expect(result.plusSix).toBe('2026-07-15');
    expect(result.crossYear).toBe('2027-04-01');
    expect(result.zero).toBe('2026-03-20');
  });

  test('_fleetAddMonths — empty / null inputs return empty string (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetAddMonths !== 'function') return { skip: true };
      try {
        return { ok: true, empty: _fleetAddMonths('', 6), nul: _fleetAddMonths(null, 6),
          undef: _fleetAddMonths(undefined, 6) };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.empty).toBe('');
    expect(result.nul).toBe('');
    expect(result.undef).toBe('');
  });

  test('_fleetDowntimeDays — inclusive day count for a downtime block', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDowntimeDays !== 'function') return { skip: true };
      return {
        tenDays: _fleetDowntimeDays({ start: '2026-01-01', end: '2026-01-10' }), // 10 inclusive
        oneDay: _fleetDowntimeDays({ start: '2026-01-01', end: '2026-01-01' }),  // 1 inclusive
      };
    });
    if (result.skip) return;
    expect(result.tenDays).toBe(10);
    expect(result.oneDay).toBe(1);
  });

  test('_fleetDowntimeDays — missing end defaults to today; never negative', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDowntimeDays !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          ongoing: _fleetDowntimeDays({ start: todayKey() }),       // start==today → 1
          empty: _fleetDowntimeDays({}),                            // both default today → 1
          reversed: _fleetDowntimeDays({ start: '2026-01-10', end: '2026-01-01' }), // clamped to 0
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.ongoing).toBe(1);
    expect(result.empty).toBe(1);
    expect(result.reversed).toBe(0); // Math.max(0, ...) guards a reversed range
  });

  test('_fleetTotalDownDays — sums all downtime blocks; empty log → 0', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetTotalDownDays !== 'function') return { skip: true };
      return {
        none: _fleetTotalDownDays({}),                        // no downtimeLog → 0
        emptyArr: _fleetTotalDownDays({ downtimeLog: [] }),   // empty → 0
        summed: _fleetTotalDownDays({ downtimeLog: [
          { start: '2026-01-01', end: '2026-01-10' }, // 10
          { start: '2026-03-01', end: '2026-03-05' }, // 5
        ] }),                                                 // → 15
      };
    });
    if (result.skip) return;
    expect(result.none).toBe(0);
    expect(result.emptyArr).toBe(0);
    expect(result.summed).toBe(15);
  });

  test('_fleetDownDays — clamps a block to the requested year', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDownDays !== 'function') return { skip: true };
      return {
        noLog: _fleetDownDays({}, '2026'),                              // 0
        inYear: _fleetDownDays({ downtimeLog: [
          { start: '2026-02-01', end: '2026-02-10' }] }, '2026'),       // 10
        clampedStart: _fleetDownDays({ downtimeLog: [
          { start: '2025-12-20', end: '2026-01-05' }] }, '2026'),       // Jan 1–5 = 5
        otherYear: _fleetDownDays({ downtimeLog: [
          { start: '2025-06-01', end: '2025-06-10' }] }, '2026'),       // 0 in 2026
      };
    });
    if (result.skip) return;
    expect(result.noLog).toBe(0);
    expect(result.inYear).toBe(10);
    expect(result.clampedStart).toBe(5);
    expect(result.otherYear).toBe(0);
  });

  test('_fleetFmtDate — formats a date; empty input → empty string', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetFmtDate !== 'function') return { skip: true };
      try {
        return { ok: true, empty: _fleetFmtDate(''), nul: _fleetFmtDate(null),
          formatted: _fleetFmtDate('2026-07-04') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.empty).toBe('');
    expect(result.nul).toBe('');
    // en-US-ish short form contains the year and a month token
    expect(result.formatted).toMatch(/2026/);
  });

  test('no console errors during fleet pure-helper tests', async () => {
    assertNoErrors(page, 'fleet pure helpers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 2: _fleetPnLCalc — deduction math (mileage + actual methods)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet P&L calculation — _fleetPnLCalc', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // `S` is a module-scoped let in js/data.js (NOT on window) — assign via bare `S`
    // so _fleetPnLCalc, which reads the same lexical `S.irsRate`, sees this value.
    await page.evaluate(() => { S.irsRate = 0.67; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // ASSERTION CHANGED 2026-07-03 (§11.4): the old expectation (miles × rate × bizPct)
  // encoded the double-penalty bug — tracked trips already ARE business miles, so the
  // business-use % must not be applied twice. New intended behavior matches the
  // Schedule C engine (_vehSchedC): deduction = business miles × rate, regardless of bizUse.
  test('mileage method — irsDeduction = business miles × rate (bizPct NOT re-applied)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      const v = { deductionMethod: 'mileage', bizUse: 80 };
      const trips = [{ miles: 100, date: '2026-01-01' }, { miles: 50, date: '2026-02-01' }]; // 150 mi
      const maint = [{ date: '2026-01-01', cost: 60 }, { date: '2026-02-01', cost: 90 }];    // $150
      return _fleetPnLCalc(v, maint, trips, '2026');
    });
    if (result.skip) return;
    expect(result.method).toBe('mileage');
    expect(result.totalMiles).toBe(150);
    // 150 business mi × 0.67 = 100.50 — bizUse (80%) does not re-scale business miles
    expect(result.irsDeduction).toBeCloseTo(100.50, 2);
    expect(result.totalDeduction).toBeCloseTo(100.50, 2);
    // maintenance is records-only under mileage method
    expect(result.maintCostYTD).toBe(150);
    expect(result.deductibleMaint).toBe(0);
    expect(result.annualDeprec).toBe(0);
    // cost/mile = actual maint spend / miles = 150/150 = 1.00
    expect(result.costPerMile).toBeCloseTo(1.0, 2);
  });

  test('actual method — depreciation + deductible maintenance at biz%', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      const v = { deductionMethod: 'actual', bizUse: 50, purchasePrice: 40000 };
      const trips = [{ miles: 1000, date: '2026-01-01' }];                 // 1000 mi
      const maint = [{ date: '2026-01-01', cost: 1000 }];                  // $1000
      return _fleetPnLCalc(v, maint, trips, '2026');
    });
    if (result.skip) return;
    expect(result.method).toBe('actual');
    expect(result.totalMiles).toBe(1000);
    // depreciation = 40000 × 0.5 / 5 = 4000
    expect(result.annualDeprec).toBeCloseTo(4000, 2);
    // deductibleMaint = 1000 × 0.5 = 500
    expect(result.deductibleMaint).toBeCloseTo(500, 2);
    // totalDeduction = 500 + 4000 = 4500
    expect(result.totalDeduction).toBeCloseTo(4500, 2);
    // costPerMile = 4500 / 1000 = 4.50
    expect(result.costPerMile).toBeCloseTo(4.5, 2);
    expect(result.irsDeduction).toBe(0); // not applicable in actual method
  });

  test('zero miles — costPerMile is 0, no divide-by-zero', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      const v = { deductionMethod: 'mileage', bizUse: 100 };
      return _fleetPnLCalc(v, [], [], '2026');
    });
    if (result.skip) return;
    expect(result.totalMiles).toBe(0);
    expect(result.costPerMile).toBe(0);
    expect(result.irsDeduction).toBe(0);
    expect(Number.isFinite(result.costPerMile)).toBe(true);
  });

  test('defaults — missing method→mileage, missing bizUse→100%', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      const v = {}; // no deductionMethod, no bizUse
      const trips = [{ miles: 100, date: '2026-01-01' }];
      return _fleetPnLCalc(v, [], trips, '2026');
    });
    if (result.skip) return;
    expect(result.method).toBe('mileage');
    // 100 × 0.67 × 1.0 = 67.00
    expect(result.irsDeduction).toBeCloseTo(67.0, 2);
  });

  test('only year-matching maintenance counts toward YTD cost', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      const v = { deductionMethod: 'mileage', bizUse: 100 };
      const maint = [{ date: '2026-01-01', cost: 100 }, { date: '2025-12-31', cost: 999 }];
      const trips = [{ miles: 100, date: '2026-01-01' }];
      return _fleetPnLCalc(v, maint, trips, '2026');
    });
    if (result.skip) return;
    expect(result.maintCostYTD).toBe(100); // 2025 record excluded
  });

  test('no console errors during P&L calc tests', async () => {
    assertNoErrors(page, 'fleet P&L calc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 3: _fleetDueAlerts — maintenance-due reminder logic
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet due alerts — _fleetDueAlerts', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('empty records → no alerts, returns array', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDueAlerts !== 'function') return { skip: true };
      const r = _fleetDueAlerts({ name: 'X' }, []);
      return { isArray: Array.isArray(r), len: r.length };
    });
    if (result.skip) return;
    expect(result.isArray).toBe(true);
    expect(result.len).toBe(0);
  });

  test('overdue oil change (nextOilDate in the past) → alert raised', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDueAlerts !== 'function') return { skip: true };
      // last oil change 13 months ago, no explicit nextOilDate → _fleetAddMonths gives past date
      const last = { type: 'oil_change', date: '2024-01-01' };
      const r = _fleetDueAlerts({ name: 'X' }, [last]);
      return { hasOil: r.some(a => /Oil/i.test(a)), len: r.length };
    });
    if (result.skip) return;
    expect(result.hasOil).toBe(true);
  });

  test('recent oil change (next date in the future) → no alert', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDueAlerts !== 'function') return { skip: true };
      const last = { type: 'oil_change', date: todayKey(), nextOilDate: '2099-01-01' };
      const r = _fleetDueAlerts({ name: 'X' }, [last]);
      return { hasOil: r.some(a => /Oil/i.test(a)) };
    });
    if (result.skip) return;
    expect(result.hasOil).toBe(false);
  });

  test('non-reminder service type never produces an alert', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDueAlerts !== 'function') return { skip: true };
      // 'brakes' has reminder:false — even an ancient record yields no alert
      const r = _fleetDueAlerts({ name: 'X' }, [{ type: 'brakes', date: '2000-01-01' }]);
      return { len: r.length };
    });
    if (result.skip) return;
    expect(result.len).toBe(0);
  });

  test('no console errors during due-alerts tests', async () => {
    assertNoErrors(page, 'fleet due alerts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 4: HTML builders — _fleetCard / overview / service / P&L / GVWR note
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet HTML builders — return markup, no throw', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(seedFleet);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_fleetCard — renders a vehicle card with its nickname', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetCard !== 'function') return { skip: true };
      try {
        const v = getVehicles()[0];
        const maint = maintenance.filter(m => m.vehicleName === v.name);
        const html = _fleetCard(v, 0);
        return { ok: true, isStr: typeof html === 'string',
          hasNick: html.includes('Work Truck'), hasCard: html.includes('class="card"') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.isStr).toBe(true);
    expect(result.hasNick).toBe(true);
    expect(result.hasCard).toBe(true);
  });

  test('_fleetDetailOverviewHtml — empty + populated both return HTML', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDetailOverviewHtml !== 'function') return { skip: true };
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      try {
        const v = getVehicles()[0];
        const maint = maintenance.filter(m => m.vehicleName === v.name);
        const pnl = _fleetPnLCalc(v, maint, [], '2026');
        const full = _fleetDetailOverviewHtml(v, pnl, maint, 9, 9, '2026');
        // minimal vehicle, no maint, no downtime
        const bare = _fleetDetailOverviewHtml({ name: 'Bare' },
          _fleetPnLCalc({ name: 'Bare' }, [], [], '2026'), [], 0, 0, '2026');
        return { ok: true, fullStr: typeof full === 'string' && full.length > 0,
          bareStr: typeof bare === 'string' && bare.length > 0,
          hasReport: full.includes('mileage report') || full.includes('Year-end') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.fullStr).toBe(true);
    expect(result.bareStr).toBe(true);
  });

  test('_fleetDetailServiceHtml — empty shows placeholder, populated shows records', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDetailServiceHtml !== 'function') return { skip: true };
      try {
        const v = getVehicles()[0];
        const maint = maintenance.filter(m => m.vehicleName === v.name);
        const empty = _fleetDetailServiceHtml(v, []);
        const full = _fleetDetailServiceHtml(v, maint);
        return { ok: true,
          emptyPlaceholder: empty.includes('No service records'),
          fullHasRecord: full.includes('Oil Change') || full.includes('Brakes') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.emptyPlaceholder).toBe(true);
    expect(result.fullHasRecord).toBe(true);
  });

  test('_fleetDetailPnLHtml — both deduction methods render without throwing', async () => {
    const result = await page.evaluate(() => {
      if (typeof _fleetDetailPnLHtml !== 'function') return { skip: true };
      if (typeof _fleetPnLCalc !== 'function') return { skip: true };
      try {
        const vMileage = getVehicles()[0]; // mileage method
        const vActual = getVehicles()[1];   // actual method
        const mMileage = maintenance.filter(m => m.vehicleName === vMileage.name);
        const tMileage = mileage.filter(t => t.vehicle === vMileage.name);
        const mActual = maintenance.filter(m => m.vehicleName === vActual.name);
        const tActual = mileage.filter(t => t.vehicle === vActual.name);
        const a = _fleetDetailPnLHtml(vMileage, _fleetPnLCalc(vMileage, mMileage, tMileage, '2026'), mMileage, tMileage);
        const b = _fleetDetailPnLHtml(vActual, _fleetPnLCalc(vActual, mActual, tActual, '2026'), mActual, tActual);
        // No data at all — still returns a string (defaults to current year block)
        const empty = _fleetDetailPnLHtml({ name: 'Z' }, _fleetPnLCalc({ name: 'Z' }, [], [], '2026'), [], []);
        return { ok: true,
          mileageBadge: a.includes('Standard Mileage'),
          actualBadge: b.includes('Actual Expenses'),
          emptyStr: typeof empty === 'string' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.mileageBadge).toBe(true);
    expect(result.actualBadge).toBe(true);
    expect(result.emptyStr).toBe(true);
  });

  test('_gvwrNote / _renderGvwrNote — every class + missing-target case', async () => {
    const result = await page.evaluate(() => {
      if (typeof _gvwrNote !== 'function') return { skip: true };
      try {
        const classes = ['light', 'heavy_truck', 'heavy_suv', 'commercial', '', 'bogus'];
        const allStrings = classes.every(c => typeof _gvwrNote(c) === 'string' && _gvwrNote(c).length > 0);
        // _renderGvwrNote writes into #fv-gvwr-note when present, and must no-throw when absent
        let renderedOk = true;
        if (typeof _renderGvwrNote === 'function') {
          document.getElementById('fv-gvwr-note')?.remove();
          _renderGvwrNote('light'); // target missing → no throw
          const el = document.createElement('div'); el.id = 'fv-gvwr-note'; document.body.appendChild(el);
          _renderGvwrNote('heavy_truck'); // target present → writes html
          renderedOk = el.innerHTML.length > 0;
          el.remove();
        }
        return { ok: true, allStrings, renderedOk };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.allStrings).toBe(true);
    expect(result.renderedOk).toBe(true);
  });

  test('no console errors during HTML builder tests', async () => {
    assertNoErrors(page, 'fleet HTML builders');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 5: Modal renderers + overlay factories (DOM-creating, no throw)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet modal renderers + overlays', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(seedFleet);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_createFleetDetailOverlay — injects overlay + box into DOM once', async () => {
    const result = await page.evaluate(() => {
      if (typeof _createFleetDetailOverlay !== 'function') return { skip: true };
      try {
        document.getElementById('fleet-detail-overlay')?.remove();
        const ov = _createFleetDetailOverlay();
        return { ok: true, hasOverlay: !!document.getElementById('fleet-detail-overlay'),
          hasBox: !!document.getElementById('fleet-detail-box'), returned: !!ov };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasOverlay).toBe(true);
    expect(result.hasBox).toBe(true);
  });

  test('_createFleetVehOverlay — injects vehicle modal shell', async () => {
    const result = await page.evaluate(() => {
      if (typeof _createFleetVehOverlay !== 'function') return { skip: true };
      try {
        document.getElementById('fleet-veh-overlay')?.remove();
        _createFleetVehOverlay();
        return { ok: true, hasOverlay: !!document.getElementById('fleet-veh-overlay'),
          hasBox: !!document.getElementById('fleet-veh-box') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasOverlay).toBe(true);
    expect(result.hasBox).toBe(true);
  });

  test('_createMaintOverlay — injects maintenance modal shell', async () => {
    const result = await page.evaluate(() => {
      if (typeof _createMaintOverlay !== 'function') return { skip: true };
      try {
        document.getElementById('fleet-maint-overlay')?.remove();
        _createMaintOverlay();
        return { ok: true, hasOverlay: !!document.getElementById('fleet-maint-overlay'),
          hasBox: !!document.getElementById('fleet-maint-box') };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasOverlay).toBe(true);
    expect(result.hasBox).toBe(true);
  });

  test('_renderFleetDetailModal — golden path + out-of-range index (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _renderFleetDetailModal !== 'function') return { skip: true };
      try {
        // These are module-scoped lets in js/fleet.js (not on window) — but the app's
        // own setters update them lexically. Drive state through the public entry point
        // openFleetVehicleDetail(idx) (sets _fleetDetailIdx + _fleetDetailTab) and
        // setFleetDetailTab(tab) so the module-scoped vars the renderer reads are set.
        openFleetVehicleDetail(0);            // sets _fleetDetailIdx=0, tab='overview', renders
        const okOverview = !!document.getElementById('fleet-detail-content');
        // exercise each tab via the app's own tab switcher
        setFleetDetailTab('service');
        setFleetDetailTab('pl');
        setFleetDetailTab('overview');
        // index < 0 short-circuits without throwing
        openFleetVehicleDetail(-1); _renderFleetDetailModal();
        return { ok: true, okOverview };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.okOverview).toBe(true);
  });

  test('_renderMaintModal — renders for valid vehicle, no-throw for bad index', async () => {
    const result = await page.evaluate(() => {
      if (typeof _renderMaintModal !== 'function') return { skip: true };
      try {
        // _maintModalVehIdx/_maintEditId/_maintPhotoB64 are module-scoped lets in
        // js/fleet.js (not on window). openAddMaintenanceModal(vehIdx, editId) sets all
        // three and calls _renderMaintModal — drive state through it.
        openAddMaintenanceModal(0, null);
        const box = document.getElementById('fleet-maint-box');
        const rendered = !!box && box.innerHTML.includes('Log service');
        // bad index → getVehicles()[idx] undefined → early return, no throw
        openAddMaintenanceModal(999, null);
        _renderMaintModal();
        return { ok: true, rendered };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.rendered).toBe(true);
  });

  test('_renderMaintTypeFields — every branch + missing target', async () => {
    const result = await page.evaluate(() => {
      if (typeof _renderMaintTypeFields !== 'function') return { skip: true };
      try {
        // Ensure the target container exists
        let el = document.getElementById('maint-type-fields');
        if (!el) { el = document.createElement('div'); el.id = 'maint-type-fields'; document.body.appendChild(el); }
        ['oil_change', 'brakes', 'tires', 'battery', 'fuel_filter', 'air_filter', 'belt', 'other'].forEach(t => {
          _renderMaintTypeFields(t, null);
        });
        const lastWasOther = el.innerHTML === '';
        // editing an existing record pre-fills values
        _renderMaintTypeFields('oil_change', { oilType: '5W-30 Full Synthetic', oilBrand: 'Mobil 1' });
        const oilHtml = el.innerHTML.includes('Oil change details');
        // missing target → must early-return, no throw
        el.remove();
        _renderMaintTypeFields('oil_change', null);
        return { ok: true, lastWasOther, oilHtml };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.lastWasOther).toBe(true);
    expect(result.oilHtml).toBe(true);
  });

  test('_renderOdometerReport — builds report overlay; bad index no-throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof _renderOdometerReport !== 'function') return { skip: true };
      try {
        // _odoReportVehIdx/_odoReportYear are module-scoped lets in js/fleet.js (not on
        // window). openOdometerReport(vehIdx) sets both and calls _renderOdometerReport.
        openOdometerReport(0);
        const built = !!document.getElementById('odo-report-overlay');
        // invalid index → openOdometerReport guards (getVehicles()[999] undefined),
        // and _renderOdometerReport also early-returns — no throw either way.
        openOdometerReport(999);
        _renderOdometerReport();
        return { ok: true, built };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.built).toBe(true);
  });

  test('no console errors during modal renderer tests', async () => {
    assertNoErrors(page, 'fleet modal renderers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 6: Mutations + photo handlers — deleteMaintenanceRecord, photo, remove
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Fleet mutations + photo handlers', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(seedFleet);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('deleteMaintenanceRecord — removes the seeded record from the store', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteMaintenanceRecord !== 'function') return { skip: true };
      try {
        // seed a uniquely-id'd record to delete
        const delId = 777001;
        maintenance.unshift({ id: delId, vehicleName: '2019 F-150', date: '2026-06-01',
          type: 'other', typeLabel: 'Other', cost: 10 });
        const before = maintenance.length;
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); }; // auto-confirm
        deleteMaintenanceRecord(delId);
        window.zConfirm = origConfirm;
        const stillThere = maintenance.some(m => m.id === delId);
        return { ok: true, before, after: maintenance.length, stillThere };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.stillThere).toBe(false);          // record gone
    expect(result.after).toBe(result.before - 1);   // exactly one removed
  });

  test('deleteMaintenanceRecord — non-existent id is a no-op, no throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof deleteMaintenanceRecord !== 'function') return { skip: true };
      try {
        const before = maintenance.length;
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        deleteMaintenanceRecord(999999999); // not present
        window.zConfirm = origConfirm;
        return { ok: true, before, after: maintenance.length };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.after).toBe(result.before); // nothing removed
  });

  test('_confirmRemoveVehicle — removes the vehicle from S.vehicles', async () => {
    const result = await page.evaluate(() => {
      if (typeof _confirmRemoveVehicle !== 'function') return { skip: true };
      try {
        const vehs = getVehicles();
        const before = vehs.length;
        // add a throwaway vehicle at the end and remove that index
        S.vehicles = [...vehs, { name: 'Throwaway Truck', nickname: 'TMP', status: 'active' }];
        const idx = S.vehicles.length - 1;
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        _confirmRemoveVehicle(idx);
        window.zConfirm = origConfirm;
        const hasThrowaway = (S.vehicles || []).some(v => v.name === 'Throwaway Truck');
        return { ok: true, before, after: (S.vehicles || []).length, hasThrowaway };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.hasThrowaway).toBe(false);
  });

  test('_confirmRemoveVehicle — invalid index returns early, no throw', async () => {
    const result = await page.evaluate(() => {
      if (typeof _confirmRemoveVehicle !== 'function') return { skip: true };
      try {
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, cb) => { if (cb) cb(); };
        _confirmRemoveVehicle(99999);
        window.zConfirm = origConfirm;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('_clearMaintPhoto — resets the in-memory photo + hides preview', async () => {
    const result = await page.evaluate(() => {
      if (typeof _clearMaintPhoto !== 'function') return { skip: true };
      try {
        // _maintPhotoB64 is a module-scoped let in js/fleet.js (not on window). Opening the
        // maint modal in edit mode for record 102 (which carries a photo) sets the module
        // var to a non-null value the way the app does; a bare reference inside this
        // evaluate reads that same lexical var.
        openAddMaintenanceModal(0, 102); // record 102 has a photo → _maintPhotoB64 = rec.photo
        let preview = document.getElementById('maint-photo-preview');
        if (!preview) { preview = document.createElement('div'); preview.id = 'maint-photo-preview'; document.body.appendChild(preview); }
        preview.style.display = '';
        _clearMaintPhoto();
        return { ok: true, cleared: _maintPhotoB64 === null, hidden: preview.style.display === 'none' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.cleared).toBe(true);
    expect(result.hidden).toBe(true);
  });

  test('_handleMaintPhoto — null/empty file input is a safe no-op', async () => {
    const result = await page.evaluate(() => {
      if (typeof _handleMaintPhoto !== 'function') return { skip: true };
      try {
        _handleMaintPhoto({ files: [] });        // no file
        _handleMaintPhoto({ files: null });      // null files
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
  });

  test('_showMaintPhoto — opens viewer only when record has a photo', async () => {
    const result = await page.evaluate(() => {
      if (typeof _showMaintPhoto !== 'function') return { skip: true };
      try {
        // record 102 in seed has a photo; 101 does not; 'missing' does not exist.
        // _showMaintPhoto builds its overlay via el.style.cssText='...z-index:9999...';
        // the browser re-serializes the style attribute WITH a space ("z-index: 9999"),
        // so match both spellings (an exact "z-index:9999" attr selector would never hit).
        const countOverlays = () => document.querySelectorAll(
          'div[style*="z-index:9999"], div[style*="z-index: 9999"]').length;
        _showMaintPhoto('missing-id'); // no record → no overlay, no throw
        _showMaintPhoto(101);          // record exists but photo is null → no overlay
        const beforeWithPhoto = countOverlays();
        _showMaintPhoto(102);          // has photo → overlay added
        const afterWithPhoto = countOverlays();
        // clean up any overlay we created
        document.querySelectorAll('div[style*="z-index:9999"], div[style*="z-index: 9999"]').forEach(el => el.remove());
        return { ok: true, opened: afterWithPhoto > beforeWithPhoto };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (result.skip) return;
    expect(result.ok).toBe(true);
    expect(result.opened).toBe(true);
  });

  test('no console errors during mutation + photo tests', async () => {
    assertNoErrors(page, 'fleet mutations + photo handlers');
  });
});
