// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════
// One soft delete, shared by every sweep (owner directive 2026-08-26).
//
// "The logic should match time logs where they are only soft deleted, that
// should share so we can bring things back."
//
// The premise was inverted and the truth was worse. td_mileage HAS deleted_at
// and its rows were recoverable, but the mileage SWEEPS bypassed that with a
// direct .delete(); job_time_entries and shop_time_entries had no deleted_at
// column at all, so every sweep on them was permanent. Six call sites in
// js/geo-track.js, three in js/mileage.js.
//
// A sweep is a GUESS about data nobody asked to lose. All nine now go through
// _tdSoftDelete, so being wrong costs an undo rather than the record.
//
// The dangerous half of this change is the READ side: a soft-deleted row that
// nobody filters walks straight back into the Time Log, payroll and Crew Cost.
// The source-scan test at the bottom is the permanent guard on that, and it is
// the most important test in this file.
// ═══════════════════════════════════════════════════════════════════════════════

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Shared soft delete', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Records every update()/delete() the helper issues, so a test can assert
  // both what it DID do and what it must never do.
  const withRec = (fn, arg) => page.evaluate(async ([body, a]) => {
    const saved = window._supa;
    const rec = { updates: [], deletes: [] };
    window._supa = {
      from: (tbl) => ({
        update: (patch) => {
          const r = { tbl, patch, ids: null, filters: {} };
          rec.updates.push(r);
          const q = {
            in: (col, vals) => { r.ids = vals.slice(); return q; },
            eq: (col, val) => { r.filters[col] = val; return q; },
            then: (res, rej) => Promise.resolve({ error: window.__softErr || null }).then(res, rej),
          };
          return q;
        },
        delete: () => { rec.deletes.push({ tbl }); const q = { eq: () => q, in: () => q, then: (res) => Promise.resolve({ error: null }).then(res) }; return q; },
      }),
    };
    try { const out = await (new Function('rec', 'a', 'return (' + body + ')(rec, a)'))(rec, a); return { out, rec }; }
    finally { window._supa = saved; window.__softErr = null; }
  }, [fn.toString(), arg === undefined ? null : arg]);

  test('it stamps deleted_at instead of removing the row', async () => {
    const r = await withRec(async (rec) => await _tdSoftDelete('job_time_entries', 'row-1'));
    expect(r.out, 'reports one row handled').toBe(1);
    expect(r.rec.deletes, 'never a hard delete').toEqual([]);
    expect(r.rec.updates.length).toBe(1);
    expect(r.rec.updates[0].tbl).toBe('job_time_entries');
    expect(r.rec.updates[0].ids).toEqual(['row-1']);
    expect(typeof r.rec.updates[0].patch.deleted_at, 'a real timestamp').toBe('string');
    expect(Number.isFinite(Date.parse(r.rec.updates[0].patch.deleted_at))).toBe(true);
  });

  test('a single id and an array behave identically', async () => {
    const one = await withRec(async () => await _tdSoftDelete('shop_time_entries', 'x'));
    const many = await withRec(async () => await _tdSoftDelete('shop_time_entries', ['x']));
    expect(one.out).toBe(1);
    expect(many.out).toBe(1);
    expect(one.rec.updates[0].ids).toEqual(many.rec.updates[0].ids);
  });

  // ASSERTION CHANGED 2026-08-26 (10.4). This required ids to be stringified,
  // and they were, until that turned ten assertions elsewhere about WHICH row
  // was removed into type mismatches: a numeric row id went out as '502' and
  // came back as a string. PostgREST coerces either happily, so nothing in
  // production depended on the conversion, and the ledger that genuinely wants
  // strings gets them at the one line that writes it. Ids now travel as given.
  test('ids travel as given, so a caller can still recognise the row it removed', async () => {
    const r = await withRec(async () => await _tdSoftDelete('td_mileage', [17, '18']));
    expect(r.rec.updates[0].ids, 'no silent type conversion on the way out').toEqual([17, '18']);
  });

  test('it chunks at 50 rather than sending one enormous filter', async () => {
    const r = await withRec(async () => {
      const ids = Array.from({ length: 126 }, (_, i) => 'id-' + i);
      return await _tdSoftDelete('job_time_entries', ids);
    });
    expect(r.out).toBe(126);
    expect(r.rec.updates.length, '126 ids in chunks of 50').toBe(3);
    expect(r.rec.updates.map(u => u.ids.length)).toEqual([50, 50, 26]);
  });

  test('the per-user tables carry their owner filter, the crew tables do not', async () => {
    const scoped = await withRec(async () =>
      await _tdSoftDelete('td_mileage', 'm1', { userCol: 'user_id', userVal: 'u-9' }));
    expect(scoped.rec.updates[0].filters.user_id, 'mileage is scoped by user_id').toBe('u-9');
    const unscoped = await withRec(async () => await _tdSoftDelete('job_time_entries', 't1'));
    expect(Object.keys(unscoped.rec.updates[0].filters),
      'the crew tables are fenced by RLS, not a guessed column').toEqual([]);
  });

  test('nothing to delete does nothing at all', async () => {
    for (const arg of [[], null, undefined, [null, undefined]]) {
      const r = await withRec(async (rec, a) => await _tdSoftDelete('job_time_entries', a), arg);
      expect(r.out, JSON.stringify(arg)).toBe(0);
      expect(r.rec.updates.length).toBe(0);
    }
  });

  test('a rejected write is swallowed and reported as zero, never thrown', async () => {
    const r = await page.evaluate(async () => {
      const saved = window._supa;
      window._supa = { from: () => ({ update: () => ({ in: () => { throw new Error('no grant'); } }) }) };
      try { return { ok: true, n: await _tdSoftDelete('job_time_entries', 'a') }; }
      catch (e) { return { ok: false, msg: String(e && e.message) }; }
      finally { window._supa = saved; }
    });
    expect(r.ok, 'an employee device holds no update grant and must not break a render').toBe(true);
    expect(r.n).toBe(0);
  });

  test('an error response counts as not done', async () => {
    const r = await withRec(async () => {
      window.__softErr = { message: 'rls' };
      return await _tdSoftDelete('job_time_entries', ['a', 'b']);
    });
    expect(r.out, 'a refused chunk is not counted as removed').toBe(0);
  });

  test('no _supa at all is a no-op', async () => {
    const r = await page.evaluate(async () => {
      const saved = window._supa; window._supa = null;
      try { return await _tdSoftDelete('job_time_entries', 'a'); } finally { window._supa = saved; }
    });
    expect(r).toBe(0);
  });

  // ── THE GUARD THAT MATTERS ────────────────────────────────────────────────
  //
  // Soft deleting is only half the change. A reader that does not filter
  // deleted_at will happily show a swept row again, and it would look exactly
  // like the sweep never ran. These two scans are what stop a future select
  // being added without the filter, in any of the six files.
  test('no sweep hard-deletes a time or mileage row anywhere in app source', () => {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..');
    const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
    const offenders = [];
    files.forEach(rel => {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        // _devHardPurge is the one deliberate exception: the owner knowingly
        // purging a duplicate wants the row actually gone.
        if (/from\('(?:job_time_entries|shop_time_entries|td_mileage)'\)\s*\.delete\(\)/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    });
    expect(offenders,
      'sweeps must go through _tdSoftDelete so a wrong guess costs an undo, not the record').toEqual([]);
  });

  test('every read of the time tables filters deleted_at', () => {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..');
    const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
    // ONE declared exception exists: a read may carry a same-line
    // `/* deleted-included: <reason> */` marker instead of the filter. That is
    // for code whose correctness DEPENDS on seeing struck rows, today only
    // _geoTapeFillSweep, whose no-resurrection interlock reads deleted rows
    // precisely so it will never write over them. The marker keeps the
    // exception loud and greppable at the call site; a bare unfiltered read
    // still fails here exactly as before.
    const pat = /from\('(?:job_time_entries|shop_time_entries)'\)\s*\n?\s*\.select\('[^']*'\)(?!\.is\('deleted_at',\s*null\)|\s*\/\* deleted-included:)/g;
    const offenders = [];
    files.forEach(rel => {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      let m;
      while ((m = pat.exec(src)) !== null) {
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
    });
    expect(offenders,
      "add .is('deleted_at',null): without it a swept row walks back into the Time Log, payroll and Crew Cost").toEqual([]);
  });

  test('no console errors during soft-delete tests', () => {
    assertNoErrors(page, 'soft delete');
  });
});
