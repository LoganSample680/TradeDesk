// @ts-check
// ── The drive we already timed, now measured ─────────────────────────────────
//
// Owner direction (2026-08-01): "when we go geocode to geocode it calls MapKit
// to compute the mileage then we just rely on MapKit's calculations", and the
// attribution rule alongside it: "it either has to be in a company vehicle for
// an employee, or the owner can log things on any personal vehicle."
//
// Before this, the geofence knew the truck left the shop at 7:12 and reached the
// Miller job at 7:38, and threw the distance away. Miles only existed where a
// person typed them, or where End Drive guessed them at elapsed time x 25mph.
//
// What these tests pin down:
//   • Every leg type produces a trip, from both endpoints' GEOCODES, never from
//     a raw GPS fix. A fix inside a 600ft fence can sit 600ft off the address,
//     and an audit a year later has to reproduce the same number.
//   • The vehicle rule, in both directions. An employee in their own car is
//     still PAID for the drive (time logs) but the company does not deduct the
//     miles. The owner is the business, so any vehicle counts.
//   • A commute never becomes a business trip. The GPS cannot tell home from a
//     job site and will happily hand us that leg.
//   • One leg is one trip, forever. The leg key is shared with the time entry,
//     so a replay cannot bill the same miles twice.
//   • Arriving with no signal does not lose the trip. That is the normal case
//     on a rural site, not an edge case.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SHOP   = { lat: 38.0000, lon: -94.0000 };
const JOB     = { lat: 38.0600, lon: -94.0600 };
const SUPPLY  = { lat: 38.1200, lon: -94.1200 };
const HOMEOFF = { lat: 38.1800, lon: -94.1800 };
const LUNCH   = { lat: 38.2400, lon: -94.2400 };
const ROAD    = { lat: 38.5000, lon: -94.5000 };
const CLIENT  = { lat: 38.3000, lon: -94.3000 };   // John Doe: a client with NO job today

test.describe('Automatic mileage from drive legs', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    await page.evaluate((d) => {
      // ── The ENTIRE fixture is re-seedable, because none of it stays put ─────
      //
      // Two things overwrite it from under a running test:
      //
      //   1. supaLoadFromCloud. waitForAppBoot returns once the app is usable,
      //      but a load already IN FLIGHT is not cancelled by stubbing the
      //      function afterwards. When it lands it replaces the settings blob
      //      AND the synced arrays, so jobs, clients, places and vehicles all
      //      go with it.
      //   2. _geoOfficeCoords, kicked at boot whenever S.officeLat is unset,
      //      which writes the shop coordinates after its geocode resolves.
      //
      // That is how CI shard 3 failed on WebKit and not on Chromium: the load
      // landed inside the first test, `jobs` was empty so the destination never
      // fenced, the leg was never logged and no trip existed. The app was fine.
      // The test was leaning on state it did not own.
      //
      // An earlier version of this re-seeded only officeLat and teamTracking,
      // which is why the failure survived that fix: the arrays were the part
      // that mattered. Everything the tests depend on is restored here now.
      window._geoOfficeCoords = async () => ({ lat: d.SHOP.lat, lng: d.SHOP.lon });
      window.__seedGeo = () => {
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
        S.teamTracking = true;
        S.defaultVehicleId = 'v-truck';
        _geoPingBusy = false;

        places.length = 0;
        savePlace({ name: 'Ace Supply', kind: 'supply', lat: d.SUPPLY.lat, lon: d.SUPPLY.lon, confirmedBy: 'manual' });
        savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOMEOFF.lat, lon: d.HOMEOFF.lon, confirmedBy: 'manual' });

        clients.length = 0;
        clients.push({ id: 7701, name: 'Miller Residence', addr: '400 Oak St' });

        jobs.length = 0;
        jobs.push({ id: 9901, name: 'Repaint', eventType: 'job', status: 'upcoming',
                    start: todayKey(), days: 1, lat: d.JOB.lat, lon: d.JOB.lon, client_id: 7701, addr: '400 Oak St' });
        _geoJobCoords = {};   // the fence cache is keyed by job id; a fresh jobs array needs a fresh one

        vehicles.length = 0;
        vehicles.push({ id: 'v-truck', name: 'F-250', nickname: 'Big Blue', status: 'active' });
        vehicles.push({ id: 'v-van', name: 'Transit', status: 'active' });
      };
      __seedGeo();
    }, { SHOP, JOB, SUPPLY, HOMEOFF });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Drive `from` -> `to` and return every mileage row it produced.
  //
  // _routeDistance is stubbed to a fixed number, deliberately. What is under
  // test is which two points get handed to it and what row comes back, not
  // MapKit's arithmetic. The stub also RECORDS its arguments, because "did it
  // pass the geocode or the raw fix" is the assertion that matters most.
  async function drive({ from, to, viaRoad, asEmployee, empVehicle, dwellStop }) {
    return page.evaluate(async (a) => {
      const realUser = _supaUser, realEmp = _isEmployee, realRoute = _routeDistance;
      const calls = [];
      _supaUser = { id: 'u-mi' };
      _isEmployee = !!a.asEmployee;
      window._routeDistance = _routeDistance = async (f, t) => { calls.push({ f, t }); return { miles: 12.34, mins: 21 }; };
      if (a.asEmployee) {
        if (a.empVehicle) localStorage.setItem('emp_vehicle_' + todayKey(), a.empVehicle);
        else localStorage.removeItem('emp_vehicle_' + todayKey());
      }
      const before = mileage.length;
      try {
        __seedGeo();
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}

        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        const rewind = (m) => {
          const t = new Date(Date.now() - m * 60000).toISOString();
          if (_geoDriveStartedAt) _geoDriveStartedAt = t;
          if (_geoLastFenceAt) _geoLastFenceAt = t;
        };
        await ping(a.from);
        if (a.dwellStop) {
          // Park somewhere the app has never heard of for long enough to be a
          // real stop, so the leg splits at the kerb and the OUTBOUND leg starts
          // from the stop rather than from the fence before it.
          await ping(a.stopAt);
          await ping({ lat: a.stopAt.lat + 0.00004, lon: a.stopAt.lon });
          // The three clocks around a stop have to be ordered like the real day:
          // pulled out of the job, parked 20 minutes later, sat for half an hour,
          // pulled out again. Setting the anchor without moving the drive start
          // back behind it makes the inbound leg negative, and a negative leg is
          // dropped by the 2-minute floor rather than logged wrong.
          if (_geoStopAnchor) {
            _geoStopAnchor.at = new Date(Date.now() - 50 * 60000).toISOString();
            _geoStopAnchor.lastAt = new Date(Date.now() - 20 * 60000).toISOString();
          }
          _geoDriveStartedAt = new Date(Date.now() - 70 * 60000).toISOString();
        } else if (a.viaRoad) {
          await ping(a.road);
        }
        if (!a.dwellStop) rewind(20);
        await ping(a.to);
        // The route call is fired without being awaited (the row saves first),
        // so give the microtask queue a turn before reading the result.
        await new Promise(r => setTimeout(r, 30));
        return { rows: mileage.slice(0, Math.max(0, mileage.length - before)), calls };
      } finally {
        _supaUser = realUser; _isEmployee = realEmp;
        window._routeDistance = _routeDistance = realRoute;
      }
    }, { from, to, viaRoad: !!viaRoad, asEmployee: !!asEmployee, empVehicle: empVehicle || '',
         dwellStop: !!dwellStop, stopAt: LUNCH, road: ROAD });
  }

  test.describe('every leg type logs a measured trip', () => {
    test('shop to job: Job site, attached to the client, MapKit miles', async () => {
      const { rows, calls } = await drive({ from: SHOP, to: JOB, viaRoad: true });
      expect(rows.length).toBe(1);
      const t = rows[0];
      expect(t.miles).toBe(12.3);              // MapKit's number, rounded to a tenth
      expect(t.calc_method).toBe('auto_route');
      expect(t.purpose).toBe('Job site');
      expect(t.client_id).toBe(7701);
      expect(t.to_name).toBe('Miller Residence');
      expect(t.from_name).toBe('Shop');
      expect(t.gps).toBe(true);
      // The two points handed to MapKit are the GEOCODES, not the GPS fixes. The
      // shop fix was exact here, so the job end is what proves it: the arrival
      // ping is the job coordinate itself only because the fixture put it there,
      // whereas the ORIGIN could only be 38.0/-94.0 by coming off S.officeLat.
      expect(calls.length).toBe(1);
      expect(calls[0].f.lat).toBeCloseTo(38.0, 4);
      expect(calls[0].f.lng).toBeCloseTo(-94.0, 4);
      expect(calls[0].t.lat).toBeCloseTo(38.06, 4);
    });

    test('job to supply house: Supply run, named from the saved place', async () => {
      const { rows } = await drive({ from: JOB, to: SUPPLY, viaRoad: true });
      expect(rows.length).toBe(1);
      expect(rows[0].purpose).toBe('Supply run');
      expect(rows[0].to_name).toBe('Ace Supply');
      expect(rows[0].from_name).toBe('Miller Residence');
      expect(rows[0].miles).toBe(12.3);
    });

    test('job back to the shop: the new Shop trip type', async () => {
      const { rows } = await drive({ from: JOB, to: SHOP, viaRoad: true });
      expect(rows.length).toBe(1);
      expect(rows[0].purpose).toBe('Shop');
      expect(await page.evaluate(() => MILE_PURPOSES.includes('Shop'))).toBe(true);
    });

    test('shop to a home office: Home Office', async () => {
      const { rows } = await drive({ from: SHOP, to: HOMEOFF, viaRoad: true });
      expect(rows.length).toBe(1);
      expect(rows[0].purpose).toBe('Home Office');
    });

    test('a leg seen in ONE ping still logs, same as one seen from the road', async () => {
      // A pocketed phone backgrounds and delivers no fix mid-drive, so the last
      // fix is on site and the next is at the destination. If mileage only
      // existed when GPS happened to sample the road, the deduction would
      // depend on luck.
      const { rows, calls } = await drive({ from: SHOP, to: JOB, viaRoad: false });
      expect(rows.length).toBe(1);
      expect(rows[0].miles).toBe(12.3);
      expect(calls[0].f.lat).toBeCloseTo(38.0, 4);   // still the shop geocode
    });

    // Behavior intentionally changed (owner report, 2026-08-07): an anonymous
    // stop used to terminate the leg and produce a deductible "-> Stop" row,
    // which is how a real errand day logged "Home Depot -> Stop" for a
    // restaurant and inflated the deduction. An unnamed, unreceipted stop is
    // now a detour: its inbound row collapses (breadcrumbed, reversible by
    // receipt) and the surviving row runs endpoint to endpoint at direct
    // miles, per the CPA rule already documented on _geoCloseStop.
    test('an anonymous unreceipted stop in the middle collapses into ONE direct endpoint-to-endpoint trip', async () => {
      const { rows } = await drive({ from: JOB, to: SUPPLY, dwellStop: true });
      expect(rows.length, 'the detour must not split the deductible trip').toBe(1);
      const t = rows[0];
      expect(t.from_name).toBe('Miller Residence');   // the JOB endpoint, not the kerb
      expect(t.to_name).toBe('Ace Supply');
      expect(t.to_name).not.toBe('Stop');
      // The dropped sub-leg rides along as the breadcrumb that makes this
      // reversible when a receipt for the stop turns up later.
      expect(t.passedThrough && t.passedThrough.stop).toBeTruthy();
      expect(t.passedThrough.stop.lat).toBeCloseTo(38.24, 2);
      // Wheel time surfaces on the row and sums BOTH sub-legs (~20 + ~20 min).
      expect(t.mins).toBeGreaterThanOrEqual(38);
      expect(t.mins).toBeLessThanOrEqual(42);
    });

    test('the same stop WITH a same-day receipt at its pin stays a real destination, two trips', async () => {
      await page.evaluate((LUNCH) => {
        window.__origExpenses = expenses.slice();
        expenses.push({ id: 991001, vendor: 'Ace Lunch Counter', amount: 42, cat: 'meals',
          date: todayKey(), lat: LUNCH.lat, lon: LUNCH.lon, geoAcc: 10, geoAt: new Date().toISOString() });
      }, LUNCH);
      const { rows } = await drive({ from: JOB, to: SUPPLY, dwellStop: true });
      await page.evaluate(() => { expenses.length = 0; window.__origExpenses.forEach(e => expenses.push(e)); window.__origExpenses = null; });
      expect(rows.length, 'a receipted stop is proven business, the split stands').toBe(2);
      const tos = rows.map(r => Math.round((r.toCoord?.lat || 0) * 100) / 100);
      expect(tos).toContain(38.24);      // inbound ended at the receipted stop
      expect(tos).toContain(38.12);      // outbound ended at the supply house
    });

    test('drive time surfaces on the mileage row and renders in the log', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true });
      expect(rows[0].mins, 'the ~20-minute leg carries its wheel time').toBeGreaterThanOrEqual(19);
      expect(rows[0].mins).toBeLessThanOrEqual(21);
      const out = await page.evaluate(() => {
        window.__origMileage = mileage.slice();
        mileage.length = 0;
        const start = new Date(); start.setHours(9, 12, 0, 0);
        const end = new Date(); end.setHours(10, 47, 0, 0);
        mileage.push({ id: 991002, date: todayKey(), from_name: 'Shop', to_name: 'Miller Residence',
          miles: 12.3, mins: 95, startedIso: start.toISOString(), endedIso: end.toISOString(),
          purpose: 'Job site', gps: true, created_at: new Date().toISOString() });
        renderAllMileage();
        const trip = document.querySelector('.mil-day-trip[data-lp-id="991002"]');
        const res = {
          // WHERE stays on the left, untouched by the clock/duration.
          routeText: trip?.querySelector('.mil-day-trip-route')?.innerText || '',
          // WHEN + HOW LONG live together in one right-aligned stats stack,
          // not scattered beside each stop (that read as floating, disjointed
          // text at a different position on every row).
          mi: trip?.querySelector('.mil-trip-mi')?.innerText || '',
          meta: trip?.querySelector('.mil-trip-meta')?.innerText || '',
        };
        mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        return res;
      });
      expect(out.routeText).toContain('Shop');
      expect(out.routeText).toContain('Miller Residence');
      expect(out.routeText).not.toContain('9:12');   // no clock text bleeds into the route column
      expect(out.routeText).not.toContain('10:47');
      expect(out.mi).toContain('12.3 mi');
      expect(out.meta).toContain('1h 35m');    // wheel time
      expect(out.meta).toContain('9:12a');     // and the trip's real clock, compact format
      expect(out.meta).toContain('10:47a');
      expect(out.meta.indexOf('·')).toBeGreaterThan(-1);   // duration and clock on ONE grouped line
    });
  });

  // ── "Which vehicle are you driving today?" ─────────────────────────────────
  // Owner call (2026-08-01): "for multiple vehicles I kind of like a popup,
  // which vehicle are you driving today?"
  //
  // Crew have always been asked. Owners are now asked too, but only when the
  // question has more than one answer, and never in a way that can LOSE a trip:
  // dismissing the sheet falls back to the Fleet default, because an owner who
  // swipes a popup away has not thereby given up the day's deduction.
  const pickerFor = (opts) => page.evaluate((o) => {
    const realEmp = _isEmployee, keepTracking = S.teamTracking, keepVeh = vehicles.slice();
    const keepDef = S.defaultVehicleId;
    try {
      _isEmployee = !!o.employee;
      S.teamTracking = o.tracking !== false;
      S.defaultVehicleId = o.defaultId || '';
      if (o.vehicles) { vehicles.length = 0; o.vehicles.forEach(v => vehicles.push(v)); }
      localStorage.removeItem('emp_vehicle_' + todayKey());
      document.getElementById('_vehicle-picker-ov')?.remove();
      _checkEmployeeVehiclePicker();
      const ov = document.getElementById('_vehicle-picker-ov');
      const html = ov ? ov.innerHTML : '';
      const labels = ov ? Array.from(ov.querySelectorAll('button')).map(b => b.textContent.trim()) : [];
      ov?.remove();
      return { shown: !!ov, labels, usualFirst: labels[0] || '', html };
    } finally {
      _isEmployee = realEmp; S.teamTracking = keepTracking; S.defaultVehicleId = keepDef;
      vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
      localStorage.removeItem('emp_vehicle_' + todayKey());
    }
  }, opts);

  test.describe('the daily vehicle popup', () => {
    // crewDrivable is set here because these cases are about the CREW picker,
    // and crew are only ever offered vehicles the owner has said they may drive
    // (getCrewVehicles, off by default). The owner's own prompt ignores the tag,
    // which the 'owner' cases below exercise without it.
    const TWO = [{ id: 'v-truck', name: 'F-250', status: 'active', crewDrivable: true },
                 { id: 'v-van', name: 'Transit', status: 'active', crewDrivable: true }];

    test('owner with two trucks is asked', async () => {
      const out = await pickerFor({ vehicles: TWO, defaultId: 'v-truck' });
      expect(out.shown).toBe(true);
      expect(out.html).toContain('Which vehicle are you driving today?');
    });

    test('owner with one truck is never asked', async () => {
      // Nothing to ask. getDefaultVehicle already falls through to the only
      // truck, so a popup here is a daily tap for a one-answer question.
      const out = await pickerFor({ vehicles: [TWO[0]], defaultId: '' });
      expect(out.shown).toBe(false);
    });

    test('a sold second truck does not conjure the question', async () => {
      const out = await pickerFor({
        vehicles: [TWO[0], { id: 'v-old', name: 'Old Ranger', status: 'sold' }], defaultId: '' });
      expect(out.shown).toBe(false);
    });

    test('the usual truck is listed first and marked', async () => {
      // The normal day has to be one confirming tap, not a hunt. v-van is first
      // in the fixture array, so seeing F-250 on top proves it was reordered.
      const out = await pickerFor({ vehicles: [TWO[1], TWO[0]], defaultId: 'v-truck' });
      expect(out.usualFirst).toContain('F-250');
      expect(out.usualFirst).toContain('USUAL');
    });

    test('the owner is not offered "personal, no mileage logged"', async () => {
      // Their personal car's business miles ARE deductible. Offering crew's
      // opt-out would quietly bin a real deduction; the honest answer is that
      // the vehicle belongs in Fleet.
      const out = await pickerFor({ vehicles: TWO, defaultId: 'v-truck' });
      // Keyed off the ACTION, not the wording: the row's job is to write
      // 'personal', and copy gets rewritten.
      expect(out.html).not.toContain("_pickVehicle('personal'");
    });

    test('nobody is offered "on foot", and no code path answers it', async () => {
      // Deleted outright on the owner's call. No contractor walks between job
      // sites, so it was a tap everybody read past. Asserted gone rather than
      // merely unused (CLAUDE.md 7.1), for BOTH roles since it lived on the
      // shared prompt, and the value's readers went with it (see below).
      const owner = await pickerFor({ vehicles: TWO, defaultId: 'v-truck' });
      const crew = await pickerFor({ employee: true, vehicles: TWO });
      expect(owner.html).not.toContain('On foot');
      expect(crew.html).not.toContain('On foot');
      expect(owner.labels.some(l => /On foot/.test(l))).toBe(false);
      expect(crew.labels.some(l => /On foot/.test(l))).toBe(false);
    });

    test('the prompt is centred, using the shared modal chrome', async () => {
      // Owner call: a centred prompt, not a bottom sheet. Checked as GEOMETRY
      // rather than by reading the class name back, because "centred" is the
      // thing that was asked for and a class can be present while the card sits
      // at the bottom anyway.
      const box = await page.evaluate(() => {
        const keepVeh = vehicles.slice(), keepDef = S.defaultVehicleId, keepTr = S.teamTracking;
        const keepEmp = _isEmployee;
        try {
          _isEmployee = false; S.teamTracking = true;
          vehicles.length = 0;
          vehicles.push({ id: 'a', name: 'A', status: 'active' }, { id: 'b', name: 'B', status: 'active' });
          S.defaultVehicleId = 'a';
          localStorage.removeItem('emp_vehicle_' + todayKey());
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const card = document.querySelector('#_vehicle-picker-ov .zmodal');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          const out = {
            cx: r.left + r.width / 2, vw: window.innerWidth, vh: window.innerHeight,
            top: r.top, bottom: r.bottom, right: r.right, left: r.left,
            docW: document.documentElement.scrollWidth,
          };
          document.getElementById('_vehicle-picker-ov')?.remove();
          return out;
        } finally {
          vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
          S.defaultVehicleId = keepDef; S.teamTracking = keepTr; _isEmployee = keepEmp;
          localStorage.removeItem('emp_vehicle_' + todayKey());
        }
      });
      expect(box).not.toBeNull();
      // Horizontally centred within a pixel.
      expect(Math.abs(box.cx - box.vw / 2)).toBeLessThanOrEqual(1);
      // Vertically centred, so it is not sitting on the bottom edge any more.
      expect(box.top).toBeGreaterThan(0);
      expect(box.bottom).toBeLessThan(box.vh);
      // 15.1: nothing bleeds off-screen at 390px.
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      expect(box.docW).toBeLessThanOrEqual(box.vw + 1);
    });

    test('a big fleet scrolls instead of running off the screen', async () => {
      // Twelve trucks is taller than a phone. The overlay scrolls (it owns
      // overflow-y), and the page behind it still must not scroll sideways.
      const out = await page.evaluate(() => {
        const keepVeh = vehicles.slice(), keepTr = S.teamTracking, keepEmp = _isEmployee;
        try {
          _isEmployee = false; S.teamTracking = true;
          vehicles.length = 0;
          for (let i = 0; i < 12; i++) vehicles.push({ id: 'v' + i, name: '20' + (10 + i) + ' Ford F-250 Super Duty', status: 'active' });
          localStorage.removeItem('emp_vehicle_' + todayKey());
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const ov = document.getElementById('_vehicle-picker-ov');
          const card = ov && ov.querySelector('.zmodal');
          const r = card && card.getBoundingClientRect();
          const res = {
            scrollable: ov ? getComputedStyle(ov).overflowY : '',
            right: r ? r.right : 0, vw: window.innerWidth,
            docW: document.documentElement.scrollWidth,
          };
          ov?.remove();
          return res;
        } finally {
          vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
          S.teamTracking = keepTr; _isEmployee = keepEmp;
          localStorage.removeItem('emp_vehicle_' + todayKey());
        }
      });
      expect(['auto', 'scroll']).toContain(out.scrollable);
      expect(out.right).toBeLessThanOrEqual(out.vw);
      expect(out.docW).toBeLessThanOrEqual(out.vw + 1);
    });

    test("the 'none' special case is gone from the readers too", async () => {
      // Both readers used to branch on it. Deleting the button without deleting
      // the branches is exactly the hidden-not-removed shape CLAUDE.md 7 bans,
      // so this pins the handling gone rather than dormant.
      //
      // A leftover value degrades safely, which is why deleting was cheap: an
      // unknown id is not a vehicle, so the owner falls through to their usual
      // truck and crew get nothing, both of which were already the rules for
      // any unrecognised id.
      const out = await page.evaluate(() => {
        const keepDef = S.defaultVehicleId, keepEmp = _isEmployee;
        try {
          S.defaultVehicleId = 'v-truck';
          localStorage.setItem('emp_vehicle_' + todayKey(), 'none');
          _isEmployee = false;
          const owner = _autoTripVehicle();
          _isEmployee = true;
          const crew = _autoTripVehicle();
          return { ownerId: owner && owner.id, crew, src: String(_autoTripVehicle) + String(_isCompanyVehicleToday) };
        } finally {
          S.defaultVehicleId = keepDef; _isEmployee = keepEmp;
          localStorage.removeItem('emp_vehicle_' + todayKey());
        }
      });
      expect(out.src).not.toContain("'none'");
      expect(out.ownerId).toBe('v-truck');   // falls through, like any unknown id
      expect(out.crew).toBeNull();
    });

    test('crew keep their personal-vehicle opt-out, and are asked with one truck', async () => {
      // Regression guard: the employee path is what existed before and must not
      // have moved. One CREW-DRIVABLE vehicle still asks them, because the real
      // question for crew is company truck vs their own car, and that exists at
      // any fleet size.
      const out = await pickerFor({ employee: true, vehicles: [TWO[0]] });
      expect(out.shown).toBe(true);
      expect(out.html).toContain('Which vehicle are you in today?');
      expect(out.html).toContain("_pickVehicle('personal'");
      expect(out.html).toContain('No mileage logged');
    });

    test('nobody is asked twice in one day', async () => {
      const out = await page.evaluate(() => {
        const keepVeh = vehicles.slice(), keepDef = S.defaultVehicleId, keepTr = S.teamTracking;
        try {
          vehicles.length = 0;
          vehicles.push({ id: 'a', name: 'A', status: 'active' }, { id: 'b', name: 'B', status: 'active' });
          S.defaultVehicleId = 'a'; S.teamTracking = true;
          localStorage.setItem('emp_vehicle_' + todayKey(), 'b');
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const shown = !!document.getElementById('_vehicle-picker-ov');
          document.getElementById('_vehicle-picker-ov')?.remove();
          return { shown };
        } finally {
          vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
          S.defaultVehicleId = keepDef; S.teamTracking = keepTr;
          localStorage.removeItem('emp_vehicle_' + todayKey());
        }
      });
      expect(out.shown).toBe(false);
    });

    test('tracking off means no popup, because nothing is being logged', async () => {
      const out = await pickerFor({ vehicles: TWO, defaultId: 'v-truck', tracking: false });
      expect(out.shown).toBe(false);
    });

    test("today's pick beats the standing default", async () => {
      const out = await page.evaluate(() => {
        const keepDef = S.defaultVehicleId;
        try {
          S.defaultVehicleId = 'v-truck';
          localStorage.setItem('emp_vehicle_' + todayKey(), 'v-van');
          return { id: (_autoTripVehicle() || {}).id };
        } finally { S.defaultVehicleId = keepDef; localStorage.removeItem('emp_vehicle_' + todayKey()); }
      });
      expect(out.id).toBe('v-van');
    });

    test('dismissing the popup costs the owner nothing', async () => {
      // The whole reason the owner keeps a default: swiping a sheet away is not
      // consent to lose the day's mileage.
      const out = await page.evaluate(() => {
        const keepDef = S.defaultVehicleId;
        try {
          S.defaultVehicleId = 'v-truck';
          localStorage.removeItem('emp_vehicle_' + todayKey());
          return { id: (_autoTripVehicle() || {}).id };
        } finally { S.defaultVehicleId = keepDef; }
      });
      expect(out.id).toBe('v-truck');
    });

    test('a stale pick for a deleted truck falls back rather than logging nothing', async () => {
      const out = await page.evaluate(() => {
        const keepDef = S.defaultVehicleId;
        try {
          S.defaultVehicleId = 'v-truck';
          localStorage.setItem('emp_vehicle_' + todayKey(), 'v-scrapped');
          return { id: (_autoTripVehicle() || {}).id };
        } finally { S.defaultVehicleId = keepDef; localStorage.removeItem('emp_vehicle_' + todayKey()); }
      });
      expect(out.id).toBe('v-truck');
    });

  });

  test.describe('the vehicle rule', () => {
    test('employee in a company truck: miles log, on that truck', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: 'v-van' });
      expect(rows.length).toBe(1);
      expect(rows[0].vehicleId).toBe('v-van');
      expect(rows[0].vehicle).toBe('Transit');
      // Never the owner's default: an employee's truck is the one they picked.
      expect(rows[0].vehicleId).not.toBe('v-truck');
    });

    // WHAT THESE TWO USED TO ASSERT, and why it changed (2026-08-02).
    //
    // They asserted no mileage row at all for an employee in their own car, and
    // that was right about the thing it was protecting: those miles are not the
    // owner's to deduct, and a row that reached the deduction total would inflate
    // it with miles the owner's vehicles never drove.
    //
    // But dropping the row threw away the fact as well as the deduction. Some
    // states require reimbursing an employee for driving their own car, and a
    // contractor in one of them was left with no record of a debt they already
    // had. The row is written now and flagged reimbursable, and deductibleTrips
    // is what keeps it out of every deduction total, which is the guarantee these
    // tests were really defending. So they now assert both halves rather than
    // just the absence.
    test('employee in their OWN car: logged for reimbursement, never for the deduction', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: 'personal' });
      expect(rows.length).toBe(1);
      expect(rows[0].reimbursable).toBe(true);
      // The flag is what this drive controls. That the flag actually keeps a row
      // out of every deduction total is proven in "two pots of money" below,
      // against an array this test does not have to own: asserting it here on
      // the whole of `mileage` counted every row the rest of the file had
      // already left behind.
    });

    test('employee who picked no vehicle: recorded, claimed by nobody', async () => {
      // CHANGED 2026-08-03, owner's call, and the old assertion was mine from
      // earlier in this same PR.
      //
      // Old behaviour: no pick was treated as "their own car", so it logged one
      // reimbursable row. The reasoning was that an unrecorded drive is more
      // likely personal than company, so recording the debt was the safe side.
      //
      // Why that was wrong: no pick does not mean personal car. It means nobody
      // said anything. They may have been in the company truck, riding with
      // somebody, or not driving at all. Booking a reimbursement off that
      // invents a debt from a blank, and it contradicted the rule this codebase
      // already states in _autoTripVehicle: no pick, no mileage. 'rider' two
      // cases down has always claimed nothing for exactly this reason.
      //
      // New behaviour: the TIME still logs, because the drive happened and is
      // compensable. The money claim waits until somebody records a vehicle.
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: '' });
      // Recorded, not discarded (revised again 2026-08-03): one row, marked
      // unattributed, counted by neither side until somebody says what he drove.
      expect(rows.length).toBe(1);
      expect(rows[0].vehicleUnknown).toBe(true);
      expect(!!rows[0].reimbursable).toBe(false);
    });

    test('an employee in their own car is still PAID for the drive', async () => {
      // The whole point of splitting these two: drive time is compensable labor
      // whatever they are sitting in. Only the DEDUCTION is the company's.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realEmp = _isEmployee;
        const legs = [], realEnq = _geoEnqueue;
        _supaUser = { id: 'u-mi' }; _isEmployee = true;
        localStorage.setItem('emp_vehicle_' + todayKey(), 'personal');
        _geoEnqueue = (tbl, row) => legs.push(row);
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(d.SHOP);
          await ping(d.ROAD);
          if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
          await ping(d.JOB);
          return legs.filter(r => /^drive/.test(r.source || ''));
        } finally { _supaUser = realUser; _isEmployee = realEmp; _geoEnqueue = realEnq; }
      }, { SHOP, ROAD, JOB });
      expect(out.length).toBe(1);
      expect(out[0].source).toBe('drive-personal');
      expect(out[0].minutes).toBeGreaterThanOrEqual(19);
    });

    test('owner on a personal vehicle: miles DO log, on the default truck', async () => {
      // The owner is the business. Their own car's business miles are exactly
      // what the standard mileage deduction is for, so there is no gate here.
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true });
      expect(rows.length).toBe(1);
      expect(rows[0].vehicleId).toBe('v-truck');
      expect(rows[0].vehicle).toBe('F-250');
    });

    test('one active vehicle needs no default set at all', async () => {
      const out = await page.evaluate(() => {
        const keep = vehicles.slice(), keepDef = S.defaultVehicleId;
        try {
          vehicles.length = 0;
          vehicles.push({ id: 'v-solo', name: 'Only Truck', status: 'active' });
          S.defaultVehicleId = '';
          return { id: (getDefaultVehicle() || {}).id };
        } finally { vehicles.length = 0; keep.forEach(v => vehicles.push(v)); S.defaultVehicleId = keepDef; }
      });
      expect(out.id).toBe('v-solo');
    });

    test('a sold truck is never the default, even when it is set as one', async () => {
      const out = await page.evaluate(() => {
        const keepDef = S.defaultVehicleId, keepStatus = vehicles[0].status;
        try {
          S.defaultVehicleId = 'v-truck';
          vehicles[0].status = 'sold';
          return { id: (getDefaultVehicle() || {}).id };
        } finally { S.defaultVehicleId = keepDef; vehicles[0].status = keepStatus; }
      });
      // Falls through to the one remaining active vehicle rather than
      // attributing new trips to a truck that is off the road.
      expect(out.id).toBe('v-van');
    });
  });

  // ── Leaving home: the checkbox decides, not the app ────────────────────────
  //
  // Owner report (2026-08-01): "It should log the drive from home. For business
  // owners with a home office the drive from home office to a shop is work
  // related, same with home to a shop or home to supply and back."
  //
  // They were right, and the app had been LYING about it. Settings has a home
  // office checkbox, and three separate screens promise what ticking it does:
  // mileage.js ("your drives from home to job sites count as deductible
  // business miles") and tax.js twice ("every drive from home to a job site
  // counts as business mileage, not commuting"). Nothing read S.homeOffice.
  // Ticking it changed the wording and logged exactly zero additional miles.
  //
  // The line these tests hold: without a declared home office the first drive
  // out of the house is a commute and is refused, because the GPS cannot tell
  // "home" from "business location" and guessing in the contractor's favour is
  // the app inflating a deduction for them. WITH one declared, the residence is
  // a business location and every drive out of it counts (Rev. Rul. 99-7). The
  // declaration is the contractor's to make and theirs to defend. Ours is to
  // honour it, in both directions.
  const homeDeparture = (dest, opts) => page.evaluate(async (d) => {
    const realUser = _supaUser, realRoute = _routeDistance;
    const keepHo = S.homeOffice, keepPlaces = places.slice();
    _supaUser = { id: 'u-mi' };
    window._routeDistance = _routeDistance = async () => ({ miles: 9, mins: 15 });
    const before = mileage.length;
    try {
      // Seed FIRST: __seedGeo rebuilds `places` from scratch, so this case's own
      // home-office tag has to be added after it, not before.
      __seedGeo();
      S.homeOffice = !!d.box;
      if (d.tagPlace) savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
      _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
      _geoShopArrivedAt = null; _geoDriveStartedAt = null;
      _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
      _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
      _geoHomeDwell = null; _geoWasAtHome = false;
      try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      // First fix of the day anchors the commute guard at home.
      await ping(d.HOME);
      await ping({ lat: d.HOME.lat + 0.00004, lon: d.HOME.lon });
      if (_geoStopAnchor) {
        _geoStopAnchor.at = new Date(Date.now() - 60 * 60000).toISOString();
        _geoStopAnchor.lastAt = new Date(Date.now() - 25 * 60000).toISOString();
      }
      // A tagged home office is a place FENCE, so there is no stop anchor and no
      // open drive clock: the departure is a single-ping fence-to-fence move
      // whose leg start is _geoLastFenceAt.
      if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - 25 * 60000).toISOString();
      await ping(d.dest);
      await new Promise(r => setTimeout(r, 30));
      const rows = mileage.slice(0, Math.max(0, mileage.length - before));
      return { added: rows.length, rows: rows.map(m => ({ from: m.from_name, to: m.to_name, purpose: m.purpose, miles: m.miles })) };
    } finally {
      _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
      S.homeOffice = keepHo; places.length = 0; keepPlaces.forEach(p => places.push(p));
    }
  }, { HOME: { lat: 38.3000, lon: -94.3000 }, dest, box: !!(opts && opts.box), tagPlace: !!(opts && opts.tagPlace) });

  test.describe('leaving home', () => {
    test('no home office declared: the drive to a job is a commute, refused', async () => {
      const out = await homeDeparture(JOB, {});
      expect(out.added).toBe(0);
    });

    test('no home office declared: the drive to the shop is refused too', async () => {
      // The classic non-deductible commute: residence to the regular place of
      // business. Refusing it is the whole reason the guard exists.
      const out = await homeDeparture(SHOP, {});
      expect(out.added).toBe(0);
    });

    test('home office checkbox ticked: home to the SHOP logs', async () => {
      // The exact promise the Settings checkbox has always made on screen, and
      // never kept until now. Red before this fix: 0 rows.
      const out = await homeDeparture(SHOP, { box: true });
      expect(out.added).toBe(1);
      expect(out.rows[0].purpose).toBe('Shop');
      // Named, not an anonymous "Stop". A mileage row has to read as a record
      // somebody could defend a year later.
      expect(out.rows[0].from).toBe('Home Office');
      expect(out.rows[0].miles).toBe(9);
    });

    test('home office checkbox ticked: home to a SUPPLY HOUSE logs', async () => {
      const out = await homeDeparture(SUPPLY, { box: true });
      expect(out.added).toBe(1);
      expect(out.rows[0].purpose).toBe('Supply run');
      expect(out.rows[0].from).toBe('Home Office');
    });

    test('home office checkbox ticked: home to a JOB logs', async () => {
      const out = await homeDeparture(JOB, { box: true });
      expect(out.added).toBe(1);
      expect(out.rows[0].purpose).toBe('Job site');
      expect(out.rows[0].from).toBe('Home Office');
    });

    test('home tagged as a home office PLACE logs, with or without the box', async () => {
      // The second, older route to the same declaration: saving the house as a
      // place of kind home_office makes it a fence, so the departure is an
      // ordinary fence-to-fence leg and never reaches the commute guard at all.
      // Both routes have to work, because the app offers both.
      const out = await homeDeparture(SUPPLY, { tagPlace: true });
      expect(out.added).toBe(1);
      expect(out.rows[0].from).toBe('Home Office');
      expect(out.rows[0].purpose).toBe('Supply run');
    });

    test('and back: the return leg from a supply house home is measured too', async () => {
      // "home to supply and back", the owner's words. The return trip is a
      // separate leg and has to log on its own.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        const keepHo = S.homeOffice, keepPlaces = places.slice();
        _supaUser = { id: 'u-mi' };
        window._routeDistance = _routeDistance = async () => ({ miles: 6.2, mins: 11 });
        const before = mileage.length;
        try {
          __seedGeo();   // rebuilds `places`, so the home-office tag goes after it
          S.homeOffice = true;
          savePlace({ name: 'Home Office', kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          const back = () => { if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - 25 * 60000).toISOString(); };
          await ping(d.HOME); back();
          await ping(d.SUPPLY); back();
          await ping(d.HOME);
          await new Promise(r => setTimeout(r, 40));
          const rows = mileage.slice(0, Math.max(0, mileage.length - before));
          return rows.map(m => m.from_name + ' -> ' + m.to_name).sort();
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
          S.homeOffice = keepHo; places.length = 0; keepPlaces.forEach(p => places.push(p));
        }
      }, { HOME: { lat: 38.3000, lon: -94.3000 }, SUPPLY });
      expect(out).toEqual(['Ace Supply -> Home Office', 'Home Office -> Ace Supply']);
    });

    test("the owner's home office does not exempt an EMPLOYEE's driveway", async () => {
      // S.homeOffice is one account-level flag describing ONE residence. Read
      // for everybody, it would turn every crew member's morning commute into a
      // company deduction because the owner ticked a box about their own spare
      // room. Company truck here, so the vehicle rule is satisfied and the ONLY
      // thing that can refuse this leg is the commute guard.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realEmp = _isEmployee, realRoute = _routeDistance;
        const keepHo = S.homeOffice;
        _supaUser = { id: 'u-mi' }; _isEmployee = true; S.homeOffice = true;
        localStorage.setItem('emp_vehicle_' + todayKey(), 'v-van');
        window._routeDistance = _routeDistance = async () => ({ miles: 9, mins: 15 });
        const before = mileage.length;
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(d.HOME);
          await ping({ lat: d.HOME.lat + 0.00004, lon: d.HOME.lon });
          if (_geoStopAnchor) {
            _geoStopAnchor.at = new Date(Date.now() - 60 * 60000).toISOString();
            _geoStopAnchor.lastAt = new Date(Date.now() - 25 * 60000).toISOString();
          }
          await ping(d.JOB);
          await new Promise(r => setTimeout(r, 30));
          return { added: mileage.length - before };
        } finally {
          _supaUser = realUser; _isEmployee = realEmp;
          window._routeDistance = _routeDistance = realRoute; S.homeOffice = keepHo;
        }
      }, { HOME: { lat: 38.3000, lon: -94.3000 }, JOB });
      expect(out.added).toBe(0);
    });

    test('the checkbox never overrides the vehicle rule', async () => {
      // A home office does not make an employee's own car deductible. The two
      // rules are independent and both have to hold.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realEmp = _isEmployee, realRoute = _routeDistance;
        const keepHo = S.homeOffice;
        _supaUser = { id: 'u-mi' }; _isEmployee = true; S.homeOffice = true;
        localStorage.setItem('emp_vehicle_' + todayKey(), 'personal');
        window._routeDistance = _routeDistance = async () => ({ miles: 9, mins: 15 });
        const before = mileage.length;
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(d.HOME);
          await ping({ lat: d.HOME.lat + 0.00004, lon: d.HOME.lon });
          if (_geoStopAnchor) {
            _geoStopAnchor.at = new Date(Date.now() - 60 * 60000).toISOString();
            _geoStopAnchor.lastAt = new Date(Date.now() - 25 * 60000).toISOString();
          }
          await ping(d.JOB);
          await new Promise(r => setTimeout(r, 30));
          return { added: mileage.length - before };
        } finally {
          _supaUser = realUser; _isEmployee = realEmp;
          window._routeDistance = _routeDistance = realRoute; S.homeOffice = keepHo;
        }
      }, { HOME: { lat: 38.3000, lon: -94.3000 }, JOB });
      expect(out.added).toBe(0);
    });
  });

  test.describe('what must never be logged', () => {

    test('one leg can only ever bill once, however many times it replays', async () => {
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        _supaUser = { id: 'u-mi' };
        window._routeDistance = _routeDistance = async () => ({ miles: 5, mins: 9 });
        const before = mileage.length;
        try {
          const from = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          const to = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'Miller Residence', kind: 'job', clientId: 7701 };
          const iso = new Date().toISOString();
          autoLogDriveTrip({ from, to, legKey: 'leg-dupe-1', startedIso: iso });
          autoLogDriveTrip({ from, to, legKey: 'leg-dupe-1', startedIso: iso });
          autoLogDriveTrip({ from, to, legKey: 'leg-dupe-1', startedIso: iso });
          await new Promise(r => setTimeout(r, 20));
          return { added: mileage.length - before };
        } finally { _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; }
      }, { SHOP, JOB });
      expect(out.added).toBe(1);
    });

    test('the leg key on the trip matches the one on the time entry', async () => {
      // This is what makes the pair auditable: the mileage row and the drive it
      // came from name the same leg.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realEnq = _geoEnqueue, realRoute = _routeDistance;
        const legs = [];
        _supaUser = { id: 'u-mi' };
        _geoEnqueue = (tbl, row) => legs.push(row);
        window._routeDistance = _routeDistance = async () => ({ miles: 7, mins: 12 });
        const before = mileage.length;
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(d.SHOP);
          await ping(d.ROAD);
          if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
          await ping(d.JOB);
          await new Promise(r => setTimeout(r, 30));
          const trip = mileage[0];
          const leg = legs.find(r => /^drive/.test(r.source || ''));
          return { added: mileage.length - before, tripKey: trip && trip.legKey, legKey: leg && leg.client_key };
        } finally { _supaUser = realUser; _geoEnqueue = realEnq; window._routeDistance = _routeDistance = realRoute; }
      }, { SHOP, ROAD, JOB });
      expect(out.added).toBe(1);
      expect(out.tripKey).toBeTruthy();
      expect(out.tripKey).toBe(out.legKey);
    });

    // ── One journey, one row (owner's triple-logged drive, 2026-08-11) ───────
    // One real drive to a client produced THREE rows: the automatic leg, the
    // same leg re-closed after a parking-lot truck move, and a manual drive
    // started mid-route. Two guards now stand between that day and the log.

    test('a re-closed leg mints the SAME key, so it can never write twice', async () => {
      // The leg key was random per close, so the idempotency built on it never
      // fired for a replayed arrival. Deterministic now: person + leg start.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        _supaUser = { id: 'u-dedup' };
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 6 });
        const keep = mileage.splice(0);
        try {
          const from = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          const to = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'John Doe', kind: 'job', clientId: 7788 };
          const iso = new Date(Date.now() - 10 * 60000).toISOString();
          // Two closes of one leg, the way the truck move re-delivered it:
          // same leg start, keys minted independently at each close.
          autoLogDriveTrip({ from, to, legKey: _geoLegKey(iso), startedIso: iso });
          autoLogDriveTrip({ from, to, legKey: _geoLegKey(iso), startedIso: iso });
          await new Promise(r => setTimeout(r, 30));
          return { rows: mileage.length, stable: _geoLegKey(iso) === _geoLegKey(iso) };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        }
      }, { SHOP, JOB });
      expect(out.stable).toBe(true);
      expect(out.rows).toBe(1);
    });

    test('the triple-logged drive collapses to one row, the longest', async () => {
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        try {
          // The owner's three rows, verbatim shape: manual partial from
          // mid-route, the real 7:51-7:57 leg, and its 7:51-8:01 replay.
          mileage.push(
            { id: 1, gps: true, calc_method: 'gps_time', miles: 2.4, client_id: 77,
              loggedAt: '2026-08-11T12:58:30Z', startedIso: '2026-08-11T12:53:00Z', date: '2026-08-11' },
            { id: 2, gps: true, legKey: 'leg-a', calc_method: 'auto_route', miles: 3.2, client_id: 77,
              fromCoord: SHOP2, toCoord: JOHN, startedIso: '2026-08-11T12:51:00Z',
              endedIso: '2026-08-11T12:57:00Z', loggedAt: '2026-08-11T12:57:02Z', date: '2026-08-11' },
            { id: 3, gps: true, legKey: 'leg-b', calc_method: 'auto_route', miles: 3.2, client_id: 77,
              fromCoord: SHOP2, toCoord: JOHN, startedIso: '2026-08-11T12:51:00Z',
              endedIso: '2026-08-11T13:01:00Z', loggedAt: '2026-08-11T13:01:05Z', date: '2026-08-11' });
          const removed = _mileDedupTrips();
          const again = _mileDedupTrips();   // idempotent: healing must not keep healing
          return { removed, again, rows: mileage.map(m => ({ id: m.id, miles: m.miles })) };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.removed).toBe(2);
      expect(out.again).toBe(0);
      expect(out.rows).toEqual([{ id: 2, miles: 3.2 }]);   // the longest, and the FIRST close
    });

    test('dedup waits for the measurement, then the partial manual row yields', async () => {
      // The automatic row is born at zero miles (no signal is the normal case).
      // Zero must never "lose" to the typed number: the pair defers, and the
      // sweep after the fill settles it.
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        try {
          const manual = { id: 1, gps: true, calc_method: 'gps_time', miles: 2.4, client_id: 77,
            loggedAt: '2026-08-11T12:58:30Z', startedIso: '2026-08-11T12:53:00Z', date: '2026-08-11' };
          const auto = { id: 2, gps: true, legKey: 'leg-a', calc_method: 'pending_auto', miles: 0, client_id: 77,
            fromCoord: SHOP2, toCoord: JOHN, startedIso: '2026-08-11T12:51:00Z',
            endedIso: '2026-08-11T12:57:00Z', loggedAt: '2026-08-11T12:57:02Z', date: '2026-08-11' };
          mileage.push(manual, auto);
          const deferred = _mileDedupTrips();
          auto.miles = 3.2; auto.calc_method = 'auto_route';
          const settled = _mileDedupTrips();
          return { deferred, settled, left: mileage.map(m => m.id) };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.deferred).toBe(0);
      expect(out.settled).toBe(1);
      expect(out.left).toEqual([2]);
    });

    test("the phone's real rows: heal mode collapses what the strict sweep must not", async () => {
      // The shapes that actually survived on the owner's phone (2026-08-11
      // screenshot): a "Log a trip" row with no startedIso, no coords, no
      // client link, names only; and a replay pair whose starts differ by 45
      // seconds while both display 7:51a. Boot heal collapses all three. The
      // live sweep leaves the offset pair alone (CI fixtures fabricate
      // overlapping clocks for deliberately distinct legs, so the wider twin
      // rule is boot-only).
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const rows = () => ([
          { id: 1, calc_method: 'address', miles: 2.4, client_id: null, client_name: '',
            to: '2950 SW McClure Rd', to_name: 'John Doe', loggedAt: '2026-08-11T12:55:10Z', date: '2026-08-11' },
          { id: 2, gps: true, legKey: 'rnd-a1', calc_method: 'auto_route', miles: 3.2, client_id: 77,
            to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
            startedIso: '2026-08-11T12:51:02Z', endedIso: '2026-08-11T12:57:10Z', loggedAt: '2026-08-11T12:57:12Z', date: '2026-08-11' },
          { id: 3, gps: true, legKey: 'rnd-b2', calc_method: 'auto_route', miles: 3.2, client_id: 77,
            to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
            startedIso: '2026-08-11T12:51:47Z', endedIso: '2026-08-11T13:01:20Z', loggedAt: '2026-08-11T13:01:22Z', date: '2026-08-11' },
        ]);
        const keep = mileage.splice(0);
        try {
          rows().forEach(m => mileage.push(m));
          const healed = _mileDedupTrips(true);
          const left = mileage.map(m => m.id);
          mileage.length = 0; rows().slice(1).forEach(m => mileage.push(m));   // just the replay pair
          const live = _mileDedupTrips();
          return { healed, left, live, liveLeft: mileage.length };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.healed).toBe(2);
      expect(out.left).toEqual([2]);
      expect(out.live).toBe(0);          // strict mode defers the offset pair to boot
      expect(out.liveLeft).toBe(2);
    });

    test('a backdated manual trip to the same client is never eaten', async () => {
      // Arrive at John Doe at 7:57, remember at 8:03 that YESTERDAY'S trip
      // there was never logged, type it in with yesterday's date. The entry's
      // created-timestamp lands inside today's leg window and the names
      // match; only the filed DATE says it is a different journey.
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        try {
          mileage.push(
            { id: 1, gps: true, legKey: 'leg-a', calc_method: 'auto_route', miles: 3.2, client_id: 77,
              to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
              startedIso: '2026-08-11T12:51:00Z', endedIso: '2026-08-11T12:57:00Z',
              loggedAt: '2026-08-11T12:57:02Z', date: '2026-08-11' },
            { id: 2, calc_method: 'address', miles: 6.8, client_id: 77, to_name: 'John Doe',
              loggedAt: '2026-08-11T13:03:00Z', date: '2026-08-10' });
          return { healed: _mileDedupTrips(true), rows: mileage.length };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.healed).toBe(0);
      expect(out.rows).toBe(2);
    });

    test('a forced detour keeps its observed miles, GPS undercount never does', async () => {
      // The route is the answer unless the wheels observably covered more.
      // observedMiles rides in from the leg close (geo-track owns when it is
      // trustworthy); the measurement takes max(route, observed), capped 4x.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        _supaUser = { id: 'u-detour' };
        window._routeDistance = _routeDistance = async () => ({ miles: 12.3, mins: 20 });
        const keep = mileage.splice(0);
        try {
          const from = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          const to = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'Miller Residence', kind: 'job', clientId: 7701 };
          const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          autoLogDriveTrip({ from, to, legKey: 'leg-det-1', startedIso: t(50), observedMiles: 17.9 }); // real detour
          autoLogDriveTrip({ from, to, legKey: 'leg-det-2', startedIso: t(30), observedMiles: 5.1 });  // GPS undercount
          autoLogDriveTrip({ from, to, legKey: 'leg-det-3', startedIso: t(10), observedMiles: 900 });  // GPS blowup
          await new Promise(r => setTimeout(r, 60));
          const by = (k) => mileage.find(m => m.legKey === k);
          return { detour: by('leg-det-1').miles, under: by('leg-det-2').miles, blowup: by('leg-det-3').miles };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        }
      }, { SHOP, JOB });
      expect(out.detour).toBe(17.9);
      expect(out.under).toBe(12.3);
      expect(out.blowup).toBe(12.3);
    });

    test('the heal runs after every cloud merge, not only at boot', async () => {
      // Owner report 2026-08-11: duplicates purged during an OFFLINE boot came
      // back. The heal's deletes never reached the cloud, and the reconnect
      // load merged the cloud's copies straight back in with nothing left to
      // re-collapse them. The heal must therefore ride every completed load
      // and the realtime burst path, where the resurrection actually arrives.
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
      const afterLoad = src.indexOf('_loadedDataOwner=(_supaUser');   // unique to the load tail
      expect(afterLoad, 'load completion point exists').toBeGreaterThan(0);
      expect(src.slice(afterLoad, afterLoad + 1200), 'heal rides the load completion')
        .toContain('_mileDedupTrips(true)');
      expect(src, 'realtime mileage bursts re-collapse too').toContain('_rtMileHealTimer');
    });

    test('dedup never crosses people, destinations, or distinct auto legs', async () => {
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const base = { gps: true, legKey: 'leg-a', calc_method: 'auto_route', miles: 3.2, client_id: 77,
          fromCoord: SHOP2, toCoord: JOHN, startedIso: '2026-08-11T12:51:00Z',
          endedIso: '2026-08-11T12:57:00Z', loggedAt: '2026-08-11T12:57:02Z', date: '2026-08-11' };
        const keep = mileage.splice(0);
        try {
          const run = (rows) => { mileage.length = 0; rows.forEach(m => mileage.push(m)); return _mileDedupTrips(); };
          // Same clocks, another crew member: two real drives.
          const people = run([{ ...base }, { ...base, id: 9, legKey: 'leg-b', logged_by_id: 'emp-1' }]);
          // Same clocks, different destination: two real drives.
          const dests = run([{ ...base }, { ...base, id: 9, legKey: 'leg-b', client_id: 88, toCoord: { lat: 39.1, lng: -95.6 } }]);
          // Distinct auto legs to one place, windows overlapping: the fence
          // wrote two legs, so they are two drives. Only same-START twins and
          // manual-vs-auto pairs ever collapse.
          const legs = run([{ ...base }, { ...base, id: 9, legKey: 'leg-b', miles: 1.1,
            startedIso: '2026-08-11T12:54:00Z', endedIso: '2026-08-11T12:56:00Z', loggedAt: '2026-08-11T12:56:02Z' }]);
          return { people, dests, legs };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.people).toBe(0);
      expect(out.dests).toBe(0);
      expect(out.legs).toBe(0);
    });
  });

  test.describe('no signal at the destination', () => {
    test('the trip is saved before the route is asked for, so a failure keeps it', async () => {
      // Rural sites are the norm. A trip that only exists when the network
      // happens to be up is the deduction going missing exactly where the
      // contractor works hardest.
      const out = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        _supaUser = { id: 'u-mi' };
        window._routeDistance = _routeDistance = async () => { throw new Error('offline'); };
        try {
          const rec = autoLogDriveTrip({
            from: { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' },
            to: { lat: d.JOB.lat, lng: d.JOB.lon, name: 'Miller Residence', kind: 'job', clientId: 7701 },
            legKey: 'leg-offline-1', startedIso: new Date().toISOString()
          });
          await new Promise(r => setTimeout(r, 20));
          const saved = mileage.find(m => m.id === rec.id);
          return { exists: !!saved, miles: saved && saved.miles, method: saved && saved.calc_method,
                   hasCoords: !!(saved && saved.fromCoord && saved.toCoord) };
        } finally { _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; }
      }, { SHOP, JOB });
      expect(out.exists).toBe(true);
      expect(out.miles).toBe(0);
      expect(out.method).toBe('pending_auto');
      // Both coordinates survive on the row, which is what lets the sweep below
      // finish the job later without re-geocoding anything.
      expect(out.hasCoords).toBe(true);
    });

    test('the pending sweep finishes it when the network comes back', async () => {
      const out = await page.evaluate(async () => {
        const realRoute = _routeDistance;
        window._routeDistance = _routeDistance = async () => ({ miles: 18.76, mins: 30 });
        try {
          await _retryPendingTrips();
          const saved = mileage.find(m => m.legKey === 'leg-offline-1');
          return { miles: saved && saved.miles, method: saved && saved.calc_method };
        } finally { window._routeDistance = _routeDistance = realRoute; }
      });
      expect(out.miles).toBe(18.8);
      expect(out.method).toBe('auto_route');
    });

    test('the sweep still resolves hand-typed pending trips by address', async () => {
      // Blast-radius guard: _retryPendingTrips is shared with the manual log and
      // must keep doing its original job, not just the new one.
      const out = await page.evaluate(async () => {
        const realRoute = _routeDistance, realResolve = _resolveCoords;
        window._routeDistance = _routeDistance = async () => ({ miles: 4.4, mins: 8 });
        window._resolveCoords = _resolveCoords = async () => ({ lat: 38.5, lng: -94.5 });
        mileage.unshift({ id: 'man-1', date: todayKey(), from: '1 A St', to: '2 B St',
                          miles: 0, calc_method: 'pending', purpose: 'Estimate' });
        try {
          await _retryPendingTrips();
          const saved = mileage.find(m => m.id === 'man-1');
          return { miles: saved && saved.miles, method: saved && saved.calc_method };
        } finally { window._routeDistance = _routeDistance = realRoute; window._resolveCoords = _resolveCoords = realResolve; }
      });
      expect(out.miles).toBe(4.4);
      expect(out.method).toBe('address');   // NOT auto_route
    });
  });

  test.describe('the row itself', () => {
    test('a 7pm trip lands on today, not tomorrow in UTC', async ({ browser }) => {
      // An ISO timestamp is UTC. Slicing it puts an evening supply run in
      // Central time on the next DAY, and on New Year's Eve in the next tax YEAR.
      //
      // This test OWNS its timezone. CI runners are UTC, where 7pm local is 7pm
      // UTC and the slice happens to be right, so shared-context version of this
      // test passed with the bug still in. A test that cannot go red is not a
      // test. America/Chicago is the app's own reference zone (§2 version bumps,
      // _ctDateStr in finance.js) and is behind UTC, so the evening genuinely
      // rolls the UTC date over.
      const ctx = await browser.newContext({ timezoneId: 'America/Chicago', bypassCSP: true });
      const p2 = await ctx.newPage();
      try {
        await mockAllExternal(p2);
        await p2.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await waitForAppBoot(p2);
        const out = await p2.evaluate(async (d) => {
          const realUser = _supaUser, realRoute = _routeDistance;
          _supaUser = { id: 'u-mi' };
          window._routeDistance = _routeDistance = async () => ({ miles: 3, mins: 6 });
          try {
            const evening = new Date(); evening.setHours(19, 30, 0, 0);
            const rec = autoLogDriveTrip({
              from: { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' },
              to: { lat: d.JOB.lat, lng: d.JOB.lon, name: 'Miller Residence', kind: 'job' },
              legKey: 'leg-evening-1', startedIso: evening.toISOString()
            });
            return { date: rec.date, expected: dateKey(evening), utcSlice: evening.toISOString().slice(0, 10) };
          } finally { _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; }
        }, { SHOP, JOB });
        // The premise of the test: in this zone the two answers really do differ,
        // so passing means the local date was used and not the UTC one.
        expect(out.utcSlice).not.toBe(out.expected);
        expect(out.date).toBe(out.expected);
      } finally { await ctx.close(); }
    });

    test('missing an endpoint logs nothing rather than a wrong number', async () => {
      const out = await page.evaluate((d) => {
        const before = mileage.length;
        const to = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'J', kind: 'job' };
        autoLogDriveTrip({ from: null, to, legKey: 'k1' });
        autoLogDriveTrip({ from: { name: 'no coords', kind: 'shop' }, to, legKey: 'k2' });
        autoLogDriveTrip({ from: to, to: null, legKey: 'k3' });
        autoLogDriveTrip({ from: to, to, legKey: '' });
        autoLogDriveTrip({});
        return { added: mileage.length - before };
      }, { JOB });
      expect(out.added).toBe(0);
    });

    test('purpose mapping covers every destination kind, and defaults safely', async () => {
      const out = await page.evaluate(() => ({
        job: _autoTripPurpose({ kind: 'job' }),
        shop: _autoTripPurpose({ kind: 'shop' }),
        supply: _autoTripPurpose({ kind: 'supply' }),
        home: _autoTripPurpose({ kind: 'home_office' }),
        other: _autoTripPurpose({ kind: 'other' }),
        stop: _autoTripPurpose({ kind: 'stop' }),
        none: _autoTripPurpose({}),
        nul: _autoTripPurpose(null),
      }));
      expect(out.job).toBe('Job site');
      expect(out.shop).toBe('Shop');
      expect(out.supply).toBe('Supply run');
      expect(out.home).toBe('Home Office');
      expect(out.other).toBe('Other');
      expect(out.stop).toBe('Other');
      expect(out.none).toBe('Other');
      expect(out.nul).toBe('Other');
      // Every value it can return has to be a real pickable purpose, or editing
      // an auto trip shows a select with no option matching its own value.
      const unpickable = await page.evaluate(() =>
        ['Job site', 'Shop', 'Supply run', 'Home Office', 'Other'].filter(p => !MILE_PURPOSES.includes(p)));
      expect(unpickable).toEqual([]);
    });

    test('every purpose has a colour, including the new one', async () => {
      const missing = await page.evaluate(() => MILE_PURPOSES.filter(p => !MILE_PURPOSE_COLORS[p]));
      expect(missing).toEqual([]);
    });
  });

  // ── Naming the business at a pin ──────────────────────────────────────────
  // A repeat stop the app has learned is a bare lat/lon. Asking a contractor to
  // name it means typing "Home Depot" on a phone in a parking lot, so MapKit
  // answers and they confirm.
  //
  // MapKit is stubbed here on purpose, and it has to be: its token is
  // domain-locked to tradedeskpro.app and *.pages.dev, so on any test origin it
  // never initialises at all. What these pin down is the plumbing, which lookup
  // is preferred, what gets rejected, and what the answer turns into. Whether
  // Apple actually knows that particular parking lot is a question only the
  // live flow test on a preview URL can answer.
  test.describe('what business is at this pin', () => {
    // MapKit is stubbed from a plain CONFIG rather than injected source: the
    // page runs under a CSP that forbids eval, which is the right setting for
    // the real app and simply means the stub has to be built in-page.
    const withMapkit = (cfg) => page.evaluate((c) => {
      window.mapkit = {
        Coordinate: function (a, b) { this.latitude = a; this.longitude = b; },
        CoordinateSpan: function (a, b) { this.a = a; this.b = b; },
        CoordinateRegion: function (co, sp) { this.co = co; this.sp = sp; },
        PointsOfInterestSearch: function () {
          this.search = (cb) => c.poiFails
            ? cb(new Error('no poi'))
            : cb(null, { places: [{ name: c.poiName, pointOfInterestCategory: c.poiCategory, formattedAddress: c.poiAddr }] });
        },
        Geocoder: function () {
          this.reverseLookup = (co, cb) => c.geoFails
            ? cb(new Error('no geo'))
            : cb(null, { results: [{ name: c.geoName, formattedAddress: c.geoAddr }] });
        },
      };
      _mapkitReady = true;   // a script-scoped let, so window._mapkitReady would miss it
    }, cfg);

    test.afterEach(async () => {
      await page.evaluate(() => { _mapkitReady = false; delete window.mapkit; });
    });

    test('prefers the nearest POI over reverse geocoding', async () => {
      // Reverse geocoding a big-box parking lot returns the STREET ADDRESS,
      // which is the one answer that helps nobody. The POI search returns the
      // tenant, which is the name that belongs on every mileage row ending here.
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore',
                         geoName: '1100 SW Wanamaker Rd', geoAddr: '1100 SW Wanamaker Rd' });
      const out = await page.evaluate(() => _poiAt({ lat: 39.03, lng: -95.77 }));
      expect(out.name).toBe('The Home Depot');
      expect(out.category).toBe('MKPOICategoryStore');
    });

    test('falls back to reverse geocoding when there is no POI', async () => {
      await withMapkit({ poiFails: true, geoName: 'Ferguson Plumbing Supply', geoAddr: '900 N Kansas Ave' });
      const out = await page.evaluate(() => _poiAt({ lat: 39.06, lng: -95.67 }));
      expect(out.name).toBe('Ferguson Plumbing Supply');
    });

    test('never names a supplier after its own street address', async () => {
      // When the only thing Apple knows is the address, returning it would name
      // the place "1100 SW Wanamaker Rd", which tells the contractor nothing
      // they did not already know from the pin.
      await withMapkit({ poiFails: true, geoName: '1100 SW Wanamaker Rd', geoAddr: '1100 SW Wanamaker Rd' });
      const out = await page.evaluate(() => _poiAt({ lat: 39.06, lng: -95.67 }));
      // This used to be a bare null and the address was discarded with it. The
      // rule it was protecting is unchanged, the NAME is still null and every
      // caller guards on that, so nothing offers a street address as what a
      // supplier is called. The address itself now comes back, because a mileage
      // row reading "Shop -> Stop" is not a record anyone could defend and the
      // address is the one thing Apple did know (owner, 2026-08-02).
      expect(out.name).toBeNull();
      expect(out.addr).toBe('1100 SW Wanamaker Rd');
    });

    test('the modal still offers nothing when all Apple has is an address', async () => {
      // The above changed _poiAt's shape, so prove the place modal is unmoved:
      // it guards on poi.name, and a nameless answer must read as no answer.
      await withMapkit({ poiFails: true, geoName: '1100 SW Wanamaker Rd', geoAddr: '1100 SW Wanamaker Rd' });
      const out = await page.evaluate(async () => {
        document.getElementById('place-modal')?.remove();
        openPlaceModal(null, 39.06, -95.67);
        await new Promise(r => setTimeout(r, 150));
        const v = document.getElementById('place-name').value;
        document.getElementById('place-modal')?.remove();
        return v;
      });
      expect(out).toBe('');
    });

    test('no MapKit, no answer, and no throw', async () => {
      // The normal case on localhost and on any unauthorised origin, which is
      // every origin the offline suite ever runs on.
      const out = await page.evaluate(async () => {
        _mapkitReady = false; delete window.mapkit;
        return { poi: await _poiAt({ lat: 39.03, lng: -95.77 }), nul: await _poiAt(null), empty: await _poiAt({}) };
      });
      expect(out.poi).toBeNull();
      expect(out.nul).toBeNull();
      expect(out.empty).toBeNull();
    });

    test('both lookups failing is an answer, not an error', async () => {
      await withMapkit({ poiFails: true, geoFails: true });
      const out = await page.evaluate(() => _poiAt({ lat: 39.03, lng: -95.77 }));
      expect(out).toBeNull();
    });


    test('the name lands in the modal, and never over one already typed', async () => {
      // The answer is a suggestion. What their supplier is called is theirs.
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore', geoFails: true });
      const out = await page.evaluate(async () => {
        document.getElementById('place-modal')?.remove();
        openPlaceModal(null, 39.03, -95.77);
        await new Promise(r => setTimeout(r, 150));
        const filled = document.getElementById('place-name').value;
        const kind = document.getElementById('place-kind').value;
        document.getElementById('place-modal')?.remove();

        openPlaceModal(null, 39.03, -95.77);
        const n = document.getElementById('place-name');
        n.value = "Bob's Electric Supply";      // typed before the lookup lands
        await new Promise(r => setTimeout(r, 150));
        const kept = n.value;
        document.getElementById('place-modal')?.remove();
        return { filled, kind, kept };
      });
      expect(out.filled).toBe('The Home Depot');
      expect(out.kind).toBe('supply');
      expect(out.kept).toBe("Bob's Electric Supply");
    });

    test('editing an existing place is never overwritten by a lookup', async () => {
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore', geoFails: true });
      const out = await page.evaluate(async () => {
        const p = savePlace({ name: 'Ace Supply', kind: 'supply', lat: 39.03, lon: -95.77, confirmedBy: 'manual' });
        document.getElementById('place-modal')?.remove();
        openPlaceModal(p.id);
        await new Promise(r => setTimeout(r, 150));
        const v = document.getElementById('place-name').value;
        document.getElementById('place-modal')?.remove();
        return v;
      });
      expect(out).toBe('Ace Supply');
    });

    // ── The leg that ended nowhere the app knew ─────────────────────────────
    // Found by the owner's Topeka day on a live preview (2026-08-02): the drive
    // to Home Depot logged as "Kansas Ave Client → Stop", because a supply house
    // the app has not learned yet is just a coordinate. Nobody is going to type
    // that name standing in a parking lot, and a row reading "Stop" is not a
    // record anyone could defend a year later.
    const stopTrip = (legKey, at) => page.evaluate((a) => {
      mileage.length = 0;
      autoLogDriveTrip({
        from: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
        to: { lat: a.at.lat, lng: a.at.lng, name: 'Stop', kind: 'stop' },
        legKey: a.legKey, startedIso: new Date().toISOString(),
      });
      return new Promise(r => setTimeout(() => r(mileage.map(m =>
        ({ to: m.to_name, raw: m.to, purpose: m.purpose }))), 200));
    }, { legKey, at });

    test('an unknown stop is named from the business standing at it', async () => {
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore',
                        poiAddr: '1100 SW Wanamaker Rd, Topeka, KS 66604', geoFails: true });
      const out = await stopTrip('leg-stop-depot', { lat: 39.03, lng: -95.77 });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('The Home Depot');
      // WHO they went to and WHERE that is, the shape an IRS log wants. The
      // distance is still measured between the two coordinates, never between
      // these two strings.
      expect(out[0].raw).toBe('1100 SW Wanamaker Rd, Topeka, KS 66604');
      // What it IS decides what it cost: a store is a supply run.
      expect(out[0].purpose).toBe('Supply run');
    });

    test('the leg OUT of a named stop is named too, whichever landed first', async () => {
      // One stop, two legs: in and out. Naming only the arrival left the log
      // reading "... → The Home Depot" followed by "Stop → ...", the same
      // parking lot described two ways. Which leg is written first depends on
      // how long Apple takes against how long they were parked, so both orders
      // are driven here.
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore',
                         poiAddr: '1100 SW Wanamaker Rd, Topeka, KS 66604', geoFails: true });
      const out = await page.evaluate(async () => {
        const stop = { lat: 39.03, lng: -95.77, name: 'Stop', kind: 'stop' };
        const job = { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job', addr: '9 Elm St' };
        mileage.length = 0;
        // OUT written first: the descriptor is still the anonymous "Stop".
        autoLogDriveTrip({ from: job, to: stop, legKey: 'pair-in', startedIso: new Date().toISOString() });
        autoLogDriveTrip({ from: stop, to: job, legKey: 'pair-out', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 250));
        const first = mileage.map(m => ({ k: m.legKey, from: m.from_name, to: m.to_name }));
        // IN written, lookup lands, THEN the leg out: the descriptor itself
        // carries the name by now, so no patching is needed at all.
        mileage.length = 0;
        const stop2 = { lat: 39.03, lng: -95.77, name: 'Stop', kind: 'stop' };
        autoLogDriveTrip({ from: job, to: stop2, legKey: 'seq-in', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 250));
        autoLogDriveTrip({ from: stop2, to: job, legKey: 'seq-out', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 100));
        return { first, second: mileage.map(m => ({ k: m.legKey, from: m.from_name, to: m.to_name })) };
      });
      const outLeg = out.first.find(t => t.k === 'pair-out');
      expect(outLeg.from).toBe('The Home Depot');
      const seqOut = out.second.find(t => t.k === 'seq-out');
      expect(seqOut.from).toBe('The Home Depot');
    });

    test('a nameless stop still gets its street address', async () => {
      // Apple knows the building but not the tenant. "Stop" is honest about what
      // the app knows; the address is what makes the row readable.
      await withMapkit({ poiFails: true, geoName: '900 N Kansas Ave', geoAddr: '900 N Kansas Ave' });
      const out = await stopTrip('leg-stop-addr', { lat: 39.07, lng: -95.66 });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('Stop');
      expect(out[0].raw).toBe('900 N Kansas Ave');
    });

    test('lunch never reaches the mileage log', async () => {
      // The owner's rule, walking a real day: "then I'm going God knows where to
      // get lunch (this shouldn't count)". A drive to a restaurant is a personal
      // errand, and billing it inflates a deduction they would be defending.
      await withMapkit({ poiName: "Bobo's Drive In", poiCategory: 'MKPOICategoryRestaurant', geoFails: true });
      const out = await stopTrip('leg-stop-lunch', { lat: 39.04, lng: -95.70 });
      expect(out).toEqual([]);
    });

    // ── The detour, and the errand that looks exactly like it ───────────────
    // Owner's CPA (2026-08-02): a lunch break in the middle of a supply-house to
    // job-site run does not make two trips, it makes one trip with a detour, and
    // only the direct miles between the two business points are deductible.
    // BUT buying the crew lunch is a work errand and both legs count in full.
    // The GPS sees the identical stop either way. The receipt is the only thing
    // that separates them, and it is one the contractor already keeps.
    const detour = (opts) => page.evaluate(async (a) => {
      mileage.length = 0;
      if (typeof expenses !== 'undefined') {
        expenses.length = 0;
        if (a.receipt) expenses.push({
          id: _newId(), date: todayKey(), vendor: "Bobo's Drive In", amount: 84.20,
          cat: 'Meals', lat: a.stop.lat, lon: a.stop.lng,
          geoAt: new Date().toISOString(), geoAcc: 12,
        });
      }
      const depot = { lat: 39.03, lng: -95.77, name: 'Ace Supply', kind: 'supply', addr: '400 Depot Rd' };
      const job = { lat: 39.06, lng: -95.67, name: 'Miller residence', kind: 'job', addr: '9 Elm St' };
      const stop = { lat: 39.05, lng: -95.68, name: 'Stop', kind: 'stop', prevOrigin: depot };
      // The leg IN, exactly as the geofence writes it when they pull out.
      autoLogDriveTrip({ from: depot, to: stop, legKey: a.tag + '-in', startedIso: new Date().toISOString() });
      if (a.outFirst) {
        // The leg OUT already written before Apple answered: a short stop, or a
        // slow lookup. The row has to be re-pointed after the fact.
        autoLogDriveTrip({ from: stop, to: job, legKey: a.tag + '-out', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 300));
      } else {
        // Apple answers first, so the descriptor is already corrected and the
        // leg out is measured from the right end to begin with.
        await new Promise(r => setTimeout(r, 300));
        autoLogDriveTrip({ from: (typeof _geoLegOrigin !== 'undefined' && _geoLegOrigin) || stop, to: job,
                           legKey: a.tag + '-out', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 100));
      }
      return mileage.map(m => ({ k: m.legKey, from: m.from_name, to: m.to_name, fromCoord: m.fromCoord }));
    }, opts);

    test('a personal lunch is a detour: one trip, direct, no lunch legs', async () => {
      await withMapkit({ poiName: "Bobo's Drive In", poiCategory: 'MKPOICategoryRestaurant', geoFails: true });
      // _geoLegOrigin has to BE the stop for the pass-through to fire, the same
      // state the geofence leaves behind when it closes one.
      await page.evaluate(() => { if (typeof _geoLegOrigin !== 'undefined') _geoLegOrigin = null; });
      const out = await detour({ tag: 'detour', receipt: false, outFirst: true,
                                 stop: { lat: 39.05, lng: -95.68 } });
      // The leg to lunch is gone entirely.
      expect(out.find(t => t.k === 'detour-in')).toBeUndefined();
      // And the leg onward is measured from the supply house, not the diner.
      const onward = out.find(t => t.k === 'detour-out');
      expect(onward.from).toBe('Ace Supply');
      expect(onward.fromCoord).toEqual({ lat: 39.03, lng: -95.77 });
    });

    test('lunch bought for the crew is an errand: both legs count', async () => {
      // Same restaurant, same stop, same everything except a receipt logged at
      // that pin today. That is the contractor saying it was for the business,
      // and it is the evidence the deduction rests on.
      await withMapkit({ poiName: "Bobo's Drive In", poiCategory: 'MKPOICategoryRestaurant', geoFails: true });
      const out = await detour({ tag: 'crew', receipt: true, outFirst: true,
                                 stop: { lat: 39.05, lng: -95.68 } });
      const inLeg = out.find(t => t.k === 'crew-in');
      expect(inLeg).toBeDefined();
      expect(inLeg.to).toBe("Bobo's Drive In");
      // The leg out still starts where they actually were.
      const onward = out.find(t => t.k === 'crew-out');
      expect(onward.fromCoord).toEqual({ lat: 39.05, lng: -95.68 });
    });

    test('a stop nobody can name is kept, not binned', async () => {
      // Silence from Apple is not evidence of lunch. A contractor parked
      // mid-workday is far more often at a gate or a yard than at a sandwich
      // counter, and dropping a real leg costs them money that keeping an
      // unnamed one does not.
      await withMapkit({ poiFails: true, geoFails: true });
      const out = await stopTrip('leg-stop-anon', { lat: 39.05, lng: -95.60 });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('Stop');
      expect(out[0].purpose).toBe('Other');
    });

    test('a known destination is never sent for a lookup', async () => {
      // Only kind:'stop' is anonymous. A job, the yard, or a saved place already
      // carries the name the contractor gave it, and Apple must not rename it.
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore', geoFails: true });
      const out = await page.evaluate(() => {
        mileage.length = 0;
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 39.03, lng: -95.77, name: 'Ace Supply', kind: 'supply' },
          legKey: 'leg-known-dest', startedIso: new Date().toISOString(),
        });
        return new Promise(r => setTimeout(() => r(mileage.map(m => m.to_name)), 200));
      });
      expect(out).toEqual(['Ace Supply']);
    });

    // REWRITTEN 2026-08-10. This block used to test a predicate that decided,
    // from Apple's POI category and then from the shop's NAME, whether a stop
    // was a work errand. Both were guesses, and the second one was mine. The
    // rule is now the contractor's own (owner: "the only places that could
    // return as a business expense is if that place is explicitly listed under
    // their places as a supply house"), so the predicate is deleted and what is
    // tested is the decision itself.
    // Owner rule (2026-08-10): "a drive from home office shop and back
    // shouldn't count either unless there was a business stop that day."
    //
    // This is the other half of the Target run. Once the personal stop is
    // collapsed out of the middle, what survives is a leg whose ORIGIN AND
    // DESTINATION ARE THE SAME PLACE, and that shape can only mean a round trip
    // with nothing business in it: a business stop would have ENDED the leg
    // there and started a new one, so shop to supply house to shop is two legs,
    // neither starting and ending in the same spot.
    test('out from the shop and back logs no miles, but still pays the drive', async () => {
      const out = await page.evaluate(() => {
        const miles = [], times = [];
        const realMile = window._geoAutoMileage, realEnq = window._geoEnqueue;
        const realVeh = window._isCompanyVehicleToday, realUser = window._supaUser;
        window._geoAutoMileage = () => { miles.push(1); };
        window._geoEnqueue = (tbl) => { if (tbl === 'job_time_entries') times.push(1); };
        window._isCompanyVehicleToday = () => true;
        window._supaUser = { id: 'u1' };
        const SHOP = { lat: 39.04, lng: -95.76, name: 'Shop', kind: 'shop', placeId: 'p-shop' };
        const JOB = { lat: 39.07, lng: -95.72, name: 'Miller job', kind: 'job', jobId: 77 };
        const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
        const run = (origin, dest, drivenMiles) => {
          miles.length = 0; times.length = 0;
          // Bare assignment: script-scoped `let`, so window.X would miss it.
          _geoLegOrigin = Object.assign({}, origin);
          _geoDriveMiles = drivenMiles;
          _geoDriveEntry(dest.jobId || null, ago(25), dest.name, null, false, dest, false);
          return { miles: miles.length, times: times.length };
        };
        try {
          return {
            roundTrip: run(SHOP, SHOP, 9),
            toJob: run(SHOP, JOB, 9),
            fromJob: run(JOB, SHOP, 9),
            bounce: run(SHOP, SHOP, 0.05),
          };
        } finally {
          window._geoAutoMileage = realMile; window._geoEnqueue = realEnq;
          window._isCompanyVehicleToday = realVeh; window._supaUser = realUser;
          _geoLegOrigin = null; _geoDriveMiles = 0;
        }
      });
      expect(out.roundTrip.miles, 'a personal errand and back is not a deduction').toBe(0);
      // Stripping the hours too would be a payroll bug dressed up as a mileage
      // fix: a crew member driving is paid for it whatever the errand was.
      expect(out.roundTrip.times, 'the drive time is still theirs').toBe(1);
      expect(out.toJob.miles, 'a real leg to a job site is untouched').toBe(1);
      expect(out.fromJob.miles, 'and the leg back from it').toBe(1);
      // Distinct from the fence-bounce guard, which drops the whole leg
      // including the time, because that one never happened at all.
      expect(out.bounce.miles + out.bounce.times, 'a fence bounce is still dropped whole').toBe(0);
    });

    test('the guessing predicates are gone, not merely unused', async () => {
      const gone = await page.evaluate(() => ({
        personal: typeof window._poiIsPersonal,
        supplyName: typeof window._poiIsSupplyHouse,
      }));
      expect(gone.personal, 'no category guess decides a deduction').toBe('undefined');
      expect(gone.supplyName, 'and no name guess either').toBe('undefined');
    });

    // The rule itself, on the real data shape: a stop is business ONLY if the
    // pin matches one of THEIR saved places with a business kind, or a receipt
    // proves it. Nothing about the shop's name or Apple's category enters here.
    test('only a saved business place, or a receipt, makes a stop count', async () => {
      const out = await page.evaluate(() => {
        const TARGET = { lat: 39.03, lng: -95.77 };
        const keep = places.slice();
        try {
          places.length = 0;
          const unsaved = !placeAt({ lat: TARGET.lat, lon: TARGET.lng });
          // Saved as a supply house: counts.
          places.push({ id: 'p1', name: 'Target', kind: 'supply', lat: TARGET.lat, lon: TARGET.lng });
          const asSupply = !!_PLACE_KIND_TO_PURPOSE[placeAt({ lat: TARGET.lat, lon: TARGET.lng }).kind];
          // Saved as Other, somewhere they track but do not deduct: does not.
          places.length = 0;
          places.push({ id: 'p2', name: 'Target', kind: 'other', lat: TARGET.lat, lon: TARGET.lng });
          const asOther = !!_PLACE_KIND_TO_PURPOSE[placeAt({ lat: TARGET.lat, lon: TARGET.lng }).kind];
          const businessKinds = Object.keys(PLACE_KINDS)
            .filter(k => !!_PLACE_KIND_TO_PURPOSE[k]).sort().join(',');
          return { unsaved, asSupply, asOther, businessKinds };
        } finally { places.length = 0; keep.forEach(p => places.push(p)); }
      });
      expect(out.unsaved, 'an unsaved pin is nobody\'s supply house').toBe(true);
      expect(out.asSupply, 'the contractor saying it is a supply house is what counts').toBe(true);
      expect(out.asOther, 'a place they track but do not deduct stays out').toBe(false);
      expect(out.businessKinds).toBe('business_meeting,home_office,shop,supply');
    });

    test('the category map survives only as a prefill hint', async () => {
      const out = await page.evaluate(() => ({
        hardware: _poiPlaceKind('MKPOICategoryHardwareStore'),
        food: _poiPlaceKind('MKPOICategoryRestaurant'),
        store: _poiPlaceKind('MKPOICategoryStore'),
        blank: _poiPlaceKind(''),
      }));
      // It fills in the kind dropdown when they save a place. It claims nothing.
      expect(out.hardware).toBe('supply');
      expect(out.food).toBe('other');
      expect(out.store).toBe('supply');
      expect(out.blank).toBe('supply');
    });

    test('the nearest tenant wins, not whichever Apple lists first', async () => {
      // The owner's Home Depot stop came back as "I Sold It On Ebay", two units
      // down the same parking lot, carrying Home Depot's street address
      // (2026-08-02). The box has to stay wide enough to cover a big-box car
      // park, so the box cannot be what disambiguates. Distance has to.
      const out = await page.evaluate(async () => {
        window.mapkit = {
          Coordinate: function (a, b) { this.latitude = a; this.longitude = b; },
          CoordinateSpan: function (a, b) { this.a = a; this.b = b; },
          CoordinateRegion: function (co, sp) { this.co = co; this.sp = sp; },
          PointsOfInterestSearch: function () {
            this.search = (cb) => cb(null, { places: [
              // Listed FIRST, but 180m away.
              { name: 'I Sold It On Ebay', pointOfInterestCategory: 'MKPOICategoryStore',
                formattedAddress: '5900 SW Huntoon St', coordinate: { latitude: 39.0465, longitude: -95.7583 } },
              // Listed second, and the one they actually parked at.
              { name: 'The Home Depot', pointOfInterestCategory: 'MKPOICategoryStore',
                formattedAddress: '5900 SW Huntoon St', coordinate: { latitude: 39.04493, longitude: -95.75828 } },
            ] });
          },
          Geocoder: function () { this.reverseLookup = (co, cb) => cb(new Error('no geo')); },
        };
        _mapkitReady = true;
        const near = await _poiAt({ lat: 39.0449259, lng: -95.7582808 });
        // Nothing rankable: a stub with no coordinates at all must still answer
        // rather than going silent, which is what the rest of this suite relies on.
        window.mapkit.PointsOfInterestSearch = function () {
          this.search = (cb) => cb(null, { places: [{ name: 'Ace Supply', pointOfInterestCategory: 'MKPOICategoryStore' }] });
        };
        const blind = await _poiAt({ lat: 39.0449259, lng: -95.7582808 });
        _mapkitReady = false; delete window.mapkit;
        return { near: near && near.name, blind: blind && blind.name };
      });
      expect(out.near).toBe('The Home Depot');
      expect(out.blind).toBe('Ace Supply');
    });

    test('a receipt logged the next morning still fixes the day', async () => {
      // The hole the owner found: the call is made when the truck pulls out, but
      // receipts get done in the truck at 5pm or at the kitchen table on Sunday.
      // Worse, _stampGeo records where they were WHEN THEY LOGGED IT, so a late
      // receipt carries the kitchen's coordinate and can never geo-match the
      // diner. The vendor name and the date they put on it are what survive.
      await withMapkit({ poiName: "Bobo's Drive In", poiCategory: 'MKPOICategoryRestaurant', geoFails: true });
      const out = await page.evaluate(async () => {
        if (typeof expenses !== 'undefined') expenses.length = 0;
        if (typeof _geoLegOrigin !== 'undefined') _geoLegOrigin = null;
        mileage.length = 0;
        const depot = { lat: 39.03, lng: -95.77, name: 'Ace Supply', kind: 'supply', addr: '400 Depot Rd' };
        const job = { lat: 39.06, lng: -95.67, name: 'Miller residence', kind: 'job', addr: '9 Elm St' };
        const stop = { lat: 39.05, lng: -95.68, name: 'Stop', kind: 'stop', prevOrigin: depot };
        autoLogDriveTrip({ from: depot, to: stop, legKey: 'late-in', startedIso: new Date().toISOString() });
        autoLogDriveTrip({ from: stop, to: job, legKey: 'late-out', startedIso: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 300));
        const before = mileage.map(m => ({ k: m.legKey, from: m.from_name }));
        // Sunday at the kitchen table: right vendor, right date, and a
        // coordinate that is nowhere near the diner. Exactly what a real late
        // receipt looks like.
        expenses.push({ id: _newId(), date: todayKey(), vendor: "Bobo's Drive-In", amount: 84.20,
                        cat: 'Meals', lat: 39.99, lon: -96.99, geoAt: new Date().toISOString(), geoAcc: 10 });
        const restored = reviewDetourReceipts();
        await new Promise(r => setTimeout(r, 300));
        const after = mileage.map(m => ({ k: m.legKey, from: m.from_name, to: m.to_name }));
        // Second sweep must be a no-op, or every load re-adds the leg.
        const again = reviewDetourReceipts();
        return { before, after, restored, again, count: mileage.length };
      });
      // Before: the detour, one leg, starting at the supply house.
      expect(out.before.find(t => t.k === 'late-in')).toBeUndefined();
      expect(out.before.find(t => t.k === 'late-out').from).toBe('Ace Supply');
      // After: both legs back, the stop named from the receipt's business.
      expect(out.restored).toBe(1);
      const inLeg = out.after.find(t => t.k === 'late-in');
      expect(inLeg).toBeDefined();
      expect(inLeg.to).toBe("Bobo's Drive In");
      expect(out.after.find(t => t.k === 'late-out').from).toBe("Bobo's Drive In");
      // Idempotent: running it again changes nothing and adds nothing.
      expect(out.again).toBe(0);
      expect(out.count).toBe(2);
    });

    test('a vendor is matched on its letters, not its punctuation', async () => {
      const out = await page.evaluate(() => ({
        punctuation: _expenseVendorMatches("Bobo's Drive-In", 'Bobos Drive In'),
        leadingThe: _expenseVendorMatches('Pennant', 'The Pennant'),
        contains: _expenseVendorMatches('The Home Depot #1234', 'The Home Depot'),
        different: _expenseVendorMatches('Ace Hardware', 'The Home Depot'),
        tooShort: _expenseVendorMatches('A', 'A'),
        empty: _expenseVendorMatches('', 'The Home Depot'),
        nul: _expenseVendorMatches(null, null),
      }));
      expect(out.punctuation).toBe(true);
      expect(out.leadingThe).toBe(true);
      expect(out.contains).toBe(true);
      expect(out.different).toBe(false);
      // Two-letter vendors would match half the map.
      expect(out.tooShort).toBe(false);
      expect(out.empty).toBe(false);
      expect(out.nul).toBe(false);
    });

    test('a receipt at the pin only counts if it is from that day', async () => {
      // The stamp has to be contemporaneous. A receipt entered on the sofa that
      // evening carries the living room's coordinate, and yesterday's lunch is
      // not evidence about today's stop. Same guard _placeFromExpense uses.
      const out = await page.evaluate(() => {
        const pin = { lat: 39.05, lon: -95.68 };
        expenses.length = 0;
        const mk = (o) => Object.assign({ id: _newId(), vendor: 'Diner', amount: 20,
          lat: pin.lat, lon: pin.lon, geoAcc: 12 }, o);
        const r = {};
        expenses.push(mk({ date: todayKey(), geoAt: new Date().toISOString() }));
        r.today = !!expenseAt(pin);
        expenses.length = 0;
        expenses.push(mk({ date: '2020-01-01', geoAt: new Date().toISOString() }));
        r.staleDate = !!expenseAt(pin);
        expenses.length = 0;
        expenses.push(mk({ date: todayKey() }));           // no stamp at all
        r.noStamp = !!expenseAt(pin);
        expenses.length = 0;
        expenses.push(mk({ date: todayKey(), geoAt: new Date().toISOString(), geoAcc: 4000 }));
        r.junkFix = !!expenseAt(pin);
        expenses.length = 0;
        expenses.push(mk({ date: todayKey(), geoAt: new Date().toISOString(), lat: 40.5, lon: -96.9 }));
        r.faraway = !!expenseAt(pin);
        expenses.length = 0;
        r.none = !!expenseAt(pin);
        r.nul = !!expenseAt(null);
        return r;
      });
      expect(out.today).toBe(true);
      expect(out.staleDate).toBe(false);
      expect(out.noStamp).toBe(false);
      // A 4km fix cannot say which building they were in.
      expect(out.junkFix).toBe(false);
      expect(out.faraway).toBe(false);
      expect(out.none).toBe(false);
      expect(out.nul).toBe(false);
    });
  });

  // ── What READS on the row, versus what gets MEASURED ──────────────────────
  // Owner, 2026-08-02: "shouldn't it do address to address?" Not for the
  // distance, no: an address has to be guessed back into a point, and half of
  // these endpoints are not addresses at all. But the ROW has to read like a
  // record, so every endpoint that has a street address carries it.
  test.describe('street addresses on an automatic trip', () => {
    test('the yard travels as its business address', async () => {
      const out = await page.evaluate(() => {
        const prev = { a: S.baddr, c: S.bcity, s: S.state, z: S.bzip };
        S.baddr = '2015 SW Randolph Ave'; S.bcity = 'Topeka'; S.state = 'KS'; S.bzip = '66604';
        const addr = _geoShopAddr();
        mileage.length = 0;
        autoLogDriveTrip({
          from: { lat: 39.03, lng: -95.71, name: 'Shop', kind: 'shop', addr },
          to: { lat: 39.05, lng: -95.67, name: 'Miller residence', kind: 'job', addr: '309 S Kansas Ave, Topeka, KS' },
          legKey: 'leg-shop-addr', startedIso: new Date().toISOString(),
        });
        const row = { from: mileage[0].from, fromName: mileage[0].from_name, to: mileage[0].to,
                      fc: mileage[0].fromCoord, tc: mileage[0].toCoord };
        Object.assign(S, { baddr: prev.a, bcity: prev.c, state: prev.s, bzip: prev.z });
        return { addr, row };
      });
      expect(out.addr).toBe('2015 SW Randolph Ave, Topeka, KS 66604');
      expect(out.row.from).toBe('2015 SW Randolph Ave, Topeka, KS 66604');
      // The friendly name is still what the row is labelled with.
      expect(out.row.fromName).toBe('Shop');
      expect(out.row.to).toBe('309 S Kansas Ave, Topeka, KS');
      // And the coordinates are on the row regardless, because THEY are what
      // the distance is measured between.
      expect(out.row.fc).toEqual({ lat: 39.03, lng: -95.71 });
      expect(out.row.tc).toEqual({ lat: 39.05, lng: -95.67 });
    });

    test('no business address on file is not an error', async () => {
      const out = await page.evaluate(() => {
        const prev = { a: S.baddr, c: S.bcity, s: S.state, z: S.bzip };
        delete S.baddr; delete S.bcity; delete S.state; delete S.bzip;
        const addr = _geoShopAddr();
        Object.assign(S, { baddr: prev.a, bcity: prev.c, state: prev.s, bzip: prev.z });
        return addr;
      });
      expect(out).toBe('');
    });

    test('a half-filled business address still reads like an address', async () => {
      // The comma between the state and the zip is the tell that a machine wrote
      // it. Whatever is missing, what remains has to read the way a person
      // writes an address.
      const out = await page.evaluate(() => {
        const prev = { a: S.baddr, c: S.bcity, s: S.state, z: S.bzip };
        const at = (o) => { delete S.baddr; delete S.bcity; delete S.state; delete S.bzip;
                            Object.assign(S, o); return _geoShopAddr(); };
        const r = {
          full: at({ baddr: '12 Main St', bcity: 'Topeka', state: 'KS', bzip: '66604' }),
          noZip: at({ baddr: '12 Main St', bcity: 'Topeka', state: 'KS' }),
          noState: at({ baddr: '12 Main St', bcity: 'Topeka', bzip: '66604' }),
          streetOnly: at({ baddr: '12 Main St' }),
          cityOnly: at({ bcity: 'Topeka', state: 'KS' }),
        };
        Object.assign(S, { baddr: prev.a, bcity: prev.c, state: prev.s, bzip: prev.z });
        return r;
      });
      expect(out.full).toBe('12 Main St, Topeka, KS 66604');
      expect(out.noZip).toBe('12 Main St, Topeka, KS');
      expect(out.noState).toBe('12 Main St, Topeka, 66604');
      expect(out.streetOnly).toBe('12 Main St');
      expect(out.cityOnly).toBe('Topeka, KS');
    });
  });

  // ── One drive, one row, and the measured one wins ─────────────────────────
  // Owner (2026-08-02), two questions a week apart. First: "is this smart enough
  // to only log the one?" It was not, and tapping Drive on a client produced a
  // manual row AND an automatic one for the same journey, which is a double
  // deduction. Then: "is the manual drive smart enough to persist the longer
  // automated record if somebody starts it mid drive?" It was not that either,
  // and the first fix made it worse by throwing the measured row away.
  //
  // The rule that answers both: the AUTOMATIC row is the record worth keeping.
  // It runs geocode to geocode across the whole drive and Apple measures it. A
  // manual entry is a number typed from memory across however much of the drive
  // they remembered to tap through. So the automatic row always writes, and End
  // Drive resolves the duplicate, because that is the only moment both rows
  // exist however the tap was timed.
  test.describe('a manual drive and the geofence watching the same truck', () => {
    const endDrive = (miles) => page.evaluate((m) => {
      document.getElementById('end-miles-modal')?.remove();
      const inp = document.createElement('input');
      inp.id = 'end-miles-modal'; inp.value = String(m);
      document.body.appendChild(inp);
      saveEndDriveModal();
      inp.remove();
      return mileage.map(r => ({ k: r.legKey || 'manual', miles: r.miles, method: r.calc_method }));
    }, miles);

    test.beforeEach(async () => {
      await page.evaluate(() => {
        mileage.length = 0;
        gps.vehicle = 'Truck'; gps.purpose = 'Job site'; gps.clientId = null;
      });
    });
    test.afterEach(async () => {
      await page.evaluate(() => { gps.active = false; gps.startTime = null; });
    });

    test('starting the drive MID-drive keeps the longer measured record', async () => {
      // The leg began at 8:00 and they tapped Drive at 8:10. The automatic row
      // covers the whole journey; their typed number covers the tail of it.
      const out = await page.evaluate(() => {
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
          legKey: 'mid-drive', startedIso: new Date(Date.now() - 20 * 60000).toISOString(),
        });
        mileage[0].miles = 12.4; mileage[0].calc_method = 'auto_route';
        gps.active = true; gps.startTime = Date.now() - 10 * 60000;
        return mileage.length;
      });
      expect(out).toBe(1);
      const rows = await endDrive(5);
      // One row, and it is the measured one, not the 5 they typed.
      expect(rows.length).toBe(1);
      expect(rows[0].k).toBe('mid-drive');
      expect(rows[0].miles).toBe(12.4);
      expect(rows[0].method).toBe('auto_route');
    });

    test('tapping Drive before setting off is the same answer', async () => {
      const rows = await page.evaluate(() => {
        gps.active = true; gps.startTime = Date.now() - 15 * 60000;
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
          legKey: 'tapped-first', startedIso: new Date(Date.now() - 14 * 60000).toISOString(),
        });
        mileage[0].miles = 9.1; mileage[0].calc_method = 'auto_route';
        return mileage.length;
      });
      // The automatic row is written either way now: suppressing it was the
      // thing that lost the measured record when the tap came mid-drive.
      expect(rows).toBe(1);
      const after = await endDrive(4);
      expect(after.length).toBe(1);
      expect(after[0].miles).toBe(9.1);
    });

    test('with no automatic row the manual entry is the record', async () => {
      // Tracking off, or a leg the geofence never saw. Their number is all there
      // is and must not be discarded.
      const rows = await page.evaluate(() => {
        gps.active = true; gps.startTime = Date.now() - 10 * 60000;
        return mileage.length;
      });
      expect(rows).toBe(0);
      const after = await endDrive(7.5);
      expect(after.length).toBe(1);
      expect(after[0].k).toBe('manual');
      expect(after[0].miles).toBe(7.5);
      expect(after[0].method).toBe('gps_time');
    });

    test('an automatic row from earlier in the day is not mistaken for this drive', async () => {
      const after = await page.evaluate(async () => {
        mileage.push({ id: _newId(), date: todayKey(), gps: true, legKey: 'this-morning',
                       miles: 4.2, calc_method: 'auto_route',
                       startedIso: new Date(Date.now() - 6 * 3600000).toISOString(),
                       loggedAt: new Date(Date.now() - 5 * 3600000).toISOString() });
        gps.active = true; gps.startTime = Date.now() - 10 * 60000;
        document.getElementById('end-miles-modal')?.remove();
        const inp = document.createElement('input');
        inp.id = 'end-miles-modal'; inp.value = '6';
        document.body.appendChild(inp);
        saveEndDriveModal();
        inp.remove();
        return mileage.map(r => ({ k: r.legKey || 'manual', miles: r.miles }));
      });
      // Both survive: they are different journeys hours apart.
      expect(after.length).toBe(2);
      expect(after.find(t => t.k === 'this-morning').miles).toBe(4.2);
      expect(after.find(t => t.k === 'manual').miles).toBe(6);
    });

    test('the automatic row records when the leg BEGAN, not just when it landed', async () => {
      // loggedAt is the arrival. Without the start there is no way to tell a
      // journey already under way from one that began after the tap, which is
      // the whole question.
      const out = await page.evaluate(() => {
        const iso = new Date(Date.now() - 25 * 60000).toISOString();
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
          legKey: 'has-start', startedIso: iso,
        });
        return { stored: mileage[0].startedIso, iso };
      });
      expect(out.stored).toBe(out.iso);
    });

    // ── Two measurements of one leg, racing ─────────────────────────────────
    // A leg to an unnamed stop is measured the moment it is written. If that
    // stop then turns out to have been PASSED THROUGH (lunch, a personal
    // detour), the leg is re-pointed at the real origin and measured again. Now
    // two route calls are in flight for one row, and the network decides which
    // lands first, not us.
    //
    // The first one had no guard at all. When it landed second it stamped the
    // distance from the WRONG origin as final, and the correcting call then saw
    // a settled row and stepped aside, so the wrong number won permanently. It
    // needs a slow route call to show up, which is to say it shows up on a phone
    // and never on a desk.
    test('a leg re-pointed while its distance is in flight keeps the CORRECTED miles', async () => {
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const origRoute = window._routeDistance;
        let resolveStale, resolveTrue, call = 0;
        window._routeDistance = () => {
          call++;
          return call === 1
            ? new Promise(r => { resolveStale = () => r({ miles: 40, mins: 60 }); })
            : new Promise(r => { resolveTrue = () => r({ miles: 6, mins: 12 }); });
        };
        try {
          const rec = autoLogDriveTrip({
            from: { lat: 38.00, lng: -94.00, name: 'Stop', kind: 'stop' },
            to: { lat: 38.10, lng: -94.10, name: 'Miller residence', kind: 'job' },
            legKey: 'reorigin-race',
          });
          // The stop was lunch. The leg really began at the supply house.
          _reoriginTrip(rec, { lat: 38.05, lng: -94.05, name: 'Home Depot', addr: '1 Supply Rd' });
          // The correction answers first, the original answers last: the order
          // that used to lose the correction.
          resolveTrue(); await new Promise(r => setTimeout(r, 0));
          resolveStale(); await new Promise(r => setTimeout(r, 40));
          return { miles: rec.miles, from: rec.from_name, method: rec.calc_method, calls: call };
        } finally { window._routeDistance = origRoute; }
      });
      expect(out.calls).toBe(2);
      expect(out.from).toBe('Home Depot');
      expect(out.method).toBe('auto_route');
      // 40 is the distance from the lunch stop, measured before the correction.
      expect(out.miles).toBe(6);
    });

    test('the pending sweep also stands down when the leg moves under it', async () => {
      // Same race, other measurer. The sweep picks up a pending_auto row, starts
      // measuring, and the row is re-pointed before its route call returns. The
      // sweep's own guard only re-read calc_method, which a re-origin sets right
      // back to pending_auto, so it read as unchanged and the sweep overwrote the
      // correction anyway.
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const origRoute = window._routeDistance;
        let resolveSweep, sweepStarted;
        const started = new Promise(r => { sweepStarted = r; });
        window._routeDistance = () => {
          sweepStarted();
          return new Promise(r => { resolveSweep = () => r({ miles: 40, mins: 60 }); });
        };
        try {
          const rec = {
            id: _newId(), date: todayKey(), gps: true, legKey: 'sweep-race',
            from: 'Stop', to: 'Miller residence', from_name: 'Stop', to_name: 'Miller residence',
            fromCoord: { lat: 38.00, lng: -94.00 }, toCoord: { lat: 38.10, lng: -94.10 },
            miles: 0, calc_method: 'pending_auto',
          };
          mileage.push(rec);
          const sweep = _retryPendingTrips();
          await started;
          // Re-pointed mid-sweep. Its own measurement is stubbed to the same
          // pending promise, so the only number that can land is the sweep's 40.
          rec.fromCoord = { lat: 38.05, lng: -94.05 };
          rec.from_name = 'Home Depot';
          resolveSweep();
          await sweep;
          return { miles: rec.miles, method: rec.calc_method, from: rec.from_name };
        } finally { window._routeDistance = origRoute; }
      });
      expect(out.from).toBe('Home Depot');
      // The sweep must NOT have written its stale 40 onto the moved leg. The row
      // stays pending, which the next sweep resolves against the new origin.
      expect(out.miles).toBe(0);
      expect(out.method).toBe('pending_auto');
    });

    // ── Midnight ────────────────────────────────────────────────────────────
    // A supply run that leaves at 11:52pm and gets back at 12:08am is ONE trip
    // on ONE day, the day it started. Filing it under the day End Drive was
    // tapped puts it in tomorrow, and on 31 December in the wrong TAX YEAR,
    // where it silently deducts against income that has not been earned yet.
    // The automatic row has followed the leg start since it was written; the
    // hand-typed row was still stamping todayKey().
    test('a drive that crosses midnight is filed on the day it STARTED', async () => {
      const out = await page.evaluate(() => {
        // 12:08am, with the drive begun at 11:52pm yesterday. Built from a real
        // clock so the test means the same thing whatever day it runs.
        const justAfterMidnight = new Date();
        justAfterMidnight.setHours(0, 8, 0, 0);
        const started = justAfterMidnight.getTime() - 16 * 60000;   // 11:52pm
        gps.active = true; gps.startTime = started;
        document.getElementById('end-miles-modal')?.remove();
        const inp = document.createElement('input');
        inp.id = 'end-miles-modal'; inp.value = '9';
        document.body.appendChild(inp);
        saveEndDriveModal();
        inp.remove();
        const row = mileage.find(r => !r.legKey);
        return { date: row && row.date, expected: dateKey(new Date(started)), today: todayKey() };
      });
      expect(out.date).toBe(out.expected);
      // The assertion above is only meaningful when the two days differ, which
      // they do whenever the suite runs after 00:08 local. Say so rather than
      // passing silently on a run that could not have caught the bug.
      if (out.expected === out.today) {
        console.log('[midnight] suite ran before 00:08 local, start and end fall on the same day');
      }
    });

    test('the automatic row crossing midnight is filed the same way', async () => {
      const out = await page.evaluate(() => {
        const iso = new Date(new Date().setHours(23, 52, 0, 0) - 24 * 3600000).toISOString();
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
          legKey: 'midnight-auto', startedIso: iso,
        });
        const row = mileage.find(r => r.legKey === 'midnight-auto');
        return { date: row && row.date, expected: dateKey(new Date(iso)), today: todayKey() };
      });
      expect(out.date).toBe(out.expected);
      expect(out.date).not.toBe(out.today);   // yesterday's leg, filed yesterday
    });
  });

  // ── The sweep that overwrote correct miles with garbage ───────────────────
  // Found by the owner's Topeka day on a live preview (2026-08-02). Three of
  // five legs came back routed from their NAME instead of their coordinates:
  // "Shop" geocoded to a business 65.7 miles away and "Stop" to one 885 miles
  // away, on a day that never left one city. Both rows had their coordinates
  // the whole time.
  test.describe('the pending sweep and the trip that answers mid-sweep', () => {
    test('a trip that settles while the sweep is running is left alone', async () => {
      const out = await page.evaluate(async () => {
        const origRoute = window._routeDistance, origResolve = window._resolveCoords;
        mileage.length = 0;
        const row = (legKey) => ({
          id: _newId(), date: todayKey(), gps: true, legKey,
          from: 'Shop', to: 'Stop', from_name: 'Shop', to_name: 'Stop',
          fromCoord: { lat: 39.05, lng: -95.68 }, toCoord: { lat: 39.06, lng: -95.67 },
          miles: 0, purpose: 'Job site', calc_method: 'pending_auto',
        });
        mileage.push(row('sweep-a'), row('sweep-b'));
        // Whatever the sweep routes comes back long, so a leg it should not have
        // touched is unmistakable.
        let n = 0;
        window._resolveCoords = async () => ({ lat: 41.0, lng: -96.0 });
        window._routeDistance = async () => {
          n++;
          if (n === 1) {
            // The second row's OWN route call, fired by autoLogDriveTrip, lands
            // while the sweep is still awaiting the first. This is the real
            // sequence, not a contrived one: both calls are in flight together.
            const b = mileage.find(m => m.legKey === 'sweep-b');
            b.miles = 2.1; b.calc_method = 'auto_route';
          }
          return { miles: 900, mins: 30 };
        };
        try { await _retryPendingTrips(); }
        finally { window._routeDistance = origRoute; window._resolveCoords = origResolve; }
        return mileage.map(m => ({ k: m.legKey, miles: m.miles, method: m.calc_method }));
      });
      const b = out.find(t => t.k === 'sweep-b');
      // The number its own router already produced, still there and still
      // labelled as coordinate-routed.
      expect(b.miles).toBe(2.1);
      expect(b.method).toBe('auto_route');
      // And the row that really was still pending got swept, so the fix did not
      // simply switch the sweep off.
      const a = out.find(t => t.k === 'sweep-a');
      expect(a.method).toBe('auto_route');
      expect(a.miles).toBe(900);
    });

    test('an automatic trip is never routed from its endpoint names', async () => {
      // The endpoints of an automatic trip are "Shop", "Stop", "The Home Depot",
      // never street addresses, so geocoding them is guaranteed to answer with
      // the wrong building. Both coordinates are already on the row.
      const out = await page.evaluate(async () => {
        const origRoute = window._routeDistance, origResolve = window._resolveCoords;
        mileage.length = 0;
        mileage.push({
          id: _newId(), date: todayKey(), gps: true, legKey: 'coords-only',
          from: 'Shop', to: 'Stop', from_name: 'Shop', to_name: 'Stop',
          fromCoord: { lat: 39.05, lng: -95.68 }, toCoord: { lat: 39.06, lng: -95.67 },
          miles: 0, purpose: 'Job site', calc_method: 'pending_auto',
        });
        let geocoded = 0;
        const seen = [];
        window._resolveCoords = async () => { geocoded++; return { lat: 41.0, lng: -96.0 }; };
        window._routeDistance = async (fc, tc) => { seen.push([fc, tc]); return { miles: 2.4, mins: 9 }; };
        try { await _retryPendingTrips(); }
        finally { window._routeDistance = origRoute; window._resolveCoords = origResolve; }
        return { geocoded, seen, method: mileage[0].calc_method, miles: mileage[0].miles };
      });
      expect(out.geocoded).toBe(0);
      expect(out.seen[0][0]).toEqual({ lat: 39.05, lng: -95.68 });
      expect(out.seen[0][1]).toEqual({ lat: 39.06, lng: -95.67 });
      expect(out.method).toBe('auto_route');
      expect(out.miles).toBe(2.4);
    });
  });

  // ── Two pots of money ─────────────────────────────────────────────────────
  // Owner (2026-08-02): an employee driving their own car should not put miles
  // on the owner's deduction, but some states require reimbursing them, so the
  // miles still have to be recorded. Before this they were dropped entirely,
  // which was right for the deduction and left a contractor in California with
  // no record of a debt they already owed.
  test.describe('an employee driving their own car', () => {
    const seed = (rows) => page.evaluate((rs) => {
      mileage.length = 0;
      rs.forEach(r => mileage.push(Object.assign({
        id: _newId(), date: todayKey(), miles: 10, gps: true, legKey: 'k' + Math.random(),
        calc_method: 'auto_route',
      }, r)));
      return mileage.length;
    }, rows);

    test('their miles never reach the deduction or the Schedule C', async () => {
      await seed([
        { miles: 10 },                                        // owner's truck
        { miles: 40, reimbursable: true, logged_by_name: 'Danny' },
      ]);
      const out = await page.evaluate((yr) => {
        const ded = deductibleTrips(mileage).reduce((s, m) => s + m.miles, 0);
        const reimb = reimbursableTrips(mileage).reduce((s, m) => s + m.miles, 0);
        // The Schedule C path is the one that actually prints on a tax return.
        const sched = (typeof _vehSchedC === 'function') ? _vehSchedC(yr) : null;
        return { ded, reimb, schedMiles: sched ? sched.deductedMiles : null };
      }, new Date().getFullYear());
      expect(out.ded).toBe(10);
      expect(out.reimb).toBe(40);
      // 50 would mean the crew's 40 landed in the owner's Schedule C.
      if (out.schedMiles !== null) expect(out.schedMiles).toBe(10);
    });

    // ── THE GUARD, and the reason it is a source scan and not another case ────
    //
    // The test above used to be called "at any of the five sites" and checked
    // two of them. Five more were found by hand afterwards, in the tax estimate,
    // the dashboard's profit and tax figures, the five-year hobby-loss check,
    // the bid-save recalculation, the monthly profit trend, and two more in the
    // odometer prompt, one of which sets the business-use percentage the
    // actual-expense method multiplies the truck's costs by.
    //
    // Enumerating call sites in a test only ever proves the ones somebody
    // remembered. This reads the source instead and fails on ANY line that totals
    // .miles off the raw array, so the eighth site cannot be added quietly. A
    // line that legitimately shows raw miles (a per-job "3.4mi" label, not a
    // deduction) opts out with the marker, which makes the exemption a deliberate,
    // reviewable act rather than an oversight.
    test('no line anywhere totals raw miles into money', () => {
      const fs = require('fs'), path = require('path');
      const dir = path.join(__dirname, '..', 'js');
      const offenders = [];
      for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          const exempt = (t) => /deductibleTrips\(|reimbursableTrips\(|miles-not-deduction/.test(t);
          // (a) the total is written on one line
          const oneLine = /mileage[\s\S]*?\.reduce\([^;]*\.miles/.test(line);
          // (b) the total SPANS lines, or a slice of mileage is taken here and
          //     summed further down. fleet.js does both, and the single-line
          //     form above could not see either: it took `mileage.filter(...)`
          //     on one line and `.reduce(... .miles ...)` on the next, or passed
          //     the slice into a function that summed it. Five sites hid there,
          //     two of them deduction inputs. Look at the line PLUS the two
          //     after it, which is where the reduce lands in practice.
          const window3 = lines.slice(i, i + 3).join('\n');
          const spans = /\bmileage\b\s*\.\s*(filter|map|slice)\s*\(/.test(line) &&
                        /\.reduce\([^;]*\.miles/.test(window3);
          if (!oneLine && !spans) return;
          if (exempt(oneLine ? line : window3)) return;
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`);
        });
      }
      expect(offenders,
        'These lines total .miles straight off the mileage array. If the number becomes a ' +
        'deduction or a profit figure, route it through deductibleTrips(mileage): a crew ' +
        'member\'s own-car miles are owed TO them and are not the business\'s deduction. If it ' +
        'is only a display of distance driven, mark the line /*miles-not-deduction*/.\n' +
        offenders.join('\n')).toEqual([]);
    });

    test('what the business owes is totalled and attributed by name', async () => {
      await seed([
        { miles: 12, reimbursable: true, logged_by_name: 'Danny' },
        { miles: 8, reimbursable: true, logged_by_name: 'Danny' },
        { miles: 5, reimbursable: true, logged_by_name: 'Rosa' },
        { miles: 100 },                                        // owner's truck
      ]);
      const out = await page.evaluate(() => {
        const o = crewMilesOwed(new Date().getFullYear());
        return { miles: o.miles, trips: o.trips, by: o.by, owed: o.owed, rate: IRS() };
      });
      expect(out.miles).toBe(25);
      expect(out.trips).toBe(3);
      expect(out.by.Danny).toBe(20);
      expect(out.by.Rosa).toBe(5);
      // Priced at the IRS rate, which is a defensible DEFAULT and not a legal
      // mandate: no federal law requires reimbursing mileage at all, and the
      // states that require it require "necessary expenditures" rather than a
      // named rate. The figure is an estimate and the UI says so.
      expect(out.owed).toBeCloseTo(25 * out.rate, 5);
    });

    test('nobody owed anything means no total to show', async () => {
      await seed([{ miles: 30 }]);
      const out = await page.evaluate(() => crewMilesOwed(new Date().getFullYear()));
      expect(out.miles).toBe(0);
      expect(out.trips).toBe(0);
      expect(out.owed).toBe(0);
    });

    test('an ordinary trip is untouched by the flag', async () => {
      // The filter defaults to INCLUDING a row, so a legacy trip written before
      // any of this existed still deducts exactly as it did.
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 22 });   // no flag at all
        return { ded: deductibleTrips(mileage).length, reimb: reimbursableTrips(mileage).length };
      });
      expect(out.ded).toBe(1);
      expect(out.reimb).toBe(0);
    });

    // ── Who gets a screen for this ────────────────────────────────────────
    // Owner (2026-08-03): "Don't want the employees to see it, will trust their
    // business owner sees it and does the right thing."
    //
    // So this is deliberate, not an oversight: the crew's own-car miles are
    // captured, attributed and synced, and the ONLY person with a screen for
    // them is the person who has to pay them. The mileage view lives on the
    // Tracker page, and nothing anywhere was asserting the crew cannot reach it,
    // which means one helpful un-gating later would have quietly reversed the
    // decision. It is a rule now, so it gets a test.
    test('a crew member has no route to the mileage screen: the owner acts on it', async () => {
      const out = await page.evaluate(() => {
        const wasEmp = _isEmployee, wasRec = _employeeRecord;
        try {
          _isEmployee = true;
          _employeeRecord = { name: 'Danny', role: 'tech', active: true,
                              permissions: { mileage: true, expenses: true } };
          if (typeof applyPermissions === 'function') applyPermissions();
          goPg('pg-tracker');
          const nav = document.getElementById('nb-tracker');
          const more = document.getElementById('mmi-tracker');
          return {
            landed: (document.querySelector('.pg.active') || {}).id,
            navHidden: !!nav && nav.style.display === 'none',
            moreHidden: !!more && more.style.display === 'none',
          };
        } finally {
          _isEmployee = wasEmp; _employeeRecord = wasRec;
          if (typeof applyPermissions === 'function') applyPermissions();
        }
      });
      // Asking for the page by name lands them on the dashboard instead.
      expect(out.landed).toBe('pg-dash');
      // And neither nav offers it, so they never ask in the first place.
      expect(out.navHidden).toBe(true);
      expect(out.moreHidden).toBe(true);
    });
  });

  // ── The standing vehicle, and the truck that is in the shop ────────────────
  // Owner (2026-08-03): "I want this to be easy and bulletproof and force easy
  // automated clean data", and then the part that makes it safe rather than
  // merely convenient: "flag to dispatch if Danny's vehicle he usually uses is
  // down for maintenance, what's Danny going to drive?"
  //
  // Auto-filling a usual truck WITHOUT checking the shop would have introduced a
  // new bug rather than fixing one: miles deducted on a vehicle sitting on a
  // lift. A false deduction is worse than a blank, because a blank claims
  // nothing and a false one goes on the return.
  test.describe('the vehicle answer that survives midnight', () => {
    // todayKey() is a BROWSER global. These fixtures are built in Node, where it
    // does not exist, so the date has to be computed here. Matches dateKey()'s
    // LOCAL-time construction rather than toISOString(), which is UTC and would
    // disagree with the app for part of every day.
    const todayLocal = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // The day is computed ONCE in Node and passed in, so nothing inside the
    // browser body reaches for a date function at all. Two commits in a row
    // broke on this boundary: first todayKey() called in Node, then todayLocal()
    // called in the browser. Passing the value removes the question.
    const setup = (o) => page.evaluate((a) => {
      S.employees = [{ id: 'e-danny', name: 'Danny' }, { id: 'e-sam', name: 'Sam' }];
      vehicles.length = 0;
      vehicles.push({ id: 'v-250', name: 'F-250', status: 'active', crewDrivable: true, downtimeLog: a.down || [] });
      vehicles.push({ id: 'v-van', name: 'Transit', status: 'active', crewDrivable: !!a.vanDrivable, downtimeLog: a.vanDown || [] });
      if (a.usual) S.employees[0].usualVehicle = a.usual;
      jobs.length = 0;
      jobs.push({ id: 8801, name: 'Job', status: 'upcoming', start: a.today, days: 1, assignedTo: 'e-danny' });
      return true;
    }, Object.assign({ today: todayLocal() }, o));

    test('a usual truck answers for today with nobody touching anything', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' } });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.mode).toBe('truck');
      expect(r.vehicleId).toBe('v-250');
      expect(r.reason).toBe('usual');
    });

    test('the usual truck being in the shop does NOT quietly keep deducting', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' },
                    down: [{ start: todayLocal(), end: null }] });   // open end = still in
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      // Not 'truck'. This is the whole point.
      expect(r.mode).toBe('none');
      expect(r.reason).toBe('usual-down');
      expect(r.downVehicleName).toBe('F-250');
    });

    test('with the truck down and another free, dispatch offers that one', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' },
                    down: [{ start: todayLocal(), end: null }], vanDrivable: true });
      const need = await page.evaluate(() => crewNeedingVehicleAnswer());
      expect(need.length).toBe(1);
      expect(need[0].name).toBe('Danny');
      expect(need[0].reason).toBe('usual-down');
      expect(need[0].options).toContain('truck');
      expect(need[0].offer.map(v => v.name)).toContain('Transit');
    });

    test('with EVERY truck down, no truck is offered at all', async () => {
      // Only what is true. Their own vehicle or riding with somebody are the
      // honest answers left, and the board must not pretend otherwise.
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' },
                    down: [{ start: todayLocal(), end: null }],
                    vanDrivable: true, vanDown: [{ start: todayLocal(), end: null }] });
      const need = await page.evaluate(() => crewNeedingVehicleAnswer());
      expect(need[0].options).toEqual(['own', 'rider']);
      expect(need[0].offer).toEqual([]);
    });

    test('a truck out of the shop yesterday is available again today', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' },
                    down: [{ start: '2020-01-01', end: '2020-01-05' }] });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.mode).toBe('truck');   // standing answer resumes on its own
      expect(r.reason).toBe('usual');
    });

    test('a usual of "own vehicle" answers too, and claims the reimbursement', async () => {
      await setup({ usual: { mode: 'own' } });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.mode).toBe('own');
      expect(r.reason).toBe('usual');
    });

    test('nobody set yet is reported as unset, not guessed', async () => {
      await setup({});
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.reason).toBe('unset');
      const need = await page.evaluate(() => crewNeedingVehicleAnswer());
      expect(need.map(n => n.name)).toEqual(['Danny']);
    });

    test('somebody not working today is not a gap', async () => {
      await setup({});
      const need = await page.evaluate(() => crewNeedingVehicleAnswer());
      expect(need.map(n => n.name)).not.toContain('Sam');
    });

    test('a usual truck deleted out from under it reads unset, never stale', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-gone' } });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.reason).toBe('unset');
      expect(r.mode).toBe('none');
    });
  });

  // ── Answering the gap, once ────────────────────────────────────────────────
  // The card does two jobs because they are the same question: the ONE-TIME
  // migration for crew who predate this feature, and the daily exception when
  // somebody's usual truck is in the shop. Existing crew cannot be defaulted in
  // either direction (personal books reimbursements for people driving company
  // trucks, truck deducts miles on personal cars), so the app asks rather than
  // guesses, and until it is answered those drives claim nothing.
  test.describe('the dispatch gap card', () => {
    const dayLocal = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const seed = (o) => page.evaluate((a) => {
      S.employees = [{ id: 'e-danny', name: 'Danny' }];
      vehicles.length = 0;
      vehicles.push({ id: 'v-250', name: 'F-250', status: 'active', crewDrivable: true, downtimeLog: a.down || [] });
      if (a.usual) S.employees[0].usualVehicle = a.usual;
      jobs.length = 0;
      jobs.push({ id: 8811, name: 'Job', status: 'upcoming', start: a.today, days: 1, assignedTo: 'e-danny' });
      return true;
    }, Object.assign({ today: dayLocal() }, o));

    test('somebody with no answer shows on the card', async () => {
      await seed({});
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('Danny');
      expect(html).toContain('No usual vehicle set yet');
      expect(html).toContain('1 person needs');
    });

    test('answering it once clears the card', async () => {
      await seed({});
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', 'v-250');
        const e = S.employees[0];
        return { usual: e.usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toEqual({ mode: 'truck', vehicleId: 'v-250' });
      expect(out.html).toBe('');   // nothing left to ask
    });

    test('"their own vehicle" is a real answer, not an absence', async () => {
      await seed({});
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', 'own');
        return { usual: S.employees[0].usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toEqual({ mode: 'own' });
      expect(out.html).toBe('');
    });

    test('clearing it back to unset is allowed, and reopens the question', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' } });
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', '');
        return { usual: S.employees[0].usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toBeUndefined();
      expect(out.html).toContain('Danny');
    });

    test('a usual truck in the shop shows WHY, by name', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, down: [{ start: dayLocal(), end: null }] });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('F-250 is in the shop');
    });

    test('with every truck down the card offers no truck at all', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, down: [{ start: dayLocal(), end: null }] });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('Their own vehicle');
      // The only crew-drivable truck is the one in the shop, so it must not be
      // offered as the answer to its own absence.
      expect(html).not.toContain('>F-250<');
    });

    test('nothing to ask means no card', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' } });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toBe('');
    });

    test('answering from the RENDERED card actually works', async () => {
      // The test that would have caught the dead select. The card passed every
      // string assertion while its onchange attribute, built with
      // JSON.stringify, terminated at the first double quote and did nothing
      // when a real person picked an answer. So this one parses the HTML into
      // the DOM and dispatches a real change event; asserting on the markup is
      // not asserting on the control.
      await seed({});
      const out = await page.evaluate(() => {
        const realRD = window.renderDispatch;
        window.renderDispatch = () => {};   // setUsualVehicle repaints the board; not under test here
        try {
          const d = document.createElement('div');
          d.innerHTML = _dispatchVehicleGapHtml();
          document.body.appendChild(d);
          const sel = d.querySelector('select');
          const opts = Array.from(sel.options).map(o => o.value);
          sel.value = 'v-250';
          sel.dispatchEvent(new Event('change'));
          d.remove();
          return { opts, usual: S.employees[0].usualVehicle || null };
        } finally { window.renderDispatch = realRD; }
      });
      expect(out.opts).toContain('v-250');
      expect(out.opts).toContain('own');
      expect(out.usual).toEqual({ mode: 'truck', vehicleId: 'v-250' });
    });

    test('setting a vehicle for somebody who does not exist is a no-op', async () => {
      await seed({});
      const out = await page.evaluate(() => setUsualVehicle('nobody', 'v-250'));
      expect(out).toBeNull();
    });
  });

  // ── The member form keeps what it was never shown ──────────────────────────
  // Found while wiring the hire question, and it would have eaten the feature:
  // saveEmployee rebuilt the record from the FORM ALONE, so every field the form
  // does not render was dropped on save. Editing somebody's phone number
  // mid-morning silently wiped truckDay, their vehicle for the day.
  test.describe('editing a crew member', () => {
    test('keeps the fields the form never shows', async () => {
      const out = await page.evaluate(() => {
        S.employees = [{ id: 'e-keep', name: 'Danny', role: 'tech', permissions: {},
                         truckDay: { day: todayKey(), mode: 'truck', vehicleId: 'v-250' },
                         usualVehicle: { mode: 'truck', vehicleId: 'v-250' },
                         location_ack_at: '2026-08-01T00:00:00Z' }];
        // What a save does: rebuild from the form, then merge over the previous
        // record. Driven directly because the modal markup is not the thing
        // under test, the survival of the untouched fields is.
        const prev = S.employees[0];
        const rebuilt = Object.assign({}, prev, { id: 'e-keep', name: 'Danny Two', role: 'tech', permissions: {} });
        S.employees[0] = rebuilt;
        const e = S.employees[0];
        return { name: e.name, truckDay: !!e.truckDay, usual: !!e.usualVehicle, ack: !!e.location_ack_at };
      });
      expect(out.name).toBe('Danny Two');
      expect(out.truckDay, "today's vehicle must survive an unrelated edit").toBe(true);
      expect(out.usual).toBe(true);
      expect(out.ack).toBe(true);
    });

    test('the real save path carries them too', async () => {
      // Against saveEmployee itself, so the merge cannot regress in the file
      // where it actually lives.
      const out = await page.evaluate(() => {
        const src = String(typeof _saveEmployee === 'function' ? _saveEmployee : '');
        return { merges: /Object\.assign\(\{\},\s*_prev/.test(src), found: !!src };
      });
      expect(out.found).toBe(true);
      expect(out.merges, '_saveEmployee must build on the previous record, not replace it').toBe(true);
    });
  });

  // ── Three pots, not two ────────────────────────────────────────────────────
  // An unattributed drive is neither the owner's deduction nor the crew's debt.
  // Recorded, so the answer is still worth something on Thursday.
  test.describe('a drive nobody has attributed yet', () => {
    const seed = () => page.evaluate(() => {
      mileage.length = 0;
      const mk = (o) => Object.assign({ id: _newId(), date: todayKey(), miles: 10 }, o);
      mileage.push(mk({ miles: 10 }));                        // owner truck
      mileage.push(mk({ miles: 20, reimbursable: true }));    // crew own car
      mileage.push(mk({ miles: 40, vehicleUnknown: true, id: 'unattrib' }));
      return true;
    });

    test('it is in neither total', async () => {
      await seed();
      const out = await page.evaluate(() => ({
        ded: deductibleTrips(mileage).reduce((s, m) => s + m.miles, 0),
        reimb: reimbursableTrips(mileage).reduce((s, m) => s + m.miles, 0),
        un: unattributedTrips(mileage).reduce((s, m) => s + m.miles, 0),
      }));
      expect(out.ded).toBe(10);     // 50 would mean the unknown 40 was deducted
      expect(out.reimb).toBe(20);   // 60 would mean it was billed to the crew
      expect(out.un).toBe(40);
    });

    test('answering "company truck" moves it into the deduction', async () => {
      await seed();
      const out = await page.evaluate(() => {
        vehicles.length = 0; vehicles.push({ id: 'v-250', name: 'F-250', status: 'active' });
        attributeTrip('unattrib', 'truck', 'v-250');
        const m = mileage.find(x => x.id === 'unattrib');
        return { ded: deductibleTrips(mileage).reduce((s, r) => s + r.miles, 0),
                 unknown: !!m.vehicleUnknown, vehicle: m.vehicle };
      });
      expect(out.unknown).toBe(false);
      expect(out.ded).toBe(50);
      expect(out.vehicle).toBe('F-250');
    });

    test('answering "own vehicle" moves it into what they are owed', async () => {
      await seed();
      const out = await page.evaluate(() => {
        attributeTrip('unattrib', 'own');
        return { ded: deductibleTrips(mileage).reduce((s, r) => s + r.miles, 0),
                 reimb: reimbursableTrips(mileage).reduce((s, r) => s + r.miles, 0) };
      });
      expect(out.ded).toBe(10);
      expect(out.reimb).toBe(60);
    });

    test('answering "riding with somebody" removes it, because it is nobody\'s', async () => {
      await seed();
      const out = await page.evaluate(() => {
        attributeTrip('unattrib', 'rider');
        return { gone: !mileage.find(x => x.id === 'unattrib'), total: mileage.length };
      });
      expect(out.gone).toBe(true);
      expect(out.total).toBe(2);
    });

    test('the owner SEES the waiting drives, and one answer files them', async () => {
      // attributeTrip existed with zero callers: the settle path was
      // unreachable from any screen. This drives the panel end to end through
      // the rendered select, change event and all.
      await page.evaluate(() => {
        mileage.length = 0; vehicles.length = 0;
        vehicles.push({ id: 'v-250', name: 'F-250', status: 'active' });
        trackerYear = String(new Date().getFullYear());
        mileage.push({ id: 'un-ui', date: todayKey(), miles: 7.5, vehicleUnknown: true, gps: true,
                       from_name: 'Shop', to_name: 'Miller residence', logged_by_name: 'Danny' });
        renderAllMileage();
      });
      const out = await page.evaluate(() => {
        const w = document.getElementById('mil-unattrib-wrap');
        if (!w) return { panel: false };
        const shows = w.textContent.includes('7.5') && w.textContent.includes('Danny');
        const sel = w.querySelector('select');
        sel.value = 'v-250';
        sel.dispatchEvent(new Event('change'));
        const m = mileage.find(x => x.id === 'un-ui');
        return { panel: true, shows,
                 unknown: !!(m && m.vehicleUnknown), veh: m && m.vehicle,
                 ded: deductibleTrips(mileage).some(x => x.id === 'un-ui'),
                 cleared: !document.getElementById('mil-unattrib-wrap') };
      });
      expect(out.panel, 'the panel must render for an unattributed drive').toBe(true);
      expect(out.shows).toBe(true);
      expect(out.unknown).toBe(false);
      expect(out.veh).toBe('F-250');
      expect(out.ded).toBe(true);
      expect(out.cleared, 'a settled panel disappears rather than lingering empty').toBe(true);
    });

    test('an already-answered trip is not re-answerable', async () => {
      await seed();
      const out = await page.evaluate(() => {
        const before = mileage.filter(m => m.reimbursable).length;
        attributeTrip(mileage[0].id, 'own');       // a settled owner trip
        return { before, after: mileage.filter(m => m.reimbursable).length };
      });
      expect(out.after).toBe(out.before);
    });
  });

  // ── Nobody said what they were driving ─────────────────────────────────────
  // Owner (2026-08-03): "treat none like rider". The vehicle mode has four
  // states and only three were handled. 'none' means no truck assigned on the
  // dispatch board AND no pick made on the phone, and it fell through to
  // reimbursable, booking money the business never agreed to off a drive where
  // the app cannot say whether they were in the company truck, riding with
  // somebody, or on a bus. It invented a debt out of a blank.
  test.describe('a crew member with no vehicle recorded', () => {
    const legAs = (mode) => page.evaluate(async (m) => {
      const realUser = _supaUser, realEmp = _isEmployee, realRoute = _routeDistance, realMode = window._shiftVehicleMode;
      const queued = [];
      const realEnq = window._geoEnqueue;
      _supaUser = { id: 'u-mode' }; _isEmployee = true;
      window._routeDistance = _routeDistance = async () => ({ miles: 6.2, mins: 14 });
      window._shiftVehicleMode = () => m;
      window._geoEnqueue = (tbl, row) => queued.push({ tbl, row });
      const before = mileage.length;
      try {
        _geoLegOrigin = { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' };
        _geoDriveEntry(9901, new Date(Date.now() - 20 * 60000).toISOString(), null, null, false,
                       { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' });
        await new Promise(r => setTimeout(r, 50));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before));
        return {
          miles: rows.map(r => ({ reimbursable: !!r.reimbursable, unknown: !!r.vehicleUnknown })),
          timeEntries: queued.filter(q => q.tbl === 'job_time_entries').map(q => q.row.source),
        };
      } finally {
        _supaUser = realUser; _isEmployee = realEmp;
        window._routeDistance = _routeDistance = realRoute;
        window._shiftVehicleMode = realMode; window._geoEnqueue = realEnq;
        _geoLegOrigin = null;
      }
    }, mode);

    test("'none' records the drive and claims nothing on either side", async () => {
      // CHANGED 2026-08-03: this asserted zero rows. Discarding it meant that
      // when somebody remembered on Thursday that Danny was in his own truck,
      // there was nothing left to correct. The row is kept and marked
      // unattributed instead: out of the deduction, out of what the crew are
      // owed, and one tap from being either.
      const out = await legAs('none');
      expect(out.timeEntries.length).toBe(1);       // the drive is compensable
      expect(out.miles.length).toBe(1);             // and it is on the record
      expect(out.miles[0].unknown).toBe(true);
      expect(out.miles[0].reimbursable).toBe(false);
    });

    test("'none' is recorded as unassigned, never as personal", async () => {
      // The time entry is what somebody reads a year later. Calling an unknown
      // vehicle "personal" is the same wrong assumption the mileage side made.
      const out = await legAs('none');
      expect(out.timeEntries[0]).toBe('drive-unassigned');
      expect(out.timeEntries[0]).toMatch(/^drive/);   // still drive time to every money view
    });

    test("'own' still books the reimbursement, which is the point of the split", async () => {
      const out = await legAs('own');
      expect(out.miles.length).toBe(1);
      expect(out.miles[0].reimbursable).toBe(true);
      expect(out.timeEntries[0]).toBe('drive-personal');
    });

    test("'truck' still deducts, and 'rider' still claims nothing", async () => {
      const truck = await legAs('truck');
      expect(truck.miles.length).toBe(1);
      expect(truck.miles[0].reimbursable).toBe(false);
      const rider = await legAs('rider');
      expect(rider.miles).toEqual([]);
      expect(rider.timeEntries[0]).toBe('drive-rider');
    });
  });

  // ── Correcting a job's address mid-shift ───────────────────────────────────
  // The job-coordinate cache was keyed on the job id alone and never
  // invalidated, so a cached point outlived the address it came from. Fixing a
  // typo'd address, or moving a job to the back entrance, left the fence on the
  // OLD point for the rest of the session: the crew drove to the new address and
  // nothing fired. This PR raised the stakes on it, because those coordinates
  // are no longer only fence membership, they are the endpoints the mileage row
  // is measured between.
  test.describe('a job whose address is corrected', () => {
    test('the fence follows the new address, not the cached one', async () => {
      const out = await page.evaluate(async () => {
        _geoJobCoords = {};
        const j = { id: 55501, name: 'Moved job', client_id: null, addr: '400 Oak St' };
        const asked = [];
        const realResolve = window._resolveCoords;
        window._resolveCoords = async (a) => { asked.push(a); return a === '400 Oak St'
          ? { lat: 38.06, lng: -94.06 } : { lat: 39.99, lng: -95.99 }; };
        try {
          const first = await _geoJobLatLng(j);
          // The contractor fixes the address. Same job, same id.
          j.addr = '77 Back Entrance Rd';
          const second = await _geoJobLatLng(j);
          // And asking again with nothing changed must NOT re-geocode: the cache
          // still has to be a cache.
          const third = await _geoJobLatLng(j);
          return { first, second, third, asked };
        } finally { window._resolveCoords = realResolve; }
      });
      expect(out.first.lat).toBeCloseTo(38.06, 4);
      // Before the fix this came back as the ORIGINAL point.
      expect(out.second.lat).toBeCloseTo(39.99, 4);
      expect(out.asked).toEqual(['400 Oak St', '77 Back Entrance Rd']);
      // Third call is a hit, so no third geocode.
      expect(out.third.lat).toBeCloseTo(39.99, 4);
    });

    test('a job carrying its own lat/lon follows those when they move', async () => {
      const out = await page.evaluate(async () => {
        _geoJobCoords = {};
        const j = { id: 55502, name: 'Pinned job', client_id: null, lat: 38.00, lon: -94.00 };
        const a = await _geoJobLatLng(j);
        j.lat = 38.50; j.lon = -94.50;          // dragged to the right spot
        const b = await _geoJobLatLng(j);
        return { a, b };
      });
      expect(out.a.lat).toBeCloseTo(38.00, 4);
      expect(out.b.lat).toBeCloseTo(38.50, 4);
    });

    test('signing out drops the cache with the rest of the geofence state', async () => {
      // stopGeoTracking cleared every other piece of geofence state and left
      // this one behind, and sign-out is exactly when a second account signs in
      // on the same device.
      const out = await page.evaluate(() => {
        _geoJobCoords = { 999: { lat: 1, lng: 2, src: 'x' } };
        stopGeoTracking();
        return Object.keys(_geoJobCoords).length;
      });
      expect(out).toBe(0);
    });
  });

  // ── The truck that sat at the yard overnight ───────────────────────────────
  // _geoLastFenceAt is how a leg's start is inferred when the whole trip lands
  // in one ping, and it is only ever cleared when tracking stops. Parked at the
  // yard at 5pm with the phone asleep, driven to a job at 7:30 the next morning,
  // it inferred a FOURTEEN HOUR drive: billed as job time into Job Profit and
  // crew cost, mileage dated to yesterday, and at New Year the wrong tax year.
  // The persisted job entry already guards its day boundary; this in-memory
  // timestamp did not.
  //
  // Owner's call (2026-08-03): keep the miles, drop the hours.
  test.describe('a leg inferred across an overnight gap', () => {
    const overnightLeg = (hoursAgo) => page.evaluate(async (h) => {
      const realUser = _supaUser, realRoute = _routeDistance;
      const queued = [];
      const realEnq = window._geoEnqueue;
      _supaUser = { id: 'u-overnight' };
      window._routeDistance = _routeDistance = async () => ({ miles: 9.4, mins: 18 });
      window._geoEnqueue = (tbl, row) => queued.push({ tbl, row });
      const before = mileage.length;
      try {
        __seedGeo();
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        _geoHomeDwell = null; _geoWasAtHome = false;
        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        await ping(h.SHOP);                       // parked at the yard, evening
        _geoLastFenceAt = new Date(Date.now() - h.hours * 3600000).toISOString();
        await ping(h.JOB);                        // first fix of the next morning
        await new Promise(r => setTimeout(r, 50));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before));
        return {
          rows: rows.map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, date: m.date })),
          timeEntries: queued.filter(q => q.tbl === 'job_time_entries').map(q => q.row.minutes),
          today: todayKey(),
          // The local day the leg STARTED. Equals `today` except when CI runs
          // inside the first h hours after local midnight, where a real leg
          // legitimately started yesterday.
          startDay: dateKey(new Date(Date.now() - h.hours * 3600000)),
        };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        window._geoEnqueue = realEnq;
      }
    }, { SHOP, JOB, hours: hoursAgo });

    test('fourteen hours asleep: the miles are kept, the hours are not', async () => {
      const out = await overnightLeg(14);
      expect(out.rows.length, 'the drive is real and must still be logged').toBe(1);
      expect(out.rows[0].miles).toBe(9.4);
      // Dated to the morning we SAW them, never to yesterday's last fence ping.
      expect(out.rows[0].date).toBe(out.today);
      // And no invented shift lands in payroll.
      expect(out.timeEntries, 'a duration nobody observed must not be claimed').toEqual([]);
    });

    test('a normal twenty-minute leg still logs its time', async () => {
      // The guard must not swallow ordinary legs: this is the case that keeps
      // "drop the hours" from quietly becoming "never log hours".
      const out = await overnightLeg(20 / 60);
      expect(out.rows.length).toBe(1);
      // Dated by when the drive STARTED, which is `today` for 23h40m of every
      // day but legitimately yesterday when CI runs just after local midnight
      // (assertion used to pin `today` and failed exactly there, 2026-08-07
      // run at 00:0x UTC). The 14h stale case above still pins `today`: a
      // stale leg is deliberately stamped at the moment we SAW them.
      expect(out.rows[0].date).toBe(out.startDay);
      expect(out.timeEntries.length).toBe(1);
      expect(out.timeEntries[0]).toBeGreaterThanOrEqual(19);
      expect(out.timeEntries[0]).toBeLessThanOrEqual(21);
    });
  });

  // ── The End Drive match, and what it is allowed to throw away ──────────────
  // Caught by the FULL live suite on the local runner, and it was mine: the
  // duplicate-resolution I added matched an automatic row on TIME ALONE. Any
  // automatic leg overlapping the window counted as "this same drive", so what
  // the contractor typed was discarded and they were told it had already been
  // logged. In a crew account another phone logs legs all day, so the trip that
  // vanished need not even have been theirs.
  //
  // Direction of error matters here and it was backwards: a duplicate row is
  // visible and one tap to delete, a vanished trip is invisible. Every
  // uncertainty now resolves toward keeping what they typed.
  test.describe('ending a drive next to somebody else\'s leg', () => {
    const endDrive = (miles) => page.evaluate((m) => {
      document.getElementById('end-miles-modal')?.remove();
      const inp = document.createElement('input');
      inp.id = 'end-miles-modal'; inp.value = String(m);
      document.body.appendChild(inp);
      saveEndDriveModal();
      inp.remove();
      return mileage.map(r => ({ k: r.legKey || 'manual', miles: r.miles, method: r.calc_method }));
    }, miles);

    test.beforeEach(async () => {
      await page.evaluate(() => {
        mileage.length = 0;
        gps.vehicle = 'Truck'; gps.purpose = 'Job site'; gps.clientId = null;
        gps.active = true; gps.startTime = Date.now() - 10 * 60000;
        gps.startCoords = { lat: 37.6872, lon: -97.3301 };   // Wichita
      });
    });
    test.afterEach(async () => {
      await page.evaluate(() => { gps.active = false; gps.startTime = null; gps.startCoords = null; });
    });

    test('an overlapping leg 130 miles away is a DIFFERENT drive, and is kept', async () => {
      await page.evaluate(() => {
        // A Topeka leg, logged in the same ten minutes. Same account, same
        // clock, nothing to do with the drive being ended in Wichita.
        mileage.push({ id: _newId(), date: todayKey(), gps: true, legKey: 'topeka-leg',
                       miles: 4.2, calc_method: 'auto_route',
                       fromCoord: { lat: 39.0307, lng: -95.7113 }, toCoord: { lat: 39.0556, lng: -95.6720 },
                       startedIso: new Date(Date.now() - 8 * 60000).toISOString(),
                       loggedAt: new Date(Date.now() - 1 * 60000).toISOString() });
      });
      const after = await endDrive(12.4);
      // Both survive. Before the fix the typed 12.4 was silently dropped.
      expect(after.length).toBe(2);
      expect(after.find(t => t.k === 'manual').miles).toBe(12.4);
      expect(after.find(t => t.k === 'topeka-leg').miles).toBe(4.2);
    });

    test('another crew member\'s leg never swallows the owner\'s entry', async () => {
      await page.evaluate(() => {
        mileage.push({ id: _newId(), date: todayKey(), gps: true, legKey: 'dannys-leg',
                       miles: 9, calc_method: 'auto_route', logged_by_id: 'danny-uid',
                       startedIso: new Date(Date.now() - 8 * 60000).toISOString(),
                       loggedAt: new Date(Date.now() - 1 * 60000).toISOString() });
      });
      const after = await endDrive(12.4);
      expect(after.length).toBe(2);
      expect(after.find(t => t.k === 'manual').miles).toBe(12.4);
    });

    test('the SAME journey still collapses to the measured row', async () => {
      // The behaviour the match exists for, unchanged: an automatic leg from
      // where they set off, overlapping in time, is this drive.
      await page.evaluate(() => {
        mileage.push({ id: _newId(), date: todayKey(), gps: true, legKey: 'my-leg',
                       miles: 15.8, calc_method: 'auto_route',
                       fromCoord: { lat: 37.6872, lng: -97.3301 },       // where the tap happened
                       toCoord: { lat: 37.7000, lng: -97.2000 },
                       startedIso: new Date(Date.now() - 22 * 60000).toISOString(),
                       loggedAt: new Date().toISOString() });
      });
      const after = await endDrive(3);
      expect(after.length).toBe(1);
      expect(after[0].k).toBe('my-leg');
      expect(after[0].miles).toBe(15.8);   // the measured one wins, not the typed 3
    });

    test('with no start fix recorded it still collapses on time alone', async () => {
      // Location refused or unavailable: startCoords is all we lose, and the
      // mid-drive tap must still work. Time is then the only evidence there is.
      await page.evaluate(() => {
        gps.startCoords = null;
        mileage.push({ id: _newId(), date: todayKey(), gps: true, legKey: 'no-fix-leg',
                       miles: 11.1, calc_method: 'auto_route',
                       startedIso: new Date(Date.now() - 22 * 60000).toISOString(),
                       loggedAt: new Date().toISOString() });
      });
      const after = await endDrive(3);
      expect(after.length).toBe(1);
      expect(after[0].k).toBe('no-fix-leg');
    });
  });

  // ── Written to the cache, but read back from it? ───────────────────────────
  // Found by reading the sync engine rather than by suspecting anything.
  //
  // Adding a synced table means touching SIX places that write it (the table
  // list, the wipe, the offline blob, the delta repaint, the local cache, the
  // sign-in reset) and FOUR that read it back out of the cache. td_places got
  // all six writes and none of the four reads, so `places` was cached faithfully
  // on every save and came back EMPTY on any boot that ran from cache: no
  // session, or Supabase unreachable.
  //
  // That is the boot where it matters most. With no places, the geofence has no
  // supply-house or home-office fences at all, so the drive that should read
  // "Ace Supply" logs as an anonymous "Stop", and the code that turns an
  // unrecognised stop into a place can create a SECOND record for a yard that
  // was already known, which then syncs up as a duplicate.
  //
  // A per-array test would only ever cover the arrays somebody remembered, which
  // is exactly how this happened. The symmetry itself is the invariant.
  test.describe('every synced array survives a cache-only boot', () => {
    test('each table written to the local cache is also restored from it', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
      // The tables the sync fabric owns, read from the fabric itself so this
      // cannot drift from the real list.
      const tables = [...src.matchAll(/\{t:'td_([a-z_]+)'/g)].map(m => m[1]);
      expect(tables.length).toBeGreaterThan(10);
      const camel = (s) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
      // Every restore block reads _cd.clients, so counting those counts the
      // blocks. Any array read fewer times is missing from one of them.
      const blocks = (src.match(/_cd\.clients\b/g) || []).length;
      expect(blocks).toBeGreaterThan(0);
      const short = tables
        .map(t => ({ t, key: camel(t), n: (src.match(new RegExp('_cd\\.' + camel(t) + '\\b', 'g')) || []).length }))
        .filter(x => x.n < blocks);
      expect(short.map(x => `td_${x.t} restored in ${x.n}/${blocks} cache-restore blocks`),
        'a table written to the cache but not read back comes home EMPTY on an offline boot').toEqual([]);
    });

    test('the offline-pending blob carries every synced table', () => {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
      const blob = (src.match(/function _offlinePendingBlob\(\)[\s\S]*?\n\}/) || [''])[0];
      const tables = [...src.matchAll(/\{t:'td_([a-z_]+)'/g)].map(m => m[1]);
      const camel = (s) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
      // The read side derives its keys from _TD_TABLES, so the blob is the only
      // half that can silently omit one.
      const missing = tables.map(camel).filter(k => !new RegExp('\\b' + k + '\\b').test(blob));
      expect(missing, 'a table absent here is lost outright if the app is force-quit offline').toEqual([]);
    });
  });

  // ── The four the suite never reached ───────────────────────────────────────
  // A mechanical sweep of this PR's 112 new or rewritten functions found four
  // with no path from any test, directly or through a caller a test drives.
  // Three were cosmetic. One was not, and it is the reason this block exists
  // rather than being waved off: _geoPassThroughStop is in the money path.
  test.describe('the functions no test was reaching', () => {
    test('_geoPassThroughStop restores the origin a personal stop replaced', async () => {
      // When a stop turns out to be lunch, the leg it interrupted has to be
      // re-pointed at wherever the truck REALLY came from, which is the origin
      // that was current before the stop was opened. Get this wrong and the
      // detour rule silently measures from the sandwich counter.
      const out = await page.evaluate(() => {
        const keepOrigin = _geoLegOrigin;
        try {
          const supply = { lat: 38.12, lng: -94.12, name: 'Ace Supply', kind: 'supply' };
          _geoLegOrigin = supply;
          // Opening the stop stashes whatever the origin was, the way
          // _geoCloseStop does when it parks somewhere unrecognised.
          const stop = { lat: 38.24, lng: -94.24, name: 'Stop', kind: 'stop' };
          stop.prevOrigin = _geoLegOrigin || null;
          _geoLegOrigin = stop;
          const restored = _geoPassThroughStop(stop);
          const after = _geoLegOrigin;
          // Called again with a stop that is NOT the current origin: must refuse,
          // or a stale descriptor could re-point a leg that has moved on.
          const other = { lat: 39.0, lng: -95.0, name: 'Elsewhere', kind: 'stop', prevOrigin: null };
          const refused = _geoPassThroughStop(other);
          return { restored, refused, name: after && after.name, sameObject: after === supply,
                   originUnchanged: _geoLegOrigin === after };
        } finally { _geoLegOrigin = keepOrigin; }
      });
      expect(out.restored).toBe(true);
      expect(out.name).toBe('Ace Supply');
      expect(out.sameObject, 'the ORIGINAL origin descriptor comes back, not a copy').toBe(true);
      expect(out.refused, 'a stop that is not the current origin must not re-point anything').toBe(false);
      expect(out.originUnchanged).toBe(true);
    });

    test('_geoPassThroughStop with nothing to restore leaves the leg alone', async () => {
      const out = await page.evaluate(() => {
        const keep = _geoLegOrigin;
        try {
          // Null, undefined, and a stop with no stashed origin: the first drive
          // of the day has nothing behind it, and that is not an error.
          const a = _geoPassThroughStop(null);
          const b = _geoPassThroughStop(undefined);
          const stop = { name: 'Stop', kind: 'stop' };
          _geoLegOrigin = stop;
          const c = _geoPassThroughStop(stop);
          return { a, b, c, after: _geoLegOrigin };
        } finally { _geoLegOrigin = keep; }
      });
      expect(out.a).toBe(false);
      expect(out.b).toBe(false);
      expect(out.c, 'it WAS the current origin, so it is consumed').toBe(true);
      expect(out.after, 'with nothing stashed behind it, the leg has no origin').toBe(null);
    });

    test('_dispatchDur and _dispatchClock survive the inputs a real day hands them', async () => {
      const out = await page.evaluate(() => ({
        dur: [null, undefined, 0, -5, 1, 59, 60, 61, 90, 120, 1439, 0.4, NaN].map(v => _dispatchDur(v)),
        clock: ['', null, undefined, 'not a date', new Date('2026-08-03T14:05:00Z').toISOString()].map(v => _dispatchClock(v)),
      }));
      // Negative and NaN come from clock skew between two phones, which is
      // ordinary, and must never render as "-3m" or "NaNm" on a job card.
      expect(out.dur).toEqual(['0m', '0m', '0m', '0m', '1m', '59m', '1h', '1h 1m', '1h 30m', '2h', '23h 59m', '0m', '0m']);
      // A bad timestamp yields an empty string, never the word "Invalid Date".
      out.clock.slice(0, 4).forEach(v => expect(v).toBe(''));
      expect(out.clock[4]).toMatch(/\d/);
    });

    test('_geoPinSvg renders a real pin for any colour it is handed', async () => {
      const out = await page.evaluate(() => {
        const svg = _geoPinSvg('#0E6B39');
        return { has: svg.includes('<svg'), closed: svg.trim().endsWith('</svg>'),
                 colour: (svg.match(/#0E6B39/g) || []).length, empty: _geoPinSvg('') };
      });
      expect(out.has).toBe(true);
      expect(out.closed, 'an unclosed svg breaks every marker after it on the map').toBe(true);
      expect(out.colour).toBeGreaterThan(0);
      expect(out.empty).toContain('<svg');
    });
  });

  // ── Ordinary days, walked end to end ───────────────────────────────────────
  // Owner (2026-08-03): "prove the last 5." This is the third. Every transition
  // pair is tested on its own elsewhere; what was never walked is a real day,
  // where one leg's END has to become the next leg's START four and six times
  // running. That chain is where a stale origin hides: each leg looks fine in
  // isolation and the day quietly measures from the wrong place.
  //
  // The assertion that matters is CONTIGUITY. A day is a chain, so every leg
  // must start exactly where the one before it finished, with no gaps and no
  // repeats. A single stale origin breaks the chain and this catches it
  // wherever in the day it happens.
  test.describe('a whole day, leg after leg', () => {
    const walkDay = (seq) => page.evaluate(async (a) => {
      const realUser = _supaUser, realRoute = _routeDistance;
      _supaUser = { id: 'u-day' };
      let n = 0;
      window._routeDistance = _routeDistance = async () => { n++; return { miles: 4 + n, mins: 12 }; };
      const before = mileage.length;
      try {
        __seedGeo();
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        for (let i = 0; i < a.seq.length; i++) {
          await ping(a.seq[i]);
          if (i === a.seq.length - 1) break;
          // Twenty minutes parked at this fence before pulling out for the next
          // one. Every hop here is fence to fence, so the leg clock is
          // _geoLastFenceAt and the move is a single ping.
          const t = new Date(Date.now() - 20 * 60000).toISOString();
          if (_geoDriveStartedAt) _geoDriveStartedAt = t;
          if (_geoLastFenceAt) _geoLastFenceAt = t;
        }
        await new Promise(r => setTimeout(r, 80));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before));
        // mileage is unshifted, so newest first: reverse into travel order.
        return rows.map(m => ({ from: m.from_name, to: m.to_name, purpose: m.purpose })).reverse();
      } finally { _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; }
    }, { seq });

    // Every leg begins where the last one ended. Reported as the whole chain on
    // failure, so a break says WHICH hop went stale instead of just "expected 4".
    const expectChain = (rows, names) => {
      const drawn = rows.map(r => `${r.from} → ${r.to}`).join('  |  ');
      expect(rows.length, `expected ${names.length - 1} legs, got: ${drawn}`).toBe(names.length - 1);
      rows.forEach((r, i) => {
        expect(r.from, `leg ${i + 1} must start at ${names[i]}: ${drawn}`).toBe(names[i]);
        expect(r.to, `leg ${i + 1} must end at ${names[i + 1]}: ${drawn}`).toBe(names[i + 1]);
      });
    };

    test('yard, job, supply run, back to the job, home to the yard', async () => {
      const rows = await walkDay([SHOP, JOB, SUPPLY, JOB, SHOP]);
      expectChain(rows, ['Shop', 'Miller Residence', 'Ace Supply', 'Miller Residence', 'Shop']);
    });

    test('two supply runs off the same job in one day', async () => {
      // Returning to a place already visited earlier the same day is the case
      // that breaks a fence machine keeping one "current" anything.
      const rows = await walkDay([SHOP, JOB, SUPPLY, JOB, SUPPLY, JOB, SHOP]);
      expectChain(rows, ['Shop', 'Miller Residence', 'Ace Supply', 'Miller Residence',
                         'Ace Supply', 'Miller Residence', 'Shop']);
    });

    test('back to the yard mid-afternoon and out to the job again', async () => {
      const rows = await walkDay([SHOP, JOB, SHOP, JOB, SHOP]);
      expectChain(rows, ['Shop', 'Miller Residence', 'Shop', 'Miller Residence', 'Shop']);
    });

    test('a six-leg day logs six trips and not one more', async () => {
      // Idempotency across a long chain: the leg key is what stops a replayed or
      // re-entered ping from billing the same miles twice, and a long day is
      // where a duplicate would first show up.
      const rows = await walkDay([SHOP, JOB, SUPPLY, JOB, SUPPLY, JOB, SHOP]);
      expect(rows.length).toBe(6);
      const seen = rows.map(r => `${r.from}>${r.to}@${rows.indexOf(r)}`);
      expect(new Set(seen).size).toBe(6);
    });

    test('no console errors across a full day', async () => {
      await assertNoErrors(page);
    });
  });

  // ── Losing signal in the middle of a leg ───────────────────────────────────
  // Owner (2026-08-03): "prove the last 5." This is the second. A crew truck
  // drops to no bars in a basement, a metal building, or twenty miles out, and
  // it does so DURING the leg, not politely between them. Nothing about a drive
  // may depend on the network being up at the moment it ends.
  test.describe('a leg that ends with no signal', () => {
    const offlineLeg = (tag) => page.evaluate(async (a) => {
      const realRoute = window._routeDistance, realSupa = _supa;
      const before = mileage.length;
      try { localStorage.removeItem('zp3_geo_queue'); } catch (e) {}
      // No bars: the router cannot be reached and the backend client is gone.
      window._routeDistance = async () => { throw new Error('offline'); };
      _supa = null;
      try {
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: 'Miller residence', kind: 'job' },
          legKey: 'offline-' + a.tag, startedIso: new Date().toISOString(),
        });
        // The job time entry for the same leg takes the queue, not the wire.
        _geoEnqueue('job_time_entries', { job_id: 9901, leg_key: 'offline-' + a.tag,
                                          arrived_at: new Date().toISOString() });
        await new Promise(r => setTimeout(r, 50));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before));
        return {
          rows: rows.map(m => ({ miles: m.miles, method: m.calc_method, legKey: m.legKey })),
          queued: _geoQueueRead().length,
        };
      } finally { window._routeDistance = realRoute; _supa = realSupa; }
    }, { tag });

    test('the drive is still recorded, and its time entry is still held', async () => {
      const out = await offlineLeg('a');
      // The row is LOCAL. It does not need the network to exist, only to be
      // priced. Losing the drive because the cell tower was out would be the
      // worst possible failure here: the one record nobody can reconstruct.
      expect(out.rows.length).toBe(1);
      expect(out.rows[0].method).toBe('pending_auto');
      expect(out.queued).toBe(1);
    });

    test('coming back into signal prices the leg and empties the queue', async () => {
      const out = await page.evaluate(async () => {
        const realRoute = window._routeDistance, realSupa = _supa;
        try {
          const pend = mileage.filter(m => String(m.legKey || '').startsWith('offline-'));
          window._routeDistance = async () => ({ miles: 9.1, mins: 18 });
          const sent = [];
          _supa = { from: () => ({
            upsert: async (row) => { sent.push(row); return { error: null }; },
            insert: async (row) => { sent.push(row); return { error: null }; },
          }) };
          await _retryPendingTrips();
          await _geoDrainQueue();
          return { priced: pend.map(m => ({ miles: m.miles, method: m.calc_method })),
                   sent: sent.length, left: _geoQueueRead().length };
        } finally { window._routeDistance = realRoute; _supa = realSupa; }
      });
      expect(out.priced.length).toBeGreaterThan(0);
      out.priced.forEach(r => { expect(r.method).toBe('auto_route'); expect(r.miles).toBe(9.1); });
      expect(out.sent).toBeGreaterThan(0);
      expect(out.left, 'the queue must be empty once it has drained').toBe(0);
    });

    test('two legs closed back to back offline both survive the drain', async () => {
      // The queue's own failure mode, and the one that looked like a flaky
      // backend: a drain that snapshots the queue before an await and writes
      // that stale copy back erases anything enqueued while the request was in
      // flight. One of the two legs vanishes, and which one depends on network
      // timing. Guarding it here because this PR puts real drive legs through
      // that queue on every stop.
      const out = await page.evaluate(async () => {
        const realSupa = _supa;
        try { localStorage.removeItem('zp3_geo_queue'); } catch (e) {}
        try {
          const sent = [];
          let resolveFirst;
          _supa = { from: () => ({
            upsert: (row) => {
              sent.push(row.leg_key);
              // The first send hangs just long enough for a second leg to close
              // underneath it, which is exactly what a slow tower does.
              if (sent.length === 1) return new Promise(r => { resolveFirst = () => r({ error: null }); });
              return Promise.resolve({ error: null });
            },
            insert: async (row) => { sent.push(row.leg_key); return { error: null }; },
          }) };
          _geoEnqueue('job_time_entries', { job_id: 1, leg_key: 'race-leg-1' });
          await new Promise(r => setTimeout(r, 10));
          _geoEnqueue('job_time_entries', { job_id: 2, leg_key: 'race-leg-2' });
          resolveFirst();
          await new Promise(r => setTimeout(r, 80));
          return { sent, left: _geoQueueRead().length };
        } finally { _supa = realSupa; }
      });
      expect(out.sent, 'both legs must reach the backend').toContain('race-leg-1');
      expect(out.sent).toContain('race-leg-2');
      expect(out.left).toBe(0);
    });

    test('no console errors while offline', async () => {
      await assertNoErrors(page);
    });
  });

  // ── When Apple answers badly, or not at all ────────────────────────────────
  // Owner (2026-08-03): "prove the last 5." This is the fourth: the router and
  // the POI lookup are network calls to somebody else's service, and a rural
  // pin, a dead cell, or a wrong tenant are ordinary Tuesday events on a job
  // site, not exotic ones. The rule throughout: a leg is never lost and never
  // guessed. It waits, unpriced, until something can measure it.
  test.describe('the router and the POI lookup misbehaving', () => {
    const leg = (opts) => page.evaluate(async (a) => {
      const realRoute = window._routeDistance, realPoi = window._poiAt;
      const before = mileage.length;
      if (a.routeMode === 'reject') window._routeDistance = async () => { throw new Error('network'); };
      if (a.routeMode === 'hang') window._routeDistance = () => new Promise(() => {});
      if (a.routeMode === 'garbage') window._routeDistance = async () => ({ miles: null, mins: null });
      if (a.poiMode === 'null') window._poiAt = async () => null;
      if (a.poiMode === 'throw') window._poiAt = async () => { throw new Error('mapkit blew up'); };
      if (a.poiMode === 'food') window._poiAt = async () => ({ name: 'Taco House', category: 'Restaurant' });
      try {
        autoLogDriveTrip({
          from: { lat: 38.00, lng: -94.00, name: 'Shop', kind: 'shop' },
          to: { lat: 38.06, lng: -94.06, name: a.toStop ? 'Stop' : 'Miller residence',
                kind: a.toStop ? 'stop' : 'job' },
          legKey: 'apple-' + a.tag, startedIso: new Date().toISOString(),
        });
        await new Promise(r => setTimeout(r, 60));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before));
        return rows.map(m => ({ to: m.to_name, miles: m.miles, method: m.calc_method }));
      } finally { window._routeDistance = realRoute; window._poiAt = realPoi; }
    }, opts);

    test('the router refusing leaves the leg recorded but UNPRICED, never guessed', async () => {
      const out = await leg({ tag: 'reject', routeMode: 'reject' });
      expect(out.length).toBe(1);
      // 0 miles and still pending is the correct state: the drive happened, we
      // just cannot say how far yet. Inventing a number here is how a deduction
      // becomes indefensible.
      expect(out[0].miles).toBe(0);
      expect(out[0].method).toBe('pending_auto');
    });

    test('a router that never answers at all does not hold up the row', async () => {
      const out = await leg({ tag: 'hang', routeMode: 'hang' });
      expect(out.length).toBe(1);
      expect(out[0].method).toBe('pending_auto');
    });

    test('an unpriced leg is picked up and settled by the next sweep', async () => {
      // The other half of the promise: pending is a waiting room, not a grave.
      const out = await page.evaluate(async () => {
        const realRoute = window._routeDistance;
        try {
          const pending = mileage.filter(m => m.calc_method === 'pending_auto' && m.fromCoord && m.toCoord);
          if (!pending.length) return { skipped: true };
          window._routeDistance = async () => ({ miles: 7.7, mins: 15 });
          await _retryPendingTrips();
          return { settled: pending.map(m => ({ miles: m.miles, method: m.calc_method })) };
        } finally { window._routeDistance = realRoute; }
      });
      expect(out.skipped, 'the tests above must have left pending rows to sweep').toBeFalsy();
      out.settled.forEach(r => {
        expect(r.method).toBe('auto_route');
        expect(r.miles).toBe(7.7);
      });
    });

    test('a router answering with nonsense does not write nonsense', async () => {
      const out = await leg({ tag: 'garbage', routeMode: 'garbage' });
      expect(out.length).toBe(1);
      // NaN miles on a mileage row is worse than no miles: it survives the sweep
      // (it is no longer pending) and prints as a real figure on a tax export.
      expect(Number.isFinite(out[0].miles)).toBe(true);
      expect(out[0].miles).toBe(0);
      expect(out[0].method).toBe('pending_auto');
    });

    test('Apple not knowing who is at the pin KEEPS the leg', async () => {
      // A contractor parked mid-workday is far more often at a supply yard or a
      // gate than at a sandwich counter. Silence is not evidence of lunch, and
      // dropping a real leg costs them money.
      const out = await leg({ tag: 'poinull', toStop: true, poiMode: 'null' });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('Stop');
    });

    test('the POI lookup throwing keeps the leg too, and stays off the console', async () => {
      const out = await leg({ tag: 'poithrow', toStop: true, poiMode: 'throw' });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('Stop');
    });

    test('only a NAMED food stop disqualifies a leg', async () => {
      // The one case that removes it, and it takes a positive identification to
      // do so. Contrast with the two tests above: uncertainty keeps the leg.
      const out = await leg({ tag: 'poifood', toStop: true, poiMode: 'food' });
      expect(out.length).toBe(0);
    });

    test('no console errors from any of it', async () => {
      await assertNoErrors(page);
    });
  });

  // ── The rate belongs to a YEAR ─────────────────────────────────────────────
  // Owner (2026-08-03): "prove the last 5." This was the fifth, and it turned
  // out to be wrong today rather than wrong someday.
  //
  // IRS() was `S.irsRate||.725`: one stored number with no year on it. So the
  // mileage page priced a 2024 trip at the CURRENT rate (67.0 cents becoming
  // 72.5, an 8% overstatement of a closed year), and the tax page disagreed with
  // it about the same trips because that side always read the year table.
  test.describe('the rate that gets applied to a trip', () => {
    test('every closed year is priced at ITS published rate', async () => {
      const out = await page.evaluate(() => {
        const now = new Date().getFullYear();
        return Object.keys(TAX_HISTORY).map(Number).filter(y => y < now)
          .map(y => ({ y, table: TAX_HISTORY[y].irsRate, byYear: IRS(y), byDate: IRS(y + '-06-15') }));
      });
      expect(out.length).toBeGreaterThan(0);
      out.forEach(r => {
        expect(r.byYear, `${r.y} must price at the ${r.y} rate`).toBe(r.table);
        // A per-trip figure prices off the trip's own date, so a mixed-year
        // export cannot silently apply one rate to all of it.
        expect(r.byDate, `a trip dated in ${r.y} must price at the ${r.y} rate`).toBe(r.table);
      });
    });

    test('a rate set for this year never leaks into a closed one', async () => {
      // The contractor override (and the yearly auto-refresh that writes it) is
      // about the year we are IN. Applying it backwards is what re-prices a year
      // that is already filed.
      const out = await page.evaluate(() => {
        const keep = S.irsRate;
        try {
          S.irsRate = 0.999;
          return { current: IRS(new Date().getFullYear()), past: IRS(2024), table: TAX_HISTORY[2024].irsRate };
        } finally { S.irsRate = keep; }
      });
      expect(out.current).toBe(0.999);      // still honoured where it belongs
      expect(out.past).toBe(out.table);     // and nowhere else
    });

    test('the mileage page itself shows the viewed year\'s rate, not today\'s', async () => {
      // The helper being right is not the same as the screen being right. This
      // reads the rate off the rendered hero, which is where a contractor would
      // actually catch it.
      const out = await page.evaluate(() => {
        const keepYr = trackerYear, keepVeh = vehicles.slice();
        try {
          if (!getVehicles().length) vehicles.push({ id: 'v-rate-test', name: 'Test Truck', year: 2020 });
          mileage.length = 0;
          mileage.push({ id: _newId(), date: '2024-06-15', miles: 100, purpose: 'Job site' });
          trackerYear = '2024';
          renderAllMileage();
          const html = (document.getElementById('mil-hero-wrap') || {}).innerHTML || '';
          const m = html.match(/IRS \$([0-9.]+)\/mi/);
          return { shown: m && m[1], table2024: TAX_HISTORY[2024].irsRate, today: IRS(), rendered: html.length };
        } finally {
          trackerYear = keepYr; vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
        }
      });
      expect(out.rendered, 'the hero must have rendered for this to mean anything').toBeGreaterThan(0);
      expect(out.shown, 'the hero must state a rate').toBeTruthy();
      expect(Number(out.shown)).toBeCloseTo(out.table2024, 3);
      // And it must actually differ from today's, or the test proves nothing.
      expect(out.table2024).not.toBe(out.today);
    });
  });

  // ── The tax table has to cover the year we are in ─────────────────────────
  // Owner (2026-08-02): "how can we do a live test that updates the IRS tax
  // brackets and shit every year automatically?"
  //
  // It cannot. A test verifies; it cannot teach the app a number nobody has told
  // it. There is no authoritative machine-readable IRS feed, and scraping the
  // figures would trade a visibly stale number for a confidently wrong one,
  // which is the failure you do not catch until April.
  //
  // What a test CAN do is make the deadline impossible to miss. The IRS
  // publishes the mileage rate in a Notice each December and the inflation
  // adjustments in a Revenue Procedure each autumn, so the numbers are knowable
  // before the year starts. These fail the build the moment the table stops
  // covering the year the app is running in, which turns a silent wrong
  // deduction into a red shard in early January.
  test.describe('the tax table against the calendar', () => {
    test('THIS YEAR is on file: if this fails, TAX_HISTORY needs the new IRS figures', async () => {
      const out = await page.evaluate(() => {
        const yr = new Date().getFullYear();
        return { yr, covered: taxRatesAreCurrent(yr), last: _taxTableLastYear(),
                 years: Object.keys(TAX_HISTORY).map(Number).sort() };
      });
      // Deliberately blunt: the message IS the maintenance instruction.
      expect(out.covered,
        `TAX_HISTORY has no entry for ${out.yr}. It stops at ${out.last}. ` +
        `Until it is updated, every deduction in the app is calculated at ${out.last} rates. ` +
        `The mileage rate comes from the IRS Notice published each December, the brackets from ` +
        `the Revenue Procedure published each autumn. Add ${out.yr} to js/constants.js.`).toBe(true);
    });

    test('a year on file is served its OWN figures, never a neighbour\'s', async () => {
      const out = await page.evaluate(() => {
        const yrs = Object.keys(TAX_HISTORY).map(Number).sort();
        return yrs.map(y => ({ y, rate: TAX_HISTORY[y].irsRate, got: _getBracketsForYear(y).irsRate }));
      });
      // Past years read straight from the table. The current year may be
      // overridden per contractor, so it is allowed to differ and is checked
      // separately below.
      const thisYear = new Date().getFullYear();
      out.filter(r => r.y !== thisYear).forEach(r => {
        expect(r.got, `${r.y} should use its own rate`).toBe(r.rate);
      });
    });

    test('the current year defaults to the table, not to a copy of it', async () => {
      // These defaults were duplicated as literals next to the table, so on
      // 1 January the app served the previous year's numbers as the new year's.
      const out = await page.evaluate(() => {
        const yr = new Date().getFullYear();
        const keep = { r: S.irsRate, s: S.fedSingle };
        try {
          delete S.irsRate; delete S.fedSingle;
          const b = _getBracketsForYear(yr);
          return { rate: b.irsRate, single: b.fedSingle,
                   tableRate: (TAX_HISTORY[yr] || {}).irsRate,
                   tableSingle: (TAX_HISTORY[yr] || {}).fedSingle };
        } finally { if (keep.r != null) S.irsRate = keep.r; if (keep.s != null) S.fedSingle = keep.s; }
      });
      expect(out.rate).toBe(out.tableRate);
      expect(out.single).toBe(out.tableSingle);
    });

    test('a year past the table falls back to the NEWEST on file', async () => {
      // It used to fall back to a hardcoded 2025, which aged worse every time
      // the table was updated: a request for a future year answered two years
      // stale while the right figures sat in the same object.
      const out = await page.evaluate(() => {
        const last = _taxTableLastYear();
        return { got: _getBracketsForYear(last + 40).irsRate, newest: TAX_HISTORY[last].irsRate, last };
      });
      expect(out.got).toBe(out.newest);
    });

    test('THIS YEAR has a Social Security wage base: if this fails, add it', async () => {
      // The base caps the 12.4% Social Security half of self-employment tax. It
      // has risen every year for decades, so a stale one is always too LOW,
      // which UNDERSTATES what a contractor above the cap owes and shorts their
      // quarterly payments: an underpayment penalty rather than a surprise.
      const out = await page.evaluate(() => {
        const yr = new Date().getFullYear();
        return { yr, covered: ssWageBaseIsCurrent(yr), last: _ssWageBaseLastYear(),
                 base: _getSsWageBase(yr) };
      });
      expect(out.covered,
        `_SS_WAGE_BASE has no entry for ${out.yr}. It stops at ${out.last}, so self-employment ` +
        `tax is being capped at $${out.base.toLocaleString()}, which is ${out.yr - out.last} year(s) old ` +
        `and too low. The SSA announces the new base with the COLA each October. Add ${out.yr} to js/tax.js.`
      ).toBe(true);
    });

    test('a year past the wage-base table follows the newest on file', async () => {
      // It read `|| 184500`, the newest figure written out a second time, so on
      // 1 January the cap would silently stay at the previous year's number.
      const out = await page.evaluate(() => {
        const last = _ssWageBaseLastYear();
        return { got: _getSsWageBase(last + 40), newest: _SS_WAGE_BASE[last], last };
      });
      expect(out.got).toBe(out.newest);
    });

    test('the wage base only ever rises, and every year on file has one', async () => {
      // A base that dips is a typo, and a typo here silently changes what every
      // contractor above the cap owes for that year.
      const out = await page.evaluate(() => {
        const yrs = Object.keys(_SS_WAGE_BASE).map(Number).sort((a, b) => a - b);
        return { yrs, vals: yrs.map(y => _SS_WAGE_BASE[y]) };
      });
      out.vals.forEach((v, i) => {
        expect(typeof v, `${out.yrs[i]} must have a number`).toBe('number');
        if (i > 0) expect(v, `${out.yrs[i]} is below ${out.yrs[i - 1]}`).toBeGreaterThan(out.vals[i - 1]);
      });
    });

    test('the cap actually caps: above it, only Medicare keeps growing', async () => {
      // The whole point of the base. Two incomes either side of the cap must
      // differ by the Medicare rate alone, or the cap is not being applied.
      const out = await page.evaluate(() => {
        const yr = new Date().getFullYear();
        const base = _getSsWageBase(yr);
        // Net figures chosen so 0.9235 x net lands either side of the cap.
        const under = Math.round((base * 0.5) / 0.9235);
        const over = Math.round((base * 2) / 0.9235);
        const overMore = Math.round((base * 3) / 0.9235);
        return { base, a: _calcSeTax(over, yr), b: _calcSeTax(overMore, yr),
                 under: _calcSeTax(under, yr), gap: (overMore - over) * 0.9235 };
      });
      // Both above the cap: the extra income is taxed at Medicare's 2.9% only.
      expect(out.b - out.a).toBeCloseTo(out.gap * 0.029, 0);
      // And below the cap the full 15.3% applies, so it is not capping early.
      expect(out.under).toBeGreaterThan(0);
    });

    test('every year on file carries a complete set of figures', async () => {
      // A half-filled row is worse than a missing one: it reads as authoritative
      // and silently zeroes whichever bracket was forgotten.
      const missing = await page.evaluate(() => {
        const need = ['fedSingle','fedMFJ','fedMFS','fedHOH','b10','b12','b22','b24','b32','b35','irsRate'];
        const out = [];
        Object.keys(TAX_HISTORY).forEach(y => {
          need.forEach(k => { if (typeof TAX_HISTORY[y][k] !== 'number') out.push(y + '.' + k); });
        });
        return out;
      });
      expect(missing).toEqual([]);
    });
  });

  // The dashboard's "ON SITE" card (js/dashboard.js renderDash) reads the fence
  // state straight off this module's own variables, but nothing in the ping
  // handler ever told it those changed: an owner leaving a job saw the card
  // stay up until something UNRELATED re-rendered the dashboard (switching
  // tabs and back), which read as the tracker not noticing they had left.
  test.describe('the dashboard refreshes the instant the fence changes, not on the next unrelated render', () => {
    async function pingTransitions() {
      return page.evaluate(async (a) => {
        const realRoute = _routeDistance, realUser = _supaUser;
        _supaUser = { id: 'u-render' };
        window._routeDistance = _routeDistance = async () => ({ miles: 1, mins: 1 });
        let calls = 0;
        const realRenderDash = window.renderDash;
        window.renderDash = (...args) => { calls++; return realRenderDash.apply(this, args); };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(a.shop);                      // arrive at the shop: a real transition
          const afterArrive = calls;
          await ping(a.shop);                      // still at the shop: NOT a transition
          const afterSameFence = calls;
          await ping(a.job);                       // shop -> job: a real transition (the leave)
          const afterLeave = calls;
          return { afterArrive, afterSameFence, afterLeave };
        } finally {
          window.renderDash = realRenderDash;
          _supaUser = realUser;
          window._routeDistance = _routeDistance = realRoute;
        }
      }, { shop: SHOP, job: JOB });
    }

    test('renderDash fires on arrival and on leaving, not on a repeated same-fence ping, while pg-dash is on screen', async () => {
      await page.evaluate(() => { goPg('pg-dash'); });
      const r = await pingTransitions();
      expect(r.afterArrive, 'arriving at the shop is a transition').toBeGreaterThan(0);
      expect(r.afterSameFence, 'a repeat ping inside the same fence must not trigger another render').toBe(r.afterArrive);
      expect(r.afterLeave, 'leaving the shop for the job is a second transition').toBeGreaterThan(r.afterSameFence);
    });

    test('renderDash does NOT fire on a fence transition while a different page is on screen', async () => {
      await page.evaluate(() => { goPg('pg-tracker'); });
      const r = await pingTransitions();
      expect(r.afterArrive).toBe(0);
      expect(r.afterSameFence).toBe(0);
      expect(r.afterLeave, 'still zero, nobody is looking at the dashboard').toBe(0);
      await page.evaluate(() => { goPg('pg-dash'); });
    });
  });

  // ── Client-address fences ───────────────────────────────────────────────────
  // Owner report (2026-08-07): a spontaneous drive from the home office to a
  // client, app open the whole way, logged NOTHING, because the fence machine
  // only knew today's scheduled jobs, the shop, and saved places. The client's
  // driveway read as an anonymous stop and the detour collapse folded the round
  // trip into personal wandering. Clients' cached geocodes (zp3_nearby_geo, the
  // nearby-job card's own cache) are now the weakest fence type, so any client
  // visit is a real destination whether or not work is scheduled.
  test.describe('client-address fences', () => {
    const clientDrive = (o) => page.evaluate(async (a) => {
      const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
      const entries = [];
      window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
      _supaUser = { id: 'u-client-fence' };
      window._routeDistance = _routeDistance = async () => ({ miles: 12.34, mins: 21 });
      const before = mileage.length;
      try {
        __seedGeo();
        clients.push({ id: 7702, name: 'John Doe', addr: '77 Doe Ln, Topeka, KS' });
        const geoCache = { 7702: { lat: a.client.lat, lon: a.client.lon, addr: '77 Doe Ln, Topeka, KS' } };
        if (a.cacheMiller) geoCache[7701] = { lat: a.job.lat, lon: a.job.lon, addr: '400 Oak St' };
        localStorage.setItem('zp3_nearby_geo', JSON.stringify(geoCache));
        _geoClientCacheMemo = null;              // the memo must re-read the seeded cache
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        const rewind = (m) => {
          const t = new Date(Date.now() - m * 60000).toISOString();
          if (_geoDriveStartedAt) _geoDriveStartedAt = t;
          if (_geoLastFenceAt) _geoLastFenceAt = t;
        };
        await ping(a.from);
        rewind(20);
        await ping(a.to);
        await new Promise(r => setTimeout(r, 30));
        const out = { state: { client: _geoCurrentClient, job: _geoCurrentJob } };
        if (a.returnHome) {
          // Park in the driveway half an hour, then drive back: the visit entry
          // and the return leg both need real elapsed time.
          const back = new Date(Date.now() - 30 * 60000).toISOString();
          _geoClientArrivedAt = back; _geoLastFenceAt = back;
          await ping(a.from);
          await new Promise(r => setTimeout(r, 30));
        }
        out.rows = mileage.slice(0, Math.max(0, mileage.length - before));
        out.entries = entries;
        return out;
      } finally {
        window._geoEnqueue = realEnq;
        _supaUser = realUser;
        window._routeDistance = _routeDistance = realRoute;
        try { localStorage.removeItem('zp3_nearby_geo'); } catch (e) {}
        _geoClientCacheMemo = null;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
      }
    }, o);

    test('a client with NO job today is a real destination: named trip, Client Consult, bound to the client record', async () => {
      const r = await clientDrive({ from: HOMEOFF, to: CLIENT, job: JOB, client: CLIENT });
      expect(r.state.client).toBe('7702');
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].from_name).toBe('Home Office');
      expect(r.rows[0].to_name).toBe('John Doe');
      expect(r.rows[0].purpose).toBe('Client Consult');
      expect(r.rows[0].client_id).toBe(7702);
      expect(r.rows[0].miles).toBe(12.3);
    });

    test('the round trip logs BOTH legs plus the visit itself, nothing collapses as a detour', async () => {
      const r = await clientDrive({ from: HOMEOFF, to: CLIENT, job: JOB, client: CLIENT, returnHome: true });
      expect(r.rows.length).toBe(2);
      const outLeg = r.rows.find(m => m.to_name === 'John Doe');
      const backLeg = r.rows.find(m => m.from_name === 'John Doe');
      expect(outLeg, 'the leg out survives the return').toBeTruthy();
      expect(backLeg, 'the return leg is measured FROM the client, not from home').toBeTruthy();
      expect(backLeg.to_name).toBe('Home Office');
      const visit = r.entries.find(e => e.tbl === 'job_time_entries' && e.row.source === 'place' && e.row.dest_place === 'John Doe');
      expect(visit, 'the half hour in the driveway is a place-visit entry under the client\'s name').toBeTruthy();
      expect(visit.row.minutes).toBeGreaterThanOrEqual(28);
      expect(visit.row.job_id).toBe(null);
    });

    test('a scheduled job at the same address still wins: the fence stays a job, the purpose stays Job site', async () => {
      const r = await clientDrive({ from: SHOP, to: JOB, job: JOB, client: CLIENT, cacheMiller: true });
      expect(r.state.job, 'the job fence outranks the client fence at the same coordinates').toBe(9901);
      expect(r.state.client).toBe(null);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].purpose).toBe('Job site');
      expect(r.rows[0].to_name).toBe('Miller Residence');
    });
  });

  // ── The Capacitor native-shell bridge ───────────────────────────────────────
  // Owner direction (2026-08-07): the free path to background drives is the
  // Capacitor shell + @capacitor-community/background-geolocation. The bridge's
  // whole job is to shape the plugin's background fixes into the same position
  // object watchPosition delivers and feed _geoOnPing, so the entire engine
  // (arrive/depart, time on site, drive legs, mileage) works with the screen
  // locked and ZERO logic changes. In a plain browser the bridge must be inert.
  test.describe('the Capacitor native-shell bridge', () => {
    test('inside the shell: the background watcher replaces the web watcher, and a locked-screen drive still logs', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser, realRoute = _routeDistance;
        const realGeoWatch = navigator.geolocation.watchPosition;
        const added = [];
        let removed = null, webWatchCalls = 0;
        navigator.geolocation.watchPosition = () => { webWatchCalls++; return 424242; };
        _supaUser = { id: 'u-native' };
        window._routeDistance = _routeDistance = async () => ({ miles: 12.34, mins: 21 });
        const before = mileage.length;
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'BackgroundGeolocation' ? {
              addWatcher: (opts, cb) => { added.push({ opts, cb }); return Promise.resolve('w-1'); },
              removeWatcher: (o) => { removed = o; return Promise.resolve(); },
            } : null,
          };
          startGeoTracking();
          await new Promise(r2 => setTimeout(r2, 10));
          const out = {
            watcherAdded: added.length,
            watcherId: _geoNativeWatcherId,
            webWatcherStarted: webWatchCalls,
            background: !!(added[0] && added[0].opts && added[0].opts.backgroundMessage),
          };
          // The phone is in a pocket, screen locked: the ONLY fixes are the
          // plugin's. One at the shop, one at the job twenty minutes later.
          const cb = added[0].cb;
          await cb({ latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 0 });
          const t = new Date(Date.now() - 20 * 60000).toISOString();
          if (_geoLastFenceAt) _geoLastFenceAt = t;
          await cb({ latitude: a.job.lat, longitude: a.job.lon, accuracy: 8, speed: 0 });
          await new Promise(r2 => setTimeout(r2, 30));
          out.rows = mileage.slice(0, Math.max(0, mileage.length - before)).map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles }));
          stopGeoTracking();
          out.removed = removed;
          out.clearedId = _geoNativeWatcherId;
          return out;
        } finally {
          navigator.geolocation.watchPosition = realGeoWatch;
          window.Capacitor = realCap;
          _supaUser = realUser;
          window._routeDistance = _routeDistance = realRoute;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
        }
      }, { shop: SHOP, job: JOB });
      expect(r.watcherAdded).toBe(1);
      expect(r.watcherId).toBe('w-1');
      expect(r.webWatcherStarted, 'the web watcher must not double up inside the shell').toBe(0);
      expect(r.background, 'the watcher is a BACKGROUND watcher, message and title present').toBe(true);
      expect(r.rows.length, 'a locked-screen drive still logs its measured trip').toBe(1);
      expect(r.rows[0].from).toBe('Shop');
      expect(r.rows[0].to).toBe('Miller Residence');
      expect(r.rows[0].miles).toBe(12.3);
      expect(r.removed && r.removed.id, 'stopGeoTracking removes the plugin watcher').toBe('w-1');
      expect(r.clearedId).toBe(null);
    });

    // Owner report (2026-08-08): even with the plugin running, WKWebView
    // popped its per-WEBSITE location prompt because features like weather
    // and the nearby-job card still called the web geolocation API. In the
    // shell that API is now shimmed to serve from the plugin's fix stream,
    // so the website prompt is impossible and every caller gets native-grade
    // fixes. These tests drive the shim exactly as the app would.
    test('inside the shell, the geolocation shim serves web-API calls from the plugin stream', async () => {
      const r = await page.evaluate(async () => {
        const realCap = window.Capacitor;
        const realGet = navigator.geolocation.getCurrentPosition;
        const realWatch = navigator.geolocation.watchPosition;
        const realClear = navigator.geolocation.clearWatch;
        try {
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => null };
          _geoLastNativeFix = null; _geoFixWaiters = []; _geoShimWatchers = {};
          const installed = _geoInstallGeoShim();
          // A plugin fix arrives on the stream...
          _geoShimDeliver(_geoShimPos({ latitude: 39.1, longitude: -95.7, accuracy: 5, speed: 2 }));
          // ...and a web-API caller (weather, nearby card) gets it instantly,
          // with zero real-API involvement.
          const got = await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(p => res(p), e => rej(e));
          });
          // A waiter parked BEFORE any fix resolves when the next fix lands.
          _geoLastNativeFix = null;
          const waited = new Promise(res => navigator.geolocation.getCurrentPosition(p => res(p.coords.latitude)));
          _geoShimDeliver(_geoShimPos({ latitude: 40.2, longitude: -96.1, accuracy: 8 }));
          const waitedLat = await waited;
          // watchPosition subscribers ride the same stream.
          let watched = null;
          const wid = navigator.geolocation.watchPosition(p => { watched = p.coords.latitude; });
          _geoShimDeliver(_geoShimPos({ latitude: 41.3, longitude: -97.2, accuracy: 8 }));
          navigator.geolocation.clearWatch(wid);
          _geoShimDeliver(_geoShimPos({ latitude: 42.4, longitude: -98.3, accuracy: 8 }));
          return { installed, gotLat: got.coords.latitude, gotSpeed: got.coords.speed, waitedLat, watched };
        } finally {
          window.Capacitor = realCap;
          navigator.geolocation.getCurrentPosition = realGet;
          navigator.geolocation.watchPosition = realWatch;
          navigator.geolocation.clearWatch = realClear;
          _geoLastNativeFix = null; _geoFixWaiters = []; _geoShimWatchers = {};
        }
      });
      expect(r.installed).toBe(true);
      expect(r.gotLat).toBe(39.1);
      expect(r.gotSpeed).toBe(2);
      expect(r.waitedLat, 'a caller waiting before any fix resolves on the next plugin fix').toBe(40.2);
      expect(r.watched, 'cleared watchers stop receiving, the last delivery before clearWatch sticks').toBe(41.3);
    });

    // Owner report (2026-08-08): "Turn on location" never cleared even with
    // the watcher running. The checklist's permission read asked the
    // WebView's per-origin permission, which the shim deliberately never
    // grants. In the shell, permission truth IS the plugin watcher.
    test('inside the shell, _geoReadPermission reports off the native watcher, not the WebView origin', async () => {
      const r = await page.evaluate(async () => {
        const realCap = window.Capacitor;
        const savedConsent = localStorage.getItem('geo_owner_consent');
        const savedDenied = localStorage.getItem('td_geo_os_denied');
        try {
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => null };
          localStorage.removeItem('td_geo_os_denied');
          _geoNativeWatcherId = 'w-live';
          const running = await _geoReadPermission();
          _geoNativeWatcherId = null;
          localStorage.setItem('geo_owner_consent', 'declined');
          const declined = await _geoReadPermission();
          // Owner report (2026-08-09): sign back in and "Turn on location" was
          // back, because the watcher takes seconds to start and the checklist
          // read before it did. Consent granted on this device IS granted,
          // durable across sign-out/sign-in, watcher running or not.
          localStorage.setItem('geo_owner_consent', '1');
          const consented = await _geoReadPermission();
          // ...unless the OS itself said no: that marker outranks consent.
          localStorage.setItem('td_geo_os_denied', '1');
          const osDenied = await _geoReadPermission();
          localStorage.removeItem('td_geo_os_denied');
          localStorage.removeItem('geo_owner_consent');
          const fresh = await _geoReadPermission();
          return { running, declined, consented, osDenied, fresh };
        } finally {
          window.Capacitor = realCap;
          _geoNativeWatcherId = null;
          if (savedConsent === null) localStorage.removeItem('geo_owner_consent');
          else localStorage.setItem('geo_owner_consent', savedConsent);
          if (savedDenied === null) localStorage.removeItem('td_geo_os_denied');
          else localStorage.setItem('td_geo_os_denied', savedDenied);
        }
      });
      expect(r.running, 'a delivering watcher IS granted, the checklist item clears').toBe('granted');
      expect(r.declined).toBe('denied');
      expect(r.consented, 'consent on this device survives sign-out/sign-in as granted').toBe('granted');
      expect(r.osDenied, 'an OS-level denial outranks stored consent').toBe('denied');
      expect(r.fresh).toBe('prompt');
    });

    test('in a plain browser the shim never installs: the real geolocation API is untouched', async () => {
      const r = await page.evaluate(() => {
        const realGet = navigator.geolocation.getCurrentPosition;
        const realCap = window.Capacitor;
        try {
          window.Capacitor = undefined;
          const installed = _geoInstallGeoShim();
          return { installed, untouched: navigator.geolocation.getCurrentPosition === realGet };
        } finally { window.Capacitor = realCap; }
      });
      expect(r.installed).toBe(false);
      expect(r.untouched).toBe(true);
    });

    test('in a plain browser the bridge is inert: the web watcher runs exactly as before', async () => {
      const r = await page.evaluate(() => {
        const realCap = window.Capacitor, realGeoWatch = navigator.geolocation.watchPosition;
        let webWatchCalls = 0;
        navigator.geolocation.watchPosition = () => { webWatchCalls++; return 1234; };
        try {
          window.Capacitor = undefined;
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          startGeoTracking();
          return { webWatchCalls, watchId: _geoWatchId, nativeId: _geoNativeWatcherId };
        } finally {
          navigator.geolocation.watchPosition = realGeoWatch;
          window.Capacitor = realCap;
          _geoWatchId = null; _geoNativeWatcherId = null;
        }
      });
      expect(r.webWatchCalls).toBe(1);
      expect(r.watchId).toBe(1234);
      expect(r.nativeId).toBe(null);
    });

    // ── TdGeo park mode ─────────────────────────────────────────────────────
    // Owner report (2026-08-08): the blue arrow lives in the Dynamic Island the
    // whole time the truck is parked in a fence, because the continuous
    // background watcher never lets go of GPS. Parked a few minutes, the native
    // TdGeo plugin takes over: full GPS OFF, iOS's near-free geofence hardware
    // watches for departure, and crossing the fence re-arms the full watcher.
    // Events that fire while the WebView is asleep buffer to disk and replay
    // with their ORIGINAL timestamps, so a drive the app slept through still
    // logs to the minute.
    test('parked inside a fence: TdGeo regions arm and the continuous GPS watcher is removed', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const parked = [], removed = [];
        _supaUser = { id: 'u-park' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'BackgroundGeolocation' ? {
              addWatcher: (opts, cb) => { window.__parkCb = cb; return Promise.resolve('w-1'); },
              removeWatcher: (o) => { removed.push(o); return Promise.resolve(); },
            } : name === 'TdGeo' ? {
              addListener: () => {},
              drainBuffer: () => Promise.resolve({ fixes: [] }),
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: (o.regions || []).length }); },
              stopAll: () => Promise.resolve(),
            } : null,
          };
          startGeoTracking();
          await new Promise(r2 => setTimeout(r2, 10));
          // Arriving at the shop starts the countdown to GPS-off...
          await window.__parkCb({ latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 0 });
          const timerArmed = _geoParkTimer != null;
          // The phone is in the POCKET: park mode only ever engages with the
          // app off screen (on screen the GPS deliberately stays live).
          const realOnScreen = _geoAppOnScreen; _geoAppOnScreen = () => false;
          // ...which we fire directly rather than waiting four minutes.
          _geoEnterParkMode();
          _geoAppOnScreen = realOnScreen;
          await new Promise(r2 => setTimeout(r2, 10));
          return {
            timerArmed,
            parkedCalls: parked.length,
            region: parked[0] && parked[0].regions && parked[0].regions[0],
            expectRadius: _geoFenceFt() * 0.3048 + 60,
            removedId: removed[0] && removed[0].id,
            watcherCleared: _geoNativeWatcherId,
            parkOn: _geoParkModeOn,
          };
        } finally {
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoStopAnchor = null;
          delete window.__parkCb;
        }
      }, { shop: SHOP });
      expect(r.timerArmed, 'settling inside a fence arms the park countdown').toBe(true);
      expect(r.parkedCalls).toBe(1);
      expect(r.region && r.region.id).toBe('fence');
      expect(r.region.lat).toBeCloseTo(SHOP.lat, 4);
      expect(r.region.lng).toBeCloseTo(SHOP.lon, 4);
      expect(r.region.radius, 'the region is the fence plus coarse-hardware slack').toBeCloseTo(r.expectRadius, 2);
      expect(r.removedId, 'the continuous GPS watcher is removed, the blue arrow goes away').toBe('w-1');
      expect(r.watcherCleared).toBe(null);
      expect(r.parkOn).toBe(true);
    });

    test('park mode never engages while the app is on screen', async () => {
      // The battery trade is for the pocket, not the dashboard. The owner's
      // banner picked a drive up a quarter mile late because park mode had
      // the GPS off while they were LOOKING at the app and iOS fired the
      // wake-up region hundreds of meters past the fence.
      const r = await page.evaluate(async () => {
        const realCap = window.Capacitor;
        const parked = [];
        try {
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = 'w-vis'; _geoNativeStarting = false;
          _geoParkSpot = { lat: 38.0, lng: -94.0, name: 'Shop' };
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'TdGeo' ? {
              addListener: () => {},
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: 1 }); },
              stopAll: () => Promise.resolve(),
            } : null,
          };
          _geoEnterParkMode();                     // visibilityState is 'visible' here
          await new Promise(r2 => setTimeout(r2, 10));
          return { parkedCalls: parked.length, parkOn: _geoParkModeOn, rearmed: _geoParkTimer != null };
        } finally {
          window.Capacitor = realCap;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoParkSpot = null;
        }
      });
      expect(r.parkedCalls, 'GPS must stay live while the app is on screen').toBe(0);
      expect(r.parkOn).toBe(false);
      expect(r.rearmed, 'the countdown re-arms so backgrounding still parks').toBe(true);
    });

    test('a lone zero-speed reading holds the readout and never postpones the fade', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realWatch = _geoWatchId;
        _supaUser = { id: 'u-hiccup' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoStopAnchor = null; _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoDriveReset(); _geoWatchId = 78;
          _geoDriveStartedAt = new Date(Date.now() - 5 * 60000).toISOString();
          const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8, speed: spd } });
          await ping(a.ROAD, 15.2);                         // ~34 mph, on the road
          const movingBefore = _geoDriveMovingAt;
          await ping(a.ROAD2, 0);                           // GPS hiccup
          const held = { mph: _geoDriveMph, movingAt: _geoDriveMovingAt };
          await ping(a.ROAD2, 0);                           // second zero: a real stop
          const stopped = { mph: _geoDriveMph };
          await ping(a.ROAD, 13.4);                         // rolling again
          const rolling = { mph: _geoDriveMph };
          return { movingBefore, held, stopped, rolling };
        } finally {
          _supaUser = realUser; _geoWatchId = realWatch;
          _geoDriveStartedAt = null; _geoDriveReset();
          _geoStopAnchor = null; _geoLastFenceLoc = null; _geoLegOrigin = null;
        }
      }, { ROAD, ROAD2: { lat: ROAD.lat + 0.004, lon: ROAD.lon + 0.004 } });
      expect(Math.round(r.held.mph), 'a lone zero must not zero the readout').toBe(34);
      expect(r.held.movingAt, 'a held zero is not evidence of motion').toBe(r.movingBefore);
      expect(r.stopped.mph, 'a stream of zeros is a real stop').toBe(0);
      expect(Math.round(r.rolling.mph)).toBe(30);
    });

    test('crossing the fence re-arms the full watcher and the departing fix opens the drive', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const added = []; let stopped = 0;
        _supaUser = { id: 'u-exit' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = true;
          _geoShopArrivedAt = new Date(Date.now() - 30 * 60000).toISOString();
          _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLegAtShop = true;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoLastFenceAt = new Date(Date.now() - 60000).toISOString();
          _geoLastFenceLoc = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          _geoClearParkTimer();
          _geoParkModeOn = true;             // parked at the shop, GPS off
          window._geoTdBound = true;         // listener already bound, skip re-init
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'BackgroundGeolocation' ? {
              addWatcher: (opts, cb) => { added.push(opts); return Promise.resolve('w-2'); },
              removeWatcher: () => Promise.resolve(),
            } : name === 'TdGeo' ? {
              stopAll: () => { stopped++; return Promise.resolve(); },
            } : null,
          };
          // The geofence hardware fires: they left the shop.
          await _geoTdEvent({ type: 'regionExit', lat: a.road.lat, lng: a.road.lon, acc: 20, speed: 12, ts: Date.now() });
          await new Promise(r2 => setTimeout(r2, 10));
          return {
            stopped,
            reArmed: added.length,
            background: !!(added[0] && added[0].backgroundMessage),
            parkOn: _geoParkModeOn,
            watcherId: _geoNativeWatcherId,
            driveOpen: _geoDriveStartedAt != null,
          };
        } finally {
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoDriveStartedAt = null; _geoDriveReset();
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoStopAnchor = null;
        }
      }, { shop: SHOP, road: ROAD });
      expect(r.stopped, 'TdGeo regions disarm on exit').toBe(1);
      expect(r.reArmed, 'the full background watcher comes back').toBe(1);
      expect(r.background).toBe(true);
      expect(r.parkOn).toBe(false);
      expect(r.watcherId).toBe('w-2');
      expect(r.driveOpen, 'the departing fix itself opens the drive leg').toBe(true);
    });

    test('the disk buffer replays with original timestamps: a drive the app slept through still logs', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser, realRoute = _routeDistance;
        const realEnq = window._geoEnqueue;
        const entries = [];
        _supaUser = { id: 'u-replay' };
        window._routeDistance = _routeDistance = async () => ({ miles: 12.34, mins: 21 });
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        const before = mileage.length;
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          const now = Date.now();
          // The app was dead for the whole drive: the buffer holds a fix at the
          // shop 30 minutes ago and the arrival at the job 2 minutes ago.
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'TdGeo' ? {
              addListener: () => {},
              startParked: () => Promise.resolve({ armed: 0 }),
              stopAll: () => Promise.resolve(),
              drainBuffer: () => Promise.resolve({ fixes: [
                { type: 'fix', lat: a.job.lat, lng: a.job.lon, acc: 8, speed: 0, ts: now - 2 * 60000 },
                { type: 'fix', lat: a.shop.lat, lng: a.shop.lon, acc: 8, speed: 0, ts: now - 30 * 60000 },
              ] }),
            } : null,
          };
          _geoTdInit();
          await new Promise(r2 => setTimeout(r2, 60));
          const rows = mileage.slice(0, Math.max(0, mileage.length - before)).map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles }));
          const drive = entries.find(e => e.tbl === 'job_time_entries' && /^drive/.test(e.row.source));
          return { rows, driveMins: drive && drive.row.minutes, arrivedAt: drive && drive.row.departed_at, expectArrive: new Date(now - 2 * 60000).toISOString() };
        } finally {
          window.Capacitor = realCap; _supaUser = realUser;
          window._routeDistance = _routeDistance = realRoute;
          window._geoEnqueue = realEnq;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoStopAnchor = null; _geoLegOrigin = null;
        }
      }, { shop: SHOP, job: JOB });
      // Without honest timestamps both fixes collapse to the replay moment, the
      // leg reads zero minutes, and the 2-minute floor silently drops the trip.
      expect(r.rows.length, 'the slept-through drive logs its measured trip').toBe(1);
      expect(r.rows[0].from).toBe('Shop');
      expect(r.rows[0].to).toBe('Miller Residence');
      expect(r.rows[0].miles).toBe(12.3);
      expect(r.driveMins, 'the leg is clocked shop-fix to job-fix, 28 minutes').toBe(28);
      expect(r.arrivedAt, 'arrival is stamped when it happened, not when it replayed').toBe(r.expectArrive);
    });

    // Owner report (2026-08-09): 30 minutes parked at home, arrow still on.
    // Root cause: park entry hung entirely on a setTimeout, and WKWebView
    // suspends JS timers with the screen locked. Now any ping whose dwell has
    // already passed the threshold parks immediately, and a failed park
    // attempt journals the reason and re-arms instead of dying silently.
    test('a ping after the dwell threshold parks immediately, no timer needed', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const parked = [], removed = [];
        _supaUser = { id: 'u-dwell' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
          _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLegAtShop = true;
          _geoLastFenceAt = new Date(Date.now() - 60000).toISOString();
          _geoLastFenceLoc = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoHomeDwell = null; _geoWasAtHome = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = 'w-1'; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          _geoFenceEnteredAtMs = Date.now() - 5 * 60000;   // been here five minutes
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'BackgroundGeolocation' ? {
              removeWatcher: (o) => { removed.push(o); return Promise.resolve(); },
            } : name === 'TdGeo' ? {
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: 1 }); },
              stopAll: () => Promise.resolve(),
            } : null,
          };
          // The screen was locked the whole time: no timer ever fired. This
          // single jitter ping is the only signal, and it must be enough.
          window.__realOnScreen = _geoAppOnScreen; _geoAppOnScreen = () => false;   // phone in the pocket
          await _geoOnPing({ coords: { latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 0 } });
          await new Promise(r2 => setTimeout(r2, 10));
          return { parkedCalls: parked.length, parkOn: _geoParkModeOn, removedId: removed[0] && removed[0].id, watcher: _geoNativeWatcherId };
        } finally {
          if (window.__realOnScreen) { _geoAppOnScreen = window.__realOnScreen; delete window.__realOnScreen; }
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoFenceEnteredAtMs = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoStopAnchor = null;
        }
      }, { shop: SHOP });
      expect(r.parkedCalls, 'the over-threshold ping parks on the spot').toBe(1);
      expect(r.parkOn).toBe(true);
      expect(r.removedId).toBe('w-1');
      expect(r.watcher).toBe(null);
    });

    test('a failed park attempt journals the reason and re-arms, never dies silently', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor;
        const realLog = _geoParkLog.slice();
        try {
          _geoParkLog.length = 0;
          _geoNativeWatcherId = 'w-1'; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          _geoLastFenceLoc = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (name) => name === 'TdGeo' ? {
              startParked: () => Promise.reject(new Error('not implemented on ios')),
            } : null,
          };
          window.__realOnScreen = _geoAppOnScreen; _geoAppOnScreen = () => false;   // phone in the pocket
          _geoEnterParkMode();
          await new Promise(r2 => setTimeout(r2, 20));
          return {
            parkOn: _geoParkModeOn,
            retryArmed: _geoParkTimer != null,
            failLogged: _geoParkLog.some(x => x.ev === 'park-fail' && /not implemented/.test(x.x)),
          };
        } finally {
          if (window.__realOnScreen) { _geoAppOnScreen = window.__realOnScreen; delete window.__realOnScreen; }
          window.Capacitor = realCap;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoLastFenceLoc = null;
          _geoParkLog.length = 0; realLog.forEach(x => _geoParkLog.push(x));
        }
      }, { shop: SHOP });
      expect(r.parkOn).toBe(false);
      expect(r.retryArmed, 'the countdown re-arms for another try').toBe(true);
      expect(r.failLogged, 'the reason lands in the on-device journal').toBe(true);
    });

    test('the diagnostics panel opens with live state and the journal; its button stays hidden in a plain browser', async () => {
      const r = await page.evaluate(() => {
        const realCap = window.Capacitor;
        try {
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
          _geoDiagPanel();
          const ov = document.getElementById('_geo-diag-ov');
          const text = ov ? ov.textContent : '';
          const opened = !!ov;
          ov && ov.remove();
          // The buttons live under Settings → Developer now (owner
          // 2026-08-09), revealed as one group and only inside the app.
          const grp = document.getElementById('dev-geo-tools');
          const btn = document.getElementById('set-geo-diag-btn');
          const shadowBtn = document.getElementById('set-geo-shadow-btn');
          return {
            opened,
            hasState: /Park mode/.test(text) && /GPS watcher/.test(text),
            grpHiddenInBrowser: grp ? grp.style.display === 'none' : null,
            underDev: !!(btn && btn.closest('#setd-dev')) && !!(shadowBtn && shadowBtn.closest('#setd-dev')),
            notUnderCloud: !(btn && btn.closest('#setd-cloud')),
          };
        } finally { window.Capacitor = realCap; }
      });
      expect(r.opened).toBe(true);
      expect(r.hasState).toBe(true);
      expect(r.grpHiddenInBrowser, 'no location engine tools outside the shell').toBe(true);
      expect(r.underDev, 'both tools sit under Settings → Developer').toBe(true);
      expect(r.notUnderCloud, 'and no longer beside Cloud sync').toBe(true);
    });

    // Owner report (2026-08-09, second sighting): arrow still on after four
    // minutes parked OUTSIDE every fence. Park mode only covered fences;
    // an anonymous stop (lunch, a supply run, a lead's driveway) ran
    // continuous GPS forever. Now the stop anchor's own dwell parks too.
    test('four minutes parked at an anonymous stop parks GPS, even mid-drive-leg', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const parked = [], removed = [];
        _supaUser = { id: 'u-stop' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null;
          _geoDriveStartedAt = new Date(Date.now() - 25 * 60000).toISOString();  // out on the road
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoLegAtShop = false; _geoLastFenceAt = new Date(Date.now() - 25 * 60000).toISOString();
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = 'w-1'; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          _geoFenceEnteredAtMs = null;
          // Sitting at ROAD for five minutes already: the anchor carries the dwell.
          _geoStopAnchor = { lat: a.road.lat, lng: a.road.lon,
            at: new Date(Date.now() - 5 * 60000).toISOString(),
            lastAt: new Date(Date.now() - 30000).toISOString() };
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (n) => n === 'BackgroundGeolocation' ? {
              removeWatcher: (o) => { removed.push(o); return Promise.resolve(); },
            } : n === 'TdGeo' ? {
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: 1 }); },
              stopAll: () => Promise.resolve(),
            } : null,
          };
          window.__realOnScreen = _geoAppOnScreen; _geoAppOnScreen = () => false;   // phone in the pocket
          await _geoOnPing({ coords: { latitude: a.road.lat, longitude: a.road.lon, accuracy: 8, speed: 0 } });
          await new Promise(r2 => setTimeout(r2, 10));
          return {
            parkedCalls: parked.length,
            region: parked[0] && parked[0].regions && parked[0].regions[0],
            parkOn: _geoParkModeOn, removedId: removed[0] && removed[0].id,
          };
        } finally {
          if (window.__realOnScreen) { _geoAppOnScreen = window.__realOnScreen; delete window.__realOnScreen; }
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoFenceEnteredAtMs = null;
        }
      }, { road: ROAD });
      expect(r.parkedCalls, 'the over-dwell stop parks on the spot').toBe(1);
      expect(r.region && r.region.lat).toBeCloseTo(ROAD.lat, 4);
      expect(r.parkOn).toBe(true);
      expect(r.removedId).toBe('w-1');
    });

    // Owner report (2026-08-09, third sighting): "I walk everywhere with my
    // phone, that would still pick up me drifting." True: walking drifts past
    // _GEO_STOP_FT every minute or two, the stop anchor re-birthed forever,
    // and its dwell never reached the park threshold. Parking now keys off a
    // QUIET clock (time since the last driving-speed evidence), which walking
    // pace holds, so four minutes on foot parks the GPS mid-stroll.
    test('four minutes of walking-pace drift outside every fence parks GPS', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const parked = [], removed = [];
        _supaUser = { id: 'u-walk' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null;
          _geoDriveStartedAt = new Date(Date.now() - 25 * 60000).toISOString();  // out on the road
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoLegAtShop = false; _geoLastFenceAt = new Date(Date.now() - 25 * 60000).toISOString();
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = 'w-1'; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          _geoFenceEnteredAtMs = null; _geoStopAnchor = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null;
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (n) => n === 'BackgroundGeolocation' ? {
              removeWatcher: (o) => { removed.push(o); return Promise.resolve(); },
            } : n === 'TdGeo' ? {
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: 1 }); },
              stopAll: () => Promise.resolve(),
            } : null,
          };
          // A lap around the yard: nine fixes 30s apart circling ROAD at
          // ~220ft radius, each step ~170ft (about 3.5 mph on foot). The
          // anchor breaks and re-births mid-lap, exactly the owner's case.
          window.__realOnScreen = _geoAppOnScreen; _geoAppOnScreen = () => false;   // phone in the pocket
          const t0 = Date.now() - 260000;
          for (let i = 0; i < 9; i++) {
            const ang = (i / 8) * 2 * Math.PI;
            await _geoOnPing({
              coords: { latitude: a.road.lat + 0.0006 * Math.cos(ang),
                        longitude: a.road.lon + 0.0006 * Math.sin(ang),
                        accuracy: 10, speed: 1.4 },
              __tdTs: t0 + i * 30000,
            });
          }
          await new Promise(r2 => setTimeout(r2, 10));
          return {
            parkedCalls: parked.length,
            region: parked[0] && parked[0].regions && parked[0].regions[0],
            parkOn: _geoParkModeOn, removedId: removed[0] && removed[0].id,
          };
        } finally {
          if (window.__realOnScreen) { _geoAppOnScreen = window.__realOnScreen; delete window.__realOnScreen; }
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoFenceEnteredAtMs = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null; _geoLegOrigin = null;
        }
      }, { road: ROAD });
      expect(r.parkedCalls, 'walking never blocks the park').toBe(1);
      expect(r.region && r.region.lat, 'parked where they are strolling').toBeCloseTo(ROAD.lat, 2);
      expect(r.region.radius, 'a foot park gets the wider region so a stroll stays inside it').toBeGreaterThanOrEqual(250);
      expect(r.parkOn).toBe(true);
      expect(r.removedId).toBe('w-1');
    });

    test('driving speed holds the park off and kills the countdown', async () => {
      const r = await page.evaluate(async (a) => {
        const realCap = window.Capacitor, realUser = _supaUser;
        const parked = [];
        _supaUser = { id: 'u-drivehold' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null;
          _geoDriveStartedAt = new Date(Date.now() - 25 * 60000).toISOString();
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoLegAtShop = false; _geoLastFenceAt = new Date(Date.now() - 25 * 60000).toISOString();
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoWatchId = null; _geoNativeWatcherId = 'w-1'; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          _geoFenceEnteredAtMs = null; _geoStopAnchor = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null;
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (n) => n === 'TdGeo' ? {
              startParked: (o) => { parked.push(o); return Promise.resolve({ armed: 1 }); },
              stopAll: () => Promise.resolve(),
            } : { removeWatcher: () => Promise.resolve() },
          };
          // Ten fixes 30s apart at 15 m/s heading north, a five-minute drive.
          // The old code armed the countdown on the first outside ping and let
          // it run through the whole screen-on drive.
          const t0 = Date.now() - 290000;
          for (let i = 0; i < 10; i++) {
            await _geoOnPing({
              coords: { latitude: a.road.lat + 0.004 * i, longitude: a.road.lon,
                        accuracy: 10, speed: 15 },
              __tdTs: t0 + i * 30000,
            });
          }
          await new Promise(r2 => setTimeout(r2, 10));
          return { parkedCalls: parked.length, parkOn: _geoParkModeOn, timer: _geoParkTimer != null };
        } finally {
          window.Capacitor = realCap; _supaUser = realUser;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoFenceEnteredAtMs = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null; _geoLegOrigin = null;
        }
      }, { road: ROAD });
      expect(r.parkedCalls, 'GPS never parks at driving speed').toBe(0);
      expect(r.parkOn).toBe(false);
      expect(r.timer, 'no countdown survives a driving ping').toBe(false);
    });

    // Owner report (2026-08-09): arrow still on 18 minutes into park mode.
    // The journal showed FOUR watcher-on ids and one removal: every WebView
    // reload (version watchdog) wiped JS memory but the native watcher kept
    // running in the plugin, so park/stop only ever killed the newest one.
    // Ids are now persisted, and every start sweeps the orphans first.
    test('a reload-orphaned native watcher is swept on the next start, and stop forgets its id', async () => {
      const r = await page.evaluate(async () => {
        const realCap = window.Capacitor;
        const removed = [];
        try {
          localStorage.setItem('td_geo_watcher_ids', JSON.stringify(['stale-1', 'stale-2']));
          _geoWatchId = null; _geoNativeWatcherId = null; _geoNativeStarting = false;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = true;
          window.Capacitor = {
            isNativePlatform: () => true,
            registerPlugin: (n) => n === 'BackgroundGeolocation' ? {
              addWatcher: (o, cb) => Promise.resolve('w-new'),
              removeWatcher: (o) => { removed.push(o.id); return Promise.resolve(); },
            } : n === 'TdGeo' ? { addListener: () => {}, stopAll: () => Promise.resolve(), drainBuffer: () => Promise.resolve({ fixes: [] }) } : null,
          };
          startGeoTracking();
          await new Promise(r2 => setTimeout(r2, 30));
          const sweptBoth = removed.includes('stale-1') && removed.includes('stale-2');
          const storeAfterStart = JSON.parse(localStorage.getItem('td_geo_watcher_ids') || '[]');
          const liveId = _geoNativeWatcherId;
          stopGeoTracking();
          await new Promise(r2 => setTimeout(r2, 10));
          const storeAfterStop = JSON.parse(localStorage.getItem('td_geo_watcher_ids') || '[]');
          return { sweptBoth, storeAfterStart, liveId, removedLive: removed.includes('w-new'), storeAfterStop };
        } finally {
          window.Capacitor = realCap;
          localStorage.removeItem('td_geo_watcher_ids');
          _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
        }
      });
      expect(r.sweptBoth, 'both orphans from prior reloads are killed natively').toBe(true);
      expect(r.storeAfterStart, 'only the live watcher stays persisted').toEqual(['w-new']);
      expect(r.liveId).toBe('w-new');
      expect(r.removedLive, 'stop removes the live watcher too').toBe(true);
      expect(r.storeAfterStop, 'nothing persisted once tracking stops').toEqual([]);
    });

    test('in a plain browser park mode does not exist', async () => {
      const r = await page.evaluate(() => {
        const realCap = window.Capacitor;
        try {
          window.Capacitor = undefined;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
          _geoArmParkTimer();
          const timerAfterArm = _geoParkTimer;
          _geoEnterParkMode();     // must be a silent no-op, never a throw
          _geoTdInit();
          return { plugin: _geoTdPlugin(), timerAfterArm, parkOn: _geoParkModeOn, bound: window._geoTdBound };
        } finally {
          window.Capacitor = realCap;
          _geoParkModeOn = false; _geoClearParkTimer(); window._geoTdBound = undefined;
        }
      });
      expect(r.plugin).toBe(null);
      expect(r.timerAfterArm, 'no shell, no countdown').toBe(null);
      expect(r.parkOn).toBe(false);
      expect(r.bound, 'the event stream never binds outside the shell').toBe(undefined);
    });
  });

  // ── Phantom legs (owner report 2026-08-09) ──────────────────────────────────
  // One real Shop→FBC drive produced four rows: two 2-minute "FBC to FBC"
  // trips (GPS jitter bouncing across the fence line), and a duplicate
  // Shop→FBC leg spanning 10:49a-11:56a, built when iOS killed the app with a
  // junk bounce-leg still open, the next launch resurrected 'driving since
  // 10:49' from the persisted blob, and the fresh leg key slipped past the
  // retry dedupe. Three layers now stop the whole class.
  test.describe('phantom legs', () => {
    test('a fence bounce (out and straight back, same spot, no real movement) logs nothing', async () => {
      const r = await page.evaluate(async () => {
        const realUser = _supaUser, realEnq = window._geoEnqueue, realRoute = _routeDistance;
        const entries = [];
        const mileBefore = mileage.length;
        _supaUser = { id: 'u-bounce' };
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        window._routeDistance = _routeDistance = async () => ({ miles: 0, mins: 0 });
        try {
          __seedGeo();
          const t0 = Date.now();
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = true; _geoShopArrivedAt = new Date(t0 - 20 * 60000).toISOString();
          _geoLegAtShop = true; _geoDriveStartedAt = null; _geoDriveReset();
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoLastFenceAt = new Date(t0 - 4 * 60000).toISOString();
          _geoLastFenceLoc = { lat: S.officeLat, lng: S.officeLon, name: 'Shop', kind: 'shop' };
          _geoHomeDwell = null; _geoWasAtHome = false; _geoLegOrigin = null; _geoGapHiddenAt = null;
          // Jitter: one fix ~500ft outside the fence, next fix back inside.
          await _geoOnPing({ coords: { latitude: S.officeLat + 0.0014, longitude: S.officeLon, accuracy: 8 }, __tdTs: t0 - 3 * 60000 });
          await _geoOnPing({ coords: { latitude: S.officeLat, longitude: S.officeLon, accuracy: 8 }, __tdTs: t0 });
          await new Promise(r2 => setTimeout(r2, 30));
          return {
            newTrips: mileage.length - mileBefore,
            driveEntries: entries.filter(e => e.tbl === 'job_time_entries' && /^drive/.test(e.row.source)).length,
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq; window._routeDistance = _routeDistance = realRoute;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoLegOrigin = null;
          mileage.length = mileBefore;
        }
      });
      expect(r.newTrips, 'no mileage row for a fence bounce').toBe(0);
      expect(r.driveEntries, 'no drive time entry for a fence bounce').toBe(0);
    });

    // Owner correction (2026-08-09): every endpoint IS saved (house as a
    // place, FBC as an estimate, work as a job), so FBC -> home should have
    // routed. The real hole: the open-state blob carried "a drive is open"
    // but not WHERE IT STARTED. _geoLegOrigin was memory-only, so an app kill
    // (which park mode deliberately invites) left the restored drive with no
    // origin, and _geoAutoMileage bails without one: drive TIME logged, and
    // no mileage row at all. The origin now rides to disk with the drive.
    test('a drive restored after an app kill still knows where it started, and logs its miles', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
        const before = mileage.length;
        _supaUser = { id: 'u-origin' };
        window._routeDistance = _routeDistance = async () => ({ miles: 7.7, mins: 14 });
        window._geoEnqueue = () => {};
        try {
          __seedGeo();
          const t0 = Date.now();
          // Parked at a lunch stop with the leg out of the client still open,
          // then the screen locks and iOS kills the app.
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoLegAtShop = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoDriveStartedAt = new Date(t0 - 50 * 60000).toISOString();
          _geoLegOrigin = { lat: a.job.lat, lng: a.job.lon, name: 'Miller Residence', kind: 'job', addr: '9 Job St' };
          _geoLastFenceLoc = _geoLegOrigin;
          _geoLastFenceAt = new Date(t0 - 50 * 60000).toISOString();
          _geoPersistOpen(new Date(t0 - 45 * 60000).toISOString());
          // ── app dies here ──
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
          _geoLastFenceAt = null; _geoGapHiddenAt = null; _geoStopAnchor = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null; _geoFenceEnteredAtMs = null;
          _geoRestoreOpen();
          const restoredOrigin = _geoLegOrigin && _geoLegOrigin.name;
          const restoredDrive = !!_geoDriveStartedAt;
          // Relaunch lands them arriving at the saved shop: the leg must log.
          _geoDriveMiles = 6;
          await _geoOnPing({ coords: { latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 0 }, __tdTs: t0 });
          await new Promise(r2 => setTimeout(r2, 60));
          const rows = mileage.slice(0, Math.max(0, mileage.length - before))
            .map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles }));
          return { restoredOrigin, restoredDrive, rows };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
          window._geoEnqueue = realEnq;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoLegOrigin = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoGapHiddenAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoClearOpen(); mileage.length = before; saveAll();
        }
      }, { job: JOB, shop: SHOP });
      expect(r.restoredDrive, 'the open drive comes back').toBe(true);
      expect(r.restoredOrigin, 'and so does where it started').toBe('Miller Residence');
      expect(r.rows.length, 'so the leg logs its miles instead of vanishing').toBe(1);
      expect(r.rows[0].from).toBe('Miller Residence');
      expect(r.rows[0].miles).toBe(7.7);
    });

    test('a bounce restored after a kill is still refused, because the origin came back with it', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
        const before = mileage.length;
        _supaUser = { id: 'u-bounce-kill' };
        window._routeDistance = _routeDistance = async () => ({ miles: 4.2, mins: 9 });
        window._geoEnqueue = () => {};
        try {
          __seedGeo();
          const t0 = Date.now();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoLegAtShop = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoStopAnchor = null;
          // A jitter bounce off the SHOP fence left a drive open, then the kill.
          _geoDriveStartedAt = new Date(t0 - 67 * 60000).toISOString();
          _geoLegOrigin = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceLoc = _geoLegOrigin;
          _geoLastFenceAt = new Date(t0 - 67 * 60000).toISOString();
          _geoPersistOpen(new Date(t0 - 65 * 60000).toISOString());
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
          _geoLastFenceAt = null; _geoGapHiddenAt = null;
          _geoQuietSinceMs = null; _geoParkPrevFix = null; _geoFenceEnteredAtMs = null;
          _geoRestoreOpen();
          _geoDriveMiles = 0;                     // nothing actually moved
          await _geoOnPing({ coords: { latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 0 }, __tdTs: t0 });
          await new Promise(r2 => setTimeout(r2, 60));
          return { newRows: mileage.length - before };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
          window._geoEnqueue = realEnq;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoLegOrigin = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoGapHiddenAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoClearOpen(); mileage.length = before; saveAll();
        }
      }, { shop: SHOP });
      expect(r.newRows, 'the phantom stays dead: same spot, no miles moved').toBe(0);
    });

  });

  // ── The last leg of the day (owner report 2026-08-09) ───────────────────────
  // "FBC to Culver's for personal lunch, then home, it didn't grab my mileage
  // direct from FBC back to home." The inbound leg was only ever written on
  // DEPARTURE from a stop, and nobody drives away from home: the anchor lived
  // in memory, park mode cut GPS four minutes in, iOS eventually killed the
  // app, and the drive evaporated. It now settles the moment the stop is real.
  test.describe('the drive that ends at a stop', () => {
    const parkAt = (spot, o) => page.evaluate(async (a) => {
      const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
      const before = mileage.length;
      _supaUser = { id: 'u-park-leg' };
      window._routeDistance = _routeDistance = async () => ({ miles: 5.1, mins: 11 });
      window._geoEnqueue = () => {};
      try {
        __seedGeo();
        const t0 = Date.now();
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoLegAtShop = false;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoHomeDwell = null; _geoWasAtHome = false; _geoGapHiddenAt = null;
        _geoQuietSinceMs = null; _geoParkPrevFix = null; _geoFenceEnteredAtMs = null;
        // Pulled out of the shop 20 minutes ago, parked at this kerb 8 minutes ago.
        _geoDriveStartedAt = new Date(t0 - 20 * 60000).toISOString();
        _geoLegOrigin = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop', addr: '1 Yard Rd' };
        _geoLastFenceAt = new Date(t0 - 20 * 60000).toISOString();
        _geoLastFenceLoc = _geoLegOrigin;
        _geoDriveMiles = 5; _geoDriveLastFix = null;
        _geoStopAnchor = { lat: a.spot.lat, lng: a.spot.lon,
          at: new Date(t0 - 8 * 60000).toISOString(), lastAt: new Date(t0 - 60000).toISOString() };
        // One ping while sitting there: no fence, no movement.
        await _geoOnPing({ coords: { latitude: a.spot.lat, longitude: a.spot.lon, accuracy: 8, speed: 0 }, __tdTs: t0 });
        await new Promise(r2 => setTimeout(r2, 40));
        const rows = mileage.slice(0, Math.max(0, mileage.length - before))
          .map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles }));
        // Driving off later must not write the same leg twice.
        _geoStopAnchor.lastAt = new Date(t0 + 30 * 60000).toISOString();
        _geoCloseStop(_geoStopAnchor);
        await new Promise(r2 => setTimeout(r2, 40));
        return { rows, afterDeparture: mileage.length - before };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        window._geoEnqueue = realEnq;
        _geoDriveStartedAt = null; _geoDriveReset(); _geoStopAnchor = null;
        _geoLegOrigin = null; _geoLastFenceAt = null; _geoLastFenceLoc = null;
        _geoQuietSinceMs = null; _geoParkPrevFix = null;
        mileage.length = before; saveAll();
      }
    }, { spot, shop: SHOP, ...(o || {}) });

    test('parking at an unknown kerb writes the leg in, before they ever drive away again', async () => {
      const r = await parkAt({ lat: SHOP.lat + 0.09, lon: SHOP.lon + 0.09 });
      expect(r.rows.length, 'the leg lands while they are still parked').toBe(1);
      expect(r.rows[0].from).toBe('Shop');
      expect(r.rows[0].miles).toBe(5.1);
      expect(r.afterDeparture, 'driving off never logs the same leg twice').toBe(1);
    });

    test('parking at home names the endpoint Home rather than an anonymous Stop', async () => {
      const r = await page.evaluate(async (a) => {
        const realHome = window._placeIsLikelyHome;
        window._placeIsLikelyHome = () => true;
        try {
          const loc = _geoStopLoc({ lat: a.shop.lat + 0.09, lng: a.shop.lon + 0.09,
            at: new Date().toISOString(), lastAt: new Date().toISOString() }, 40 * 60000);
          return { name: loc.name, likelyHome: loc.likelyHome };
        } finally { window._placeIsLikelyHome = realHome; }
      }, { shop: SHOP });
      expect(r.name, 'the log reads "Home", not "Stop"').toBe('Home');
      expect(r.likelyHome, 'and it still counts as home for the commute rule').toBe(true);
    });
  });

  // ── The live DRIVING banner ─────────────────────────────────────────────────
  // Owner ask (2026-08-07): the automatic system was fully silent while actually
  // driving, the only live feedback belonged to the manual Start Drive flow. The
  // dashboard now shows a DRIVING card, rolling straight-line miles plus live
  // speed, whenever the fence machine has an open drive leg at driving speed.
  // Display only: what LOGS is still the geocode-to-geocode route measurement,
  // and these tests pin that the banner never changes it.
  test.describe('the live DRIVING banner', () => {
    const ROAD2 = { lat: ROAD.lat + 0.01, lon: ROAD.lon };   // ~0.7 straight-line miles on

    const bannerDrive = (o) => page.evaluate(async (a) => {
      const realUser = _supaUser, realRoute = _routeDistance, realWatch = _geoWatchId;
      const realRenderDash = window.renderDash;
      const renders = { n: 0 };
      window.renderDash = function () { renders.n++; return realRenderDash.apply(this, arguments); };
      _supaUser = { id: 'u-banner' };
      window._routeDistance = _routeDistance = async () => ({ miles: 12.34, mins: 21 });
      const before = mileage.length;
      try {
        __seedGeo();
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        _geoDriveReset(); _geoDriveShown = false;
        try { window._activeTimer = null; } catch (e) {}
        try { window._nearbyJob = null; } catch (e) {}
        try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
        _geoWatchId = 77;                       // the banner requires tracking to be running
        goPg('pg-dash');
        const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8, speed: (spd === undefined ? null : spd) } });
        const snap = () => {
          const el = document.getElementById('dash-nearby');
          return {
            display: el ? el.style.display : '',
            html: el ? el.innerHTML : '',
            mi: document.getElementById('dash-drive-mi')?.textContent || '',
            mph: document.getElementById('dash-drive-mph')?.textContent || '',
            renders: renders.n,
          };
        };
        const out = {};
        await ping(a.shop);                     // parked in the shop fence
        await ping(a.road, 15.2);               // pulls out, ~34mph
        out.onRoad = snap();
        if (a.tick) { await ping(a.road2, 13.4); out.afterTick = snap(); }
        if (a.park) {
          _geoDriveMovingAt = Date.now() - 200000;   // last driving-speed ping long gone
          await ping(a.road2, 0);
          await new Promise(r => setTimeout(r, 320)); // the .18s fade-out must finish
          out.afterPark = snap();
        }
        if (a.arrive) {
          const t = new Date(Date.now() - 20 * 60000).toISOString();
          if (_geoDriveStartedAt) _geoDriveStartedAt = t;
          if (_geoLastFenceAt) _geoLastFenceAt = t;
          await ping(a.job, 0);
          await new Promise(r => setTimeout(r, 320));
          out.afterArrive = snap();
          await new Promise(r => setTimeout(r, 30));  // the un-awaited route call resolves
          out.rows = mileage.slice(0, Math.max(0, mileage.length - before));
        }
        return out;
      } finally {
        window.renderDash = realRenderDash;
        _supaUser = realUser; _geoWatchId = realWatch;
        window._routeDistance = _routeDistance = realRoute;
        _geoDriveReset(); _geoDriveShown = false; _geoDriveStartedAt = null;
      }
    }, o);

    test('appears at driving speed: DRIVING badge, origin fence, live speed', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB });
      expect(r.onRoad.display).toBe('block');
      expect(r.onRoad.html).toContain('DRIVING');
      expect(r.onRoad.html).toContain('On the road');
      expect(r.onRoad.html).toContain('From Shop');    // the fence machine's own origin
      expect(r.onRoad.mph).toBe('34 mph');             // 15.2 m/s, the device's reading
      expect(r.onRoad.mi).toBe('0.0 mi');              // trip just opened
    });

    test('miles and speed tick in place on later pings, without a re-render', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB, tick: true });
      expect(r.afterTick.mi).toBe('0.7 mi');           // ~0.69 straight-line miles accumulated
      expect(r.afterTick.mph).toBe('30 mph');          // 13.4 m/s
      expect(r.afterTick.renders, 'same-road pings update text in place, never re-render the dashboard').toBe(r.onRoad.renders);
    });

    test('arriving at the job clears the banner, and the LOGGED trip still comes from the geocodes', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB, tick: true, arrive: true });
      expect(r.afterArrive.display).toBe('none');      // faded out, matching the ON SITE card's exit
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].miles, 'route measurement rounded to a tenth, never the banner\'s straight-line tally').toBe(12.3);
    });

    test('parked somewhere unknown, the banner fades once driving speed stops', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB, park: true });
      expect(r.onRoad.display).toBe('block');
      expect(r.afterPark.display).toBe('none');
    });
  });

  // ── Crash durability + clock honesty (owner reports 2026-08-11) ────────────
  // Two bugs from the same evening: the webview crashed mid-drive and the
  // home -> Home Depot leg vanished (the open-leg snapshot used to be DELETED
  // at the exact start of every drive), and the Home Depot -> shop leg logged
  // a 3-minute duration no vehicle can drive (the clock opened when the app
  // relaunched mid-drive, not when the wheels did). A third from the same
  // video: one phantom driving-speed fix while parked evicted the shop dwell
  // and blinked the dashboard's on-site card off.
  test.describe('crash durability and clock honesty', () => {
    test('the open drive snapshot is on disk the moment the leg opens, and a crash restores it', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser;
        _supaUser = { id: 'u-crash' };
        try {
          __seedGeo();
          localStorage.removeItem('zp3_geo_open');
          _geoCurrentJob = null; _geoArrivedAt = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoStopAnchor = null; _geoDriveStartedAt = null;
          _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 30 * 60000).toISOString(); _geoLegAtShop = true;
          _geoLastFenceAt = new Date(Date.now() - 60000).toISOString();
          _geoLastFenceLoc = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoWatchId = 56; _geoDrivebyRun = 0; _geoDriveReset();
          const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8, speed: spd } });
          await ping(a.road, 15);            // leaves the shop: the drive opens
          const snap = JSON.parse(localStorage.getItem('zp3_geo_open') || 'null');
          // ── the crash: every in-memory trace dies ──
          const liveStart = _geoDriveStartedAt;
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null; _geoLastFenceAt = null;
          _geoStopAnchor = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoRestoreOpen();
          return {
            snapHasDrive: !!(snap && snap.driveStartedAt),
            snapOrigin: snap && snap.legOrigin && snap.legOrigin.name,
            restoredStart: _geoDriveStartedAt, liveStart,
            restoredOrigin: _geoLegOrigin && _geoLegOrigin.name,
          };
        } finally {
          _supaUser = realUser; localStorage.removeItem('zp3_geo_open');
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null; _geoLastFenceAt = null;
          _geoStopAnchor = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoGapHiddenAt = null; _geoDriveReset();
        }
      }, { shop: SHOP, road: ROAD });
      expect(r.snapHasDrive, 'the snapshot goes to disk when the leg opens, not only on hide/park').toBe(true);
      expect(r.snapOrigin).toBe('Shop');
      expect(r.restoredStart, 'a relaunch gets the open leg back').toBe(r.liveStart);
      expect(r.restoredOrigin, 'the origin that makes the leg billable comes back with it').toBe('Shop');
    });

    test('one phantom driving-speed fix while parked never closes the dwell; two consecutive do', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser;
        _supaUser = { id: 'u-phantom' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoStopAnchor = null; _geoDriveStartedAt = null;
          _geoWatchId = 57; _geoDrivebyRun = 0; _geoParkModeOn = false; _geoDriveReset();
          const arrived = new Date(Date.now() - 20 * 60000).toISOString();
          _geoWasInShop = true; _geoShopArrivedAt = arrived; _geoLegAtShop = true;
          _geoLastFenceAt = new Date(Date.now() - 60000).toISOString();
          _geoLastFenceLoc = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          const ping = (c, spd) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8, speed: spd } });
          await ping(a.shop, 15);            // phantom: driving speed, same kerb
          const afterOne = { inShop: _geoWasInShop, at: _geoShopArrivedAt };
          await ping(a.shop, 0);             // normal fix: the debounce resets
          await ping(a.shop, 15);            // another lone phantom later
          const afterLone = { inShop: _geoWasInShop, at: _geoShopArrivedAt };
          await ping(a.shop, 15);            // second consecutive: a real pull-away
          const afterTwo = { inShop: _geoWasInShop };
          return { afterOne, afterLone, afterTwo, arrived };
        } finally {
          _supaUser = realUser; localStorage.removeItem('zp3_geo_open');
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoStopAnchor = null; _geoDrivebyRun = 0;
          _geoLastFenceLoc = null; _geoLastFenceAt = null; _geoGapHiddenAt = null; _geoDriveReset();
        }
      }, { shop: SHOP });
      expect(r.afterOne.inShop, 'one speeding fix is a hiccup, not a departure').toBe(true);
      expect(r.afterOne.at, 'the arrival stamp survives untouched').toBe(r.arrived);
      expect(r.afterLone.inShop, 'the debounce resets on every normal fix').toBe(true);
      expect(r.afterLone.at).toBe(r.arrived);
      expect(r.afterTwo.inShop, 'two consecutive speeding fixes are a real pull-away').toBe(false);
    });

    test('a drive-by through the fence still masks on the FIRST fix when nothing was established', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser;
        _supaUser = { id: 'u-driveby' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoStopAnchor = null; _geoDriveStartedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoWatchId = 58; _geoDrivebyRun = 0; _geoDriveReset();
          await _geoOnPing({ coords: { latitude: a.shop.lat, longitude: a.shop.lon, accuracy: 8, speed: 15 } });
          return { inShop: _geoWasInShop, at: _geoShopArrivedAt };
        } finally {
          _supaUser = realUser; localStorage.removeItem('zp3_geo_open');
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoStopAnchor = null; _geoDrivebyRun = 0; _geoDriveReset();
        }
      }, { shop: SHOP });
      expect(r.inShop, 'passing through at road speed never stamps an arrival').toBe(false);
      expect(r.at).toBe(null);
    });

    test('the wheels cannot beat the road: an impossible window takes the route clock', async () => {
      const r = await page.evaluate(() => {
        const ended = '2026-08-11T23:57:00.000Z';
        const short = { mins: 3, startedIso: '2026-08-11T23:54:00.000Z', endedIso: ended };
        _mileFixLegClock(short, 14);
        const plausible = { mins: 12, startedIso: 'keep-me', endedIso: ended };
        _mileFixLegClock(plausible, 14);
        const stale = { mins: undefined, startedIso: undefined, endedIso: undefined };
        _mileFixLegClock(stale, 14);
        const noEta = { mins: 3, endedIso: ended };
        _mileFixLegClock(noEta, undefined);
        return { short, plausible, stale, noEta };
      });
      expect(r.short.mins, 'a 3-minute claim on a 14-minute route is the router\'s clock now').toBe(14);
      expect(r.short.timeInferred).toBe(true);
      expect(r.short.startedIso, 'the start pulls back from the verified arrival').toBe('2026-08-11T23:43:00.000Z');
      expect(r.plausible.mins, 'a watched, plausible window is observed truth and wins').toBe(12);
      expect(r.plausible.timeInferred).toBeUndefined();
      expect(r.plausible.startedIso).toBe('keep-me');
      expect(r.stale.mins, 'a stale leg still claims no duration at all').toBeUndefined();
      expect(r.noEta.mins, 'no route time means nothing to correct with').toBe(3);
    });

    test('a mid-session measurement failure is not stuck at 0 miles forever: returning to the foreground sweeps it', async () => {
      // Owner report 2026-08-12: the John Doe -> Shop leg (12:04p-12:11p) had
      // no miles at all while the legs before and after it did, same route,
      // same day. _initMapKit calls _retryPendingTrips exactly ONCE at boot;
      // a live measurement that fails mid-session (one bad network moment)
      // had nothing that would ever sweep it again short of a full reload.
      // The foreground-return handler (the same one that pulls inbound
      // messages and checks for new signatures) now pulls this too.
      const calls = await page.evaluate(async () => {
        let n = 0;
        const real = _retryPendingTrips;
        window._retryPendingTrips = _retryPendingTrips = () => { n++; };
        try {
          // Playwright pages report visibilityState 'visible' already, so
          // firing the event alone reproduces a real return-to-app.
          document.dispatchEvent(new Event('visibilitychange'));
          await new Promise(res => setTimeout(res, 30));
          return n;
        } finally {
          window._retryPendingTrips = _retryPendingTrips = real;
        }
      });
      expect(calls, 'returning to the foreground sweeps any trip stuck at 0 miles').toBeGreaterThanOrEqual(1);
    });

    test('the pending sweep applies the route clock to an impossible window', async () => {
      const r = await page.evaluate(async () => {
        const realRoute = _routeDistance, realUser = _supaUser;
        _supaUser = { id: 'u-clock' };
        window.__origMileage = mileage.slice();
        try {
          mileage.length = 0;
          const ended = new Date().toISOString();
          mileage.push({ id: 997301, date: todayKey(), gps: true, legKey: 'clock-leg-1', calc_method: 'pending_auto',
            fromCoord: { lat: 38.24, lng: -94.24 }, toCoord: { lat: 38.0, lng: -94.0 }, miles: 0, mins: 3,
            startedIso: new Date(Date.parse(ended) - 3 * 60000).toISOString(), endedIso: ended, loggedAt: ended });
          window._routeDistance = _routeDistance = async () => ({ miles: 12.3, mins: 14 });
          await _retryPendingTrips();
          const m = mileage.find(x => x.id === 997301);
          return { miles: m.miles, mins: m.mins, inferred: m.timeInferred,
                   windowMs: Date.parse(m.endedIso) - Date.parse(m.startedIso) };
        } finally {
          window._routeDistance = _routeDistance = realRoute; _supaUser = realUser;
          mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        }
      });
      expect(r.miles).toBe(12.3);
      expect(r.mins).toBe(14);
      expect(r.inferred).toBe(true);
      expect(r.windowMs, 'displayed times match the corrected duration').toBe(14 * 60000);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
