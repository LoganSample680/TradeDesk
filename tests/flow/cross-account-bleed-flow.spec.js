// REAL flow — CROSS-ACCOUNT BLEED regression guard (bug #39). Reproduces the
// production leak where account A's bid ("Adam Ryder") crossed into account B on
// the same device. Root cause: the offline-pending blob / cache can be stamped
// `_owner: null` in a force-quit / cache-restore window, and _readOwnedOfflinePending()
// only rejects a blob whose `_owner` is set AND differs from the signed-in user —
// so a NULL owner slips the check and gets ADOPTED into whatever account signs in
// next, then _flushSaveNow writes it into THAT account's cloud. Permanent bleed.
//
// This test forges the exact artifact (a null-owner blob carrying account A's bid)
// while signed in as account B, then runs the REAL guard the merge path uses
// (_readOwnedOfflinePending) and asserts B never adopts A's record — in memory or
// in B's cloud td_bids.
//
//   EXPECTED: FAILS on today's code (proof of the bug). PASSES once the null-owner
//   hole is closed. This is the permanent guard so it can never come back a 3rd time.
//
// REQUIRES A SECOND DEV ACCOUNT — set these GitHub Actions secrets to a second,
// real Supabase auth user (a different contractor login):
//   E2E_DEV2_EMAIL, E2E_DEV2_PASSWORD, E2E_DEV2_USER_ID
// Soft-skips cleanly until they're configured.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds } = require('./live-helpers');

const A = { email: process.env.E2E_DEV_EMAIL || '', password: process.env.E2E_DEV_PASSWORD || '', uid: process.env.E2E_DEV_USER_ID || '' };
const B = { email: process.env.E2E_DEV2_EMAIL || '', password: process.env.E2E_DEV2_PASSWORD || '', uid: process.env.E2E_DEV2_USER_ID || '' };
const haveTwoAccounts = !!(A.email && A.password && A.uid && B.email && B.password && B.uid);

// Sign in as a SPECIFIC account (generalizes live-helpers.signIn). Reloads first so
// the previous account's JS globals are gone — exactly like reopening the app.
async function signInAs(page, acct) {
  await page.goto('/');
  await page.waitForSelector('#supa-email', { timeout: 30000 });
  const res = await page.evaluate(async ({ email, password }) => {
    if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized' };
    try {
      const { data, error } = await _supa.auth.signInWithPassword({ email, password });
      return { ok: !error, why: error ? error.message : null, session: !!(data && data.session) };
    } catch (e) { return { ok: false, why: 'exception: ' + (e && e.message) }; }
  }, acct);
  if (!res.ok) throw new Error(`sign-in failed for ${acct.email}: ${res.why}`);
  await page.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
  await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
}

test.describe('cross-account bleed isolation (bug #39)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');
  test.skip(!haveTwoAccounts, 'needs a SECOND dev account — set E2E_DEV2_EMAIL / E2E_DEV2_PASSWORD / E2E_DEV2_USER_ID');

  test("account A's data can never be adopted into account B on the same device", async ({ page }) => {
    test.setTimeout(120000);
    const bidId = Date.now() * 1000 + (process.pid % 1000);
    const clientId = bidId + 1;
    const MARK = `BLEED-GUARD ${process.pid}`;       // unique marker for this run's bid

    // ── 1. Account A: seed a uniquely-marked bid and save it to A's cloud, so it's a
    //       genuine foreign record (A's real "Adam Ryder"). ──
    await signInAs(page, A);
    const aOwner = await page.evaluate(() => _supaUser && _supaUser.id);
    expect(aOwner, 'signed in as account A').toBe(A.uid);
    await page.evaluate(async ({ bidId, clientId, MARK }) => {
      clients.push({ id: clientId, name: MARK, phone: '3165550000', _e2e: 'bleed' });
      bids.push({ id: bidId, client_id: clientId, client_name: MARK, name: MARK, amount: 9999, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'bleed' });
      if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
    }, { bidId, clientId, MARK });

    // ── 2. Switch to account B (fresh reload + sign-in = reopening the app). ──
    await signInAs(page, B);
    const bOwner = await page.evaluate(() => _supaUser && _supaUser.id);
    expect(bOwner, 'signed in as account B').toBe(B.uid);

    // ── 3. Forge the EXACT bug artifact while signed in as B: an offline-pending blob
    //       stamped `_owner: null` carrying account A's bid (what a force-quit/cache
    //       window produces when the owner stamp is lost). Then run the REAL guard the
    //       merge path uses. It MUST refuse a null-owner blob that carries records. ──
    const guard = await page.evaluate(({ bidId, clientId, MARK }) => {
      const poisoned = {
        _owner: null,
        clients: [{ id: clientId, name: MARK }],
        bids: [{ id: bidId, client_id: clientId, client_name: MARK, name: MARK, amount: 9999, status: 'Pending' }],
        jobs: [], income: [], expenses: [], mileage: [], payments: [], liens: [], ts: Date.now(),
      };
      try { localStorage.setItem('zp3_offline_pending', JSON.stringify(poisoned)); } catch (e) {}
      const op = (typeof _readOwnedOfflinePending === 'function') ? _readOwnedOfflinePending() : null;
      const adoptedInMem = (typeof bids !== 'undefined' ? bids : []).some(b => b.id === bidId);
      try { localStorage.removeItem('zp3_offline_pending'); } catch (e) {} // don't leave the poison around
      return {
        guardReturnedForeign: !!(op && (op.bids || []).some(b => b.id === bidId)),
        adoptedInMem,
      };
    }, { bidId, clientId, MARK });

    // ── 4. Belt-and-suspenders: A's bid must NOT be in account B's cloud td_bids. ──
    const inBCloud = await page.evaluate(async ({ bidId, Buid }) => {
      try {
        const { data } = await _supa.from('td_bids').select('id').eq('user_id', Buid).is('deleted_at', null).eq('id', String(bidId));
        return (data || []).length > 0;
      } catch (e) { return false; }
    }, { bidId, Buid: B.uid });

    // ── Defensive: if the bug DID bleed it into B, scrub it so this test never leaves
    //    account B corrupted. (Cleaning up a BLEED is not §13.7 seed data.) ──
    if (inBCloud) {
      await page.evaluate(async ({ bidId, clientId, Buid }) => {
        try { await _supa.from('td_bids').delete().eq('user_id', Buid).eq('id', String(bidId)); } catch (e) {}
        try { await _supa.from('td_clients').delete().eq('user_id', Buid).eq('id', String(clientId)); } catch (e) {}
      }, { bidId, clientId, Buid: B.uid });
    }

    expect(guard.guardReturnedForeign, "_readOwnedOfflinePending() handed account A's null-owner records to account B").toBe(false);
    expect(guard.adoptedInMem, "account A's bid was adopted into account B's in-memory bids[]").toBe(false);
    expect(inBCloud, "account A's bid bled into account B's cloud td_bids").toBe(false);
  });
});
