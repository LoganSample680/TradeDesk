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
    // Name the business zone: every midnight below is a business midnight now
    // that the day-key helpers follow the business address rather than a
    // hardcoded Central (owner 2026-08-30). Left unset it comes from the
    // runner, UTC in CI and Central on a Kansas laptop, which is the machine
    // deciding the result (CLAUDE.md 5.2.2).
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
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
    // Order changed deliberately (owner 2026-08-27, the parts run). This
    // fixture's 20 far places are all kind:'supply', so six of them now arm
    // in the reserved supply tier AHEAD of the pool. Old behavior: the kerb
    // fence then the three homes, because nothing outranked distance. New
    // behavior: the kerb fence, six nearest supply houses, then the pool
    // nearest-first. Both rules still hold and that is the point of the
    // reservation being six rather than unlimited: every near client keeps
    // its fence (asserted above) AND a parts run is catchable.
    expect(out.ids[0]).toBe('fence');
    expect(out.ids.slice(1, 7).every((id) => /^place-far/.test(id)),
      'the reserved supply tier arms directly after the kerb: ' + out.ids.join(',')).toBe(true);
    // Immediately after the reservation, the pool resumes nearest-first, so
    // the three homes still beat every remaining 7-mile place.
    expect(out.ids.slice(7, 10).sort()).toEqual(['client-901', 'client-902', 'client-903']);
  });

  test('the supply tier is reserved, never unlimited: near clients are not starved', async () => {
    // The failure mode the reservation exists to prevent. Twenty suppliers
    // with an unbounded tier would take all 18 slots and the client two
    // blocks away would lose its fence, re-creating the exact bug the pooled
    // tier was written to fix.
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice(), savedClients = clients.slice(), savedJobs = jobs.slice();
      const savedCache = window._nearbyGeoCache;
      const savedLat = S.officeLat, savedLon = S.officeLon;
      try {
        S.officeLat = null; S.officeLon = null;
        jobs.length = 0;
        places.length = 0;
        for (let i = 0; i < 20; i++) places.push({ id: 'sup' + i, kind: 'supply', lat: 39.1 + i * 0.01, lon: -94.5 });
        clients.length = 0;
        clients.push({ id: 911, name: 'Two blocks', addr: '1 Close St' });
        window._nearbyGeoCache = () => ({ 911: { addr: '1 Close St', lat: 39.001, lon: -94.001 } });
        const regs = _geoParkRegions({ lat: 39.0, lng: -94.0 }, 200);
        const ids = regs.map(r => r.id);
        return { ids, supplyCount: ids.filter(i => /^place-sup/.test(i)).length };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
        window._nearbyGeoCache = savedCache;
        S.officeLat = savedLat; S.officeLon = savedLon;
      }
    });
    expect(out.ids, 'the nearby client must keep its fence').toContain('client-911');
    // Six reserved, and the rest only via the pool: the tier itself cannot
    // grow past its reservation.
    expect(out.ids.slice(1, 7).every((id) => /^place-sup/.test(id))).toBe(true);
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

  test('a relaunch re-arms the MOTION stream too, not just the fences', async () => {
    // startMotionStream was called only from startParked and startEvents,
    // both of which run when JS asks. load() re-armed significant-change,
    // visits and the heartbeat and never this, so after a force-quit wake the
    // phone resumed fences and pings but stayed deaf to motion until somebody
    // opened the app. Every boundary the day is measured on was missed for
    // exactly the stretch the app was dead.
    const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');
    const i = src.indexOf('override public func load()');
    expect(i).toBeGreaterThan(-1);
    // The body of load(), up to the next top-level MARK.
    const rest = src.slice(i);
    const end = rest.indexOf('// MARK:');
    const body = end > -1 ? rest.slice(0, end) : rest;
    expect(body.includes('startMonitoringSignificantLocationChanges'),
      'a relaunch must re-arm significant-change').toBe(true);
    expect(body.includes('startMotionStream'),
      'a relaunch must re-arm the motion stream, or the phone wakes deaf to every boundary').toBe(true);
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

  // ── ONE ADDRESS, ONE REGION ──────────────────────────────────────────────
  // Owner, 2026-08-31: "why do we need two separate events laid out when we
  // only want one?" His house is saved twice, once as a home_office place and
  // once as a shop place, three metres apart. The old dedupe keyed on
  // toFixed(4), about eleven metres, and -95.71127 vs -95.71121 round to
  // DIFFERENT keys on the fourth decimal. Both armed, so every crossing fired
  // twice, three milliseconds apart, and whichever landed first decided the
  // row. 'fence' and 'shop' both render as anonymous names, which is how a
  // drive out of his own driveway came to read "Stop".
  test('two saved places at one address arm ONE region, and the named one wins', async () => {
    const r = await page.evaluate(() => {
      const savedPlaces = (typeof places !== 'undefined') ? places.slice() : [];
      const savedOffice = [S.officeLat, S.officeLon];
      try {
        // His real coordinates, to the digit.
        S.officeLat = 39.03071; S.officeLon = -95.71121;
        places.length = 0;
        places.push({ id: 'p-shop', name: 'TradeDesk shop', kind: 'shop', lat: 39.0307066, lon: -95.7112082 });
        places.push({ id: 'p-ho', name: '2015 SW Randolph Ave', kind: 'home_office', lat: 39.0307378, lon: -95.7112674 });
        const out = _geoParkRegions({ lat: 39.03072, lng: -95.71124 }, 180);
        return { ids: out.map(x => x.id), n: out.length };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        S.officeLat = savedOffice[0]; S.officeLon = savedOffice[1];
      }
    });
    // One region for the address, not three. The kerb spot, the business
    // address and both saved places are all inside 250 ft of each other.
    const atHouse = r.ids.filter(id => id === 'fence' || id === 'shop' || /^place-p-/.test(id));
    expect(atHouse.length, 'one address, one region: ' + JSON.stringify(r.ids)).toBe(1);
    // ...and it is the one that can NAME the place, never 'fence' or 'shop'.
    expect(atHouse[0]).toMatch(/^place-p-/);
  });

  test('a genuinely different address still gets its own region', async () => {
    // The merge must not swallow real places. 250 ft is "the same address",
    // not "the same neighbourhood".
    const r = await page.evaluate(() => {
      const savedPlaces = (typeof places !== 'undefined') ? places.slice() : [];
      try {
        places.length = 0;
        places.push({ id: 'p-a', name: 'Yard', kind: 'supply', lat: 39.0400, lon: -95.7500 });
        places.push({ id: 'p-b', name: 'Depot', kind: 'supply', lat: 39.0450, lon: -95.7550 });
        return _geoParkRegions(null, 180).map(x => x.id);
      } finally { places.length = 0; savedPlaces.forEach(p => places.push(p)); }
    });
    expect(r).toContain('place-p-a');
    expect(r).toContain('place-p-b');
  });

  test('the heartbeat is wired at all three shift moments (source guarantee)', async () => {
    const src = readJs('geo-track.js');
    // 1. Tracking start: alongside the force-close net in the watcher-on path.
    const w = src.indexOf("_geoParkNote('watcher-on'");
    expect(w).toBeGreaterThan(-1);
    expect(src.slice(w, w + 1500).includes('_geoHeartbeatSync(null)'),
      'the watcher-on path must arm the heartbeat').toBe(true);
    // 2. Drive open.
    // The anchor used to be `_geoDriveStartedAt=nowIso;...`. The leg no longer
    // always opens at now: a pending foot->automotive edge from the motion
    // tape opens it at the moment the truck actually pulled out (2026-08-31),
    // so the assignment is a ternary. Still the one line in the file that
    // opens a drive, which is what this guarantee is about, and deliberately
    // NOT anchored on `_geoLegOrigin=_geoLastFenceLoc;`: that string appears
    // at two sites and indexOf would silently grade the wrong one.
    const d = src.indexOf('_geoDriveStartedAt=_useTape?');
    expect(d).toBeGreaterThan(-1);
    // ANCHORED ON THE BLOCK, NOT ON A CHARACTER COUNT (2026-09-01).
    // This was `d + 1100`, and the note above it admitted the number "keeps
    // growing because this site keeps earning comments": 737, then 1100, then
    // it broke again the moment the route-seed fix documented itself there.
    // A magic width fails on a comment and passes on a real regression of the
    // same size, which is the worst of both. The guarantee was only ever that
    // the heartbeat is armed INSIDE the drive-open block, so the window now
    // ends where the block does. Nothing to bump next time.
    const dEnd = src.indexOf('This exit was JUST confirmed', d);
    expect(dEnd, 'the drive-open block must still end where it says it does').toBeGreaterThan(d);
    expect(src.slice(d, dEnd).includes('_geoHeartbeatSync(null)'),
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

  // The parts run (owner 2026-08-27). It happens WHILE parked, with live GPS
  // shut down, so a fence at the counter is the only thing that can catch it.
  test('a far-off supply house still gets a wake fence, ahead of nearer places', async () => {
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice(), savedClients = clients.slice(), savedJobs = jobs.slice();
      try {
        places.length = 0; clients.length = 0; jobs.length = 0;
        // 20 ordinary places right on top of the park spot: more than the
        // 18-region cap, so without its own tier the supply house 30 miles
        // away loses every slot and the parts run logs nothing.
        for (let i = 0; i < 20; i++) {
          places.push({ id: 'near-' + i, kind: 'other', lat: 39.0 + i * 0.0001, lon: -95.7 });
        }
        places.push({ id: 'sup-far', kind: 'supply', lat: 39.5, lon: -95.7 });
        const regs = _geoParkRegions({ lat: 39.0, lng: -95.7 });
        return {
          ids: regs.map(r => r.id),
          hasSupply: regs.some(r => r.id === 'place-sup-far'),
          count: regs.length,
        };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
      }
    });
    expect(out.hasSupply, 'a saved supply house must always get a fence: ' + out.ids.join(',')).toBe(true);
    expect(out.count, 'the region cap still holds').toBeLessThanOrEqual(18);
  });

  test('many supply houses arm nearest-first, and none is ever duplicated', async () => {
    const out = await page.evaluate(() => {
      const savedPlaces = places.slice(), savedClients = clients.slice(), savedJobs = jobs.slice();
      try {
        places.length = 0; clients.length = 0; jobs.length = 0;
        places.push({ id: 'sup-far', kind: 'supply', lat: 39.9, lon: -95.7 });
        places.push({ id: 'sup-near', kind: 'supply', lat: 39.01, lon: -95.7 });
        places.push({ id: 'sup-mid', kind: 'supply', lat: 39.2, lon: -95.7 });
        const regs = _geoParkRegions({ lat: 39.0, lng: -95.7 });
        const sup = regs.map(r => r.id).filter(id => id.startsWith('place-sup'));
        return { sup, uniq: new Set(regs.map(r => r.id)).size === regs.length };
      } finally {
        places.length = 0; savedPlaces.forEach(p => places.push(p));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
      }
    });
    expect(out.sup).toEqual(['place-sup-near', 'place-sup-mid', 'place-sup-far']);
    expect(out.uniq, 'the supply tier must not re-add what the pool already armed').toBe(true);
  });

  test('lifecycle and push-ping events never reach the fence machine', async () => {
    // Same rule as the heartbeat above: liveness bookkeeping must not carry
    // position authority. An app-background row has no fix, and a push-ping
    // fix can be minutes-stale cache; either through _geoOnPing could
    // false-exit a fence.
    const r = await page.evaluate(async () => {
      const saved = { ping: window._geoOnPing };
      let pings = 0;
      try {
        window._geoOnPing = async () => { pings++; };
        await _geoTdEvent({ type: 'app-background', ts: Date.now() });
        await _geoTdEvent({ type: 'app-active', ts: Date.now() });
        await _geoTdEvent({ type: 'app-relaunch', ts: Date.now() });
        await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.0, lng: -94.0, acc: 800 });
        return { pings };
      } finally { window._geoOnPing = saved.ping; }
    });
    expect(r.pings).toBe(0);
  });

  // ── The update rides the wake (owner 2026-08-28) ──────────────────────────
  // New web code used to reach a phone only when somebody opened the app, so
  // a backgrounded phone sat on old JS and then reloaded in the owner's hand.
  const bgUpd = (opts) => page.evaluate(async (o) => {
    const saved = { fetch: window.fetch, reload: window._autoSaveAndReload, hidden: Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') };
    let reloads = 0, fetches = 0;
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => o.hidden });
      window.fetch = async () => { fetches++; return { ok: true, json: async () => ({ version: o.serverVersion }) }; };
      window._autoSaveAndReload = async () => { reloads++; };
      _geoBgUpdAt = 0;
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39, lng: -95, acc: 20 });
      await new Promise(r => setTimeout(r, 60));
      return { reloads, fetches, running: APP_VERSION };
    } finally {
      window.fetch = saved.fetch; window._autoSaveAndReload = saved.reload;
      delete document.hidden;
      if (saved.hidden) Object.defineProperty(Document.prototype, 'hidden', saved.hidden);
      _geoBgUpdAt = 0;
    }
  }, opts);

  test('a backgrounded phone on an old version reloads on the push wake', async () => {
    const r = await bgUpd({ hidden: true, serverVersion: '99.99.99.9' });
    expect(r.fetches, 'the wake must check the live version').toBe(1);
    expect(r.reloads, 'a version that moved must reload while nobody is looking').toBe(1);
  });

  test('a backgrounded phone already current never reloads', async () => {
    const cur = await page.evaluate(() => APP_VERSION);
    const r = await bgUpd({ hidden: true, serverVersion: cur });
    expect(r.fetches).toBe(1);
    expect(r.reloads, 'same version, nothing to do').toBe(0);
  });

  test('a VISIBLE app is never reloaded from the wake: the foreground path owns that', async () => {
    const r = await bgUpd({ hidden: false, serverVersion: '99.99.99.9' });
    expect(r.fetches, 'a visible app must not even probe').toBe(0);
    expect(r.reloads, 'reloading in the user\'s face is the thing this avoids').toBe(0);
  });

  test('several buffered events in one wake cost ONE probe, not one each', async () => {
    const r = await page.evaluate(async () => {
      const saved = { fetch: window.fetch, reload: window._autoSaveAndReload };
      let fetches = 0;
      try {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        const cur = APP_VERSION;
        window.fetch = async () => { fetches++; return { ok: true, json: async () => ({ version: cur }) }; };
        window._autoSaveAndReload = async () => {};
        _geoBgUpdAt = 0;
        for (let i = 0; i < 5; i++) await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39, lng: -95, acc: 20 });
        await new Promise(r => setTimeout(r, 60));
        return { fetches };
      } finally {
        window.fetch = saved.fetch; window._autoSaveAndReload = saved.reload;
        delete document.hidden; _geoBgUpdAt = 0;
      }
    });
    expect(r.fetches).toBe(1);
  });

  test('a REPLAYED buffer never triggers an update: those events are history', async () => {
    const r = await page.evaluate(async () => {
      const saved = { fetch: window.fetch };
      let fetches = 0;
      try {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        window.fetch = async () => { fetches++; return { ok: true, json: async () => ({ version: '99.99.99.9' }) }; };
        _geoBgUpdAt = 0;
        await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39, lng: -95, acc: 20 }, true);
        await new Promise(r => setTimeout(r, 60));
        return { fetches };
      } finally { window.fetch = saved.fetch; delete document.hidden; _geoBgUpdAt = 0; }
    });
    expect(r.fetches).toBe(0);
  });

  test('the geo-ping cron chain is wired end to end (source guarantee)', async () => {
    // Three files have to agree for the 30-minute nudge to exist at all:
    // the cron workflow, the edge function it calls, and the AppDelegate
    // patch that lets iOS deliver the push to TdGeo. Any one missing and
    // the others are dead weight that LOOKS shipped.
    const root = path.join(__dirname, '..');
    const cron = fs.readFileSync(path.join(root, '.github', 'workflows', 'geo-ping-cron.yml'), 'utf8');
    expect(cron.includes('*/30 * * * *'), 'the cron must tick every 30 minutes').toBe(true);
    expect(cron.includes('push-geo-ping'), 'the cron must call the push function').toBe(true);
    const fn = fs.readFileSync(path.join(root, 'supabase', 'functions', 'push-geo-ping', 'index.ts'), 'utf8');
    expect(fn.includes('"content-available": 1'), 'the push must be silent').toBe(true);
    expect(fn.includes('"apns-push-type": "background"'), 'Apple rejects background payloads sent as alerts').toBe(true);
    expect(fn.includes('cron_watermarks'), 'the open endpoint must be rate-gated').toBe(true);
    const beta = fs.readFileSync(path.join(root, '.github', 'workflows', 'ios-beta.yml'), 'utf8');
    expect(beta.includes('didReceiveRemoteNotification'), 'without the AppDelegate patch silent pushes evaporate').toBe(true);
    expect(beta.includes('TdSilentPush'), 'the AppDelegate must forward to TdGeo').toBe(true);
    const swift = fs.readFileSync(path.join(root, 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');
    expect(swift.includes('TdSilentPush'), 'TdGeo must listen for the forward').toBe(true);
    expect(swift.includes('app-background'), 'lifecycle tracking must record backgrounding').toBe(true);
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



  // ── The chain breaks, and the rest of the day goes with it ────────────────
  test.describe('_geoTruncateDayAfter and loading up', () => {
    test('_geoLoadBeforeDrive finds his six morning minutes, cycling included', async () => {
      const r = await page.evaluate(() => {
        // His real 08-27 morning, CT: 06:56 onFoot, 06:56 still, 07:43:54
        // "cycling" (CoreMotion reading a walk round the truck), 07:44:23
        // still, 07:49:43 driving.
        const T = (h, m, s2) => Date.UTC(2026, 7, 27, h + 5, m, s2 || 0);
        const tape = [
          { ts: T(6, 56, 7), kind: 'onFoot' }, { ts: T(6, 56, 35), kind: 'still' },
          { ts: T(7, 43, 54), kind: 'cycling' }, { ts: T(7, 44, 23), kind: 'still' },
        ];
        const w = _geoLoadBeforeDrive(tape, T(7, 49, 43));
        return { mins: w ? Math.round((w[1] - w[0]) / 60000) : null,
                 startsAt: w ? new Date(w[0]).toISOString() : null };
      });
      expect(r.mins, '07:43:54 to 07:49:43').toBe(6);
      expect(r.startsAt).toBe('2026-08-27T12:43:54.000Z');
    });

    test('_geoLoadBeforeDrive refuses the shapes that are not a load-out', async () => {
      const r = await page.evaluate(() => {
        const T = (h, m, s2) => Date.UTC(2026, 7, 27, h + 5, m, s2 || 0);
        const at = (h, m, s2, kind) => ({ ts: T(h, m, s2), kind });
        return {
          // Sitting still right up to the drive is getting in the cab.
          none: _geoLoadBeforeDrive([at(7, 20, 0, 'still')], T(7, 49, 43)),
          // A walk that ended two hours earlier was some other errand.
          stale: _geoLoadBeforeDrive([at(5, 30, 0, 'onFoot')], T(7, 49, 43)),
          // Thirty seconds is not loading.
          tiny: _geoLoadBeforeDrive([at(7, 49, 13, 'onFoot')], T(7, 49, 43)),
          empty: _geoLoadBeforeDrive([], T(7, 49, 43)),
          nulls: _geoLoadBeforeDrive(null, 0),
        };
      });
      expect(r.none).toBeNull();
      expect(r.stale).toBeNull();
      expect(r.tiny).toBeNull();
      expect(r.empty).toBeNull();
      expect(r.nulls).toBeNull();
    });


  });


  // ── Park state survives a reload, so the off-switch stays reachable ───────
  //
  // Measured on the owner's own phone 2026-09-05: 118 fixes in one hour from
  // five locations, gaps of exactly 30.0s, for four and a half hours. The iOS
  // 17 wake stream doing its job while armed, with nothing able to disarm it.
  // The ON is durable (UserDefaults, re-armed by the plugin on relaunch); the
  // OFF was a plain JS `let` that a reload wiped.
  test.describe('the park off-switch is as durable as the on-switch', () => {
    const boot = (setup) => page.evaluate(({ setup }) => {
      const saved = { td: _geoTdPlugin, park: _geoParkModeOn, spot: _geoParkSpot,
                      user: window._supaUser, restored: window._geoParkRestored };
      window.__wake = [];
      _geoTdPlugin = () => ({ setWakeOnMove: async (a) => { window.__wake.push(a); return a; } });
      window._supaUser = { id: 'owner-uid' };
      _geoParkModeOn = false; _geoParkSpot = null;
      window._geoParkRestored = false;
      localStorage.removeItem('zp3_geo_park');
      // Built INSIDE the page: the page clock is pinned and the runner's is not,
      // so an absolute stamp from the test side would be hours off (5.2.2).
      if (setup.store) {
        localStorage.setItem('zp3_geo_park', JSON.stringify({
          spot: { lat: 41.5, lng: -88.1, name: setup.name || '' },
          at: Date.now() - (setup.ageMs || 0),
          uid: setup.uid || 'owner-uid',
        }));
      }
      const ok = _geoParkRestore();
      const out = { ok, park: _geoParkModeOn, spot: _geoParkSpot,
                    wake: window.__wake.slice(), left: localStorage.getItem('zp3_geo_park') };
      _geoTdPlugin = saved.td; _geoParkModeOn = saved.park; _geoParkSpot = saved.spot;
      window._supaUser = saved.user; window._geoParkRestored = saved.restored;
      localStorage.removeItem('zp3_geo_park');
      return out;
    }, { setup });

    test('a park written down comes back, and nothing is disarmed', async () => {
      const r = await boot({ store: true, ageMs: 60000, name: 'TradeDesk shop' });
      expect(r.ok).toBe(true);
      expect(r.park, 'JS believes it is parked again, so park-exit can run').toBe(true);
      expect(r.spot.name).toBe('TradeDesk shop');
      expect(r.wake.length, 'a real park must never be disarmed on boot').toBe(0);
    });

    test('no park stored: the plugin is told to drop the stream', async () => {
      const r = await boot({});
      expect(r.ok).toBe(false);
      expect(r.park).toBe(false);
      expect(r.wake, 'the phone must not hold a stream this session knows nothing about')
        .toEqual([{ on: false }]);
    });

    test('a park older than the shift is not a park', async () => {
      const r = await boot({ store: true, ageMs: 13 * 3600000 });
      expect(r.ok, 'a weekend at the shop must not restore on Monday').toBe(false);
      expect(r.wake).toEqual([{ on: false }]);
      expect(r.left, 'and the stale record is cleared').toBe(null);
    });

    test("another login's park is not mine", async () => {
      const r = await boot({ store: true, ageMs: 60000, uid: 'somebody-else' });
      expect(r.ok).toBe(false);
      expect(r.wake).toEqual([{ on: false }]);
    });

    test('junk in storage disarms rather than throwing or restoring', async () => {
      const r = await page.evaluate(() => {
        const saved = { td: _geoTdPlugin, park: _geoParkModeOn, restored: window._geoParkRestored, user: window._supaUser };
        window._supaUser = { id: 'owner-uid' };
        const out = [];
        for (const junk of ['{BROKEN{{', 'null', '[]', '{"at":"nope"}', '{}']) {
          window.__wake = [];
          _geoTdPlugin = () => ({ setWakeOnMove: async (a) => { window.__wake.push(a); return a; } });
          _geoParkModeOn = false; window._geoParkRestored = false;
          localStorage.setItem('zp3_geo_park', junk);
          let threw = false;
          try { out.push({ ok: _geoParkRestore(), wake: window.__wake.length }); } catch (e) { threw = true; }
          if (threw) { out.push('THREW'); break; }
        }
        localStorage.removeItem('zp3_geo_park');
        _geoTdPlugin = saved.td; _geoParkModeOn = saved.park;
        window._geoParkRestored = saved.restored; window._supaUser = saved.user;
        return out;
      });
      expect(r).not.toContain('THREW');
      expect(r.every(x => x.ok === false && x.wake === 1), 'every junk shape ends with the stream dropped').toBe(true);
    });

    test('it runs at most once per page load', async () => {
      const r = await page.evaluate(() => {
        const saved = { td: _geoTdPlugin, park: _geoParkModeOn, restored: window._geoParkRestored, user: window._supaUser };
        window._supaUser = { id: 'owner-uid' };
        window.__wake = [];
        _geoTdPlugin = () => ({ setWakeOnMove: async (a) => { window.__wake.push(a); return a; } });
        _geoParkModeOn = false; window._geoParkRestored = false;
        localStorage.removeItem('zp3_geo_park');
        const a = _geoParkRestore(), b = _geoParkRestore(), c = _geoParkRestore();
        const n = window.__wake.length;
        _geoTdPlugin = saved.td; _geoParkModeOn = saved.park;
        window._geoParkRestored = saved.restored; window._supaUser = saved.user;
        return { a, b, c, n };
      });
      expect(r.b).toBe(false);
      expect(r.c).toBe(false);
      expect(r.n, 'one disarm, not one per caller').toBe(1);
    });

    test('entering park writes it down, exiting park forgets it', async () => {
      const r = await page.evaluate(() => {
        const saved = { park: _geoParkModeOn, user: window._supaUser, td: _geoTdPlugin };
        window._supaUser = { id: 'owner-uid' };
        _geoTdPlugin = () => ({ stopAll: async () => {} });
        localStorage.removeItem('zp3_geo_park');
        _geoParkPersist({ lat: 41.5, lng: -88.1, name: 'shop' });
        const wrote = JSON.parse(localStorage.getItem('zp3_geo_park') || 'null');
        _geoParkModeOn = true;
        _geoExitParkMode();
        const after = localStorage.getItem('zp3_geo_park');
        _geoParkModeOn = saved.park; window._supaUser = saved.user; _geoTdPlugin = saved.td;
        return { wrote: !!(wrote && wrote.spot && wrote.spot.name === 'shop'), after };
      });
      expect(r.wrote).toBe(true);
      expect(r.after, 'a park that ended must not restore on the next boot').toBe(null);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });


  // The 30-row cap that cut a day in half (found 2026-08-30 against live data).
  test.describe('_geoWholeDays: a day is never half swept', () => {
    test('stops at a day boundary, never mid-day, even past the row cap', async () => {
      const r = await page.evaluate(() => {
        const rows = [];
        // Newest first: 29 rows on the 29th, then 9 on the 27th, exactly the
        // shape that put 08/27 at positions 24..32 behind a cap of 30.
        for (let i = 0; i < 29; i++) rows.push({ id: 'a' + i, arrived_at: '2026-08-29T' + String(23 - (i % 23)).padStart(2, '0') + ':00:00.000Z' });
        for (let i = 0; i < 9; i++) rows.push({ id: 'b' + i, arrived_at: '2026-08-27T' + String(20 - i).padStart(2, '0') + ':00:00.000Z' });
        const out = _geoWholeDays(rows, 'arrived_at', 7, 30);
        const ids = out.map(x => x.id);
        return {
          n: out.length,
          allNine: ids.filter(x => x[0] === 'b').length,
          none: _geoWholeDays([], 'arrived_at', 7, 30).length,
          junk: _geoWholeDays([null, { arrived_at: 'nope' }, undefined], 'arrived_at', 7, 30).length,
          nullArr: _geoWholeDays([], 'arrived_at', 0, 0).length,
        };
      });
      // The cap is exceeded rather than splitting 08/27: all nine or none.
      expect(r.allNine, 'the day that broke this must arrive whole').toBe(9);
      expect(r.n).toBe(38);
      expect(r.none).toBe(0);
      expect(r.junk, 'unparseable timestamps are skipped, never thrown on').toBe(0);
      expect(r.nullArr).toBe(0);
    });

    test('the day limit counts days, not rows', async () => {
      const r = await page.evaluate(() => {
        const rows = [];
        ['29', '28', '27', '26'].forEach(d => {
          for (let i = 0; i < 5; i++) rows.push({ id: d + i, arrived_at: '2026-08-' + d + 'T1' + i + ':00:00.000Z' });
        });
        const two = _geoWholeDays(rows, 'arrived_at', 2, 999);
        return { n: two.length, days: [...new Set(two.map(x => x.id.slice(0, 2)))] };
      });
      expect(r.n).toBe(10);
      expect(r.days.sort()).toEqual(['28', '29']);
    });
  });
});
