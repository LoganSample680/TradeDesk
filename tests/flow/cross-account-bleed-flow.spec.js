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
// Diagnostic sign-in: signs in, then polls for _supaUser.id===uid IN-PAGE, and on
// failure reports the ACTUAL _supaUser.id (vs expected) + the auth-call result — so a
// failure is a one-line cause, never a black-box 150s waitForFunction timeout.
async function _signInDiag(page, acct, label) {
  return await page.evaluate(async ({ email, password, uid }) => {
    if (typeof _supa === 'undefined' || !_supa) return { ok: false, why: 'client not initialized' };
    let authWhy = null, authOk = false;
    for (let attempt = 0; attempt < 4 && !authOk; attempt++) {
      try {
        const { error } = await _supa.auth.signInWithPassword({ email, password });
        if (!error) { authOk = true; break; }
        authWhy = error.message || `empty-error(status ${error.status || '?'})`;
        if (error.message && !/network|fetch|timeout|rate/i.test(error.message) && error.status !== 429) break;
      } catch (e) { authWhy = 'exception: ' + (e && e.message); }
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 350)));
    }
    if (!authOk) return { ok: false, why: `signInWithPassword failed: ${authWhy}` };
    // Poll up to 28s for the app to propagate the session into _supaUser.
    const t0 = Date.now();
    while (Date.now() - t0 < 28000) {
      if (typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id === uid) return { ok: true };
      await new Promise(r => setTimeout(r, 200));
    }
    const actual = (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : '(none)';
    return { ok: false, why: `auth OK but _supaUser.id never became ${uid} — actual=${actual}, _supaCloudLoaded=${typeof _supaCloudLoaded !== 'undefined' ? _supaCloudLoaded : '?'}` };
  }, { email: acct.email, password: acct.password, uid: acct.uid });
}

async function openAndSignIn(page, acct) {
  await page.goto('/');
  await page.waitForSelector('#supa-email', { timeout: 30000 });
  const res = await _signInDiag(page, acct, 'A');
  if (!res.ok) throw new Error(`openAndSignIn(${acct.email}): ${res.why}`);
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

    // ── 2. REAL account switch — NO reload. This is exactly what a user does: tap
    // "sign out of cloud sync", then sign into a different account on the SAME page
    // session. supaSignOut() only clears the local session; it does NOT wipe bids[]/
    // clients[] or reload. So A's data is still in memory when B signs in — the precise
    // window bug #39 lived in. This tests the APP's real behavior, not a reload-around. ──
    await page.evaluate(async () => { if (typeof supaSignOut === 'function') await supaSignOut(); });
    await page.waitForTimeout(600);

    // ── 3. Sign into NEW user B on the SAME page, no reload. ──
    const bIn = await _signInDiag(page, B, 'B');
    expect(bIn.ok, `B sign-in (no-reload account switch): ${bIn.why}`).toBe(true);
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
