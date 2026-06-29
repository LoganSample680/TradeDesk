// REAL flow — "every Save updates the SAME bid; it never spawns a duplicate in
// Make Money Today." This is the exact worry: start a bid, save it, go home, do
// other things, come back and save again — repeatedly, including across a REAL
// page reload (full session-var loss) — and prove the estimator never mints a
// second bid. The check is end-to-end against Supabase: after all the saves the
// CLOUD (td_bids) must hold exactly ONE draft row for the client, and the live
// in-memory bids[] must agree. If the dedup chain in paint-estimate.js
// `_paintEstAutosave` (editingBidId → lastCreatedBidId → localStorage lastBidId →
// orphan-by-client) ever breaks, N saves create N rows and this fails loudly.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'bids/save-no-duplicate';

// Count draft bids for one client that actually exist in the cloud td_bids table.
async function cloudDraftCount(page, clientId) {
  return await page.evaluate(async ({ clientId }) => {
    const uid = (_supaUser && _supaUser.id) || null;
    if (!uid) return -1;
    const { data, error } = await _supa.from('td_bids').select('id,data').eq('user_id', uid).is('deleted_at', null);
    if (error) return -2;
    let n = 0;
    (data || []).forEach(r => {
      let d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
      if (d && String(d.client_id) === String(clientId) && (d.draft || d.status === 'Draft')) n++;
    });
    return n;
  }, { clientId });
}

// Re-auth + cloud-load after a real reload (session token persists in localStorage).
async function waitReboot(page) {
  await page.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
  await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
}

test.describe('bid save — no duplicate in Make Money Today (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('saving a bid repeatedly across navigation + reload keeps ONE cloud row', async ({ page }) => {
    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const CNAME = `E2E DupGuard ${process.pid}`;

    // ── 3 saves with go-home + session-var loss between each. ──
    await step(page, {
      label: 'build a bid and save 3× across navigation (session pointer lost each time)',
      page: 'pg-est', role: 'contractor',
      suspect: 'paint-estimate.js _paintEstAutosave (dedup: lastCreatedBidId / draft lastBidId / orphan-by-client)',
      ruleText: 'repeated saves of the same new bid must create exactly ONE draft, not one per save',
      expected: 'cloud td_bids has 1 draft for the client after 3 saves',
      act: async (p) => {
        await p.evaluate(({ clientId, CNAME }) => {
          // Fresh client + clean estimator state.
          clients = clients.filter(c => c.id !== clientId);
          clients.push({ id: clientId, name: CNAME, _e2e: 'dupguard' });
          estLinkedClientId = clientId; editingBidId = null; lastCreatedBidId = null;
          if (typeof estSurfaces !== 'undefined') estSurfaces = [];
          try { localStorage.removeItem('zp3_est_full_draft'); } catch (e) {}
        }, { clientId, CNAME });

        for (let i = 0; i < 3; i++) {
          await p.evaluate(({ clientId, CNAME }) => {
            const el = document.getElementById('e-cname'); if (el) el.value = CNAME; // reopened draft repopulates name
            estLinkedClientId = clientId;
            if (typeof _paintEstAutosave === 'function') _paintEstAutosave();         // HIT SAVE
            if (typeof goPg === 'function') goPg('pg-dash');                           // GO HOME
            if (typeof renderTodayFeed === 'function') renderTodayFeed();             // do other tasks
            lastCreatedBidId = null;                                                   // WORST CASE: pointer lost
          }, { clientId, CNAME });
        }
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        await p.waitForTimeout(600);
        return 3;
      },
      rule: async (p) => {
        const cloud = await cloudDraftCount(p, clientId);
        const mem = await p.evaluate(({ clientId }) => bids.filter(b => b.client_id === clientId && (b.draft || b.status === 'Draft')).length, { clientId });
        return { ok: cloud === 1 && mem === 1, got: `cloudDrafts=${cloud} memDrafts=${mem}` };
      },
    });

    // ── A REAL reload (full session-var loss), then come back and save again. ──
    await step(page, {
      label: 'reload the app, re-open the draft, save again — still ONE cloud row',
      page: 'reboot', role: 'contractor',
      suspect: 'paint-estimate.js _paintEstAutosave Case 2.5 (recover draft id from localStorage after restart)',
      ruleText: 'after a real reload, re-saving the recovered draft must update it, not mint a duplicate',
      expected: 'cloud td_bids still has exactly 1 draft for the client',
      act: async (p) => {
        await p.reload({ waitUntil: 'domcontentloaded' });
        await waitReboot(p);
        await p.evaluate(({ clientId, CNAME }) => {
          // Session globals are gone after reload; the draft id survives in
          // localStorage (and the bid itself came back from the cloud load).
          const el = document.getElementById('e-cname'); if (el) el.value = CNAME;
          estLinkedClientId = clientId; editingBidId = null; lastCreatedBidId = null;
          if (typeof _paintEstAutosave === 'function') _paintEstAutosave();
        }, { clientId, CNAME });
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        await p.waitForTimeout(700);
        return 2; // re-open draft (1) + save (1)
      },
      rule: async (p) => {
        const cloud = await cloudDraftCount(p, clientId);
        return { ok: cloud === 1, got: `cloudDrafts=${cloud} (must stay 1 across a real reboot)` };
      },
    });

    // NO cleanup — the seed bid + client stay in the dev account on purpose so the
    // owner can inspect what this test created (CLAUDE.md §13.7). Manual delete only.

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
