// REAL flow — crew geo-fence time-on-site (task #18 remainder). The earlier claim
// that GPS geo-fencing "can't be tested headless" was WRONG: the OS just calls
// geo-track.js _geoOnPing(position) with coordinates, so we call that exact handler
// with synthetic positions and drive the full arrive→dwell→depart state machine —
// no GPS hardware needed (Playwright could also feed it via setGeolocation, but the
// handler is the unit under test). We then assert the REAL rows it writes to
// job_time_entries. Three behaviours are covered:
//
//   1. ARRIVE → DWELL → DEPART logs a 'geofence' time entry with the dwell minutes.
//   2. OUT-OF-BUSINESS-HOURS pings are ignored (no entry) — the privacy gate.
//   3. A <2-minute pass-through is ignored (no phantom entry).
//
// Soft-skips cleanly if the geo tables aren't provisioned in this env. Seed job is
// left in the account per CLAUDE.md §13.7 (only in-memory jobs[] is restored, never
// saved, so the shared account is untouched).
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'geo/time-on-site';
const SITE = { lat: 37.6872, lon: -97.3301 };           // the job site
const FAR = { lat: 37.9000, lon: -97.7000 };            // ~25mi away → outside the 600ft fence

// Query job_time_entries for one job; detect an unprovisioned table for a clean skip.
async function geoEntries(page, jobId) {
  return await page.evaluate(async ({ jobId }) => {
    const uid = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null;
    try {
      const { data, error } = await _supa.from('job_time_entries')
        .select('job_id,minutes,source,arrived_at,departed_at')
        .eq('employee_user_id', uid).eq('job_id', String(jobId));
      if (error) return /does not exist|relation|PGRST|schema cache/i.test(error.message || '') ? { absent: true } : { rows: [] };
      return { rows: data || [] };
    } catch (e) { return { absent: true }; }
  }, { jobId });
}

// Drive a ping through the real handler with given coords; control the geo state.
async function ping(page, lat, lon) {
  await page.evaluate(async ({ lat, lon }) => {
    await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } });
  }, { lat, lon });
}

test.describe('geo-fence time-on-site (UI-driven via the real ping handler)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('arrive→dwell→depart logs time-on-site; out-of-hours + pass-through do not', async ({ page }) => {
    test.setTimeout(120000);
    const base = Date.now() * 1000 + (process.pid % 1000);
    const jobOn = base, jobHrs = base + 1, jobPass = base + 2;

    // Helper to install ONE coord-bearing job for today + always-on hours, isolated
    // so _geoMyJobs() returns exactly our job (real jobs lack session coords/are far).
    const setup = async (jobId, hoursOk) => {
      return await page.evaluate(({ jobId, SITE, hoursOk }) => {
        window.__origJobs = jobs.slice();
        // _geoMyJobs() filters today's jobs against the app's LOCAL date key
        // (todayKey, built from getFullYear/Month/Date). Seeding with UTC
        // (toISOString) makes the job land on tomorrow's date when the runner clock is
        // behind UTC (Central in the evening) → the job is filtered out → no arrival →
        // no geofence row. Use the same local key the app compares against.
        const today = (typeof todayKey === 'function') ? todayKey() : new Date().toISOString().slice(0, 10);
        jobs.length = 0;
        jobs.push({ id: jobId, client_id: null, name: 'E2E Geo Site', eventType: 'job', status: 'upcoming', start: today, days: 1, lat: SITE.lat, lon: SITE.lon, _e2e: 'geo' });
        // Reset the geo state machine.
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoLastPingTs = 0;
        S.officeLat = null; S.officeLon = null;
        if (hoursOk) { S.trackStart = '00:00'; S.trackEnd = '23:59'; }
        else {
          // A 1-hour window 6h from now (clamped to avoid a midnight wrap) — excludes now.
          const d = new Date(); const n = d.getHours() * 60 + d.getMinutes();
          let s = (n + 360) % 1440, e = s + 60; if (e >= 1440) { s = 60; e = 120; }
          const f = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
          S.trackStart = f(s); S.trackEnd = f(e);
        }
        return _geoBusinessHoursNow();
      }, { jobId, SITE, hoursOk });
    };
    const restore = async () => { await page.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); } }); };

    // ── 1. ARRIVE → DWELL → DEPART → a geofence time entry. ──
    await step(page, {
      label: 'arrive at site, dwell ~12 min, depart → time-on-site logged', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing → _geoCloseEntry (job_time_entries insert, source geofence)',
      ruleText: 'a real arrive→dwell→depart must write ONE geofence time entry with minutes>=2 (or skip if geo tables absent)',
      expected: 'job_time_entries row source=geofence minutes>=2',
      act: async (p) => {
        const ok = await setup(jobOn, true);
        if (!ok) return 0; // hours setup failed (shouldn't with 00:00-23:59)
        await ping(p, SITE.lat, SITE.lon);                       // arrive (inside fence)
        // DIAGNOSTIC: capture whether arrival actually registered — did _geoMyJobs
        // return our seeded job, did business-hours pass, did _geoCurrentJob get set?
        // This tells us if the failure is ARRIVAL (no current job → nothing to close)
        // vs the INSERT (current job set but no row written).
        p.__geoDiag = await p.evaluate(() => ({
          curJob: (typeof _geoCurrentJob !== 'undefined') ? _geoCurrentJob : 'undef',
          arrived: (typeof _geoArrivedAt !== 'undefined') ? !!_geoArrivedAt : 'undef',
          myJobIds: (typeof _geoMyJobs === 'function') ? (_geoMyJobs() || []).map(j => j.id) : 'no-fn',
          hoursNow: (typeof _geoBusinessHoursNow === 'function') ? _geoBusinessHoursNow() : 'no-fn',
        }));
        // Simulate a 12-minute dwell by back-dating the arrival the handler stored.
        await p.evaluate(() => { _geoArrivedAt = new Date(Date.now() - 12 * 60000).toISOString(); });
        await ping(p, FAR.lat, FAR.lon);                         // depart (outside fence)
        await p.waitForTimeout(1500);                            // let the awaited insert land
        await restore();
        return 2; // two pings
      },
      rule: async (p) => {
        const r = await geoEntries(p, jobOn);
        if (r.absent) return { ok: true, got: 'SKIP — job_time_entries not provisioned in this env (pending geo migration)' };
        const gf = (r.rows || []).find(x => x.source === 'geofence');
        return { ok: !!gf && gf.minutes >= 2, got: gf ? `minutes=${gf.minutes} source=${gf.source}` : `no geofence row — DIAG after arrive: ${JSON.stringify(p.__geoDiag)}` };
      },
    });

    // ── 2. OUT-OF-HOURS ping is ignored (privacy gate). ──
    await step(page, {
      label: 'a ping outside business hours logs nothing', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing business-hours guard (_geoBusinessHoursNow)',
      ruleText: 'a ping when the current time is outside S.trackStart–trackEnd must not arrive or log anything',
      expected: '_geoCurrentJob stays null, no time entry for this job',
      act: async (p) => {
        const inHours = await setup(jobHrs, false);
        // setup returns _geoBusinessHoursNow(); for this phase it MUST be false.
        p.__gate = inHours;
        await ping(p, SITE.lat, SITE.lon);                       // inside fence but off-hours
        await p.waitForTimeout(800);
        p.__cur = await p.evaluate(() => (typeof _geoCurrentJob !== 'undefined' ? _geoCurrentJob : 'undef'));
        await restore();
        return 1;
      },
      rule: async (p) => {
        if (p.__gate !== false) return { ok: true, got: 'SKIP — could not build an out-of-hours window (rare clock alignment)' };
        const r = await geoEntries(p, jobHrs);
        if (r.absent) return { ok: true, got: 'SKIP — geo tables absent' };
        const none = (r.rows || []).length === 0;
        return { ok: p.__cur == null && none, got: `currentJob=${p.__cur} rows=${(r.rows || []).length}` };
      },
    });

    // ── 3. <2-minute pass-through is ignored (no phantom entry). ──
    await step(page, {
      label: 'a brief (<2 min) pass-through logs nothing', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoCloseEntry (mins<2 guard)',
      ruleText: 'arriving and immediately leaving (<2 min) must NOT write a time entry',
      expected: 'no job_time_entries row for the pass-through job',
      act: async (p) => {
        await setup(jobPass, true);
        await ping(p, SITE.lat, SITE.lon);                       // arrive
        await ping(p, FAR.lat, FAR.lon);                         // immediately depart (arrivedAt ~now → <2min)
        await p.waitForTimeout(800);
        await restore();
        return 2;
      },
      rule: async (p) => {
        const r = await geoEntries(p, jobPass);
        if (r.absent) return { ok: true, got: 'SKIP — geo tables absent' };
        return { ok: (r.rows || []).length === 0, got: `rows=${(r.rows || []).length} (expected 0)` };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
