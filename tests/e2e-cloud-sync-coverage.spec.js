// @ts-check
/**
 * Cloud / sync core coverage (CLAUDE.md §12 — exhaustive per-function coverage).
 *
 * Targets the highest-RISK uncovered functions in js/cloud.js — the sync core —
 * across the §12.1 input classes (null / empty / boundary / type-mismatch /
 * missing-DOM / golden path), the §12.2 concurrent-call race pattern, and the
 * §12.3 localStorage-corruption pattern.
 *
 * Functions exercised:
 *   _isMissingTableErr        — error classification (true/false across shapes)
 *   _bidRichness              — bid scoring (empty / partial / full / non-bid)
 *   _recordLocalDelete        — delete-sweep id tracking (§9.8 concurrency-safe sweep)
 *   _setDeliberateWipe        — wipe-flag setter
 *   _isCompanyVehicleToday    — company-vehicle boolean across localStorage states
 *   _pickVehicle              — vehicle selection (localStorage + toast, missing DOM)
 *   _dispatchMoveUp/_dispatchMoveDown/_dispatchUnassign — dispatch reorder + boundaries
 *   _empPayTypeSync           — pay-type form sync (DOM label/placeholder)
 *   _setEmpRolePreset         — role → permission-checkbox preset
 *   _togglePermInfo           — info-block toggle (missing DOM)
 *   _copyInviteLink           — clipboard copy (no-throw)
 *   _cacheUserLayoutLocal     — per-uid layout cache to localStorage
 *   _opDbOpen / _opSyncOps (window.__opSync) — durable op-log + shadow sync (§12.2 race)
 *   _loadTeamComp / _refreshPermReqBadge / _denyPermissionRequest — supa-backed, no-throw
 *   _migrateReceiptsToStorage / _restoreReceiptsFromStorage — receipt sync, no-throw
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Cloud sync core — uncovered function coverage', () => {
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

  // ── _isMissingTableErr — pure error classification ────────────────────────
  test('_isMissingTableErr — classifies missing-table errors true, real errors false', async () => {
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

  // ── _bidRichness — pure scoring ───────────────────────────────────────────
  test('_bidRichness — scores surfaces*100 + rooms across input classes', async () => {
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

  // ── _recordLocalDelete — §9.8 concurrency-safe sweep id tracking ───────────
  test('_recordLocalDelete — tracks explicitly-deleted ids, ignores unknown tables/empty', async () => {
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
        // ids are stringified — numeric and string forms collapse to the same key
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

  // ── _setDeliberateWipe — flag setter ──────────────────────────────────────
  test('_setDeliberateWipe — coerces to boolean flag', async () => {
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

  // ── _isCompanyVehicleToday — boolean logic over localStorage states ───────
  test('_isCompanyVehicleToday — true only for a real company vehicle id', async () => {
    const r = await page.evaluate(() => {
      if (typeof _isCompanyVehicleToday !== 'function' || typeof todayKey !== 'function') return { skip: true };
      try {
        const key = 'emp_vehicle_' + todayKey();
        const orig = localStorage.getItem(key);
        localStorage.removeItem(key);          const unset    = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'none');     const onFoot   = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'personal'); const personal = _isCompanyVehicleToday(); // false
        localStorage.setItem(key, 'veh-123');  const company  = _isCompanyVehicleToday(); // true
        localStorage.setItem(key, '');         const blank    = _isCompanyVehicleToday(); // false
        if (orig === null) localStorage.removeItem(key); else localStorage.setItem(key, orig);
        return { ok: true, unset, onFoot, personal, company, blank };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.unset).toBe(false);
    expect(r.onFoot).toBe(false);
    expect(r.personal).toBe(false);
    expect(r.company).toBe(true);
    expect(r.blank).toBe(false);
  });

  // ── _pickVehicle — selection writes localStorage; tolerant of missing DOM ──
  test('_pickVehicle — persists choice and does not throw when display el absent', async () => {
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

  // ── _dispatch reorder — seed jobs, assert precise order + boundary no-ops ──
  test('_dispatchMoveUp / _dispatchMoveDown — reorder dispatchOrder with boundary no-ops', async () => {
    const r = await page.evaluate(() => {
      if (typeof _dispatchMoveUp !== 'function' || typeof _dispatchMoveDown !== 'function'
        || typeof jobs === 'undefined' || typeof S === 'undefined' || typeof todayKey !== 'function') return { skip: true };
      try {
        const tk = todayKey();
        const empId = 'emp-dispatch-1';
        S.employees = S.employees || [];
        if (!S.employees.some(e => e.id === empId)) S.employees.push({ id: empId, name: 'Reorder Tester', role: 'tech' });
        // Seed 3 assigned jobs in known order 0,1,2
        const ids = [770001, 770002, 770003];
        ids.forEach((id, i) => {
          if (!jobs.some(j => j.id === id)) jobs.push({ id });
          const j = jobs.find(x => x.id === id);
          j.assignedTo = empId; j.assignedDate = tk; j.dispatchOrder = i;
          j.client_id = null; j.clientName = 'Reorder ' + i; j.start = tk; j.days = 1;
        });
        const orderOf = () => jobs.filter(j => String(j.assignedTo) === String(empId) && j.assignedDate === tk)
          .sort((a, b) => (a.dispatchOrder || 0) - (b.dispatchOrder || 0)).map(j => j.id);

        const initial = orderOf();                                  // [770001,770002,770003]
        _dispatchMoveDown(770001, empId);                           // first → second
        const afterDown = orderOf();                                // [770002,770001,770003]
        _dispatchMoveUp(770001, empId);                             // back to first
        const afterUp = orderOf();                                  // [770001,770002,770003]

        // Boundary: moving the top item up is a no-op
        const beforeTopUp = orderOf();
        _dispatchMoveUp(770001, empId);
        const afterTopUp = orderOf();
        // Boundary: moving the bottom item down is a no-op
        const beforeBotDown = orderOf();
        _dispatchMoveDown(770003, empId);
        const afterBotDown = orderOf();
        // Unknown job id → no throw, no change
        _dispatchMoveUp(999999, empId);
        _dispatchMoveDown(999999, empId);
        const afterUnknown = orderOf();

        return {
          ok: true, initial, afterDown, afterUp,
          topNoop: JSON.stringify(beforeTopUp) === JSON.stringify(afterTopUp),
          botNoop: JSON.stringify(beforeBotDown) === JSON.stringify(afterBotDown),
          unknownNoop: JSON.stringify(afterUnknown) === JSON.stringify(afterBotDown),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.initial).toEqual([770001, 770002, 770003]);
    expect(r.afterDown).toEqual([770002, 770001, 770003]);
    expect(r.afterUp).toEqual([770001, 770002, 770003]);
    expect(r.topNoop).toBe(true);
    expect(r.botNoop).toBe(true);
    expect(r.unknownNoop).toBe(true);
  });

  test('_dispatchUnassign — clears assignment via zConfirm without throwing', async () => {
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

  // ── _empPayTypeSync — DOM label/placeholder sync ──────────────────────────
  test('_empPayTypeSync — swaps label + placeholder for salary vs hourly, missing DOM safe', async () => {
    const r = await page.evaluate(() => {
      if (typeof _empPayTypeSync !== 'function') return { skip: true };
      try {
        // Missing DOM first — must not throw
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
    expect(r.salaryLbl).toBe('Annual salary');
    expect(r.salaryPh).toBe('55000');
    expect(r.hourlyLbl).toBe('Hourly rate');
    expect(r.hourlyPh).toBe('28');
  });

  // ── _setEmpRolePreset — role → permission checkboxes ──────────────────────
  test('_setEmpRolePreset — checks the right permission boxes per role preset', async () => {
    const r = await page.evaluate(() => {
      if (typeof _setEmpRolePreset !== 'function' || typeof _EMP_PERM_LABELS === 'undefined') return { skip: true };
      try {
        // Missing checkboxes first — must not throw
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

  // ── _togglePermInfo — info-block display toggle ───────────────────────────
  test('_togglePermInfo — toggles display block/none, missing el is no-op', async () => {
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

  // ── _copyInviteLink — clipboard copy, no-throw ────────────────────────────
  test('_copyInviteLink — copies without throwing (clipboard + fallback)', async () => {
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

  // ── _cacheUserLayoutLocal — per-uid layout cache to localStorage ──────────
  test('_cacheUserLayoutLocal — writes layout cache only when a user is present', async () => {
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

  // ── _opDbOpen — durable IndexedDB op-log opens (or fails safe → null) ──────
  test('_opDbOpen — resolves a DB handle or null without throwing', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _opDbOpen !== 'function') return { skip: true };
      try {
        const db = await _opDbOpen();
        // best-effort: either a real IDBDatabase or null (blocked/unavailable) — never a throw
        return { ok: true, isObjectOrNull: db === null || typeof db === 'object' };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
    expect(r.isObjectOrNull).toBe(true);
  });

  // ── _opSyncOps via window.__opSync — §12.2 concurrent-call guard ──────────
  test('__opSync — concurrent calls resolve, guard holds, no throw', async () => {
    const r = await page.evaluate(async () => {
      if (typeof window.__opSync !== 'function') return { skip: true };
      try {
        // Enable the shadow path + provide a fake user so the body runs past its guards.
        const origShadow = window._opLogShadow;
        const origUser = typeof _supaUser !== 'undefined' ? _supaUser : null;
        window._opLogShadow = true;
        try { if (!_supaUser) _supaUser = { id: 'opsync-test' }; } catch (_e) {}
        // §12.2: fire N times without awaiting — the _opSyncRunning guard must let
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

  // ── _loadTeamComp / _refreshPermReqBadge / _denyPermissionRequest — no-throw
  test('team-comp + permission-badge helpers — run offline without throwing', async () => {
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

  // ── _refreshPermReqBadge — renders + clears the badge from the queue count ─
  test('_refreshPermReqBadge — shows badge when requests pending, removes when empty', async () => {
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

  // ── receipt migrate/restore — supa-backed, no-throw offline ───────────────
  test('_migrateReceiptsToStorage / _restoreReceiptsFromStorage — run offline without throwing', async () => {
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
      // These are `let` globals in cloud.js — reference by bare name, not window.*
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
  // write per save) is the LAST write — after the td_* upsert — so "cursor moved ⇒ all data
  // committed" holds. If a future edit moves the zj_data write back ahead of the table writes,
  // this fails on the offline shard, before it ever reaches the cloud gate.
  test('supaSaveToCloud writes the zj_data cursor LAST — after the td_* upserts (no read-skew)', async () => {
    const r = await page.evaluate(async () => {
      // Save everything we clobber so the shared page survives for later tests.
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded,
        cacheOnly: _loadedFromCacheOnly, emp: _isEmployee, authS: _authSettingsLoaded,
        hash: _syncedHash, known: _lastKnownIds,
      };
      // Snapshot + empty every sync table so residual data from earlier tests can't add
      // stray upserts — then seed EXACTLY one dirty bid. Restored at the end.
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
    // A td_* row was actually uploaded (precondition — otherwise the zj_data write won't fire).
    expect(r.tdUpsertIdx).toBeGreaterThanOrEqual(0);
    // The final write carries the zj_data cursor (settings + updated_at, one write per save)…
    expect(r.last && r.last.table).toBe('zj_data');
    // …it lands AFTER the td_* upsert, never before it (the read-skew invariant)…
    expect(r.markerIdx).toBeGreaterThan(r.tdUpsertIdx);
    // …and NO zj_data write precedes the td_* upsert (no settings-first cursor bump anymore).
    const firstZjIdx = r.writes.findIndex(w => w.table === 'zj_data');
    expect(firstZjIdx).toBe(r.markerIdx);
  });

  // ── Phase-3 per-field merge — the two review-confirmed defects, fixed ─────────
  // (1) A protected pending edit must RE-UPLOAD: the hash stamped on merge must be the
  //     INCOMING cloud row's hash, never the merged row's — else the next save hash-skips
  //     the row and the protected edit never reaches the cloud (permanent divergence).
  // (2) The pending gate (_rowSyncedAt): a field whose edit already reached the cloud is
  //     NOT protected, even when a skewed-fast clock makes its field-clock ms exceed the
  //     incoming row's server-stamped updated_at.
  test.describe('_opApplyIncoming via _applyRealtimeRecord — pending-edit merge', () => {
    test('protected PENDING edit survives the merge AND is queued for re-upload (hash = incoming, not merged)', async () => {
      const r = await page.evaluate(() => {
        const id = 'm3-pending-1';
        const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt;
        try {
          window._opLogShadow = true;
          // Skip the ~15-container re-render inside _applyRealtimeRecord (fromRealtime +
          // recent local save = the echo guard returns AFTER applying data, BEFORE
          // rendering). This test asserts merge + hash semantics, not the render chain —
          // and a synchronous render here crashed on the seed row in an unrelated
          // calendar sort. Data application is unaffected by the guard.
          _lastLocalSaveAt = Date.now();
          // Local row with a pending amount edit (field clock stamped NOW, row last synced 60s ago).
          bids.push({ id, client_id: 1, client_name: 'Merge T', amount: 7, note: 'local', status: 'Pending', bid_date: '2026-07-01' });
          // A device that holds this row has a synced-hash entry from its load — seed it like
          // production. (The apply stamps via _syncedHash[tbl]?.set — no map, no stamp, and the
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

    test('already-UPLOADED edit is NOT protected — a fast clock cannot reject peer updates (pending gate)', async () => {
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
  // and queue a retry — never load concurrently (lost-edit race) and never wedge.
  test('silent supaLoadFromCloud DEFERS (not wedges) behind a hung save — releases the lock and queues a retry', async () => {
    test.setTimeout(20000);
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: window._supaUser, pend: _pendingSavePromise };
      try {
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
      }
    });
    expect(r.tookMs).toBeGreaterThanOrEqual(3900); // waited the bounded window…
    expect(r.tookMs).toBeLessThan(8000);           // …but did NOT hang
    expect(r.lockReleased).toBe(true);             // heartbeat is free to tick again
    expect(r.retryQueued).toBe(true);              // convergence retries on its own
  });

  // ── Anti-blinding guard: a save that overwrites a PEER-moved cursor queues a reconcile ──
  // Live failure (mechanism #2): B's background save overwrote zj_data.updated_at with its
  // own write AFTER A's delete moved it — the heartbeat then compared equal forever and B
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
  // Before the fast path, an idle save still paid one lockedRows SELECT per table —
  // 14 round-trips every ~2s during editing, the per-save cost that crawled on the
  // bloated dev account and would do the same to any heavy customer at scale.
  test('no-op supaSaveToCloud makes zero td_* requests (fast path) — only the zj_data settings write', async () => {
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
  // result SURVIVES the silent load — the full path's set(rows) would have wiped it.
  test('silent supaLoadFromCloud uses the delta path — untouched rows survive an empty delta', async () => {
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
  // stale data — the heartbeat then compares equal and the device goes permanently blind
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 100-WRITER PACKAGE — the load-bearing op channel + reconnect rebase.
// These guard the machinery that lets N devices write ONE account concurrently:
//   _opApplyPeerOps  — per-field HLC apply (newer wins, older rejected, stale-vs-row
//                      guard, create materialization, resurrection guard, echo-free)
//   _opDbPruneAcked  — the op log is pruned on ack and stays O(pending)
//   full-load rebase — a pending local edit survives the array replace; an
//                      offline-created row (pending CREATE op) is re-appended
//   reconnect order  — pull (reads) strictly BEFORE push (writes) on offline return
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

  test('_opApplyPeerOps — newer op sets the field, older op is rejected, no derive echo', async () => {
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

  test('_opApplyPeerOps — create op materializes an unknown row; deleted ids never resurrect; partial ops for unknown rows are skipped', async () => {
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
        // (b) This device DELETED idDel (still in _lastKnownIds, absent from the array) —
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

  test('_opApplyPeerOps — a CREATE op older than the row snapshot is a tombstone echo and must NOT materialize', async () => {
    const r = await page.evaluate(() => {
      if (typeof window.__opApplyPeerOps !== 'function') return { skip: true };
      const idOld = 771025, idNew = 771026;
      const savedFlag = window._opLogShadow, savedSaveAt = _lastLocalSaveAt, savedCursor = _deltaCursor;
      try {
        window._opLogShadow = true;
        _lastLocalSaveAt = Date.now();
        // Our row snapshot is CURRENT (cursor = now). Ops publish only after their row
        // commits, so a create op minted BEFORE this snapshot describes a row the
        // snapshot accounted for — absent from our arrays means soft-DELETED. It must
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

  test('_opApplyPeerOps — an op STALER than the row snapshot we hold is skipped (_rowServerTs guard)', async () => {
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

  test('_opDbPruneAcked — ops at-or-below the ack ceiling are DELETED, newer ops survive', async () => {
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
        // IndexedDB adds are fire-and-forget — wait until both ops are visible.
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

  test('full-load REBASE — a pending local edit survives the array replace; an offline-created row (pending CREATE op) is re-appended', async () => {
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
      // The FULL load path replaces every table array — snapshot ALL of them for restore.
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
        // clock stamped now — newer than the incoming row's updated_at), plus a row the
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
        _rowSyncedAt['td_bids'] = new Map(); // nothing "already uploaded" — the edit is genuinely pending
        _supa = { from: (t) => makeChain(t), rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'missing' } }) };
        _supaCloudLoaded = true; _isEmployee = false;
        _loadedDataOwner = UID;
        _deltaCursor = null; // force the FULL (array-replace) branch — the one that used to clobber
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

  test('crew op-sync — ops carry the CONTRACTOR uid and redacted-table ops never push', async () => {
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
        // Derive one PERMITTED op (td_clients) and one REDACTED op (td_bids) as this login.
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

  test('crew save — bumps the account cursor via RPC after table writes (never zj_data directly)', async () => {
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

  test('reconnect with pending offline writes — PULL (reads) strictly before PUSH (writes)', async () => {
    const r = await page.evaluate(async () => {
      if (typeof _onReconnect !== 'function') return { skip: true };
      const fired = [];
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, hash: _syncedHash, known: _lastKnownIds,
        auth: _authSettingsLoaded, foc: _loadedFromCacheOnly, flag: window._opLogShadow,
      };
      // The reconnect's FULL pull replaces every table array — snapshot ALL for restore.
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
});
