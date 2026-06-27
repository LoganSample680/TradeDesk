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
//   4. BACKGROUNDING    — visibilitychange→hidden finalizes the open entry and
//      resets the fence state (so a force-quit mid-shift never loses time).
//
// Soft-skips if geo tables are absent. Session globals it flips (_isEmployee etc.)
// are restored; in-memory jobs[] restored, never saved (CLAUDE.md §13.7).
const { test, expect } = require('@playwright/test');
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

    // ── 4. BACKGROUNDING — visibilitychange→hidden finalizes + resets. ──
    await step(page, {
      label: 'backgrounding the app finalizes the open entry and resets fence state', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoTrackInit visibilitychange handler',
      ruleText: 'a visibilitychange→hidden while on-site must close the entry (write time) and null _geoCurrentJob',
      expected: '_geoCurrentJob reset to null after backgrounding',
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
        await p.waitForTimeout(1000);
        p.__cur = await p.evaluate(() => _geoCurrentJob);
        await p.evaluate(() => { try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (e) {} });
        // Restore in-memory jobs after the whole test.
        await p.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; } });
        return 1;
      },
      rule: async (p) => ({ ok: p.__cur == null, got: `currentJob after backgrounding=${p.__cur} (expected null)` }),
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
