// @ts-check
/**
 * Regression guard, "Clear all data" must wipe EVERY local store (§14 self-heal).
 *
 * BUG, clearing all data left maintenance / events / photos / licenses / contracts
 *       / agreements behind. Root cause: clearAllData() in settings.js only zeroed a
 *       subset of the stores declared in data.js, so the omitted arrays survived a
 *       "Clear all data" and resurfaced on the dashboard.
 *       Fix: clearAllData() now empties every user-data store declared in data.js
 *       (clients, bids, jobs, income, expenses, mileage, maintenance, payments,
 *       liens, timeEntries, events, photos, licenses, contracts, agreements,
 *       checksState) + S.employees/S.vehicles, then _flushSaveNow() propagates the
 *       cleared state to the cloud, and _clearCrewTrackingCloud() deletes the cloud
 *       crew time-tracking tables so the Crew Today tile empties too.
 *
 * This counts what's in memory AFTER clearAllData, if any store the user can fill
 * survives, this fails forever.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Clear all data, every store wiped', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
    });
  });

  test.afterAll(async () => { await page.context().close(); });

  test('clearAllData empties clients, bids, maintenance, events, photos, licenses, contracts, agreements', async () => {
    const after = await page.evaluate(async () => {
      // Auto-confirm both nested zConfirm prompts and swallow the trailing zAlert.
      const _origConfirm = window.zConfirm, _origAlert = window.zAlert;
      window.zConfirm = (_msg, onYes) => { try { onYes && onYes(); } catch (e) {} };
      window.zAlert = () => {};

      // Seed EVERY user-data store with a record.
      clients = [{ id: 1, name: 'Seed Client' }];
      bids = [{ id: 2, client_id: 1, amount: 100 }];
      jobs = [{ id: 3, client_id: 1 }];
      income = [{ id: 4, amount: 50 }];
      expenses = [{ id: 5, amount: 20 }];
      mileage = [{ id: 6, miles: 10 }];
      maintenance = [{ id: 7, vehicle: 'Truck', note: 'oil' }];
      payments = [{ id: 8, amount: 25 }];
      liens = [{ id: 9, bid_id: 2 }];
      timeEntries = [{ id: 10, minutes: 60 }];
      events = [{ id: 11, title: 'Site visit' }];
      photos = [{ id: 12, url: 'x' }];
      licenses = [{ id: 13, name: 'Contractor License' }];
      contracts = [{ id: 14, title: 'MSA' }];
      agreements = [{ id: 15, title: 'NDA' }];
      checksState = { foo: 'bar' };
      S.employees = [{ id: 16, name: 'Crew A' }];
      _setVehicles([{ id: 17, name: 'Van' }]);
      // Both wipe escapees this guard exists to catch: places is a synced array
      // that was simply missing from the wipe list, and the inbound QR/intake
      // lead queue lives OUTSIDE the sync fabric entirely (its own cloud table
      // + in-memory queue), so no sweep ever reached it.
      places = [{ id: 18, name: 'Ferguson', kind: 'supply', lat: 1, lon: 2 }];
      _pendingInbound = [{ id: 'lead-1', status: 'pending', name: 'QR Lead' }];
      _processedInboundIds.add('lead-0');

      clearAllData();
      // clearAllData's confirmed callback is async (awaits the cloud-tracking clear);
      // give the microtask queue a beat to settle before we read the stores.
      await new Promise(r => setTimeout(r, 50));

      window.zConfirm = _origConfirm; window.zAlert = _origAlert;
      return {
        clients: clients.length, bids: bids.length, jobs: jobs.length, income: income.length,
        expenses: expenses.length, mileage: mileage.length, maintenance: maintenance.length,
        payments: payments.length, liens: liens.length, timeEntries: timeEntries.length,
        events: events.length, photos: photos.length, licenses: licenses.length,
        contracts: contracts.length, agreements: agreements.length,
        checksStateKeys: Object.keys(checksState).length,
        employees: (S.employees || []).length,
        // The live fleet (td_vehicles) AND the retired blob key must both end up
        // empty: leaving the legacy copy behind would let the one-time migration
        // lift the "cleared" trucks straight back on the next boot.
        vehicles: getVehicles().length, legacyVehicleBlob: (S.vehicles || []).length,
        places: places.length,
        pendingInbound: _pendingInbound.length,
        processedInboundIds: _processedInboundIds.size,
      };
    });

    // Every store the user can populate must be empty after Clear all data.
    for (const [store, count] of Object.entries(after)) {
      expect(count, `${store} should be 0 after clearAllData`).toBe(0);
    }
  });

  test('no console errors during clear all data', async () => {
    await assertNoErrors(page);
  });

  // ── "Start fresh" also severs the invited crew (owner, 2026-08-17) ─────────
  //
  // BUG: team_members (the crew roster) was deliberately left intact on the
  // theory it's "identity, not tracking." In practice a contractor who clears
  // everything expects a genuinely fresh account, and a stale link surviving
  // a clear kept routing a test login's writes to the owner's real account
  // (it stopped showing in the UI but the row was still there). Fix:
  // clearAllData() now also deletes team_members rows this account owns as
  // CONTRACTOR (RLS: "Contractor manages own team" only permits deleting your
  // own roster, so this can never touch someone else's team_members row).
  test('clearAllData deletes team_members rows owned as contractor, scoped to this account only', async () => {
    const out = await page.evaluate(async () => {
      const origConfirm = window.zConfirm, origAlert = window.zAlert;
      const origSupa = window._supa, origEnabled = window.supaEnabled, origUser = window._supaUser;
      window.zConfirm = (_msg, onYes) => { try { onYes && onYes(); } catch (e) {} };
      window.zAlert = () => {};
      const calls = [];
      window.supaEnabled = () => true;
      window._supaUser = { id: 'owner-1' };
      const mkQuery = (tbl) => {
        const q = { _eq: {} };
        q.delete = () => q;
        q.eq = (c, v) => { calls.push({ tbl, col: c, val: v }); q._eq[c] = v; return q; };
        q.then = (resolve) => resolve({ data: null, error: null });
        return q;
      };
      window._supa = { from: (tbl) => mkQuery(tbl) };

      clearAllData();
      await new Promise(r => setTimeout(r, 50));

      window.zConfirm = origConfirm; window.zAlert = origAlert;
      window._supa = origSupa; window.supaEnabled = origEnabled; window._supaUser = origUser;
      return calls.filter(c => c.tbl === 'team_members');
    });
    expect(out).toContainEqual({ tbl: 'team_members', col: 'contractor_user_id', val: 'owner-1' });
    // Never a bare delete-all, and never keyed on employee_user_id: only the
    // contractor's OWN roster, RLS would reject anything broader anyway.
    expect(out.every(c => c.col === 'contractor_user_id' && c.val === 'owner-1')).toBe(true);
  });

  test('_clearTeamLinksCloud is a safe no-op when Supabase is not enabled', async () => {
    const out = await page.evaluate(async () => {
      let threw = false;
      try { await _clearTeamLinksCloud(); } catch (e) { threw = true; }
      return threw;
    });
    expect(out).toBe(false);
  });
});
