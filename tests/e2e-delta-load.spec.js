// @ts-check
/**
 * DELTA-LOAD safety unit coverage (cloud.js incremental cold-load).
 *
 * The end-to-end delta MERGE (pull only changed rows, propagate soft-deletes,
 * reconcile multi-device) runs against the real updated_at trigger and is proven
 * on the cloud gate (the concurrency race specs). What's proven HERE — offline,
 * deterministically — is the safety layer that must never regress:
 *   • owner-scoping: one account can NEVER read another account's delta sidecar
 *     or cache (cross-account bleed is the worst-case failure).
 *   • persistence: the cursor + known-cloud hashes are written only once a cursor
 *     exists, and read back intact.
 *   • cache paint: the cached snapshot repaints the live arrays in place.
 *
 * All helpers are globals in cloud.js: _readDeltaMeta / _paintCacheForDelta /
 * _writeLocalCache are function-declared (on window); _deltaCursor / _syncedHash /
 * _supaUser / _loadedDataOwner / bids are `let` lexicals (bare-name in evaluate).
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('delta-load — safety layer', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test.describe('_readDeltaMeta — owner guard', () => {
    test('returns the sidecar for the matching owner', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_delta_meta', JSON.stringify({ _owner: 'u1', cursor: '2026-01-01T00:00:00Z', syncedHash: {} }));
        const m = _readDeltaMeta('u1');
        return { cursor: m && m.cursor };
      });
      expect(r.cursor).toBe('2026-01-01T00:00:00Z');
    });

    test('returns null for a DIFFERENT owner (no cross-account bleed)', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_delta_meta', JSON.stringify({ _owner: 'u1', cursor: '2026-01-01T00:00:00Z', syncedHash: {} }));
        return _readDeltaMeta('u2');
      });
      expect(r).toBe(null);
    });

    test('returns null when the cursor is missing', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_delta_meta', JSON.stringify({ _owner: 'u1', syncedHash: {} }));
        return _readDeltaMeta('u1');
      });
      expect(r).toBe(null);
    });

    test('returns null on corrupt JSON (falls back to full load)', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_delta_meta', '{bad json{{');
        let threw = null, out;
        try { out = _readDeltaMeta('u1'); } catch (e) { threw = e.message; }
        return { threw, out };
      });
      expect(r.threw).toBe(null);
      expect(r.out).toBe(null);
    });
  });

  test.describe('_paintCacheForDelta — repaint base, owner-scoped', () => {
    test('paints the cached arrays in place for the matching owner', async () => {
      const r = await page.evaluate(() => {
        const saved = bids.slice();
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: 'u1', bids: [{ id: 'b9', amount: 42 }], clients: [], jobs: [] }));
        const ok = _paintCacheForDelta('u1');
        const painted = bids.map(b => b.id);
        // restore
        bids.length = 0; saved.forEach(b => bids.push(b));
        return { ok, painted };
      });
      expect(r.ok).toBe(true);
      expect(r.painted).toContain('b9');
    });

    test('refuses to paint another owner’s cache (returns false, no bleed)', async () => {
      const r = await page.evaluate(() => {
        const saved = bids.slice();
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: 'someone-else', bids: [{ id: 'LEAK', amount: 1 }] }));
        const ok = _paintCacheForDelta('u1');
        const leaked = bids.some(b => b.id === 'LEAK');
        bids.length = 0; saved.forEach(b => bids.push(b));
        return { ok, leaked };
      });
      expect(r.ok).toBe(false);
      expect(r.leaked).toBe(false);
    });

    test('returns false when there is no cache', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('zp3_cloud_cache');
        return _paintCacheForDelta('u1');
      });
      expect(r).toBe(false);
    });
  });

  test.describe('_writeLocalCache — delta sidecar persistence', () => {
    test('writes owner+cursor+syncedHash once a cursor exists', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser, savedCursor = _deltaCursor, savedHash = _syncedHash;
        window._supaUser = { id: 'u1' };
        _deltaCursor = '2026-02-02T00:00:00Z';
        _syncedHash = { td_bids: new Map([['b1', 'abc']]) };
        localStorage.removeItem('zp3_delta_meta');
        _writeLocalCache();
        const meta = JSON.parse(localStorage.getItem('zp3_delta_meta') || 'null');
        window._supaUser = savedUser; _deltaCursor = savedCursor; _syncedHash = savedHash;
        return meta;
      });
      expect(r && r._owner).toBe('u1');
      expect(r && r.cursor).toBe('2026-02-02T00:00:00Z');
      expect(r && r.syncedHash && r.syncedHash.td_bids).toEqual([['b1', 'abc']]);
    });

    test('does NOT write a sidecar when there is no cursor yet', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser, savedCursor = _deltaCursor;
        window._supaUser = { id: 'u1' };
        _deltaCursor = null;
        localStorage.removeItem('zp3_delta_meta');
        _writeLocalCache();
        const meta = localStorage.getItem('zp3_delta_meta');
        window._supaUser = savedUser; _deltaCursor = savedCursor;
        return meta;
      });
      expect(r).toBe(null);
    });

    test('round-trips: a written sidecar reads back for its owner only', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser, savedCursor = _deltaCursor, savedHash = _syncedHash;
        window._supaUser = { id: 'roundtrip-owner' };
        _deltaCursor = '2026-03-03T00:00:00Z';
        _syncedHash = { td_jobs: new Map([['j1', 'zzz']]) };
        _writeLocalCache();
        const mine = _readDeltaMeta('roundtrip-owner');
        const theirs = _readDeltaMeta('other-owner');
        window._supaUser = savedUser; _deltaCursor = savedCursor; _syncedHash = savedHash;
        return { mineCursor: mine && mine.cursor, theirs };
      });
      expect(r.mineCursor).toBe('2026-03-03T00:00:00Z');
      expect(r.theirs).toBe(null);
    });
  });

  test('no console errors during delta-load safety tests', async () => {
    assertNoErrors(page, 'delta-load safety');
  });
});
