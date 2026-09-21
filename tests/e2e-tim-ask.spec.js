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

  // ── The books the eight added answers read ────────────────────────────────
  // income rows deliberately carry BOTH date shapes, '20260715' and
  // '2026-08-02', because the real array does: the cloud importer strips the
  // dashes and a man typing one does not. An answer that reads the year with a
  // bare slice(0,4) gets '2026' out of one and '2026' out of the other only by
  // luck of the dash count, and silently drops half the year the first time
  // that luck runs out.
  income.length = 0; mileage.length = 0; timeEntries.length = 0;
  income.push(
    { id: 9001, client_name: 'Dana Whitfield', date: '20260715', type: 'Job payment', amount: 1200 },
    { id: 9002, client_name: 'Marta Ochoa', date: '2026-08-02', type: 'Job payment', amount: 300 },
    { id: 9003, client_name: 'Old Money', date: '2025-11-01', type: 'Job payment', amount: 9999 },
  );
  // The two payments above get dates so they can be counted as money IN as
  // well as against their bid's balance. A deposit lands in payments and never
  // reaches income, which is why the answer has to read both arrays.
  payments[0].date = '2026-07-20'; payments[0].client_name = 'Dana Whitfield';
  payments[1].date = '2026-05-25'; payments[1].client_name = 'Marta Ochoa';
  expenses.push(
    { cat: 'materials', catLabel: 'Materials & Supplies', vendor: 'Sherwin-Williams #7043',
      amount: 412, date: '2026-07-02', notes: 'Exterior acrylic' },
    { cat: 'materials', catLabel: 'Materials & Supplies', vendor: 'Sherwin-Williams #7043',
      amount: 188, date: '2026-08-14', notes: 'Sundries' },
    { cat: 'fuel', catLabel: 'Fuel', vendor: 'Kwik Shop', amount: 64, date: '2026-08-15' },
  );
  mileage.push(
    { id: 9301, date: '2026-07-02', miles: 14.2, purpose: 'Business' },
    { id: 9302, date: '2026-08-14', miles: 22.5, purpose: 'Business' },
    { id: 9303, date: '2026-08-15', miles: 100, purpose: 'Personal' },
    { id: 9304, date: '2025-08-15', miles: 500, purpose: 'Business' },
  );
  // Clocked against the app's own clock, not a hardcoded week. todayKey() is
  // what the answer counts back from, so fixed dates here would pass today and
  // fail whenever the suite is next run more than a week from now.
  const _d = (back) => {
    const x = new Date(Date.parse(todayKey()) - back * 86400000);
    return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') +
      '-' + String(x.getUTCDate()).padStart(2, '0');
  };
  timeEntries.push(
    { id: 9401, date: _d(1), minutes: 255, logged_by_name: 'Sample Owner', open: false },
    { id: 9402, date: _d(2), minutes: 215, logged_by_name: 'Andre Ruiz', open: false },
    { id: 9403, date: _d(30), minutes: 480, logged_by_name: 'Sample Owner', open: false },
    { id: 9404, date: _d(0), minutes: null, logged_by_name: 'Sample Owner', open: true },
  );
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

  // ── The eight added 2026-09-20 ────────────────────────────────────────────
  //
  // Every question here is phrased with the year in it ("in 2026") on purpose.
  // The answers default to the current year off todayKey(), which is correct
  // behaviour and untestable against fixed seed rows: a suite that hardcodes
  // 2026 bids and asks "how much did I make" passes all year and then fails
  // every test in this block at midnight on New Year's Eve. Naming the year
  // exercises the year parser as well, which is the part that can actually be
  // wrong.
  test.describe('the rest of what he can answer', () => {
    test('all twelve families are heard, and none of them steals another', async () => {
      const r = await page.evaluate(() => [
        ['who owes me money', 'owed'],
        ['what did I charge for gutters', 'charged'],
        ['which lead source is worth it', 'source'],
        ['whats the address for Dana', 'who'],
        ['how much did I make in 2026', 'made'],
        ['what did I spend at Sherwin Williams', 'spent'],
        ['whats out right now', 'out'],
        ['how many did I win in 2026', 'winrate'],
        ['who is my best customer', 'best'],
        ['how many miles did I drive in 2026', 'miles'],
        ['how many hours did I work', 'hours'],
        ['whats my average job in 2026', 'avg'],
      ].map(([s, want]) => [(timAskKind(s) || {}).id, want]));
      r.forEach(([got, want]) => expect(got).toBe(want));
    });

    test('money in counts income AND payments, in both date shapes', async () => {
      const r = await page.evaluate(() => timAsk('how much did I make in 2026'));
      // income 1200 ('20260715') + 300 ('2026-08-02') + payments 2000 + 900.
      // The 2025 row and its 9999 must not be in it.
      expect(r.title).toBe('$4,400');
      expect(r.sub).toContain('2026');
      expect(r.sub).toContain('4 payments');
    });

    test('last year is a different answer, not the same one', async () => {
      const r = await page.evaluate(() => timAsk('how much did I make in 2025'));
      expect(r.title).toBe('$9,999');
    });

    test('spend comes back by category, biggest first', async () => {
      const r = await page.evaluate(() => timAsk('what did I spend in 2026'));
      // 600 + 2400 marketing, 812 + 412 + 188 materials, 64 fuel
      expect(r.title).toBe('$4,476');
      expect(r.rows[0].lead).toBe('Advertising & marketing');
      expect(r.rows.map(x => x.lead)).toContain('Materials & Supplies');
    });

    test('naming a vendor asks about that vendor, not the whole year', async () => {
      const r = await page.evaluate(() => timAsk('what did I spend at Sherwin Williams in 2026'));
      // He says "sherwin williams", the receipt says "Sherwin-Williams #7043".
      expect(r.title).toBe('$600');
      expect(r.sub).toContain('Sherwin-Williams #7043');
      expect(r.sub).toContain('2 receipts');
    });

    test('what is out is the pending bids, oldest first', async () => {
      const r = await page.evaluate(() => timAsk('whats out right now'));
      expect(r.title).toBe('$3,300');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].lead).toBe('Dana Whitfield');
    });

    test('the win rate counts decided bids only, and says what is still out', async () => {
      const r = await page.evaluate(() => timAsk('how many did I win in 2026'));
      // Won 8801, 8802, 8803. Lost 8804. Pending 8805 is neither.
      expect(r.title).toBe('75%');
      expect(r.sub).toContain('3 of 4');
      expect(r.rows.find(x => x.lead === 'Still out').right).toBe('1');
    });

    test('the best customer is by money won, not by job count', async () => {
      const r = await page.evaluate(() => timAsk('who is my best customer'));
      // Dana: one won job at 4000. Marta: 900 won plus a 2600 LOSS that must
      // not count. Ray: 1500.
      expect(r.title).toBe('Dana Whitfield');
      expect(r.rows.map(x => x.lead)).toEqual(['Dana Whitfield', 'Ray Kellerman', 'Marta Ochoa']);
    });

    test('mileage counts business drives and leaves personal out of the figure', async () => {
      const r = await page.evaluate(() => timAsk('how many miles did I drive in 2026'));
      expect(r.title).toBe('36.7 mi');
      expect(r.sub).toContain('2 drives');
      expect(r.sub).toContain('1 personal not counted');
    });

    test('he does not turn mileage into a deduction', async () => {
      // The IRS rate moves and splits mid-year. A number a man repeats to his
      // accountant comes off the tax screen that owns it, not off Tim.
      const r = await page.evaluate(() => timAsk('how many miles did I drive in 2026'));
      expect(r.sub).not.toMatch(/deduct|write.?off|\$/i);
      expect(r.title).not.toContain('$');
    });

    test('hours are the last seven days, an open clock is not counted', async () => {
      const r = await page.evaluate(() => timAsk('how many hours did I work'));
      // 255 + 215 within the window. The 30-day-old 480 and the open entry out.
      expect(r.title).toBe('7.8 hrs');
      expect(r.sub).toContain('last 7 days');
      expect(r.sub).toContain('2 entries');
      expect(r.rows.map(x => x.lead)).toEqual(['Sample Owner', 'Andre Ruiz']);
    });

    test('the average job carries the middle one too', async () => {
      const r = await page.evaluate(() => timAsk('whats my average job in 2026'));
      // Won: 4000, 1500, 900. Mean 2133, median 1500.
      expect(r.title).toBe('$2,133');
      expect(r.sub).toContain('$1,500');
      expect(r.rows.find(x => x.lead === 'Middle job').right).toBe('$1,500');
    });

    test('empty books are an answer, not a crash and not a zero dressed as a fact', async () => {
      const r = await page.evaluate(() => {
        income.length = 0; payments.length = 0; expenses.length = 0;
        mileage.length = 0; timeEntries.length = 0; bids.length = 0;
        return ['how much did I make in 2026', 'what did I spend in 2026', 'whats out right now',
          'how many did I win in 2026', 'who is my best customer',
          'how many miles did I drive in 2026', 'how many hours did I work',
          'whats my average job in 2026']
          .map(s => { const a = timAsk(s); return a && a.title; });
      });
      expect(r).toEqual([
        'Nothing in 2026 yet', 'Nothing logged for 2026', 'Nothing out',
        'Nothing decided in 2026', 'No won work yet', 'Nothing logged for 2026',
        'Nothing clocked', 'No won work in 2026',
      ]);
    });

    test('junk in every array is still an answer, never a throw', async () => {
      const r = await page.evaluate(() => {
        income.length = 0; income.push(null, {}, { date: 'x', amount: 'nope' });
        expenses.length = 0; expenses.push(null, { amount: NaN });
        mileage.length = 0; mileage.push(null, { date: '2026-01-01', miles: 'ten' });
        timeEntries.length = 0; timeEntries.push(null, { date: null, minutes: 'x' });
        bids.length = 0; bids.push(null, { status: 'Closed Won' });
        return ['how much did I make in 2026', 'what did I spend in 2026', 'whats out right now',
          'how many did I win in 2026', 'who is my best customer',
          'how many miles did I drive in 2026', 'how many hours did I work',
          'whats my average job in 2026'].map(s => { try { return !!timAsk(s); } catch (e) { return 'THREW'; } });
      });
      expect(r).toEqual([true, true, true, true, true, true, true, true]);
    });

    test('describing work is still not a question, with twelve families listening', async () => {
      const r = await page.evaluate(() => [
        'strip and repaint the west elevation',
        'three days, two men, scaffold on the west side',
        'five gallons of Duration in Iron Ore',
        'build a t and m for Logan Sample',
      ].map(s => timAskKind(s)));
      expect(r).toEqual([null, null, null, null]);
    });
  });

  // ── The buttons on his answers are CLICKED here, not read ─────────────────
  //
  // Every answer carries a `go`, and `go.fn` is a string of JavaScript that
  // gets written into an onclick. Nothing checks that the function it names
  // exists, so a typo is a button that throws ReferenceError and leaves the man
  // looking at a sheet that did nothing. That is not hypothetical: the
  // who-is-this answer shipped calling openClient(id) for weeks. There is no
  // openClient in this codebase and there never has been; the real one is
  // openClientDetail(cid, origin). Every test above passed, because they all
  // read the object and none of them pressed the button.
  test.describe('the button on the answer actually works', () => {
    const ANSWERS = [
      ['who owes me money', 'pg-money'],
      ['how much did I make in 2026', 'pg-tracker'],
      ['what did I spend in 2026', 'pg-taxes'],
      ['whats out right now', 'pg-leads'],
      ['how many did I win in 2026', 'pg-leads'],
      ['who is my best customer', 'pg-clients'],
      ['how many miles did I drive in 2026', 'pg-taxes'],
      ['how many hours did I work', 'pg-timelog'],
      ['whats my average job in 2026', 'pg-leads'],
    ];
    for (const [said, want] of ANSWERS) {
      test(`"${said}" lands on ${want}`, async () => {
        const got = await page.evaluate((s) => {
          goPg('pg-dash');
          const ans = timAsk(s);
          if (!ans || !ans.go) return 'NO GO BUTTON';
          try { (0, eval)(ans.go.fn); } catch (e) { return 'THREW: ' + e.message; }
          return (document.querySelector('.pg.active') || {}).id || 'NOTHING ACTIVE';
        }, said);
        expect(got).toBe(want);
      });
    }

    test('the customer answer opens that customer, by the name that exists', async () => {
      const got = await page.evaluate(() => {
        goPg('pg-dash');
        const ans = timAsk('whats the address for Dana');
        try { (0, eval)(ans.go.fn); } catch (e) { return 'THREW: ' + e.message; }
        return { pg: (document.querySelector('.pg.active') || {}).id, who: currentClientId };
      });
      expect(got).toEqual({ pg: 'pg-client-detail', who: 7101 });
    });

    // The cheap guard that would have caught it on day one, for every answer at
    // once: the function each button names has to be a function.
    test('every function an answer names exists', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        ['who owes me money', 'what did I charge for gutters', 'which lead source is worth it',
          'whats the address for Dana', 'how much did I make in 2026', 'what did I spend in 2026',
          'whats out right now', 'how many did I win in 2026', 'who is my best customer',
          'how many miles did I drive in 2026', 'how many hours did I work',
          'whats my average job in 2026'].forEach(s => {
          const a = timAsk(s);
          if (!a || !a.go) return;
          const name = String(a.go.fn).split('(')[0].trim();
          if (typeof window[name] !== 'function') out.push(s + ' -> ' + name);
        });
        return out;
      });
      expect(bad).toEqual([]);
    });
  });

  // ── The one he opens with ─────────────────────────────────────────────────
  test.describe('where do I stand', () => {
    test('the exact sentence the owner typed and got a miss on', async () => {
      const r = await page.evaluate(() => timAsk("What's Going On Tim?"));
      expect(r).not.toBeNull();
      expect(r.id).toBe('brief');
    });

    // The bug underneath the miss, and it was never about this one family.
    // _timkNorm turned every stray character into a SPACE, so "what's" became
    // "what s" and matched nothing. iOS autocorrects "whats" TO "what's" as you
    // type, so the keyboard was reliably rewriting his question into one Tim
    // could not hear, across every phrase in the list written the plain way.
    test('the apostrophe iOS insists on adding does not break the match', async () => {
      const r = await page.evaluate(() => [
        // straight, curly, and the plain form, for the phrases that carry one
        ["what's going on", 'brief'],
        ['what\u2019s going on', 'brief'],
        ['whats going on', 'brief'],
        ["what's owed", 'owed'],
        ['what\u2019s owed', 'owed'],
        ["what's out right now", 'out'],
        ["what's the address for Dana", 'who'],
        ["what's my average job", 'avg'],
        ["how's business", 'brief'],
      ].map(([said, want]) => [(timAskKind(said) || {}).id, want]));
      r.forEach(([got, want]) => expect(got).toBe(want));
    });

    // The preview under the box reads from timParse, which knows doors, years
    // and work and nothing at all about these twelve families. So the one
    // question in the app most likely to be typed first previewed as "Not sure
    // what that is yet" right up until you pressed send and got a full answer.
    // A preview that contradicts what is about to happen talks a man out of
    // asking.
    test('the line under the box does not call it a miss before he answers it', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        openTim();
        const el = document.getElementById('_tim-say');
        const read = (v) => { el.value = v; _timPreview(); return document.getElementById('_tim-read').textContent; };
        const out = {
          brief: read("What's going on Tim?"),
          owed: read('who owes me money'),
          junk: read('qwertyuiop asdfgh'),
          empty: read(''),
          // A build outranks an ask in _timGoRun, so it has to here too.
          build: read('build me a t and m for Dana Whitfield'),
          // And a plain screen request is still a screen.
          nav: read('open the schedule'),
        };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.brief).toBe('Answer that off your own books');
      expect(r.owed).toBe('Answer that off your own books');
      // And a genuine miss still says so, or the preview means nothing.
      expect(r.junk).toBe('Not sure what that is yet');
      expect(r.empty).toBe('');
      expect(r.build).toContain('Dana');
      expect(r.nav).toBe('Open Schedule');
    });

    test('it is the money he can do something about, worst first', async () => {
      const r = await page.evaluate(() => timAsk('whats going on'));
      // Owed 3,500 (Dana 2,000 of 4,000 unpaid + Ray 1,500). Out: the 3,300
      // Pending. In: income 1,500 + payments 2,900.
      expect(r.title).toBe('$3,500');
      expect(r.sub).toContain('not in your account');
      const leads = r.rows.map(x => x.lead);
      expect(leads[0]).toBe('Waiting to be paid');
      expect(leads).toContain('Out for an answer');
      expect(leads).toContain('Taken in this year');
    });

    test('it never disagrees with the single question it is summarising', async () => {
      // A brief that contradicts the detailed answer is the worst thing in this
      // file: it is the one read fastest and trusted most.
      const r = await page.evaluate(() => {
        const brief = timAsk('where do I stand');
        const owed = timAsk('who owes me money');
        const out = timAsk('whats out right now');
        return {
          briefOwed: (brief.rows.find(x => x.lead === 'Waiting to be paid') || {}).right,
          owedTitle: owed.title,
          briefOut: (brief.rows.find(x => x.lead === 'Out for an answer') || {}).right,
          outTitle: out.title,
        };
      });
      expect(r.briefOwed).toBe(r.owedTitle);
      expect(r.briefOut).toBe(r.outTitle);
    });

    test('an empty book says all square, it does not invent a number', async () => {
      const r = await page.evaluate(() => {
        bids.length = 0; payments.length = 0; income.length = 0;
        return timAsk('how is business');
      });
      expect(r.title).toBe('All square');
      expect(r.rows).toEqual([]);
    });
  });

  // ── A CREW MEMBER GETS NOTHING ────────────────────────────────────────────
  //
  // Every answer in this file is owner-only business data. Tim has been
  // owner-only since he was built, and timDockRender has refused to draw for a
  // crew member from the start, but that was the ONLY thing enforcing it.
  //
  // Reproduced 2026-09-21, signed in as an employee with no permissions, on a
  // seeded book: the dock was correctly hidden, and #mmi-tim in the More menu
  // was still visible, still called openTim(), and every money question
  // answered in full. $31,000 of revenue, $60,500 outstanding with the
  // customer's name and how many days, the best customer and their share, the
  // average job. pg-money, pg-tracker and pg-taxes were all correctly shut the
  // whole time: none of these answers route through goPg, so the employee page
  // block never saw them.
  //
  // This walks every family, because the leak was not that one answer was
  // wrong, it was that nobody had ever asked this question of the set.
  test.describe('a crew member cannot get a figure out of him', () => {
    const asCrew = (fn) => page.evaluate((body) => {
      const wasEmp = _isEmployee, wasRec = _employeeRecord;
      _isEmployee = true; _employeeRecord = { role: 'employee', permissions: {} };
      try { return (0, eval)('(' + body + ')')(); }
      finally { _isEmployee = wasEmp; _employeeRecord = wasRec; }
    }, fn.toString());

    test('every question family answers null, not a number', async () => {
      const r = await asCrew(() => [
        'who owes me money',
        'what did I charge for gutters',
        'which lead source is worth it',
        'whats the address for Dana',
        'how much did I make in 2026',
        'what did I spend in 2026',
        'whats out right now',
        'how many did I win in 2026',
        'who is my best customer',
        'how many miles did I drive in 2026',
        'how many hours did I work',
        'whats my average job in 2026',
        'whats going on',
      ].map(s => timAsk(s)));
      expect(r).toEqual(new Array(13).fill(null));
    });

    test('the sheet will not open for him at all', async () => {
      const r = await asCrew(() => {
        document.getElementById('_tim-ov')?.remove();
        openTim();
        const opened = !!document.getElementById('_tim-sheet');
        document.getElementById('_tim-ov')?.remove();
        return opened;
      });
      expect(r).toBe(false);
    });

    test('and the More menu stops inviting him in', async () => {
      const r = await page.evaluate(() => {
        const wasEmp = _isEmployee, wasRec = _employeeRecord;
        const el = document.getElementById('mmi-tim');
        _isEmployee = true; _employeeRecord = { role: 'employee', permissions: {} };
        applyPermissions();
        const crew = getComputedStyle(el).display;
        _isEmployee = wasEmp; _employeeRecord = wasRec;
        applyPermissions();
        const owner = getComputedStyle(el).display;
        return { crew, ownerShown: owner !== 'none' };
      });
      expect(r.crew).toBe('none');
      // And it comes back for the owner, or the fix costs the owner the feature.
      expect(r.ownerShown).toBe(true);
    });

    test('the owner still gets every one of them, so the guard is not a wall', async () => {
      const r = await page.evaluate(() => [
        'who owes me money', 'how much did I make in 2026', 'who is my best customer',
      ].map(s => { const a = timAsk(s); return a && a.title; }));
      expect(r).toEqual(['$3,500', '$4,400', 'Dana Whitfield']);
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
      // 10.4: this read `toContain('your own numbers')` while the log was only
      // ever read by a diagnostics panel, where "Answered off your own numbers"
      // was a fine description of what happened. The log is the conversation
      // thread now, and in a thread that line is the app narrating itself. It
      // records the FIGURE he gave, which is both the better assertion and the
      // better thing to show a man reading back what he asked.
      expect(r.got).toBe('$3,500');
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
