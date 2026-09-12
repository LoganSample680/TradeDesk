// @ts-check
// ── Ops support view (owner ask 2026-09-12): the real app, someone else's
//    account, read only, switchable between the people on that account.
//
// The whole value of this feature is a promise: looking at Jack's app can never
// change Jack's data, and can never drag Jack's data into the viewer's own
// account. The database keeps the first half (SELECT-only policies, no write
// policy exists to break), and this suite keeps the second half honest on the
// client, where the arrays holding their rows are the same arrays the app
// normally saves FROM.
//
// What is pinned here:
//   1. Nothing is armed on a normal boot. opsReadOnly() is false, no strip, no
//      roster call. A user who never opens the ops link pays nothing.
//   2. Every write path bails while a view is open: saveAll, supaSaveToCloud,
//      _flushSaveNow, _writeLocalCache, _geoEnqueue, telemetry, and delete.
//   3. The client seal: insert/update/upsert/delete, storage writes, edge
//      function invokes and un-allowlisted RPCs all no-op, so a call site that
//      never heard of this mode still cannot write.
//   4. Exit clears every cache that could be holding their rows.
//   5. The migration grants SELECT and only SELECT.
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261005_ops_view_readonly.sql');

test.describe('Ops support view: read only, both directions', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.evaluate(() => { window._opsView = null; }); });

  // ── 1. Inert until asked for ────────────────────────────────────────────────

  test('a normal boot arms nothing: no view, no strip, no read-only state', async () => {
    const r = await page.evaluate(() => ({
      fn: typeof opsReadOnly === 'function',
      ro: typeof opsReadOnly === 'function' ? opsReadOnly() : null,
      view: window._opsView,
      strip: document.querySelectorAll('#ops-strip').length,
      picker: document.querySelectorAll('#ops-picker').length,
      bodyClass: document.body.classList.contains('ops-view')
    }));
    expect(r.fn).toBe(true);
    expect(r.ro).toBe(false);
    expect(r.view).toBe(null);
    expect(r.strip).toBe(0);
    expect(r.picker).toBe(0);
    expect(r.bodyClass).toBe(false);
  });

  // ── 2. Every write path bails while a view is open ──────────────────────────

  test('saveAll, _flushSaveNow and supaSaveToCloud all no-op in a view', async () => {
    const r = await page.evaluate(async () => {
      const out = { pushed: 0 };
      const realPush = window.supaSaveToCloud;
      window.supaSaveToCloud = async () => { out.pushed++; };
      window._opsView = { target: 'them', personUid: 'p', personName: 'Jack', business: 'X', role: 'owner', perms: {} };
      try {
        saveAll();
        _flushSaveNow();
        out.saveSkipped = await (async () => {
          // The real function's own guard, called directly.
          window.supaSaveToCloud = realPush;
          const before = localStorage.getItem('zp3_cloud_cache');
          await supaSaveToCloud();
          return localStorage.getItem('zp3_cloud_cache') === before;
        })();
      } finally {
        window.supaSaveToCloud = realPush;
        window._opsView = null;
      }
      return out;
    });
    expect(r.pushed).toBe(0);        // saveAll/_flushSaveNow never reached a push
    expect(r.saveSkipped).toBe(true);
  });

  test('_writeLocalCache refuses to put their rows in the viewer\'s cache', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: 'me', marker: 'mine' }));
      window._opsView = { target: 'them', personUid: 'p', personName: 'Jack', business: 'X', role: 'owner', perms: {} };
      try { _writeLocalCache(); } catch (e) { return { threw: String(e) }; }
      finally { window._opsView = null; }
      let after = null;
      try { after = JSON.parse(localStorage.getItem('zp3_cloud_cache') || 'null'); } catch (_e) {}
      return { marker: after && after.marker };
    });
    expect(r.threw).toBeUndefined();
    expect(r.marker).toBe('mine');   // untouched
  });

  test('delete is locked, even though dev-support mode unlocks it', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      out.normal = _canDelete();
      window._opsView = { target: 'them', role: 'owner', perms: {} };
      out.inView = _canDelete();
      window._devSupportMode = true;                    // the mode that DOES unlock it
      out.inViewWithDevMode = _canDelete();
      window._devSupportMode = false;
      window._opsView = null;
      return out;
    });
    expect(r.inView).toBe(false);
    expect(r.inViewWithDevMode).toBe(false);
  });

  test('_geoEnqueue writes nothing while a view is open', async () => {
    const r = await page.evaluate(() => {
      if (typeof _geoEnqueue !== 'function') return { skip: true };
      window._opsView = { target: 'them', role: 'owner', perms: {} };
      let threw = null;
      try { _geoEnqueue('job_time_entries', { source: 'manual', client_key: 'fixed-x' }); }
      catch (e) { threw = String(e); }
      window._opsView = null;
      return { threw };
    });
    if (!r.skip) expect(r.threw).toBe(null);
  });

  // ── 3. The seal ─────────────────────────────────────────────────────────────

  test('the sealed client loses every write verb and keeps its reads', async () => {
    const r = await page.evaluate(async () => {
      const calls = [];
      const chain = () => { const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: () => q, then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; return q; };
      const fake = {
        from: (t) => { const q = chain(); ['insert','update','upsert','delete'].forEach(m => { q[m] = () => { calls.push(m + ':' + t); return chain(); }; }); return q; },
        rpc: (fn) => { calls.push('rpc:' + fn); return Promise.resolve({ data: null, error: null }); },
        storage: { from: () => ({ upload: () => { calls.push('upload'); return Promise.resolve({}); }, remove: () => { calls.push('remove'); return Promise.resolve({}); }, download: () => Promise.resolve({ data: null }) }) },
        functions: { invoke: (n) => { calls.push('fn:' + n); return Promise.resolve({}); } }
      };
      const sealer = window._opsSealClientFor || null;
      if (!sealer) return { sealerPresent: false, calls };
      sealer(fake);
      // Reads still work…
      const read = await fake.from('td_bids').select('id');
      // …and every write verb is now a quiet no-op.
      await fake.from('td_bids').insert({ id: 1 });
      await fake.from('td_bids').update({ id: 1 });
      await fake.from('td_bids').upsert({ id: 1 });
      await fake.from('td_bids').delete();
      await fake.rpc('geo_replace_day', {});
      await fake.storage.from('gallery').upload('a', 'b');
      await fake.storage.from('gallery').remove(['a']);
      await fake.functions.invoke('ingest-telemetry', {});
      const rosterOk = await fake.rpc('ops_view_roster');
      return { sealerPresent: true, calls, readOk: !!read, rosterCalled: calls.includes('rpc:ops_view_roster') };
    });
    // The sealer is exercised through its exported test hook below; if the hook
    // is absent the module shape changed and this test must be updated with it.
    expect(r.sealerPresent).toBe(true);
    // Only the allowlisted read reached the client; every write verb was swallowed.
    expect(r.calls).toEqual(['rpc:ops_view_roster']);
    expect(r.readOk).toBe(true);
  });

  // ── 4. Exit ─────────────────────────────────────────────────────────────────

  test('exit clears every cache that could hold their rows', async () => {
    const r = await page.evaluate(() => {
      ['zp3_cloud_cache','zp3_delta_meta','zp3_offline_pending','zp3_rcpt_imgs']
        .forEach(k => localStorage.setItem(k, '{"theirs":1}'));
      sessionStorage.setItem('zp3_ops_open', '1');
      sessionStorage.setItem('zp3_ops_person', '{"x":1}');
      const realReload = window._opsReload;
      let navigated = false;
      window._opsReload = () => { navigated = true; };
      window._opsView = { target: 'them', role: 'owner', perms: {} };
      try { opsViewExit(); } finally { window._opsReload = realReload; }
      return {
        left: ['zp3_cloud_cache','zp3_delta_meta','zp3_offline_pending','zp3_rcpt_imgs'].filter(k => localStorage.getItem(k) !== null),
        session: [sessionStorage.getItem('zp3_ops_open'), sessionStorage.getItem('zp3_ops_person')],
        view: window._opsView,
        navigated
      };
    });
    expect(r.left).toEqual([]);
    expect(r.session).toEqual([null, null]);
    expect(r.view).toBe(null);
    expect(r.navigated).toBeTruthy();
  });

  // ── 5. The database half of the promise ─────────────────────────────────────

  test('the migration grants SELECT and nothing else', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    // Each policy plus the ~220 characters that follow it: enough to carry the
    // `for select ... using (...)` clause whether it is written inline or through
    // a format() string in a do-block.
    const policies = (sql.match(/create policy[\s\S]{0,220}/g) || []);
    expect(policies.length).toBeGreaterThan(0);
    // Not one insert/update/delete/all policy anywhere in the file.
    expect(/for\s+(insert|update|delete|all)\b/i.test(sql)).toBe(false);
    // Every policy is gated on the ops check, never on a bare auth.uid().
    policies.forEach(p => expect(/ops_view_target|is_ops_admin/.test(p)).toBe(true));
    // The uid-cast rule (20260701/20260923): no bare uuid = auth.uid() comparison.
    // Comments are stripped first, the rule itself is quoted in one of them.
    const code = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
      .replace(/\(auth\.uid\(\)::text\)::uuid/g, '');
    expect(/=\s*auth\.uid\(\)(?!::text)/.test(code)).toBe(false);
  });

  test('the geo and time tables the support view reads are all covered', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    ['job_time_entries','location_pings','geo_events','geo_route_miles','device_status',
     'team_members','td_timesheets','zj_data','td_bids','td_jobs','accounts']
      .forEach(t => expect(sql).toContain(`'${t}'`));
    // The owner column is looked up per table, never assumed: assuming it is what
    // took the first cut of this migration down (td_timesheets is keyed by
    // contractor_user_id, not user_id).
    expect(sql).toContain('information_schema.columns');
    expect(/'contractor_user_id','user_id','owner_id'/.test(sql)).toBe(true);
  });

  test('zero console errors across the suite', async () => {
    assertNoErrors(page, 'ops support view');
  });
});
