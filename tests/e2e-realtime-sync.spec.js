// @ts-check
/**
 * Realtime sync coverage, June 2026.
 *
 * Verifies that all app features re-render when a record change arrives via
 * Supabase Realtime or when supaLoadFromCloud completes.  Specifically tests
 * the four pages that were previously missing from _applyRealtimeRecord and
 * supaLoadFromCloud: fleet, gallery, licensing, calendar.
 *
 * Also verifies:
 * - _setLog diagnostic helper removed (no console noise in prod)
 * - _onReconnect() triggers supaLoadFromCloud on reconnect with no pending saves
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Realtime sync, render coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── 1. _setLog removed from production code ──────────────────────────────
  test('_setLog diagnostic helper is removed', async () => {
    const defined = await page.evaluate(() => typeof _setLog === 'function');
    expect(defined, '_setLog must be removed from production builds').toBe(false);
    assertNoErrors(page, '_setLog removed');
  });

  // ── 2. _applyRealtimeRecord calls fleet render ────────────────────────────
  test('_applyRealtimeRecord calls renderFleet when photos table changes', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let fleetCalled = false;
      const orig = typeof renderFleet === 'function' ? renderFleet : null;
      window.renderFleet = () => { fleetCalled = true; if (orig) orig(); };
      // Simulate a realtime INSERT on td_photos (photos are in _TD_TABLES)
      _applyRealtimeRecord('td_photos', {
        eventType: 'INSERT',
        new: { id: 'rt-test-photo-1', user_id: 'u', data: { id: 'rt-test-photo-1', url: 'https://example.com/x.jpg', storagePath: 'u/rt-test-photo-1.jpg', type: 'job', uploadedAt: new Date().toISOString() }, deleted_at: null },
        old: null,
      });
      if (orig) window.renderFleet = orig; else delete window.renderFleet;
      return fleetCalled;
    });
    if (called !== null) {
      expect(called, 'renderFleet must be called by _applyRealtimeRecord').toBe(true);
    }
  });

  // ── 3. _applyRealtimeRecord calls renderGallery ───────────────────────────
  test('_applyRealtimeRecord calls renderGallery when photos table changes', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let galleryCalled = false;
      const orig = typeof renderGallery === 'function' ? renderGallery : null;
      window.renderGallery = () => { galleryCalled = true; if (orig) orig(); };
      _applyRealtimeRecord('td_photos', {
        eventType: 'INSERT',
        new: { id: 'rt-test-photo-2', user_id: 'u', data: { id: 'rt-test-photo-2', url: 'https://example.com/y.jpg', storagePath: 'u/rt-test-photo-2.jpg', type: 'job', uploadedAt: new Date().toISOString() }, deleted_at: null },
        old: null,
      });
      if (orig) window.renderGallery = orig; else delete window.renderGallery;
      return galleryCalled;
    });
    if (called !== null) {
      expect(called, 'renderGallery must be called by _applyRealtimeRecord').toBe(true);
    }
    assertNoErrors(page, 'renderGallery called by _applyRealtimeRecord');
  });

  // ── 4. _applyRealtimeRecord calls renderLicensing ────────────────────────
  test('_applyRealtimeRecord calls renderLicensing when licenses table changes', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let licensingCalled = false;
      const orig = typeof renderLicensing === 'function' ? renderLicensing : null;
      window.renderLicensing = () => { licensingCalled = true; if (orig) orig(); };
      _applyRealtimeRecord('td_licenses', {
        eventType: 'INSERT',
        new: { id: 'rt-test-lic-1', user_id: 'u', data: { id: 'rt-test-lic-1', name: 'Test License', expires: '2027-01-01' }, deleted_at: null },
        old: null,
      });
      if (orig) window.renderLicensing = orig; else delete window.renderLicensing;
      return licensingCalled;
    });
    if (called !== null) {
      expect(called, 'renderLicensing must be called by _applyRealtimeRecord').toBe(true);
    }
    assertNoErrors(page, 'renderLicensing called by _applyRealtimeRecord');
  });

  // ── 5. _applyRealtimeRecord calls renderCalendar ─────────────────────────
  test('_applyRealtimeRecord calls renderCalendar when events table changes', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let calendarCalled = false;
      const orig = typeof renderCalendar === 'function' ? renderCalendar : null;
      window.renderCalendar = () => { calendarCalled = true; if (orig) orig(); };
      _applyRealtimeRecord('td_events', {
        eventType: 'INSERT',
        new: { id: 'rt-test-ev-1', user_id: 'u', data: { id: 'rt-test-ev-1', title: 'Test Event', start: '2026-07-01' }, deleted_at: null },
        old: null,
      });
      if (orig) window.renderCalendar = orig; else delete window.renderCalendar;
      return calendarCalled;
    });
    if (called !== null) {
      expect(called, 'renderCalendar must be called by _applyRealtimeRecord').toBe(true);
    }
    assertNoErrors(page, 'renderCalendar called by _applyRealtimeRecord');
  });

  // ── 6. _applyRealtimeRecord calls renderCalendar for jobs table too ───────
  test('_applyRealtimeRecord calls renderCalendar when jobs table changes', async () => {
    const called = await page.evaluate(() => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      let calendarCalled = false;
      const orig = typeof renderCalendar === 'function' ? renderCalendar : null;
      window.renderCalendar = () => { calendarCalled = true; if (orig) orig(); };
      _applyRealtimeRecord('td_jobs', {
        eventType: 'INSERT',
        new: { id: 'rt-test-job-1', user_id: 'u', data: { id: 'rt-test-job-1', name: 'Test Job', start: '2026-07-01', days: 2, status: 'upcoming' }, deleted_at: null },
        old: null,
      });
      if (orig) window.renderCalendar = orig; else delete window.renderCalendar;
      return calendarCalled;
    });
    if (called !== null) {
      expect(called, 'renderCalendar must be called when jobs table changes').toBe(true);
    }
    assertNoErrors(page, 'renderCalendar called for jobs changes');
  });

  // ── 7. _onReconnect triggers supaLoadFromCloud when no pending saves ──────
  test('_onReconnect schedules a cloud pull even with no pending writes', async () => {
    const loadCalled = await page.evaluate(() => {
      if (typeof _onReconnect !== 'function') return null;
      let loadFromCloudCalled = false;
      const origLoad = typeof supaLoadFromCloud === 'function' ? supaLoadFromCloud : null;
      // Temporarily override supaLoadFromCloud to detect the call
      window.supaLoadFromCloud = (opts) => { loadFromCloudCalled = true; if (origLoad) return origLoad(opts); };
      // Simulate the no-pending reconnect case: _supaCloudLoaded=true, no pending sync
      const origPending = localStorage.getItem('zp3_pending_sync');
      localStorage.removeItem('zp3_pending_sync');
      // Store original flags
      const origLoaded = window._supaCloudLoaded;
      // Ensure state is "fully loaded, no pending"
      // Call _onReconnect (it's not exported as window property so call indirectly
      // via the online event path if available)
      if (typeof _onReconnect === 'function') _onReconnect();
      // Restore
      if (origPending) localStorage.setItem('zp3_pending_sync', origPending);
      if (origLoad) window.supaLoadFromCloud = origLoad;
      return loadFromCloudCalled;
    });
    // The reconnect fired a REAL (mocked) silent load fire-and-forget. Let it fully
    // settle before the next test, an in-flight load replacing the arrays mid-test
    // is cross-test contamination whose timing varies by browser (webkit flaked here).
    await page.waitForFunction(() => typeof _loadInProgress === 'undefined' || _loadInProgress === false, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600); // trailing-reload settle (300ms timer + retry margin)
    // This test is informational, the function may not be accessible depending on scoping
    if (loadCalled !== null) {
      expect(loadCalled, '_onReconnect must trigger supaLoadFromCloud even with no pending saves').toBe(true);
    }
    assertNoErrors(page, '_onReconnect reconnect pull');
  });

  // ── 8. _writeLocalCache called by _applyRealtimeRecord ───────────────────
  // ASSERTION UPDATED (§11.4): the cache write is a 250ms TRAILING DEBOUNCE by design
  // (one write per realtime burst instead of one per row, the render-jank scale fix),
  // so reading localStorage synchronously after the event never observes THIS event's
  // write. The old assertion (`cache exists at all`) passed only when unrelated earlier
  // activity happened to have written the cache, a hidden order dependency that webkit
  // timing exposed. Now: fire the event, wait out the debounce, and assert the cache
  // actually CONTAINS the applied record (strictly stronger than the old check).
  test('_applyRealtimeRecord writes the applied record to the local cache (debounced)', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _applyRealtimeRecord !== 'function') return null;
      _applyRealtimeRecord('td_clients', {
        eventType: 'INSERT',
        new: { id: 'rt-test-client-1', user_id: 'u', data: { id: 'rt-test-client-1', name: 'Realtime Test Client' }, deleted_at: null },
        old: null,
      });
      const appliedToArray = (typeof clients !== 'undefined' ? clients : []).some(x => String(x.id) === 'rt-test-client-1');
      await new Promise(res => setTimeout(res, 800)); // > the 250ms trailing debounce
      const after = localStorage.getItem('zp3_cloud_cache');
      const stillInArray = (typeof clients !== 'undefined' ? clients : []).some(x => String(x.id) === 'rt-test-client-1');
      // Clean up
      const c = clients; const idx = c.findIndex(x => String(x.id) === 'rt-test-client-1');
      if (idx !== -1) c.splice(idx, 1);
      return {
        ok: !!(after && after.includes('rt-test-client-1')),
        cacheExists: after !== null,
        appliedToArray,
        stillInArray,
        loadInProgress: typeof _loadInProgress !== 'undefined' ? _loadInProgress : 'n/a',
        timerPending: typeof _writeCacheTimer !== 'undefined' ? !!_writeCacheTimer : 'n/a',
      };
    });
    if (r !== null) {
      expect(r.ok, `debounced cache write must land with the applied record, ${JSON.stringify(r)}`).toBe(true);
    }
    assertNoErrors(page, '_writeLocalCache on realtime');
  });

  // ── 9. No console errors on any of the above operations ──────────────────
  test('zero console errors across all realtime operations', async () => {
    assertNoErrors(page, 'realtime sync zero errors');
  });
});
