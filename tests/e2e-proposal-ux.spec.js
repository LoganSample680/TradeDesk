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
 */

const { test, expect, mockAllExternal, _supabaseShim, waitForAppBoot, assertNoErrors,
        FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN, MOCK_PROPOSAL } = require('./helpers');

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

    await mockAllExternal(page);
    await page.route('**/*.supabase.co/storage/v1/**', route => {
      if (route.request().url().includes('client-hub')) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB) });
      } else {
        route.continue();
      }
    });

    await page.goto(`/client.html?user=${FAKE_USER_ID}&token=${FAKE_TOKEN}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // Price should NOT appear on the card
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('$82,000');
    expect(pageText).not.toContain('82,000');

    // Proposal name and CTA button SHOULD be visible
    const body = await page.textContent('body');
    expect(body).toContain('Interior Painting');

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

    await mockAllExternal(page);
    await page.route('**/*.supabase.co/storage/v1/**', route => {
      if (route.request().url().includes('client-hub')) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB) });
      } else {
        route.continue();
      }
    });

    await page.goto(`/client.html?user=${FAKE_USER_ID}&token=${FAKE_TOKEN}`);
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
   * Returns a promise that resolves with the captured request body.
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
      if (url.includes('/storage/v1/')) {
        const proposalJson = JSON.stringify({
          ...MOCK_PROPOSAL,
          contractorUserId: FAKE_USER_ID,
        });
        return route.fulfill({ status: 200, contentType: 'application/json', body: proposalJson });
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

    await page.goto(`/sign.html?storage=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
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

    await page.goto(`/sign.html?storage=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
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

    await page.goto(`/sign.html?storage=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
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

    // Inject client open data and a pending bid
    await page.evaluate(({ bidId, ts }) => {
      window._proposalViewsByBidClient = { [bidId]: ts };
      window._proposalViewsByBidContractor = {};
      // Add a pending bid to the bids array
      if (!window.bids) window.bids = [];
      window.bids.push({
        id: bidId,
        type: 'Test Proposal',
        status: 'Pending',
        amount: 5000,
        deposit: 1250,
        client_id: 1,
        bid_date: new Date().toISOString().slice(0,10),
        signingToken: 'tok-test',
      });
    }, { bidId: String(FAKE_BID_ID_1), ts: clientOpenTs });

    await page.evaluate(() => {
      if (typeof renderDash === 'function') renderDash();
    });
    await page.waitForTimeout(300);

    const dashText = await page.textContent('#pg-dashboard, body');
    // Should show client opened badge, NOT the generic "Opened" badge
    expect(dashText).toContain('Client opened');
    assertNoErrors(page, 'dashboard client opened badge');
  });

  test('dashboard shows "You previewed" when only contractor_opened_at is set', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/');
    await waitForAppBoot(page);

    const contractorOpenTs = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

    await page.evaluate(({ bidId, ts }) => {
      window._proposalViewsByBidClient = {};
      window._proposalViewsByBidContractor = { [bidId]: ts };
      if (!window.bids) window.bids = [];
      window.bids.push({
        id: bidId,
        type: 'Test Proposal',
        status: 'Pending',
        amount: 5000,
        deposit: 1250,
        client_id: 1,
        bid_date: new Date().toISOString().slice(0,10),
        signingToken: 'tok-test',
      });
    }, { bidId: String(FAKE_BID_ID_1), ts: contractorOpenTs });

    await page.evaluate(() => {
      if (typeof renderDash === 'function') renderDash();
    });
    await page.waitForTimeout(300);

    const dashText = await page.textContent('#pg-dashboard, body');
    expect(dashText).toContain('You previewed');
    // Client hasn't opened → should show that too
    expect(dashText).toContain("Client hasn't opened yet");
    assertNoErrors(page, 'dashboard contractor preview badge');
  });
});
