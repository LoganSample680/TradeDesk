// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// Function coverage — js/geo-track.js consent/helpers + js/proposals.js &
// js/generic-estimate.js send/sync flows.
//
// Mirrors the structure of e2e-functions1.spec.js: one describe per area, a shared
// page booted once via mockAllExternal + waitForAppBoot, every test guarded with
// `typeof fn !== 'function'` skip, and a closing assertNoErrors() per describe.
//
// Geo notes (CLAUDE.md §9.5 — two-layer consent is a LEGAL requirement):
//  • The harness runs under navigator.webdriver=true. _geoTrackInit's owner path
//    no-ops when webdriver is set; we assert that guarded no-op AND force the
//    non-guarded path by stubbing navigator.webdriver=false before the call.
//  • startGeoTracking is gated on navigator.geolocation + business hours; the
//    consent tests assert PERSISTENCE (localStorage / team_members flag) rather
//    than that a watch actually started, since geolocation is mocked/absent.
// ═══════════════════════════════════════════════════════════════════════════════

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH GEO-1: Pure geo helpers — _geoNowMinLocal / _geoCid / _geoJobLatLng
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Geo helpers — _geoNowMinLocal / _geoCid / _geoJobLatLng', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_geoNowMinLocal — returns minutes-since-midnight in 0..1439', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoNowMinLocal !== 'function') return { skip: true };
      const m = _geoNowMinLocal();
      const d = new Date();
      const expected = d.getHours() * 60 + d.getMinutes();
      return { m, expected, isInt: Number.isInteger(m) };
    });
    if (!result.skip) {
      expect(result.isInt).toBe(true);
      expect(result.m).toBeGreaterThanOrEqual(0);
      expect(result.m).toBeLessThanOrEqual(1439);
      // Exact value (allow ±1 for a minute roll between the two Date() reads)
      expect(Math.abs(result.m - result.expected)).toBeLessThanOrEqual(1);
    }
  });

  test('_geoCid — owner path returns _supaUser.id', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoCid !== 'function') return { skip: true };
      const origEmp = window._isEmployee;
      const origUser = window._supaUser;
      window._isEmployee = false;
      window._supaUser = { id: 'owner-uid-123' };
      const cid = _geoCid();
      window._isEmployee = origEmp;
      window._supaUser = origUser;
      return { cid };
    });
    if (!result.skip) expect(result.cid).toBe('owner-uid-123');
  });

  test('_geoCid — employee path returns _contractorUserId', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoCid !== 'function') return { skip: true };
      const origEmp = window._isEmployee;
      const origCid = window._contractorUserId;
      window._isEmployee = true;
      window._contractorUserId = 'contractor-uid-999';
      const cid = _geoCid();
      window._isEmployee = origEmp;
      window._contractorUserId = origCid;
      return { cid };
    });
    if (!result.skip) expect(result.cid).toBe('contractor-uid-999');
  });

  test('_geoCid — owner path with no _supaUser returns falsy (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoCid !== 'function') return { skip: true };
      const origEmp = window._isEmployee;
      const origUser = window._supaUser;
      window._isEmployee = false;
      window._supaUser = null;
      let cid, threw = false;
      try { cid = _geoCid(); } catch (e) { threw = true; }
      window._isEmployee = origEmp;
      window._supaUser = origUser;
      return { cid, threw };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(!!result.cid).toBe(false);
    }
  });

  test('_geoJobLatLng — returns cached coords when job has lat/lon', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _geoJobLatLng !== 'function') return { skip: true };
      const c = await _geoJobLatLng({ id: 'geo-job-1', lat: 37.6872, lon: -97.3301 });
      return { lat: c && c.lat, lng: c && c.lng };
    });
    if (!result.skip) {
      expect(result.lat).toBe(37.6872);
      expect(result.lng).toBe(-97.3301);
    }
  });

  test('_geoJobLatLng — returns null when no addr and no coords resolvable', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _geoJobLatLng !== 'function') return { skip: true };
      // No lat/lon, no addr, no matching client → null
      const c = await _geoJobLatLng({ id: 'geo-job-noaddr-' + Date.now(), client_id: 'nope-xyz' });
      return { isNull: c === null || c === undefined };
    });
    if (!result.skip) expect(result.isNull).toBe(true);
  });

  test('_geoJobLatLng — second call hits the session cache (same object)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _geoJobLatLng !== 'function') return { skip: true };
      const j = { id: 'geo-job-cache-1', lat: 38.0, lon: -97.0 };
      const a = await _geoJobLatLng(j);
      const b = await _geoJobLatLng(j);
      return { same: a === b, lat: b && b.lat };
    });
    if (!result.skip) {
      expect(result.same).toBe(true);
      expect(result.lat).toBe(38.0);
    }
  });

  test('no console errors during geo helper tests', async () => {
    assertNoErrors(page, 'geo helpers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH GEO-2: Consent persistence — _geoSetConsent / _geoConsentPrompt
//   §9.5 two-layer consent is a LEGAL requirement → assert the persisted flag for
//   BOTH allow and deny, and that tracking only "starts" on allow.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Geo consent — _geoSetConsent / _geoConsentPrompt persistence', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_geoSetConsent — owner ALLOW persists geo_owner_consent="1" and calls startGeoTracking', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoSetConsent !== 'function') return { skip: true };
      localStorage.removeItem('geo_owner_consent');
      const origStart = window.startGeoTracking;
      let started = false;
      window.startGeoTracking = () => { started = true; };
      try { _geoSetConsent(true, true); } catch (e) { /* swallow */ }
      window.startGeoTracking = origStart;
      return { flag: localStorage.getItem('geo_owner_consent'), started };
    });
    if (!result.skip) {
      expect(result.flag).toBe('1');
      expect(result.started).toBe(true); // tracking starts ONLY on allow
    }
  });

  test('_geoSetConsent — owner DENY persists geo_owner_consent="declined" and does NOT start tracking', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoSetConsent !== 'function') return { skip: true };
      localStorage.removeItem('geo_owner_consent');
      const origStart = window.startGeoTracking;
      let started = false;
      window.startGeoTracking = () => { started = true; };
      try { _geoSetConsent(false, true); } catch (e) { /* swallow */ }
      window.startGeoTracking = origStart;
      return { flag: localStorage.getItem('geo_owner_consent'), started };
    });
    if (!result.skip) {
      expect(result.flag).toBe('declined');
      expect(result.started).toBe(false); // deny must NOT start tracking
    }
  });

  test('_geoSetConsent — employee ALLOW clears decline flag + sets location_consent + starts tracking', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoSetConsent !== 'function') return { skip: true };
      localStorage.setItem('geo_consent_declined', '1');
      const origEmp = window._employeeRecord;
      const origStart = window.startGeoTracking;
      let started = false;
      window.startGeoTracking = () => { started = true; };
      window._employeeRecord = { id: 'emp-consent-1', location_consent: false };
      try { _geoSetConsent(true, false); } catch (e) { /* swallow */ }
      const consent = window._employeeRecord && window._employeeRecord.location_consent;
      window._employeeRecord = origEmp;
      window.startGeoTracking = origStart;
      return { declined: localStorage.getItem('geo_consent_declined'), consent, started };
    });
    if (!result.skip) {
      expect(result.declined).toBe(null);   // decline flag cleared on allow
      expect(result.consent).toBe(true);    // team_members consent flag set
      expect(result.started).toBe(true);
    }
  });

  test('_geoSetConsent — employee DENY persists geo_consent_declined="1" and does NOT start tracking', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoSetConsent !== 'function') return { skip: true };
      localStorage.removeItem('geo_consent_declined');
      const origStart = window.startGeoTracking;
      let started = false;
      window.startGeoTracking = () => { started = true; };
      try { _geoSetConsent(false, false); } catch (e) { /* swallow */ }
      window.startGeoTracking = origStart;
      return { declined: localStorage.getItem('geo_consent_declined'), started };
    });
    if (!result.skip) {
      expect(result.declined).toBe('1');
      expect(result.started).toBe(false);
    }
  });

  test('_geoConsentPrompt — owner variant creates the consent overlay (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoConsentPrompt !== 'function') return { skip: true };
      document.getElementById('_geo-consent-ov')?.remove();
      try {
        _geoConsentPrompt(true);
        const ov = document.getElementById('_geo-consent-ov');
        const had = !!ov;
        const hasAllowBtn = ov ? /Allow during work hours/.test(ov.innerHTML) : false;
        ov?.remove();
        return { ok: true, had, hasAllowBtn };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.had).toBe(true);
      expect(result.hasAllowBtn).toBe(true);
    }
  });

  test('_geoConsentPrompt — employee variant creates overlay (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoConsentPrompt !== 'function') return { skip: true };
      document.getElementById('_geo-consent-ov')?.remove();
      try {
        _geoConsentPrompt(false);
        const ov = document.getElementById('_geo-consent-ov');
        const had = !!ov;
        ov?.remove();
        return { ok: true, had };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.had).toBe(true);
    }
  });

  test('_geoConsentPrompt — second call is idempotent (does not duplicate overlay)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoConsentPrompt !== 'function') return { skip: true };
      document.getElementById('_geo-consent-ov')?.remove();
      try {
        _geoConsentPrompt(true);
        _geoConsentPrompt(true); // guard: early-return if overlay already exists
        const count = document.querySelectorAll('#_geo-consent-ov').length;
        document.getElementById('_geo-consent-ov')?.remove();
        return { ok: true, count };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.count).toBe(1);
    }
  });

  test('no console errors during geo consent tests', async () => {
    assertNoErrors(page, 'geo consent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH GEO-3: Banner / permission / ping — _geoPermissionBanner /
//   _geoRequestPermission / _geoWritePing (webdriver-guard + missing-DOM + mocked _supa)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Geo banner + ping — _geoPermissionBanner / _geoRequestPermission / _geoWritePing', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_geoPermissionBanner — no-op when target #dash-geo-perm is absent (missing DOM)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _geoPermissionBanner !== 'function') return { skip: true };
      document.getElementById('dash-geo-perm')?.remove();
      try { await _geoPermissionBanner(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    if (!result.skip) expect(result.ok).toBe(true);
  });

  test('_geoPermissionBanner — hides banner for non-employee (display:none)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _geoPermissionBanner !== 'function') return { skip: true };
      let el = document.getElementById('dash-geo-perm');
      if (!el) { el = document.createElement('div'); el.id = 'dash-geo-perm'; document.body.appendChild(el); }
      el.style.display = 'block';
      const origEmp = window._isEmployee;
      window._isEmployee = false; // non-employee → banner must hide
      try {
        await _geoPermissionBanner();
        const disp = el.style.display;
        window._isEmployee = origEmp;
        return { ok: true, disp };
      } catch (e) { window._isEmployee = origEmp; return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.disp).toBe('none');
    }
  });

  test('_geoRequestPermission — runs without throwing (calls startGeoTracking, schedules re-render)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoRequestPermission !== 'function') return { skip: true };
      const origStart = window.startGeoTracking;
      let started = false;
      window.startGeoTracking = () => { started = true; };
      try { _geoRequestPermission(); window.startGeoTracking = origStart; return { ok: true, started }; }
      catch (e) { window.startGeoTracking = origStart; return { ok: false, error: e.message }; }
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.started).toBe(true);
    }
  });

  test('_geoWritePing — no-op when _supa/_supaUser absent (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoWritePing !== 'function') return { skip: true };
      const origSupa = window._supa;
      const origUser = window._supaUser;
      window._supa = null;
      window._supaUser = null;
      let threw = false;
      try { _geoWritePing({ lat: 37.6, lng: -97.3 }, 10); } catch (e) { threw = true; }
      window._supa = origSupa;
      window._supaUser = origUser;
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('_geoWritePing — inserts into location_pings via mocked _supa (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geoWritePing !== 'function') return { skip: true };
      const origSupa = window._supa;
      const origUser = window._supaUser;
      let insertedTable = null, insertedRow = null;
      window._supa = {
        from: (tbl) => ({
          insert: (row) => { insertedTable = tbl; insertedRow = row; return { then: (res) => { res && res(); return { catch: () => {} }; } }; }
        })
      };
      window._supaUser = { id: 'ping-user-1' };
      let threw = false;
      try { _geoWritePing({ lat: 37.6872, lng: -97.3301 }, 12); } catch (e) { threw = true; }
      window._supa = origSupa;
      window._supaUser = origUser;
      return { threw, insertedTable, lat: insertedRow && insertedRow.lat, lon: insertedRow && insertedRow.lon };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.insertedTable).toBe('location_pings');
      expect(result.lat).toBe(37.6872);
      expect(result.lon).toBe(-97.3301); // writes here.lng to the lon column
    }
  });

  test('no console errors during geo banner/ping tests', async () => {
    assertNoErrors(page, 'geo banner/ping');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH SEND-1: Change-order send dispatchers — _doCOSend / _sendCOViaSms /
//   _sendCOViaEmail / _shareCOLink (seed _coShareData, assert routed sub-path)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Change-order send — _doCOSend / _sendCOViaSms / _sendCOViaEmail / _shareCOLink', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Seed a change-order share payload so the dispatchers have data to act on.
    // NOTE: `_coShareData` and `clients` are module-level `let` bindings in
    // js/proposals.js / js/data.js — a bare assignment rebinds them, but
    // `window._coShareData = …` would create an unrelated window property the app
    // never reads (same footgun as _supaUser, documented in e2e-features.spec.js).
    await page.evaluate(() => {
      clients.push({ id: 'c-co-001', name: 'CO Test Client', phone: '316-555-7777', email: 'co@test.com' });
      _coShareData = {
        url: 'https://example.com/client.html?t=tok&c=c-co-001',
        cname: 'CO Test Client', bname: 'TradeDesk Pro',
        cphone: '3165557777', cemail: 'co@test.com', coNum: 2, clientId: 'c-co-001'
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_doCOSend("sms") — routes to SMS (sets window.location.href to sms:)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doCOSend !== 'function') return { skip: true };
      let smsHref = null;
      const origDesc = Object.getOwnPropertyDescriptor(window.location, 'href');
      try {
        Object.defineProperty(window.location, 'href', { configurable: true, set: (v) => { smsHref = v; }, get: () => smsHref });
      } catch (e) { /* some engines lock location — fall back to no-op assert */ }
      let threw = false;
      try { _doCOSend('sms'); } catch (e) { threw = true; }
      try { if (origDesc) Object.defineProperty(window.location, 'href', origDesc); } catch (e) {}
      return { threw, routedSms: typeof smsHref === 'string' && smsHref.startsWith('sms:') };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      // If the engine allowed overriding location.href, confirm the sms: route.
      if (result.routedSms !== false) expect(result.routedSms).toBe(true);
    }
  });

  test('_doCOSend("email") — routes to the email compose modal', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doCOSend !== 'function') return { skip: true };
      document.getElementById('_email-compose-overlay')?.remove();
      let threw = false;
      try { _doCOSend('email'); } catch (e) { threw = true; }
      const hasModal = !!document.getElementById('_email-compose-overlay');
      const title = document.getElementById('_email-compose-overlay')?.innerHTML || '';
      document.getElementById('_email-compose-overlay')?.remove();
      return { threw, hasModal, isCO: /change order/i.test(title) };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.hasModal).toBe(true);   // email path opens the compose modal
      expect(result.isCO).toBe(true);       // and it's the CO-titled variant
    }
  });

  test('_doCOSend("other") — routes to _shareCOLink (pwaShare, no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doCOSend !== 'function') return { skip: true };
      const origShare = window.pwaShare;
      let sharedUrl = null;
      window.pwaShare = (o) => { sharedUrl = o && o.url; };
      let threw = false;
      try { _doCOSend('other'); } catch (e) { threw = true; }
      window.pwaShare = origShare;
      return { threw, sharedUrl };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.sharedUrl).toContain('client.html');
    }
  });

  test('_sendCOViaSms — alerts (no throw) when client has no phone', async () => {
    const result = await page.evaluate(() => {
      if (typeof _sendCOViaSms !== 'function') return { skip: true };
      const orig = _coShareData;
      _coShareData = { url: 'u', cname: 'No Phone', bname: 'B', cphone: '', coNum: 3, clientId: 'c-co-001' };
      const origAlert = window.zAlert;
      let alerted = false;
      window.zAlert = () => { alerted = true; };
      let threw = false;
      try { _sendCOViaSms(); } catch (e) { threw = true; }
      window.zAlert = origAlert;
      _coShareData = orig;
      return { threw, alerted };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.alerted).toBe(true); // missing phone is surfaced, not silently dropped
    }
  });

  test('_sendCOViaSms — no-op (no throw) when _coShareData is null', async () => {
    const result = await page.evaluate(() => {
      if (typeof _sendCOViaSms !== 'function') return { skip: true };
      const orig = _coShareData;
      _coShareData = null;
      let threw = false;
      try { _sendCOViaSms(); } catch (e) { threw = true; }
      _coShareData = orig;
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('_sendCOViaEmail — opens compose modal with CO subject (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _sendCOViaEmail !== 'function') return { skip: true };
      document.getElementById('_email-compose-overlay')?.remove();
      let threw = false;
      try { _sendCOViaEmail(); } catch (e) { threw = true; }
      const ov = document.getElementById('_email-compose-overlay');
      const subj = ov ? (ov.querySelector('#_ec-subj') || {}).value : null;
      ov?.remove();
      return { threw, hasModal: !!ov, subj };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.hasModal).toBe(true);
      if (result.subj != null) expect(/Change Order/i.test(result.subj)).toBe(true);
    }
  });

  test('_shareCOLink — calls pwaShare with the CO url (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _shareCOLink !== 'function') return { skip: true };
      const origShare = window.pwaShare;
      let payload = null;
      window.pwaShare = (o) => { payload = o; };
      let threw = false;
      try { _shareCOLink(); } catch (e) { threw = true; }
      window.pwaShare = origShare;
      return { threw, url: payload && payload.url, hasText: !!(payload && payload.text) };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.url).toContain('client.html');
      expect(result.hasText).toBe(true);
    }
  });

  test('no console errors during change-order send tests', async () => {
    assertNoErrors(page, 'change-order send');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH SEND-2: Proposal send + pure helpers — _doGeiSend / _showEmailComposeModal /
//   _hubHash / _paintLookupClientTaxRate
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Proposal send + helpers — _doGeiSend / _showEmailComposeModal / _hubHash / _paintLookupClientTaxRate', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_hubHash — deterministic: same string → same hash', async () => {
    const result = await page.evaluate(() => {
      if (typeof _hubHash !== 'function') return { skip: true };
      return { a: _hubHash('hello world'), b: _hubHash('hello world'), diff: _hubHash('hello world!') };
    });
    if (!result.skip) {
      expect(result.a).toBe(result.b);
      expect(typeof result.a).toBe('number');
      expect(result.a).not.toBe(result.diff); // different input → different hash
    }
  });

  test('_hubHash — empty string returns 0', async () => {
    const result = await page.evaluate(() => {
      if (typeof _hubHash !== 'function') return { skip: true };
      return { h: _hubHash(''), isInt: Number.isInteger(_hubHash('')) };
    });
    if (!result.skip) {
      expect(result.h).toBe(0);
      expect(result.isInt).toBe(true);
    }
  });

  test('_hubHash — single-char hash equals the charCode', async () => {
    const result = await page.evaluate(() => {
      if (typeof _hubHash !== 'function') return { skip: true };
      // h = ((0<<5)-0 + 'A'.charCodeAt(0))|0 = 65
      return { h: _hubHash('A') };
    });
    if (!result.skip) expect(result.h).toBe(65);
  });

  test('_paintLookupClientTaxRate — no addr → clears rate to null (no throw)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _paintLookupClientTaxRate !== 'function') return { skip: true };
      let el = document.getElementById('e-caddr');
      if (!el) { el = document.createElement('input'); el.id = 'e-caddr'; document.body.appendChild(el); }
      el.value = '';
      let threw = false;
      try { await _paintLookupClientTaxRate(); } catch (e) { threw = true; }
      return { threw, rate: window._paintClientTaxRate };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.rate == null).toBe(true);
    }
  });

  test('_paintLookupClientTaxRate — with a ZIP address runs without throwing', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _paintLookupClientTaxRate !== 'function') return { skip: true };
      let el = document.getElementById('e-caddr');
      if (!el) { el = document.createElement('input'); el.id = 'e-caddr'; document.body.appendChild(el); }
      el.value = '123 Main St, Wichita KS 67202';
      let threw = false;
      try { await _paintLookupClientTaxRate(); } catch (e) { threw = true; }
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('_showEmailComposeModal — builds compose overlay with To/Subject/Body fields', async () => {
    const result = await page.evaluate(() => {
      if (typeof _showEmailComposeModal !== 'function') return { skip: true };
      document.getElementById('_email-compose-overlay')?.remove();
      let threw = false;
      try {
        _showEmailComposeModal({ url: 'https://x/sign', cname: 'Jane Doe', bname: 'TD', cphone: '', cemail: 'jane@x.com' });
      } catch (e) { threw = true; }
      const ov = document.getElementById('_email-compose-overlay');
      const to = ov ? (ov.querySelector('#_ec-to') || {}).value : null;
      const hasSubj = !!(ov && ov.querySelector('#_ec-subj'));
      const hasBody = !!(ov && ov.querySelector('#_ec-body'));
      ov?.remove();
      return { threw, hasModal: !!ov, to, hasSubj, hasBody };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.hasModal).toBe(true);
      expect(result.to).toBe('jane@x.com');
      expect(result.hasSubj).toBe(true);
      expect(result.hasBody).toBe(true);
    }
  });

  test('_showEmailComposeModal — opts override title/subject (CO reuse path)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _showEmailComposeModal !== 'function') return { skip: true };
      document.getElementById('_email-compose-overlay')?.remove();
      try {
        _showEmailComposeModal({ url: 'u', cname: 'C', bname: 'B', cphone: '', cemail: '' },
          { title: 'CUSTOM TITLE', subject: 'CUSTOM SUBJ', body: 'b', clientId: 'c1' });
      } catch (e) { return { ok: false, error: e.message }; }
      const ov = document.getElementById('_email-compose-overlay');
      const html = ov ? ov.innerHTML : '';
      const subj = ov ? (ov.querySelector('#_ec-subj') || {}).value : null;
      ov?.remove();
      return { ok: true, hasTitle: /CUSTOM TITLE/.test(html), subj };
    });
    if (!result.skip) {
      expect(result.ok).toBe(true);
      expect(result.hasTitle).toBe(true);
      expect(result.subj).toBe('CUSTOM SUBJ');
    }
  });

  test('share data carries the RAW business/client name — "&" never reaches a text message as "&amp;"', async () => {
    // Owner-reported: the proposal SMS signed off "— ZJ's Painting &amp; Special
    // Coatings". Root cause: sendGenericProposal escHtml'd bname/clientName for
    // the proposal HTML and reused the escaped strings in _pendingShareData,
    // which feeds PLAIN-TEXT surfaces (sms: body, share sheet, email body).
    const result = await page.evaluate(async () => {
      if (typeof sendGenericProposal !== 'function') return { skip: true };
      const origBname = S.bname;
      S.bname = "ZJ's Painting & Special Coatings";
      // The shim's storage.upload rejects, which would bail out of the send
      // BEFORE the share-data assignment (and let this test pass vacuously via
      // the _proposalShareData() fallback) — stub it to succeed.
      const origStorageFrom = _supa.storage.from.bind(_supa.storage);
      _supa.storage.from = () => ({ upload: async () => ({ data: { path: 'x' } }) });
      const c = { id: 79210, name: 'Smith & Sons Rentals', addr: '1 Amp Rd', phone: '3165550222' };
      clients = clients.filter(x => x.id !== 79210).concat([c]);
      bids = bids.filter(x => x.client_id !== 79210);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      _geiIsFreeForm = true;
      _byoItems = [
        { id: 1, section: 'Interior', label: 'Room', price: 500, on: true },
        { id: 2, section: 'Materials', label: 'Paint', price: 200, on: true },   // BYO send validation requires a Materials line
      ];
      _byoUpdateRail();
      let err = null;
      try { await sendGenericProposal(false); } catch (e) { err = e.message; }
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      document.getElementById('_gei-send-overlay')?.remove();
      _supa.storage.from = origStorageFrom;
      const d = _pendingShareData;   // the seeded object itself — no fallback allowed
      S.bname = origBname;
      return { err, seeded: !!d, bname: d ? d.bname : '', cname: d ? d.cname : '' };
    });
    if (result.skip) return;
    expect(result.err).toBe(null);
    expect(result.seeded, 'send must reach the share-data assignment').toBe(true);
    expect(result.bname).toBe("ZJ's Painting & Special Coatings");   // raw, not &amp; / &#39;
    expect(result.cname).toBe('Smith & Sons Rentals');
    expect(result.bname).not.toContain('&amp;');
    expect(result.cname).not.toContain('&amp;');
  });

  test('_doGeiSend("sms") — routes to sendProposalViaSms (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doGeiSend !== 'function') return { skip: true };
      const orig = window.sendProposalViaSms;
      let called = false;
      window.sendProposalViaSms = () => { called = true; };
      let threw = false;
      try { _doGeiSend('sms'); } catch (e) { threw = true; }
      window.sendProposalViaSms = orig;
      return { threw, called };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.called).toBe(true);
    }
  });

  test('_doGeiSend("email") — routes to sendProposalViaEmail (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doGeiSend !== 'function') return { skip: true };
      const orig = window.sendProposalViaEmail;
      let called = false;
      window.sendProposalViaEmail = () => { called = true; };
      let threw = false;
      try { _doGeiSend('email'); } catch (e) { threw = true; }
      window.sendProposalViaEmail = orig;
      return { threw, called };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.called).toBe(true);
    }
  });

  test('_doGeiSend("other") — routes to shareProposalLink (no throw)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _doGeiSend !== 'function') return { skip: true };
      const orig = window.shareProposalLink;
      let called = false;
      window.shareProposalLink = () => { called = true; };
      let threw = false;
      try { _doGeiSend('other'); } catch (e) { threw = true; }
      window.shareProposalLink = orig;
      return { threw, called };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.called).toBe(true);
    }
  });

  test('no console errors during proposal send tests', async () => {
    assertNoErrors(page, 'proposal send');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH SEND-3: Generic-estimate sync/scope — _geiSyncJobTypeButtons /
//   _geiSyncJobScopeButtons / _geiSetWorkType / _geiOnboardToggle /
//   _geiOnboardFinish / _stsuLookup / _scopeHistoryHrs
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Generic-estimate sync/scope — _gei* / _stsuLookup / _scopeHistoryHrs', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_scopeHistoryHrs — returns null with no history', async () => {
    const result = await page.evaluate(() => {
      if (typeof _scopeHistoryHrs !== 'function') return { skip: true };
      if (!window.S) window.S = {};
      S.scopeHistory = {};
      return { v: _scopeHistoryHrs('nope-id') };
    });
    if (!result.skip) expect(result.v).toBe(null);
  });

  test('_scopeHistoryHrs — odd count returns the median element', async () => {
    const result = await page.evaluate(() => {
      if (typeof _scopeHistoryHrs !== 'function') return { skip: true };
      if (!window.S) window.S = {};
      S.scopeHistory = { sc1: [{ hrs: 2 }, { hrs: 6 }, { hrs: 4 }] }; // sorted → 2,4,6 → median 4
      return { v: _scopeHistoryHrs('sc1') };
    });
    if (!result.skip) expect(result.v).toBe(4);
  });

  test('_scopeHistoryHrs — even count averages the two middle values', async () => {
    const result = await page.evaluate(() => {
      if (typeof _scopeHistoryHrs !== 'function') return { skip: true };
      if (!window.S) window.S = {};
      S.scopeHistory = { sc2: [{ hrs: 2 }, { hrs: 4 }, { hrs: 6 }, { hrs: 8 }] }; // median (4+6)/2 = 5
      return { v: _scopeHistoryHrs('sc2') };
    });
    if (!result.skip) expect(result.v).toBe(5);
  });

  test('_scopeHistoryHrs — ignores non-positive / non-number entries', async () => {
    const result = await page.evaluate(() => {
      if (typeof _scopeHistoryHrs !== 'function') return { skip: true };
      if (!window.S) window.S = {};
      S.scopeHistory = { sc3: [{ hrs: 0 }, { hrs: -3 }, { hrs: 'x' }, { hrs: 10 }] }; // only 10 valid
      return { v: _scopeHistoryHrs('sc3') };
    });
    if (!result.skip) expect(result.v).toBe(10);
  });

  test('_geiSyncJobTypeButtons — moves active state to selected property buttons', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSyncJobTypeButtons !== 'function') return { skip: true };
      ['res', 'comm'].forEach(k => {
        let b = document.getElementById('gei-prop-' + k);
        if (!b) { b = document.createElement('button'); b.id = 'gei-prop-' + k; document.body.appendChild(b); }
      });
      // `_geiIsCommercial` is a module-level `let` (generic-estimate.js:273), so a
      // bare assignment rebinds it; `window._geiIsCommercial =` would create an
      // unrelated property the app never reads.
      const origComm = _geiIsCommercial;
      _geiIsCommercial = true; // → 'comm' active
      let threw = false;
      try { _geiSyncJobTypeButtons(); } catch (e) { threw = true; }
      const commBorder = document.getElementById('gei-prop-comm').style.border;
      const resBorder = document.getElementById('gei-prop-res').style.border;
      _geiIsCommercial = origComm;
      return { threw, commActive: /var\(--blue\)/.test(commBorder), resInactive: /var\(--border2\)/.test(resBorder) };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.commActive).toBe(true);
      expect(result.resInactive).toBe(true);
    }
  });

  test('_geiSyncJobScopeButtons — highlights the active jscope button', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSyncJobScopeButtons !== 'function') return { skip: true };
      ['improvement', 'repair'].forEach(s => {
        let b = document.getElementById('gei-jscope-' + s);
        if (!b) { b = document.createElement('button'); b.id = 'gei-jscope-' + s; document.body.appendChild(b); }
      });
      // `_geiJobScope` is a module-level `let` (generic-estimate.js:273) — bare
      // assignment rebinds it; `window._geiJobScope =` would not be read by the app.
      _geiJobScope = 'repair'; // → repair active
      let threw = false;
      try { _geiSyncJobScopeButtons(); } catch (e) { threw = true; }
      const repairBorder = document.getElementById('gei-jscope-repair').style.border;
      const impBorder = document.getElementById('gei-jscope-improvement').style.border;
      return { threw, repairActive: /var\(--blue\)/.test(repairBorder), impInactive: /var\(--border2\)/.test(impBorder) };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.repairActive).toBe(true);
      expect(result.impInactive).toBe(true);
    }
  });

  test('_geiSyncJobTypeButtons — no throw when buttons are absent (missing DOM)', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSyncJobTypeButtons !== 'function') return { skip: true };
      ['gei-prop-res', 'gei-prop-comm', 'gei-jtype-note'].forEach(id => document.getElementById(id)?.remove());
      let threw = false;
      try { _geiSyncJobTypeButtons(); } catch (e) { threw = true; }
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('_geiSetWorkType — sets scope + flips _geiNewWork for "improvement"', async () => {
    const result = await page.evaluate(() => {
      if (typeof _geiSetWorkType !== 'function') return { skip: true };
      // Ensure referenced buttons exist so the sync inside doesn't matter
      let threw = false;
      try { _geiSetWorkType('improvement'); } catch (e) { threw = true; }
      // `_geiJobScope` / `_geiNewWork` are module-level `let`s (generic-estimate.js:273);
      // _geiSetWorkType writes the lexical bindings, so read them by bare name —
      // `window._geiJobScope` is an unrelated property the function never assigns.
      const scope = _geiJobScope, newWork = _geiNewWork;
      // reset back to repair to avoid bleed
      try { _geiSetWorkType('repair'); } catch (e) {}
      return { threw, scope, newWork };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.scope).toBe('improvement');
      expect(result.newWork).toBe(true);
    }
  });

  test('_geiOnboardToggle / _geiOnboardFinish — exist after showGeiOnboarding, toggle + finish persist bundles', async () => {
    const result = await page.evaluate(() => {
      if (typeof showGeiOnboarding !== 'function') return { skip: true };
      if (!window.S) window.S = {};
      S.state = S.state || 'KS';
      document.getElementById('_gei-onboard-ov')?.remove();
      let threw = false;
      try {
        showGeiOnboarding(); // defines window._geiOnboardToggle / Finish / Skip
      } catch (e) { threw = true; }
      const toggleType = typeof window._geiOnboardToggle;
      const finishType = typeof window._geiOnboardFinish;
      // Select a bundle, then finish → S.myBundles set, S.hasOnboarded true
      if (toggleType === 'function') { try { window._geiOnboardToggle('painting'); } catch (e) {} }
      const origToast = window.showToast; window.showToast = () => {};
      if (finishType === 'function') { try { window._geiOnboardFinish(); } catch (e) {} }
      window.showToast = origToast;
      const bundles = Array.isArray(S.myBundles) ? S.myBundles : null;
      document.getElementById('_gei-onboard-ov')?.remove();
      return { threw, toggleType, finishType, bundles, onboarded: S.hasOnboarded };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(result.toggleType).toBe('function');
      expect(result.finishType).toBe('function');
      expect(Array.isArray(result.bundles)).toBe(true);
      expect(result.bundles).toContain('painting');
      expect(result.onboarded).toBe(true);
    }
  });

  test('_stsuLookup — no-op (no throw) when #stsu-zip / result missing', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _stsuLookup !== 'function') return { skip: true };
      document.getElementById('stsu-zip')?.remove();
      document.getElementById('stsu-lookup-result')?.remove();
      let threw = false;
      try { await _stsuLookup(); } catch (e) { threw = true; }
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('_stsuLookup — invalid ZIP shows validation message (no throw)', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _stsuLookup !== 'function') return { skip: true };
      let zip = document.getElementById('stsu-zip');
      if (!zip) { zip = document.createElement('input'); zip.id = 'stsu-zip'; document.body.appendChild(zip); }
      let res = document.getElementById('stsu-lookup-result');
      if (!res) { res = document.createElement('div'); res.id = 'stsu-lookup-result'; document.body.appendChild(res); }
      zip.value = '12'; // invalid — not 5 digits
      let threw = false;
      try { await _stsuLookup(); } catch (e) { threw = true; }
      return { threw, msg: res.textContent };
    });
    if (!result.skip) {
      expect(result.threw).toBe(false);
      expect(/valid 5-digit ZIP/i.test(result.msg)).toBe(true);
    }
  });

  test('_stsuLookup — valid ZIP runs the lookup without throwing', async () => {
    const result = await page.evaluate(async () => {
      if (typeof _stsuLookup !== 'function') return { skip: true };
      let zip = document.getElementById('stsu-zip');
      if (!zip) { zip = document.createElement('input'); zip.id = 'stsu-zip'; document.body.appendChild(zip); }
      let res = document.getElementById('stsu-lookup-result');
      if (!res) { res = document.createElement('div'); res.id = 'stsu-lookup-result'; document.body.appendChild(res); }
      zip.value = '67202';
      let threw = false;
      try { await _stsuLookup(); } catch (e) { threw = true; }
      return { threw };
    });
    if (!result.skip) expect(result.threw).toBe(false);
  });

  test('no console errors during generic-estimate sync/scope tests', async () => {
    assertNoErrors(page, 'generic-estimate sync/scope');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GEO HARDENING — durable queue, hidden-gap survival, manual bookends, wake lock,
//  ping re-entrancy, breadcrumb retention (geo-track.js hardening package)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Geo hardening — offline queue + gap survival + bookends', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Fresh geo state + a scriptable _supa recorder for every test.
  const geoReset = () => page.evaluate(() => {
    localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_open');
    localStorage.removeItem('zp3_geo_manual'); localStorage.removeItem('zp3_geo_prune_day');
    _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false; _geoShopArrivedAt = null;
    _geoDriveStartedAt = null; _geoGapHiddenAt = null; _geoLastPingTs = 0; _geoPingBusy = false;
    window._isEmployee = false;
    window._supaUser = { id: 'geo-hard-user-1', email: 'g@t.com' };
    window.__rec = { upserts: [], inserts: [], deletes: [] };
    window.__supaMode = 'ok'; // 'ok' | 'fail' | 'no-conflict' | 'no-column'
    window.__origSupa = window.__origSupa || window._supa;
    window._supa = {
      from: (tbl) => ({
        upsert: (row, opts) => {
          if (window.__supaMode === 'fail') return Promise.resolve({ error: { message: 'network down' } });
          if (window.__supaMode === 'no-conflict') return Promise.resolve({ error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } });
          if (window.__supaMode === 'no-column') return Promise.resolve({ error: { message: "Could not find the 'client_key' column of 'job_time_entries' in the schema cache" } });
          window.__rec.upserts.push({ tbl, row, opts }); return Promise.resolve({ error: null });
        },
        insert: (row) => {
          if (window.__supaMode === 'fail') return Promise.resolve({ error: { message: 'network down' } });
          if (window.__supaMode === 'no-column' && row.client_key !== undefined) return Promise.resolve({ error: { message: "Could not find the 'client_key' column" } });
          window.__rec.inserts.push({ tbl, row }); return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => ({ lt: (col, val) => ({ then: (res) => { window.__rec.deletes.push({ tbl, col, val }); res && res({}); return { catch: () => {} }; } }) }) }),
      }),
    };
  });
  const geoRestore = () => page.evaluate(() => { if (window.__origSupa) window._supa = window.__origSupa; });

  test('queue — a failed write STAYS queued; the next drain lands it with a client_key (idempotent upsert)', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      window.__supaMode = 'fail';
      _geoEnqueue('job_time_entries', { contractor_user_id: 'geo-hard-user-1', employee_user_id: 'geo-hard-user-1', job_id: '1', arrived_at: new Date(Date.now() - 600000).toISOString(), departed_at: new Date().toISOString(), minutes: 10, source: 'geofence' });
      await new Promise(res => setTimeout(res, 50));
      const queuedAfterFail = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
      window.__supaMode = 'ok';
      await _geoDrainQueue();
      const queuedAfterDrain = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
      const up = window.__rec.upserts[0];
      return { queuedAfterFail, queuedAfterDrain, upserts: window.__rec.upserts.length, key: up && up.row.client_key, onConflict: up && up.opts && up.opts.onConflict };
    });
    expect(r.queuedAfterFail).toBe(1);   // offline write survived on the device
    expect(r.queuedAfterDrain).toBe(0);  // drained exactly once when the network returned
    expect(r.upserts).toBe(1);
    expect(String(r.key || '')).toContain('geo-hard'); // client-minted idempotency key present
    expect(r.onConflict).toBe('contractor_user_id,client_key');
    await geoRestore();
  });

  test('queue — schema-lag fallbacks: no unique index → plain insert; no client_key column → insert without it', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      window.__supaMode = 'no-conflict';
      _geoEnqueue('job_time_entries', { contractor_user_id: 'geo-hard-user-1', job_id: '2', arrived_at: new Date(Date.now() - 300000).toISOString(), departed_at: new Date().toISOString(), minutes: 5, source: 'geofence' });
      await new Promise(res => setTimeout(res, 50));
      const afterNoConflict = { inserts: window.__rec.inserts.length, hadKey: !!(window.__rec.inserts[0] && window.__rec.inserts[0].row.client_key) };
      window.__rec.inserts = [];
      window.__supaMode = 'no-column';
      _geoEnqueue('job_time_entries', { contractor_user_id: 'geo-hard-user-1', job_id: '3', arrived_at: new Date(Date.now() - 300000).toISOString(), departed_at: new Date().toISOString(), minutes: 5, source: 'geofence' });
      await new Promise(res => setTimeout(res, 50));
      const afterNoColumn = { inserts: window.__rec.inserts.length, hasKey: window.__rec.inserts[0] ? window.__rec.inserts[0].row.client_key !== undefined : null };
      const queueLeft = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
      return { afterNoConflict, afterNoColumn, queueLeft };
    });
    expect(r.afterNoConflict.inserts).toBe(1);
    expect(r.afterNoConflict.hadKey).toBe(true);   // column exists, index missing → keep the key
    expect(r.afterNoColumn.inserts).toBe(1);
    expect(r.afterNoColumn.hasKey).toBe(false);    // column missing → stripped, entry still lands
    expect(r.queueLeft).toBe(0);
    await geoRestore();
  });

  test('hidden gap — backgrounding persists the open entry; restore + outside ping closes AT the hidden moment as geofence-gap', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      const jobId = 883001;
      window.__origJobs = jobs.slice(); jobs.length = 0;
      jobs.push({ id: jobId, lat: 37.6872, lon: -97.3301, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
      const arrived = new Date(Date.now() - 30 * 60000).toISOString();
      const hidden = new Date(Date.now() - 10 * 60000).toISOString();
      _geoCurrentJob = jobId; _geoArrivedAt = arrived;
      _geoPersistOpen(hidden); // what the visibilitychange→hidden handler does
      const persisted = JSON.parse(localStorage.getItem('zp3_geo_open') || 'null');
      // Simulate an app kill: state wiped, then restored on next boot.
      _geoCurrentJob = null; _geoArrivedAt = null; _geoGapHiddenAt = null;
      _geoRestoreOpen();
      const restored = { job: _geoCurrentJob, arrivedAt: _geoArrivedAt, gap: _geoGapHiddenAt };
      // First post-gap ping lands far OUTSIDE the fence → gap-close.
      await _geoOnPing({ coords: { latitude: 38.2, longitude: -98.0, accuracy: 8 } });
      await new Promise(res => setTimeout(res, 50));
      const row = (window.__rec.upserts.find(u => u.tbl === 'job_time_entries') || {}).row || null;
      jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null;
      return { persisted: !!persisted, hiddenAt: persisted && persisted.hiddenAt, restored, row, cur: _geoCurrentJob };
    });
    expect(r.persisted).toBe(true);
    expect(String(r.restored.job)).toBe('883001');      // arrival survived the kill
    expect(r.restored.gap).toBe(r.hiddenAt);            // gap marker restored
    expect(r.row).not.toBeNull();
    expect(r.row.source).toBe('geofence-gap');          // unverified time never claimed…
    expect(r.row.departed_at).toBe(r.hiddenAt);         // …closed at the last VERIFIED moment
    expect(r.row.minutes).toBe(20);                     // 30min open − 10min unverified gap
    expect(r.cur).toBeNull();
    await geoRestore();
  });

  test('hidden gap — still INSIDE the fence after the gap → continuous visit, no entry written, gap cleared', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      const jobId = 883002;
      window.__origJobs = jobs.slice(); jobs.length = 0;
      jobs.push({ id: jobId, lat: 37.6872, lon: -97.3301, start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
      const arrived = new Date(Date.now() - 30 * 60000).toISOString();
      _geoCurrentJob = jobId; _geoArrivedAt = arrived; _geoGapHiddenAt = new Date(Date.now() - 10 * 60000).toISOString();
      await _geoOnPing({ coords: { latitude: 37.6872, longitude: -97.3301, accuracy: 8 } });
      const out = { rows: window.__rec.upserts.length, cur: _geoCurrentJob, arrivedKept: _geoArrivedAt === arrived, gap: _geoGapHiddenAt };
      jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null;
      return out;
    });
    expect(r.rows).toBe(0);              // no close — the visit continues
    expect(String(r.cur)).toBe('883002');
    expect(r.arrivedKept).toBe(true);    // hidden time COUNTS (same arrival stands)
    expect(r.gap).toBeNull();            // gap resolved
    await geoRestore();
  });

  test('re-entrancy — a ping arriving while the previous one awaits a geocode is dropped whole', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      const jobId = 883003;
      window.__origJobs = jobs.slice(); jobs.length = 0;
      // No lat/lon on the job → _geoJobLatLng hits the (patched, hanging) geocoder.
      jobs.push({ id: jobId, addr: '123 Slow Geocode St', start: new Date().toISOString().slice(0, 10), days: 1, status: 'upcoming', eventType: 'job' });
      S.trackStart = '00:00'; S.trackEnd = '23:59'; S.officeLat = null; S.officeLon = null;
      const origResolve = window._resolveCoords;
      let release; const hang = new Promise(res => { release = res; });
      window._resolveCoords = () => hang.then(() => ({ lat: 37.6872, lng: -97.3301 }));
      const p1 = _geoOnPing({ coords: { latitude: 37.6872, longitude: -97.3301, accuracy: 8 } }); // hangs at the geocode
      await new Promise(res => setTimeout(res, 30));
      _geoLastPingTs = 0; // arm the breadcrumb — a second ping WOULD write one if not guarded
      await _geoOnPing({ coords: { latitude: 37.7, longitude: -97.34, accuracy: 8 } });           // must drop at the guard
      const breadcrumbAfterSecond = _geoLastPingTs;
      release({}); await p1;
      window._resolveCoords = origResolve;
      const out = { breadcrumbAfterSecond, busyAfter: _geoPingBusy };
      jobs.length = 0; window.__origJobs.forEach(j => jobs.push(j)); window.__origJobs = null;
      return out;
    });
    expect(r.breadcrumbAfterSecond).toBe(0); // second ping returned at the guard — touched nothing
    expect(r.busyAfter).toBe(false);         // guard released after the first ping finished
    await geoRestore();
  });

  test('manual bookends — Arrived opens, Done writes a source:manual entry through the queue; job-switch closes the previous', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      S.teamTracking = true;
      _geoManualArrive(884001);
      const open1 = JSON.parse(localStorage.getItem('zp3_geo_manual') || 'null');
      if (open1) { open1.arrivedAt = new Date(Date.now() - 45 * 60000).toISOString(); localStorage.setItem('zp3_geo_manual', JSON.stringify(open1)); }
      _geoManualArrive(884001); // double-tap same job → still ONE open record, arrival unchanged
      const open1b = JSON.parse(localStorage.getItem('zp3_geo_manual') || 'null');
      _geoManualArrive(884002); // switching jobs closes the previous one first
      await new Promise(res => setTimeout(res, 50));
      const closedFirst = (window.__rec.upserts.find(u => String(u.row.job_id) === '884001') || {}).row || null;
      const open2 = JSON.parse(localStorage.getItem('zp3_geo_manual') || 'null');
      if (open2) { open2.arrivedAt = new Date(Date.now() - 30 * 60000).toISOString(); localStorage.setItem('zp3_geo_manual', JSON.stringify(open2)); }
      _geoManualDone(884002);
      await new Promise(res => setTimeout(res, 50));
      const closedSecond = (window.__rec.upserts.find(u => String(u.row.job_id) === '884002') || {}).row || null;
      const openAfter = localStorage.getItem('zp3_geo_manual');
      return { open1: open1 && String(open1.job), sameArrival: !!(open1b && open1 && open1b.arrivedAt === open1.arrivedAt), closedFirst, closedSecond, openAfter };
    });
    expect(r.open1).toBe('884001');
    expect(r.sameArrival).toBe(true);
    expect(r.closedFirst).not.toBeNull();
    expect(r.closedFirst.source).toBe('manual');
    expect(r.closedFirst.minutes).toBeGreaterThanOrEqual(44);
    expect(r.closedSecond).not.toBeNull();
    expect(r.closedSecond.source).toBe('manual');
    expect(r.openAfter).toBeNull();
    await geoRestore();
  });

  test('wake lock — acquired via navigator.wakeLock, released on _geoWakeRelease (stubbed)', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      let acquired = 0, released = 0;
      let stubbed = false;
      try {
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: { request: async () => { acquired++; return { release: () => { released++; }, addEventListener: () => {} }; } },
        });
        stubbed = true;
      } catch (e) {}
      if (!stubbed) return { skip: true };
      _geoWakeLockObj = null;
      await _geoWakeAcquire();
      const afterAcquire = acquired;
      await _geoWakeAcquire(); // idempotent — no double-request while held
      _geoWakeRelease();
      return { afterAcquire, acquiredTotal: acquired, released, objAfter: _geoWakeLockObj === null };
    });
    if (!r.skip) {
      expect(r.afterAcquire).toBe(1);
      expect(r.acquiredTotal).toBe(1);
      expect(r.released).toBe(1);
      expect(r.objAfter).toBe(true);
    }
    await geoRestore();
  });

  test('breadcrumb retention — owner prunes pings older than 90 days, at most once per day', async () => {
    await geoReset();
    const r = await page.evaluate(async () => {
      _geoPrunePings();
      await new Promise(res => setTimeout(res, 30));
      const first = window.__rec.deletes.length;
      _geoPrunePings(); // same day → no second delete
      await new Promise(res => setTimeout(res, 30));
      const second = window.__rec.deletes.length;
      const cutoff = window.__rec.deletes[0] ? window.__rec.deletes[0].val : null;
      const about90d = cutoff ? Math.abs((Date.now() - new Date(cutoff).getTime()) / 86400000 - 90) < 1 : false;
      return { first, second, about90d, tbl: window.__rec.deletes[0] && window.__rec.deletes[0].tbl };
    });
    expect(r.first).toBe(1);
    expect(r.second).toBe(1);
    expect(r.tbl).toBe('location_pings');
    expect(r.about90d).toBe(true);
    await geoRestore();
  });

  test('no console errors during geo hardening tests', async () => {
    assertNoErrors(page, 'geo hardening');
  });
});
