// @ts-check
/**
 * E2E tests — Settings persistence, field by field.
 *
 * Born from a production regression where Settings fields silently reverted:
 * background syncs called loadSettingsForm() while the user was editing,
 * erasing typed-but-unsaved values, and stale merges overwrote saved ones.
 *
 * Coverage:
 * 1. EVERY user-editable Settings field: fill → Save → full page reload →
 *    value persists in both S and the form input
 * 2. Updating ONE field preserves every other previously saved field
 *    (the last save wins WITHOUT collateral data loss)
 * 3. Background form refills (_refillSettingsFormUnlessEditing) never
 *    clobber in-progress edits while the Settings page is open
 * 4. onStateChange() updates only the tax-rate inputs — other unsaved
 *    fields keep their typed values
 * 5. saveSettings() stamps a monotonically increasing settingsTs
 * 6. Zero console errors throughout
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

/**
 * Every persisted Settings field: input id → S key → two distinct test values.
 * `s1`/`s2` are the expected S values after save (numbers stay numbers).
 */
const FIELDS = [
  { id: 'set-bname',              key: 'bname',            v1: 'Bobs Painting LLC',          v2: 'Sample Painting Co',          s1: 'Bobs Painting LLC',          s2: 'Sample Painting Co' },
  { id: 'set-baddr',              key: 'baddr',            v1: '1242 N Saint Francis Ave',   v2: '500 E Douglas Ave',           s1: '1242 N Saint Francis Ave',   s2: '500 E Douglas Ave' },
  { id: 'set-bcity',              key: 'bcity',            v1: 'Wichita',                    v2: 'Derby',                       s1: 'Wichita',                    s2: 'Derby' },
  { id: 'set-bzip',               key: 'bzip',             v1: '67214',                      v2: '67037',                       s1: '67214',                      s2: '67037' },
  { id: 'set-bstate-display',     key: 'state',            v1: 'KS',                         v2: 'MO',                          s1: 'KS',                         s2: 'MO' },
  { id: 'set-bphone',             key: 'bphone',           v1: '316-555-0182',               v2: '316-555-0199',                s1: '316-555-0182',               s2: '316-555-0199' },
  { id: 'set-bemail',             key: 'bemail',           v1: 'bob@bobspainting.com',       v2: 'office@samplepainting.com',   s1: 'bob@bobspainting.com',       s2: 'office@samplepainting.com' },
  { id: 'set-blic',               key: 'blic',             v1: 'KS-PNT-2026-001',            v2: 'MO-PNT-2026-002',             s1: 'KS-PNT-2026-001',            s2: 'MO-PNT-2026-002' },
  { id: 'set-byears',             key: 'byears',           v1: '12',                         v2: '13',                          s1: 12,                           s2: 13 },
  { id: 'set-sales-tax-rate',     key: 'salesTaxRate',     v1: '9.35',                       v2: '8.5',                         s1: 9.35,                         s2: 8.5 },
  { id: 'set-review-url',         key: 'reviewUrl',        v1: 'https://g.page/r/bobspaint', v2: 'https://g.page/r/samplepaint',s1: 'https://g.page/r/bobspaint', s2: 'https://g.page/r/samplepaint' },
  { id: 'set-subdomain',          key: 'subdomain',        v1: 'bobspainting',               v2: 'samplepainting',              s1: 'bobspainting',               s2: 'samplepainting' },
  { id: 'set-bwebsite',           key: 'bwebsite',         v1: 'https://bobspainting.com',   v2: 'https://samplepainting.com',  s1: 'https://bobspainting.com',   s2: 'https://samplepainting.com' },
  { id: 'set-labor-rate',         key: 'laborRate',        v1: '55',                         v2: '60',                          s1: 55,                           s2: 60 },
  { id: 'set-finance-charge-pct', key: 'financeChargePct', v1: '2.5',                        v2: '1.8',                         s1: 2.5,                          s2: 1.8 },
  { id: 'set-custom-terms',       key: 'customTerms',      v1: 'E2E custom proposal terms',  v2: 'E2E updated proposal terms',  s1: 'E2E custom proposal terms',  s2: 'E2E updated proposal terms' },
  { id: 'set-co-terms',           key: 'coTerms',          v1: 'E2E change order terms',     v2: 'E2E updated CO terms',        s1: 'E2E change order terms',     s2: 'E2E updated CO terms' },
  { id: 'set-goal-monthly',       key: 'goalMonthly',      v1: '15000',                      v2: '18000',                       s1: 15000,                        s2: 18000 },
  { id: 'set-margin',             key: 'margin',           v1: '35',                         v2: '38',                          s1: 35,                           s2: 38 },
  { id: 'set-cov',                key: 'cov',              v1: '400',                        v2: '420',                         s1: 400,                          s2: 420 },
  { id: 'set-mm',                 key: 'mm',               v1: '25',                         v2: '30',                          s1: 25,                           s2: 30 },
];

/** Set fields by id (works on hidden inputs inside closed detail panels) and Save. */
async function fillAndSave(page, pairs) {
  await page.evaluate((pairs) => {
    for (const [id, val] of pairs) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
    if (typeof saveSettings === 'function') saveSettings();
  }, pairs);
  await page.waitForTimeout(300);
}

/** Read input values + S values for a list of fields. */
async function readState(page, fields) {
  return page.evaluate((fields) => {
    const out = {};
    for (const f of fields) {
      const el = document.getElementById(f.id);
      out[f.key] = { input: el ? el.value : null, s: S[f.key] };
    }
    return out;
  }, fields);
}

test.describe('Settings persistence — every field', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('every settings field persists its saved value across a full page reload', async () => {
    await goPg(page, 'pg-settings');
    await fillAndSave(page, FIELDS.map(f => [f.id, f.v1]));

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-settings');
    await page.waitForTimeout(300);

    const state = await readState(page, FIELDS);
    for (const f of FIELDS) {
      expect(state[f.key].s, `S.${f.key} must hold the saved value after reload`).toBe(f.s1);
      expect(String(state[f.key].input), `#${f.id} input must show the saved value after reload`).toBe(String(f.v1));
    }
    assertNoErrors(page, 'all settings fields persist across reload');
  });

  test('updating one field preserves every other saved field (no collateral loss)', async () => {
    // Self-seed: retries run in a fresh context where the previous test never ran
    await goPg(page, 'pg-settings');
    await fillAndSave(page, FIELDS.map(f => [f.id, f.v1]));

    // Change ONLY the business name, save again
    const bname = FIELDS.find(f => f.key === 'bname');
    await fillAndSave(page, [[bname.id, bname.v2]]);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-settings');
    await page.waitForTimeout(300);

    const state = await readState(page, FIELDS);
    expect(state.bname.s, 'updated field must hold the NEW value').toBe(bname.s2);
    for (const f of FIELDS) {
      if (f.key === 'bname') continue;
      expect(state[f.key].s, `S.${f.key} must keep its previous value after an unrelated save`).toBe(f.s1);
      expect(String(state[f.key].input), `#${f.id} must keep its previous value after an unrelated save`).toBe(String(f.v1));
    }
    assertNoErrors(page, 'single-field update keeps all other fields');
  });

  test('background form refill never clobbers in-progress edits on the Settings page', async () => {
    await goPg(page, 'pg-settings');
    await fillAndSave(page, FIELDS.map(f => [f.id, f.v1]));

    // TYPE new values WITHOUT saving (real input events set the dirty flag),
    // then simulate the background sync refill (broadcast from another device /
    // auto rate refresh) that used to wipe edits.
    const result = await page.evaluate(() => {
      const type = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      type('set-baddr', 'TYPED BUT NOT SAVED');
      type('set-bemail', 'typing@inprogress.com');
      if (typeof _refillSettingsFormUnlessEditing !== 'function') return { missing: true };
      _refillSettingsFormUnlessEditing();
      return {
        missing: false,
        baddr: document.getElementById('set-baddr').value,
        bemail: document.getElementById('set-bemail').value,
      };
    });
    expect(result.missing, '_refillSettingsFormUnlessEditing must exist').toBe(false);
    expect(result.baddr, 'in-progress address edit must survive a background refill').toBe('TYPED BUT NOT SAVED');
    expect(result.bemail, 'in-progress email edit must survive a background refill').toBe('typing@inprogress.com');

    // A CLEAN settings page (no unsaved typing) MUST refresh — that is how a
    // change saved on another device appears live on this one.
    const cleanPage = await page.evaluate(() => {
      loadSettingsForm(); // rerender → clears the dirty flag
      S.baddr = 'UPDATED FROM ANOTHER DEVICE';
      _refillSettingsFormUnlessEditing();
      return document.getElementById('set-baddr').value;
    });
    expect(cleanPage, 'clean Settings page must show changes from another device').toBe('UPDATED FROM ANOTHER DEVICE');

    // Away from the Settings page the refill MUST also run
    const offPage = await page.evaluate(() => {
      S.baddr = '1242 N Saint Francis Ave';
      goPg('pg-dash');
      _refillSettingsFormUnlessEditing();
      return document.getElementById('set-baddr').value;
    });
    expect(offPage, 'refill runs normally when Settings page is not active').toBe('1242 N Saint Francis Ave');
    assertNoErrors(page, 'background refill guard');
  });

  test('onStateChange updates tax inputs only — unsaved fields keep typed values', async () => {
    await goPg(page, 'pg-settings');
    await fillAndSave(page, FIELDS.map(f => [f.id, f.v1]));

    const result = await page.evaluate(() => {
      document.getElementById('set-baddr').value = 'UNSAVED ADDRESS EDIT';
      document.getElementById('set-custom-terms').value = 'UNSAVED TERMS EDIT';
      onStateChange('MO');
      return {
        baddr: document.getElementById('set-baddr').value,
        terms: document.getElementById('set-custom-terms').value,
        ksl: document.getElementById('set-ksl').value,
        state: S.state,
        moLow: STATE_TAX.MO.low,
      };
    });
    expect(result.state, 'S.state updated by onStateChange').toBe('MO');
    expect(parseFloat(result.ksl), 'tax-rate input updated to the new state').toBe(result.moLow);
    expect(result.baddr, 'unsaved address must survive a state change').toBe('UNSAVED ADDRESS EDIT');
    expect(result.terms, 'unsaved terms must survive a state change').toBe('UNSAVED TERMS EDIT');
    assertNoErrors(page, 'onStateChange preserves unsaved edits');
  });

  test('saveSettings stamps a monotonically increasing settingsTs', async () => {
    await goPg(page, 'pg-settings');
    const ts = await page.evaluate(async () => {
      saveSettings();
      const first = S.settingsTs;
      await new Promise(r => setTimeout(r, 30));
      saveSettings();
      return { first, second: S.settingsTs };
    });
    expect(ts.first, 'settingsTs stamped on save').toBeGreaterThan(0);
    expect(ts.second, 'settingsTs increases with each save').toBeGreaterThan(ts.first);
    // The stamp must survive reload — it is what the cloud merge compares
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    const after = await page.evaluate(() => S.settingsTs);
    expect(after, 'settingsTs persists in zp3_S across reload').toBeGreaterThanOrEqual(ts.second);
    assertNoErrors(page, 'settingsTs monotonic + persistent');
  });

  test('zero console errors across settings persistence session', async () => {
    assertNoErrors(page, 'settings persistence session');
  });
});
