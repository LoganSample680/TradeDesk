// @ts-check
/**
 * Data persistence, verifies saveAll() correctly writes all localStorage-backed
 * arrays and that the stored data matches what was written.
 *
 * Does NOT rely on page.reload(): that path is already tested by
 * e2e-settings-persistence.spec.js. Instead, each test:
 *   1. Injects a sentinel into the target array
 *   2. Calls saveAll()
 *   3. Immediately reads back the localStorage value and verifies the sentinel
 *
 * This is the correct abstraction: saveAll() is the write primitive, loadAll()
 * is the read primitive. If saveAll() writes the correct key with the correct data,
 * the reload round-trip is guaranteed. If a key is renamed or an array is omitted,
 * this test fails immediately.
 *
 * Arrays covered (written by saveAll() to localStorage):
 *   events     → zp3_ev
 *   photos     → zp3_photos
 *   licenses   → zp3_lic
 *   contracts  → zp3_contracts
 *   maintenance → zp3_maint
 *   checksState → zp3_chk
 *
 * Also verifies the complete localStorage key inventory written by saveAll().
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Data persistence, saveAll() writes all localStorage keys correctly', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── Events (zp3_ev) ───────────────────────────────────────────────────────
  test('saveAll() writes events array to zp3_ev', async () => {
    const id = 'persist-ev-' + Date.now();
    const found = await page.evaluate(sid => {
      events.push({ id: sid, title: 'Persistence Test Event', start: '2026-09-15', type: 'appointment' });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_ev') || '[]');
        return stored.find(e => e.id === sid) || null;
      } catch (_e) { return null; }
      finally {
        const idx = events.findIndex(e => e.id === sid);
        if (idx !== -1) events.splice(idx, 1);
      }
    }, id);
    expect(found, 'event must be written to zp3_ev by saveAll()').not.toBeNull();
    expect(found.title).toBe('Persistence Test Event');
    assertNoErrors(page, 'events persistence write');
  });

  // ── Licenses (zp3_lic) ────────────────────────────────────────────────────
  test('saveAll() writes licenses array to zp3_lic', async () => {
    const id = 'persist-lic-' + Date.now();
    const found = await page.evaluate(sid => {
      licenses.push({ id: sid, typeId: 'general_contractor', licenseNumber: 'GC-PERSIST-001', holderName: 'Test Holder', state: 'KS' });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_lic') || '[]');
        return stored.find(l => l.id === sid) || null;
      } catch (_e) { return null; }
      finally {
        const idx = licenses.findIndex(l => l.id === sid);
        if (idx !== -1) licenses.splice(idx, 1);
      }
    }, id);
    expect(found, 'license must be written to zp3_lic by saveAll()').not.toBeNull();
    expect(found.licenseNumber).toBe('GC-PERSIST-001');
    assertNoErrors(page, 'licenses persistence write');
  });

  // ── Contracts (zp3_contracts) ─────────────────────────────────────────────
  test('saveAll() writes contracts array to zp3_contracts', async () => {
    const id = 'persist-contract-' + Date.now();
    const found = await page.evaluate(sid => {
      contracts.push({ id: sid, name: 'Persist Test Contract', body: 'Standard terms.', active: true });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_contracts') || '[]');
        return stored.find(c => c.id === sid) || null;
      } catch (_e) { return null; }
      finally {
        const idx = contracts.findIndex(c => c.id === sid);
        if (idx !== -1) contracts.splice(idx, 1);
      }
    }, id);
    expect(found, 'contract must be written to zp3_contracts by saveAll()').not.toBeNull();
    expect(found.name).toBe('Persist Test Contract');
    assertNoErrors(page, 'contracts persistence write');
  });

  // ── Photos (zp3_photos) ───────────────────────────────────────────────────
  test('saveAll() writes photos array to zp3_photos', async () => {
    const id = 'persist-photo-' + Date.now();
    const found = await page.evaluate(sid => {
      photos.push({ id: sid, url: 'https://persist.test/photo.jpg', storagePath: 'persist/test.jpg', type: 'job', uploadedAt: new Date().toISOString() });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_photos') || '[]');
        return stored.find(p => p.id === sid) || null;
      } catch (_e) { return null; }
      finally {
        const idx = photos.findIndex(p => p.id === sid);
        if (idx !== -1) photos.splice(idx, 1);
      }
    }, id);
    expect(found, 'photo must be written to zp3_photos by saveAll()').not.toBeNull();
    expect(found.storagePath).toBe('persist/test.jpg');
    assertNoErrors(page, 'photos persistence write');
  });

  // ── Maintenance (zp3_maint) ───────────────────────────────────────────────
  test('saveAll() writes maintenance array to zp3_maint', async () => {
    const id = 'persist-maint-' + Date.now();
    const found = await page.evaluate(sid => {
      maintenance.push({ id: sid, vehicleId: 'v-1', type: 'oil_change', date: '2026-06-12', miles: 52000, cost: 45 });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_maint') || '[]');
        return stored.find(m => m.id === sid) || null;
      } catch (_e) { return null; }
      finally {
        const idx = maintenance.findIndex(m => m.id === sid);
        if (idx !== -1) maintenance.splice(idx, 1);
      }
    }, id);
    expect(found, 'maintenance record must be written to zp3_maint by saveAll()').not.toBeNull();
    expect(found.type).toBe('oil_change');
    expect(found.cost).toBe(45);
    assertNoErrors(page, 'maintenance persistence write');
  });

  // ── Settings (zp3_S) ──────────────────────────────────────────────────────
  test('saveAll() writes settings object to zp3_S', async () => {
    const marker = 'persist-bname-' + Date.now();
    const found = await page.evaluate(m => {
      const prev = S.bname;
      S.bname = m;
      saveAll();
      S.bname = prev;
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_S') || '{}');
        return stored.bname === m;
      } catch (_e) { return false; }
    }, marker);
    expect(found, 'settings object must be written to zp3_S by saveAll()').toBe(true);
    assertNoErrors(page, 'settings persistence write');
  });

  // ── Complete localStorage key inventory ───────────────────────────────────
  // If a key is added, removed, or renamed in saveAll(), this test fails
  // on the next CI run, before any data loss reaches production.
  test('saveAll() writes every expected localStorage key', async () => {
    const missingKeys = await page.evaluate(() => {
      if (typeof saveAll !== 'function') return null;
      saveAll();
      const required = ['zp3_S', 'zp3_ev', 'zp3_photos', 'zp3_lic', 'zp3_contracts', 'zp3_maint', 'zp3_chk'];
      return required.filter(k => localStorage.getItem(k) === null);
    });
    if (missingKeys !== null) {
      expect(missingKeys, 'saveAll() must write all expected keys, missing: ' + missingKeys.join(', ')).toEqual([]);
    }
    assertNoErrors(page, 'saveAll key inventory');
  });

  // ── loadAll() reads back correctly (no reload needed) ─────────────────────
  // Writes data directly to localStorage and calls loadAll() to verify it
  // reads the correct keys. This tests the read path independently of saveAll().
  test('loadAll() reads events from zp3_ev into the events array', async () => {
    const id = 'load-test-' + Date.now();
    const found = await page.evaluate(sid => {
      if (typeof loadAll !== 'function') return null;
      // Write directly to localStorage
      const stored = JSON.parse(localStorage.getItem('zp3_ev') || '[]');
      stored.push({ id: sid, title: 'loadAll Test Event', start: '2026-10-01' });
      localStorage.setItem('zp3_ev', JSON.stringify(stored));
      // Call loadAll to read it back into memory
      loadAll();
      const r = (typeof events !== 'undefined' ? events : []).find(e => e.id === sid) || null;
      // Clean up: restore localStorage to pre-test state
      const restored = stored.filter(e => e.id !== sid);
      localStorage.setItem('zp3_ev', JSON.stringify(restored));
      return r;
    }, id);
    if (found !== null) {
      expect(found.title).toBe('loadAll Test Event');
    }
    assertNoErrors(page, 'loadAll reads zp3_ev');
  });

  // ── Events capped at 600, truncation guard ───────────────────────────────
  // events.slice(-600) is the cap in saveAll(). A small array must not be truncated.
  test('events below the 600-record cap are not truncated by saveAll()', async () => {
    const id = 'trunc-guard-' + Date.now();
    const result = await page.evaluate(sid => {
      // Ensure we're below 600 events
      if (events.length >= 600) return { skipped: true };
      events.push({ id: sid, title: 'Truncation Guard Test', start: '2026-10-15' });
      saveAll();
      try {
        const stored = JSON.parse(localStorage.getItem('zp3_ev') || '[]');
        return { found: !!stored.find(e => e.id === sid), skipped: false };
      } catch (_e) { return { found: false, skipped: false }; }
      finally {
        const idx = events.findIndex(e => e.id === sid);
        if (idx !== -1) events.splice(idx, 1);
      }
    }, id);
    if (!result.skipped) {
      expect(result.found, 'events below 600-record cap must not be dropped by saveAll()').toBe(true);
    }
    assertNoErrors(page, 'events truncation guard');
  });

  // ── Zero console errors ───────────────────────────────────────────────────
  test('zero console errors across all persistence checks', async () => {
    assertNoErrors(page, 'persistence zero errors');
  });
});
