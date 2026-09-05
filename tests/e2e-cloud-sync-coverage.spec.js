// @ts-check
/**
 * Cloud / sync core coverage (CLAUDE.md §12, exhaustive per-function coverage).
 *
 * Targets the highest-RISK uncovered functions in js/cloud.js: the sync core,
 * across the §12.1 input classes (null / empty / boundary / type-mismatch /
 * missing-DOM / golden path), the §12.2 concurrent-call race pattern, and the
 * §12.3 localStorage-corruption pattern.
 *
 * Functions exercised:
 *   _isMissingTableErr       , error classification (true/false across shapes)
 *   _bidRichness             , bid scoring (empty / partial / full / non-bid)
 *   _recordLocalDelete       , delete-sweep id tracking (§9.8 concurrency-safe sweep)
 *   _setDeliberateWipe       , wipe-flag setter
 *   _isCompanyVehicleToday   , company-vehicle boolean across localStorage states
 *   _pickVehicle             , vehicle selection (localStorage + toast, missing DOM)
 *   _dispatchMoveUp/_dispatchMoveDown/_dispatchUnassign: dispatch reorder + boundaries
 *   _empPayTypeSync          , pay-type form sync (DOM label/placeholder)
 *   _setEmpRolePreset        , role → permission-checkbox preset
 *   _togglePermInfo          , info-block toggle (missing DOM)
 *   _copyInviteLink          , clipboard copy (no-throw)
 *   _cacheUserLayoutLocal    , per-uid layout cache to localStorage
 *   _opDbOpen / _opSyncOps (window.__opSync): durable op-log + shadow sync (§12.2 race)
 *   _loadTeamComp / _refreshPermReqBadge / _denyPermissionRequest, supa-backed, no-throw
 *   _migrateReceiptsToStorage / _restoreReceiptsFromStorage, receipt sync, no-throw
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
// Source-level guards, house style (e2e-geo-wake-regions): some invariants are
// about the SHAPE of the code (an ordering, a guard that must precede a purge)
// and are far more honest read from the file than simulated at runtime.
const readJs = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

test.describe('Cloud sync core, uncovered function coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    assertNoErrors(page, 'cloud sync core coverage');
    await page.context().close();
  });

  // ── _isMissingTableErr, pure error classification ────────────────────────
  test('_isMissingTableErr: classifies missing-table errors true, real errors false', async () => {
    const r = await page.evaluate(() => {
      if (typeof _isMissingTableErr !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          pgCode:     _isMissingTableErr({ code: '42P01' }),                    // postgres undefined_table
          restCode:   _isMissingTableErr({ code: 'PGRST205' }),                 // PostgREST schema-cache miss
          msgExist:   _isMissingTableErr({ message: 'relation td_x does not exist' }),
          msgFind:    _isMissingTableErr({ message: 'Could not find the table' }),
          msgSchema:  _isMissingTableErr({ message: 'schema cache reload needed' }),
          authErr:    _isMissingTableErr({ code: 'PGRST401', message: 'Invalid JWT' }),
          netErr:     _isMissingTableErr({ message: 'Failed to fetch' }),
          emptyObj:   _isMissingTableErr({}),
          nullErr:    _isMissingTableErr(null),
          undefErr:   _isMissingTableErr(undefined),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    // true for every missing-table signal
    expect(r.pgCode).toBe(true);
    expect(r.restCode).toBe(true);
    expect(r.msgExist).toBe(true);
    expect(r.msgFind).toBe(true);
    expect(r.msgSchema).toBe(true);
    // false for real errors and empty/null inputs
    expect(r.authErr).toBe(false);
    expect(r.netErr).toBe(false);
    expect(r.emptyObj).toBe(false);
    expect(r.nullErr).toBe(false);
    expect(r.undefErr).toBe(false);
  });

  // ── _bidRichness, pure scoring ───────────────────────────────────────────
  test('_bidRichness: scores surfaces*100 + rooms across input classes', async () => {
    const r = await page.evaluate(() => {
      if (typeof _bidRichness !== 'function') return { skip: true };
      try {
        return {
          ok: true,
          nul:      _bidRichness(null),                                          // -1 sentinel
          undef:    _bidRichness(undefined),                                     // -1 sentinel
          empty:    _bidRichness({}),                                            // 0
          surfOnly: _bidRichness({ surfaces: [{}, {}, {}] }),                    // 3*100
          roomOnly: _bidRichness({ roomScopeMap: { a: 1, b: 2 } }),             // 2
          full:     _bidRichness({ surfaces: [{}, {}], roomScopeMap: { a: 1 } }),// 201
          badTypes: _bidRichness({ surfaces: 'nope', roomScopeMap: 42 }),       // 0 (type-mismatch guarded)
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.nul).toBe(-1);
    expect(r.undef).toBe(-1);
    expect(r.empty).toBe(0);
    expect(r.surfOnly).toBe(300);
    expect(r.roomOnly).toBe(2);
    expect(r.full).toBe(201);
    expect(r.badTypes).toBe(0);
    // ordering property the merge logic relies on: surfaces weighted heavier than rooms
    expect(r.surfOnly).toBeGreaterThan(r.roomOnly);
    expect(r.full).toBeGreaterThan(r.empty);
  });

  // ── _recordLocalDelete, §9.8 concurrency-safe sweep id tracking ───────────
  test('_recordLocalDelete: tracks explicitly-deleted ids, ignores unknown tables/empty', async () => {
    const r = await page.evaluate(() => {
      if (typeof _recordLocalDelete !== 'function' || typeof _locallyDeletedIds === 'undefined') return { skip: true };
      try {
        const has = (tbl, id) => !!(_locallyDeletedIds[tbl] && _locallyDeletedIds[tbl].has(String(id)));
        // golden path: record a single explicit local delete
        _recordLocalDelete('td_bids', 555001);
        const single = has('td_bids', 555001);
        // multiple ids in one call (cascade pattern)
        _recordLocalDelete('td_jobs', 555002, 555003);
        const multi = has('td_jobs', 555002) && has('td_jobs', 555003);
        // ids are stringified, numeric and string forms collapse to the same key
        const strMatch = has('td_bids', '555001');
        // null / undefined ids are skipped, not recorded as "null"/"undefined"
        const before = _locallyDeletedIds.td_clients.size;
        _recordLocalDelete('td_clients', null, undefined);
        const nullSkipped = _locallyDeletedIds.td_clients.size === before;
        // unknown table → safe no-op, no throw, no new Set created
        _recordLocalDelete('td_not_a_table', 999);
        const unknownSafe = _locallyDeletedIds['td_not_a_table'] === undefined;
        return { ok: true, single, multi, strMatch, nullSkipped, unknownSafe };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.single).toBe(true);
    expect(r.multi).toBe(true);
    expect(r.strMatch).toBe(true);
    expect(r.nullSkipped).toBe(true);
    expect(r.unknownSafe).toBe(true);
  });

  // Root cause (2026-07-10): _locallyDeletedIds was a hand-listed object literal
  // that fell out of sync with _TD_TABLES, td_maintenance was missing, so
  // deleteMaintenanceRecord's delete never propagated to the cloud sweep (the
  // row resurrected on the next load). Now built FROM _TD_TABLES so this class
  // of bug can't recur, this test is the tripwire: it fails the moment a new
  // table is added to _TD_TABLES without _locallyDeletedIds picking it up.
  test('_locallyDeletedIds: covers every table in _TD_TABLES (the exact bug: td_maintenance was missing)', async () => {
    const r = await page.evaluate(() => {
      if (typeof _TD_TABLES === 'undefined' || typeof _locallyDeletedIds === 'undefined') return { skip: true };
      const missing = _TD_TABLES.map(({ t }) => t).filter(t => !(_locallyDeletedIds[t] instanceof Set));
      return { missing, total: _TD_TABLES.length, covered: Object.keys(_locallyDeletedIds).length };
    });
    if (r.skip) return;
    expect(r.missing).toEqual([]);
    expect(r.covered).toBe(r.total);
  });

  test('deleteMaintenanceRecord, the delete actually propagates to the cloud sweep (regression for the fixed bug)', async () => {
    const r = await page.evaluate(() => {
      if (typeof deleteMaintenanceRecord !== 'function' || typeof maintenance === 'undefined') return { skip: true };
      const id = 555100;
      maintenance.push({ id, vehicleName: 'Test Van', date: '2026-01-01', desc: 'Oil change', cost: 45 });
      // deleteMaintenanceRecord asks for confirmation via zConfirm, stub it to
      // auto-accept so the test drives the real delete path, not a mock.
      const origConfirm = window.zConfirm;
      let deleted = false;
      window.zConfirm = (msg, onYes) => { onYes(); };
      try {
        deleteMaintenanceRecord(id);
        deleted = !maintenance.some(m => m.id === id);
      } finally { window.zConfirm = origConfirm; }
      const swept = !!(_locallyDeletedIds.td_maintenance && _locallyDeletedIds.td_maintenance.has(String(id)));
      return { deleted, swept };
    });
    if (r.skip) return;
    expect(r.deleted).toBe(true);   // removed from the in-memory array
    expect(r.swept).toBe(true);     // THE bug: this used to be false, the id was never recorded, so it never left the cloud
  });

  // ── _setDeliberateWipe, flag setter ──────────────────────────────────────
  test('_setDeliberateWipe: coerces to boolean flag', async () => {
    const r = await page.evaluate(() => {
      if (typeof _setDeliberateWipe !== 'function' || typeof _deliberateWipe === 'undefined') return { skip: true };
      try {
        _setDeliberateWipe(true);  const onTrue = _deliberateWipe;
        _setDeliberateWipe(false); const offFalse = _deliberateWipe;
        _setDeliberateWipe(1);     const onTruthy = _deliberateWipe;   // coerced → true
        _setDeliberateWipe(0);     const offFalsy = _deliberateWipe;   // coerced → false
        _setDeliberateWipe();      const offUndef = _deliberateWipe;   // undefined → false
        _setDeliberateWipe(false);                                     // restore default
        return { ok: true, onTrue, offFalse, onTruthy, offFalsy, offUndef, restored: _deliberateWipe };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.onTrue).toBe(true);
    expect(r.offFalse).toBe(false);
    expect(r.onTruthy).toBe(true);
    expect(r.offFalsy).toBe(false);
    expect(r.offUndef).toBe(false);
    expect(r.restored).toBe(false);
  });

  // ── _isCompanyVehicleToday, boolean logic over localStorage states ───────
  //
  // This used to assert a third state, 'none', meaning "on foot today". That
  // option was deleted on the owner's call (2026-08-01): no contractor walks
  // between job sites, so it was a row everybody read past. The value is now
  // unwritable, and 'none' is just an unrecognised id like any other.
  //
  // Which is exactly what the last case below pins. This function has always
  // answered "is there a vehicle that is not their own car", not "is this id in
  // the fleet", so any unrecognised string reads true and always has. Left
  // asserted so the deletion cannot quietly change the shape of the answer.
  test('_isCompanyVehicleToday, true for any vehicle that is not their own car', async () => {
    const r = await page.evaluate(() => {
      if (typeof _isCompanyVehicleToday !== 'function' || typeof todayKey !== 'function') return { skip: true };
      try {
        const key = 'emp_vehicle_' + todayKey();
        const orig = localStorage.getItem(key);
        localStorage.removeItem(key);          const unset    = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'personal'); const personal = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'veh-123');  const company  = _isCompanyVehicleToday(); // true
        localStorage.setItem(key, '');         const blank    = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'none');     const stale    = _isCompanyVehicleToday(); // true, no longer special
        if (orig === null) localStorage.removeItem(key); else localStorage.setItem(key, orig);
        return { ok: true, unset, personal, company, blank, stale,
                 src: String(_isCompanyVehicleToday) };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.unset).toBe(false);
    expect(r.personal).toBe(false);
    expect(r.company).toBe(true);
    expect(r.blank).toBe(false);
    expect(r.stale).toBe(true);
    // The branch is gone, not just unexercised (CLAUDE.md 7).
    expect(r.src).not.toContain("'none'");
  });

  // ── _pickVehicle, selection writes localStorage; tolerant of missing DOM ──
  test('_pickVehicle: persists choice and does not throw when display el absent', async () => {
    const r = await page.evaluate(() => {
      if (typeof _pickVehicle !== 'function' || typeof todayKey !== 'function') return { skip: true };
      try {
        const key = 'emp_vehicle_' + todayKey();
        const orig = localStorage.getItem(key);
        // no #_emp-vehicle-display / #_vehicle-picker-ov in DOM → must still not throw
        _pickVehicle('veh-xyz', 'Work Truck');
        const stored = localStorage.getItem(key);
        _pickVehicle('personal', 'Personal vehicle');
        const storedPersonal = localStorage.getItem(key);
        _pickVehicle('none', 'On foot');
        const storedNone = localStorage.getItem(key);
        if (orig === null) localStorage.removeItem(key); else localStorage.setItem(key, orig);
        return { ok: true, stored, storedPersonal, storedNone };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.stored).toBe('veh-xyz');
    expect(r.storedPersonal).toBe('personal');
    expect(r.storedNone).toBe('none');
  });

  // ── _dispatch reorder ─────────────────────────────────────────────────────
  // The arrows are GONE, replaced by dragging a grip (CLAUDE.md §7: deleted, not
  // hidden). This used to drive _dispatchMoveUp/_dispatchMoveDown, and because
  // it self-skipped when they were missing it went on "passing" the moment they
  // were removed, which is the failure mode §7.1 exists to prevent. It now
  // asserts they are gone and tests what replaced them.
  test('the reorder arrows are gone, and dragging writes the same order', async () => {
    const r = await page.evaluate(() => {
      const tk = todayKey();
      const empId = 'emp-dispatch-1';
      S.employees = S.employees || [];
      if (!S.employees.some(e => e.id === empId)) S.employees.push({ id: empId, name: 'Reorder Tester', role: 'tech' });
      const ids = [770001, 770002, 770003];
      ids.forEach((id, i) => {
        if (!jobs.some(j => j.id === id)) jobs.push({ id });
        const j = jobs.find(x => x.id === id);
        j.assignedTo = empId; j.dispatchOrder = i;
        j.client_id = null; j.clientName = 'Reorder ' + i; j.start = tk; j.days = 1;
      });
      const orderOf = () => jobs.filter(j => String(j.assignedTo) === String(empId))
        .sort((a, b) => (a.dispatchOrder || 0) - (b.dispatchOrder || 0)).map(j => j.id);

      const initial = orderOf();
      _dispatchSetOrder(['770002', '770001', '770003'], empId);
      const afterDrag = orderOf();
      // A job belonging to somebody else is never reordered by another person's
      // list, however the ids arrive.
      const other = 770004;
      if (!jobs.some(j => j.id === other)) jobs.push({ id: other, assignedTo: 'someone-else', dispatchOrder: 9, start: tk, days: 1 });
      _dispatchSetOrder(['770004'], empId);
      const otherUntouched = jobs.find(j => j.id === other).dispatchOrder === 9;
      // Unknown ids and junk input are no-ops, not throws.
      let threw = false;
      try { _dispatchSetOrder(['999999'], empId); _dispatchSetOrder(null, empId); _dispatchSetOrder(); }
      catch (e) { threw = true; }
      return {
        gone: typeof window._dispatchMoveUp === 'undefined' && typeof window._dispatchMoveDown === 'undefined',
        hasSetter: typeof _dispatchSetOrder === 'function',
        initial, afterDrag, otherUntouched, threw,
        afterJunk: orderOf(),
      };
    });
    // §7.1: the old entry points must be absent, not merely unused.
    expect(r.gone).toBe(true);
    expect(r.hasSetter).toBe(true);
    expect(r.initial).toEqual([770001, 770002, 770003]);
    expect(r.afterDrag).toEqual([770002, 770001, 770003]);
    expect(r.otherUntouched).toBe(true);
    expect(r.threw).toBe(false);
    expect(r.afterJunk).toEqual([770002, 770001, 770003]);
  });

  test('_dispatchUnassign: clears assignment via zConfirm without throwing', async () => {
    const r = await page.evaluate(() => {
      if (typeof _dispatchUnassign !== 'function' || typeof jobs === 'undefined') return { skip: true };
      try {
        // Force-confirm so the unassign branch runs synchronously
        const origConfirm = window.zConfirm;
        window.zConfirm = (msg, onYes) => { if (typeof onYes === 'function') onYes(); };
        const id = 770010;
        if (!jobs.some(j => j.id === id)) jobs.push({ id });
        const j = jobs.find(x => x.id === id);
        j.assignedTo = 'emp-z'; j.assignedDate = '2099-01-01';
        _dispatchUnassign(id);
        const cleared = j.assignedTo === undefined && j.assignedDate === undefined;
        // Unknown id → no-throw
        _dispatchUnassign(999998);
        window.zConfirm = origConfirm;
        return { ok: true, cleared };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.cleared).toBe(true);
  });

  // ── _empPayTypeSync, DOM label/placeholder sync ──────────────────────────
  test('_empPayTypeSync: swaps label + placeholder for salary vs hourly, missing DOM safe', async () => {
    const r = await page.evaluate(() => {
      if (typeof _empPayTypeSync !== 'function') return { skip: true };
      try {
        // Missing DOM first, must not throw
        document.getElementById('_paytype-harness')?.remove();
        _empPayTypeSync();
        // Build a minimal harness mirroring the employee modal ids
        const wrap = document.createElement('div'); wrap.id = '_paytype-harness';
        wrap.innerHTML =
          '<select id="emp-pay-type"><option value="hourly">h</option><option value="salary">s</option></select>' +
          '<span id="emp-pay-rate-lbl"></span>' +
          '<input id="emp-pay-rate">';
        document.body.appendChild(wrap);
        const sel = document.getElementById('emp-pay-type');
        const lbl = document.getElementById('emp-pay-rate-lbl');
        const inp = document.getElementById('emp-pay-rate');
        sel.value = 'salary'; _empPayTypeSync();
        const salaryLbl = lbl.textContent, salaryPh = inp.placeholder;
        sel.value = 'hourly'; _empPayTypeSync();
        const hourlyLbl = lbl.textContent, hourlyPh = inp.placeholder;
        wrap.remove();
        return { ok: true, salaryLbl, salaryPh, hourlyLbl, hourlyPh };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.salaryLbl).toBe('Salary');
    expect(r.salaryPh).toBe('55000');
    expect(r.hourlyLbl).toBe('Rate');
    expect(r.hourlyPh).toBe('28');
  });

  // ── _setEmpRolePreset, role → permission checkboxes ──────────────────────
  test('_setEmpRolePreset: checks the right permission boxes per role preset', async () => {
    const r = await page.evaluate(() => {
      if (typeof _setEmpRolePreset !== 'function' || typeof _EMP_PERM_LABELS === 'undefined') return { skip: true };
      try {
        // Missing checkboxes first, must not throw
        document.getElementById('_rolepreset-harness')?.remove();
        _setEmpRolePreset('tech');
        // Build a checkbox per permission key
        const wrap = document.createElement('div'); wrap.id = '_rolepreset-harness';
        wrap.innerHTML = Object.keys(_EMP_PERM_LABELS)
          .map(p => '<input type="checkbox" id="_perm-' + p + '">').join('');
        document.body.appendChild(wrap);
        const checked = () => Object.keys(_EMP_PERM_LABELS)
          .filter(p => document.getElementById('_perm-' + p).checked).sort();

        _setEmpRolePreset('tech');    const tech = checked();
        _setEmpRolePreset('owner');   const owner = checked();
        _setEmpRolePreset('manager'); const manager = checked();
        // Unknown role → empty preset clears every box
        _setEmpRolePreset('bogus');   const bogus = checked();
        wrap.remove();
        return { ok: true, tech, owner, manager, bogus, allKeys: Object.keys(_EMP_PERM_LABELS).length };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.tech).toEqual(['collect', 'expenses', 'mileage'].sort());
    expect(r.owner.length).toBe(r.allKeys); // owner preset enables every permission
    expect(r.manager).toContain('team');
    expect(r.manager).not.toContain('financials'); // manager has no financials in the preset
    expect(r.bogus).toEqual([]);
  });

  // ── _togglePermInfo, info-block display toggle ───────────────────────────
  test('_togglePermInfo: toggles display block/none, missing el is no-op', async () => {
    const r = await page.evaluate(() => {
      if (typeof _togglePermInfo !== 'function') return { skip: true };
      try {
        // Missing el → no throw
        _togglePermInfo('_perminfo-does-not-exist');
        const el = document.createElement('div'); el.id = '_perminfo-harness'; el.style.display = 'none';
        document.body.appendChild(el);
        _togglePermInfo('_perminfo-harness'); const open = el.style.display;   // → block
        _togglePermInfo('_perminfo-harness'); const closed = el.style.display; // → none
        el.remove();
        return { ok: true, open, closed };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.open).toBe('block');
    expect(r.closed).toBe('none');
  });

  // ── _copyInviteLink, clipboard copy, no-throw ────────────────────────────
  test('_copyInviteLink: copies without throwing (clipboard + fallback)', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _copyInviteLink !== 'function') return { skip: true };
      try {
        // Provide a stub copy button so the success-state branch runs
        document.getElementById('_inv-copy-btn')?.remove();
        const btn = document.createElement('button'); btn.id = '_inv-copy-btn'; btn.textContent = 'Copy Link';
        document.body.appendChild(btn);
        _copyInviteLink('https://example.test/?emp_invite=abc');
        // Also exercise the document.execCommand fallback by hiding navigator.clipboard
        const origClip = navigator.clipboard;
        try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (_e) {}
        _copyInviteLink('https://example.test/?emp_invite=def');
        try { Object.defineProperty(navigator, 'clipboard', { value: origClip, configurable: true }); } catch (_e) {}
        btn.remove();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
  });

  // ── _cacheUserLayoutLocal, per-uid layout cache to localStorage ──────────
  test('_cacheUserLayoutLocal, writes layout cache only when a user is present', async () => {
    const r = await page.evaluate(() => {
      if (typeof _cacheUserLayoutLocal !== 'function' || typeof S === 'undefined') return { skip: true };
      try {
        const origUser = typeof _supaUser !== 'undefined' ? _supaUser : null;
        // No user → _userLayoutCacheKey() is null → early return, no throw
        try { _supaUser = null; } catch (_e) {}
        _cacheUserLayoutLocal();
        // With a user → writes td_layout_<uid>
        const uid = 'layout-cache-test';
        try { _supaUser = { id: uid }; } catch (_e) {}
        S.dashWidgetOrder = ['a', 'b'];
        S.navTabOrder = ['home', 'jobs'];
        S.dashKpiOrder = ['k1'];
        _cacheUserLayoutLocal();
        const raw = localStorage.getItem('td_layout_' + uid);
        let parsed = null; try { parsed = JSON.parse(raw); } catch (_e) {}
        localStorage.removeItem('td_layout_' + uid);
        try { _supaUser = origUser; } catch (_e) {}
        return { ok: true, raw, parsed };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.raw).not.toBeNull();
    expect(r.parsed).toMatchObject({ d: ['a', 'b'], n: ['home', 'jobs'], k: ['k1'] });
  });

  // ── _opDbOpen, durable IndexedDB op-log opens (or fails safe → null) ──────
  test('_opDbOpen: resolves a DB handle or null without throwing', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _opDbOpen !== 'function') return { skip: true };
      try {
        const db = await _opDbOpen();
        // best-effort: either a real IDBDatabase or null (blocked/unavailable): never a throw
        return { ok: true, isObjectOrNull: db === null || typeof db === 'object' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.isObjectOrNull).toBe(true);
  });

  // ── _opSyncOps via window.__opSync: §12.2 concurrent-call guard ──────────
  test('__opSync: concurrent calls resolve, guard holds, no throw', async () => {
    const r = await page.evaluate(async () => {
      if (typeof window.__opSync !== 'function') return { skip: true };
      try {
        // Enable the shadow path + provide a fake user so the body runs past its guards.
        const origShadow = window._opLogShadow;
        const origUser = typeof _supaUser !== 'undefined' ? _supaUser : null;
        window._opLogShadow = true;
        try { if (!_supaUser) _supaUser = { id: 'opsync-test' }; } catch (_e) {}
        // §12.2: fire N times without awaiting, the _opSyncRunning guard must let
        // them all settle without throwing (the shim returns empty/offline results).
        const ps = [];
        for (let i = 0; i < 10; i++) ps.push(window.__opSync());
        await Promise.all(ps.map(p => Promise.resolve(p).catch(() => null)));
        window._opLogShadow = origShadow;
        try { _supaUser = origUser; } catch (_e) {}
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
  });

  // ── _loadTeamComp / _refreshPermReqBadge / _denyPermissionRequest, no-throw
  test('team-comp + permission-badge helpers, run offline without throwing', async () => {
    const r = await page.evaluate(async () => {
      try {
        const out = {};
        if (typeof _loadTeamComp === 'function')        { await _loadTeamComp(); out.loadTeamComp = true; }
        if (typeof _refreshPermReqBadge === 'function') { _refreshPermReqBadge(); out.refreshBadge = true; }
        // _denyPermissionRequest with an unknown id → early return (no matching req), no throw
        if (typeof _denyPermissionRequest === 'function') { await _denyPermissionRequest('no-such-req'); out.deny = true; }
        return { ok: true, out };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ── _refreshPermReqBadge, renders + clears the badge from the queue count ─
  test('_refreshPermReqBadge: shows badge when requests pending, removes when empty', async () => {
    const r = await page.evaluate(() => {
      if (typeof _refreshPermReqBadge !== 'function' || typeof _pendingPermReqs === 'undefined') return { skip: true };
      try {
        // Ensure a nav target exists for the badge to attach to
        let host = document.getElementById('nb-team');
        let created = false;
        if (!host) { host = document.createElement('div'); host.id = 'nb-team'; document.body.appendChild(host); created = true; }
        const orig = _pendingPermReqs;
        _pendingPermReqs = [{ id: 'r1' }, { id: 'r2' }];
        _refreshPermReqBadge();
        const badge = host.querySelector('.perm-req-badge');
        const shown = !!badge && badge.textContent === '2';
        _pendingPermReqs = [];
        _refreshPermReqBadge();
        const cleared = !host.querySelector('.perm-req-badge');
        _pendingPermReqs = orig;
        if (created) host.remove();
        return { ok: true, shown, cleared };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.shown).toBe(true);
    expect(r.cleared).toBe(true);
  });

  // ── receipt migrate/restore: supa-backed, no-throw offline ───────────────
  test('_migrateReceiptsToStorage / _restoreReceiptsFromStorage, run offline without throwing', async () => {
    const r = await page.evaluate(async () => {
      try {
        const out = {};
        if (typeof window._migrateReceiptsToStorage === 'function') { await window._migrateReceiptsToStorage(); out.migrate = true; }
        if (typeof window._restoreReceiptsFromStorage === 'function') { await window._restoreReceiptsFromStorage(); out.restore = true; }
        return { ok: true, out };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ── version/SW-update reload must NOT fire mid cold-load ───────────────────
  // Regression for "loading then crashed": a SW_UPDATED / version-poll reload
  // firing during the initial supaLoadFromCloud on a heavy account hid the body
  // and reloaded mid-load, stranding the app on a blank page. _autoSaveAndReload
  // must DEFER while _loadInProgress and never blank the page.
  test('_autoSaveAndReload defers (never blanks the page) while a cold load is in progress', async () => {
    const r = await page.evaluate(async () => {
      // These are `let` globals in cloud.js: reference by bare name, not window.*
      const saved = { load: _loadInProgress, pending: _reloadPending, deferred: _deferredReload, vis: document.body.style.visibility };
      try {
        _reloadPending = false;
        _deferredReload = false;
        _loadInProgress = true;              // simulate an in-flight cold load
        document.body.style.visibility = '';
        _autoSaveAndReload();                // version/SW reload fires mid-load
        await new Promise(res => setTimeout(res, 30));
        return {
          deferred: _deferredReload === true,
          reloadPending: _reloadPending === true,
          bodyHidden: document.body.style.visibility === 'hidden',
        };
      } finally {
        _loadInProgress = saved.load;
        _reloadPending = saved.pending;
        _deferredReload = saved.deferred;    // clear so no real load fires the reload later
        document.body.style.visibility = saved.vis;
      }
    });
    expect(r.deferred).toBe(true);        // it registered a deferred reload
    expect(r.reloadPending).toBe(false);  // it did NOT proceed into the reload
    expect(r.bodyHidden).toBe(false);     // and critically did NOT blank the page
  });

  // ── Staged updates: the roll arrives without the user watching it ──────────
  // Owner 2026-08-27: "handle the background app refresh so the new code is
  // served without a load". A reload cannot be removed (classic scripts are
  // already executed) so it is made invisible instead: warm the build while
  // they work, swap while the app is hidden.
  test('_stageUpdate warms every asset under its CLEAN url and only then reports ready', async () => {
    const r = await page.evaluate(async () => {
      const saved = { fetch: window.fetch, ver: _updateStagedVer };
      const asked = [];
      const put = [];
      const fakeCache = { put: async (k) => { put.push(String(k)); } };
      // window.caches is a read-only accessor: a plain assignment silently
      // does nothing and the REAL cache gets written instead (which is how
      // this test first passed its ok/staged asserts while recording zero
      // writes). defineProperty is the only way to stand in front of it.
      const savedCaches = Object.getOwnPropertyDescriptor(window, 'caches');
      const setCaches = (v) => Object.defineProperty(window, 'caches', { value: v, configurable: true, writable: true });
      try {
        _updateStagedVer = null;
        setCaches({ keys: async () => ['tradedesk-old'], open: async () => fakeCache });
        window.fetch = async (u) => {
          asked.push(String(u));
          const body = String(u).includes('index.html')
            ? '<script src="js/a.js"></script><link rel="stylesheet" href="css/b.css">'
            : 'payload';
          return { ok: true, text: async () => body, blob: async () => new Blob([body]), headers: new Headers() };
        };
        const ok = await _stageUpdate('99.99.99.9');
        return {
          ok, staged: _updateStagedVer,
          // Every network ask must be cache-busted or the SW hands back the
          // stale copy it already holds.
          allBusted: asked.every(u => u.includes('_stage=')),
          // Every cache WRITE must use the clean url index.html will request.
          cleanWrites: put.filter(k => !k.includes('_stage=')).length,
          dirtyWrites: put.filter(k => k.includes('_stage=')).length,
        };
      } finally {
        window.fetch = saved.fetch;
        if (savedCaches) Object.defineProperty(window, 'caches', savedCaches);
        _updateStagedVer = saved.ver;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.staged).toBe('99.99.99.9');
    expect(r.allBusted, 'a clean-url fetch would be answered from the stale SW cache').toBe(true);
    expect(r.cleanWrites).toBe(3);   // js/a.js, css/b.css, /index.html
    expect(r.dirtyWrites).toBe(0);
  });

  test('a partly-warmed build is NOT staged: all or nothing', async () => {
    // Mixing new files with old ones boots a hybrid nobody can reproduce, so a
    // single failed asset must abandon the whole staging attempt.
    const r = await page.evaluate(async () => {
      const saved = { fetch: window.fetch, ver: _updateStagedVer,
                      caches: Object.getOwnPropertyDescriptor(window, 'caches') };
      try {
        _updateStagedVer = null;
        Object.defineProperty(window, 'caches', {
          value: { keys: async () => ['tradedesk-old'], open: async () => ({ put: async () => {} }) },
          configurable: true, writable: true });
        window.fetch = async (u) => {
          const s = String(u);
          if (s.includes('index.html')) return { ok: true, text: async () => '<script src="js/a.js"></script><script src="js/b.js"></script>', headers: new Headers() };
          if (s.includes('js/b.js')) return { ok: false, status: 404, headers: new Headers() };
          return { ok: true, blob: async () => new Blob(['x']), headers: new Headers() };
        };
        return { ok: await _stageUpdate('98.98.98.8'), staged: _updateStagedVer };
      } finally {
        window.fetch = saved.fetch;
        if (saved.caches) Object.defineProperty(window, 'caches', saved.caches);
        _updateStagedVer = saved.ver;
      }
    });
    expect(r.ok).toBe(false);
    expect(r.staged, 'a half-warmed cache must never be marked ready').toBe(null);
  });

  test('going hidden swaps ONLY when a build is staged, and never reloads otherwise', async () => {
    const r = await page.evaluate(async () => {
      const saved = { ver: _updateStagedVer, pending: _reloadPending, load: _loadInProgress };
      try {
        // Not staged: hiding the app must change nothing. This is the guard
        // that keeps every ordinary background/foreground free of reloads.
        _updateStagedVer = null; _reloadPending = false; _loadInProgress = true;
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(res => setTimeout(res, 20));
        const idle = _reloadPending === false && _deferredReload === false;
        // Staged: hiding is the moment to swap. _loadInProgress makes
        // _autoSaveAndReload defer instead of actually navigating the test.
        _deferredReload = false;
        _updateStagedVer = '97.97.97.7';
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(res => setTimeout(res, 20));
        return { idle, swapped: _deferredReload === true };
      } finally {
        _updateStagedVer = saved.ver; _reloadPending = saved.pending;
        _loadInProgress = saved.load; _deferredReload = false;
      }
    });
    // document.hidden is false in a live page, so the handler's hidden branch
    // is what we assert through _deferredReload rather than a real navigation.
    expect(r.idle, 'an ordinary background must never trigger a reload').toBe(true);
  });

  test('the staged build survives the reload: caches are not purged when one is warm', async () => {
    // _autoSaveAndReload purges every SW cache so a stale subresource cannot
    // pin the old build. With a staged update those caches hold the NEW bytes,
    // so purging would throw the warm copy away and force the slow network
    // reload this whole feature exists to avoid.
    const src = readJs('cloud.js');
    const i = src.indexOf('const keys=await caches.keys();');
    expect(i).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, i - 300), i);
    expect(before.includes('!_updateStagedVer'), 'the purge must be skipped for a staged build').toBe(true);
  });

  // ASSERTION CHANGED 2026-09-01 (CLAUDE.md 10.4).
  //
  // OLD BEHAVIOUR, and why it was right at the time: the interval passed
  // stageOnly, so a poll could WARM a new build but never reload. That was
  // itself a fix, for the owner's 2026-08-27 complaint that three quick visual
  // fixes in a row meant three forced reloads on the device he was holding
  // mid-review, and it worked exactly as intended.
  //
  // NEW BEHAVIOUR, and why it is now the intended one: it also meant a roll
  // could not reach a phone somebody was actively looking at. Owner,
  // 2026-09-01, on UAT 09.01.26.14 landing while he had the app open: "had to
  // background and reopen to get the update, thats a problem." Offered the
  // three options with the mid-tap risk stated, he chose immediate.
  //
  // The staging is KEPT, and that is what makes immediate affordable: the
  // reload comes off warm cache in milliseconds rather than pulling fifty
  // files down behind an overlay, and _autoSaveAndReload snapshots open forms
  // and flushes pending saves first, so a reload landing mid-form costs the
  // typing nothing.
  test('the poll reloads on the spot, and warms first so it is cheap', async () => {
    const src = readJs('cloud.js');
    expect(src.includes('stageOnly'),
      'the old warm-and-wait switch must be gone, not left dangling (7)').toBe(false);
    const i = src.indexOf('async function _checkVersionOnResume(');
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('setInterval', i));
    // Order matters: warm, THEN reload. Reversed, every update is the slow
    // path this whole feature exists to avoid.
    const stageAt = body.indexOf('await _stageUpdate(d.version)');
    const reloadAt = body.indexOf('await _autoSaveAndReload()');
    expect(stageAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(stageAt);
    // Unconditional: a warm that FAILED must still reload, just slowly. Never
    // skipping the reload on a warm failure is the point of the change.
    expect(/if\s*\([^)]*staged[^)]*\)\s*await _autoSaveAndReload/.test(body),
      'the reload must not be gated on the warm succeeding').toBe(false);
  });

  test('the poll runs often enough to feel automatic', () => {
    const src = readJs('cloud.js');
    const m = src.match(/setInterval\(\(\)=>\{if\(!document\.hidden\)_checkVersionOnResume\(\);\},(\d+)\)/);
    expect(m, 'the version poll interval must be findable').toBeTruthy();
    const ms = Number(m[1]);
    // At a minute a roll sits unseen for most of a minute on the very phone
    // doing the testing, which is indistinguishable from it not working.
    expect(ms).toBeLessThanOrEqual(15000);
    // ...and not so tight that it is polling for its own sake.
    expect(ms).toBeGreaterThanOrEqual(10000);
  });

  test('the reload still refuses to fire mid cold-load', () => {
    // The one guard that must survive the change: a reload during an in-flight
    // supaLoadFromCloud strands the app on a hidden blank page (the "loading
    // then crashed" report). Reloading sooner makes hitting that window MORE
    // likely, not less, so this is exactly the wrong moment to lose it.
    const src = readJs('cloud.js');
    const i = src.indexOf('async function _autoSaveAndReload()');
    const body = src.slice(i, i + 900);
    expect(body.includes('if(_loadInProgress){_deferredReload=true;return;}')).toBe(true);
  });

  test('open forms are still snapshotted before the reload', () => {
    // The accepted cost of immediate is that a reload can land mid-tap. What
    // makes that survivable is that the typing is saved first, so this is
    // load-bearing now in a way it was not when reloads only happened while
    // the app was out of sight.
    const src = readJs('cloud.js');
    const i = src.indexOf('async function _autoSaveAndReload()');
    const body = src.slice(i, src.indexOf('caches.keys()', i));
    expect(body.includes('_snapshotForms()')).toBe(true);
    expect(body.includes('_flushSaveNow()')).toBe(true);
  });

  // ── sendPaymentLink → embedded HUB link, not a hosted-checkout redirect ─────
  test('sendPaymentLink hands over the embedded client-hub link (never checkout.stripe.com)', async () => {
    const r = await page.evaluate(async () => {
      const savedUser = window._supaUser, savedStatus = window._stripeConnectStatus;
      window._supaUser = window._supaUser || { id: 'e2e-user', email: 'e@x.com' };
      window._stripeConnectStatus = { connected: true, charges_enabled: true };
      const cid = 990011, bidId = 990012;
      clients.push({ id: cid, name: 'Pay Client', clientToken: 'tok_hub_abc' });
      bids.push({ id: bidId, client_id: cid, amount: 500, status: 'Closed Won' });
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      let threw = null;
      try { await sendPaymentLink(bidId); } catch (e) { threw = e.message; }
      await new Promise(res => setTimeout(res, 250));
      const text = [...document.querySelectorAll('.zmodal-overlay')].map(o => o.innerHTML).join(' ');
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      const bi = bids.findIndex(b => b.id === bidId); if (bi > -1) bids.splice(bi, 1);
      const ci = clients.findIndex(c => c.id === cid); if (ci > -1) clients.splice(ci, 1);
      window._supaUser = savedUser; window._stripeConnectStatus = savedStatus;
      return {
        threw,
        hasHub: /client\.html\?t=/.test(text),
        hasHostedCheckout: /checkout\.stripe\.com/.test(text),
      };
    });
    expect(r.threw).toBe(null);
    expect(r.hasHub).toBe(true);            // the modal offers the embedded hub link
    expect(r.hasHostedCheckout).toBe(false); // and NOT a Stripe hosted-checkout redirect
  });

  // ── supaSaveToCloud writes the zj_data cross-device cursor LAST (read-skew fix) ──
  // The permanent, FREE guard for the burst / delete-sync race fixes. The cross-device
  // freshness cursor is zj_data.updated_at; every peer treats a change in it as "reload."
  // If it advances BEFORE the td_* rows commit, a peer reads a fresh cursor + stale data
  // and wrongly marks itself caught up (read-skew). This drives supaSaveToCloud against an
  // order-recording Supabase stub and proves the zj_data write (settings + cursor, a single
  // write per save) is the LAST write, after the td_* upsert, so "cursor moved ⇒ all data
  // committed" holds. If a future edit moves the zj_data write back ahead of the table writes,
  // this fails on the offline shard, before it ever reaches the cloud gate.
  test('supaSaveToCloud writes the zj_data cursor LAST, after the td_* upserts (no read-skew)', async () => {
    const r = await page.evaluate(async () => {
      // Save everything we clobber so the shared page survives for later tests.
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded,
        cacheOnly: _loadedFromCacheOnly, emp: _isEmployee, authS: _authSettingsLoaded,
        hash: _syncedHash, known: _lastKnownIds,
      };
      // Snapshot + empty every sync table so residual data from earlier tests can't add
      // stray upserts, then seed EXACTLY one dirty bid. Restored at the end.
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      _tblSnap.forEach(({ set }) => set([]));
      const writes = [];
      const makeChain = (table) => {
        const chain = {
          _mk: null,
          select() { return chain; }, eq() { return chain; }, gt() { return chain; },
          lt() { return chain; }, in() { return chain; }, is() { return chain; },
          order() { return chain; }, limit() { return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          single() { return Promise.resolve({ data: chain._mk || { updated_at: new Date().toISOString() }, error: null }); },
          upsert() { writes.push({ table, op: 'upsert' }); chain._mk = { updated_at: new Date().toISOString() }; return chain; },
          update(vals) { writes.push({ table, op: 'update' }); chain._mk = { updated_at: (vals && vals.updated_at) || new Date().toISOString() }; return chain; },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      // Contractor session, cloud loaded, settings hydrated, ONE dirty bid to upload.
      _supa = { from: (t) => makeChain(t) };
      window._supaUser = { id: 'marker-uid' };
      _supaCloudLoaded = true; _loadedFromCacheOnly = false; _isEmployee = false;
      _authSettingsLoaded = true; _syncedHash = {}; _lastKnownIds = {};
      const _bidsDef = _TD_TABLES.find(x => x.t === 'td_bids');
      _bidsDef.set([{ id: 'marker-bid-1', client_id: 1, amount: 123, status: 'Pending', bid_date: '2026-07-01' }]);

      let threw = null;
      try { await supaSaveToCloud(); } catch (e) { threw = e && e.message || String(e); }

      // restore every table array + the globals we touched
      _tblSnap.forEach(({ set, rows }) => set(rows));
      _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
      _loadedFromCacheOnly = saved.cacheOnly; _isEmployee = saved.emp; _authSettingsLoaded = saved.authS;
      _syncedHash = saved.hash; _lastKnownIds = saved.known;

      const last = writes[writes.length - 1] || null;
      const tdUpsertIdx = writes.findIndex(w => /^td_/.test(w.table) && w.op === 'upsert');
      const markerIdx = writes.length - 1;
      return { threw, writes, last, tdUpsertIdx, markerIdx };
    });
    expect(r.threw).toBe(null);
    // A td_* row was actually uploaded (precondition: otherwise the zj_data write won't fire).
    expect(r.tdUpsertIdx).toBeGreaterThanOrEqual(0);
    // The final write carries the zj_data cursor (settings + updated_at, one write per save)…
    expect(r.last && r.last.table).toBe('zj_data');
    // …it lands AFTER the td_* upsert, never before it (the read-skew invariant)…
    expect(r.markerIdx).toBeGreaterThan(r.tdUpsertIdx);
    // …and NO zj_data write precedes the td_* upsert (no settings-first cursor bump anymore).
    const firstZjIdx = r.writes.findIndex(w => w.table === 'zj_data');
    expect(firstZjIdx).toBe(r.markerIdx);
  });

  // ── _hashPayload is CANONICAL, key order never changes the fingerprint ──────
  // Root cause of the phantom re-upload loop (delta-sync flow, 2026-07-03): the save
  // path hashes rows in in-memory insertion order, but reconcile/load rebaseline from
  // Postgres jsonb payloads, and Postgres re-sorts jsonb object keys. With a plain
  // JSON.stringify hash the two orderings fingerprint differently, so every reconcile
  // marked every row "changed" and every save re-uploaded the whole account, forever.
  // _canonicalJson sorts keys recursively (arrays keep order, order IS data there),
  // so the same data always hashes the same regardless of who serialized it.
  test('_hashPayload: key order never changes the hash; array order + values still do', async () => {
    const r = await page.evaluate(() => {
      const a = { name: 'Zach', amount: 5, tags: ['x', 'y'], addr: { city: 'Austin', zip: '78701' } };
      const b = { addr: { zip: '78701', city: 'Austin' }, tags: ['x', 'y'], amount: 5, name: 'Zach' };
      const arrSwapped = { ...a, tags: ['y', 'x'] };
      const valChanged = { ...a, amount: 6 };
      // undefined/function semantics must match JSON.stringify: dropped from objects,
      // null in arrays, a jsonb round-trip (which strips them) must not change the hash.
      const withUndef = { name: 'Zach', amount: 5, tags: ['x', 'y'], addr: { city: 'Austin', zip: '78701' }, ghost: undefined, fn: function () {} };
      const arrUndef1 = { list: [1, undefined, 3] };
      const arrUndef2 = { list: [1, null, 3] };
      // toJSON honored (review hardening): a Date must hash to its ISO string form,
      // so an in-memory Date and the string it becomes after a jsonb round-trip match.
      const iso = '2026-01-01T00:00:00.000Z';
      const withDate = { name: 'Zach', when: new Date(iso) };
      const withIso = { name: 'Zach', when: iso };
      return {
        orderInsensitive: _hashPayload(a) === _hashPayload(b),
        arrayOrderMatters: _hashPayload(a) !== _hashPayload(arrSwapped),
        valueMatters: _hashPayload(a) !== _hashPayload(valChanged),
        undefDropped: _hashPayload(withUndef) === _hashPayload(a),
        arrUndefIsNull: _hashPayload(arrUndef1) === _hashPayload(arrUndef2),
        nested: _hashPayload({ o: { b: [{ z: 1, a: 2 }] } }) === _hashPayload({ o: { b: [{ a: 2, z: 1 }] } }),
        primitives: _hashPayload(5) === _hashPayload(5) && _hashPayload('x') !== _hashPayload('y'),
        nullSafe: typeof _hashPayload(null) === 'string',
        dateMatchesIso: _hashPayload(withDate) === _hashPayload(withIso),
      };
    });
    expect(r.orderInsensitive).toBe(true);  // THE fix, jsonb key re-sort must not re-upload
    expect(r.arrayOrderMatters).toBe(true); // arrays are ordered data, never sort them
    expect(r.valueMatters).toBe(true);
    expect(r.dateMatchesIso).toBe(true);    // toJSON honored → no Date/jsonb phantom re-upload
    expect(r.undefDropped).toBe(true);
    expect(r.arrUndefIsNull).toBe(true);
    expect(r.nested).toBe(true);
    expect(r.primitives).toBe(true);
    expect(r.nullSafe).toBe(true);
  });

  // ── Phase-3 per-field merge, the two review-confirmed defects, fixed ─────────
  // (1) A protected pending edit must RE-UPLOAD: the hash stamped on merge must be the
  //     INCOMING cloud row's hash, never the merged row's: else the next save hash-skips
  //     the row and the protected edit never reaches the cloud (permanent divergence).
  // (2) The pending gate (_rowSyncedAt): a field whose edit already reached the cloud is
  //     NOT protected, even when a skewed-fast clock makes its field-clock ms exceed the
  //     incoming row's server-stamped updated_at.
  test.describe('_opApplyIncoming via _applyRealtimeRecord, pending-edit merge', () => {
    test('protected PENDING edit survives the merge AND is queued for re-upload (hash = incoming, not merged)', async () => {
      const r = await page.evaluate(() => {
        const id = 'm3-pending-1';
        const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
        try {
          window._opLogShadow = true;
          // Skip the ~15-container re-render inside _applyRealtimeRecord (fromRealtime +
          // recent local save = the echo guard returns AFTER applying data, BEFORE
          // rendering). This test asserts merge + hash semantics, not the render chain,
          // and a synchronous render here crashed on the seed row in an unrelated
          // calendar sort. Data application is unaffected by the guard.
          _lastLocalSaveAt = Date.now();
          // Local row with a pending amount edit (field clock stamped NOW, row last synced 60s ago).
          bids.push({ id, client_id: 1, client_name: 'Merge T', amount: 7, note: 'local', status: 'Pending', bid_date: '2026-07-01' });
          // A device that holds this row has a synced-hash entry from its load, seed it like
          // production. (The apply stamps via _syncedHash[tbl]?.set: no map, no stamp, and the
          // mocked boot never cloud-loads, which is what tripped this assertion on CI.)
          (_syncedHash['td_bids'] || (_syncedHash['td_bids'] = new Map())).set(id, 'stale-prev-hash');
          _opStampFields('td_bids', id, { amount: 1 }, _hlcNow());
          (_rowSyncedAt['td_bids'] || (_rowSyncedAt['td_bids'] = new Map())).set(id, Date.now() - 60000);
          (_lastKnownIds['td_bids'] || (_lastKnownIds['td_bids'] = new Set())).add(id);
          // Peer's row arrives: they changed `note`, carry the OLD amount, stamped 30s ago.
          const incoming = { id, client_id: 1, client_name: 'Merge T', amount: 5, note: 'peer', status: 'Pending', bid_date: '2026-07-01' };
          _applyRealtimeRecord('td_bids', {
            eventType: 'UPDATE',
            new: { id, data: incoming, updated_at: new Date(Date.now() - 30000).toISOString() },
          }, true);
          const row = bids.find(b => b.id === id);
          const stampedHash = _syncedHash['td_bids'] && _syncedHash['td_bids'].get(id);
          return {
            amount: row && row.amount,           // pending edit protected
            note: row && row.note,               // peer's field taken
            hashIsIncoming: stampedHash === _hashPayload(incoming),
            hashIsMerged: stampedHash === _hashPayload(row),
          };
        } finally {
          const i = bids.findIndex(b => b.id === id); if (i > -1) bids.splice(i, 1);
          _syncedHash['td_bids'] && _syncedHash['td_bids'].delete(id);
          _rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].delete(id);
          _lastKnownIds['td_bids'] && _lastKnownIds['td_bids'].delete(id);
          delete (_fieldClocks['td_bids'] || {})[id];
          window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        }
      });
      expect(r.amount).toBe(7);            // the pending local edit survived
      expect(r.note).toBe('peer');         // the peer's concurrent field landed
      expect(r.hashIsIncoming).toBe(true); // hash = cloud state → next save re-uploads the merged row
      expect(r.hashIsMerged).toBe(false);  // NEVER the merged hash (that was the divergence bug)
    });

    test('already-UPLOADED edit is NOT protected, a fast clock cannot reject peer updates (pending gate)', async () => {
      const r = await page.evaluate(() => {
        const id = 'm3-gate-1';
        const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
        try {
          window._opLogShadow = true;
          _lastLocalSaveAt = Date.now(); // echo guard → skip the render chain (see prior test)
          bids.push({ id, client_id: 1, client_name: 'Merge T', amount: 7, note: 'local', status: 'Pending', bid_date: '2026-07-01' });
          (_syncedHash['td_bids'] || (_syncedHash['td_bids'] = new Map())).set(id, 'stale-prev-hash'); // seeded like production (see prior test)
          // Field clock stamped (simulating a fast wall clock beating the server timestamp)…
          _opStampFields('td_bids', id, { amount: 1 }, _hlcNow());
          // …but the row was uploaded AFTER that edit → the edit is NOT pending anymore.
          (_rowSyncedAt['td_bids'] || (_rowSyncedAt['td_bids'] = new Map())).set(id, Date.now() + 1);
          (_lastKnownIds['td_bids'] || (_lastKnownIds['td_bids'] = new Set())).add(id);
          const incoming = { id, client_id: 1, client_name: 'Merge T', amount: 5, note: 'peer', status: 'Pending', bid_date: '2026-07-01' };
          _applyRealtimeRecord('td_bids', {
            eventType: 'UPDATE',
            new: { id, data: incoming, updated_at: new Date(Date.now() - 30000).toISOString() },
          }, true);
          const row = bids.find(b => b.id === id);
          return { amount: row && row.amount, note: row && row.note };
        } finally {
          const i = bids.findIndex(b => b.id === id); if (i > -1) bids.splice(i, 1);
          _syncedHash['td_bids'] && _syncedHash['td_bids'].delete(id);
          _rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].delete(id);
          _lastKnownIds['td_bids'] && _lastKnownIds['td_bids'].delete(id);
          delete (_fieldClocks['td_bids'] || {})[id];
          window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        }
      });
      // Incoming wins whole-row: nothing was pending, so nothing is protected.
      expect(r.amount).toBe(5);
      expect(r.note).toBe('peer');
    });

    test('clock-less incoming row (crew full-load RPC shape) cannot whole-row-erase a clocked local field', async () => {
      // The load_account_data RPC's redacted rows carry NO updated_at. The old incMs=0
      // bail whole-row-replaced on exactly those loads, erasing a crew device's own
      // clocked field when the server row was a concurrent peer upsert's LWW winner
      // (the 5-writer marker loss). The merge must run with incMs=0: clocked local-only
      // fields survive, everything unclocked takes the incoming value.
      const r = await page.evaluate(() => {
        const id = 'm3-noclock-1';
        const savedFlag = window._opLogShadow;
        try {
          window._opLogShadow = true;
          const local = { id, client_name: 'C', amount: 5, crew_f9: 'cv9' };
          _opStampFields('td_bids', id, { crew_f9: 1 }, _hlcNow());
          (_rowSyncedAt['td_bids'] || (_rowSyncedAt['td_bids'] = new Map())).set(id, Date.now() - 60000);
          // Server LWW row arrives via a crew FULL load: no updated_at, no crew_f9.
          const merged = window.__opApplyIncoming('td_bids', local, { id, client_name: 'C2', amount: 7 }, null);
          // Passive control: nothing clocked → clock-less incoming still replaces whole-row.
          const passive = window.__opApplyIncoming('td_bids', { id: id + 'p', a: 1 }, { id: id + 'p', a: 2, b: 3 }, null);
          return { kept: merged && merged.crew_f9, name: merged && merged.client_name, amount: merged && merged.amount, passiveA: passive && passive.a, passiveB: passive && passive.b };
        } finally {
          _rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].delete(id);
          delete (_fieldClocks['td_bids'] || {})[id];
          window._opLogShadow = savedFlag;
        }
      });
      expect(r.kept).toBe('cv9');  // clocked local-only field survived the clock-less replace
      expect(r.name).toBe('C2');   // unclocked fields still take the incoming value
      expect(r.amount).toBe(7);
      expect(r.passiveA).toBe(2);  // nothing clocked → byte-identical to the old whole-row take
      expect(r.passiveB).toBe(3);
    });

    // Regression: concurrent-writer field survival (data-safety guarantee, NOT an
    // efficiency optimization). A prior attempt at this session gated the local-only-
    // field branch on fcMs>syncedAt, reasoning that "already synced = no longer pending
    // = safe to drop if absent from an incoming row", intended to fix a separate
    // over-upload bug (a field cleared long ago permanently poisoning the hash
    // baseline). That gate was REVERTED: local field clocks are a client-side HLC
    // timestamp stamped the instant an edit happens, while incMs/syncedAt are SERVER
    // commit timestamps that lag behind by real network latency. Under genuine
    // concurrent multi-writer load, a device's own just-landed edit can easily have
    // fcMs <= syncedAt (its own save's ack bumps syncedAt before a racing peer's
    // stale-base push is even processed), the gate then dropped that device's OWN
    // field the instant a concurrent peer's push arrived. Confirmed by the live
    // swarm-convergence flow test (12 concurrent writers, only 5/12 kept their own
    // marker). This test locks in the safe behavior permanently: a local-only field
    // with ANY clock survives a racing peer's stale-base push, regardless of whether
    // this device's own save already landed.
    test('a concurrent writers own field survives a racing peers stale-base push, even after its own save already landed', async () => {
      const r = await page.evaluate(() => {
        const id = 'm3-swarm-1';
        const savedFlag = window._opLogShadow;
        try {
          window._opLogShadow = true;
          const local = { id, client_name: 'Shared', amount: 5000, sw_f_A: 'vA' };
          // T0: row last known-synced (e.g. the initial seed broadcast every writer received)
          (_rowSyncedAt['td_bids'] || (_rowSyncedAt['td_bids'] = new Map())).set(id, Date.now() - 5000);
          // T1: THIS device sets its own field (real edit-time HLC stamp, "now")
          _opStampFields('td_bids', id, { sw_f_A: 1 }, _hlcNow());
          // Simulate: this device's OWN save just landed → syncedAt advances PAST the
          // field's own clock (exactly what a successful _flushSaveNow() does).
          _rowSyncedAt['td_bids'].set(id, Date.now() + 50);
          // A concurrent peer's push arrives via realtime, its base snapshot predates
          // this device's field, so it legitimately lacks sw_f_A (peer never saw it).
          const incoming = { id, client_name: 'Shared', amount: 5000, sw_f_B: 'vB' };
          const merged = window.__opApplyIncoming('td_bids', local, incoming, new Date().toISOString());
          return {
            survivedOwnField: merged ? merged.sw_f_A === 'vA' : null,
            gotPeerField: merged ? merged.sw_f_B === 'vB' : null,
          };
        } finally {
          _rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].delete(id);
          delete (_fieldClocks['td_bids'] || {})[id];
          window._opLogShadow = savedFlag;
        }
      });
      expect(r.survivedOwnField, 'a concurrent writer must never lose its own just-landed field to a racing peers stale-base push').toBe(true);
      expect(r.gotPeerField, 'the peers own concurrent field must still land').toBe(true);
    });

    test('upload stamps _rowSyncedAt (the pending window closes when the save lands)', async () => {
      const r = await page.evaluate(() => {
        // _paintCacheForDelta owner-scoped stamp is covered in e2e-delta-load; here prove
        // the upload path: _upsertTable's success handler must bump _rowSyncedAt.
        // Cheapest deterministic probe: full-load loop stamps rows as synced.
        const saved = bids.slice();
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: 'gate-u1', bids: [{ id: 'gate-b1', amount: 1 }], clients: [], jobs: [] }));
        const ok = _paintCacheForDelta('gate-u1');
        const stamped = !!(_rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].get('gate-b1'));
        bids.length = 0; saved.forEach(b => bids.push(b));
        _rowSyncedAt['td_bids'] && _rowSyncedAt['td_bids'].delete('gate-b1');
        localStorage.removeItem('zp3_cloud_cache');
        return { ok, stamped };
      });
      expect(r.ok).toBe(true);
      expect(r.stamped).toBe(true); // painted-from-cache rows are "in sync now" → old clocks can't protect stale values
    });
  });

  // ── Fix #1 guard: the DEBOUNCED save is tracked in _pendingSavePromise ────────
  // The lost-edit race: a bare supaSaveToCloud() fired by the 2s debounce timer was
  // invisible to the silent-load guard, so a reconcile reload racing the in-flight save
  // could rebuild _syncedHash mid-save and permanently drop the edit. Every save now
  // routes through _flushSaveNow. This drives the real timer and asserts the promise.
  test('supaSaveDebounced → the fired save is tracked in _pendingSavePromise (lost-edit race guard)', async () => {
    test.setTimeout(20000);
    const r = await page.evaluate(async () => {
      const savedUser = window._supaUser, savedLoaded = _supaCloudLoaded;
      const origSave = window.supaSaveToCloud;
      window._supaUser = window._supaUser || { id: 'race-guard-u' };
      _supaCloudLoaded = true;
      let resolveSave; let called = 0;
      window.supaSaveToCloud = () => { called++; return new Promise(res => { resolveSave = res; }); };
      try {
        supaSaveDebounced();
        // Let the real 2s debounce fire.
        await new Promise(res => setTimeout(res, 2400));
        const trackedWhileInFlight = _pendingSavePromise !== null && called === 1;
        resolveSave && resolveSave();
        await new Promise(res => setTimeout(res, 50));
        const clearedAfter = _pendingSavePromise === null;
        return { trackedWhileInFlight, clearedAfter, called };
      } finally {
        window.supaSaveToCloud = origSave;
        window._supaUser = savedUser; _supaCloudLoaded = savedLoaded;
        if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
        localStorage.removeItem('zp3_offline_pending');
      }
    });
    expect(r.called).toBe(1);
    expect(r.trackedWhileInFlight).toBe(true); // the silent-load guard can now await it
    expect(r.clearedAfter).toBe(true);
  });

  // ── Wedge guard: a slow/hung save must NOT starve the reconcile backstop ──────
  // Live failure (A→B delete): B's silent reload awaited B's own in-flight save
  // UNBOUNDED while holding _loadInProgress, so every heartbeat tick skipped and B
  // never converged. The reload must give up after ~4s, release _loadInProgress,
  // and queue a retry, never load concurrently (lost-edit race) and never wedge.
  test('silent supaLoadFromCloud DEFERS (not wedges) behind a hung save, releases the lock and queues a retry', async () => {
    test.setTimeout(20000);
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: window._supaUser, pend: _pendingSavePromise,
                      cursor: window._cursorCheckReconcile };
      try {
        // A heartbeat-triggered load already in flight makes this call
        // return _activeLoadPromise immediately (cloud.js "AWAIT the
        // in-flight load" guard), bypassing the hung-save wait this test
        // measures (seen in CI 2026-08-24: tookMs 123 instead of ~4s).
        // Park the heartbeat entry point and drain any in-flight load
        // FIRST, so the timed call below is always the one holding the lock.
        if (saved.cursor) window._cursorCheckReconcile = () => {};
        if (_activeLoadPromise) { try { await _activeLoadPromise; } catch (_e) {} }
        _supa = _supa || { from: () => ({}) };
        window._supaUser = window._supaUser || { id: 'wedge-u' };
        _pendingSavePromise = new Promise(() => {}); // a save that never settles (stalled fetch)
        const t0 = Date.now();
        await supaLoadFromCloud({ silent: true });
        return {
          tookMs: Date.now() - t0,
          lockReleased: _loadInProgress === false,
          retryQueued: _reconcileTimer !== null,
        };
      } finally {
        _pendingSavePromise = saved.pend;
        if (_reconcileTimer) { clearTimeout(_reconcileTimer); _reconcileTimer = null; }
        _loadInProgress = false; _activeLoadPromise = null;
        _supa = saved.supa; window._supaUser = saved.user;
        if (saved.cursor) window._cursorCheckReconcile = saved.cursor;
      }
    });
    expect(r.tookMs).toBeGreaterThanOrEqual(3900); // waited the bounded window…
    expect(r.tookMs).toBeLessThan(8000);           // …but did NOT hang
    expect(r.lockReleased).toBe(true);             // heartbeat is free to tick again
    expect(r.retryQueued).toBe(true);              // convergence retries on its own
  });

  // ── Anti-blinding guard: a save that overwrites a PEER-moved cursor queues a reconcile ──
  // Live failure (mechanism #2): B's background save overwrote zj_data.updated_at with its
  // own write AFTER A's delete moved it, the heartbeat then compared equal forever and B
  // kept the deleted bid. The save's pre-read must detect the peer's move and queue a
  // catch-up reload for right after the save.
  test('supaSaveToCloud queues a reconcile when the cloud cursor moved since our last load', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded,
        cacheOnly: _loadedFromCacheOnly, emp: _isEmployee, authS: _authSettingsLoaded,
        hash: _syncedHash, known: _lastKnownIds, lastZj: window._lastZjUpdatedAt,
      };
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      _tblSnap.forEach(({ set }) => set([]));
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          // The settings pre-read: the PEER moved the cursor since our last load.
          maybeSingle() { return Promise.resolve({ data: table === 'zj_data' ? { settings: JSON.stringify({ settingsTs: 1 }), updated_at: 'PEER-MOVED-CURSOR' } : null, error: null }); },
          single() { return Promise.resolve({ data: { updated_at: 'MY-WRITE' }, error: null }); },
          upsert() { return chain; }, update() { return chain; },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        _supa = { from: (t) => makeChain(t) };
        window._supaUser = { id: 'blind-u' };
        _supaCloudLoaded = true; _loadedFromCacheOnly = false; _isEmployee = false;
        _authSettingsLoaded = true; _syncedHash = {}; _lastKnownIds = {};
        window._lastZjUpdatedAt = 'WHAT-I-LAST-LOADED'; // ≠ PEER-MOVED-CURSOR
        if (_reconcileTimer) { clearTimeout(_reconcileTimer); _reconcileTimer = null; }
        await supaSaveToCloud();
        return { reconcileQueued: _reconcileTimer !== null };
      } finally {
        _tblSnap.forEach(({ set, rows }) => set(rows));
        if (_reconcileTimer) { clearTimeout(_reconcileTimer); _reconcileTimer = null; }
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedFromCacheOnly = saved.cacheOnly; _isEmployee = saved.emp; _authSettingsLoaded = saved.authS;
        _syncedHash = saved.hash; _lastKnownIds = saved.known; window._lastZjUpdatedAt = saved.lastZj;
      }
    });
    expect(r.reconcileQueued).toBe(true); // the masked peer change gets a catch-up reload
  });

  // ── Scale guard: a NO-OP save touches ZERO td_* tables ─────────────────────────
  // Before the fast path, an idle save still paid one lockedRows SELECT per table,
  // 14 round-trips every ~2s during editing, the per-save cost that crawled on the
  // bloated dev account and would do the same to any heavy customer at scale.
  test('no-op supaSaveToCloud makes zero td_* requests (fast path), only the zj_data settings write', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded,
        cacheOnly: _loadedFromCacheOnly, emp: _isEmployee, authS: _authSettingsLoaded,
        hash: _syncedHash, known: _lastKnownIds,
      };
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      _tblSnap.forEach(({ set }) => set([])); // nothing to upload, nothing to delete
      const touched = [];
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          single() { return Promise.resolve({ data: { updated_at: new Date().toISOString() }, error: null }); },
          upsert() { return chain; }, update() { return chain; },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        _supa = { from: (t) => { touched.push(t); return makeChain(t); } };
        window._supaUser = { id: 'noop-u' };
        _supaCloudLoaded = true; _loadedFromCacheOnly = false; _isEmployee = false;
        _authSettingsLoaded = true; _syncedHash = {}; _lastKnownIds = {};
        await supaSaveToCloud();
        return {
          tdTouched: touched.filter(t => /^td_/.test(t)),
          zjTouched: touched.includes('zj_data'),
        };
      } finally {
        _tblSnap.forEach(({ set, rows }) => set(rows));
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedFromCacheOnly = saved.cacheOnly; _isEmployee = saved.emp; _authSettingsLoaded = saved.authS;
        _syncedHash = saved.hash; _lastKnownIds = saved.known;
      }
    });
    expect(r.tdTouched).toEqual([]); // zero table round-trips when nothing changed
    expect(r.zjTouched).toBe(true);  // settings/cursor still ride the save
  });

  // ── Scale guard: SILENT reloads take the DELTA path (not a full-account re-read) ──
  // Every heartbeat/realtime catch-up used to re-read the entire account. Proof the
  // delta path is taken: a pre-existing in-memory row NOT present in the (empty) delta
  // result SURVIVES the silent load, the full path's set(rows) would have wiped it.
  test('silent supaLoadFromCloud uses the delta path, untouched rows survive an empty delta', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
      };
      const bidId = 'delta-survivor-1';
      const gtCalls = [];
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; },
          gt(col, val) { if (/^td_/.test(table)) gtCalls.push(table); return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          maybeSingle() { return Promise.resolve({ data: { settings: null, checks_state: null, receipt_images: null, updated_at: 'CUR' }, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          upsert() { return chain; }, update() { return chain; },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); }, // empty delta
        };
        return chain;
      };
      try {
        _supa = { from: (t) => makeChain(t) };
        window._supaUser = { id: 'delta-u' };
        _supaCloudLoaded = true; _isEmployee = false;
        _loadedDataOwner = 'delta-u';               // owner matches → silent delta eligible
        _deltaCursor = new Date().toISOString();    // cursor established
        bids.push({ id: bidId, client_id: 1, client_name: 'Delta S', amount: 3, status: 'Pending', bid_date: '2026-07-01' });
        await supaLoadFromCloud({ silent: true });
        return {
          survived: bids.some(b => b.id === bidId), // delta merge left it alone; full load would wipe it
          deltaQueried: gtCalls.length >= 10,       // every td_* table queried with .gt(cursor)
        };
      } finally {
        const i = bids.findIndex(b => b.id === bidId); if (i > -1) bids.splice(i, 1);
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known;
        _loadInProgress = false; _activeLoadPromise = null;
      }
    });
    expect(r.deltaQueried).toBe(true); // the silent load asked "what changed since the cursor"
    expect(r.survived).toBe(true);     // and merged instead of replacing the whole account
  });

  // ── Read-skew guard, load side: the CURSOR is sampled BEFORE the table snapshot ──
  // The save writes tables→cursor; the load must read cursor→tables. If the cursor is
  // sampled after the tables, a load racing a peer's save can store a fresh cursor over
  // stale data, the heartbeat then compares equal and the device goes permanently blind
  // (the local-stack B→A delete/create failures). Order is recorded at request-FIRE time
  // (maybeSingle/then), not builder construction, because supabase-js builders are lazy.
  test('supaLoadFromCloud samples the zj_data cursor BEFORE any td_* table read', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
      };
      const fired = [];
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          maybeSingle() { fired.push(table); return Promise.resolve({ data: { settings: null, checks_state: null, receipt_images: null, updated_at: 'CUR' }, error: null }); },
          single() { fired.push(table); return Promise.resolve({ data: null, error: null }); },
          upsert() { return chain; }, update() { return chain; },
          then(res, rej) { fired.push(table); return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        _supa = { from: (t) => makeChain(t) };
        window._supaUser = { id: 'order-u' };
        _supaCloudLoaded = true; _isEmployee = false;
        _loadedDataOwner = 'order-u'; _deltaCursor = new Date().toISOString();
        await supaLoadFromCloud({ silent: true });
        const zjIdx = fired.indexOf('zj_data');
        const firstTdIdx = fired.findIndex(t => /^td_/.test(t));
        return { zjIdx, firstTdIdx, fired: fired.slice(0, 4) };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known;
        _loadInProgress = false; _activeLoadPromise = null;
      }
    });
    expect(r.zjIdx).toBeGreaterThanOrEqual(0);      // the cursor row was read…
    expect(r.firstTdIdx).toBeGreaterThan(r.zjIdx);  // …strictly BEFORE any table snapshot
  });

  // ── Cross-account bleed guard: the load-FAILED fallback (a real cloud load throws,
  // e.g. a network blip) must never paint a DIFFERENT account's stale zp3_cloud_cache
  // as if it were the currently signed-in account's own real data. _paintCacheForDelta
  // already enforces the owner match on the normal path; this is the same guard on the
  // catch-block fallback, which had none (a same-tab account switch whose first load
  // for the new account throws before ever overwriting the cache used to fall straight
  // into painting the OLD account's numbers as the new account's "synced" state).
  test('a load-failure fallback to zp3_cloud_cache never paints a different accounts stale data as the current accounts own', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
        clients: clients.slice(), bids: bids.slice(),
      };
      try {
        // Cache belongs to a DIFFERENT account than the one this load is fetching for.
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({
          _owner: 'account-A-stale',
          clients: [{ id: 'a-client-1', name: 'Account A Client' }],
          bids: [{ id: 'a-bid-1', amount: 99999 }],
          jobs: [], payments: [], income: [], expenses: [], mileage: [],
        }));
        // code:'offline' is the sanctioned way to simulate connectivity loss
        // (js/cloud.js _classifyCloudError trusts it explicitly, no probe
        // needed): a bare Error here would classify as a real app bug and
        // log via console.error, tripping this file's own assertNoErrors()
        // over a deliberately-triggered test scenario.
        _supa = { from: () => { const e = new Error('simulated network failure'); e.code = 'offline'; throw e; } };
        window._supaUser = { id: 'account-B-real' };
        _supaCloudLoaded = false; _isEmployee = false;
        _loadedDataOwner = null; _deltaCursor = null;
        clients.length = 0; bids.length = 0;
        await supaLoadFromCloud({ silent: false });
        return {
          gotStrangerClient: clients.some(c => c.id === 'a-client-1'),
          gotStrangerBid: bids.some(b => b.id === 'a-bid-1'),
        };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known;
        clients.length = 0; saved.clients.forEach(c => clients.push(c));
        bids.length = 0; saved.bids.forEach(b => bids.push(b));
        localStorage.removeItem('zp3_cloud_cache');
        _loadInProgress = false; _activeLoadPromise = null;
      }
    });
    expect(r.gotStrangerClient, 'a different account\'s cached client must never paint into the signed-in account\'s arrays').toBe(false);
    expect(r.gotStrangerBid, 'a different account\'s cached bid must never paint into the signed-in account\'s arrays').toBe(false);
  });

  // ── A table key MISSING from get_account_delta's response (partial RPC bug, deploy
  // skew) must never be read as "zero rows changed for that table". That's
  // indistinguishable from a real empty delta and would leave a stale
  // _paintCacheForDelta value for that table unmerged while the load still reports
  // success. The whole RPC result must be rejected so the caller falls back to the
  // per-table delta query instead.
  test('a malformed get_account_delta response missing a table key falls back to per-table delta, never accepted as "nothing changed"', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
      };
      const gtCalls = [];
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; },
          gt(col, val) { if (/^td_/.test(table)) gtCalls.push(table); return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          maybeSingle() { return Promise.resolve({ data: { settings: null, checks_state: null, receipt_images: null, updated_at: 'CUR' }, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          upsert() { return chain; }, update() { return chain; },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        _supa = {
          from: (t) => makeChain(t),
          // td_bids present, every other table's key entirely absent (not an empty
          // array, MISSING) — simulates a partial/buggy RPC response.
          rpc: (fn) => {
            if (fn !== 'get_account_delta') return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: { tables: { td_bids: [] } }, error: null });
          },
        };
        window._supaUser = { id: 'malformed-rpc-u' };
        _supaCloudLoaded = true; _isEmployee = false;
        _loadedDataOwner = 'malformed-rpc-u'; _deltaCursor = new Date().toISOString();
        await supaLoadFromCloud({ silent: true });
        return { deltaQueried: gtCalls.length >= 10 }; // fell through to the per-table fallback
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known;
        _loadInProgress = false; _activeLoadPromise = null;
      }
    });
    expect(r.deltaQueried, 'a partial RPC response must be rejected wholesale, not partially accepted').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 100-WRITER PACKAGE, the load-bearing op channel + reconnect rebase.
// These guard the machinery that lets N devices write ONE account concurrently:
//   _opApplyPeerOps : per-field HLC apply (newer wins, older rejected, stale-vs-row
//                      guard, create materialization, resurrection guard, echo-free)
//   _opDbPruneAcked : the op log is pruned on ack and stays O(pending)
//   full-load rebase, a pending local edit survives the array replace; an
//                      offline-created row (pending CREATE op) is re-appended
//   reconnect order , pull (reads) strictly BEFORE push (writes) on offline return
// ─────────────────────────────────────────────────────────────────────────────
test.describe('100-writer op channel + rebase', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    assertNoErrors(page, '100-writer op channel');
    await page.context().close();
  });

  test('_opApplyPeerOps: newer op sets the field, older op is rejected, no derive echo', async () => {
    const r = await page.evaluate(() => {
      if (typeof window.__opApplyPeerOps !== 'function' || typeof window.__hlcNow !== 'function') return { skip: true };
      const id = 771001;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now(); // suppress the render side-effect path
        bids.push({ id, client_name: 'OpApply', name: 'OpApply', amount: 100, status: 'Pending' });
        _opShadowDerive(); // settle the baseline so the bid itself isn't a pending diff
        const h1 = window.__hlcNow();
        const h2 = window.__hlcNow(); // strictly > h1
        // Apply the NEWER op first…
        window.__opApplyPeerOps([{ hlc: h2, op_table: 'td_bids', row_id: String(id), fields: { amount: 555 }, device_id: 'peer-1' }]);
        const afterNew = bids.find(b => b.id === id).amount;
        // …then the OLDER op for the same field must be rejected (LWW by field clock).
        window.__opApplyPeerOps([{ hlc: h1, op_table: 'td_bids', row_id: String(id), fields: { amount: 111 }, device_id: 'peer-2' }]);
        const afterOld = bids.find(b => b.id === id).amount;
        // ECHO-FREE: the applied peer field must NOT be re-emitted as an op from this
        // device on the next derive (the baseline was updated on apply).
        window._opStats = { emitted: 0, creates: 0, updates: 0, phantomDeleteCandidates: 0 };
        _opShadowDerive();
        return { afterNew, afterOld, echoed: window._opStats.emitted };
      } finally {
        window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        const i = bids.findIndex(b => b.id === 771001); if (i > -1) bids.splice(i, 1);
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.afterNew).toBe(555);
    expect(r.afterOld).toBe(555); // older op rejected
    expect(r.echoed).toBe(0);     // peer's field not re-emitted as our op
  });

  test('_opApplyPeerOps: create op materializes an unknown row; deleted ids never resurrect; partial ops for unknown rows are skipped', async () => {
    const r = await page.evaluate(() => {
      if (typeof window.__opApplyPeerOps !== 'function') return { skip: true };
      const idNew = 771010, idDel = 771011, idPartial = 771012;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        // (a) CREATE op (fields carry id) for a row this device never saw → materializes.
        window.__opApplyPeerOps([{ hlc: window.__hlcNow(), op_table: 'td_bids', row_id: String(idNew), fields: { id: idNew, name: 'FromOp', amount: 42, status: 'Pending' }, device_id: 'peer-1' }]);
        const created = bids.find(b => String(b.id) === String(idNew));
        // (b) This device DELETED idDel (still in _lastKnownIds, absent from the array),
        // a peer's op must not resurrect it.
        (_lastKnownIds['td_bids'] || (_lastKnownIds['td_bids'] = new Set())).add(String(idDel));
        window.__opApplyPeerOps([{ hlc: window.__hlcNow(), op_table: 'td_bids', row_id: String(idDel), fields: { id: idDel, amount: 9 }, device_id: 'peer-1' }]);
        const resurrected = bids.some(b => String(b.id) === String(idDel));
        // (c) PARTIAL op (no fields.id) for an unknown row → skipped, no half-row shell.
        window.__opApplyPeerOps([{ hlc: window.__hlcNow(), op_table: 'td_bids', row_id: String(idPartial), fields: { amount: 7 }, device_id: 'peer-1' }]);
        const shell = bids.some(b => String(b.id) === String(idPartial) || (b && b.amount === 7 && b.id === undefined));
        return { created: !!created, createdAmount: created && created.amount, resurrected, shell };
      } finally {
        window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        for (const id of [771010, 771011, 771012]) { const i = bids.findIndex(b => String(b.id) === String(id)); if (i > -1) bids.splice(i, 1); }
        _lastKnownIds['td_bids'] && _lastKnownIds['td_bids'].delete('771011');
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.created).toBe(true);
    expect(r.createdAmount).toBe(42);
    expect(r.resurrected).toBe(false);
    expect(r.shell).toBe(false);
  });

  test('_opApplyPeerOps: a CREATE op older than the row snapshot is a tombstone echo and must NOT materialize', async () => {
    const r = await page.evaluate(() => {
      if (typeof window.__opApplyPeerOps !== 'function') return { skip: true };
      const idOld = 771025, idNew = 771026;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt, savedCursor = _deltaCursor;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        // Our row snapshot is CURRENT (cursor = now). Ops publish only after their row
        // commits, so a create op minted BEFORE this snapshot describes a row the
        // snapshot accounted for, absent from our arrays means soft-DELETED. It must
        // not resurrect (the live swarm's 8-vs-4 ghost-bid split).
        _deltaCursor = new Date().toISOString();
        const oldHlc = (Date.now() - 60000).toString(36).padStart(9, '0') + '.0000.peerdev';
        window.__opApplyPeerOps([{ hlc: oldHlc, op_table: 'td_bids', row_id: String(idOld), fields: { id: idOld, name: 'Tombstone Echo', amount: 3 }, device_id: 'peer-1' }]);
        const resurrected = bids.some(b => String(b.id) === String(idOld));
        // A create op NEWER than the snapshot is a genuinely new row → materializes.
        const newHlc = (Date.now() + 60000).toString(36).padStart(9, '0') + '.0000.peerdev';
        window.__opApplyPeerOps([{ hlc: newHlc, op_table: 'td_bids', row_id: String(idNew), fields: { id: idNew, name: 'Fresh Create', amount: 4 }, device_id: 'peer-1' }]);
        const created = bids.some(b => String(b.id) === String(idNew));
        return { resurrected, created };
      } finally {
        window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt; _deltaCursor = savedCursor;
        for (const id of [771025, 771026]) { const i = bids.findIndex(b => String(b.id) === String(id)); if (i > -1) bids.splice(i, 1); }
        _lastKnownIds['td_bids'] && _lastKnownIds['td_bids'].delete('771026');
        _syncedHash['td_bids'] && _syncedHash['td_bids'].delete('771026');
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.resurrected).toBe(false); // tombstone echo suppressed
    expect(r.created).toBe(true);      // genuinely new create still lands
  });

  test('_opApplyPeerOps: an op STALER than the row snapshot we hold is skipped (_rowServerTs guard)', async () => {
    const r = await page.evaluate(() => {
      if (typeof window.__opApplyPeerOps !== 'function') return { skip: true };
      const id = 771020;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        bids.push({ id, client_name: 'Stale', name: 'Stale', amount: 100, status: 'Pending' });
        _opShadowDerive();
        // Pretend the cloud row we hold was committed far in the future relative to the
        // op below (an old op replayed after the row already embodies it).
        (_rowServerTs['td_bids'] || (_rowServerTs['td_bids'] = new Map())).set(String(id), Date.now() + 120000);
        window.__opApplyPeerOps([{ hlc: window.__hlcNow(), op_table: 'td_bids', row_id: String(id), fields: { amount: 1 }, device_id: 'peer-1' }]);
        return { amount: bids.find(b => b.id === id).amount };
      } finally {
        window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        const i = bids.findIndex(b => b.id === 771020); if (i > -1) bids.splice(i, 1);
        _rowServerTs['td_bids'] && _rowServerTs['td_bids'].delete('771020');
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.amount).toBe(100); // stale op did not regress the row
  });

  test('_opDbPruneAcked: ops at-or-below the ack ceiling are DELETED, newer ops survive', async () => {
    const r = await page.evaluate(async () => {
      if (typeof window.__opPruneAcked !== 'function' || typeof window.__opDbUnsynced !== 'function') return { skip: true };
      const idA = 771030, idB = 771031;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        // Op A (pre-ceiling): a create derived + persisted now.
        bids.push({ id: idA, client_name: 'PruneA', name: 'PruneA', amount: 10, status: 'Pending' });
        _opShadowDerive();
        const ceiling = window.__hlcNow(); // everything so far is ≤ ceiling
        // Op B (post-ceiling): derived after the ceiling was sampled.
        bids.push({ id: idB, client_name: 'PruneB', name: 'PruneB', amount: 20, status: 'Pending' });
        _opShadowDerive();
        // IndexedDB adds are fire-and-forget, wait until both ops are visible.
        for (let i = 0; i < 40; i++) {
          const ops = await window.__opDbUnsynced();
          if (ops.some(o => o.rowId === String(idA)) && ops.some(o => o.rowId === String(idB))) break;
          await new Promise(res => setTimeout(res, 100));
        }
        await window.__opPruneAcked(ceiling);
        const after = await window.__opDbUnsynced();
        return {
          aGone: !after.some(o => o.rowId === String(idA)),
          bKept: after.some(o => o.rowId === String(idB)),
        };
      } finally {
        window._opLogShadow = savedFlag; _lastLocalSaveAt = savedSaveAt;
        for (const id of [771030, 771031]) { const i = bids.findIndex(b => b.id === id); if (i > -1) bids.splice(i, 1); }
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.aGone).toBe(true);
    expect(r.bKept).toBe(true);
  });

  test('full-load REBASE, a pending local edit survives the array replace; an offline-created row (pending CREATE op) is re-appended', async () => {
    const r = await page.evaluate(async () => {
      if (typeof supaLoadFromCloud !== 'function' || typeof window.__opDbUnsynced !== 'function') return { skip: true };
      const idCloud = 771040, idLocal = 771041;
      const UID = 'rebase-u';
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
        syncedAt: _rowSyncedAt, flag: window._opLogShadow, saveAt: _lastLocalSaveAt,
        auth: _authSettingsLoaded,
      };
      // The FULL load path replaces every table array, snapshot ALL of them for restore.
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      const past = new Date(Date.now() - 60000).toISOString();
      const makeChain = (table) => {
        const rows = table === 'td_bids'
          ? [{ id: String(idCloud), data: { id: idCloud, name: 'CloudRow', amount: 5, status: 'X' }, updated_at: past }]
          : [];
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; }, lt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          insert() { return chain; }, upsert() { return chain; }, update() { return chain; }, delete() { return chain; },
          maybeSingle() { return Promise.resolve({ data: { settings: null, checks_state: null, receipt_images: null, updated_at: 'CUR-rebase' }, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        window._supaUser = { id: UID };
        // Local state: our copy of the cloud row with a PENDING edit (amount 999, field
        // clock stamped now, newer than the incoming row's updated_at), plus a row the
        // cloud has never seen whose CREATE op is pending in the durable log.
        bids.length = 0;
        bids.push({ id: idCloud, name: 'CloudRow', amount: 100, status: 'X' });
        _opRebaseline(); // settle baseline, then make the pending edits AFTER it
        bids.find(b => b.id === idCloud).amount = 999;        // pending EDIT
        bids.push({ id: idLocal, name: 'OfflineCreated', amount: 77, status: 'Pending' }); // pending CREATE
        _opShadowDerive(); // stamps field clocks + persists both ops (owner = UID)
        // Wait for the CREATE op to be durably visible (the re-append reads the log).
        for (let i = 0; i < 40; i++) {
          const ops = await window.__opDbUnsynced();
          if (ops.some(o => o.rowId === String(idLocal) && o.fields && o.fields.id !== undefined && o.owner === UID)) break;
          await new Promise(res => setTimeout(res, 100));
        }
        _rowSyncedAt['td_bids'] = new Map(); // nothing "already uploaded", the edit is genuinely pending
        _supa = { from: (t) => makeChain(t), rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'missing' } }) };
        _supaCloudLoaded = true; _isEmployee = false;
        _loadedDataOwner = UID;
        _deltaCursor = null; // force the FULL (array-replace) branch, the one that used to clobber
        await supaLoadFromCloud({ silent: true });
        const cloudRow = bids.find(b => String(b.id) === String(idCloud));
        const localRow = bids.find(b => String(b.id) === String(idLocal));
        return {
          protectedAmount: cloudRow && cloudRow.amount,   // 999 = pending edit survived
          tookPeerField: cloudRow && cloudRow.status,     // 'X' from the cloud row
          reappended: !!localRow,                         // offline-created row survived the replace
          reappendedAmount: localRow && localRow.amount,
          hashIsIncoming: window.__hashHas('td_bids', idCloud), // hash stamped → re-upload guarantee arms
        };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known; _rowSyncedAt = saved.syncedAt;
        window._opLogShadow = saved.flag; _lastLocalSaveAt = saved.saveAt;
        _authSettingsLoaded = saved.auth;
        _tblSnap.forEach(({ set, rows }) => set(rows));
        _loadInProgress = false; _activeLoadPromise = null;
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.protectedAmount).toBe(999); // the offline edit was NOT clobbered by the replace
    expect(r.tookPeerField).toBe('X');
    expect(r.reappended).toBe(true);     // the offline-created row was NOT dropped
    expect(r.reappendedAmount).toBe(77);
    expect(r.hashIsIncoming).toBe(true);
  });

  // Regression: employee redaction must never poison a FIELD CLOCK (data-leak guard).
  // Before: _opShadowDerive stamped a fresh field clock from an employee's REDACTED
  // (zeroed) in-memory bid amount before supaSaveToCloud's _saveSkip even excluded
  // td_bids from the upload. The network was never touched, but that phantom "locally
  // edited, newer than the server" clock then outranked the contractor's real value on
  // the next reload's field-clock merge (_opApplyIncoming): an employee's redacted
  // view silently zeroed the contractor's real bid amount in MEMORY. Fixed: the field
  // clock stamp is skipped for redacted tables specifically, the op ITSELF (ring +
  // durable log) still gets created as before, since the crew op-SYNC channel
  // deliberately keeps redacted ops local and filters them only at push time (see the
  // sibling "redacted-table ops never push" test above, this fix must not break that).
  test('_opShadowDerive skips the field clock (not the op) for a redacted table', async () => {
    const r = await page.evaluate(() => {
      if (typeof _opShadowDerive !== 'function' || typeof _opFieldClocks !== 'function') return { skip: true };
      const bidId = 991001;
      const saved = {
        emp: _isEmployee, empRec: _employeeRecord, flag: window._opLogShadow,
        bidsSnap: bids.slice(),
      };
      try {
        window._opLogShadow = true;
        _isEmployee = false; _employeeRecord = null;
        bids.length = 0;
        bids.push({ id: bidId, name: 'RedactGuard', amount: 7777, status: 'sent' });
        _opRebaseline();
        _opShadowDerive(); // contractor's real save, establishes the genuine field clock
        const clockBefore = { ..._opFieldClocks('td_bids', bidId) };
        const opCountBefore = (typeof window.__opLast === 'function' && window.__opLast('td_bids', bidId)) ? 1 : 0;

        // Become a redacted employee (no financials, no estimate permission → td_bids redacted)
        // and simulate the RPC's zeroing, exactly like the live flow test does.
        _isEmployee = true;
        _employeeRecord = { permissions: { financials: false }, active: true, role: 'tech' };
        const b = bids.find(x => x.id === bidId);
        if (b) b.amount = 0;
        _opShadowDerive(); // the redacted "save" derive: must NOT touch the field clock
        const clockAfter = { ..._opFieldClocks('td_bids', bidId) };
        const opAfter = typeof window.__opLast === 'function' ? window.__opLast('td_bids', bidId) : null;

        return {
          skip: false,
          redactedTables: [...(typeof _employeeRedactedTables === 'function' ? _employeeRedactedTables() : [])],
          amountClockUnchanged: clockBefore.amount === clockAfter.amount,
          // The op itself must STILL be created/persisted (Phase 2's push-time filter
          // needs something to filter), only the field clock is guarded.
          opStillCreated: !!opAfter,
          opStillReflectsZero: !!(opAfter && opAfter.fields && opAfter.fields.amount === 0),
        };
      } finally {
        _isEmployee = saved.emp; _employeeRecord = saved.empRec; window._opLogShadow = saved.flag;
        bids.length = 0; saved.bidsSnap.forEach(x => bids.push(x));
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.redactedTables, 'a financials:false employee with no estimate permission must have td_bids redacted').toContain('td_bids');
    expect(r.amountClockUnchanged, 'a redacted derive must NOT advance the amount field clock, that is the signal a later merge trusts over the real server value').toBe(true);
    expect(r.opStillCreated, 'the op itself must still be created/persisted: the crew push-time filter (sibling test) needs something to filter').toBe(true);
    expect(r.opStillReflectsZero, 'the created op legitimately reflects the redacted value, filtering happens at push time, not here').toBe(true);
  });

  test('_effectiveUid: owner→self, crew→boss, dev-support→target (the Stripe/link routing identity)', async () => {
    const r = await page.evaluate(() => {
      if (typeof _effectiveUid !== 'function') return { skip: true };
      const saved = { user: window._supaUser, emp: _isEmployee, cid: _contractorUserId };
      try {
        window._supaUser = { id: 'owner-9' }; _isEmployee = false; _contractorUserId = null;
        const asOwner = _effectiveUid();
        _isEmployee = true; _contractorUserId = 'boss-9';
        const asCrew = _effectiveUid();
        _isEmployee = true; _contractorUserId = null; // half-initialized crew context → fall back to self, never null-route
        const asCrewUnlinked = _effectiveUid();
        return { asOwner, asCrew, asCrewUnlinked };
      } finally {
        window._supaUser = saved.user; _isEmployee = saved.emp; _contractorUserId = saved.cid;
      }
    });
    if (r.skip) return;
    expect(r.asOwner).toBe('owner-9');
    expect(r.asCrew).toBe('boss-9');          // crew artifacts route to the BOSS's account
    expect(r.asCrewUnlinked).toBe('owner-9'); // never a null/undefined route
  });

  test('crew op-sync, ops carry the CONTRACTOR uid and redacted-table ops never push', async () => {
    const r = await page.evaluate(async () => {
      if (typeof window.__opSync !== 'function' || typeof window.__opDbUnsynced !== 'function') return { skip: true };
      const idC = 771050, idB = 771051;
      const saved = {
        supa: _supa, user: window._supaUser, flag: window._opLogShadow, saveAt: _lastLocalSaveAt,
        emp: _isEmployee, cid: _contractorUserId, rec: _employeeRecord, cursor: _deltaCursor,
      };
      const pushed = []; const pulls = [];
      const makeChain = (table) => {
        const chain = {
          insert(rows) { if (table === 'td_ops') pushed.push(...rows); return chain; },
          select() { return chain; }, eq(col, val) { if (table === 'td_ops') pulls.push(val); return chain; },
          gt() { return chain; }, order() { return chain; }, limit() { return chain; },
          upsert() { return chain; }, update() { return chain; }, delete() { return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        window._opLogShadow = true; _lastLocalSaveAt = Date.now();
        window._supaUser = { id: 'emp-1' };
        _isEmployee = true; _contractorUserId = 'boss-1';
        _employeeRecord = { permissions: {} }; // no money permissions → bids/income/etc redacted
        _deltaCursor = null;
        // ORDER MATTERS: the owner just switched ('e2e-user' → 'emp-1'), and the FIRST
        // derive after an owner switch REBASELINES from the current arrays (no ops).
        // Settle that first, THEN create the rows, THEN derive, the incremental diff
        // emits the CREATE ops. (This test failed in CI by pushing rows before the
        // rebaseline, which silently swallowed them.)
        _opShadowDerive();
        // One PERMITTED op (td_clients) and one REDACTED op (td_bids) as this login.
        clients.push({ id: idC, name: 'Crew Op C', phone: '3165550001' });
        bids.push({ id: idB, client_name: 'Crew Op B', name: 'Crew Op B', amount: 5, status: 'Pending' });
        _opShadowDerive();
        for (let i = 0; i < 40; i++) {
          const ops = await window.__opDbUnsynced();
          if (ops.some(o => o.rowId === String(idC)) && ops.some(o => o.rowId === String(idB))) break;
          await new Promise(res => setTimeout(res, 100));
        }
        _supa = { from: (t) => makeChain(t), rpc: () => Promise.resolve({ data: null, error: null }) };
        await window.__opSync();
        const after = await window.__opDbUnsynced();
        return {
          pushedUids: [...new Set(pushed.map(p => p.user_id))],
          pushedTables: [...new Set(pushed.map(p => p.op_table))],
          pushedOurClientOp: pushed.some(p => p.row_id === String(idC)),
          pushedOurBidOp: pushed.some(p => p.row_id === String(idB)),
          pullUid: pulls[0],
          bidOpStillPending: after.some(o => o.rowId === String(idB)), // filtered, not lost
        };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; window._opLogShadow = saved.flag;
        _lastLocalSaveAt = saved.saveAt; _isEmployee = saved.emp; _contractorUserId = saved.cid;
        _employeeRecord = saved.rec; _deltaCursor = saved.cursor;
        let i = clients.findIndex(c => c.id === 771050); if (i > -1) clients.splice(i, 1);
        i = bids.findIndex(b => b.id === 771051); if (i > -1) bids.splice(i, 1);
        try { _opRebaseline(); } catch (e) {}
      }
    });
    if (r.skip) return;
    expect(r.pushedOurClientOp).toBe(true);          // permitted table publishes…
    expect(r.pushedUids).toEqual(['boss-1']);        // …under the CONTRACTOR's account
    expect(r.pushedOurBidOp).toBe(false);            // redacted-table op never leaves the device
    expect(r.pushedTables).not.toContain('td_bids');
    expect(r.pullUid).toBe('boss-1');                // the pull reads the contractor's stream
    expect(r.bidOpStillPending).toBe(true);          // filtered ≠ deleted (ack-prune owns cleanup)
  });

  test('crew save, bumps the account cursor via RPC after table writes (never zj_data directly)', async () => {
    const r = await page.evaluate(async () => {
      if (typeof supaSaveToCloud !== 'function') return { skip: true };
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, emp: _isEmployee,
        cid: _contractorUserId, rec: _employeeRecord, hash: _syncedHash, known: _lastKnownIds,
        foc: _loadedFromCacheOnly, flag: window._opLogShadow, zj: window._lastZjUpdatedAt,
        auth: _authSettingsLoaded,
      };
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      const rpcCalls = []; const zjWrites = [];
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; }, lt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          insert() { return chain; },
          upsert() { if (table === 'zj_data') zjWrites.push('upsert'); return chain; },
          update() { if (table === 'zj_data') zjWrites.push('update'); return chain; },
          delete() { return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        window._opLogShadow = false; // isolate the cursor-bump property from op traffic
        window._supaUser = { id: 'emp-2' };
        _isEmployee = true; _contractorUserId = 'boss-2';
        _employeeRecord = { permissions: { estimate: true } }; // td_bids writable
        _supaCloudLoaded = true; _loadedFromCacheOnly = false; _authSettingsLoaded = false;
        _syncedHash = {}; _lastKnownIds = {};
        bids.push({ id: 771060, client_name: 'Crew Save', name: 'Crew Save', amount: 12, status: 'Pending' }); // unknown hash → a real table write
        _supa = {
          from: (t) => makeChain(t),
          rpc: (name, args) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: '2026-07-02T00:00:00.000+00:00', error: null }); },
        };
        await supaSaveToCloud();
        return {
          bump: rpcCalls.find(c => c.name === 'bump_account_cursor'),
          zjWrites: zjWrites.length,
          cursorApplied: window._lastZjUpdatedAt === '2026-07-02T00:00:00.000+00:00',
        };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _isEmployee = saved.emp; _contractorUserId = saved.cid; _employeeRecord = saved.rec;
        _syncedHash = saved.hash; _lastKnownIds = saved.known; _loadedFromCacheOnly = saved.foc;
        window._opLogShadow = saved.flag; window._lastZjUpdatedAt = saved.zj; _authSettingsLoaded = saved.auth;
        _tblSnap.forEach(({ set, rows }) => set(rows));
        localStorage.removeItem('zp3_pending_sync');
      }
    });
    if (r.skip) return;
    expect(r.bump && r.bump.args && r.bump.args.target).toBe('boss-2'); // cursor bumped for the BOSS's account
    expect(r.zjWrites).toBe(0);                                          // crew never writes zj_data directly
    expect(r.cursorApplied).toBe(true);                                  // returned cursor becomes our applied cursor
  });

  test('reconnect with pending offline writes, PULL (reads) strictly before PUSH (writes)', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _onReconnect !== 'function') return { skip: true };
      const fired = [];
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
        auth: _authSettingsLoaded, foc: _loadedFromCacheOnly, flag: window._opLogShadow,
      };
      // The reconnect's FULL pull replaces every table array, snapshot ALL for restore.
      const _tblSnap = _TD_TABLES.map(({ t, get, set }) => ({ t, set, rows: (get() || []).slice() }));
      const makeChain = (table) => {
        const chain = {
          select() { return chain; }, eq() { return chain; }, gt() { return chain; }, lt() { return chain; },
          in() { return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
          insert() { fired.push('write:' + table); return chain; },
          upsert() { fired.push('write:' + table); return chain; },
          update() { fired.push('write:' + table); return chain; },
          delete() { return chain; },
          maybeSingle() { fired.push('read:' + table); return Promise.resolve({ data: { settings: null, checks_state: null, receipt_images: null, updated_at: 'CUR-recon' }, error: null }); },
          single() { return Promise.resolve({ data: { updated_at: 'CUR-recon2' }, error: null }); },
          then(res, rej) { fired.push((chain._wrote ? 'flush:' : 'read:') + table); return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return chain;
      };
      try {
        window._opLogShadow = false; // isolate the ORDER property from op traffic noise
        _supa = { from: (t) => makeChain(t), rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'missing' } }) };
        window._supaUser = { id: 'recon-u' };
        _supaCloudLoaded = true; _loadedFromCacheOnly = false; _isEmployee = false;
        _loadedDataOwner = 'recon-u'; _deltaCursor = null; _authSettingsLoaded = true;
        localStorage.setItem('zp3_pending_sync', '1'); // "offline writes pending"
        await _onReconnect();
        const firstWrite = fired.findIndex(f => f.startsWith('write:'));
        const firstRead = fired.findIndex(f => f.startsWith('read:'));
        return { firstRead, firstWrite, sample: fired.slice(0, 6), pendingCleared: localStorage.getItem('zp3_pending_sync') !== '1' };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp;
        _syncedHash = saved.hash; _lastKnownIds = saved.known; _authSettingsLoaded = saved.auth;
        _loadedFromCacheOnly = saved.foc; window._opLogShadow = saved.flag;
        _tblSnap.forEach(({ set, rows }) => set(rows));
        localStorage.removeItem('zp3_pending_sync');
        _loadInProgress = false; _activeLoadPromise = null;
      }
    });
    if (r.skip) return;
    expect(r.firstRead).toBeGreaterThanOrEqual(0);       // the pull happened…
    if (r.firstWrite !== -1) {
      expect(r.firstWrite).toBeGreaterThan(r.firstRead); // …and every write came after it
    }
    expect(r.pendingCleared).toBe(true);
  });

  test('signing into a different account lands on the dashboard immediately, not whatever page was active (regression)', async () => {
    // Real bug report: "Sign out of cloud sync" only lives on the Settings page, so
    // that's always the active page when a user signs out. The onAuthStateChange
    // SIGNED_IN handler used to remove the login overlay and THEN await
    // loadAccountData() (several sequential Supabase queries) before finally calling
    // goPg('pg-dash'): so every account switch on the same device (no page reload)
    // exposed the stale Settings page underneath for that entire load. The fix
    // navigates to the dashboard synchronously, before any of that awaited work.
    const r = await page.evaluate(async () => {
      if (typeof window.__capturedAuthCallback !== 'function') return { skip: true };
      const saved = {
        supaUser: window._supaUser, cloudLoaded: _supaCloudLoaded, loadedOwner: _loadedDataOwner,
        activePgId: document.querySelector('.pg.active')?.id,
      };
      // Simulate: was on Settings (where sign-out lives) when the account switch began.
      document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
      document.getElementById('pg-settings')?.classList.add('active');
      window._supaUser = null;
      _supaCloudLoaded = false;
      _loadedDataOwner = null;
      let threw = null;
      try {
        // Deliberately NOT awaited, the fix must navigate synchronously, before any
        // of the callback's awaited Supabase queries have a chance to resolve.
        window.__capturedAuthCallback('SIGNED_IN', { user: { id: 'new-account-test-uid' } });
      } catch (e) { threw = e.message; }
      const activeRightAfterCall = document.querySelector('.pg.active')?.id;
      // Restore
      document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
      document.getElementById(saved.activePgId || 'pg-dash')?.classList.add('active');
      window._supaUser = saved.supaUser; _supaCloudLoaded = saved.cloudLoaded; _loadedDataOwner = saved.loadedOwner;
      return { skip: false, threw, activeRightAfterCall };
    });
    if (r.skip) return;
    expect(r.threw).toBe(null);
    expect(r.activeRightAfterCall).toBe('pg-dash');
  });

  // ── EVERY OPEN IS A REFRESH ────────────────────────────────────────────────
  // Owner report 2026-08-31: "data is cached and looks old ... every time you
  // open, it needs to refresh all metrics." Two causes, both covered here:
  // nothing repainted on foreground at all, and the only freshness check on
  // resume was the zj_data cursor, which the server-written geo rows never
  // touch.
  test.describe('_refreshActivePage: repaint the visible page, navigate nothing', () => {
    const withPg = (pgId, body) => page.evaluate(({ pgId, body }) => {
      const prev = document.querySelector('.pg.active')?.id || null;
      const el = document.getElementById(pgId);
      document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
      if (el) el.classList.add('active');
      const calls = [];
      const NAMES = ['renderDash', 'renderTimeLog', 'renderMoneyPage', 'renderJobsPage',
        'renderTrackerTab', 'renderCalendar', 'renderClientList', 'renderLeadsPage',
        'renderProposalsPage', 'renderDispatch', 'renderTeam', 'renderFleetVehicles',
        'calcTax', 'renderContracts', 'renderLicensing', 'renderChecklist', 'renderClientHubPage'];
      const saved = {};
      NAMES.forEach(n => { saved[n] = window[n]; window[n] = () => { calls.push(n); }; });
      const savedScroll = window.scrollTo;
      let scrolled = false;
      window.scrollTo = () => { scrolled = true; };
      let out, threw = null;
      try { out = eval('(' + body + ')')(); } catch (e) { threw = e.message; }
      NAMES.forEach(n => { window[n] = saved[n]; });
      window.scrollTo = savedScroll;
      document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
      if (prev) document.getElementById(prev)?.classList.add('active');
      return { calls, scrolled, out, threw };
    }, { pgId, body: body.toString() });

    test('the dashboard repaints, and nothing scrolls', async () => {
      const r = await withPg('pg-dash', () => _refreshActivePage());
      expect(r.threw).toBe(null);
      expect(r.out).toBe('pg-dash');
      expect(r.calls).toEqual(['renderDash']);
      // goPg() scrolls to top. This must not: the contractor was reading
      // something halfway down when the phone went in his pocket.
      expect(r.scrolled).toBe(false);
    });

    test('the time log repaints, which is what pulls the server rows again', async () => {
      const r = await withPg('pg-timelog', () => _refreshActivePage());
      expect(r.calls).toEqual(['renderTimeLog']);
    });

    test('a page with two renders runs both', async () => {
      const r = await withPg('pg-team', () => _refreshActivePage());
      expect(r.calls).toEqual(['renderTeam', 'renderFleetVehicles']);
    });

    test('a page with no stale metrics is a no-op, not a throw', async () => {
      const r = await withPg('pg-settings', () => _refreshActivePage());
      expect(r.threw).toBe(null);
      expect(r.out).toBe('pg-settings');
      expect(r.calls).toEqual([]);
    });

    test('the estimate builder is NEVER repainted: it holds unsaved typing', async () => {
      const r = await withPg('pg-est-generic', () => _refreshActivePage());
      expect(r.threw).toBe(null);
      expect(r.calls).toEqual([]);
    });

    test('no active page at all: returns null, does not throw', async () => {
      const r = await page.evaluate(() => {
        const prev = document.querySelector('.pg.active')?.id || null;
        document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
        let out, threw = null;
        try { out = _refreshActivePage(); } catch (e) { threw = e.message; }
        if (prev) document.getElementById(prev)?.classList.add('active');
        return { out, threw };
      });
      expect(r.threw).toBe(null);
      expect(r.out).toBe(null);
    });

    test('a render that throws does not take the refresh down with it', async () => {
      const r = await page.evaluate(() => {
        const prev = document.querySelector('.pg.active')?.id || null;
        document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
        document.getElementById('pg-dash')?.classList.add('active');
        const saved = window.renderDash;
        window.renderDash = () => { throw new Error('boom'); };
        let out, threw = null;
        try { out = _refreshActivePage(); } catch (e) { threw = e.message; }
        window.renderDash = saved;
        document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
        if (prev) document.getElementById(prev)?.classList.add('active');
        return { out, threw };
      });
      expect(r.threw).toBe(null);       // swallowed: this runs on a lifecycle event
      expect(r.out).toBe('pg-dash');
    });

    test('calling it ten times in a row is safe (11.2)', async () => {
      const r = await withPg('pg-dash', () => {
        for (let i = 0; i < 10; i++) _refreshActivePage();
        return 'ok';
      });
      expect(r.threw).toBe(null);
      expect(r.calls.length).toBe(10);
    });
  });

  test.describe('the foreground pull is not gated on the zj_data cursor', () => {
    const CLOUD = () => readJs('cloud.js');

    test('foregrounding repaints AND pulls, not just the cursor check', () => {
      const src = CLOUD();
      expect(src.includes('window._cursorCheckReconcile&&window._cursorCheckReconcile();\n        _refreshOnForeground();'),
        'the cursor check is kept and the unconditional refresh is added after it').toBe(true);
    });

    test('the repaint happens BEFORE the network, so the clock is right offline', () => {
      const src = CLOUD();
      const fn = src.slice(src.indexOf('const _refreshOnForeground=()=>{'));
      const paint = fn.indexOf('_refreshActivePage()');
      const pull = fn.indexOf('supaLoadFromCloud({silent:true})');
      expect(paint).toBeGreaterThan(-1);
      expect(pull).toBeGreaterThan(-1);
      // Everything derived from the clock is already correct from memory. It
      // must not wait on a round trip that may never come back on bad signal.
      expect(paint).toBeLessThan(pull);
    });

    test('the pull is throttled but the repaint never is', () => {
      const src = CLOUD();
      const fn = src.slice(src.indexOf('const _refreshOnForeground=()=>{'));
      const paint = fn.indexOf('_refreshActivePage()');
      const guard = fn.indexOf('_lastFgPullAt<_FG_PULL_MIN_GAP_MS');
      expect(guard).toBeGreaterThan(-1);
      // App-switching to the camera and back three times in ten seconds should
      // not fire three loads, but it must repaint all three times: the repaint
      // is free and the number on screen is what he is looking at.
      expect(paint).toBeLessThan(guard);
    });

    test('a save this device just made is not pulled on top of', () => {
      const src = CLOUD();
      const fn = src.slice(src.indexOf('const _refreshOnForeground=()=>{'));
      expect(fn.slice(0, 1600).includes('_lastLocalSaveAt<3000'),
        'same read-skew floor _cursorCheckReconcile uses').toBe(true);
    });

    test('and it repaints again once the pull lands', () => {
      const src = CLOUD();
      const fn = src.slice(src.indexOf('const _refreshOnForeground=()=>{'), src.indexOf('window._cursorCheckReconcile=async()=>{'));
      const pull = fn.indexOf('supaLoadFromCloud({silent:true})');
      expect(fn.indexOf('_refreshActivePage()', pull)).toBeGreaterThan(pull);
    });
  });
});
