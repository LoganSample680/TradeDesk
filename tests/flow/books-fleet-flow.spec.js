// REAL flow — the books & fleet lifecycle (task #7): add a vehicle through the
// actual fleet modal, log an expense through the quick-expense modal, and add a
// compliance record (license) through the licensing modal. Every action drives
// the real UI function (fleet.js saveFleetVehicle, finance.js saveQuickExpense,
// settings.js saveLicenseModal) and each assertion is a step() so a regression
// throws a one-line finding(). Vehicles + expenses round-trip through the cloud;
// licenses persist locally (zp3_lic) by design — asserted accordingly.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, type, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'books/vehicle-expense-license';

test.describe('books & fleet (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('add a vehicle, log an expense, add a license record', async ({ page }) => {
    const stamp = process.pid; // deterministic per process, unique across viewports
    const vehName = `E2E Truck ${stamp}`;
    const clientId = Date.now() * 1000 + (stamp % 1000);
    const vendor = `E2E Vendor ${stamp}`;

    // ── Vehicle via the real fleet modal ──────────────────────────────────────
    await step(page, {
      label: 'add a vehicle through the fleet modal', page: 'pg-fleet', role: 'contractor',
      suspect: 'fleet.js saveFleetVehicle (S.vehicles push + saveAll)',
      ruleText: 'saving the fleet modal must add the vehicle to S.vehicles',
      expected: `S.vehicles contains "${vehName}"`,
      act: async (p) => {
        await p.evaluate(() => { if (typeof openAddVehicleModal === 'function') openAddVehicleModal(); });
        await p.waitForSelector('#fv-name', { timeout: 10000 });
        const k = await type(p, '#fv-name', vehName);       // real key-by-key typing
        await p.evaluate(() => { saveFleetVehicle(); });      // 1 tap — Add vehicle
        await p.waitForTimeout(600);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return k + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate((nm) => {
          const v = (typeof getVehicles === 'function' ? getVehicles() : (S.vehicles || [])).find(x => x.name === nm);
          return { has: !!v };
        }, vehName);
        return { ok: r.has, got: JSON.stringify(r) };
      },
    });

    // ── Expense via the real quick-expense modal ──────────────────────────────
    await step(page, {
      label: 'log an expense through the quick-expense modal', page: 'pg-books', role: 'contractor',
      suspect: 'finance.js saveQuickExpense (expenses.unshift + saveAll)',
      ruleText: 'saving the quick-expense modal must add the expense and round-trip to cloud',
      expected: `an expense with vendor "${vendor}", amount 125`,
      act: async (p) => {
        await p.evaluate(({ clientId }) => {
          // Seed a throwaway client the expense attaches to.
          clients.push({ id: clientId, name: 'E2E Books Client', phone: '3165550111', _e2e: 'books' });
          showQuickExpenseModal(clientId);
        }, { clientId });
        await p.waitForSelector('#qe-vendor', { timeout: 10000 });
        const k1 = await type(p, '#qe-vendor', vendor);
        const k2 = await type(p, '#qe-amount', '125');
        await p.evaluate(({ clientId }) => { saveQuickExpense(clientId); }, { clientId });
        await p.waitForTimeout(600);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return k1 + k2 + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate((vn) => {
          const e = (expenses || []).find(x => x.vendor === vn);
          return e ? { vendor: e.vendor, amount: e.amount } : null;
        }, vendor);
        // TRUE end-to-end: the expense must also be in the cloud (td_expenses).
        const cloud = await cloudRows(p, 'td_expenses');
        const ce = cloud.find(e => e.vendor === vendor);
        const cloudOk = !!ce && ce.amount === 125;
        return { ok: !!r && r.amount === 125 && cloudOk, got: `mem=${JSON.stringify(r)} cloudExpense=${ce ? ce.amount : 'ROW ABSENT'}` };
      },
    });

    // ── License/compliance record via the real licensing modal ────────────────
    await step(page, {
      label: 'add a compliance record through the licensing modal', page: 'pg-licensing', role: 'contractor',
      suspect: 'settings.js saveLicenseModal (licenses push + saveAll, zp3_lic local)',
      ruleText: 'saving the licensing modal must add a record to licenses[]',
      expected: 'licenses[] grew by one record of the chosen type',
      act: async (p) => {
        const before = await p.evaluate(() => (typeof licenses !== 'undefined' ? licenses.length : 0));
        await p.evaluate(() => { if (typeof openAddLicense === 'function') openAddLicense(); });
        await p.waitForSelector('#_lic-type-sel', { timeout: 10000 });
        // Pick the first real type option (avoids hardcoding an id) and fire its
        // onchange so the dependent fields render exactly as a user's tap would.
        await p.evaluate(() => {
          const sel = document.getElementById('_lic-type-sel');
          const opt = [...sel.options].find(o => o.value);
          if (opt) { sel.value = opt.value; if (typeof _licTypeChanged === 'function') _licTypeChanged(sel); }
        });
        // Only some license types render a number field — equipment/no-number types
        // hide #_lic-num-wrap. Check real VISIBILITY (the element exists in the DOM
        // either way), so we type a number only when the chosen type actually shows it.
        const numVisible = await p.locator('#_lic-num').isVisible().catch(() => false);
        let k = 1; // the type pick
        if (numVisible) k += await type(p, '#_lic-num', `E2E-${stamp}`);
        await p.evaluate(() => { saveLicenseModal(); });
        await p.waitForTimeout(300);
        p._licBefore = before;
        return k + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate((before) => ({ before, after: (typeof licenses !== 'undefined' ? licenses.length : 0) }), p._licBefore);
        return { ok: r.after === r.before + 1, got: JSON.stringify(r) };
      },
    });

    // NO cleanup — the vehicle, expense, license + client stay in the dev account on
    // purpose so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
