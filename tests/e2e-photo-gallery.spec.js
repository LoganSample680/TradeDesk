// @ts-check
// ── Photos page + texting a pick of photos (owner 2026-09-24) ───────────────
//
// "Showing all photos ... broken down by year, then months, then by address,
// fully searchable", "newest first like CompanyCam", and a CompanyCam-style
// way to text the photos from an address: "what's there when you send it, or
// you pick which ones you want, like select all befores and all afters".
//
// What these pin:
//   1. The timeline is newest first at every level: year, month, address.
//   2. Search is every-word, over the same haystack the global search uses.
//   3. An address opens the property folder that already exists, whole.
//   4. All Before / All After add a stage to the selection, and take it back.
//   5. Text makes a SNAPSHOT link of exactly the picked, uploaded photos, and
//      sends it from his own phone: to the customer, or to nobody pre-filled.
//   6. The public page draws that snapshot and nothing it was not given.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SEED = () => {
  clients.length = 0; photos.length = 0;
  clients.push({ id: 71, name: 'Tracey Gillaspy', phone: '(785) 555-1234', addr: '4835 NE Kincaid Rd, Topeka, KS' });
  clients.push({ id: 72, name: 'Debbie Gillum', addr: '220 NW 43rd St, Topeka, KS' });
  let id = 5000;
  const add = (cid, addr, name, when, type, extra) => photos.push(Object.assign({ id: id++, client_id: cid, client_name: name, addr, type,
    url: 'https://cdn.test/p' + id + '.jpg', thumbUrl: 'https://cdn.test/t' + id + '.jpg', storagePath: 'u/p' + id, uploadedAt: when }, extra || {}));
  const K = '4835 NE Kincaid Rd, Topeka, KS', G = '220 NW 43rd St, Topeka, KS';
  add(71, K, 'Tracey Gillaspy', '2026-09-23T19:30:00.000Z', 'before');
  add(71, K, 'Tracey Gillaspy', '2026-09-23T19:31:00.000Z', 'before');
  add(71, K, 'Tracey Gillaspy', '2026-09-23T19:40:00.000Z', 'progress');
  add(71, K, 'Tracey Gillaspy', '2026-09-23T19:50:00.000Z', 'after');
  add(72, G, 'Debbie Gillum', '2026-09-23T17:10:00.000Z', 'before');
  add(71, K, 'Tracey Gillaspy', '2026-08-14T15:00:00.000Z', 'after');
  add(72, G, 'Debbie Gillum', '2025-11-02T16:00:00.000Z', 'after');
};

test.describe('Photos page and texting photos', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Nothing here tests cloud loading, and a background reload replaces
    // photos[] with the mock's empty table (same park as the photo spec).
    await page.evaluate(() => { window.supaLoadFromCloud = async () => { }; });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => { try { tdReviewClose(); } catch (e) { } });
    await page.evaluate(SEED);
    await page.evaluate(() => { tdPhotosPickYear(null); tdPhotosSearch(''); });
  });

  // ── 1. Newest first, at every level ──────────────────────────────────────
  test('the timeline is newest first: year, then month, then address', async () => {
    const r = await page.evaluate(() => tdPhotoTimeline(photos).map(Y => ({ y: Y.year,
      m: Y.months.map(M => ({ k: M.key, label: M.label, places: M.places.map(P => ({ addr: P.addr.split(',')[0], n: P.photos.length })) })) })));
    expect(r).toEqual([
      { y: 2026, m: [
        { k: '2026-09', label: 'September', places: [{ addr: '4835 NE Kincaid Rd', n: 4 }, { addr: '220 NW 43rd St', n: 1 }] },
        { k: '2026-08', label: 'August', places: [{ addr: '4835 NE Kincaid Rd', n: 1 }] }] },
      { y: 2025, m: [{ k: '2025-11', label: 'November', places: [{ addr: '220 NW 43rd St', n: 1 }] }] },
    ]);
  });

  test('inside an address the photos are newest first too', async () => {
    const r = await page.evaluate(() => tdPhotoTimeline(photos)[0].months[0].places[0].photos.map(p => p.type));
    expect(r).toEqual(['after', 'progress', 'before', 'before']);
  });

  test('null, empty, junk rows and bad dates never throw and never show', async () => {
    const r = await page.evaluate(() => ({
      nul: tdPhotoTimeline(null).length, und: tdPhotoTimeline().length, empty: tdPhotoTimeline([]).length,
      str: tdPhotoTimeline('photos').length,
      junk: tdPhotoTimeline([null, 7, {}, { uploadedAt: 'not a date' }, { uploadedAt: '2026-09-01T12:00:00Z', addr: 'X St' }]).length,
    }));
    expect(r).toEqual({ nul: 0, und: 0, empty: 0, str: 0, junk: 1 });
  });

  test('a photo with no address falls to its customer, and an unfiled one to its own row', async () => {
    const r = await page.evaluate(() => {
      photos.push({ id: 6001, client_id: 72, client_name: 'Debbie Gillum', addr: '', type: 'before', url: 'u', uploadedAt: '2026-09-23T20:00:00.000Z' });
      photos.push({ id: 6002, client_id: null, addr: '', type: 'before', url: 'u', uploadedAt: '2026-09-23T20:05:00.000Z' });
      return tdPhotoTimeline(photos)[0].months[0].places.map(P => P.key);
    });
    expect(r.slice(0, 2)).toEqual(['client:unfiled', 'client:72']);
  });

  // ── 2. Search ────────────────────────────────────────────────────────────
  test('search matches every word, in any order, on address, customer and month', async () => {
    const r = await page.evaluate(() => {
      const count = q => tdPhotoTimeline(photos, q).reduce((n, Y) => n + Y.months.reduce((m, M) => m + M.places.reduce((k, P) => k + P.photos.length, 0), 0), 0);
      return { kincaid: count('kincaid'), both: count('gillum november'), reversed: count('november gillum'), miss: count('kincaid gillum'), blank: count('   ') };
    });
    expect(r).toEqual({ kincaid: 5, both: 1, reversed: 1, miss: 0, blank: 7 });
  });

  test('the page draws years, months and one row per address, and a count', async () => {
    const r = await page.evaluate(() => {
      goPg('pg-photos');
      return {
        years: [...document.querySelectorAll('#ph-list .ph-year')].map(e => e.textContent),
        months: [...document.querySelectorAll('#ph-list .ph-month')].map(e => e.textContent),
        rows: document.querySelectorAll('#ph-list .ph-place').length,
        sub: document.getElementById('ph-sub').textContent,
        active: document.getElementById('pg-photos').classList.contains('active'),
      };
    });
    expect(r).toEqual({ years: ['2026', '2025'], months: ['September', 'August', 'November'], rows: 4, sub: '7 photos · 2 addresses', active: true });
  });

  test('typing in the search box narrows the page, and a miss says so, escaped', async () => {
    await page.evaluate(() => goPg('pg-photos'));
    await page.fill('#ph-q', 'kincaid');
    expect(await page.locator('#ph-list .ph-place').count()).toBe(2);
    await page.fill('#ph-q', '<img src=x onerror=alert(1)>');
    const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#ph-list img').length, text: document.getElementById('ph-list').textContent }));
    expect(r.imgs).toBe(0);
    expect(r.text).toContain('No photos match');
    await page.fill('#ph-q', '');
  });

  // ── The year and month picker: the Books dropdown (owner 2026-09-24) ──
  const opts = (id) => [...document.querySelectorAll('#' + id + ' option')].map(o => o.textContent);
  test('the year dropdown offers only years with photos; the month one appears once a year is picked', async () => {
    const r = await page.evaluate((optsSrc) => {
      const opts = eval(optsSrc);
      goPg('pg-photos');
      const years = opts('ph-year-sel');
      const monthBefore = !!document.getElementById('ph-month-sel');
      tdPhotosPickYear(2026);
      return { years, monthBefore, months: opts('ph-month-sel'), yearVal: document.getElementById('ph-year-sel').value };
    }, opts.toString());
    expect(r).toEqual({ years: ['All years', '2026', '2025'], monthBefore: false, months: ['All of 2026', 'September', 'August'], yearVal: '2026' });
  });

  test('it looks like the Books year picker: same full-width dropdown style', async () => {
    const r = await page.evaluate(() => {
      goPg('pg-photos');
      const a = getComputedStyle(document.getElementById('ph-year-sel'));
      const b = document.getElementById('tracker-year-sel').getAttribute('style');
      return { weight: a.fontWeight, size: a.fontSize, books: /font-size:13px;font-weight:700/.test(b) };
    });
    expect(r).toEqual({ weight: '700', size: '13px', books: true });
  });

  test('picking a year, then a month, narrows the list; All goes back', async () => {
    await page.evaluate(() => goPg('pg-photos'));
    const months = () => page.evaluate(() => [...document.querySelectorAll('#ph-list .ph-month')].map(e => e.textContent));
    await page.selectOption('#ph-year-sel', '2026');
    expect(await months()).toEqual(['September', 'August']);
    await page.selectOption('#ph-month-sel', '2026-08');
    expect(await months()).toEqual(['August']);
    await page.selectOption('#ph-month-sel', '');
    expect(await months()).toEqual(['September', 'August']);
    await page.selectOption('#ph-year-sel', '');
    expect(await months()).toEqual(['September', 'August', 'November']);
  });

  test('changing the year clears the month, and junk picks fall back to All', async () => {
    const r = await page.evaluate(() => {
      goPg('pg-photos');
      tdPhotosPickYear(2026); tdPhotosPickMonth('2026-09');
      const y = tdPhotosPickYear(2025);
      const months = [...document.querySelectorAll('#ph-list .ph-month')].map(e => e.textContent);
      return { y, months, junkY: tdPhotosPickYear('abc'), junkM: tdPhotosPickMonth('Sept'), nulM: tdPhotosPickMonth(), objM: tdPhotosPickMonth({}) };
    });
    expect(r).toEqual({ y: 2025, months: ['November'], junkY: null, junkM: null, nulM: null, objM: null });
  });

  test('a search that empties the picked year falls back to All years instead of a blank page', async () => {
    const r = await page.evaluate(() => {
      goPg('pg-photos');
      tdPhotosPickYear(2025);
      tdPhotosSearch('kincaid');   // Kincaid has no 2025 photos
      return { rows: document.querySelectorAll('#ph-list .ph-place').length, year: document.getElementById('ph-year-sel').value };
    });
    expect(r).toEqual({ rows: 2, year: '' });
  });

  test('no photos, no picker', async () => {
    const r = await page.evaluate(() => { photos.length = 0; goPg('pg-photos'); return document.getElementById('ph-picker').innerHTML; });
    expect(r).toBe('');
  });

  test('the two dropdowns sit side by side inside the screen', async () => {
    const r = await page.evaluate(() => {
      goPg('pg-photos'); tdPhotosPickYear(2026);
      const a = document.getElementById('ph-year-sel').getBoundingClientRect(), b = document.getElementById('ph-month-sel').getBoundingClientRect();
      return { bleed: document.documentElement.scrollWidth <= innerWidth + 1, inside: b.right <= innerWidth + 1, noOverlap: a.right <= b.left + 1, sameRow: Math.abs(a.top - b.top) < 2 };
    });
    expect(r).toEqual({ bleed: true, inside: true, noOverlap: true, sameRow: true });
  });

  test('no photos at all says what will show up here', async () => {
    const r = await page.evaluate(() => { photos.length = 0; goPg('pg-photos'); return document.getElementById('ph-list').textContent; });
    expect(r).toContain('No photos yet');
  });

  test('renderPhotosPage with its list missing does nothing and throws nothing', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('ph-list'); const parent = el.parentNode; parent.removeChild(el);
      try { return renderPhotosPage(); } finally { parent.appendChild(el); }
    });
    expect(r).toBe(false);
  });

  test('the Photos page is in the More menu and the sidebar', async () => {
    const r = await page.evaluate(() => ({ mmi: !!document.getElementById('mmi-photos'), nb: !!document.getElementById('nb-photos') }));
    expect(r).toEqual({ mmi: true, nb: true });
  });

  test('layout: nothing bleeds off a phone, and rows stay inside the screen', async () => {
    const r = await page.evaluate(() => {
      photos[0].addr = '4835 NE Kincaid Road Extremely Long Name That Goes On And On, Topeka, KS';
      goPg('pg-photos');
      const w = innerWidth;
      return { bleed: document.documentElement.scrollWidth <= w + 1,
        rows: [...document.querySelectorAll('.ph-place')].every(e => e.getBoundingClientRect().right <= w + 1) };
    });
    expect(r).toEqual({ bleed: true, rows: true });
  });

  // ── 3. An address opens the folder that already exists, whole ────────────
  test('tapping an address opens its folder with every month, not just the row it was on', async () => {
    await page.evaluate(() => goPg('pg-photos'));
    await page.locator('#ph-list .ph-place').nth(2).click(); // August's Kincaid row
    const r = await page.evaluate(() => ({ open: !!document.getElementById('pc-rev'), n: _pcFolder && _pcFolder.ids.length, addr: _pcFolder && _pcFolder.addr }));
    expect(r).toEqual({ open: true, n: 5, addr: '4835 NE Kincaid Rd, Topeka, KS' });
  });

  test('tdPhotoOpenPlace: an unknown or empty key opens nothing', async () => {
    const r = await page.evaluate(() => [tdPhotoOpenPlace('nowhere'), tdPhotoOpenPlace(''), tdPhotoOpenPlace(null)]);
    expect(r).toEqual([false, false, false]);
  });

  // ── 4. Picking by stage ──────────────────────────────────────────────────
  test('All Before then All After picks both stages, and a second tap takes one back', async () => {
    const r = await page.evaluate(() => {
      tdPhotoOpenPlace('4835 ne kincaid rd, topeka, ks');
      tdSelectMode(true);
      const a = tdSelStageAll('before');
      const b = tdSelStageAll('after');
      const types = _pcSelRows().map(p => p.type).sort();
      const chips = [...document.querySelectorAll('.pc-pick-chips .fb.active')].map(e => e.textContent);
      const c = tdSelStageAll('before');
      return { a, b, types, chips, c, left: _pcSelRows().map(p => p.type) };
    });
    expect(r.a).toBe(2);
    expect(r.b).toBe(4);
    expect(r.types).toEqual(['after', 'after', 'before', 'before']);
    expect(r.chips).toEqual(['All Before 2', 'All After 2']);
    expect(r.c).toBe(2);
    expect(r.left).toEqual(['after', 'after']);
  });

  test('tdSelStageAll outside select mode, or on a stage nobody shot, does nothing', async () => {
    const r = await page.evaluate(() => {
      tdPhotoOpenPlace('4835 ne kincaid rd, topeka, ks');
      const off = tdSelStageAll('before');
      tdSelectMode(true);
      return { off, none: tdSelStageAll('nope'), empty: tdSelStageAll(), n: _pcSelRows().length };
    });
    expect(r).toEqual({ off: false, none: false, empty: false, n: 0 });
  });

  // ── 5. The snapshot link ────────────────────────────────────────────────
  // A storage stub that records what was written, and can be told to fail.
  const withStorage = async (fn, arg) => page.evaluate(async ([fnSrc, a]) => {
    const saved = { supa: _supa, user: _supaUser, en: window.supaEnabled, loc: window._phgLastSms };
    const writes = [];
    try {
      window.supaEnabled = () => true;
      _supaUser = { id: '987ebc83-1567-49e1-9dd3-b89b0cf9121b' };
      _supa = Object.assign({}, _supa || {}, { storage: { from: (bucket) => ({
        upload: async (key, body) => { writes.push({ bucket, key, body: JSON.parse(body) }); return a && a.fail ? { error: { message: 'Fetch is aborted' } } : { data: { path: key }, error: null }; },
        getPublicUrl: (k) => ({ data: { publicUrl: 'https://cdn.test/' + k } }),
      }) } });
      window._phgLastSms = '';
      const out = await (eval(fnSrc))(a);
      return { out, writes, sms: window._phgLastSms };
    } finally {
      _supa = saved.supa; _supaUser = saved.user; window.supaEnabled = saved.en;
    }
  }, [fn.toString(), arg || null]);

  test('the link holds exactly the picked photos, as they are now', async () => {
    const r = await withStorage(async () => tdPhotoLinkCreate(photos.filter(p => p.client_id === 71 && p.type === 'before').map(p => p.id), '4835 NE Kincaid Rd, Topeka, KS'));
    expect(r.writes.length).toBe(1);
    expect(r.writes[0].bucket).toBe('proposals');
    expect(r.writes[0].key).toMatch(/^photo-share\/987ebc83-1567-49e1-9dd3-b89b0cf9121b\/[0-9a-f]{32}\.json$/);
    expect(r.writes[0].body.photos.map(p => p.s)).toEqual(['before', 'before']);
    expect(r.writes[0].body.addr).toBe('4835 NE Kincaid Rd, Topeka, KS');
    expect(r.out.count).toBe(2);
    expect(r.out.url).toMatch(/photos\.html\?u=987ebc83-1567-49e1-9dd3-b89b0cf9121b&s=[0-9a-f]{32}$/);
  });

  test('a photo still uploading is left out of the link, and said to be', async () => {
    const r = await withStorage(async () => {
      photos[0].url = ''; photos[0].pendingUpload = true;
      return tdPhotoLinkCreate([photos[0].id, photos[1].id]);
    });
    expect(r.out.count).toBe(1);
    expect(r.out.skipped).toBe(1);
  });

  test('nothing uploaded, signed out, a failed upload: no link, and why', async () => {
    const none = await withStorage(async () => { photos.forEach(p => { p.url = ''; }); return tdPhotoLinkCreate(photos.map(p => p.id)); });
    expect(none.out).toEqual({ error: 'none' });
    expect(none.writes.length).toBe(0);
    const empty = await withStorage(async () => [await tdPhotoLinkCreate([]), await tdPhotoLinkCreate(null), await tdPhotoLinkCreate(['junk'])]);
    expect(empty.out).toEqual([{ error: 'none' }, { error: 'none' }, { error: 'none' }]);
    await page.evaluate(SEED); // the first case above emptied every url
    const failed = await withStorage(async () => tdPhotoLinkCreate([photos[0].id]), { fail: true });
    expect(failed.out).toEqual({ error: 'upload' });
    const off = await page.evaluate(async () => {
      const s = _supaUser; _supaUser = null;
      try { return await tdPhotoLinkCreate([photos[0].id]); } finally { _supaUser = s; }
    });
    expect(off).toEqual({ error: 'offline' });
  });

  test('two links made from the same photos are two different links', async () => {
    const r = await withStorage(async () => [await tdPhotoLinkCreate([photos[0].id]), await tdPhotoLinkCreate([photos[0].id])]);
    expect(r.out[0].url).not.toBe(r.out[1].url);
  });

  test('Text opens a menu first; Text Tracey sends the link to her number', async () => {
    const r = await withStorage(async () => {
      tdPhotoOpenPlace('4835 ne kincaid rd, topeka, ks');
      tdSelectMode(true); tdSelStageAll('before'); tdSelStageAll('after');
      const first = await tdSelText();
      const menuOpen = document.getElementById('pc-text-menu').classList.contains('open');
      const label = document.getElementById('pc-text-menu').textContent;
      const url = await tdSelText('client');
      return { first, menuOpen, label, url };
    });
    expect(r.out.first).toBe('');
    expect(r.out.menuOpen).toBe(true);
    expect(r.out.label).toContain('Text Tracey');
    expect(r.out.url).toMatch(/photos\.html\?u=/);
    expect(r.sms.startsWith('sms:7855551234?body=')).toBe(true);
    const body = decodeURIComponent(r.sms.split('body=')[1]);
    expect(body).toContain('4 photos from 4835 NE Kincaid Rd');
    expect(body).toContain(r.out.url);
  });

  test('Text someone else opens Messages with nobody filled in', async () => {
    const r = await withStorage(async () => {
      tdPhotoOpenPlace('4835 ne kincaid rd, topeka, ks');
      tdSelectMode(true); tdSelStageAll('after');
      return tdSelText('other');
    });
    expect(r.sms.startsWith('sms:&body=')).toBe(true);
  });

  test('a customer with no phone gets one choice, and nothing picked sends nothing', async () => {
    const r = await withStorage(async () => {
      tdPhotoOpenPlace('220 nw 43rd st, topeka, ks');
      tdSelectMode(true);
      const nothing = await tdSelText('client');
      tdSelStageAll('before');
      const label = document.getElementById('pc-text-menu').textContent;
      return { nothing, label };
    });
    expect(r.out.nothing).toBe('');
    expect(r.writes.length).toBe(0);
    expect(r.out.label).toBe('Choose who to text');
  });

  test('a failed upload sends no text', async () => {
    const r = await withStorage(async () => {
      tdPhotoOpenPlace('4835 ne kincaid rd, topeka, ks');
      tdSelectMode(true); tdSelStageAll('before');
      return tdSelText('client');
    }, { fail: true });
    expect(r.out).toBe('');
    expect(r.sms).toBe('');
  });

  test('no console errors on the Photos page or the Text path', async () => {
    await assertNoErrors(page, 'photos page');
  });
});

// ── 6. The page the customer opens ────────────────────────────────────────
test.describe('photos.html, the public photo page', () => {
  const SNAP = {
    v: 1, biz: 'Plumbing <b>Solutions</b>', addr: '4835 NE Kincaid Rd<script>alert(1)</script>, Topeka, KS', createdAt: '2026-09-24T18:00:00Z',
    photos: [
      { u: 'https://cdn.test/1.jpg', t: 'https://cdn.test/t1.jpg', s: 'before', at: '2026-09-23T19:30:00Z' },
      { u: 'https://cdn.test/2.jpg', t: '', s: 'after', at: '2026-09-23T19:50:00Z', c: 'New heater' },
      { u: 'javascript:alert(1)', s: 'after' },
      { u: 'https://cdn.test/3.jpg', s: 'mystery' },
    ],
  };
  const U = '987ebc83-1567-49e1-9dd3-b89b0cf9121b', S = '0123456789abcdef0123456789abcdef';
  const open = async (page, query, body) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    let hits = 0;
    await page.route('**/storage/v1/object/**', async route => {
      hits++;
      if (body === 404) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('https://cdn.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
    await page.goto('/photos.html' + query);
    await page.waitForSelector('#ps-body .ps-addr, #ps-body .ps-msg');
    return { errors, hits: () => hits };
  };

  test('draws the snapshot grouped by stage, and escapes what it was given', async ({ page }) => {
    const o = await open(page, '?u=' + U + '&s=' + S, SNAP);
    const r = await page.evaluate(() => ({
      biz: document.getElementById('ps-biz').textContent,
      addr: document.querySelector('.ps-addr').textContent,
      stages: [...document.querySelectorAll('.ps-stage')].map(e => e.textContent),
      cells: document.querySelectorAll('.ps-cell').length,
      scripts: document.querySelectorAll('#ps-body script, #ps-biz b').length,
      bleed: document.documentElement.scrollWidth <= innerWidth + 1,
    }));
    expect(r.biz).toBe('Plumbing <b>Solutions</b>');
    expect(r.addr).toBe('4835 NE Kincaid Rd<script>alert(1)</script>');
    expect(r.stages).toEqual(['Before · 1', 'After · 1', 'Photos · 1']);
    expect(r.cells).toBe(3);
    expect(r.scripts).toBe(0);
    expect(r.bleed).toBe(true);
    expect(o.errors).toEqual([]);
  });

  test('a tap opens the photo full screen, and Close puts it away', async ({ page }) => {
    await open(page, '?u=' + U + '&s=' + S, SNAP);
    await page.locator('.ps-cell').nth(1).click();
    const r = await page.evaluate(() => ({ src: document.querySelector('#ps-view img').getAttribute('src'), cap: document.querySelector('.ps-cap').textContent }));
    expect(r.src).toBe('https://cdn.test/2.jpg');
    expect(r.cap).toContain('New heater');
    await page.click('.ps-x');
    expect(await page.locator('#ps-view').count()).toBe(0);
    expect(await page.evaluate(() => [psOpen(99), psOpen(-1), psClose()])).toEqual([false, false, false]);
  });

  test('a bad or missing token never reaches storage and says the link is dead', async ({ page }) => {
    const o = await open(page, '?u=../../etc&s=' + S, SNAP);
    expect(await page.locator('.ps-msg').textContent()).toContain('expired');
    expect(o.hits()).toBe(0);
    const p = await page.evaluate(() => [psParams(''), psParams('?u=' + 'x'.repeat(36) + '&s=abc'), psParams(null)]);
    expect(p).toEqual([null, null, null]);
  });

  test('a link whose file is gone says so', async ({ page }) => {
    await open(page, '?u=' + U + '&s=' + S, 404);
    expect(await page.locator('.ps-msg').textContent()).toContain('expired');
  });

  test('a junk file draws the dead-link message, not a broken page', async ({ page }) => {
    const o = await open(page, '?u=' + U + '&s=' + S, { photos: 'nope' });
    expect(await page.locator('.ps-msg').textContent()).toContain('expired');
    expect(o.errors).toEqual([]);
  });
});
