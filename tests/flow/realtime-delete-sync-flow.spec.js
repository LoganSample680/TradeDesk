// REAL flow — cross-device Realtime sync of CREATES *and* DELETES, BOTH directions
// (the "make a change on desktop, see it push to mobile, vice versa, and have it
// flow + delete in real time" question). Two pages in ONE browser context model two
// devices signed into the SAME account (the auth token is shared via localStorage),
// neither of which reloads manually. We drive the actual app paths and assert the
// OTHER device reflects each change through Supabase Realtime:
//
//   create = push to bids[]/clients[] + supaSaveToCloud()
//            → upsert → postgres_changes INSERT → _applyRealtimeRecord adds it.
//   delete = _userDelete(remove from bids[]) + supaSaveToCloud()
//            → the concurrency-safe sweep sets deleted_at on that id
//            → postgres_changes UPDATE-with-deleted_at
//            → _applyRealtimeRecord (cloud.js:3392) splices it out on the peer.
//
//   1. A creates → B sees it           (create, A→B)
//   2. A deletes → B removes it         (delete, A→B)   ← "delete in real time"
//   3. B creates → A sees it            (create, B→A — vice versa)
//   4. B deletes → A removes it         (delete, B→A — vice versa)
//
// Every created row is uniquely tagged and (per CLAUDE.md §13.7) the rows that are NOT
// deleted by the test are left in the dev account to inspect; only the extra device
// page is closed (resource cleanup). The whole point of this flow is that the deletes
// DO propagate, so those specific rows are intentionally gone at the end.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'realtime/create-delete-bidirectional';

// Does device `pg` currently have bid `id` in its in-memory bids[]?
const sees = (pg, id) => pg.evaluate((i) => (typeof bids !== 'undefined' ? bids : []).some(b => b.id === i), id);

// Create a tagged bid+client on device `pg` and push it to the cloud (real save path).
async function createBid(pg, id, cid, tag) {
  await pg.evaluate(async ({ id, cid, tag }) => {
    clients.push({ id: cid, name: tag + ' Client', phone: '3165550911', _e2e: 'rtdel' });
    bids.push({ id, client_id: cid, client_name: tag + ' Client', name: tag, amount: 6100, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'rtdel' });
    if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
  }, { id, cid, tag });
}

// Delete a bid on device `pg` exactly as the app does: route the in-memory removal
// through _userDelete so the id is recorded as a deliberate local delete, then save —
// the sweep soft-deletes it (deleted_at) and Realtime carries that to the peer.
async function deleteBidLive(pg, id) {
  await pg.evaluate(async ({ id }) => {
    const remove = () => { const i = bids.findIndex(b => b.id === id); if (i !== -1) bids.splice(i, 1); };
    if (typeof _userDelete === 'function') _userDelete(remove); else remove();
    if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
  }, { id });
}

// Wait for bid `id` to APPEAR (want=true) or DISAPPEAR (want=false) on device `pg`.
async function waitForBid(pg, id, want) {
  return pg.waitForFunction(
    ({ i, w }) => ((typeof bids !== 'undefined' ? bids : []).some(b => b.id === i)) === w,
    { i: id, w: want }, { timeout: 25000 }
  ).then(() => true).catch(() => false);
}

test.describe('realtime cross-device create + delete, both directions (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // Root cause of the old flake (now fixed): the hops waited on _realtimeSubscribed,
  // which flips true when subscribe is CALLED — not when the channel is actually
  // delivering. So a hop could act in the gap before delivery was live and miss the
  // event. cloud.js now exposes _tdRealtimeReady, set only on the channel's SUBSCRIBED
  // confirmation; every device here waits on THAT (a firm wait, no .catch) before any
  // hop — the documented fix, not a widened timeout (§11.1).
  test('a change on device A flows to B and deletes propagate live — and vice versa', async ({ page }) => {
    test.setTimeout(150000);
    const base = Date.now() * 1000 + (process.pid % 1000);
    const aBid = base, aCid = base + 1;          // created+deleted on A
    const bBid = base + 2, bCid = base + 3;      // created+deleted on B (vice versa)
    const TAG = `E2E RTDEL ${process.pid}`;

    // Device A (this page): Realtime must be CONFIRMED live before touching anything.
    await page.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });

    // Device B: a 2nd page in the SAME context auto-signs in from the shared token,
    // boots its own cloud load + Realtime subscription. This is the "other device".
    const B = await page.context().newPage();
    await B.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await B.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
    await B.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
    await B.waitForFunction(() => typeof _tdRealtimeReady !== 'undefined' && _tdRealtimeReady === true, { timeout: 30000 });

    // ── 1. CREATE on A → B sees it (A→B). ──
    await step(page, {
      label: 'device A creates a bid → device B receives it live', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud → postgres_changes INSERT → _applyRealtimeRecord (add)',
      ruleText: 'a bid created on device A must appear on device B via Realtime with no manual reload',
      expected: `device B has bid ${aBid}`,
      act: async (p) => { await createBid(p, aBid, aCid, TAG + ' A'); p.__r = await waitForBid(B, aBid, true); return 1; },
      rule: async (p) => ({ ok: p.__r && (await sees(B, aBid)), got: `B has bid = ${await sees(B, aBid)}` }),
    });

    // ── 2. DELETE on A → B removes it live (A→B). The headline: "delete in real time". ──
    await step(page, {
      label: 'device A deletes the bid → device B removes it live', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _userDelete + sweep (deleted_at) → postgres_changes UPDATE → _applyRealtimeRecord (splice, 3392)',
      ruleText: 'deleting a bid on device A must remove it from device B via Realtime with no manual reload',
      expected: `device B no longer has bid ${aBid}`,
      act: async (p) => { await deleteBidLive(p, aBid); p.__r = await waitForBid(B, aBid, false); return 1; },
      rule: async (p) => ({ ok: p.__r && !(await sees(B, aBid)), got: `B still has bid = ${await sees(B, aBid)}` }),
    });

    // ── 3. CREATE on B → A sees it (B→A — vice versa). ──
    await step(page, {
      label: 'device B creates a bid → device A receives it live (reverse direction)', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud (device B) → postgres_changes INSERT → _applyRealtimeRecord on A',
      ruleText: 'a bid created on device B must appear on device A via Realtime (sync flows both ways)',
      expected: `device A has bid ${bBid}`,
      act: async (p) => { await createBid(B, bBid, bCid, TAG + ' B'); p.__r = await waitForBid(p, bBid, true); return 1; },
      rule: async (p) => ({ ok: p.__r && (await sees(p, bBid)), got: `A has bid = ${await sees(p, bBid)}` }),
    });

    // ── 4. DELETE on B → A removes it live (B→A — vice versa). ──
    await step(page, {
      label: 'device B deletes the bid → device A removes it live (reverse direction)', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js _userDelete + sweep on device B → postgres_changes UPDATE → _applyRealtimeRecord on A (splice)',
      ruleText: 'deleting a bid on device B must remove it from device A via Realtime (deletes flow both ways)',
      expected: `device A no longer has bid ${bBid}`,
      act: async (p) => { await deleteBidLive(B, bBid); p.__r = await waitForBid(p, bBid, false); return 1; },
      rule: async (p) => ({ ok: p.__r && !(await sees(p, bBid)), got: `A still has bid = ${await sees(p, bBid)}` }),
    });

    await B.close().catch(() => {});

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
