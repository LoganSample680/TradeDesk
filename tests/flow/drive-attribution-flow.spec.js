// REAL flow: a supply run produces real, correctly attributed miles.
//
// Three defects this locks down, all of which got a contractor's DEDUCTION
// wrong, which makes them accuracy bugs rather than UX ones:
//
//   1. Time PARKED at a supply house counted as driving. No fence contained the
//      truck, so the drive clock kept running while it sat in the lot, and those
//      minutes landed on the next job's drive leg.
//   2. A supply run that returned to the shop logged NOTHING AT ALL. Leaving the
//      shop started the clock, but arriving back merely cleared it, because
//      _geoDriveEntry only ever fired on arriving at a JOB. A real, deductible
//      round trip produced zero miles.
//   3. Every leg billed to its destination job, so shop -> supply -> job charged
//      that job for the supply stop too, and Job Profit was wrong.
//
// Why offline shards cannot close this: the fence state machine is driven by a
// SEQUENCE of real pings, and its output is rows in job_time_entries written
// through the offline-durable queue. A mock proves neither the sequencing nor
// that anything survived the queue into Postgres.
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'places/drive-attribution';

// Each run gets its OWN cell, for the same reason geo-stamp-places does: live
// tests never clean up (§12.7), so fixed coordinates meant every run created
// another place on top of the last one and placeAt() would resolve whichever it
// found first, which is not necessarily this run's. Base 41N/98W keeps this
// spec's band clear of geo-stamp-places' 38N/96W.
const CELL = (process.pid + Date.now()) % 10000;
const BASE_LAT = 41.0 + (CELL % 100) * 0.02;
const BASE_LON = -98.0 - (Math.floor(CELL / 100) % 100) * 0.02;
// Within a cell the three points are far enough apart that none sits inside
// another's 600ft fence.
const SHOP   = { lat: BASE_LAT,          lon: BASE_LON };
const SUPPLY = { lat: BASE_LAT + 0.0300, lon: BASE_LON - 0.0300 };  // ~2.5mi away
const AWAY   = { lat: BASE_LAT + 0.1100, lon: BASE_LON - 0.1100 };  // outside every fence

test.describe('Drive attribution: a supply run logs real miles, parked time is not driving', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('shop to supply house and back produces a drive entry that used to be zero', async ({ page }) => {
    test.setTimeout(180000);

    const tableReady = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('td_places').select('id').limit(1);
        return !error;
      } catch (e) { return false; }
    });
    test.skip(!tableReady, 'td_places not migrated to Dev yet (merges with this PR)');

    const runId = String(process.pid).slice(-6).padStart(6, '0');
    const supplyName = `E2E Yard ${runId}-${Date.now().toString(36).slice(-4)}`;

    // Feed a coordinate straight into the real ping handler. This is the same
    // entry point watchPosition calls, so the whole state machine runs for real.
    const ping = (p, lat, lon) => p.evaluate(async ({ lat, lon }) => {
      await _geoOnPing({ coords: { latitude: lat, longitude: lon, accuracy: 8 } });
    }, { lat, lon });

    // ── 1. Register the shop and the supply house as real places ───────────
    await step(page, {
      label: 'contractor has a shop and a supply house on file', page: 'pg-team', role: 'contractor',
      suspect: 'places.js savePlace + the td_places sync fabric',
      ruleText: 'both locations must be real rows the fence machine can resolve',
      expected: `placeAt() resolves both the shop and "${supplyName}"`,
      act: async (p) => {
        await p.evaluate(({ SHOP, SUPPLY, supplyName }) => {
          S.officeLat = SHOP.lat; S.officeLon = SHOP.lon;
          savePlace({ name: supplyName, kind: 'supply', lat: SUPPLY.lat, lon: SUPPLY.lon, confirmedBy: 'manual' });
          // Nothing else may be inside these fences, or the machine would resolve
          // the wrong place and the assertions below would be meaningless.
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
          _geoCurrentJob = null; _geoArrivedAt = null;
          _geoWasInShop = false; _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          saveAll();
        }, { SHOP, SUPPLY, supplyName });
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
        const out = await p.evaluate(({ SUPPLY, supplyName }) => {
          const pl = placeAt({ lat: SUPPLY.lat, lon: SUPPLY.lon });
          return { resolved: !!pl && pl.name === supplyName };
        }, { SUPPLY, supplyName });
        return { ok: out.resolved, got: JSON.stringify(out) };
      },
    });

    // ── 2. THE bug: shop -> supply -> shop used to log nothing ─────────────
    await step(page, {
      label: 'drive shop → supply house → shop', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js known-place fence + _geoDriveEntry(destPlace)',
      ruleText: 'a supply run that returns to the shop is a real deductible trip and must log miles',
      expected: 'a drive entry exists naming the supply house as its destination',
      act: async (p) => {
        // At the shop.
        await ping(p, SHOP.lat, SHOP.lon);
        await p.waitForTimeout(300);
        // Pull away: this opens the drive leg.
        await ping(p, AWAY.lat, AWAY.lon);
        await p.waitForTimeout(300);
        // Back-date the leg so it clears the 2-minute floor that suppresses
        // phantom entries; without this a real 20-minute drive would be
        // indistinguishable from a GPS twitch in a test that runs in seconds.
        await p.evaluate(() => { _geoDriveStartedAt = new Date(Date.now() - 18 * 60000).toISOString(); });
        // Arrive at the supply house: this is the moment that used to be missed.
        await ping(p, SUPPLY.lat, SUPPLY.lon);
        await p.waitForTimeout(1500);
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(async ({ supplyName }) => {
          const uid = _supaUser && _supaUser.id;
          const since = new Date(Date.now() - 60 * 60000).toISOString();
          const { data, error } = await _supa.from('job_time_entries')
            .select('minutes,source,dest_place,arrived_at')
            .eq('contractor_user_id', uid).gte('arrived_at', since);
          if (error) return { err: error.message };
          const leg = (data || []).find(r => r.dest_place === supplyName);
          return { rows: (data || []).length, leg: leg || null };
        }, { supplyName });
        // dest_place ships in a migration now, so a missing column is a real
        // failure rather than a silent green that asserted nothing.
        const ok = !out.err && !!out.leg && /^drive/.test(out.leg.source) && out.leg.minutes >= 2;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 3. Parked time is not drive time ───────────────────────────────────
    await step(page, {
      label: 'the truck sits in the supply lot', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js known-place fence closing the drive leg on arrival',
      ruleText: 'minutes spent parked at a known place must not accrue as driving',
      expected: 'the drive clock is closed while inside the place fence',
      act: async (p) => {
        // Two more pings from the same lot: the truck has not moved.
        await ping(p, SUPPLY.lat + 0.00005, SUPPLY.lon);
        await p.waitForTimeout(250);
        await ping(p, SUPPLY.lat, SUPPLY.lon + 0.00005);
        await p.waitForTimeout(250);
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          driveOpen: !!_geoDriveStartedAt,
          insidePlace: _geoCurrentPlace != null,
        }));
        // An open drive clock here is precisely the bug: every parked minute
        // would land on the next job's leg.
        const ok = out.insidePlace && !out.driveOpen;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 4. Leaving opens a NEW leg, so the return trip is its own trip ─────
    await step(page, {
      label: 'pull out of the lot', page: 'geo', role: 'contractor',
      suspect: 'geo-track.js known-place fence starting a fresh leg on departure',
      ruleText: 'leaving a known place must begin a new drive leg, or the return trip is invisible',
      expected: 'a drive leg is open again after departing',
      act: async (p) => {
        await ping(p, AWAY.lat, AWAY.lon);
        await p.waitForTimeout(400);
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          driveOpen: !!_geoDriveStartedAt,
          leftPlace: _geoCurrentPlace == null,
        }));
        return { ok: out.driveOpen && out.leftPlace, got: JSON.stringify(out) };
      },
    });

    // ── 5. The commute guard: home is never offered ────────────────────────
    await step(page, {
      label: 'an overnight stop is never offered as a place', page: 'geo', role: 'contractor',
      suspect: 'places.js _placeIsLikelyHome',
      ruleText: 'home must never become a place: accepting it would log non-deductible commute miles as business trips',
      expected: 'a 9-hour dwell, repeated, produces zero suggestions',
      act: async (p) => {
        // BASE_LAT/BASE_LON are NODE-side constants; the evaluate callback runs
        // in the BROWSER, so they have to be passed in rather than closed over.
        await p.evaluate(({ BASE_LAT, BASE_LON }) => {
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          const home = { lat: BASE_LAT + 0.20, lon: BASE_LON - 0.20 }, overnight = 9 * 60 * 60 * 1000;
          recordUnknownStop(home, overnight);
          recordUnknownStop(home, overnight);
          recordUnknownStop(home, overnight);
        }, { BASE_LAT, BASE_LON });
        // ZERO. A GPS ping is not an interaction: the contractor did not tap,
        // clock in, clock out, or classify a single minute of this. The ledger
        // measures what the PERSON spends, so simulated pings must not be
        // counted as friction, and the budget below is 0 on purpose: if anyone
        // ever adds a tap to the automatic path, this flow goes over budget and
        // CI says so.
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(({ BASE_LAT, BASE_LON }) => {
          const n = pendingPlaceSuggestions().length;
          // And a genuine work stop of the same repetition IS still offered, so
          // the guard is narrow rather than switching detection off wholesale.
          const yard = { lat: BASE_LAT + 0.30, lon: BASE_LON - 0.30 }, normal = 6 * 60 * 1000;
          recordUnknownStop(yard, normal);
          recordUnknownStop(yard, normal);
          recordUnknownStop(yard, normal);
          return { afterHome: n, afterYard: pendingPlaceSuggestions().length };
        }, { BASE_LAT, BASE_LON });
        return { ok: out.afterHome === 0 && out.afterYard === 1, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
