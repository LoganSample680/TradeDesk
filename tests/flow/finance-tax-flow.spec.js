// REAL flow — finance/books + tax-engine correctness (task #31). Two gaps the
// audit flagged: the books income path and the pg-taxes engine had no positive
// contractor-correctness flow (only employee-lockout touched them).
//
//   A. INCOME LOGGING — log income through the real modal (finance.js
//      saveManualIncome) and assert it lands in income[] AND round-trips to the
//      cloud (td_income).
//   B. TAX ENGINE — seed a clean FUTURE tax year (no real account data pollutes
//      it), drive the real calcTax() and assert the rendered Self-Employment tax
//      and Federal income tax in #tx-results exactly equal the documented formula
//      applied (with the app's own bracket/SE/mileage helpers) to the live inputs.
//      This catches any wiring regression (wrong brackets, dropped mileage
//      deduction, etc.) — not just the pure math the existing tax spec covers.
//
// Seed data is left in the account per CLAUDE.md §13.7.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

test.describe('finance + tax correctness (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // ── A. INCOME LOGGING → cloud ──────────────────────────────────────────────
  test('logging income via the real modal persists to td_income', async ({ page }) => {
    const FLOW = 'finance/log-income';
    const AMT = 95000 + (process.pid % 1000); // unique-ish so the row is greppable
    await step(page, {
      label: 'open income modal, enter amount + date, save', page: 'pg-books', role: 'contractor',
      suspect: 'finance.js saveManualIncome (income.push + _flushSaveNow → td_income)',
      ruleText: 'saving the income modal must record the entry in income[] AND the cloud (td_income)',
      expected: `income amount ${AMT} present in memory and td_income`,
      act: async (p) => {
        await p.evaluate(() => { openManualIncomeModal(); });
        await p.waitForSelector('#_inc-amt', { timeout: 10000 });
        await p.evaluate((AMT) => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          set('_inc-date', '06/15/2098');     // a clean future year; MM/DD/YYYY
          set('_inc-amt', String(AMT));
          set('_inc-type', 'Job payment');
          set('_inc-notes', 'E2E income flow');
          // leave method empty (non-Cash) so the cash-deposit confirm gate doesn't fire
          saveManualIncome();
        }, AMT);
        await p.waitForTimeout(800);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return 1 + 10 + String(AMT).length + 1; // open + date(10) + amount + save
      },
      rule: async (p) => {
        const mem = await p.evaluate((AMT) => {
          const e = (income || []).find(x => x.amount === AMT && String(x.date).startsWith('2098'));
          return e ? { date: e.date, amount: e.amount } : null;
        }, AMT);
        const cloud = await cloudRows(p, 'td_income');
        const ce = cloud.find(e => e.amount === AMT && String(e.date).startsWith('2098'));
        return { ok: !!mem && !!ce, got: `mem=${JSON.stringify(mem)} cloud=${ce ? ce.amount + '/' + ce.date : 'ROW ABSENT'}` };
      },
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // ── B. TAX ENGINE integration correctness ──────────────────────────────────
  test('calcTax renders SE + federal tax matching the formula over live inputs', async ({ page }) => {
    const FLOW = 'finance/tax-engine';
    const YEAR = '2099'; // clean year — no real bids/payments/expenses land here

    await step(page, {
      label: 'seed a known income for 2099, run calcTax, verify rendered SE + fed tax',
      page: 'pg-taxes', role: 'contractor',
      suspect: 'tax.js calcTax (income+payments−expenses−mileage → SE + bracket federal)',
      ruleText: 'the rendered Self-Employment and Federal tax must equal the documented formula over the year inputs',
      expected: '#tx-results contains fmt(seTax) and fmt(fedTax) computed independently',
      act: async (p) => {
        const r = await p.evaluate((YEAR) => {
          if (typeof goPg === 'function') goPg('pg-taxes');
          // Seed a clean, sizable income for the future year.
          income.push({ id: Date.now(), bid_id: null, client_id: null, client_name: 'E2E Tax Yr', date: YEAR + '0615', type: 'Job payment', amount: 120000, method: '', notes: 'E2E tax-year seed', created_at: new Date().toISOString() });
          // Force the tax page onto this year and a deterministic filing context.
          if (typeof _taxPageYear !== 'undefined') _taxPageYear = parseInt(YEAR);
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
          set('tx-status', 'single'); set('tx-spouse', '0'); set('tx-paid', '0');

          // Independently recompute exactly what calcTax does for this year.
          const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
          const tIn = sum(income.filter(x => x.date && String(x.date).startsWith(YEAR)), x => x.amount)
                    + sum(payments.filter(x => x.amount !== 0 && x.date && String(x.date).startsWith(YEAR)), x => x.amount);
          const tEx = sum(expenses.filter(x => x.date && String(x.date).startsWith(YEAR)), x => x.amount);
          const tMi = sum(mileage.filter(x => x.date && String(x.date).startsWith(YEAR)), x => (x.miles || 0));
          const mileDed = tMi * _getIrsRateForYear(YEAR);
          const netSelf = Math.max(0, tIn - tEx - mileDed);
          const seTax = _calcSeTax(netSelf, YEAR);
          const seDed = seTax / 2;
          const agi = netSelf + 0 - seDed;
          const stdDed = _getStdDedForYear(YEAR, 'single');
          const fedTaxable = Math.max(0, agi - stdDed);
          const bkts = _getFedBracketsForYear(YEAR);
          const fedTax = Math.ceil(calcBrackets(fedTaxable, bkts.single || bkts));
          const expectSe = fmt(seTax), expectFed = fmt(fedTax);

          // Run the REAL engine and read what it rendered.
          calcTax();
          const txt = (document.getElementById('tx-results') || {}).innerText || '';
          return { expectSe, expectFed, hasSe: txt.includes(expectSe), hasFed: txt.includes(expectFed), netSelf: Math.round(netSelf), sample: txt.slice(0, 160) };
        }, YEAR);
        p.__tax = r;
        return 3; // navigate + status pick + run
      },
      rule: async (p) => {
        const r = p.__tax || {};
        return { ok: r.netSelf > 0 && r.hasSe && r.hasFed, got: `netSelf=${r.netSelf} expectSE=${r.expectSe}(${r.hasSe}) expectFed=${r.expectFed}(${r.hasFed})` };
      },
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
