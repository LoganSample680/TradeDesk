// @ts-check
/**
 * E2E tests — User-editable Sherwin-Williams paint prices
 *
 * Coverage:
 * 1. Settings → Rates & pricing renders the SW price editor with a row per
 *    product, grouped by category, prefilled with effective contractor prices
 * 2. Products without a default price show an empty input (placeholder "—")
 * 3. Changing a price + Save stores a minimal override in S.swPrices
 *    ({contractor:Number} keyed by product id — only entries that differ
 *    from the hardcoded SW_PRODUCTS defaults)
 * 4. Override survives a full page reload (persisted via localStorage zp3_S)
 *    and swEffectivePrice() returns the overridden value while SW_PRODUCTS
 *    keeps the hardcoded default
 * 5. "Reset to defaults" refills inputs; Save then clears the override
 * 6. Zero console errors throughout
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

/** Open Settings → Rates & pricing and expand the SW price editor. */
async function openRatesPanel(page) {
  await goPg(page, 'pg-settings');
  await page.evaluate(() => {
    if (typeof _openSetDetail === 'function') _openSetDetail('rates');
    const det = document.getElementById('set-sw-prices-details');
    if (det) det.open = true;
  });
  await page.waitForTimeout(200);
}

test.describe('SW paint prices — settings editor', () => {
  /** Shared browser page — create once, reuse across tests in group. */
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

  test('price list renders a row per SW product, grouped by category', async () => {
    await openRatesPanel(page);

    const info = await page.evaluate(() => {
      if (typeof SW_PRODUCTS === 'undefined') return null;
      const all = Object.values(SW_PRODUCTS).flat();
      const list = document.getElementById('set-sw-prices-list');
      const inputs = list ? list.querySelectorAll('input[id^="set-swp-"]') : [];
      const missing = all.filter(p => !document.getElementById('set-swp-' + p.id)).map(p => p.id);
      return {
        productCount: all.length,
        inputCount: inputs.length,
        missing,
        listText: list ? list.textContent : '',
      };
    });
    expect(info, 'SW_PRODUCTS must be defined').not.toBeNull();
    expect(info.missing, 'every product must have an input row').toEqual([]);
    expect(info.inputCount, 'one input per product').toBe(info.productCount);
    expect(info.inputCount).toBeGreaterThanOrEqual(30);
    // Category group headers
    for (const label of ['Interior', 'Ceiling', 'Exterior', 'Deck & Stain', 'Trim & Cabinet']) {
      expect(info.listText, `category header "${label}" must render`).toContain(label);
    }
    assertNoErrors(page, 'SW price list render');
  });

  test('old static price table is fully removed', async () => {
    const oldTable = await page.locator('#sw-price-table').count();
    expect(oldTable, 'static #sw-price-table must be gone').toBe(0);
    const oldSpans = await page.locator('[id^="spp-"]').count();
    expect(oldSpans, 'static spp-* price spans must be gone').toBe(0);
  });

  test('inputs prefill with effective contractor price; no-default products are empty with — placeholder', async () => {
    const vals = await page.evaluate(() => ({
      pm200: document.getElementById('set-swp-pm200')?.value,
      em: document.getElementById('set-swp-em')?.value,
      emPlaceholder: document.getElementById('set-swp-em')?.placeholder,
      defaultPm200: SW_PRODUCTS.interior.find(p => p.id === 'pm200')?.contractor,
    }));
    expect(vals.pm200, 'pm200 input prefilled with default contractor price').toBe(String(vals.defaultPm200));
    expect(vals.em, 'Emerald has no default price — input must be empty').toBe('');
    expect(vals.emPlaceholder, 'empty input shows — placeholder').toBe('—');
  });

  test('changing a price + Save stores a minimal S.swPrices override', async () => {
    const input = page.locator('#set-swp-pm200');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill('99');
    await input.dispatchEvent('input');
    await page.evaluate(() => typeof saveSettings === 'function' && saveSettings());
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => ({
      override: (S.swPrices && S.swPrices.pm200) || null,
      keys: Object.keys(S.swPrices || {}),
      hardcoded: SW_PRODUCTS.interior.find(p => p.id === 'pm200').contractor,
      effective: swEffectivePrice(SW_PRODUCTS.interior.find(p => p.id === 'pm200')).contractor,
    }));
    expect(state.override, 'override stored as {contractor:Number}').toEqual({ contractor: 99 });
    expect(state.keys, 'only changed products stored — no bloat').toEqual(['pm200']);
    expect(state.hardcoded, 'SW_PRODUCTS default must stay untouched').toBe(32);
    expect(state.effective, 'swEffectivePrice applies the override').toBe(99);
    assertNoErrors(page, 'save SW price override');
  });

  test('overridden price persists in the input after a full page reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await openRatesPanel(page);

    const after = await page.evaluate(() => ({
      inputVal: document.getElementById('set-swp-pm200')?.value,
      override: (S.swPrices && S.swPrices.pm200) || null,
      effective: swEffectivePrice(SW_PRODUCTS.interior.find(p => p.id === 'pm200')).contractor,
      effectiveUntouched: swEffectivePrice(SW_PRODUCTS.interior.find(p => p.id === 'sp')).contractor,
    }));
    expect(after.inputVal, 'input must show persisted override after reload').toBe('99');
    expect(after.override).toEqual({ contractor: 99 });
    expect(after.effective).toBe(99);
    expect(after.effectiveUntouched, 'non-overridden products keep defaults').toBe(37);
    assertNoErrors(page, 'SW price persists across reload');
  });

  test('Reset to defaults refills inputs; Save clears the override', async () => {
    await page.evaluate(() => typeof _resetSwPriceInputs === 'function' && _resetSwPriceInputs());
    const refilled = await page.evaluate(() => document.getElementById('set-swp-pm200')?.value);
    expect(refilled, 'reset refills the hardcoded default').toBe('32');

    // Reset only touches inputs — override still saved until Save is hit
    const beforeSave = await page.evaluate(() => (S.swPrices && S.swPrices.pm200) || null);
    expect(beforeSave).toEqual({ contractor: 99 });

    await page.evaluate(() => typeof saveSettings === 'function' && saveSettings());
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({
      override: (S.swPrices && S.swPrices.pm200) || null,
      keys: Object.keys(S.swPrices || {}),
      effective: swEffectivePrice(SW_PRODUCTS.interior.find(p => p.id === 'pm200')).contractor,
    }));
    expect(state.override, 'override removed when input matches default').toBeNull();
    expect(state.keys).toEqual([]);
    expect(state.effective, 'effective price back to hardcoded default').toBe(32);
    assertNoErrors(page, 'reset SW prices to defaults');
  });

  test('zero console errors across SW price editor session', async () => {
    assertNoErrors(page, 'SW price editor session');
  });
});
