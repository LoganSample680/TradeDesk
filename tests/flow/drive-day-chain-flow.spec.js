// REAL flow: a whole working day of automatic drives, end to end.
//
// Owner-designed (2026-08-01). The unit-shaped drive test proves one hop; this
// proves the DAY, which is the only thing a contractor actually experiences:
//
//   home office → job A → supply house → job B → job C → shop
//
// Five legs, three job visits, four different kinds of fence. Every leg has to
// appear, once, attributed to the right destination. A chain is the only way to
// catch the failure mode that matters most here: not "a leg is wrong" but "a leg
// silently isn't there". Two such holes existed and each looked fine in isolation:
//
//   • arriving at a SUPPLY HOUSE never closed a leg, because a drive entry was
//     only ever written on arriving at a JOB. Fixed with the known-place fence.
//   • arriving at the SHOP nulled the drive clock WITHOUT writing anything, so
//     the last leg of every day vanished. The shop is matched before the place
//     fence runs, so fixing places alone left this one live. Found by designing
//     this test, before it ever ran.
//
// THE HOME OFFICE IS DELIBERATE. Home-to-first-job is normally a commute and not
// deductible, which is why the suggestion engine refuses to auto-create a place
// at the day's starting coordinate. But a contractor who has explicitly marked a
// qualifying home office has a different tax answer, and the first leg IS
// business. That distinction only holds if an explicitly-marked home_office
// place produces a leg, so the chain starts there on purpose.
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'places/full-day-drive-chain';

// Own cell on a wide grid, for the reason every geo spec needs one: live tests
// never clean up (§12.7), so fixed coordinates stack places on top of each other
// forever and placeAt() starts resolving a previous run's row. 0.02deg is ~1.4mi,
// far outside the 600ft fence. Base 44N/100W keeps this spec clear of
// geo-stamp-places (38N/96W) and drive-attribution (41N/98W).
const CELL = (process.pid + Date.now()) % 10000;
const B_LAT = 44.0 + (CELL % 100) * 0.02;
const B_LON = -100.0 - (Math.floor(CELL / 100) % 100) * 0.02;
// Six waypoints, each far enough from the others that none sits in another's fence.
const HOME   = { lat: B_LAT,          lon: B_LON };
const JOB_A  = { lat: B_LAT + 0.0300, lon: B_LON - 0.0300 };
const SUPPLY = { lat: B_LAT + 0.0600, lon: B_LON - 0.0600 };
const JOB_B  = { lat: B_LAT + 0.0900, lon: B_LON - 0.0900 };
const JOB_C  = { lat: B_LAT + 0.1200, lon: B_LON - 0.1200 };
const SHOP   = { lat: B_LAT + 0.1500, lon: B_LON - 0.1500 };
// Between waypoints, so the machine sees a real departure before each arrival.
const BETWEEN = { lat: B_LAT + 0.4000, lon: B_LON - 0.4000 };

test.describe('Full day of automatic drives: home office → job → supply → job → job → shop', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('every leg of a real working day is logged, once, to the right destination', async ({ page }) => {
    test.setTimeout(240000);

    const tableReady = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('td_places').select('id').limit(1);
        return !error;
      } catch (e) { return false; }
    });
    test.skip(!tableReady, 'td_places not migrated to Dev yet (merges with this PR)');

    const tag = String(process.pid).slice(-6) + '-' + Date.now().toString(36).slice(-4);
    const HOME_NAME = `E2E Home Office ${tag}`;
    const SUPPLY_NAME = `E2E Supply ${tag}`;
    const jobA = Date.now() * 1000 + 1, jobB = Date.now() * 1000 + 2, jobC = Date.now() * 1000 + 3;
    const runStart = new Date().toISOString();

    // The real ping entry point, the same one watchPosition calls.
    const ping = (p, c) => p.evaluate(async ({ lat, lon }) => {
      await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } });
    }, { lat: c.lat, lon: c.lon });

    // Back-date the open clocks so each leg and each visit clears the 2-minute
    // floor that suppresses phantom entries. A day that really takes 8 hours has
    // to be driven in seconds, and without this every entry is a GPS twitch.
    const age = (p, mins) => p.evaluate((mins) => {
      const t = new Date(Date.now() - mins * 60000).toISOString();
      if (_geoDriveStartedAt) _geoDriveStartedAt = t;
      if (_geoArrivedAt) _geoArrivedAt = t;
    }, mins);

    // ── 1. Set the day up: the places and the three jobs ────────────────────
    await step(page, {
      label: 'home office, supply house, shop and three jobs on file', page: 'pg-team', role: 'contractor',
      suspect: 'places.js savePlace + jobs seeding',
      ruleText: 'every waypoint must be resolvable, or the chain proves nothing',
      expected: 'placeAt() resolves home office and supply house; all three jobs are today\'s jobs',
      act: async (p) => {
        await p.evaluate((d) => {
          window.__origJobs = jobs.slice();
          S.officeLat = d.SHOP.lat; S.officeLon = d.SHOP.lon;
          S.teamTracking = true;
          savePlace({ name: d.HOME_NAME, kind: 'home_office', lat: d.HOME.lat, lon: d.HOME.lon, confirmedBy: 'manual' });
          savePlace({ name: d.SUPPLY_NAME, kind: 'supply', lat: d.SUPPLY.lat, lon: d.SUPPLY.lon, confirmedBy: 'manual' });
          const today = todayKey();
          jobs.length = 0;
          [[d.jobA, d.JOB_A, 'A'], [d.jobB, d.JOB_B, 'B'], [d.jobC, d.JOB_C, 'C']].forEach(([id, c, n]) => {
            jobs.push({ id, client_id: null, name: 'E2E Chain Job ' + n, eventType: 'job',
                        status: 'upcoming', start: today, days: 1, lat: c.lat, lon: c.lon, _e2e: 'chain' });
          });
          // A clean state machine, or a leftover open leg contaminates leg one.
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          saveAll();
        }, { HOME, SUPPLY, SHOP, JOB_A, JOB_B, JOB_C, HOME_NAME, SUPPLY_NAME, jobA, jobB, jobC });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate((d) => {
          const h = placeAt({ lat: d.HOME.lat, lon: d.HOME.lon });
          const s = placeAt({ lat: d.SUPPLY.lat, lon: d.SUPPLY.lon });
          return {
            home: h && h.name, homeKind: h && h.kind, supply: s && s.name,
            myJobs: (typeof _geoMyJobs === 'function' ? _geoMyJobs() : []).length,
          };
        }, { HOME, SUPPLY });
        const ok = out.home === HOME_NAME && out.homeKind === 'home_office'
                   && out.supply === SUPPLY_NAME && out.myJobs === 3;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 2. Drive the whole day ─────────────────────────────────────────────
    await step(page, {
      label: 'drive the full day: home → A → supply → B → C → shop', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing fence machine (shop / place / job branches)',
      ruleText: 'every departure-to-arrival leg of a working day must produce exactly one drive entry',
      expected: '5 drive legs and 3 job visits, none missing, none duplicated',
      act: async (p) => {
        // Start the day parked at the home office.
        await ping(p, HOME);       await p.waitForTimeout(200);
        // Leave. Every hop is: pull out (opens a leg) → age it → arrive.
        const hop = async (dest, mins) => {
          await ping(p, BETWEEN);  await p.waitForTimeout(150);
          await age(p, mins);
          await ping(p, dest);     await p.waitForTimeout(400);
        };
        await hop(JOB_A, 22);      // home office → job A
        await age(p, 95);          // a morning on site
        await hop(SUPPLY, 14);     // job A → supply house
        await hop(JOB_B, 19);      // supply house → job B
        await age(p, 70);
        await hop(JOB_C, 11);      // job B → job C
        await age(p, 55);
        await hop(SHOP, 26);       // job C → back to the shop
        await p.waitForTimeout(2000); // let the durable queue drain
        await p.evaluate(() => { if (window.__origJobs) { jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); } });
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(async (d) => {
          const uid = _supaUser && _supaUser.id;
          const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
          const { data, error } = await _supa.from('job_time_entries')
            .select('minutes,source,dest_place,job_id,arrived_at,created_at')
            .eq('contractor_user_id', uid).gte('arrived_at', since);
          if (error) return { err: error.code + ' ' + error.message };
          // Scope to THIS run. Live tests never clean up (§12.7), so a six-hour
          // window on arrived_at alone sweeps in every earlier run's day and the
          // counts become meaningless: driveCount read 27 and toShop 4 because
          // four runs had each logged a leg home. toSupply and toJobs looked
          // fine only because those identifiers are already unique per run,
          // which is exactly what made the bug look like an app defect.
          const rows = (data || []).filter(r => !r.created_at || r.created_at >= d.runStart);
          const drives = rows.filter(r => /^drive/.test(r.source || ''));
          const visits = rows.filter(r => !/^drive/.test(r.source || '')
                                       && [d.jobA, d.jobB, d.jobC].map(String).includes(String(r.job_id)));
          return {
            driveCount: drives.length,
            // Named destinations prove attribution, not just that a row exists.
            toSupply: drives.filter(r => r.dest_place === d.SUPPLY_NAME).length,
            toShop: drives.filter(r => r.dest_place && /shop/i.test(r.dest_place)).length,
            toJobs: drives.filter(r => [d.jobA, d.jobB, d.jobC].map(String).includes(String(r.job_id))).length,
            visitCount: visits.length,
            // No leg may swallow a whole on-site block: a drive longer than the
            // longest real leg means parked time leaked into driving.
            longestDrive: drives.reduce((m, r) => Math.max(m, r.minutes || 0), 0),
          };
        }, { jobA, jobB, jobC, SUPPLY_NAME, runStart });
        // No escape hatch on a missing column. dest_place now ships in a
        // migration, so its absence is a real failure: the previous "skip if the
        // column is missing" branch would have returned green while asserting
        // nothing at all, which is worse than the bug it was hiding.
        const ok = !out.err && out.driveCount === 5 && out.toSupply === 1 && out.toShop === 1
                   && out.toJobs === 3 && out.visitCount === 3 && out.longestDrive < 40;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 3. The day ends clean ──────────────────────────────────────────────
    await step(page, {
      label: 'the day ends with nothing left open', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js shop-arrival branch',
      ruleText: 'parking at the shop must close the day: no drive clock left running to bleed into tomorrow',
      expected: 'no open drive leg and no open job visit',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          driveOpen: !!_geoDriveStartedAt,
          jobOpen: !!_geoCurrentJob,
          inShop: !!_geoWasInShop,
        }));
        const ok = !out.driveOpen && !out.jobOpen && out.inShop;
        return { ok, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
