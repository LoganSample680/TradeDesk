// @ts-check
/**
 * Owner spec 2026-07-17: Books exports (js/finance.js openExportPanel) and
 * Time Log exports (js/timelog.js _tlExportCSV) stay locked until a
 * contractor's TradeDesk subscription has completed 2 consecutive, unbroken
 * billing cycles, or the account is on the never-charge allowlist. The real
 * gate logic lives server-side (td_exports_unlocked RPC, see
 * supabase/migrations/20260804_platform_billing.sql, validated directly
 * against Postgres during development); these tests cover the client-side
 * plumbing that reads it: js/cloud.js's _fetchExportsUnlocked /
 * _isBillingExempt / _requireExportsUnlocked, and the two gated entry points.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Platform billing: export gate', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Installs a recording _supa.rpc stub that resolves whatever the caller
  // configures for a given RPC name, and swaps in a signed-in fake user.
  const installRpcStub = (responses) => page.evaluate((resp) => {
    window.__origSupa = window.__origSupa || _supa;
    window.__origSupaEnabled = window.__origSupaEnabled || supaEnabled;
    window.__origSupaUser = window.__origSupaUser || _supaUser;
    window.__rpcCalls = [];
    supaEnabled = () => true;
    _supaUser = { id: 'billing-test-uid' };
    _supa = {
      ...window.__origSupa,
      rpc: (name) => {
        window.__rpcCalls.push(name);
        const r = resp[name];
        return Promise.resolve(r && r.error ? { data: null, error: r.error } : { data: r, error: null });
      },
    };
    try { localStorage.removeItem('td_exports_unlocked_billing-test-uid'); } catch (_e) {}
  }, responses);

  const restore = () => page.evaluate(() => {
    if (window.__origSupa) _supa = window.__origSupa;
    if (window.__origSupaEnabled) supaEnabled = window.__origSupaEnabled;
    _supaUser = window.__origSupaUser;
    try { localStorage.removeItem('td_exports_unlocked_billing-test-uid'); } catch (_e) {}
  });

  test.describe('_fetchExportsUnlocked', () => {
    test('not signed in: returns false, no RPC call', async () => {
      const r = await page.evaluate(async () => {
        const savedUser = _supaUser, savedEnabled = supaEnabled;
        _supaUser = null;
        try { return await _fetchExportsUnlocked(); }
        finally { _supaUser = savedUser; supaEnabled = savedEnabled; }
      });
      expect(r).toBe(false);
    });

    test('RPC returns true: unlocked, and result is cached', async () => {
      await installRpcStub({ td_exports_unlocked: true });
      const r = await page.evaluate(async () => {
        const first = await _fetchExportsUnlocked();
        const callsAfterFirst = window.__rpcCalls.length;
        const second = await _fetchExportsUnlocked(); // should hit the cache, no second RPC call
        return { first, second, callsAfterFirst, callsAfterSecond: window.__rpcCalls.length };
      });
      expect(r.first).toBe(true);
      expect(r.second).toBe(true);
      expect(r.callsAfterSecond).toBe(r.callsAfterFirst);
      await restore();
    });

    test('RPC returns false: locked', async () => {
      await installRpcStub({ td_exports_unlocked: false });
      const r = await page.evaluate(() => _fetchExportsUnlocked());
      expect(r).toBe(false);
      await restore();
    });

    test('RPC errors: never fails open to true, keeps last known state', async () => {
      await installRpcStub({ td_exports_unlocked: { error: { message: 'network blip' } } });
      const r = await page.evaluate(async () => {
        _exportsUnlocked = false; // simulate a prior known-locked state
        return await _fetchExportsUnlocked();
      });
      expect(r).not.toBe(true);
      await restore();
    });
  });

  test.describe('_isBillingExempt', () => {
    test('exempt account: true', async () => {
      await installRpcStub({ td_billing_exempt: true });
      const r = await page.evaluate(() => _isBillingExempt());
      expect(r).toBe(true);
      await restore();
    });
    test('non-exempt account: false', async () => {
      await installRpcStub({ td_billing_exempt: false });
      const r = await page.evaluate(() => _isBillingExempt());
      expect(r).toBe(false);
      await restore();
    });
    test('not signed in: false, no throw', async () => {
      const r = await page.evaluate(async () => {
        const savedUser = _supaUser;
        _supaUser = null;
        try { return await _isBillingExempt(); }
        finally { _supaUser = savedUser; }
      });
      expect(r).toBe(false);
    });
  });

  test.describe('_requireExportsUnlocked', () => {
    test('unlocked account: returns true, no alert shown', async () => {
      await installRpcStub({ td_exports_unlocked: true });
      const r = await page.evaluate(async () => {
        let alerted = false;
        const orig = window.zAlert;
        window.zAlert = () => { alerted = true; };
        try { return { unlocked: await _requireExportsUnlocked(), alerted }; }
        finally { window.zAlert = orig; }
      });
      expect(r.unlocked).toBe(true);
      expect(r.alerted).toBe(false);
      await restore();
    });

    test('locked, never subscribed: returns false, shows a subscribe-oriented message', async () => {
      await installRpcStub({ td_exports_unlocked: false, td_billing_exempt: false });
      page.on('console', () => {}); // no-op, keeps a listener attached during override swap
      const r = await page.evaluate(async () => {
        let msg = null;
        const orig = window.zAlert;
        window.zAlert = (m) => { msg = m; };
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => null; // never subscribed
        try { return { unlocked: await _requireExportsUnlocked(), msg }; }
        finally { window.zAlert = orig; window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.unlocked).toBe(false);
      expect(r.msg).toContain('unlock');
      await restore();
    });

    test('locked, mid-way (1 of 2 cycles): returns false, message states progress', async () => {
      await installRpcStub({ td_exports_unlocked: false, td_billing_exempt: false });
      const r = await page.evaluate(async () => {
        let msg = null;
        const orig = window.zAlert;
        window.zAlert = (m) => { msg = m; };
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'active', consecutive_paid_cycles: 1 });
        try { return { unlocked: await _requireExportsUnlocked(), msg }; }
        finally { window.zAlert = orig; window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.unlocked).toBe(false);
      expect(r.msg).toContain('1 of 2');
      await restore();
    });

    test('always re-checks live, a stale cached "unlocked" cannot be reused after a lapse', async () => {
      // Seed a stale "unlocked" cache entry, then point the RPC at a locked
      // response — the gate must re-verify server-side, not trust the cache.
      await page.evaluate(() => {
        try { localStorage.setItem('td_exports_unlocked_billing-test-uid', JSON.stringify({ ts: Date.now(), data: true })); } catch (_e) {}
      });
      await installRpcStub({ td_exports_unlocked: false, td_billing_exempt: false });
      const r = await page.evaluate(async () => {
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'canceled', consecutive_paid_cycles: 0 });
        const origAlert = window.zAlert;
        window.zAlert = () => {};
        try { return await _requireExportsUnlocked(); }
        finally { window._fetchBillingStatus = origFetchStatus; window.zAlert = origAlert; }
      });
      expect(r, 'a lapsed subscription must re-lock even if a stale cache said unlocked').toBe(false);
      await restore();
    });
  });

  test.describe('openExportPanel is gated', () => {
    test('locked: the export panel never opens', async () => {
      await installRpcStub({ td_exports_unlocked: false, td_billing_exempt: false });
      const r = await page.evaluate(async () => {
        document.getElementById('export-panel')?.remove();
        const origAlert = window.zAlert;
        window.zAlert = () => {};
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => null;
        try {
          await openExportPanel();
          return { panelPresent: !!document.getElementById('export-panel') };
        } finally { window.zAlert = origAlert; window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.panelPresent).toBe(false);
      document.getElementById && await page.evaluate(() => document.getElementById('export-panel')?.remove());
      await restore();
    });

    test('unlocked: the export panel opens normally', async () => {
      await installRpcStub({ td_exports_unlocked: true });
      const r = await page.evaluate(async () => {
        document.getElementById('export-panel')?.remove();
        await openExportPanel();
        const present = !!document.getElementById('export-panel');
        document.getElementById('export-panel')?.remove();
        return present;
      });
      expect(r).toBe(true);
      await restore();
    });
  });

  test.describe('_tlExportCSV is gated', () => {
    test('locked: _tlDoExportCSV is never reached, no download', async () => {
      await installRpcStub({ td_exports_unlocked: false, td_billing_exempt: false });
      const r = await page.evaluate(async () => {
        const origAlert = window.zAlert;
        window.zAlert = () => {};
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => null;
        const origDoExport = window._tlDoExportCSV;
        let doExportCalled = false;
        window._tlDoExportCSV = () => { doExportCalled = true; };
        try { await _tlExportCSV(); return doExportCalled; }
        finally { window.zAlert = origAlert; window._fetchBillingStatus = origFetchStatus; window._tlDoExportCSV = origDoExport; }
      });
      expect(r, 'a locked account must never reach the actual CSV build').toBe(false);
      await restore();
    });

    test('unlocked: proceeds into _tlDoExportCSV', async () => {
      await installRpcStub({ td_exports_unlocked: true });
      const r = await page.evaluate(async () => {
        const origDoExport = window._tlDoExportCSV;
        let doExportCalled = false;
        window._tlDoExportCSV = () => { doExportCalled = true; };
        try { await _tlExportCSV(); return doExportCalled; }
        finally { window._tlDoExportCSV = origDoExport; }
      });
      expect(r).toBe(true);
      await restore();
    });
  });

  test('no console errors from the billing-gate plumbing', async () => {
    assertNoErrors(page, 'billing export gate');
  });
});
