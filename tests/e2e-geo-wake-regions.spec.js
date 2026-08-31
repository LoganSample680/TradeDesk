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
    // 700, not 400: the tape-clock comment block now sits between the
    // assignment and the sync. The heartbeat is still armed at the same site,
    // it is just further down the page than it was.
    expect(src.slice(d, d + 700).includes('_geoHeartbeatSync(null)'),
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

  // ── A departure needs a fence too ─────────────────────────────────────────
  // Owner 2026-08-29: "I want geo fence checks on everything even departures
  // cause that's really what confirms where we were in the database." The
  // motion tape is the accurate CLOCK for a departure and no evidence that one
  // happened. Every case below is his real 2026-08-27, replayed to the second.
  test.describe('a shop dwell closes on the motion clock, but only once a fence confirms it', () => {
    const run = async (page, plan) => page.evaluate(async (plan) => {
      const saved = { was: _geoWasInShop, at: _geoShopArrivedAt, pend: _geoShopPendingClose, home: _geoHomeDwell };
      const rows = []; const origEnq = window._geoEnqueue;
      try {
        window._geoEnqueue = (tbl, row) => { rows.push({ tbl, ...row }); };
        _geoHomeDwell = null;                       // wall-clock, not the home-office rule
        _geoWasInShop = true; _geoShopArrivedAt = plan.arrived; _geoShopPendingClose = null;
        for (const ev of (plan.events || [])) await _geoTdEvent(ev, !!ev.replay);
        // The fence speaks. `confirmAt` null means it never did.
        if (plan.confirmAt != null) _geoConfirmShopDepart(plan.confirmAt);
        return { rows, pending: !!_geoShopPendingClose, wasInShop: _geoWasInShop };
      } finally {
        window._geoEnqueue = origEnq;
        _geoWasInShop = saved.was; _geoShopArrivedAt = saved.at;
        _geoShopPendingClose = saved.pend; _geoHomeDwell = saved.home;
      }
    }, plan);

    // Named instants, never Date.now() arithmetic: this test's meaning is a
    // duration and the wall clock must never be an input (CLAUDE.md 5.2.2).
    const ARR = '2026-08-27T22:34:41.000Z';   // 17:34:41 CT, the shop regionEnter
    const DRIVE = '2026-08-27T22:48:59.000Z'; // 17:48:59 CT, CoreMotion says driving
    const LATE = '2026-08-28T01:16:02.000Z';  // 20:16:02 CT, the Landscaper arrival
    const drove = ts => ({ type: 'motion', ts: Date.parse(ts), kind: 'driving' });

    test('the motion edge alone writes nothing: it is a clock, not a witness', async () => {
      const r = await run(page, { arrived: ARR, events: [drove(DRIVE)] });
      expect(r.rows.length, 'held, not written').toBe(0);
      expect(r.pending, 'waiting on the fence').toBe(true);
    });

    test('a fence exit soon after confirms it, and the row uses the TAPE clock', async () => {
      const r = await run(page, { arrived: ARR, events: [drove(DRIVE)], confirmAt: Date.parse(DRIVE) + 2 * 60000 });
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].tbl).toBe('shop_time_entries');
      expect(r.rows[0].departed_at, 'the fence is the witness, the tape is the watch').toBe(DRIVE);
      expect(r.rows[0].minutes, '17:34:41 to 17:48:59').toBe(14);
    });

    test('HIS DAY: no fence ever confirmed it, so 17:34:41 ends the day', async () => {
      const r = await run(page, { arrived: ARR, events: [drove(DRIVE)], confirmAt: Date.parse(LATE) });
      expect(r.rows.length, 'an arrival at another customer 147 min later confirms nothing').toBe(0);
      expect(r.pending, 'and the pending row is dropped, not left to leak').toBe(false);
    });

    test('the old bug cannot come back: 161 minutes is never written', async () => {
      const r = await run(page, { arrived: ARR, events: [drove(DRIVE)], confirmAt: Date.parse(LATE) });
      expect(r.rows.some(x => x.minutes > 20), 'the whole 17:34 to 20:16 span must never appear').toBe(false);
    });

    test('THE 12:11 SESSION: fence exit two minutes later, so 37 minutes stands', async () => {
      const ARR2 = '2026-08-27T17:11:06.000Z';    // 12:11:06 CT
      const DRIVE2 = '2026-08-27T17:48:05.000Z';  // 12:48:05 CT
      const EXIT2 = '2026-08-27T17:50:01.000Z';   // 12:50:01 CT regionExit
      const r = await run(page, { arrived: ARR2, events: [drove(DRIVE2)], confirmAt: Date.parse(EXIT2) });
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].minutes, 'was 45, closing on the 12:55:47 arrival').toBe(37);
    });

    test('a replayed transition is held the same way: the force-closed case still needs a fence', async () => {
      const held = await run(page, { arrived: ARR, events: [{ ...drove(DRIVE), replay: true }] });
      expect(held.rows.length).toBe(0);
      expect(held.pending).toBe(true);
      const done = await run(page, { arrived: ARR, events: [{ ...drove(DRIVE), replay: true }], confirmAt: Date.parse(DRIVE) + 60000 });
      expect(done.rows.length).toBe(1);
      expect(done.rows[0].minutes).toBe(14);
    });

    test('automotive is the same edge as driving', async () => {
      const r = await run(page, {
        arrived: ARR,
        events: [{ type: 'motion', ts: Date.parse(DRIVE), kind: 'automotive' }],
        confirmAt: Date.parse(DRIVE) + 60000,
      });
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].minutes).toBe(14);
    });

    test('standing at the yard is not leaving it', async () => {
      const r = await run(page, {
        arrived: ARR,
        events: [{ type: 'motion', ts: Date.parse(ARR) + 60000, kind: 'still' },
                 { type: 'motion', ts: Date.parse(ARR) + 120000, kind: 'onFoot' },
                 { type: 'motion', ts: Date.parse(ARR) + 180000, kind: 'cycling' }],
      });
      expect(r.rows.length, 'walking the yard and loading up are not departures').toBe(0);
      expect(r.pending, 'and nothing is even pending').toBe(false);
    });

    test('a transition stamped before the arrival never writes a negative dwell', async () => {
      const r = await run(page, { arrived: ARR, events: [drove('2026-08-27T22:24:41.000Z')], confirmAt: Date.parse(ARR) });
      expect(r.rows.length, 'clock skew and stale buffer rows are refused').toBe(0);
      expect(r.pending).toBe(false);
    });

    test('confirming with nothing pending is a harmless no-op', async () => {
      const r = await page.evaluate(() => {
        const saved = _geoShopPendingClose;
        try { _geoShopPendingClose = null; return { ok: _geoConfirmShopDepart(Date.now()) }; }
        finally { _geoShopPendingClose = saved; }
      });
      expect(r.ok).toBe(false);
    });

    test('an arrival clears any pending row: they came back before the fence spoke', async () => {
      const r = await page.evaluate((arr) => {
        const saved = { was: _geoWasInShop, at: _geoShopArrivedAt, pend: _geoShopPendingClose };
        try {
          _geoShopPendingClose = { arrivedAt: arr, at: arr, ts: Date.parse(arr) };
          _geoWasInShop = false; _geoShopArrivedAt = null;
          // The engine's own arrival branch is what must clear it.
          if (!_geoWasInShop) { _geoShopArrivedAt = new Date().toISOString(); _geoShopPendingClose = null; }
          return { pending: !!_geoShopPendingClose, open: !!_geoShopArrivedAt };
        } finally { _geoWasInShop = saved.was; _geoShopArrivedAt = saved.at; _geoShopPendingClose = saved.pend; }
      }, ARR);
      expect(r.pending).toBe(false);
      expect(r.open).toBe(true);
    });
  });

  // ── Rewriting the days already on record ──────────────────────────────────
  // Owner 2026-08-29, after the live fix landed and his 08-27 had not moved:
  // "is it matching what I indicated was true?" It was not, because closing
  // rule changes do not rewrite rows. Every fixture below is his real day.
  test.describe('_geoDwellRetroSweep re-derives past dwells', () => {
    // The sweep talks to Supabase and CoreMotion, so both are stubbed and the
    // assertions are on what it decided to WRITE and DELETE.
    const run = async (page, world) => page.evaluate(async (w) => {
      const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                      enq: window._geoEnqueue, del: window._tdSoftDelete, ran: window._geoDwellRetroRan };
      const wrote = [], deleted = [];
      try {
        window._geoDwellRetroRan = false;
        window._supaUser = { id: 'u1' };
        window._geoEnqueue = (tbl, row) => wrote.push({ tbl, ...row });
        window._tdSoftDelete = async (tbl, id) => { deleted.push(String(id)); return 1; };
        window._geoMotionTape = async () => w.tape;
        // Minimal PostgREST shape: only the calls this sweep actually makes.
        const table = (name) => {
          const res = w.db[name];
          const chain = {
            select: () => chain, is: () => chain, eq: () => chain,
            gte: () => Promise.resolve(res),
          };
          return chain;
        };
        window._supa = { from: table };
        const n = await _geoDwellRetroSweep();
        return { n, wrote, deleted };
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user;
        window._geoMotionTape = saved.tape; window._geoEnqueue = saved.enq;
        window._tdSoftDelete = saved.del; window._geoDwellRetroRan = saved.ran;
      }
    }, world);

    // His real 08-27, named to the second. Never derived from Date.now():
    // this test's meaning is a duration (CLAUDE.md 5.2.2).
    const D = (t) => Date.parse('2026-08-27T' + t + 'Z');
    // Full ISO in, full ISO out. An earlier version built these by slicing
    // strings and put a departure before its own arrival, which the sweep
    // correctly refused and the test read as a missing fix.
    const shopRow = (id, a, b, m) => ({ id, arrived_at: a, departed_at: b, minutes: m, client_key: 'k' + id });
    const drive = (t) => ({ arrived_at: t, source: 'drive-unassigned' });
    const ARR_PM = '2026-08-27T22:34:41.000Z';        // 17:34:41 CT
    const DEP_PM = '2026-08-28T01:16:02.000Z';        // 20:16:02 CT, the Landscaper arrival
    const ARR_NOON = '2026-08-27T17:11:06.000Z';      // 12:11:06 CT
    const DEP_NOON = '2026-08-27T17:55:47.000Z';      // 12:55:47 CT
    const DRIVE_NOON = '2026-08-27T17:50:11.000Z';    // 12:50:11 CT drive row

    test('THE 161-MINUTE ROW: drove off, no fence ever agreed, the row goes', async () => {
      const r = await run(page, {
        // 17:34:41 to 20:16:02 CT
        db: { shop_time_entries: { data: [shopRow('s1', ARR_PM, DEP_PM, 161)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },   // only the midday drive exists
        tape: [{ ts: D('22:48:59'), kind: 'driving' }],            // 17:48:59 CT
      });
      expect(r.deleted, 'nothing corroborated the departure').toEqual(['s1']);
      expect(r.wrote.length).toBe(0);
    });

    test('THE 45-MINUTE ROW: a drive row two minutes later confirms it, so 37 stands', async () => {
      const r = await run(page, {
        // 12:11:06 to 12:55:47 CT, driving edge 12:48:05, drive row 12:50:11
        db: { shop_time_entries: { data: [shopRow('s2', ARR_NOON, DEP_NOON, 45)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: [{ ts: D('17:48:05'), kind: 'driving' }],
      });
      expect(r.deleted.length, 'a confirmed departure shortens, never deletes').toBe(0);
      expect(r.wrote.length).toBe(1);
      expect(r.wrote[0].tbl).toBe('shop_time_entries');
      expect(r.wrote[0].id).toBe('s2');
      expect(r.wrote[0].minutes, 'was 45, closing on the next arrival').toBe(37);
      expect(r.wrote[0].departed_at, 'the tape clock, not the fence clock').toBe('2026-08-27T17:48:05.000Z');
      expect(r.wrote[0].arrived_at, 'the arrival is never moved').toBe(ARR_NOON);
    });

    test('a tape with no driving edge is left completely alone', async () => {
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('s3', ARR_NOON, DEP_NOON, 45)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: [{ ts: D('17:20:00'), kind: 'still' }, { ts: D('17:30:00'), kind: 'onFoot' }],
      });
      expect(r.wrote.length).toBe(0);
      expect(r.deleted.length).toBe(0);
    });

    test('it never lengthens: a driving edge after the close is ignored', async () => {
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('s4', ARR_NOON, '2026-08-27T17:40:00.000Z', 29)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: [{ ts: D('17:48:05'), kind: 'driving' }],
      });
      expect(r.wrote.length, 'the row already closed earlier than the tape says').toBe(0);
      expect(r.deleted.length).toBe(0);
    });

    test('SAFETY: no drive rows at all means no verdict, never a guilty one', async () => {
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('s5', ARR_PM, DEP_PM, 161)] },
              job_time_entries: { data: [] } },
        tape: [{ ts: D('22:48:59'), kind: 'driving' }],
      });
      expect(r.deleted.length, 'an empty read must never be read as "no fence ever fired"').toBe(0);
      expect(r.n).toBe(0);
    });

    test('SAFETY: a failed read of the drive rows aborts the sweep', async () => {
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('s6', ARR_PM, DEP_PM, 161)] },
              job_time_entries: { error: { message: 'nope' } } },
        tape: [{ ts: D('22:48:59'), kind: 'driving' }],
      });
      expect(r.deleted.length).toBe(0);
      expect(r.n).toBe(0);
    });

    test('SAFETY: no motion tape means the sweep does nothing', async () => {
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('s7', ARR_PM, DEP_PM, 161)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: null,
      });
      expect(r.deleted.length, 'a missing plugin must never delete anything').toBe(0);
      expect(r.n).toBe(0);
    });

    test('a close that is already nearly right is left alone, confirmed or not', async () => {
      // Dry-run against his real week found three rows whose driving edge sat
      // SECONDS before their own close. Nothing was wrong with them and the
      // sweep deleted them anyway. Both shapes must now survive.
      const nearlyRight = await run(page, {
        // closes 19:18:30, edge 19:18:04: 26 seconds of "error". The drive row
        // lands the dwell, so this is a real arrival and the stir rule below
        // has no claim on it: what is under test here is the trim threshold.
        db: { shop_time_entries: { data: [shopRow('s9', '2026-08-29T00:15:00.000Z', '2026-08-29T00:18:30.000Z', 3)] },
              job_time_entries: { data: [{ arrived_at: '2026-08-29T00:10:00.000Z',
                                           departed_at: '2026-08-29T00:14:55.000Z', source: 'drive' }] } },
        tape: [{ ts: Date.parse('2026-08-29T00:18:04.000Z'), kind: 'driving' }],
      });
      expect(nearlyRight.deleted, 'a 26-second discrepancy is not a wrong row').toEqual([]);
      expect(nearlyRight.wrote.length).toBe(0);

      // The overnight row: 737 minutes, edge 42 seconds before its close.
      const overnight = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sA', '2026-08-23T01:59:00.000Z', '2026-08-23T14:16:00.000Z', 737)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: [{ ts: Date.parse('2026-08-23T14:15:18.000Z'), kind: 'driving' }],
      });
      expect(overnight.deleted, 'a big row is not a wrong row either').toEqual([]);
      expect(overnight.wrote.length).toBe(0);
    });

    test('waking up inside a fence you never left is not a shift', async () => {
      // His 08-27 06:50 row: five minutes, nothing arrived into it, nothing
      // left from it for another 55 minutes.
      const stir = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sC', '2026-08-27T11:50:11.000Z', '2026-08-27T11:55:09.000Z', 5)] },
              job_time_entries: { data: [drive('2026-08-27T12:56:28.000Z')] } },
        tape: [],
      });
      expect(stir.deleted, 'no arrival, no departure, five minutes').toEqual(['sC']);

      // A morning of paperwork at the home office looks identical apart from
      // its length, and must survive. This is the row the dry run caught.
      const paperwork = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sD', '2026-08-23T14:55:00.000Z', '2026-08-23T19:04:00.000Z', 250)] },
              job_time_entries: { data: [drive('2026-08-27T12:56:28.000Z')] } },
        tape: [],
      });
      expect(paperwork.deleted, 'a 250-minute session is not a stir').toEqual([]);

      // Short, but a drive landed into it: that was a real arrival.
      const arrived = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sE', '2026-08-27T17:11:06.000Z', '2026-08-27T17:16:00.000Z', 5)] },
              job_time_entries: { data: [{ arrived_at: '2026-08-27T17:04:33.000Z',
                                           departed_at: '2026-08-27T17:11:23.000Z', source: 'drive' }] } },
        tape: [],
      });
      expect(arrived.deleted, 'a drive ended here, so somebody arrived').toEqual([]);

      // Short, nothing arrived, but they drove off soon after: that is loading.
      const loading = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sF', '2026-08-27T12:43:00.000Z', '2026-08-27T12:49:00.000Z', 6)] },
              job_time_entries: { data: [drive('2026-08-27T12:56:28.000Z')] } },
        tape: [],
      });
      expect(loading.deleted, 'a departure within the half hour makes it a load-out').toEqual([]);
    });

    test('the threshold does not spare a genuinely wrong close', async () => {
      // 08-27 evening: 147 minutes of error, still deleted.
      const r = await run(page, {
        db: { shop_time_entries: { data: [shopRow('sB', ARR_PM, DEP_PM, 161)] },
              job_time_entries: { data: [drive(DRIVE_NOON)] } },
        tape: [{ ts: Date.parse('2026-08-27T22:48:59.000Z'), kind: 'driving' }],
      });
      expect(r.deleted).toEqual(['sB']);
    });

    test('it runs once per session', async () => {
      const world = { db: { shop_time_entries: { data: [shopRow('s8', ARR_NOON, DEP_NOON, 45)] },
                            job_time_entries: { data: [drive(DRIVE_NOON)] } },
                      tape: [{ ts: D('17:48:05'), kind: 'driving' }] };
      const first = await run(page, world);
      expect(first.wrote.length).toBe(1);
      const again = await page.evaluate(async () => {
        const saved = window._geoDwellRetroRan;
        try { window._geoDwellRetroRan = true; return await _geoDwellRetroSweep(); }
        finally { window._geoDwellRetroRan = saved; }
      });
      expect(again).toBe(0);
    });
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

    test('an unconfirmed departure takes the rest of that Central day with it', async () => {
      const r = await page.evaluate(async () => {
        const saved = { supa: window._supa, user: window._supaUser, del: window._tdSoftDelete };
        const deleted = [];
        try {
          window._supaUser = { id: '30a2b589-e081-4351-9f18-b1efba238c2d' };
          window._tdSoftDelete = async (tbl, ids) => {
            (Array.isArray(ids) ? ids : [ids]).forEach(i => deleted.push(tbl + ':' + i)); return 1;
          };
          // His real evening, CT: the break is 17:48:59.
          const rows = {
            job_time_entries: [
              { id: 'stop1', arrived_at: '2026-08-27T22:59:10.000Z' },   // 17:59
              { id: 'stop2', arrived_at: '2026-08-27T23:25:39.000Z' },   // 18:25
              { id: 'land',  arrived_at: '2026-08-28T01:16:02.000Z' },   // 20:16, still 08-27 CT
              { id: 'morning', arrived_at: '2026-08-27T12:56:28.000Z' }, // 07:56, BEFORE the break
              { id: 'tomorrow', arrived_at: '2026-08-28T14:00:00.000Z' },// 09:00 next day
            ],
            shop_time_entries: [{ id: 'shopPM', arrived_at: '2026-08-28T01:18:13.000Z' }],
            td_mileage: [
              { id: 'mLand', data: { date: '2026-08-27', legKey: '30a2b589-leg-x', startedIso: '2026-08-28T00:54:31.000Z' } },
              { id: 'mMorn', data: { date: '2026-08-27', legKey: '30a2b589-leg-y', startedIso: '2026-08-27T12:51:25.000Z' } },
              { id: 'mOther', data: { date: '2026-08-27', legKey: '987ebc83-leg-z', startedIso: '2026-08-28T00:54:31.000Z' } },
            ],
          };
          const chain = (name) => {
            const c = { select: () => c, is: () => c, eq: () => c, gte: () => c,
                        lte: () => Promise.resolve({ data: rows[name], error: null }) };
            c.then = (res, rej) => Promise.resolve({ data: rows[name], error: null }).then(res, rej);
            return c;
          };
          window._supa = { from: chain };
          const n = await _geoTruncateDayAfter(Date.parse('2026-08-27T22:48:59.000Z'));
          return { n, deleted };
        } finally {
          window._supa = saved.supa; window._supaUser = saved.user; window._tdSoftDelete = saved.del;
        }
      });
      // Everything after the break on 08-27 CT, time and money alike.
      expect(r.deleted).toContain('job_time_entries:stop1');
      expect(r.deleted).toContain('job_time_entries:stop2');
      expect(r.deleted, 'a fence of its own does not rescue it').toContain('job_time_entries:land');
      expect(r.deleted).toContain('shop_time_entries:shopPM');
      expect(r.deleted, 'the miles cannot survive a trip the time log disowned').toContain('td_mileage:mLand');
      // The morning is still evidence, and tomorrow is not this day's problem.
      expect(r.deleted).not.toContain('job_time_entries:morning');
      expect(r.deleted).not.toContain('job_time_entries:tomorrow');
      expect(r.deleted).not.toContain('td_mileage:mMorn');
      // Somebody else's leg is never this user's to remove.
      expect(r.deleted).not.toContain('td_mileage:mOther');
    });

    test('truncation is inert without a signed-in user or a real cut', async () => {
      const r = await page.evaluate(async () => {
        const saved = { user: window._supaUser };
        try {
          window._supaUser = null;
          const a = await _geoTruncateDayAfter(Date.now());
          window._supaUser = { id: 'u' };
          const b = await _geoTruncateDayAfter(0);
          return { a, b };
        } finally { window._supaUser = saved.user; }
      });
      expect(r.a).toBe(0);
      expect(r.b).toBe(0);
    });
  });

  // ── The clock is the tape, the fence is the place ─────────────────────────
  test.describe('_geoRetimeToTapeSweep snaps rows to the motion boundaries', () => {
    const run = async (page, world) => page.evaluate(async (w) => {
      const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                      enq: window._geoEnqueue, ran: window._geoRetimeRan };
      const wrote = [];
      try {
        window._geoRetimeRan = false;
        window._supaUser = { id: 'u1' };
        window._geoEnqueue = (tbl, row) => wrote.push({ tbl, ...row });
        // Sliced to the window it was asked for, the way the real motionSince
        // behaves. The mock used to hand back the whole fixture regardless of
        // the arguments, which is exactly how the hour-keyed-cache bug stayed
        // invisible in here while live data was skipping rows.
        window._geoMotionTape = async (a, b) => Array.isArray(w.tape)
          ? w.tape.filter(x => x && x.ts >= a && x.ts <= b) : w.tape;
        window._supa = { from: (tbl) => {
          const rows = tbl === 'shop_time_entries' ? (w.shopRows || null) : w.rows;
          const chain = { select: () => chain, is: () => chain, eq: () => chain,
                          gte: () => Promise.resolve({ data: rows, error: null }) };
          return chain;
        } };
        const n = await _geoRetimeToTapeSweep();
        return { n, wrote };
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user;
        window._geoMotionTape = saved.tape; window._geoEnqueue = saved.enq;
        window._geoRetimeRan = saved.ran;
      }
    }, world);

    // His real 08-27, to the second, CT via UTC+5.
    const T = (h, m, s2) => Date.UTC(2026, 7, 27, h + 5, m, s2 || 0);
    const iso = (h, m, s2) => new Date(T(h, m, s2)).toISOString();
    const row = (id, src, a, b) => ({ id, source: src, dest_place: null, job_id: null,
      client_key: 'k' + id, arrived_at: a, departed_at: b,
      minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000) });

    // 07:43:54 cycling, 07:44:23 still, 07:49:43 driving, 07:59:06 onFoot.
    const MORNING = [
      { ts: T(7, 43, 54), kind: 'cycling' }, { ts: T(7, 44, 23), kind: 'still' },
      { ts: T(7, 49, 43), kind: 'driving' }, { ts: T(7, 59, 6), kind: 'onFoot' },
    ];

    // His real midday tape, to the second. Two drives in the same clock hour,
    // which is the shape that exposed the cache bug.
    const MIDDAY = [
      { ts: T(11, 59, 58), kind: 'onFoot' },
      { ts: T(12, 1, 35), kind: 'driving' }, { ts: T(12, 13, 3), kind: 'onFoot' },
      { ts: T(12, 13, 54), kind: 'still' },
      { ts: T(12, 48, 5), kind: 'driving' }, { ts: T(12, 57, 43), kind: 'onFoot' },
      { ts: T(12, 59, 22), kind: 'still' },
    ];

    // Owner 2026-08-30: "look at the times, still not all the way there." The
    // 12:04 drive had not moved to the tape's 12:01:35, and the reason was the
    // tape cache being keyed by the row's start HOUR: the 12:48 drive shares
    // that hour, is processed first (newest-first), and the tape fetched for
    // ITS window does not reach 12:01:35, so the 12:04 row saw no drive
    // segment at all and was skipped without a trace.
    test('two rows in the same hour never share a mis-sized tape', async () => {
      const r = await run(page, {
        tape: MIDDAY,
        rows: [
          row('D2', 'drive-unassigned', iso(12, 48, 5), iso(12, 57, 43)),   // newest first
          row('D1', 'drive-unassigned', iso(12, 4, 33), iso(12, 11, 23)),
        ],
      });
      // D2 already sits on its transitions and stays put; D1 must move.
      expect(r.n).toBe(1);
      expect(r.wrote[0].arrived_at, 'the wheels turned at 12:01:35').toBe(iso(12, 1, 35));
      expect(r.wrote[0].departed_at, 'and stopped at 12:13:03').toBe(iso(12, 13, 3));
      expect(r.wrote[0].minutes).toBe(11);
    });

    // The other half of the same owner report: the shop dwell started at
    // 12:11:06 while the tape's drive ran to 12:13:03, two minutes paid in
    // two places at once, because shop_time_entries was never in the sweep's
    // scope at all.
    test('a shop dwell is re-timed too: it starts where the wheels stopped', async () => {
      const r = await run(page, {
        tape: MIDDAY,
        rows: [],
        shopRows: [{ id: 'S1', client_key: 'ck1',
          arrived_at: iso(12, 11, 6), departed_at: iso(12, 48, 5),
          minutes: 37 }],
      });
      expect(r.n).toBe(1);
      expect(r.wrote[0].tbl).toBe('shop_time_entries');
      expect(r.wrote[0].arrived_at).toBe(iso(12, 13, 3));
      expect(r.wrote[0].departed_at, 'the end was already the next drive').toBe(iso(12, 48, 5));
      expect(r.wrote[0].minutes).toBe(35);
      expect(r.wrote[0].client_key, 'the visit key rides along, same as the dwell sweep').toBe('ck1');
    });

    test('a shop dwell already on its transitions is left alone', async () => {
      const r = await run(page, {
        tape: MIDDAY,
        rows: [],
        shopRows: [{ id: 'S2', client_key: 'ck2',
          arrived_at: iso(12, 13, 3), departed_at: iso(12, 48, 5), minutes: 35 }],
      });
      expect(r.n).toBe(0);
      expect(r.wrote).toEqual([]);
    });

    // THE RUNAWAY, found in production 2026-08-30: 6 minutes became 36, then
    // 66, thirty per boot. _geoTapeSegments tiles the window it is handed, so
    // its first onsite span began at the window's own left edge, which is the
    // row's start minus the 30-minute ceiling. The sweep's output was its own
    // next input.
    test('a row is never dragged by the window edge, however many times it runs', async () => {
      // A tape whose standing-still state began long BEFORE the window: the
      // exact shape that produced the runaway.
      const tape = [
        { ts: T(4, 0, 0), kind: 'still' },
        { ts: T(7, 49, 43), kind: 'driving' },
        { ts: T(7, 59, 6), kind: 'onFoot' },
      ];
      let rows = [row('C1', 'client', iso(7, 59, 6), iso(12, 1, 35))];
      const seen = [];
      for (let i = 0; i < 3; i++) {
        const r = await run(page, { tape, rows });
        seen.push(r.n);
        if (r.wrote.length) {
          rows = [row('C1', 'client', r.wrote[0].arrived_at, r.wrote[0].departed_at)];
        }
      }
      expect(seen, 'stable on the first pass and every pass after').toEqual([0, 0, 0]);
      // And the row is exactly where it started, not thirty minutes per run earlier.
      expect(rows[0].arrived_at).toBe(iso(7, 59, 6));
    });

    test('a real transition inside the window still moves the row', async () => {
      // An onsite span is the space BETWEEN drives, so the only thing that can
      // legitimately start one is a drive ending. (My first version of this
      // test used a bare 'still' transition and expected it to be the
      // boundary; it never is, which the failure said plainly.)
      const r = await run(page, {
        // onFoot then still: without the 'still' the walking would run all the
        // way into the next drive and _geoTapeSegments would read the whole
        // day as one load-out, leaving no onsite span at all. That is correct
        // behaviour and a badly built fixture, which is what the second
        // failure here was telling me.
        tape: [
          { ts: T(7, 40, 0), kind: 'driving' },
          { ts: T(7, 55, 0), kind: 'onFoot' },
          { ts: T(8, 10, 0), kind: 'still' },
          { ts: T(12, 5, 0), kind: 'driving' },
        ],
        rows: [row('C2', 'client', iso(7, 59, 6), iso(12, 1, 35))],
      });
      expect(r.n, 'a genuine edge is still allowed to correct the row').toBe(1);
      expect(r.wrote[0].arrived_at, 'the arrival is where the wheels stopped').toBe(iso(7, 55, 0));
    });

    // Owner 2026-08-30, on his live 08/27 after the first roll: a 6-minute
    // load-out had become 36. The whole morning at the shop was one
    // standing-still segment and the sweep snapped the row to all of it, by
    // exactly the 30-minute ceiling.
    test('THE LOAD-OUT: the whole morning at the shop is not loading time', async ({}, ti) => {
      const r = await run(page, {
        tape: MORNING,
        // The row as the first roll left it: stretched back to 07:13:54.
        rows: [row('L1', 'place-load', iso(7, 13, 54), iso(7, 49, 43))],
      });
      expect(r.n, 'the stretched row is corrected, not left as it is').toBe(1);
      // Back to the last stretch of moving about before the wheels turn,
      // which is the cycling edge at 07:43:54, not the still segment's start.
      expect(r.wrote[0].arrived_at).toBe(iso(7, 43, 54));
      expect(r.wrote[0].departed_at, 'the end was already the driving edge').toBe(iso(7, 49, 43));
      expect(r.wrote[0].minutes).toBe(6);
    });

    // The runaway's leftovers: it had pushed this row's start 60 minutes from
    // truth, and the same-event cap then refused the correction as "not the
    // same event". Old damage must never outrank the tape.
    test('a load row damaged beyond the cap still heals: the derivation is not capped', async () => {
      const tape = [
        { ts: T(6, 56, 7), kind: 'onFoot' }, { ts: T(6, 56, 35), kind: 'still' },
      ].concat(MORNING);
      const r = await run(page, {
        tape,
        rows: [row('L60', 'place-load', iso(6, 43, 54), iso(7, 49, 43))],   // his live 66m row
      });
      expect(r.n).toBe(1);
      expect(r.wrote[0].arrived_at, 'back to the cycling edge, however far it drifted').toBe(iso(7, 43, 54));
      expect(r.wrote[0].minutes).toBe(6);
    });

    test('a load row already right is left alone', async () => {
      const r = await run(page, {
        tape: MORNING,
        rows: [row('L2', 'place-load', iso(7, 43, 54), iso(7, 49, 43))],
      });
      expect(r.n).toBe(0);
      expect(r.wrote).toEqual([]);
    });

    test('a load row with no load-out shape in the tape is left alone, never guessed at', async () => {
      const r = await run(page, {
        tape: [{ ts: T(7, 10, 0), kind: 'still' }, { ts: T(7, 49, 43), kind: 'driving' }],
        rows: [row('L3', 'place-load', iso(7, 13, 54), iso(7, 49, 43))],
      });
      expect(r.n, 'no moving-about before the wheels means no opinion').toBe(0);
    });

    test('an office row is never re-timed: no tape shape says "began desk work"', async () => {
      const r = await run(page, {
        tape: MORNING,
        rows: [row('O1', 'place-office', iso(7, 13, 54), iso(7, 49, 43))],
      });
      expect(r.n).toBe(0);
      expect(r.wrote).toEqual([]);
    });

    test('THE MORNING DRIVE: 3 minutes becomes the 9 it actually was', async () => {
      const r = await run(page, {
        // What the fence recorded: 07:56:28 to 07:59:25.
        rows: [row('d1', 'drive-unassigned', iso(7, 56, 28), iso(7, 59, 25))],
        tape: MORNING,
      });
      expect(r.wrote.length).toBe(1);
      expect(r.wrote[0].arrived_at, 'starts where CoreMotion said driving').toBe(iso(7, 49, 43));
      expect(r.wrote[0].departed_at, 'ends where he got out, not where the fence tripped').toBe(iso(7, 59, 6));
      expect(r.wrote[0].minutes).toBe(9);
    });

    test('the drive keeps its place and its job: only the clock moves', async () => {
      const r = await page.evaluate(async (w) => {
        const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                        enq: window._geoEnqueue, ran: window._geoRetimeRan };
        const wrote = [];
        try {
          window._geoRetimeRan = false; window._supaUser = { id: 'u1' };
          window._geoEnqueue = (t, r2) => wrote.push(r2);
          window._geoMotionTape = async () => w.tape;
          const c = { select: () => c, is: () => c, eq: () => c, gte: () => Promise.resolve({ data: w.rows, error: null }) };
          window._supa = { from: () => c };
          await _geoRetimeToTapeSweep();
          return wrote[0];
        } finally {
          window._supa = saved.supa; window._supaUser = saved.user; window._geoMotionTape = saved.tape;
          window._geoEnqueue = saved.enq; window._geoRetimeRan = saved.ran;
        }
      }, { rows: [{ id: 'd2', source: 'drive', dest_place: 'John Doe', job_id: 77, client_key: 'kd2',
                    arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }], tape: MORNING });
      expect(r.dest_place, 'the fence was right about where').toBe('John Doe');
      expect(r.job_id).toBe(77);
      expect(r.source).toBe('drive');
      expect(r.client_key, 'same row, not a new one').toBe('kd2');
    });

    test('an on-site row snaps to the standing-still segment, not the drive', async () => {
      const r = await run(page, {
        // On site recorded as starting 07:59:06; the tape agrees, so nothing moves.
        rows: [row('v1', 'client', iso(7, 59, 6), iso(11, 30, 0))],
        tape: MORNING.concat([{ ts: T(11, 30, 0), kind: 'driving' }]),
      });
      expect(r.wrote.length, 'the tape and the fence already agree here').toBe(0);
    });

    test('a boundary further off than half an hour is a different event, left alone', async () => {
      const r = await run(page, {
        rows: [row('d3', 'drive', iso(6, 30, 0), iso(6, 40, 0))],
        tape: MORNING,
      });
      expect(r.wrote.length).toBe(0);
    });

    test('no tape means no opinion', async () => {
      const r = await run(page, { rows: [row('d4', 'drive', iso(7, 56, 28), iso(7, 59, 25))], tape: [] });
      expect(r.wrote.length).toBe(0);
    });

    test('manual rows are never re-timed: a person typed those', async () => {
      const r = await run(page, {
        rows: [{ id: 'm1', source: 'manual', dest_place: null, job_id: null, client_key: 'km1',
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        tape: MORNING,
      });
      expect(r.wrote.length).toBe(0);
    });

    // ── ONE LEG, ONE CLOCK ────────────────────────────────────────────────
    // Owner, 2026-08-31, looking at his own morning: "one mileage row but with
    // incorrect times." A drive is written to TWO tables from one derivation,
    // the time entry and the mileage row that shares its legKey, and this
    // sweep corrected only the time entry. Measured on his account that day:
    // 8 of his last 10 drives had a time entry disagreeing with its own
    // mileage row, by 82 seconds to 6.75 minutes, always the same direction.
    // He confirmed the tape was right and the mileage row was the wrong one.
    const withMileage = (page, world) => page.evaluate(async (w) => {
      const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                      enq: window._geoEnqueue, ran: window._geoRetimeRan, save: window.saveAll };
      const before = (typeof mileage !== 'undefined' && Array.isArray(mileage)) ? mileage.slice() : null;
      let saves = 0;
      try {
        window._geoRetimeRan = false; window._supaUser = { id: 'u1' };
        window._geoEnqueue = () => {};
        window.saveAll = () => { saves++; };
        window._geoMotionTape = async (a, b) => Array.isArray(w.tape)
          ? w.tape.filter(x => x && x.ts >= a && x.ts <= b) : w.tape;
        const c = { select: () => c, is: () => c, eq: () => c,
                    gte: () => Promise.resolve({ data: w.rows, error: null }) };
        window._supa = { from: () => c };
        if (Array.isArray(w.mileage)) { mileage.length = 0; w.mileage.forEach(m => mileage.push(m)); }
        await _geoRetimeToTapeSweep();
        return { saves, rows: mileage.map(m => ({ legKey: m.legKey, gps: m.gps, miles: m.miles,
                 startedIso: m.startedIso, endedIso: m.endedIso, mins: m.mins, date: m.date })) };
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user; window._geoMotionTape = saved.tape;
        window._geoEnqueue = saved.enq; window._geoRetimeRan = saved.ran; window.saveAll = saved.save;
        if (before) { mileage.length = 0; before.forEach(m => mileage.push(m)); }
      }
    }, world);

    // The legKey a real drive would carry: base36 of its start, exactly as
    // _geoLegKey mints it. Written out so the tests read like the data does.
    const legKeyAt = (ms) => 'u1-leg-' + ms.toString(36);

    const MILE = (startMs, endMs, extra) => Object.assign({
      id: 'm1', gps: true, legKey: legKeyAt(startMs), miles: 3.2, gpsMiles: 3.1,
      startedIso: new Date(startMs).toISOString(), endedIso: new Date(endMs).toISOString(),
      mins: Math.round((endMs - startMs) / 60000), date: '2026-08-27',
      from_name: 'Shop', to_name: 'John Doe',
    }, extra || {});

    test('re-timing a drive moves its mileage row to the same clock', async () => {
      // His 08-27 morning: the fence stamped 07:56:28, the wheels turned at
      // 07:49:43. The time entry moves, and now so does the leg.
      const key = legKeyAt(T(7, 56, 28));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd9', source: 'drive', dest_place: 'John Doe', job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [MILE(T(7, 56, 28), T(7, 59, 25))],
      });
      const m = r.rows.find(x => x.legKey === key);
      expect(m.startedIso, 'the wheels turned at 07:49:43').toBe(iso(7, 49, 43));
      expect(m.endedIso, 'and stopped at 07:59:06').toBe(iso(7, 59, 6));
      expect(m.mins).toBe(9);
      expect(r.saves, 'the corrected leg has to reach the cloud').toBeGreaterThan(0);
    });

    test('the distance is never restated: only the clock moves', async () => {
      // Miles are measured geocode to geocode by the router and do not depend
      // on what the clock says. Moving an edge by ninety seconds must never
      // quietly change the deduction.
      const key = legKeyAt(T(7, 56, 28));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd10', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [MILE(T(7, 56, 28), T(7, 59, 25))],
      });
      expect(r.rows.find(x => x.legKey === key).miles).toBe(3.2);
    });

    test('the legKey is identity and never re-minted from the new start', async () => {
      // Re-deriving it would mint a SECOND key for one drive and duplicate the
      // leg, which is the exact bug the deterministic key exists to prevent.
      const key = legKeyAt(T(7, 56, 28));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd11', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [MILE(T(7, 56, 28), T(7, 59, 25))],
      });
      expect(r.rows.length, 'one drive, one row, still').toBe(1);
      expect(r.rows[0].legKey).toBe(key);
    });

    test('a hand-typed trip has no legKey and is out of reach', async () => {
      const key = legKeyAt(T(7, 56, 28));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd12', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [{ id: 'hand', gps: false, miles: 12, startedIso: iso(7, 56, 28),
                    endedIso: iso(7, 59, 25), mins: 3, date: '2026-08-27' }],
      });
      const m = r.rows[0];
      expect(m.startedIso, 'a trip somebody typed is theirs, not the tape\'s').toBe(iso(7, 56, 28));
      expect(m.miles).toBe(12);
    });

    test('a different leg is not dragged along', async () => {
      const key = legKeyAt(T(7, 56, 28));
      const other = legKeyAt(T(12, 48, 5));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd13', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [MILE(T(7, 56, 28), T(7, 59, 25)),
                  Object.assign(MILE(T(12, 48, 5), T(12, 57, 43)), { id: 'm2', legKey: other })],
      });
      expect(r.rows.find(x => x.legKey === other).startedIso).toBe(iso(12, 48, 5));
    });

    test('no matching leg, no crash and no write', async () => {
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd14', source: 'drive', dest_place: null, job_id: null, client_key: 'u1-leg-nope',
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [],
      });
      expect(r.rows.length).toBe(0);
      expect(r.saves, 'nothing changed, nothing saved').toBe(0);
    });

    test('a leg already on the tape\'s clock is left completely alone', async () => {
      // Idempotence. The sweep is one-shot per session but the row it wrote
      // is read again on the next boot, and re-saving an unchanged row churns
      // the sync queue for nothing.
      const key = legKeyAt(T(7, 56, 28));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd15', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 56, 28), departed_at: iso(7, 59, 25), minutes: 3 }],
        mileage: [Object.assign(MILE(T(7, 56, 28), T(7, 59, 25)),
                   { startedIso: iso(7, 49, 43), endedIso: iso(7, 59, 6), mins: 9 })],
      });
      expect(r.saves).toBe(0);
    });

    // ── THE WALK TO THE TRUCK IS NOT A HOLE IN THE DAY ────────────────────
    // Owner, 2026-08-31, reading his own timeline: "job site says 12:22, then
    // drive says 12:26? Drive should say 12:22." He left John Doe's on the
    // walking edge and the next thing on record was the drive, with the walk
    // to the truck belonging to neither. _geoTapeSegments carves that load-out
    // off the tail of the on-site span and _geoFoldLoadIntoOnsite puts it back
    // at a customer's; this sweep was not folding, so it trimmed the visit to
    // where the load began and left the gap.
    const withPlaces = (page, world) => page.evaluate(async (w) => {
      const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                      enq: window._geoEnqueue, ran: window._geoRetimeRan, gp: window.getPlaces };
      const wrote = [];
      try {
        window._geoRetimeRan = false; window._supaUser = { id: 'u1' };
        window._geoEnqueue = (tbl, row) => wrote.push({ tbl, ...row });
        window.getPlaces = () => (w.places || []);
        window._geoMotionTape = async (a, b) => Array.isArray(w.tape)
          ? w.tape.filter(x => x && x.ts >= a && x.ts <= b) : w.tape;
        const c = { select: () => c, is: () => c, eq: () => c,
                    gte: () => Promise.resolve({ data: w.rows, error: null }) };
        window._supa = { from: () => c };
        await _geoRetimeToTapeSweep();
        return { wrote };
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user; window._geoMotionTape = saved.tape;
        window._geoEnqueue = saved.enq; window._geoRetimeRan = saved.ran; window.getPlaces = saved.gp;
      }
    }, world);

    // MORNING's walk is recorded as 'cycling', which the load finder does not
    // count (only onFoot/walking/running), so it produces no load span at all.
    // This tape is his 08-31 shape: get up and walk out, sit in the cab, pull
    // away. The gap between the walk ending and the wheels turning is the
    // stretch that used to belong to nothing.
    const WALKOUT = [
      { ts: T(6, 0, 0), kind: 'still' },
      { ts: T(7, 43, 54), kind: 'walking' },
      // 2m43s in the cab, inside _GEO_LOAD_STILL_MS. The first draft of this
      // fixture sat 5m20s and produced no load segment at all, because that
      // slack is the ceiling on how long a still stretch may sit between the
      // last trip to the truck and pulling out before it stops being a
      // load-out. Worth knowing the boundary is real and tested elsewhere.
      { ts: T(7, 47, 0), kind: 'still' },
      { ts: T(7, 49, 43), kind: 'driving' },
      { ts: T(7, 59, 6), kind: 'onFoot' },
    ];

    test('a client visit runs through the walk to the truck, not up to it', async () => {
      const r = await withPlaces(page, {
        tape: WALKOUT,
        places: [{ name: 'TradeDesk shop' }],
        rows: [{ id: 'v1', source: 'client', dest_place: 'John Doe', job_id: null,
                 client_key: 'kv1', arrived_at: iso(6, 30, 0), departed_at: iso(7, 40, 0),
                 minutes: 70 }],
      });
      const w = r.wrote.find(x => x.id === 'v1');
      expect(w, 'the visit is re-timed').toBeTruthy();
      expect(w.departed_at, 'on site runs straight through to "this guy is now driving"')
        .toBe(iso(7, 49, 43));
    });

    test('at a place the contractor OWNS the load stays its own line item', async () => {
      // The other half of the same rule, and it must not move: loading the
      // truck at your own yard is billable work in its own right, so the
      // on-site span still ends where the load begins.
      const r = await withPlaces(page, {
        tape: WALKOUT,
        places: [{ name: 'TradeDesk shop' }],
        rows: [{ id: 'v2', source: 'place', dest_place: 'TradeDesk shop', job_id: null,
                 client_key: 'kv2', arrived_at: iso(6, 30, 0), departed_at: iso(7, 40, 0),
                 minutes: 70 }],
      });
      const w = r.wrote.find(x => x.id === 'v2');
      expect(w, 'it still re-times').toBeTruthy();
      expect(w.departed_at, 'the load-out is carved off, not folded in')
        .toBe(iso(7, 43, 54));
    });

    test('the load segment itself now reaches the wheels turning', async () => {
      // The hole, asserted directly on the segments rather than through a
      // sweep. Sitting in the cab between the last trip to the truck and
      // pulling out belonged to no segment at all.
      const segs = await page.evaluate((t) => _geoTapeSegments(t, t[0].ts, t[t.length - 1].ts + 60000),
        WALKOUT.map(x => ({ ts: x.ts, kind: x.kind })));
      const load = segs.find(x => x.kind === 'load');
      const drive = segs.find(x => x.kind === 'drive');
      expect(load, 'a walk straight into a departure is a load-out').toBeTruthy();
      expect(load.b, 'and it runs to the moment the wheels turn').toBe(drive.a);
    });

    test('the day tiles: no minute between the visit and the drive is unowned', async () => {
      // The property the owner is actually asking for, asserted as a property
      // rather than as two numbers.
      const segs = await page.evaluate((t) => {
        const raw = _geoTapeSegments(t, t[0].ts, t[t.length - 1].ts + 60000);
        return _geoFoldLoadIntoOnsite(raw, false).sort((a, b) => a.a - b.a);
      }, WALKOUT.map(x => ({ ts: x.ts, kind: x.kind })));
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i].a, 'segment ' + i + ' must start where ' + (i - 1) + ' ended')
          .toBe(segs[i - 1].b);
      }
    });

    test('no places on file: a customer visit still folds', async () => {
      // getPlaces returning empty must read as "owns nothing", never as a
      // reason to skip the fold.
      const r = await withPlaces(page, {
        tape: WALKOUT,
        places: [],
        rows: [{ id: 'v4', source: 'client', dest_place: 'John Doe', job_id: null,
                 client_key: 'kv4', arrived_at: iso(6, 30, 0), departed_at: iso(7, 40, 0),
                 minutes: 70 }],
      });
      expect(r.wrote.find(x => x.id === 'v4').departed_at).toBe(iso(7, 49, 43));
    });

    test('a leg is realigned even when the time row already matches the tape', async () => {
      // The backlog case, and the one the owner hit on a build that already
      // carried the pairing: "mileage start time still says 7:52 am rather
      // than 7:50." Every drive corrected before the pairing existed left its
      // leg behind on the old clock, and those legs are unreachable by the
      // forward fix, because the time entry now agrees with the tape and the
      // sweep returns before it ever looks at the mileage row.
      const key = legKeyAt(T(7, 49, 43));
      const r = await withMileage(page, {
        tape: MORNING,
        // Already on the tape's boundaries: nothing here needs re-timing.
        rows: [{ id: 'd16', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 49, 43), departed_at: iso(7, 59, 6), minutes: 9 }],
        // The leg it left behind, still on the fence's late clock.
        mileage: [Object.assign(MILE(T(7, 49, 43), T(7, 59, 6)),
                   { startedIso: iso(7, 56, 28), endedIso: iso(7, 59, 25), mins: 3 })],
      });
      const m = r.rows.find(x => x.legKey === key);
      expect(m.startedIso, 'the leg is brought onto the row it belongs to').toBe(iso(7, 49, 43));
      expect(m.endedIso).toBe(iso(7, 59, 6));
      expect(m.mins).toBe(9);
      expect(m.miles, 'and the deduction is still not restated').toBe(3.2);
    });

    test('an aligned pair on an already-correct row writes nothing at all', async () => {
      // Idempotence on the heal path. This runs on every pass now, including
      // every pass where nothing is wrong, so it must not churn the sync queue.
      const key = legKeyAt(T(7, 49, 43));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'd17', source: 'drive', dest_place: null, job_id: null, client_key: key,
                 arrived_at: iso(7, 49, 43), departed_at: iso(7, 59, 6), minutes: 9 }],
        mileage: [MILE(T(7, 49, 43), T(7, 59, 6))],
      });
      expect(r.saves).toBe(0);
    });

    test('the heal is drives only: a matching visit row never reaches a leg', async () => {
      // client_key on a visit is a visit key, not a legKey, so nothing could
      // match anyway. Asserted so a future change to either key shape cannot
      // quietly let a visit start rewriting mileage.
      const key = legKeyAt(T(7, 49, 43));
      const r = await withMileage(page, {
        tape: MORNING,
        rows: [{ id: 'v9', source: 'client', dest_place: 'John Doe', job_id: null, client_key: key,
                 arrived_at: iso(7, 59, 6), departed_at: iso(11, 30, 0), minutes: 211 }],
        mileage: [MILE(T(7, 49, 43), T(7, 59, 6))],
      });
      expect(r.rows[0].startedIso, 'the leg is untouched by a visit row').toBe(iso(7, 49, 43));
      expect(r.saves).toBe(0);
    });

    test('the helper refuses junk directly: no key, no order, no array', async () => {
      const r = await page.evaluate(() => {
        const before = mileage.slice();
        try {
          const out = {
            noKey: _geoRetimeMileageLeg(null, 1000, 2000, 1),
            empty: _geoRetimeMileageLeg('', 1000, 2000, 1),
            backwards: _geoRetimeMileageLeg('k', 2000, 1000, 1),
            zero: _geoRetimeMileageLeg('k', 0, 2000, 1),
            equal: _geoRetimeMileageLeg('k', 2000, 2000, 0),
          };
          return out;
        } finally { mileage.length = 0; before.forEach(m => mileage.push(m)); }
      });
      Object.entries(r).forEach(([k, v]) => expect(v, k + ' must be refused').toBe(0));
    });

    test('it runs once per session', async () => {
      const first = await run(page, {
        rows: [row('d5', 'drive', iso(7, 56, 28), iso(7, 59, 25))], tape: MORNING });
      expect(first.wrote.length).toBe(1);
      const again = await page.evaluate(async () => {
        const s = window._geoRetimeRan;
        try { window._geoRetimeRan = true; return await _geoRetimeToTapeSweep(); }
        finally { window._geoRetimeRan = s; }
      });
      expect(again).toBe(0);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });

  // The reconciler (owner 2026-08-30: "build the reconciler that just runs
  // the live code"): a drive the tape swears happened and no row carries.
  test.describe('_geoTapeFillSweep: the drive the tape has and the tables lack', () => {
    const T = (h, m, s2) => Date.UTC(2026, 7, 27, h + 5, m, s2 || 0);
    const iso = (h, m, s2) => new Date(T(h, m, s2)).toISOString();
    const MIDDAY = [
      { ts: T(11, 59, 58), kind: 'onFoot' },
      { ts: T(12, 1, 35), kind: 'driving' }, { ts: T(12, 13, 3), kind: 'onFoot' },
      { ts: T(12, 13, 54), kind: 'still' },
      { ts: T(12, 48, 5), kind: 'driving' }, { ts: T(12, 57, 43), kind: 'onFoot' },
    ];
    const fill = async (page, world) => page.evaluate(async (w) => {
      const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                      enq: window._geoEnqueue, ran: window._geoTapeFillRan, places: window.places };
      const wrote = [];
      try {
        window._geoTapeFillRan = false;
        window._supaUser = { id: 'u1' };
        window._geoEnqueue = (tbl, row) => wrote.push({ tbl, ...row });
        window._geoMotionTape = async (a, b) => Array.isArray(w.tape)
          ? w.tape.filter(x => x && x.ts >= a && x.ts <= b) : w.tape;
        window.places = [{ id: 'shp', kind: 'shop', name: 'TradeDesk shop' }];
        window._supa = { from: (tbl) => {
          const rows = tbl === 'shop_time_entries' ? (w.shopRows || []) : (w.jobRows || []);
          const chain = { select: () => chain, is: () => chain, eq: () => chain,
                          gte: () => Promise.resolve({ data: rows, error: null }) };
          return chain;
        } };
        const n = await _geoTapeFillSweep();
        return { n, wrote };
      } finally {
        window._supa = saved.supa; window._supaUser = saved.user;
        window._geoMotionTape = saved.tape; window._geoEnqueue = saved.enq;
        window._geoTapeFillRan = saved.ran; window.places = saved.places;
      }
    }, world);
    // His real midday, minus the drive row live never wrote.
    const JOB = () => ([
      { id: 'J1', arrived_at: iso(7, 59, 6), departed_at: iso(12, 1, 35),
        source: 'client', dest_place: 'John Doe', job_id: 701, deleted_at: null },
    ]);
    const SHOP = () => ([
      { id: 'S1', arrived_at: iso(12, 13, 3), departed_at: iso(12, 48, 5), deleted_at: null },
    ]);

    test('a tape drive with an arrival row is written, on its transitions', async () => {
      const r = await fill(page, { tape: MIDDAY, jobRows: JOB(), shopRows: SHOP() });
      expect(r.n).toBe(1);
      expect(r.wrote[0].tbl).toBe('job_time_entries');
      expect(r.wrote[0].id, 'a fill is an INSERT, never an update').toBeUndefined();
      expect(r.wrote[0].arrived_at).toBe(iso(12, 1, 35));
      expect(r.wrote[0].departed_at).toBe(iso(12, 13, 3));
      expect(r.wrote[0].minutes).toBe(11);
      expect(r.wrote[0].source).toBe('drive-unassigned');
      // The arrival was the shop dwell, so the fence names the shop.
      expect(r.wrote[0].dest_place).toBe('TradeDesk shop');
      expect(r.wrote[0].job_id).toBe(null);
    });

    test('a soft-deleted row over the segment is a decision, never resurrected', async () => {
      const jobRows = JOB().concat([{ id: 'J2', arrived_at: iso(12, 2, 0), departed_at: iso(12, 12, 0),
        source: 'drive', dest_place: 'John Doe', job_id: null, deleted_at: '2026-08-29T00:00:00Z' }]);
      const r = await fill(page, { tape: MIDDAY, jobRows, shopRows: SHOP() });
      expect(r.n, 'the owner struck that drive; it stays struck').toBe(0);
    });

    test('no arrival row means no fence said yes, so nothing is written', async () => {
      // Same tape, but the shop dwell is gone: the drive lands nowhere known.
      const r = await fill(page, { tape: MIDDAY, jobRows: JOB(), shopRows: [] });
      expect(r.n).toBe(0);
      expect(r.wrote).toEqual([]);
    });

    test('a drive outside the workday span is left to the rail, not written', async () => {
      // Evening driving after the last surviving row of the day.
      const tape = MIDDAY.concat([{ ts: T(19, 54, 0), kind: 'driving' }, { ts: T(19, 56, 35), kind: 'onFoot' }]);
      const r = await fill(page, { tape, jobRows: JOB(), shopRows: SHOP() });
      // Only the midday fill; the 19:54 drive has no surviving rows around it.
      expect(r.n).toBe(1);
      expect(r.wrote[0].arrived_at).toBe(iso(12, 1, 35));
    });

    test('once the row exists a second pass writes nothing: the fill is idempotent', async () => {
      const first = await fill(page, { tape: MIDDAY, jobRows: JOB(), shopRows: SHOP() });
      const jobRows = JOB().concat([{ id: 'F1', arrived_at: first.wrote[0].arrived_at,
        departed_at: first.wrote[0].departed_at, source: 'drive-unassigned',
        dest_place: 'TradeDesk shop', job_id: null, deleted_at: null }]);
      const second = await fill(page, { tape: MIDDAY, jobRows, shopRows: SHOP() });
      expect(second.n).toBe(0);
    });

    test('today is never filled: the live writer owns it', async () => {
      const r = await page.evaluate(async () => {
        const saved = { supa: window._supa, user: window._supaUser, tape: window._geoMotionTape,
                        enq: window._geoEnqueue, ran: window._geoTapeFillRan };
        const wrote = [];
        try {
          window._geoTapeFillRan = false;
          window._supaUser = { id: 'u1' };
          window._geoEnqueue = (tbl, row) => wrote.push(row);
          const now = Date.now();
          const at = (min) => new Date(now - min * 60000).toISOString();
          const ts = (min) => now - min * 60000;
          // A clean fillable shape, but dated TODAY.
          window._geoMotionTape = async (a, b) => [
            { ts: ts(140), kind: 'onFoot' }, { ts: ts(120), kind: 'driving' },
            { ts: ts(110), kind: 'onFoot' },
          ].filter(x => x.ts >= a && x.ts <= b);
          const jobRows = [{ id: 'T1', arrived_at: at(200), departed_at: at(120),
            source: 'client', dest_place: 'X', job_id: null, deleted_at: null },
            { id: 'T2', arrived_at: at(110), departed_at: at(30),
            source: 'client', dest_place: 'Y', job_id: null, deleted_at: null }];
          const chain = { select: () => chain, is: () => chain, eq: () => chain,
                          gte: () => Promise.resolve({ data: jobRows, error: null }) };
          window._supa = { from: (tbl) => tbl === 'shop_time_entries'
            ? { select: () => ({ is: () => ({ eq: () => ({ gte: async () => ({ data: [], error: null }) }) }) }),
                is: () => chain, eq: () => chain, gte: () => Promise.resolve({ data: [], error: null }) }
            : chain };
          // shop chain shape mismatch is fine: fill tolerates error/[] there.
          const n = await _geoTapeFillSweep();
          return { n, wrote: wrote.length };
        } finally {
          window._supa = saved.supa; window._supaUser = saved.user;
          window._geoMotionTape = saved.tape; window._geoEnqueue = saved.enq;
          window._geoTapeFillRan = saved.ran;
        }
      });
      expect(r.n, 'two writers on one stretch of road is the thing this refuses').toBe(0);
      expect(r.wrote).toBe(0);
    });

    test('junk input never throws and never writes', async () => {
      const a = await fill(page, { tape: [], jobRows: JOB(), shopRows: SHOP() });
      const b = await fill(page, { tape: null, jobRows: JOB(), shopRows: SHOP() });
      const c = await fill(page, { tape: MIDDAY, jobRows: [null, { id: 'x' }], shopRows: [undefined] });
      expect(a.n).toBe(0); expect(b.n).toBe(0); expect(c.n).toBe(0);
    });
  });

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
