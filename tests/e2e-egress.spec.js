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
    window.__origSupa = _supa;
    _supa = { ..._supa, from: (tbl) => tbl === 'signed_proposals' ? mkQuery() : window.__origSupa.from(tbl) };
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

  test('schedule popup NEVER surfaces over the boot spinner, it defers until the overlay is gone', async () => {
    const r = await page.evaluate(async () => {
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

  test('gallery grid renders the THUMB; the photo viewer renders the FULL image', async () => {
    const r = await page.evaluate(() => {
      photos = [{ id: 'eg-1', url: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/full-1.jpg',
        thumbUrl: 'https://mock.supabase.co/storage/v1/object/public/gallery/u/t-full-1.jpg',
        type: 'after', caption: '', client_name: 'Thumb Client', uploadedAt: new Date().toISOString() }];
      renderGallery();
      const grid = document.getElementById('gallery-grid')?.innerHTML || '';
      openPhotoViewer('eg-1');
      const viewers = [...document.querySelectorAll('img')].map(i => i.src);
      const viewerHasFull = viewers.some(s => s.includes('/full-1.jpg') && !s.includes('/t-full-1.jpg'));
      document.querySelectorAll('div').forEach(d => { if (d.style.zIndex === '9999') d.remove(); });
      return { gridUsesThumb: grid.includes('t-full-1.jpg'), viewerHasFull };
    });
    expect(r.gridUsesThumb).toBe(true);
    expect(r.viewerHasFull).toBe(true);
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
    window.__origSupaPv = _supa;
    _supa = { ..._supa, from: (tbl) => tbl === 'proposal_views' ? mkQuery() : window.__origSupaPv.from(tbl) };
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
