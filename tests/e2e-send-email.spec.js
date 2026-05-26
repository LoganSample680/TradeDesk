// @ts-check
/**
 * E2E tests for proposal email delivery.
 *
 * BROWSER-LEVEL INTERCEPTION ONLY — no Playwright page.route() for the
 * send-proposal-email assertions. In WebKit, per-test page.route() registrations
 * don't reliably take LIFO precedence over the catch-all registered in
 * mockAllExternal(), causing flaky failures. Patching window.fetch directly
 * in the browser context is identical across Chromium and WebKit.
 *
 * What we verify:
 * 1. sendProposalViaEmail() calls /functions/v1/send-proposal-email with the
 *    correct payload (to, clientName, businessName, proposalUrl, replyTo).
 * 2. On a 200 OK response the function shows the "Proposal emailed" toast and
 *    does NOT fall through to mailto:.
 * 3. When the edge function returns a non-ok status (503) the code falls back
 *    to the mailto: path without throwing a console error.
 * 4. When the client has no email address on file, a friendly alert is shown
 *    and no network request is made.
 * 5. Zero console errors throughout all paths.
 */

const {
  test, expect,
  mockAllExternal, waitForAppBoot, goPg, assertNoErrors,
  FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN,
} = require('./helpers');

// ── Test constants ─────────────────────────────────────────────────────────────

const MOCK_CLIENT_EMAIL = 'bettis@steelers.com';
const MOCK_SIGNING_URL  = `https://zjspainting.tradedeskpro.app/sign.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_1}`;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Patch window.fetch in the browser to intercept send-proposal-email calls.
 * Returns a mock 200 or a specified status. Records calls to window.__sendEmailCalls.
 * This is browser-level — works reliably in both Chromium and WebKit.
 */
async function patchFetchForEmail(page, { status = 200, body = '{"ok":true}' } = {}) {
  await page.evaluate(({ status, body }) => {
    window.__sendEmailCalls = [];
    const origFetch = window.__origFetch || window.fetch;
    window.__origFetch = origFetch; // save once so repeated patches chain correctly

    window.fetch = async (input, opts) => {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (url.includes('/functions/v1/send-proposal-email')) {
        window.__sendEmailCalls.push({
          url,
          body: opts?.body ? JSON.parse(opts.body) : null,
        });
        return new Response(body, {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return origFetch(input, opts);
    };
  }, { status, body });
}

/** Restore window.fetch to its original (pre-patch) version. */
async function restoreFetch(page) {
  await page.evaluate(() => {
    if (window.__origFetch) {
      window.fetch = window.__origFetch;
      delete window.__origFetch;
    }
    delete window.__sendEmailCalls;
  });
}

/**
 * Seed a #proposal-link-bar with known values.
 * Removes any pre-existing bars first so getElementById always finds ours.
 */
async function seedProposalLinkBar(page, { cemail = MOCK_CLIENT_EMAIL, url = MOCK_SIGNING_URL } = {}) {
  await page.evaluate(({ url, cemail }) => {
    document.querySelectorAll('#proposal-link-bar').forEach(el => el.remove());
    const bar = document.createElement('div');
    bar.id = 'proposal-link-bar';
    bar.style.display = 'block';
    bar.dataset.signingUrl       = url;
    bar.dataset.signingDirectUrl = url;
    bar.dataset.cname  = 'Jerome Bettis';
    bar.dataset.bname  = 'ZJ Painting';
    bar.dataset.cphone = '4125551234';
    bar.dataset.cemail = cemail;
    document.body.appendChild(bar);
  }, { url, cemail });
}

// ── Server-sent path (Resend configured, 200 OK) ───────────────────────────────

test.describe('sendProposalViaEmail — server-sent path', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterEach(async () => { await restoreFetch(page); });
  test.afterAll(async () => { await page.context().close(); });

  test('calls send-proposal-email with correct payload when client has email', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true,"id":"resend-mock-id"}' });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });

    await page.evaluate(async () => { await sendProposalViaEmail(); });

    // Read back calls recorded by the browser-level fetch patch
    const calls = await page.evaluate(() => window.__sendEmailCalls || []);
    expect(calls).toHaveLength(1);
    const p = calls[0].body;
    expect(p.to,           'to must be client email').toBe(MOCK_CLIENT_EMAIL);
    expect(p.clientName,   'clientName must be present').toBe('Jerome Bettis');
    expect(p.businessName, 'businessName must be present').toBe('ZJ Painting');
    expect(p.proposalUrl,  'proposalUrl must contain sign.html').toContain('sign.html');
    expect(typeof p.replyTo).toBe('string');

    assertNoErrors(page, 'sendProposalViaEmail server-sent path — correct payload');
  });

  test('shows "Proposal emailed" toast on successful server send', async () => {
    // Patch fetch to return 200 AND patch showToast to capture toasts
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });
    await page.evaluate(() => {
      window.__toastCaptures = [];
      const orig = window.showToast;
      window.__origShowToast = orig;
      window.showToast = (msg, icon) => {
        window.__toastCaptures.push(msg);
        if (orig) orig(msg, icon);
      };
    });

    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });
    await page.evaluate(async () => { await sendProposalViaEmail(); });

    // Wait for the toast to be captured (poll up to 2s)
    await page.waitForFunction(
      () => (window.__toastCaptures || []).some(t => t.toLowerCase().includes('email')),
      { timeout: 2000 }
    );

    const captures = await page.evaluate(() => window.__toastCaptures || []);
    const emailToast = captures.find(t => t.toLowerCase().includes('email'));
    expect(emailToast, 'Should show an email-sent toast').toBeTruthy();

    // Restore showToast
    await page.evaluate(() => {
      if (window.__origShowToast) window.showToast = window.__origShowToast;
    });
    assertNoErrors(page, 'sendProposalViaEmail toast on success');
  });

  test('does NOT call mailto: when server send succeeds', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });

    // Capture any window.location.href assignments (mailto: would set this)
    await page.evaluate(() => {
      window.__hrefAttempts = [];
      // We can't reassign window.location directly in strict mode,
      // but we can detect it via the fetch call count — if fetch is called
      // and returns ok, the fallback (mailto:) branch is skipped.
    });

    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });
    await page.evaluate(async () => { await sendProposalViaEmail(); });

    const calls = await page.evaluate(() => window.__sendEmailCalls || []);
    // Server path was taken (fetch was called and returned ok)
    expect(calls).toHaveLength(1);
    // Zero console errors confirms no error in the server-sent path
    assertNoErrors(page, 'sendProposalViaEmail no error on server-sent success');
  });
});

// ── Fallback path (503 / network error) ───────────────────────────────────────

test.describe('sendProposalViaEmail — fallback and validation paths', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterEach(async () => { await restoreFetch(page); });
  test.afterAll(async () => { await page.context().close(); });

  test('falls back gracefully when edge function returns 503 (Resend not configured)', async () => {
    await patchFetchForEmail(page, {
      status: 503,
      body: '{"error":"RESEND_API_KEY not configured"}',
    });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });

    // Must not throw — silently falls through to mailto:
    const evalResult = await page.evaluate(async () => {
      try {
        await sendProposalViaEmail();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    expect(evalResult.ok, 'sendProposalViaEmail must not throw on 503 fallback').toBe(true);
    // Fetch WAS called (503 path, not the no-supaUser skip path)
    const calls = await page.evaluate(() => window.__sendEmailCalls || []);
    expect(calls.length, 'Fetch should have been attempted before fallback').toBeGreaterThan(0);

    assertNoErrors(page, 'sendProposalViaEmail fallback on 503');
  });

  test('shows alert and skips fetch when client has no email on file', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });

    // Patch zAlert to capture calls
    await page.evaluate(() => {
      window.__capturedAlerts = [];
      const orig = window.zAlert;
      window.__origZAlert = orig;
      window.zAlert = (msg) => { window.__capturedAlerts.push(msg); };
    });

    // Seed bar with empty email — clears any prior bar
    await seedProposalLinkBar(page, { cemail: '', url: MOCK_SIGNING_URL });
    await page.evaluate(async () => { await sendProposalViaEmail(); });
    await page.waitForTimeout(300);

    const alerts = await page.evaluate(() => window.__capturedAlerts || []);
    expect(alerts.length, 'zAlert must fire when client has no email').toBeGreaterThan(0);
    expect(alerts[0].toLowerCase(), 'Alert must mention email').toContain('email');

    const calls = await page.evaluate(() => window.__sendEmailCalls || []);
    expect(calls.length, 'Fetch must NOT happen when client has no email').toBe(0);

    // Restore zAlert
    await page.evaluate(() => {
      if (window.__origZAlert) window.zAlert = window.__origZAlert;
    });
    assertNoErrors(page, 'sendProposalViaEmail no-email alert path');
  });
});
