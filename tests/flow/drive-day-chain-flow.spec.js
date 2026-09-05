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
// An unnamed kerb: inside nobody's fence, and far enough from BETWEEN that a
// stop anchor formed here is never confused with the in-transit waypoint.
const STOPPIN = { lat: B_LAT + 0.2500, lon: B_LON - 0.2500 };

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


    // ── 4. THE COLD START: a stop is never the origin while a fence is known ─
    // Owner's own account, 2026-08-27 onward: 60 mileage rows named their
    // origin, then every row began reading "Stop -> somewhere". The engine had
    // not stopped knowing where drives began; a settled anonymous stop was
    // recording itself as the origin with no way back, and it only did that
    // when the leg opened with no live fence state, which is what a restored
    // snapshot and a cold boot both look like.
    //
    // The chain is the only place this can be proved end to end, because the
    // damage is cumulative: one stranded stop poisons every later row, so a
    // single-leg test sees a plausible row and a day sees a broken log.
    await step(page, {
      label: 'cold start, park at an unnamed kerb, then finish the leg', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoSettleStopLeg prevOrigin + _geoCollapseDetours',
      ruleText: 'a leg that opens with no live origin must still measure from the last fence the truck was actually inside, never from an anonymous stop',
      expected: 'the surviving row reads shop → job A; no row anywhere names "Stop" as its origin',
      act: async (p) => {
        await p.evaluate(async (d) => {
          window.__origJobs2 = jobs.slice();
          const today = todayKey();
          jobs.length = 0;
          jobs.push({ id: d.jobA, client_id: null, name: 'E2E Chain Job A', eventType: 'job',
                      status: 'upcoming', start: today, days: 1, lat: d.JOB_A.lat, lon: d.JOB_A.lon, _e2e: 'chain' });
          // Exactly what _geoRestoreOpen leaves behind for the owner's shape: the
          // fence the truck was last inside survives, the live leg origin does
          // not. Set here rather than by killing the page because the point of
          // the step is the STATE, and reproducing it directly is the honest way
          // to pin a bug that took three weeks of real driving to surface.
          _geoLegOrigin = null;
          _geoLastFenceLoc = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceAt = new Date(Date.now() - 40 * 60000).toISOString();
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoStopAnchor = null; _geoLegAtShop = false; _geoCurrentClient = null;
          // A drive ALREADY RUNNING is the whole point and the step is hollow
          // without it: the settle at the kerb only fires while a leg is open,
          // and it is the settle that used to strand the origin. This pair,
          // an open drive clock with no live origin beside a remembered fence,
          // is exactly what _geoRestoreOpen hands back when the snapshot
          // predates legOrigin being persisted, which is the owner's own
          // 2026-08-27 shape.
          _geoDriveStartedAt = new Date(Date.now() - 25 * 60000).toISOString();
          saveAll();
        }, { SHOP, JOB_A, jobA });

        // Park at a kerb that is inside nobody's fence. The first ping builds
        // the anchor, back-dating it clears the 5-minute stop floor (the same
        // clock compression the rest of this spec uses), and the next ping is
        // the one that settles the leg.
        await ping(p, STOPPIN);   await p.waitForTimeout(200);
        await p.evaluate(() => {
          if (_geoStopAnchor) _geoStopAnchor.at = new Date(Date.now() - 12 * 60000).toISOString();
        });
        await ping(p, STOPPIN);   await p.waitForTimeout(400);   // settles the stop leg
        // Pull away and finish the journey at job A.
        await ping(p, BETWEEN);   await p.waitForTimeout(200);
        await p.evaluate(() => {
          if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 16 * 60000).toISOString();
        });
        await ping(p, JOB_A);     await p.waitForTimeout(1500);
        await p.evaluate(() => { if (window.__origJobs2) { jobs.length = 0; window.__origJobs2.forEach(j => jobs.push(j)); } });
        // ZERO, for the same reason every other step here is zero: the
        // contractor did not tap anything. A ping is not an interaction.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate((d) => {
          const mine = (typeof mileage !== 'undefined' ? mileage : [])
            .filter(m => m && m.gps && (m.loggedAt || '') >= d.runStart);
          return {
            stranded: mine.filter(m => (m.from_name || m.from || '') === 'Stop').length,
            intoJobA: mine.filter(m => m.toCoord &&
              Math.abs(m.toCoord.lat - d.JOB_A.lat) < 1e-4 && Math.abs(m.toCoord.lng - d.JOB_A.lon) < 1e-4)
              .map(m => ({ from: m.from_name || m.from || '', crumb: !!(m.passedThrough && m.passedThrough.stop) })),
            originKind: _geoLegOrigin && _geoLegOrigin.kind,
          };
        }, { runStart, JOB_A });
        // Three halves of one rule, and the third is what stops this step being
        // hollow. No row may name an anonymous pin as where a drive began, the
        // row that survives has to name the real endpoint (a log with the
        // "Stop" rows merely deleted would pass the first test and still have
        // lost the day), AND the surviving row must carry the breadcrumb
        // proving a stop was actually parked at and folded out. Without that
        // last check a run where the stop never settled at all reads green
        // while exercising none of the bug.
        const named = out.intoJobA.filter(r => r.from && r.from !== 'Stop');
        const ok = out.stranded === 0 && named.length >= 1
                   && /shop/i.test(named[named.length - 1].from)
                   && out.intoJobA.some(r => r.crumb);
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 5. THE TAPE SETS THE CLOCK ──────────────────────────────────────────
    // A geofence cannot fire until a line several hundred feet away has been
    // crossed, but driving starts at the parking space. Measured on the owner's
    // account, the fix taken at the fence sat a mile from where the drive began
    // on five of ten real departures. CoreMotion knew at the parking space, so
    // a held foot -> automotive edge is what opens the leg.
    await step(page, {
      label: 'the leg opens at the moment the motion tape saw, not the fence', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoTdEvent motion branch + the drive-open site',
      ruleText: 'a recent held foot → automotive edge must become the drive start, so the clock reads from the parking space rather than from the fence line',
      expected: 'the leg opens ~7 minutes before the fence exit, not at the exit',
      act: async (p) => {
        await p.evaluate(async (d) => {
          _geoLegOrigin = null; _geoDriveStartedAt = null; _geoDrivePendingAt = null;
          _geoStopAnchor = null; _geoCurrentJob = null; _geoArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null;
          _geoLastFenceLoc = { lat: d.SHOP.lat, lng: d.SHOP.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceAt = new Date(Date.now() - 30 * 60000).toISOString();
          // PARKED AT THE SHOP, or nothing here happens. The drive-open site
          // only runs on a fence EXIT, so the state has to say we are inside
          // one; a step that starts nowhere never opens a leg and would assert
          // against a null clock. The shop is also the one fence whose exit
          // needs no second confirming ping (that gate covers job/place/client
          // only), which is why the departure below is a single ping.
          _geoWasInShop = true; _geoLegAtShop = true;
          _geoShopArrivedAt = new Date(Date.now() - 30 * 60000).toISOString();
          _geoLastMotionKind = 'walking';
          // The real plugin event, through the real entry point. ts is a float
          // ms exactly as the Swift side sends it, because rounding it the same
          // way on both sides is what stops the phone and the server minting
          // two different leg keys for one departure.
          await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                              ts: Date.now() - 7 * 60000 + 0.4 });
        }, { SHOP });
        await p.waitForTimeout(150);
        await ping(p, BETWEEN);   await p.waitForTimeout(500);
        return 0;   // a motion transition is the phone noticing, not the person tapping
      },
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          // Both read inside one evaluate: the page's clock and the runner's
          // clock are two different clocks and comparing across them is
          // meaningless (CLAUDE.md §5.2.1).
          now: Date.now(),
          startedAt: _geoDriveStartedAt,
          pendingCleared: _geoDrivePendingAt === null,
        }));
        const ageSec = out.startedAt ? Math.round((out.now - Date.parse(out.startedAt)) / 1000) : -1;
        // 7 minutes back, with slack for the waits above. The lower bound is the
        // load-bearing half: at 0 the tape was ignored and the fence set the
        // clock, which is the whole bug. The upper bound stops a stale mark from
        // backdating a leg into last week.
        const ok = ageSec >= 360 && ageSec <= 480 && out.pendingCleared;
        return { ok, got: JSON.stringify({ ...out, ageSec }) };
      },
    });

    // ── 6. AND REFUSES TO SET IT WHEN IT SHOULDN'T ─────────────────────────
    // The negative half, and it is the half that keeps the feature honest. A
    // phone in a pocket reads automotive from a ride in somebody else's truck,
    // and the same edge fires pulling forward ten feet in a yard. So the mark
    // is held, never spent on its own, and it expires: older than the cap,
    // stamped in the future, or cancelled outright the moment they come to rest.
    // Without this step the ratchet only ever proves the clock can move
    // backwards, which is exactly how a backdating bug ships looking correct.
    let staleOpen = null, futHeld = null, futOpen = null, restHeld = null, restOpen = null;
    await step(page, {
      label: 'a stale, future or cancelled motion mark never backdates a leg', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _GEO_DRIVE_PENDING_MAX_MS + the rest-cancels branch',
      ruleText: 'a held departure older than the cap, stamped in the future, or followed by coming to rest, must not set the drive clock',
      expected: 'all three refuse the tape and open the leg at the fence instead',
      act: async (p) => {
        const arm = (offsetMs, thenRest) => p.evaluate(async (o) => {
          _geoLegOrigin = null; _geoDriveStartedAt = null; _geoDrivePendingAt = null;
          _geoStopAnchor = null; _geoCurrentJob = null; _geoArrivedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoCurrentClient = null;
          _geoLastFenceLoc = { lat: o.lat, lng: o.lon, name: 'Shop', kind: 'shop' };
          _geoLastFenceAt = new Date(Date.now() - 30 * 60000).toISOString();
          // Parked at the shop for the same reason as the step above: a leg
          // only opens on a fence exit, so each of the three cases has to start
          // from inside one to have a clock to be wrong about.
          _geoWasInShop = true; _geoLegAtShop = true;
          _geoShopArrivedAt = new Date(Date.now() - 30 * 60000).toISOString();
          _geoLastMotionKind = 'walking';
          await _geoTdEvent({ type: 'motion', kind: 'automotive', prevKind: 'walking',
                              ts: Date.now() + o.offsetMs });
          if (o.thenRest) {
            await _geoTdEvent({ type: 'motion', kind: 'walking', prevKind: 'automotive', ts: Date.now() });
          }
          return { pending: _geoDrivePendingAt };
        }, { lat: SHOP.lat, lon: SHOP.lon, offsetMs, thenRest });
        // now and startedAt out of ONE evaluate: the page's clock and the
        // runner's clock are two different clocks and an assertion that
        // straddles them is meaningless (CLAUDE.md §5.2.2).
        const opened = () => p.evaluate(() => ({ now: Date.now(), startedAt: _geoDriveStartedAt }));

        // Stale: 40 minutes old, well past the 15-minute cap.
        await arm(-40 * 60000, false);
        await ping(p, BETWEEN); await p.waitForTimeout(400);
        staleOpen = await opened();

        // Future: clock skew on a replayed buffer must never reach forward.
        futHeld = await arm(5 * 60000, false);
        await ping(p, BETWEEN); await p.waitForTimeout(400);
        futOpen = await opened();

        // Rest: they got out and walked. Whatever that edge was about, it is
        // not the departure a fence exit ten minutes from now describes.
        restHeld = await arm(-6 * 60000, true);
        await ping(p, BETWEEN); await p.waitForTimeout(400);
        restOpen = await opened();
        return 0;
      },
      rule: async () => {
        const age = (o) => (o && o.startedAt) ? Math.round((o.now - Date.parse(o.startedAt)) / 1000) : -1;
        const out = {
          staleSec: age(staleOpen),
          futureHeld: !!futHeld && futHeld.pending === null,
          futureSec: age(futOpen),
          restCleared: !!restHeld && restHeld.pending === null,
          restSec: age(restOpen),
        };
        // Every one of these must open at the FENCE, which means a leg seconds
        // old rather than minutes. 90s of slack covers the waits above; the
        // failures they guard against are 6 to 40 minutes wide, so the margin
        // can be generous without the test losing its teeth.
        const ok = out.staleSec >= 0 && out.staleSec < 90
                && out.futureHeld && out.futureSec >= 0 && out.futureSec < 90
                && out.restCleared && out.restSec >= 0 && out.restSec < 90;
        return { ok, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
