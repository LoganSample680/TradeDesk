// @ts-check
// ── One truck, one driver, decided by whoever hands out the keys ─────────────
//
// Owner (2026-08-01): "we would need to add company truck for employees as a
// tag so when they pick a vehicle it logs correctly... there could be occasions
// where an employee may not have access to a company truck... or they'd be
// carpooling... Would this be up to like a dispatch or someone in the shop
// assigning each individual their company truck for the day?"
//
// Yes, and for a harder reason than tidiness. THREE CREW CARPOOL TO A JOB IN
// ONE TRUCK. All three phones run the geofence and all three log drive legs. If
// each one taps a truck in the picker, that single trip's miles are deducted
// three times. No crew member can prevent it, because none of them knows what
// the other two tapped. Exactly one person knows three people are in one truck:
// whoever hands out the keys.
//
// So the rules these tests hold:
//   • A truck has ONE driver per day, enforced by the board never offering a
//     truck twice rather than by asking anyone to remember.
//   • Riders log drive TIME (they are on the clock, being paid for the ride)
//     and never miles (those miles are already on the driver's row).
//   • Dispatch outranks the phone. If dispatch spoke, the crew member is not
//     asked, because asking invites them to contradict the keys.
//   • If dispatch stayed silent, the picker works exactly as it did.
//   • The plate is required once a fleet has more than one vehicle, because two
//     white F-250s bought the same year are the SAME STRING on a phone screen.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SHOP = { lat: 43.0000, lon: -92.0000 };
const JOB  = { lat: 43.0600, lon: -92.0600 };
const ROAD = { lat: 43.4000, lon: -92.4000 };

test.describe('Truck assignment', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    await page.evaluate((d) => {
      S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
      S.teamTracking = true;
      if (typeof places !== 'undefined') places.length = 0;
      clients.length = 0; clients.push({ id: 5501, name: 'Novak Residence', addr: '9 Elm' });
      jobs.length = 0;
      // The destination is a SUPPLY HOUSE, not a job, and that is deliberate. A
      // job fence is per-employee (_geoMyJobs filters on assignedTo), so a job
      // can only ever fence for ONE of the three crew in the carpool, which is
      // the exact case under test. A saved place fences for everybody.
      savePlace({ name: 'Ace Supply', kind: 'supply', lat: d.JOB.lat, lon: d.JOB.lon, confirmedBy: 'manual' });
      vehicles.length = 0;
      vehicles.push({ id: 'v-a', name: '2019 Ford F-250', year: '2019', make: 'Ford', model: 'F-250', plate: 'KS 7TR-441', status: 'active' });
      vehicles.push({ id: 'v-b', name: '2019 Ford F-250', year: '2019', make: 'Ford', model: 'F-250', plate: 'KS 9BX-208', status: 'active' });
      S.employees = [
        { id: 'e-dave', name: 'Dave', role: 'lead' },
        { id: 'e-luis', name: 'Luis', role: 'tech' },
        { id: 'e-sam', name: 'Sam', role: 'tech' },
      ];
      window._geoOfficeCoords = async () => ({ lat: d.SHOP.lat, lng: d.SHOP.lon });
      window.__seed = () => {
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
        S.teamTracking = true; _geoPingBusy = false;
        (S.employees || []).forEach(e => { delete e.truckDay; });
        localStorage.removeItem('emp_vehicle_' + todayKey());
      };
    }, { SHOP, JOB });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Drive shop -> job as `empId`, and return the mileage rows and drive legs it
  // produced. This is the unit the whole feature exists to get right.
  const driveAs = (empId, setup) => page.evaluate(async (a) => {
    const realUser = _supaUser, realEmp = _isEmployee, realRec = _employeeRecord;
    const realRoute = _routeDistance, realEnq = _geoEnqueue;
    const legs = [];
    _supaUser = { id: 'u-' + a.empId }; _isEmployee = true;
    _employeeRecord = { id: a.empId, name: a.empId };
    window._routeDistance = _routeDistance = async () => ({ miles: 10, mins: 18 });
    const origEnq = _geoEnqueue;
    _geoEnqueue = (tbl, row) => { legs.push(row); return origEnq(tbl, row); };
    const before = mileage.length;
    try {
      _geoPingBusy = false;
      _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
      _geoShopArrivedAt = null; _geoDriveStartedAt = null;
      _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
      _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null; _geoLegOrigin = null;
      _geoHomeDwell = null; _geoWasAtHome = false;
      try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
      await ping(a.SHOP);
      await ping(a.ROAD);
      if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 22 * 60000).toISOString();
      await ping(a.JOB);
      await new Promise(r => setTimeout(r, 30));
      const rows = mileage.slice(0, Math.max(0, mileage.length - before));
      return {
        trips: rows.map(m => ({ veh: m.vehicleId, miles: m.miles })),
        drives: legs.filter(l => /^drive/.test(l.source || '')).map(l => ({ source: l.source, minutes: l.minutes })),
      };
    } finally {
      _supaUser = realUser; _isEmployee = realEmp; _employeeRecord = realRec;
      window._routeDistance = _routeDistance = realRoute; _geoEnqueue = realEnq;
    }
  }, { empId, SHOP, JOB, ROAD, setup });

  const assign = (empId, mode, v, withId) => page.evaluate((a) =>
    _dispatchSetTruck(a.empId, a.mode, a.v || '', a.withId || ''), { empId, mode, v, withId });

  test.describe('the carpool, which is the whole reason this exists', () => {
    test.beforeEach(async () => { await page.evaluate(() => __seed()); });

    test('three crew in one truck deduct the trip ONCE, not three times', async () => {
      // Without assignment all three would tap a truck and log their own row.
      // Three rows for one truck's single trip is a deduction inflated 3x, and
      // it is the app doing it, not the contractor.
      await assign('e-dave', 'truck', 'v-a');
      await assign('e-luis', 'rider', '', 'e-dave');
      await assign('e-sam', 'rider', '', 'e-dave');

      const dave = await driveAs('e-dave');
      const luis = await driveAs('e-luis');
      const sam = await driveAs('e-sam');

      const totalTrips = dave.trips.length + luis.trips.length + sam.trips.length;
      expect(totalTrips).toBe(1);
      expect(dave.trips[0].veh).toBe('v-a');
      expect(dave.trips[0].miles).toBe(10);
      expect(luis.trips.length).toBe(0);
      expect(sam.trips.length).toBe(0);
    });

    test('but all three are still PAID for the drive', async () => {
      // The riders are on the clock. Only the deduction is the driver's.
      await assign('e-dave', 'truck', 'v-a');
      await assign('e-luis', 'rider', '', 'e-dave');
      const dave = await driveAs('e-dave');
      const luis = await driveAs('e-luis');
      expect(dave.drives.length).toBe(1);
      expect(luis.drives.length).toBe(1);
      expect(dave.drives[0].minutes).toBeGreaterThanOrEqual(20);
      expect(luis.drives[0].minutes).toBeGreaterThanOrEqual(20);
    });

    test("a rider's leg says rider, not personal vehicle", async () => {
      // Same money either way, but the row should describe the day that
      // happened. 'drive-personal' on a man sitting in the company truck is a
      // record that reads badly a year later.
      await assign('e-dave', 'truck', 'v-a');
      await assign('e-luis', 'rider', '', 'e-dave');
      const luis = await driveAs('e-luis');
      expect(luis.drives[0].source).toBe('drive-rider');
      // and every money view still counts it as drive time
      const isDrive = await page.evaluate(() => _geoIsDriveSource('drive-rider'));
      expect(isDrive).toBe(true);
    });

    test('two trucks, two drivers: both log, independently', async () => {
      await assign('e-dave', 'truck', 'v-a');
      await assign('e-luis', 'truck', 'v-b');
      const dave = await driveAs('e-dave');
      const luis = await driveAs('e-luis');
      expect(dave.trips.length).toBe(1);
      expect(luis.trips.length).toBe(1);
      expect(dave.trips[0].veh).toBe('v-a');
      expect(luis.trips[0].veh).toBe('v-b');
    });
  });

  test.describe('one driver per truck, enforced by the board', () => {
    test.beforeEach(async () => { await page.evaluate(() => __seed()); });

    test('a truck already taken is offered as the passenger seat, not again', async () => {
      await assign('e-dave', 'truck', 'v-a');
      const out = await page.evaluate(() => {
        document.getElementById('_truck-picker-ov')?.remove();
        _dispatchTruckPicker('e-luis');
        const ov = document.getElementById('_truck-picker-ov');
        const html = ov ? ov.innerHTML : '';
        ov?.remove();
        return { html };
      });
      // Dave's truck is present but as "riding with", never as a second assign.
      expect(out.html).toContain('Riding with Dave');
      expect(out.html).toContain("_dispatchSetTruck('e-luis','rider'");
      expect(out.html).not.toContain("_dispatchSetTruck('e-luis','truck','v-a')");
      // The free truck is still assignable.
      expect(out.html).toContain("_dispatchSetTruck('e-luis','truck','v-b')");
    });

    test('the driver themselves still sees their own truck as theirs', async () => {
      // _truckDriver excludes the person being asked, or reassigning your own
      // truck to yourself would offer you a ride with yourself.
      await assign('e-dave', 'truck', 'v-a');
      const out = await page.evaluate(() => {
        document.getElementById('_truck-picker-ov')?.remove();
        _dispatchTruckPicker('e-dave');
        const ov = document.getElementById('_truck-picker-ov');
        const html = ov ? ov.innerHTML : '';
        ov?.remove();
        return { html };
      });
      expect(out.html).toContain("_dispatchSetTruck('e-dave','truck','v-a')");
      expect(out.html).not.toContain('Riding with Dave');
    });

    test("yesterday's assignment is not today's", async () => {
      // The slot is a single day and is overwritten each morning, so a stale one
      // must never silently drive today's attribution.
      const out = await page.evaluate(() => {
        const e = S.employees.find(x => x.id === 'e-dave');
        e.truckDay = { day: '2020-01-01', mode: 'truck', v: 'v-a' };
        return { today: _truckDayFor('e-dave'), label: _truckDayLabel(_truckDayFor('e-dave')) };
      });
      expect(out.today).toBeNull();
      expect(out.label).toBe('No truck assigned');
    });

    test('clearing an assignment hands the truck back', async () => {
      await assign('e-dave', 'truck', 'v-a');
      let taken = await page.evaluate(() => (_truckDriver('v-a') || {}).id);
      expect(taken).toBe('e-dave');
      await assign('e-dave', '');
      taken = await page.evaluate(() => _truckDriver('v-a'));
      expect(taken).toBeNull();
    });
  });

  test.describe('dispatch outranks the phone', () => {
    test.beforeEach(async () => { await page.evaluate(() => __seed()); });

    test('an assigned crew member is never asked', async () => {
      await assign('e-dave', 'truck', 'v-a');
      const shown = await page.evaluate(() => {
        const realEmp = _isEmployee, realRec = _employeeRecord;
        _isEmployee = true; _employeeRecord = { id: 'e-dave' };
        try {
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const on = !!document.getElementById('_vehicle-picker-ov');
          document.getElementById('_vehicle-picker-ov')?.remove();
          return on;
        } finally { _isEmployee = realEmp; _employeeRecord = realRec; }
      });
      expect(shown).toBe(false);
    });

    test('an unassigned crew member is asked, exactly as before', async () => {
      const shown = await page.evaluate(() => {
        const realEmp = _isEmployee, realRec = _employeeRecord;
        _isEmployee = true; _employeeRecord = { id: 'e-luis' };
        try {
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const on = !!document.getElementById('_vehicle-picker-ov');
          document.getElementById('_vehicle-picker-ov')?.remove();
          return on;
        } finally { _isEmployee = realEmp; _employeeRecord = realRec; }
      });
      expect(shown).toBe(true);
    });

    test('the assignment beats a contradicting tap on the phone', async () => {
      // The crew member taps truck B; dispatch says they are riding with Dave.
      // The keys win, or the carpool double-count comes straight back.
      await assign('e-luis', 'rider', '', 'e-dave');
      const out = await page.evaluate(() => {
        const realEmp = _isEmployee, realRec = _employeeRecord;
        _isEmployee = true; _employeeRecord = { id: 'e-luis' };
        localStorage.setItem('emp_vehicle_' + todayKey(), 'v-b');
        try {
          return { veh: _autoTripVehicle(), mode: _shiftVehicleMode(), company: _isCompanyVehicleToday() };
        } finally {
          _isEmployee = realEmp; _employeeRecord = realRec;
          localStorage.removeItem('emp_vehicle_' + todayKey());
        }
      });
      expect(out.mode).toBe('rider');
      expect(out.veh).toBeNull();
      expect(out.company).toBe(false);
    });

    test('no truck available: "own vehicle" logs time but no miles', async () => {
      await assign('e-sam', 'own');
      const sam = await driveAs('e-sam');
      expect(sam.trips.length).toBe(0);
      expect(sam.drives.length).toBe(1);
      expect(sam.drives[0].source).toBe('drive-personal');
    });

    test('the owner is untouched by any of this', async () => {
      // truckDay is a crew concept. The owner keeps their default truck and
      // their own daily prompt.
      await assign('e-dave', 'truck', 'v-a');
      const out = await page.evaluate(() => {
        const realEmp = _isEmployee, keepDef = S.defaultVehicleId;
        _isEmployee = false; S.defaultVehicleId = 'v-b';
        try { return { id: (_autoTripVehicle() || {}).id, mode: _shiftVehicleMode() }; }
        finally { _isEmployee = realEmp; S.defaultVehicleId = keepDef; }
      });
      expect(out.id).toBe('v-b');
      expect(out.mode).toBe('none');
    });
  });

  test.describe('the plate is the identifier', () => {
    test('two identical trucks are told apart by their plates', async () => {
      // The fixture is deliberately two 2019 Ford F-250s. Without the plate
      // these are one string, and picking the wrong one puts a day of miles,
      // and the fuel and service hanging off them, on the wrong vehicle.
      const out = await page.evaluate(() => ({
        a: getVehiclePickLabel(vehicles.find(v => v.id === 'v-a')),
        b: getVehiclePickLabel(vehicles.find(v => v.id === 'v-b')),
        noPlate: getVehiclePickLabel({ year: '2019', make: 'Ford', model: 'F-250' }),
        str: getVehiclePickLabel('Legacy String Truck'),
        nul: getVehiclePickLabel(null),
      }));
      expect(out.a).not.toBe(out.b);
      expect(out.a).toContain('KS 7TR-441');
      expect(out.b).toContain('KS 9BX-208');
      expect(out.noPlate).toBe('2019 Ford F-250');   // one-truck shop, still fine
      expect(out.str).toBe('Legacy String Truck');
      expect(out.nul).toBe('');
    });

    test('the plate shows on the dispatch board and in both pickers', async () => {
      await page.evaluate(() => __seed());
      await assign('e-dave', 'truck', 'v-a');
      const out = await page.evaluate(() => {
        const board = _dispatchTruckRow(S.employees.find(e => e.id === 'e-dave'));
        document.getElementById('_truck-picker-ov')?.remove();
        _dispatchTruckPicker('e-luis');
        const disp = (document.getElementById('_truck-picker-ov') || {}).innerHTML || '';
        document.getElementById('_truck-picker-ov')?.remove();
        const realEmp = _isEmployee, realRec = _employeeRecord;
        _isEmployee = true; _employeeRecord = { id: 'e-sam' };
        document.getElementById('_vehicle-picker-ov')?.remove();
        _checkEmployeeVehiclePicker();
        const crew = (document.getElementById('_vehicle-picker-ov') || {}).innerHTML || '';
        document.getElementById('_vehicle-picker-ov')?.remove();
        _isEmployee = realEmp; _employeeRecord = realRec;
        return { board, disp, crew };
      });
      expect(out.board).toContain('KS 7TR-441');
      expect(out.disp).toContain('KS 9BX-208');
      expect(out.crew).toContain('KS 7TR-441');
      expect(out.crew).toContain('KS 9BX-208');
    });

    test('a second vehicle cannot be saved without a plate', async () => {
      const out = await page.evaluate(async () => {
        const keep = vehicles.slice();
        try {
          vehicles.length = 0;
          vehicles.push({ id: 'v-solo', name: '2019 Ford F-250', status: 'active' });
          _fleetEditIdx = -1;
          openAddVehicleModal(-1);
          const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
          setV('fv-name', '2021 Ford Transit');
          setV('fv-plate', '');
          const before = getVehicles().length;
          saveFleetVehicle();
          const afterBlank = getVehicles().length;
          setV('fv-plate', 'KS 1AA-100');
          saveFleetVehicle();
          const afterPlate = getVehicles().length;
          document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
          return { before, afterBlank, afterPlate };
        } finally { vehicles.length = 0; keep.forEach(v => vehicles.push(v)); }
      });
      expect(out.afterBlank).toBe(out.before);   // refused
      expect(out.afterPlate).toBe(out.before + 1);
    });

    test('a one-truck shop is not nagged for a plate', async () => {
      // With one vehicle "the truck" is unambiguous, so the rule would be pure
      // friction on the smallest customer.
      const out = await page.evaluate(async () => {
        const keep = vehicles.slice();
        try {
          vehicles.length = 0;
          _fleetEditIdx = -1;
          openAddVehicleModal(-1);
          const el = document.getElementById('fv-name'); if (el) el.value = '2019 Ford F-250';
          const p = document.getElementById('fv-plate'); if (p) p.value = '';
          saveFleetVehicle();
          const n = getVehicles().length;
          document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
          return { n };
        } finally { vehicles.length = 0; keep.forEach(v => vehicles.push(v)); }
      });
      expect(out.n).toBe(1);
    });
  });

  // ── One dispatch, not two ──────────────────────────────────────────────────
  // Owner call: "dispatch should be daily, truck covers all the jobs for that
  // day, fold it that way." Handing someone their first job IS handing them the
  // keys, so the truck question follows that gesture instead of waiting to be
  // remembered as a separate press.
  test.describe('the truck question follows the job assignment', () => {
    test.beforeEach(async () => {
      await page.evaluate(() => {
        __seed();
        jobs.length = 0;
        [1, 2, 3].forEach(n => jobs.push({
          id: 7000 + n, name: 'Job ' + n, eventType: 'job', status: 'upcoming',
          start: todayKey(), days: 1, client_id: 5501,
        }));
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      });
    });

    const assignJob = async (jobId, empId) => {
      await page.evaluate((a) => _dispatchDoAssign(a.jobId, a.empId), { jobId, empId });
      await page.waitForTimeout(400);   // the picker follows on a short delay
      return page.evaluate(() => {
        const ov = document.getElementById('_truck-picker-ov');
        const html = ov ? ov.innerHTML : '';
        ov?.remove();
        return { asked: !!ov, html };
      });
    };

    test('the first job of the day asks for the truck', async () => {
      const out = await assignJob(7001, 'e-dave');
      expect(out.asked).toBe(true);
      expect(out.html).toContain('What is Dave driving today?');
    });

    test('the second and third jobs do not ask again', async () => {
      await assignJob(7001, 'e-dave');
      await page.evaluate(() => _dispatchSetTruck('e-dave', 'truck', 'v-a'));
      const second = await assignJob(7002, 'e-dave');
      const third = await assignJob(7003, 'e-dave');
      expect(second.asked).toBe(false);
      expect(third.asked).toBe(false);
    });

    test('and that one truck covers every job of the day', async () => {
      // The point of the truck living on the DAY: three jobs, one answer, and
      // every drive between them is attributed to it, including the legs that
      // belong to no job at all.
      await page.evaluate(() => _dispatchSetTruck('e-dave', 'truck', 'v-a'));
      await page.evaluate(() => { [7001, 7002, 7003].forEach(id => _dispatchDoAssign(id, 'e-dave')); });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()));
      const out = await page.evaluate(() => {
        const mine = jobs.filter(j => String(j.assignedTo) === 'e-dave').length;
        const t = _truckDayFor('e-dave');
        return { mine, v: t && t.v };
      });
      expect(out.mine).toBe(3);
      expect(out.v).toBe('v-a');
    });

    test('someone who already has a truck is never re-asked', async () => {
      await page.evaluate(() => _dispatchSetTruck('e-luis', 'rider', '', 'e-dave'));
      const out = await assignJob(7001, 'e-luis');
      expect(out.asked).toBe(false);
    });

    test('no fleet, no question', async () => {
      // Nothing to choose from, so asking would be a dead end.
      const out = await page.evaluate(async () => {
        const keep = vehicles.slice();
        try {
          vehicles.length = 0;
          _dispatchDoAssign(7001, 'e-sam');
          await new Promise(r => setTimeout(r, 400));
          const ov = document.getElementById('_truck-picker-ov');
          const asked = !!ov; ov?.remove();
          return asked;
        } finally { vehicles.length = 0; keep.forEach(v => vehicles.push(v)); }
      });
      expect(out).toBe(false);
    });

    test('tracking off, no question', async () => {
      const out = await page.evaluate(async () => {
        const keep = S.teamTracking;
        try {
          S.teamTracking = false;
          _dispatchDoAssign(7001, 'e-sam');
          await new Promise(r => setTimeout(r, 400));
          const ov = document.getElementById('_truck-picker-ov');
          const asked = !!ov; ov?.remove();
          return asked;
        } finally { S.teamTracking = keep; }
      });
      expect(out).toBe(false);
    });

    test('the job still gets assigned even if the truck question is dismissed', async () => {
      // Swiping the prompt away must never cost the assignment that triggered it.
      await assignJob(7001, 'e-sam');   // assignJob removes the overlay without answering
      const out = await page.evaluate(() => ({
        assigned: String((jobs.find(j => j.id === 7001) || {}).assignedTo || ''),
        truck: _truckDayFor('e-sam'),
      }));
      expect(out.assigned).toBe('e-sam');
      expect(out.truck).toBeNull();
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
