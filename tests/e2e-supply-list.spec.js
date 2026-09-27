// @ts-check
// ── SUPPLY HOUSE MATERIALS (js/supply-list.js) ──────────────────────────────
//
// Owner's flow (2026-09-26): type the materials, send the list to the supply
// house, they email a quote back, it gets read into the materials price with
// a markup he types, and sales tax follows the quote.
//
// The quote fixtures are the two real Neenan Co. Topeka quotes the owner sent
// (S3318549 and S3317925). Both are scans with no text layer. They are read
// ON THE PHONE by Apple's text reader, no AI (owner: "I really want reliable
// OCR without AI"), which returns words and where they sit. The rows are
// rebuilt and parsed in js/supply-list.js and checked against the arithmetic
// the quote printed itself.
//
// tests/fixtures/neenan-*.boxes.json are the word positions an OCR engine
// produced from the actual scans (Tesseract, a worse reader than Apple's: it
// reads "1ea" as "lea", the "$" before the subtotal as a "3", and one line
// total as 332.58 instead of 32.58). If the parser gets both quotes exactly
// right from THAT, the phone's cleaner read has margin to spare.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

// S3318549, 09/21/26, "MAVERICK STEINHOFF", taxes not included. Two water
// heaters on one quote: alternatives, he buys one.
const Q_STEINHOFF = {
  vendor: 'Neenan Co. Topeka', quote_number: 'S3318549', date: '09/21/26', reference: 'MAVERICK STEINHOFF',
  tax_included: false, tax_amount: null, subtotal: 1356.43, total: 1356.43,
  lines: [
    { qty: 1, unit: 'ea', part: '403386', description: 'CORRO-PROTEC 96383 POWERED ANODE ROD FOR BRADFORD WHITE UNITS', unit_price: 161.708, ext: 161.71 },
    { qty: 1, unit: 'ea', part: '258896', description: 'BWC RG240T6N 40GAL NAT GAS WATER HEATER 60-1/8" TALL 40,000BTU', unit_price: 542.15, ext: 542.15 },
    { qty: 1, unit: 'ea', part: '397113', description: 'RUUD PROG40-40N RU62 NG 40GAL 40,000BTU RESIDENTIAL WATER HEATER *WICHITA', unit_price: 497.15, ext: 497.15 },
    { qty: 1, unit: 'ea', part: '68999', description: '2.1GAL THERM EXPANSION TANK ARROW 12-A101C *6YR WARRANTY*', unit_price: 41.365, ext: 41.37 },
    { qty: 3, unit: 'ea', part: '149505', description: '3/4 SWT LF FULL PORT BALL VALVE MUEL 117-844', unit_price: 13.497, ext: 40.49 },
    { qty: 2, unit: 'ea', part: '175017', description: '7/8 OD COMP X 3/4 FIP ADAPTER 18-166LF C74055LF C66R-7834-NL', unit_price: 6.534, ext: 13.07 },
    { qty: 1, unit: 'ea', part: '2469', description: '3/4 SWT X FIP ADAPTER', unit_price: 6.629, ext: 6.63 },
    { qty: 10, unit: 'ft', part: '5130', description: '3/4 X 10 M HARD COPPER TUBE', unit_price: 4.026, ext: 40.26 },
    { qty: 2, unit: 'ea', part: '2337', description: '3/4 SWT COUPLING', unit_price: 1.855, ext: 3.71 },
    { qty: 2, unit: 'ea', part: '2574', description: '3/4 SWT 90 ELL', unit_price: 3.534, ext: 7.07 },
    { qty: 2, unit: 'ea', part: '2929', description: 'SC 702-3 3/4" ECONOMY WIRE HANDLE FITTING BRUSH', unit_price: 1.412, ext: 2.82 },
  ],
};
// S3317925, 09/17/26, "5713 SW 14TH".
const Q_14TH = {
  vendor: 'Neenan Co. Topeka', quote_number: 'S3317925', date: '09/17/26', reference: '5713 SW 14TH',
  tax_included: false, tax_amount: null, subtotal: 315.72, total: 315.72,
  lines: [
    { qty: 1, unit: 'ea', part: '52044', description: 'IPS 82001 W2711 LAUNDRY BOX WITH WIRSBO VALVE', unit_price: 32.579, ext: 32.58 },
    { qty: 1, unit: 'cl', part: '38999', description: 'UPO F1040500 1/2X100FT WHT COIL TBG', unit_price: 52.941, ext: 52.94 },
    { qty: 6, unit: 'ea', part: '39051', description: 'UPO Q4755050 1/2 PEX PROPEX TEE', unit_price: 1.915, ext: 11.49 },
    { qty: 8, unit: 'ea', part: '39030', description: 'UPO Q4760500 1/2 PEX PROPEX ELBOW', unit_price: 1.919, ext: 15.35 },
    { qty: 2, unit: 'ea', part: '176715', description: '2IN NO HUB COUPLING - IMP MAT 452008 MIF MI-HUB-2 NAC SSC200', unit_price: 3.634, ext: 7.27 },
    { qty: 1, unit: 'ea', part: '772', description: '2IN PVC DWV WYE', unit_price: 4.692, ext: 4.69 },
    { qty: 1, unit: 'ea', part: '719', description: '2IN PVC DWV STREET 45 ELL', unit_price: 2.233, ext: 2.23 },
    { qty: 6, unit: 'ea', part: '2274', description: 'SC 553-7W 2IN PVC DWV J-HOOK HANGS TUFF PIPE HANGER', unit_price: 0.861, ext: 5.17 },
    { qty: 1, unit: 'ea', part: '727', description: '2IN PVC DWV 90 ELL', unit_price: 2.362, ext: 2.36 },
    { qty: 1, unit: 'ea', part: '802', description: '2IN PVC DWV TEE', unit_price: 3.852, ext: 3.85 },
    { qty: 1, unit: 'ea', part: '922', description: 'SC 239 1-1/2 ABS MIP QUICK VENT', unit_price: 3.229, ext: 3.23 },
    { qty: 20, unit: 'ft', part: '10236', description: '2 X 10 PVC DWV FOAMCORE PIPE', unit_price: 0.933, ext: 18.66 },
    { qty: 3, unit: 'ea', part: '51194', description: 'PRIER C-144W08 8IN WIRSBO WALL HYD', unit_price: 46.526, ext: 139.58 },
    { qty: 3, unit: 'ea', part: '41099', description: 'UPO LF4525050 1/2X1/2 MALE THRD ADPTR', unit_price: 5.046, ext: 15.14 },
    { qty: 4, unit: 'ea', part: '56906', description: 'UPO Q4690512 1/2 PROPEX RING W/STOP', unit_price: 0.294, ext: 1.18 },
  ],
};

async function openEstimate(page, mode) {
  await page.evaluate((mode) => {
    if (!clients.find(c => c && c.id === 'c-sup-1')) {
      clients.push({ id: 'c-sup-1', name: 'Maverick Steinhoff', address: '1820 SW Randolph Ave, Topeka, KS 66604', phone: '', email: '' });
    }
    const c = clients.find(x => x.id === 'c-sup-1');
    if (mode === 'tm') openTMEstimate(c, null); else openFreeFormEstimate(c, null);
  }, mode);
  // Past the job-type step to the builder, the way he gets there.
  await page.evaluate(() => { if (typeof goGeiStep === 'function') goGeiStep(2); });
  await page.waitForSelector('#sup-card', { state: 'attached', timeout: 5000 }).catch(() => {});
}

test.describe('supply list: pure functions', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('typed lines: count, unit and description', async () => {
    const r = await page.evaluate(() => [
      '3 ea 3/4 ball valve', '20 ft 2in pvc', '3 ball valves', '3/4 ball valve', 'water heater',
      '1 coil 1/2 pex', '', '   ', null, '0 ea thing', '2.5 gal primer',
    ].map(_supParseLine));
    expect(r[0]).toMatchObject({ qty: 3, unit: 'ea', desc: '3/4 ball valve', cost: 0, on: true });
    expect(r[1]).toMatchObject({ qty: 20, unit: 'ft', desc: '2in pvc' });
    expect(r[2]).toMatchObject({ qty: 3, unit: 'ea', desc: 'ball valves' });
    // A size is not a count.
    expect(r[3]).toMatchObject({ qty: 1, desc: '3/4 ball valve' });
    expect(r[4]).toMatchObject({ qty: 1, unit: 'ea', desc: 'water heater' });
    expect(r[5]).toMatchObject({ qty: 1, unit: 'coil', desc: '1/2 pex' });
    expect(r[6]).toBeNull(); expect(r[7]).toBeNull(); expect(r[8]).toBeNull();
    expect(r[9]).toMatchObject({ qty: 1 });
    expect(r[10]).toMatchObject({ qty: 2.5, unit: 'gal', desc: 'primer' });
  });

  test('the real Neenan quotes: every line adds up and the lines equal the subtotal', async () => {
    const r = await page.evaluate(([a, b]) => [_supCheckQuote(a), _supCheckQuote(b)], [Q_STEINHOFF, Q_14TH]);
    for (const [c, sub, n] of [[r[0], 1356.43, 11], [r[1], 315.72, 15]]) {
      expect(c.lines.length).toBe(n);
      expect(c.flagged).toBe(0);
      expect(c.sumOk).toBe(true);
      expect(c.sum).toBeCloseTo(sub, 2);
      expect(c.taxCharged).toBe(false);
    }
    expect(r[0].reference).toBe('MAVERICK STEINHOFF');
    expect(r[1].lines[1]).toMatchObject({ qty: 1, unit: 'cl', cost: 52.94 });
  });

  test('the real scans: both Neenan quotes come out exactly right from the word positions', async () => {
    const fx = ['neenan-S3318549', 'neenan-S3317925'].map(n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.boxes.json'), 'utf8')));
    const r = await page.evaluate(([a, b]) => [a, b].map(boxes => {
      const q = _supParseQuoteText(_supRowsFromBoxes(boxes), { reference: 'STEINHOFF · 1820 SW RANDOLPH AVE' });
      const c = _supCheckQuote(q);
      return { vendor: q.vendor, number: q.quote_number, date: q.date, taxIncluded: q.tax_included, sumOk: c.sumOk, flagged: c.flagged,
        sum: c.sum, lines: c.lines.map(l => [l.qty, l.unit, l.part, l.cost]) };
    }), fx);
    const truth = [Q_STEINHOFF, Q_14TH];
    r.forEach((got, i) => {
      const want = truth[i];
      expect(got.vendor).toBe('Neenan Co. Topeka');
      expect(got.number).toBe(want.quote_number);
      expect(got.date).toBe(want.date);
      expect(got.taxIncluded).toBe(false);
      expect(got.sumOk).toBe(true);
      expect(got.flagged).toBe(0);
      expect(got.sum).toBeCloseTo(want.subtotal, 2);
      expect(got.lines.map(l => l[3])).toEqual(want.lines.map(l => l.ext));
      expect(got.lines.map(l => l[0])).toEqual(want.lines.map(l => l.qty));
      // Parts too, except where the scan itself is ambiguous.
      expect(got.lines.filter((l, j) => l[2] === want.lines[j].part).length).toBeGreaterThanOrEqual(want.lines.length - 1);
    });
  });

  test('clean reader output (what the phone gives): rows, continuations, totals', async () => {
    const r = await page.evaluate(() => {
      const q = _supParseQuoteText([
        'Neenan Co. Topeka  Quotation', '09/21/26  S3318549',
        '1ea  403386  CORRO-PROTEC 96383 POWERED ANODE  161.708  161.71', 'ROD FOR BRADFORD WHITE UNITS',
        '3ea  149505  3/4 SWT LF FULL PORT BALL VALVE  13.497  40.49', 'MUEL 117-844',
        '10ft  5130  3/4 X 10 M HARD COPPER TUBE  4.026  40.26',
        'TAXES NOT INCLUDED', 'Subtotal  242.46', 'S&H CHGS  0.00', 'Amount Due  242.46',
      ]);
      return { q, c: _supCheckQuote(q) };
    });
    expect(r.q.lines.map(l => l.description)).toEqual([
      'CORRO-PROTEC 96383 POWERED ANODE ROD FOR BRADFORD WHITE UNITS',
      '3/4 SWT LF FULL PORT BALL VALVE MUEL 117-844',
      '3/4 X 10 M HARD COPPER TUBE',
    ]);
    expect(r.q.lines.map(l => l.part)).toEqual(['403386', '149505', '5130']);
    expect(r.q.subtotal).toBe(242.46);
    expect(r.q.tax_included).toBe(false);
    expect(r.c.sumOk).toBe(true);
  });

  test('a quote that charges tax is read as taxed', async () => {
    const r = await page.evaluate(() => _supParseQuoteText([
      'Some Supply Co', '1ea  1234  WIDGET  10.00  10.00', 'Subtotal  10.00', 'Sales Tax  0.95', 'Total  10.95',
    ]));
    expect(r.tax_included).toBe(true);
    expect(r.tax_amount).toBe(0.95);
    expect(r.total).toBe(10.95);
  });

  test('rows from word positions: same line joins left to right, pages stay apart', async () => {
    const r = await page.evaluate(() => _supRowsFromBoxes([
      { text: '161.71', page: 0, x: 0.9, y: 0.300, w: 0.05, h: 0.01 },
      { text: '1ea', page: 0, x: 0.05, y: 0.301, w: 0.03, h: 0.01 },
      { text: 'ANODE', page: 0, x: 0.3, y: 0.299, w: 0.2, h: 0.01 },
      { text: 'NEXT LINE', page: 0, x: 0.3, y: 0.32, w: 0.2, h: 0.01 },
      { text: 'PAGE TWO', page: 1, x: 0.1, y: 0.30, w: 0.2, h: 0.01 },
      null, { text: '' }, { text: 'no y' },
    ]));
    expect(r).toEqual(['1ea  ANODE  161.71', 'NEXT LINE', 'PAGE TWO']);
  });

  test('parser: null, empty and junk never throw', async () => {
    const r = await page.evaluate(() => [null, undefined, [], [''], ['   '], 'text', [null, 5, {}], ['|||', '====']]
      .map(x => { try { return _supParseQuoteText(x).lines.length; } catch (e) { return 'threw'; } }));
    expect(r).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const rb = await page.evaluate(() => [null, undefined, 'x', [], [{}]].map(x => { try { return _supRowsFromBoxes(x).length; } catch (e) { return 'threw'; } }));
    expect(rb).toEqual([0, 0, 0, 0, 0]);
  });

  test('a misread is flagged, never trusted', async () => {
    const r = await page.evaluate((q) => {
      const bad = JSON.parse(JSON.stringify(q));
      bad.lines[4].ext = 404.9;       // 3 x 13.497 read as 404.90
      bad.lines[7].qty = null;        // "10ft" unreadable
      bad.subtotal = 3315.72;         // the OCR misread on the other quote
      return _supCheckQuote(bad);
    }, Q_14TH);
    expect(r.flagged).toBe(2);
    expect(r.lines[4].flag).toMatch(/Does not add up/);
    expect(r.lines[7].flag).toMatch(/quantity/);
    expect(r.sumOk).toBe(false);
  });

  test('tax charged only when the quote actually shows tax', async () => {
    const r = await page.evaluate(() => [
      _supCheckQuote({ tax_included: true, tax_amount: 12.5, subtotal: 10, lines: [{ qty: 1, unit: 'ea', description: 'X', unit_price: 10, ext: 10 }] }).taxCharged,
      _supCheckQuote({ tax_included: true, tax_amount: 0, subtotal: 10, lines: [{ qty: 1, unit: 'ea', description: 'X', unit_price: 10, ext: 10 }] }).taxCharged,
      _supCheckQuote({ tax_included: false, tax_amount: 12.5, lines: [] }).taxCharged,
    ]);
    expect(r).toEqual([true, false, false]);
  });

  test('null, empty and malformed quotes never throw', async () => {
    const r = await page.evaluate(() => [null, undefined, 'x', 42, {}, { lines: 'no' }, { lines: [null, 5, { description: '' }] }]
      .map(q => { try { const c = _supCheckQuote(q); return c.lines.length; } catch (e) { return 'threw'; } }));
    expect(r).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('markup: clamped 0 to 100, applied to cost of ticked lines only', async () => {
    const r = await page.evaluate(() => {
      const d = { items: [{ cost: 100, on: true }, { cost: 50, on: false }, { cost: 0, on: true }], markup: 25 };
      return {
        price: _supPrice(d), cost: _supCost(d),
        clamp: [_supClampMarkup(-5), _supClampMarkup(150), _supClampMarkup('abc'), _supClampMarkup('12.5'), _supClampMarkup(null)],
        empty: _supPrice(null),
      };
    });
    expect(r.cost).toBe(100);
    expect(r.price).toBe(125);
    expect(r.clamp).toEqual([0, 100, 0, 12.5, 0]);
    expect(r.empty).toBe(0);
  });

  test('the list PDF is a valid PDF: header, xref offsets, trailer, escaping, pages', async () => {
    const r = await page.evaluate(() => {
      const many = Array.from({ length: 90 }, (_, i) => ({ qty: i + 1, unit: 'ea', desc: 'Item (' + i + ') \\ back — dash' }));
      const bytes = _supPdfBytes({ business: 'Schonfeldt Plumbing', to: 'Neenan', reference: 'STEINHOFF · 1820 SW RANDOLPH AVE', date: '2026-09-26', items: many });
      let s = ''; for (const b of bytes) s += String.fromCharCode(b);
      const xref = Number(s.match(/startxref\n(\d+)/)[1]);
      const table = s.slice(xref).split('\n');
      const n = Number(table[1].split(' ')[1]);
      let offsetsOk = true;
      for (let i = 1; i < n; i++) {
        const off = Number(table[2 + i].slice(0, 10));
        if (!s.startsWith(i + ' 0 obj', off)) offsetsOk = false;
      }
      return { head: s.slice(0, 8), tail: s.trimEnd().slice(-5), xrefOk: s.startsWith('xref', xref), offsetsOk,
        pages: Number(s.match(/\/Count (\d+)/)[1]), escaped: s.includes('Item \\(0\\) \\\\ back - dash'), ascii: bytes.every(b => b < 128) };
    });
    expect(r.head).toBe('%PDF-1.4');
    expect(r.tail).toBe('%%EOF');
    expect(r.xrefOk).toBe(true);
    expect(r.offsetsOk).toBe(true);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.escaped).toBe(true);
    expect(r.ascii).toBe(true);
  });

  test('sales tax: a line the supply house already taxed is not taxed again', async () => {
    const r = await page.evaluate(() => {
      const base = { state: 'KS', tradeType: 'plumbing', scope: 'repair', propertyType: 'residential', taxRate: 10 };
      return [
        calcSalesTax({ ...base, lineItems: [{ total: 100, lineType: 'materials' }] }).taxAmount,
        calcSalesTax({ ...base, lineItems: [{ total: 100, lineType: 'taxpaid' }] }).taxAmount,
        calcSalesTax({ ...base, lineItems: [{ total: 100, lineType: 'taxpaid' }, { total: 50, lineType: 'materials' }] }).taxAmount,
      ];
    });
    expect(r).toEqual([10, 0, 5]);
  });
});

test.describe('supply list: on a BYO estimate', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await openEstimate(page, 'byo');
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the card is on the BYO page with its markup box and both buttons', async () => {
    await expect(page.locator('#sup-card')).toBeVisible();
    await expect(page.locator('#sup-markup')).toHaveAttribute('type', 'number');
    await expect(page.locator('#sup-card button', { hasText: 'Send to supply house' })).toBeDisabled();
    await expect(page.locator('#sup-card button', { hasText: 'Load their quote' })).toBeEnabled();
  });

  test('typing the list adds lines with no prices yet', async () => {
    await page.locator('#sup-add').fill('3 ea 3/4 ball valve\n1 40 gal gas water heater');
    await page.locator('#sup-card button', { hasText: '+ Add to list' }).click();
    await expect(page.locator('#sup-card .sup-row')).toHaveCount(2);
    await expect(page.locator('#sup-card')).toContainText('Waiting on their quote');
    await expect(page.locator('#sup-card button', { hasText: 'Send to supply house' })).toBeEnabled();
    const host = await page.evaluate(() => { const it = _byoItems.find(x => x._supply); return { section: it.section, price: it.price, n: it._supply.items.length }; });
    expect(host).toEqual({ section: 'Materials', price: 0, n: 2 });
  });

  test('a quote replaces the typed list with its wording; unticking the second heater drops it', async () => {
    await page.evaluate((q) => _supReview(_supCheckQuote(q)), Q_STEINHOFF);
    await expect(page.locator('#_sup-review')).toBeVisible();
    await expect(page.locator('#_sup-review')).toContainText('add up to their subtotal');
    await page.locator('#_sup-review .byo-check[data-i="2"]').click();   // the Ruud
    await page.locator('#_sup-apply').click();
    await expect(page.locator('#_sup-review')).toHaveCount(0);
    const r = await page.evaluate(() => {
      const it = _byoItems.find(x => x._supply);
      return { label: it.label, price: it.price, n: it._supply.items.length, off: it._supply.items.filter(x => x.on === false).length,
        first: it._supply.items[0].desc, geiLine: _geiLines.find(l => l._supply) };
    });
    expect(r.label).toBe('Materials (Neenan Co. Topeka)');
    expect(r.n).toBe(11);
    expect(r.off).toBe(1);
    expect(r.first).toMatch(/^CORRO-PROTEC/);
    expect(r.price).toBeCloseTo(1356.43 - 497.15, 2);
    expect(r.geiLine).toBeTruthy();
  });

  test('markup goes on top, and sales tax is figured on the marked-up price', async () => {
    await page.locator('#sup-markup').fill('20');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      _geiClientTaxRate = { rate: 10, source: 'db_zip' };
      _byoUpdateRail();
      const it = _byoItems.find(x => x._supply);
      const tax = parseFloat(String(document.getElementById('byo-rail-tax-amt')?.textContent || '').replace(/[^0-9.]/g, ''));
      return { price: it.price, markup: it._supply.markup, tax };
    });
    const cost = 1356.43 - 497.15;
    expect(r.markup).toBe(20);
    expect(r.price).toBeCloseTo(Math.round(cost * 1.2 * 100) / 100, 2);
    expect(r.tax).toBeCloseTo(Math.round(r.price * 0.10 * 100) / 100, 2);
    await expect(page.locator('#sup-card')).toContainText('Client price');
  });

  test('the proposal never shows cost: the line carries the client price only', async () => {
    const r = await page.evaluate(() => { const l = _geiLines.find(x => x._supply); return { total: l.total, notes: l.notes }; });
    expect(r.notes).toMatch(/items? per supply house quote S3318549/);
    expect(r.notes).not.toMatch(/\$/);
  });

  test('a quote that charged tax is not taxed again on the proposal', async () => {
    const r = await page.evaluate(() => {
      const d = _byoItems.find(x => x._supply)._supply;
      d.quote.taxCharged = true;
      _supSync();
      _geiClientTaxRate = { rate: 10, source: 'db_zip' };
      _byoUpdateRail();
      const tax = String(document.getElementById('byo-rail-tax-amt')?.textContent || '');
      const row = document.getElementById('byo-rail-tax-row');
      const line = _geiLines.find(l => l._supply)._taxPaid === true;
      const rowShown = row ? getComputedStyle(row).display !== 'none' : false;
      d.quote.taxCharged = false; _supSync();
      return { line, tax, rowShown };
    });
    expect(r.line).toBe(true);
    if (r.rowShown) expect(parseFloat(r.tax.replace(/[^0-9.]/g, '')) || 0).toBe(0);
  });

  test('it saves with the estimate: the list lives on the saved BYO item', async () => {
    const r = await page.evaluate(() => {
      _byoAutosave();
      const b = bids.find(x => x.id === _geiEditBidId);
      const it = b && (b.byoItems || []).find(x => x._supply);
      return it ? { n: it._supply.items.length, markup: it._supply.markup } : null;
    });
    expect(r).toEqual({ n: 11, markup: 20 });
  });

  test('send: opens HIS mail app addressed, with the PDF attached, and remembers the house', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; const origFetch = window.fetch; let args = null; let fetched = false;
      window.fetch = async (...a) => { fetched = true; return origFetch(...a); };
      _supReader = () => ({ composeEmail: async (a) => { args = a; return { result: 'sent' }; } });
      try {
        _supOpenSend();
        document.getElementById('sup-send-name').value = 'Neenan Co. Topeka';
        document.getElementById('sup-send-email').value = 'quotes@neenan.example';
        const ok = await _supSend();
        const d = _byoItems.find(x => x._supply)._supply;
        return { ok, fetched, to: args && args.to, subject: args && args.subject, body: args && args.body,
          pdf: args && args.attachmentBase64.slice(0, 7), filename: args && args.filename, mime: args && args.mime,
          house: (S.supplyHouses || [])[0], modal: !!document.getElementById('_sup-send'), sentRef: d.sentRef, sentAt: !!d.sentAt };
      } finally { _supReader = orig; window.fetch = origFetch; }
    });
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(false);          // nothing goes through our servers
    expect(r.to).toBe('quotes@neenan.example');
    expect(r.subject).toMatch(/STEINHOFF/);
    expect(r.body).toMatch(/customer order number/);
    expect(r.pdf).toBe('JVBERi0');
    expect(r.filename).toMatch(/^Materials .*\.pdf$/);
    expect(r.mime).toBe('application/pdf');
    expect(r.house).toEqual({ name: 'Neenan Co. Topeka', email: 'quotes@neenan.example' });
    expect(r.modal).toBe(false);
    expect(r.sentRef).toMatch(/STEINHOFF/);
    expect(r.sentAt).toBe(true);
  });

  test('send: cancelling in the mail app changes nothing', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader;
      const d = _byoItems.find(x => x._supply)._supply; const before = d.sentAt;
      _supReader = () => ({ composeEmail: async () => ({ result: 'cancelled' }) });
      try {
        _supOpenSend();
        document.getElementById('sup-send-email').value = 'other@supply.example';
        const ok = await _supSend();
        const still = !!document.getElementById('_sup-send');
        document.getElementById('_sup-send')?.remove();
        return { ok, still, same: d.sentAt === before, first: (S.supplyHouses || [])[0].email };
      } finally { _supReader = orig; }
    });
    expect(r).toEqual({ ok: false, still: true, same: true, first: 'quotes@neenan.example' });
  });

  test('send: no Apple Mail account falls back to the share sheet with the PDF', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; const os = navigator.share, oc = navigator.canShare;
      let shared = null;
      _supReader = () => ({ composeEmail: async () => ({ result: 'unavailable' }) });
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: async (x) => { shared = x; }, configurable: true });
      try {
        _supOpenSend();
        document.getElementById('sup-send-email').value = 'quotes@neenan.example';
        const ok = await _supSend();
        return { ok, file: shared && shared.files && shared.files[0].name, type: shared && shared.files[0].type };
      } finally {
        _supReader = orig;
        Object.defineProperty(navigator, 'share', { value: os, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: oc, configurable: true });
      }
    });
    expect(r.ok).toBe(true);
    expect(r.file).toMatch(/\.pdf$/);
    expect(r.type).toBe('application/pdf');
  });

  test('send: an older app without composeEmail falls back to the share sheet, no error', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; const os = navigator.share, oc = navigator.canShare;
      let shared = false;
      _supReader = () => ({ composeEmail: async () => { throw new Error('"composeEmail" is not implemented on ios'); } });
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: async () => { shared = true; }, configurable: true });
      try {
        _supOpenSend();
        document.getElementById('sup-send-email').value = 'quotes@neenan.example';
        const ok = await _supSend();
        const alert = !!document.querySelector('.zmodal-overlay:not(#_sup-send)');
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { ok, shared, alert };
      } finally {
        _supReader = orig;
        Object.defineProperty(navigator, 'share', { value: os, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: oc, configurable: true });
      }
    });
    expect(r).toEqual({ ok: true, shared: true, alert: false });
  });

  test('send refuses a bad email and opens nothing', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; let opened = false;
      _supReader = () => ({ composeEmail: async () => { opened = true; return { result: 'sent' }; } });
      try {
        _supOpenSend();
        document.getElementById('sup-send-email').value = 'not-an-email';
        const ok = await _supSend();
        document.getElementById('_sup-send')?.remove();
        return { ok, opened };
      } finally { _supReader = orig; }
    });
    expect(r).toEqual({ ok: false, opened: false });
  });

  test('import: the file goes to the phone reader, the rows are rebuilt, the review opens', async () => {
    const boxes = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'neenan-S3318549.boxes.json'), 'utf8'));
    const r = await page.evaluate(async (boxes) => {
      const orig = _supReader; let args = null;
      _supReader = () => ({ recognizeText: async (a) => { args = a; return { ok: true, lines: [], boxes }; } });
      try {
        const ok = await _supImportBlob(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }));
        const review = document.getElementById('_sup-review');
        const text = review ? review.textContent : '';
        document.getElementById('_sup-review')?.remove();
        return { ok, review: !!review, mime: args && args.mime, hasData: !!(args && args.base64), text };
      } finally { _supReader = orig; }
    }, boxes);
    expect(r.ok).toBe(true);
    expect(r.review).toBe(true);
    expect(r.mime).toBe('application/pdf');
    expect(r.hasData).toBe(true);
    expect(r.text).toContain('S3318549');
    expect(r.text).toContain('add up to their subtotal');
  });

  test('import from Share: a file path goes to the reader as a path', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; let args = null;
      _supReader = () => ({ recognizeText: async (a) => { args = a; return { ok: true, boxes: [], lines: [] }; } });
      try {
        const ok = await _supImportBlob({ path: '/var/mobile/share/quote.pdf' });
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { ok, args };
      } finally { _supReader = orig; }
    });
    expect(r.args).toEqual({ path: '/var/mobile/share/quote.pdf' });
    expect(r.ok).toBe(false);   // nothing on the page: says so, adds nothing
  });

  test('no phone reader (a computer): says to use the phone or type prices, never calls a server', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; const origFetch = window.fetch; let fetched = false;
      _supReader = () => null;
      window.fetch = async (...a) => { fetched = true; return origFetch(...a); };
      try {
        const ok = await _supImportBlob(new Blob(['%PDF'], { type: 'application/pdf' }));
        const msg = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { ok, fetched, msg };
      } finally { _supReader = orig; window.fetch = origFetch; }
    });
    expect(r.ok).toBe(false);
    expect(r.fetched).toBe(false);
    expect(r.msg).toMatch(/iPhone/);
  });

  test('a reader that throws, or a wrong file type, adds nothing and says so', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader;
      _supReader = () => ({ recognizeText: async () => { throw new Error('vision failed'); } });
      try {
        const bad = await _supImportBlob(new Blob(['%PDF'], { type: 'application/pdf' }));
        const alerted = !!document.querySelector('.zmodal-overlay');
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        const wrongType = await _supImportBlob(new Blob(['x'], { type: 'text/plain' }));
        return { bad, alerted, wrongType };
      } finally { _supReader = orig; }
    });
    expect(r).toEqual({ bad: false, alerted: true, wrongType: false });
  });

  test('two imports at once: only one runs', async () => {
    const r = await page.evaluate(async () => {
      const orig = _supReader; let calls = 0;
      _supReader = () => ({ recognizeText: async () => { calls++; await new Promise(res => setTimeout(res, 50)); return { boxes: [], lines: [] }; } });
      try {
        const blob = new Blob(['%PDF'], { type: 'application/pdf' });
        await Promise.all([_supImportBlob(blob), _supImportBlob(blob), _supImportBlob(blob)]);
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return calls;
      } finally { _supReader = orig; }
    });
    expect(r).toBe(1);
  });

  test('any price can be typed by hand, and clears the flag', async () => {
    const r = await page.evaluate(() => {
      const d = _byoItems.find(x => x._supply)._supply;
      d.items[0].flag = 'Could not read the price. Check this line.';
      _supEditCost(0);
      const inp = document.getElementById('zprompt-inp');
      inp.value = '150.00';
      document.getElementById('zprompt-ok').click();
      return { cost: d.items[0].cost, flag: d.items[0].flag };
    });
    expect(r).toEqual({ cost: 150, flag: '' });
  });

  test('share: the estimate waiting on a quote is found, opened, and the shared file read into it', async () => {
    const r = await page.evaluate(async () => {
      _byoAutosave();
      const waiting = _supWaitingBids().map(b => b.id);
      const orig = _supReader; let args = null; const cleared = [];
      _supReader = () => ({ recognizeText: async (a) => { args = a; return { boxes: [], lines: ['Neenan Co. Topeka', '1ea  1234  WIDGET  10.000  10.00', 'Subtotal  10.00'] }; } });
      try {
        const started = _supFromShare({ path: '/share/q.pdf' }, p => cleared.push(...p));
        for (let i = 0; i < 40 && !document.getElementById('_sup-review'); i++) await new Promise(res => setTimeout(res, 50));
        const review = !!document.getElementById('_sup-review');
        document.getElementById('_sup-review')?.remove();
        return { n: waiting.length, isCurrent: waiting[0] === _geiEditBidId, started, args, review, cleared };
      } finally { _supReader = orig; }
    });
    expect(r.n).toBeGreaterThanOrEqual(1);
    expect(r.isCurrent).toBe(true);
    expect(r.started).toBe(true);
    expect(r.args).toEqual({ path: '/share/q.pdf' });
    expect(r.review).toBe(true);
    expect(r.cleared).toEqual(['/share/q.pdf']);
  });

  test('share sheet offers "A supply house quote" only while an estimate waits on one', async () => {
    const r = await page.evaluate(() => {
      const items = [{ path: '/share/q.pdf' }];
      _shareInPrompt(items);
      const withList = !!document.getElementById('_si-supply');
      document.getElementById('_sharein-ov')?.remove(); _shareInAsking = false;
      const saved = bids.slice();
      bids.splice(0, bids.length);
      _shareInPrompt(items);
      const without = !!document.getElementById('_si-supply');
      document.getElementById('_sharein-ov')?.remove(); _shareInAsking = false;
      saved.forEach(b => bids.push(b));
      return { withList, without };
    });
    expect(r).toEqual({ withList: true, without: false });
  });

  test('share with nothing waiting, or no file: does nothing', async () => {
    const r = await page.evaluate(() => {
      const saved = bids.slice(); bids.splice(0, bids.length);
      const a = _supFromShare({ path: '/x.pdf' });
      saved.forEach(b => bids.push(b));
      const b2 = _supFromShare(null);
      return [a, b2];
    });
    expect(r).toEqual([false, false]);
  });

  test('layout: no sideways bleed at phone width', async () => {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, right: document.getElementById('sup-card').getBoundingClientRect().right }));
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.right).toBeLessThanOrEqual(r.iw + 1);
  });

  test('the supply line is not learned as a "usually goes with" line', async () => {
    const r = await page.evaluate(() => {
      const b = { byoItems: [{ label: 'Materials (Neenan)', on: true, _supply: { items: [] } }, { label: 'Install heater', on: true, rate: 400 }] };
      return _pkgBidLines(b).map(x => x.label);
    });
    expect(r).toEqual(['Install heater']);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});

test.describe('supply list: on a T&M estimate', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await openEstimate(page, 'tm');
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the list rides on one T&M material line, not a category row', async () => {
    const r = await page.evaluate((q) => {
      _tmRenderMatList();
      const hasCard = !!document.querySelector('#tm-mat-list #sup-card');
      _supReview(_supCheckQuote(q));
      _supApplyReview();
      const lines = _geiLines.filter(l => l._supply);
      const rows = document.querySelectorAll('#tm-mat-list .byo-row').length;
      return { hasCard, n: lines.length, total: lines[0] && lines[0].total, rows, inMat: !!document.querySelector('#mat-card #sup-card') };
    }, Q_14TH);
    expect(r.hasCard).toBe(true);
    expect(r.n).toBe(1);
    expect(r.total).toBeCloseTo(315.72, 2);
    expect(r.rows).toBe(0);
    expect(r.inMat, 'drawn inside the shared Materials card').toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});

test.describe('supply list: nothing goes through our servers', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  // §7.1: both server paths are gone, not merely unused. The quote is read on
  // the phone (no AI) and the list is sent from his own mail app (no Resend).
  test('the AI quote reader and the Resend sender are deleted', () => {
    for (const fn of ['read-supplier-quote', 'send-supply-list']) {
      expect(fs.existsSync(path.join(__dirname, '..', 'supabase', 'functions', fn))).toBe(false);
    }
    const src = read('js/supply-list.js');
    expect(src).not.toMatch(/functions\/v1\//);
    expect(src).not.toMatch(/fetch\(/);
  });
  test('the native plugin composes mail with Apple\'s composer', () => {
    const sw = read('native/td-doc/ios/Plugin/TdDocPlugin.swift');
    expect(sw).toMatch(/MFMailComposeViewController/);
    expect(sw).toMatch(/name: "composeEmail"/);
  });
});
