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

    test('back to where it started, via the stop, is a round trip: no leg', async () => {
      const t2 = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot'), mo(T(9, 40), 'driving'), mo(T(10, 0), 'onFoot'), mo(T(11, 0), 'driving'), mo(T(11, 10), 'onFoot')];
      const f2 = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), GAS), fix(T(9, 40, 5), GAS), fix(T(10, 0, 5), SHOP), fix(T(11, 0, 5), SHOP), fix(T(11, 10, 5), DOE)];
      const r = await run(page, base({ tape: t2, fixes: f2 }));
      // shop -> gas -> shop is nothing. shop -> Doe at 11:00 is a leg.
      expect(r.legs.map(l => [l.from.name, l.to.name, hm(l.startTs)])).toEqual([['TradeDesk shop', 'John Doe', '16:00']]);
      // The shop dwell 10:00 to 11:00 is real: he arrived and later departed.
      expect(r.dwells.map(d => [d.name, hm(d.startTs), hm(d.endTs)])).toEqual([['TradeDesk shop', '15:00', '16:00']]);
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

    test('no fix near a flip means unknown, never a guess', async () => {
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      // The only fixes are 40 minutes from either flip: outside the window.
      const f = [fix(T(8, 20), SHOP), fix(T(10, 0), DOE)];
      const r = await run(page, base({ tape: t, fixes: f }));
      expect(r.legs).toEqual([]);
      expect(r.pending).toBeNull();
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
      const t = [mo(T(8, 0), 'onFoot'), mo(T(9, 0), 'driving'), mo(T(9, 20), 'onFoot')];
      const f = [fix(T(9, 0, 5), SHOP), fix(T(9, 20, 5), DOE), fix(T(10, 30), DOE), fix(T(11, 0), GAS)];
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

  test('no console errors across the deriver', async () => {
    assertNoErrors(page, 'geo-derive');
  });
});
