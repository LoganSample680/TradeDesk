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
    // driveCapable() is a cached answer to isAvailable(), not just "is there a
    // plugin object", because Capacitor hands back a proxy even when the native
    // half is missing from the installed build. Ask it now so the stub counts.
    await _driveCapRefresh();
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

  // Owner 2026-08-10: "I need it to be Apple's navigation only." Apple never
  // licenses its turn-by-turn UI to apps, so the embedded screen can only be
  // a lookalike: the DEFAULT is now the real Apple Maps handoff, and the
  // embedded engine survives behind S.navEmbedded for fleets that want
  // in-app guidance despite that.
  test('in the app, Drive hands off to the real Apple Maps by default', async () => {
    await seedJob();
    const r = await withNav(async () => {
      const nav = [];
      const realNavigate = window._driveNavigate;
      window._driveNavigate = (u) => { nav.push(u); };
      try {
        S.navEmbedded = false;
        await startDrive('7001');
        return { started: window.__nav.start, nav, capable: driveCapable() };
      } finally { window._driveNavigate = realNavigate; }
    });
    expect(r.capable).toBe(true);
    expect(r.started.length, 'the lookalike does not launch uninvited').toBe(0);
    expect(r.nav.length).toBe(1);
    expect(r.nav[0], 'the real Maps app takes the drive').toMatch(/daddr=41.532/);
  });

  test('S.navEmbedded opts a fleet back into the in-app turn-by-turn', async () => {
    await seedJob();
    const r = await withNav(async () => {
      const nav = [];
      const realNavigate = window._driveNavigate;
      window._driveNavigate = (u) => { nav.push(u); };
      try {
        S.navEmbedded = true;
        await startDrive('7001');
        return { started: window.__nav.start, nav };
      } finally { window._driveNavigate = realNavigate; S.navEmbedded = false; }
    });
    expect(r.started.length, 'navigation starts natively when opted in').toBe(1);
    expect(r.started[0].lat).toBeCloseTo(41.532, 3);
    expect(r.started[0].label, 'the destination is named for the driver').toBe('Dana Ramirez');
    expect(r.nav, 'no double handoff on top of the embedded screen').toEqual([]);
  });

  test('in a browser it is honest: the Apple Maps handoff, labelled Directions', async () => {
    await seedJob();
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      window.Capacitor = undefined;
      const opened = [];
      const realNavigate = window._driveNavigate;
      window._driveNavigate = (u) => { opened.push(u); };
      try {
        const label = driveButtonHtml('7001');
        await startDrive('7001');
        return { opened, capable: driveCapable(), label };
      } finally { window._driveNavigate = realNavigate; window.Capacitor = realCap; }
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

  // The dashboard is where a crew member actually starts a drive: it is their
  // home screen and the job is right there. This replaced a bare Apple Maps
  // link that bounced them out of the app.
  test('the crew day card starts the drive in-app, not in Apple Maps', async () => {
    const r = await page.evaluate(() => {
      window._isEmployee = true;
      window._employeeRecord = { id: 'e1', name: 'Mike Alvarez', role: 'tech', permissions: {} };
      const tk = todayKey();
      jobs.length = 0; clients.length = 0;
      clients.push({ id: 501, name: 'Dana Ramirez', addr: '12 Oak St' });
      jobs.push({ id: 7001, name: 'Kitchen repaint', client_id: 501, addr: '12 Oak St',
                  start: tk, end: tk, allowWeekend: true, days: 1, status: 'active', assignedTo: 'e1' });
      goPg('pg-dash');
      renderDash();
      const html = document.body.innerHTML;
      return {
        drives: document.querySelectorAll('[onclick^="startDrive"]').length,
        oldLink: /Navigate<\/a>/.test(html),
        // One word, one meaning: the mileage quick action no longer also says
        // "Drive" now that Drive means navigation.
        quickAction: (document.getElementById('qa-drive-btn') || {}).textContent || '',
      };
    });
    expect(r.drives, 'the job on their home screen is drivable').toBeGreaterThan(0);
    expect(r.oldLink, 'the old handoff link is deleted, not left beside it').toBe(false);
    expect(r.quickAction).not.toMatch(/^\s*Drive\s*$/);
    expect(r.quickAction).toMatch(/Log miles/);
  });

  // ── The Log a trip sheet ───────────────────────────────────────────────────
  // Owner call (2026-08-09): no branded fourth option. "It should be smart
  // enough to see the phone, then based on iPhone it preselects Apple Maps,
  // then you click save trip to start, none is nice in case you need to
  // manually add."
  //
  // So the sheet keeps its three familiar choices and answers the question
  // itself from the device. What "Apple Maps" MEANS is the only thing that
  // varies: in the app it is our own full-screen Apple Maps drive, in a browser
  // it opens the Maps app. Same promise, best available version of it.
  const openTripSheet = async (native) => page.evaluate(async (isNative) => {
    document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
    window.__realCap = window.Capacitor;
    window.__started = [];
    window.__handoff = [];
    // Stub the handoff so a test never actually navigates the page, and SAVE
    // the real one. Leaving the stub installed is what broke the Google-link
    // test further down the file: it called openTripInMaps and got the stub,
    // which never touches window.open, so the URL came back empty.
    if (!window.__realOpenTripInMaps) window.__realOpenTripInMaps = window.openTripInMaps;
    window.openTripInMaps = (app, from, to) => { window.__handoff.push(app); };
    if (isNative) {
      window.Capacitor = {
        isNativePlatform: () => true,
        registerPlugin: (n) => n === 'TdNav' ? {
          addListener() {}, speak: () => Promise.resolve({}), stop: () => Promise.resolve({}),
          recalculate: () => Promise.resolve({}),
          isAvailable: () => Promise.resolve({ available: true }),
          start: (o) => { window.__started.push(o); return Promise.resolve({}); },
        } : null,
      };
      await _driveCapRefresh();
    } else {
      window.Capacitor = undefined;
      try { localStorage.removeItem('td_nav_capable'); } catch (e) {}
    }
    openDriveModal({});
  }, native);

  const closeTripSheet = () => page.evaluate(() => {
    document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
    window.Capacitor = window.__realCap;
    // Put the real handoff back, or every later test in this file inherits the
    // stub and silently measures nothing.
    if (window.__realOpenTripInMaps) window.openTripInMaps = window.__realOpenTripInMaps;
  });

  // Owner call (2026-08-10): "only show Apple Maps on Apple devices and give a
  // none option for back completing mileage, then Google on android devices and
  // desktops." Offering a map the device cannot open is a button that does
  // nothing, and a third choice nobody on that device would pick is just
  // something to mis-tap.
  test('the sheet shows one map, the one this device has, plus None', async () => {
    await openTripSheet(true);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      branded: !!document.getElementById('lm-map-td'),
      chips: ['apple', 'google', 'none'].filter(k => !!document.getElementById('lm-map-' + k)),
      expected: _tripMapForDevice(),
      none: (document.getElementById('lm-map-none') || {}).textContent || '',
      selected: (document.getElementById('lm-map-app') || {}).value,
    }));
    await closeTripSheet();
    expect(r.branded, 'nothing here asks a contractor to learn a new word').toBe(false);
    expect(r.chips, 'exactly two buttons: this device\'s map, and None')
      .toEqual([r.expected, 'none']);
    expect(r.none, 'None is how you back-fill a trip from last week').toMatch(/None/);
    expect(r.selected, 'and the one map shown is already picked').toBe(r.expected);
  });

  // The preselect used to run on a 50ms timer even though the buttons were
  // already in the DOM, so the sheet opened with nothing selected for its first
  // frames: a flicker on a phone, and a race that failed on WebKit and passed
  // on Chromium. It is synchronous now, so this reads the state on the very
  // first tick with no wait at all.
  test('the map is selected on the first frame, not after a timer', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      openDriveModal({});
      const out = {
        value: (document.getElementById('lm-map-app') || {}).value,
        highlighted: ['apple', 'google'].some(k => {
          const el = document.getElementById('lm-map-' + k);
          return el && el.style.background !== '';
        }),
        want: _tripMapForDevice(),
      };
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      return out;
    });
    expect(r.value, 'no frame where the sheet shows nothing picked').toBe(r.want);
    expect(r.highlighted).toBe(true);
  });

  test('the map a device cannot open is never offered', async () => {
    await openTripSheet(false);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const apple = _tripMapForDevice() === 'apple';
      return {
        apple,
        hasApple: !!document.getElementById('lm-map-apple'),
        hasGoogle: !!document.getElementById('lm-map-google'),
      };
    });
    await closeTripSheet();
    if (r.apple) {
      expect(r.hasGoogle, 'an iPhone is not offered Google').toBe(false);
      expect(r.hasApple).toBe(true);
    } else {
      // maps:// is an Apple URL scheme: on Android, Windows or Linux it opens
      // nothing at all, so the button must not exist there.
      expect(r.hasApple, 'a dead URL scheme is never rendered as a button').toBe(false);
      expect(r.hasGoogle).toBe(true);
    }
  });

  // One definition of which map a device has, shared by the chooser and the
  // preselect, so the button on screen and the link behind it can never
  // disagree. Apple device, Apple Maps: no phone-versus-desk exception.
  test('the device rule is one function, and it is the obvious one', async () => {
    const pick = (ua) => page.evaluate((agent) => {
      const real = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', { value: agent, configurable: true });
      try { return _tripMapForDevice(); }
      finally { Object.defineProperty(navigator, 'userAgent', { value: real, configurable: true }); }
    }, ua);
    expect(await pick('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('apple');
    expect(await pick('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('apple');
    expect(await pick('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('google');
    expect(await pick('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('google');
    // Owner 2026-08-10: "Mac's get Apple always". maps:// opens the real Maps
    // app on a desktop Mac exactly as it does on a phone, so there was never a
    // reason to send it to Google.
    expect(await pick('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
      'a Mac is Apple hardware').toBe('apple');
  });

  test('the sheet says Navigate after saving, with no optional tag', async () => {
    const label = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      openDriveModal({});
      const l = [...document.querySelectorAll('label')]
        .map(x => x.textContent).find(t => /Navigate after saving/i.test(t)) || '';
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      return l;
    });
    expect(label).toMatch(/Navigate after saving/);
    expect(label, 'None is right there saying it is optional').not.toMatch(/optional/i);
  });

  test('the Google handoff is a real web link that opens anywhere', async () => {
    const r = await page.evaluate(() => {
      const realOpen = window.open;
      const opened = [];
      window.open = (u) => { opened.push(u); return null; };
      // Explicitly the REAL builder, never a stub another test left behind.
      const fn = window.__realOpenTripInMaps || window.openTripInMaps;
      try {
        fn('google', '2015 SW Randolph Ave', '12 Oak St');
        return opened[0] || '';
      } finally { window.open = realOpen; }
    });
    expect(r, 'a plain web link, so a desktop can actually follow it')
      .toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    expect(r, 'and it carries both ends of the trip').toMatch(/origin=.*destination=/);
  });

  test('in the app, Save trip drives on Apple Maps without leaving', async () => {
    await openTripSheet(true);
    await page.waitForTimeout(200);
    const r = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      window._resolveCoords = async () => ({ lat: 41.532, lng: -88.095 });
      try {
        _selectTripMapApp('apple');   // in-app drive is the Apple path
        document.getElementById('lm-to').value = '12 Oak St, Joliet IL';
        const sel = document.getElementById('lm-trip-type-sel');
        const first = [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean)[0];
        sel.value = first;
        document.getElementById('lm-purpose').value = first;
        saveLoggedTrip();
        await new Promise(res => setTimeout(res, 400));
        return { started: window.__started, handoff: window.__handoff };
      } finally { window._resolveCoords = realResolve; }
    });
    await closeTripSheet();
    expect(r.started.length, 'Save trip IS the start button').toBe(1);
    expect(r.started[0].lat).toBeCloseTo(41.532, 3);
    expect(r.handoff, 'and it never leaves the app to do it').toEqual([]);
  });

  test('in a browser the same choice hands off, as it always did', async () => {
    await openTripSheet(false);
    await page.waitForTimeout(200);
    const r = await page.evaluate(async () => {
      // Whichever map this runner is offered: the point is that a browser
      // hands off rather than pretending to navigate.
      _selectTripMapApp(_tripMapForDevice());
      document.getElementById('lm-to').value = '12 Oak St, Joliet IL';
      const sel = document.getElementById('lm-trip-type-sel');
      const first = [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean)[0];
      sel.value = first;
      document.getElementById('lm-purpose').value = first;
      saveLoggedTrip();
      await new Promise(res => setTimeout(res, 300));
      return { started: window.__started.length, handoff: window.__handoff };
    });
    await closeTripSheet();
    expect(r.started, 'no plugin here, so nothing pretends to navigate').toBe(0);
    expect(r.handoff.length, 'the map it offered is the map it opens').toBe(1);
  });

  test('None saves the trip and navigates nothing', async () => {
    await openTripSheet(true);
    await page.waitForTimeout(200);
    const r = await page.evaluate(async () => {
      _selectTripMapApp('');
      document.getElementById('lm-to').value = '99 Elm St';
      const sel = document.getElementById('lm-trip-type-sel');
      const first = [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean)[0];
      sel.value = first;
      document.getElementById('lm-purpose').value = first;
      const before = mileage.length;
      saveLoggedTrip();
      await new Promise(res => setTimeout(res, 300));
      return { started: window.__started.length, handoff: window.__handoff.length,
               logged: mileage.length > before };
    });
    await closeTripSheet();
    expect(r.logged, 'the trip is still recorded, which is the whole point').toBe(true);
    expect(r.started, 'a trip added after the fact must not start a drive').toBe(0);
    expect(r.handoff).toBe(0);
  });

  // Capacitor.registerPlugin returns a proxy whether or not the native half is
  // in the installed build. A phone still on an older TestFlight build would
  // otherwise call the button Drive and fail on the first tap.
  test('a build without the native drive says Directions, not Drive', async () => {
    await seedJob();
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const opened = [];
      const realOpen = window.open;
      window.open = (u) => { opened.push(u); return null; };
      window.Capacitor = {
        isNativePlatform: () => true,
        // Exactly what an older build does: the proxy exists, the method does not.
        registerPlugin: () => ({
          isAvailable: () => Promise.reject(new Error('not implemented')),
          start: () => Promise.reject(new Error('not implemented')),
        }),
      };
      try {
        const probed = await _driveCapRefresh();
        const capable = driveCapable();
        const label = driveButtonHtml('7001');
        await startDrive('7001');
        return { probed, capable, label, opened };
      } finally {
        window.open = realOpen; window.Capacitor = realCap;
        try { localStorage.removeItem('td_nav_capable'); } catch (e) {}
      }
    });
    expect(r.probed, 'the probe answers honestly').toBe(false);
    expect(r.capable).toBe(false);
    expect(r.label, 'and the button promises only what that build can do').toMatch(/Directions/);
    expect(r.opened.length, 'the tap still gets them there, via Maps').toBe(1);
    expect(r.opened[0]).toMatch(/maps\.apple\.com/);
  });

  test('no console errors across drive', async () => { await assertNoErrors(page); });
});
