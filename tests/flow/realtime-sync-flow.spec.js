// REAL flow — cross-device Realtime sync (task #9). Two pages in ONE context
// share the dev session (the auth token lives in localStorage), so they model two
// devices signed into the same account. Device A creates a bid and saves; Device
// B — which never reloads manually — must receive it through Supabase Realtime:
// either the per-record postgres_changes patch (_applyRealtimeRecord) or the
// `data_saved` broadcast that triggers a silent reload (cloud.js
// _initRealtimeSubscriptions). If neither path delivers the row, sync is broken
// and this fails with the bid id that never arrived.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'realtime/cross-device-sync';

test.describe('realtime cross-device sync (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a bid created on device A appears on device B via Realtime', async ({ page }) => {
    const bidId = Date.now() * 1000 + (process.pid % 1000);
    const clientId = bidId + 1;
    const tag = `E2E RT ${process.pid}`;

    // Device A: make sure Realtime is subscribed before we touch anything.
    await page.waitForFunction(() => typeof _realtimeSubscribed !== 'undefined' && _realtimeSubscribed === true, { timeout: 20000 }).catch(() => {});

    // Device B: a second page in the SAME context auto-signs in from the shared
    // session token, then boots its own cloud load + Realtime subscription.
    const pageB = await page.context().newPage();
    await pageB.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
    await pageB.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    await pageB.waitForFunction(() => typeof _realtimeSubscribed !== 'undefined' && _realtimeSubscribed === true, { timeout: 20000 }).catch(() => {});
    // Confirm B does NOT already have the bid (clean baseline).
    const preB = await pageB.evaluate((id) => (bids || []).some(b => b.id === id), bidId);
    expect(preB, 'device B must not have the bid before device A creates it').toBe(false);

    await step(page, {
      label: 'device A creates a bid and saves to cloud', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud (postgres_changes + data_saved broadcast)',
      ruleText: 'a bid saved on device A must propagate to device B through Realtime (no manual reload)',
      expected: `device B sees bid ${bidId} within the Realtime window`,
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId, tag }) => {
          clients.push({ id: clientId, name: tag + ' Client', phone: '3165550702', _e2e: 'rt' });
          bids.push({ id: bidId, client_id: clientId, client_name: tag + ' Client', amount: 5550, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'rt' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { bidId, clientId, tag });
        // Wait (on device B) for Realtime to deliver the new bid.
        const arrived = await pageB.waitForFunction(
          (id) => (typeof bids !== 'undefined' ? bids : []).some(b => b.id === id),
          bidId, { timeout: 25000 }
        ).then(() => true).catch(() => false);
        p.__bArrived = arrived;
        return 1;
      },
      rule: async (p) => {
        const seen = await pageB.evaluate((id) => {
          const b = (bids || []).find(x => x.id === id);
          return b ? { has: true, amount: b.amount } : { has: false };
        }, bidId);
        return { ok: !!p.__bArrived && seen.has, got: JSON.stringify(seen) };
      },
    });

    // NO data cleanup — the synced bid + client stay in the dev account on purpose
    // so the owner can inspect what this test created (CLAUDE.md §13.7). Only the
    // extra device page is closed (resource cleanup, not data).
    await pageB.close().catch(() => {});

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
