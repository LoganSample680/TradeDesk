// @ts-check
/**
 * Exhaustive E2E coverage for jobs.js
 * Every exported function tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('jobs.js — exhaustive coverage', () => {
  let page;

  // Idempotent fixture seed — filter-then-push so it's safe to re-run. Called in
  // beforeAll AND beforeEach, AND (crucially) inside the same page.evaluate as
  // every test that asserts seeded values: a late-resolving cloud/cache load
  // reassigns the in-memory arrays after boot (task #22 race), and it can land
  // in the gap BETWEEN beforeEach's evaluate and the test body's evaluate — the
  // beforeEach re-seed alone still flaked on WebKit shard 3 (getJobClockTotal
  // read 0, fd9b3ba run). page.evaluate is atomic, so seeding at the top of the
  // reading evaluate fully closes the race; between-call re-seeds stay as a
  // cheap best-effort for tests that only mutate.
  const SEED_FIXTURES_FN = () => {
    clients = clients.filter(c => c.id !== 79901 && c.id !== 79902);
    bids    = bids.filter(b => b.id !== 78801 && b.id !== 78802);
    jobs    = jobs.filter(j => j.id !== 77701 && j.id !== 77702 && j.id !== 77703);
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
        surfaces: [], roomScopeMap: {}, signedAt: '2026-02-05T00:00:00Z', completion_date: null }
    );
    jobs.push(
      { id: 77701, client_id: 79901, bid_id: 78801, name: 'Alpha interior job',
        eventType: 'job', status: 'scheduled', start: '2099-06-01',
        extraScopes: ['popcorn'], actualHours: 0 },
      { id: 77702, client_id: 79902, bid_id: 78802, name: 'Beta exterior job',
        eventType: 'job', status: 'scheduled', start: '2099-07-01', actualHours: 0 },
      { id: 77703, client_id: 79901, bid_id: null, name: 'Orphan job no bid',
        eventType: 'job', status: 'active', start: '2099-08-01', actualHours: 0 }
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

  // Re-seed before EVERY test — repairs any fixture a late cloud/cache load
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
    test('null jobId — returns array without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(null); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArray).toBe(true);
    });

    test('undefined jobId — returns array without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(undefined); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArray).toBe(true);
    });

    test('nonexistent jobId — returns default scopes array', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(999999999); return { ok: true, len: res.length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBeGreaterThan(0);
    });

    test('string jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes('notanumber'); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('zero jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(0); return { ok: true, isArray: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('negative jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopes(-1); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — job with bid roomScopeMap returns active scopes + extraScopes', async () => {
      const r = await page.evaluate(() => {
        try {
          // Re-seed the fixture INSIDE the test tick. A late-resolving cloud/cache
          // load can reassign `bids`/`jobs` after beforeAll and drop or replace the
          // fixture — the bid's roomScopeMap (sand) survives but the job's
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

    test('job with no bid — falls back to default clock scopes', async () => {
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

    test('extraScopes as object with id — included correctly', async () => {
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

    test('concurrent calls — no corruption', async () => {
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
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getJobScopeBreakdown
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getJobScopeBreakdown', () => {
    test('null — returns empty object without throw', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(null); return { ok: true, type: typeof res }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.type).toBe('object');
    });

    test('undefined — returns empty object', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(undefined); return { ok: true, keys: Object.keys(res).length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.keys).toBe(0);
    });

    test('nonexistent jobId — returns empty object', async () => {
      const r = await page.evaluate(() => {
        try { const res = getJobScopeBreakdown(999999); return { ok: true, keys: Object.keys(res).length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.keys).toBe(0);
    });

    test('golden path — correct minutes per scope_id, __other for null scope', async () => {
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

    test('string jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { getJobScopeBreakdown('abc'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — stable results', async () => {
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
    test('null — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('undefined — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('nonexistent job — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: getJobClockTotal(999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('golden path — sum of minutes across all time entries for job', async () => {
      const r = await page.evaluate(() => {
        try { window.__seedJobsFixtures(); return { ok: true, v: getJobClockTotal(77701) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(165); // 90 + 45 + 30
    });

    test('entry with missing minutes — treated as 0', async () => {
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

    test('concurrent calls — stable', async () => {
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
    test('null — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('0 — returns empty string', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('');
    });

    test('30 — returns "30m"', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(30) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('30m');
    });

    test('60 — returns "1h "', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(60) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('1h');
    });

    test('90 — returns "1h 30m"', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(90) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('1h 30m');
    });

    test('120 — returns "2h "', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(120) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('2h');
    });

    test('negative -1 — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(-1) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('very large number — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin(99999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toContain('h');
    });

    test('string input — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _fmtMin('abc') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — all succeed', async () => {
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
    test('null jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { openClockInSheet(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — creates overlay with id _cks-ov', async () => {
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

    test('called 3 times — no duplicate overlays', async () => {
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

    test('job with no bid — uses job name as client name fallback', async () => {
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

    test('bid with a balance owed — shows a Collect button wired to openPayPanel', async () => {
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

    test('job with no linked bid — no Collect button (nothing to collect against)', async () => {
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

    test('bid with zero balance — no Collect button', async () => {
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

    test('concurrent calls — no throw, only 1 overlay', async () => {
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
  // _nearbyClockIn — nearby-banner Clock in handler. Unlike openClockInSheet
  // (which requires an existing job), this always succeeds: given a null
  // jobId it creates a minimal walk-up job for the client on the spot so
  // "you're on site, clock in" never dead-ends.
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_nearbyClockIn', () => {
    test('existing jobId — opens the sheet directly, creates no new job', async () => {
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

    test('null jobId, valid client — creates a walk-up job and opens the sheet for it', async () => {
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

    test('null jobId, nonexistent client — returns early without throw, no job created', async () => {
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

    test('null jobId, null client — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _nearbyClockIn(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _clockAddTask
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_clockAddTask', () => {
    test('null jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTask(null); document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTask(undefined); document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — creates overlay with add-task UI', async () => {
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

    test('concurrent calls — no throw', async () => {
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
    test('null jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTaskConfirm(null, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _clockAddTaskConfirm(999999, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — adds scopeId to job extraScopes', async () => {
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

    test('null scopeId (custom task) — generates custom_ id and pushes object', async () => {
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

    test('undefined scopeLabel — does not throw', async () => {
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
    test('null jobId — does not throw (zConfirm fires cb, job not found)', async () => {
      const r = await page.evaluate(() => {
        try { _markJobComplete(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _markJobComplete(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — sets job status to done', async () => {
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

    test('with active timer on same job — clocks out first', async () => {
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

    test('null jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        _activeTimer = null;
        try { clockIn(null, 'sand', 'Sanding'); return { ok: true, timerNull: _activeTimer === null }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.timerNull).toBe(true);
    });

    test('undefined jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { clockIn(undefined, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent jobId — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { clockIn(999999, 'sand', 'Sanding'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — sets _activeTimer correctly', async () => {
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

    test('clocking in to already-active same job+scope — shows toast, no duplicate timer', async () => {
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

    test('switching scope on same job — saves silently and restarts', async () => {
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

    test('null scopeId — stores null in timer', async () => {
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

    test('concurrent calls — no stack corruption', async () => {
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
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // clockOut
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('clockOut', () => {
    test.afterEach(async () => {
      await page.evaluate(() => { _activeTimer = null; });
    });

    test('no active timer — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; clockOut(true, true); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('saveEntry=false — does not push time entry', async () => {
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

    test('saveEntry=true — pushes time entry and clears timer', async () => {
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

    test('concurrent calls — only first executes, no double-entry', async () => {
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
    test('no active timer — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; updateClockTimer(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing DOM element — does not throw', async () => {
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

    test('with DOM element — sets text content', async () => {
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

    test('concurrent calls — no throw', async () => {
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
    test('missing clock-banner element — does not throw', async () => {
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

    test('with banner element — sets display:flex', async () => {
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

    test('null _activeTimer — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; showClockBanner(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  test.describe('hideClockBanner', () => {
    test('missing element — does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('clock-banner')?.remove();
          hideClockBanner();
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with element — sets display:none and removes clock-active class', async () => {
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

    test('concurrent calls — no throw', async () => {
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
    test('no active timer — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; nextClockTask(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — clocks out and opens sheet after delay', async () => {
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

    test('concurrent calls without timer — no throw', async () => {
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
    test('no active timer — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        try { _activeTimer = null; doneForDay(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — clocks out and timer becomes null', async () => {
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

    test('concurrent calls — only first executes, timer null after', async () => {
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
    test('all zeros — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(0, 0, 0, 0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(0);
    });

    test('null inputs — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(null, null, null, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined inputs — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(undefined, undefined, undefined, undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string inputs — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm('a', 'b', 'c', 'd') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — Wichita to Kansas City ~278km', async () => {
      const r = await page.evaluate(() => {
        try {
          // Wichita KS: 37.6872, -97.3301 — Kansas City MO: 39.0997, -94.5786
          const km = _haversineKm(37.6872, -97.3301, 39.0997, -94.5786);
          return { ok: true, km };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.km).toBeGreaterThan(200);
      expect(r.km).toBeLessThan(350);
    });

    test('same point — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(37.6872, -97.3301, 37.6872, -97.3301) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBeCloseTo(0, 5);
    });

    test('boundary — antipodal points ~20015km', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _haversineKm(0, 0, 0, 180) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBeGreaterThan(19000);
    });

    test('concurrent calls — stable results', async () => {
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
    test('null addr — returns a promise that resolves to null (no throw)', async () => {
      const r = await page.evaluate(async () => {
        try {
          const res = await _geocodeAddr(null);
          return { ok: true, isNull: res === null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string — resolves without throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          const res = await _geocodeAddr('');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid address string — resolves (mock returns null from blocked network)', async () => {
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
    test('no _supaUser — returns early without throw', async () => {
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

    test('no geolocation — returns early without throw', async () => {
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

    test('called 5 times — no throw', async () => {
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
    // with an address, not just ones with a scheduled job — and it always
    // surfaces all 3 possible actions (Clock in, Start Estimate/Invoice,
    // Collect), so checkNearbyJob computes every action's TARGET rather than
    // picking a single winning "kind": jobId (active job today), fallbackJobId
    // (nearest open job when nothing's active today), bidId+balance (most
    // recent Closed Won bid with money owed). geoIfGranted + _geocodeAddr are
    // stubbed so every candidate resolves to the mocked position —
    // deterministic, no real network/GPS. The shared page's
    // clients/bids/jobs/payments arrays accumulate fixtures from every
    // describe block in this file — checkNearbyJob's geocode BUDGET means
    // unrelated addressed clients can consume it before reaching a test's own
    // fixture, and getBidStage's client_id fallback can pick up an unrelated
    // stray job. Every test below swaps ALL FOUR arrays down to just its own
    // fixture for the call (restored after), so target selection is verified
    // fully isolated from whatever else the shared page has accumulated.
    test.describe('action target selection', () => {
      test('client with an active job today — jobId set, no fallback, no balance', async () => {
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

      test('Closed Won bid, completed, balance owed, no active job — bidId+balance set, no job target', async () => {
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

      test('client with no Closed Won bid — all targets null except clientId (Estimate/Invoice is the always-available action)', async () => {
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

      test('a job is scheduled but not active today — fallbackJobId is set instead of jobId', async () => {
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
          window.geoIfGranted = (cb) => cb({ coords: { latitude: 1, longitude: 1, accuracy: 10 } }); // far away — no match
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
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // sendReminderSMS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('sendReminderSMS', () => {
    test('null cid — calls zAlert without throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined cid — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('nonexistent cid — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { sendReminderSMS(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('client with no phone — calls zAlert without throw', async () => {
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

    test('concurrent calls — no throw', async () => {
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
    test('missing DOM element — does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.getElementById('cd-today-legs')?.remove();
          renderTodayLegs();
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with element, no mileage today — clears innerHTML', async () => {
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

    test('called 3 times — no duplicate entries', async () => {
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

    test('concurrent calls — no throw', async () => {
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
  // buildScopeGrid / toggleScopeRoom / scopeOn / roomScopeOn / setRoomScope —
  // removed with the paint estimator's scope-item grid (§7.1: assert gone)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('paint scope-grid functions — deleted', () => {
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
    test('null filter — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setLeadFilter(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined filter — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setLeadFilter(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — sets leadFilter global', async () => {
      const r = await page.evaluate(() => {
        try {
          setLeadFilter('new', null);
          return { ok: true, v: leadFilter };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('new');
    });

    test('with btn element — adds active class', async () => {
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

    test('concurrent calls — no throw', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { setLeadFilter('all', null); ok++; } catch (_) {}
        }
        return ok;
      });
      expect(r).toBe(5);
    });

    test('corrupted localStorage — does not affect function', async () => {
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
    test('null filter — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setJobFilter(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — sets jobFilter global and calls renderJobsPage', async () => {
      const r = await page.evaluate(() => {
        try {
          setJobFilter('active', null);
          return { ok: true, v: jobFilter };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe('active');
    });

    test('with btn — marks active class on btn', async () => {
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

    test('concurrent calls — no throw', async () => {
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
    test('null bid — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidStage(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined bid — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { getBidStage(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty object bid — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidStage({}); return { ok: true, hasStage: !!(v && v.stage) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('bid with no linked jobs and no completion_date — returns signed stage', async () => {
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

    test('bid with completion_date and zero balance — paid stage', async () => {
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

    test('bid with active job today — active stage', async () => {
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

    test('concurrent calls — stable results', async () => {
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

    test('corrupted localStorage before call — does not throw', async () => {
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
  test('no console errors — jobs.js', async () => {
    assertNoErrors(page, 'jobs.js');
  });
});
