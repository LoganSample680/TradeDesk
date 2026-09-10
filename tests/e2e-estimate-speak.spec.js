// @ts-check
// ── Saying the estimate out loud ────────────────────────────────────────────
//
// "T and M for the Delaneys, about eight hours, water heater replacement."
//
// The whole point of this file is that none of it is a model call. Every part
// of the sentence resolves against something the app already holds: three
// fixed phrasings for the billing type, a number next to the word hours, his
// own customer list, his own price book. So it runs in a truck with no signal
// and costs nothing per estimate, and these tests are the proof that the
// matching is good enough to trust.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CLIENTS = [
  { id: 7001, name: 'Rick Delaney', addr: '412 Maple St, Wichita, KS 67203' },
  { id: 7002, name: 'Sandra Ruiz', addr: '2100 Oak Ave, Wichita, KS 67208' },
  { id: 7003, name: 'Henderson Property Group', addr: '1 Commerce Dr, Derby, KS 67037' },
];
const BOOK = [
  { desc: 'Replace 40 gal water heater', rate: 1850, n: 4 },
  { desc: 'Rebuild tub/shower valve', rate: 425, n: 3 },
  { desc: 'Install kitchen faucet', rate: 285, n: 2 },
];

test.describe('estimate-speak', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const parse = (text) => page.evaluate(([t, cl, bk]) => spkParse(t, { clients: cl, book: bk, catalog: [] }), [text, CLIENTS, BOOK]);

  test.describe('how he is billing it', () => {
    const cases = [
      ['t and m for rick delaney', 'tm'],
      ['T&M for Rick Delaney', 'tm'],
      ['time and materials for rick delaney', 'tm'],
      ['hourly for rick delaney', 'tm'],
      ['flat rate for rick delaney', 'byo'],
      ['fixed price for rick delaney', 'byo'],
    ];
    for (const [said, want] of cases) {
      test(`"${said}" reads as ${want}`, async () => {
        expect(await page.evaluate(t => spkBillingType(t), said)).toBe(want);
      });
    }
    test('a sentence with no billing words says so, rather than guessing', async () => {
      expect(await page.evaluate(() => spkBillingType('water heater for rick delaney'))).toBeNull();
    });
  });

  test.describe('hours, however he says them', () => {
    const cases = [
      ['about 8 hours', 8], ['8hrs', 8], ['8 hr', 8], ['1.5 hours', 1.5],
      ['two days', 16], ['a day', 8], ['half a day', 4], ['half day', 4],
      ['couple of days', 16], ['eight hours', 8], ['three days', 24],
      ['no idea how long', 0], ['', 0],
    ];
    for (const [said, want] of cases) {
      test(`"${said}" is ${want} hours`, async () => {
        expect(await page.evaluate(t => spkHours(t), said)).toBe(want);
      });
    }
  });

  test.describe('which customer he means', () => {
    test('a family name plural still finds the person', async () => {
      const r = await parse('t and m for the delaneys, eight hours, water heater');
      expect(r.clientId).toBe(7001);
    });
    test('a full name wins over a partial one', async () => {
      const r = await parse('flat bid for sandra ruiz, install kitchen faucet');
      expect(r.clientId).toBe(7002);
    });
    test('a company name works the same way', async () => {
      const r = await parse('t and m for henderson property group, two days');
      expect(r.clientId).toBe(7003);
    });
    test('no name mentioned matches nobody, rather than the first row', async () => {
      const r = await parse('t and m eight hours water heater');
      expect(r.client).toBeNull();
      expect(r.actionable).toBe(false);   // a bid with no customer is not a bid
    });
    test('a name he does not have matches nobody', async () => {
      const r = await parse('t and m for the schwarzenbergers, four hours');
      expect(r.client).toBeNull();
    });
  });

  test.describe('what the work is', () => {
    test('matches his own book, with his price', async () => {
      const r = await parse('t and m for the delaneys, eight hours, water heater replacement');
      expect(r.services.length).toBeGreaterThan(0);
      expect(r.services[0].desc).toBe('Replace 40 gal water heater');
      expect(r.services[0].rate).toBe(1850);
      expect(r.services[0].from).toBe('book');
    });
    test('a service he never mentioned is not added', async () => {
      const r = await parse('t and m for the delaneys, eight hours, water heater replacement');
      expect(r.services.map(s => s.desc)).not.toContain('Install kitchen faucet');
    });
    test('falls back to the shipped catalogue when his book is empty', async () => {
      const r = await page.evaluate((cl) => spkParse('flat bid for rick delaney, toilet replacement',
        { clients: cl, book: [], catalog: [{ name: 'Toilet replacement', labor: 250, mat: 145 }] }), CLIENTS);
      expect(r.services[0].desc).toBe('Toilet replacement');
      expect(r.services[0].rate).toBe(395);
      expect(r.services[0].from).toBe('catalog');
    });
    test('half a service name is not a match', async () => {
      // "install" alone appears in his book but is not what he asked for.
      const r = await parse('t and m for the delaneys, four hours, install');
      expect(r.services.length).toBe(0);
    });
  });

  test.describe('the whole sentence', () => {
    test('the owner\'s example resolves end to end', async () => {
      const r = await parse('I need a time and materials bid for Rick Delaney, estimating it will take 8 hours and we will be doing a water heater replacement');
      expect(r.type).toBe('tm');
      expect(r.hours).toBe(8);
      expect(r.clientId).toBe(7001);
      expect(r.services[0].desc).toBe('Replace 40 gal water heater');
      expect(r.actionable).toBe(true);
    });
    test('hours with no billing words still means time and materials', async () => {
      const r = await parse('rick delaney, about six hours');
      expect(r.type).toBe('tm');
      expect(r.actionable).toBe(true);
    });
    test('a name on its own is a name, not a bid', async () => {
      const r = await parse('Sandra Ruiz');
      expect(r.clientId).toBe(7002);
      expect(r.actionable).toBe(false);
    });
    test('junk in, nothing out, and no throw', async () => {
      for (const junk of ['', '   ', '!!!!', '12345']) {
        const r = await parse(junk);
        expect(r.actionable).toBe(false);
      }
      const nulls = await page.evaluate(() => {
        const out = [];
        [null, undefined, 0, {}, []].forEach(v => {
          try { out.push(!!spkParse(v, {}).actionable); } catch (e) { out.push('threw: ' + e.message); }
        });
        return out;
      });
      expect(nulls).toEqual([false, false, false, false, false]);
    });
  });

  test('acting on it seeds the estimate through the existing hand-off', async () => {
    const r = await page.evaluate(([cl, bk]) => {
      clients = clients.filter(c => c.id < 7000 || c.id > 7100).concat(cl);
      S.priceBook = { plumbing: bk };
      window.__opened = [];
      window.openTMEstimate = (c) => { window.__opened.push(['tm', c && c.id]); };
      window.openFreeFormEstimate = (c) => { window.__opened.push(['byo', c && c.id]); };
      window.getActiveTrade = () => 'plumbing';
      window._scanEstimateSeed = null;
      const plan = tdSpeakEstimate('t and m for the delaneys, eight hours, water heater replacement');
      return {
        opened: window.__opened[0],
        seed: window._scanEstimateSeed,
        current: currentClientId,
        actionable: plan.actionable,
      };
    }, [CLIENTS, BOOK]);
    expect(r.actionable).toBe(true);
    expect(r.opened).toEqual(['tm', 7001]);
    expect(r.current).toBe(7001);
    // The same hand-off the room scanner uses, not a second way to seed lines.
    expect(r.seed.clientId).toBe(7001);
    expect(r.seed.lines[0].desc).toBe('Replace 40 gal water heater');
    expect(r.seed.lines[0].rate).toBe(1850);
  });

  test('a sentence it cannot act on opens nothing', async () => {
    const r = await page.evaluate(() => {
      window.__opened = [];
      window.openTMEstimate = (c) => { window.__opened.push(['tm', c && c.id]); };
      window.openFreeFormEstimate = (c) => { window.__opened.push(['byo', c && c.id]); };
      window._scanEstimateSeed = null;
      const plan = tdSpeakEstimate('somebody I have never heard of, eight hours');
      return { opened: window.__opened.length, seed: window._scanEstimateSeed, actionable: plan.actionable };
    });
    expect(r.actionable).toBe(false);
    expect(r.opened).toBe(0);
    expect(r.seed).toBeNull();
  });

  test('no console errors, estimate-speak.js', async () => {
    assertNoErrors(page, 'estimate-speak.js');
  });
});
