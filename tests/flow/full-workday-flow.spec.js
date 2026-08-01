// REAL flow: a full 8-hour working day reconciles to 8 hours.
//
// Owner-designed (2026-08-01): "simulate a full 8 hour day starting at the shop,
// going to get supplies going back then going to lunch, it should know that
// fully automatic driving is being handled in the background."
//
// The day-chain spec proves every DRIVE leg exists. This proves the harder
// thing: that every MINUTE of the day is accounted for, and accounted for as
// the right KIND of time. A minute in the wrong bucket is a payroll error or a
// bad deduction, and unlike a missing leg it is invisible, the totals still
// look plausible. So the closing assertion is arithmetic: shop + drive +
// on-site + supply + off-job must add back up to the 8 hours that were driven.
//
// Three defects this locks down, all found by building this day:
//
//   1. LUNCH WAS DRIVING. Nothing outside a fence closed the drive clock, so
//      job -> lunch -> job logged ONE 65-minute leg instead of two 10-minute
//      ones. Forty-five minutes of lunch became compensable drive time with
//      mileage attached to it: wrong on payroll and wrong on the deduction.
//   2. TIME AT A SUPPLY HOUSE VANISHED. The fence stopped it counting as
//      driving, but nothing recorded it, so twenty paid minutes loading
//      material simply left the day.
//   3. A PERSONAL-VEHICLE LEG WAS BILLED AS JOB LABOR. finance.js tested
//      `source === 'drive'` exactly, which does not match 'drive-personal', so
//      that leg fell through to the on-site branch and landed on a job's cost.
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'places/full-8h-workday';

// Own cell, for the reason every geo spec needs one: live tests never clean up
// (§12.7), so fixed coordinates stack places forever and placeAt() starts
// resolving a previous run's row. Base 47N/103W keeps this clear of
// geo-stamp-places (38N/96W), drive-attribution (41N/98W) and
// drive-day-chain (44N/100W).
const CELL = (process.pid + Date.now()) % 10000;
const B_LAT = 47.0 + (CELL % 100) * 0.02;
const B_LON = -103.0 - (Math.floor(CELL / 100) % 100) * 0.02;
const SHOP   = { lat: B_LAT,          lon: B_LON };
const JOB    = { lat: B_LAT + 0.0300, lon: B_LON - 0.0300 };
const SUPPLY = { lat: B_LAT + 0.0600, lon: B_LON - 0.0600 };
// Lunch is deliberately NOT a known place and never becomes one: a single visit
// is not a pattern, and the app must not invent a business location out of one
// sandwich. It only has to stop counting as driving.
const LUNCH  = { lat: B_LAT + 0.0900, lon: B_LON - 0.0900 };
const ROAD   = { lat: B_LAT + 0.4000, lon: B_LON - 0.4000 };

// The day, as SEGMENT DURATIONS in minutes.
//
// Not timeline positions, which is the trap here: every close in geo-track.js
// measures against `now`, so a clock has to be rewound by the length of the
// segment it is about to close, immediately before the ping that closes it.
// Setting "07:00" on the shop clock would produce a 480-minute shop visit.
const D = {
  shop:     45,   // load the truck
  toJob:    25,
  onJob1:  165,
  toSupply: 15,
  atSupply: 20,   // <- used to vanish entirely
  toJob2:   12,
  onJob2:   83,
  toLunch:  10,
  lunch:    45,   // <- used to be logged as driving
  toJob3:   10,
  onJob3:   25,
  toShop:   25,
};
const EXPECT = {
  shop:   D.shop,
  drive:  D.toJob + D.toSupply + D.toJob2 + D.toLunch + D.toJob3 + D.toShop,   // 97
  onSite: D.onJob1 + D.onJob2 + D.onJob3,                                      // 273
  place:  D.atSupply,
  off:    D.lunch,
};
const TOTAL = EXPECT.shop + EXPECT.drive + EXPECT.onSite + EXPECT.place + EXPECT.off; // 480

test.describe('A full 8-hour day: shop → job → supply → job → lunch → job → shop', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('every minute of the day lands in the right bucket and the day adds up to 8 hours', async ({ page }) => {
    test.setTimeout(240000);

    const ready = await page.evaluate(async () => {
      const out = { places: false, dest: false };
      try { out.places = !(await _supa.from('td_places').select('id').limit(1)).error; } catch (e) {}
      try { out.dest = !(await _supa.from('job_time_entries').select('dest_place').limit(1)).error; } catch (e) {}
      return out;
    });
    test.skip(!ready.places, 'td_places not migrated to Dev yet (merges with this PR)');
    test.skip(!ready.dest, 'job_time_entries.dest_place not migrated to Dev yet (merges with this PR)');

    const tag = String(process.pid).slice(-6) + '-' + Date.now().toString(36).slice(-4);
    const SUPPLY_NAME = `E2E Supply Day ${tag}`;
    const jobId = Date.now() * 1000 + 7;
    const runStart = new Date().toISOString();

    const ping = (p, c) => p.evaluate(async ({ lat, lon }) => {
      await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } });
    }, { lat: c.lat, lon: c.lon });

    // The day has to be DRIVEN in seconds, so every open clock is rewritten to
    // the timeline above the moment it opens. Absolute stamps, never relative
    // back-dating: a leg and the stop that ends it share an edge, and nudging
    // each one by its own offset silently produces negative durations.
    const setClock = (p, patch) => p.evaluate((patch) => {
      const at = m => new Date(Date.now() - m * 60000).toISOString();
      if ('drive' in patch)  _geoDriveStartedAt = patch.drive == null ? null : at(patch.drive);
      if ('job' in patch)    _geoArrivedAt      = patch.job == null ? null : at(patch.job);
      if ('shop' in patch)   _geoShopArrivedAt  = patch.shop == null ? null : at(patch.shop);
      if ('place' in patch)  _geoPlaceArrivedAt = patch.place == null ? null : at(patch.place);
      if ('stopAt' in patch && _geoStopAnchor) _geoStopAnchor.at = at(patch.stopAt);
      if ('stopEnd' in patch && _geoStopAnchor) _geoStopAnchor.lastAt = at(patch.stopEnd);
    }, patch);

    // ── 1. The day's fixtures ──────────────────────────────────────────────
    await step(page, {
      label: 'shop, supply house and one job on file', page: 'pg-team', role: 'contractor',
      suspect: 'places.js savePlace + jobs seeding',
      ruleText: 'every waypoint must resolve, or the arithmetic at the end proves nothing',
      expected: 'the supply house resolves and the job is today\'s job',
      act: async (p) => {
        await p.evaluate((d) => {
          window.__origJobs = jobs.slice();
          S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
          S.teamTracking = true;
          savePlace({ name: d.SUPPLY_NAME, kind: 'supply', lat: d.SUPPLY.lat, lon: d.SUPPLY.lon, confirmedBy: 'manual' });
          jobs.length = 0;
          jobs.push({ id: d.jobId, client_id: null, name: 'E2E Workday Job', eventType: 'job',
                      status: 'upcoming', start: todayKey(), days: 1, lat: d.JOB.lat, lon: d.JOB.lon, _e2e: 'workday' });
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          // A lunch spot left over from a previous run would already be a known
          // place, and lunch would stop being an UNKNOWN stop, which is the
          // entire point of it.
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          saveAll();
        }, { SHOP, SUPPLY, JOB, SUPPLY_NAME, jobId });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 2;
      },
      rule: async (p) => {
        const out = await p.evaluate((d) => {
          const s = placeAt({ lat: d.SUPPLY.lat, lon: d.SUPPLY.lon });
          return {
            supply: s && s.name,
            lunchIsUnknown: !placeAt({ lat: d.LUNCH.lat, lon: d.LUNCH.lon }),
            myJobs: (typeof _geoMyJobs === 'function' ? _geoMyJobs() : []).length,
          };
        }, { SUPPLY, LUNCH });
        const ok = out.supply === SUPPLY_NAME && out.lunchIsUnknown && out.myJobs === 1;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 2. Work the day ────────────────────────────────────────────────────
    await step(page, {
      label: 'work the day: shop → job → supply → job → lunch → job → shop', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing (shop / place / stop-anchor / job branches)',
      ruleText: 'a full working day must be captured with no manual clocking of any kind',
      expected: 'the day closes with nothing left open and no phantom job still running',
      act: async (p) => {
        // 07:00, in the shop loading the truck.
        await ping(p, SHOP);            await p.waitForTimeout(250);
        await setClock(p, { shop: D.shop });          // closes on the next ping out

        // Out to the job.
        await ping(p, ROAD);            await p.waitForTimeout(200);
        await setClock(p, { drive: D.toJob });
        await ping(p, JOB);             await p.waitForTimeout(400);
        await setClock(p, { job: D.onJob1 });

        // Out to the supply house.
        await ping(p, ROAD);            await p.waitForTimeout(200);
        await setClock(p, { drive: D.toSupply });
        await ping(p, SUPPLY);          await p.waitForTimeout(400);
        await setClock(p, { place: D.atSupply });

        // Back to the job with the material.
        await ping(p, ROAD);            await p.waitForTimeout(200);
        await setClock(p, { drive: D.toJob2 });
        await ping(p, JOB);             await p.waitForTimeout(400);
        await setClock(p, { job: D.onJob2 });

        // Lunch: nowhere the app knows about, and no fence will ever contain it.
        // Two pings in the same lot are what make it a dwell rather than a
        // coordinate we drove past.
        await ping(p, ROAD);            await p.waitForTimeout(200);
        await ping(p, LUNCH);           await p.waitForTimeout(300);
        await ping(p, { lat: LUNCH.lat + 0.00004, lon: LUNCH.lon }); await p.waitForTimeout(300);
        // The stop and the leg that ended at it share an edge, so both are set
        // together: parked from lunch+toLunch ago until lunch ago, having pulled
        // out of the job toLunch minutes before that.
        await setClock(p, {
          stopEnd: D.toJob3,                            // pulled out of lunch 10m ago
          stopAt:  D.toJob3 + D.lunch,                  // parked 45m before that
          drive:   D.toJob3 + D.lunch + D.toLunch,      // left the job 10m before parking
        });

        // Back to the job. THIS ping settles the stop and splits the leg, and it
        // also restarts the drive clock at the moment they pulled out of lunch,
        // so the leg that follows is not set here: letting the machine's own
        // value stand is what proves the restart works.
        await ping(p, ROAD);            await p.waitForTimeout(250);
        await ping(p, JOB);             await p.waitForTimeout(400);
        await setClock(p, { job: D.onJob3 });

        // Home to the shop: end of day.
        await ping(p, ROAD);            await p.waitForTimeout(200);
        await setClock(p, { drive: D.toShop });
        await ping(p, SHOP);            await p.waitForTimeout(2500); // drain the durable queue
        await p.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); } });
        // 14 GPS pings, and zero taps: the contractor did not clock in, clock
        // out, or classify a single minute of this day. That is the feature.
        return 14;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          driveOpen: !!_geoDriveStartedAt, jobOpen: !!_geoCurrentJob,
          placeOpen: !!_geoPlaceArrivedAt, inShop: !!_geoWasInShop,
        }));
        const ok = !out.driveOpen && !out.jobOpen && !out.placeOpen && out.inShop;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 3. The day adds up to 8 hours, bucket by bucket ────────────────────
    await step(page, {
      label: 'the day reconciles to 8 hours', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoCloseStop / _geoClosePlaceEntry / _geoDriveEntry(endedIso)',
      ruleText: 'every minute of a working day must be logged exactly once, as the right kind of time',
      expected: `shop ${EXPECT.shop} + drive ${EXPECT.drive} + on-site ${EXPECT.onSite} + supply ${EXPECT.place} + off-job ${EXPECT.off} = ${TOTAL}`,
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async ({ jobId, runStart, SUPPLY_NAME }) => {
          const uid = _supaUser && _supaUser.id;
          const since = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
          const j = await _supa.from('job_time_entries')
            .select('minutes,source,dest_place,job_id,arrived_at,created_at')
            .eq('contractor_user_id', uid).gte('arrived_at', since);
          if (j.error) return { err: 'job_time_entries: ' + j.error.message };
          const s = await _supa.from('shop_time_entries')
            .select('minutes,arrived_at,created_at')
            .eq('contractor_user_id', uid).gte('arrived_at', since);
          if (s.error) return { err: 'shop_time_entries: ' + s.error.message };
          // created_at scopes this to THIS run. Seed data is never cleaned up
          // (§12.7), so a window on arrived_at alone would sweep in every
          // previous run's day and the arithmetic would be meaningless.
          const mine = (r) => !r.created_at || r.created_at >= runStart;
          const rows = (j.data || []).filter(mine);
          const shopRows = (s.data || []).filter(mine);
          const sum = (a) => a.reduce((t, r) => t + (r.minutes || 0), 0);
          const by = (f) => rows.filter(f);
          const drives = by(r => /^drive/.test(r.source || ''));
          const stops = by(r => r.source === 'stop');
          const places = by(r => r.source === 'place');
          const onSite = by(r => /^geofence/.test(r.source || '') && String(r.job_id) === String(jobId));
          return {
            shop: sum(shopRows), shopN: shopRows.length,
            drive: sum(drives), driveN: drives.length,
            onSite: sum(onSite), onSiteN: onSite.length,
            place: sum(places), placeN: places.length, placeNamed: places.every(r => r.dest_place === SUPPLY_NAME),
            off: sum(stops), offN: stops.length, offUnattributed: stops.every(r => !r.job_id),
            // The tell for bug #1: with lunch riding on a leg the longest drive
            // is 65 minutes instead of 25.
            longestDrive: drives.reduce((m, r) => Math.max(m, r.minutes || 0), 0),
            // DIAGNOSTIC. Bucket totals say WHAT is missing but never WHY, and
            // guessing at a state machine from five numbers is how a patch
            // chain starts. This prints what actually landed, plus whether the
            // durable queue is stuck: it is FIFO and breaks on the first error,
            // so one rejected row silently strands every row behind it.
            all: rows.map(r => (r.source || '?') + ':' + r.minutes).join(','),
            queued: (() => {
              try {
                return JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]')
                  .map(q => q.tbl + '/' + (q.row && q.row.source || '?')).join(',');
              } catch (e) { return 'unreadable'; }
            })(),
            // The classification the money views actually use, exercised through
            // the real predicates rather than re-implemented here.
            paid: rows.filter(r => !_geoIsOffJobSource(r.source)).reduce((t, r) => t + (r.minutes || 0), 0) + sum(shopRows),
            billableToJob: rows.filter(r => !_geoIsOffJobSource(r.source) && !_geoIsDriveSource(r.source) && !_geoIsPlaceSource(r.source))
                               .reduce((t, r) => t + (r.minutes || 0), 0),
            // One sandwich is not a pattern: the stop is remembered so a REPEAT
            // could eventually be offered, but nothing is suggested off one visit.
            suggestions: pendingPlaceSuggestions().length,
          };
        }, { jobId, runStart, SUPPLY_NAME });
        if (out.err) return { ok: false, got: out.err };
        const near = (a, b) => Math.abs(a - b) <= 2;   // one minute of rounding at each edge
        const total = out.shop + out.drive + out.onSite + out.place + out.off;
        const ok =
          near(out.shop, EXPECT.shop) &&
          near(out.drive, EXPECT.drive) && out.driveN === 6 &&
          near(out.onSite, EXPECT.onSite) && out.onSiteN === 3 &&
          near(out.place, EXPECT.place) && out.placeN === 1 && out.placeNamed &&
          near(out.off, EXPECT.off) && out.offN === 1 && out.offUnattributed &&
          out.longestDrive <= 27 &&
          near(total, TOTAL) &&
          // Lunch is captured but NOT payable, and never billed to the job.
          near(out.paid, TOTAL - EXPECT.off) &&
          near(out.billableToJob, EXPECT.onSite) &&
          out.suggestions === 0;
        return { ok, got: JSON.stringify(out) + ' total=' + total + '/' + TOTAL };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
