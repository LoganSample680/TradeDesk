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
        window._geoMotionTape = async () => w.tape;
        const chain = { select: () => chain, is: () => chain, eq: () => chain,
                        gte: () => Promise.resolve({ data: w.rows, error: null }) };
        window._supa = { from: () => chain };
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
