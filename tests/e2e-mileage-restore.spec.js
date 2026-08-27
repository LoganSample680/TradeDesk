// @ts-check
// ── Putting back the drives a sweep should never have taken ──────────────────
//
// Owner incident, 2026-08-25. His own on-device log:
//     mile-offday - John Doe to Shop 3.2mi 2026-08-19T22:18:05.091Z
//     mile-offday - John Doe to Shop 3.2mi 2026-08-18T22:19:15.091Z
// Two real 4:18pm drives home from a client, gone out of the IRS log, because a
// bad reconciler trim removed those days' on-site rows, the workday window
// collapsed with them, and _mileWorkdaySweep read "no work that day" as "every
// drive that day was personal". The destructive rule is fixed. This file covers
// the other half: an undo, for that time and the next time.
//
// The rules being pinned, in the order they cost the most if wrong:
//   • It NEVER runs on its own. A sweep firing by itself is what caused the
//     loss; a recovery firing by itself would be the same mistake pointed the
//     other way. Scan first, write only when the owner says so.
//   • It never restores something a person deleted on purpose. deleted_at is
//     stamped once per save, so a save that also removed a client, a job, a bid
//     or an expense was a human cleaning house, not a mileage sweep.
//   • Duplicates, 0-mile loops, errands and test fixtures stay deleted. The
//     point is a defensible tax record, not a bigger number.
//   • Running it twice changes nothing the first run did not already do.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Mileage recovery (_mileRestoreSwept)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Same reason e2e-geo-park-reconcile.spec.js does it: the app's own
    // background reconcile/settle chain can fire at any point during this
    // file's run against whatever _supa mock the CURRENT test installed, which
    // corrupts an unrelated test's recording. Nothing here needs it.
    await page.evaluate(() => { window._scheduleReconcile = () => {}; });
  });

  test.afterAll(async () => { await page?.context()?.close(); });

  // A swept row as it actually sits in the table: intact `data`, a deleted_at
  // stamp, nothing else different from a live row.
  const DAY = '2026-08-19';
  const leg = (o) => Object.assign({
    id: 'r' + Math.random().toString(36).slice(2, 9),
    gps: true, legKey: 'lk-' + Math.random().toString(36).slice(2, 8),
    calc_method: 'auto_route', miles: 3.2, date: DAY,
    from_name: 'John Doe', to_name: 'Shop',
    fromCoord: { lat: 38.3, lng: -94.3 }, toCoord: { lat: 38.0, lng: -94.0 },
    startedIso: DAY + 'T22:18:05.091Z', endedIso: DAY + 'T22:25:00.000Z',
    logged_by_id: null, client_id: null,
  }, o);
  const row = (m, del) => ({ id: m.id, data: m, deleted_at: del || '2026-08-25T23:39:00.000Z' });

  /**
   * Seeds the deleted-row fetch + the live log, runs the recovery, then puts
   * every global back exactly as it was. `human` maps a companion table to the
   * deleted_at stamps it carries, which is how a deliberate cleanup is spotted.
   */
  const run = (rows, opts) => page.evaluate(async ([rows, opts]) => {
    const o = opts || {};
    const orig = {
      mileage: mileage.slice(), supa: window._supa, user: window._supaUser,
      eff: window._effectiveUid, save: window.saveAll, cloud: window.supaSaveToCloud,
      jobs: (typeof jobs !== 'undefined' ? jobs.slice() : null),
      clients: (typeof clients !== 'undefined' ? clients.slice() : null),
      expenses: (typeof expenses !== 'undefined' ? expenses.slice() : null),
    };
    mileage.length = 0; (o.live || []).forEach(r => mileage.push(r));
    // Nothing may resolve a coordinate to a business place unless a test says so.
    if (typeof jobs !== 'undefined') jobs.length = 0;
    if (typeof clients !== 'undefined') clients.length = 0;
    if (typeof expenses !== 'undefined') expenses.length = 0;
    // A realistic place book. The Shop and the supply house are places he SAVED
    // with a business kind, and that is the only thing standing between a
    // John Doe → Shop → John Doe day and the personal-loop rule collapsing it.
    // Every other coordinate is an anonymous pin, which is what a gas station
    // nobody saved actually looks like to this code.
    const origPlaceAt = window.placeAt;
    window.placeAt = (p) => {
      if (!p || p.lat == null) return null;
      if (Math.abs(p.lat - 38) < 0.01) return { name: 'Shop', kind: 'shop' };
      if (Math.abs(p.lat - 38.7) < 0.01) return { name: 'The Home Depot', kind: 'supply' };
      return null;
    };
    window._supaUser = { id: 'u1' };
    window._effectiveUid = () => 'u1';
    window.saveAll = () => {};
    window.supaSaveToCloud = () => {};
    const rec = { updates: [], selects: [] };
    window.__mr = rec;
    const human = o.human || {};
    window._supa = { from: (t) => ({
      // A background cloud SAVE that lands inside this stub's window calls
      // supaSaveToCloud, which does `_supa.from('zj_data').upsert(...)`. Same
      // reasoning as the maybeSingle note below, and the same cost when it is
      // missing: the throw becomes a console error that assertNoErrors pins on
      // whatever test happened to be running (webkit shard 3, 2026-08-26).
      // Resolves benignly, because the point is not to explode. Nothing here
      // asserts on writes; rec.updates is what the write assertions read.
      upsert: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => { const d = { eq: () => d, in: () => d, is: () => d,
        then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return d; },
      select: () => { const c = {
        eq: () => c, gte: () => c, limit: () => c, is: () => c, in: () => c, order: () => c,
          // supaLoadFromCloud ends its zj_data read with .maybeSingle(). This
          // stub is installed for a few synchronous lines, but a background
          // cloud load that lands inside that window hits THIS chain, and a
          // missing method throws a console error that assertNoErrors then
          // attributes to whatever test was running. Resolves empty: the
          // point is to not explode, not to serve settings.
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        then: (res, rej) => { rec.selects.push(t);
          if (o.fail === 'select') return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
          if (o.throwOn === t) return Promise.reject(new Error('offline')).then(res, rej);
          return Promise.resolve({ data: t === 'td_mileage' ? rows
            : (human[t] || []).map(d => ({ deleted_at: d })), error: null }).then(res, rej); },
      }; return c; },
      update: (patch) => { const c = {
        in: (col, ids) => { c._ids = ids; return c; }, eq: () => c,
        then: (res, rej) => { rec.updates.push({ t, patch, ids: c._ids });
          return Promise.resolve(o.fail === 'update' ? { error: { message: 'nope' } } : { error: null }).then(res, rej); },
      }; return c; },
    }) };
    let out = null, err = null;
    try { out = await _mileRestoreSwept({ apply: !!o.apply }); }
    catch (e) { err = String((e && e.message) || e); }
    const live = mileage.map(m => (m.from_name || '?') + '→' + (m.to_name || '?') + '@' + (m.startedIso || ''));
    mileage.length = 0; orig.mileage.forEach(m => mileage.push(m));
    if (orig.jobs) { jobs.length = 0; orig.jobs.forEach(x => jobs.push(x)); }
    if (orig.clients) { clients.length = 0; orig.clients.forEach(x => clients.push(x)); }
    if (orig.expenses) { expenses.length = 0; orig.expenses.forEach(x => expenses.push(x)); }
    window._supa = orig.supa; window._supaUser = orig.user; window._effectiveUid = orig.eff;
    window.saveAll = orig.save; window.supaSaveToCloud = orig.cloud;
    window.placeAt = origPlaceAt;
    return { out, err, live, updates: rec.updates, selects: rec.selects };
  }, [rows, opts || {}]);

  // ── The happy path: the exact legs his log shows being destroyed ──────────
  test('a real business drive a sweep took comes back', async () => {
    const a = leg({ date: '2026-08-18', startedIso: '2026-08-18T22:19:15.091Z', endedIso: '2026-08-18T22:26:00.000Z' });
    const b = leg({ date: '2026-08-19', startedIso: '2026-08-19T22:18:05.091Z', endedIso: '2026-08-19T22:25:00.000Z' });
    const r = await run([row(a), row(b)], { apply: true });
    expect(r.err).toBe(null);
    expect(r.out.error).toBe(null);
    expect(r.out.restored, 'both drives home from John Doe').toBe(2);
    expect(r.out.miles).toBe(6.4);
    expect(r.live.sort()).toEqual([
      'John Doe→Shop@2026-08-18T22:19:15.091Z',
      'John Doe→Shop@2026-08-19T22:18:05.091Z',
    ]);
    // The cloud row loses its deleted_at, or the next load brings the hole back.
    expect(r.updates.length).toBe(1);
    expect(r.updates[0].t).toBe('td_mileage');
    expect(r.updates[0].patch.deleted_at).toBe(null);
    expect(r.updates[0].ids.sort()).toEqual([a.id, b.id].sort());
  });

  test('a scan writes nothing at all', async () => {
    const r = await run([row(leg())], {});
    expect(r.out.rows.length, 'it found the leg').toBe(1);
    expect(r.out.restored, 'and left it exactly where it was').toBe(0);
    expect(r.updates).toEqual([]);
    expect(r.live).toEqual([]);
  });

  // ── The rule that matters most: never undo a deliberate deletion ──────────
  // deleted_at is one stamp per supaSaveToCloud call. A mileage sweep can only
  // remove mileage, so the moment another table lost a row in that same save,
  // a person (or a test teardown) was deleting things and the mileage went with
  // them on purpose. Verified against the dev account, 2026-08-26: the 08-17
  // burst that took 35 legs also took 3 clients, 4 jobs and an expense.
  for (const tbl of ['td_clients', 'td_jobs', 'td_bids', 'td_expenses', 'td_income']) {
    test('a leg deleted in the same save as a ' + tbl.slice(3) + ' row stays deleted', async () => {
      const stamp = '2026-08-17T21:23:00.000Z';
      const r = await run([row(leg(), stamp)], { apply: true, human: { [tbl]: [stamp] } });
      expect(r.out.restored).toBe(0);
      expect(r.out.skipped['deleted on purpose']).toBe(1);
      expect(r.updates).toEqual([]);
    });
  }

  test('a cleanup stamp only protects its own save, not the whole day', async () => {
    const kept = leg({ startedIso: DAY + 'T13:00:00.000Z', endedIso: DAY + 'T13:10:00.000Z' });
    const r = await run([
      row(leg(), '2026-08-17T21:23:00.000Z'),
      row(kept, '2026-08-25T23:39:00.000Z'),
    ], { apply: true, human: { td_clients: ['2026-08-17T21:23:00.000Z'] } });
    expect(r.out.restored).toBe(1);
    expect(r.live).toEqual(['John Doe→Shop@' + DAY + 'T13:00:00.000Z']);
  });

  // ── Exclusions ───────────────────────────────────────────────────────────
  test('the things that must stay deleted, stay deleted', async () => {
    const cases = [
      ['anonymous endpoint', leg({ to_name: 'Stop' })],
      ['anonymous endpoint', leg({ from_name: '?' })],
      ['anonymous endpoint', leg({ from_name: '' })],
      ['round trip to the same place', leg({ from_name: 'FBC', to_name: 'FBC' })],
      ['no miles',                     leg({ miles: 0 })],
      ['never measured',               leg({ calc_method: 'pending_auto' })],
      ['not an automatic leg',         leg({ gps: false, legKey: null })],
      ['not an automatic leg',         leg({ legKey: null })],
      ['no clock',                     leg({ startedIso: null, endedIso: null })],
      ['test seed data',               leg({ to_name: 'Kansas Ave Client 1785640356810' })],
      ['test seed data',               leg({ from_name: 'MyLeg', to_name: 'MyLegEnd' })],
      ['test seed data',               leg({ from_name: 'E2E Yard 675833', to_name: 'Shop' })],
      ['test seed data',               leg({ legKey: 'sync-truck-1785715150572' })],
      ['test seed data',               leg({ legKey: 'scope-0.411440158' })],
      ['test seed data',               leg({ logged_by_id: 'someone-else-1785715641164' })],
    ];
    for (const [why, m] of cases) {
      const r = await run([row(m)], { apply: true });
      expect(r.out.restored, why + ': ' + m.from_name + '→' + m.to_name).toBe(0);
      expect(Object.keys(r.out.skipped), why).toContain(why);
    }
  });

  test('a duplicate of a leg already on the log is not restored twice', async () => {
    // The exact shape from the dev account: the same drive written under two
    // leg keys two seconds apart, one live, one swept.
    const live = leg({ legKey: 'lk-live', startedIso: DAY + 'T12:51:12.088Z', endedIso: DAY + 'T13:01:08.380Z' });
    const swept = leg({ startedIso: DAY + 'T12:51:10.074Z', endedIso: DAY + 'T12:57:23.088Z' });
    const r = await run([row(swept)], { apply: true, live: [live] });
    expect(r.out.restored).toBe(0);
    expect(r.out.skipped['already logged']).toBe(1);
  });

  test('the hand-typed half of a double log also counts as already logged', async () => {
    const manual = { id: 'man1', date: DAY, from_name: '', to_name: 'Shop', miles: 3.3,
      calc_method: 'address', loggedAt: DAY + 'T22:26:46.690Z' };
    const r = await run([row(leg())], { apply: true, live: [manual] });
    expect(r.out.restored, 'he already typed this trip in').toBe(0);
    expect(r.out.skipped['already logged']).toBe(1);
  });

  test('nobody is on two drives at once: the later of an overlapping pair goes', async () => {
    const a = leg({ from_name: 'The Home Depot', to_name: 'Shop', startedIso: DAY + 'T17:33:33.086Z', endedIso: DAY + 'T18:32:38.453Z' });
    const b = leg({ from_name: 'Shop', to_name: 'The Home Depot', startedIso: DAY + 'T17:35:50.505Z', endedIso: DAY + 'T17:40:00.000Z' });
    const r = await run([row(a), row(b)], { apply: true });
    expect(r.out.restored).toBe(1);
    expect(r.out.skipped['overlaps a kept leg']).toBe(1);
    expect(r.live).toEqual(['The Home Depot→Shop@' + DAY + 'T17:33:33.086Z']);
  });

  test('you cannot drive somewhere you never left: the echo is dropped', async () => {
    // Both rows say Shop → FBC, and nothing in between brought him back to the
    // Shop. The second is the fence machine re-deriving the same journey.
    const a = leg({ from_name: 'Shop', to_name: 'FBC', miles: 5.1, startedIso: DAY + 'T15:31:04.108Z', endedIso: DAY + 'T15:41:53.091Z' });
    const b = leg({ from_name: 'Shop', to_name: 'FBC', miles: 5.4, startedIso: DAY + 'T15:49:27.705Z', endedIso: DAY + 'T16:56:54.853Z' });
    const r = await run([row(a), row(b)], { apply: true });
    expect(r.out.restored).toBe(1);
    expect(r.out.miles).toBe(5.1);
    expect(r.out.skipped['echo of a leg already kept']).toBe(1);
  });

  test('a genuine second run of the same route survives, because he went back first', async () => {
    const a = leg({ from_name: 'Shop', to_name: 'John Doe', startedIso: DAY + 'T12:46:50.324Z', endedIso: DAY + 'T12:52:49.105Z' });
    const b = leg({ from_name: 'John Doe', to_name: 'Shop', startedIso: DAY + 'T13:04:22.178Z', endedIso: DAY + 'T13:10:00.101Z' });
    const c = leg({ from_name: 'Shop', to_name: 'John Doe', startedIso: DAY + 'T13:10:52.100Z', endedIso: DAY + 'T13:18:28.100Z' });
    const r = await run([row(a), row(b), row(c)], { apply: true });
    expect(r.out.restored, 'three real legs, none of them an echo').toBe(3);
    expect(r.out.miles).toBe(9.6);
  });

  test("the Casey's loop stays off the deduction", async () => {
    // Out of a client, into a gas station nobody saved as a business place, back
    // to the same client. No business miles exist in that loop, so neither leg
    // comes back.
    const out = leg({ from_name: 'John Doe', to_name: 'Caseys', miles: 4.7,
      toCoord: { lat: 39.9, lng: -95.9 }, startedIso: DAY + 'T15:45:50.218Z', endedIso: DAY + 'T16:36:53.351Z' });
    const back = leg({ from_name: 'Caseys', to_name: 'John Doe', miles: 4.5,
      fromCoord: { lat: 39.9, lng: -95.9 }, startedIso: DAY + 'T16:49:47.111Z', endedIso: DAY + 'T16:58:01.758Z' });
    const r = await run([row(out), row(back)], { apply: true });
    expect(r.out.restored).toBe(0);
    expect(r.out.skipped['round trip through a personal stop']).toBe(2);
    expect(r.live).toEqual([]);
  });

  test('a supply run to a saved business place is not a personal loop', async () => {
    const HD = { lat: 39.9, lng: -95.9 };
    const r = await page.evaluate(async ([HD]) => {
      const origPlaceAt = window.placeAt;
      window.placeAt = (p) => (Math.abs(p.lat - HD.lat) < 0.01 ? { name: 'The Home Depot', kind: 'supply' } : null);
      const biz = _mileStopIsBusiness({ lat: HD.lat, lng: HD.lng }, 'The Home Depot', '2026-08-19');
      window.placeAt = origPlaceAt;
      return biz;
    }, [HD]);
    expect(r, 'a place he saved as a supply house is business, by his own hand').toBe(true);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────
  test('running it twice restores nothing the second time', async () => {
    const m = leg();
    const r = await page.evaluate(async ([rows]) => {
      const orig = { mileage: mileage.slice(), supa: window._supa, user: window._supaUser,
        eff: window._effectiveUid, save: window.saveAll, cloud: window.supaSaveToCloud };
      mileage.length = 0;
      window._supaUser = { id: 'u1' }; window._effectiveUid = () => 'u1';
      window.saveAll = () => {}; window.supaSaveToCloud = () => {};
      // The table behaves like the real one: once deleted_at is cleared, the
      // gte('deleted_at') filter can no longer see the row.
      let cleared = false;
      window._supa = { from: (t) => ({
      // A background cloud SAVE that lands inside this stub's window calls
      // supaSaveToCloud, which does `_supa.from('zj_data').upsert(...)`. Same
      // reasoning as the maybeSingle note below, and the same cost when it is
      // missing: the throw becomes a console error that assertNoErrors pins on
      // whatever test happened to be running (webkit shard 3, 2026-08-26).
      // Resolves benignly, because the point is not to explode. Nothing here
      // asserts on writes; rec.updates is what the write assertions read.
      upsert: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => { const d = { eq: () => d, in: () => d, is: () => d,
        then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return d; },
        select: () => { const c = { eq: () => c, gte: () => c, limit: () => c, is: () => c, in: () => c, order: () => c,
          // supaLoadFromCloud ends its zj_data read with .maybeSingle(). This
          // stub is installed for a few synchronous lines, but a background
          // cloud load that lands inside that window hits THIS chain, and a
          // missing method throws a console error that assertNoErrors then
          // attributes to whatever test was running. Resolves empty: the
          // point is to not explode, not to serve settings.
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          then: (res, rej) => Promise.resolve({ data: (t === 'td_mileage' && !cleared) ? rows : [], error: null }).then(res, rej) }; return c; },
        update: () => { const c = { in: () => c, eq: () => c,
          then: (res, rej) => { cleared = true; return Promise.resolve({ error: null }).then(res, rej); } }; return c; },
      }) };
      const first = await _mileRestoreSwept({ apply: true });
      const second = await _mileRestoreSwept({ apply: true });
      const n = mileage.length;
      mileage.length = 0; orig.mileage.forEach(x => mileage.push(x));
      window._supa = orig.supa; window._supaUser = orig.user; window._effectiveUid = orig.eff;
      window.saveAll = orig.save; window.supaSaveToCloud = orig.cloud;
      return { first: first.restored, second: second.restored, scanned2: second.scanned, n };
    }, [[row(m)]]);
    expect(r.first).toBe(1);
    expect(r.second, 'a second tap is a no-op, not a second copy').toBe(0);
    expect(r.scanned2).toBe(0);
    expect(r.n, 'exactly one row on the log').toBe(1);
  });

  test('a row already back on the log is never added again', async () => {
    const m = leg();
    // The table still reports it deleted (a stale read), and the log already
    // has it. Nothing may be duplicated on the strength of a stale row.
    const r = await run([row(m)], { apply: true, live: [m] });
    expect(r.out.restored).toBe(0);
    expect(r.out.skipped['already back']).toBe(1);
    expect(r.live.length).toBe(1);
  });

  // ── Failure and empty states change nothing ──────────────────────────────
  test('an empty table restores nothing and reports no error', async () => {
    const r = await run([], { apply: true });
    expect(r.out.error).toBe(null);
    expect(r.out.scanned).toBe(0);
    expect(r.out.restored).toBe(0);
    expect(r.updates).toEqual([]);
  });

  test('a failed fetch changes nothing', async () => {
    const r = await run([row(leg())], { apply: true, fail: 'select' });
    expect(r.out.error).toBe('boom');
    expect(r.out.restored).toBe(0);
    expect(r.live).toEqual([]);
    expect(r.updates).toEqual([]);
  });

  test('a fetch that throws changes nothing', async () => {
    const r = await run([row(leg())], { apply: true, throwOn: 'td_mileage' });
    expect(r.err, 'it must not escape as an exception').toBe(null);
    expect(r.out.restored).toBe(0);
    expect(r.live).toEqual([]);
  });

  test('a companion-table read that throws does not block the recovery', async () => {
    // Losing the cleanup evidence must not silently turn every burst into a
    // sweep, but it also must not take the whole tool down: the per-table read
    // is guarded and the mileage rules still apply.
    const r = await run([row(leg())], { apply: true, throwOn: 'td_clients' });
    expect(r.err).toBe(null);
    expect(r.out.error).toBe(null);
  });

  test('a failed write leaves the log untouched', async () => {
    const r = await run([row(leg())], { apply: true, fail: 'update' });
    expect(r.out.error).toBe('nope');
    expect(r.out.restored, 'the row is not added locally when the cloud refused').toBe(0);
    expect(r.live, 'and the log is exactly as it was').toEqual([]);
  });

  test('signed out, it does nothing', async () => {
    const r = await page.evaluate(async () => {
      const orig = { u: window._supaUser, e: window._effectiveUid, s: window._supa };
      window._supaUser = null; window._effectiveUid = () => null;
      window._supa = { from: () => { throw new Error('must not be called'); } };
      const out = await _mileRestoreSwept({ apply: true });
      window._supaUser = orig.u; window._effectiveUid = orig.e; window._supa = orig.s;
      return out;
    });
    expect(r.error).toBe('not signed in');
    expect(r.restored).toBe(0);
  });

  test('with no connection at all it does nothing', async () => {
    const r = await page.evaluate(async () => {
      const orig = window._supa; window._supa = null;
      const out = await _mileRestoreSwept({ apply: true });
      window._supa = orig; return out;
    });
    expect(r.error).toBe('not connected');
  });

  // ── §11.1 input classes on the decision functions themselves ─────────────
  test('_mileRestoreEligible survives null, undefined, empty and garbage', async () => {
    const r = await page.evaluate(() => ({
      none: [null, undefined, {}, [], 0, ''].map(x => typeof _mileRestoreEligible(x) === 'string'),
      seed: [null, undefined, {}, { from_name: null, to_name: undefined }].map(x => _mileRestoreIsSeed(x)),
      win: [null, undefined, {}, { startedIso: 'nope' }].map(x => _mileRestoreWin(x).a),
    }));
    expect(r.none, 'every non-row is refused with a reason, never restored').toEqual([true, true, true, true, true, true]);
    expect(r.seed).toEqual([false, false, false, false]);
    expect(r.win, 'an unparseable clock is zero, never NaN').toEqual([0, 0, 0, 0]);
  });

  test('_mileStopIsBusiness survives null, undefined and a missing DOM', async () => {
    const r = await page.evaluate(() => [
      _mileStopIsBusiness(null, null, null),
      _mileStopIsBusiness(undefined),
      _mileStopIsBusiness({}, '', ''),
      _mileStopIsBusiness({ lat: null, lng: null }, 'x', 'y'),
    ]);
    expect(r, 'no coordinate is not evidence of business').toEqual([false, false, false, false]);
  });

  test('ten concurrent calls neither throw nor double-restore', async () => {
    const m = leg();
    const r = await page.evaluate(async ([rows]) => {
      const orig = { mileage: mileage.slice(), supa: window._supa, user: window._supaUser,
        eff: window._effectiveUid, save: window.saveAll, cloud: window.supaSaveToCloud };
      mileage.length = 0;
      window._supaUser = { id: 'u1' }; window._effectiveUid = () => 'u1';
      window.saveAll = () => {}; window.supaSaveToCloud = () => {};
      window._supa = { from: (t) => ({
      // A background cloud SAVE that lands inside this stub's window calls
      // supaSaveToCloud, which does `_supa.from('zj_data').upsert(...)`. Same
      // reasoning as the maybeSingle note below, and the same cost when it is
      // missing: the throw becomes a console error that assertNoErrors pins on
      // whatever test happened to be running (webkit shard 3, 2026-08-26).
      // Resolves benignly, because the point is not to explode. Nothing here
      // asserts on writes; rec.updates is what the write assertions read.
      upsert: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => { const d = { eq: () => d, in: () => d, is: () => d,
        then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return d; },
        select: () => { const c = { eq: () => c, gte: () => c, limit: () => c, is: () => c, in: () => c, order: () => c,
          // supaLoadFromCloud ends its zj_data read with .maybeSingle(). This
          // stub is installed for a few synchronous lines, but a background
          // cloud load that lands inside that window hits THIS chain, and a
          // missing method throws a console error that assertNoErrors then
          // attributes to whatever test was running. Resolves empty: the
          // point is to not explode, not to serve settings.
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          then: (res, rej) => Promise.resolve({ data: t === 'td_mileage' ? rows : [], error: null }).then(res, rej) }; return c; },
        update: () => { const c = { in: () => c, eq: () => c,
          then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return c; },
      }) };
      let threw = null;
      try { await Promise.all(Array.from({ length: 10 }, () => _mileRestoreSwept({ apply: true }))); }
      catch (e) { threw = String((e && e.message) || e); }
      const ids = mileage.map(x => String(x.id));
      mileage.length = 0; orig.mileage.forEach(x => mileage.push(x));
      window._supa = orig.supa; window._supaUser = orig.user; window._effectiveUid = orig.eff;
      window.saveAll = orig.save; window.supaSaveToCloud = orig.cloud;
      return { threw, ids };
    }, [[row(m)]]);
    expect(r.threw).toBe(null);
    expect(r.ids, 'the id guard holds even with ten passes racing').toEqual([m.id]);
  });

  // ── It is a trigger, not a sweep ─────────────────────────────────────────
  test('nothing calls the recovery automatically', async () => {
    const wired = await page.evaluate(() => ({
      fn: typeof window._mileRestoreSwept === 'function',
      panel: typeof window._mileRestorePanel === 'function',
      btn: !!document.getElementById('set-mile-restore-btn'),
    }));
    expect(wired.fn, 'reachable').toBe(true);
    expect(wired.panel, 'and reachable the way the owner reaches it').toBe(true);
    expect(wired.btn, 'the button lives under Settings → Developer → Location engine').toBe(true);
    // The boot/reconnect cascade in js/cloud.js fires five mileage sweeps by
    // name. The recovery must never be one of them.
    const src = await page.evaluate(async () => (await fetch('/js/cloud.js')).text());
    expect(src.includes('_mileRestoreSwept'), 'no automatic caller anywhere in the sync path').toBe(false);
  });

  test('the panel scans, shows, and writes nothing until it is told to', async () => {
    const r = await page.evaluate(async () => {
      const orig = { supa: window._supa, user: window._supaUser, eff: window._effectiveUid, mileage: mileage.slice() };
      mileage.length = 0;
      window._supaUser = { id: 'u1' }; window._effectiveUid = () => 'u1';
      let updates = 0;
      const rows = [{ id: 'p1', deleted_at: '2026-08-25T23:39:00.000Z', data: {
        id: 'p1', gps: true, legKey: 'p-lk', calc_method: 'auto_route', miles: 3.2,
        date: '2026-08-19', from_name: 'John Doe', to_name: 'Shop',
        fromCoord: { lat: 38.3, lng: -94.3 }, toCoord: { lat: 38, lng: -94 },
        startedIso: '2026-08-19T22:18:05.091Z', endedIso: '2026-08-19T22:25:00.000Z' } }];
      window._supa = { from: (t) => ({
      // A background cloud SAVE that lands inside this stub's window calls
      // supaSaveToCloud, which does `_supa.from('zj_data').upsert(...)`. Same
      // reasoning as the maybeSingle note below, and the same cost when it is
      // missing: the throw becomes a console error that assertNoErrors pins on
      // whatever test happened to be running (webkit shard 3, 2026-08-26).
      // Resolves benignly, because the point is not to explode. Nothing here
      // asserts on writes; rec.updates is what the write assertions read.
      upsert: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => { const d = { eq: () => d, in: () => d, is: () => d,
        then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) }; return d; },
        select: () => { const c = { eq: () => c, gte: () => c, limit: () => c, is: () => c, in: () => c, order: () => c,
          // supaLoadFromCloud ends its zj_data read with .maybeSingle(). This
          // stub is installed for a few synchronous lines, but a background
          // cloud load that lands inside that window hits THIS chain, and a
          // missing method throws a console error that assertNoErrors then
          // attributes to whatever test was running. Resolves empty: the
          // point is to not explode, not to serve settings.
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          then: (res, rej) => Promise.resolve({ data: t === 'td_mileage' ? rows : [], error: null }).then(res, rej) }; return c; },
        update: () => { const c = { in: () => c, eq: () => c,
          then: (res, rej) => { updates++; return Promise.resolve({ error: null }).then(res, rej); } }; return c; },
      }) };
      _mileRestorePanel();
      const open = !!document.getElementById('_mile-restore-ov');
      // Twice is once: the panel must not stack.
      _mileRestorePanel();
      const count = document.querySelectorAll('#_mile-restore-ov').length;
      await new Promise(r2 => setTimeout(r2, 250));
      const body = (document.getElementById('_mile-restore-body') || {}).textContent || '';
      const btn = document.getElementById('_mile-restore-go');
      const offered = !!btn && btn.style.display !== 'none';
      document.getElementById('_mile-restore-ov')?.remove();
      mileage.length = 0; orig.mileage.forEach(x => mileage.push(x));
      window._supa = orig.supa; window._supaUser = orig.user; window._effectiveUid = orig.eff;
      return { open, count, body, offered, updates, live: mileage.length };
    });
    expect(r.open).toBe(true);
    expect(r.count, 'one panel, however many taps').toBe(1);
    expect(r.body).toContain('3.2 mi');
    expect(r.offered, 'it offers the restore').toBe(true);
    expect(r.updates, 'and has written absolutely nothing yet').toBe(0);
  });

  test('the panel says so plainly when there is nothing to bring back', async () => {
    const r = await page.evaluate(async () => {
      const orig = { supa: window._supa, user: window._supaUser, eff: window._effectiveUid };
      window._supaUser = { id: 'u1' }; window._effectiveUid = () => 'u1';
      window._supa = { from: () => ({ select: () => { const c = { eq: () => c, gte: () => c, limit: () => c, is: () => c, in: () => c, order: () => c,
          // supaLoadFromCloud ends its zj_data read with .maybeSingle(). This
          // stub is installed for a few synchronous lines, but a background
          // cloud load that lands inside that window hits THIS chain, and a
          // missing method throws a console error that assertNoErrors then
          // attributes to whatever test was running. Resolves empty: the
          // point is to not explode, not to serve settings.
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) }; return c; } }) };
      _mileRestorePanel();
      await new Promise(r2 => setTimeout(r2, 250));
      const body = (document.getElementById('_mile-restore-body') || {}).textContent || '';
      const btn = document.getElementById('_mile-restore-go');
      const hidden = !btn || btn.style.display === 'none';
      document.getElementById('_mile-restore-ov')?.remove();
      window._supa = orig.supa; window._supaUser = orig.user; window._effectiveUid = orig.eff;
      return { body, hidden };
    });
    expect(r.body).toContain('Nothing to bring back');
    expect(r.hidden, 'no button to press when there is nothing to press it for').toBe(true);
  });

  // The extraction that let the recovery ask the SAME business question the
  // personal-stop sweep asks (§7.3), rather than a lookalike written from
  // memory. Its original caller must be unchanged by the move.
  test('_milePersonalStopSweep still keeps a stop with a receipt against it', async () => {
    const r = await page.evaluate(async () => {
      const orig = { mileage: mileage.slice(), ran: window._milePersonalSweepRan,
        expenses: (typeof expenses !== 'undefined' ? expenses.slice() : null), placeAt: window.placeAt };
      const P = { lat: 38.5, lng: -94.5 };
      mileage.length = 0;
      mileage.push({ id: 'i1', gps: true, legKey: 'i-lk', date: '2026-08-19', miles: 3,
        from_name: 'Shop', to_name: 'Caseys', fromCoord: { lat: 38, lng: -94 }, toCoord: P,
        startedIso: '2026-08-19T15:00:00.000Z', endedIso: '2026-08-19T15:10:00.000Z' });
      mileage.push({ id: 'o1', gps: true, legKey: 'o-lk', date: '2026-08-19', miles: 3,
        from_name: 'Caseys', to_name: 'John Doe', fromCoord: P, toCoord: { lat: 38.3, lng: -94.3 },
        startedIso: '2026-08-19T15:30:00.000Z', endedIso: '2026-08-19T15:40:00.000Z' });
      window.placeAt = () => null;
      const origBiz = window._bizReceiptForStop;
      window._bizReceiptForStop = () => ({ id: 'exp1' });
      window._milePersonalSweepRan = false;
      const fixed = await _milePersonalStopSweep();
      const left = mileage.length;
      window._bizReceiptForStop = origBiz; window.placeAt = orig.placeAt;
      window._milePersonalSweepRan = orig.ran;
      mileage.length = 0; orig.mileage.forEach(m => mileage.push(m));
      if (orig.expenses) { expenses.length = 0; orig.expenses.forEach(e => expenses.push(e)); }
      return { fixed, left };
    });
    expect(r.fixed, 'money spent there that day makes it a business stop').toBe(0);
    expect(r.left).toBe(2);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
