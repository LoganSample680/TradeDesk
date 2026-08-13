// ── The Day Simulator ────────────────────────────────────────────────────────
// Plays ENTIRE simulated days through the real tracker, GPS fix by GPS fix,
// on a fake clock, then asserts the mileage log holds EXACTLY the right rows
// and nothing else. Owner spec (2026-08-12): "every edge case needs verified,
// go end point to end point ... mid drive throw a manual log in there to
// prove the dedup fires, place a personal stop that's not in the database
// ... logic is simple but real world isn't."
//
// This is the difference between testing pieces and proving whole days: the
// war stories from the owner's real phone (the mid-drive crash, the stale
// reopen echo, the phantom parking-lot speed fix, the mid-drive manual log)
// are permanent day-scenarios here. A regression in any of them fails CI.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Fixture geography, all mutually farther apart than the 1500ft dedup fence.
const GEO = {
  SHOP:    { lat: 39.0000, lon: -95.7000 },
  HOMEOFF: { lat: 39.0300, lon: -95.7600 },
  JOB1:    { lat: 39.0208, lon: -95.7351 },   // client John Doe
  JOB2:    { lat: 38.9700, lon: -95.6800 },   // client Beta LLC
  SUP1:    { lat: 39.0100, lon: -95.6600 },   // Ace Supply (saved place)
  SUP2:    { lat: 38.9900, lon: -95.7500 },   // Ferguson Supply (saved place)
  PSTOP:   { lat: 39.0050, lon: -95.7100 },   // NOT in the database
};

// The same deterministic "route" the in-page stub serves, so the expected
// miles for every assertion are computable here: straight-line * 1.25.
function routeMiles(f, t) {
  const R = (x) => x * Math.PI / 180;
  const d = 3958.8 * Math.acos(Math.min(1,
    Math.sin(R(f.lat)) * Math.sin(R(t.lat)) +
    Math.cos(R(f.lat)) * Math.cos(R(t.lat)) * Math.cos(R(t.lon - f.lon))));
  return Math.round(d * 1.25 * 10) / 10;
}

test.describe('Mileage day simulator: whole days against the real tracker', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate((G) => {
      window.supaLoadFromCloud = async () => {};
      _supaUser = { id: 'u-simday' }; _isEmployee = false;
      S.officeLat = G.SHOP.lat; S.officeLon = G.SHOP.lon;
      S.teamTracking = true; S.defaultVehicleId = 'v-truck';
      window._geoOfficeCoords = async () => ({ lat: G.SHOP.lat, lng: G.SHOP.lon });
      vehicles.length = 0;
      vehicles.push({ id: 'v-truck', name: 'F-250', status: 'active' });
      places.length = 0;
      savePlace({ name: 'Home Office', kind: 'home_office', lat: G.HOMEOFF.lat, lon: G.HOMEOFF.lon, confirmedBy: 'manual' });
      savePlace({ name: 'Ace Supply', kind: 'supply', lat: G.SUP1.lat, lon: G.SUP1.lon, confirmedBy: 'manual' });
      savePlace({ name: 'Ferguson Supply', kind: 'supply', lat: G.SUP2.lat, lon: G.SUP2.lon, confirmedBy: 'manual' });
      clients.length = 0;
      clients.push({ id: 8801, name: 'John Doe', addr: '2950 SW McClure Rd' });
      clients.push({ id: 8802, name: 'Beta LLC', addr: '900 SE Quincy St' });
      jobs.length = 0;
      jobs.push({ id: 9911, name: 'John Repaint', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: G.JOB1.lat, lon: G.JOB1.lon, client_id: 8801, addr: '2950 SW McClure Rd' });
      jobs.push({ id: 9912, name: 'Beta Build', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: G.JOB2.lat, lon: G.JOB2.lon, client_id: 8802, addr: '900 SE Quincy St' });
      _geoJobCoords = {};
      // Deterministic coordinate-aware "MapKit": straight-line * 1.25.
      window._routeDistance = _routeDistance = async (f, t) => {
        const R = (x) => x * Math.PI / 180;
        const d = 3958.8 * Math.acos(Math.min(1,
          Math.sin(R(f.lat)) * Math.sin(R(t.lat)) +
          Math.cos(R(f.lat)) * Math.cos(R(t.lat)) * Math.cos(R(t.lng - f.lng))));
        const miles = Math.round(d * 1.25 * 10) / 10;
        return { miles, mins: Math.max(3, Math.round(miles * 2.2)) };
      };
      // The manual row's address geocoder, for the pending sweep.
      window.__nameCoords = {
        'john doe': { lat: G.JOB1.lat, lng: G.JOB1.lon },
        'home office': { lat: G.HOMEOFF.lat, lng: G.HOMEOFF.lon },
      };
      window._resolveCoords = async (s) => window.__nameCoords[String(s || '').trim().toLowerCase()] || null;
      // Time entries land here for payroll assertions.
      window.__enq = [];
      window._geoEnqueue = (tbl, row) => window.__enq.push({ tbl, row });
      window._geoTdPlugin = () => null;           // plain browser paths
      window._geoWatchId = _geoWatchId = 41;
      window._geoAppOnScreen = () => true;        // pings come from the script
    }, GEO);
    // Fake clock: every simulated day starts at the SAME 9:00am (newDay
    // resets it). Seeds and days must not inherit each other's clock drift:
    // drifted hours expire the seeded jobs' fences and trip the likely-home
    // heuristic, and a batch must not depend on the wall-clock hour it runs.
    await page.clock.install({ time: _day0() });
  });
  test.afterAll(async () => { await page.context().close(); });
  function _day0() { const d = new Date(); d.setHours(9, 0, 0, 0); return d; }

  // ── The day engine ────────────────────────────────────────────────────────
  const ping = (c, spd) => page.evaluate(([c2, s]) =>
    _geoOnPing({ coords: { latitude: c2.lat, longitude: c2.lon, accuracy: 8, speed: s } }), [c, spd || 0]);
  const ff = async (mins) => { await page.clock.fastForward(Math.round(mins * 60000)); };
  const mid = (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });

  // A drive is fixes: parked at the origin, two road fixes, parked at the door.
  async function drive(from, to, driveMins) {
    await ping(from, 0); await ff(1);
    await ping(mid(from, to, 0.3), 13); await ff(driveMins / 2);
    await ping(mid(from, to, 0.7), 13); await ff(driveMins / 2);
    await ping(to, 0);
    await ff(0.5);
  }
  // Sit somewhere long enough that the tracker calls it a real stop.
  async function dwell(at, mins) {
    const step = Math.max(2, mins / 4);
    for (let t = 0; t < mins; t += step) { await ping(at, 0); await ff(step); }
  }
  async function newDay() {
    await page.clock.setSystemTime(_day0());   // every day begins at the same 9:00am
    await page.evaluate((G) => {
      mileage.length = 0; window.__enq.length = 0;
      _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
      _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
      _geoStopAnchor = null; _geoDriveStartedAt = null; _geoLegOrigin = null;
      _geoLastFenceLoc = null; _geoLastFenceAt = null; _geoLegAtShop = false; _geoGapHiddenAt = null;
      _geoDrivebyRun = 0; _geoDriveReset(); _geoPingBusy = false;
      // Jobs re-seeded on TODAY as the fake clock sees it, so a long run
      // never expires its own fences.
      jobs.length = 0;
      jobs.push({ id: 9911, name: 'John Repaint', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: G.JOB1.lat, lon: G.JOB1.lon, client_id: 8801, addr: '2950 SW McClure Rd' });
      jobs.push({ id: 9912, name: 'Beta Build', eventType: 'job', status: 'upcoming',
                  start: todayKey(), days: 1, lat: G.JOB2.lat, lon: G.JOB2.lon, client_id: 8802, addr: '900 SE Quincy St' });
      _geoJobCoords = {};
      try { localStorage.removeItem('zp3_geo_open'); localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
    }, GEO);
  }
  async function closeDay() {
    await page.evaluate(async () => { await _retryPendingTrips(); await new Promise(r => setTimeout(r, 5)); });
    await page.clock.fastForward(2000);
    return page.evaluate(() => ({
      rows: mileage.map(m => ({
        from: m.from_name || m.from, to: m.to_name || m.to, miles: m.miles,
        method: m.calc_method, legKey: m.legKey || null,
        passedThrough: !!m.passedThrough,
      })).reverse(),   // chronological
      drives: window.__enq.filter(q => q.tbl === 'job_time_entries' && /^drive/.test(q.row.source || '')).length,
      stops: window.__enq.filter(q => q.tbl === 'job_time_entries' && (q.row.source || '') === 'stop').length,
    }));
  }
  const expectRows = (label, got, want) => {
    expect(got.rows.length, `${label}: exactly ${want.length} rows, got ${JSON.stringify(got.rows)}`).toBe(want.length);
    want.forEach((w, i) => {
      const r = got.rows[i];
      expect(String(r.from), `${label} row${i + 1} origin`).toContain(w.from);
      expect(String(r.to), `${label} row${i + 1} destination`).toContain(w.to);
      if (w.miles != null) {
        expect(r.miles, `${label} row${i + 1} measured`).toBeGreaterThan(0);
        expect(Math.abs(r.miles - w.miles), `${label} row${i + 1}: direct miles, got ${r.miles} want ~${w.miles}`).toBeLessThanOrEqual(0.15);
      }
      if (w.auto) expect(r.legKey, `${label} row${i + 1}: the automatic row is the one that survived`).toBeTruthy();
    });
  };

  test('day 1: endpoint to endpoint, every pair: five drives, five rows, direct miles, five time entries', async () => {
    test.setTimeout(120000);
    await newDay();
    await dwell(GEO.HOMEOFF, 6);
    await drive(GEO.HOMEOFF, GEO.JOB1, 14); await dwell(GEO.JOB1, 10);
    await drive(GEO.JOB1, GEO.SUP1, 12);    await dwell(GEO.SUP1, 8);
    await drive(GEO.SUP1, GEO.SUP2, 12);    await dwell(GEO.SUP2, 8);
    await drive(GEO.SUP2, GEO.JOB1, 12);    await dwell(GEO.JOB1, 10);
    await drive(GEO.JOB1, GEO.SHOP, 10);    await dwell(GEO.SHOP, 6);
    const d = await closeDay();
    expectRows('day1', d, [
      { from: 'Home Office', to: 'John',     miles: routeMiles(GEO.HOMEOFF, GEO.JOB1), auto: true },
      { from: 'John',        to: 'Ace',      miles: routeMiles(GEO.JOB1, GEO.SUP1),    auto: true },
      { from: 'Ace',         to: 'Ferguson', miles: routeMiles(GEO.SUP1, GEO.SUP2),    auto: true },
      { from: 'Ferguson',    to: 'John',     miles: routeMiles(GEO.SUP2, GEO.JOB1),    auto: true },
      { from: 'John',        to: 'Shop',     miles: routeMiles(GEO.JOB1, GEO.SHOP),    auto: true },
    ]);
    expect(d.drives, 'five legs, five drive time entries').toBe(5);
  });

  test('day 2: a manual log thrown in MID-DRIVE dedups to the one automatic row', async () => {
    test.setTimeout(120000);
    await newDay();
    await dwell(GEO.HOMEOFF, 6);
    await ping(GEO.HOMEOFF, 0); await ff(1);
    await ping(mid(GEO.HOMEOFF, GEO.JOB1, 0.3), 13); await ff(6);
    // Mid-route: the hand-typed row, exactly the shape saveLoggedTrip writes
    // (the owner's real 2026-08-11 incident: opened Drive to find the address).
    await page.evaluate(() => {
      mileage.unshift({ id: _newId(), date: todayKey(), loggedAt: new Date().toISOString(),
        vehicle: 'F-250', from: 'Home Office', from_name: 'Home Office', to: 'John Doe', to_name: 'John Doe',
        start: 0, end: 0, miles: 0, purpose: 'Job site', client_id: 8801, client_name: 'John Doe',
        notes: '', created_at: new Date().toISOString(), calc_method: 'pending' });
    });
    await ping(mid(GEO.HOMEOFF, GEO.JOB1, 0.7), 13); await ff(6);
    await ping(GEO.JOB1, 0); await ff(1);
    await dwell(GEO.JOB1, 8);
    const d = await closeDay();
    expectRows('day2', d, [
      { from: 'Home Office', to: 'John', miles: routeMiles(GEO.HOMEOFF, GEO.JOB1), auto: true },
    ]);
  });

  test('day 3: a personal stop NOT in the database collapses both legs to direct endpoint miles', async () => {
    test.setTimeout(120000);
    await newDay();
    await dwell(GEO.HOMEOFF, 6);
    await drive(GEO.HOMEOFF, GEO.JOB1, 14); await dwell(GEO.JOB1, 10);
    // Job -> unknown stop (25 min) -> the OTHER job.
    await ping(GEO.JOB1, 0); await ff(1);
    await ping(mid(GEO.JOB1, GEO.PSTOP, 0.5), 13); await ff(5);
    await dwell(GEO.PSTOP, 25);
    await ping(mid(GEO.PSTOP, GEO.JOB2, 0.5), 13); await ff(6);
    await ping(GEO.JOB2, 0); await ff(1);
    await dwell(GEO.JOB2, 10);
    // Job -> unknown stop (25 min) -> back to the home office.
    await ping(GEO.JOB2, 0); await ff(1);
    await ping(mid(GEO.JOB2, GEO.PSTOP, 0.5), 13); await ff(5);
    await dwell(GEO.PSTOP, 25);
    await ping(mid(GEO.PSTOP, GEO.HOMEOFF, 0.5), 13); await ff(6);
    await ping(GEO.HOMEOFF, 0); await ff(1);
    await dwell(GEO.HOMEOFF, 6);
    const d = await closeDay();
    expectRows('day3', d, [
      { from: 'Home Office', to: 'John',        miles: routeMiles(GEO.HOMEOFF, GEO.JOB1), auto: true },
      { from: 'John',        to: 'Beta',        miles: routeMiles(GEO.JOB1, GEO.JOB2),    auto: true },
      { from: 'Beta',        to: 'Home Office', miles: routeMiles(GEO.JOB2, GEO.HOMEOFF), auto: true },
    ]);
    expect(d.rows[1].passedThrough, 'the collapsed stop rides as a breadcrumb (receipt can rebuild it)').toBe(true);
    expect(d.rows[2].passedThrough, 'both directions').toBe(true);
    expect(d.stops, 'the personal stop still logs its own off-job time').toBeGreaterThanOrEqual(2);
  });

  test('day 4: crash mid-drive, a stale-reopen echo, a phantom speed fix: two rows, zero garbage', async () => {
    test.setTimeout(120000);
    await newDay();
    await dwell(GEO.HOMEOFF, 6);
    // Crash mid-drive: memory dies, the restored snapshot brings the leg back.
    await ping(GEO.HOMEOFF, 0); await ff(1);
    await ping(mid(GEO.HOMEOFF, GEO.JOB1, 0.3), 13); await ff(5);
    await page.evaluate(() => {   // the webview dies and relaunches
      _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null; _geoLastFenceAt = null;
      _geoStopAnchor = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
      _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
      _geoRestoreOpen();
    });
    await ping(mid(GEO.HOMEOFF, GEO.JOB1, 0.7), 13); await ff(6);
    await ping(GEO.JOB1, 0); await ff(1);
    await dwell(GEO.JOB1, 8);
    // Stale echo attack: a dead boot restores the MORNING's pre-drive state,
    // then finds itself at the job. The echo guard must write nothing.
    await page.evaluate((G) => {
      _geoCurrentClient = null; _geoClientArrivedAt = null; _geoCurrentJob = null; _geoArrivedAt = null;
      _geoDriveStartedAt = null; _geoLegOrigin = null; _geoStopAnchor = null;
      _geoLastFenceLoc = { lat: G.HOMEOFF.lat, lng: G.HOMEOFF.lon, name: 'Home Office', kind: 'place' };
      _geoLastFenceAt = new Date(Date.now() - 5 * 3600000).toISOString();
    }, GEO);
    await ping(GEO.JOB1, 0); await ff(1);
    // Phantom speed while parked: one garbage fix, nothing closes.
    await ping(GEO.JOB1, 15); await ff(1);
    await ping(GEO.JOB1, 0); await ff(1);
    // The real drive home still logs.
    await drive(GEO.JOB1, GEO.HOMEOFF, 14);
    const d = await closeDay();
    expectRows('day4', d, [
      { from: 'Home Office', to: 'John',        miles: routeMiles(GEO.HOMEOFF, GEO.JOB1), auto: true },
      { from: 'John',        to: 'Home Office', miles: routeMiles(GEO.JOB1, GEO.HOMEOFF), auto: true },
    ]);
  });

  test('day 5: a forced detour saves the OBSERVED miles; a GPS blowup stays capped at the route', async () => {
    test.setTimeout(120000);
    // Owner ask 2026-08-13: "what happens if the drive itself is longer than
    // the reported MapKit mileage? What saves?" The wheels do, when the leg
    // was densely watched, and never past 4x the route.
    await newDay();
    await dwell(GEO.JOB1, 8);
    // Leg A: JOB1 -> SHOP the LONG way (bridge out): nine dense road fixes
    // trace a dogleg roughly twice the direct route.
    const DOG = [
      { lat: 39.0300, lon: -95.7350 }, { lat: 39.0400, lon: -95.7300 }, { lat: 39.0450, lon: -95.7200 },
      { lat: 39.0450, lon: -95.7100 }, { lat: 39.0400, lon: -95.7000 }, { lat: 39.0300, lon: -95.6980 },
      { lat: 39.0200, lon: -95.6990 }, { lat: 39.0120, lon: -95.7000 }, { lat: 39.0060, lon: -95.7000 },
    ];
    await ping(GEO.JOB1, 0); await ff(1);
    for (const p of DOG) { await ping(p, 13); await ff(1.5); }
    await ping(GEO.SHOP, 0); await ff(0.5);
    await dwell(GEO.SHOP, 8);
    // Harness-side expected tally: the same hops the accumulator saw (the
    // drive opens on the first out-of-fence fix, so it starts at DOG[0]).
    const mi = (a, b) => {
      const R = (x) => x * Math.PI / 180;
      return 3958.8 * Math.acos(Math.min(1, Math.sin(R(a.lat)) * Math.sin(R(b.lat)) +
        Math.cos(R(a.lat)) * Math.cos(R(b.lat)) * Math.cos(R(b.lon - a.lon))));
    };
    let tally = 0;
    for (let i = 1; i < DOG.length; i++) tally += mi(DOG[i - 1], DOG[i]);
    tally += mi(DOG[DOG.length - 1], GEO.SHOP);
    // Leg B: SHOP -> SUP2 with a garbage trace (teleporting fixes): the tally
    // blows past 4x the route, so the ROUTE saves, never the blowup.
    await ping(GEO.SHOP, 0); await ff(1);
    for (let i = 0; i < 9; i++) {
      await ping({ lat: GEO.SHOP.lat + (i % 2 ? 0.08 : -0.08), lon: -95.7000 - i * 0.005 }, 13); await ff(1);
    }
    await ping(GEO.SUP2, 0); await ff(0.5);
    await dwell(GEO.SUP2, 8);
    const d = await closeDay();
    expect(d.rows.length, JSON.stringify(d.rows)).toBe(2);
    const [rA, rB] = d.rows;
    expect(String(rA.from)).toContain('John');
    expect(String(rA.to)).toContain('Shop');
    const directA = routeMiles(GEO.JOB1, GEO.SHOP);
    expect(rA.miles, 'the observed detour beats the route').toBeGreaterThan(directA);
    expect(Math.abs(rA.miles - tally), `observed tally saves, got ${rA.miles} want ~${Math.round(tally * 10) / 10}`).toBeLessThanOrEqual(0.3);
    expect(String(rB.from)).toContain('Shop');
    expect(String(rB.to)).toContain('Ferguson');
    expect(Math.abs(rB.miles - routeMiles(GEO.SHOP, GEO.SUP2)), `blowup capped, the route saves, got ${rB.miles}`).toBeLessThanOrEqual(0.15);
  });

  test('fuzz days: six seeded random days, oracle-checked, every combination of stop, manual, crash, echo, phantom', async () => {
    test.setTimeout(300000);
    // The generator composes days from the same building blocks the real
    // world does, deterministic per seed. The oracle: one row per real
    // journey, endpoint to endpoint, direct route miles, the automatic row
    // surviving. Seeds 1-500 ran green on the local harness 2026-08-13; the
    // six here keep the property alive on every push. A failing seed
    // reproduces exactly by number.
    const PSTOPS = [
      { lat: 39.0050, lon: -95.7100 },
      { lat: 38.9850, lon: -95.7150 },
      { lat: 39.0150, lon: -95.6900 },
    ];
    const NAME = { SHOP: 'Shop', HOMEOFF: 'Home Office', JOB1: 'John', JOB2: 'Beta', SUP1: 'Ace', SUP2: 'Ferguson' };
    const mulberry32 = (seed) => {
      let a = seed >>> 0;
      return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    };
    const crashNow = () => page.evaluate(() => {
      _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null; _geoLastFenceAt = null;
      _geoStopAnchor = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
      _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
      _geoCurrentJob = null; _geoArrivedAt = null;
      _geoRestoreOpen();
    });
    const echoAttack = async (prevPoint, atPoint) => {
      await page.evaluate(([p]) => {
        _geoCurrentClient = null; _geoClientArrivedAt = null; _geoCurrentJob = null; _geoArrivedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
        _geoLegAtShop = false; _geoDriveStartedAt = null; _geoLegOrigin = null; _geoStopAnchor = null;
        _geoLastFenceLoc = { lat: p.lat, lng: p.lon, name: 'Prev', kind: 'place' };
        _geoLastFenceAt = new Date(Date.now() - 6 * 3600000).toISOString();
      }, [prevPoint]);
      await ping(atPoint, 0); await ff(1);
    };
    const KEYS = Object.keys(GEO).filter(k => k !== 'PSTOP');
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rnd = mulberry32(seed * 7919 + 13);
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const legCount = 4 + Math.floor(rnd() * 4);
      let at = pick(KEYS);
      const legs = [];
      for (let i = 0; i < legCount; i++) {
        let to = pick(KEYS);
        while (to === at) to = pick(KEYS);
        legs.push({ from: at, to,
          stop: rnd() < 0.3 ? pick(PSTOPS) : null,
          manual: rnd() < 0.25, crash: rnd() < 0.2,
          echoAfter: rnd() < 0.25, phantomAfter: rnd() < 0.25 });
        at = to;
      }
      await newDay();
      await dwell(GEO[legs[0].from], 6);
      for (const leg of legs) {
        const F = GEO[leg.from], T = GEO[leg.to];
        await ping(F, 0); await ff(1);
        if (leg.stop) {
          await ping(mid(F, leg.stop, 0.5), 13); await ff(5);
          if (leg.crash) await crashNow();
          await dwell(leg.stop, 25);
          await ping(mid(leg.stop, T, 0.5), 13); await ff(6);
        } else {
          await ping(mid(F, T, 0.3), 13); await ff(5);
          if (leg.crash) await crashNow();
          if (leg.manual) {
            await page.evaluate(([toKey]) => {
              const nm = { SHOP: ['Shop', null], HOMEOFF: ['Home Office', null],
                           JOB1: ['John Doe', 8801], JOB2: ['Beta LLC', 8802],
                           SUP1: ['Ace Supply', null], SUP2: ['Ferguson Supply', null] }[toKey];
              mileage.unshift({ id: _newId(), date: todayKey(), loggedAt: new Date().toISOString(),
                vehicle: 'F-250', from: '', from_name: '', to: nm[0], to_name: nm[0],
                start: 0, end: 0, miles: 0, purpose: 'Job site', client_id: nm[1],
                client_name: nm[1] ? nm[0] : '', notes: '', created_at: new Date().toISOString(),
                calc_method: 'pending' });
            }, [leg.to]);
          }
          await ping(mid(F, T, 0.7), 13); await ff(5);
        }
        await ping(T, 0); await ff(1);
        if (leg.echoAfter) await echoAttack(F, T);
        if (leg.phantomAfter) { await ping(T, 15); await ff(1); await ping(T, 0); }
        await dwell(T, 8);
      }
      const d = await closeDay();
      const tag = `seed ${seed} [${legs.map(l => `${l.from}>${l.to}${l.stop ? '+stop' : ''}${l.manual ? '+man' : ''}${l.crash ? '+crash' : ''}${l.echoAfter ? '+echo' : ''}${l.phantomAfter ? '+phantom' : ''}`).join(' ')}]`;
      expect(d.rows.length, `${tag}: got ${JSON.stringify(d.rows)}`).toBe(legs.length);
      legs.forEach((l, i) => {
        const r = d.rows[i];
        expect(String(r.from), `${tag} row${i + 1} origin`).toContain(NAME[l.from]);
        expect(String(r.to), `${tag} row${i + 1} destination`).toContain(NAME[l.to]);
        expect(Math.abs(r.miles - routeMiles(GEO[l.from], GEO[l.to])), `${tag} row${i + 1} direct miles, got ${r.miles}`).toBeLessThanOrEqual(0.15);
        expect(r.legKey, `${tag} row${i + 1} auto survived`).toBeTruthy();
      });
    }
  });

  test('no console errors across every simulated day', async () => { await assertNoErrors(page); });
});
