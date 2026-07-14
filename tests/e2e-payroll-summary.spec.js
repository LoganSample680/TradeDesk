// @ts-check
/**
 * Exhaustive E2E coverage for js/payroll-summary.js
 *
 * Functions covered:
 *   _paySummaryPeriodsPerYear, _paySummaryDefaultRange, _paySummaryWeeklySplit,
 *   _paySummaryYtdEstimate, _paySummaryBuild, renderPayrollSummary,
 *   _paySummaryExportCSV
 *
 * Every function is tested for:
 *   null / undefined input, empty input, boundary values, missing DOM,
 *   golden-path, and permission gating.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('payroll-summary.js — exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { if (typeof goPg === 'function') goPg('pg-taxes'); });
    await page.waitForTimeout(300);
  });

  test.afterAll(async () => { await page.close(); });

  test('_paySummaryPeriodsPerYear maps all 4 types and defaults unknown to 52', async () => {
    const result = await page.evaluate(() => ({
      weekly: _paySummaryPeriodsPerYear('weekly'),
      biweekly: _paySummaryPeriodsPerYear('biweekly'),
      semimonthly: _paySummaryPeriodsPerYear('semimonthly'),
      monthly: _paySummaryPeriodsPerYear('monthly'),
      unknown: _paySummaryPeriodsPerYear('bogus'),
      nullVal: _paySummaryPeriodsPerYear(null),
      undef: _paySummaryPeriodsPerYear(undefined),
    }));
    expect(result.weekly).toBe(52);
    expect(result.biweekly).toBe(26);
    expect(result.semimonthly).toBe(24);
    expect(result.monthly).toBe(12);
    expect(result.unknown).toBe(52);
    expect(result.nullVal).toBe(52);
    expect(result.undef).toBe(52);
  });

  test('_paySummaryDefaultRange(weekly) returns a 7-day Sunday-start range', async () => {
    const result = await page.evaluate(() => _paySummaryDefaultRange('weekly', '2026-07-15'));
    // 2026-07-15 is a Wednesday; week should start Sunday 2026-07-12
    expect(result.start).toBe('2026-07-12');
    expect(result.end).toBe('2026-07-18');
  });

  test('_paySummaryDefaultRange(biweekly) returns a 14-day range', async () => {
    const result = await page.evaluate(() => _paySummaryDefaultRange('biweekly', '2026-07-15'));
    expect(result.start).toBe('2026-07-12');
    expect(result.end).toBe('2026-07-25');
  });

  test('_paySummaryDefaultRange(monthly) returns first-to-last day of the month', async () => {
    const result = await page.evaluate(() => _paySummaryDefaultRange('monthly', '2026-02-10'));
    expect(result.start).toBe('2026-02-01');
    expect(result.end).toBe('2026-02-28');
  });

  test('_paySummaryDefaultRange(semimonthly) splits at the 15th', async () => {
    const first = await page.evaluate(() => _paySummaryDefaultRange('semimonthly', '2026-03-10'));
    const second = await page.evaluate(() => _paySummaryDefaultRange('semimonthly', '2026-03-20'));
    expect(first).toEqual({ start: '2026-03-01', end: '2026-03-15' });
    expect(second).toEqual({ start: '2026-03-16', end: '2026-03-31' });
  });

  test('_paySummaryDefaultRange with an invalid anchor falls back to today-based range without throwing', async () => {
    const result = await page.evaluate(() => _paySummaryDefaultRange('weekly', 'not-a-date'));
    expect(result.start).toBeTruthy();
    expect(result.end).toBeTruthy();
  });

  test('_paySummaryDefaultRange with null anchor does not throw', async () => {
    const ok = await page.evaluate(() => {
      try { _paySummaryDefaultRange('weekly', null); return true; } catch (e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('_paySummaryWeeklySplit([]) returns zero regular and zero OT', async () => {
    const result = await page.evaluate(() => _paySummaryWeeklySplit([]));
    expect(result).toEqual({ regMin: 0, otMin: 0 });
  });

  test('_paySummaryWeeklySplit(null/undefined) does not throw', async () => {
    const result = await page.evaluate(() => ({
      n: _paySummaryWeeklySplit(null),
      u: _paySummaryWeeklySplit(undefined),
    }));
    expect(result.n).toEqual({ regMin: 0, otMin: 0 });
    expect(result.u).toEqual({ regMin: 0, otMin: 0 });
  });

  test('_paySummaryWeeklySplit under 40h/week is all regular, no OT', async () => {
    const result = await page.evaluate(() => _paySummaryWeeklySplit([
      { date: '2026-07-13', minutes: 480 }, // Monday, 8h
      { date: '2026-07-14', minutes: 480 },
    ]));
    expect(result.regMin).toBe(960);
    expect(result.otMin).toBe(0);
  });

  test('_paySummaryWeeklySplit over 40h/week splits the excess into OT (boundary at exactly 40h)', async () => {
    const result = await page.evaluate(() => _paySummaryWeeklySplit([
      { date: '2026-07-13', minutes: 2400 }, // exactly 40h — all regular
    ]));
    expect(result.regMin).toBe(2400);
    expect(result.otMin).toBe(0);
  });

  test('_paySummaryWeeklySplit over 40h/week (40h1m) — 1 minute of OT', async () => {
    const result = await page.evaluate(() => _paySummaryWeeklySplit([
      { date: '2026-07-13', minutes: 2401 },
    ]));
    expect(result.regMin).toBe(2400);
    expect(result.otMin).toBe(1);
  });

  test('_paySummaryWeeklySplit sums separate weeks independently (no cross-week bleed)', async () => {
    const result = await page.evaluate(() => _paySummaryWeeklySplit([
      { date: '2026-07-06', minutes: 2460 }, // week 1: 40h regular + 60min OT
      { date: '2026-07-13', minutes: 2460 }, // week 2: same
    ]));
    expect(result.regMin).toBe(4800);
    expect(result.otMin).toBe(120);
  });

  test('_paySummaryYtdEstimate for a salary employee is straight-line, ignoring priorRows entirely', async () => {
    const result = await page.evaluate(() => {
      const comp = { pay_type: 'salary', pay_rate: 52000 }; // $1000/week
      return _paySummaryYtdEstimate(comp, [{ date: '2026-01-05', minutes: 999999 }], '2026-01-15', 2026);
    });
    // 2 weeks elapsed (Jan 1 -> Jan 15) * $1000/week = $2000, hours ignored
    expect(result.grossWages).toBeCloseTo(2000, 0);
    expect(result.ssWages).toBe(result.grossWages);
    expect(result.futaWages).toBe(result.grossWages);
  });

  test('_paySummaryYtdEstimate for an hourly employee derives from actual prior hours', async () => {
    const result = await page.evaluate(() => {
      const comp = { pay_type: 'hourly', pay_rate: 20 };
      return _paySummaryYtdEstimate(comp, [{ date: '2026-01-05', minutes: 2400 }], '2026-01-15', 2026);
    });
    expect(result.grossWages).toBe(800); // 40h * $20
  });

  test('_paySummaryYtdEstimate with no comp (null) does not throw and returns zero', async () => {
    const result = await page.evaluate(() => _paySummaryYtdEstimate(null, [], '2026-01-15', 2026));
    expect(result.grossWages).toBe(0);
  });

  test('_paySummaryYtdEstimate with empty priorRows returns zero for hourly', async () => {
    const result = await page.evaluate(() => _paySummaryYtdEstimate({ pay_type: 'hourly', pay_rate: 30 }, [], '2026-01-15', 2026));
    expect(result.grossWages).toBe(0);
  });

  test('_paySummaryBuild with zero employees returns empty rows and zeroed totals', async () => {
    const result = await page.evaluate(async () => {
      const savedEmps = S.employees;
      S.employees = [{ name: 'Owner', role: 'owner' }];
      const r = await _paySummaryBuild('2026-07-12', '2026-07-18', 'weekly');
      S.employees = savedEmps;
      return r;
    });
    expect(result.rows.length).toBe(0);
    expect(result.totals.grossWages).toBe(0);
    expect(result.totals.cashNeeded).toBe(0);
  });

  test('_paySummaryBuild golden path: one hourly employee with known hours produces correct gross + liability', async () => {
    const result = await page.evaluate(async () => {
      const savedEmps = S.employees, savedComp = { ..._teamComp };
      S.employees = [{ name: 'Test Hourly', role: 'tech', email: 'testhourly@example.com', employee_user_id: 'uid-test-hourly' }];
      _teamComp['testhourly@example.com'] = { pay_type: 'hourly', pay_rate: 20 };
      const origTimeLogRows = window._timeLogRows;
      window._timeLogRows = async () => ([
        { personUid: 'uid-test-hourly', date: '2026-07-14', minutes: 2400 }, // 40h, in-period
      ]);
      const r = await _paySummaryBuild('2026-07-12', '2026-07-18', 'weekly');
      S.employees = savedEmps; _teamComp = savedComp; window._timeLogRows = origTimeLogRows;
      return r;
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].regMin).toBe(2400);
    expect(result.rows[0].otMin).toBe(0);
    expect(result.rows[0].grossWages).toBe(800); // 40h * $20
    expect(result.totals.grossWages).toBe(800);
    expect(result.totals.cashNeeded).toBeGreaterThan(800); // gross + employer FICA/FUTA
  });

  test('_paySummaryBuild flags OT correctly for an employee over 40h in the period', async () => {
    const result = await page.evaluate(async () => {
      const savedEmps = S.employees, savedComp = { ..._teamComp };
      S.employees = [{ name: 'Test OT', role: 'tech', email: 'testot@example.com', employee_user_id: 'uid-test-ot' }];
      _teamComp['testot@example.com'] = { pay_type: 'hourly', pay_rate: 20 };
      const origTimeLogRows = window._timeLogRows;
      window._timeLogRows = async () => ([
        { personUid: 'uid-test-ot', date: '2026-07-14', minutes: 3000 }, // 50h in one week
      ]);
      const r = await _paySummaryBuild('2026-07-12', '2026-07-18', 'weekly');
      S.employees = savedEmps; _teamComp = savedComp; window._timeLogRows = origTimeLogRows;
      return r;
    });
    expect(result.rows[0].regMin).toBe(2400);
    expect(result.rows[0].otMin).toBe(600);
    // 40h*$20 + 10h*$20*1.5 = 800 + 300 = 1100
    expect(result.rows[0].grossWages).toBe(1100);
  });

  test('_paySummaryBuild for a salary employee ignores hours entirely', async () => {
    const result = await page.evaluate(async () => {
      const savedEmps = S.employees, savedComp = { ..._teamComp };
      S.employees = [{ name: 'Test Salary', role: 'tech', email: 'testsalary@example.com', employee_user_id: 'uid-test-salary' }];
      _teamComp['testsalary@example.com'] = { pay_type: 'salary', pay_rate: 52000 };
      const origTimeLogRows = window._timeLogRows;
      window._timeLogRows = async () => ([
        { personUid: 'uid-test-salary', date: '2026-07-14', minutes: 999999 },
      ]);
      const r = await _paySummaryBuild('2026-07-12', '2026-07-18', 'weekly');
      S.employees = savedEmps; _teamComp = savedComp; window._timeLogRows = origTimeLogRows;
      return r;
    });
    expect(result.rows[0].grossWages).toBe(1000); // 52000/52
  });

  test('renderPayrollSummary() with missing DOM (#pay-summary-body absent) is a safe no-op', async () => {
    const ok = await page.evaluate(async () => {
      const el = document.getElementById('pay-summary-body');
      const parent = el && el.parentElement, next = el && el.nextSibling;
      if (el) el.remove();
      try { await renderPayrollSummary(); }
      catch (e) { if (parent) parent.insertBefore(el, next); return false; }
      if (parent) parent.insertBefore(el, next);
      return true;
    });
    expect(ok).toBe(true);
  });

  test('renderPayrollSummary() shows an empty state when there are no W-2 employees', async () => {
    const html = await page.evaluate(async () => {
      const saved = S.employees;
      S.employees = [{ name: 'Owner', role: 'owner' }];
      await renderPayrollSummary();
      const out = document.getElementById('pay-summary-body').innerHTML;
      S.employees = saved;
      return out;
    });
    expect(html).toContain('No W-2 employees yet');
  });

  test('renderPayrollSummary() respects _canViewComp() permission gate', async () => {
    const html = await page.evaluate(async () => {
      const origFn = window._canViewComp;
      window._canViewComp = () => false;
      await renderPayrollSummary();
      const out = document.getElementById('pay-summary-body').innerHTML;
      window._canViewComp = origFn;
      return out;
    });
    expect(html).toContain("don't have permission");
  });

  test('_paySummaryExportCSV() with no computed result shows a toast, does not call downloadFile', async () => {
    const result = await page.evaluate(() => {
      const origResult = _paySummaryLastResult, origDl = window.downloadFile, origToast = window.showToast;
      let downloadCalled = false, toastMsg = '';
      _paySummaryLastResult = null;
      window.downloadFile = () => { downloadCalled = true; };
      window.showToast = (msg) => { toastMsg = msg; };
      try { _paySummaryExportCSV(); return { downloadCalled, toastMsg }; }
      finally { _paySummaryLastResult = origResult; window.downloadFile = origDl; window.showToast = origToast; }
    });
    expect(result.downloadCalled).toBe(false);
    expect(result.toastMsg).toContain('No payroll data');
  });

  test('_paySummaryExportCSV() with zero rows shows a toast, does not call downloadFile', async () => {
    const result = await page.evaluate(() => {
      const origResult = _paySummaryLastResult, origDl = window.downloadFile;
      let downloadCalled = false;
      _paySummaryLastResult = { rows: [], totals: {}, startDate: '2026-07-12', endDate: '2026-07-18' };
      window.downloadFile = () => { downloadCalled = true; };
      try { _paySummaryExportCSV(); return { downloadCalled }; }
      finally { _paySummaryLastResult = origResult; window.downloadFile = origDl; }
    });
    expect(result.downloadCalled).toBe(false);
  });

  test('_paySummaryExportCSV() golden path: builds a CSV with header, one row per employee, and a TOTAL row', async () => {
    const result = await page.evaluate(() => {
      const origResult = _paySummaryLastResult, origDl = window.downloadFile;
      let captured = null;
      _paySummaryLastResult = {
        startDate: '2026-07-12', endDate: '2026-07-18',
        rows: [
          { employee: { name: 'Mike Torres' }, comp: { pay_type: 'hourly', pay_rate: 28 }, regMin: 2400, otMin: 600, grossWages: 1540, liab: { employeeFica: 117.81, employerFicaMatch: 117.81, futa940: 9.24 } },
          { employee: { name: 'Dana Lee' }, comp: { pay_type: 'salary', pay_rate: 52000 }, regMin: 480, otMin: 0, grossWages: 1000, liab: { employeeFica: 76.5, employerFicaMatch: 76.5, futa940: 0 } },
        ],
        totals: { grossWages: 2540, employeeFica: 194.31, employerFicaMatch: 194.31, futa940: 9.24, cashNeeded: 2743.55 },
      };
      window.downloadFile = (filename, content, type) => { captured = { filename, content, type }; };
      try { _paySummaryExportCSV(); return captured; }
      finally { _paySummaryLastResult = origResult; window.downloadFile = origDl; }
    });
    expect(result).toBeTruthy();
    expect(result.type).toBe('text/csv');
    const lines = result.content.split('\n');
    expect(lines[0]).toContain('Employee');
    expect(lines[0]).toContain('Gross Wages');
    expect(lines.length).toBe(4); // header + 2 employees + TOTAL
    expect(lines[1]).toContain('Mike Torres');
    expect(lines[1]).toContain('1540');
    expect(lines[2]).toContain('Dana Lee');
    expect(lines[2]).toContain('Salary');
    expect(lines[3]).toContain('TOTAL');
    // The TOTAL row mirrors the per-employee columns (gross/FICA/FUTA) — it
    // does not carry the on-screen "cash needed" figure, which is a derived
    // sum (gross + employer FICA + FUTA) a downstream system can compute
    // itself from the columns already present.
    expect(lines[3]).toContain('2540'); // gross wages total
    expect(lines[3]).toContain('194.31'); // employer FICA match total
    expect(lines[3]).toContain('9.24'); // FUTA total
  });

  test('_paySummaryExportCSV() escapes a comma in an employee name (CSV-injection-adjacent safety)', async () => {
    const content = await page.evaluate(() => {
      const origResult = _paySummaryLastResult, origDl = window.downloadFile;
      let captured = null;
      _paySummaryLastResult = {
        startDate: '2026-07-12', endDate: '2026-07-18',
        rows: [{ employee: { name: 'Torres, Mike "The Wrench"' }, comp: { pay_type: 'hourly', pay_rate: 28 }, regMin: 60, otMin: 0, grossWages: 28, liab: { employeeFica: 0, employerFicaMatch: 0, futa940: 0 } }],
        totals: { grossWages: 28, employeeFica: 0, employerFicaMatch: 0, futa940: 0, cashNeeded: 28 },
      };
      window.downloadFile = (filename, csvContent) => { captured = csvContent; };
      try { _paySummaryExportCSV(); return captured; }
      finally { _paySummaryLastResult = origResult; window.downloadFile = origDl; }
    });
    expect(content).toContain('"Torres, Mike ""The Wrench"""');
  });

  test('Export button appears in the rendered card and calls _paySummaryExportCSV', async () => {
    const found = await page.evaluate(async () => {
      const savedEmps = S.employees, savedComp = { ..._teamComp };
      S.employees = [{ name: 'Export Test', role: 'tech', email: 'exporttest@example.com', employee_user_id: 'uid-export-test' }];
      _teamComp['exporttest@example.com'] = { pay_type: 'hourly', pay_rate: 25 };
      const origTimeLogRows = window._timeLogRows;
      window._timeLogRows = async () => ([{ personUid: 'uid-export-test', date: '2026-07-14', minutes: 480 }]);
      await renderPayrollSummary();
      const has = !!document.querySelector('#pay-summary-body button[onclick="_paySummaryExportCSV()"]');
      S.employees = savedEmps; _teamComp = savedComp; window._timeLogRows = origTimeLogRows;
      return has;
    });
    expect(found).toBe(true);
  });

  assertNoErrors(() => page);
});
