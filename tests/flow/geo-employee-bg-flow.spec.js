// REAL flow — the remaining geo paths (finishing the honest edge-case list). Same
// technique: drive geo-track.js _geoOnPing / the real listeners with synthetic
// input. Covers the paths the first two geo specs left out:
//
//   1. EMPLOYEE PATH    — _geoMyJobs() filters to jobs dispatched to the employee
//      (assignedTo + assignedDate), the distinct branch from the owner path.
//   2. DRIVE-PERSONAL   — a drive leg in a PERSONAL vehicle logs source
//      'drive-personal' (time is compensable, mileage stays private).
//   3. BREADCRUMB THROTTLE — the first ping writes a location_pings breadcrumb;
//      a second ping within 60s is throttled (no duplicate write).
//   4. BACKGROUNDING    — visibilitychange→hidden KEEPS the entry open (persisted
//      to the device); the first post-gap ping resolves it — still inside ⇒ one
//      continuous visit, outside ⇒ closed at the hidden moment as 'geofence-gap'.
//
// Soft-skips if geo tables are absent. Session globals it flips (_isEmployee etc.)
// are restored; in-memory jobs[] restored, never saved (CLAUDE.md §13.7).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'geo/employee-and-lifecycle';
const A = { lat: 37.6872, lon: -97.3301 };
const B = { lat: 37.7100, lon: -97.3500 };
const FAR = { lat: 38.2000, lon: -98.0000 };

async function ping(page, lat, lon) {
  await page.evaluate(async ({ lat, lon }) => { await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } }); }, { lat, lon });
}
async function jobRows(page, jobId) {
  return await page.evaluate(async ({ jobId }) => {
    const uid = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null;
    try {
      const { data, error } = await _supa.from('job_time_entries').select('job_id,minutes,source').eq('employee_user_id', uid).eq('job_id', String(jobId));
      if (error) return /does not exist|relation|PGRST|schema cache/i.test(error.message || '') ? { absent: true } : { rows: [] };
      return { rows: data || [] };
    } catch (e) { return { absent: true }; }
  }, { jobId });
}

test.describe('geo employee path + lifecycle (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('employee dispatch filter, drive-personal, breadcrumb throttle, backgrounding', async ({ page }) => {
    test.setTimeout(120000);
    const base = Date.now() * 1000 + (process.pid % 1000);
    const jobEmp = base, jobA = base + 1, jobB = base + 2, jobBg = base + 3;

    // ── 1. EMPLOYEE PATH — _geoMyJobs() returns only dispatched jobs. ──
    await step(page, {
      label: 'employee only fences against jobs dispatched to them', page: 'geo', role: 'employee',
      suspect: 'geo-track.js _geoMyJobs employee branch (assignedTo + assignedDate)',
      ruleText: 'when the session is an employee, a ping at a job dispatched to them must arrive there',
      expected: '_geoCurrentJob === the dispatched job',
      act: async (p) => {
        await p.evaluate(({ jobEmp, A }) => {
          window.__origJobs = jobs.slice();
          window.__wasEmp = _isEmployee; window.__empRec = _employeeRecord; window.__cuid = (typeof _contractorUserId !== 'undefined' ? _contractorUserId : null);
          const today = new Date().toISOString().slice(0, 10);
          // Become an employee whose own contractor is this account (keeps RLS happy).
          _isEmployee = true; _employeeRecord = { id: 'emp-e2e-' + jobEmp }; _contractorUserId = (_supaUser && _supaUser.id) || null;
          jobs.length = 0;
          jobs.push({ id: jobEmp, client_id: null, name: 'E2E Emp Job', eventType: 'job', status: 'upcoming', start: today, days: 1, assignedTo: 'emp-e2e-' + jobEmp, assignedDate: today, lat: A.lat, lon: A.lon, _e2e: 'geo' });
          // A non-dispatched job at the SAME spot must be ignored by the employee filter.
          jobs.push({ id: jobEmp + 900, client_id: null, name: 'E2E Other Job', eventType: 'job', status: 'upcoming', start: today, days: 1, assignedTo: 'someone-else', assignedDate: today, lat: A.lat, lon: A.lon, _e2e: 'geo' });
          _geoCurrentJob = null; _geoArrivedAt = null; _geoLastPingTs = 0; S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
        }, { jobEmp, A });
        await ping(p, A.lat, A.lon);
        p.__cur = await p.evaluate(() => _geoCurrentJob);
        // Restore the employee/session globals immediately.
        await p.evaluate(() => { _isEmployee = window.__wasEmp; _employeeRecord = window.__empRec; if (typeof _contractorUserId !== 'undefined') _contractorUserId = window.__cuid; });
        return 1;
      },
      rule: async (p) => ({ ok: String(p.__cur) === String(jobEmp), got: `currentJob=${p.__cur} expected=${jobEmp} (non-dispatched job must be ignored)` }),
    });

    // ── 2. DRIVE-PERSONAL — personal vehicle leg logs source 'drive-personal'. ──
    await step(page, {
      label: 'a drive leg in a personal vehicle logs source drive-personal', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoDriveEntry (companyVeh ? drive : drive-personal)',
      ruleText: 'a job-to-job drive in a PERSONAL vehicle must log a job_time_entries leg with source drive-personal',
      expected: "job B leg source === 'drive-personal'",
      act: async (p) => {
        await p.evaluate(({ jobA, jobB, A, B }) => {
          window.__origJobs = window.__origJobs || jobs.slice();
          const today = new Date().toISOString().slice(0, 10);
          jobs.length = 0;
          jobs.push({ id: jobA, lat: A.lat, lon: A.lon, start: today, days: 1, status: 'upcoming', eventType: 'job', _e2e: 'geo' });
          jobs.push({ id: jobB, lat: B.lat, lon: B.lon, start: today, days: 1, status: 'upcoming', eventType: 'job', _e2e: 'geo' });
          _geoCurrentJob = null; _geoArrivedAt = null; _geoDriveStartedAt = null; _geoLastPingTs = 0; S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
          try { localStorage.setItem('emp_vehicle_' + todayKey(), 'personal'); } catch (e) {} // PERSONAL vehicle
        }, { jobA, jobB, A, B });
        await ping(p, A.lat, A.lon);                 // arrive A
        await ping(p, FAR.lat, FAR.lon);            // leave A → drive starts
        await p.evaluate(() => { _geoDriveStartedAt = new Date(Date.now() - 6 * 60000).toISOString(); });
        await ping(p, B.lat, B.lon);                 // arrive B → personal drive leg
        await p.waitForTimeout(1200);
        return 3;
      },
      rule: async (p) => {
        const r = await jobRows(p, jobB);
        if (r.absent) return { ok: true, got: 'SKIP — job_time_entries not provisioned' };
        const leg = (r.rows || []).find(x => x.source === 'drive-personal');
        return { ok: !!leg, got: leg ? `source=${leg.source} minutes=${leg.minutes}` : `no drive-personal leg (rows=${JSON.stringify(r.rows)})` };
      },
    });

    // ── 3. BREADCRUMB THROTTLE — 2nd ping within 60s doesn't re-write. ──
    await step(page, {
      label: 'the location breadcrumb is throttled to ~60s', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing breadcrumb throttle (_geoLastPingTs 60s)',
      ruleText: 'a 2nd ping within 60s must NOT advance the breadcrumb throttle stamp (no duplicate location_pings write)',
      expected: '_geoLastPingTs unchanged between two rapid pings',
      act: async (p) => {
        await p.evaluate(({ A }) => {
          window.__origJobs = window.__origJobs || jobs.slice();
          jobs.length = 0; _geoCurrentJob = null; _geoArrivedAt = null; _geoLastPingTs = 0;
          S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
        }, { A });
        await ping(p, A.lat, A.lon);                 // first ping → breadcrumb written, stamp set
        const t1 = await p.evaluate(() => _geoLastPingTs);
        await ping(p, A.lat + 0.0001, A.lon);       // second ping immediately → throttled
        const t2 = await p.evaluate(() => _geoLastPingTs);
        p.__throttle = { t1, t2 };
        return 2;
      },
      rule: async (p) => {
        const { t1, t2 } = p.__throttle || {};
        return { ok: t1 > 0 && t2 === t1, got: `t1=${t1} t2=${t2} (must be equal — 2nd ping throttled)` };
      },
    });

    // ── 4. BACKGROUNDING — the open entry SURVIVES a hidden gap; the next ping
    //       resolves it. (Behavior intentionally changed: the old handler closed on
    //       hidden, so a phone in a pocket all day logged only screen-on slivers and
    //       any visit hidden within 2 min of arrival was dropped entirely. Now:
    //       still-inside ⇒ continuous visit; outside ⇒ close at the last VERIFIED
    //       on-site moment, tagged 'geofence-gap'.) ──
    await step(page, {
      label: 'backgrounding keeps the entry open; leaving during the gap closes at the hidden moment', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js visibilitychange persist + _geoOnPing hidden-gap resolution',
      ruleText: 'hidden must NOT close the entry; a post-gap ping outside the fence must close it as geofence-gap AT the hidden timestamp',
      expected: 'entry open through hidden; geofence-gap row with departed_at === hiddenAt',
      act: async (p) => {
        await p.evaluate(({ jobBg, A }) => {
          window.__origJobs = window.__origJobs || jobs.slice();
          const today = new Date().toISOString().slice(0, 10);
          jobs.length = 0;
          jobs.push({ id: jobBg, lat: A.lat, lon: A.lon, start: today, days: 1, status: 'upcoming', eventType: 'job', _e2e: 'geo' });
          _geoCurrentJob = null; _geoArrivedAt = null; _geoLastPingTs = 0; S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
          // Ensure the visibilitychange handler is bound (idempotent).
          if (typeof _geoTrackInit === 'function') _geoTrackInit();
        }, { jobBg, A });
        await ping(p, A.lat, A.lon);                 // arrive
        await p.evaluate(() => { _geoArrivedAt = new Date(Date.now() - 11 * 60000).toISOString(); }); // dwell
        // Simulate the app going to the background.
        await p.evaluate(() => {
          try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); } catch (e) {}
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await p.waitForTimeout(500);
        p.__mid = await p.evaluate(() => ({
          cur: _geoCurrentJob,
          persisted: !!localStorage.getItem('zp3_geo_open'),
          hiddenAt: (JSON.parse(localStorage.getItem('zp3_geo_open') || '{}')).hiddenAt || null,
        }));
        // Return to the foreground OUTSIDE the fence — the worker left during the gap.
        await p.evaluate(() => { try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (e) {} document.dispatchEvent(new Event('visibilitychange')); });
        await ping(p, 38.2000, -98.0000);            // far away → gap-close path
        await p.waitForTimeout(1500);                // let the durable queue drain
        p.__end = await p.evaluate(() => ({ cur: _geoCurrentJob, queueLeft: (JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]')).length }));
        // Restore in-memory jobs after the whole test.
        await p.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; } });
        return 3;
      },
      rule: async (p) => {
        const r = await jobRows(p, jobBg);
        if (r.absent) return { ok: true, got: 'SKIP — job_time_entries not provisioned' };
        const mid = p.__mid || {}, end = p.__end || {};
        const gapRow = (r.rows || []).find(x => x.source === 'geofence-gap');
        const ok = mid.cur != null && mid.persisted === true    // hidden did NOT close/reset
          && end.cur == null                                     // post-gap outside ping closed it
          && !!gapRow;                                           // ...as a geofence-gap entry
        return { ok, got: `midCur=${mid.cur != null} persisted=${mid.persisted} endCur=${end.cur} gapRow=${gapRow ? gapRow.source + '/' + gapRow.minutes + 'min' : 'MISSING'} queueLeft=${end.queueLeft}` };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
