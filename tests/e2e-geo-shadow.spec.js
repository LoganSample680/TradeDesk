// @ts-check
// ── The shadow tracking engine (build #13) ───────────────────────────────────
// Owner call (2026-08-09): run the event-driven engine side by side with the
// live continuous-GPS one and prove which is better before flipping anything.
//
// The rule these tests exist to defend: the shadow engine NEVER writes a real
// record. Payroll and the IRS mileage log stay owned by the live engine for
// the whole evaluation, so a wrong shadow costs nothing.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('shadow tracking engine', () => {
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

  // The TdGeo plugin as build #13 exposes it.
  const withShell = (fn, arg) => page.evaluate(async ([body, a]) => {
    const realCap = window.Capacitor;
    const calls = { startEvents: [], burstFix: [], motionSince: [] };
    window.__tdCalls = calls;
    window.Capacitor = {
      isNativePlatform: () => true,
      registerPlugin: (n) => n === 'TdGeo' ? {
        addListener: () => {},
        drainBuffer: () => Promise.resolve({ fixes: [] }),
        startEvents: (o) => { calls.startEvents.push(o); return Promise.resolve({ armed: (o.regions || []).length, visits: true }); },
        burstFix: (o) => { calls.burstFix.push(o); return Promise.resolve({ seconds: o.seconds }); },
        motionSince: (o) => { calls.motionSince.push(o); return Promise.resolve(window.__motion || { available: false, transitions: [] }); },
        stats: () => Promise.resolve({ gpsOnMs: 12000, wakes: { visit: 2, regionExit: 1 }, batteryLevel: 0.71, charging: false, monitoredRegions: 3, motionAvailable: true }),
        stopAll: () => Promise.resolve(),
      } : null,
    };
    try { return await (new Function('a', 'return (' + body + ')(a)'))(a); }
    finally { window.Capacitor = realCap; delete window.__tdCalls; delete window.__motion; }
  }, [fn.toString(), arg === undefined ? null : arg]);

  test('the engine arms geofences and visit monitoring, and never continuous GPS', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      S.officeLat = 39.0; S.officeLon = -95.7;
      const ok = await startShadowEngine();
      const c = window.__tdCalls;
      return {
        ok, on: shadowEngineOn(),
        armedShop: (c.startEvents[0].regions || []).some(x => x.id === 'shop'),
        // startEvents is the ONLY start path: nothing here asks for a
        // continuous watcher, which is what pins the Dynamic Island.
        startCalls: c.startEvents.length,
      };
    });
    expect(r.ok).toBe(true);
    expect(r.on).toBe(true);
    expect(r.armedShop, 'the shop is fenced').toBe(true);
    expect(r.startCalls).toBe(1);
  });

  test('an iOS visit report becomes an arrival and departure with Apple\'s own timestamps', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      await startShadowEngine();
      const arrive = Date.now() - 90 * 60000, depart = Date.now() - 30 * 60000;
      await shadowIngest({ type: 'visit', ts: Date.now(), lat: 39.0, lng: -95.7,
        arrivalTs: arrive, departureTs: depart });
      const log = JSON.parse(localStorage.getItem('td_geo_shadow') || '[]');
      const v = log.find(e => e.k === 'visit');
      return { found: !!v, mins: v && v.mins, arrived: v && v.arrived, name: v && v.name };
    });
    expect(r.found).toBe(true);
    expect(r.mins, 'the visit length comes straight from iOS').toBe(60);
    expect(r.arrived).toBeTruthy();
  });

  test('a late geofence exit is stamped from the motion coprocessor, not the event', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      await startShadowEngine();
      // Driving actually began 9 minutes before iOS noticed the fence exit.
      const realStart = Date.now() - 9 * 60000;
      window.__motion = { available: true, transitions: [
        { kind: 'still', ts: Date.now() - 60 * 60000 },
        { kind: 'driving', ts: realStart },
      ] };
      await shadowIngest({ type: 'regionExit', ts: Date.now(), lat: 39.0, lng: -95.7, regionId: 'shop' });
      const log = JSON.parse(localStorage.getItem('td_geo_shadow') || '[]');
      const d = log.find(e => e.k === 'depart');
      return { src: d && d.src, at: d && d.at, expect: new Date(realStart).toISOString(),
               burst: window.__tdCalls.burstFix.length };
    });
    expect(r.src, 'the moment comes from motion history').toBe('motion');
    expect(r.at, 'and it is the instant driving began, not when the fence fired').toBe(r.expect);
    expect(r.burst, 'coordinates come from a short burst, not a standing watcher').toBe(1);
  });

  test('exit then enter produces one leg between the two endpoints', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      S.officeLat = 39.0; S.officeLon = -95.7;
      await startShadowEngine();
      window.__motion = { available: false, transitions: [] };
      const t0 = Date.now() - 40 * 60000;
      await shadowIngest({ type: 'regionExit', ts: t0, lat: 39.0, lng: -95.7, regionId: 'shop' });
      await shadowIngest({ type: 'regionEnter', ts: t0 + 22 * 60000, lat: 39.2, lng: -95.4, regionId: 'job:1' });
      const log = JSON.parse(localStorage.getItem('td_geo_shadow') || '[]');
      const leg = log.find(e => e.k === 'leg');
      return { leg: !!leg, from: leg && leg.from, mins: leg && leg.mins };
    });
    expect(r.leg).toBe(true);
    expect(r.from, 'the leg starts where they left').toBe('Shop');
    expect(r.mins).toBe(22);
  });

  test('THE RULE: the shadow engine writes no mileage row and no time entry, ever', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      const mileBefore = mileage.length;
      const enq = [];
      const realEnq = window._geoEnqueue;
      window._geoEnqueue = (tbl, row) => { enq.push({ tbl, row }); };
      try {
        await startShadowEngine();
        const t0 = Date.now() - 60 * 60000;
        await shadowIngest({ type: 'regionExit', ts: t0, lat: 39.0, lng: -95.7, regionId: 'shop' });
        await shadowIngest({ type: 'visit', ts: Date.now(), lat: 39.2, lng: -95.4,
          arrivalTs: t0 + 20 * 60000, departureTs: t0 + 50 * 60000 });
        await shadowIngest({ type: 'regionEnter', ts: Date.now(), lat: 39.2, lng: -95.4, regionId: 'job:1' });
        return { newMileage: mileage.length - mileBefore, enqueued: enq.length,
                 journal: JSON.parse(localStorage.getItem('td_geo_shadow') || '[]').length };
      } finally { window._geoEnqueue = realEnq; }
    });
    expect(r.newMileage, 'not one mileage row').toBe(0);
    expect(r.enqueued, 'not one queued record of any kind').toBe(0);
    expect(r.journal, 'everything it concluded went to its own journal').toBeGreaterThan(2);
  });

  test('the comparison panel shows both engines\' radio time and the battery reading', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      await startShadowEngine();
      _shadowLiveGpsStart();
      await new Promise(r2 => setTimeout(r2, 30));
      _shadowLiveGpsStop();
      await _shadowPanel();
      const ov = document.getElementById('_geo-shadow-ov');
      const txt = ov ? ov.textContent : '';
      const out = {
        opened: !!ov,
        hasBoth: /Current engine/.test(txt) && /New engine/.test(txt),
        hasBattery: /71%/.test(txt),
        hasWakes: /visit 2/.test(txt),
      };
      ov && ov.remove();
      return out;
    });
    expect(r.opened).toBe(true);
    expect(r.hasBoth, 'both engines are shown side by side').toBe(true);
    expect(r.hasBattery).toBe(true);
    expect(r.hasWakes).toBe(true);
  });

  // Owner (2026-08-10): "engine comparison is forcing UTC, I want device
  // local central time." Stored ISO stays UTC; the glass shows local.
  test('panel timestamps read in device-local time, never sliced UTC', async () => {
    const r = await withShell(async () => {
      _shadowClear();
      const iso = '2026-01-15T23:45:00.000Z';
      _shadowLog.push({ k: 'arrive', name: 'TZ probe', t: iso });
      await _shadowPanel();
      const txt = document.getElementById('_geo-shadow-ov')?.textContent || '';
      document.getElementById('_geo-shadow-ov')?.remove();
      const d = new Date(iso);
      const localHm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      return {
        showsLocal: txt.includes(localHm + '  arrive · TZ probe'),
        // Only meaningful when the runner's zone differs from UTC, but
        // harmless when it does not (both strings are then the same).
        utcLeak: localHm !== '23:45' && txt.includes('23:45  arrive'),
      };
    });
    expect(r.showsLocal, 'the row carries the device-local clock').toBe(true);
    expect(r.utcLeak, 'the raw UTC slice never reaches the glass').toBe(false);
  });

  test('in a plain browser the shadow engine is completely inert', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      window.Capacitor = undefined;
      try {
        const started = await startShadowEngine();
        return { started, on: shadowEngineOn() };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.started).toBe(false);
    expect(r.on).toBe(false);
  });

  test('no console errors across the shadow suite', async () => { await assertNoErrors(page); });
});
