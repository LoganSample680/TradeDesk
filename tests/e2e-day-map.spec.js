// @ts-check
// ── The Dispatch day map ─────────────────────────────────────────────────────
// Owner ask (2026-08-09): a map showing today's estimates and jobs plus where
// the crew are, Life360 style.
//
// What separates it from the fleet trackers it competes with (Housecall Pro's
// 10-second live map, Jobber's real-time GPS, ServiceTitan's Fleet Pro) is that
// it never implies live surveillance that is not happening. The engine is
// event-driven, so a crew pin is the last position that phone reported, stated
// with its age, and Locate is how a manager gets a current one. These tests
// hold that line, and the layout rules that go with it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('dispatch day map', () => {
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

  // Seeds a day: two jobs, one estimate appointment, a shop, and two crew with
  // deliberately different position ages. allowWeekend is set because the suite
  // can run on any weekday, and getJobWorkDays skips weekends otherwise.
  const seed = (opts) => page.evaluate((o) => {
    window.S = window.S || {};
    S.teamTracking = o.teamTracking !== false;
    S.bname = 'Sample Painting';
    S.officeLat = 41.5250; S.officeLon = -88.0817;
    S.employees = [{ employee_user_id: 'u-mike', name: 'Mike Alvarez' },
                   { employee_user_id: 'u-jt', name: 'J.T. Reyes' }];
    window._supaUser = { id: 'owner-uid' };
    window._contractorUserId = null;
    window.supaEnabled = () => true;
    const now = Date.now();
    window.__pings = o.noCrew ? [] : [
      { employee_user_id: 'u-mike', lat: 41.54, lon: -88.06, ts: new Date(now - 6 * 60000).toISOString() },
      { employee_user_id: 'u-mike', lat: 41.50, lon: -88.00, ts: new Date(now - 90 * 60000).toISOString() },
      { employee_user_id: 'u-jt', lat: 41.501, lon: -88.13, ts: new Date(now - 74 * 60000).toISOString() },
    ];
    window._supa = {
      from: () => ({ select() { return this; }, eq() { return this; }, gte() { return this; },
        order() { return this; }, limit() { return Promise.resolve({ data: window.__pings }); } }),
      channel() { const c = { on() { return c; }, subscribe() { return c; }, send() {} }; return c; },
      removeChannel() {},
    };
    const tk = todayKey();
    jobs.length = 0;
    const base = { start: tk, end: tk, allowWeekend: true, days: 1, status: 'active', client_id: null };
    if (!o.noWork) {
      jobs.push({ ...base, id: 9001, name: 'Kitchen repaint', lat: 41.532, lon: -88.095 });
      jobs.push({ ...base, id: 9002, name: 'Deck stain', lat: 41.512, lon: -88.05 });
      jobs.push({ ...base, id: 9003, name: 'Walkthrough, Ramirez', eventType: 'estimate', lat: 41.548, lon: -88.11 });
      // A task is not work on a map, and a job with no address cannot be pinned.
      jobs.push({ ...base, id: 9004, name: 'Order paint', eventType: 'task' });
      jobs.push({ ...base, id: 9005, name: 'No address yet' });
    }
    goPg('pg-dispatch');
    renderDispatch();
  }, opts || {});

  const openMap = async () => {
    await page.evaluate(() => setDispatchView('map'));
    await page.waitForTimeout(300);
  };

  test('Dispatch gains a Map tab beside By crew and Timeline', async () => {
    await seed();
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('#pg-dispatch .fb')].map(b => b.textContent.trim()));
    expect(tabs).toEqual(['By crew', 'Timeline', 'Map']);
  });

  test('today\'s jobs, estimates, the shop and the crew are all pinned', async () => {
    await seed();
    await openMap();
    const r = await page.evaluate(() => {
      const pts = _dayMapPoints();
      const by = {};
      pts.forEach(p => { by[p.type] = (by[p.type] || 0) + 1; });
      return { by, total: pts.length };
    });
    expect(r.by.job, 'two jobs today').toBe(2);
    expect(r.by.estimate, 'the estimate appointment is its own kind of pin').toBe(1);
    expect(r.by.shop).toBe(1);
    expect(r.by.crew, 'one pin per person, not one per ping').toBe(2);
    expect(r.total).toBe(6);
  });

  test('a to-do and an un-geocoded job are not pinned as work', async () => {
    await seed();
    await openMap();
    const labels = await page.evaluate(() => _dayMapPoints().map(p => p.label));
    expect(labels, 'a task has no site to drive to').not.toContain('Order paint');
    expect(labels, 'no address means no honest pin').not.toContain('No address yet');
  });

  test('each crew member shows the AGE of their position, not a live claim', async () => {
    await seed();
    await openMap();
    const txt = await page.evaluate(() => document.getElementById('_day-map-crew').textContent);
    expect(txt).toMatch(/Mike Alvarez/);
    expect(txt, 'six minutes reads as six minutes').toMatch(/6 min ago/);
    expect(txt, 'and over an hour says so rather than rounding to now').toMatch(/1 hour ago/);
    // Moved from under the map to the foot of the crew list when the sheet
    // took over the bottom of the screen. Asserted on the whole surface so the
    // rule survives the next layout change too: it must be on screen ONCE.
    const note = await page.evaluate(() => document.querySelector('.dm-wrap').textContent);
    expect(note, 'the honest framing is on screen, not just in our heads')
      .toMatch(/last reported position, not a live trail/);
    const said = await page.evaluate(() =>
      (document.querySelector('.dm-wrap').textContent.match(/not a live trail/g) || []).length);
    expect(said, 'said once, never twice').toBe(1);
  });

  test('the newest ping per person wins, older ones are not drawn', async () => {
    await seed();
    await openMap();
    const mike = await page.evaluate(() => _dayMapCrew.find(c => c.uid === 'u-mike'));
    expect(mike.lat, 'the 6-minute fix, not the 90-minute one').toBeCloseTo(41.54, 3);
  });

  test('every crew member gets a Locate button', async () => {
    await seed();
    await openMap();
    const n = await page.evaluate(() => document.querySelectorAll('._dm-locate').length);
    expect(n).toBe(2);
  });

  test('a successful Locate moves the pin and resets the age to just now', async () => {
    await seed();
    await openMap();
    const r = await page.evaluate(async () => {
      window.crewLocateRequest = async () => ({ ok: true, lat: 41.60, lng: -88.20, acc: 9, fixTs: Date.now() });
      await _dayMapLocate('u-mike');
      const c = _dayMapCrew.find(x => x.uid === 'u-mike');
      return { lat: c.lat, lon: c.lon, age: _dayMapAgeText(c.ts),
               shown: document.getElementById('_day-map-crew').textContent };
    });
    expect(r.lat).toBeCloseTo(41.60, 3);
    expect(r.lon).toBeCloseTo(-88.20, 3);
    expect(r.age).toBe('just now');
    expect(r.shown).toMatch(/just now/);
  });

  test('a Locate that goes unanswered says so instead of leaving a stale time', async () => {
    await seed();
    await openMap();
    const shown = await page.evaluate(async () => {
      window.crewLocateRequest = async () => ({ ok: false, reason: 'timeout' });
      await _dayMapLocate('u-jt');
      return document.querySelector('#_dm-crew-u-jt ._dm-when').textContent;
    });
    expect(shown, 'a manager must never read silence as a position').toMatch(/asleep or out of signal/);
  });

  test('no crew and no work is an empty state, not a broken map', async () => {
    await seed({ noWork: true, noCrew: true });
    await page.evaluate(() => { S.officeLat = null; S.officeLon = null; });
    await openMap();
    const txt = await page.evaluate(() => document.getElementById('_dispatch-body').textContent);
    expect(txt).toMatch(/Nothing to map today/);
  });

  test('tracking switched off explains itself rather than showing nothing', async () => {
    await seed({ teamTracking: false, noCrew: true });
    await openMap();
    const txt = await page.evaluate(() => document.getElementById('_day-map-crew').textContent);
    expect(txt).toMatch(/Crew tracking is off/);
  });

  // CLAUDE.md 15: the map is a full-width element on a 390px phone, which is
  // exactly the kind of thing that bleeds.
  test('the map holds the viewport at 390px with no sideways bleed', async () => {
    await seed();
    await openMap();
    const r = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth, vw: window.innerWidth,
      canvasRight: (() => { const e = document.getElementById('_day-map-body').firstElementChild;
        return e ? Math.round(e.getBoundingClientRect().right) : 0; })(),
    }));
    expect(r.scrollW).toBeLessThanOrEqual(r.vw + 1);
    expect(r.canvasRight).toBeLessThanOrEqual(r.vw + 1);
  });

  // Both maps in the app draw through one renderer now. The territory map on
  // Places and this one must not fight over a shared instance.
  test('Places and Dispatch each keep their own map instance', async () => {
    const r = await page.evaluate(() => ({
      factory: typeof tdMapState === 'function',
      separate: typeof _geoMapSt === 'object' && typeof _dayMapSt === 'object' && _geoMapSt !== _dayMapSt,
      shared: typeof tdMapRender === 'function' && typeof tdMapRenderFallback === 'function',
    }));
    expect(r.factory).toBe(true);
    expect(r.separate, 'one shared singleton means each render destroys the other map').toBe(true);
    expect(r.shared).toBe(true);
  });

  // Apple's Developer Program License Agreement: MapKit JS "may not be used in
  // your website and/or application running on non-Apple hardware for the
  // following commercial purposes: fleet management (including dispatch), asset
  // tracking, enterprise route optimization". This screen is all three. On an
  // Android phone or a Windows desktop it therefore falls back to our own plot,
  // which uses none of Apple's data, rather than drawing tiles we are not
  // licensed to draw there.
  // ── What the pin carries (owner 2026-09-05, "Life360 but better") ─────────
  test.describe('a pin carries state, not just position', () => {
    // Load and paint deliberately, rather than leaning on openDayMap's async
    // chain: these tests are about what the pin CARRIES, and a shared
    // _dayMapLoading guard between tests is not the thing under test.
    const paint = () => page.evaluate(async () => {
      await _dayMapLoadCrew();
      setDispatchView('map');
      renderDayMap();
    });
    const seedRich = () => page.evaluate(() => {
      const now = Date.now();
      window.__pings = [
        { employee_user_id: 'u-mike', lat: 41.54, lon: -88.06, ts: new Date(now - 2 * 60000).toISOString(),
          state: 'site', dest: 'Kitchen repaint, Alvarez', journey_id: null, speed_mph: null, battery: 0.78 },
        { employee_user_id: 'u-mike', lat: 41.539, lon: -88.061, ts: new Date(now - 40 * 60000).toISOString(),
          state: 'site', dest: 'Kitchen repaint, Alvarez', journey_id: null, speed_mph: null, battery: 0.8 },
        { employee_user_id: 'u-jt', lat: 41.501, lon: -88.13, ts: new Date(now - 60000).toISOString(),
          state: 'drive', dest: 'from TradeDesk shop', journey_id: 'j1', speed_mph: 42, battery: 0.09 },
        { employee_user_id: 'u-jt', lat: 41.505, lon: -88.14, ts: new Date(now - 3 * 60000).toISOString(),
          state: 'drive', dest: 'from TradeDesk shop', journey_id: 'j1', speed_mph: 38, battery: 0.1 },
        { employee_user_id: 'u-jt', lat: 41.51, lon: -88.15, ts: new Date(now - 5 * 60000).toISOString(),
          state: 'drive', dest: 'from TradeDesk shop', journey_id: 'j1', speed_mph: 31, battery: 0.1 },
        { employee_user_id: 'u-jt', lat: 41.52, lon: -88.16, ts: new Date(now - 90 * 60000).toISOString(),
          state: 'shop', dest: 'the shop', journey_id: 'j0', speed_mph: null, battery: 0.2 },
      ];
    });

    test('driving shows the speed, on site shows how long', async () => {
      await seed();
      await seedRich();
      await paint();
      const txt = await page.evaluate(() => document.querySelector('.dm-wrap').textContent);
      expect(txt, 'the chip names the state').toMatch(/Driving/);
      expect(txt).toMatch(/On site/);
      const tags = await page.evaluate(() => [..._dayMapPoints()].filter(p => p.type === 'crew').map(p => p.date));
      expect(tags.join(' '), 'a truck on the road reads as a speed').toMatch(/42 mph/);
    });

    test('the trail is this journey only, never a line through the whole day', async () => {
      await seed();
      await seedRich();
      await paint();
      const t = await page.evaluate(() => (_dayMapCrew.find(c => c.uid === 'u-jt') || {}).trail);
      expect(t.length, 'three rows on journey j1, and not the shop row before it').toBe(3);
      expect(t[t.length - 1][0], 'oldest first, so the head of the comet is last').toBeCloseTo(41.501, 3);
    });

    test('the comet is drawn in fading stretches, brightest at the head', async () => {
      await seed();
      await seedRich();
      await paint();
      const segs = await page.evaluate(() => _dayMapTrailPaths().map(s => s.opacity));
      expect(segs.length).toBeGreaterThan(1);
      expect(Math.max(...segs), 'the newest stretch is the brightest').toBeGreaterThan(Math.min(...segs));
    });

    test('a phone about to die is flagged on the pin and in the row', async () => {
      await seed();
      await seedRich();
      await paint();
      const r = await page.evaluate(() => {
        const jt = _dayMapCrew.find(c => c.uid === 'u-jt');
        return { pin: _dayMapMarker({ type: 'crew', crew: jt, date: '' }),
                 row: document.getElementById('_dm-crew-u-jt').innerHTML };
      });
      expect(r.pin, 'the pin carries the pip').toMatch(/dm-batt/);
      expect(r.row, 'and the row says the number').toMatch(/9%/);
      expect(r.row).toMatch(/dm-b low/);
    });

    test('a healthy battery gets no pip, only the number', async () => {
      await seed();
      await seedRich();
      await paint();
      const r = await page.evaluate(() => {
        const mike = _dayMapCrew.find(c => c.uid === 'u-mike');
        return { pin: _dayMapMarker({ type: 'crew', crew: mike, date: '' }),
                 row: document.getElementById('_dm-crew-u-mike').innerHTML };
      });
      expect(r.pin).not.toMatch(/dm-batt/);
      expect(r.row).toMatch(/78%/);
    });

    test('a row written before the migration still draws, as a plain position', async () => {
      await seed();               // the original fixture: no state, no battery
      await paint();
      const r = await page.evaluate(() => {
        const mike = _dayMapCrew.find(c => c.uid === 'u-mike');
        return { state: mike.state, batt: mike.batt, pin: _dayMapMarker({ type: 'crew', crew: mike, date: '6 min ago' }) };
      });
      expect(r.state, 'null means "just a position", which is what it was').toBe(null);
      expect(r.batt).toBe(null);
      expect(r.pin, 'and it still renders').toMatch(/dm-av/);
      expect(r.pin).not.toMatch(/dm-batt/);
    });

    test('on site with no estimated hours gets a plain ring, never an invented fraction', async () => {
      const html = await page.evaluate(() =>
        _dayMapMarker({ type: 'crew', date: '', crew: { uid: 'x', name: 'A B', state: 'site', ts: new Date().toISOString() } }));
      expect(html).toMatch(/dm-prog/);
      expect(html, 'no dash offset means no number was claimed').not.toMatch(/stroke-dashoffset/);
    });

    test('a stale pin looks stale and says so', async () => {
      await seed();
      await page.evaluate(() => {
        window.__pings = [{ employee_user_id: 'u-mike', lat: 41.54, lon: -88.06,
          ts: new Date(Date.now() - 50 * 60000).toISOString(), state: 'site', dest: 'A job' }];
      });
      await paint();
      const r = await page.evaluate(() => ({
        row: document.getElementById('_dm-crew-u-mike').innerHTML,
        pin: _dayMapMarker({ type: 'crew', date: '', crew: _dayMapCrew[0] }),
      }));
      expect(r.row).toMatch(/Last seen/);
      expect(r.row).toMatch(/dm-age old/);
      expect(r.pin, 'and the pin dims rather than pretending').toMatch(/dm-stale/);
    });

    test('junk rows never throw and never fake a position', async () => {
      await seed();
      await page.evaluate(() => {
        window.__pings = [{ employee_user_id: 'u-mike', lat: null, lon: null, ts: 'nope',
          state: {}, dest: 12, speed_mph: 'fast', battery: 'full', journey_id: [] }];
      });
      await paint();
      const threw = await page.evaluate(() => {
        try { _dayMapPoints(); _dayMapCrewStrip(); _dayMapTrailPaths(); return false; } catch (e) { return true; }
      });
      expect(threw).toBe(false);
    });
  });

  test('Apple tiles are refused on non-Apple hardware, and the plot takes over', async () => {
    await seed();
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const ua = navigator.userAgent;
      let kitAsked = 0;
      const realKitReady = window._geoMapKitReady;
      window._geoMapKitReady = () => { kitAsked++; return true; };
      Object.defineProperty(navigator, 'userAgent',
        { value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', configurable: true });
      window.Capacitor = undefined;
      try {
        const android = tdAppleHardware();
        setDispatchView('map');
        await new Promise(res => setTimeout(res, 250));
        const usedTiles = !!document.getElementById('_day-map-canvas');
        const plotted = (document.getElementById('_day-map-body').innerHTML.match(/maps\?q=/g) || []).length;
        Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', configurable: true });
        const apple = tdAppleHardware();
        return { android, apple, usedTiles, plotted };
      } finally {
        Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
        window.Capacitor = realCap;
        window._geoMapKitReady = realKitReady;
      }
    });
    expect(r.android, 'an Android phone is not Apple hardware').toBe(false);
    expect(r.apple, 'an iPhone is').toBe(true);
    expect(r.usedTiles, 'no Apple tiles on hardware the licence excludes').toBe(false);
    expect(r.plotted, 'the screen still works, on our own plot').toBeGreaterThan(0);
  });

  test('no console errors across the day map', async () => { await assertNoErrors(page); });
});
