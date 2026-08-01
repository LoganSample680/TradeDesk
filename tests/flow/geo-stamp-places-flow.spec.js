// REAL flow: a geo-stamped receipt becomes a supply house, and that supply house
// survives a sign-out / sign-in.
//
// Why offline shards structurally cannot close this gap: they mock
// _supa.from(...).upsert()/.select() wholesale, so they prove the in-memory
// shape and NOTHING about whether the row leaves the device. td_places is a
// brand-new synced table, and the exact lesson of the vehicle disaster earlier
// on this branch was a table that looked perfect under mocks and did not survive
// a real round trip. So this drives real Postgres, real RLS, and a real re-auth.
//
// Chain covered:
//   contractor logs a real expense carrying coordinates
//     -> the expense row lands in td_expenses WITH lat/lon/geoAcc/geoAt
//     -> detectPlacesFromExpenses promotes it to a named td_places row
//     -> that row lands in td_places under real RLS (verified by re-query)
//     -> a settings save is forced, the race that used to swallow the fleet
//     -> sign out (wipes local state) and back in (repaints from cloud)
//     -> the place is still there, with its name, kind and provenance
//     -> and the map's feed still contains it
//
// Also asserted, because they are the guards that stop the app inflating a
// deduction on the contractor's behalf and they must hold against the REAL
// engine, not just a unit stub:
//   • a receipt stamped on a different day than it is dated (paperwork on the
//     sofa) never becomes a place
//   • a loose fix never becomes a place
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'places/receipt-becomes-supply-house';

test.describe('Places: a geo-stamped receipt becomes a supply house that survives re-auth', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a stamped receipt creates a place, and the place survives sign-out and sign-in', async ({ page }) => {
    // Two real auth round-trips plus a full cloud load on an account carrying
    // years of accumulated seed data (§12.7 — live tests never clean up).
    test.setTimeout(240000);

    // td_places ships with this PR; migrations only reach the Dev project on
    // merge to main (deploy-functions.yml), so on an unmerged branch the table
    // is legitimately absent. Soft-skip rather than fail — same pattern as the
    // td_vehicles probe. ANY error counts as unreachable (PostgREST reports a
    // schema-cache miss as PGRST205 in error.code, not in error.message).
    const tableReady = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('td_places').select('id').limit(1);
        return !error;
      } catch (e) { return false; }
    });
    test.skip(!tableReady, 'td_places not migrated to Dev yet (merges with this PR)');

    const runId = String(process.pid).slice(-6).padStart(6, '0');
    const vendor = `E2E Supply ${runId}`;
    // A distinctive coordinate far from any real seed data, so a stale row from
    // a previous run can never be mistaken for this one's.
    const LAT = 38.0 + (Number(runId.slice(-3)) / 100000);
    const LON = -96.5 - (Number(runId.slice(-3)) / 100000);
    let expId = null;

    // ── 1. Log a real expense carrying coordinates ─────────────────────────
    await step(page, {
      label: 'contractor logs a receipt with coordinates', page: 'pg-tracker', role: 'contractor',
      suspect: 'geo-track.js _stampGeo + the td_expenses sync fabric',
      ruleText: 'a geo-stamped expense must carry its coordinates all the way into Postgres, not just into memory',
      expected: `td_expenses row for ${vendor} has lat/lon/geoAcc/geoAt`,
      act: async (p) => {
        await p.evaluate(({ vendor, LAT, LON }) => {
          const id = Date.now() * 1000 + 11;
          window.__e2eExpId = id;
          expenses.unshift({
            id, date: todayKey(), loggedAt: new Date().toISOString(),
            cat: 'materials', catLabel: 'Materials', vendor,
            amount: 212.44, deductible: true, notes: 'E2E place-detection probe',
            created_at: new Date().toISOString(),
            // Exactly what _stampGeo writes: a tight, same-day fix.
            lat: LAT, lon: LON, geoAcc: 11, geoAt: new Date().toISOString(),
          });
          saveAll();
        }, { vendor, LAT, LON });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        expId = await p.evaluate(() => window.__e2eExpId);
        return 1;
      },
      rule: async (p) => {
        let row = null;
        for (let i = 0; i < 6; i++) {
          const rows = await cloudRows(p, 'td_expenses');
          row = (rows || []).find(r => r.vendor === vendor);
          if (row && row.lat != null) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        const ok = !!row && Math.abs(row.lat - LAT) < 1e-5 && Math.abs(row.lon - LON) < 1e-5
                   && row.geoAcc === 11 && !!row.geoAt;
        return { ok, got: JSON.stringify(row && { lat: row.lat, lon: row.lon, geoAcc: row.geoAcc, geoAt: row.geoAt }) };
      },
    });

    // ── 2. The receipt promotes itself into a named supply house ───────────
    await step(page, {
      label: 'the receipt becomes a supply house', page: 'pg-team', role: 'contractor',
      suspect: 'places.js detectPlacesFromExpenses + the td_places sync fabric',
      ruleText: 'a contemporaneous, tight-fix receipt must create a real td_places row named after the vendor',
      expected: `td_places has a row named "${vendor}" with confirmedBy=expense`,
      act: async (p) => {
        await p.evaluate(() => { detectPlacesFromExpenses(); saveAll(); });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 1;
      },
      rule: async (p) => {
        let row = null;
        for (let i = 0; i < 6; i++) {
          const rows = await cloudRows(p, 'td_places');
          row = (rows || []).find(r => r.name === vendor);
          if (row) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        const ok = !!row && row.kind === 'supply' && row.confirmedBy === 'expense';
        return { ok, got: JSON.stringify(row) };
      },
    });

    // ── 3. The deduction guards hold against the REAL engine ───────────────
    await step(page, {
      label: 'sofa paperwork and loose fixes create nothing', page: 'pg-tracker', role: 'contractor',
      suspect: 'places.js _placeFromExpense guards (contemporaneous + accuracy)',
      ruleText: 'a receipt entered days later, or with a useless fix, must never become a place',
      expected: 'neither probe creates a td_places row',
      act: async (p) => {
        await p.evaluate(() => {
          const base = Date.now() * 1000;
          // Dated days ago, stamped tonight: the coordinate is the living room.
          expenses.unshift({
            id: base + 21, date: '2026-01-05', loggedAt: new Date().toISOString(),
            cat: 'materials', catLabel: 'Materials', vendor: 'E2E Sofa Paperwork',
            amount: 40, deductible: true, notes: 'E2E sofa probe', created_at: new Date().toISOString(),
            lat: 39.111111, lon: -95.111111, geoAcc: 8, geoAt: new Date().toISOString(),
          });
          // Tight date, useless fix: a 3km wifi triangulation.
          expenses.unshift({
            id: base + 22, date: todayKey(), loggedAt: new Date().toISOString(),
            cat: 'materials', catLabel: 'Materials', vendor: 'E2E Loose Fix',
            amount: 40, deductible: true, notes: 'E2E loose probe', created_at: new Date().toISOString(),
            lat: 39.222222, lon: -95.222222, geoAcc: 3000, geoAt: new Date().toISOString(),
          });
          detectPlacesFromExpenses();
          saveAll();
        });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 1;
      },
      rule: async (p) => {
        const rows = await cloudRows(p, 'td_places');
        const sofa = (rows || []).find(r => r.name === 'E2E Sofa Paperwork');
        const loose = (rows || []).find(r => r.name === 'E2E Loose Fix');
        // Either one becoming a place would silently corrupt every drive leg
        // that later matches it, and inflate a deduction.
        return { ok: !sofa && !loose, got: `sofa=${!!sofa} loose=${!!loose}` };
      },
    });

    // ── 4. Force the settings race that used to swallow the fleet ──────────
    await step(page, {
      label: 'a settings save races the places write', page: 'pg-settings', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud skip-settings gate',
      ruleText: 'a settings write must not be able to revert or drop a place',
      expected: 'the place row is still present in td_places after a settings flush',
      act: async (p) => {
        await p.evaluate(() => { S.settingsTs = Date.now(); saveAll(); });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 1;
      },
      rule: async (p) => {
        const rows = await cloudRows(p, 'td_places');
        const row = (rows || []).find(r => r.name === vendor);
        return { ok: !!row, got: row ? 'still present' : 'GONE after settings save' };
      },
    });

    // ── 5. The reported failure mode: sign out, sign back in ───────────────
    await step(page, {
      label: 'sign out and back in', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud + the td_places _TD_TABLES entry',
      ruleText: 'a brand-new synced table must survive a full sign-out/sign-in cycle (this is what td_vehicles failed)',
      expected: `after re-auth, "${vendor}" is still a place and still in the map feed`,
      act: async (p) => {
        await p.evaluate(async () => { try { await _supa.auth.signOut(); } catch (e) {} });
        // Hard reload so nothing survives in memory, which is what the owner does.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await signIn(p);
        return 2;
      },
      rule: async (p) => {
        let out = null;
        for (let i = 0; i < 8; i++) {
          out = await p.evaluate((vendor) => {
            const pl = (typeof getPlaces === 'function' ? getPlaces() : []).find(x => x.name === vendor);
            if (!pl) return null;
            const feed = (typeof geoFeed === 'function') ? geoFeed({ types: ['place'] }) : [];
            return {
              name: pl.name, kind: pl.kind, confirmedBy: pl.confirmedBy,
              inFeed: feed.some(f => f.label === vendor),
              resolves: !!(typeof placeAt === 'function' && placeAt({ lat: pl.lat, lon: pl.lon })),
            };
          }, vendor);
          if (out && out.inFeed) break;
          await new Promise(r => setTimeout(r, 2000));
        }
        const ok = !!out && out.kind === 'supply' && out.inFeed && out.resolves;
        return { ok, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
