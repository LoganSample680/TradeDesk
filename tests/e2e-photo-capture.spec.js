// @ts-check
// ── Jobsite photos: one capture sheet, one writer (owner 2026-09-21) ────────
//
// The ask: shoot photos in person from EVERY estimate type, and have them land
// in the client hub link under Before and After. Before this, only the job
// sheet had a camera, and a photo with no job on it fell into an unnamed
// "other photos" strip at the bottom of the hub.
//
// What these tests pin, in the order the rules matter:
//   1. The client is the subject. bid and job are optional tags on top.
//   2. A bid's photos become the job's photos when the bid is scheduled.
//   3. Unfiled photos exist, are guessable by address, and file in one tap.
//   4. The After prompt fires exactly when there is a pair to complete.
//   5. The old per-surface upload copy is GONE (§7.1): addJobPhoto is a
//      wrapper, not a second implementation.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// A tiny real PNG. FileReader/createImageBitmap both accept it, so the save
// path runs end to end rather than bailing at the decode.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const seed = () => `
  clients.length=0;bids.length=0;jobs.length=0;photos.length=0;
  clients.push({id:501,name:'Dana Whitfield',addr:'1412 Oak Ridge Dr',lat:37.6889,lon:-97.3361});
  clients.push({id:502,name:'Marco Reyes',addr:'88 Elm St',lat:38.9,lon:-95.2});
  bids.push({id:901,client_id:501,client_name:'Dana Whitfield',title:'Exterior repaint',amount:2300,status:'Pending'});
`;

async function shoot(page, opts) {
  return page.evaluate(async (o) => {
    const bin = atob(o.b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'shot.png', { type: 'image/png' });
    const row = await tdSavePhoto({ file, type: o.type, caption: o.caption, clientId: o.clientId, bidId: o.bidId, jobId: o.jobId });
    return row ? { id: row.id, type: row.type, client_id: row.client_id, bid_id: row.bid_id, job_id: row.job_id, caption: row.caption } : null;
  }, Object.assign({ b64: PNG_B64 }, opts));
}

test.describe('Photo capture: the shared writer', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(seed()); });

  test('a photo shot on an estimate carries the bid AND the client', async () => {
    const r = await shoot(page, { type: 'before', bidId: 901 });
    expect(r).not.toBeNull();
    expect(r.type).toBe('before');
    expect(r.bid_id).toBe(901);
    // The client is INFERRED from the bid: no caller should have to look it up.
    expect(r.client_id).toBe(501);
    expect(r.job_id).toBe(null);
  });

  test('a photo shot with no client at all is legal and lands unfiled', async () => {
    const r = await shoot(page, { type: 'before' });
    expect(r.client_id).toBe(null);
    expect(r.bid_id).toBe(null);
    expect(r.job_id).toBe(null);
    const n = await page.evaluate(() => tdUnfiledPhotos().length);
    expect(n).toBe(1);
  });

  test('a photo shot on a job carries the job and infers the client', async () => {
    await page.evaluate(() => { jobs.push({ id: 701, bid_id: 901, client_id: 501, name: 'Exterior repaint', start: '2026-09-18', status: 'active' }); });
    const r = await shoot(page, { type: 'progress', jobId: 701, caption: 'Rough-in' });
    expect(r.job_id).toBe(701);
    expect(r.client_id).toBe(501);
    expect(r.caption).toBe('Rough-in');
  });

  test('the caption is capped at 60 characters, not stored raw', async () => {
    const r = await shoot(page, { type: 'progress', bidId: 901, caption: 'x'.repeat(200) });
    expect(r.caption.length).toBe(60);
  });

  // §11.1 input classes: the writer is called with nothing useful.
  test('null and empty input never throw and never write a row', async () => {
    const r = await page.evaluate(async () => {
      const before = photos.length;
      const a = await tdSavePhoto();
      const b = await tdSavePhoto({});
      const c = await tdSavePhoto({ file: null, type: 'before' });
      return { a, b, c, wrote: photos.length - before };
    });
    expect(r.a).toBe(null);
    expect(r.b).toBe(null);
    expect(r.c).toBe(null);
    expect(r.wrote).toBe(0);
  });

  test('concurrent shots all land, none overwrite another', async () => {
    const n = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const mk = () => new File([arr], 'shot.png', { type: 'image/png' });
      await Promise.all([1, 2, 3, 4, 5].map(() => tdSavePhoto({ file: mk(), type: 'before', bidId: 901 })));
      return photos.filter(p => p.bid_id === 901).length;
    }, PNG_B64);
    expect(n).toBe(5);
  });
});

test.describe('Photo capture: the bid carries its photos into the job', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(seed()); });

  test('scheduling the bid stamps job_id onto every one of its photos', async () => {
    await shoot(page, { type: 'before', bidId: 901 });
    await shoot(page, { type: 'before', bidId: 901 });
    const r = await page.evaluate(() => {
      jobs.push({ id: 702, bid_id: 901, client_id: 501, name: 'Exterior repaint', start: '2026-09-22', status: 'upcoming' });
      const moved = tdInheritBidPhotos(901, 702);
      return { moved, onJob: photos.filter(p => p.job_id === 702).length, named: photos[0].job_name };
    });
    expect(r.moved).toBe(2);
    expect(r.onJob).toBe(2);
    expect(r.named).toBe('Exterior repaint');
  });

  test('inheritance is idempotent and never re-parents a hand-filed photo', async () => {
    await shoot(page, { type: 'before', bidId: 901 });
    const r = await page.evaluate(() => {
      jobs.push({ id: 703, bid_id: 901, client_id: 501, name: 'Job A', start: '2026-09-22', status: 'upcoming' });
      jobs.push({ id: 704, bid_id: 901, client_id: 501, name: 'Job B', start: '2026-09-23', status: 'upcoming' });
      const first = tdInheritBidPhotos(901, 703);
      const second = tdInheritBidPhotos(901, 703);   // same call again
      const other = tdInheritBidPhotos(901, 704);    // a DIFFERENT job
      return { first, second, other, landedOn: photos[0].job_id };
    });
    expect(r.first).toBe(1);
    expect(r.second).toBe(0);
    expect(r.other).toBe(0);
    expect(r.landedOn).toBe(703);
  });

  test('a missing bid or job id is a no-op, not a throw', async () => {
    const r = await page.evaluate(() => ({
      a: tdInheritBidPhotos(null, 1), b: tdInheritBidPhotos(1, null), c: tdInheritBidPhotos(), d: tdInheritBidPhotos(9999, 8888),
    }));
    expect(r).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

test.describe('Photo capture: unfiled tray', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(seed()); });

  test('an address match is offered as a GUESS, never filed automatically', async () => {
    const r = await page.evaluate(() => {
      photos.push({ id: 1, type: 'before', client_id: null, bid_id: null, job_id: null, lat: 37.68895, lon: -97.33615, uploadedAt: new Date().toISOString() });
      const guess = tdGuessClientFor(photos[0]);
      return { guess: guess && guess.id, stillUnfiled: photos[0].client_id === null, tray: tdUnfiledPhotos().length };
    });
    expect(r.guess).toBe(501);
    expect(r.stillUnfiled).toBe(true);   // a guess is not a decision
    expect(r.tray).toBe(1);
  });

  test('a photo far from every client gets no guess at all', async () => {
    const g = await page.evaluate(() => {
      photos.push({ id: 2, type: 'before', client_id: null, lat: 40.7128, lon: -74.006, uploadedAt: new Date().toISOString() });
      return tdGuessClientFor(photos[0]);
    });
    expect(g).toBe(null);
  });

  test('no coordinates means no guess, and no throw', async () => {
    const r = await page.evaluate(() => ({
      none: tdGuessClientFor({ id: 3, client_id: null }),
      nullArg: tdGuessClientFor(null),
      undef: tdGuessClientFor(undefined),
    }));
    expect(r).toEqual({ none: null, nullArg: null, undef: null });
  });

  test('filing writes the client through and empties the tray', async () => {
    await shoot(page, { type: 'before' });
    const r = await page.evaluate(() => {
      const id = photos[photos.length - 1].id;
      const ok = tdFilePhoto(id, 501);
      const p = photos.find(x => String(x.id) === String(id));
      return { ok, client_id: p.client_id, client_name: p.client_name, tray: tdUnfiledPhotos().length };
    });
    expect(r.ok).toBe(true);
    expect(r.client_id).toBe(501);
    expect(r.client_name).toBe('Dana Whitfield');
    expect(r.tray).toBe(0);
  });

  test('filing a photo id that does not exist returns false', async () => {
    const ok = await page.evaluate(() => tdFilePhoto('nope-9999', 501));
    expect(ok).toBe(false);
  });

  test('the tray renders nothing at all when there is nothing unfiled', async () => {
    const html = await page.evaluate(() => tdUnfiledTrayHTML());
    expect(html).toBe('');
  });

  test('the tray renders a row per unfiled photo with the guess on it', async () => {
    const html = await page.evaluate(() => {
      photos.push({ id: 4, type: 'before', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      return tdUnfiledTrayHTML();
    });
    expect(html).toContain('Unfiled photos');
    expect(html).toContain('Dana Whitfield?');
  });
});

test.describe('Photo capture: the After prompt', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(seed());
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
  });

  test('fires when the job has Before shots and no After yet', async () => {
    await page.evaluate(() => { jobs.push({ id: 710, bid_id: 901, client_id: 501, name: 'Exterior repaint', status: 'done' }); });
    await shoot(page, { type: 'before', jobId: 710 });
    const r = await page.evaluate(() => ({ fired: tdPromptAfterShots(710), shown: !!document.querySelector('.zmodal-overlay') }));
    expect(r.fired).toBe(true);
    expect(r.shown).toBe(true);
    await expect(page.locator('.zmodal-overlay')).toContainText('Grab the After shots');
  });

  test('stays silent when there is no Before set to complete', async () => {
    await page.evaluate(() => { jobs.push({ id: 711, client_id: 501, name: 'No photos', status: 'done' }); });
    const r = await page.evaluate(() => ({ fired: tdPromptAfterShots(711), shown: !!document.querySelector('.zmodal-overlay') }));
    expect(r.fired).toBe(false);
    expect(r.shown).toBe(false);
  });

  test('stays silent once the After shots already exist', async () => {
    await page.evaluate(() => { jobs.push({ id: 712, client_id: 501, name: 'Done properly', status: 'done' }); });
    await shoot(page, { type: 'before', jobId: 712 });
    await shoot(page, { type: 'after', jobId: 712 });
    const fired = await page.evaluate(() => tdPromptAfterShots(712));
    expect(fired).toBe(false);
  });

  test('an unknown job id is a no-op', async () => {
    const fired = await page.evaluate(() => tdPromptAfterShots(99999));
    expect(fired).toBe(false);
  });
});

test.describe('Photo capture: the sheet itself', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(seed());
    await page.evaluate(() => { try { tdCloseCapture(); } catch (e) {} });
  });

  test('opens with the subject named, so the attach bar is a confirmation not a question', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    await expect(page.locator('#pc-sheet')).toBeVisible();
    await expect(page.locator('#pc-subject')).toHaveText(/Dana Whitfield/);
    await expect(page.locator('#pc-subject')).toHaveText(/Exterior repaint/);
  });

  test('opens with no customer when shot from the dashboard, and says so', async () => {
    await page.evaluate(() => tdCaptureUnfiled());
    await expect(page.locator('#pc-subject')).toHaveText('No customer yet');
  });

  test('the type toggle switches which bucket the next shot lands in', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    await page.locator('.pc-seg-btn', { hasText: 'After' }).click();
    const t = await page.evaluate(() => document.querySelectorAll('#pc-sheet .pc-seg-btn.on')[0].textContent);
    expect(t).toBe('After');
  });

  test('the ghost is the newest Before on the same bid, and nothing when there is none', async () => {
    const empty = await page.evaluate(() => { tdCaptureForBid(901, 'after'); return tdCaptureGhostSrc(); });
    expect(empty).toBe('');
    await page.evaluate(() => tdCloseCapture());
    await shoot(page, { type: 'before', bidId: 901 });
    const src = await page.evaluate(() => { tdCaptureForBid(901, 'after'); return tdCaptureGhostSrc(); });
    expect(src.length).toBeGreaterThan(0);
  });

  // Both of these were live defects found in a local screenshot, not by a
  // test, and neither would ever throw: a missing CSS token renders nothing
  // and a duplicated label just reads wrong. They are pinned here so they
  // cannot come back silently (§13.4).
  test('the ghost hint and the Before segment have a real background, not a missing token', async () => {
    await page.evaluate(() => { photos.push({ id: 77, type: 'before', url: '', thumbUrl: '', client_id: 501, bid_id: 901, job_id: null, uploadedAt: new Date().toISOString() }); tdCaptureForBid(901, 'after'); });
    const r = await page.evaluate(() => {
      const hint = document.getElementById('pc-hint');
      const seg = document.querySelector('#pc-sheet .pc-seg-btn');
      tdCaptureSetType('before');
      const segOn = document.querySelector('#pc-sheet .pc-seg-btn.on');
      const bg = el => el ? getComputedStyle(el).backgroundColor : '';
      return { hintCls: hint.className, hintBg: bg(hint), segBg: bg(segOn), any: !!seg };
    });
    const transparent = v => v === '' || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
    expect(transparent(r.hintBg)).toBe(false);
    expect(transparent(r.segBg)).toBe(false);
  });

  test('a job named after the customer does not print the name twice', async () => {
    await page.evaluate(() => { jobs.push({ id: 760, client_id: 501, name: 'Dana Whitfield', status: 'active' }); tdCaptureForJob(760, 'progress'); });
    await expect(page.locator('#pc-subject')).toHaveText('Dana Whitfield');
  });

  test('closing removes the sheet and stops the camera', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    await page.evaluate(() => tdCloseCapture());
    expect(await page.locator('#pc-sheet').count()).toBe(0);
  });

  test('opening twice never leaves two sheets stacked', async () => {
    await page.evaluate(() => { tdCaptureForBid(901, 'before'); tdCaptureForBid(901, 'after'); });
    expect(await page.locator('#pc-sheet').count()).toBe(1);
  });
});

test.describe('Photo capture: the old copy is gone', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // §7.1: prove the replaced path no longer exists, not just that the new one
  // works. addJobPhoto stays as an entry point (the job sheet and the share
  // inbox both call it) but it must be a WRAPPER now: one call into the shared
  // writer, no second upload sequence of its own.
  test('addJobPhoto is a thin wrapper over tdSavePhoto, not a second uploader', async () => {
    const src = await page.evaluate(() => addJobPhoto.toString());
    expect(src).toContain('tdSavePhoto');
    expect(src).not.toContain('storage.from');
    expect(src).not.toContain('_uploadPhotoThumb');
    expect(src.split('\n').length).toBeLessThan(15);
  });

  test('the Photo quick action exists and sits in slot 2', async () => {
    const r = await page.evaluate(() => {
      const g = document.querySelector('.qa-grid');
      const labels = [...g.querySelectorAll('.qa')].map(b => b.textContent.trim());
      return { labels, hasHandler: !!document.getElementById('qa-photo-btn') };
    });
    expect(r.hasHandler).toBe(true);
    expect(r.labels[1]).toBe('Photo');
    // The owner's order: New lead, Photo, Log miles, Proposal (2026-09-21).
    expect(r.labels[0]).toBe('New lead');
    expect(r.labels[2]).toBe('Log miles');
    expect(r.labels[3]).toBe('Proposal');
  });

  test('every estimate type shares one header chip, because they share one page', async () => {
    const r = await page.evaluate(() => {
      const chip = document.getElementById('gei-photo-chip');
      return { inEstPage: !!chip && !!chip.closest('#pg-est-generic'), n: document.getElementById('gei-photo-n').textContent };
    });
    expect(r.inEstPage).toBe(true);
    expect(r.n).toBe('0');
  });

  test('the chip counts the photos on the estimate it is showing', async () => {
    await page.evaluate(seed());
    await page.evaluate(() => { window._geiEditBidId = 901; _geiPaintPhotoChip(); });
    expect(await page.evaluate(() => document.getElementById('gei-photo-n').textContent)).toBe('0');
    await shoot(page, { type: 'before', bidId: 901 });
    await shoot(page, { type: 'before', bidId: 901 });
    await page.evaluate(() => _geiPaintPhotoChip());
    expect(await page.evaluate(() => document.getElementById('gei-photo-n').textContent)).toBe('2');
    await page.evaluate(() => { window._geiEditBidId = null; });
  });

  test('zero console errors across the whole photo path', async () => {
    assertNoErrors(page, 'photo-capture.js');
  });
});
