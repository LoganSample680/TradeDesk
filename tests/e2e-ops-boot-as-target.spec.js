// @ts-check
// ── A support view boots AS the target, or it shows nothing ──
//
// The incident this suite exists for (2026-09-12): the owner opened three
// customer accounts and saw HIS OWN on-site card and timesheet inside them. The
// account rows were theirs; everything the rows do not carry stayed his, because
// the frame booted his session first and swapped data in afterwards. Nothing was
// written to the customers' data, but a support view you cannot trust is worse
// than none.
//
// The fix is structural, so the tests are too. What is pinned:
//   1. ?ops=1 is decided on the first line of the page: the read-only lock is on
//      before any script runs, and every zp3_* key this device holds is invisible
//      for the life of the page.
//   2. The app loads the TARGET's identity, so _account, getBusinessName() and
//      _contractorUserId are theirs, not the viewer's.
//   3. THE BLEED TEST: nothing the viewer's device remembers can appear. Seeded
//      markers in every zp3_* key the old path leaked through must be unreadable.
//   4. A view that cannot load refuses, and never falls through to the viewer's
//      own app wearing somebody else's name.
const { test, expect, mockAllExternal, assertNoErrors } = require('./helpers');

const TARGET = '11111111-1111-1111-1111-111111111111';
const PERSON = '22222222-2222-2222-2222-222222222222';
const ROSTER = [{
  contractor_user_id: TARGET, business: "Jack's Plumbing", trade: 'plumbing', trade_lines: null,
  person_user_id: PERSON, person_name: 'Jack Rivera', person_email: 'jack@x.com',
  role: 'crew', permissions: { estimate: true }, active: true
}];

// Everything of the viewer's the old path leaked through, seeded before boot.
const MINE = {
  zp3_cloud_cache: JSON.stringify({ _owner: 'me', bids: [{ id: 1, client: 'MY_OWN_CLIENT' }] }),
  zp3_offline_pending: JSON.stringify({ ops: ['MY_OWN_PENDING'] }),
  zp3_geo_open: JSON.stringify({ job: 'MY_OWN_ONSITE_JOB', arrivedAt: '2026-09-12T14:00:00Z' }),
  zp3_clock: JSON.stringify({ startedAt: '2026-09-12T13:00:00Z', label: 'MY_OWN_CLOCK' }),
  zp3_rcpt_imgs: JSON.stringify({ 1: 'MY_OWN_RECEIPT' }),
  zp3_maint: JSON.stringify([{ id: 1, note: 'MY_OWN_MAINT' }]),
};
const MARKERS = ['MY_OWN_CLIENT', 'MY_OWN_PENDING', 'MY_OWN_ONSITE_JOB', 'MY_OWN_CLOCK', 'MY_OWN_RECEIPT', 'MY_OWN_MAINT'];

function seed(page, { roster = ROSTER } = {}) {
  return page.addInitScript(({ roster, MINE, TARGET }) => {
    // The viewer's device, as it would really be: full of his own state.
    try { Object.entries(MINE).forEach(([k, v]) => window.localStorage.setItem(k, v)); } catch (e) {}
    let held;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return held; },
      set(v) {
        held = { createClient: (u, k, o) => {
          const c = v.createClient(u, k, o);
          const realFrom = c.from.bind(c);
          c.rpc = (fn) => {
            if (fn === 'ops_view_roster') return Promise.resolve({ data: roster, error: null });
            if (fn === 'ops_view_open') return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: null, error: null });
          };
          c.from = (t) => {
            if (t === 'accounts') {
              const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: { id: 'a1', business_name: "Jack's Plumbing", owner_id: TARGET }, error: null }), then: (f) => Promise.resolve({ data: [], error: null }).then(f) };
              return q;
            }
            return realFrom(t);
          };
          return c;
        } };
      }
    });
  }, { roster, MINE, TARGET });
}

test.describe('A support view boots as the target', () => {

  test('the lock and the cache veil are on before any script runs', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await seed(page);
    await page.goto(`/?ops=1&t=${TARGET}&p=${PERSON}`, { waitUntil: 'domcontentloaded' });

    const r = await page.evaluate(() => ({
      boot: window._OPS_BOOT,
      readOnly: typeof opsReadOnly === 'function' ? opsReadOnly() : null,
      // Seeded before boot, invisible now.
      cache: localStorage.getItem('zp3_cloud_cache'),
      clock: localStorage.getItem('zp3_clock'),
      onsite: localStorage.getItem('zp3_geo_open'),
      // A write of ours goes nowhere either.
      writeBack: (() => { try { localStorage.setItem('zp3_probe', 'x'); } catch (e) {} return localStorage.getItem('zp3_probe'); })(),
      // Auth storage is untouched, or the ops admin would be signed out.
      authKeyReadable: (() => { try { localStorage.setItem('sb-probe', 'ok'); return localStorage.getItem('sb-probe'); } catch (e) { return null; } })()
    }));
    expect(r.boot).toEqual({ target: TARGET, person: PERSON });
    expect(r.readOnly).toBe(true);
    expect(r.cache).toBe(null);
    expect(r.clock).toBe(null);
    expect(r.onsite).toBe(null);
    expect(r.writeBack).toBe(null);
    expect(r.authKeyReadable).toBe('ok');
    await ctx.close();
  });

  test('the identity the app loads is theirs, not the viewer\'s', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await seed(page);
    await page.goto(`/?ops=1&t=${TARGET}&p=${PERSON}`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => typeof _supa !== 'undefined' && _supa && _supaUser, null, { timeout: 15000 });
    const r = await page.evaluate(async () => {
      const ok = await _opsLoadIdentity();
      return {
        ok,
        contractor: typeof _contractorUserId !== 'undefined' ? _contractorUserId : null,
        isEmployee: typeof _isEmployee !== 'undefined' ? _isEmployee : null,
        business: typeof getBusinessName === 'function' ? getBusinessName() : null,
        account: typeof _account !== 'undefined' && _account ? _account.business_name : null,
        view: window._opsView && { target: window._opsView.target, person: window._opsView.personUid, role: window._opsView.role },
        // The permission mask is the person's, so a crew view hides what they cannot see.
        canSeeFinancials: typeof _canSeeFinancials === 'function' ? _canSeeFinancials() : null,
        readOnly: opsReadOnly()
      };
    });
    expect(r.ok).toBe(true);
    expect(r.contractor).toBe(TARGET);
    expect(r.isEmployee).toBe(true);
    expect(r.business).toBe("Jack's Plumbing");
    expect(r.account).toBe("Jack's Plumbing");
    expect(r.view).toEqual({ target: TARGET, person: PERSON, role: 'crew' });
    expect(r.canSeeFinancials).toBe(false);     // crew, and the mask is theirs
    expect(r.readOnly).toBe(true);
    await ctx.close();
  });

  test('nothing the viewer\'s device remembers can appear inside the view', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await seed(page);
    await page.goto(`/?ops=1&t=${TARGET}&p=${PERSON}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _supa !== 'undefined' && _supa && _supaUser, null, { timeout: 15000 });
    await page.evaluate(() => _opsLoadIdentity());
    await page.waitForTimeout(600);

    // The bleed test. Every marker was in this device's storage before boot; not
    // one of them may reach the page, in any screen, in any form.
    const found = await page.evaluate((markers) => {
      const html = document.documentElement.innerHTML;
      const hits = markers.filter(m => html.includes(m));
      const inMemory = markers.filter(m => {
        try { return JSON.stringify({ bids, clients, jobs, mileage, timeEntries, expenses, S }).includes(m); }
        catch (e) { return false; }
      });
      return { hits, inMemory };
    }, MARKERS);
    expect(found.hits).toEqual([]);
    expect(found.inMemory).toEqual([]);
    await ctx.close();
  });

  test('a view it cannot load refuses, and never shows the viewer\'s own app', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await seed(page, { roster: [] });          // not on the allowlist, or the account is gone
    await page.goto(`/?ops=1&t=${TARGET}&p=${PERSON}`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => typeof _supa !== 'undefined' && _supa && _supaUser, null, { timeout: 15000 });
    await page.waitForFunction(() => typeof _supa !== 'undefined' && _supa && _supaUser, null, { timeout: 15000 });
    const r = await page.evaluate(async () => {
      const ok = await _opsLoadIdentity();
      const cover = document.getElementById('ops-refused');
      // What matters is what a person can SEE and touch, not whether the app
      // finished booting underneath: the refusal covers the viewport, so the
      // element under the middle of the screen is the notice and nothing else.
      const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { ok, covered: !!cover, text: cover ? cover.innerText : '',
               onTop: !!(cover && mid && (mid === cover || cover.contains(mid))),
               view: window._opsView };
    });
    expect(r.ok).toBe(false);
    expect(r.covered).toBe(true);
    expect(r.text).toContain('Support view unavailable');
    expect(r.onTop).toBe(true);
    expect(r.view).toBe(null);
    await ctx.close();
  });

  test('zero console errors', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const page = await ctx.newPage();
    await mockAllExternal(page);
    await seed(page);
    await page.goto(`/?ops=1&t=${TARGET}&p=${PERSON}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _supa !== 'undefined' && _supa && _supaUser, null, { timeout: 15000 });
    await page.evaluate(() => _opsLoadIdentity());
    await page.waitForTimeout(1200);
    assertNoErrors(page, 'ops boot as target');
    await ctx.close();
  });
});
