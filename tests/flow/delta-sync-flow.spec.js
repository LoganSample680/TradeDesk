// REAL flow — CONTENT-HASH DELTA SYNC (the scaling fix). Proves the cloud save only
// uploads rows that ACTUALLY changed since the last sync, instead of re-upserting the
// whole account on every save. Every save pass increments window._deltaStats.upserts by
// the number of rows it actually sent (and .skips by the number it skipped because their
// content hash was unchanged) — so each assertion below counts real uploads, end-to-end,
// driving the real app against real Supabase.
//
// The invariants (and the failure-mode they guard):
//   1. single edit            → exactly 1 upload          (selective: not the whole table)
//   2. no-op save             → 0 uploads, updated_at frozen (nothing written at all)
//   3. edit 2 of 5 + add 1    → exactly 3 uploads, all 6 correct in cloud (FM-5: nothing skipped)
//   4. fresh load             → hash warmed from cloud → next no-op save is 0 (load rebuild)
//   5. realtime peer patch    → receiver does NOT re-upload the peer's value (FM-4: no echo)
//   6. delete then re-create  → swept id's hash is cleared → re-create re-uploads (FM-10)
//
// All seed data is uniquely tagged and LEFT in the dev account (§13.7); only worker
// browser contexts are closed (resource cleanup).
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'delta-sync/selective-upload';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';
const BYPASS = process.env.E2E_BYPASS_SECRET ? { 'X-E2E-Bypass': process.env.E2E_BYPASS_SECRET } : {};

// Zero the per-save upload/skip counters in-page so the NEXT save measures only its own work.
const resetDelta = (page) => page.evaluate(() => { window._deltaStats = { upserts: 0, skips: 0 }; });
const readDelta = (page) => page.evaluate(() => ({ upserts: window._deltaStats.upserts, skips: window._deltaStats.skips }));

// A unique, collision-proof base id for this run (timestamp + pid), §13.7.
const baseId = () => Date.now() * 1000 + (process.pid % 1000);

test.describe('content-hash delta sync — only changed rows upload', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a single field edit uploads exactly ONE row', async ({ page }) => {
    const bidId = baseId();
    await step(page, {
      label: 'seed a bid, warm the sync, edit one field, save', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _upsertTable — delta filter (hashes.get(id)!==h) + window._deltaStats',
      ruleText: 'after a warm save, changing one field of one bid must upload exactly 1 row — not the table',
      expected: '_deltaStats.upserts === 1',
      act: async (p) => {
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Delta One ' + bidId, name: 'Delta One', amount: 100, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'delta' });
          await supaSaveToCloud();                 // warm: hashes now hold this bid's payload
        }, { bidId });
        await resetDelta(p);
        await p.evaluate(async ({ bidId }) => {
          bids.find(b => b.id === bidId).amount = 250;   // one field, one row
          await supaSaveToCloud();
        }, { bidId });
        p.__d = await readDelta(p);
        return 2;
      },
      rule: async (p) => ({ ok: p.__d.upserts === 1, got: JSON.stringify(p.__d) }),
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a no-op save uploads ZERO rows and does not advance updated_at', async ({ page }) => {
    const bidId = baseId() + 1;
    await step(page, {
      label: 'seed + warm, then save again with no change', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _upsertTable — unchanged rows are skipped, never re-upserted',
      ruleText: 'saving with nothing changed must upload 0 rows AND leave the cloud row updated_at untouched',
      expected: '_deltaStats.upserts === 0 and updated_at unchanged',
      act: async (p) => {
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Delta Noop ' + bidId, name: 'Delta Noop', amount: 100, status: 'Pending', _e2e: 'delta' });
          await supaSaveToCloud();
        }, { bidId });
        p.__before = await p.evaluate(async ({ bidId }) => {
          const { data } = await _supa.from('td_bids').select('updated_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          return data ? data.updated_at : null;
        }, { bidId });
        await resetDelta(p);
        await p.evaluate(async () => { await supaSaveToCloud(); });   // no mutation
        p.__d = await readDelta(p);
        p.__after = await p.evaluate(async ({ bidId }) => {
          const { data } = await _supa.from('td_bids').select('updated_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          return data ? data.updated_at : null;
        }, { bidId });
        return 1;
      },
      // updated_at frozen proves nothing was WRITTEN, not merely that the counter says 0.
      rule: async (p) => ({ ok: p.__d.upserts === 0 && p.__before && p.__after && p.__before === p.__after, got: `delta=${JSON.stringify(p.__d)} before=${p.__before} after=${p.__after}` }),
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('editing 2 of 5 bids and adding 1 uploads exactly 3 rows, all 6 correct in cloud', async ({ page }) => {
    const base = baseId() + 10;
    const ids = [0, 1, 2, 3, 4].map(i => base + i);
    const newId = base + 5;
    await step(page, {
      label: 'seed 5, warm, edit 2 + add 1, save', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _upsertTable — delta uploads only the changed/new rows (FM-5)',
      ruleText: 'after warming 5 bids, editing 2 and adding 1 must upload exactly 3 — and all 6 must be correct in cloud',
      expected: '_deltaStats.upserts === 3; 3 untouched unchanged, 2 carry edits, 1 new present',
      act: async (p) => {
        await p.evaluate(async ({ ids }) => {
          ids.forEach((id, i) => bids.push({ id, client_name: 'E2E Delta5 ' + id, name: 'Delta5 #' + i, amount: 100 + i, status: 'Pending', _e2e: 'delta' }));
          await supaSaveToCloud();
        }, { ids });
        await resetDelta(p);
        await p.evaluate(async ({ ids, newId }) => {
          bids.find(b => b.id === ids[1]).amount = 9991;       // edit #1
          bids.find(b => b.id === ids[3]).status = 'Won';      // edit #2
          bids.push({ id: newId, client_name: 'E2E Delta5 new ' + newId, name: 'Delta5 new', amount: 777, status: 'Pending', _e2e: 'delta' }); // add
          await supaSaveToCloud();
        }, { ids, newId });
        p.__d = await readDelta(p);
        return 3;
      },
      rule: async (p) => {
        const cloud = await p.evaluate(async ({ ids, newId }) => {
          const { data } = await _supa.from('td_bids').select('id,data').eq('user_id', _supaUser.id).is('deleted_at', null).in('id', [...ids, newId].map(String));
          const m = {}; (data || []).forEach(r => { m[String(r.id)] = r.data; });
          return m;
        }, { ids, newId });
        const g = (id) => cloud[String(id)];
        const ok = p.__d.upserts === 3
          && g(ids[0])?.amount === 100 && g(ids[2])?.amount === 102 && g(ids[4])?.amount === 104  // untouched
          && g(ids[1])?.amount === 9991 && g(ids[3])?.status === 'Won'                              // edited
          && !!g(newId);                                                                            // new present
        return { ok, got: `delta=${JSON.stringify(p.__d)} cloudCount=${Object.keys(cloud).length}/6` };
      },
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a fresh load rebuilds the hash from cloud so the next no-op save is zero', async ({ page }) => {
    const bidId = baseId() + 20;
    // Seed + save so the bid exists in cloud, then RELOAD the page so the only thing that
    // can have warmed the hash is the load-side rebuild (not a prior in-session save).
    await page.evaluate(async ({ bidId }) => {
      bids.push({ id: bidId, client_name: 'E2E Delta Load ' + bidId, name: 'Delta Load', amount: 100, status: 'Pending', _e2e: 'delta' });
      await supaSaveToCloud();
    }, { bidId });
    await signIn(page);   // fresh boot → supaLoadFromCloud rebuilds _syncedHash from cloud rows
    await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});

    await step(page, {
      label: 'after fresh load, save with no edit', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud — _syncedHash[t]=new Map(... _hashPayload(r.data))',
      ruleText: 'the load must rebuild the synced hash so an immediate no-op save uploads nothing',
      expected: 'hash present for the loaded bid, and _deltaStats.upserts === 0',
      act: async (p) => {
        p.__has = await p.evaluate(({ bidId }) => window.__hashHas('td_bids', bidId), { bidId });
        await resetDelta(p);
        await p.evaluate(async () => { await supaSaveToCloud(); });
        p.__d = await readDelta(p);
        return 1;
      },
      rule: async (p) => ({ ok: p.__has === true && p.__d.upserts === 0, got: `hashPresent=${p.__has} delta=${JSON.stringify(p.__d)}` }),
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a realtime patch from a peer does NOT cause a redundant re-upload on the receiver', async ({ page, browser }) => {
    test.setTimeout(90000);
    const bidId = baseId() + 30;
    // A = this page; B = a second device on the same account that receives realtime.
    const ctxB = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS, bypassCSP: true });
    const pageB = await ctxB.newPage();
    await signIn(pageB);
    await pageB.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});

    try {
      await step(page, {
        label: 'A creates+edits a bid; B receives it via realtime; B saves', page: 'cloud', role: 'contractor',
        suspect: 'cloud.js _applyRealtimeRecord — patch/insert update _syncedHash so no echo re-upload',
        ruleText: 'a row B learned from a peer (realtime) must not be re-uploaded by B on its next save',
        expected: 'B sees the bid, then B._deltaStats.upserts === 0',
        act: async (p) => {
          // A creates the bid and saves → B should receive it via postgres_changes.
          await p.evaluate(async ({ bidId }) => {
            bids.push({ id: bidId, client_name: 'E2E Delta RT ' + bidId, name: 'Delta RT', amount: 4242, status: 'Pending', _e2e: 'delta' });
            await supaSaveToCloud();
          }, { bidId });
          // Wait (bounded) for B's memory to reflect the peer's row.
          await pageB.waitForFunction(({ bidId }) => (typeof bids !== 'undefined') && bids.some(b => String(b.id) === String(bidId) && b.amount === 4242), { bidId }, { timeout: 30000 }).catch(() => {});
          p.__bGot = await pageB.evaluate(({ bidId }) => bids.some(b => String(b.id) === String(bidId) && b.amount === 4242), { bidId });
          // Now B saves with NO local change. The peer's row carried its hash into B's
          // _syncedHash, so B must upload 0 for it.
          await resetDelta(pageB);
          await pageB.evaluate(async () => { await supaSaveToCloud(); });
          p.__dB = await readDelta(pageB);
          return 1;
        },
        rule: async (p) => ({ ok: p.__bGot === true && p.__dB.upserts === 0, got: `bReceived=${p.__bGot} bDelta=${JSON.stringify(p.__dB)}` }),
      });
    } finally {
      await ctxB.close().catch(() => {});
    }
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('deleting a bid clears its hash so re-creating the same id re-uploads', async ({ page }) => {
    const bidId = baseId() + 40;
    await step(page, {
      label: 'seed+warm, delete (sweep), then re-create same id', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _upsertTable sweep — hashes.delete(id) on soft-delete (FM-10)',
      ruleText: 'after a swept delete the hash must be gone, so re-creating that id uploads it again',
      expected: 'hash absent after delete; re-create → _deltaStats.upserts === 1',
      act: async (p) => {
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Delta Del ' + bidId, name: 'Delta Del', amount: 100, status: 'Pending', _e2e: 'delta' });
          await supaSaveToCloud();
        }, { bidId });
        // Real delete path: _userDelete records the local delete so the sweep soft-deletes it.
        await p.evaluate(async ({ bidId }) => {
          _userDelete(() => { bids = bids.filter(b => b.id !== bidId); });
          await supaSaveToCloud();
        }, { bidId });
        p.__hasAfterDel = await p.evaluate(({ bidId }) => window.__hashHas('td_bids', bidId), { bidId });
        p.__softDeleted = await p.evaluate(async ({ bidId }) => {
          const { data } = await _supa.from('td_bids').select('deleted_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          return !!(data && data.deleted_at);
        }, { bidId });
        // Re-create the SAME id and save — must upload because the hash was cleared.
        await resetDelta(p);
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Delta Re ' + bidId, name: 'Delta Re', amount: 500, status: 'Pending', _e2e: 'delta' });
          await supaSaveToCloud();
        }, { bidId });
        p.__d = await readDelta(p);
        return 2;
      },
      rule: async (p) => ({ ok: p.__hasAfterDel === false && p.__softDeleted === true && p.__d.upserts === 1, got: `hashAfterDel=${p.__hasAfterDel} softDeleted=${p.__softDeleted} reDelta=${JSON.stringify(p.__d)}` }),
    });
    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
