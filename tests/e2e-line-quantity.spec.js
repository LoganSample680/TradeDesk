// @ts-check
/**
 * A line is a quantity at a rate.
 *
 * A BYO item carried one flat price and nothing else. Twelve interior doors at
 * $95 meant the contractor did 12 x 95 in his head and typed 1140, and
 * _pbLearn was then handed that 1140 and told it was the price of ONE door. So
 * every multiple-quantity line he ever wrote was poisoning his own price book,
 * and _pbLearnHours rides the same key, so the profit gauge drank it too.
 *
 * price stays the LINE TOTAL, because the rail, the materials subtotal, the
 * pro-rata hours split and _estPricedLines all mean the total by it.
 *
 * What we verify:
 *  1. _byoNormItem: the math, the defaults, and junk
 *  2. An item saved before quantity existed reads back at exactly its old price
 *  3. The book learns the RATE, from every path
 *  4. The count shows in the item list, the modal and the client's proposal
 *  5. Every existing reader of .price still sees the line total
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('a line is a quantity at a rate', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      S.priceBook = {}; _byoItems = []; _geiLines = []; _geiScopeChips = [];
      _geiIsFreeForm = true; _geiIsTM = false; _geiScopeNoScope = false;
      document.getElementById('_byo-add-modal')?.remove();
    });
  });

  // ── 1. The arithmetic ──────────────────────────────────────────────────────

  test('quantity times rate is the line total', async () => {
    const it = await page.evaluate(() => _byoNormItem({ label: 'Interior door', qty: 12, unit: 'ea', rate: 95 }));
    expect(it.price, 'the multiply he used to do in his head').toBe(1140);
    expect(it.rate).toBe(95);
    expect(it.qty).toBe(12);
  });

  test('fractional quantities round to the cent', async () => {
    const it = await page.evaluate(() => _byoNormItem({ label: 'Trim', qty: 2.5, unit: 'lin ft', rate: 3.33 }));
    expect(it.price).toBe(8.33);
  });

  test('defaults are one each', async () => {
    const it = await page.evaluate(() => _byoNormItem({ label: 'Service call', rate: 150 }));
    expect(it.qty).toBe(1);
    expect(it.unit).toBe('ea');
    expect(it.price).toBe(150);
  });

  test('junk never produces a junk total', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      [{ qty: 0, rate: 95 }, { qty: -3, rate: 95 }, { qty: 'x', rate: 95 }, { qty: 2, rate: null }, {}].forEach(x => {
        out.push(_byoNormItem(Object.assign({ label: 'L' }, x)));
      });
      const safe = [null, undefined, 'str', 7].map(v => { try { _byoNormItem(v); return 'ok'; } catch (e) { return 'THREW'; } });
      return { out, safe };
    });
    // The fourth is {qty:2, rate:null}: no rate means a legacy row, and a
    // legacy row is one line at its stored price, never two of anything.
    expect(r.out.map(x => x.qty)).toEqual([1, 1, 1, 1, 1]);
    expect(r.out.map(x => x.price)).toEqual([95, 95, 95, 0, 0]);
    expect(r.safe.every(x => x === 'ok')).toBe(true);
  });

  // ── 2. Nothing saved before this breaks ────────────────────────────────────

  test('an item saved before quantity existed reads back at its old price', async () => {
    const it = await page.evaluate(() => {
      // Exactly the shape every bid in the cloud carries today.
      const old = { id: 1, section: 'Work', label: 'Water heater', price: 1450, notes: '', on: true };
      return _byoNormItem(old);
    });
    expect(it.price, 'the number the client already signed must not move').toBe(1450);
    expect(it.qty).toBe(1);
    expect(it.rate, 'its price WAS the whole line, so at one it is also the rate').toBe(1450);
  });

  test('a stored total is never divided by a quantity it never had', async () => {
    // The dangerous mis-migration: seeing qty 12 on a legacy row and deriving
    // rate = price/12. There is no such row, and guessing one would silently
    // cut a signed line to a twelfth of its value.
    const it = await page.evaluate(() => _byoNormItem({ label: 'Doors', qty: 12, price: 1140 }));
    expect(it.rate).toBe(1140);
    expect(it.price).toBe(1140);
    expect(it.qty).toBe(1);
  });

  test('rendering normalizes every item, so no add path can forget', async () => {
    const r = await page.evaluate(() => {
      _byoItems = [{ id: 1, section: 'Materials', label: 'Paint', price: 240, on: true }];
      _byoRenderSections();
      return _byoItems[0];
    });
    expect(r.qty).toBe(1);
    expect(r.rate).toBe(240);
    expect(r.price).toBe(240);
  });

  // ── 3. The book learns the rate ────────────────────────────────────────────

  test('the book learns the RATE, not the line total', async () => {
    const e = await page.evaluate(() => {
      _byoAddItem('Work');
      document.getElementById('_bya-label').value = 'Interior door';
      document.getElementById('_bya-qty').value = '12';
      document.getElementById('_bya-price').value = '95';
      document.getElementById('_bya-notes').value = 'Hung, cased and painted';
      _byaConfirm('Work');
      return _pbFind('Interior door', _pbTrade());
    });
    expect(e.rate, 'this is the whole bug: the book used to learn $1,140 per door').toBe(95);
    expect(e.notes).toContain('Hung, cased');
    const it = await page.evaluate(() => _byoItems[_byoItems.length - 1]);
    expect(it.price).toBe(1140);
    expect(it.qty).toBe(12);
  });

  test('the unit rides along, so the book knows what the rate is per', async () => {
    const e = await page.evaluate(() => {
      _byoAddItem('Work');
      document.getElementById('_bya-label').value = 'Crown moulding';
      document.getElementById('_bya-qty').value = '140';
      document.getElementById('_bya-unit').value = 'lin ft';
      document.getElementById('_bya-price').value = '6';
      _byaConfirm('Work');
      return _pbFind('Crown moulding', _pbTrade());
    });
    expect(e.rate).toBe(6);
    expect(e.unit).toBe('lin ft');
  });

  test('editing a line teaches the rate too', async () => {
    const e = await page.evaluate(() => {
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Outlet', qty: 4, unit: 'ea', rate: 120, on: true })];
      _byoEditItem(0);
      document.getElementById('_bya-qty').value = '6';
      document.getElementById('_bya-price').value = '130';
      _byaEditConfirm(0);
      document.getElementById('_byo-add-modal')?.remove();
      return { book: _pbFind('Outlet', _pbTrade()), item: _byoItems[0] };
    });
    expect(e.book.rate).toBe(130);
    expect(e.item.price).toBe(780);
  });

  test('the save-time sweep sends the rate as well', async () => {
    const e = await page.evaluate(() => {
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Sconce install', qty: 8, unit: 'ea', rate: 85, on: true })];
      _pbLearnAll();
      return _pbFind('Sconce install', _pbTrade());
    });
    expect(e.rate, '_pbLearnAll used to hand over the 680 line total').toBe(85);
    expect(e.unit).toBe('ea');
  });

  test('picking from the book brings its unit and rate', async () => {
    const it = await page.evaluate(() => {
      _pbLearn('Recessed can', 145, 'ea', 'Airtight IC-rated housing, trim included');
      _pbLearn('Recessed can', 145, 'ea');
      _byaAddFromBook('Work', _pbList().findIndex(b => b.desc === 'Recessed can'));
      return _byoItems[_byoItems.length - 1];
    });
    expect(it.rate).toBe(145);
    expect(it.unit).toBe('ea');
    expect(it.qty, 'he types the count; the book supplies the rate').toBe(1);
    expect(it.notes).toContain('IC-rated');
  });

  // ── 4. He can see the math ─────────────────────────────────────────────────

  test('the modal does the multiply out loud, and stays quiet at one', async () => {
    const r = await page.evaluate(() => {
      _byoAddItem('Work');
      document.getElementById('_bya-qty').value = '12';
      document.getElementById('_bya-price').value = '95';
      _byaLineMath();
      const many = document.getElementById('_bya-line-total').textContent;
      document.getElementById('_bya-qty').value = '1';
      _byaLineMath();
      const one = document.getElementById('_bya-line-total').textContent;
      document.getElementById('_byo-add-modal')?.remove();
      return { many, one };
    });
    expect(r.many).toContain('12 ea × $95.00 = $1,140.00');
    expect(r.one, 'a line reading "1 × $95 = $95" is noise').toBe('');
  });

  test('the item list shows the count and rate behind the total', async () => {
    const r = await page.evaluate(() => ({
      many: _byoQtyLabel({ qty: 12, unit: 'ea', rate: 95 }),
      ft: _byoQtyLabel({ qty: 140, unit: 'lin ft', rate: 6 }),
      one: _byoQtyLabel({ qty: 1, unit: 'ea', rate: 95 }),
      nul: _byoQtyLabel(null)
    }));
    expect(r.many).toBe('12 × $95.00');
    expect(r.ft).toBe('140 lin ft × $6.00');
    expect(r.one).toBe('');
    expect(r.nul).toBe('');
  });

  test('the client reads the count in the scope, never the rate', async () => {
    const html = await page.evaluate(async () => {
      _byoItems = [
        _byoNormItem({ id: 1, section: 'Interior', label: 'Interior door', qty: 12, unit: 'ea', rate: 95, notes: 'Hung, cased and painted', on: true }),
        _byoNormItem({ id: 2, section: 'Materials', label: 'Paint', qty: 1, unit: 'ea', rate: 240, notes: 'Two coats', on: true })
      ];
      return await sendGenericProposal(true, { silent: true });
    });
    const scope = html.split('Scope of work')[1] || '';
    expect(scope).toContain('Interior door');
    expect(scope, 'twelve doors and one door are different jobs').toContain('(12)');
    expect(scope).toContain('Hung, cased and painted');
    expect(scope.split('Paint')[1].slice(0, 40), 'a quantity of one says nothing').not.toContain('(1)');
    expect(scope, 'the rate stays off the proposal, same one-price rule').not.toContain('$95');
  });

  // ── 5. Every existing reader still sees the line total ─────────────────────

  test('the totals, the materials subtotal and the hours split all read the total', async () => {
    const r = await page.evaluate(() => {
      _byoItems = [
        _byoNormItem({ id: 1, section: 'Materials', label: 'Paint', qty: 6, unit: 'gal', rate: 40, on: true }),
        _byoNormItem({ id: 2, section: 'Interior', label: 'Interior door', qty: 12, unit: 'ea', rate: 95, on: true })
      ];
      const priced = _estPricedLines();
      return {
        priced,
        matTotal: _byoItems.filter(i => i.on && (i.section || '').toLowerCase() === 'materials').reduce((s, i) => s + i.price, 0),
        total: (_byoUpdateRail(), calcGeiTotal().total)
      };
    });
    expect(r.priced.find(l => l.desc === 'Interior door').price, 'the pro-rata hours split weights by line VALUE').toBe(1140);
    expect(r.matTotal).toBe(240);
    expect(r.total, 'BYO syncs its items into _geiLines through _byoUpdateRail before totalling').toBe(1380);
  });

  test('no console errors across the quantity loop', async () => {
    await assertNoErrors(page);
  });
});
