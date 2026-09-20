// @ts-check
// ── Tim answering questions about the owner's own books ──────────────────────
//
// Owner, 2026-09-20: he wants Tim to search the database, save the addresses,
// ask about lead source, give insights, and do all of it in the pocket of a
// contractor's beat-up phone. So every assertion below runs with no network and
// no model: the answers are arithmetic over the arrays js/data.js already holds.
//
// The rule these tests exist to hold is narrower than "the maths is right". It
// is that **a figure Tim says is the same figure the page that owns it says.**
// He is quoting a man his own money back to him. A number that is close, or
// stale, or computed a second way, is worse than no answer, because it still
// sounds certain. So the owed tests below check against getBidBalance and the
// Closed Won / completion_date shape renderMoneyPage uses, not against a
// convenient fixture of my own design.
//
// That distinction is not theoretical. _timOwedByClient shipped filtering on
// b.clientId and status 'invoiced'; the app uses b.client_id and 'Closed Won',
// and 'invoiced' is not a status anywhere in the codebase. It matched zero rows
// on every real job, and the nudge suite never caught it because those tests
// hand timNudges() a snapshot object with the figure already in it. The last
// group here is the seam test that was missing.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Shaped the way the app shapes them, which is the whole point.
const SEED = () => {
  _activeTrade = 'painting';
  clients.length = 0; bids.length = 0; payments.length = 0; expenses.length = 0;
  clients.push(
    { id: 7101, name: 'Dana Whitfield', phone: '316-555-0101', email: 'dana@ts.test',
      addr: '1200 Elm St, Wichita KS 67203', source: 'Google' },
    { id: 7102, name: 'Ray Kellerman', phone: '316-555-0144', email: 'ray@ts.test',
      addr: '88 POPLAR AVE, Wichita KS 67211', source: 'Referral' },
    { id: 7103, name: 'Marta Ochoa', phone: '316-555-0177', addr: '4 Vine Ct', source: 'Google' },
    { id: 7104, name: 'Nobody Tagged', phone: '316-555-0199', addr: '9 Blank St' },
  );
  bids.push(
    // Finished nine weeks ago, half paid. The oldest money out.
    { id: 8801, client_id: 7101, status: 'Closed Won', amount: 4000, date: '2026-06-20',
      completion_date: '2026-07-15', byoItems: [
        { label: 'Remove and reset gutters', price: 340, unit: 'lot' },
        { label: 'Body and trim, two coats', price: 0.78, unit: 'sq ft' }] },
    // Finished recently, nothing paid.
    { id: 8802, client_id: 7102, status: 'Closed Won', amount: 1500, date: '2026-08-30',
      completion_date: '2026-09-14' },
    // Won and fully paid: not owed.
    { id: 8803, client_id: 7103, status: 'Closed Won', amount: 900, date: '2026-05-02',
      completion_date: '2026-05-20' },
    // Never won: not owed, and a loss against its source.
    { id: 8804, client_id: 7103, status: 'Closed Lost', amount: 2600, date: '2026-08-01' },
    // Still out: neither won nor lost.
    { id: 8805, client_id: 7101, status: 'Pending', amount: 3300, date: '2026-09-10' },
  );
  payments.push(
    { bid_id: 8801, amount: 2000 },
    { bid_id: 8803, amount: 900 },
  );
  expenses.push(
    { cat: 'marketing', lead_source: 'Google', amount: 600, date: '2026-07-01' },
    { cat: 'marketing', lead_source: 'Truck wrap', amount: 2400, date: '2026-03-11' },
    { cat: 'materials', amount: 812, date: '2026-07-02' },
  );
  S.priceBook = { painting: [
    { desc: 'Remove and reset gutters', rate: 340, unit: 'lot', n: 4, last: '2026-06-11' },
    { desc: 'Strip and repaint, west elevation', rate: 2180, unit: 'lot', n: 5, last: '2026-05-02' },
  ] };
};

test.describe('tim answering off your own books', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(SEED); });

  test.describe('hearing the question', () => {
    test('each family is recognised in the words he would use', async () => {
      const r = await page.evaluate(() => [
        'who owes me money', 'what am I waiting on', 'whats owed',
        'what did I charge the Kellermans for gutters',
        'which lead source is actually worth it',
        'whats the address for Dana',
      ].map(s => (timAskKind(s) || {}).id));
      expect(r).toEqual(['owed', 'owed', 'owed', 'charged', 'source', 'who']);
    });

    test('a longer phrase wins over a shorter one inside it', async () => {
      const r = await page.evaluate(() => timAskKind('who owes me money').phrase);
      expect(r).toBe('who owes me money');
    });

    test('describing work is not a question, so the estimate path keeps it', async () => {
      const r = await page.evaluate(() => [
        'strip and repaint the west elevation',
        'three days, two men, scaffold on the west side',
        'gutters come off first and go back after',
        'five gallons of Duration in Iron Ore',
      ].map(s => timAskKind(s)));
      expect(r).toEqual([null, null, null, null]);
    });
  });

  test.describe('what am I owed', () => {
    test('only Closed Won with a balance counts, and it is grouped by customer', async () => {
      const r = await page.evaluate(() => timOwedAll());
      expect(r.length).toBe(2);
      expect(r.map(x => x.name)).toEqual(['Dana Whitfield', 'Ray Kellerman']);
      // 4000 billed less 2000 paid. Not the bid amount, not the payment.
      expect(r[0].amount).toBe(2000);
      expect(r[1].amount).toBe(1500);
    });

    test('a paid-up job, a lost one and a pending one are all absent', async () => {
      const r = await page.evaluate(() => timOwedAll().map(x => x.name));
      // Marta is paid in full and also has a Closed Lost; neither is money out.
      expect(r).not.toContain('Marta Ochoa');
      // Dana's Pending 3300 must not be added to her 2000.
      const dana = await page.evaluate(() => timOwedAll()[0]);
      expect(dana.amount).toBe(2000);
    });

    test('it agrees with getBidBalance, which is what the Collect page reads', async () => {
      const r = await page.evaluate(() => {
        const mine = timOwedAll().reduce((s, x) => s + x.amount, 0);
        const theirs = bids.filter(b => b.status === 'Closed Won')
          .reduce((s, b) => s + getBidBalance(b), 0);
        return { mine, theirs };
      });
      expect(r.mine).toBe(r.theirs);
    });

    test('oldest money first, because that is the one going bad', async () => {
      const r = await page.evaluate(() => timOwedAll().map(x => ({ n: x.name, d: x.days })));
      expect(r[0].n).toBe('Dana Whitfield');
      expect(r[0].d).toBeGreaterThan(r[1].d);
    });

    test('the days run from the day the work finished, not the proposal date', async () => {
      const r = await page.evaluate(() => {
        const days = timOwedAll()[0].days;
        const fromDone = Math.floor((new Date(todayKey() + 'T12:00') - new Date('2026-07-15T12:00')) / 86400000);
        const fromBid = Math.floor((new Date(todayKey() + 'T12:00') - new Date('2026-06-20T12:00')) / 86400000);
        return { days, fromDone, fromBid };
      });
      expect(r.days).toBe(r.fromDone);
      expect(r.days).not.toBe(r.fromBid);
    });

    test('the answer leads with the total and offers the screen that owns it', async () => {
      const r = await page.evaluate(() => timAsk('who owes me money'));
      expect(r.id).toBe('owed');
      expect(r.title).toBe('$3,500');
      expect(r.sub).toContain('2 customers');
      expect(r.rows.length).toBe(2);
      expect(r.go.fn).toContain('pg-money');
    });

    test('paid up is stated plainly, not as an empty list', async () => {
      const r = await page.evaluate(() => {
        payments.push({ bid_id: 8801, amount: 2000 }, { bid_id: 8802, amount: 1500 });
        return timAsk('who owes me money');
      });
      expect(r.title).toBe('Nothing out');
      expect(r.rows).toEqual([]);
    });
  });

  test.describe('what did I charge', () => {
    test('his book answers first, with how many it is built on', async () => {
      const r = await page.evaluate(() => timAsk('what did I charge for gutters'));
      expect(r.id).toBe('charged');
      expect(r.title).toBe('$340');
      expect(r.sub).toContain('Remove and reset gutters');
      expect(r.sub).toContain('4');
    });

    test('a unit price carries its unit, because $0.78 alone is meaningless', async () => {
      const r = await page.evaluate(() => {
        S.priceBook = {};
        return timAsk('what did I charge for body and trim');
      });
      expect(r.title).toContain('/ sq ft');
    });

    test('a line he only ever sent is still an answer, and says who got it', async () => {
      const r = await page.evaluate(() => {
        S.priceBook = {};
        return timAsk('what did I charge for body and trim');
      });
      expect(r.sub).toContain('Dana Whitfield');
    });

    test('nothing matching is null, never a made up going rate', async () => {
      const r = await page.evaluate(() => timAsk('what did I charge for helicopter rental'));
      expect(r).toBe(null);
    });
  });

  test.describe('which lead source pays', () => {
    test('leads, wins and losses come off the real records', async () => {
      const r = await page.evaluate(() => timBySource());
      const g = r.find(x => x.source === 'Google');
      expect(g.leads).toBe(2);      // Dana and Marta
      expect(g.won).toBe(2);        // 8801 and 8803
      expect(g.lost).toBe(1);       // 8804
      expect(g.revenue).toBe(4900);
      expect(g.close).toBe(67);     // 2 of 3 decided
    });

    test('an untagged customer is counted against no source', async () => {
      const r = await page.evaluate(() => timBySource().reduce((s, x) => s + x.leads, 0));
      expect(r).toBe(3); // Nobody Tagged is not in any bucket
    });

    test('cost per won job comes off the marketing expenses already tagged', async () => {
      const r = await page.evaluate(() => timBySource().find(x => x.source === 'Google'));
      expect(r.spend).toBe(600);
      expect(r.perWon).toBe(300);
    });

    test('a channel he pays for and never wins off is shown, not hidden', async () => {
      const r = await page.evaluate(() => timBySource().find(x => x.source === 'Truck wrap'));
      expect(r).toBeTruthy();
      expect(r.spend).toBe(2400);
      expect(r.won).toBe(0);
      expect(r.perWon).toBe(null);
      const row = await page.evaluate(() =>
        timAsk('which lead source is worth it').rows.find(x => x.lead === 'Truck wrap'));
      expect(row.note).toContain('nothing won');
    });

    test('a non-marketing expense never lands in a channel', async () => {
      const r = await page.evaluate(() => timBySource().reduce((s, x) => s + x.spend, 0));
      expect(r).toBe(3000); // 600 + 2400, never the 812 of materials
    });

    test('nothing tagged says so and points at the fix', async () => {
      const r = await page.evaluate(() => {
        clients.forEach(c => { delete c.source; delete c.leadSource; });
        expenses.length = 0;
        return timAsk('which lead source is working');
      });
      expect(r.title).toContain('No sources tagged');
      expect(r.sub).toContain('Put a source on a customer');
    });
  });

  test.describe('who is this customer', () => {
    test('the address, the phone and where they came from', async () => {
      const r = await page.evaluate(() => timAsk('whats the address for Dana'));
      expect(r.title).toBe('Dana Whitfield');
      expect(r.rows.find(x => x.lead === 'Where').note).toContain('1200 Elm');
      expect(r.rows.find(x => x.lead === 'Phone').right).toBe('316-555-0101');
      expect(r.rows.find(x => x.lead === 'Came from').note).toBe('Google');
    });

    test('what they still owe rides on the card, because that is why he opened it', async () => {
      const r = await page.evaluate(() => timAsk('whats the address for Dana'));
      expect(r.sub).toContain('$2,000');
      expect(r.sub).toContain('still out');
    });

    test('a customer who is square reads as paid up', async () => {
      const r = await page.evaluate(() => timAsk('whats the address for Marta'));
      expect(r.sub).toBe('Paid up');
    });

    test('a name he cannot place is null, not the wrong customer', async () => {
      const r = await page.evaluate(() => timAsk('whats the address for Geronimo Blackwood'));
      expect(r).toBe(null);
    });
  });

  test.describe('through the real door', () => {
    test('a question answers instead of navigating', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'who owes me money';
        const out = _timGo();
        const html = document.getElementById('_tim-ask-sheet').innerHTML;
        document.getElementById('_tim-ov')?.remove();
        return { kind: out.kind, ask: out.ask, html };
      });
      expect(r.kind).toBe('ask');
      expect(r.ask).toBe('owed');
      expect(r.html).toContain('$3,500');
      expect(r.html).toContain('Dana Whitfield');
    });

    test('it is logged as an answer, not as a miss', async () => {
      const r = await page.evaluate(() => {
        timLogClear();
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'who owes me money';
        _timGo();
        document.getElementById('_tim-ov')?.remove();
        const e = timLogEntries()[0];
        return { kind: e.kind, got: e.got };
      });
      expect(r.kind).toBe('ask');
      expect(r.got).toContain('your own numbers');
    });

    test('saying a screen name still navigates, so nothing was stolen', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'show me my proposals';
        const out = _timGo();
        document.getElementById('_tim-ov')?.remove();
        return out.kind;
      });
      expect(r).toBe('nav');
    });
  });

  // ── The seam that had no test ──────────────────────────────────────────────
  // timJobSnapshot is what feeds the nudge rules, and it is the only place the
  // still-owes rule touches the database. e2e-tim-nudge tests the ranking with a
  // hand-built snapshot, which is correct for what it covers and is why a filter
  // matching zero rows looked exactly like a customer who had paid.
  test.describe('the nudge engine reads the same books', () => {
    test('a real Closed Won balance reaches the snapshot', async () => {
      const r = await page.evaluate(() => {
        currentClientId = 7101;
        return timJobSnapshot();
      });
      expect(r.owed).toBe(2000);
      expect(r.clientName).toBe('Dana Whitfield');
      expect(r.clientFirst).toBe('Dana');
      expect(r.owedDays).toBeGreaterThan(50);
    });

    test('and the rule fires on it, which it could not do before', async () => {
      const r = await page.evaluate(() => {
        currentClientId = 7101;
        S.timLearned = {}; timResetDismissals();
        return timNudges(timJobSnapshot()).map(n => n.id);
      });
      expect(r).toContain('still-owes');
    });

    test('a customer who is paid up raises nothing', async () => {
      const r = await page.evaluate(() => {
        currentClientId = 7103;
        return timJobSnapshot().owed;
      });
      expect(r).toBe(0);
    });
  });

  test('no console errors, tim-ask.js', async () => { await assertNoErrors(page); });
});
