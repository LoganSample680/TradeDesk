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
// The employee half signs in as a REAL second account linked as A's crew, the
// shape employee-data-leak.spec.js uses. Forcing _isEmployee=true on the owner's
// own session proves nothing about permissions: the load path, the redaction RPC
// and the team link are the things under test, and none of them run when the
// viewer is the account owner.
//
// Soft-skips when the second dev account is not configured.
const { test, expect } = require('@playwright/test');
const { signIn, step, report, resetLedger, accountPair } = require('./live-helpers');

const FLOW = 'crew-mileage-sync';
const FLOW_EMP = 'crew-mileage-sync/employee-view';
const BASELINE = require('./perf-baseline.json');

// Crew permissions: they log mileage, they see no money. This is the permission
// set the whole question hangs on, mileage:true is what keeps td_mileage out of
// _employeeRedactedTables so the rows reach them at all.
const CREW_PERMS = { collect: false, expenses: true, mileage: true, leads: false, estimate: false,
                     schedule: true, clients: false, financials: false, team: false, payroll: false };

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
        await p.evaluate(async (tag) => {
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
          await _flushSaveNow();
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
    //
    // user_id, not contractor_user_id. The td_* tables key on user_id (cloud.js
    // _upsertTable writes {id,user_id,data,...}); contractor_user_id is the
    // team_members column. The first live run of this spec queried the wrong one
    // and reported BOTH rows unsynced, which read exactly like the sync fabric
    // dropping the new fields.
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
          const { data, error } = await _supa.from('td_mileage').select('id,data')
            .eq('user_id', cid).in('id', [String(ids.truck), String(ids.own)]);
          const find = (id) => (data || []).find(r => String(r.id) === String(id));
          const own = find(ids.own), truck = find(ids.truck);
          return {
            err: error ? (error.code || '') + ' ' + (error.message || '') : null,
            ownFound: !!own, truckFound: !!truck,
            ownFlag: !!(own && own.data && own.data.reimbursable),
            ownStarted: !!(own && own.data && own.data.startedIso),
            truckFlag: !!(truck && truck.data && truck.data.reimbursable),
            ownBy: own && own.data && own.data.logged_by_name,
          };
        }, await page.evaluate(() => window.__ids));
        return {
          ok: out.ownFound && out.truckFound && out.ownFlag && out.ownStarted && !out.truckFlag,
          got: `own-car row ${out.ownFound ? 'synced' : 'NOT SYNCED'}, truck row ${out.truckFound ? 'synced' : 'NOT SYNCED'}, ` +
               `flag ${out.ownFlag}, leg start ${out.ownStarted}, attributed to "${out.ownBy}"; ` +
               `truck row flag ${out.truckFlag}` + (out.err ? ` · query error ${out.err}` : ''),
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

  // ── 3. THE EMPLOYEE'S OWN VIEW, FROM THE EMPLOYEE'S OWN ACCOUNT ───────────
  // The half that cannot be checked from the owner's account at all: the RPC
  // never redacts the owner, and _isEmployee is false, so the entire permission
  // path is dead code on A's session. B is a real second login, linked as A's
  // crew, loading A's account the way a crew member's phone does.
  test('the driver sees their own miles, and only their own', async ({ page }) => {
    const pair = accountPair();
    test.skip(!pair, 'the employee half needs a real second login (E2E_DEV2_* or a local pool of 2+)');
    test.setTimeout(150000);
    const [A, B] = pair;
    const runTag = Date.now();

    // Sign in as a specific account in-page, then wait for the app to hydrate
    // that identity. Same shape as employee-data-leak.spec.js authAs.
    const authAs = async (acct) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _supa !== 'undefined' && !!_supa, { timeout: 30000 });
      const res = await page.evaluate(async ({ email, password }) => {
        try { await _supa.auth.signOut(); } catch (_e) {}
        for (let i = 0; i < 4; i++) {
          const { error } = await _supa.auth.signInWithPassword({ email, password });
          if (!error) return { ok: true };
          if (error.message && !/network|fetch|timeout|rate/i.test(error.message) && error.status !== 429) return { ok: false, why: error.message };
          await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
        return { ok: false, why: 'sign-in retries exhausted' };
      }, { email: acct.email, password: acct.password });
      if (!res.ok) throw new Error(`auth as ${acct.email} failed: ${res.why}`);
      await page.waitForFunction((uid) => typeof _supaUser !== 'undefined' && _supaUser && (!uid || _supaUser.id === uid), acct.uid, { timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    };

    // ── A: link B as crew, then log two own-car trips, B's and somebody else's ──
    await authAs(A);
    await step(page, {
      label: 'the owner links a crew member and two drivers log own-car miles',
      page: 'mileage', role: 'contractor',
      suspect: 'team_members link + mileage.js autoLogDriveTrip attribution',
      ruleText: 'both own-car trips persist to the owner account and the crew link is active',
      expected: 'two reimbursable trips synced, B linked with mileage permission',
      act: async (p) => {
        await p.evaluate(async ({ tag, Buid, Bemail, perms }) => {
          const mk = (o) => Object.assign({
            id: _newId(), date: todayKey(), miles: 12, gps: true, legKey: 'scope-' + tag + '-' + Math.random(),
            calc_method: 'auto_route', purpose: 'Job site', vehicle: 'Personal',
            created_at: new Date().toISOString(), startedIso: new Date().toISOString(),
            reimbursable: true,
          }, o);
          // B's own drive, and a second crew member's. Distinctive endpoint names
          // so the rendered list can be read for what is and is not on screen.
          const mine = mk({ miles: 12, logged_by_id: Buid, logged_by_name: 'Crew B ' + tag,
                            from_name: 'MyLeg ' + tag, to_name: 'MyLegEnd ' + tag });
          const other = mk({ miles: 40, logged_by_id: 'someone-else-' + tag, logged_by_name: 'Other ' + tag,
                             from_name: 'OtherLeg ' + tag, to_name: 'OtherLegEnd ' + tag });
          mileage.push(mine); mileage.push(other);
          window.__ids = { mine: mine.id, other: other.id };
          saveAll();
          await _flushSaveNow();
          await _supa.from('team_members').delete().eq('contractor_user_id', _supaUser.id).eq('employee_user_id', Buid);
          const { error } = await _supa.from('team_members').insert({
            contractor_user_id: _supaUser.id, employee_user_id: Buid, email: Bemail,
            name: 'Crew B ' + tag, role: 'tech', permissions: perms, active: true,
          });
          window.__linkErr = error ? ((error.code || '?') + ': ' + (error.message || String(error))) : null;
        }, { tag: runTag, Buid: B.uid, Bemail: B.email, perms: CREW_PERMS });
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(async ({ ids, Buid }) => {
          const { data } = await _supa.from('td_mileage').select('id,data')
            .eq('user_id', _supaUser.id).in('id', [String(ids.mine), String(ids.other)]);
          const { data: tm } = await _supa.from('team_members').select('id,permissions')
            .eq('contractor_user_id', _supaUser.id).eq('employee_user_id', Buid).eq('active', true).limit(1);
          return {
            synced: (data || []).length,
            linked: !!(tm && tm.length),
            milePerm: !!(tm && tm[0] && tm[0].permissions && tm[0].permissions.mileage),
            err: window.__linkErr,
          };
        }, { ids: await page.evaluate(() => window.__ids), Buid: B.uid });
        return {
          ok: out.synced === 2 && out.linked && out.milePerm,
          got: `${out.synced}/2 trips synced, crew link ${out.linked ? 'active' : 'MISSING'}, mileage permission ${out.milePerm}` +
               (out.err ? ` · link error ${out.err}` : ''),
        };
      },
    });

    const ids = await page.evaluate(() => window.__ids);

    // ── B: sign in for real and open the mileage page ────────────────────────
    await authAs(B);
    await step(page, {
      label: 'the crew member signs in and loads the owner account',
      page: 'mileage', role: 'employee',
      suspect: 'cloud.js employee sign-in path + load_account_data redaction',
      ruleText: 'a linked crew member loads the contractor account as an employee and their own trip comes down with it',
      expected: 'employee session on the owner account, own trip present',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async ({ ids, Auid }) => {
          for (let i = 0; i < 60 && !(typeof _supaCloudLoaded !== 'undefined' && _supaCloudLoaded); i++) {
            await new Promise(r => setTimeout(r, 200));
          }
          const mine = mileage.find(m => String(m.id) === String(ids.mine));
          return {
            isEmp: typeof _isEmployee !== 'undefined' && !!_isEmployee,
            onOwner: (typeof _contractorUserId !== 'undefined' && _contractorUserId) === Auid,
            mineDown: !!mine,
            // The fields this PR added, read on a DIFFERENT device than wrote them.
            flag: !!(mine && mine.reimbursable),
            started: !!(mine && mine.startedIso),
            rows: mileage.length,
          };
        }, { ids, Auid: A.uid });
        return {
          ok: out.isEmp && out.onOwner && out.mineDown && out.flag && out.started,
          got: `employee session:${out.isEmp} on the owner account:${out.onOwner}, ` +
               `own trip down:${out.mineDown} (flag ${out.flag}, leg start ${out.started}), ${out.rows} rows visible`,
        };
      },
    });

    // ── The list: their own trip on screen, the other driver's not ───────────
    await step(page, {
      label: 'the mileage page shows the driver their own trip and not the crew\'s',
      page: 'mileage', role: 'employee',
      suspect: 'mileage.js renderAllMileage _mileSrc scoping',
      ruleText: 'a crew member\'s trip list contains their own reimbursable trip and none of another driver\'s',
      expected: 'MyLeg on screen, OtherLeg absent',
      act: async (p) => {
        await p.evaluate(() => { if (typeof goPg === 'function') goPg('pg-mileage'); });
        await p.waitForTimeout(400);
        return 1;
      },
      rule: async (p) => {
        const out = await p.evaluate((tag) => {
          if (typeof renderAllMileage === 'function') renderAllMileage();
          const html = (document.getElementById('mil-table') || {}).innerHTML || '';
          return { mine: html.includes('MyLeg ' + tag), other: html.includes('OtherLeg ' + tag), len: html.length };
        }, runTag);
        return {
          ok: out.mine && !out.other,
          got: `own trip on screen:${out.mine}, other driver's trip on screen:${out.other} (${out.len} chars rendered)`,
        };
      },
    });

    // ── The money: their own total, never the crew's ─────────────────────────
    // Not an exact total: the dev account is never cleaned up (CLAUDE.md 12.7)
    // so B legitimately carries own-car miles from every previous run. What must
    // hold is that this run's 12 are counted, and that nobody else's name or
    // miles appear at all.
    await step(page, {
      label: 'what the driver is owed is their own miles only',
      page: 'mileage', role: 'employee',
      suspect: 'mileage.js crewMilesOwed scoping',
      ruleText: 'the signed-in driver sees their own reimbursable miles and no part of another driver\'s',
      expected: 'their 12 miles counted, the other driver absent from the breakdown',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate((tag) => {
          const o = crewMilesOwed(new Date().getFullYear());
          return { miles: o.miles, mine: o.by['Crew B ' + tag] || 0, names: Object.keys(o.by) };
        }, runTag);
        const foreign = out.names.filter(n => /^Other /.test(n));
        return {
          ok: out.mine === 12 && !foreign.length,
          got: `this run's miles ${out.mine} (expected 12), ${out.miles} mi total across ${out.names.length} name(s)` +
               (foreign.length ? ` · ANOTHER DRIVER VISIBLE: ${foreign.join(', ')}` : ' · no other driver visible'),
        };
      },
    });

    // ── Back on the owner's side: still out of the deduction ─────────────────
    await authAs(A);
    await step(page, {
      label: 'neither own-car trip reaches the owner\'s deduction',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js deductibleTrips',
      ruleText: 'the owner sees both crew trips in the list and neither one in the deduction',
      expected: 'both listed, neither deducted',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async (ids) => {
          for (let i = 0; i < 60 && !(typeof _supaCloudLoaded !== 'undefined' && _supaCloudLoaded); i++) {
            await new Promise(r => setTimeout(r, 200));
          }
          const has = (id) => mileage.some(m => String(m.id) === String(id));
          const ded = (id) => deductibleTrips(mileage).some(m => String(m.id) === String(id));
          return { listed: has(ids.mine) && has(ids.other), deducted: ded(ids.mine) || ded(ids.other) };
        }, ids);
        return {
          ok: out.listed && !out.deducted,
          got: `both crew trips listed:${out.listed}, either one deducted:${out.deducted}`,
        };
      },
    });

    // NO cleanup (CLAUDE.md 12.7). The crew link and both trips stay in the dev
    // accounts so the owner can sign in as either side and look at them.
    const rep = report(FLOW_EMP, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
