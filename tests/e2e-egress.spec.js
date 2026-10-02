// @ts-check
/**
 * E2E tests, the egress-fix package (owner mandate 2026-07-14):
 *
 * 1. Signature-poll watermark: checkNewSignatures does ONE full poll per
 *    session, then delta-polls with .gt('updated_at', watermark) so a
 *    steady-state 30s tick transfers ~zero bytes. Drift-safe: a failed delta
 *    query falls back to the full poll (pre-fix behavior), and rows without
 *    updated_at (un-migrated database) never advance the watermark.
 * 2. _sigPollTick skips hidden tabs; the visibilitychange handler already
 *    re-checks on foreground so nothing is missed.
 * 3. Hub logo: uploaded once to storage, snapshot carries logoUrl and drops
 *    the multi-MB base64 logoData; base64 is embedded ONLY as the fallback.
 * 4. Photo pipeline: _compressPhoto produces a bounded main + 360px thumb
 *    (null on garbage → caller uploads the original); grids render the thumb,
 *    the viewer renders the full image; _cdnPhoto passes through on localhost.
 * 5. proposal_views watermark probe: steady state costs ≤1 tiny row instead of
 *    500 full rows; probe error → full poll (drift safety); probe hit → full
 *    rebuild with the exact pre-fix dict semantics.
 * 6. sig-feed health: _sigFeedStatus tracks SUBSCRIBED/down, and a recovery
 *    after an outage runs one immediate catch-up sweep (realtime is
 *    at-most-once, pushes dropped during the outage must be reconciled).
 * 7. Client hub poll cadence: live channel healthy → every 10th tick (5 min);
 *    channel down or never connected → every tick (30s, pre-fix behavior).
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// 1×1 transparent PNG, a valid, decodable data URL for logo tests.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.describe('egress: signature-poll watermark', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Install a recording _supa stub whose signed_proposals rows are configurable.
  // Returns the recorder so assertions can inspect which filters each poll used.
  const installStub = (rowsJson) => page.evaluate((rows) => {
    window.__sigCalls = [];
    const mkQuery = () => {
      const q = { _filters: {} };
      const chain = (name) => (col, val) => { q._filters[name + ':' + col] = val; return q; };
      q.select = () => q; q.eq = chain('eq'); q.gt = chain('gt');
      q.order = () => q; q.limit = () => q;
      q.then = (resolve) => {
        window.__sigCalls.push(JSON.parse(JSON.stringify(q._filters)));
        // Delta polls (gt filter present) return only rows newer than the watermark.
        const gtVal = q._filters['gt:updated_at'];
        const out = gtVal ? rows.filter(r => (r.updated_at || '') > gtVal) : rows;
        resolve({ data: out, error: null });
      };
      return q;
    };
    // The REAL client, saved once. Saving whatever _supa is now made the second
    // install keep the first install's stub as "the original", whose from()
    // then called itself for any other table: a cloud load landing mid-suite
    // on a slow WebKit run died of "Maximum call stack size exceeded" (CI
    // shard 1, 2026-10-01).
    window.__origSupa = window.__origSupa || _supa;
    _supa = { ...window.__origSupa, from: (tbl) => tbl === 'signed_proposals' ? mkQuery() : window.__origSupa.from(tbl) };
    _sigPollWatermark = null;
    localStorage.setItem('zp3_seen_sigs', '[]');
  }, rowsJson);

  test('first poll is full, second poll is a delta (.gt on updated_at) that returns zero rows', async () => {
    await installStub([
      { bid_id: '990001', client_name: 'Egress Client', client_signed_name: 'Egress Client',
        signed_at: '2026-07-14T00:00:00+00:00', updated_at: '2026-07-14T00:00:00+00:00',
        payment_status: 'pending_cash', payment_method: 'cash', signature_data: 'data:image/png;base64,xyz' },
    ]);
    const r = await page.evaluate(async () => {
      await checkNewSignatures();
      const firstCall = window.__sigCalls[0];
      await checkNewSignatures();
      const secondCall = window.__sigCalls[1];
      return {
        firstHadGt: 'gt:updated_at' in firstCall,
        secondHadGt: 'gt:updated_at' in secondCall,
        watermark: _sigPollWatermark,
      };
    });
    expect(r.firstHadGt, 'first poll of a session must be the FULL poll').toBe(false);
    expect(r.secondHadGt, 'second poll must delta on updated_at').toBe(true);
    expect(r.watermark).toBe('2026-07-14T00:00:00+00:00');
  });

  test('rows without updated_at (un-migrated database) never advance the watermark, every poll stays full', async () => {
    await installStub([
      { bid_id: '990002', client_name: 'Legacy Env', signed_at: '2026-07-14T00:00:00+00:00',
        payment_status: 'pending_cash', payment_method: 'cash' },
    ]);
    const r = await page.evaluate(async () => {
      await checkNewSignatures();
      await checkNewSignatures();
      return { calls: window.__sigCalls.length, anyGt: window.__sigCalls.some(c => 'gt:updated_at' in c), watermark: _sigPollWatermark };
    });
    expect(r.anyGt, 'no delta poll without a watermark, pre-fix behavior preserved').toBe(false);
    expect(r.watermark).toBe(null);
  });

  test('failed delta query falls back to the full poll in the same tick (drift safety)', async () => {
    // Stub where the gt query ERRORS (simulates the updated_at column missing)
    // but the plain query succeeds, checkNewSignatures must retry full, not throw.
    await page.evaluate(() => {
      window.__sigCalls = [];
      const mkQuery = () => {
        const q = { _gt: false };
        q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
        q.gt = () => { q._gt = true; return q; };
        q.then = (resolve) => {
          window.__sigCalls.push(q._gt ? 'delta' : 'full');
          resolve(q._gt ? { data: null, error: { message: 'column signed_proposals.updated_at does not exist' } }
                        : { data: [], error: null });
        };
        return q;
      };
      _supa = { ...window.__origSupa, from: (tbl) => tbl === 'signed_proposals' ? mkQuery() : window.__origSupa.from(tbl) };
      _sigPollWatermark = '2026-07-14T00:00:00+00:00'; // force the delta path
    });
    const r = await page.evaluate(async () => {
      await checkNewSignatures();
      return { calls: window.__sigCalls };
    });
    expect(r.calls).toEqual(['delta', 'full']);
  });

  test('a NEW signature arriving after the watermark still lands: bid flips Closed Won + schedule alert queued', async () => {
    await page.evaluate(() => {
      bids = bids.filter(b => String(b.id) !== '990003');
      bids.push({ id: 990003, client_id: 77001, client_name: 'Late Signer', amount: 3000, status: 'Pending', draft: false });
      localStorage.setItem('zp3_seen_sigs', '[]');
      localStorage.setItem('zp3_schedule_alerts', '[]');
    });
    await installStub([]); // watermarked session, nothing signed yet
    const r = await page.evaluate(async () => {
      _sigPollWatermark = '2026-07-14T00:00:00+00:00';
      // The signature lands AFTER the watermark, exactly what a delta poll returns.
      const row = { bid_id: '990003', client_name: 'Late Signer', client_signed_name: 'Late Signer',
        signed_at: '2026-07-14T01:00:00+00:00', updated_at: '2026-07-14T01:00:00+00:00',
        payment_status: 'pending_cash', payment_method: 'cash', signature_data: 'data:image/png;base64,sig' };
      const mkQuery = () => {
        const q = { _gt: null };
        q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
        q.gt = (c, v) => { q._gt = v; return q; };
        q.then = (resolve) => resolve({ data: (row.updated_at > (q._gt || '')) ? [row] : [], error: null });
        return q;
      };
      _supa = { ...window.__origSupa, from: (tbl) => tbl === 'signed_proposals' ? mkQuery() : window.__origSupa.from(tbl) };
      await checkNewSignatures();
      const b = bids.find(x => String(x.id) === '990003');
      const alerts = JSON.parse(localStorage.getItem('zp3_schedule_alerts') || '[]');
      return { status: b?.status, signedName: b?.signedName, alertQueued: alerts.some(a => String(a.bidId) === '990003'), watermark: _sigPollWatermark };
    });
    expect(r.status).toBe('Closed Won');
    expect(r.signedName).toBe('Late Signer');
    expect(r.alertQueued, 'the New Signature alert must still fire off a delta poll').toBe(true);
    expect(r.watermark, 'watermark advances past the processed row').toBe('2026-07-14T01:00:00+00:00');
  });

  test('_sigPollTick skips hidden tabs and runs on visible ones', async () => {
    const r = await page.evaluate(async () => {
      let polls = 0;
      const origCheck = checkNewSignatures, origViews = _fetchProposalViews;
      checkNewSignatures = () => { polls++; }; _fetchProposalViews = () => {};
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      _sigPollTick();
      const whileHidden = polls;
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      _sigPollTick();
      const whileVisible = polls;
      checkNewSignatures = origCheck; _fetchProposalViews = origViews;
      delete document.visibilityState;
      return { whileHidden, whileVisible };
    });
    expect(r.whileHidden).toBe(0);
    expect(r.whileVisible).toBe(1);
  });

  test('a call landing mid-run is COALESCED, not dropped, a trailing poll always runs (push-collision regression)', async () => {
    // Live-run regression: the sig-feed push handler can hold _checkSigsBusy at
    // the exact moment the 30s tick (or a test's own call) arrives. The old
    // guard silently dropped that call, a real signature then waited a full
    // extra poll cycle. The coalescing guard must rerun once after the
    // in-flight poll finishes, so every caller gets a poll that STARTED after
    // their call.
    await installStub([]);
    const r = await page.evaluate(async () => {
      const p1 = checkNewSignatures();      // takes the busy flag
      const p2 = checkNewSignatures();      // lands mid-run, must coalesce
      await p1; await p2;
      await new Promise(res => setTimeout(res, 100)); // let the trailing rerun finish
      return { polls: window.__sigCalls.length };
    });
    expect(r.polls, 'second call must trigger a trailing rerun, 2 polls, not 1').toBe(2);
  });

  test('_applySigStatusToBid: a declined row flips a Pending bid to Closed Lost with the client reason, a signed row flips it to Closed Won', async () => {
    const r = await page.evaluate(() => {
      const declinedBid = { id: 1, status: 'Pending', signingToken: 'tok-d', draft: true };
      const declinedChanged = _applySigStatusToBid(declinedBid, {
        payment_status: 'declined', decline_reason: 'Went with another contractor', signed_at: '2026-07-16T00:00:00+00:00',
      });
      const signedBid = { id: 2, status: 'Pending', signingToken: 'tok-s', draft: true };
      const signedChanged = _applySigStatusToBid(signedBid, {
        payment_status: 'pending_cash', client_name: 'Bob', signed_at: '2026-07-16T00:00:00+00:00',
      });
      // Idempotent: re-applying the same declined row a second time (e.g. the
      // reconciliation sweep runs again next session) must not report a change.
      const declinedChangedAgain = _applySigStatusToBid(declinedBid, {
        payment_status: 'declined', decline_reason: 'Went with another contractor', signed_at: '2026-07-16T00:00:00+00:00',
      });
      return { declinedBid, declinedChanged, signedBid, signedChanged, declinedChangedAgain };
    });
    expect(r.declinedChanged).toBe(true);
    expect(r.declinedBid.status).toBe('Closed Lost');
    expect(r.declinedBid.lostReason).toBe('Went with another contractor');
    expect(r.declinedBid.draft).toBe(false);
    expect(r.signedChanged).toBe(true);
    expect(r.signedBid.status).toBe('Closed Won');
    expect(r.declinedChangedAgain, 're-applying an already-processed declined row is a no-op').toBe(false);
  });

  test('_reconcilePendingSigStatuses: a bid stuck Pending gets corrected to Closed Lost from a decline the normal poll window can no longer reach', async () => {
    // The bug this guards: an account with 100+ signed_proposals rows (or a
    // decline whose updated_at aged past the delta watermark) means neither
    // checkNewSignatures poll path will ever re-fetch an old declined row, so
    // a bid can stay wrongly "Pending" (counted as Awaiting sig) forever. The
    // reconciliation pass queries by bid_id directly, no date/limit window.
    await page.evaluate(() => {
      bids = bids.filter(b => !['990010', '990011', '990012'].includes(String(b.id)));
      bids.push(
        { id: 990010, client_id: 77010, client_name: 'Stuck Decline', amount: 1500, status: 'Pending', draft: false, signingToken: 'tok-stuck' },
        { id: 990011, client_id: 77011, client_name: 'Really Awaiting', amount: 2200, status: 'Pending', draft: false, signingToken: 'tok-real' },
        { id: 990012, client_id: 77012, client_name: 'Never Sent', amount: 900, status: 'Pending', draft: true }, // no signingToken: must be excluded from the query
      );
    });
    const r = await page.evaluate(async () => {
      // Queries in SEQUENTIAL CHUNKS of ids via .in(bid_id, [...]), one fresh
      // query object per chunk, so the mock builds one per .from() call and
      // resolves only the ids that chunk actually asked for.
      const queriedIds = [];
      const mkQuery = () => {
        let chunk = [];
        const q = {};
        q.select = () => q;
        q.eq = () => q;
        q.limit = () => q;
        q.in = (col, ids) => { if (col === 'bid_id') { chunk = ids; queriedIds.push(...ids); } return q; };
        q.then = (resolve) => resolve({
          data: chunk.includes('990010')
            ? [{ bid_id: '990010', payment_status: 'declined', decline_reason: 'Price was too high', signed_at: '2026-07-16T00:00:00+00:00' }]
            : [],
          error: null,
        });
        return q;
      };
      window.__origSupa = window.__origSupa || _supa;
      _supa = { ...window.__origSupa, from: (tbl) => tbl === 'signed_proposals' ? mkQuery() : window.__origSupa.from(tbl) };
      await _reconcilePendingSigStatuses();
      // A changed pass schedules a delayed re-assert (the live revert fix).
      // Cancel it: firing 2.5s from now, it would hit whatever mock the NEXT
      // test has installed by then and trip its call-count assertions.
      clearTimeout(_reconcileReassertTimer);
      const stuck = bids.find(x => String(x.id) === '990010');
      const real = bids.find(x => String(x.id) === '990011');
      return {
        queriedIds,
        stuckStatus: stuck?.status, stuckReason: stuck?.lostReason,
        realStatus: real?.status,
      };
    });
    expect(r.queriedIds, 'only signingToken+Pending bids are queried').toEqual(expect.arrayContaining(['990010', '990011']));
    expect(r.queriedIds).not.toContain('990012');
    expect(r.stuckStatus, 'the stale declined bid self-heals to Closed Lost').toBe('Closed Lost');
    expect(r.stuckReason).toBe('Price was too high');
    expect(r.realStatus, 'a bid genuinely still awaiting signature is left untouched').toBe('Pending');
  });

  test('_reconcilePendingSigStatuses: no Pending+signingToken bids means zero query cost, not even a call', async () => {
    const r = await page.evaluate(async () => {
      bids = bids.filter(b => !(b.signingToken && b.status === 'Pending'));
      let called = false;
      window.__origSupa = window.__origSupa || _supa;
      _supa = { ...window.__origSupa, from: (tbl) => { if (tbl === 'signed_proposals') called = true; return window.__origSupa.from(tbl); } };
      await _reconcilePendingSigStatuses();
      return { called };
    });
    expect(r.called, 'reconciliation must not query when there is nothing to reconcile').toBe(false);
  });

  test('schedule popup NEVER surfaces over the boot spinner, it defers until the overlay is gone', async () => {
    const r = await page.evaluate(async () => {
      // Hermetic start: a prior test in this shared page (or a leaked 700ms retry
      // chain) can leave a _sched-alert-overlay in the DOM, which would make
      // duringBoot read true before this test even runs. Clear it first.
      document.getElementById('_sched-alert-overlay')?.remove();
      window._showingScheduleAlert = false;
      // Recreate the boot overlay (the booted test app already removed it).
      const ov = document.createElement('div');
      ov.id = 'supa-boot-overlay';
      ov.style.cssText = 'position:fixed;inset:0;display:flex;opacity:1';
      document.body.appendChild(ov);
      bids = bids.filter(b => String(b.id) !== '990009');
      bids.push({ id: 990009, client_id: 77009, client_name: 'Boot Gate', amount: 900, status: 'Closed Won', draft: false });
      localStorage.setItem('zp3_schedule_alerts', JSON.stringify([{ name: 'Boot Gate', bidId: 990009, clientId: 77009, isPaid: false }]));
      window._showingScheduleAlert = false; window._schedAlertWaiting = false;
      showScheduleAlerts();
      const duringBoot = !!document.getElementById('_sched-alert-overlay');
      const waiting = !!window._schedAlertWaiting;
      ov.remove();                                  // boot finishes
      await new Promise(res => setTimeout(res, 900)); // retry timer fires
      const afterBoot = !!document.getElementById('_sched-alert-overlay');
      document.getElementById('_sched-alert-overlay')?.remove();
      window._showingScheduleAlert = false;
      localStorage.setItem('zp3_schedule_alerts', '[]');
      return { duringBoot, waiting, afterBoot };
    });
    expect(r.duringBoot, 'modal must NOT appear while the boot overlay is visible').toBe(false);
    expect(r.waiting, 'a single deferral chain must be armed').toBe(true);
    expect(r.afterBoot, 'modal appears once the overlay is gone').toBe(true);
  });

  test('restore real _supa + no console errors from the watermark suite', async () => {
    await page.evaluate(() => { if (window.__origSupa) _supa = window.__origSupa; });
    assertNoErrors(page, 'signature-poll watermark');
  });
});

test.describe('egress: hub logo as URL, base64 only as fallback', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_ensureLogoUrl uploads once and stamps S.logoUrl + S.logoHash', async () => {
    const r = await page.evaluate(async (png) => {
      S.logoData = png; S.logoUrl = ''; S.logoHash = '';
      const url = await _ensureLogoUrl();
      const again = await _ensureLogoUrl(); // second call: hash matches → no re-upload, same URL
      return { url, again, sUrl: S.logoUrl, sHash: S.logoHash };
    }, TINY_PNG);
    expect(r.url).toContain('/storage/v1/object/public/gallery/');
    expect(r.url).toContain('/branding/logo-');
    expect(r.again).toBe(r.url);
    expect(r.sUrl).toBe(r.url);
    expect(r.sHash.length).toBeGreaterThan(0);
  });

  test('snapshot carries logoUrl and EMPTY logoData when the current logo is uploaded', async () => {
    const r = await page.evaluate(async (png) => {
      clients = clients.filter(c => c.id !== 77002).concat([{ id: 77002, name: 'Logo Snap Client' }]);
      S.logoData = png; S.logoUrl = ''; S.logoHash = '';
      await _ensureLogoUrl();
      const snap = _buildClientHubSnapshot(77002);
      return { logoUrl: snap.logoUrl, logoData: snap.logoData };
    }, TINY_PNG);
    expect(r.logoUrl).toContain('/branding/logo-');
    expect(r.logoData, 'multi-MB base64 must NOT ride along once a URL exists').toBe('');
  });

  test('snapshot falls back to embedded base64 when no URL exists or the logo changed (stale-hash guard)', async () => {
    const r = await page.evaluate((png) => {
      clients = clients.filter(c => c.id !== 77003).concat([{ id: 77003, name: 'Fallback Client' }]);
      // No URL at all → embed (legacy behavior preserved).
      S.logoData = png; S.logoUrl = ''; S.logoHash = '';
      const noUrl = _buildClientHubSnapshot(77003);
      // URL exists but for a DIFFERENT logo (hash mismatch) → embed, never serve the old logo.
      S.logoUrl = 'https://mock/storage/old-logo.png'; S.logoHash = 'stale';
      const stale = _buildClientHubSnapshot(77003);
      return { noUrlData: noUrl.logoData, noUrlUrl: noUrl.logoUrl, staleData: stale.logoData, staleUrl: stale.logoUrl };
    }, TINY_PNG);
    expect(r.noUrlData).toContain('data:image/png');
    expect(r.noUrlUrl).toBe('');
    expect(r.staleData).toContain('data:image/png');
    expect(r.staleUrl, 'a stale URL must never ship, wrong logo').toBe('');
  });

  test('no console errors from the logo suite', async () => {
    assertNoErrors(page, 'hub logo URL');
  });
});

// The settings row stopped carrying the logo (2026-09-28). Supabase dropped
// every request on the project: egress 6.02 GB of 5.5. One account's logo was
// 1.5 MB of base64 inside zj_data.settings, and that row went down about 1,000
// times a day (server rebuilds, realtime pushes, phone reads).
test.describe('egress: the settings row carries logoUrl, never the logo bytes', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('an uploaded logo is left out of the cloud settings; stateRates too', async () => {
    const r = await page.evaluate((png) => {
      const src = { bname: 'Acme', logoData: png, logoUrl: 'https://x/branding/logo-1.png', logoHash: String(_hubHash(png)), stateRates: { OH: 1 } };
      const out = _settingsForCloud(src);
      return { keys: Object.keys(out).sort(), srcKept: src.logoData === png };
    }, TINY_PNG);
    expect(r.keys).toEqual(['bname', 'logoHash', 'logoUrl']);
    expect(r.srcKept, 'S itself keeps the logo, only the upload drops it').toBe(true);
  });

  test('a logo storage does not hold yet still syncs in the row, and starts ONE upload', async () => {
    const r = await page.evaluate((png) => {
      const orig = window._ensureLogoUrl; let calls = 0;
      window._ensureLogoUrl = async () => { calls++; return ''; };
      try {
        // Never uploaded, then a stale URL for an older logo: both must keep the bytes.
        const a = _settingsForCloud({ logoData: png + 'A', logoUrl: '', logoHash: '' });
        const b = _settingsForCloud({ logoData: png + 'A', logoUrl: 'https://x/old.png', logoHash: 'stale' });
        const c = _settingsForCloud({ logoData: png + 'A' });
        return { a: a.logoData === png + 'A', b: b.logoData === png + 'A', c: c.logoData === png + 'A', calls };
      } finally { window._ensureLogoUrl = orig; }
    }, TINY_PNG);
    expect(r.a).toBe(true);
    expect(r.b).toBe(true);
    expect(r.c).toBe(true);
    expect(r.calls, 'one attempt per logo per session, not one per save').toBe(1);
  });

  test('empty, null and a removed logo: nothing throws, a removal still syncs', async () => {
    const r = await page.evaluate(() => ({
      n: Object.keys(_settingsForCloud(null)).length,
      u: Object.keys(_settingsForCloud(undefined)).length,
      removed: _settingsForCloud({ logoData: '', logoUrl: '', logoHash: '' }),
    }));
    expect(r.n).toBe(0);
    expect(r.u).toBe(0);
    expect(r.removed.logoData, 'clearing the logo must reach the other devices').toBe('');
  });

  test('the only settings upload goes through _settingsForCloud', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
    expect(src).toContain('const sForCloud=_settingsForCloud(S);');
    expect(src.match(/settings:JSON\.stringify\(/g) || []).toHaveLength(1);
  });

  test('a device without the logo rebuilds it from logoUrl, once', async () => {
    const r = await page.evaluate(async (png) => {
      const realFetch = window.fetch; let hits = 0;
      const blob = await (await realFetch(png)).blob();
      window.fetch = async (u) => { hits++; return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } }); };
      try {
        S.logoData = ''; S.logoUrl = 'https://mock.supabase.co/storage/v1/object/public/gallery/u/branding/logo-9.png';
        S.logoHash = String(_hubHash(png));
        const p1 = _hydrateLogoFromUrl(); const p2 = _hydrateLogoFromUrl();
        await p1;
        const after = { data: S.logoData, hashOk: String(_hubHash(S.logoData)) === String(S.logoHash), second: p2 };
        const again = _hydrateLogoFromUrl(); // already matches: no fetch
        return { same: after.data === png, hashOk: after.hashOk, secondWasNull: after.second === null, againNull: again === null, hits };
      } finally { window.fetch = realFetch; }
    }, TINY_PNG);
    expect(r.same).toBe(true);
    expect(r.hashOk).toBe(true);
    expect(r.secondWasNull, 'a second call while one is in flight does not fetch again').toBe(true);
    expect(r.againNull).toBe(true);
    expect(r.hits).toBe(1);
  });

  test('a failed fetch, a non-image and a logo changed mid-flight all leave S alone', async () => {
    const r = await page.evaluate(async (png) => {
      const realFetch = window.fetch; const out = {};
      try {
        S.logoData = ''; S.logoUrl = 'https://x/a.png'; S.logoHash = '123';
        window.fetch = async () => { throw new Error('offline'); };
        await _hydrateLogoFromUrl(); out.failed = S.logoData;
        window.fetch = async () => new Response('nope', { status: 404 });
        await _hydrateLogoFromUrl(); out.notFound = S.logoData;
        window.fetch = async () => new Response(new Blob(['<html>'], { type: 'text/html' }), { status: 200 });
        await _hydrateLogoFromUrl(); out.html = S.logoData;
        const blob = await (await realFetch(png)).blob();
        window.fetch = async () => { S.logoUrl = ''; return new Response(blob, { status: 200 }); };
        await _hydrateLogoFromUrl(); out.removed = S.logoData;
      } finally { window.fetch = realFetch; S.logoUrl = ''; S.logoHash = ''; }
      return out;
    }, TINY_PNG);
    expect(r).toEqual({ failed: '', notFound: '', html: '', removed: '' });
  });

  test('settings arriving without logoData keep the logo this device already has', async () => {
    const r = await page.evaluate((png) => {
      S.logoData = png; S.logoUrl = 'https://x/l.png'; S.logoHash = String(_hubHash(png));
      const ts = (S.settingsTs || 0) + 1000;
      // As it comes off the wire: JSON never carries the key at all.
      const incoming = { bname: 'Merged Co 2', logoUrl: S.logoUrl, logoHash: S.logoHash, settingsTs: ts + 1 };
      _mergeIncomingSettings(incoming, 'test');
      return { kept: S.logoData === png, name: S.bname };
    }, TINY_PNG);
    expect(r.kept).toBe(true);
    expect(r.name).toBe('Merged Co 2');
  });

  test('no console errors from the settings logo suite', async () => {
    assertNoErrors(page, 'settings logo');
  });
});

test.describe('egress: photo compression, thumbnails, CDN rewrite', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_compressPhoto bounds the main image to 1600px and the thumb to 360px, both JPEG', async () => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 2400; cv.height = 1200;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#345'; ctx.fillRect(0, 0, 2400, 1200);
      const src = await new Promise(res => cv.toBlob(res, 'image/png'));
      const out = await _compressPhoto(src);
      if (!out) return { out: null };
      const dims = async b => { const bmp = await createImageBitmap(b); return { w: bmp.width, h: bmp.height }; };
      return { mime: out.mime, ext: out.ext, main: await dims(out.blob), thumb: await dims(out.thumb) };
    });
    expect(r.out).not.toBe(null);
    expect(r.mime).toBe('image/jpeg');
    expect(r.main.w).toBe(1600);
    expect(r.main.h).toBe(800);
    expect(Math.max(r.thumb.w, r.thumb.h)).toBe(360);
  });

  test('_compressPhoto never upsizes a small image and returns null on garbage (caller uploads the original)', async () => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200;
      cv.getContext('2d').fillRect(0, 0, 300, 200);
      const small = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
      const outSmall = await _compressPhoto(small);
      const dims = async b => { const bmp = await createImageBitmap(b); return { w: bmp.width, h: bmp.height }; };
      const garbage = await _compressPhoto(new Blob(['not an image'], { type: 'text/plain' }));
      return { small: outSmall ? await dims(outSmall.blob) : null, garbage };
    });
    expect(r.small).toEqual({ w: 300, h: 200 });
    expect(r.garbage, 'garbage input → null → caller falls back to the original file').toBe(null);
  });

  test('_uploadPhotoThumb writes a t- prefixed .jpg alongside the main path', async () => {
    const r = await page.evaluate(async () => {
      const blob = new Blob(['x'], { type: 'image/jpeg' });
      return await _uploadPhotoThumb(blob, 'uid-1/900/before-123.png');
    });
    expect(r.thumbPath).toBe('uid-1/900/t-before-123.jpg');
    expect(r.thumbUrl).toContain('/gallery/uid-1/900/t-before-123.jpg');
  });

  // The Gallery page is gone (owner 2026-09-22). The same rule it proved,
  // grids get the thumb and only a deliberate tap fetches the big bytes, now
  // lives in the album, and it is stricter: the full copy has no url at all.
  test('the album grid renders the THUMB, and the viewer only starts from it', async () => {
    const r = await page.evaluate(() => {
      photos = [{ id: 'eg-1', url: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/full-1.jpg',
        thumbUrl: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/t-full-1.jpg',
        storagePath: 'u/full-1.jpg', fullPath: 'u/f-full-1.webp',
        type: 'after', caption: '', client_id: 1, client_name: 'Thumb Client', uploadedAt: new Date().toISOString() }];
      tdReviewShots(['eg-1']);
      const grid = document.getElementById('pc-rev').innerHTML;
      tdReviewOpen(0);
      const shown = document.getElementById('pc-rev-img').src;
      const offered = !!document.getElementById('pc-rev-full');
      tdReviewClose();
      return { gridUsesThumb: grid.includes('t-full-1.jpg'), shown, offered };
    });
    expect(r.gridUsesThumb).toBe(true);
    expect(r.shown).toContain('t-full-1.jpg');   // the viewer's FIRST paint is the cached thumb
    // Since 2026-09-23 the photo you stay on sharpens by itself (owner: "it's
    // not showing the full quality, it should"), but only that one and only
    // after a dwell: that rule is pinned in e2e-photo-capture.spec.js.
    expect(r.offered).toBe(true);
  });

  test('_cdnPhoto passes through on localhost, data: URLs, and non-gallery URLs', async () => {
    const r = await page.evaluate(() => ({
      local: _cdnPhoto('https://mock.supabase.co/storage/v1/object/public/gallery/u/a.jpg'),
      dataUrl: _cdnPhoto('data:image/png;base64,abc'),
      empty: _cdnPhoto(''),
    }));
    // Tests run on localhost, the rewrite is production-only by design.
    expect(r.local).toBe('https://mock.supabase.co/storage/v1/object/public/gallery/u/a.jpg');
    expect(r.dataUrl).toBe('data:image/png;base64,abc');
    expect(r.empty).toBe('');
  });

  // 2026-10-02: full size kept every pixel but was 3 to 5.7 MB a shot.
  test('the full-size copy keeps every pixel at the tighter quality (JPEG 0.75 where WebP cannot encode)', async () => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 4032; cv.height = 3024;
      cv.getContext('2d').fillRect(0, 0, 4032, 3024);
      const src = await new Promise(res => cv.toBlob(res, 'image/png'));
      const calls = [];
      const real = HTMLCanvasElement.prototype.toBlob;
      // An iPhone: asking for WebP hands back something else.
      HTMLCanvasElement.prototype.toBlob = function (cb, mime, q) {
        calls.push({ w: this.width, mime, q });
        return real.call(this, cb, mime === 'image/webp' ? 'image/png' : mime, q);
      };
      try {
        const out = await _compressPhoto(src);
        const bmp = await createImageBitmap(out.full);
        return { calls, fullMime: out.fullMime, w: bmp.width, h: bmp.height };
      } finally { HTMLCanvasElement.prototype.toBlob = real; }
    });
    expect(r.fullMime).toBe('image/jpeg');
    expect([r.w, r.h], 'every pixel kept').toEqual([4032, 3024]);
    const full = r.calls.filter(c => c.w === 4032);
    expect(full.map(c => c.mime + ':' + c.q)).toEqual(['image/webp:0.78', 'image/jpeg:0.75']);
  });

  test('the viewer loads photos through the image cache, and falls back to the direct link on a miss', async () => {
    const r = await page.evaluate(async () => {
      const realCdn = window._cdnPhoto;
      window._cdnPhoto = (u) => u.replace('https://direct/', '/img/');
      const realImage = window.Image;
      const tried = [];
      // Every cache URL "fails", every direct one loads.
      window.Image = function () {
        const o = {}; let s = '';
        Object.defineProperty(o, 'src', { get: () => s, set: (v) => { s = v; tried.push(v); setTimeout(() => (v.startsWith('/img/') ? o.onerror : o.onload)?.(), 0); } });
        return o;
      };
      try {
        // A stand-in for the <img>: only the three things _pcSwapSrc touches,
        // so no engine's own image loading can race the assertion.
        const img = { isConnected: true, _src: null, getAttribute() { return this._src; }, set src(v) { this._src = v; } };
        _pcSwapSrc(img, 'https://direct/gallery/u/f-1.jpg');
        for (let k = 0; k < 100 && !img._src; k++) await new Promise(res => setTimeout(res, 20));
        const swapped = img._src;
        const el = document.createElement('img');
        photos.push({ id: 99881, fullPath: 'u/f-2.jpg', url: 'https://direct/gallery/u/2.jpg' });
        const realFull = window._pcFullUrl;
        window._pcFullUrl = () => 'https://direct/gallery/u/f-2.jpg';
        const used = tdPhotoFullSize(99881, el);
        const first = el.getAttribute('src');
        el.onerror && el.onerror();
        const after = el.getAttribute('src');
        window._pcFullUrl = realFull;
        photos.splice(photos.findIndex(p => p.id === 99881), 1);
        return { tried, swapped, used, first, after };
      } finally { window.Image = realImage; window._cdnPhoto = realCdn; }
    });
    expect(r.tried).toEqual(['/img/gallery/u/f-1.jpg', 'https://direct/gallery/u/f-1.jpg']);
    expect(r.swapped).toBe('https://direct/gallery/u/f-1.jpg');
    expect(r.first, 'Full size asks the cache first').toBe('/img/gallery/u/f-2.jpg');
    expect(r.after, 'and the direct link if the cache misses').toBe('https://direct/gallery/u/f-2.jpg');
  });

  test('no console errors from the photo suite', async () => {
    assertNoErrors(page, 'photo compression + thumbnails');
  });
});

test.describe('egress: client hub renders logoUrl and photo thumbs (legacy hubs untouched)', () => {
  const { FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');
  const hubBase = {
    contractorUserId: FAKE_USER_ID, contractorName: 'Egress Painting', clientName: 'Hub Client',
    clientToken: FAKE_TOKEN, bids: [], jobs: [], payments: [],
  };

  async function boot(page, hub) {
    await page.addInitScript(d => { window.__mockHubData = d; }, hub);
    await mockAllExternal(page);
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
  }

  test('hub with logoUrl renders it in the topbar (no base64 in the snapshot)', async ({ page }) => {
    await boot(page, { ...hubBase, logoUrl: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/branding/logo-1.png', logoData: '' });
    const src = await page.evaluate(() => document.getElementById('topbar-logo-img')?.src || '');
    expect(src).toContain('/branding/logo-1.png');
    assertNoErrors(page, 'hub logoUrl render');
  });

  test('LEGACY hub with only base64 logoData still renders (backward compatibility)', async ({ page }) => {
    await boot(page, { ...hubBase, logoData: TINY_PNG });
    const src = await page.evaluate(() => document.getElementById('topbar-logo-img')?.src || '');
    expect(src.startsWith('data:image/png')).toBe(true);
    assertNoErrors(page, 'legacy hub logoData render');
  });

  test('hub photo grids prefer thumbUrl; legacy photos without one still render the full URL', async ({ page }) => {
    await boot(page, {
      ...hubBase,
      jobs: [{ id: 1, name: 'Repaint', status: 'active', photos: [
        { url: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/full-a.jpg',
          thumbUrl: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/t-full-a.jpg', type: 'before', uploadedAt: new Date().toISOString() },
        { url: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/full-b.jpg', type: 'after', uploadedAt: new Date().toISOString() },
      ] }],
    });
    const r = await page.evaluate(() => {
      const html = document.getElementById('view-project')?.innerHTML || document.body.innerHTML;
      return {
        usesThumbForNew: html.includes('t-full-a.jpg'),
        legacyStillRenders: html.includes('full-b.jpg'),
      };
    });
    expect(r.usesThumbForNew).toBe(true);
    expect(r.legacyStillRenders).toBe(true);
    assertNoErrors(page, 'hub photo thumbs');
  });
});

test.describe('egress round 2, proposal_views watermark probe', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Recording stub for proposal_views. Distinguishes the probe (select('updated_at'),
  // limit 1) from the full poll (select('*'), .not, limit 500) by the select arg.
  const installPvStub = (rowsJson) => page.evaluate((rows) => {
    window.__pvCalls = [];
    const mkQuery = () => {
      const q = { _sel: '', _gt: null };
      q.select = (cols) => { q._sel = cols || '*'; return q; };
      q.eq = () => q; q.not = () => q; q.order = () => q; q.limit = () => q;
      q.gt = (c, v) => { q._gt = v; return q; };
      q.then = (resolve) => {
        window.__pvCalls.push({ sel: q._sel, gt: q._gt });
        const out = q._gt ? rows.filter(r => (r.updated_at || '') > q._gt) : rows;
        resolve({ data: out, error: null });
      };
      return q;
    };
    // Saved once, for the same reason as __origSupa above.
    window.__origSupaPv = window.__origSupaPv || _supa;
    _supa = { ...window.__origSupaPv, from: (tbl) => tbl === 'proposal_views' ? mkQuery() : window.__origSupaPv.from(tbl) };
    _pvPollWatermark = null;
  }, rowsJson);

  test('first fetch is full; steady-state tick is a 1-row probe that transfers nothing and skips the full poll', async () => {
    await installPvStub([
      { bid_id: '880001', opened_at: '2026-07-14T00:00:00+00:00', updated_at: '2026-07-14T00:00:00+00:00', hub_view_count: 2 },
    ]);
    const r = await page.evaluate(async () => {
      await _fetchProposalViews();                     // arms the watermark
      const afterFirst = window.__pvCalls.length;
      await _fetchProposalViews();                     // steady state: probe only
      return { afterFirst, calls: window.__pvCalls, watermark: _pvPollWatermark };
    });
    expect(r.afterFirst, 'first fetch = ONE full query, no probe').toBe(1);
    expect(r.calls[0].sel).toBe('*');
    expect(r.calls.length, 'second tick = probe ONLY, the 500-row poll must not run').toBe(2);
    expect(r.calls[1].sel).toBe('updated_at');
    expect(r.calls[1].gt).toBe('2026-07-14T00:00:00+00:00');
    expect(r.watermark).toBe('2026-07-14T00:00:00+00:00');
  });

  test('a change lands: probe hits → full rebuild runs and the dashboard maps update (pre-fix semantics)', async () => {
    await installPvStub([
      { bid_id: '880002', opened_at: '2026-07-14T02:00:00+00:00', updated_at: '2026-07-14T02:00:00+00:00', client_view_count: 3 },
    ]);
    const r = await page.evaluate(async () => {
      _pvPollWatermark = '2026-07-14T01:00:00+00:00'; // watermarked session, row is newer
      await _fetchProposalViews();
      return {
        calls: window.__pvCalls.map(c => c.sel),
        count: _proposalViewsByBidClientCount['880002'] || 0,
        watermark: _pvPollWatermark,
      };
    });
    expect(r.calls, 'probe hit must be followed by the full rebuild').toEqual(['updated_at', '*']);
    expect(r.count).toBe(3);
    expect(r.watermark, 'watermark advances past the change').toBe('2026-07-14T02:00:00+00:00');
  });

  test('probe error (un-migrated database) falls back to the full poll in the same tick, pre-fix behavior', async () => {
    await page.evaluate(() => {
      window.__pvCalls = [];
      const mkQuery = () => {
        const q = { _sel: '' };
        q.select = (cols) => { q._sel = cols || '*'; return q; };
        q.eq = () => q; q.not = () => q; q.order = () => q; q.limit = () => q; q.gt = () => q;
        q.then = (resolve) => {
          window.__pvCalls.push(q._sel);
          resolve(q._sel === 'updated_at'
            ? { data: null, error: { message: 'column proposal_views.updated_at does not exist' } }
            : { data: [], error: null });
        };
        return q;
      };
      _supa = { ...window.__origSupaPv, from: (tbl) => tbl === 'proposal_views' ? mkQuery() : window.__origSupaPv.from(tbl) };
      _pvPollWatermark = '2026-07-14T00:00:00+00:00';
    });
    const r = await page.evaluate(async () => { await _fetchProposalViews(); return window.__pvCalls; });
    expect(r).toEqual(['updated_at', '*']);
  });

  test('rows without updated_at never arm the watermark, every fetch stays full (drift safety)', async () => {
    await installPvStub([{ bid_id: '880003', opened_at: '2026-07-14T00:00:00+00:00' }]);
    const r = await page.evaluate(async () => {
      await _fetchProposalViews();
      await _fetchProposalViews();
      return { watermark: _pvPollWatermark, anyProbe: window.__pvCalls.some(c => c.sel === 'updated_at') };
    });
    expect(r.watermark).toBe(null);
    expect(r.anyProbe).toBe(false);
  });

  test('restore real _supa + no console errors from the pv-watermark suite', async () => {
    await page.evaluate(() => { if (window.__origSupaPv) _supa = window.__origSupaPv; });
    assertNoErrors(page, 'proposal_views watermark');
  });
});

test.describe('egress round 2, sig-feed channel health + recovery catch-up', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('channel failure marks the feed down; recovery runs ONE immediate catch-up sweep', async () => {
    const r = await page.evaluate(() => {
      let sweeps = 0, views = 0;
      const origCheck = checkNewSignatures, origViews = _fetchProposalViews;
      checkNewSignatures = (src) => { sweeps++; window.__lastSrc = src; };
      _fetchProposalViews = () => { views++; };
      _sigFeedReady = false; _sigFeedDown = false;
      _sigFeedStatus('SUBSCRIBED');                    // initial connect, no sweep
      const afterConnect = { sweeps, ready: _sigFeedReady };
      _sigFeedStatus('CHANNEL_ERROR');                 // outage
      const afterError = { ready: _sigFeedReady, down: _sigFeedDown };
      _sigFeedStatus('SUBSCRIBED');                    // recovery: exactly one sweep
      const afterRecover = { sweeps, views, ready: _sigFeedReady, down: _sigFeedDown, src: window.__lastSrc };
      _sigFeedStatus('SUBSCRIBED');                    // repeat SUBSCRIBED, no extra sweep
      const afterRepeat = { sweeps };
      checkNewSignatures = origCheck; _fetchProposalViews = origViews;
      return { afterConnect, afterError, afterRecover, afterRepeat };
    });
    expect(r.afterConnect.sweeps, 'initial connect must not sweep, boot already polls').toBe(0);
    expect(r.afterConnect.ready).toBe(true);
    expect(r.afterError.ready).toBe(false);
    expect(r.afterError.down).toBe(true);
    expect(r.afterRecover.sweeps, 'recovery after an outage = exactly one catch-up').toBe(1);
    expect(r.afterRecover.views).toBe(1);
    expect(r.afterRecover.src, 'catch-up is attributed to rejoin in telemetry').toBe('rejoin');
    expect(r.afterRecover.ready).toBe(true);
    expect(r.afterRecover.down).toBe(false);
    expect(r.afterRepeat.sweeps, 'a repeated SUBSCRIBED must not re-sweep').toBe(1);
    assertNoErrors(page, 'sig-feed health');
  });
});

test.describe('egress round 2, client hub poll cadence (live channel gates the interval)', () => {
  const { FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');
  const hubBase = {
    contractorUserId: FAKE_USER_ID, contractorName: 'Egress Painting', clientName: 'Hub Client',
    clientToken: FAKE_TOKEN, bids: [], jobs: [], payments: [],
  };

  async function boot(page, hub) {
    await page.addInitScript(d => { window.__mockHubData = d; }, hub);
    await mockAllExternal(page);
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
  }

  test('live channel healthy → refresh fires on every 10th tick (5 min); channel down → every tick (pre-fix 30s)', async ({ page }) => {
    await boot(page, hubBase);
    const r = await page.evaluate(() => {
      let refreshes = 0;
      const orig = _refreshHub;
      _refreshHub = () => { refreshes++; };
      _hubLiveOk = true; _hubTickN = 0;
      for (let i = 0; i < 20; i++) _hubPollTick();     // 20 ticks live = 2 refreshes
      const live = refreshes;
      refreshes = 0; _hubLiveOk = false; _hubTickN = 0;
      for (let i = 0; i < 10; i++) _hubPollTick();     // 10 ticks down = 10 refreshes
      const down = refreshes;
      _refreshHub = orig;
      return { live, down };
    });
    expect(r.live, 'healthy channel: 20 ticks → exactly 2 polls (every 10th)').toBe(2);
    expect(r.down, 'downed channel: every tick polls, todays exact behavior').toBe(10);
    assertNoErrors(page, 'hub poll cadence');
  });

  test('_hubNudgePeers is safe with no channel and sends only when the channel is healthy', async ({ page }) => {
    await boot(page, hubBase);
    const r = await page.evaluate(() => {
      let sent = 0;
      _hubLiveChan = null; _hubLiveOk = false;
      _hubNudgePeers();                                // must not throw with no channel
      _hubLiveChan = { send: () => { sent++; } };
      _hubNudgePeers();                                // channel present but NOT healthy, no send
      const whileDown = sent;
      _hubLiveOk = true;
      _hubNudgePeers();                                // healthy: sends
      return { whileDown, sent };
    });
    expect(r.whileDown).toBe(0);
    expect(r.sent).toBe(1);
    assertNoErrors(page, 'hub nudge peers');
  });
});

// ── PROPOSAL VIEWS AND AUDIT, KEPT AND TOPPED UP (egress 2026-10-01) ───────
// Sep 30 on the usage page: the full 500 view rows and 1,500 audit rows were
// pulled 966 and 972 times, on every fresh load and every tick after any view
// changed. Now both are kept (memory + zp3_acct_pv_<uid>) and a tick asks only
// for what changed. These prove the badges come out exactly as a full read
// would make them.
test.describe('egress round 3, proposal views and audit kept and topped up', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // A two-table fake that honours the filters the fetch uses.
    await page.evaluate(() => {
      window.__pvDb = { proposal_views: [], proposal_audit_events: [] };
      window.__pvLog = [];
      const mk = (tbl) => {
        const q = { f: [], ord: null, lim: null, sel: '*' };
        q.select = (c) => { q.sel = c || '*'; return q; };
        q.eq = (c, v) => { q.f.push((r) => String(r[c]) === String(v)); return q; };
        q.not = (c) => { q.f.push((r) => r[c] != null); return q; };
        q.gt = (c, v) => { q.gt_ = [c, v]; q.f.push((r) => (c === 'id' ? Number(r[c]) > Number(v) : String(r[c] || '') > String(v))); return q; };
        q.order = (c, o) => { q.ord = [c, !(o && o.ascending === false)]; return q; };
        q.limit = (n) => { q.lim = n; return q; };
        q.then = (res) => {
          window.__pvLog.push({ tbl, sel: q.sel, gt: q.gt_ || null });
          let rows = window.__pvDb[tbl].filter((r) => q.f.every((fn) => fn(r)));
          if (q.ord) {
            const [c, asc] = q.ord;
            rows = rows.slice().sort((a, b) => {
              const x = c === 'id' ? Number(a[c]) - Number(b[c]) : String(a[c] || '').localeCompare(String(b[c] || ''));
              return asc ? x : -x;
            });
          }
          if (q.lim) rows = rows.slice(0, q.lim);
          res({ data: rows.map((r) => (q.sel === 'updated_at' ? { updated_at: r.updated_at } : { ...r })), error: null });
        };
        return q;
      };
      window.__pvRealSupa = _supa;
      _supa = { ..._supa, from: (t) => (t === 'proposal_views' || t === 'proposal_audit_events') ? mk(t) : window.__pvRealSupa.from(t) };
    });
  });
  test.afterAll(async () => {
    await page.evaluate(() => { if (window.__pvRealSupa) _supa = window.__pvRealSupa; });
    await page.context().close();
  });

  // Reset everything this session holds, as a fresh page load would.
  const freshLoad = () => page.evaluate(() => { _pvUid = null; _pvKept = null; _pvPollWatermark = null; window._pvKeptPainted = null; });
  const forget = () => page.evaluate(() => { try { localStorage.removeItem('zp3_acct_pv_' + _supaUser.id); } catch (_e) {} });
  const maps = () => page.evaluate(() => JSON.stringify([_proposalViewsByBid, _proposalViewsByBidHubClient, _proposalViewsByBidClient,
    _proposalViewsByBidContractor, _proposalViewsByBidHubCount, _proposalViewsByBidClientCount, _proposalViewsByBidStep,
    _proposalViewsByBidStepAt, _proposalViewsByBidClientIp, _proposalViewsByBidHubIp, _proposalAuditEventsByBid]));
  const seed = (nViews, nAudit) => page.evaluate(([nv, na]) => {
    const uid = _supaUser.id;
    const t = (i) => new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString();
    window.__pvDb.proposal_views = Array.from({ length: nv }, (_, i) => ({
      id: 'v' + i, contractor_user_id: uid, bid_id: 'b' + (i % 37), opened_at: t(i), updated_at: t(i),
      hub_opened_at: i % 3 ? t(i + 1) : null, client_opened_at: i % 5 ? t(i + 2) : null, contractor_opened_at: null,
      hub_view_count: i % 4, client_view_count: i % 7, furthest_step: i % 9 === 0 ? 'approved' : null,
      furthest_step_at: i % 9 === 0 ? t(i + 3) : null, client_ip: '10.0.0.' + (i % 250), client_ua: 'ua', hub_ip: null, hub_ua: null,
    }));
    window.__pvDb.proposal_audit_events = Array.from({ length: na }, (_, i) => ({
      id: i + 1, contractor_user_id: uid, bid_id: 'b' + (i % 37), event: i % 2 ? 'open' : 'sign_step', ip_address: '1.1.1.1', user_agent: 'x', ts: t(i),
    }));
  }, [nViews, nAudit]);

  test('a change fetches only what changed, and the badges equal a full read', async () => {
    await seed(620, 1700);
    await freshLoad(); await forget();
    await page.evaluate(() => _fetchProposalViews());          // full read, kept
    // Edits: a view gets re-opened (moves to the top), counts change, a new
    // view and two new audit events arrive.
    await page.evaluate(() => {
      const later = (m) => new Date(Date.UTC(2026, 9, 1) + m * 60000).toISOString();
      const v = window.__pvDb.proposal_views;
      v[10].opened_at = later(1); v[10].updated_at = later(1); v[10].client_view_count = 99;
      v[600].hub_view_count = 42; v[600].updated_at = later(2);
      v.push({ ...v[0], id: 'vNEW', bid_id: 'bNEW', opened_at: later(3), updated_at: later(3), client_view_count: 5 });
      const a = window.__pvDb.proposal_audit_events;
      a.push({ ...a[0], id: 5001, bid_id: 'bNEW', ts: later(4) }, { ...a[1], id: 5002, bid_id: 'b3', ts: later(5) });
    });
    const n0 = await page.evaluate(() => window.__pvLog.length);
    await page.evaluate(() => _fetchProposalViews());
    const topped = await maps();
    const log = await page.evaluate((n) => window.__pvLog.slice(n), n0);
    expect(log.some((c) => c.tbl === 'proposal_views' && c.sel === '*' && !c.gt), 'no whole re-read of views').toBe(false);
    expect(log.some((c) => c.tbl === 'proposal_views' && c.gt && c.gt[0] === 'updated_at' && c.sel === '*')).toBe(true);
    expect(log.some((c) => c.tbl === 'proposal_audit_events' && c.gt && c.gt[0] === 'id')).toBe(true);

    // The same database read whole, from nothing.
    await freshLoad(); await forget();
    await page.evaluate(() => _fetchProposalViews());
    const whole = await maps();
    expect(topped).toBe(whole);
    expect(JSON.parse(topped)[5].bNEW).toBe(5);
  });

  test('a fresh page load paints from the kept copy and asks only the probe', async () => {
    await seed(50, 40);
    await freshLoad(); await forget();
    await page.evaluate(() => _fetchProposalViews());
    const before = await maps();
    await freshLoad();                                           // reload: memory gone, storage kept
    await page.evaluate(() => { _proposalViewsByBid = {}; _proposalAuditEventsByBid = {}; });
    const n0 = await page.evaluate(() => window.__pvLog.length);
    await page.evaluate(() => _fetchProposalViews());
    const log = await page.evaluate((n) => window.__pvLog.slice(n), n0);
    expect(log.map((c) => c.sel), 'probe only, no 500-row read').toEqual(['updated_at']);
    expect(await maps()).toBe(before);
  });

  test('a delta that fills its page, a stale copy and a failed probe all read whole', async () => {
    await seed(60, 10);
    await freshLoad(); await forget();
    await page.evaluate(() => _fetchProposalViews());
    // 500 changed rows at once.
    await page.evaluate(() => {
      const later = (m) => new Date(Date.UTC(2026, 9, 2) + m * 1000).toISOString();
      for (let i = 0; i < 500; i++) window.__pvDb.proposal_views.push({ ...window.__pvDb.proposal_views[0], id: 'w' + i, opened_at: later(i), updated_at: later(i) });
    });
    let n0 = await page.evaluate(() => window.__pvLog.length);
    await page.evaluate(() => _fetchProposalViews());
    let log = await page.evaluate((n) => window.__pvLog.slice(n), n0);
    expect(log.some((c) => c.tbl === 'proposal_views' && c.sel === '*' && !c.gt), 'cut-short delta falls back to a whole read').toBe(true);

    // Older than six hours: whole read.
    await page.evaluate(() => { _pvKept.fullAt = Date.now() - 7 * 3600000; });
    n0 = await page.evaluate(() => window.__pvLog.length);
    await page.evaluate(() => _fetchProposalViews());
    log = await page.evaluate((n) => window.__pvLog.slice(n), n0);
    expect(log.some((c) => c.tbl === 'proposal_views' && c.sel === '*' && !c.gt)).toBe(true);
  });

  test('the kept copy is per account, cleared on sign-out, and survives corruption', async () => {
    const r = await page.evaluate(() => {
      const uid = _supaUser.id;
      const had = !!localStorage.getItem('zp3_acct_pv_' + uid);
      localStorage.setItem('zp3_acct_pv_someone-else', JSON.stringify({ uid: 'someone-else', views: [], audit: [] }));
      _tdClearAccountStorage();
      const gone = !localStorage.getItem('zp3_acct_pv_' + uid) && !localStorage.getItem('zp3_acct_pv_someone-else');
      localStorage.setItem('zp3_acct_pv_' + uid, '{bad json{{');
      _pvUid = null; _pvKept = null;
      let threw = false;
      try { _pvLoadKept(uid); } catch (_e) { threw = true; }
      // Another account's copy is never read into this one.
      localStorage.setItem('zp3_acct_pv_' + uid, JSON.stringify({ uid: 'not-me', views: [{ id: 'x', bid_id: 'bX' }], audit: [] }));
      _pvUid = null; _pvKept = null;
      const foreign = _pvLoadKept(uid);
      return { had, gone, threw, keptAfterBad: _pvKept, foreign };
    });
    expect(r.had).toBe(true);
    expect(r.gone, 'sign-out takes every account copy').toBe(true);
    expect(r.threw).toBe(false);
    expect(r.keptAfterBad).toBe(null);
    expect(r.foreign).toBe(null);
  });

  test('an old view updated outside the newest 500 never wedges the probe', async () => {
    // No audit rows, so nothing is kept and every hit takes the whole-read
    // path, which only sees the newest 500. The probe row has to move the
    // watermark itself or this change reads positive on every tick forever.
    await seed(620, 0);
    await page.evaluate(() => { window.__pvDb.proposal_audit_events = null; });   // the audit read fails: nothing is kept
    await freshLoad(); await forget();
    await page.evaluate(() => _fetchProposalViews());
    expect(await page.evaluate(() => _pvKept), 'whole-read path').toBe(null);
    await page.evaluate(() => {
      const v = window.__pvDb.proposal_views;
      v[3].updated_at = new Date(Date.UTC(2026, 9, 1, 9)).toISOString();   // opened long ago: not in the newest 500
    });
    await page.evaluate(() => _fetchProposalViews());                       // sees the change once
    const n0 = await page.evaluate(() => window.__pvLog.length);
    await page.evaluate(() => _fetchProposalViews());
    const log = await page.evaluate((n) => window.__pvLog.slice(n), n0);
    expect(log.map((c) => c.tbl + ':' + c.sel), 'the next tick is the probe alone').toEqual(['proposal_views:updated_at']);
    await page.evaluate(() => { window.__pvDb.proposal_audit_events = []; });
  });

  test('no console errors from the kept-views suite', async () => {
    assertNoErrors(page, 'kept proposal views');
  });
});

// ── Round 4: Crew rows kept and topped up (2026-10-01) ──────────────────────
// The Time Log revalidates its crew payload on every open and live update,
// and each time _fetchCrewLabor downloaded every job and shop row for six
// months. Now the first plain read is kept in memory and the next asks only
// for rows whose updated_at moved (migration 20261059). These prove every
// caller still gets exactly the rows the old queries returned.
test.describe('egress round 4, crew rows kept and topped up', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.__cDb = { job_time_entries: [], shop_time_entries: [], team_members: [] };
      window.__cLog = [];
      window.__cFail = false;
      const mk = (tbl) => {
        const q = { f: [], sel: '*', lo: 0, hi: Infinity, delta: false };
        q.select = (c) => { q.sel = c || '*'; return q; };
        q.eq = (c, v) => { q.f.push((r) => String(r[c]) === String(v)); return q; };
        q.is = (c, v) => { q.f.push((r) => (r[c] ?? null) === v); return q; };
        q.gte = (c, v) => { if (c === 'updated_at') q.delta = true; q.f.push((r) => r[c] != null && Date.parse(r[c]) >= Date.parse(v)); return q; };
        q.lt = (c, v) => { q.f.push((r) => r[c] != null && Date.parse(r[c]) < Date.parse(v)); return q; };
        q.or = (expr) => {
          const parts = [...expr.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(',').map((x) => x.replace(/^"|"$/g, ''))]);
          q.f.push((r) => parts.some(([c, vals]) => r[c] != null && vals.includes(String(r[c]))));
          q.only = true; return q;
        };
        const run = () => {
          window.__cLog.push({ tbl, delta: q.delta, only: !!q.only });
          if (window.__cFail && q.delta) return { data: null, error: { message: 'column updated_at does not exist' } };
          const rows = window.__cDb[tbl].filter((r) => q.f.every((fn) => fn(r))).slice(q.lo, q.hi + 1);
          const cols = q.sel.split(',');
          return { data: rows.map((r) => (q.sel === '*' ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))), error: null };
        };
        q.range = async (a, b) => { q.lo = a; q.hi = b; return run(); };
        q.then = (res, rej) => Promise.resolve(run()).then(res, rej);
        return q;
      };
      window.__cRealSupa = _supa;
      _supa = { ..._supa, from: (t) => (window.__cDb[t] ? mk(t) : window.__cRealSupa.from(t)) };
    });
  });
  test.afterAll(async () => {
    await page.evaluate(() => { if (window.__cRealSupa) _supa = window.__cRealSupa; });
    await page.context().close();
  });

  const seed = () => page.evaluate(() => {
    const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
    const at = (d, h) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
    const old = new Date(Date.UTC(2026, 8, 30)).toISOString();
    window.__cDb.job_time_entries = Array.from({ length: 120 }, (_, i) => ({
      id: 'j' + i, contractor_user_id: cid, employee_user_id: 'e' + (i % 3), job_id: i % 4 ? String(100 + (i % 7)) : null,
      minutes: 30 + i, arrived_at: at(1 + (i % 28), 8 + (i % 8)), departed_at: at(1 + (i % 28), 9 + (i % 8)),
      source: i % 5 ? 'geo' : 'drive', dest_place: i % 4 ? null : 'Place ' + (i % 6), origin_place: i % 9 ? null : 'Place 2',
      client_key: 'k' + i, deleted_at: i === 7 ? old : null, updated_at: old,
    }));
    window.__cDb.shop_time_entries = Array.from({ length: 20 }, (_, i) => ({
      id: 's' + i, contractor_user_id: cid, client_key: 'sk' + i, employee_user_id: 'e' + (i % 3), minutes: 40,
      arrived_at: at(1 + i, 6), departed_at: at(1 + i, 7), deleted_at: null, updated_at: old,
    }));
    _crewKept = null;
  });
  const norm = (r) => JSON.stringify({ e: r.entries.slice().sort((a, b) => a.id.localeCompare(b.id)), s: r.shopEntries.slice().sort((a, b) => a.id.localeCompare(b.id)) });
  const SINCE = '2026-09-01T00:00:00.000Z';

  test('edits, adds and deletes come over as a top-up, and match the old queries row for row', async () => {
    await seed();
    await page.evaluate((s) => _fetchCrewLabor(s), SINCE);                // seeds the copy
    await page.evaluate(() => {
      const now = new Date(Date.UTC(2026, 9, 1, 12)).toISOString();
      const j = window.__cDb.job_time_entries;
      j[3].minutes = 999; j[3].updated_at = now;                            // edited
      j[4].deleted_at = now; j[4].updated_at = now;                         // soft deleted
      j.push({ ...j[5], id: 'jNEW', minutes: 7, updated_at: now });         // added
      const sh = window.__cDb.shop_time_entries;
      sh[2].deleted_at = now; sh[2].updated_at = now;
    });
    const n0 = await page.evaluate(() => window.__cLog.length);
    const kept = await page.evaluate((s) => _fetchCrewLabor(s), SINCE);
    const log = await page.evaluate((n) => window.__cLog.slice(n), n0);
    expect(log.filter((c) => c.tbl !== 'team_members').every((c) => c.delta), 'only top-ups, no whole re-read').toBe(true);

    await page.evaluate(() => { _crewKept = null; window.__cFail = true; });
    const fresh = await page.evaluate((s) => _fetchCrewLabor(s), SINCE);    // old queries, column refused
    await page.evaluate(() => { window.__cFail = false; });
    expect(norm(kept)).toBe(norm(fresh));
    expect(kept.entries.find((r) => r.id === 'j3').minutes).toBe(999);
    expect(kept.entries.some((r) => r.id === 'j4' || r.id === 'j7')).toBe(false);
    expect(kept.entries.some((r) => r.id === 'jNEW')).toBe(true);
    expect(Object.keys(kept.entries[0]).sort()).toEqual('id,employee_user_id,job_id,minutes,arrived_at,departed_at,source,dest_place,origin_place,client_key'.split(',').sort());
  });

  test('one customer, one stretch and no shop off the copy equal the server filters', async () => {
    await seed();
    await page.evaluate((s) => _fetchCrewLabor(s), SINCE);
    const variants = [
      { untilISO: '2026-09-15T00:00:00.000Z' },
      { noShop: true, only: { jobIds: ['101', '103'], places: ['Place 2'] } },
      { noShop: true, only: { jobIds: [], places: ['Place 0'] } },
    ];
    for (const v of variants) {
      const n0 = await page.evaluate(() => window.__cLog.length);
      const kept = await page.evaluate(([s, o]) => _fetchCrewLabor(s, o), ['2026-09-05T00:00:00.000Z', v]);
      const log = await page.evaluate((n) => window.__cLog.slice(n), n0);
      expect(log.some((c) => c.only), 'answered off the copy').toBe(false);
      const saved = await page.evaluate(() => { const k = _crewKept; _crewKept = null; return !!k; });
      expect(saved).toBe(true);
      const fresh = await page.evaluate(([s, o]) => _fetchCrewLabor(s, o), ['2026-09-05T00:00:00.000Z', v]);
      expect(norm(kept), JSON.stringify(v)).toBe(norm(fresh));
      expect(kept.entries.length).toBeGreaterThan(0);
      await page.evaluate((s) => _fetchCrewLabor(s), SINCE);                // re-seed for the next variant
    }
  });

  test('an older window, another account, a stale copy or a failed top-up read whole', async () => {
    await seed();
    await page.evaluate((s) => _fetchCrewLabor(s), SINCE);
    const whole = async (fn) => {
      const n0 = await page.evaluate(() => window.__cLog.length);
      await page.evaluate(fn);
      const log = await page.evaluate((n) => window.__cLog.slice(n), n0);
      return log.some((c) => c.tbl === 'job_time_entries' && !c.delta);
    };
    expect(await whole(() => _fetchCrewLabor('2026-08-01T00:00:00.000Z')), 'older than the copy').toBe(true);
    expect(await whole(() => { _crewKept.cid = 'someone-else'; return _fetchCrewLabor('2026-09-01T00:00:00.000Z'); }), 'other account').toBe(true);
    expect(await whole(() => { _crewKept.fullAt -= 7 * 3600000; return _fetchCrewLabor('2026-09-01T00:00:00.000Z'); }), 'stale').toBe(true);
    expect(await whole(() => { window.__cFail = true; return _fetchCrewLabor('2026-09-01T00:00:00.000Z').finally(() => { window.__cFail = false; }); }), 'failed top-up').toBe(true);
    // A top-up that fills its page is not trusted.
    await page.evaluate((s) => _fetchCrewLabor(s), SINCE);
    await page.evaluate(() => {
      const now = new Date(Date.UTC(2026, 9, 1, 12)).toISOString();
      window.__cDb.job_time_entries.forEach((r) => { r.updated_at = now; });
      for (let i = 0; i < 1000; i++) window.__cDb.job_time_entries.push({ ...window.__cDb.job_time_entries[0], id: 'f' + i, updated_at: now });
    });
    expect(await whole(() => _fetchCrewLabor('2026-09-01T00:00:00.000Z')), 'full page').toBe(true);
  });

  test('no console errors from the kept-crew suite', async () => {
    assertNoErrors(page, 'kept crew rows');
  });
});
