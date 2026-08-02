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
      // crewDrivable is explicit, and OFF is the default (owner decision): a
      // fleet is not all crew trucks. Everything below is about what happens
      // once the owner has said these two may be handed out.
      vehicles.push({ id: 'v-a', name: '2019 Ford F-250', year: '2019', make: 'Ford', model: 'F-250', plate: 'KS 7TR-441', status: 'active', crewDrivable: true });
      vehicles.push({ id: 'v-b', name: '2019 Ford F-250', year: '2019', make: 'Ford', model: 'F-250', plate: 'KS 9BX-208', status: 'active', crewDrivable: true });
      S.employees = [
        { id: 'e-dave', name: 'Dave', role: 'lead' },
        { id: 'e-luis', name: 'Luis', role: 'tech' },
        { id: 'e-sam', name: 'Sam', role: 'tech' },
      ];
      window._geoOfficeCoords = async () => ({ lat: d.SHOP.lat, lng: d.SHOP.lon });
      window.__seed = () => {
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
        S.teamTracking = true; _geoPingBusy = false;
        vehicles.forEach(v => { v.crewDrivable = true; v.status = 'active'; });
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
        trips: rows.map(m => ({ veh: m.vehicleId, miles: m.miles, reimbursable: !!m.reimbursable })),
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

    test('no truck available: "own vehicle" is owed to them, never deducted', async () => {
      // This asserted trips.length === 0 until 2026-08-02, and it was right about
      // the thing it protected: an employee's own car is not the owner's to
      // deduct. But dropping the row lost the FACT along with the deduction, and
      // some states require reimbursing them for those miles, so a contractor in
      // one of them had no record of what they owed. The trip is written now and
      // flagged, and the guarantee that mattered here is unchanged and asserted
      // directly: it contributes nothing to the deduction.
      await assign('e-sam', 'own');
      const sam = await driveAs('e-sam');
      expect(sam.trips.length).toBe(1);
      expect(sam.trips[0].reimbursable).toBe(true);
      const ded = await page.evaluate(() => deductibleTrips(mileage).length);
      expect(ded).toBe(0);
      // Paid for the time either way: that never depended on whose car it was.
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
      // POLL, do not sleep. The picker follows the assignment on a short delay,
      // and a fixed 400ms wait is a bet on how loaded the runner is: it came up
      // short on WebKit and reported the question was never asked when it was
      // simply late (2026-08-02). Waits for the overlay, and still gives a real
      // absence three seconds to prove itself.
      try {
        await page.waitForFunction(() => !!document.getElementById('_truck-picker-ov'), null, { timeout: 3000 });
      } catch (e) { /* genuinely never appeared: the assertion below says so */ }
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

  // ── Which vehicles a crew member may be handed ─────────────────────────────
  // Owner call (2026-08-01): "this tag is important so multiple vehicles for
  // the business owner don't prompt a dispatch prompt for trucks a business
  // owner wouldn't let them drive."
  //
  // A fleet is not all crew trucks. An owner can have their own truck, a
  // spouse's car and one work van on the same Fleet page, and offering all
  // three is the app volunteering somebody else's keys. OFF by default, the
  // conservative side of the trade: nothing is ever offered because the app
  // assumed it, at the cost of dispatch staying quiet until one is ticked, and
  // that silence is signposted rather than left to look broken.
  test.describe('the crew-drivable tag', () => {
    test.beforeEach(async () => { await page.evaluate(() => __seed()); });

    test('an untagged fleet is never offered to crew', async () => {
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        document.getElementById('_truck-picker-ov')?.remove();
        _dispatchTruckPicker('e-dave');
        const ov = document.getElementById('_truck-picker-ov');
        const html = ov ? ov.innerHTML : '';
        ov?.remove();
        return { html, crewCount: getCrewVehicles().length };
      });
      expect(out.crewCount).toBe(0);
      expect(out.html).not.toContain('KS 7TR-441');
      expect(out.html).not.toContain('KS 9BX-208');
      expect(out.html).toContain('No active vehicles');
    });

    test('assigning a job raises no truck question when nothing is tagged', async () => {
      // The case the owner named: an owner with vehicles crew may not drive
      // must not be prompted about them every morning.
      const out = await page.evaluate(async () => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        jobs.length = 0;
        jobs.push({ id: 7101, name: 'J', eventType: 'job', status: 'upcoming', start: todayKey(), days: 1, client_id: 5501 });
        _dispatchDoAssign(7101, 'e-dave');
        await new Promise(r => setTimeout(r, 400));
        const ov = document.getElementById('_truck-picker-ov');
        const asked = !!ov; ov?.remove();
        return { asked, assigned: String((jobs.find(j => j.id === 7101) || {}).assignedTo || '') };
      });
      expect(out.asked).toBe(false);
      // and the job is still assigned, which is the part that must not regress
      expect(out.assigned).toBe('e-dave');
    });

    test('crew are not asked on their own phone either', async () => {
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
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
      expect(out).toBe(false);
    });

    test('tagging one vehicle makes exactly that one available', async () => {
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        vehicles.find(v => v.id === 'v-b').crewDrivable = true;
        document.getElementById('_truck-picker-ov')?.remove();
        _dispatchTruckPicker('e-dave');
        const ov = document.getElementById('_truck-picker-ov');
        const html = ov ? ov.innerHTML : '';
        ov?.remove();
        return html;
      });
      expect(out).toContain('KS 9BX-208');
      expect(out).not.toContain('KS 7TR-441');
    });

    test('the owner still sees their WHOLE fleet on their own prompt', async () => {
      // The flag is about what gets handed out, not about what they own. An
      // owner filtered by it could not pick the truck they are sitting in.
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        const realEmp = _isEmployee;
        _isEmployee = false;
        S.defaultVehicleId = 'v-a';
        try {
          localStorage.removeItem('emp_vehicle_' + todayKey());
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const ov = document.getElementById('_vehicle-picker-ov');
          const html = ov ? ov.innerHTML : '';
          ov?.remove();
          return html;
        } finally { _isEmployee = realEmp; localStorage.removeItem('emp_vehicle_' + todayKey()); }
      });
      expect(out).toContain('KS 7TR-441');
      expect(out).toContain('KS 9BX-208');
    });

    test('a sold truck is not crew-drivable however it is tagged', async () => {
      const n = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = true; v.status = 'sold'; });
        return getCrewVehicles().length;
      });
      expect(n).toBe(0);
    });

    test('the board signposts the untagged state instead of going quiet', async () => {
      // Off by default means EVERY account starts here, so it has to read as a
      // next step rather than as a control that does nothing.
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        const withFleet = _dispatchTruckRow(S.employees.find(e => e.id === 'e-dave'));
        const keep = vehicles.slice();
        vehicles.length = 0;
        const noFleet = _dispatchTruckRow(S.employees.find(e => e.id === 'e-dave'));
        keep.forEach(v => vehicles.push(v));
        return { withFleet, noFleet };
      });
      expect(out.withFleet).toContain('Crew can drive this');
      // With no fleet at all there is nothing to signpost: Fleet's own empty
      // state already covers it, and two prompts for one problem is noise.
      expect(out.noFleet).toBe('');
    });

    test('the toggle flips the tag and is reversible', async () => {
      const out = await page.evaluate(() => {
        vehicles.forEach(v => { v.crewDrivable = false; });
        toggleCrewVehicle('v-a');
        const on = getCrewVehicles().map(v => v.id);
        toggleCrewVehicle('v-a');
        const off = getCrewVehicles().map(v => v.id);
        toggleCrewVehicle('nope-not-a-vehicle');   // must not throw
        return { on, off };
      });
      expect(out.on).toEqual(['v-a']);
      expect(out.off).toEqual([]);
    });

    test('the assign sheet shows each person\'s truck while you assign', async () => {
      // Rolling people and trucks together: who is already in what, and who
      // still needs keys, readable WHILE assigning rather than after.
      const out = await page.evaluate(() => {
        _dispatchSetTruck('e-dave', 'truck', 'v-a');
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _dispatchAssign(7001);
        const ov = document.querySelector('.zmodal-overlay');
        const html = ov ? ov.innerHTML : '';
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return html;
      });
      expect(out).toContain('KS 7TR-441');     // Dave, already in his truck
      expect(out).toContain('Needs a truck');  // the other two
    });
  });

  // ── The row itself ─────────────────────────────────────────────────────────
  // Owner report with a screenshot (2026-08-01): the car icon drifted left and
  // right down the list, and a long plate wrapped in the middle of itself,
  // "KS 4RD-" / "982". Both came from centring the row: with centred content the
  // icon's x is a function of the label's length, so no two rows line up, and
  // the plate is just more text on one line waiting to break.
  //
  // Measured as GEOMETRY, not by reading styles back. "Aligned" is a claim about
  // where things land on screen, and a style string can be right while the
  // layout is not.
  test.describe('picker rows line up', () => {
    test.beforeEach(async () => { await page.evaluate(() => __seed()); });

    const openPicker = () => page.evaluate(() => {
      document.getElementById('_truck-picker-ov')?.remove();
      _dispatchTruckPicker('e-dave');
      const rows = Array.from(document.querySelectorAll('#_truck-picker-ov button'));
      const out = rows.map(b => {
        const icon = b.querySelector('svg');
        const r = b.getBoundingClientRect();
        const ir = icon ? icon.getBoundingClientRect() : null;
        const spans = Array.from(b.querySelectorAll('span > span'));
        return {
          iconLeft: ir ? Math.round(ir.left) : null,
          iconCy: ir ? Math.round(ir.top + ir.height / 2) : null,
          rowCy: Math.round(r.top + r.height / 2),
          right: r.right,
          lines: spans.map(sp => sp.textContent.trim()).filter(Boolean),
        };
      });
      const vw = window.innerWidth, docW = document.documentElement.scrollWidth;
      document.getElementById('_truck-picker-ov')?.remove();
      return { out, vw, docW };
    });

    test('every icon sits at the same x, whatever the label length', async () => {
      // Three vehicles of very different name lengths plus "Own vehicle".
      await page.evaluate(() => {
        vehicles.push({ id: 'v-long', name: 'x', year: '2021', make: 'Ford',
                        model: 'Transit 250 Extended High Roof', plate: 'KS 4RD-982',
                        status: 'active', crewDrivable: true });
      });
      const { out } = await openPicker();
      const lefts = [...new Set(out.map(r => r.iconLeft).filter(v => v !== null))];
      expect(out.length).toBeGreaterThanOrEqual(4);
      expect(lefts.length).toBe(1);   // one x for every icon in the list
    });

    test('the icon is centred against the row even when the text wraps', async () => {
      // The Transit row in the screenshot was two lines tall with the icon
      // floating against the first one.
      await page.evaluate(() => {
        vehicles.push({ id: 'v-long', name: 'x', year: '2021', make: 'Ford',
                        model: 'Transit 250 Extended High Roof', plate: 'KS 4RD-982',
                        status: 'active', crewDrivable: true });
      });
      const { out } = await openPicker();
      out.filter(r => r.iconCy !== null).forEach(r => {
        expect(Math.abs(r.iconCy - r.rowCy)).toBeLessThanOrEqual(2);
      });
    });

    test('the plate is its own line under the make and model, never inline', async () => {
      const { out } = await openPicker();
      const truck = out.find(r => r.lines[0] && r.lines[0].includes('F-250'));
      expect(truck).toBeTruthy();
      // Two lines: the vehicle, then the plate. Not one line joined by a dot,
      // which is what let it wrap mid-plate.
      expect(truck.lines[0]).toBe('2019 Ford F-250');
      expect(truck.lines[1]).toBe('KS 7TR-441');
      expect(truck.lines[0]).not.toContain('KS');
    });

    test('a long name plus a plate still fits the screen', async () => {
      await page.evaluate(() => {
        vehicles.push({ id: 'v-long', name: 'x', year: '2021', make: 'Ford',
                        model: 'Transit 250 Extended High Roof Cargo', plate: 'KS 4RD-982',
                        status: 'active', crewDrivable: true });
      });
      const { out, vw, docW } = await openPicker();
      out.forEach(r => expect(r.right).toBeLessThanOrEqual(vw));
      expect(docW).toBeLessThanOrEqual(vw + 1);
    });

    test('the crew picker uses the same row, so both lists match', async () => {
      const out = await page.evaluate(() => {
        const realEmp = _isEmployee, realRec = _employeeRecord;
        _isEmployee = true; _employeeRecord = { id: 'e-sam' };
        try {
          localStorage.removeItem('emp_vehicle_' + todayKey());
          document.getElementById('_vehicle-picker-ov')?.remove();
          _checkEmployeeVehiclePicker();
          const rows = Array.from(document.querySelectorAll('#_vehicle-picker-ov button'));
          const lefts = [...new Set(rows.map(b => {
            const i = b.querySelector('svg');
            return i ? Math.round(i.getBoundingClientRect().left) : null;
          }).filter(v => v !== null))];
          const first = rows[0];
          const lines = Array.from(first.querySelectorAll('span > span')).map(s => s.textContent.trim()).filter(Boolean);
          document.getElementById('_vehicle-picker-ov')?.remove();
          return { lefts, lines };
        } finally { _isEmployee = realEmp; _employeeRecord = realRec; }
      });
      expect(out.lefts.length).toBe(1);
      expect(out.lines[1]).toMatch(/^KS /);   // plate on its own line here too
    });
  });

  // ── The pills, and the sheet that hands off to the truck prompt ────────────
  // Owner report (2026-08-01): "My truck / Crew truck buttons aren't styled the
  // same or in line, assign to employee needs to be center aligned."
  //
  // Both measured as geometry. "Same" and "in line" are claims about pixels, and
  // a style string can read correctly while the boxes do not match.
  test.describe('fleet pills and the assign sheet', () => {
    const pillBoxes = (crewOn, isDefault) => page.evaluate((a) => {
      const keepVeh = vehicles.slice(), keepDef = S.defaultVehicleId, keepEmp = _isEmployee;
      try {
        _isEmployee = false;
        vehicles.length = 0;
        vehicles.push({ id: 'p1', name: '2019 Ford F-250', status: 'active', crewDrivable: a.crewOn });
        vehicles.push({ id: 'p2', name: '2021 Ford Transit', status: 'active', crewDrivable: true });
        S.defaultVehicleId = a.isDefault ? 'p1' : 'p2';
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:0;left:0;width:360px';
        host.innerHTML = _fleetDefaultPill(vehicles[0], 'active');
        document.body.appendChild(host);
        const els = Array.from(host.querySelectorAll('button,span')).filter(e => e.textContent.trim());
        const out = els.map(e => {
          const r = e.getBoundingClientRect();
          return { text: e.textContent.trim(), tag: e.tagName,
                   h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
                   pl: getComputedStyle(e).paddingLeft, fs: getComputedStyle(e).fontSize,
                   radius: getComputedStyle(e).borderTopLeftRadius };
        });
        host.remove();
        return out;
      } finally {
        vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
        S.defaultVehicleId = keepDef; _isEmployee = keepEmp;
      }
    }, { crewOn, isDefault });

    test('both pills are the same height and sit on one line', async () => {
      const out = await pillBoxes(true, true);
      expect(out.length).toBe(2);
      // Same box: equal height, and the two tops line up.
      expect(out[0].h).toBe(out[1].h);
      expect(Math.abs(out[0].top - out[1].top)).toBeLessThanOrEqual(1);
      expect(Math.abs(out[0].bottom - out[1].bottom)).toBeLessThanOrEqual(1);
    });

    test('the same in every combination of states', async () => {
      // The on state used to be inline-flex and the off state a default-display
      // button, so they only misaligned in the mixed cases.
      for (const [crew, def] of [[true, true], [true, false], [false, true], [false, false]]) {
        const out = await pillBoxes(crew, def);
        expect(out.length).toBe(2);
        expect(out[0].h, `crew=${crew} default=${def}`).toBe(out[1].h);
        expect(Math.abs(out[0].top - out[1].top), `crew=${crew} default=${def}`).toBeLessThanOrEqual(1);
      }
    });

    test('same padding, type size and corner radius, whatever the state', async () => {
      const out = await pillBoxes(true, true);
      expect(out[0].pl).toBe(out[1].pl);
      expect(out[0].fs).toBe(out[1].fs);
      expect(out[0].radius).toBe(out[1].radius);
    });

    test('the active "My truck" pill carries no icon its neighbours lack', async () => {
      // It used to, which is exactly why it was taller and wider than the pill
      // beside it.
      const icons = await page.evaluate(() => {
        const keepVeh = vehicles.slice(), keepDef = S.defaultVehicleId, keepEmp = _isEmployee;
        try {
          _isEmployee = false;
          vehicles.length = 0;
          vehicles.push({ id: 'p1', name: 'A', status: 'active', crewDrivable: true });
          vehicles.push({ id: 'p2', name: 'B', status: 'active', crewDrivable: true });
          S.defaultVehicleId = 'p1';
          const host = document.createElement('div');
          host.innerHTML = _fleetDefaultPill(vehicles[0], 'active');
          const n = host.querySelectorAll('svg').length;
          return n;
        } finally {
          vehicles.length = 0; keepVeh.forEach(v => vehicles.push(v));
          S.defaultVehicleId = keepDef; _isEmployee = keepEmp;
        }
      });
      expect(icons).toBe(0);
    });

    test('the assign sheet is centred, like the truck prompt it hands off to', async () => {
      // It was the last bottom sheet in this flow, so assigning slid up from the
      // bottom and the truck question that followed appeared in the middle: two
      // halves of one gesture arriving from different directions.
      const box = await page.evaluate(() => {
        jobs.length = 0;
        jobs.push({ id: 7401, name: 'J', eventType: 'job', status: 'upcoming', start: todayKey(), days: 1, client_id: 5501 });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _dispatchAssign(7401);
        const card = document.querySelector('#_assign-ov .zmodal');
        if (!card) return null;
        const r = card.getBoundingClientRect();
        const out = { cx: r.left + r.width / 2, vw: window.innerWidth, vh: window.innerHeight,
                      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                      docW: document.documentElement.scrollWidth };
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return out;
      });
      expect(box).not.toBeNull();
      expect(Math.abs(box.cx - box.vw / 2)).toBeLessThanOrEqual(1);
      expect(box.top).toBeGreaterThan(0);           // not pinned to an edge
      expect(box.bottom).toBeLessThan(box.vh);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      expect(box.docW).toBeLessThanOrEqual(box.vw + 1);
    });

    test('and its rows use the same icon gutter as the truck prompt', async () => {
      const out = await page.evaluate(() => {
        jobs.length = 0;
        jobs.push({ id: 7402, name: 'J', eventType: 'job', status: 'upcoming', start: todayKey(), days: 1, client_id: 5501 });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _dispatchAssign(7402);
        const rows = Array.from(document.querySelectorAll('#_assign-ov button')).filter(b => b.querySelector('svg'));
        const lefts = [...new Set(rows.map(b => Math.round(b.querySelector('svg').getBoundingClientRect().left)))];
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return { rows: rows.length, lefts };
      });
      expect(out.rows).toBeGreaterThanOrEqual(3);
      expect(out.lefts.length).toBe(1);
    });
  });

  // ── Nothing off the edge of a phone ────────────────────────────────────────
  // Owner report (2026-08-01): "Dispatch board cutoff on mobile, add a location
  // should be centered."
  //
  // The crew columns were min-width:200px in a horizontally scrolling row. Two
  // crew plus a gap is 412px, which does not fit a 390px phone, so the board
  // scrolled sideways and the second column was clipped mid-word. A flex BASIS
  // wraps instead of overflowing: one full-width column per person on a phone,
  // several abreast on a tablet.
  test.describe('the board fits the phone', () => {
    const boardBoxes = (w) => page.evaluate(async (width) => {
      const keepEmp = _isEmployee;
      try {
        _isEmployee = false;
        jobs.length = 0;
        jobs.push({ id: 7601, name: 'J', eventType: 'job', status: 'upcoming', start: todayKey(), days: 1, client_id: 5501, assignedTo: 'e-dave' });
        jobs.push({ id: 7602, name: 'K', eventType: 'job', status: 'upcoming', start: todayKey(), days: 1, client_id: 5501, assignedTo: 'e-luis' });
        goPg('pg-dispatch');
        renderDispatch();
        await new Promise(r => setTimeout(r, 120));
        const el = document.getElementById('pg-dispatch');
        const cols = Array.from(el.querySelectorAll('div')).filter(d =>
          /^(flex: 1 1 240px|flex: 1 1 auto)/.test(d.style.cssText) || d.style.flex === '1 1 240px');
        const boxes = cols.map(c => { const r = c.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; });
        return { boxes, vw: window.innerWidth, docW: document.documentElement.scrollWidth,
                 scrollW: el.scrollWidth, clientW: el.clientWidth };
      } finally { _isEmployee = keepEmp; }
    }, w);

    test('two crew columns do not run off a 390px screen', async () => {
      const out = await boardBoxes(390);
      expect(out.boxes.length).toBeGreaterThanOrEqual(2);
      out.boxes.forEach(b => {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(out.vw);
      });
    });

    test('and they stack rather than scrolling sideways', async () => {
      // The columns wrap, so on a phone each sits on its own row: same left
      // edge, and no horizontal scroll anywhere on the page.
      const out = await boardBoxes(390);
      const lefts = [...new Set(out.boxes.map(b => b.left))];
      expect(lefts.length).toBe(1);
      expect(out.docW).toBeLessThanOrEqual(out.vw + 1);
      expect(out.scrollW).toBeLessThanOrEqual(out.clientW + 1);
    });

    test('three crew still fit, which is where it broke worst', async () => {
      const out = await page.evaluate(async () => {
        jobs.length = 0;
        ['e-dave', 'e-luis', 'e-sam'].forEach((e, i) => jobs.push({
          id: 7610 + i, name: 'J' + i, eventType: 'job', status: 'upcoming',
          start: todayKey(), days: 1, client_id: 5501, assignedTo: e }));
        goPg('pg-dispatch'); renderDispatch();
        await new Promise(r => setTimeout(r, 120));
        const el = document.getElementById('pg-dispatch');
        return { docW: document.documentElement.scrollWidth, vw: window.innerWidth,
                 scrollW: el.scrollWidth, clientW: el.clientWidth };
      });
      expect(out.docW).toBeLessThanOrEqual(out.vw + 1);
      expect(out.scrollW).toBeLessThanOrEqual(out.clientW + 1);
    });

    test('the location modal is centred, like every other prompt here', async () => {
      const box = await page.evaluate(() => {
        document.getElementById('place-modal')?.remove();
        openPlaceModal(null, 39.03, -95.77);
        const card = document.querySelector('#place-modal .zmodal');
        if (!card) return null;
        const r = card.getBoundingClientRect();
        const out = { cx: r.left + r.width / 2, vw: window.innerWidth, vh: window.innerHeight,
                      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                      docW: document.documentElement.scrollWidth };
        document.getElementById('place-modal')?.remove();
        return out;
      });
      expect(box).not.toBeNull();
      expect(Math.abs(box.cx - box.vw / 2)).toBeLessThanOrEqual(1);
      expect(box.top).toBeGreaterThan(0);          // no longer pinned to the bottom edge
      expect(box.bottom).toBeLessThan(box.vh);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      expect(box.docW).toBeLessThanOrEqual(box.vw + 1);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
