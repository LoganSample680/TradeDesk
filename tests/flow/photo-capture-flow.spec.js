// REAL flow: jobsite photos, shot in every place a contractor actually shoots
// them, ending where the owner said they have to end up: "they all should land
// in the client hub link I send out under before and after" (2026-09-21).
//
// The journey the owner signed off on, in order:
//   1. shoot on an estimate (no job exists yet)
//   2. schedule the bid, and the estimate's Before set becomes the job's
//   3. shoot the After on the finished job
//   4. shoot with no customer at all, then file it in one tap
//   5. open the REAL hub snapshot as the client and read the pair back
//
// Nothing here is seeded into photos[] by hand. Every row is written by the
// real writer (tdSavePhoto) against real Supabase storage, and the hub
// assertion reads the snapshot the app actually uploads, not a local array.
// Leaves its seed data behind on purpose (§12.7).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'photo-capture/estimate-to-hub';

// A PHOTO-SIZED frame, drawn in the page. The first version of this spec used
// a 1x1 JPEG and the live run failed on it: there is nothing for the stamp to
// draw onto at one pixel, so the "is the stamp in the bytes" assertion was
// measuring an empty canvas (759 bytes, which is just what a 1x1 JPEG weighs).
// A real photo also makes the writer take the real path: compress to a
// 1600px long edge, build a 360px thumbnail, upload both.
async function shootInPage(page, opts) {
  return page.evaluate(async (o) => {
    // Drawn here rather than passed in, so no eval and nothing for a CSP to
    // object to. Seeded so every frame in a run is identical: the stamp
    // proof below compares two uploads byte for byte and a varying source
    // would make that comparison meaningless.
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 900;
    const g = cv.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 900);
    sky.addColorStop(0, '#9fb4c7'); sky.addColorStop(.55, '#c3cdd6');
    sky.addColorStop(.56, '#b9a98d'); sky.addColorStop(1, '#d8cbb2');
    g.fillStyle = sky; g.fillRect(0, 0, 1200, 900);
    g.fillStyle = 'rgba(120,110,95,.55)'; g.fillRect(120, 300, 420, 300);
    const file = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
    file.name = 'shot.jpg';
    const row = await tdSavePhoto({ file, type: o.type, caption: o.caption, clientId: o.clientId, bidId: o.bidId, jobId: o.jobId, stamp: o.stamp });
    return row ? { id: row.id, url: row.url, thumbUrl: row.thumbUrl, type: row.type, bid_id: row.bid_id, job_id: row.job_id, client_id: row.client_id, pending: !!row.pendingUpload } : null;
  }, opts);
}

test.describe('jobsite photos: estimate → job → client hub', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('shoot on the estimate, on the job, and unfiled, and read them all back out of the real hub', async ({ page }) => {
    const stamp = Date.now() * 1000 + (process.pid % 1000);
    // Coordinates on the customer AND on the shots, because "verified on
    // site" is the whole proof chain and a flow that never sets a fix can
    // only ever prove it is absent.
    const client = { id: stamp, name: `E2E Photo ${RUN_TAG.slice(-5)}`, addr: '414 Test Ave, Wichita, KS 67202', phone: '3165550414', lat: 37.68890, lon: -97.33610 };
    const bidId = stamp + 1;
    const jobId = stamp + 2;

    // ── STEP 1: a customer and an estimate to shoot against ──────────────────
    await step(page, {
      label: 'create the client + a proposal to shoot against', page: 'pg-clients', role: 'contractor',
      suspect: 'data.js clients/bids arrays',
      ruleText: 'a photo needs something to attach to before the camera is worth opening',
      expected: 'client and bid present',
      act: async (p) => {
        await p.evaluate(({ c, bidId }) => {
          clients.push({ id: c.id, name: c.name, addr: c.addr, phone: c.phone, lat: c.lat, lon: c.lon });
          bids.push({ id: bidId, client_id: c.id, client_name: c.name, title: 'Exterior repaint', amount: 2300, status: 'Pending' });
          saveAll();
        }, { c: client, bidId });
        // Setup, not user friction: the intake and estimate flows already
        // measure what it costs to create these.
        return 0;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ id, bidId }) => ({ c: !!clients.find(x => x.id === id), b: !!bids.find(x => x.id === bidId) }), { id: client.id, bidId });
        return { ok: r.c && r.b, got: JSON.stringify(r) };
      },
    });

    // ── STEP 2: the camera on the estimate ───────────────────────────────────
    // This is the whole ask. Before this existed, no estimate type had a
    // camera and this step was impossible.
    let beforeShots = [];
    await step(page, {
      label: 'shoot two Before photos on the estimate', page: 'pg-est-generic', role: 'contractor',
      suspect: 'photo-capture.js tdSavePhoto (bid tag + storage upload)',
      ruleText: 'a photo shot on an estimate uploads for real and carries both the bid and the client',
      expected: 'two rows with a public url, bid_id set, client_id inferred, nothing pending',
      act: async (p) => {
        beforeShots = [
          await shootInPage(p, { type: 'before', bidId, caption: 'South elevation', lat: 37.68893, lon: -97.33607 }),
          await shootInPage(p, { type: 'before', bidId, caption: 'Trim, bare wood', lat: 37.68888, lon: -97.33612 }),
        ];
        // Open the sheet (1) + two shutter taps (2). The type toggle is not
        // charged: Before is the default on an estimate.
        return 3;
      },
      rule: async () => {
        const ok = beforeShots.length === 2 && beforeShots.every(s =>
          s && !s.pending && /^https?:\/\//.test(s.url || '') && s.bid_id === bidId && s.client_id === client.id && s.job_id === null);
        return { ok, got: JSON.stringify(beforeShots.map(s => s && { url: (s.url || '').slice(-28), bid: s.bid_id, job: s.job_id, thumb: !!s.thumbUrl, pending: s.pending })) };
      },
    });

    // THE STAMP IS IN THE BYTES, proven DIFFERENTIALLY against the objects
    // that are actually in storage. "Bigger than some number" was the wrong
    // test and the live run said so: the only honest proof is the SAME frame
    // uploaded twice, once stamped and once not, and the stamped one carrying
    // more bytes because it carries more pixels. Not charged to the ledger:
    // the control shot is a measurement, not something a contractor does.
    const control = await shootInPage(page, { type: 'progress', bidId, caption: 'stamp-off control', stamp: false });
    const stampProof = await page.evaluate(async ({ stamped, plain }) => {
      const get = async (u) => {
        try { const r = await fetch(u, { cache: 'no-store' }); const b = await r.arrayBuffer(); return { ok: r.ok, bytes: b.byteLength, type: r.headers.get('content-type') || '' }; }
        catch (e) { return { ok: false, err: String(e && e.message) }; }
      };
      return { stamped: await get(stamped), plain: await get(plain) };
    }, { stamped: beforeShots[0].url, plain: control.url });
    expect(stampProof.stamped.ok, 'the stamped photo is fetchable from storage').toBe(true);
    expect(stampProof.plain.ok, 'the unstamped control is fetchable from storage').toBe(true);
    expect(stampProof.stamped.type).toContain('image');
    expect(stampProof.stamped.bytes,
      `the stamped upload carries more than the same frame unstamped (${stampProof.stamped.bytes} vs ${stampProof.plain.bytes})`)
      .toBeGreaterThan(stampProof.plain.bytes);

    // ── STEP 3: the estimate's photos follow the bid into the job ────────────
    await step(page, {
      label: 'schedule the job, Before set follows the bid', page: 'pg-cal', role: 'contractor',
      suspect: 'photo-capture.js tdInheritBidPhotos (called from finance.js + cloud.js)',
      ruleText: 'scheduling a bid must carry its walkthrough photos onto the job with no filing by hand',
      expected: 'both Before rows now carry job_id',
      act: async (p) => {
        await p.evaluate(({ c, bidId, jobId }) => {
          jobs.push({ id: jobId, bid_id: bidId, client_id: c.id, name: 'Exterior repaint', addr: c.addr, start: todayKey(), days: 1, value: 2300, eventType: 'job', status: 'active' });
          tdInheritBidPhotos(bidId, jobId);
          saveAll();
        }, { c: client, bidId, jobId });
        // The inheritance itself is ZERO: it is the app noticing, not the
        // contractor acting. That is the point of the feature.
        return 0;
      },
      rule: async (p) => {
        const n = await p.evaluate((jobId) => photos.filter(x => x.job_id === jobId && x.type === 'before').length, jobId);
        return { ok: n === 2, got: `before-on-job=${n}` };
      },
    });

    // ── STEP 4: the After set on the finished job ────────────────────────────
    let afterShot = null;
    await step(page, {
      label: 'shoot the After on the finished job', page: 'pg-jobs', role: 'contractor',
      suspect: 'photo-capture.js tdSavePhoto + tdPromptAfterShots',
      ruleText: 'the After shot uploads for real and pairs with the Before set on the same job',
      expected: 'after row with a url on the job, and the prompt no longer fires',
      act: async (p) => {
        afterShot = await shootInPage(p, { type: 'after', jobId, caption: 'South elevation', lat: 37.68891, lon: -97.33609 });
        // Prompt tap (1) + shutter (1).
        return 2;
      },
      rule: async (p) => {
        const r = await p.evaluate((jobId) => ({
          after: photos.filter(x => x.job_id === jobId && x.type === 'after').length,
          promptFires: tdPromptAfterShots(jobId),
        }), jobId);
        // The prompt must go quiet the moment the pair is complete: a nag that
        // fires after the work is done is a nag people train themselves past.
        await p.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()));
        const ok = r.after === 1 && r.promptFires === false && afterShot && /^https?:\/\//.test(afterShot.url || '');
        return { ok, got: JSON.stringify(r) };
      },
    });

    // ── STEP 5: shoot with nobody attached, then file it ─────────────────────
    let unfiled = null;
    await step(page, {
      label: 'shoot with no customer, then file it in one tap', page: 'pg-dash', role: 'contractor',
      suspect: 'photo-capture.js tdSavePhoto (no tags) → tdFilePhoto',
      ruleText: 'a photo taken before anyone knows whose it is must be legal, land unfiled, and file in one tap',
      expected: 'row uploads with no client, then carries the client after filing',
      act: async (p) => {
        unfiled = await shootInPage(p, { type: 'progress', caption: 'Drive-by' });
        const landedUnfiled = await p.evaluate((id) => {
          const row = photos.find(x => String(x.id) === String(id));
          return row ? row.client_id === null : false;
        }, unfiled && unfiled.id);
        await p.evaluate(({ id, cid }) => tdFilePhoto(id, cid), { id: unfiled && unfiled.id, cid: client.id });
        unfiled = Object.assign({}, unfiled, { landedUnfiled });
        // Quick action (1) + shutter (1) + Done (1) + File (1) + pick the
        // customer (1). Five, and four of them are after the photo exists.
        return 5;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ id, cid }) => {
          const row = photos.find(x => String(x.id) === String(id));
          return { filedTo: row ? row.client_id : null, match: row ? row.client_id === cid : false, tray: tdUnfiledPhotos().length };
        }, { id: unfiled && unfiled.id, cid: client.id });
        return { ok: !!unfiled.landedUnfiled && r.match, got: JSON.stringify(r) };
      },
    });

    // ── STEP 6: mark one up, and prove the original survives ────────────────
    let marked = {};
    await step(page, {
      label: 'mark up a photo, original preserved', page: 'pc-anno', role: 'contractor',
      suspect: 'photo-capture.js tdAnnotatePhoto / tdSaveAnnotation',
      ruleText: 'marking a photo up must upload a NEW flattened image and keep the untouched original',
      expected: 'url changes, originalUrl holds the first upload, both fetchable',
      act: async (p) => {
        marked = await p.evaluate(async (id) => {
          const before = photos.find(x => String(x.id) === String(id));
          const urlBefore = before.url;
          window._pcAnnoLastError = null;
          tdAnnotatePhoto(id);
          // ── Read the BARE binding, never window._pcAnno ──────────────────
          // _pcAnno is declared with `let` at the top level of a classic
          // script, which creates a binding in the global LEXICAL scope and
          // NOT a property on window. window._pcAnno is therefore undefined
          // forever. This test polled that and so waited out the whole
          // timeout and reported "the editor never opened" no matter what
          // the app did: three live rounds chased a failure that was this
          // line. The offline spec used the bare name, which is exactly why
          // it passed while this one did not.
          const ctx = () => (typeof _pcAnno !== 'undefined' ? _pcAnno : null);
          // 6 seconds: the recovery path can add a storage download and a
          // blob decode, and a slow-but-working path must not read as a
          // refusal.
          for (let i = 0; i < 240 && !(ctx() && ctx().img); i++) await new Promise(r => setTimeout(r, 25));
          // Say WHY it did not open. The live run reported opened:false and
          // the other keys came back undefined, which JSON.stringify drops,
          // so the failure read as two booleans and explained nothing.
          if (!ctx() || !ctx().img) {
            return { opened: false, urlBefore, whyNotOpened: {
              ctxGone: !ctx(), imgMissing: !!(ctx() && !ctx().img),
              // The app now records the exact stage it failed at.
              lastError: window._pcAnnoLastError || null,
              host: String(before.url || '').split('/').slice(0, 3).join('/'),
              srcTried: String(before.url || '').slice(-40), hadData: !!before.data,
              storagePath: String(before.storagePath || '').slice(-40),
            } };
          }
          const cv = document.getElementById('pc-anno-cv');
          _pcAnno.ops.push({ t: 'arrow', x1: cv.width * 0.2, y1: cv.height * 0.2, x2: cv.width * 0.6, y2: cv.height * 0.6, c: '#E5484D' });
          await tdSaveAnnotation();
          const after = photos.find(x => String(x.id) === String(id));
          const reach = async u => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok; } catch (e) { return false; } };
          return {
            opened: true, urlBefore, urlAfter: after.url, originalUrl: after.originalUrl,
            annotated: !!after.annotated,
            markedReachable: await reach(after.url),
            originalReachable: await reach(after.originalUrl),
            // Diagnostics, so a failure says WHY rather than just "false".
            // The first live failure here reported only booleans and cost a
            // round trip to learn nothing.
            sameObject: before === after,
            rowsWithOriginal: photos.filter(x => x.originalUrl).length,
            tail: { before: String(urlBefore).slice(-34), after: String(after.url).slice(-34), orig: String(after.originalUrl).slice(-34) },
          };
        }, beforeShots[0].id);
        // Tap the shot in the strip (1), drag one arrow (1), Save (1).
        return 3;
      },
      rule: async () => {
        const ok = marked.opened && marked.urlAfter && marked.urlAfter !== marked.urlBefore &&
          marked.originalUrl === marked.urlBefore && marked.annotated &&
          marked.markedReachable && marked.originalReachable;
        if (!marked.opened) return { ok: false, got: 'editor never opened: ' + JSON.stringify(marked.whyNotOpened || {}) };
        return { ok: !!ok, got: JSON.stringify({ changed: marked.urlAfter !== marked.urlBefore, keptOriginal: marked.originalUrl === marked.urlBefore, marked: marked.markedReachable, original: marked.originalReachable, sameObject: marked.sameObject, rowsWithOriginal: marked.rowsWithOriginal, tail: marked.tail }) };
      },
    });

    // ── STEP 7: the hub the client actually opens ────────────────────────────
    // The one that matters. Reads the REAL uploaded snapshot back out of
    // storage rather than the local array, because the local array being right
    // is exactly what was true before and still left the hub wrong.
    let hub = null;
    await step(page, {
      label: 'open the real hub snapshot as the client', page: 'client.html', role: 'client',
      suspect: 'proposals.js _buildClientHubSnapshot photo grouping / _uploadClientHub',
      ruleText: 'every photo must reach the hub under the right heading: job pair first, estimate-only photos as their own card, never an unnamed leftovers pile',
      expected: 'job carries 2 Before + 1 After, and the snapshot round-trips from storage',
      act: async (p) => {
        hub = await p.evaluate(async (cid) => {
          await _uploadClientHub(cid);
          const c = clients.find(x => x.id === cid);
          const key = 'client-hub/' + _effectiveUid() + '/' + cid + '_' + c.clientToken + '.json';
          const { data, error } = await _supa.storage.from('proposals').download(key);
          if (error || !data) return { err: String(error && error.message || 'no snapshot') };
          const snap = JSON.parse(await data.text());
          const job = (snap.jobs || [])[0] || {};
          const jp = job.photos || [];
          return {
            jobs: (snap.jobs || []).length,
            jobPhotos: jp.length,
            before: jp.filter(x => x.type === 'before').length,
            after: jp.filter(x => x.type === 'after').length,
            withUrl: jp.filter(x => /^https?:\/\//.test(x.url || '')).length,
            withThumb: jp.filter(x => !!x.thumbUrl).length,
            bidGroups: (snap.bidPhotos || []).length,
            total: (snap.photos || []).length,
            // The quiet half of the proof chain, and the privacy rule under
            // it: the client is told the verdict, never the coordinates.
            verified: jp.filter(x => x.verified).length,
            leaksCoords: /"lat"|"lon"/.test(JSON.stringify(snap)),
          };
        }, client.id);
        // Tapping the link the contractor already sends.
        return 1;
      },
      rule: async () => {
        // EVERY photo on the job carries a url, not just the pair: the job
        // also holds the stamp-off control shot, which is why the old
        // `withUrl === before + after` was wrong (and its `+ (total ? 0 : 0)`
        // was a no-op that hid the mistake).
        const ok = hub && !hub.err &&
          hub.before === 2 && hub.after === 1 &&
          hub.withUrl === hub.jobPhotos && hub.withThumb === hub.jobPhotos &&
          hub.verified >= 1 && hub.leaksCoords === false;
        return { ok: !!ok, got: JSON.stringify(hub) };
      },
    });

    // Thumbnails are the egress story: the hub grid must never be served the
    // full 1600px image. Asserted separately so a thumbnail regression reads
    // as its own finding instead of hiding inside the grouping rule.
    expect(hub.withThumb, 'every hub photo carries a thumbnail url').toBe(hub.withUrl);
    expect(hub.leaksCoords, 'the client snapshot never carries coordinates').toBe(false);
    expect(hub.verified, 'the hub says the work was verified on site').toBeGreaterThan(0);

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
