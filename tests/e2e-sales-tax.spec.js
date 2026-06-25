// @ts-check
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Sales Tax Engine', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      bypassCSP: true,
    });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ── Engine functions are globally available ─────────────────────────────────
  test('calcSalesTax is defined globally', async () => {
    const defined = await page.evaluate(() => typeof calcSalesTax === 'function');
    expect(defined).toBe(true);
  });

  test('getJobTaxTreatment is defined globally', async () => {
    const defined = await page.evaluate(() => typeof getJobTaxTreatment === 'function');
    expect(defined).toBe(true);
  });

  test('lookupSalesTaxRate is defined globally', async () => {
    const defined = await page.evaluate(() => typeof lookupSalesTaxRate === 'function');
    expect(defined).toBe(true);
  });

  test('openSalesTaxSetup is defined globally', async () => {
    const defined = await page.evaluate(() => typeof openSalesTaxSetup === 'function');
    expect(defined).toBe(true);
  });

  // ── No-tax states ───────────────────────────────────────────────────────────
  test('no-tax states return zero tax', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'OR', tradeType:'electrical', scope:'repair',
        propertyType:'residential', taxRate:0, flatTotal:1000 });
      return { taxAmount: r.taxAmount, type: r.treatment.type };
    });
    expect(result.taxAmount).toBe(0);
    expect(result.type).toBe('no_tax');
  });

  test('no-tax state ignores a passed rate', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'MT', tradeType:'plumbing', scope:'repair',
        propertyType:'residential', taxRate:5, flatTotal:500 });
      return r.taxAmount;
    });
    expect(result).toBe(0);
  });

  // ── Capital improvement — contractor-as-consumer ────────────────────────────
  test('improvement scope returns zero tax (contractor-consumer)', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'KS', tradeType:'electrical', scope:'improvement',
        propertyType:'residential', taxRate:9.35, flatTotal:5000 });
      return { taxAmount: r.taxAmount, customerTax: r.treatment.customerTax };
    });
    expect(result.taxAmount).toBe(0);
    expect(result.customerTax).toBe(false);
  });

  test('improvement scope in NY still returns zero tax', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'NY', tradeType:'electrical', scope:'improvement',
        propertyType:'residential', taxRate:8.875, flatTotal:10000 });
      return { taxAmount: r.taxAmount, hasCert: !!r.treatment.certificate };
    });
    expect(result.taxAmount).toBe(0);
    expect(result.hasCert).toBe(true);
  });

  // ── Repair — materials only ─────────────────────────────────────────────────
  test('repair scope taxes materials, not labor', async () => {
    const result = await page.evaluate(() => {
      const items = [
        { desc:'Labor', total:500, lineType:'labor' },
        { desc:'Materials', total:300, lineType:'materials' },
      ];
      const r = calcSalesTax({ state:'KS', tradeType:'plumbing', scope:'repair',
        propertyType:'residential', taxRate:9.35, lineItems:items });
      return { taxAmount: r.taxAmount, taxableBase: r.taxableBase };
    });
    expect(result.taxableBase).toBe(300);
    expect(result.taxAmount).toBeCloseTo(300 * 0.0935, 2);
  });

  test('repair scope with only flatTotal applies tax to full amount', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'TX', tradeType:'plumbing', scope:'repair',
        propertyType:'residential', taxRate:8.25, flatTotal:1000 });
      return { taxAmount: r.taxAmount, taxableBase: r.taxableBase };
    });
    expect(result.taxableBase).toBe(1000);
    expect(result.taxAmount).toBeCloseTo(82.50, 2);
  });

  // ── Gross receipts (HI, NM) ─────────────────────────────────────────────────
  test('Hawaii GET applies to full contract including labor', async () => {
    const result = await page.evaluate(() => {
      const items = [
        { desc:'Labor', total:800, lineType:'labor' },
        { desc:'Materials', total:400, lineType:'materials' },
      ];
      const r = calcSalesTax({ state:'HI', tradeType:'electrical', scope:'repair',
        propertyType:'residential', taxRate:4.0, lineItems:items });
      return { taxAmount: r.taxAmount, taxableBase: r.taxableBase, type: r.treatment.type };
    });
    expect(result.type).toBe('gross_receipts');
    expect(result.taxableBase).toBe(1200);
    expect(result.taxAmount).toBeCloseTo(48, 2);
  });

  test('New Mexico GRT taxes full contract', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'NM', tradeType:'roofing', scope:'repair',
        propertyType:'commercial', taxRate:5.125, flatTotal:2000 });
      return { taxAmount: r.taxAmount, type: r.treatment.type };
    });
    expect(result.type).toBe('gross_receipts');
    expect(result.taxAmount).toBeCloseTo(102.50, 2);
  });

  // ── Landscaping service states ──────────────────────────────────────────────
  test('landscaping in TX is full-service taxable (labor + materials)', async () => {
    const result = await page.evaluate(() => {
      const items = [
        { desc:'Mowing', total:200, lineType:'labor' },
        { desc:'Mulch', total:150, lineType:'materials' },
      ];
      const r = calcSalesTax({ state:'TX', tradeType:'landscaping', scope:'repair',
        propertyType:'residential', taxRate:8.25, lineItems:items });
      return { taxAmount: r.taxAmount, taxableBase: r.taxableBase, type: r.treatment.type };
    });
    expect(result.type).toBe('service');
    expect(result.taxableBase).toBe(350);
    expect(result.taxAmount).toBeCloseTo(28.88, 2);
  });

  test('landscaping in AZ is contractor-consumer (not in ST_LANDSCAPE_SERVICE)', async () => {
    const result = await page.evaluate(() => {
      const r = calcSalesTax({ state:'AZ', tradeType:'landscaping', scope:'repair',
        propertyType:'residential', taxRate:5.6, flatTotal:500 });
      return { taxAmount: r.taxAmount, type: r.treatment.type };
    });
    expect(result.type).toBe('contractor_consumer');
    expect(result.taxAmount).toBe(0);
  });

  // ── getJobTaxTreatment ──────────────────────────────────────────────────────
  test('getJobTaxTreatment returns no_tax for AK', async () => {
    const result = await page.evaluate(() => {
      const t = getJobTaxTreatment('AK', 'electrical', 'repair', 'residential');
      return { type: t.type, customerTax: t.customerTax };
    });
    expect(result.type).toBe('no_tax');
    expect(result.customerTax).toBe(false);
  });

  test('getJobTaxTreatment returns certificate for NY capital improvement', async () => {
    const result = await page.evaluate(() => {
      const t = getJobTaxTreatment('NY', 'electrical', 'improvement', 'residential');
      return { type: t.type, certForm: t.certificate?.form };
    });
    expect(result.type).toBe('contractor_consumer');
    expect(result.certForm).toBe('ST-124');
  });

  test('getJobTaxTreatment commercial repair in CT has laborTaxable=true', async () => {
    const result = await page.evaluate(() => {
      const t = getJobTaxTreatment('CT', 'electrical', 'repair', 'commercial');
      return { laborTaxable: t.laborTaxable };
    });
    expect(result.laborTaxable).toBe(true);
  });

  test('getJobTaxTreatment residential repair in CT has laborTaxable=false', async () => {
    const result = await page.evaluate(() => {
      const t = getJobTaxTreatment('CT', 'electrical', 'repair', 'residential');
      return { laborTaxable: t.laborTaxable };
    });
    expect(result.laborTaxable).toBe(false);
  });

  // ── lookupSalesTaxRate fallback ─────────────────────────────────────────────
  test('lookupSalesTaxRate returns hardcoded base for no-tax state without network', async () => {
    const result = await page.evaluate(async () => {
      const r = await lookupSalesTaxRate('97401', 'OR');
      return { rate: r.rate, source: r.source };
    });
    expect(result.rate).toBe(0);
    expect(result.source).toBe('no_tax');
  });

  test('lookupSalesTaxRate falls back to hardcoded when DB returns null', async () => {
    const result = await page.evaluate(async () => {
      const r = await lookupSalesTaxRate('66604', 'KS');
      return { rate: r.rate };
    });
    expect(result.rate).toBeGreaterThan(0);
  });

  // ── GEI step 1 job type buttons (two-row picker) ───────────────────────────
  test('gei-prop-res (residential property) button exists in DOM', async () => {
    const count = await page.locator('#gei-prop-res').count();
    expect(count).toBe(1);
  });

  test('gei-prop-comm (commercial property) button exists in DOM', async () => {
    const count = await page.locator('#gei-prop-comm').count();
    expect(count).toBe(1);
  });

  test('gei-work-repair button exists in DOM', async () => {
    const count = await page.locator('#gei-work-repair').count();
    expect(count).toBe(1);
  });

  test('gei-work-newbuild button exists in DOM', async () => {
    const count = await page.locator('#gei-work-newbuild').count();
    expect(count).toBe(1);
  });

  test('gei-sales-tax-row exists in DOM', async () => {
    const count = await page.locator('#gei-sales-tax-row').count();
    expect(count).toBe(1);
  });

  test('gei-tax-rate-prompt exists in DOM', async () => {
    const count = await page.locator('#gei-tax-rate-prompt').count();
    expect(count).toBe(1);
  });

  // ── T&M and BYO show step 1 (job type picker) on open ──────────────────────
  test('T&M estimate shows job type picker on step 1, not TM page', async () => {
    await page.evaluate(() => {
      _geiIsTM = false; _geiIsFreeForm = false;
      // Isolation: remove any draft for this client so the estimate opens fresh on step 1
      // (a leftover draft makes openGenericEstimate resume at step 2 by design).
      if (typeof bids !== 'undefined') bids = bids.filter(b => b.client_id !== 'test-c');
      openTMEstimate({ id: 'test-c', name: 'Test', addr: '123 Main St, KS' });
    });
    await page.waitForTimeout(150);
    const s1Display = await page.evaluate(() => document.getElementById('gei-s1')?.style.display);
    const tmDisplay = await page.evaluate(() => document.getElementById('gei-tm-page')?.style.display);
    // Step 1 should be visible (display is '' or 'block'), TM page should be hidden
    expect(s1Display).not.toBe('none');
    expect(tmDisplay).toBe('none');
  });

  test('BYO estimate shows job type picker on step 1, not BYO page', async () => {
    await page.evaluate(() => {
      _geiIsTM = false; _geiIsFreeForm = false;
      // Isolation: remove any draft for this client so the estimate opens fresh on step 1
      // (a leftover draft makes openGenericEstimate resume at step 2 by design).
      if (typeof bids !== 'undefined') bids = bids.filter(b => b.client_id !== 'test-c');
      openFreeFormEstimate({ id: 'test-c', name: 'Test', addr: '123 Main St, KS' });
    });
    await page.waitForTimeout(150);
    const s1Display = await page.evaluate(() => document.getElementById('gei-s1')?.style.display);
    const byoDisplay = await page.evaluate(() => document.getElementById('gei-byo-page')?.style.display);
    expect(s1Display).not.toBe('none');
    expect(byoDisplay).toBe('none');
  });

  test('switching from T&M to Scope hides TM page', async () => {
    await page.evaluate(() => {
      openTMEstimate({ id: 'test-c', name: 'Test', addr: '123 Main St, KS' });
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      _geiIsTM = false; _geiIsFreeForm = false;
      goGeiStep(1);
    });
    await page.waitForTimeout(100);
    const tmDisplay = await page.evaluate(() => document.getElementById('gei-tm-page')?.style.display);
    expect(tmDisplay).toBe('none');
  });

  test('switching from BYO to Scope hides BYO page', async () => {
    await page.evaluate(() => {
      openFreeFormEstimate({ id: 'test-c', name: 'Test', addr: '123 Main St, KS' });
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      _geiIsTM = false; _geiIsFreeForm = false;
      goGeiStep(1);
    });
    await page.waitForTimeout(100);
    const byoDisplay = await page.evaluate(() => document.getElementById('gei-byo-page')?.style.display);
    expect(byoDisplay).toBe('none');
  });

  // ── Rate prompt behavior ────────────────────────────────────────────────────
  test('tax rate prompt hidden when no line items', async () => {
    await page.evaluate(() => {
      S.salesTaxRate = 0;
      if (typeof _geiLines !== 'undefined') _geiLines.length = 0;
      if (typeof calcGeiTotal === 'function') calcGeiTotal();
    });
    await page.waitForTimeout(100);
    const display = await page.evaluate(() =>
      document.getElementById('gei-tax-rate-prompt')?.style.display
    );
    expect(display).toBe('none');
  });

  test('tax rate prompt shows when items present but no rate set', async () => {
    await page.evaluate(() => {
      S.salesTaxRate = 0;
      if (typeof _geiLines !== 'undefined') {
        _geiLines.length = 0;
        _geiLines.push({ desc: 'Test item', qty: 1, rate: 200, total: 200 });
      }
      if (typeof _geiJobScope !== 'undefined') window._geiJobScope = 'repair';
      if (typeof calcGeiTotal === 'function') calcGeiTotal();
    });
    await page.waitForTimeout(100);
    const display = await page.evaluate(() =>
      document.getElementById('gei-tax-rate-prompt')?.style.display
    );
    expect(display).not.toBe('none');
  });

  test('tax rate prompt hidden for improvement scope even with items and no rate', async () => {
    await page.evaluate(() => {
      S.salesTaxRate = 0;
      if (typeof _geiLines !== 'undefined') {
        _geiLines.length = 0;
        _geiLines.push({ desc: 'Test item', qty: 1, rate: 200, total: 200 });
      }
      if (typeof _geiSetJobScope === 'function') _geiSetJobScope('improvement');
      else if (typeof _geiJobScope !== 'undefined') {
        window._geiJobScope = 'improvement';
        if (typeof calcGeiTotal === 'function') calcGeiTotal();
      }
    });
    await page.waitForTimeout(100);
    const display = await page.evaluate(() =>
      document.getElementById('gei-tax-rate-prompt')?.style.display
    );
    expect(display).toBe('none');
  });

  test('sales tax row shows after setting a rate with items present', async () => {
    await page.evaluate(() => {
      if (typeof _geiSetJobScope === 'function') _geiSetJobScope('repair');
      S.salesTaxRate = 9.35;
      if (typeof _geiLines !== 'undefined') {
        _geiLines.length = 0;
        _geiLines.push({ desc: 'Electrical work', qty: 1, rate: 500, total: 500 });
      }
      if (typeof calcGeiTotal === 'function') calcGeiTotal();
    });
    await page.waitForTimeout(100);
    const display = await page.evaluate(() =>
      document.getElementById('gei-sales-tax-row')?.style.display
    );
    expect(display).not.toBe('none');
  });

  // ── openSalesTaxSetup modal ─────────────────────────────────────────────────
  test('openSalesTaxSetup creates overlay in DOM', async () => {
    await page.evaluate(() => {
      document.getElementById('sales-tax-setup-overlay')?.remove();
      openSalesTaxSetup();
    });
    await page.waitForTimeout(150);
    const count = await page.locator('#sales-tax-setup-overlay').count();
    expect(count).toBe(1);
    // Clean up
    await page.evaluate(() => document.getElementById('sales-tax-setup-overlay')?.remove());
  });

  test('_stsuSave updates S.salesTaxRate and removes overlay', async () => {
    await page.evaluate(() => {
      document.getElementById('sales-tax-setup-overlay')?.remove();
      openSalesTaxSetup();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const el = document.getElementById('stsu-rate');
      if (el) el.value = '8.500';
      _stsuSave();
    });
    await page.waitForTimeout(100);
    const rate = await page.evaluate(() => S.salesTaxRate);
    const overlayGone = await page.evaluate(() => !document.getElementById('sales-tax-setup-overlay'));
    expect(rate).toBe(8.5);
    expect(overlayGone).toBe(true);
    // Restore clean state
    await page.evaluate(() => { S.salesTaxRate = 0; });
  });

  // ── Settings page field ─────────────────────────────────────────────────────
  test('set-sales-tax-rate input exists in settings panel', async () => {
    const count = await page.locator('#set-sales-tax-rate').count();
    expect(count).toBe(1);
  });

  test('loadSettingsForm populates set-sales-tax-rate from S.salesTaxRate', async () => {
    await page.evaluate(() => {
      S.salesTaxRate = 7.75;
      if (typeof loadSettingsForm === 'function') loadSettingsForm();
    });
    await page.waitForTimeout(100);
    const val = await page.evaluate(() =>
      document.getElementById('set-sales-tax-rate')?.value
    );
    expect(parseFloat(val)).toBe(7.75);
    await page.evaluate(() => { S.salesTaxRate = 0; });
  });

  test('saveSettings reads set-sales-tax-rate and updates S.salesTaxRate', async () => {
    await page.evaluate(() => {
      const el = document.getElementById('set-sales-tax-rate');
      if (el) el.value = '8.750';
      if (typeof saveSettings === 'function') saveSettings();
    });
    await page.waitForTimeout(100);
    const rate = await page.evaluate(() => S.salesTaxRate);
    expect(rate).toBeCloseTo(8.75, 3);
    await page.evaluate(() => { S.salesTaxRate = 0; });
  });

  // ── Onboarding pre-fill ─────────────────────────────────────────────────────
  test('lookupSalesTaxRate returns non-zero for taxable state', async () => {
    const result = await page.evaluate(async () => {
      const r = await lookupSalesTaxRate('', 'TX');
      return r.rate;
    });
    expect(result).toBeGreaterThan(0);
  });

  test('lookupSalesTaxRate returns zero for no-tax state', async () => {
    const result = await page.evaluate(async () => {
      const r = await lookupSalesTaxRate('', 'WY');
      return r.rate;
    });
    // WY has base rate 4%, not a no-tax state — OR/AK/MT/NH/DE are no-tax
    const rOr = await page.evaluate(async () => {
      const r = await lookupSalesTaxRate('', 'OR');
      return r.rate;
    });
    expect(rOr).toBe(0);
  });

  // ── Painting proposal HI/NM gross receipts ──────────────────────────────────
  test('ST_GROSS_RECEIPTS contains HI and NM', async () => {
    const result = await page.evaluate(() => {
      return typeof ST_GROSS_RECEIPTS !== 'undefined' &&
        !!ST_GROSS_RECEIPTS['HI'] && !!ST_GROSS_RECEIPTS['NM'];
    });
    expect(result).toBe(true);
  });

  test('ST_BASE_RATE has correct rate for HI', async () => {
    const rate = await page.evaluate(() =>
      typeof ST_BASE_RATE !== 'undefined' ? ST_BASE_RATE['HI'] : null
    );
    expect(rate).toBe(4.0);
  });

  // ── No new console errors ───────────────────────────────────────────────────
  test('zero console errors from sales tax engine', async () => {
    assertNoErrors(page, 'sales-tax');
  });
});
