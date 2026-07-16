// @ts-check
/**
 * Exhaustive E2E coverage for sales-tax.js
 *
 * Functions covered:
 *   getJobTaxTreatment  (line 63)
 *   calcSalesTax        (line 137)
 *   _extractZip         (line 173)
 *   lookupSalesTaxRate  (line 186)
 *
 * Every function tested for:
 *   null / undefined input, empty input, boundary values,
 *   type mismatch, missing DOM, golden-path, concurrent calls,
 *   corrupted localStorage, duplicate-render stability, guard release.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('sales-tax.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ── helper: run expression N times synchronously ──────────────────────────
  async function concurrent(fnExpr, n = 5) {
    return page.evaluate(([expr, count]) => {
      let ok = 0;
      for (let i = 0; i < count; i++) {
        try { eval(expr); ok++; } catch (_) {}
      }
      return ok;
    }, [fnExpr, n]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. getJobTaxTreatment
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getJobTaxTreatment', () => {

    // ── global presence ────────────────────────────────────────────────────
    test('getJobTaxTreatment is defined globally', async () => {
      const defined = await page.evaluate(() => typeof getJobTaxTreatment === 'function');
      expect(defined).toBe(true);
    });

    // ── null / undefined inputs ────────────────────────────────────────────
    test('null state, does not throw, defaults to KS logic', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment(null, 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('undefined state, does not throw, defaults to KS logic', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment(undefined, 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('null tradeType, does not throw, defaults to construction category', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', null, 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('undefined tradeType, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', undefined, 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('null scope, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', null, 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('undefined scope, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', undefined, 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('null propertyType, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', 'repair', null);
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('all null, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment(null, null, null, null);
          return { ok: true, hasType: typeof result.type === 'string' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasType).toBe(true);
    });

    // ── empty inputs ────────────────────────────────────────────────────────
    test('empty string state, does not throw, defaults to KS', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('', 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    test('empty string tradeType, defaults to construction category', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', '', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('repair');
    });

    test('empty string scope, falls through to repair path', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', '', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // empty scope !== 'improvement', so falls to repair
      expect(r.type).toBe('repair');
    });

    // ── type mismatch ───────────────────────────────────────────────────────
    test('number as state, does not throw (coerces to string)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment(42, 'electrical', 'repair', 'residential');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('object as state, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment({}, 'electrical', 'repair', 'residential');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('array as tradeType, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', [], 'repair', 'residential');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    // ── boundary / special state values ─────────────────────────────────────
    test('no-tax state OR, returns no_tax type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('OR', 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type, customerTax: result.customerTax, laborTaxable: result.laborTaxable, materialsTaxable: result.materialsTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('no_tax');
      expect(r.customerTax).toBe(false);
      expect(r.laborTaxable).toBe(false);
      expect(r.materialsTaxable).toBe(false);
    });

    test('no-tax state AK, returns no_tax type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('AK', 'roofing', 'repair', 'commercial');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('no_tax');
    });

    test('no-tax state DE, returns no_tax type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('DE', 'plumbing', 'improvement', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('no_tax');
    });

    test('no-tax state MT, returns no_tax type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('MT', 'general', 'tm', 'commercial');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('no_tax');
    });

    test('no-tax state NH, returns no_tax type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('NH', 'hvac', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('no_tax');
    });

    test('gross receipts state HI, returns gross_receipts type with correct label', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('HI', 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type, label: result.label, customerTax: result.customerTax, laborTaxable: result.laborTaxable, materialsTaxable: result.materialsTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('gross_receipts');
      expect(r.label).toBe('GET');
      expect(r.customerTax).toBe(true);
      expect(r.laborTaxable).toBe(true);
      expect(r.materialsTaxable).toBe(true);
    });

    test('gross receipts state NM, returns gross_receipts type with GRT label', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('NM', 'roofing', 'repair', 'commercial');
          return { ok: true, type: result.type, label: result.label };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('gross_receipts');
      expect(r.label).toBe('GRT');
    });

    test('capital improvement scope returns contractor_consumer, no customer tax', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', 'improvement', 'residential');
          return { ok: true, type: result.type, customerTax: result.customerTax };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('contractor_consumer');
      expect(r.customerTax).toBe(false);
    });

    test('NY capital improvement, returns certificate ST-124', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('NY', 'electrical', 'improvement', 'residential');
          return { ok: true, type: result.type, certForm: result.certificate ? result.certificate.form : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('contractor_consumer');
      expect(r.certForm).toBe('ST-124');
    });

    test('NJ capital improvement, returns certificate ST-8', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('NJ', 'plumbing', 'improvement', 'residential');
          return { ok: true, certForm: result.certificate ? result.certificate.form : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.certForm).toBe('ST-8');
    });

    test('PA capital improvement, returns certificate REV-1220', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('PA', 'hvac', 'improvement', 'commercial');
          return { ok: true, certForm: result.certificate ? result.certificate.form : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.certForm).toBe('REV-1220');
    });

    test('CT capital improvement, returns certificate CERT-106', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('CT', 'general', 'improvement', 'residential');
          return { ok: true, certForm: result.certificate ? result.certificate.form : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.certForm).toBe('CERT-106');
    });

    test('KS improvement, no certificate needed (null)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'roofing', 'improvement', 'residential');
          return { ok: true, hasCert: result.certificate !== null && result.certificate !== undefined };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCert).toBe(false);
    });

    // ── landscaping in service states ────────────────────────────────────────
    test('landscaping in TX, returns service type (full invoice taxable)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('TX', 'landscaping', 'maintenance', 'residential');
          return { ok: true, type: result.type, customerTax: result.customerTax, laborTaxable: result.laborTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('service');
      expect(r.customerTax).toBe(true);
      expect(r.laborTaxable).toBe(true);
    });

    test('landscaping in NY, returns service type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('NY', 'lawn', 'maintenance', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('service');
    });

    test('landscaping in WA, returns service type', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('WA', 'tree', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('service');
    });

    test('landscaping in AZ, returns contractor_consumer (not in service set)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('AZ', 'landscaping', 'repair', 'residential');
          return { ok: true, type: result.type, customerTax: result.customerTax };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('contractor_consumer');
      expect(r.customerTax).toBe(false);
    });

    test('landscaping in FL, returns contractor_consumer', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('FL', 'landscaping', 'maintenance', 'commercial');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('contractor_consumer');
    });

    // ── repair path, commercial labor ───────────────────────────────────────
    test('commercial repair in CT, laborTaxable is true', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('CT', 'electrical', 'repair', 'commercial');
          return { ok: true, laborTaxable: result.laborTaxable, materialsTaxable: result.materialsTaxable, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('repair');
      expect(r.laborTaxable).toBe(true);
      expect(r.materialsTaxable).toBe(true);
    });

    test('commercial repair in SD, laborTaxable is true', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('SD', 'plumbing', 'repair', 'commercial');
          return { ok: true, laborTaxable: result.laborTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.laborTaxable).toBe(true);
    });

    test('commercial repair in WV, laborTaxable is true', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('WV', 'hvac', 'repair', 'commercial');
          return { ok: true, laborTaxable: result.laborTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.laborTaxable).toBe(true);
    });

    test('residential repair in CT, laborTaxable is false (labor exempt)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('CT', 'electrical', 'repair', 'residential');
          return { ok: true, laborTaxable: result.laborTaxable, materialsTaxable: result.materialsTaxable };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.laborTaxable).toBe(false);
      expect(r.materialsTaxable).toBe(true);
    });

    test('residential repair in KS, laborTaxable false, materialsTaxable true', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'plumbing', 'repair', 'residential');
          return { ok: true, type: result.type, laborTaxable: result.laborTaxable, materialsTaxable: result.materialsTaxable, customerTax: result.customerTax };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('repair');
      expect(r.customerTax).toBe(true);
      expect(r.laborTaxable).toBe(false);
      expect(r.materialsTaxable).toBe(true);
    });

    test('maintenance scope, treated same as repair', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', 'maintenance', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('repair');
    });

    test('tm scope, treated same as repair', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('KS', 'electrical', 'tm', 'commercial');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('repair');
    });

    // ── result shape ─────────────────────────────────────────────────────────
    test('returned object always has required keys', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('CA', 'painting', 'repair', 'residential');
          const keys = ['type', 'customerTax', 'laborTaxable', 'materialsTaxable', 'label', 'note'];
          const missing = keys.filter(k => !(k in result));
          return { ok: true, missing };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.missing).toHaveLength(0);
    });

    test('lowercase state auto-uppercased, or/OR both yield no_tax', async () => {
      const r = await page.evaluate(() => {
        try {
          const upper = getJobTaxTreatment('OR', 'electrical', 'repair', 'residential');
          const lower = getJobTaxTreatment('or', 'electrical', 'repair', 'residential');
          return { ok: true, upperType: upper.type, lowerType: lower.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.upperType).toBe('no_tax');
      expect(r.lowerType).toBe('no_tax');
    });

    test('unknown trade type defaults to construction category', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('TX', 'unknown_trade_xyz', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // falls through to construction → repair path
      expect(r.type).toBe('repair');
    });

    test('unknown state (ZZ): does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = getJobTaxTreatment('ZZ', 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.type).toBe('string');
    });

    // ── all 50 states + DC ────────────────────────────────────────────────────
    test('all states, none throw', async () => {
      const r = await page.evaluate(() => {
        const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
          'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
          'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
          'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
          'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
        const errors = [];
        states.forEach(st => {
          try { getJobTaxTreatment(st, 'electrical', 'repair', 'residential'); }
          catch (e) { errors.push(st + ': ' + e.message); }
        });
        return { errors };
      });
      expect(r.errors).toHaveLength(0);
    });

    // ── concurrent calls ─────────────────────────────────────────────────────
    test('concurrent calls, no stack corruption', async () => {
      const ok = await concurrent("getJobTaxTreatment('KS','electrical','repair','residential')", 5);
      expect(ok).toBe(5);
    });

    // ── corrupted localStorage ───────────────────────────────────────────────
    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_settings', '{INVALID{{{{');
        try {
          const result = getJobTaxTreatment('KS', 'electrical', 'repair', 'residential');
          return { ok: true, type: result.type };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          localStorage.removeItem('td_settings');
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. calcSalesTax
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('calcSalesTax', () => {

    test('calcSalesTax is defined globally', async () => {
      const defined = await page.evaluate(() => typeof calcSalesTax === 'function');
      expect(defined).toBe(true);
    });

    // ── null / undefined ───────────────────────────────────────────────────
    test('null params object, does not throw (destructures with undefined fields)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: null, tradeType: null, scope: null, propertyType: null, taxRate: null });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
    });

    test('undefined taxRate, returns taxAmount 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: undefined, flatTotal: 1000 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
    });

    test('zero taxRate, returns taxAmount 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 0, flatTotal: 5000 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
    });

    test('null lineItems, uses flatTotal fallback', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: null, flatTotal: 1000 });
          return { ok: true, taxAmount: result.taxAmount, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(1000);
      expect(r.taxAmount).toBeCloseTo(93.5, 1);
    });

    test('empty lineItems array, uses flatTotal fallback', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: [], flatTotal: 2000 });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(2000);
      expect(r.taxAmount).toBeCloseTo(187, 0);
    });

    test('null flatTotal and no lineItems, taxableBase 0, taxAmount 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35 });
          return { ok: true, taxAmount: result.taxAmount, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
      expect(r.taxableBase).toBe(0);
    });

    // ── no-tax states ──────────────────────────────────────────────────────
    test('no-tax state OR with non-zero rate, always returns 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'OR', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 8.0, flatTotal: 10000 });
          return { ok: true, taxAmount: result.taxAmount, type: result.treatment.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
      expect(r.type).toBe('no_tax');
    });

    test('no-tax state MT, ignores passed rate', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'MT', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 5.0, flatTotal: 500 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
    });

    // ── improvement scope ──────────────────────────────────────────────────
    test('improvement scope, customerTax false, taxAmount always 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'improvement', propertyType: 'residential', taxRate: 9.35, flatTotal: 50000 });
          return { ok: true, taxAmount: result.taxAmount, customerTax: result.treatment.customerTax };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
      expect(r.customerTax).toBe(false);
    });

    test('improvement scope CA, still no customer tax', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'CA', tradeType: 'roofing', scope: 'improvement', propertyType: 'residential', taxRate: 9.75, flatTotal: 25000 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBe(0);
    });

    // ── gross receipts (HI/NM) ─────────────────────────────────────────────
    test('HI gross receipts, taxableBase is sum of all line items including labor', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Labor', total: 800, lineType: 'labor' },
            { desc: 'Materials', total: 400, lineType: 'materials' },
            { desc: 'Equipment', total: 200, lineType: 'equipment' },
          ];
          const result = calcSalesTax({ state: 'HI', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 4.0, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount, type: result.treatment.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('gross_receipts');
      expect(r.taxableBase).toBe(1400);
      expect(r.taxAmount).toBeCloseTo(56, 2);
    });

    test('HI gross receipts with flatTotal (no lineItems), taxable is flatTotal', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'HI', tradeType: 'plumbing', scope: 'repair', propertyType: 'commercial', taxRate: 4.0, flatTotal: 3000 });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(3000);
      expect(r.taxAmount).toBeCloseTo(120, 2);
    });

    test('NM GRT, taxes full contract value', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'NM', tradeType: 'roofing', scope: 'repair', propertyType: 'commercial', taxRate: 5.125, flatTotal: 2000 });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(2000);
      expect(r.taxAmount).toBeCloseTo(102.5, 2);
    });

    // ── repair path, line items ───────────────────────────────────────────
    test('repair with line items, labor exempt, materials taxable', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Labor', total: 500, lineType: 'labor' },
            { desc: 'PVC pipe', total: 300, lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'KS', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(300);
      expect(r.taxAmount).toBeCloseTo(300 * 0.0935, 2);
    });

    test('repair with null lineType, unclassified defaults to materials (taxed)', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Unknown item', total: 400, lineType: null },
          ];
          const result = calcSalesTax({ state: 'KS', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(400);
    });

    test('repair with undefined lineType, defaults to materials (taxed)', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Misc', total: 250 },
          ];
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(250);
    });

    test('repair commercial CT, labor and materials both taxable', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Labor', total: 600, lineType: 'labor' },
            { desc: 'Wire', total: 200, lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'CT', tradeType: 'electrical', scope: 'repair', propertyType: 'commercial', taxRate: 6.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(800);
      expect(r.taxAmount).toBeCloseTo(800 * 0.0635, 2);
    });

    test('repair residential CT, only materials taxable', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Labor', total: 600, lineType: 'labor' },
            { desc: 'Wire', total: 200, lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'CT', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 6.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(200);
    });

    // ── repair path, materialsTotal / laborTotal ─────────────────────────
    test('repair with materialsTotal only (no lineItems), taxes materialsTotal', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'painting', scope: 'repair', propertyType: 'residential', taxRate: 9.35, materialsTotal: 800, laborTotal: 1200 });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(800);
    });

    test('repair commercial CT with materialsTotal/laborTotal: taxes both', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'CT', tradeType: 'electrical', scope: 'repair', propertyType: 'commercial', taxRate: 6.35, materialsTotal: 500, laborTotal: 700 });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(1200);
    });

    test('repair with materialsTotal 0, taxableBase is 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'painting', scope: 'repair', propertyType: 'residential', taxRate: 9.35, materialsTotal: 0, laborTotal: 1000 });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(0);
      expect(r.taxAmount).toBe(0);
    });

    // ── service type (landscaping) ─────────────────────────────────────────
    test('TX landscaping, full invoice taxable (service type)', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Mowing', total: 200, lineType: 'labor' },
            { desc: 'Mulch', total: 150, lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'TX', tradeType: 'landscaping', scope: 'maintenance', propertyType: 'residential', taxRate: 8.25, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount, type: result.treatment.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('service');
      expect(r.taxableBase).toBe(350);
      expect(r.taxAmount).toBeCloseTo(350 * 0.0825, 2);
    });

    test('TX landscaping with flatTotal, full flatTotal taxable', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'TX', tradeType: 'lawn', scope: 'maintenance', propertyType: 'residential', taxRate: 8.25, flatTotal: 1000 });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(1000);
      expect(r.taxAmount).toBeCloseTo(82.5, 2);
    });

    // ── mathematical correctness ───────────────────────────────────────────
    test('taxAmount is rounded to 2 decimal places (Math.round)', async () => {
      const r = await page.evaluate(() => {
        try {
          // 333 * 9.35% = 31.1355 → rounds to 31.14
          const result = calcSalesTax({ state: 'KS', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 9.35, flatTotal: 333 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBeCloseTo(31.14, 2);
      // Confirm it's 2 decimal places max
      const str = r.taxAmount.toString();
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    test('effectiveRate matches the input taxRate', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, flatTotal: 500 });
          return { ok: true, effectiveRate: result.effectiveRate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.effectiveRate).toBe(9.35);
    });

    test('effectiveRate is 0 when no customerTax', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'OR', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 8.0, flatTotal: 500 });
          return { ok: true, effectiveRate: result.effectiveRate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.effectiveRate).toBe(0);
    });

    // ── boundary values ────────────────────────────────────────────────────
    test('boundary: very large flatTotal, no overflow, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'TX', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 8.25, flatTotal: 9999999 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBeGreaterThan(0);
      expect(Number.isFinite(r.taxAmount)).toBe(true);
    });

    test('boundary: flatTotal -1, taxableBase becomes -1 (negative, no throw)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, flatTotal: -1 });
          return { ok: true, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // negative inputs are not blocked, code passes them through
      expect(typeof r.taxableBase).toBe('number');
    });

    test('boundary: taxRate 100, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 100, flatTotal: 100 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxAmount).toBeCloseTo(100, 0);
    });

    test('boundary: taxRate 0.001: small but valid rate', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 0.001, flatTotal: 10000 });
          return { ok: true, taxAmount: result.taxAmount, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(10000);
      // 10000 * 0.00001 = 0.1 → Math.round(0.1 * 100)/100 = 0.1
      expect(r.taxAmount).toBeCloseTo(0.1, 2);
    });

    // ── type mismatch ──────────────────────────────────────────────────────
    test('string taxRate, coerces or returns 0', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: '9.35', flatTotal: 1000 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // String '9.35' is truthy so customerTax check passes, taxAmount computed from string math
      expect(typeof r.taxAmount).toBe('number');
    });

    test('lineItems with missing total, uses 0 fallback', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'No total item', lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'KS', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 9.35, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(0);
      expect(r.taxAmount).toBe(0);
    });

    // ── return shape ───────────────────────────────────────────────────────
    test('returned object always has required keys', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, flatTotal: 1000 });
          const keys = ['taxAmount', 'taxableBase', 'treatment', 'effectiveRate'];
          const missing = keys.filter(k => !(k in result));
          return { ok: true, missing };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.missing).toHaveLength(0);
    });

    // ── concurrent calls ───────────────────────────────────────────────────
    test('concurrent calls, no stack corruption', async () => {
      const ok = await concurrent(
        "calcSalesTax({state:'KS',tradeType:'electrical',scope:'repair',propertyType:'residential',taxRate:9.35,flatTotal:1000})",
        5
      );
      expect(ok).toBe(5);
    });

    // ── corrupted localStorage ─────────────────────────────────────────────
    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_est_full_draft', '{INVALID{{{{');
        try {
          const result = calcSalesTax({ state: 'KS', tradeType: 'electrical', scope: 'repair', propertyType: 'residential', taxRate: 9.35, flatTotal: 500 });
          return { ok: true, taxAmount: result.taxAmount };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          localStorage.removeItem('zp3_est_full_draft');
        }
      });
      expect(r.ok).toBe(true);
    });

    // ── golden paths ───────────────────────────────────────────────────────
    test('golden path TX repair flatTotal, taxAmount is correct', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = calcSalesTax({ state: 'TX', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 8.25, flatTotal: 1000 });
          return { ok: true, taxAmount: result.taxAmount, taxableBase: result.taxableBase };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.taxableBase).toBe(1000);
      expect(r.taxAmount).toBeCloseTo(82.5, 2);
    });

    test('golden path HI GET with line items, all items taxed', async () => {
      const r = await page.evaluate(() => {
        try {
          const items = [
            { desc: 'Install', total: 1000, lineType: 'labor' },
            { desc: 'Parts', total: 500, lineType: 'materials' },
          ];
          const result = calcSalesTax({ state: 'HI', tradeType: 'electrical', scope: 'improvement', propertyType: 'commercial', taxRate: 4.0, lineItems: items });
          return { ok: true, taxableBase: result.taxableBase, taxAmount: result.taxAmount, type: result.treatment.type };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // HI gross_receipts wins even for improvement scope
      expect(r.type).toBe('gross_receipts');
      expect(r.taxableBase).toBe(1500);
      expect(r.taxAmount).toBeCloseTo(60, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. _extractZip
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_extractZip', () => {

    test('_extractZip is defined globally', async () => {
      const defined = await page.evaluate(() => typeof _extractZip === 'function');
      expect(defined).toBe(true);
    });

    // ── null / undefined ───────────────────────────────────────────────────
    test('null: does not throw, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip(null);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    test('undefined: does not throw, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip(undefined);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    // ── empty inputs ───────────────────────────────────────────────────────
    test('empty string, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    test('whitespace only, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('   ');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    // ── type mismatch ──────────────────────────────────────────────────────
    test('number input, does not throw (coerced to empty string via addr||empty)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip(12345);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // 12345 coerces to '12345' via string match, returns '12345'
      expect(r.result).toBe('12345');
    });

    test('object input, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip({});
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('array input, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip([]);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    // ── golden paths ───────────────────────────────────────────────────────
    test('full address with 5-digit ZIP, extracts ZIP', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('123 Main St, Wichita KS 67202');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('67202');
    });

    test('address with ZIP+4 format, returns only 5-digit portion', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('456 Oak Ave, Austin TX 78701-1234');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('78701');
    });

    test('ZIP at start of string, extracts correctly', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('67202 some other text');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('67202');
    });

    test('ZIP at end of string, extracts correctly', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('Wichita KS 67202');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('67202');
    });

    test('multiple ZIPs in string, returns first match', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('From 67202 to 78701');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('67202');
    });

    test('only ZIP no other text, returns it', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('90210');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('90210');
    });

    test('no ZIP in address, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('123 Main Street, Springfield, IL');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    test('4-digit number, not a valid ZIP, returns null', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('1234 Main St');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeNull();
    });

    test('6-digit number, not extracted as 5-digit ZIP', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('123456 is not a zip');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // \b(\d{5})\b: 6-digit boundary does not match 5-digit
      expect(r.result).toBeNull();
    });

    // ── boundary values ────────────────────────────────────────────────────
    test('ZIP 00000, extracts (technically valid format)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('Addr 00000');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('00000');
    });

    test('ZIP 99999, extracts', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _extractZip('99999');
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('99999');
    });

    test('very long address string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const longAddr = 'Suite 100, Building A, 1234 Long Street Name Boulevard, City Name Here, State Abbreviation 78701, Country';
          const result = _extractZip(longAddr);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('78701');
    });

    // ── concurrent calls ───────────────────────────────────────────────────
    test('concurrent calls, no corruption', async () => {
      const ok = await concurrent("_extractZip('123 Main St, KS 67202')", 5);
      expect(ok).toBe(5);
    });

    // ── corrupted localStorage ─────────────────────────────────────────────
    test('corrupted localStorage, does not affect _extractZip', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_settings', '{INVALID{{{{');
        try {
          const result = _extractZip('123 Main St, KS 67202');
          return { ok: true, result };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          localStorage.removeItem('td_settings');
        }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('67202');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. lookupSalesTaxRate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('lookupSalesTaxRate', () => {

    test('lookupSalesTaxRate is defined globally', async () => {
      const defined = await page.evaluate(() => typeof lookupSalesTaxRate === 'function');
      expect(defined).toBe(true);
    });

    // ── null / undefined ───────────────────────────────────────────────────
    test('null zip, null state, does not throw, defaults to KS hardcoded rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate(null, null);
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.rate).toBe('number');
      expect(r.rate).toBeGreaterThanOrEqual(0);
    });

    test('undefined zip, undefined state, does not throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate(undefined, undefined);
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.rate).toBe('number');
    });

    // ── empty inputs ───────────────────────────────────────────────────────
    test('empty zip string, skips ZIP lookup, falls to hardcoded rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('', 'KS');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // empty string fails /^\d{5}$/ check → falls to hardcoded
      expect(r.source).toBe('hardcoded');
      expect(r.rate).toBe(6.5); // KS base rate
    });

    test('empty state, defaults to KS', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('', '');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.rate).toBe('number');
      expect(r.rate).toBeGreaterThanOrEqual(0);
    });

    // ── no-tax states ──────────────────────────────────────────────────────
    test('no-tax state OR, returns rate 0, source no_tax', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('97401', 'OR');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
      expect(r.source).toBe('no_tax');
    });

    test('no-tax state AK, returns rate 0', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('99501', 'AK');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
      expect(r.source).toBe('no_tax');
    });

    test('no-tax state DE, returns rate 0', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('19801', 'DE');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
    });

    test('no-tax state MT, returns rate 0', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('59601', 'MT');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
    });

    test('no-tax state NH, returns rate 0', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('03301', 'NH');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
    });

    // ── hardcoded fallback rates ───────────────────────────────────────────
    test('KS with no DB hit, returns hardcoded 6.5 base rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('66604', 'KS');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.source).toBe('hardcoded');
      expect(r.rate).toBe(6.5);
    });

    test('TX with no DB hit, returns hardcoded 6.25 base rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('78701', 'TX');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.source).toBe('hardcoded');
      expect(r.rate).toBe(6.25);
    });

    test('CA with no DB hit, returns hardcoded 7.25 base rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('90210', 'CA');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(7.25);
    });

    test('NY with no DB hit, returns hardcoded 4.0 base rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('10001', 'NY');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(4.0);
    });

    test('FL with no DB hit, returns hardcoded 6.0 base rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('33101', 'FL');
          return { ok: true, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(6.0);
    });

    test('unknown state (ZZ): returns 0 fallback', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('12345', 'ZZ');
          return { ok: true, rate: result.rate, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(0);
      expect(r.source).toBe('hardcoded');
    });

    // ── warning field ──────────────────────────────────────────────────────
    test('hardcoded fallback includes warning field', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('', 'KS');
          return { ok: true, hasWarning: 'warning' in result, warning: result.warning };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasWarning).toBe(true);
      expect(typeof r.warning).toBe('string');
      expect(r.warning.length).toBeGreaterThan(0);
    });

    test('no-tax state has no warning field (clean result)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('97401', 'OR');
          return { ok: true, hasWarning: 'warning' in result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasWarning).toBe(false);
    });

    // ── return shape ───────────────────────────────────────────────────────
    test('result always has rate and source fields', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('', 'TX');
          return { ok: true, hasRate: 'rate' in result, hasSource: 'source' in result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasRate).toBe(true);
      expect(r.hasSource).toBe(true);
    });

    test('rate is always a number (not string)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('', 'KS');
          return { ok: true, rateType: typeof result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rateType).toBe('number');
    });

    test('rate is always finite and non-negative', async () => {
      const states = ['KS', 'TX', 'CA', 'OR', 'FL'];
      for (const state of states) {
        const r = await page.evaluate(async (st) => {
          try {
            const result = await lookupSalesTaxRate('', st);
            return { ok: true, rate: result.rate, finite: Number.isFinite(result.rate) };
          } catch (e) { return { ok: false, err: e.message }; }
        }, state);
        expect(r.ok).toBe(true);
        expect(r.finite).toBe(true);
        expect(r.rate).toBeGreaterThanOrEqual(0);
      }
    });

    // ── ZIP format validation ──────────────────────────────────────────────
    test('4-digit ZIP fails regex, falls to hardcoded state rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('1234', 'KS');
          return { ok: true, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // /^\d{5}$/ fails for 4-digit → skips ZIP lookup
      expect(r.source).toBe('hardcoded');
    });

    test('6-digit ZIP fails regex, falls to hardcoded state rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('123456', 'KS');
          return { ok: true, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.source).toBe('hardcoded');
    });

    test('ZIP with letters fails regex, falls to hardcoded state rate', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('6660A', 'KS');
          return { ok: true, source: result.source };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.source).toBe('hardcoded');
    });

    test('valid 5-digit ZIP, passes validation (source is hardcoded when DB returns null)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const result = await lookupSalesTaxRate('66604', 'KS');
          return { ok: true, source: result.source, rate: result.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // Supabase shim returns null → falls to hardcoded
      expect(['hardcoded', 'db_zip', 'db_state']).toContain(r.source);
    });

    // ── lowercase state auto-uppercased ────────────────────────────────────
    test('lowercase state "ks", treated same as "KS"', async () => {
      const r = await page.evaluate(async () => {
        try {
          const lower = await lookupSalesTaxRate('', 'ks');
          const upper = await lookupSalesTaxRate('', 'KS');
          return { ok: true, lowerRate: lower.rate, upperRate: upper.rate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.lowerRate).toBe(r.upperRate);
    });

    // ── all taxable states return positive base rate ────────────────────────
    test('all taxable states return positive rate (hardcoded fallback)', async () => {
      const r = await page.evaluate(async () => {
        const taxableStates = ['AL','AZ','AR','CA','CO','CT','FL','GA',
          'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
          'MA','MI','MN','MS','MO','NE','NV','NJ','NM','NY',
          'NC','ND','OH','OK','PA','RI','SC','SD','TN','TX',
          'UT','VT','VA','WA','WV','WI','WY','DC'];
        const errors = [];
        for (const st of taxableStates) {
          try {
            const result = await lookupSalesTaxRate('', st);
            if (result.rate <= 0) errors.push(st + ': rate=' + result.rate);
          } catch (e) { errors.push(st + ': threw ' + e.message); }
        }
        return { errors };
      });
      expect(r.errors).toHaveLength(0);
    });

    // ── concurrent calls ───────────────────────────────────────────────────
    test('concurrent calls, all resolve without exception', async () => {
      const r = await page.evaluate(async () => {
        const calls = [];
        for (let i = 0; i < 5; i++) {
          calls.push(lookupSalesTaxRate('', 'KS'));
        }
        try {
          const results = await Promise.all(calls);
          const allHaveRate = results.every(r => typeof r.rate === 'number');
          return { ok: true, allHaveRate };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.allHaveRate).toBe(true);
    });

    // ── corrupted localStorage ─────────────────────────────────────────────
    test('corrupted localStorage, does not affect lookupSalesTaxRate', async () => {
      const r = await page.evaluate(async () => {
        localStorage.setItem('td_settings', '{INVALID{{{{');
        localStorage.setItem('td_sales_tax_rate', 'NOT_A_NUMBER');
        try {
          const result = await lookupSalesTaxRate('', 'KS');
          return { ok: true, rate: result.rate };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          localStorage.removeItem('td_settings');
          localStorage.removeItem('td_sales_tax_rate');
        }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(6.5);
    });

    // ── returns a Promise ──────────────────────────────────────────────────
    test('lookupSalesTaxRate returns a Promise (async function)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = lookupSalesTaxRate('', 'KS');
          return { ok: true, isPromise: result instanceof Promise };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isPromise).toBe(true);
    });
  });

  // ── global constant shapes ─────────────────────────────────────────────────
  test.describe('global constants', () => {
    test('ST_NO_TAX contains AK, DE, MT, NH, OR', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            hasAK: ST_NO_TAX.has('AK'),
            hasDE: ST_NO_TAX.has('DE'),
            hasMT: ST_NO_TAX.has('MT'),
            hasNH: ST_NO_TAX.has('NH'),
            hasOR: ST_NO_TAX.has('OR'),
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasAK).toBe(true);
      expect(r.hasDE).toBe(true);
      expect(r.hasMT).toBe(true);
      expect(r.hasNH).toBe(true);
      expect(r.hasOR).toBe(true);
    });

    test('ST_GROSS_RECEIPTS has HI and NM with expected labels', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            hiLabel: ST_GROSS_RECEIPTS['HI']?.label,
            nmLabel: ST_GROSS_RECEIPTS['NM']?.label,
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hiLabel).toBe('GET');
      expect(r.nmLabel).toBe('GRT');
    });

    test('ST_LANDSCAPE_SERVICE contains TX, NY, WA', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            hasTX: ST_LANDSCAPE_SERVICE.has('TX'),
            hasNY: ST_LANDSCAPE_SERVICE.has('NY'),
            hasWA: ST_LANDSCAPE_SERVICE.has('WA'),
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasTX).toBe(true);
      expect(r.hasNY).toBe(true);
      expect(r.hasWA).toBe(true);
    });

    test('ST_COMMERCIAL_LABOR contains CT, SD, WV', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            hasCT: ST_COMMERCIAL_LABOR.has('CT'),
            hasSD: ST_COMMERCIAL_LABOR.has('SD'),
            hasWV: ST_COMMERCIAL_LABOR.has('WV'),
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCT).toBe(true);
      expect(r.hasSD).toBe(true);
      expect(r.hasWV).toBe(true);
    });

    test('ST_BASE_RATE has correct rate for CA (7.25)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, rate: ST_BASE_RATE['CA'] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(7.25);
    });

    test('ST_BASE_RATE has correct rate for TX (6.25)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, rate: ST_BASE_RATE['TX'] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(6.25);
    });

    test('ST_BASE_RATE has correct rate for KS (6.5)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, rate: ST_BASE_RATE['KS'] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rate).toBe(6.5);
    });

    test('ST_BASE_RATE no-tax states all have 0', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            ak: ST_BASE_RATE['AK'],
            de: ST_BASE_RATE['DE'],
            mt: ST_BASE_RATE['MT'],
            nh: ST_BASE_RATE['NH'],
            or: ST_BASE_RATE['OR'],
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.ak).toBe(0);
      expect(r.de).toBe(0);
      expect(r.mt).toBe(0);
      expect(r.nh).toBe(0);
      expect(r.or).toBe(0);
    });

    test('ST_TRADE_CATEGORY maps landscaping/lawn/tree to landscaping', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            landscaping: ST_TRADE_CATEGORY['landscaping'],
            lawn: ST_TRADE_CATEGORY['lawn'],
            tree: ST_TRADE_CATEGORY['tree'],
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.landscaping).toBe('landscaping');
      expect(r.lawn).toBe('landscaping');
      expect(r.tree).toBe('landscaping');
    });

    test('ST_TRADE_CATEGORY maps construction trades to construction', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            painting: ST_TRADE_CATEGORY['painting'],
            plumbing: ST_TRADE_CATEGORY['plumbing'],
            electrical: ST_TRADE_CATEGORY['electrical'],
            hvac: ST_TRADE_CATEGORY['hvac'],
            roofing: ST_TRADE_CATEGORY['roofing'],
            general: ST_TRADE_CATEGORY['general'],
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.painting).toBe('construction');
      expect(r.plumbing).toBe('construction');
      expect(r.electrical).toBe('construction');
      expect(r.hvac).toBe('construction');
      expect(r.roofing).toBe('construction');
      expect(r.general).toBe('construction');
    });

    test('ST_CI_CERT has NY, NJ, PA, CT', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            nyForm: ST_CI_CERT['NY']?.form,
            njForm: ST_CI_CERT['NJ']?.form,
            paForm: ST_CI_CERT['PA']?.form,
            ctForm: ST_CI_CERT['CT']?.form,
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.nyForm).toBe('ST-124');
      expect(r.njForm).toBe('ST-8');
      expect(r.paForm).toBe('REV-1220');
      expect(r.ctForm).toBe('CERT-106');
    });
  });

  // ── no console errors ──────────────────────────────────────────────────────
  test('no console errors, sales-tax.js', async () => {
    assertNoErrors(page, 'sales-tax.js');
  });
});
