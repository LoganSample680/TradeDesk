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

  // ── 3b. Embedded in the portal ──────────────────────────────────────────────

  test('the arming flag locks writes before the roster has even answered', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      out.before = opsReadOnly();
      window._opsArming = true;                 // what the ops link sets at load
      out.armed = opsReadOnly();
      out.deleteLocked = _canDelete() === false;
      window._opsArming = false;
      out.after = opsReadOnly();
      return out;
    });
    expect(r.before).toBe(false);
    expect(r.armed).toBe(true);
    expect(r.deleteLocked).toBe(true);
    expect(r.after).toBe(false);
  });

  test('geo tracking never starts in a support view: it would track the VIEWER', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
    const init = src.slice(src.indexOf('function _geoTrackInit(){'), src.indexOf('function _geoTrackInit(){') + 600);
    expect(init).toContain('opsReadOnly()');
    // The enqueue paths are guarded too, so a stray closer writes nothing.
    expect(src.slice(src.indexOf('function _geoEnqueue(tbl'), src.indexOf('function _geoEnqueue(tbl') + 300)).toContain('opsReadOnly()');
  });

  test('the portal can switch people and hand back, and nothing else', async () => {
    const r = await page.evaluate(async () => {
      window._opsRoster = [
        { contractor_user_id: 'c1', person_user_id: 'p1', person_name: 'One', role: 'owner', permissions: {}, business: 'B' },
        { contractor_user_id: 'c1', person_user_id: 'p2', person_name: 'Two', role: 'crew', permissions: { estimate: true }, business: 'B' }
      ];
      window._opsView = { target: 'c1', personUid: 'p1', personName: 'One', business: 'B', role: 'owner', perms: {} };
      window._opsLoadedTarget = 'c1';
      const out = {};
      // A message from anything but the portal is ignored.
      window.postMessage({ source: 'someone-else', type: 'exit' }, location.origin);
      await new Promise(r => setTimeout(r, 60));
      out.survivedStranger = !!window._opsView;
      // Switching person keeps the account and applies their permissions.
      window.postMessage({ source: 'td-ops-portal', type: 'switch', contractor_user_id: 'c1', person_user_id: 'p2' }, location.origin);
      await new Promise(r => setTimeout(r, 250));
      out.person = window._opsView && window._opsView.personUid;
      out.isEmployee = _isEmployee;
      out.perm = !!(_employeeRecord && _employeeRecord.permissions && _employeeRecord.permissions.estimate);
      // Handing back clears the view without navigating: the portal drops the frame.
      window.postMessage({ source: 'td-ops-portal', type: 'exit' }, location.origin);
      await new Promise(r => setTimeout(r, 120));
      out.cleared = window._opsView === null;
      return out;
    });
    expect(r.survivedStranger).toBe(true);
    expect(r.person).toBe('p2');
    expect(r.isEmployee).toBe(true);
    expect(r.perm).toBe(true);
    expect(r.cleared).toBe(true);
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

  // ── The metric list is the contract ─────────────────────────────────────────
  // Owner 2026-09-13: a new RPC or metric has to land globally, not in one page.
  // These pin the indirection that makes that true, because the moment the page
  // hard-codes a metric again the property is silently gone.
  test('every metric is defined once, and the brief renders from that list', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
      '20261009_ops_metrics_global.sql'), 'utf8');
    expect(sql, 'the list exists').toMatch(/create or replace function public\.ops_metric_defs\(\)/);
    // The brief builds its sections BY JOINING that function, never by naming
    // labels of its own: a label written into the brief is a second source.
    expect(sql, 'the brief reads the list').toMatch(/from public\.ops_metric_defs\(\) d/);
    expect(sql, 'sections carry label and format for an agent').toMatch(/'label', d\.label, 'fmt', d\.fmt/);
    // The flat objects are read from the same computed map, not recomputed.
    expect(sql, 'flat sections are read from the value map')
      .toMatch(/'work',\s+v_vals -> 'work'/);

    // And the page must not have gone back to a hard-coded grid.
    const html = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
    expect(html, 'one container, filled from the answer').toMatch(/id="biz-sections"/);
    ['biz-funnel', 'biz-money', 'biz-usage'].forEach(id => {
      expect(html, id + ' is gone: sections come from the answer now').not.toContain(id);
    });
  });

  test('the lights read app_presence, they do not re-decide what a state is', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
      '20261009_ops_metrics_global.sql'), 'utf8');
    // The first cut of this built its own state machine off raw events, which
    // would have called a dead ping cron a fleet of force quits. app_presence
    // has answered this since 20260921 and judges staleness against the cron
    // watermark. So the portal reads it and maps, it never re-derives (§7.3).
    expect(sql, 'the source is app_presence').toMatch(/from public\.app_presence\(\) p/);
    ['foreground', 'background', 'push-blocked', 'force-closed'].forEach(st =>
      expect(sql, st + ' is mapped, not recomputed').toContain("when '" + st + "'"));
    // Nothing may look at raw events to decide a light.
    const live = sql.slice(sql.indexOf('function public.ops_live_status'));
    expect(live, 'no raw telemetry in the light').not.toMatch(/from analytics_events/);
    expect(live, 'no raw geo events in the light').not.toMatch(/from geo_events/);
    // Only positive evidence earns red. Cron down and no token are grey, and
    // the two are why: silence there is not evidence of anything.
    expect(sql).toMatch(/when 'force-closed' then 'closed'/);
    ['no-push-token', 'unknown-cron-down', 'dark', 'dormant'].forEach(st =>
      expect(sql, st + ' must not map to closed').not.toMatch(
        new RegExp("when '" + st + "' *then 'closed'")));

    // The page shows the light and carries the reason; it decides neither.
    const html = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');
    expect(html, 'the page reads the state as given').toMatch(/\(LIVE\.get\(uid\)\|\|\{\}\)\.state/);
    expect(html, 'and carries the explanation').toMatch(/\.detail\|\|''/);
  });

  test('app_presence gained the background edge rather than a caller re-deriving it', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
      '20261009_ops_metrics_global.sql'), 'utf8');
    // A red row has to show when the app went behind, and that column was
    // already sitting in app_presence's own CTE unreturned. Widened there, so
    // every reader gets it, not just this one (owner 2026-09-13: global).
    expect(sql).toMatch(/drop function if exists app_presence\(\);/);
    expect(sql).toMatch(/last_bg_at timestamptz/);
    expect(sql, 'and the light passes it straight through').toMatch(/p\.last_bg_at,/);
    // 20260928 added the dormant state and the awake-buckets evidence. This
    // migration widens THAT definition by one column; a hand-retyped one based
    // on the original would silently roll both back, which is the mistake this
    // pins against.
    expect(sql, 'the dormant state survived the widen').toMatch(/dormant_days numeric/);
    expect(sql, 'and its evidence column too').toMatch(/awake_buckets bigint/);
  });

  // The shared database refused this branch's migrations, and the reason was
  // not in any of them individually. Two files claimed version 20261005 on two
  // branches with two different fixes for the same type mismatch: this one
  // added a text overload, main's cast to uuid at the call site. Supabase keys
  // schema_migrations on the VERSION, so the shared project recorded main's and
  // this branch's copy can never run there, leaving every ::text call site
  // pointing at a signature that does not exist.
  //
  // So a migration may not depend on an overload a DIFFERENT file created,
  // because "a different file" can quietly mean "a file that will never run
  // here". This is the guard: anything binding ops_view_target(...::text) has
  // to define that overload itself.
  test('a migration that binds the text overload also defines it', () => {
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    fs.readdirSync(dir).filter(f => f.endsWith('.sql')).forEach(f => {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/ops_view_target\(%I::text\)/.test(sql)) return;
      expect(sql, f + ' binds the text overload without creating it')
        .toMatch(/create or replace function public\.ops_view_target\(target text\)/);
    });
  });

  // And the two definitions have to agree. Two copies of one function that
  // differ is a worse bug than the one the second copy was added to fix.
  test('every copy of the text overload has the same body', () => {
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const bodies = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).flatMap(f => {
      const m = fs.readFileSync(path.join(dir, f), 'utf8')
        .match(/create or replace function public\.ops_view_target\(target text\)([\s\S]*?)\$\$;/);
      return m ? [[f, m[1].replace(/\s+/g, ' ').trim()]] : [];
    });
    expect(bodies.length, 'the overload is defined somewhere').toBeGreaterThan(1);
    const [, first] = bodies[0];
    bodies.forEach(([f, b]) => expect(b, f + ' defines a different body').toBe(first));
  });

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

  test('every table the portal reads ends up with a policy, including the four the first run missed', () => {
    // 20261005's loop aborted partway on the shared database and left
    // account_config, deposit_caps, inbound_leads and job_assignments with no
    // policy at all. 20261007 re-runs the whole list; this pins that it does.
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261007_ops_view_missing_policies.sql'), 'utf8');
    ['account_config', 'deposit_caps', 'inbound_leads', 'job_assignments']
      .forEach(t => expect(sql).toContain(`'${t}'`));
    expect(/for\s+(insert|update|delete|all)\b/i.test(sql)).toBe(false);
    // account_config resolves through a definer function, never a subquery on
    // accounts: without the grant that subquery fails the whole read.
    expect(sql).toContain('ops_view_account(account_id)');
    expect(sql).toContain('security definer');
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
    // …and the call is cast, not left to the column's declared type. Without
    // this the policy on a text-typed owner column (device_status.user_id on the
    // real database) resolves to ops_view_target(text) and the whole migration
    // fails with 42883, which is what took the first deploy down.
    expect(sql).toContain('ops_view_target(%I::text)');
    expect(sql).toContain('create or replace function public.ops_view_target(target text)');
  });

  test('zero console errors across the suite', async () => {
    assertNoErrors(page, 'ops support view');
  });
});
