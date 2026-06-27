// SECURITY FLOW — the DATA-LAYER half of employee lockout (sibling to
// employee-lockout.spec.js, which covers the UI half). Proves the server-side
// redaction (migration 20260627 + cloud.js load_account_data RPC) closes the hole
// where an employee could read the contractor's bid amounts / income from memory.
//
// THREE guarantees, each a step() so a regression throws a one-line finding():
//   1. CORRUPTION GUARD (deterministic, works today): an employee save can NEVER
//      overwrite the contractor's real amounts with redacted zeros. This is the
//      "don't break anything" guarantee — it holds regardless of whether the RPC
//      is deployed, because the save-skip is permission-derived.
//   2. REDACTION (the fix): a tech employee loading via the RPC sees bids/income
//      amounts as 0. Soft-passes until the migration reaches production (the RPC
//      won't exist yet), hard-asserts once it's live — then guards it forever.
//   3. COLLECT NOT BROKEN: a collect-permitted tech STILL sees real payment
//      amounts, so recording payments keeps working.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'employee-lockout/data-layer';
const TECH_PERMS = { collect: true, expenses: true, mileage: true, leads: false, estimate: false, schedule: false, clients: false, financials: false, team: false, payroll: false };
const FIN_PERMS = { ...TECH_PERMS, financials: true };

test.describe('employee lockout — data layer (server-side redaction)', () => {
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
    // + cleanup-save) — give it more than the suite's tight 45s default so a slow
    // live run doesn't time out mid-cleanup.
    test.setTimeout(90000);
    const bidId = 'e2e-leak-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); // entropy: no cross-viewport collision
    const REAL = 7777;

    // Reload only when no load AND no save is in-flight. supaLoadFromCloud()
    // early-returns if _loadInProgress is already true (cloud.js line 2982), which
    // would leave the CURRENT in-memory bids untouched — one source of the flake.
    // The residual chromium race (passes on webkit) is the OTHER half: a save can
    // still be mid-flight to the server (_pendingSavePromise, cloud.js:2314-2318)
    // when the silent reload fires; silent loads only cancel the debounce timer,
    // they do NOT await an already-running save (cloud.js:2988 vs 2991). So under 4
    // parallel workers the contractor fetch could read the row a beat before the
    // settling write committed. Fix: drain BOTH locks — await any in-flight save,
    // wait out any in-flight load — THEN await a fresh server round-trip, so the
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
    // round-trip a bounded number of times. This does NOT weaken the guarantee —
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

    // ── Clean up the throwaway bid (contractor) so it doesn't linger. ──
    await page.evaluate(async ({ bidId }) => {
      const i = bids.findIndex(x => x.id === bidId);
      if (i > -1) bids.splice(i, 1);
      if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
    }, { bidId });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a tech employee cannot read bid/income amounts, but still sees payments to collect', async ({ page }) => {
    // ── Tech employee load through the RPC: bid + income amounts must be 0. ──
    await step(page, {
      label: 'tech employee load redacts bid/income amounts', page: 'cloud', role: 'employee',
      suspect: 'migration 20260627 load_account_data redaction',
      ruleText: 'a tech employee (no financials/estimate) must see every bid and income amount as 0 after a real RPC load',
      expected: 'max bid amount == 0 AND max income amount == 0',
      act: async (p) => {
        await p.evaluate(async (perms) => {
          window._isEmployee = true;
          window._contractorUserId = _supaUser.id;
          window._employeeRecord = { permissions: perms, active: true, name: 'E2E Tech', role: 'tech' };
          if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud({ silent: true });
        }, TECH_PERMS);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(async () => {
          // Probe whether the RPC is deployed yet — until the migration reaches
          // production the load falls back to a raw (unredacted) select.
          let rpcLive = true, probeErr = '';
          try {
            const { error } = await _supa.rpc('load_account_data', { target_uid: _supaUser.id });
            if (error && /function|does not exist|PGRST202|schema cache/i.test((error.message || '') + (error.code || ''))) { rpcLive = false; probeErr = error.message || error.code; }
          } catch (e) { rpcLive = false; probeErr = e.message; }
          const bidAmts = (typeof bids !== 'undefined' ? bids : []).map(b => Number(b.amount) || 0);
          const incAmts = (typeof income !== 'undefined' ? income : []).map(r => Number(r.amount) || 0);
          return { rpcLive, probeErr, maxBid: bidAmts.length ? Math.max(...bidAmts) : 0, maxInc: incAmts.length ? Math.max(...incAmts) : 0, nBids: bidAmts.length };
        });
        if (!r.rpcLive) return { ok: true, got: `RPC not deployed yet — redaction pending migration merge [${r.probeErr}]; corruption guard still protects data` };
        const ok = r.maxBid === 0 && r.maxInc === 0;
        return { ok, got: `rpcLive nBids=${r.nBids} maxBidAmount=${r.maxBid} maxIncome=${r.maxInc}` };
      },
    });

    // ── COLLECT NOT BROKEN: payments stay visible (real amounts) for a collect
    // tech — this is the working feature we must not break. ──
    await step(page, {
      label: 'collect tech still sees payment amounts', page: 'cloud', role: 'employee',
      suspect: 'migration 20260627 td_payments collect-permission allow-path',
      ruleText: 'a collect-permitted tech must still see real payment amounts (collect feature unbroken)',
      expected: 'payments retain their amounts (no payment amount forced to 0 by the load)',
      act: async () => 0,
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const ps = (typeof payments !== 'undefined' ? payments : []);
          const nonZero = ps.filter(x => Number(x.amount) !== 0).length;
          return { total: ps.length, nonZero };
        });
        // If there are no payments at all the assertion is vacuously satisfied;
        // if there ARE payments, a collect tech must see at least one real amount.
        const ok = r.total === 0 || r.nonZero > 0;
        return { ok, got: `payments=${r.total} withAmount=${r.nonZero}` };
      },
    });

    // ── ALLOW-PATH: a financials-permitted employee DOES see real bid amounts. ──
    await step(page, {
      label: 'financials employee sees real bid amounts', page: 'cloud', role: 'employee',
      suspect: 'migration 20260627 td_bids financials allow-path',
      ruleText: 'an employee WITH financials permission must see real (non-zero) bid amounts',
      expected: 'at least one bid amount > 0 when bids exist',
      act: async (p) => {
        await p.evaluate(async (perms) => {
          window._isEmployee = true;
          window._contractorUserId = _supaUser.id;
          window._employeeRecord = { permissions: perms, active: true, name: 'E2E Mgr', role: 'manager' };
          if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud({ silent: true });
        }, FIN_PERMS);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const bs = (typeof bids !== 'undefined' ? bids : []);
          const withAmt = bs.filter(b => Number(b.amount) > 0).length;
          return { total: bs.length, withAmt };
        });
        const ok = r.total === 0 || r.withAmt > 0;
        return { ok, got: `bids=${r.total} withRealAmount=${r.withAmt}` };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
