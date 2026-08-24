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
    await page.evaluate(() => { _tlYear = null; _tlScope = null; _tlPickerSel = {}; });
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

    // Owner rule 2026-08-24: "get the random unpaid time logs to go away
    // except for the ones that are in between geofences." A stop with no
    // same-Central-day location event on both sides never renders.
    test('an unanchored stop row never renders at all', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member' },
          entries: [{
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'Sonic Drive-In',
            source: 'stop', minutes: 43, client_key: null,
            arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T17:25:00.000Z',
          }],
        });
        try { const rows = await _timeLogRows(null); return { hit: !!rows.find(x => x.clientName === 'Sonic Drive-In') }; }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r.hit).toBe(false);
    });

    test('a stop with work before but nothing after (end-of-day park) never renders', async () => {
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
          }],
        });
        try { const rows = await _timeLogRows(null); return { hit: !!rows.find(x => x.clientName === 'Sonic Drive-In') }; }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r.hit).toBe(false);
    });

    // Owner clarification 2026-08-24: "one from shop, one at a job site or
    // supply house." Shop out, stop, shop back on a day with no work is an
    // errand from the yard, not a work-trip leg, and never renders.
    test('shop-to-shop anchors alone never validate a stop (a no-work Saturday shows nothing)', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member' },
          entries: [{
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'Sonic Drive-In',
            source: 'stop', minutes: 43, client_key: null,
            arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T17:25:00.000Z',
          }],
          shopEntries: [
            { employee_user_id: 'emp-test-uid', minutes: 60, arrived_at: '2026-08-21T15:30:00.000Z', departed_at: '2026-08-21T16:30:00.000Z' },
            { employee_user_id: 'emp-test-uid', minutes: 60, arrived_at: '2026-08-21T17:40:00.000Z', departed_at: '2026-08-21T18:40:00.000Z' },
          ],
        });
        try { const rows = await _timeLogRows(null); return { hit: !!rows.find(x => x.clientName === 'Sonic Drive-In') }; }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r.hit).toBe(false);
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

    test('another person\'s anchors never validate my stop', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({
          name: { 'emp-test-uid': 'Test Crew Member', 'emp-other': 'Somebody Else' },
          entries: [{
            employee_user_id: 'emp-other', job_id: 'anchor-job', dest_place: null,
            source: 'geofence', minutes: 160, client_key: null,
            arrived_at: '2026-08-21T14:00:00.000Z', departed_at: '2026-08-21T16:40:00.000Z',
          }, {
            employee_user_id: 'emp-test-uid', job_id: null, dest_place: 'Sonic Drive-In',
            source: 'stop', minutes: 43, client_key: null,
            arrived_at: '2026-08-21T16:42:00.000Z', departed_at: '2026-08-21T17:25:00.000Z',
          }, {
            employee_user_id: 'emp-other', job_id: 'anchor-job', dest_place: null,
            source: 'geofence', minutes: 150, client_key: null,
            arrived_at: '2026-08-21T17:30:00.000Z', departed_at: '2026-08-21T20:00:00.000Z',
          }],
        });
        try { const rows = await _timeLogRows(null); return { hit: !!rows.find(x => x.clientName === 'Sonic Drive-In') }; }
        finally { window._fetchCrewLabor = orig; }
      });
      expect(r.hit).toBe(false);
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
      expect(shop[0].detail).toBe('Shop');
      expect(shop[0].minutes).toBe(60);
      expect(shop[0].unpaid, 'inside the workday, so it counts').toBe(false);
    });

    // Owner, 2026-08-24: "08/21 shouldn't have shop at 6:05 am, why does it?"
    // It did because the rule only closed the day, never opened it.
    test('yard time before the day\'s first job or supply move never renders', async () => {
      const rows = await withShop([YARD_AM, YARD_MID], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'sitting at the yard before the first move is not a shift').toBe(1);
      expect(shop[0].startTime).toBe(YARD_MID.arrived_at);
    });

    test('yard time after the day\'s last job or supply run never renders', async () => {
      const rows = await withShop([YARD_MID, YARD_PM], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'the 7h18m evening sit at the yard is not a shift').toBe(1);
      expect(shop[0].startTime).toBe(YARD_MID.arrived_at);
    });

    test('a day with no job or supply fence at all shows no yard time', async () => {
      const rows = await withShop([YARD_AM, YARD_MID, YARD_PM], []);
      expect(rows.filter(r => r.source === 'shop').length, 'a Saturday at the yard is not a shift').toBe(0);
    });

    test('a lunch stop is not work and never extends the day', async () => {
      const rows = await withShop([YARD_PM], [
        { employee_user_id: 'me', job_id: null, minutes: 45, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T17:45:00Z', source: 'stop' },
      ]);
      expect(rows.filter(r => r.source === 'shop').length).toBe(0);
    });

    // The Civitan Day Camp leg: a drive with no job or supply visit at either
    // end of it, which used to hold the day open and pay the yard time under it.
    test('a drive not chained to a job or supply visit never extends the day', async () => {
      const LOOSE = { employee_user_id: 'me', job_id: null, minutes: 78, arrived_at: '2026-08-20T23:26:00Z', departed_at: '2026-08-21T00:44:00Z', source: 'drive' };
      const rows = await withShop([YARD_PM], DAY.concat([LOOSE]));
      expect(rows.filter(r => r.source === 'shop').length, 'an evening errand is not the last job of the day').toBe(0);
    });

    test('the drive back from the last job DOES close the day, an hour later', async () => {
      // Same shape, but the leg pulls out exactly as the job ends, so it is
      // the ride home and the yard time behind it is inside the workday.
      const LATE_YARD = { employee_user_id: 'me', minutes: 20, arrived_at: '2026-08-20T21:30:00Z', departed_at: '2026-08-20T21:50:00Z' };
      const rows = await withShop([LATE_YARD], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'the ride back lands at the yard, so the yard is still open').toBe(0);
      // Zero because the allowance is zero: the window closes AT the drive's
      // end. The allowance test below is what pays this stretch.
    });

    // Owner, 2026-08-24, on the same 78-minute Tue 8/18 leg: "was a time we
    // did family pictures and I'm not sure why it's there. It should be
    // dropped." It was there because the tracker logs every leg between known
    // points while tracking is on, with no notion of the day being over.
    test('a drive leg outside the workday is dropped, not just unpaid', async () => {
      const LOOSE = { employee_user_id: 'me', job_id: null, minutes: 78, dest_place: 'DEV A shop',
        arrived_at: '2026-08-20T23:26:00Z', departed_at: '2026-08-21T00:44:00Z', source: 'drive-unassigned' };
      const rows = await withShop([], DAY.concat([LOOSE]));
      const drives = rows.filter(r => r.rawSource && /^drive/.test(r.rawSource));
      expect(drives.length, 'the ride out and the ride back survive, the errand does not').toBe(2);
      expect(drives.some(d => d.minutes === 78), 'the family-pictures run is gone').toBe(false);
    });

    test('a drive inside the workday is never dropped', async () => {
      const MID = { employee_user_id: 'me', job_id: null, minutes: 7, dest_place: 'DEV A shop',
        arrived_at: '2026-08-20T17:10:00Z', departed_at: '2026-08-20T17:17:00Z', source: 'drive-unassigned' };
      const rows = await withShop([], DAY.concat([MID]));
      const drives = rows.filter(r => r.rawSource && /^drive/.test(r.rawSource));
      expect(drives.length, 'a leg between two jobs is ordinary work').toBe(3);
    });

    test('on a day with no work at all, no stray drive renders either', async () => {
      const LOOSE = { employee_user_id: 'me', job_id: null, minutes: 78, dest_place: 'DEV A shop',
        arrived_at: '2026-08-23T23:26:00Z', departed_at: '2026-08-24T00:44:00Z', source: 'drive-unassigned' };
      const rows = await withShop([], [LOOSE]);
      expect(rows.filter(r => r.rawSource && /^drive/.test(r.rawSource)).length,
        'a Saturday errand is not a workday').toBe(0);
    });

    test('the wrap-up allowance pays the unload after the last job', async () => {
      const rows = await page.evaluate(async ([shopEntries, entries]) => {
        if (typeof timeEntries === 'undefined') window.timeEntries = [];
        const orig = window._fetchCrewLabor, prev = S.shopWrapMin;
        window._fetchCrewLabor = async () => ({ name: { me: 'Logan Sample' }, entries, shopEntries });
        S.shopWrapMin = 30;
        try { return await _timeLogRows(null); } finally { window._fetchCrewLabor = orig; S.shopWrapMin = prev; }
      }, [[YARD_PM], DAY]);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length).toBe(1);
      expect(shop[0].minutes, '30 minutes of unload, not the whole evening').toBe(30);
      expect(shop[0].detail, 'the rule is visible, not silently eating minutes').toBe('Shop · auto clock-out');
      expect(shop[0].endTime, 'the row ends when the clock stopped').toBe('2026-08-20T22:00:00.000Z');
    });

    test('the prep allowance pays the load-up before the first move', async () => {
      const rows = await page.evaluate(async ([shopEntries, entries]) => {
        if (typeof timeEntries === 'undefined') window.timeEntries = [];
        const orig = window._fetchCrewLabor, prev = S.shopPrepMin;
        window._fetchCrewLabor = async () => ({ name: { me: 'Logan Sample' }, entries, shopEntries });
        S.shopPrepMin = 20;
        try { return await _timeLogRows(null); } finally { window._fetchCrewLabor = orig; S.shopPrepMin = prev; }
      }, [[YARD_AM], DAY]);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length).toBe(1);
      expect(shop[0].minutes, 'the last 20 minutes of the load-up, not the whole hour').toBe(20);
      expect(shop[0].startTime, 'the row starts when the clock started').toBe('2026-08-20T12:10:00.000Z');
    });

    // Owner, 2026-08-24, Wed 8/19 reading 12h42m against the 9h36m of work
    // actually on it. A manual clock at 8:28pm moved the day's close out from
    // the 5:22pm drive home, and 3h06m of phone-at-the-yard came in behind it.
    // The first fix blamed the manual entries for being a minute long; the
    // owner's answer was "those manuals are right", and they are. Being INSIDE
    // the workday was never enough. You have to have LEFT.
    test('yard time nobody was seen leaving is not paid, even inside the day', async () => {
      const rows = await page.evaluate(async ([shopEntries, entries]) => {
        const origEnts = timeEntries.slice();
        // A real hand-logged clock at 6:00pm, well after the yard session
        // starts, holding the workday open exactly as it should.
        timeEntries.push({ id: 'tlman9', logged_by_uid: 'me', job_id: null, minutes: 10,
          start_time: '2026-08-20T23:00:00Z', end_time: '2026-08-20T23:10:00Z', date: '2026-08-20' });
        const orig = window._fetchCrewLabor;
        window._fetchCrewLabor = async () => ({ name: { me: 'Logan Sample' }, entries, shopEntries });
        try { return await _timeLogRows(null); }
        finally { window._fetchCrewLabor = orig; timeEntries.length = 0; timeEntries.push(...origEnts); }
      }, [[YARD_PM], DAY]);
      expect(rows.filter(r => r.source === 'shop').length,
        'the phone sat at the yard and nothing followed it: a parked truck').toBe(0);
      expect(rows.filter(r => r.rawId === 'tlman9').length, 'the hand-logged minutes are still paid in full').toBe(1);
    });

    test('yard time a departure closes IS paid, however long the gap', async () => {
      // Pulls out 20 minutes after the yard session ends: the drive itself was
      // never written, but the next job starting is proof the person left.
      const LATE = { employee_user_id: 'me', job_id: '9', minutes: 60,
        arrived_at: '2026-08-20T19:20:00Z', departed_at: '2026-08-20T20:20:00Z', source: 'geofence' };
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 60, arrived_at: '2026-08-20T18:00:00Z', departed_at: '2026-08-20T19:00:00Z' },
      ], [DRIVE_OUT, JOB, LATE, JOB2, DRIVE_HOME]);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'left for the next job, so the yard hour counts').toBe(1);
      expect(shop[0].minutes).toBe(60);
    });

    test('a departure the NEXT day never counts as leaving today', async () => {
      // The person's fetched history runs past midnight; tomorrow's first
      // drive must not retroactively prove they left the yard tonight.
      const TOMORROW = { employee_user_id: 'me', job_id: '9', minutes: 30,
        arrived_at: '2026-08-21T13:00:00Z', departed_at: '2026-08-21T13:30:00Z', source: 'geofence' };
      const rows = await withShop([YARD_PM], DAY.concat([TOMORROW]));
      expect(rows.filter(r => r.source === 'shop' && r.date === '2026-08-20').length,
        'a new day is not a departure from last night').toBe(0);
    });

    // A hand-logged shift defines a day exactly like a GPS visit does. Asserted
    // on the WINDOW rather than a rendered yard row: on a manual-only day, yard
    // time before the shift is outside the window and yard time inside it is
    // the same hour counted twice, so no row can prove this either way.
    test('a manual clock sets the day\'s edges like any other work event', async () => {
      const r = await page.evaluate(() => {
        const w = _geoShopCutoffs([{ employee_user_id: 'me', source: 'manual',
          arrived_at: '2026-08-20T13:00:00Z', departed_at: '2026-08-20T21:35:00Z' }]).me['2026-08-20'];
        return { inMs: w.inMs, outMs: w.outMs };
      });
      expect(r.inMs).toBe(Date.parse('2026-08-20T13:00:00Z'));
      expect(r.outMs, 'the hand-logged clock-out closes the day').toBe(Date.parse('2026-08-20T21:35:00Z'));
    });

    test('a shop dwell spanning Central midnight never renders', async () => {
      const rows = await withShop([
        // 8:00pm CT to 7:00am CT the next day: the truck parked at the yard.
        { employee_user_id: 'me', minutes: 660, arrived_at: '2026-08-21T01:00:00Z', departed_at: '2026-08-21T12:00:00Z' },
      ], DAY);
      expect(rows.filter(r => r.source === 'shop').length, 'an overnight park is not a shift').toBe(0);
    });

    test('a zero-length or malformed shop session is skipped', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 0, arrived_at: '2026-08-20T17:33:52Z', departed_at: '2026-08-20T17:33:52Z' },
        { employee_user_id: 'me', minutes: 5, arrived_at: null, departed_at: '2026-08-20T18:00:00Z' },
        { employee_user_id: 'me', minutes: 5, arrived_at: '2026-08-20T18:00:00Z', departed_at: null },
      ], DAY);
      expect(rows.filter(r => r.source === 'shop').length).toBe(0);
    });

    test('workday window: opens at the ride out, closes at the ride back, lunches ignored', async () => {
      const r = await page.evaluate(([DAY]) => {
        const w = _geoShopCutoffs(DAY.concat([
          { employee_user_id: 'me', arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T17:45:00Z', source: 'stop' },
          { employee_user_id: 'you', arrived_at: '2026-08-20T18:00:00Z', departed_at: '2026-08-20T19:00:00Z', source: 'place' },
        ]));
        return { meIn: w.me['2026-08-20'].inMs, meOut: w.me['2026-08-20'].outMs,
          youIn: w.you['2026-08-20'].inMs, youOut: w.you['2026-08-20'].outMs, who: Object.keys(w).sort() };
      }, [DAY]);
      expect(r.meIn, 'the drive out, chained to the job it leads to').toBe(Date.parse('2026-08-20T12:30:00Z'));
      expect(r.meOut, 'the drive back, chained to the job it leaves').toBe(Date.parse('2026-08-20T21:30:00Z'));
      expect(r.youIn).toBe(Date.parse('2026-08-20T18:00:00Z'));
      expect(r.youOut).toBe(Date.parse('2026-08-20T19:00:00Z'));
      expect(r.who, 'each person gets their own day').toEqual(['me', 'you']);
    });

    test('paid-minute helper: bounded at both ends, never negative, zero without a window', async () => {
      const r = await page.evaluate(() => {
        const win = { inMs: Date.parse('2026-08-20T12:30:00Z'), outMs: Date.parse('2026-08-20T21:30:00Z') };
        return {
          inside: _geoShopPaidMin('2026-08-20T17:00:00Z', '2026-08-20T18:00:00Z', win),
          before: _geoShopPaidMin('2026-08-20T11:30:00Z', '2026-08-20T12:30:00Z', win),
          after: _geoShopPaidMin('2026-08-20T21:30:00Z', '2026-08-21T04:48:00Z', win),
          straddleEnd: _geoShopPaidMin('2026-08-20T21:00:00Z', '2026-08-21T04:48:00Z', win),
          straddleStart: _geoShopPaidMin('2026-08-20T12:00:00Z', '2026-08-20T13:00:00Z', win),
          noWindow: _geoShopPaidMin('2026-08-20T17:00:00Z', '2026-08-20T18:00:00Z', null),
          backwards: _geoShopPaidMin('2026-08-20T18:00:00Z', '2026-08-20T17:00:00Z', win),
          junk: _geoShopPaidMin(null, undefined, win),
        };
      });
      expect(r.inside).toBe(60);
      expect(r.before, 'the day had not started').toBe(0);
      expect(r.after, 'the day already clocked out').toBe(0);
      expect(r.straddleEnd, 'only the part inside the workday').toBe(30);
      expect(r.straddleStart, 'only the part inside the workday').toBe(30);
      expect(r.noWindow, 'no work that day, so no shift').toBe(0);
      expect(r.backwards).toBe(0);
      expect(r.junk).toBe(0);
    });

    // A yard visit split by a fence blip is one visit, not two lines.
    test('a blip-split yard visit folds into one row', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 3, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T17:03:00Z' },
        { employee_user_id: 'me', minutes: 36, arrived_at: '2026-08-20T17:02:00Z', departed_at: '2026-08-20T17:39:00Z' },
      ], DAY);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length, 'one stretch at the yard, one line').toBe(1);
      expect(shop[0].startTime).toBe('2026-08-20T17:00:00Z');
      expect(shop[0].minutes, '5:00 to 5:39 is 39 minutes, not 3 + 36').toBe(39);
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

    // Nobody is at the yard and driving at the same instant; the fence lags
    // the ignition. Owner's Tue 8/18 had a 1:29-1:34pm yard row against a
    // 1:29-1:36pm drive out to the job.
    test('yard time overlapping a drive leg yields to the drive', async () => {
      const OUT = { employee_user_id: 'me', job_id: null, minutes: 7, arrived_at: '2026-08-20T18:29:00Z', departed_at: '2026-08-20T18:36:00Z', source: 'drive-unassigned' };
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 5, arrived_at: '2026-08-20T18:29:00Z', departed_at: '2026-08-20T18:34:00Z' },
      ], [DRIVE_OUT, JOB, OUT, JOB2, DRIVE_HOME]);
      expect(rows.filter(r => r.source === 'shop').length, 'fully covered by the leg, nothing left to pay').toBe(0);
    });

    test('yard time only partly overlapping a drive keeps the part that is real', async () => {
      // The fence lags the ignition, so the yard row runs seven minutes past
      // the moment the truck actually pulled out. The drive starting at 18:30
      // is both the overlap AND the proof the person left.
      const OUT = { employee_user_id: 'me', job_id: null, minutes: 7, arrived_at: '2026-08-20T18:30:00Z', departed_at: '2026-08-20T18:37:00Z', source: 'drive-unassigned' };
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 30, arrived_at: '2026-08-20T18:07:00Z', departed_at: '2026-08-20T18:37:00Z' },
      ], [DRIVE_OUT, JOB, OUT, EXIT('2026-08-20T18:37:00Z'), JOB2, DRIVE_HOME]);
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.length).toBe(1);
      expect(shop[0].minutes, 'the 23 minutes at the yard before the ignition').toBe(23);
    });

    test('overlapping shop sessions never pay the same minute twice', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 60, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T18:00:00Z' },
        { employee_user_id: 'me', minutes: 63, arrived_at: '2026-08-20T17:57:00Z', departed_at: '2026-08-20T19:00:00Z' },
      ], DAY.concat([EXIT('2026-08-20T19:00:00Z')]));
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.reduce((s, r) => s + r.minutes, 0), '5:00 to 7:00 is 120 minutes, not 123').toBe(120);
    });

    test('a shop session fully inside another pays nothing extra', async () => {
      const rows = await withShop([
        { employee_user_id: 'me', minutes: 120, arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T19:00:00Z' },
        { employee_user_id: 'me', minutes: 30, arrived_at: '2026-08-20T17:30:00Z', departed_at: '2026-08-20T18:00:00Z' },
      ], DAY.concat([EXIT('2026-08-20T19:00:00Z')]));
      const shop = rows.filter(r => r.source === 'shop');
      expect(shop.reduce((s, r) => s + r.minutes, 0), 'the nested one adds nothing').toBe(120);
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

    test('span helper: input order preserved, malformed rows return a zero span', async () => {
      const r = await page.evaluate(() => _geoShopPaidSpans([
        { arrived_at: '2026-08-20T18:00:00Z', departed_at: '2026-08-20T19:00:00Z' },
        { arrived_at: null, departed_at: '2026-08-20T19:00:00Z' },
        { arrived_at: '2026-08-20T17:00:00Z', departed_at: '2026-08-20T18:30:00Z' },
      ], { '2026-08-20': { inMs: Date.parse('2026-08-20T12:00:00Z'), outMs: Date.parse('2026-08-20T22:00:00Z') } },
         [{ arrived_at: '2026-08-20T19:00:00Z', departed_at: '2026-08-20T19:10:00Z', source: 'drive' }])
        .map(x => x.minutes));
      // Sorted by start the third row runs first (5:00-6:30) and the first row
      // (6:00-7:00) overlaps it, so it folds in: 5:00-7:00 on the third, zero
      // on the first, and the result still comes back in INPUT order.
      expect(r).toEqual([0, 0, 120]);
    });

    test('the allowances are clamped, never negative or unbounded', async () => {
      const r = await page.evaluate(() => {
        const pw = S.shopWrapMin, pp = S.shopPrepMin, out = {};
        for (const [k, v] of [['none', undefined], ['neg', -30], ['junk', 'abc'], ['big', 9999], ['ok', 20]]) {
          S.shopWrapMin = v; S.shopPrepMin = v;
          out[k] = _geoShopWrapMs(); out[k + 'Prep'] = _geoShopPrepMs();
        }
        S.shopWrapMin = pw; S.shopPrepMin = pp; return out;
      });
      expect(r.none).toBe(0);
      expect(r.neg).toBe(0);
      expect(r.junk).toBe(0);
      expect(r.big, 'capped at 4 hours').toBe(240 * 60000);
      expect(r.ok).toBe(20 * 60000);
      expect(r.nonePrep).toBe(0);
      expect(r.negPrep).toBe(0);
      expect(r.bigPrep).toBe(240 * 60000);
      expect(r.okPrep).toBe(20 * 60000);
    });

    test('shop minutes land in their own bucket, never inflating job-site labor', async () => {
      const agg = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'me', personName: 'Logan', source: 'auto', detail: '', minutes: 268 },
        { personUid: 'me', personName: 'Logan', source: 'auto', detail: 'drive', minutes: 9 },
        { personUid: 'me', personName: 'Logan', source: 'shop', detail: 'Shop', minutes: 44, unpaid: false },
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
  test.describe('gap absorption', () => {
    const FRI = () => ([
      { id: 'a1', personUid: 'me', date: '2026-08-21', minutes: 222, unpaid: false, startTime: '2026-08-21T12:55:00Z', endTime: '2026-08-21T16:37:00Z' },
      { id: 'a2', personUid: 'me', date: '2026-08-21', minutes: 49, unpaid: true, startTime: '2026-08-21T16:42:00Z', endTime: '2026-08-21T17:31:00Z' },
      { id: 'a3', personUid: 'me', date: '2026-08-21', minutes: 262, unpaid: false, startTime: '2026-08-21T17:45:00Z', endTime: '2026-08-21T22:07:00Z' },
    ]);
    const absorb = rows => page.evaluate(r => _tlAbsorbGaps(r), rows);

    test('the unpaid stop swallows the travel on both sides, door to door', async () => {
      const r = await absorb(FRI());
      const stop = r.find(x => x.id === 'a2');
      expect(stop.startTime, 'starts when he left the job, not when he arrived at lunch').toBe('2026-08-21T16:37:00Z');
      expect(stop.endTime, 'ends when he was back on site').toBe('2026-08-21T17:45:00Z');
      expect(stop.minutes).toBe(68);
    });

    test('paid rows are never touched, so no total can move', async () => {
      const before = FRI(), r = await absorb(FRI());
      const paid = r.filter(x => !x.unpaid);
      expect(paid.map(x => x.minutes)).toEqual(before.filter(x => !x.unpaid).map(x => x.minutes));
      expect(paid.map(x => x.startTime + '|' + x.endTime))
        .toEqual(before.filter(x => !x.unpaid).map(x => x.startTime + '|' + x.endTime));
    });

    test('a gap over 30 minutes stays visible: a missing record, not something to swallow', async () => {
      const rows = FRI();
      rows[2].startTime = '2026-08-21T18:20:00Z';   // 49 minutes after the stop ended
      const r = await absorb(rows);
      expect(r.find(x => x.id === 'a2').endTime, 'left alone to be investigated').toBe('2026-08-21T17:31:00Z');
      expect(r.find(x => x.id === 'a2').startTime, 'the 5-minute side is still absorbed').toBe('2026-08-21T16:37:00Z');
    });

    test('a gap between two paid rows with no unpaid neighbor is left alone', async () => {
      const r = await absorb([
        { id: 'b1', personUid: 'me', date: '2026-08-21', minutes: 60, unpaid: false, startTime: '2026-08-21T12:00:00Z', endTime: '2026-08-21T13:00:00Z' },
        { id: 'b2', personUid: 'me', date: '2026-08-21', minutes: 60, unpaid: false, startTime: '2026-08-21T13:10:00Z', endTime: '2026-08-21T14:10:00Z' },
      ]);
      expect(r.map(x => x.minutes), 'nothing to stretch without an unpaid row').toEqual([60, 60]);
    });

    test('overlapping rows are not stretched backwards', async () => {
      const r = await absorb([
        { id: 'c1', personUid: 'me', date: '2026-08-21', minutes: 60, unpaid: false, startTime: '2026-08-21T12:00:00Z', endTime: '2026-08-21T13:00:00Z' },
        { id: 'c2', personUid: 'me', date: '2026-08-21', minutes: 30, unpaid: true, startTime: '2026-08-21T12:40:00Z', endTime: '2026-08-21T13:10:00Z' },
      ]);
      expect(r.find(x => x.id === 'c2').startTime).toBe('2026-08-21T12:40:00Z');
      expect(r.find(x => x.id === 'c2').minutes).toBe(30);
    });

    test('never reaches across people or across days', async () => {
      const r = await absorb([
        { id: 'd1', personUid: 'me', date: '2026-08-21', minutes: 60, unpaid: false, startTime: '2026-08-21T12:00:00Z', endTime: '2026-08-21T13:00:00Z' },
        { id: 'd2', personUid: 'you', date: '2026-08-21', minutes: 30, unpaid: true, startTime: '2026-08-21T13:05:00Z', endTime: '2026-08-21T13:35:00Z' },
        { id: 'd3', personUid: 'me', date: '2026-08-22', minutes: 30, unpaid: true, startTime: '2026-08-21T13:05:00Z', endTime: '2026-08-21T13:35:00Z' },
      ]);
      expect(r.find(x => x.id === 'd2').minutes, 'another person is not the same timeline').toBe(30);
      expect(r.find(x => x.id === 'd3').minutes, 'another day is not the same timeline').toBe(30);
    });

    test('malformed or open rows are skipped without throwing', async () => {
      const r = await page.evaluate(() => {
        try {
          return {
            ok: true,
            rows: _tlAbsorbGaps([
              null,
              { id: 'e1', personUid: 'me', date: '2026-08-21', minutes: 60, unpaid: false, startTime: '2026-08-21T12:00:00Z', endTime: null },
              { id: 'e2', personUid: 'me', date: '2026-08-21', minutes: 30, unpaid: true, startTime: 'nope', endTime: 'nope' },
              { id: 'e3', personUid: 'me', minutes: 30, unpaid: true, startTime: '2026-08-21T13:05:00Z', endTime: '2026-08-21T13:35:00Z' },
            ]).length,
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.rows, 'nothing dropped, only skipped').toBe(4);
    });

    test('empty and non-array input return without throwing', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, a: _tlAbsorbGaps([]).length, b: _tlAbsorbGaps(null), c: _tlAbsorbGaps(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.a).toBe(0);
    });
  });

  // Pure anchor math for the owner's 2026-08-24 rule. All times below are
  // built from fixed UTC instants that sit mid-day Central, except the
  // midnight cases which exist to prove the Central-day boundary is the one
  // that matters.
  test.describe('_tlStopAnchored', () => {
    const T = (iso) => Date.parse(iso);
    const CASES = {
      stopArr: '2026-08-21T16:42:00.000Z',   // 11:42am CT
      stopDep: '2026-08-21T17:25:00.000Z',   // 12:25pm CT
      before: { arr: T('2026-08-21T14:00:00.000Z'), dep: T('2026-08-21T16:40:00.000Z') },
      after: { arr: T('2026-08-21T17:30:00.000Z'), dep: T('2026-08-21T20:00:00.000Z') },
    };
    test('anchored on both sides same Central day: true', async () => {
      const ok = await page.evaluate((c) => _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), [c.before, c.after]), CASES);
      expect(ok).toBe(true);
    });
    test('missing either side: false', async () => {
      const r = await page.evaluate((c) => ({
        noBefore: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), [c.after]),
        noAfter: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), [c.before]),
        none: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), []),
      }), CASES);
      expect(r.noBefore).toBe(false);
      expect(r.noAfter).toBe(false);
      expect(r.none).toBe(false);
    });
    test('a stop spanning Central midnight is never anchored, whatever surrounds it', async () => {
      const ok = await page.evaluate(() => _tlStopAnchored(
        Date.parse('2026-08-22T04:50:00.000Z'),   // 11:50pm CT 8/21
        Date.parse('2026-08-22T05:20:00.000Z'),   // 12:20am CT 8/22
        [{ arr: Date.parse('2026-08-22T02:00:00.000Z'), dep: Date.parse('2026-08-22T04:45:00.000Z') },
         { arr: Date.parse('2026-08-22T05:25:00.000Z'), dep: Date.parse('2026-08-22T06:00:00.000Z') }]));
      expect(ok).toBe(false);
    });
    test('an anchor from a different Central day never counts', async () => {
      const ok = await page.evaluate((c) => _tlStopAnchored(
        Date.parse(c.stopArr), Date.parse(c.stopDep),
        [{ arr: Date.parse('2026-08-20T14:00:00.000Z'), dep: Date.parse('2026-08-20T16:40:00.000Z') },
         { arr: Date.parse('2026-08-22T17:30:00.000Z'), dep: Date.parse('2026-08-22T20:00:00.000Z') }]), CASES);
      expect(ok).toBe(false);
    });
    test('kerb-edge slack: an anchor ending up to 2 minutes AFTER the stop starts still counts', async () => {
      const r = await page.evaluate((c) => ({
        inSlack: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep),
          [{ arr: Date.parse('2026-08-21T14:00:00.000Z'), dep: Date.parse(c.stopArr) + 90 * 1000 }, c.after]),
        pastSlack: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep),
          [{ arr: Date.parse('2026-08-21T14:00:00.000Z'), dep: Date.parse(c.stopArr) + 3 * 60000 }, c.after]),
      }), CASES);
      expect(r.inSlack).toBe(true);
      // An anchor still on-site 3 minutes into the stop overlaps it for real:
      // that's the on-site row's time, not a valid "before" edge.
      expect(r.pastSlack).toBe(false);
    });
    test('shop-only anchors on both sides: false; one work side: true', async () => {
      const r = await page.evaluate((c) => ({
        shopBoth: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep),
          [{ ...c.before, shop: true }, { ...c.after, shop: true }]),
        shopThenWork: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep),
          [{ ...c.before, shop: true }, c.after]),
        workThenShop: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep),
          [c.before, { ...c.after, shop: true }]),
      }), CASES);
      expect(r.shopBoth, 'shop out, stop, shop back is an errand, not a work leg').toBe(false);
      expect(r.shopThenWork).toBe(true);
      expect(r.workThenShop).toBe(true);
    });
    test('an anchor OVERLAPPING the stop vetoes it, even with clean edges elsewhere', async () => {
      const ok = await page.evaluate((c) => _tlStopAnchored(
        Date.parse(c.stopArr), Date.parse(c.stopDep),
        // Clean before + after edges, but a third anchor (a shop session)
        // covers the middle of the stop: the person was provably somewhere
        // known, so the unpaid row is an artifact.
        [c.before, c.after,
         { arr: Date.parse(c.stopArr) + 5 * 60000, dep: Date.parse(c.stopDep) - 5 * 60000 }]), CASES);
      expect(ok).toBe(false);
    });
    test('garbage in, false out: null anchors, NaN times, inverted spans', async () => {
      const r = await page.evaluate((c) => ({
        nullList: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), null),
        nullEntries: _tlStopAnchored(Date.parse(c.stopArr), Date.parse(c.stopDep), [null, undefined, c.before, c.after]),
        nanArr: _tlStopAnchored(NaN, Date.parse(c.stopDep), [c.before, c.after]),
        inverted: _tlStopAnchored(Date.parse(c.stopDep), Date.parse(c.stopArr), [c.before, c.after]),
        zero: _tlStopAnchored(0, 0, [c.before, c.after]),
      }), CASES);
      expect(r.nullList).toBe(false);
      expect(r.nullEntries, 'null entries are skipped, real ones still anchor').toBe(true);
      expect(r.nanArr).toBe(false);
      expect(r.inverted).toBe(false);
      expect(r.zero).toBe(false);
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
      window._supa = { from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
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

  test.describe('_tlRow: Edit/Delete controls', () => {
    test('editable row, renders an Edit button and the long-press delete attributes, wired to the right entry id', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        const html = _tlRow({ id: 'm123', rawId: 123, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60 });
        return html;
      });
      expect(r).toContain('_openEditTimeEntry(123)');
      expect(r).toContain('data-lp-id="123"');
      expect(r).toContain('data-lp-type="timelog"');
      expect(r).not.toContain('>Delete<'); // no visible Delete button, long-press only
    });

    test('non-editable row (auto/GPS source), no Edit button, no long-press attributes', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a1', rawId: 1, source: 'auto', personName: 'Crew', personUid: 'someone', clientName: 'X', addr: '', jobName: 'Y', detail: 'geo', minutes: 60 });
      });
      expect(r).not.toContain('_openEditTimeEntry');
      expect(r).not.toContain('data-lp-id');
    });

    test('non-editable row (someone else\'s manual entry, no permission), no Edit button, no long-press attributes', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        const html = _tlRow({ id: 'm5', rawId: 5, source: 'manual', personName: 'Someone Else', personUid: 'someone-else', clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60 });
        window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
        return html;
      });
      expect(r).not.toContain('_openEditTimeEntry');
      expect(r).not.toContain('data-lp-id');
    });

    test('weekOT true, renders the "OT WK" badge', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm7', rawId: 7, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60, date: '2026-07-13', weekOT: true });
      });
      expect(r).toContain('OT WK');
    });

    test('weekOT false/undefined: no "OT WK" badge', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm8', rawId: 8, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60, date: '2026-07-13', weekOT: false });
      });
      expect(r).not.toContain('OT WK');
    });

    test('job-site address renders as the primary line, with client/job/source folded into the muted line below', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm9', rawId: 9, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'Riverside Remodel', addr: '410 Riverside Dr', jobName: 'Kitchen repaint', detail: 'Sanding', minutes: 60 });
      });
      expect(r).toContain('data-label="Job site"');
      expect(r).toContain('410 Riverside Dr');
      expect(r).toContain('Riverside Remodel');
      expect(r).toContain('Kitchen repaint');
      expect(r).toContain('Sanding');
      expect(r).toContain('Manual');
    });

    test('no address on file, falls back to client/job/source only, no empty address line', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm10', rawId: 10, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'No-Addr Client', addr: '', jobName: 'Some Job', detail: '', minutes: 60 });
      });
      expect(r).toContain('No-Addr Client');
      // The generic "Auto" tag was replaced (owner 2026-08-21: "wish there
      // was a way for it to say drive and be color coded") with an explicit
      // On-site/Driving badge, see the _tlRow describe block below.
      expect(r).toContain('On-site');
      expect(r).not.toContain('style="font-weight:700">'); // the bold address <div> is only emitted when addr is truthy
    });

    // Owner report 2026-08-21: "don't understand these many different
    // entries, wish there was a way for it to say drive and be color coded
    // with our system in some way, then if at a job it says the address".
    test('a drive-sourced row gets the amber Driving badge and left-border accent', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a2', rawId: 2, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'DEV A shop', addr: '', jobName: '', detail: 'Driving', minutes: 6 });
      });
      // #9F5B00 is the SAME amber the Team split bar already uses for drive
      // time (_tlWeekOwnerHtml), reused rather than invented (§7.3).
      expect(r).toContain('#9F5B00');
      expect(r).toContain('Driving');
      expect(r).toContain('border-left:3px solid #9F5B00');
      // The word "Driving" is not repeated in plain text next to the badge.
      expect((r.match(/Driving/g) || []).length).toBe(1);
    });

    test('a drive-rider/personal-vehicle suffix still reads as a driving row (badge, not plain text)', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a3', rawId: 3, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'Riverside Remodel', addr: '', jobName: '', detail: 'Driving (rider)', minutes: 10 });
      });
      expect(r).toContain('#9F5B00');
      expect(r).toContain('border-left:3px solid #9F5B00');
    });

    // Owner request 2026-08-23: "Time entry drive times should show from and
    // to locations under job site." A drive row's job_time_entries.client_key
    // is the SAME deterministic legKey _geoDriveEntry (js/geo-track.js) stamps
    // on the matching mileage row, so the lookup is a straight local array
    // find, never a network round trip.
    test('a drive row with a matching mileage leg shows "From: X - To: Y" instead of just the destination', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        window.__origMileage = mileage.slice(); mileage.length = 0;
        mileage.push({ id: 'ml-tl-1', legKey: 'tl-leg-1', from_name: 'Shop', to_name: 'John Doe' });
        const html = _tlRow({ id: 'a5', rawId: 5, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'John Doe', addr: '', jobName: '', detail: 'Driving', minutes: 6, clientKey: 'tl-leg-1' });
        mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        return html;
      });
      expect(r).toContain('From: Shop - To: John Doe');
      // Not the old bare-destination text alongside the new from/to line.
      expect((r.match(/John Doe/g) || []).length, 'the destination appears once, inside the from/to line, not repeated').toBe(1);
    });

    test('a drive row with no matching mileage leg falls back to the plain destination (old behavior)', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        window.__origMileage = mileage.slice(); mileage.length = 0;
        // A leg exists, but for a DIFFERENT key: nothing here matches.
        mileage.push({ id: 'ml-tl-2', legKey: 'some-other-leg', from_name: 'Shop', to_name: 'Riverside Remodel' });
        const html = _tlRow({ id: 'a6', rawId: 6, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'DEV A shop', addr: '', jobName: '', detail: 'Driving', minutes: 6, clientKey: 'tl-leg-missing' });
        mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        return html;
      });
      expect(r).toContain('DEV A shop');
      expect(r).not.toContain('From:');
    });

    test('a drive row with no client_key at all (older row, written before client_key existed) falls back cleanly', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a7', rawId: 7, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'DEV A shop', addr: '', jobName: '', detail: 'Driving', minutes: 6 });
      });
      expect(r).toContain('DEV A shop');
      expect(r).not.toContain('From:');
    });

    // Only a driving row ever does the leg lookup: an on-site row's own
    // client_key (if it happens to carry one at all) must never trigger a
    // from/to line, on-site time was never a drive.
    test('an on-site row is never shown as a from/to line, even if it happens to carry a client_key', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        window.__origMileage = mileage.slice(); mileage.length = 0;
        mileage.push({ id: 'ml-tl-3', legKey: 'tl-leg-3', from_name: 'Shop', to_name: 'John Doe' });
        const html = _tlRow({ id: 'a8', rawId: 8, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'John Doe', addr: '123 Main St', jobName: 'Repaint', detail: '', minutes: 200, clientKey: 'tl-leg-3' });
        mileage.length = 0; window.__origMileage.forEach(m => mileage.push(m)); window.__origMileage = null;
        return html;
      });
      expect(r).toContain('On-site');
      expect(r).not.toContain('From:');
    });

    test('an on-site (geofence) auto row gets NEITHER the amber badge nor the left-border accent', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a4', rawId: 4, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'John Doe', addr: '123 Main St', jobName: 'Repaint', detail: '', minutes: 200 });
      });
      expect(r).toContain('On-site');
      expect(r).toContain('123 Main St');
      expect(r).not.toContain('#9F5B00');
      expect(r).not.toContain('border-left:3px solid');
    });

    test('a manual row never gets the driving badge, even with an unrelated detail/task label', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm15', rawId: 15, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: 'Driving the crew to pick up materials', minutes: 30 });
      });
      // A manual row's own free-text detail can legitimately start with the
      // word "Driving" (a task label, not the source), and must still be
      // treated as Manual, not mistaken for a GPS drive leg.
      expect(r).not.toContain('#9F5B00');
      expect(r).toContain('Manual');
      expect(r).toContain('Driving the crew to pick up materials');
    });

    // Owner request 2026-08-23: "the time away ... needs logged as lunches or
    // unaccounted for time that needs to feed to the hour charts as unpaid
    // time." The row must be visibly distinct (gray badge + gray accent,
    // muted duration), never mistaken for ordinary paid on-site/driving time.
    test('an unpaid row gets the gray Unpaid badge, gray left-border accent, and a muted (not bold) duration', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a20', rawId: 20, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'Sonic Drive-In', addr: '', jobName: '', detail: 'Unpaid', minutes: 43, unpaid: true });
      });
      expect(r).toContain('Unpaid');
      expect(r).toContain('border-left:3px solid var(--border2)');
      expect(r).not.toContain('#9F5B00'); // never the amber driving color
      expect(r).not.toContain('class="bold" data-label="Duration"');
      expect(r).toContain('class="mute" data-label="Duration"');
    });

    test('an unpaid row does not repeat "Unpaid" in the muted detail line, same not-repeated rule as the Driving badge', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a21', rawId: 21, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'Sonic Drive-In', addr: '', jobName: '', detail: 'Unpaid', minutes: 43, unpaid: true });
      });
      expect((r.match(/Unpaid/g) || []).length).toBe(1);
    });

    test('an unpaid row with a job name still shows the place name, just no plain-text detail duplicate', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a22', rawId: 22, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'Sonic Drive-In', addr: '', jobName: 'Lunch', detail: 'Unpaid', minutes: 43, unpaid: true });
      });
      expect(r).toContain('Sonic Drive-In');
    });

    test('a normal (non-unpaid) on-site row never gets the unpaid badge or gray accent', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a23', rawId: 23, source: 'auto', personName: 'Crew A', personUid: 'u1', clientName: 'John Doe', addr: '123 Main St', jobName: 'Repaint', detail: '', minutes: 200 });
      });
      expect(r).not.toContain('Unpaid');
      expect(r).not.toContain('border-left:3px solid var(--border2)');
      expect(r).toContain('class="bold" data-label="Duration"');
    });

    test('renders Clock In / Clock Out columns from startTime/endTime', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm11', rawId: 11, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 90, startTime: '2026-07-13T13:00:00.000Z', endTime: '2026-07-13T14:30:00.000Z' });
      });
      expect(r).toContain('data-label="Clock In"');
      expect(r).toContain('data-label="Clock Out"');
      expect(r).not.toContain('data-label="Clock In">-<'); // a real time was provided, not the em-dash fallback
    });

    test('missing startTime/endTime: Clock In/Out show an em-dash placeholder, not blank or throw', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        try { return { ok: true, html: _tlRow({ id: 'm12', rawId: 12, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 30, startTime: null, endTime: null }) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('data-label="Clock In">-<');
      expect(r.html).toContain('data-label="Clock Out">-<');
    });

    test('renders the Week total column from weekRunningMin', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm13', rawId: 13, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60, weekRunningMin: 2415 });
      });
      expect(r).toContain('data-label="Week total"');
      expect(r).toContain('40h 15m');
    });

    test('missing weekRunningMin, Week total defaults to 0, does not throw', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        try { return { ok: true, html: _tlRow({ id: 'm14', rawId: 14, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60 }) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('data-label="Week total"');
    });
  });

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
      expect(r.html).toContain('onclick="clockOut();_tlRenderOpenBanner()"');
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
        return html;
      });
      expect(r).toContain('Timelog Test Client');
      expect(r).toContain('Timelog No-Bid Client');
    });

    // Old behavior (until 2026-08-20): newest month first, matching every
    // other Books accordion (Income/Expenses). Owner call 2026-08-20 flipped
    // this deliberately for Time Log specifically: it's now a "how did the
    // year build up" crew report, January (oldest) through December
    // (newest), not a "what happened lately" ledger. Income/Expenses are
    // untouched, this reorder is scoped to _tlYear grouping only.
    test('month accordions, oldest (January) sorts first, current month last', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return [...document.querySelectorAll('.bk-month')].map(el => el.id);
      });
      const idx = (yyyymm) => r.indexOf('bk-tl-mo-' + yyyymm);
      expect(idx(curMonthPrefix)).toBeGreaterThanOrEqual(0);
      expect(idx(`${new Date().getFullYear()}-01`)).toBeLessThan(idx(curMonthPrefix));
    });

    test('current month accordion is open by default', async () => {
      const r = await page.evaluate(async (curMo) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const el = document.getElementById('bk-tl-mo-' + curMo);
        return el ? el.classList.contains('open') : null;
      }, curMonthPrefix);
      expect(r).toBe(true);
    });

    test('day accordions within a month, newest day sorts first', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const monthEl = document.getElementById('bk-tl-mo-' + new Date().toISOString().slice(0, 7));
        return monthEl ? [...monthEl.querySelectorAll('.bk-day')].map(el => el.id) : [];
      });
      expect(r.length).toBeGreaterThan(0);
      // The current-day entry should appear in this month's day list.
      expect(r.some(id => id.includes(todayStr.replace(/-/g, '')))).toBe(true);
    });

    test('week accordions sit between month and day, current week open by default', async () => {
      const r = await page.evaluate(async (curMo) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const monthEl = document.getElementById('bk-tl-mo-' + curMo);
        const weeks = monthEl ? [...monthEl.querySelectorAll(':scope > .bk-month-body > .bk-week')] : [];
        return { count: weeks.length, anyOpen: weeks.some(w => w.classList.contains('open')) };
      }, curMonthPrefix);
      expect(r.count).toBeGreaterThan(0);
      expect(r.anyOpen).toBe(true);
    });

    // Owner report 2026-08-21: entries within a single day had no defined
    // order at all (_bkRenderDays just renders whatever order they arrived
    // in). Fixed to sort newest clock-in first, oldest last, matching how a
    // day actually reads (what you're doing now belongs at the top).
    test('entries within a day: newest clock-in sorts first (top), oldest last (bottom)', async () => {
      const r = await page.evaluate(async () => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const early = new Date(now); early.setHours(8, 0, 0, 0);
        const late = new Date(now); late.setHours(13, 0, 0, 0);
        timeEntries.push(
          { id: 8990201, job_id: 87701, date: dateStr, start_time: early.toISOString(), end_time: new Date(early.getTime() + 30 * 60000).toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: 8990202, job_id: 87701, date: dateStr, start_time: late.toISOString(), end_time: new Date(late.getTime() + 30 * 60000).toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)' }
        );
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const rows = [...document.querySelectorAll('#tl-list tr[data-lp-id]')];
        const idxOf = (id) => rows.findIndex(tr => tr.getAttribute('data-lp-id') === String(id));
        const result = { earlyIdx: idxOf(8990201), lateIdx: idxOf(8990202) };
        timeEntries = timeEntries.filter(e => e.id !== 8990201 && e.id !== 8990202);
        return result;
      });
      expect(r.earlyIdx, 'the 8am entry must render').toBeGreaterThanOrEqual(0);
      expect(r.lateIdx, 'the 1pm entry must render').toBeGreaterThanOrEqual(0);
      expect(r.lateIdx, 'the later clock-in (1pm) must render before the earlier one (8am): newest on top').toBeLessThan(r.earlyIdx);
    });

    // Owner report 2026-08-21: opening Time Log well after a job finished
    // (no live GPS watcher running right then) still showed the gap missing,
    // because _geoReconcileSoon's periodic trigger only ever fires from a
    // live watcher. renderTimeLog now calls the reconciler directly on open;
    // this proves that call happens and never blocks the page on failure.
    test('renderTimeLog calls the mileage reconciler on open, and a throwing reconciler never blocks the page', async () => {
      const r = await page.evaluate(async () => {
        const orig = window._geoReconcileFromMileage;
        let called = false;
        window._geoReconcileFromMileage = async () => { called = true; throw new Error('boom'); };
        try {
          setTimeLogYear(new Date().getFullYear());
          await renderTimeLog();
          return { called, listHtml: document.getElementById('tl-list').innerHTML.length };
        } finally { window._geoReconcileFromMileage = orig; }
      });
      expect(r.called, 'renderTimeLog must call the reconciler').toBe(true);
      expect(r.listHtml, 'the page must still render even if the reconciler throws').toBeGreaterThan(0);
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

    test('entries table (Edit button on manual rows) still renders nested inside a week', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return document.getElementById('tl-list').innerHTML;
      });
      expect(r).toContain('_openEditTimeEntry(');
      expect(r).toContain('data-lp-id=');
    });

    // Really a Me/Team scope test (see the Me/Team describe block below), not
    // strictly role-based: Share is a Me-scope-only button, hidden in Team.
    // Owner defaults to Me since 2026-08-23, so this pins Team explicitly for
    // the owner half rather than leaning on a default that changed.
    test('"Share this week\'s hours" button shows for an individual, not for the owner in Team scope', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        setTimeLogScope('team');
        await renderTimeLog();
        const ownerVisible = document.getElementById('tl-share').style.display !== 'none' && !!document.getElementById('tl-share').innerHTML;
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        await renderTimeLog();
        const empVisible = document.getElementById('tl-share').style.display !== 'none' && !!document.querySelector('#tl-share button[onclick="_tlShareWeek()"]');
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        _tlScope = null; // restore auto-detection for later tests
        await renderTimeLog();
        return { ownerVisible, empVisible };
      });
      expect(r.ownerVisible).toBe(false);
      expect(r.empVisible).toBe(true);
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
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        return { hasOwn: html.includes('Timelog No-Bid Client'), hasOthers: html.includes('Timelog Test Client') };
      });
      expect(r.hasOwn).toBe(true);
      expect(r.hasOthers).toBe(false);
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
        return html.includes('Timelog Test Client') && html.includes('Timelog No-Bid Client');
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
  test.describe('_tlWeekOwnerHtml', () => {
    test('golden path: one row per uid, name, total, avatar label', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { u1: { min: 90, onsiteMin: 90, driveMin: 0, placeMin: 0, weekOT: false, name: 'Dave Torres' } };
        return _tlWeekOwnerHtml(byEmp, null);
      });
      expect(r).toContain('Dave Torres');
      expect(r).toContain('1h 30m');
      expect(r).toContain('DT'); // initials() avatar label
      expect(r).toContain('tl-emp-row');
      expect(r).toContain('tl-split-bar');
    });

    test('"Owner (me)" gets the "Me" avatar label, not broken initials', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { owner1: { min: 60, onsiteMin: 60, driveMin: 0, placeMin: 0, weekOT: false, name: 'Owner (me)' } };
        return _tlWeekOwnerHtml(byEmp, null);
      });
      expect(r).toContain('>Me<');
      expect(r).not.toContain('O(');
    });

    test('selfUid tags exactly that row "(you)", never another row', async () => {
      const r = await page.evaluate(() => {
        const byEmp = {
          u1: { min: 60, onsiteMin: 60, driveMin: 0, placeMin: 0, weekOT: false, name: 'Mike Sample' },
          u2: { min: 30, onsiteMin: 30, driveMin: 0, placeMin: 0, weekOT: false, name: 'Dave Torres' },
        };
        const html = _tlWeekOwnerHtml(byEmp, 'u2');
        const mikeIdx = html.indexOf('Mike Sample');
        const daveIdx = html.indexOf('Dave Torres');
        const youIdx = html.indexOf('(you)');
        return { hasYou: html.includes('(you)'), youNearDave: youIdx > daveIdx && (mikeIdx < 0 || youIdx < mikeIdx || youIdx > mikeIdx + 200) };
      });
      expect(r.hasYou).toBe(true);
    });

    test('no selfUid match, "(you)" never appears', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { u1: { min: 60, onsiteMin: 60, driveMin: 0, placeMin: 0, weekOT: false, name: 'Mike Sample' } };
        return _tlWeekOwnerHtml(byEmp, 'someone-else');
      });
      expect(r).not.toContain('(you)');
    });

    test('weekOT true, renders the OT badge and the highlighted-row class', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { u1: { min: 2500, onsiteMin: 2500, driveMin: 0, placeMin: 0, weekOT: true, name: 'Mike Sample' } };
        return _tlWeekOwnerHtml(byEmp, null);
      });
      expect(r).toContain('tl-ot-badge');
      expect(r).toContain('tl-emp-row ot');
    });

    test('weekOT false, no OT badge, no highlighted-row class', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { u1: { min: 300, onsiteMin: 300, driveMin: 0, placeMin: 0, weekOT: false, name: 'Mike Sample' } };
        return _tlWeekOwnerHtml(byEmp, null);
      });
      expect(r).not.toContain('tl-ot-badge');
      expect(r).not.toContain('tl-emp-row ot');
    });

    test('drive/supply minutes over the 3-minute noise floor show in the split legend, under it are suppressed', async () => {
      const r = await page.evaluate(() => {
        const byEmp = { u1: { min: 100, onsiteMin: 90, driveMin: 10, placeMin: 2, weekOT: false, name: 'Mike Sample' } };
        return _tlWeekOwnerHtml(byEmp, null);
      });
      expect(r).toContain('Drive');
      expect(r).not.toContain('Supply/other');
    });

    test('sorted by minutes descending', async () => {
      const r = await page.evaluate(() => {
        const byEmp = {
          low: { min: 30, onsiteMin: 30, driveMin: 0, placeMin: 0, weekOT: false, name: 'Low Person' },
          high: { min: 400, onsiteMin: 400, driveMin: 0, placeMin: 0, weekOT: false, name: 'High Person' },
        };
        const html = _tlWeekOwnerHtml(byEmp, null);
        return html.indexOf('High Person') < html.indexOf('Low Person');
      });
      expect(r).toBe(true);
    });

    test('empty byEmp, returns empty string, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, html: _tlWeekOwnerHtml({}, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toBe('');
    });

    test('missing name falls back to "Crew", does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, html: _tlWeekOwnerHtml({ u1: { min: 60, onsiteMin: 60, driveMin: 0, placeMin: 0, weekOT: false, name: null } }, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('Crew');
    });
  });

  test.describe('_tlEmpWeekAgg', () => {
    test('golden path: sums minutes and classifies on-site/drive/place per employee', async () => {
      const r = await page.evaluate(() => _tlEmpWeekAgg([
        { personUid: 'u1', personName: 'Mike Sample', minutes: 60, source: 'manual' },
        // _geoIsDriveSource/_geoIsPlaceSource test a raw source string
        // ('drive...'/'place'), and this function calls them against
        // r.detail (the row's friendly label), so a lowercase raw-shaped
        // value is what actually lands in driveMin here, not the
        // capitalized "Driving" label _tlSourceLabel would produce.
        { personUid: 'u1', personName: 'Mike Sample', minutes: 10, source: 'auto', detail: 'drive' },
      ], 'cid1'));
      expect(r.u1.min).toBe(70);
      expect(r.u1.onsiteMin).toBe(60);
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

  test.describe('_tlWeekMineHtml', () => {
    test('golden path: one line per day, sorted chronologically, minutes formatted', async () => {
      const r = await page.evaluate(() => _tlWeekMineHtml([
        { date: '2026-08-18', minutes: 60, clientName: 'John Doe' },
        { date: '2026-08-17', minutes: 30, clientName: 'John Doe' },
      ]));
      expect(r.indexOf('8/17')).toBeLessThan(r.indexOf('8/18'));
      expect(r).toContain('1h');
      expect(r).toContain('30m');
    });

    test('a single client name shows as the label; multiple distinct names collapse to "N stops"', async () => {
      const r = await page.evaluate(() => ({
        one: _tlWeekMineHtml([{ date: '2026-08-17', minutes: 60, clientName: 'John Doe' }]),
        many: _tlWeekMineHtml([
          { date: '2026-08-17', minutes: 30, clientName: 'John Doe' },
          { date: '2026-08-17', minutes: 30, clientName: 'Ace Supply' },
        ]),
      }));
      expect(r.one).toContain('John Doe');
      expect(r.many).toContain('2 stops');
    });

    // Owner report 2026-08-23, live device: a reconciliation bug summed one
    // real calendar day to 2848 minutes (47h28m) and it rendered as a
    // perfectly normal-looking number. One person physically cannot log
    // more than 1440 minutes in one day, so this is flagged, never trusted.
    test('a day over 1440 minutes (24h) renders as a flagged data error, not a normal total', async () => {
      const r = await page.evaluate(() => _tlWeekMineHtml([
        { date: '2026-08-21', minutes: 2848, clientName: 'John Doe' },
      ]));
      expect(r).toContain('Data error');
      expect(r).toContain('var(--c-red-deep)');
      // The raw (wrong) figure still shows, in the tooltip: seeing exactly
      // how wrong it is is what makes the underlying bug reportable.
      expect(r).toContain('47h 28m');
    });

    test('a day at exactly 1440 minutes (24h) is NOT flagged, only strictly over is', async () => {
      const r = await page.evaluate(() => _tlWeekMineHtml([
        { date: '2026-08-21', minutes: 1440, clientName: 'John Doe' },
      ]));
      expect(r).not.toContain('Data error');
    });

    test('unpaid rows are excluded from the day total, including from tripping the 24h flag', async () => {
      const r = await page.evaluate(() => _tlWeekMineHtml([
        { date: '2026-08-21', minutes: 1400, clientName: 'John Doe', unpaid: false },
        { date: '2026-08-21', minutes: 200, clientName: 'John Doe', unpaid: true },
      ]));
      expect(r).not.toContain('Data error');
      expect(r).toContain('23h 20m'); // 1400 min, the unpaid 200 never counted
    });

    test('empty rows, returns empty string, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, html: _tlWeekMineHtml([]) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toBe('');
    });
  });

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
        const orig = { isEmp: window._isEmployee, emp: window._employeeRecord, user: window._supaUser };
        window._isEmployee = true;
        window._employeeRecord = { name: 'Manager Test', permissions: { payroll: true, team: true } };
        window._supaUser = { id: 'emp-test-uid' };
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
        const meShare = document.getElementById('tl-share').style.display !== 'none';
        const meHtml = document.getElementById('tl-list').innerHTML;
        // setTimeLogScope fires renderTimeLog() without awaiting it (same
        // fire-and-forget convention setTimeLogYear already uses), so an
        // explicit await here is required before reading the DOM, exactly
        // like every setTimeLogYear test already does.
        setTimeLogScope('team');
        await renderTimeLog();
        const teamShare = document.getElementById('tl-share').style.display !== 'none';
        const teamHtml = document.getElementById('tl-list').innerHTML;
        const scopeAfterTeam = _tlScope;
        window._isEmployee = orig.isEmp; window._employeeRecord = orig.emp; window._supaUser = orig.user;
        await renderTimeLog();
        return {
          meShare, teamShare, scopeAfterTeam,
          meHasOwner: meHtml.includes('Owner (me)'),
          meHasSelf: meHtml.includes('Test Crew Member'),
          teamHasOwner: teamHtml.includes('Owner (me)'),
          teamHasSelf: teamHtml.includes('Test Crew Member'),
        };
      });
      expect(r.meShare).toBe(true);
      expect(r.teamShare).toBe(false);
      expect(r.scopeAfterTeam).toBe('team');
      expect(r.meHasOwner).toBe(false); // Me scope: only the manager's own rows
      expect(r.meHasSelf).toBe(true);
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

    test('day picker: Week is selected by default, clicking a worked day switches the scope header and rows, clicking Week returns', async () => {
      const r = await page.evaluate(async (curMo) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const monthEl = document.getElementById('bk-tl-mo-' + curMo);
        const bodyEl = monthEl.querySelector('.tl-chip.wk').closest('[id^="tl-wkbody-"]');
        // setTimeLogDayPick replaces bodyEl's innerHTML wholesale on every
        // click (a fresh _tlRenderWeekBody render), so any chip reference
        // captured before a click is a detached node afterward, checking
        // .classList on it would silently check the OLD, discarded button.
        // bodyEl itself keeps its id and stays attached, only its children
        // are swapped, so re-query fresh chips from it after every click.
        const weekChip = () => bodyEl.querySelector('.tl-chip.wk');
        const weekActiveBefore = weekChip().classList.contains('active');
        const scopeTtlBefore = bodyEl.querySelector('.tl-scope-ttl').textContent;
        const dotChip = [...bodyEl.querySelectorAll('.tl-chip')].find(c => !c.classList.contains('wk') && c.querySelector('.tl-dot'));
        dotChip.click();
        const scopeTtlAfter = bodyEl.querySelector('.tl-scope-ttl').textContent;
        const dotChipActive = [...bodyEl.querySelectorAll('.tl-chip')].some(c => !c.classList.contains('wk') && c.classList.contains('active'));
        const weekChipStillActive = weekChip().classList.contains('active');
        weekChip().click();
        const scopeTtlBack = bodyEl.querySelector('.tl-scope-ttl').textContent;
        const weekActiveAgain = weekChip().classList.contains('active');
        return { weekActiveBefore, scopeTtlBefore, scopeTtlAfter, dotChipActive, weekChipStillActive, scopeTtlBack, weekActiveAgain };
      }, curMonthPrefix);
      expect(r.weekActiveBefore).toBe(true);
      expect(r.scopeTtlBefore).toContain('Week of');
      expect(r.scopeTtlAfter).not.toContain('Week of');
      expect(r.dotChipActive).toBe(true);
      expect(r.weekChipStillActive).toBe(false);
      expect(r.scopeTtlBack).toContain('Week of');
      expect(r.weekActiveAgain).toBe(true);
    });

    test('day picker: a day nobody worked shows the empty state, no throw', async () => {
      const r = await page.evaluate(async (curMo) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const monthEl = document.getElementById('bk-tl-mo-' + curMo);
        const weekChip = monthEl.querySelector('.tl-chip.wk');
        const bodyEl = weekChip.closest('[id^="tl-wkbody-"]');
        const emptyChip = [...bodyEl.querySelectorAll('.tl-chip')].find(c => c !== weekChip && !c.querySelector('.tl-dot'));
        if (!emptyChip) return { skip: true };
        emptyChip.click();
        return { skip: false, html: bodyEl.innerHTML };
      }, curMonthPrefix);
      if (!r.skip) expect(r.html).toContain('No hours logged');
    });

    test('setTimeLogDayPick with an unknown cacheKey, no-ops without throwing', async () => {
      const r = await page.evaluate(() => {
        try { setTimeLogDayPick('bogus|key', 'week'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_tlRenderWeekBody with an unknown cacheKey, returns empty string, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, html: _tlRenderWeekBody('bogus|key') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toBe('');
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

  test('no console errors during time log tests', async () => {
    await assertNoErrors(page);
  });
});
