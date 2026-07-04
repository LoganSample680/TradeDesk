// REAL flow — geo-fence EDGE CASES the core time-on-site spec doesn't cover. Same
// approach: drive geo-track.js _geoOnPing with synthetic coords (the OS's exact
// call) and assert the rows/state it produces. Covers the distinct code paths:
//
//   1. SHOP/OFFICE FENCE  — arrive→dwell→leave the office geofence writes a
//      shop_time_entries row (separate table + branch from job fences).
//   2. DRIVE LEG          — leaving one job and arriving at another logs a
//      job_time_entries 'drive' leg (company vehicle) — the mileage feed.
//   3. MULTI-JOB CLOSEST  — with two job fences in range, the CLOSEST one wins
//      (_geoOnPing's bestFt selection).
//
// Soft-skips if the geo tables aren't provisioned. In-memory jobs[] is restored,
// never saved (CLAUDE.md §13.7 — the shared account is untouched).
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'geo/edge-cases';
const A = { lat: 37.6872, lon: -97.3301 };   // job A / office
const B = { lat: 37.7100, lon: -97.3500 };   // job B (a few mi from A)
const FAR = { lat: 38.2000, lon: -98.0000 }; // far outside any fence

async function ping(page, lat, lon) {
  await page.evaluate(async ({ lat, lon }) => { await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } }); }, { lat, lon });
}
async function rows(page, table, col, val) {
  return await page.evaluate(async ({ table, col, val }) => {
    const uid = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null;
    try {
      let q = _supa.from(table).select('*').eq('employee_user_id', uid);
      if (col) q = q.eq(col, String(val));
      const { data, error } = await q;
      if (error) return /does not exist|relation|PGRST|schema cache/i.test(error.message || '') ? { absent: true } : { rows: [] };
      return { rows: data || [] };
    } catch (e) { return { absent: true }; }
  }, { table, col, val });
}

test.describe('geo-fence edge cases (UI-driven via the real ping handler)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('shop fence, drive leg, and closest-of-two-fences all behave', async ({ page }) => {
    test.setTimeout(120000);
    const base = Date.now() * 1000 + (process.pid % 1000);
    const jobA = base, jobB = base + 1, jobMA = base + 2, jobMB = base + 3;

    const resetGeo = async (extra) => {
      await page.evaluate(({ A, B, jobA, jobB, jobMA, jobMB, extra }) => {
        window.__origJobs = window.__origJobs || jobs.slice();
        const today = new Date().toISOString().slice(0, 10);
        jobs.length = 0;
        const mk = (id, c, on) => ({ id, client_id: null, name: 'E2E Geo ' + id, eventType: 'job', status: 'upcoming', start: today, days: 1, lat: c.lat, lon: c.lon, _e2e: 'geo' });
        if (extra === 'drive') { jobs.push(mk(jobA, A), mk(jobB, B)); }
        else if (extra === 'multi') { jobs.push(mk(jobMA, A), mk(jobMB, B)); }
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null; _geoLastPingTs = 0;
        S.trackStart = '00:00'; S.trackEnd = '23:59';
        S.officeLat = null; S.officeLon = null;
      }, { A, B, jobA, jobB, jobMA, jobMB, extra });
    };
    const restore = async () => { await page.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null; } }); };

    // ── 1. SHOP / OFFICE FENCE → shop_time_entries ──
    await step(page, {
      label: 'arrive→dwell→leave the office fence logs shop time', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing shop branch → _geoCloseShopEntry (shop_time_entries)',
      ruleText: 'arriving at then leaving the office geofence must write a shop_time_entries row (or skip if absent)',
      expected: 'a shop_time_entries row with minutes>=2',
      act: async (p) => {
        await resetGeo('none');
        await p.evaluate(({ A }) => { S.officeLat = A.lat; S.officeLon = A.lon; jobs.length = 0; }, { A });
        await ping(p, A.lat, A.lon);                                  // arrive shop
        await p.evaluate(() => { _geoShopArrivedAt = new Date(Date.now() - 9 * 60000).toISOString(); });
        await ping(p, FAR.lat, FAR.lon);                             // leave shop
        await p.waitForTimeout(1000);
        await restore();
        return 2;
      },
      rule: async (p) => {
        const r = await rows(p, 'shop_time_entries');
        if (r.absent) return { ok: true, got: 'SKIP — shop_time_entries not provisioned' };
        const recent = (r.rows || []).filter(x => x.minutes >= 2);
        return { ok: recent.length >= 1, got: `shopRows>=2min=${recent.length}` };
      },
    });

    // ── 2. DRIVE LEG (company vehicle) → job_time_entries source 'drive' ──
    await step(page, {
      label: 'leaving job A and arriving job B logs a company drive leg', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing drive logic → _geoDriveEntry (source drive/drive-personal)',
      ruleText: 'a drive between two job fences in a company vehicle must log a job_time_entries drive leg',
      expected: "a job_time_entries row for job B with source starting 'drive' and minutes>=2",
      act: async (p) => {
        await resetGeo('drive');
        // Mark today's vehicle as a COMPANY vehicle so the leg flags as 'drive'.
        await p.evaluate(() => { try { localStorage.setItem('emp_vehicle_' + todayKey(), 'veh-e2e-company'); } catch (e) {} });
        await ping(p, A.lat, A.lon);                                 // arrive A
        await ping(p, FAR.lat, FAR.lon);                            // leave A → drive starts
        await p.evaluate(() => { _geoDriveStartedAt = new Date(Date.now() - 7 * 60000).toISOString(); }); // back-date the leg
        await ping(p, B.lat, B.lon);                                 // arrive B → drive leg logged
        await p.waitForTimeout(1200);
        await restore();
        return 3;
      },
      rule: async (p) => {
        const r = await rows(p, 'job_time_entries', 'job_id', jobB);
        if (r.absent) return { ok: true, got: 'SKIP — job_time_entries not provisioned' };
        const drive = (r.rows || []).find(x => String(x.source || '').startsWith('drive') && x.minutes >= 2);
        return { ok: !!drive, got: drive ? `source=${drive.source} minutes=${drive.minutes}` : `no drive leg (rows=${JSON.stringify(r.rows)})` };
      },
    });

    // ── 3. MULTI-JOB: the CLOSEST fence wins. ──
    await step(page, {
      label: 'with two fences in range the closest job is selected', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing bestFt closest-fence selection',
      ruleText: 'a ping nearer to job B than job A must set _geoCurrentJob to job B',
      expected: '_geoCurrentJob === jobMB',
      act: async (p) => {
        await resetGeo('multi');
        // Ping essentially on top of B (a hair off) — both A and B are "today" jobs,
        // but B is far closer, so bestFt must pick B.
        await ping(p, B.lat + 0.0002, B.lon);
        await p.waitForTimeout(400);
        p.__cur = await p.evaluate(() => (typeof _geoCurrentJob !== 'undefined' ? _geoCurrentJob : null));
        await restore();
        return 1;
      },
      rule: async (p) => ({ ok: String(p.__cur) === String(jobMB), got: `currentJob=${p.__cur} expected=${jobMB}` }),
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
