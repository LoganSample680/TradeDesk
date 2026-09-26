// @ts-check
// ── The book that writes itself ──────────────────────────────────────────────
//
// `_pbLearn` has always learned a price from the estimate being saved. What it
// never did was read the estimates ALREADY SENT, so a contractor with fourteen
// proposals in the app still opened the price book screen to nothing.
//
// The rule that matters most here, and the reason half these tests exist: the
// n:1 bar is kept exactly as `_pbLearn` sets it. A line used once is remembered
// and NOT offered back, because a one-off must never become his price.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Four sent proposals, written the two ways the app writes them: BYO carries
// byoItems, T&M carries geiLines with a labor line that must never be learned.
const SENT = [
  { id: 91001, trade_type: 'painting', status: 'sent', byoItems: [
    { label: 'Body and trim, two coats', price: 0.78, unit: 'sq ft' },
    { label: 'Prep and pressure wash', price: 320, unit: 'lot' },
    { label: 'Replace rotted trim', price: 22, unit: 'lin ft' },
  ] },
  { id: 91002, trade_type: 'painting', status: 'signed', byoItems: [
    { label: 'Body and trim, two coats', price: 0.78, unit: 'sq ft' },
    { label: 'Prep and pressure wash', price: 320, unit: 'lot' },
    { label: 'Replace rotted trim', price: 28, unit: 'lin ft' },
  ] },
  { id: 91003, trade_type: 'painting', status: 'invoiced', geiLines: [
    { desc: 'Labor: 2 workers @ $95/hr', rate: 190, qty: 24, _tmLabor: true },
    { desc: 'Prep and pressure wash', rate: 320, unit: 'lot' },
    { desc: 'Strip failed paint', rate: 1.15, unit: 'sq ft' },
  ] },
  // Seen once and only once. This is the line that must stay silent.
  { id: 91004, trade_type: 'painting', status: 'sent', byoItems: [
    { label: 'Repaint the mailbox post', price: 60, unit: 'ea' },
  ] },
  // A different trade, and a draft. Neither belongs in a painting book.
  { id: 91005, trade_type: 'roofing', status: 'sent', byoItems: [{ label: 'Tear off and re-roof', price: 9800, unit: 'lot' }] },
  { id: 91006, trade_type: 'painting', status: 'draft', byoItems: [{ label: 'Something half typed', price: 5, unit: 'ea' }] },
];

test.describe('the book that writes itself', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test.beforeEach(async () => {
    await page.evaluate(s => {
      bids.length = 0; s.forEach(b => bids.push(JSON.parse(JSON.stringify(b))));
      S.priceBook = {};
      S.timLearned = {};
      _activeTrade = 'painting';
      _geiTrade = null;
      document.getElementById('_tim-ov')?.remove();
    }, SENT);
  });

  const read = () => page.evaluate(() => timBookFromSent('painting'));

  test.describe('reading what he already sent', () => {
    test('it counts the proposals and the lines in them', async () => {
      const r = await read();
      // 91005 is another trade and 91006 is a draft, so four proposals.
      expect(r.proposals).toBe(4);
      expect(r.offer.map(x => x.desc).sort()).toEqual([
        'Body and trim, two coats', 'Prep and pressure wash', 'Replace rotted trim',
      ]);
    });

    // THE WHOLE RULE. One-off descriptions never become his price, which is why
    // "Repaint the mailbox post" and "Strip failed paint" are held rather than
    // offered: each was seen on exactly one proposal.
    test('a line seen once is held back, not offered', async () => {
      const r = await read();
      const held = r.held.map(x => x.desc).sort();
      expect(held).toEqual(['Repaint the mailbox post', 'Strip failed paint']);
      expect(r.offer.map(x => x.desc)).not.toContain('Repaint the mailbox post');
    });

    // Labor is the crew rate, not a thing he sells. `_pbLearnAll` already keeps
    // it out of the book and this must keep it out too, or every T&M proposal
    // teaches the book a line called "Labor: 2 workers".
    test('the labor line is not a thing he sells, so it never lands', async () => {
      const r = await read();
      const all = r.offer.concat(r.held).map(x => x.desc).join(' ');
      expect(all).not.toContain('Labor');
    });

    test('another trade and an unfinished draft are both left alone', async () => {
      const r = await read();
      const all = r.offer.concat(r.held).map(x => x.desc).join(' ');
      expect(all).not.toContain('Tear off and re-roof');
      expect(all).not.toContain('Something half typed');
    });

    // He charged $22 once and $28 once. Tim takes the middle AND says he did,
    // because silently picking one end of a range he set himself is the kind of
    // thing that makes a man stop trusting the number.
    test('a price he moved is taken at the middle, and it says so', async () => {
      const r = await read();
      const trim = r.offer.find(x => x.desc === 'Replace rotted trim');
      expect(trim.rate).toBe(25);
      expect(trim.lo).toBe(22);
      expect(trim.hi).toBe(28);
      expect(trim.spread).toBe(true);
    });

    test('a price he never moved does not claim he ranged it', async () => {
      const r = await read();
      expect(r.offer.find(x => x.desc === 'Prep and pressure wash').spread).toBe(false);
    });

    test('the unit comes off the line rather than defaulting to each', async () => {
      const r = await read();
      expect(r.offer.find(x => x.desc === 'Body and trim, two coats').unit).toBe('sq ft');
    });
  });

  test.describe('taking them', () => {
    // Written in through `_pbLearn`, twice, so each lands settled rather than as
    // a one-off the book would then hold back. Allowed only because each line
    // has already been used on two proposals, which is the same bar.
    test('they land in the book at the price he charged', async () => {
      const r = await page.evaluate(() => {
        const n = timTakeBook();
        const book = (S.priceBook && S.priceBook.painting) || [];
        return { n, offered: book.filter(x => (x.n || 1) >= 2).map(x => [x.desc, x.rate]) };
      });
      expect(r.n).toBe(3);
      expect(r.offered).toContainEqual(['Body and trim, two coats', 0.78]);
      expect(r.offered).toContainEqual(['Prep and pressure wash', 320]);
      expect(r.offered).toContainEqual(['Replace rotted trim', 25]);
    });

    test('the ones he was never offered stay out of the book', async () => {
      const r = await page.evaluate(() => {
        timTakeBook();
        return ((S.priceBook && S.priceBook.painting) || []).map(x => x.desc);
      });
      expect(r).not.toContain('Repaint the mailbox post');
    });

    // Reading twice must not offer the same work twice. A screen that keeps
    // saying it found three prices after he already took them is a screen that
    // looks broken.
    test('once they are in the book there is nothing left to offer', async () => {
      const r = await page.evaluate(() => {
        timTakeBook();
        return timBookNew('painting').offer.length;
      });
      expect(r).toBe(0);
    });

    test('a price he has since changed is still offered, because it disagrees', async () => {
      const r = await page.evaluate(() => {
        timTakeBook();
        const hit = _pbFind('Prep and pressure wash', 'painting');
        hit.rate = 275;
        return timBookNew('painting').offer.map(x => x.desc);
      });
      expect(r).toEqual(['Prep and pressure wash']);
    });
  });

  test.describe('what a line really earns', () => {
    // Off the clock, not off a guess, and silent until five finished jobs have
    // had their say. Three jobs of a painter having a bad week is not a rate.
    test('under five measured jobs it says nothing', async () => {
      const r = await page.evaluate(() => {
        timTakeBook();
        const hit = _pbFind('Prep and pressure wash', 'painting');
        hit.h = [3.2, 3.6, 3.4];
        return timLineHourly('Prep and pressure wash', 'painting');
      });
      expect(r).toBeNull();
    });

    test('at five it says what the hour is worth', async () => {
      const r = await page.evaluate(() => {
        timTakeBook();
        const hit = _pbFind('Prep and pressure wash', 'painting');
        hit.h = [3.2, 3.6, 3.4, 3.4, 3.5];
        return timLineHourly('Prep and pressure wash', 'painting');
      });
      expect(r.hours).toBe(3.4);
      expect(r.perHour).toBe(94);   // $320 across 3.4 hours
      expect(r.n).toBe(5);
    });

    test('a line the book has never heard of is null, not a crash', async () => {
      const r = await page.evaluate(() => [
        timLineHourly('nothing like this', 'painting'), timLineHourly('', ''), timLineHourly(null),
      ]);
      expect(r).toEqual([null, null, null]);
    });
  });

  test.describe('the sheet', () => {
    test.afterEach(async () => { await page.evaluate(() => document.getElementById('_tim-ov')?.remove()); });

    test('it opens on the app sheet and names what it read', async () => {
      const r = await page.evaluate(() => {
        openTimBook();
        const s = document.getElementById('_tim-sheet');
        return { open: !!s, text: s ? s.textContent : '' };
      });
      expect(r.open).toBe(true);
      expect(r.text).toContain('I read 4 proposals you have already sent');
      expect(r.text).toContain('Held back until you use one again');
      expect(r.text).toContain('Use these as my book');
    });

    test('with nothing sent at all it says so instead of showing an empty table', async () => {
      const r = await page.evaluate(() => {
        bids.length = 0;
        openTimBook();
        return document.getElementById('_tim-sheet').textContent;
      });
      expect(r).toContain('Nothing sent yet to read');
      expect(r).not.toContain('Use these as my book');
    });

    test('opening it ten times leaves exactly one sheet', async () => {
      const n = await page.evaluate(() => {
        for (let i = 0; i < 10; i++) openTimBook();
        return document.querySelectorAll('#_tim-ov').length;
      });
      expect(n).toBe(1);
    });

    test('a corrupted bids list renders rather than throwing', async () => {
      const threw = await page.evaluate(() => {
        bids.length = 0;
        bids.push(null, {}, { trade_type: 'painting', status: 'sent', byoItems: 'not an array' },
          { trade_type: 'painting', status: 'sent', geiLines: [null, { desc: '' }] });
        try { timBookFromSent('painting'); openTimBook(); return false; } catch (e) { return true; }
      });
      expect(threw).toBe(false);
    });
  });

  test('no console errors, tim-book.js', async () => {
    assertNoErrors(page, 'tim-book.js');
  });
});
