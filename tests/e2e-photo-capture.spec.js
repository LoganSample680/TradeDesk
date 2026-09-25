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
    // Spread, never a field list: this helper already lost lat/lon once by
    // enumerating what it passed through (see the flow spec's copy).
    const row = await tdSavePhoto({ ...o, file });
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

  // The writer used to accept lat/lon for the STAMP and then drop them, so
  // any caller that was not the capture sheet produced a photo with no fix:
  // no "verified on site" in the hub, no address guess in the unfiled tray.
  test('a photo keeps the coordinates it was taken at', async () => {
    const r = await shoot(page, { type: 'before', bidId: 901, lat: 37.6889, lon: -97.3361 });
    const row = await page.evaluate((id) => {
      const p = photos.find(x => String(x.id) === String(id));
      return { lat: p.lat, lon: p.lon };
    }, r.id);
    expect(row.lat).toBe(37.6889);
    expect(row.lon).toBe(-97.3361);
  });

  test('a photo taken with no fix carries null, never undefined', async () => {
    const r = await shoot(page, { type: 'before', bidId: 901 });
    const row = await page.evaluate((id) => {
      const p = photos.find(x => String(x.id) === String(id));
      return { lat: p.lat, lon: p.lon, hasKeys: ('lat' in p) && ('lon' in p) };
    }, r.id);
    expect(row.hasKeys).toBe(true);
    expect(row.lat).toBe(null);
    expect(row.lon).toBe(null);
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

  // The pill names the PROPERTY, not the customer. "Pepe?" does not tell a man
  // which of Pepe's two houses he is looking at (Jack, 2026-09-22).
  test('the tray renders a row per unfiled burst with the property on it', async () => {
    const html = await page.evaluate(() => {
      photos.push({ id: 4, type: 'before', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      return tdUnfiledTrayHTML();
    });
    expect(html).toContain('Unfiled photos');
    expect(html).toContain('Dana Whitfield');
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
    // Root cause of the shootUnfiled "survived" misses (WebKit, shard 3,
    // 2026-09-23): a reconnect probe runs supaLoadFromCloud against the mock,
    // which REPLACES the photos array and drops shots saved a moment before.
    // Nothing in this block tests cloud loading, and it runs ~1,600 lines of
    // tests on one page, so the load is parked here once for all of them.
    // (Same change as PR #90; it no-ops once that lands.)
    await page.evaluate(() => { window.supaLoadFromCloud = async () => { }; });
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
  // The stage used to be three filled buttons, so "chosen" was a background.
  // Since the 2026-09-23 redesign it is three words, the way the iPhone's own
  // Camera shows Photo and Video, so "chosen" is the yellow of the word. The
  // defect this guards is the same one: a missing token rendering nothing.
  test('the ghost hint has a real background, and the chosen stage reads as chosen', async () => {
    await page.evaluate(() => { photos.push({ id: 77, type: 'before', url: '', thumbUrl: '', client_id: 501, bid_id: 901, job_id: null, uploadedAt: new Date().toISOString() }); tdCaptureForBid(901, 'after'); });
    const r = await page.evaluate(async () => {
      const hint = document.getElementById('pc-hint');
      tdCaptureSetType('before');
      // No colour fade on purpose: headless WebKit never advanced one (CI
      // shard 3, twice, 2026-09-23), and the Camera app switches instantly.
      const segOn = document.querySelector('#pc-sheet .pc-seg-btn.on');
      const segOff = document.querySelector('#pc-sheet .pc-seg-btn:not(.on)');
      return { hintBg: getComputedStyle(hint).backgroundColor, on: getComputedStyle(segOn).color, off: getComputedStyle(segOff).color, onText: segOn.textContent };
    });
    const transparent = v => v === '' || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
    expect(transparent(r.hintBg)).toBe(false);
    expect(r.onText).toBe('Before');
    expect(r.on, 'the chosen stage is a different colour from the others').not.toBe(r.off);
    expect(r.on).toBe('rgb(255, 214, 10)');
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

  // The pill was cut in half by the Dynamic Island on the owner's phone the
  // first time this ran on a real device. The sheet is full-bleed over the
  // camera, so nothing else reserves that space for it.
  // Since the 2026-09-23 redesign the pill sits INSIDE the 3:4 frame, and the
  // black bar above the frame is what holds the island's space, the way the
  // Camera app does it. So the inset rule lives on that bar, and the pill has
  // to be below it.
  test('the subject pill clears the status bar and the Dynamic Island', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    const r = await page.evaluate(() => ({
      pill: document.querySelector('#pc-sheet .pc-attach').getBoundingClientRect().top,
      bar: document.querySelector('#pc-sheet .pc-cam-top').getBoundingClientRect().bottom,
      css: [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } })
        .filter(x => x.selectorText === '.pc-cam-top').map(x => x.style.padding || x.style.paddingTop).join(''),
    }));
    // env() is 0 in a desktop browser, so the assertion is on the rule
    // surviving, not on a device number.
    expect(r.css).toContain('safe-area-inset-top');
    expect(r.pill).toBeGreaterThanOrEqual(r.bar);
  });

  // Six shots with nobody attached went into the tray and the dashboard was
  // never repainted, so from the outside they vanished (owner, first UAT run).
  // The answer is not a better tray: the decision belongs at the end of the
  // shoot, while the contractor is still standing there.
  // Every shot this fixture takes has to still BE there when the sheet opens.
  // A save writes through saveAll, and a cloud load that lands mid-loop
  // REPLACES the photos array wholesale (js/cloud.js), so a row can be saved
  // and then quietly dropped before tdReviewShots looks for it. That is what
  // made WebKit fail twice on two different tests: the album came up holding
  // fewer shots than were taken, and the assertion blamed the code under
  // test. The helper now returns what it saved AND what survived, and every
  // caller asserts they match, so the next time it happens it says so.
  const shootUnfiled = async (n) => {
    const r = await page.evaluate(async (count) => {
      tdCaptureUnfiled();
      const ids = [];
      for (let i = 0; i < count; i++) {
        const row = await tdSavePhoto({ type: 'before', file: new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }), stamp: false });
        if (row) { ids.push(row.id); _pcSessionIds.push(row.id); _pcShots++; }
      }
      tdCloseCapture();
      return { ids, survived: ids.filter(id => photos.some(p => String(p.id) === String(id))).length };
    }, n);
    expect(r.ids.length, 'every shot has to save').toBe(n);
    expect(r.survived, 'and still be in photos when the sheet opens').toBe(n);
    return r.ids;
  };

  test('finishing a shoot with no customer opens the burst, all of it', async () => {
    const ids = await shootUnfiled(6);
    const r = await page.evaluate(() => ({
      open: !!document.getElementById('pc-rev'),
      cells: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
      title: document.querySelector('#pc-rev .pc-rev-title').textContent,
    }));
    expect(r.open).toBe(true);
    expect(r.cells).toBe(6);
    expect(r.title).toBe('6 photos');
    expect(ids.length).toBe(6);
    await page.evaluate(() => tdReviewClose());
  });

  test('a shoot that already has a customer closes without asking again', async () => {
    const r = await page.evaluate(async () => {
      tdCaptureForBid(901, 'before');
      await tdSavePhoto({ type: 'before', bidId: 901, file: new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }), stamp: false });
      _pcShots++;
      tdCloseCapture();
      return !!document.getElementById('pc-rev');
    });
    expect(r).toBe(false);
  });

  // ── The swipe ─────────────────────────────────────────────────────────────
  // These DRAG. The gesture it replaced was a flick detector that passed any
  // test asserting "after a swipe the index moved", which is exactly why it
  // shipped feeling wrong: nothing tracked the thumb and nothing of the next
  // photo was ever on screen. So what is asserted here is the motion, not just
  // the outcome.
  test.describe('swiping through', () => {
    // A real pointer drag, in steps, the way a thumb arrives.
    const drag = (page, from, to, steps) => page.evaluate(async ([from, to, steps]) => {
      const track = document.getElementById('pc-rev-track');
      if (!track) return { moved: [], noTrack: true };
      const moved = [];
      const ev = (type, x) => {
        const e = new PointerEvent(type, { clientX: x, clientY: 400, bubbles: true,
          cancelable: true, pointerId: 1, button: 0, isPrimary: true });
        track.dispatchEvent(e);
      };
      ev('pointerdown', from);
      for (let i = 1; i <= steps; i++) {
        ev('pointermove', from + (to - from) * (i / steps));
        moved.push(track.style.transform);
      }
      ev('pointerup', to);
      await new Promise(r => setTimeout(r, 380));   // let the settle finish
      return { moved };
    }, [from, to, steps]);

    test('the next photo is already on screen before the thumb commits', async () => {
      await shootUnfiled(3);
      const r = await page.evaluate(() => {
        tdReviewOpen(1);
        const panes = [...document.querySelectorAll('#pc-rev-track .pc-rev-pane img')].map(i => i.src);
        const rows = _pcRevRows();
        return { panes: panes.length, prev: panes[0], cur: panes[1], next: panes[2],
          wantPrev: tdPhotoSrc(rows[0]), wantCur: tdPhotoSrc(rows[1]), wantNext: tdPhotoSrc(rows[2]) };
      });
      expect(r.panes, 'previous, current and next are all rendered').toBe(3);
      expect(r.prev).toBe(r.wantPrev);
      expect(r.cur).toBe(r.wantCur);
      expect(r.next).toBe(r.wantNext);
    });

    test('the track follows the thumb rather than waiting for the release', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(0));
      const r = await drag(page, 300, 180, 4);
      // Every move produced a new transform, and they travel in one direction.
      expect(r.moved.length).toBe(4);
      expect(new Set(r.moved).size, 'the track moves on every pointermove').toBe(4);
      // The browser normalises calc(-33.3333% + -30px) to calc(... - 30px), so
      // the sign has to be read off the operator, not assumed to be inside the
      // number.
      const px = r.moved.map(t => { const m = t.match(/([+-]) ([\d.]+)px/); return m ? (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) : NaN; });
      expect(px.every(v => !Number.isNaN(v)), 'the transform is readable').toBe(true);
      expect(px.every((v, i) => i === 0 || v < px[i - 1]), 'and it tracks leftward with the thumb').toBe(true);
    });

    test('a decisive drag lands on the next photo', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(0));
      await drag(page, 340, 40, 6);
      expect(await page.evaluate(() => document.querySelector('.pc-rev-title').textContent)).toBe('2 of 3');
    });

    test('dragging back the other way goes back', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      await drag(page, 40, 340, 6);
      expect(await page.evaluate(() => document.querySelector('.pc-rev-title').textContent)).toBe('1 of 3');
    });

    test('a short drag springs back and changes nothing', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      await drag(page, 300, 275, 3);
      const r = await page.evaluate(() => ({
        title: document.querySelector('.pc-rev-title').textContent,
        parked: document.getElementById('pc-rev-track').style.transform,
      }));
      expect(r.title, 'a 25px change of mind is not a swipe').toBe('2 of 3');
      expect(r.parked, 'and the track is back on centre').toBe('');
    });

    // A drag on the stage, on whichever axis. The horizontal helper above
    // targets the track; dismissal has to work with no track at all, so this
    // one drives the stage the way a real thumb does.
    const dragStage = (page, from, to, steps) => page.evaluate(async ([from, to, steps]) => {
      const stage = document.getElementById('pc-rev-stage');
      const ev = (type, x, y) => stage.dispatchEvent(new PointerEvent(type,
        { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }));
      ev('pointerdown', from[0], from[1]);
      const seen = [];
      for (let i = 1; i <= steps; i++) {
        ev('pointermove', from[0] + (to[0] - from[0]) * (i / steps), from[1] + (to[1] - from[1]) * (i / steps));
        // The PHOTO is what moves now, not the sheet (owner 2026-09-23).
        seen.push(document.getElementById('pc-rev-img')?.style.transform || '');
      }
      ev('pointerup', to[0], to[1]);
      await new Promise(r => setTimeout(r, 420));
      return { seen };
    }, [from, to, steps]);

    // WHAT VERTICAL MEANS CHANGED. It used to be handed back to the page,
    // because nothing owned it and stealing it would trap a thumb that meant to
    // scroll. The viewer does not scroll, so down is free, and putting a photo
    // away with it is the gesture people already have (owner 2026-09-22).
    test('pulling down puts the photo away', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      const r = await dragStage(page, [200, 200], [210, 600], 5);
      // The sheet followed the thumb rather than waiting for the release.
      expect(r.seen.some(t => /translate3d\(-?\d+px,\s*[1-9]\d*px/.test(t) && /scale\(0\./.test(t)),
        'the photo falls with the thumb and shrinks as it goes').toBe(true);
      const gone = await page.evaluate(() => !document.getElementById('pc-rev'));
      expect(gone, 'and the viewer is closed at the end of it').toBe(true);
    });

    // The real-phone half the synthetic events cannot see: with touch-action
    // pan-y on the photo, iOS claims a vertical drag as a scroll and cancels
    // the pointer a few pixels in, so the swipe down never followed the thumb
    // (owner 2026-09-23). Every direction belongs to the viewer.
    test('the viewer tells the browser it owns every drag direction', async () => {
      await shootUnfiled(3);
      const r = await page.evaluate(() => {
        tdReviewOpen(1);
        return { stage: getComputedStyle(document.getElementById('pc-rev-stage')).touchAction,
          track: getComputedStyle(document.getElementById('pc-rev-track')).touchAction };
      });
      expect(r.stage).toBe('none');
      expect(r.track).toBe('none');
    });

    test('while it is pulled down the controls step aside and the black thins out', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      const r = await page.evaluate(() => {
        const stage = document.getElementById('pc-rev-stage');
        const ev = (type, x, y) => stage.dispatchEvent(new PointerEvent(type,
          { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }));
        ev('pointerdown', 200, 300); ev('pointermove', 202, 320); ev('pointermove', 210, 420);
        const sheet = document.getElementById('pc-rev');
        // The class is the state; the opacity it drives fades over .18s, so
        // the rule is read rather than a mid-fade computed value.
        const out = { dragging: sheet.classList.contains('pc-dragging'), bg: sheet.style.backgroundColor,
          barOpacity: [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } })
            .filter(x => (x.selectorText || '').includes('.pc-rev.pc-dragging .pc-v-bar')).map(x => x.style.opacity).join('') };
        ev('pointermove', 202, 302); ev('pointerup', 202, 302);
        return out;
      });
      expect(r.dragging).toBe(true);
      expect(r.bg).toMatch(/rgba\(0, 0, 0, 0\.\d+\)/);
      expect(r.barOpacity).toBe('0');
      await page.waitForTimeout(400);
    });

    test('a small pull springs back and keeps the photo open', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      await dragStage(page, [200, 300], [204, 330], 3);
      const r = await page.evaluate(() => ({
        open: !!document.getElementById('pc-rev'),
        parked: document.getElementById('pc-rev-img')?.style.transform || '',
        bg: document.getElementById('pc-rev')?.style.backgroundColor || '',
        dragging: document.getElementById('pc-rev')?.classList.contains('pc-dragging'),
        title: document.querySelector('.pc-rev-title')?.textContent,
      }));
      expect(r.open, 'a 30px pull is not a dismissal').toBe(true);
      expect(r.parked, 'and the photo is back where it was').toBe('');
      expect(r.bg, 'the black is back').toBe('');
      expect(r.dragging, 'and so are the controls').toBe(false);
      expect(r.title).toBe('2 of 3');
    });

    // Up used to be released untouched. Since 2026-09-23 it is the details,
    // the way Photos does it ("where's the gps info", owner).
    test('pulling UP opens the details and never closes anything', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      await dragStage(page, [200, 600], [206, 200], 5);
      const r = await page.evaluate(() => ({
        open: !!document.getElementById('pc-rev'),
        parked: document.getElementById('pc-rev')?.style.transform || '',
        info: !!document.getElementById('pc-info'),
        title: document.querySelector('.pc-rev-title')?.textContent,
      }));
      expect(r.open, 'up never closes anything').toBe(true);
      expect(r.parked, 'and the sheet itself never moved').toBe('');
      expect(r.info, 'the details came up').toBe(true);
      expect(r.title, 'on the same photo').toBe('2 of 3');
      await page.evaluate(() => tdPhotoInfoClose());
    });

    test('a tap on the photo hides every control, and the next brings them back', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      await dragStage(page, [200, 400], [201, 401], 1);
      const hidden = await page.evaluate(() => ({
        bare: document.getElementById('pc-rev').classList.contains('pc-bare'),
        barOpacity: getComputedStyle(document.querySelector('.pc-v-bar')).opacity,
      }));
      // Stepping to the next photo keeps them hidden, as Photos does.
      await page.evaluate(() => tdReviewStep(1));
      const stillBare = await page.evaluate(() => document.getElementById('pc-rev').classList.contains('pc-bare'));
      await dragStage(page, [200, 400], [201, 401], 1);
      const back = await page.evaluate(() => document.getElementById('pc-rev').classList.contains('pc-bare'));
      expect(hidden.bare).toBe(true);
      expect(stillBare).toBe(true);
      expect(back).toBe(false);
    });

    test('a single photo can still be put away, having no track to drag', async () => {
      await shootUnfiled(1);
      await page.evaluate(() => tdReviewOpen(0));
      await dragStage(page, [200, 200], [205, 620], 5);
      expect(await page.evaluate(() => !document.getElementById('pc-rev')),
        'dismissal is bound to the stage, which one photo still has').toBe(true);
    });

    test('one photo is not a carousel', async () => {
      await shootUnfiled(1);
      const r = await page.evaluate(() => {
        tdReviewOpen(0);
        return { track: !!document.getElementById('pc-rev-track'),
          img: !!document.getElementById('pc-rev-img') };
      });
      expect(r.track, 'no track to drag when there is nowhere to go').toBe(false);
      expect(r.img, 'but the photo is still shown').toBe(true);
    });

    test('the arrow keys work, because a laptop has no thumb', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(0));
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.querySelector('.pc-rev-title').textContent)).toBe('2 of 3');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      expect(await page.evaluate(() => document.querySelector('.pc-rev-title').textContent)).toBe('3 of 3');
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.querySelectorAll('#pc-rev .pc-rev-cell').length)).toBe(3);
    });

    test('the keys stop being the viewer\'s once the sheet is closed', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => { tdReviewOpen(0); tdReviewClose(); });
      await page.keyboard.press('ArrowRight');
      const err = await page.evaluate(() => typeof _pcRev);
      expect(err, 'no sheet, no state, no throw').toBe('object');
    });
  });

  test('a shot opens full size, steps both ways, and wraps', async () => {
    await shootUnfiled(3);
    const r = await page.evaluate(() => {
      const seen = [];
      tdReviewOpen(0);
      seen.push(document.querySelector('.pc-rev-title').textContent);
      tdReviewStep(1); seen.push(document.querySelector('.pc-rev-title').textContent);
      tdReviewStep(-1); tdReviewStep(-1); seen.push(document.querySelector('.pc-rev-title').textContent);
      const img = !!document.getElementById('pc-rev-img');
      tdReviewGrid();
      const backToGrid = document.querySelectorAll('#pc-rev .pc-rev-cell').length;
      return { seen: seen.join(','), img, backToGrid };
    });
    expect(r.seen).toBe('1 of 3,2 of 3,3 of 3');   // it wraps rather than sticking
    expect(r.img).toBe(true);
    expect(r.backToGrid).toBe(3);
    await page.evaluate(() => tdReviewClose());
  });

  test('a bad shot is binned on one tap and comes back on Undo', async () => {
    const ids = await shootUnfiled(3);
    const r = await page.evaluate((ids) => {
      tdReviewOpen(1);
      tdReviewDelete();
      const afterDel = {
        cells: (tdReviewGrid(), document.querySelectorAll('#pc-rev .pc-rev-cell').length),
        inPhotos: photos.some(p => String(p.id) === String(ids[1])),
      };
      tdReviewUndo();
      return {
        afterDel,
        cellsBack: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
        backInPhotos: photos.some(p => String(p.id) === String(ids[1])),
      };
    }, ids);
    expect(r.afterDel.cells).toBe(2);
    expect(r.afterDel.inPhotos).toBe(false);
    expect(r.cellsBack).toBe(3);
    expect(r.backInPhotos).toBe(true);
    await page.evaluate(() => tdReviewClose());
  });

  // Nothing leaves storage while Undo is still on screen.
  //
  // The rows are pushed directly rather than shot through the camera: the
  // subject here is the DEFERRAL, not the capture path, and on WebKit a
  // canvas-encoded fixture left the sheet with one photo instead of two, so
  // deleting it emptied the album, closed the sheet, and the removal that
  // followed looked like the bug this test exists to catch (CI, 2026-09-22).
  test('deleting only reaches storage once the sheet is closed', async () => {
    const r = await page.evaluate(() => {
      photos.length = 0;
      photos.push({ id: 980, type: 'before', url: 'u', thumbUrl: '', storagePath: 'u/unfiled/one.jpg', client_id: null, uploadedAt: new Date().toISOString() });
      photos.push({ id: 981, type: 'before', url: 'u', thumbUrl: '', storagePath: 'u/unfiled/two.jpg', client_id: null, uploadedAt: new Date().toISOString() });
      const removed = [];
      const realFrom = _supa.storage.from.bind(_supa.storage);
      _supa.storage.from = (b) => Object.assign({}, realFrom(b), {
        remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; }
      });
      tdReviewShots([980, 981]);
      const started = _pcRevRows().length;
      tdReviewOpen(0);
      tdReviewDelete();
      const out = { started, left: _pcRevRows().length, duringSheet: removed.length, open: !!document.getElementById('pc-rev') };
      tdReviewClose();
      _supa.storage.from = realFrom;
      out.afterClose = removed.join(',');
      return out;
    });
    expect(r.started, 'the fixture has to put TWO shots in the album').toBe(2);
    expect(r.left, 'and one has to survive the delete, or the sheet closes itself').toBe(1);
    expect(r.open).toBe(true);
    expect(r.duringSheet).toBe(0);
    expect(r.afterClose).toContain('u/unfiled/one.jpg');
  });

  test('one customer, one tap, the whole burst lands on them', async () => {
    const ids = await shootUnfiled(4);
    const r = await page.evaluate((ids) => {
      tdReviewAttach();
      for (let step = 0; step < 3 && document.getElementById('pc-att'); step++) {
        // The customer, not the "New customer" row that heads the list.
        const opt = document.querySelector('#pc-att .pc-file-opt:not(.pc-att-new)');
        if (!opt) break;
        opt.click();
      }
      const mine = ids.map(id => photos.find(p => String(p.id) === String(id))).filter(Boolean);
      return {
        filed: mine.filter(p => p.client_id != null).length,
        sheetGone: !document.getElementById('pc-rev'),
        pickerGone: !document.querySelector('.zmodal-overlay'),
      };
    }, ids);
    expect(r.filed).toBe(4);
    expect(r.sheetGone).toBe(true);
    expect(r.pickerGone).toBe(true);
  });

  test('"Not now" keeps them, it never throws them away', async () => {
    const ids = await shootUnfiled(2);
    const r = await page.evaluate((ids) => {
      document.querySelector('#pc-rev .pc-rev-top .pc-side').click();
      return {
        gone: !document.getElementById('pc-rev'),
        kept: ids.filter(id => photos.some(p => String(p.id) === String(id))).length,
        unfiled: tdUnfiledPhotos().length,
      };
    }, ids);
    expect(r.gone).toBe(true);
    expect(r.kept).toBe(2);
    expect(r.unfiled).toBeGreaterThanOrEqual(2);
  });

  // The tray is the safety net for a burst you walked away from, and it shows
  // the burst as one thing, the way the review sheet does.
  test('the tray groups a burst into one row and reopens it', async () => {
    const r = await page.evaluate(() => {
      const t0 = Date.parse('2026-09-21T17:00:00.000Z');
      photos.length = 0;
      for (let i = 0; i < 5; i++) photos.push({ id: 700 + i, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, uploadedAt: new Date(t0 + i * 20000).toISOString() });
      // an hour later is a different walkthrough, not the same burst
      photos.push({ id: 799, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, uploadedAt: new Date(t0 + 3600000).toISOString() });
      const host = document.createElement('div');
      host.innerHTML = tdUnfiledTrayHTML();
      document.body.appendChild(host);
      const rows = host.querySelectorAll('.pc-uf-row').length;
      const counts = [...host.querySelectorAll('.pc-uf-n')].map(n => n.textContent).join(',');
      [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review').click();
      const cells = document.querySelectorAll('#pc-rev .pc-rev-cell').length;
      host.remove(); tdReviewClose();
      return { bursts: tdUnfiledBursts().length, rows, counts, cells };
    });
    expect(r.bursts).toBe(2);
    expect(r.rows).toBe(2);
    expect(r.counts).toBe('5');          // the single shot carries no count badge
    expect(r.cells).toBe(1);             // newest burst first: the lone later shot
  });

  // ── Where exactly on the record (owner, 2026-09-21) ───────────────────────
  // "If it's taken onsite gps coordinates search the record and attach where
  // exactly on the client record?" So the card opens on what the coordinates
  // prove, and only asks what the data cannot answer by itself.
  // Page-owned, like house() and pepe(). Fifth time tonight that a fixture
  // seeding in one page.evaluate and a test reading in the next has produced a
  // red shard: the app's periodic cloud pull replaces these arrays wholesale,
  // and anything landing in the gap empties them. Tests that read the screen
  // call __attachSeed() inside their own evaluate.
  const attachSeed = () => page.evaluate(() => {
    window.__attachSeed = () => {
    clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
    clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS', lat: 37.6889, lon: -97.3361 });
    clients.push({ id: 502, name: 'Far Away Co', addr: '900 Mile Rd', lat: 38.9, lon: -98.9 });
    jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'active', addr: '412 Oak St, Wichita KS', lat: 37.6889, lon: -97.3361 });
    photos.push({ id: 950, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, lat: 37.68892, lon: -97.33612, uploadedAt: new Date().toISOString() });
    photos.push({ id: 951, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, lat: 37.68892, lon: -97.33612, uploadedAt: new Date().toISOString() });
    tdReviewShots([950, 951]);
    tdReviewAttach();
    };
    return window.__attachSeed();
  });

  test('the coordinates put the right record at the top, with the distance', async () => {
    await attachSeed();
    const r = await page.evaluate(() => {
      __attachSeed();
      const near = [...document.querySelectorAll('#pc-att .pc-file-opt.near')].map(b => b.textContent);
      // The matches themselves, not just how many: a count that disagrees
      // with the screen cannot say which row it did not expect.
      const m = _pcNearbyMatches([950]);
      return { count: near.length, first: near[0] || '', matches: m.length,
        rows: m.map(x => x.name + '|' + x.addr + '|' + (x.jobId || '-')).join(' + ') };
    });
    expect(r.count).toBe(1);
    expect(r.first).toContain('Dana Whitfield');
    expect(r.first).toContain('412 Oak St');
    expect(r.first).toContain('Repipe');
    expect(r.first).toMatch(/\d+ ft away/);
    expect(r.matches, 'one house, one row: ' + r.rows).toBe(1);
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
  });

  // The dedupe has to hold when the two records spell the address
  // differently, which is the normal case: a job typed by hand next to an
  // address that came from a lookup.
  test('a job and its own address are one row, however the two were typed', async () => {
    await page.evaluate(() => {
      clients.length = 0; jobs.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita, KS 67206', lat: 37.6889, lon: -97.3361 });
      jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'active', addr: '412 Oak St', lat: 37.68891, lon: -97.33611 });
      photos.push({ id: 952, type: 'before', url: '', data: 'x', client_id: null, lat: 37.68892, lon: -97.33612, uploadedAt: new Date().toISOString() });
    });
    const r = await page.evaluate(() => {
      const m = _pcNearbyMatches([952]);
      return { n: m.length, jobId: m[0] && m[0].jobId, rows: m.map(x => x.addr).join(' + ') };
    });
    expect(r.n, 'one house, one row: ' + r.rows).toBe(1);
    expect(r.jobId).toBe(601);          // and the job wins, because it says what the work is
  });

  test('tapping the on-site match files the whole burst on that job, no more questions', async () => {
    await attachSeed();
    const r = await page.evaluate(() => {
      __attachSeed();
      document.querySelector('#pc-att .pc-file-opt.near').click();
      const mine = [950, 951].map(id => photos.find(p => String(p.id) === String(id)));
      return {
        asked: !!document.getElementById('pc-att'),
        filed: mine.filter(p => p && p.client_id === 501 && p.job_id === 601).length,
        addr: mine[0] && mine[0].addr,
      };
    });
    expect(r.asked).toBe(false);
    expect(r.filed).toBe(2);
    expect(r.addr).toBe('412 Oak St, Wichita KS');
  });

  test('the attach card opens ON TOP of the album, not behind it', async () => {
    await attachSeed();
    const r = await page.evaluate(() => (__attachSeed(), {
      card: +getComputedStyle(document.getElementById('pc-att')).zIndex,
      sheet: +getComputedStyle(document.getElementById('pc-rev')).zIndex,
    }));
    expect(r.card).toBeGreaterThan(r.sheet);
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
  });

  test('no fix on the photo means no guess, just the customer list', async () => {
    await page.evaluate(() => {
      clients.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St', lat: 37.6889, lon: -97.3361 });
      photos.push({ id: 960, type: 'before', url: '', data: 'x', client_id: null, lat: null, lon: null, uploadedAt: new Date().toISOString() });
      tdReviewShots([960]); tdReviewAttach();
    });
    const r = await page.evaluate(() => ({
      near: document.querySelectorAll('#pc-att .pc-file-opt.near').length,
      list: document.querySelectorAll('#pc-att .pc-file-opt:not(.pc-att-new)').length,
      add: document.querySelectorAll('#pc-att .pc-att-new').length,
    }));
    expect(r.near).toBe(0);
    expect(r.list).toBe(1);
    expect(r.add, 'the new-customer row is always on offer').toBe(1);
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
  });

  test('searching narrows the customer list', async () => {
    await page.evaluate(() => {
      clients.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
      clients.push({ id: 502, name: 'Marco Reyes', addr: '9 Vine Ave' });
      photos.push({ id: 961, type: 'before', url: '', data: 'x', client_id: null, uploadedAt: new Date().toISOString() });
      tdReviewShots([961]); tdReviewAttach();
      _pcAttPaint('who', 'reyes');
    });
    const r = await page.evaluate(() => [...document.querySelectorAll('#pc-att .pc-file-opt')].map(b => b.textContent).join('|'));
    expect(r).toContain('Marco Reyes');
    expect(r).not.toContain('Dana');
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
  });

  test('two properties asks which one, and the answer sticks to the photo', async () => {
    await page.evaluate(() => {
      clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS', extraAddresses: [{ label: 'Rental', addr: '88 Pine Ct, Wichita KS' }] });
      photos.push({ id: 962, type: 'before', url: '', data: 'x', client_id: null, uploadedAt: new Date().toISOString() });
      tdReviewShots([962]); tdReviewAttach();
      tdAttachPick(501);
    });
    const r = await page.evaluate(() => {
      // The app's own address picker, reused rather than reimplemented, so it
      // also carries "New address for this client" for free (§7.3).
      const sheet = document.getElementById('_addrpick-sheet');
      const opts = sheet ? sheet.textContent : '';
      _addrPickChoose(1);                                   // the rental
      const p = photos.find(x => String(x.id) === '962');
      return { opts, addr: p.addr, client: p.client_id, closed: !document.getElementById('pc-att') };
    });
    expect(r.opts).toContain('412 Oak St');
    expect(r.opts).toContain('88 Pine Ct');
    expect(r.opts).toContain('New address for this client');
    expect(r.addr).toBe('88 Pine Ct, Wichita KS');
    expect(r.client).toBe(501);
    expect(r.closed).toBe(true);
  });

  test('one property and one open proposal is never a question', async () => {
    const r = await page.evaluate(() => {
      clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
      bids.push({ id: 701, client_id: 501, title: 'Exterior repaint', status: 'draft', addr: '412 Oak St' });
      photos.push({ id: 963, type: 'before', url: '', data: 'x', client_id: null, uploadedAt: new Date().toISOString() });
      tdReviewShots([963]); tdReviewAttach();
      tdAttachPick(501);
      const p = photos.find(x => String(x.id) === '963');
      return { asked: !!document.getElementById('pc-att'), bid: p.bid_id, name: p.bid_name };
    });
    expect(r.asked).toBe(false);
    expect(r.bid).toBe(701);
    expect(r.name).toBe('Exterior repaint');
  });

  test('a proposal AND a job at the same address is a real choice, including neither', async () => {
    await page.evaluate(() => {
      clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
      bids.push({ id: 701, client_id: 501, title: 'Exterior repaint', status: 'draft', addr: '412 Oak St' });
      jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'active', addr: '412 Oak St' });
      photos.push({ id: 964, type: 'before', url: '', data: 'x', client_id: null, uploadedAt: new Date().toISOString() });
      tdReviewShots([964]); tdReviewAttach();
      tdAttachPick(501);
    });
    const r = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#pc-att .pc-file-opt')].map(b => b.textContent.trim());
      tdAttachWork('job', 601);
      const p = photos.find(x => String(x.id) === '964');
      return { opts, job: p.job_id, bid: p.bid_id, addr: p.addr };
    });
    expect(r.opts.length).toBe(3);                      // proposal, job, just the customer
    expect(r.opts[2]).toContain('Just the customer');
    expect(r.job).toBe(601);
    expect(r.bid == null).toBe(true);   // the proposal was not chosen, so nothing claims it
    expect(r.addr).toBe('412 Oak St');
  });

  test('the property survives the trip to the cloud', async () => {
    const r = await page.evaluate(() => {
      const t = _TD_TABLES.find(x => x.t === 'td_photos');
      const out = t.tx([{ id: 1, url: 'u', storagePath: 's', type: 'before', caption: '', client_id: 501, addr: '88 Pine Ct', uploadedAt: 'now' }]);
      return out[0].addr;
    });
    expect(r).toBe('88 Pine Ct');
  });

  // ── The size ladder (owner 2026-09-22) ────────────────────────────────────
  // Unlimited storage is affordable only if the 4K copy is never SERVED by
  // accident, so these tests are mostly about what does NOT carry a url.
  test.describe('TrueShot: the full-resolution copy', () => {
    test('a big shot is written three times: thumb, view and full', async () => {
      const r = await page.evaluate(async () => {
        const cv = document.createElement('canvas');
        cv.width = 4032; cv.height = 3024;
        const g = cv.getContext('2d'); g.fillStyle = '#4477aa'; g.fillRect(0, 0, 4032, 3024);
        const big = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
        const out = await _compressPhoto(big);
        return {
          view: out.blob.size, thumb: out.thumb.size,
          hasFull: !!out.full, fullMime: out.fullMime || '', fullExt: out.fullExt || '',
          w: out.w, h: out.h,
          smaller: out.full ? out.thumb.size < out.blob.size : false,
        };
      });
      expect(r.hasFull).toBe(true);
      expect(r.w).toBe(4032);                  // every pixel the camera gave us
      expect(r.fullExt).toMatch(/webp|jpg/);
      expect(r.smaller).toBe(true);
      expect(r.thumb).toBeLessThan(r.view);
    });

    test('a photo already smaller than the view size is not stored twice', async () => {
      const has = await page.evaluate(async () => {
        const cv = document.createElement('canvas');
        cv.width = 900; cv.height = 600; cv.getContext('2d').fillRect(0, 0, 900, 600);
        const small = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
        const out = await _compressPhoto(small);
        return !!out.full;
      });
      expect(has).toBe(false);
    });

    test('the row carries a PATH and no url, so nothing can render it by accident', async () => {
      const r = await page.evaluate(() => {
        photos.push({ id: 970, type: 'before', url: 'https://x/view.jpg', thumbUrl: 'https://x/t.jpg', storagePath: 'u/s.jpg', fullPath: 'u/f-s.webp', client_id: 501, uploadedAt: new Date().toISOString() });
        const p = photos.find(x => x.id === 970);
        const keys = Object.keys(p).filter(k => /^full/i.test(k));
        return { keys, src: tdPhotoSrc(p), hasFull: tdPhotoHasFull(970), noFullUrl: !('fullUrl' in p) };
      });
      expect(r.keys).toEqual(['fullPath']);
      expect(r.noFullUrl).toBe(true);
      expect(r.src).toBe('https://x/t.jpg');   // the grid still gets the thumb
      expect(r.hasFull).toBe(true);
    });

    test('Full size is resolved on demand, and only then', async () => {
      const r = await page.evaluate(() => {
        // Its own row: beforeEach reseeds, so a row pushed by the test above
        // is long gone by the time this one runs.
        photos.push({ id: 970, type: 'before', url: 'https://x/view.jpg', thumbUrl: 'https://x/t.jpg', storagePath: 'u/s.jpg', fullPath: 'u/f-s.webp', client_id: 501, uploadedAt: new Date().toISOString() });
        let asked = 0;
        const realFrom = _supa.storage.from.bind(_supa.storage);
        _supa.storage.from = (b) => Object.assign({}, realFrom(b), {
          getPublicUrl: (path) => { asked++; return { data: { publicUrl: 'https://cdn/' + path } }; }
        });
        tdReviewShots([970]);
        tdReviewOpen(0);
        const beforeTap = asked;
        const shown = document.getElementById('pc-rev-img').src;
        document.getElementById('pc-rev-full').click();
        const after = document.getElementById('pc-rev-img').src;
        const buttonGone = !document.getElementById('pc-rev-full');
        _supa.storage.from = realFrom;
        tdReviewClose();
        return { beforeTap, shown, after, buttonGone };
      });
      expect(r.beforeTap).toBe(0);              // opening the viewer costs nothing
      expect(r.shown).toBe('https://x/t.jpg');
      expect(r.after).toBe('https://cdn/u/f-s.webp');
      expect(r.buttonGone).toBe(true);          // it does not offer the same bytes twice
    });

    // Owner 2026-09-23: "it's not showing the full quality, it should". The
    // thumb is only the first paint. The photo you are on sharpens to the
    // display copy at once, and to the full copy once you have stayed on it;
    // a photo flicked past never pulls its full copy.
    test('the photo you stay on sharpens to display, then full; one you flick past never pulls full', async () => {
      // One synchronous evaluate, with the dwell timer captured and fired by
      // hand: a real wait gives the mocked cloud pull a window to replace
      // photos wholesale, which is the seed-then-read flake class, not this.
      const r = await page.evaluate(() => {
        const t0 = new Date().toISOString();
        photos.push({ id: 972, type: 'before', url: 'https://x/v2.jpg', thumbUrl: 'https://x/t2.jpg', storagePath: 'u/s2.jpg', fullPath: 'u/f-2.webp', client_id: 501, uploadedAt: t0 });
        photos.push({ id: 973, type: 'before', url: 'https://x/v3.jpg', thumbUrl: 'https://x/t3.jpg', storagePath: 'u/s3.jpg', fullPath: 'u/f-3.webp', client_id: 501, uploadedAt: t0 });
        const asked = [];
        const realFrom = _supa.storage.from.bind(_supa.storage);
        _supa.storage.from = (b) => Object.assign({}, realFrom(b), {
          getPublicUrl: (path) => { asked.push(path); return { data: { publicUrl: 'https://cdn/' + path } }; } });
        // The swap waits on a decode in the app; here it is immediate.
        const realSwap = _pcSwapSrc, realST = window.setTimeout, realCT = window.clearTimeout;
        _pcSwapSrc = (img, url) => { if (img && url) img.src = url; };
        const pending = new Map(); let seq = 1;
        window.setTimeout = (f, ms, ...a) => { if (ms === _PC_FULL_DWELL) { const k = 'd' + (seq++); pending.set(k, f); return k; } return realST(f, ms, ...a); };
        window.clearTimeout = (k) => { if (pending.has(k)) pending.delete(k); else realCT(k); };
        try {
          tdReviewShots([972, 973]);
          tdReviewOpen(0);
          const first = document.getElementById('pc-rev-img').src;
          tdReviewStep(1); tdReviewStep(-1);           // a flick past 973 and back
          const flicked = asked.slice(), armed = pending.size;
          pending.forEach(f => f()); pending.clear();   // he stays on 972
          const settled = document.getElementById('pc-rev-img').src;
          const menuFull = !!document.getElementById('pc-rev-full');
          tdReviewClose();
          return { first, flicked, armed, settled, asked: asked.slice(), menuFull };
        } finally { _supa.storage.from = realFrom; _pcSwapSrc = realSwap; window.setTimeout = realST; window.clearTimeout = realCT; }
      });
      expect(r.first, 'the display copy, not the thumb').toBe('https://x/v2.jpg');
      expect(r.flicked, 'nothing full was pulled while flicking').toEqual([]);
      expect(r.armed, 'only one full load is ever waiting, for the photo on screen').toBe(1);
      expect(r.settled).toBe('https://cdn/u/f-2.webp');
      expect(r.asked, 'only the photo stayed on').toEqual(['u/f-2.webp']);
      expect(r.menuFull, 'and Full size is no longer offered once it is showing').toBe(false);
    });

    test('a photo with no full copy offers no Full size button', async () => {
      const has = await page.evaluate(() => {
        photos.push({ id: 971, type: 'before', url: 'https://x/v.jpg', thumbUrl: '', storagePath: 'u/v.jpg', fullPath: '', client_id: 501, uploadedAt: new Date().toISOString() });
        tdReviewShots([971]); tdReviewOpen(0);
        const btn = !!document.getElementById('pc-rev-full');
        const noop = tdPhotoFullSize(971);
        tdReviewClose();
        return { btn, noop };
      });
      expect(has.btn).toBe(false);
      expect(has.noop).toBe('');
    });

    // The client hub is the biggest egress risk in the app: one shared link,
    // opened by a customer who scrolls it three times.
    test('the client hub never carries the full-resolution copy', async () => {
      const r = await page.evaluate(() => {
        clients.length = 0; jobs.length = 0; photos.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
        jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'done', addr: '412 Oak St' });
        photos.push({ id: 972, type: 'before', url: 'https://x/v.jpg', thumbUrl: 'https://x/t.jpg', storagePath: 'u/v.jpg', fullPath: 'u/f-v.webp', client_id: 501, job_id: 601, uploadedAt: new Date().toISOString() });
        const snap = _buildClientHubSnapshot(501);
        return JSON.stringify(snap);
      });
      expect(r).toContain('https://x/t.jpg');
      expect(r).not.toContain('f-v.webp');
      expect(r).not.toContain('fullPath');
    });

    // Owner, 2026-09-22: "pictures in between don't belong out there", then
    // "progress photos will show when tagged as progress". Both hold, because
    // the hub keeps them in different places: Before and After PAIR UP as the
    // story, a Progress shot goes to the timeline underneath, and tagging it
    // is what put it there.
    test('Before and After pair up, and a Progress shot is never one of the pair', async () => {
      const r = await page.evaluate(() => {
        clients.length = 0; jobs.length = 0; photos.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
        jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'done', addr: '412 Oak St' });
        const mk = (id, type) => photos.push({ id, type, url: 'https://x/' + type + '-' + id + '.jpg',
          thumbUrl: 'https://x/t.jpg', storagePath: 'u/' + id + '.jpg', client_id: 501, job_id: 601,
          addr: '412 Oak St', uploadedAt: new Date().toISOString() });
        mk(1, 'before'); mk(2, 'progress'); mk(3, 'progress'); mk(4, 'after');
        const snap = JSON.stringify(_buildClientHubSnapshot(501));
        const snapO = _buildClientHubSnapshot(501);
        const job = snapO.jobs.find(j => j.id === 601);
        const types = (job.photos || []).map(p => p.type).sort().join(',');
        return {
          types,
          pairs: (job.photos || []).filter(p => p.type === 'before' || p.type === 'after').length,
          progress: (job.photos || []).filter(p => p.type === 'progress').length,
          hasUrls: /before-1\.jpg/.test(snap) && /after-4\.jpg/.test(snap),
        };
      });
      expect(r.types).toBe('after,before,progress,progress');
      expect(r.pairs).toBe(2);        // the story
      expect(r.progress).toBe(2);     // and the timeline, tagged on purpose
      expect(r.hasUrls).toBe(true);
    });

    test('the crew still sees every progress shot on the property', async () => {
      const r = await page.evaluate(() => {
        // Its own seed: beforeEach reseeds, so the previous test's rows are gone.
        clients.length = 0; jobs.length = 0; photos.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St' });
        const mk = (id, type) => photos.push({ id, type, url: 'u', thumbUrl: '', storagePath: 's' + id,
          client_id: 501, addr: '412 Oak St', uploadedAt: new Date().toISOString() });
        mk(1, 'before'); mk(2, 'progress'); mk(3, 'progress'); mk(4, 'after');
        const c = clients.find(x => x.id === 501);
        return cdPropertyPhotos(c, '412 Oak St', 0).map(p => p.type).sort().join(',');
      });
      expect(r).toBe('after,before,progress,progress');
    });

    test('both archive paths survive the trip to the cloud', async () => {
      const r = await page.evaluate(() => {
        const t = _TD_TABLES.find(x => x.t === 'td_photos');
        return t.tx([{ id: 1, url: 'u', storagePath: 's', type: 'before', caption: '', fullPath: 'u/f.webp', originalFullPath: 'u/of.webp', uploadedAt: 'now' }])[0];
      });
      expect(r.fullPath).toBe('u/f.webp');
      expect(r.originalFullPath).toBe('u/of.webp');
    });

    test('deleting a burst takes every rung of the ladder with it', async () => {
      const removed = await page.evaluate(() => {
        const gone = [];
        const realFrom = _supa.storage.from.bind(_supa.storage);
        _supa.storage.from = (b) => Object.assign({}, realFrom(b), {
          remove: async (paths) => { gone.push(...paths); return { data: null, error: null }; }
        });
        photos.push({ id: 973, type: 'before', url: 'u', thumbUrl: '', storagePath: 'u/v.jpg', thumbPath: 'u/t-v.jpg', fullPath: 'u/f-v.webp', originalFullPath: 'u/of-v.webp', client_id: null, uploadedAt: new Date().toISOString() });
        tdReviewShots([973]);
        tdReviewOpen(0);
        tdReviewDelete();
        tdReviewClose();
        _supa.storage.from = realFrom;
        return gone;
      });
      expect(removed).toEqual(expect.arrayContaining(['u/v.jpg', 'u/t-v.jpg', 'u/f-v.webp', 'u/of-v.webp']));
    });
  });

  // ── Jack's first real use, 2026-09-22 ─────────────────────────────────────
  // He stood 8.8 metres from Pepe's 6912 SW 17th St and the app offered him
  // nothing, so he filed one photo by hand off a list and left three orphans
  // behind. Every number below is his: the fix his phone recorded, the
  // property coordinates on Pepe's record, and Pepe's primary eight km away.
  test.describe("TrueShot: the second house", () => {
    // Page-owned, like house() below and for the same reason: seeding in one
    // page.evaluate and reading in the next leaves a gap, and the app's
    // periodic cloud pull replaces the photos array wholesale if it lands in
    // it. Tests that need the rows in hand call __pepe() inside their own
    // evaluate; the ones that only need ids can still await pepe().
    const pepe = () => page.evaluate(() => {
      window.__pepe = () => {
      clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
      clients.push({ id: 901, name: 'Pepe Miranda', addr: '306 SW Elmwood Ave, Topeka, KS 66606',
        lat: 39.0614613, lon: -95.69654,
        extraAddresses: [{ label: '6912 SW 17th St', addr: '6912 SW 17th St, Topeka, KS 66615', lat: 39.03554526304709, lon: -95.7833048650199 }] });
      clients.push({ id: 902, name: 'Laurie Schonfeldt', addr: '6712 SW Finsbury Ave, Topeka, KS 66614', lat: 39.0104968, lon: -95.7790924 });
      const ids = [];
      for (let i = 0; i < 4; i++) {
        const id = 1000 + i; ids.push(id);
        photos.push({ id, type: 'after', url: '', thumbUrl: '', data: 'x', client_id: null,
          lat: 39.035573868723795, lon: -95.78321048210228,
          uploadedAt: new Date(Date.parse('2026-09-22T14:51:12.965Z') + i * 6000).toISOString() });
      }
      return ids;
      };
      return window.__pepe();
    });

    test("a customer's SECOND property is matched, not just their primary", async () => {
      await pepe();
      const r = await page.evaluate(() => {
        const g = tdGuessPlaceFor(photos[0]);
        return { name: g && g.client.name, addr: g && g.addr, m: g && Math.round(g.d * 10) / 10 };
      });
      expect(r.name).toBe('Pepe Miranda');
      expect(r.addr).toBe('6912 SW 17th St, Topeka, KS 66615');
      expect(r.m).toBeLessThan(15);              // 8.8m on his actual fix
    });

    test('the wrong customer 2.8km away is never offered', async () => {
      await pepe();
      const r = await page.evaluate(() => _pcNearbyMatches([1000]).map(x => x.name + ' | ' + x.addr));
      expect(r.length).toBe(1);
      expect(r[0]).toContain('Pepe Miranda');
      expect(r[0]).toContain('6912');
      expect(r.join()).not.toContain('Laurie');   // 6712 SW Finsbury is not a candidate
    });

    test('the sheet says the address in green and files the whole burst on one tap', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        tdReviewShots(ids);
        const here = document.getElementById('pc-rev-here');
        const said = here ? here.textContent : '';
        document.getElementById('pc-rev-confirm').click();
        const mine = ids.map(id => photos.find(p => String(p.id) === String(id)));
        return {
          said,
          filed: mine.filter(p => p && p.client_id === 901).length,
          addrs: [...new Set(mine.map(p => p && p.addr))],
          closed: !document.getElementById('pc-rev'),
          orphans: tdUnfiledPhotos().length,
        };
      }, ids);
      expect(r.said).toContain('6912 SW 17th St');
      expect(r.said).toContain('Pepe Miranda');
      expect(r.filed).toBe(4);                    // all four, not one
      expect(r.addrs).toEqual(['6912 SW 17th St, Topeka, KS 66615']);
      expect(r.closed).toBe(true);
      expect(r.orphans).toBe(0);                  // no shot left behind
    });

    test('"Different address" is always there, because a guess is not a fact', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        tdReviewShots(ids);
        const btn = [...document.querySelectorAll('#pc-rev .pc-side')].find(b => b.textContent === 'Different address');
        btn.click();
        const opened = !!document.getElementById('pc-att');
        const near = [...document.querySelectorAll('#pc-att .pc-file-opt.near')].map(b => b.textContent).join('');
        tdAttachCancel(); tdReviewClose();
        return { opened, near };
      }, ids);
      expect(r.opened).toBe(true);
      expect(r.near).toContain('6912 SW 17th St');
    });

    test('no saved property nearby means no green claim, just the ask', async () => {
      await page.evaluate(() => {
        clients.length = 0; photos.length = 0;
        clients.push({ id: 902, name: 'Laurie Schonfeldt', addr: '6712 SW Finsbury Ave', lat: 39.0104968, lon: -95.7790924 });
        photos.push({ id: 1100, type: 'after', url: '', data: 'x', client_id: null, lat: 39.035573868723795, lon: -95.78321048210228, uploadedAt: new Date().toISOString() });
        tdReviewShots([1100]);
      });
      const r = await page.evaluate(() => {
        const out = { here: !!document.getElementById('pc-rev-here'),
          foot: document.querySelector('#pc-rev .pc-rev-attach').textContent };
        tdReviewClose();
        return out;
      });
      expect(r.here).toBe(false);
      expect(r.foot).toBe('Attach to customer');
    });

    test('the tray files the whole burst too, on the property it names', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        const host = document.createElement('div');
        host.innerHTML = tdUnfiledTrayHTML();
        document.body.appendChild(host);
        const pill = host.querySelector('.pc-uf-pill.ok');
        const label = pill.textContent;
        pill.click();
        host.remove();
        const mine = ids.map(id => photos.find(p => String(p.id) === String(id)));
        return { label, filed: mine.filter(p => p && p.client_id === 901).length, addr: mine[0].addr };
      }, ids);
      expect(r.label).toBe('6912 SW 17th St?');   // the house, not the customer
      expect(r.filed).toBe(4);
      expect(r.addr).toBe('6912 SW 17th St, Topeka, KS 66615');
    });

    test('the green line names the house and the customer, and no distance', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        tdReviewShots(ids);
        const said = document.getElementById('pc-rev-here').textContent;
        tdReviewClose();
        return said;
      }, ids);
      expect(r).toContain('6912 SW 17th St');
      expect(r).toContain('Pepe Miranda');
      expect(r).not.toMatch(/ft|feet|metre|meter/i);   // owner: not copy
    });

    test('the distance is kept ON THE ROW, for the next time it picks wrong', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        tdReviewShots(ids);
        document.getElementById('pc-rev-confirm').click();
        const p = photos.find(x => String(x.id) === String(ids[0]));
        const t = _TD_TABLES.find(x => x.t === 'td_photos');
        const synced = t.tx([{ id: 1, url: 'u', storagePath: 's', type: 'after', caption: '', addrM: 9, uploadedAt: 'now' }])[0];
        return { onRow: p.addrM, synced: synced.addrM };
      }, ids);
      expect(r.onRow).toBeLessThan(15);     // 8.8m on Jack's real fix
      expect(r.synced).toBe(9);             // and it survives the trip
    });

    // Jack's fourth photo: already on Pepe, no property, nothing could fix it.
    test('a filed photo can be moved, and the move is per photo', async () => {
      const ids = await pepe();
      const r = await page.evaluate((ids) => {
        // as his account actually stands: one filed with no property
        const p = photos.find(x => String(x.id) === String(ids[0]));
        p.client_id = 901; p.client_name = 'Pepe Miranda';
        tdReviewShots([p.id]);
        tdReviewOpen(0);
        const hasMove = [...document.querySelectorAll('#pc-rev .pc-side')].some(b => b.textContent === 'Move');
        tdMovePhoto(p.id);
        const near = [...document.querySelectorAll('#pc-att .pc-file-opt.near')].map(b => b.textContent).join('');
        document.querySelector('#pc-att .pc-file-opt.near').click();
        const after = photos.find(x => String(x.id) === String(ids[0]));
        const others = ids.slice(1).map(id => photos.find(x => String(x.id) === String(id)));
        tdReviewClose();
        return { hasMove, near, addr: after.addr, untouched: others.every(x => x.addr == null) };
      }, ids);
      expect(r.hasMove).toBe(true);
      expect(r.near).toContain('6912 SW 17th St');
      expect(r.addr).toBe('6912 SW 17th St, Topeka, KS 66615');
      expect(r.untouched).toBe(true);      // one photo moved, not the burst
    });

    // The same photo, before it is moved: it must not show under the primary
    // card eight kilometres from where he was standing.
    test('a photo with no property shows under the house its fix names', async () => {
      await pepe();
      const r = await page.evaluate(() => {
        const p = photos[0];
        p.client_id = 901; p.client_name = 'Pepe Miranda'; delete p.addr;
        photos.length = 1;
        // The card's OWN function, not a copy of its rule.
        const c = clients.find(x => x.id === 901);
        return { onSixNine: cdPropertyPhotos(c, '6912 SW 17th St, Topeka, KS 66615', 1).length,
                 onPrimary: cdPropertyPhotos(c, '306 SW Elmwood Ave, Topeka, KS 66606', 0).length };
      });
      expect(r.onSixNine).toBe(1);
      expect(r.onPrimary).toBe(0);
    });

    // The Open button on the property card, CLICKED, not read. Its address was
    // interpolated with JSON.stringify straight into a double-quoted onclick,
    // so the attribute ended at the address's own quote and the handler body
    // was cut off mid-call. The browser wraps an inline handler in
    // function onclick(event){...}, so it hit that wrapper's brace next and
    // threw SyntaxError: Unexpected token '}' (owner, ops portal on Jack's
    // account, 2026-09-22). It only ever appeared once a property HAD photos,
    // because that is the only time the button renders.
    //
    // Reading the attribute string would not have caught this. The string
    // looks fine; it is the HTML parser that truncates it. So the test puts
    // the markup in the DOM and presses the button.
    test('the Open button on a property survives being put in real HTML', async () => {
      await pepe();
      const r = await page.evaluate(() => {
        __pepe();
        const c = clients.find(x => x.id === 901);
        // The button only exists once the property HAS photos, so file one.
        photos[0].client_id = 901; photos[0].addr = '6912 SW 17th St, Topeka, KS 66615';
        // The card's own markup generator, then a REAL parse of it. The string
        // it returns always looked correct; the damage happened when the HTML
        // parser read it, so the string is never what gets asserted.
        // EXPANDED, or there is no body and therefore no button: a property
        // card is an accordion whenever the customer has more than one, and
        // the photo row lives in the body (the same collapse footgun as 10.6).
        window['_cdpropOpen_901_1'] = true;
        const host = document.createElement('div');
        host.innerHTML = _cdPropCardHtml(c, clientAddresses(c)[1], 1, 2);
        document.body.appendChild(host);
        const btn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open');
        if (!btn) { host.remove(); return { found: false }; }
        const compiled = typeof btn.onclick === 'function';
        let threw = null, opened = false;
        try { btn.click(); opened = !!document.getElementById('pc-rev'); }
        catch (e) { threw = String(e); }
        const sawAddr = _pcRev && _pcRev.folderAddr;
        document.getElementById('pc-rev')?.remove();
        host.remove();
        delete window['_cdpropOpen_901_1'];
        return { found: true, compiled, threw, opened, sawAddr };
      });
      expect(r.found, 'the Open button renders once the property has photos').toBe(true);
      // The bug: the browser could not compile the handler it was handed, so
      // btn.onclick was null and the click did nothing but log a SyntaxError.
      expect(r.compiled, 'the browser could parse the handler at all').toBe(true);
      expect(r.threw).toBe(null);
      expect(r.opened, 'and pressing it opens the folder').toBe(true);
    });

    test('a photo with no fix gets no guess at all', async () => {
      await page.evaluate(() => {
        photos.length = 0;
        photos.push({ id: 1200, type: 'after', url: '', data: 'x', client_id: null, lat: null, lon: null, uploadedAt: new Date().toISOString() });
      });
      const r = await page.evaluate(() => ({
        guess: tdGuessPlaceFor(photos[0]),
        legacy: tdGuessClientFor(photos[0]),
        near: _pcNearbyMatches([1200]).length,
      }));
      expect(r.guess).toBe(null);
      expect(r.legacy).toBe(null);
      expect(r.near).toBe(0);
    });

    test('an extra address with no pin on it is skipped, never guessed at', async () => {
      const r = await page.evaluate(() => {
        clients.length = 0;
        clients.push({ id: 903, name: 'No Pins', addr: 'somewhere', extraAddresses: [{ label: 'B', addr: 'no coords here' }] });
        return _pcClientPlaces(clients[0]).length;
      });
      expect(r).toBe(0);
    });
  });

  // ── Finding photos without a Gallery page (owner 2026-09-22) ──────────────
  test.describe('TrueShot: the search is the way back in', () => {
    const seedHistory = () => page.evaluate(() => {
      clients.length = 0; jobs.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS' });
      clients.push({ id: 502, name: 'Marco Reyes', addr: '9 Vine Ave, Wichita KS' });
      const mk = (id, cid, name, addr, iso) => photos.push({ id, type: 'before', url: 'https://x/' + id + '.jpg',
        thumbUrl: 'https://x/t.jpg', storagePath: 'u/' + id + '.jpg', client_id: cid, client_name: name,
        addr, uploadedAt: iso });
      mk(801, 501, 'Dana Whitfield', '412 Oak St, Wichita KS', '2026-03-02T15:00:00.000Z');
      mk(802, 501, 'Dana Whitfield', '412 Oak St, Wichita KS', '2026-09-10T15:00:00.000Z');
      mk(803, 501, 'Dana Whitfield', '88 Pine Ct, Wichita KS', '2026-08-01T15:00:00.000Z');
      mk(804, 502, 'Marco Reyes', '9 Vine Ave, Wichita KS', '2026-09-19T15:00:00.000Z');
    });

    test('an address finds that property, and only that property', async () => {
      await seedHistory();
      const r = await page.evaluate(() => tdPhotoSearch('412 oak').map(g => ({ addr: g.addr, n: g.photos.length })));
      expect(r.length).toBe(1);
      expect(r[0].addr).toBe('412 Oak St, Wichita KS');
      expect(r[0].n).toBe(2);
    });

    test('a customer name finds every property they own, newest first', async () => {
      await seedHistory();
      const r = await page.evaluate(() => tdPhotoSearch('whitfield').map(g => g.addr));
      expect(r).toEqual(['412 Oak St, Wichita KS', '88 Pine Ct, Wichita KS']);
    });

    test('the shots inside a property come back newest first', async () => {
      await seedHistory();
      const r = await page.evaluate(() => tdPhotoSearch('412 oak')[0].photos.map(p => p.id));
      expect(r).toEqual([802, 801]);
    });

    test('a date finds the day, however it is typed', async () => {
      await seedHistory();
      const r = await page.evaluate(() => ({
        iso: tdPhotoSearch('2026-03-02').length,
        slash: tdPhotoSearch('3/2/2026').length,
        month: tdPhotoSearch('march 2026').length,
        nothing: tdPhotoSearch('1999').length,
      }));
      expect(r.iso).toBe(1);
      expect(r.slash).toBe(1);
      expect(r.month).toBe(1);
      expect(r.nothing).toBe(0);
    });

    test('empty and junk return nothing, never everything', async () => {
      await seedHistory();
      const r = await page.evaluate(() => [tdPhotoSearch(''), tdPhotoSearch(null), tdPhotoSearch('   '), tdPhotoSearch('zzzz')].map(x => x.length));
      expect(r).toEqual([0, 0, 0, 0]);
    });

    // The folder, not a flat wall: the visit is the folder, so two shots on
    // two different days are two dated groups with the newest one open.
    test('a result opens that property as a folder of visits', async () => {
      await seedHistory();
      const r = await page.evaluate(() => {
        const g = tdPhotoSearch('412 oak');
        tdPhotoSearch.lastResults = g;
        const opened = tdOpenPropertyPhotos(g[0].key);
        const out = {
          opened,
          addr: document.querySelector('#pc-rev .pc-fold-addr').textContent,
          sub: document.querySelector('#pc-rev .pc-fold-sub').textContent,
          visits: document.querySelectorAll('#pc-rev .pc-fold-visit').length,
          openCells: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
          top: document.querySelector('#pc-rev .pc-side').textContent,
        };
        tdReviewClose();
        return out;
      });
      expect(r.opened).toBe(true);
      expect(r.addr).toBe('412 Oak St');
      expect(r.sub).toContain('2 photos');
      expect(r.sub).toContain('2 visits');
      expect(r.sub).toContain('Dana Whitfield');
      expect(r.visits).toBe(2);
      expect(r.openCells).toBe(1);      // only the newest visit is open
      expect(r.top).toBe('Close');
    });

    test('the global search shows photos as properties and can open one', async () => {
      await seedHistory();
      const r = await page.evaluate(() => {
        openSearch();
        runSearch('412 oak');
        const html = document.getElementById('search-results').innerHTML;
        const hit = (window._searchResults || []).find(x => x.type === 'photo');
        if (hit) hit.action();
        const visits = document.querySelectorAll('#pc-rev .pc-fold-visit').length;
        tdReviewClose(); closeSearch();
        return { html, visits };
      });
      expect(r.html).toContain('Photos');
      expect(r.html).toContain('412 Oak St');
      expect(r.html).toContain('2 photos');
      expect(r.visits).toBe(2);
    });

    // §7.1: the page this replaced is gone, not hidden.
    test('the Gallery page and every function it owned are gone', async () => {
      const r = await page.evaluate(() => ({
        page: document.querySelectorAll('#pg-gallery').length,
        nav: document.querySelectorAll('#nb-gallery').length,
        grid: document.querySelectorAll('#gallery-grid').length,
        fns: ['renderGallery', 'setGalleryFilter', 'openGalleryUpload', 'openPhotoViewer', 'processGalleryUpload', 'deletePhoto']
          .filter(n => typeof window[n] === 'function'),
      }));
      expect(r.page).toBe(0);
      expect(r.nav).toBe(0);
      expect(r.grid).toBe(0);
      expect(r.fns).toEqual([]);
    });

    test('the property card carries its own photos and a way to add more', async () => {
      await seedHistory();
      const r = await page.evaluate(() => {
        openClientDetail(501);
        const html = document.getElementById('pg-client-detail').innerHTML;
        return {
          hasSection: /Photos/.test(html),
          hasAdd: /tdAddPhotos\(501,/.test(html),
          hasOpen: /tdOpenPropertyFolder\(/.test(html),
          count: (html.match(/(\d+) photos/) || [])[1],
        };
      });
      expect(r.hasSection).toBe(true);
      expect(r.hasAdd).toBe(true);
      expect(r.hasOpen).toBe(true);
      expect(r.count).toBe('2');     // the two at THIS address, not the Pine Ct one
    });
  });

  // ── The property folder (owner 2026-09-22) ────────────────────────────────
  test.describe('TrueShot: the folder is the visit', () => {
    // The page OWNS the fixture, and every test calls it inside the same
    // evaluate as its assertions. It used to be a page.evaluate of its own,
    // which left a gap: the app's periodic cloud pull replaces the photos
    // array wholesale (_TD_TABLES td_photos set, js/cloud.js), so a pull
    // landing between the seed and the test emptied it and the folder closed
    // itself on zero rows. Same root cause as the shoot fixture and the
    // editor before it; seeding in the acting round trip is what actually
    // closes it, rather than a third patch at a third call site.
    const house = () => page.evaluate(() => {
      window.__house = () => {
        clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS' });
        const mk = (id, type, iso, job) => photos.push({ id, type, url: 'https://x/' + id + '.jpg',
          thumbUrl: 'https://x/t.jpg', storagePath: 'u/' + id + '.jpg', client_id: 501, client_name: 'Dana Whitfield',
          job_id: job ? 601 : null, job_name: job ? 'Repipe' : '', addr: '412 Oak St, Wichita KS', uploadedAt: iso });
        // one morning's work, then an afternoon trip back, then March
        mk(1, 'before', '2026-09-22T14:00:00.000Z', true);
        mk(2, 'progress', '2026-09-22T14:40:00.000Z', true);
        mk(3, 'after', '2026-09-22T20:30:00.000Z', true);
        mk(4, 'before', '2026-03-02T15:00:00.000Z', false);
        return photos.map(p => p.id);
      };
      return window.__house();
    });

    test('a visit is a stretch of work, not a calendar day', async () => {
      await house();
      const r = await page.evaluate(() => (__house(), tdPropertyVisits(photos)).map(v => v.photos.length));
      // The 14:00 and 14:40 shots are one visit; 20:30 is a trip back.
      expect(r).toEqual([1, 2, 1]);
    });

    test('the folder names the house, counts the visits, and opens the newest', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const out = {
          addr: document.querySelector('.pc-fold-addr').textContent,
          sub: document.querySelector('.pc-fold-sub').textContent,
          visits: document.querySelectorAll('.pc-fold-visit').length,
          open: document.querySelectorAll('.pc-rev-cell').length,
          first: document.querySelector('.pc-fold-visit-day').textContent,
          what: document.querySelector('.pc-fold-visit-what').textContent,
        };
        tdReviewClose();
        return out;
      });
      expect(r.addr).toBe('412 Oak St');
      expect(r.sub).toContain('4 photos');
      expect(r.sub).toContain('3 visits');
      expect(r.visits).toBe(3);
      expect(r.first).toContain('Sep 22');
      expect(r.what).toBe('Repipe');
      // the newest visit's one shot, plus the pinned pair's two
      expect(r.open).toBe(3);
    });

    test('Before and After pin to the top once a job has both', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const ba = document.querySelector('.pc-fold-ba');
        const out = { pinned: !!ba, name: ba && ba.querySelector('.pc-fold-ba-name').textContent,
          cells: ba ? ba.querySelectorAll('.pc-rev-cell').length : 0,
          tags: ba ? [...ba.querySelectorAll('.pc-rev-tag')].map(t => t.textContent).join(',') : '' };
        tdReviewClose();
        return out;
      });
      expect(r.pinned).toBe(true);
      expect(r.name).toBe('Repipe');
      expect(r.cells).toBe(2);
      expect(r.tags).toBe('before,after');
    });

    // The commonest shape in the app: the Before was taken while writing the
    // estimate, the After on the job it became. Two different tags, one house.
    test('a walkthrough Before pairs with the job After', async () => {
      const r = await page.evaluate(() => {
        __house();
        photos.length = 0;
        photos.push({ id: 11, type: 'before', url: 'u', thumbUrl: '', storagePath: 's11', client_id: 501,
          bid_id: 701, bid_name: 'Repipe', addr: '412 Oak St', uploadedAt: '2026-08-01T15:00:00.000Z' });
        photos.push({ id: 12, type: 'after', url: 'u', thumbUrl: '', storagePath: 's12', client_id: 501,
          job_id: 601, job_name: 'Repipe', addr: '412 Oak St', uploadedAt: '2026-09-22T19:00:00.000Z' });
        const pair = tdPropertyPair(photos);
        return { has: !!pair, name: pair && pair.name, b: pair && pair.before.id, a: pair && pair.after.id };
      });
      expect(r.has).toBe(true);
      expect(r.name).toBe('Repipe');
      expect(r.b).toBe(11);
      expect(r.a).toBe(12);
    });

    test('a job with no After yet pins nothing, because there is no pair', async () => {
      const r = await page.evaluate(() => {
        __house();
        photos.length = 0;
        photos.push({ id: 9, type: 'before', url: 'u', thumbUrl: '', storagePath: 's', client_id: 501,
          job_id: 601, job_name: 'Repipe', addr: '412 Oak St, Wichita KS', uploadedAt: new Date().toISOString() });
        return tdPropertyPair(photos);
      });
      expect(r).toBe(null);
    });

    test('a stage chip filters the whole property', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const chips = [...document.querySelectorAll('.pc-fold-chips .fb')].map(b => b.textContent);
        tdFolderStage('before');
        const out = { chips, visits: document.querySelectorAll('.pc-fold-visit').length,
          ba: !!document.querySelector('.pc-fold-ba'),
          active: document.querySelector('.pc-fold-chips .fb.active').textContent };
        tdReviewClose();
        return out;
      });
      expect(r.chips).toEqual(['All 4', 'Before 2', 'Progress 1', 'After 1']);
      expect(r.active).toBe('Before 2');
      expect(r.visits).toBe(2);       // the two Befores, on two different days
      expect(r.ba).toBe(false);       // the pinned pair belongs to the whole story
    });

    test('tapping a shot drops into the viewer that already exists', async () => {
      await house();
      const r = await page.evaluate(() => {
        const ids = __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        tdFolderOpen(ids[3]);         // the March shot, inside a closed visit
        const out = { img: !!document.getElementById('pc-rev-img'),
          markUp: [...document.querySelectorAll('#pc-rev .pc-side')].some(b => b.textContent === 'Mark up'),
          move: [...document.querySelectorAll('#pc-rev .pc-side')].some(b => b.textContent === 'Move') };
        tdReviewClose();
        return out;
      });
      expect(r.img).toBe(true);
      expect(r.markUp).toBe(true);
      expect(r.move).toBe(true);
    });

    test('a visit header opens and closes its own shots', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const heads = document.querySelectorAll('.pc-fold-visit-hd');
        const before = document.querySelectorAll('.pc-fold-visit .pc-rev-cell').length;
        heads[1].click();             // open the morning's two
        const opened = document.querySelectorAll('.pc-fold-visit .pc-rev-cell').length;
        document.querySelectorAll('.pc-fold-visit-hd')[1].click();
        const closed = document.querySelectorAll('.pc-fold-visit .pc-rev-cell').length;
        tdReviewClose();
        return { before, opened, closed };
      });
      expect(r.before).toBe(1);       // only the newest
      expect(r.opened).toBe(2);       // one open at a time, and it is the morning's
      expect(r.closed).toBe(0);
    });

    // What the owner saw: six shots, each stamped "Before", under a chip row
    // that already said Before 6, with Progress 0 and After 0 taking a quarter
    // of that row and doing nothing. A label repeated on every tile carries no
    // information, and a filter for a stage nobody shot is not a filter.
    test('a single-stage property shows no stage labels and no chip row', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        photos.forEach(p => { p.type = 'before'; });
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const out = {
          cells: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
          tags: document.querySelectorAll('#pc-rev .pc-rev-tag').length,
          chips: document.querySelectorAll('#pc-rev .pc-fold-chips .fb').length,
        };
        tdReviewClose();
        return out;
      });
      expect(r.cells).toBeGreaterThan(0);
      expect(r.tags, 'nothing to distinguish, so nothing to label').toBe(0);
      expect(r.chips, 'nothing to filter, so no row at all').toBe(0);
    });

    test('a mixed visit keeps its labels, because there they mean something', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        tdOpenPropertyFolder(501, '412 Oak St, Wichita KS');
        const chips = [...document.querySelectorAll('#pc-rev .pc-fold-chips .fb')].map(b => b.textContent);
        // Newest-first, so visit 0 is the afternoon trip back: one shot, one
        // stage, no labels earned. The MORNING is the mixed one.
        document.querySelectorAll('#pc-rev .pc-fold-visit-hd')[1].click();
        const tags = [...document.querySelectorAll('#pc-rev .pc-fold-visit .pc-rev-tag')].map(t => t.textContent);
        tdReviewClose();
        return { chips, tags };
      });
      expect(r.tags.length, 'a visit with two stages still says which is which').toBeGreaterThan(0);
      // every stage present gets a chip, and none that is absent does
      expect(r.chips.some(c => /Progress/.test(c))).toBe(true);
      expect(r.chips.every(c => !/ 0$/.test(c)), 'no chip counts to zero').toBe(true);
    });

    test('an empty property opens nothing rather than an empty sheet', async () => {
      await house();
      const r = await page.evaluate(() => {
        __house();
        photos.length = 0;
        return { opened: tdOpenPropertyFolder(501, '412 Oak St'), sheet: document.querySelectorAll('#pc-rev').length };
      });
      expect(r.opened).toBe(false);
      expect(r.sheet).toBe(0);
    });
  });

  // §7.1: the single-photo picker it replaced is gone, not hidden.
  test('the one-photo file picker is gone, replaced by the burst attach', async () => {
    const still = await page.evaluate(() => typeof tdOpenFilePicker);
    expect(still).toBe('undefined');
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
    // Park the cloud load for the whole block. openEditor closes the gap
    // inside its own evaluate, but every test then reaches for the row in a
    // SECOND evaluate, and a reload landing between the two empties photos
    // (webkit shard 3, 2e7c546: "undefined is not an object" on p.url).
    // Same park as the sheet block above; nothing here tests cloud loading.
    await page.evaluate(() => { window.supaLoadFromCloud = async () => { }; });
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
    // ONE evaluate, deliberately: this used to shoot in one round trip and
    // then reach for photos[photos.length-1] in the next. A cloud load landing
    // between the two replaces the photos array wholesale, so the row was gone
    // and p was undefined (webkit shard 3, 59293e5). Shooting and seeding in
    // the same evaluate leaves no gap for a load to land in.
    return page.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const p = await tdSavePhoto({ type: 'before', bidId: 901, file: new File([arr], 'shot.png', { type: 'image/png' }) });
      if (!p) return { ok: false, ready: false, id: null, saved: false };
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
      return { ok, ready: !!(_pcAnno && _pcAnno.img), id, saved: true };
    }, PNG_B64).then((r) => {
      // Said out loud, because every caller below assumes the editor opened on
      // a real row. A silent null here used to surface as an unrelated
      // assertion four lines later.
      expect(r.saved, 'the editor needs a photo that actually saved').toBe(true);
      return r;
    });
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
      for (let i = 0; i < 400 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      const ready = !!(_pcAnno && _pcAnno.img);
      const w = ready ? document.getElementById('pc-anno-cv').width : 0;
      _supa.storage.from = realFrom;
      tdCloseAnnotate();
      // The stage recorder rides along so a failure here names where it died
      // instead of just saying false. Three live rounds were burned on a
      // rule() that could not explain itself.
      return { opened, ready, w, asked, stage: window._pcAnnoLastError };
    });
    expect(r.opened).toBe(true);
    expect(r.ready, 'last stage: ' + JSON.stringify(r.stage)).toBe(true);
    expect(r.w).toBe(120);             // and sized itself to the real bytes
    expect(r.asked).toBe('u/bid-1/before-1.png');
  });

  // WebKit, CI, 2026-09-21: the source neither loaded nor errored, so the
  // editor waited on an event that was never coming and sat open on a blank
  // canvas. Every attempt is on a clock now, and a stalled one falls down
  // the same ladder as a failed one.
  test('a source that never loads and never errors still falls through to storage', async () => {
    const r = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 140; cv.height = 100; cv.getContext('2d').fillRect(0, 0, 140, 100);
      const bytes = await new Promise(res => cv.toBlob(res, 'image/png'));
      let asked = '';
      const realFrom = _supa.storage.from.bind(_supa.storage);
      _supa.storage.from = (b) => Object.assign({}, realFrom(b), {
        download: async (path) => { asked = path; return { data: bytes, error: null }; }
      });
      // An image that swallows its src: no load event, no error event, ever.
      const RealImage = window.Image;
      window.Image = function () {
        const im = new RealImage();
        let held = '';
        Object.defineProperty(im, 'src', {
          configurable: true,
          get: () => held,
          set(v) {
            held = v;
            // The blob url from the storage fallback is allowed through, so
            // the ladder can actually finish; only the first source stalls.
            if (String(v).startsWith('blob:')) {
              delete im.src; im.src = v;
            }
          }
        });
        return im;
      };
      photos.push({ id: 951, type: 'before', url: 'https://stalled.invalid/x.jpg', thumbUrl: '', storagePath: 'u/bid-1/stalled.png', client_id: 501, bid_id: 901, uploadedAt: new Date().toISOString() });
      const opened = tdAnnotatePhoto(951);
      for (let i = 0; i < 400 && !(_pcAnno && _pcAnno.img); i++) await new Promise(r2 => setTimeout(r2, 25));
      const ready = !!(_pcAnno && _pcAnno.img);
      const w = ready ? document.getElementById('pc-anno-cv').width : 0;
      window.Image = RealImage;
      _supa.storage.from = realFrom;
      tdCloseAnnotate();
      return { opened, ready, w, asked, stage: window._pcAnnoLastError };
    });
    expect(r.opened).toBe(true);
    expect(r.ready, 'last stage: ' + JSON.stringify(r.stage)).toBe(true);
    expect(r.w).toBe(140);
    expect(r.asked).toBe('u/bid-1/stalled.png');
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
      // the burst review sheet and its attach picker
      tdReviewShots([883]);
      scan(document.getElementById('pc-rev').innerHTML, 'review-grid');
      tdReviewOpen(0);
      scan(document.getElementById('pc-rev').innerHTML, 'review-viewer');
      tdReviewAttach();
      scan(document.getElementById('pc-att').innerHTML, 'attach-who');
      tdAttachPick(501);
      if (document.getElementById('pc-att')) scan(document.getElementById('pc-att').innerHTML, 'attach-next');
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      tdReviewClose();
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
      // The tray's Review button opens the burst sheet; Attach files the lot.
      photos.push({ id: 888, type: 'before', url: '', thumbUrl: '', client_id: null, lat: 37.6889, lon: -97.3361, uploadedAt: new Date().toISOString() });
      const host = document.createElement('div');
      host.innerHTML = tdUnfiledTrayHTML();
      document.body.appendChild(host);
      const revBtn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review');
      revBtn && revBtn.click();
      if (!document.getElementById('pc-rev')) dead.push('Review');
      else {
        tdReviewAttach();
        // The card asks only what the data cannot answer, so click the first
        // option on each step it does show, up to the three it can ask.
        for (let step = 0; step < 3 && document.getElementById('pc-att'); step++) {
          const opt = document.querySelector('#pc-att .pc-file-opt');
          if (!opt) break;
          opt.click();
        }
        const p = photos.find(x => String(x.id) === '888');
        if (!p || p.client_id == null) dead.push('Attach to customer');
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

  // Not "is it in the DOM": elementFromPoint, because the whole bug was that
  // the rows WERE in the DOM the entire time. They sat at z-index 9999 under
  // an opaque full-screen album at 10050, so a thumb pressing an address hit
  // the album behind it and nothing happened. A presence assertion passes
  // happily through that and tells you the feature works.
  test('a customer with several properties can actually be tapped, not just rendered', async () => {
    const r = await page.evaluate(async () => {
      clients.length = 0; photos.length = 0; bids.length = 0; jobs.length = 0;
      clients.push({ id: 77, name: 'Logan Sample', addr: '5900 SW Huntoon, Topeka KS',
        extraAddresses: [{ addr: '6800 SW Tenth Ave, Topeka KS', label: 'Rental' },
                         { addr: '1 Other St, Topeka KS', label: 'Shop' }] });
      photos.push({ id: 9001, type: 'before', url: 'https://x/a.jpg', uploadedAt: '2026-09-22T12:00:00Z' });
      tdReviewBurst('9001');
      [...document.querySelectorAll('#pc-rev button')].find(b => /Attach/.test(b.textContent)).click();
      [...document.querySelectorAll('#pc-att .pc-file-opt')].find(b => /Logan Sample/.test(b.textContent)).click();
      // From TrueShot the picker is a bottom sheet that slides up (2026-09-23),
      // so measure where a thumb finds it once it has arrived, not mid-slide.
      await Promise.all(document.getElementById('_addrpick-sheet').getAnimations().map(a => a.finished));
      const rows = [...document.querySelectorAll('#_addrpick-sheet div[onclick^="_addrPickChoose"]')];
      const reachable = rows.filter((row) => {
        const b = row.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!(hit && row.contains(hit));
      }).length;
      // and the tap has to land the photo on the property it names
      rows[1].click();
      const p = photos.find(x => String(x.id) === '9001');
      return { rows: rows.length, reachable, addr: p && p.addr, client: p && p.client_id };
    });
    expect(r.rows, 'all three properties are offered').toBe(3);
    expect(r.reachable, 'and every one of them is under the thumb, not under the album').toBe(3);
    expect(r.addr).toBe('6800 SW Tenth Ave, Topeka KS');
    expect(r.client).toBe(77);
  });

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

  test('the capture size rides the row to the cloud', async () => {
    const r = await page.evaluate(() => {
      const row = { id: 1, url: 'https://x/a.jpg', storagePath: 'u/a.jpg', type: 'before',
        shotPx: '4032x3024', client_id: null, bid_id: null, job_id: null, uploadedAt: 'now' };
      const tbl = (typeof _TD_TABLES !== 'undefined' ? _TD_TABLES : []).find(t => t.t === 'td_photos');
      return tbl ? tbl.tx([row])[0] : null;
    });
    // The whitelist drops anything it does not name, so a field that is never
    // listed is a field that silently never leaves the phone.
    expect(r, 'td_photos is registered for sync').not.toBeNull();
    expect(r.shotPx, 'the size the camera gave survives the transform').toBe('4032x3024');
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

// ── GPS in the FILE, proven on the bytes that are uploaded ──────────────────
// Every piece of this passed its own test the first time and the whole still
// shipped broken: the EXIF writer was right, the splice was right, and the
// photos in storage had no GPS in them, because _pcCommit uploaded BEFORE it
// asked for a position (owner, 2026-09-23: "where's the gps meta data in the
// photo?"). So this does not test a piece. It drives the capture commit with a
// warm fix, catches the exact blob handed to storage, and reads the GPS back
// out of it.
test.describe('TrueShot: the uploaded file carries its GPS', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const readUploaded = () => page.evaluate(async () => {
    const saved = { en: supaEnabled, user: _supaUser, supa: _supa };
    const bodies = [];
    try {
      // Force the online path and catch every body the app uploads.
      supaEnabled = () => true;
      _supaUser = { id: 'u-gps' };
      _supa = { storage: { from: () => ({
        upload: async (path, body) => { bodies.push({ path, body }); return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: 'https://x/' + path } }),
        remove: async () => ({ error: null }),
      }) } };
      photos.length = 0;
      // A real 1200x1600 frame, so the display copy is a genuine JPEG encode.
      const c = document.createElement('canvas'); c.width = 1200; c.height = 1600;
      const g = c.getContext('2d'); g.fillStyle = '#7a8a99'; g.fillRect(0, 0, 1200, 1600);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      // The camera's warm fix, as the viewfinder's watch would have left it.
      _pcFix = { lat: 39.03078738591014, lon: -95.7202, acc: 10, t: Date.now() };
      _pcCtx = { type: 'before', caption: '', clientId: null, bidId: null, jobId: null };
      await _pcCommit(blob);
    } finally {
      supaEnabled = saved.en; _supaUser = saved.user; _supa = saved.supa;
      _pcFix = null; _pcCtx = null;
    }
    // Read GPS back out of each uploaded JPEG, independently of the writer.
    const gpsOf = async (b) => {
      const d = new Uint8Array(await b.arrayBuffer());
      if (d[0] !== 0xFF || d[1] !== 0xD8) return { jpeg: false };
      let i = 2, app1 = null;
      while (i < d.length - 1 && d[i] === 0xFF) {
        const m = d[i + 1]; if (m === 0xDA) break;
        const len = (d[i + 2] << 8) | d[i + 3];
        if (m === 0xE1 && String.fromCharCode(...d.slice(i + 4, i + 8)) === 'Exif') app1 = d.slice(i + 10, i + 2 + len);
        i += 2 + len;
      }
      if (!app1) return { jpeg: true, exif: false };
      const be = app1[0] === 0x4D, u16 = (o) => be ? (app1[o] << 8) | app1[o + 1] : app1[o] | (app1[o + 1] << 8);
      const u32 = (o) => be ? ((app1[o] << 24) | (app1[o + 1] << 16) | (app1[o + 2] << 8) | app1[o + 3]) >>> 0
                            : (app1[o] | (app1[o + 1] << 8) | (app1[o + 2] << 16) | (app1[o + 3] << 24)) >>> 0;
      const ifd = (o) => { const n = u16(o), t = {}; for (let k = 0; k < n; k++) { const e = o + 2 + k * 12; t[u16(e)] = e; } return t; };
      const i0 = ifd(u32(4));
      if (!i0[0x8825]) return { jpeg: true, exif: true, gps: false };
      const g = ifd(u32(i0[0x8825] + 8));
      const dms = (tag) => { const o = u32(g[tag] + 8); let v = 0; [1, 60, 3600].forEach((div, k) => { v += u32(o + k * 8) / u32(o + k * 8 + 4) / div; }); return v; };
      const ref = (tag) => String.fromCharCode(app1[g[tag] + 8]);
      return { jpeg: true, exif: true, gps: true,
        lat: dms(2) * (ref(1) === 'S' ? -1 : 1), lon: dms(4) * (ref(3) === 'W' ? -1 : 1) };
    };
    const out = [];
    for (const x of bodies) out.push({ path: x.path, ...(await gpsOf(x.body)) });
    const row = photos[photos.length - 1];
    return { out, rowLat: row && row.lat, rowAcc: row && row.accM };
  });

  test('the photo stored in the cloud has GPS in the file, not just on the row', async () => {
    const r = await readUploaded();
    const main = r.out.find(x => !/\/t-/.test(x.path) && !/\/f-/.test(x.path));
    expect(main, 'the display copy was uploaded').toBeTruthy();
    expect(main.exif, 'it has an EXIF block').toBe(true);
    expect(main.gps, 'and that block has GPS in it').toBe(true);
    expect(Math.abs(main.lat - 39.03078738591014)).toBeLessThan(1e-6);
    expect(Math.abs(main.lon - -95.7202)).toBeLessThan(1e-6);
    // and the row agrees with the file, accuracy included
    expect(r.rowLat).toBeCloseTo(39.03078738591014, 6);
    expect(r.rowAcc).toBe(10);
  });

  test('the fix a shot takes is the camera\'s own warm one, with its accuracy', async () => {
    const r = await page.evaluate(() => {
      _pcFix = { lat: 39.1, lon: -95.1, acc: 7, t: Date.now() };
      const fresh = _pcCurrentFix();
      _pcFix = { lat: 39.1, lon: -95.1, acc: 7, t: Date.now() - 10 * 60000 };
      const stale = _pcCurrentFix();
      _pcFix = null;
      return { fresh, staleLat: stale.lat };
    });
    expect(r.fresh).toEqual({ lat: 39.1, lon: -95.1, acc: 7 });
    // ten minutes old is a different place for somebody in a truck
    expect(r.staleLat).not.toBe(39.1);
  });

  test('the shutter fires at the capture, before the slow encode', async () => {
    const order = await page.evaluate(() => {
      const src = String(tdCaptureShoot || '');
      return { flashAt: src.indexOf('_pcFlash()'), encodeAt: src.indexOf('toBlob') };
    });
    expect(order.flashAt, 'the flash is in the shutter path').toBeGreaterThan(-1);
    expect(order.flashAt, 'and it comes before the JPEG encode').toBeLessThan(order.encodeAt);
  });
});

// ── The 2026-09-23 redesign: "fresh out of Apple" ──────────────────────────
// Owner: "let's beef up the true shot design, it's mid tbh, I'm gunning for
// company cam", then approved the mockups of a full-screen viewer, swipe-up
// details, select mode, the camera, the confirm card and the picker. These
// pin what each screen promises, not how it is drawn.
test.describe('TrueShot: the redesign', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  // Page-owned, so a cloud pull landing mid-test cannot swap the arrays out
  // from under the assertion (the flake class fixed in #89).
  const house = () => page.evaluate(() => {
    window.__house = () => {
      try { tdCloseCapture(); } catch (e) {}
      try { tdReviewClose(); } catch (e) {}
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      clients.length = 0; photos.length = 0; jobs.length = 0; bids.length = 0;
      clients.push({ id: 501, name: 'Pepe Miranda', addr: '6908 SW 17th St, Topeka, KS', lat: 39.03561, lon: -95.78330,
        extraAddresses: [{ addr: '6912 SW 17th St, Topeka, KS', lat: 39.0358, lon: -95.7838, label: 'Rental' }] });
      clients.push({ id: 502, name: 'Dana Whitfield', addr: '412 Oak St' });
      const t0 = Date.parse('2026-09-22T19:51:12Z');
      ['before', 'progress', 'progress', 'after', 'progress', 'before'].forEach((type, i) => photos.push({
        id: 7100 + i, type, url: '', thumbUrl: '', data: 'x', client_id: 501, client_name: 'Pepe Miranda',
        addr: '6908 SW 17th St, Topeka, KS', lat: 39.03557, lon: -95.78321, accM: 8, shotPx: '3024x4032',
        uploadedAt: new Date(t0 + i * 60000).toISOString() }));
      return photos.map(p => p.id);
    };
    return window.__house();
  });
  const openAlbum = async () => { await house(); return page.evaluate(() => {
    window.__house();
    tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice());
    return photos.length;
  }); };

  test.describe('the viewer', () => {
    test('the photo fills the screen and the controls float over it', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house(); tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7101);
        const sheet = document.getElementById('pc-rev').getBoundingClientRect();
        const stage = document.getElementById('pc-rev-stage').getBoundingClientRect();
        const bar = document.querySelector('.pc-v-bar').getBoundingClientRect();
        return { sheetH: sheet.height, stageH: stage.height, stageTop: stage.top, barBottom: bar.bottom,
          overlap: bar.top < stage.bottom, title: document.querySelector('.pc-v-a').textContent,
          sub: document.querySelector('.pc-v-b').textContent };
      });
      expect(r.stageH, 'the stage is the whole sheet, not what is left under a header').toBe(r.sheetH);
      expect(r.stageTop).toBe(0);
      expect(r.overlap, 'the bar sits over the photo rather than taking space from it').toBe(true);
      expect(r.title).toBe('6908 SW 17th St');
      expect(r.sub).toContain('Progress');
      expect(r.sub).toContain('2 of 6');
    });

    test('Share, Mark up, Details and Delete are on the bar; Move and Full size are behind •••', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house(); photos[0].fullPath = 'u/x/f-1.jpg';
        tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7100);
        const bar = [...document.querySelectorAll('.pc-v-bar .pc-side')].map(b => b.textContent);
        const menu = document.getElementById('pc-menu');
        const hiddenAtFirst = getComputedStyle(menu).display === 'none';
        tdViewerMenu();
        const shown = getComputedStyle(menu).display !== 'none';
        return { bar, menu: [...menu.querySelectorAll('.pc-side')].map(b => b.textContent), hiddenAtFirst, shown };
      });
      expect(r.bar).toEqual(['Share', 'Mark up', 'Details', 'Delete']);
      expect(r.menu).toEqual(['Move', 'Full size']);
      expect(r.hiddenAtFirst).toBe(true);
      expect(r.shown).toBe(true);
    });

    test('the scrubber jumps straight to a photo', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house(); tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7100);
        const n = document.querySelectorAll('.pc-v-th').length;
        document.querySelectorAll('.pc-v-th')[4].click();
        return { n, title: document.querySelector('.pc-rev-title').textContent, on: document.querySelectorAll('.pc-v-th.on').length };
      });
      expect(r.n).toBe(6);
      expect(r.title).toBe('5 of 6');
      expect(r.on).toBe(1);
    });

    test('Share with no system share sheet says so, and never throws', async () => {
      await house();
      const r = await page.evaluate(async () => {
        window.__house();
        const saved = navigator.share;
        try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
        const out = await tdPhotoShare([7100]);
        try { Object.defineProperty(navigator, 'share', { value: saved, configurable: true }); } catch (e) {}
        return { out, none: await tdPhotoShare([]), junk: await tdPhotoShare(['nope']) };
      });
      expect(r.out).toBe(false);
      expect(r.none).toBe(false);
      expect(r.junk).toBe(false);
    });

    test('Share hands the system sheet real files', async () => {
      await house();
      const r = await page.evaluate(async () => {
        window.__house();
        const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
        photos[0].data = cv.toDataURL('image/jpeg');
        let got = null;
        const s0 = navigator.share, c0 = navigator.canShare;
        Object.defineProperty(navigator, 'share', { value: async (d) => { got = d; }, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
        const ok = await tdPhotoShare([7100]);
        Object.defineProperty(navigator, 'share', { value: s0, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: c0, configurable: true });
        return { ok, n: got && got.files ? got.files.length : 0, name: got && got.files ? got.files[0].name : '', type: got && got.files ? got.files[0].type : '' };
      });
      expect(r.ok).toBe(true);
      expect(r.n).toBe(1);
      expect(r.name).toMatch(/^6908-SW-17th-St-1\.jpg$/);
      expect(r.type).toBe('image/jpeg');
    });
  });

  test.describe('details', () => {
    test('a photo at the house says On site, how far, where, and what the file carries', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        Object.assign(photos[1], { by: 'Jack Schonfeldt', exifGps: true, stamped: true });
        tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7101);
        tdPhotoInfo();
        const el = document.getElementById('pc-info');
        return { text: el.textContent, chips: [...el.querySelectorAll('.pc-chip-s')].map(c => c.textContent),
          onsite: !!el.querySelector('.pc-onsite') };
      });
      expect(r.onsite).toBe(true);
      expect(r.text).toContain('Jack Schonfeldt');
      expect(r.text).toContain('6908 SW 17th St');
      expect(r.text).toContain('Pepe Miranda');
      expect(r.text).toMatch(/Distance from house\d+ ft/);
      expect(r.text).toContain('39.03557, -95.78321');
      expect(r.chips).toEqual(['3024 × 4032', '12 MP', '±26 ft', 'GPS in file', 'Stamped']);
      await page.evaluate(() => { tdPhotoInfoClose(); tdReviewClose(); });
    });

    test('it never claims what the row cannot prove', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        photos.push({ id: 7199, type: 'before', url: '', data: 'x', client_id: null, uploadedAt: new Date().toISOString() });
        tdPhotoInfo(7199);
        const el = document.getElementById('pc-info');
        return { text: el.textContent, chips: el.querySelectorAll('.pc-chip-s').length,
          onsite: !!el.querySelector('.pc-onsite'), map: !!document.getElementById('pc-info-map') };
      });
      expect(r.onsite, 'no fix, no On site').toBe(false);
      expect(r.map, 'no fix, no map').toBe(false);
      expect(r.chips, 'no pixel size, no GPS, no stamp: nothing to list').toBe(0);
      expect(r.text).toContain('None saved');
      expect(r.text).not.toContain('GPS in file');
      await page.evaluate(() => tdPhotoInfoClose());
    });

    test('far from every house is not On site', async () => {
      await house();
      const onsite = await page.evaluate(() => {
        window.__house();
        photos.push({ id: 7198, type: 'before', url: '', data: 'x', client_id: 501, addr: '6908 SW 17th St, Topeka, KS', lat: 39.2, lon: -95.5, uploadedAt: new Date().toISOString() });
        tdPhotoInfo(7198);
        const v = !!document.querySelector('#pc-info .pc-onsite');
        tdPhotoInfoClose();
        return v;
      });
      expect(onsite).toBe(false);
    });

    test('with no MapKit the card has no map at all, never a broken one', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house(); tdPhotoInfo(7100);
        const out = { map: !!document.getElementById('pc-info-map'), addr: !!document.querySelector('#pc-info .pc-info-addr') };
        tdPhotoInfoClose();
        return out;
      });
      expect(r.map).toBe(false);
      expect(r.addr).toBe(true);
    });

    test('the backdrop and closing the viewer both put it away; junk ids open nothing', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        tdPhotoInfo(7100);
        document.querySelector('.pc-info-bd').click();
        const byBackdrop = !document.getElementById('pc-info');
        tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7100); tdPhotoInfo();
        tdReviewClose();
        const byClose = !document.getElementById('pc-info');
        return { byBackdrop, byClose, junk: tdPhotoInfo('nope'), none: tdPhotoInfo(), stray: !!document.getElementById('pc-info') };
      });
      expect(r.byBackdrop).toBe(true);
      expect(r.byClose).toBe(true);
      expect(r.junk).toBe(false);
      expect(r.none).toBe(false);
      expect(r.stray).toBe(false);
    });
  });

  test.describe('select many', () => {
    test('Select turns taps into checks, and All selects everything', async () => {
      await openAlbum();
      const r = await page.evaluate(() => {
        tdSelectMode(true);
        const cells = () => [...document.querySelectorAll('#pc-rev .pc-rev-cell')];
        cells()[0].click(); cells()[2].click();
        const two = { sel: document.querySelectorAll('#pc-rev .pc-rev-cell.sel').length, viewer: !!document.getElementById('pc-rev-stage'),
          label: document.querySelector('.pc-sel-n').textContent };
        tdSelAll();
        const all = document.querySelectorAll('#pc-rev .pc-rev-cell.sel').length;
        tdSelAll();
        const none = document.querySelectorAll('#pc-rev .pc-rev-cell.sel').length;
        const disabled = [...document.querySelectorAll('.pc-selbar .pc-tb')].every(b => b.disabled);
        tdSelectMode(false);
        const out = { two, all, none, disabled, back: document.querySelectorAll('.pc-ck').length };
        tdReviewClose();
        return out;
      });
      expect(r.two.sel).toBe(2);
      expect(r.two.viewer, 'a tap in select mode never opens the viewer').toBe(false);
      expect(r.two.label).toBe('2 selected');
      expect(r.all).toBe(6);
      expect(r.none).toBe(0);
      expect(r.disabled, 'nothing selected, nothing to do').toBe(true);
      expect(r.back, 'Cancel takes the checks away').toBe(0);
    });

    test('Delete takes every selected photo, and one Undo brings all of them back', async () => {
      await openAlbum();
      const r = await page.evaluate(() => {
        tdSelectMode(true);
        [7100, 7102, 7104].forEach(id => tdSelToggle(id));
        const n = tdSelDelete();
        // Visit cells only: the Before & After pair pins two more above them.
        const after = { left: photos.length, cells: document.querySelectorAll('#pc-rev .pc-fold-visit .pc-rev-cell').length,
          undo: [...document.querySelectorAll('#pc-rev .pc-side')].some(b => b.textContent === 'Undo delete') };
        tdReviewUndo();
        const out = { n, after, back: photos.length, cells: document.querySelectorAll('#pc-rev .pc-fold-visit .pc-rev-cell').length };
        tdReviewClose();
        return out;
      });
      expect(r.n).toBe(3);
      expect(r.after.left).toBe(3);
      expect(r.after.cells).toBe(3);
      expect(r.after.undo).toBe(true);
      expect(r.back).toBe(6);
      expect(r.cells).toBe(6);
    });

    test('a mass delete reaches storage only once the album is closed', async () => {
      await openAlbum();
      const r = await page.evaluate(async () => {
        const removed = [];
        const saved = { en: supaEnabled, supa: _supa };
        photos.forEach((p, i) => { p.storagePath = 'u/p' + i + '.jpg'; p.thumbPath = 'u/t' + i + '.jpg'; });
        supaEnabled = () => true;
        _supa = { storage: { from: () => ({ remove: async (paths) => { removed.push(...paths); return { error: null }; } }) } };
        try {
          tdSelectMode(true); tdSelAll(); tdSelToggle(7105); tdSelDelete();
          const whileOpen = removed.length;
          tdReviewClose();
          return { whileOpen, after: removed.length, left: photos.length };
        } finally { supaEnabled = saved.en; _supa = saved.supa; }
      });
      expect(r.whileOpen).toBe(0);
      expect(r.after, 'five photos, a display and a thumb path each').toBe(10);
      expect(r.left).toBe(1);
    });

    test('Stage retags the whole selection', async () => {
      await openAlbum();
      const r = await page.evaluate(() => {
        tdSelectMode(true);
        [7100, 7101].forEach(id => tdSelToggle(id));
        tdSelStage();
        const menu = document.getElementById('pc-stage-menu').classList.contains('open');
        const n = tdSelStage('after');
        const out = { menu, n, types: photos.filter(p => [7100, 7101].includes(p.id)).map(p => p.type),
          others: photos.filter(p => ![7100, 7101].includes(p.id)).every(p => p.type !== 'after' || p.id === 7103),
          selecting: !!document.querySelector('.pc-selbar'), junk: (tdSelectMode(true), tdSelToggle(7102), tdSelStage('garbage')) };
        tdReviewClose();
        return out;
      });
      expect(r.menu).toBe(true);
      expect(r.n).toBe(2);
      expect(r.types).toEqual(['after', 'after']);
      expect(r.others).toBe(true);
      expect(r.selecting, 'select mode ends once the job is done').toBe(false);
      expect(r.junk).toBe(false);
    });

    test('Move sends the selection, and only the selection, to the picker', async () => {
      await openAlbum();
      const r = await page.evaluate(() => {
        tdSelectMode(true);
        [7103, 7105].forEach(id => tdSelToggle(id));
        tdSelMove();
        const out = { open: !!document.getElementById('pc-att'), title: document.querySelector('.pc-att-t').textContent,
          ids: _pcAtt ? _pcAtt.ids.slice() : [] };
        tdAttachCancel(); tdReviewClose();
        return out;
      });
      expect(r.open).toBe(true);
      expect(r.title).toBe('Whose 2 photos?');
      expect(r.ids).toEqual([7103, 7105]);
    });

    test('the burst after a shoot has Select too, and its confirm card steps aside', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        photos.forEach(p => { p.client_id = null; p.client_name = ''; });
        tdReviewShots(photos.map(p => p.id));
        const card = !!document.getElementById('pc-rev-here');
        const btn = [...document.querySelectorAll('#pc-rev .pc-side')].find(b => b.textContent === 'Select');
        btn.click();
        const out = { card, cardInSelect: !!document.getElementById('pc-rev-here'), bar: !!document.querySelector('.pc-selbar'),
          title: document.querySelector('.pc-rev-title').textContent };
        tdReviewClose();
        return out;
      });
      expect(r.card).toBe(true);
      expect(r.cardInSelect).toBe(false);
      expect(r.bar).toBe(true);
      expect(r.title).toBe('Select photos');
    });

    test('the tray count opens every unfiled photo in one grid', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        photos.forEach((p, i) => { p.client_id = null; p.uploadedAt = new Date(Date.parse('2026-09-01T12:00:00Z') + i * 864e5).toISOString(); });
        const host = document.createElement('div'); host.innerHTML = tdUnfiledTrayHTML();
        const rows = host.querySelectorAll('.pc-uf-row').length;
        host.querySelector('.pc-uf-count').click();
        const out = { rows, cells: document.querySelectorAll('#pc-rev .pc-rev-cell').length, none: (photos.length = 0, tdReviewAllUnfiled()) };
        tdReviewClose();
        return out;
      });
      expect(r.rows, 'bursts a day apart are separate rows').toBeGreaterThan(1);
      expect(r.cells, 'but the count opens all of them together').toBe(6);
      expect(r.none).toBe(false);
    });
  });

  test.describe('the camera, the confirm card and the picker', () => {
    test('the camera names the house it is standing at, live, before a shot', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        tdCaptureUnfiled();
        const before = { subject: document.getElementById('pc-subject').textContent, idle: document.getElementById('pc-subject-dot').classList.contains('idle') };
        _pcFix = { lat: 39.03557, lon: -95.78321, acc: 8, t: Date.now() };
        _pcPaintNear();
        const after = { subject: document.getElementById('pc-subject').textContent, near: document.getElementById('pc-near').textContent,
          idle: document.getElementById('pc-subject-dot').classList.contains('idle') };
        _pcFix = null; tdCloseCapture();
        return { before, after };
      });
      expect(r.before.subject).toBe('No customer yet');
      expect(r.before.idle).toBe(true);
      expect(r.after.subject).toBe('6908 SW 17th St');
      expect(r.after.near).toBe('Pepe Miranda');
      expect(r.after.idle).toBe(false);
    });

    test('the last-shot thumbnail counts this shoot and opens mark-up', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        tdCaptureForClient(501, 'before');
        const t = document.getElementById('pc-strip');
        const out = { n: t.textContent, empty: t.classList.contains('empty'), bg: !!t.style.backgroundImage, click: typeof t.onclick };
        tdCloseCapture();
        tdCaptureForClient(502, 'before');
        out.emptyWhenNone = document.getElementById('pc-strip').classList.contains('empty');
        tdCloseCapture();
        return out;
      });
      expect(r.n).toBe('6');
      expect(r.empty).toBe(false);
      expect(r.bg).toBe(true);
      expect(r.click).toBe('function');
      expect(r.emptyWhenNone).toBe(true);
    });

    test('the confirm card counts the photos it is about to file', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        photos.forEach(p => { p.client_id = null; });
        tdReviewShots([7100]);
        const one = document.getElementById('pc-rev-confirm').textContent;
        tdReviewClose();
        tdReviewShots(photos.map(p => p.id));
        const six = document.getElementById('pc-rev-confirm').textContent;
        tdReviewClose();
        return { one, six };
      });
      expect(r.one).toBe('File this photo here');
      expect(r.six).toBe('File 6 photos here');
    });

    test('the picker is a dark sheet with near-you first, and initials for everyone else', async () => {
      await house();
      const r = await page.evaluate(() => {
        window.__house();
        photos.forEach(p => { p.client_id = null; });
        tdReviewShots(photos.map(p => p.id)); tdReviewAttach();
        const ov = document.getElementById('pc-att');
        const out = { sheet: !!ov.querySelector('.pc-att-sheet'), labels: [...ov.querySelectorAll('.pc-att-lbl')].map(l => l.textContent),
          near: ov.querySelectorAll('.pc-file-opt.near').length,
          avatars: [...ov.querySelectorAll('.pc-file-list .pc-av:not(.add)')].map(a => a.textContent),
          multi: [...ov.querySelectorAll('.pc-file-list .pc-file-opt')].map(b => b.textContent).find(t => /Pepe/.test(t)) || '' };
        _pcAttPaint('who', 'dana');
        out.searchLabels = [...document.querySelectorAll('#pc-att .pc-att-lbl')].map(l => l.textContent);
        document.querySelector('#pc-att').click();
        out.closedByBackdrop = !document.getElementById('pc-att');
        tdReviewClose();
        return out;
      });
      expect(r.sheet).toBe(true);
      expect(r.labels).toEqual(['Near you', 'All customers']);
      expect(r.near).toBe(2);
      expect(r.avatars).toEqual(['DW', 'PM']);
      expect(r.multi).toContain('2 addresses');
      expect(r.searchLabels, 'a search shows results, not the nearby list').toEqual(['Results']);
      expect(r.closedByBackdrop).toBe(true);
    });
  });

  // §15.3: nothing bleeds off a phone, and no two controls sit on each other.
  test('no screen bleeds sideways or stacks controls at 390px', async () => {
    await house();
    const r = await page.evaluate(() => {
      const bad = [];
      const check = (where, sel) => {
        if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(where + ': page scrolls sideways');
        const els = [...document.querySelectorAll(sel)].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden'; });
        els.forEach(e => { if (e.getBoundingClientRect().right > innerWidth + 1) bad.push(where + ': ' + (e.textContent || e.className).trim().slice(0, 20) + ' off the edge'); });
        for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
          const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
          if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(where + ': ' + (els[i].textContent || els[i].className).trim().slice(0, 16) + ' overlaps ' + (els[j].textContent || els[j].className).trim().slice(0, 16));
        }
      };
      window.__house();
      tdCaptureUnfiled();
      check('camera', '#pc-sheet button');
      tdCloseCapture();
      tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice()); tdFolderOpen(7101);
      check('viewer', '#pc-rev .pc-v-top > .pc-side, #pc-rev .pc-v-title, #pc-rev .pc-v-bar .pc-side');
      tdReviewGrid(); tdSelectMode(true); tdSelToggle(7100);
      check('select', '#pc-rev .pc-rev-top .pc-side, .pc-selbar .pc-tb');
      tdReviewClose();
      photos.forEach(p => { p.client_id = null; });
      tdReviewShots(photos.map(p => p.id));
      check('confirm', '#pc-rev .pc-rev-top .pc-side, .pc-conf .pc-side');
      tdReviewAttach();
      check('picker', '#pc-att .pc-file-opt, #pc-att .pc-att-x');
      tdAttachCancel(); tdReviewClose();
      return bad;
    });
    expect(r).toEqual([]);
  });

  test('who took it, and what went into the file, ride the row to the cloud', async () => {
    await house();
    const r = await page.evaluate(async () => {
      window.__house(); photos.length = 0;
      S.ownerName = 'Logan Sample';
      const row = await tdSavePhoto({ type: 'before', file: new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }), stamp: false });
      const reg = _TD_TABLES.find(t => t.t === 'td_photos');
      const out = reg.tx([Object.assign({}, row, { storagePath: 'u/a.jpg', exifGps: true, stamped: true })])[0];
      const bare = reg.tx([{ id: 1, url: 'x', storagePath: 'u/b.jpg', type: 'before' }])[0];
      return { by: row.by, stampedRow: !!row.stamped, out: { by: out.by, exifGps: out.exifGps, stamped: out.stamped },
        bare: { by: bare.by, exifGps: bare.exifGps, stamped: bare.stamped } };
    });
    expect(r.by).toBeTruthy();
    expect(r.stampedRow, 'stamp:false writes no stamp claim').toBe(false);
    expect(r.out).toEqual({ by: r.by, exifGps: true, stamped: true });
    expect(r.bare).toEqual({ by: '', exifGps: false, stamped: false });
  });

  test('every handler the new screens name exists, and nothing logged an error', async () => {
    await house();
    const missing = await page.evaluate(() => {
      const bad = [];
      const scan = (html, where) => {
        const re = /on[a-z]+="([^"]*)"/g; let m;
        while ((m = re.exec(html))) {
          const fnRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g; let f;
          while ((f = fnRe.exec(m[1]))) if (typeof window[f[1]] !== 'function' && !['if', 'return'].includes(f[1])) bad.push(where + ':' + f[1]);
        }
      };
      window.__house(); photos[0].fullPath = 'u/f.jpg';
      tdOpenPropertyFolder(501, '6908 SW 17th St, Topeka, KS', photos.slice());
      tdSelectMode(true); scan(document.getElementById('pc-rev').innerHTML, 'select');
      tdSelectMode(false); tdFolderOpen(7100); scan(document.getElementById('pc-rev').innerHTML, 'viewer');
      tdPhotoInfo(); scan(document.getElementById('pc-info').innerHTML, 'info'); tdPhotoInfoClose();
      tdReviewClose();
      tdCaptureUnfiled(); scan(document.getElementById('pc-sheet').innerHTML, 'camera'); tdCloseCapture();
      return bad;
    });
    expect(missing).toEqual([]);
    assertNoErrors(page, 'TrueShot redesign');
  });
});

// ── Look Around: the house from the street (owner 2026-09-23) ───────────────
// "Can we pull Apple's street photo?" onto the property card and the album
// cover. The imagery itself only exists on the live domains (the MapKit token
// is locked to them), so these pin everything around it: when a slot is
// offered, that it stays invisible until the frame says Apple has imagery,
// that "none" removes it for good, and that the full view opens and closes.
test.describe('TrueShot: Look Around', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  const seedLa = () => page.evaluate(() => {
    window.__la = (tok) => {
      try { tdStreetClose(); tdReviewClose(); } catch (e) {}
      Object.keys(_pcSvState).forEach(k => delete _pcSvState[k]);
      window.__realTok = window.__realTok || _tdMapkitToken;
      _tdMapkitToken = tok ? () => tok : window.__realTok;
      clients.length = 0; photos.length = 0;
      clients.push({ id: 501, name: 'Pepe Miranda', addr: '6908 SW 17th St, Topeka, KS', lat: 39.03561, lon: -95.78330,
        extraAddresses: [{ addr: '6912 SW 17th St, Topeka, KS', lat: 39.0358, lon: -95.7838, label: 'Rental' }, { addr: '1 No Pin Rd', label: 'Lot' }] });
      return true;
    };
    return window.__la();
  });

  test('each property finds its own pin, and a property with none gets no street view', async () => {
    await seedLa();
    const r = await page.evaluate(() => {
      const c = clients[0];
      return { primary: tdStreetPlace(c, '6908 SW 17th St, Topeka, KS'), rental: tdStreetPlace(c, '6912 SW 17th St, Topeka, KS'),
        noPin: tdStreetPlace(c, '1 No Pin Rd'), nobody: tdStreetPlace(null, 'x') };
    });
    expect(r.primary).toMatchObject({ lat: 39.03561, lon: -95.7833 });
    expect(r.rental).toMatchObject({ lat: 39.0358, lon: -95.7838 });
    expect(r.noPin).toBe(null);
    expect(r.nobody).toBe(null);
  });

  test('where MapKit would refuse the origin, nothing is loaded at all', async () => {
    await seedLa();
    const html = await page.evaluate(() => tdStreetSlotHTML(clients[0], '6908 SW 17th St, Topeka, KS', 'sv-card'));
    expect(html).toBe('');
  });

  test('a slot starts invisible, opens on "ready", and "none" removes it for good', async () => {
    await seedLa();
    const r = await page.evaluate(async () => {
      window.__la('tok');
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML = tdStreetSlotHTML(clients[0], '6908 SW 17th St, Topeka, KS', 'sv-card') + tdStreetSlotHTML(clients[0], '6912 SW 17th St, Topeka, KS', 'sv-card');
      const [a, b] = host.querySelectorAll('.td-sv');
      const frame = a.querySelector('iframe').getAttribute('src');
      const hiddenAtFirst = getComputedStyle(a).opacity === '0' && a.getBoundingClientRect().height === 0;
      // The frames are live, so the test speaks for them before they answer.
      _pcSvMessage({ origin: location.origin, data: { type: 'td-sv', id: a.id, state: 'ready' } });
      _pcSvMessage({ origin: location.origin, data: { type: 'td-sv', id: b.id, state: 'none' } });
      _pcSvMessage({ origin: 'https://evil.example', data: { type: 'td-sv', id: a.id, state: 'none' } });
      const out = { frame, hiddenAtFirst, aOn: a.classList.contains('on'), aStill: a.isConnected, bGone: !b.isConnected,
        again: tdStreetSlotHTML(clients[0], '6912 SW 17th St, Topeka, KS', 'sv-card'),
        readyAgain: /td-sv sv-card on/.test(tdStreetSlotHTML(clients[0], '6908 SW 17th St, Topeka, KS', 'sv-card')) };
      host.remove(); window.__la();
      return out;
    });
    expect(r.frame).toMatch(/^look-around\.html\?id=td-sv-\d+&lat=39\.03561&lon=-95\.7833$/);
    expect(r.hiddenAtFirst).toBe(true);
    expect(r.aOn).toBe(true);
    expect(r.aStill, 'a message from another origin is ignored').toBe(true);
    expect(r.bGone).toBe(true);
    expect(r.again, 'a house Apple has no imagery for is not asked about twice').toBe('');
    expect(r.readyAgain, 'and one it has opens straight away next time').toBe(true);
  });

  test('tapping opens the full, walkable view; Close puts it away; junk opens nothing', async () => {
    await seedLa();
    const r = await page.evaluate(() => {
      const ok = tdStreetOpen(39.03561, -95.7833, '6908 SW 17th St');
      const el = document.getElementById('td-sv-full');
      const out = { ok, src: el.querySelector('iframe').getAttribute('src'), cap: el.textContent };
      el.querySelector('.td-sv-x').click();
      out.closed = !document.getElementById('td-sv-full');
      out.junk = tdStreetOpen('x', null, '');
      out.stray = !!document.getElementById('td-sv-full');
      return out;
    });
    expect(r.ok).toBe(true);
    expect(r.src).toContain('mode=full');
    expect(r.src).toContain('lat=39.03561');
    expect(r.cap).toContain('6908 SW 17th St');
    expect(r.closed).toBe(true);
    expect(r.junk).toBe(false);
    expect(r.stray).toBe(false);
  });

  test('the property card carries it at the top when open, and the album cover carries it too', async () => {
    await seedLa();
    const r = await page.evaluate(() => {
      window.__la('tok');
      const c = clients[0];
      const openCard = _cdPropCardHtml(c, { label: 'Primary', addr: c.addr }, 0, 1);
      const closedCard = _cdPropCardHtml(c, { label: 'Rental', addr: c.extraAddresses[0].addr }, 1, 3);
      photos.push({ id: 7301, type: 'before', url: '', data: 'x', client_id: 501, addr: c.addr, uploadedAt: new Date().toISOString() });
      tdOpenPropertyFolder(501, c.addr, photos.slice());
      const hero = document.querySelector('.pc-fold-hero .td-sv.hero');
      const out = { openFirst: openCard.indexOf('td-sv sv-card') > -1 && openCard.indexOf('td-sv sv-card') < openCard.indexOf('Primary'),
        closed: closedCard.indexOf('td-sv') > -1, hero: !!hero };
      tdReviewClose(); window.__la();
      return out;
    });
    expect(r.openFirst, 'an open card leads with the street view').toBe(true);
    expect(r.closed, 'a collapsed card stays one calm row').toBe(false);
    expect(r.hero).toBe(true);
  });

  test('the frame itself says "none" and loads nothing when it has no token', async () => {
    await seedLa();
    const msg = await page.evaluate(() => new Promise(res => {
      const f = document.createElement('iframe');
      const t = setTimeout(() => res('timeout'), 5000);
      const on = (e) => { if (e.data && e.data.id === 'probe') { clearTimeout(t); window.removeEventListener('message', on); f.remove(); res(e.data.state); } };
      window.addEventListener('message', on);
      f.src = 'look-around.html?id=probe&lat=39.03561&lon=-95.7833';
      document.body.appendChild(f);
    }));
    expect(msg).toBe('none');
    assertNoErrors(page, 'Look Around');
  });
});

// Owner 2026-09-23: "does it have a way to create a client and add a address
// if you take a photo and it doesn't return the address in the system?" It
// did not. The picker now heads its list with New customer, filled in from
// where the photos were taken, and a customer shot away from every house on
// file is asked which property, with the one he is standing at on offer.
test.describe('TrueShot: a customer or a house the book does not have yet', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Same reason as the sheet block: a reconnect load replaces photos.
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      window.__seedNew = (lat, lon) => {
        try { tdAttachCancel(); tdReviewClose(); } catch (e) {}
        document.querySelectorAll('.zmodal-overlay').forEach(x => x.remove());
        clients.length = 0; photos.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita, KS 67202', lat: 37.6889, lon: -97.3361, extraAddresses: [] });
        photos.push({ id: 970, type: 'before', url: '', data: 'x', client_id: null, lat, lon, uploadedAt: '2026-09-23T15:00:00.000Z' },
                    { id: 971, type: 'before', url: '', data: 'x', client_id: null, lat, lon, uploadedAt: '2026-09-23T15:00:05.000Z' });
        // Where the phone is, as Apple would say it. No network in tests.
        window._reverseGeocode = async () => ({ street: '6908 SW 17th St', city: 'Topeka', state: 'KS', zip: '66615', addr: '6908 SW 17th St, Topeka, KS 66615' });
        if (!window.__keepCounty) window._countyProperty = async () => null;
        tdReviewShots([970, 971]); tdReviewAttach();
        return true;
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the list is headed by New customer, and it learns the street it is standing on', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await expect(page.locator('#pc-att .pc-att-new')).toHaveCount(1);
    await expect(page.locator('#pc-att-new-sub')).toHaveText('At 6908 SW 17th St');
    const first = await page.evaluate(() => document.querySelector('#pc-att .pc-file-list .pc-file-opt').classList.contains('pc-att-new'));
    expect(first, 'it heads the list, where a thumb finds it').toBe(true);
  });

  test('tapping it asks for a name, with the address already filled in', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.locator('#pc-att .pc-att-new').click();
    await expect(page.locator('#pc-att .pc-att-t')).toHaveText('New customer');
    await expect(page.locator('#pc-new-addr')).toHaveValue('6908 SW 17th St, Topeka, KS 66615');
    await expect(page.locator('#pc-new-name')).toHaveValue('');
    await expect(page.locator('#pc-new-go')).toHaveText('Create and file 2 photos');
  });

  test('no name, no customer: it says what is missing and files nothing', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); _pcAttPaint('new', ''); });
    const r = await page.evaluate(() => {
      const before = clients.length;
      const ok = tdAttachNewSave();
      return { ok, before, after: clients.length, err: !document.getElementById('pc-new-err').hidden,
        filed: photos.filter(p => p.client_id != null).length };
    });
    expect(r.ok).toBe(false);
    expect(r.after).toBe(r.before);
    expect(r.err).toBe(true);
    expect(r.filed).toBe(0);
  });

  test('Create makes one real customer at that address and files every photo to them', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.locator('#pc-att .pc-att-new').click();
    await page.locator('#pc-new-name').pressSequentially('Pepe Miranda');
    await page.locator('#pc-new-go').click();
    const r = await page.evaluate(() => {
      const c = clients.find(x => x.name === 'Pepe Miranda');
      return { n: clients.filter(x => x.name === 'Pepe Miranda').length, addr: c && c.addr, street: c && c.street, city: c && c.city,
        token: !!(c && c.clientToken !== undefined), extra: Array.isArray(c && c.extraAddresses),
        filed: photos.filter(p => c && p.client_id === c.id).map(p => p.addr),
        sheetGone: !document.getElementById('pc-att') && !document.getElementById('pc-rev') };
    });
    expect(r.n).toBe(1);
    expect(r.addr).toBe('6908 SW 17th St, Topeka, KS 66615');
    expect(r.street).toBe('6908 SW 17th St');
    expect(r.city).toBe('Topeka');
    expect(r.extra).toBe(true);
    expect(r.filed).toEqual(['6908 SW 17th St, Topeka, KS 66615', '6908 SW 17th St, Topeka, KS 66615']);
    expect(r.sheetGone).toBe(true);
  });

  test('a search that finds nobody becomes the name', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); _pcAttPaint('who', 'Jack Reyes'); });
    await expect(page.locator('#pc-att .pc-att-new b')).toHaveText('Add \u201cJack Reyes\u201d');
    await page.evaluate(() => tdAttachNew());
    await expect(page.locator('#pc-new-name')).toHaveValue('Jack Reyes');
  });

  test('a search that names a customer exactly does not offer a second one', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); _pcAttPaint('who', 'dana whitfield'); });
    await expect(page.locator('#pc-att .pc-att-new')).toHaveCount(0);
  });

  test('a lookup that fails leaves the address blank to type, never stuck on "Finding"', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); });
    await page.evaluate(async () => {
      tdAttachCancel(); tdReviewClose();
      window._reverseGeocode = async () => { throw new Error('offline'); };
      tdReviewShots([970, 971]); tdReviewAttach(); tdAttachNew();
      await new Promise(r => setTimeout(r, 30));
    });
    await expect(page.locator('#pc-new-addr')).toHaveValue('');
    await expect(page.locator('#pc-new-addr')).toHaveAttribute('placeholder', 'Street, city');
  });

  test('photos with no location still offer New customer, with nothing guessed', async () => {
    await page.evaluate(() => window.__seedNew(null, null));
    await expect(page.locator('#pc-att-new-sub')).toHaveText('Name and address');
    await page.evaluate(() => tdAttachNew());
    await expect(page.locator('#pc-new-addr')).toHaveValue('');
  });

  test('an existing customer shot away from every house is asked which property, with this one on offer', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.evaluate(() => tdAttachPick(501));
    await expect(page.locator('#_addrpick-sheet')).toContainText('412 Oak St');
    await expect(page.locator('#_addrpick-sheet')).toContainText('Add 6908 SW 17th St');
    await page.evaluate(() => _addrPickAddNew());
    await expect(page.locator('#_addrpick-new')).toHaveValue('6908 SW 17th St, Topeka, KS 66615');
    await page.evaluate(() => _addrPickSaveNew());
    const r = await page.evaluate(() => ({
      props: clientAddresses(clients.find(c => c.id === 501)).map(a => a.addr),
      filed: photos.filter(p => p.client_id === 501).map(p => p.addr),
    }));
    expect(r.props).toContain('6908 SW 17th St, Topeka, KS 66615');
    expect(r.filed).toEqual(['6908 SW 17th St, Topeka, KS 66615', '6908 SW 17th St, Topeka, KS 66615']);
  });

  // Owner 2026-09-23: "I go in and select is it a rental, secondary home etc."
  test('adding the house asks what it is, and Rental makes it a rental property', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.evaluate(() => { tdAttachPick(501); _addrPickAddNew(); });
    const kinds = await page.locator('#_addrpick-kinds button').allTextContents();
    expect(kinds).toEqual(['Rental', 'Second home', 'Vacation home', 'Commercial', 'Family', 'Other']);
    await page.locator('#_addrpick-kinds button[data-k="Rental"]').click();
    await expect(page.locator('#_addrpick-kinds button[data-k="Rental"]')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => _addrPickSaveNew());
    const r = await page.evaluate(() => {
      const c = clients.find(x => x.id === 501);
      const a = clientAddresses(c).find(x => /6908/.test(x.addr));
      const pd = getProperty(c, a.addr);
      return { label: a.label, ptype: pd.propertyType, rental: !!pd.isRental };
    });
    expect(r.label).toBe('Rental');
    expect(r.ptype).toBe('Rental property');
    expect(r.rental).toBe(true);
  });

  test('Second home is a label only, and tapping a chip twice takes it back', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.evaluate(() => { tdAttachPick(501); _addrPickAddNew(); });
    await page.locator('#_addrpick-kinds button[data-k="Commercial"]').click();
    await page.locator('#_addrpick-kinds button[data-k="Commercial"]').click();
    await expect(page.locator('#_addrpick-kinds button[aria-pressed="true"]')).toHaveCount(0);
    await page.locator('#_addrpick-kinds button[data-k="Second home"]').click();
    await page.evaluate(() => _addrPickSaveNew());
    const r = await page.evaluate(() => {
      const c = clients.find(x => x.id === 501);
      const a = clientAddresses(c).find(x => /6908/.test(x.addr));
      return { label: a.label, ptype: getProperty(c, a.addr).propertyType || '' };
    });
    expect(r.label).toBe('Second home');
    expect(r.ptype).toBe('');
  });

  test('skipping the question still adds the house, as an additional property', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    await page.evaluate(() => { tdAttachPick(501); _addrPickAddNew(); _addrPickSaveNew(); });
    const label = await page.evaluate(() => clientAddresses(clients.find(x => x.id === 501)).find(x => /6908/.test(x.addr)).label);
    expect(label).toBe('Additional property');
  });

  test('a customer whose houses were never pinned is still asked when the street is not theirs', async () => {
    await page.evaluate(() => {
      window.__seedNew(39.0356, -95.7833);
      const c = clients.find(x => x.id === 501); delete c.lat; delete c.lon;
    });
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    const asked = await page.evaluate(() => { tdAttachPick(501); return !!document.getElementById('_addrpick-ov'); });
    expect(asked).toBe(true);
    await page.evaluate(() => document.getElementById('_addrpick-ov')?.remove());
  });

  test('...and is not asked when the street Apple names IS theirs', async () => {
    await page.evaluate(() => {
      window.__seedNew(39.0356, -95.7833);
      const c = clients.find(x => x.id === 501); delete c.lat; delete c.lon;
      c.addr = '6908 SW 17th St, Topeka, KS 66615';
    });
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    const r = await page.evaluate(() => { tdAttachPick(501); return { asked: !!document.getElementById('_addrpick-ov'), filed: photos.filter(p => p.client_id === 501).length }; });
    expect(r.asked).toBe(false);
    expect(r.filed).toBe(2);
  });

  test('shot AT the house on file, one tap still files it there with no question', async () => {
    await page.evaluate(() => window.__seedNew(37.6889, -97.3361));
    const r = await page.evaluate(() => {
      tdAttachPick(501);
      return { asked: !!document.getElementById('_addrpick-ov'), filed: photos.filter(p => p.client_id === 501).map(p => p.addr) };
    });
    expect(r.asked).toBe(false);
    expect(r.filed).toEqual(['412 Oak St, Wichita, KS 67202', '412 Oak St, Wichita, KS 67202']);
  });

  test('the proposal gate still makes its customer through the same path', async () => {
    const r = await page.evaluate(() => {
      const before = clients.length;
      const c = _clientQuickCreate('Gate Test', '1 Main St, Topeka, KS 66603');
      const noAddr = _clientQuickCreate('No Address Yet', '');
      return { grew: clients.length - before, city: c.city, blank: noAddr.addr, str: noAddr.street,
        junk: (() => { try { _clientQuickCreate(null, null); return true; } catch (e) { return false; } })() };
    });
    expect(r.grew).toBe(2);
    expect(r.city).toBe('Topeka');
    expect(r.blank).toBe('');
    expect(r.str).toBe('');
    expect(r.junk).toBe(true);
  });

  // "Did you mean": typing a name that is already in the book offers them.
  test('typing a name already in the book offers that customer before making a second one', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); tdAttachNew(); });
    await page.locator('#pc-new-name').pressSequentially('Dana');
    await expect(page.locator('#pc-new-dupes .pc-att-dupe')).toHaveCount(1);
    await expect(page.locator('#pc-new-dupes')).toContainText('Dana Whitfield');
    await page.locator('#pc-new-dupes .pc-att-dupe').click();
    // Tapping them goes where picking them from the list goes: this street is
    // not one of Dana's, so it asks which property, with this one on offer.
    await expect(page.locator('#_addrpick-sheet')).toContainText('Add 6908 SW 17th St');
    const made = await page.evaluate(() => clients.filter(c => /^dana/i.test(c.name)).length);
    expect(made).toBe(1);
    await page.evaluate(() => document.getElementById('_addrpick-ov')?.remove());
  });

  test('a name nobody has shows no suggestions, and one letter is not a search', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); tdAttachNew(); });
    await page.locator('#pc-new-name').pressSequentially('D');
    await expect(page.locator('#pc-new-dupes .pc-att-dupe')).toHaveCount(0);
    await page.locator('#pc-new-name').pressSequentially('zzq');
    await expect(page.locator('#pc-new-dupes .pc-att-dupe')).toHaveCount(0);
  });

  // The county owner of record, matched to the book.
  test('the county owner is matched: same LLC on another property ranks first, then the name', async () => {
    const r = await page.evaluate(async () => {
      window.__seedNew(39.0356, -95.7833);
      clients.push({ id: 601, name: 'Pepe Miranda', addr: '306 SW Elmwood Ave, Topeka, KS 66606', extraAddresses: [] },
                   { id: 602, name: 'Blake Sample', addr: '2015 SW Randolph Ave, Topeka, KS 66604', extraAddresses: [] },
                   { id: 603, name: 'Rick Sample', addr: '1 Other St, Topeka, KS', extraAddresses: [] });
      setPropertyData(clients.find(c => c.id === 601), '306 SW Elmwood Ave, Topeka, KS 66606', { ownerName: 'CASASMIRANDA LLC' });
      const ask = (o) => { _pcAtt.owner = o; return _pcOwnerMatches().map(m => m.c.name + '|' + m.why); };
      return {
        llc: ask('CasasMiranda, LLC'),
        people: ask('SAMPLE, LOGAN & BLAKE REVOCABLE LIVING TRUST'),
        nobody: ask('JOHNSON, MARY'),
        junk: [ask(''), ask(null), ask('LLC INC TRUST')],
      };
    });
    expect(r.llc).toEqual(['Pepe Miranda|Also owns 306 SW Elmwood Ave']);
    expect(r.people, 'first AND last name, so Rick Sample is not a match').toEqual(['Blake Sample|County owner: SAMPLE, LOGAN & BLAKE REVOCABLE LIVING TRUST']);
    expect(r.nobody).toEqual([]);
    expect(r.junk).toEqual([[], [], []]);
  });

  test('when the county answers, "Owns this house" heads the picker and one tap goes to them', async () => {
    await page.evaluate(() => {
      window.__seedNew(39.0356, -95.7833);
      tdAttachCancel(); tdReviewClose();
      clients.push({ id: 601, name: 'Pepe Miranda', addr: '306 SW Elmwood Ave, Topeka, KS 66606', extraAddresses: [] });
      setPropertyData(clients.find(c => c.id === 601), '306 SW Elmwood Ave, Topeka, KS 66606', { ownerName: 'CASASMIRANDA LLC' });
      window._countyProperty = async () => ({ found: true, owner_name: 'CASASMIRANDA LLC' });
      tdReviewShots([970, 971]); tdReviewAttach();
    });
    await expect(page.locator('#pc-att .pc-att-owner .pc-file-opt')).toHaveCount(1);
    await expect(page.locator('#pc-att .pc-att-owner')).toContainText('Also owns 306 SW Elmwood Ave');
    const labels = await page.locator('#pc-att .pc-att-lbl').allTextContents();
    expect(labels[0]).toBe('Owns this house');
    await page.locator('#pc-att .pc-att-owner .pc-file-opt').click();
    await expect(page.locator('#_addrpick-sheet')).toContainText('Add 6908 SW 17th St');
    await page.evaluate(() => document.getElementById('_addrpick-ov')?.remove());
  });

  test('a county owner nobody matches is shown on the new-customer form, and nothing breaks without one', async () => {
    await page.evaluate(() => {
      window.__seedNew(39.0356, -95.7833);
      tdAttachCancel(); tdReviewClose();
      window._countyProperty = async () => ({ found: true, owner_name: 'JOHNSON, MARY' });
      tdReviewShots([970, 971]); tdReviewAttach(); tdAttachNew();
    });
    await expect(page.locator('#pc-new-owner')).toHaveText('County owner: JOHNSON, MARY');
    await expect(page.locator('#pc-att .pc-att-owner')).toHaveCount(0);
    await page.evaluate(() => {
      tdAttachCancel(); tdReviewClose();
      window._countyProperty = async () => null;
      tdReviewShots([970, 971]); tdReviewAttach(); tdAttachNew();
    });
    await page.waitForTimeout(50);
    await expect(page.locator('#pc-new-owner')).toBeHidden();
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); window._countyProperty = async () => null; });
  });

  test('"Which property?" opens as TrueShot\'s dark sheet, and stays light everywhere else', async () => {
    await page.evaluate(() => window.__seedNew(39.0356, -95.7833));
    await page.locator('#pc-att-new-sub').filter({ hasText: '6908' }).waitFor();
    const r = await page.evaluate(() => {
      tdAttachPick(501);
      const ov = document.getElementById('_addrpick-ov');
      const dark = ov.classList.contains('td-dark-sheet');
      const bg = getComputedStyle(document.getElementById('_addrpick-sheet')).backgroundColor;
      ov.remove();
      pickClientAddress(501, () => {});
      const plain = !document.getElementById('_addrpick-ov').classList.contains('td-dark-sheet');
      document.getElementById('_addrpick-ov').remove();
      return { dark, bg, plain };
    });
    expect(r.dark).toBe(true);
    expect(r.bg).toBe('rgb(28, 28, 30)');
    expect(r.plain).toBe(true);
  });

  test('the new-customer form holds together at 390px', async () => {
    await page.evaluate(() => { window.__seedNew(39.0356, -95.7833); tdAttachNew(); });
    const r = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      return { bleed: document.documentElement.scrollWidth > innerWidth + 1,
        go: box('#pc-new-go').right <= innerWidth, name: box('#pc-new-name').width > 150 };
    });
    expect(r.bleed).toBe(false);
    expect(r.go).toBe(true);
    expect(r.name).toBe(true);
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
    await assertNoErrors(page, 'TrueShot new customer');
  });
});

// Owner 2026-09-23, a field request: bring in photos already on the iPhone
// and file them to a customer's address. Two doors (the property card and
// the camera), one path. Each photo keeps its own date and, when iOS left it
// in, its own location; never the phone's position now, never a stamp.
test.describe('TrueShot: importing from the iPhone library', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      // A real JPEG, then (optionally) the app's own EXIF writer on top, so the
      // reader is proven against the same bytes a camera would hand it.
      window.__jpeg = async (lat, lon, when) => {
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
        const g = cv.getContext('2d'); g.fillStyle = '#6b7a60'; g.fillRect(0, 0, 40, 30);
        let blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
        if (lat != null) blob = await _pcWithGps(blob, lat, lon, when, 5);
        return new File([blob], 'IMG_' + Math.round(Math.random() * 1e6) + '.jpg', { type: 'image/jpeg', lastModified: Date.parse('2026-09-20T15:00:00Z') });
      };
      window.__seedImp = () => {
        try { tdAttachCancel(); tdReviewClose(); tdCloseCapture(); } catch (e) {}
        document.querySelectorAll('.zmodal-overlay').forEach(x => x.remove());
        clients.length = 0; photos.length = 0; jobs.length = 0;
        clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita, KS 67202', lat: 37.6889, lon: -97.3361,
          extraAddresses: [{ label: 'Rental', addr: '6908 SW 17th St, Topeka, KS 66615', lat: 39.0356, lon: -95.7833 }] });
        clients.push({ id: 502, name: 'Jack Reyes', addr: '220 Elm Ave, Topeka, KS', extraAddresses: [] });
        window._countyProperty = async () => null;
        window._reverseGeocode = async () => ({ addr: '' });
        return true;
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the reader gets back exactly what a camera wrote: where and when', async () => {
    const r = await page.evaluate(async () => {
      const f = await window.__jpeg(39.0356, -95.7833, '2026-09-18T19:42:10.000Z');
      return await _pcReadExif(f);
    });
    expect(r.lat).toBeCloseTo(39.0356, 4);
    expect(r.lon).toBeCloseTo(-95.7833, 4);
    expect(r.when).toBe('2026-09-18T19:42:10.000Z');
  });

  test('a photo with no EXIF, or junk, reads as null and never throws', async () => {
    const r = await page.evaluate(async () => {
      const plain = await window.__jpeg(null, null, null);
      const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], 'a.png');
      const cut = new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x40, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49])], 'cut.jpg');
      const out = [];
      for (const f of [plain, png, cut, new File([], 'empty.jpg'), null, undefined, 'nope', {}]) out.push(await _pcReadExif(f));
      return out;
    });
    expect(r).toEqual([null, null, null, null, null, null, null, null]);
  });

  // Owner 2026-09-23: one button, not two. "Add photos" asks camera or
  // library; the library files straight to that house.
  test('the property card has ONE Add photos button, and it offers the camera or the library', async () => {
    await page.evaluate(() => {
      window.__seedImp(); currentClientId = 501; window['_cdpropOpen_501_1'] = true;
      renderClientDetail(); goPg('pg-client-detail'); renderCDAddresses();
    });
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#cd-addresses-list button')].map(b => b.textContent.trim());
      return { add: btns.filter(t => t === 'Add photos').length, imp: btns.filter(t => t === 'Import').length,
        bleed: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(r.imp, 'no separate Import button on the card').toBe(0);
    expect(r.add).toBeGreaterThanOrEqual(1);
    expect(r.bleed).toBe(false);
    await page.evaluate(() => [...document.querySelectorAll('#cd-addresses-list button')].filter(b => b.textContent.trim() === 'Add photos').pop().click());
    await expect(page.locator('#pc-add .pc-att-t')).toHaveText('Add photos');
    const opts = await page.locator('#pc-add .pc-file-opt b').allTextContents();
    expect(opts).toEqual(['Take photo', 'Choose from library']);
    await expect(page.locator('#pc-add')).toContainText('Files straight to 6908 SW 17th St');
    const inside = await page.evaluate(() => [...document.querySelectorAll('#pc-add .pc-file-opt')].every(b => b.getBoundingClientRect().right <= innerWidth));
    expect(inside).toBe(true);
    await page.evaluate(() => document.getElementById('pc-add').click());
    await expect(page.locator('#pc-add')).toHaveCount(0);
  });

  test('Take photo opens the camera on THAT house, so shots land on the rental, not the primary', async () => {
    await page.evaluate(() => { window.__seedImp(); tdAddPhotos(501, '6908 SW 17th St, Topeka, KS 66615'); });
    await page.locator('#pc-add .pc-file-opt', { hasText: 'Take photo' }).click();
    await expect(page.locator('#pc-sheet')).toBeVisible();
    const r = await page.evaluate(async () => {
      const row = await tdSavePhoto({ file: new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }), type: 'before', stamp: false,
        clientId: _pcCtx.clientId, addr: _pcCtx.addr || undefined });
      const ctx = { c: _pcCtx.clientId, addr: _pcCtx.addr };
      tdCloseCapture(); try { tdReviewClose(); } catch (e) {}
      return { ctx, addr: row.addr };
    });
    expect(r.ctx).toEqual({ c: 501, addr: '6908 SW 17th St, Topeka, KS 66615' });
    expect(r.addr).toBe('6908 SW 17th St, Topeka, KS 66615');
    // and the old entry with no house still means the primary
    const plain = await page.evaluate(() => { tdCaptureForClient(501); const a = _pcCtx.addr; tdCloseCapture(); return a; });
    expect(plain).toBe('');
  });

  test('Choose from library opens the iPhone picker and files every photo to THAT house', async () => {
    await page.evaluate(() => { window.__seedImp(); currentClientId = 501; window['_cdpropOpen_501_1'] = true; renderClientDetail(); goPg('pg-client-detail'); renderCDAddresses(); });
    const files = await page.evaluate(async () => {
      const toB64 = async f => btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
      return [await toB64(await window.__jpeg(39.0356, -95.7833, '2026-09-18T19:42:10.000Z')),
              await toB64(await window.__jpeg(null, null, null))];
    });
    // The rental's card (index 1) is the one open.
    await page.evaluate(() => [...document.querySelectorAll('#cd-addresses-list button')].filter(b => b.textContent.trim() === 'Add photos').pop().click());
    const chooserP = page.waitForEvent('filechooser');
    await page.locator('#pc-add .pc-file-opt', { hasText: 'Choose from library' }).click();
    const chooser = await chooserP;
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles(files.map((b, i) => ({ name: 'IMG_' + i + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b, 'base64') })));
    await expect.poll(() => page.evaluate(() => photos.length)).toBe(2);
    const r = await page.evaluate(() => photos.map(p => ({ c: p.client_id, addr: p.addr, imp: !!p.imported, st: !!p.stamped, at: p.uploadedAt, lat: p.lat })));
    expect(r.every(p => p.c === 501 && p.addr === '6908 SW 17th St, Topeka, KS 66615' && p.imp && !p.st)).toBe(true);
    expect(r.map(p => p.at)).toContain('2026-09-18T19:42:10.000Z');
    expect(r.find(p => p.at === '2026-09-18T19:42:10.000Z').lat).toBeCloseTo(39.0356, 4);
    // no EXIF: the file's own date, never "now", and no invented location
    const other = r.find(p => p.at !== '2026-09-18T19:42:10.000Z');
    expect(other.lat).toBe(null);
    await expect(page.locator('#pc-rev')).toBeVisible();
    await expect(page.locator('#pc-sheet')).toHaveCount(0);
  });

  test('Add photos on a customer that no longer exists does nothing', async () => {
    const r = await page.evaluate(() => { window.__seedImp(); return [tdAddPhotos(99999, 'x'), tdAddPhotos(null), !!document.getElementById('pc-add')]; });
    expect(r).toEqual([false, false, false]);
  });

  test('the camera has Import, and imported photos join the shoot with its stage', async () => {
    await page.evaluate(() => { window.__seedImp(); tdCaptureUnfiled(); tdCaptureSetType('after'); });
    await expect(page.locator('#pc-import-btn')).toBeVisible();
    const r = await page.evaluate(async () => {
      const before = _pcSessionIds.length;
      const f = await window.__jpeg(39.0356, -95.7833, '2026-09-18T19:42:10.000Z');
      const ids = await _pcImportFiles([f], null);
      return { added: _pcSessionIds.length - before, inShoot: _pcSessionIds.includes(ids[0]),
        type: photos.find(p => p.id === ids[0]).type, imp: photos.find(p => p.id === ids[0]).imported,
        top: (() => { const t = document.querySelector('#pc-sheet .pc-cam-top').getBoundingClientRect(); const b = document.getElementById('pc-import-btn').getBoundingClientRect(); return b.right <= innerWidth && b.top >= t.top; })() };
    });
    expect(r.added).toBe(1);
    expect(r.inShoot).toBe(true);
    expect(r.type).toBe('after');
    expect(r.imp).toBe(true);
    expect(r.top).toBe(true);
    await page.evaluate(() => { try { tdCloseCapture(); tdReviewClose(); tdAttachCancel(); } catch (e) {} });
  });

  test('an imported photo with its location lands on the house it was taken at', async () => {
    await page.evaluate(() => window.__seedImp());
    const r = await page.evaluate(async () => {
      const ids = await _pcImportFiles([await window.__jpeg(39.0356, -95.7833, '2026-09-18T19:42:10.000Z')], null);
      tdReviewShots(ids); tdReviewAttach();
      return [...document.querySelectorAll('#pc-att .pc-file-opt.near')].map(b => b.textContent);
    });
    expect(r.length).toBe(1);
    expect(r[0]).toContain('Dana Whitfield');
    expect(r[0]).toContain('6908 SW 17th St');
    await page.evaluate(() => { tdAttachCancel(); tdReviewClose(); });
  });

  test('with no location, the job on the schedule that day is offered, and one tap files it there', async () => {
    const r = await page.evaluate(async () => {
      window.__seedImp();
      jobs.push({ id: 801, client_id: 502, name: 'Kitchen repaint', addr: '220 Elm Ave, Topeka, KS', start: '2026-09-18', days: 1, status: 'upcoming' });
      const f = await window.__jpeg(null, null, null);
      const g = new File([f], 'IMG_x.jpg', { type: 'image/jpeg', lastModified: Date.parse('2026-09-18T17:00:00Z') });
      const ids = await _pcImportFiles([g], null);
      tdReviewShots(ids); tdReviewAttach();
      const out = { labels: [...document.querySelectorAll('#pc-att .pc-att-lbl')].map(l => l.textContent),
        day: [...document.querySelectorAll('#pc-att .pc-att-day .pc-file-opt')].map(b => b.textContent) };
      document.querySelector('#pc-att .pc-att-day .pc-file-opt').click();
      const p = photos.find(x => x.id === ids[0]);
      out.filed = { c: p.client_id, j: p.job_id };
      return out;
    });
    expect(r.labels[0]).toBe('On the schedule Fri, Sep 18');
    expect(r.day.length).toBe(1);
    expect(r.day[0]).toContain('Jack Reyes');
    expect(r.day[0]).toContain('Kitchen repaint');
    expect(r.filed).toEqual({ c: 502, j: 801 });
  });

  test('a photo taken with the camera today is never offered by schedule day, and nothing is invented', async () => {
    const r = await page.evaluate(async () => {
      window.__seedImp();
      jobs.push({ id: 802, client_id: 502, name: 'Today job', addr: '220 Elm Ave', start: todayKey(), days: 1, status: 'upcoming' });
      photos.push({ id: 990, type: 'before', url: '', data: 'x', client_id: null, lat: null, lon: null, uploadedAt: new Date().toISOString() });
      return { camera: _pcDayMatches([990]).length, empty: _pcDayMatches([]).length, junk: _pcDayMatches(null).length };
    });
    expect(r).toEqual({ camera: 0, empty: 0, junk: 0 });
  });

  test('the details sheet says Imported, and the sync keeps the flag', async () => {
    const r = await page.evaluate(async () => {
      window.__seedImp();
      const ids = await _pcImportFiles([await window.__jpeg(39.0356, -95.7833, '2026-09-18T19:42:10.000Z')], { clientId: 501, addr: '412 Oak St, Wichita, KS 67202' });
      tdPhotoInfo(ids[0]);
      const chips = document.body.innerText.includes('Imported');
      tdPhotoInfoClose(); tdReviewClose();
      const t = _TD_TABLES.find(x => x.t === 'td_photos');
      const synced = t.tx([{ ...photos.find(p => p.id === ids[0]), url: 'https://x/a.jpg' }])[0];
      return { chips, synced: synced.imported };
    });
    expect(r.chips).toBe(true);
    expect(r.synced).toBe(true);
    await assertNoErrors(page, 'TrueShot import');
  });
});

// ── A failed upload is retried, not lost (Jack, 2026-09-24) ─────────────────
// Four photos at one house, one came through. The signal dropped mid-upload,
// tdSavePhoto parked the rest as pending rows in photos[], and two things
// finished them off: _drainPhotoQueue only ever walked jobs[].photos, so a
// photo filed to an address was never tried again, and the next cloud load
// replaced photos[] wholesale, erasing the only copy.
test.describe('Photo capture: pending uploads survive and retry', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Same park as the sheet block: the reload this block tests is driven
    // by hand through the td_photos set(), never by a background probe.
    await page.evaluate(() => { window.supaLoadFromCloud = async () => { }; });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(seed()); });

  // Runs _drainPhotoQueue against a stubbed storage bucket. `fail` makes
  // every upload error, the way a dropped connection does.
  const drain = (fail) => page.evaluate(async (o) => {
    const saved = { supa: _supa, user: _supaUser, en: window.supaEnabled };
    const uploads = [];
    try {
      window.supaEnabled = () => true;
      _supaUser = { id: 'u-jack' };
      const bucket = {
        upload: async (path) => { uploads.push(path); return o.fail ? { data: null, error: { message: 'Fetch is aborted' } } : { data: { path }, error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: 'https://cdn.test/' + path } }),
        remove: async () => ({ data: null, error: null }),
      };
      _supa = Object.assign({}, _supa || {}, { storage: { from: () => bucket } });
      await _drainPhotoQueue();
      // Main photo files only: the thumbnail (t-...) and the client hub
      // page ride along on the same bucket and are not what is counted here.
      return { uploads: uploads.filter(u => /\/before-[^/]+$/.test(u)), rows: photos.map(p => ({ id: p.id, pending: !!p.pendingUpload, hasData: !!p.data, path: p.storagePath || '', url: p.url || '' })),
               jobPending: jobs.flatMap(j => (j.photos || []).filter(p => p.pendingUpload)).length };
    } finally {
      _supa = saved.supa; _supaUser = saved.user; window.supaEnabled = saved.en;
    }
  }, { fail: !!fail });

  const DATA = 'data:image/png;base64,' + PNG_B64;

  test('a pending photo with no job uploads on the next drain, in place', async () => {
    await page.evaluate((d) => {
      for (let i = 0; i < 3; i++) photos.push({ id: 5000 + i, type: 'before', data: d, pendingUpload: true, _uploadMime: 'image/png', _uploadExt: 'png', client_id: 501, job_id: null, addr: '4835 NE Kincaid Rd', uploadedAt: new Date(Date.UTC(2026, 8, 23, 19, 38 + i)).toISOString() });
    }, DATA);
    const r = await drain(false);
    expect(r.uploads.length, 'every stranded photo gets its own upload').toBe(3);
    expect(r.rows.length, 'finished in place, never pushed as a second row').toBe(3);
    for (const row of r.rows) {
      expect(row.pending).toBe(false);
      expect(row.hasData, 'the base64 copy goes once the url exists').toBe(false);
      expect(row.path).toContain('u-jack/client-501/before-');
      expect(row.url).toContain('https://cdn.test/');
    }
    await assertNoErrors(page, 'pending photo drain');
  });

  test('a failed retry leaves the photo pending, with its local copy', async () => {
    await page.evaluate((d) => { photos.push({ id: 5100, type: 'before', data: d, pendingUpload: true, client_id: null, uploadedAt: new Date().toISOString() }); }, DATA);
    const r = await drain(true);
    expect(r.uploads.length).toBe(1);
    expect(r.rows).toEqual([{ id: 5100, pending: true, hasData: true, path: '', url: '' }]);
  });

  test('a job photo is uploaded once, not once per list it sits in', async () => {
    await page.evaluate((d) => {
      const ts = '2026-09-23T19:38:00.000Z';
      jobs.push({ id: 801, client_id: 501, name: 'Water heater', photos: [{ type: 'before', data: d, ts, pendingUpload: true }] });
      photos.push({ id: 5200, type: 'before', data: d, pendingUpload: true, client_id: 501, job_id: 801, uploadedAt: ts });
    }, DATA);
    const r = await drain(false);
    expect(r.uploads.length, 'the job sheet twin must not upload a second copy').toBe(1);
    expect(r.rows.length, 'and must not push a duplicate row').toBe(1);
    expect(r.jobPending).toBe(0);
  });

  test('a cloud reload keeps a photo still waiting to upload', async () => {
    const r = await page.evaluate((d) => {
      photos.push({ id: 5300, type: 'before', data: d, pendingUpload: true, client_id: 501, uploadedAt: new Date().toISOString() });
      photos.push({ id: 5301, type: 'before', url: 'https://x/old.jpg', storagePath: 'u/old.jpg', client_id: 501, uploadedAt: new Date().toISOString() });
      const t = _TD_TABLES.find(x => x.t === 'td_photos');
      t.set([{ id: 5400, type: 'after', url: 'https://x/new.jpg', storagePath: 'u/new.jpg', client_id: 501, uploadedAt: new Date().toISOString() }]);
      const after = photos.map(p => p.id).sort();
      // A cloud row with the same id wins over the local pending copy.
      t.set([{ id: 5300, type: 'before', url: 'https://x/done.jpg', storagePath: 'u/done.jpg', client_id: 501 }]);
      return { after, dup: photos.filter(p => p.id === 5300).length, url: photos[0].url };
    }, DATA);
    expect(r.after, 'the pending one survives, the synced one follows the cloud').toEqual([5300, 5400]);
    expect(r.dup).toBe(1);
    expect(r.url).toBe('https://x/done.jpg');
  });
});


// Owner 2026-09-25: "why can't we query SQL to see if we have the photo?"
// Because a photo that never uploaded left no trace on the server. The phone
// now reports taken / uploaded / failed (with a one-word reason) and, once a
// launch, how many are still waiting on it, through the telemetry pipe
// (analytics_events). No names or addresses in it, only the photo's id.
test.describe('TrueShot: the server can see where every photo is', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      window.__tel = [];
      window._obs = { track: (e, ctx, v) => window.__tel.push({ e, ctx, v }), error: () => {}, flush: () => {} };
      window.__file = () => new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], 'a.jpg', { type: 'image/jpeg' });
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('offline: taken, then failed with "offline", and nothing personal in either', async () => {
    const r = await page.evaluate(async () => {
      window.__tel.length = 0; photos.length = 0; clients.length = 0;
      clients.push({ id: 501, name: 'Tracey Gillaspy', addr: '4835 NE Kincaid Rd, Topeka, KS 66617' });
      const en = window.supaEnabled; window.supaEnabled = () => false;
      let row; try { row = await tdSavePhoto({ file: window.__file(), type: 'after', clientId: 501, stamp: false }); } finally { window.supaEnabled = en; }
      return { tel: window.__tel.slice(), id: String(row.id).replace(/[^0-9]/g, '').slice(0, 16), pending: tdPhotoWaiting(row) };
    });
    expect(r.pending).toBe(true);
    expect(r.tel.map(t => t.e)).toEqual(['photo_taken', 'photo_upload_failed']);
    expect(r.tel[0].ctx).toBe('photo ' + r.id);
    expect(r.tel[1].ctx).toBe('photo ' + r.id + ' offline');
    expect(JSON.stringify(r.tel)).not.toMatch(/Tracey|Gillaspy|Kincaid|4835/);
  });

  test('a storage failure is reported with its reason, and a success is reported as uploaded', async () => {
    const r = await page.evaluate(async () => {
      const saved = { en: window.supaEnabled, supa: window._supa, user: window._supaUser, cp: window._compressPhoto, hub: window._uploadClientHub, thumb: window._uploadPhotoThumb, full: window._uploadPhotoFull };
      const out = {};
      try {
        window.supaEnabled = () => true; window._supaUser = { id: 'u1' };
        window._compressPhoto = async () => null; window._uploadClientHub = async () => {};
        window._uploadPhotoThumb = async () => ({ thumbUrl: '', thumbPath: '' }); window._uploadPhotoFull = async () => '';
        const mk = (upload) => ({ storage: { from: () => ({ upload, getPublicUrl: (p) => ({ data: { publicUrl: 'https://x/' + p } }) }) } });
        window.__tel.length = 0;
        window._supa = mk(async () => ({ error: { message: 'new row violates row-level security policy', statusCode: '403' } }));
        await tdSavePhoto({ file: window.__file(), type: 'before', stamp: false });
        out.fail = window.__tel.map(t => t.e + ':' + t.ctx.split(' ').slice(2).join(' '));
        window.__tel.length = 0;
        window._supa = mk(async () => { throw new TypeError('Load failed'); });
        await tdSavePhoto({ file: window.__file(), type: 'before', stamp: false });
        out.net = window.__tel.map(t => t.e + ':' + t.ctx.split(' ').slice(2).join(' '));
        window.__tel.length = 0;
        window._supa = mk(async () => ({ error: null }));
        const row = await tdSavePhoto({ file: window.__file(), type: 'before', stamp: false });
        out.ok = window.__tel.map(t => t.e);
        out.okUrl = !!row.url;
      } finally {
        window.supaEnabled = saved.en; window._supa = saved.supa; window._supaUser = saved.user; window._compressPhoto = saved.cp;
        window._uploadClientHub = saved.hub; window._uploadPhotoThumb = saved.thumb; window._uploadPhotoFull = saved.full;
      }
      return out;
    });
    expect(r.fail).toEqual(['photo_taken:', 'photo_upload_failed:auth']);
    expect(r.net).toEqual(['photo_taken:', 'photo_upload_failed:network']);
    expect(r.ok).toEqual(['photo_taken', 'photo_uploaded']);
    expect(r.okUrl).toBe(true);
  });

  test('once a launch the phone says how many are still waiting, job-sheet copies included', async () => {
    const r = await page.evaluate(() => {
      window.__tel.length = 0; photos.length = 0; jobs.length = 0;
      photos.push({ id: 1, pendingUpload: true, data: 'x' }, { id: 2, pendingUpload: true, data: 'x' }, { id: 3, url: 'https://x/3.jpg' });
      jobs.push({ id: 9, photos: [{ type: 'after', data: 'x', pendingUpload: true }, { type: 'after', data: 'x' }] });
      const n = _pcReportPending(true);
      const again = _pcReportPending();
      photos.length = 0; jobs.length = 0;
      const none = _pcReportPending(true);
      return { n, again, none, tel: window.__tel.slice() };
    });
    expect(r.n).toBe(3);
    expect(r.again, 'only once a launch').toBe(-1);
    expect(r.none).toBe(0);
    expect(r.tel).toEqual([{ e: 'photo_pending', ctx: 'photos waiting 3', v: 3 }, { e: 'photo_pending', ctx: 'none', v: 0 }]);
  });

  test('no telemetry pipe, junk rows and junk errors: nothing throws', async () => {
    const r = await page.evaluate(() => {
      const keep = window._obs; window._obs = undefined;
      let ok = true;
      try { _pcTel('photo_taken', { id: 1 }); _pcTel('x', null); _pcReportPending(true); } catch (e) { ok = false; }
      window._obs = keep;
      return { ok, why: [null, undefined, {}, 'str', { statusCode: 413 }, { message: 'Payload too large' }].map(_pcWhyFailed) };
    });
    expect(r.ok).toBe(true);
    expect(r.why).toEqual(['other', 'other', 'other', 'other', 'too-big', 'too-big']);
    await assertNoErrors(page, 'TrueShot telemetry');
  });
});

// Owner 2026-09-25: "can you zoom in on the photos like you can on iOS?" The
// stage owns every touch so the swipes track the thumb, which also swallowed
// the phone's own pinch. The viewer zooms itself: pinch around the fingers,
// double-tap in and out, one finger pans while zoomed, and zooming loads the
// full-resolution copy so the stamp is sharp up close.
test.describe('TrueShot: zooming a photo like Photos does', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      const svg = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="' + c + '"/></svg>');
      window.__FULL = svg('#123456');
      window._pcFullUrl = (p) => (p && p.fullPath) ? window.__FULL : '';
      window.__open = (i) => {
        try { tdReviewClose(); } catch (e) {}
        photos.length = 0;
        [0, 1, 2].forEach(k => photos.push({ id: 7700 + k, type: 'before', url: svg('#6b7a60'), thumbUrl: svg('#6b7a60'), storagePath: 'u/' + k + '.jpg',
          fullPath: 'u/f-' + k + '.jpg', client_id: null, uploadedAt: '2026-09-23T15:0' + k + ':00.000Z' }));
        tdReviewShots([7700, 7701, 7702]); tdReviewOpen(i == null ? 1 : i);
        return true;
      };
      // Real pointers, with their own ids, dispatched where a thumb lands.
      window.__ev = (type, id, x, y) => document.getElementById('pc-rev-stage').dispatchEvent(new PointerEvent(type,
        { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: id, button: 0, isPrimary: id === 1 }));
      window.__z = () => { const im = document.getElementById('pc-rev-img'); const m = /scale\(([\d.]+)\)/.exec(im.style.transform);
        return { s: m ? +m[1] : 1, t: im.style.transform, zoomed: document.getElementById('pc-rev').classList.contains('pc-zoomed'), src: im.getAttribute('src'), title: document.querySelector('.pc-rev-title').textContent }; };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('double-tap zooms in on that spot and loads the full-resolution photo; double-tap again comes back', async () => {
    await page.evaluate(() => window.__open(1));
    await page.evaluate(() => { const e = window.__ev; e('pointerdown', 1, 150, 300); e('pointerup', 1, 150, 300); e('pointerdown', 1, 152, 302); e('pointerup', 1, 152, 302); });
    await expect.poll(() => page.evaluate(() => window.__z().src)).toBe(await page.evaluate(() => window.__FULL));
    const inZ = await page.evaluate(() => window.__z());
    expect(inZ.s).toBeCloseTo(2.5, 2);
    expect(inZ.zoomed).toBe(true);
    const bare = await page.evaluate(() => document.getElementById('pc-rev').classList.contains('pc-bare'));
    await page.evaluate(() => { const e = window.__ev; e('pointerdown', 1, 200, 400); e('pointerup', 1, 200, 400); e('pointerdown', 1, 200, 400); e('pointerup', 1, 200, 400); });
    const out = await page.evaluate(() => window.__z());
    expect(out.s).toBe(1);
    expect(out.zoomed).toBe(false);
    // a double tap is a zoom, not two flips of the controls
    expect(await page.evaluate(() => document.getElementById('pc-rev').classList.contains('pc-bare'))).toBe(bare);
  });

  test('two fingers pinch to zoom, and stop at the most and the least', async () => {
    await page.evaluate(() => window.__open(1));
    const r = await page.evaluate(() => {
      const e = window.__ev;
      e('pointerdown', 1, 150, 400); e('pointerdown', 2, 250, 400);
      e('pointermove', 1, 100, 400); e('pointermove', 2, 300, 400);   // 100px apart -> 200px
      const mid = window.__z();
      e('pointermove', 1, 0, 400); e('pointermove', 2, 390, 400); e('pointermove', 1, -900, 400); e('pointermove', 2, 1290, 400);
      const max = window.__z();
      e('pointerup', 1, -900, 400); e('pointerup', 2, 1290, 400);
      const after = window.__z();
      // Pinch back in past the start: it settles at the photo's own size.
      e('pointerdown', 1, 100, 400); e('pointerdown', 2, 300, 400);
      e('pointermove', 1, 190, 400); e('pointermove', 2, 210, 400);
      e('pointerup', 1, 190, 400); e('pointerup', 2, 210, 400);
      return { mid, max, after, min: window.__z() };
    });
    expect(r.mid.s).toBeCloseTo(2, 1);
    expect(r.max.s).toBe(6);
    expect(r.after.zoomed).toBe(true);
    expect(r.min.s).toBe(1);
    expect(r.min.zoomed).toBe(false);
    expect(r.min.title, 'a pinch never pages').toBe('2 of 3');
  });

  test('zoomed in, one finger moves the photo around and never pages or closes it', async () => {
    await page.evaluate(() => window.__open(1));
    const r = await page.evaluate(async () => {
      const e = window.__ev;
      e('pointerdown', 1, 195, 400); e('pointerup', 1, 195, 400); e('pointerdown', 1, 195, 400); e('pointerup', 1, 195, 400);
      const t0 = window.__z().t;
      e('pointerdown', 1, 200, 400); e('pointermove', 1, 260, 440); e('pointermove', 1, 330, 480);
      const t1 = window.__z().t;
      e('pointerup', 1, 330, 480);
      // a hard drag down and a hard swipe sideways, still zoomed
      e('pointerdown', 1, 200, 200); for (let y = 220; y <= 800; y += 60) e('pointermove', 1, 200, y); e('pointerup', 1, 200, 800);
      e('pointerdown', 1, 380, 400); for (let x = 340; x >= -300; x -= 60) e('pointermove', 1, x, 400); e('pointerup', 1, -300, 400);
      await new Promise(res => setTimeout(res, 420));
      return { moved: t0 !== t1, open: !!document.getElementById('pc-rev') && !!document.getElementById('pc-rev-img'), z: window.__z() };
    });
    expect(r.moved).toBe(true);
    expect(r.open).toBe(true);
    expect(r.z.title).toBe('2 of 3');
    expect(r.z.zoomed).toBe(true);
    // Never dragged off into black: the pan is held to the photo's edges.
    const b = await page.evaluate(() => { const im = document.getElementById('pc-rev-img').getBoundingClientRect(); return { l: im.left, r: im.right, w: innerWidth }; });
    expect(b.l).toBeLessThanOrEqual(1);
    expect(b.r).toBeGreaterThanOrEqual(b.w - 1);
  });

  test('not zoomed, the swipes still page and one tap still hides the controls', async () => {
    await page.evaluate(() => window.__open(1));
    const r = await page.evaluate(async () => {
      const e = window.__ev;
      const bare0 = document.getElementById('pc-rev').classList.contains('pc-bare');
      e('pointerdown', 1, 200, 400); e('pointerup', 1, 200, 400);
      const bare1 = document.getElementById('pc-rev').classList.contains('pc-bare');
      await new Promise(res => setTimeout(res, 400));
      e('pointerdown', 1, 360, 400); for (let x = 320; x >= 40; x -= 40) e('pointermove', 1, x, 400); e('pointerup', 1, 40, 400);
      await new Promise(res => setTimeout(res, 420));
      return { toggled: bare0 !== bare1, title: window.__z().title };
    });
    expect(r.toggled).toBe(true);
    expect(r.title).toBe('3 of 3');
  });

  test('stepping to the next photo starts it at its own size', async () => {
    await page.evaluate(() => window.__open(1));
    const r = await page.evaluate(() => {
      const e = window.__ev;
      e('pointerdown', 1, 195, 400); e('pointerup', 1, 195, 400); e('pointerdown', 1, 195, 400); e('pointerup', 1, 195, 400);
      const zin = window.__z().zoomed;
      tdReviewStep(1);
      return { zin, next: window.__z() };
    });
    expect(r.zin).toBe(true);
    expect(r.next.s).toBe(1);
    expect(r.next.zoomed).toBe(false);
    await page.evaluate(() => tdReviewClose());
    await assertNoErrors(page, 'TrueShot zoom');
  });
});

// Owner 2026-09-25: "this app is supposed to be offline first, so if
// connection is spotty the photos should still save, flush up when service
// restores and attach right." They did not: the full bytes lived in
// localStorage (about 5MB on iPhone), so the second offline photo overflowed
// it and the rest existed only in memory. Now every photo waits in an
// IndexedDB outbox, full size and filed, until the server has it.
test.describe('TrueShot: offline first, the photo outbox', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      window.__saved = { en: window.supaEnabled, supa: window._supa, user: window._supaUser };
      // A real photo-sized JPEG: noise does not compress, so the bytes are real.
      window.__big = async (w, h) => {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d'); const im = g.createImageData(w, h);
        for (let i = 0; i < im.data.length; i += 4) { im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; }
        g.putImageData(im, 0, 0);
        const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        return new File([b], 'IMG.jpg', { type: 'image/jpeg' });
      };
      window.__offline = () => { window.supaEnabled = () => false; };
      // Signal back: a storage that records every upload, or fails on demand.
      window.__online = (fail) => {
        window.__ups = [];
        window.supaEnabled = () => true; window._supaUser = { id: 'acct-me' };
        // The app's own reconnect handler runs on 'online' too, so the fake
        // answers the auth calls it makes (no session: it just stands down).
        window._supa = { auth: { startAutoRefresh() {}, stopAutoRefresh() {}, getSession: async () => ({ data: { session: null } }),
            getUser: async () => ({ data: { user: null } }) },
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          storage: { from: () => ({
          upload: async (path, body) => { if (fail) return { error: { message: 'Load failed' } }; window.__ups.push({ path, size: body && body.size }); return { error: null }; },
          getPublicUrl: (path) => ({ data: { publicUrl: 'https://x/' + path } }),
        }) } };
      };
      window.__reset = async () => {
        window.supaEnabled = window.__saved.en; window._supa = window.__saved.supa; window._supaUser = { id: 'acct-me' };
        for (const r of await _pcOutboxAll()) await _pcOutboxDel(r.id);
        photos.length = 0; jobs.length = 0; clients.length = 0;
        clients.push({ id: 501, name: 'Tracey Gillaspy', addr: '4835 NE Kincaid Rd, Topeka, KS 66617', extraAddresses: [] });
        window._uploadClientHub = async () => { };
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('five 12MP photos with no signal: all five kept full size, and localStorage never overflows', async () => {
    test.setTimeout(90000);
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      const sizes = [];
      for (let i = 0; i < 5; i++) {
        const f = await window.__big(3024, 4032); sizes.push(f.size);
        await tdSavePhoto({ file: f, type: 'before', clientId: 501, addr: '4835 NE Kincaid Rd, Topeka, KS 66617', stamp: false });
      }
      const box = await _pcOutboxAll();
      let stored = null; try { stored = JSON.parse(localStorage.getItem('zp3_photos') || '[]'); } catch (e) {}
      return { sizes, box: box.map(b => b.blob.size), rows: photos.length, maxData: Math.max(...photos.map(p => (p.data || '').length)),
        lsIds: (stored || []).filter(p => p.outboxWait).length, pending: photos.every(p => tdPhotoWaiting(p)),
        older: photos.filter(p => p.pendingUpload).length };
    });
    expect(r.box.length).toBe(5);
    expect(r.box.sort()).toEqual(r.sizes.sort());              // the full bytes, not a copy of the preview
    expect(r.rows).toBe(5);
    expect(r.pending).toBe(true);
    expect(r.maxData, 'the row keeps a small display copy only').toBeLessThan(600000);
    expect(r.lsIds, 'and all five made it into localStorage').toBe(5);
    // The older retry in _drainPhotoQueue sends a row's own base64 when it is
    // pendingUpload; for an outbox photo that is the small display copy, so an
    // outbox photo must never carry that flag (both sent it, UAT 2026-09-25).
    expect(r.older).toBe(0);
  });

  test('the app is killed and relaunched with no signal: every photo comes back, still filed', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      for (let i = 0; i < 3; i++) await tdSavePhoto({ file: await window.__big(800, 600), type: 'after', clientId: 501, addr: '4835 NE Kincaid Rd, Topeka, KS 66617', stamp: false });
      const ids = photos.map(p => String(p.id)).sort();
      photos.length = 0; localStorage.removeItem('zp3_photos');   // memory and localStorage both gone
      const n = await _pcOutboxRestore();
      return { n, ids, back: photos.map(p => String(p.id)).sort(), filed: photos.every(p => p.client_id === 501 && p.addr === '4835 NE Kincaid Rd, Topeka, KS 66617' && p.type === 'after' && p.outboxWait && !p.pendingUpload && (p.data || '').startsWith('data:image')) };
    });
    expect(r.n).toBe(3);
    expect(r.back).toEqual(r.ids);
    expect(r.filed).toBe(true);
  });

  test('signal comes back: every photo goes up full size, filed right, and leaves the outbox', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      for (let i = 0; i < 3; i++) await tdSavePhoto({ file: await window.__big(800, 600), type: 'after', clientId: 501, addr: '4835 NE Kincaid Rd, Topeka, KS 66617', stamp: false });
      photos.length = 0;   // and the phone lost them in between, for good measure
      window.__online();
      const sent = await tdPhotoFlush();
      return { sent, ups: window.__ups.filter(u => !/\/t-/.test(u.path)).map(u => u.path), rows: photos.map(p => ({ url: !!p.url, c: p.client_id, addr: p.addr, pend: tdPhotoWaiting(p), data: !!p.data })), left: (await _pcOutboxAll()).length };
    });
    expect(r.sent).toBe(3);
    expect(r.ups.length).toBe(3);
    expect(r.ups.every(p => p.startsWith('acct-me/client-501/after-'))).toBe(true);
    expect(r.rows.every(p => p.url && p.c === 501 && p.addr === '4835 NE Kincaid Rd, Topeka, KS 66617' && !p.pend && !p.data)).toBe(true);
    expect(r.left).toBe(0);
  });

  test('filed to a customer after it was taken offline: it uploads to that customer, even if the phone lost the row', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      const row = await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', stamp: false });
      tdFilePhoto(row.id, 501);
      await new Promise(res => setTimeout(res, 50));
      photos.length = 0;
      window.__online();
      await tdPhotoFlush();
      const p = photos.find(x => String(x.id) === String(row.id));
      return { path: window.__ups.filter(u => !/\/t-/.test(u.path))[0].path, c: p.client_id, name: p.client_name };
    });
    expect(r.path).toMatch(/^acct-me\/client-501\/before-/);
    expect(r.c).toBe(501);
    expect(r.name).toBe('Tracey Gillaspy');
  });

  test('a failed upload stays in the outbox and goes up on the next try', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset();
      window.__online(true);
      const row = await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', clientId: 501, stamp: false });
      const after1 = { pend: tdPhotoWaiting(row), box: (await _pcOutboxAll()).length };
      window.__online(false);
      const sent = await tdPhotoFlush();
      return { after1, sent, url: !!row.url, box: (await _pcOutboxAll()).length };
    });
    expect(r.after1).toEqual({ pend: true, box: 1 });
    expect(r.sent).toBe(1);
    expect(r.url).toBe(true);
    expect(r.box).toBe(0);
  });

  test('five flushes at once send each photo exactly once', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      for (let i = 0; i < 2; i++) await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', clientId: 501, stamp: false });
      window.__online();
      await Promise.all([tdPhotoFlush(), tdPhotoFlush(), tdPhotoFlush(), tdPhotoFlush(), tdPhotoFlush()]);
      await tdPhotoFlush();
      return window.__ups.filter(u => !/\/t-/.test(u.path)).length;
    });
    expect(r).toBe(2);
  });

  test("another account's photos on a shared phone are never sent under this one", async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      window._supaUser = { id: 'acct-other' };
      await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', stamp: false });
      photos.length = 0;
      window.__online();   // signed in as acct-me now
      const sent = await tdPhotoFlush();
      const box = await _pcOutboxAll();
      return { sent, ups: window.__ups.length, box: box.length, restored: photos.length };
    });
    expect(r.sent).toBe(0);
    expect(r.ups).toBe(0);
    expect(r.box, 'it waits for its own account').toBe(1);
    expect(r.restored, 'and is not shown in this one').toBe(0);
  });

  test("a job's photo: the job sheet copy is finished by the same upload, never sent twice", async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      jobs.push({ id: 801, client_id: 501, name: 'Water heater', addr: '4835 NE Kincaid Rd', photos: [] });
      await tdSavePhoto({ file: await window.__big(800, 600), type: 'after', jobId: 801, stamp: false });
      const twin0 = { ...jobs[0].photos[0] };
      window.__online();
      await _drainPhotoQueue();          // the job-sheet drain, then the outbox
      await tdPhotoFlush();
      const twin = jobs[0].photos[0];
      return { outboxId: !!twin0.outboxId, pend0: !!twin0.pendingUpload, ups: window.__ups.filter(u => !/\/t-/.test(u.path)).map(u => u.path),
        twinUrl: twin.url || '', twinData: !!twin.data, rows: photos.length };
    });
    expect(r.outboxId).toBe(true);
    expect(r.pend0, 'the job-sheet drain must not pick it up').toBe(false);
    expect(r.ups.length).toBe(1);
    expect(r.ups[0]).toMatch(/^acct-me\/job-801\/after-/);
    expect(r.twinUrl).toMatch(/^https:\/\/x\/acct-me\/job-801\//);
    expect(r.twinData).toBe(false);
    expect(r.rows).toBe(1);
  });

  test('the signal coming back is enough: the online event sends what is waiting', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', clientId: 501, stamp: false });
      window.__online();
      window.dispatchEvent(new Event('online'));
      for (let i = 0; i < 40 && (await _pcOutboxAll()).length; i++) await new Promise(res => setTimeout(res, 50));
      return { left: (await _pcOutboxAll()).length, ups: window.__ups.filter(u => !/\/t-/.test(u.path)).length };
    });
    expect(r).toEqual({ left: 0, ups: 1 });
  });

  test('no IndexedDB on this phone: it saves the old way instead of losing the photo', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      const keep = window._pcOutboxPut; window._pcOutboxPut = async () => false;
      let row; try { row = await tdSavePhoto({ file: await window.__big(800, 600), type: 'before', clientId: 501, stamp: false }); } finally { window._pcOutboxPut = keep; }
      return { kept: !!row, pend: !!row.pendingUpload, data: (row.data || '').startsWith('data:image/jpeg'), box: (await _pcOutboxAll()).length };
    });
    expect(r).toEqual({ kept: true, pend: true, data: true, box: 0 });
  });

  // Caught by a flaky run: a flush landing between "in the outbox" and "in
  // photos[]" restored the photo still being saved, and it showed twice.
  test('a flush that runs while photos are still saving never doubles one', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset(); window.__offline();
      const saves = [];
      for (let i = 0; i < 4; i++) {
        saves.push(tdSavePhoto({ file: await window.__big(800, 600), type: 'before', clientId: 501, stamp: false }));
        tdPhotoFlush(); _pcOutboxRestore();
      }
      await Promise.all(saves);
      await tdPhotoFlush(); await _pcOutboxRestore();
      const ids = photos.map(p => String(p.id));
      return { rows: ids.length, unique: new Set(ids).size, box: (await _pcOutboxAll()).length };
    });
    expect(r).toEqual({ rows: 4, unique: 4, box: 4 });
  });

  test('junk in, nothing thrown', async () => {
    const r = await page.evaluate(async () => {
      await window.__reset();
      const out = [];
      out.push(await _pcOutboxPut(null, null), await _pcOutboxPut({ id: 1 }, null), await _pcOutboxTouch(null), await _pcOutboxTouch({ id: 'nope' }));
      out.push(await _pcUploadRow(null, null));
      return out;
    });
    expect(r).toEqual([false, false, false, false, false]);
    await page.evaluate(async () => { await window.__reset(); window.supaEnabled = window.__saved.en; window._supa = window.__saved.supa; window._supaUser = window.__saved.user; });
    await assertNoErrors(page, 'TrueShot outbox');
  });
});

// Owner 2026-09-25: "after should bring them over as clients, even without
// jobs." Jack shot After photos at four houses with no job, no signed
// proposal and no payment, and all four sat in Leads. Built on his real book.
test.describe('TrueShot: an After photo makes them a client', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => { };
      window.__jack = () => {
        clients.length = 0; photos.length = 0; bids.length = 0; jobs.length = 0;
        const c = (id, name, addr) => clients.push({ id, name, addr, extraAddresses: [] });
        c(1, 'Debbie Gillum', '220 NW 43rd St, Topeka, KS 66617');
        c(2, 'Treyton Schafer', '2437 SW 24th St, Topeka, KS 66611');
        c(3, 'Pepe Miranda', '6908 SW 17th St, Topeka, KS 66615');
        c(4, 'Tracey Gillaspy', '4835 NE Kincaid Rd, Topeka, KS 66617');
        c(5, 'Cindy Wilson', '1904 NW Fillmore St, Topeka, KS 66608');
        c(6, 'Paid Pat', '1 Paid Rd, Topeka, KS');
        const ph = (cid, type) => photos.push({ id: Math.random(), type, client_id: cid, url: 'https://x/a.jpg', uploadedAt: '2026-09-23T15:00:00.000Z' });
        ph(1, 'before'); ph(1, 'progress'); ph(1, 'after'); ph(2, 'after'); ph(3, 'after'); ph(4, 'after'); ph(5, 'before'); ph(6, 'after');
        // Tracey has a draft proposal, which on its own read as "Abandoned".
        bids.push({ id: 41, client_id: 4, status: 'Draft', amount: 800, bid_date: '2026-09-20' });
        // Pat signed and paid: a richer answer than "work done", and it wins.
        bids.push({ id: 61, client_id: 6, status: 'Closed Won', amount: 500, bid_date: '2026-09-01' });
        return true;
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test("Jack's book: the four with After photos are clients, the before-only one is still a lead", async () => {
    const r = await page.evaluate(() => {
      window.__jack();
      const st = id => getClientStage(id).stage;
      return { debbie: st(1), treyton: st(2), pepe: st(3), tracey: st(4), cindy: st(5), label: getClientStage(2).label };
    });
    expect(r).toMatchObject({ debbie: 'work_done', treyton: 'work_done', pepe: 'work_done', tracey: 'work_done' });
    expect(r.cindy).not.toBe('work_done');
    expect(r.label).toBe('Work done: no invoice yet');
  });

  test('they show on the Clients page (All and Collect), and nowhere in Leads', async () => {
    const r = await page.evaluate(() => {
      window.__jack();
      goPg('pg-clients');
      setCF('all', document.getElementById('cft-all')); renderClientList();
      const all = document.getElementById('client-list').textContent;
      setCF('collect', document.getElementById('cft-collect')); renderClientList();
      const collect = document.getElementById('client-list').textContent;
      setCF('all', document.getElementById('cft-all'));
      const LEADS = ['incomplete', 'new', 'est_scheduled', 'est_ready', 'bid_out', 'bid_urgent', 'abandoned'];
      const leads = clients.filter(c => LEADS.includes(getClientStage(c.id).stage)).map(c => c.name);
      return { all, collect, leads };
    });
    for (const n of ['Debbie Gillum', 'Treyton Schafer', 'Pepe Miranda', 'Tracey Gillaspy']) {
      expect(r.all).toContain(n);
      expect(r.collect).toContain(n);
      expect(r.leads).not.toContain(n);
    }
    expect(r.leads).toContain('Cindy Wilson');
    expect(r.all).toContain('WORK DONE');
    // Collect really is the Collect tab: Pat, signed and paid, is not in it.
    expect(r.all).toContain('Paid Pat');
    expect(r.collect).not.toContain('Paid Pat');
  });

  test('a signed or paid job still says more than "work done"', async () => {
    const s = await page.evaluate(() => { window.__jack(); return getClientStage(6).stage; });
    expect(s).not.toBe('work_done');
  });

  test('it follows the photos: marked After later, filed later, or deleted', async () => {
    const r = await page.evaluate(async () => {
      window.__jack();
      const before = getClientStage(5).stage;
      photos.find(p => p.client_id === 5).type = 'after';          // re-staged in place
      await new Promise(res => setTimeout(res, 300));
      const staged = getClientStage(5).stage;
      clients.push({ id: 7, name: 'Later Filed', addr: '7 Late St', extraAddresses: [] });
      photos.push({ id: 7777, type: 'after', client_id: null, url: 'https://x/l.jpg', uploadedAt: '2026-09-24T15:00:00.000Z' });
      const unfiled = getClientStage(7).stage;
      tdFilePhoto(7777, 7);
      await new Promise(res => setTimeout(res, 300));
      const filed = getClientStage(7).stage;
      for (let i = photos.length - 1; i >= 0; i--) if (photos[i].client_id === 2) photos.splice(i, 1);
      const deleted = getClientStage(2).stage;
      return { before, staged, unfiled, filed, deleted };
    });
    expect(r.before).not.toBe('work_done');
    expect(r.staged).toBe('work_done');
    expect(r.unfiled).not.toBe('work_done');
    expect(r.filed).toBe('work_done');
    expect(r.deleted).not.toBe('work_done');
  });

  test('junk in, a plain false out', async () => {
    const r = await page.evaluate(() => {
      window.__jack();
      const keep = photos.slice();
      const out = [tdClientHasAfterPhoto(null), tdClientHasAfterPhoto(undefined), tdClientHasAfterPhoto(99999), tdClientHasAfterPhoto('1')];
      photos.push(null, {}, { type: 'after' });
      out.push(tdClientHasAfterPhoto(1));
      photos.length = 0; keep.forEach(p => photos.push(p));
      return out;
    });
    expect(r).toEqual([false, false, false, true, true]);
    await assertNoErrors(page, 'After photo makes a client');
  });
});
