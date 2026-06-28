// REAL flow — CROSS-ACCOUNT BLEED on same-device account switch (bug #39).
// Reproduces the exact production leak: signed in as account A, write a bid, then
// "sign out of cloud sync" and sign into a NEW user B on the SAME DEVICE — and
// account A's bid (the "Adam Ryder" leak) must NOT carry into B.
//
// Why this flow is faithful (the prior version was not): supaSignOut() only calls
// _supa.auth.signOut({scope:'local'}) — it does NOT wipe the in-memory bids[]/
// clients[] arrays and does NOT reload. So A's records survive across the sign-out,
// and signing into B WITHOUT a page reload is the precise window the bleed happened.
//
// IMPORTANT — this test does NOT assume the source. The bleed could live in memory,
// localStorage (any key), the offline-pending blob, the cloud cache, or B's cloud.
// So on failure it captures a SNAPSHOT of exactly where account A's unique marker
// appears, and surfaces that in the assertion message — the test diagnoses the
// source instead of us guessing it.
//
//   EXPECTED: PASSES when the bleed is fixed; FAILS (red) while it can still happen,
//   and names where A's data leaked from. Permanent guard so it can't return.
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

// Open the app fresh and sign in as a SPECIFIC account — like launching the app.
async function openAndSignIn(page, acct) {
  await page.goto('/');
  await page.waitForSelector('#supa-email', { timeout: 30000 });
  const res = await page.evaluate(async ({ email, password }) => {
    if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized' };
    try { const { error } = await _supa.auth.signInWithPassword({ email, password }); return { ok: !error, why: error ? error.message : null }; }
    catch (e) { return { ok: false, why: 'exception: ' + (e && e.message) }; }
  }, acct);
  if (!res.ok) throw new Error(`sign-in failed for ${acct.email}: ${res.why}`);
  await page.waitForFunction(({ uid }) => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id === uid, { timeout: 30000 }, { uid: acct.uid });
  await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
}

test.describe('cross-account bleed — same-device sign-out → sign-in (bug #39)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');
  test.skip(!haveTwoAccounts, 'needs a SECOND dev account — set E2E_DEV2_EMAIL / E2E_DEV2_PASSWORD / E2E_DEV2_USER_ID');

  test("A's bid never carries into B when you sign out of cloud sync and into a new user on the same device", async ({ page }) => {
    test.setTimeout(150000);
    const bidId = Date.now() * 1000 + (process.pid % 1000);
    const clientId = bidId + 1;
    const MARK = `BLEED-GUARD ${process.pid} ${bidId}`;   // unique marker for this run's bid

    // ── 1. Open as account A, write a uniquely-marked bid, save it to A's cloud. ──
    await openAndSignIn(page, A);
    expect(await page.evaluate(() => _supaUser && _supaUser.id), 'signed in as account A').toBe(A.uid);
    await page.evaluate(async ({ bidId, clientId, MARK }) => {
      clients.push({ id: clientId, name: MARK, phone: '3165550000', _e2e: 'bleed' });
      bids.push({ id: bidId, client_id: clientId, client_name: MARK, name: MARK, amount: 9999, status: 'Pending', bid_date: new Date().toISOString().slice(0, 10), _e2e: 'bleed' });
      if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
    }, { bidId, clientId, MARK });
    expect(await page.evaluate(({ bidId }) => bids.some(b => b.id === bidId), { bidId }), "A's bid is in memory before sign-out").toBe(true);

    // ── 2. REAL "sign out of cloud sync" — NO reload (the exact bleed window). ──
    await page.evaluate(async () => { if (typeof supaSignOut === 'function') await supaSignOut(); });
    await page.waitForTimeout(600);

    // ── 3. Sign into NEW user B on the SAME page, no reload — "sign into new user". ──
    const bIn = await page.evaluate(async ({ email, password }) => {
      try { const { error } = await _supa.auth.signInWithPassword({ email, password }); return { ok: !error, why: error ? error.message : null }; }
      catch (e) { return { ok: false, why: 'exception: ' + (e && e.message) }; }
    }, B);
    expect(bIn.ok, `B sign-in: ${bIn.why}`).toBe(true);
    await page.waitForFunction(({ uid }) => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id === uid, { timeout: 30000 }, { uid: B.uid });
    await page.waitForTimeout(1800); // let B's cloud load + any merge settle

    // ── 4. SNAPSHOT where A's marker appears — let the test find the source. ──
    const snap = await page.evaluate(({ bidId, clientId, MARK }) => {
      const lsHits = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k) || '';
          if (v.includes(MARK) || v.includes(String(bidId))) lsHits.push(k);
        }
      } catch (e) {}
      const blobRaw = (() => { try { return localStorage.getItem('zp3_offline_pending') || ''; } catch (e) { return ''; } })();
      const cacheRaw = (() => { try { return localStorage.getItem('zp3_cloud_cache') || ''; } catch (e) { return ''; } })();
      return {
        inBidsMem: (typeof bids !== 'undefined' ? bids : []).some(b => b.id === bidId || b.name === MARK || b.client_name === MARK),
        inClientsMem: (typeof clients !== 'undefined' ? clients : []).some(c => c.id === clientId || c.name === MARK),
        inUI: (document.body.innerText || '').includes(MARK),
        inOfflineBlob: blobRaw.includes(MARK) || blobRaw.includes(String(bidId)),
        inCloudCache: cacheRaw.includes(MARK) || cacheRaw.includes(String(bidId)),
        localStorageKeysWithA: lsHits,
        signedInAs: (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null,
      };
    }, { bidId, clientId, MARK });

    const inBCloud = await page.evaluate(async ({ bidId, Buid }) => {
      try { const { data } = await _supa.from('td_bids').select('id').eq('user_id', Buid).is('deleted_at', null).eq('id', String(bidId)); return (data || []).length > 0; }
      catch (e) { return false; }
    }, { bidId, Buid: B.uid });

    // Defensive: if it DID bleed into B's cloud, scrub it so the test never leaves
    // account B corrupted. (Cleaning up a BLEED is not §13.7 seed data.)
    if (inBCloud) {
      await page.evaluate(async ({ bidId, clientId, Buid }) => {
        try { await _supa.from('td_bids').delete().eq('user_id', Buid).eq('id', String(bidId)); } catch (e) {}
        try { await _supa.from('td_clients').delete().eq('user_id', Buid).eq('id', String(clientId)); } catch (e) {}
      }, { bidId, clientId, Buid: B.uid });
    }

    // The diagnosis: this string names exactly where A's data leaked from, so a red
    // run points us straight at the source (memory vs a specific localStorage key vs
    // the offline blob vs the cloud cache) instead of us assuming it.
    const where = JSON.stringify({ ...snap, inBCloud });
    const bled = snap.inBidsMem || snap.inClientsMem || snap.inUI || snap.inOfflineBlob || snap.inCloudCache || inBCloud;

    expect(bled, `account A's record leaked into account B. SOURCE SNAPSHOT → ${where}`).toBe(false);
  });
});
