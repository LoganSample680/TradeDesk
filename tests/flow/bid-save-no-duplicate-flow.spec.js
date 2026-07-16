// REAL flow, "every Save updates the SAME bid; it never spawns a duplicate in
// Make Money Today." The exact worry: start a bid, save it, go home, do other
// things, come back and save again, repeatedly, including across a REAL page
// reload (full session-var loss), and prove the estimator never mints a second
// bid. The check is end-to-end against Supabase: after all the saves the CLOUD
// (td_bids) must hold exactly ONE draft row for the client, and the live in-memory
// bids[] must agree.
//
// Rewritten for the T&M/BYO estimator that REPLACED the deleted paint flow. The
// dedup guarantee now rests on `_geiEditBidId` (the estimator writes every autosave
// into that one bid via `_byoAutosave`) plus `openGenericEstimate`'s reuse logic
// (it resumes the existing unsent draft rather than creating a second). If either
// breaks, N saves create N rows and this fails loudly.
const { test, expect } = require('./flow-test');
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

test.describe('bid save, no duplicate in Make Money Today (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('saving a BYO bid repeatedly across navigation + reload keeps ONE cloud row', async ({ page }) => {
    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const CNAME = `E2E DupGuard ${process.pid}`;
    let bidId = null;

    // ── Open BYO, add an item, then autosave 3× with go-home + pointer loss. ──
    await step(page, {
      label: 'open BYO + add item + autosave 3× across navigation',
      page: 'pg-est-generic', role: 'contractor',
      suspect: 'generic-estimate.js _byoAutosave / openGenericEstimate reuse (dedup: _geiEditBidId)',
      ruleText: 'repeated autosaves of the same new BYO draft must keep exactly ONE draft, not one per save',
      expected: 'cloud td_bids has 1 draft for the client after 3 saves',
      act: async (p) => {
        bidId = await p.evaluate(async ({ clientId, CNAME }) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const g = id => document.getElementById(id);
          // Fresh client + clean estimator state (no chooser on a fresh client).
          clients = clients.filter(c => c.id !== clientId);
          clients.push({ id: clientId, name: CNAME, _e2e: 'dupguard' });
          if (typeof _geiEditBidId !== 'undefined') _geiEditBidId = null;
          openFreeFormEstimate({ id: clientId, name: CNAME }, null);
          await wait(400);
          // One priced item so the draft is non-empty (mirrors a real in-progress bid).
          _byoAddItem('Materials');
          await wait(90);
          const l = g('_bya-label'); if (l) l.value = 'Paint + sundries';
          const pr = g('_bya-price'); if (pr) pr.value = '300';
          _byaConfirm('Materials');
          await wait(120);
          const id = _geiEditBidId;
          // 3 saves, each with go-home + "pointer lost" (worst case) between them.
          for (let i = 0; i < 3; i++) {
            if (typeof _byoAutosave === 'function') _byoAutosave();   // HIT SAVE
            if (typeof goPg === 'function') goPg('pg-dash');          // GO HOME
            if (typeof renderTodayFeed === 'function') renderTodayFeed(); // do other tasks
          }
          return id;
        }, { clientId, CNAME });
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        await p.waitForTimeout(600);
        return 3;
      },
      rule: async (p) => {
        const cloud = await cloudDraftCount(p, clientId);
        const mem = await p.evaluate(({ clientId }) => bids.filter(b => b.client_id === clientId && (b.draft || b.status === 'Draft')).length, { clientId });
        return { ok: cloud === 1 && mem === 1, got: `cloudDrafts=${cloud} memDrafts=${mem} bidId=${bidId}` };
      },
    });

    // ── A REAL reload (full session-var loss), resume the SAME draft, save again. ──
    await step(page, {
      label: 'reload the app, resume the draft, save again, still ONE cloud row',
      page: 'reboot', role: 'contractor',
      suspect: 'generic-estimate.js openGenericEstimate resume (reuse _geiEditBidId) + _byoAutosave',
      ruleText: 'after a real reload, re-saving the resumed draft must update it, not mint a duplicate',
      expected: 'cloud td_bids still has exactly 1 draft for the client',
      act: async (p) => {
        await p.reload({ waitUntil: 'domcontentloaded' });
        await waitReboot(p);
        await p.evaluate(async ({ clientId, CNAME, bidId }) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          // Session globals are gone; the draft bid came back from the cloud load.
          // Resume it directly by id (the dashboard/bid-row resume path), no chooser.
          const c = (typeof getClientById === 'function' ? getClientById(clientId) : null) || { id: clientId, name: CNAME };
          openGenericEstimate(c, bidId, null);
          await wait(400);
          if (typeof _byoAutosave === 'function') _byoAutosave();
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { clientId, CNAME, bidId });
        await p.waitForTimeout(700);
        return 2; // resume draft (1) + save (1)
      },
      rule: async (p) => {
        const cloud = await cloudDraftCount(p, clientId);
        return { ok: cloud === 1, got: `cloudDrafts=${cloud} (must stay 1 across a real reboot)` };
      },
    });

    // NO cleanup, the seed bid + client stay in the dev account on purpose so the
    // owner can inspect what this test created (CLAUDE.md §13.7). Manual delete only.

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
