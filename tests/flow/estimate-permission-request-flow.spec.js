// REAL flow — "Request access to estimates" (the feature the owner asked for).
// An employee without the `estimate` permission is gated from the estimator and
// can request access; the owner approves, flipping team_members.permissions.
// Drives the actual functions (clients.js _canEstimate/openEstimateForClient/
// _submitEstimateRequest, cloud.js _loadPendingPermRequests/_approvePermissionRequest)
// and the real td_permission_requests table + RLS.
//
// One-login self-contained: the dev account is made an employee OF ITSELF via a
// seeded team_members self-link (so the employee-insert RLS — which requires an
// active team membership — passes), then torn down.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'permissions/estimate-request';

test.describe('estimate permission-request (UI-driven, two-sided)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test.afterEach(async ({ page }) => {
    // Always restore contractor context + clean the self-link and any requests.
    await page.evaluate(async () => {
      window._isEmployee = false;
      try {
        const uid = _supaUser.id;
        await _supa.from('td_permission_requests').delete().eq('contractor_user_id', uid).eq('employee_user_id', uid);
        await _supa.from('team_members').delete().eq('contractor_user_id', uid).eq('employee_user_id', uid);
      } catch (e) {}
    }).catch(() => {});
  });

  test('a non-estimate employee is gated, requests access, and the owner approves', async ({ page }) => {
    // ── Seed the dev account as an active team member of itself, estimate=false. ──
    await step(page, {
      label: 'seed self team-link (estimate=false)', page: 'cloud', role: 'contractor',
      suspect: 'team_members RLS (Contractor manages own team)',
      ruleText: 'the owner can create a team_members link with no estimate permission',
      expected: 'team_members row exists with estimate falsy',
      act: async (p) => {
        await p.evaluate(async () => {
          const uid = _supaUser.id;
          await _supa.from('team_members').upsert({
            contractor_user_id: uid, employee_user_id: uid, email: _supaUser.email,
            name: 'E2E Self Tech', role: 'tech', active: true, permissions: { collect: true, estimate: false },
          }, { onConflict: 'contractor_user_id,email' });
        });
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(async () => {
          const uid = _supaUser.id;
          const { data } = await _supa.from('team_members').select('permissions').eq('contractor_user_id', uid).eq('employee_user_id', uid).maybeSingle();
          return { has: !!data, est: !!(data && data.permissions && data.permissions.estimate) };
        });
        return { ok: r.has && !r.est, got: JSON.stringify(r) };
      },
    });

    // ── As the employee: gated from the estimator, and the request inserts. ──
    // The td_permission_requests table ships in migration 20260628, which only
    // reaches PRODUCTION on merge. Flow tests hit prod, so pre-merge the table is
    // absent and the insert/select round-trip can't run. We therefore split the
    // assertions: the GATE (canEst=false, estimator not opened) is permission-
    // derived client-side and HARD-asserts today; the DB round-trip SOFT-PASSES
    // until the table exists, then hard-asserts forever (same pattern as the RPC
    // probe in employee-data-leak.spec.js ~line 127).
    let reqOk = {};
    await step(page, {
      label: 'employee gated → request access', page: 'pg-clients', role: 'employee',
      suspect: 'clients.js _canEstimate gate + _submitEstimateRequest insert (RLS)',
      ruleText: 'a non-estimate employee must NOT open the estimator; once td_permission_requests exists, it must also create a pending request row',
      expected: '_canEstimate()=false, estimator not opened (HARD); one pending request row (once table deployed)',
      act: async (p) => {
        reqOk = await p.evaluate(async () => {
          const uid = _supaUser.id;
          window._isEmployee = true; window._contractorUserId = uid;
          window._employeeRecord = { contractor_user_id: uid, employee_user_id: uid, email: _supaUser.email, name: 'E2E Self Tech', role: 'tech', active: true, permissions: { collect: true, estimate: false } };
          const canEst = (typeof _canEstimate === 'function') ? _canEstimate() : null;
          // Attempt to start an estimate — the gate should block the estimator and
          // route to the request popup. Pick any client (or none — the gate fires first).
          const before = document.getElementById('pg-est')?.classList.contains('active');
          try { openEstimateForClient(); } catch (e) {}
          const after = document.getElementById('pg-est')?.classList.contains('active');
          // Probe whether td_permission_requests is deployed yet (migration 20260628).
          let tableLive = true, probeErr = '';
          try {
            const { error } = await _supa.from('td_permission_requests').select('id').eq('contractor_user_id', uid).limit(1);
            if (error && /does not exist|could not find the table|schema cache|PGRST205|42P01/i.test((error.message || '') + (error.code || ''))) { tableLive = false; probeErr = error.message || error.code; }
          } catch (e) { tableLive = false; probeErr = e.message; }
          // Submit the request directly (the popup's confirm action).
          try { await _submitEstimateRequest(); } catch (e) {}
          await new Promise(r => setTimeout(r, 400));
          let pending = 0, perm = null;
          if (tableLive) {
            const { data } = await _supa.from('td_permission_requests').select('id,status,perm').eq('contractor_user_id', uid).eq('employee_user_id', uid).eq('status', 'pending');
            pending = (data || []).length; perm = data && data[0] ? data[0].perm : null;
          }
          return { canEst, openedEstimator: !!after && !before, tableLive, probeErr, pending, perm };
        });
        return 2; // attempt-estimate tap + submit-request confirm
      },
      rule: async () => {
        // Gate is HARD regardless of schema state.
        const gateOk = reqOk.canEst === false && reqOk.openedEstimator === false;
        if (!gateOk) return { ok: false, got: JSON.stringify(reqOk) };
        if (!reqOk.tableLive) {
          return { ok: true, got: `gate enforced (canEst=false, estimator not opened); td_permission_requests not in prod yet — pending migration merge [${reqOk.probeErr}]` };
        }
        const ok = reqOk.pending >= 1 && reqOk.perm === 'estimate';
        return { ok, got: JSON.stringify(reqOk) };
      },
    });

    // ── As the owner: load pending, approve, permission flips in team_members. ──
    // Entirely DB-round-trip dependent (reads td_permission_requests). Soft-pass
    // until the table is deployed; hard-assert the approval flow once it exists.
    let appr = {};
    await step(page, {
      label: 'owner approves → permission flips', page: 'pg-team', role: 'contractor',
      suspect: 'cloud.js _loadPendingPermRequests + _approvePermissionRequest',
      ruleText: 'once td_permission_requests exists, approving must set team_members.permissions.estimate=true and mark the request approved',
      expected: 'team_members estimate=true, request status approved (once table deployed)',
      act: async (p) => {
        appr = await p.evaluate(async () => {
          const uid = _supaUser.id;
          window._isEmployee = false;
          // Probe the table first — skip the whole approval round-trip if it's absent.
          let tableLive = true, probeErr = '';
          try {
            const { error } = await _supa.from('td_permission_requests').select('id').eq('contractor_user_id', uid).limit(1);
            if (error && /does not exist|could not find the table|schema cache|PGRST205|42P01/i.test((error.message || '') + (error.code || ''))) { tableLive = false; probeErr = error.message || error.code; }
          } catch (e) { tableLive = false; probeErr = e.message; }
          if (!tableLive) return { tableLive: false, probeErr };
          // Make S.employees carry the matching member so approve can flip it locally.
          if (!S.employees) S.employees = [];
          if (!S.employees.find(e => (e.email || '').toLowerCase() === (_supaUser.email || '').toLowerCase()))
            S.employees.push({ id: 1, name: 'E2E Self Tech', email: _supaUser.email, role: 'tech', permissions: { collect: true } });
          await _loadPendingPermRequests();
          await new Promise(r => setTimeout(r, 300));
          const req = (_pendingPermReqs || []).find(r => r.employee_user_id === uid);
          if (!req) return { tableLive: true, loaded: 0 };
          await _approvePermissionRequest(req.id);
          await new Promise(r => setTimeout(r, 500));
          const { data: tm } = await _supa.from('team_members').select('permissions').eq('contractor_user_id', uid).eq('employee_user_id', uid).maybeSingle();
          const { data: rq } = await _supa.from('td_permission_requests').select('status').eq('id', req.id).maybeSingle();
          return { tableLive: true, loaded: 1, est: !!(tm && tm.permissions && tm.permissions.estimate), status: rq ? rq.status : null };
        });
        return 1; // approve tap
      },
      rule: async () => {
        if (!appr.tableLive) {
          return { ok: true, got: `td_permission_requests not in prod yet — pending migration merge [${appr.probeErr}]` };
        }
        const ok = appr.loaded === 1 && appr.est === true && appr.status === 'approved';
        return { ok, got: JSON.stringify(appr) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
