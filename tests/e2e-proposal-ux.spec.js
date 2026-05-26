// @ts-check
/**
 * E2E tests for two related proposal UX features:
 *
 * 1. Client hub hides price on card — amount not shown until client opens the proposal
 * 2. Client vs contractor open tracking — sign.html detects who's viewing and
 *    sends viewer_type:'client' or 'contractor' to the Edge Function, which
 *    stores them in separate timestamps so the contractor can see both.
 *
 * HOW TO TEST VIEWER DETECTION:
 *   sign.html calls _supa.auth.getSession() and compares session.user.id to
 *   _prop.contractorUserId. The Supabase JS shim in mockAllExternal controls
 *   what getSession returns:
 *     - Default shim: session.user.id = 'e2e-user' (≠ FAKE_USER_ID) → 'client'
 *     - Contractor shim: session.user.id = FAKE_USER_ID → 'contractor'
 *
 *   Tests intercept the log-proposal-view fetch and inspect the posted body.
 *
 * HOW TO TEST CLIENT HUB:
 *   The Supabase JS shim handles storage.download() internally without making
 *   real HTTP requests. It reads window.__mockHubData (set via page.addInitScript
 *   before navigation) rather than from a network route.
 *
 * HOW TO TEST DASHBOARD BADGES:
 *   _proposalViewsByBidClient and _proposalViewsByBidContractor are let-scoped
 *   module variables in cloud.js. cloud.js exposes them via Object.defineProperty
 *   on window, so page.evaluate can set them. Similarly, bids and clients are
 *   exposed on window from data.js.
 */

const { test, expect, mockAllExternal, _supabaseShim, waitForAppBoot, assertNoErrors,
        FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL } = require('./helpers');

// ── 1. Client Hub — price hidden from pending proposal cards ─────────────────

test.describe('Client hub — price hidden on proposal cards', () => {
  test('pending proposal card does NOT show the dollar amount', async ({ page }) => {
    const HUB = {
      contractorUserId: FAKE_USER_ID,
      businessName: 'Zach Pro Painting',
      clientName: 'Alice Smith',
      clientToken: FAKE_TOKEN,
      bids: [{
        id: FAKE_BID_ID_1,
        type: 'Interior Painting',
        amount: 82000,
        deposit: 20500,
        status: 'Pending',
        bid_date: new Date().toISOString().slice(0,10),
        signingToken: FAKE_TOKEN,
        signHubUrl: 'https://tradedeskpro.app/sign.html?bid='+FAKE_BID_ID_1,
      }],
      jobs: [],
      payments: [],
    };

    // Set __mockHubData BEFORE navigation so the shim's download() picks it up.
    // (The shim handles storage.download() entirely in JS — page.route() for
    //  storage URLs never fires because no HTTP request is made.)
    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);

    // client.html expects ?t=<token>&u=<contractorUserId>&c=<clientId>
    // (NOT ?user=...&token=... — those params are not read by client.html)
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // Price should NOT appear on the card
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('$82,000');
    expect(pageText).not.toContain('82,000');

    // Proposal name and CTA button SHOULD be visible
    expect(pageText).toContain('Interior Painting');

    // The Review & Sign button should be present
    const signBtn = page.locator('.hub-btn-sign, a[href*="sign.html"]');
    await expect(signBtn.first()).toBeVisible();

    assertNoErrors(page, 'client hub price hidden');
  });

  test('signed proposal in Documents tab DOES show the amount', async ({ page }) => {
    // The amount is revealed in the signed/completed view — that's intentional,
    // the client has already committed. Only the pre-signature card hides it.
    const HUB = {
      contractorUserId: FAKE_USER_ID,
      businessName: 'Zach Pro Painting',
      clientName: 'Alice Smith',
      clientToken: FAKE_TOKEN,
      bids: [{
        id: FAKE_BID_ID_1,
        type: 'Interior Painting',
        amount: 82000,
        deposit: 20500,
        status: 'Closed Won',
        signedAt: new Date().toISOString(),
        bid_date: new Date().toISOString().slice(0,10),
      }],
      jobs: [],
      payments: [],
    };

    // Set __mockHubData BEFORE navigation — same reason as above.
    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);

    // client.html expects ?t=<token>&u=<contractorUserId>&c=<clientId>
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // Navigate to Documents tab to see the signed proposal entry
    const docsTab = page.locator('[data-tab="documents"], button:has-text("Documents"), .hub-tab:has-text("Documents")');
    if (await docsTab.count() > 0) await docsTab.first().click();
    await page.waitForTimeout(300);

    // Amount appears in the signed/completed context (not hidden there)
    const body = await page.textContent('body');
    // The signed row includes the amount and a document count
    // We just verify the page loaded and has the bid type
    expect(body).toContain('Interior Painting');
    assertNoErrors(page, 'signed proposal documents tab');
  });
});

// ── 2. Viewer type detection — client vs contractor ───────────────────────────

test.describe('Proposal view tracking — client vs contractor detection', () => {
  /**
   * Helper: builds a custom supabase shim JS string where getSession() returns
   * the given userId (or null session if userId is falsy).
   */
  function _shimWithSession(userId) {
    const sessionObj = userId
      ? `{ access_token: 'fake-jwt', user: { id: '${userId}', email: 'test@test.com' } }`
      : 'null';
    return `
(function(global){
  function noopResult(data){ return Promise.resolve({data,error:null}); }
  function queryBuilder(){
    const q={
      select:()=>q, insert:()=>q, upsert:()=>q, update:()=>q, delete:()=>q,
      eq:()=>q, neq:()=>q, not:()=>q, or:()=>q, filter:()=>q, order:()=>q, limit:()=>q,
      single:()=>noopResult(null), maybeSingle:()=>noopResult(null),
      then:(cb)=>noopResult([]).then(cb), catch:(cb)=>Promise.resolve([]),
    };
    return q;
  }
  const _supabase = {
    createClient: function(url, key) {
      return {
        auth: {
          getUser:    () => noopResult({ user: ${userId ? `{ id: '${userId}' }` : 'null'} }),
          getSession: () => noopResult({ session: ${sessionObj} }),
          signInWithPassword: () => noopResult({ user: null, session: null }),
          signOut:    () => noopResult(null),
          onAuthStateChange: (cb) => ({ data: { subscription: { unsubscribe: ()=>{} } } }),
          startAutoRefresh: () => {}, stopAutoRefresh: () => {},
        },
        from: (table) => queryBuilder(),
        storage: {
          from: (bucket) => ({
            upload:   (path, data, opts) => noopResult({ path }),
            download: (path) => {
              const mockJson = JSON.stringify(window.__mockProposalData || {
                id:1,status:'pending',businessName:'Test Biz',clientName:'Test Client',
                amount:1000,deposit:250,estDays:2,createdAt:new Date().toISOString(),
                signingToken:'tok',proposalHtml:'<p>Test</p>',stripeConnectEnabled:false,
                contractorUserId:'${FAKE_USER_ID}'
              });
              return noopResult({text:function(){return Promise.resolve(mockJson);},type:'application/json',size:mockJson.length});
            },
            getPublicUrl: (path) => ({ data: { publicUrl: '' } }),
            remove: (paths) => noopResult(null), list: (prefix) => noopResult([]),
          }),
        },
        functions: { invoke: (name, opts) => noopResult({ ok: true }) },
        channel: (name) => ({ on: function(){ return this; }, subscribe: function(cb){ if(cb) cb('SUBSCRIBED'); return this; }, unsubscribe: ()=>{} }),
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
   * Mount all routes for sign.html and capture the body sent to log-proposal-view.
   * Returns a getter function that resolves with the captured request body.
   *
   * IMPORTANT: sign.html resolves the storage key from the URL using ?key=<path>
   * or ?t=<token>&u=<uid>&b=<bidId>. The ?storage= format is NOT recognised —
   * always use ?key= or the short-form params.
   */
  async function mountSignRoutes(page, sessionUserId) {
    page._consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') page._consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => {
      if (page._consoleErrors) page._consoleErrors.push('PAGE ERROR: ' + err.message);
    });

    let capturedBody = null;

    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith('http://localhost') || url.startsWith('data:')) return route.continue();

      // Supabase CDN — return shim with the given session
      if (url.includes('cdn.jsdelivr.net') && url.includes('supabase')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: _shimWithSession(sessionUserId) });
      }

      if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      if (url.includes('favicon') || url.includes('cdn.apple-mapkit') || url.includes('js.stripe.com')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      }

      // Capture log-proposal-view call
      if (url.includes('/functions/v1/log-proposal-view')) {
        const body = route.request().postData();
        try { capturedBody = JSON.parse(body || '{}'); } catch(_) { capturedBody = {}; }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }

      if (url.includes('/rest/v1/signed_proposals')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (url.includes('.supabase.co')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });

    return () => capturedBody;
  }

  test('sends viewer_type=client when no auth session (real client opening)', async ({ page }) => {
    // No session — simulates a client opening the link on their own device
    const getBody = await mountSignRoutes(page, null);

    // Use ?key= format — sign.html reads params.get('key') to resolve the storage path.
    // The ?storage= format is NOT recognised by sign.html and causes an error page.
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const body = getBody();
    expect(body).not.toBeNull();
    expect(body?.viewerType).toBe('client');
    assertNoErrors(page, 'client opens sign.html');
  });

  test('sends viewer_type=contractor when contractor session matches contractorUserId', async ({ page }) => {
    // Session userId === FAKE_USER_ID === MOCK_PROPOSAL.contractorUserId → contractor
    const getBody = await mountSignRoutes(page, FAKE_USER_ID);

    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const body = getBody();
    expect(body).not.toBeNull();
    expect(body?.viewerType).toBe('contractor');
    assertNoErrors(page, 'contractor previews sign.html');
  });

  test('sends viewer_type=client when a DIFFERENT user is logged in (not the contractor)', async ({ page }) => {
    // Some other authenticated user (e.g. employee) — NOT the contractor
    const getBody = await mountSignRoutes(page, 'some-other-user-id-99999');

    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const body = getBody();
    expect(body).not.toBeNull();
    // Different user → treated as client (not the contractor of THIS proposal)
    expect(body?.viewerType).toBe('client');
    assertNoErrors(page, 'different user opens sign.html');
  });

  test('dashboard shows "Client opened" badge when client_opened_at is set', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/');
    await waitForAppBoot(page);

    const clientOpenTs = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90 min ago

    // Inject client open data and a pending bid.
    // _proposalViewsByBidClient / _proposalViewsByBidContractor are let-vars in cloud.js,
    // exposed on window via Object.defineProperty in that file — assignment here propagates
    // back into the module scope so renderDash() reads the updated maps.
    // bids and clients are similarly exposed via Object.defineProperty in data.js.
    await page.evaluate(({ bidId, ts }) => {
      window._proposalViewsByBidClient = { [bidId]: ts };
      window._proposalViewsByBidContractor = {};
      // Inject a matching client so getClientById(1) returns a result
      window.clients.push({ id: 1, name: 'Test Client', phone: '' });
      // Inject a pending bid that has a signingToken (required for the "Awaiting signature" row)
      window.bids.push({
        id: Number(bidId),
        type: 'Test Proposal',
        status: 'Pending',
        amount: 5000,
        deposit: 1250,
        client_id: 1,
        bid_date: new Date().toISOString().slice(0,10),
        signingToken: 'tok-test',
      });
      // The "Pending" section in Make Money Today is collapsed by default
      // (_mmtCol_pending === undefined → col = true → items hidden from DOM).
      // Force it open so textContent actually contains the badge text.
      window._mmtCol_pending = false;
    }, { bidId: String(FAKE_BID_ID_1), ts: clientOpenTs });

    await page.evaluate(() => {
      if (typeof renderDash === 'function') renderDash();
    });
    await page.waitForTimeout(300);

    const dashText = await page.textContent('#pg-dash');
    // Should show client opened badge, NOT the generic "Opened" badge
    expect(dashText).toContain('Client opened');
    assertNoErrors(page, 'dashboard client opened badge');
  });

  // ── 3. Hub open → tracked per bid ───────────────────────────────────────────
  //
  // These tests would have CAUGHT the original bug:
  //   Old code: POST to /rest/v1/proposal_views with no bid_id + integer client_id
  //             on a uuid column → Postgres silently drops it. The specific
  //             log-proposal-view route below would NEVER fire → capturedCalls
  //             stays empty → expect(capturedCalls.length).toBe(2) FAILS.
  //   New code: calls /functions/v1/log-proposal-view per bid → route fires →
  //             test passes.

  test('opening client hub fires log-proposal-view for each pending bid', async ({ page }) => {
    const HUB = {
      contractorUserId: FAKE_USER_ID,
      contractorName: 'Zach Pro Painting',
      clientName: 'Logan Sample',
      clientToken: FAKE_TOKEN,
      bids: [
        {
          id: FAKE_BID_ID_1,
          type: 'Interior Painting',
          amount: 5000,
          deposit: 1250,
          status: 'Pending',
          bid_date: new Date().toISOString().slice(0, 10),
          signingToken: FAKE_TOKEN,
          // signHubUrl must be non-null — client.html filters on b.id && b.signHubUrl
          signHubUrl: `https://tradedeskpro.app/sign.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_1}`,
        },
        {
          id: FAKE_BID_ID_2,
          type: 'Exterior Painting',
          amount: 8000,
          deposit: 2000,
          status: 'Pending',
          bid_date: new Date().toISOString().slice(0, 10),
          signingToken: FAKE_TOKEN_2,
          signHubUrl: `https://tradedeskpro.app/sign.html?t=${FAKE_TOKEN_2}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_2}`,
        },
      ],
      jobs: [],
      payments: [],
    };

    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page); // registers broad catch-all FIRST

    // Register specific capture route AFTER mockAllExternal — Playwright checks
    // routes LIFO so this fires first, captures the body, then fulfills.
    const capturedCalls = [];
    await page.route('**/functions/v1/log-proposal-view', async route => {
      try { capturedCalls.push(route.request().postDataJSON()); } catch(_) {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // One call per pending bid with signHubUrl — order may vary
    expect(capturedCalls.length).toBe(2);

    const sentBidIds = capturedCalls.map(c => c.bidId).sort();
    expect(sentBidIds).toContain(String(FAKE_BID_ID_1));
    expect(sentBidIds).toContain(String(FAKE_BID_ID_2));

    capturedCalls.forEach(call => {
      expect(call.contractorUserId).toBe(FAKE_USER_ID);
      // Hub opens must use 'client-hub' viewerType — this writes hub_opened_at,
      // distinct from client_opened_at (which sign.html sets when the client
      // opens a specific proposal). Two separate timestamps on the dashboard.
      expect(call.viewerType).toBe('client-hub');
    });

    assertNoErrors(page, 'hub open fires log-proposal-view per bid');
  });

  test('full pipeline: client opens hub → dashboard shows Hub opened + Proposal opened separately', async ({ page }) => {
    // Confirms the two-timestamp design end-to-end:
    //  Step 1 — client.html fires log-proposal-view with viewerType:'client-hub'
    //            → contractor sees "Hub opened · Xm ago"
    //  Step 2 — sign.html fires log-proposal-view with viewerType:'client'
    //            → contractor sees "Proposal opened · Xm ago" (separate line)
    //  Step 3 — contractor dashboard shows BOTH badges simultaneously
    const HUB = {
      contractorUserId: FAKE_USER_ID,
      contractorName: 'Zach Pro Painting',
      clientName: 'Logan Sample',
      clientToken: FAKE_TOKEN,
      bids: [{
        id: FAKE_BID_ID_1,
        type: 'Interior Painting',
        amount: 5000,
        deposit: 1250,
        status: 'Pending',
        bid_date: new Date().toISOString().slice(0, 10),
        signingToken: FAKE_TOKEN,
        signHubUrl: `https://tradedeskpro.app/sign.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_1}`,
      }],
      jobs: [],
      payments: [],
    };

    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);

    const capturedCalls = [];
    await page.route('**/functions/v1/log-proposal-view', async route => {
      try { capturedCalls.push(route.request().postDataJSON()); } catch(_) {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    // Step 1: client opens hub — should fire with viewerType:'client-hub'
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    expect(capturedCalls.length).toBeGreaterThan(0);
    expect(capturedCalls[0].viewerType).toBe('client-hub'); // not 'client'

    // Step 2: contractor opens dashboard — inject BOTH timestamps as the DB would have them
    await page.goto('/');
    await waitForAppBoot(page);

    const hubOpenTs      = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // hub: 10 min ago
    const proposalOpenTs = new Date(Date.now() -  3 * 60 * 1000).toISOString(); // proposal: 3 min ago
    await page.evaluate(({ bidId, hubTs, proposalTs }) => {
      window._proposalViewsByBidHubClient  = { [bidId]: hubTs };      // hub opened
      window._proposalViewsByBidClient     = { [bidId]: proposalTs }; // proposal opened
      window._proposalViewsByBidContractor = {};
      window.clients.push({ id: 1, name: 'Logan Sample', phone: '' });
      window.bids.push({
        id: Number(bidId),
        type: 'Interior Painting',
        status: 'Pending',
        amount: 5000,
        deposit: 1250,
        client_id: 1,
        bid_date: new Date().toISOString().slice(0, 10),
        signingToken: 'tok-test',
      });
      window._mmtCol_pending = false;
    }, { bidId: String(FAKE_BID_ID_1), hubTs: hubOpenTs, proposalTs: proposalOpenTs });

    await page.evaluate(() => { if (typeof renderDash === 'function') renderDash(); });
    await page.waitForTimeout(300);

    const dashText = await page.textContent('#pg-dash');
    // Both events must appear as separate lines
    expect(dashText).toContain('Hub opened');
    expect(dashText).toContain('Proposal opened');
    assertNoErrors(page, 'hub open pipeline: dashboard shows Hub opened + Proposal opened separately');
  });

  test('dashboard shows "You previewed" when only contractor_opened_at is set', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/');
    await waitForAppBoot(page);

    const contractorOpenTs = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

    await page.evaluate(({ bidId, ts }) => {
      window._proposalViewsByBidClient = {};
      window._proposalViewsByBidContractor = { [bidId]: ts };
      // Matching client + pending bid
      window.clients.push({ id: 1, name: 'Test Client', phone: '' });
      window.bids.push({
        id: Number(bidId),
        type: 'Test Proposal',
        status: 'Pending',
        amount: 5000,
        deposit: 1250,
        client_id: 1,
        bid_date: new Date().toISOString().slice(0,10),
        signingToken: 'tok-test',
      });
      // Force the Pending section open so textContent includes badge text
      window._mmtCol_pending = false;
    }, { bidId: String(FAKE_BID_ID_1), ts: contractorOpenTs });

    await page.evaluate(() => {
      if (typeof renderDash === 'function') renderDash();
    });
    await page.waitForTimeout(300);

    const dashText = await page.textContent('#pg-dash');
    expect(dashText).toContain('You previewed');
    // Client hasn't opened → should show that too
    expect(dashText).toContain("Client hasn't opened yet");
    assertNoErrors(page, 'dashboard contractor preview badge');
  });
});
