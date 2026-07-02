// REAL flow — offline-sync race safety (the "10 workers, some drop offline mid-bid
// and reconnect" question). Each worker is a SEPARATE browser context signed into
// the same account — a real second/third/Nth device. We verify the two invariants
// that make concurrent multi-device editing safe:
//
//   A. CONCURRENT DISTINCT WRITES — N workers each create a uniquely-id'd bid and
//      save at the same time. All N must land in the cloud. Because writes are
//      upserts keyed by (id,user_id), distinct ids never collide and no worker's
//      save clobbers another's row.
//
//   B. OFFLINE-DURING-BID + RECONNECT — Worker B goes offline, creates a bid while
//      offline (its save fails → queued), and meanwhile Worker A (online) creates a
//      different bid. When B reconnects it pushes its own bid WITHOUT deleting A's.
//      This is the crux: supaSaveToCloud only soft-deletes ids in THIS device's
//      _lastKnownIds (cloud.js ~2591) — so B, which never loaded A's bid, can't
//      delete it. After the dust settles BOTH bids must exist in the cloud.
//
// All bids are uniquely tagged and LEFT in the dev account for inspection (§13.7);
// only the worker browser contexts are closed at the end.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'offline-sync/multi-worker-race';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';
const BYPASS = process.env.E2E_BYPASS_SECRET ? { 'X-E2E-Bypass': process.env.E2E_BYPASS_SECRET } : {};
const WORKERS = 4; // representative of "many devices"; the safety mechanism is id-based, so N>2 proves the same invariant

// Spin up one worker = its own browser context (a distinct device) signed in.
async function spawnWorker(browser, idx) {
  const ctx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS, bypassCSP: true });
  const page = await ctx.newPage();
  await signIn(page);
  return { ctx, page, idx };
}

// Have a worker create a tagged bid in memory and push it to the cloud.
async function workerCreatesBid(page, bidId, clientId, label) {
  await page.evaluate(async ({ bidId, clientId, label }) => {
    clients.push({ id: clientId, name: label, _e2e: 'race' });
    bids.push({ id: bidId, client_id: clientId, client_name: label, amount: 5000, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'race' });
    if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
  }, { bidId, clientId, label });
}

// Which of the given bid ids currently exist (not soft-deleted) in the cloud.
async function cloudHasBids(page, ids) {
  return await page.evaluate(async ({ ids }) => {
    const uid = (_supaUser && _supaUser.id) || null;
    const { data } = await _supa.from('td_bids').select('id').eq('user_id', uid).is('deleted_at', null).in('id', ids.map(String));
    const present = new Set((data || []).map(r => String(r.id)));
    return ids.map(id => ({ id, present: present.has(String(id)) }));
  }, { ids });
}

test.describe('offline-sync race safety (multi-device)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // Concurrency-safe sweep (CLAUDE.md §9.8) is now implemented: the cloud save only
  // soft-deletes ids this device EXPLICITLY deleted (recorded via _userDelete at every
  // delete site), never rows merely absent from a snapshot. So N concurrent writers on
  // one account no longer clobber each other. This spec is the permanent guard for it.
  test('concurrent workers + offline/reconnect never clobber each others bids', async ({ page, browser }) => {
    test.setTimeout(120000); // heavy: N full app boots + offline cycle

    const stamp = Date.now() * 1000 + (process.pid % 1000);
    const ids = Array.from({ length: WORKERS }, (_, i) => stamp + i * 7);       // distinct bid ids
    const cids = ids.map(b => b + 100000);
    const allIds = [...ids];

    // Spin up the worker devices in parallel.
    const workers = await Promise.all(Array.from({ length: WORKERS }, (_, i) => spawnWorker(browser, i)));

    // ── A. Concurrent distinct writes — every worker's bid must survive. ──
    await step(page, {
      label: `${WORKERS} workers create distinct bids concurrently`, page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud upsert keyed by (id,user_id)',
      ruleText: 'concurrent saves of distinct bids must ALL land — no worker clobbers another row',
      expected: `all ${WORKERS} bid ids present in cloud td_bids`,
      act: async () => {
        await Promise.all(workers.map((w, i) => workerCreatesBid(w.page, ids[i], cids[i], `E2E Race W${i} ${stamp}`)));
        await page.waitForTimeout(1500); // let all upserts settle
        return WORKERS;
      },
      rule: async (p) => {
        const res = await cloudHasBids(p, ids);
        const missing = res.filter(r => !r.present).map(r => r.id);
        return { ok: missing.length === 0, got: `present=${res.filter(r => r.present).length}/${WORKERS} missing=${JSON.stringify(missing)}` };
      },
    });

    // ── B. One worker offline-during-bid; another creates a bid; reconnect → both live. ──
    const offlineBidId = stamp + 500, offlineCid = offlineBidId + 100000;
    const onlineBidId = stamp + 600, onlineCid = onlineBidId + 100000;
    allIds.push(offlineBidId, onlineBidId);

    await step(page, {
      label: 'worker B offline makes a bid; worker A makes one; B reconnects — neither lost',
      page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _onReconnect + soft-delete guard (_lastKnownIds, ~2591)',
      ruleText: 'a reconnecting offline worker must push its own bid WITHOUT deleting the bid another worker made meanwhile',
      expected: 'both the offline-made bid and the concurrently-made bid exist in cloud',
      act: async () => {
        const A = workers[0], B = workers[1];
        // B drops offline, then creates a bid (its cloud save will fail → queued).
        await B.ctx.setOffline(true);
        await B.page.evaluate(async ({ offlineBidId, offlineCid, stamp }) => {
          clients.push({ id: offlineCid, name: 'E2E Race Boff ' + stamp, _e2e: 'race' });
          bids.push({ id: offlineBidId, client_id: offlineCid, client_name: 'E2E Race Boff ' + stamp, amount: 7000, status: 'Pending', _e2e: 'race' });
          try { localStorage.setItem('zp3_pending_sync', '1'); } catch (e) {}
          if (typeof supaSaveToCloud === 'function') { try { await supaSaveToCloud(); } catch (e) {} }
        }, { offlineBidId, offlineCid, stamp });
        // DELTA guard (FM-5): zero B's upload counter NOW (offline save failed → added 0),
        // so the cumulative count over reconnect + flush below reflects exactly what B
        // pushed. A delta-skip bug would leave B's queued offline bid unsent (count 0).
        await B.page.evaluate(() => { window._deltaStats = { upserts: 0, skips: 0 }; });
        // Meanwhile A (online) creates a different bid and saves it to the cloud.
        await workerCreatesBid(A.page, onlineBidId, onlineCid, 'E2E Race Aon ' + stamp);
        await page.waitForTimeout(800);
        // B comes back online → the app's online watcher fires _onReconnect, which
        // flushes B's queued bid. Give it room, then force a flush as belt-and-braces.
        await B.ctx.setOffline(false);
        await B.page.waitForTimeout(3000);
        await B.page.evaluate(async () => { try { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); } catch (e) {} });
        await page.waitForTimeout(1500);
        // Capture how many rows B actually pushed across the reconnect+flush window.
        page.__bOfflineDelta = await B.page.evaluate(() => (window._deltaStats ? window._deltaStats.upserts : -1));
        return 3;
      },
      rule: async (p) => {
        const res = await cloudHasBids(p, [offlineBidId, onlineBidId]);
        const off = res.find(r => String(r.id) === String(offlineBidId));
        const on = res.find(r => String(r.id) === String(onlineBidId));
        const bPushed = p.__bOfflineDelta;
        const ok = !!off?.present && !!on?.present && bPushed >= 1;
        if (ok) return { ok, got: `offlineBid=${off.present} onlineBid=${on.present} bDeltaUpserts=${bPushed}` };
        // DIAGNOSE the miss: is the bid in B's memory? what does its RAW cloud row show
        // (absent vs deleted_at vs archived_at)? is its id caught in a removal set?
        const B = workers[1];
        const diag = await B.page.evaluate(async ({ id }) => {
          let raw = null;
          try {
            const { data } = await _supa.from('td_bids').select('id,deleted_at,archived_at').eq('user_id', _supaUser.id).eq('id', String(id)).maybeSingle();
            raw = data ? { exists: true, del: !!data.deleted_at, arch: !!data.archived_at } : { exists: false };
          } catch (e) { raw = { err: e.message }; }
          const pend = [];
          try { for (const o of (await (window._opDbUnsynced ? _opDbUnsynced() : [])) || []) if (o && o.fields && o.fields.id !== undefined && String(o.rowId) === String(id)) pend.push(o.owner); } catch (e) {}
          return {
            inMemory: (typeof bids !== 'undefined' ? bids : []).some(b => String(b.id) === String(id)),
            raw,
            locallyDeleted: !!(typeof _locallyDeletedIds !== 'undefined' && _locallyDeletedIds.td_bids && _locallyDeletedIds.td_bids.has(String(id))),
            lastLoadDeleted: !!(typeof _lastLoadDeletes !== 'undefined' && _lastLoadDeletes.td_bids && _lastLoadDeletes.td_bids.has(String(id))),
            pendingCreateOwners: pend,
            oplogOn: !!window._opLogShadow,
          };
        }, { id: offlineBidId });
        return { ok, got: `offlineBid=${off?.present} onlineBid=${on?.present} bDeltaUpserts=${bPushed} — Bmem=${diag.inMemory} cloudRaw=${JSON.stringify(diag.raw)} locDel=${diag.locallyDeleted} lastLoadDel=${diag.lastLoadDeleted} pendCreate=${JSON.stringify(diag.pendingCreateOwners)} oplog=${diag.oplogOn}` };
      },
    });

    // NO data cleanup — every bid + client this test created stays in the dev account
    // on purpose so the owner can inspect the multi-worker race outcome firsthand
    // (CLAUDE.md §13.7). Only the worker contexts are closed (resource cleanup).
    await Promise.all(workers.map(w => w.ctx.close().catch(() => {})));

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
