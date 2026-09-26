// @ts-check
// ── RULE 23: A SAVED ADDRESS LEARNS WHERE IT ACTUALLY IS ────────────────────
//
// Owner 2026-09-16, having measured his own account first: "the persons
// address should go off the maintenance pings we get when hes truly on site,
// thats where we pull the differentior." Then, on the design fork: "are we
// designing the learning pin on where the truck gets parked or where the most
// clusters sit while actively working on the house?"
//
// Neither. The pin is aimed at the MEASUREMENT, because the matcher compares a
// stop's settled cluster against the fence, and a learned point that lives
// anywhere else puts the offset straight back.
//
// The numbers these tests are built on are his, not invented. Twenty visits to
// one client over three weeks, feet from the saved pin to that visit's cluster:
// 59, 62, 62, 63, 64, 65, 67, 69, 69, 69, 74, 75, 77, 78, 79, 80, 80, 81, 84,
// 87. Mean 72, every visit inside 15 ft of it. A systematic 72 ft to learn away
// and a random 14 ft that is the real precision.
//
// Two halves, tested separately because they fail differently: the RULES
// (js/geo-derive.js, pure) decide which visits may teach and what they add up
// to; the RECORD half (js/geo-anchor.js) is the only thing that reads or writes
// a client or a place.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const DAY_START = Date.parse('2026-09-01T05:00:00Z');
const T = (h, m, s) => DAY_START + h * 3600000 + m * 60000 + (s || 0) * 1000;

// His real numbers: the pin the geocoder dropped, and where the truck sits.
const PIN = { lat: 39.0123292, lng: -95.7464936 };
const SAT = { lat: 39.0125540, lng: -95.7464200 };   // ~82 ft north of the pin
const DOE = { id: 'client-1788214075432', kind: 'client', name: 'John Doe',
  clientId: '1788214075432', lat: PIN.lat, lng: PIN.lng };
const SHOP = { id: 'place-9', kind: 'shop', name: 'The yard', lat: 39.0307066, lng: -95.7112082 };

// A dwell as the deriver hands it to rule 23: a fence, a span, and the median
// of its own settled fixes.
const dwell = (over) => Object.assign({
  fence: DOE, kind: 'client', name: 'John Doe',
  startTs: T(8, 0), endTs: T(12, 0),
  spot: { lat: SAT.lat, lng: SAT.lng, n: 30 },
}, over);

// A sighting as it is stored on the record.
const seen = (d, at) => ({ d, lat: at.lat, lng: at.lng, n: 20 });
// Feet off a base point, north.
const north = (base, ft) => ({ lat: base.lat + ft / 364000, lng: base.lng });

test.describe('rule 23: the rules half (js/geo-derive.js)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { try { await page.context().close(); } catch (_e) { } });

  const sight = (dwells, fences, opts) => page.evaluate(
    ([d, f, o]) => JSON.parse(JSON.stringify(geoAnchorSightings(d, f, o || {}))), [dwells, fences, opts || {}]);
  const anchor = (list, opts) => page.evaluate(
    ([l, o]) => { const r = geoAnchorOf(l, o || {}); return r ? [r.lat, r.lng, r.n] : null; }, [list, opts || {}]);

  test('a clean visit teaches its fence where it sat', async () => {
    const got = await sight([dwell()], [DOE, SHOP], {});
    expect(got.length).toBe(1);
    expect(got[0].id).toBe(DOE.id);
    expect(got[0].lat).toBe(SAT.lat);
  });

  // THE GUARD THAT MATTERS MOST. A stop whose cluster sits inside two fences
  // teaches neither, because that is exactly the neighbour case: learn it once
  // and the pin walks toward the house next door, then keeps confirming
  // itself. Ambiguity has to stop the learning dead.
  test('two names in range and it learns nothing', async () => {
    const NEIGHBOUR = { id: 'client-99', kind: 'client', name: 'Next door',
      clientId: '99', lat: PIN.lat + 0.0006, lng: PIN.lng };   // ~218 ft, both contain the spot
    expect(await sight([dwell()], [DOE, NEIGHBOUR], {})).toEqual([]);
  });

  test('a held, dismissed, re-seated, far-from-fence or still-open stop teaches nothing', async () => {
    for (const over of [{ held: true }, { dismissed: true }, { reseated: true },
                        { farFromFence: true }, { open: true }, { spot: null }, { fence: null }]) {
      expect(await sight([dwell(over)], [DOE, SHOP], {}), JSON.stringify(over)).toEqual([]);
    }
  });

  test('a stop too short to have a middle teaches nothing', async () => {
    expect(await sight([dwell({ endTs: T(8, 9) })], [DOE, SHOP], {}), 'nine minutes').toEqual([]);
    expect((await sight([dwell({ endTs: T(8, 10) })], [DOE, SHOP], {})).length, 'ten does').toBe(1);
  });

  // A sighting far from the pin is a different place, not a correction.
  // Averaging it in is how a pin walks away from its own address.
  test('a sighting past the drift limit is not a correction', async () => {
    const far = dwell({ spot: Object.assign({ n: 30 }, north(PIN, 200)) });
    expect(await sight([far], [DOE], {})).toEqual([]);
    const near = dwell({ spot: Object.assign({ n: 30 }, north(PIN, 140)) });
    expect((await sight([near], [DOE], {})).length).toBe(1);
  });

  test('one visit never moves a pin, and neither do two', async () => {
    expect(await anchor([seen('2026-09-01', SAT)])).toBe(null);
    expect(await anchor([seen('2026-09-01', SAT), seen('2026-09-02', SAT)])).toBe(null);
  });

  test('three agreeing visits set the anchor on their middle', async () => {
    const got = await anchor([seen('2026-09-01', north(SAT, -10)), seen('2026-09-02', SAT),
      seen('2026-09-03', north(SAT, 10))]);
    expect(got[2], 'all three agreed').toBe(3);
    expect(Math.abs(got[0] - SAT.lat) * 364000 < 1, 'and the middle one is the answer').toBe(true);
  });

  // His real spread, to the foot: three visits scattered across 28 ft still
  // agree, because the agreement band is 40.
  test('his own spread still counts as agreement', async () => {
    const got = await anchor([seen('2026-09-01', north(PIN, 59)), seen('2026-09-02', north(PIN, 72)),
      seen('2026-09-03', north(PIN, 87))]);
    expect(got[2]).toBe(3);
    expect(Math.round((got[0] - PIN.lat) * 364000), 'the median of 59, 72 and 87').toBe(72);
  });

  test('a stray that cleared every other guard still cannot shift the answer', async () => {
    const got = await anchor([seen('2026-09-01', SAT), seen('2026-09-02', SAT),
      seen('2026-09-03', SAT), seen('2026-09-04', north(SAT, 130))]);
    expect(got[2], 'the stray is not one of the agreeing four').toBe(3);
    expect(got[0], 'and it is not in the median either').toBe(SAT.lat);
  });

  test('three sightings that agree with nothing set no anchor at all', async () => {
    expect(await anchor([seen('2026-09-01', north(PIN, 0)), seen('2026-09-02', north(PIN, 120)),
      seen('2026-09-03', north(PIN, 240))]), 'no three of them are within 40 ft').toBe(null);
  });

  test('junk never throws and never invents an anchor', async () => {
    const ok = await page.evaluate(() => {
      try {
        geoAnchorSightings(null, null, null);
        geoAnchorSightings([null, {}, { fence: {}, spot: {} }], [null, {}], {});
        return [geoAnchorOf(null), geoAnchorOf([]), geoAnchorOf([{}, { lat: 'x', lng: 1 }, null]),
          geoAnchorOf([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }, { lat: 'no', lng: 2 }])];
      } catch (e) { return 'threw: ' + e.message; }
    });
    expect(ok).toEqual([null, null, null, null]);
  });

  test('no console errors across the rules half', () => { assertNoErrors(page, 'geo-anchor rules'); });
});

test.describe('rule 23: the record half (js/geo-anchor.js)', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { try { await page.context().close(); } catch (_e) { } });

  // One client in memory, this device owning the account, and saveAll stubbed
  // so the test never reaches the cloud.
  const run = (days, over) => page.evaluate(([ds, ov, doe, sat]) => {
    const savedClients = clients.slice();
    const saved = { save: window.saveAll, own: window._geoViewingSomebodyElse, cid: window._geoCid, u: window._supaUser };
    let saves = 0;
    try {
      window._supaUser = { id: 'u1' };
      window._geoCid = () => 'u1';
      window._geoViewingSomebodyElse = () => false;
      window.saveAll = () => { saves++; };
      clients.length = 0;
      clients.push(Object.assign({ id: '1788214075432', name: 'John Doe', addr: '2950 SW McClure Rd',
        geoAddr: '2950 SW McClure Rd', lat: doe.lat, lon: doe.lng }, ov || {}));
      for (const d of ds) {
        geoAnchorRecord({ dwells: [{ fence: doe, kind: 'client', name: 'John Doe',
          startTs: d.start, endTs: d.end, spot: { lat: d.lat, lng: d.lng, n: 30 } }] }, [doe], {});
      }
      const c = clients[0];
      return JSON.parse(JSON.stringify({ seen: c.anchorSeen || null, anchor: c.anchor || null,
        lat: c.lat, lon: c.lon, saves }));
    } finally {
      window.saveAll = saved.save; window._geoViewingSomebodyElse = saved.own;
      window._geoCid = saved.cid; window._supaUser = saved.u;
      clients.length = 0; savedClients.forEach(c => clients.push(c));
    }
  }, [days, over || null, DOE, SAT]);

  // Three different days, each a four-hour visit sitting where he really sits.
  const threeDays = [
    { start: Date.parse('2026-09-01T13:00:00Z'), end: Date.parse('2026-09-01T17:00:00Z'), lat: SAT.lat - 10 / 364000, lng: SAT.lng },
    { start: Date.parse('2026-09-02T13:00:00Z'), end: Date.parse('2026-09-02T17:00:00Z'), lat: SAT.lat, lng: SAT.lng },
    { start: Date.parse('2026-09-03T13:00:00Z'), end: Date.parse('2026-09-03T17:00:00Z'), lat: SAT.lat + 10 / 364000, lng: SAT.lng },
  ];

  test('three days of visits set the anchor, and the address is never touched', async () => {
    const r = await run(threeDays);
    expect(r.seen.length, 'one sighting per day').toBe(3);
    expect(r.anchor, 'and the anchor lands').not.toBe(null);
    expect(Math.abs(r.anchor.lat - SAT.lat) * 364000 < 1).toBe(true);
    expect(r.lat, 'the geocoded pin is what the invoice and the map use').toBe(PIN.lat);
    expect(r.lon).toBe(PIN.lng);
  });

  // THE ONE THE MACHINERY WOULD HAVE BROKEN. A day derives many times over (the
  // live flip, the half-hourly ping, the boot rebuild), so without a per-day
  // key one visit would count as ten agreeing visits and clear minVisits on its
  // own: "one visit never moves a pin" defeated by plumbing, not evidence.
  test('one day derived ten times is still one visit', async () => {
    const one = threeDays.slice(0, 1);
    const r = await run([one[0], one[0], one[0], one[0], one[0], one[0], one[0], one[0], one[0], one[0]]);
    expect(r.seen.length).toBe(1);
    expect(r.anchor).toBe(null);
  });

  test('a re-derive of the same day replaces that day, it does not stack', async () => {
    const d = threeDays[0];
    const later = Object.assign({}, d, { lat: d.lat + 5 / 364000 });
    const r = await run([d, later]);
    expect(r.seen.length).toBe(1);
    expect(r.seen[0].lat, 'the later run saw more of the same stop').toBe(later.lat);
  });

  test('the sighting list is capped and keeps the newest days', async () => {
    const many = [];
    for (let i = 1; i <= 14; i++) {
      const day = '2026-09-' + String(i).padStart(2, '0');
      many.push({ start: Date.parse(day + 'T13:00:00Z'), end: Date.parse(day + 'T17:00:00Z'),
        lat: SAT.lat, lng: SAT.lng });
    }
    const r = await run(many);
    expect(r.seen.length).toBe(10);
    expect(r.seen[r.seen.length - 1].d).toBe('2026-09-14');
  });

  test('a crew phone never writes the employer\'s addresses', async () => {
    const r = await page.evaluate(([doe, sat]) => {
      const savedClients = clients.slice();
      const saved = { save: window.saveAll, own: window._geoViewingSomebodyElse, cid: window._geoCid, u: window._supaUser };
      try {
        window._supaUser = { id: 'crew' };
        window._geoCid = () => 'theboss';           // deriving on somebody else's account
        window._geoViewingSomebodyElse = () => false;
        window.saveAll = () => { };
        clients.length = 0;
        clients.push({ id: '1788214075432', name: 'John Doe', lat: doe.lat, lon: doe.lng });
        const n = geoAnchorRecord({ dwells: [{ fence: doe, kind: 'client', name: 'John Doe',
          startTs: Date.parse('2026-09-01T13:00:00Z'), endTs: Date.parse('2026-09-01T17:00:00Z'),
          spot: { lat: sat.lat, lng: sat.lng, n: 30 } }] }, [doe], {});
        return { n, seen: clients[0].anchorSeen || null };
      } finally {
        window.saveAll = saved.save; window._geoViewingSomebodyElse = saved.own;
        window._geoCid = saved.cid; window._supaUser = saved.u;
        clients.length = 0; savedClients.forEach(c => clients.push(c));
      }
    }, [DOE, SAT]);
    expect(r.n).toBe(0);
    expect(r.seen, 'nothing was recorded at all').toBe(null);
  });

  test('and neither does a support session looking at somebody else\'s day', async () => {
    const r = await page.evaluate(([doe, sat]) => {
      const savedClients = clients.slice();
      const saved = { own: window._geoViewingSomebodyElse, cid: window._geoCid, u: window._supaUser, save: window.saveAll };
      try {
        window._supaUser = { id: 'u1' };
        window._geoCid = () => 'u1';
        window._geoViewingSomebodyElse = () => true;
        window.saveAll = () => { };
        clients.length = 0;
        clients.push({ id: '1788214075432', name: 'John Doe', lat: doe.lat, lon: doe.lng });
        return geoAnchorRecord({ dwells: [{ fence: doe, kind: 'client', name: 'John Doe',
          startTs: Date.parse('2026-09-01T13:00:00Z'), endTs: Date.parse('2026-09-01T17:00:00Z'),
          spot: { lat: sat.lat, lng: sat.lng, n: 30 } }] }, [doe], {});
      } finally {
        window._geoViewingSomebodyElse = saved.own; window._geoCid = saved.cid;
        window._supaUser = saved.u; window.saveAll = saved.save;
        clients.length = 0; savedClients.forEach(c => clients.push(c));
      }
    }, [DOE, SAT]);
    expect(r).toBe(0);
  });

  test('_geoAnchorPoint answers the fence builder, and refuses junk', async () => {
    const r = await page.evaluate(() => [
      _geoAnchorPoint(null),
      _geoAnchorPoint({}),
      _geoAnchorPoint({ anchor: {} }),
      _geoAnchorPoint({ anchor: { lat: 'x', lng: 1 } }),
      _geoAnchorPoint({ anchor: { lat: 39.1, lng: -95.7, n: 4 } }),
    ]);
    expect(r.slice(0, 4)).toEqual([null, null, null, null]);
    expect(r[4]).toEqual({ lat: 39.1, lng: -95.7, n: 4 });
  });

  test('a record it cannot find is skipped, not invented', async () => {
    const r = await page.evaluate(() => [_geoAnchorRecFor(''), _geoAnchorRecFor('job-7'),
      _geoAnchorRecFor('shop'), _geoAnchorRecFor('client-nope'), _geoAnchorRecFor(null)]);
    expect(r).toEqual([null, null, null, null, null]);
  });

  test('no console errors across the record half', () => { assertNoErrors(page, 'geo-anchor record'); });
});
