// @ts-check
// ── NUMBER-ONLY FIELDS (js/utils.js data-num listener) ──────────────────────
//
// Owner (2026-10-01): "everywhere a number only field should be entered, we
// don't want a number only field like phones, dollars, percentages etc to ever
// allow a character."
//
// One delegated listener cleans every field tagged data-num="<kind>" before
// its own oninput runs. These tests type with page.keyboard (real key events,
// the way a thumb does it), check each kind strips letters, e, + and -, keeps
// the caret where the person left it, and that the code reading each converted
// field still gets the right number once commas are in the value.
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// A visible scratch field of one kind, focused, cleared.
async function scratch(page, kind) {
  await page.evaluate(k => {
    document.getElementById('_numt')?.remove();
    const el = document.createElement('input');
    el.id = '_numt'; el.type = 'text'; el.setAttribute('data-num', k);
    el.style.cssText = 'position:fixed;top:4px;left:4px;width:300px;z-index:2147483647;font-size:16px';
    document.body.appendChild(el);
    el.focus();
  }, kind);
  await page.locator('#_numt').click();
}
const val = page => page.evaluate(() => document.getElementById('_numt').value);
const caret = page => page.evaluate(() => document.getElementById('_numt').selectionStart);

test.describe('number-only fields', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── Each kind ──────────────────────────────────────────────────────────────
  const CASES = [
    ['money', '12a3e4+5-6.789', '123,456.78'],
    ['rate', '-7x5.5.0', '75.50'],
    ['pct', '9e.3+5-0', '9.350'],
    ['pct', '150', '100'],
    ['dec', '-1.2.3x', '1.23'],
    ['int', '4e2-7.5', '4275'],
    ['phone', '316abc555+0101', '316-555-0101'],
    ['zip', '6721a45-99', '67214'],
    ['ein', '12a3456789', '12-3456789'],
    ['date', '10a012026', '10/01/2026'],
    ['ym', '03a/2018', '03/2018'],
    ['ym', '2018', '2018'],
  ];
  for (const [kind, typed, want] of CASES) {
    test(`${kind}: typing "${typed}" leaves "${want}"`, async () => {
      await scratch(page, kind);
      await page.keyboard.type(typed);
      expect(await val(page)).toBe(want);
    });
  }

  test('a paste with letters and a dollar sign comes out clean', async () => {
    await scratch(page, 'money');
    await page.keyboard.insertText('$1,2a34.5');
    expect(await val(page)).toBe('1,234.5');
    await scratch(page, 'int');
    await page.keyboard.insertText('48,2x50 mi');
    expect(await val(page)).toBe('48250');
  });

  test('phone autofill "+1 (316) 555-0101" becomes 316-555-0101', async () => {
    await scratch(page, 'phone');
    await page.locator('#_numt').fill('+1 (316) 555-0101');
    expect(await val(page)).toBe('316-555-0101');
    // fmtPhone itself, which the older oninput="fmtPhone(this)" fields call.
    const direct = await page.evaluate(() => { const el = document.createElement('input'); el.value = '+1 316 555 0101'; fmtPhone(el); return el.value; });
    expect(direct).toBe('316-555-0101');
  });

  test('the caret stays where the person left it', async () => {
    await scratch(page, 'money');
    await page.keyboard.type('1234567');
    expect(await val(page)).toBe('1,234,567');
    // Put the caret after "1,2" and type a 9: a comma moves, the caret follows the digit.
    await page.evaluate(() => document.getElementById('_numt').setSelectionRange(3, 3));
    await page.keyboard.type('9');
    expect(await val(page)).toBe('12,934,567');
    expect(await caret(page)).toBe(4);
    // A letter in the middle is dropped and the caret does not jump to the end.
    await scratch(page, 'phone');
    await page.keyboard.type('3165550101');
    await page.evaluate(() => document.getElementById('_numt').setSelectionRange(3, 3));
    await page.keyboard.type('x');
    expect(await val(page)).toBe('316-555-0101');
    expect(await caret(page)).toBe(3);
  });

  test('_numVal reads an id or an element, strips commas, junk is 0', async () => {
    const r = await page.evaluate(() => {
      const el = document.createElement('input'); el.id = '_numv'; el.value = '12,345.6'; document.body.appendChild(el);
      const out = { byId: _numVal('_numv'), byEl: _numVal(el), missing: _numVal('_nope'), blank: (el.value = '', _numVal(el)), nv: (el.value = '1,200', nv('_numv')) };
      el.remove(); return out;
    });
    expect(r).toEqual({ byId: 12345.6, byEl: 12345.6, missing: 0, blank: 0, nv: 1200 });
  });

  test('zPrompt num: number pad and no letters', async () => {
    await page.evaluate(() => { window._zpGot = null; zPrompt('How much?', v => { window._zpGot = v; }, { title: 'Test', num: 'money' }); });
    const inp = page.locator('#zprompt-inp');
    await expect(inp).toHaveAttribute('inputmode', 'decimal');
    await inp.click();
    await page.keyboard.type('1a2b3c4');
    await expect(inp).toHaveValue('1,234');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window._zpGot)).toBe('1,234');
  });

  // ── Real fields, real readers ──────────────────────────────────────────────
  test('Settings: a pay rate and a goal with letters typed save the right numbers', async () => {
    await goPg(page, 'pg-settings');
    await page.evaluate(() => {
      loadSettingsForm();
      // Fields live in folded sections; show them so a thumb could reach them.
      for (const id of ['set-owner-pay-rate', 'set-goal-monthly', 'set-labor-burden']) {
        let el = document.getElementById(id);
        while (el && el !== document.body) { if (getComputedStyle(el).display === 'none') el.style.display = 'block'; el = el.parentElement; }
      }
    });
    for (const [id, typed, shown] of [['set-owner-pay-rate', '4a5.5', '45.5'], ['set-goal-monthly', '12k000', '12,000'], ['set-labor-burden', '3x0', '30']]) {
      const loc = page.locator('#' + id);
      await loc.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(typed);
      await expect(loc).toHaveValue(shown);
    }
    const s = await page.evaluate(() => { saveSettings(); return { rate: S.ownerPayRate, goal: S.goalMonthly, burden: S.laborBurden }; });
    expect(s.rate).toBe(45.5);
    expect(s.goal).toBe(12000);
    expect(s.burden).toBeCloseTo(1.3, 5);
  });

  test('Fleet: an odometer with letters typed saves as a whole number', async () => {
    await goPg(page, 'pg-team');
    await page.evaluate(() => openAddVehicleModal(-1));
    await page.locator('#fv-name').fill('2021 Chevy Express');
    await page.locator('#fv-podo').click();
    await page.keyboard.type('45a1e23');
    await expect(page.locator('#fv-podo')).toHaveValue('45123');
    const odo = await page.evaluate(() => { saveFleetVehicle(); const v = getVehicles(); return v[v.length - 1].purchaseOdo; });
    expect(odo).toBe(45123);
  });

  test('T&M: a typed rate over 999 still computes (commas are read out)', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('tm-rate');
      el.value = '1250'; el.dispatchEvent(new Event('input', { bubbles: true }));
      return { shown: el.value, rate: _tmRatePerMan };
    });
    expect(r.shown).toBe('1,250');
    expect(r.rate).toBe(1250);
  });

  test('the cancel refund modal reads a comma amount right', async () => {
    const r = await page.evaluate(() => {
      const mk = (id, kind) => { const el = document.createElement('input'); el.id = id; el.setAttribute('data-num', kind); document.body.appendChild(el); return el; };
      const m = mk('_cr-mat', 'money'); m.dataset.paid = '5000';
      const res = document.createElement('div'); res.id = '_cr-result'; document.body.appendChild(res);
      m.value = '1200x'; m.dispatchEvent(new Event('input', { bubbles: true }));
      _crCalc();
      const out = { shown: m.value, text: res.textContent };
      m.remove(); res.remove();
      return out;
    });
    expect(r.shown).toBe('1,200');
    expect(r.text).toContain('$3,800.00');
  });

  // ── Static: every listed field is converted, the free text ones are not ────
  test('no type="number" input is left in index.html or the js builders', () => {
    const files = ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
    const hits = [];
    for (const f of files) {
      read(f).split('\n').forEach((l, i) => {
        if (/^\s*\/\//.test(l)) return; // comments that mention the old type
        if (/<input[^>]*type=["']number["']/.test(l) || /type="number"/.test(l)) hits.push(f + ':' + (i + 1));
      });
    }
    expect(hits).toEqual([]);
  });

  test('every converted field carries data-num', () => {
    const idx = read('index.html');
    const want = {
      'index.html': ['cf-year-built', 'pay-amount', 'tm-rate', 'tm-hours', 'tm-nte-cap', 'gei-tax-pct', 's-value', 's-days',
        'tx-spouse', 'tx-paid', 'tx-prior-yr', 'tx-prior-yr-agi', 'set-since-year', 'set-sales-tax-rate', 'set-labor-burden', 'set-owner-pay-rate',
        'set-goal-monthly', 'set-margin', 'set-deposit-pct', 'set-est-valid-days', 'set-cov', 'set-mm', 'set-supplies-rate', 'set-labor-rate-generic',
        'set-finance-charge-pct', 'tr-tm-area', 'tr-tm-roof', 'tr-tm-dist', 'tr-scan-wall', 'set-scan-price', 'set-scan-rate', 'set-irs', 'cf-zip', 'set-bzip'],
      'js/agreements.js': ['_ag-pct'], 'js/bids.js': ['_cr-mat'], 'js/dashboard.js': ['goal-prompt-input'], 'js/finance.js': ['em-amount', '_inc-amt'],
      'js/fleet.js': ['odo-start', 'odo-end', 'fv-podo', 'fs-odo', 'maint-odo', 'maint-cost', 'm-next-mi'],
      'js/generic-estimate.js': ['_ffa-qty', '_ffa-rate', '_ff-qty', '_ff-labor', '_ff-mat', 'ind-qty', 'ind-custom-sqft', 'stsu-rate', 'stsu-zip', 'byo-dep-in', '_bya-qty'],
      'js/jobs.js': ['asub-amount'], 'js/mileage.js': ['_odo-val', 'end-miles-modal'], 'js/scan-estimate.js': ['_se-qty-inp'], 'js/scan.js': ['_scan-ach'],
      'js/supply-list.js': ['sup-markup'], 'js/true-measure.js': ['tm-c-qty', 'tm-c-rate'], 'js/wh-board.js': ['_wh-phone'], 'js/cloud.js': ['sub-ein'],
      'js/quick-invoice.js': ['qi-new-rate', 'qi-fixed'], 'js/timesheet.js': ['ts-rate'], 'js/settings.js': ['_hepa-date'],
      'intake.html': ['f-phone', 'f-zip'], 'client.html': ['onb-zip'],
    };
    const missing = [];
    for (const [f, ids] of Object.entries(want)) {
      const src = f === 'index.html' ? idx : read(f);
      for (const id of ids) {
        // Every opening <input tag carrying this id (a hidden mirror of the
        // same id, like _bya-qty in the price-only sheet, is not typed into).
        let at = src.indexOf('id="' + id + '"'), seen = 0;
        while (at >= 0) {
          const around = src.slice(src.lastIndexOf('<input', at), src.indexOf('>', at));
          if (!/type="hidden"/.test(around)) { seen++; if (!/data-num="[a-z]+"/.test(around)) missing.push(f + '#' + id); }
          at = src.indexOf('id="' + id + '"', at + 1);
        }
        if (!seen) missing.push(f + '#' + id + ' (not found)');
      }
    }
    expect(missing).toEqual([]);
    // The equipment Installed field takes a year or MM/YYYY.
    expect(read('js/equipment.js')).toContain("fld('_eq-installed','Installed',p.installed,'2018 or 03/2018','type=\"text\" data-num=\"ym\"");
  });

  test('the three free-text fields stay free text', () => {
    const near = (src, id) => { const at = src.indexOf('id="' + id + '"'); return src.slice(src.lastIndexOf('<input', at), src.indexOf('>', at)); };
    for (const [f, id] of [['js/cloud.js', 'sub-rate'], ['index.html', 'gei-duration'], ['js/fleet.js', 'm-bat-cca']]) {
      const tag = near(read(f), id);
      expect(tag, f + '#' + id).toContain('id="' + id + '"');
      expect(tag).not.toContain('data-num');
      expect(tag).not.toMatch(/inputmode="(numeric|decimal)"/);
    }
  });

  test('intake.html (no utils.js): phone and zip take digits only', async ({ browser }) => {
    const { _supabaseShimIntake } = require('./helpers');
    const ctx = await browser.newContext({ bypassCSP: true });
    const p = await ctx.newPage();
    await mockAllExternal(p);
    await p.route(u => u.href.includes('supabase') && (u.href.includes('/js/vendor/') || u.href.includes('cdn.jsdelivr.net')),
      route => route.fulfill({ status: 200, contentType: 'application/javascript', body: _supabaseShimIntake().replace(/table==='accounts'/g, "(table==='accounts'||table==='account_public')") }));
    await p.goto('/intake.html?a=acct-e2e-0001', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForSelector('#pg-form', { state: 'visible', timeout: 10000 });
    await p.locator('#f-phone').click();
    await p.keyboard.type('785abc5550142');
    await expect(p.locator('#f-phone')).toHaveValue('785-555-0142');
    await p.locator('#f-phone').fill('+1 (316) 555-0101');
    await expect(p.locator('#f-phone')).toHaveValue('316-555-0101');
    await p.locator('#f-zip').click();
    await p.keyboard.type('66a6-1234');
    await expect(p.locator('#f-zip')).toHaveValue('66612');
    assertNoErrors(p, 'intake number fields');
    await ctx.close();
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'number-only fields');
  });
});
