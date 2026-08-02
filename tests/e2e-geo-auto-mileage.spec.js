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

    test('employee in their OWN car: no mileage row at all', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: 'personal' });
      expect(rows.length).toBe(0);
    });

    test('employee who picked no vehicle: no mileage row', async () => {
      const { rows } = await drive({ from: SHOP, to: JOB, viaRoad: true, asEmployee: true, empVehicle: '' });
      expect(rows.length).toBe(0);
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
            : cb(null, { places: [{ name: c.poiName, pointOfInterestCategory: c.poiCategory }] });
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
      expect(out).toBeNull();
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
      await withMapkit({ poiName: 'The Home Depot', poiCategory: 'MKPOICategoryStore', geoFails: true });
      const out = await stopTrip('leg-stop-depot', { lat: 39.03, lng: -95.77 });
      expect(out.length).toBe(1);
      expect(out[0].to).toBe('The Home Depot');
      // Both fields, because the log renders `to` and reports read `to_name`.
      expect(out[0].raw).toBe('The Home Depot');
      // What it IS decides what it cost: a store is a supply run.
      expect(out[0].purpose).toBe('Supply run');
    });

    test('lunch never reaches the mileage log', async () => {
      // The owner's rule, walking a real day: "then I'm going God knows where to
      // get lunch (this shouldn't count)". A drive to a restaurant is a personal
      // errand, and billing it inflates a deduction they would be defending.
      await withMapkit({ poiName: "Bobo's Drive In", poiCategory: 'MKPOICategoryRestaurant', geoFails: true });
      const out = await stopTrip('leg-stop-lunch', { lat: 39.04, lng: -95.70 });
      expect(out).toEqual([]);
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
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
