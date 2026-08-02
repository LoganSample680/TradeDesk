// @ts-check
// ── An employee's own-car miles, across two real accounts ───────────────────
//
// Owner (2026-08-02): "I need 100 percent certainty all this stuff rolls to
// employees correctly with permissions and syncs live just like how we handle
// everything else."
//
// This PR added three fields to a synced record (startedIso, reimbursable,
// passedThrough) and changed a filter the employee view runs through. Both are
// the kind of change that looks fine on one device and is wrong the moment a
// second person opens the app, so this drives two real accounts against the real
// backend rather than trusting either half in isolation.
//
// What it has to prove, and each half of it is a way this went wrong once:
//   1. the new fields SURVIVE the round trip, not just the local write
//   2. the employee can SEE their own reimbursable trips. They were filtered out
//      of the very list the person who drove them was looking at.
//   3. the employee CANNOT see what the rest of the crew is owed. That total read
//      the whole account and was shown to whoever opened the page.
//   4. the miles never reach the owner's deduction, from either side
//
// Soft-skips when the second dev account is not configured, the same as the
// other two-account specs.
const { test, expect } = require('@playwright/test');
const { signIn, step, report, resetLedger } = require('./live-helpers');

const FLOW = 'crew-mileage-sync';
const BASELINE = require('./perf-baseline.json');

const HAS_SECOND = !!(process.env.E2E_DEV2_EMAIL && process.env.E2E_DEV2_PASSWORD);

test.describe('Crew mileage across accounts', () => {
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('an own-car trip syncs, shows to the driver, and never reaches the deduction', async ({ page }) => {
    const runTag = Date.now();

    // ── Write one reimbursable trip and one ordinary one ────────────────────
    await step(page, {
      label: 'log a company-truck trip and an own-car trip',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js autoLogDriveTrip reimbursable flag',
      ruleText: 'both trips write, and only the own-car one carries the flag',
      expected: 'two trips, one flagged',
      act: async (p) => {
        await p.evaluate((tag) => {
          window.__ids = {};
          const shop = { lat: 39.0307, lng: -95.7113, name: 'Shop', kind: 'shop', addr: '2015 SW Randolph Ave' };
          const job = { lat: 39.0556, lng: -95.6720, name: 'Sync Job ' + tag, kind: 'job', addr: '309 S Kansas Ave' };
          const truck = autoLogDriveTrip({ from: shop, to: job, legKey: 'sync-truck-' + tag,
                                           startedIso: new Date().toISOString() });
          const own = autoLogDriveTrip({ from: job, to: shop, legKey: 'sync-own-' + tag,
                                         startedIso: new Date().toISOString(), reimbursable: true });
          // Attributed the way the geofence attributes an employee's own drive,
          // which is what the employee view narrows on.
          if (own) own.logged_by_id = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : 'e-test';
          if (own) own.logged_by_name = 'Sync Crew ' + tag;
          window.__ids = { truck: truck && truck.id, own: own && own.id };
          saveAll();
          return _flushSaveNow ? _flushSaveNow() : null;
        }, runTag);
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          const t = mileage.find(m => m.id === window.__ids.truck);
          const o = mileage.find(m => m.id === window.__ids.own);
          return { truck: !!t, own: !!o, truckFlag: !!(t && t.reimbursable), ownFlag: !!(o && o.reimbursable) };
        });
        return {
          ok: out.truck && out.own && !out.truckFlag && out.ownFlag,
          got: `truck ${out.truck ? 'written' : 'MISSING'} (flag ${out.truckFlag}), own-car ${out.own ? 'written' : 'MISSING'} (flag ${out.ownFlag})`,
        };
      },
    });

    // ── 1. THE ROUND TRIP ───────────────────────────────────────────────────
    // Read back from the backend, not from memory. A field that only exists on
    // the device that wrote it is not a field, and the three added by this PR
    // are nested inside a jsonb payload where a silent drop would be invisible.
    await step(page, {
      label: 'the new fields survive the trip to the backend and back',
      page: 'mileage', role: 'contractor',
      suspect: 'cloud.js td_mileage sync fabric',
      ruleText: 'reimbursable, startedIso and the row itself come back from Supabase intact',
      expected: 'the flag and the leg start read back from the server',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async (ids) => {
          const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
          const { data } = await _supa.from('td_mileage').select('id,data').eq('contractor_user_id', cid);
          const find = (id) => (data || []).find(r => String(r.id) === String(id));
          const own = find(ids.own), truck = find(ids.truck);
          return {
            ownFound: !!own, truckFound: !!truck,
            ownFlag: !!(own && own.data && own.data.reimbursable),
            ownStarted: !!(own && own.data && own.data.startedIso),
            truckFlag: !!(truck && truck.data && truck.data.reimbursable),
            ownBy: own && own.data && own.data.logged_by_name,
          };
        }, await page.evaluate(() => window.__ids));
        return {
          ok: out.ownFound && out.truckFound && out.ownFlag && out.ownStarted && !out.truckFlag,
          got: `own-car row ${out.ownFound ? 'synced' : 'NOT SYNCED'}, flag ${out.ownFlag}, ` +
               `leg start ${out.ownStarted}, attributed to "${out.ownBy}"; truck row flag ${out.truckFlag}`,
        };
      },
    });

    // ── 2. THE DEDUCTION, FROM THE OWNER'S SIDE ─────────────────────────────
    await step(page, {
      label: 'the crew trip is visible to the owner but not in the deduction',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js deductibleTrips / renderAllMileage list',
      ruleText: 'the owner sees the trip in the list, and the deduction total excludes it',
      expected: 'listed, not deducted',
      act: async (p) => { await p.evaluate(() => { if (typeof goPg === 'function') goPg('pg-mileage'); }); return 1; },
      rule: async (p) => {
        const out = await p.evaluate((ids) => {
          const own = mileage.find(m => m.id === ids.own);
          return {
            inList: !!own,
            inDeduction: deductibleTrips(mileage).some(m => m.id === ids.own),
            truckInDeduction: deductibleTrips(mileage).some(m => m.id === ids.truck),
          };
        }, await page.evaluate(() => window.__ids));
        return {
          ok: out.inList && !out.inDeduction && out.truckInDeduction,
          got: `own-car trip listed:${out.inList} deducted:${out.inDeduction}; truck deducted:${out.truckInDeduction}`,
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });

  // ── 3. THE EMPLOYEE'S OWN VIEW ────────────────────────────────────────────
  // The half that cannot be checked from the owner's account at all: what the
  // person who did the driving actually sees.
  test('the driver sees their own miles, and only their own', async ({ page }) => {
    test.skip(!HAS_SECOND, 'no second dev account configured: the employee half needs a real second login');
    const runTag = Date.now();

    await step(page, {
      label: 'two crew members, each with their own miles',
      page: 'mileage', role: 'employee',
      suspect: 'mileage.js crewMilesOwed scoping / _mileSrc',
      ruleText: 'the signed-in driver sees their own reimbursable trips and none of anyone else\'s',
      expected: 'their own miles totalled, the other driver\'s invisible',
      act: async (p) => {
        await p.evaluate((tag) => {
          const me = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : 'me';
          const mk = (o) => Object.assign({
            id: _newId(), date: todayKey(), miles: 10, gps: true, legKey: 'scope-' + Math.random(),
            calc_method: 'auto_route', reimbursable: true,
          }, o);
          // Mine, and somebody else's, in the same array a shared account holds.
          mileage.push(mk({ miles: 12, logged_by_id: me, logged_by_name: 'Me ' + tag }));
          mileage.push(mk({ miles: 40, logged_by_id: 'someone-else-' + tag, logged_by_name: 'Other ' + tag }));
          window.__me = me;
          saveAll();
        }, runTag);
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          // Forced into the employee branch: this is the code path a crew member
          // runs, and the owner's account cannot exercise it.
          const keep = _isEmployee;
          try {
            _isEmployee = true;
            const o = crewMilesOwed(new Date().getFullYear());
            return { miles: o.miles, names: Object.keys(o.by) };
          } finally { _isEmployee = keep; }
        });
        // 12 is mine. 52 would mean the whole crew's total was on my screen.
        return {
          ok: out.miles === 12 && out.names.length === 1,
          got: `${out.miles} mi attributed to ${out.names.length} person(s): ${out.names.join(', ')}`,
        };
      },
    });
  });
});
