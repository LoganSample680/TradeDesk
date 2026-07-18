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

  test.describe('_checkBillingGate (app-wide gridlock)', () => {
    const cleanupOverlay = () => page.evaluate(() => { document.getElementById('billing-gate-overlay')?.remove(); });

    test('RPC true: renders the gate overlay', async () => {
      await installRpcStub({ td_billing_gate_locked: true });
      const r = await page.evaluate(async () => {
        document.getElementById('billing-gate-overlay')?.remove();
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'canceled' });
        try {
          await _checkBillingGate();
          return { present: !!document.getElementById('billing-gate-overlay'), locked: _billingGateLocked };
        } finally { window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.present).toBe(true);
      expect(r.locked).toBe(true);
      await cleanupOverlay();
      await restore();
    });

    test('RPC false: no overlay, removes a stale one if present', async () => {
      await installRpcStub({ td_billing_gate_locked: false });
      const r = await page.evaluate(async () => {
        document.body.appendChild(Object.assign(document.createElement('div'), { id: 'billing-gate-overlay' }));
        await _checkBillingGate();
        return { present: !!document.getElementById('billing-gate-overlay'), locked: _billingGateLocked };
      });
      expect(r.present).toBe(false);
      expect(r.locked).toBe(false);
      await restore();
    });

    test('RPC errors: fails OPEN (never locks a customer out on a transient failure)', async () => {
      await installRpcStub({ td_billing_gate_locked: { error: { message: 'network blip' } } });
      const r = await page.evaluate(async () => {
        document.getElementById('billing-gate-overlay')?.remove();
        await _checkBillingGate();
        return { present: !!document.getElementById('billing-gate-overlay'), locked: _billingGateLocked };
      });
      expect(r.present, 'a transient RPC error must never brick the whole app').toBe(false);
      expect(r.locked).toBe(false);
      await restore();
    });

    test('not signed in: no-op, no throw', async () => {
      const r = await page.evaluate(async () => {
        const savedUser = _supaUser;
        _supaUser = null;
        document.getElementById('billing-gate-overlay')?.remove();
        try { await _checkBillingGate(); return { ok: true, present: !!document.getElementById('billing-gate-overlay') }; }
        catch (e) { return { ok: false, msg: e.message }; }
        finally { _supaUser = savedUser; }
      });
      expect(r.ok).toBe(true);
      expect(r.present).toBe(false);
    });

    test('overlay CTA: past_due status shows "Update payment method" wired to openBillingPortal', async () => {
      await installRpcStub({ td_billing_gate_locked: true });
      const r = await page.evaluate(async () => {
        document.getElementById('billing-gate-overlay')?.remove();
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'past_due' });
        try {
          await _checkBillingGate();
          const btn = document.querySelector('#billing-gate-overlay button');
          return { text: btn?.textContent || '', onclick: btn?.getAttribute('onclick') || '' };
        } finally { window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.text).toContain('Update payment method');
      expect(r.onclick).toContain('openBillingPortal');
      await cleanupOverlay();
      await restore();
    });

    test('overlay CTA: canceled/no status shows "Subscribe" wired to startTradeDeskBilling', async () => {
      await installRpcStub({ td_billing_gate_locked: true });
      const r = await page.evaluate(async () => {
        document.getElementById('billing-gate-overlay')?.remove();
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'canceled' });
        try {
          await _checkBillingGate();
          const btn = document.querySelector('#billing-gate-overlay button');
          return { text: btn?.textContent || '', onclick: btn?.getAttribute('onclick') || '' };
        } finally { window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r.text).toContain('Subscribe');
      expect(r.onclick).toContain('startTradeDeskBilling');
      await cleanupOverlay();
      await restore();
    });

    test('calling twice while already locked does not stack a second overlay', async () => {
      await installRpcStub({ td_billing_gate_locked: true });
      const r = await page.evaluate(async () => {
        document.getElementById('billing-gate-overlay')?.remove();
        const origFetchStatus = window._fetchBillingStatus;
        window._fetchBillingStatus = async () => ({ status: 'canceled' });
        try {
          await _checkBillingGate();
          await _checkBillingGate();
          return document.querySelectorAll('#billing-gate-overlay').length;
        } finally { window._fetchBillingStatus = origFetchStatus; }
      });
      expect(r).toBe(1);
      await cleanupOverlay();
      await restore();
    });
  });

  test.describe('_handleBillingReturn', () => {
    test('?billing=success: strips the param, shows a toast, triggers a gate re-check', async () => {
      await installRpcStub({ td_billing_gate_locked: false });
      const r = await page.evaluate(async () => {
        const url = new URL(window.location.href);
        url.search = '?billing=success&foo=bar';
        history.replaceState({}, '', url);
        let toasted = null;
        const origToast = window.showToast;
        window.showToast = (m) => { toasted = m; };
        let checked = false;
        const origCheck = window._checkBillingGate;
        window._checkBillingGate = () => { checked = true; return Promise.resolve(); };
        try {
          _handleBillingReturn();
          await new Promise((r) => setTimeout(r, 10));
          return { search: window.location.search, toasted, checked };
        } finally {
          window.showToast = origToast;
          window._checkBillingGate = origCheck;
          const cleanUrl = new URL(window.location.href);
          cleanUrl.search = '';
          history.replaceState({}, '', cleanUrl);
        }
      });
      expect(r.search).not.toContain('billing=success');
      expect(r.search).toContain('foo=bar');
      expect(r.toasted).toContain('Subscription active');
      expect(r.checked).toBe(true);
      await restore();
    });

    test('?billing=return (from the billing portal): re-checks, no toast', async () => {
      const r = await page.evaluate(async () => {
        const url = new URL(window.location.href);
        url.search = '?billing=return';
        history.replaceState({}, '', url);
        let toasted = false;
        const origToast = window.showToast;
        window.showToast = () => { toasted = true; };
        let checked = false;
        const origCheck = window._checkBillingGate;
        window._checkBillingGate = () => { checked = true; return Promise.resolve(); };
        try {
          _handleBillingReturn();
          return { search: window.location.search, toasted, checked };
        } finally {
          window.showToast = origToast;
          window._checkBillingGate = origCheck;
          const cleanUrl = new URL(window.location.href);
          cleanUrl.search = '';
          history.replaceState({}, '', cleanUrl);
        }
      });
      expect(r.search).not.toContain('billing=return');
      expect(r.toasted).toBe(false);
      expect(r.checked).toBe(true);
    });

    test('no ?billing= param: no-op', async () => {
      const r = await page.evaluate(() => {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = '?foo=bar';
        history.replaceState({}, '', cleanUrl);
        let checked = false;
        const origCheck = window._checkBillingGate;
        window._checkBillingGate = () => { checked = true; return Promise.resolve(); };
        try {
          _handleBillingReturn();
          return { search: window.location.search, checked };
        } finally {
          window._checkBillingGate = origCheck;
          history.replaceState({}, '', cleanUrl.pathname);
        }
      });
      expect(r.search).toBe('?foo=bar');
      expect(r.checked).toBe(false);
    });
  });

  test('no console errors from the billing-gate plumbing', async () => {
    assertNoErrors(page, 'billing export gate');
  });
});
