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

    test('a stop in the middle splits into two measured trips', async () => {
      // Job -> lunch -> supply house. The parked minutes belong to neither leg,
      // and both drives are real deductible trips.
      const { rows, calls } = await drive({ from: JOB, to: SUPPLY, dwellStop: true });
      expect(rows.length).toBe(2);
      expect(calls.length).toBe(2);
      const froms = calls.map(c => Math.round(c.f.lat * 100) / 100);
      const tos = calls.map(c => Math.round(c.t.lat * 100) / 100);
      expect(froms).toContain(38.06);    // inbound started at the job
      expect(tos).toContain(38.24);      // inbound ended at the kerb
      expect(froms).toContain(38.24);    // outbound started from the same kerb
      expect(tos).toContain(38.12);      // outbound ended at the supply house
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

    test('employee who picked no vehicle: same answer, owed not deducted', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: '' });
      expect(rows.length).toBe(1);
      expect(rows[0].reimbursable).toBe(true);
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

    test('a store category becomes a supply house, food does not', async () => {
      const out = await page.evaluate(() => ({
        store: _poiPlaceKind('MKPOICategoryStore'),
        hardware: _poiPlaceKind('MKPOICategoryHardwareStore'),
        food: _poiPlaceKind('MKPOICategoryRestaurant'),
        cafe: _poiPlaceKind('MKPOICategoryCafe'),
        unknown: _poiPlaceKind('MKPOICategoryZoo'),
        blank: _poiPlaceKind(''),
        nul: _poiPlaceKind(null),
      }));
      expect(out.store).toBe('supply');
      expect(out.hardware).toBe('supply');
      // Lunch is not a supply run, and mislabelling it would put a burrito in
      // the materials column.
      expect(out.food).toBe('other');
      expect(out.cafe).toBe('other');
      // Anything unrecognised keeps the existing default rather than inventing
      // a behaviour for a category nobody anticipated.
      expect(out.unknown).toBe('supply');
      expect(out.blank).toBe('supply');
      expect(out.nul).toBe('supply');
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

    test('food is the only category that deletes a trip', async () => {
      // Narrow on purpose: this predicate only ever SUBTRACTS a deduction, so a
      // loose pattern here quietly costs the contractor money. Kept separate
      // from _poiPlaceKind, whose catch-all is 'supply', so a category landing
      // in 'other' later cannot start binning legs.
      const out = await page.evaluate(() => ({
        restaurant: _poiIsPersonal('MKPOICategoryRestaurant'),
        cafe: _poiIsPersonal('MKPOICategoryCafe'),
        bakery: _poiIsPersonal('MKPOICategoryBakery'),
        store: _poiIsPersonal('MKPOICategoryStore'),
        hardware: _poiIsPersonal('MKPOICategoryHardwareStore'),
        gas: _poiIsPersonal('MKPOICategoryGasStation'),
        blank: _poiIsPersonal(''),
        nul: _poiIsPersonal(null),
      }));
      expect(out.restaurant).toBe(true);
      expect(out.cafe).toBe(true);
      expect(out.bakery).toBe(true);
      expect(out.store).toBe(false);
      expect(out.hardware).toBe(false);
      // Fuel is a work cost, not lunch.
      expect(out.gas).toBe(false);
      expect(out.blank).toBe(false);
      expect(out.nul).toBe(false);
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
        fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
          if (!/mileage[\s\S]*?\.reduce\([^;]*\.miles/.test(line)) return;
          if (/deductibleTrips\(|reimbursableTrips\(|miles-not-deduction/.test(line)) return;
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

  test('no console errors', async () => { await assertNoErrors(page); });
});
