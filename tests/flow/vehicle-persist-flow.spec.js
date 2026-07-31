// REAL flow: a vehicle and its odometer reading survive a sign-out / sign-in.
//
// This is the owner-reported bug, driven end to end against live Supabase:
// "Zach's vehicles don't save — when I sign in they go away, and his vehicle
// still isn't persisting its name or its current-year mileage."
//
// Why offline shards structurally cannot close this gap: they mock
// _supa.from(...).upsert()/.select() wholesale, so they prove the in-memory
// shape and nothing about whether the row actually LEAVES the device. The bug
// was precisely that it didn't — the fleet lived in the zj_data.settings blob,
// and supaSaveToCloud SKIPS the entire settings write when the cloud copy has a
// newer settingsTs ('skip-settings'). A mocked save can never reproduce a
// server-side timestamp race. Only a real round-trip through real Postgres +
// RLS, followed by a real re-auth that repaints from the cloud, proves the fix.
//
// Chain covered:
//   contractor adds a vehicle through the real Fleet modal (real taps)
//     -> saves a current-year odometer reading against it
//     -> the row lands in td_vehicles under real RLS (verified by re-query)
//     -> a settings save is forced afterwards, the exact race that used to
//        swallow the fleet
//     -> sign out (wipes local state) and sign back in (repaints from cloud)
//     -> the vehicle, its NAME, and its current-year reading are all still there
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, scrollBy, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'fleet/vehicle-survives-resignin';

// Fleet & Team is NOT a primary nav item on mobile. The bottom bar is
// Home/Leads/Clients/Jobs/More, so a phone reaches it via More -> "Fleet & Team"
// (#mtb-more then #mmi-team); only the desktop sidebar has #nb-team. Tapping
// #nb-team on a phone waits 10s on an element that is present but zero-size and
// buried under the fixed #mobile-topbar — which is exactly how the first two
// real runs of this flow died, before touching any vehicle logic.
async function gotoTeam(p) {
  let n = 0;
  n += await scrollBy(p, -8000); // clear the fixed topbar before any tap
  const onMobile = await p.evaluate(() => (document.getElementById('mtb-more')?.offsetWidth || 0) > 0);
  if (onMobile) {
    n += await tap(p, '#mtb-more');
    await p.waitForSelector('#mmi-team', { state: 'visible', timeout: 8000 });
    n += await tap(p, '#mmi-team');
  } else {
    n += await tap(p, '#nb-team');
  }
  await p.waitForSelector('#pg-team.active', { state: 'attached', timeout: 8000 });
  return n;
}


test.describe('Fleet persistence: a vehicle + its odometer survive a real re-sign-in', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a vehicle and its current-year odometer reading survive sign-out and sign-in', async ({ page }) => {
    // Two real auth round-trips plus a full cloud load on an account carrying
    // years of accumulated seed data (§12.7 — live tests never clean up).
    test.setTimeout(240000);

    // td_vehicles ships with this PR; migrations only reach the Dev project on
    // merge to main (deploy-functions.yml), so on an unmerged branch the table
    // is legitimately absent. Soft-skip rather than fail — same pattern as the
    // qr_sources probe in qr-lead-tracking-flow.spec.js. ANY error counts as
    // unreachable (PostgREST reports a schema-cache miss as PGRST205 in
    // error.code, not error.message, so matching on a message shape misses it).
    const tableReady = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('td_vehicles').select('id').limit(1);
        return !error;
      } catch (e) { return false; }
    });
    test.skip(!tableReady, 'td_vehicles not migrated to Dev yet (merges with this PR)');

    const runId = String(process.pid).slice(-6).padStart(6, '0');
    const vehName = `E2E Truck ${runId}`;
    const year = new Date().getFullYear();
    // A distinctive reading so a stale row from a previous run can never be
    // mistaken for this one's.
    const startOdo = 480000 + Number(runId.slice(-3));
    let vehId = null;

    // ── 1. Add a vehicle through the real Fleet UI ──────────────────────────
    await step(page, {
      label: 'contractor adds a vehicle', page: 'pg-team', role: 'contractor',
      suspect: 'fleet.js saveFleetVehicle + settings.js _setVehicles',
      ruleText: 'adding a vehicle must insert a real td_vehicles row for this account',
      expected: `td_vehicles has a row named "${vehName}"`,
      act: async (p) => {
        let n = 0;
        n += await gotoTeam(p);
        n += await tap(p, '#ft-t-fleet');
        await p.evaluate(() => openAddVehicleModal());
        await p.waitForSelector('#fv-name', { state: 'visible', timeout: 8000 });
        n += await type(p, '#fv-name', vehName);
        await p.evaluate(() => saveFleetVehicle());
        return n;
      },
      rule: async (p) => {
        let row = null;
        for (let i = 0; i < 6; i++) {
          const rows = await cloudRows(p, 'td_vehicles');
          row = (rows || []).find(r => r.name === vehName);
          if (row) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        if (row) vehId = row.id;
        return { ok: !!row, got: JSON.stringify(row) };
      },
    });

    // ── 2. Save a current-year odometer reading against it ─────────────────
    await step(page, {
      label: 'contractor records this year\'s odometer', page: 'pg-team', role: 'contractor',
      suspect: 'settings.js _setVehOdo (readings live on the vehicle row)',
      ruleText: 'the reading must persist on the vehicle\'s OWN td_vehicles row, not a settings blob',
      expected: `td_vehicles row ${vehName} has odo.${year}.start = ${startOdo}`,
      act: async (p) => {
        await p.evaluate(({ vehName, year, startOdo }) => {
          const v = getVehicles().find(x => x.name === vehName);
          _setVehOdo(v, year, { start: startOdo, startDate: todayKey() });
          saveAll();
        }, { vehName, year, startOdo });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 1;
      },
      rule: async (p) => {
        let rec = null;
        for (let i = 0; i < 6; i++) {
          const rows = await cloudRows(p, 'td_vehicles');
          const row = (rows || []).find(r => r.name === vehName);
          rec = row && row.odo && row.odo[String(year)];
          if (rec && rec.start === startOdo) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        return { ok: !!rec && rec.start === startOdo, got: JSON.stringify(rec) };
      },
    });

    // ── 2b. Rename it, and prove the money follows ─────────────────────────
    // Service records, vehicle expenses and mileage trips all link to a vehicle
    // by NAME. Nothing re-pointed them on rename, and _vehSchedC EXCLUDES any
    // vehicle expense it cannot bucket, so a rename silently stopped those costs
    // deducting on Schedule C. Asserted here against a real expense row.
    const renamedTo = `${vehName} XLT`;
    const fuelCost = 400;
    await step(page, {
      label: 'contractor renames the vehicle', page: 'pg-team', role: 'contractor',
      suspect: 'fleet.js saveFleetVehicle re-stamp of vehicleName/vehicle links',
      ruleText: 'a rename must carry the vehicle\'s expenses with it, not orphan them out of the deduction',
      expected: `after rename, the $${fuelCost} fuel expense still attributes to the vehicle (untagged = 0)`,
      act: async (p) => {
        // A real vehicle-tagged fuel expense for this truck, this year.
        await p.evaluate(({ vehName, fuelCost }) => {
          expenses.unshift({
            id: Date.now(), date: todayKey(), loggedAt: new Date().toISOString(),
            cat: 'fuel', catLabel: 'Fuel', vendor: 'E2E Fuel Stop',
            vehicleName: vehName, amount: fuelCost, deductible: true,
            notes: 'E2E rename-attribution probe', created_at: new Date().toISOString(),
          });
          saveAll();
        }, { vehName, fuelCost });
        let n = 0;
        n += await gotoTeam(p);
        await p.evaluate(() => { setFleetTab('fleet'); });
        const idx = await p.evaluate((vehName) =>
          getVehicles().findIndex(v => v.name === vehName), vehName);
        await p.evaluate((i) => openAddVehicleModal(i), idx);
        await p.waitForSelector('#fv-name', { state: 'visible', timeout: 8000 });
        n += await type(p, '#fv-name', ' XLT');
        await p.evaluate(() => saveFleetVehicle());
        return n;
      },
      rule: async (p) => {
        const out = await p.evaluate(({ renamedTo, fuelCost }) => {
          const yr = String(new Date().getFullYear());
          const sched = _vehSchedC(yr);
          const v = getVehicles().find(x => x.name === renamedTo);
          const exp = expenses.find(e => e.notes === 'E2E rename-attribution probe');
          return {
            renamed: !!v,
            odoSurvived: v ? (_vehOdo(v, new Date().getFullYear()).start || 0) : 0,
            expRelinked: exp ? exp.vehicleName : null,
            untagged: sched.untagged,
            untaggedTotal: sched.untaggedTotal,
          };
        }, { renamedTo, fuelCost });
        const ok = out.renamed && out.expRelinked === renamedTo &&
                   out.untagged === 0 && out.odoSurvived === startOdo;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 3. Force the exact race that used to swallow the fleet ─────────────
    // A settings save with a FRESH settingsTs. Under the old design the fleet
    // rode inside that blob, so whichever write lost this race lost the truck.
    // Now it is a separate table and the race is simply not reachable.
    await step(page, {
      label: 'a settings save races the fleet write', page: 'pg-settings', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud skip-settings gate',
      ruleText: 'a settings write must not be able to revert or drop the fleet',
      expected: 'the vehicle row is still present in td_vehicles after a settings flush',
      act: async (p) => {
        await p.evaluate(() => { S.settingsTs = Date.now(); saveAll(); });
        await p.evaluate(() => _flushSaveNow && _flushSaveNow());
        return 1;
      },
      rule: async (p) => {
        const rows = await cloudRows(p, 'td_vehicles');
        const row = (rows || []).find(r => r.name === renamedTo);
        return { ok: !!row, got: row ? 'still present' : 'GONE after settings save' };
      },
    });

    // ── 4. The actual reported symptom: sign out, sign back in ─────────────
    await step(page, {
      label: 'sign out and back in', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud + _migrateVehiclesFromSettings',
      ruleText: 'THE reported bug: the fleet must survive a full sign-out/sign-in cycle',
      expected: `after re-auth, "${renamedTo}" is present with odo.${year}.start = ${startOdo}`,
      act: async (p) => {
        await p.evaluate(async () => { try { await _supa.auth.signOut(); } catch (e) {} });
        // Hard reload so nothing survives in memory — this is what the owner
        // does, and it is where the vehicle used to disappear.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await signIn(p);
        return 2;
      },
      rule: async (p) => {
        let out = null;
        for (let i = 0; i < 8; i++) {
          out = await p.evaluate(({ renamedTo, year }) => {
            const v = (typeof getVehicles === 'function' ? getVehicles() : []).find(x => x.name === renamedTo);
            if (!v) return null;
            return { name: v.name, id: String(v.id), start: (_vehOdo(v, year) || {}).start || 0 };
          }, { renamedTo, year });
          if (out && out.start === startOdo) break;
          await new Promise(r => setTimeout(r, 2000));
        }
        return {
          ok: !!out && out.name === renamedTo && out.start === startOdo,
          got: JSON.stringify(out),
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
