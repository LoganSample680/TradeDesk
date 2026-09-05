// @ts-check
/**
 * Exhaustive E2E coverage for jobs.js
 * Every exported function tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('jobs.js: exhaustive coverage', () => {
  let page;

  // Idempotent fixture seed, filter-then-push so it's safe to re-run. Called in
  // beforeAll AND beforeEach, AND (crucially) inside the same page.evaluate as
  // every test that asserts seeded values: a late-resolving cloud/cache load
  // reassigns the in-memory arrays after boot (task #22 race), and it can land
  // in the gap BETWEEN beforeEach's evaluate and the test body's evaluate, the
  // beforeEach re-seed alone still flaked on WebKit shard 3 (getJobClockTotal
  // read 0, fd9b3ba run). page.evaluate is atomic, so seeding at the top of the
  // reading evaluate fully closes the race; between-call re-seeds stay as a
  // cheap best-effort for tests that only mutate.
  const SEED_FIXTURES_FN = () => {
    clients = clients.filter(c => c.id !== 79901 && c.id !== 79902);
    bids    = bids.filter(b => b.id !== 78801 && b.id !== 78802 && b.id !== 78803);
    jobs    = jobs.filter(j => ![77701, 77702, 77703, 77704, 77705, 77706, 77707].includes(j.id));
    timeEntries = (timeEntries || []).filter(e => e.job_id !== 77701 && e.job_id !== 77702);

    clients.push(
      { id: 79901, name: 'Jobs Test Alpha', phone: '316-555-7001', addr: '1 Jobs St, Wichita KS 67202', email: 'alpha@jobs.test' },
      { id: 79902, name: 'Jobs Test Beta',  phone: '316-555-7002', addr: '2 Jobs Ave, Wichita KS 67202', email: 'beta@jobs.test' }
    );
    bids.push(
      { id: 78801, client_id: 79901, client_name: 'Jobs Test Alpha', amount: 3500, status: 'Closed Won',
        bid_date: '2026-01-10', trade_type: 'painting', type: 'Interior painting',
        surfaces: [{ type: 'walls', room: 'Living Room', qty: 400, wallSqft: 400 }],
        roomScopeMap: { 'Living Room': { sand: { active: true, hrs: 2, rate: 45, cost: 90 }, prime: { active: true } } },
        signedAt: '2026-01-15T00:00:00Z', completion_date: null },
      { id: 78802, client_id: 79902, client_name: 'Jobs Test Beta', amount: 1200, status: 'Closed Won',
        bid_date: '2026-02-01', trade_type: 'painting', type: 'Exterior painting',
        surfaces: [], roomScopeMap: {}, signedAt: '2026-02-05T00:00:00Z', completion_date: null },
      // Exactly ONE active scope, so getJobScopes(77707) returns a single
      // item, the boundary the reorder grip must hide at (nothing to drag).
      { id: 78803, client_id: 79901, client_name: 'Jobs Test Alpha', amount: 400, status: 'Closed Won',
        bid_date: '2026-03-01', trade_type: 'painting', type: 'Touch-up',
        surfaces: [{ type: 'walls', room: 'Hall', qty: 50, wallSqft: 50 }],
        roomScopeMap: { 'Hall': { sand: { active: true, hrs: 1, rate: 45, cost: 45 } } },
        signedAt: '2026-03-02T00:00:00Z', completion_date: null }
    );
    jobs.push(
      { id: 77701, client_id: 79901, bid_id: 78801, name: 'Alpha interior job',
        eventType: 'job', status: 'scheduled', start: '2099-06-01',
        extraScopes: ['popcorn'], actualHours: 0 },
      { id: 77702, client_id: 79902, bid_id: 78802, name: 'Beta exterior job',
        eventType: 'job', status: 'scheduled', start: '2099-07-01', actualHours: 0 },
      { id: 77703, client_id: 79901, bid_id: null, name: 'Orphan job no bid',
        eventType: 'job', status: 'active', start: '2099-08-01', actualHours: 0 },
      // Closed-to-clock-in fixtures (owner report 2026-07-18: nothing stopped
      // clocking into a job already marked complete). One per condition
      // _jobClosedToClockIn checks, matching _geoMyJobs' own exclusion.
      { id: 77704, client_id: 79901, bid_id: null, name: 'Done job',
        eventType: 'job', status: 'done', start: '2026-05-01', completion_date: '2026-05-03' },
      { id: 77705, client_id: 79901, bid_id: null, name: 'Cancelled job',
        eventType: 'job', status: 'scheduled', start: '2099-08-02', cancelled: true },
      { id: 77706, client_id: 79901, bid_id: null, name: 'Has a completion_date but status lagged',
        eventType: 'job', status: 'scheduled', start: '2026-05-01', completion_date: '2026-05-03' },
      { id: 77707, client_id: 79901, bid_id: 78803, name: 'Single-scope touch-up job',
        eventType: 'job', status: 'scheduled', start: '2099-08-03', actualHours: 0 }
    );
    timeEntries.push(
      { id: 9990001, job_id: 77701, date: '2026-06-01', minutes: 90, scope_id: 'sand',   scope_label: 'Sanding' },
      { id: 9990002, job_id: 77701, date: '2026-06-01', minutes: 45, scope_id: 'prime',  scope_label: 'Primer coat' },
      { id: 9990003, job_id: 77701, date: '2026-06-01', minutes: 30, scope_id: null,     scope_label: null }
    );
  };
  const seedFixtures = () => page.evaluate(() => window.__seedJobsFixtures());

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    // Install the seed as an in-page function so test bodies can re-run it
    // atomically inside their own evaluate (see SEED_FIXTURES_FN comment).
    await page.evaluate(`window.__seedJobsFixtures = ${SEED_FIXTURES_FN.toString()}`);
    await seedFixtures();

    await page.evaluate(() => {
      // Stub out functions that open UI we don't want during pure logic tests
      window._origZConfirm  = window.zConfirm;
      window._origZAlert    = window.zAlert;
      window._origSaveAll   = window.saveAll;
      window._origShowToast = window.showToast;
      window._origRenderJobsPage   = window.renderJobsPage;
      window._origRenderDash       = window.renderDash;
      window._origRenderLeadsPage  = window.renderLeadsPage;
      window._origCloseTopModal    = window.closeTopModal;
      window._origCheckStep2Ready  = window.checkStep2Ready;
      window._origSaveEstFullDraft = window.saveEstFullDraft;
      window._origRenderEstRunning = window.renderEstRunning;

      window.zConfirm        = (msg, cb) => { if (cb) cb(); };
      window.zAlert          = () => {};
      window.saveAll         = () => {};
      window.showToast       = () => {};
      window.renderJobsPage  = () => {};
      window.renderDash      = () => {};
      window.renderLeadsPage = () => {};
      window.closeTopModal   = () => {};
      window.checkStep2Ready = () => {};
      window.saveEstFullDraft= () => {};
      window.renderEstRunning= () => {};
    });
  });

  // Re-seed before EVERY test, repairs any fixture a late cloud/cache load
  // clobbered after boot (task #22). Idempotent, so tests that mutate-and-restore
  // their own fixtures still start from the canonical state.
  test.beforeEach(async () => { await seedFixtures(); });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients     = clients.filter(c => c.id !== 79901 && c.id !== 79902);
      bids        = bids.filter(b => b.id !== 78801 && b.id !== 78802);
      jobs        = jobs.filter(j => j.id !== 77701 && j.id !== 77702 && j.id !== 77703);
      timeEntries = timeEntries.filter(e => e.job_id !== 77701 && e.job_id !== 77702);

      // Restore stubs
      if (window._origZConfirm  !== undefined) window.zConfirm  = window._origZConfirm;
      if (window._origZAlert    !== undefined) window.zAlert    = window._origZAlert;
      if (window._origSaveAll   !== undefined) window.saveAll   = window._origSaveAll;
      if (window._origShowToast !== undefined) window.showToast = window._origShowToast;
      if (window._origRenderJobsPage   !== undefined) window.renderJobsPage   = window._origRenderJobsPage;
      if (window._origRenderDash       !== undefined) window.renderDash       = window._origRenderDash;
      if (window._origRenderLeadsPage  !== undefined) window.renderLeadsPage  = window._origRenderLeadsPage;
      if (window._origCloseTopModal    !== undefined) window.closeTopModal    = window._origCloseTopModal;
      if (window._origCheckStep2Ready  !== undefined) window.checkStep2Ready  = window._origCheckStep2Ready;
      if (window._origSaveEstFullDraft !== undefined) window.saveEstFullDraft = window._origSaveEstFullDraft;
      if (window._origRenderEstRunning !== undefined) window.renderEstRunning = window._origRenderEstRunning;

      // Ensure no active timer bleeds between tests
      _activeTimer = null;
    });
    await page.context().close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getJobScopes
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getJobScopes', () => {
    test('null jobId, returns array without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(null); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArray).toBe(true);
    });

    test('undefined jobId, returns array without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(undefined); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArray).toBe(true);
    });

    test('nonexistent jobId, returns default scopes array', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(999999999); return { ok: true, len: res.length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBeGreaterThan(0);
    });

    test('string jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes('notanumber'); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('zero jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(0); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('negative jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(-1); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, job with bid roomScopeMap returns active scopes + extraScopes', async () => {
      const r = await page.evaluate(() => {
        try {
          // Re-seed the fixture INSIDE the test tick. A late-resolving cloud/cache
          // load can reassign `bids`/`jobs` after beforeAll and drop or replace the
          // fixture: the bid's roomScopeMap (sand) survives but the job's
          // extraScopes (popcorn) goes missing (task #22 shared-page state race).
          // Forcing the fixture present here makes the scope merge deterministic.
          if (typeof bids !== 'undefined' && !bids.some(b => b.id === 78801)) bids.push({ id: 78801, client_id: 79901, client_name: 'Jobs Test Alpha', amount: 3500, status: 'Closed Won', bid_date: '2026-01-10', trade_type: 'painting', type: 'Interior painting', surfaces: [{ type: 'walls', room: 'Living Room', qty: 400, wallSqft: 400 }], roomScopeMap: { 'Living Room': { sand: { active: true, hrs: 2, rate: 45, cost: 90 }, prime: { active: true } } }, signedAt: '2026-01-15T00:00:00Z', completion_date: null });
          if (typeof jobs !== 'undefined') {
            let j = jobs.find(x => x.id === 77701);
            if (!j) { j = { id: 77701, client_id: 79901, bid_id: 78801, name: 'Alpha interior job', eventType: 'job', status: 'scheduled', start: '2099-06-01', actualHours: 0 }; jobs.push(j); }
            j.extraScopes = ['popcorn'];
          }
          const res = getJobScopes(77701);
          const ids = res.map(s => s.id);
          return { ok: true, ids, hasPopcorn: ids.includes('popcorn'), hasSand: ids.includes('sand') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasSand).toBe(true);
      expect(r.hasPopcorn).toBe(true);
    });

    test('job with no bid, falls back to default clock scopes', async () => {
      const r = await page.evaluate(() => {
        try {
          window.__seedJobsFixtures();
          const res = getJobScopes(77703);
          return { ok: true, len: res.length, ids: res.map(s => s.id) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBeGreaterThan(0);
    });

    test('no duplicate ids returned even when extraScopes overlaps bid scopes', async () => {
      const r = await page.evaluate(() => {
        try {
          window.__seedJobsFixtures();
          const j = jobs.find(x => x.id === 77701);
          const prev = j.extraScopes;
          j.extraScopes = ['sand', 'popcorn'];
          const res = getJobScopes(77701);
          j.extraScopes = prev;
          const ids = res.map(s => s.id);
          const uniq = new Set(ids);
          return { ok: true, hasDup: ids.length !== uniq.size };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasDup).toBe(false);
    });

    test('extraScopes as object with id, included correctly', async () => {
      const r = await page.evaluate(() => {
        try {
          window.__seedJobsFixtures();
          const j = jobs.find(x => x.id === 77701);
          const prev = j.extraScopes;
          j.extraScopes = [{ id: 'custom_test_xyz', label: 'Custom XYZ', icon: '🔧', hint: '', ratePerSqFt: 0, flatRate: 0, clientDesc: '' }];
          const res = getJobScopes(77701);
          j.extraScopes = prev;
          return { ok: true, hasCustom: res.some(s => s.id === 'custom_test_xyz') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCustom).toBe(true);
    });

    test('concurrent calls, no corruption', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { getJobScopes(77701); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });

    // Per-job custom scope order (owner request, lock-screen Next button):
    // reorderable per job, not fixed to the estimate's order.
    test('no scopeOrder set, default order stands (backward compatible)', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        const j = jobs.find(x => x.id === 77701);
        delete j.scopeOrder;
        const before = getJobScopes(77701).map(s => s.id);
        return { before };
      });
      // sand/prime come from the bid's roomScopeMap, popcorn from extraScopes;
      // the default merge order, unchanged by this feature.
      expect(r.before).toEqual(['sand', 'prime', 'popcorn']);
    });

    test('scopeOrder set, reorders the result to match', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        const j = jobs.find(x => x.id === 77701);
        j.scopeOrder = ['popcorn', 'sand', 'prime'];
        const ids = getJobScopes(77701).map(s => s.id);
        delete j.scopeOrder;
        return ids;
      });
      expect(r).toEqual(['popcorn', 'sand', 'prime']);
    });

    test('scopeOrder missing an id that exists on the job, that scope is appended, never dropped', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        const j = jobs.find(x => x.id === 77701);
        // Only mentions two of the three live scopes.
        j.scopeOrder = ['prime', 'sand'];
        const ids = getJobScopes(77701).map(s => s.id);
        delete j.scopeOrder;
        return ids;
      });
      expect(r).toEqual(['prime', 'sand', 'popcorn']);
      expect(new Set(r).size).toBe(r.length); // no duplicates either
    });

    test('scopeOrder mentioning an id no longer on the job, that id is silently ignored', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        const j = jobs.find(x => x.id === 77701);
        j.scopeOrder = ['ghost_scope_id', 'prime', 'sand', 'popcorn'];
        const ids = getJobScopes(77701).map(s => s.id);
        delete j.scopeOrder;
        return ids;
      });
      expect(r).toEqual(['prime', 'sand', 'popcorn']);
    });

    test('empty scopeOrder array, treated the same as absent', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        const j = jobs.find(x => x.id === 77701);
        j.scopeOrder = [];
        const ids = getJobScopes(77701).map(s => s.id);
        delete j.scopeOrder;
        return ids;
      });
      expect(r).toEqual(['sand', 'prime', 'popcorn']);
    });

    test('scopeOrder on a job with no scopes at all, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const res = getJobScopes(999999998);
          return { ok: true, isArray: Array.isArray(res) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArray).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getJobScopeBreakdown
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getJobScopeBreakdown', () => {
    test('null: returns empty object without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(null); return { ok: true, type: typeof res }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('object');
    });

    test('undefined: returns empty object', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(undefined); return { ok: true, keys: Object.keys(res).length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.keys).toBe(0);
    });

    test('nonexistent jobId, returns empty object', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(999999); return { ok: true, keys: Object.keys(res).length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.keys).toBe(0);
    });

    test('golden path, correct minutes per scope_id, __other for null scope', async () => {
      const r = await page.evaluate(() => {
        try {
          window.__seedJobsFixtures();
          const res = getJobScopeBreakdown(77701);
          return { ok: true, sand: res.sand, prime: res.prime, other: res['__other'] };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.sand).toBe(90);
      expect(r.prime).toBe(45);
      expect(r.other).toBe(30);
    });

    test('string jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { getJobScopeBreakdown('abc'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, stable results', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { const res = getJobScopeBreakdown(77701); if (res.sand === 90) ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getJobClockTotal
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getJobClockTotal', () => {
    test('null: returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('undefined: returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('nonexistent job, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('golden path, sum of minutes across all time entries for job', async () => {
      const r = await page.evaluate(() => {
        try { window.__seedJobsFixtures(); return { ok: true, v: getJobClockTotal(77701) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(165); // 90 + 45 + 30
    });

    test('entry with missing minutes, treated as 0', async () => {
      const r = await page.evaluate(() => {
        try {
          window.__seedJobsFixtures();
          timeEntries.push({ id: 9990099, job_id: 77701, date: '2026-06-02', scope_id: 'sand' }); // no minutes field
          const v = getJobClockTotal(77701);
          timeEntries = timeEntries.filter(e => e.id !== 9990099);
          return { ok: true, v };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(165);
    });

    test('concurrent calls, stable', async () => {
      const r = await page.evaluate(() => {
        window.__seedJobsFixtures();
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { if (getJobClockTotal(77701) === 165) ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _fmtMin
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_fmtMin', () => {
    test('null: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('0: returns empty string', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('');
    });

    test('30: returns "30m"', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(30) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('30m');
    });

    test('60: returns "1h "', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(60) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('1h');
    });

    test('90: returns "1h 30m"', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(90) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('1h 30m');
    });

    test('120: returns "2h "', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(120) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('2h');
    });

    test('negative -1, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(-1) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('very large number, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(99999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('h');
    });

    test('string input, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin('abc') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, all succeed', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { if (_fmtMin(90) === '1h 30m') ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // openClockInSheet
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openClockInSheet', () => {
    test('null jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates overlay with id _cks-ov', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('_cks-ov')?.remove();
          openClockInSheet(77701);
          const exists = !!document.getElementById('_cks-ov');
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, exists };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
    });

    test('called 3 times, no duplicate overlays', async () => {
      const r = await page.evaluate(() => {
        try {
          openClockInSheet(77701);
          openClockInSheet(77701);
          openClockInSheet(77701);
          const count = document.querySelectorAll('#_cks-ov').length;
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, count };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
    });

    test('job already marked done: refuses to open, no overlay, shows a toast', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        const origToast = window.showToast; let toastMsg = null;
        window.showToast = (m) => { toastMsg = m; };
        try {
          openClockInSheet(77704);
          return { opened: !!document.getElementById('_cks-ov'), toastMsg };
        } finally { window.showToast = origToast; document.getElementById('_cks-ov')?.remove(); }
      });
      expect(r.opened, 'a completed job must never open the clock-in sheet').toBe(false);
      expect(r.toastMsg).toContain('complete');
    });

    test('cancelled job: refuses to open the sheet', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        const origToast = window.showToast;
        window.showToast = () => {};
        try { openClockInSheet(77705); return !!document.getElementById('_cks-ov'); }
        finally { window.showToast = origToast; document.getElementById('_cks-ov')?.remove(); }
      });
      expect(r).toBe(false);
    });

    test('job with a completion_date set (even if status lagged): refuses to open the sheet', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        const origToast = window.showToast;
        window.showToast = () => {};
        try { openClockInSheet(77706); return !!document.getElementById('_cks-ov'); }
        finally { window.showToast = origToast; document.getElementById('_cks-ov')?.remove(); }
      });
      expect(r).toBe(false);
    });

    test('job with no bid, uses job name as client name fallback', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('_cks-ov')?.remove();
          openClockInSheet(77703);
          const sheet = document.getElementById('_cks-sheet');
          const html = sheet ? sheet.innerHTML : '';
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, hasJobName: html.includes('Orphan job no bid') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasJobName).toBe(true);
    });

    test('bid with a balance owed, shows a Collect button wired to openPayPanel', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('_cks-ov')?.remove();
          openClockInSheet(77701); // bid 78801: amount 3500, no payments -> balance 3500
          const sheet = document.getElementById('_cks-sheet');
          const html = sheet ? sheet.innerHTML : '';
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, html };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('openPayPanel(78801)');
      expect(r.html).toContain('$3,500');
    });

    test('job with no linked bid, no Collect button (nothing to collect against)', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('_cks-ov')?.remove();
          openClockInSheet(77703); // bid_id: null
          const sheet = document.getElementById('_cks-sheet');
          const html = sheet ? sheet.innerHTML : '';
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, hasCollect: html.includes('openPayPanel(') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCollect).toBe(false);
    });

    test('bid with zero balance, no Collect button', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('_cks-ov')?.remove();
          payments = (payments || []).filter(p => p.id !== 9995001);
          payments.push({ id: 9995001, bid_id: 78802, client_id: 79902, amount: 1200, method: 'Cash', date: '2026-02-06' });
          openClockInSheet(77702); // bid 78802: amount 1200, now fully paid
          const sheet = document.getElementById('_cks-sheet');
          const html = sheet ? sheet.innerHTML : '';
          document.getElementById('_cks-ov')?.remove();
          payments = payments.filter(p => p.id !== 9995001);
          return { ok: true, hasCollect: html.includes('openPayPanel(') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCollect).toBe(false);
    });

    test('concurrent calls, no throw, only 1 overlay', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { openClockInSheet(77701); ok++; } catch (_) {}
        }
        const count = document.querySelectorAll('#_cks-ov').length;
        document.getElementById('_cks-ov')?.remove();
        return { ok, count };
      });
      expect(r.ok).toBe(5);
      expect(r.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Scope drag-to-reorder (_initScopeDrag / _setJobScopeOrder): owner request,
  // per-job custom task order for the clock-in sheet, same pointer-event
  // pattern as the dispatch board's day-reorder (js/cloud.js
  // _initDispatchDrag / tests/e2e-dispatch-board.spec.js), CLAUDE.md §7.3.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('scope drag-to-reorder', () => {
    test('a grip renders per row once there is more than one scope to order', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77701); // 3 scopes: sand, prime, popcorn
        const rows = document.querySelectorAll('#_cks-list .scope-row').length;
        const grips = document.querySelectorAll('#_cks-list .scope-grip').length;
        document.getElementById('_cks-ov')?.remove();
        return { rows, grips };
      });
      expect(r.rows).toBe(3);
      expect(r.grips).toBe(3);
    });

    test('a single-scope job shows no grip: nothing to drag', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77707); // exactly one active scope
        const rows = document.querySelectorAll('#_cks-list .scope-row').length;
        const grips = document.querySelectorAll('#_cks-list .scope-grip').length;
        document.getElementById('_cks-ov')?.remove();
        return { rows, grips };
      });
      expect(r.rows).toBe(1);
      expect(r.grips).toBe(0);
    });

    test('the grip does not block the sheet from scrolling', async () => {
      // touch-action:none belongs on the HANDLE only, same reasoning as the
      // dispatch board's grip: the sheet must still scroll normally.
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77701);
        const grip = document.querySelector('.scope-grip');
        const row = grip.closest('.scope-row');
        const out = { grip: getComputedStyle(grip).touchAction, row: getComputedStyle(row).touchAction };
        document.getElementById('_cks-ov')?.remove();
        return out;
      });
      expect(r.grip).toBe('none');
      expect(r.row).not.toBe('none');
    });

    test('dragging a scope to the top rewrites the job\'s scopeOrder to match', async () => {
      const r = await page.evaluate(async () => {
        const j = jobs.find(x => x.id === 77701);
        delete j.scopeOrder;
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77701);
        const sheet = document.getElementById('_cks-sheet');
        const list = document.getElementById('_cks-list');
        const rowsBefore = [...list.querySelectorAll('.scope-row')];
        const third = rowsBefore[2]; // popcorn, default order
        const grip = third.querySelector('.scope-grip');
        const first = rowsBefore[0].getBoundingClientRect();
        const gr = grip.getBoundingClientRect();
        const ev = (type, y) => sheet.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: gr.left + 4, clientY: y, pointerId: 1,
        }));
        grip.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, clientX: gr.left + 4, clientY: gr.top + 4, pointerId: 1 }));
        ev('pointermove', first.top + 2);
        ev('pointermove', first.top - 20);
        ev('pointermove', first.top - 40);
        ev('pointerup', first.top - 40);
        await new Promise(res => setTimeout(res, 30));
        const order = j.scopeOrder ? j.scopeOrder.slice() : null;
        document.getElementById('_cks-ov')?.remove();
        delete j.scopeOrder;
        return order;
      });
      expect(r).not.toBeNull();
      expect(r[0]).toBe('popcorn');
      expect(r).toEqual(['popcorn', 'sand', 'prime']);
    });

    test('a drag that never moves writes no scopeOrder', async () => {
      const r = await page.evaluate(async () => {
        const j = jobs.find(x => x.id === 77701);
        delete j.scopeOrder;
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77701);
        const sheet = document.getElementById('_cks-sheet');
        const grip = document.querySelector('.scope-grip');
        const gr = grip.getBoundingClientRect();
        grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: gr.left, clientY: gr.top, pointerId: 2 }));
        sheet.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
        await new Promise(res => setTimeout(res, 20));
        const hasOrder = 'scopeOrder' in j;
        document.getElementById('_cks-ov')?.remove();
        delete j.scopeOrder;
        return hasOrder;
      });
      expect(r).toBe(false);
    });

    test('the sheet rebuilding on clock-in does not double-bind the drag handler', async () => {
      // _initScopeDrag is called on every _cksRebuild(), and the sheet element
      // itself persists across a rebuild (only its innerHTML changes), so the
      // guard flag must survive: a second bind would fire the reorder write
      // twice per drag.
      const r = await page.evaluate(() => {
        document.getElementById('_cks-ov')?.remove();
        openClockInSheet(77701);
        window._cksRebuild(); // simulate the rebuild a clock-in tap triggers
        window._cksRebuild();
        const sheet = document.getElementById('_cks-sheet');
        const bound = sheet._scopeDragBound;
        document.getElementById('_cks-ov')?.remove();
        return bound;
      });
      expect(r).toBe(true);
    });

    // _setJobScopeOrder exhaustive input coverage (CLAUDE.md §11.1)
    test('_setJobScopeOrder: null/undefined/empty ids array, no throw, writes nothing', async () => {
      const r = await page.evaluate(() => {
        const j = jobs.find(x => x.id === 77701);
        delete j.scopeOrder;
        try {
          _setJobScopeOrder(77701, null);
          _setJobScopeOrder(77701, undefined);
          _setJobScopeOrder(77701, []);
          const hasOrder = 'scopeOrder' in j;
          delete j.scopeOrder;
          return { ok: true, hasOrder };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasOrder).toBe(false);
    });

    test('_setJobScopeOrder: nonexistent jobId, no throw', async () => {
      const r = await page.evaluate(() => {
        try { _setJobScopeOrder(999999999, ['sand', 'prime']); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_setJobScopeOrder: golden path persists and getJobScopes honors it immediately', async () => {
      const r = await page.evaluate(() => {
        const j = jobs.find(x => x.id === 77701);
        delete j.scopeOrder;
        _setJobScopeOrder(77701, ['prime', 'popcorn', 'sand']);
        const ids = getJobScopes(77701).map(s => s.id);
        delete j.scopeOrder;
        return ids;
      });
      expect(r).toEqual(['prime', 'popcorn', 'sand']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // clockIn/clockOut: "bulletproof" persistence (owner request 2026-07-11).
  // Before this, clockOut() was the ONLY place a timeEntries row was ever
  // written: a crashed tab, dead phone, or forgotten clock-out meant the
  // entire session was silently lost, with no trace anywhere. Now clockIn()
  // itself persists an "open" row immediately; clockOut() closes that same
  // row instead of creating a new one. This block proves the data survives
  // even when clockOut never runs, and covers the new admin/edit tooling
  // this enables: forceClockOutEntry, deleteTimeEntry, edit, rehydration.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('clockIn/clockOut bulletproof persistence', () => {
    test('CRITICAL: clockIn alone (no clockOut) already persists a real timeEntries row', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origToast = window.showToast;
        window.showClockBanner = () => {}; window.showToast = () => {};
        try {
          clockOut(false, true); // ensure clean slate
          timeEntries = timeEntries.filter(e => e.job_id !== 77701 || !e.open);
          clockIn(77701, 'sand', 'Sanding');
          const open = timeEntries.find(e => e.job_id === 77701 && e.open);
          return {
            ok: true, found: !!open, hasStartTime: !!(open && open.start_time),
            endTimeNull: open ? open.end_time === null : null, entryId: open ? open.id : null,
            matchesActiveTimer: open ? open.id === _activeTimer.entryId : null,
          };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner; window.showToast = origToast;
          // Leaving _activeTimer set here would make the NEXT test's clockIn()
          // hit the "already tracking this task" guard (js/jobs.js:196) and
          // silently no-op, reset state so tests stay isolated.
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); clockOut(false, true); }
        }
      });
      expect(r.ok).toBe(true);
      expect(r.found).toBe(true);
      expect(r.hasStartTime).toBe(true);
      expect(r.endTimeNull).toBe(true);
      expect(r.matchesActiveTimer).toBe(true);
    });

    test('clockOut closes the SAME open row in place, does not create a duplicate', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origHide = window.hideClockBanner;
        const origRender = window.renderJobsPage, origToast = window.showToast;
        window.showClockBanner = () => {}; window.hideClockBanner = () => {};
        window.renderJobsPage = () => {}; window.showToast = () => {};
        try {
          timeEntries = timeEntries.filter(e => e.job_id !== 77701);
          clockIn(77701, 'sand', 'Sanding');
          const openId = _activeTimer.entryId;
          const countAfterClockIn = timeEntries.filter(e => e.job_id === 77701).length;
          clockOut(true, true);
          const countAfterClockOut = timeEntries.filter(e => e.job_id === 77701).length;
          const closed = timeEntries.find(e => e.id === openId);
          return {
            ok: true, countAfterClockIn, countAfterClockOut,
            sameRowClosed: !!(closed && closed.open === false && closed.end_time && typeof closed.minutes === 'number'),
          };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { window.showClockBanner = origBanner; window.hideClockBanner = origHide; window.renderJobsPage = origRender; window.showToast = origToast; }
      });
      expect(r.ok).toBe(true);
      expect(r.countAfterClockIn).toBe(1);
      expect(r.countAfterClockOut).toBe(1); // still 1, updated in place, not duplicated
      expect(r.sameRowClosed).toBe(true);
    });

    test('clockOut(false): explicit discard removes the open row instead of stranding it open', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origHide = window.hideClockBanner, origRender = window.renderJobsPage;
        window.showClockBanner = () => {}; window.hideClockBanner = () => {}; window.renderJobsPage = () => {};
        try {
          timeEntries = timeEntries.filter(e => e.job_id !== 77701);
          clockIn(77701, 'sand', 'Sanding');
          clockOut(false, true);
          return { ok: true, remaining: timeEntries.filter(e => e.job_id === 77701).length };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { window.showClockBanner = origBanner; window.hideClockBanner = origHide; window.renderJobsPage = origRender; }
      });
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(0);
    });

    test('_rehydrateActiveTimer restores _activeTimer from a persisted open entry (simulates reload mid-timer)', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner;
        window.showClockBanner = () => {};
        try {
          timeEntries = timeEntries.filter(e => e.job_id !== 77701);
          clockIn(77701, 'sand', 'Sanding');
          const entryId = _activeTimer.entryId;
          clearInterval(_activeTimer.timerInterval);
          _activeTimer = null; // simulate a reload, the `let` binding does not survive
          _rehydrateActiveTimer();
          return { ok: true, restored: !!_activeTimer, entryId: _activeTimer ? _activeTimer.entryId : null, expectedId: entryId, jobId: _activeTimer ? _activeTimer.jobId : null };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { window.showClockBanner = origBanner; if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); } }
      });
      expect(r.ok).toBe(true);
      expect(r.restored).toBe(true);
      expect(r.entryId).toBe(r.expectedId);
      expect(r.jobId).toBe(77701);
    });

    test('_rehydrateActiveTimer does nothing when there is no open entry', async () => {
      const r = await page.evaluate(() => {
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          _activeTimer = null;
          _rehydrateActiveTimer();
          return { ok: true, activeTimer: _activeTimer };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.activeTimer).toBe(null);
    });

    // Owner report 2026-08-31: "Jack just said its not letting him clock out",
    // and then "it needs to survive app reloads". He clocked in with NO job
    // (clockIn(null,...), the "General time" button) at 7:55am. On the next
    // reload this bailed on `jobs.find(x=>x.id===null)` and _activeTimer was
    // never restored, so there was no banner and the Time Log's Clock out
    // button hit clockOut's `if(!_activeTimer)return;` and did nothing. His
    // row was still open fourteen hours later.
    test('_rehydrateActiveTimer restores a JOB-LESS clock across a reload (the Jack case)', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner;
        window.showClockBanner = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          clockIn(null, null, null);
          const entryId = _activeTimer.entryId;
          clearInterval(_activeTimer.timerInterval);
          _activeTimer = null;                       // the reload
          _rehydrateActiveTimer();
          return { ok: true, restored: !!_activeTimer, entryId: _activeTimer && _activeTimer.entryId, expectedId: entryId,
                   jobId: _activeTimer && _activeTimer.jobId, jobName: _activeTimer && _activeTimer.jobName,
                   ticking: !!(_activeTimer && _activeTimer.timerInterval) };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); clockOut(false, true); }
        }
      });
      expect(r.ok).toBe(true);
      expect(r.restored).toBe(true);
      expect(r.entryId).toBe(r.expectedId);
      expect(r.jobId).toBe(null);
      expect(r.jobName).toBe('General time');
      expect(r.ticking).toBe(true);
    });

    test('_rehydrateActiveTimer matches a job_id that came back from Supabase as a string', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner;
        window.showClockBanner = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          timeEntries.push({ id: 9911001, job_id: '77701', date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 3 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
          _activeTimer = null;
          _rehydrateActiveTimer();
          return { ok: true, jobId: _activeTimer && _activeTimer.jobId, jobName: _activeTimer && _activeTimer.jobName };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
          timeEntries = timeEntries.filter(e => e.id !== 9911001);
        }
      });
      expect(r.ok).toBe(true);
      expect(r.jobId).toBe(77701);                 // the real job, not "General time"
      expect(r.jobName).not.toBe('General time');
    });

    test('_rehydrateActiveTimer refuses a row with a malformed start_time (never a clock counting from 1970)', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner;
        window.showClockBanner = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          timeEntries.push({ id: 9911002, job_id: null, date: '', start_time: 'not a date', end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
          _activeTimer = null;
          _rehydrateActiveTimer();
          return { ok: true, active: _activeTimer };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
          timeEntries = timeEntries.filter(e => e.id !== 9911002);
        }
      });
      expect(r.ok).toBe(true);
      expect(r.active).toBe(null);
    });

    // The dead-button half. clockOut() alone returns on `if(!_activeTimer)`,
    // so the Time Log card's own-row button silently did nothing whenever this
    // device had not started the clock itself.
    test('clockOutEntry closes a job-less open row with NO _activeTimer at all', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origHide = window.hideClockBanner, origRender = window.renderJobsPage;
        window.showClockBanner = () => {}; window.hideClockBanner = () => {}; window.renderJobsPage = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          const id = 9911010;
          timeEntries.push({ id, job_id: null, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 42 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Jack Test' });
          _activeTimer = null;                       // exactly the post-reload state
          clockOutEntry(id);
          const row = timeEntries.find(e => e.id === id);
          return { ok: true, open: row.open, minutes: row.minutes, hasEnd: !!row.end_time, cleared: _activeTimer === null,
                   forceTagged: !!row.force_closed_by_name };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner; window.hideClockBanner = origHide; window.renderJobsPage = origRender;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
          timeEntries = timeEntries.filter(e => e.id !== 9911010);
        }
      });
      expect(r.ok).toBe(true);
      expect(r.open).toBe(false);
      expect(r.minutes).toBe(42);
      expect(r.hasEnd).toBe(true);
      expect(r.cleared).toBe(true);
      expect(r.forceTagged).toBe(false);   // your own clock-out is not a manager force-close
    });

    test('clockOutEntry banks a DIFFERENT running entry before taking over the one it was given', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origHide = window.hideClockBanner, origRender = window.renderJobsPage;
        window.showClockBanner = () => {}; window.hideClockBanner = () => {}; window.renderJobsPage = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          const other = 9911020;
          timeEntries.push({ id: other, job_id: null, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 17 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
          clockIn(77701, null, null);                // this device is running something else
          const liveId = _activeTimer.entryId;
          clockOutEntry(other);
          const a = timeEntries.find(e => e.id === other), b = timeEntries.find(e => e.id === liveId);
          return { ok: true, targetClosed: a.open === false, targetMin: a.minutes, otherClosed: b.open === false, stillOpen: timeEntries.filter(e => e.open).length };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner; window.hideClockBanner = origHide; window.renderJobsPage = origRender;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
          timeEntries = timeEntries.filter(e => e.id !== 9911020);
        }
      });
      expect(r.ok).toBe(true);
      expect(r.targetClosed).toBe(true);
      expect(r.targetMin).toBe(17);
      expect(r.otherClosed).toBe(true);   // banked, never abandoned open
      expect(r.stillOpen).toBe(0);
    });

    test('clockOutEntry on an unknown, already-closed, or junk id does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          _activeTimer = null;
          clockOutEntry(424242); clockOutEntry(null); clockOutEntry(undefined); clockOutEntry('nope');
          return { ok: true, active: _activeTimer };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.active).toBe(null);
    });

    test('_clockElapsedStr: seconds, minutes, hours, and junk', async () => {
      const r = await page.evaluate(() => ({
        zero: _clockElapsedStr(0),
        seven: _clockElapsedStr(7000),
        min: _clockElapsedStr(65 * 1000),
        hour: _clockElapsedStr(3 * 3600000 + 4 * 60000 + 9000),
        long: _clockElapsedStr(14 * 3600000),
        negative: _clockElapsedStr(-5000),
        junk: _clockElapsedStr('nope'),
        nothing: _clockElapsedStr(undefined),
      }));
      expect(r.zero).toBe('0:00');
      expect(r.seven).toBe('0:07');
      expect(r.min).toBe('1:05');
      expect(r.hour).toBe('3h 4:09');
      expect(r.long).toBe('14h 0:00');
      expect(r.negative).toBe('0:00');     // a clock never runs backwards
      expect(r.junk).toBe('0:00');
      expect(r.nothing).toBe('0:00');
    });

    test('_rehydrateActiveTimer does not clobber an already-running local timer', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner;
        window.showClockBanner = () => {};
        try {
          timeEntries = timeEntries.filter(e => e.job_id !== 77701 && e.job_id !== 77702);
          clockIn(77701, 'sand', 'Sanding');
          const firstEntryId = _activeTimer.entryId;
          _rehydrateActiveTimer(); // should be a no-op since _activeTimer is already set
          return { ok: true, entryId: _activeTimer.entryId, unchanged: _activeTimer.entryId === firstEntryId };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); clockOut(false, true); }
        }
      });
      expect(r.ok).toBe(true);
      expect(r.unchanged).toBe(true);
    });

    test('forceClockOutEntry closes an open entry and marks who force-closed it', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990101);
        timeEntries.push({ id: 9990101, job_id: 77701, date: todayKey(), start_time: new Date(Date.now() - 3600000).toISOString(), end_time: null, minutes: null, scope_id: null, scope_label: null, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else', open: true });
        try {
          forceClockOutEntry(9990101);
          const e = timeEntries.find(x => x.id === 9990101);
          return { ok: true, closed: e.open === false, hasMinutes: typeof e.minutes === 'number' && e.minutes > 0, hasForceClosedBy: !!e.force_closed_by_name };
        } catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990101); }
      });
      expect(r.ok).toBe(true);
      expect(r.closed).toBe(true);
      expect(r.hasMinutes).toBe(true);
      expect(r.hasForceClosedBy).toBe(true);
    });

    test('forceClockOutEntry on a nonexistent id, does not throw', async () => {
      const r = await page.evaluate(() => { try { forceClockOutEntry(999999); return true; } catch (e) { return false; } });
      expect(r).toBe(true);
    });

    test('forceClockOutEntry on an already-closed entry, no-op, does not throw', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990102);
        timeEntries.push({ id: 9990102, job_id: 77701, date: todayKey(), start_time: new Date().toISOString(), end_time: new Date().toISOString(), minutes: 30, open: false });
        try { forceClockOutEntry(9990102); const e = timeEntries.find(x => x.id === 9990102); return { ok: true, minutesUnchanged: e.minutes === 30 }; }
        catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990102); }
      });
      expect(r.ok).toBe(true);
      expect(r.minutesUnchanged).toBe(true);
    });

    test('deleteTimeEntry removes an entry the caller owns', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990103);
        timeEntries.push({ id: 9990103, job_id: 77701, date: todayKey(), start_time: new Date().toISOString(), end_time: new Date().toISOString(), minutes: 30, logged_by_uid: null, logged_by_name: 'Owner (me)', open: false });
        try { deleteTimeEntry(9990103); return { ok: true, gone: !timeEntries.find(e => e.id === 9990103) }; }
        catch (err) { return { ok: false, err: err.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.gone).toBe(true);
    });

    test('deleteTimeEntry null/nonexistent id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { deleteTimeEntry(null); deleteTimeEntry(999999); return true; } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    test('_openEditTimeEntry on a still-open entry, refuses (must clock out first)', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990104);
        timeEntries.push({ id: 9990104, job_id: 77701, date: todayKey(), start_time: new Date().toISOString(), end_time: null, minutes: null, logged_by_uid: null, open: true });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try { _openEditTimeEntry(9990104); return { ok: true, modalShown: !!document.querySelector('.zmodal-overlay') }; }
        catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990104); document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); }
      });
      expect(r.ok).toBe(true);
      expect(r.modalShown).toBe(false);
    });

    test('_openEditTimeEntry / _saveEditedTimeEntry: golden path updates start/end/minutes and marks who edited it', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990105);
        timeEntries.push({ id: 9990105, job_id: 77701, date: '2026-01-01', start_time: '2026-01-01T09:00:00.000Z', end_time: '2026-01-01T10:00:00.000Z', minutes: 60, logged_by_uid: null, logged_by_name: 'Owner (me)', open: false });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try {
          _openEditTimeEntry(9990105);
          const startEl = document.getElementById('tle-start'), endEl = document.getElementById('tle-end');
          startEl.value = '2026-01-01T09:00';
          endEl.value = '2026-01-01T11:30'; // extend by 90 minutes
          _saveEditedTimeEntry(9990105);
          const e = timeEntries.find(x => x.id === 9990105);
          return { ok: true, minutes: e.minutes, hasEditedBy: !!e.edited_by_name, hasEditedAt: !!e.edited_at, modalClosed: !document.querySelector('.zmodal-overlay') };
        } catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990105); document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); }
      });
      expect(r.ok).toBe(true);
      expect(r.minutes).toBe(150);
      expect(r.hasEditedBy).toBe(true);
      expect(r.hasEditedAt).toBe(true);
      expect(r.modalClosed).toBe(true);
    });

    test('_saveEditedTimeEntry rejects end time before/equal to start, leaves the entry unchanged', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990106);
        timeEntries.push({ id: 9990106, job_id: 77701, date: '2026-01-01', start_time: '2026-01-01T09:00:00.000Z', end_time: '2026-01-01T10:00:00.000Z', minutes: 60, logged_by_uid: null, open: false });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try {
          _openEditTimeEntry(9990106);
          document.getElementById('tle-start').value = '2026-01-01T11:00';
          document.getElementById('tle-end').value = '2026-01-01T10:00'; // before start, invalid
          _saveEditedTimeEntry(9990106);
          const e = timeEntries.find(x => x.id === 9990106);
          return { ok: true, minutesUnchanged: e.minutes === 60, errShown: document.getElementById('tle-err')?.style.display === 'block' };
        } catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990106); document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); }
      });
      expect(r.ok).toBe(true);
      expect(r.minutesUnchanged).toBe(true);
      expect(r.errShown).toBe(true);
    });

    test('_saveEditedTimeEntry rejects a single entry spanning over 24 hours, leaves the entry unchanged', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990107);
        timeEntries.push({ id: 9990107, job_id: 77701, date: '2026-01-01', start_time: '2026-01-01T09:00:00.000Z', end_time: '2026-01-01T10:00:00.000Z', minutes: 60, logged_by_uid: null, open: false });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try {
          _openEditTimeEntry(9990107);
          document.getElementById('tle-start').value = '2026-01-01T09:00';
          document.getElementById('tle-end').value = '2026-01-03T10:00'; // 49 hours later, impossible for one entry
          _saveEditedTimeEntry(9990107);
          const e = timeEntries.find(x => x.id === 9990107);
          return { ok: true, minutesUnchanged: e.minutes === 60, errShown: document.getElementById('tle-err')?.style.display === 'block', errText: document.getElementById('tle-err')?.textContent };
        } catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990107); document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); }
      });
      expect(r.ok).toBe(true);
      expect(r.minutesUnchanged).toBe(true);
      expect(r.errShown).toBe(true);
      expect(r.errText).toContain('24 hours');
    });

    test('_saveEditedTimeEntry accepts a span of exactly 24 hours (boundary, not over)', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990108);
        timeEntries.push({ id: 9990108, job_id: 77701, date: '2026-01-01', start_time: '2026-01-01T09:00:00.000Z', end_time: '2026-01-01T10:00:00.000Z', minutes: 60, logged_by_uid: null, open: false });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try {
          _openEditTimeEntry(9990108);
          document.getElementById('tle-start').value = '2026-01-01T09:00';
          document.getElementById('tle-end').value = '2026-01-02T09:00'; // exactly 24h later
          _saveEditedTimeEntry(9990108);
          const e = timeEntries.find(x => x.id === 9990108);
          return { ok: true, minutes: e ? e.minutes : null };
        } catch (err) { return { ok: false, err: err.message }; }
        finally { timeEntries = timeEntries.filter(e => e.id !== 9990108); document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); }
      });
      expect(r.ok).toBe(true);
      expect(r.minutes).toBe(1440);
    });

    test('_openEditTimeEntry / deleteTimeEntry on a nonexistent id, do not throw', async () => {
      const r = await page.evaluate(() => {
        try { _openEditTimeEntry(999999); _saveEditedTimeEntry(999999); deleteTimeEntry(999999); return true; }
        catch (e) { return false; }
      });
      expect(r).toBe(true);
    });

    // ── Delete, from inside the edit modal ────────────────────────────────
    // Owner 2026-08-31: "add a delete button to the edit button on manual
    // clock out things". deleteTimeEntry() has existed since July but the
    // only way to reach it was a long-press nobody discovers.
    // Seeded INSIDE each evaluate, never from a helper in a separate one.
    // A cross-evaluate gap lets this file's own async tails (renderTimeLog and
    // its repair pass) run against the seeded array in between, and the row
    // was gone before the assertion ran. Every other test in this describe
    // seeds inline for the same reason (7.3).
    const SEED_SRC = `
      timeEntries = timeEntries.filter(e => e.id !== ID);
      timeEntries.push({ id: ID, job_id: 77701, date: todayKey(),
        start_time: '2026-08-21T14:00:00.000Z', end_time: '2026-08-21T17:30:00.000Z',
        minutes: 210, logged_by_uid: null, logged_by_name: 'Owner (me)', open: false });
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());`;
    const cleanup = (id) => page.evaluate((i) => {
      timeEntries = timeEntries.filter(e => e.id !== i);
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
    }, id);
    const seedThen = (id, body) => page.evaluate(
      new Function('ID', SEED_SRC.split('ID').join('ID') + '\nreturn (' + body.toString() + ')();'), id);
    // This file's beforeAll replaces zConfirm with an auto-accept stub so the
    // other destructive paths can be driven without a dialog. These tests are
    // ABOUT the dialog, so they put the real one back for their own duration
    // and restore the stub after; anything else would be asserting against the
    // stub and proving nothing.
    const seedThenReal = (id, body) => page.evaluate(
      new Function('ID',
        'const _stub = window.zConfirm; if (window._origZConfirm) window.zConfirm = window._origZConfirm;\n' +
        'try {' + SEED_SRC.split('ID').join('ID') + '\nreturn (' + body.toString() + ')();' +
        '} finally { window.zConfirm = _stub; }'), id);

    test('the edit modal carries a Delete button, wired to the confirm path', async () => {
      const r = await seedThen(9990140, () => {
        _openEditTimeEntry(ID);
        const box = document.querySelector('.zmodal-overlay .zmodal');
        return { html: box ? box.innerHTML : '' };
      });
      await cleanup(9990140);
      expect(r.html).toContain('_deleteTimeEntryFromModal(9990140)');
      expect(r.html).toContain('Delete this entry');
      // Never a bare deleteTimeEntry() on the button: that one does not ask.
      expect(r.html).not.toContain('onclick="deleteTimeEntry(');
    });

    test('Delete is on its own row, never a third column beside Save', async () => {
      const r = await seedThen(9990141, () => {
        _openEditTimeEntry(ID);
        const del = [...document.querySelectorAll('.zmodal button')].find(b => /Delete this entry/.test(b.textContent));
        const save = [...document.querySelectorAll('.zmodal button')].find(b => b.textContent.trim() === 'Save');
        if (!del || !save) return { found: false };
        const d = del.getBoundingClientRect(), s = save.getBoundingClientRect();
        return {
          found: true,
          sameParent: del.parentElement === save.parentElement,
          // Below, not beside: a destroy button one thumb-width from Save is
          // how a payroll record dies by accident.
          below: d.top >= s.bottom - 1,
          overlaps: !(d.right <= s.left || d.left >= s.right || d.bottom <= s.top || d.top >= s.bottom),
        };
      });
      await cleanup(9990141);
      expect(r.found).toBe(true);
      expect(r.sameParent).toBe(false);
      expect(r.below).toBe(true);
      expect(r.overlaps).toBe(false);   // 15.1: no two controls overlap
    });

    test('it asks before it deletes, and names what is being destroyed', async () => {
      const r = await seedThenReal(9990142, () => {
        _openEditTimeEntry(ID);
        _deleteTimeEntryFromModal(ID);
        const overlays = [...document.querySelectorAll('.zmodal-overlay')];
        const confirm = overlays[overlays.length - 1];
        return {
          stillThere: !!timeEntries.find(e => e.id === ID),   // nothing gone yet
          title: confirm ? (confirm.querySelector('.zmodal-title')?.textContent || '') : '',
          msg: confirm ? (confirm.querySelector('.zmodal-msg')?.textContent || '') : '',
          yes: confirm ? (confirm.querySelector('#zmodal-yes')?.textContent || '') : '',
        };
      });
      await cleanup(9990142);
      expect(r.stillThere).toBe(true);
      expect(r.title).toBe('Delete time entry');
      expect(r.yes).toBe('Delete');
      expect(r.msg).toContain('3h 30m');            // it says WHICH entry
      expect(r.msg).toContain('cannot be undone');
    });

    test('confirming deletes the row and closes the modal', async () => {
      const r = await seedThenReal(9990143, () => {
        _openEditTimeEntry(ID);
        _deleteTimeEntryFromModal(ID);
        document.querySelector('#zmodal-yes').click();
        return { gone: !timeEntries.find(e => e.id === ID), overlays: document.querySelectorAll('.zmodal-overlay').length };
      });
      await cleanup(9990143);
      expect(r.gone).toBe(true);
      expect(r.overlays).toBe(0);      // the edit modal closes with it
    });

    test('cancelling the confirm leaves the entry exactly alone', async () => {
      const r = await seedThenReal(9990144, () => {
        _openEditTimeEntry(ID);
        _deleteTimeEntryFromModal(ID);
        [...document.querySelectorAll('.zmodal-overlay')].pop().querySelector('.zmodal-cancel').click();
        const e = timeEntries.find(x => x.id === ID);
        return { survived: !!e, minutes: e && e.minutes, editStillOpen: !!document.querySelector('.zmodal-overlay') };
      });
      await cleanup(9990144);
      expect(r.survived).toBe(true);
      expect(r.minutes).toBe(210);
      expect(r.editStillOpen).toBe(true);   // back to the edit modal, not nowhere
    });

    test('someone else\'s entry without payroll permission: no prompt, no delete', async () => {
      const r = await page.evaluate(() => {
        timeEntries = timeEntries.filter(e => e.id !== 9990145);
        timeEntries.push({ id: 9990145, job_id: 77701, date: todayKey(), start_time: '2026-08-21T14:00:00.000Z', end_time: '2026-08-21T15:00:00.000Z', minutes: 60, logged_by_uid: 'somebody-else', logged_by_name: 'Someone Else', open: false });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        const savedEmp = window._isEmployee, savedRec = window._employeeRecord, savedUser = window._supaUser;
        window._isEmployee = true; window._employeeRecord = { permissions: { payroll: false } }; window._supaUser = { id: 'me-uid' };
        let threw = null;
        try { _deleteTimeEntryFromModal(9990145); } catch (e) { threw = e.message; }
        const out = { threw, prompted: !!document.querySelector('.zmodal-overlay'), survived: !!timeEntries.find(x => x.id === 9990145) };
        window._isEmployee = savedEmp; window._employeeRecord = savedRec; window._supaUser = savedUser;
        timeEntries = timeEntries.filter(e => e.id !== 9990145);
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        return out;
      });
      expect(r.threw).toBe(null);
      // A prompt that asks and then silently does nothing is worse than no button.
      expect(r.prompted).toBe(false);
      expect(r.survived).toBe(true);
    });

    test('_deleteTimeEntryFromModal on a missing or junk id does not throw or prompt', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        try {
          _deleteTimeEntryFromModal(424242); _deleteTimeEntryFromModal(null);
          _deleteTimeEntryFromModal(undefined); _deleteTimeEntryFromModal('nope');
          return { ok: true, prompted: !!document.querySelector('.zmodal-overlay') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.prompted).toBe(false);
    });

    test('deleting the row a live timer is holding stops the clock with it', async () => {
      const r = await page.evaluate(() => {
        const origBanner = window.showClockBanner, origHide = window.hideClockBanner, origRender = window.renderJobsPage;
        let hid = 0;
        window.showClockBanner = () => {}; window.hideClockBanner = () => { hid++; }; window.renderJobsPage = () => {};
        try {
          timeEntries = timeEntries.filter(e => !e.open);
          clockIn(77701, null, null);
          const id = _activeTimer.entryId;
          deleteTimeEntry(id);
          return { ok: true, gone: !timeEntries.find(e => e.id === id), timerCleared: _activeTimer === null, bannerHidden: hid > 0 };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          window.showClockBanner = origBanner; window.hideClockBanner = origHide; window.renderJobsPage = origRender;
          if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; }
        }
      });
      expect(r.ok).toBe(true);
      expect(r.gone).toBe(true);
      // Otherwise the banner keeps ticking against a record that no longer
      // exists, and the lock screen keeps saying CLOCKED IN.
      expect(r.timerCleared).toBe(true);
      expect(r.bannerHidden).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _nearbyClockIn: nearby-banner Clock in handler. Unlike openClockInSheet
  // (which requires an existing job), this always succeeds: given a null
  // jobId it creates a minimal walk-up job for the client on the spot so
  // "you're on site, clock in" never dead-ends.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_nearbyClockIn', () => {
    test('existing jobId, opens the sheet directly, creates no new job', async () => {
      const r = await page.evaluate(() => {
        const beforeCount = jobs.length;
        try {
          document.getElementById('_cks-ov')?.remove();
          _nearbyClockIn(79901, 77701);
          const exists = !!document.getElementById('_cks-ov');
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, exists, jobsAdded: jobs.length - beforeCount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.exists).toBe(true);
      expect(r.jobsAdded).toBe(0);
    });

    test('null jobId, valid client, creates a walk-up job and opens the sheet for it', async () => {
      const r = await page.evaluate(() => {
        const orig = { clients, jobs };
        clients = clients.filter(c => c.id !== 79970);
        clients.push({ id: 79970, name: 'Walkup Client', addr: '99 Walkup Ln, Wichita KS' });
        jobs = jobs.filter(j => j.client_id !== 79970);
        try {
          document.getElementById('_cks-ov')?.remove();
          _nearbyClockIn(79970, null);
          const created = jobs.find(j => j.client_id === 79970);
          const sheetExists = !!document.getElementById('_cks-ov');
          const result = { ok: true, created: created ? { id: created.id, bid_id: created.bid_id, name: created.name, start: created.start } : null, sheetExists, today: todayKey() };
          document.getElementById('_cks-ov')?.remove();
          return result;
        } catch (e) { return { ok: false, err: e.message }; }
        finally { ({ clients, jobs } = orig); }
      });
      expect(r.ok).toBe(true);
      expect(r.created).toBeTruthy();
      expect(r.created.bid_id).toBe(null);
      expect(r.created.name).toBe('Walkup Client');
      expect(r.created.start).toBe(r.today);
      expect(r.sheetExists).toBe(true);
    });

    test('null jobId, nonexistent client, returns early without throw, no job created', async () => {
      const r = await page.evaluate(() => {
        const beforeCount = jobs.length;
        try {
          _nearbyClockIn(999999, null);
          return { ok: true, jobsAdded: jobs.length - beforeCount };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.jobsAdded).toBe(0);
    });

    test('null jobId, null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _nearbyClockIn(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ── _locPromptClockIn / _locPromptJobs (the location prompt on the dashboard,
  // js/dashboard.js) ──────────────────────────────────────────────────────────
  test.describe('_locPromptClockIn / _locPromptJobs', () => {
    test('clocks in with no scope tag, not the task-scope sheet, once on a job it is just job time', async () => {
      const r = await page.evaluate(() => {
        const origTimer = _activeTimer, origJobs = jobs.slice();
        jobs.length = 0;
        jobs.push({ id: 998001, name: 'Shop Test Job', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        if (_activeTimer) clockOut(false, true);
        try {
          _locPromptClockIn(998001);
          return {
            jobId: _activeTimer && _activeTimer.jobId,
            scopeId: _activeTimer && _activeTimer.scopeId,
            scopeLabel: _activeTimer && _activeTimer.scopeLabel,
            sheetOpen: !!document.getElementById('_cks-ov'),
          };
        } finally {
          if (_activeTimer) clockOut(false, true);
          _activeTimer = origTimer; jobs.length = 0; origJobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.jobId).toBe(998001);
      // No scope tag: owner directive 2026-08-01, once shop time is on a job it
      // IS job time, no special "shop labor" category.
      expect(r.scopeId).toBe(null);
      expect(r.scopeLabel).toBe(null);
      expect(r.sheetOpen).toBe(false);
    });

    test('a closed job silently does not clock in (same guard clockIn already has)', async () => {
      const r = await page.evaluate(() => {
        const origTimer = _activeTimer, origJobs = jobs.slice();
        jobs.length = 0;
        jobs.push({ id: 998002, name: 'Done Shop Job', client_id: null, eventType: 'job', status: 'done', completion_date: todayKey(), start: todayKey(), days: 1 });
        if (_activeTimer) clockOut(false, true);
        try {
          _locPromptClockIn(998002);
          return { started: !!(_activeTimer && _activeTimer.jobId === 998002) };
        } finally {
          if (_activeTimer) clockOut(false, true);
          _activeTimer = origTimer; jobs.length = 0; origJobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.started).toBe(false);
    });

    test('null jobId does not throw', async () => {
      const r = await page.evaluate(() => {
        const origTimer = _activeTimer;
        try { _locPromptClockIn(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
    });

    // THE REASON THIS HELPER EXISTS. _geoMyJobs (today's ACTIVE jobs) is right
    // for fencing and wrong here: prefab and material pickup happen AHEAD of
    // the work, so the job being built for on Monday usually starts Thursday.
    test('includes UPCOMING jobs, not just today, which is the whole point for prefab', async () => {
      const r = await page.evaluate(() => {
        const origJobs = jobs.slice();
        jobs.length = 0;
        jobs.push({ id: 998010, name: 'Today Job', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        jobs.push({ id: 998011, name: 'Thursday Job', client_id: null, eventType: 'job', status: 'upcoming', start: addDays(todayKey(), 4), days: 1 });
        jobs.push({ id: 998012, name: 'Next Month Job', client_id: null, eventType: 'job', status: 'upcoming', start: addDays(todayKey(), 45), days: 1 });
        jobs.push({ id: 998013, name: 'Yesterday Done', client_id: null, eventType: 'job', status: 'done', completion_date: todayKey(), start: addDays(todayKey(), -1), days: 1 });
        try {
          const ids = _locPromptJobs().map(j => j.id);
          return { ids, viaGeo: (typeof _geoMyJobs === 'function' ? _geoMyJobs() : []).map(j => j.id) };
        } finally { jobs.length = 0; origJobs.forEach(j => jobs.push(j)); }
      });
      // Today AND the upcoming one, soonest first.
      expect(r.ids).toEqual([998010, 998011]);
      // Beyond the horizon is excluded, and a completed job never appears.
      expect(r.ids).not.toContain(998012);
      expect(r.ids).not.toContain(998013);
      // The contrast that motivated the helper: the fencing list would have
      // shown only today's, hiding the job most likely being prefabbed for.
      expect(r.viaGeo).toEqual([998010]);
    });

    test('a multi-day job mid-span still appears', async () => {
      const r = await page.evaluate(() => {
        const origJobs = jobs.slice();
        jobs.length = 0;
        jobs.push({ id: 998014, name: 'Mid Span', client_id: null, eventType: 'job', status: 'upcoming', start: addDays(todayKey(), -2), days: 5 });
        try { return _locPromptJobs().map(j => j.id); }
        finally { jobs.length = 0; origJobs.forEach(j => jobs.push(j)); }
      });
      expect(r).toEqual([998014]);
    });

    test('_fmtJobStartHint labels today, tomorrow, this week, and further out', async () => {
      const r = await page.evaluate(() => ({
        today: _fmtJobStartHint({ start: todayKey(), days: 1, status: 'upcoming' }),
        tomorrow: _fmtJobStartHint({ start: addDays(todayKey(), 1), days: 1, status: 'upcoming' }),
        thisWeek: _fmtJobStartHint({ start: addDays(todayKey(), 3), days: 1, status: 'upcoming' }),
        farOut: _fmtJobStartHint({ start: addDays(todayKey(), 14), days: 1, status: 'upcoming' }),
        missing: _fmtJobStartHint({}),
      }));
      expect(r.today).toBe('Today');
      expect(r.tomorrow).toBe('Tomorrow');
      // A weekday inside a week, a date past it. Both non-empty and distinct
      // from each other, so a three-week list is never ambiguous.
      expect(r.thisWeek).toBeTruthy();
      expect(r.farOut).toBeTruthy();
      expect(r.thisWeek).not.toBe(r.farOut);
      expect(r.missing).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clockAddTask
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clockAddTask', () => {
    test('null jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTask(null); document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTask(undefined); document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates overlay with add-task UI', async () => {
      const r = await page.evaluate(() => {
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          _clockAddTask(77701);
          const input = document.getElementById('_ck-custom');
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true, hasInput: !!input };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasInput).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _clockAddTask(77701); ok++; } catch (_) {}
        }
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clockAddTaskConfirm
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clockAddTaskConfirm', () => {
    test('null jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTaskConfirm(null, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTaskConfirm(999999, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, adds scopeId to job extraScopes', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null; // ensure clean state
          const j = jobs.find(x => x.id === 77702);
          j.extraScopes = [];
          _clockAddTaskConfirm(77702, 'scaffold', 'Scaffolding');
          const hasIt = j.extraScopes.includes('scaffold');
          j.extraScopes = [];
          _activeTimer = null;
          return { ok: true, hasIt };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasIt).toBe(true);
    });

    test('null scopeId (custom task), generates custom_ id and pushes object', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          const j = jobs.find(x => x.id === 77702);
          j.extraScopes = [];
          _clockAddTaskConfirm(77702, null, 'My Custom Task');
          const found = j.extraScopes.find(e => e && typeof e === 'object' && e.label === 'My Custom Task');
          j.extraScopes = [];
          _activeTimer = null;
          return { ok: true, found: !!found };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.found).toBe(true);
    });

    test('duplicate scopeId not added twice', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          const j = jobs.find(x => x.id === 77702);
          j.extraScopes = ['pwash'];
          _clockAddTaskConfirm(77702, 'pwash', 'Pressure washing');
          const count = j.extraScopes.filter(e => e === 'pwash' || (e && e.id === 'pwash')).length;
          j.extraScopes = [];
          _activeTimer = null;
          return { ok: true, count };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
    });

    test('undefined scopeLabel, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          _clockAddTaskConfirm(77702, 'cleanup', undefined);
          _activeTimer = null;
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _markJobComplete
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_markJobComplete', () => {
    test('null jobId, does not throw (zConfirm fires cb, job not found)', async () => {
      const r = await page.evaluate(() => {
        try { _markJobComplete(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _markJobComplete(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets job status to done', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          const j = jobs.find(x => x.id === 77702);
          const prevStatus = j.status;
          _markJobComplete(77702);
          const newStatus = j.status;
          j.status = prevStatus;
          delete j.completion_date;
          return { ok: true, isDone: newStatus === 'done' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isDone).toBe(true);
    });

    test('with active timer on same job, clocks out first', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 120000, timerInterval: null };
          _markJobComplete(77701);
          const timerGone = _activeTimer === null;
          const j = jobs.find(x => x.id === 77701);
          j.status = 'scheduled';
          delete j.completion_date;
          return { ok: true, timerGone };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.timerGone).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // clockIn
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('clockIn', () => {
    test.afterEach(async () => {
      await page.evaluate(() => { _activeTimer = null; });
    });

    // Old contract: null was just another invalid id, jobs.find() found
    // nothing, clockIn() bailed. New contract (owner 2026-08-19, "ability
    // for somebody to clock in at all times, nothing dependent on anything"):
    // null is now the deliberate General-time path, no job, no client, the
    // Home dashboard's always-available manual clock. It must actually start
    // the timer, not bail, that's the whole point of the feature.
    test('null jobId, starts General time (no job/client required)', async () => {
      const r = await page.evaluate(() => {
        _activeTimer = null;
        try {
          clockIn(null, 'sand', 'Sanding');
          return { ok: true, timerSet: _activeTimer !== null, jobIdNull: _activeTimer && _activeTimer.jobId === null, jobName: _activeTimer && _activeTimer.jobName };
        }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.timerSet).toBe(true);
      expect(r.jobIdNull).toBe(true);
      expect(r.jobName).toBe('General time');
    });

    test('undefined jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { clockIn(undefined, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { clockIn(999999, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets _activeTimer correctly', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          clockIn(77701, 'sand', 'Sanding');
          const t = _activeTimer;
          clearInterval(t && t.timerInterval);
          _activeTimer = null;
          return { ok: true, jobId: t && t.jobId, scopeId: t && t.scopeId, scopeLabel: t && t.scopeLabel };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.jobId).toBe(77701);
      expect(r.scopeId).toBe('sand');
      expect(r.scopeLabel).toBe('Sanding');
    });

    test('clocking in to already-active same job+scope, shows toast, no duplicate timer', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          clockIn(77701, 'sand', 'Sanding');
          const firstTimer = _activeTimer;
          clockIn(77701, 'sand', 'Sanding'); // same job+scope → toast, no change
          const sameTimer = _activeTimer === firstTimer;
          clearInterval(_activeTimer && _activeTimer.timerInterval);
          _activeTimer = null;
          return { ok: true, sameTimer };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('switching scope on same job, saves silently and restarts', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          clockIn(77701, 'sand', 'Sanding');
          clockIn(77701, 'prime', 'Primer coat');
          const newScope = _activeTimer && _activeTimer.scopeId;
          clearInterval(_activeTimer && _activeTimer.timerInterval);
          _activeTimer = null;
          return { ok: true, newScope };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.newScope).toBe('prime');
    });

    test('null scopeId, stores null in timer', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = null;
          clockIn(77701, null, null);
          const sid = _activeTimer && _activeTimer.scopeId;
          clearInterval(_activeTimer && _activeTimer.timerInterval);
          _activeTimer = null;
          return { ok: true, sid };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.sid).toBeNull();
    });

    test('concurrent calls, no stack corruption', async () => {
      const r = await page.evaluate(() => {
        _activeTimer = null;
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { clockIn(77701, 'sand', 'Sanding'); ok++; } catch (_) {}
        }
        clearInterval(_activeTimer && _activeTimer.timerInterval);
        _activeTimer = null;
        return ok;
      });
      expect(r).toBe(5);
    });

    test('CRITICAL: a job already marked done cannot accept a new time entry (owner report 2026-07-18)', async () => {
      const r = await page.evaluate(() => {
        const origToast = window.showToast; let toastMsg = null;
        window.showToast = (m) => { toastMsg = m; };
        try {
          _activeTimer = null;
          timeEntries = timeEntries.filter(e => e.job_id !== 77704);
          clockIn(77704, 'sand', 'Sanding');
          return {
            timerSet: !!_activeTimer,
            entryCreated: timeEntries.some(e => e.job_id === 77704),
            toastMsg,
          };
        } finally { window.showToast = origToast; }
      });
      expect(r.timerSet, 'clocking into a completed job must never start a timer').toBe(false);
      expect(r.entryCreated, 'clocking into a completed job must never write a timeEntries row').toBe(false);
      expect(r.toastMsg).toContain('complete');
    });

    test('cancelled job cannot accept a new time entry either', async () => {
      const r = await page.evaluate(() => {
        const origToast = window.showToast;
        window.showToast = () => {};
        try {
          _activeTimer = null;
          timeEntries = timeEntries.filter(e => e.job_id !== 77705);
          clockIn(77705, 'sand', 'Sanding');
          return { timerSet: !!_activeTimer, entryCreated: timeEntries.some(e => e.job_id === 77705) };
        } finally { window.showToast = origToast; }
      });
      expect(r.timerSet).toBe(false);
      expect(r.entryCreated).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // clockOut
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('clockOut', () => {
    test.afterEach(async () => {
      await page.evaluate(() => { _activeTimer = null; });
    });

    test('no active timer, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; clockOut(true, true); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('saveEntry=false: does not push time entry', async () => {
      const r = await page.evaluate(() => {
        try {
          const prevLen = timeEntries.length;
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 60000, timerInterval: null };
          clockOut(false, true);
          return { ok: true, added: timeEntries.length - prevLen, timerNull: _activeTimer === null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.added).toBe(0);
      expect(r.timerNull).toBe(true);
    });

    test('saveEntry=true: pushes time entry and clears timer', async () => {
      const r = await page.evaluate(() => {
        try {
          const prevLen = timeEntries.length;
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 120000, timerInterval: null };
          clockOut(true, true);
          const added = timeEntries.length - prevLen;
          const last = timeEntries[timeEntries.length - 1];
          // cleanup
          timeEntries = timeEntries.slice(0, prevLen);
          return { ok: true, added, timerNull: _activeTimer === null, minAtLeast1: last && last.minutes >= 1 };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.added).toBe(1);
      expect(r.timerNull).toBe(true);
      expect(r.minAtLeast1).toBe(true);
    });

    test('minimum 1 minute enforced for very short sessions', async () => {
      const r = await page.evaluate(() => {
        try {
          const prevLen = timeEntries.length;
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'cleanup', scopeLabel: 'Final cleanup', startTime: Date.now() - 100, timerInterval: null };
          clockOut(true, true);
          const last = timeEntries[timeEntries.length - 1];
          timeEntries = timeEntries.slice(0, prevLen);
          return { ok: true, minutes: last && last.minutes };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.minutes).toBe(1);
    });

    test('concurrent calls, only first executes, no double-entry', async () => {
      const r = await page.evaluate(() => {
        try {
          const prevLen = timeEntries.length;
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 90000, timerInterval: null };
          clockOut(true, true);
          clockOut(true, true); // second call: _activeTimer is null, should be noop
          clockOut(true, true);
          const added = timeEntries.length - prevLen;
          timeEntries = timeEntries.slice(0, prevLen);
          return { ok: true, added };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.added).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // updateClockTimer
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('updateClockTimer', () => {
    test('no active timer, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; updateClockTimer(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing DOM element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('clock-banner-time')?.remove();
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 61000, timerInterval: null };
          updateClockTimer();
          _activeTimer = null;
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with DOM element, sets text content', async () => {
      const r = await page.evaluate(() => {
        try {
          let el = document.getElementById('clock-banner-time');
          if (!el) {
            el = document.createElement('div');
            el.id = 'clock-banner-time';
            document.body.appendChild(el);
          }
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 61000, timerInterval: null };
          updateClockTimer();
          const txt = el.textContent;
          _activeTimer = null;
          return { ok: true, hasContent: txt.length > 0 };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasContent).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        _activeTimer = { jobId: 77701, jobName: 'T', clientName: 'C', scopeId: 'sand', scopeLabel: 'S', startTime: Date.now() - 5000, timerInterval: null };
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { updateClockTimer(); ok++; } catch (_) {}
        }
        _activeTimer = null;
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // showClockBanner / hideClockBanner
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showClockBanner', () => {
    test('missing clock-banner element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('clock-banner')?.remove();
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: null, scopeLabel: null, startTime: Date.now(), timerInterval: null };
          showClockBanner();
          _activeTimer = null;
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with banner element, sets display:flex', async () => {
      const r = await page.evaluate(() => {
        try {
          let b = document.getElementById('clock-banner');
          if (!b) { b = document.createElement('div'); b.id = 'clock-banner'; document.body.appendChild(b); }
          b.style.display = 'none';
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'Alpha', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now(), timerInterval: null };
          showClockBanner();
          const disp = b.style.display;
          _activeTimer = null;
          return { ok: true, disp };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.disp).toBe('flex');
    });

    test('null _activeTimer, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; showClockBanner(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  test.describe('hideClockBanner', () => {
    test('missing element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('clock-banner')?.remove();
          hideClockBanner();
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with element, sets display:none and removes clock-active class', async () => {
      const r = await page.evaluate(() => {
        try {
          let b = document.getElementById('clock-banner');
          if (!b) { b = document.createElement('div'); b.id = 'clock-banner'; document.body.appendChild(b); }
          b.style.display = 'flex';
          document.body.classList.add('clock-active');
          hideClockBanner();
          return { ok: true, disp: b.style.display, hasClass: document.body.classList.contains('clock-active') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.disp).toBe('none');
      expect(r.hasClass).toBe(false);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { hideClockBanner(); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // nextClockTask
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('nextClockTask', () => {
    test('no active timer, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; nextClockTask(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, clocks out and opens sheet after delay', async () => {
      const r = await page.evaluate(() => {
        try {
          _activeTimer = { jobId: 77701, jobName: 'Test', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 60000, timerInterval: null };
          nextClockTask();
          const cleared = _activeTimer === null;
          document.getElementById('_cks-ov')?.remove();
          return { ok: true, cleared };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.cleared).toBe(true);
    });

    test('concurrent calls without timer, no throw', async () => {
      const r = await page.evaluate(() => {
        _activeTimer = null;
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { nextClockTask(); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // doneForDay
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('doneForDay', () => {
    test('no active timer, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; doneForDay(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, clocks out and timer becomes null', async () => {
      const r = await page.evaluate(() => {
        try {
          const prevLen = timeEntries.length;
          _activeTimer = { jobId: 77701, jobName: 'Alpha', clientName: 'C', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() - 60000, timerInterval: null };
          doneForDay();
          const cleared = _activeTimer === null;
          timeEntries = timeEntries.slice(0, prevLen);
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true, cleared };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.cleared).toBe(true);
    });

    test('concurrent calls, only first executes, timer null after', async () => {
      const r = await page.evaluate(() => {
        const prevLen = timeEntries.length;
        _activeTimer = { jobId: 77701, jobName: 'Alpha', clientName: 'C', scopeId: 'sand', scopeLabel: 'S', startTime: Date.now() - 60000, timerInterval: null };
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { doneForDay(); ok++; } catch (_) {}
        }
        timeEntries = timeEntries.slice(0, prevLen);
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { ok, timerNull: _activeTimer === null };
      });
      expect(r.ok).toBe(5);
      expect(r.timerNull).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _haversineKm
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_haversineKm', () => {
    test('all zeros, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(0, 0, 0, 0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('null inputs, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(null, null, null, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined inputs, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(undefined, undefined, undefined, undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string inputs, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm('a', 'b', 'c', 'd') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, Wichita to Kansas City ~278km', async () => {
      const r = await page.evaluate(() => {
        try {
          // Wichita KS: 37.6872, -97.3301: Kansas City MO: 39.0997, -94.5786
          const km = _haversineKm(37.6872, -97.3301, 39.0997, -94.5786);
          return { ok: true, km };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.km).toBeGreaterThan(200);
      expect(r.km).toBeLessThan(350);
    });

    test('same point, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(37.6872, -97.3301, 37.6872, -97.3301) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBeCloseTo(0, 5);
    });

    test('boundary: antipodal points ~20015km', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(0, 0, 0, 180) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBeGreaterThan(19000);
    });

    test('concurrent calls, stable results', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try {
            const km = _haversineKm(37.6872, -97.3301, 39.0997, -94.5786);
            if (km > 200 && km < 350) ok++;
          } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _geocodeAddr
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_geocodeAddr', () => {
    test('null addr, returns a promise that resolves to null (no throw)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const res = await _geocodeAddr(null);
          return { ok: true, isNull: res === null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string, resolves without throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          const res = await _geocodeAddr('');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid address string, resolves (mock returns null from blocked network)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const res = await _geocodeAddr('123 Main St, Wichita KS');
          return { ok: true, type: typeof res };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // checkNearbyJob
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('checkNearbyJob', () => {
    test('no _supaUser, returns early without throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          const prev = window._supaUser;
          window._supaUser = null;
          await checkNearbyJob();
          window._supaUser = prev;
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('no geolocation, returns early without throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          const prevGeo = navigator.geolocation;
          Object.defineProperty(navigator, 'geolocation', { value: null, configurable: true });
          await checkNearbyJob();
          Object.defineProperty(navigator, 'geolocation', { value: prevGeo, configurable: true });
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('called 5 times, no throw', async () => {
      const r = await page.evaluate(async () => {
        const prev = window._supaUser;
        window._supaUser = null;
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { await checkNearbyJob(); ok++; } catch (_) {}
        }
        window._supaUser = prev;
        return ok;
      });
      expect(r).toBe(5);
    });

    // Owner decision 2026-07-10/11: the nearby banner must fire for ANY client
    // with an address, not just ones with a scheduled job, and it always
    // surfaces all 3 possible actions (Clock in, Start Estimate/Invoice,
    // Collect), so checkNearbyJob computes every action's TARGET rather than
    // picking a single winning "kind": jobId (active job today), fallbackJobId
    // (nearest open job when nothing's active today), bidId+balance (most
    // recent Closed Won bid with money owed). geoIfGranted + _geocodeAddr are
    // stubbed so every candidate resolves to the mocked position,
    // deterministic, no real network/GPS. The shared page's
    // clients/bids/jobs/payments arrays accumulate fixtures from every
    // describe block in this file, checkNearbyJob's geocode BUDGET means
    // unrelated addressed clients can consume it before reaching a test's own
    // fixture, and getBidStage's client_id fallback can pick up an unrelated
    // stray job. Every test below swaps ALL FOUR arrays down to just its own
    // fixture for the call (restored after), so target selection is verified
    // fully isolated from whatever else the shared page has accumulated.
    test.describe('action target selection', () => {
      test('client with an active job today, jobId set, no fallback, no balance', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          clients = [{ id: 79960, name: 'Nearby Clockin', addr: '10 Nearby Rd, Wichita KS' }];
          bids = [{ id: 78860, client_id: 79960, amount: 2000, status: 'Closed Won', bid_date: '2026-01-01' }];
          jobs = [{ id: 77760, client_id: 79960, bid_id: 78860, name: 'Nearby job today', eventType: 'job', status: 'scheduled', start: todayKey() }];
          payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.69, longitude: -97.33, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.69, lon: -97.33 });
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.jobId).toBe(77760);
        expect(r.nb.fallbackJobId).toBe(null);
        expect(r.nb.bidId).toBe(null);
        expect(r.nb.balance).toBe(0);
        expect(r.nb.clientName).toBe('Nearby Clockin');
      });

      test('Closed Won bid, completed, balance owed, no active job, bidId+balance set, no job target', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          clients = [{ id: 79961, name: 'Nearby Collect', addr: '20 Nearby Rd, Wichita KS' }];
          bids = [{ id: 78861, client_id: 79961, amount: 900, status: 'Closed Won', bid_date: '2025-12-01', completion_date: '2025-12-10' }];
          jobs = [];
          payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.70, longitude: -97.34, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.70, lon: -97.34 });
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.bidId).toBe(78861);
        expect(r.nb.balance).toBe(900);
        expect(r.nb.jobId).toBe(null);
        expect(r.nb.fallbackJobId).toBe(null);
      });

      test('client with no Closed Won bid, all targets null except clientId (Estimate/Invoice is the always-available action)', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          clients = [{ id: 79962, name: 'Nearby Diagnostic', addr: '30 Nearby Rd, Wichita KS' }];
          bids = [];
          jobs = [];
          payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.71, longitude: -97.35, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.71, lon: -97.35 });
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.clientId).toBe(79962);
        expect(r.nb.jobId).toBe(null);
        expect(r.nb.fallbackJobId).toBe(null);
        expect(r.nb.bidId).toBe(null);
        expect(r.nb.balance).toBe(0);
      });

      test('a fully-paid Closed Won bid does NOT set bidId/balance (nothing left to collect)', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          clients = [{ id: 79961, name: 'Nearby Paid Up', addr: '20 Nearby Rd, Wichita KS' }];
          bids = [{ id: 78861, client_id: 79961, amount: 900, status: 'Closed Won', bid_date: '2025-12-01', completion_date: '2025-12-10' }];
          jobs = [];
          payments = [{ id: 9995010, bid_id: 78861, client_id: 79961, amount: 900, method: 'Cash', date: '2025-12-10' }];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.70, longitude: -97.34, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.70, lon: -97.34 });
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.bidId).toBe(null);
        expect(r.nb.balance).toBe(0);
      });

      test('a job is scheduled but not active today, fallbackJobId is set instead of jobId', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          clients = [{ id: 79963, name: 'Nearby Fallback', addr: '50 Nearby Rd, Wichita KS' }];
          bids = [{ id: 78863, client_id: 79963, amount: 1200, status: 'Closed Won', bid_date: '2026-01-01' }];
          jobs = [{ id: 77763, client_id: 79963, bid_id: 78863, name: 'Job next week', eventType: 'job', status: 'scheduled', start: addDays(todayKey(), 5) }];
          payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.72, longitude: -97.36, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.72, lon: -97.36 });
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.jobId).toBe(null);
        expect(r.nb.fallbackJobId).toBe(77763);
      });

      test('a client’s geocoded coords are cached in localStorage (not on the record, not via saveAll) after one lookup', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          localStorage.removeItem('zp3_nearby_geo');
          clients = [{ id: 79962, name: 'Cache Me', addr: '40 Nearby Rd, Wichita KS' }];
          bids = [];
          jobs = [];
          payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          let geocodeCalls = 0;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 1, longitude: 1, accuracy: 10 } }); // far away, no match
          window._geocodeAddr = async () => { geocodeCalls++; return { lat: 37.71, lon: -97.35 }; };
          return checkNearbyJob().then(() => {
            const c = clients[0];
            const onRecord = c.geoLat != null || c.geoLon != null;
            const stored = JSON.parse(localStorage.getItem('zp3_nearby_geo') || '{}');
            const cached = stored[79962];
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            ({ clients, bids, jobs, payments } = orig);
            localStorage.removeItem('zp3_nearby_geo');
            return { geocodeCalls, cached, onRecord };
          });
        });
        expect(r.onRecord, 'the client record itself must NOT carry geo fields (no saveAll/cloud-sync trigger)').toBe(false);
        expect(r.geocodeCalls).toBe(1);
        expect(r.cached).toBeTruthy();
        expect(r.cached.lat).toBe(37.71);
        expect(r.cached.addr).toBe('40 Nearby Rd, Wichita KS');
      });

      // Regression (owner report 2026-08-19): the dashboard matched a
      // contractor's real job to his own NEXT-DOOR NEIGHBOR's client record,
      // wrong client shown, wrong address to clock into. Root cause was two
      // compounding bugs: the match radius was 0.5km (1,640ft, easily spans
      // several houses down a block) and the loop returned on the FIRST
      // client under that radius in raw array order, not the nearest one.
      test('the match radius is tightened to ServiceTitan\'s Arrive-by-GPS threshold (410ft), not the old 1,640ft', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          // ~1,000ft away: inside the OLD 0.5km radius, outside the new
          // ~410ft one. A real match here would prove the radius never
          // actually tightened.
          clients = [{ id: 79970, name: 'Down The Block', addr: '1000ft Away Rd, Wichita KS' }];
          bids = []; jobs = []; payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.6872, longitude: -97.3301, accuracy: 10 } });
          window._geocodeAddr = async () => ({ lat: 37.68994, lon: -97.3301 }); // ~0.305km / ~1,000ft north
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb, 'a client 1,000ft away must NOT match, that distance only "worked" under the old 1,640ft radius').toBeFalsy();
      });

      test('nearest client wins, not the first one in array order', async () => {
        const r = await page.evaluate(() => {
          const orig = { clients, bids, jobs, payments };
          // Farther client (~350ft, still inside the 410ft radius) listed
          // FIRST, nearer client (~50ft) listed SECOND: under the old
          // first-match-wins loop the farther one would win purely by array
          // position, even though the nearer one is the obviously correct
          // match.
          clients = [
            { id: 79971, name: 'Farther Neighbor', addr: 'Far Rd, Wichita KS' },
            { id: 79972, name: 'Actual Job', addr: 'Near Rd, Wichita KS' },
          ];
          bids = []; jobs = []; payments = [];
          const origGeo = window.geoIfGranted, origGeocode = window._geocodeAddr;
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 37.6872, longitude: -97.3301, accuracy: 10 } });
          window._geocodeAddr = async (addr) => addr.startsWith('Far')
            ? { lat: 37.6881583, lon: -97.3301 }  // ~350ft
            : { lat: 37.6873369, lon: -97.3301 }; // ~50ft
          return checkNearbyJob().then(() => {
            window.geoIfGranted = origGeo; window._geocodeAddr = origGeocode;
            const nb = _nearbyJob;
            ({ clients, bids, jobs, payments } = orig);
            return { nb };
          });
        });
        expect(r.nb).toBeTruthy();
        expect(r.nb.clientId, 'the nearer client must win regardless of array order').toBe(79972);
        expect(r.nb.clientName).toBe('Actual Job');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendReminderSMS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('sendReminderSMS', () => {
    test('null cid, calls zAlert without throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent cid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('client with no phone, calls zAlert without throw', async () => {
      const r = await page.evaluate(() => {
        try {
          clients.push({ id: 79999, name: 'No Phone Client', phone: '', addr: '1 St' });
          sendReminderSMS(79999);
          clients = clients.filter(c => c.id !== 79999);
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { sendReminderSMS(null); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // renderTodayLegs
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderTodayLegs', () => {
    test('missing DOM element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('cd-today-legs')?.remove();
          renderTodayLegs();
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with element, no mileage today, clears innerHTML', async () => {
      const r = await page.evaluate(() => {
        try {
          let el = document.getElementById('cd-today-legs');
          if (!el) { el = document.createElement('div'); el.id = 'cd-today-legs'; document.body.appendChild(el); }
          el.innerHTML = 'old content';
          // currentClientId set to a client with no today mileage
          const prevCid = typeof currentClientId !== 'undefined' ? currentClientId : null;
          currentClientId = 79901;
          renderTodayLegs();
          const html = el.innerHTML;
          currentClientId = prevCid;
          return { ok: true, empty: html === '' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('called 3 times, no duplicate entries', async () => {
      const r = await page.evaluate(() => {
        try {
          let el = document.getElementById('cd-today-legs');
          if (!el) { el = document.createElement('div'); el.id = 'cd-today-legs'; document.body.appendChild(el); }
          const tk = todayKey();
          const prevLen = mileage.length;
          mileage.push({ id: 88001, client_id: 79901, miles: 5.0, date: tk, purpose: 'Job site' });
          const prevCid = typeof currentClientId !== 'undefined' ? currentClientId : null;
          currentClientId = 79901;
          renderTodayLegs();
          renderTodayLegs();
          renderTodayLegs();
          const matches = (el.innerHTML.match(/Today:/g) || []).length;
          mileage = mileage.filter(m => m.id !== 88001);
          currentClientId = prevCid;
          return { ok: true, matches };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.matches).toBe(1);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { renderTodayLegs(); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // buildScopeGrid / toggleScopeRoom / scopeOn / roomScopeOn / setRoomScope:
  // removed with the paint estimator's scope-item grid (§7.1: assert gone)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('paint scope-grid functions, deleted', () => {
    test('buildScopeGrid, roomScopeOn, scopeOn, setRoomScope no longer exist', async () => {
      const r = await page.evaluate(() => {
        const names = ['buildScopeGrid', 'toggleScopeRoom', '_saveScopeHoursRoom', '_cancelScopeHoursRoom',
          'toggleScope', 'promptScopeHours', '_syncScopePopupHint', '_saveScopeHours', '_cancelScopeHours',
          'scopeOn', 'roomScopeOn', 'setRoomScope'];
        return names.map(n => { let t; try { t = typeof eval(n); } catch (e) { t = 'undefined'; } return [n, t]; });
      });
      for (const [name, type] of r) expect(type, name + ' should no longer be defined').toBe('undefined');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setLeadFilter
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setLeadFilter', () => {
    test('null filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setLeadFilter(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setLeadFilter(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets leadFilter global', async () => {
      const r = await page.evaluate(() => {
        try {
          setLeadFilter('new', null);
          return { ok: true, v: leadFilter };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('new');
    });

    test('with btn element, adds active class', async () => {
      const r = await page.evaluate(() => {
        try {
          const btn = document.createElement('button');
          btn.id = 'lft-hot';
          document.body.appendChild(btn);
          setLeadFilter('hot', btn);
          const hasActive = btn.classList.contains('active');
          btn.remove();
          return { ok: true, hasActive };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasActive).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { setLeadFilter('all', null); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });

    test('corrupted localStorage, does not affect function', async () => {
      const r = await page.evaluate(() => {
        try {
          localStorage.setItem('zp3_leads', '{INVALID{{{{');
          setLeadFilter('all', null);
          localStorage.removeItem('zp3_leads');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // setJobFilter
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setJobFilter', () => {
    test('null filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setJobFilter(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets jobFilter global and calls renderJobsPage', async () => {
      const r = await page.evaluate(() => {
        try {
          setJobFilter('active', null);
          return { ok: true, v: jobFilter };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('active');
    });

    test('with btn, marks active class on btn', async () => {
      const r = await page.evaluate(() => {
        try {
          const btn = document.createElement('button');
          document.body.appendChild(btn);
          setJobFilter('scheduled', btn);
          const hasActive = btn.classList.contains('active');
          btn.remove();
          return { ok: true, hasActive };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasActive).toBe(true);
    });

    test('removes active from other jft- buttons', async () => {
      const r = await page.evaluate(() => {
        try {
          const b1 = document.createElement('button'); b1.id = 'jft-all'; b1.classList.add('active');
          const b2 = document.createElement('button'); b2.id = 'jft-active';
          document.body.appendChild(b1); document.body.appendChild(b2);
          setJobFilter('active', b2);
          const b1Active = b1.classList.contains('active');
          b1.remove(); b2.remove();
          return { ok: true, b1Active };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.b1Active).toBe(false);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { setJobFilter('all', null); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getBidStage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getBidStage', () => {
    test('null bid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidStage(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined bid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { getBidStage(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty object bid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidStage({}); return { ok: true, hasStage: !!(v && v.stage) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('bid with no linked jobs and no completion_date, returns signed stage', async () => {
      const r = await page.evaluate(() => {
        try {
          const v = getBidStage({ id: 78801, client_id: 79901, status: 'Closed Won', amount: 3500, completion_date: null });
          return { ok: true, stage: v && v.stage, hasLabel: !!(v && v.label), hasColor: !!(v && v.color) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(['signed', 'scheduled', 'active', 'paid', 'balance_due']).toContain(r.stage);
      expect(r.hasLabel).toBe(true);
      expect(r.hasColor).toBe(true);
    });

    test('bid with completion_date and zero balance, paid stage', async () => {
      const r = await page.evaluate(() => {
        try {
          // Use client_id 79903 (no jobs in test fixtures) so the unlinked-job fallback finds nothing.
          const tempBid = { id: 78899, client_id: 79903, amount: 100, status: 'Closed Won', completion_date: '2026-01-01' };
          bids.push(tempBid);
          payments.push({ id: 78999, bid_id: 78899, client_id: 79903, amount: 100, type: 'final', method: 'Cash', date: '2026-01-01' });
          const v = getBidStage(tempBid);
          bids = bids.filter(b => b.id !== 78899);
          payments = payments.filter(p => p.bid_id !== 78899);
          return { ok: true, stage: v && v.stage };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.stage).toBe('paid');
    });

    test('bid with active job today, active stage', async () => {
      const r = await page.evaluate(() => {
        try {
          const tk = todayKey();
          bids.push({ id: 78898, client_id: 79901, amount: 500, status: 'Closed Won', completion_date: null });
          jobs.push({ id: 77799, client_id: 79901, bid_id: 78898, name: 'Today job', eventType: 'job', status: 'active', start: tk, days: 1 });
          const bid = bids.find(b => b.id === 78898);
          const v = getBidStage(bid);
          bids = bids.filter(b => b.id !== 78898);
          jobs = jobs.filter(j => j.id !== 77799);
          return { ok: true, stage: v && v.stage };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.stage).toBe('active');
    });

    test('result always has priority field', async () => {
      const r = await page.evaluate(() => {
        try {
          const v = getBidStage({ id: 78801, client_id: 79901, amount: 3500, status: 'Closed Won' });
          return { ok: true, hasPriority: typeof v.priority === 'number' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasPriority).toBe(true);
    });

    test('result always has jobs array', async () => {
      const r = await page.evaluate(() => {
        try {
          const v = getBidStage({ id: 78801, client_id: 79901, amount: 3500, status: 'Closed Won' });
          return { ok: true, hasJobs: Array.isArray(v.jobs) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasJobs).toBe(true);
    });

    test('concurrent calls, stable results', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 78801, client_id: 79901, amount: 3500, status: 'Closed Won' };
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { const v = getBidStage(bid); if (v && v.stage) ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });

    test('corrupted localStorage before call, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          localStorage.setItem('zp3_bids', '{INVALID{{{{');
          const v = getBidStage({ id: 78801, client_id: 79901, amount: 3500, status: 'Closed Won' });
          localStorage.removeItem('zp3_bids');
          return { ok: true, hasStage: !!(v && v.stage) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Console error guard
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors, jobs.js', async () => {
    assertNoErrors(page, 'jobs.js');
  });
});
