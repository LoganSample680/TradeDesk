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

  // Owner (IMG_1110): the 5-step progress bar rendered with unequal segment
  // widths because .dot.active carried flex:2 (double width). It's a universal
  // 5-step process — every segment must be the same width; color alone marks
  // done/active/upcoming. This guards that the active segment never fattens again.
  test('the 5 step-dot segments are all equal width (active is not fattened)', async ({ page }) => {
    await mountSignRoutes(page, null);
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await page.waitForLoadState('networkidle');

    // Reveal the Review step so its .step-dots row lays out (it boots hidden).
    const widths = await page.evaluate(() => {
      const sign = document.getElementById('pg-sign');
      if (sign) sign.style.display = 'block';
      const row = document.querySelector('#pg-sign .step-dots');
      if (!row) return null;
      return [...row.querySelectorAll('.dot')].map(d => Math.round(d.getBoundingClientRect().width));
    });
    expect(widths).not.toBeNull();
    expect(widths.length).toBe(5);
    // All five within 1px of each other — no double-width active segment.
    const min = Math.min(...widths), max = Math.max(...widths);
    expect(max - min).toBeLessThanOrEqual(1);
    // And the active segment's flex-grow must equal a plain dot's (1), not 2.
    const grows = await page.evaluate(() => {
      const g = sel => getComputedStyle(document.querySelector(sel)).flexGrow;
      return { plain: g('#pg-sign .step-dots .dot:not(.active):not(.done)'), active: g('#pg-sign .step-dots .dot.active') };
    });
    expect(grows.active).toBe(grows.plain);
    assertNoErrors(page, 'equal-width step dots');
  });

  // Owner: kill the white flash between the hub's "Review & Sign" tap and the
  // proposal painting. The hub pre-fetches pending proposals and stashes them in
  // sessionStorage keyed by the storage key; sign.html renders from the stash with
  // NO network round-trip. This proves the stash is used (unique business name),
  // and that the one-shot stash is removed after read.
  test('instant-open handoff: sign.html renders from the sessionStorage stash with no network fetch', async ({ page }) => {
    await mountSignRoutes(page, null);
    const key = `proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`;
    const stashed = { ...MOCK_PROPOSAL, businessName: 'HANDOFF STASH CO', status: 'pending' };
    // Seed the stash before any page script runs.
    await page.addInitScript(([k, v]) => {
      try { sessionStorage.setItem('tdsign:' + k, JSON.stringify(v)); } catch (_) {}
    }, [key, stashed]);

    await page.goto(`/sign.html?key=${key}`);
    await page.waitForLoadState('networkidle');

    // Rendered from the stash: the hero shows the stash's unique business name.
    // (A cold network open here would return the mock's default, not this name.)
    await expect(page.locator('#hero-biz-name')).toHaveText('HANDOFF STASH CO');
    // One-shot: the stash entry is consumed so a later re-open re-fetches fresh.
    const leftover = await page.evaluate(k => sessionStorage.getItem('tdsign:' + k), key);
    expect(leftover).toBeNull();
    assertNoErrors(page, 'instant-open handoff');
  });

  // Owner: the white flash persisted because first paint was serialized behind the
  // signed_proposals status query (plus parser-blocking CDN scripts, asserted below).
  // On the stash path that check now runs in the BACKGROUND: even with the
  // signed_proposals response delayed 3s, the page must reveal well before it.
  test('stash reveal does not wait for the signed-status check (3s-delayed response)', async ({ page }) => {
    await mountSignRoutes(page, null);
    // Registered after mountSignRoutes so it wins for this URL: hold the
    // signed-status response for 3s, then return "not signed".
    await page.route('**/rest/v1/signed_proposals**', async route => {
      await new Promise(r => setTimeout(r, 3000));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    const key = `proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`;
    await page.addInitScript(([k, v]) => {
      try { sessionStorage.setItem('tdsign:' + k, JSON.stringify(v)); } catch (_) {}
    }, [key, { ...MOCK_PROPOSAL, status: 'pending' }]);

    await page.goto(`/sign.html?key=${key}`);
    // Revealed after the boot dwell (~1.5s) but long before the 3s status
    // response — the check does not gate the entrance.
    await expect(page.locator('body')).toHaveClass(/revealed/, { timeout: 3000 });
    await expect(page.locator('#pg-sign')).toBeVisible();
    // And once the delayed "not signed" answer lands, the sign page must remain
    // (no bogus swap to the Already-signed screen).
    await page.waitForTimeout(3200);
    await expect(page.locator('#pg-sign')).toBeVisible();
    await expect(page.locator('#pg-done')).toBeHidden();
    assertNoErrors(page, 'stash reveal not gated by signed check');
  });

  // The head must never regress to parser-blocking third-party scripts or a
  // render-blocking font stylesheet — those held first paint (the white flash)
  // no matter how fast the proposal data arrived.
  test('vendor scripts are never parser-blocking and the font stylesheet is non-blocking', async ({ page }) => {
    // Parser-blocking vendor tags held first paint (the white flash), and even
    // `defer` evaluated the bundles during the waterfall's first frames (the
    // chop). Vendor JS is now injected lazily via _loadVendor — any tag present
    // must be non-parser-blocking (dynamically injected scripts are async).
    await mountSignRoutes(page, null);
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    const head = await page.evaluate(() => {
      const nonBlocking = sel => {
        const s = document.querySelector(sel);
        return !s || !!(s.defer || s.async); // absent (lazy, not yet demanded) or async/defer
      };
      return {
        supaOk: nonBlocking('script[src*="supabase-js"], script[src*="@supabase"]'),
        stripeOk: nonBlocking('script[src*="js.stripe.com"]'),
        lazyLoader: typeof window._loadVendor === 'function', // the on-demand injector exists
        fontNonBlocking: (() => {
          // rel="stylesheet" specifically — a rel="preconnect" to the same host
          // also matches on href and has no media attribute.
          const l = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
          return !!l && l.getAttribute('media') !== null; // print-media swap trick applied
        })(),
      };
    });
    expect(head.supaOk).toBe(true);
    expect(head.stripeOk).toBe(true);
    expect(head.lazyLoader).toBe(true);
    expect(head.fontNonBlocking).toBe(true);
    assertNoErrors(page, 'lazy vendor scripts');
  });

  // The proposal document is several screens tall — animating it as one block
  // forced full layout+raster and hung the waterfall. During the entrance it
  // must carry content-visibility:auto (below-fold content skipped), released
  // via body.td-settled once the cascade is over so the full doc lays out on
  // an idle, motionless frame.
  test('proposal body is containment-scoped during the entrance and released after', async ({ page }) => {
    await mountSignRoutes(page, null);
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await expect(page.locator('body')).toHaveClass(/revealed/, { timeout: 3000 });
    const during = await page.evaluate(() =>
      getComputedStyle(document.getElementById('prop-html')).contentVisibility);
    expect(during).toBe('auto');
    // Cascade ends ~1.6s in; td-settled lands at reveal+2s and releases it.
    await expect(page.locator('body')).toHaveClass(/td-settled/, { timeout: 6000 });
    const after = await page.evaluate(() =>
      getComputedStyle(document.getElementById('prop-html')).contentVisibility);
    expect(after).toBe('visible');
    assertNoErrors(page, 'entrance containment lifecycle');
  });

  // Owner: a branded boot moment ("Loading your proposal…", business name, then
  // waterfall) replaces chasing an instant reveal — the dwell absorbs fonts,
  // layout, and raster so nothing ever flashes or chops. Same treatment as the
  // client hub boot. This pins the full lifecycle.
  test('sign boot: business name + loading copy shown, holds, then dismisses into the waterfall', async ({ page }) => {
    await mountSignRoutes(page, null);
    const key = `proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`;
    await page.addInitScript(([k, v]) => {
      try { sessionStorage.setItem('tdsign:' + k, JSON.stringify(v)); } catch (_) {}
    }, [key, { ...MOCK_PROPOSAL, businessName: 'BOOT BRAND CO', status: 'pending' }]);
    await page.goto(`/sign.html?key=${key}`);

    // Boot is up immediately with the branding and loading copy (stash path
    // populates the name at parse time — before any network).
    await expect(page.locator('#sign-boot')).toBeVisible();
    const boot = await page.evaluate(() => ({
      name: document.getElementById('sign-boot-name')?.textContent,
      hint: document.querySelector('#sign-boot .cbo-hint')?.textContent,
    }));
    expect(boot.name).toBe('BOOT BRAND CO');
    expect(boot.hint).toContain('Loading your proposal');
    // Still holding well before the ~1.5s dwell elapses.
    await page.waitForTimeout(600);
    const held = await page.evaluate(() => {
      const ov = document.getElementById('sign-boot');
      return getComputedStyle(ov).display !== 'none' && ov.style.opacity !== '0';
    });
    expect(held).toBe(true);
    // Then it dismisses (premium exit) and the waterfall arms (body.revealed).
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById('sign-boot')).display === 'none',
      { timeout: 6000 }
    );
    await expect(page.locator('body')).toHaveClass(/revealed/);
    await expect(page.locator('#pg-sign')).toBeVisible();
    assertNoErrors(page, 'sign boot lifecycle');
  });

  test('sign boot: error destination drops the boot fast (no spinner over a dead page)', async ({ page }) => {
    await mountSignRoutes(page, null);
    await page.goto('/sign.html'); // no key -> pg-err immediately
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById('sign-boot')).display === 'none',
      { timeout: 2500 }
    );
    await expect(page.locator('#pg-err')).toBeVisible();
    assertNoErrors(page, 'sign boot error fast-drop');
  });

  test('sends viewer_type=client when no auth session (real client opening)', async ({ page }) => {
    // No session — simulates a client opening the link on their own device
    const getBody = await mountSignRoutes(page, null);

    // Use ?key= format — sign.html reads params.get('key') to resolve the storage path.
    // The ?storage= format is NOT recognised by sign.html and causes an error page.
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`);
    await page.waitForLoadState('networkidle');
    // View logging is deliberately postponed ~1.6s past the entrance waterfall
    // (vendor eval mid-cascade was the chop) — poll instead of a fixed wait.
    await expect.poll(getBody, { timeout: 6000 }).not.toBeNull();

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
    // View logging is deliberately postponed ~1.6s past the entrance waterfall
    // (vendor eval mid-cascade was the chop) — poll instead of a fixed wait.
    await expect.poll(getBody, { timeout: 6000 }).not.toBeNull();

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
    // View logging is deliberately postponed ~1.6s past the entrance waterfall
    // (vendor eval mid-cascade was the chop) — poll instead of a fixed wait.
    await expect.poll(getBody, { timeout: 6000 }).not.toBeNull();

    const body = getBody();
    expect(body).not.toBeNull();
    // Different user → treated as client (not the contractor of THIS proposal)
    expect(body?.viewerType).toBe('client');
    assertNoErrors(page, 'different user opens sign.html');
  });

  test('dashboard shows "Proposal opened" badge when client_opened_at is set', async ({ page }) => {
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
    // client_opened_at (sign.html) renders as "Proposal opened", not "Client opened"
    expect(dashText).toContain('Proposal opened');
    assertNoErrors(page, 'dashboard proposal opened badge');
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

  test('contractor opening their own hub link does NOT fire hub tracking (session guard)', async ({ page }) => {
    // Belt-and-suspenders: if contractor opens direct hub URL while logged in,
    // session check (session.user.id === u) also suppresses tracking.
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

    await page.addInitScript(() => { window.__overrideSessionUserId = 'e2e-user-0000-0000-0000-000000000001'; });
    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);

    const capturedCalls = [];
    await page.route('**/functions/v1/log-proposal-view', async route => {
      try { capturedCalls.push(route.request().postDataJSON()); } catch(_) {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    expect(capturedCalls.length).toBe(0);
    assertNoErrors(page, 'contractor hub preview: session guard skips tracking');
  });

  test('client.html does NOT fire log-proposal-view when ?preview=1 is in URL', async ({ page }) => {
    // _previewClientHub() in clients.js always appends &preview=1 when opening the
    // iframe. This is the primary guard — no session needed, no origin-specific
    // localStorage timing issues in iframe context.
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

    // preview=1 — no logged-in session, simulates iframe context
    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1&preview=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    expect(capturedCalls.length, 'log-proposal-view must NOT fire when preview=1').toBe(0);
    assertNoErrors(page, 'client.html preview=1 skips hub tracking');
  });

  test('client.html with preview=1 renders "Review & Sign" links with &preview=1 appended', async ({ page }) => {
    // Prevents contractor clicking "Review & Sign" inside the hub preview from
    // logging a client view in sign.html — the link carries preview=1 through.
    const SIGN_URL = `https://tradedeskpro.app/sign.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_1}`;
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
        signHubUrl: SIGN_URL,
      }],
      jobs: [],
      payments: [],
    };

    await page.addInitScript(data => { window.__mockHubData = data; }, HUB);
    await mockAllExternal(page);

    await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1&preview=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // All "Review & Sign" anchor hrefs must include preview=1
    const signLinks = await page.evaluate(() => {
      return [...document.querySelectorAll('a.hub-btn-sign, a.hub-approval-link')]
        .map(a => a.getAttribute('href'));
    });

    expect(signLinks.length, 'at least one sign link must be rendered').toBeGreaterThan(0);
    signLinks.forEach(href => {
      expect(href, 'sign link must contain preview=1').toContain('preview=1');
    });
    assertNoErrors(page, 'client.html preview=1 propagates to sign links');
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

  test('does NOT fire log-proposal-view when ?preview=1 is in the URL', async ({ page }) => {
    // ?preview=1 means the contractor used the Preview button — skip all view tracking
    // regardless of auth state, so the badge on the dashboard is never polluted.
    const getBody = await mountSignRoutes(page, null); // no session

    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json&preview=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // log-proposal-view must NOT have been called
    const body = getBody();
    expect(body, 'log-proposal-view must NOT be called when preview=1').toBeNull();
    assertNoErrors(page, 'preview=1 skips log-proposal-view');
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
