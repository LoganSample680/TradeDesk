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
      expect(r.legs[0].miles).toBe(0);
      // The yard dwell 10:00 to 11:00 is real: he arrived and later departed.
      expect(r.dwells.map(d => [d.name, hm(d.startTs), hm(d.endTs)])).toEqual([['The yard', '15:00', '16:00']]);
      const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
      // Two drive rows out of the round trip, one out of the leg to Doe.
      expect(rows.job_time_entries.filter(t => t.source === 'drive').length).toBe(3);
      // And ONE mileage row: the round trip contributes none.
      expect(rows.td_mileage.map(m => m.to_name)).toEqual(['John Doe']);
    });

    test('never resolved that day: nothing written, reported as pending', async () => {
      const t3 = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot')];
      const f3 = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(10, 0, 5), { lat: 39.05, lng: -95.70 })];
      const r = await run(page, base({ tape: t3, fixes: f3 }));
      expect(r.legs).toEqual([]);
      expect(r.dwells).toEqual([]);
      expect(r.pending).toBeTruthy();
      expect(r.pending.origin.name).toBe('TradeDesk shop');
      expect(r.pending.stops).toBe(2);
      expect(r.pending.autoMinutes).toBe(40);
    });

    test('a day that starts somewhere unsaved: no leg into the first fence, but the dwell opens there', async () => {
      const t4 = [mo(T(7, 0), 'onFoot'), mo(T(8, 0), 'driving'), mo(T(8, 20), 'onFoot'), mo(T(12, 0), 'driving'), mo(T(12, 10), 'onFoot')];
      const f4 = [fix(T(8, 0, 5), GAS), fix(T(8, 20, 5), DOE), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(12, 30), SHOP)];
      const r = await run(page, base({ tape: t4, fixes: f4 }));
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([['John Doe', 'TradeDesk shop']]);
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
        // drives are real for every fence kind EXCEPT his own house, where
        // there is nothing to say the trip was work; the mileage never is.
        const house = from === 'home_office';
        expect(r.legs.map(l => [l.from.kind, l.to.kind, !!l.roundTrip, l.miles]))
          .toEqual(house ? [] : [[from, from, true, 0]]);
        const rows = await page.evaluate((res) => geoDeriveRows(res, { contractorId: 'C', employeeId: 'E' }), r);
        expect(rows.job_time_entries.filter(t2 => t2.source === 'drive').length).toBe(house ? 0 : 2);
        expect(rows.td_mileage).toEqual([]);
      });
    }
  });

  // ── A departure needs corroboration ─────────────────────────────────────
  // Owner, standing at John Doe all day 2026-09-03: no Dynamic Island, no
  // lock screen, and the Time Log cut his afternoon at 14:19. One cached fix
  // 343 ft out at a foreground wake closed a visit that was still running,
  // and a closed visit means `open` is null, so nothing was ever published
  // to the on-site card or the Live Activity.
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
      expect(r2.legs, 'starting at the unsaved stop, the shop fix is never reached for').toEqual([]);
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
      expect(r.legs).toEqual([]);
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
      // 9:20 stop stays unknown, so shop -> unknown -> shop is a round trip.
      // This fixture's SHOP sits 30 ft from HOME, so it is his house, and a
      // round trip out of the house writes nothing at all (rule 7 as amended
      // 2026-09-04 is scoped away from the house).
      const r2 = await run(page, base({ tape, fixes: [fix(T(9, 0, 5), SHOP), fix(T(12, 0, 5), DOE), fix(T(12, 10, 5), SHOP), fix(T(12, 30), SHOP)] }));
      expect(r2.legs).toEqual([]);
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
      expect(r.legs.map(l => [l.from.name, l.to.name])).toEqual([['TradeDesk shop', 'John Doe'], ['John Doe', 'TradeDesk shop']]);
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
      const r = await run(page, base({ tape, fixes, fences: [JHOME], nowMs: T(10, 0) }));
      // The gym is not saved, and a round trip out of the HOUSE and back is
      // not work (rule 7 as amended 2026-09-04 is scoped away from the house
      // for exactly this day).
      expect(r.legs).toEqual([]);
      expect(r.dwells.filter(d => d.kind === 'home_office')).toEqual([]);
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
      }, base({ tape, fixes, fences: JFENCES, nowMs: T(18, 0) }));
      const time = rows.job_time_entries;
      expect(time.map(t => t.source).sort()).toEqual(['drive', 'drive']);
      expect(time.some(t => t.source === 'place-home')).toBe(false);
      expect(rows.shop_time_entries.length).toBe(1);
      // The drives still name the house as where they went.
      expect(time.map(t => t.dest_place).sort()).toEqual(['1200 SW Oakley Ave', '7402 SW 22nd Ct']);
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
      const fixes = [fix(T(7, 0), JF), fix(T(7, 11, 28), JF), fix(T(7, 23), NEARLY),
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
    test('with no fix after the flip at all, nothing is invented', async () => {
      const tape = [mo(T(7, 0), 'onFoot'), mo(T(7, 11, 28), 'automotive'), mo(T(7, 50, 34), 'onFoot')];
      const fixes = [fix(T(7, 0), JF), fix(T(7, 11, 28), JF), fix(T(7, 48, 18), NEARLY)];
      const r = await run(page, base({ tape, fixes, fences: JFENCES, nowMs: T(9, 0) }));
      expect(r.legs).toEqual([]);
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
      fix(T(14, 59, 5), C4), fix(T(15, 18, 5), { lat: JH.lat, lng: JH.lng }), fix(T(16, 0), { lat: JH.lat, lng: JH.lng }),
    ];

    test('five drives are five rows, and the standing between them is left for the clock to name', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: F, nowMs: T(18, 0) }));
      const drives = rows.job_time_entries.filter(t => t.source === 'drive');
      expect(drives.length, 'shop to C1 to C2 to C3 to C4 to home').toBe(5);
      // No row spans a stop any more: each ends where the tape said he got out.
      expect(drives.map(d => [d.arrived_at.slice(11, 16), d.departed_at.slice(11, 16)])).toEqual([
        ['17:04', '17:15'], ['18:04', '18:09'], ['18:45', '18:55'],
        ['19:24', '19:30'], ['19:59', '20:18'],
      ]);
      // Only the last one has reached anywhere with a name on it.
      expect(drives.map(d => d.dest_place)).toEqual([null, null, null, null, '7402 SW 22nd Ct']);
      // Unique keys, or geo_replace_day would upsert them over each other.
      expect(new Set(drives.map(d => d.client_key)).size).toBe(5);
    });

    // EVERY STOP IS A ROW (owner 2026-09-04): "we should be logging every flip
    // to onsite unsaved address and every drive with times in between."
    test('the four stops between the five drives are four rows of their own', async () => {
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape, fixes, fences: F, nowMs: T(18, 0) }));
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
      }, base({ tape, fixes, fences: F, nowMs: T(18, 0) }));
      expect(rows.td_mileage.length, 'one leg, not five').toBe(1);
      expect(rows.td_mileage[0].from_name).toBe('1200 SW Oakley Ave');
      expect(rows.td_mileage[0].to_name).toBe('7402 SW 22nd Ct');
      expect(rows.td_mileage[0].calc_method).toContain('derived-');
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
          fix(T(14, 49), FAR2), fix(T(14, 49, 50), { lat: JH.lat, lng: JH.lng }),
          fix(T(14, 56, 5), { lat: JH.lat, lng: JH.lng }), fix(T(15, 30), { lat: JH.lat, lng: JH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: F, nowMs: T(18, 0) }));
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
        const HERE = { lat: 39.0369, lng: -95.7051 };
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(14, 44), 'automotive'), mo(T(14, 47), 'onFoot'),
          mo(T(14, 48), 'automotive'), mo(T(14, 56), 'onFoot')];
        const f = [fix(T(14, 44, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(14, 46, 50), HERE), fix(T(14, 48, 10), HERE),
          fix(T(14, 56, 5), { lat: JH.lat, lng: JH.lng }), fix(T(15, 30), { lat: JH.lat, lng: JH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: F, nowMs: T(18, 0) }));
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
          fix(T(13, 45, 5), { lat: JH.lat, lng: JH.lng }), fix(T(14, 30), { lat: JH.lat, lng: JH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: F, nowMs: T(18, 0) }));
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(2);
        expect(rows.job_time_entries.filter(x => x.source === 'unsaved')
          .map(x => x.minutes)).toEqual([72]);
      });

      test('a short gap with no fixes at all is not a stop: nothing is invented', async () => {
        const t = [mo(T(11, 0), 'onFoot'),
          mo(T(12, 4), 'automotive'), mo(T(12, 18), 'cycling'),
          mo(T(12, 20), 'automotive'), mo(T(12, 40), 'onFoot')];
        const f = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
          fix(T(12, 40, 5), { lat: JH.lat, lng: JH.lng }), fix(T(13, 30), { lat: JH.lat, lng: JH.lng })];
        const rows = await page.evaluate((inp) => {
          const r = geoDeriveDay(inp);
          return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
        }, base({ tape: t, fixes: f, fences: F, nowMs: T(18, 0) }));
        expect(rows.job_time_entries.filter(x => x.source === 'drive').length).toBe(1);
        expect(rows.job_time_entries.filter(x => x.source === 'unsaved').length).toBe(0);
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
      const f3 = [fix(T(9, 17, 5), { lat: DS.lat, lng: DS.lng }), fix(T(9, 30), OUT917),
        fix(T(9, 48, 5), OUT917), fix(T(10, 25), OUT917), fix(T(10, 51, 5), OUT917),
        fix(T(11, 20, 5), { lat: DS.lat, lng: DS.lng }), fix(T(12, 0), { lat: DS.lat, lng: DS.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t3, fixes: f3, fences: F, nowMs: T(14, 0) }));
      const drives = rows.job_time_entries.filter(t => t.source === 'drive');
      expect(drives.map(d => [d.arrived_at.slice(11, 16), d.departed_at.slice(11, 16)])).toEqual([
        ['14:17', '14:48'], ['15:51', '16:20'],
      ]);
      // The first ends at a stop nobody saved; the second genuinely reaches
      // the shop, which is saved, so it says so.
      expect(drives.map(d => d.dest_place)).toEqual([null, '1200 SW Oakley Ave']);
      // The hour he stood out there is its own row between them.
      const stops = rows.job_time_entries.filter(t => t.source === 'unsaved');
      expect(stops.map(t => [t.arrived_at.slice(11, 16), t.departed_at.slice(11, 16)]))
        .toEqual([['14:48', '15:51']]);
      // And nothing enters the IRS log for a trip with no saved far end.
      expect(rows.td_mileage).toEqual([]);
    });

    // A clean run with nothing in between is still ONE row: this must not
    // shatter an ordinary drive.
    test('a drive with no stop in it is still a single row', async () => {
      const t2 = [mo(T(11, 0), 'onFoot'), mo(T(12, 4), 'automotive'), mo(T(12, 20), 'onFoot')];
      const f2 = [fix(T(12, 4, 5), { lat: DS.lat, lng: DS.lng }),
                  fix(T(12, 20, 5), { lat: JH.lat, lng: JH.lng }), fix(T(13, 0), { lat: JH.lat, lng: JH.lng })];
      const rows = await page.evaluate((inp) => {
        const r = geoDeriveDay(inp);
        return JSON.parse(JSON.stringify(geoDeriveRows(r, { contractorId: 'c', employeeId: 'e' })));
      }, base({ tape: t2, fixes: f2, fences: F, nowMs: T(15, 0) }));
      const drives = rows.job_time_entries.filter(t => t.source === 'drive');
      expect(drives.length).toBe(1);
      expect(drives[0].dest_place).toBe('7402 SW 22nd Ct');
    });
  });

  test('no console errors across the deriver', async () => {
    assertNoErrors(page, 'geo-derive');
  });
});
