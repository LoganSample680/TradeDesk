// @ts-check
// ── Put in the pocket, still sent (owner 2026-09-29) ─────────────────────────
//
// "it should send it right away, how can we wake the flush up." Jack shot a
// photo at Bill Lorson's at 12:10:25; one bar of signal took the upload to
// :40, the 2 second save wait ran out at :42 and he pocketed the phone at :44.
// The picture reached storage and the record that shows it did not, because
// iOS froze the page mid-save. Backgrounding only ever stashed unsynced work
// on the phone. Now any record the server has never seen is handed to iOS's
// background uploader (TdBgUp) the moment the page is hidden, and iOS finishes
// it with the app asleep.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

test.describe('a pocketed phone still sends what it just made', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => {};
      window.supaSaveToCloud = async () => {};
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Signed in, loaded, every row on the page already known to the server, and
  // a fake native uploader that records what it is handed.
  const setup = (extra) => page.evaluate((extra) => {
    window.__up = []; window.__flush = 0;
    _supa = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } };
    _supaUser = { id: 'jack-uid', email: 'j@t.com' };
    _supaCloudLoaded = true; _deliberateSignOut = false;
    window.supaEnabled = () => true;
    _flushSaveNow = () => { window.__flush++; };
    _bgUpPlugin = () => (extra && extra.web) ? null : ({ upload: async (o) => { window.__up.push(o); return { queued: true }; } });
    _syncedHash = {};
    for (const { t, get, tx } of _TD_TABLES) {
      const rows = (tx ? tx(get()) : get()) || [];
      _lastKnownIds[t] = new Set(rows.filter(r => r && r.id != null).map(r => String(r.id)));
    }
    if (typeof _syncTimer !== 'undefined' && _syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
  }, extra || null);
  const decode = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const cleanup = () => page.evaluate(() => {
    for (let i = photos.length - 1; i >= 0; i--) if (String(photos[i].id).startsWith('pk-')) photos.splice(i, 1);
  });
  test.afterEach(async () => { await cleanup(); });

  test('a new photo is handed to iOS as the same upsert the save sends', async () => {
    await setup();
    await page.evaluate(async () => {
      photos.push({ id: 'pk-1', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/progress-1.jpg', type: 'progress' });
      await _pocketFlush();
    });
    const up = await page.evaluate(() => window.__up);
    const photo = up.filter(o => /\/rest\/v1\/td_photos\?on_conflict=id,user_id$/.test(o.url));
    expect(photo.length, 'one hand-off for the photo table').toBe(1);
    expect(photo[0].method).toBe('POST');
    expect(photo[0].headers.Authorization).toBe('Bearer tok-1');
    expect(photo[0].headers.apikey).toBeTruthy();
    expect(photo[0].headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(photo[0].id.startsWith('r:td_photos:'), 'never mistaken for a photo file by the reconciler').toBe(true);
    const rows = decode(photo[0].b64);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('pk-1');
    expect(rows[0].user_id).toBe('jack-uid');
    expect(rows[0].data.storagePath).toBe('jack-uid/unfiled/progress-1.jpg');
    expect(rows[0].deleted_at).toBeNull();
    expect(up.length, 'nothing else on the page was new').toBe(1);
  });

  test('rows the server already has are not handed off again', async () => {
    await setup();
    await page.evaluate(async () => {
      photos.push({ id: 'pk-2', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/p2.jpg', type: 'after' });
      _lastKnownIds.td_photos.add('pk-2');
      await _pocketFlush();
    });
    expect(await page.evaluate(() => window.__up.length)).toBe(0);
  });

  test('a row synced this session but not yet swept into the known set is skipped too', async () => {
    await setup();
    await page.evaluate(async () => {
      photos.push({ id: 'pk-3', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/p3.jpg', type: 'after' });
      _syncedHash.td_photos = new Map([['pk-3', 'h']]);
      await _pocketFlush();
    });
    expect(await page.evaluate(() => window.__up.length)).toBe(0);
  });

  test('a GPS mileage leg is the server\'s and is never sent from the phone', async () => {
    // CLAUDE.md 17: geo_replace_day is the only writer of automatic rows, and
    // those legs are left out of the known set on purpose, so they look new.
    await setup();
    const n = await page.evaluate(async () => {
      mileage.push({ id: 'pk-gps', gps: true, date: '2026-09-29', miles: 3.1 });
      await _pocketFlush();
      const i = mileage.findIndex(m => m.id === 'pk-gps'); if (i >= 0) mileage.splice(i, 1);
      return window.__up.filter(o => /td_mileage/.test(o.url)).length;
    });
    expect(n).toBe(0);
  });

  test('a photo still uploading is left to its own queue', async () => {
    // No storagePath yet: the table's own tx keeps it out of every sync, and
    // a hand-off must never carry the base64 bytes in a record.
    await setup();
    await page.evaluate(async () => {
      photos.push({ id: 'pk-4', pendingUpload: true, data: 'data:image/jpeg;base64,AAAA', type: 'before' });
      await _pocketFlush();
    });
    expect(await page.evaluate(() => window.__up.length)).toBe(0);
  });

  test('a save still waiting out its 2 seconds goes now', async () => {
    await setup();
    const n = await page.evaluate(async () => {
      _syncTimer = setTimeout(() => {}, 60000);
      await _pocketFlush();
      const r = window.__flush; clearTimeout(_syncTimer); _syncTimer = null; return r;
    });
    expect(n).toBe(1);
  });

  test('no waiting save, no second save started beside one in flight', async () => {
    await setup();
    expect(await page.evaluate(async () => { await _pocketFlush(); return window.__flush; })).toBe(0);
  });

  test('a web browser with no native uploader just saves, and never throws', async () => {
    await setup({ web: true });
    const r = await page.evaluate(async () => {
      photos.push({ id: 'pk-5', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/p5.jpg', type: 'after' });
      try { await _pocketFlush(); return 'ok'; } catch (e) { return String(e); }
    });
    expect(r).toBe('ok');
    expect(await page.evaluate(() => window.__up.length)).toBe(0);
  });

  test('signed out, signing out, not loaded or read-only: nothing is sent', async () => {
    for (const bad of ['_supaUser = null', '_deliberateSignOut = true', '_supaCloudLoaded = false', 'window.opsReadOnly = () => true']) {
      await setup();
      const n = await page.evaluate(async (bad) => {
        photos.push({ id: 'pk-6', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/p6.jpg', type: 'after' });
        eval(bad);
        await _pocketFlush();
        _deliberateSignOut = false; delete window.opsReadOnly;
        return window.__up.length;
      }, bad);
      expect(n, bad).toBe(0);
      await cleanup();
    }
  });

  test('no session token: nothing is handed off', async () => {
    await setup();
    const n = await page.evaluate(async () => {
      _supa = { auth: { getSession: async () => ({ data: { session: null } }) } };
      photos.push({ id: 'pk-7', url: 'https://x/p.jpg', storagePath: 'jack-uid/unfiled/p7.jpg', type: 'after' });
      await _pocketFlush();
      return window.__up.length;
    });
    expect(n).toBe(0);
  });

  test('pocketing the phone is what fires it', async () => {
    const r = await page.evaluate(async () => {
      let called = 0; const keep = _pocketFlush;
      _pocketFlush = async () => { called++; };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      _pocketFlush = keep;
      return called;
    });
    expect(r).toBeGreaterThanOrEqual(1);
  });

  test('a finished photo upload saves its record now, not after the wait', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-capture.js'), 'utf8');
    const at = src.indexOf("_pcTel('photo_uploaded',row);");
    const block = src.slice(src.lastIndexOf('_pcFinishTwin(row);', at), at);
    expect(block).toContain("if(typeof _syncTimer!=='undefined'&&_syncTimer&&typeof _flushSaveNow==='function')_flushSaveNow();");
  });

  test('no console errors, pocket flush', async () => { assertNoErrors(page); });
});
