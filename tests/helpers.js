// @ts-check
/**
 * TradeDesk Playwright E2E Test Suite
 *
 * Targets: WebKit (Safari engine — primary) + Chromium
 * All external calls mocked — runs fully offline in CI.
 *
 * Coverage:
 *  - All 16 original Puppeteer phases (ported & expanded)
 *  - sign.html: load, view-tracking badge, sign flow, decline
 *  - client.html hub: loads, renders proposals, shows signed state
 *  - Proposal view tracking (👀 Opened badge after opening)
 *  - Decline → Closed Lost flow
 *  - Long-press delete on jobs
 *  - All page navigations with zero console errors
 *  - Edge Function mock (log-proposal-view)
 *  - Settings save/restore
 *  - Version number present in DOM
 *  - iOS bridge functions (tdPrint, _clientBaseUrl)
 *  - IRS rate auto-refresh skip logic
 *  - Books tabs: income, expenses, mileage, summary
 *  - Mileage accordion: open / close / copy-pastable addresses
 *  - Schedule alert chain: Later → next alert → Lock it in → job created
 *  - Proposal amount preservation (no re-rounding)
 */

const { test, expect } = require('@playwright/test');

// ── Shared test constants ────────────────────────────────────────────────────
const FAKE_BID_ID_1 = 900001;
const FAKE_BID_ID_2 = 900002;
const FAKE_USER_ID  = 'e2e-user-0000-0000-0000-000000000001';
const FAKE_TOKEN    = 'tok-alice-e2e';
const FAKE_TOKEN_2  = 'tok-bob-e2e';

// Proposal JSON injected directly into the mocked storage download for sign.html
const MOCK_PROPOSAL = {
  id: FAKE_BID_ID_1,
  status: 'pending',
  businessName: 'Zach Pro Painting',
  businessPhone: '316-555-0100',
  clientName: 'Alice Smith',
  clientAddr: '123 Main St, Wichita KS 67202',
  amount: 2375,
  deposit: 594,
  estDays: 3,
  createdAt: new Date().toISOString(),
  signingToken: FAKE_TOKEN,
  contractorUserId: FAKE_USER_ID,
  clientId: 901,
  proposalHtml: '<p>Painting scope: Living Room walls and ceiling. Sherwin-Williams Duration paint.</p>',
  trade: 'painting',
  surfaces: [{ type: 'walls', room: 'Living Room' }, { type: 'ceiling', room: 'Living Room' }],
  stripeConnectEnabled: false,
};

// ── Global route mock factory ────────────────────────────────────────────────
/**
 * Wire all external mocks on a page before navigation.
 * Call this on every page that might touch Supabase / CDN / fonts.
 */
async function mockAllExternal(page, opts = {}) {
  const { alreadySigned = false, proposalData = MOCK_PROPOSAL, bidId = FAKE_BID_ID_1 } = opts;

  // Set __mockProposalData BEFORE any page scripts run so the shim's fetch interceptor
  // serves the correct custom proposal (not the default stub) for sign.html tests.
  if (proposalData) {
    await page.addInitScript((pd) => { window.__mockProposalData = pd; }, proposalData);
  }

  // Track console errors per page — caller reads them via page._consoleErrors
  page._consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known-harmless non-app errors
      if (
        text.includes('favicon') ||
        text.includes('net::ERR') ||
        text.includes('Failed to load resource') ||
        text.includes('ERR_CONNECTION_REFUSED') ||
        text.includes('supabase') && text.includes('warn') ||
        text.includes('SUPABASE') ||
        text.includes('cdn.jsdelivr') ||
        text.includes('fonts.googleapis') ||
        text.includes('fonts.gstatic') ||
        text.includes('cdn.apple-mapkit') ||
        text.includes('js.stripe.com') ||
        text.includes('apple-mapkit')
      ) return;
      page._consoleErrors.push(text);
    }
  });
  page.on('pageerror', err => {
    const msg = err.message;
    // WebKit emits unhandledrejection pageerrors for fetch failures that ARE
    // caught in app code (e.g. geocoding.geo.census.gov has .catch(()=>null)).
    // The app handles these gracefully — filter so assertNoErrors stays clean.
    if (msg.includes('geocoding.geo.census.gov')) return;
    if (msg.includes('photon.komoot.io')) return;
    // The 15s version poll (index.html) has .catch(()=>{}) but WebKit still emits
    // a pageerror when page.reload() kills the fetch mid-flight ("access control checks").
    if (msg.includes('version.json')) return;
    if (page._consoleErrors) page._consoleErrors.push('PAGE ERROR: ' + msg);
  });

  // ── Block service worker registration — SW fetches bypass page.route
  // entirely (including the SW script request itself), so once a SW installs,
  // a page.reload() serves the REAL supabase CDN (503 in CI) instead of the
  // shim and the boot hangs. Init scripts persist across reloads.
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled in tests'));
    }
    // Oplog ships ON in prod (Phase 3) — so the offline shards run it ON too. Tests must
    // exercise the code path real users run; keeping it off here meant the authoritative
    // per-field merge was live in production while every mocked suite certified the
    // whole-row path instead (the review flagged exactly that gap). The mocked Supabase
    // chain absorbs td_ops traffic as no-ops, and IndexedDB works in the test browsers.
    window._opLogShadow = true;
  });

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    if (url.endsWith('/sw.js')) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }

    // ── Serve app locally — pass through ────────────────────────────────────
    if (url.startsWith('http://localhost') || url.startsWith('data:')) {
      return route.continue();
    }

    // ── Supabase CDN — stub with minimal shim ───────────────────────────────
    if (url.includes('cdn.jsdelivr.net') && url.includes('supabase')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: _supabaseShim(),
      });
    }

    // ── Fonts — must return text/css or WebKit strict mode rejects them ────
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }

    // ── Other blocked externals — empty plain response ───────────────────────
    if (
      url.includes('favicon') ||
      url.includes('cdn.apple-mapkit') ||
      url.includes('apple-mapkit') ||
      url.includes('js.stripe.com')
    ) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    }

    // ── Supabase auth ────────────────────────────────────────────────────────
    if (url.includes('/auth/v1/token') || url.includes('/auth/v1/user') || url.includes('/auth/v1/session')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-jwt-token',
          token_type: 'bearer',
          user: { id: FAKE_USER_ID, email: 'zach@test.com' },
          session: { access_token: 'fake-jwt-token', user: { id: FAKE_USER_ID, email: 'zach@test.com' } },
        }),
      });
    }

    // ── Supabase REST — signed_proposals ────────────────────────────────────
    if (url.includes('/rest/v1/signed_proposals')) {
      if (route.request().method() === 'GET' || url.includes('select')) {
        const rows = alreadySigned
          ? [{
              bid_id: bidId,
              client_name: 'Alice Smith',
              client_signed_name: 'Alice Smith',
              payment_method: 'cash',
              payment_status: 'pending',
              signed_at: new Date().toISOString(),
            }]
          : [];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(rows),
        });
      }
      // INSERT / UPSERT
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }

    // ── Supabase REST — proposal_views ───────────────────────────────────────
    if (url.includes('/rest/v1/proposal_views')) {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }

    // ── Supabase Storage — proposals bucket ──────────────────────────────────
    if (url.includes('/storage/v1/object/proposals/') || url.includes('/storage/v1/object/public/proposals/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(proposalData),
      });
    }

    // ── Supabase Storage — general (gallery, etc.) ───────────────────────────
    if (url.includes('/storage/v1/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"Key":"mock","url":"data:image/png;base64,iVBORw0KGgo="}',
      });
    }

    // ── Edge Functions ────────────────────────────────────────────────────────
    if (url.includes('/functions/v1/log-proposal-view')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (url.includes('/functions/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }

    // ── Supabase REST — anything else ────────────────────────────────────────
    if (url.includes('.supabase.co')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }

    // ── Census geocoding API — return a minimal valid match so geo code
    // doesn't throw an unhandled rejection in WebKit strict mode ────────────────
    if (url.includes('geocoding.geo.census.gov')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            input: {},
            addressMatches: [{
              matchedAddress: '123 Main St, Austin, TX 78701',
              coordinates: { x: -97.7431, y: 30.2672 },
              tigerLine: {},
              addressComponents: {},
            }],
          },
        }),
      });
    }

    // ── Block everything else ─────────────────────────────────────────────────
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
}

/**
 * Minimal Supabase JS shim — satisfies createClient() calls without real network.
 */
function _supabaseShim() {
  return `
(function(global){
  function noopResult(data){ return Promise.resolve({data,error:null}); }
  // Returns an error result when window.__offlineMode is set — lets offline tests
  // simulate Supabase being unreachable without touching real network.
  function offlineResult(){ return Promise.resolve({data:null,error:{message:'Simulated offline',code:'offline'}}); }
  function maybeOffline(ok){ return global.__offlineMode ? offlineResult() : ok; }
  // Returns a 401 Unauthorized error — simulates expired/invalid session.
  function authErrorResult(){ return Promise.resolve({data:null,error:{status:401,message:'Invalid JWT',code:'PGRST401'}}); }
  // Returns a 500 server error — simulates Supabase REST outage.
  function serverErrorResult(){ return Promise.resolve({data:null,error:{status:500,message:'Internal server error',code:'PGRST500'}}); }
  function maybeAuthError(ok){ return global.__authFail401 ? authErrorResult() : ok; }
  function maybeServerError(ok){ return global.__serverError500 ? serverErrorResult() : ok; }
  function maybeAnyError(ok){ return maybeAuthError(maybeServerError(maybeOffline(ok))); }
  // ── Public-URL fetch interception ──────────────────────────────────────────
  // client.html / sign.html read mutable storage JSON (hub snapshot, proposal)
  // by fetching the PUBLIC object URL with cache:'no-store' + a cb= cache-buster
  // (stale-balance fix — bypasses the browser HTTP cache that storage's default
  // max-age=3600 would otherwise populate). Serve those fetches from the same
  // in-page mocks download() uses — fully offline, no page.route dependency
  // (WebKit-safe). Every intercepted call is recorded in __storageFetches so
  // specs can assert the cache-bypass behavior.
  var _origFetch = global.fetch ? global.fetch.bind(global) : null;
  global.fetch = function(input, init){
    var u = '';
    try{ u = typeof input === 'string' ? input : (input && input.url) || String(input || ''); }catch(_e){}
    if(u.indexOf('/storage/v1/object/public/') > -1){
      (global.__storageFetches = global.__storageFetches || []).push({ url: u, cache: (init && init.cache) || '' });
      // __storageFetchFail forces the app's download() fallback path; __offlineMode
      // simulates full Supabase outage (download() fails too → error UI).
      // __storageFetchHang simulates a request that never settles (dead network) —
      // exercises the boot watchdog.
      // __proposalNotFound404 simulates a 404 — proposal was deleted or never existed.
      // __storageError401 simulates an access-denied response from storage.
      if(global.__storageFetchHang) return new Promise(function(){});
      if(global.__storageError401) return Promise.resolve(new Response('Unauthorized', { status: 401 }));
      if(global.__proposalNotFound404) return Promise.resolve(new Response('Not Found', { status: 404 }));
      if(global.__offlineMode || global.__storageFetchFail) return Promise.resolve(new Response('unavailable', { status: 503 }));
      var mockJson;
      if(u.indexOf('client-hub') > -1 && typeof global.__mockHubData !== 'undefined') mockJson = JSON.stringify(global.__mockHubData);
      else if(typeof global.__mockProposalData !== 'undefined') mockJson = JSON.stringify(global.__mockProposalData);
      if(mockJson !== undefined) return Promise.resolve(new Response(mockJson, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('not found', { status: 404 })); // → app falls back to storage.download()
    }
    return _origFetch ? _origFetch(input, init) : Promise.reject(new TypeError('fetch unavailable'));
  };
  function queryBuilder(){
    const q={
      select:()=>q, insert:()=>q, upsert:()=>q, update:()=>q, delete:()=>q,
      eq:()=>q, neq:()=>q, gt:()=>q, lt:()=>q, gte:()=>q, lte:()=>q,
      in:()=>q, is:()=>q, not:()=>q, or:()=>q, filter:()=>q, match:()=>q,
      ilike:()=>q, like:()=>q, contains:()=>q, containedBy:()=>q,
      order:()=>q, limit:()=>q, range:()=>q,
      single:()=>maybeAnyError(noopResult(null)),
      maybeSingle:()=>maybeAnyError(noopResult(null)),
      then:(cb)=>maybeAnyError(noopResult([])).then(cb),
      catch:(cb)=>Promise.resolve([]),
    };
    return q;
  }
  const _supabase = {
    createClient: function(url, key) {
      return {
        auth: {
          getUser:    () => { if(global.__authFail401) return authErrorResult(); const uid = (typeof window!=='undefined'&&window.__overrideSessionUserId)||'e2e-user'; return noopResult({ user: { id: uid, email: 'test@test.com' } }); },
          getSession: () => { if(global.__authFail401) return authErrorResult(); const uid = (typeof window!=='undefined'&&window.__overrideSessionUserId)||'e2e-user'; return noopResult({ session: { access_token: 'fake-jwt', user: { id: uid, email: 'test@test.com' } } }); },
          signInWithPassword: () => noopResult({ user: { id: 'e2e-user' }, session: { access_token: 'fake-jwt' } }),
          signOut:    () => noopResult(null),
          onAuthStateChange: (cb) => { return { data: { subscription: { unsubscribe: ()=>{} } } }; },
          startAutoRefresh: () => {},
          stopAutoRefresh:  () => {},
        },
        from: (table) => queryBuilder(),
        storage: {
          from: (bucket) => ({
            upload:   (path, data, opts) => noopResult({ path }),
            download: (path) => {
              // Mirror the in-page fetch interceptor's failure modes so the app's
              // fallback path behaves like production when storage is down/hung.
              if (window.__storageFetchHang) return new Promise(function(){});
              if (window.__storageError401) return Promise.resolve({ data: null, error: { status: 401, message: 'Unauthorized' } });
              if (window.__proposalNotFound404) return Promise.resolve({ data: null, error: { status: 404, message: 'Object not found' } });
              if (window.__storageDownloadFail) return Promise.resolve({ data: null, error: new Error('Object not found') });
              // Resolve mock JSON: hub data → proposal override → default stub
              var mockJson;
              if (path && path.includes('client-hub') && typeof window.__mockHubData !== 'undefined') {
                mockJson = JSON.stringify(window.__mockHubData);
              } else if (typeof window.__mockProposalData !== 'undefined') {
                mockJson = JSON.stringify(window.__mockProposalData);
              } else {
                mockJson = JSON.stringify({id:1,status:'pending',businessName:'Test Biz',clientName:'Test Client',amount:1000,deposit:250,estDays:2,createdAt:new Date().toISOString(),signingToken:'tok',proposalHtml:'<p>Test proposal</p>',stripeConnectEnabled:false});
              }
              // Return a plain Blob-like object — avoids Blob.text() edge cases in WebKit
              return noopResult({text:function(){return Promise.resolve(mockJson);},type:'application/json',size:mockJson.length});
            },
            // Real-shaped public URL so the fresh-fetch path in client.html/sign.html
            // hits the in-page fetch interceptor above (download() stays the fallback).
            getPublicUrl: (path) => { var base = String(url || 'https://mock.supabase.co'); if (base.charAt(base.length - 1) === '/') base = base.slice(0, -1); return { data: { publicUrl: base + '/storage/v1/object/public/' + bucket + '/' + path } }; },
            remove:   (paths) => noopResult(null),
            list:     (prefix) => noopResult([]),
          }),
        },
        functions: {
          invoke: (name, opts) => noopResult({ ok: true }),
        },
        channel: (name) => ({
          on: function() { return this; },
          subscribe: function(cb) { if(cb) cb('SUBSCRIBED'); return this; },
          unsubscribe: () => {},
        }),
        removeChannel: () => {},
      };
    }
  };
  global.supabase = _supabase;
  if(typeof module !== 'undefined') module.exports = _supabase;
})(typeof window !== 'undefined' ? window : global);
`;
}

/**
 * Supabase shim tailored for intake.html — same structure but the `from()` query
 * builder's `.then()` returns the mock accounts row so init() renders the form.
 */
function _supabaseShimIntake() {
  return `
(function(global){
  function noopResult(data){ return Promise.resolve({data,error:null}); }
  const ACCT_ROW=[{id:'acct-e2e-0001',business_name:'E2E Pro Painting',phone:'316-555-1234',logo_data:null,brand_color:'#2D5DA8'}];
  function queryBuilder(table){
    const q={
      select:()=>q, insert:()=>noopResult([{}]), upsert:()=>noopResult([{}]),
      update:()=>q, delete:()=>q,
      eq:()=>q, neq:()=>q, gt:()=>q, lt:()=>q, gte:()=>q, lte:()=>q,
      in:()=>q, is:()=>q, not:()=>q, or:()=>q, filter:()=>q, match:()=>q,
      ilike:()=>q, like:()=>q, contains:()=>q, order:()=>q, limit:()=>q, range:()=>q,
      single:()=>noopResult(table==='accounts'?ACCT_ROW[0]:null),
      maybeSingle:()=>noopResult(table==='accounts'?ACCT_ROW[0]:null),
      then:(cb)=>(table==='accounts'?noopResult(ACCT_ROW):noopResult([])).then(cb),
      catch:(cb)=>Promise.resolve([]),
    };
    return q;
  }
  const _supabase={
    createClient:function(url,key){
      return{
        auth:{
          getUser:()=>noopResult({user:null}),
          getSession:()=>noopResult({session:null}),
          onAuthStateChange:(cb)=>({data:{subscription:{unsubscribe:()=>{}}}}),
        },
        from:(table)=>queryBuilder(table),
        storage:{from:(b)=>({upload:(p,d,o)=>noopResult({path:p}),download:(p)=>noopResult(null),getPublicUrl:(p)=>({data:{publicUrl:''}}),remove:(ps)=>noopResult(null),list:(pr)=>noopResult([])})},
        functions:{invoke:(n,o)=>noopResult({ok:true})},
        channel:(n)=>({on:function(){return this;},subscribe:function(cb){if(cb)cb('SUBSCRIBED');return this;},unsubscribe:()=>{}}),
        removeChannel:()=>{},
      };
    }
  };
  global.supabase=_supabase;
  if(typeof module!=='undefined')module.exports=_supabase;
})(typeof window!=='undefined'?window:global);
`;
}

/** Helper: wait for app to boot past the Supabase overlay. */
async function waitForAppBoot(page, timeout = 20000) {
  // Try to dismiss the boot overlay if it appears
  try {
    await page.waitForSelector('#supa-boot-overlay', { timeout: 2000 });
    await page.evaluate(() => {
      const ov = document.getElementById('supa-boot-overlay');
      if (!ov) return;
      const btns = [...document.querySelectorAll('button')];
      const offBtn = btns.find(b => b.textContent.toLowerCase().includes('offline') || b.textContent.toLowerCase().includes('continue'));
      if (offBtn) offBtn.click();
      else ov.remove();
    });
  } catch (_) { /* no overlay — that's fine */ }

  await page.waitForSelector('#dash-greet', { timeout });

  // Suppress day-of-week auto-modals (e.g. Friday "Week in Review") for the
  // entire test session. The Friday summary is triggered via setTimeout(checkFridaySummary, 800)
  // inside renderDash(). Replacing the function with a no-op means the pending timer
  // fires harmlessly, and no modal is ever shown — regardless of which day CI runs.
  await page.evaluate(() => {
    if (typeof checkFridaySummary === 'function') window.checkFridaySummary = () => {};
    document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
  });
}

/** Helper: navigate to a page and wait. */
async function goPg(page, id) {
  await page.evaluate(pgId => {
    // Test-isolation hardening: clear any modal overlay the previous view left
    // open before navigating. In WebKit a stray .zmodal-overlay (position:fixed;
    // inset:0) intercepts pointer events on the next page and flakes clicks.
    // Navigating away always dismisses modals, so this only removes stale state.
    try { document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove()); } catch (e) {}
    window.goPg(pgId);
  }, id);
  await page.waitForTimeout(350);
}

/** Helper: assert zero real JS errors on page. */
function assertNoErrors(page, label) {
  const errs = (page._consoleErrors || []).filter(e =>
    !e.includes('favicon') &&
    !e.includes('net::ERR') &&
    !e.includes('ERR_CONNECTION') &&       // WebKit omits the 'net::' prefix
    !e.includes('Failed to load resource') &&
    !e.includes('checkNew') &&
    !e.includes('apple-mapkit') &&         // MapKit CDN — harmless in test env
    !e.includes('cdn.apple-mapkit') &&
    !e.includes('js.stripe.com') &&
    !e.includes('cdn.jsdelivr') &&
    !e.includes('AggregateError') &&       // WebKit Promise.any rejection timing
    !e.includes('JSON Parse error') &&     // WebKit JSON parse errors from mocked network
    !e.includes('Unhandled Promise Rejection') // WebKit unhandled rejection label
  );
  expect(errs, `Console errors on ${label}: ${errs.join('; ')}`).toHaveLength(0);
}

/**
 * Set error-simulation flags on a page that has already had mockAllExternal() called.
 * The shim reads these window flags on every call, so they take effect immediately.
 *
 * flags:
 *   __authFail401        → auth.getUser/getSession return 401
 *   __serverError500     → all queryBuilder .then/.single calls return 500
 *   __proposalNotFound404 → storage.download + fetch of proposal return 404
 *   __storageError401    → storage.download + fetch of storage URLs return 401
 *   __offlineMode        → all Supabase calls return offline error
 *   __storageFetchHang   → storage fetch never resolves (simulates dead network)
 */
async function mockWithErrorFlags(page, flags) {
  await page.evaluate(f => {
    Object.keys(f).forEach(k => { window[k] = f[k]; });
  }, flags);
}

module.exports = { test, expect, mockAllExternal, mockWithErrorFlags, _supabaseShim, _supabaseShimIntake, waitForAppBoot, goPg, assertNoErrors, FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL };
