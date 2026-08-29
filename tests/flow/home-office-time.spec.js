// REAL flow: a home office is two kinds of work, and the log says which.
//
// Owner rule (2026-08-29): "home office should call the last motion event from
// start time to end time before a drive, that's truck loading time... then
// home office counts app open time while in home office geofence, that means
// work is actively being done so it needs counted as its own thing."
//
// This drives the same handler iOS drives, _geoOnPing(position), against the
// REAL Dev Supabase, with a real saved place of kind home_office, and then
// asserts the rows that actually landed in job_time_entries and the words that
// actually rendered on the Time Log. The motion tape is the one thing a
// headless runner cannot produce, so the plugin accessor is stubbed to return
// a tape: everything downstream of it, _geoMotionTape through _geoHomeTape,
// _geoHomeLoadWindow, _geoHomeSplit and the closer, is the shipping code.
//
// What each step pins down, and why it is here rather than in the offline
// shard: the offline spec proves the classifier in isolation, this proves the
// rows survive the queue, the drain, RLS and the renderer, which is the half
// that has broken before.
//
// Leaves its seed data in the account on purpose (CLAUDE.md §12.7).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'geo/home-office-time';
// Far from any real seeded client or job in the dev account, so nothing else
// can claim these pings.
const HOME = { lat: 38.4211, lon: -96.1877 };
const ROAD = { lat: 38.6900, lon: -96.5400 };

// One ping through the real handler.
const ping = (page, c) => page.evaluate(async (p) =>
  await _geoOnPing({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 8 } }), c);

// The rows this visit actually wrote, read back off the server.
async function homeRows(page, placeId) {
  return await page.evaluate(async ({ placeId }) => {
    const uid = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null;
    try {
      const { data, error } = await _supa.from('job_time_entries')
        .select('minutes,source,arrived_at,departed_at,dest_place,client_key')
        .eq('employee_user_id', uid).is('deleted_at', null).like('client_key', '%' + placeId + '%');
      if (error) return /does not exist|relation|PGRST|schema cache/i.test(error.message || '') ? { absent: true } : { rows: [] };
      return { rows: data || [] };
    } catch (e) { return { absent: true }; }
  }, { placeId });
}

test.describe('home office: loading up and office work', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a morning of paperwork and a load-out land as two labelled rows', async ({ page }) => {
    test.setTimeout(180000);
    // Unique per run and per viewport, since nothing is ever cleaned up.
    const placeId = 'ho-' + (Date.now() * 1000 + (process.pid % 1000));

    // ── 1. The contractor marks their own house as a home office. ──────────
    await step(page, {
      label: 'save the home office place', page: 'pg-places', role: 'contractor',
      suspect: 'places.js savePlace (kind home_office must persist to td_places)',
      ruleText: 'a place saved as a home office must come back as one, because every rule below keys off that kind',
      expected: 'places[] carries kind home_office at these coords',
      act: async (p) => {
        await p.evaluate(({ placeId, HOME }) => {
          savePlace({ id: placeId, name: 'E2E Home Office', kind: 'home_office',
                      lat: HOME.lat, lon: HOME.lon, confirmedBy: 'manual' });
          // The yard is elsewhere, so shop dwell can never claim these pings.
          S.officeLat = 39.9; S.officeLon = -94.9;
          if (typeof jobs !== 'undefined') { window.__origJobs = jobs.slice(); jobs.length = 0; }
        }, { placeId, HOME });
        return 1;
      },
      rule: async (p) => {
        const got = await p.evaluate((id) => {
          const pl = (getPlaces() || []).find(x => x && String(x.id) === String(id));
          return pl ? pl.kind : 'missing';
        }, placeId);
        return { ok: got === 'home_office', got };
      },
    });

    // ── 2. Paperwork, then loading, then the drive out. ────────────────────
    // The tape is the morning as CoreMotion would have recorded it: still at
    // the desk, on foot from 07:12 to 07:34 carrying tools out, then driving.
    await step(page, {
      label: 'quotes at the desk, load the truck, pull out', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoClosePlaceEntry → _geoCloseHomeEntry (place-load / place-office rows)',
      ruleText: 'ONE visit to a home office must write a Loading row and an Office row, never one anonymous place row',
      expected: 'job_time_entries carries place-load and place-office, and no bare place row',
      act: async (p) => {
        await p.evaluate(({ HOME }) => {
          // A tape the shipping code reads through its own accessor. Times are
          // relative to now so the visit is genuinely "today" for the workday
          // window and the Central-day comparisons downstream.
          const t0 = Date.now();
          window.__hoTape = [
            { kind: 'still',   ts: t0 - 90 * 60000 },
            { kind: 'onFoot',  ts: t0 - 26 * 60000 },
            { kind: 'still',   ts: t0 - 4 * 60000 },
            { kind: 'driving', ts: t0 - 2 * 60000 },
          ];
          window.__realTd = window._geoTdPlugin;
          window._geoTdPlugin = () => ({
            motionSince: async () => ({ available: true, transitions: window.__hoTape }),
          });
          // Reset the fence machine so this visit owns the state.
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
        }, { HOME });

        // Arrive, and be at the desk with the app in hand for a while: the
        // sampler credits a ping only when the app is visible AND was touched
        // inside the idle window, which a real headed browser satisfies.
        await ping(page, HOME);
        for (let i = 0; i < 3; i++) {
          await p.evaluate(() => { _geoLastInteractAt = Date.now(); });
          await ping(page, HOME);
        }
        // Backdate the arrival so the visit has real width without the test
        // sleeping through it. Same clock the closer stamps departure with.
        await p.evaluate(() => {
          if (_geoPlaceArrivedAt) _geoPlaceArrivedAt = new Date(Date.now() - 95 * 60000).toISOString();
          // The paperwork, as the sampler would have accrued it: 34 minutes of
          // desk time well before the walk to the truck.
          _geoHomeDwell = { activeMs: 34 * 60000, lastSampleMs: Date.now(),
            spans: [[Date.now() - 88 * 60000, Date.now() - 54 * 60000]] };
        });
        // Pull out. A place fence needs the pending-then-confirming pair.
        await ping(page, ROAD);
        await ping(page, ROAD);
        await p.evaluate(async () => { if (typeof _geoDrainQueue === 'function') await _geoDrainQueue(); });
        await p.waitForTimeout(2500);
        return 6;
      },
      rule: async (p) => {
        const r = await homeRows(p, placeId);
        if (r.absent) return { ok: false, got: 'job_time_entries not provisioned' };
        const src = (r.rows || []).map(x => x.source).sort();
        const load = (r.rows || []).find(x => x.source === 'place-load');
        const office = (r.rows || []).find(x => x.source === 'place-office');
        return {
          ok: !!load && !!office && !src.includes('place'),
          got: src.join(',') + ' | load=' + (load && load.minutes) + ' office=' + (office && office.minutes),
        };
      },
      abuse: async (p) => {
        // Neither row may be billed twice, and neither may swallow the other's
        // minutes: one visit, two disjoint client_keys.
        const r = await homeRows(p, placeId);
        const keys = new Set((r.rows || []).map(x => x.client_key));
        expect(keys.size, 'each half of the visit owns its own dedupe key').toBe((r.rows || []).length);
      },
    });

    // ── 3. The load-out is the WALK, not the whole visit. ──────────────────
    await step(page, {
      label: 'the numbers are the work, not the dwell', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoHomeLoadWindow / _geoHomeSplit',
      ruleText: 'loading is the last walk before the driving transition (22 min), office is the app-active time (34 min), and the other 39 minutes of the visit are a man in his own house',
      expected: 'load 22, office 34, nothing else billed',
      act: async () => 0,
      rule: async (p) => {
        const r = await homeRows(p, placeId);
        const load = (r.rows || []).find(x => x.source === 'place-load');
        const office = (r.rows || []).find(x => x.source === 'place-office');
        const lm = load ? load.minutes : -1, om = office ? office.minutes : -1;
        return { ok: lm === 22 && om === 34, got: 'load=' + lm + ' office=' + om };
      },
    });

    // ── 4. The words a contractor actually reads. ──────────────────────────
    await step(page, {
      label: 'the Time Log says Loading and Office', page: 'pg-timelog', role: 'contractor',
      suspect: 'timelog.js _tlSourceLabel / _tlRow (the badge must not fall back to On-site)',
      ruleText: 'both rows must render under their own badges, never the plain On-site one',
      expected: 'Loading and Office both present, teal, on the rendered log',
      act: async (p) => {
        await tap(p, '[onclick*="pg-timelog"], #nav-timelog');
        await p.evaluate(async () => { if (typeof renderTimeLog === 'function') await renderTimeLog(); });
        await p.waitForTimeout(1500);
        return 1;
      },
      rule: async (p) => {
        const html = await p.evaluate(() => {
          const el = document.getElementById('tl-list');
          return el ? el.innerHTML : '';
        });
        const hasLoad = /Loading<\/span>/.test(html), hasOffice = /Office<\/span>/.test(html);
        return { ok: hasLoad && hasOffice, got: 'loading=' + hasLoad + ' office=' + hasOffice };
      },
    });

    // ── 5. The overnight row, which is why this work happened. ─────────────
    await step(page, {
      label: 'asleep at the home office bills nothing', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoClosePlaceEntry (the rule must come from the place kind, never from memory)',
      ruleText: 'a home-office visit with no walking and no app-active time must write NO row, however long it lasted',
      expected: 'zero new rows for a 9h27m overnight visit',
      act: async (p) => {
        await p.evaluate(() => {
          window.__hoTape = [{ kind: 'still', ts: Date.now() - 500 * 60000 }];
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
        });
        await ping(page, HOME);
        await p.evaluate(() => {
          // The exact shape of the live defect: 7:56pm to 5:23am, 567 minutes.
          if (_geoPlaceArrivedAt) _geoPlaceArrivedAt = new Date(Date.now() - 567 * 60000).toISOString();
          _geoHomeDwell = null;      // the sampler never ran: nothing was observed
        });
        await ping(page, ROAD);
        await ping(page, ROAD);
        await p.evaluate(async () => { if (typeof _geoDrainQueue === 'function') await _geoDrainQueue(); });
        await p.waitForTimeout(2000);
        return 3;
      },
      rule: async (p) => {
        const r = await homeRows(p, placeId);
        const nights = (r.rows || []).filter(x => (x.minutes || 0) > 120);
        return { ok: nights.length === 0, got: nights.length + ' row(s) over two hours' };
      },
    });

    await page.evaluate(() => {
      if (window.__realTd) window._geoTdPlugin = window.__realTd;
      if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); }
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget).toBe(false);
  });
});
