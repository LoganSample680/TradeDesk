// @ts-check
// ── Drive: turn-by-turn inside TradeDesk ─────────────────────────────────────
// Owner ask (2026-08-09): real GPS navigation embedded in the app, on native
// MapKit, using Apple Maps.
//
// The native half (native/td-nav) renders the map, follows the driver and
// reports at about 1Hz. EVERY DECISION is here in JS (CLAUDE.md 3.2): when to
// speak, what counts as off route, when the truck has arrived. That is exactly
// what these tests cover, because it is the part that can be fixed with a UAT
// roll instead of a 15-minute macOS build, and therefore the part that must be
// right by test rather than by hoping.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('drive', () => {
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

  // The TdNav plugin as native/td-nav exposes it, with every call recorded.
  const withNav = (body, arg) => page.evaluate(async ([b, a]) => {
    const realCap = window.Capacitor;
    const calls = { start: [], stop: [], speak: [], recalculate: [] };
    let listener = null;
    window.__nav = calls;
    window.__fire = (ev) => { if (listener) listener(ev); };
    // _driveBound is a one-shot guard: the app binds the native listener once
    // per launch, which is right on a device and wrong here, because every test
    // installs its own stub plugin. Without this reset only the FIRST test ever
    // gets a listener and every later __fire lands on nothing.
    window._driveBound = false;
    window.Capacitor = {
      isNativePlatform: () => true,
      registerPlugin: (n) => n === 'TdNav' ? {
        addListener: (_n, fn) => { listener = fn; },
        isAvailable: () => Promise.resolve({ available: true }),
        start: (o) => { calls.start.push(o); return Promise.resolve({ started: true }); },
        stop: () => { calls.stop.push(1); return Promise.resolve({ stopped: true }); },
        speak: (o) => { calls.speak.push(o.text); return Promise.resolve({ spoken: true }); },
        recalculate: (o) => { calls.recalculate.push(o); return Promise.resolve({ recalculating: true }); },
      } : null,
    };
    try { return await (new Function('a', 'return (' + b + ')(a)'))(a); }
    finally { window.Capacitor = realCap; }
  }, [body.toString(), arg]);

  const seedJob = () => page.evaluate(() => {
    const tk = todayKey();
    jobs.length = 0; clients.length = 0;
    clients.push({ id: 501, name: 'Dana Ramirez', addr: '12 Oak St', phone: '8155551234' });
    jobs.push({ id: 7001, name: 'Kitchen repaint', client_id: 501, start: tk, end: tk,
                allowWeekend: true, days: 1, status: 'active', lat: 41.532, lon: -88.095 });
  });

  test('in the app, Drive opens turn-by-turn rather than leaving for Maps', async () => {
    await seedJob();
    const r = await withNav(async () => {
      const opened = [];
      const realOpen = window.open;
      window.open = (u) => { opened.push(u); return null; };
      try {
        await startDrive('7001');
        return { started: window.__nav.start, opened, capable: driveCapable() };
      } finally { window.open = realOpen; }
    });
    expect(r.capable).toBe(true);
    expect(r.started.length, 'navigation starts natively').toBe(1);
    expect(r.started[0].lat).toBeCloseTo(41.532, 3);
    expect(r.started[0].label, 'the destination is named for the driver').toBe('Dana Ramirez');
    expect(r.opened, 'nothing bounces the crew out to Maps').toEqual([]);
  });

  test('in a browser it is honest: the Apple Maps handoff, labelled Directions', async () => {
    await seedJob();
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      window.Capacitor = undefined;
      const opened = [];
      const realOpen = window.open;
      window.open = (u) => { opened.push(u); return null; };
      try {
        const label = driveButtonHtml('7001');
        await startDrive('7001');
        return { opened, capable: driveCapable(), label };
      } finally { window.open = realOpen; window.Capacitor = realCap; }
    });
    expect(r.capable).toBe(false);
    expect(r.opened.length).toBe(1);
    expect(r.opened[0]).toMatch(/maps\.apple\.com/);
    expect(r.label, 'the button never promises navigation it cannot do').toMatch(/Directions/);
    expect(r.label).not.toMatch(/>\s*Drive/);
  });

  test('a job with no address says so instead of navigating nowhere', async () => {
    await page.evaluate(() => {
      const tk = todayKey();
      jobs.length = 0;
      jobs.push({ id: 7002, name: 'No address', client_id: null, start: tk, end: tk,
                  allowWeekend: true, days: 1, status: 'active' });
      window._resolveCoords = async () => null;
    });
    const r = await withNav(async () => {
      await startDrive('7002');
      return { started: window.__nav.start.length };
    });
    expect(r.started).toBe(0);
  });

  // Two announcements per turn, which is what Apple and Waze both settled on:
  // one far enough out to change lanes, one at the turn. A third is noise and a
  // driver stops listening to all of them.
  test('each turn is announced twice: once early, once at the turn', async () => {
    await seedJob();
    const spoken = await withNav(async () => {
      await startDrive('7001');
      const p = (stepIndex, meters, text) => window.__fire({
        type: 'progress', stepIndex, stepMeters: meters, stepText: text,
        offRouteMeters: 5, toDestinationMeters: 5000, etaSeconds: 600 });
      p(0, 900, 'Turn right onto Oak Street');    // ~2950 ft, too far, silent
      p(0, 500, 'Turn right onto Oak Street');    // ~1640 ft, the early call
      p(0, 300, 'Turn right onto Oak Street');    // ~980 ft, still the same call
      p(0, 80,  'Turn right onto Oak Street');    // ~260 ft, at the turn
      p(0, 40,  'Turn right onto Oak Street');    // already said, silent
      p(1, 400, 'Turn left onto Main Street');    // next turn, early call
      return window.__nav.speak;
    });
    expect(spoken.length, 'exactly two per turn, plus the next turn\'s first').toBe(3);
    expect(spoken[0]).toMatch(/^In \d+ feet, Turn right onto Oak Street$/);
    expect(spoken[1]).toBe('Turn right onto Oak Street');
    expect(spoken[2]).toMatch(/^In \d+ feet, Turn left onto Main Street$/);
  });

  // A fix bouncing off a building beside the route is normal. A rebuild costs a
  // Directions call and a "Rerouting" out loud, so it takes three in a row.
  test('one bad fix is not a wrong turn, three in a row is', async () => {
    await seedJob();
    const r = await withNav(async () => {
      await startDrive('7001');
      const off = (m) => window.__fire({ type: 'progress', stepIndex: 0, stepMeters: 5000,
        stepText: 'Continue', offRouteMeters: m, toDestinationMeters: 5000 });
      off(200);
      const afterOne = window.__nav.recalculate.length;
      off(10);                    // back on the line: the count resets
      off(200); off(200);
      const afterTwoMore = window.__nav.recalculate.length;
      off(200);
      return { afterOne, afterTwoMore, afterThree: window.__nav.recalculate.length,
               spoke: window.__nav.speak };
    });
    expect(r.afterOne, 'one fix off the line changes nothing').toBe(0);
    expect(r.afterTwoMore, 'and the counter really did reset in between').toBe(0);
    expect(r.afterThree, 'three consecutive is a wrong turn').toBe(1);
    expect(r.spoke, 'and the driver is told why the route changed').toContain('Rerouting');
  });

  test('arrival ends the drive and opens the job they drove to', async () => {
    await seedJob();
    const r = await withNav(async () => {
      let openedJob = null;
      window.openJobDetail = (id) => { openedJob = id; };
      await startDrive('7001');
      window.__fire({ type: 'progress', stepIndex: 0, stepMeters: 30, stepText: 'Arrive',
                      offRouteMeters: 5, toDestinationMeters: 60 });
      await new Promise(r2 => setTimeout(r2, 600));
      return { stops: window.__nav.stop.length, openedJob, spoke: window.__nav.speak };
    });
    expect(r.stops, 'the native screen is torn down, not left running').toBe(1);
    expect(String(r.openedJob), 'the crew land on the job, not back on a list').toBe('7001');
    expect(r.spoke.some(s => /Arriving at Dana Ramirez/.test(s))).toBe(true);
  });

  test('still 400 metres out is not an arrival', async () => {
    await seedJob();
    const stops = await withNav(async () => {
      await startDrive('7001');
      window.__fire({ type: 'progress', stepIndex: 0, stepMeters: 400, stepText: 'Continue',
                      offRouteMeters: 5, toDestinationMeters: 400 });
      await new Promise(r2 => setTimeout(r2, 200));
      return window.__nav.stop.length;
    });
    expect(stops).toBe(0);
  });

  test('a route that cannot be built ends the drive instead of hanging', async () => {
    await seedJob();
    const r = await withNav(async () => {
      await startDrive('7001');
      window.__fire({ type: 'error', message: 'no route' });
      await new Promise(r2 => setTimeout(r2, 100));
      // A progress event after the drive died must not resurrect it.
      window.__fire({ type: 'progress', stepIndex: 0, stepMeters: 100, stepText: 'Turn',
                      offRouteMeters: 5, toDestinationMeters: 5000 });
      return { stops: window.__nav.stop.length, spokeAfter: window.__nav.speak.length };
    });
    expect(r.stops).toBe(1);
    expect(r.spokeAfter, 'a dead drive says nothing').toBe(0);
  });

  test('ending the drive from the native screen tears everything down', async () => {
    await seedJob();
    const r = await withNav(async () => {
      await startDrive('7001');
      window.__fire({ type: 'cancelled' });
      window.__fire({ type: 'progress', stepIndex: 0, stepMeters: 100, stepText: 'Turn',
                      offRouteMeters: 500, toDestinationMeters: 50 });
      return { stops: window.__nav.stop.length, recalcs: window.__nav.recalculate.length };
    });
    expect(r.stops).toBe(1);
    expect(r.recalcs, 'no work happens after the driver ends it').toBe(0);
  });

  // The customer text is a deliberate one-tap action, not something the drive
  // fires by itself: sms: leaves the app, and yanking a driving contractor out
  // of navigation to send it would be worse than not sending it.
  test('the customer ETA text is its own button, never automatic', async () => {
    await seedJob();
    const r = await withNav(async () => {
      const before = window.__nav.speak.length;
      let navigated = null;
      const realNav = window._driveNavigate;
      window._driveNavigate = (h) => { navigated = h; };
      await startDrive('7001');
      for (const m of [3000, 1000, 300, 120]) {
        window.__fire({ type: 'progress', stepIndex: 0, stepMeters: m, stepText: 'Continue',
                        offRouteMeters: 5, toDestinationMeters: m, etaSeconds: 120 });
      }
      window._driveNavigate = realNav;
      return { navigated, before };
    });
    expect(r.navigated, 'a drive never opens Messages by itself').toBe(null);
  });

  test('Text ETA opens Messages with the client and a real message', async () => {
    await seedJob();
    const href = await page.evaluate(async () => {
      // window.location is [Unforgeable], so the app routes this through
      // _driveNavigate for exactly this reason (same seam as _subInviteNavigate).
      let got = null;
      const real = window._driveNavigate;
      window._driveNavigate = (h) => { got = h; };
      try { await driveTextEta('7001'); } finally { window._driveNavigate = real; }
      return got;
    });
    expect(href).toMatch(/^sms:8155551234/);
    expect(decodeURIComponent(href)).toMatch(/Hi Dana/);
    expect(decodeURIComponent(href)).toMatch(/on the way/);
  });

  test('Text ETA with no phone number says so rather than opening an empty text', async () => {
    await page.evaluate(() => {
      clients.length = 0;
      clients.push({ id: 502, name: 'No Phone', addr: '9 Elm St' });
      jobs.length = 0;
      const tk = todayKey();
      jobs.push({ id: 7003, name: 'Job', client_id: 502, start: tk, end: tk,
                  allowWeekend: true, days: 1, status: 'active', lat: 41.5, lon: -88.1 });
    });
    const href = await page.evaluate(async () => {
      let got = null;
      const real = window._driveNavigate;
      window._driveNavigate = (h) => { got = h; };
      try { await driveTextEta('7003'); } finally { window._driveNavigate = real; }
      return got;
    });
    expect(href).toBe(null);
  });

  test('no console errors across drive', async () => { await assertNoErrors(page); });
});
