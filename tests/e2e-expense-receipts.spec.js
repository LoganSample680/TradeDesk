// @ts-check
// ── Jack's four receipt questions (2026-09-29) ─────────────────────────────
//
// "when we do expenses does it tag it to a client? can it parse the materials
// too? Does it build a price sheet for materials? if we hit no receipt on the
// home page prompt is there a way to add the receipt back?"
//
//   1. A store run's receipt is tagged to the house the run left from or came
//      back to (js/mileage.js _supplyRunClient), shown on the form.
//   2. The parts on the receipt are read line by line on the phone
//      (_rcptParseItems, no AI) and saved on the expense.
//   3. What he paid for each part lands on a price sheet (partCostLearn,
//      js/data.js), shown under the price book. Never as a sell price.
//   4. "No receipt" is not final: the mileage row has Add receipt, and the
//      receipt settles the run the way it would have on the day.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const KEY = 'd-j-run1';

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate((KEY) => {
    window.supaLoadFromCloud = async () => {};
    window.expTriggerScan = () => {};
    clients.splice(0, clients.length,
      { id: 701, name: 'Tagen Miller', addr: '2210 Birch Ln, Topeka, KS 66615', status: 'Client' },
      { id: 702, name: 'Mary Smith', addr: '77 Lakeview Dr, Topeka, KS 66614', status: 'Client' });
    bids.splice(0, bids.length);
    expenses.splice(0, expenses.length);
    mileage.splice(0, mileage.length,
      { id: 9001, date: '2026-09-25', miles: 3.1, from_name: 'Tagen Miller (2210 Birch Ln)', to_name: 'Ferguson', supplyRunKey: KEY, noReceipt: true, created_at: '2026-09-25T15:40:00.000Z' },
      { id: 9002, date: '2026-09-25', miles: 3.1, from_name: 'Ferguson', to_name: 'Tagen Miller (2210 Birch Ln)', supplyRunKey: KEY, noReceipt: true, created_at: '2026-09-25T16:10:00.000Z' });
    S.partCosts = {};
  }, KEY);
}

test.describe('Receipts: the four answers', () => {
  test('a store run knows whose house it was for; a run between two customers does not guess', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((KEY) => {
      const one = _supplyRunClient(KEY);
      mileage[1].to_name = 'Mary Smith (77 Lakeview Dr)';
      const two = _supplyRunClient(KEY);
      return { one, two, none: _supplyRunClient('no-such-run'), junk: [_supplyRunClient(null), _supplyRunClient(undefined)] };
    }, KEY);
    expect(r.one).toBe(701);
    expect(r.two, 'two houses: his to say').toBe(null);
    expect(r.none).toBe(null);
    expect(r.junk).toEqual([null, null]);
  });

  test('after No receipt, the row has Add receipt; the receipt settles the run and the expense is Tagen\'s', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (KEY) => {
      _supplyRunScan(encodeURIComponent(KEY));
      const note = document.getElementById('em-client-note')?.textContent || '';
      document.getElementById('em-vendor').value = 'Ferguson';
      document.getElementById('em-amount').value = '48.20';
      document.getElementById('em-date').value = '2026-09-25';
      await expSave();
      await new Promise(r => setTimeout(r, 50));
      const exp = expenses[expenses.length - 1];
      return { note, client: exp.client_id, name: exp.job_name, legs: mileage.map(m => ({ no: !!m.noReceipt, rid: m.receiptExpenseId === exp.id })) };
    }, KEY);
    expect(r.note).toBe('For Tagen Miller. Pick a job above to change it.');
    expect(r.client).toBe(701);
    expect(r.name).toBe('Tagen Miller');
    expect(r.legs).toEqual([{ no: false, rid: true }, { no: false, rid: true }]);
  });

  test('the mileage row for a no-receipt run carries an Add receipt button', async ({ page }) => {
    await boot(page);
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'mileage.js'), 'utf8');
    const i = src.indexOf("r.noReceipt?('<div");
    expect(i, 'the no-receipt badge has company').toBeGreaterThan(-1);
    expect(src.slice(i, i + 600)).toContain('_supplyRunScan(');
    expect(src.slice(i, i + 600)).toContain('Add receipt');
  });

  test('a sold job at that house is picked for him', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((KEY) => {
      bids.push({ id: 5501, client_id: 701, client_name: 'Tagen Miller', status: 'Closed Won', addr: '2210 Birch Ln' });
      closeExpenseFlow();
      _supplyRunScan(encodeURIComponent(KEY));
      return { job: document.getElementById('em-job').value, note: !!document.getElementById('em-client-note') };
    }, KEY);
    expect(r.job).toBe('5501');
    expect(r.note, 'the job says it; no second line').toBe(false);
  });

  test('the phone reads the parts off the receipt lines; totals, tax and tender are not parts', async ({ page }) => {
    await boot(page);
    const items = await page.evaluate(() => _rcptParseItems([
      'FERGUSON #1432', '123 MAIN ST', '09/25/2026',
      '1/2 PEX A TUBING 100FT   48.97',
      'SHARKBITE 1/2 COUPLING 3 @ 6.49   19.47',
      '1/2 COPPER STUB OUT   4.12',
      'SUBTOTAL   72.56', 'TAX   6.31', 'TOTAL   78.87', 'VISA   78.87', 'CHANGE   0.00',
    ]));
    expect(items).toEqual([
      { desc: '1/2 PEX A TUBING 100FT', qty: 1, price: 48.97 },
      { desc: 'SHARKBITE 1/2 COUPLING', qty: 3, price: 6.49 },
      { desc: '1/2 COPPER STUB OUT', qty: 1, price: 4.12 },
    ]);
  });

  test('junk in is nothing out: no $0 lines, no crash', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      a: _rcptItems(null), b: _rcptItems('x'), c: _rcptItems([{}, { desc: 'ab', price: 3 }, { desc: 'Fill valve', price: 0 }, { desc: 'Fill valve', qty: 2, total: 19 }]),
      d: _rcptParseItems(null), e: _rcptParseItems([]), f: _rcptParseItems(['TOTAL 12.00']),
      g: partCostLearn('', 5), h: partCostLearn('Fill valve', -1), i: partCostFor(null),
    }));
    expect(r.a).toEqual([]); expect(r.b).toEqual([]);
    expect(r.c).toEqual([{ desc: 'Fill valve', qty: 2, price: 9.5 }]);
    expect(r.d).toEqual([]); expect(r.e).toEqual([]); expect(r.f).toEqual([]);
    expect(r.g).toBe(false); expect(r.h).toBe(false); expect(r.i).toBe(null);
  });

  test('saving a scanned receipt keeps its parts and puts what he paid on the price sheet, never in the price book', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      S.priceBook = { plumbing: [{ desc: 'Sharkbite 1/2 coupling', rate: 14, n: 3 }] };
      openExpenseFlow();
      _expState.items = _rcptItems([{ desc: 'Sharkbite 1/2 coupling', qty: 3, price: 6.49 }, { desc: '1/2 PEX A tubing 100ft', qty: 1, price: 48.97 }]);
      _renderExpItems();
      const shown = document.getElementById('em-items').textContent;
      document.getElementById('em-vendor').value = 'Ferguson';
      document.getElementById('em-amount').value = '68.44';
      document.getElementById('em-date').value = '2026-09-25';
      document.getElementById('em-cat').value = 'materials';
      await expSave();
      await new Promise(r => setTimeout(r, 50));
      const exp = expenses[expenses.length - 1];
      const pc = partCostFor('Sharkbite 1/2 coupling');
      return { shown, items: exp.items, pc: pc && { cost: pc.cost, vendor: pc.vendor, at: pc.at }, bookRate: S.priceBook.plumbing[0].rate };
    });
    expect(r.shown).toContain('On the receipt · 2 parts');
    expect(r.items).toHaveLength(2);
    expect(r.pc).toEqual({ cost: 6.49, vendor: 'Ferguson', at: '2026-09-25' });
    expect(r.bookRate, 'what he charges is untouched by what he paid').toBe(14);
  });

  test('the price book screen shows the Materials book, and what he paid beside what he charges', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.priceBook = { plumbing: [{ desc: 'Sharkbite 1/2 coupling', rate: 14, n: 3 }] };
      partCostLearn('Sharkbite 1/2 coupling', 6.49, 'Ferguson', '2026-09-25');
      partCostLearn('Fill valve', 11.2, 'Menards', '2026-09-24');
      if (typeof _openSetDetail === 'function') { goPg('pg-settings'); _openSetDetail('pricebook'); }
      renderPriceBookSettings();
      const list = document.getElementById('pb-list');
      return { text: list.textContent, rows: list.querySelectorAll('.pb-paid-row').length, bleed: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r.text).toContain('paid $6.49 at Ferguson');
    expect(r.text).toContain('Materials book · 2 parts');
    expect(r.rows).toBe(2);
    expect(r.text).toContain('never what a customer is charged');
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  // Owner 2026-09-29: "grabs the recent price and updates it accordingly ...
  // most used thing at the top so we make sure we got enough on the truck".
  test('the materials book keeps the newest price, counts every purchase, and puts the most bought on top', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      partCostLearn('Sharkbite 1/2 coupling', 6.49, 'Ferguson', '2026-09-20', 3);
      partCostLearn('Sharkbite 1/2 coupling', 6.99, 'Menards', '2026-09-25', 4);
      partCostLearn('SHARKBITE 1/2" COUPLING', 5.99, 'Ferguson', '2026-09-10', 2);  // an old receipt scanned late
      partCostLearn('Fill valve', 11.2, 'Menards', '2026-09-26', 1);
      partCostLearn('Wax ring', 3.5, 'Menards', '2026-09-26', 5);
      const c = partCostFor('sharkbite 1/2 coupling');
      return { c: { cost: c.cost, vendor: c.vendor, n: c.n, qty: c.qty }, order: materialsBook().map(m => m.desc) };
    });
    expect(r.c, 'newest price and store win; the late old receipt only adds to the count').toEqual({ cost: 6.99, vendor: 'Menards', n: 3, qty: 9 });
    expect(r.order).toEqual(['Sharkbite 1/2 coupling', 'Wax ring', 'Fill valve']);
  });

  test('parts can be pulled from it on the invoice, at what he last paid, after his own prices', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.priceBook = { plumbing: [{ desc: 'Fill valve', rate: 45, n: 3 }] };
      partCostLearn('Fill valve', 11.2, 'Menards', '2026-09-26', 1);
      partCostLearn('Wax ring', 3.5, 'Menards', '2026-09-26', 5);
      // One price book list now (audit 2026-10-01): the invoice reads _pbList.
      return { list: _pbList(null, { everyTrade: true, parts: true }).map(p => [p.desc, Number(p.rate)]), old: typeof _qiPriceBook };
    });
    expect(r.list, 'his price for a fill valve stands; the wax ring comes from the receipt').toEqual([['Fill valve', 45], ['Wax ring', 3.5]]);
    expect(r.old, 'the invoice\'s own copy of the list is gone').toBe('undefined');
  });

  test('a material with no price in his book is listed at what he last paid for it', async ({ page }) => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'materials.js'), 'utf8');
    expect(src).toMatch(/partCostFor\(label\)[\s\S]{0,120}cost:paid\?Number\(paid\.cost\)/);
  });

  // Owner 2026-09-29: "go no AI lets test it and see if we can get it to work native".
  test('no AI: nothing sends a receipt anywhere, and the old function is gone', async ({ page }) => {
    const fs = require('fs'), path = require('path');
    const js = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => f.endsWith('.js'))
      .filter(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').includes('scan-receipt'));
    expect(js, 'no file calls the AI reader').toEqual([]);
    expect(fs.existsSync(path.join(__dirname, '..', 'supabase', 'functions', 'scan-receipt'))).toBe(false);
    await boot(page);
    const gone = await page.evaluate(() => typeof fetchStateInfo);
    expect(gone, 'its only other caller was dead code, deleted').toBe('undefined');
  });

  test('the phone reader\'s words are put back into printed lines, left to right', async ({ page }) => {
    await boot(page);
    const rows = await page.evaluate(() => _rcptRows([
      { text: 'FERGUSON', page: 0, x: 0.3, y: 0.02, w: 0.4, h: 0.03 },
      { text: '6.49', page: 0, x: 0.8, y: 0.301, w: 0.1, h: 0.02 },
      { text: 'SB 1/2 CPLG', page: 0, x: 0.05, y: 0.30, w: 0.4, h: 0.02 },
      { text: 'TOTAL', page: 0, x: 0.05, y: 0.5, w: 0.2, h: 0.02 },
      { text: '6.93', page: 0, x: 0.8, y: 0.502, w: 0.1, h: 0.02 },
      { text: '', page: 0, x: 0, y: 0.6, w: 0, h: 0.02 }, null,
    ]));
    expect(rows).toEqual(['FERGUSON', 'SB 1/2 CPLG   6.49', 'TOTAL   6.93']);
    const junk = await page.evaluate(() => [_rcptRows(null), _rcptRows('x'), _rcptRows([{ text: 'a' }])]);
    expect(junk).toEqual([[], [], []]);
  });

  test('a photo read on the phone fills the store, total, parts and category, with no network', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      let fetched = 0; const f = window.fetch; window.fetch = (...a) => { fetched++; return f(...a); };
      const box = (text, x, y) => ({ text, page: 0, x, y, w: 0.3, h: 0.02 });
      window._rcptNativePlugin = () => ({ recognizeText: async () => ({ ok: true,
        lines: ['MENARDS', '09/25/2026', 'SHARKBITE 1/2IN COUPLING', '3 @ 6.99', '20.97', 'TOTAL', '22.44'],
        boxes: [box('MENARDS', 0.3, 0.02), box('09/25/2026', 0.3, 0.06), box('SHARKBITE 1/2IN COUPLING 3 @ 6.99', 0.05, 0.3), box('20.97', 0.8, 0.3),
          box('TAX', 0.05, 0.4), box('1.47', 0.8, 0.4), box('TOTAL', 0.05, 0.5), box('22.44', 0.8, 0.5)] }) });
      openExpenseFlow();
      const read = await _rcptOcrRead({ base64: 'x', mime: 'image/jpeg' });
      _rcptApplyPhoneRead(read);
      window.fetch = f;
      return { vendor: document.getElementById('em-vendor').value, amount: document.getElementById('em-amount').value,
        cat: document.getElementById('em-cat').value, items: _expState.items, date: !!document.getElementById('rcpt-date-confirm'), fetched };
    });
    expect(r.vendor).toMatch(/menards/i);
    expect(Number(r.amount)).toBe(22.44);
    expect(r.cat, 'Menards is a supply house').toBe('materials');
    expect(r.items).toEqual([{ desc: 'SHARKBITE 1/2IN COUPLING', qty: 3, price: 6.99 }]);
    expect(r.date, 'the date it read is offered to confirm').toBe(true);
    expect(r.fetched, 'nothing left the phone').toBe(0);
  });

  test('the store says what it was: gas is fuel, a supply house is materials, an unknown store is left for him', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ['QuikTrip #412', 'FERGUSON ENTERPRISES', 'The Home Depot', "O'Reilly Auto Parts", 'Harbor Freight Tools', "McDonald's", 'Bob\'s Place', '', null].map(_rcptCategoryFor));
    expect(r).toEqual(['fuel', 'materials', 'materials', 'vehicle', 'tools', 'meals', '', '', '']);
  });

  // Earl 2026-09-29: the same coupling from two stores was two lines.
  test('one line per part whatever the store printed; a different size stays its own line', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      partCostLearn('SB 1/2 CPLG', 6.49, 'Ferguson', '2026-09-20', 3);
      partCostLearn('SHARKBITE 1/2IN COUPLING', 6.99, 'Menards', '2026-09-25', 4);
      partCostLearn('SB 3/4 CPLG', 9.49, 'Ferguson', '2026-09-25', 1);
      partCostLearn('012345678 3/4 CU ELL 90', 2.1, 'Ferguson', '2026-09-25', 6);
      return { book: materialsBook().map(m => [m.desc, m.cost, m.qty]), find: partCostFor('Sharkbite 1/2" push coupling')?.cost };
    });
    expect(r.book).toEqual([
      ['SharkBite 1/2 coupling', 6.99, 7],
      ['3/4 copper elbow 90', 2.1, 6],
      ['SharkBite 3/4 coupling', 9.49, 1],
    ]);
    expect(r.find, 'any spelling of it finds it').toBe(6.99);
  });

  test('receipt shorthand is spelled out and the SKU dropped', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ['SB 1/2 CPLG', 'FLUIDMASTER 400A FILL VLV', '012345678 3/4 CU ELL 90', 'Wax ring', '', null].map(partCanon));
    expect(r).toEqual(['SharkBite 1/2 coupling', 'Fluidmaster 400a fill valve', '3/4 copper elbow 90', 'Wax ring', '', '']);
  });

  test('no console errors', async ({ page }) => {
    await boot(page);
    await page.evaluate(async (KEY) => {
      _supplyRunScan(encodeURIComponent(KEY));
      document.getElementById('em-vendor').value = 'Ferguson';
      document.getElementById('em-amount').value = '10';
      await expSave();
    }, KEY);
    await assertNoErrors(page, 'receipts');
  });
});
