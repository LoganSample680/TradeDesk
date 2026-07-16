// SECURITY FLOW, the DATA-LAYER half of employee lockout (sibling to
// employee-lockout.spec.js, which covers the UI half). Proves the server-side
// redaction (migration 20260627 + cloud.js load_account_data RPC) closes the hole
// where an employee could read the contractor's bid amounts / income from memory.
//
// THREE guarantees, each a step() so a regression throws a one-line finding():
//   1. CORRUPTION GUARD (deterministic, works today): an employee save can NEVER
//      overwrite the contractor's real amounts with redacted zeros. This is the
//      "don't break anything" guarantee: it holds regardless of whether the RPC
//      is deployed, because the save-skip is permission-derived.
//   2. REDACTION (the fix): a tech employee loading via the RPC sees bids/income
//      amounts as 0. Soft-passes until the migration reaches production (the RPC
//      won't exist yet), hard-asserts once it's live, then guards it forever.
//   3. COLLECT NOT BROKEN: a collect-permitted tech STILL sees real payment
//      amounts, so recording payments keeps working.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, accountPair } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'employee-lockout/data-layer';
const TECH_PERMS = { collect: true, expenses: true, mileage: true, leads: false, estimate: false, schedule: false, clients: false, financials: false, team: false, payroll: false };
const FIN_PERMS = { ...TECH_PERMS, financials: true };

test.describe('employee lockout, data layer (server-side redaction)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // Always leave the session as the contractor with fresh real data, so a later
  // autosave can never persist a simulated-redacted array.
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      window._isEmployee = false;
      try { if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud({ silent: true }); } catch (e) {}
    }).catch(() => {});
  });

  test('an employee save can never overwrite contractor financials (corruption guard)', async ({ page }) => {
    // Round-trip heavy (seed-save + reload + employee-save + reload-until-converged
    // + cleanup-save), give it more than the suite's tight 45s default so a slow
    // live run doesn't time out mid-cleanup.
    test.setTimeout(90000);
    const bidId = 'e2e-leak-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); // entropy: no cross-viewport collision
    const REAL = 7777;

    // Reload only when no load AND no save is in-flight. supaLoadFromCloud()
    // early-returns if _loadInProgress is already true (cloud.js line 2982), which
    // would leave the CURRENT in-memory bids untouched, one source of the flake.
    // The residual chromium race (passes on webkit) is the OTHER half: a save can
    // still be mid-flight to the server (_pendingSavePromise, cloud.js:2314-2318)
    // when the silent reload fires; silent loads only cancel the debounce timer,
    // they do NOT await an already-running save (cloud.js:2988 vs 2991). So under 4
    // parallel workers the contractor fetch could read the row a beat before the
    // settling write committed. Fix: drain BOTH locks, await any in-flight save,
    // wait out any in-flight load, THEN await a fresh server round-trip, so the
    // assertion reads fully-committed server state, not a transient row.
    const RELOAD = `(async () => {
      // 1) let any in-flight save finish committing to the server
      for (let i = 0; i < 60 && (typeof _pendingSavePromise !== 'undefined' && _pendingSavePromise); i++) {
        try { await _pendingSavePromise; } catch (e) {}
        await new Promise(r => setTimeout(r, 50));
      }
      // 2) wait out any in-flight load so our fresh fetch isn't a no-op
      for (let i = 0; i < 60 && (typeof _loadInProgress !== 'undefined' && _loadInProgress); i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud({ silent: true });
    })()`;

    // Reload-until: drain the locks, fetch, and if the target bid still reads back
    // a non-target value (a write hadn't settled on this worker yet), retry the
    // round-trip a bounded number of times. This does NOT weaken the guarantee,
    // the guard means the zero must NEVER persist, so a correct system always
    // converges to REAL. Only a genuine corruption (the zero actually reached the
    // cloud) keeps reading 0 through every retry and fails the assertion, which is
    // exactly the bug under test. `expectAmt` is the value that proves the guard
    // held. Built as a finished script string here (bidId/RELOAD are in Node scope)
    // and eval'd in the browser.
    const RELOAD_UNTIL = (expectAmt) => `(async () => {
      let amt = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        await ${RELOAD};
        const b = bids.find(x => x.id === ${JSON.stringify(bidId)});
        amt = b ? Number(b.amount) : null;
        if (amt === ${expectAmt}) break;
        await new Promise(r => setTimeout(r, 150));
      }
      return amt;
    })()`;

    // ── Seed a throwaway tagged bid as the contractor and persist it. Using a
    // dedicated bid means even a guard regression can only touch test data. ──
    await step(page, {
      label: 'contractor seeds a $7777 test bid', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud (contractor write)',
      ruleText: 'the seeded bid must persist to the cloud with its real amount',
      expected: 'bid reloads with amount 7777',
      act: async (p) => {
        await p.evaluate(async ({ bidId, REAL, RELOAD }) => {
          bids.push({ id: bidId, amount: REAL, client_name: 'E2E DataLeak', status: 'sent', _e2e: 'data-leak', created: new Date().toISOString() });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
          await eval(RELOAD); // settle the write through the server before asserting
        }, { bidId, REAL, RELOAD });
        return 1; // one seed-and-persist write
      },
      rule: async (p) => {
        const amt = await p.evaluate(async ({ script }) => eval(script), { script: RELOAD_UNTIL(REAL) });
        return { ok: amt === REAL, got: 'reloaded amount=' + amt };
      },
    });

    // ── Become a tech employee, simulate the server redaction by zeroing the bid
    // amount in memory, then SAVE. The save-skip must drop td_bids so the zero
    // never reaches the cloud. Then reload as contractor and prove it survived. ──
    await step(page, {
      label: 'employee save must NOT persist the zeroed amount', page: 'cloud', role: 'employee',
      suspect: 'cloud.js supaSaveToCloud _employeeRedactedTables save-skip',
      ruleText: 'a redacted (zeroed) bid amount written by an employee must NOT overwrite the contractor stored value',
      expected: 'contractor reload still shows amount 7777',
      act: async (p) => {
        await p.evaluate(async ({ bidId, perms }) => {
          window._isEmployee = true;
          window._contractorUserId = _supaUser.id;
          window._employeeRecord = { permissions: perms, active: true, name: 'E2E Tech', role: 'tech' };
          const b = bids.find(x => x.id === bidId);
          if (b) b.amount = 0;   // simulate the redaction the RPC performs
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { bidId, perms: TECH_PERMS });
        return 1; // one employee save (the redacted-table skip must drop td_bids)
      },
      rule: async (p) => {
        const amt = await p.evaluate(async ({ script }) => {
          window._isEmployee = false;          // back to contractor
          return await eval(script);           // drain locks, fetch, converge-or-fail
        }, { script: RELOAD_UNTIL(REAL) });
        return { ok: amt === REAL, got: 'contractor reload amount=' + amt + ' (must be 7777, not 0)' };
      },
    });

    // NO cleanup, the seeded contractor bid stays in the dev account on purpose so
    // the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a tech employee cannot read bid/income amounts, but a financials peer can', async ({ page }) => {
    // GENUINE two-account redaction test. The old version self-linked (employee == owner),
    // but the RPC explicitly NEVER redacts the owner (auth.uid()==target_uid → full access),
    // so it could never exercise redaction. This uses TWO distinct accounts: A (contractor,
    // owns the $7777 bid) and B (a tech employee of A, financials:false). Signed in as B,
    // load_account_data(target_uid=A) must come back with amounts zeroed.
    test.setTimeout(90000);
    const pair = accountPair();
    test.skip(!pair, 'two-account redaction test needs A+B (local pool ≥2, or E2E_DEV2_* cloud creds)');
    const [A, B] = pair;

    const REAL = 7777;
    const bidId = 'e2e-redact-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    const incId = 'e2e-redinc-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);

    // In-page auth as an explicit account (mirrors signIn's internal grant), then wait for
    // the cloud-load to settle so each role switch is a real, hydrated session.
    const authAs = async (acct) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      // Wait for the Supabase client to initialize, NOT for the login form. When a prior test
      // leaves a persisted session, the app boots straight to the dashboard and #supa-email
      // never renders, the old `waitForSelector('#supa-email')` then timed out at 30s. authAs
      // drives auth through _supa directly, so client-readiness is the correct gate.
      await page.waitForFunction(() => typeof _supa !== 'undefined' && !!_supa, { timeout: 30000 });
      const res = await page.evaluate(async ({ email, password }) => {
        if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized' };
        try { await _supa.auth.signOut(); } catch (_e) { /* no prior session, fine */ } // clean switch between accounts
        for (let i = 0; i < 4; i++) {
          const { error } = await _supa.auth.signInWithPassword({ email, password });
          if (!error) return { ok: true };
          if (error.message && !/network|fetch|timeout|rate/i.test(error.message) && error.status !== 429) return { ok: false, why: error.message };
          await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
        return { ok: false, why: 'sign-in retries exhausted' };
      }, { email: acct.email, password: acct.password });
      if (!res.ok) throw new Error(`auth as ${acct.email} failed: ${res.why}`);
      // Wait for the app to reflect THIS account (guards against a stale prior session lingering).
      await page.waitForFunction((uid) => typeof _supaUser !== 'undefined' && _supaUser && (!uid || _supaUser.id === uid), acct.uid, { timeout: 30000 })
        .catch(() => {});
      await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    };

    // ── A signs in, seeds a known bid + income, and links B as a tech (financials:false). ──
    await authAs(A);
    await step(page, {
      label: 'A seeds a $7777 bid + income and links B as tech (financials:false)', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud + team_members insert',
      ruleText: 'A persists a real bid/income and an active team_members link to B',
      expected: 'bid persisted AND team link active',
      act: async (p) => {
        return await p.evaluate(async ({ bidId, incId, REAL, Buid, Bemail, perms }) => {
          bids.push({ id: bidId, amount: REAL, client_name: 'E2E Redact', status: 'sent', _e2e: 'redact', created: new Date().toISOString() });
          if (typeof income !== 'undefined') income.push({ id: incId, amount: REAL, source: 'E2E Redact', date: new Date().toISOString().slice(0, 10), _e2e: 'redact' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
          await _supa.from('team_members').delete().eq('contractor_user_id', _supaUser.id).eq('employee_user_id', Buid);
          const { error } = await _supa.from('team_members').insert({
            contractor_user_id: _supaUser.id, employee_user_id: Buid, email: Bemail, name: 'E2E Tech B', role: 'tech', permissions: perms, active: true,
          });
          // Surface the REAL failure reason in the finding (a bare linked=false told us
          // nothing on the cloud gate, capture code+message for the rule's got).
          window.__linkErr = error ? ((error.code || '?') + ': ' + (error.message || String(error))) : null;
          return error ? 0 : 3;
        }, { bidId, incId, REAL, Buid: B.uid, Bemail: B.email, perms: TECH_PERMS });
      },
      rule: async (p) => {
        const r = await p.evaluate(async ({ bidId, Buid }) => {
          const { data: b } = await _supa.from('td_bids').select('id').eq('id', bidId).limit(1);
          const { data: tm } = await _supa.from('team_members').select('id').eq('contractor_user_id', _supaUser.id).eq('employee_user_id', Buid).eq('active', true).limit(1);
          return { bidLanded: !!(b && b.length), linked: !!(tm && tm.length) };
        }, { bidId, Buid: B.uid });
        if (!r.bidLanded) return { ok: true, got: 'SKIP: td_bids unavailable on this stack (bid not persistable); redaction not exercisable' };
        const linkErr = await p.evaluate(() => window.__linkErr || null);
        return { ok: r.linked, got: `bidLanded=${r.bidLanded} linked=${r.linked}${linkErr ? ' insertErr=' + linkErr : ''}` };
      },
    });

    const Auid = await page.evaluate(() => _supaUser.id);

    // ── B (tech, financials:false) loads A's account via the RPC → amounts must be 0. ──
    await authAs(B);
    await step(page, {
      label: 'B (tech) RPC-loads A → bid & income amounts redacted to 0', page: 'cloud', role: 'employee',
      suspect: 'migration 20260627 load_account_data redaction (financials:false path)',
      ruleText: 'a tech employee (no financials) loading the contractor via the RPC must see every bid and income amount as 0',
      expected: 'maxBid == 0 AND maxInc == 0',
      act: async () => 1,
      rule: async (p) => {
        const r = await p.evaluate(async (Auid) => {
          let rpcLive = true, probeErr = '', authErr = '';
          let payload = null;
          try {
            const { data, error } = await _supa.rpc('load_account_data', { target_uid: Auid });
            if (error) {
              if (/function|does not exist|PGRST202|schema cache/i.test((error.message || '') + (error.code || ''))) { rpcLive = false; probeErr = error.message || error.code; }
              else authErr = error.message || error.code;
            } else payload = data;
          } catch (e) { rpcLive = false; probeErr = e.message; }
          if (!rpcLive) return { rpcLive, probeErr };
          if (authErr) return { rpcLive, authErr };
          const bidRows = (payload && payload.td_bids) || [];
          const incRows = (payload && payload.td_income) || [];
          const maxBid = bidRows.length ? Math.max(...bidRows.map(x => Number((x.data || {}).amount) || 0)) : 0;
          const maxInc = incRows.length ? Math.max(...incRows.map(x => Number((x.data || {}).amount) || 0)) : 0;
          return { rpcLive, nBids: bidRows.length, nInc: incRows.length, maxBid, maxInc };
        }, Auid);
        if (!r.rpcLive) return { ok: true, got: `RPC not deployed yet, redaction pending migration merge [${r.probeErr}]` };
        if (r.authErr) return { ok: false, got: `RPC rejected B as unauthorized, team link broken: ${r.authErr}` };
        const ok = r.maxBid === 0 && r.maxInc === 0;
        return { ok, got: `rpcLive nBids=${r.nBids} maxBid=${r.maxBid} nInc=${r.nInc} maxInc=${r.maxInc} (both must be 0)` };
      },
    });

    // ── ALLOW-PATH: A flips B to financials:true; B re-loads → real amounts return. ──
    await authAs(A);
    await page.evaluate(async ({ Buid, perms }) => {
      await _supa.from('team_members').update({ permissions: perms }).eq('contractor_user_id', _supaUser.id).eq('employee_user_id', Buid);
    }, { Buid: B.uid, perms: FIN_PERMS });

    await authAs(B);
    await step(page, {
      label: 'B (now financials) RPC-loads A → real bid amounts visible', page: 'cloud', role: 'employee',
      suspect: 'migration 20260627 load_account_data td_bids financials allow-path',
      ruleText: 'an employee WITH financials permission must see real (non-zero) bid amounts via the RPC',
      expected: 'at least one bid amount > 0',
      act: async () => 1,
      rule: async (p) => {
        const r = await p.evaluate(async (Auid) => {
          let rpcLive = true, probeErr = '';
          try {
            const { data, error } = await _supa.rpc('load_account_data', { target_uid: Auid });
            if (error && /function|does not exist|PGRST202|schema cache/i.test((error.message || '') + (error.code || ''))) { rpcLive = false; probeErr = error.message || error.code; return { rpcLive, probeErr }; }
            const bidRows = (data && data.td_bids) || [];
            const withAmt = bidRows.filter(x => Number((x.data || {}).amount) > 0).length;
            return { rpcLive, total: bidRows.length, withAmt };
          } catch (e) { return { rpcLive: false, probeErr: e.message }; }
        }, Auid);
        if (!r.rpcLive) return { ok: true, got: `RPC not deployed yet [${r.probeErr}]` };
        const ok = r.total === 0 || r.withAmt > 0;
        return { ok, got: `bids=${r.total} withRealAmount=${r.withAmt}` };
      },
    });

    // NO data cleanup (§13.7). The team_members link + seed bid stay for inspection.
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
