// @ts-check
/**
 * One copy of each (audit 2026-10-01). The owner asked how much of the
 * proposal and invoice code is the same and to merge what could be: the
 * customer's invoice, "say it and Tim builds it", the price book list, the
 * dock bar, the deposit-law lookup and the money format. Each has one home
 * now; these tests prove the one home works and the old copies are gone.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test.describe('Shared code, one copy of each', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppBoot(page);
  });
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'shared code'); });

  test('the old copies are gone', async ({ page }) => {
    const r = await page.evaluate(() => ['_qiMoney', '_byoMoney', '_supMoney', '_qiPriceBook'].map(n => typeof window[n]));
    expect(r).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  });

  test('one money format: cents by default, whole dollars on request, and map(fmt) still gives cents', async ({ page }) => {
    const r = await page.evaluate(() => ({ a: fmt(1234.5), b: fmt(1234.5, { whole: true }), c: [5, 6].map(fmt), d: fmt('x'), e: fmt(null, { whole: true }), f: _supFmt('12.345') }));
    expect(r).toEqual({ a: '$1,234.50', b: '$1,235', c: ['$5.00', '$6.00'], d: '$0.00', e: '$0', f: '$12.35' });
  });

  test('one dock bar: Build Your Own and T&M paint the same buttons under their own ids', async ({ page }) => {
    const r = await page.evaluate(() => {
      // The page's own docks (index.html), put back as they were after.
      const b = document.getElementById('byo-dock'), t = document.getElementById('tm-dock');
      const keep = [b.innerHTML, t.innerHTML];
      _docDockPaint('byo', null); _docDockPaint('tm', { label: 'Add a step', fn: 'void 0' });
      const out = { byo: [...b.querySelectorAll('button')].map(x => x.id || x.className), tm: [...t.querySelectorAll('button')].map(x => x.id || x.className), tmLabel: t.querySelector('#tm-dock-go').textContent, state: [b.dataset.state, t.dataset.state] };
      b.innerHTML = keep[0]; t.innerHTML = keep[1]; _docDockPaint('nope', null);
      return out;
    });
    expect(r.byo).toEqual(['tm-dock-tim', 'byo-dock-sign', 'byo-dock-go']);
    expect(r.tm).toEqual(['tm-dock-tim', 'tm-dock-go']);
    expect(r.tmLabel).toBe('Add a step');
    expect(r.state).toEqual(['now', 'todo']);
  });

  test('one deposit-law lookup: the job address decides the state, a business job is under none', async ({ page }) => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('gei-addr'), was = el.value; el.value = '12 Main St, Fresno, CA 93701';
      const keep = _geiIsCommercial;
      _geiIsCommercial = false; const home = _geiDepositLaw();
      _geiIsCommercial = true; const biz = _geiDepositLaw();
      _geiIsCommercial = keep; el.value = was;
      return { st: home.st, applies: home.applies, biz: biz.applies };
    });
    expect(r).toEqual({ st: 'CA', applies: true, biz: false });
  });

  test('one price book list: the invoice and the proposal agree on what he has sold twice', async ({ page }) => {
    const r = await page.evaluate(() => {
      S.priceBook = { plumbing: [{ desc: 'Replace water heater', rate: 1400, n: 3 }, { desc: 'One-off odd job', rate: 50, n: 1 }], hvac: [{ desc: 'Furnace tune-up', rate: 129, n: 2 }] };
      return { inv: _pbList(null, { everyTrade: true }).map(p => p.desc), est: _pbList('plumbing').map(p => p.desc) };
    });
    expect(r.inv).toEqual(['Replace water heater', 'Furnace tune-up']);
    expect(r.est).toEqual(['Replace water heater']);
  });

  test('"say it and Tim builds it" is one helper that all three screens call', async () => {
    const ge = src('js/generic-estimate.js'), qi = src('js/quick-invoice.js');
    expect(ge).toMatch(/function _scopeSayBuild\(key,said,o\)/);
    expect(ge).toMatch(/function _byoTakeSaid[\s\S]{0,200}_scopeSayBuild\('byo'/);
    expect(ge).toMatch(/function _geiScopeBuild[\s\S]{0,600}_scopeSayBuild\(_geiIsTM\?'tm':null/);
    expect(qi).toMatch(/function _qiSayBuild[\s\S]{0,900}_scopeSayBuild\(hourly\?'qi':null/);
    // Only the helper calls timScopeBuild in these three files' build paths.
    expect((ge.match(/timScopeBuild\(said/g) || []).length).toBe(1);
    expect((qi.match(/timScopeBuild\(/g) || []).length).toBe(0);
  });

  test('the shared build: steps land on the list it names, parts go to Materials, junk never throws', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = _scopeSayBuild(null, 'Replace the water heater and haul away the old one', { log: false });
      let junk = 'ok';
      try { _scopeSayBuild(null, '', { log: false }); _scopeSayBuild(null, null, { log: false }); } catch (e) { junk = e.message; }
      return { steps: out.built.steps.length > 0, missed: out.missed, filled: out.filled, junk };
    });
    expect(r).toEqual({ steps: true, missed: [], filled: [], junk: 'ok' });
  });
});
