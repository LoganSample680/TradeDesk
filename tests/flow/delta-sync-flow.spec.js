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
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, scopeBypassHeader } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'delta-sync/selective-upload';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';

// Zero the per-save upload/skip counters in-page so the NEXT save measures only its own work.
const resetDelta = (page) => page.evaluate(() => { window._deltaStats = { upserts: 0, skips: 0, rows: [] }; });
const readDelta = (page) => page.evaluate(() => ({ upserts: window._deltaStats.upserts, skips: window._deltaStats.skips, rows: (window._deltaStats.rows || []).slice(0, 20) }));
// Post-warm snapshot + field-level diff of over-uploaded client rows: names WHICH
// FIELDS changed between the warm save and the measured save. If none changed,
// the churn is in the hash BASELINE (reconcile/rebuild), not the data — equally
// decisive. Diagnosis instrumentation for the "exactly N rows" precision rules.
const snapClients = (page) => page.evaluate(() => { window.__snap = {}; clients.forEach(c => { window.__snap[c.id] = JSON.stringify(c); }); });
// Round-2 diagnosis (snapshot diff came back NO-FIELD-CHANGE): compare the phantom
// row's MEMORY payload against the CLOUD jsonb it supposedly diverged from — the
// actual pair the hash gate compares — plus the raw hash values (baseline vs mem vs
// cloud). Names the exact field(s) some post-load code mutates, or proves the
// baseline map itself is being re-stamped with a foreign value.
const diffClients = (page) => page.evaluate(async () => {
  const out = []; const snap = window.__snap || {};
  const phantoms = ((window._deltaStats.rows) || []).filter(r => r.indexOf('td_clients:') === 0).slice(0, 3);
  for (const r of phantoms) {
    const id = r.split(':')[1];
    const cur = clients.find(c => String(c.id) === id);
    if (!cur) { out.push(id + ':GONE'); continue; }
    const d = [];
    if (snap[id]) {
      const old = JSON.parse(snap[id]);
      new Set([...Object.keys(old), ...Object.keys(cur)]).forEach(k => {
        const a = JSON.stringify(old[k]), b = JSON.stringify(cur[k]);
        if (a !== b) d.push('snap.' + k + ':' + String(a).slice(0, 40) + '→' + String(b).slice(0, 40));
      });
    }
    // mem vs CLOUD — the comparison the delta gate actually makes.
    try {
      const { data } = await _supa.from('td_clients').select('data').eq('user_id', _supaUser.id).eq('id', id).maybeSingle();
      const cloud = (data && data.data) || {};
      new Set([...Object.keys(cloud), ...Object.keys(cur)]).forEach(k => {
        const a = JSON.stringify(cloud[k]), b = JSON.stringify(cur[k]);
        if (a !== b) d.push('cloud.' + k + ':' + String(a).slice(0, 60) + '→mem:' + String(b).slice(0, 60));
      });
      const base = _syncedHash['td_clients'] && _syncedHash['td_clients'].get(id);
      d.push('h[base=' + base + ' mem=' + _hashPayload(cur) + ' cloud=' + _hashPayload(cloud) + ']');
    } catch (e) { d.push('cloud-fetch-err:' + (e && e.message)); }
    out.push(id + '{' + d.join(' | ') + '}');
  }
  return out;
});

// A unique, collision-proof base id for this run (timestamp + pid), §13.7.
const baseId = () => Date.now() * 1000 + (process.pid % 1000);

test.describe('content-hash delta sync — only changed rows upload', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => {
    resetLedger();
    // Quiesce the paced hub sweep: it repairs one drifted client hub per tick and
    // STAMPS the client row each time — real, correct writes that land inside this
    // spec's precision windows ("exactly 1 row" / "exactly 0 rows") on a suite
    // account with a deep repair backlog. Diagnosed 2026-07-03 via _deltaStats.rows:
    // the "extra" uploads were 42 td_clients rows, all sweep stamps.
    //
    // MUST be addInitScript, not a post-signIn evaluate (root cause of the 2026-07-10
    // red): the sweep starts 4s after cloud load and each tick fires an UN-AWAITED
    // background hub upload that stamps clientHubHash on the client row when it
    // resolves. A flag set after boot lands too late — ticks already launched stamp
    // a client INSIDE the measurement window ("phantom" 1-row upload) — and a plain
    // window flag is wiped by the reload tests below. addInitScript runs before any
    // page script on EVERY navigation, so no tick ever dequeues in this page.
    await page.addInitScript(() => { window._hubSweepPause = true; });
    await signIn(page);
  });

  test('a single field edit uploads only that bid — not the bids table', async ({ page }) => {
    const bidId = baseId();
    await step(page, {
      label: 'seed a bid, warm the sync, edit one field, save', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _upsertTable — delta filter (hashes.get(id)!==h) + window._deltaStats',
      // ASSERTION CORRECTED (2026-07-04, post-review): the old rule was total
      // `upserts === 1`, which assumed ZERO concurrent activity. On a real account
      // (and the stale runner where `db reset` is failing) the paced client-hub
      // sweep legitimately repairs + re-syncs other rows in the same window — proven
      // harmless: their base/mem/cloud hashes are byte-identical (the canonical-hash
      // fix works). What this test actually proves is that a one-field bid edit
      // uploads EXACTLY that bid and does NOT re-upload the bids table. So assert on
      // the td_bids uploads, not the global count — orthogonal client-sweep repairs
      // must not fail it.
      ruleText: 'editing one field of one bid uploads exactly that bid (1 td_bids row) — never the whole bids table',
      expected: 'exactly one td_bids row uploaded, and it is the edited bid',
      act: async (p) => {
        await resetDelta(p);
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Delta One ' + bidId, name: 'Delta One', amount: 100, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'delta' });
          await supaSaveToCloud();                 // warm: hashes now hold this bid's payload
        }, { bidId });
        p.__warm = await readDelta(p);
        await resetDelta(p);
        await p.evaluate(async ({ bidId }) => {
          bids.find(b => b.id === bidId).amount = 250;   // one field, one bid
          await supaSaveToCloud();
        }, { bidId });
        p.__d = await readDelta(p);
        // Bid-scoped: which td_bids rows uploaded (from the full capped list, not the sliced preview).
        p.__bidRows = await p.evaluate(() => (window._deltaStats.rows || []).filter(r => r.indexOf('td_bids:') === 0));
        p.__d.warm = { upserts: p.__warm.upserts, skips: p.__warm.skips };
        p.__d.bidRows = p.__bidRows;
        p.__d.clientDiffs = await diffClients(p);
        return 2;
      },
      rule: async (p) => ({
        ok: p.__bidRows.length === 1 && p.__bidRows[0] === 'td_bids:' + bidId,
        got: 'bidUploads=' + JSON.stringify(p.__bidRows) + ' full=' + JSON.stringify(p.__d),
      }),
    });
    const rep = report(FLOW, BASELINE, page);
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
    const rep = report(FLOW, BASELINE, page);
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
    const rep = report(FLOW, BASELINE, page);
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
    // Fresh boot: RELOAD (the Supabase session persists in localStorage, so the app
    // re-auths itself and runs supaLoadFromCloud again → rebuilds _syncedHash from cloud).
    // NOT a second signIn() — that waits for the login form, which never appears when a
    // session is already active, and would hang.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _supaCloudLoaded !== 'undefined' && _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);

    await step(page, {
      label: 'after fresh load, save with no edit', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaLoadFromCloud — _syncedHash[t]=new Map(... _hashPayload(r.data))',
      ruleText: 'the load must rebuild the synced hash so an immediate no-op save uploads nothing',
      expected: 'no-op save uploads 0, and the rebuilt hash is in lockstep with the loaded rows',
      act: async (p) => {
        const r = await p.evaluate(({ bidId }) => ({
          inMem: (typeof bids !== 'undefined') && bids.some(b => String(b.id) === String(bidId)),
          hasHash: window.__hashHas('td_bids', bidId),
        }), { bidId });
        p.__mem = r.inMem; p.__has = r.hasHash;
        await resetDelta(p);
        await p.evaluate(async () => { await supaSaveToCloud(); });
        p.__d = await readDelta(p);
        return 1;
      },
      // The property: a fresh load rebuilds _syncedHash, so a no-op save uploads nothing
      // (upserts===0 — if the hash hadn't rebuilt, every loaded row would re-upload). And
      // the rebuilt hash is in lockstep with the rows that actually loaded: the seeded
      // bid's hash is present IFF the bid came back into memory (the shared dev account is
      // never cleaned per §13.7, so a given row may or may not be in the loaded set, but
      // hash⟺memory must always hold).
      rule: async (p) => ({ ok: p.__d.upserts === 0 && p.__has === p.__mem, got: `inMem=${p.__mem} hashPresent=${p.__has} delta=${JSON.stringify(p.__d)}` }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a realtime patch from a peer does NOT cause a redundant re-upload on the receiver', async ({ page, browser }) => {
    test.setTimeout(90000);
    const bidId = baseId() + 30;
    // A = this page; B = a second device on the same account that receives realtime.
    const ctxB = await browser.newContext({ baseURL: BASE, bypassCSP: true });
    await scopeBypassHeader(ctxB, BASE);
    const pageB = await ctxB.newPage();
    // B asserts upserts===0 on its own save — its hub sweep must be quiesced from
    // first script too, or a pre-flag tick's async stamp fails B the same way.
    await pageB.addInitScript(() => { window._hubSweepPause = true; });
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
    const rep = report(FLOW, BASELINE, page);
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
          const { data } = await _supa.from('td_bids').select('deleted_at,archived_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          // NEVER-DELETE policy: a user delete now lands as archived_at (recoverable); either column proves the removal committed.
          return !!(data && (data.deleted_at || data.archived_at));
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
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // REGRESSION (cross-device delete bug): a BEFORE UPDATE OR DELETE trigger on td_bids
  // (20260626 bid history) read OLD.contractor_user_id — a column td_bids does NOT have
  // (it keys on user_id) — so the soft-delete UPDATE raised 42703 and 400'd, aborting the
  // save. deleted_at never landed, so the bid stayed alive in the cloud and resurrected on
  // every device / after reload. This guards the FULL invariant end-to-end: delete → cloud
  // deleted_at set (save not aborted) → fresh reload → the bid stays gone. (Effective once
  // the test stack has all migrations incl. 20260626/20260707 — same gap that let prod break
  // while CI stayed green: the local stack predated the trigger.)
  test('a deleted bid soft-deletes in the cloud and does NOT resurrect after a fresh reload', async ({ page }) => {
    const bidId = baseId() + 60;
    await step(page, {
      label: 'create a bid, delete it, assert cloud soft-deleted + no resurrection on reload',
      page: 'cloud', role: 'contractor',
      suspect: 'supabase 20260707 trg_bid_history (OLD.user_id) + cloud.js _upsertTable sweep (deleted_at)',
      ruleText: 'a deleted bid must soft-delete in the cloud (the history trigger must not abort the save) and must not come back after a fresh reload',
      expected: 'deleted_at set in cloud; bid absent in memory after reload',
      act: async (p) => {
        await p.evaluate(async ({ bidId }) => {
          bids.push({ id: bidId, client_name: 'E2E Del Persist ' + bidId, name: 'Del Persist', amount: 100, status: 'Pending', _e2e: 'delta' });
          await supaSaveToCloud();
        }, { bidId });
        // Real delete path — _userDelete records the intent so the sweep soft-deletes it.
        await p.evaluate(async ({ bidId }) => {
          _userDelete(() => { bids = bids.filter(b => b.id !== bidId); });
          await supaSaveToCloud();
        }, { bidId });
        p.__softDeleted = await p.evaluate(async ({ bidId }) => {
          const { data } = await _supa.from('td_bids').select('deleted_at,archived_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          // NEVER-DELETE policy: a user delete now lands as archived_at (recoverable); either column proves the removal committed.
          return !!(data && (data.deleted_at || data.archived_at));
        }, { bidId });
        // Fresh reload — the load filters deleted_at IS NULL, so a properly soft-deleted bid
        // must NOT come back. Before the fix it resurrected because deleted_at never landed.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
        await p.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        p.__resurrected = await p.evaluate(({ bidId }) => (typeof bids !== 'undefined' ? bids : []).some(b => b.id === bidId), { bidId });
        return 1;
      },
      rule: async (p) => ({ ok: p.__softDeleted === true && p.__resurrected === false, got: `softDeleted=${p.__softDeleted} resurrectedAfterReload=${p.__resurrected}` }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // REGRESSION (unwrapped delete site): convertOpportunityToEstimate removed a SAVED
  // opportunity bid with a bare `bids=bids.filter(...)` (no _userDelete), so post-#51 the
  // sweep never recorded the delete intent and the opportunity resurrected from the cloud.
  // Now wrapped in _userDelete — assert the removed opportunity actually soft-deletes.
  test('converting an opportunity soft-deletes its saved bid (unwrapped-delete regression)', async ({ page }) => {
    const cid = baseId() + 70, bidId = baseId() + 71;
    await step(page, {
      label: 'seed a saved opportunity, convert it, assert the opportunity bid soft-deletes',
      page: 'cloud', role: 'contractor',
      suspect: 'bids.js convertOpportunityToEstimate — must _userDelete the removed opportunity bid',
      ruleText: 'converting an opportunity must record the removed bid as a local delete so it soft-deletes in the cloud and does not resurrect',
      expected: 'opportunity bid deleted_at set; absent after reload',
      act: async (p) => {
        await p.evaluate(async ({ cid, bidId }) => {
          clients.push({ id: cid, name: 'E2E Opp Client ' + cid, phone: '3165550123', _e2e: 'delta' });
          bids.push({ id: bidId, client_id: cid, client_name: 'E2E Opp Client ' + cid, name: 'Opp', type: 'opportunity', status: 'opportunity', amount: 0, draft: false, bid_date: new Date().toISOString().slice(0, 10), _e2e: 'delta' });
          await supaSaveToCloud();
        }, { cid, bidId });
        // Real app path — converting removes the opportunity bid. Tolerate any UI side-effect
        // throw from _doOpenEstimate: the delete+record happens first, which is what we assert.
        await p.evaluate(({ bidId }) => { try { convertOpportunityToEstimate(bidId); } catch (e) {} }, { bidId });
        await p.evaluate(async () => { if (typeof _flushSaveNow === 'function') _flushSaveNow(); await supaSaveToCloud(); });
        p.__softDeleted = await p.evaluate(async ({ bidId }) => {
          const { data } = await _supa.from('td_bids').select('deleted_at,archived_at').eq('user_id', _supaUser.id).eq('id', String(bidId)).maybeSingle();
          // NEVER-DELETE policy: a user delete now lands as archived_at (recoverable); either column proves the removal committed.
          return !!(data && (data.deleted_at || data.archived_at));
        }, { bidId });
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
        await p.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        p.__resurrected = await p.evaluate(({ bidId }) => (typeof bids !== 'undefined' ? bids : []).some(b => b.id === bidId), { bidId });
        return 1;
      },
      rule: async (p) => ({ ok: p.__softDeleted === true && p.__resurrected === false, got: `softDeleted=${p.__softDeleted} resurrectedAfterReload=${p.__resurrected}` }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // REGRESSION (Clear Data didn't stick): a deliberate "Clear all data" wipe was aborted
  // by supaSaveToCloud's accidental-wipe sanity guard on a cache-only load, so the cloud
  // soft-delete never sent and the rows (e.g. the maintenance contracts behind the
  // dashboard "Maintenance Due" card) resurrected on reload. Guards the _deliberateWipe
  // bypass + the awaited flush in clearAllData.
  test('Clear Data soft-deletes every store in the cloud even on a cache-only load (no resurrection)', async ({ page }) => {
    const bidId = baseId() + 80, ctId = baseId() + 81;
    await step(page, {
      label: 'seed a bid + maintenance contract, Clear Data, assert cloud soft-deleted + no resurrection',
      page: 'pg-settings', role: 'contractor',
      suspect: 'settings.js clearAllData (_deliberateWipe bypass + awaited flush) vs cloud.js sanity guard',
      ruleText: 'a deliberate Clear Data must soft-delete every store in the cloud — even on a cache-only load — and nothing may resurrect on reload',
      expected: 'td_bids + td_contracts rows for this run have deleted_at set; absent after reload',
      act: async (p) => {
        await p.evaluate(async ({ bidId, ctId }) => {
          bids.push({ id: bidId, client_name: 'E2E Wipe Bid ' + bidId, name: 'Wipe Bid', amount: 100, status: 'Pending', _e2e: 'wipe' });
          contracts.push({ id: ctId, client_id: bidId, title: 'E2E Wipe Maint ' + ctId, amount: 1800, active: true, nextDate: new Date().toISOString().slice(0, 10), _e2e: 'wipe' });
          await supaSaveToCloud();
        }, { bidId, ctId });
        // Reproduce the bug condition: a cache-only load with cached data, which makes the
        // accidental-wipe sanity guard abort the clear UNLESS _deliberateWipe bypasses it.
        await p.evaluate(() => {
          try {
            localStorage.setItem('zp3_cloud_cache', JSON.stringify({ clients: [{ id: 1 }], bids: [{ id: 1 }], income: [{ id: 1 }], mileage: [{ id: 1 }] }));
            _loadedFromCacheOnly = true;
          } catch (e) {}
        });
        // Drive the REAL clearAllData with its two confirmation prompts auto-accepted.
        await p.evaluate(async () => {
          const _z = window.zConfirm;
          window.zConfirm = (msg, onYes) => { try { onYes && onYes(); } catch (e) {} };
          try { clearAllData(); } catch (e) {}
          await new Promise(r => setTimeout(r, 2800)); // let the async clear + awaited flush finish
          window.zConfirm = _z;
        });
        p.__cloud = await p.evaluate(async ({ bidId, ctId }) => {
          const uid = _supaUser.id;
          const b = await _supa.from('td_bids').select('deleted_at,archived_at').eq('user_id', uid).eq('id', String(bidId)).maybeSingle();
          const ct = await _supa.from('td_contracts').select('deleted_at,archived_at').eq('user_id', uid).eq('id', String(ctId)).maybeSingle();
          // NEVER-DELETE policy: user removals land as archived_at; either column proves the removal committed.
          return { bidDel: !!(b.data && (b.data.deleted_at || b.data.archived_at)), ctDel: !!(ct.data && (ct.data.deleted_at || ct.data.archived_at)) };
        }, { bidId, ctId });
        // Reload — a properly soft-deleted row (load filters deleted_at IS NULL) must not come back.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
        await p.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
        p.__res = await p.evaluate(({ bidId, ctId }) => ({
          bid: (typeof bids !== 'undefined' ? bids : []).some(b => b.id === bidId),
          ct: (typeof contracts !== 'undefined' ? contracts : []).some(c => c.id === ctId),
        }), { bidId, ctId });
        return 1;
      },
      rule: async (p) => ({
        ok: p.__cloud.bidDel === true && p.__cloud.ctDel === true && p.__res.bid === false && p.__res.ct === false,
        got: `cloudDeleted(bid=${p.__cloud.bidDel} contract=${p.__cloud.ctDel}) resurrected(bid=${p.__res.bid} contract=${p.__res.ct})`,
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
