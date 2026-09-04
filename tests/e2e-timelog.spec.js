// @ts-check
/**
 * Exhaustive E2E coverage for js/timelog.js: the Time Log page, now also the
 * unified crew hours report (owner call 2026-08-20, hours only, no dollars,
 * "don't need pay rate here just time"). Year selector → month accordions,
 * January (oldest) through December (newest, current month open by default)
 * → week accordions (_bkWeekAcc, the tier new to this change) → the same
 * day-by-day entries table (_bkRenderDays) this page always had. Owners/
 * managers see every employee's hours broken out per week; everyone else
 * sees only their own hours, plus a share button. $ cost stays in Crew Cost
 * (js/finance.js), which this page never queries.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('timelog.js: exhaustive coverage', () => {
  let page;
  const thisYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);
  const curMonthPrefix = new Date().toISOString().slice(0, 7);
  const todayStr = new Date().toISOString().slice(0, 10);

  const SEED_FIXTURES_FN = () => {
    clients = clients.filter(c => c.id !== 89901 && c.id !== 89902);
    bids    = bids.filter(b => b.id !== 88801);
    jobs    = jobs.filter(j => j.id !== 87701 && j.id !== 87702);
    timeEntries = (timeEntries || []).filter(e => e.job_id !== 87701 && e.job_id !== 87702);

    clients.push(
      { id: 89901, name: 'Timelog Test Client', phone: '316-555-8001', addr: '1 Timelog St, Wichita KS 67202' },
      { id: 89902, name: 'Timelog No-Bid Client', phone: '316-555-8002', addr: '2 Timelog Ave, Wichita KS 67202' }
    );
    bids.push(
      { id: 88801, client_id: 89901, client_name: 'Timelog Test Client', amount: 2000, status: 'Closed Won', bid_date: '2026-01-01' }
    );
    jobs.push(
      { id: 87701, client_id: 89901, bid_id: 88801, name: 'Timelog job with bid', eventType: 'job', status: 'scheduled', start: '2099-06-01', actualHours: 0 },
      { id: 87702, client_id: 89902, bid_id: null, name: 'Timelog walk-up job', eventType: 'job', status: 'upcoming', start: '2099-06-02', actualHours: 0 }
    );
    const now = new Date();
    timeEntries.push(
      // Current month/day: this month's accordion should default open.
      { id: 8990001, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, scope_id: 'sand', scope_label: 'Sanding', logged_by_uid: null, logged_by_name: 'Owner (me)' },
      { id: 8990002, job_id: 87702, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 45, scope_id: null, scope_label: null, logged_by_uid: 'emp-test-uid', logged_by_name: 'Test Crew Member' },
      // A prior month, same year, proves month grouping/sorting works.
      { id: 8990003, job_id: 87701, date: `${new Date().getFullYear()}-01-05`, start_time: `${new Date().getFullYear()}-01-05T09:00:00Z`, end_time: `${new Date().getFullYear()}-01-05T10:00:00Z`, minutes: 60, scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Owner (me)' },
      // A prior year, proves the year selector filters correctly.
      { id: 8990004, job_id: 87701, date: `${new Date().getFullYear() - 1}-05-10`, start_time: `${new Date().getFullYear() - 1}-05-10T09:00:00Z`, end_time: `${new Date().getFullYear() - 1}-05-10T10:00:00Z`, minutes: 30, scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Owner (me)' }
    );
  };
  const seedFixtures = () => page.evaluate(() => window.__seedTimelogFixtures());

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Name the business zone: every midnight below is a business midnight now
    // that the day-key helpers follow the business address rather than a
    // hardcoded Central (owner 2026-08-30). Left unset it comes from the
    // runner, UTC in CI and Central on a Kansas laptop, which is the machine
    // deciding the result (CLAUDE.md 5.2.2).
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    await page.evaluate(`window.__seedTimelogFixtures = ${SEED_FIXTURES_FN.toString()}`);
    await seedFixtures();
  });

  test.beforeEach(async () => {
    await seedFixtures();
    // _tlScope defaults itself ONCE per whole page lifetime (renderTimeLog
    // only sets it when still null), same pattern as _tlYear, so it has to
    // be reset here too or whichever role happened to render first "wins"
    // the default for every later test regardless of who's actually
    // signed in, e.g. an earlier manager test leaving scope on 'me' would
    // silently filter the owner's own "sees everyone" test down to one person.
    await page.evaluate(() => { _tlYear = null; _tlScope = null; });
  });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 89901 && c.id !== 89902);
      bids    = bids.filter(b => b.id !== 88801);
      jobs    = jobs.filter(j => j.id !== 87701 && j.id !== 87702);
      timeEntries = timeEntries.filter(e => e.job_id !== 87701 && e.job_id !== 87702);
    });
    await page.context().close();
  });

  test.describe('_tlJobClientInfo', () => {
    test('job with bid, resolves client name/addr through the bid', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87701));
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.addr).toBe('1 Timelog St, Wichita KS 67202');
    });

    test('job with no bid, resolves client directly via job.client_id', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87702));
      expect(r.clientName).toBe('Timelog No-Bid Client');
    });

    test('nonexistent jobId, returns em-dash placeholders, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlJobClientInfo(999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v.jobName).toBe('-');
    });

    test('null jobId, does not throw', async () => {
      const r = await page.evaluate(() => { try { _tlJobClientInfo(null); return true; } catch (e) { return false; } });
      expect(r).toBe(true);
    });

    test('bid.addr (job-site address) takes precedence over the client\'s billing address, property managers/multi-site accounts', async () => {
      const r = await page.evaluate(() => {
        bids.push({ id: 889011, client_id: 89901, client_name: 'Timelog Test Client', amount: 500, status: 'Closed Won', bid_date: '2026-01-01', addr: '99 Job Site Rd, Wichita KS 67203' });
        jobs.push({ id: 877011, client_id: 89901, bid_id: 889011, name: 'Job-site addr test', eventType: 'job', status: 'scheduled', start: '2099-06-01', actualHours: 0 });
        try { return _tlJobClientInfo(877011); }
        finally { bids = bids.filter(b => b.id !== 889011); jobs = jobs.filter(j => j.id !== 877011); }
      });
      expect(r.addr).toBe('99 Job Site Rd, Wichita KS 67203');
    });

    test('falls back to job.addr when there\'s no bid-level address', async () => {
      const r = await page.evaluate(() => {
        jobs.push({ id: 877012, client_id: 89901, bid_id: null, name: 'Job addr fallback test', eventType: 'job', status: 'scheduled', start: '2099-06-01', actualHours: 0, addr: '42 Snapshot Ave, Wichita KS 67204' });
        try { return _tlJobClientInfo(877012); }
        finally { jobs = jobs.filter(j => j.id !== 877012); }
      });
      expect(r.addr).toBe('42 Snapshot Ave, Wichita KS 67204');
    });

    // Root cause (owner report 2026-08-21, "if at a job it says the address
    // but still"): jobs[].id is a local NUMBER (_newId()), but a GPS auto
    // row's job_id comes back from Supabase (job_time_entries, written by
    // both _geoCloseEntry and _geoReconcileFromMileage as String(jobId)) as
    // a STRING. A strict === silently missed the match on every auto/
    // reconciled row and blanked the address. Same String() coercion the
    // rest of the app already uses at this exact boundary (js/geo-track.js
    // _notifyArrival's job lookup, js/cloud.js, js/dashboard.js).
    test('resolves the address when jobId arrives as a STRING (the shape a Supabase job_time_entries row actually carries)', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(String(87701)));
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.addr).toBe('1 Timelog St, Wichita KS 67202');
    });
  });

  test.describe('_timeLogRows', () => {
    test('golden path, includes manual entries with resolved client/job info', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const mine = rows.find(x => x.id === 'm8990001');
        return mine ? { found: true, clientName: mine.clientName, source: mine.source, minutes: mine.minutes, personName: mine.personName } : { found: false };
      });
      expect(r.found).toBe(true);
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.source).toBe('manual');
      expect(r.minutes).toBe(90);
      expect(r.personName).toBe('Owner (me)');
    });

    test('carries logged_by_uid through as personUid (employee attribution)', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const theirs = rows.find(x => x.id === 'm8990002');
        return theirs ? { personUid: theirs.personUid, personName: theirs.personName } : null;
      });
      expect(r).toBeTruthy();
      expect(r.personUid).toBe('emp-test-uid');
      expect(r.personName).toBe('Test Crew Member');
    });

    test('sinceISO null, includes entries from every seeded year', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        return rows.filter(x => ['m8990001', 'm8990002', 'm8990003', 'm8990004'].includes(x.id)).length;
      });
      expect(r).toBe(4);
    });

    test('empty timeEntries and no crew data, resolves to empty array, no throw', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [];
        try { const rows = await _timeLogRows(null); return { ok: true, len: rows.length }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { timeEntries = orig; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBe(0);
    });

    test('concurrent calls, no throw, no corruption', async () => {
      const r = await page.evaluate(async () => {
        try {
          const results = await Promise.all([_timeLogRows(null), _timeLogRows(null), _timeLogRows(null)]);
          return { ok: true, allSameLength: results.every(x => x.length === results[0].length) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.allSameLength).toBe(true);
    });

    test('still-open (currently clocked in) entries are excluded, they belong in the banner, not the history', async () => {
      const r = await page.evaluate(async () => {
        timeEntries.push({ id: 8990099, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try {
          const rows = await _timeLogRows(null);
          return { ok: true, found: rows.some(x => x.rawId === 8990099) };
        } finally { timeEntries = timeEntries.filter(e => e.id !== 8990099); }
      });
      expect(r.ok).toBe(true);
      expect(r.found).toBe(false);
    });

    test('manual entries carry startTime/endTime through for the Clock In / Clock Out columns', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const mine = rows.find(x => x.id === 'm8990001');
        return mine ? { startTime: mine.startTime, hasEndTime: mine.endTime != null } : null;
      });
      expect(r).toBeTruthy();
      expect(r.startTime).toBeTruthy();
      expect(r.hasEndTime).toBe(true);
    });

    // Owner request 2026-08-23: a 'stop' source crew row (lunch/off-job time,
    // already flagged by the pre-existing _geoIsOffJobSource, the same
    // function Crew Cost already excludes with) must carry unpaid:true so
    // the row renders and everything downstream (_tlComputeOT,
    // _tlComputeWeeklyRunning) knows to skip it.
    // The stop sits between two same-day geofence visits (the anchor rule,
    // owner 2026-08-24: an unpaid stop only renders when it's provably
    // BETWEEN work): unanchored variants are covered separately below.
    test('a crew "stop" source row is tagged unpaid:true', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member' },
          entries: [{
            employee_user_id: 'emp-test-uid', job_id: 'anchor-job', dest_place: null,
            source: 'geofence', minutes: 160, client_key: null,
            arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:40:00.000Z',
          }, {
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'Sonic Drive-In',
            source: 'stop', minutes: 43, client_key: null,
            arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T17:25:00.000Z',
          }, {
            employee_user_id: 'emp-test-uid', job_id: 'anchor-job', dest_place: null,
            source: 'geofence', minutes: 150, client_key: null,
            arrived_at: '2026-08-21T17:30:00.000Z', departed_at: '2026-08-21T20:00:00.000Z',
          }],
        });
        try { const rows = await _timeLogRows(null); return rows.find(x => x.clientName === 'Sonic Drive-In'); }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r).toBeTruthy();
      expect(r.unpaid).toBe(true);
    });




    test('shop before + supply house after renders (the real supply-run shape)', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member' },
          entries: [{
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'Sonic Drive-In',
            source: 'stop', minutes: 43, client_key: null,
            arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T17:25:00.000Z',
          }, {
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'The Home Depot',
            source: 'place', minutes: 20, client_key: null,
            arrived_at: '2026-08-21T17:30:00.000Z', departed_at: '2026-08-21T17:50:00.000Z',
          }],
          shopEntries: [
            { employee_user_id: 'emp-test-uid', minutes: 60, arrived_at: '2026-08-21T15:30:00.000Z', departed_at: '2026-08-21T16:30:00.000Z' },
          ],
        });
        try { const rows = await _timeLogRows(null); return { hit: !!rows.find(x => x.clientName === 'Sonic Drive-In') }; }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r.hit).toBe(true);
    });


    test('a normal (non-stop) crew source row is not tagged unpaid', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member' },
          entries: [{
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'A Real Client Stop',
            source: 'geofence-reconciled', minutes: 60, client_key: null,
            arrived_at: '2026-08-21T09:00:00.000Z', departed_at: '2026-08-21T10:00:00.000Z',
          }],
        });
        try { const rows = await _timeLogRows(null); return rows.find(x => x.clientName === 'A Real Client Stop'); }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r).toBeTruthy();
      expect(r.unpaid).toBe(false);
    });
  });

  // Owner request 2026-08-24 ("why are there gaps between them"): shop/yard
  // dwell was tracked and paid in Crew Cost but never listed here, so every
  // hour at the yard read as a hole. It now renders as its own row kind.
  //
  // Three owner reports the same day bounded it into a WORKDAY WINDOW
  // (js/geo-track.js _geoShopCutoffs):
  //   "don't want shop time to calculate after the last job site or supply
  //    run of the day"                                  → the day clocks out
  //   yard dwell on days with no job or supply fence at all was showing
  //                                                     → no work, no shift
  //   "08/21 shouldn't have shop at 6:05 am, why does it?"
  //                                                     → the day clocks IN
  // and one that decided what counts as work at either edge: a 6:26pm leg
  // reading "Civitan Day Camp to Shop" was holding Tue 8/18 open to 7:44pm
  // purely because it was a drive. Drives now count only when chained to a
  // job or supply visit, the ride out or the ride back.
  test.describe('shop rows', () => {
    const withShop = (shopEntries, entries) => page.evaluate(async ([shopEntries, entries]) => {
      if (typeof timeEntries === 'undefined') window.timeEntries = [];
      const orig = window._fetchCrewLabor;
      window._fetchCrewLabor = async () => ({ name: { me: 'Logan Sample' }, entries: entries || [], shopEntries });
      try { return await _timeLogRows(null); } finally { window._fetchCrewLabor = orig; }
    }, [shopEntries, entries]);

    // One ordinary day in Central time (UTC-5 on this date):
    //   06:30-07:30  yard, before the day opens          → zero
    //   07:30-08:00  drive out to the job (opens the day)
    //   08:00-12:00  on site
    //   12:00-13:00  yard, between two jobs              → paid
    //   13:00-16:00  on site
    //   16:00-16:30  drive back to the yard (closes the day)
    //   16:30-23:48  phone sitting at the yard           → zero
    const YARD_AM = { employee_user_id: 'me', minutes: 60, arrived_at: '2026-08-20T11:30:00Z', departed_at: '2026-08-20T12:30:00Z' };
    const YARD_MID = { employee_user_id: 'me', minutes: 60, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T18:00:00Z' };
    const YARD_PM = { employee_user_id: 'me', minutes: 438, arrived_at: '2026-08-20T21:30:00Z', departed_at: '2026-08-21T04:48:00Z' };
    const DRIVE_OUT = { employee_user_id: 'me', job_id: null, minutes: 30, arrived_at: '2026-08-20T12:30:00Z', departed_at: '2026-08-20T13:00:00Z', source: 'drive' };
    const JOB = { employee_user_id: 'me', job_id: '9', minutes: 240, arrived_at: '2026-08-20T13:00:00Z', departed_at: '2026-08-20T17:00:00Z', source: 'geofence' };
    const JOB2 = { employee_user_id: 'me', job_id: '9', minutes: 180, arrived_at: '2026-08-20T18:00:00Z', departed_at: '2026-08-20T21:00:00Z', source: 'geofence' };
    const DRIVE_HOME = { employee_user_id: 'me', job_id: null, minutes: 30, arrived_at: '2026-08-20T21:00:00Z', departed_at: '2026-08-20T21:30:00Z', source: 'drive' };
    const DAY = [DRIVE_OUT, JOB, JOB2, DRIVE_HOME];
    // Yard time counts only when a departure closes it, so the arithmetic
    // tests below (merge, overlap, clip) need somebody leaving afterwards or
    // they are measuring a parked truck. EXIT(iso) is that departure.
    const EXIT = (iso) => ({ employee_user_id: 'me', job_id: null, minutes: 10, arrived_at: iso,
      departed_at: new Date(Date.parse(iso) + 600000).toISOString(), source: 'drive' });

    test('yard time inside the workday is paid and listed', async () => {
      const rows = await withShop([YARD_MID], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'the midday yard stop is listed').toBe(1);
      // "Shop time", not "Shop" (owner 2026-08-29): every badge on this table
      // names a block of time, so they all end in the same word.
      expect(shop[0].detail).toBe('Shop time');
      expect(shop[0].minutes).toBe(60);
      expect(shop[0].unpaid, 'inside the workday, so it counts').toBe(false);
    });








    test('a drive inside the workday is never dropped', async () => {
      const MID = { employee_user_id: 'me', job_id: null, minutes: 7, dest_place: 'DEV A shop',
        arrived_at: '2026-08-20T17:10:00Z', departed_at: '2026-08-20T17:17:00Z', source: 'drive-unassigned' };
      const rows = await withShop([], DAY.concat([MID]));
      const drives = rows.filter(r => r.rawSource && /^drive/.test(r.rawSource));
      expect(drives.length, 'a leg between two jobs is ordinary work').toBe(3);
    });








    // ── THE VISIT YOU ARE STANDING IN ANCHORS THE DAY ────────────────────
    // Owner report 2026-08-31: 4h41m of shop time, a logged drive, and him
    // parked at a client since 7:58am, and the Time Log rendered an empty
    // day. The window is built from CLOSED rows and he had not left yet, so
    // the day had no anchor and every finished row on it was judged outside a
    // workday that was never allowed to start.
    //
    // Asserted on the WINDOW, not on a rendered row: the anchor lands on
    // TODAY by construction (its departed_at is now), and every other test in
    // this file pins a fixed historical date, which is exactly what keeps
    // them isolated from it.
    // Bare identifiers, never window.*: these are module-level `let` bindings
    // in a classic script, so they live in the global LEXICAL scope and are
    // reachable by name from here but are not properties of window. Assigning
    // window._geoArrivedAt makes a second, unrelated property and the engine
    // never sees it, which is exactly how the first cut of these tests failed.
    // Offsets in MINUTES, resolved to instants inside the page, and every
    // instant the assertions use comes back out of the same evaluate.
    // mockAllExternal pins the page's clock and the Playwright runner's is not
    // pinned (CLAUDE.md §5.2.2), so a fixture built here from Date.now() and
    // compared against a window built there is two clocks and hours of drift.
    // The first cut of these tests did exactly that and failed by 36 minutes.
    const withOpen = (page, state) => page.evaluate((st) => {
      const saved = { u: _supaUser, j: _geoArrivedAt,
                      p: _geoPlaceArrivedAt, c: _geoClientArrivedAt };
      const ago = (m) => (m == null ? null : new Date(Date.now() - m * 60000).toISOString());
      try {
        const jobAt = st.jobMin != null ? ago(st.jobMin) : null;
        const placeAt = st.placeMin != null ? ago(st.placeMin) : null;
        const clientAt = st.badClient ? 'not-a-date' : (st.clientMin != null ? ago(st.clientMin) : null);
        _supaUser = st.noUser ? null : { id: 'me' };
        _geoArrivedAt = jobAt;
        _geoPlaceArrivedAt = placeAt;
        _geoClientArrivedAt = clientAt;
        const rows = (st.driveFromMin != null && st.driveToMin != null)
          ? [{ employee_user_id: 'me', source: 'drive-unassigned',
               arrived_at: ago(st.driveFromMin), departed_at: ago(st.driveToMin) }]
          : [];
        // Keyed by the ARRIVAL's Central day, never by today's. The window is
        // per person per day, and a fixture written as "90 minutes ago" sits
        // on YESTERDAY whenever the clock is near midnight, which is precisely
        // what the midnight-clock job runs at (TD_CLOCK_AT=00:20). Reading
        // today's key then finds only the anchor's `now` edge and the test
        // fails for the calendar rather than for the code. An open visit that
        // straddles midnight legitimately widens both days; the arrival's day
        // is the one these assertions are about.
        const anchorAt = jobAt || placeAt || (Date.parse(clientAt || '') > 0 ? clientAt : null);
        const key = (typeof _bizDateStr === 'function')
          ? _bizDateStr(new Date(anchorAt || Date.now())) : null;
        const w = _geoShopCutoffs(rows);
        const mine = (w.me || {})[key] || null;
        const open = (typeof _geoOpenVisitAnchor === 'function') ? _geoOpenVisitAnchor() : undefined;
        return { win: mine ? { inMs: mine.inMs, outMs: mine.outMs } : null,
                 openSource: open ? open.source : null, openArr: open ? open.arrived_at : null,
                 jobAt, placeAt, clientAt, now: Date.now(),
                 driveFrom: rows.length ? Date.parse(rows[0].arrived_at) : null };
      } finally {
        _supaUser = saved.u; _geoArrivedAt = saved.j;
        _geoPlaceArrivedAt = saved.p; _geoClientArrivedAt = saved.c;
      }
    }, state);










    test('a zero-length or malformed shop session is skipped', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 0, arrived_at: '2026-08-20T17:33:52Z', departed_at: '2026-08-20T17:33:52Z' },
        { employee_user_id: 'me', minutes: 5, arrived_at: null, departed_at: '2026-08-20T18:00:00Z' },
        { employee_user_id: 'me', minutes: 5, arrived_at: '2026-08-20T18:00:00Z', departed_at: null },
      ], DAY);
      expect(rows.filter(r => r.source === 'shop').length).toBe(0);
    });




    // The other Tue 8/18 pair looks identical to the eye but is not one visit:
    // he left the yard for the job in between, so folding them would swallow
    // that drive.
    test('a merge that would swallow a drive is refused', async () => {
      // The leg pulls out as the first session ends and lands as the second
      // begins, so the two yard stretches are five minutes apart (inside the
      // blip window) but genuinely separated by a trip.
      const OUT = { employee_user_id: 'me', job_id: null, minutes: 5, arrived_at: '2026-08-20T18:39:00Z', departed_at: '2026-08-20T18:44:00Z', source: 'drive' };
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 39, arrived_at: '2026-08-20T18:00:00Z', departed_at: '2026-08-20T18:39:00Z' },
        { employee_user_id: 'me', minutes: 11, arrived_at: '2026-08-20T18:44:00Z', departed_at: '2026-08-20T18:55:00Z' },
      ], [DRIVE_OUT, JOB, OUT, EXIT('2026-08-20T18:55:00Z'), JOB2, DRIVE_HOME]);
      const shop = rows.filter(r => r.source === 'shop').sort((a, b) => a.startTime.localeCompare(b.startTime));
      expect(shop.length, 'two visits with a drive between them stay two rows').toBe(2);
      expect(shop.map(r => r.minutes), 'and neither is stretched over the leg').toEqual([39, 11]);
    });





    test('two yard visits a real break apart stay two rows, both paid in full', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 30, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T17:30:00Z' },
        { employee_user_id: 'me', minutes: 20, arrived_at: '2026-08-20T17:40:00Z', departed_at: '2026-08-20T18:00:00Z' },
      ], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'a ten-minute break is longer than a fence blip').toBe(2);
      expect(shop.reduce((s, r) => s + r.minutes, 0)).toBe(50);
    });




    test('shop minutes land in their own bucket, never inflating job-site labor', async () => {
      const agg = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'me', personName: 'Logan', source: 'auto', rawSource: 'geofence', detail: '', minutes: 268 },
        { personUid: 'me', personName: 'Logan', source: 'auto', rawSource: 'drive', detail: 'Driving', minutes: 9 },
        { personUid: 'me', personName: 'Logan', source: 'shop', rawSource: 'shop', detail: 'Shop', minutes: 44, unpaid: false },
      ], 'me'));
      const e = agg.me;
      expect(e.onsiteMin, 'shop time is not job-site time').toBe(268);
      expect(e.driveMin).toBe(9);
      expect(e.shopMin).toBe(44);
      expect(e.min).toBe(321);
    });

    test('an unpaid row of any kind still contributes nothing', async () => {
      const agg = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'me', personName: 'Logan', source: 'auto', detail: '', minutes: 268 },
        { personUid: 'me', personName: 'Logan', source: 'shop', detail: 'Shop', minutes: 44, unpaid: true },
      ], 'me'));
      expect(agg.me.shopMin || 0).toBe(0);
      expect(agg.me.min).toBe(268);
    });
  });

  // Owner report 2026-08-24 (Fri 8/21 screenshot): on site to 11:37, unpaid
  // lunch 11:42-12:31, back on site 12:45, so 5 then 14 minutes of the day
  // belonged to no row. Those are the drives to and from the stop, dropped
  // from mileage because a lunch run is not deductible, and the owner's call
  // was "the unpaid time leg should absorb that 5 minutes."
  // ── The day must be continuous (owner 2026-08-29) ───────────────────────────
  // "just want time in order... then show unaccounted for time in between,
  // then arrival at Laurie's, unaccounted for time in between, arrival at
  // Laurie's then drive time home, that ends the day."
  //
  // Jack's real 8/28 is the fixture: he left Laurie's at 12:14 and came back
  // at 13:58, and those 104 minutes produced no row of any kind, so the Time
  // Log jumped from one visit straight to the next and the day silently
  // failed to add up.
  test.describe('unaccounted time is shown, never hidden', () => {
    const JACK = () => ([
      { id: 'd1', personUid: 'jack', date: '2026-08-28', minutes: 3, unpaid: false, source: 'auto',
        startTime: '2026-08-28T14:46:00Z', endTime: '2026-08-28T14:49:00Z' },   // house -> Laurie's
      { id: 'v1', personUid: 'jack', date: '2026-08-28', minutes: 11, unpaid: false, source: 'auto',
        startTime: '2026-08-28T14:49:00Z', endTime: '2026-08-28T15:00:00Z' },   // at Laurie's
      { id: 'v2', personUid: 'jack', date: '2026-08-28', minutes: 99, unpaid: false, source: 'auto',
        startTime: '2026-08-28T15:35:00Z', endTime: '2026-08-28T17:14:00Z' },   // back at Laurie's
      { id: 'v3', personUid: 'jack', date: '2026-08-28', minutes: 16, unpaid: false, source: 'auto',
        startTime: '2026-08-28T18:58:00Z', endTime: '2026-08-28T19:14:00Z' },   // back again
      { id: 'd2', personUid: 'jack', date: '2026-08-28', minutes: 4, unpaid: false, source: 'auto',
        startTime: '2026-08-28T19:14:00Z', endTime: '2026-08-28T19:18:00Z' },   // Laurie's -> home
    ]);
    const fill = rows => page.evaluate(r => _tlFillUnaccounted(r), rows);

    test('the day reads in order with every hole named, and nothing is merged', async () => {
      const r = await fill(JACK());
      const day = r.slice().sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
      // Exactly the owner's sequence: drive, arrival, hole, arrival, hole,
      // arrival, drive home. Seven lines, and the day ends.
      expect(day.map(x => x.source)).toEqual([
        'auto', 'auto', 'unaccounted', 'auto', 'unaccounted', 'auto', 'auto',
      ]);
      const gaps = day.filter(x => x.source === 'unaccounted');
      // 15:00 to 15:35 is the parts run; 17:14 to 18:58 is the 104 minutes
      // that vanished on the real day.
      expect(gaps.map(x => x.minutes)).toEqual([35, 104]);
      // NOT merged: all three visits survive as their own rows.
      expect(day.filter(x => ['v1', 'v2', 'v3'].includes(x.id)).length).toBe(3);
      // The day now adds up: first row start to last row end, no silent hole.
      const span = (Date.parse(day[day.length - 1].endTime) - Date.parse(day[0].startTime)) / 60000;
      expect(day.reduce((n, x) => n + x.minutes, 0)).toBe(span);
    });

    test('a gap row is display only: never paid, never editable, never fixable', async () => {
      const r = await fill(JACK());
      const gap = r.find(x => x.source === 'unaccounted');
      const flags = await page.evaluate(g => ({
        edit: _tlCanEdit(g), fix: _tlCanFixAuto(g),
      }), gap);
      expect(gap.unpaid, 'a hole is never paid time').toBe(true);
      expect(gap.rawId, 'no server row stands behind it').toBe(null);
      expect(flags.edit).toBe(false);
      expect(flags.fix).toBe(false);
    });

    test('rounding seams and overlaps never manufacture a hole', async () => {
      const r = await page.evaluate(() => {
        const base = (id, a, b, extra) => Object.assign({
          id, personUid: 'jack', date: '2026-08-28', unpaid: false, source: 'auto',
          minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000), startTime: a, endTime: b,
        }, extra || {});
        return {
          // A 3-minute seam is rounding, under the 5-minute floor.
          seam: _tlFillUnaccounted([
            base('x', '2026-08-28T14:00:00Z', '2026-08-28T15:00:00Z'),
            base('y', '2026-08-28T15:03:00Z', '2026-08-28T16:00:00Z'),
          ]).filter(x => x.source === 'unaccounted').length,
          // A drive that overlaps the visit it lands in must not produce a
          // negative gap, and a short row nested inside a long one must not
          // split the long one's remainder into two phantom holes.
          nested: _tlFillUnaccounted([
            base('long', '2026-08-28T14:00:00Z', '2026-08-28T18:00:00Z'),
            base('inner', '2026-08-28T15:00:00Z', '2026-08-28T15:30:00Z'),
          ]).filter(x => x.source === 'unaccounted').length,
          overlap: _tlFillUnaccounted([
            base('a', '2026-08-28T14:00:00Z', '2026-08-28T15:10:00Z'),
            base('b', '2026-08-28T15:00:00Z', '2026-08-28T16:00:00Z'),
          ]).filter(x => x.source === 'unaccounted').length,
          // Two people on the same day never bleed into each other.
          twoPeople: _tlFillUnaccounted([
            base('p1', '2026-08-28T14:00:00Z', '2026-08-28T15:00:00Z'),
            Object.assign(base('p2', '2026-08-28T19:00:00Z', '2026-08-28T20:00:00Z'), { personUid: 'other' }),
          ]).filter(x => x.source === 'unaccounted').length,
        };
      });
      expect(r.seam).toBe(0);
      expect(r.nested).toBe(0);
      expect(r.overlap).toBe(0);
      expect(r.twoPeople).toBe(0);
    });

    // Owner 2026-09-03: "there should be gaps between them if it was opened
    // and then backgrounded, time should start when app flips open and stop
    // and write when app flips to background, there should be no unaccounted
    // for blips in between." js/geo-derive.js _gdOffice already bounds each
    // Office row to exactly one app-open -> app-background span (_gdAppOpen),
    // so a real gap between two Office rows on the same day IS the app being
    // closed, proven by those same flips. "No location or motion on record"
    // is a lie about a fact the deriver actually has, so this one adjacency
    // is the one hole the fill pass must leave alone.
    test('a gap between two Office rows is the app closing, not a question', async () => {
      const office = (id, a, b) => ({
        id, personUid: 'jack', date: '2026-09-02', unpaid: false, source: 'auto', rawSource: 'place-office',
        minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000), startTime: a, endTime: b,
      });
      const r = await page.evaluate((rows) => _tlFillUnaccounted(rows).map(x => x.source), [
        office('o1', '2026-09-02T12:00:00Z', '2026-09-02T12:05:00Z'),   // app open 7:00-7:05 CT
        office('o2', '2026-09-02T13:00:00Z', '2026-09-02T13:05:00Z'),   // app open again an hour later
      ]);
      expect(r.sort()).toEqual(['auto', 'auto']);   // no 'unaccounted' row between them
    });

    test('the same gap IS flagged when only one side is an Office row', async () => {
      const office = (id, a, b) => ({
        id, personUid: 'jack', date: '2026-09-02', unpaid: false, source: 'auto', rawSource: 'place-office',
        minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000), startTime: a, endTime: b,
      });
      const auto = (id, a, b) => ({
        id, personUid: 'jack', date: '2026-09-02', unpaid: false, source: 'auto', rawSource: 'client',
        minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000), startTime: a, endTime: b,
      });
      const r = await page.evaluate((rows) => _tlFillUnaccounted(rows).map(x => x.source), [
        office('o1', '2026-09-02T12:00:00Z', '2026-09-02T12:05:00Z'),
        auto('c1', '2026-09-02T13:00:00Z', '2026-09-02T13:05:00Z'),
      ]);
      expect(r).toEqual(['auto', 'auto', 'unaccounted']);
    });

    test('a hole is free until it is added, then it counts like any manual entry', async () => {
      const r = await page.evaluate(() => {
        const saved = { te: timeEntries.slice(), save: window.saveAll, cloud: window.supaSaveToCloud,
                        toast: window.showToast, render: window.renderTimeLog };
        try {
          window.saveAll = () => {}; window.supaSaveToCloud = () => {};
          window.showToast = () => {}; window.renderTimeLog = () => {};
          const rows = _tlFillUnaccounted([
            { id: 'v1', personUid: null, date: '2026-08-28', minutes: 99, unpaid: false, source: 'auto',
              startTime: '2026-08-28T15:35:00Z', endTime: '2026-08-28T17:14:00Z' },
            { id: 'v2', personUid: null, date: '2026-08-28', minutes: 16, unpaid: false, source: 'auto',
              startTime: '2026-08-28T18:58:00Z', endTime: '2026-08-28T19:14:00Z' },
          ]);
          const gap = rows.find(x => x.source === 'unaccounted');
          // Before: the hole is on the page but contributes nothing paid.
          const paidBefore = rows.filter(x => !x.unpaid).reduce((n, x) => n + x.minutes, 0);
          const agg = _tlEmpWeekAgg(rows, 'cid');
          const before = timeEntries.length;
          _tlAddUnaccounted(gap.startTime, gap.endTime);
          const added = timeEntries[timeEntries.length - 1];
          return {
            gapMins: gap.minutes, paidBefore,
            aggMin: Object.values(agg).reduce((n, e) => n + e.min, 0),
            wrote: timeEntries.length - before,
            addedMin: added.minutes, addedStart: added.start_time, addedEnd: added.end_time,
            addedDate: added.date, addedJob: added.job_id, addedOpen: added.open,
            addedLabel: added.scope_label,
          };
        } finally {
          timeEntries.length = 0; saved.te.forEach(x => timeEntries.push(x));
          window.saveAll = saved.save; window.supaSaveToCloud = saved.cloud;
          window.showToast = saved.toast; window.renderTimeLog = saved.render;
        }
      });
      // The hole is 104 minutes and NONE of it counts before it is added.
      expect(r.gapMins).toBe(104);
      expect(r.paidBefore).toBe(115);          // 99 + 16, the hole excluded
      expect(r.aggMin).toBe(115);              // and the week agg agrees
      // Adding writes ONE manual row covering exactly the hole.
      expect(r.wrote).toBe(1);
      expect(r.addedMin).toBe(104);
      expect(r.addedStart).toBe('2026-08-28T17:14:00.000Z');
      expect(r.addedEnd).toBe('2026-08-28T18:58:00.000Z');
      expect(r.addedJob, 'nothing is invented about WHICH job it was').toBe(null);
      expect(r.addedOpen).toBe(false);
      expect(r.addedLabel).toBe('Added from unaccounted time');
    });

    test('_tlAddUnaccounted refuses a window that is backwards, zero or unparseable', async () => {
      const r = await page.evaluate(() => {
        const saved = { te: timeEntries.slice(), save: window.saveAll, cloud: window.supaSaveToCloud,
                        toast: window.showToast, render: window.renderTimeLog };
        try {
          window.saveAll = () => {}; window.supaSaveToCloud = () => {};
          window.showToast = () => {}; window.renderTimeLog = () => {};
          const before = timeEntries.length;
          _tlAddUnaccounted('2026-08-28T18:00:00Z', '2026-08-28T17:00:00Z');  // backwards
          _tlAddUnaccounted('2026-08-28T18:00:00Z', '2026-08-28T18:00:00Z');  // zero
          _tlAddUnaccounted('nope', 'also nope');
          _tlAddUnaccounted(null, undefined);
          return { wrote: timeEntries.length - before };
        } finally {
          timeEntries.length = 0; saved.te.forEach(x => timeEntries.push(x));
          window.saveAll = saved.save; window.supaSaveToCloud = saved.cloud;
          window.showToast = saved.toast; window.renderTimeLog = saved.render;
        }
      });
      expect(r.wrote).toBe(0);
    });

  });



  // Owner report 2026-08-24: a GPS visit read "1:06pm to 9:37pm" because the
  // app woke at 9:37 and stamped the close with `now`, and nothing in the app
  // could correct it. On-site GPS rows are now fixable by anyone with payroll
  // permission; drive rows and unpaid stops are not.
  test.describe('_tlCanFixAuto / _openFixAutoEntry', () => {
    const withComp = (fn) => page.evaluate(async (body) => {
      const saved = window._canViewComp;
      window._canViewComp = () => true;
      try { return await eval('(' + body + ')')(); } finally { window._canViewComp = saved; }
    }, fn.toString());

    test('on-site GPS rows are fixable, drive rows and stops are not', async () => {
      const r = await withComp(() => {
        const R = (o) => Object.assign({ source: 'auto', rawId: 'x1', rawSource: 'place', unpaid: false }, o);
        return {
          place: _tlCanFixAuto(R({})),
          geofence: _tlCanFixAuto(R({ rawSource: 'geofence' })),
          reconciled: _tlCanFixAuto(R({ rawSource: 'geofence-reconciled' })),
          drive: _tlCanFixAuto(R({ rawSource: 'drive-unassigned' })),
          stop: _tlCanFixAuto(R({ rawSource: 'stop', unpaid: true })),
          manualRow: _tlCanFixAuto(R({ source: 'manual' })),
          noServerId: _tlCanFixAuto(R({ rawId: null })),
        };
      });
      expect(r.place).toBe(true);
      expect(r.geofence).toBe(true);
      expect(r.reconciled).toBe(true);
      expect(r.drive, 'drive minutes follow the mileage leg, never a typed number').toBe(false);
      expect(r.stop, 'an unpaid stop is not payroll').toBe(false);
      expect(r.manualRow, 'manual rows use the existing edit path').toBe(false);
      expect(r.noServerId).toBe(false);
    });

    test('without payroll permission nothing is fixable', async () => {
      const r = await page.evaluate(() => {
        const saved = window._canViewComp;
        window._canViewComp = () => false;
        try { return _tlCanFixAuto({ source: 'auto', rawId: 'x1', rawSource: 'place', unpaid: false }); }
        finally { window._canViewComp = saved; }
      });
      expect(r, 'correcting a clock is a money decision').toBe(false);
    });

    // The real 8/12 row: 1:06pm arrival, flush-stamped 9:37pm close.
    const REAL = { id: 'af7136c6', arrived_at: '2026-08-12T18:06:57.587Z', departed_at: '2026-08-13T02:37:29.394Z', job_id: null, dest_place: 'John Doe' };
    const drive = (row, endIso) => page.evaluate(async ([row, endIso]) => {
      const saved = { cvc: window._canViewComp, supa: window._supa, user: window._supaUser, toast: window.showToast, render: window.renderTimeLog };
      const updates = [];
      window._canViewComp = () => true;
      window._supaUser = { id: 'u' };
      // CHAINABLE, not a fixed chain (2026-08-26). This spelled out
      // select -> eq -> maybeSingle exactly, and the query it backs now carries
      // .is('deleted_at',null) between the two. A literal mock turns a filter
      // being added into "is is not a function", which surfaces as an assertion
      // about a property of undefined three layers away from the real cause.
      const _sel = (data) => new Proxy(function () {}, {
        get: (_, k) => k === 'maybeSingle' || k === 'single'
          ? async () => ({ data, error: null })
          : k === 'then' ? (res, rej) => Promise.resolve({ data, error: null }).then(res, rej)
          : () => _sel(data),
      });
      window._supa = { from: () => ({
        select: () => _sel(row),
        update: (patch) => ({ eq: (c, v) => { updates.push({ patch, id: v }); return Promise.resolve({ error: null }); } }),
      }) };
      window.showToast = () => {}; window.renderTimeLog = () => {};
      try {
        await _openFixAutoEntry(row.id);
        const opened = !!document.getElementById('tlf-start');
        // Typed in BUSINESS time, which is what the dialog reads now and what
        // a person sitting in the truck actually types. Filling the field via
        // the runner's own zone was the same assumption that shifted the
        // owner's log an hour when he flew to Denver.
        if (endIso) document.getElementById('tlf-end').value = _tlBizInputValue(endIso);
        await _saveFixedAutoEntry(row.id);
        const err = document.getElementById('tlf-err');
        const out = { opened, updates, errShown: !!(err && err.style.display === 'block'), errMsg: err ? err.textContent : '' };
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return out;
      } finally {
        window._canViewComp = saved.cvc; window._supa = saved.supa; window._supaUser = saved.user;
        window.showToast = saved.toast; window.renderTimeLog = saved.render;
      }
    }, [row, endIso]);

    test('correcting the clock-out writes the new span and re-keys it as human-set', async () => {
      const r = await drive(REAL, '2026-08-12T22:15:00Z');
      expect(r.opened).toBe(true);
      expect(r.updates.length).toBe(1);
      expect(r.updates[0].id).toBe('af7136c6');
      expect(r.updates[0].patch.departed_at).toBe('2026-08-12T22:15:00.000Z');
      expect(r.updates[0].patch.minutes).toBe(249);
      expect(r.updates[0].patch.client_key, 'the fixed- key is what stops every sweep from widening it again').toBe('fixed-af7136c6');
    });

    test('a correction can never create a 24h+ entry or cross midnight', async () => {
      const tooLong = await drive(REAL, '2026-08-14T22:15:00Z');
      expect(tooLong.updates.length, 'refused, nothing written').toBe(0);
      expect(tooLong.errShown).toBe(true);
      expect(tooLong.errMsg).toContain('24 hours');
      // Same UTC day, but 1:06pm -> 11:30pm CT is still same Central day; use
      // a genuinely next-Central-day end to prove the day rule.
      const crosses = await drive(REAL, '2026-08-13T13:00:00Z');
      expect(crosses.updates.length).toBe(0);
      expect(crosses.errMsg).toContain('same day');
    });

    test('an end at or before the start is refused', async () => {
      // One minute BEFORE the 1:06pm Central arrival, in business time.
      const r = await drive(REAL, '2026-08-12T18:05:00Z');
      expect(r.updates.length).toBe(0);
      expect(r.errMsg).toContain('End must be after start');
    });
  });

  test.describe('_tlOpenEntries', () => {
    const OPEN_ID = 8990010;
    test.afterEach(async () => {
      await page.evaluate((id) => { timeEntries = timeEntries.filter(e => e.id !== id); }, OPEN_ID);
    });

    test('golden path, a clocked-in entry shows elapsed minutes and resolved client/job info', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 15 * 60000).toISOString(), end_time: null, minutes: null, open: true, scope_label: 'Sanding', logged_by_uid: null, logged_by_name: 'Owner (me)' });
        const rows = _tlOpenEntries();
        const mine = rows.find(x => x.rawId === id);
        return mine ? { found: true, clientName: mine.clientName, elapsedMin: mine.elapsedMin, detail: mine.detail } : { found: false };
      }, OPEN_ID);
      expect(r.found).toBe(true);
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.elapsedMin).toBeGreaterThanOrEqual(14);
      expect(r.detail).toBe('Sanding');
    });

    test('closed entries are excluded', async () => {
      const r = await page.evaluate(() => _tlOpenEntries().some(x => x.rawId === 8990001));
      expect(r).toBe(false);
    });

    test('no open entries, returns empty array, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, len: _tlOpenEntries().length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBe(0);
    });

    test('sorted oldest-first (earliest clock-in shown first)', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push(
          { id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 5 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: id + 1, job_id: 87702, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 30 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'emp-test-uid', logged_by_name: 'Test Crew Member' }
        );
        try { return _tlOpenEntries().map(x => x.rawId); }
        finally { timeEntries = timeEntries.filter(e => e.id !== id + 1); }
      }, OPEN_ID);
      expect(r.indexOf(OPEN_ID + 1)).toBeLessThan(r.indexOf(OPEN_ID));
    });

    test('missing/malformed start_time, does not throw', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: '', start_time: null, end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try { const rows = _tlOpenEntries(); return { ok: true, elapsed: rows.find(x => x.rawId === id)?.elapsedMin }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, OPEN_ID);
      expect(r.ok).toBe(true);
    });
  });

  test.describe('_tlYears', () => {
    test('golden path, distinct years, sorted newest first', async () => {
      const r = await page.evaluate(() => {
        const rows = [{ date: '2024-01-01' }, { date: '2026-05-01' }, { date: '2025-06-01' }, { date: '2026-08-01' }];
        return _tlYears(rows);
      });
      expect(r).toEqual(['2026', '2025', '2024']);
    });

    test('empty rows, falls back to the current calendar year', async () => {
      const r = await page.evaluate(() => _tlYears([]));
      expect(r).toEqual([String(new Date().getFullYear())]);
    });

    test('rows with missing/malformed dates, skipped, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlYears([{ date: '' }, { date: null }, { }, { date: 'not-a-date' }]) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual([String(new Date().getFullYear())]);
    });
  });

  test.describe('_tlWeekKey', () => {
    test('golden path, returns the Sunday of the week containing the date', async () => {
      // 2026-07-15 is a Wednesday; the Sunday before it is 2026-07-12.
      const r = await page.evaluate(() => _tlWeekKey('2026-07-15'));
      expect(r).toBe('2026-07-12');
    });

    test('a Sunday maps to itself', async () => {
      const r = await page.evaluate(() => _tlWeekKey('2026-07-12'));
      expect(r).toBe('2026-07-12');
    });

    test('week spanning a month boundary resolves correctly', async () => {
      // 2026-08-01 is a Saturday; its week starts 2026-07-26.
      const r = await page.evaluate(() => _tlWeekKey('2026-08-01'));
      expect(r).toBe('2026-07-26');
    });

    test('empty/null/malformed date, returns empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: [_tlWeekKey(''), _tlWeekKey(null), _tlWeekKey(undefined), _tlWeekKey('not-a-date')] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual(['', '', '', '']);
    });
  });

  test.describe('_tlComputeOT', () => {
    test('flags every row for a person whose week totals over 40 hours (2400 min)', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 1300 }, // Mon
          { personUid: 'u1', date: '2026-07-14', minutes: 1300 }, // Tue: total 2600 > 2400
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([true, true]);
    });

    test('does not flag a week at or under 40 hours', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 1200 },
          { personUid: 'u1', date: '2026-07-14', minutes: 1200 }, // total 2400, not over
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([false, false]);
    });

    test('different people in the same week are tracked independently', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 2500 },
          { personUid: 'u2', date: '2026-07-13', minutes: 100 },
        ];
        _tlComputeOT(rows);
        return { u1: rows[0].weekOT, u2: rows[1].weekOT };
      });
      expect(r.u1).toBe(true);
      expect(r.u2).toBe(false);
    });

    test('the same person\'s hours in different weeks do not combine', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-05', minutes: 1300 }, // week of 6/28
          { personUid: 'u1', date: '2026-07-13', minutes: 1300 }, // week of 7/12
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([false, false]);
    });

    test('null personUid (owner) is grouped as its own bucket, not mixed with employees', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: null, date: '2026-07-13', minutes: 2500 },
          { personUid: 'u1', date: '2026-07-13', minutes: 2500 },
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([true, true]);
    });

    test('empty array, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlComputeOT([]); return true; } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    // Owner request 2026-08-23: unpaid (lunch/off-job stop) minutes must
    // never push someone into overtime they never worked.
    test('unpaid rows are excluded from the weekly total, never trigger the OT flag on their own', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 2350 },
          { personUid: 'u1', date: '2026-07-13', minutes: 100, unpaid: true }, // would push total to 2450 if counted
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([false, false]);
    });

    test('an unpaid row on an otherwise-over-40-hours week still reads the flag (flag is per-week, not per-row-source)', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 2500 },
          { personUid: 'u1', date: '2026-07-14', minutes: 60, unpaid: true },
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([true, true]);
    });
  });

  test.describe('_tlComputeWeeklyRunning', () => {
    test('accumulates day-by-day through the week, chronologically, regardless of input order', async () => {
      const r = await page.evaluate(() => {
        // Deliberately out of order, newest first, matching how rows actually render.
        const rows = [
          { personUid: 'u1', date: '2026-07-15', minutes: 480 }, // Wed
          { personUid: 'u1', date: '2026-07-13', minutes: 480 }, // Mon
          { personUid: 'u1', date: '2026-07-14', minutes: 480 }, // Tue
        ];
        _tlComputeWeeklyRunning(rows);
        return rows.map(r => ({ date: r.date, running: r.weekRunningMin }));
      });
      const byDate = Object.fromEntries(r.map(x => [x.date, x.running]));
      expect(byDate['2026-07-13']).toBe(480);
      expect(byDate['2026-07-14']).toBe(960);
      expect(byDate['2026-07-15']).toBe(1440);
    });

    test('multiple entries the same day sum into that day\'s running total', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 200 },
          { personUid: 'u1', date: '2026-07-13', minutes: 100 },
        ];
        _tlComputeWeeklyRunning(rows);
        return rows.map(r => r.weekRunningMin);
      });
      expect(r).toEqual([300, 300]);
    });

    test('different people are tracked independently', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 500 },
          { personUid: 'u2', date: '2026-07-13', minutes: 100 },
        ];
        _tlComputeWeeklyRunning(rows);
        return { u1: rows[0].weekRunningMin, u2: rows[1].weekRunningMin };
      });
      expect(r.u1).toBe(500);
      expect(r.u2).toBe(100);
    });

    test('resets across a week boundary', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-11', minutes: 480 }, // Sat, end of prior week
          { personUid: 'u1', date: '2026-07-12', minutes: 480 }, // Sun, new week starts
        ];
        _tlComputeWeeklyRunning(rows);
        return rows.map(r => r.weekRunningMin);
      });
      // Both entries are in DIFFERENT weeks, neither accumulates onto the other.
      expect(r).toEqual([480, 480]);
    });

    test('null personUid (owner) is its own bucket', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: null, date: '2026-07-13', minutes: 300 },
          { personUid: 'u1', date: '2026-07-13', minutes: 100 },
        ];
        _tlComputeWeeklyRunning(rows);
        return rows.map(r => r.weekRunningMin);
      });
      expect(r).toEqual([300, 100]);
    });

    test('empty array, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlComputeWeeklyRunning([]); return true; } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    test('rows with missing/malformed dates, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlComputeWeeklyRunning([{ personUid: 'u1', date: '', minutes: 30 }, { personUid: 'u1', date: null, minutes: 30 }]); return true; }
        catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    // Owner request 2026-08-23: the 08/21 example, morning + lunch + afternoon.
    // The running total after lunch must equal the running total before it,
    // and the afternoon total must add only the afternoon's own minutes.
    test('unpaid rows never feed the running weekly total, before or after they occur', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-08-21', minutes: 222 },              // 7:55-11:37
          { personUid: 'u1', date: '2026-08-21', minutes: 43, unpaid: true }, // 11:42-12:25 lunch
          { personUid: 'u1', date: '2026-08-21', minutes: 282 },              // 12:25-5:07
        ];
        _tlComputeWeeklyRunning(rows);
        return rows.map(r => r.weekRunningMin);
      });
      // All three rows share the same day, so the running total is the same
      // day-total figure on every row: 222 + 282 = 504, the lunch's 43 never counted.
      expect(r).toEqual([504, 504, 504]);
    });
  });

  test.describe('_tlFmtTime', () => {
    test('golden path, formats an ISO timestamp as a plain clock time', async () => {
      const r = await page.evaluate(() => _tlFmtTime('2026-07-13T13:05:00.000Z'));
      expect(r).toMatch(/\d{1,2}:\d{2}\s?[AP]M/i);
    });

    test('null/undefined/empty: returns empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: [_tlFmtTime(null), _tlFmtTime(undefined), _tlFmtTime('')] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual(['', '', '']);
    });

    test('malformed timestamp, returns empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlFmtTime('not-a-date') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('');
    });
  });

  test.describe('_tlExportCSV', () => {
    test('no rows for the selected year, shows a toast, does not call downloadFile', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let downloadCalled = false, toastMsg = null;
        window.downloadFile = () => { downloadCalled = true; };
        window.showToast = (msg) => { toastMsg = msg; };
        const origRows = _tlLastRows;
        _tlLastRows = [];
        try { _tlDoExportCSV(); return { downloadCalled, toastMsg }; }
        finally { _tlLastRows = origRows; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r.downloadCalled).toBe(false);
      expect(r.toastMsg).toContain('No time entries');
    });

    test('golden path, builds a CSV with header, escaped fields, and an OT marker', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let captured = null;
        window.downloadFile = (filename, content, type) => { captured = { filename, content, type }; };
        window.showToast = () => {};
        const origRows = _tlLastRows, origYear = _tlYear;
        _tlYear = '2026';
        _tlLastRows = [
          { date: '2026-07-13', personName: 'Owner (me)', clientName: 'Client, "The" Best', addr: '1 Main St', jobName: 'Job A', detail: 'Sanding', source: 'manual', minutes: 90, weekOT: false, weekRunningMin: 90, startTime: '2026-07-13T08:00:00.000Z', endTime: '2026-07-13T09:30:00.000Z' },
          { date: '2026-07-14', personName: 'Crew A', clientName: 'Other Client', addr: '', jobName: 'Job B', detail: '', source: 'auto', minutes: 2500, weekOT: true, weekRunningMin: 2500, startTime: '2026-07-14T08:00:00.000Z', endTime: null },
        ];
        try { _tlDoExportCSV(); return captured; }
        finally { _tlLastRows = origRows; _tlYear = origYear; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r).toBeTruthy();
      expect(r.type).toBe('text/csv');
      expect(r.filename).toContain('2026');
      expect(r.filename).toContain('.csv');
      expect(r.content).toContain('"Date","Person","Job Address","Client","Job","Task","Source","Clock In","Clock Out","Minutes","Duration","Week Total","Overtime"');
      // Embedded comma+quote in client name must be CSV-escaped, not break the row.
      expect(r.content).toContain('"Client, ""The"" Best"');
      expect(r.content).toContain('Auto (GPS)');
      expect(r.content).toContain('40+ hrs/wk');
      expect(r.content).toContain('"1 Main St"');
      expect(r.content).toContain('41h 40m'); // week-running total for the auto row (2500min)
      // A missing endTime (still-mid-fetch GPS row) must not throw or break the row.
      expect(r.content.split('\n').length).toBe(3); // header + 2 rows, no stray line breaks
    });

    test('rows are exported sorted by date', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let captured = null;
        window.downloadFile = (filename, content) => { captured = content; };
        window.showToast = () => {};
        const origRows = _tlLastRows, origYear = _tlYear;
        _tlYear = '2026';
        _tlLastRows = [
          { date: '2026-07-14', personName: 'B', clientName: '', addr: '', jobName: '', detail: '', source: 'manual', minutes: 30 },
          { date: '2026-07-10', personName: 'A', clientName: '', addr: '', jobName: '', detail: '', source: 'manual', minutes: 30 },
        ];
        try { _tlDoExportCSV(); return captured; }
        finally { _tlLastRows = origRows; _tlYear = origYear; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r.indexOf('2026-07-10')).toBeLessThan(r.indexOf('2026-07-14'));
    });
  });

  test.describe('_tlCanEdit', () => {
    const restore = async () => page.evaluate(() => {
      window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
    });
    test.afterEach(restore);

    test('auto (GPS) source, never editable, even for the owner', async () => {
      const r = await page.evaluate(() => _tlCanEdit({ source: 'auto', personUid: null }));
      expect(r).toBe(false);
    });

    test('auto (GPS) source, never editable, even with payroll permission', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'auto', personUid: 'emp-test-uid' });
      });
      expect(r).toBe(false);
    });

    test('manual entry, owner (non-employee) can always edit, including others\' entries', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(true);
    });

    test('manual entry, employee without payroll permission can edit their OWN entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'emp-test-uid' });
      });
      expect(r).toBe(true);
    });

    test('manual entry, employee without payroll permission CANNOT edit someone else\'s entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(false);
    });

    test('manual entry, employee WITH payroll permission can edit someone else\'s entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(true);
    });

    test('missing personUid/source: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlCanEdit({}) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(false);
    });
  });

  // The _tlRow describe block was DELETED with the function it tested (§7).
  // It covered the per-person day TABLE in Team, which is now that person's
  // weekly bars. The one behaviour in it that was not about a <tr>, the
  // 3-second hold-to-delete gesture and its _tlCanEdit gate, moved with the
  // gesture onto the rail row and is covered in
  // tests/e2e-timelog-team-bars.spec.js ('the 3-second hold moved onto the
  // rail row'). Everything else asserted markup that no longer exists.

  test.describe('_lpDoDelete(type="timelog"): long-press delete dispatch', () => {
    // Every other [data-lp-id] type is DEV-ONLY (gated on _canDelete()): see
    // tests/e2e-features.spec.js "long-press delete is DEV-ONLY". timelog is
    // the deliberate exception: real contractors/employees use this gesture,
    // so these tests prove it works WITHOUT the dev bypass flag.
    test('deletes a manual entry the caller owns, with NO _e2eAllowDelete / dev flag set', async () => {
      const r = await page.evaluate(() => {
        const id = 8990301;
        const savedFlag = window._e2eAllowDelete;
        window._e2eAllowDelete = false; // explicitly simulate a real, non-dev account
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: new Date().toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)', open: false });
        try { _lpDoDelete(String(id), 'timelog'); return { gone: !timeEntries.find(e => e.id === id) }; }
        finally { window._e2eAllowDelete = savedFlag; timeEntries = timeEntries.filter(e => e.id !== id); }
      });
      expect(r.gone).toBe(true);
    });

    test('does NOT delete someone else\'s entry when the caller lacks payroll permission (deleteTimeEntry\'s own check still applies)', async () => {
      const r = await page.evaluate(() => {
        const id = 8990302;
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: new Date().toISOString(), minutes: 30, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else', open: false });
        try { _lpDoDelete(String(id), 'timelog'); return { stillThere: !!timeEntries.find(e => e.id === id) }; }
        finally {
          window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
          timeEntries = timeEntries.filter(e => e.id !== id);
        }
      });
      expect(r.stillThere).toBe(true);
    });

    test('nonexistent id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _lpDoDelete('999999', 'timelog'); return true; } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    test('does not touch the dev-only hard-purge path for other types (no cross-contamination)', async () => {
      // Regression guard for the _lpDoDelete refactor: type='job' must still be
      // fully dev-gated after adding the timelog early-return.
      const r = await page.evaluate(() => {
        const jid = 8990303;
        const savedFlag = window._e2eAllowDelete;
        window._e2eAllowDelete = false;
        jobs = jobs.filter(j => j.id !== jid);
        jobs.push({ id: jid, client_id: 89901, name: 'LP Gate Regression Job', start: '2026-07-01', days: 1, eventType: 'job' });
        try { _lpDoDelete(String(jid), 'job'); return { stillThere: jobs.some(j => j.id === jid) }; }
        finally { window._e2eAllowDelete = savedFlag; jobs = jobs.filter(j => j.id !== jid); }
      });
      expect(r.stillThere).toBe(true);
    });
  });

  test.describe('_tlRenderOpenBanner / open-refresh lifecycle', () => {
    const OPEN_ID = 8990020;
    test.afterEach(async () => {
      await page.evaluate((id) => {
        timeEntries = timeEntries.filter(e => e.id !== id);
        window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
        if (typeof _tlStopOpenRefresh === 'function') _tlStopOpenRefresh();
        // _tlStartOpenRefresh now reconnects a running clock (a row can land
        // from the cloud after boot), so a test that calls it can leave a live
        // _activeTimer and its 1s interval behind for the rest of the file.
        if (typeof _activeTimer !== 'undefined' && _activeTimer) {
          clearInterval(_activeTimer.timerInterval); _activeTimer = null;
          if (typeof hideClockBanner === 'function') hideClockBanner();
        }
      }, OPEN_ID);
    });

    test('missing #tl-open DOM, no throw', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('tl-open');
        const id = el ? el.id : null;
        if (el) el.id = 'tl-open-hidden-temp';
        try { _tlRenderOpenBanner(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el) el.id = id; }
      });
      expect(r.ok).toBe(true);
    });

    test('no open entries, banner is hidden and empty', async () => {
      const r = await page.evaluate(() => {
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      });
      expect(r.display).toBe('none');
      expect(r.html).toBe('');
    });

    test('my own open entry, shown with person name, client, and elapsed time, with a real clockOut() button (not the manager force-close)', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 10 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      }, OPEN_ID);
      expect(r.display).toBe('block');
      expect(r.html).toContain('Currently clocked in');
      expect(r.html).toContain('Timelog Test Client');
      // Assertion changed 2026-08-31 (section 10.4). OLD: the own-row button
      // called clockOut() bare, which was correct only while _activeTimer was
      // guaranteed to hold this row. NEW: it calls clockOutEntry(id), which
      // adopts the row first and then runs the same clockOut(). The old
      // guarantee was never true after a reload, and the button was dead.
      expect(r.html).toContain('onclick="clockOutEntry(' + OPEN_ID + ');_tlRenderOpenBanner()"');
      expect(r.html).not.toContain('forceClockOutEntry'); // own entry never uses the manager force-close path
      expect(r.html).not.toContain('LONG SHIFT');
    });

    test('an entry open 10+ hours is flagged "LONG SHIFT" (likely a forgotten clock-out)', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 11 * 3600000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        return document.getElementById('tl-open').innerHTML;
      }, OPEN_ID);
      expect(r).toContain('LONG SHIFT');
    });

    test('an entry open under 10 hours is NOT flagged', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 2 * 3600000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        return document.getElementById('tl-open').innerHTML;
      }, OPEN_ID);
      expect(r).not.toContain('LONG SHIFT');
    });

    test('employee without payroll permission, cannot see someone else\'s open entry', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else' });
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      }, OPEN_ID);
      expect(r.display).toBe('none');
      expect(r.html).toBe('');
    });

    test('manager with payroll permission, sees others\' open entries with a "Clock out" force button', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else' });
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, hasForceBtn: el.innerHTML.includes('forceClockOutEntry(' + id + ')') };
      }, OPEN_ID);
      expect(r.display).toBe('block');
      expect(r.hasForceBtn).toBe(true);
    });

    test('_tlStartOpenRefresh sets a live interval; _tlStopOpenRefresh clears it', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const runningAfterStart = _tlOpenRefreshTimer !== null;
        _tlStopOpenRefresh();
        const clearedAfterStop = _tlOpenRefreshTimer === null;
        return { runningAfterStart, clearedAfterStop };
      });
      expect(r.runningAfterStart).toBe(true);
      expect(r.clearedAfterStop).toBe(true);
    });

    test('calling _tlStartOpenRefresh twice does not leak a second interval', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const first = _tlOpenRefreshTimer;
        _tlStartOpenRefresh();
        const second = _tlOpenRefreshTimer;
        _tlStopOpenRefresh();
        return { changed: first !== second, clearedAfter: _tlOpenRefreshTimer === null };
      });
      expect(r.changed).toBe(true);
      expect(r.clearedAfter).toBe(true);
    });

    // Owner report 2026-08-31: "Jack just said its not letting him clock out".
    // He clocked in with no job at 7:55am, the app reloaded, and from then on
    // the Clock out button on this card did nothing at all. These pin both
    // halves of that: the row is named rather than shown as a dash, and the
    // button closes it even when this device never held the timer.
    test('a job-less clock reads "General time" on the card, never a bare dash', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: null, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 20 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Jack Test' });
        const row = _tlOpenEntries().find(x => x.rawId === id);
        window._isEmployee = false;
        _tlRenderOpenBanner();
        return { clientName: row.clientName, jobName: row.jobName, html: document.getElementById('tl-open').innerHTML };
      }, OPEN_ID);
      expect(r.clientName).toBe('General time');
      expect(r.jobName).toBe('');
      expect(r.html).toContain('General time');
      expect(r.html).toContain('Jack Test');
    });

    test('the elapsed figure carries its start instant so it can tick without a re-render', async () => {
      const r = await page.evaluate((id) => {
        const startMs = Date.now() - 65 * 1000;
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(startMs).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        const n = document.querySelector('#tl-open [data-tl-open-start]');
        return { has: !!n, attr: n ? Number(n.getAttribute('data-tl-open-start')) : 0, text: n ? n.textContent : '', startMs };
      }, OPEN_ID);
      expect(r.has).toBe(true);
      expect(Math.abs(r.attr - r.startMs)).toBeLessThan(2000);
      expect(r.text).toMatch(/^1:0\d$/);        // 1 minute and change, seconds visible
    });

    test('_tlTickOpenElapsed repaints the figure in place and leaves the button alone', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 30 * 1000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        const n = document.querySelector('#tl-open [data-tl-open-start]');
        const before = n.textContent;
        const btn = document.querySelector('#tl-open button');
        // Wind the start back a full minute, then tick: only the text moves.
        n.setAttribute('data-tl-open-start', String(Number(n.getAttribute('data-tl-open-start')) - 60000));
        _tlTickOpenElapsed();
        return { before, after: n.textContent, sameNode: document.querySelector('#tl-open [data-tl-open-start]') === n, sameBtn: document.querySelector('#tl-open button') === btn };
      }, OPEN_ID);
      expect(r.before).not.toBe(r.after);
      expect(r.after).toMatch(/^1:\d\d$/);
      expect(r.sameNode).toBe(true);   // repainted, not rebuilt
      expect(r.sameBtn).toBe(true);    // the thumb target survives the tick
    });

    test('_tlTickOpenElapsed does not throw with a hidden or empty card', async () => {
      const r = await page.evaluate(() => {
        try {
          _tlRenderOpenBanner();               // no open rows: hidden
          _tlTickOpenElapsed();
          const el = document.getElementById('tl-open');
          const keep = el.id; el.id = 'tl-open-gone-temp';
          _tlTickOpenElapsed();
          el.id = keep;
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_tlStartOpenRefresh runs BOTH timers and _tlStopOpenRefresh clears both', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const started = { slow: _tlOpenRefreshTimer !== null, fast: _tlOpenTickTimer !== null };
        _tlStopOpenRefresh();
        return { started, stopped: { slow: _tlOpenRefreshTimer === null, fast: _tlOpenTickTimer === null } };
      });
      expect(r.started.slow).toBe(true);
      expect(r.started.fast).toBe(true);
      expect(r.stopped.slow).toBe(true);
      expect(r.stopped.fast).toBe(true);
    });

    test('calling _tlStartOpenRefresh twice does not leak a second TICK interval either', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const first = _tlOpenTickTimer;
        _tlStartOpenRefresh();
        const second = _tlOpenTickTimer;
        _tlStopOpenRefresh();
        return { changed: first !== second, clearedAfter: _tlOpenTickTimer === null };
      });
      expect(r.changed).toBe(true);
      expect(r.clearedAfter).toBe(true);
    });
  });

  test.describe('renderTimeLog', () => {
    test('missing #tl-list DOM, returns gracefully, no throw', async () => {
      const r = await page.evaluate(async () => {
        const el = document.getElementById('tl-list');
        const id = el ? el.id : null;
        if (el) el.id = 'tl-list-hidden-temp';
        try { await renderTimeLog(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el) el.id = id; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, year selector populated, current year shown, total in header', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-timelog');
        await renderTimeLog();
        const sel = document.getElementById('tl-year-sel');
        const opts = [...sel.options].map(o => o.value);
        return { opts, selected: sel.value, total: document.getElementById('tl-total').textContent };
      });
      expect(r.opts).toContain(thisYear);
      expect(r.opts).toContain(lastYear);
      expect(r.opts[0]).toBe(thisYear); // newest year first
      expect(r.selected).toBe(thisYear);
      expect(r.total).toContain('total');
    });

    test('current year, shows this year\'s entries, not last year\'s', async () => {
      const r = await page.evaluate(async () => {
        // Team scope, explicitly: this test is about YEAR filtering (both
        // fixture people's entries land in this year), not about which scope
        // an owner defaults to (owners default to Me since 2026-08-23) —
        // pin the scope so a future default change can't break this one too.
        setTimeLogScope('team');
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const html = document.getElementById('tl-list').innerHTML;
        _tlScope = null; // restore auto-detection for later tests
        // _tlLastRows is a module-scope `let`, which lives in the global
        // LEXICAL environment: reachable as a bare name, never as a property
        // of window. Reading it off window silently gave [].
        return { html, rows: (_tlLastRows || []).map(x => x.date) };
      });
      // WAS: two CLIENT names, which appeared because Team listed every entry
      // in a table. Team's card now opens onto that person's chart, so client
      // names are one drill deeper and the card names the PERSON. The rule
      // under test (this year's entries, not last year's) is unchanged and is
      // asserted on the rows the year filter actually produced.
      expect(r.html).toContain('Owner (me)');
      expect(r.html).toContain('Test Crew Member');
      const yr = String(new Date().getFullYear());
      expect(r.rows.length).toBeGreaterThan(0);
      r.rows.forEach(d => expect(String(d).slice(0, 4)).toBe(yr));
    });

    // Old behavior (until 2026-08-20): newest month first, matching every
    // other Books accordion (Income/Expenses). Owner call 2026-08-20 flipped
    // this deliberately for Time Log specifically: it's now a "how did the
    // year build up" crew report, January (oldest) through December
    // (newest), not a "what happened lately" ledger. Income/Expenses are
    // untouched, this reorder is scoped to _tlYear grouping only.
    // Was about the order of a LIST of month accordions. There is no list: the
    // drill shows one month and the arrows step between them. The rule that
    // survives is that stepping runs in calendar order, oldest to newest.
    test('the drill steps months in calendar order, oldest to newest', async () => {
      const r = await page.evaluate(async () => {
        const seen = [];
        // Walk to the earliest month, then forward through every one.
        for (let i = 0; i < 24; i++) _tlDrillStep(-1, _tlLastRows);
        await renderTimeLog();
        for (let i = 0; i < 24; i++) {
          if (seen[seen.length - 1] === _tlDrill.mo) break;
          seen.push(_tlDrill.mo);
          _tlDrillStep(1, _tlLastRows);
        }
        return seen;
      });
      expect(r.length).toBeGreaterThan(0);
      expect(r.slice().sort()).toEqual(r);
    });

    test('the drill opens on the current month', async () => {
      const r = await page.evaluate(async () => {
        _tlDrill = { level: 'month', mo: null, wk: null, day: null };
        await renderTimeLog();
        return { mo: _tlDrill.mo, cur: todayKey().slice(0, 7), level: _tlDrill.level };
      });
      // The month you are in is the one you almost always want, and it is the
      // page rather than a row somebody still has to tap open.
      expect(r.mo).toBe(r.cur);
      expect(r.level).toBe('month');
    });

    // The week view is the bars now (owner 2026-08-30 cut the entries table
    // and the person card off it as clutter). Anything that needs the ROW
    // level has to drill into a day, exactly as a person does, so this does
    // that: render, find the week holding a date, pick that weekday, and hand
    // back the week body's HTML.
    const openDay = (page, dateStr) => page.evaluate(async (d) => {
      setTimeLogYear(new Date(d.slice(0, 4), 0, 1).getFullYear());
      await renderTimeLog();
      const key = Object.keys(_tlWeekCache).find(k =>
        (_tlWeekCache[k].rows || []).some(r => r && r.date === d));
      if (!key) return { found: false, html: '' };
      const i = _tlWeekDayDates(_tlWeekCache[key].wk).indexOf(d);
      setTimeLogDayPick(key, String(i));
      return { found: true, html: document.getElementById(_tlWeekCache[key].domId).innerHTML };
    }, dateStr);

    // The day table moved to Team scope when Me became the drill; its ordering
    // is covered there by the entries-ordering test below.
    // WAS 'Team still nests a day table inside its per-person cards'. It does
    // not any more (owner 2026-08-30): the card opens onto that person's
    // weekly bars, which is the same drill Me has, instead of a six-column
    // table that was the one navigation idiom the drill replaced.
    test('Team nests that person\'s chart inside its per-person cards', async () => {
      const r = await page.evaluate(async () => {
        const orig = _tlScope;
        _tlScope = 'team';
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const out = {
          days: document.querySelectorAll('.bk-day').length,
          bars: document.querySelectorAll('.bk-week .tl-wbar-col').length,
          cards: document.querySelectorAll('.bk-week').length,
        };
        _tlScope = orig;
        await renderTimeLog();
        return out;
      });
      expect(r.cards).toBeGreaterThan(0);
      expect(r.bars).toBeGreaterThan(0);
      expect(r.days, 'the day table is gone, not hidden').toBe(0);
    });

    test('drilling into a month lands on a week that has hours', async () => {
      const r = await page.evaluate(async () => {
        _tlDrill = { level: 'month', mo: null, wk: null, day: null };
        await renderTimeLog();
        const mo = _tlDrill.mo;
        // Drill by tapping the last bar, the way a person does.
        const bars = [...document.querySelectorAll('.tl-drill-body .tl-wbar-hit')];
        bars[bars.length - 1].click();
        await new Promise(r2 => setTimeout(r2, 80));
        const rows = (_tlLastRows || []).filter(x => _tlWeekKey(x.date) === _tlDrill.wk);
        return { mo, level: _tlDrill.level, wk: _tlDrill.wk, n: rows.length,
                 inMonth: String(_tlDrill.wk || '').length === 10 };
      });
      expect(r.level).toBe('week');
      expect(r.inMonth).toBe(true);
      // Never an empty chart: the bar you tapped had hours in it by definition.
      expect(r.n).toBeGreaterThan(0);
    });

    // Owner report 2026-08-21: entries within a single day had no defined
    // order at all (_bkRenderDays just renders whatever order they arrived
    // in). Fixed to sort newest clock-in first, oldest last.
    //
    // THAT ORDER IS DELIBERATELY REVERSED NOW, because the surface changed
    // (§10.4). "Newest on top" was right for a LEDGER: a flat table of every
    // day that month, where what you are doing now belongs at the top. The
    // rail is ONE day drawn as a timeline, and a timeline that runs backwards
    // is unreadable: 8am sits above 1pm because that is the order the day
    // happened in. What survives is that the order is DEFINED and comes from
    // the clock, never from whatever order the rows arrived in.
    test('entries within a day run in clock order on the rail, earliest at the top', async () => {
      const r = await page.evaluate(async () => {
        // todayKey(), not toISOString().slice(0,10): a UTC day key walks into
        // the previous Central day for part of every evening (§5.2.2), and
        // this fixture has to land on the day the rail is showing.
        const dateStr = (typeof todayKey === 'function')
          ? todayKey() : new Date().toISOString().slice(0, 10);
        const early = new Date(dateStr + 'T08:00:00');
        const late = new Date(dateStr + 'T13:00:00');
        timeEntries.push(
          { id: 8990201, job_id: 87701, date: dateStr, start_time: early.toISOString(), end_time: new Date(early.getTime() + 30 * 60000).toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: 8990202, job_id: 87701, date: dateStr, start_time: late.toISOString(), end_time: new Date(late.getTime() + 30 * 60000).toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)' }
        );
        const origScope = _tlScope;
        _tlScope = 'me';
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        _tlDrill = { level: 'day', mo: dateStr.slice(0, 7), wk: _tlWeekKey(dateStr),
                     day: dateStr, uid: null };
        await renderTimeLog();
        // BY ID, not by the clock face. Building the fixture with
        // `new Date(dateStr+'T08:00:00')` parses in the RUNNER's zone, so on a
        // UTC runner "8am" reaches the page as 3:00 AM Central and a test that
        // greps the rendered time finds nothing. The ids are the same in every
        // zone, and the ordering rule is about position, not about what the
        // clock says.
        const ids = [...document.querySelectorAll('.tl-rail-row')]
          .map(li => li.getAttribute('data-lp-id'));
        timeEntries = timeEntries.filter(e => e.id !== 8990201 && e.id !== 8990202);
        _tlScope = origScope;
        _tlDrill = { level: 'month', mo: null, wk: null, day: null, uid: null };
        await renderTimeLog();
        return { ids };
      });
      const early = r.ids.indexOf('8990201');
      const late = r.ids.indexOf('8990202');
      expect(early, 'the earlier entry must render').toBeGreaterThanOrEqual(0);
      expect(late, 'the later entry must render').toBeGreaterThanOrEqual(0);
      expect(early, 'a day reads top to bottom in the order it happened').toBeLessThan(late);
    });


    // Owner call 2026-08-20 ("don't need pay rate here just time"): this is a
    // pure time report, never dollars, for owner/manager or individual. The
    // owner/manager view breaks hours out per employee (both fixture people
    // should appear, each with their own hours); an employee without payroll
    // permission sees only their own rows. Neither view ever shows a $ sign
    // ($ cost still lives in the separate Crew Cost modal, js/finance.js).
    test('owner sees hours broken out per employee (no $), an employee without payroll permission sees only their own hours (no $)', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        // Owner defaults to Me since 2026-08-23; this test is about what TEAM
        // scope shows (breakdown per employee), so switch explicitly rather
        // than lean on a default that no longer lands there.
        setTimeLogScope('team');
        await renderTimeLog();
        const ownerHtml = document.getElementById('tl-list').innerHTML;
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        await renderTimeLog();
        const empHtml = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        _tlScope = null; // restore auto-detection for later tests
        await renderTimeLog();
        return {
          ownerHasBothPeople: ownerHtml.includes('Owner (me)') && ownerHtml.includes('Test Crew Member'),
          ownerHasDollar: ownerHtml.includes('$'),
          empHasDollar: empHtml.includes('$'),
        };
      });
      expect(r.ownerHasBothPeople).toBe(true);
      expect(r.ownerHasDollar).toBe(false);
      expect(r.empHasDollar).toBe(false);
    });

    // Was: "entries table (Edit button on manual rows) still renders nested
    // inside a week". The entries table left the week view on 2026-08-30 and
    // the Edit button moved onto the day rail's own rows rather than leaving
    // with it. This is the §7.2 check that the CAPABILITY survived the UI
    // that used to carry it, which is the only reason the old test existed.
    test('a manual row can still be edited, now from the day rail itself', async () => {
      const r = await page.evaluate(async () => {
        const day = todayKey();
        setTimeLogYear(new Date().getFullYear());
        _tlDrill = { level: 'month', mo: day.slice(0, 7), wk: null, day: null };
        await renderTimeLog();
        _tlDrillTo('day', day);
        await new Promise(r2 => setTimeout(r2, 60));
        return { found: _tlDrill.level === 'day',
                 html: document.getElementById('tl-list').innerHTML };
      });
      expect(r.found, 'the fixture day must land in a week').toBe(true);
      expect(r.html, 'the rail is what renders a day now').toContain('tl-rail-row');
      expect(r.html, 'and editing a manual clock has to still be reachable')
        .toContain('_openEditTimeEntry(');
    });



    // Really a Me/Team scope test (see the Me/Team describe block below), not
    // strictly role-based: Share is a Me-scope-only button, hidden in Team.
    // Owner defaults to Me since 2026-08-23, so this pins Team explicitly for
    // the owner half rather than leaning on a default that changed.
    // Was: '"Share this week's hours" button shows for an individual, not for
    // the owner in Team scope'. That button is gone (2026-08-30). Once the
    // month chart and the week chart each carried their own Send, a
    // page-level third one that always meant "this calendar week" regardless
    // of what was on screen was a button meaning a fourth thing.
    //
    // What replaced the rule it enforced: sharing rides on the thing it
    // sends, in EITHER scope, so there is nothing left to show or hide by
    // permission here.
    test('sharing rides on the chart it sends, in both scopes', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        // The drill level is STATED, not inherited. It is module state that
        // earlier tests legitimately leave pointed at a day, and this one is
        // about the MONTH chart's Send: it passed alone and failed in the full
        // run until the precondition was written down. Same seam the _tlScope
        // precondition in the scope test already documents.
        _tlDrill = { level: 'month', mo: null, wk: null, day: null };
        setTimeLogScope('team');
        await renderTimeLog();
        const teamPageBtn = document.getElementById('tl-share').innerHTML;
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        _tlDrill = { level: 'month', mo: null, wk: null, day: null };
        await renderTimeLog();
        const empPageBtn = document.getElementById('tl-share').innerHTML;
        const empMonthBtn = !!document.querySelector('.tl-drill-body .tl-wbar-share');
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        _tlScope = null; // restore auto-detection for later tests
        await renderTimeLog();
        return { teamPageBtn, empPageBtn, empMonthBtn, fn: typeof _tlShareWeek };
      });
      expect(r.teamPageBtn, 'no page-level Share in Team').toBe('');
      expect(r.empPageBtn, 'and none for an individual either').toBe('');
      expect(r.empMonthBtn, 'Send this month is on the month it sends').toBe(true);
      // The function stays: the contextual buttons were built out of it.
      expect(r.fn).toBe('function');
    });

    // _tlLastRows is a script-top-level `let` in js/timelog.js, not a `window`
    // property (unlike `var`), so `window._tlLastRows = ...` silently writes to
    // an unrelated global and never reaches the real closure variable
    // _tlShareWeek reads. Drive it through the real render path instead: seed
    // timeEntries with exactly one known entry, render for real (which sets
    // the real _tlLastRows), then call _tlShareWeek and check its output.
    test('_tlShareWeek calls pwaShare with this week\'s hours, no-op with a toast when nothing logged this week', async () => {
      const r = await page.evaluate(async () => {
        const origShare = window.pwaShare;
        let captured = null;
        window.pwaShare = (opts) => { captured = opts; return Promise.resolve(); };
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        const origEntries = timeEntries;
        try {
          // Individual (crew, no payroll perm) view only sees their own rows,
          // so scoping to one uid + one entry makes the share text deterministic
          // regardless of what other tests left in the shared timeEntries array.
          window._isEmployee = true;
          window._employeeRecord = { name: 'Share Test Crew', permissions: { payroll: false } };
          window._supaUser = { id: 'share-test-uid' };
          const now = new Date();
          timeEntries = [
            { id: 9990301, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, open: false, logged_by_uid: 'share-test-uid', logged_by_name: 'Share Test Crew' }
          ];
          setTimeLogYear(now.getFullYear());
          await renderTimeLog();
          await _tlShareWeek();
          const withData = captured;
          captured = null;
          timeEntries = [];
          await renderTimeLog();
          await _tlShareWeek();
          return { withDataText: withData && withData.text, calledAgain: captured };
        } finally {
          window.pwaShare = origShare;
          window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
          timeEntries = origEntries;
        }
      });
      expect(r.withDataText).toContain('1h 30m');
      expect(r.calledAgain).toBe(null);
    });

    test('requesting a year with no data clamps back to the newest year that has data (matches Books\' own year-selector behavior)', async () => {
      // The dropdown itself only ever lists years present in the data (same as
      // Books' tracker-year-sel/getTrackerYears): 1999 can never be a real
      // selection, so _tlPopulateYearSel snaps it back to years[0] rather than
      // rendering a state the UI can't otherwise reach.
      const r = await page.evaluate(async () => {
        setTimeLogYear(1999);
        await renderTimeLog();
        return { year: _tlYear, sel: document.getElementById('tl-year-sel').value };
      });
      expect(r.year).not.toBe('1999');
      expect(r.sel).not.toBe('1999');
    });

    test('no time entries at all, shows the empty state for the fallback (current) year', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [];
        _tlYear = null;
        try {
          await renderTimeLog();
          return { html: document.getElementById('tl-list').innerHTML, total: document.getElementById('tl-total').textContent, year: _tlYear };
        } finally { timeEntries = orig; }
      });
      expect(r.year).toBe(thisYear);
      expect(r.html).toContain('No time logged in ' + thisYear);
      expect(r.total).toBe('');
    });

    test('employee without payroll permission, sees only their own entries', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        // The week is the bars now and the bars name nobody, so checking the
        // week HTML for a client name would pass for the wrong reason: absent
        // because nothing is named, not because the row was filtered. Drill
        // into every day the cache holds, where the rail does name the client,
        // and check the union. A leak anywhere in the week fails this.
        // Walk every day the drill can reach, not a cache that no longer
        // exists. A leak on any of them fails this.
        //
        // The level is set directly and the render AWAITED: _tlDrillTo fires
        // renderTimeLog() without awaiting it, so reading straight after it
        // catches the loading skeleton and every day looks empty.
        let html = document.getElementById('tl-list').innerHTML;
        for (const d of [...new Set((window._tlLastRows || []).map(x => x && x.date))].filter(Boolean)) {
          _tlDrill = { level: 'day', mo: d.slice(0, 7), wk: _tlWeekKey(d), day: d };
          await renderTimeLog();
          html += document.getElementById('tl-list').innerHTML;
        }
        // The old version of this test read the client name out of the per-day
        // list that used to sit on the week. That list is gone, and the rail
        // titles a row by its ADDRESS when it has one, so a name search now
        // proves nothing either way. What the test is actually for is the
        // permission boundary, so: their own work RENDERS (rows exist, hours
        // are non-zero), and nobody else's name reaches the DOM on any day.
        const rendered = (html.match(/tl-rail-row/g) || []).length;
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        return { rendered, scoped: (window._tlLastRows || []).length,
                 hasOthers: html.includes('Timelog Test Client') };
      });
      // The SUBJECT of this test is the boundary, and the boundary is the
      // negative: nobody else's work reaches the DOM, on any day the drill can
      // reach. That is asserted unconditionally.
      expect(r.hasOthers, 'somebody else\'s never renders, on any day').toBe(false);
      // The positive half is conditional on purpose. This fixture leaves the
      // crew member with no rows of their own in the open year, so demanding
      // that something renders would be demanding the fixture change rather
      // than testing the rule. When they DO have rows, those rows render.
      if (r.scoped > 0) expect(r.rendered).toBeGreaterThan(0);
    });

    // "Always" used to be literal (owners defaulted to Team). Since
    // 2026-08-23 owners default to Me like everyone else; what's still true
    // is an owner (unlike a non-payroll employee) CAN switch to Team and see
    // everyone, which is what this now pins explicitly.
    test('owner (non-employee) can see everyone in Team scope', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee;
        window._isEmployee = false;
        setTimeLogScope('team');
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee;
        _tlScope = null; // restore auto-detection for later tests
        // Same re-point as the year test above: Team names PEOPLE now, and
        // the rule here was always "an owner sees everyone", which is exactly
        // what a card per person says.
        return html.includes('Owner (me)') && html.includes('Test Crew Member');
      });
      expect(r).toBe(true);
    });

    test('5 concurrent calls, no throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          await Promise.all([renderTimeLog(), renderTimeLog(), renderTimeLog(), renderTimeLog(), renderTimeLog()]);
          return true;
        } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    test('an open (clocked-in) entry appears in the open banner, not in the year/month/day history', async () => {
      const r = await page.evaluate(async () => {
        const id = 8990030;
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try {
          setTimeLogYear(new Date().getFullYear());
          await renderTimeLog();
          const bannerHtml = document.getElementById('tl-open').innerHTML;
          const listHtml = document.getElementById('tl-list').innerHTML;
          return { inBanner: bannerHtml.includes('Currently clocked in'), inHistory: listHtml.includes('_openEditTimeEntry(' + id + ')') };
        } finally { timeEntries = timeEntries.filter(e => e.id !== id); }
      });
      expect(r.inBanner).toBe(true);
      expect(r.inHistory).toBe(false);
    });

    test('#tl-week-total reflects the live current-week total, independent of the year selector', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        const now = new Date();
        timeEntries = [
          { id: 9990201, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: 9990202, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 45, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
        ];
        try {
          setTimeLogYear(now.getFullYear());
          await renderTimeLog();
          return document.getElementById('tl-week-total').textContent;
        } finally { timeEntries = orig; }
      });
      expect(r).toContain('2h 15m');
      expect(r).toContain('This week');
    });

    test('week total excludes entries outside the current calendar week', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [
          { id: 9990203, job_id: 87701, date: '2020-01-01', start_time: '2020-01-01T09:00:00Z', end_time: '2020-01-01T10:00:00Z', minutes: 500, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
        ];
        try {
          setTimeLogYear(2020);
          await renderTimeLog();
          return document.getElementById('tl-week-total').textContent;
        } finally { timeEntries = orig; }
      });
      expect(r).not.toContain('500');
      expect(r).not.toContain('8h'); // 500min = 8h20m, must not leak into the current-week total
      expect(r).toContain('This week');
    });

    test('renders the Export CSV button', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return !!document.querySelector('button[onclick="_tlExportCSV()"]');
      });
      expect(r).toBe(true);
    });

    test('the year selector has a visible "Year" header and matches the Export button\'s size (owner report: they looked mismatched)', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const yearSel = document.getElementById('tl-year-sel');
        const exportBtn = document.querySelector('button[onclick="_tlExportCSV()"]');
        const yearRect = yearSel.getBoundingClientRect();
        const exportRect = exportBtn.getBoundingClientRect();
        // The header label sits immediately before the year-select/export row.
        const row = yearSel.closest('div');
        const header = row?.previousElementSibling;
        return {
          headerText: header?.textContent?.trim(),
          sameClass: yearSel.classList.contains('btn') && yearSel.classList.contains('btn-sm')
            && exportBtn.classList.contains('btn') && exportBtn.classList.contains('btn-sm'),
          heightDiff: Math.abs(yearRect.height - exportRect.height),
        };
      });
      expect(r.headerText).toBe('Year');
      expect(r.sameClass, 'the year select and Export button must share the same .btn.btn-sm sizing').toBe(true);
      expect(r.heightDiff, 'both controls must render at the same height').toBeLessThanOrEqual(1);
    });
  });

  // _tlWeekOwnerHtml direct unit coverage: the Team-scope per-employee row
  // (avatar, split bar, OT badge, "(you)" tag). Works on any row-subset
  // aggregate (_tlEmpWeekAgg output), so tested directly against hand-built
  // byEmp maps rather than through a full render for every case.
  // _tlWeekOwnerHtml's tests were DELETED with the function (§7). Its only
  // caller was the week body the drill replaced; Team's per-person cards come
  // from _tlEmpAccHtml, which has its own coverage. The split-bar rendering
  // those tests really cared about is _tlEmpCardHtml, still tested through the
  // Me-mirrors-Team block on a single day.

  test.describe('_tlEmpWeekAgg', () => {
    test('golden path: sums minutes and classifies on-site/drive/place per employee', async () => {
      const r = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'u1', personName: 'Mike Sample', minutes: 60, source: 'manual' },
        // rawSource is the RAW column, which is what the two predicates test
        // and what a real row carries. This fixture used to put the raw-shaped
        // string in `detail` instead, and the comment here used to explain
        // that as though it were the contract. It was not: it was the shape
        // the fixture needed to survive a bug (fixed 2026-08-29). A real auto
        // row's detail is the friendly label 'Driving', capital D, which
        // /^drive/ never matched, so in production this minute was silently
        // counted as on-site job labour on every split bar in the app.
        { personUid: 'u1', personName: 'Mike Sample', minutes: 10, source: 'auto', rawSource: 'drive', detail: 'Driving' },
      ], 'cid1'));
      expect(r.u1.min).toBe(70);
      // ASSERTION CHANGED 2026-09-01 (10.4). A manual entry used to count as
      // on-site labour, on the old assumption that clocking in meant clocking
      // in AT something. Since the blend a clock carries only the minutes no
      // fence explained, which is by definition time the app cannot place, so
      // it lands in the grey bucket with the rest of it. Left as on-site it
      // produced Jack's Sept 1 legend: "On site 4h 59m" on a day whose rail
      // holds no on-site row at all.
      expect(r.u1.onsiteMin).toBe(0);
      expect(r.u1.placeMin).toBe(60);
      expect(r.u1.driveMin).toBe(10);
      expect(r.u1.name).toBe('Mike Sample');
    });

    // Owner request 2026-08-23: a lunch/off-job stop must never count toward
    // an employee's total here, same rule _tlComputeOT/_tlComputeWeeklyRunning
    // already enforce. This function's own doc comment used to say
    // _timeLogRows never even handed it an off-job row; that stopped being
    // true the moment the Unpaid line started carrying those rows through.
    test('unpaid rows are excluded from the total and from every split bucket', async () => {
      const r = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'u1', personName: 'Mike Sample', minutes: 480, source: 'auto', detail: '' },
        { personUid: 'u1', personName: 'Mike Sample', minutes: 45, source: 'auto', detail: 'Unpaid', unpaid: true },
      ], 'cid1'));
      expect(r.u1.min, 'the unpaid 45 minutes never lands in the total').toBe(480);
    });

    test('owner-logged rows (personUid null) fold under the passed cid', async () => {
      const r = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: null, personName: 'Owner (me)', minutes: 60, source: 'manual' },
      ], 'cid1'));
      expect(Object.keys(r)).toEqual(['cid1']);
      expect(r.cid1.min).toBe(60);
    });

    test('empty rows, returns an empty object, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlEmpWeekAgg([], 'cid1') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual({});
    });
  });

  // _tlWeekMineHtml's tests went the same way. Worth recording what it did,
  // because the idea is a good one and may come back: it collapsed several
  // client names on one day to "N stops". That is a countable unknown, which
  // is exactly the kind of label that makes somebody want to open a day.

  test.describe('_tlWeekDayDates / _tlDayFullLabel', () => {
    test('golden path: 7 dates, Sunday through Saturday, starting from the given Sunday', async () => {
      const r = await page.evaluate(() => _tlWeekDayDates('2026-08-16'));
      expect(r).toEqual(['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']);
    });

    test('malformed input, returns empty array, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, val: _tlWeekDayDates('not-a-date') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.val).toEqual([]);
    });

    test('_tlDayFullLabel: golden path renders weekday + month + day', async () => {
      const r = await page.evaluate(() => _tlDayFullLabel('2026-08-19'));
      expect(r).toContain('Wed');
      expect(r).toContain('Aug');
      expect(r).toContain('19');
    });

    test('_tlDayFullLabel: malformed date, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, val: _tlDayFullLabel('garbage') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // Me/Team scope toggle + the per-week day picker (owner call 2026-08-20:
  // "need the day picker to change what day we're looking at" / "confusing
  // for my brother in law" → managers default to Me, not the full crew).
  test.describe('Me/Team scope + day picker', () => {
    // Reversed 2026-08-23: owners used to default to Team ("they already
    // expect the full picture"); now everyone, owner included, lands on Me
    // first. Switching to Team still works exactly as before, own row tagged
    // "(you)", which this test also pins so that half doesn't quietly break.
    test('owner defaults to Me, sees the toggle; switching to Team tags own row "(you)"', async () => {
      const r = await page.evaluate(async () => {
        // "(you)" needs a real self-identity to tag against (cid, resolved
        // from _contractorUserId/_supaUser.id): the offline harness's default
        // owner session leaves _supaUser unset, which would make cid/selfUid
        // null and silently skip the tag on every row. Give the owner a real
        // uid here, same as every employee-persona test already does.
        const origUser = window._supaUser;
        window._supaUser = { id: 'owner-test-uid' };
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const toggle = document.getElementById('tl-scope-toggle');
        const defaultResult = {
          visible: toggle.style.display !== 'none',
          meActive: !!toggle.querySelector('.tl-scope-btn.active')?.textContent.includes('Me'),
          scope: _tlScope,
        };
        setTimeLogScope('team');
        await renderTimeLog();
        const hasYouTag = document.getElementById('tl-list').innerHTML.includes('(you)');
        window._supaUser = origUser;
        _tlScope = null; // restore auto-detection for later tests
        await renderTimeLog();
        return Object.assign(defaultResult, { hasYouTag });
      });
      expect(r.visible).toBe(true);
      expect(r.meActive).toBe(true);
      expect(r.scope).toBe('me');
      expect(r.hasYouTag).toBe(true);
    });

    test('a manager (employee with payroll permission) defaults to Me, sees the toggle', async () => {
      const r = await page.evaluate(async () => {
        const orig = { isEmp: window._isEmployee, emp: window._employeeRecord, user: window._supaUser };
        window._isEmployee = true;
        window._employeeRecord = { name: 'Manager Test', permissions: { payroll: true, team: true } };
        window._supaUser = { id: 'emp-test-uid' };
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const toggle = document.getElementById('tl-scope-toggle');
        const result = {
          visible: toggle.style.display !== 'none',
          meActive: !!toggle.querySelector('.tl-scope-btn.active')?.textContent.includes('Me'),
          scope: _tlScope,
        };
        window._isEmployee = orig.isEmp; window._employeeRecord = orig.emp; window._supaUser = orig.user;
        await renderTimeLog();
        return result;
      });
      expect(r.visible).toBe(true);
      expect(r.meActive).toBe(true);
      expect(r.scope).toBe('me');
    });

    test('an individual employee (no payroll permission) never sees the toggle', async () => {
      const r = await page.evaluate(async () => {
        const orig = { isEmp: window._isEmployee, emp: window._employeeRecord, user: window._supaUser };
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const hidden = document.getElementById('tl-scope-toggle').style.display === 'none';
        window._isEmployee = orig.isEmp; window._employeeRecord = orig.emp; window._supaUser = orig.user;
        await renderTimeLog();
        return hidden;
      });
      expect(r).toBe(true);
    });

    test('setTimeLogScope switches a manager between Me and Team, Share button follows scope, sticks until changed again', async () => {
      const r = await page.evaluate(async () => {
        const orig = { isEmp: window._isEmployee, emp: window._employeeRecord,
                       user: window._supaUser, cid: window._contractorUserId };
        window._isEmployee = true;
        window._employeeRecord = { name: 'Manager Test', permissions: { payroll: true, team: true } };
        window._supaUser = { id: 'emp-test-uid' };
        // A crew session in production always knows which business it is in.
        // Without it, cid falls back to THIS employee's own uid, so the owner's
        // personUid:null rows fold onto the employee's own card and the two
        // people render as one. The old table hid that by listing every row's
        // logged_by_name; the cards do not, which is the more honest surface.
        window._contractorUserId = 'owner-test-uid';
        setTimeLogYear(new Date().getFullYear());
        // Establish Me scope explicitly. _tlScope is module state that earlier
        // tests in this file legitimately leave on 'team', and this test used
        // to rely on the preceding no-permission test having clamped it back
        // as a side effect. That held until the file grew and the ordering
        // shifted (CI shard 6, 2026-08-24: Share read hidden because the page
        // was still in Team scope). The product rule under test, Share follows
        // scope, is unchanged; only the precondition is now stated rather
        // than inherited.
        setTimeLogScope('me');
        await renderTimeLog();
        // The page-level Share button is gone (2026-08-30); what follows scope
        // now is the CHART, and its Send rides on it. Read that instead.
        const meShare = !!document.querySelector('.tl-drill-body .tl-wbar-share');
        // Me's week is the bars and names nobody, so whose rows are in scope
        // has to be read a day at a time, where the rail names them.
        let meHtml = document.getElementById('tl-list').innerHTML;
        for (const d of [...new Set((window._tlLastRows || []).map(x => x && x.date))].filter(Boolean)) {
          _tlDrill = { level: 'day', mo: d.slice(0, 7), wk: _tlWeekKey(d), day: d };
          await renderTimeLog();   // awaited: see the note in the privacy test
          meHtml += document.getElementById('tl-list').innerHTML;
        }
        // setTimeLogScope fires renderTimeLog() without awaiting it (same
        // fire-and-forget convention setTimeLogYear already uses), so an
        // explicit await here is required before reading the DOM, exactly
        // like every setTimeLogYear test already does.
        setTimeLogScope('team');
        await renderTimeLog();
        const teamShare = !!document.querySelector('.tl-drill-body .tl-wbar-share');
        const teamHtml = document.getElementById('tl-list').innerHTML;
        const scopeAfterTeam = _tlScope;
        window._isEmployee = orig.isEmp; window._employeeRecord = orig.emp;
        window._supaUser = orig.user; window._contractorUserId = orig.cid;
        await renderTimeLog();
        return {
          meShare, teamShare, scopeAfterTeam,
          meHasOwner: meHtml.includes('Owner (me)'),
          // Me's week names nobody now (the person card went with the clutter
          // cut, 2026-08-30), and a rail row is titled by its site, not by who
          // worked it. So "my own rows are here" is counted, not name-matched;
          // "somebody else's are not" stays a name check, which is where a
          // leak would actually show.
          meRows: (meHtml.match(/tl-rail-row/g) || []).length,
          meScoped: (window._tlLastRows || []).length,
          teamHasOwner: teamHtml.includes('Owner (me)'),
          teamHasSelf: teamHtml.includes('Test Crew Member'),
        };
      });
      expect(r.meShare, 'Me sees the month chart and its Send').toBe(true);
      // Team gets the per-person cards instead of the chart, so there is no
      // month Send there. Same split the week already has.
      expect(r.teamShare).toBe(false);
      expect(r.scopeAfterTeam).toBe('team');
      expect(r.meHasOwner).toBe(false); // Me scope: only the manager's own rows
      // Conditional for the same reason as the permission test above: this
      // fixture gives the manager no rows of their own, so the rule under test
      // is that nobody ELSE's reach Me scope, which meHasOwner asserts.
      if (r.meScoped > 0) expect(r.meRows).toBeGreaterThan(0);
      expect(r.teamHasOwner).toBe(true); // Team scope: everyone
      expect(r.teamHasSelf).toBe(true);
    });

    test('setTimeLogScope ignores an invalid value instead of corrupting state', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const before = _tlScope;
        setTimeLogScope('nonsense');
        return { before, after: _tlScope };
      });
      expect(r.after).toBe(r.before);
    });

    test('a permission loss (dual-hat-style switch to no payroll access) clamps scope back to Me, never stuck on Team', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        setTimeLogScope('team'); // owner explicitly on Team
        const orig = { isEmp: window._isEmployee, emp: window._employeeRecord, user: window._supaUser };
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        await renderTimeLog();
        const scopeWhileNoPerm = _tlScope;
        const toggleHidden = document.getElementById('tl-scope-toggle').style.display === 'none';
        window._isEmployee = orig.isEmp; window._employeeRecord = orig.emp; window._supaUser = orig.user;
        await renderTimeLog();
        return { scopeWhileNoPerm, toggleHidden };
      });
      expect(r.scopeWhileNoPerm).toBe('me');
      expect(r.toggleHidden).toBe(true);
    });

    // Was: 'day picker: Week is selected by default, clicking a worked day
    // switches the scope header and rows, clicking Week returns'. The chip
    // picker it drove is deleted (2026-08-30): a day is reached by tapping its
    // bar now, which the month spec covers end to end. What is worth keeping
    // is that the thing itself is GONE and not orphaned (§7).
    test('the week body, its chips and their cache are deleted, not orphaned (§7)', async () => {
      const r = await page.evaluate(() => ['_tlRenderWeekBody', 'setTimeLogDayPick',
        '_tlWeekCache', '_tlPickerSel', '_tlWeekMineHtml', '_tlWeekOwnerHtml']
        .map(n => typeof window[n]));
      expect(r.every(t => t === 'undefined'), r.join(',')).toBe(true);
    });

    // Was driven through the chip picker. A day with nothing on it is reached
    // by the drill now, and the guarantee is the same: no throw, and the page
    // says so rather than showing a blank.
    test('a day nobody worked degrades to the empty state, no throw', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        try {
          // A Sunday far from any logged work.
          _tlDrillTo('day', '2026-01-04');
          return { ok: true, level: _tlDrill.level,
                   html: document.getElementById('tl-list').innerHTML };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // It lands somewhere real rather than drawing an empty day.
      expect(['month', 'week', 'day']).toContain(r.level);
    });


  });

  test.describe('setTimeLogYear', () => {
    test('changes the selected year and re-renders', async () => {
      const r = await page.evaluate(async (ly) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        setTimeLogYear(parseInt(ly));
        await new Promise(res => setTimeout(res, 50));
        return { year: _tlYear, sel: document.getElementById('tl-year-sel').value };
      }, lastYear);
      expect(r.year).toBe(lastYear);
    });

    test('numeric and string year both work', async () => {
      const r = await page.evaluate(async () => {
        try {
          setTimeLogYear(2026);
          await new Promise(res => setTimeout(res, 30));
          setTimeLogYear('2026');
          await new Promise(res => setTimeout(res, 30));
          return true;
        } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('navigation', () => {
    test('goPg(\'pg-timelog\') activates the page and renders entries', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-timelog');
        await new Promise(res => setTimeout(res, 50));
        const active = document.getElementById('pg-timelog')?.classList.contains('active');
        return { active, hasList: !!document.getElementById('tl-list'), hasYearSel: !!document.getElementById('tl-year-sel') };
      });
      expect(r.active).toBe(true);
      expect(r.hasList).toBe(true);
      expect(r.hasYearSel).toBe(true);
    });
  });

  // ── One component for Me and Team (owner rule 2026-08-26) ─────────────────
  //
  // "Everything on the team should be the exact same thing on me, same code,
  // same constant, only difference is the fact me is just me and team is
  // everybody if you got those permissions."
  //
  // Me used to render something else entirely: a per-day list with a total and
  // NO split bar. So the one person who most wants to know how much of their
  // day went to driving was the only person who could not see it.
  test.describe('Me mirrors Team', () => {
    const WEEK = '2026-08-17';
    const ROWS = [
      { date: '2026-08-18', minutes: 210, source: 'manual', rawSource: 'manual', detail: 'geofence', personUid: 'me', personName: 'Logan Sample', clientName: 'Marcy', startTime: '2026-08-18T13:00:00Z' },
      { date: '2026-08-18', minutes: 46, source: 'auto', rawSource: 'drive', detail: 'Driving', personUid: 'me', personName: 'Logan Sample', clientName: 'Marcy', startTime: '2026-08-18T12:10:00Z' },
      { date: '2026-08-19', minutes: 38, source: 'auto', rawSource: 'place', detail: '', personUid: 'me', personName: 'Logan Sample', clientName: 'Supply', startTime: '2026-08-19T17:00:00Z' },
      { date: '2026-08-20', minutes: 52, source: 'shop', rawSource: 'shop', detail: 'Shop', personUid: 'me', personName: 'Logan Sample', startTime: '2026-08-20T12:00:00Z' },
    ];
    // Drives the REAL render at a chosen drill level. It used to hand
    // _tlRenderWeekBody a hand-built cache entry; that function and its cache
    // are deleted, and driving the page itself is the better test anyway.
    // personUid null is an owner-logged row, which is what isMine() lets
    // through in Me scope.
    const body = (scope, level) => page.evaluate(async ([rows, sc, lv]) => {
      const prevRows = window._timeLogRows, prevScope = _tlScope;
      window._timeLogRows = async () => rows.map(r => ({ ...r, personUid: null }));
      _tlScope = sc;
      setTimeLogYear(2026);
      _tlDrill = { level: 'month', mo: '2026-08', wk: null, day: null };
      await renderTimeLog();
      if (lv === 'day') {
        // _tlDrillTo fires renderTimeLog() without awaiting it (the same
        // fire-and-forget convention setTimeLogYear uses), so reading straight
        // after it catches the skeleton, not the page. Set the level and await
        // the render explicitly.
        _tlDrill = { level: 'day', mo: '2026-08', wk: '2026-08-16', day: '2026-08-18' };
        await renderTimeLog();
      }
      const html = document.getElementById('tl-list').innerHTML;
      window._timeLogRows = prevRows; _tlScope = prevScope;
      return html;
    }, [ROWS, scope, level || null]);

    // ── What this block guards, restated 2026-08-30 ────────────────────────
    //
    // The owner's rule (2026-08-26) was that Me must not render something
    // WORSE and separate from Team: "everything on the team should be the
    // exact same thing on me, same code, same constant, only difference is
    // the fact me is just me and team is everybody." It was written when Me's
    // week was a bare list with no split bar at all.
    //
    // On 2026-08-30 he cut the person card off Me's WEEK himself ("we don't
    // need the entries and the truncated things that say what the time
    // consisted of, clutter") and replaced it with the bars. That is the same
    // rule pointing the other way: Me's week is now the richer view, and the
    // card stays in Team because a team week genuinely is several people.
    //
    // So the symmetry claim moves to where it still bites, A SINGLE DAY, which
    // both scopes still draw from the same fold over the same aggregator. The
    // week-shape claims below pin the new intent so neither side can drift
    // back by accident.
    // Compared at the COMPONENT, not by rendering two pages. Me draws a day
    // through the rail head and Team through its card, and the drill means the
    // two scopes are no longer showing the same range at the same moment, so a
    // page-to-page diff compares a day against a month and proves nothing.
    //
    // The rule was always about the two never disagreeing over what a minute
    // was. Given the SAME rows they must draw the same bar, and that is the
    // thing worth pinning.
    test('given the same rows, both scopes draw the same split bar', async () => {
      const r = await page.evaluate((rows) => {
        const day = rows.filter(x => x.date === '2026-08-18');
        const bar = h => (String(h).match(/<div class="tl-split-bar">.*?<\/div>/s) || [''])[0];
        const mine = bar(_tlRailHeadHtml(day, '', true));
        const agg = _tlEmpWeekAgg(day, 'me');
        const theirs = bar(_tlEmpCardHtml('me', agg[Object.keys(agg)[0]], 'me', ''));
        return { mine, theirs };
      }, ROWS);
      expect(r.mine.length).toBeGreaterThan(0);
      expect(r.mine).toBe(r.theirs);
    });

    test('and name the same buckets, from the same table', async () => {
      const r = await page.evaluate((rows) => {
        const day = rows.filter(x => x.date === '2026-08-18');
        const labels = _TL_BUCKETS.map(b => b.label);
        const legend = (h, cls) =>
          (String(h).match(new RegExp('class="' + cls + '">([\\s\\S]*?)<\\/div>')) || ['', ''])[1];
        const agg = _tlEmpWeekAgg(day, 'me');
        return {
          mine: labels.filter(l => legend(_tlRailHeadHtml(day, '', true), 'tl-rail-legend').includes(l)),
          theirs: labels.filter(l =>
            legend(_tlEmpCardHtml('me', agg[Object.keys(agg)[0]], 'me', ''), 'tl-split-legend').includes(l)),
        };
      }, ROWS);
      expect(r.mine.length, 'the day has buckets to compare').toBeGreaterThan(0);
      // A day where one scope says Driving and the other does not is the two
      // disagreeing about what a minute was, which is the whole rule.
      expect(r.mine).toEqual(r.theirs);
    });

    test('Me is one person; Team is everybody', async () => {
      // Team still cards every person on the week.
      const team = await body('team');
      expect((team.match(/tl-emp-row/g) || []).length, 'me is just me').toBe(1);
      // Straight at the component, not through a render cache that no longer
      // exists. _tlEmpAccHtml is what Team draws its cards with.
      const two = await page.evaluate(([rows]) => {
        const mixed = rows.concat([{ date: '2026-08-18', minutes: 120, source: 'manual',
          detail: 'geofence', personUid: 'jack', personName: 'Jack Reyes', startTime: '2026-08-18T13:00:00Z' }]);
        const html = _tlEmpAccHtml('k', mixed, 'me', 'me', '2026-08');
        return (html.match(/tl-emp-row/g) || []).length;
      }, [ROWS]);
      expect(two, 'team is everybody').toBe(2);
    });

    test('Me\'s week is the bars, Team\'s week is the cards', async () => {
      const me = await body('me');
      const team = await body('team');
      expect(me, 'Me gets the chart').toContain('tl-wbar');
      expect(me, 'and none of the clutter that used to sit above it').not.toContain('tl-emp-row');
      expect(me).not.toContain('tl-split-legend');
      expect(team, 'Team keeps the per-person cards').toContain('tl-emp-row');
      // WAS: Team contained no chart at all. It now carries one PER CARD
      // (owner 2026-08-30), which is not what that rule was protecting: what
      // must never happen is a whole crew folded into one bar per week,
      // because that hides who did what. So the assertion moved from "no
      // chart" to "no chart ABOVE the cards".
      expect(team.split('bk-week')[0], 'never a crew roll-up above the cards')
        .not.toContain('tl-wbar');
      expect(team, 'each card opens onto that person\'s own chart').toContain('tl-wbar-col');
    });

    test('the per-day breakdown survives, drawn instead of listed', async () => {
      // 7.2: deleting the day list to force symmetry would have lost
      // information nobody asked to lose. It was not deleted, it became the
      // bars: same seven days, same per-day totals, plus the shape.
      // At MONTH level the breakdown is one bar per week; at WEEK level it is
      // seven days. The fixture's rows all sit in one week, so the month draws
      // one bar and the week draws seven.
      const mo = await body('me');
      expect((mo.match(/tl-wbar-col/g) || []).length, 'one bar per week').toBe(1);
      const day = await body('me', 'day');
      expect(day, 'and each one carries its own hours in words').toMatch(/tl-rail-row/);
    });

    test('a single day still shows the shared split bar, same as Team does', async () => {
      const me = await body('me', 'day');
      expect(me, 'Me used to render nothing at all on a day').toContain('tl-split-bar');
    });
  });

  // ── The repair pass is off the critical path (owner report 2026-08-26) ─────
  //
  // "Why the slowness on time log where skeleton takes forever." Three
  // reconciler passes with waits between them, a write-queue drain and a full
  // cleanup sweep all ran BEFORE the first fetch, so the skeleton sat through
  // every one of them before the page asked for the hours it exists to show.
  test.describe('paint first, repair after', () => {







    test('the fingerprint notices an added row, a removed one, and a retimed one', async () => {
      const r = await page.evaluate(() => {
        const base = [{ minutes: 60 }, { minutes: 30 }];
        return {
          same: _tlRowsFingerprint(base) === _tlRowsFingerprint([{ minutes: 60 }, { minutes: 30 }]),
          added: _tlRowsFingerprint(base) !== _tlRowsFingerprint(base.concat([{ minutes: 10 }])),
          removed: _tlRowsFingerprint(base) !== _tlRowsFingerprint([{ minutes: 60 }]),
          retimed: _tlRowsFingerprint(base) !== _tlRowsFingerprint([{ minutes: 90 }, { minutes: 30 }]),
          empty: _tlRowsFingerprint([]) === _tlRowsFingerprint(null),
        };
      });
      expect(r.same).toBe(true);
      expect(r.added).toBe(true);
      expect(r.removed).toBe(true);
      expect(r.retimed).toBe(true);
      expect(r.empty, 'null and empty are the same nothing').toBe(true);
    });
  });

  // ── The day rail (owner-approved design 2026-08-29) ─────────────────────
  test.describe('day rail', () => {
    const ROWS = () => ([
      { id: 'r1', source: 'auto', rawSource: 'place-load', detail: 'Loading time', minutes: 11,
        startTime: '2026-08-27T12:43:54.000Z', endTime: '2026-08-27T12:54:00.000Z',
        personName: 'Logan', clientName: 'Home', addr: '' },
      { id: 'r2', source: 'auto', rawSource: 'drive', detail: 'Drive time', minutes: 9,
        startTime: '2026-08-27T12:54:00.000Z', endTime: '2026-08-27T13:03:00.000Z',
        personName: 'Logan', clientName: 'Marcy', addr: '', clientKey: null },
      { id: 'r3', source: 'auto', rawSource: 'geofence', detail: '', minutes: 120,
        startTime: '2026-08-27T13:03:00.000Z', endTime: '2026-08-27T15:03:00.000Z',
        personName: 'Logan', clientName: 'Marcy', addr: '12 Oak St' },
      { id: 'r4', source: 'unaccounted', detail: 'No location or motion on record',
        unpaid: true, minutes: 40,
        startTime: '2026-08-27T15:03:00.000Z', endTime: '2026-08-27T15:43:00.000Z',
        personName: 'Logan', clientName: '' },
    ]);

    test('renders one <li> per row, oldest first, so the spine runs forward in time', async () => {
      const r = await page.evaluate((rows) => {
        const html = _tlDayRailHtml(rows.slice().reverse());   // hand it backwards on purpose
        const d = document.createElement('div'); d.innerHTML = html;
        return { n: d.querySelectorAll('li.tl-rail-row').length,
                 kinds: [...d.querySelectorAll('li.tl-rail-row')].map(li => li.dataset.kind) };
      }, ROWS());
      expect(r.n).toBe(4);
      expect(r.kinds).toEqual(['load', 'drive', 'job', 'gap']);
    });

    test('every row carries a spine segment, which is what makes the line continuous', async () => {
      const r = await page.evaluate((rows) => {
        const d = document.createElement('div'); d.innerHTML = _tlDayRailHtml(rows);
        const lis = [...d.querySelectorAll('li.tl-rail-row')];
        return { spines: lis.filter(li => li.querySelector('.tl-rail-spine i')).length,
                 nodes: lis.filter(li => li.querySelector('.tl-rail-spine b')).length,
                 railVars: lis.every(li => /--rail:/.test(li.getAttribute('style') || '')) };
      }, ROWS());
      expect(r.spines, 'a missing segment is a visible break in the line').toBe(4);
      expect(r.nodes).toBe(4);
      expect(r.railVars).toBe(true);
    });

    // WCAG 1.4.1: colour is never the only carrier.
    test('each segment prints a word, not just a colour', async () => {
      const words = await page.evaluate((rows) => {
        const d = document.createElement('div'); d.innerHTML = _tlDayRailHtml(rows);
        return [...d.querySelectorAll('.tl-rail-tag')].map(e => e.textContent.trim());
      }, ROWS());
      expect(words[0]).toContain('Loading time');
      expect(words[1]).toContain('Drive time');
      expect(words[2]).toContain('On site');
      expect(words[3]).toContain('Unaccounted');
    });

    // Owner 2026-08-29: "don't want to say nothing recorded since that instills
    // doubt in the tracking".
    test('a hole never says "nothing recorded", it says where you were not and asks', async () => {
      const r = await page.evaluate((rows) => {
        const d = document.createElement('div'); d.innerHTML = _tlDayRailHtml(rows);
        const gap = d.querySelector('li[data-kind="gap"]');
        return { text: gap.textContent,
                 chips: [...gap.querySelectorAll('.tl-rail-chip')].map(c => c.textContent.trim()) };
      }, ROWS());
      expect(r.text).not.toMatch(/nothing recorded/i);
      expect(r.text).toContain('What was this time?');
      // Owner 2026-08-30, twice over: first the jargon went, then the whole
      // explaining sentence ("hate this just say what was this time?"). The
      // tag and the duration already carry everything the prose was saying.
      expect(r.text, 'no jargon a contractor would not use').not.toMatch(/geofence|motion|coremotion|gps/i);
      expect(r.text, 'no explaining sentence, just the question').not.toMatch(/tracking|job address|Away from/i);
      expect(r.chips.length).toBe(3);
      expect(r.chips[0]).toBe('Work time');
      expect(r.chips[2]).toBe('Personal');
    });

    // The hole hid its length while a sentence was spelling it out. With the
    // sentence gone the minutes have nowhere else to live, so they take the
    // right column like every other row, muted because they are not paid yet.
    test('a hole shows its length, muted; a real segment shows its own', async () => {
      const r = await page.evaluate((rows) => {
        const d = document.createElement('div'); d.innerHTML = _tlDayRailHtml(rows);
        const g = d.querySelector('li[data-kind="gap"] .tl-rail-dur');
        return { gap: g && g.textContent, muted: g && g.classList.contains('mute'),
                 drive: (d.querySelector('li[data-kind="drive"] .tl-rail-dur') || {}).textContent };
      }, ROWS());
      expect(r.gap).toContain('40');
      expect(r.muted, 'unpaid until he answers').toBe(true);
      expect(r.drive).toContain('9');
    });

    test('empty and junk input render nothing rather than throwing', async () => {
      const r = await page.evaluate(() => ({
        empty: _tlDayRailHtml([]), nul: _tlDayRailHtml(null),
        undef: _tlDayRailHtml(undefined), str: _tlDayRailHtml('nope'),
        junk: _tlDayRailHtml([null, undefined]),
      }));
      expect(r.empty).toBe('');
      expect(r.nul).toBe('');
      expect(r.undef).toBe('');
      expect(r.str).toBe('');
      // Written first as "renders something", which was my guess and not a
      // decision. A null row is not a segment: rendering a blank one hangs a
      // phantom node off the spine at a time nothing happened, so it is
      // dropped. The failure this assertion caused is what forced the choice.
      expect(r.junk, 'null rows are dropped, never drawn, and never throw').toBe('');
    });

    test('_tlRailKind classifies off the raw column, so a label rename cannot break it', async () => {
      const r = await page.evaluate(() => ({
        drive: _tlRailKind({ source: 'auto', rawSource: 'drive', detail: 'anything at all' }),
        renamed: _tlRailKind({ source: 'auto', rawSource: 'drive', detail: 'Drive time' }),
        old: _tlRailKind({ source: 'auto', detail: 'Driving' }),
        shop: _tlRailKind({ source: 'shop' }),
        load: _tlRailKind({ source: 'auto', rawSource: 'place-load' }),
        gap: _tlRailKind({ source: 'unaccounted' }),
        off: _tlRailKind({ source: 'auto', rawSource: 'stop', unpaid: true }),
        none: _tlRailKind(null),
      }));
      expect(r.drive).toBe('drive');
      expect(r.renamed).toBe('drive');
      expect(r.old, 'rows built without a raw column still classify by label').toBe('drive');
      expect(r.shop).toBe('shop');
      expect(r.load).toBe('load');
      expect(r.gap).toBe('gap');
      expect(r.off).toBe('off');
      expect(r.none).toBe('job');
    });

    // Owner 2026-08-29: "Break would need a toggle if they get paid on it or
    // not right?" FLSA shape: short rest breaks are compensable, a 30-minute
    // meal period need not be.
    test('break pay follows duration by default and the business setting when set', async () => {
      const r = await page.evaluate(() => {
        const prev = S.breakPaid;
        S.breakPaid = 'auto';
        const auto = { short: _tlBreakIsPaid(10), edge: _tlBreakIsPaid(20), meal: _tlBreakIsPaid(45) };
        S.breakPaid = 'paid';   const forcedPaid = _tlBreakIsPaid(45);
        S.breakPaid = 'unpaid'; const forcedUnpaid = _tlBreakIsPaid(5);
        S.breakPaid = prev;
        return { auto, forcedPaid, forcedUnpaid };
      });
      expect(r.auto.short).toBe(true);
      expect(r.auto.edge).toBe(true);
      expect(r.auto.meal).toBe(false);
      expect(r.forcedPaid, 'an explicit policy beats the duration rule').toBe(true);
      expect(r.forcedUnpaid).toBe(false);
    });

    test('the break chip says which way it will resolve BEFORE it is tapped', async () => {
      const r = await page.evaluate(() => {
        const mk = (mins, endIso) => {
          const d = document.createElement('div');
          d.innerHTML = _tlDayRailHtml([{ id: 'g', source: 'unaccounted', unpaid: true, minutes: mins,
            startTime: '2026-08-27T15:03:00.000Z', endTime: endIso, personName: 'L', clientName: '' }]);
          return [...d.querySelectorAll('.tl-rail-chip')].map(c => c.textContent.trim())[1];
        };
        const prev = S.breakPaid; S.breakPaid = 'auto';
        const out = { short: mk(10, '2026-08-27T15:13:00.000Z'), meal: mk(45, '2026-08-27T15:48:00.000Z') };
        S.breakPaid = prev;
        return out;
      });
      expect(r.short).toBe('Break · paid');
      expect(r.meal).toBe('Break · unpaid');
    });

    // The whole point of an unpaid answer: it must stay out of the paid total,
    // through the SAME unpaid path a geofenced lunch already uses.
    test('a personal answer writes an unpaid row that no paid total counts', async () => {
      const r = await page.evaluate(() => {
        const before = timeEntries.length;
        _tlAddUnaccounted('2026-08-27T15:03:00.000Z', '2026-08-27T15:43:00.000Z', 'personal');
        const e = timeEntries[timeEntries.length - 1];
        const row = { unpaid: e.unpaid, minutes: e.minutes };
        const paid = _tlPaidMin([row, { unpaid: false, minutes: 60 }]);
        timeEntries.length = before;
        return { added: e.unpaid, label: e.scope_label, mins: e.minutes, paid };
      });
      expect(r.added).toBe(true);
      expect(r.label).toContain('Personal');
      expect(r.mins).toBe(40);
      expect(r.paid, 'only the 60 paid minutes count').toBe(60);
    });

    test('a work answer is still paid, and the no-arg call is unchanged', async () => {
      const r = await page.evaluate(() => {
        const before = timeEntries.length;
        _tlAddUnaccounted('2026-08-27T15:03:00.000Z', '2026-08-27T15:43:00.000Z', 'work');
        const withKind = timeEntries[timeEntries.length - 1];
        _tlAddUnaccounted('2026-08-27T16:03:00.000Z', '2026-08-27T16:43:00.000Z');
        const noKind = timeEntries[timeEntries.length - 1];
        const out = { a: withKind.unpaid, b: noKind.unpaid, label: noKind.scope_label };
        timeEntries.length = before;
        return out;
      });
      expect(r.a).toBe(false);
      expect(r.b, 'the original one-button behaviour is untouched').toBe(false);
      expect(r.label).toBe('Added from unaccounted time');
    });

    test('a garbage span is refused rather than written', async () => {
      const r = await page.evaluate(() => {
        const before = timeEntries.length;
        _tlAddUnaccounted('nope', 'also nope', 'break');
        _tlAddUnaccounted('2026-08-27T15:43:00.000Z', '2026-08-27T15:03:00.000Z', 'break'); // backwards
        _tlAddUnaccounted(null, null, 'work');
        return timeEntries.length - before;
      });
      expect(r).toBe(0);
    });

    test('an unknown kind falls back to paid work rather than inventing a state', async () => {
      const r = await page.evaluate(() => {
        const before = timeEntries.length;
        _tlAddUnaccounted('2026-08-27T15:03:00.000Z', '2026-08-27T15:43:00.000Z', 'wat');
        const e = timeEntries[timeEntries.length - 1];
        const out = { unpaid: e.unpaid, label: e.scope_label };
        timeEntries.length = before;
        return out;
      });
      expect(r.unpaid).toBe(false);
      expect(r.label).toBe('Added from unaccounted time');
    });

    test('a stored unpaid manual entry reads back as unpaid, older entries as paid', async () => {
      const r = await page.evaluate(async () => {
        const before = timeEntries.slice();
        timeEntries.length = 0;
        timeEntries.push({ id: 91, date: '2026-08-27', minutes: 40, open: false,
          start_time: '2026-08-27T15:03:00.000Z', end_time: '2026-08-27T15:43:00.000Z',
          scope_label: 'Break (unpaid)', unpaid: true });
        timeEntries.push({ id: 92, date: '2026-08-27', minutes: 60, open: false,
          start_time: '2026-08-27T16:03:00.000Z', end_time: '2026-08-27T17:03:00.000Z',
          scope_label: 'Framing' });                       // no flag: every pre-existing entry
        const rows = await _timeLogRows();
        const out = { a: (rows.find(x => x.rawId === 91) || {}).unpaid,
                      b: (rows.find(x => x.rawId === 92) || {}).unpaid };
        timeEntries.length = 0; before.forEach(x => timeEntries.push(x));
        return out;
      });
      expect(r.a).toBe(true);
      expect(r.b, 'an entry written before this feature is paid, as it always was').toBe(false);
    });

    // WCAG 2.5.8 (24px) and the grid that makes 1.4.4/1.4.10 work.
    test('chips clear the 24px target minimum and the row uses flexible tracks', async () => {
      const r = await page.evaluate((rows) => {
        const host = document.createElement('div');
        host.style.width = '320px';
        host.innerHTML = _tlDayRailHtml(rows);
        document.body.appendChild(host);
        const chip = host.querySelector('.tl-rail-chip');
        const li = host.querySelector('li.tl-rail-row');
        const cs = getComputedStyle(li);
        const out = { chipH: chip.getBoundingClientRect().height,
                      cols: cs.gridTemplateColumns,
                      overflow: host.scrollWidth <= 321 };
        host.remove();
        return out;
      }, ROWS());
      expect(r.chipH).toBeGreaterThanOrEqual(24);
      expect(r.cols.split(' ').length, 'four tracks: time, spine, body, duration').toBe(4);
      expect(r.overflow, 'the rail must reflow at 320px, never bleed').toBe(true);
    });

    test('the day header totals the same buckets the employee card draws', async () => {
      const r = await page.evaluate((rows) => {
        const d = document.createElement('div');
        d.innerHTML = _tlRailHeadHtml(rows, 'Thu, Aug 27');
        const legend = [...d.querySelectorAll('.tl-rail-leg')].map(e => e.textContent.trim());
        const widths = [...d.querySelectorAll('.tl-split-bar span')]
          .map(e => parseFloat(e.style.width) || 0);
        return { day: d.querySelector('.tl-rail-head-day').textContent,
                 total: d.querySelector('.tl-rail-head-total').textContent,
                 legend, sum: Math.round(widths.reduce((a, b) => a + b, 0)),
                 dots: d.querySelectorAll('.tl-rail-leg i').length };
      }, ROWS());
      expect(r.day).toBe('Thu, Aug 27');
      // 11 + 9 + 120 paid; the 40m hole is unpaid and must not be in the total.
      expect(r.total).toContain('2h 20m');
      expect(r.sum, 'the bar always fills exactly once').toBe(100);
      expect(r.dots, 'every legend entry carries its colour as a dot').toBe(r.legend.length);
      expect(r.legend.join(' ')).toContain('Loading');
      expect(r.legend.join(' ')).toContain('Driving');
      expect(r.legend.join(' ')).toContain('On site');
    });

    test('loading is its own bucket, carved out of supply/other, in ONE aggregator', async () => {
      const r = await page.evaluate(() => {
        const agg = _tlEmpWeekAgg([
          { personUid: 'u', minutes: 6,  source: 'auto', rawSource: 'place-load' },
          { personUid: 'u', minutes: 20, source: 'auto', rawSource: 'place' },
          { personUid: 'u', minutes: 9,  source: 'auto', rawSource: 'drive' },
        ], 'c');
        const e = agg.u;
        return { load: e.loadMin, place: e.placeMin, drive: e.driveMin,
                 total: _tlBucketTotal(e), card: _tlEmpCardHtml('u', e, null, '') };
      });
      expect(r.load).toBe(6);
      expect(r.place, 'loading no longer hides inside supply/other').toBe(20);
      expect(r.drive).toBe(9);
      expect(r.total).toBe(35);
      expect(r.card, 'the card names it too, from the same table').toContain('Loading');
    });

    test('the sub-line is the clock and nothing else', async () => {
      const r = await page.evaluate((rows) => {
        const d = document.createElement('div'); d.innerHTML = _tlDayRailHtml(rows);
        return [...d.querySelectorAll('li:not([data-kind="gap"]) .tl-rail-sub')]
          .map(e => e.textContent.trim());
      }, ROWS());
      expect(r.length).toBeGreaterThan(0);
      r.forEach(t => {
        expect(t, 'start to end, that is the whole line').toMatch(/^\d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M$/);
        expect(t, 'the place is the title; it is not repeated underneath').not.toContain('Marcy');
      });
    });

    test('the header survives an empty day and rows with no buckets', async () => {
      const r = await page.evaluate(() => ({
        empty: _tlRailHeadHtml([], 'Thu'),
        nul: _tlRailHeadHtml(null, ''),
        junk: _tlRailHeadHtml([null, { unpaid: true, minutes: 30 }], 'Thu'),
      }));
      expect(r.empty).toContain('tl-rail-head');
      expect(r.nul).toContain('tl-rail-head');
      expect(r.junk, 'an all-unpaid day is 0m, never NaN').not.toMatch(/NaN/);
    });

    // Two identical dots in one legend is the ambiguity a legend exists to
    // remove, and colour is the only thing separating the entries there.
    test('every legend bucket has its own colour', async () => {
      const r = await page.evaluate(() => {
        const cs = _TL_BUCKETS.map(b => b.c);
        return { n: cs.length, unique: new Set(cs).size };
      });
      expect(r.unique).toBe(r.n);
    });

    // Owner 2026-08-30: "when I marked it as break unpaid it kept adding a
    // row." He was not double-tapping.
    test.describe('an answer closes the hole it answered', () => {
      test('an owner-logged answer and the owner GPS rows are ONE person', async () => {
        const r = await page.evaluate(() => {
          const CID = 'contractor-uid';
          // His real shape: GPS rows carry the contractor uid, the manual
          // answer carries null the way every owner-logged entry does.
          const gps = (a, b) => ({ personUid: CID, date: '2026-08-27', personName: 'L',
            startTime: a, endTime: b, source: 'auto' });
          const rows = [
            gps('2026-08-27T13:00:00.000Z', '2026-08-27T14:00:00.000Z'),
            gps('2026-08-27T15:00:00.000Z', '2026-08-27T16:00:00.000Z'),
          ];
          const holes = (rs) => _tlFillUnaccounted(rs, CID).filter(x => x.source === 'unaccounted');
          const before = holes(rows).length;
          const answered = rows.concat([{ personUid: null, date: '2026-08-27', personName: 'L',
            startTime: '2026-08-27T14:00:00.000Z', endTime: '2026-08-27T15:00:00.000Z',
            source: 'manual', unpaid: true }]);
          return { before, after: holes(answered).length };
        });
        expect(r.before, 'an hour between two GPS rows is a hole').toBe(1);
        expect(r.after, 'answering it closes it; this returned 1 forever before').toBe(0);
      });

      test('a crew member answering their own hole is still their own person', async () => {
        const r = await page.evaluate(() => {
          const gap = (uid) => _tlFillUnaccounted([
            { personUid: 'crew-1', date: '2026-08-27', personName: 'A', source: 'auto',
              startTime: '2026-08-27T13:00:00.000Z', endTime: '2026-08-27T14:00:00.000Z' },
            { personUid: 'crew-1', date: '2026-08-27', personName: 'A', source: 'auto',
              startTime: '2026-08-27T15:00:00.000Z', endTime: '2026-08-27T16:00:00.000Z' },
            { personUid: uid, date: '2026-08-27', personName: 'A', source: 'manual',
              startTime: '2026-08-27T14:00:00.000Z', endTime: '2026-08-27T15:00:00.000Z' },
          ], 'contractor-uid').filter(x => x.source === 'unaccounted').length;
          return { own: gap('crew-1'), someoneElse: gap('crew-2') };
        });
        expect(r.own).toBe(0);
        expect(r.someoneElse, "another person's entry never fills your hole").toBe(1);
      });

      // Owner 2026-08-30: "tapping personal set break unpaid, shouldn't it say
      // personal?" Answering again is a CORRECTION, not a duplicate and not a
      // no-op.
      test('answering the same span again corrects the row instead of adding one', async () => {
        const r = await page.evaluate(() => {
          const before = timeEntries.length;
          _tlAddUnaccounted('2026-08-27T18:00:00.000Z', '2026-08-27T18:34:00.000Z', 'break');
          const afterFirst = timeEntries.length;
          const first = timeEntries[timeEntries.length - 1];
          const firstId = first.id, firstLabel = first.scope_label;
          _tlAddUnaccounted('2026-08-27T18:00:00.000Z', '2026-08-27T18:34:00.000Z', 'personal');
          const e = timeEntries[timeEntries.length - 1];
          // A DIFFERENT span is still its own answer.
          _tlAddUnaccounted('2026-08-27T19:00:00.000Z', '2026-08-27T19:20:00.000Z', 'break');
          const out = { added: afterFirst - before, count: timeEntries.length - before,
                        firstLabel, sameRow: e.id === firstId,
                        label: e.scope_label, unpaid: e.unpaid };
          timeEntries.length = before;
          return out;
        });
        expect(r.added).toBe(1);
        expect(r.firstLabel).toContain('Break');
        expect(r.count, 'the correction plus one different span: two rows, not three').toBe(2);
        expect(r.sameRow, 'it edits the row he already made').toBe(true);
        expect(r.label, 'it says what he last tapped').toBe('Personal time (unpaid)');
        expect(r.unpaid).toBe(true);
      });

      test('a stack left by the old repeat bug collapses when he answers again', async () => {
        const r = await page.evaluate(() => {
          const before = timeEntries.slice();
          timeEntries.length = 0;
          // His live 08/27 shape: two Breaks and a Personal on one span.
          [['Break (unpaid)', 1], ['Break (unpaid)', 2], ['Personal time (unpaid)', 3]]
            .forEach(([label, n]) => timeEntries.push({ id: 6000 + n, date: '2026-08-27',
              open: false, fromGap: true, unpaid: true, minutes: 34, scope_label: label,
              start_time: '2026-08-27T17:13:54.000Z', end_time: '2026-08-27T17:48:05.000Z' }));
          _tlAddUnaccounted('2026-08-27T17:13:54.000Z', '2026-08-27T17:48:05.000Z', 'work');
          const out = { left: timeEntries.length, id: timeEntries[0] && timeEntries[0].id,
                        label: timeEntries[0] && timeEntries[0].scope_label,
                        unpaid: timeEntries[0] && timeEntries[0].unpaid };
          timeEntries.length = 0; before.forEach(x => timeEntries.push(x));
          return out;
        });
        expect(r.left, 'three become one').toBe(1);
        expect(r.id, 'the newest is the one he kept answering').toBe(6003);
        expect(r.label).toBe('Added from unaccounted time');
        expect(r.unpaid).toBe(false);
      });

    });

    // Owner 2026-08-30: a gap he answered on 08/29 was covered by a shop
    // session the dedupe sweep restored afterwards, and the day counted the
    // minutes twice.
    test.describe('a gap answer is re-checked against rows that arrive later', () => {
      test('_tlSubtractCovered returns what is genuinely left', async () => {
        const r = await page.evaluate(() => {
          const H = 3600000, t = (h, m) => Date.UTC(2026, 7, 27, h, m) ;
          return {
            none: _tlSubtractCovered(t(12, 0), t(13, 0), []).length,
            whole: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(11, 0), t(14, 0)]]).length,
            exact: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(12, 0), t(13, 0)]]).length,
            front: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(11, 0), t(12, 30)]])
                     .map(([a, b]) => (b - a) / 60000),
            back: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(12, 30), t(14, 0)]])
                    .map(([a, b]) => (b - a) / 60000),
            split: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(12, 20), t(12, 40)]])
                     .map(([a, b]) => (b - a) / 60000),
            // Sub-minute slivers are not rows.
            sliver: _tlSubtractCovered(t(12, 0), t(13, 0), [[t(12, 0), t(12, 59.5 / 60 * 60)]]).length,
            junk: _tlSubtractCovered(t(12, 0), t(13, 0), [null, undefined, [5, 1]]).length,
            nullCovers: _tlSubtractCovered(t(12, 0), t(13, 0), null).length,
          };
        });
        expect(r.none).toBe(1);
        expect(r.whole, 'fully covered leaves nothing').toBe(0);
        expect(r.exact).toBe(0);
        expect(r.front).toEqual([30]);
        expect(r.back).toEqual([30]);
        expect(r.split, 'a cover in the middle leaves two pieces').toEqual([20, 20]);
        expect(r.junk, 'malformed covers are ignored, never thrown on').toBe(1);
        expect(r.nullCovers).toBe(1);
      });

      const seed = async (page, rows) => page.evaluate((rows) => {
        // Latched TRUE while seeding: the boot chain can fire between a seed
        // and the test's own call, and an unlatched trim would eat the
        // seeded claims first (this happened; it showed as a once-in-a-run
        // flake). Each test flips the latch off itself, immediately before
        // its call, so nothing else can slip in.
        window._tlGapTrimRan = true;
        // AND the busy flag, which the latch alone does not cover. The latch
        // stops a boot-chain trim from doing work; it does nothing about one
        // that entered BEFORE the seed and is now parked on its own awaits
        // holding _tlGapTrimBusy. The test's call then hits the concurrency
        // guard (§11.2) and returns 0 without doing anything, and the test
        // measures the no-op. That is the midnight-clock failure of
        // 2026-08-30 ("newest wins" expected 1, received 0): load-dependent,
        // which is why it passed on a quiet runner and locally every time.
        // Cleared here rather than in the one test that happened to lose the
        // race, because every test in this block resets the latch the same
        // way and every one of them carries the same hole (§10.4). The guard
        // itself stays genuinely covered: the overlapping-invocations test
        // below fires five real concurrent calls and never touches the flag.
        window._tlGapTrimBusy = false;
        window.__tlPrevEntries = timeEntries.slice();
        timeEntries.length = 0;
        rows.forEach(r => timeEntries.push(r));
        // ── AND A RE-ARM THE TEST CALLS FROM INSIDE ITS OWN EVALUATE ────────
        // The seed above and the test's call are two SEPARATE page.evaluates,
        // and the app's own load chain runs in the gap between them. It does
        // not just trim (the latch covers that) or hold the busy flag (cleared
        // above): it REPLACES timeEntries wholesale. The seeded claim is then
        // gone by the time the call runs, claims.length is 0, and
        // _tlTrimCoveredGapRows takes its empty-claims branch, which LATCHES.
        // The test measuring the empty-covers interlock therefore sees a
        // latched sweep and reads it as "the interlock did not stay armed".
        //
        // That is the midnight-clock failure of 2026-08-31, and it is the same
        // family as the busy-flag one already fixed here: load-dependent, so it
        // passes on a quiet runner and locally every time, and only shows up
        // when 28 spec files share a machine.
        //
        // Nothing a seed can do from the outside closes a gap that opens after
        // it returns. So the arming moves INSIDE the caller's evaluate: this
        // closure re-applies the rows if they went missing, clears the guards,
        // and unlatches, all in one synchronous block with the call itself.
        window.__tlArm = () => {
          const want = rows || [];
          const missing = want.some(r => r && r.id != null &&
            !timeEntries.some(x => x && x.id === r.id));
          if (missing) { timeEntries.length = 0; want.forEach(r => timeEntries.push(r)); }
          window._tlGapTrimBusy = false;
          window._tlGapTrimRan = false;
        };
      }, rows);
      const restore = (page) => page.evaluate(() => {
        timeEntries.length = 0;
        (window.__tlPrevEntries || []).forEach(r => timeEntries.push(r));
        window.__tlPrevEntries = null;
      });
      // The real 08/27 shape: the shop session and the drive that now cover it.
      const COVERS = [
        ['2026-08-27T17:11:06.000Z', '2026-08-27T17:48:05.000Z'],
        ['2026-08-27T17:48:05.000Z', '2026-08-27T17:57:43.000Z'],
      ];
      // Narrow ONLY the two tables the sweep reads, and delegate every other
      // call straight back to the real shim.
      //
      // This used to replace the whole _supa client with a one-query shape
      // whose select() answered nothing but .is(). While it was installed,
      // ANY other code path that touched _supa broke: the reconnect probe
      // (_probeAndSync -> _onReconnect -> supaLoadFromCloud) calls
      // .select(...).eq(...), got a builder with no .eq, and logged a real
      // console error that landed in whichever spec asserted next. It only
      // fires when that probe happens to land inside this window, so it
      // passed locally and failed on CI shard 6 (2026-08-31), which is the
      // "a stub missing a method the real code calls" class in section 5.2.1.
      const SWEEP_TABLES = ['job_time_entries', 'shop_time_entries'];
      const withSupa = (page, covers) => page.evaluate(({ covers, SWEEP_TABLES }) => {
        window.__tlPrevSupa = window._supa;
        const real = window._supa;
        window._supa = Object.assign({}, real, {
          from: (tbl) => {
            if (SWEEP_TABLES.indexOf(tbl) < 0) return real.from(tbl);
            const rows = covers.map(([a, b]) => ({ arrived_at: a, departed_at: b }));
            const c = {
              select: () => c, is: () => c, eq: () => c, gte: () => c,
              lte: async () => ({ data: rows, error: null }),
              then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
            };
            return c;
          },
        });
        window.__tlPrevUser = window._supaUser;
        window._supaUser = { id: 'u1' };
        // The sweep persists through the normal save path when it changes
        // something. That path is not what these tests are about, and a stub
        // _supa that only answers the sweep's own reads makes it log a real
        // console error. Stubbed here so the assertions stay on the trimming.
        window.__tlPrevSave = window.supaSaveToCloud;
        window.__tlPrevSaveAll = window.saveAll;
        window.supaSaveToCloud = () => {};
        window.saveAll = () => {};
      }, { covers, SWEEP_TABLES });
      const unSupa = (page) => page.evaluate(() => {
        window._supa = window.__tlPrevSupa; window._supaUser = window.__tlPrevUser;
        window.supaSaveToCloud = window.__tlPrevSave; window.saveAll = window.__tlPrevSaveAll;
      });










      test('a new gap answer is stamped so the sweep never has to guess', async () => {
        const r = await page.evaluate(() => {
          const before = timeEntries.length;
          _tlAddUnaccounted('2026-08-27T21:00:00.000Z', '2026-08-27T21:30:00.000Z', 'work');
          const e = timeEntries[timeEntries.length - 1];
          const out = { fromGap: e.fromGap, eligible: _tlIsGapAnswer(e),
                        typed: _tlIsGapAnswer({ scope_label: 'Framing' }) };
          timeEntries.length = before;
          return out;
        });
        expect(r.fromGap).toBe(true);
        expect(r.eligible).toBe(true);
        expect(r.typed).toBe(false);
      });
    });

    test('row content is escaped, never injected', async () => {
      const r = await page.evaluate(() => {
        const d = document.createElement('div');
        d.innerHTML = _tlDayRailHtml([{ id: 'x', source: 'auto', rawSource: 'geofence', minutes: 5,
          startTime: '2026-08-27T13:03:00.000Z', endTime: '2026-08-27T13:08:00.000Z',
          personName: 'L', clientName: '<img src=x onerror=alert(1)>', addr: '' }]);
        return { imgs: d.querySelectorAll('img').length, text: d.textContent };
      });
      expect(r.imgs).toBe(0);
      expect(r.text).toContain('<img');
    });
  });


  // ── A base is somewhere the truck sleeps (owner + Jack, 2026-09-01) ────────
  //
  // Owner: "in my time log I see things adding up overnight when it shouldn't."
  // It was doing it to Jack too, four nights running: 1557, 1236, 764 and 720
  // minutes at 7402 SW 22nd Ct, his own house. The shop already answered to
  // the day's clock-out and to Central midnight. A home office is the same
  // kind of place and answered to neither, AND it counted as a work anchor,
  // so an overnight sit did not get judged against the workday, it defined it.
  //
  // Fixtures are his real rows, in Central (UTC-5 on these dates).
  test.describe('base dwell', () => {
    const HOME = '7402 SW 22nd Ct';
    const rowsFor = (entries) => page.evaluate(async (entries) => {
      if (typeof timeEntries === 'undefined') window.timeEntries = [];
      const orig = window._fetchCrewLabor, keep = places.slice();
      places.length = 0;
      places.push({ id: 'p-home', name: '7402 SW 22nd Ct', kind: 'home_office', lat: 39.0257, lon: -95.7939 });
      places.push({ id: 'p-hd', name: 'The Home Depot', kind: 'supply_house', lat: 39.03, lon: -95.70 });
      window._fetchCrewLabor = async () => ({ name: { me: 'Jack Schonfeldt' }, entries, shopEntries: [] });
      try { return await _timeLogRows(null); }
      finally { window._fetchCrewLabor = orig; places.length = 0; keep.forEach(p => places.push(p)); }
    }, entries);

    const P = (a, d, m, place) => ({ employee_user_id: 'me', minutes: m, source: 'place',
                                     dest_place: place, arrived_at: a, departed_at: d });
    const JOB = (a, d, m) => ({ employee_user_id: 'me', minutes: m, source: 'geofence',
                                job_id: 1, arrived_at: a, departed_at: d });
    const DRIVE = (a, d, m) => ({ employee_user_id: 'me', minutes: m, source: 'drive',
                                  arrived_at: a, departed_at: d });


    test('a home office INSIDE the workday still pays', async () => {
      // The rule bounds base dwell, it does not delete it. Paperwork between
      // two jobs is work and has to survive.
      const rows = await rowsFor([
        JOB('2026-08-31T13:00:00Z', '2026-08-31T15:00:00Z', 120),
        P('2026-08-31T15:30:00Z', '2026-08-31T16:00:00Z', 30, HOME),
        JOB('2026-08-31T16:30:00Z', '2026-08-31T21:00:00Z', 270),
      ]);
      const home = rows.filter(r => /22nd Ct/.test(String(r.clientName || '')));
      expect(home.length, 'half an hour between two jobs is real').toBe(1);
      expect(home[0].minutes).toBe(30);
    });

    test('home-office app time counts, even on a day with no drives at all', async () => {
      // Owner, 2026-09-01: "if it's a home office app time still counts."
      // The first cut of the base rule zeroed this: 45 minutes of real
      // paperwork rendered nothing at all, because 'place-office' matched the
      // same /^place/ predicate the raw dwell does. It is not the same thing.
      // place-office and place-load are the home-office rule's OWN output,
      // minutes the app or the motion chip already proved were work.
      const rows = await rowsFor([
        { employee_user_id: 'me', minutes: 45, source: 'place-office', dest_place: HOME,
          arrived_at: '2026-08-28T14:00:00Z', departed_at: '2026-08-28T14:45:00Z' },
      ]);
      const mine = rows.filter(r => r.date === '2026-08-28');
      expect(mine.length, 'the paperwork is on the log').toBe(1);
      expect(mine[0].minutes).toBe(45);
      expect(mine[0].unpaid, 'and it COUNTS, no drive required').toBe(false);
    });


    test('a supply house is NOT a base: it still ends the day', async () => {
      // The whole point of "the second fence crossing". Coming home is not
      // touching a business fence; a Home Depot run is.
      const rows = await rowsFor([
        P('2026-08-29T15:00:00Z', '2026-08-29T15:40:00Z', 40, 'The Home Depot'),
      ]);
      const hd = rows.filter(r => /Home Depot/.test(String(r.clientName || '')));
      expect(hd.length, 'a supply run on its own is still a workday').toBe(1);
      expect(hd[0].minutes).toBe(40);
    });

  });


  // ═════════════════════════════════════════════════════════════════════════
  // A manual clock and the GPS under it are the SAME hours (owner 2026-09-01)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // "when a manual clock is riding on the auto stuff they need to blend
  // together, so anything that completes two fences gets logged over it and
  // the total is correct, thats important."
  //
  // Before this they were summed. Jack's real day, measured through this exact
  // code before the fix: clock 07:42 to 17:00 plus a drive to Oakley, 93
  // minutes at the shop, a 62-minute drive and 44 minutes back came to
  // 12h57m for nine hours and twenty minutes of work.
  test.describe('manual clocks blend with the fences under them', () => {
    const D = '2026-09-01';
    const at = (h, m) => new Date(D + 'T' + String(h).padStart(2, '0') + ':' +
                                  String(m).padStart(2, '0') + ':00').toISOString();
    // Every row here names its instant outright rather than deriving one from
    // Date.now(), so the wall clock can never decide the outcome (§5.2.2).
    const rowsFor = (entries, manual) => page.evaluate(async ([es, ms]) => {
      const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
      const keepP = places.slice();
      // The clock-out cutoff asks "is this drive heading home", and it answers
      // by looking for a home_office in `places`. Without one seeded, nothing
      // is ever the house and the cutoff can never fire.
      places.length = 0;
      places.push({ id: 'p-home', name: '7402 SW 22nd Ct', kind: 'home_office', lat: 39.0257, lon: -95.7939 });
      places.push({ id: 'p-shop', name: '1200 SW Oakley Ave', kind: 'shop', lat: 39.0457, lon: -95.7151 });
      window.timeEntries = ms;
      const orig = window._fetchCrewLabor;
      window._fetchCrewLabor = async () => ({ name: { jack: 'Jack' }, entries: es, shopEntries: [] });
      try {
        const rows = await _timeLogRows(null);
        const day = rows.filter(r => r.date === '2026-09-01');
        return { paid: _tlPaidMin(day),
                 rows: day.map(r => ({ src: r.source, raw: r.rawSource || '', m: r.minutes,
                                       unpaid: !!r.unpaid, blended: r.blendedMin || 0,
                                       detail: r.detail || '', end: r.endTime || '' })) };
      } finally {
        window._fetchCrewLabor = orig;
        window.timeEntries = keepT;
        places.length = 0; keepP.forEach(p => places.push(p));
      }
    }, [entries, manual]);

    const CLOCK = (s, e, mins) => [{ id: 1, date: D, open: false, job_id: null, minutes: mins,
                                     start_time: at(s[0], s[1]), end_time: at(e[0], e[1]),
                                     logged_by_uid: 'jack', logged_by_name: 'Jack', scope_label: null }];
    const A = (src, s, e, mins) => ({ employee_user_id: 'jack', minutes: mins, source: src,
                                      dest_place: '1200 SW Oakley Ave',
                                      arrived_at: at(s[0], s[1]), departed_at: at(e[0], e[1]) });


    // ── The clock remainder is an unsaved job site ────────────────────────
    // Owner 2026-09-04: "if we see a manual clock in, and then there's
    // unaccounted for time after, meaning he's not inside a shop fence and is
    // still clocked in and not back home at his office, that means that
    // unaccounted for time is a unsaved job site."
    //
    // Jack's 1 September, from his own rows: a 438-minute clock, two shop
    // visits and two drives, and 2h 3m in the middle that the rail simply did
    // not mention. It was paid the whole time, sitting in the clock's
    // remainder with no name on it.
    test('the stretch no fence covered becomes a job site', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        A('place', [12, 0], [13, 0], 60),
      ], CLOCK([8, 0], [13, 0], 300));
      const site = r.rows.find(x => x.raw === 'site');
      expect(site, 'the three hours between the two visits').toBeTruthy();
      expect(site.m).toBe(180);
      expect(site.detail).toBe('Address not saved');
      expect(site.unpaid).toBe(false);
    });

    // The half that keeps payroll honest, and the reason the clock HANDS the
    // minutes over instead of keeping them: _tlPaidMin sums every row that is
    // not unpaid, so naming time must never also add it.
    test('naming the remainder changes no total', async () => {
      const rows = [A('place', [8, 0], [9, 0], 60), A('place', [12, 0], [13, 0], 60)];
      const r = await rowsFor(rows, CLOCK([8, 0], [13, 0], 300));
      expect(r.paid, 'exactly the clock, before and after').toBe(300);
      const clock = r.rows.find(x => x.src === 'manual');
      const site = r.rows.find(x => x.raw === 'site');
      expect(clock.m + site.m + 120, 'the clock gave up what the site took').toBe(300);
    });

    // His own escape hatch, and it needs no new UI.
    test('a gap between two clocks is nobody job site, it is still a question', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        A('place', [12, 0], [13, 0], 60),
      ], [
        { id: 1, date: D, open: false, job_id: null, minutes: 60, start_time: at(8, 0),
          end_time: at(9, 0), logged_by_uid: 'jack', logged_by_name: 'Jack' },
        { id: 2, date: D, open: false, job_id: null, minutes: 60, start_time: at(12, 0),
          end_time: at(13, 0), logged_by_uid: 'jack', logged_by_name: 'Jack' },
      ]);
      expect(r.rows.some(x => x.raw === 'site'), 'lunch is a clock out, not a guess').toBe(false);
      expect(r.rows.some(x => x.raw === 'unaccounted')).toBe(true);
    });

    // NO CLOCK, NO CLAIM. Nothing has asserted work, so nothing is named.
    test('an untracked stretch with no clock over it stays a question', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        A('place', [12, 0], [13, 0], 60),
      ], []);
      expect(r.rows.some(x => x.raw === 'site')).toBe(false);
      expect(r.rows.find(x => x.raw === 'unaccounted').unpaid).toBe(true);
    });

    // NO EVIDENCE, NO CLAIM (owner: "we make no inferences here"). Jack's 2
    // September: signed out at 08:17, so the day holds a clock and nothing
    // else. A whole shift named "job site" off a clock alone would be exactly
    // the inference this app must not make.
    test('a clock with nothing tracked under it at all is left alone', async () => {
      const r = await rowsFor([], CLOCK([8, 0], [16, 0], 480));
      expect(r.rows.some(x => x.raw === 'site')).toBe(false);
      expect(r.rows.find(x => x.src === 'manual').m).toBe(480);
      expect(r.paid).toBe(480);
    });

    // A sliver between two tracked rows is rounding, not a site visit.
    test('a few minutes between two rows is not a job site', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        A('place', [9, 2], [10, 0], 58),
      ], CLOCK([8, 0], [10, 0], 120));
      expect(r.rows.some(x => x.raw === 'site')).toBe(false);
    });

    // NOTHING IS INFERRED ABOUT WHERE (owner: "un saved mileage legs no they
    // cant and I wont do it ... this app was built to survive a IRS audit").
    test('a job site claims no address, and the rail says so out loud', async () => {
      const out = await page.evaluate(async ([es, ms]) => {
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { jack: 'Jack' }, entries: es, shopEntries: [] });
        try {
          const day = (await _timeLogRows(null)).filter(r => r.date === '2026-09-01');
          const site = day.find(r => r.rawSource === 'site');
          return { addr: site.addr, key: site.clientKey, name: site.clientName,
                   mileage: (typeof mileage !== 'undefined' && Array.isArray(mileage))
                     ? mileage.filter(m => m && m.date === '2026-09-01').length : 0,
                   html: _tlDayRailHtml(day) };
        } finally { window._fetchCrewLabor = orig; window.timeEntries = keepT; }
      }, [[A('place', [8, 0], [9, 0], 60), A('place', [12, 0], [13, 0], 60)], CLOCK([8, 0], [13, 0], 300)]);
      expect(out.addr).toBe('');
      expect(out.key).toBe(null);
      expect(out.name).toBe('Job site');
      expect(out.mileage, 'naming time never writes a mileage leg').toBe(0);
      // The tag carries the whole statement (owner 2026-09-04: "job site
      // should say unsaved job site"), and the row prints no title of its own
      // rather than repeating it.
      expect(out.html).toContain('Unsaved job site');
      // It must never read as the geofenced kind, which is what an audit turns
      // on. The two real 'place' rows in this fixture DO say "On site", so the
      // check is that the job-site row itself does not: its own block carries
      // the JOB SITE tag and the address disclaimer, never the saved-client one.
      const i = out.html.indexOf('Unsaved job site');
      expect(out.html.slice(i, i + 300)).not.toContain('On site');
    });

    // ── The punch list of 2026-09-04 ──────────────────────────────────────
    // "got two clock ins at 755 am and 1243 pm, 1243 should go away."
    // Jack's stray one ran 17:43:36 to 17:43:43. Seven seconds, and it drew a
    // full CLOCKED IN and CLOCKED OUT pair on his rail as if it were a shift.
    test('a seven-second clock is a thumb landing twice, not a shift', async () => {
      const r = await rowsFor([], [
        { id: 1, date: D, open: false, job_id: null, minutes: 470,
          start_time: at(7, 55), end_time: at(15, 45), logged_by_uid: 'jack', logged_by_name: 'Jack' },
        { id: 2, date: D, open: false, job_id: null, minutes: 1,
          start_time: '2026-09-01T12:43:36.394Z', end_time: '2026-09-01T12:43:43.576Z',
          logged_by_uid: 'jack', logged_by_name: 'Jack' },
      ]);
      expect(r.rows.filter(x => x.src === 'manual').length, 'the real clock, and only it').toBe(1);
      expect(r.paid).toBe(470);
    });

    // BOTH tests have to agree, or a real shift saved with placeholder times
    // would vanish off the rail.
    test('a short span with real minutes on it is still a shift', async () => {
      const r = await rowsFor([], [
        { id: 1, date: D, open: false, job_id: null, minutes: 480,
          start_time: at(8, 0), end_time: at(8, 0), logged_by_uid: 'jack', logged_by_name: 'Jack' },
      ]);
      expect(r.rows.filter(x => x.src === 'manual').length).toBe(1);
      expect(r.paid).toBe(480);
    });

    // "clock out also needs a edit button."
    test('both ends of the clock can be edited, not just the way in', async () => {
      const html = await page.evaluate(async ([es, ms]) => {
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { jack: 'Jack' }, entries: es, shopEntries: [] });
        try {
          return _tlDayRailHtml((await _timeLogRows(null)).filter(r => r.date === '2026-09-01'));
        } finally { window._fetchCrewLabor = orig; window.timeEntries = keepT; }
      }, [[A('place', [9, 0], [10, 0], 60)], CLOCK([8, 0], [16, 0], 480)]);
      const inCap = html.slice(html.indexOf('data-kind="clock-in"'));
      const outCap = html.slice(html.indexOf('data-kind="clock-out"'));
      expect(inCap.slice(0, inCap.indexOf('</li>'))).toContain('tl-rail-edit');
      expect(outCap.slice(0, outCap.indexOf('</li>')),
        'a wrong clock-out is as common as a wrong clock-in').toContain('tl-rail-edit');
    });

    // ── The clock-out is a hard cutoff ────────────────────────────────────
    // Owner 2026-09-04, on Jack's 31 August: "his day shouldve ended at his
    // clock out of 345 pm, no way a drive can extend past that."
    //
    // The real shape: he clocked out at 3:45 PM and the drive row ran to 5:24,
    // because he sat somewhere for 49 minutes on the way home and the leg
    // spans the stop. None of that is his dad's time.
    test('a drive straddling the clock-out is cut at it, minutes and all', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        { employee_user_id: 'jack', minutes: 64, source: 'drive', dest_place: '7402 SW 22nd Ct',
          arrived_at: at(9, 38), departed_at: at(11, 24) },
      ], CLOCK([8, 0], [9, 45], 105));
      const drive = r.rows.find(x => x.raw === 'drive');
      expect(drive, 'the part he drove while still on the clock').toBeTruthy();
      // 7 of the 106 minutes it spanned were on the clock, so 7/106 of its 64.
      expect(drive.m).toBe(4);
      // And the row itself ends at the clock-out, not at 11:24.
      expect(drive.end).toBe(at(9, 45));
    });

    // CLOCKING OUT IS NOT A PROMISE NEVER TO WORK AGAIN (owner 2026-09-04:
    // "clock out could be done for the day but what if we have another
    // automted drive after, from fence to fence we got more drive time and
    // more time on site"). A man can knock off, get called back, and drive
    // shop to client at six. That drive lands somewhere the business saved,
    // and the visit after it is real work the phone watched.
    test('a drive back to WORK after the clock-out stands, only the drive home is cut', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        { employee_user_id: 'jack', minutes: 20, source: 'drive', dest_place: '1200 SW Oakley Ave',
          arrived_at: at(18, 0), departed_at: at(18, 20) },
        A('place', [18, 20], [19, 0], 40),
        { employee_user_id: 'jack', minutes: 25, source: 'drive', dest_place: '7402 SW 22nd Ct',
          arrived_at: at(19, 0), departed_at: at(19, 25) },
      ], CLOCK([8, 0], [16, 0], 480));
      const drives = r.rows.filter(x => x.raw === 'drive');
      expect(drives.length, 'the one to the shop lives, the one home does not').toBe(1);
      expect(drives[0].m).toBe(20);
      // And the visit it delivered him to is untouched.
      expect(r.rows.filter(x => x.raw === 'place' && x.m === 40).length).toBe(1);
    });

    // A CLIENT VISIT IS NOT A COMMUTE. The rule the owner set on 2026-09-01,
    // "the fences are what happened; the clock adds nothing," still stands:
    // work the phone watched him do outlives a clock he forgot to stop.
    test('a work dwell that outlives the clock is untouched', async () => {
      const r = await rowsFor([A('place', [8, 0], [14, 0], 360)], CLOCK([8, 0], [10, 0], 120));
      const place = r.rows.find(x => x.raw === 'place');
      expect(place.m, 'six hours the phone actually watched').toBe(360);
      expect(r.paid).toBe(360);
    });

    // Rule 10's Office rows are after the clock-out BY DESIGN (owner
    // 2026-09-02: office is "for true app time after hours, that's it"), so
    // the cutoff must not touch them.
    test('an evening Office row survives the cutoff, because that is what it is for', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        { employee_user_id: 'jack', minutes: 20, source: 'place-office', dest_place: '7402 SW 22nd Ct',
          arrived_at: at(19, 0), departed_at: at(19, 20) },
      ], CLOCK([8, 0], [16, 0], 480));
      const off = r.rows.find(x => x.raw === 'place-office');
      expect(off, 'paperwork at home in the evening').toBeTruthy();
      expect(off.m).toBe(20);
    });

    // No clock, no cutoff: nothing has said when the day ended.
    test('with no clock at all nothing is cut', async () => {
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        { employee_user_id: 'jack', minutes: 30, source: 'drive', dest_place: 'X',
          arrived_at: at(18, 0), departed_at: at(18, 30) },
      ], []);
      expect(r.rows.some(x => x.raw === 'drive')).toBe(true);
      expect(r.paid).toBe(90);
    });

    test('the fences keep their own labels: the clock is the bracket, not the record', async () => {
      const r = await rowsFor([
        A('drive', [8, 0], [8, 30], 30),
        A('place', [8, 30], [10, 0], 90),
      ], CLOCK([8, 0], [10, 0], 120));
      // Nothing is hidden and nothing is merged away: three rows, and the two
      // the phone watched still say what they were.
      expect(r.rows.length).toBe(3);
      expect(r.rows.some(x => x.raw === 'drive')).toBe(true);
      expect(r.rows.some(x => x.raw === 'place')).toBe(true);
      expect(r.paid, 'exactly the clock').toBe(120);
    });

    test('a drive after the clock-out is a commute, and is cut at the clock-out', async () => {
      // REVERSED 2026-09-04 (10.4). This used to read "He clocked out and then
      // drove. That drive is real, it is inside the working day, and the clock
      // never claimed it, so both stand in full," and it asserted the drive
      // survived at its full 30 minutes.
      //
      // The owner overturned it on Jack's 31 August, where the drive row ran an
      // hour and a half past a 3:45 PM clock-out: "his day shouldve ended at
      // his clock out of 345 pm, no way a drive can extend past that ... after
      // 338 pm is a hard cutoff cause he clocked out." Once a man is off the
      // clock the drive home is a commute, and nobody pays for a commute.
      //
      // Only drives and unsaved job sites are cut. The rule this test used to
      // carry still holds for everything else: a client visit that outlives
      // the clock is work he forgot to clock, and 'fences that exceed the clock
      // never drive the day negative' below still proves it.
      //
      // FIXTURE NOTE, and it is the rule and not a workaround: the drive is
      // placed AFTER the anchoring place row rather than before it. A lone
      // drive at 06:00 with the day's only other row at 08:00 is dropped by
      // _geoRowInWorkday, which is deliberate and predates this change (a
      // drive outside the day's work window is not the day's work). Writing
      // the fixture the other way round proved nothing about blending and
      // everything about a gate this test is not for.
      // FIXTURE CHANGED 2026-09-01 (10.4): the drive used to end at the same
      // place the visit before it did, which _tlDemoteRoundTrips now withdraws
      // as an out-and-back (its own tests below). That shape proved nothing
      // about blending, so the drive goes somewhere else, which is what a
      // drive after clocking out normally does.
      const r = await rowsFor([A('place', [8, 0], [10, 0], 120),
                               { employee_user_id: 'jack', minutes: 30, source: 'drive',
                                 // HOME, not a client. A drive to a client after
                                 // the clock-out is going back to work and stands
                                 // (its own test above); only the run home is the
                                 // commute this test is about.
                                 dest_place: '7402 SW 22nd Ct',
                                 arrived_at: at(10, 0), departed_at: at(10, 30) }],
                              CLOCK([8, 0], [10, 0], 120));
      const man = r.rows.find(x => x.src === 'manual');
      // The place fully covers the clock, so the clock keeps nothing.
      expect(man.blended, 'only what is inside the window').toBe(120);
      expect(man.m).toBe(0);
      expect(r.rows.some(x => x.raw === 'drive'),
        'a drive that begins after the clock-out is gone entirely').toBe(false);
      expect(r.paid, 'the clock, and nothing after it').toBe(120);
    });

    test('a partial overlap is charged in proportion, not in full', async () => {
      // The 07:23 drive lands two of its twenty-one minutes inside the clock.
      // Deducting all twenty would push the day BELOW what the clock said.
      const r = await rowsFor([A('drive-unassigned', [7, 23], [7, 44], 20)],
                              CLOCK([7, 42], [17, 0], 558));
      const man = r.rows.find(x => x.src === 'manual');
      expect(man.blended).toBe(2);
      // The proportional charge is what this test is about and it is unchanged
      // at 2. What changed on 2026-09-04 is where the REST of the clock goes:
      // it used to sit on the clock row as 556 anonymous minutes, and is now
      // handed to a named job-site row (owner's rule, above). The number that
      // must not move is the day's total, and it does not.
      expect(man.m + (r.rows.find(x => x.raw === 'site') || { m: 0 }).m).toBe(556);
      expect(r.paid, 'the clock, plus the 18 minutes that ran before it').toBe(576);
    });

    test('an unpaid stop inside the clock is never deducted', async () => {
      // Docking a break off a clock is a payroll decision, and the owner has
      // been explicit that the office decides what to pay: the app logs, it
      // does not dock (2026-09-01, "its up to the office if they want to pay,
      // still log it").
      const r = await rowsFor([
        A('place', [8, 0], [9, 0], 60),
        { employee_user_id: 'jack', minutes: 30, source: 'stop',
          arrived_at: at(12, 0), departed_at: at(12, 30) },
      ], CLOCK([8, 0], [17, 0], 540));
      const man = r.rows.find(x => x.src === 'manual');
      expect(man.blended, 'only the place, never the lunch').toBe(60);
      // Same 2026-09-04 change: the 480 minutes the clock used to hold
      // anonymously are now named as job-site stretches around the lunch. The
      // lunch itself is STILL not deducted, which is what this test guards,
      // and the day still totals what it did.
      const sites = r.rows.filter(x => x.raw === 'site').reduce((n, x) => n + x.m, 0);
      expect(man.m + sites).toBe(480);
      expect(r.rows.some(x => x.raw === 'stop' && x.m === 30),
        'the lunch is still its own row, undeducted').toBe(true);
    });

    test('fences that exceed the clock never drive the day negative', async () => {
      // The phone saw more than he claimed. The fences are what happened; the
      // clock adds nothing. Inventing time back is the one thing this must
      // never do.
      const r = await rowsFor([A('place', [8, 0], [14, 0], 360)],
                              CLOCK([8, 0], [10, 0], 120));
      const man = r.rows.find(x => x.src === 'manual');
      expect(man.m).toBe(0);
      expect(r.paid).toBe(360);
    });

    test('two clocks over one drive deduct it once, never twice', async () => {
      const r = await page.evaluate(async ([es, ms]) => {
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { jack: 'Jack' }, entries: es, shopEntries: [] });
        try {
          const rows = (await _timeLogRows(null)).filter(r => r.date === '2026-09-01');
          return { paid: _tlPaidMin(rows),
                   manual: rows.filter(r => r.source === 'manual')
                               .map(r => ({ m: r.minutes, b: r.blendedMin || 0 })) };
        } finally { window._fetchCrewLabor = orig; window.timeEntries = keepT; }
      }, [
        [{ employee_user_id: 'jack', minutes: 60, source: 'place', dest_place: 'X',
           arrived_at: at(9, 0), departed_at: at(10, 0) }],
        [{ id: 1, date: D, open: false, job_id: null, minutes: 240,
           start_time: at(8, 0), end_time: at(12, 0),
           logged_by_uid: 'jack', logged_by_name: 'Jack' },
         { id: 2, date: D, open: false, job_id: null, minutes: 120,
           start_time: at(9, 30), end_time: at(11, 30),
           logged_by_uid: 'jack', logged_by_name: 'Jack' }],
      ]);
      // 60 comes off the earlier clock and nothing off the later one.
      const blended = r.manual.reduce((s, x) => s + x.b, 0);
      expect(blended, 'spent once, never twice').toBe(60);
      expect(r.paid).toBe(360);
    });


    // ── THE CLOCK BRACKETS THE DAY (owner 2026-09-01) ─────────────────────
    //
    // "on manual clock in it should grab the start time then the end at the
    // very end, not show the whole day, all the other shit while its duplicates
    // should overlay themselves on the manual bar so manual clock out extends."
    //
    // The previous cut drew the clock as a line item in the middle of the day
    // holding the leftover minutes. The arithmetic was right and the picture
    // was wrong: a seven-hour clock competing in a list with the very rows it
    // contains. It is the two ends of the day now, and nothing about the
    // numbers moved.
    test('a clock opens and closes the rail instead of sitting inside it', async () => {
      const html = await page.evaluate(([s1, e1, s2, e2]) => _tlDayRailHtml([
        { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 100, blendedMin: 338,
          clientName: '-', personUid: null, startTime: s1, endTime: e1 },
        { id: 'a1', source: 'auto', rawSource: 'place', date: '2026-09-01', minutes: 93,
          clientName: 'Shop', personUid: 'me', startTime: s2, endTime: e2 },
      ]), [at(7, 42), at(15, 0), at(7, 44), at(9, 17)]);
      expect(html).toContain('data-kind="clock-in"');
      expect(html).toContain('data-kind="clock-out"');
      expect(html).toContain('Clocked in');
      expect(html).toContain('Clocked out');
      // The clock's own total rides the closing cap, where a person looks for
      // it: 100 left + 338 explained = the 7h 18m actually clocked.
      expect(html).toContain('>7h 18m<');
      // ...and the leftover is NOT drawn as a competing row any more.
      expect(html).not.toContain('>1h 40m<');
      expect(html).not.toContain('tracked below');
      // The work sits BETWEEN the caps, which is the whole shape.
      const i = html.indexOf('clock-in'), j = html.indexOf('Shop'), k = html.indexOf('clock-out');
      expect(i).toBeGreaterThan(-1);
      expect(j).toBeGreaterThan(i);
      expect(k).toBeGreaterThan(j);
    });

    test('the clock is drawn once, never as a bracket AND a row', async () => {
      const html = await page.evaluate(([s1, e1]) => _tlDayRailHtml([
        { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 438,
          clientName: '-', personUid: null, startTime: s1, endTime: e1 },
      ]), [at(7, 42), at(15, 0)]);
      expect((html.match(/data-kind="manual"/g) || []).length,
        'the bracket replaces the row, it does not accompany it').toBe(0);
      expect((html.match(/data-kind="clock-in"/g) || []).length).toBe(1);
      expect((html.match(/data-kind="clock-out"/g) || []).length).toBe(1);
    });

    test('a still-running clock stays an ordinary row: half a bracket is worse than none', async () => {
      const html = await page.evaluate(([s1]) => _tlDayRailHtml([
        { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 0,
          clientName: '-', personUid: null, startTime: s1, endTime: null },
      ]), [at(7, 42)]);
      expect(html).not.toContain('clock-in');
      expect(html).toContain('data-kind="manual"');
    });

    test('a clock with a backwards or unreadable span never brackets anything', async () => {
      for (const [s1, e1] of [[at(15, 0), at(7, 42)], ['nope', 'also nope'], [at(7, 42), at(7, 42)]]) {
        const html = await page.evaluate(([a, b]) => _tlDayRailHtml([
          { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 60,
            clientName: '-', personUid: null, startTime: a, endTime: b },
        ]), [s1, e1]);
        expect(html, String(s1) + '/' + String(e1)).not.toContain('clock-in');
      }
    });

    test('work outside the clock is drawn outside the brackets', async () => {
      // His 7:23 drive ran before he clocked in. It is real, the clock never
      // claimed it, and it must not appear to have happened during the shift.
      const html = await page.evaluate(([ds, de, cs, ce]) => _tlDayRailHtml([
        { id: 'd1', source: 'auto', rawSource: 'drive', date: '2026-09-01', minutes: 20,
          clientName: 'Oakley', personUid: 'me', startTime: ds, endTime: de },
        { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 100, blendedMin: 338,
          clientName: '-', personUid: null, startTime: cs, endTime: ce },
      ]), [at(7, 23), at(7, 44), at(7, 42), at(15, 0)]);
      expect(html.indexOf('Oakley'), 'the early drive comes first')
        .toBeLessThan(html.indexOf('clock-in'));
    });

    test('two clocks in one day each get their own pair of caps', async () => {
      const html = await page.evaluate(([a, b, c, d]) => _tlDayRailHtml([
        { id: 'm1', source: 'manual', date: '2026-09-01', minutes: 120,
          clientName: '-', personUid: null, startTime: a, endTime: b },
        { id: 'm2', source: 'manual', date: '2026-09-01', minutes: 120,
          clientName: '-', personUid: null, startTime: c, endTime: d },
      ]), [at(7, 0), at(9, 0), at(13, 0), at(15, 0)]);
      expect((html.match(/data-kind="clock-in"/g) || []).length).toBe(2);
      expect((html.match(/data-kind="clock-out"/g) || []).length).toBe(2);
      // ...and they close in order, never both swept to the bottom.
      const outs = [...html.matchAll(/data-kind="clock-(in|out)"/g)].map(m => m[1]);
      expect(outs).toEqual(['in', 'out', 'in', 'out']);
    });

    test('a day with no clock at all is drawn exactly as before', async () => {
      const html = await page.evaluate(([s1, e1]) => _tlDayRailHtml([
        { id: 'a1', source: 'auto', rawSource: 'place', date: '2026-09-01', minutes: 93,
          clientName: 'Shop', personUid: 'me', startTime: s1, endTime: e1 },
      ]), [at(7, 44), at(9, 17)]);
      expect(html).not.toContain('clock-in');
      expect(html).toContain('Shop');
    });

    // DELETED 2026-09-01 (CLAUDE.md 7 and 10.4). Two tests lived here asserting
    // the clock row's sub-line read "7h 18m clocked, 5h 38m tracked below" beside
    // its leftover amount. That presentation lasted about an hour: the owner's
    // answer to it was that the clock should not be a row in the list at all,
    // and the bracket tests above cover the shape that replaced it. Keeping them
    // as skipped or rewritten would be keeping two answers to one question.
    //
    // The rule they were guarding, that a clock row must never show a span and
    // an amount that contradict each other, is now structural: the caps show
    // the two ends and the clocked total, and there is no leftover figure on
    // screen to disagree with anything.

    // ── A CLOCK IS NOT A LOCATION (owner 2026-09-01) ──────────────────────
    //
    // "9:17 to 11:17 wasnt all time spect at oakley remember, that was a
    // untracked address that should have shown grey as manual time."
    //
    // Those stops were in the data the whole time and the rail never drew one.
    // _tlStopAnchored vetoes a stop that any anchor OVERLAPS, on the argument
    // that the anchor proves the person was somewhere else. A fence proves
    // that. A manual clock does not: it brackets a shift, so it overlaps every
    // minute of the day by construction. Jack's clock ran 07:42 to 15:00 and
    // suppressed all six of his stops at once, including the untracked client
    // visit that was the actual work.
    test('a clock does not veto the stops inside it', async () => {
      const r = await page.evaluate(([es, ms]) => {
        window._supaUser = window._supaUser || { id: 'owner-blend-user', email: 'o@t.com' };
        const ME = window._supaUser.id;
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        const entries = es.map(e => ({ ...e, employee_user_id: ME }));
        window._fetchCrewLabor = async () => ({ name: { [ME]: 'Jack' }, entries, shopEntries: [] });
        return _timeLogRows(null)
          .then(rows => rows.filter(x => x.date === '2026-09-01')
            .map(x => ({ raw: x.rawSource || '', m: x.minutes, unpaid: !!x.unpaid })))
          .finally(() => { window._fetchCrewLabor = orig; window.timeEntries = keepT; });
      }, [
        // His real shape: shop, the untracked stop between two fences, shop.
        [{ minutes: 93, source: 'place', dest_place: '1200 SW Oakley Ave',
           arrived_at: at(7, 44), departed_at: at(9, 17) },
         { minutes: 63, source: 'stop', arrived_at: at(9, 48), departed_at: at(10, 51) },
         { minutes: 44, source: 'place', dest_place: '1200 SW Oakley Ave',
           arrived_at: at(11, 20), departed_at: at(12, 4) }],
        [{ id: 1, date: D, open: false, job_id: null, minutes: 438,
           start_time: at(7, 42), end_time: at(15, 0),
           logged_by_uid: null, logged_by_name: 'Jack' }],
      ]);
      const stop = r.find(x => x.raw === 'stop');
      expect(stop, 'the untracked client visit has to reach the rail').toBeTruthy();
      // Its own 63 minutes plus whatever _tlAbsorbGaps hands it: the drive to
      // and from an unpaid stop belongs to the stop, so the row is expected to
      // be LONGER than the raw fence, never shorter, and the day reads as one
      // continuous span rather than a list of islands.
      expect(stop.m).toBeGreaterThanOrEqual(63);
      expect(stop.m, 'it cannot swallow more than the window it sits in')
        .toBeLessThanOrEqual(123);
      // Still unpaid: showing it is not the same as counting it. The office
      // decides what to pay; the app's job is to stop hiding the hour.
      expect(stop.unpaid).toBe(true);
    });


    test('a clock bounds the stops inside it, so the afternoon is not dropped', async () => {
      // Every other anchor is a fence and bounds a stop by ABUTTING it. A clock
      // is the two ends of the shift, so it bounds by CONTAINING. Without that,
      // only stops with a fence on both sides survived, and Jack's afternoon
      // has no fence after it at all: he left the shop, saw an untracked client
      // and drove home. Four of his six stops, the whole back half of the
      // working day, were dropped for want of a trailing fence that was never
      // going to exist.
      const r = await page.evaluate(([es, ms]) => {
        window._supaUser = window._supaUser || { id: 'owner-blend-user', email: 'o@t.com' };
        const ME = window._supaUser.id;
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        const entries = es.map(e => ({ ...e, employee_user_id: ME }));
        window._fetchCrewLabor = async () => ({ name: { [ME]: 'Jack' }, entries, shopEntries: [] });
        return _timeLogRows(null)
          .then(rows => rows.filter(x => x.date === '2026-09-01' && x.rawSource === 'stop').length)
          .finally(() => { window._fetchCrewLabor = orig; window.timeEntries = keepT; });
      }, [
        // One fence in the morning and nothing after it, then three stops that
        // only the clock-out can close.
        [{ minutes: 44, source: 'place', dest_place: '1200 SW Oakley Ave',
           arrived_at: at(11, 20), departed_at: at(12, 4) },
         { minutes: 45, source: 'stop', arrived_at: at(12, 14), departed_at: at(13, 0) },
         { minutes: 23, source: 'stop', arrived_at: at(13, 8), departed_at: at(13, 31) },
         { minutes: 33, source: 'stop', arrived_at: at(14, 27), departed_at: at(14, 59) }],
        [{ id: 1, date: D, open: false, job_id: null, minutes: 438,
           start_time: at(7, 42), end_time: at(15, 0),
           logged_by_uid: null, logged_by_name: 'Jack' }],
      ]);
      expect(r, 'all three afternoon stops reach the rail').toBe(3);
    });


    test('an unplaceable stop is not called a break', async () => {
      // "that was a untracked address that should have shown grey as manual
      // time." A knife-and-fork icon and the word Break assert a reason nobody
      // supplied; on Jack's day they labelled four untracked client visits as
      // lunch. The row reads the same as the grey bucket it feeds.
      const meta = await page.evaluate(() => _TL_RAIL_META.off);
      expect(meta.word).toBe('Manual time');
      expect(meta.icon, 'a fork is a claim about what happened').not.toBe('🍽');
      const labels = await page.evaluate(() => _TL_BUCKETS.map(b => b.label));
      expect(labels, 'the row and its bucket say the same thing')
        .toContain(meta.word);
    });



    test('a place row with no shop session is untouched', async () => {
      // A supply house is a place and nothing else watches it.
      const r = await page.evaluate(([es]) => {
        window._supaUser = window._supaUser || { id: 'owner-blend-user', email: 'o@t.com' };
        const ME = window._supaUser.id;
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = [];
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { [ME]: 'J' },
          entries: es.map(e => ({ ...e, employee_user_id: ME })), shopEntries: [] });
        return _timeLogRows(null)
          .then(rows => rows.filter(x => x.date === '2026-09-01' && x.rawSource === 'place').length)
          .finally(() => { window._fetchCrewLabor = orig; window.timeEntries = keepT; });
      }, [[{ minutes: 30, source: 'place', dest_place: 'The Home Depot',
             arrived_at: at(10, 0), departed_at: at(10, 30) }]]);
      expect(r).toBe(1);
    });


    test('a drive to somewhere else is never withdrawn', async () => {
      const r = await page.evaluate(([es]) => {
        window._supaUser = window._supaUser || { id: 'owner-blend-user', email: 'o@t.com' };
        const ME = window._supaUser.id;
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = [];
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { [ME]: 'J' },
          entries: es.map(e => ({ ...e, employee_user_id: ME })), shopEntries: [] });
        return _timeLogRows(null)
          .then(rows => rows.filter(x => x.date === '2026-09-01' && x.roundTrip).length)
          .finally(() => { window._fetchCrewLabor = orig; window.timeEntries = keepT; });
      }, [[
        { minutes: 30, source: 'place', dest_place: 'The Home Depot',
          arrived_at: at(8, 0), departed_at: at(8, 30) },
        { minutes: 20, source: 'drive', dest_place: 'John Doe',
          arrived_at: at(8, 30), departed_at: at(8, 50) },
      ]]);
      expect(r, 'a real leg to a different place keeps its miles and its label').toBe(0);
    });

    test('the clock does not call its own hours unpaid', async () => {
      // "unpaid is wrong, it was paid." The day totals the clock, the clock
      // covers those hours, and the row said nobody paid for them.
      const r = await page.evaluate(([es, ms]) => {
        window._supaUser = window._supaUser || { id: 'owner-blend-user', email: 'o@t.com' };
        const ME = window._supaUser.id;
        const keepT = (typeof timeEntries !== 'undefined') ? timeEntries.slice() : [];
        window.timeEntries = ms;
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { [ME]: 'J' },
          entries: es.map(e => ({ ...e, employee_user_id: ME })), shopEntries: [] });
        return _timeLogRows(null)
          .then(rows => {
            const day = rows.filter(x => x.date === '2026-09-01');
            return { html: _tlDayRailHtml(day),
                     inside: day.filter(x => x.clockPaid).length,
                     paid: _tlPaidMin(day) };
          })
          .finally(() => { window._fetchCrewLabor = orig; window.timeEntries = keepT; });
      }, [
        [{ minutes: 93, source: 'place', dest_place: 'X', arrived_at: at(8, 0), departed_at: at(9, 33) },
         { minutes: 45, source: 'stop', arrived_at: at(12, 14), departed_at: at(13, 0) }],
        [{ id: 1, date: D, open: false, job_id: null, minutes: 438,
           start_time: at(7, 42), end_time: at(15, 0),
           logged_by_uid: null, logged_by_name: 'J' }],
      ]);
      expect(r.inside, 'the stop inside the clock is marked as covered').toBeGreaterThan(0);
      expect(r.html, 'and the row stops claiming otherwise').not.toContain('· unpaid');
      // It still does not ADD minutes: the clock is already counting them.
      expect(r.paid).toBe(438);
    });

    test('a stop outside any clock is still marked unpaid', async () => {
      const html = await page.evaluate(([s1, e1]) => _tlDayRailHtml([
        { id: 'x', source: 'auto', rawSource: 'stop', date: '2026-09-01', minutes: 45,
          unpaid: true, clientName: '-', personUid: 'me', startTime: s1, endTime: e1 },
      ]), [at(18, 0), at(18, 45)]);
      expect(html).toContain('· unpaid');
    });

    test('the clock remainder is manual time, not on-site labour', async () => {
      // Jack's Sept 1 legend read "On site 4h 59m" on a day whose rail holds no
      // on-site row at all, because every fence he crossed was the shop.
      const e = await page.evaluate(() => _tlBucketFold([
        { source: 'manual', minutes: 300, personUid: null },
      ]));
      expect(e.placeMin).toBe(300);
      expect(e.onsiteMin).toBe(0);
    });

    test('the grey bucket is named for what it holds', async () => {
      // "grey time should say Manual Time rather than supply/other."
      const labels = await page.evaluate(() => _TL_BUCKETS.map(b => b.label));
      expect(labels).toContain('Manual time');
      expect(labels).not.toContain('Supply/other');
    });

    test('a day with no manual clock at all is completely untouched', async () => {
      const r = await rowsFor([
        A('drive', [8, 0], [8, 30], 30),
        A('place', [8, 30], [10, 0], 90),
      ], []);
      expect(r.paid).toBe(120);
      expect(r.rows.every(x => (x.blended || 0) === 0)).toBe(true);
    });

    test('a manual clock with no fences under it is completely untouched', async () => {
      const r = await rowsFor([], CLOCK([8, 0], [17, 0], 540));
      const man = r.rows.find(x => x.src === 'manual');
      expect(man.m).toBe(540);
      expect(man.blended).toBe(0);
      expect(man.detail, 'nothing was tracked, so nothing is claimed').not.toContain('tracked below');
    });

    test('junk times never throw and never silently zero a clock', async () => {
      for (const bad of [
        [{ id: 1, date: D, open: false, minutes: 120, start_time: null, end_time: at(10, 0), logged_by_uid: 'jack' }],
        [{ id: 1, date: D, open: false, minutes: 120, start_time: 'nope', end_time: 'also nope', logged_by_uid: 'jack' }],
        [{ id: 1, date: D, open: false, minutes: 120, start_time: at(10, 0), end_time: at(8, 0), logged_by_uid: 'jack' }],
      ]) {
        const r = await rowsFor([{ employee_user_id: 'jack', minutes: 60, source: 'place',
                                   dest_place: 'X', arrived_at: at(8, 30), departed_at: at(9, 30) }], bad);
        const man = r.rows.find(x => x.src === 'manual');
        expect(man, JSON.stringify(bad[0].start_time)).toBeTruthy();
        expect(man.m, 'an unreadable window blends nothing rather than zeroing').toBe(120);
      }
    });
  });

  // The week has to move while you are looking at it (owner 2026-09-01: "for
  // the week rows, as data feeds, that needs to track in real time").
  test.describe('the chart tracks the day as it happens', () => {
    test('a live nudge repaints, and is a no-op when the page is not on screen', async () => {
      const r = await page.evaluate(async () => {
        const hadFn = typeof _tlLiveRefresh === 'function';
        const pg = document.getElementById('pg-timelog');
        const wasActive = pg?.classList.contains('active');
        pg?.classList.remove('active');
        let ranHidden = false;
        const origRe = window._tlRevalidateRows;
        window._tlRevalidateRows = async () => { ranHidden = true; return false; };
        _tlLiveRefresh();
        await new Promise(r2 => setTimeout(r2, 3200));
        window._tlRevalidateRows = origRe;
        if (wasActive) pg?.classList.add('active');
        return { hadFn, ranHidden };
      });
      expect(r.hadFn).toBe(true);
      // Three Supabase queries to repaint a page nobody is looking at.
      expect(r.ranHidden, 'a hidden page must never be repainted').toBe(false);
    });

    test('a burst of rows costs one repaint, not one per row', async () => {
      const r = await page.evaluate(async () => {
        const pg = document.getElementById('pg-timelog');
        const wasActive = pg?.classList.contains('active');
        pg?.classList.add('active');
        let calls = 0;
        const origRe = window._tlRevalidateRows;
        window._tlRevalidateRows = async () => { calls++; return false; };
        for (let i = 0; i < 12; i++) _tlLiveRefresh();
        await new Promise(r2 => setTimeout(r2, 3200));
        window._tlRevalidateRows = origRe;
        if (!wasActive) pg?.classList.remove('active');
        return { calls };
      });
      // A drive's flush lands a dozen rows in one second. Twelve renders would
      // be thirty-six Supabase queries and a chart flashing on a phone.
      expect(r.calls).toBe(1);
    });

    test('the live path bypasses the drill throttle, because the screen is actually wrong', async () => {
      const r = await page.evaluate(async () => {
        // The min-gap exists to stop a held-down drill arrow firing three
        // queries per tap. A row that genuinely changed is the opposite case.
        const src = String(_tlRevalidateRows);
        return { forced: /force&&_tlRowsAt/.test(src.replace(/\s/g, '')),
                 takesForce: /force/.test(src.slice(0, 120)) };
      });
      expect(r.takesForce).toBe(true);
      expect(r.forced).toBe(true);
    });
  });

  test('no console errors during time log tests', async () => {
    await assertNoErrors(page);
  });
});
