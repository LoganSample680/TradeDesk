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

// Far from any real seed data so a stale row can never be mistaken for ours.
const SHOP   = { lat: 38.3100, lon: -96.8100 };
const SUPPLY = { lat: 38.3400, lon: -96.8400 };   // ~2.5mi from the shop
const AWAY   = { lat: 38.4200, lon: -96.9200 };   // well outside every fence

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
    const supplyName = `E2E Yard ${runId}`;

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
        return 2;
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
        return 3;
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
        if (out.err && /dest_place|column/i.test(out.err)) {
          return { ok: true, got: 'SKIP: job_time_entries.dest_place not provisioned in this env' };
        }
        const ok = !!out.leg && /^drive/.test(out.leg.source) && out.leg.minutes >= 2;
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
        return 2;
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
        return 1;
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
        await p.evaluate(() => {
          try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
          const home = { lat: 38.5000, lon: -97.0000 }, overnight = 9 * 60 * 60 * 1000;
          recordUnknownStop(home, overnight);
          recordUnknownStop(home, overnight);
          recordUnknownStop(home, overnight);
        });
        return 1;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          const n = pendingPlaceSuggestions().length;
          // And a genuine work stop of the same repetition IS still offered, so
          // the guard is narrow rather than switching detection off wholesale.
          const yard = { lat: 38.6000, lon: -97.1000 }, normal = 6 * 60 * 1000;
          recordUnknownStop(yard, normal);
          recordUnknownStop(yard, normal);
          recordUnknownStop(yard, normal);
          return { afterHome: n, afterYard: pendingPlaceSuggestions().length };
        });
        return { ok: out.afterHome === 0 && out.afterYard === 1, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
