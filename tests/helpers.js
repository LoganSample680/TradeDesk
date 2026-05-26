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
    if (page._consoleErrors) page._consoleErrors.push('PAGE ERROR: ' + err.message);
  });

  await page.route('**/*', async (route) => {
    const url = route.request().url();

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
  function queryBuilder(){
    const q={
      select:()=>q, insert:()=>q, upsert:()=>q, update:()=>q, delete:()=>q,
      eq:()=>q, neq:()=>q, gt:()=>q, lt:()=>q, gte:()=>q, lte:()=>q,
      in:()=>q, is:()=>q, not:()=>q, or:()=>q, filter:()=>q, match:()=>q,
      ilike:()=>q, like:()=>q, contains:()=>q, containedBy:()=>q,
      order:()=>q, limit:()=>q, range:()=>q,
      single:()=>maybeOffline(noopResult(null)),
      maybeSingle:()=>maybeOffline(noopResult(null)),
      then:(cb)=>maybeOffline(noopResult([])).then(cb),
      catch:(cb)=>Promise.resolve([]),
    };
    return q;
  }
  const _supabase = {
    createClient: function(url, key) {
      return {
        auth: {
          getUser:    () => { const uid = (typeof window!=='undefined'&&window.__overrideSessionUserId)||'e2e-user'; return noopResult({ user: { id: uid, email: 'test@test.com' } }); },
          getSession: () => { const uid = (typeof window!=='undefined'&&window.__overrideSessionUserId)||'e2e-user'; return noopResult({ session: { access_token: 'fake-jwt', user: { id: uid, email: 'test@test.com' } } }); },
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
            getPublicUrl: (path) => ({ data: { publicUrl: 'data:image/png;base64,iVBORw0KGgo=' } }),
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
async function waitForAppBoot(page, timeout = 12000) {
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
}

/** Helper: navigate to a page and wait. */
async function goPg(page, id) {
  await page.evaluate(pgId => window.goPg(pgId), id);
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

module.exports = { test, expect, mockAllExternal, _supabaseShim, _supabaseShimIntake, waitForAppBoot, goPg, assertNoErrors, FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL };
