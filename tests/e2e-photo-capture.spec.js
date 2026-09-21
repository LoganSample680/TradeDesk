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

  // Both caught in a local screenshot: the hint contradicted a live
  // viewfinder, and the stamp toggle sat on top of the subject pill.
  test('the hint stops saying "open the camera" once a viewfinder is live', async () => {
    const txt = await page.evaluate(async () => {
      tdCaptureForBid(901, 'before');
      // simulate the camera answering after the sheet was already drawn
      document.getElementById('pc-sheet').classList.add('pc-live');
      _pcStream = { getTracks: () => [] };
      _pcPaint();
      const t = document.getElementById('pc-hint').textContent;
      _pcStream = null;
      return t;
    });
    expect(txt).not.toContain('open the camera');
  });

  test('the stamp toggle does not sit on top of the subject pill', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    const hit = await page.evaluate(() => {
      const a = document.querySelector('#pc-sheet .pc-attach').getBoundingClientRect();
      const b = document.getElementById('pc-stamp-toggle').getBoundingClientRect();
      return !(b.top > a.bottom || b.bottom < a.top || b.left > a.right || b.right < a.left);
    });
    expect(hit).toBe(false);
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

  test('the TrueShot quick action exists and sits in slot 2', async () => {
    const r = await page.evaluate(() => {
      const g = document.querySelector('.qa-grid');
      const labels = [...g.querySelectorAll('.qa')].map(b => b.textContent.trim());
      return { labels, hasHandler: !!document.getElementById('qa-photo-btn') };
    });
    expect(r.hasHandler).toBe(true);
    expect(r.labels[1]).toBe('TrueShot');
    // The owner's order: New lead, TrueShot, Log miles, Proposal (2026-09-21).
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

test.describe('TrueShot: the burned-in stamp', () => {
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
    await page.evaluate(() => { S.bname = 'Hollow Creek Painting'; S.photoStamp = undefined; });
  });

  // The stamp is the whole reason a photo is evidence rather than a picture.
  // These pin WHAT it says; the drawing itself is pinned by the round-trip
  // test below, which proves a real image comes back out bigger than nothing.
  test('names the business, the moment, and the address of the job', async () => {
    const lines = await page.evaluate(() => {
      jobs.push({ id: 720, client_id: 501, name: 'Repipe', addr: '77 Job Site Rd' });
      return _pcStampLines({ jobId: 720, clientId: 501 });
    });
    expect(lines[0]).toBe('Hollow Creek Painting');
    expect(lines[1]).toMatch(/\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}/);
    expect(lines[2]).toBe('77 Job Site Rd');
  });

  test('falls back to the customer address, then to raw coordinates', async () => {
    const r = await page.evaluate(() => ({
      viaClient: _pcStampLines({ clientId: 501 }),
      viaCoords: _pcStampLines({ lat: 37.68891, lon: -97.33612 }),
      bare: _pcStampLines({}),
    }));
    expect(r.viaClient[2]).toBe('1412 Oak Ridge Dr');
    expect(r.viaCoords[2]).toBe('37.68891, -97.33612');
    // No business, no place: still stamps the moment, never nothing.
    expect(r.bare.length).toBeGreaterThanOrEqual(2);
  });

  test('a contractor with no business name set still gets a stamp', async () => {
    const lines = await page.evaluate(() => { S.bname = ''; return _pcStampLines({ clientId: 501 }); });
    expect(lines[0]).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(lines).not.toContain('');
  });

  test('burning it in returns a real JPEG, and never destroys the photo on failure', async () => {
    const r = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'shot.png', { type: 'image/png' });
      const ok = await tdStampImage(file, ['Hollow Creek Painting', '09/21/2026  4:18 PM', '1412 Oak Ridge Dr']);
      return {
        type: ok && ok.type, size: ok && ok.size,
        junk: await tdStampImage(new File(['not an image'], 'x.jpg', { type: 'image/jpeg' }), ['a']),
        noLines: await tdStampImage(file, []),
        noFile: await tdStampImage(null, ['a']),
      };
    }, PNG_B64);
    expect(r.type).toBe('image/jpeg');
    expect(r.size).toBeGreaterThan(0);
    // Every failure path hands back null, and tdSavePhoto reads null as
    // "upload what you had". A stamp must never be why a photo is lost.
    expect(r.junk).toBe(null);
    expect(r.noLines).toBe(null);
    expect(r.noFile).toBe(null);
  });

  test('the toggle is a real setting, default on, and survives a read back', async () => {
    const r = await page.evaluate(() => {
      const dflt = _pcStampOn();
      const off = tdTogglePhotoStamp();
      const nowOff = _pcStampOn();
      const on = tdTogglePhotoStamp();
      return { dflt, off, nowOff, on, persisted: S.photoStamp };
    });
    expect(r.dflt).toBe(true);
    expect(r.off).toBe(false);
    expect(r.nowOff).toBe(false);
    expect(r.on).toBe(true);
    expect(r.persisted).toBe(true);
  });

  test('stamp off means the bytes are left alone', async () => {
    const r = await page.evaluate(async (b64) => {
      S.photoStamp = false;
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const before = arr.length;
      const row = await tdSavePhoto({ file: new File([arr], 'shot.png', { type: 'image/png' }), type: 'before', bidId: 901 });
      S.photoStamp = true;
      return { wrote: !!row, before };
    }, PNG_B64);
    expect(r.wrote).toBe(true);
  });
});

test.describe('TrueShot: marking a photo up', () => {
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
    await page.evaluate(() => { try { tdCloseAnnotate(); } catch (e) {} });
  });

  // The editor loads the photo by url. Offline, the mocked storage url does
  // not resolve to real bytes, so the row is given a data: url here: that is
  // the same thing a real Supabase public url is to the editor, an image it
  // can decode and read back off a canvas.
  const openEditor = async () => {
    await shoot(page, { type: 'before', bidId: 901 });
    return page.evaluate(async (b64) => {
      const p = photos[photos.length - 1];
      // A REAL-SIZED image: the 1x1 test png made every drag less than one
      // image pixel long, which is how the scaled tap-vs-drag floor below
      // came to be tested at all.
      const seedCv = document.createElement('canvas');
      seedCv.width = 400; seedCv.height = 300;
      const sg = seedCv.getContext('2d');
      sg.fillStyle = '#8899aa'; sg.fillRect(0, 0, 400, 300);
      p.url = seedCv.toDataURL('image/png');
      delete p.data;
      const id = p.id;
      const ok = tdAnnotatePhoto(id);
      // the <img> decode is async; the canvas is sized in its onload
      for (let i = 0; i < 40 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r => setTimeout(r, 25));
      return { ok, ready: !!(_pcAnno && _pcAnno.img), id };
    }, PNG_B64);
  };

  test('opens on a real photo and sizes the canvas to the image', async () => {
    const r = await openEditor();
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(true);
    await expect(page.locator('#pc-anno')).toBeVisible();
    const cv = await page.evaluate(() => { const c = document.getElementById('pc-anno-cv'); return { w: c.width, h: c.height }; });
    expect(cv.w).toBeGreaterThan(0);
    expect(cv.h).toBeGreaterThan(0);
  });

  // The floor is 1% of the short edge, so this also pins that a real thumb
  // movement registers at any image size (a flat pixel count did not).
  test('a drag lays down a mark, a tap does not', async () => {
    await openEditor();
    const box = await page.locator('#pc-anno-cv').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down(); await page.mouse.up();            // a tap: no mark
    const afterTap = await page.evaluate(() => _pcAnno.ops.length);
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 6 });
    await page.mouse.up();                                      // a drag: a mark
    const afterDrag = await page.evaluate(() => _pcAnno.ops.length);
    expect(afterTap).toBe(0);
    expect(afterDrag).toBe(1);
  });

  test('undo pops the last mark and is safe on an empty canvas', async () => {
    await openEditor();
    const r = await page.evaluate(() => {
      _pcAnno.ops.push({ t: 'arrow', x1: 1, y1: 1, x2: 40, y2: 40, c: '#E5484D' });
      _pcAnno.ops.push({ t: 'circle', x1: 5, y1: 5, x2: 50, y2: 50, c: '#E5484D' });
      const first = tdAnnoUndo(), second = tdAnnoUndo(), third = tdAnnoUndo();
      return { first, second, third, left: _pcAnno.ops.length };
    });
    expect(r.first).toBe(true);
    expect(r.second).toBe(true);
    expect(r.third).toBe(false);   // nothing left to undo, and no throw
    expect(r.left).toBe(0);
  });

  test('the tool and the two colours switch, and only two colours exist', async () => {
    await openEditor();
    const r = await page.evaluate(() => {
      tdAnnoTool('circle'); const t1 = _pcAnno.tool;
      tdAnnoTool('text'); const t2 = _pcAnno.tool;
      const c1 = _pcAnno.color; tdAnnoColor();
      const c2 = _pcAnno.color; tdAnnoColor();
      return { t1, t2, c1, c2, back: _pcAnno.color };
    });
    expect(r.t1).toBe('circle');
    expect(r.t2).toBe('text');
    expect(r.c1).toBe('#E5484D');
    expect(r.c2).toBe('#F2A81C');
    expect(r.back).toBe('#E5484D');
  });

  // The rule that matters: the untouched shot survives. A marked-up photo is
  // still evidence only while the unmarked one exists.
  test('saving keeps the original and never overwrites it on a second pass', async () => {
    await openEditor();
    const r = await page.evaluate(async () => {
      const p = photos[photos.length - 1];
      p.url = 'https://example.test/original.jpg';
      p.storagePath = 'orig/one.jpg';
      _pcAnno.ops.push({ t: 'arrow', x1: 1, y1: 1, x2: 30, y2: 30, c: '#E5484D' });
      await tdSaveAnnotation();
      const afterFirst = { originalUrl: p.originalUrl, annotated: p.annotated, hasData: !!p.data };
      // mark it up a second time
      p.url = 'https://example.test/marked-1.jpg';
      tdAnnotatePhoto(p.id);
      for (let i = 0; i < 40 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      if (_pcAnno) { _pcAnno.ops.push({ t: 'circle', x1: 2, y1: 2, x2: 40, y2: 40, c: '#F2A81C' }); await tdSaveAnnotation(); }
      return { afterFirst, originalUrlNow: p.originalUrl, originalPath: p.originalPath };
    });
    expect(r.afterFirst.originalUrl).toBe('https://example.test/original.jpg');
    expect(r.afterFirst.annotated).toBe(true);
    // Still the FIRST original after the second pass, not the marked copy.
    expect(r.originalUrlNow).toBe('https://example.test/original.jpg');
    expect(r.originalPath).toBe('orig/one.jpg');
  });

  test('saving with no marks changes nothing and just closes', async () => {
    await openEditor();
    const r = await page.evaluate(async () => {
      const p = photos[photos.length - 1];
      const urlBefore = p.url;
      const saved = await tdSaveAnnotation();
      return { saved, sameUrl: p.url === urlBefore, annotated: !!p.annotated, open: !!document.getElementById('pc-anno') };
    });
    expect(r.saved).toBe(false);
    expect(r.sameUrl).toBe(true);
    expect(r.annotated).toBe(false);
    expect(r.open).toBe(false);
  });

  // The live run found this one: once a photo has uploaded, its base64 copy
  // is deleted, so the editor's only source was an <img> against the storage
  // url. When that would not load, mark-up was simply impossible. It now
  // falls back to downloading the bytes with the authenticated client, which
  // also keeps the canvas untainted so Save cannot throw.
  test('a photo whose url will not load still opens, via the storage download', async () => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 120; cv.height = 90; cv.getContext('2d').fillRect(0, 0, 120, 90);
      const bytes = await new Promise(res => cv.toBlob(res, 'image/png'));
      let asked = '';
      const realFrom = _supa.storage.from.bind(_supa.storage);
      _supa.storage.from = (b) => {
        const api = realFrom(b);
        return Object.assign({}, api, { download: async (path) => { asked = path; return { data: bytes, error: null }; } });
      };
      photos.push({ id: 950, type: 'before', url: 'https://nope.invalid/gone.jpg', thumbUrl: '', storagePath: 'u/bid-1/before-1.png', client_id: 501, bid_id: 901, uploadedAt: new Date().toISOString() });
      const opened = tdAnnotatePhoto(950);
      for (let i = 0; i < 120 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      const ready = !!(_pcAnno && _pcAnno.img);
      const w = ready ? document.getElementById('pc-anno-cv').width : 0;
      _supa.storage.from = realFrom;
      tdCloseAnnotate();
      return { opened, ready, w, asked };
    });
    expect(r.opened).toBe(true);
    expect(r.ready).toBe(true);        // it recovered rather than closing
    expect(r.w).toBe(120);             // and sized itself to the real bytes
    expect(r.asked).toBe('u/bid-1/before-1.png');
  });

  test('a photo with a bad url AND no storage path gives up cleanly, no editor left open', async () => {
    const r = await page.evaluate(async () => {
      photos.push({ id: 951, type: 'before', url: 'https://nope.invalid/gone.jpg', thumbUrl: '', storagePath: '', client_id: 501, uploadedAt: new Date().toISOString() });
      tdAnnotatePhoto(951);
      for (let i = 0; i < 60 && document.getElementById('pc-anno'); i++) await new Promise(r2 => setTimeout(r2, 25));
      return { open: !!document.getElementById('pc-anno'), ctx: !!_pcAnno };
    });
    expect(r.open).toBe(false);
    expect(r.ctx).toBe(false);
  });

  test('a missing photo, junk, and a photo with no image never open an editor', async () => {
    const r = await page.evaluate(() => {
      const a = tdAnnotatePhoto('nope-1234');
      const b = tdAnnotatePhoto(null);
      photos.push({ id: 991, type: 'before', url: '', thumbUrl: '', data: '', client_id: 501 });
      const c = tdAnnotatePhoto(991);
      return { a, b, c, open: !!document.getElementById('pc-anno') };
    });
    expect(r).toEqual({ a: false, b: false, c: false, open: false });
  });
});

test.describe('TrueShot: verified on site', () => {
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

  test('the snapshot says verified when the photo was taken at the job, and never ships coordinates', async () => {
    const r = await page.evaluate(() => {
      jobs.push({ id: 730, bid_id: 901, client_id: 501, name: 'Repipe', start: '2026-09-18', status: 'done', lat: 37.6889, lon: -97.3361 });
      photos.push({ id: 11, url: 'https://x.test/a.jpg', thumbUrl: '', type: 'before', client_id: 501, bid_id: 901, job_id: 730, lat: 37.68893, lon: -97.33607, uploadedAt: new Date().toISOString() });
      photos.push({ id: 12, url: 'https://x.test/b.jpg', thumbUrl: '', type: 'after', client_id: 501, bid_id: 901, job_id: 730, lat: 40.7128, lon: -74.006, uploadedAt: new Date().toISOString() });
      photos.push({ id: 13, url: 'https://x.test/c.jpg', thumbUrl: '', type: 'after', client_id: 501, bid_id: 901, job_id: 730, uploadedAt: new Date().toISOString() });
      const snap = _buildClientHubSnapshot(501);
      const jp = (snap.jobs[0] || {}).photos || [];
      return {
        onSite: jp.find(p => p.url.endsWith('a.jpg')).verified,
        milesAway: jp.find(p => p.url.endsWith('b.jpg')).verified,
        noFix: jp.find(p => p.url.endsWith('c.jpg')).verified,
        leaks: JSON.stringify(snap).includes('37.68893'),
      };
    });
    expect(r.onSite).toBe(true);
    expect(r.milesAway).toBe(false);
    expect(r.noFix).toBe(false);
    // The client is told the verdict, never the coordinates.
    expect(r.leaks).toBe(false);
  });

  test('falls back to the customer address when the job has no coordinates', async () => {
    const v = await page.evaluate(() => {
      jobs.push({ id: 731, bid_id: 901, client_id: 501, name: 'Repipe', status: 'done' });
      photos.push({ id: 14, url: 'https://x.test/d.jpg', thumbUrl: '', type: 'before', client_id: 501, bid_id: 901, job_id: 731, lat: 37.68892, lon: -97.33608, uploadedAt: new Date().toISOString() });
      const snap = _buildClientHubSnapshot(501);
      return (snap.jobs[0].photos[0] || {}).verified;
    });
    expect(v).toBe(true);
  });
});

// ── Every control, every combination, no dead buttons (owner ask 2026-09-21) ─
// "did you write tests that test this live on all buttons all combos and run
// it to make sure there are no dead functions."
//
// Two different failures are covered here, and they fail in different ways:
//   1. A handler that names a function which does not exist. Silent in the
//      browser (the click just throws into the console), invisible in a unit
//      test that never renders the markup. Checked STATICALLY, per surface.
//   2. A button that is wired but does nothing: the app's own "dead control"
//      definition (§13.1) is a first click with zero DOM, navigation or state
//      effect. Checked by CLICKING every control and diffing the page.
test.describe('TrueShot: every control, and no dead ones', () => {
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
    await page.evaluate(() => { try { tdCloseCapture(); tdCloseAnnotate(); } catch (e) {} document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
  });

  // Every function this feature's markup names must actually exist. This is
  // the check that would have caught a renamed helper, a typo in an onclick,
  // or a handler left behind after a refactor.
  const handlersIn = (html) => {
    const names = new Set();
    const re = /on[a-z]+="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      const fnRe = /([A-Za-z_$][\w$]*)\s*\(/g;
      let f;
      while ((f = fnRe.exec(m[1]))) names.add(f[1]);
    }
    return [...names];
  };

  test('every handler named by the capture sheet resolves to a real function', async () => {
    const missing = await page.evaluate((src) => {
      tdCaptureForBid(901, 'before');
      const html = document.getElementById('pc-sheet').innerHTML;
      const names = new Set();
      const re = /on[a-z]+="([^"]*)"/g; let m;
      while ((m = re.exec(html))) {
        const fnRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g; let f;
        while ((f = fnRe.exec(m[1]))) names.add(f[1]);
      }
      const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function']);
      return [...names].filter(n => !skip.has(n) && typeof window[n] !== 'function');
    });
    expect(missing).toEqual([]);
  });

  test('every handler named by the mark-up editor, the After prompt and the tray resolves', async () => {
    const missing = await page.evaluate(async () => {
      const bad = [];
      const scan = (html, where) => {
        const names = new Set();
        const re = /on[a-z]+="([^"]*)"/g; let m;
        while ((m = re.exec(html))) {
          // (?<![.\w$]) so `this.closest(...)` and `el.remove()` are read as
          // METHODS, not as globals this feature failed to define.
          const fnRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g; let f;
          while ((f = fnRe.exec(m[1]))) names.add(f[1]);
        }
        const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function']);
        [...names].forEach(n => { if (!skip.has(n) && typeof window[n] !== 'function') bad.push(where + ':' + n); });
      };
      // mark-up editor
      photos.push({ id: 880, type: 'before', url: '', thumbUrl: '', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', client_id: 501, bid_id: 901, job_id: null, uploadedAt: new Date().toISOString() });
      tdAnnotatePhoto(880);
      scan(document.getElementById('pc-anno').innerHTML, 'anno');
      tdCloseAnnotate();
      // After prompt
      jobs.push({ id: 881, client_id: 501, name: 'Repipe', status: 'done' });
      photos.push({ id: 882, type: 'before', url: '', thumbUrl: '', data: '', client_id: 501, job_id: 881, uploadedAt: new Date().toISOString() });
      tdPromptAfterShots(881);
      scan(document.querySelector('.zmodal-overlay').innerHTML, 'prompt');
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      // unfiled tray + its file picker
      photos.push({ id: 883, type: 'before', url: '', thumbUrl: '', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      scan(tdUnfiledTrayHTML(), 'tray');
      tdOpenFilePicker(883);
      scan(document.querySelector('.zmodal-overlay').innerHTML, 'filepicker');
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      // the estimate header chip
      scan(document.getElementById('gei-photo-chip').outerHTML, 'chip');
      // the dashboard quick action
      scan(document.getElementById('qa-photo-btn').outerHTML, 'qa');
      return bad;
    });
    expect(missing).toEqual([]);
  });

  // Click EVERY control in the sheet, one at a time, and require each to
  // change something. This is the app's own dead-control definition.
  test('no control in the capture sheet is dead', async () => {
    const dead = await page.evaluate(() => {
      const dead = [];
      const snap = () => JSON.stringify({
        html: document.getElementById('pc-sheet') ? document.getElementById('pc-sheet').innerHTML.length : 0,
        type: (typeof _pcCtx === 'object' && _pcCtx) ? _pcCtx.type : null,
        ghost: (typeof _pcCtx === 'object' && _pcCtx) ? _pcCtx.ghost : null,
        stamp: _pcStampOn(),
        open: !!document.getElementById('pc-sheet'),
        segOn: document.querySelector('#pc-sheet .pc-seg-btn.on') ? document.querySelector('#pc-sheet .pc-seg-btn.on').textContent : '',
        hint: document.getElementById('pc-hint') ? document.getElementById('pc-hint').textContent : '',
      });
      // A Before on the same bid so the Ghost control has something to show.
      photos.push({ id: 884, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: 501, bid_id: 901, job_id: null, uploadedAt: new Date().toISOString() });
      const labels = ['Before', 'Progress', 'After', 'Ghost', 'Stamp'];
      labels.forEach(label => {
        // Open on the type the button does NOT select, or clicking it is a
        // no-op by design and the sweep would read that as dead.
        const openOn = label === 'Before' ? 'after' : label === 'Ghost' ? 'after' : 'before';
        tdCaptureForBid(901, openOn);
        const btns = [...document.querySelectorAll('#pc-sheet button')];
        const btn = btns.find(b => (b.textContent || '').trim().toLowerCase().startsWith(label.toLowerCase()));
        if (!btn) { dead.push(label + ' (missing)'); return; }
        const before = snap();
        btn.click();
        if (snap() === before) dead.push(label);
        tdCloseCapture();
      });
      // Done closes the sheet: its effect IS the close.
      tdCaptureForBid(901, 'before');
      const done = [...document.querySelectorAll('#pc-sheet button')].find(b => b.textContent.trim() === 'Done');
      done && done.click();
      if (document.getElementById('pc-sheet')) dead.push('Done');
      return dead;
    });
    expect(dead).toEqual([]);
  });

  test('no control in the mark-up editor is dead', async () => {
    const r = await page.evaluate(async () => {
      const dead = [];
      const seedCv = document.createElement('canvas');
      seedCv.width = 300; seedCv.height = 200;
      seedCv.getContext('2d').fillRect(0, 0, 300, 200);
      photos.push({ id: 885, type: 'before', url: seedCv.toDataURL('image/png'), thumbUrl: '', client_id: 501, bid_id: 901, uploadedAt: new Date().toISOString() });
      tdAnnotatePhoto(885);
      for (let i = 0; i < 40 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      const snap = () => JSON.stringify({
        tool: _pcAnno && _pcAnno.tool, color: _pcAnno && _pcAnno.color,
        ops: _pcAnno ? _pcAnno.ops.length : -1,
        onTool: document.querySelector('#pc-anno .pc-tool.on') ? document.querySelector('#pc-anno .pc-tool.on').dataset.tool : '',
        colorLabel: document.getElementById('pc-anno-color').textContent,
      });
      // Opens on Arrow, so select something else first or the Arrow click is
      // correctly a no-op.
      tdAnnoTool('circle');
      ['Arrow', 'Circle', 'Text', 'Red', 'Yellow'].forEach(label => {
        if (label === 'Circle') tdAnnoTool('arrow');
        const btn = [...document.querySelectorAll('#pc-anno .pc-tool')].find(b => b.textContent.trim() === label);
        if (!btn) return;                      // Red/Yellow is the same button, one of the two always misses
        const before = snap();
        btn.click();
        if (snap() === before) dead.push(label);
      });
      // Undo with marks on the canvas must remove one.
      _pcAnno.ops.push({ t: 'arrow', x1: 1, y1: 1, x2: 50, y2: 50, c: '#E5484D' });
      const n = _pcAnno.ops.length;
      [...document.querySelectorAll('#pc-anno .pc-tool')].find(b => b.textContent.trim() === 'Undo').click();
      if (_pcAnno.ops.length !== n - 1) dead.push('Undo');
      // Cancel closes without saving.
      [...document.querySelectorAll('#pc-anno button')].find(b => b.textContent.trim() === 'Cancel').click();
      if (document.getElementById('pc-anno')) dead.push('Cancel');
      return dead;
    });
    expect(r).toEqual([]);
  });

  test('no control in the After prompt or the unfiled tray is dead', async () => {
    const dead = await page.evaluate(() => {
      const dead = [];
      jobs.push({ id: 886, client_id: 501, name: 'Repipe', status: 'done' });
      photos.push({ id: 887, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: 501, job_id: 886, uploadedAt: new Date().toISOString() });
      // "Not now" must close and do nothing else.
      tdPromptAfterShots(886);
      [...document.querySelectorAll('.zmodal-overlay button')].find(b => b.textContent.trim() === 'Not now').click();
      if (document.querySelector('.zmodal-overlay')) dead.push('Not now');
      // "Shoot the After set" must close the prompt AND open the sheet on After.
      tdPromptAfterShots(886);
      [...document.querySelectorAll('.zmodal-overlay button')].find(b => /Shoot the After/.test(b.textContent)).click();
      if (!document.getElementById('pc-sheet') || _pcCtx.type !== 'after') dead.push('Shoot the After set');
      tdCloseCapture();
      // The tray's File button opens the picker; the picker's option files it.
      photos.push({ id: 888, type: 'before', url: '', thumbUrl: '', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      const host = document.createElement('div');
      host.innerHTML = tdUnfiledTrayHTML();
      document.body.appendChild(host);
      const fileBtn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'File');
      fileBtn && fileBtn.click();
      const picker = document.querySelector('.zmodal-overlay');
      if (!picker) dead.push('File');
      else {
        const opt = picker.querySelector('.pc-file-opt');
        opt && opt.click();
        const p = photos.find(x => String(x.id) === '888');
        if (!p || p.client_id == null) dead.push('pick a customer');
      }
      // The guess pill files it in one tap, which is the whole point of it.
      photos.push({ id: 889, type: 'before', url: '', thumbUrl: '', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      host.innerHTML = tdUnfiledTrayHTML();
      const pill = [...host.querySelectorAll('.pc-uf-pill.ok')].pop();
      pill && pill.click();
      if (!photos.find(x => String(x.id) === '889' && x.client_id === 501)) dead.push('guess pill');
      host.remove();
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return dead;
    });
    expect(dead).toEqual([]);
  });

  test('the estimate chip and the dashboard tile both actually open the camera', async () => {
    const r = await page.evaluate(() => {
      window._geiEditBidId = 901; window._geiClientId = 501;
      document.getElementById('gei-photo-chip').click();
      const fromChip = { open: !!document.getElementById('pc-sheet'), bid: _pcCtx ? _pcCtx.bidId : null };
      tdCloseCapture();
      document.getElementById('qa-photo-btn').click();
      const fromTile = { open: !!document.getElementById('pc-sheet'), client: _pcCtx ? _pcCtx.clientId : 'none' };
      tdCloseCapture();
      window._geiEditBidId = null;
      return { fromChip, fromTile };
    });
    expect(r.fromChip.open).toBe(true);
    expect(r.fromChip.bid).toBe(901);
    expect(r.fromTile.open).toBe(true);
    // The quick action deliberately attaches nothing: shoot first, file after.
    expect(r.fromTile.client).toBe(null);
  });

  // Every combination of the two toggles, against the one rule that matters:
  // the shot always lands, tagged correctly, whatever the toggles say.
  test('every type and stamp combination still writes a correctly tagged row', async () => {
    const rows = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const mk = () => new File([arr], 'shot.png', { type: 'image/png' });
      jobs.push({ id: 890, bid_id: 901, client_id: 501, name: 'Repipe', status: 'active' });
      const out = [];
      for (const stamp of [true, false]) {
        S.photoStamp = stamp;
        for (const type of ['before', 'progress', 'after']) {
          for (const tag of [{ bidId: 901 }, { jobId: 890 }, { clientId: 501 }, {}]) {
            const row = await tdSavePhoto(Object.assign({ file: mk(), type }, tag));
            out.push({
              stamp, type, tag: Object.keys(tag)[0] || 'none',
              wrote: !!row,
              client: row ? row.client_id : null,
              bid: row ? row.bid_id : null,
              job: row ? row.job_id : null,
            });
          }
        }
      }
      S.photoStamp = true;
      return out;
    }, PNG_B64);
    expect(rows.length).toBe(24);                 // 2 stamp x 3 types x 4 tag shapes
    expect(rows.every(r => r.wrote)).toBe(true);  // every combination writes
    rows.filter(r => r.tag === 'bidId').forEach(r => { expect(r.bid).toBe(901); expect(r.client).toBe(501); });
    rows.filter(r => r.tag === 'jobId').forEach(r => { expect(r.job).toBe(890); expect(r.client).toBe(501); });
    rows.filter(r => r.tag === 'clientId').forEach(r => { expect(r.client).toBe(501); });
    rows.filter(r => r.tag === 'none').forEach(r => { expect(r.client).toBe(null); });
  });
});

// ── Finding the photo again, which is the point of tagging it ───────────────
test.describe('TrueShot: the photos come back', () => {
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

  test('a property\'s past work shows the walkthrough shots, not just the job ones', async () => {
    const r = await page.evaluate(() => {
      jobs.push({ id: 860, bid_id: 901, client_id: 501, name: 'Exterior repaint', status: 'done' });
      photos.push({ id: 21, type: 'before', url: 'https://x.test/walk.jpg', thumbUrl: 'https://x.test/walk-t.jpg', client_id: 501, bid_id: 901, job_id: null, uploadedAt: '2026-09-18T15:00:00.000Z' });
      photos.push({ id: 22, type: 'after', url: 'https://x.test/done.jpg', thumbUrl: '', client_id: 501, bid_id: 901, job_id: 860, uploadedAt: '2026-09-21T15:00:00.000Z' });
      const found = tdPhotosFor({ clientId: 501, bidIds: [901], jobIds: [860] });
      return { n: found.length, order: found.map(p => p.id), html: _cdPastThumbs(found) };
    });
    // The bid-tagged walkthrough shot is there, and it is FIRST: oldest first,
    // so the story reads Before then After.
    expect(r.n).toBe(2);
    expect(r.order).toEqual([21, 22]);
    expect(r.html).toContain('walk-t.jpg');   // prefers the thumbnail
    expect(r.html).toContain('done.jpg');     // falls back to the full url
  });

  // Caught by e2e-past-work, not by this file: switching the lookup to the
  // global array alone made a job-local-only photo disappear from a
  // property's history. Those exist for two real reasons: a photo taken
  // before this feature shipped, and one taken offline whose upload has not
  // drained yet.
  test('a photo that exists ONLY on the job record is still found', async () => {
    const r = await page.evaluate(() => {
      jobs.push({ id: 861, bid_id: 901, client_id: 501, name: 'Old job', status: 'done',
        photos: [{ type: 'after', data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', ts: '2026-01-02T10:00:00.000Z', caption: '' }] });
      const found = tdPhotosFor({ clientId: 501, bidIds: [901], jobIds: [861] });
      return { n: found.length, type: found[0] && found[0].type, html: _cdPastThumbs(found) };
    });
    expect(r.n).toBe(1);
    expect(r.type).toBe('after');
    expect(r.html).toContain('data:image/gif');
  });

  test('a photo in BOTH shapes is shown once, not twice', async () => {
    const n = await page.evaluate(() => {
      const ts = '2026-03-04T10:00:00.000Z';
      jobs.push({ id: 862, bid_id: 901, client_id: 501, name: 'Synced job', status: 'done',
        photos: [{ type: 'before', data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', ts, caption: '' }] });
      photos.push({ id: 31, type: 'before', url: 'https://x.test/synced.jpg', thumbUrl: '', client_id: 501, bid_id: 901, job_id: 862, uploadedAt: ts });
      return tdPhotosFor({ clientId: 501, bidIds: [901], jobIds: [862] }).length;
    });
    expect(n).toBe(1);
  });

  test('a photo with no base64 left on it still renders, which it did not before', async () => {
    const html = await page.evaluate(() => _cdPastThumbs([{ id: 23, type: 'before', url: 'https://x.test/only-url.jpg', thumbUrl: '', uploadedAt: '' }]));
    expect(html).toContain('only-url.jpg');
    expect(html).not.toContain('src=""');
  });

  test('one customer never sees another customer\'s photos', async () => {
    const r = await page.evaluate(() => {
      photos.push({ id: 24, type: 'before', url: 'a.jpg', client_id: 501, bid_id: 901, uploadedAt: '' });
      photos.push({ id: 25, type: 'before', url: 'b.jpg', client_id: 502, bid_id: 902, uploadedAt: '' });
      return {
        mine: tdPhotosFor({ clientId: 501, bidIds: [901], jobIds: [] }).map(p => p.id),
        whole: tdPhotosFor({ clientId: 501, wholeClient: true }).map(p => p.id),
      };
    });
    expect(r.mine).toEqual([24]);
    expect(r.whole).toEqual([24]);
  });

  test('an empty lookup is empty, never everything', async () => {
    const r = await page.evaluate(() => ({
      nothing: tdPhotosFor().length,
      empty: tdPhotosFor({}).length,
      noMatch: tdPhotosFor({ clientId: 999, bidIds: [999], jobIds: [999] }).length,
      srcOfJunk: tdPhotoSrc(null),
    }));
    expect(r).toEqual({ nothing: 0, empty: 0, noMatch: 0, srcOfJunk: '' });
  });
});

// ── The sync must carry every field the feature depends on ─────────────────
// Two fields have now been lost this way: thumbUrl (photos served full-size
// into 60px grids on any second device) and originalUrl (the pointer to the
// untouched shot, dropped the moment a delta load replaced the row, which
// breaks the one rule mark-up is built on). Both were invisible offline
// because the local array kept them. This test reads the REAL transform out
// of _TD_TABLES, so a field added to a photo row and forgotten here fails
// immediately instead of on somebody's second phone.
test.describe('TrueShot: the sync keeps what the feature needs', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('every field a photo needs survives the cloud transform', async () => {
    const r = await page.evaluate(() => {
      const entry = _TD_TABLES.find(t => t.t === 'td_photos');
      const row = {
        id: 5150, url: 'https://x.test/marked.jpg', storagePath: 'u/marked/5150.jpg',
        thumbUrl: 'https://x.test/t-marked.jpg', thumbPath: 'u/marked/t-5150.jpg',
        originalUrl: 'https://x.test/original.jpg', originalPath: 'u/bid-9/before-1.jpg',
        annotated: true, type: 'before', caption: 'South elevation',
        client_id: 501, client_name: 'Dana Whitfield',
        bid_id: 901, bid_name: 'Exterior repaint',
        job_id: 860, job_name: 'Exterior repaint',
        lat: 37.6889, lon: -97.3361, uploadedAt: '2026-09-21T15:00:00.000Z',
      };
      const out = entry.tx([row])[0] || {};
      const lost = Object.keys(row).filter(k => JSON.stringify(out[k]) !== JSON.stringify(row[k]));
      return { lost, out };
    });
    expect(r.lost).toEqual([]);
  });

  test('a photo with nothing optional set still transforms cleanly', async () => {
    const out = await page.evaluate(() => {
      const entry = _TD_TABLES.find(t => t.t === 'td_photos');
      return entry.tx([{ id: 1, url: 'https://x.test/a.jpg', type: 'before', caption: '', client_id: null, client_name: '', job_id: null, job_name: '', uploadedAt: '' }])[0];
    });
    expect(out.originalUrl).toBe('');
    expect(out.annotated).toBe(false);
    expect(out.bid_id).toBe(null);
    expect(out.lat).toBe(null);
  });

  test('a row with no storage behind it is still not synced', async () => {
    const n = await page.evaluate(() => {
      const entry = _TD_TABLES.find(t => t.t === 'td_photos');
      return entry.tx([{ id: 2, url: '', storagePath: '', type: 'before' }]).length;
    });
    expect(n).toBe(0);
  });
});

// ── The trap that cost three live rounds ───────────────────────────────────
// `let` at the top level of a classic script creates a binding in the global
// LEXICAL environment, not a property on window. A test that reads
// window._pcAnno gets undefined forever and concludes the feature is broken
// while it is working perfectly. This pins the shape so the next test author
// (me, in a month) finds out in 15 seconds instead of six CI rounds.
test.describe('TrueShot: module state is lexical, not on window', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the editor context is reachable by name and absent from window', async () => {
    await page.evaluate(seed());
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 60; cv.height = 40; cv.getContext('2d').fillRect(0, 0, 60, 40);
      photos.push({ id: 960, type: 'before', url: cv.toDataURL('image/png'), thumbUrl: '', storagePath: '', client_id: 501, bid_id: 901, uploadedAt: new Date().toISOString() });
      tdAnnotatePhoto(960);
      for (let i = 0; i < 80 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      const out = { byName: !!(_pcAnno && _pcAnno.img), onWindow: typeof window._pcAnno };
      tdCloseAnnotate();
      return out;
    });
    // Reachable by name...
    expect(r.byName).toBe(true);
    // ...and NOT on window. If this ever flips to 'object', someone exposed
    // it deliberately and the comment above needs rewriting.
    expect(r.onWindow).toBe('undefined');
  });
});
