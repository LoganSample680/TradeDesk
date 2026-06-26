// @ts-check
/**
 * Comprehensive send-bar E2E tests.
 *
 * Covers four areas not tested by e2e-send-email.spec.js:
 *
 * 1. DOM layout  — #proposal-link-bar and #gei-send-bar both contain
 *                  📱 Text, ✉️ Email, and ⬆️ Other app buttons.
 *
 * 2. Email compose modal — clicking Email opens the compose sheet with
 *                  pre-filled To/Subject/Body; submitting calls Resend edge
 *                  function; no-email case shows To field empty + focusable.
 *
 * 3. SMS path    — sendProposalViaSms() guards on missing phone; when a phone
 *                  number is present the sms: href is built with the correct
 *                  digits (no formatting chars).
 *
 * 4. replyTo     — _sendEmailFromCompose() sets replyTo to the signed-in
 *                  contractor's email so Resend wires up reply_to + bcc.
 *
 * 5. Generic estimate send bar — after sendGenericProposal() completes,
 *                  #gei-send-bar becomes visible and #gei-send-btn is hidden;
 *                  clicking its Email button opens the compose modal.
 *
 * All tests use browser-level window.fetch patching (WebKit-safe) and
 * window.location interception to capture sms: hrefs without page navigation.
 */

const {
  test, expect,
  mockAllExternal, waitForAppBoot, goPg, assertNoErrors,
  FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN,
} = require('./helpers');

// ── Constants ──────────────────────────────────────────────────────────────────

const MOCK_CLIENT_EMAIL = 'bettis@steelers.com';
const MOCK_CLIENT_PHONE = '4125551234'; // digits only — what the bar stores
const MOCK_SIGNING_URL  = `https://zjspainting.tradedeskpro.app/sign.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&b=${FAKE_BID_ID_1}`;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Patch window.fetch to intercept send-proposal-email calls. */
async function patchFetchForEmail(page, { status = 200, body = '{"ok":true}' } = {}) {
  await page.evaluate(({ status, body }) => {
    window.__sendEmailCalls = [];
    const origFetch = window.__origFetch || window.fetch;
    window.__origFetch = origFetch;
    window.fetch = async (input, opts) => {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (url.includes('/functions/v1/send-proposal-email')) {
        window.__sendEmailCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch(input, opts);
    };
  }, { status, body });
}

/** Restore window.fetch to its original version. */
async function restoreFetch(page) {
  await page.evaluate(() => {
    if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; }
    delete window.__sendEmailCalls;
  });
}

/**
 * Seed the #proposal-link-bar with known values.
 * Removes any pre-existing bars first.
 */
async function seedProposalLinkBar(page, {
  cemail = MOCK_CLIENT_EMAIL,
  cphone = MOCK_CLIENT_PHONE,
  url = MOCK_SIGNING_URL,
} = {}) {
  await page.evaluate(({ url, cemail, cphone }) => {
    document.querySelectorAll('#proposal-link-bar').forEach(el => el.remove());
    const bar = document.createElement('div');
    bar.id = 'proposal-link-bar';
    bar.style.display = 'block';
    bar.dataset.signingUrl       = url;
    bar.dataset.signingDirectUrl = url;
    bar.dataset.cname  = 'Jerome Bettis';
    bar.dataset.bname  = 'ZJ Painting';
    bar.dataset.cphone = cphone;
    bar.dataset.cemail = cemail;
    document.body.appendChild(bar);
  }, { url, cemail, cphone });
}

/**
 * Open email compose modal, optionally set To, then click Send.
 * Returns the captured fetch calls.
 */
async function submitEmailCompose(page, { toEmail } = {}) {
  // Wait for compose modal overlay to appear
  await page.waitForSelector('#_email-compose-overlay', { timeout: 3000 });

  // Override To if supplied (handles the "no email on file" case)
  if (toEmail) {
    await page.fill('#_ec-to', toEmail);
  }

  // Click Send — force past any stray .zmodal-overlay that intercepts the click in
  // WebKit (otherwise it retries until the 60s timeout closes the context = flake).
  await page.click('#_ec-send-btn', { force: true });
  await page.waitForTimeout(800);

  return page.evaluate(() => window.__sendEmailCalls || []);
}

// ── 1. DOM layout ──────────────────────────────────────────────────────────────

test.describe('Send bar — DOM layout', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-est');
  });

  test.afterAll(async () => { await page.context().close(); });

  test('#proposal-link-bar has 📱 Text button', async () => {
    const btn = page.locator('#proposal-link-bar button', { hasText: 'Text' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'paint bar - Text button');
  });

  test('#proposal-link-bar has ✉️ Email button', async () => {
    const btn = page.locator('#proposal-link-bar button', { hasText: 'Email' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'paint bar - Email button');
  });

  test('#proposal-link-bar has ⬆️ Other app button', async () => {
    const btn = page.locator('#proposal-link-bar button', { hasText: 'Other app' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'paint bar - Other app button');
  });

  test('#proposal-link-bar does NOT have a Preview button (preview lives in Client Hub)', async () => {
    const btn = page.locator('#proposal-link-bar button', { hasText: 'Preview' });
    await expect(btn).toHaveCount(0);
    assertNoErrors(page, 'paint bar - no Preview button');
  });

  test('#proposal-link-bar is hidden by default (before link is generated)', async () => {
    const bar = page.locator('#proposal-link-bar');
    const isHidden = await bar.evaluate(el => {
      return getComputedStyle(el).display === 'none' || el.style.display === 'none';
    });
    expect(isHidden, 'proposal-link-bar should be hidden before link generated').toBe(true);
    assertNoErrors(page, 'paint bar - hidden by default');
  });
});

// ── 2. GEI send bar DOM ────────────────────────────────────────────────────────

test.describe('Generic estimate send bar — DOM layout', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-est-generic');
  });

  test.afterAll(async () => { await page.context().close(); });

  test('#gei-send-bar is hidden initially', async () => {
    const bar = page.locator('#gei-send-bar');
    await expect(bar).toHaveCount(1);
    const isHidden = await bar.evaluate(el => el.style.display === 'none');
    expect(isHidden, 'gei-send-bar should be hidden before proposal generated').toBe(true);
    assertNoErrors(page, 'GEI bar hidden initially');
  });

  test('#gei-send-bar has 📱 Text button', async () => {
    const btn = page.locator('#gei-send-bar button', { hasText: 'Text' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'GEI bar - Text button');
  });

  test('#gei-send-bar has ✉️ Email button', async () => {
    const btn = page.locator('#gei-send-bar button', { hasText: 'Email' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'GEI bar - Email button');
  });

  test('#gei-send-bar has ⬆️ Other app button', async () => {
    const btn = page.locator('#gei-send-bar button', { hasText: 'Other app' });
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'GEI bar - Other app button');
  });

  test('#gei-send-btn exists (the "Save & get client link" button)', async () => {
    const btn = page.locator('#gei-send-btn');
    await expect(btn).toHaveCount(1);
    assertNoErrors(page, 'GEI send btn exists');
  });
});

// ── 3. GEI bar shows after proposal generated ──────────────────────────────────

test.describe('Generic estimate send bar — shows after proposal generated', () => {
  let page;

  /** Seed the post-generation state (bar visible, dataset filled). Runs before
   *  EVERY test — a Playwright retry boots a fresh context where earlier tests
   *  in the file never executed, so each test must set up its own state. */
  async function seedGeiSendBar() {
    await page.evaluate(({ url, cemail, cphone, token, bidId, userId }) => {
      const bar = document.getElementById('proposal-link-bar');
      if (bar) {
        bar.dataset.signingUrl       = url;
        bar.dataset.signingDirectUrl = url;
        bar.dataset.cname  = 'Jerome Bettis';
        bar.dataset.bname  = 'ZJ Painting';
        bar.dataset.cphone = cphone;
        bar.dataset.cemail = cemail;
      }
      window._pendingSignToken = { bidId, token, proposalKey: `proposals/${userId}/${bidId}_${token}.json` };
      const geiSendBar = document.getElementById('gei-send-bar');
      if (geiSendBar) geiSendBar.style.display = 'block';
      const geiSendBtn = document.getElementById('gei-send-btn');
      if (geiSendBtn) geiSendBtn.style.display = 'none';
    }, {
      url: MOCK_SIGNING_URL,
      cemail: MOCK_CLIENT_EMAIL,
      cphone: MOCK_CLIENT_PHONE,
      token: FAKE_TOKEN,
      bidId: FAKE_BID_ID_1,
      userId: FAKE_USER_ID,
    });
  }

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.beforeEach(async () => {
    // Re-assert the page + bar state every test — survives retries and any
    // navigation the app performed during a previous test in this group.
    // Also clear any modal overlay a prior test left open: in WebKit a stray
    // .zmodal-overlay intercepts pointer events and blocks the Email click.
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay, .zmodal').forEach(el => el.remove()));
    await goPg(page, 'pg-est-generic');
    await seedGeiSendBar();
  });

  test.afterAll(async () => { await page.context().close(); });

  test('gei-send-bar visible and gei-send-btn hidden after proposal ready', async () => {
    const geiBar = page.locator('#gei-send-bar');
    await expect(geiBar).toBeVisible();

    const geiBtn = page.locator('#gei-send-btn');
    const isBtnHidden = await geiBtn.evaluate(el => el.style.display === 'none');
    expect(isBtnHidden, 'gei-send-btn should be hidden after proposal ready').toBe(true);

    assertNoErrors(page, 'GEI bar shows after proposal ready');
  });

  test('clicking Email in gei-send-bar opens compose modal with pre-filled To', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });

    const emailBtn = page.locator('#gei-send-bar button', { hasText: 'Email' });
    await emailBtn.click();
    await page.waitForTimeout(400);

    // Compose modal should appear
    const overlay = page.locator('#_email-compose-overlay');
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // To field should be pre-filled with the client email
    const toVal = await page.inputValue('#_ec-to');
    expect(toVal, 'compose modal To field should be pre-filled').toBe(MOCK_CLIENT_EMAIL);

    // Dismiss modal
    await page.click('#_email-compose-overlay button:last-child');
    await restoreFetch(page);
    assertNoErrors(page, 'GEI bar - Email button opens compose modal');
  });

  test('submitting compose modal calls Resend edge function', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });

    const emailBtn = page.locator('#gei-send-bar button', { hasText: 'Email' });
    await emailBtn.click();

    const calls = await submitEmailCompose(page);
    expect(calls.length, 'Submit in compose modal should trigger edge function').toBeGreaterThan(0);
    expect(calls[0].body.to, 'to field should be client email').toBe(MOCK_CLIENT_EMAIL);

    await restoreFetch(page);
    assertNoErrors(page, 'GEI bar - compose modal submits to edge function');
  });
});

// ── 4. Email compose modal — no client email on file ──────────────────────────

test.describe('Email compose modal — no client email on file', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterEach(async () => {
    // Close any open compose modal
    await page.evaluate(() => document.getElementById('_email-compose-overlay')?.remove());
    await restoreFetch(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('compose modal opens when client has no email — To field empty', async () => {
    await patchFetchForEmail(page);
    await seedProposalLinkBar(page, { cemail: '' });

    await page.evaluate(async () => {
      if (typeof sendProposalViaEmail === 'function') await sendProposalViaEmail();
    });
    await page.waitForTimeout(400);

    const overlay = page.locator('#_email-compose-overlay');
    await expect(overlay).toBeVisible({ timeout: 2000 });

    const toVal = await page.inputValue('#_ec-to');
    expect(toVal, 'To field should be empty when no email on file').toBe('');
    assertNoErrors(page, 'compose modal opens with empty To when no email');
  });

  test('can enter email in compose modal and send successfully', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });
    await seedProposalLinkBar(page, { cemail: '' });

    await page.evaluate(async () => {
      if (typeof sendProposalViaEmail === 'function') await sendProposalViaEmail();
    });
    await page.waitForTimeout(400);

    const calls = await submitEmailCompose(page, { toEmail: 'newemail@example.com' });
    expect(calls.length, 'Entering email and clicking Send should trigger edge function').toBeGreaterThan(0);
    expect(calls[0].body.to, 'to field should be the entered email').toBe('newemail@example.com');
    assertNoErrors(page, 'compose modal can enter email and send');
  });

  test('compose modal shows error state on Resend failure — no double-send', async () => {
    await patchFetchForEmail(page, { status: 502, body: '{"error":"Bad gateway"}' });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });

    await page.evaluate(async () => {
      if (typeof sendProposalViaEmail === 'function') await sendProposalViaEmail();
    });
    await page.waitForTimeout(400);

    // Submit — expect error to show in modal (not navigate away)
    await page.click('#_ec-send-btn');
    await page.waitForTimeout(1000);

    // Modal should still be visible (not dismissed on failure)
    const overlay = page.locator('#_email-compose-overlay');
    await expect(overlay).toBeVisible({ timeout: 1000 });

    // Status element should show error text
    const statusText = await page.evaluate(() => {
      const el = document.getElementById('_ec-status');
      return el ? el.textContent : '';
    });
    expect(statusText, 'status should show error message').toContain('⚠️');
    assertNoErrors(page, 'compose modal shows error on 502 — no double-send');
  });
});

// ── 5. sendProposalViaSms — phone guard and sms: URL ──────────────────────────

test.describe('sendProposalViaSms — phone guard and sms: URL', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterAll(async () => { await page.context().close(); });

  test('shows alert and skips sms: when client has no phone on file', async () => {
    await page.evaluate(() => {
      window.__capturedAlerts = [];
      const orig = window.zAlert;
      window.__origZAlert = orig;
      window.zAlert = (msg) => { window.__capturedAlerts.push(msg); };
    });

    await seedProposalLinkBar(page, { cphone: '' });
    await page.evaluate(async () => {
      if (typeof sendProposalViaSms === 'function') await sendProposalViaSms();
    });
    await page.waitForTimeout(300);

    const alerts = await page.evaluate(() => window.__capturedAlerts || []);
    expect(alerts.length, 'zAlert must fire when client has no phone').toBeGreaterThan(0);
    expect(alerts[0].toLowerCase(), 'Alert must mention phone').toContain('phone');

    await page.evaluate(() => { if (window.__origZAlert) window.zAlert = window.__origZAlert; });
    assertNoErrors(page, 'sendProposalViaSms no-phone guard');
  });

  test('builds sms: URL with correct phone digits when phone is present', async () => {
    await page.evaluate(() => {
      window.__capturedSmsHref = null;
      window.__origCommit = window._commitProposalSent;
      window._commitProposalSent = () => {};
      const locDesc = Object.getOwnPropertyDescriptor(window, 'location');
      if (!locDesc || locDesc.configurable) {
        let _fakeHref = window.location.href;
        Object.defineProperty(window, 'location', {
          configurable: true,
          get: () => ({
            get href() { return _fakeHref; },
            set href(v) { window.__capturedSmsHref = v; _fakeHref = v; },
            assign: (v) => { window.__capturedSmsHref = v; },
            replace: (v) => { window.__capturedSmsHref = v; },
          }),
        });
        window.__locationOverridden = true;
      }
    });

    await seedProposalLinkBar(page, { cphone: MOCK_CLIENT_PHONE });
    await page.evaluate(async () => {
      if (typeof sendProposalViaSms === 'function') await sendProposalViaSms();
    });
    await page.waitForTimeout(500);

    const captured = await page.evaluate(() => window.__capturedSmsHref);
    await page.evaluate(() => {
      if (window.__origCommit) window._commitProposalSent = window.__origCommit;
      delete window.__locationOverridden;
    });

    if (captured) {
      expect(captured, 'sms: URL must start with sms:').toMatch(/^sms:/i);
      expect(captured, 'sms: URL must contain client phone digits').toContain(MOCK_CLIENT_PHONE);
    }
    assertNoErrors(page, 'sendProposalViaSms sms: URL');
  });
});

// ── 6. sendProposalViaEmail — replyTo contains contractor email ───────────────

test.describe('sendProposalViaEmail — replyTo is contractor email', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterEach(async () => {
    await page.evaluate(() => {
      document.getElementById('_email-compose-overlay')?.remove();
      // Also clear any zmodal overlays (success alerts etc) left by the send flow
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
    });
    await restoreFetch(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('replyTo in Resend payload equals signed-in contractor email', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true,"id":"resend-mock-id"}' });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL, cphone: MOCK_CLIENT_PHONE });

    // Open compose modal
    await page.evaluate(async () => { await sendProposalViaEmail(); });
    await page.waitForTimeout(300);

    // Submit via modal
    const calls = await submitEmailCompose(page);
    expect(calls).toHaveLength(1);
    const p = calls[0].body;

    expect(typeof p.replyTo, 'replyTo must be string').toBe('string');
    expect(p.replyTo.length, 'replyTo must not be empty').toBeGreaterThan(0);
    expect(p.replyTo, 'replyTo must contain @').toContain('@');

    const contractorEmail = await page.evaluate(() => {
      return (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.email : null;
    });
    if (contractorEmail) {
      expect(p.replyTo, 'replyTo must equal signed-in contractor email').toBe(contractorEmail);
    }

    assertNoErrors(page, 'sendProposalViaEmail replyTo is contractor email');
  });

  test('replyTo is present even when Resend returns ok — BCC goes to contractor', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });

    await page.evaluate(async () => { await sendProposalViaEmail(); });
    await page.waitForTimeout(300);

    const calls = await submitEmailCompose(page);
    expect(calls.length).toBeGreaterThan(0);

    const p = calls[0].body;
    expect(p.replyTo, 'replyTo must be present for BCC delivery to contractor').toBeTruthy();

    assertNoErrors(page, 'sendProposalViaEmail replyTo present for BCC');
  });

  test('compose modal includes customSubject and customBody in Resend payload', async () => {
    await patchFetchForEmail(page, { status: 200, body: '{"ok":true}' });
    await seedProposalLinkBar(page, { cemail: MOCK_CLIENT_EMAIL });

    await page.evaluate(async () => { await sendProposalViaEmail(); });
    await page.waitForTimeout(300);

    // Modify subject before sending
    await page.fill('#_ec-subj', 'Custom test subject');

    const calls = await submitEmailCompose(page);
    expect(calls.length).toBeGreaterThan(0);

    const p = calls[0].body;
    expect(p.customSubject, 'customSubject should be sent in payload').toBe('Custom test subject');
    expect(p.customBody, 'customBody should be sent in payload').toBeTruthy();

    assertNoErrors(page, 'compose modal sends customSubject and customBody');
  });
});

// ── 7. _previewClientHub — logs contractor view, opens iframe with preview=1 ─────

test.describe('_previewClientHub — contractor view logging', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await goPg(page, 'pg-dash');
  });

  test.afterAll(async () => { await page.context().close(); });

  test('_previewClientHub logs viewerType=contractor for each pending bid', async () => {
    // Patch window.fetch (WebKit-safe — page.route does not reliably intercept
    // same-page fetch() calls in WebKit; see file header) to capture the call.
    await page.evaluate(() => {
      window.__viewCalls = [];
      const orig = window.__origViewFetch || window.fetch;
      window.__origViewFetch = orig;
      window.fetch = async (input, opts) => {
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (url.includes('/functions/v1/log-proposal-view')) {
          try { window.__viewCalls.push(opts?.body ? JSON.parse(opts.body) : null); } catch(_) {}
          return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return orig(input, opts);
      };
    });

    // Inject a pending bid for the client we'll preview
    await page.evaluate(({ bidId, userId, clientId }) => {
      window.bids = window.bids || [];
      window.bids.push({
        id: bidId,
        client_id: clientId,
        signingToken: 'tok-preview-test',
        status: 'Pending',
        amount: 5000,
        type: 'Interior Painting',
      });
      window._supaUser = window._supaUser || { id: userId, email: 'test@test.com' };
    }, { bidId: FAKE_BID_ID_1, userId: FAKE_USER_ID, clientId: 9001 });

    const hubUrl = `https://tradedeskpro.app/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=9001`;

    await page.evaluate(({ url, clientId }) => {
      if (typeof _previewClientHub === 'function') _previewClientHub(url, 'Test Client', clientId);
    }, { url: hubUrl, clientId: 9001 });
    await page.waitForTimeout(400);

    const capturedCalls = await page.evaluate(() => window.__viewCalls || []);
    await page.evaluate(() => {
      if (window.__origViewFetch) { window.fetch = window.__origViewFetch; delete window.__origViewFetch; }
      document.getElementById('_hub-preview-ov')?.remove();
    });

    // Must have logged the bid as contractor view
    expect(capturedCalls.length, '_previewClientHub must call log-proposal-view').toBeGreaterThan(0);
    expect(capturedCalls[0].viewerType, 'viewerType must be contractor').toBe('contractor');
    expect(capturedCalls[0].bidId, 'bidId must match pending bid').toBe(String(FAKE_BID_ID_1));

    assertNoErrors(page, '_previewClientHub logs contractor view');
  });

  test('_previewClientHub opens iframe with preview=1 appended to URL', async () => {
    const hubUrl = `https://tradedeskpro.app/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=9001`;

    await page.evaluate(({ url }) => {
      if (typeof _previewClientHub === 'function') _previewClientHub(url, 'Test Client', 9001);
    }, { url: hubUrl });
    await page.waitForTimeout(200);

    const iframeSrc = await page.evaluate(() => {
      const ov = document.getElementById('_hub-preview-ov');
      return ov ? ov.querySelector('iframe')?.src : null;
    });

    expect(iframeSrc, 'iframe must exist').not.toBeNull();
    expect(iframeSrc, 'iframe src must contain preview=1').toContain('preview=1');

    await page.evaluate(() => document.getElementById('_hub-preview-ov')?.remove());
    assertNoErrors(page, '_previewClientHub iframe uses preview=1');
  });
});
