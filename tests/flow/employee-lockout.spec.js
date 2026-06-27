// SECURITY FLOW — an EMPLOYEE account must not reach financials (CLAUDE.md §13,
// task #11). Signs in as the dev contractor (so real contractor data is loaded),
// then flips the live app into employee mode via the SAME globals production sets
// on an employee login (_isEmployee / _employeeRecord, cloud.js:228) and exercises
// the real gating functions (_applyEmployeeNavGating, goPg, renderDash,
// _canViewComp). Every assertion runs through step() so a regression throws a
// one-line finding() naming the exact gate that broke.
//
// Two layers are tested separately:
//   • UI LOCKOUT (passes today) — nav hidden, money/tax/team pages redirect to
//     the dashboard, money tiles hidden, payroll/comp gated.
//   • DATA-LAYER LEAK — a SEPARATE test (employee-data-leak.spec.js) proves the
//     in-memory hole. Kept apart so this suite stays green while the architectural
//     fix is decided.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'employee-lockout/ui';

// A tech employee: collect/expenses/mileage only — NO financials, team, payroll.
const TECH_PERMS = { collect: true, expenses: true, mileage: true, leads: false, estimate: false, schedule: false, clients: false, financials: false, team: false, payroll: false };

async function becomeEmployee(page) {
  return page.evaluate((perms) => {
    window._isEmployee = true;
    window._contractorUserId = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : 'contractor';
    window._employeeRecord = {
      id: 'e2e-emp', contractor_user_id: window._contractorUserId, employee_user_id: 'e2e-emp-user',
      name: 'E2E Tech', role: 'tech', permissions: perms, active: true,
    };
    try { if (typeof _applyEmployeeNavGating === 'function') _applyEmployeeNavGating(); } catch (e) {}
    try { if (typeof applyPermissions === 'function') applyPermissions(); } catch (e) {}
    try { if (typeof renderDash === 'function') renderDash(); } catch (e) {}
    return true;
  }, TECH_PERMS);
}

test.describe('employee lockout — financials unreachable (security)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); await becomeEmployee(page); });

  test('an employee cannot reach or see financials through the UI', async ({ page }) => {
    // ── Money/Books page is hard-blocked ───────────────────────────────────
    await step(page, {
      label: 'navigate to pg-money', page: 'pg-money', role: 'employee',
      suspect: 'navigation.js goPg employee page-block list',
      ruleText: 'an employee navigating to the Money/Books page must be redirected to the dashboard',
      expected: 'active page == pg-dash (not pg-money)',
      act: async (p) => { await p.evaluate(() => { try { goPg('pg-money'); } catch (e) {} }); await p.waitForTimeout(250); return 1; },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          moneyActive: !!document.getElementById('pg-money')?.classList.contains('active'),
          dashActive: !!document.getElementById('pg-dash')?.classList.contains('active'),
        }));
        return { ok: !r.moneyActive && r.dashActive, got: `moneyActive=${r.moneyActive} dashActive=${r.dashActive}` };
      },
    });

    // ── Tax estimator is owner-only ────────────────────────────────────────
    await step(page, {
      label: 'navigate to pg-taxes', page: 'pg-taxes', role: 'employee',
      suspect: 'navigation.js goPg block-list + data.js canSeeTaxes/isOwner',
      ruleText: 'an employee must not reach the tax estimator (owner-only)',
      expected: 'pg-taxes not active AND canSeeTaxes() === false',
      act: async (p) => { await p.evaluate(() => { try { goPg('pg-taxes'); } catch (e) {} }); await p.waitForTimeout(200); return 1; },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          taxActive: !!document.getElementById('pg-taxes')?.classList.contains('active'),
          canSee: (typeof canSeeTaxes === 'function') ? canSeeTaxes() : 'nofn',
        }));
        return { ok: !r.taxActive && r.canSee === false, got: `taxActive=${r.taxActive} canSeeTaxes=${r.canSee}` };
      },
    });

    // ── Team & vehicles page blocked ───────────────────────────────────────
    await step(page, {
      label: 'navigate to pg-team', page: 'pg-team', role: 'employee',
      suspect: 'navigation.js goPg block-list',
      ruleText: 'an employee must not reach the team/vehicles page',
      expected: 'pg-team not active',
      act: async (p) => { await p.evaluate(() => { try { goPg('pg-team'); } catch (e) {} }); await p.waitForTimeout(200); return 1; },
      rule: async (p) => {
        const teamActive = await p.evaluate(() => !!document.getElementById('pg-team')?.classList.contains('active'));
        return { ok: !teamActive, got: `teamActive=${teamActive}` };
      },
    });

    // ── Financial nav entries are hidden ───────────────────────────────────
    await step(page, {
      label: 'financial nav buttons hidden', page: 'nav', role: 'employee',
      suspect: 'navigation.js _applyEmployeeNavGating hidden-id list',
      ruleText: 'the Money, Taxes, Team, and Settings nav entries must be hidden for an employee',
      expected: 'every gated nav id is display:none',
      act: async () => 0,
      rule: async (p) => {
        const vis = await p.evaluate(() => {
          const ids = ['nb-money', 'nb-taxes', 'nb-team', 'nb-settings', 'nb-tracker', 'nb-contracts'];
          const shown = ids.filter(id => { const el = document.getElementById(id); return el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'; });
          return { shown };
        });
        return { ok: vis.shown.length === 0, got: vis.shown.length ? 'still visible: ' + vis.shown.join(',') : 'all hidden' };
      },
    });

    // ── Dashboard financial tiles hidden ───────────────────────────────────
    // Real production gating (dashboard.js renderDash):
    //   • The financial KPI grid (#dash-mets-inner: Revenue/Expenses/Taxes/Profit)
    //     is ONLY rendered for contractors — for an employee kpiEl is replaced by
    //     the #emp-today-jobs view, so the money grid never enters the DOM (line 92).
    //   • #dash-close-tip is explicitly display:none for employees (line 216).
    //   • #dash-sub keeps its element but its text is BLANKED for employees
    //     (line 89: textContent=''), so no financial attention summary leaks. The
    //     element itself is NOT display:none, so we assert empty text, not hidden.
    await step(page, {
      label: 'dashboard financial tiles hidden', page: 'pg-dash', role: 'employee',
      suspect: 'dashboard.js renderDash _isEmployee gating (dash-kpi/dash-mets-inner, dash-close-tip, dash-sub)',
      ruleText: 'employee dashboard must not render the financial KPI grid or close-ratio tile, and must leak no attention financial summary',
      expected: 'dash-mets-inner absent, emp-today-jobs present, dash-close-tip hidden, dash-sub text empty',
      act: async (p) => { await p.evaluate(() => { try { renderDash(); } catch (e) {} }); await p.waitForTimeout(200); return 1; },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const hidden = id => { const el = document.getElementById(id); return !el || el.style.display === 'none' || getComputedStyle(el).display === 'none'; };
          return {
            metsPresent: !!document.getElementById('dash-mets-inner'),   // financial KPI grid (contractor-only)
            empJobsPresent: !!document.getElementById('emp-today-jobs'), // employee replacement view
            tip: hidden('dash-close-tip'),
            subText: (document.getElementById('dash-sub')?.textContent || '').trim(),
          };
        });
        const ok = !r.metsPresent && r.empJobsPresent && r.tip && r.subText === '';
        return { ok, got: `dash-mets-inner present=${r.metsPresent} emp-today-jobs present=${r.empJobsPresent} dash-close-tip hidden=${r.tip} dash-sub text=${JSON.stringify(r.subText)}` };
      },
    });

    // ── Payroll / compensation gated ───────────────────────────────────────
    await step(page, {
      label: 'comp/payroll gated', page: 'finance', role: 'employee',
      suspect: 'cloud.js _canViewComp (payroll permission)',
      ruleText: 'a tech employee without the payroll permission must not be able to view compensation',
      expected: '_canViewComp() === false',
      act: async () => 0,
      rule: async (p) => {
        const can = await p.evaluate(() => (typeof _canViewComp === 'function') ? _canViewComp() : 'nofn');
        return { ok: can === false, got: '_canViewComp=' + can };
      },
    });

    const rep = report(FLOW, BASELINE);   // capture mode
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
