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
    // A size is written the way it is ordered: "half inch" is 1/2 inch.
    expect(r[1]).toEqual(['10 sheet 1/2 inch drywall', '3 box mud', '1 roll tape']);
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
    const r = await read(['replace about 60 feet of fascia and paint it', 'paint 3 bedrooms, 2 coats', 'tear off 28 squares down to the deck', 'install grab bars by the toilet']);
    expect(r).toEqual([[], [], [], []]);
  });

  test('a part he installs is a material too, and the step stays on the scope', async () => {
    const r = await page.evaluate(() => {
      const b = timScopeBuild('install 6 recessed lights in the kitchen. replaced the wax ring and reset the toilet.', { rejected: [] });
      return { steps: b.steps.map(s => s.text), mats: b.materials.map(m => m.qty + ' ' + m.unit + ' ' + m.item.toLowerCase()) };
    });
    expect(r.steps).toEqual(['Install 6 recessed lights in the kitchen', 'Replaced the wax ring', 'Reset the toilet']);
    expect(r.mats).toEqual(['6 ea recessed lights', '1 ea wax ring']);
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

  test('notes: the thing first, the count after it', async () => {
    const r = await read([
      'Back hill. Retaining wall, 30 foot, 3 courses. Versa lock blocks, 90. Caps, 30. Drain rock 4 ton. Geogrid, one roll. Backfill and compact.',
      'Shed pad. 10 by 12. 4 inch. Mesh, 3 sheets. 2 yards 3000. Gravel base 2 ton. Anchor bolts, 6.',
      'Crawl space. Vapor barrier 20 mil, 1,200 sq ft, 3 rolls. Seal seams. Foam board on walls, 2 inch, 24 sheets.',
    ]);
    expect(r[0]).toEqual(['90 ea versa-lok blocks', '30 ea caps', '4 ton drain rock', '1 roll geogrid']);
    expect(r[1]).toEqual(['3 sheet mesh', '2 yard 3000', '2 ton gravel base', '6 ea anchor bolts']);
    expect(r[2]).toEqual(['3 roll vapor barrier 20 mil', '24 sheet 2 inch foam board']);
  });

  test('parts said the short way are on the list, and a list about something else leaves them', async () => {
    const r = await read([
      'Guest bath. Reset toilet. Replace flange, 4 inch. Two wax rings with horn. Swap flapper. Check shutoff. Maybe 90 minutes.',
      'Rooftop unit 2. Replace belt, A48. Filters, 20 by 20 by 2, eight of em. Grease bearings.',
      'exterior replace photocell two flood lamps par 38 check timer customer supplying the bulbs for the porch',
    ]);
    expect(r[0]).toEqual(['1 ea flange 4 inch', '2 ea wax rings with horn', '1 ea flapper']);
    expect(r[1]).toEqual(['1 ea belt a48', '8 ea 20x20x2 filters']);
    expect(r[2]).toEqual(['1 ea photocell', '2 ea flood lamps']);
  });

  test('how a count is said: "a couple three", "a dozen and a half", "skip the quart", "actually the"', async () => {
    const r = await read([
      'get me a couple three sticks of half inch emt',
      'grab a box of 6 inch collars, a dozen and a half 6 inch 90 degree adjustable elbows',
      'two tubes of caulk, a quart, no, skip the quart. a roll of tape',
      'Grab 3 bags of thinset, actually the large format mortar, 3 bags.',
      'so 30 sheets no 34 sheets of half inch and 4 sheets of green board',
    ]);
    expect(r[0]).toEqual(['3 stick 1/2 inch emt']);
    expect(r[1]).toEqual(['1 box 6 inch collars', '18 ea 6 inch 90 degree adjustable elbows']);
    expect(r[2]).toEqual(['2 tube caulk', '1 roll tape']);
    expect(r[3]).toEqual(['3 bag large format mortar']);
    expect(r[4]).toEqual(['34 sheet 1/2 inch', '4 sheet green board']);
  });

  test('small talk and what the customer has stay off the list', async () => {
    const r = await read([
      'Oh and his dog, a big Newfie, drooled on my clipboard. 20 bags of concrete.',
      'need 4 sticks of 3/4 EMT customer has the charger already 3 hours',
      'two of the pilings are leaning, we need 2 bags of quikrete',
    ]);
    expect(r[0]).toEqual(['20 bag concrete']);
    expect(r[1]).toEqual(['4 stick 3/4 emt']);
    expect(r[2]).toEqual(['2 bag quikrete']);
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
    // T&M's Materials section is one he turns on: what Tim added turns it on.
    const shown = await page.evaluate(() => { const el = document.getElementById('tm-blk-mat'); return !!el && el.style.display !== 'none' && _tmLayers.has('mat'); });
    expect(shown).toBe(true);
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

  test('Quick invoice: parts land the way they land on a proposal: priced ones are Materials rows, the rest wait on the supply house list', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      openQuickInvoice(99951); _qiSetMode('set');
      document.getElementById('qi-say').value = 'Poured the step. Used 12 bags of quikrete and 2 sticks of rebar.';
      _qiSayBuild();
      // One rule for every document (timAddMaterials, js/materials.js): a part
      // his book prices is a Materials row; an unpriced one goes on the supply
      // house list, never a $0 line.
      return { lines: _qi.typed.filter(l => !l._supply).map(l => l.desc + ' = ' + l.amount + (l.part ? ' x' + l.qty + ' ' + (l.unit || 'ea') + ' | ' + _qiPartLabel(l) : '')),
        list: ((_supData() || {}).items || []).map(it => it.qty + ' ' + it.unit + ' ' + it.desc) };
    });
    expect(r.lines).toContain('Poured the step = ');
    expect(r.lines.some(l => / x12 bag \| 12 bags Quikrete$/i.test(l))).toBe(true);
    expect(r.list).toEqual(['2 stick Rebar']);
    expect(r.lines.some(l => /used 12 bags/i.test(l))).toBe(false);
  });

  test('no console errors', async () => {
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); clients = clients.filter(c => c.id !== 99951); });
    assertNoErrors(page, 'tim materials wiring');
  });
});
