// REAL correctness flow — the sales-tax + income-tax engines (task #16). Unlike
// the seeding-driven flows, this drives the PURE production tax functions
// (sales-tax.js calcSalesTax/getJobTaxTreatment, utils.js calcBrackets) with
// known inputs and asserts known-correct outputs. Tax math is where a contractor
// gets audited — every rule here is a documented treatment that must never drift.
// Each case is a step() so a regression throws a one-line finding() naming the
// exact tax rule that broke.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'tax/engine-correctness';

test.describe('sales-tax + income-tax engine correctness', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('sales-tax treatments and income-tax brackets compute exactly', async ({ page }) => {
    // ── Capital improvement (painting, KS, residential): NO customer tax — the
    // contractor pays tax on materials at purchase. taxAmount must be 0. ──
    await step(page, {
      label: 'KS capital improvement → no customer tax', page: 'sales-tax', role: 'contractor',
      suspect: 'sales-tax.js getJobTaxTreatment improvement branch',
      ruleText: 'a residential capital-improvement paint job must charge the client $0 sales tax',
      expected: 'taxAmount=0, treatment=contractor_consumer',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => calcSalesTax({ state: 'KS', tradeType: 'painting', scope: 'improvement', propertyType: 'residential', taxRate: 9.35, materialsTotal: 1000, laborTotal: 2000 }));
        return { ok: r.taxAmount === 0 && r.treatment.type === 'contractor_consumer', got: `taxAmount=${r.taxAmount} type=${r.treatment.type}` };
      },
    });

    // ── Residential REPAIR (KS): materials taxable, labor exempt. 1000 * 9.35%. ──
    await step(page, {
      label: 'KS residential repair → materials taxable only', page: 'sales-tax', role: 'contractor',
      suspect: 'sales-tax.js calcSalesTax repair branch (labor exempt residential)',
      ruleText: 'a residential repair must tax materials only: $1000 @ 9.35% = $93.50',
      expected: 'taxAmount=93.5, taxableBase=1000',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => calcSalesTax({ state: 'KS', tradeType: 'painting', scope: 'repair', propertyType: 'residential', taxRate: 9.35, materialsTotal: 1000, laborTotal: 2000 }));
        return { ok: r.taxAmount === 93.5 && r.taxableBase === 1000, got: `taxAmount=${r.taxAmount} base=${r.taxableBase}` };
      },
    });

    // ── No-sales-tax state (OR): always $0 regardless of rate passed. ──
    await step(page, {
      label: 'no-tax state (OR) → zero', page: 'sales-tax', role: 'contractor',
      suspect: 'sales-tax.js ST_NO_TAX set',
      ruleText: 'a job in Oregon (no state sales tax) must charge $0 even if a rate is supplied',
      expected: 'taxAmount=0, treatment=no_tax',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => calcSalesTax({ state: 'OR', tradeType: 'painting', scope: 'repair', propertyType: 'residential', taxRate: 8.0, materialsTotal: 5000, laborTotal: 3000 }));
        return { ok: r.taxAmount === 0 && r.treatment.type === 'no_tax', got: `taxAmount=${r.taxAmount} type=${r.treatment.type}` };
      },
    });

    // ── COMMERCIAL repair in a commercial-labor state (CT): labor AND materials
    // taxable. (1000 + 2000) * 6.35% = 190.50. ──
    await step(page, {
      label: 'CT commercial repair → labor + materials taxable', page: 'sales-tax', role: 'contractor',
      suspect: 'sales-tax.js ST_COMMERCIAL_LABOR + repair branch',
      ruleText: 'a commercial repair in CT must tax labor + materials: $3000 @ 6.35% = $190.50',
      expected: 'taxAmount=190.5, laborTaxable=true',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => calcSalesTax({ state: 'CT', tradeType: 'painting', scope: 'repair', propertyType: 'commercial', taxRate: 6.35, materialsTotal: 1000, laborTotal: 2000 }));
        return { ok: r.taxAmount === 190.5 && r.treatment.laborTaxable === true, got: `taxAmount=${r.taxAmount} laborTaxable=${r.treatment.laborTaxable}` };
      },
    });

    // ── Classified line items: only the materials line is taxed (KS residential
    // repair). labor 2000 exempt, materials 1000 @ 10% = 100. ──
    await step(page, {
      label: 'classified line items → only materials taxed', page: 'sales-tax', role: 'contractor',
      suspect: 'sales-tax.js calcSalesTax lineItems lineType branch',
      ruleText: 'with classified line items, a residential repair taxes only the materials line: $1000 @ 10% = $100',
      expected: 'taxAmount=100, taxableBase=1000',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => calcSalesTax({ state: 'KS', tradeType: 'painting', scope: 'repair', propertyType: 'residential', taxRate: 10, lineItems: [{ desc: 'Labor', total: 2000, lineType: 'labor' }, { desc: 'Paint', total: 1000, lineType: 'materials' }] }));
        return { ok: r.taxAmount === 100 && r.taxableBase === 1000, got: `taxAmount=${r.taxAmount} base=${r.taxableBase}` };
      },
    });

    // ── Income tax bracket math (utils.js calcBrackets): progressive sum.
    // 100k over [10k@10%, 40k@12%, ∞@22%] = 1000 + 3600 + 13200 = 17800. ──
    await step(page, {
      label: 'progressive income brackets sum exactly', page: 'tax', role: 'contractor',
      suspect: 'utils.js calcBrackets',
      ruleText: 'calcBrackets must apply each rate to its slice: $100k → $17,800',
      expected: 'calcBrackets(100000, [[10000,.1],[40000,.12],[Inf,.22]]) === 17800',
      act: async () => 0,
      rule: async (p) => {
        const v = await p.evaluate(() => calcBrackets(100000, [[10000, 0.1], [40000, 0.12], [Infinity, 0.22]]));
        return { ok: v === 17800, got: 'calcBrackets=' + v };
      },
    });

    const rep = report(FLOW, BASELINE);   // capture mode (pure computation, 0 clicks)
    expect(rep.overBudget).toBe(false);
  });
});
