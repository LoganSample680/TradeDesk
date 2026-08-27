// @ts-check
// ── The wake region set: what a dead app can still hear ──────────────────────
//
// Owner 2026-08-27: "work and log mileage and time even if the app is dead,
// force closed or backgrounded", like Life360 and the other consumer
// trackers. iOS relaunches even a force-quit app when a monitored region
// trips, a visit closes, or the phone moves significantly, and that set of
// armed regions is therefore the ONLY map of the world a dead app has.
// _geoParkRegions builds it: not just the kerb we parked at, but the shop,
// today's and tomorrow's job sites, the saved places, and active clients
// with a warmed geocode, strongest fence first, capped inside iOS's
// 20-region budget. The source-level tests pin the two arming moments: the
// park arm prefers the events engine (regions + significant-change + visit
// monitoring), and the live watcher arms the same baseline the moment
// tracking starts, so a force close MID-DRIVE still leaves a listener
// standing.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

const readJs = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

test.describe('Wake region set for the dead app', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // One shared fixture world, built and torn down inside each test so the
  // shard order can never matter (bare bindings for the module-scoped
  // globals, same rule as everywhere else in this suite).
  const buildWorld = () => ({
    places: [{ id: 'pl1', name: 'ProBuild', kind: 'supply', lat: 39.1, lon: -94.1, fenceFt: 500 }],
    jobs: [
      { id: 701, name: 'Today job', start: null, days: 1, status: 'upcoming' },      // start filled in-page
      { id: 702, name: 'Next week job', start: '2099-01-01', days: 1, status: 'upcoming' },
      { id: 703, name: 'Canceled today', start: null, days: 1, status: 'canceled' },
    ],
    clients: [{ id: 801, name: 'Dana', addr: '12 Elm St' }],
  });

  test('spot leads with its own radius, then shop, then only the jobs a dead app could meet', async () => {
    const w = buildWorld();
    const out = await page.evaluate((w) => {
      const savedPlaces = places.slice(), savedJobs = jobs.slice(), savedClients = clients.slice();
      const savedLat = S.officeLat, savedLon = S.officeLon;
      const savedCoords = Object.assign({}, _geoJobCoords);
      try {
        S.officeLat = 39.0; S.officeLon = -94.0;
        places.length = 0; w.places.forEach(p => places.push(p));
        w.jobs[0].start = todayKey(); w.jobs[2].start = todayKey();
        jobs.length = 0; w.jobs.forEach(j => jobs.push(j));
        clients.length = 0; w.clients.forEach(c => clients.push(c));
        Object.keys(_geoJobCoords).forEach(k => delete _geoJobCoords[k]);
        _geoJobCoords[701] = { lat: 39.2, lng: -94.2 };
        _geoJobCoords[702] = { lat: 39.3, lng: -94.3 };
        _geoJobCoords[703] = { lat: 39.4, lng: -94.4 };
        const regs = _geoParkRegions({ lat: 38.9, lng: -93.9 }, 250);
        return { regs };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        S.officeLat = savedLat; S.officeLon = savedLon;
        Object.keys(_geoJobCoords).forEach(k => delete _geoJobCoords[k]);
        Object.keys(savedCoords).forEach(k => { _geoJobCoords[k] = savedCoords[k]; });
      }
    }, w);
    const ids = out.regs.map(r => r.id);
    // The park spot is first and keeps the radius the caller computed for it.
    expect(ids[0]).toBe('fence');
    expect(out.regs[0].radius).toBe(250);
    expect(ids[1]).toBe('shop');
    // Today's job armed; next week's is not reachable by a dead app tonight
    // and the canceled one is nobody's fence.
    expect(ids).toContain('job-701');
    expect(ids).not.toContain('job-702');
    expect(ids).not.toContain('job-703');
    // The saved place rides with its OWN fence size, converted to meters.
    const pl = out.regs.find(r => r.id === 'place-pl1');
    expect(pl).toBeTruthy();
    expect(pl.radius).toBeCloseTo(500 * 0.3048 + 60, 0);
  });

  test('a client fences only once its geocode is warmed, and never on a stale address', async () => {
    const out = await page.evaluate(() => {
      const savedClients = clients.slice();
      const savedCache = window._nearbyGeoCache;
      try {
        clients.length = 0;
        clients.push({ id: 801, name: 'Warm', addr: '12 Elm St' });
        clients.push({ id: 802, name: 'Cold', addr: '99 Oak Av' });
        clients.push({ id: 803, name: 'Moved', addr: '5 New Rd' });
        window._nearbyGeoCache = () => ({
          801: { addr: '12 Elm St', lat: 39.5, lon: -94.5 },
          803: { addr: '5 Old Rd', lat: 39.6, lon: -94.6 },   // geocode of the OLD address
        });
        return { ids: _geoParkRegions(null).map(r => r.id) };
      } finally {
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        window._nearbyGeoCache = savedCache;
      }
    });
    expect(out.ids).toContain('client-801');
    expect(out.ids).not.toContain('client-802');
    expect(out.ids, 'a stale geocode must not arm a fence at the wrong house').not.toContain('client-803');
  });

  test('the set caps at 18 and never repeats a coordinate', async () => {
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice();
      try {
        places.length = 0;
        for (let i = 0; i < 30; i++) places.push({ id: 'p' + i, name: 'P' + i, kind: 'supply', lat: 40 + i * 0.01, lon: -95 });
        // Two saved pins on the SAME coordinate: one fence is enough to wake on.
        places.push({ id: 'dupA', name: 'A', kind: 'supply', lat: 41, lon: -96 });
        places.push({ id: 'dupB', name: 'B', kind: 'shop', lat: 41, lon: -96 });
        const regs = _geoParkRegions(null);
        const coords = regs.map(r => r.lat.toFixed(4) + ',' + r.lng.toFixed(4));
        return { n: regs.length, uniq: new Set(coords).size };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
      }
    });
    expect(out.n).toBeLessThanOrEqual(18);
    expect(out.uniq).toBe(out.n);
  });

  test('when the cap bites, the fences nearest the park spot win, places and clients pooled (owner 2026-08-27)', async () => {
    // A day with NO scheduled jobs, just driving between client homes: the
    // armed set used to fill in raw array order, places first, so a client
    // two blocks from the kerb could lose their fence to a supply house
    // thirty miles gone. Nearest-to-the-kerb is what a wake could actually
    // need next.
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice(), savedClients = clients.slice(), savedJobs = jobs.slice();
      const savedCache = window._nearbyGeoCache;
      const savedLat = S.officeLat, savedLon = S.officeLon;
      try {
        S.officeLat = null; S.officeLon = null;   // no shop tier in this world
        jobs.length = 0;                          // nothing on the schedule
        // 20 far places, each ~7+ miles out, in array order BEFORE the clients.
        places.length = 0;
        for (let i = 0; i < 20; i++) places.push({ id: 'far' + i, name: 'Far ' + i, kind: 'supply', lat: 39.1 + i * 0.01, lon: -94.5 });
        // 3 client homes within a mile of the kerb.
        clients.length = 0;
        clients.push({ id: 901, name: 'Near A', addr: '1 A St' });
        clients.push({ id: 902, name: 'Near B', addr: '2 B St' });
        clients.push({ id: 903, name: 'Near C', addr: '3 C St' });
        window._nearbyGeoCache = () => ({
          901: { addr: '1 A St', lat: 39.001, lon: -94.001 },
          902: { addr: '2 B St', lat: 39.002, lon: -94.002 },
          903: { addr: '3 C St', lat: 39.003, lon: -94.003 },
        });
        const regs = _geoParkRegions({ lat: 39.0, lng: -94.0 }, 200);
        return { ids: regs.map(r => r.id), n: regs.length };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
        window._nearbyGeoCache = savedCache;
        S.officeLat = savedLat; S.officeLon = savedLon;
      }
    });
    expect(out.n).toBeLessThanOrEqual(18);
    // Every near client armed, despite 20 places sitting earlier in array order.
    expect(out.ids).toContain('client-901');
    expect(out.ids).toContain('client-902');
    expect(out.ids).toContain('client-903');
    // And they beat the FARTHEST places specifically: the tail of the far
    // list must be what fell off the cap, not the nearby homes.
    expect(out.ids).not.toContain('place-far19');
    // Order inside the pool is nearest-first: the kerb fence leads, then the
    // three homes before any 7-mile place.
    expect(out.ids[0]).toBe('fence');
    expect(out.ids.slice(1, 4).sort()).toEqual(['client-901', 'client-902', 'client-903']);
  });

  test('junk input cannot break the builder', async () => {
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice(), savedJobs = jobs.slice();
      try {
        places.length = 0; places.push(null, { id: 'x' }, { id: 'y', lat: 39, lon: null });
        jobs.length = 0; jobs.push(null, { id: 9, start: 'not-a-date' });
        try { return { regs: _geoParkRegions(null), threw: false }; }
        catch (e) { return { threw: true, msg: e.message }; }
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
      }
    });
    expect(out.threw, out.msg || '').toBe(false);
    expect(Array.isArray(out.regs)).toBe(true);
  });

  // Source-level guarantees, house style (e2e-geo-timeclass): the two arming
  // moments must stay wired or the whole force-close story silently dies.
  test('the park arm prefers the events engine and passes the FULL region set', async () => {
    const src = readJs('geo-track.js');
    expect(src.includes("typeof Td.startEvents==='function'"), 'park must arm visits when the shell has them').toBe(true);
    expect(src.includes('_geoParkRegions(_at,radiusM)'), 'park arms the full wake set, not one kerb').toBe(true);
  });

  test('the live watcher arms the baseline the moment tracking starts (mid-drive force close)', async () => {
    const src = readJs('geo-track.js');
    const i = src.indexOf("_geoParkNote('watcher-on'");
    expect(i).toBeGreaterThan(-1);
    const after = src.slice(i, i + 1500);
    expect(after.includes('startEvents'), 'the watcher-on path must arm the events baseline').toBe(true);
    expect(after.includes('_geoParkRegions(null)')).toBe(true);
  });

  test('the native plugin recreates its manager at launch (the wake handler)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');
    expect(src.includes('override public func load()'), 'no launch hook means a force-quit wake evaporates').toBe(true);
    expect(src.includes('td_geo_armed'), 'the armed state must persist for the relaunch to restore').toBe(true);
  });

  // ── The heartbeat arms at shift start, not only at park ────────────────────
  // Owner report 2026-08-27 (live device): a whole morning at a job with zero
  // heartbeat events, because the only call site was _geoEnterParkMode and
  // park needs minutes of live JS pings a pocketed phone never provides. The
  // beat now arms from every place JS provably runs.
  test('_geoHeartbeatSync arms the 30-minute beat, throttles re-arms, and a home park stops it', async () => {
    const r = await page.evaluate(async () => {
      // BARE bindings: _geoTdPlugin/_geoHbArmedAtMs/_placeIsLikelyHome are
      // module-scoped, window.* would set unrelated properties.
      const saved = { td: _geoTdPlugin, home: _placeIsLikelyHome };
      const calls = { start: [], stop: 0 };
      try {
        _geoTdPlugin = () => ({
          startHeartbeat: (o) => { calls.start.push(o); return Promise.resolve({ on: true }); },
          stopHeartbeat: () => { calls.stop++; return Promise.resolve({ on: false }); },
        });
        _placeIsLikelyHome = (c) => !!(c && c.lat === 39.9);
        _geoHbArmedAtMs = 0;
        _geoHeartbeatSync(null);                       // shift start: arms
        _geoHeartbeatSync(null);                       // 1s later: throttled
        const afterThrottle = calls.start.length;
        _geoHeartbeatSync({ lat: 39.9, lng: -94.9 });  // home park: stops
        const stops = calls.stop;
        _geoHeartbeatSync({ lat: 39.1, lng: -94.1 });  // work park right after home: re-arms (throttle was reset)
        return { first: calls.start[0] || null, afterThrottle, stops, total: calls.start.length };
      } finally {
        _geoTdPlugin = saved.td; _placeIsLikelyHome = saved.home; _geoHbArmedAtMs = 0;
      }
    });
    expect(r.first).toBeTruthy();
    expect(r.first.intervalMs).toBe(30 * 60000);
    expect(r.first.ttlMs).toBe(12 * 3600000);
    expect(r.afterThrottle, 'a second arm inside 60s must not hit the bridge').toBe(1);
    expect(r.stops, 'a likely-home park must stop the beat').toBe(1);
    expect(r.total, 'a work park after a home stop must re-arm').toBe(2);
  });

  test('a shell without startHeartbeat is a silent no-op', async () => {
    const r = await page.evaluate(() => {
      const saved = { td: _geoTdPlugin };
      try {
        _geoTdPlugin = () => ({});
        _geoHbArmedAtMs = 0;
        try { _geoHeartbeatSync(null); return { threw: false }; }
        catch (e) { return { threw: true, msg: e.message }; }
      } finally { _geoTdPlugin = saved.td; _geoHbArmedAtMs = 0; }
    });
    expect(r.threw, r.msg || '').toBe(false);
  });

  test('the heartbeat is wired at all three shift moments (source guarantee)', async () => {
    const src = readJs('geo-track.js');
    // 1. Tracking start: alongside the force-close net in the watcher-on path.
    const w = src.indexOf("_geoParkNote('watcher-on'");
    expect(w).toBeGreaterThan(-1);
    expect(src.slice(w, w + 1500).includes('_geoHeartbeatSync(null)'),
      'the watcher-on path must arm the heartbeat').toBe(true);
    // 2. Drive open.
    const d = src.indexOf('_geoDriveStartedAt=nowIso;_geoLegOrigin=_geoLastFenceLoc;');
    expect(d).toBeGreaterThan(-1);
    expect(src.slice(d, d + 400).includes('_geoHeartbeatSync(null)'),
      'a drive opening must arm the heartbeat').toBe(true);
    // 3. Park arm, with the park spot so home can turn it off.
    expect(src.includes('_geoHeartbeatSync(_at)'),
      'the park arm must sync the heartbeat against the park spot').toBe(true);
  });

  // ── Liveness + motion events (build 39) ────────────────────────────────────
  test('a heartbeat event never reaches the fence machine', async () => {
    // Its fix is 3km-accuracy keepalive garbage; through _geoOnPing it could
    // false-exit a fence. Liveness lives in the flush lane, not in position.
    const r = await page.evaluate(async () => {
      const saved = { ping: window._geoOnPing };
      let pings = 0;
      try {
        window._geoOnPing = async () => { pings++; };
        await _geoTdEvent({ type: 'heartbeat', ts: Date.now(), lat: 39.0, lng: -94.0, acc: 3000 });
        return { pings };
      } finally { window._geoOnPing = saved.ping; }
    });
    expect(r.pings).toBe(0);
  });

  test('motion into movement while parked buys ONE burst, throttled, and only live', async () => {
    const r = await page.evaluate(async () => {
      const saved = { td: window._geoTdPlugin, parked: _geoParkModeOn };
      let bursts = 0;
      try {
        window._geoTdPlugin = () => ({ burstFix: async () => { bursts++; } });
        _geoParkModeOn = true; _geoMotionBurstAt = 0;
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive' });
        const first = bursts;
        // Second transition 10 seconds later: inside the 3-minute throttle.
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'walking' });
        const throttled = bursts;
        // A REPLAYED transition is history, never a reason to fire radio now.
        _geoMotionBurstAt = 0;
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive' }, true);
        const replayed = bursts;
        // 'still' is the phone settling, not a departure.
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'still' });
        const still = bursts;
        // Not parked: the live watcher already owns the radio.
        _geoParkModeOn = false; _geoMotionBurstAt = 0;
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive' });
        return { first, throttled, replayed, still, unparked: bursts };
      } finally {
        window._geoTdPlugin = saved.td; _geoParkModeOn = saved.parked; _geoMotionBurstAt = 0;
      }
    });
    expect(r.first).toBe(1);
    expect(r.throttled).toBe(1);
    expect(r.replayed).toBe(1);
    expect(r.still).toBe(1);
    expect(r.unparked).toBe(1);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
