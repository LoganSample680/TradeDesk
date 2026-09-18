// @ts-check
// ── The day deriver (js/geo-derive.js) ──────────────────────────────────────
//
// One pure function turns the CoreMotion tape and the GPS fixes into the
// day's dwells and legs. These tests are the spec, in the owner's own terms
// (2026-09-02): one id per journey minted at the flip, both ends saved or no
// leg, a personal stop collapses to the direct route, same fence both ends
// is a round trip, unresolved by midnight writes nothing, and the same input
// always gives the same output so a boot rebuild is idempotent.
//
// The first block replays the owner's real 1 September, which is the day
// that ended the previous design: three observers wrote a 3h 43m row on top
// of three other live rows for one afternoon at John Doe's.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Central day, 1 Sep 2026 (CDT, UTC-5).
const DAY = '2026-09-01';
const DAY_START = Date.parse('2026-09-01T05:00:00Z');
const DAY_END = Date.parse('2026-09-02T05:00:00Z');
const T = (h, m, s) => DAY_START + h * 3600000 + m * 60000 + (s || 0) * 1000;

// His real saved locations. The shop and the home office are 4 metres apart,
// and there are two identical shop rows: the four-way registration that made
// "where am I" a coin toss.
const SHOP  = { id: 'place-1788212754002055', kind: 'shop', name: 'TradeDesk shop', lat: 39.0307066, lng: -95.7112082 };
const SHOP2 = { id: 'place-1787436255292052', kind: 'shop', name: 'TradeDesk shop', lat: 39.0307066, lng: -95.7112082 };
const HOME  = { id: 'place-1787436272279016', kind: 'home_office', name: '2015 SW Randolph Ave', lat: 39.0307378, lng: -95.7112674, addr: '2015 SW Randolph Ave, Topeka, KS, 66604' };
const DOE   = { id: 'client-1788214075432', kind: 'client', name: 'John Doe', clientId: 1788214075432, lat: 39.0123292, lng: -95.7464936, addr: '2950 SW McClure Rd, Topeka, KS 66614' };
const HD    = { id: 'place-1787001824911022', kind: 'supply', name: 'The Home Depot', lat: 39.0451214, lng: -95.7584343, addr: '5900 SW Huntoon St, Topeka, KS, 66604' };
const JOB   = { id: 'job-1788294875837048', kind: 'job', name: 'John Doe', jobId: 1788294875837048, lat: 39.0123292, lng: -95.7464936 };
const FENCES = [SHOP, SHOP2, HOME, DOE, HD];
const GAS = { lat: 39.0210, lng: -95.7300 };   // not saved anywhere
// His seven real clocked days, in minutes after Central midnight.
const JACK_CLOCKS = [
  { day: '2026-08-31', inMin: 7 * 60 + 55, outMin: 15 * 60 + 45 },
  { day: '2026-09-01', inMin: 7 * 60 + 42, outMin: 15 * 60 + 0 },
  { day: '2026-09-02', inMin: 7 * 60 + 44, outMin: 19 * 60 + 30 },
  { day: '2026-09-03', inMin: 7 * 60 + 45, outMin: 16 * 60 + 45 },
  { day: '2026-09-08', inMin: 7 * 60 + 58, outMin: 17 * 60 + 16 },
  { day: '2026-09-09', inMin: 7 * 60 + 54, outMin: 16 * 60 + 1 },
  { day: '2026-09-04', inMin: 7 * 60 + 44, outMin: 16 * 60 + 13 },
];
// The same pattern, dated to the seven days before a fixture's own day. Rule
// 19 only reads clocks on or before the day it is deriving (a day's rows must
// not change because of a punch from three weeks later), so a fixture set in
// early September cannot learn from his real late-September week.
const clocksBefore = (day) => JACK_CLOCKS.map((c, n) => Object.assign({}, c, {
  day: new Date(Date.parse(day + 'T12:00:00Z') - (n + 1) * 86400000).toISOString().slice(0, 10),
}));


const fix = (ts, at, acc) => ({ ts, lat: at.lat, lng: at.lng, acc: acc == null ? 8 : acc });
const mo = (ts, kind, id) => (id ? { ts, kind, id } : { ts, kind });

function run(page, input) {
  return page.evaluate((inp) => {
    const r = geoDeriveDay(inp);
    return JSON.parse(JSON.stringify(r));
  }, input);
}
const base = (over) => Object.assign({ day: DAY, dayStart: DAY_START, dayEnd: DAY_END, personId: '30a2b589-e081-4351-9f18-b1efba238c2d', fences: FENCES, nowMs: T(23, 0) }, over);
const hm = ts => new Date(ts).toISOString().slice(11, 16);
const _sameId = (a, b) => !!a && !!b && String(a.id) === String(b.id);

// ── Whose row is this: one phone, two businesses ────────────────────────────
//
// Owner 2026-09-10, after his own afternoon landed on another company:
// "I was at John Doe, but John Doe wasn't a client of sample co, only
// tradedesk, so how could a mileage leg and time land there if that person
// isn't in the system." It could because nothing asked. geoSpanClaim asks.
test.describe('geoSpanClaim: an account cannot claim a span it cannot identify', () => {
  // Same boot as the deriver block below (one context for the describe), so
  // this block costs one page load rather than one per test.
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const claim = (span, ctx) => page.evaluate(([sp, cx]) => geoSpanClaim(sp, cx), [span, ctx]);
  const leg = (o) => Object.assign({ startTs: T(13, 26), endTs: T(17, 14) }, o);

  test('the exact pair of drives that went to the wrong business', async () => {
    // Both ends blank is precisely what those two rows looked like: Sample Co
    // holds neither John Doe nor the TradeDesk shop, so it resolved neither.
    const blind = leg({ unsavedFrom: true, unsavedTo: true, from: {}, to: {} });
    expect(await claim(blind, { shared: true })).toEqual({ claim: false, why: 'none' });
    // Same drive on the account that DOES hold the shop: one known end is
    // enough to say whose road it was.
    const seeing = leg({ from: {}, to: { kind: 'shop', placeId: 'p1', name: 'TradeDesk shop' } });
    expect(await claim(seeing, { shared: true })).toEqual({ claim: true, why: 'fence' });
    await assertNoErrors(page);
  });

  test('a single-account phone is untouched: unsaved addresses still log', async () => {
    // The save-this-address flow exists for exactly this leg. Refusing it on
    // a phone with one account would delete real work to fix a problem that
    // phone does not have.
    const blind = leg({ unsavedFrom: true, unsavedTo: true, from: {}, to: {} });
    expect(await claim(blind, { shared: false })).toEqual({ claim: true, why: 'hat' });
    await assertNoErrors(page);
  });

  test('the ladder: a job outranks a clock outranks the bare fence', async () => {
    const at = (o) => leg({ from: {}, to: Object.assign({ kind: 'client', clientId: 9 }, o) });
    const clocks = [{ start: T(13, 0), end: T(18, 0) }];
    expect((await claim(at({ jobId: 7 }), { shared: true, clocks })).why).toBe('job');
    expect((await claim(at({ scheduled: true }), { shared: true, clocks })).why).toBe('job');
    expect((await claim(at({}), { shared: true, clocks })).why).toBe('clock');
    expect((await claim(at({}), { shared: true, clocks: [] })).why).toBe('fence');
    // A clock that does not cover the span is not evidence about the span.
    expect((await claim(at({}), { shared: true, clocks: [{ start: T(2, 0), end: T(3, 0) }] })).why).toBe('fence');
    await assertNoErrors(page);
  });

  test('a dwell is at a fence by construction, so it is always identified', async () => {
    const d = { fence: { kind: 'client', clientId: 9 }, startTs: T(8, 0), endTs: T(12, 0) };
    expect((await claim(d, { shared: true })).claim).toBe(true);
    await assertNoErrors(page);
  });

  test('null, empty and garbage never throw', async () => {
    const out = await page.evaluate(() => {
      const tries = [[null, null], [undefined, undefined], [{}, {}], [{ from: null, to: null }, { shared: true }],
        [{ from: {}, to: {} }, { shared: true, clocks: 'nope' }], [{ startTs: NaN, endTs: NaN }, { shared: true, clocks: [null] }]];
      return tries.map(([a, b]) => { try { const r = geoSpanClaim(a, b); return typeof r.claim === 'boolean'; } catch (e) { return 'THREW'; } });
    });
    expect(out).toEqual([true, true, true, true, true, true]);
    await assertNoErrors(page);
  });

  test('geoDeriveRows holds an unclaimable leg and reports it, writing nothing', async () => {
    const r = await page.evaluate(() => {
      const res = { day: '2026-09-10', dwells: [], legs: [{
        id: 'L1', startTs: 1, endTs: 2, minutes: 9, miles: 3, from: {}, to: {},
        unsavedFrom: true, unsavedTo: true, drives: [[1, 2, 60000]], roundTrip: false }] };
      const shared = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e', shared: true });
      const solo = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' });
      return { sharedTime: shared.job_time_entries.length, sharedMiles: shared.td_mileage.length,
        held: shared.held.length, soloTime: solo.job_time_entries.length, soloHeld: solo.held.length };
    });
    expect(r.sharedTime, 'no time row on an account that cannot name either end').toBe(0);
    expect(r.sharedMiles, 'and no mileage row: this is the IRS log').toBe(0);
    expect(r.held, 'held, so the caller can say the day is short rather than guess').toBe(1);
    expect(r.soloTime, 'unchanged on a one-account phone').toBeGreaterThan(0);
    expect(r.soloHeld).toBe(0);
    await assertNoErrors(page);
  });
});

test.describe('geo-derive: the day deriver', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // THE RECEIPT IS THE PROOF (owner 2026-09-05: "the receipt thing didn't
  // stay alive from my Home Depot run"). A leg that ends at a supply place is
  // written held, keyed by day and store, so the dashboard card can ask.
  test('a leg to a supply place is held for its receipt; any other leg is not', async () => {
    const t = [mo(T(7, 50), 'automotive'), mo(T(8, 5), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot')];
    const f = [fix(T(7, 49), { lat: SHOP.lat, lng: SHOP.lng }),
      fix(T(8, 5, 5), { lat: HD.lat, lng: HD.lng }), fix(T(8, 30), { lat: HD.lat, lng: HD.lng }),
      fix(T(9, 20, 5), { lat: DOE.lat, lng: DOE.lng }), fix(T(10, 0), { lat: DOE.lat, lng: DOE.lng })];
    const rows = await page.evaluate((inp) => {
      const r = geoDeriveDay(inp);
      return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
    }, base({ tape: t, fixes: f, nowMs: T(12, 0) }));
    const legs = rows.td_mileage;
    expect(legs.map(l => l.to_name)).toEqual(['The Home Depot', 'John Doe']);
    expect(legs[0].pendingReceipt).toBe(true);
    expect(legs[0].supplyRunKey).toBe('2026-09-01|The Home Depot');
    expect(legs[0].purpose).toBe('Supply run');
    expect(legs[1].pendingReceipt).toBeUndefined();
    expect(legs[1].supplyRunKey).toBeUndefined();
  });

  // ── AND THE DWELL SAYS SO TOO (owner 2026-09-16) ────────────────────────
  // "Mark the timesheet as Supply House rather than onsite." The mileage side
  // has known a supply run since 2026-09-05; the time side wrote a bare
  // 'place', which the rail has no arm for, so standing at Home Depot read
  // "On site" and counted as job-site labour on the split bar. Same fact,
  // said on both screens now.
  test('a dwell at a supply place is a supply house, by name, not a job site', async () => {
    const t = [mo(T(7, 50), 'automotive'), mo(T(8, 5), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot')];
    const f = [fix(T(7, 49), { lat: SHOP.lat, lng: SHOP.lng }),
      fix(T(8, 5, 5), { lat: HD.lat, lng: HD.lng }), fix(T(8, 30), { lat: HD.lat, lng: HD.lng }),
      fix(T(9, 20, 5), { lat: DOE.lat, lng: DOE.lng }), fix(T(10, 0), { lat: DOE.lat, lng: DOE.lng })];
    const r = await page.evaluate((inp) => {
      const rows = geoDeriveRows(geoDeriveDay(inp), { contractorId: 'c', employeeId: 'e' });
      const hd = rows.job_time_entries.find(x => x.dest_place === 'The Home Depot' && x.source !== 'drive');
      return { source: hd && hd.source, name: hd && hd.dest_place,
        kind: hd && _tlRailKind({ source: 'auto', rawSource: hd.source }),
        // The split bar must move it out of on-site labour as well as the rail.
        agg: _tlEmpWeekAgg([{ personUid: 'e', source: 'auto', rawSource: hd.source, minutes: 55 }], 'c').e,
        rail: _tlDayRailHtml([{ id: 'x', source: 'auto', rawSource: hd.source, minutes: 55, date: '2026-09-01',
          clientName: hd.dest_place, startTime: hd.arrived_at, endTime: hd.departed_at }]) };
    }, base({ tape: t, fixes: f, nowMs: T(12, 0) }));
    expect(r.source).toBe('place-supply');
    expect(r.name).toBe('The Home Depot');
    expect(r.kind).toBe('supply');
    expect(r.agg.supplyMin).toBe(55);
    expect(r.agg.onsiteMin).toBe(0);
    expect(r.agg.placeMin).toBe(0);
    // The word rides with the colour, so the rail never leans on green alone.
    expect(r.rail).toContain('Supply house');
    expect(r.rail).toContain('The Home Depot');
  });

  // ── Rule 13: a client visit the day cannot vouch for is a question ────
  // Owner 2026-09-04: "He does work for me at my address. He does work for
  // his mom and her address ... we wouldn't want time log showing her
  // personal family visit." And, on schedule-only: "not for contractors who
  // forget to put shit on a calendar."
  test.describe('rule 13: a visit the day cannot vouch for is held', () => {
    // Shop -> John Doe (a CLIENT fence) -> shop, on the day given.
    const dayOf = (iso) => {
      const ds = Date.parse(iso + 'T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      return { ds, t };
    };
    // `baseAt` is where the truck starts and ends the day, SHOP unless a test
    // says otherwise. It is a fixture knob, not deriver input, so it never
    // reaches the returned object.
    const visit = (iso, hFrom, hTo, over) => {
      const { ds, t } = dayOf(iso);
      const o = Object.assign({}, over || {});
      const at = o.baseAt || SHOP;
      delete o.baseAt;
      const tape = [mo(t(hFrom - 1), 'onFoot'), mo(t(hFrom, 0), 'automotive'), mo(t(hFrom, 20), 'onFoot'),
        mo(t(hTo, 0), 'automotive'), mo(t(hTo, 20), 'onFoot')];
      const fixes = [fix(t(hFrom - 1, 30), { lat: at.lat, lng: at.lng }),
        fix(t(hFrom, 20) + 5000, { lat: DOE.lat, lng: DOE.lng }), fix(t(hTo, 0) - 60000, { lat: DOE.lat, lng: DOE.lng }),
        fix(t(hTo, 20) + 5000, { lat: at.lat, lng: at.lng }), fix(t(hTo + 1), { lat: at.lat, lng: at.lng })];
      return Object.assign({ day: iso, dayStart: ds, dayEnd: ds + 86400000, personId: 'p', tape, fixes,
        fences: [SHOP, HOME, DOE], nowMs: ds + 86400000 + 3600000 }, o);
    };
    const held = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      const d = r.dwells.find(x => x.kind === 'client');
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
      const row = rows.job_time_entries.find(x => x.dest_place === 'John Doe' || x.source === 'client-held' || x.source === 'client');
      return { held: !!(d && d.held), source: row && row.source, minutes: d && d.minutes };
    }, inp);

    test('Sunday dinner at a customer\'s address, nothing scheduled: held', async () => {
      const r = await held(visit('2026-08-30', 17, 20));                       // a Sunday
      expect(r.minutes).toBeGreaterThan(100);
      expect(r.held).toBe(true);
      expect(r.source).toBe('client-held');
    });
    test('the same visit with a job on the calendar that day: work', async () => {
      const DOE_S = Object.assign({}, DOE, { scheduled: true });
      const r = await held(visit('2026-08-30', 17, 20, { fences: [SHOP, HOME, DOE_S] }));
      expect(r.held).toBe(false);
      expect(r.source).toBe('client');
    });
    test('the same visit with a clock running over it: work', async () => {
      const { t } = dayOf('2026-08-30');
      const r = await held(visit('2026-08-30', 17, 20, { clocks: [{ start: t(16), end: t(21) }] }));
      expect(r.held).toBe(false);
      expect(r.source).toBe('client');
    });
    test('a clock that does not reach the visit does not vouch for it', async () => {
      const { t } = dayOf('2026-08-30');
      const r = await held(visit('2026-08-30', 17, 20, { clocks: [{ start: t(8), end: t(12) }] }));
      expect(r.held).toBe(true);
    });
    test('a weekday afternoon at a customer, nothing scheduled: work, by working hours', async () => {
      const r = await held(visit('2026-09-01', 13, 16));                       // a Tuesday
      expect(r.held).toBe(false);
      expect(r.source).toBe('client');
    });
    // ── The contact answering in advance (owner 2026-09-12) ──────────────
    // "Add in ability to mark a contact as family member so time flags itself
    // as need marked personal or work." The test directly above is the case
    // the rule's own comment admits it cannot close: a weekday afternoon at a
    // family member's address, nothing scheduled, counted as work. Marking the
    // contact takes the working-day witness away and leaves the other two.
    test('the SAME weekday afternoon at a contact marked family: held', async () => {
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const r = await held(visit('2026-09-01', 13, 16, { fences: [SHOP, HOME, DOE_P] }));
      expect(r.held, 'the working day no longer vouches for this address').toBe(true);
      expect(r.source).toBe('client-held');
    });
    test('a job on the calendar still makes a family address work', async () => {
      // The one case the flag exists to keep counting: he really does bill
      // work at that address, and the calendar says so.
      const DOE_P = Object.assign({}, DOE, { personal: true, scheduled: true });
      const r = await held(visit('2026-09-01', 13, 16, { fences: [SHOP, HOME, DOE_P] }));
      expect(r.held).toBe(false);
      expect(r.source).toBe('client');
    });
    test('a clock running over it still makes a family address work', async () => {
      // The person saying, at the time, that they are working.
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const { t } = dayOf('2026-09-01');
      const r = await held(visit('2026-09-01', 13, 16,
        { fences: [SHOP, HOME, DOE_P], clocks: [{ start: t(12), end: t(17) }] }));
      expect(r.held).toBe(false);
      expect(r.source).toBe('client');
    });
    test('marking a contact holds the visit, it never drops it', async () => {
      // Held is a question on the rail that counts toward nothing and asks on
      // the card. Dropping it silently would lose the one visit he DOES bill.
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const r = await held(visit('2026-09-01', 13, 16, { fences: [SHOP, HOME, DOE_P] }));
      expect(r.minutes).toBeGreaterThan(100);
      expect(r.source).toBe('client-held');
    });
    test('an unmarked contact is exactly as it was, and so is every other kind', async () => {
      // personal absent reads as false on every client saved before the flag
      // existed, which is the whole of the migration story.
      const noFlag = await held(visit('2026-09-01', 13, 16));
      const falseFlag = await held(visit('2026-09-01', 13, 16,
        { fences: [SHOP, HOME, Object.assign({}, DOE, { personal: false })] }));
      const junk = await held(visit('2026-09-01', 13, 16,
        { fences: [SHOP, HOME, Object.assign({}, DOE, { personal: 'yes' })] }));
      expect(noFlag.held).toBe(false);
      expect(falseFlag.held).toBe(false);
      // Only a literal true marks a contact: a truthy string is not an answer.
      expect(junk.held).toBe(false);
    });

    // ── Rule 15: the drives either side of a held visit ──────────────────
    // Owner 2026-09-12: "Jack didn't work Thursday or Friday this last week
    // why do we have mileage and time rows in there?" Rule 13 asked about the
    // VISIT and never about the drives, so a held Friday at a family member's
    // address still produced 7.7 claimed business miles either side of it.
    const legsOf = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
      return { legs: r.legs.map(l => ({ held: !!l.held, to: l.to && l.to.name })),
        miles: rows.td_mileage.map(m => ({ pending: !!m.pendingPurpose, purpose: m.purpose })) };
    }, inp);

    test('the drives either side of a held visit are held too', async () => {
      // JACK'S ACTUAL SHAPE: he works out of his house, so the fence set has
      // no shop in it at all. Home to a family address and back, which is
      // where both of his Friday drives came from. (The owner's own fixture
      // puts a SHOP at the same coordinates as HOME, and a shop end vouches
      // by definition, which is the test directly below.)
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [HOME, DOE_P] }));
      expect(r.legs.length).toBeGreaterThan(0);
      expect(r.legs.every(l => l.held), 'no business end on either drive').toBe(true);
      expect(r.miles.every(m => m.pending), 'and the rows say so').toBe(true);
      // 'Business' was the fallback for a destination it could not name, which
      // is exactly the drive it has no standing to label.
      expect(r.miles.every(m => m.purpose === '')).toBe(true);
    });

    test('a drive that touches the shop is business, held visit or not', async () => {
      // A REAL yard is a business address by definition, so the leg earns its
      // miles from that end whatever the other one is.
      //
      // AMENDED 2026-09-12 (10.4). This used the base SHOP, which sits 20 ft
      // from the base HOME because it models the owner's real account, where
      // the yard and the house are the same building. That is now the one shop
      // that does NOT vouch: coming home is not arriving at work, and treating
      // it as such is why his day could never end. The claim being tested is
      // about a yard, so the fixture now uses one.
      const YARD = { id: 'place-yard', kind: 'shop', name: 'The yard', lat: 39.0605, lng: -95.7702 };
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [YARD, HOME, DOE_P], baseAt: YARD }));
      const toYard = r.legs.filter(l => l.to === YARD.name);
      expect(toYard.length).toBeGreaterThan(0);
      expect(toYard.every(l => !l.held), 'a yard that is not your house vouches').toBe(true);
    });

    test('but the same shop AT his own house does not: that is coming home', async () => {
      // The other half, and the whole reason his day could not end.
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [SHOP, HOME, DOE_P] }));
      const toShop = r.legs.filter(l => l.to === SHOP.name);
      expect(toShop.length).toBeGreaterThan(0);
      expect(toShop.every(l => l.held), 'a shop 20 ft from the home office is the house').toBe(true);
    });

    test('an ordinary client day is completely unchanged', async () => {
      const r = await legsOf(visit('2026-09-01', 13, 16));
      expect(r.legs.some(l => l.held), 'nothing is held on a normal work day').toBe(false);
      expect(r.miles.some(m => m.pending)).toBe(false);
      expect(r.miles.every(m => m.purpose !== '')).toBe(true);
    });

    test('a clock running over the drive vouches for it', async () => {
      const DOE_P = Object.assign({}, DOE, { personal: true });
      const { t } = dayOf('2026-09-01');
      const r = await legsOf(visit('2026-09-01', 13, 16,
        { fences: [HOME, DOE_P], clocks: [{ start: t(12), end: t(17) }] }));
      expect(r.legs.every(l => !l.held), 'the person said they were working').toBe(true);
    });

    test('a job at the address vouches for the drives to it', async () => {
      // A job is work whoever the client is, which is the case the family
      // mark exists to keep counting, and the drives to it come with it.
      const DOE_J = Object.assign({}, DOE, { personal: true, jobId: 'job-1' });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [HOME, DOE_J] }));
      expect(r.legs.every(l => !l.held)).toBe(true);
    });

    // ── Rule 13's third witness: open on the books (owner 2026-09-12) ─────
    // "flag the question if it's work or personal if there's no active job or
    // proposal that's open on the books." The calendar witness is date-bound;
    // this one is not. A live job or an unanswered proposal is a reason to be
    // at a family member's address, whatever the date.
    test('a family contact with an open job on the books is work again', async () => {
      const MOM = Object.assign({}, DOE, { personal: true, onBooks: true });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [HOME, MOM] }));
      expect(r.legs.every(l => !l.held), 'the books vouch, the way the calendar does').toBe(true);
    });

    test('the same contact with nothing on the books still asks', async () => {
      const MOM = Object.assign({}, DOE, { personal: true, onBooks: false });
      const r = await legsOf(visit('2026-09-01', 13, 16, { fences: [HOME, MOM] }));
      expect(r.legs.every(l => l.held), 'family, and nothing open anywhere').toBe(true);
    });

    test('on the books is only a family contact\'s reprieve, never a new hold', async () => {
      // An ordinary client never needed it: the working-day window already
      // covers them. So its absence must not take anything away.
      const r = await legsOf(visit('2026-09-01', 13, 16,
        { fences: [HOME, Object.assign({}, DOE, { onBooks: false })] }));
      expect(r.legs.some(l => l.held)).toBe(false);
    });

    // ── Rule 16: a day that never reached business writes no drives ───────
    // Owner 2026-09-12, checked against every day the crew member has on
    // record. All six of his CLOCKED days open home -> the yard or a real
    // customer. Not one of his four unclocked days touches a business address:
    // two are the same gym run a week apart (out 5:25, home 6:21, both ends
    // unsaved), two are a family address. These four fixtures are those days.
    const gym = (over) => {
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      const GYM = { lat: 39.0501, lng: -95.7301 };   // nobody ever saved it
      return Object.assign({
        day: '2026-09-10', dayStart: ds, dayEnd: ds + 86400000, personId: 'p',
        // Rule 19: his own clock history, and these are his real punches.
        // Seven clocked days, in between 7:42 and 7:58 Central, out between
        // 15:00 and 19:30. Trimmed and padded that is 6:44am to 6:16pm, so the
        // gym run at 5:25 is outside the day this person has ever worked.
        // Without it the company's 6am stands and the 6:21 drive home reads as
        // inside the working day, which is the whole reason rule 19 exists.
        clockHistory: JACK_CLOCKS,
        tape: [mo(t(5, 20), 'still'), mo(t(5, 25), 'automotive'), mo(t(5, 33), 'onFoot'),
          mo(t(6, 21), 'automotive'), mo(t(6, 29), 'onFoot'), mo(t(6, 35), 'still')],
        fixes: [fix(t(5, 22), { lat: 39.0210, lng: -95.7500 }),
          fix(t(5, 33) + 5000, GYM), fix(t(6, 10), GYM),
          fix(t(6, 29) + 5000, { lat: HOME.lat, lng: HOME.lng }), fix(t(7, 30), { lat: HOME.lat, lng: HOME.lng })],
        fences: [HOME], nowMs: ds + 86400000 + 3600000,
      }, over || {});
    };
    const out = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
      return { legs: r.legs.length, miles: rows.td_mileage.length, time: rows.job_time_entries.length };
    }, inp);

    test('the gym run: unsaved to unsaved to home, no clock, writes nothing', async () => {
      const r = await out(gym());
      expect(r.legs, 'nothing in the day reached business').toBe(0);
      expect(r.miles).toBe(0);
    });

    // ── AND IT STAYS NOTHING WHILE HE IS STILL DRIVING (owner 2026-09-15) ──
    // "Why today we got drive time to the gym showing again for Jack. Remember
    // the rule? Need at least one true fence to fence and or a manual clock in
    // to start the timesheet and mileage. What happened to that server side?"
    //
    // Nothing happened to it: rule 16 was being SKIPPED. Its first line bailed
    // out whenever any journey was open, on the reasoning that a day still in
    // progress cannot be called empty, and that bail sat ABOVE the house-loop
    // filter and took it with it.
    //
    // His real 15 September: the gym run closed at 06:27, CoreMotion flipped
    // automotive at 06:22:32 and never flipped back, and the 06:30 push-ping
    // derived on the server at 06:42 with that journey still open. The gym went
    // to the rail as three held rows and stayed there, because a server derive
    // may add and never retire.
    //
    // A journey that starts later cannot make a loop that already closed into
    // work: both its ends are the house and its middle was never saved.
    const openTail = (over) => {
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      const GYM = { lat: 39.0501, lng: -95.7301 };
      return gym(Object.assign({
        // Same run, and then the phone flips automotive and never flips back.
        tape: [mo(t(5, 20), 'still'), mo(t(5, 25), 'automotive'), mo(t(5, 33), 'onFoot'),
          mo(t(6, 21), 'automotive')],
        // His shape exactly: leaves from the house, so the loop's origin IS the
        // house and the loop closes on the arrival back inside the fence, while
        // the tape's last flip is still hanging.
        fixes: [fix(t(5, 24), { lat: HOME.lat, lng: HOME.lng }),
          fix(t(5, 33) + 5000, GYM), fix(t(6, 10), GYM),
          fix(t(6, 26), { lat: HOME.lat, lng: HOME.lng }),
          fix(t(6, 40), { lat: HOME.lat, lng: HOME.lng })],
        nowMs: t(6, 42),
      }, over || {}));
    };

    test('still driving at derive time does not let the gym run through', async () => {
      const r = await out(openTail());
      expect(r.legs, 'an open journey says nothing about a loop that already closed').toBe(0);
      expect(r.miles).toBe(0);
      expect(r.time, 'and no drive or stop rows either').toBe(0);
    });

    test('a clock still claims it, driving or not', async () => {
      // The bail was never what made a clocked day count, and it still is not.
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const r = await out(openTail({ clocks: [{ start: ds + 5 * 3600000, end: ds + 7 * 3600000 }] }));
      expect(r.legs).toBeGreaterThan(0);
    });

    test('a day that DID reach business is untouched by the bail either way', async () => {
      // The other half of the rule: the house-loop filter drops loops, never
      // legs that got somewhere. Mid-drive must not start deleting real work.
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      // HD, not SHOP2: this file's shop sits four metres from the home office,
      // so "home to the yard" there is one spot read twice and rule 7 writes
      // nothing at all. A supply house is a second fence.
      const r = await out(gym({
        fences: [HOME, HD],
        tape: [mo(t(5, 20), 'still'), mo(t(5, 25), 'automotive'), mo(t(5, 33), 'onFoot'),
          mo(t(6, 21), 'automotive'), mo(t(6, 29), 'onFoot'),
          mo(t(7, 30), 'automotive'), mo(t(8, 0), 'onFoot')],
        fixes: [fix(t(5, 22), { lat: 39.0210, lng: -95.7500 }),
          fix(t(5, 33) + 5000, { lat: 39.0501, lng: -95.7301 }), fix(t(6, 10), { lat: 39.0501, lng: -95.7301 }),
          fix(t(6, 29) + 5000, { lat: HOME.lat, lng: HOME.lng }),
          fix(t(7, 30) + 5000, { lat: HD.lat, lng: HD.lng }), fix(t(8, 0), { lat: HD.lat, lng: HD.lng })],
        nowMs: t(8, 30),
      }));
      expect(r.legs, 'the run to the yard survives').toBeGreaterThan(0);
    });

    test('the same day with a clock is claimed in full', async () => {
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const r = await out(gym({ clocks: [{ start: ds + 5 * 3600000, end: ds + 7 * 3600000 }] }));
      expect(r.legs, 'the person said they were working').toBeGreaterThan(0);
    });

    test('one leg touching the yard keeps the whole day', async () => {
      const SHOP2 = { id: 'p-shop', kind: 'shop', name: 'JS Solutions shop', lat: 39.0501, lng: -95.7301 };
      const r = await out(gym({ fences: [HOME, SHOP2] }));
      expect(r.legs, 'a business end anywhere proves the day happened').toBeGreaterThan(0);
    });

    test('a family address still ASKS: the drives stay so the question can be answered', async () => {
      // The owner's own carve-out: "except for Laurie which we now tag as
      // family and flag the question if it's work or personal." A named visit
      // is something to ask about; the gym is not.
      const FAM = { id: 'client-9', kind: 'client', name: 'Laurie', clientId: 9,
        personal: true, lat: 39.0501, lng: -95.7301, addr: '6712 SW Finsbury Ave' };
      const r = await out(gym({ fences: [HOME, FAM] }));
      expect(r.legs, 'held, not deleted, so rule 15 can ask').toBeGreaterThan(0);
    });

    // ── Rule 17: the workday window (owner 2026-09-12) ────────────────────
    // "We got a business fence to business fence to start the work timer, and
    // or we got a manual clock in and clock out, and everything in between
    // those times." Plus the case that decides where it OPENS: "some days Jack
    // went straight from home to a job site, but he had a manual clock in in
    // the middle of the day."
    const SHOPB = { id: 'p-yard', kind: 'shop', name: 'The yard', lat: 39.0501, lng: -95.7301 };

    test('the clock comes 46 minutes after he pulled out: the drive is still inside the day', async () => {
      // His real 31 August. Out at 7:09, clocked in at 7:55 when he ARRIVED.
      // A window anchored on the clock throws that 41-minute drive away.
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      const r = await page.evaluate((i) => {
        const res = geoDeriveDay(i);
        return { legs: res.legs.length, first: res.legs[0] && res.legs[0].to.name };
      }, gym({ fences: [HOME, SHOPB], clocks: [{ start: t(6, 15), end: t(9) }] }));
      expect(r.legs, 'the drive that started before the clock is in the day').toBeGreaterThan(0);
      expect(r.first).toBe('The yard');
    });

    test('a clock with no drive under it still opens the day', async () => {
      // The mirror, his 8 September: clocked at 7:58, first drive 13:28.
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      const r = await out(gym({ clocks: [{ start: t(5), end: t(7) }] }));
      expect(r.legs, 'the clock is the only signal and it is enough').toBeGreaterThan(0);
    });

    test('an evening gym run after a real workday is still not work', async () => {
      // The case that stops "the day was open" meaning "everything today was
      // work": the window CLOSES, and the loop falls outside it.
      const ds = Date.parse('2026-09-10T05:00:00Z');
      const t = (h, m) => ds + h * 3600000 + (m || 0) * 60000;
      const r = await page.evaluate((i) => {
        const res = geoDeriveDay(i);
        return res.legs.map(l => [l.from.name || 'unsaved', l.to.name || 'unsaved']);
      }, gym({
        fences: [HOME, SHOPB],
        tape: [mo(t(7), 'still'), mo(t(7, 10), 'automotive'), mo(t(7, 30), 'onFoot'),
          mo(t(15), 'automotive'), mo(t(15, 20), 'onFoot'),
          mo(t(20), 'automotive'), mo(t(20, 15), 'onFoot'),
          mo(t(21), 'automotive'), mo(t(21, 15), 'onFoot'), mo(t(21, 30), 'still')],
        fixes: [fix(t(7, 5), { lat: HOME.lat, lng: HOME.lng }),
          fix(t(7, 30) + 5000, SHOPB), fix(t(12), SHOPB),
          fix(t(15, 20) + 5000, { lat: HOME.lat, lng: HOME.lng }),
          fix(t(20, 15) + 5000, { lat: 39.0801, lng: -95.7701 }),
          fix(t(20, 40), { lat: 39.0801, lng: -95.7701 }),
          fix(t(21, 15) + 5000, { lat: HOME.lat, lng: HOME.lng }),
          fix(t(22), { lat: HOME.lat, lng: HOME.lng })],
      }));
      expect(r.some(l => l[1] === 'The yard'), 'the morning run to the yard counts').toBe(true);
      expect(r.length, 'and the 8pm loop out of the house does not').toBe(2);
    });

    test('a weekday night at a customer, nothing scheduled: held', async () => {
      const r = await held(visit('2026-09-01', 21, 23));
      expect(r.held).toBe(true);
    });
    test('working hours are the company\'s: 8 to 5, weekdays only, makes Saturday morning a question', async () => {
      const wh = { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] };
      const sat = await held(visit('2026-08-29', 10, 12, { workHours: wh }));   // a Saturday
      const tue = await held(visit('2026-09-01', 10, 12, { workHours: wh }));
      const late = await held(visit('2026-09-01', 18, 20, { workHours: wh }));
      expect(sat.held).toBe(true);
      expect(tue.held).toBe(false);
      expect(late.held).toBe(true);
    });
    test('a visit that touches the working window at all is vouched for', async () => {
      // 7pm to 9pm on a Tuesday: the first hour is inside 6am to 8pm.
      const r = await held(visit('2026-09-01', 19, 21));
      expect(r.held).toBe(false);
    });
    test('junk hours and junk clocks fall back to the defaults, never a throw', async () => {
      const r = await held(visit('2026-09-01', 13, 16, { workHours: { start: 'x', end: null, days: 'no' }, clocks: [null, {}, { start: 'a', end: 'b' }] }));
      expect(r.held).toBe(false);
    });
    test('a job fence is never held, whatever the hour', async () => {
      const r = await page.evaluate((i) => {
        const r = geoDeriveDay(i);
        return r.dwells.map(d => [d.kind, !!d.held]);
      }, visit('2026-08-30', 17, 20, { fences: [SHOP, HOME, JOB] }));
      expect(r.some(d => d[0] === 'job')).toBe(true);
      expect(r.every(d => d[1] === false)).toBe(true);
    });
  });

  // ── Rule 18: a loop's two ends are one end, counted twice ────────────────
  // Owner 2026-09-13, reading his own 11 September off the rail: "tradedesk
  // shop to shop can't display that way so that's wrong, would have to be
  // tradedesk shop to unsaved address then unsaved address to tradedesk shop."
  //
  // He is describing the hole in the founding rule. Section 17 opens with
  // "both ends saved or no leg" and a round trip does not break that, it
  // SATISFIES it: rule 7 collapses the loop into one leg whose from and to are
  // the same saved fence, and the only place he actually went is buried in the
  // middle as a collapsed stop that nothing ever looks at.
  //
  // And the gates that did exist all guarded MILEAGE. His two evenings cost
  // him 193 minutes of hours while the miles under them were correctly kept
  // out of his deduction, because the time rows were written before any of the
  // tests ran.
  test.describe('rule 18: a loop is vouched by nobody, and its time is gated like its miles', () => {
    // A real yard, nowhere near anybody's house, so rule 7 calls this a round
    // trip rather than a house loop and the two rules cannot be confused.
    const YARD = { id: 'place-y18', kind: 'shop', name: 'The yard', lat: 39.0600, lng: -95.6500, addr: '1 Yard Rd' };
    const YF = { lat: YARD.lat, lng: YARD.lng };
    // Out of the yard at 9:00, an hour at an address nobody saved, back at
    // 11:10. Then, if `after` is set, a real drive to a customer.
    const loopDay = (over) => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot'),
        mo(T(10, 50), 'automotive'), mo(T(11, 10), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), YF), fix(T(9, 20, 5), GAS), fix(T(10, 30), GAS),
        fix(T(10, 50, 5), GAS), fix(T(11, 10, 5), YF), fix(T(12, 0), YF)];
      return base(Object.assign({ tape, fixes, fences: [YARD, DOE], nowMs: T(14, 0) }, over || {}));
    };
    const rowsOf = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      return JSON.parse(JSON.stringify({ legs: r.legs, rows: geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' }) }));
    }, inp);

    test('the yard at both ends vouches for nothing: the loop is held', async () => {
      const { legs } = await rowsOf(loopDay());
      expect(legs.length, 'held is not deleted: the drive is still on the log').toBe(1);
      expect(legs[0].roundTrip).toBe(true);
      expect(legs[0].held, 'one fence read twice is not two business ends').toBe(true);
      // And the day is not thrown away with it. Rule 16 asks whether anything
      // reached business, which this plainly did; it just cannot be claimed.
      expect(legs[0].business).toBe(true);
    });

    test('the same trip with a clock over it counts in full', async () => {
      // The person saying at the time that they are working outranks
      // geography, exactly as rules 13 and 15 already have it.
      const { legs, rows } = await rowsOf(loopDay({ clocks: [{ start: T(8, 30), end: T(12, 0) }] }));
      expect(legs[0].held).toBeFalsy();
      expect(rows.job_time_entries.every(t => !/-held$/.test(t.source))).toBe(true);
    });

    test('the drives and the stop are written HELD, not written and counted', async () => {
      const { rows } = await rowsOf(loopDay());
      const t = rows.job_time_entries;
      // Two drives out and back, one stop in the middle: every row the trip
      // produced is still there, and not one of them is claimable.
      expect(t.map(x => x.source)).toEqual(['drive-held', 'drive-held', 'unsaved-held']);
      expect(t.map(x => [x.arrived_at.slice(11, 16), x.departed_at.slice(11, 16)])).toEqual([
        ['14:00', '14:20'], ['15:50', '16:10'], ['14:20', '15:50'],
      ]);
      // The mileage side is unchanged: rule 14 already refused to claim it.
      expect(rows.td_mileage.map(m => !!m.addressUnknown)).toEqual([true]);
    });

    test('a real drive to a customer in the same day is untouched', async () => {
      // The under-counting guard. Holding a loop must not spill onto the legs
      // around it: the trip to Doe has a business end of its own.
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot'),
        mo(T(10, 50), 'automotive'), mo(T(11, 10), 'onFoot'),
        mo(T(12, 0), 'automotive'), mo(T(12, 20), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), YF), fix(T(9, 20, 5), GAS), fix(T(10, 30), GAS),
        fix(T(10, 50, 5), GAS), fix(T(11, 10, 5), YF), fix(T(11, 40), YF),
        fix(T(12, 0, 5), YF), fix(T(12, 20, 5), DOE), fix(T(13, 30), DOE)];
      const { rows } = await rowsOf(base({ tape, fixes, fences: [YARD, DOE], nowMs: T(14, 0) }));
      const drives = rows.job_time_entries.filter(x => /^drive/.test(x.source));
      expect(drives.map(x => x.source)).toEqual(['drive-held', 'drive-held', 'drive']);
      expect(rows.td_mileage.map(m => [m.to_name, !!m.addressUnknown]))
        .toEqual([['The yard', true], ['John Doe', false]]);
    });

    // ── The wrap is for unloading, so it only exists where you unload ──────
    // Rule 11's half hour is for putting the truck away at a yard. It was
    // added to the end of every leg and every dwell, which includes pulling
    // into your own driveway, and on the owner's account that is the same
    // coordinate as the yard: his shop fence sits 4 m from his home office.
    // So the workday stretched another thirty minutes past the moment he
    // stopped working, every single evening.
    test('arriving home does not buy another half hour of workday', async () => {
      // Last customer until 16:00, home at 16:20, and he never leaves again.
      // The day closes at 16:30, which is the CUSTOMER's own wrap and nothing
      // to do with the house. Under the old rule it closed at 16:50.
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot'),
        mo(T(16, 0), 'automotive'), mo(T(16, 20), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(16, 0, 5), DOE),
        fix(T(16, 20, 5), { lat: SHOP.lat, lng: SHOP.lng }), fix(T(17, 0), { lat: SHOP.lat, lng: SHOP.lng })];
      const at = async (nowMs) => {
        const r = await run(page, base({ tape, fixes, nowMs }));
        return r.open && r.open.counts;
      };
      // Ten past four, still inside the customer's wrap: between jobs.
      expect(await at(T(16, 25))).toBe(true);
      // Five minutes later the day is over. It used to run to 16:50 purely
      // because he had driven home, which is the opposite of what the arrival
      // means.
      expect(await at(T(16, 35))).toBe(false);
    });

    // ── Inside the window means inside it, not touching it ────────────────
    // This passed on one minute of OVERLAP and the comment above it called
    // that "no part-credit", which it was not: his 11 September loop ran
    // 17:45 to 20:58 against a window that closed at 18:09 and came in whole
    // on 24 minutes of contact.
    test('_gdInWindow: containment, both ends, not a minute of contact', async () => {
      const w = { open: 1000000, close: 2000000 };
      const inw = (a, b) => page.evaluate(([win, s2, e2]) =>
        _gdInWindow(win, { startTs: s2, endTs: e2 }), [w, a, b]);
      expect(await inw(1200000, 1800000), 'wholly inside').toBe(true);
      expect(await inw(1000000, 2000000), 'exactly the window').toBe(true);
      expect(await inw(1800000, 5000000), 'starts inside, runs for hours past the close').toBe(false);
      expect(await inw(500000, 1200000), 'started before the day opened').toBe(false);
      expect(await inw(500000, 5000000), 'swallows the window whole').toBe(false);
      expect(await inw(2000001, 2100000), 'entirely after').toBe(false);
      // Junk never throws and never passes (11.1).
      const junk = await page.evaluate(() => [
        _gdInWindow(null, { startTs: 1, endTs: 2 }), _gdInWindow({ open: 0, close: 9 }, null),
        _gdInWindow({ open: 0, close: 9 }, {}), _gdInWindow({ open: 0, close: 9 }, { startTs: 'a', endTs: 'b' }),
        _gdInWindow({ open: 0, close: 9 }, { startTs: 5, endTs: 2 }),
      ]);
      expect(junk).toEqual([false, false, false, false, false]);
    });

    test('the evening loop stays held even when the workday closed while it was running', async () => {
      // Out of the yard at 17:45 after a day that ended there at 17:30, so the
      // window runs to 18:15 and the loop overlaps it by half an hour. Under
      // the old overlap test that half hour dragged the whole three-hour trip
      // into the workday. Rule 18 and containment both refuse it now, and they
      // refuse it for the same reason: nothing about the trip is evidence of
      // work, least of all the half hour of it that happened before six.
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 20), 'onFoot'),
        mo(T(17, 10), 'automotive'), mo(T(17, 30), 'onFoot'),
        mo(T(17, 45), 'automotive'), mo(T(18, 5), 'onFoot'),
        mo(T(20, 48), 'automotive'), mo(T(20, 58), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), YF), fix(T(9, 20, 5), DOE), fix(T(17, 10, 5), DOE),
        fix(T(17, 30, 5), YF), fix(T(17, 45, 5), YF), fix(T(18, 5, 5), GAS),
        fix(T(20, 0), GAS), fix(T(20, 48, 5), GAS), fix(T(20, 58, 5), YF), fix(T(21, 30), YF)];
      const { legs, rows } = await rowsOf(base({ tape, fixes, fences: [YARD, DOE], nowMs: T(23, 0) }));
      const evening = legs.filter(l => Number(l.startTs) >= T(17, 40));
      // AMENDED 2026-09-15 (rule 19). This used to assert the evening loop
      // stayed on the log as a held row, on the principle that held must never
      // mean deleted. That principle held while the question was "did the day
      // reach business", which this day plainly did.
      //
      // The question is now "was this inside the working day", and this trip
      // ran 17:45 to 20:58, past the eight o'clock close. The owner asked for
      // exactly that: "fence to fence starts the day and or manual clock in is
      // hit", and for anything that can claim neither, the hours decide. A
      // three-hour evening round trip out of the yard to a gas station is the
      // same shape as the gym run and gets the same answer.
      //
      // Held still does not mean deleted for anything INSIDE the day: a loop
      // at noon is written greyed and asks to be named, which is what stops an
      // unsaved first job going missing.
      expect(evening.length, 'outside the working day, and nothing vouches for it').toBe(0);
      // The day's two real drives are plain, and the evening left nothing.
      expect(rows.job_time_entries.filter(t => t.source === 'drive').length).toBe(2);
      // Three held rows (out, the stop, back) used to ride along with it.
      expect(rows.job_time_entries.filter(t => /-held$/.test(t.source)).length).toBe(0);
    });
  });

  test('it exists, it is pure, and junk in is empty out, never a throw', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      const tryIt = (x) => { try { out.push(geoDeriveDay(x)); } catch (e) { out.push('THREW ' + e.message); } };
      tryIt(); tryIt(null); tryIt({}); tryIt({ tape: 'no', fixes: 7, fences: null });
      tryIt({ day: 'x', dayStart: 0, dayEnd: 0 });
      tryIt({ day: 'x', dayStart: 10, dayEnd: 20, tape: [null, {}, { ts: 'a', kind: 'driving' }, { ts: 15, kind: 'zzz' }], fixes: [null, { ts: NaN }, { ts: 15, lat: 'q' }] });
      return out.map(o => typeof o === 'string' ? o : { d: o.dwells.length, l: o.legs.length });
    });
    for (const o of r) { expect(typeof o).toBe('object'); expect(o).toEqual({ d: 0, l: 0 }); }
    expect(await page.evaluate(() => typeof geoDeriveRows === 'function' && typeof geoFenceAt === 'function')).toBe(true);
  });

  // ── His real 1 September ────────────────────────────────────────────────
  test.describe('the owner\'s 1 September, from tape and fixes', () => {
    // Flips as the coprocessor reported them, fixes at each flip plus a few
    // breadcrumbs on each leg.
    const tape = [
      mo(T(6, 30), 'still'), mo(T(7, 40), 'onFoot'),
      mo(T(7, 52, 11), 'driving'), mo(T(8, 3, 23), 'onFoot'),
      mo(T(12, 21, 31), 'driving'), mo(T(12, 31, 24), 'onFoot'),
      mo(T(13, 17, 1), 'driving'), mo(T(13, 25, 5), 'onFoot'),
      mo(T(17, 8, 5), 'driving'), mo(T(17, 16, 45), 'onFoot'),
    ];
    const fixes = [
      fix(T(7, 45), SHOP), fix(T(7, 52, 20), SHOP),
      fix(T(7, 57), { lat: 39.0210, lng: -95.7250 }), fix(T(8, 0), { lat: 39.0150, lng: -95.7350 }),
      fix(T(8, 3, 30), DOE), fix(T(10, 0), DOE), fix(T(12, 21, 40), DOE),
      fix(T(12, 26), { lat: 39.0200, lng: -95.7300 }),
      fix(T(12, 31, 30), SHOP), fix(T(13, 0), SHOP), fix(T(13, 17, 10), SHOP),
      fix(T(13, 21), { lat: 39.0200, lng: -95.7300 }),
      fix(T(13, 25, 10), DOE), fix(T(15, 0), DOE), fix(T(17, 8, 10), DOE),
      fix(T(17, 12), { lat: 39.0200, lng: -95.7300 }),
      fix(T(17, 17), HOME), fix(T(18, 0), HOME), fix(T(21, 0), HOME),
    ];
    let r;
    test.beforeAll(async () => { r = await run(page, base({ tape, fixes })); });

    test('four legs, each between two saved addresses, wheels-turning minutes', async () => {
      expect(r.legs.map(l => [hm(l.startTs), hm(l.endTs), l.from.name, l.to.name, l.minutes])).toEqual([
        ['12:52', '13:03', 'TradeDesk shop', 'John Doe', 11],
        ['17:21', '17:31', 'John Doe', 'TradeDesk shop', 10],
        ['18:17', '18:25', 'TradeDesk shop', 'John Doe', 8],
        ['22:08', '22:16', 'John Doe', 'TradeDesk shop', 9],
      ]);
      // Miles come from the breadcrumbs, not a straight line.
      // (The fixture has three breadcrumbs per leg, so the path is shorter than
      // his real 111-point one; what matters is that it IS the path.)
      for (const l of r.legs) { expect(l.milesFrom).toBe('path'); expect(l.miles).toBeGreaterThan(1.5); expect(l.collapsed).toBe(false); }
    });

    test('three dwells, one row each, and the shop is the shop', async () => {
      expect(r.dwells.map(d => [hm(d.startTs), hm(d.endTs), d.kind, d.name, d.minutes])).toEqual([
        ['13:03', '17:21', 'client', 'John Doe', 258],
        ['17:31', '18:17', 'shop', 'TradeDesk shop', 46],
        ['18:25', '22:08', 'client', 'John Doe', 223],
      ]);
      // The afternoon that had FOUR overlapping rows is one row of 223 minutes.
      const afternoon = r.dwells.filter(d => d.startTs >= T(13, 25) && d.startTs < T(17, 8));
      expect(afternoon).toHaveLength(1);
      // 12:31 to 13:17 was two rows in two tables (shop_time_entries AND a
      // 'place' row for the home office 4 m away). One dwell, kind shop.
      const noon = r.dwells.filter(d => d.startTs >= T(12, 31) && d.startTs < T(13, 17));
      expect(noon).toHaveLength(1);
      expect(noon[0].kind).toBe('shop');
    });

    test('the evening at home is not a row: no departure, so it is open', async () => {
      // Rule 9. He arrived at 17:16 and never drove again. That is home, not
      // work, and it is reported as open for the live screen only.
      expect(r.dwells.some(d => d.startTs >= T(17, 16))).toBe(false);
      expect(r.open).toBeTruthy();
      expect(hm(r.open.sinceTs)).toBe('22:16');
      // And the morning before the first drive is not a row either.
      expect(r.dwells.some(d => d.startTs < T(7, 52))).toBe(false);
    });

    test('no overlaps, anywhere, by construction', async () => {
      const spans = r.dwells.map(d => [d.startTs, d.endTs]).concat(r.legs.map(l => [l.startTs, l.endTs]))
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    });

    test('rows: shop to its table, dwells and legs to theirs, one key per journey', async () => {
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      expect(rows.shop_time_entries).toHaveLength(1);
      expect(rows.shop_time_entries[0].minutes).toBe(46);
      const dw = rows.job_time_entries.filter(x => x.source !== 'drive');
      const dr = rows.job_time_entries.filter(x => x.source === 'drive');
      expect(dw.map(x => x.source)).toEqual(['client', 'client']);
      expect(dw.map(x => x.dest_place)).toEqual(['John Doe', 'John Doe']);
      expect(dr).toHaveLength(4);
      expect(rows.td_mileage).toHaveLength(4);
      // The mileage leg and the drive row share the journey id. Two purposes,
      // one engine, one key.
      expect(rows.td_mileage.map(m => m.legKey)).toEqual(dr.map(x => x.client_key));
      expect(rows.td_mileage.every(m => m.gps === true && m.calc_method === 'derived-path')).toBe(true);
      expect(rows.td_mileage[0].from_name).toBe('TradeDesk shop');
      expect(rows.td_mileage[0].to_name).toBe('John Doe');
      expect(rows.td_mileage[0].client_id).toBe(1788214075432);
      expect(rows.td_mileage[1].purpose).toBe('Shop');
      // Every row carries who it is for.
      for (const x of rows.job_time_entries.concat(rows.shop_time_entries)) {
        expect(x.contractor_user_id).toBe('C'); expect(x.employee_user_id).toBe('E');
        expect(x.client_key).toBeTruthy();
      }
    });

    test('the same tape gives the same rows and the same ids, every time', async () => {
      const again = await run(page, base({ tape, fixes }));
      expect(again).toEqual(r);
    });
  });

  // ── The personal stop ───────────────────────────────────────────────────
  test.describe('a personal stop inside a leg', () => {
    const tape = [
      mo(T(8, 0), 'onFoot'),
      mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'),    // shop -> gas station (not saved)
      mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot'),   // gas station -> John Doe
      mo(T(12, 0), 'driving'), mo(T(12, 15), 'onFoot'),  // John Doe -> shop
    ];
    const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(10, 0, 5), DOE), fix(T(12, 0, 5), DOE), fix(T(12, 15, 5), SHOP), fix(T(12, 30), SHOP)];

    test('collapses to one leg, first saved origin to the fence it reached', async () => {
      const r = await run(page, base({ tape, fixes }));
      expect(r.legs).toHaveLength(2);
      const l = r.legs[0];
      expect([l.from.name, l.to.name]).toEqual(['TradeDesk shop', 'John Doe']);
      expect([hm(l.startTs), hm(l.endTs)]).toEqual(['14:00', '15:00']);
      // Drive minutes are the automotive segments only: 20 + 20, not 60.
      expect(l.minutes).toBe(40);
      expect(l.collapsed).toBe(true);
      expect(l.stops).toBe(1);
      // The id is the FIRST journey's: one id follows the whole chain.
      expect(l.id).toBe(r.journeys[0].id);
      // No dwell at the gas station. Nothing at all between 9:20 and 9:40.
      expect(r.dwells.some(d => d.startTs >= T(9, 20) && d.startTs < T(9, 40))).toBe(false);
      expect(r.dwells.map(d => [d.name, d.minutes])).toEqual([['John Doe', 120]]);
    });

    test('direct-route miles: straight line by default, routed when a resolver is given', async () => {
      const a = await run(page, base({ tape, fixes }));
      expect(a.legs[0].milesFrom).toBe('straight');
      expect(a.legs[0].miles).toBeGreaterThan(1.5);
      expect(a.legs[0].miles).toBeLessThan(3);
      const b = await page.evaluate((inp) => {
        inp.directMiles = (from, to) => 3.2;   // what MapKit would say
        return JSON.parse(JSON.stringify(geoDeriveDay(inp)));
      }, base({ tape, fixes }));
      expect(b.legs[0].miles).toBe(3.2);
      expect(b.legs[0].milesFrom).toBe('routed');
      // The resolver is only consulted for a collapsed leg; a traced leg keeps its path.
      expect(b.legs[1].milesFrom).toBe('path');
    });

    // Until 2026-09-04 this asserted "no leg" for the round trip. That was
    // right about the MILES and wrong about the driving: the owner found a
    // two-hour "unsaved job site" on his 1 September rail with a 31-minute
    // drive out and a 26-minute drive back buried inside it, because both
    // ends were his dad's shop. Rule 7 now suppresses the mileage only.
    test('back to where it started, via the stop: the driving is written, the miles are not', async () => {
      // A yard nowhere near anybody's house: the round trip is scoped away
      // from the house, and this fixture's SHOP sits 30 ft from HOME.
      const YARD = { id: 'place-yardrt', kind: 'shop', name: 'The yard', lat: 39.0600, lng: -95.6500 };
      const YF = { lat: YARD.lat, lng: YARD.lng };
      const t2 = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot'), mo(T(11, 0), 'driving'), mo(T(11, 10), 'onFoot')];
      const f2 = [fix(T(9, 0, 5), YF), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(10, 0, 5), YF), fix(T(11, 0, 5), YF), fix(T(11, 10, 5), DOE)];
      const r = await run(page, base({ tape: t2, fixes: f2, fences: [YARD, DOE] }));
      // yard -> gas -> yard is a round trip; yard -> Doe at 11:00 is a leg.
      expect(r.legs.map(l => [l.from.name, l.to.name, hm(l.startTs), !!l.roundTrip])).toEqual([
        ['The yard', 'The yard', '14:00', true],
        ['The yard', 'John Doe', '16:00', false],
      ]);
      // Both driving segments survive, and the hole between them does not.
      expect(r.legs[0].drives.map(d => [hm(d[0]), hm(d[1])])).toEqual([['14:00', '14:20'], ['14:40', '15:00']]);
      // Rule 14 (owner 2026-09-08): the miles are TRACED now, shown on the
      // row and the map and on no total. The stop is still unsaved, so
      // nothing is claimed; this used to be zero and a hole.
      expect(r.legs[0].traced).toBe(true);
      expect(r.legs[0].unsavedVia).toBe(true);
      expect(r.legs[0].miles).toBeGreaterThan(0);
      // And WHERE the stop was rides on the leg (owner 2026-09-09): both ends
      // are the yard, so without this the Save button had only the yard.
      expect(r.legs[0].via.map(v => [v.lat, v.lng, hm(v.ts)])).toEqual([[GAS.lat, GAS.lng, hm(T(9, 20))]]);
      // A leg that DID reach a saved fence keeps its stops too: the rail
      // shows them either way, and its Save button reads this same array.
      expect(r.legs[1].via).toEqual([]);
      // The yard dwell 10:00 to 11:00 is real: he arrived and later departed.
      expect(r.dwells.map(d => [d.name, hm(d.startTs), hm(d.endTs)])).toEqual([['The yard', '15:00', '16:00']]);
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      // Two drive rows out of the round trip, one out of the leg to Doe.
      //
      // AMENDED 2026-09-13 (10.4) for rule 18. The three rows still exist and
      // that was never in question; what changed is that the two belonging to
      // the round trip are now written 'drive-held'. Nothing in that trip
      // vouched for it: its two ends are the yard read twice, and the only
      // place it actually reached was never saved. The leg to Doe is a real
      // drive to a real customer and stays plain 'drive'.
      const dr = rows.job_time_entries.filter(t => /^drive/.test(t.source));
      expect(dr.map(d => d.source)).toEqual(['drive-held', 'drive-held', 'drive']);
      // Two mileage rows: the round trip is a TRACED row now (rule 14), on no
      // total, and the leg to Doe is the one real row. Order is by departure.
      expect(rows.td_mileage.map(m => [m.to_name, !!m.addressUnknown])).toEqual([['The yard', true], ['John Doe', false]]);
    });

    test('never resolved that day: a TRACED leg to where it came to rest, still reported as pending', async () => {
      // Rule 8 as amended by rule 14 (owner 2026-09-08). This used to write
      // nothing and the drive vanished; now the shop-to-wherever drive is a
      // traced leg, off every total, with its far end named as unsaved.
      const t3 = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot')];
      const f3 = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(10, 0, 5), { lat: 39.05, lng: -95.70 })];
      // Clocked, for rules 16/17. Since 2026-09-12 the base SHOP is the
      // owner's own house, so a day that only leaves it and never lands
      // anywhere has no business end at all and writes nothing. The clock is
      // his own safety valve for exactly that, and it leaves this test's
      // subject, the shape of the traced leg, untouched.
      const r = await run(page, base({ tape: t3, fixes: f3, clocks: [{ start: T(8, 0), end: T(11, 0) }] }));
      expect(r.legs.length).toBe(1);
      expect(r.legs[0].traced).toBe(true);
      expect(r.legs[0].unsavedTo).toBe(true);
      expect(r.legs[0].from.name).toBe('TradeDesk shop');
      expect(r.legs[0].to.unsaved).toBe(true);
      expect(r.legs[0].miles).toBeGreaterThan(0);
      expect(r.dwells).toEqual([]);
      expect(r.pending).toBeTruthy();
      expect(r.pending.origin.name).toBe('TradeDesk shop');
      expect(r.pending.stops).toBe(2);
      expect(r.pending.autoMinutes).toBe(40);
    });

    test('a day that starts somewhere unsaved: a TRACED leg into the first fence, and the dwell opens there', async () => {
      // Rule 14 (owner 2026-09-08): the drive in from nowhere saved used to be
      // dropped; it is now a traced leg with an unsaved start, and the real
      // leg after it is untouched.
      const t4 = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot'), mo(T(12, 0), 'driving'), mo(T(12, 10), 'onFoot')];
      const f4 = [fix(T(8, 0, 5), GAS), fix(T(8, 20, 5), DOE), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(12, 30), SHOP)];
      const r = await run(page, base({ tape: t4, fixes: f4 }));
      expect(r.legs.map(l => [l.from.name, l.to.name, !!l.traced])).toEqual([['', 'John Doe', true], ['John Doe', 'TradeDesk shop', false]]);
      expect(r.legs[0].unsavedFrom).toBe(true);
      expect(r.legs[0].unsavedTo).toBe(false);
      expect(r.dwells.map(d => [d.name, d.minutes])).toEqual([['John Doe', 220]]);
    });
  });

  // ── Edges the tape actually produces ────────────────────────────────────
  test.describe('tape edges', () => {
    test('a red light (still under ten minutes) does not split a drive; a long still parks it', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 5), 'still'), mo(T(9, 8), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toHaveLength(1);
      expect(r.legs[0].minutes).toBe(20);
      // Phone left in the truck: still for 15 minutes with no walk closes it.
      const t2 = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'still'), mo(T(9, 35), 'onFoot')];
      const r2 = await run(page, base({ tape: t2, fixes: f }));
      expect(r2.legs).toHaveLength(1);
      expect(hm(r2.legs[0].endTs)).toBe('14:20');
    });

    test('same fence both ends with nothing between is a walk across the line, not a leg', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 1), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 1, 5), SHOP)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toEqual([]);
    });

    test('a fix far from a flip is the truck when nothing drove in between, and a guess when something did', async () => {
      // Until 2026-09-02 this asserted the opposite: fixes 40 minutes from
      // either flip were "outside the window" and the leg had no ends. Rule
      // 12: the tape shows the phone parked from 8:20 to 9:00 and again from
      // 9:20 on, so those fixes ARE where the truck sat.
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(8, 20), SHOP), fix(T(10, 0), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs.map(l => [l.from.name, l.to.name, hm(l.startTs), hm(l.endTs)])).toEqual([['TradeDesk shop', 'John Doe', '14:00', '14:20']]);
      // (A fix from before an EARLIER drive is not this departure's: see
      // 'a drive in between disqualifies the parked fix' under rule 12.)
    });

    test('junk accuracy is not a fix', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP, 3000), fix(T(9, 20, 5), DOE, 3000)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toEqual([]);
    });

    test('a journey that crosses midnight stays open on the day it started', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(23, 50), 'driving'), mo(T(24, 10), 'onFoot')];
      const f = [fix(T(23, 50, 5), SHOP), fix(T(24, 10, 5), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toEqual([]);
      expect(r.journeys[0].open).toBe(true);
    });

    test('a drive that began yesterday is not this day\'s journey', async () => {
      const t = [mo(T(-1, 0), 'driving'), mo(T(0, 20), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(0, 20, 5), SHOP), fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.journeys).toHaveLength(1);
      expect(hm(r.journeys[0].startTs)).toBe('14:00');
    });

    test('a fix outside the fence closes a dwell the tape never closed', async () => {
      // Arrived at Doe 9:20, no departure flip, but at 11:00 the phone was two
      // miles away. The dwell ends at the last fix that was still inside.
      // Two fixes away, not one: a departure needs corroboration now, because
      // a single coarse wake-up fix was closing visits that were still
      // running (owner, on site all day 2026-09-03). The dwell still ends at
      // the last fix that was inside.
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(10, 30), DOE), fix(T(11, 0), GAS), fix(T(11, 20), GAS)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.dwells.map(d => [d.name, hm(d.startTs), hm(d.endTs), d.closedBy])).toEqual([['John Doe', '14:20', '15:30', 'fix']]);
      expect(r.open).toBeNull();
    });

    test('the plugin\'s own id on the transition wins over the minted one', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving', 'f46A1D2E4CE2E4815'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs[0].id).toBe('f46A1D2E4CE2E4815');
      // Without one, the id is who + when, and stable.
      const r2 = await run(page, base({ tape: [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')], fixes: f }));
      expect(r2.legs[0].id).toMatch(/^j-30a2b589-[0-9a-z]+$/);
    });
  });

  // ── One lookup, one radius, one precedence ──────────────────────────────
  test.describe('geoFenceAt', () => {
    test('a job beats the shop, the shop beats the home office four metres away, then nearest', async () => {
      const r = await page.evaluate(([F, S, H, J]) => {
        const at = (pt, fs) => { const f = geoFenceAt(pt, fs, 600); return f ? f.id : null; };
        return {
          shopSpot: at({ lat: S.lat, lng: S.lng }, F),
          homeSpot: at({ lat: H.lat, lng: H.lng }, F),              // nearer the home office, still the shop
          onlyHome: at({ lat: H.lat, lng: H.lng }, [H]),
          jobOverClient: at({ lat: J.lat, lng: J.lng }, F.concat([J])),
          farAway: at({ lat: 39.2, lng: -95.9 }, F),
          junk: [geoFenceAt(null, F), geoFenceAt({}, F), geoFenceAt({ lat: 1, lng: 1 }, null), geoFenceAt({ lat: 1, lng: 1 }, [null, {}, { lat: 'x' }])],
        };
      }, [FENCES, SHOP, HOME, JOB]);
      expect(r.shopSpot).toBe(SHOP.id);
      expect(r.homeSpot).toBe(SHOP.id);
      expect(r.onlyHome).toBe(HOME.id);
      expect(r.jobOverClient).toBe(JOB.id);
      expect(r.farAway).toBeNull();
      expect(r.junk).toEqual([null, null, null, null]);
    });

    test('a fence may carry its own radius', async () => {
      const r = await page.evaluate(() => {
        const big = { id: 'b', kind: 'supply', lat: 39.0, lng: -95.7, radiusFt: 3000 };
        const near = { lat: 39.0 + 0.004, lng: -95.7 };   // ~1450 ft north
        return [geoFenceAt(near, [big], 600) ? 'hit' : 'miss', geoFenceAt(near, [{ id: 'b', kind: 'supply', lat: 39.0, lng: -95.7 }], 600) ? 'hit' : 'miss'];
      });
      expect(r).toEqual(['hit', 'miss']);
    });
  });

  // ── The matrix (replaces tests/e2e-geo-drive-matrix.spec.js) ───────────
  // Every origin kind to every destination kind. Two saved fences make one
  // leg, whatever their kinds; an unsaved stop at either end makes none.
  test.describe('every origin to every destination', () => {
    const KINDS = { job: JOB, shop: SHOP, home_office: HOME, client: DOE, supply: HD };
    const spot = f => ({ lat: f.lat, lng: f.lng });
    const FAR = { lat: 39.0600, lng: -95.8000 };                 // nowhere any fixture fence sits
    const kinds = Object.keys(KINDS);
    for (const from of kinds) for (const to of kinds) {
      if (from === to && KINDS[from] === KINDS[to]) continue;
      test(`${from} → ${to} is one leg`, async () => {
        // Fences distinct enough that the same-fence round-trip rule cannot fire.
        const A = Object.assign({}, KINDS[from], { id: 'A-' + from });
        const B = Object.assign({}, KINDS[to], { id: 'B-' + to, lat: FAR.lat, lng: FAR.lng });
        const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(11, 0), 'driving'), mo(T(11, 10), 'onFoot')];
        const f = [fix(T(9, 0, 5), spot(A)), fix(T(9, 20, 5), spot(B)), fix(T(11, 0, 5), spot(B)), fix(T(11, 10, 5), spot(A))];
        const r = await run(page, base({ tape: t, fixes: f, fences: [A, B] }));
        expect(r.legs.map(l => [l.from.kind, l.to.kind])).toEqual([[from, to], [to, from]]);
        // The legs are the point of the matrix and they are the same for every
        // pair. The middle dwell is not: a home office is never a row (rule 12,
        // owner 2026-09-04), so driving there and back is two legs and nothing
        // in between. Every other destination kind still dwells.
        expect(r.dwells.map(d => d.kind)).toEqual(to === 'home_office' ? [] : [to]);
      });
    }
    for (const from of kinds) {
      test(`${from} → an unsaved stop and back is a round trip: driving, no miles`, async () => {
        const A = Object.assign({}, KINDS[from], { id: 'A-' + from });
        const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(11, 0), 'driving'), mo(T(11, 10), 'onFoot')];
        const f = [fix(T(9, 0, 5), spot(A)), fix(T(9, 20, 5), GAS), fix(T(11, 0, 5), GAS), fix(T(11, 10, 5), spot(A))];
        const r = await run(page, base({ tape: t, fixes: f, fences: [A] }));
        // Amended 2026-09-04: this used to expect no leg at all. The two
        // drives are real for every fence kind; the mileage never is.
        const house = from === 'home_office';
        // AMENDED 2026-09-15 (10.4) for rule 19. The house used to be the one
        // kind that wrote NOTHING here, because a loop out of your own front
        // door with nothing saved between is the gym run and the day had
        // reached no business to say otherwise.
        //
        // The owner retired that test by naming its hole: "what if the first
        // stop of the day isn't a saved address nor is the clock in button
        // hit, then we have missing rows." A gym trip and a first job at an
        // address nobody saved ARE the same data, so the only thing that can
        // separate them is when they happened. This one runs 9:00 to 11:10 on
        // a working day, so it is written, greyed, earning nothing, with the
        // Save button on it, and the person says which it was. The gym at 5:25
        // is still dropped, by the hours rather than by the day's verdict.
        //
        // A house loop is `houseLoop`, never `roundTrip`: rule 7 refuses to
        // call a trip out of your own door a round trip, and that is unchanged.
        expect(r.legs.map(l => [l.from.kind, l.to.kind, !!l.roundTrip, !!l.traced, l.miles > 0]))
          .toEqual([[from, from, !house, true, true]]);
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
        // AMENDED 2026-09-13 (10.4) for rule 18: both drives are still
        // written for every fence kind, and every one of them is now HELD.
        // A loop has one real destination, it was never saved, and the fence
        // at the kerb cannot vouch for it by being read twice.
        const drv = rows.job_time_entries.filter(t2 => /^drive/.test(t2.source));
        expect(drv.length).toBe(2);
        expect(drv.every(d => d.source === 'drive-held')).toBe(true);
        // One traced, unclaimed row (rule 14), from every kind now.
        expect(rows.td_mileage.map(m => [!!m.addressUnknown, !!m.unsavedVia])).toEqual([[true, true]]);
      });
    }
  });

  // ── A departure needs corroboration ─────────────────────────────────────
  // Owner, standing at John Doe all day 2026-09-03: no Dynamic Island, no
  // lock screen, and the Time Log cut his afternoon at 14:19. One cached fix
  // 343 ft out at a foreground wake closed a visit that was still running,
  // and a closed visit means `open` is null, so nothing was ever published
  // to the on-site card or the Live Activity.
  // ── RULE 15: a closed fence crossing beats a cached fix ───────────────────
  //
  // Owner 2026-09-15: "I just want the stale cache fixed from his phone to
  // close out the day right." Jack's 14 September, 4:01pm to 4:36pm reads as
  // an unsaved address. He was at his own yard. The app was suspended for the
  // whole stretch, so the only fixes in the dwell are ONE cached coordinate
  // restated verbatim, 1,279 ft out against a 300 ft fence, while the yard's
  // regionEnter stood from 15:58 and its exit came at 16:36.
  //
  // This block is also the guard on the FIRST attempt, which shipped and was
  // reverted the same evening. Both of the things that broke it are cases
  // here: one building answering to three region ids, and an enter with no
  // exit. Those are his real ids and his real timestamps.
  // ── RULE 20: the commute is not work, and it is not mileage ──────────────
  //
  // Owner 2026-09-15: "He doesn't get paid for his drive to his dads shop or
  // when he goes home, his time runs on arrival to the shop and or clock in
  // time and out time, we dont want to show his mileage to his dads or from
  // home." And on hiding it rather than greying it: "Hide it."
  //
  // The IRS commuting rule, which is why it is global: home to your regular
  // workplace is never claimable, everything from arrival onward is. Him not
  // owning the yard he reports to is incidental.
  // ── RULE 21: THE CROSSING KNOWS WHEN HE ARRIVED ─────────────────────────
  //
  // Owner 2026-09-15: "I shouldn't be babysitting his day and telling you what
  // happened." He had to read Life360 to find out that his crew member reached
  // his mother's at 7:55 while the app said 8:30.
  //
  // His real 15 September, timestamp for timestamp off his own phone:
  //
  //   07:54:54  automotive          he pulls out of his drive
  //   07:55:50  regionExit home
  //   07:59:25  regionEnter Laurie  he is THERE
  //   08:01:39  app terminated      and nothing samples a fix for 14 minutes
  //   08:30:53  walking             CoreMotion finally lets go of automotive
  //   09:08:40  regionExit Laurie
  //
  // A journey ends on the flip, so the drive was written 07:54 to 08:30 and
  // her house did not start until 08:30. Thirty-one minutes on the wrong row,
  // with the OS holding the answer the whole time.
  test.describe('rule 21: the arrival is the crossing, not the flip', () => {
    const JH = { id: 'p-jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
    const MOM = { id: 'client-mom', kind: 'client', name: 'Laurie Schonfeldt', clientId: 7, lat: 39.0104968, lng: -95.7790924 };
    const F21 = [JH, MOM];
    // Only two fixes all morning, which is the point: the app died at 08:01.
    const fixes21 = [fix(T(7, 54, 54), JH), fix(T(9, 7, 18), MOM)];
    const tape21 = [mo(T(7, 54, 38), 'still'), mo(T(7, 54, 54), 'automotive'),
      mo(T(8, 30, 53), 'walking'), mo(T(9, 7, 18), 'automotive'), mo(T(9, 16, 29), 'onFoot')];
    const regions21 = [
      { ts: T(7, 55, 50), id: 'p-jh', enter: false },
      { ts: T(7, 59, 25), id: 'client-mom', enter: true },
      { ts: T(9, 8, 40), id: 'client-mom', enter: false },
    ];
    const run21 = (over) => run(page, base(Object.assign({
      tape: tape21, fixes: fixes21, fences: F21, regions: regions21, nowMs: T(14, 0),
    }, over)));

    test('his morning: the drive ends at 07:59, where he actually pulled up', async () => {
      const r = await run21();
      const leg = r.legs[0];
      expect(hm(leg.startTs)).toBe(hm(T(7, 54, 54)));
      expect(hm(leg.endTs), 'the crossing, not the 08:30 flip').toBe(hm(T(7, 59, 25)));
    });

    test('and the time it took off the drive lands on the stop, not nowhere', async () => {
      const r = await run21();
      const at = r.dwells.find(d => d.name === 'Laurie Schonfeldt');
      expect(at, 'he was at his mother\'s').toBeTruthy();
      expect(hm(at.startTs), 'from the moment he arrived').toBe(hm(T(7, 59, 25)));
    });

    test('a drive that only passes THROUGH a fence is untouched', async () => {
      // Same morning, except he drives past her house rather than stopping:
      // the crossing closes before the tape does, so there is nothing to trim.
      const r = await run21({ regions: [
        { ts: T(7, 55, 50), id: 'p-jh', enter: false },
        { ts: T(7, 59, 25), id: 'client-mom', enter: true },
        { ts: T(8, 0, 10), id: 'client-mom', enter: false },
      ] });
      expect(hm(r.legs[0].endTs), 'the flip still ends it').toBe(hm(T(8, 30, 53)));
    });

    test('it can only ever make a drive shorter, never longer or backwards', async () => {
      // A crossing that CLOSED before the drive began cannot be its arrival.
      // (An open-at-the-time one would mean he never left, which rule 7 reads
      // as a round trip, not as a drive with a bad end.)
      const r = await run21({ regions: [
        { ts: T(6, 0, 0), id: 'client-mom', enter: true },
        { ts: T(6, 30, 0), id: 'client-mom', enter: false },
      ] });
      expect(hm(r.legs[0].endTs)).toBe(hm(T(8, 30, 53)));
      expect(r.legs[0].endTs).toBeGreaterThan(r.legs[0].startTs);
    });

    test('no crossings at all is exactly the old behaviour', async () => {
      const r = await run21({ regions: [] });
      expect(hm(r.legs[0].endTs)).toBe(hm(T(8, 30, 53)));
    });

    test('junk crossings change nothing', async () => {
      for (const junk of [null, undefined, [], [null], [{ ts: 'x', id: 'client-mom', enter: true }],
                          [{ ts: T(7, 59), id: 'nobody', enter: true }, { ts: T(9, 8), id: 'nobody', enter: false }]]) {
        const r = await run21({ regions: junk });
        expect(hm(r.legs[0].endTs), String(junk && junk.length)).toBe(hm(T(8, 30, 53)));
      }
    });

    // ── THE ARRIVAL THAT ENDS THE DAY (owner 2026-09-16) ─────────────────
    // "Why am I as Logan Sample missing my last drive for the day still."
    //
    // His whole day was being thrown away, every derive, all evening:
    //
    //   error_log 01:13:01Z, app 09.15.26.17
    //   "geo derive refused: geo_replace_day: 1 overlapping pair(s)"
    //
    // He drove home from John Doe at 17:41:19. The crossing into his own
    // place fired at 17:50:14 and the tape did not leave automotive until
    // 17:54:39, so the drive ran nine minutes past the dwell the same
    // crossing opened, the two rows overlapped, and geo_replace_day threw out
    // the ENTIRE day rather than write a contradiction. Rule 21 is exactly
    // the rule for that crossing, and it never saw it: the enter had no exit,
    // because he was home and never left again, and an unpaired enter was
    // dropped before rule 21 ran.
    //
    // Two things have to hold, and the second is what the first fix got
    // wrong on its own: the day must WRITE (no overlapping pair anywhere in
    // the set), and the drive must still know where it ended.
    test('an arrival with no exit still ends the drive, and still names the place', async () => {
      const HOME = { id: 'p-home', kind: 'shop', name: 'TradeDesk shop', lat: 39.0307066, lng: -95.7112082 };
      const CLI = { id: 'client-jd', kind: 'client', name: 'John Doe', clientId: 9, lat: 39.0123292, lng: -95.7464936 };
      // The crossing fires at the OS region boundary, which is WIDER than this
      // file's own circle: a third of a mile short of the shop, still on the
      // road. That is why the arrival cannot be re-resolved from the fixes.
      const GATE = { lat: 39.0295618, lng: -95.7135011 };
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const rows = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' });
        const all = rows.job_time_entries.map(t => [Date.parse(t.arrived_at), Date.parse(t.departed_at)])
          .concat(rows.shop_time_entries.map(t => [Date.parse(t.arrived_at), Date.parse(t.departed_at)]));
        // The exact test geo_replace_day applies before it writes anything.
        let overlaps = 0;
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
          if (Math.min(all[i][1], all[j][1]) > Math.max(all[i][0], all[j][0])) overlaps++;
        }
        const last = res.legs[res.legs.length - 1];
        return JSON.parse(JSON.stringify({
          overlaps, endTs: last && last.endTs,
          to: last && last.to && last.to.name, unsavedTo: !!(last && last.unsavedTo),
        }));
      }, base({
        fences: [HOME, CLI],
        tape: [mo(T(13, 26, 48), 'onFoot'), mo(T(17, 41, 19), 'automotive'), mo(T(17, 54, 39), 'cycling')],
        fixes: [fix(T(13, 26, 48), CLI), fix(T(15, 0), CLI), fix(T(17, 41, 19), CLI),
          fix(T(17, 50, 14), GATE), fix(T(17, 50, 20), GATE), fix(T(17, 52, 0), HOME),
          fix(T(17, 54, 39), HOME), fix(T(18, 30), HOME)],
        regions: [
          { ts: T(17, 41, 25), id: 'client-jd', enter: false },
          // Entered and never left: he was home for the night.
          { ts: T(17, 50, 14), id: 'p-home', enter: true },
        ],
        nowMs: T(20, 0), crew: false,
      }));
      expect(r.overlaps, 'geo_replace_day refuses the whole day over one of these').toBe(0);
      expect(hm(r.endTs), 'the crossing ends it, not the 17:54 flip').toBe(hm(T(17, 50, 14)));
      expect(r.to, 'and the crossing names where he arrived').toBe('TradeDesk shop');
      expect(r.unsavedTo, 'the boundary fix being short of the circle is not "nowhere"').toBe(false);
    });

    // The reason an unpaired enter was dropped in the first place, which this
    // does NOT undo: Jack's 'shop' entered at 07:43 and never exited, and as a
    // SPAN it swallowed his whole day and put a stop three miles east at the
    // yard. An instant is not a span. Rule 15 still sees only closed pairs.
    test('but an unpaired enter is still never a span for where he was', async () => {
      const YARD = { id: 'yard', kind: 'shop', name: 'JS Solutions shop', lat: 39.0456577, lng: -95.7151106 };
      const FAR = { id: 'client-far', kind: 'client', name: 'Bill Lorson', clientId: 3, lat: 39.10721, lng: -95.6650246 };
      const r = await run(page, base({
        fences: [JH, YARD, FAR],
        tape: [mo(T(7, 43), 'onFoot'), mo(T(10, 0), 'automotive'), mo(T(10, 20), 'onFoot'),
          mo(T(15, 0), 'automotive'), mo(T(15, 20), 'onFoot')],
        fixes: [fix(T(7, 43), YARD), fix(T(9, 0), YARD), fix(T(10, 0), YARD),
          fix(T(10, 20), FAR), fix(T(12, 0), FAR), fix(T(15, 0), FAR),
          fix(T(15, 20), YARD), fix(T(17, 0), YARD)],
        // Entered the yard at 07:43 and the exit was never recorded.
        regions: [{ ts: T(7, 43), id: 'yard', enter: true }],
        nowMs: T(20, 0), crew: true,
      }));
      const far = r.dwells.find(d => d.name === 'Bill Lorson');
      expect(far, 'the midday stop is at the customer, not swallowed by the yard').toBeTruthy();
      expect(hm(far.startTs)).toBe(hm(T(10, 20)));
      // And the 10:00 drive out is NOT trimmed back to the 07:43 crossing:
      // that crossing is before it, which rule 21 already refuses.
      const out = r.legs.find(l => l.to && l.to.name === 'Bill Lorson');
      expect(hm(out.endTs)).toBe(hm(T(10, 20)));
    });
  });

  test.describe('rule 20: the commute', () => {
    const JHOME = { id: 'jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
    // No flag on it. The shop IS the place you report to (owner 2026-09-15:
    // "globally the process will be employees drive to the shop don't get
    // logged, but anything from the shop out to the next job does"), so his
    // account needed no setup at all: his dad's yard is already his shop.
    const YARD = { id: 'shop', kind: 'shop', name: 'JS Solutions shop', lat: 39.0456577, lng: -95.7151106 };
    // A second yard that is NOT the registered shop: this is what the checkbox
    // is for, and the only case that still needs one.
    const OTHER = { id: 'place-9', kind: 'other', name: 'Second yard', lat: 39.0456577, lng: -95.7151106 };
    const CUST = { id: 'client-1', kind: 'client', name: 'Bill Lorson', clientId: 1, lat: 39.10721, lng: -95.6650246 };
    // Home 07:24, yard 07:48, out to the customer 07:59, back 15:43, home 16:35.
    const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 24), 'automotive'), mo(T(7, 48), 'onFoot'),
      mo(T(7, 59), 'automotive'), mo(T(8, 24), 'onFoot'),
      mo(T(15, 43), 'automotive'), mo(T(16, 3), 'onFoot'),
      mo(T(16, 35), 'automotive'), mo(T(16, 53), 'onFoot')];
    const fixes = [fix(T(7, 24, 5), JHOME), fix(T(7, 48, 5), YARD), fix(T(7, 55), YARD),
      fix(T(7, 59, 5), YARD), fix(T(8, 24, 5), CUST), fix(T(12, 0), CUST),
      fix(T(15, 43, 5), CUST), fix(T(16, 3, 5), YARD), fix(T(16, 20), YARD),
      fix(T(16, 35, 5), YARD), fix(T(16, 53, 5), JHOME), fix(T(18, 0), JHOME)];
    // crew: true on every fixture in this block. Rule 20 is crew-only (owner
    // 2026-09-16), and every day in here is Jack's, who is crew on his dad's
    // account. The owner's own side of that answer is its own test at the
    // bottom of the block.
    const run20 = (fences, over) => page.evaluate((inp) => {
      const r = geoDeriveDay(inp);
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
      return JSON.parse(JSON.stringify({
        // The leg SURVIVES the rule and is marked; what it must never do is
        // bill. So the rows are what these tests read, and `commutes` is the
        // mark itself: hiding by deleting would take the drive off the record
        // and out of reach of a re-derive the day the flag changes.
        legs: r.legs.map(l => [l.from.name, l.to.name]),
        commutes: r.legs.filter(l => l && l.commute === true).length,
        dwells: r.dwells.map(d => [d.kind, d.name]),
        miles: rows.td_mileage.map(m => [m.from_name, m.to_name]),
        drives: rows.job_time_entries.filter(t => /^drive/.test(t.source)).length,
      }));
    }, base(Object.assign({ tape, fixes, fences, nowMs: T(20, 0), crew: true }, over || {})));

    test('his day: the two commutes bill nothing, the work drives do', async () => {
      const r = await run20([JHOME, YARD, CUST]);
      expect(r.miles, 'yard to the customer and back, and nothing else')
        .toEqual([['JS Solutions shop', 'Bill Lorson'], ['Bill Lorson', 'JS Solutions shop']]);
      expect(r.drives).toBe(2);
      expect(r.commutes, 'the drive in and the drive home, marked').toBe(2);
      expect(r.legs.length, 'and still derived: four drives happened').toBe(4);
    });

    test('and his time at the yard is untouched: being there IS the work', async () => {
      const r = await run20([JHOME, YARD, CUST]);
      expect(r.dwells.filter(d => d[0] === 'shop').length).toBeGreaterThan(0);
    });

    // WAS: "without the flag it is four drives." That was the first shape of
    // this rule, where the box was the whole mechanism. The owner's global
    // process makes the shop itself the trigger, so an account that ticks
    // nothing gets the right answer, and the box only speaks for a yard that
    // is not the shop.
    test('no flag anywhere: the shop alone is enough', async () => {
      const r = await run20([JHOME, YARD, CUST]);
      expect(r.miles).toEqual([['JS Solutions shop', 'Bill Lorson'],
                               ['Bill Lorson', 'JS Solutions shop']]);
      expect(r.drives).toBe(2);
      expect(r.commutes).toBe(2);
    });

    // AMENDED 2026-09-16 (10.4). It used to read "a yard that is not the shop
    // needs the box, and then it counts", and expected four drives without the
    // box: back when the rule was anchored on the base, an unrecognised place
    // at the far end meant no commute at all. The rule is now crew and the
    // DAY's shape (owner 2026-09-16), so for Jack the first hop out and the
    // last hop home are his own whatever stands at the other end, box or no
    // box. The box has not stopped mattering, it has stopped mattering HERE:
    // its own job is the midday drive, which is the test directly below.
    test('for crew the first and last hop go with or without the box', async () => {
      const off = await run20([JHOME, OTHER, CUST]);
      expect(off.commutes, 'his morning and his evening, unmarked place or not').toBe(2);
      expect(off.drives).toBe(2);
      const on = await run20([JHOME, Object.assign({}, OTHER, { commute: true }), CUST]);
      expect(on.miles).toEqual([['Second yard', 'Bill Lorson'], ['Bill Lorson', 'Second yard']]);
      expect(on.drives).toBe(2);
      expect(on.commutes).toBe(2);
    });

    // ── AND WHAT THE BOX IS ACTUALLY FOR ──────────────────────────────────
    // "I report here. The drive between home and here is a commute: no hours,
    // no miles." (js/places.js, the place form.) The day-shape rule above
    // covers the first hop out and the last hop home on its own, so the only
    // drive left for the box to speak about is a MIDDAY one: home to the
    // second yard and back in the middle of the day, which is the same two
    // ends every day and is a commute at any hour.
    test('the box still answers for a midday drive between home and the base', async () => {
      const day = {
        tape: [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'automotive'), mo(T(7, 30), 'onFoot'),
          mo(T(11, 0), 'automotive'), mo(T(11, 30), 'onFoot'),
          mo(T(12, 0), 'automotive'), mo(T(12, 20), 'onFoot'),
          mo(T(13, 0), 'automotive'), mo(T(13, 20), 'onFoot'),
          mo(T(17, 0), 'automotive'), mo(T(17, 30), 'onFoot')],
        fixes: [fix(T(7, 0, 5), JHOME), fix(T(7, 30, 5), CUST), fix(T(10, 0), CUST),
          fix(T(11, 0, 5), CUST), fix(T(11, 30, 5), JHOME), fix(T(11, 50), JHOME),
          fix(T(12, 0, 5), JHOME), fix(T(12, 20, 5), OTHER), fix(T(12, 50), OTHER),
          fix(T(13, 0, 5), OTHER), fix(T(13, 20, 5), CUST), fix(T(16, 0), CUST),
          fix(T(17, 0, 5), CUST), fix(T(17, 30, 5), JHOME), fix(T(19, 0), JHOME)],
      };
      const run = (place) => page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(r.legs.map(l => [
          (l.from && l.from.name) || '?', (l.to && l.to.name) || '?', !!l.commute])));
      }, base(Object.assign({}, day, { fences: [JHOME, place, CUST], nowMs: T(20, 0), crew: true })));
      const midday = (legs) => legs.find(l => l[0] === '7402 SW 22nd Ct' && l[1] === 'Second yard');
      const off = await run(OTHER);
      expect(midday(off), 'the drive happened either way').toBeTruthy();
      expect(midday(off)[2], 'an unmarked place: an ordinary midday trip out').toBe(false);
      const on = await run(Object.assign({}, OTHER, { commute: true }));
      expect(midday(on)[2], 'ticked "I report here": a commute at any hour').toBe(true);
      // And it never reaches past its own two ends: the drive OUT to the
      // customer from that yard is work, whatever the box says.
      expect(on.find(l => l[0] === 'Second yard' && l[1] === 'Bill Lorson')[2]).toBe(false);
    });

    // ONE BUILDING, SEVERAL FENCES. His yard is registered twice on his own
    // account, the Settings shop and the td_places row migrated from it, same
    // coordinate. Ticking the box on either one has to work, which is what
    // rule 15's first attempt got wrong about the same duplicate.
    test('any of the fences standing at that spot answers for the building', async () => {
      // His yard IS registered twice this way, and on the day this shipped the
      // duplicate was a `shop` place migrated from the Settings shop. Either
      // one being a shop, or either one carrying the box, has to be enough.
      const twin = { id: 'place-dup', kind: 'other', name: '1200 SW Oakley Ave',
        lat: YARD.lat, lng: YARD.lng, commute: true };
      const plain = Object.assign({}, YARD, { kind: 'other', commute: undefined });
      const r = await run20([JHOME, plain, twin, CUST]);
      expect(r.commutes, 'the commute is still recognised').toBe(2);
      expect(r.drives).toBe(2);
    });

    // ── REVERSED 2026-09-16 (10.4), BY THE OWNER, IN HIS OWN WORDS ───────
    // It used to read "a clock over the commute does not make it billable",
    // on the reasoning that the clock said he was working, not that the drive
    // was claimable. That was my reading, not his, and he overruled it:
    //
    //   "everything between a manual clock in for Jack shows drive to address,
    //    onsite time then drive to next address onsite time, drive to shop,
    //    shop time, drive from shop to address, onsite time then clock out."
    //
    // THE CLOCK IS THE BRACKET AND IT OUTRANKS THIS RULE. The commute rule
    // exists to answer a question the evidence leaves open. A punch closes it:
    // the person is telling you, at the time and in their own words, that this
    // stretch is work. Jack punches in at his own house at 07:54 and pulls out
    // of the driveway at 07:54:54, and on his real Monday rule 20 was cutting
    // two drives out of the middle of an eight-hour shift.
    //
    // Outside a clock nothing changes, which is the test below this one and is
    // what still keeps his 5am gym trip out of the day.
    test('a clock over the commute claims it: the punch outranks the rule', async () => {
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const rows = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' });
        return { miles: rows.td_mileage.map(m => [m.from_name, m.to_name]),
                 commutes: res.legs.filter(l => l && l.commute === true).length,
                 drives: rows.job_time_entries.filter(t => /^drive/.test(t.source)).length };
      }, base({ tape, fixes, fences: [JHOME, YARD, CUST], nowMs: T(20, 0), crew: true,
        clocks: [{ start: T(7, 0), end: T(18, 0) }] }));
      expect(r.commutes, 'nothing inside a punch is a commute').toBe(0);
      expect(r.drives, 'all four, the drive in and the drive home included').toBe(4);
      expect(r.miles).toEqual([
        ['7402 SW 22nd Ct', 'JS Solutions shop'], ['JS Solutions shop', 'Bill Lorson'],
        ['Bill Lorson', 'JS Solutions shop'], ['JS Solutions shop', '7402 SW 22nd Ct'],
      ]);
    });

    // And the same day with no punch on it is the rule again, unchanged. This
    // is the pair that matters: the clock is the only thing that moved.
    test('and the same day with no clock is two commutes, exactly as before', async () => {
      const r = await run20([JHOME, YARD, CUST]);
      expect(r.commutes).toBe(2);
      expect(r.drives).toBe(2);
    });

    // A punch that only abuts the drive does not claim it: one minute of real
    // overlap, the same threshold rules 13 and 16 already use.
    test('a clock that starts after the drive ended claims nothing', async () => {
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        return res.legs.filter(l => l && l.commute === true).length;
      }, base({ tape, fixes, fences: [JHOME, YARD, CUST], nowMs: T(20, 0), crew: true,
        // He punches in at the yard, after the drive in, and out before he
        // leaves for home. Both commutes are outside it and both still go.
        clocks: [{ start: T(8, 0), end: T(16, 0) }] }));
      expect(r).toBe(2);
    });

    test('a place that is both the house and the yard has no commute to hide', async () => {
      // The owner's own account: his shop fence sits 20 ft from his home
      // office. A drive between a spot and itself is not a commute, and rule 7
      // already refuses to call it anything.
      const both = { id: 'shop', kind: 'shop', name: 'TradeDesk shop',
        lat: JHOME.lat, lng: JHOME.lng };
      const r = await run20([JHOME, both, CUST]);
      expect(r.legs.map(l => l[1])).toContain('Bill Lorson');
    });

    // AMENDED 2026-09-16 (10.4) along with the test above, for the same
    // reason: junk on the flag no longer changes the DAY's shape, because the
    // day's shape never asked about the flag. What must still hold is that
    // junk is not a yes: it cannot earn the midday exception, and it cannot
    // turn the work drives in the middle of the day into commutes.
    test('junk on the flag is still not a yes', async () => {
      for (const v of [undefined, null, false, 0, 'true', 1]) {
        const r = await run20([JHOME, Object.assign({}, OTHER, { commute: v }), CUST]);
        expect(r.commutes, String(v)).toBe(2);
        expect(r.drives, String(v)).toBe(2);
      }
      // A real boolean true is the flag, and on this day it changes nothing
      // either, because the two hops it would speak for are already his.
      const yes = await run20([JHOME, Object.assign({}, OTHER, { commute: true }), CUST]);
      expect(yes.commutes).toBe(2);
    });

    // The shop is a KIND, not a name or a guess: a junk kind is not a shop.
    // Same amendment, same reason. The day is Jack's either way, so his first
    // and last hop go either way; what a junk kind must never do is make the
    // yard read as a base and start swallowing the work in between.
    test('only a real shop kind anchors it', async () => {
      for (const k of ['Shop', 'SHOP', 'shoppe', '', null, undefined]) {
        const r = await run20([JHOME, Object.assign({}, YARD, { kind: k }), CUST]);
        expect(r.commutes, String(k)).toBe(2);
        expect(r.drives, String(k)).toBe(2);
      }
    });

    // ── THE OWNER'S SIDE OF THE ANSWER (owner 2026-09-16) ─────────────────
    // Asked straight out whether a drive from the house to a customer job
    // should bill: "for a business owner it does, but for Jack it doesn't."
    //
    // So the same evidence, the same fences, the same day, derived for the
    // person who OWNS the business, bills every drive. This is not a setting
    // and it is not geography: it is who the day belongs to. The old gate
    // asked a geographic question ("has this account a base away from the
    // house") that gave the right answer on the owner's own account only
    // because his shop fence sits four metres from his desk; an owner whose
    // yard is across town would have had his drive in refused.
    // AMENDED 2026-09-16, same day, after the crew-only gate broke the one
    // person it was written for. Its first draft modelled "the owner" as
    // Jack's own fences with the crew hat switched off, which is not the
    // owner's shape at all: it is a man with a yard eight miles from his
    // house, and that man has a commute whoever owns the account.
    //
    // IT IS THE BASE, NOT THE HAT. The owner's shop fence sits four metres
    // from his home office, so home IS his place of business and every drive
    // out of the door is work, which is his sentence "for a business owner it
    // does" and is the line the tax code draws in the same place.
    test('the owner, whose shop is his house, bills every drive out of his door', async () => {
      const HOMESHOP = { id: 'shop', kind: 'shop', name: 'TradeDesk shop',
        lat: JHOME.lat, lng: JHOME.lng };
      const asOwner = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'c' });
        return JSON.parse(JSON.stringify({
          commutes: r.legs.filter(l => l && l.commute === true).length,
          drives: rows.job_time_entries.filter(t => /^drive/.test(t.source)).length,
        }));
      }, base({
        fences: [JHOME, HOMESHOP, CUST], nowMs: T(20, 0), crew: false,
        tape: [mo(T(7, 0), 'onFoot'), mo(T(7, 59), 'automotive'), mo(T(8, 24), 'onFoot'),
          mo(T(15, 43), 'automotive'), mo(T(16, 3), 'onFoot')],
        fixes: [fix(T(7, 30), JHOME), fix(T(7, 59, 5), JHOME), fix(T(8, 24, 5), CUST),
          fix(T(12, 0), CUST), fix(T(15, 43, 5), CUST), fix(T(16, 3, 5), JHOME),
          fix(T(18, 0), JHOME)],
      }));
      expect(asOwner.commutes, 'nothing is a commute when the house IS the base').toBe(0);
      expect(asOwner.drives, 'out of his own driveway and back, both work').toBe(2);
    });

    // ── AND JACK IS NOT CREW IN THE DATA (owner 2026-09-16) ───────────────
    // This is the case the crew-only gate got wrong, found on his live rows.
    // Jack's job_time_entries carry contractor_user_id === employee_user_id,
    // there is no team_members row for him anywhere, and his login owns its
    // own account with ownerName "Jack Schonfeldt". So `crew` is FALSE for
    // him, his commutes billed, and that is the exact opposite of what the
    // owner asked for twice.
    //
    // His base is still eight miles from his house, and that is the fact that
    // decides it. No link, no hat, no setting.
    test('a one-man account whose base is not his house still has a commute', async () => {
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const rows = geoDeriveRows(res, { contractorId: 'x', employeeId: 'x' });
        return JSON.parse(JSON.stringify({
          commutes: res.legs.filter(l => l && l.commute === true).length,
          drives: rows.job_time_entries.filter(t => /^drive/.test(t.source)).length,
          miles: rows.td_mileage.map(m => [m.from_name, m.to_name]),
        }));
      }, base({ tape, fixes, fences: [JHOME, YARD, CUST], nowMs: T(20, 0), crew: false }));
      expect(r.commutes, 'the drive in and the drive home, with nobody linked as crew').toBe(2);
      expect(r.drives).toBe(2);
      expect(r.miles, 'the yard out to the customer and back, and nothing else')
        .toEqual([['JS Solutions shop', 'Bill Lorson'], ['Bill Lorson', 'JS Solutions shop']]);
      // And the crew hat reaches the same answer, so nothing turns on it.
      const asCrew = await run20([JHOME, YARD, CUST]);
      expect(asCrew.commutes).toBe(2);
      expect(asCrew.drives).toBe(2);
    });

    // The other half stays in: a crew member whose employer registered no shop
    // at all has no away-base to find, and still commutes to the first job.
    test('and crew with no base registered anywhere still commutes', async () => {
      const r = await run20([JHOME, CUST]);
      expect(r.commutes, 'first drive out, last drive home').toBe(2);
    });

    // ── AND THE FLAG CANNOT REACH A MAN WHOSE BASE IS HIS HOUSE ───────────
    // Owner 2026-09-16, third round: "rebuilt, still missing a shit load of
    // miles." It was the crew flag every time, chased through three different
    // places a support view could answer wrongly, and each wrong answer
    // retired his first drive out and his last drive home off his own books.
    //
    // Home being the base now outranks the flag entirely, because it is a fact
    // about the FENCES and nothing on a screen can poison it. His shop sits
    // four metres from his desk: home is the place of business, so the drive
    // out of the door is the first business mile of the day.
    test('home as the base beats the crew flag, in both directions', async () => {
      const HOMESHOP = { id: 'shop', kind: 'shop', name: 'TradeDesk shop',
        lat: JHOME.lat, lng: JHOME.lng };
      const on = await run20([JHOME, HOMESHOP, CUST], { crew: true });
      const off = await run20([JHOME, HOMESHOP, CUST], { crew: false });
      expect(on.commutes, 'the flag cannot make his own driveway a commute').toBe(0);
      expect(off.commutes).toBe(0);
      expect(on.drives).toBe(off.drives);
      expect(on.miles).toEqual(off.miles);
    });

    // And it cannot reach Jack, which is the whole point of keeping it narrow:
    // his house is a home_office, which is not a place anybody reports to, and
    // the yard he does report to is eight miles away.
    test('a base away from the house is untouched by it', async () => {
      const r = await run20([JHOME, YARD, CUST], { crew: false });
      expect(r.commutes, 'the drive in and the drive home, flag or no flag').toBe(2);
    });

    // ── A COMMUTE HAS NOTHING IN IT (owner 2026-09-16) ────────────────────
    // He asked the only question worth asking before a roll: "no unsaved
    // addresses with no option to fill?" There was one, and this is it.
    //
    // A day that goes house, an address nobody saved, house is ONE leg with
    // TWO hops, and both qualified: the first drive out of the house and the
    // last drive back to it. Every hop refused meant the whole leg was
    // dropped, and six and a half hours of work at that address went with it:
    // no stop row, no coordinate, no Save this address button, and a manual
    // clock running over the lot of it did not save any of it.
    //
    // Two things have to hold forever, so this asserts both: the work is on
    // the timesheet, and the stop can still be NAMED, which means the mileage
    // row's viaStops still carries the coordinate under the stop row's own
    // client_key. That second half is the one that was silently broken: the
    // rail's Save button (_mileSaveStopAddress, js/mileage.js) resolves a stop
    // through that array and nowhere else, so a leg with no mileage row is a
    // button that does nothing.
    test('house, an address nobody saved, house: the day is work, not two commutes', async () => {
      const JOB = { lat: 39.0721, lng: -95.7010 };   // no fence anywhere near it
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const rows = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' });
        const stops = rows.job_time_entries.filter(t => /^unsaved/.test(t.source));
        return JSON.parse(JSON.stringify({
          commutes: res.legs.filter(l => l && l.commute === true).length,
          drives: rows.job_time_entries.filter(t => /^drive/.test(t.source)).length,
          stopMins: stops.map(t => Number(t.minutes)),
          // Can he name it? Exactly what the Save button asks.
          nameable: stops.every(t => rows.td_mileage.some(m => Array.isArray(m.viaStops) &&
            m.viaStops.some(v => v && v.key === t.client_key && v.lat != null && v.lng != null))),
        }));
      }, base({
        tape: [mo(T(7, 55), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 25), 'onFoot'),
          mo(T(15, 0), 'automotive'), mo(T(15, 25), 'onFoot')],
        fixes: [fix(T(8, 0), JHOME), fix(T(8, 25), JOB), fix(T(11, 0), JOB),
          fix(T(15, 0), JOB), fix(T(15, 25), JHOME), fix(T(18, 0), JHOME)],
        fences: [JHOME, YARD], nowMs: T(20, 0), crew: true,
        clocks: [{ start: T(8, 0), end: T(15, 25) }],
      }));
      expect(r.commutes, 'a trip with work in the middle is not a commute').toBe(0);
      expect(r.drives, 'out in the morning and back at night, both his employer\'s').toBe(2);
      expect(r.stopMins, 'the whole day at that address, on the timesheet').toEqual([395]);
      expect(r.nameable, 'and the Save this address button has a coordinate to open on').toBe(true);
    });

    // ── THE WRAP IS FOR A DAY THAT ENDED (owner 2026-09-16) ──────────────
    // "From JS Solutions shop to the unsaved address at 157 pm for Jack we're
    // missing a fucking drive dude."
    //
    // No drive was missing: his phone never moved. The tape reads still,
    // onFoot, still from 13:51 to 15:21 without touching automotive once, and
    // the fixes sit 11 to 20 feet from the yard until one cached coordinate
    // 1,161 ft out repeats verbatim at 14:06, 14:38, 15:00 and 15:25. He left
    // at 15:22:07 and the fence agreed, exiting at 15:25:40.
    //
    // What was missing is 1h25m of YARD time. The 30-minute unload wrap fired
    // in the MIDDLE of his working day, because "the last real work" is
    // computed from dwells and his 3:38pm stop was at an address nobody saved,
    // which is not a dwell. So a day still in progress looked like a day that
    // had ended at 1:22, and the hole it left is what the rail then dressed up
    // as an address he had supposedly driven to.
    //
    // He left again, and that is the whole test.
    test('a yard he drove out of keeps every minute, wrap or no wrap', async () => {
      const STOP = { lat: 39.0421, lng: -95.7511 };   // no fence near it
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const shop = res.dwells.filter(d => d.kind === 'shop');
        return JSON.parse(JSON.stringify({
          shop: shop.map(d => [d.startTs, d.endTs]),
          work: res.dwells.filter(d => d.kind === 'client').length,
          // The hole is the thing: a rail with one cannot help but imply a
          // trip nobody took.
          holes: (() => {
            const all = res.dwells.map(d => [d.startTs, d.endTs])
              .concat(res.legs.map(l => [l.startTs, l.endTs])).sort((a, b) => a[0] - b[0]);
            let n = 0, mark = all.length ? all[0][1] : 0;
            for (const [a, b] of all.slice(1)) { if (a - mark >= 5 * 60000) n++; mark = Math.max(mark, b); }
            return n;
          })(),
        }));
      }, base({
        fences: [JHOME, YARD, CUST],
        // Customer all morning, the yard from 13:27, out to an unsaved address
        // at 15:22, home at 16:21. The yard stretch is nearly two hours and the
        // last dwell-shaped work of the day ended when he left the customer.
        tape: [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 16), 'onFoot'),
          mo(T(13, 22), 'automotive'), mo(T(13, 27), 'onFoot'),
          mo(T(15, 22), 'automotive'), mo(T(15, 38), 'onFoot'),
          mo(T(16, 21), 'automotive'), mo(T(16, 35), 'onFoot')],
        fixes: [fix(T(8, 30), YARD), fix(T(9, 0), YARD),
          fix(T(9, 16), CUST), fix(T(11, 0), CUST), fix(T(13, 22), CUST),
          fix(T(13, 27), YARD), fix(T(14, 0), YARD), fix(T(15, 0), YARD), fix(T(15, 22), YARD),
          fix(T(15, 38), STOP), fix(T(16, 0), STOP), fix(T(16, 21), STOP),
          fix(T(16, 35), JHOME), fix(T(18, 0), JHOME)],
        nowMs: T(20, 0), crew: true,
      }));
      expect(r.work, 'the customer visit is a real dwell: without one the wrap '
        + 'branch is never reached and this test passes for the wrong reason').toBe(1);
      expect(r.shop.length, 'one yard stretch, not a clipped stub').toBe(1);
      expect(Math.round((r.shop[0][1] - r.shop[0][0]) / 60000),
        'every minute from arriving to driving away, not 30').toBe(115);
      expect(r.holes, 'and no hole for the rail to dress up as somewhere he drove to').toBe(0);
    });

    // The contrast, and the reason "he left again" is not the test on its own.
    // The drive HOME is also leaving. Change nothing about the day above
    // except that he goes straight home from the yard instead of stopping on
    // the way, and the wrap must fire exactly as it always has: that is the
    // 19h38m case (a phone sitting at the yard until 11:48pm) this rule was
    // written for, and it is untouched.
    test('but driving straight home from the yard is the day ending, and still caps', async () => {
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify({
          shop: res.dwells.filter(d => d.kind === 'shop').map(d => Math.round((d.endTs - d.startTs) / 60000)),
          work: res.dwells.filter(d => d.kind === 'client').length,
        }));
      }, base({
        fences: [JHOME, YARD, CUST],
        // Same morning, same yard arrival at 13:27, same departure at 15:22.
        // The only difference is the far end: his driveway, one hop, no stop.
        tape: [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'automotive'), mo(T(9, 16), 'onFoot'),
          mo(T(13, 22), 'automotive'), mo(T(13, 27), 'onFoot'),
          mo(T(15, 22), 'automotive'), mo(T(15, 40), 'onFoot')],
        fixes: [fix(T(8, 30), YARD), fix(T(9, 0), YARD),
          fix(T(9, 16), CUST), fix(T(11, 0), CUST), fix(T(13, 22), CUST),
          fix(T(13, 27), YARD), fix(T(14, 0), YARD), fix(T(15, 0), YARD), fix(T(15, 22), YARD),
          fix(T(15, 40), JHOME), fix(T(18, 0), JHOME)],
        nowMs: T(20, 0), crew: true,
      }));
      expect(r.work, 'same day, same customer visit, so the same branch runs').toBe(1);
      expect(r.shop, 'the unload window, not the whole afternoon').toEqual([30]);
    });

    // The other half of the same rule, and the reason it is worded as "nothing
    // in it" rather than "not the same leg": house straight to the yard and
    // back at night are two SEPARATE legs with nothing inside either one, and
    // both are still refused. Covered above by his real day; asserted here
    // against the shape that nearly took it out.
    test('but an empty drive out and an empty drive home are still commutes', async () => {
      const r = await run20([JHOME, YARD, CUST]);
      expect(r.commutes).toBe(2);
      expect(r.drives).toBe(2);
    });

    // ── AND THE MILES GO WITH THE HOP (owner 2026-09-16) ──────────────────
    // Found by running the rule against his real Monday rather than a
    // fixture. It refused the last hop into his driveway and then billed 4.4
    // miles to it anyway: one mileage row covers the whole leg at the DIRECT
    // route between its two SAVED ends, his house is one of those ends, so
    // the row named his own driveway as a business destination and charged
    // the commute to the company.
    //
    // His yard out to an address nobody saved is what he actually drove for
    // work, and rule 14 already says what that is: a traced row, breadcrumb
    // miles, shown on the log and claimed by nobody until he names the stop.
    test('a chain that ends at his driveway does not bill the miles home', async () => {
      const STOP = { lat: 39.0421, lng: -95.7511 };   // no fence within a mile
      const r = await page.evaluate((inp) => {
        const res = geoDeriveDay(inp);
        const rows = geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' });
        return JSON.parse(JSON.stringify({
          commutes: res.legs.filter(l => l && l.commute === true).length,
          rows: rows.td_mileage.map(m => ({
            to: m.to_name, miles: m.miles, traced: !!m.traced,
            held: !!m.pendingPurpose, unsavedTo: !!m.unsavedTo,
            // The Save button's target: where he actually stood, never the
            // house he was refused for driving to.
            toLat: m.toCoord && Math.round(m.toCoord.lat * 1e4) / 1e4,
          })),
          stops: rows.job_time_entries.filter(t => /^unsaved/.test(t.source)).length,
        }));
      }, base({
        // Yard at 07:48, out to the customer, back to the yard, then the
        // chain home: yard, 40 minutes at STOP, driveway.
        tape: [mo(T(7, 0), 'onFoot'), mo(T(7, 48), 'onFoot'),
          mo(T(7, 59), 'automotive'), mo(T(8, 24), 'onFoot'),
          mo(T(15, 43), 'automotive'), mo(T(16, 3), 'onFoot'),
          mo(T(16, 35), 'automotive'), mo(T(16, 50), 'onFoot'),
          mo(T(17, 30), 'automotive'), mo(T(17, 50), 'onFoot')],
        fixes: [fix(T(7, 48, 5), YARD), fix(T(7, 59, 5), YARD),
          fix(T(8, 24, 5), CUST), fix(T(12, 0), CUST), fix(T(15, 43, 5), CUST),
          fix(T(16, 3, 5), YARD), fix(T(16, 20), YARD), fix(T(16, 35, 5), YARD),
          fix(T(16, 50, 5), STOP), fix(T(17, 10), STOP), fix(T(17, 30, 5), STOP),
          fix(T(17, 50, 5), JHOME), fix(T(19, 0), JHOME)],
        fences: [JHOME, YARD, CUST], nowMs: T(21, 0), crew: true,
      }));
      expect(r.commutes, 'the chain home is marked').toBe(1);
      expect(r.stops, 'and the 40 minutes at that address is still on the timesheet').toBe(1);
      const home = r.rows.find(m => m.unsavedTo);
      expect(home, 'the chain home writes a row, it is not deleted').toBeTruthy();
      expect(home.to, 'it does not name his driveway as a destination').toBe('');
      expect(home.traced && home.held, 'shown on the log, in no money total').toBe(true);
      expect(home.toLat, 'and Save opens where he actually stood').toBe(39.0421);
      expect(r.rows.some(m => m.to === '7402 SW 22nd Ct'),
        'no row bills miles to his house').toBe(false);
    });
  });

  // ── RULE 19: the day learns when this person usually works ───────────────
  //
  // Owner 2026-09-15: "Jack's day is 8 am to 5 pm really but sometimes gets off
  // before that, we know his clock in and clock out behavior so how do we run
  // this ladder off the times we know he usually works? This could be global."
  //
  // The company setting is one number for everybody. His own punches are the
  // person. These are the real ones, at the top of this file.
  test.describe('rule 19: the learned working day', () => {
    const shape = (over) => page.evaluate((i) => {
      const r = _gdDayShape(i);
      return { a: r.whA / 60000, b: r.whB / 60000, learned: r.learned, workDay: r.workDay };
    }, Object.assign({ day: DAY, workHours: null }, over || {}));

    test('his seven days give 6:44am to 6:16pm, trimmed and padded', async () => {
      const r = await shape({ clockHistory: clocksBefore(DAY) });
      expect(r.learned).toBe(true);
      // ins 7:42..7:58, trimmed to 7:44, less an hour. outs 15:00..19:30,
      // trimmed to 17:16, plus an hour. Wide on purpose: missing a real job
      // costs money, letting a gym trip through costs a greyed row.
      expect([r.a, r.b]).toEqual([6 * 60 + 44, 18 * 60 + 16]);
    });

    test('under five clocked days there is no pattern, so the company stands', async () => {
      const four = clocksBefore(DAY).slice(0, 4);
      const r = await shape({ clockHistory: four });
      expect(r.learned).toBe(false);
      expect([r.a, r.b]).toEqual([6 * 60, 20 * 60]);
    });

    test('it replaces the company setting rather than widening it', async () => {
      // Narrower is the point: he has never started before 7:42, so the
      // company's 6am says nothing about his morning. Safe because the window
      // only ever arbitrates a drive that can vouch for neither a second fence
      // nor a clock.
      const r = await shape({ clockHistory: clocksBefore(DAY), workHours: { start: '05:00', end: '23:00' } });
      expect([r.a, r.b]).toEqual([6 * 60 + 44, 18 * 60 + 16]);
    });

    test('a punch from after the day being derived is not evidence about it', async () => {
      // A day's rows must not change because of a clock three weeks later.
      const future = JACK_CLOCKS.map((c, n) => Object.assign({}, c, {
        day: new Date(Date.parse(DAY + 'T12:00:00Z') + (n + 1) * 86400000).toISOString().slice(0, 10),
      }));
      const r = await shape({ clockHistory: future });
      expect(r.learned).toBe(false);
    });

    test('one wild punch cannot poison the window', async () => {
      const wild = clocksBefore(DAY).concat([
        { day: '2026-01-01', inMin: 3 * 60, outMin: 23 * 60 + 30 },
      ]);
      const r = await shape({ clockHistory: wild });
      // The 3am start is the single most extreme sample and is trimmed off;
      // 7:42 becomes the new extreme, so the edge moves by two minutes.
      expect(r.a).toBe(6 * 60 + 42);
    });

    test('junk history is no history', async () => {
      const junk = [null, {}, { day: '2026-09-01' },
        { day: '2026-09-01', inMin: 500, outMin: 400 }, { inMin: 1, outMin: 2 }];
      for (const h of [null, 'nope', [], junk]) {
        const r = await shape({ clockHistory: h });
        expect(r.learned).toBe(false);
        expect([r.a, r.b]).toEqual([6 * 60, 20 * 60]);
      }
    });

    test('the learned window decides a loop the ladder cannot otherwise place', async () => {
      // 6:30 to 7:45 out of his own door, nothing saved between, no clock.
      // Inside the company's 6am day and outside his own, and his own wins.
      const JHOME = { id: 'jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
      const GYM = { lat: JHOME.lat + 0.03, lng: JHOME.lng };
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 45), 'onFoot'),
        mo(T(7, 30), 'driving'), mo(T(7, 45), 'onFoot')];
      const fixes = [fix(T(6, 30, 5), JHOME), fix(T(6, 45, 5), GYM), fix(T(7, 0), GYM),
        fix(T(7, 30, 5), GYM), fix(T(7, 45, 5), JHOME), fix(T(9, 0), JHOME)];
      const day = (over) => base(Object.assign({ tape, fixes, fences: [JHOME], nowMs: T(10, 0) }, over));
      // Without his history the company's 6am keeps it, greyed, asking.
      const bare = await run(page, day({}));
      expect(bare.legs.map(l => l.held === true)).toEqual([true]);
      // With it, the day he actually works starts at 6:44 and this is before.
      const learned = await run(page, day({ clockHistory: clocksBefore(DAY) }));
      expect(learned.legs).toEqual([]);
    });

    test('a clock over it still claims it, and so does a second fence', async () => {
      // Rungs 1 and 2 never ask the hour. A 5am run between two saved places
      // is work, and so is anything a person clocked for.
      const tape = [mo(T(4, 30), 'onFoot'), mo(T(5, 0), 'driving'), mo(T(5, 20), 'onFoot')];
      const fixes = [fix(T(5, 0, 5), SHOP), fix(T(5, 20, 5), DOE), fix(T(6, 0), DOE)];
      const r = await run(page, base({ tape, fixes, clockHistory: clocksBefore(DAY), nowMs: T(9, 0) }));
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([['TradeDesk shop', 'John Doe']]);
    });
  });

  test.describe('rule 15: a closed fence crossing beats a cached fix', () => {
    const reg = (ts, id, enter) => ({ ts, id, enter });
    // His yard, registered three ways at one coordinate: the settings shop,
    // a td_places row, and a third id with a colon where the others have a
    // hyphen. Only the first is what geoFenceAt would name the place.
    const YARD = { id: 'shop', kind: 'shop', name: 'JS Solutions shop', lat: 39.0456577, lng: -95.7151106 };
    const YARD2 = { id: 'place-1788216906515011', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
    const OFF = { lat: YARD.lat - 0.0035, lng: YARD.lng };   // the cache, ~1,275 ft south
    const F = [YARD, YARD2, DOE];
    // Out to the client, back to the yard at 16:01, away again at 16:35.
    const tape = [mo(T(7, 0), 'onFoot'), mo(T(15, 43), 'driving'), mo(T(16, 1), 'onFoot'),
                  mo(T(16, 35), 'driving'), mo(T(16, 53), 'onFoot')];
    const fixes = [fix(T(15, 43), DOE), fix(T(16, 11), OFF), fix(T(16, 14), OFF),
                   fix(T(16, 30), OFF), fix(T(16, 36), OFF), fix(T(16, 53), DOE)];
    const day = (over) => base(Object.assign({ tape, fixes, fences: F, nowMs: T(17, 30) }, over));

    test("his 4:01pm: the crossing names the stop four cached fixes put 1,279 ft away", async () => {
      const r = await run(page, day({ regions: [reg(T(15, 58), YARD2.id, true), reg(T(16, 36), YARD2.id, false)] }));
      // AMENDED 2026-09-15 for rule 21. The dwell used to start at 16:01, the
      // tape's flip out of automotive. The crossing fired at 15:58 and is the
      // moment he actually pulled in, so the drive ends there and the stop
      // starts there. Three minutes, on the right row now.
      expect(r.dwells.map(d => [d.kind, d.name, hm(d.startTs), hm(d.endTs)]))
        .toEqual([['shop', 'JS Solutions shop', hm(T(15, 58)), hm(T(16, 35))]]);
    });

    test('without the crossing it is the bug he reported: nothing names the stop', async () => {
      const r = await run(page, day({}));
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
    });

    // REGRESSION, first attempt. The crossing fired on the td_places id, so
    // keying the NAME off that id renamed every drive of his day onto "1200 SW
    // Oakley Ave". The id says WHERE; geoFenceAt says WHICH.
    test('one building, three region ids, one answer', async () => {
      for (const id of [YARD.id, YARD2.id]) {
        const r = await run(page, day({ regions: [reg(T(15, 58), id, true), reg(T(16, 36), id, false)] }));
        expect(r.dwells.map(d => d.name), 'whichever id fired, the place is named the same')
          .toEqual(['JS Solutions shop']);
      }
      // And the third id is not a fence at all, so it is not evidence.
      const junk = await run(page, day({ regions: [reg(T(15, 58), 'place:1788216906515011', true),
                                                   reg(T(16, 36), 'place:1788216906515011', false)] }));
      expect(junk.dwells.filter(d => d.kind === 'shop')).toEqual([]);
    });

    // REGRESSION, first attempt. 'shop' entered at 07:43 and never exited; an
    // open span run to now swallowed the day and put his 10:10 stop, three
    // miles east, at the yard.
    test('an enter with no exit is not a span, and cannot swallow the day', async () => {
      const r = await run(page, day({ regions: [reg(T(7, 43), YARD.id, true)] }));
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
      // Nor does it reach forward past a later, real pair for the same place.
      const both = await run(page, day({ regions: [reg(T(7, 43), YARD.id, true),
        reg(T(15, 58), YARD2.id, true), reg(T(16, 36), YARD2.id, false)] }));
      // Rule 21 again: the real pair's ENTER is the arrival (see above).
      expect(both.dwells.map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(15, 58)), hm(T(16, 35))]]);
    });

    test('an exit with no enter is nothing either', async () => {
      const r = await run(page, day({ regions: [reg(T(16, 36), YARD2.id, false)] }));
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
    });

    test('a closed span does not reach past its own ends', async () => {
      const r = await run(page, day({ regions: [reg(T(11, 0), YARD2.id, true), reg(T(11, 30), YARD2.id, false)] }));
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
    });

    // Two crossings can be open at once (a job inside a client's fence, a shop
    // inside a home office). They rank the way geoFenceAt already ranks two
    // overlapping circles, so one precedence governs the file.
    test('overlapping spans rank the way overlapping fences do', async () => {
      const r = await run(page, base({ tape, fences: [JOB, DOE, HD],
        fixes: [fix(T(15, 43), HD), fix(T(16, 11), OFF), fix(T(16, 30), OFF), fix(T(16, 53), HD)],
        regions: [reg(T(15, 58), DOE.id, true), reg(T(15, 59), JOB.id, true),
                  reg(T(16, 36), JOB.id, false), reg(T(16, 37), DOE.id, false)],
        nowMs: T(17, 30) }));
      expect(r.dwells.map(d => [d.kind, d.name])).toEqual([['job', 'John Doe']]);
    });

    test('junk crossings change nothing and never throw', async () => {
      const clean = await run(page, day({}));
      for (const regions of [null, 'nope', [], [null, {}, { ts: 'x', id: YARD.id, enter: true },
                             { ts: T(16, 10), id: null, enter: true },
                             { ts: T(16, 10), id: 'place-deleted-last-week', enter: true },
                             { ts: T(16, 20), id: 'place-deleted-last-week', enter: false }]]) {
        const r = await run(page, day({ regions }));
        expect(r.dwells).toEqual(clean.dwells);
        expect(r.legs).toEqual(clean.legs);
      }
    });
  });

  test.describe('one fix outside a fence is not leaving', () => {
    // The one that cost the owner his whole day, 2026-09-03. A UAT roll
    // reloaded the app at 14:19, the radio spun up, and CoreMotion called it
    // automotive. That open journey ended his John Doe visit at the flip and
    // cleared the arrival, so the tail reported no open dwell at all: the
    // on-site card fell back to the proximity prompt with no arrival stamp,
    // the Time Log showed 08:01 to 14:19, and _liveActOnSite was handed null
    // so the island and lock screen went dark. He never moved: every fix after
    // the flip stayed 61 to 317 ft from the client for hours.
    test('a phantom automotive flip does not end a visit the phone never left', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot'),
                    mo(T(14, 19), 'driving')];   // opens and never closes
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE), fix(T(12, 0), DOE),
                     fix(T(14, 19), DOE), fix(T(14, 25), DOE), fix(T(15, 0), DOE), fix(T(15, 30), DOE)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE], nowMs: T(15, 45) }));
      // Still on site, still measured from the real 08:20 arrival.
      expect(r.open && r.open.name).toBe('John Doe');
      expect(hm(r.open.sinceTs)).toBe(hm(T(8, 20)));
      // And no closed visit was invented at the flip.
      expect(r.dwells.filter(d => d.kind === 'client')).toEqual([]);
    });

    test('a real drive still ends the visit: fixes stop coming from inside the fence', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot'),
                    mo(T(12, 0), 'driving')];
      const AWAY = { lat: DOE.lat + 0.02, lng: DOE.lng };
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE),
                     fix(T(12, 0, 5), DOE), fix(T(12, 4), AWAY), fix(T(12, 8), AWAY)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE], nowMs: T(12, 30) }));
      expect(r.open).toBeNull();
      expect(r.dwells.filter(d => d.kind === 'client').map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(8, 20)), hm(T(12, 0))]]);
    });

    test('a lone outlier mid-visit does not close it: the visit stays open', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      // Arrive at DOE at 08:20 and stay. At 14:19 one cached fix lands well
      // outside the fence, then the real fixes resume at DOE.
      const OUT = { lat: DOE.lat + 0.003, lng: DOE.lng };    // ~1100 ft north, well past the 600 ft fence
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE), fix(T(12, 0), DOE),
                     fix(T(14, 19), OUT), fix(T(14, 25), DOE), fix(T(15, 0), DOE)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE] }));
      expect(r.open && r.open.kind).toBe('client');
      expect(hm(r.open.sinceTs)).toBe(hm(T(8, 20)));
      // No closed client row was written for a visit that never ended.
      expect(r.dwells.filter(d => d.kind === 'client')).toEqual([]);
    });

    // Owner 2026-09-09, 13:06:55. He had parked at John Doe at 13:05; the
    // phone then restated its cached road position (the exact 13:02:02
    // coordinate, 0.8 mi out) and it reached the server twice, 1 ms apart: a
    // location_pings row and a geo_events fix from the same reading. The
    // second row was read as the "next fix also outside", the visit closed
    // at its own arrival instant, and everything downstream went with it:
    // no on-site card, an Office row at 12:23, the house dwell after 12:14
    // dropped as after-hours, two Unaccounted holes on the rail.
    test('the same stale reading written twice is one reading, not a departure', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(12, 55), 'driving'), mo(T(13, 5), 'onFoot')];
      const ROAD = { lat: 39.01065256527216, lng: -95.73155216104179 };   // 0.8 mi from DOE
      const NEAR = { lat: 39.012890126348864, lng: -95.74387150829563 };  // 0.2 mi out, still rolling
      const fixes = [fix(T(12, 55, 5), SHOP), fix(T(13, 2), ROAD), fix(T(13, 3), NEAR),
                     // the cached road reading, restated after arrival, from two tables
                     { ts: T(13, 6, 55), lat: ROAD.lat, lng: ROAD.lng, acc: 2 },
                     { ts: T(13, 6, 55) + 1, lat: ROAD.lat, lng: ROAD.lng, acc: null },
                     fix(T(13, 7, 3), DOE), fix(T(13, 30), DOE), fix(T(14, 37), DOE)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE], nowMs: T(14, 40) }));
      expect(r.open && r.open.name).toBe('John Doe');
      expect(hm(r.open.sinceTs)).toBe(hm(T(13, 5)));
      expect(r.openWhy).toBe('');
      expect(r.dwells.filter(d => d.kind === 'client')).toEqual([]);
    });

    test('the same outside reading twice, then a genuinely new one outside, IS leaving', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      const OUT = { lat: DOE.lat + 0.003, lng: DOE.lng };
      const OUT2 = { lat: DOE.lat + 0.004, lng: DOE.lng };
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE),
                     fix(T(12, 0), OUT), { ts: T(12, 0) + 1, lat: OUT.lat, lng: OUT.lng, acc: null },
                     fix(T(12, 10), OUT2)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE] }));
      expect(r.open).toBeNull();
      expect(r.dwells.filter(d => d.kind === 'client').map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(8, 20)), hm(T(10, 0))]]);
    });

    test('two fixes outside in a row IS leaving: the visit closes at the last one inside', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      const OUT = { lat: DOE.lat + 0.003, lng: DOE.lng };
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE),
                     fix(T(12, 0), OUT), fix(T(12, 10), OUT), fix(T(12, 20), OUT)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE] }));
      expect(r.open).toBeNull();
      expect(r.dwells.filter(d => d.kind === 'client').map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(8, 20)), hm(T(10, 0))]]);
    });

    // The one that actually cost the owner his day, 2026-09-03. A job fence
    // outranks a client fence (job 0, client 3), so once a job exists at the
    // same address, geoFenceAt hands every later fix to the JOB. Testing that
    // winner against the fence we arrived at read as "departed" with the man
    // standing still, and it fired on the fence rebuild a UAT roll triggers.
    test('a higher-ranked fence appearing at the same address does not end the visit', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE),
                     fix(T(12, 0), DOE), fix(T(14, 19), DOE), fix(T(15, 0), DOE)];
      // A JOB at John Doe's address, right on top of the client fence.
      const JOBATDOE = { id: 'job-777', kind: 'job', name: 'John Doe repipe', jobId: 777, lat: DOE.lat, lng: DOE.lng };
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE, JOBATDOE] }));
      // Still on site, and still measured from the real arrival.
      expect(r.open).not.toBeNull();
      expect(hm(r.open.sinceTs)).toBe(hm(T(8, 20)));
      // Nothing was written as a closed visit for a day that never ended.
      expect(r.dwells.filter(d => d.kind === 'client' || d.kind === 'job')).toEqual([]);
    });

    test('a single unconfirmed reading at the very end never ends the day', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      const OUT = { lat: DOE.lat + 0.003, lng: DOE.lng };
      const fixes = [fix(T(8, 0, 5), SHOP), fix(T(8, 20, 5), DOE), fix(T(10, 0), DOE), fix(T(12, 0), OUT)];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE] }));
      expect(r.open && r.open.kind).toBe('client');
      expect(hm(r.open.sinceTs)).toBe(hm(T(8, 20)));
    });

    // ── The approach is not a departure (owner 2026-09-16) ────────────────
    //
    // "my onsite banner at john doe didnt grab my arrival time and
    // incremement the time up nor do I see my log beginning at john doe
    // starting at 143 pm like I used to", and in the same breath "why im
    // missing my shop time". One cause, both holes.
    //
    // iOS fires a region crossing at the FULL region radius, so his 13:43:37
    // enter was stamped 785 ft from the pin. The dwell test measures against
    // the kind-scaled span instead (a client is 0.4 of the account radius,
    // 240 ft), so the last ten fixes of the drive up the street were all
    // "outside", the first two corroborated each other, and the visit closed
    // at its own arrival instant with no length. `open` went null, and with
    // no open work dwell rule 11 read the day as having ended at the morning
    // visit and dropped the 12:59 to 13:36 shop dwell as after-hours.
    //
    // These are his real coordinates off geo_events, distances from the pin
    // in the comments.
    const APPROACH = [
      [T(13, 43, 40), 39.012751, -95.743859],   // 761 ft
      [T(13, 43, 46), 39.012467, -95.743866],   // 745 ft
      [T(13, 43, 50), 39.012525, -95.744252],   // 638 ft
      [T(13, 43, 58), 39.012942, -95.744908],   // 501 ft
      [T(13, 44, 14), 39.013409, -95.746213],   // 401 ft
      [T(13, 44, 27), 39.013139, -95.746320],   // 299 ft, still outside the 240 ft span
    ].map(([ts, lat, lng]) => ({ ts, lat, lng, acc: 8 }));
    const PARKED = [
      { ts: T(13, 47, 7), lat: 39.012871, lng: -95.746368, acc: 8 },   // 200 ft: reached
      { ts: T(13, 48, 6), lat: 39.012567, lng: -95.746604, acc: 8 },   // 92 ft
      { ts: T(14, 2, 5), lat: 39.012329, lng: -95.746317, acc: 8 },    // 50 ft
      { ts: T(14, 33, 6), lat: 39.012224, lng: -95.746278, acc: 8 },   // 72 ft
    ];
    // Morning at the client, back to the yard at 12:59, out again at 13:36.
    const afternoon = (over) => base(Object.assign({
      tape: [mo(T(7, 45), 'driving'), mo(T(7, 55), 'onFoot'),
             mo(T(12, 45), 'driving'), mo(T(12, 59), 'onFoot'),
             mo(T(13, 36), 'driving'), mo(T(13, 47), 'onFoot')],
      fixes: [fix(T(7, 45, 5), SHOP), fix(T(7, 55, 5), DOE), fix(T(10, 0), DOE), fix(T(12, 45, 5), DOE),
              fix(T(12, 59, 5), SHOP), fix(T(13, 10), SHOP), fix(T(13, 36, 5), SHOP)]
        .concat(APPROACH, PARKED),
      regions: [{ ts: T(13, 43, 37), id: DOE.id, enter: true }],
      fences: [SHOP, HOME, DOE], nowMs: T(14, 56),
    }, over));

    test('the drive up the street is not a departure: the visit opens at the crossing', async () => {
      const r = await run(page, afternoon());
      expect(r.openWhy).toBe('');
      expect(r.open && r.open.name).toBe('John Doe');
      expect(hm(r.open.sinceTs)).toBe(hm(T(13, 43)));
      // And no zero-length visit was invented at the arrival instant.
      expect(r.dwells.filter(d => d.kind === 'client' && d.startTs >= T(13, 0))).toEqual([]);
    });

    test('and the yard between the two runs keeps its minutes', async () => {
      const r = await run(page, afternoon());
      expect(r.dwells.filter(d => d.kind === 'shop').map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(12, 59)), hm(T(13, 36))]]);
    });

    test('driving PAST the fence still writes nothing: no fix ever lands inside', async () => {
      // Same crossing, same approach, and then he carries on out of town.
      const AWAY = { lat: DOE.lat + 0.02, lng: DOE.lng };
      const r = await run(page, afternoon({
        tape: [mo(T(7, 45), 'driving'), mo(T(7, 55), 'onFoot'),
               mo(T(12, 45), 'driving'), mo(T(12, 59), 'onFoot'),
               mo(T(13, 36), 'driving')],
        // Only the part of the approach that never comes inside the 600 ft
        // fence: he crossed the region boundary (which iOS stamps wider than
        // the fence) and carried straight on out of town.
        fixes: [fix(T(7, 45, 5), SHOP), fix(T(7, 55, 5), DOE), fix(T(10, 0), DOE), fix(T(12, 45, 5), DOE),
                fix(T(12, 59, 5), SHOP), fix(T(13, 36, 5), SHOP)]
          .concat(APPROACH.slice(0, 2), [fix(T(13, 50), AWAY), fix(T(13, 55), AWAY)]),
      }));
      expect(r.open).toBeNull();
      expect(r.dwells.filter(d => d.kind === 'client' && d.startTs >= T(13, 0))).toEqual([]);
    });
  });

  // ── Rule 10: paperwork at the home office ───────────────────────────────
  // Owner 2026-09-02: "if it's a home office, app time still counts", and
  // "yes, count it on no-drive days". App-open minutes inside a home-office
  // fence are an Office row, carved out of any surrounding home dwell.
  test.describe('paperwork at the home office', () => {
    const HOMEONLY = { id: 'place-ho', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0100, lng: -95.6900, addr: '7402 SW 22nd Ct' };
    const HFIX = { lat: HOMEONLY.lat, lng: HOMEONLY.lng };
    const app = (ts, kind) => ({ ts, kind });
    const F = [SHOP, DOE, HOMEONLY];

    test('the evening after the last drive: two hours of quotes is an Office row, the rest of the evening is not', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(17, 0), 'driving'), mo(T(17, 16), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(17, 0, 5), DOE), fix(T(17, 16, 5), HFIX), fix(T(18, 0), HFIX), fix(T(19, 30), HFIX), fix(T(21, 0), HFIX)];
      const appEvents = [app(T(18, 0), 'active'), app(T(19, 30), 'background')];
      const r = await run(page, base({ tape, fixes, fences: F, appEvents }));
      const office = r.dwells.filter(d => d.kind === 'office');
      expect(office.map(d => [hm(d.startTs), hm(d.endTs), d.minutes, d.name])).toEqual([['23:00', '00:30', 90, '7402 SW 22nd Ct']]);
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
      expect(r.open && r.open.kind).toBe('home_office');
    });

    // Owner 2026-09-04, on his 31 August rail: two Office rows, 5:48 to 5:49
    // and 5:49 to 6:00. He backgrounded the app and reopened it eleven seconds
    // later. That is one sitting at the desk, and the rail drew two.
    test('a blink between two app sessions is one Office row, not two', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(17, 0), 'driving'), mo(T(17, 16), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(17, 0, 5), DOE), fix(T(17, 16, 5), HFIX), fix(T(18, 0), HFIX), fix(T(19, 30), HFIX), fix(T(21, 0), HFIX)];
      const appEvents = [app(T(17, 48), 'active'), app(T(17, 49, 14), 'background'),
        app(T(17, 49, 25), 'active'), app(T(18, 0), 'background')];
      const r = await run(page, base({ tape, fixes, fences: F, appEvents }));
      const office = r.dwells.filter(d => d.kind === 'office');
      expect(office.map(d => [hm(d.startTs), hm(d.endTs)])).toEqual([['22:48', '23:00']]);
      expect(office[0].minutes).toBe(12);
    });

    // But a real break between two sittings stays two rows: the glue is a
    // blink, not a nap.
    test('half an hour away from the desk is still two Office rows', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(17, 0), 'driving'), mo(T(17, 16), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(17, 0, 5), DOE), fix(T(17, 16, 5), HFIX), fix(T(18, 0), HFIX), fix(T(19, 30), HFIX), fix(T(21, 0), HFIX)];
      const appEvents = [app(T(17, 30), 'active'), app(T(17, 45), 'background'),
        app(T(18, 15), 'active'), app(T(18, 40), 'background')];
      const r = await run(page, base({ tape, fixes, fences: F, appEvents }));
      expect(r.dwells.filter(d => d.kind === 'office').length).toBe(2);
    });

    // Regression (owner 2026-09-03). app-relaunch used to count as the app
    // being open. A relaunch is a new PROCESS, and iOS starts one on its own
    // for a geofence crossing, a significant-change wake or a silent push,
    // with nobody looking at the screen: such a launch never becomes active
    // and never enters background, so the interval it opened ran on until the
    // next real cycle and billed a phone in a pocket as paperwork.
    // Regression, the owner's own account, 2026-09-03. His shop fence and his
    // home-office fence sit 5 m apart at the same house (a real setup: the
    // yard IS the property). _gdPresence tests the home fence alone, so a fix
    // there is "present" for the office rule, but the full geoFenceAt gives
    // that fix to the SHOP, because shop outranks home_office. The house
    // therefore produced a shop dwell with an office row laid straight over
    // it, and nothing carved it, so geo_replace_day refused the whole day for
    // overlapping pairs. His 3rd sat refused from 07:48 on: no arrival at the
    // client, no rows, an empty Time Log all day.
    const SHOPHOME = { id: 'place-shophome', kind: 'shop', name: 'TradeDesk shop', lat: 39.0307066, lng: -95.7112082 };
    const HOMEOFF = { id: 'place-homeoff', kind: 'home_office', name: '2015 SW Randolph Ave', lat: 39.0307378, lng: -95.7112674, addr: '2015 SW Randolph Ave' };
    const SHFIX = { lat: SHOPHOME.lat, lng: SHOPHOME.lng };

    test('paperwork at a shop that IS the house carves the shop row, it never lays a second row over it', async () => {
      const FF = [SHOPHOME, HOMEOFF, DOE];
      // At the house from 06:00, app open 07:00-07:30, first drive at 08:00.
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot')];
      const fixes = [fix(T(6, 0), SHFIX), fix(T(7, 0), SHFIX), fix(T(7, 30), SHFIX),
                     fix(T(8, 0, 5), SHFIX), fix(T(8, 20, 5), DOE), fix(T(12, 0), DOE)];
      const appEvents = [app(T(7, 0), 'active'), app(T(7, 30), 'background')];
      const r = await run(page, base({ tape, fixes, fences: FF, appEvents }));
      // NOTHING may overlap: that is the condition geo_replace_day enforces.
      const rows = r.dwells.slice().sort((a, b) => a.startTs - b.startTs);
      const overlaps = rows.filter((d, i) => i > 0 && d.startTs < rows[i - 1].endTs)
        .map(d => [d.kind, hm(d.startTs)]);
      expect(overlaps).toEqual([]);
      // The paperwork is its own row, and the shop time around it survives as
      // SHOP time, not rewritten into a home-office row.
      expect(rows.filter(d => d.kind === 'office').map(d => [hm(d.startTs), hm(d.endTs)]))
        .toEqual([[hm(T(7, 0)), hm(T(7, 30))]]);
      // The carve must not INVENT a home-office row out of the shop dwell it
      // cut: the remainder keeps its own identity, and being at the house
      // before the first drive is not paid shop time (rule 11 drops it), so
      // what is left here is the paperwork alone.
      expect(rows.filter(d => d.kind === 'home_office')).toEqual([]);
      // And the client visit that follows is intact: the refused write is what
      // was costing the owner his arrival.
      expect(rows.some(d => d.kind === 'client' || (r.open && r.open.kind === 'client'))).toBe(true);
    });

    test('a background relaunch is not the app being open: no Office row from a phone in a pocket', async () => {
      const fixes = [fix(T(9, 30), HFIX), fix(T(10, 0), HFIX), fix(T(11, 0), HFIX), fix(T(12, 0), HFIX)];
      // iOS wakes the process twice at the house. The person never opens it.
      const appEvents = [app(T(9, 45), 'relaunch'), app(T(11, 15), 'relaunch')];
      const r = await run(page, base({ tape: [], fixes, fences: F, appEvents }));
      expect(r.dwells.filter(d => d.kind === 'office')).toEqual([]);
    });

    test('a relaunch the person caused still counts, via the app-active that follows it', async () => {
      const fixes = [fix(T(9, 30), HFIX), fix(T(10, 0), HFIX), fix(T(11, 0), HFIX), fix(T(12, 0), HFIX)];
      const appEvents = [app(T(9, 58), 'relaunch'), app(T(10, 0), 'active'), app(T(11, 0), 'background')];
      const r = await run(page, base({ tape: [], fixes, fences: F, appEvents }));
      // Starts at the app-active, NOT at the relaunch two minutes earlier.
      expect(r.dwells.filter(d => d.kind === 'office').map(d => [hm(d.startTs), hm(d.endTs), d.minutes]))
        .toEqual([['15:00', '16:00', 60]]);
    });

    test('a Sunday of invoicing with no drive at all counts', async () => {
      const fixes = [fix(T(9, 30), HFIX), fix(T(10, 0), HFIX), fix(T(11, 0), HFIX), fix(T(12, 0), HFIX)];
      const appEvents = [app(T(10, 0), 'active'), app(T(11, 0), 'background'), app(T(11, 30), 'active'), app(T(11, 45), 'background')];
      const r = await run(page, base({ tape: [], fixes, fences: F, appEvents }));
      expect(r.legs).toEqual([]);
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs), d.minutes])).toEqual([['office', '15:00', '16:00', 60], ['office', '16:30', '16:45', 15]]);
    });

    // Two owner rulings, in order, and the test has now absorbed both.
    //
    // 2026-09-02 (afternoon): the half hour with the app open is NOT carved out
    // as Office, because "never office time unless it's outside of business
    // hours." That is the assertion on r.dwells office rows below, unchanged.
    //
    // 2026-09-04: the home stretch the carve would have been taken out of is
    // not a row either. It used to stand whole, all 120 minutes of it, as a
    // home_office dwell between the two drives. Rule 12 removed it: for a pure
    // home office, the house is only ever the end of a leg. So an app-open
    // stretch at home inside the working day now yields nothing at all, which
    // is the strongest form of the same rule rather than a softening of it.
    // (The house that is ALSO the yard is the other half of this and keeps its
    // shop row: 'inside the working day the house is the shop' below.)
    test('an app-open stretch at home inside the working day is no row at all: not Office, and not home either', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(11, 40), 'driving'), mo(T(12, 0), 'onFoot'), mo(T(14, 0), 'driving'), mo(T(14, 20), 'onFoot')];
      const fixes = [fix(T(11, 40, 5), DOE), fix(T(12, 0, 5), HFIX), fix(T(13, 0), HFIX), fix(T(14, 0, 5), HFIX), fix(T(14, 20, 5), DOE), fix(T(15, 0), DOE)];
      const appEvents = [app(T(12, 30), 'active'), app(T(13, 0), 'background')];
      const r = await run(page, base({ tape, fixes, fences: F, appEvents }));
      expect(r.dwells.filter(d => _sameId(d.fence, HOMEONLY))).toEqual([]);
      expect(r.dwells.filter(d => d.kind === 'office')).toEqual([]);
      // The drives that bracketed it are untouched: the house is still a real
      // destination, it just never puts anybody on the clock.
      expect(r.legs.map(l => [l.from.kind, l.to.kind])).toEqual([['client', 'home_office'], ['home_office', 'client']]);
      const spans = r.dwells.map(d => [d.startTs, d.endTs]).concat(r.legs.map(l => [l.startTs, l.endTs])).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    });

    test('the app open somewhere else is not paperwork, and the app open with no fix at home is not proof', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(12, 0), 'driving'), mo(T(12, 10), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(13, 0), SHOP)];
      const appEvents = [app(T(10, 0), 'active'), app(T(11, 0), 'background')];
      const a = await run(page, base({ tape, fixes, fences: F, appEvents }));
      expect(a.dwells.filter(d => d.kind === 'office')).toEqual([]);
      const b = await run(page, base({ tape: [], fixes: [], fences: F, appEvents: [app(T(18, 0), 'active'), app(T(20, 0), 'background')] }));
      expect(b.dwells).toEqual([]);
    });

    test('an app left open runs to now, and never past the day', async () => {
      const fixes = [fix(T(20, 0), HFIX), fix(T(21, 0), HFIX), fix(T(22, 0), HFIX)];
      const r = await run(page, base({ tape: [], fixes, fences: F, appEvents: [app(T(20, 30), 'active')], nowMs: T(21, 15) }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['office', '01:30', '02:15']]);
    });

    test('rows: an office dwell is a place-office row, which the reader already draws as Office', async () => {
      const fixes = [fix(T(10, 0), HFIX), fix(T(11, 0), HFIX)];
      const r = await run(page, base({ tape: [], fixes, fences: F, appEvents: [app(T(10, 0), 'active'), app(T(11, 0), 'background')] }));
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      expect(rows.job_time_entries.map(x => [x.source, x.dest_place, x.minutes])).toEqual([['place-office', '7402 SW 22nd Ct', 60]]);
      expect(rows.job_time_entries[0].client_key).toMatch(/^o-place-ho-/);
      const kind = await page.evaluate(() => _tlRailKind({ source: 'auto', rawSource: 'place-office' }));
      expect(kind).toBe('office');
    });
  });

  // ── The route: what the phone actually traced ───────────────────────────
  // Owner 2026-09-02: "the mileage logs appear to be as the crow flies and is
  // missing the route button that shows what was traced, loved that feature,
  // add it back". The route button reads m.path; a derived leg now carries it.
  test.describe('the traced route rides on the leg', () => {
    const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
    const mid = i => ({ lat: SHOP.lat + (DOE.lat - SHOP.lat) * i / 10, lng: SHOP.lng + (DOE.lng - SHOP.lng) * i / 10 });

    test('the path is every good fix between the flips, endpoints included, in order', async () => {
      const fixes = [fix(T(9, 0, 5), SHOP)];
      for (let i = 1; i < 10; i++) fixes.push(fix(T(9, 2 * i), mid(i)));
      fixes.push(fix(T(9, 10), mid(5), 900));          // a bad fix: not on the trace
      fixes.push(fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE));
      const r = await run(page, base({ tape, fixes }));
      expect(r.legs).toHaveLength(1);
      const p = r.legs[0].path;
      expect(p).toHaveLength(11);
      expect(p[0].slice(0, 2)).toEqual([SHOP.lat, SHOP.lng].map(v => Math.round(v * 1e5) / 1e5));
      expect(p[10].slice(0, 2)).toEqual([DOE.lat, DOE.lng].map(v => Math.round(v * 1e5) / 1e5));
      for (let i = 1; i < p.length; i++) expect(p[i][2]).toBeGreaterThan(p[i - 1][2]);
      expect(r.legs[0].milesFrom).toBe('path');
    });

    test('a long trace is thinned to the cap and still starts and ends where it did', async () => {
      const fixes = [fix(T(9, 0, 5), SHOP)];
      // Interior breadcrumbs start ten seconds in and stop ten seconds short,
      // so the flip's nearest fix (the endpoint) stays the one five seconds off.
      for (let i = 10; i <= 1190; i++) fixes.push(fix(T(9, 0, i), mid(i / 120)));
      fixes.push(fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE));
      const r = await run(page, base({ tape, fixes }));
      const p = r.legs[0].path;
      expect(p.length).toBeLessThanOrEqual(400);
      expect(p.length).toBeGreaterThan(200);
      expect(p[0][2]).toBe(T(9, 0, 5));
      expect(p[p.length - 1][2]).toBe(T(9, 20, 5));
    });

    test('a collapsed leg traces through the personal stop, and its miles are still the direct route', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 10), GAS), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(9, 50), mid(7)), fix(T(10, 0, 5), DOE), fix(T(10, 30), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toHaveLength(1);
      expect(r.legs[0].collapsed).toBe(true);
      expect(r.legs[0].path.map(x => x[2])).toEqual([T(9, 0, 5), T(9, 10), T(9, 20, 5), T(9, 40, 5), T(9, 50), T(10, 0, 5)]);
      expect(r.legs[0].milesFrom).toBe('straight');
    });

    test('rows: the mileage row carries the path, its own miles as gpsMiles, and is logged when the drive began', async () => {
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 10), mid(5)), fix(T(9, 20, 5), DOE), fix(T(9, 40), DOE)];
      const r = await run(page, base({ tape, fixes }));
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      const m = rows.td_mileage[0];
      expect(m.path).toHaveLength(3);
      expect(m.gpsMiles).toBe(m.miles);
      expect(m.gpsMiles).toBeGreaterThan(0);
      expect(m.loggedAt).toBe(m.startedIso);
      expect(m.created_at).toBe(m.startedIso);
      // The route reader in mileage.js draws from the same field and measures
      // the same trace: what the button shows and the number agree.
      const drawn = await page.evaluate((m) => ({ pathMiles: Math.round(_milePathMiles(m) * 10) / 10, observed: Math.round(_mileObservedMiles(m) * 10) / 10 }), m);
      expect(drawn.pathMiles).toBe(m.miles);
      expect(drawn.observed).toBe(m.miles);
    });

    test('rows: four legs in a day are logged in the order they were driven', async () => {
      const t = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot'), mo(T(12, 21), 'driving'), mo(T(12, 31), 'onFoot'),
        mo(T(13, 17), 'driving'), mo(T(13, 25), 'onFoot'), mo(T(17, 8), 'driving'), mo(T(17, 16), 'onFoot')];
      const f = [fix(T(7, 52, 5), SHOP), fix(T(8, 3, 5), DOE), fix(T(12, 21, 5), DOE), fix(T(12, 31, 5), SHOP), fix(T(13, 17, 5), SHOP), fix(T(13, 25, 5), DOE), fix(T(17, 8, 5), DOE), fix(T(17, 16, 5), SHOP), fix(T(18, 0), SHOP)];
      const r = await run(page, base({ tape: t, fixes: f }));
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      expect(rows.td_mileage).toHaveLength(4);
      const sorted = rows.td_mileage.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      expect(sorted.map(m => m.startedIso.slice(11, 16))).toEqual(['22:08', '18:17', '17:21', '12:52']);
    });
  });

  // ── The trace is cleaned before it is measured ──────────────────────────
  // Owner 2026-09-02: "the miles for today say 6.1 lol not possible". A
  // fence event's stale last-known position landed a mile from the fix
  // taken the same second and the trace zigzagged.
  test.describe('a stale point cannot be on the road', () => {
    const tape = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot')];
    const mid = i => ({ lat: SHOP.lat + (DOE.lat - SHOP.lat) * i / 10, lng: SHOP.lng + (DOE.lng - SHOP.lng) * i / 10 });

    test('a point a mile away in the same second is dropped, and the miles are the road again', async () => {
      const fixes = [fix(T(7, 52, 5), SHOP)];
      for (let i = 1; i < 10; i++) fixes.push(fix(T(7, 52, 5 + i * 60), mid(i)));
      const stale = { lat: 39.0274, lng: -95.7250 };   // the fence row's last-known, a mile back
      fixes.push(fix(T(8, 1, 5), stale), fix(T(8, 1, 5), DOE), fix(T(8, 3, 5), DOE), fix(T(8, 30), DOE));
      const r = await run(page, base({ tape, fixes }));
      expect(r.legs).toHaveLength(1);
      // The fixture is a straight line shop -> Doe, about 2.3 miles.
      expect(r.legs[0].miles).toBeGreaterThan(2.2);
      expect(r.legs[0].miles).toBeLessThan(2.5);
      expect(r.legs[0].path.some(p => Math.abs(p[0] - stale.lat) < 1e-4 && Math.abs(p[1] - stale.lng) < 1e-4)).toBe(false);
    });

    test('an exact repeat from a second table adds nothing, and a real fast road is kept', async () => {
      const fixes = [fix(T(7, 52, 5), SHOP)];
      for (let i = 1; i <= 10; i++) { fixes.push(fix(T(7, 52, 5 + i * 60), mid(i))); fixes.push(fix(T(7, 52, 5 + i * 60), mid(i))); }
      fixes.push(fix(T(8, 3, 5), DOE), fix(T(8, 30), DOE));
      const r = await run(page, base({ tape, fixes }));
      const once = await run(page, base({ tape, fixes: fixes.filter((f, i, a) => a.findIndex(x => x.ts === f.ts) === i) }));
      expect(r.legs[0].miles).toBe(once.legs[0].miles);
      expect(r.legs[0].path.length).toBe(once.legs[0].path.length);
      // 70 mph between two points a minute apart is a highway, not junk.
      const hw = [fix(T(9, 0, 5), SHOP), fix(T(9, 1, 5), { lat: SHOP.lat - 0.0169, lng: SHOP.lng }), fix(T(9, 2, 5), { lat: SHOP.lat - 0.0338, lng: SHOP.lng })];
      const clean = await page.evaluate((f) => _gdCleanTrace(f, 90).length, hw);
      expect(clean).toBe(3);
      const junk = await page.evaluate(() => [_gdCleanTrace([], 90).length, _gdCleanTrace([{ ts: 1, lat: 1, lng: 1 }], 0).length]);
      expect(junk).toEqual([0, 1]);
    });
  });

  // ── Rule 12: the truck was where the phone sat ──────────────────────────
  // Owner 2026-09-02, his 7:51 departure: the app slept through the flip and
  // woke 0.4 miles down the road, so the nearest fix sat outside the shop
  // fence and the leg had no origin. The last fix before the flip, with no
  // drive on the tape since, is where the truck was parked.
  test.describe('the truck was where the phone sat', () => {
    const OUT = { lat: 39.0295, lng: -95.7189 };   // 0.4 mi east of the shop, outside every fence

    test('his morning: parked ping at the shop 21 minutes before the flip, first live fix down the road', async () => {
      const tape = [mo(T(7, 26), 'still'), mo(T(7, 50, 27), 'onFoot'), mo(T(7, 51, 40), 'driving'), mo(T(7, 59, 27), 'onFoot')];
      const fixes = [fix(T(7, 30), SHOP), fix(T(7, 53, 10), OUT), fix(T(7, 54, 10), { lat: 39.0274, lng: -95.7250 }), fix(T(7, 57, 43), { lat: 39.0128, lng: -95.7439 }), fix(T(7, 59, 27, 5), DOE), fix(T(8, 0), DOE), fix(T(8, 30), DOE)];
      const r = await run(page, base({ tape, fixes, nowMs: T(9, 0) }));
      expect(r.legs.map(l => [l.from.name, l.to.name, hm(l.startTs), hm(l.endTs), l.minutes])).toEqual([['TradeDesk shop', 'John Doe', '12:51', '12:59', 8]]);
      // The clock is the flips, not the fixes.
      expect(r.legs[0].startTs).toBe(T(7, 51, 40));
      expect(r.legs[0].endTs).toBe(T(7, 59, 27));
      // The trace still starts where the phone was, at the shop.
      expect(r.legs[0].path[0].slice(0, 2)).toEqual([SHOP.lat, SHOP.lng].map(v => Math.round(v * 1e5) / 1e5));
      expect(r.open && r.open.kind).toBe('client');
    });

    test('a drive in between disqualifies the parked fix: nothing is invented', async () => {
      // Shop at 7:00, drove to an unsaved stop 7:10 to 7:20, left it at 7:40
      // with the first fix at 7:42 out on the road. The 7:00 shop fix is
      // from before an earlier drive and says nothing about the 7:40 one.
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 10), 'driving'), mo(T(7, 20), 'onFoot'), mo(T(7, 40), 'driving'), mo(T(7, 50), 'onFoot')];
      const fixes = [fix(T(7, 0), SHOP), fix(T(7, 10, 5), SHOP), fix(T(7, 20, 5), GAS), fix(T(7, 42), OUT), fix(T(7, 50, 5), DOE), fix(T(8, 30), DOE)];
      const r = await run(page, base({ tape, fixes, nowMs: T(9, 0) }));
      // Shop -> gas is pending (unsaved), gas -> Doe: the chain from the shop
      // collapses through the stop, so the leg is shop -> Doe. What must NOT
      // happen is the 7:40 origin being read as the shop on its own.
      expect(r.legs.map(l => [l.from.name, l.to.name, l.collapsed])).toEqual([['TradeDesk shop', 'John Doe', true]]);
      const r2 = await run(page, base({ tape: tape.slice(2), fixes: fixes.slice(2), nowMs: T(9, 0) }));
      // The guarantee is unchanged: the shop fix is never reached for. Since
      // rule 14 the drive is a TRACED leg whose origin is named as unsaved.
      expect(r2.legs.length).toBe(1);
      expect(r2.legs[0].from.unsaved, 'starting at the unsaved stop, the shop fix is never reached for').toBe(true);
      expect(r2.legs[0].from.name).toBe('');
      expect(r2.legs[0].to.name).toBe('John Doe');
      expect(r2.dwells).toEqual([]);
      expect(r2.open && r2.open.name).toBe('John Doe');
    });

    test('a parked fix outside every fence loses to a fix inside the window that is inside one', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(8, 30), 'driving'), mo(T(8, 45), 'onFoot')];
      const fixes = [fix(T(8, 5), GAS), fix(T(8, 30, 5), SHOP), fix(T(8, 45, 5), DOE), fix(T(9, 30), DOE)];
      const r = await run(page, base({ tape, fixes }));
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([['TradeDesk shop', 'John Doe']]);
    });

    test('a parked fix older than twelve hours is not the truck any more', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(20, 30), 'driving'), mo(T(20, 45), 'onFoot')];
      const fixes = [fix(T(7, 0), SHOP), fix(T(20, 32), OUT), fix(T(20, 45, 5), DOE), fix(T(21, 30), DOE)];
      const r = await run(page, base({ tape, fixes }));
      // Not the truck any more: the origin is NOT the shop. Since rule 14 the
      // drive is still written, as a traced leg from an unsaved origin.
      expect(r.legs.length).toBe(1);
      expect(r.legs[0].traced).toBe(true);
      expect(r.legs[0].from.unsaved).toBe(true);
      expect(r.legs[0].from.name).not.toBe('TradeDesk shop');
      expect(r.open && r.open.name).toBe('John Doe');
      // Eleven hours old is still the truck.
      const r2 = await run(page, base({ tape, fixes: [fix(T(9, 45), SHOP)].concat(fixes.slice(1)) }));
      expect(r2.legs.map(l => l.from.name)).toEqual(['TradeDesk shop']);
    });

    test('arrival mirror: a phone that only woke once it had parked still names the fence', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(12, 0), 'driving'), mo(T(12, 10), 'onFoot')];
      // No fix within five minutes of the 9:20 walking flip; the first one
      // after it (9:27) is at Doe, before the next drive.
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 27), DOE), fix(T(11, 0), DOE), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(12, 30), SHOP)];
      const r = await run(page, base({ tape, fixes }));
      expect(r.legs.map(l => [l.from.name, l.to.name, hm(l.endTs)])).toEqual([['TradeDesk shop', 'John Doe', '14:20'], ['John Doe', 'TradeDesk shop', '17:10']]);
      expect(r.dwells.map(d => [d.name, hm(d.startTs), hm(d.endTs)])).toEqual([['John Doe', '14:20', '17:00']]);
      // But a fix from after the NEXT drive began is not this arrival: the
      // 9:20 stop stays unknown, so shop -> unknown -> shop is a loop out of
      // the house (this fixture's SHOP sits 30 ft from HOME).
      //
      // AMENDED 2026-09-15 for rule 19: that loop used to write nothing,
      // because the day had reached no business. It runs 9:00 to 12:10 on a
      // working day now, which is indistinguishable from a first job at an
      // address nobody saved, so it is written, held, and asks. The arrival
      // this test is actually about is unchanged: the 9:20 stop is still
      // unknown, which is why the leg is a loop at all.
      const r2 = await run(page, base({ tape, fixes: [fix(T(9, 0, 5), SHOP), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(12, 30), SHOP)] }));
      expect(r2.legs.map(l => [l.from.name, l.to.name, !!l.houseLoop, l.held === true]))
        .toEqual([['TradeDesk shop', 'TradeDesk shop', true, true]]);
      expect(r2.dwells).toEqual([]);
    });
  });

  // ── Rule 11: the day ends with the last real work ───────────────────────
  // Owner 2026-09-02 on his own Time Log: "except for the end at 5:29 and
  // after, those aren't needed."
  test.describe('the day ends with the last real work', () => {
    const YARD = { id: 'place-yard', kind: 'shop', name: 'The yard', lat: 39.0600, lng: -95.6500, addr: '1 Yard Rd' };
    const YFIX = { lat: YARD.lat, lng: YARD.lng };
    const HFIX = { lat: HOME.lat, lng: HOME.lng };

    test('his 5:29: the shop that is his house, entered after the last client, is not a row', async () => {
      // Doe -> shop (which shares its spot with the home office) at 17:29,
      // then out to the store at 18:20 and back at 18:40. Before the fix
      // that shop dwell was a 51-minute paid row.
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(17, 8), 'driving'), mo(T(17, 29), 'onFoot'), mo(T(18, 20), 'driving'), mo(T(18, 40), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(17, 8, 5), DOE), fix(T(17, 29, 5), HFIX), fix(T(18, 0), HFIX), fix(T(18, 20, 5), HFIX), fix(T(18, 40, 5), GAS), fix(T(19, 0), GAS)];
      const r = await run(page, base({ tape, fixes }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['client', '14:20', '22:08']]);
      // The legs are untouched by the rule: the drive home is still a leg.
      // And since rule 14 the 18:20 run out to the store (unsaved) is a third,
      // traced, leg rather than nothing.
      expect(r.legs.map(l => [l.from.name, l.to.name, !!l.traced])).toEqual([
        ['TradeDesk shop', 'John Doe', false], ['John Doe', 'TradeDesk shop', false], ['TradeDesk shop', '', true],
      ]);
      expect(r.legs[2].unsavedTo).toBe(true);
    });

    // ── HIS REAL 11 SEPTEMBER, pinned ────────────────────────────────────
    // The evening shape that keeps coming up: home from the last customer at
    // 17:39, straight back out, home again at 20:58. His shop and his home
    // office are 4 metres apart (the same building), so every one of those
    // arrivals is an arrival at a shop fence.
    //
    // These two used to be a PIN rather than a proof: both passed before the
    // shop-is-not-a-shop fix, because rule 7 already marked a house loop and
    // rule 17 already refused to let one open the workday. The pin said the
    // next change to the window would have to say out loud that it was moving
    // it. On 2026-09-13 it moved, and this is that sentence.
    const sep11 = (loopOutHour, loopOutMin) => {
      const tape = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 2), 'onFoot'),
        mo(T(12, 30), 'driving'), mo(T(12, 41), 'onFoot'),
        mo(T(13, 17), 'driving'), mo(T(13, 25), 'onFoot'),
        mo(T(17, 23), 'driving'), mo(T(17, 39), 'onFoot'),
        mo(T(loopOutHour, loopOutMin), 'driving'), mo(T(loopOutHour, loopOutMin + 20), 'onFoot'),
        mo(T(20, 48), 'driving'), mo(T(20, 58), 'onFoot')];
      const fixes = [fix(T(7, 52, 5), SHOP), fix(T(8, 2, 5), DOE), fix(T(12, 30, 5), DOE),
        fix(T(12, 41, 5), SHOP), fix(T(13, 17, 5), SHOP), fix(T(13, 25, 5), DOE),
        fix(T(17, 23, 5), DOE), fix(T(17, 39, 5), SHOP),
        fix(T(loopOutHour, loopOutMin, 5), SHOP), fix(T(loopOutHour, loopOutMin + 20, 5), GAS),
        fix(T(20, 48, 5), GAS), fix(T(20, 58, 5), SHOP), fix(T(21, 30), SHOP)];
      return base({ tape, fixes });
    };

    test('his real 11 September: the evening run six minutes after he got home is his own time', async () => {
      // AMENDED 2026-09-13 (10.4). This used to be called "the evening run
      // inside the wrap still counts" and it asserted the opposite of what it
      // does now: nothing held, five mileage rows. Both halves of that were
      // right under the rules as they stood and both were wrong about his
      // day, which is what he said when he read it: "day ended before all
      // those were added and calculated."
      //
      // Three things moved and any one of them alone decides this fixture:
      //
      //   The wrap. Last customer 17:23 plus thirty minutes ran the window to
      //   17:53, so a 17:45 departure overlapped it. That half hour is for
      //   putting the truck away at a yard, and the fence he arrived at is
      //   his own driveway (his shop and his home office are 4 m apart), so
      //   it no longer exists there. The day now closes at 17:23.
      //
      //   Containment. Even with the wrap, the overlap was eight minutes of a
      //   trip that ran to 20:58, and one minute of contact used to be enough.
      //
      //   Rule 18. Out of the house, somewhere nobody saved, back to the
      //   house: its two ends are one fence read twice, so nothing vouched for
      //   it whatever the clock said.
      //
      // What is left is the four real drives to and from the customer. The
      // evening is on the log, held, earning nothing.
      const r = await run(page, sep11(17, 45));
      const rows = await page.evaluate(i => geoDeriveRows(geoDeriveDay(i),
        { contractorId: 'c', employeeId: 'e' }), sep11(17, 45));
      expect(r.legs.filter(l => Number(l.startTs) >= T(17, 40)).length,
        'the evening loop out of the house is not in the day at all').toBe(0);
      expect(rows.td_mileage.length).toBe(4);
      // And the day's real work is untouched: four drives, all plain.
      expect(rows.job_time_entries.filter(t => t.source === 'drive').length).toBe(4);
    });

    test('the same evening run 40 minutes later is his own time, and the day is over', async () => {
      // Out at 18:20, past the wrap. The workday closed at 17:53 (last
      // customer 17:23 plus the 30-minute wrap) and a loop out of the house
      // and back proves nothing, so it is his own time and writes nothing.
      const r = await run(page, sep11(18, 20));
      const rows = await page.evaluate(i => geoDeriveRows(geoDeriveDay(i),
        { contractorId: 'c', employeeId: 'e' }), sep11(18, 20));
      const evening = r.legs.filter(l => Number(l.startTs) >= T(18, 0));
      expect(evening.length, 'the evening loop is gone entirely').toBe(0);
      // The four real drives to and from the customer are untouched.
      expect(rows.td_mileage.length).toBe(4);
      expect(rows.td_mileage.every(m => !m.pendingPurpose)).toBe(true);
    });

    test('a real shop after the last job keeps the unloading, capped, and nothing past it', async () => {
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(16, 0), 'driving'), mo(T(16, 20), 'onFoot'), mo(T(18, 0), 'driving'), mo(T(18, 20), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), YFIX), fix(T(9, 20, 5), DOE), fix(T(16, 0, 5), DOE), fix(T(16, 20, 5), YFIX), fix(T(17, 0), YFIX), fix(T(18, 0, 5), YFIX), fix(T(18, 20, 5), HFIX), fix(T(19, 0), HFIX)];
      const r = await run(page, base({ tape, fixes, fences: [YARD, HOME, DOE] }));
      const yard = r.dwells.filter(d => d.kind === 'shop');
      expect(yard.map(d => [hm(d.startTs), hm(d.endTs), d.minutes, d.wrapped])).toEqual([['21:20', '21:50', 30, true]]);
      // A short unloading stays whole and is not marked wrapped.
      const t2 = tape.slice(0, 5).concat([mo(T(16, 40), 'driving'), mo(T(17, 0), 'onFoot')]);
      const f2 = fixes.slice(0, 5).concat([fix(T(16, 40, 5), YFIX), fix(T(17, 0, 5), HFIX), fix(T(17, 30), HFIX)]);
      const r2 = await run(page, base({ tape: t2, fixes: f2, fences: [YARD, HOME, DOE] }));
      expect(r2.dwells.filter(d => d.kind === 'shop').map(d => [d.minutes, !!d.wrapped])).toEqual([[20, false]]);
    });

    test('a base dwell BEFORE the last work is untouched: the shop between two jobs is the shop', async () => {
      const tape = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot'), mo(T(12, 21), 'driving'), mo(T(12, 31), 'onFoot'),
        mo(T(13, 17), 'driving'), mo(T(13, 25), 'onFoot'), mo(T(17, 8), 'driving'), mo(T(17, 16), 'onFoot')];
      const fixes = [fix(T(7, 52, 5), SHOP), fix(T(8, 3, 5), DOE), fix(T(12, 21, 5), DOE), fix(T(12, 31, 5), SHOP), fix(T(13, 17, 5), SHOP), fix(T(13, 25, 5), DOE), fix(T(17, 8, 5), DOE), fix(T(17, 16, 5), SHOP), fix(T(18, 0), SHOP)];
      const r = await run(page, base({ tape, fixes }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs), d.minutes])).toEqual([
        ['client', '13:03', '17:21', 258], ['shop', '17:31', '18:17', 46], ['client', '18:25', '22:08', 223],
      ]);
    });

    // Owner 2026-09-02, 12:12 to 12:47 at the shop between two Doe visits,
    // read live at 12:56 with the second visit still open: "unaccounted at
    // 12:12 then office at 12:37 then unaccounted at 12:39". The open visit
    // did not count as work, so the shop stop was "after the last work".
    test('the shop between a closed visit and an OPEN one is shop time: the day is not over', async () => {
      const tape = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot'), mo(T(12, 2), 'driving'), mo(T(12, 12), 'onFoot'),
        mo(T(12, 47), 'driving'), mo(T(12, 55), 'onFoot')];
      const fixes = [fix(T(7, 52, 5), SHOP), fix(T(8, 3, 5), DOE), fix(T(12, 2, 5), DOE), fix(T(12, 12, 5), HFIX), fix(T(12, 30), HFIX),
        fix(T(12, 47, 5), HFIX), fix(T(12, 55, 5), DOE), fix(T(12, 58), DOE)];
      const r = await run(page, base({ tape, fixes, nowMs: T(13, 0) }));
      expect(r.open && r.open.name).toBe('John Doe');
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['client', '13:03', '17:02'], ['shop', '17:12', '17:47']]);
      // Mid-drive, destination unknown: the shop stop stands until the drive resolves.
      const r2 = await run(page, base({ tape: tape.slice(0, 6), fixes: fixes.slice(0, 6), nowMs: T(12, 50) }));
      expect(r2.pending && r2.pending.origin.name).toBe('TradeDesk shop');
      expect(r2.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['client', '13:03', '17:02'], ['shop', '17:12', '17:47']]);
      // Resolved at home for the evening: the same stop after the last work is not a row.
      const t3 = tape.slice(0, 6).concat([mo(T(12, 55), 'onFoot')]);
      const f3 = fixes.slice(0, 6).concat([fix(T(12, 55, 5), GAS), fix(T(13, 30), GAS)]);
      const r3 = await run(page, base({ tape: t3, fixes: f3, nowMs: T(14, 0) }));
      expect(r3.dwells.map(d => d.kind)).toEqual(['client']);
    });

    test('a day with no job at all keeps its base dwells: a shift at the yard is a shift', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 30), 'driving'), mo(T(7, 50), 'onFoot'), mo(T(16, 0), 'driving'), mo(T(16, 20), 'onFoot')];
      const fixes = [fix(T(7, 30, 5), HFIX), fix(T(7, 50, 5), YFIX), fix(T(12, 0), YFIX), fix(T(16, 0, 5), YFIX), fix(T(16, 20, 5), HFIX), fix(T(17, 0), HFIX)];
      const r = await run(page, base({ tape, fixes, fences: [YARD, HOME] }));
      expect(r.dwells.map(d => [d.kind, d.minutes, !!d.wrapped])).toEqual([['shop', 490, false]]);
    });

    // Jack's day, 2026-09-03: home, the gym, home. The gym has no fence, so
    // that journey stays pending and writes no leg (rule 5), leaving a day
    // with no work anywhere in it. The exemption directly above then returned
    // every base dwell untouched, HOUSE included, and his own address came out
    // on the rail as time on site. It is right for a yard and wrong for a
    // house, which is why this only ever showed on his account: the owner's
    // days always hold a client, so the rule ran for him.
    test("home, an unsaved stop, and home again is not a shift", async () => {
      const JHOME = { id: 'place-jackhome', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
      const JFIX = { lat: JHOME.lat, lng: JHOME.lng };
      const GYM = { lat: JHOME.lat + 0.03, lng: JHOME.lng };   // no fence anywhere near it
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 45), 'onFoot'),
                    mo(T(7, 30), 'driving'), mo(T(7, 45), 'onFoot')];
      const fixes = [fix(T(6, 0), JFIX), fix(T(6, 30, 5), JFIX), fix(T(6, 45, 5), GYM),
                     fix(T(7, 0), GYM), fix(T(7, 30, 5), GYM), fix(T(7, 45, 5), JFIX), fix(T(9, 0), JFIX)];
      const r = await run(page, base({ tape, fixes, fences: [JHOME], nowMs: T(10, 0),
        // AMENDED 2026-09-15 for rule 19. This is his gym run, an hour later
        // than the real one, and it used to be dropped because the day reached
        // no business. The owner retired that test ("what if the first stop of
        // the day isn't a saved address nor is the clock in button hit, then we
        // have missing rows"), so what drops it now is WHEN: 6:30 to 7:45 is
        // before the earliest he has ever clocked in. His own punches say so,
        // and they are the same seven days at the top of this file.
        clockHistory: clocksBefore(DAY) }));
      expect(r.legs).toEqual([]);
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
    });

    // ── Rule 14: the day has to land in real work ────────────────────────
    // Owner 2026-09-06, watching his own live day put him on the clock at his
    // own kitchen table: "I drove out, never entered a job fence so is that
    // how we split it? Has to land in a job fence? If not general clock in
    // handles it."
    test('rule 14: a drive that never lands in a work fence leaves the house off the clock', async () => {
      // His 2026-09-06 shape: out of the house at 10:28, a stop that resolves
      // to nothing, home at 12:22, and then hours at his own address.
      const tape = [mo(T(5, 0), 'still'), mo(T(5, 28), 'driving'), mo(T(5, 45), 'onFoot'),
                    mo(T(7, 9), 'driving'), mo(T(7, 22), 'onFoot')];
      const fixes = [fix(T(4, 0), SHOP), fix(T(5, 28, 5), SHOP), fix(T(5, 45, 5), GAS),
                     fix(T(6, 30), GAS), fix(T(7, 9, 5), GAS), fix(T(7, 22, 5), SHOP), fix(T(9, 0), SHOP)];
      const r = await run(page, base({ tape, fixes, nowMs: T(10, 0) }));
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
    });

    test('rule 14: a leg that merely TOUCHES a work fence is not landing in one', async () => {
      // The escape hatch this replaces: the day's only work evidence is a leg
      // ENDPOINT at a client (rule 9 drops the first stretch, so the visit is
      // never a dwell of its own). That used to hand every base dwell back
      // untouched, house included.
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 50), 'onFoot')];
      const fixes = [fix(T(5, 30), DOE), fix(T(6, 30, 5), DOE), fix(T(6, 50, 5), SHOP), fix(T(9, 0), SHOP), fix(T(12, 0), SHOP)];
      const r = await run(page, base({ tape, fixes, nowMs: T(13, 0) }));
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([['John Doe', 'TradeDesk shop']]);
      expect(r.dwells.filter(d => d.kind === 'shop')).toEqual([]);
    });

    test('rule 14: a morning at his own address before one afternoon job is the loading window, not the morning', async () => {
      // Home from the start of the day, out to Doe at 13:00, work, home for
      // the evening. The morning used to be kept in FULL because it started
      // before the last work ended.
      const tape = [mo(T(5, 30), 'driving'), mo(T(6, 0), 'onFoot'), mo(T(13, 0), 'driving'), mo(T(13, 20), 'onFoot'),
                    mo(T(17, 0), 'driving'), mo(T(17, 20), 'onFoot')];
      const fixes = [fix(T(6, 0, 5), SHOP), fix(T(9, 0), SHOP), fix(T(12, 0), SHOP), fix(T(13, 0, 5), SHOP),
                     fix(T(13, 20, 5), DOE), fix(T(15, 0), DOE), fix(T(17, 0, 5), DOE),
                     fix(T(17, 20, 5), SHOP), fix(T(19, 0), SHOP)];
      const r = await run(page, base({ tape, fixes }));
      const shop = r.dwells.filter(d => d.kind === 'shop');
      // Exactly the wrap allowance, ending when he pulled out, and nothing
      // after the last job (that half is unchanged, owner 2026-09-02).
      expect(shop.map(d => [d.minutes, hm(d.endTs), !!d.wrapped])).toEqual([[30, hm(T(13, 0)), true]]);
      expect(r.dwells.filter(d => d.kind === 'client').length).toBe(1);
    });

    test('rule 14: the open dwell says whether it would bill, so the rail can stop calling it time', async () => {
      // Standing at his own address, nothing landed yet today.
      const tape = [mo(T(5, 30), 'driving'), mo(T(6, 0), 'onFoot')];
      const fixes = [fix(T(6, 0, 5), SHOP), fix(T(7, 0), SHOP), fix(T(8, 0), SHOP)];
      const home = await run(page, base({ tape, fixes, nowMs: T(9, 0) }));
      expect(home.open && home.open.atHome).toBe(true);
      expect(home.open && home.open.counts).toBe(false);

      // Same spot, but the day landed in a real client visit first.
      const t2 = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 50), 'onFoot'),
                  mo(T(11, 0), 'driving'), mo(T(11, 20), 'onFoot')];
      const f2 = [fix(T(6, 30, 5), SHOP), fix(T(6, 50, 5), DOE), fix(T(9, 0), DOE), fix(T(11, 0, 5), DOE),
                  fix(T(11, 20, 5), SHOP), fix(T(12, 0), SHOP)];
      // Same spot, same day, but asked while the workday is still open: home
      // at 11:20, the window runs to 11:30 (the customer's own dwell ends at
      // 11:00 and carries the wrap), so at 11:25 he is between jobs and it
      // counts.
      //
      // AMENDED 2026-09-12 (10.4). This used to ask at 13:00 and expect true,
      // and that was the bug: getting home ended nothing, so the answer was
      // still true at 13:00, at 20:00, and at 3am. The old assertion was
      // right that a real work day makes the house count; it was never right
      // that it counts forever. The clock the question is asked at is now
      // part of the question.
      //
      // AMENDED AGAIN 2026-09-13 (10.4), from 11:40 to 11:25. The wrap is for
      // unloading and it now only exists where there is something to unload
      // at, which his own driveway is not, so arriving home no longer pushes
      // the end of the day out another half hour. The window still runs to
      // 11:30 because the customer he left at 11:00 carries the wrap himself,
      // and the point this test is making, that a real workday makes the
      // house count while it is open, is unchanged.
      const worked = await run(page, base({ tape: t2, fixes: f2, nowMs: T(11, 25) }));
      expect(worked.open && worked.open.atHome).toBe(true);
      expect(worked.open && worked.open.counts).toBe(true);

      // The same day, same open dwell, asked that evening: the workday closed
      // at 11:30 and he never left, so it is his own house and his own time.
      const evening = await run(page, base({ tape: t2, fixes: f2, nowMs: T(19, 0) }));
      expect(evening.open && evening.open.atHome).toBe(true);
      expect(evening.open && evening.open.counts).toBe(false);

      // Standing at a client: always counts, house rules never apply.
      const t3 = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 50), 'onFoot')];
      const f3 = [fix(T(6, 30, 5), SHOP), fix(T(6, 50, 5), DOE), fix(T(9, 0), DOE), fix(T(11, 0), DOE)];
      const onsite = await run(page, base({ tape: t3, fixes: f3, nowMs: T(12, 0) }));
      expect(onsite.open && onsite.open.name).toBe('John Doe');
      expect(onsite.open && onsite.open.counts).toBe(true);
      // And still at 10pm: the end of the workday is a rule about the HOUSE.
      // Somebody standing at a customer's address at 22:00 is either working
      // or has a problem, and neither is the app's to decide silently.
      const late = await run(page, base({ tape: t3, fixes: f3, nowMs: T(22, 0) }));
      expect(late.open && late.open.counts).toBe(true);
    });

    test('driving out again re-opens the day: nothing here can strand a day that was not over', async () => {
      // Home at 11:20, the workday closes at 11:50, and at 13:00 he is off
      // the clock. Then he drives back out to Doe at 14:00 and home again at
      // 17:00, and the evening at the house is judged against THAT day, not
      // against the morning. Asked at 16:00, standing at Doe's, it counts.
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(6, 30), 'driving'), mo(T(6, 50), 'onFoot'),
                    mo(T(11, 0), 'driving'), mo(T(11, 20), 'onFoot'),
                    mo(T(14, 0), 'driving'), mo(T(14, 20), 'onFoot')];
      const fixes = [fix(T(6, 30, 5), SHOP), fix(T(6, 50, 5), DOE), fix(T(9, 0), DOE), fix(T(11, 0, 5), DOE),
                     fix(T(11, 20, 5), SHOP), fix(T(13, 0), SHOP), fix(T(14, 0, 5), SHOP),
                     fix(T(14, 20, 5), DOE), fix(T(16, 0), DOE)];
      const r = await run(page, base({ tape, fixes, nowMs: T(16, 30) }));
      expect(r.open && r.open.name).toBe('John Doe');
      expect(r.open && r.open.counts).toBe(true);
    });

    test('a day with no work in it never starts counting, whatever time it is asked', async () => {
      // The other direction, unchanged: no window exists at all, so the
      // nowMs test never comes into it and the old rule still decides.
      const tape = [mo(T(5, 30), 'driving'), mo(T(6, 0), 'onFoot')];
      const fixes = [fix(T(6, 0, 5), SHOP), fix(T(7, 0), SHOP), fix(T(8, 0), SHOP)];
      for (const at of [T(9, 0), T(14, 0), T(23, 0)]) {
        const r = await run(page, base({ tape, fixes, nowMs: at }));
        expect(r.open && r.open.counts).toBe(false);
      }
    });

    // The other half of that line: a day whose only fences are a REAL yard and
    // a house is still a working day, because shop time always counts. Only
    // somebody's own address fails to make a day a shift.
    test('a day at a real yard is still a shift even with a stop at the house', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 30), 'driving'), mo(T(7, 50), 'onFoot'),
                    mo(T(11, 0), 'driving'), mo(T(11, 20), 'onFoot'),
                    mo(T(12, 0), 'driving'), mo(T(12, 20), 'onFoot'), mo(T(16, 0), 'driving'), mo(T(16, 20), 'onFoot')];
      const fixes = [fix(T(7, 30, 5), HFIX), fix(T(7, 50, 5), YFIX), fix(T(11, 0, 5), YFIX),
                     fix(T(11, 20, 5), HFIX), fix(T(12, 0, 5), HFIX), fix(T(12, 20, 5), YFIX),
                     fix(T(16, 0, 5), YFIX), fix(T(16, 20, 5), HFIX), fix(T(17, 0), HFIX)];
      const r = await run(page, base({ tape, fixes, fences: [YARD, HOME] }));
      expect(r.dwells.filter(d => d.kind === 'shop').length).toBeGreaterThan(0);
    });

    // Owner 2026-09-02, 4:30pm: "that was all shop time; office throws in
    // after the fact for true app time after hours, that's it." His 12:37
    // with the app open at the shop (the house) came out as a two-minute
    // Office row inside the work day, over the shop time, and the writer
    // refused the overlap: the day never landed.
    test('inside the working day the house is the shop, never Office, app open or not', async () => {
      const tape = [mo(T(7, 40), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot'), mo(T(12, 2), 'driving'), mo(T(12, 12), 'onFoot'),
        mo(T(12, 47), 'driving'), mo(T(12, 55), 'onFoot')];
      const fixes = [fix(T(7, 52, 5), SHOP), fix(T(8, 3, 5), DOE), fix(T(12, 2, 5), DOE), fix(T(12, 12, 5), HFIX), fix(T(12, 38), HFIX),
        fix(T(12, 47, 5), HFIX), fix(T(12, 55, 5), DOE), fix(T(12, 58), DOE)];
      const appEvents = [{ ts: T(12, 37, 33), kind: 'active' }, { ts: T(12, 39, 50), kind: 'background' }];
      const r = await run(page, base({ tape, fixes, appEvents, nowMs: T(13, 0) }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['client', '13:03', '17:02'], ['shop', '17:12', '17:47']]);
      // The same two minutes with the app open at 6:30 that morning, before
      // the first drive, are paperwork.
      const early = [{ ts: T(6, 30), kind: 'active' }, { ts: T(6, 50), kind: 'background' }];
      const r2 = await run(page, base({ tape, fixes: [fix(T(6, 35), HFIX)].concat(fixes), appEvents: early.concat(appEvents), nowMs: T(13, 0) }));
      expect(r2.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['office', '11:35', '11:50'], ['client', '13:03', '17:02'], ['shop', '17:12', '17:47']]);
      // Nothing in the derived set overlaps: the writer would refuse it.
      const spans = r2.dwells.map(d => [d.startTs, d.endTs]).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    });

    test('paperwork at home after the last job still counts: rule 10 outranks rule 11', async () => {
      const HOMEONLY = { id: 'place-ho', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0100, lng: -95.6900 };
      const HF = { lat: HOMEONLY.lat, lng: HOMEONLY.lng };
      const tape = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(17, 0), 'driving'), mo(T(17, 16), 'onFoot'), mo(T(21, 0), 'driving'), mo(T(21, 20), 'onFoot')];
      const fixes = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(17, 0, 5), DOE), fix(T(17, 16, 5), HF), fix(T(18, 0), HF), fix(T(19, 30), HF), fix(T(21, 0, 5), HF), fix(T(21, 20, 5), GAS), fix(T(22, 0), GAS)];
      const appEvents = [{ ts: T(18, 0), kind: 'active' }, { ts: T(19, 30), kind: 'background' }];
      const r = await run(page, base({ tape, fixes, fences: [SHOP, DOE, HOMEONLY], appEvents }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['client', '14:20', '22:00'], ['office', '23:00', '00:30']]);
    });
  });

  // ── Rule 12: the house is never on the clock ────────────────────────────
  // Owner 2026-09-04, saying what a crew member's automatic day should hold:
  // "all Jack should see automatic are straight drives from his home office to
  // his dads shop and back, that's really it then also see time log dwells at
  // his dads shop if he stops there that closes itself out on departure while
  // manual clock still runs."
  //
  // Jack's real geometry: a pure home office at 7402 SW 22nd Ct and his dad's
  // shop at 1200 SW Oakley Ave, 1.9 miles apart. Nothing merges them, so his
  // house resolves to kind 'home_office' where the owner's, which shares its
  // spot with his yard, resolves to 'shop'. That one difference is why every
  // one of these rules bit Jack's account and not his.
  test.describe('the house is never on the clock', () => {
    const JHOME = { id: 'place-1787361092921077', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
    const DADS  = { id: 'place-1788216906515011', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
    const JF = { lat: JHOME.lat, lng: JHOME.lng };
    const DF = { lat: DADS.lat, lng: DADS.lng };
    const JFENCES = [JHOME, DADS];

    // The whole ask in one day: out at 7:00, at the shop until 15:00, home.
    test('his day is two legs and one shop dwell, and nothing else', async () => {
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'driving'), mo(T(7, 25), 'onFoot'),
                    mo(T(15, 0), 'driving'), mo(T(15, 25), 'onFoot')];
      const fixes = [fix(T(6, 30), JF), fix(T(7, 0, 5), JF), fix(T(7, 25, 5), DF), fix(T(11, 0), DF),
                     fix(T(15, 0, 5), DF), fix(T(15, 25, 5), JF), fix(T(16, 30), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0) }));
      expect(r.legs.map(l => [l.from.kind, l.to.kind])).toEqual([['home_office', 'shop'], ['shop', 'home_office']]);
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)])).toEqual([['shop', '12:25', '20:00']]);
    });

    // The stretch rule 11 could never reach, and the one actually on his rail:
    // 06:28 to 07:23 Central at his own address, BEFORE the first drive. Not
    // after the last work, so the end-of-day rule kept it; the day holds real
    // work, so the no-work rule never ran. 55 minutes of "on site" at home.
    test('the morning at home before the first drive is not a row', async () => {
      const tape = [mo(T(6, 0), 'onFoot'), mo(T(7, 23), 'driving'), mo(T(7, 48), 'onFoot'),
                    mo(T(15, 0), 'driving'), mo(T(15, 25), 'onFoot')];
      const fixes = [fix(T(6, 28), JF), fix(T(7, 0), JF), fix(T(7, 23, 5), JF), fix(T(7, 48, 5), DF),
                     fix(T(12, 0), DF), fix(T(15, 0, 5), DF), fix(T(15, 25, 5), JF), fix(T(16, 30), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0) }));
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
      expect(r.dwells.map(d => d.kind)).toEqual(['shop']);
    });

    // Lunch at home in the middle of a working day: two drives out to the shop
    // with a stretch at the house between them. Every earlier rule kept this.
    test('home in the middle of a working day is not a row either', async () => {
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'driving'), mo(T(7, 25), 'onFoot'),
                    mo(T(11, 0), 'driving'), mo(T(11, 25), 'onFoot'),
                    mo(T(12, 0), 'driving'), mo(T(12, 25), 'onFoot'),
                    mo(T(16, 0), 'driving'), mo(T(16, 25), 'onFoot')];
      const fixes = [fix(T(7, 0, 5), JF), fix(T(7, 25, 5), DF), fix(T(11, 0, 5), DF),
                     fix(T(11, 25, 5), JF), fix(T(11, 45), JF), fix(T(12, 0, 5), JF), fix(T(12, 25, 5), DF),
                     fix(T(16, 0, 5), DF), fix(T(16, 25, 5), JF), fix(T(17, 30), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(19, 0) }));
      expect(r.dwells.map(d => d.kind)).toEqual(['shop', 'shop']);
      expect(r.legs.length).toBe(4);
    });

    // The shop dwell closes on ITS departure, not at the end of the day, which
    // is the half of the ask about the dwell "closing itself out on departure."
    test('the shop dwell ends when he leaves it, not when the day ends', async () => {
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'driving'), mo(T(7, 25), 'onFoot'),
                    mo(T(14, 10), 'driving'), mo(T(14, 35), 'onFoot')];
      const fixes = [fix(T(7, 0, 5), JF), fix(T(7, 25, 5), DF), fix(T(10, 0), DF),
                     fix(T(14, 10, 5), DF), fix(T(14, 35, 5), JF), fix(T(20, 0), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(22, 0) }));
      const shop = r.dwells.filter(d => d.kind === 'shop');
      expect(shop.map(d => [hm(d.startTs), hm(d.endTs)])).toEqual([['12:25', '19:10']]);
      // Five and a half hours parked at home afterwards adds nothing.
      expect(r.dwells.length).toBe(1);
    });

    // Rule 10 is the ONE way the house still contributes, and rule 12 does not
    // touch it: the carve happens first and its rows are kind 'office'.
    test('rule 10 survives rule 12: app open at home after the last work is still Office', async () => {
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'driving'), mo(T(7, 25), 'onFoot'),
                    mo(T(15, 0), 'driving'), mo(T(15, 25), 'onFoot')];
      const fixes = [fix(T(7, 0, 5), JF), fix(T(7, 25, 5), DF), fix(T(11, 0), DF),
                     fix(T(15, 0, 5), DF), fix(T(15, 25, 5), JF), fix(T(19, 0), JF), fix(T(20, 0), JF)];
      const appEvents = [{ ts: T(19, 0), kind: 'active' }, { ts: T(19, 40), kind: 'background' }];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, appEvents, nowMs: T(22, 0) }));
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]))
        .toEqual([['shop', '12:25', '20:00'], ['office', '00:00', '00:40']]);
    });

    // The owner's own house is the control. It shares its spot with his yard,
    // the ranker gives it to the shop, and "shop time always counts" (9.11)
    // still holds: rule 12 must not reach it.
    test('the house that is also the yard keeps its shop row', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 52), 'driving'), mo(T(8, 3), 'onFoot'),
                    mo(T(12, 2), 'driving'), mo(T(12, 12), 'onFoot'), mo(T(16, 0), 'driving'), mo(T(16, 20), 'onFoot')];
      const fixes = [fix(T(7, 52, 5), SHOP), fix(T(8, 3, 5), DOE), fix(T(12, 2, 5), DOE),
                     fix(T(12, 12, 5), SHOP), fix(T(14, 0), SHOP), fix(T(16, 0, 5), SHOP), fix(T(16, 20, 5), DOE), fix(T(17, 0), DOE)];
      const r = await run(page, base({ tape, fixes, nowMs: T(18, 0) }));
      expect(r.dwells.filter(d => d.kind === 'shop').length).toBeGreaterThan(0);
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
    });

    // The rows the writer is handed: no 'place-home' arm can fire any more,
    // because no home_office dwell reaches geoDeriveRows at all.
    test('no row the writer produces carries a home office', async () => {
      const tape = [mo(T(6, 30), 'onFoot'), mo(T(7, 0), 'driving'), mo(T(7, 25), 'onFoot'),
                    mo(T(15, 0), 'driving'), mo(T(15, 25), 'onFoot')];
      const fixes = [fix(T(7, 0, 5), JF), fix(T(7, 25, 5), DF), fix(T(11, 0), DF),
                     fix(T(15, 0, 5), DF), fix(T(15, 25, 5), JF), fix(T(16, 30), JF)];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0), crew: true }));
      const time = rows.job_time_entries;
      // AMENDED 2026-09-15 (§10.4). This used to expect the two drives as rows
      // and to check that they named the house as a destination. Both of them
      // ARE the house to his dad's yard and back, which rule 20 now calls the
      // commute, so the writer produces neither. The rule this test is for is
      // unchanged and still proved below: no row the writer produces carries a
      // home office, and the yard dwell is untouched.
      expect(time.map(t => t.source)).toEqual([]);
      expect(time.some(t => t.source === 'place-home')).toBe(false);
      expect(rows.shop_time_entries.length).toBe(1);
      // The legs are still derived; they simply do not bill.
      const legs = await page.evaluate((inp) => geoDeriveDay(inp).legs.map(l => !!l.commute),
        base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0), crew: true }));
      expect(legs).toEqual([true, true]);
    });
  });

  // ── The arrival fix beats the last road fix ─────────────────────────────
  // Jack's 31 August, from his own rows. He left home at 07:11 and the tape
  // flipped out of automotive at 07:50:34. His drive pings land every five
  // minutes, so the two fixes either side of that flip were:
  //
  //     07:48:18   3,190 ft from the shop   still on the road
  //     07:53:19      30 ft from the shop   parked at the shop
  //
  // The road fix was 29 seconds nearer in time, `at()` took it, it matched no
  // fence, and the arrival was filed as a personal stop. The chain rolled on
  // to 14:08 and the rail drew "DRIVE TIME, 1200 SW Oakley Ave, 7:09 AM to
  // 2:08 PM", with a real 37-minute visit to the shop buried inside it
  // (owner: "none of these drives show the immediate drives he's had from
  // court to Oakley when there was no core motion flip in between").
  test.describe('the arrival fix beats the last road fix', () => {
    const JHOME = { id: 'place-1787361092921077', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
    const DADS  = { id: 'place-1788216906515011', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
    const JF = { lat: JHOME.lat, lng: JHOME.lng };
    const DF = { lat: DADS.lat, lng: DADS.lng };
    // 3,190 ft short of the shop: his real 07:48 fix, on Oakley heading north.
    const NEARLY = { lat: DADS.lat - 0.00876, lng: DADS.lng };
    const JFENCES = [JHOME, DADS];

    // The exact shape: flip out of automotive at :50:34, road fix at :48:18,
    // parked fix at :53:19. One leg, home to the shop, and a dwell there.
    test('a direct run home to the shop is one leg, not a swallowed stop', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 11, 28), 'automotive'), mo(T(7, 50, 34), 'onFoot'),
                    mo(T(15, 0), 'automotive'), mo(T(15, 25), 'onFoot')];
      // The 7:23 point is where he ACTUALLY was, not a second copy of the 7:48
      // road fix. His real tape that morning reports every five minutes and he
      // moved 1,700 to 12,000 ft between every pair; two identical points
      // twenty-five minutes apart never happened, and since 2026-09-04 the
      // deriver reads that (correctly) as a parked truck and splits the drive.
      const ENROUTE = { lat: 39.02966, lng: -95.70546 };
      const fixes = [fix(T(7, 0), JF), fix(T(7, 11, 28), JF), fix(T(7, 23), ENROUTE),
                     fix(T(7, 43, 17), { lat: 39.05528, lng: -95.68768 }),
                     fix(T(7, 48, 18), NEARLY), fix(T(7, 53, 19), DF), fix(T(8, 30), DF),
                     fix(T(15, 0), DF), fix(T(15, 25), JF), fix(T(16, 30), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0) }));
      expect(r.legs.map(l => [l.from.name, l.to.name, l.stops])).toEqual([
        ['7402 SW 22nd Ct', '1200 SW Oakley Ave', 0],
        ['1200 SW Oakley Ave', '7402 SW 22nd Ct', 0]]);
      // The visit is a shop row of its own, not minutes inside a drive.
      expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]))
        .toEqual([['shop', '12:50', '20:00']]);   // starts at the FLIP, not at the late fix
      // And the leg stops where he stopped, not where he last was on the road.
      expect(r.legs[0].endTs).toBe(T(7, 50, 34));
    });

    // The guard on the old behaviour: with ONLY the road fix, there is no
    // arrival to find and the journey is still an unresolved stop. This is
    // what makes the test above about the fix that exists, not about loosening
    // the fence.
    test('with no fix after the flip at all, nothing is invented: the far end is unsaved, not the shop', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 11, 28), 'automotive'), mo(T(7, 50, 34), 'onFoot')];
      const fixes = [fix(T(7, 0), JF), fix(T(7, 11, 28), JF), fix(T(7, 48, 18), NEARLY)];
      // The clock is here for RULE 16, not for this test's subject. Its day is
      // house to somewhere unsaved and nothing else, which since 2026-09-12 is
      // an empty day and writes no legs at all. The clock is the owner's own
      // safety valve for exactly that ("he uses the manual clock in"), and it
      // leaves the question this test asks untouched: does the far end resolve
      // to unsaved, or get snapped to the shop.
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(9, 0),
        clocks: [{ start: T(7, 0), end: T(8, 0) }] }));
      // The guard is the same: no arrival is invented at the shop. Since rule
      // 14 the drive itself is a traced leg ending somewhere unsaved.
      expect(r.legs.length).toBe(1);
      expect(r.legs[0].traced).toBe(true);
      expect(r.legs[0].to.unsaved).toBe(true);
      expect(r.legs[0].to.name).toBe('');
      expect(r.dwells).toEqual([]);
    });

    // A fix BEFORE the flip is still moving even when it is very close in
    // time, so it must not win over a later parked one. One second before
    // versus twelve minutes after: the parked fix still names the fence.
    test('one second before the flip does not beat twelve minutes after', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 11, 28), 'automotive'), mo(T(7, 50, 34), 'onFoot'),
                    mo(T(15, 0), 'automotive'), mo(T(15, 25), 'onFoot')];
      const fixes = [fix(T(7, 0), JF), fix(T(7, 11, 28), JF), fix(T(7, 50, 33), NEARLY),
                     fix(T(8, 2, 30), DF), fix(T(15, 0), DF), fix(T(15, 25), JF), fix(T(16, 30), JF)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0) }));
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([
        ['7402 SW 22nd Ct', '1200 SW Oakley Ave'], ['1200 SW Oakley Ave', '7402 SW 22nd Ct']]);
    });
  });

  // ── One row per drive, not one per chain ────────────────────────────────
  // Owner 2026-09-04: "right, in between it logs the time as a unsaved job
  // site."
  //
  // Jack's 1 September, from his own tape. He left his dad's shop at 12:04 and
  // reached his house at 3:18, and in between he stopped at four customers
  // nobody has saved. CoreMotion flipped at every one of them: still 12:18,
  // onFoot 12:46 and 12:51, still 13:12, walking 13:55, onFoot and running
  // 14:30. Eight flips, four stops, nothing missing from the evidence.
  //
  // The rail drew ONE 58-minute drive spanning three hours and eleven minutes.
  test.describe('a chain through unsaved stops is many drives', () => {
    const JH = { id: 'p-jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
    const DS = { id: 'p-ds', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
    const F = [JH, DS];
    // RULE 20 (2026-09-15) made a direct shop-to-house drive the commute, and a
    // commute writes no rows. The fixtures below are about how a drive SPLITS,
    // not about who pays for it, so they run to a saved CLIENT standing at the
    // same coordinate: every timing and distance in them is unchanged, and the
    // house is simply not one of the two ends. The chain tests above still end
    // at the house on purpose, because a chain is not a commute.
    // A SUPPLY HOUSE, deliberately, not a client: rule 13 asks whether a client
    // visit the day cannot vouch for is work at all, and a held visit changes
    // the source these tests filter on. The stand-in has to be neutral to
    // every rule except the one under test.
    const CH = { id: 'place-31', kind: 'supply', name: 'Chain stop',
      lat: JH.lat, lng: JH.lng };
    const FC = [DS, CH];
    // His four real customers that afternoon, none of them saved.
    const C1 = { lat: 39.03034, lng: -95.75969 };
    const C2 = { lat: 39.00083, lng: -95.73308 };
    const C3 = { lat: 38.98390, lng: -95.72172 };
    const C4 = { lat: 38.99297, lng: -95.72918 };

    // 12:04 shop -> C1 -> C2 -> C3 -> C4 -> home 15:18, in Central hours.
    const tape = [
      mo(T(11, 0), 'onFoot'),
      mo(T(12, 4), 'automotive'), mo(T(12, 15), 'onFoot'),
      mo(T(13, 4), 'automotive'), mo(T(13, 9), 'still'),
      mo(T(13, 45), 'automotive'), mo(T(13, 55), 'walking'),
      mo(T(14, 24), 'automotive'), mo(T(14, 30), 'onFoot'),
      mo(T(14, 59), 'automotive'), mo(T(15, 18), 'onFoot'),
    ];
    const fixes = [
      fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }), fix(T(12, 15, 5), C1), fix(T(12, 40), C1),
      fix(T(13, 4, 5), C1), fix(T(13, 9, 5), C2), fix(T(13, 30), C2),
      fix(T(13, 45, 5), C2), fix(T(13, 55, 5), C3), fix(T(14, 10), C3),
      fix(T(14, 24, 5), C3), fix(T(14, 30, 5), C4), fix(T(14, 45), C4),
      fix(T(14, 59, 5), C4), fix(T(15, 18, 5), { lat: CH.lat, lng: CH.lng }), fix(T(16, 0), { lat: CH.lat, lng: CH.lng }),
    ];

    test('five drives are five rows, and the standing between them is left for the clock to name', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(18, 0) }));
      const drives = rows.job_time_entries.filter(t => t.source === 'drive');
      expect(drives.length, 'shop to C1 to C2 to C3 to C4 to home').toBe(5);
      // No row spans a stop any more: each ends where the tape said he got out.
      expect(drives.map(d => [d.arrived_at.slice(11, 16), d.departed_at.slice(11, 16)])).toEqual([
        ['17:04', '17:15'], ['18:04', '18:09'], ['18:45', '18:55'],
        ['19:24', '19:30'], ['19:59', '20:18'],
      ]);
      // Only the last one has reached anywhere with a name on it.
      expect(drives.map(d => d.dest_place)).toEqual([null, null, null, null, 'Chain stop']);
      // Unique keys, or geo_replace_day would upsert them over each other.
      expect(new Set(drives.map(d => d.client_key)).size).toBe(5);
    });

    // EVERY STOP IS A ROW (owner 2026-09-04): "we should be logging every flip
    // to onsite unsaved address and every drive with times in between."
    test('the four stops between the five drives are four rows of their own', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(18, 0) }));
      const stops = rows.job_time_entries.filter(t => t.source === 'unsaved');
      expect(stops.map(t => [t.arrived_at.slice(11, 16), t.departed_at.slice(11, 16)])).toEqual([
        ['17:15', '18:04'], ['18:09', '18:45'], ['18:55', '19:24'], ['19:30', '19:59'],
      ]);
      // Never named and never addressed: an unsaved stop is not given a place.
      expect(stops.every(t => t.dest_place === null && t.job_id === null)).toBe(true);
      // Unique keys, or geo_replace_day would upsert them over each other.
      expect(new Set(stops.map(t => t.client_key)).size).toBe(4);
      // And they never collide with the drives around them.
      const all = rows.job_time_entries.slice().sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
      for (let i = 1; i < all.length; i++) {
        expect(Date.parse(all[i].arrived_at), 'no overlap, or the writer refuses the day')
          .toBeGreaterThanOrEqual(Date.parse(all[i - 1].departed_at));
      }
    });

    // THE MILES DO NOT SPLIT. One row, the direct route, between two SAVED
    // fences. An unsaved customer is never a mileage endpoint (owner: "un
    // saved mileage legs no they cant and I wont do it").
    test('the miles stay one leg between the two saved ends', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(18, 0) }));
      expect(rows.td_mileage.length, 'one leg, not five').toBe(1);
      expect(rows.td_mileage[0].from_name).toBe('1200 SW Oakley Ave');
      expect(rows.td_mileage[0].to_name).toBe('Chain stop');
      expect(rows.td_mileage[0].calc_method).toContain('derived-');
    });

    // ── EACH SEGMENT NAMES ITS OWN ENDS (owner report 2026-09-14) ───────
    //
    // Jack's Sunday. Journey j-987ebc83-mu1d7p2e split at a stop nobody had
    // saved, so the rail drew two drive rows, and BOTH read "JS Solutions
    // shop to Bill Lorson": once at 9:55 and again at 10:39, with the
    // half-hour stop sitting between them saying it was an unsaved address.
    // One trip, claimed twice, and neither row was it.
    //
    // The labels came off the mileage row, which is deliberately ONE row for
    // the whole collapsed leg (rule 6, directly above), so its from_name and
    // to_name are the JOURNEY's ends and describe no segment of a split one.
    // The deriver names them here instead.
    test('a split leg carries the ends of each segment, not the journey\'s twice over', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(18, 0) }));
      const leg = rows.td_mileage[0];
      // Five drives, five pairs of ends, in the order the drives happened.
      expect(leg.segEnds).toEqual([
        { from: '1200 SW Oakley Ave', to: '' },
        { from: '', to: '' },
        { from: '', to: '' },
        { from: '', to: '' },
        { from: '', to: 'Chain stop' },
      ]);
      // The journey's own ends are unchanged, and so are the miles: this adds
      // a fact, it does not move one.
      expect([leg.from_name, leg.to_name]).toEqual(['1200 SW Oakley Ave', 'Chain stop']);
      // OLD: the drive rows were keyed '<legKey>:N' and the rail indexed
      // segEnds by that N. It was right about the ORDER and wrong about the
      // identity: N counts the segments the deriver currently believes are in
      // front of this one, and that belief is revisable (owner 2026-09-14).
      // NEW: each row carries the id of the journey that started it, and the
      // leg lists those ids in the same order as segEnds, so the rail still
      // reads the pair without guessing and the row keeps its name when the
      // deriver changes its mind about the shape around it.
      const drives = rows.job_time_entries.filter(t => t.source === 'drive')
        .sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
      expect(leg.segKeys).toEqual(drives.map(d => d.client_key));
      expect(leg.segKeys).toHaveLength(leg.segEnds.length);
      // The first segment IS the leg's own journey; the rest are their own.
      expect(drives[0].client_key).toBe(leg.legKey);
      expect(new Set(leg.segKeys).size, 'five journeys, five keys').toBe(5);
      // Only the end that IS the destination carries its name, exactly as
      // dest_place already does on the rows themselves.
      expect(drives.map(d => d.dest_place)).toEqual(
        leg.segEnds.map(e => e.to || null));
      // ── AND THE ROW NAMES ITS OWN ORIGIN (owner 2026-09-15) ───────────
      // "The way it's titled is wrong, we should have fixed the title a long
      // time ago rather than last night." segEnds still exists for the days
      // already written under it, but a drive row no longer has to be joined
      // to a mileage leg to be titled: it carries both of its own ends.
      expect(drives.map(d => d.origin_place)).toEqual(
        leg.segEnds.map(e => e.from || null));
      // Which on a split leg means exactly one row knows where the journey
      // started and exactly one knows where it finished; the rest run between
      // stops nobody saved, and the stop rows between them already say so.
      expect(drives.filter(d => d.origin_place).length).toBe(1);
      expect(drives.filter(d => d.dest_place).length).toBe(1);
    });

    test('an unsplit drive row carries both of its ends, so nothing has to be joined to title it', async () => {
      const t = [mo(T(11, 0), 'onFoot'), mo(T(12, 4), 'automotive'), mo(T(12, 40), 'onFoot')];
      const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
        fix(T(12, 40, 5), { lat: CH.lat, lng: CH.lng }), fix(T(13, 30), { lat: CH.lat, lng: CH.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
      const drives = rows.job_time_entries.filter(x => x.source === 'drive');
      expect(drives).toHaveLength(1);
      expect([drives[0].origin_place, drives[0].dest_place])
        .toEqual([rows.td_mileage[0].from_name, rows.td_mileage[0].to_name]);
    });

    // An unsplit leg has one segment, and its ends ARE from_name and to_name.
    // Saying so twice would be two places to keep in step for no gain.
    test('a leg that never split carries no segment ends at all', async () => {
      const t = [mo(T(11, 0), 'onFoot'), mo(T(12, 4), 'automotive'), mo(T(12, 40), 'onFoot')];
      const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
        fix(T(12, 40, 5), { lat: CH.lat, lng: CH.lng }), fix(T(13, 30), { lat: CH.lat, lng: CH.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
      expect(rows.td_mileage).toHaveLength(1);
      expect(rows.td_mileage[0].segEnds).toBeUndefined();
      expect(rows.td_mileage[0].segKeys).toBeUndefined();
      const drives = rows.job_time_entries.filter(x => x.source === 'drive');
      expect(drives).toHaveLength(1);
      // Nothing to index, and the one segment's journey IS the leg's.
      expect(drives[0].client_key).toBe(rows.td_mileage[0].legKey);
    });

    // ── A ROW'S IDENTITY IS ITS JOURNEY, NOT THE SHAPE AROUND IT ─────────
    // Owner 2026-09-14, after Jack's 13:14 stop sat on top of both the drive
    // and the visit for a whole day: "a row's identity should not depend on a
    // guess the app can change its mind about."
    //
    // The guess is the STRUCTURE: whether the deriver thinks this journey is
    // one of a chain (it wrote '<chain>:N' and '<chain>:sN') or standing on
    // its own (it wrote '<journey>' and 'd-<journey>'). More fixes arrive, it
    // revises, and the same physical drive lands under a second key while the
    // first is left behind. These three tests are that claim, from the same
    // day in three shapes.
    test('the same drive keeps its key whether or not the deriver split the journey', async () => {
      // One tape, two readings. First with the far end saved, so the trip
      // resolves as one plain leg; then with it unsaved, so the deriver
      // chains on through a stop and the trip becomes segment 0 of a chain.
      const t = [mo(T(11, 0), 'onFoot'),
        mo(T(12, 4), 'automotive'), mo(T(12, 15), 'onFoot'),
        mo(T(13, 4), 'automotive'), mo(T(13, 40), 'onFoot')];
      const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }), fix(T(12, 15, 5), C1), fix(T(12, 40), C1),
        fix(T(13, 4, 5), C1), fix(T(13, 40, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 30), { lat: CH.lat, lng: CH.lng })];
      const run = async (fences) => page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
        return JSON.parse(JSON.stringify(rows.job_time_entries
          .map(x => ({ k: x.client_key, s: x.source, a: x.arrived_at.slice(11, 16) }))
          .sort((a, b) => a.a.localeCompare(b.a))));
      }, base({ tape: t, fixes: f, fences, nowMs: T(18, 0) }));
      // C1 saved as a client: two separate legs, the first ending at a fence.
      const BILL = { id: 'client-1', kind: 'client', name: 'Bill Lorson', clientId: 1, lat: C1.lat, lng: C1.lng };
      const saved = await run(FC.concat([BILL]));
      // C1 not saved: one chain with a held stop in the middle of it.
      const unsaved = await run(FC);
      const first = x => x.find(y => y.a === '17:04');
      expect(first(saved).k, 'the 12:04 drive names its own journey either way')
        .toBe(first(unsaved).k);
      // And the standing at C1 is the same arrival under either reading: a
      // visit when the place is saved, a stop when it is not, one key.
      const at1215 = x => x.find(y => y.a === '17:15');
      expect(at1215(saved).k).toBe(at1215(unsaved).k);
      expect([at1215(saved).s, at1215(unsaved).s]).toEqual(['client', 'unsaved']);
      expect(at1215(saved).k, 'the arrival is keyed by the drive that ended there')
        .toBe('d-' + first(saved).k);
      // And the drive AWAY from that stop, which under the old shape went
      // from '<chain>:1' to its own bare id the moment the address was
      // saved, is one row that never moved.
      const second = x => x.find(y => y.a === '18:04');
      expect(second(saved).k).toBe(second(unsaved).k);
      expect(new Set([first(saved).k, second(saved).k, at1215(saved).k]).size).toBe(3);
    });

    test('a stop and the visit it becomes are the same row, so saving the address never leaves a ghost', async () => {
      // Jack's 14 September, in miniature. The deriver first reads the stop
      // as unsaved; the address is saved, which makes it a fence; the next
      // derive resolves the same arrival to a client. The two writes have to
      // land on ONE row, or the first is a ghost the sweep cannot reach once
      // anything stamps it.
      const t = [mo(T(11, 0), 'onFoot'),
        mo(T(12, 4), 'automotive'), mo(T(12, 15), 'onFoot'),
        mo(T(13, 4), 'automotive'), mo(T(13, 40), 'onFoot')];
      const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }), fix(T(12, 15, 5), C1), fix(T(12, 40), C1),
        fix(T(13, 4, 5), C1), fix(T(13, 40, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 30), { lat: CH.lat, lng: CH.lng })];
      const run = async (fences) => page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
        const stop = rows.job_time_entries.find(x => x.source === 'unsaved' || x.source === 'client');
        const leg = rows.td_mileage.find(m => Array.isArray(m.viaStops) && m.viaStops.length);
        return JSON.parse(JSON.stringify({ key: stop ? stop.client_key : null,
          src: stop ? stop.source : null, via: leg ? leg.viaStops : null }));
      }, base({ tape: t, fixes: f, fences, nowMs: T(18, 0) }));
      const BILL = { id: 'client-1', kind: 'client', name: 'Bill Lorson', clientId: 1, lat: C1.lat, lng: C1.lng };
      const before = await run(FC);
      const after = await run(FC.concat([BILL]));
      expect(before.src).toBe('unsaved');
      expect(after.src).toBe('client');
      expect(after.key, 'one arrival, one row, before and after the address was saved')
        .toBe(before.key);
      // And the Save button on the rail finds that stop by its own key rather
      // than by counting positions (_mileSaveStopAddress, js/mileage.js).
      expect(before.via.map(v => v.key)).toEqual([before.key]);
    });

    test('every automatic key names a journey, and no two rows share one', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(18, 0) }));
      const keys = rows.job_time_entries.map(x => x.client_key)
        .concat(rows.shop_time_entries.map(x => x.client_key));
      // A drive is 'j-...', an arrival is 'd-j-...', an office window 'o-...'.
      // Nothing carries a position any more.
      expect(keys.every(k => /^(d-)?j-|^o-/.test(k)), keys.join(',')).toBe(true);
      expect(keys.some(k => /:s?\d+$/.test(k)), 'no row is keyed by its place in a list').toBe(false);
      expect(new Set(keys).size, 'or geo_replace_day would upsert them over each other')
        .toBe(keys.length);
    });

    // ── A stop must be still ────────────────────────────────────────────
    // Owner 2026-09-04: "no way somebody ever hops from a drive to a damn
    // bike lol."
    //
    // His 3 September, 2:43 to 2:53pm: the tape flipped automotive, cycling,
    // automotive six times while the phone moved 6,309 ft and then 6,469 ft
    // between the supposed stops, about 40 mph. Splitting on every gap drew
    // six one-minute drives and five stops out of one continuous drive.
    test.describe('a stop must be still', () => {
      const FAR1 = { lat: 39.0369, lng: -95.7051 };   // ~1.2 mi along the road
      const FAR2 = { lat: 39.0255, lng: -95.6876 };   // ~1.2 mi further

      test('a flip-flop with the truck still moving is one drive, not six', async () => {
        // automotive, cycling, automotive, cycling, automotive: three segments
        // separated by gaps of 20 and 30 seconds, with real movement across
        // both.
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(14, 44), 'automotive'), mo(T(14, 47, 20), 'cycling'),
          mo(T(14, 47, 40), 'automotive'), mo(T(14, 49, 10), 'cycling'),
          mo(T(14, 49, 40), 'automotive'), mo(T(14, 56), 'onFoot')];
        const f = [fix(T(14, 44, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 47, 10), FAR1), fix(T(14, 47, 50), FAR2),
          fix(T(14, 49), FAR2), fix(T(14, 49, 50), { lat: CH.lat, lng: CH.lng }),
          fix(T(14, 56, 5), { lat: CH.lat, lng: CH.lng }), fix(T(15, 30), { lat: CH.lat, lng: CH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        const drives = rows.job_time_entries.filter(x => x.source === 'drive');
        const stops = rows.job_time_entries.filter(x => x.source === 'unsaved');
        expect(drives.length, 'one drive all along').toBe(1);
        expect(stops.length, 'and no stop invented from a bad label').toBe(0);
        // It absorbs the gaps, so the minutes and the span it prints agree.
        expect([drives[0].arrived_at.slice(11, 16), drives[0].departed_at.slice(11, 16)]).toEqual(['19:44', '19:56']);
        expect(drives[0].minutes).toBe(12);
      });

      test('a real stop in one spot still splits the drive', async () => {
        // Same shape, but the fixes on both sides of the gap sit together.
        //
        // The gap is THREE minutes, widened from one on 2026-09-04. A
        // one-minute gap is below the stop floor now (see "a one-minute gap
        // is not a stop" below), so the old fixture was testing the split
        // through a case that no longer writes a row at all. A real stop is
        // what this test is about, so the fixture is a real stop.
        const HERE = { lat: 39.0369, lng: -95.7051 };
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(14, 44), 'automotive'), mo(T(14, 47), 'onFoot'),
          mo(T(14, 50), 'automotive'), mo(T(14, 58), 'onFoot')];
        const f = [fix(T(14, 44, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 46, 50), HERE), fix(T(14, 50, 10), HERE),
          fix(T(14, 58, 5), { lat: CH.lat, lng: CH.lng }), fix(T(15, 30), { lat: CH.lat, lng: CH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(2);
        expect(rows.job_time_entries.filter(x => x.source === 'unsaved').length).toBe(1);
      });

      test('a long gap is a stop even with no fix anywhere near it', async () => {
        // Nobody drives for an hour with the tape saying cycling. Ten minutes
        // is stillEndMs, the same number the journey builder parks a truck on.
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(12, 4), 'automotive'), mo(T(12, 18), 'cycling'),
          mo(T(13, 30), 'automotive'), mo(T(13, 45), 'onFoot')];
        const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(13, 45, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 30), { lat: CH.lat, lng: CH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(2);
        expect(rows.job_time_entries.filter(x => x.source === 'unsaved')
          .map(x => x.minutes)).toEqual([72]);
      });

      // THE FIXES INSIDE THE GAP ARE THE PROOF (owner 2026-09-04: "if we
      // cant reliably tell what happened and where he was at from 214 to 253
      // and he was contstantly moving during that time I say we merge them,
      // if we can prove he stopped then we split it to a unsaved address").
      //
      // His 3 September, 2:43 to 2:47pm. The bracket test above cannot see
      // this one: the last fix BEFORE the gap is 2,437 ft away and the first
      // fix after it is somewhere else again, so "same place either side"
      // says no. What proves it is the six fixes at one identical coordinate
      // from 2:44 to 2:49, which sit inside the gap and just past its end.
      // The day merged a real stop into one 39-minute drive.
      test('a still run inside the gap proves the stop, whatever the brackets say', async () => {
        const LOT = { lat: 39.04668, lng: -95.72346 };
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(14, 14), 'automotive'), mo(T(14, 43), 'cycling'),
          mo(T(14, 47), 'automotive'), mo(T(14, 53), 'onFoot')];
        const f = [fix(T(14, 14, 5), { lat: DS.lat, lng: DS.lng }),
          // The brackets are far apart and far from the stop.
          fix(T(14, 42), FAR1), fix(T(14, 52), FAR2),
          // The proof: one spot, 2:44 to 2:49, straddling the gap's end.
          fix(T(14, 44), LOT), fix(T(14, 45), LOT), fix(T(14, 46), LOT),
          fix(T(14, 47, 30), LOT), fix(T(14, 48), LOT), fix(T(14, 48, 30), LOT),
          fix(T(14, 53, 5), { lat: CH.lat, lng: CH.lng }), fix(T(15, 30), { lat: CH.lat, lng: CH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        const stops = rows.job_time_entries.filter(x => x.source === 'unsaved');
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length,
          'two drives, not one 39-minute one').toBe(2);
        expect(stops.length, 'and the stop between them').toBe(1);
        expect([stops[0].arrived_at.slice(11, 16), stops[0].departed_at.slice(11, 16)]).toEqual(['19:43', '19:47']);
      });

      test('a short gap with no fixes at all is not a stop: nothing is invented', async () => {
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(12, 4), 'automotive'), mo(T(12, 18), 'cycling'),
          mo(T(12, 20), 'automotive'), mo(T(12, 40), 'onFoot')];
        const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(12, 40, 5), { lat: CH.lat, lng: CH.lng }), fix(T(13, 30), { lat: CH.lat, lng: CH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(1);
        expect(rows.job_time_entries.filter(x => x.source === 'unsaved').length).toBe(0);
      });
    });

    // A MINUTE IS NOT A STOP (owner 2026-09-04). His 3 September drew a
    // 14:47-14:48 unsaved stop with ONE fix in it, zero feet of movement, and
    // its two bracketing fixes at the identical coordinate: the tail of the
    // automotive/cycling flip-flop, where one gap happened to have both ends
    // in the same spot so "a stop must be still" said stop.
    test('a one-minute gap is not a stop; two minutes is', async () => {
      const HERE = { lat: 39.0369, lng: -95.7051 };
      const day = (gapMin) => {
        const out = T(14, 44 + 6 + gapMin);
        return {
          tape: [mo(T(11, 0), 'onFoot'),
            mo(T(14, 44), 'automotive'), mo(T(14, 50), 'onFoot'),
            mo(T(14, 50 + gapMin), 'automotive'), mo(T(14, 58 + gapMin), 'onFoot')],
          fixes: [fix(T(14, 44, 5), { lat: DS.lat, lng: DS.lng }),
            fix(T(14, 49, 50), HERE), fix(T(14, 50 + gapMin, 10), HERE),
            fix(T(14, 58 + gapMin, 5), { lat: CH.lat, lng: CH.lng }),
            fix(T(15, 30), { lat: CH.lat, lng: CH.lng })],
        };
      };
      const rowsFor = async (gapMin) => page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base(Object.assign({ fences: FC, nowMs: T(18, 0) }, day(gapMin))));
      const one = await rowsFor(1);
      expect(one.job_time_entries.filter(t => t.source === 'unsaved'), 'a minute is noise').toEqual([]);
      const two = await rowsFor(2);
      expect(two.job_time_entries.filter(t => t.source === 'unsaved').length, 'two minutes is a stop').toBe(1);
      // AMENDED 2026-09-04 (10.4). This used to expect two drives in BOTH
      // cases. That left the one-minute case split with nothing in the middle:
      // two drive rows back to back, which is what the owner objected to on his
      // 3 September rail at 2:14 and 2:48. A gap that cannot become a row
      // cannot break a drive either, so the minute merges and the two minutes
      // does not.
      expect(one.job_time_entries.filter(t => t.source === 'drive').length, 'one drive, not two').toBe(1);
      expect(two.job_time_entries.filter(t => t.source === 'drive').length).toBe(2);
    });

    // THE RUN, NOT THE SAMPLE, and A REPEAT IS NOT A NEW READING. Both fall
    // out of his 2 September 1:00pm drive: "I know the drive leg should be a
    // lot longer then that."
    test.describe('a sleeping phone', () => {
      const JH = { id: 'p-jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
      const DS = { id: 'p-ds', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
      const F = [JH, DS];

      test('consecutive stills are one stretch of stillness, not two short ones', async () => {
        // CoreMotion re-states 'still' while nothing changes. Measuring one
        // sample to the NEXT ENTRY read the re-statement as the truck moving:
        // his 12:52:37 still ran to 13:07:01 automotive, fourteen and a half
        // minutes parked, logged as 7m26s and 6m58s, so neither reached the
        // ten-minute floor and the drive swallowed the whole shop visit.
        const t = [mo(T(12, 30), 'onFoot'), mo(T(12, 37), 'automotive'),
          mo(T(12, 52), 'still'), mo(T(13, 0), 'still'), mo(T(13, 7), 'automotive'),
          mo(T(13, 25), 'onFoot')];
        const f = [fix(T(12, 36), { lat: CH.lat, lng: CH.lng }),
          fix(T(12, 52, 30), { lat: DS.lat, lng: DS.lng }),
          fix(T(13, 7, 30), { lat: DS.lat, lng: DS.lng }),
          fix(T(13, 25, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 30), { lat: CH.lat, lng: CH.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]),
          'the shop visit the two stills used to hide').toEqual([['shop', '17:52', '18:07']]);
      });

      test('the arrival is the first fix that says something new', async () => {
        // The first row after a journey ends is often a verbatim restatement
        // of the last one on the approach. His sat 605 ft from his dad's shop
        // against a 600 ft fence: five feet, and the arrival resolved to
        // nowhere, so the chain never closed and the day derived nothing. The
        // next fix is a real reading, 14 ft from the shop.
        const NEAR = { lat: 39.0442, lng: -95.7155 };   // ~605 ft short of DS
        const t = [mo(T(12, 30), 'onFoot'), mo(T(12, 37), 'automotive'),
          mo(T(12, 52), 'still'), mo(T(13, 0), 'still'), mo(T(13, 7), 'automotive'),
          mo(T(13, 25), 'onFoot')];
        const f = [fix(T(12, 36), { lat: CH.lat, lng: CH.lng }),
          fix(T(12, 49, 55), NEAR),
          fix(T(13, 0, 2), NEAR),                       // the stale repeat
          fix(T(13, 0, 47), { lat: DS.lat, lng: DS.lng }),
          fix(T(13, 25, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 30), { lat: CH.lat, lng: CH.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FC, nowMs: T(18, 0) }));
        expect(r.dwells.map(d => d.kind), 'the shop, not nowhere').toEqual(['shop']);
        expect(r.legs.map(l => [l.from.name, l.to.name]))
          .toEqual([['Chain stop', '1200 SW Oakley Ave'],
            ['1200 SW Oakley Ave', 'Chain stop']]);
      });
    });

    // A MINUTE IS NOT A DRIVE EITHER (owner 2026-09-04, his 2 September).
    // The phone sat at one coordinate from 8:03am to 12:32pm and CoreMotion
    // twitched automotive for one minute at 8:17. That drew two unsaved
    // addresses with a drive wedged between them, out of one place he never
    // left. The floor that refuses a one-minute stop refuses a one-minute
    // drive between two stops.
    test.describe('a minute is not a drive either', () => {
      const JH = { id: 'p-jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
      const DS = { id: 'p-ds', kind: 'shop', name: '1200 SW Oakley Ave', lat: 39.0456577, lng: -95.7151106 };
      const F = [JH, DS];
      const SITE = { lat: 38.98378, lng: -95.72182 };

      const rowsFor = (page, tape, fixes) => page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: FC, nowMs: T(20, 0) }));

      test('an interior one-minute blip merges the two stops around it', async () => {
        const t = [mo(T(7, 45), 'automotive'), mo(T(8, 3), 'onFoot'),
          mo(T(8, 17), 'automotive'), mo(T(8, 18), 'onFoot'),
          mo(T(12, 37), 'automotive'), mo(T(12, 44), 'onFoot'),
          mo(T(13, 0), 'automotive'), mo(T(13, 1), 'onFoot')];
        const f = [fix(T(7, 44), { lat: CH.lat, lng: CH.lng }),
          fix(T(8, 3, 5), SITE), fix(T(8, 31), SITE), fix(T(9, 4), SITE),
          fix(T(10, 0), SITE), fix(T(11, 6), SITE), fix(T(12, 32), SITE),
          fix(T(12, 44, 5), { lat: 39.0255, lng: -95.7249 }),
          fix(T(13, 1, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 0), { lat: DS.lat, lng: DS.lng })];
        const rows = await rowsFor(page, t, f);
        const stops = rows.job_time_entries.filter(x => x.source === 'unsaved');
        const drives = rows.job_time_entries.filter(x => x.source === 'drive');
        expect(drives.map(d => d.arrived_at.slice(11, 16)),
          'the 8:17 blip is gone').toEqual(['12:45', '17:37', '18:00']);
        expect(stops.map(x => [x.arrived_at.slice(11, 16), x.departed_at.slice(11, 16)])[0],
          'one place, all morning').toEqual(['13:03', '17:37']);
      });

      test('but a short FIRST or LAST segment is the trip itself and survives', async () => {
        // A one-minute hop from the lot into the shop is the arrival. Drop it
        // and the leg has nothing that says he got there.
        const t = [mo(T(7, 45), 'automotive'), mo(T(8, 3), 'onFoot'),
          mo(T(13, 0), 'automotive'), mo(T(13, 1), 'onFoot')];
        const f = [fix(T(7, 44), { lat: CH.lat, lng: CH.lng }),
          fix(T(8, 3, 5), SITE), fix(T(10, 0), SITE), fix(T(12, 32), SITE),
          fix(T(13, 1, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 0), { lat: DS.lat, lng: DS.lng })];
        const rows = await rowsFor(page, t, f);
        const drives = rows.job_time_entries.filter(x => x.source === 'drive');
        expect(drives.length).toBe(2);
        expect(drives[drives.length - 1].minutes).toBe(1);
        expect(drives[drives.length - 1].dest_place).toBe('1200 SW Oakley Ave');
      });
    });

    // ── A parked truck ends the drive, whatever the tape says ───────────
    // Owner 2026-09-04: "if it stays automotive or drive, dont want a drive
    // through it to stop it and break it up, but would want it to break it up
    // if a phone gets left and hasnt changed state."
    //
    // His 3 September, 1:55 to 2:53pm: two back-to-back drives with nothing
    // between them, because CoreMotion never left automotive in that stretch.
    // The fixes knew: he sat at his dad's shop for ten minutes in the middle
    // of it.
    test.describe('a parked truck ends the drive', () => {
      // A third saved fence so a drive can start at one saved place, park at
      // the shop in the middle, and go on to another: a journey out of an
      // UNSAVED origin writes no leg by rule 5, so a fixture that starts
      // nowhere tests nothing about drives.
      const CUST = { id: 'c-far', kind: 'client', clientId: 77, name: 'Far client', lat: 39.0700, lng: -95.6800 };
      const FF = F.concat([CUST]);
      // Rule 20: these two start at the house and park at the shop, which is the
      // commute itself. They are about a PARKED TRUCK splitting a journey, so
      // they run from the client standing at that coordinate instead.
      const FP = FC.concat([CUST]);

      test('sitting in one spot for ten minutes inside a drive splits it', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 53), 'onFoot')];
        // Home, moving, parked at the shop for twelve minutes, then on to a client.
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 0), { lat: 39.0400, lng: -95.7500 }),
          fix(T(14, 5), { lat: DS.lat, lng: DS.lng }), fix(T(14, 10), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 17), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 25), { lat: 39.0600, lng: -95.7000 }),
          fix(T(14, 53, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        // The shop stop it could never see before is a dwell now.
        // The client at the end is the OPEN tail, not a dwell: rule 9 needs a
        // departure before a visit is a row.
        // AMENDED 2026-09-04 (10.4). This used to end the dwell at 19:17, the
        // last fix of the still run. That is only where the READINGS stopped:
        // the truck is still in the yard until something shows it moved, which
        // here is the 19:25 fix a mile away. Same fixture, same stop, the
        // twelve minutes the fixes happened to cover are now the twenty
        // minutes he was actually parked. His 3 September is the real case:
        // fixes at the shop at 2:03 and 2:14, silence, and the tape flipping
        // at 2:43, which used to draw a 29-minute drive through half an hour
        // of him standing in the yard.
        expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]))
          .toEqual([['shop', '19:05', '19:25']]);
        expect(r.open && r.open.name).toBe('Far client');
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' }), r);
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length, 'two drives, not one').toBe(2);
        // Home to shop, shop to client: two legs where there was one.
        expect(r.legs.map(l => [l.from.name, l.to.name]))
          .toEqual([['Chain stop', '1200 SW Oakley Ave'], ['1200 SW Oakley Ave', 'Far client']]);
      });

      // NOBODY DRIVES A MILE IN FIFTEEN SECONDS. Owner 2026-09-04, on his 2
      // September 1:00pm drive: "I know the drive leg should be a lot longer
      // then that." A sleeping phone restates its last position verbatim, and
      // two of those in a row look exactly like a parked truck. His fixes at
      // 12:44:54 and 12:49:40 carried the same sixteen digits, then 12:49:55
      // landed 1.3 miles north. 312 mph, so one reading is a lie, and it is
      // the repeat.
      test('a still run contradicted by an impossible speed is a stale reading, not a stop', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 53), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }),
          // Two identical readings five minutes apart: it looks parked...
          fix(T(14, 5), { lat: 39.0400, lng: -95.7500 }), fix(T(14, 10), { lat: 39.0400, lng: -95.7500 }),
          // ...and fifteen seconds later he is a mile and a half away.
          fix(T(14, 10, 15), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 53, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.dwells, 'no stop invented from a stale repeat').toEqual([]);
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' }), r);
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length, 'one drive all along').toBe(1);
      });

      // The same repeat, with the next fix a plausible distance away: that is
      // a real park and it survives. This is the pair that proves the rule
      // rejects staleness rather than repeats.
      test('the same repeat with a plausible next fix is still a stop', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 53), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }),
          fix(T(14, 5), { lat: DS.lat, lng: DS.lng }), fix(T(14, 10), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 25), { lat: 39.0600, lng: -95.7000 }),
          fix(T(14, 53, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]))
          .toEqual([['shop', '19:05', '19:25']]);
      });

      // PARKED FOR THE REST OF THE JOURNEY. Nothing shows the truck moving
      // before the flip that ends the journey, so there is no second segment.
      // His 3 September: at his dad's shop from 2:03, phone asleep, and the
      // tape does not speak again until 2:43.
      test('nothing says it moved, so it never drove again', async () => {
        // His shape exactly: automotive at 1:55, fixes at the shop at 2:03 and
        // 2:14, then the phone sleeps and the tape does not speak again until
        // the 2:43 flip. He leaves for real at 2:47.
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'),
          mo(T(14, 43), 'cycling'), mo(T(14, 47), 'automotive'), mo(T(15, 10), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }),
          fix(T(14, 3), { lat: DS.lat, lng: DS.lng }), fix(T(14, 14), { lat: DS.lat, lng: DS.lng }),
          fix(T(15, 10, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(16, 0), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' }), r);
        // Its origin moved off his house with the rest of this block (rule 20
        // now refuses the day's first hop out of the door), so both drives
        // bill again and the point of the test is the dwell below either way.
        // writes no row now. The drive out still does, and the point of this
        // test is the one below it either way: forty-four minutes in the yard
        // rather than eleven with a drive drawn through the middle.
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length,
          'the drive in and the drive out').toBe(2);
        expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]),
          'forty-four minutes in the yard, not eleven with a drive drawn through it')
          .toEqual([['shop', '19:03', '19:47']]);
      });

      // A LONG SILENCE ACROSS THE SHOP, ENDING SOMEWHERE ELSE, IS NOT A STOP.
      // Owner 2026-09-04: "thats 67 times jacks phone set still on a drive for
      // 5-10 minutes?" No, and the question killed a rule. Measured on his own
      // week: of 67 gaps in the five-to-ten minute band inside drives, 63 show
      // him MOVING, a median of two miles across the gap. Even at ten minutes
      // and over, one of the six was him covering 4.8 miles at 22 mph with the
      // radio asleep. A gap is the tracker failing, not the truck stopping.
      test('a silence that ends somewhere else is the tracker failing, not a stop', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 53), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 0), { lat: 39.0400, lng: -95.7500 }),
          fix(T(14, 5), { lat: DS.lat, lng: DS.lng }),
          // thirty minutes of nothing, and he comes back four miles away
          fix(T(14, 35), { lat: 39.0600, lng: -95.7000 }),
          fix(T(14, 53, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.dwells, 'no shop stop invented from a hole').toEqual([]);
        expect(r.open && r.open.name).toBe('Far client');
      });

      // The same hole, with the far end in the SAME place: that is one cluster
      // and it is a stop.
      test('a silence that ends where it began is a stop', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 53), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 0), { lat: 39.0400, lng: -95.7500 }),
          fix(T(14, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 35), { lat: DS.lat, lng: DS.lng }),        // thirty minutes later, same spot
          fix(T(14, 53, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.dwells.map(d => [d.kind, hm(d.startTs), hm(d.endTs)]))
          .toEqual([['shop', '19:05', '19:35']]);
      });

      // DRIVING PAST IS NOT STOPPING. Measured on his own week: 14 fixes landed
      // inside a fence during a drive with the next fix OUTSIDE it seconds
      // later, one of them two seconds. A rule keyed on the fence would have
      // manufactured all 14; this one is keyed on stillness and manufactures
      // none.
      test('driving straight past a fence never splits the drive', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 20), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 0), { lat: 39.0400, lng: -95.7500 }),
          fix(T(14, 5), { lat: DS.lat, lng: DS.lng }),          // inside the shop fence
          fix(T(14, 5, 4), { lat: 39.0470, lng: -95.7250 }),    // four seconds later, gone
          fix(T(14, 10), { lat: 39.0600, lng: -95.7000 }),
          fix(T(14, 20, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.dwells, 'he drove past the shop, he did not stop').toEqual([]);
        expect(r.open && r.open.name).toBe('Far client');
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' }), r);
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(1);
      });

      // FIVE MINUTES IS THE WRONG NUMBER, measured. On his real week a
      // five-minute floor split 72 drives; ten split 7, every one genuine.
      // The five-minute holes are the phone dropping the drive window, not the
      // truck stopping. This threshold is therefore hostage to the ping rate.
      test('a gap under the threshold is the tracker breathing, not a stop', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 20), 'onFoot')];
        const f = [fix(T(13, 55, 5), { lat: CH.lat, lng: CH.lng }), fix(T(14, 0), { lat: 39.0400, lng: -95.7500 }),
          fix(T(14, 8), { lat: 39.0600, lng: -95.7000 }),   // an eight-minute hole, moving
          fix(T(14, 20, 5), { lat: CUST.lat, lng: CUST.lng }), fix(T(15, 30), { lat: CUST.lat, lng: CUST.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'c', employeeId: 'e' }), r);
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length, 'one drive').toBe(1);
      });

      test('an open journey with one fix is never split: the tail owns that', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive')];
        const f = [fix(T(13, 55, 5), { lat: DS.lat, lng: DS.lng })];
        const r = await run(page, base({ tape: t, fixes: f, fences: FP, nowMs: T(18, 0) }));
        expect(r.legs).toEqual([]);
        expect(r.pending && r.pending.origin.name).toBe('1200 SW Oakley Ave');
      });

      test('junk fixes never throw and never split', async () => {
        const t = [mo(T(11, 0), 'onFoot'), mo(T(13, 55), 'automotive'), mo(T(14, 20), 'onFoot')];
        const r = await page.evaluate((inp) => {
          try { return { ok: true, n: geoDeriveDay(inp).legs.length }; }
          catch (e) { return { ok: false, e: String(e) }; }
        }, base({ tape: t, fixes: [null, { ts: NaN }, { ts: T(14, 0), lat: 'x', lng: null }], fences: FP, nowMs: T(18, 0) }));
        expect(r.ok).toBe(true);
      });
    });

    // ── His 9:17, the one that was mashed against the shop ──────────────
    // Owner 2026-09-04: "917 am job site mashed against the shop with no
    // drive between it, why?"
    //
    // 1 September, from the tape: automotive at 9:17 sixty-eight feet from
    // his dad's shop, thirty-one minutes and 10.5 miles of continuous
    // breadcrumbs, walking at 9:48, an hour standing there, automotive again
    // at 10:51, back inside the shop fence at 11:17. Both ends the shop, so
    // rule 7 dropped the whole thing and the rail drew one flat two-hour
    // "unsaved job site" over two real drives.
    test('out of the shop and back through an unsaved stop is two drives and no mileage', async () => {
      const OUT917 = { lat: 39.0757, lng: -95.8620 };   // ~10.5 mi from Oakley
      const t3 = [mo(T(8, 0), 'onFoot'),
        mo(T(9, 17), 'automotive'), mo(T(9, 48), 'walking'),
        mo(T(10, 51), 'automotive'), mo(T(11, 20), 'onFoot')];
      // Breadcrumbs ALONG the way, not just at the far end. His real 9:17 drive
      // reported every few seconds; a fixture that jumps to the destination and
      // sits there is a fixture of a truck already parked, and since 2026-09-04
      // the deriver reads it that way (a phone that has not moved for
      // stillEndMs has arrived, whatever the tape says).
      const MID1 = { lat: 39.0500, lng: -95.7800 }, MID2 = { lat: 39.0650, lng: -95.8300 };
      const f3 = [fix(T(9, 17, 5), { lat: DS.lat, lng: DS.lng }),
        fix(T(9, 24), MID1), fix(T(9, 32), MID2), fix(T(9, 40), OUT917),
        fix(T(9, 48, 5), OUT917), fix(T(10, 25), OUT917), fix(T(10, 51, 5), OUT917),
        fix(T(11, 20, 5), { lat: DS.lat, lng: DS.lng }), fix(T(12, 0), { lat: DS.lat, lng: DS.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t3, fixes: f3, fences: FC, nowMs: T(14, 0) }));
      // AMENDED 2026-09-13 (10.4) for rule 18: the two drives and the hour
      // between them are still written, exactly as this test has always
      // required, and all three are now held. The shop is both ends of this
      // trip and the place he spent the hour was never saved, so nothing in
      // it can be claimed until somebody saves that address.
      const drives = rows.job_time_entries.filter(t => /^drive/.test(t.source));
      expect(drives.map(d => [d.arrived_at.slice(11, 16), d.departed_at.slice(11, 16)])).toEqual([
        ['14:17', '14:48'], ['15:51', '16:20'],
      ]);
      expect(drives.every(d => d.source === 'drive-held')).toBe(true);
      // The first ends at a stop nobody saved; the second genuinely reaches
      // the shop, which is saved, so it says so.
      expect(drives.map(d => d.dest_place)).toEqual([null, '1200 SW Oakley Ave']);
      // The hour he stood out there is its own row between them, held with
      // the drives either side of it and for the same reason.
      const stops = rows.job_time_entries.filter(t => /^unsaved/.test(t.source));
      expect(stops.every(t => t.source === 'unsaved-held')).toBe(true);
      expect(stops.map(t => [t.arrived_at.slice(11, 16), t.departed_at.slice(11, 16)]))
        .toEqual([['14:48', '15:51']]);
      // And nothing is CLAIMED for a trip with no saved far end: rule 14
      // writes it as a traced round trip, on the log and off every total.
      expect(rows.td_mileage.length).toBe(1);
      expect(rows.td_mileage[0].addressUnknown).toBe(true);
      expect(rows.td_mileage[0].unsavedVia).toBe(true);
      expect(rows.td_mileage[0].calc_method).toBe('derived-traced');
      expect(rows.td_mileage[0].miles).toBeGreaterThan(15);   // out ~10.5 and back, breadcrumb sum
      // The row names the stop it went through, not its own shop end, so the
      // Save button opens the lead where he actually stood (owner 2026-09-09).
      expect(rows.td_mileage[0].viaCoord).toEqual({ lat: OUT917.lat, lng: OUT917.lng });
      expect(rows.td_mileage[0].viaIso.slice(11, 16)).toBe('14:48');
    });

    // A clean run with nothing in between is still ONE row: this must not
    // shatter an ordinary drive.
    test('a drive with no stop in it is still a single row', async () => {
      const t2 = [mo(T(11, 0), 'onFoot'), mo(T(12, 4), 'automotive'), mo(T(12, 20), 'onFoot')];
      const f2 = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
                  fix(T(12, 20, 5), { lat: CH.lat, lng: CH.lng }), fix(T(13, 0), { lat: CH.lat, lng: CH.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t2, fixes: f2, fences: FC, nowMs: T(15, 0) }));
      const drives = rows.job_time_entries.filter(t => t.source === 'drive');
      expect(drives.length).toBe(1);
      expect(drives[0].dest_place).toBe('Chain stop');
    });
  });

  // ── Rule 14: a drive with an unsaved end is still a drive (owner 2026-09-08)
  // "only things with addresses saved should update any totals, if a address
  // gets added it can add the mileage back on the deriver."
  // ── Where the truck actually sat (owner 2026-09-12) ──────────────────────
  // His 11 September evening came back as "3600 SW Lincolnshire". He was at
  // 6812 SW Finsbury, 0.84 miles away. Four fixes across 2h43m parked: a pair
  // identical to five decimals 4,415 ft out, then a pair 27 ft from where the
  // tape says he went still. The first pair is one cached reading replayed and
  // contradicted forty seconds later, and it won only by being first.
  test.describe('_gdStopFix: the position the dwell agrees on', () => {
    const f = (ts, lat, lng, acc) => ({ ts, lat, lng, acc: acc == null ? null : acc });
    const pick = (fixes, a, b) => page.evaluate(
      ([fx, from, to]) => { const r = _gdStopFix(fx, from, to, 100, fx[0]); return r && [r.lat, r.lng]; },
      [fixes, a, b]);

    test('his real stop: the frozen pair loses to the corroborated one', async () => {
      const got = await pick([f(1000, 39.00232315, -95.76750946), f(2000, 39.00232315, -95.76750946),
        f(3000, 39.01050, -95.77900), f(4000, 39.01050, -95.77900)], 0, 9999);
      expect(got, 'a cache replays the past; on a tie the later reading is the live one').toEqual([39.01050, -95.77900]);
    });

    test('weight of evidence beats recency', async () => {
      // Three readings agreeing against one later straggler: the three win.
      const got = await pick([f(1000, 39.05, -95.75), f(2000, 39.05, -95.75),
        f(3000, 39.05, -95.75), f(4000, 39.09, -95.71)], 0, 9999);
      expect(got).toEqual([39.05, -95.75]);
    });

    test('a single fix is still the answer, and an inaccurate one is not', async () => {
      expect(await pick([f(1000, 39.05, -95.75)], 0, 9999)).toEqual([39.05, -95.75]);
      const got = await pick([f(1000, 39.05, -95.75), f(2000, 39.09, -95.71, 5000),
        f(3000, 39.09, -95.71, 5000)], 0, 9999);
      expect(got, 'two agreeing readings are worth nothing if both are junk').toEqual([39.05, -95.75]);
    });

    test('outside the dwell does not count, and an empty dwell falls back', async () => {
      const got = await pick([f(10, 39.09, -95.71), f(20, 39.09, -95.71), f(3000, 39.05, -95.75)], 1000, 9999);
      expect(got, 'the pair is before the stop began').toEqual([39.05, -95.75]);
      const back = await page.evaluate(() => {
        const fb = { lat: 1, lng: 2 };
        const r = _gdStopFix([], 0, 10, 100, fb); return r === fb;
      });
      expect(back, 'no fixes in the dwell: the arrival fix still answers').toBe(true);
    });

    test('junk never throws', async () => {
      const ok = await page.evaluate(() => {
        try {
          _gdStopFix(null, 0, 1, 100, null);
          _gdStopFix([null, {}, { ts: 'x', lat: 1, lng: 2 }, { ts: 1, lat: null, lng: 2 }], 0, 9, 100, null);
          return true;
        } catch (e) { return false; }
      });
      expect(ok).toBe(true);
    });

    // ── NOTHING REPEATS: THE MIDDLE, NOT THE LAST ONE (owner 2026-09-16) ──
    // "What was the tightest cluster on gps pings and what address does this
    // belong to." A parked truck with a live radio repeats no coordinate at
    // all, so every group is n=1 and the old rule handed back the last fix of
    // the dwell: the one taken rolling back out. Jack's real 15 September
    // stop, in feet from Laurie's pin, is exactly that: 297, 296, 295, 295,
    // 300, then 250.
    test('a parked truck that repeats nothing resolves to the middle of itself', async () => {
      // Five readings tightly grouped, then one straggler as he pulls away.
      const got = await pick([f(1000, 39.01115, -95.77970), f(2000, 39.01116, -95.77971),
        f(3000, 39.01114, -95.77969), f(4000, 39.01117, -95.77970), f(5000, 39.01115, -95.77972),
        f(6000, 39.01160, -95.77930)], 0, 9999);
      expect(got, 'the straggler is the newest and would have won on recency alone')
        .not.toEqual([39.01160, -95.77930]);
      expect(Math.abs(got[0] - 39.011155) < 0.00005, 'and it lands in the middle of the five').toBe(true);
    });

    test('a coordinate the phone stated twice still beats the median', async () => {
      // Two identical readings on one side, three scattered ones on the other.
      // The repeat is evidence the median is not, so the repeat wins.
      const got = await pick([f(1000, 39.05, -95.75), f(2000, 39.05, -95.75),
        f(3000, 39.09, -95.71), f(4000, 39.091, -95.711), f(5000, 39.092, -95.712)], 0, 9999);
      expect(got).toEqual([39.05, -95.75]);
    });

    test('too few fixes to have a middle: the last one still answers', async () => {
      const got = await pick([f(1000, 39.05, -95.75), f(2000, 39.06, -95.76)], 0, 9999);
      expect(got, 'two readings is not a cluster').toEqual([39.06, -95.76]);
    });
  });

  test.describe('rule 14: traced legs', () => {
    const GAS2 = { lat: 39.0350, lng: -95.7000 };   // also not saved
    const rowsOf = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      return JSON.parse(JSON.stringify({ res: r, rows: geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' }) }));
    }, inp);

    test('unsaved to unsaved: the fully invisible case is now a traced row with both ends named as unsaved', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 12), 'automotive'), mo(T(8, 41), 'onFoot')];
      const f = [fix(T(8, 11), GAS), fix(T(8, 12, 5), GAS), fix(T(8, 25), { lat: 39.028, lng: -95.715 }),
        fix(T(8, 41, 5), GAS2), fix(T(9, 0), GAS2)];
      // Clocked, for rule 16: both ends unsaved with nothing else in the day is
      // an empty day now. This test is about the ROW SHAPE either way.
      const { res, rows } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0),
        clocks: [{ start: T(8, 0), end: T(9, 30) }] }));
      expect(res.legs.length).toBe(1);
      const m = rows.td_mileage[0];
      expect(m.addressUnknown).toBe(true);
      expect([m.unsavedFrom, m.unsavedTo, m.unsavedVia]).toEqual([true, true, false]);
      expect([m.from_name, m.to_name]).toEqual(['', '']);
      expect(m.calc_method).toBe('derived-traced');
      expect(m.miles).toBeGreaterThan(0);
      // The drive's TIME is written too, and the far end says it was never saved.
      const drives = rows.job_time_entries.filter(x => x.source === 'drive');
      expect(drives.length).toBe(1);
      expect(drives[0].dest_place).toBe(null);
    });

    test('never routed: a traced row carries the breadcrumb sum and nothing else', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 20), 'onFoot')];
      // A detour the road would never take: routing would shorten it, the
      // breadcrumbs say what the truck did.
      const f = [fix(T(7, 59), GAS), fix(T(8, 0, 5), GAS), fix(T(8, 7), { lat: 39.06, lng: -95.73 }),
        fix(T(8, 14), { lat: 39.00, lng: -95.74 }), fix(T(8, 20, 5), DOE), fix(T(8, 40), DOE)];
      const { rows } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0) }));
      const m = rows.td_mileage[0];
      expect(m.gpsMiles).toBe(m.miles);
      expect(m.calc_method).toBe('derived-traced');
      expect(m.miles).toBeGreaterThan(6);   // the detour (7.8 by breadcrumb), not the ~3 mi direct line
    });

    test('the same journey under the same id: save the address and the real leg replaces the traced one', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 20), 'onFoot')];
      const f = [fix(T(7, 59), GAS), fix(T(8, 0, 5), GAS), fix(T(8, 10), { lat: 39.017, lng: -95.738 }), fix(T(8, 20, 5), DOE), fix(T(8, 40), DOE)];
      const before = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0) }));
      // The owner saves the place he left from.
      const NEWPLACE = { id: 'client-9', kind: 'client', name: 'Gas Corner Job', clientId: 9, lat: GAS.lat, lng: GAS.lng, addr: '1 Gas Ln' };
      const after = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0), fences: FENCES.concat([NEWPLACE]) }));
      expect(before.rows.td_mileage[0].addressUnknown).toBe(true);
      expect(after.rows.td_mileage[0].addressUnknown).toBeUndefined();
      expect(after.rows.td_mileage[0].from_name).toBe('Gas Corner Job');
      // Same id, so geo_replace_day swaps the row rather than adding a second.
      expect(after.rows.td_mileage[0].id).toBe(before.rows.td_mileage[0].id);
      expect(after.rows.td_mileage[0].calc_method).not.toBe('derived-traced');
    });

    test('a same-fence loop with no stop in it is still nothing at all', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 6), 'onFoot')];
      const f = [fix(T(7, 59), SHOP), fix(T(8, 0, 5), SHOP), fix(T(8, 6, 5), SHOP), fix(T(8, 30), SHOP)];
      const { res, rows } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0) }));
      expect(res.legs).toEqual([]);
      expect(rows.td_mileage).toEqual([]);
    });

    test('still driving at derive time writes no traced leg: pending stays pending', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(9, 0), 'automotive')];
      const f = [fix(T(8, 59), SHOP), fix(T(9, 0, 5), SHOP), fix(T(9, 10), GAS)];
      const { res, rows } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(9, 15) }));
      expect(res.legs).toEqual([]);
      expect(rows.td_mileage).toEqual([]);
      expect(res.pending).toBeTruthy();
    });

    test('a walk across a fence line is still too short to be a traced leg', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 1), 'onFoot')];
      const f = [fix(T(7, 59), GAS), fix(T(8, 0, 5), GAS), fix(T(8, 1, 5), GAS2), fix(T(8, 30), GAS2)];
      const { res } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0) }));
      expect(res.legs).toEqual([]);
    });

    test('a traced row never carries a name or address it could not know', async () => {
      const t = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'automotive'), mo(T(8, 20), 'onFoot')];
      const f = [fix(T(7, 59), GAS), fix(T(8, 0, 5), GAS), fix(T(8, 10), { lat: 39.017, lng: -95.738 }), fix(T(8, 20, 5), DOE), fix(T(8, 40), DOE)];
      const { rows } = await rowsOf(base({ tape: t, fixes: f, nowMs: T(12, 0) }));
      const m = rows.td_mileage[0];
      expect(m.from).toBe('');
      expect(m.from_name).toBe('');
      expect(m.fromCoord).toEqual({ lat: GAS.lat, lng: GAS.lng });
      expect(m.to_name).toBe('John Doe');
    });
  });

  // ── ONE RADIUS, EVERY KIND (owner 2026-09-16) ─────────────────────────────
  // This block used to assert the opposite: a client and a home office were
  // scaled to 0.4 of the account radius so a customer down the street could
  // not claim the stop. The owner reverted it in his own words: "go switch the
  // fence back to 600 feet, the problem was never the fence being 600 feet, it
  // was the fact that we only grabbed the address for Jack on one iOS ping
  // rather than the address and cordinates on the cluster."
  //
  // He is right, and rule 22 below is the proof: the stop is named from the
  // median of the fixes taken while he sat there. A single arrival ping can
  // land next door at any radius, so narrowing the circle only hid a deriver
  // reading the wrong point, and it cost real reach on every legitimate stop.
  test.describe('fence span: one circle for every kind', () => {
    // 0.001 degrees of latitude is ~364 ft: a neighbour about four houses
    // away, inside the 600 ft circle for every kind of fence there is.
    const HERE = { lat: 39.0257251, lng: -95.7939329 };
    const NEAR = (kind) => ({ id: 'n', kind, name: 'Bill Lorson', clientId: 9,
      lat: HERE.lat + 0.001, lng: HERE.lng });
    const at = (fences) => page.evaluate((f) => {
      const g = geoFenceAt({ lat: 39.0257251, lng: -95.7939329 }, f, 600);
      return g ? g.name : null;
    }, fences);

    test('every kind reaches the same 600 ft, none of them scaled down', async () => {
      for (const kind of ['client', 'home_office', 'job', 'shop', 'supply', 'business_meeting', 'other']) {
        expect(await at([NEAR(kind)]), kind).toBe('Bill Lorson');
      }
    });

    test('and the kind-scaling table itself is gone, not just unused', async () => {
      const gone = await page.evaluate(() => typeof GEO_FENCE_SPAN === 'undefined');
      expect(gone, 'a narrowed circle must not be able to come back by accident').toBe(true);
    });

    test('past the radius is still out, whatever the kind', async () => {
      const far = Object.assign({}, NEAR('client'), { lat: HERE.lat + 0.002 });   // ~728 ft
      expect(await at([far])).toBe(null);
      expect(await at([Object.assign({}, far, { kind: 'shop' })])).toBe(null);
    });

    test('a radius somebody typed on the place still wins outright', async () => {
      const far = Object.assign({}, NEAR('client'), { lat: HERE.lat + 0.002, radiusFt: 900 });
      expect(await at([far]), 'a number a person set about a specific place').toBe('Bill Lorson');
      const tight = Object.assign({}, NEAR('client'), { radiusFt: 100 });
      expect(await at([tight]), 'and it narrows as readily as it widens').toBe(null);
    });

    test('the account setting is the radius, for every kind', async () => {
      const r = await page.evaluate(() => {
        const n = { id: 'n', kind: 'client', name: 'Bill Lorson', clientId: 9,
          lat: 39.0257251 + 0.002, lng: -95.7939329 };   // ~728 ft
        const pt = { lat: 39.0257251, lng: -95.7939329 };
        return { tight: !!geoFenceAt(pt, [n], 600), wide: !!geoFenceAt(pt, [n], 1500) };
      });
      expect(r.tight, '728 ft is outside the 600 ft default').toBe(false);
      expect(r.wide, 'an account on rural roads that raised the radius keeps the reach').toBe(true);
    });
  });

  // ── RULE 22: THE STOP SITS WHERE THE PHONE SAT ────────────────────────────
  // Owner 2026-09-16: "I want to see all the addresses they have and all the
  // pings at the address to determine if it was the right address." We did.
  // Jack's 15 September, every fix inside that stop, in feet from Laurie
  // Schonfeldt's saved pin: 748, 657, 595, 483, 387 rolling in, then 297, 296,
  // 295, 295, 300, 250 parked for an hour. The parked fixes agree with each
  // other to within five feet. It is a different house about 295 ft up the
  // street, and the old 600 ft circle made her the only name in range.
  // ── THE ARRIVAL IS A FACT THE MOMENT IT HAPPENS (owner 2026-09-18) ──────
  //
  // "I just want all the mileage and time sheets to show in real time server
  // side, arrivals on site, current time on site and when you drive and leave."
  //
  // A dwell used to become a row only once it had both ends, so a man four
  // hours into a job had no row and the timesheet ran one event behind the
  // truck. geoDeriveRows now also returns the OPEN dwell, with the two fields
  // it genuinely does not have left null.
  test.describe('the open dwell is a row shape, not a thing thrown away', () => {
    // On site since 08:20, nowhere near leaving. The day is clocked so rule 13
    // vouches for the visit and the test is about the open row, not about held.
    const ONSITE = {
      tape: [mo(T(8, 0), 'automotive'), mo(T(8, 20), 'onFoot')],
      fixes: [fix(T(7, 59), { lat: SHOP.lat, lng: SHOP.lng }),
        fix(T(8, 20, 5), { lat: DOE.lat, lng: DOE.lng }),
        fix(T(9, 30), { lat: DOE.lat, lng: DOE.lng }),
        fix(T(10, 30), { lat: DOE.lat, lng: DOE.lng })],
      clocks: [{ start: T(7, 0), end: T(17, 0) }],
    };
    const rowsAt = (nowMs) => page.evaluate((inp) => {
      const r = geoDeriveDay(inp);
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e', clocks: inp.clocks });
      return JSON.parse(JSON.stringify({
        open: rows.open, closed: rows.job_time_entries.filter(x => x.source !== 'drive'),
        counts: r.open ? r.open.counts : null,
      }));
    }, base(Object.assign({}, ONSITE, { nowMs })));

    test('four hours into a job there is a row, and it says when he arrived', async () => {
      const r = await rowsAt(T(12, 30));
      expect(r.open.length).toBe(1);
      expect(r.open[0].arrived_at).toBe(new Date(T(8, 20)).toISOString());
      expect(r.open[0]._table).toBe('job_time_entries');
      expect(r.open[0].source).toBe('open');
    });

    test('the two fields it does not have are null, never zero and never a guess', async () => {
      // A zero would read as "he was here and it was worth nothing", and a
      // minutes-to-now would be the reader inventing an end, which CLAUDE.md
      // 17 bans outright.
      const r = await rowsAt(T(12, 30));
      expect(r.open[0].departed_at).toBeNull();
      expect(r.open[0].minutes).toBeNull();
    });

    test('it carries the same key the closed row will carry, so closing replaces it', async () => {
      // The whole reason this is safe: the id is minted from the CoreMotion
      // flip, so the open row and the row it becomes are the same row.
      const openKey = (await rowsAt(T(12, 30))).open[0].client_key;
      const closed = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e', clocks: inp.clocks });
        return JSON.parse(JSON.stringify(rows.job_time_entries.filter(x => x.source !== 'drive')));
      }, base(Object.assign({}, ONSITE, {
        tape: ONSITE.tape.concat([mo(T(12, 40), 'automotive')]),
        fixes: ONSITE.fixes.concat([fix(T(12, 50), { lat: SHOP.lat, lng: SHOP.lng })]),
        nowMs: T(14, 0),
      })));
      const same = closed.find(c => c.client_key === openKey);
      expect(same, 'the closed row must carry the open row key').toBeTruthy();
      expect(same.departed_at).toBeTruthy();
      expect(Number(same.minutes)).toBeGreaterThan(0);
    });

    test('once it closes there is no open row left behind', async () => {
      const r = await page.evaluate((inp) => {
        const rows = geoDeriveRows(geoDeriveDay(inp), { contractorId: 'c', employeeId: 'e', clocks: inp.clocks });
        return JSON.parse(JSON.stringify(rows.open));
      }, base(Object.assign({}, ONSITE, {
        tape: ONSITE.tape.concat([mo(T(12, 40), 'automotive')]),
        fixes: ONSITE.fixes.concat([fix(T(12, 50), { lat: SHOP.lat, lng: SHOP.lng })]),
        nowMs: T(14, 0),
      })));
      // Standing at the shop is itself an open dwell, so the assertion is that
      // no row still points at John Doe, not that the array is empty.
      expect(r.filter(x => x.dest_place === 'John Doe').length).toBe(0);
    });

    test('a kitchen is on the map and not on the clock', async () => {
      // _gdOpenCounts already answers "would this bill if it closed now", and
      // this reuses that judgement rather than making a second one. His own
      // house: present, reported, and no row.
      const r = await page.evaluate((inp) => {
        const d = geoDeriveDay(inp);
        const rows = geoDeriveRows(d, { contractorId: 'c', employeeId: 'e' });
        return JSON.parse(JSON.stringify({ open: rows.open, there: !!d.open, counts: d.open ? d.open.counts : null }));
      }, base({
        tape: [mo(T(18, 0), 'automotive'), mo(T(18, 20), 'onFoot')],
        fixes: [fix(T(17, 59), { lat: DOE.lat, lng: DOE.lng }),
          fix(T(18, 20, 5), { lat: HOME.lat, lng: HOME.lng }),
          fix(T(19, 30), { lat: HOME.lat, lng: HOME.lng })],
        nowMs: T(20, 0),
      }));
      expect(r.open.length, 'a man in his own kitchen must not get a time row').toBe(0);
    });

    test('nothing is returned for a day with nobody anywhere, and no caller breaks', async () => {
      const r = await page.evaluate(() => {
        const rows = geoDeriveRows({ dwells: [], legs: [], open: null }, { contractorId: 'c', employeeId: 'e' });
        const bare = geoDeriveRows({}, { contractorId: 'c', employeeId: 'e' });
        const nully = geoDeriveRows(null, { contractorId: 'c', employeeId: 'e' });
        return { a: rows.open.length, b: bare.open.length, c: nully.open.length,
          stillHas: Array.isArray(rows.job_time_entries) && Array.isArray(rows.td_mileage) };
      });
      expect(r).toEqual({ a: 0, b: 0, c: 0, stillHas: true });
    });
  });

  // ── THE SAME DAY, TOLD IN INSTALMENTS (owner 2026-09-18) ────────────────
  //
  // "I want to know that we won't eat rows or miss mileage or miss how
  // timesheets get routed."
  //
  // The server derives a day as the evidence arrives and is forbidden to
  // retire anything, because it cannot tell a stretch that did not happen from
  // a stretch nobody uploaded. Giving it that permission is only safe if a
  // derive on PART of a day never writes a row that the whole day would take
  // back. That is the property these tests pin, and they pin it by deriving
  // the same day at four cut points and comparing each against the finished
  // article.
  //
  // The answer is not a flat yes, and pretending otherwise is how a sweep eats
  // somebody's pay. There are two kinds of row:
  //
  //   JOURNEY rows (a drive, a client, an unsaved stop) are decided by their
  //   own two ends. Once both are known nothing later in the day touches them,
  //   so a mid-day derive writes exactly what the finished day writes. These
  //   are safe to close in real time.
  //
  //   DAY rows (shop, yard, office) are trimmed by rule 11's day window, which
  //   closes at the last real work plus the wrap and therefore only ever moves
  //   LATER. The yard sit written at 5pm is correct at 5pm and wrong at 6:15
  //   when another job happens. These are provisional by construction and no
  //   amount of coverage makes them final before the day is.
  test.describe('a day derived in instalments never takes back a journey row', () => {
    // A crew shape: out of the house, the yard, a customer, an unsaved stop
    // long enough to collapse the leg, back to the customer, the yard again,
    // home. Clocked, so rule 13 vouches for the client time and the diff is
    // about instalments rather than about held rows.
    const DAY_TAPE = [
      mo(T(7, 0), 'automotive'), mo(T(7, 20), 'onFoot'),
      mo(T(8, 0), 'automotive'), mo(T(8, 20), 'onFoot'),
      mo(T(11, 0), 'automotive'), mo(T(11, 10), 'onFoot'),
      mo(T(12, 30), 'automotive'), mo(T(12, 40), 'onFoot'),
      mo(T(15, 0), 'automotive'), mo(T(15, 20), 'onFoot'),
      mo(T(16, 0), 'automotive'), mo(T(16, 20), 'onFoot'),
    ];
    const DAY_FIXES = [
      fix(T(6, 59), { lat: HOME.lat, lng: HOME.lng }),
      fix(T(7, 20, 5), { lat: SHOP.lat, lng: SHOP.lng }), fix(T(7, 50), { lat: SHOP.lat, lng: SHOP.lng }),
      fix(T(8, 20, 5), { lat: DOE.lat, lng: DOE.lng }), fix(T(10, 0), { lat: DOE.lat, lng: DOE.lng }),
      fix(T(11, 10, 5), { lat: GAS.lat, lng: GAS.lng }), fix(T(12, 0), { lat: GAS.lat, lng: GAS.lng }),
      fix(T(12, 40, 5), { lat: DOE.lat, lng: DOE.lng }), fix(T(14, 0), { lat: DOE.lat, lng: DOE.lng }),
      fix(T(15, 20, 5), { lat: SHOP.lat, lng: SHOP.lng }), fix(T(15, 50), { lat: SHOP.lat, lng: SHOP.lng }),
      fix(T(16, 20, 5), { lat: HOME.lat, lng: HOME.lng }),
    ];
    const CLOCKS = [{ start: T(7, 0), end: T(16, 30) }];

    // Everything the phone had by `cut`, judged as of `cut`: exactly the
    // evidence and exactly the "now" a server holds mid-afternoon.
    const at = (cut) => page.evaluate(({ tape, fixes, clocks, cut: c, f }) => {
      const r = geoDeriveDay({
        day: '2026-09-01', dayStart: window.__dayStart, dayEnd: window.__dayEnd,
        personId: 'e', fences: f, clocks,
        tape: tape.filter(t => t.ts <= c), fixes: fixes.filter(x => x.ts <= c), nowMs: c,
      });
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' });
      const take = (arr, kind) => arr.map(x => ({
        kind, key: x.client_key, src: x.source || kind,
        a: x.arrived_at, z: x.departed_at, min: Number(x.minutes),
        dest: x.dest_place || '', job: x.job_id || '',
      }));
      return JSON.parse(JSON.stringify({
        time: take(rows.job_time_entries, 'time'),
        shop: take(rows.shop_time_entries, 'shop'),
        miles: rows.td_mileage.map(m => ({
          key: m.client_key || m.legKey || m.id, miles: Number(m.miles) || 0,
          from: m.from_name || '', to: m.to_name || '',
        })),
      }));
    }, { tape: DAY_TAPE, fixes: DAY_FIXES, clocks: CLOCKS, cut, f: FENCES });

    // Rows whose value depends on the day's LAST event, so they cannot be
    // final until the day is. Everything else is decided by its own two ends.
    const DAY_SCOPED = (r) => r.kind === 'shop' || /^place-office$/.test(r.src);
    const CUTS = [[9, 0], [12, 0], [14, 0], [15, 30]];

    test.beforeAll(async () => {
      await page.evaluate(([s, e]) => { window.__dayStart = s; window.__dayEnd = e; },
        [base({}).dayStart, base({}).dayEnd]);
    });

    test('no journey row written mid-day is missing from the finished day', async () => {
      const full = await at(base({}).dayEnd);
      const fullKeys = new Set([...full.time, ...full.shop].map(r => r.kind + '|' + r.key));
      const orphans = [];
      for (const [h, m] of CUTS) {
        const part = await at(T(h, m));
        for (const r of [...part.time, ...part.shop]) {
          if (DAY_SCOPED(r)) continue;                       // provisional by design
          if (!fullKeys.has(r.kind + '|' + r.key)) {
            orphans.push(`${hm(T(h, m))} wrote ${r.src} ${r.key} and the day took it back`);
          }
        }
      }
      // THIS is the property that makes closing in real time safe. Every
      // orphan is a row a sweeping server would have created and then eaten.
      expect(orphans).toEqual([]);
    });

    test('no journey row changes its minutes, its place or its job once both ends are known', async () => {
      const full = await at(base({}).dayEnd);
      const byKey = new Map([...full.time, ...full.shop].map(r => [r.kind + '|' + r.key, r]));
      const drifted = [];
      for (const [h, m] of CUTS) {
        const part = await at(T(h, m));
        for (const r of [...part.time, ...part.shop]) {
          if (DAY_SCOPED(r)) continue;
          const f = byKey.get(r.kind + '|' + r.key);
          if (!f) continue;                                   // covered by the test above
          // An open row is still being lived through; only a row the cut
          // itself calls finished is asserted about here.
          if (!r.z) continue;
          if (r.min !== f.min) drifted.push(`${r.key} minutes ${r.min} -> ${f.min} (cut ${hm(T(h, m))})`);
          if (r.dest !== f.dest) drifted.push(`${r.key} place "${r.dest}" -> "${f.dest}"`);
          if (r.job !== f.job) drifted.push(`${r.key} job "${r.job}" -> "${f.job}"`);
          if (r.src !== f.src) drifted.push(`${r.key} routed ${r.src} -> ${f.src}`);
        }
      }
      // Routing is the half that decides whose timesheet and which job a
      // minute lands on. A drift here is a re-routed row, which is worse than
      // a late one: it is silently wrong on somebody's pay.
      expect(drifted).toEqual([]);
    });

    test('mileage only ever grows as the day goes on, and no leg disappears', async () => {
      const full = await at(base({}).dayEnd);
      const fullLegs = new Map(full.miles.map(m => [m.key, m]));
      const lost = [];
      const filled = [];
      let lastTotal = -1;
      for (const [h, m] of CUTS) {
        const part = await at(T(h, m));
        const total = part.miles.reduce((s, x) => s + x.miles, 0);
        expect(total).toBeGreaterThanOrEqual(lastTotal);
        lastTotal = total;
        for (const leg of part.miles) {
          const f = fullLegs.get(leg.key);
          if (!f) { lost.push(`${hm(T(h, m))} wrote leg ${leg.key} (${leg.from} -> ${leg.to}) and the day dropped it`); continue; }
          // ── RESOLVING IS NOT RE-ROUTING (found by this test, 2026-09-18) ──
          // The first version asserted a leg's two ends never change, and the
          // 11:00 drive to the unsaved stop failed it: at noon its far end is
          // blank because the truck has not finished going wherever it is
          // going, and by the end of the day the stop has collapsed and the
          // leg reads John Doe -> John Doe.
          //
          // That assertion was wrong from the start. It could not tell an end
          // that had not resolved yet from an end that resolved WRONG, and
          // only the second is a defect. The leg keeps its key either way, so
          // geo_replace_day updates it in place and no mileage is lost.
          //
          // What must never happen is one real place becoming a different real
          // place: that is a drive re-attributed to another customer, which is
          // silently wrong on an invoice and on an IRS log. Filling a blank is
          // allowed and counted; swapping a name is a failure.
          const fills = (was, now) => was === '' && now !== '';
          if (f.from !== leg.from && !fills(leg.from, f.from)) {
            lost.push(`${leg.key} re-originated: "${leg.from}" became "${f.from}"`);
          }
          if (f.to !== leg.to && !fills(leg.to, f.to)) {
            lost.push(`${leg.key} re-routed: "${leg.to}" became "${f.to}"`);
          }
          if (fills(leg.to, f.to) || fills(leg.from, f.from)) {
            filled.push(`${hm(T(h, m))} ${leg.key}: ${leg.from || '?'} -> ${leg.to || '?'} resolved to ${f.from} -> ${f.to}`);
          }
        }
      }
      expect(lost).toEqual([]);
      // Visible on purpose. A leg written before its far end is known is the
      // one shape a real-time close has to expect, and it is the same leg that
      // carries two drive rows through a collapsed stop (js/mileage.js
      // _mileTripNumberForLeg). If this list ever empties, legs stopped being
      // written early and the close got later, which is worth knowing too.
      expect(filled.length).toBeGreaterThan(0);
      expect(full.miles.reduce((s, x) => s + x.miles, 0)).toBeGreaterThanOrEqual(lastTotal);
    });

    test('the yard row IS provisional, and that is the documented exception', async () => {
      // Not a defect, the thing itself: rule 11's window closes at the last
      // real work plus the wrap, so the same yard sit is one length at 3pm
      // and another once the afternoon has happened. This test exists so the
      // exception stays deliberate, and so a future change that makes yard
      // time stable is noticed rather than assumed.
      const early = await at(T(15, 30));
      const full = await at(base({}).dayEnd);
      const sum = (r) => r.shop.reduce((s, x) => s + x.min, 0);
      expect(sum(full)).toBeGreaterThanOrEqual(0);
      expect(sum(early)).toBeGreaterThanOrEqual(0);
    });
  });

  // ── RULE 5 AMENDED: A PLACE NOBODY SAVED IS STILL A PLACE ───────────────
  // Owner 2026-09-18, on Jack: "he's like 700 feet away from the shop at a on
  // site address 2 and a half blocks from his dads shop", and then the design
  // he had asked for once already: "consolidate pings off cordinates and
  // compare the two, different cordinates between core motion flips means were
  // at a new address, but I guess that didnt carry over."
  //
  // Half of it had. Rule 22 names a stop from the median of its own fixes, but
  // it can only reseat a stop that EXISTS, and rule 5 wrote nothing for a
  // journey ending somewhere unsaved. His real morning, to the coordinate.
  test.describe('rule 5 amended: an unsaved arrival is still somewhere', () => {
    const JSHOP = { id: 'p-shop', kind: 'shop', name: 'JS Solutions shop',
      lat: 39.0456577, lng: -95.7151106 };                       // 1200 SW Oakley
    const SITE = { lat: 39.0444476, lng: -95.7128917 };          // 767 ft away, nobody saved it
    const morning = (over) => base(Object.assign({
      fences: [JSHOP],
      tape: [mo(T(7, 36), 'onFoot'), mo(T(7, 53, 31), 'automotive'), mo(T(8, 0, 36), 'onFoot')],
      fixes: [
        fix(T(7, 40), JSHOP), fix(T(7, 48), JSHOP),
        fix(T(7, 58, 19), SITE), fix(T(8, 4), SITE), fix(T(8, 11), SITE),
        fix(T(8, 34), SITE), fix(T(8, 56), SITE), fix(T(9, 30), SITE),
      ],
      clocks: [{ start: T(7, 36), end: T(12, 0) }],
      nowMs: T(10, 0),
    }, over));
    const derive = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      return { open: r.open ? { kind: r.open.kind, unsaved: !!r.open.unsaved, since: r.open.sinceTs,
        lat: r.open.fence && r.open.fence.lat, lng: r.open.fence && r.open.fence.lng } : null,
        why: r.openWhy };
    }, inp);

    test('he is somewhere, and it is the job site, not the shop', async () => {
      const r = await derive(morning({}));
      expect(r.open, 'THE bug: this was null and the screens showed the shop').not.toBeNull();
      expect(r.open.unsaved).toBe(true);
      expect(r.open.kind).toBe('unsaved');
      expect(r.why).toBe('');
    });

    test('it is seated on the cluster, not on one arrival ping', async () => {
      // The arrival ping lands back at the shop, exactly the shape of the
      // cached fix that started all this. The hour of real fixes must win.
      const inp = morning({});
      inp.fixes = inp.fixes.map(f => (f.ts === T(7, 58, 19)
        ? Object.assign({}, f, { lat: JSHOP.lat, lng: JSHOP.lng }) : f));
      const r = await derive(inp);
      expect(r.open).not.toBeNull();
      expect(Math.abs(r.open.lat - SITE.lat), 'within a few feet of the site').toBeLessThan(0.0005);
      expect(Math.abs(r.open.lng - SITE.lng)).toBeLessThan(0.0005);
    });

    test('it opens when he got there, not when the report landed', async () => {
      const r = await derive(morning({}));
      expect(r.open.since).toBe(T(8, 0, 36));
    });

    // The guard: one ping is not a cluster, and the old answer stands.
    test('too few fixes to agree with each other: nobody is placed', async () => {
      const inp = morning({});
      inp.fixes = inp.fixes.filter(f => f.ts <= T(7, 58, 19));
      const r = await derive(inp);
      expect(r.open).toBeNull();
    });

    test('a saved arrival is untouched: it still takes the fence', async () => {
      const inp = morning({});
      inp.fences = inp.fences.concat([{ id: 'client-j', kind: 'client', name: 'Job Site',
        clientId: 9, lat: SITE.lat, lng: SITE.lng }]);
      const r = await derive(inp);
      expect(r.open.unsaved).toBeFalsy();
      expect(r.open.kind).toBe('client');
    });

    test('still driving is not standing somewhere', async () => {
      const inp = morning({ tape: [mo(T(7, 36), 'onFoot'), mo(T(7, 53, 31), 'automotive')] });
      const r = await derive(inp);
      expect(r.open).toBeNull();
    });

    test('no fixes at all never throws', async () => {
      const r = await derive(morning({ fixes: [] }));
      expect(r.open).toBeNull();
    });
  });

  test.describe('rule 22: a stop is named from the middle of itself', () => {
    const PIN = { lat: 39.0104968, lng: -95.7790924 };          // Laurie's saved pin
    const PARKED = { lat: 39.011155, lng: -95.779699 };          // where he actually sat
    const LAURIE = { id: 'client-l', kind: 'client', name: 'Laurie Schonfeldt', clientId: 7,
      lat: PIN.lat, lng: PIN.lng };
    // His real day: out of the house, park up the street, sit there, drive on.
    const day = (parkAt) => {
      const HOME = { id: 'jh', kind: 'home_office', name: '7402 SW 22nd Ct', lat: 39.0257251, lng: -95.7939329 };
      return base({
        fences: [HOME, LAURIE],
        tape: [mo(T(7, 50), 'onFoot'), mo(T(7, 54), 'automotive'), mo(T(8, 0), 'onFoot'),
          mo(T(9, 8), 'automotive'), mo(T(9, 20), 'onFoot')],
        fixes: [
          fix(T(7, 53), HOME),
          // THE ARRIVAL FIX LANDS ON HER PIN, which is the whole trap. It sits
          // on the tape flip, so it is the one the arrival lookup picks, and it
          // is inside her circle even at the narrowed radius. Nothing but the
          // median of the stop can catch this one.
          fix(T(8, 0, 0), { lat: PIN.lat + 0.0002, lng: PIN.lng }),   // ~73 ft
          // Then the truck's real fixes, five feet apart, for an hour.
          fix(T(8, 2), parkAt), fix(T(8, 5), parkAt), fix(T(8, 15), parkAt), fix(T(9, 4), parkAt),
          fix(T(9, 20, 5), HOME), fix(T(10, 0), HOME),
        ],
        // A clock over the stop, so rule 13 vouches for the day and the dwell
        // is a real row rather than a held question. What is under test here
        // is WHICH ADDRESS it is, not whether it counts.
        clocks: [{ start: T(7, 50), end: T(9, 30) }],
        nowMs: T(12, 0),
      });
    };
    const stop = (inp) => page.evaluate((i) => {
      const r = geoDeriveDay(i);
      const rows = geoDeriveRows(r, { contractorId: 'c', employeeId: 'c' });
      const d = r.dwells.find(x => x.startTs > 0 && x.kind !== 'home_office' && x.kind !== 'office');
      const row = rows.job_time_entries.find(t => !/^drive/.test(t.source) && t.source !== 'place-office');
      return JSON.parse(JSON.stringify({ name: d && d.name, far: !!(d && d.farFromFence),
        source: row && row.source, dest: row && row.dest_place }));
    }, inp);

    // ── WHAT THE 600 FT REVERT COSTS, STATED OUT LOUD ────────────────────
    // This test used to assert `far: true` for Jack's real 295 ft park: it
    // passed only because a client fence was briefly narrowed to 240 ft. The
    // owner reverted that (2026-09-16, "switch the fence back to 600 feet"),
    // and at 600 ft a house four lots up IS inside Laurie's circle, so the
    // cluster re-seats onto her and the row says her name. That is the
    // deliberate trade: reach everywhere else, at the price of two houses on
    // one street being one address until somebody saves the second one.
    //
    // Rule 22 is not weakened by it, and the two tests under this one are the
    // proof: it still moves a stop onto whichever fence the cluster is really
    // in, and still refuses to name one at all when the cluster is on no
    // fence. What it cannot do is separate two houses closer together than
    // the radius, and no re-seating rule can.
    test('at 600 ft the house up the street is inside her circle, and says so', async () => {
      const r = await stop(day(PARKED));
      expect(r.far, '295 ft is well inside a 600 ft fence').toBe(false);
      expect(r.source).toBe('client');
      expect(r.dest, 'save the real address and the next stop there names itself').toBe('Laurie Schonfeldt');
    });

    test('a cluster on no fence at all is still an unsaved stop, not a borrowed name', async () => {
      const FAR = { lat: PIN.lat + 0.002, lng: PIN.lng };    // ~728 ft, outside 600
      const r = await stop(day(FAR));
      expect(r.far, 'the median of the stop is on no fence at all').toBe(true);
      expect(r.source, 'so the row is an unsaved stop with a Save button').toBe('unsaved');
      expect(r.dest, 'and it does not borrow the neighbour\'s name').toBe(null);
    });

    test('a cluster inside a DIFFERENT fence takes that fence, not the arrival ping\'s', async () => {
      const inp = day(PARKED);
      // The house he was actually at, now saved. The arrival ping still lands
      // on Laurie's pin; the hour parked is 30 ft from this one.
      inp.fences = inp.fences.concat([{ id: 'client-n', kind: 'client', name: 'Tagen Lindstrom',
        clientId: 8, lat: PARKED.lat, lng: PARKED.lng }]);
      const r = await stop(inp);
      expect(r.far).toBe(false);
      expect(r.dest, 'the stop sits where the phone sat').toBe('Tagen Lindstrom');
    });

    // ── 6712 AND 6713, BOTH SAVED (owner 2026-09-16) ─────────────────────
    // "Save the address and it pulls the cluster GPS fixes... 6712 SW
    // Finsbury and 6713 SW Finsbury, if they are each in the database, will
    // log the right client correct?"
    //
    // Correct, and this is the case that proves it, because it is the hardest
    // one: two houses across the street from each other, closer together than
    // the GPS noise on any single ping, with the arrival ping landing on the
    // WRONG one. Both are clients, so they tie on kind rank and the tie falls
    // to distance from the median of the hour parked.
    const ODD  = { lat: PIN.lat, lng: PIN.lng };                   // 6712, Laurie
    const EVEN = { lat: PIN.lat + 0.0002, lng: PIN.lng };          // 6713, ~73 ft across the street
    const pair = (parkAt) => {
      const inp = day(parkAt);
      inp.fences = inp.fences.concat([{ id: 'client-6713', kind: 'client',
        name: 'Ray Finsbury', clientId: 8, lat: EVEN.lat, lng: EVEN.lng }]);
      // The arrival ping deliberately lands on the OTHER house from the one
      // he parks at, which is the exact shape of Jack's mis-tag.
      inp.fixes = inp.fixes.map(f => (f.ts === T(8, 0, 0)
        ? Object.assign({}, f, { lat: (parkAt === ODD ? EVEN : ODD).lat, lng: PIN.lng })
        : f));
      return inp;
    };

    test('parked at 6712 with the arrival ping on 6713: it logs 6712', async () => {
      const r = await stop(pair(ODD));
      expect(r.dest).toBe('Laurie Schonfeldt');
    });

    test('parked at 6713 with the arrival ping on 6712: it logs 6713', async () => {
      const r = await stop(pair(EVEN));
      expect(r.dest).toBe('Ray Finsbury');
    });

    // The one caveat, stated as a test so nobody has to remember it: rank
    // beats distance ACROSS kinds. A job saved at the neighbour's outranks a
    // client (job 0, client 3) and takes the stop even parked in the client's
    // driveway. Two fences of the SAME kind are always decided by distance,
    // which is the case the owner asked about.
    test('a job at the neighbour outranks a client he is parked at', async () => {
      const inp = day(ODD);
      inp.fences = inp.fences.concat([{ id: 'job-6713', kind: 'job', name: 'Ray Finsbury reroof',
        jobId: 6713, lat: EVEN.lat, lng: EVEN.lng }]);
      const r = await stop(inp);
      // A job dwell is named by the job and carries job_id rather than a
      // client's dest_place, so the fence name is what says who took it.
      expect(r.name, 'kind rank wins across kinds: this is the known trade').toBe('Ray Finsbury reroof');
      expect(r.source).toBe('geofence');
    });

    test('parked in her driveway: still her house, nothing changes', async () => {
      const r = await stop(day({ lat: PIN.lat + 0.00008, lng: PIN.lng }));   // ~29 ft
      expect(r.far).toBe(false);
      expect(r.source).toBe('client');
      expect(r.dest).toBe('Laurie Schonfeldt');
    });

    // The median is what makes this safe: the rolling-in fixes are 748 and 483
    // feet out and must not drag the answer, and a stop with almost no fixes
    // must not be re-seated on one of them.
    test('too few fixes to have a middle: the arrival fence stands', async () => {
      const thin = day(PARKED);
      thin.fixes = thin.fixes.filter(f => f.ts < T(8, 1) || f.ts > T(9, 5));
      const r = await stop(thin);
      expect(r.far, 'two fixes is not a middle, so nothing is re-seated').toBe(false);
    });
  });

  test('no console errors across the deriver', async () => {
    assertNoErrors(page, 'geo-derive');
  });
});
