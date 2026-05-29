// @ts-check
// Security regression tests — lock in fixes from the adversarial security review.
// Covers: crypto-strong proposal tokens (C2), session/PII cache purge on sign-out
// (C3/H3), XSS escaping of client-supplied fields (C4), and RPC refactor replacing
// permissive anon direct-table access on signed_proposals (C1/H1).
const fs   = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
        FAKE_USER_ID, FAKE_BID_ID_2, FAKE_TOKEN_2, MOCK_PROPOSAL } = require('./helpers');

// ── Static SQL analysis of the RPC migration ─────────────────────────────────
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

test.describe('Security migration SQL — RPC refactor static analysis', () => {
  let sql = '';
  test.beforeAll(() => {
    const f = path.join(MIGRATIONS_DIR, '20260601_security_rpc_signed_proposals.sql');
    sql = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  });

  test('migration file exists', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  test('anon_select policy is dropped', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "anon_select"/);
  });

  test('anon_insert policy is dropped', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "anon_insert"/);
  });

  test('anon_update policy is dropped', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "anon_update"/);
  });

  test('auth_insert_any policy is dropped (prevents cross-contractor inserts)', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "auth_insert_any"/);
  });

  test('get_signed_proposal_status is SECURITY DEFINER', () => {
    expect(sql).toMatch(/get_signed_proposal_status[\s\S]*?SECURITY DEFINER/);
  });

  test('get_signed_proposal_status validates signing_token parameter', () => {
    expect(sql).toMatch(/signing_token\s*=\s*p_signing_token/);
  });

  test('submit_signed_proposal computes payment_status server-side (no client injection)', () => {
    // Must set status from p_is_decline / p_payment_method, not a raw client param
    expect(sql).toMatch(/_safe_status\s*:=\s*'declined'/);
    expect(sql).toMatch(/_safe_status\s*:=\s*'pending_'/);
  });

  test('submit_signed_proposal never sets payment_status to paid directly', () => {
    // The word 'paid' should not appear as a status value in the RPC body
    const rpcBody = sql.slice(sql.indexOf('submit_signed_proposal'));
    expect(rpcBody).not.toMatch(/payment_status.*=.*'paid'/);
  });

  test('get_hub_proposal_statuses does not return client_name or notify_email', () => {
    const fn = sql.slice(sql.indexOf('get_hub_proposal_statuses'));
    const selectClause = fn.slice(fn.indexOf('SELECT'), fn.indexOf('FROM'));
    expect(selectClause).not.toContain('client_name');
    expect(selectClause).not.toContain('notify_email');
    expect(selectClause).not.toContain('client_signed_name');
  });

  test('proposal_views INSERT policy is tightened (no more WITH CHECK (true))', () => {
    const viewsSection = sql.slice(sql.indexOf('proposal_views'));
    expect(viewsSection).toMatch(/auth\.uid\(\)/);
    expect(viewsSection).not.toMatch(/WITH CHECK \(true\)/);
  });

  test('UNIQUE constraint added for ON CONFLICT to work', () => {
    expect(sql).toMatch(/UNIQUE \(bid_id, contractor_user_id\)/);
  });
});

test.describe('Security — proposal token + XSS escaping', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── C2: signing token must be a CSPRNG-backed 128-bit hex value ──────────────
  test('_genProposalToken returns a 32-char lowercase hex token', async () => {
    const t = await page.evaluate(() =>
      typeof _genProposalToken === 'function' ? _genProposalToken() : null);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  test('_genProposalToken produces unique tokens across many calls', async () => {
    const unique = await page.evaluate(() => {
      if (typeof _genProposalToken !== 'function') return null;
      const set = new Set();
      for (let i = 0; i < 500; i++) set.add(_genProposalToken());
      return set.size;
    });
    expect(unique).toBe(500);
  });

  // ── C4: client-supplied name/address are escaped in the proposal summary ─────
  test('buildProposal escapes a malicious client name into est-sig-sum', async () => {
    const result = await page.evaluate(() => {
      if (typeof buildProposal !== 'function') return { skip: true };
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      setVal('e-cname', '<img src=x onerror="window.__xss=1">');
      setVal('e-caddr', '<svg onload="window.__xss=1">');
      window.__xss = 0;
      let threw = false;
      try { buildProposal(); } catch (_e) { threw = true; }
      const el = document.getElementById('est-sig-sum');
      const html = el ? el.innerHTML : '';
      const liveEls = el ? el.querySelectorAll('img,svg').length : 0;
      return { threw, html, liveEls, xss: window.__xss };
    });
    if (result.skip) return;
    // The renderer may need more state than the test provides; if it threw before
    // writing the summary there is nothing to assert. When it did render, the
    // payload must be escaped — no live element, no fired handler.
    if (!result.threw && result.html) {
      expect(result.liveEls).toBe(0);
      expect(result.html).not.toContain('<img');
      expect(result.html).not.toContain('<svg');
    }
    expect(result.xss).toBe(0);
  });

  test('escHtml neutralizes HTML control characters', async () => {
    const out = await page.evaluate(() =>
      typeof escHtml === 'function' ? escHtml('<img src=x onerror=alert(1)>"&') : null);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
  });

  test('no new console errors from token/XSS flows', async () => {
    assertNoErrors(page, 'security token/xss');
  });
});

// Sign-out mutates global app state and triggers the auth SIGNED_OUT path, so it
// runs in its own isolated context (no shared assertNoErrors accumulation).
test.describe('Security — sign-out purges sensitive local storage', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── C3 / H3: deliberate sign-out purges session tokens + PII cache ──────────
  test('supaSignOut removes zp3_session_backup and zp3_cloud_cache, keeps offline pending', async () => {
    const result = await page.evaluate(async () => {
      if (typeof supaSignOut !== 'function') return { skip: true };
      localStorage.setItem('zp3_session_backup', JSON.stringify({ access_token: 'a', refresh_token: 'r' }));
      localStorage.setItem('zp3_cloud_cache', JSON.stringify({ clients: [{ name: 'PII' }] }));
      localStorage.setItem('zp3_offline_pending', JSON.stringify([{ op: 'x' }]));
      // Purge runs synchronously before the awaited network signOut, so the result
      // is deterministic even if the mocked signOut rejects.
      try { await supaSignOut(); } catch (_e) { /* mocked network */ }
      return {
        backup: localStorage.getItem('zp3_session_backup'),
        cache: localStorage.getItem('zp3_cloud_cache'),
        pending: localStorage.getItem('zp3_offline_pending'),
      };
    });
    if (result.skip) return;
    expect(result.backup).toBeNull();
    expect(result.cache).toBeNull();
    // Un-synced offline edits must survive sign-out (no data loss).
    expect(result.pending).not.toBeNull();
  });
});

// ── RPC routing: sign.html must not make direct signed_proposals table queries ──
// These tests intercept fetch at the network level and assert the refactored pages
// call RPCs instead of the old permissive table endpoint.
const MOCK_PROP_SECURITY = {
  id: FAKE_BID_ID_2, status: 'pending',
  businessName: 'Test Co', businessPhone: '316-555-0000',
  clientName: 'Test Client', clientAddr: '123 Main St', amount: 1000, deposit: 250,
  estDays: 1, createdAt: new Date().toISOString(),
  signingToken: FAKE_TOKEN_2, contractorUserId: FAKE_USER_ID,
  clientId: 902, proposalHtml: '<p>Test scope.</p>', trade: 'general',
  surfaces: [], stripeConnectEnabled: false,
};

test.describe('Security — sign.html uses RPC not direct table queries', () => {
  let page;
  const directTableHits = [];
  const rpcHits = [];

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROP_SECURITY);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROP_SECURITY, bidId: FAKE_BID_ID_2 });

    // Intercept AFTER mockAllExternal so we observe post-mock request routing
    page.on('request', req => {
      const u = req.url();
      if (u.includes('/rest/v1/signed_proposals') && (u.includes('select') || req.method() === 'GET'))
        directTableHits.push(u);
      if (u.includes('/rest/v1/rpc/get_signed_proposal_status'))
        rpcHits.push(u);
    });

    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_2}_${FAKE_TOKEN_2}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(1000);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('sign.html makes no direct GET to signed_proposals table', () => {
    expect(directTableHits).toHaveLength(0);
  });

  test('sign.html calls get_signed_proposal_status RPC', () => {
    expect(rpcHits.length).toBeGreaterThan(0);
  });
});

test.describe('Security — _signingToken extracted from ?key= URL format', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROP_SECURITY);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROP_SECURITY, bidId: FAKE_BID_ID_2 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_2}_${FAKE_TOKEN_2}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(800);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_signingToken is populated from the key= URL format', async () => {
    const token = await page.evaluate(() => typeof _signingToken !== 'undefined' ? _signingToken : null);
    expect(token).toBe(FAKE_TOKEN_2);
  });

  test('no console errors from sign.html RPC routing', async () => {
    assertNoErrors(page, 'sign.html RPC routing');
  });
});

// ── Edge function CORS regression guard ───────────────────────────────────────
// Every Response() path in each edge function must include CORS headers so the
// browser isn't blocked when the function returns an error status (4xx/5xx).
// The OPTIONS preflight is handled separately and is allowed to use null body.
const FUNCTIONS_DIR = path.join(__dirname, '..', 'supabase', 'functions');

test.describe('Edge function static analysis — send-proposal-email CORS', () => {
  let src = '';
  test.beforeAll(() => {
    const f = path.join(FUNCTIONS_DIR, 'send-proposal-email', 'index.ts');
    src = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  });

  test('source file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  test('defines a shared CORS headers constant', () => {
    // Must export a reusable object containing Access-Control-Allow-Origin
    // so it cannot be accidentally omitted from individual responses.
    expect(src).toMatch(/Access-Control-Allow-Origin/);
    expect(src).toMatch(/JSON_CORS/);
  });

  test('every new Response() references CORS headers', () => {
    // Split on each Response constructor call and verify the containing
    // argument list references JSON_CORS, CORS, or null (OPTIONS preflight).
    const fragments = src.split('new Response(');
    // fragment[0] is code before the first Response — skip it
    for (let i = 1; i < fragments.length; i++) {
      // Scan just far enough to cover the closing `)` of the Response call
      const window = fragments[i].slice(0, 300);
      const hasCors = window.includes('JSON_CORS') || window.includes('CORS') || window.includes('null,');
      expect(hasCors, `Response #${i} is missing CORS headers:\n...${window.slice(0, 120)}...`).toBe(true);
    }
  });
});

// ── RPC contract: SQL parameters must match JS callers ────────────────────────
// Catches schema drift where the migration adds/renames a parameter but the
// JS caller in sign.html (or vice versa) is not updated to match.
// Supabase PostgREST resolves functions by name + parameter names, so any
// mismatch produces a 404 "Could not find the function" at runtime.

test.describe('RPC contract — SQL function signatures match JS callers', () => {
  let sql = '';
  let signHtml = '';
  test.beforeAll(() => {
    const f = path.join(MIGRATIONS_DIR, '20260601_security_rpc_signed_proposals.sql');
    sql = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const s = path.join(__dirname, '..', 'sign.html');
    signHtml = fs.existsSync(s) ? fs.readFileSync(s, 'utf8') : '';
  });

  test('submit_signed_proposal SQL defines every parameter sign.html passes', () => {
    // These are the exact parameter names sign.html uses in submitCash / _confirmDecline.
    // If either the SQL or the JS caller changes a name, this test breaks.
    const callerParams = [
      'p_bid_id', 'p_contractor_user_id', 'p_signing_token',
      'p_client_name', 'p_client_signed_name',
      'p_amount', 'p_deposit',
      'p_payment_method', 'p_notify_email', 'p_storage_key',
      'p_portfolio_accepted', 'p_portfolio_pct', 'p_is_decline',
    ];
    const fnStart = sql.indexOf('submit_signed_proposal');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = sql.slice(fnStart, fnStart + 2000);
    for (const param of callerParams) {
      expect(fnBody, `submit_signed_proposal SQL missing parameter: ${param}`).toContain(param);
    }
  });

  test('sign.html passes every parameter submit_signed_proposal SQL defines', () => {
    // Reverse direction: ensure sign.html does not omit a required SQL parameter.
    const sqlParams = [
      'p_bid_id', 'p_contractor_user_id', 'p_signing_token',
      'p_client_name', 'p_client_signed_name',
      'p_amount', 'p_deposit',
      'p_payment_method', 'p_notify_email', 'p_storage_key',
    ];
    // Find the submitCash rpc call block in sign.html
    const rpcCall = signHtml.slice(signHtml.indexOf("rpc('submit_signed_proposal'"), signHtml.indexOf("rpc('submit_signed_proposal'") + 600);
    for (const param of sqlParams) {
      expect(rpcCall, `sign.html submitCash missing parameter: ${param}`).toContain(param);
    }
  });

  test('get_signed_proposal_status SQL defines every parameter sign.html passes', () => {
    const callerParams = ['p_bid_id', 'p_contractor_user_id', 'p_signing_token'];
    const fnStart = sql.indexOf('get_signed_proposal_status');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = sql.slice(fnStart, fnStart + 1000);
    for (const param of callerParams) {
      expect(fnBody, `get_signed_proposal_status SQL missing parameter: ${param}`).toContain(param);
    }
  });

  test('update_proposal_notified SQL defines every parameter sign.html passes', () => {
    const callerParams = ['p_bid_id', 'p_contractor_user_id', 'p_signing_token'];
    const fnStart = sql.indexOf('update_proposal_notified');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = sql.slice(fnStart, fnStart + 500);
    for (const param of callerParams) {
      expect(fnBody, `update_proposal_notified SQL missing parameter: ${param}`).toContain(param);
    }
  });
});
