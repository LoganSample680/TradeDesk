// @ts-check
// ── ONE MATERIALS SECTION (js/materials.js) ─────────────────────────────────
//
// Owner 2026-09-26: "materials code should be common code and shared so
// updates carry over to both, look and ensure they are the exact same."
//
// T&M keeps lines in _geiLines, BYO keeps items in _byoItems. These tests hold
// the rest to one copy: the same card markup for the same materials, the same
// add and edit sheet, the same row actions, and the supply house card inside
// it on both.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function open(page, mode) {
  await page.evaluate((mode) => {
    if (!clients.find(c => c && c.id === 'c-mat-1')) {
      clients.push({ id: 'c-mat-1', name: 'Pat Owens', address: '1820 SW Randolph Ave, Topeka, KS 66604', phone: '', email: '' });
    }
    const c = clients.find(x => x.id === 'c-mat-1');
    // Each test starts a fresh estimate: earlier tests' drafts would open the
    // "resume a draft?" chooser instead.
    bids = bids.filter(b => String(b.client_id) !== 'c-mat-1');
    document.getElementById('_gei-draft-chooser')?.remove();
    if (mode === 'tm') openTMEstimate(c, null); else openFreeFormEstimate(c, null);
    goGeiStep(2);
    if (mode === 'tm') { _tmAddLayer('mat'); }
  }, mode);
}

// Same materials, in each store's own shape.
function seedTM() {
  _geiIsTM = true; _geiIsFreeForm = false; _attachSkipped = [];
  _geiLines = [
    { desc: 'Crew labor', qty: 8, unit: 'hr', rate: 95, total: 760, _tmLabor: true },
    { desc: '12/2 Romex', qty: 2, unit: 'roll', rate: 110, total: 220, notes: '250 ft rolls' },
    { desc: 'Breakers', qty: 1, unit: 'lot', rate: 180, total: 180, notes: '' },
  ];
  _byoItems = [];
  _tmRenderMatList();
}
function seedBYO() {
  _geiIsTM = false; _geiIsFreeForm = true; _attachSkipped = [];
  _geiLines = [];
  _byoItems = [
    _byoNormItem({ id: 1, section: 'Work', label: 'Panel swap', qty: 1, rate: 1800, price: 1800, on: true }),
    _byoNormItem({ id: 2, section: 'Materials', label: '12/2 Romex', qty: 2, unit: 'roll', rate: 110, price: 220, notes: '250 ft rolls', on: true }),
    _byoNormItem({ id: 3, section: 'Materials', label: 'Breakers', qty: 1, unit: 'lot', rate: 180, price: 180, notes: '', on: true }),
  ];
  _byoRenderSections();
}

test.describe('materials: one section for T&M and BYO', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the same materials draw the exact same card on both', async () => {
    await open(page, 'tm');
    const r = await page.evaluate(({ tm, byo }) => {
      // Row actions carry each store's own index; everything else must match.
      const norm = (h) => h.replace(/\(\d+\)/g, '(n)');
      eval('(' + tm + ')')();
      const a = norm(document.querySelector('#tm-mat-list #mat-card').outerHTML);
      eval('(' + byo + ')')();
      const b = norm(document.querySelector('#byo-sections #mat-card').outerHTML);
      return { same: a === b, a, b };
    }, { tm: seedTM.toString(), byo: seedBYO.toString() });
    expect(r.same, 'T&M:\n' + r.a + '\nBYO:\n' + r.b).toBe(true);
    expect(r.a).toContain('12/2 Romex');
    expect(r.a).toContain('2 roll');
  });

  test('BYO draws Materials once, as the shared card, with the supply card inside', async () => {
    await open(page, 'byo');
    const r = await page.evaluate((byo) => {
      eval('(' + byo + ')')();
      const w = document.getElementById('byo-sections');
      return {
        cards: w.querySelectorAll('#mat-card').length,
        sup: w.querySelectorAll('#sup-card').length,
        supInside: !!w.querySelector('#mat-card #sup-card'),
        workRow: w.innerHTML.includes('Panel swap'),
      };
    }, seedBYO.toString());
    expect(r).toEqual({ cards: 1, sup: 1, supInside: true, workRow: true });
  });

  test('T&M: the labor line is never a material row', async () => {
    await open(page, 'tm');
    const r = await page.evaluate((tm) => {
      eval('(' + tm + ')')();
      const h = document.getElementById('tm-mat-list').innerHTML;
      return { labor: h.includes('Crew labor'), rows: document.querySelectorAll('#mat-card .byo-row').length, sup: !!document.querySelector('#mat-card #sup-card') };
    }, seedTM.toString());
    expect(r).toEqual({ labor: false, rows: 2, sup: true });
  });

  for (const mode of ['tm', 'byo']) {
    test(`${mode}: + Add item opens the one shared sheet and writes a line`, async () => {
      await open(page, mode);
      const r = await page.evaluate(({ mode, tm, byo }) => {
        eval('(' + (mode === 'tm' ? tm : byo) + ')')();
        document.querySelector('#mat-card .card-hd button').click();
        const sheet = !!document.getElementById('_byo-add-modal');
        const title = document.getElementById('_byo-add-modal').textContent.includes('Add to Materials');
        document.getElementById('_bya-label').value = 'Wire nuts';
        document.getElementById('_bya-qty').value = '3';
        document.getElementById('_bya-price').value = '12';
        document.getElementById('_bya-notes').value = 'Red, box of 100';
        _byaConfirm('Materials');
        const got = mode === 'tm'
          ? _geiLines.filter(l => l.desc === 'Wire nuts').map(l => ({ qty: l.qty, rate: l.rate, total: l.total, notes: l.notes }))
          : _byoItems.filter(x => x.label === 'Wire nuts').map(x => ({ qty: x.qty, rate: x.rate, total: x.price, notes: x.notes, section: x.section }));
        return { sheet, title, got, shown: document.getElementById('mat-card').textContent.includes('Wire nuts'), closed: !document.getElementById('_byo-add-modal') };
      }, { mode, tm: seedTM.toString(), byo: seedBYO.toString() });
      expect(r.sheet).toBe(true);
      expect(r.title).toBe(true);
      expect(r.got).toHaveLength(1);
      expect(r.got[0]).toMatchObject({ qty: 3, rate: 12, total: 36, notes: 'Red, box of 100' });
      if (mode === 'byo') expect(r.got[0].section).toBe('Materials');
      expect(r.shown).toBe(true);
      expect(r.closed).toBe(true);
    });

    test(`${mode}: edit, copy and delete work the same way`, async () => {
      await open(page, mode);
      const r = await page.evaluate(({ mode, tm, byo }) => {
        eval('(' + (mode === 'tm' ? tm : byo) + ')')();
        // Look rows up by name: T&M drops its labor line when there are no
        // days, which moves every index, and the app redraws on each action.
        const at = (n) => _matIdx().find(i => _matView(i).label === n);
        const names = () => _matIdx().map(i => _matView(i).label);
        _matEdit(at('12/2 Romex'));
        const prefilled = document.getElementById('_bya-label').value;
        document.getElementById('_bya-label').value = '12/2 Romex, 250 ft';
        document.getElementById('_bya-qty').value = '3';
        _byaEditConfirm(at('12/2 Romex'));
        const edited = _matView(at('12/2 Romex, 250 ft'));
        _matDup(at('12/2 Romex, 250 ft'));
        const afterDup = names();
        _matDel(at('12/2 Romex, 250 ft (2)'));
        const afterDel = names();
        return { prefilled, edited: { label: edited.label, qty: edited.qty, price: edited.price }, afterDup, afterDel };
      }, { mode, tm: seedTM.toString(), byo: seedBYO.toString() });
      expect(r.prefilled).toBe('12/2 Romex');
      expect(r.edited).toEqual({ label: '12/2 Romex, 250 ft', qty: 3, price: 330 });
      expect(r.afterDup).toEqual(['12/2 Romex, 250 ft', '12/2 Romex, 250 ft (2)', 'Breakers']);
      expect(r.afterDel).toEqual(['12/2 Romex, 250 ft', 'Breakers']);
    });
  }

  test('T&M: an edited line still counts in the materials total', async () => {
    await open(page, 'tm');
    const r = await page.evaluate((tm) => {
      eval('(' + tm + ')')();
      const i = _matIdx().find(j => _matView(j).label === 'Breakers');
      _matEdit(i);
      document.getElementById('_bya-price').value = '200';
      _byaEditConfirm(i);
      return _geiLines.filter(l => !l._tmLabor && !l._supply).reduce((s, l) => s + l.total, 0);
    }, seedTM.toString());
    expect(r).toBe(420);
  });

  test('nothing can delete the labor line or the supply line through a row action', async () => {
    await open(page, 'tm');
    const r = await page.evaluate((tm) => {
      eval('(' + tm + ')')();
      _matDel(_geiLines.findIndex(l => l._tmLabor));
      _supHost(true);
      const s = _geiLines.findIndex(l => l._supply);
      _matDel(s);
      return { labor: _geiLines.some(l => l._tmLabor), supply: _geiLines.some(l => l._supply) };
    }, seedTM.toString());
    expect(r).toEqual({ labor: true, supply: true });
  });

  test('bad input never throws', async () => {
    await open(page, 'byo');
    const r = await page.evaluate(() => {
      const out = [];
      for (const f of [() => _matEdit(999), () => _matDel(-1), () => _matDup(null), () => _matToggle(undefined), () => _matView('x'), () => _matWrite(999, { label: 'x', qty: 1, unit: 'ea', rate: 1 })]) {
        try { f(); out.push('ok'); } catch (e) { out.push(e.message); }
      }
      document.getElementById('_byo-add-modal')?.remove();
      return out;
    });
    expect(r.every(x => x === 'ok')).toBe(true);
  });

  test('an old BYO material left out keeps its tick box so it can go back in', async () => {
    await open(page, 'byo');
    const r = await page.evaluate(() => {
      _geiIsTM = false; _geiIsFreeForm = true;
      _byoItems = [_byoNormItem({ id: 5, section: 'Materials', label: 'Caulk', qty: 1, rate: 9, price: 9, on: false })];
      _byoRenderSections();
      const box = document.querySelectorAll('#mat-card .byo-row .byo-check').length;
      _matToggle(0);
      return { box, on: _byoItems[0].on, boxAfter: document.querySelectorAll('#mat-card .byo-row .byo-check').length };
    });
    expect(r).toEqual({ box: 1, on: true, boxAfter: 0 });
  });

  for (const mode of ['tm', 'byo']) {
    test(`${mode}: the card fits a phone`, async () => {
      await open(page, mode);
      const r = await page.evaluate(({ mode, tm, byo }) => {
        eval('(' + (mode === 'tm' ? tm : byo) + ')')();
        const el = document.getElementById('mat-card');
        el.scrollIntoView();
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: el.getBoundingClientRect().right, h: el.getBoundingClientRect().height };
      }, { mode, tm: seedTM.toString(), byo: seedBYO.toString() });
      expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
      expect(r.right).toBeLessThanOrEqual(r.iw + 1);
      expect(r.h).toBeGreaterThan(0);
    });
  }

  test('no console errors', async () => { await assertNoErrors(page); });
});
