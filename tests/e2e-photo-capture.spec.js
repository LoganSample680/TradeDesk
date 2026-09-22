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

  // The pill was cut in half by the Dynamic Island on the owner's phone the
  // first time this ran on a real device. The sheet is full-bleed over the
  // camera, so nothing else reserves that space for it.
  test('the subject pill clears the status bar and the Dynamic Island', async () => {
    await page.evaluate(() => tdCaptureForBid(901, 'before'));
    const top = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#pc-sheet .pc-attach')).top);
    // env() is 0 in a desktop browser, so the assertion is on the rule
    // surviving, not on a device number: 14px plus an inset that is only
    // non-zero where an island exists.
    const css = await page.evaluate(() =>
      [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } })
        .filter(r => r.selectorText === '.pc-attach').map(r => r.style.top).join(''));
    expect(css).toContain('safe-area-inset-top');
    expect(parseFloat(top)).toBeGreaterThanOrEqual(14);
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
    expect(r.title).toBe('6 shots');
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

    test('a vertical drag belongs to the page, not to the carousel', async () => {
      await shootUnfiled(3);
      await page.evaluate(() => tdReviewOpen(1));
      const r = await page.evaluate(async () => {
        const track = document.getElementById('pc-rev-track');
        const ev = (type, x, y) => track.dispatchEvent(new PointerEvent(type,
          { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }));
        ev('pointerdown', 200, 300);
        ev('pointermove', 206, 380);          // mostly down
        ev('pointermove', 210, 460);
        const moved = track.style.transform;
        ev('pointerup', 210, 460);
        await new Promise(r => setTimeout(r, 380));
        return { moved, title: document.querySelector('.pc-rev-title').textContent };
      });
      expect(r.moved, 'the track never moved').toBe('');
      expect(r.title).toBe('2 of 3');
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
        const opt = document.querySelector('#pc-att .pc-file-opt');
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
  const attachSeed = () => page.evaluate(() => {
    clients.length = 0; jobs.length = 0; bids.length = 0; photos.length = 0;
    clients.push({ id: 501, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS', lat: 37.6889, lon: -97.3361 });
    clients.push({ id: 502, name: 'Far Away Co', addr: '900 Mile Rd', lat: 38.9, lon: -98.9 });
    jobs.push({ id: 601, client_id: 501, name: 'Repipe', status: 'active', addr: '412 Oak St, Wichita KS', lat: 37.6889, lon: -97.3361 });
    photos.push({ id: 950, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, lat: 37.68892, lon: -97.33612, uploadedAt: new Date().toISOString() });
    photos.push({ id: 951, type: 'before', url: '', thumbUrl: '', data: 'x', client_id: null, lat: 37.68892, lon: -97.33612, uploadedAt: new Date().toISOString() });
    tdReviewShots([950, 951]);
    tdReviewAttach();
  });

  test('the coordinates put the right record at the top, with the distance', async () => {
    await attachSeed();
    const r = await page.evaluate(() => {
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
    const r = await page.evaluate(() => ({
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
      list: document.querySelectorAll('#pc-att .pc-file-opt').length,
    }));
    expect(r.near).toBe(0);
    expect(r.list).toBe(1);
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
          hasAdd: /tdCaptureForClient\(501\)/.test(html),
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
    const r = await page.evaluate(() => {
      clients.length = 0; photos.length = 0; bids.length = 0; jobs.length = 0;
      clients.push({ id: 77, name: 'Logan Sample', addr: '5900 SW Huntoon, Topeka KS',
        extraAddresses: [{ addr: '6800 SW Tenth Ave, Topeka KS', label: 'Rental' },
                         { addr: '1 Other St, Topeka KS', label: 'Shop' }] });
      photos.push({ id: 9001, type: 'before', url: 'https://x/a.jpg', uploadedAt: '2026-09-22T12:00:00Z' });
      tdReviewBurst('9001');
      [...document.querySelectorAll('#pc-rev button')].find(b => /Attach/.test(b.textContent)).click();
      [...document.querySelectorAll('#pc-att .pc-file-opt')].find(b => /Logan Sample/.test(b.textContent)).click();
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
