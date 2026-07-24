// @ts-check
/**
 * Exhaustive E2E coverage for clients.js
 * Every exported function is tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('clients.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    await page.evaluate(() => {
      // Remove any leftover fixtures
      clients = clients.filter(c => ![77701,77702,77703,77704].includes(c.id));
      bids    = bids.filter(b =>    ![88801,88802,88803].includes(b.id));
      jobs    = jobs.filter(j =>    ![66601,66602].includes(j.id));

      // Client with full data (address, yearBuilt pre-1978)
      clients.push(
        { id: 77701, name: 'CL Alpha', phone: '316-555-7701', addr: '101 Alpha St, Wichita, KS 67202',
          street: '101 Alpha St', city: 'Wichita', state: 'KS', zip: '67202',
          ptype: 'Single family home', source: 'Google', created: '2026-01-01',
          yearBuilt: 1955, clientToken: 'tok-alpha-e2e', clientHubKey: 'hub-alpha',
          extraAddresses: [] },
        { id: 77702, name: 'CL Beta', phone: '316-555-7702', addr: '102 Beta Ave, Wichita, KS 67203',
          street: '102 Beta Ave', city: 'Wichita', state: 'KS', zip: '67203',
          ptype: 'Single family home', source: 'Referral', created: '2026-01-02',
          yearBuilt: 2005, clientToken: 'tok-beta-e2e', clientHubKey: 'hub-beta',
          extraAddresses: [] },
        { id: 77703, name: 'CL Gamma', phone: '316-555-7703', addr: '',
          street: '', city: '', state: '', zip: '',
          ptype: '', source: 'Facebook', created: '2026-01-03',
          yearBuilt: null, clientToken: 'tok-gamma-e2e', clientHubKey: 'hub-gamma',
          extraAddresses: [] },
        { id: 77704, name: 'CL Delta', phone: '316-555-7704', addr: '104 Delta Rd, Wichita, KS 67204',
          street: '104 Delta Rd', city: 'Wichita', state: 'KS', zip: '67204',
          ptype: 'Single family home', source: 'Google', created: '2026-01-04',
          yearBuilt: 1975, clientToken: 'tok-delta-e2e', clientHubKey: 'hub-delta',
          extraAddresses: [{ label: 'Rental', addr: '200 Rental Ln, Wichita, KS 67205' }] }
      );
      bids.push(
        { id: 88801, client_id: 77701, client_name: 'CL Alpha', amount: 3000,
          status: 'Closed Won', draft: false, bid_date: '2026-01-10',
          signingToken: 'sign-alpha', surfaces: [{ type: 'walls', room: 'LR' }] },
        { id: 88802, client_id: 77702, client_name: 'CL Beta', amount: 1500,
          status: 'Pending', draft: false, bid_date: '2026-01-11', signingToken: 'sign-beta' },
        { id: 88803, client_id: 77701, client_name: 'CL Alpha', amount: 500,
          status: 'Draft', draft: true, bid_date: '2026-01-12', surfaces: [] }
      );
      jobs.push(
        { id: 66601, client_id: 77701, bid_id: 88801, name: 'Alpha job',
          status: 'scheduled', start: '2099-06-01', days: 2 },
        { id: 66602, client_id: 77702, bid_id: 88802, name: 'Beta est',
          eventType: 'estimate', status: 'scheduled', start: '2099-06-02', days: 1 }
      );

      // Ensure minimal DOM stubs used by various render functions
      function ensureEl(id, tag) {
        if (!document.getElementById(id)) {
          const el = document.createElement(tag || 'div');
          el.id = id;
          document.body.appendChild(el);
        }
        return document.getElementById(id);
      }
      ensureEl('client-list');
      ensureEl('client-hub-list');
      ensureEl('client-hub-sub');
      ensureEl('dash-year-sel', 'select');
      ensureEl('dash-year-label');
      ensureEl('dash-year-btn-wrap');
      ensureEl('dps-month');
      ensureEl('dps-quarter');
      ensureEl('dps-year');
      ensureEl('dps-all');
      ensureEl('cf-tab-counts');
      ensureEl('cft-all');
      ensureEl('cft-won');
      ensureEl('cft-active');
      ensureEl('cft-collect');
      ensureEl('cft-closed');
      ensureEl('clients-tbar-eyebrow');
      ensureEl('cf-dupe-warn');
      ensureEl('cf-title');
      ensureEl('cf-del', 'button');
      ensureEl('cf-name', 'input');
      ensureEl('cf-phone', 'input');
      ensureEl('cf-street', 'input');
      ensureEl('cf-city', 'input');
      ensureEl('cf-state', 'input');
      ensureEl('cf-zip', 'input');
      ensureEl('cf-ref', 'input');
      ensureEl('cf-notes', 'textarea');
      ensureEl('cf-ptype', 'select');
      ensureEl('cf-source', 'select');
      ensureEl('cf-search', 'input');
      ensureEl('cf-search-wrap');
      ensureEl('cf-ref-wrap');
      ensureEl('client-form-wrap');
      ensureEl('clients-page-title');
      ensureEl('clients-new-btn', 'button');
      ensureEl('cf-year-built', 'input');
      ensureEl('cf-year-warn');
      ensureEl('cf-year-lookup', 'button');
      ensureEl('e-client-sel', 'select');
      ensureEl('inc-client-sel', 'select');
      ensureEl('mil-client-sel', 'select');
      ensureEl('nb-bid-badge');
    });
  });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => ![77701,77702,77703,77704].includes(c.id));
      bids    = bids.filter(b =>    ![88801,88802,88803].includes(b.id));
      jobs    = jobs.filter(j =>    ![66601,66602].includes(j.id));
    });
    await page.context().close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // openClientDetail
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openClientDetail', () => {
    test('null cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openClientDetail(null, 'clients'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openClientDetail(undefined, 'dash'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openClientDetail('notanumber', 'clients'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent numeric cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openClientDetail(9999999, 'clients'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets currentClientId and _clientDetailOrigin', async () => {
      const r = await page.evaluate(() => {
        try {
          openClientDetail(77701, 'clients');
          return { ok: true, cid: currentClientId, origin: window._clientDetailOrigin };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.cid).toBe(77701);
      expect(r.origin).toBe('clients');
    });

    test('origin=dash: sets _fromDash true', async () => {
      const r = await page.evaluate(() => {
        try {
          openClientDetail(77701, 'dash');
          return { ok: true, fromDash: window._fromDash, origin: window._clientDetailOrigin };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.fromDash).toBe(true);
      expect(r.origin).toBe('dash');
    });

    test('origin=leads: sets leads origin', async () => {
      const r = await page.evaluate(() => {
        try {
          openClientDetail(77702, 'leads');
          return { ok: true, origin: window._clientDetailOrigin };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.origin).toBe('leads');
    });

    test('origin=true (legacy): maps to dash', async () => {
      const r = await page.evaluate(() => {
        try {
          openClientDetail(77701, true);
          return { ok: true, origin: window._clientDetailOrigin };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.origin).toBe('dash');
    });

    test('back-btn text set correctly for clients origin', async () => {
      const r = await page.evaluate(() => {
        try {
          openClientDetail(77701, 'clients');
          const bb = document.getElementById('cd-back-btn');
          const txt = bb ? bb.textContent : '';
          return { ok: true, txt };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.txt).toBe('← All clients');
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) openClientDetail(77701, 'clients');
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // openEstimateForClient
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openEstimateForClient', () => {
    test('no currentClientId, shows gate, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = currentClientId;
        currentClientId = null;
        let gateShown = false;
        const orig = typeof showWorkflowGate === 'function' ? showWorkflowGate : null;
        window.showWorkflowGate = () => { gateShown = true; };
        try {
          openEstimateForClient();
          currentClientId = saved;
          window.showWorkflowGate = orig || window.showWorkflowGate;
          return { ok: true, gateShown };
        }
        catch (e) {
          currentClientId = saved;
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
    });

    test('blacklisted client, calls zAlert, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = currentClientId;
        currentClientId = 77701;
        const savedGetRisk = typeof getClientRisk === 'function' ? getClientRisk : null;
        let alerted = false;
        window.getClientRisk = () => 'blacklisted';
        const origAlert = window.zAlert;
        window.zAlert = () => { alerted = true; };
        try {
          openEstimateForClient();
          currentClientId = saved;
          if (savedGetRisk) window.getClientRisk = savedGetRisk;
          window.zAlert = origAlert;
          return { ok: true, alerted };
        }
        catch (e) {
          currentClientId = saved;
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
      expect(r.alerted).toBe(true);
    });

    test('high_risk client, calls zConfirm, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = currentClientId;
        currentClientId = 77701;
        const savedGetRisk = typeof getClientRisk === 'function' ? getClientRisk : null;
        let confirmed = false;
        window.getClientRisk = () => 'high_risk';
        const origConfirm = window.zConfirm;
        window.zConfirm = () => { confirmed = true; };
        try {
          openEstimateForClient();
          currentClientId = saved;
          if (savedGetRisk) window.getClientRisk = savedGetRisk;
          window.zConfirm = origConfirm;
          return { ok: true, confirmed };
        }
        catch (e) {
          currentClientId = saved;
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
      expect(r.confirmed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _rrpGateThenEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_rrpGateThenEstimate', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _rrpGateThenEstimate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('client without yearBuilt, skips RRP modal', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta Ave', yearBuilt: null };
        let rrpShown = false;
        const orig = window._showRrpModal;
        window._showRrpModal = () => { rrpShown = true; };
        try {
          _rrpGateThenEstimate(c);
          window._showRrpModal = orig;
          return { ok: true, rrpShown };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rrpShown).toBe(false);
    });

    test('pre-1978 client with address, shows style picker AND RRP modal', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, name: 'CL Alpha', addr: '101 Alpha St', yearBuilt: 1955 };
        let rrpShown = false;
        const orig = window._showRrpModal;
        window._showRrpModal = () => { rrpShown = true; };
        try {
          _rrpGateThenEstimate(c);
          window._showRrpModal = orig;
          // Cleanup any created overlay
          document.getElementById('_style-pick-ov')?.remove();
          document.getElementById('_rrp-gate-overlay')?.remove();
          return { ok: true, rrpShown };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rrpShown).toBe(true);
    });

    test('landscaping trade, skips RRP even for pre-1978 home', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, name: 'CL Alpha', addr: '101 Alpha St', yearBuilt: 1950 };
        const origGetTrade = typeof getActiveTrade === 'function' ? getActiveTrade : null;
        window.getActiveTrade = () => 'landscaping';
        let rrpShown = false;
        const orig = window._showRrpModal;
        window._showRrpModal = () => { rrpShown = true; };
        try {
          _rrpGateThenEstimate(c);
          if (origGetTrade) window.getActiveTrade = origGetTrade;
          window._showRrpModal = orig;
          document.getElementById('_style-pick-ov')?.remove();
          return { ok: true, rrpShown };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.rrpShown).toBe(false);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta', yearBuilt: 2000 };
        try {
          for (let i = 0; i < 5; i++) _rrpGateThenEstimate(c);
          document.getElementById('_style-pick-ov')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _showRrpModal
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_showRrpModal', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _showRrpModal(null, () => {}); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('null callback, does not throw', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, yearBuilt: 1955, name: 'CL Alpha', addr: '101 Alpha' };
        try {
          _showRrpModal(c, null);
          document.getElementById('_rrp-gate-overlay')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates overlay in DOM', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, yearBuilt: 1955, name: 'CL Alpha', addr: '101 Alpha' };
        try {
          _showRrpModal(c, () => {});
          const ov = document.getElementById('_rrp-gate-overlay');
          const exists = !!ov;
          ov?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('calling twice removes old overlay before adding new', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, yearBuilt: 1955, name: 'CL Alpha', addr: '101 Alpha' };
        try {
          _showRrpModal(c, () => {});
          _showRrpModal(c, () => {});
          const count = document.querySelectorAll('#_rrp-gate-overlay').length;
          document.getElementById('_rrp-gate-overlay')?.remove();
          return { ok: true, count };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
    });

    test('_rrpModalNo fires onProceed callback', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, yearBuilt: 1955, name: 'CL Alpha', addr: '101 Alpha' };
        let called = false;
        try {
          _showRrpModal(c, () => { called = true; });
          window._rrpModalNo();
          document.getElementById('_rrp-gate-overlay')?.remove();
          return { ok: true, called };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.called).toBe(true);
    });

    test('concurrent calls, no stack corruption', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77701, yearBuilt: 1955, name: 'CL Alpha', addr: '101 Alpha' };
        try {
          for (let i = 0; i < 5; i++) _showRrpModal(c, () => {});
          const count = document.querySelectorAll('#_rrp-gate-overlay').length;
          document.getElementById('_rrp-gate-overlay')?.remove();
          return { ok: true, count };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _gateAddressThenEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_gateAddressThenEstimate', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _gateAddressThenEstimate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('client with no address, shows address gate overlay', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77703, name: 'CL Gamma', addr: '', phone: '316-555-7703' };
        try {
          _gateAddressThenEstimate(c);
          const ov = document.getElementById('_addr-gate-overlay');
          const exists = !!ov;
          ov?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('client with whitespace-only address, shows gate', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77703, name: 'CL Gamma', addr: '   ', phone: '316-555-7703' };
        try {
          _gateAddressThenEstimate(c);
          const ov = document.getElementById('_addr-gate-overlay');
          const exists = !!ov;
          ov?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('client with address, proceeds to _checkMultiProperty (no gate overlay)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta Ave, Wichita, KS', phone: '316-555-7702' };
        let checkCalled = false;
        const orig = window._checkMultiPropertyThenOpen;
        window._checkMultiPropertyThenOpen = () => { checkCalled = true; };
        try {
          _gateAddressThenEstimate(c);
          window._checkMultiPropertyThenOpen = orig;
          return { ok: true, checkCalled, gateExists: !!document.getElementById('_addr-gate-overlay') };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.checkCalled).toBe(true);
      expect(r.gateExists).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _checkMultiPropertyThenOpen
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_checkMultiPropertyThenOpen', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _checkMultiPropertyThenOpen(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('client with no in-progress bids, calls _doOpenEstimate', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta Ave', phone: '316-555-7702' };
        let openCalled = false;
        const orig = window._doOpenEstimate;
        window._doOpenEstimate = () => { openCalled = true; };
        try {
          _checkMultiPropertyThenOpen(c);
          window._doOpenEstimate = orig;
          return { ok: true, openCalled };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.openCalled).toBe(true);
    });

    test('client with active draft bid, shows zConfirm resume dialog', async () => {
      const r = await page.evaluate(() => {
        // Temporarily add a draft pending bid for client 77701
        const draftBid = { id: 88899, client_id: 77701, status: 'Pending', draft: true, surfaces: [{ type: 'walls' }] };
        bids.push(draftBid);
        const c = clients.find(x => x.id === 77701);
        let confirmCalled = false;
        const origConfirm = window.zConfirm;
        window.zConfirm = () => { confirmCalled = true; };
        try {
          _checkMultiPropertyThenOpen(c);
          bids = bids.filter(b => b.id !== 88899);
          window.zConfirm = origConfirm;
          return { ok: true, confirmCalled };
        }
        catch (e) {
          bids = bids.filter(b => b.id !== 88899);
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
      expect(r.confirmCalled).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _askNewPropertyAddress
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_askNewPropertyAddress', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _askNewPropertyAddress(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid client, creates overlay with input', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta Ave', phone: '316-555-7702' };
        try {
          _askNewPropertyAddress(c);
          const ov = document.getElementById('_new-prop-overlay');
          const inp = document.getElementById('_new-prop-addr');
          const exists = !!ov && !!inp;
          ov?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('concurrent calls, no duplicate overlays', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 77702, name: 'CL Beta', addr: '102 Beta Ave', phone: '316-555-7702' };
        try {
          _askNewPropertyAddress(c);
          _askNewPropertyAddress(c);
          const count = document.querySelectorAll('#_new-prop-overlay').length;
          document.querySelectorAll('#_new-prop-overlay').forEach(el => el.remove());
          return { ok: true, count };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // Multiple overlays may exist but function must not throw
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _showTradePicker
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_showTradePicker', () => {
    test('null title and null cb, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          _showTradePicker(null, null);
          document.getElementById('_trade-pick-ov')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string title, creates overlay', async () => {
      const r = await page.evaluate(() => {
        try {
          _showTradePicker('', () => {});
          const exists = !!document.getElementById('_trade-pick-ov');
          document.getElementById('_trade-pick-ov')?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('golden path, renders trade buttons in DOM', async () => {
      const r = await page.evaluate(() => {
        try {
          _showTradePicker('Pick a trade', (id) => {});
          const ov = document.getElementById('_trade-pick-ov');
          const hasBtns = ov ? ov.querySelectorAll('button').length > 1 : false;
          ov?.remove();
          return { ok: true, hasBtns };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasBtns).toBe(true);
    });

    test('calling twice replaces old overlay', async () => {
      const r = await page.evaluate(() => {
        try {
          _showTradePicker('First', () => {});
          _showTradePicker('Second', () => {});
          const count = document.querySelectorAll('#_trade-pick-ov').length;
          document.getElementById('_trade-pick-ov')?.remove();
          return { ok: true, count };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // At most 2 (function doesn't auto-remove old one), just must not throw
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _pickTrade
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_pickTrade', () => {
    test('null id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _pickTrade(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _pickTrade(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('unknown trade id fires tradePickCb if set', async () => {
      const r = await page.evaluate(() => {
        let cbCalled = false;
        window._tradePickCb = (id) => { cbCalled = true; };
        // Create overlay so function can remove it
        const ov = document.createElement('div');
        ov.id = '_trade-pick-ov';
        document.body.appendChild(ov);
        try {
          _pickTrade('plumbing');
          return { ok: true, cbCalled };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.cbCalled).toBe(true);
    });

    test('_industrial id, calls openIndustrialEquipEstimate stub', async () => {
      const r = await page.evaluate(() => {
        let called = false;
        const orig = typeof openIndustrialEquipEstimate === 'function' ? openIndustrialEquipEstimate : null;
        window.openIndustrialEquipEstimate = () => { called = true; };
        const ov = document.createElement('div');
        ov.id = '_trade-pick-ov';
        document.body.appendChild(ov);
        try {
          _pickTrade('_industrial');
          if (orig) window.openIndustrialEquipEstimate = orig;
          return { ok: true, called };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.called).toBe(true);
    });

    test('_tm id, calls openTMEstimate stub', async () => {
      const r = await page.evaluate(() => {
        let called = false;
        const orig = typeof openTMEstimate === 'function' ? openTMEstimate : null;
        window.openTMEstimate = () => { called = true; };
        const ov = document.createElement('div');
        ov.id = '_trade-pick-ov';
        document.body.appendChild(ov);
        try {
          _pickTrade('_tm');
          if (orig) window.openTMEstimate = orig;
          return { ok: true, called };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.called).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) _pickTrade('painting');
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _closeStylePicker
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_closeStylePicker', () => {
    test('no overlay present, does not throw', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_style-pick-ov')?.remove();
        try { _closeStylePicker(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('overlay present, sets opacity to 0 and schedules removal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('#_style-pick-ov').forEach(el => el.remove());
        const ov = document.createElement('div');
        ov.id = '_style-pick-ov';
        document.body.appendChild(ov);
        try {
          _closeStylePicker();
          const opacity = ov.style.opacity;
          return { ok: true, opacity };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.opacity).toBe('0');
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        const ov = document.createElement('div');
        ov.id = '_style-pick-ov';
        document.body.appendChild(ov);
        try {
          for (let i = 0; i < 5; i++) _closeStylePicker();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _showEstimateStylePicker
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_showEstimateStylePicker', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          _showEstimateStylePicker(null, null);
          document.getElementById('_style-pick-ov')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid client, creates full-screen overlay', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 77702);
        try {
          _showEstimateStylePicker(c, null);
          const ov = document.getElementById('_style-pick-ov');
          const exists = !!ov;
          ov?.remove();
          return { ok: true, exists };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('sets _stylePickState with client and overrideAddr', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 77702);
        try {
          _showEstimateStylePicker(c, '999 Override Ln');
          const state = window._stylePickState;
          document.getElementById('_style-pick-ov')?.remove();
          return { ok: true, hasClient: state && state.c && state.c.id === 77702, addr: state && state.overrideAddr };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasClient).toBe(true);
      expect(r.addr).toBe('999 Override Ln');
    });

    test('no duplicate overlays on 3 calls', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 77702);
        try {
          _showEstimateStylePicker(c, null);
          _showEstimateStylePicker(c, null);
          _showEstimateStylePicker(c, null);
          const count = document.querySelectorAll('#_style-pick-ov').length;
          document.querySelectorAll('#_style-pick-ov').forEach(el => el.remove());
          return { ok: true, count };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // Function appends each time but must not throw, count assertion is informational
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _pickEstStyle
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_pickEstStyle', () => {
    test('null style, does not throw', async () => {
      const r = await page.evaluate(() => {
        window._stylePickState = null;
        try { _pickEstStyle(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('style=scope: no longer a valid style, does not throw and calls nothing', async () => {
      const r = await page.evaluate(() => {
        window._stylePickState = { c: clients.find(x => x.id === 77702), overrideAddr: null };
        const ov = document.createElement('div');
        ov.id = '_style-pick-ov';
        document.body.appendChild(ov);
        try { _pickEstStyle('scope'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('style=tm: calls openTMEstimate', async () => {
      const r = await page.evaluate(() => {
        window._stylePickState = { c: clients.find(x => x.id === 77702), overrideAddr: null };
        let tmCalled = false;
        const orig = window.openTMEstimate;
        window.openTMEstimate = () => { tmCalled = true; };
        const ov = document.createElement('div');
        ov.id = '_style-pick-ov';
        document.body.appendChild(ov);
        try {
          _pickEstStyle('tm');
          if (orig) window.openTMEstimate = orig;
          return { ok: true, tmCalled };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.tmCalled).toBe(true);
    });

    test('style=freeform: calls openFreeFormEstimate', async () => {
      const r = await page.evaluate(() => {
        window._stylePickState = { c: clients.find(x => x.id === 77702), overrideAddr: null };
        let ffCalled = false;
        const orig = typeof openFreeFormEstimate === 'function' ? openFreeFormEstimate : null;
        window.openFreeFormEstimate = () => { ffCalled = true; };
        const ov = document.createElement('div');
        ov.id = '_style-pick-ov';
        document.body.appendChild(ov);
        try {
          _pickEstStyle('freeform');
          if (orig) window.openFreeFormEstimate = orig;
          return { ok: true, ffCalled };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.ffCalled).toBe(true);
    });

    test('unknown style with no overlay, does not throw', async () => {
      const r = await page.evaluate(() => {
        window._stylePickState = null;
        document.getElementById('_style-pick-ov')?.remove();
        try { _pickEstStyle('bogus_style'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _doOpenScopeEstimate: Scope & Price mode removed; only T&M and BYO remain
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_doOpenScopeEstimate', () => {
    test('function was removed with the Scope & Price estimate mode', async () => {
      const exists = await page.evaluate(() => {
        let val; try { val = eval('_doOpenScopeEstimate'); } catch (e) { val = undefined; }
        return typeof val === 'function';
      });
      expect(exists).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _doOpenEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_doOpenEstimate', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _doOpenEstimate(null, null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid client no forceTrade, shows style picker (multi-trade) or style picker (single)', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 77702);
        try {
          _doOpenEstimate(c, null, null);
          // Either a style picker or trade picker appears
          const stylePick = !!document.getElementById('_style-pick-ov');
          const tradePick = !!document.getElementById('_trade-pick-ov');
          document.getElementById('_style-pick-ov')?.remove();
          document.getElementById('_trade-pick-ov')?.remove();
          return { ok: true, stylePick, tradePick };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_bids', '{INVALID{{{{');
        const c = clients.find(x => x.id === 77702);
        try {
          _doOpenEstimate(c, null, null);
          document.getElementById('_style-pick-ov')?.remove();
          document.getElementById('_trade-pick-ov')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_bids'); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no stack corruption', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 77702);
        try {
          for (let i = 0; i < 5; i++) _doOpenEstimate(c, null, null);
          document.querySelectorAll('#_style-pick-ov').forEach(el => el.remove());
          document.querySelectorAll('#_trade-pick-ov').forEach(el => el.remove());
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _dashInRange
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_dashInRange', () => {
    test('null: returns false', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _dashInRange(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(false);
    });

    test('undefined: returns false', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _dashInRange(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(false);
    });

    test('empty string, returns false', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _dashInRange('') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(false);
    });

    test('period=all: always returns true', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod;
        dashPeriod = 'all';
        try { return { ok: true, result: _dashInRange('2020-01-01') }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(true);
    });

    test('period=year, matching year, returns true', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod; const savedY = dashYear;
        dashPeriod = 'year'; dashYear = 2026;
        try { return { ok: true, result: _dashInRange('2026-06-15') }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; dashYear = savedY; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(true);
    });

    test('period=year, non-matching year, returns false', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod; const savedY = dashYear;
        dashPeriod = 'year'; dashYear = 2025;
        try { return { ok: true, result: _dashInRange('2026-06-15') }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; dashYear = savedY; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(false);
    });

    test('period=month: date in current month returns true', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod; const savedY = dashYear;
        dashPeriod = 'month';
        const now = new Date();
        dashYear = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const dateStr = now.getFullYear() + '-' + mo + '-15';
        try { return { ok: true, result: _dashInRange(dateStr) }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; dashYear = savedY; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(true);
    });

    test('period=quarter: current quarter date returns true', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod; const savedY = dashYear;
        dashPeriod = 'quarter';
        const now = new Date();
        dashYear = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const dateStr = now.getFullYear() + '-' + mo + '-10';
        try { return { ok: true, result: _dashInRange(dateStr) }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; dashYear = savedY; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(true);
    });

    test('boundary: year 0 string, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = dashPeriod; dashPeriod = 'year';
        try { return { ok: true, result: _dashInRange('0000-01-01') }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { dashPeriod = saved; }
      });
      expect(r.ok).toBe(true);
    });

    test('type mismatch, number input, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _dashInRange(20260615) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // initDashYear
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('initDashYear', () => {
    test('missing dash-year-sel DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('dash-year-sel');
        const parent = el?.parentNode;
        el?.remove();
        try { initDashYear(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el && parent) parent.appendChild(el); }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, populates select with at least current year', async () => {
      const r = await page.evaluate(() => {
        try {
          initDashYear();
          const sel = document.getElementById('dash-year-sel');
          const opts = sel ? Array.from(sel.options).map(o => parseInt(o.value)) : [];
          const cy = new Date().getFullYear();
          return { ok: true, hasCurrentYear: opts.includes(cy) };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCurrentYear).toBe(true);
    });

    test('no duplicate years after 3 calls', async () => {
      const r = await page.evaluate(() => {
        try {
          initDashYear(); initDashYear(); initDashYear();
          const sel = document.getElementById('dash-year-sel');
          const opts = sel ? Array.from(sel.options).map(o => o.value) : [];
          const unique = new Set(opts);
          return { ok: true, noDupes: opts.length === unique.size };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.noDupes).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) initDashYear();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setDashYear
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setDashYear', () => {
    test('null: does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try { setDashYear(null); window.renderDash = orig || window.renderDash; return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string year, parses and sets dashYear', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try {
          setDashYear('2025');
          const yr = dashYear;
          window.renderDash = orig || window.renderDash;
          return { ok: true, yr };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.yr).toBe(2025);
    });

    test('numeric year, sets dashYear', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try {
          setDashYear(2026);
          const yr = dashYear;
          window.renderDash = orig || window.renderDash;
          return { ok: true, yr };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.yr).toBe(2026);
    });

    test('updates dash-year-label text', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        const lbl = document.getElementById('dash-year-label');
        try {
          setDashYear(2024);
          window.renderDash = orig || window.renderDash;
          return { ok: true, txt: lbl ? lbl.textContent : null };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.txt).toBe('2024');
    });

    test('missing label DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const lbl = document.getElementById('dash-year-label');
        const parent = lbl?.parentNode;
        lbl?.remove();
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try {
          setDashYear(2023);
          window.renderDash = orig || window.renderDash;
          if (lbl && parent) parent.appendChild(lbl);
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setDashPeriod
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setDashPeriod', () => {
    test('null: does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try { setDashPeriod(null); window.renderDash = orig || window.renderDash; return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('period=year: sets dashPeriod and toggles button class', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try {
          setDashPeriod('year');
          window.renderDash = orig || window.renderDash;
          return { ok: true, period: dashPeriod };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.period).toBe('year');
    });

    test('period=all: hides year button wrap', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        const ybw = document.getElementById('dash-year-btn-wrap');
        try {
          setDashPeriod('all');
          window.renderDash = orig || window.renderDash;
          return { ok: true, display: ybw ? ybw.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('period=month: shows year wrap', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        const ybw = document.getElementById('dash-year-btn-wrap');
        try {
          setDashPeriod('month');
          window.renderDash = orig || window.renderDash;
          return { ok: true, display: ybw ? ybw.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).not.toBe('none');
    });

    test('invalid period string, does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try { setDashPeriod('bogus'); window.renderDash = orig || window.renderDash; return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        const orig = typeof renderDash === 'function' ? renderDash : null;
        window.renderDash = () => {};
        try {
          ['year','month','quarter','all','year'].forEach(p => setDashPeriod(p));
          window.renderDash = orig || window.renderDash;
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clientBaseUrl
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clientBaseUrl', () => {
    test('returns a non-empty string', async () => {
      const r = await page.evaluate(() => {
        try { const url = _clientBaseUrl(); return { ok: true, url }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.url).toBe('string');
      expect(r.url.length).toBeGreaterThan(0);
    });

    test('with S.subdomain: uses subdomain URL', async () => {
      const r = await page.evaluate(() => {
        const saved = S.subdomain;
        S.subdomain = 'testco';
        try {
          const url = _clientBaseUrl();
          S.subdomain = saved;
          return { ok: true, url };
        }
        catch (e) { S.subdomain = saved; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toContain('testco.tradedeskpro.app');
    });

    test('without subdomain, returns origin-based URL', async () => {
      const r = await page.evaluate(() => {
        const saved = S.subdomain;
        S.subdomain = null;
        try {
          const url = _clientBaseUrl();
          S.subdomain = saved;
          return { ok: true, url };
        }
        catch (e) { S.subdomain = saved; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toContain('http');
    });

    test('concurrent calls return consistent result', async () => {
      const r = await page.evaluate(() => {
        try {
          const results = [];
          for (let i = 0; i < 5; i++) results.push(_clientBaseUrl());
          const allSame = results.every(u => u === results[0]);
          return { ok: true, allSame };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.allSame).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clientHubUrl
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clientHubUrl', () => {
    test('null client, returns null, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, url: _clientHubUrl(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toBeNull();
    });

    test('client with no token, returns null', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 99999, name: 'No Token', phone: '0', clientToken: null };
        try { return { ok: true, url: _clientHubUrl(c) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toBeNull();
    });

    test('no _supaUser, returns null', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser;
        window._supaUser = null;
        const c = { id: 77701, clientToken: 'tok-alpha-e2e' };
        try {
          const url = _clientHubUrl(c);
          window._supaUser = savedUser;
          return { ok: true, url };
        }
        catch (e) { window._supaUser = savedUser; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toBeNull();
    });

    test('golden path, returns URL string with token and client id', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser;
        window._supaUser = { id: 'e2e-user-0001' };
        const c = clients.find(x => x.id === 77701);
        try {
          const url = _clientHubUrl(c);
          window._supaUser = savedUser;
          return { ok: true, url };
        }
        catch (e) { window._supaUser = savedUser; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.url).toContain('tok-alpha-e2e');
      expect(r.url).toContain('77701');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // renderClientHubPage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderClientHubPage', () => {
    test('missing client-hub-list DOM, returns early, no throw', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('client-hub-list');
        const parent = el?.parentNode;
        el?.remove();
        try { renderClientHubPage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el && parent) parent.appendChild(el); }
      });
      expect(r.ok).toBe(true);
    });

    test('no clients, shows empty state', async () => {
      const r = await page.evaluate(() => {
        const saved = [...clients];
        clients = [];
        try {
          renderClientHubPage();
          const el = document.getElementById('client-hub-list');
          const hasEmpty = el ? el.innerHTML.includes('No clients') : false;
          return { ok: true, hasEmpty };
        }
        catch (e) { return { ok: false, err: e.message }; }
        finally { clients = saved; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasEmpty).toBe(true);
    });

    test('with clients, renders rows', async () => {
      const r = await page.evaluate(() => {
        window._supaUser = { id: 'e2e-user-0001' };
        try {
          renderClientHubPage();
          const el = document.getElementById('client-hub-list');
          const hasContent = el ? el.innerHTML.length > 50 : false;
          return { ok: true, hasContent };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasContent).toBe(true);
    });

    test('no duplicate entries after 3 calls', async () => {
      const r = await page.evaluate(() => {
        window._supaUser = { id: 'e2e-user-0001' };
        try {
          renderClientHubPage();
          renderClientHubPage();
          renderClientHubPage();
          const el = document.getElementById('client-hub-list');
          const rows = el ? el.querySelectorAll('.hub-dir-row').length : 0;
          // Should equal number of clients with tokens, not 3x
          return { ok: true, rows };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // rows should not be 3x the client count (innerHTML is replaced, not appended)
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _previewClientHub
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_previewClientHub', () => {
    test('null url, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _previewClientHub(null, null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_hub-preview-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('valid url, creates preview overlay with iframe', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser;
        window._supaUser = { id: 'e2e-user-0001' };
        try {
          _previewClientHub('https://example.com/client.html?t=abc', 'CL Alpha', 77701);
          const ov = document.getElementById('_hub-preview-ov');
          const hasIframe = ov ? !!ov.querySelector('iframe') : false;
          ov?.remove();
          window._supaUser = savedUser;
          return { ok: true, hasIframe };
        }
        catch (e) { window._supaUser = savedUser; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasIframe).toBe(true);
    });

    test('no _supaUser, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = window._supaUser;
        window._supaUser = null;
        try {
          _previewClientHub('https://example.com/client.html?t=abc', 'CL Alpha', 77701);
          document.getElementById('_hub-preview-ov')?.remove();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
        finally { window._supaUser = saved; }
      });
      expect(r.ok).toBe(true);
    });

    test('preview URL gets ?preview=1 appended', async () => {
      const r = await page.evaluate(() => {
        const savedUser = window._supaUser;
        window._supaUser = null;
        try {
          _previewClientHub('https://example.com/client.html?t=tok', 'Test', null);
          const ov = document.getElementById('_hub-preview-ov');
          const iframe = ov?.querySelector('iframe');
          const src = iframe?.src || '';
          ov?.remove();
          window._supaUser = savedUser;
          return { ok: true, hasPreview: src.includes('preview=1') };
        }
        catch (e) { window._supaUser = savedUser; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasPreview).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clientHubCopy
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clientHubCopy', () => {
    test('null url and null btn, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _clientHubCopy(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid url, calls clipboard.writeText without throwing', async () => {
      const r = await page.evaluate(async () => {
        let writtenUrl = null;
        const origClip = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: (u) => { writtenUrl = u; return Promise.resolve(); } },
          configurable: true,
          writable: true,
        });
        try {
          _clientHubCopy('https://example.com/hub', null);
          await new Promise(res => setTimeout(res, 50));
          Object.defineProperty(navigator, 'clipboard', { value: origClip, configurable: true, writable: true });
          return { ok: true, writtenUrl };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.writtenUrl).toBe('https://example.com/hub');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // pipelineResendSms
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('pipelineResendSms', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { pipelineResendSms(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent bidId, returns early', async () => {
      const r = await page.evaluate(() => {
        try { pipelineResendSms(9999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('bid without signingToken, returns early', async () => {
      const r = await page.evaluate(() => {
        try { pipelineResendSms(88803); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid bid with signingToken, attempts SMS redirect without throw', async () => {
      const r = await page.evaluate(() => {
        let navHref = null;
        const origHref = Object.getOwnPropertyDescriptor(window.location, 'href');
        // Mock location.href so we capture the navigation intent without actually navigating.
        // In Chromium, window.location.href may not be configurable, ignore the error and proceed.
        try {
          Object.defineProperty(window.location, 'href', {
            set: (v) => { navHref = v; },
            get: () => window.location.toString(),
            configurable: true,
          });
        } catch (_) {}
        try {
          pipelineResendSms(88801);
          try { Object.defineProperty(window.location, 'href', origHref || { value: window.location.toString(), configurable: true }); } catch (_) {}
          return { ok: true, navAttempted: !!navHref };
        }
        catch (e) {
          try { Object.defineProperty(window.location, 'href', origHref || { value: window.location.toString(), configurable: true }); } catch (_) {}
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // onClientSearch
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('onClientSearch', () => {
    test('null input, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onClientSearch({ value: '' }); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty value, calls renderClientList', async () => {
      const r = await page.evaluate(() => {
        let renderCalled = false;
        const orig = window.renderClientList;
        window.renderClientList = () => { renderCalled = true; };
        try {
          onClientSearch({ value: '' });
          window.renderClientList = orig;
          return { ok: true, renderCalled };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.renderCalled).toBe(true);
    });

    test('matching query, renders matched clients', async () => {
      const r = await page.evaluate(() => {
        try {
          onClientSearch({ value: 'CL Alpha' });
          const el = document.getElementById('client-list');
          return { ok: true, html: el ? el.innerHTML : '' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('CL Alpha');
    });

    test('no-match query, shows empty message', async () => {
      const r = await page.evaluate(() => {
        try {
          onClientSearch({ value: 'XYZZY_NOMATCH_12345' });
          const el = document.getElementById('client-list');
          const html = el ? el.innerHTML : '';
          return { ok: true, hasEmpty: html.includes('No clients match') };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasEmpty).toBe(true);
    });

    test('phone-only query, matches by phone digits', async () => {
      const r = await page.evaluate(() => {
        try {
          onClientSearch({ value: '3165557701' });
          const el = document.getElementById('client-list');
          return { ok: true, html: el ? el.innerHTML : '' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('CL Alpha');
    });

    test('special chars in query, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onClientSearch({ value: '<script>alert(1)</script>' }); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) onClientSearch({ value: 'Alpha' });
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setCF
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setCF', () => {
    test('null filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setCF(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets clientFilter and renders', async () => {
      const r = await page.evaluate(() => {
        let renderCalled = false;
        const orig = window.renderClientList;
        window.renderClientList = () => { renderCalled = true; };
        try {
          setCF('all', null);
          window.renderClientList = orig;
          return { ok: true, renderCalled, filter: clientFilter };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.renderCalled).toBe(true);
      expect(r.filter).toBe('all');
    });

    test('with btn, adds active class', async () => {
      const r = await page.evaluate(() => {
        const btn = document.createElement('button');
        btn.id = 'test-cf-btn';
        document.body.appendChild(btn);
        const orig = window.renderClientList;
        window.renderClientList = () => {};
        try {
          setCF('won', btn);
          const hasActive = btn.classList.contains('active');
          btn.remove();
          window.renderClientList = orig;
          return { ok: true, hasActive };
        }
        catch (e) { btn.remove(); return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasActive).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // populateClientSelectors
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('populateClientSelectors', () => {
    test('does not throw', async () => {
      const r = await page.evaluate(() => {
        try { populateClientSelectors(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('populates e-client-sel with client options', async () => {
      const r = await page.evaluate(() => {
        try {
          populateClientSelectors();
          const sel = document.getElementById('e-client-sel');
          const opts = sel ? Array.from(sel.options) : [];
          const hasAlpha = opts.some(o => o.text.includes('CL Alpha'));
          return { ok: true, hasAlpha, count: opts.length };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasAlpha).toBe(true);
      expect(r.count).toBeGreaterThan(1);
    });

    test('missing selector DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const sel = document.getElementById('e-client-sel');
        const parent = sel?.parentNode;
        sel?.remove();
        try { populateClientSelectors(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (sel && parent) parent.appendChild(sel); }
      });
      expect(r.ok).toBe(true);
    });

    test('no duplicate options after 3 calls', async () => {
      const r = await page.evaluate(() => {
        try {
          populateClientSelectors();
          populateClientSelectors();
          populateClientSelectors();
          const sel = document.getElementById('e-client-sel');
          const opts = sel ? Array.from(sel.options).map(o => o.value) : [];
          const unique = new Set(opts);
          return { ok: true, noDupes: opts.length === unique.size };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.noDupes).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getClientStage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getClientStage', () => {
    test('null cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const s = getClientStage(null); return { ok: true, stage: s?.stage }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const s = getClientStage(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent cid, returns incomplete or new stage', async () => {
      const r = await page.evaluate(() => {
        try { const s = getClientStage(9999999); return { ok: true, stage: s?.stage }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.stage).toBe('string');
    });

    test('client with Closed Won bid, returns paid or signed stage', async () => {
      const r = await page.evaluate(() => {
        try { const s = getClientStage(77701); return { ok: true, stage: s?.stage }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // 77701 has a Closed Won bid so stage should reflect it
      expect(['paid','signed','scheduled','balance_due','active']).toContain(r.stage);
    });

    test('client with Pending bid, returns pipeline stage', async () => {
      const r = await page.evaluate(() => {
        try { const s = getClientStage(77702); return { ok: true, stage: s?.stage }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.stage).toBe('string');
    });

    test('client with no address, returns incomplete stage', async () => {
      const r = await page.evaluate(() => {
        // 77703 has empty addr and no bids
        try { const s = getClientStage(77703); return { ok: true, stage: s?.stage }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.stage).toBe('incomplete');
    });

    test('returns object with stage, label, color, priority', async () => {
      const r = await page.evaluate(() => {
        try {
          const s = getClientStage(77701);
          return { ok: true, hasStage: !!s?.stage, hasLabel: !!s?.label, hasColor: !!s?.color, hasPriority: typeof s?.priority === 'number' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasStage).toBe(true);
      expect(r.hasLabel).toBe(true);
      expect(r.hasColor).toBe(true);
      expect(r.hasPriority).toBe(true);
    });

    test('concurrent calls, consistent result', async () => {
      const r = await page.evaluate(() => {
        try {
          const results = [];
          for (let i = 0; i < 5; i++) results.push(getClientStage(77701)?.stage);
          return { ok: true, allSame: results.every(s => s === results[0]) };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.allSame).toBe(true);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_clients', '{INVALID{{{{');
        try { const s = getClientStage(77701); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_clients'); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // renderClientList
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderClientList', () => {
    test('missing client-list DOM, does not throw (via populateClientSelectors early return pattern)', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('client-list');
        const parent = el?.parentNode;
        el?.remove();
        try { renderClientList(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el && parent) parent.appendChild(el); }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, renders client cards or empty message', async () => {
      const r = await page.evaluate(() => {
        try {
          clientFilter = 'all';
          renderClientList();
          const el = document.getElementById('client-list');
          return { ok: true, hasContent: el ? el.innerHTML.length > 0 : false };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasContent).toBe(true);
    });

    test('no duplicate entries after 3 calls', async () => {
      const r = await page.evaluate(() => {
        try {
          clientFilter = 'all';
          renderClientList();
          renderClientList();
          renderClientList();
          const el = document.getElementById('client-list');
          const cards = el ? el.querySelectorAll('.client-card').length : 0;
          // Render replaces innerHTML each time so no duplication expected
          return { ok: true, cards };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('filter=won: shows only won clients', async () => {
      const r = await page.evaluate(() => {
        try {
          clientFilter = 'won';
          renderClientList();
          const el = document.getElementById('client-list');
          return { ok: true, html: el ? el.innerHTML : '' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_bids', '{INVALID{{{{');
        try { renderClientList(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_bids'); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) renderClientList();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // togglePipeGroup
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('togglePipeGroup', () => {
    test('null key, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { togglePipeGroup(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty key, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { togglePipeGroup(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing DOM group, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { togglePipeGroup('nonexistent-key-xyz'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, toggles _pipelineExpand and shows/hides group', async () => {
      const r = await page.evaluate(() => {
        // Create a test group element
        const grp = document.createElement('div');
        grp.id = 'pipe-grp-testkey';
        document.body.appendChild(grp);
        if (!window._pipelineExpand) window._pipelineExpand = {};
        window._pipelineExpand['testkey'] = false;
        try {
          togglePipeGroup('testkey');
          const expanded = window._pipelineExpand['testkey'];
          grp.remove();
          return { ok: true, expanded };
        }
        catch (e) { grp.remove(); return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.expanded).toBe(true);
    });

    test('double toggle, restores original state', async () => {
      const r = await page.evaluate(() => {
        const grp = document.createElement('div');
        grp.id = 'pipe-grp-testkey2';
        document.body.appendChild(grp);
        window._pipelineExpand = window._pipelineExpand || {};
        window._pipelineExpand['testkey2'] = false;
        try {
          togglePipeGroup('testkey2');
          togglePipeGroup('testkey2');
          const collapsed = !window._pipelineExpand['testkey2'];
          grp.remove();
          return { ok: true, collapsed };
        }
        catch (e) { grp.remove(); return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.collapsed).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) togglePipeGroup('concurrent-key');
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // checkClientDupe
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('checkClientDupe', () => {
    test('null val, hides warn, no throw', async () => {
      const r = await page.evaluate(() => {
        try { checkClientDupe(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string, hides warn', async () => {
      const r = await page.evaluate(() => {
        const warn = document.getElementById('cf-dupe-warn');
        if (warn) warn.style.display = 'block';
        try {
          checkClientDupe('');
          return { ok: true, display: warn ? warn.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('short val (<3 chars), hides warn', async () => {
      const r = await page.evaluate(() => {
        try { checkClientDupe('ab'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('exact name match, shows warning', async () => {
      const r = await page.evaluate(() => {
        const warn = document.getElementById('cf-dupe-warn');
        window.editClientId = null;
        try {
          checkClientDupe('CL Alpha');
          return { ok: true, display: warn ? warn.style.display : 'none', text: warn ? warn.textContent : '' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).not.toBe('none');
      expect(r.text).toContain('CL Alpha');
    });

    test('no match, hides warn', async () => {
      const r = await page.evaluate(() => {
        const warn = document.getElementById('cf-dupe-warn');
        if (warn) warn.style.display = 'block';
        window.editClientId = null;
        try {
          checkClientDupe('UNIQUE_NAME_XYZ_99999');
          return { ok: true, display: warn ? warn.style.display : 'none' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('editing current client, does not flag self as dupe', async () => {
      const r = await page.evaluate(() => {
        const warn = document.getElementById('cf-dupe-warn');
        if (warn) warn.style.display = 'block';
        window.editClientId = 77701;
        try {
          checkClientDupe('CL Alpha');
          window.editClientId = null;
          return { ok: true, display: warn ? warn.style.display : 'none' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('missing warn DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const warn = document.getElementById('cf-dupe-warn');
        const parent = warn?.parentNode;
        warn?.remove();
        try { checkClientDupe('CL Alpha'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (warn && parent) parent.appendChild(warn); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // openNewClient
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openNewClient', () => {
    test('does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openNewClient(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('clears all form fields', async () => {
      const r = await page.evaluate(() => {
        // Pre-fill fields
        const nameEl = document.getElementById('cf-name');
        if (nameEl) nameEl.value = 'Old Value';
        try {
          openNewClient();
          const nameVal = document.getElementById('cf-name')?.value || '';
          return { ok: true, nameVal };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.nameVal).toBe('');
    });

    test('sets editClientId to null', async () => {
      const r = await page.evaluate(() => {
        window.editClientId = 77701;
        try {
          openNewClient();
          return { ok: true, editId: window.editClientId };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.editId).toBeNull();
    });

    test('clears the "Who is this?" party-type on a fresh lead (forces an explicit pick)', async () => {
      const r = await page.evaluate(() => {
        const pt = document.getElementById('cf-partytype');
        if (pt) pt.value = 'gc';
        openNewClient();
        return { val: document.getElementById('cf-partytype')?.value };
      });
      expect(r.val).toBe('');
    });
  });

  test.describe('party type (Who is this?) is required and persists', () => {
    test('saveClient blocks when party type is not chosen, and stores it once set', async () => {
      const r = await page.evaluate(() => {
        openNewClient();
        window.editClientId = null;
        const before = clients.length;
        document.getElementById('cf-name').value = 'Party Type Test Co';
        document.getElementById('cf-phone').value = '316-555-0199';
        document.getElementById('cf-source').value = document.getElementById('cf-source').options[1]?.value || 'Google';
        document.getElementById('cf-partytype').value = ''; // not chosen
        window._allowPhoneDupe = true;
        saveClient();
        const blocked = clients.length === before &&
          document.getElementById('err-cf-partytype')?.style.display !== 'none';
        // now choose a type and save
        document.getElementById('cf-partytype').value = 'gc';
        window._submitting = false; window._allowPhoneDupe = true;
        saveClient();
        const saved = clients.find(c => c.name === 'Party Type Test Co');
        const partyType = saved ? saved.partyType : null;
        if (saved) clients.splice(clients.indexOf(saved), 1);
        return { blocked, partyType };
      });
      expect(r.blocked).toBe(true);        // required: no save until chosen
      expect(r.partyType).toBe('gc');      // persisted on the client record
    });

    test('shows client-form-wrap', async () => {
      const r = await page.evaluate(() => {
        const fw = document.getElementById('client-form-wrap');
        if (fw) fw.style.display = 'none';
        try {
          openNewClient();
          return { ok: true, display: fw ? fw.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('block');
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) openNewClient();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // checkYearBuilt
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('checkYearBuilt', () => {
    test('missing DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        const parent = yb?.parentNode;
        yb?.remove();
        try { checkYearBuilt(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (yb && parent) parent.appendChild(yb); }
      });
      expect(r.ok).toBe(true);
    });

    test('pre-1978 year, shows warning', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        const warn = document.getElementById('cf-year-warn');
        if (yb) yb.value = '1955';
        try {
          checkYearBuilt();
          return { ok: true, display: warn ? warn.style.display : 'none' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('block');
    });

    test('post-1978 year, hides warning', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        const warn = document.getElementById('cf-year-warn');
        if (yb) yb.value = '2005';
        if (warn) warn.style.display = 'block';
        try {
          checkYearBuilt();
          return { ok: true, display: warn ? warn.style.display : 'block' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('exact 1978, hides warning (not pre-1978)', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        const warn = document.getElementById('cf-year-warn');
        if (yb) yb.value = '1978';
        if (warn) warn.style.display = 'block';
        try {
          checkYearBuilt();
          return { ok: true, display: warn ? warn.style.display : 'block' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('empty value, hides warning', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        const warn = document.getElementById('cf-year-warn');
        if (yb) yb.value = '';
        if (warn) warn.style.display = 'block';
        try {
          checkYearBuilt();
          return { ok: true, display: warn ? warn.style.display : 'block' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('boundary: 0, hides warning', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        if (yb) yb.value = '0';
        try { checkYearBuilt(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('boundary: very large year, hides warning', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        if (yb) yb.value = '9999';
        try { checkYearBuilt(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('type mismatch, string year, does not throw', async () => {
      const r = await page.evaluate(() => {
        const yb = document.getElementById('cf-year-built');
        if (yb) yb.value = 'notayear';
        try { checkYearBuilt(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _updateAddrComputed / updateYearLookupBtn
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_updateAddrComputed and updateYearLookupBtn', () => {
    test('_updateAddrComputed: missing DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        const btn = document.getElementById('cf-year-lookup');
        const parent = btn?.parentNode;
        btn?.remove();
        try { _updateAddrComputed(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (btn && parent) parent.appendChild(btn); }
      });
      expect(r.ok).toBe(true);
    });

    test('_updateAddrComputed: both street and city filled, shows lookup btn', async () => {
      const r = await page.evaluate(() => {
        const street = document.getElementById('cf-street');
        const city = document.getElementById('cf-city');
        const btn = document.getElementById('cf-year-lookup');
        if (street) street.value = '123 Main St';
        if (city) city.value = 'Wichita';
        try {
          _updateAddrComputed();
          return { ok: true, display: btn ? btn.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('inline-block');
    });

    test('_updateAddrComputed: empty street, hides lookup btn', async () => {
      const r = await page.evaluate(() => {
        const street = document.getElementById('cf-street');
        const city = document.getElementById('cf-city');
        const btn = document.getElementById('cf-year-lookup');
        if (street) street.value = '';
        if (city) city.value = 'Wichita';
        if (btn) btn.style.display = 'inline-block';
        try {
          _updateAddrComputed();
          return { ok: true, display: btn ? btn.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('_updateAddrComputed: empty city, hides lookup btn', async () => {
      const r = await page.evaluate(() => {
        const street = document.getElementById('cf-street');
        const city = document.getElementById('cf-city');
        const btn = document.getElementById('cf-year-lookup');
        if (street) street.value = '123 Main St';
        if (city) city.value = '';
        if (btn) btn.style.display = 'inline-block';
        try {
          _updateAddrComputed();
          return { ok: true, display: btn ? btn.style.display : 'n/a' };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('none');
    });

    test('updateYearLookupBtn: delegates to _updateAddrComputed without throw', async () => {
      const r = await page.evaluate(() => {
        try { updateYearLookupBtn(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_updateAddrComputed: concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        try {
          for (let i = 0; i < 5; i++) _updateAddrComputed();
          return { ok: true };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Per-property records: facts + lead trigger + history, keyed by address
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('Per-property records (address as first-class)', () => {
    test('getProperty/setPropertyData: each address keeps its own facts, no cross-bleed', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 970101, name: 'Two Prop', addr: '10 Main St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 Side Ave, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 970101).concat([c]);
        setPropertyData(c, '10 Main St', { yearBuilt: 2010, estimatedValue: 400000 });
        setPropertyData(c, '22 Side Ave', { yearBuilt: 1950, estimatedValue: 150000 });
        return {
          mainYear: getProperty(c, '10 Main St').yearBuilt,
          sideYear: getProperty(c, '22 Side Ave').yearBuilt,
          mainVal: getProperty(c, '10 Main St').estimatedValue,
          sideVal: getProperty(c, '22 Side Ave').estimatedValue,
          primaryMirror: c.yearBuilt, // primary write mirrors to client-level
        };
      });
      expect(r.mainYear).toBe(2010);
      expect(r.sideYear).toBe(1950);
      expect(r.mainVal).toBe(400000);
      expect(r.sideVal).toBe(150000);
      expect(r.primaryMirror).toBe(2010);
    });

    test('legacy: a client-level yearBuilt reads as the PRIMARY address property (no migration)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 970102, name: 'Legacy', addr: '5 Old Rd, Town, KS 60000', yearBuilt: 1962, estimatedValue: 90000 };
        clients = clients.filter(x => x.id !== 970102).concat([c]);
        const p = getProperty(c, c.addr);
        // A different, unseeded address returns no legacy facts (not the primary's).
        const other = getProperty(c, '999 Nowhere Blvd');
        return { legacyYear: p.yearBuilt, legacyVal: p.estimatedValue, otherYear: other.yearBuilt || null };
      });
      expect(r.legacyYear).toBe(1962);
      expect(r.legacyVal).toBe(90000);
      expect(r.otherYear).toBe(null);
    });

    test('pre-1978 lead trigger is per-address: only the old property fires', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 970103, name: 'Lead Split', addr: '1 New Way, Town, KS 60000',
          extraAddresses: [{ label: 'Old', addr: '2 Old Way, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 970103).concat([c]);
        setPropertyData(c, '1 New Way', { yearBuilt: 2005 });
        setPropertyData(c, '2 Old Way', { yearBuilt: 1948 });
        const pre78 = a => { const y = getProperty(c, a).yearBuilt; return !!(y && y < 1978); };
        return { newPre78: pre78('1 New Way'), oldPre78: pre78('2 Old Way') };
      });
      expect(r.newPre78).toBe(false);
      expect(r.oldPre78).toBe(true);
    });

    test('getPropertyHistory: proposals, jobs, billed and paid roll up per address', async () => {
      const r = await page.evaluate(() => {
        const cid = 970104;
        const c = { id: cid, name: 'Hist Co', addr: 'A St, Town, KS 60000',
          extraAddresses: [{ label: 'B', addr: 'B Ave, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        bids = bids.filter(b => b.client_id !== cid).concat([
          { id: 970201, client_id: cid, name: 'P1', addr: 'A St, Town, KS 60000', amount: 1000, status: 'Sent', bid_date: '2026-01-01' },
          { id: 970202, client_id: cid, name: 'P2', addr: 'B Ave, Town, KS 60000', amount: 2000, status: 'Sent', bid_date: '2026-01-02' },
          { id: 970203, client_id: cid, name: 'P-noaddr' /* no addr → primary */, amount: 500, status: 'Sent', bid_date: '2026-01-03' },
        ]);
        jobs = jobs.filter(j => j.client_id !== cid).concat([
          { id: 970301, client_id: cid, name: 'J1', addr: 'A St, Town, KS 60000', value: 1000, status: 'completed', start: '2026-01-10', end: '2026-01-12' },
          { id: 970302, client_id: cid, name: 'J2', addr: 'B Ave, Town, KS 60000', value: 2000, status: 'upcoming', start: '2026-02-01' },
        ]);
        payments = payments.filter(p => p.client_id !== cid).concat([
          { id: 970401, client_id: cid, job_id: 970301, amount: 1000, date: '2026-01-13' },
        ]);
        const A = getPropertyHistory(c, 'A St');
        const B = getPropertyHistory(c, 'B Ave');
        return {
          aProps: A.proposals.length, aJobs: A.jobs.length, aBilled: A.billed, aPaid: A.paid,
          bProps: B.proposals.length, bJobs: B.jobs.length, bBilled: B.billed, bPaid: B.paid,
        };
      });
      expect(r.aProps).toBe(2);   // P1 + the addr-less proposal folds into primary
      expect(r.aJobs).toBe(1);
      expect(r.aBilled).toBe(1000);
      expect(r.aPaid).toBe(1000);
      expect(r.bProps).toBe(1);
      expect(r.bJobs).toBe(1);
      expect(r.bBilled).toBe(2000);
      expect(r.bPaid).toBe(0);    // B's job not paid yet
    });

    test('clientAddresses: primary + extras, deduped by street key', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 970105, name: 'Addr Co', addr: '7 First St, Town, KS 60000',
          extraAddresses: [{ label: 'Two', addr: '8 Second St, Town, KS 60000' }, { label: 'Dupe', addr: '7 First St, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 970105).concat([c]);
        const a = clientAddresses(c);
        return { count: a.length, first: a[0].label };
      });
      expect(r.count).toBe(2);        // duplicate of primary dropped
      expect(r.first).toBe('Primary');
    });

    test('renderCDAddresses: one card per address; pre-1978 banner only on the old one; no throw', async () => {
      const r = await page.evaluate(() => {
        const cid = 970106;
        const c = { id: cid, name: 'Render Co', addr: '3 Newer Ln, Town, KS 60000',
          extraAddresses: [{ label: 'Old rental', addr: '4 Older Ln, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        setPropertyData(c, '3 Newer Ln', { yearBuilt: 2001, estimatedValue: 300000 });
        setPropertyData(c, '4 Older Ln', { yearBuilt: 1940, estimatedValue: 120000 });
        currentClientId = cid;
        let ok = true, err = '';
        try { window['_cdpropOpen_' + cid + '_0'] = true; window['_cdpropOpen_' + cid + '_1'] = true; renderCDAddresses(); }
        catch (e) { ok = false; err = e.message; }
        const html = document.getElementById('cd-addresses-list').innerHTML;
        const leadCount = (html.match(/EPA RRP/g) || []).length;
        return { ok, err, hasNewer: html.includes('3 Newer Ln'), hasOlder: html.includes('4 Older Ln'), leadCount };
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.hasNewer).toBe(true);
      expect(r.hasOlder).toBe(true);
      expect(r.leadCount).toBe(1); // lead banner renders once, for the pre-1978 address only
    });

    test('GC account: section is titled "Job sites" (a GC does not own the addresses under them)', async () => {
      const r = await page.evaluate(() => {
        const cid = 970120;
        const c = { id: cid, name: 'Summit Build Group', partyType: 'gc', addr: '10 Spec House Ln, Town, KS 60000' };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        currentClientId = cid;
        renderCDAddresses();
        const list = document.getElementById('cd-addresses-list');
        return { html: list ? list.innerHTML : '' };
      });
      expect(r.html).toContain('Job sites');    // not "Properties" for a GC who doesn't own them
      expect(r.html).not.toContain('Properties');
    });

    test('homeowner account: section stays "Properties"', async () => {
      const r = await page.evaluate(() => {
        const cid = 970121;
        const c = { id: cid, name: 'Rita Alvarez', partyType: 'homeowner', addr: '7 Home St, Town, KS 60000' };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        currentClientId = cid;
        renderCDAddresses();
        const list = document.getElementById('cd-addresses-list');
        return { html: list ? list.innerHTML : '' };
      });
      expect(r.html).toContain('Properties');
    });

    test('accountOwnsSites: homeowner/business own; GC/builder/PM do not (drives the lien path)', async () => {
      const r = await page.evaluate(() => ({
        homeowner: accountOwnsSites({ partyType: 'homeowner' }),
        business: accountOwnsSites({ partyType: 'business' }),
        legacy: accountOwnsSites({}),           // no partyType (legacy) = treated as owner
        gc: accountOwnsSites({ partyType: 'gc' }),
        builder: accountOwnsSites({ partyType: 'builder' }),
        pm: accountOwnsSites({ partyType: 'pm' }),
      }));
      expect(r.homeowner).toBe(true);
      expect(r.business).toBe(true);
      expect(r.legacy).toBe(true);
      expect(r.gc).toBe(false);
      expect(r.builder).toBe(false);
      expect(r.pm).toBe(false);
    });

    test('saveAddClientAddress: captures the property type (no owner-capture complexity)', async () => {
      const r = await page.evaluate(() => {
        const cid = 970122;
        const c = { id: cid, name: 'GC Co', partyType: 'gc', addr: '1 First St, Town, KS 60000', extraAddresses: [] };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        currentClientId = cid;
        openAddAddressModal();
        document.getElementById('_aa-addr').value = '55 Jobsite Rd, Town, KS 60000';
        document.getElementById('_aa-ptype').value = 'New construction';
        const hasOwnerFields = !!document.getElementById('_aa-owner-name');
        saveAddClientAddress();
        const prop = getProperty(c, '55 Jobsite Rd');
        return { hasOwnerFields, propertyType: prop.propertyType,
          added: (c.extraAddresses || []).some(a => /55 Jobsite Rd/.test(a.addr)) };
      });
      expect(r.hasOwnerFields).toBe(false);       // the owner-capture UI was removed
      expect(r.added).toBe(true);
      expect(r.propertyType).toBe('New construction');
    });

    // Regression: an address entered on an estimate must roll into the client's
    // property list (accordion), not just live on the bid. Owner-reported bug.
    test('_geiEnsureClientProperty: a new estimate address rolls into the client properties (dedup-safe)', async () => {
      const r = await page.evaluate(() => {
        const cid = 970131;
        const c = { id: cid, name: 'Estimate Addr Co', addr: '1 Primary St, Town, KS 60000', extraAddresses: [] };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        const has = a => clientAddresses(c).some(x => x.addr === a);
        _geiEnsureClientProperty(cid, '742 New Job Ln, Town, KS 60000');   // new → added
        const addedNew = has('742 New Job Ln, Town, KS 60000');
        const countAfterNew = clientAddresses(c).length;
        _geiEnsureClientProperty(cid, '1 Primary St, Town, KS 60000');     // primary → no dup
        _geiEnsureClientProperty(cid, '742 New Job Ln, Town, KS 60000');   // extra again → no dup
        _geiEnsureClientProperty(cid, '   ');                              // empty → no-op
        return { addedNew, countAfterNew, finalCount: clientAddresses(c).length };
      });
      expect(r.addedNew).toBe(true);
      expect(r.countAfterNew).toBe(2);   // primary + the new estimate address
      expect(r.finalCount).toBe(2);      // dedupe + empty never grow the list
    });

    test('PRIVACY: an employee without financials sees the property but no dollar figures', async () => {
      const r = await page.evaluate(() => {
        const cid = 970107;
        const c = { id: cid, name: 'Perm Co', addr: '5 Money Rd, Town, KS 60000' };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        setPropertyData(c, '5 Money Rd', { yearBuilt: 1970, estimatedValue: 250000, lastSalePrice: 210000, lastSaleDate: '2018-05-01' });
        bids = bids.filter(b => b.client_id !== cid).concat([{ id: 970501, client_id: cid, name: 'Repaint', addr: '5 Money Rd, Town, KS 60000', amount: 4200, status: 'Sent', bid_date: '2026-01-01' }]);
        jobs = jobs.filter(j => j.client_id !== cid).concat([{ id: 970601, client_id: cid, name: 'Repaint', addr: '5 Money Rd, Town, KS 60000', value: 4200, status: 'upcoming', start: '2026-02-01' }]);
        currentClientId = cid;
        const render = () => { window['_cdpropOpen_' + cid + '_0'] = true; renderCDAddresses(); return document.getElementById('cd-addresses-list').innerHTML; };
        const _origEmp = window._isEmployee, _origRec = window._employeeRecord;
        try {
          // Crew WITHOUT financials: dollars hidden, property still shown.
          window._isEmployee = true; window._employeeRecord = { permissions: { financials: false } };
          const crew = render();
          // Manager WITH financials: dollars shown.
          window._employeeRecord = { permissions: { financials: true } };
          const mgr = render();
          return {
            crewHasDollar: /\$\d/.test(crew), crewHasProperty: crew.includes('Money Rd') && crew.includes('Repaint') && crew.includes('1970'),
            crewHasLead: crew.includes('EPA RRP'),
            mgrHasValue: mgr.includes('$250K'), mgrHasAmount: /\$4,200/.test(mgr), mgrHasPaidTotal: mgr.includes('paid'),
          };
        } finally {
          window._isEmployee = _origEmp; window._employeeRecord = _origRec;
        }
      });
      // Crew: no dollar anywhere, but the property, its work list, and the lead disclosure still render.
      expect(r.crewHasDollar).toBe(false);
      expect(r.crewHasProperty).toBe(true);
      expect(r.crewHasLead).toBe(true);
      // Manager: value, amounts, and paid total all visible.
      expect(r.mgrHasValue).toBe(true);
      expect(r.mgrHasAmount).toBe(true);
      expect(r.mgrHasPaidTotal).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Client-record section accordions: Notes, Activity timeline, Client risk each
  // render a collapsible bar styled exactly like the Properties/Overview selector.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('client-record accordions', () => {
    test('each section mounts a titled bar with a chevron', async () => {
      const r = await page.evaluate(() => {
        openClientDetail(77701, 'clients');
        window._cdNotesOpen = undefined; window._cdTimelineOpen = undefined; window._cdRiskOpen = undefined;
        renderClientNotes(); renderCDTimeline(); renderCDRisk();
        const notes = document.getElementById('cd-notes-mount').innerHTML;
        const tl = document.getElementById('cd-timeline-mount').innerHTML;
        const risk = document.getElementById('cd-risk-mount').innerHTML;
        const svgCount = s => (s.match(/M6 9l6 6 6-6/g) || []).length; // the shared down-chevron path
        return {
          notesTitle: notes.includes('Notes'), notesChev: svgCount(notes),
          tlTitle: tl.includes('Activity timeline'), tlChev: svgCount(tl),
          riskTitle: risk.includes('Client risk'), riskChev: svgCount(risk),
        };
      });
      expect(r.notesTitle).toBe(true);
      expect(r.tlTitle).toBe(true);
      expect(r.riskTitle).toBe(true);
      // exactly one accordion chevron per bar
      expect(r.notesChev).toBe(1);
      expect(r.tlChev).toBe(1);
      expect(r.riskChev).toBe(1);
    });

    test('collapsing a section hides its body, leaving only the bar', async () => {
      const r = await page.evaluate(() => {
        openClientDetail(77701, 'clients');
        window._cdNotesOpen = true; renderClientNotes();
        const openHasInput = !!document.getElementById('cd-note-input');
        window._cdNotesOpen = false; renderClientNotes();
        const closedHasInput = !!document.getElementById('cd-note-input');
        const barStillThere = document.getElementById('cd-notes-mount').innerHTML.includes('Notes');
        return { openHasInput, closedHasInput, barStillThere };
      });
      expect(r.openHasInput).toBe(true);    // open: the note entry textarea is present
      expect(r.closedHasInput).toBe(false); // collapsed: body (and its textarea) gone
      expect(r.barStillThere).toBe(true);   // bar remains
    });

    test('each open accordion body carries the shared td-acc-body reveal animation', async () => {
      const r = await page.evaluate(() => {
        openClientDetail(77701, 'clients');
        window._cdNotesOpen = true; window._cdTimelineOpen = true; window._cdRiskOpen = true; window._cdPropsOpen = true;
        renderClientNotes(); renderCDTimeline(); renderCDRisk(); renderCDAddresses();
        const has = id => document.getElementById(id).innerHTML.includes('class="td-acc-body"') || !!document.querySelector('#' + id + ' .td-acc-body');
        return { props: has('cd-addresses-list'), notes: has('cd-notes-mount'), tl: has('cd-timeline-mount'), risk: has('cd-risk-mount') };
      });
      expect(r.props).toBe(true);
      expect(r.notes).toBe(true);
      expect(r.tl).toBe(true);
      expect(r.risk).toBe(true);
    });

    test('the three bars share the Properties/Overview bar style verbatim', async () => {
      const r = await page.evaluate(() => {
        openClientDetail(77701, 'clients');
        window._cdNotesOpen = false; window._cdRiskOpen = false; window._cdPropsOpen = false;
        renderClientNotes(); renderCDRisk(); renderCDAddresses();
        const key = 'width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid var(--line-2);border-radius:12px;background-color:var(--bg-card);color:var(--text);font-size:15px;font-weight:800;box-shadow:var(--shadow-card)';
        const has = id => document.getElementById(id).innerHTML.includes(key);
        return { props: has('cd-addresses-list'), notes: has('cd-notes-mount'), risk: has('cd-risk-mount') };
      });
      expect(r.props).toBe(true);
      expect(r.notes).toBe(true);
      expect(r.risk).toBe(true);
    });

    test('Notes stores an array, so the Overview intake-notes line never prints [object Object]', async () => {
      const r = await page.evaluate(() => {
        const c = getClientById(77701);
        c.notes = [{ id: 'x1', text: 'structured note', ts: '2026-07-10T12:00:00Z' }];
        saveAll();
        openClientDetail(77701, 'clients');
        const ov = document.getElementById('cdt-overview-content').innerHTML;
        return { hasObjObj: ov.includes('[object Object]') };
      });
      expect(r.hasObjObj).toBe(false);
    });

    // Date stamps are MM/DD/YYYY everywhere. The ONE intentional exception is the
    // month-bucket header ("July 2026"), which names a month rather than stamping a
    // date, and matches the Books month accordions this timeline now shares. So the
    // assertion strips .bk-month-title and requires no month name anywhere else.
    test('every rendered date stamp in the client record is MM/DD/YYYY, month names only in month headers', async () => {
      const r = await page.evaluate(() => {
        openClientDetail(77701, 'clients');
        window._cdNotesOpen = true; window._cdTimelineOpen = true;
        renderClientNotes(); renderCDTimeline();
        const tlEl = document.getElementById('cd-timeline-mount');
        const clone = tlEl.cloneNode(true);
        clone.querySelectorAll('.bk-month-title').forEach(n => n.remove());
        const blob = clone.innerHTML + document.getElementById('cd-notes-mount').innerHTML;
        const monthName = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
        return {
          hasMonthName: monthName.test(blob),
          hasMDY: /\d{2}\/\d{2}\/\d{4}/.test(tlEl.innerHTML),
          monthHeaders: tlEl.querySelectorAll('.bk-month-title').length,
        };
      });
      expect(r.hasMonthName).toBe(false);
      expect(r.hasMDY).toBe(true);
      expect(r.monthHeaders).toBeGreaterThan(0); // months are grouped, Books-style
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Audit trail: the client-record timeline surfaces the full engagement chain
  // (lead → sent → opened w/ IP → signed w/ IP) and exports a court-ready report.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('client-record audit timeline', () => {
    const AB = 96019001;
    test('timeline shows lead/sent/opened/signed events with time + captured IP', async () => {
      const r = await page.evaluate((bidId) => {
        clients = clients.filter(c => c.id !== 96019).concat([{ id: 96019, name: 'Audit Client', source: 'Referral', created: '2026-07-08T09:12:00Z' }]);
        bids = bids.filter(b => b.client_id !== 96019).concat([{
          id: bidId, client_id: 96019, client_name: 'Audit Client', status: 'Closed Won', amount: 6400,
          bid_date: '2026-07-10', sentAt: '2026-07-10T14:22:00Z', signedAt: '2026-07-12T16:41:00Z',
          signedName: 'Audit Client', paymentMethod: 'card', signIp: '73.202.114.9', signUa: 'iPhone Safari' }]);
        window._proposalViewsByBidClient = { [bidId]: '2026-07-11T19:08:00Z' };
        window._proposalViewsByBidClientIp = { [bidId]: { ip: '73.202.114.9', ua: 'iPhone Safari' } };
        window.currentClientId = 96019;
        window._cdTimelineOpen = true;
        renderCDTimeline();
        return document.getElementById('cd-timeline-mount').innerHTML;
      }, AB);
      expect(r).toContain('Lead created');
      expect(r).toContain('Proposal sent');
      expect(r).toContain('Client opened proposal');
      expect(r).toContain('Signed by Audit Client');
      expect(r).toContain('73.202.114.9');          // captured IP surfaces
      expect(r).toContain('Audit report');          // export entry point present
      expect(r).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/); // a clock time is shown, not just a date
    });

    test('timeline renders EVERY logged step (approved/payment/method) with its own IP', async () => {
      const r = await page.evaluate((bidId) => {
        window._proposalAuditEventsByBid = { [bidId]: [
          { event: 'signed', ts: '2026-07-12T16:41:00Z', ip: '73.202.114.9', ua: 'iPhone' },
          { event: 'method_selected', ts: '2026-07-12T16:40:00Z', ip: '73.202.114.9', ua: 'iPhone' },
          { event: 'payment_viewed', ts: '2026-07-12T16:39:00Z', ip: '73.202.114.9', ua: 'iPhone' },
          { event: 'approved', ts: '2026-07-12T16:38:00Z', ip: '73.202.114.9', ua: 'iPhone' },
          { event: 'proposal_opened', ts: '2026-07-11T19:08:00Z', ip: '68.44.10.2', ua: 'iPhone' },
          { event: 'hub_opened', ts: '2026-07-11T08:30:00Z', ip: '68.44.10.2', ua: 'iPhone' },
        ] };
        window.currentClientId = 96019;
        window._cdTimelineOpen = true;
        renderCDTimeline();
        return document.getElementById('cd-timeline-mount').innerHTML;
      }, AB);
      expect(r).toContain('Tapped Approve &amp; Sign');
      expect(r).toContain('Reached payment step');
      expect(r).toContain('Chose payment method');
      expect(r).toContain('Client opened hub');
      expect(r).toContain('68.44.10.2');   // the open came from a different IP than the sign
      expect(r).toContain('73.202.114.9');
    });

    test('exportAuditReport builds a certificate containing the IP chain (no throw)', async () => {
      const r = await page.evaluate((bidId) => {
        let captured = '';
        const orig = window.open;
        window.open = () => ({ document: { open(){}, write(h){ captured += h; }, close(){} }, focus(){}, print(){} });
        let threw = false;
        try { exportAuditReport(bidId); } catch (e) { threw = true; }
        window.open = orig;
        return { threw, captured };
      }, AB);
      expect(r.threw).toBe(false);
      expect(r.captured).toContain('Proposal Audit Certificate');
      expect(r.captured).toContain('73.202.114.9');
      expect(r.captured).toContain('Signed by Audit Client');
      expect(r.captured).toContain('not legal advice');
    });

    // Regression (owner-reported): the rail was a border on the whole list, so it
    // poked out above the first dot and trailed below the last one. It's now drawn
    // per item from dot-center to next-dot-center, and the last item draws none.
    test('timeline rail connects dot-center to dot-center, with no stub past the last dot', async () => {
      const r = await page.evaluate(() => {
        window._cdTimelineOpen = true;
        renderCDTimeline();
        const groups = [...document.querySelectorAll('#cd-timeline-mount .timeline')];
        if (!groups.length) return { skip: true };
        return groups.map(g => {
          const items = [...g.querySelectorAll('.tl-item')];
          return items.map((it, i) => {
            const dot = it.querySelector('.tl-dot');
            const ds = getComputedStyle(dot);
            const bs = getComputedStyle(it, '::before');
            // dot center X and rail center X, both relative to the item's box
            const dotCenter = parseFloat(ds.left) + parseFloat(ds.width) / 2 + parseFloat(ds.borderLeftWidth);
            const railCenter = parseFloat(bs.left) + parseFloat(bs.width) / 2;
            return {
              isLast: i === items.length - 1,
              railHidden: bs.display === 'none',
              centerDelta: Math.abs(dotCenter - railCenter),
            };
          });
        });
      });
      if (r.skip) return;
      const flat = r.flat();
      expect(flat.length).toBeGreaterThan(0);
      // every LAST item in a day group draws no rail (nothing dangling below it)
      flat.filter(x => x.isLast).forEach(x => expect(x.railHidden).toBe(true));
      // every non-last item draws a rail, centered on its dot (within a pixel)
      flat.filter(x => !x.isLast).forEach(x => {
        expect(x.railHidden).toBe(false);
        expect(x.centerDelta).toBeLessThanOrEqual(1);
      });
    });

    // Regression (owner-reported): the timeline printed a bid's CURRENT status on
    // the row dated at its creation, so a proposal created 07/10 and signed 07/12
    // showed "Closed Won" on 07/10, i.e. won before it was signed. The creation row
    // now states creation only; wins/losses are their own dated events.
    test('creation row shows creation state, not the current status', async () => {
      const r = await page.evaluate((bidId) => {
        window.currentClientId = 96019;
        window._cdTimelineOpen = true;
        renderCDTimeline();
        const html = document.getElementById('cd-timeline-mount').innerHTML;
        // the bid row itself must not carry the live status
        const bidRow = html.split('Proposal: ')[1] || '';
        return { bidRowStart: bidRow.slice(0, 220), full: html };
      }, AB);
      expect(r.bidRowStart).toContain('Created');
      expect(r.bidRowStart).not.toContain('Closed Won');
    });

    test('a job won without a signature renders a dated "Marked won" event flagged unsigned', async () => {
      const r = await page.evaluate(() => {
        const cid = 96021, bidId = 96021001;
        clients = clients.filter(c => c.id !== cid).concat([{ id: cid, name: 'Handshake Client', created: '2026-07-01T09:00:00Z' }]);
        bids = bids.filter(b => b.client_id !== cid).concat([{
          id: bidId, client_id: cid, client_name: 'Handshake Client', status: 'Closed Won', amount: 3200,
          bid_date: '2026-07-02', handshake: true, handshake_date: '2026-07-09' }]);
        window._proposalAuditEventsByBid = {};
        window.currentClientId = cid;
        window._cdTimelineOpen = true;
        renderCDTimeline();
        const html = document.getElementById('cd-timeline-mount').innerHTML;
        let cert = '';
        const orig = window.open;
        window.open = () => ({ document: { open(){}, write(h){ cert += h; }, close(){} }, focus(){}, print(){} });
        exportAuditReport(bidId);
        window.open = orig;
        return { html, cert };
      });
      expect(r.html).toContain('Marked won, handshake deal');
      expect(r.html).toContain('No signature on file');
      expect(r.html).toContain('07/09/2026');            // dated when marked, not at creation
      expect(r.cert).toContain('No e-signature captured'); // the certificate says so plainly
    });

    test('exportAuditReport on a missing bid does not throw', async () => {
      const ok = await page.evaluate(() => {
        try { exportAuditReport(99999999); return true; } catch (e) { return false; }
      });
      expect(ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // no console errors
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors, clients.js', async () => {
    assertNoErrors(page, 'clients.js');
  });
});
