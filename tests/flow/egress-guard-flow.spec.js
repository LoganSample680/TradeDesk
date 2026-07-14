// REAL flow — the egress-fix package proven against the real backend
// (owner mandate 2026-07-14: "fix them all and write flow tests to see and
// ensure nothing went wrong"). Three guards:
//
//   1. Signature pipeline: a NEW signed_proposals row still flips the bid to
//      Closed Won and queues the "New signature!" alert (the real-time-notify
//      regression guard), while the steady-state poll goes quiet — on a
//      migrated database the second poll is a delta (updated_at=gt.…) that
//      returns zero rows instead of 100 rows of base64 signatures.
//   2. Hub logo: the snapshot uploads the logo ONCE and carries a URL — the
//      hub JSON in storage must hold logoUrl and an EMPTY logoData, and the
//      URL must actually serve the image.
//   3. Photo pipeline: a real photo pushed through the REAL gallery uploader
//      lands compressed with a 360px thumbnail alongside, and both objects
//      download from storage.
//
//   suspect chain: cloud.js checkNewSignatures (watermark) → proposals.js
//   _ensureLogoUrl/_buildClientHubSnapshot → jobs.js _compressPhoto +
//   proposals.js processGalleryUpload.
//
// Seed data is left in the dev account per CLAUDE.md §12.7 — no cleanup.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

// 4×4 red PNG data URL — small but real, decodable by createImageBitmap.
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8z8DwnwEJMDEgAXQOAEvUAgVGLXA0AAAAAElFTkSuQmCC';

test.describe('egress guards (UI-driven, real backend)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a new signature still lands instantly while the steady-state poll transfers ~nothing', async ({ page }) => {
    const FLOW = 'egress/signature-poll';
    const stamp = process.pid;
    const clientId = Date.now() * 1000 + (stamp % 1000);
    const bidId = clientId + 1;
    let ctx = {};

    await step(page, {
      label: 'send a real proposal to sign against', page: 'cloud', role: 'contractor',
      suspect: 'seedProposal storage upload + td_bids',
      ruleText: 'seeding must yield a pending bid + signing token',
      expected: 'token + uid present',
      act: async (p) => { ctx = await seedProposal(p, { clientId, bidId, amount: 2600, tag: 'egress' }); return 1; },
      rule: async () => ({ ok: !ctx.uploadErr && !!ctx.token, got: `err=${ctx.uploadErr} token=${!!ctx.token}` }),
    });

    await step(page, {
      label: 'signature row lands → alert queued; next poll is a quiet delta', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js checkNewSignatures (updated_at watermark + fallback)',
      ruleText: 'a signed_proposals INSERT after the watermark must flip the bid Closed Won and queue the schedule alert; the FOLLOWING poll must return zero rows (delta) or fall back cleanly (un-migrated env)',
      expected: 'bid Closed Won + alert queued + quiet steady-state poll',
      act: async (p) => {
        // Capture every signed_proposals REST response so the rule can inspect
        // what the steady-state poll actually transferred.
        p.__sigResponses = [];
        p.on('response', async (res) => {
          const u = res.url();
          if (u.includes('/rest/v1/signed_proposals') && res.request().method() === 'GET') {
            let rows = -1; try { const j = await res.json(); rows = Array.isArray(j) ? j.length : -1; } catch (_e) {}
            p.__sigResponses.push({ url: u, rows });
          }
        });
        await p.evaluate(async ({ bidId }) => {
          localStorage.setItem('zp3_seen_sigs', '[]');
          localStorage.setItem('zp3_schedule_alerts', '[]');
          window._showingScheduleAlert = true; // hold the modal so the queue stays inspectable
          await checkNewSignatures();          // establish the session watermark
          // The client signs (cash path writes this row via the edge fn in real
          // life; the contractor session owns the row either way).
          await _supa.from('signed_proposals').upsert({
            bid_id: String(bidId), contractor_user_id: _supaUser.id,
            client_name: 'Egress Guard Client', client_signed_name: 'Egress Guard Client',
            amount: 2600, deposit: 650, signed_at: new Date().toISOString(),
            payment_method: 'cash', payment_status: 'pending_cash',
            signature_data: 'data:image/png;base64,egressguardsig',
          }, { onConflict: 'bid_id' });
          // Poll until the row is processed. The sig-feed PUSH handler races these
          // calls on a shared dev account (the other browser's job inserts rows
          // too) — the coalescing guard ensures every call still lands a poll, but
          // WHICH invocation processes the row is non-deterministic, so wait for
          // the observable outcome instead of assuming a fixed call count.
          const t0 = Date.now();
          while (Date.now() - t0 < 8000) {
            await checkNewSignatures();
            const b = bids.find(x => String(x.id) === String(bidId));
            if (b && b.status === 'Closed Won') break;
            await new Promise(r => setTimeout(r, 300));
          }
          await checkNewSignatures();          // steady-state: must transfer ~nothing
        }, { bidId });
        await p.waitForTimeout(400);
        return 3;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => String(x.id) === String(bidId));
          const alerts = JSON.parse(localStorage.getItem('zp3_schedule_alerts') || '[]');
          return { status: b ? b.status : 'NO BID', signedName: b ? b.signedName : '', alertQueued: alerts.some(a => String(a.bidId) === String(bidId)) };
        }, { bidId });
        const polls = p.__sigResponses || [];
        const last = polls[polls.length - 1] || { url: '', rows: -1 };
        const deltaActive = last.url.includes('updated_at=gt.');
        // Migrated env: the steady-state delta transfers ~nothing — a few rows are
        // tolerated because the OTHER browser's job writes to the same dev account
        // mid-test. What it must never be is the pre-fix 100-row full dump.
        // Un-migrated env: the fallback full poll ran (rows >= 1) — allowed.
        const quietOk = deltaActive ? last.rows <= 5 : last.rows >= 0;
        const ok = r.status === 'Closed Won' && r.alertQueued && quietOk;
        return { ok, got: `status=${r.status} alert=${r.alertQueued} lastPoll[delta=${deltaActive} rows=${last.rows}] polls=${polls.length}` };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('hub snapshot ships a logo URL (not megabytes of base64) and the URL serves', async ({ page }) => {
    const FLOW = 'egress/hub-logo';
    const stamp = process.pid;
    const clientId = Date.now() * 1000 + (stamp % 1000) + 5;
    let out = {};

    await step(page, {
      label: 'set a logo → refresh a client hub → inspect the stored snapshot', page: 'cloud', role: 'contractor',
      suspect: 'proposals.js _ensureLogoUrl + _buildClientHubSnapshot (logoUrl/logoData)',
      ruleText: 'after a hub refresh the stored hub JSON must carry logoUrl (fetchable, 200) and an EMPTY logoData',
      expected: 'snapshot.logoUrl set + fetch 200 + snapshot.logoData empty',
      act: async (p) => {
        out = await p.evaluate(async ({ clientId, png }) => {
          clients.push({ id: clientId, name: `Egress Logo Client ${Date.now()}`, _e2e: 'egress' });
          // Use the account's REAL logo when one exists — the pipeline proof
          // (upload once → snapshot carries a fetchable URL + empty logoData)
          // holds for any image. Only seed the tiny red test PNG when the
          // account has no logo at all: branding is owner-facing, account-wide
          // state, and clobbering it every run put a red test square on the
          // owner's phone (§12.7 means ACCUMULATE seed data, never REPLACE the
          // owner's own).
          if (!S.logoData) S.logoData = png;
          S.logoUrl = ''; S.logoHash = '';
          // Diagnostic probe: replicate _ensureLogoUrl's exact upload call
          // directly so a rejection surfaces its real error (message/status)
          // in the test's `got:` output — _ensureLogoUrl itself swallows
          // errors by design (graceful-degradation) and browser console
          // output is not piped into the CI job log.
          let probeErr = '';
          try {
            const _h = String(_hubHash(S.logoData));
            const m = S.logoData.match(/^data:(image\/[a-z0-9+.-]+);base64,(.*)$/s);
            const bytes = Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0));
            const blob = new Blob([bytes], { type: m[1] });
            const ext = (m[1].split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
            const path = _effectiveUid() + '/branding/logo-' + _h.replace('-', 'n') + '.' + ext;
            const { error } = await _supa.storage.from('gallery').upload(path, blob, { contentType: m[1], upsert: true, cacheControl: '31536000' });
            if (error) probeErr = `probe upload failed: status=${error.statusCode || error.status || '?'} msg=${error.message || JSON.stringify(error)}`;
          } catch (_e) { probeErr = 'probe threw: ' + (_e && _e.message); }
          S.logoUrl = ''; S.logoHash = ''; // reset — the real path below must reproduce it itself
          await _uploadClientHub(clientId);
          await new Promise(r => setTimeout(r, 1500)); // background refresh path
          const c = clients.find(x => x.id === clientId);
          if (!c || !c.clientHubKey) return { err: 'no hub key stamped', probeErr };
          const { data, error } = await _supa.storage.from('proposals').download(c.clientHubKey);
          if (error || !data) return { err: 'hub download failed: ' + (error && error.message), probeErr };
          const snap = JSON.parse(await data.text());
          let logoStatus = 0;
          if (snap.logoUrl) { try { logoStatus = (await fetch(snap.logoUrl)).status; } catch (_e) { logoStatus = -1; } }
          return { logoUrl: snap.logoUrl || '', logoDataLen: (snap.logoData || '').length, logoStatus, probeErr };
        }, { clientId, png: RED_PNG });
        return 2;
      },
      rule: async () => {
        const ok = !out.err && !!out.logoUrl && out.logoDataLen === 0 && out.logoStatus === 200;
        return { ok, got: (out.err || `logoUrl=${!!out.logoUrl} logoDataLen=${out.logoDataLen} fetch=${out.logoStatus}`) + (out.probeErr ? ` | ${out.probeErr}` : '') };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a photo uploaded through the real gallery flow lands compressed with a downloadable thumbnail', async ({ page }) => {
    const FLOW = 'egress/photo-thumbs';
    let out = {};

    await step(page, {
      label: 'open gallery upload → choose a real photo → thumbnail + compressed main land in storage', page: 'pg-gallery', role: 'contractor',
      suspect: 'jobs.js _compressPhoto/_uploadPhotoThumb + proposals.js processGalleryUpload',
      ruleText: 'the uploaded photo must be JPEG-compressed (≤1600px), carry a thumbUrl, and BOTH objects must download from storage',
      expected: 'photos[] entry with thumbUrl + main and thumb download ok + main bytes < original bytes',
      act: async (p) => {
        await p.evaluate(() => openGalleryUpload());
        // #gup-file is a deliberately HIDDEN native file input (triggered via a
        // styled "Choose photos" button) — waitForSelector defaults to visible,
        // which never resolves for it; 'attached' matches the real UX contract.
        await p.waitForSelector('#gup-file', { state: 'attached', timeout: 8000 });
        // A real 2400×1200 JPEG generated in-page (~deterministic, no fixture file).
        const big = await p.evaluate(async () => {
          const cv = document.createElement('canvas'); cv.width = 2400; cv.height = 1200;
          const ctx = cv.getContext('2d');
          for (let i = 0; i < 24; i++) { ctx.fillStyle = `hsl(${i * 15},70%,50%)`; ctx.fillRect(i * 100, 0, 100, 1200); }
          const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          return { b64: btoa(bin), size: blob.size };
        });
        await p.setInputFiles('#gup-file', { name: 'egress-test.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big.b64, 'base64') });
        await p.waitForTimeout(3500); // real upload round-trips
        out = await p.evaluate(async ({ origSize }) => {
          const ph = photos[photos.length - 1];
          if (!ph || !ph.storagePath) return { err: 'no uploaded photo entry' };
          const dl = async (path) => { const { data, error } = await _supa.storage.from('gallery').download(path); return (data && !error) ? data.size : -1; };
          const mainBytes = await dl(ph.storagePath);
          const thumbBytes = ph.thumbPath ? await dl(ph.thumbPath) : -1;
          return { thumbUrl: ph.thumbUrl || '', mainBytes, thumbBytes, origSize };
        }, { origSize: big.size });
        return 4;
      },
      rule: async () => {
        const ok = !out.err && !!out.thumbUrl && out.mainBytes > 0 && out.thumbBytes > 0
          && out.mainBytes < out.origSize && out.thumbBytes < out.mainBytes;
        return { ok, got: out.err || `thumbUrl=${!!out.thumbUrl} main=${out.mainBytes}B thumb=${out.thumbBytes}B orig=${out.origSize}B` };
      },
    });

    // NO cleanup — the client, photo + thumbnail stay in the dev account on
    // purpose so the owner can inspect them (CLAUDE.md §12.7).
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('a signature lands via REALTIME PUSH alone — no poll call — and the alert fires in seconds', async ({ page }) => {
    const FLOW = 'egress/realtime-push';
    const stamp = process.pid;
    const clientId = Date.now() * 1000 + (stamp % 1000) + 9;
    const bidId = clientId + 1;
    let ctx = {};

    await step(page, {
      label: 'send a real proposal for the push test', page: 'cloud', role: 'contractor',
      suspect: 'seedProposal storage upload + td_bids',
      ruleText: 'seeding must yield a pending bid + signing token',
      expected: 'token + uid present',
      act: async (p) => { ctx = await seedProposal(p, { clientId, bidId, amount: 3100, tag: 'rtpush' }); return 1; },
      rule: async () => ({ ok: !ctx.uploadErr && !!ctx.token, got: `err=${ctx.uploadErr} token=${!!ctx.token}` }),
    });

    await step(page, {
      label: 'sig-feed SUBSCRIBED → INSERT row → bid flips with ZERO poll calls', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js _initRealtimeSubscriptions sig-feed channel + _sigFeedStatus',
      ruleText: 'with the poll never invoked, a signed_proposals INSERT must flip the bid Closed Won via the realtime push handler within ~12s — this is the proof that push, not the poll, carries signatures',
      expected: 'sig-feed SUBSCRIBED + Closed Won via push + alert queued',
      act: async (p) => {
        const r = await p.evaluate(async ({ bidId }) => {
          // Wait for the channel to report SUBSCRIBED (health flag added this PR).
          const t0 = Date.now();
          while (!_sigFeedReady && Date.now() - t0 < 10000) await new Promise(x => setTimeout(x, 200));
          if (!_sigFeedReady) return { subscribed: false };
          localStorage.setItem('zp3_seen_sigs', '[]');
          localStorage.setItem('zp3_schedule_alerts', '[]');
          window._showingScheduleAlert = true; // hold the modal so the queue stays inspectable
          await _supa.from('signed_proposals').upsert({
            bid_id: String(bidId), contractor_user_id: _supaUser.id,
            client_name: 'Push Proof Client', client_signed_name: 'Push Proof Client',
            amount: 3100, deposit: 775, signed_at: new Date().toISOString(),
            payment_method: 'cash', payment_status: 'pending_cash',
            signature_data: 'data:image/png;base64,pushproofsig',
          }, { onConflict: 'bid_id' });
          // NO checkNewSignatures() call — the realtime handler must do the work.
          const t1 = Date.now();
          let flipped = false;
          while (Date.now() - t1 < 12000) {
            const b = bids.find(x => String(x.id) === String(bidId));
            if (b && b.status === 'Closed Won') { flipped = true; break; }
            await new Promise(x => setTimeout(x, 250));
          }
          return { subscribed: true, flipped, ms: Date.now() - t1 };
        }, { bidId });
        p.__pushResult = r;
        return 2;
      },
      rule: async (p) => {
        const r = p.__pushResult || {};
        const alerts = await p.evaluate(() => JSON.parse(localStorage.getItem('zp3_schedule_alerts') || '[]'));
        const alertQueued = alerts.some(a => String(a.bidId) === String(bidId));
        const ok = !!r.subscribed && !!r.flipped && alertQueued;
        return { ok, got: `subscribed=${r.subscribed} flippedViaPush=${r.flipped} in ${r.ms}ms alert=${alertQueued}` };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
