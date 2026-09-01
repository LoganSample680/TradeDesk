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
    // Name the business zone: the day-key and clock-stamp helpers follow the
    // business address now, not a hardcoded Central (owner 2026-08-30), so a
    // spec that does not say where the business is inherits the runner's zone
    // (UTC in CI, Central on a Kansas laptop) and its result stops being about
    // the code. Same rule as the clock pin, CLAUDE.md 5.2.2.
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
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
        // 9:12 IN THE BUSINESS'S ZONE, built through the app's own inverse
        // converter, because the row RENDERS in that zone. setHours() builds
        // the runner's 9:12, which is a different instant everywhere except a
        // machine that happens to sit in the business's timezone, and the
        // assertions below are about the clock a contractor reads.
        const day = _bizDateStr(new Date());
        const startIso = _tlBizInputToIso(day + 'T09:12');
        const endIso = _tlBizInputToIso(day + 'T10:47');
        mileage.push({ id: 991002, date: day, from_name: 'Shop', to_name: 'Miller Residence',
          miles: 12.3, mins: 95, startedIso: startIso, endedIso: endIso,
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

    test('the log is year -> month -> day on the SAME Books accordion, never a hand-rolled one', async () => {
      // Owner 2026-08-13: "same accordion constant logic, no new hand rolled
      // accordion please." The month shell is _bkMonthAcc/_bkTogMonth from
      // finance.js, the one Income/Expenses/Time Log already share; the day
      // cards inside are mileage's existing day accordions, unchanged.
      const out = await page.evaluate(() => {
        window.__origMileage = mileage.slice();
        mileage.length = 0;
        const yr = todayKey().slice(0, 4);
        const curMo = todayKey().slice(0, 7);
        // Two months: one row today, two rows in an earlier month this year.
        const older = curMo.endsWith('-01') ? yr + '-12' : curMo.slice(0, 5) + String(parseInt(curMo.slice(5)) - 1).padStart(2, '0');
        mileage.push({ id: 991101, date: todayKey(), from_name: 'Shop', to_name: 'Miller Residence', miles: 4.1, purpose: 'Job site', gps: true, created_at: new Date().toISOString() });
        mileage.push({ id: 991102, date: older + '-05', from_name: 'Shop', to_name: 'Ace Supply', miles: 2.2, purpose: 'Supply run', gps: true, created_at: new Date().toISOString() });
        mileage.push({ id: 991103, date: older + '-06', from_name: 'Ace Supply', to_name: 'Shop', miles: 2.2, purpose: 'Supply run', gps: true, created_at: new Date().toISOString() });
        renderAllMileage();
        const list = document.getElementById('mil-table');
        const monthEls = [...list.querySelectorAll('.bk-month')];
        const cur = document.getElementById('bk-mil-mo-' + curMo);
        const old = document.getElementById('bk-mil-mo-' + older);
        const res = {
          months: monthEls.length,
          usesSharedShell: monthEls.every(m => m.querySelector('.bk-month-hd') && m.querySelector('.bk-month-body')),
          curOpen: !!(cur && cur.classList.contains('open')),
          oldClosed: !!(old && !old.classList.contains('open')),
          oldBodyHidden: old ? old.querySelector('.bk-month-body').style.display === 'none' : null,
          // The day cards live INSIDE month bodies now, never loose in the list.
          daysInsideMonths: [...list.querySelectorAll('.mil-day')].every(d => d.closest('.bk-month-body')),
          oldMonthDayCount: old ? old.querySelectorAll('.mil-day').length : 0,
          curSub: cur ? (cur.querySelector('.bk-month-sub')?.innerText || '') : '',
          // The shared toggler works on the mileage months too.
          togWorks: (() => { if (!old) return false; _bkTogMonth('mil', older); return old.classList.contains('open') && old.querySelector('.bk-month-body').style.display !== 'none'; })(),
        };
        mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        return res;
      });
      expect(out.months, 'one accordion per month').toBe(2);
      expect(out.usesSharedShell, 'the Books month shell, not a hand-rolled one').toBe(true);
      expect(out.curOpen, 'the current month arrives open').toBe(true);
      expect(out.oldClosed, 'older months arrive collapsed').toBe(true);
      expect(out.oldBodyHidden).toBe(true);
      expect(out.daysInsideMonths, 'every day card nests inside a month body').toBe(true);
      expect(out.oldMonthDayCount, 'the older month holds its two days').toBe(2);
      expect(out.curSub, 'month sub reads trips and days').toContain('1 trip');
      expect(out.togWorks, 'the shared _bkTogMonth toggler opens mileage months').toBe(true);
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

    // ── A SERVER ESTIMATE MUST NOT BLOCK THE MEASUREMENT ──────────────────
    // Owner, 2026-08-31, on his drive home: the log read 2.1 miles from "John
    // Doe" to "2015 SW Randolph Ave" for the exact road he had driven out on
    // at 3.2 miles an hour earlier. Giving both writers one clock made their
    // legKeys match, which killed the duplicate rows and, in the same stroke,
    // let the server's provisional straight-line row satisfy the idempotence
    // guard so the phone never wrote its measured one.
    const srvRow = (d, over) => Object.assign({
      id: 'srv-leg-prov-1', legKey: 'leg-prov-1', gps: true, provisional: true,
      calc_method: 'server_est', miles: 2.1, gpsMiles: 0,
      startedIso: new Date(Date.now() - 20 * 60000).toISOString(),
      endedIso: new Date(Date.now() - 7 * 60000).toISOString(), mins: 13,
      from_name: 'John Doe', from: '2950 SW McClure Rd',
      to_name: '2015 SW Randolph Ave', to: '2015 SW Randolph Ave',
      fromCoord: { lat: d.JOB.lat, lng: d.JOB.lon },
      toCoord: { lat: d.SHOP.lat, lng: d.SHOP.lon },
      purpose: 'Business', loggedAt: new Date().toISOString(),
    }, over || {});

    const overServer = (page, world) => page.evaluate(async (d) => {
      const realUser = _supaUser, realRoute = _routeDistance;
      const before = mileage.slice();
      _supaUser = { id: 'u-mi' };
      window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 9 });
      try {
        mileage.unshift(d.srv);
        const from = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'John Doe', kind: 'client', clientId: 7701 };
        const to = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
        const r = autoLogDriveTrip({ from, to, legKey: 'leg-prov-1',
          startedIso: new Date(Date.now() - 18 * 60000).toISOString() });
        await new Promise(x => setTimeout(x, 40));
        const rows = mileage.filter(m => m && m.legKey === 'leg-prov-1');
        return { returned: !!r, count: rows.length,
                 id: rows[0] && rows[0].id, miles: rows[0] && rows[0].miles,
                 calc: rows[0] && rows[0].calc_method,
                 prov: rows[0] && rows[0].provisional,
                 from: rows[0] && rows[0].from_name, to: rows[0] && rows[0].to_name };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        mileage.length = 0; before.forEach(m => mileage.push(m));
      }
    }, world);

    test('the measured leg replaces a provisional server row instead of being dropped', async () => {
      const r = await overServer(page, { srv: srvRow({ JOB, SHOP }), JOB, SHOP });
      expect(r.returned, 'the phone must not silently decline to log its own drive').toBe(true);
      expect(r.count, 'one drive, still one row').toBe(1);
      expect(r.miles, 'the routed distance, not the straight-line estimate').toBe(3.2);
      expect(r.calc).toBe('auto_route');
      expect(r.prov, 'and it is no longer a provisional row').toBeUndefined();
    });

    test('it keeps the server row id, so the cloud row is updated not orphaned', async () => {
      // Delete-and-recreate would leave a window with no record of the drive
      // at all, which is exactly what cost Jack a whole trip on 2026-08-30.
      const r = await overServer(page, { srv: srvRow({ JOB, SHOP }), JOB, SHOP });
      expect(r.id).toBe('srv-leg-prov-1');
    });

    test('the phone\'s own names win: "Shop", not the fence id the server saw', async () => {
      const r = await overServer(page, { srv: srvRow({ JOB, SHOP }), JOB, SHOP });
      expect(r.from).toBe('John Doe');
      expect(r.to, 'the server had no idea this place was the shop').toBe('Shop');
    });

    test('a REAL client row still blocks it: that guard has not moved', async () => {
      // The idempotence this whole key exists for. Only a provisional row may
      // be replaced; a settled one means the leg is already properly logged.
      const r = await overServer(page, {
        srv: srvRow({ JOB, SHOP }, { provisional: undefined, calc_method: 'auto_route', miles: 3.2 }),
        JOB, SHOP });
      expect(r.returned, 'a settled row is still the end of the matter').toBe(false);
      expect(r.count).toBe(1);
      expect(r.id).toBe('srv-leg-prov-1');
    });

    test('a provisional row alongside a settled one does not open the door', async () => {
      // Mixed set: every row for the key must be provisional before the guard
      // stands down, or a stray server duplicate would let a settled leg be
      // rewritten.
      const r = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        const before = mileage.slice();
        _supaUser = { id: 'u-mi' };
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 9 });
        try {
          mileage.unshift({ id: 'real-1', legKey: 'leg-mix-1', gps: true, miles: 3.2,
            calc_method: 'auto_route', from_name: 'John Doe', to_name: 'Shop',
            fromCoord: { lat: d.JOB.lat, lng: d.JOB.lon }, toCoord: { lat: d.SHOP.lat, lng: d.SHOP.lon } });
          mileage.unshift({ id: 'srv-1', legKey: 'leg-mix-1', gps: true, provisional: true,
            miles: 2.1, calc_method: 'server_est',
            fromCoord: { lat: d.JOB.lat, lng: d.JOB.lon }, toCoord: { lat: d.SHOP.lat, lng: d.SHOP.lon } });
          const from = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'John Doe', kind: 'client' };
          const to = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          const r2 = autoLogDriveTrip({ from, to, legKey: 'leg-mix-1', startedIso: new Date().toISOString() });
          return { returned: !!r2, count: mileage.filter(m => m && m.legKey === 'leg-mix-1').length };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
          mileage.length = 0; before.forEach(m => mileage.push(m));
        }
      }, { JOB, SHOP });
      expect(r.returned).toBe(false);
      expect(r.count, 'nothing added, nothing rewritten').toBe(2);
    });

    test('no prior row at all is unchanged: a fresh leg still just writes', async () => {
      const r = await page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance;
        const before = mileage.slice();
        _supaUser = { id: 'u-mi' };
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 9 });
        try {
          const from = { lat: d.JOB.lat, lng: d.JOB.lon, name: 'John Doe', kind: 'client' };
          const to = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          const r2 = autoLogDriveTrip({ from, to, legKey: 'leg-fresh-1', startedIso: new Date().toISOString() });
          await new Promise(x => setTimeout(x, 40));
          const rows = mileage.filter(m => m && m.legKey === 'leg-fresh-1');
          return { returned: !!r2, count: rows.length, miles: rows[0] && rows[0].miles };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
          mileage.length = 0; before.forEach(m => mileage.push(m));
        }
      }, { JOB, SHOP });
      expect(r.returned).toBe(true);
      expect(r.count).toBe(1);
      expect(r.miles).toBe(3.2);
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

    // ── The sweep that deleted a real drive (Jack, 2026-08-30) ──────────────
    // 8.4 miles home, recorded by the server while the app was closed. He
    // opened the app for three seconds. This sweep picked a winner that had
    // never been uploaded, deleted the loser that HAD been, and the drive was
    // gone: the delete goes straight to the cloud via _tdSoftDelete, so it
    // lands whether or not the save that would justify it ever runs.
    test('a saved row is never deleted for a winner that is not in the cloud', async () => {
      const out = await page.evaluate(() => {
        const A = { lat: 39.0475, lng: -95.6815 }, HOME = { lat: 39.0226, lng: -95.798 };
        const keep = mileage.splice(0);
        const hadHash = _syncedHash.td_mileage;
        try {
          // 501 is the server's row and it IS in the cloud. 502 is the phone's,
          // newer so it wins the pair, and has never been uploaded.
          mileage.push(
            // The PHONE row (502) is logged first, because it closes the leg
            // locally the moment the drive ends, and the server's copy lands
            // afterwards. So the winner rule (earliest loggedAt) hands the
            // journey to the row that has never been uploaded, which is
            // precisely the shape that lost the drive.
            { id: 501, gps: true, legKey: 'leg-srv', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:18Z',
              endedIso: '2026-08-30T23:25:13Z', loggedAt: '2026-08-30T23:25:20Z', date: '2026-08-30' },
            { id: 502, gps: true, legKey: 'leg-phone', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:21Z',
              endedIso: '2026-08-30T23:25:16Z', loggedAt: '2026-08-30T23:25:14Z', date: '2026-08-30' });
          _syncedHash.td_mileage = new Map([['501', 'h']]);
          // BOOT HEAL, which is the pass that actually ran on his phone: the
          // live sweep only pairs legs whose starts match to the millisecond,
          // and two writers never agree that closely.
          const removed = _mileDedupTrips(true);
          return { removed, ids: mileage.map(m => String(m.id)).sort() };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          if (hadHash) _syncedHash.td_mileage = hadHash; else delete _syncedHash.td_mileage;
        }
      });
      // Both survive. A duplicate for one session beats the trip, permanently.
      expect(out.removed, 'nothing may be dropped this pass').toBe(0);
      expect(out.ids).toEqual(['501', '502']);
    });

    test('once the winner IS in the cloud, the duplicate collapses as before', async () => {
      const out = await page.evaluate(() => {
        const A = { lat: 39.0475, lng: -95.6815 }, HOME = { lat: 39.0226, lng: -95.798 };
        const keep = mileage.splice(0);
        const hadHash = _syncedHash.td_mileage;
        try {
          mileage.push(
            // The PHONE row (502) is logged first, because it closes the leg
            // locally the moment the drive ends, and the server's copy lands
            // afterwards. So the winner rule (earliest loggedAt) hands the
            // journey to the row that has never been uploaded, which is
            // precisely the shape that lost the drive.
            { id: 501, gps: true, legKey: 'leg-srv', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:18Z',
              endedIso: '2026-08-30T23:25:13Z', loggedAt: '2026-08-30T23:25:20Z', date: '2026-08-30' },
            { id: 502, gps: true, legKey: 'leg-phone', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:21Z',
              endedIso: '2026-08-30T23:25:16Z', loggedAt: '2026-08-30T23:25:14Z', date: '2026-08-30' });
          // Both persisted now: the deferral was only ever about protecting the
          // ONLY saved copy, so the dedupe must resume doing its job.
          _syncedHash.td_mileage = new Map([['501', 'h'], ['502', 'h']]);
          const removed = _mileDedupTrips(true);
          return { removed, ids: mileage.map(m => String(m.id)) };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          if (hadHash) _syncedHash.td_mileage = hadHash; else delete _syncedHash.td_mileage;
        }
      });
      expect(out.removed).toBe(1);
      expect(out.ids).toEqual(['502']);
    });

    test('two rows neither of which is saved still collapse, there is nothing to protect', async () => {
      const out = await page.evaluate(() => {
        const A = { lat: 39.0475, lng: -95.6815 }, HOME = { lat: 39.0226, lng: -95.798 };
        const keep = mileage.splice(0);
        const hadHash = _syncedHash.td_mileage;
        try {
          mileage.push(
            { id: 601, gps: true, legKey: 'leg-x', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:18Z',
              endedIso: '2026-08-30T23:25:13Z', loggedAt: '2026-08-30T23:25:14Z', date: '2026-08-30' },
            { id: 602, gps: true, legKey: 'leg-y', calc_method: 'auto_route', miles: 8.4,
              fromCoord: A, toCoord: HOME, startedIso: '2026-08-30T22:45:21Z',
              endedIso: '2026-08-30T23:25:16Z', loggedAt: '2026-08-30T23:25:18Z', date: '2026-08-30' });
          _syncedHash.td_mileage = new Map();
          const removed = _mileDedupTrips(true);
          return { removed, n: mileage.length };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          if (hadHash) _syncedHash.td_mileage = hadHash; else delete _syncedHash.td_mileage;
        }
      });
      // The guard protects PERSISTED evidence. It is not a licence to hoard
      // duplicates that exist only in memory.
      expect(out.removed).toBe(1);
      expect(out.n).toBe(1);
    });

    // ── Two writers, one drive, two origins (owner's real 8/27) ──────────────
    // His day logged 22.1 miles across 8 legs against roughly 15.1 actually
    // driven, a 46% overstatement on a tax record, because three drives each
    // kept two rows. Both writers agreed where he ARRIVED and disagreed about
    // where he set off ("Shop -> John Doe 3.2mi" beside "Stop -> John Doe
    // 2.5mi", same 7:51 departure), so the both-endpoints twin test never
    // fired and _mileSameJourney bails outright when both rows carry legKeys.
    test('one drive with two origins collapses; a genuine repeat run does not', async () => {
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 };
        const SHOP = { lat: 39.0325, lng: -95.69 }, KERB = { lat: 39.0301, lng: -95.7013 };
        const keep = mileage.splice(0);
        try {
          mileage.push(
            { id: 1, gps: true, legKey: 'leg-mtbj12c9', calc_method: 'auto_route', miles: 3.2,
              from_name: 'Shop', to_name: 'John Doe', fromCoord: SHOP, toCoord: JOHN,
              startedIso: '2026-08-27T12:51:00Z', endedIso: '2026-08-27T12:59:00Z',
              loggedAt: '2026-08-27T12:59:02Z', date: '2026-08-27' },
            { id: 2, gps: true, legKey: 'leg-mtbiue45', calc_method: 'auto_route', miles: 2.5,
              from_name: 'Stop', to_name: 'John Doe', fromCoord: KERB, toCoord: JOHN,
              startedIso: '2026-08-27T12:51:00Z', endedIso: '2026-08-27T12:56:00Z',
              loggedAt: '2026-08-27T12:56:04Z', date: '2026-08-27' });
          const live = _mileDedupTrips();          // live sweep leaves auto rows alone
          const healed = _mileDedupTrips(true);    // boot heal collapses them
          const again = _mileDedupTrips(true);
          return { live, healed, again, rows: mileage.map(m => ({ id: m.id, miles: m.miles })) };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.live, 'the live sweep must not touch two auto rows').toBe(0);
      expect(out.healed).toBe(1);
      expect(out.again, 'healing must not keep healing').toBe(0);
      // One drive, 3.2 miles, not 5.7.
      expect(out.rows).toEqual([{ id: 1, miles: 3.2 }]);
    });

    test('a genuinely repeated run to the same client survives, because it does not overlap', async () => {
      // The rule the both-endpoints test was protecting: a crew really can
      // drive to one client twice in a day. Sequential, never simultaneous.
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        try {
          mileage.push(
            { id: 1, gps: true, legKey: 'leg-am', calc_method: 'auto_route', miles: 3.2,
              from_name: 'Shop', to_name: 'John Doe', fromCoord: SHOP, toCoord: JOHN,
              startedIso: '2026-08-27T12:51:00Z', endedIso: '2026-08-27T12:59:00Z',
              loggedAt: '2026-08-27T12:59:02Z', date: '2026-08-27' },
            { id: 2, gps: true, legKey: 'leg-pm', calc_method: 'auto_route', miles: 3.2,
              from_name: 'Shop', to_name: 'John Doe', fromCoord: SHOP, toCoord: JOHN,
              startedIso: '2026-08-27T17:50:00Z', endedIso: '2026-08-27T17:58:00Z',
              loggedAt: '2026-08-27T17:58:03Z', date: '2026-08-27' });
          const healed = _mileDedupTrips(true);
          return { healed, rows: mileage.map(m => m.id) };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.healed).toBe(0);
      expect(out.rows).toEqual([1, 2]);
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

    test('a MEASURED auto row absorbs an UNMEASURED manual one now, not never (fuzzer find 2026-08-13)', async () => {
      // A manual trip whose From was left blank (the realistic mid-drive tap)
      // can never be measured: no origin to route from. "Wait until both have
      // numbers" therefore left it as a permanent 0-mile duplicate. Deleting
      // it early loses nothing, the winner rule hands the journey to the
      // automatic row whatever the numbers say. The REVERSE still defers
      // (previous test): a pending auto row must prove it can measure before
      // it may eat the only real number in the pair.
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        try {
          const manual = { id: 11, calc_method: 'pending', miles: 0, client_id: 77,
            from: '', from_name: '', to: 'John Doe', to_name: 'John Doe',
            loggedAt: '2026-08-11T12:55:30Z', date: '2026-08-11' };
          const auto = { id: 12, gps: true, legKey: 'leg-abs', calc_method: 'auto_route', miles: 3.2, client_id: 77,
            fromCoord: SHOP2, toCoord: JOHN, startedIso: '2026-08-11T12:51:00Z',
            endedIso: '2026-08-11T12:57:00Z', loggedAt: '2026-08-11T12:57:02Z', date: '2026-08-11' };
          mileage.push(manual, auto);
          const dropped = _mileDedupTrips();
          return { dropped, left: mileage.map(m => m.id) };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.dropped, 'the unmeasurable manual row is absorbed immediately').toBe(1);
      expect(out.left).toEqual([12]);
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

    // Owner audit 2026-08-24: the 8/21 twin pair survived in the CLOUD days
    // after every boot's heal pass spliced one away locally, because a cloud
    // reload restored it before any save swept it. A dropped twin must be a
    // REAL deletion: tombstoned and deleted from td_mileage directly.
    test('a dropped auto twin is deleted from the cloud, not just spliced locally', async () => {
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        const keep = mileage.splice(0);
        const savedSupa = window._supa, savedUser = window._supaUser;
        const cloudDeletes = [];
        window._supaUser = window._supaUser || { id: 'twin-del-u' };
        // Records the SOFT delete (2026-08-26): sweeps stamp deleted_at through
        // _tdSoftDelete now rather than issuing a DELETE, so the recorder has to
        // watch update().in() to see the same event. The hard-delete branch is
        // kept so this still catches a sweep that regresses to one.
        window._supa = { from: (tbl) => ({
          delete: () => ({ eq: (c1, v1) => ({ eq: () => ({ then: (res, rej) => { cloudDeletes.push({ tbl, id: v1 }); return Promise.resolve({ error: null }).then(res, rej); } }) }) }),
          update: (patch) => { const u = { in: (col, vals) => { (vals || []).forEach(v => cloudDeletes.push({ tbl, id: String(v) })); return u; },
                                           eq: () => u, then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return u; },
          select: () => { const q = new Proxy(function(){}, { get: (_, k) =>
            k === 'then' ? (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) : () => q }); return q; },
        }) };
        try {
          mileage.push(
            { id: 9301, gps: true, legKey: 'twin-w', calc_method: 'auto_route', miles: 3.2, client_id: 77,
              to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
              startedIso: '2026-08-21T12:48:53.281Z', endedIso: '2026-08-21T12:55:55.101Z', loggedAt: '2026-08-21T12:55:55.106Z', date: '2026-08-21' },
            { id: 9302, gps: true, legKey: 'twin-l', calc_method: 'auto_route', miles: 3.2, client_id: 77,
              to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
              startedIso: '2026-08-21T12:48:53.275Z', endedIso: '2026-08-21T12:58:34.983Z', loggedAt: '2026-08-21T14:52:11.874Z', date: '2026-08-21' });
          const healed = _mileDedupTrips(true);
          return { healed, left: mileage.map(m => m.id), cloudDeletes };
        } finally {
          mileage.length = 0; keep.forEach(m => mileage.push(m));
          window._supa = savedSupa; window._supaUser = savedUser;
        }
      });
      expect(out.healed).toBe(1);
      expect(out.left, 'the contemporaneous close survives, the replay dies').toEqual([9301]);
      // ASSERTION UPDATED 2026-08-26 (10.4). This required a HARD .delete() on
      // td_mileage. Owner directive that day: every sweep soft deletes so a
      // wrong guess can be undone, and _mileDedupTrips now goes through
      // _tdSoftDelete like the rest. The intent the test was protecting is
      // unchanged and still checked, the loser must be removed on the SERVER so
      // no reload resurrects it, only the verb changed from delete to a
      // deleted_at stamp.
      expect(out.cloudDeletes, 'the loser is removed on the server, so no reload can resurrect it')
        .toEqual([{ tbl: 'td_mileage', id: '9302' }]);
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
      // _bizDateStr in finance.js) and is behind UTC, so the evening genuinely
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
        // The lookup fills the NAME only. It used to stamp the Type as well,
        // through _poiPlaceKind, which answers 'supply' for everything that is
        // not a restaurant, so promoting a stop pre-filled Supply house exactly
        // the way the old static default did (owner 2026-08-31: "dont want to
        // pre fill things in"). Type is now the contractor's answer, always.
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
      expect(out.kind, 'a category guess is not the contractor saying what a place is').toBe('');
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
    // "Today" comes from the PAGE, never from Node. This is the third and,
    // structurally, the last form of the boundary bug this comment block has
    // chronicled: first todayKey() was called in Node where it does not
    // exist, then a Node-defined helper was called in the browser, and then
    // the fix, computing the date in Node, was itself broken by the harness
    // clock pin (tests/helpers.js): the app now runs on a page clock pinned
    // to 10:00 Central while Node keeps the runner's real clock, so from
    // 19:00 Central to midnight (runner UTC one day ahead) every fixture
    // keyed to Node's "today" landed on the app's TOMORROW. The truck seeded
    // as down-today was not down yet on the app's calendar, and nine tests
    // failed for the hour of day. The page's own todayKey() reads the pinned
    // clock, which is the only clock the code under test can see.
    const todayLocal = () => page.evaluate(() => todayKey());
    const setup = (o) => page.evaluate((a) => {
      S.employees = [{ id: 'e-danny', name: 'Danny' }, { id: 'e-sam', name: 'Sam' }];
      vehicles.length = 0;
      vehicles.push({ id: 'v-250', name: 'F-250', status: 'active', crewDrivable: true, downtimeLog: a.down || [] });
      vehicles.push({ id: 'v-van', name: 'Transit', status: 'active', crewDrivable: !!a.vanDrivable, downtimeLog: a.vanDown || [] });
      if (a.usual) S.employees[0].usualVehicle = a.usual;
      jobs.length = 0;
      jobs.push({ id: 8801, name: 'Job', status: 'upcoming', start: a.today, days: 1, assignedTo: 'e-danny' });
      return true;
    }, o);

    test('a usual truck answers for today with nobody touching anything', async () => {
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: await todayLocal() });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.mode).toBe('truck');
      expect(r.vehicleId).toBe('v-250');
      expect(r.reason).toBe('usual');
    });

    test('the usual truck being in the shop does NOT quietly keep deducting', async () => {
      const day = await todayLocal();
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: day,
                    down: [{ start: day, end: null }] });   // open end = still in
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      // Not 'truck'. This is the whole point.
      expect(r.mode).toBe('none');
      expect(r.reason).toBe('usual-down');
      expect(r.downVehicleName).toBe('F-250');
    });

    test('with the truck down and another free, dispatch offers that one', async () => {
      const day = await todayLocal();
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: day,
                    down: [{ start: day, end: null }], vanDrivable: true });
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
      const day = await todayLocal();
      await setup({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: day,
                    down: [{ start: day, end: null }],
                    vanDrivable: true, vanDown: [{ start: day, end: null }] });
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
      await setup({ today: await todayLocal() });
      const r = await page.evaluate(() => _crewVehicleForDay('e-danny'));
      expect(r.reason).toBe('unset');
      const need = await page.evaluate(() => crewNeedingVehicleAnswer());
      expect(need.map(n => n.name)).toEqual(['Danny']);
    });

    test('somebody not working today is not a gap', async () => {
      await setup({});   // deliberately NO today: the job lands on no valid day
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
    // Same rule as the describe above: the day comes from the PAGE's pinned
    // clock, because Node's clock is a different clock since the harness pin.
    const dayLocal = () => page.evaluate(() => todayKey());
    const seed = (o) => page.evaluate((a) => {
      S.employees = [{ id: 'e-danny', name: 'Danny' }];
      vehicles.length = 0;
      vehicles.push({ id: 'v-250', name: 'F-250', status: 'active', crewDrivable: true, downtimeLog: a.down || [] });
      if (a.usual) S.employees[0].usualVehicle = a.usual;
      jobs.length = 0;
      jobs.push({ id: 8811, name: 'Job', status: 'upcoming', start: a.today, days: 1, assignedTo: 'e-danny' });
      return true;
    }, o);

    test('somebody with no answer shows on the card', async () => {
      await seed({ today: await dayLocal() });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('Danny');
      expect(html).toContain('No usual vehicle set yet');
      expect(html).toContain('1 person needs');
    });

    test('answering it once clears the card', async () => {
      await seed({ today: await dayLocal() });
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', 'v-250');
        const e = S.employees[0];
        return { usual: e.usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toEqual({ mode: 'truck', vehicleId: 'v-250' });
      expect(out.html).toBe('');   // nothing left to ask
    });

    test('"their own vehicle" is a real answer, not an absence', async () => {
      await seed({ today: await dayLocal() });
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', 'own');
        return { usual: S.employees[0].usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toEqual({ mode: 'own' });
      expect(out.html).toBe('');
    });

    test('clearing it back to unset is allowed, and reopens the question', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: await dayLocal() });
      const out = await page.evaluate(() => {
        setUsualVehicle('e-danny', '');
        return { usual: S.employees[0].usualVehicle, html: _dispatchVehicleGapHtml() };
      });
      expect(out.usual).toBeUndefined();
      expect(out.html).toContain('Danny');
    });

    test('a usual truck in the shop shows WHY, by name', async () => {
      const day = await dayLocal(); await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: day, down: [{ start: day, end: null }] });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('F-250 is in the shop');
    });

    test('with every truck down the card offers no truck at all', async () => {
      const day = await dayLocal(); await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: day, down: [{ start: day, end: null }] });
      const html = await page.evaluate(() => _dispatchVehicleGapHtml());
      expect(html).toContain('Their own vehicle');
      // The only crew-drivable truck is the one in the shop, so it must not be
      // offered as the answer to its own absence.
      expect(html).not.toContain('>F-250<');
    });

    test('nothing to ask means no card', async () => {
      await seed({ usual: { mode: 'truck', vehicleId: 'v-250' }, today: await dayLocal() });
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
      await seed({ today: await dayLocal() });
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
      await seed({ today: await dayLocal() });
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
      // Isolated log: a stale leg now checks the log for an already-covering
      // row (the gap-echo guard), and this fixture fabricates a 14-hour clock
      // inside a session whose earlier tests logged the same shop -> job leg
      // minutes ago on the WALL clock. In the real world those rows could only
      // exist during the sleep if they were echoes; in the compressed fixture
      // world they are unrelated tests. Give the fabricated night its own log.
      const savedLog = mileage.slice();
      mileage.length = 0;
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
        mileage.length = 0; savedLog.forEach(m => mileage.push(m));
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
      // 'client', not 'place' (2026-08-29): John Doe is a customer, and a
      // customer's address stopped sharing a source with a supply house.
      const visit = r.entries.find(e => e.tbl === 'job_time_entries' && e.row.source === 'client' && e.row.dest_place === 'John Doe');
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
      // ASSERTIONS REWRITTEN 2026-08-26 (10.4). Every line here pinned an
      // INFERENCE about iOS drawn from something that is not iOS: our watcher
      // being alive, our stored consent, our os-denied flag. Owner that day:
      // "I don't want ours, ours does nothing in a true native app, go entirely
      // off iOS since location calls capacitor plugins."
      //
      // They were not harmless. A delivering watcher reading as 'granted' is
      // exactly how a phone on whenInUse, which can never track from a pocket,
      // reported itself healthy. On a native shell the answer now comes from
      // iOS or not at all, and 'prompt' means "not established", never a denial.
      expect(r.running, 'a live watcher proves the tracker started, not what iOS granted').toBe('prompt');
      expect(r.declined, 'our own declined flag is not an iOS status').toBe('prompt');
      expect(r.consented, 'they agreed to be tracked; that is not iOS agreeing').toBe('prompt');
      expect(r.osDenied, 'a watcher error is our reading of a failure, not a status').toBe('prompt');
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
          // §7.1: the ungated Cloud sync copy (set-geo-diag-btn2, added
          // 2026-08-21 so the panel stayed reachable on the plain UAT web
          // link) was removed 2026-08-25 on owner instruction: "put it under
          // the advanced developer tools section, it needs to be there."
          // Prove the DELETION, not just that the Developer copy works, or a
          // future change re-adds it citing the 08-21 note and nothing catches
          // it. Two nets: the exact id is gone document-wide, and no control
          // under #setd-cloud reaches the panel by any route.
          const cloud = document.getElementById('setd-cloud');
          const cloudCtrls = cloud ? Array.from(cloud.querySelectorAll('button,a,[onclick]')) : [];
          return {
            opened,
            hasState: /Park mode/.test(text) && /GPS watcher/.test(text),
            grpHiddenInBrowser: grp ? grp.style.display === 'none' : null,
            underDev: !!(btn && btn.closest('#setd-dev')) && !!(shadowBtn && shadowBtn.closest('#setd-dev')),
            notUnderCloud: !(btn && btn.closest('#setd-cloud')),
            cloudSectionExists: !!cloud,
            oldIdGone: !document.getElementById('set-geo-diag-btn2'),
            noDiagRouteInCloud: !cloudCtrls.some(el =>
              /_geoDiagPanel/.test(el.getAttribute('onclick') || '') ||
              /location diagnostics/i.test(el.textContent || '')),
          };
        } finally { window.Capacitor = realCap; }
      });
      expect(r.opened).toBe(true);
      expect(r.hasState).toBe(true);
      expect(r.grpHiddenInBrowser, 'no location engine tools outside the shell').toBe(true);
      expect(r.underDev, 'both tools sit under Settings → Developer').toBe(true);
      expect(r.notUnderCloud, 'and no longer beside Cloud sync').toBe(true);
      expect(r.cloudSectionExists, 'the Cloud sync section itself is still there to check').toBe(true);
      expect(r.oldIdGone, 'the ungated Cloud sync copy set-geo-diag-btn2 is deleted, not hidden').toBe(true);
      expect(r.noDiagRouteInCloud, 'nothing under Cloud sync opens the diagnostics panel any more').toBe(true);
    });

    // Owner 2026-08-25: "don't keep inferring, build explicitly off what iOS
    // reports", and "device wide location services ... why do we need it?"
    // The panel showed Consent and OS-denied, both app-side readings, and
    // nothing iOS actually said. It now shows all three independent axes,
    // because any one of them being wrong stops every ping while the other
    // two keep looking healthy.
    test('the diagnostics panel shows all three location axes straight off iOS', async () => {
      const r = await page.evaluate(async () => {
        const realCap = window.Capacitor;
        const savedNat = (typeof _geoNativeAuth !== 'undefined') ? _geoNativeAuth : undefined;
        const read = () => {
          _geoDiagPanel();
          const ov = document.getElementById('_geo-diag-ov');
          const text = ov ? ov.textContent : '';
          ov && ov.remove();
          return text;
        };
        try {
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
          if (typeof _geoNativeAuth !== 'undefined') {
            _geoNativeAuth = { status: 'always', accuracy: 'full', precise: true, servicesEnabled: true };
          }
          const on = read();
          // The trap this row exists for: iOS still says `always` with the
          // master switch off, so the grant line alone reads as healthy.
          if (typeof _geoNativeAuth !== 'undefined') {
            _geoNativeAuth = { status: 'always', accuracy: 'full', precise: true, servicesEnabled: false };
          }
          const off = read();
          // An older shell cannot answer at all, and 'unknown' must not be
          // rendered as OFF: telling someone to fix a switch that is already
          // on is how the whole panel loses credibility.
          if (typeof _geoNativeAuth !== 'undefined') {
            _geoNativeAuth = { status: 'always', accuracy: 'full', precise: true, servicesEnabled: null };
          }
          const unknown = read();
          if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = null;
          const none = read();
          return { on, off, unknown, none };
        } finally {
          window.Capacitor = realCap;
          if (typeof _geoNativeAuth !== 'undefined') _geoNativeAuth = savedNat;
        }
      });
      expect(r.on).toContain('Location Services (device)');
      expect(r.on).toContain('iOS location');
      expect(r.on).toContain('Precise Location');
      // Label and value render as adjacent spans, so match the pair rather
      // than a bare 'ON' that would pass on almost any text in the panel.
      expect(r.on, 'the master switch is on').toContain('Location Services (device)ON');
      expect(r.off, 'and the panel says plainly that nothing can arrive')
        .toContain('Location Services (device)OFF, nothing can arrive');
      expect(r.off, 'while iOS still reports the app grant as always').toContain('always');
      expect(r.unknown, 'an old shell reads unknown, never OFF').toContain('unknown (old build)');
      expect(r.unknown).not.toContain('OFF, nothing can arrive');
      expect(r.none, 'no plugin at all is its own honest answer').toContain('unknown (no plugin)');
      expect(r.none, 'and the grant line says not reported rather than guessing').toContain('not reported');
    });

    // Owner ask 2026-08-23: the diagnostics panel showed raw UTC event
    // times, confusing to read against a phone that's on Central time.
    // _geoParkNote now stores the full ISO instant; _geoDiagFmtT converts
    // to Central at render time. August is CDT (UTC-5).
    test('_bizStamp/_bizHM convert a UTC instant to Central time, DST-correct', async () => {
      const r = await page.evaluate(() => ({
        augStamp: _bizStamp(new Date('2026-08-23T20:58:31.000Z')),   // CDT, UTC-5
        augHM: _bizHM(new Date('2026-08-21T22:07:00.000Z')),
        janStamp: _bizStamp(new Date('2026-01-15T20:58:31.000Z')),   // CST, UTC-6
      }));
      expect(r.augStamp).toBe('08-23T15:58:31');
      expect(r.augHM).toBe('17:07');
      expect(r.janStamp, 'winter uses CST (UTC-6), not a fixed offset').toBe('01-15T14:58:31');
    });

    test('_geoDiagFmtT converts a full-ISO park-log entry to Central', async () => {
      const r = await page.evaluate(() => _geoDiagFmtT(new Date('2026-08-23T20:58:31.123Z').toISOString()));
      expect(r).toBe('08-23T15:58:31');
    });

    // Backward compatibility: entries already sitting in an on-device
    // localStorage log from before this fix are the OLD sliced format
    // (no year, implicitly UTC), and must still render correctly after an
    // app update, not throw or show garbage.
    test('_geoDiagFmtT still converts the old sliced (no-year) format for entries logged before this fix', async () => {
      const r = await page.evaluate(() => _geoDiagFmtT('08-23T20:58:31'));
      expect(r).toBe('08-23T15:58:31');
    });

    test('_geoDiagFmtT passes through empty/malformed input without throwing', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: [_geoDiagFmtT(''), _geoDiagFmtT(null), _geoDiagFmtT('not-a-date')] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v[0]).toBe('');
      expect(r.v[1]).toBe('');
    });

    test('the diagnostics panel renders park-log timestamps in Central time, not raw UTC', async () => {
      const r = await page.evaluate(() => {
        const realCap = window.Capacitor;
        const realLog = _geoParkLog.slice();
        try {
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
          _geoParkLog.length = 0;
          _geoParkLog.push({ t: '2026-08-23T20:58:31.000Z', ev: 'park-exit', x: '' });
          _geoDiagPanel();
          const ov = document.getElementById('_geo-diag-ov');
          const text = ov ? ov.textContent : '';
          ov && ov.remove();
          return { text, copyText: window.__geoDiagText || '' };
        } finally {
          window.Capacitor = realCap;
          _geoParkLog.length = 0; realLog.forEach(x => _geoParkLog.push(x));
        }
      });
      expect(r.text).toContain('08-23T15:58:31');
      expect(r.text, 'never the raw UTC hour').not.toContain('08-23T20:58:31');
      expect(r.copyText, '"Copy everything" must carry the same converted time').toContain('08-23T15:58:31');
    });

    // HISTORY, kept deliberately (§10.4), because this test's assertions were
    // inverted by an owner decision and the reasoning on BOTH sides matters.
    //
    // 2026-08-21, why the Cloud sync copy existed: the Developer copy needs
    // is_dev in the database (the owner's real account never had it) AND the
    // native shell (they were testing the plain UAT web link), so the panel
    // they needed to unblock a live reconciliation bug was invisible on both
    // counts. A second copy under Cloud sync (set-geo-diag-btn2) needed
    // neither, so this test asserted it existed and was ungated. Correct then.
    //
    // 2026-08-25, why it no longer does: the owner asked for diagnostics to
    // live under the developer tools only. The downside was put to him first,
    // in these terms: deleting the Cloud sync copy makes the panel unreachable
    // on the plain UAT web link and on any non-dev account. His answer: "No,
    // put it under the advanced developer tools section, it needs to be there."
    // So Developer-only is the INTENDED state now, and this test flips to
    // proving the deletion (§7.1): the old entry point is gone, not hidden.
    test('the ungated Cloud sync diagnostics button is gone, diagnostics is Developer-only now', async () => {
      const r = await page.evaluate(() => {
        const btn = document.getElementById('set-geo-diag-btn2');
        const cloud = document.getElementById('setd-cloud');
        const devBtn = document.getElementById('set-geo-diag-btn');
        // The Cloud sync section must still render its other controls, this
        // was a surgical button removal, not a section that lost its contents.
        const survivors = cloud ? cloud.querySelectorAll('button').length : 0;
        return {
          gone: !btn,
          cloudStillThere: !!cloud,
          survivors,
          stillReachableUnderDev: !!(devBtn && devBtn.closest('#setd-dev')),
        };
      });
      expect(r.gone, 'set-geo-diag-btn2 is deleted from the DOM, not display:none (§7)').toBe(true);
      expect(r.cloudStillThere, 'the Cloud sync section survived the removal').toBe(true);
      expect(r.survivors, 'its other buttons are untouched').toBeGreaterThanOrEqual(3);
      expect(r.stillReachableUnderDev, 'the Developer copy is the one remaining route').toBe(true);
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

  // ── Exit confirmation, gap or not (owner mandate 2026-08-20) ────────────────
  // "when I enter a fence I am there... this should persist until iOS says hey
  // big fella you're driving." Before this, the two-ping confirm-before-exit
  // protection only applied to a departure discovered while resolving a
  // BACKGROUND gap (_geoGapHiddenAt set). Live, screen-on, continuously
  // tracking the whole time, a single noisy ping reading outside the fence
  // closed the visit immediately — ordinary GPS wander while standing still at
  // a job site (owner report the same day: lost the on-site card mid-shift,
  // no gap involved at all). This generalizes the same confirmation bar to
  // every live departure from a job/place/client fence, with a driving-speed
  // reading trusted as immediate confirmation (real evidence of motion) and a
  // second agreeing position otherwise required.
  test.describe('exit confirmation: a lone noisy ping never closes an on-site visit', () => {
    test('a single out-of-fence ping with no speed signal does not close the job; a confirming return leaves it untouched', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-wander' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(a.job);                                // arrive, immediate
          const job1 = _geoCurrentJob;
          _geoArrivedAt = new Date(Date.now() - 10 * 60000).toISOString(); // backdate: real visit, not a pass-through
          const arrivedAt1 = _geoArrivedAt;
          // Ordinary GPS wander: one good-accuracy ping ~1000ft away, no speed.
          await ping({ lat: a.job.lat + 0.003, lon: a.job.lon });
          const afterWander = { job: _geoCurrentJob, arrivedAt: _geoArrivedAt, closed: entries.length };
          // Position confirms them back on site: the wander was noise, not a trip.
          await ping(a.job);
          return {
            job1, arrivedAt1, afterWander,
            job2: _geoCurrentJob, arrivedAt2: _geoArrivedAt, closedTotal: entries.length,
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoExitPending = null;
        }
      }, { job: JOB });
      expect(r.job1, 'arrival is immediate, no confirmation needed to enter').toBe(9901);
      expect(r.afterWander.job, 'one noisy out-of-fence ping must not close the visit').toBe(9901);
      expect(r.afterWander.arrivedAt, 'the original arrival time must survive the wander').toBe(r.arrivedAt1);
      expect(r.afterWander.closed, 'nothing gets written on an unconfirmed reading').toBe(0);
      expect(r.job2, 'confirmed back on site: still the same open visit').toBe(9901);
      expect(r.arrivedAt2, 'the visit never actually closed, so arrival time is unchanged').toBe(r.arrivedAt1);
      expect(r.closedTotal, 'the whole wander-and-return produced zero closes').toBe(0);
    });

    test('two agreeing out-of-fence pings DO close the visit when no speed signal is available', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-confirm' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
          await ping(a.job);
          _geoArrivedAt = new Date(Date.now() - 10 * 60000).toISOString();
          await ping(a.road);                               // first out-of-fence ping: pending
          const afterFirst = { job: _geoCurrentJob, closed: entries.length };
          await ping(a.road);                               // second agreeing ping: confirmed
          return {
            afterFirst, jobAfter: _geoCurrentJob, closedAfter: entries.length,
            closedTbl: entries[0] && entries[0].tbl,
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoExitPending = null;
        }
      }, { job: JOB, road: ROAD });
      expect(r.afterFirst.job, 'the first out-of-fence ping must not close it yet').toBe(9901);
      expect(r.afterFirst.closed).toBe(0);
      expect(r.jobAfter, 'the SECOND agreeing ping confirms the departure').toBe(null);
      expect(r.closedAfter, 'exactly one close, on the confirming ping').toBe(1);
      expect(r.closedTbl).toBe('job_time_entries');
    });

    test('a driving-speed reading confirms departure immediately, no second ping needed', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-speed' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          await _geoOnPing({ coords: { latitude: a.job.lat, longitude: a.job.lon, accuracy: 8 } });
          _geoArrivedAt = new Date(Date.now() - 10 * 60000).toISOString();
          // One ping, outside the fence, reporting real driving speed (~13mph).
          await _geoOnPing({ coords: { latitude: a.road.lat, longitude: a.road.lon, accuracy: 8, speed: 6 } });
          return { job: _geoCurrentJob, closed: entries.length, closedTbl: entries[0] && entries[0].tbl };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoExitPending = null;
        }
      }, { job: JOB, road: ROAD });
      expect(r.job, 'a confirmed driving-speed ping closes the visit on the FIRST out-of-fence reading').toBe(null);
      expect(r.closed).toBe(1);
      expect(r.closedTbl).toBe('job_time_entries');
    });

    test('bad-accuracy pings never confirm a departure, no matter how many arrive', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-bad-acc' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          const ping = (c, acc) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: acc } });
          await ping(a.job, 8);
          _geoArrivedAt = new Date(Date.now() - 10 * 60000).toISOString();
          for (let i = 0; i < 5; i++) await ping(a.road, 250); // well past the 100m trust floor
          return { job: _geoCurrentJob, closed: entries.length };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoExitPending = null;
        }
      }, { job: JOB, road: ROAD });
      expect(r.job, 'no fix bad enough to trust can ever confirm a departure').toBe(9901);
      expect(r.closed).toBe(0);
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
          window._geoOpenRestored = false;   // fresh restore per test, one-shot guard added in js/geo-track.js
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

    // ── STANDING AT A CUSTOMER IS OPEN STATE ──────────────────────────────
    // _geoPersistOpen covered job, shop and drive. A client or place visit was
    // in neither the guard nor the payload, so a session whose ONLY open state
    // was a customer's address did not merely fail to save: it took the else
    // branch and deleted the snapshot. After any relaunch the visit was gone
    // from memory with no row ever written, so the on-site hours were not
    // late, they were lost.
    //
    // Owner, 2026-08-31: arrived at John Doe 07:58, force-quit and reopened at
    // 11:43, and the app no longer knew he was standing on a job.
    const roundTrip = (page, state) => page.evaluate((st) => {
      const realUser = _supaUser, realEnq = window._geoEnqueue;
      const wrote = [];
      try {
        _supaUser = { id: 'u-open' };
        window._geoEnqueue = (tbl, row) => wrote.push({ tbl, ...row });
        _geoCurrentJob = null; _geoArrivedAt = null;
        _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentClient = st.client || null; _geoClientArrivedAt = st.clientAt || null;
        _geoCurrentPlace = st.place || null; _geoPlaceArrivedAt = st.placeAt || null;
        _geoPersistOpen(st.hiddenAt || new Date().toISOString());
        const saved = localStorage.getItem('zp3_geo_open');
        // ── app dies here ──
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        window._geoOpenRestored = false;
        _geoRestoreOpen();
        return { saved: !!saved,
                 client: _geoCurrentClient, clientAt: _geoClientArrivedAt,
                 place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, wrote };
      } finally {
        _supaUser = realUser; window._geoEnqueue = realEnq;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        _geoClearOpen();
      }
    }, state);

    test('an open client visit survives the app dying', async () => {
      const r = await roundTrip(page, { client: '1787003875684',
        clientAt: new Date(Date.now() - 40 * 60000).toISOString() });
      expect(r.saved, 'standing at a customer is open state worth saving').toBe(true);
      expect(r.client, 'and it is still known after the relaunch').toBe('1787003875684');
      expect(r.clientAt).not.toBeNull();
    });

    test('an open place visit survives it too', async () => {
      const r = await roundTrip(page, { place: 'p-99',
        placeAt: new Date(Date.now() - 25 * 60000).toISOString() });
      expect(r.saved).toBe(true);
      expect(r.place).toBe('p-99');
      expect(r.placeAt).not.toBeNull();
    });

    test('a client visit alone no longer DELETES the snapshot', async () => {
      // The precise old failure. The guard did not name client or place, so
      // this state fell through to localStorage.removeItem and took any other
      // open state with it.
      const r = await page.evaluate(() => {
        const realUser = _supaUser;
        try {
          _supaUser = { id: 'u-open' };
          localStorage.setItem('zp3_geo_open', JSON.stringify({ marker: 'previous' }));
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = 'c-1'; _geoClientArrivedAt = new Date().toISOString();
          _geoPersistOpen(new Date().toISOString());
          const raw = localStorage.getItem('zp3_geo_open') || '';
          return { kept: raw.indexOf('c-1') >= 0, wiped: raw === '' || raw === 'null' };
        } finally {
          _supaUser = realUser; _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoClearOpen();
        }
      });
      expect(r.wiped).toBe(false);
      expect(r.kept, 'the visit is written into the snapshot, not erased by it').toBe(true);
    });

    test('live state wins: a restored visit never overwrites one already resolved', async () => {
      // Same rule the job branch already holds. A session that has worked out
      // where it is must not have a stale answer written over it.
      const live = new Date(Date.now() - 5 * 60000).toISOString();
      const r = await page.evaluate((liveAt) => {
        const realUser = _supaUser;
        try {
          _supaUser = { id: 'u-open' };
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = 'stale'; _geoClientArrivedAt = new Date(Date.now() - 60 * 60000).toISOString();
          _geoPersistOpen(new Date().toISOString());
          _geoCurrentClient = 'live'; _geoClientArrivedAt = liveAt;
          window._geoOpenRestored = false;
          _geoRestoreOpen();
          return { client: _geoCurrentClient, at: _geoClientArrivedAt };
        } finally {
          _supaUser = realUser; _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoClearOpen();
        }
      }, live);
      expect(r.client).toBe('live');
      expect(r.at).toBe(live);
    });

    test('nothing open at all still clears the snapshot', async () => {
      // The else branch has to keep working: an empty state must not leave a
      // stale visit on disk to be restored tomorrow.
      const r = await page.evaluate(() => {
        const realUser = _supaUser;
        try {
          _supaUser = { id: 'u-open' };
          localStorage.setItem('zp3_geo_open', JSON.stringify({ marker: 'stale' }));
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoPersistOpen(new Date().toISOString());
          return { raw: localStorage.getItem('zp3_geo_open') };
        } finally { _supaUser = realUser; _geoClearOpen(); }
      });
      expect(r.raw).toBeNull();
    });

    test('an id with no arrival, or an arrival with no id, is not open state', async () => {
      const half = await page.evaluate(() => {
        const realUser = _supaUser;
        try {
          _supaUser = { id: 'u-open' };
          localStorage.removeItem('zp3_geo_open');
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = 'c-2'; _geoClientArrivedAt = null;      // id, no clock
          _geoPersistOpen(new Date().toISOString());
          const a = localStorage.getItem('zp3_geo_open');
          _geoCurrentClient = null; _geoClientArrivedAt = new Date().toISOString();  // clock, no id
          _geoPersistOpen(new Date().toISOString());
          const b = localStorage.getItem('zp3_geo_open');
          return { a, b };
        } finally {
          _supaUser = realUser; _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoClearOpen();
        }
      });
      expect(half.a, 'an id with nothing to measure from is not a visit').toBeNull();
      expect(half.b, 'and a clock with nothing to attribute it to is not either').toBeNull();
    });

    // A drive still in progress (not at a job, not at the shop) when the app died
    // AND the calendar rolled to a new day before it ever restarted: previously
    // _geoRestoreOpen's day-mismatch branch salvaged an open job/shop dwell but
    // just discarded an open DRIVE outright, silently losing the hours. The
    // destination is genuinely unknown (they never arrived), so this claims no
    // mileage, only the payroll-relevant time entry.
    test('a drive still open across a day rollover is salvaged as time, not silently dropped', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        _supaUser = { id: 'u-rollover' };
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        try {
          __seedGeo();
          const t0 = Date.now();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoLegAtShop = false;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoStopAnchor = null;
          const driveStart = new Date(t0 - 40 * 60000).toISOString();
          const hiddenAt = new Date(t0 - 5 * 60000).toISOString();
          _geoDriveStartedAt = driveStart;
          _geoLegOrigin = { lat: a.job.lat, lng: a.job.lon, name: 'Miller Residence', kind: 'job' };
          _geoLastFenceLoc = _geoLegOrigin;
          _geoLastFenceAt = driveStart;
          _geoPersistOpen(hiddenAt);
          // Back-date the persisted blob's day so restore sees yesterday, the
          // same shape a real overnight app-kill produces.
          const raw = JSON.parse(localStorage.getItem('zp3_geo_open'));
          raw.day = 'not-today';
          localStorage.setItem('zp3_geo_open', JSON.stringify(raw));
          // ── app dies here, relaunches tomorrow ──
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
          _geoLastFenceAt = null; _geoGapHiddenAt = null; _geoStopAnchor = null;
          window._geoOpenRestored = false;   // fresh restore per test, one-shot guard added in js/geo-track.js
          _geoRestoreOpen();
          const salvaged = entries.filter(e => e.tbl === 'job_time_entries' && e.row.source === 'drive-unassigned-salvaged');
          return {
            restoredDrive: !!_geoDriveStartedAt, // must NOT come back live, the day already rolled
            salvagedCount: salvaged.length,
            salvaged: salvaged[0] && salvaged[0].row,
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoLegOrigin = null;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoGapHiddenAt = null;
          _geoClearOpen();
        }
      }, { job: JOB });
      expect(r.restoredDrive, 'a rolled-over day never resumes as a live drive').toBe(false);
      expect(r.salvagedCount, 'the in-progress drive logs its time instead of vanishing').toBe(1);
      expect(r.salvaged.job_id, 'destination was never known, so no job is claimed').toBe(null);
      expect(r.salvaged.dest_place, 'and no place is claimed either').toBe(null);
      expect(r.salvaged.minutes).toBe(35);
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
          window._geoOpenRestored = false;   // fresh restore per test, one-shot guard added in js/geo-track.js
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

  // ── Same-fence flicker (owner video 2026-08-20) ─────────────────────────────
  // Real device: two near-duplicate "Driving" legs both to job "John Doe",
  // same start, end times two minutes apart, then several more 2-6 minute
  // job<->shop blips through midday, all while genuinely parked. Root cause:
  // once _geoExitPending confirms a departure (a lone driving-speed blip, or
  // two borderline-accuracy pings agreeing) and the drive clock opens, the
  // VERY NEXT ping landing back inside that SAME fence had no guard at all,
  // it went through the unconditional "single clean ping into a well-defined
  // fence" trust path (protected further below), because by then `prev` reads
  // null, so the settle-back looks identical to a brand-new arrival. See
  // _geoFlickerCandidate in js/geo-track.js for the full mechanism.
  test.describe('same-fence flicker (owner video 2026-08-20)', () => {
    test('a confirmed exit that settles back into the SAME job within the grace window logs no drive leg and never splits the visit', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-flicker' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          _geoFlickerCandidate = null;
          const ping = (c, extra) => _geoOnPing({
            coords: Object.assign({ latitude: c.lat, longitude: c.lon, accuracy: 8 }, extra || {}),
          });
          // Arrive at the job: single ping, trusted immediately.
          await ping(a.job);
          const arrivedAt = _geoArrivedAt;
          // A spurious driving-speed blip reads them outside every fence: the
          // exit is confirmed on the FIRST ping (real evidence of motion, by
          // design, see _GEO_DRIVEBY_SPEED_MPS).
          await ping(a.road, { speed: 5 });
          const afterExit = { job: _geoCurrentJob, driveOpen: !!_geoDriveStartedAt, closed: entries.length };
          // GPS settles right back inside the SAME job fence, moments later.
          await ping(a.job);
          const afterFlicker = {
            job: _geoCurrentJob, arrivedAt: _geoArrivedAt,
            driveOpen: !!_geoDriveStartedAt, closed: entries.length,
          };
          // Backdate the (restored) arrival to simulate a real, longer dwell
          // already in progress, then leave for real: proves the flicker never
          // split the visit, the eventual close spans the WHOLE time, the
          // original arrival included.
          _geoArrivedAt = new Date(Date.parse(_geoArrivedAt) - 12 * 60000).toISOString();
          const trueArrivedAt = _geoArrivedAt;
          await ping(a.road, { speed: 5 });   // the real departure, confirmed immediately
          await new Promise(r2 => setTimeout(r2, 30));
          return {
            arrivedAt, afterExit, afterFlicker, trueArrivedAt,
            driveRows: entries.filter(e => e.tbl === 'job_time_entries' && /^drive/.test(e.row.source)),
            allRows: entries.filter(e => e.tbl === 'job_time_entries')
              .map(e => ({ source: e.row.source, arrived_at: e.row.arrived_at, departed_at: e.row.departed_at, minutes: e.row.minutes, job_id: e.row.job_id })),
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
          _geoExitPending = null; _geoFlickerCandidate = null; _geoStopAnchor = null; _geoLegOrigin = null;
        }
      }, { job: JOB, road: ROAD });

      expect(r.afterExit.job, 'the spurious exit is confirmed immediately (real evidence of motion)').toBe(null);
      expect(r.afterExit.driveOpen, 'a drive clock opens for the (phantom) exit').toBe(true);
      expect(r.afterExit.closed, 'arriving seconds ago: the close floor (mins<2) refuses to write anything yet').toBe(0);
      expect(r.afterFlicker.job, 'settling back into the SAME job undoes the exit').toBe(9901);
      expect(r.afterFlicker.arrivedAt, 'the ORIGINAL arrival time survives, not a fresh one').toBe(r.arrivedAt);
      expect(r.afterFlicker.driveOpen, 'the phantom drive clock is discarded').toBe(false);
      expect(r.afterFlicker.closed, 'still nothing written after the undo').toBe(0);
      expect(r.driveRows.length, 'no drive leg was ever logged for the flicker').toBe(0);
      expect(r.allRows.length, 'exactly one row for the whole visit, never split in two').toBe(1);
      expect(r.allRows[0].job_id).toBe('9901');
      expect(r.allRows[0].arrived_at, 'the row spans the ORIGINAL arrival, flicker gap included').toBe(r.trueArrivedAt);
      expect(r.allRows[0].minutes).toBeGreaterThanOrEqual(12);
    });

    // The mirror case: a same-fence flicker must never suppress a REAL exit to
    // somewhere else. This is the "single clean ping into a well-defined
    // fence" trust path the flicker guard must leave untouched (js/geo-track.js
    // comment above _geoExitPending): a job/shop/place/client entry is
    // trusted on ONE ping whether or not a drive clock happens to be open,
    // because the flicker candidate only ever matches its OWN exact fence.
    test('settling into a DIFFERENT fence right after an exit is a real trip, not a flicker', async () => {
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realEnq = window._geoEnqueue;
        const entries = [];
        window._geoEnqueue = (tbl, row) => { entries.push({ tbl, row }); };
        _supaUser = { id: 'u-real-trip' };
        try {
          __seedGeo();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false; _geoLegOrigin = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null; _geoExitPending = null;
          _geoFlickerCandidate = null;
          const ping = (c, extra) => _geoOnPing({
            coords: Object.assign({ latitude: c.lat, longitude: c.lon, accuracy: 8 }, extra || {}),
          });
          await ping(a.job);                       // arrive at the job
          await ping(a.road, { speed: 5 });         // confirmed exit, drive opens
          // Backdate the drive clock so this reads as a real 20-minute drive,
          // same as every other real-trip test in this file (drive()'s own
          // rewind helper): a sub-second synthetic gap between pings would
          // otherwise trip the existing mins<2 pass-through floor in
          // _geoDriveEntry, unrelated to the thing under test here.
          if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 20 * 60000).toISOString();
          await ping(a.shop);                       // lands at a DIFFERENT, real fence
          await new Promise(r2 => setTimeout(r2, 30));
          return {
            job: _geoCurrentJob, atShop: _geoWasInShop, legAtShop: _geoLegAtShop,
            driveRows: entries.filter(e => e.tbl === 'job_time_entries' && /^drive/.test(e.row.source)).length,
          };
        } finally {
          _supaUser = realUser; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
          _geoDriveStartedAt = null; _geoDriveReset();
          _geoExitPending = null; _geoFlickerCandidate = null; _geoStopAnchor = null; _geoLegOrigin = null;
        }
      }, { job: JOB, road: ROAD, shop: SHOP });

      expect(r.job, 'no longer at the job').toBe(null);
      expect(r.atShop, 'a single clean ping into a DIFFERENT fence is still trusted immediately').toBe(true);
      expect(r.legAtShop).toBe(true);
      expect(r.driveRows, 'a real trip to a different destination still logs its drive leg').toBe(1);
    });
  });

  // ── TdGeo live delivery vs buffer replay (owner video 2026-08-21) ───────────
  // The owner's phone showed two "Driving" legs to the same job, both display
  // 7:52a, ending 8:00a and 8:02a. Root cause: TdGeoPlugin.swift's record()
  // buffers every native event UNCONDITIONALLY (live or not), and the buffer
  // is only cleared by an explicit drainBuffer() call, which only ever runs
  // once per JS boot. So a live-delivered event still sitting in that buffer
  // at the next reload (version watchdog, a WKWebView kill, a park-mode wake)
  // gets replayed a second time with its ORIGINAL native timestamp. That alone
  // is harmless if live and replay agree on the leg's clock (same legStart =
  // same deterministic legKey = the existing exact-match idempotency guard in
  // autoLogDriveTrip blocks the second write for free). The bug: _geoTdEvent
  // used to stamp __tdTs only on replay, so a LIVE event clocked itself off
  // Date.now() at whatever moment the JS handler actually ran (which lags the
  // true GPS fix by however long the main thread was busy), while its
  // buffered twin, replayed later, clocked off the true capture time. Two
  // derivations of ONE physical exit/arrival, seconds apart, mint two
  // different legKeys.
  // Owner report 2026-08-25, off two weeks of his own engine journal: a stop
  // the app has a FENCE for is stamped within a minute; a stop with no fence
  // waits on iOS to volunteer a visit report, and iOS sits on those (measured
  // across 27 of his unfenced stops: median 4 minutes late, worst 45). The
  // late report is not vague about WHEN though: it carries iOS's own
  // arrivalDate. "visit · Stop · in 10:28" delivered at 11:13 knew, in the
  // same message, that he arrived at 10:28. The engine was reading the
  // postmark and throwing away the letter.
  test.describe('an iOS visit report stamps the arrival it actually reports', () => {
    // Park the machine outside everything, then hand it ONE event.
    const deliver = (ev, pre) => page.evaluate(async ([d, ev, pre]) => {
      const realUser = _supaUser, realEnq = window._geoEnqueue, realNow = Date.now;
      const notesBefore = _geoParkLog.slice();
      _supaUser = { id: 'u-visit-clock' };
      window._geoEnqueue = () => {};
      try {
        __seedGeo();
        _geoPingBusy = false;
        _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoCurrentClient = null; _geoClientArrivedAt = null; _geoLegOrigin = null;
        _geoExitPending = null; _geoFlickerCandidate = null; _geoParkModeOn = false;
        _geoParkCluster = null; _geoSoftJob = null; _geoSoftShop = null;
        _geoWasInShop = false; _geoLegAtShop = false; _geoShopArrivedAt = null;
        _geoLastFenceAt = null; _geoLastFenceLoc = null;
        _geoParkBackdate = pre && pre.backdate ? pre.backdate : null;
        Date.now = () => d.now;
        await _geoTdEvent(ev, false);
        Date.now = realNow;
        const fresh = _geoParkLog.slice(notesBefore.length >= 30 ? 0 : notesBefore.length)
          .filter(n => !notesBefore.some(o => o.t === n.t && o.ev === n.ev && o.x === n.x));
        return {
          jobArrived: _geoArrivedAt, shopArrived: _geoShopArrivedAt,
          leftover: _geoParkBackdate,
          noted: fresh.filter(n => n.ev === 'visit-backdate').map(n => n.x),
        };
      } finally { _supaUser = realUser; window._geoEnqueue = realEnq; Date.now = realNow; }
    }, [{ now: NOW, job: JOB, shop: SHOP }, ev, pre || null]);

    // Fixed clock so "same Central day" is never a race against real midnight.
    const NOW = Date.parse('2026-08-25T18:13:00.000Z');   // 13:13 Central
    const AGO = (min) => NOW - min * 60000;
    const visitAt = (lat, lon, arrivalTs) => ({ type: 'visit', lat, lng: lon, acc: 30, ts: NOW,
      ...(arrivalTs == null ? {} : { arrivalTs }) });

    test('a job arrival is stamped when he got there, not when the report landed', async () => {
      const r = await deliver(visitAt(JOB.lat, JOB.lon, AGO(45)));
      expect(r.jobArrived, 'the 45-minute-late report still knows the real arrival')
        .toBe(new Date(AGO(45)).toISOString());
      expect(r.noted[0]).toContain('45m late');
    });

    test('a shop arrival gets the same treatment', async () => {
      const r = await deliver(visitAt(SHOP.lat, SHOP.lon, AGO(18)));
      expect(r.shopArrived).toBe(new Date(AGO(18)).toISOString());
    });

    test('with no arrival time in the report, nothing is backdated', async () => {
      const r = await deliver(visitAt(JOB.lat, JOB.lon, null));
      expect(r.jobArrived, 'it stamps the delivery moment, exactly as before')
        .toBe(new Date(NOW).toISOString());
      expect(r.noted.length).toBe(0);
    });

    test('a plain fix carrying an arrival time is never backdated: visits only', async () => {
      const r = await deliver({ type: 'fix', lat: JOB.lat, lng: JOB.lon, acc: 8, ts: NOW, arrivalTs: AGO(20) });
      expect(r.jobArrived).toBe(new Date(NOW).toISOString());
      expect(r.noted.length).toBe(0);
    });

    test('time is never invented: future, ancient, and yesterday are all refused', async () => {
      const future = await deliver(visitAt(JOB.lat, JOB.lon, NOW + 5 * 60000));
      expect(future.jobArrived, 'an arrival that has not happened yet').toBe(new Date(NOW).toISOString());

      const ancient = await deliver(visitAt(JOB.lat, JOB.lon, AGO(3 * 60)));
      expect(ancient.jobArrived, 'past the two-hour ceiling it is history, not a late stamp')
        .toBe(new Date(NOW).toISOString());

      const yesterday = await deliver(visitAt(JOB.lat, JOB.lon, Date.parse('2026-08-24T23:00:00.000Z')));
      expect(yesterday.jobArrived, 'a report delivered after midnight never reaches back a day')
        .toBe(new Date(NOW).toISOString());
    });

    test('junk arrival times never throw and never stamp', async () => {
      for (const bad of [0, -1, NaN, 'noon', null, undefined, {}]) {
        const r = await deliver(visitAt(JOB.lat, JOB.lon, bad));
        expect(r.jobArrived, String(bad) + ' is not a timestamp').toBe(new Date(NOW).toISOString());
      }
    });

    test('a backdate the park resolver already set is never stomped', async () => {
      const parked = new Date(AGO(6)).toISOString();
      const r = await deliver(visitAt(JOB.lat, JOB.lon, AGO(40)), { backdate: parked });
      expect(r.jobArrived, "the resolver's own stop moment wins, it observed the truck stop")
        .toBe(parked);
    });

    // The leak this guard exists for: set a backdate, produce no transition,
    // and it would sit there waiting to stamp an unrelated arrival minutes
    // later with a time that had nothing to do with it.
    test('a visit that lands nowhere leaves no backdate behind', async () => {
      const r = await deliver(visitAt(41.9, -80.4, AGO(30)));   // open country, no fence
      expect(r.leftover, 'one-shot means one-shot').toBe(null);
    });

    test('the backdate never survives the ping that carried it', async () => {
      const r = await deliver(visitAt(JOB.lat, JOB.lon, AGO(30)));
      expect(r.leftover).toBe(null);
    });
  });

  test.describe('TdGeo live delivery vs buffer replay (owner video 2026-08-21)', () => {
    // One physical drive, told to _geoTdEvent twice: once "live" (a JS-side
    // processing lag simulated via a stubbed Date.now, standing in for the
    // main-thread contention the code's own comments already document as
    // real) and once "replayed" the way a reload's drainBuffer would, with
    // the SAME two native events and their true, unstubbed ts fields.
    async function driveTwice(a) {
      return page.evaluate(async (d) => {
        const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue, realNow = Date.now;
        _supaUser = { id: 'u-replay-clock' };
        window._routeDistance = _routeDistance = async () => ({ miles: 8.1, mins: 9 });
        window._geoEnqueue = () => {};
        const before = mileage.length;
        const reset = (trueExitTs) => {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoDriveReset();
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLegOrigin = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoExitPending = null; _geoFlickerCandidate = null; _geoParkModeOn = false;
          _geoParkCluster = null; _geoSoftJob = null;
          // Parked at the shop before the drive, as if freshly booted (a
          // reload wipes every one of these `let` module variables).
          _geoWasInShop = true; _geoLegAtShop = true;
          _geoShopArrivedAt = new Date(trueExitTs - 30 * 60000).toISOString();
          _geoLastFenceAt = new Date(trueExitTs - 60000).toISOString();
          _geoLastFenceLoc = { lat: d.shop.lat, lng: d.shop.lon, name: 'Shop', kind: 'shop' };
        };
        try {
          __seedGeo();
          // The TRUE native capture instants (what TdGeoPlugin.swift actually
          // stamped and buffered, byte-identical on both passes below).
          const trueExitTs = Date.parse('2026-08-21T07:52:03.000Z');
          const trueArriveTs = Date.parse('2026-08-21T08:00:10.000Z');
          const exitEvent = { type: 'regionExit', lat: d.road.lat, lng: d.road.lon, acc: 20, speed: 12, ts: trueExitTs };
          const arriveEvent = { type: 'fix', lat: d.job.lat, lng: d.job.lon, acc: 8, speed: 0, ts: trueArriveTs };

          // ── PASS 1: "live" delivery, lagging the true capture moment ──────
          reset(trueExitTs);
          Date.now = () => trueExitTs + 5000;      // 5s of live-processing lag
          await _geoTdEvent(exitEvent, false);
          Date.now = () => trueArriveTs + 118000;  // ~2min of lag (a busy main
          await _geoTdEvent(arriveEvent, false);   // thread, a slow geocode)
          Date.now = realNow;

          // ── PASS 2: buffer replay after a "reload", true ts honored ───────
          reset(trueExitTs);
          await _geoTdEvent(exitEvent, true);
          await _geoTdEvent(arriveEvent, true);

          await new Promise(r => setTimeout(r, 30));
          const rows = mileage.slice(0, Math.max(0, mileage.length - before));
          return {
            count: rows.length,
            legKeys: [...new Set(rows.map(m => m.legKey))],
            rows: rows.map(m => ({ from: m.from_name, to: m.to_name, startedIso: m.startedIso, endedIso: m.endedIso, mins: m.mins })),
          };
        } finally {
          Date.now = realNow;
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; window._geoEnqueue = realEnq;
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
          _geoDriveStartedAt = null; _geoDriveReset(); _geoLegAtShop = false;
          _geoLastFenceAt = null; _geoLastFenceLoc = null; _geoStopAnchor = null; _geoLegOrigin = null;
          _geoExitPending = null; _geoFlickerCandidate = null; _geoParkCluster = null; _geoSoftJob = null;
        }
      }, a);
    }

    test('the same drive, live then replayed, collapses to ONE row', async () => {
      const out = await driveTwice({ shop: SHOP, road: ROAD, job: JOB });
      // Both passes display the same "7:52a" start (5s apart, same minute),
      // and both are real ~8-10 minute drives, well clear of the 2-min floor.
      // Before the fix this produced 2 rows with 2 different legKeys, exactly
      // the owner's screenshot. The deterministic legKey now agrees on both
      // passes (both clock off the true ev.ts), so the second close is
      // recognised as the first one again and never writes a second row.
      expect(out.count, 'one physical drive must never produce two rows').toBe(1);
      expect(out.legKeys.length).toBe(1);
      expect(out.rows[0].startedIso).toBe('2026-08-21T07:52:03.000Z');
      expect(out.rows[0].endedIso).toBe('2026-08-21T08:00:10.000Z');
      expect(out.rows[0].to).toBe('Miller Residence');
    });
  });

  // ── Mileage-side cleanup: the owner's real duplicate pair (2026-08-21) ─────
  // Proves the ALREADY-SHIPPED boot heal (efa418d, 2026-08-11) still collapses
  // this exact shape once it runs: same person, same near-identical shop/job
  // endpoints, starts a few seconds apart, overlapping windows. This is the
  // cleanup half of the fix, independent of the prevention fix above: it is
  // what actually clears rows a phone already wrote before this deploy landed
  // (existing duplicate rows the owner already has need this heal to run on
  // their next boot/reconnect; the prevention fix above only stops NEW ones).
  test.describe('the owner\'s real duplicate pair heals (owner video 2026-08-21)', () => {
    test('same job, starts seconds apart, ends 2 minutes apart: heal keeps one', async () => {
      const out = await page.evaluate(() => {
        const JOHN = { lat: 39.0208, lng: -95.7351 }, SHOP2 = { lat: 39.0325, lng: -95.69 };
        // Same measured route both times (same two geocoded endpoints), so
        // _mileTripWinner's mileage comparison ties and falls to earliest
        // loggedAt, "the contemporaneous one" (its own documented rule).
        // Row 501 is the LIVE row: written for real, in real time, during
        // the drive. Row 502 is its buffer-replayed twin: it only exists
        // once a LATER reload runs drainBuffer, so its loggedAt is later in
        // wall-clock terms even though the trip IT describes started first.
        const rows = [
          { id: 501, gps: true, legKey: 'live-8f2a', calc_method: 'auto_route', miles: 3.1, client_id: 77,
            to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
            startedIso: '2026-08-21T07:52:08.000Z', endedIso: '2026-08-21T08:02:08.000Z',
            mins: 10, loggedAt: '2026-08-21T08:02:10.000Z', date: '2026-08-21' },
          { id: 502, gps: true, legKey: 'replay-3c91', calc_method: 'auto_route', miles: 3.1, client_id: 77,
            to_name: 'John Doe', client_name: 'John Doe', fromCoord: SHOP2, toCoord: JOHN,
            startedIso: '2026-08-21T07:52:03.000Z', endedIso: '2026-08-21T08:00:10.000Z',
            mins: 8, loggedAt: '2026-08-21T09:15:00.000Z', date: '2026-08-21' },
        ];
        const keep = mileage.splice(0);
        try {
          rows.forEach(m => mileage.push(m));
          const healed = _mileDedupTrips(true);
          const left = mileage.map(m => m.id);
          mileage.length = 0; rows.forEach(m => mileage.push(m));
          const live = _mileDedupTrips();   // the live sweep must defer this to boot
          return { healed, left, live, liveLeft: mileage.length };
        } finally { mileage.length = 0; keep.forEach(m => mileage.push(m)); }
      });
      expect(out.healed, 'exactly one duplicate collapses').toBe(1);
      expect(out.left).toEqual([501]);
      expect(out.live, 'the strict live sweep does not touch this pair').toBe(0);
      expect(out.liveLeft).toBe(2);
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

    // Old contract: nothing detected -> the card faded to display:none. New
    // contract (owner 2026-08-19, "ability for somebody to clock in at all
    // times, nothing dependent on anything"): this card never goes blank
    // anymore, the DRIVING banner clearing reveals the always-there manual
    // clock control instead of hiding the element entirely.
    test('arriving at the job clears the DRIVING banner into the manual clock card, and the LOGGED trip still comes from the geocodes', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB, tick: true, arrive: true });
      expect(r.afterArrive.display).toBe('block');
      expect(r.afterArrive.html).toContain('Not clocked in');
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].miles, 'route measurement rounded to a tenth, never the banner\'s straight-line tally').toBe(12.3);
    });

    test('parked somewhere unknown, the DRIVING banner clears into the manual clock card once driving speed stops', async () => {
      const r = await bannerDrive({ shop: SHOP, road: ROAD, road2: ROAD2, job: JOB, park: true });
      expect(r.onRoad.display).toBe('block');
      expect(r.afterPark.display).toBe('block');
      expect(r.afterPark.html).toContain('Not clocked in');
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
          window._geoOpenRestored = false;   // fresh restore per test, one-shot guard added in js/geo-track.js
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

    test('a mid-session measurement failure is not stuck at 0 miles forever: swept on a live cadence and on foreground return', async () => {
      // Owner report 2026-08-12: the John Doe -> Shop leg (12:04p-12:11p) had
      // no miles at all while the legs before and after it did, same route,
      // same day. _initMapKit calls _retryPendingTrips exactly ONCE at boot;
      // a live measurement that fails mid-session (one bad network moment)
      // had nothing that would ever sweep it again short of a full reload.
      //
      // The real wiring lives inside supaLoadFromCloud's cloud-timers block,
      // gated behind a real sign-in (_cloudTimersStarted). This suite's own
      // beforeAll deliberately stubs supaLoadFromCloud to a no-op to protect
      // its seeded fixture arrays from being overwritten by a real load, so
      // dispatching visibilitychange here would prove nothing: the listener
      // is never attached in this harness. Asserting against the source is
      // the honest check, the same pattern already used above for the heal
      // re-run point.
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
      const timerBlock = src.indexOf('if(!silent&&!_cloudTimersStarted)');
      expect(timerBlock, 'the cloud-timers registration point exists').toBeGreaterThan(0);
      // BOUNDED BY CONTENT, NOT BY A CHARACTER COUNT. This used to slice a
      // magic `timerBlock + 8000`, which meant any code added inside the block
      // silently shrank what the assertion could see. That is exactly what
      // happened on 2026-08-31: the foreground-refresh fix
      // (_refreshOnForeground) landed above these lines and pushed the
      // _retryPendingTrips interval past 8000, and the test reported the
      // sweep as MISSING when it was simply out of frame. A test whose scope
      // moves when unrelated code is added is a test that will lie again.
      //
      // The cross-tab zp3_sig_notify listener is the last thing registered in
      // this guarded block, after both things asserted below. If it ever moves
      // or goes away this fails loudly on the anchor instead of quietly
      // mis-scoping.
      const blockEnd = src.indexOf('zp3_sig_notify', timerBlock);
      expect(blockEnd, 'the end-of-block anchor exists').toBeGreaterThan(timerBlock);
      const region = src.slice(timerBlock, blockEnd);
      expect(region, 'a periodic sweep runs alongside the other live-session timers, same cadence as the inbound poll')
        .toContain("setInterval(()=>{if(typeof _retryPendingTrips==='function')_retryPendingTrips();},30000);");
      const visIdx = region.indexOf("addEventListener('visibilitychange'");
      expect(visIdx, 'the foreground-return listener for this block exists').toBeGreaterThan(0);
      expect(region.slice(visIdx, visIdx + 400), 'foreground return sweeps it too, alongside the other foreground pulls')
        .toContain("if(typeof _retryPendingTrips==='function')_retryPendingTrips();");
    });

    test('a stale re-derivation of an already-logged journey is an echo: no mileage, no time entry', async () => {
      // Owner report 2026-08-12: four real drives, SEVEN rows. Fence state
      // survives boots, so every wake-at-the-destination with a stale
      // pre-drive snapshot re-derived the same journey with a fresh leg key,
      // invisible to the dedup by design. The echo guard: a stale gap leg
      // whose origin -> destination is already covered by an auto row logged
      // SINCE we were last seen at the origin writes nothing at all.
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
        const queued = []; const savedLog = mileage.slice(); mileage.length = 0;
        _supaUser = { id: 'u-echo' };
        window._routeDistance = _routeDistance = async () => ({ miles: 12.3, mins: 14 });
        window._geoEnqueue = (tbl, row) => queued.push({ tbl, row });
        try {
          __seedGeo();
          const nowIso = new Date().toISOString();
          _geoLegOrigin = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceAt = new Date(Date.now() - 14 * 3600000).toISOString();   // state 14h stale
          // The live session already logged this exact journey two hours ago.
          mileage.unshift({ id: 997401, gps: true, legKey: 'cov-1', calc_method: 'auto_route', miles: 12.3,
            date: todayKey(), loggedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
            fromCoord: { lat: a.shop.lat, lng: a.shop.lon }, toCoord: { lat: a.job.lat, lng: a.job.lon } });
          const before = mileage.length;
          _geoDriveEntry(null, nowIso, null, nowIso, true, { lat: a.job.lat, lng: a.job.lon, name: 'Job', kind: 'job' }, true);
          await new Promise(r2 => setTimeout(r2, 30));
          return { added: mileage.length - before, timeEntries: queued.filter(q => q.tbl === 'job_time_entries').length };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; window._geoEnqueue = realEnq;
          mileage.length = 0; savedLog.forEach(m => mileage.push(m));
          _geoLegOrigin = null; _geoLastFenceAt = null;
        }
      }, { shop: SHOP, job: JOB });
      expect(r.added, 'an echo of a logged journey writes no mileage row').toBe(0);
      expect(r.timeEntries, 'and no time entry either').toBe(0);
    });

    test('a genuinely lost drive still recovers: the same route logged BEFORE the origin re-visit is no cover', async () => {
      // The ordering guard is what keeps twice-daily runs safe: yesterday's
      // (or this morning's) run of the same route was logged BEFORE we were
      // last seen at the origin, so it cannot cover THIS leg, and the stale
      // recovery still writes the miles (hours stay unclaimed, per the
      // 2026-08-03 rule).
      const r = await page.evaluate(async (a) => {
        const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
        const queued = []; const savedLog = mileage.slice(); mileage.length = 0;
        _supaUser = { id: 'u-echo2' };
        window._routeDistance = _routeDistance = async () => ({ miles: 12.3, mins: 14 });
        window._geoEnqueue = (tbl, row) => queued.push({ tbl, row });
        try {
          __seedGeo();
          const nowIso = new Date().toISOString();
          _geoLegOrigin = { lat: a.shop.lat, lng: a.shop.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceAt = new Date(Date.now() - 14 * 3600000).toISOString();
          // Same route, logged 15h ago: BEFORE the 14h-old origin visit.
          mileage.unshift({ id: 997402, gps: true, legKey: 'cov-2', calc_method: 'auto_route', miles: 12.3,
            date: todayKey(), loggedAt: new Date(Date.now() - 15 * 3600000).toISOString(),
            fromCoord: { lat: a.shop.lat, lng: a.shop.lon }, toCoord: { lat: a.job.lat, lng: a.job.lon } });
          const before = mileage.length;
          _geoDriveEntry(null, nowIso, null, nowIso, true, { lat: a.job.lat, lng: a.job.lon, name: 'Job', kind: 'job' }, true);
          await new Promise(r2 => setTimeout(r2, 30));
          const added = mileage.length - before;
          const row = added > 0 ? mileage[0] : null;
          return { added, miles: row && row.miles, timeEntries: queued.filter(q => q.tbl === 'job_time_entries').length };
        } finally {
          _supaUser = realUser; window._routeDistance = _routeDistance = realRoute; window._geoEnqueue = realEnq;
          mileage.length = 0; savedLog.forEach(m => mileage.push(m));
          _geoLegOrigin = null; _geoLastFenceAt = null;
        }
      }, { shop: SHOP, job: JOB });
      expect(r.added, 'the lost drive is real and still logs').toBe(1);
      expect(r.miles, 'measured like any recovered stale leg').toBe(12.3);
      expect(r.timeEntries, 'a duration nobody observed is still never claimed').toBe(0);
    });

    test('_mileTapeHadPause: the coprocessor walk check reads windows honestly', async () => {
      // Owner 2026-08-14: "time isn't a good enough factor." The motion
      // coprocessor's answer to "did the human leave the vehicle" comes
      // through TdGeo.motionSince; this proves the JS reading of it: a 40s+
      // on-foot window inside the leg is a walk, driving/still-only is not,
      // walking BEFORE the drive (to the truck) never counts, and no plugin
      // at all answers null (fall back to the time rule), never false.
      const r = await page.evaluate(async () => {
        const realTd = window._geoTdPlugin;
        const s = Date.now() - 20 * 60000, e = Date.now();
        const iso = (ms) => new Date(ms).toISOString();
        const withTd = (transitions) => { window._geoTdPlugin = () => ({ motionSince: async () => ({ available: true, transitions }) }); };
        try {
          withTd([{ kind: 'driving', ts: s }, { kind: 'onFoot', ts: s + 8 * 60000 }, { kind: 'driving', ts: s + 11 * 60000 }]);
          const walked = await _mileTapeHadPause(iso(s), iso(e));
          // THE REAL PICKUP TAPE (owner 2026-08-14 "didn't correct"): walk 30s,
          // STILL at the counter 3 minutes, walk 30s, drive. The out-of-vehicle
          // span runs first-walk to next-DRIVING; measured to the next
          // transition of any kind, both walks were ignorable blips.
          withTd([{ kind: 'driving', ts: s }, { kind: 'onFoot', ts: s + 8 * 60000 }, { kind: 'still', ts: s + 8 * 60000 + 30000 }, { kind: 'onFoot', ts: s + 11 * 60000 }, { kind: 'driving', ts: s + 11 * 60000 + 30000 }]);
          const counterStop = await _mileTapeHadPause(iso(s), iso(e));
          withTd([{ kind: 'driving', ts: s }, { kind: 'still', ts: s + 8 * 60000 }, { kind: 'driving', ts: s + 11 * 60000 }]);
          const drivethru = await _mileTapeHadPause(iso(s), iso(e));
          withTd([{ kind: 'driving', ts: s }, { kind: 'still', ts: s + 8 * 60000 }, { kind: 'driving', ts: s + 8 * 60000 + 90000 }]);
          const shortStill = await _mileTapeHadPause(iso(s), iso(e));
          withTd([{ kind: 'driving', ts: s }]);
          const jam = await _mileTapeHadPause(iso(s), iso(e));
          withTd([{ kind: 'onFoot', ts: s - 5 * 60000 }, { kind: 'driving', ts: s }]);
          const preWalk = await _mileTapeHadPause(iso(s), iso(e));
          withTd([{ kind: 'driving', ts: s }, { kind: 'onFoot', ts: s + 8 * 60000 }, { kind: 'driving', ts: s + 8 * 60000 + 20000 }]);
          const blip = await _mileTapeHadPause(iso(s), iso(e));
          window._geoTdPlugin = () => null;
          const noPlugin = await _mileTapeHadPause(iso(s), iso(e));
          return { walked, counterStop, drivethru, shortStill, jam, preWalk, blip, noPlugin };
        } finally { window._geoTdPlugin = realTd; }
      });
      expect(r.walked, 'a 3-minute walk mid-leg is an errand').toBe(true);
      expect(r.counterStop, 'walk-still-walk, the real pickup tape, is an errand').toBe(true);
      expect(r.drivethru, 'a 3-minute STILL is the drive-thru/curbside tape, same evidence as the live dwell rule').toBe(true);
      expect(r.shortStill, 'a 90-second still is a long light, below the 2.5-minute bar').toBe(false);
      expect(r.jam, 'a rolling jam (driving-only tape) never disqualifies a real detour').toBe(false);
      expect(r.preWalk, 'the walk TO the truck never counts').toBe(false);
      expect(r.blip, 'a 20-second hop straight back to driving is below the 40s bar').toBe(false);
      expect(r.noPlugin, 'no signal answers null, never an answer').toBe(null);
    });

    test('a walk inside the leg disqualifies the detour floor at measurement time', async () => {
      // The fast-pickup hole: an errand quicker than the 2.5-minute time rule
      // still puts extra miles in the observed tally. The measurement now
      // asks the coprocessor before the floor collects: walked = the direct
      // route saves; no walk on record = the floor still collects (the same
      // answer as no motion signal at all, proven by the detour tests above).
      const r = await page.evaluate(async () => {
        const realRoute = _routeDistance, realUser = _supaUser, realTd = window._geoTdPlugin;
        _supaUser = { id: 'u-walk' };
        window.__origMileage = mileage.slice();
        try {
          mileage.length = 0;
          const ended = new Date().toISOString();
          const started = new Date(Date.now() - 14 * 60000).toISOString();
          const mk = (id, legKey) => ({ id, date: todayKey(), gps: true, legKey, calc_method: 'pending_auto',
            fromCoord: { lat: 39.02, lng: -95.73 }, toCoord: { lat: 39.0, lng: -95.7 }, miles: 0, mins: 14,
            gpsMiles: 5.3, startedIso: started, endedIso: ended, loggedAt: ended });
          window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 9 });
          // Walked: the floor stands down.
          mileage.push(mk(997501, 'walk-leg-1'));
          window._geoTdPlugin = () => ({ motionSince: async () => ({ available: true,
            transitions: [{ kind: 'driving', ts: Date.parse(started) }, { kind: 'onFoot', ts: Date.parse(started) + 5 * 60000 }, { kind: 'driving', ts: Date.parse(started) + 9 * 60000 }] }) });
          await _retryPendingTrips();
          const walkedRow = mileage.find(m => m.id === 997501);
          // No walk: the floor collects.
          mileage.length = 0; mileage.push(mk(997502, 'walk-leg-2'));
          window._geoTdPlugin = () => ({ motionSince: async () => ({ available: true,
            transitions: [{ kind: 'driving', ts: Date.parse(started) }] }) });
          await _retryPendingTrips();
          const jamRow = mileage.find(m => m.id === 997502);
          return { walkedMiles: walkedRow.miles, walkedPaused: !!walkedRow.pausedLeg, jamMiles: jamRow.miles };
        } finally {
          window._routeDistance = _routeDistance = realRoute; _supaUser = realUser; window._geoTdPlugin = realTd;
          mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        }
      });
      expect(r.walkedMiles, 'walked leg saves the DIRECT route').toBe(3.2);
      expect(r.walkedPaused, 'and carries the errand mark').toBe(true);
      expect(r.jamMiles, 'no walk on record: the observed detour still collects').toBe(5.3);
    });

    test('the retroactive walk sweep corrects a week of over-paid errand legs: reductions only, once per session', async () => {
      // Owner 2026-08-14: the coprocessor stores about a week, so it can
      // correct data and rows. Rows whose measurement KEPT the observed tally
      // (the floor collected) get the walk question after the load settles:
      // walked = re-measured down to the direct route. Rows outside the week,
      // rows with a driving-only record, and hand-edited rows (tally no
      // longer matches) are untouched, and the sweep runs once per session.
      const r = await page.evaluate(async () => {
        const realRoute = _routeDistance, realTd = window._geoTdPlugin, realRan = window._mileMotionHealRan;
        window.__origMileage = mileage.slice();
        try {
          mileage.length = 0;
          const mk = (id, endMsAgo, miles, gpsMiles) => {
            const end = Date.now() - endMsAgo;
            return { id, date: todayKey(), gps: true, legKey: 'heal-' + id, calc_method: 'auto_route',
              miles, gpsMiles, mins: 12,
              fromCoord: { lat: 39.02, lng: -95.73 }, toCoord: { lat: 39.0, lng: -95.7 },
              startedIso: new Date(end - 14 * 60000).toISOString(), endedIso: new Date(end).toISOString(),
              loggedAt: new Date(end).toISOString() };
          };
          const A = mk(998601, 2 * 86400000, 5.3, 5.3);    // walked, in window -> corrects
          const B = mk(998602, 3 * 86400000, 5.3, 5.3);    // driving-only -> untouched
          const C = mk(998603, 9 * 86400000, 5.3, 5.3);    // beyond the week -> untouched
          const D = mk(998604, 2 * 86400000, 3.2, 5.3);    // hand-edited -> untouched
          mileage.push(A, B, C, D);
          window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 9 });
          const aStart = Date.parse(A.startedIso);
          window._geoTdPlugin = () => ({ motionSince: async (o) => {
            // Only row A's window carries a walk.
            const isA = Math.abs((o.sinceMs || 0) - (aStart - 120000)) < 60000;
            return { available: true, transitions: isA
              ? [{ kind: 'driving', ts: aStart }, { kind: 'onFoot', ts: aStart + 5 * 60000 }, { kind: 'still', ts: aStart + 5 * 60000 + 30000 }, { kind: 'onFoot', ts: aStart + 8 * 60000 }, { kind: 'driving', ts: aStart + 8 * 60000 + 30000 }]
              : [{ kind: 'driving', ts: (o.sinceMs || 0) + 130000 }] };
          } });
          window._mileMotionHealRan = false;
          const fixed1 = await _mileMotionHealSweep();
          const after = Object.fromEntries(mileage.map(m => [m.id, { miles: m.miles, paused: !!m.pausedLeg }]));
          const fixed2 = await _mileMotionHealSweep();   // session guard: never twice
          return { fixed1, fixed2, after };
        } finally {
          window._routeDistance = _routeDistance = realRoute; window._geoTdPlugin = realTd; window._mileMotionHealRan = realRan;
          mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        }
      });
      expect(r.fixed1, 'exactly the walked in-window row corrects').toBe(1);
      expect(r.after[998601], 'walked leg reduced to the direct route and marked').toEqual({ miles: 3.2, paused: true });
      expect(r.after[998602].miles, 'driving-only record untouched').toBe(5.3);
      expect(r.after[998603].miles, 'beyond the coprocessor week untouched').toBe(5.3);
      expect(r.after[998604], 'hand-edited row untouched, never re-marked').toEqual({ miles: 3.2, paused: false });
      expect(r.fixed2, 'once per session, never a second stampede').toBe(0);
    });

    test('the walk sweep rides the load settle point beside the dedup heal', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
      const anchor = src.indexOf('_loadedDataOwner=(_supaUser');
      expect(anchor).toBeGreaterThan(0);
      expect(src.slice(anchor, anchor + 2200), 'sweep fires after every completed load')
        .toContain("_mileMotionHealSweep==='function')_mileMotionHealSweep()");
    });

    test("the owner's real Friday: personal loop off the deduction, job sites untouched", async () => {
      // Owner's 2026-08-14 day: home office -> John Doe -> library (personal
      // notary) -> Casey's (gas, logged as an expense) -> John Doe -> shop.
      // The app logged the Casey's legs as deductible because a FUEL receipt
      // satisfied the "money spent here" test, money already inside the
      // mileage rate. Three fixes meet here: fuel no longer qualifies a stop
      // on a mileage-method vehicle, the retroactive sweep re-judges named
      // stops after the fact, and a loop returning to the same business point
      // claims nothing. Job sites and clients are refused before the personal
      // test is asked: the first cut of this sweep collapsed John Doe himself
      // out of the day, which is the worst failure a row-removing sweep has.
      const r = await page.evaluate(async () => {
        const realRoute = _routeDistance;
        const keep = { m: mileage.slice(), e: expenses.slice(), v: vehicles.slice(), c: clients.slice(), j: jobs.slice(), p: places.slice(), ran: window._milePersonalSweepRan };
        const HOME = { lat: 39.0300, lng: -95.7600 }, JOHN = { lat: 39.0208, lng: -95.7351 };
        const CASEYS = { lat: 39.0300, lng: -95.7200 }, SHOP = { lat: 39.0000, lng: -95.7000 };
        const d = todayKey();
        try {
          window._routeDistance = _routeDistance = async (f, t) => {
            const R = (x) => x * Math.PI / 180;
            const dd = 3958.8 * Math.acos(Math.min(1, Math.sin(R(f.lat)) * Math.sin(R(t.lat)) +
              Math.cos(R(f.lat)) * Math.cos(R(t.lat)) * Math.cos(R(t.lng - f.lng))));
            return { miles: Math.round(dd * 1.25 * 10) / 10, mins: 9 };
          };
          vehicles.length = 0; vehicles.push({ id: 'v1', name: 'F-250', status: 'active', deductionMethod: 'mileage' });
          places.length = 0; savePlace({ name: 'Home Office', kind: 'home_office', lat: HOME.lat, lon: HOME.lng, confirmedBy: 'manual' });
          clients.length = 0; clients.push({ id: 8801, name: 'John Doe', addr: '2950 SW McClure Rd', lat: JOHN.lat, lng: JOHN.lng });
          jobs.length = 0; jobs.push({ id: 9911, name: 'John Repaint', client_id: 8801, lat: JOHN.lat, lon: JOHN.lng, start: d, days: 1, status: 'upcoming' });
          expenses.length = 0;
          expenses.push({ id: 77, date: d, cat: 'fuel', amount: 141.5, vendor: 'Caseys', vehicleId: 'v1', vehicleName: 'F-250', lat: CASEYS.lat, lon: CASEYS.lng });
          mileage.length = 0;
          mileage.push(
            { id: 1, gps: true, legKey: 'L1', calc_method: 'auto_route', miles: 4.0, date: d, from_name: 'Home Office', to_name: 'John Doe', client_id: 8801, purpose: 'Job site',
              fromCoord: HOME, toCoord: JOHN, startedIso: d + 'T13:00:00Z', endedIso: d + 'T13:12:00Z', loggedAt: d + 'T13:12:02Z' },
            // 'Supply run' is what the app ACTUALLY stamped here: _poiPlaceKind
            // labels any non-food business 'supply'. That label blocked the
            // sweep until the purpose guard came out, so the fixture carries
            // it or the test cannot catch the regression.
            { id: 3, gps: true, legKey: 'L3', calc_method: 'auto_route', miles: 4.7, date: d, from_name: 'John Doe', to_name: 'Caseys', purpose: 'Supply run',
              fromCoord: JOHN, toCoord: CASEYS, startedIso: d + 'T15:45:41Z', endedIso: d + 'T16:36:00Z', loggedAt: d + 'T16:36:02Z',
              passedThrough: { stop: { lat: 39.025, lng: -95.728, name: 'Shawnee County Public Library' } } },
            { id: 4, gps: true, legKey: 'L4', calc_method: 'auto_route', miles: 4.5, date: d, from_name: 'Caseys', to_name: 'John Doe', client_id: 8801, purpose: 'Job site',
              fromCoord: CASEYS, toCoord: JOHN, startedIso: d + 'T16:49:00Z', endedIso: d + 'T16:58:00Z', loggedAt: d + 'T16:58:02Z' },
            { id: 5, gps: true, legKey: 'L5', calc_method: 'auto_route', miles: 3.2, date: d, from_name: 'John Doe', to_name: 'Shop', purpose: 'Shop',
              fromCoord: JOHN, toCoord: SHOP, startedIso: d + 'T22:00:00Z', endedIso: d + 'T22:08:00Z', loggedAt: d + 'T22:08:02Z' }
          );
          window._milePersonalSweepRan = false;
          const fixed = await _milePersonalStopSweep();
          return { fixed, rows: mileage.map(m => m.from_name + ' -> ' + m.to_name), total: +mileage.reduce((s, m) => s + (m.miles || 0), 0).toFixed(1) };
        } finally {
          window._routeDistance = _routeDistance = realRoute;
          mileage.length = 0; keep.m.forEach(x => mileage.push(x));
          expenses.length = 0; keep.e.forEach(x => expenses.push(x));
          vehicles.length = 0; keep.v.forEach(x => vehicles.push(x));
          clients.length = 0; keep.c.forEach(x => clients.push(x));
          jobs.length = 0; keep.j.forEach(x => jobs.push(x));
          places.length = 0; keep.p.forEach(x => places.push(x));
          window._milePersonalSweepRan = keep.ran;
        }
      });
      expect(r.fixed, 'the Casey\'s loop is the one thing collapsed').toBe(1);
      expect(r.rows, 'the day is the two real business drives, nothing else')
        .toEqual(['Home Office -> John Doe', 'John Doe -> Shop']);
      expect(r.total, 'deductible miles match the IRS reading of the day').toBe(7.2);
    });

    test('a fuel receipt never qualifies a stop on a mileage vehicle; materials always do', async () => {
      const r = await page.evaluate(() => {
        const keep = { e: expenses.slice(), v: vehicles.slice() };
        const CASEYS = { lat: 39.0300, lng: -95.7200 };
        const d = todayKey();
        try {
          vehicles.length = 0; vehicles.push({ id: 'v1', name: 'F-250', status: 'active', deductionMethod: 'mileage' });
          expenses.length = 0;
          expenses.push({ id: 77, date: d, cat: 'fuel', amount: 141.5, vendor: 'Caseys', vehicleId: 'v1', vehicleName: 'F-250', lat: CASEYS.lat, lon: CASEYS.lng });
          expenses.push({ id: 78, date: d, cat: 'materials', amount: 200, vendor: 'Sherwin', lat: 39.05, lon: -95.66 });
          const fuelOnMileage = !!_bizReceiptForStop({ lat: CASEYS.lat, lng: CASEYS.lng, name: 'Caseys', day: d });
          vehicles[0].deductionMethod = 'actual';
          const fuelOnActual = !!_bizReceiptForStop({ lat: CASEYS.lat, lng: CASEYS.lng, name: 'Caseys', day: d });
          const materials = !!_bizReceiptForStop({ lat: 39.05, lng: -95.66, name: 'Sherwin', day: d });
          return { fuelOnMileage, fuelOnActual, materials };
        } finally {
          expenses.length = 0; keep.e.forEach(x => expenses.push(x));
          vehicles.length = 0; keep.v.forEach(x => vehicles.push(x));
        }
      });
      expect(r.fuelOnMileage, 'fuel is inside the rate: it cannot make a stop a destination').toBe(false);
      expect(r.fuelOnActual, 'on actual expenses the same receipt is a real standalone deduction').toBe(true);
      expect(r.materials, 'money spent on the job still proves a business stop').toBe(true);
    });

    test('dedup keeps the CORRECTED row, not the longer orphan it replaced', async () => {
      const r = await page.evaluate(() => {
        const keep = mileage.slice();
        const JOHN = { lat: 39.0208, lng: -95.7351 }, CASEYS = { lat: 39.0300, lng: -95.7200 };
        const d = todayKey();
        try {
          mileage.length = 0;
          mileage.push(
            { id: 2, gps: true, legKey: 'A', calc_method: 'auto_route', miles: 5.6, date: d, from_name: 'John Doe', to_name: 'Stop',
              fromCoord: JOHN, toCoord: CASEYS, startedIso: d + 'T15:45:04Z', endedIso: d + 'T15:59:00Z', loggedAt: d + 'T15:59:02Z' },
            { id: 3, gps: true, legKey: 'B', calc_method: 'auto_route', miles: 4.7, date: d, from_name: 'John Doe', to_name: 'Caseys',
              fromCoord: JOHN, toCoord: CASEYS, startedIso: d + 'T15:45:41Z', endedIso: d + 'T16:36:00Z', loggedAt: d + 'T16:36:02Z',
              passedThrough: { stop: { lat: 39.025, lng: -95.728, name: 'Shawnee County Public Library' } } }
          );
          _mileDedupTrips(true);
          return mileage.map(m => ({ id: m.id, to: m.to_name, miles: m.miles }));
        } finally { mileage.length = 0; keep.forEach(x => mileage.push(x)); }
      });
      expect(r.length, 'one journey, one row').toBe(1);
      expect(r[0].id, 'the breadcrumbed, corrected row survives').toBe(3);
      expect(r[0].miles, 'and its collapsed distance is what stands, not the orphan\'s inflated one').toBe(4.7);
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

  // ── _mileWorkdaySweep: personal legs outside the workday ────────────────
  // Owner 2026-08-24, on a 6:26pm "Civitan Day Camp to Shop" leg in his IRS
  // log: "was a time we did family pictures and I'm not sure why it's there.
  // It should be dropped." Plus a Saturday "Shop to Stop" on a day with no
  // work in it at all. Same workday window the Time Log and Crew Cost use, so
  // a day cannot be one length for payroll and another for the deduction.
  test.describe('_mileWorkdaySweep', () => {
    // 8:00am to 4:00pm Central on 2026-08-20 (UTC-5), from one job visit and
    // the legs chained to it.
    const ENTS = [
      { employee_user_id: 'wd-user', arrived_at: '2026-08-20T12:30:00Z', departed_at: '2026-08-20T13:00:00Z', source: 'drive' },
      { employee_user_id: 'wd-user', arrived_at: '2026-08-20T13:00:00Z', departed_at: '2026-08-20T21:00:00Z', source: 'geofence' },
      { employee_user_id: 'wd-user', arrived_at: '2026-08-20T21:00:00Z', departed_at: '2026-08-20T21:30:00Z', source: 'drive' },
    ];
    const leg = (o) => Object.assign({ id: 'wd-' + Math.random().toString(36).slice(2), gps: true, legKey: 'wd-lg',
      fromCoord: { lat: 9, lng: 9 }, toCoord: { lat: 9.1, lng: 9.1 }, from_name: 'Shop', to_name: 'Stop',
      miles: 3.2, date: '2026-08-20' }, o);

    const run = (rows, ents) => page.evaluate(async ([rows, ents]) => {
      const orig = { mileage: mileage.slice(), supa: window._supa, ran: window._mileWorkdaySweepRan,
        expenses: expenses.slice(), user: window._supaUser };
      mileage.length = 0; rows.forEach(r => mileage.push(r));
      expenses.length = 0;
      window._supaUser = { id: 'wd-user' };
      window._mileWorkdaySweepRan = false;
      const q = { data: ents, error: null };
      // Chainable, plus an update() recorder: the sweeps SOFT delete now
      // (js/cloud.js _tdSoftDelete), so a stub that only knows .delete() sees
      // nothing happen, and one that only knows .eq/.gte throws the moment
      // .is('deleted_at',null) is added to the read.
      window.__softDeletes = [];
      window._supa = { from: (tbl) => ({
        select: () => { const c = new Proxy(function(){}, { get: (_, k) =>
          k === 'then' ? (res, rej) => Promise.resolve(q).then(res, rej) : () => c }); return c; },
        update: (patch) => { const u = { tbl, patch, ids: null };
          const c = { in: (col, vals) => { u.ids = vals.slice(); window.__softDeletes.push(u); return c; },
                      eq: () => c, then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) };
          return c; },
        delete: () => ({ eq: () => ({ eq: () => ({ then: (res) => Promise.resolve({ error: null }).then(res) }) }) }) }) };
      let dropped = 0, err = null;
      try { dropped = await window.__real_mileWorkdaySweep ? await window.__real_mileWorkdaySweep() : await _mileWorkdaySweep(); }
      catch (e) { err = String(e && e.message || e); }
      const left = mileage.map(m => m.to_name + '@' + m.startedIso);
      mileage.length = 0; orig.mileage.forEach(m => mileage.push(m));
      expenses.length = 0; orig.expenses.forEach(e => expenses.push(e));
      window._supa = orig.supa; window._mileWorkdaySweepRan = orig.ran; window._supaUser = orig.user;
      return { dropped, left, err };
    }, [rows, ents]);

    test('a leg driven after the day clocked out is removed', async () => {
      // 6:26pm to 7:44pm, well past the 4:00pm close.
      const r = await run([leg({ startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z', to_name: 'Shop', from_name: 'Civitan Day Camp' })], ENTS);
      expect(r.err).toBe(null);
      expect(r.dropped, 'the family-pictures run is not a business trip').toBe(1);
      expect(r.left).toEqual([]);
    });

    test('a leg inside the workday is never touched', async () => {
      const r = await run([leg({ startedIso: '2026-08-20T13:30:00Z', endedIso: '2026-08-20T13:40:00Z' })], ENTS);
      expect(r.dropped).toBe(0);
      expect(r.left.length).toBe(1);
    });

    test('a leg straddling the edge of the workday is kept, not trimmed', async () => {
      // Pulls out at 3:50pm, lands at 4:10pm: it overlaps the day, so it stays
      // whole. This sweep only ever removes, it never rewrites a distance.
      const r = await run([leg({ startedIso: '2026-08-20T20:50:00Z', endedIso: '2026-08-20T21:10:00Z' })], ENTS);
      expect(r.dropped).toBe(0);
      expect(r.left.length).toBe(1);
    });

    test('every leg on a day with no work at all is removed', async () => {
      const r = await run([leg({ date: '2026-08-22', startedIso: '2026-08-22T16:47:00Z', endedIso: '2026-08-22T16:57:00Z' })], ENTS);
      expect(r.dropped, 'a Saturday errand is not a deduction').toBe(1);
    });

    // ── The cascade that ate real deductible miles (owner, 2026-08-25) ──────
    //
    // His live diagnostic log at 18:39 that day:
    //   mile-offday - John Doe to Shop 3.2mi 2026-08-19T22:18:05.091Z
    //   mile-offday - John Doe to Shop 3.2mi 2026-08-18T22:19:15.091Z
    //
    // Two real 4:18pm drives home from a client, deleted from the IRS log. The
    // chain: a bad reconciler trim removed those days' on-site rows, so the day
    // had no work event, so the workday window collapsed, so "a day with no
    // work at all means every leg on it is personal" judged both drives
    // personal and swept them. Absence of a time entry is evidence the TIME
    // side failed, never evidence the DRIVING was personal.
    //
    // The owner's original rule is unchanged and still tested just above: an
    // anonymous Stop on a no-work day is an errand and goes.
    test('a named business leg on a day with no time entries is NOT removed', async () => {
      const r = await run([leg({ date: '2026-08-22', from_name: 'John Doe', to_name: 'Shop',
        startedIso: '2026-08-22T22:18:05.091Z', endedIso: '2026-08-22T22:25:00.000Z' })], ENTS);
      expect(r.err).toBe(null);
      expect(r.dropped, 'the exact leg his log shows being destroyed').toBe(0);
      expect(r.left).toEqual(['Shop@2026-08-22T22:18:05.091Z']);
    });

    test('one anonymous end is enough to drop it on a no-work day', async () => {
      for (const ends of [{ from_name: 'Stop', to_name: 'John Doe' },
                          { from_name: 'John Doe', to_name: 'Stop' },
                          { from_name: '', to_name: 'Shop' },
                          { from_name: 'Shop', to_name: '' },
                          { from_name: '?', to_name: 'Shop' }]) {
        const r = await run([leg(Object.assign({ date: '2026-08-22',
          startedIso: '2026-08-22T16:47:00Z', endedIso: '2026-08-22T16:57:00Z' }, ends))], ENTS);
        expect(r.dropped, 'half-anonymous is still an errand: ' + JSON.stringify(ends)).toBe(1);
      }
    });

    test('a leg OUTSIDE a real workday window is still removed, named ends or not', async () => {
      // 08-20 HAS a window, so the named-ends reprieve must not reach it or the
      // family-pictures run comes back from the dead.
      const r = await run([leg({ startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z',
        from_name: 'Civitan Day Camp', to_name: 'Shop' })], ENTS);
      expect(r.dropped, 'evidence of that day exists, and this leg sits outside it').toBe(1);
    });

    test('_mileNamedEnd: only a real resolved place counts', async () => {
      const r = await page.evaluate(() => ({
        named: ['John Doe', 'Shop', 'The Home Depot', 'Caseys'].map(_mileNamedEnd),
        anon: ['Stop', 'stop', 'STOP', '?', '', '   ', null, undefined].map(_mileNamedEnd),
      }));
      expect(r.named, 'a resolved place is business').toEqual([true, true, true, true]);
      expect(r.anon, 'anything anonymous or missing is not').toEqual(
        [false, false, false, false, false, false, false, false]);
    });

    test('a hand-entered trip is never second-guessed', async () => {
      const r = await run([leg({ gps: false, legKey: null, startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z' })], ENTS);
      expect(r.dropped, "the contractor's own statement stands").toBe(0);
    });

    test('a leg carrying a client link is never removed', async () => {
      const r = await run([leg({ client_id: 42, startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z' })], ENTS);
      expect(r.dropped).toBe(0);
    });

    test('with no time entries at all it deletes nothing, absence is not evidence', async () => {
      const r = await run([leg({ startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z' })], []);
      expect(r.dropped).toBe(0);
      expect(r.left.length).toBe(1);
    });

    test('it runs once per session', async () => {
      const rows = [leg({ startedIso: '2026-08-20T23:26:00Z', endedIso: '2026-08-21T00:44:00Z' })];
      const first = await run(rows, ENTS);
      expect(first.dropped).toBe(1);
      const again = await page.evaluate(async () => {
        const prev = window._mileWorkdaySweepRan;
        window._mileWorkdaySweepRan = true;
        const n = await (window.__real_mileWorkdaySweep || _mileWorkdaySweep)();
        window._mileWorkdaySweepRan = prev;
        return n;
      });
      expect(again, 'a second pass in the same session is a no-op').toBe(0);
    });

    test('malformed rows and an empty log never throw', async () => {
      const r = await run([{ id: 'x', gps: true }, { id: 'y', gps: true, startedIso: 'nope', endedIso: 'nope' }], ENTS);
      expect(r.err).toBe(null);
      expect(r.dropped).toBe(0);
    });
  });

  // Owner report 2026-08-24, from the air: a flight was still tacking on
  // mileage. A phone on a plane takes a fix at the gate, loses the sky, and
  // takes another one several hundred miles later; the fence machine reads
  // that as one leg and the router measures a DRIVING route between two
  // airports. Nothing was checking whether a vehicle could have done it.
  //
  // The test is straight-line distance over the leg's own wheel time, which
  // is a conservative floor (real roads are longer than the crow's route), so
  // the ceiling never touches real driving.
  test.describe('the flight ceiling', () => {
    // 1 degree of latitude is about 69 miles, so these are comfortably clear
    // of the 100mph line rather than sitting on it.
    const impossible = (dLat, mins) => page.evaluate(([d, m]) =>
      _geoLegIsImpossible({ lat: 38, lng: -94 }, { lat: 38 + d, lng: -94 }, m), [dLat, mins]);

    test('a flight is refused', async () => {
      expect(await impossible(0.80, 30), '55 miles in half an hour is not a drive').toBe(true);
    });

    test('a long highway haul is kept', async () => {
      expect(await impossible(0.65, 30), '45 miles in half an hour is ordinary interstate').toBe(false);
      expect(await impossible(3.0, 180), '207 miles in three hours is a real drive').toBe(false);
    });

    test('a GPS teleport is refused too, same shape', async () => {
      expect(await impossible(6.0, 4), '414 miles in four minutes').toBe(true);
    });

    test('a short leg is never judged on a ratio', async () => {
      expect(await impossible(0.40, 3), 'under the 30-mile floor, whatever the ratio').toBe(false);
    });

    test('no wheel time, no verdict: it fails open', async () => {
      expect(await impossible(6.0, 0)).toBe(false);
      expect(await impossible(6.0, 2), 'under three minutes there is nothing to divide by').toBe(false);
    });

    test('junk input never throws and never refuses a leg', async () => {
      const out = await page.evaluate(() => ({
        nulls: _geoLegIsImpossible(null, null, 60),
        noFrom: _geoLegIsImpossible(null, { lat: 38, lng: -94 }, 60),
        noLat: _geoLegIsImpossible({ lng: -94 }, { lat: 38, lng: -94 }, 60),
        noArgs: _geoLegIsImpossible(),
        strMins: _geoLegIsImpossible({ lat: 38, lng: -94 }, { lat: 45, lng: -94 }, 'sixty'),
        negMins: _geoLegIsImpossible({ lat: 38, lng: -94 }, { lat: 45, lng: -94 }, -30),
      }));
      expect(Object.values(out).every(v => v === false), 'nothing here is evidence of a flight').toBe(true);
    });
  });

  // The ceiling above stops the NEXT flight. This clears the ones already in
  // the log, so the owner never has to delete them by hand.
  test.describe('_mileFlightSweep', () => {
    const fleg = (o) => Object.assign({ id: 'fl-' + Math.random().toString(36).slice(2), gps: true, legKey: 'fl-lg',
      fromCoord: { lat: 38, lng: -94 }, toCoord: { lat: 38.8, lng: -94 },
      from_name: 'Wichita', to_name: 'Denver', miles: 420, date: '2026-08-24' }, o);

    const runF = (rows) => page.evaluate(async (rows) => {
      const orig = { mileage: mileage.slice(), supa: window._supa, ran: window._mileFlightSweepRan,
        expenses: expenses.slice(), user: window._supaUser };
      mileage.length = 0; rows.forEach(r => mileage.push(r));
      expenses.length = 0;
      window._supaUser = { id: 'fl-user' };
      window._mileFlightSweepRan = false;
      window._supa = { from: () => ({ delete: () => ({ eq: () => ({ eq: () => ({ then: (res) => Promise.resolve({ error: null }).then(res) }) }) }) }) };
      let dropped = 0, err = null;
      try { dropped = await _mileFlightSweep(); } catch (e) { err = String(e && e.message || e); }
      const left = mileage.map(m => m.to_name);
      mileage.length = 0; orig.mileage.forEach(m => mileage.push(m));
      expenses.length = 0; orig.expenses.forEach(e => expenses.push(e));
      window._supa = orig.supa; window._mileFlightSweepRan = orig.ran; window._supaUser = orig.user;
      return { dropped, left, err };
    }, rows);

    test('the flight already in the log is removed', async () => {
      const r = await runF([fleg({ mins: 30 })]);
      expect(r.err).toBe(null);
      expect(r.dropped).toBe(1);
      expect(r.left).toEqual([]);
    });

    test('it reads the clock span when the row carries no wheel time', async () => {
      const r = await runF([fleg({ startedIso: '2026-08-24T14:00:00Z', endedIso: '2026-08-24T14:30:00Z' })]);
      expect(r.dropped).toBe(1);
    });

    test('the drive either side of the flight is untouched', async () => {
      const r = await runF([fleg({ mins: 30 }), fleg({ toCoord: { lat: 38.1, lng: -94 }, to_name: 'Job', miles: 7, mins: 12 })]);
      expect(r.dropped).toBe(1);
      expect(r.left, 'only the flight goes').toEqual(['Job']);
    });

    test('a hand-entered trip is never second-guessed', async () => {
      const r = await runF([fleg({ gps: false, legKey: null, mins: 30 })]);
      expect(r.dropped, "the contractor's own statement stands").toBe(0);
    });

    test('a leg carrying a client link is never removed', async () => {
      const r = await runF([fleg({ client_id: 42, mins: 30 })]);
      expect(r.dropped).toBe(0);
    });

    test('a row with nothing to judge is left alone', async () => {
      const r = await runF([fleg({ mins: 0, startedIso: null, endedIso: null }), fleg({ fromCoord: null, mins: 30 })]);
      expect(r.err).toBe(null);
      expect(r.dropped).toBe(0);
      expect(r.left.length).toBe(2);
    });

    test('malformed rows and an empty log never throw', async () => {
      const r = await runF([{ id: 'x', gps: true }, { id: 'y', gps: true, startedIso: 'nope', endedIso: 'nope' }]);
      expect(r.err).toBe(null);
      expect(r.dropped).toBe(0);
      const empty = await runF([]);
      expect(empty.err).toBe(null);
      expect(empty.dropped).toBe(0);
    });

    test('it runs once per session', async () => {
      const first = await runF([fleg({ mins: 30 })]);
      expect(first.dropped).toBe(1);
      const again = await page.evaluate(async () => {
        const prev = window._mileFlightSweepRan;
        window._mileFlightSweepRan = true;
        const n = await _mileFlightSweep();
        window._mileFlightSweepRan = prev;
        return n;
      });
      expect(again, 'a second pass in the same session is a no-op').toBe(0);
    });

    test('concurrent calls only let one pass through', async () => {
      const out = await page.evaluate(async () => {
        const orig = { mileage: mileage.slice(), supa: window._supa, ran: window._mileFlightSweepRan, user: window._supaUser };
        mileage.length = 0;
        mileage.push({ id: 'fl-c', gps: true, legKey: 'fl-c', mins: 30,
          fromCoord: { lat: 38, lng: -94 }, toCoord: { lat: 38.8, lng: -94 }, to_name: 'Denver', miles: 420, date: '2026-08-24' });
        window._supaUser = { id: 'fl-user' };
        window._mileFlightSweepRan = false;
        window._supa = { from: () => ({ delete: () => ({ eq: () => ({ eq: () => ({ then: (res) => Promise.resolve({ error: null }).then(res) }) }) }) }) };
        const all = await Promise.all([1, 2, 3, 4, 5].map(() => _mileFlightSweep()));
        mileage.length = 0; orig.mileage.forEach(m => mileage.push(m));
        window._supa = orig.supa; window._mileFlightSweepRan = orig.ran; window._supaUser = orig.user;
        return all;
      });
      expect(out.filter(n => n > 0).length, 'exactly one caller does the work').toBe(1);
    });
  });

});

// ── A STOP IS NEVER THE ORIGIN WHILE A REAL FENCE IS KNOWN ──────────────────
//
// Owner, 2026-08-31, reading three weeks of his own rows: every recent mileage
// row said `from=Stop`. Not the shop, not a client, not a place.
//
// Root cause: _geoSettleStopLeg recorded `stopLoc.prevOrigin=_geoLegOrigin||null`,
// and _geoLegOrigin is null whenever a drive begins with no live fence state (a
// cold boot, a restored snapshot, the first leg after a reset). The stop then
// became the leg origin carrying prevOrigin null, and _geoCollapseDetours can
// only walk back through a stop that HAS a prevOrigin, so the anonymous pin was
// the origin forever after and every later row read "Stop -> somewhere".
//
// _geoLastFenceLoc held the real answer the whole time: the last fence the
// truck was actually inside, persisted across boots with the rest of the geo
// snapshot. These tests pin the fallback, in both directions, because the
// deduction turns on it: IRS Pub. 463 wants the PLACE of each trip, and "Stop"
// is not a place.
test.describe('A settled stop never strands the leg origin', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });

  test.afterAll(async () => { await page.context().close(); });

  // One helper, one state shape, so every case below differs only in what it
  // is testing. Returns the resolved origin AFTER the stop settles.
  const settle = (opts) => page.evaluate((o) => {
    _geoLegOrigin = o.legOrigin || null;
    _geoLastFenceLoc = o.lastFence || null;
    _geoDriveStartedAt = new Date(Date.now() - 30 * 60000).toISOString();
    const anchor = {
      lat: 39.05, lng: -95.68,
      at: new Date(Date.now() - 20 * 60000).toISOString(),
      lastAt: new Date(Date.now() - 5 * 60000).toISOString(),
      legClosed: false,
    };
    _geoSettleStopLeg(anchor, new Date().toISOString());
    const o2 = _geoLegOrigin;
    return {
      originKind: o2 && o2.kind,
      originName: o2 && o2.name,
      prev: o2 && o2.prevOrigin ? { name: o2.prevOrigin.name, kind: o2.prevOrigin.kind } : null,
    };
  }, opts);

  const SHOPFENCE = { lat: 39.03, lng: -95.71, name: 'TradeDesk shop', kind: 'shop' };
  const SUPPLY = { lat: 39.04, lng: -95.75, name: 'The Home Depot', kind: 'supply' };

  test('a live leg origin still wins: the fence fallback never overrides it', async () => {
    // The ordinary case, and it must not change. When the drive genuinely began
    // at a known endpoint, that endpoint is the origin. The fallback exists for
    // the case below and must not reach past a real answer to grab a stale one.
    const r = await settle({ legOrigin: SUPPLY, lastFence: SHOPFENCE });
    expect(r.originKind).toBe('stop');
    expect(r.prev).toEqual({ name: 'The Home Depot', kind: 'supply' });
  });

  test('no live leg origin: the last fence we were inside becomes the anchor', async () => {
    // The bug, exactly. Cold boot, drive starts, phone parks somewhere unnamed.
    // Before the fix prevOrigin was null and the pin was origin forever after.
    const r = await settle({ legOrigin: null, lastFence: SHOPFENCE });
    expect(r.originKind).toBe('stop');
    expect(r.prev, 'the stop must carry a real endpoint to measure back to').not.toBeNull();
    expect(r.prev).toEqual({ name: 'TradeDesk shop', kind: 'shop' });
  });

  test('neither known: prevOrigin is null and nothing is invented', async () => {
    // The honest limit. With no live origin AND no remembered fence there is
    // genuinely nothing to anchor to, and guessing one would be worse than the
    // bug: a fabricated endpoint is a fabricated deduction.
    const r = await settle({ legOrigin: null, lastFence: null });
    expect(r.originKind).toBe('stop');
    expect(r.prev).toBeNull();
  });

  test('the collapse chain can now walk back to the fence', async () => {
    // The whole point of the fallback. Once the stop carries a real endpoint,
    // _geoCollapseDetours folds the anonymous pin out and the leg is measured
    // from the shop, which is the CPA's direct-miles rule and the "place"
    // element of Pub. 463 in one move.
    const r = await page.evaluate((fence) => {
      if (typeof mileage !== 'undefined') mileage.length = 0;
      _geoLegOrigin = null;
      _geoLastFenceLoc = fence;
      _geoDriveStartedAt = new Date(Date.now() - 30 * 60000).toISOString();
      _geoSettleStopLeg({
        lat: 39.05, lng: -95.68,
        at: new Date(Date.now() - 20 * 60000).toISOString(),
        lastAt: new Date(Date.now() - 5 * 60000).toISOString(),
        legClosed: false,
      }, new Date().toISOString());
      const beforeKind = _geoLegOrigin && _geoLegOrigin.kind;
      _geoCollapseDetours();
      return {
        beforeKind,
        afterName: _geoLegOrigin && _geoLegOrigin.name,
        afterKind: _geoLegOrigin && _geoLegOrigin.kind,
      };
    }, SHOPFENCE);
    expect(r.beforeKind, 'the stop is the origin until the collapse runs').toBe('stop');
    expect(r.afterKind, 'and afterwards it is the fence, not the pin').toBe('shop');
    expect(r.afterName).toBe('TradeDesk shop');
  });

  test('a null anchor and a closed leg are both no-ops, not throws', async () => {
    // §11.1 input classes on the function this change touches.
    const r = await page.evaluate(() => {
      const out = [];
      _geoLastFenceLoc = { lat: 39.03, lng: -95.71, name: 'TradeDesk shop', kind: 'shop' };
      _geoDriveStartedAt = new Date().toISOString();
      try { out.push(_geoSettleStopLeg(null, new Date().toISOString())); } catch (e) { out.push('threw:' + e.message); }
      try { out.push(_geoSettleStopLeg(undefined)); } catch (e) { out.push('threw:' + e.message); }
      try { out.push(_geoSettleStopLeg({ legClosed: true }, new Date().toISOString())); } catch (e) { out.push('threw:' + e.message); }
      _geoDriveStartedAt = null;
      try { out.push(_geoSettleStopLeg({ lat: 1, lng: 1, at: new Date().toISOString() }, new Date().toISOString())); }
      catch (e) { out.push('threw:' + e.message); }
      return out;
    });
    expect(r).toEqual([false, false, false, false]);
  });

  assertNoErrors(() => page);
});

// ── THE TAPE SETS THE CLOCK, THE FENCE CONFIRMS THE EVENT ───────────────────
//
// A geofence cannot fire until a line several hundred feet away has been
// crossed, and driving starts at the parking space. Measured on the owner's
// own account over ten real departures, the fix taken at the fence sat a MILE
// from where the drive began on half of them, and within ten metres on one.
//
// The motion coprocessor knew at the parking space: foot -> automotive is the
// truck pulling out, stamped to the millisecond, and on the live path it
// lands within seconds. So the tape supplies the moment and the fence still
// supplies the event, which is the same bargain the shop dwell already
// strikes with _geoShopPendingClose. The edge alone is never enough: a phone
// in a pocket reads automotive from a ride in somebody else's truck.
// ── SANDBOX: one flip, driven through the whole client pipeline ─────────────
// Owner, 2026-08-31, before taking a real drive: "anyway you can mock an id to
// go through the process on a drive that starts at john doe in my data base
// and goes to the shop before I drive so we know it works in a sandbox?"
//
// His actual geography, read out of his account: John Doe at 2950 SW McClure
// Rd (39.0123292, -95.7464936) and the shop at 2015 SW Randolph Ave
// (39.0307066, -95.7112082), the same 3.2-mile road he drove twice today.
// Nothing here touches his data: the coordinates are his, the account is the
// harness's own.
//
// This is the CLIENT half end to end, which is the half that can be rehearsed
// without writing to a live database. The server half is pinned to the same
// rule at source by e2e-geo-ingest-contract; exercising it for real would mean
// posting synthetic events to the live function and leaving junk rows in his
// IRS log, which is not a thing to do to somebody's tax record for a rehearsal.
test.describe('Sandbox: a minted flip id survives the whole journey', () => {
  let page;
  const JOHN = { lat: 39.0123292, lon: -95.7464936 };
  const SHOP = { lat: 39.0307066, lon: -95.7112082 };
  const MID  = { lat: 39.0220000, lon: -95.7300000 };   // on the road between them
  const FLIP = 'fSANDBOX00000001';

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the drive John Doe -> shop is logged once, under the flip id', async () => {
    const r = await page.evaluate(async (d) => {
      const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
      const enq = [];
      const before = mileage.slice();
      try {
        _supaUser = { id: 'sandbox0-0000-0000-0000-000000000000' };
        // The router answers the way MapKit does for that road.
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 8 });
        window._geoEnqueue = (tbl, row) => enq.push({ tbl, ...row });
        mileage.length = 0;

        // His two ends, as the app knows them.
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon; S.teamTracking = true;
        clients.length = 0;
        clients.push({ id: 1787003875684, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
        jobs.length = 0;
        // A client fence resolves out of the GEOCODE CACHE keyed by client id,
        // not from a lat/lng on the record (_geoClientAt), and the cached
        // address has to match the client's current one or the entry is
        // ignored as stale. A first cut of this put the coordinates on the
        // client and the fence never resolved at all, so the leg never opened.
        localStorage.setItem('zp3_nearby_geo', JSON.stringify({
          '1787003875684': { addr: '2950 SW McClure Rd, Topeka, KS 66614',
                             lat: d.JOHN.lat, lon: d.JOHN.lon },
        }));
        _geoClientCacheMemo = null;

        // Standing at John Doe's, nothing open but the visit. Cleared field by
        // field the way every other test in this file does: there is no
        // _geoReset global, the reset lives inside the tracking teardown.
        _geoPingBusy = false;
        _geoCurrentJob = null; _geoArrivedAt = null;
        _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
        _geoLastFenceAt = null; _geoStopAnchor = null;
        _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLegFlipId = null;
        _geoLastMotionKind = 'still';
        // speed rides along because a real drive has one, and leaving a CLIENT
        // fence is gated on confirmation: either a driving-speed reading (real
        // evidence of motion) or a second agreeing ping. A fixture with no
        // speed only ever arms the pending exit and the leg never opens, which
        // is what the first cut of this did.
        const ping = (c, mps) => _geoOnPing({ coords: {
          latitude: c.lat, longitude: c.lon, accuracy: 8,
          ...(mps != null ? { speed: mps } : {}) } });
        await ping(d.JOHN);

        // 1. He walks to the truck. Rest, so no departure is claimed.
        await _geoTdEvent({ type: 'motion', kind: 'walking', prevKind: 'still',
                            ts: Date.now() - 9 * 60000, flipId: 'fWALK000000000001' });
        const afterWalk = { pending: _geoDrivePendingAt, id: _geoDrivePendingId };

        // 2. THE FLIP. CoreMotion says automotive, the plugin mints the id.
        await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                            ts: Date.now() - 8 * 60000, flipId: d.FLIP });
        const afterFlip = { pending: _geoDrivePendingAt, id: _geoDrivePendingId };

        // 3. He clears John Doe's fence at road speed. This is what spends the
        // flip.
        await ping(d.MID, 20);
        const afterExit = { started: _geoDriveStartedAt, leg: _geoLegFlipId };

        // 4. He arrives at the shop. The leg closes and both rows are written.
        // The accumulator is deliberately NOT preset: a first cut seeded it at
        // 3.1 and the pings then added the MID -> SHOP hop on top, so the
        // observed tally beat the route and the forced-detour floor correctly
        // took 4.3. The engine was right and the fixture was lying; a real
        // drive's tally comes from its own pings.
        await ping(d.SHOP);
        await new Promise(res => setTimeout(res, 80));

        const rows = mileage.slice();
        return {
          afterWalk, afterFlip, afterExit,
          mileage: rows.map(m => ({ legKey: m.legKey, from: m.from_name, to: m.to_name,
                                    miles: m.miles, calc: m.calc_method })),
          drives: enq.filter(e => e.tbl === 'job_time_entries' && /^drive/.test(e.source || ''))
                     .map(e => ({ key: e.client_key, dest: e.dest_place, source: e.source })),
        };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        window._geoEnqueue = realEnq;
        mileage.length = 0; before.forEach(m => mileage.push(m));
        _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLegFlipId = null;
      }
    }, { JOHN, SHOP, MID, FLIP });

    // Stage 1: walking is rest. Nothing claimed, nothing named.
    expect(r.afterWalk.pending, 'a walk to the truck is not a departure').toBeNull();
    expect(r.afterWalk.id).toBeNull();

    // Stage 2: the flip is HELD with its id, not written.
    expect(r.afterFlip.pending, 'the flip marks the moment').not.toBeNull();
    expect(r.afterFlip.id, 'and carries its own id').toBe(FLIP);

    // Stage 3: the fence spends it, and the leg takes the id AND the clock.
    expect(r.afterExit.started, 'the leg opens at the flip, not at the fence').not.toBeNull();
    expect(r.afterExit.leg, 'and is named by the flip that opened it').toBe(FLIP);

    // Stage 4: exactly one drive, one mileage row, both under that id.
    expect(r.drives.length, 'one drive, one time entry').toBe(1);
    expect(r.drives[0].key, 'keyed by the flip, not by a timestamp').toBe(FLIP);
    expect(r.mileage.length, 'one drive, one mileage row').toBe(1);
    expect(r.mileage[0].legKey, 'the same id on both halves').toBe(FLIP);
    expect(r.mileage[0].from).toBe('John Doe');
    expect(r.mileage[0].to).toBe('Shop');
    expect(r.mileage[0].miles, 'the routed distance, not a straight line').toBe(3.2);
    expect(r.mileage[0].calc).toBe('auto_route');
  });


  test('the drawn route starts at the DOOR, not where the exit confirmed', async () => {
    // Owner, 2026-09-01, looking at a rendered route: "it wasn't starting at
    // the door though". Measured on the real leg behind that screenshot
    // (Shop -> John Doe, 12:52 CDT): the automotive flip landed 1,336 ft down
    // the road, the regionExit fix 1,524 ft, and the drawn line began at the
    // regionExit. The row's START TIME had already been backdated to the motion
    // flip, so it claimed a start 69 seconds before its own first point. Time
    // was corrected and geometry was not; that quarter mile plus a 360 ft tail
    // at the far end IS the 0.3 mi he was missing.
    //
    // Same sandbox geometry, run the other way: he leaves John Doe and the leg
    // opens at MID, over a mile out. The first point must still be John Doe.
    const r = await page.evaluate(async (d) => {
      const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
      const before = mileage.slice();
      try {
        _supaUser = { id: 'sandbox0-0000-0000-0000-000000000000' };
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 8 });
        window._geoEnqueue = () => {};
        mileage.length = 0;
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon; S.teamTracking = true;
        clients.length = 0;
        clients.push({ id: 1787003875684, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
        jobs.length = 0;
        localStorage.setItem('zp3_nearby_geo', JSON.stringify({
          '1787003875684': { addr: '2950 SW McClure Rd, Topeka, KS 66614',
                             lat: d.JOHN.lat, lon: d.JOHN.lon },
        }));
        _geoClientCacheMemo = null;
        _geoPingBusy = false;
        _geoCurrentJob = null; _geoArrivedAt = null;
        _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
        _geoLastFenceAt = null; _geoStopAnchor = null;
        _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLegFlipId = null;
        _geoLastMotionKind = 'still'; _geoDrivePath = []; _geoDriveMiles = 0;
        const ping = (c, mps) => _geoOnPing({ coords: {
          latitude: c.lat, longitude: c.lon, accuracy: 8,
          ...(mps != null ? { speed: mps } : {}) } });

        await ping(d.JOHN);
        await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'still',
                            ts: Date.now() - 8 * 60000, flipId: d.FLIP });
        await ping(d.MID, 20);          // the leg opens HERE, over a mile out
        return {
          started: !!_geoDriveStartedAt,
          pts: _geoDrivePath.length,
          first: _geoDrivePath.length ? [_geoDrivePath[0][0], _geoDrivePath[0][1]] : null,
          second: _geoDrivePath.length > 1 ? [_geoDrivePath[1][0], _geoDrivePath[1][1]] : null,
          miles: _geoDriveMiles,
        };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        window._geoEnqueue = realEnq;
        mileage.length = 0; before.forEach(m => mileage.push(m));
      }
    }, { JOHN, SHOP, MID, FLIP });

    const ft = (a, b) => {
      const la = (a[0] + b[0]) / 2 * Math.PI / 180;
      return Math.hypot((b[0] - a[0]) * 364000, (b[1] - a[1]) * 364000 * Math.cos(la));
    };
    expect(r.started, 'the leg has to open at all or there is nothing to assert').toBe(true);
    expect(r.pts, 'the origin AND the fix that opened it').toBeGreaterThanOrEqual(2);
    expect(ft(r.first, [JOHN.lat, JOHN.lon]),
      'the line must start at the door it left, not a mile down the road').toBeLessThan(200);
    expect(ft(r.second, [MID.lat, MID.lon]),
      'and the second point is still where the exit actually confirmed').toBeLessThan(200);
    // The odometer has to agree with the drawing, or the map shows a longer
    // line than the number printed underneath it.
    expect(r.miles, 'the seeded segment counts toward the tally too')
      .toBeGreaterThan(ft([JOHN.lat, JOHN.lon], [MID.lat, MID.lon]) / 5280 * 0.9);
  });

  test('a second delivery of the same flip cannot make a second row', async () => {
    // The property the id exists for, stated directly: replay the whole
    // journey twice and there is still one row, because the key is the flip
    // rather than a clock two writers can read differently.
    const r = await page.evaluate(async (d) => {
      const realUser = _supaUser, realRoute = _routeDistance, realEnq = window._geoEnqueue;
      const before = mileage.slice();
      try {
        _supaUser = { id: 'sandbox0-0000-0000-0000-000000000000' };
        window._routeDistance = _routeDistance = async () => ({ miles: 3.2, mins: 8 });
        window._geoEnqueue = () => {};
        mileage.length = 0;
        S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon; S.teamTracking = true;
        clients.length = 0;
        clients.push({ id: 1787003875684, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
        jobs.length = 0;
        localStorage.setItem('zp3_nearby_geo', JSON.stringify({
          '1787003875684': { addr: '2950 SW McClure Rd, Topeka, KS 66614',
                             lat: d.JOHN.lat, lon: d.JOHN.lon },
        }));
        _geoClientCacheMemo = null;
        const ping = (c, mps) => _geoOnPing({ coords: {
          latitude: c.lat, longitude: c.lon, accuracy: 8,
          ...(mps != null ? { speed: mps } : {}) } });
        for (let pass = 0; pass < 2; pass++) {
          _geoPingBusy = false;
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoLegAtShop = false;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentClient = null; _geoClientArrivedAt = null;
          _geoDriveStartedAt = null; _geoLegOrigin = null; _geoLastFenceLoc = null;
          _geoLastFenceAt = null; _geoStopAnchor = null;
          _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLegFlipId = null;
          _geoLastMotionKind = 'walking';
          await ping(d.JOHN);
          await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                              ts: Date.now() - 8 * 60000, flipId: d.FLIP });
          await ping(d.MID, 20);
          await ping(d.SHOP);
          await new Promise(res => setTimeout(res, 80));
        }
        return { rows: mileage.filter(m => m && m.legKey === d.FLIP).length };
      } finally {
        _supaUser = realUser; window._routeDistance = _routeDistance = realRoute;
        window._geoEnqueue = realEnq;
        mileage.length = 0; before.forEach(m => mileage.push(m));
        _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLegFlipId = null;
      }
    }, { JOHN, SHOP, MID, FLIP });
    expect(r.rows, 'the same flip can only ever own one row').toBe(1);
  });
});

test.describe('A drive opens at the moment the tape saw, not the moment the fence noticed', () => {
  let page;
  const SHOPC = { lat: 38.0, lon: -94.0 };
  const AWAY  = { lat: 38.4, lon: -94.4 };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Park at the shop, optionally plant a pending motion edge, then drive off.
  // Returns how many seconds before the departing ping the leg was opened.
  const depart = (o) => page.evaluate(async (a) => {
    S.officeLat = a.SHOPC.lat; S.officeLon = a.SHOPC.lon; S.teamTracking = true;
    _geoPingBusy = false;
    _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
    _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoStopAnchor = null;
    _geoLastFenceAt = null; _geoLegAtShop = false; _geoLastFenceLoc = null;
    _geoLegOrigin = null; _geoDrivePendingAt = null; _geoLastMotionKind = '';
    const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
    await ping(a.SHOPC);                       // inside the shop fence
    _geoDrivePendingId = null; _geoLegFlipId = null;
    if (a.pendingAgeS != null) {
      // The transition as the plugin delivers it: kind, prevKind, the instant
      // it happened, and (build 45+) the id it minted for this flip. Fed
      // through the real handler, not poked in.
      const ev = { type: 'motion', kind: 'automotive', prevKind: 'walking',
                   ts: Date.now() - a.pendingAgeS * 1000 };
      if (a.flipId) ev.flipId = a.flipId;
      await _geoTdEvent(ev, !!a.replay);
    }
    if (a.thenRest) await _geoTdEvent({ type: 'motion', kind: 'still', prevKind: 'automotive', ts: Date.now() });
    const departedAtMs = Date.now();
    await ping(a.AWAY);                        // out on the road
    const started = Date.parse(_geoDriveStartedAt || '') || 0;
    return {
      opened: !!_geoDriveStartedAt,
      backdatedS: started ? Math.round((departedAtMs - started) / 1000) : null,
      pendingCleared: _geoDrivePendingAt === null,
      legFlipId: _geoLegFlipId,
      pendingId: _geoDrivePendingId,
      key: _geoLegKey(_geoDriveStartedAt, _geoLegFlipId),
    };
  }, o);

  // ── ONE FLIP, ONE ID, ONE ROW (owner rule 2026-08-31) ────────────────────
  // "we should only write one, ever ... one ID that runs through the journey
  // per core motion flip." The leg key used to be base36 of the start
  // millisecond, COMPUTED independently by the phone and by ingest-geo. His
  // 1:19pm departure fired automotive four times (18:20:35.529, .747, .788 and
  // one a minute earlier), the two writers keyed off different samples, and one
  // drive home became two rows with two distances. An id minted once at the
  // flip cannot be computed differently, so the duplicate stops being
  // something to detect and becomes something that cannot be made.

  test('the flip names the leg: its id becomes the key, untouched', async () => {
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 180, flipId: 'fABC123' });
    expect(r.opened).toBe(true);
    expect(r.legFlipId, 'the leg remembers which flip opened it').toBe('fABC123');
    expect(r.key, 'and that id IS the key, not a derivation of a timestamp').toBe('fABC123');
  });

  test('no flipId: the derived key still works, for older builds and old rows', async () => {
    // The fallback has to stay. Every row already on the books carries the
    // derived shape, and a phone that has not taken build 45 sends no id.
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 180 });
    expect(r.opened).toBe(true);
    expect(r.legFlipId).toBeNull();
    expect(r.key).toMatch(/-leg-[0-9a-z]+$/);
  });

  test('a REFUSED mark takes its id with it', async () => {
    // A stale edge does not open this leg, so it must not name it either. A
    // leg labelled with a transition it was not opened from is worse than an
    // unlabelled one: it is wrong and it looks authoritative.
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 40 * 60, flipId: 'fSTALE' });
    expect(r.opened).toBe(true);
    expect(r.legFlipId, 'the leg was not opened from that flip').toBeNull();
    expect(r.key).not.toBe('fSTALE');
  });

  test('coming to rest clears the id along with the mark', async () => {
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 180, flipId: 'fGONE', thenRest: true });
    expect(r.pendingCleared).toBe(true);
    expect(r.pendingId).toBeNull();
    expect(r.legFlipId).toBeNull();
  });

  test('a replayed flip still names its leg: that is the force-closed case', async () => {
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 240, flipId: 'fREPLAY', replay: true });
    expect(r.legFlipId).toBe('fREPLAY');
    expect(r.key).toBe('fREPLAY');
  });

  test('a non-string flipId is refused rather than stringified into a key', async () => {
    const r = await page.evaluate(async () => {
      const out = {};
      for (const junk of [123, {}, [], true, '']) {
        _geoDrivePendingAt = null; _geoDrivePendingId = null; _geoLastMotionKind = 'walking';
        await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                            ts: Date.now() - 60000, flipId: junk });
        out[String(typeof junk) + ':' + String(junk)] = _geoDrivePendingId;
      }
      _geoDrivePendingAt = null; _geoDrivePendingId = null;
      return out;
    });
    Object.entries(r).forEach(([k, v]) => expect(v, k + ' must not become an id').toBeNull());
  });

  test('_geoLegKey: the id wins, and only a real id wins', async () => {
    const r = await page.evaluate(() => ({
      withId: _geoLegKey('2026-08-31T12:52:05.328Z', 'fXYZ'),
      empty: _geoLegKey('2026-08-31T12:52:05.328Z', ''),
      nullId: _geoLegKey('2026-08-31T12:52:05.328Z', null),
      undef: _geoLegKey('2026-08-31T12:52:05.328Z'),
    }));
    expect(r.withId).toBe('fXYZ');
    // Every falsy id falls through to the derived shape rather than keying a
    // leg on an empty string, which would collide every unlabelled leg in the
    // account onto one row.
    expect(r.empty).toMatch(/-leg-/);
    expect(r.nullId).toMatch(/-leg-/);
    expect(r.undef).toMatch(/-leg-/);
    expect(r.empty).toBe(r.undef);
  });

  test('the leg identity survives the app being killed', async () => {
    // Without this a drive restored after a kill is re-keyed off its clock and
    // becomes a second row for one drive, which is the duplicate this whole id
    // exists to prevent.
    const r = await page.evaluate(() => {
      const realUser = _supaUser;
      try {
        _supaUser = { id: 'u-flip' };
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoCurrentClient = null; _geoClientArrivedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        _geoDriveStartedAt = new Date(Date.now() - 10 * 60000).toISOString();
        _geoLegFlipId = 'fKEEP';
        _geoPersistOpen(new Date().toISOString());
        _geoDriveStartedAt = null; _geoLegFlipId = null;
        window._geoOpenRestored = false;
        _geoRestoreOpen();
        return { drive: !!_geoDriveStartedAt, flip: _geoLegFlipId };
      } finally {
        _supaUser = realUser; _geoDriveStartedAt = null; _geoLegFlipId = null; _geoClearOpen();
      }
    });
    expect(r.drive).toBe(true);
    expect(r.flip).toBe('fKEEP');
  });

  test('no tape edge: the drive still opens at the departing ping, unchanged', async () => {
    // The behaviour that has always been here, and the fallback whenever the
    // coprocessor has nothing. Must not move.
    const r = await depart({ SHOPC, AWAY });
    expect(r.opened).toBe(true);
    expect(r.backdatedS, 'no edge, no correction').toBeLessThanOrEqual(1);
  });

  test('a fresh edge three minutes back opens the leg three minutes back', async () => {
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 180 });
    expect(r.opened).toBe(true);
    expect(r.backdatedS).toBeGreaterThanOrEqual(178);
    expect(r.backdatedS).toBeLessThanOrEqual(182);
    expect(r.pendingCleared, 'spent, not left to backdate the next leg too').toBe(true);
  });

  test('a stale edge is ignored: past the cap it no longer describes this departure', async () => {
    // 40 minutes of driving, stopping and starting since. The fence is the
    // better witness now, and a leg backdated that far invents wheel time.
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 40 * 60 });
    expect(r.opened).toBe(true);
    expect(r.backdatedS).toBeLessThanOrEqual(1);
  });

  test('right on the cap boundary, both sides', async () => {
    const inside = await depart({ SHOPC, AWAY, pendingAgeS: 14 * 60 });
    expect(inside.backdatedS).toBeGreaterThan(800);
    const outside = await depart({ SHOPC, AWAY, pendingAgeS: 16 * 60 });
    expect(outside.backdatedS).toBeLessThanOrEqual(1);
  });

  test('coming to rest cancels the claim', async () => {
    // automotive then still, then the fence exit. Whatever that edge was, it
    // is not the departure this exit describes: he pulled forward and parked.
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 120, thenRest: true });
    expect(r.opened).toBe(true);
    expect(r.backdatedS, 'the rest cancelled it').toBeLessThanOrEqual(1);
  });

  test('a REPLAYED edge still sets the clock: that is the force-closed case', async () => {
    // The whole reason the edge is computed outside the !replay guard. A phone
    // that was killed at the kerb has no live fence exit and the buffered tape
    // is the only witness to when it pulled out.
    const r = await depart({ SHOPC, AWAY, pendingAgeS: 240, replay: true });
    expect(r.opened).toBe(true);
    expect(r.backdatedS).toBeGreaterThanOrEqual(238);
  });

  test('an edge stamped in the future is refused', async () => {
    // Clock skew on a replayed buffer must never backdate a leg forwards.
    const r = await page.evaluate(async () => {
      _geoDrivePendingAt = null; _geoLastMotionKind = '';
      await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                          ts: Date.now() + 10 * 60000 }, true);
      return _geoDrivePendingAt;
    });
    expect(r).toBeNull();
  });

  test('junk motion events do not throw or plant a claim', async () => {
    const r = await page.evaluate(async () => {
      const out = [];
      for (const ev of [
        { type: 'motion' },
        { type: 'motion', kind: '' },
        { type: 'motion', kind: 'automotive', ts: 'not-a-number' },
        { type: 'motion', kind: 'still', prevKind: 'automotive' },
      ]) {
        try { _geoDrivePendingAt = null; _geoLastMotionKind = ''; await _geoTdEvent(ev, true); out.push(_geoDrivePendingAt); }
        catch (e) { out.push('threw:' + e.message); }
      }
      return out;
    });
    // A kind-less event plants nothing; 'automotive' with a junk ts falls back
    // to now, which is legal and self-cancelling (it can never be < now later).
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(typeof r[2]).toBe('string');
    expect(r[3]).toBeNull();
  });

  assertNoErrors(() => page);
});

// ═══════════════════════════════════════════════════════════════════════════
// The trace is the measurement (owner 2026-09-01)
// ═══════════════════════════════════════════════════════════════════════════
//
// "his mileage should have his trip from home office to 1200 sw oakley shop in
// the morning and thats really it."
//
// It had that trip. It said 1.8 miles. The row carries a 229-point GPS trace
// summing to 5.65, and _mileServerRefine threw it away: it routes fromCoord to
// toCoord and overwrites `miles` with the answer. His endpoints had not
// resolved (the row reads "Stop" to "KS"), so it produced a distance for a
// journey nobody took, and nothing compared it against the evidence sitting in
// the same record.
test.describe('a recorded path outranks a routed guess', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
  });

  // Roughly Jack's morning: 7402 SW 22nd Ct to 1200 SW Oakley Ave, walked in
  // straight hops so the sum is arithmetic rather than a guess.
  const LEG = (n) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push([39.0257 + (0.02 * i) / (n - 1), -95.7939 + (0.0788 * i) / (n - 1), 1000 + i * 2000]);
    }
    return pts;
  };

  test('_milePathMiles measures the line that was actually driven', async ({ page }) => {
    const r = await page.evaluate((path) => ({
      real: _milePathMiles({ path }),
      none: _milePathMiles({}),
      one: _milePathMiles({ path: [[39.0, -95.7, 1]] }),
      junk: _milePathMiles({ path: [['x', 'y', 1], [39.0, -95.7, 2]] }),
      notArray: _milePathMiles({ path: 'nope' }),
      nul: _milePathMiles(null),
    }), LEG(229));
    // Home to shop is about four and a half miles as the crow flies.
    expect(r.real).toBeGreaterThan(4);
    expect(r.real).toBeLessThan(6);
    // Nothing to measure is zero, never NaN: a NaN here would poison a money
    // record all the way to a tax return.
    expect(r.none).toBe(0);
    expect(r.one).toBe(0);
    expect(r.junk).toBe(0);
    expect(r.notArray).toBe(0);
    expect(r.nul).toBe(0);
  });

  test('_mileObservedMiles takes whichever record of the drive exists', async ({ page }) => {
    const r = await page.evaluate((path) => ({
      // A server-derived row has the path and no odometer tally, which is
      // exactly the shape that had nothing to defend itself with.
      pathOnly: _mileObservedMiles({ path }),
      tallyOnly: _mileObservedMiles({ gpsMiles: 5.6 }),
      // Both: the longer of the two, since each is a record of the same drive
      // and the shorter one lost hops.
      both: _mileObservedMiles({ path, gpsMiles: 1.2 }),
      neither: _mileObservedMiles({}),
      junkTally: _mileObservedMiles({ gpsMiles: 'lots' }),
      negative: _mileObservedMiles({ gpsMiles: -4 }),
    }), LEG(229));
    expect(r.pathOnly).toBeGreaterThan(4);
    expect(r.tallyOnly).toBeCloseTo(5.6, 3);
    expect(r.both).toBeGreaterThan(4);
    expect(r.neither).toBe(0);
    expect(r.junkTally).toBe(0);
    expect(r.negative, 'a negative distance is not a shorter drive').toBe(0);
  });

  test('the refine keeps the traced distance instead of the routed one', async ({ page }) => {
    const r = await page.evaluate(() => {
      const src = String(_mileServerRefine);
      return {
        usesObserved: src.includes('_mileObservedMiles(m)'),
        // Shorter is never taken: a route is the minimum a leg between two
        // points can be, so an observed figure BELOW it is a lost-hop tally,
        // not a shortcut.
        onlyLonger: /obs>miles&&obs<=miles\*4/.test(src.replace(/\s/g, '')),
        // A walked errand still wins over both, unchanged.
        walkCheck: src.includes('_mileTapeHadPause'),
      };
    });
    expect(r.usesObserved, 'the evidence in the row has to be consulted').toBe(true);
    expect(r.onlyLonger).toBe(true);
    expect(r.walkCheck).toBe(true);
  });

  test('the pending-retry path reads the path too, not only the odometer', async ({ page }) => {
    // It already preferred a longer observed distance, but only via gpsMiles,
    // so every server-derived row (the ones that carry a path and no tally)
    // fell straight through to the route.
    const r = await page.evaluate(() => String(_retryPendingTrips).includes('_mileObservedMiles(rec)'));
    expect(r).toBe(true);
  });

  assertNoErrors(() => page);
});
