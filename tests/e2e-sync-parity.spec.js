// @ts-check
/**
 * Sync parity tests — derived from the source of truth, not from bug reports.
 *
 * The previous test class (e2e-realtime-sync.spec.js) was "bug-shaped": it
 * enumerated the specific render functions we knew were missing. That means it
 * can only catch bugs we already found. These tests instead derive assertions
 * directly from _TD_TABLES and the global render* namespace, so:
 *
 *   - Adding a new table to _TD_TABLES automatically tests offline persistence
 *   - Adding a new render function automatically checks dispatch coverage
 *   - Neither requires updating the test file
 *
 * Coverage:
 *   1. Every _TD_TABLES entry is serialized into zp3_offline_pending
 *   2. _applyRealtimeRecord fires at least one page render for every table
 *   3. renderDashActiveLiens and renderClientDetail are in the dispatch set
 *   4. _mergeOfflinePendingToMemory restores every table, not just clients/bids/jobs
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Sync parity — auto-discovered from _TD_TABLES', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── 1. Every _TD_TABLES entry lands in zp3_offline_pending ───────────────
  // This is the exhaustive version of the offline-pending coverage test.
  // Seeds a sentinel into every live array, triggers the pending write,
  // then asserts no table's sentinel was silently dropped.
  test('every _TD_TABLES entry is written to zp3_offline_pending', async () => {
    const missing = await page.evaluate(() => {
      if (typeof _TD_TABLES === 'undefined') return null;

      // Seed a unique sentinel into each table's array.
      // td_photos write is filtered to entries with storagePath||url, so include both.
      const sentinelId = 'parity-sentinel-' + Date.now();
      _TD_TABLES.forEach(({ t, get }) => {
        const rec = t === 'td_photos'
          ? { id: sentinelId, storagePath: 'parity/test.jpg', url: 'https://parity.test/img.jpg' }
          : { id: sentinelId };
        get().push(rec);
      });

      // supaSaveDebounced() is gated on supaEnabled() (function → on window) and
      // _supaCloudLoaded / _supaUser (let → in global lexical env, NOT on window).
      // Force all three open so the synchronous localStorage write executes.
      const _origEnabled = window.supaEnabled;
      const _origLoaded = typeof _supaCloudLoaded !== 'undefined' ? _supaCloudLoaded : false;
      const _origUser = typeof _supaUser !== 'undefined' ? _supaUser : null;
      window.supaEnabled = () => true;
      try { _supaCloudLoaded = true; } catch (_e) {}
      try { if (!_supaUser) _supaUser = { id: 'parity-test' }; } catch (_e) {}
      try { supaSaveDebounced(); } catch (_e) {}
      window.supaEnabled = _origEnabled;
      try { _supaCloudLoaded = _origLoaded; } catch (_e) {}
      try { _supaUser = _origUser; } catch (_e) {}

      // Read back what was written
      let op;
      try { op = JSON.parse(localStorage.getItem('zp3_offline_pending') || '{}'); } catch (_e) { op = {}; }

      // Find tables whose sentinel didn't make it into the pending blob
      const dropped = [];
      _TD_TABLES.forEach(({ t, get }) => {
        // camelCase key: td_time_entries → timeEntries
        const key = t.replace(/^td_/, '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const arr = op[key];
        if (!Array.isArray(arr) || !arr.some(r => String(r.id) === sentinelId)) {
          dropped.push(t);
        }
      });

      // Clean up sentinels
      _TD_TABLES.forEach(({ get }) => {
        const arr = get();
        const idx = arr.findIndex(r => String(r.id) === sentinelId);
        if (idx !== -1) arr.splice(idx, 1);
      });

      return dropped;
    });

    if (missing !== null) {
      expect(
        missing,
        `These tables were dropped from zp3_offline_pending: ${missing.join(', ')}`
      ).toEqual([]);
    }
    assertNoErrors(page, 'offline_pending parity');
  });

  // ── 2. _applyRealtimeRecord fires at least one render for every table ─────
  // For each table in _TD_TABLES, injects a synthetic INSERT event and asserts
  // that at least one render* function was called. This catches the "data in
  // memory but UI never updates" class of bug.
  test('_applyRealtimeRecord fires at least one render for every _TD_TABLES entry', async () => {
    const results = await page.evaluate(() => {
      if (typeof _TD_TABLES === 'undefined' || typeof _applyRealtimeRecord !== 'function') return null;

      // Spy on all global render* functions
      const renderNames = Object.getOwnPropertyNames(window)
        .filter(k => /^render[A-Z]/.test(k) && typeof window[k] === 'function');
      const originals = {};
      const callLog = {};
      renderNames.forEach(k => {
        originals[k] = window[k];
        callLog[k] = 0;
        window[k] = (...args) => { callLog[k]++; return originals[k](...args); };
      });

      const results = [];
      _TD_TABLES.forEach(({ t }) => {
        // Reset call counts
        renderNames.forEach(k => { callLog[k] = 0; });

        // Fire synthetic INSERT
        try {
          _applyRealtimeRecord(t, {
            eventType: 'INSERT',
            new: { id: 'rt-parity-' + t, user_id: 'u', data: { id: 'rt-parity-' + t }, deleted_at: null },
            old: null,
          });
        } catch (_e) {}

        const fired = renderNames.filter(k => callLog[k] > 0);
        results.push({ table: t, rendersTriggered: fired.length, renders: fired });
      });

      // Restore originals
      renderNames.forEach(k => { window[k] = originals[k]; });

      // Clean up inserted sentinels
      _TD_TABLES.forEach(({ t, get }) => {
        const arr = get();
        const idx = arr.findIndex(r => r.id === 'rt-parity-' + t);
        if (idx !== -1) arr.splice(idx, 1);
      });

      return results;
    });

    if (results !== null) {
      for (const { table, rendersTriggered, renders } of results) {
        expect(
          rendersTriggered,
          `Table ${table} triggered 0 renders — data synced but UI never updated. Renders fired: ${renders.join(', ')}`
        ).toBeGreaterThan(0);
      }
    }
    assertNoErrors(page, 'realtime render dispatch parity');
  });

  // ── 3. renderDashActiveLiens is in the dispatch set ───────────────────────
  test('_applyRealtimeRecord calls renderDashActiveLiens on td_liens change', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let hit = false;
      const orig = typeof renderDashActiveLiens === 'function' ? renderDashActiveLiens : null;
      window.renderDashActiveLiens = () => { hit = true; if (orig) orig(); };
      try {
        _applyRealtimeRecord('td_liens', {
          eventType: 'INSERT',
          new: { id: 'parity-lien-1', user_id: 'u', data: { id: 'parity-lien-1' }, deleted_at: null },
          old: null,
        });
      } catch (_e) {}
      if (orig) window.renderDashActiveLiens = orig; else delete window.renderDashActiveLiens;
      // Clean up
      const arr = liens; const idx = arr.findIndex(r => r.id === 'parity-lien-1'); if (idx !== -1) arr.splice(idx, 1);
      return hit;
    });
    if (called !== null) {
      expect(called, 'renderDashActiveLiens must be called when liens table changes').toBe(true);
    }
    assertNoErrors(page, 'renderDashActiveLiens dispatch');
  });

  // ── 4. _mergeOfflinePendingToMemory restores all tables, not just 3 ───────
  test('_mergeOfflinePendingToMemory restores every _TD_TABLES entry', async () => {
    const missing = await page.evaluate(() => {
      if (typeof _TD_TABLES === 'undefined' || typeof _mergeOfflinePendingToMemory !== 'function') return null;

      const sentinelId = 'merge-parity-sentinel-' + Date.now();
      const pending = { ts: Date.now() };

      // Build a fake offline_pending blob with a sentinel in every table
      _TD_TABLES.forEach(({ t }) => {
        const key = t.replace(/^td_/, '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        pending[key] = [{ id: sentinelId }];
      });

      // First: clear every array so merge actually adds something
      const snapshots = _TD_TABLES.map(({ get }) => [...get()]);
      _TD_TABLES.forEach(({ get }) => { get().length = 0; });

      // Write the fake pending and run the merge
      localStorage.setItem('zp3_offline_pending', JSON.stringify(pending));
      _mergeOfflinePendingToMemory();

      // Check which tables got the sentinel
      const dropped = [];
      _TD_TABLES.forEach(({ t, get }) => {
        if (!get().some(r => String(r.id) === sentinelId)) dropped.push(t);
      });

      // Restore original arrays and clean up
      _TD_TABLES.forEach(({ set }, i) => { set(snapshots[i]); });
      localStorage.removeItem('zp3_offline_pending');

      return dropped;
    });

    if (missing !== null) {
      expect(
        missing,
        `_mergeOfflinePendingToMemory didn't restore these tables: ${missing.join(', ')}`
      ).toEqual([]);
    }
    assertNoErrors(page, 'mergeOfflinePendingToMemory parity');
  });

  // ── 5. Zero console errors throughout ────────────────────────────────────
  test('zero console errors across all parity operations', async () => {
    assertNoErrors(page, 'sync parity zero errors');
  });
});
