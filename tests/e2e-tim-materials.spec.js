// @ts-check
/**
 * WHAT HE SAID HE IS BUYING, INTO MATERIALS (owner 2026-09-28)
 *
 * "Material part quantities and actual material is gonna be huge for speed.
 * Talk to Tim stays in the material section as well, in the proposals and the
 * invoices."
 *
 * Held here:
 *   - timSaidMaterials reads a count, a selling unit and the thing, by shape,
 *     for trades Tim has no catalog for;
 *   - work is never taken for a purchase ("install 6 recessed lights",
 *     "replace about 60 feet of fascia");
 *   - what the customer supplies is not on the list, and a correction wins;
 *   - a line that is only a shopping list is not a step on the contract;
 *   - T&M and Build Your Own: a priced item becomes a Materials row at his
 *     book price, an unpriced one goes on the supply house list in the same
 *     card (never a $0 row), and saying it twice does not add it twice;
 *   - the quick invoice gets a line per part, priced from his book or blank.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Tim reads materials by shape', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  const read = (list) => page.evaluate((l) => l.map(t => timSaidMaterials(t).map(m => m.qty + ' ' + m.unit + ' ' + m.item.toLowerCase())), list);

  test('a count, the unit it is sold in, and the thing, across trades', async () => {
    const r = await read([
      '40 bags of quikrete, 6 sticks of rebar and 2 rolls of wire mesh',
      '10 sheets of half inch drywall, 3 boxes of mud and a roll of tape',
      '28 squares of timberline hdz, 4 rolls of synthetic underlayment and 2 bundles of ridge cap',
      '100 feet of 3/4 pex, 12 sharkbite couplings and 4 stub outs',
      '300 square feet of lvp and 4 boxes of quarter round',
      'grab six 4 inch wyes, a case of 45s and 3 sticks of 4 inch pvc',
    ]);
    expect(r[0]).toEqual(['40 bag quikrete', '6 stick rebar', '2 roll wire mesh']);
    expect(r[1]).toEqual(['10 sheet half inch drywall', '3 box mud', '1 roll tape']);
    expect(r[2]).toEqual(['28 square timberline hdz', '4 roll synthetic underlayment', '2 bundle ridge cap']);
    expect(r[3]).toEqual(['100 foot 3/4 pex', '12 ea sharkbite couplings', '4 ea stub outs']);
    expect(r[4]).toEqual(['300 sq ft lvp', '4 box quarter round']);
    expect(r[5]).toEqual(['6 ea 4 inch wyes', '1 case 45s', '3 stick 4 inch pvc']);
  });

  test('a size is not a count: "a 50 gallon Bradford White" is one heater', async () => {
    const r = await read(['a 50 gallon bradford white, an expansion tank, 2 flex connectors and a 3/4 ball valve']);
    expect(r[0]).toEqual(['1 ea 50 gallon bradford white', '1 ea expansion tank', '2 ea flex connectors', '1 ea 3/4 ball valve']);
  });

  test('work is never taken for a purchase', async () => {
    const r = await read(['install 6 recessed lights in the kitchen', 'replace about 60 feet of fascia and paint it', 'paint 3 bedrooms, 2 coats', 'tear off 28 squares down to the deck']);
    expect(r).toEqual([[], [], [], []]);
  });

  test('what the customer supplies is not on the list, and a correction wins', async () => {
    const r = await read(['customer is supplying the faucet. we need 2 supply lines and a new angle stop', 'grab 4 bags of thinset, no wait make that 6 bags']);
    expect(r[0]).toEqual(['2 ea supply lines', '1 ea new angle stop']);
    expect(r[1]).toEqual(['6 bag thinset']);
  });

  test('fees, rentals and time are not materials', async () => {
    const r = await read(['figure a 30 yard dumpster and 2 hours', 'grab 3 bags of grout plus the permit']);
    expect(r[0]).toEqual([]);
    expect(r[1]).toEqual(['3 bag grout']);
  });

  test('a shopping list is not a step; work that uses a material stays one', async () => {
    const r = await page.evaluate(() => {
      const a = timScopeBuild('pour the pad, figure 40 bags of quikrete and 6 sticks of rebar. broom finish.', { rejected: [] });
      const b = timScopeBuild('grab two rolls of 12-2 romex and ten 20 amp breakers', { rejected: [] });
      return { a: a.steps.map(s => s.text), am: a.materials.length, b: b.steps.map(s => s.text), bm: b.materials.length };
    });
    expect(r.a).toEqual(['Pour the pad', 'Broom finish']);
    expect(r.am).toBe(2);
    expect(r.b).toEqual([]);
    expect(r.bm).toBe(2);
  });

  test('junk in never throws', async () => {
    const r = await page.evaluate(() => [null, undefined, '', 0, '...', 'of of of', '12', 'a'].map(v => { try { return Array.isArray(timSaidMaterials(v)); } catch (e) { return 'threw'; } }));
    expect(r.every(x => x === true)).toBe(true);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tim materials reader'); });
});

test.describe('Talk to Tim lands materials in the Materials section', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForFunction(() => window._supaCloudLoaded === true, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => {}; window._byoAutosave = () => {};
      clients = clients.filter(c => c.id !== 99951);
      clients.push({ id: 99951, name: 'Pat Mason', addr: '12 Slab Rd, Wichita KS 67202' });
      S.priceBook = S.priceBook || {};
      S.priceBook.general = [{ desc: 'Quikrete', rate: 6.5, unit: 'bag' }];
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  const openEst = (mode) => page.evaluate((mode) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    openGenericEstimate(getClientById(99951), null, 'general', { mode, forceNew: true });
    return new Promise(res => setTimeout(() => {
      _geiTrade = 'general';
      if (mode === 'tm') { _geiIsTM = true; _geiIsFreeForm = false; _tmShowPage(); } else { _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2); }
      res(true);
    }, 400));
  }, mode);

  const said = 'pour the pad, figure 40 bags of quikrete and 6 sticks of rebar. broom finish.';

  test('T&M: a priced item is a row at his price, an unpriced one waits on the supply house list', async () => {
    await openEst('tm');
    const r = await page.evaluate((said) => {
      const box = document.getElementById('gei-scope-say'); if (box) box.value = said;
      _geiScopeBuild('tm-scope');
      const rows = _matIdx().map(i => _matView(i)).map(v => ({ label: v.label, qty: v.qty, unit: v.unit, price: v.price }));
      const list = ((_supData() || {}).items || []).map(it => it.qty + ' ' + it.unit + ' ' + it.desc);
      return { hasBox: !!box, rows, list, chips: _geiScopeChips.slice() };
    }, said);
    expect(r.hasBox).toBe(true);
    expect(r.chips).toEqual(['Pour the pad', 'Broom finish']);
    expect(r.rows).toEqual([{ label: 'Quikrete', qty: 40, unit: 'bag', price: 260 }]);
    expect(r.list).toEqual(['6 stick Rebar']);
  });

  test('T&M: saying it twice does not add it twice', async () => {
    const r = await page.evaluate((said) => {
      // The box folds away after a build; "say more" brings it back.
      _geiScopeSayMore('tm-scope-wrap');
      document.getElementById('gei-scope-say').value = said;
      _geiScopeBuild('tm-scope');
      return { rows: _matIdx().length, list: ((_supData() || {}).items || []).length };
    }, said);
    expect(r).toEqual({ rows: 1, list: 1 });
  });

  test('T&M: no material line on the proposal reads $0', async () => {
    const r = await page.evaluate(() => _matIdx().map(i => _matView(i).price));
    expect(r.every(p => p > 0)).toBe(true);
  });

  test('Build Your Own: the same, on the same Materials section', async () => {
    await openEst('byo');
    const r = await page.evaluate((said) => {
      document.getElementById('byo-say').value = said;
      _byoSayBuild();
      const work = _byoItems.filter(it => it.section !== 'Materials' && !it._supply && !it._rrp).map(it => it.label);
      const rows = _matIdx().map(i => _matView(i)).map(v => v.label + ' ' + v.qty + ' ' + v.unit + ' ' + v.price);
      const list = ((_supData() || {}).items || []).map(it => it.qty + ' ' + it.unit + ' ' + it.desc);
      return { work, rows, list };
    }, said);
    expect(r.work).toContain('Pour the pad');
    expect(r.work).not.toContain('Quikrete');
    expect(r.rows).toEqual(['Quikrete 40 bag 260']);
    expect(r.list).toEqual(['6 stick Rebar']);
  });

  test('Build Your Own: only a shopping list lands in Materials and adds no work line', async () => {
    await openEst('byo');
    const r = await page.evaluate(() => {
      const before = _byoItems.filter(it => it.section !== 'Materials' && !it._supply && !it._rrp).length;
      document.getElementById('byo-say').value = 'grab 3 boxes of mud and a roll of tape';
      _byoSayBuild();
      const after = _byoItems.filter(it => it.section !== 'Materials' && !it._supply && !it._rrp).length;
      return { added: after - before, list: ((_supData() || {}).items || []).map(it => it.qty + ' ' + it.unit + ' ' + it.desc) };
    });
    expect(r.added).toBe(0);
    expect(r.list).toEqual(['3 box Mud', '1 roll Tape']);
  });

  test('Quick invoice: each part is a line, priced from his book or left blank', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      openQuickInvoice(99951); _qiSetMode('set');
      document.getElementById('qi-say').value = 'Poured the step. Used 12 bags of quikrete and 2 sticks of rebar.';
      _qiSayBuild();
      return _qi.typed.map(l => l.desc + ' = ' + l.amount);
    });
    expect(r).toContain('Poured the step = ');
    expect(r).toContain('12 bags Quikrete = 78');
    expect(r).toContain('2 sticks rebar = ');
    expect(r.some(l => /used 12 bags/i.test(l))).toBe(false);
  });

  test('no console errors', async () => {
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); clients = clients.filter(c => c.id !== 99951); });
    assertNoErrors(page, 'tim materials wiring');
  });
});
