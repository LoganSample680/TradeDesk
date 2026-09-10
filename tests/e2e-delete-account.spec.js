// @ts-check
// ── Deleting your account, for real ─────────────────────────────────────────
//
// App Review Guideline 5.1.1(v): "If your app supports account creation, you
// must also offer account deletion within the app." Factory reset empties the
// records and leaves the login standing, which is a different thing and is one
// of the most consistently enforced rules in review.
//
// The rules these tests hold:
//   * It is reachable, in the danger zone, from Settings.
//   * A crew member is told the truth that applies to THEM: their hours stay
//     in the employer's payroll with the name removed, because those are the
//     employer's books, and they are not told they will vanish.
//   * Nothing is destroyed without the word typed by hand.
//   * The device keeps nothing: caches and offline queues go with the account,
//     or a reload restores a snapshot of something that no longer exists.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

test.describe('delete account', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  const arm = (opts) => page.evaluate((o) => {
    window._isEmployee = !!o.crew;
    window._supaUser = o.signedOut ? null : { id: 'me-uid' };
    window.__calls = [];
    window.__alerts = [];
    window.zAlert = (m, x) => window.__alerts.push({ m, t: x && x.title });
    window._SUPA_DIRECT_URL = 'https://x.supabase.co';
    window._supa = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'tok-abc' } } }),
        signOut: async () => { window.__calls.push('signOut'); },
      },
    };
    window.fetch = async (url, init) => {
      window.__calls.push({ url: String(url), auth: init && init.headers && init.headers.Authorization });
      return { ok: !o.fail, json: async () => (o.fail ? { error: 'nope' } : { ok: true, kind: o.crew ? 'crew' : 'owner' }) };
    };
    localStorage.setItem('zp3_cloud_cache', '{"a":1}');
    localStorage.setItem('td_geo_park', '{"b":2}');
    localStorage.setItem('geo_owner_consent', '1');
    localStorage.setItem('keep_me', 'yes');
  }, opts || {});

  test('the control exists in the danger zone, in the shipped markup', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const i = html.indexOf('Danger zone');
    expect(i, 'the danger zone is where a destructive control belongs').toBeGreaterThan(-1);
    const zone = html.slice(i, i + 2500);
    expect(zone).toMatch(/deleteMyAccount\(\)/);
    expect(zone, 'and it says what it is in words a person uses').toMatch(/Delete my account/);
  });

  test('a crew member is told their hours stay with their employer', async () => {
    await arm({ crew: true });
    const copy = await page.evaluate(() => _delAcctCopy());
    expect(copy).toMatch(/unlinks you/i);
    expect(copy, 'the employer keeps their books, and we say so').toMatch(/payroll/i);
    expect(copy).toMatch(/name removed/i);
    expect(copy, 'a crew member does not own the business, so we never promise that')
      .not.toMatch(/clients, proposals/i);
  });

  test('an owner is told the business goes, and the crew keep their logins', async () => {
    await arm({ crew: false });
    const copy = await page.evaluate(() => _delAcctCopy());
    expect(copy).toMatch(/clients, proposals/i);
    expect(copy).toMatch(/cannot be undone/i);
    expect(copy, 'deleting an employer must never read as deleting employees')
      .toMatch(/keeps their own login/i);
  });

  test('the wrong word deletes nothing at all', async () => {
    await arm({});
    const r = await page.evaluate(async () => {
      window.zConfirm = (_m, yes) => yes();
      window.zPrompt = (_m, ok) => ok('delete my stuff');
      await deleteMyAccount();
      return { calls: window.__calls.length, alerts: window.__alerts.map(a => a.t) };
    });
    expect(r.calls, 'nothing was asked of the server').toBe(0);
    expect(r.alerts).toContain('Cancelled');
  });

  test('the right word calls the function with the session token', async () => {
    await arm({});
    const r = await page.evaluate(async () => {
      window.zConfirm = (_m, yes) => yes();
      window.zPrompt = (_m, ok) => ok('delete');       // case-insensitive on purpose
      await deleteMyAccount();
      return window.__calls;
    });
    const call = r.find(c => c && c.url);
    expect(call.url, 'the one endpoint that can do this').toMatch(/\/functions\/v1\/delete-account$/);
    expect(call.auth, 'the uid comes from the verified token, never from us').toBe('Bearer tok-abc');
    expect(r, 'and the session is dropped on the way out').toContain('signOut');
  });

  test('the device keeps nothing of the account, but nothing else is touched', async () => {
    await arm({});
    const left = await page.evaluate(async () => {
      window.zConfirm = (_m, yes) => yes();
      window.zPrompt = (_m, ok) => ok('DELETE');
      await deleteMyAccount();
      return {
        cache: localStorage.getItem('zp3_cloud_cache'),
        park: localStorage.getItem('td_geo_park'),
        consent: localStorage.getItem('geo_owner_consent'),
        other: localStorage.getItem('keep_me'),
      };
    });
    expect(left.cache, 'a reload must not restore an account that is gone').toBe(null);
    expect(left.park).toBe(null);
    expect(left.consent).toBe(null);
    expect(left.other, 'and nothing outside the account is collateral').toBe('yes');
  });

  test('a failure says so and leaves you signed in to try again', async () => {
    await arm({ fail: true });
    const r = await page.evaluate(async () => {
      window.zConfirm = (_m, yes) => yes();
      window.zPrompt = (_m, ok) => ok('DELETE');
      await deleteMyAccount();
      return { alerts: window.__alerts.map(a => a.t), calls: window.__calls,
               cache: localStorage.getItem('zp3_cloud_cache') };
    });
    expect(r.alerts).toContain('Not deleted');
    expect(r.calls, 'a failed delete must not sign you out of a live account').not.toContain('signOut');
    expect(r.cache, 'and must not wipe the device either').not.toBe(null);
  });

  test('signed out, it says there is nothing to delete rather than throwing', async () => {
    await arm({ signedOut: true });
    const r = await page.evaluate(async () => {
      let threw = false;
      try { await deleteMyAccount(); } catch (e) { threw = true; }
      return { threw, alerts: window.__alerts.map(a => a.t), calls: window.__calls.length };
    });
    expect(r.threw).toBe(false);
    expect(r.alerts).toContain('Nothing to delete');
    expect(r.calls).toBe(0);
  });

  test('the function takes its uid from the token and never from the body', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
      'delete-account', 'index.ts'), 'utf8');
    expect(src, 'the verified user is the only source of identity').toMatch(/auth\.getUser\(token\)/);
    expect(src.includes('req.json()'), 'reading a uid from the body would let anyone delete anyone').toBe(false);
    // Every delete is keyed. A bare .delete() with no filter in this file would
    // be catastrophic, so it is asserted against by shape.
    const bare = src.match(/\.delete\(\)(?!\s*\.eq)/g) || [];
    expect(bare.length, 'no unfiltered delete may exist here').toBe(0);
    // The login goes last: everything above is retryable while it still works.
    expect(src.indexOf('deleteUser')).toBeGreaterThan(src.indexOf('OWNED'));
  });

  test('a crew deletion never reaches into the employer books', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
      'delete-account', 'index.ts'), 'utf8');
    const crew = src.slice(src.indexOf('if (isCrew)'), src.indexOf('} else {'));
    expect(crew, 'the hours are updated, never deleted').toMatch(/update\(\{ employee_name: null \}\)/);
    expect(crew.includes('td_clients'), 'business records are not a crew member\'s to delete').toBe(false);
    expect(crew.includes('zj_data')).toBe(false);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
