// @ts-check
/**
 * Co-owner (owner 2026-09-26): "both are technically owners, just one runs the
 * business and Jack does all the tech ... no data moves, it's all there."
 *
 * A co-owner joins through the crew link (Team > role "Co-owner"), so every
 * DATA path stays crew: _isEmployee is still true and _effectiveUid is still
 * the business. Every SCREEN is the owner's: _ownerUI() is the question the
 * screens ask. The server decides who is one (is_co_owner, migration
 * 20261048); the flag only picks the screens.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page) {
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
}
// Sign in as crew or co-owner of boss-1, the way _linkAsCrew leaves things.
const asLinked = (page, coOwner) => page.evaluate((co) => {
  window._supaUser = { id: 'dad-1', email: 'dad@x.com' };
  _isEmployee = true; _contractorUserId = 'boss-1'; _coOwner = co;
  _employeeRecord = { id: 't1', contractor_user_id: 'boss-1', employee_user_id: 'dad-1', name: 'Mike Sample', role: co ? 'owner' : 'tech', active: true,
    permissions: co ? { leads: true, estimate: true, schedule: true, collect: true, clients: true, expenses: true, mileage: true, financials: true, team: true, payroll: true } : { collect: true } };
  _user = { id: 'dad-1', email: 'dad@x.com', name: 'Mike Sample', role: co ? 'owner' : 'tech', account_id: null };
  applyPermissions();
}, coOwner);
const asOwner = (page) => page.evaluate(() => { _isEmployee = false; _contractorUserId = null; _employeeRecord = null; _coOwner = false; applyPermissions(); });

test.describe('Co-owner', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'co-owner'); });

  test('one question for the screens: owner yes, co-owner yes, crew no; whose data stays the business', async ({ page }) => {
    await boot(page);
    await asOwner(page);
    const owner = await page.evaluate(() => ({ ui: _ownerUI(), own: isOwner(), taxes: canSeeTaxes() }));
    await asLinked(page, true);
    const co = await page.evaluate(() => ({ ui: _ownerUI(), own: isOwner(), taxes: canSeeTaxes(), emp: _isEmployee, uid: _effectiveUid() }));
    await asLinked(page, false);
    const crew = await page.evaluate(() => ({ ui: _ownerUI(), own: isOwner(), taxes: canSeeTaxes() }));
    await asOwner(page);
    expect(owner).toEqual({ ui: true, own: true, taxes: true });
    expect(co).toEqual({ ui: true, own: true, taxes: true, emp: true, uid: 'boss-1' });
    expect(crew).toEqual({ ui: false, own: false, taxes: false });
  });

  test('the nav: Settings, Team, Money, Taxes and Tim show for a co-owner and hide for crew; the label says Co-owner', async ({ page }) => {
    await boot(page);
    const probe = () => page.evaluate(() => {
      const vis = id => { const el = document.getElementById(id); return !!el && el.style.display !== 'none'; };
      return { settings: vis('nb-settings'), team: vis('nb-team'), money: vis('nb-money'), taxes: vis('nb-taxes'), tim: vis('mmi-tim'),
        signout: vis('mmi-signout'), role: (document.getElementById('nav-user-role') || {}).textContent };
    });
    await asLinked(page, true);
    const co = await probe();
    await asLinked(page, false);
    const crew = await probe();
    await asOwner(page);
    expect(co).toMatchObject({ settings: true, team: true, money: true, taxes: true, tim: true, signout: false, role: 'Owner' });
    expect(crew).toMatchObject({ settings: false, team: false, money: false, taxes: false, tim: false, signout: true });
  });

  test('goPg: a co-owner reaches every owner page; crew is still sent home', async ({ page }) => {
    await boot(page);
    const go = (id) => page.evaluate((id) => { goPg(id); return document.querySelector('.pg.active')?.id; }, id);
    await asLinked(page, true);
    const co = [await go('pg-settings'), await go('pg-team'), await go('pg-taxes'), await go('pg-money')];
    await asLinked(page, false);
    const crew = [await go('pg-settings'), await go('pg-taxes')];
    await asOwner(page);
    await go('pg-dash');
    expect(co).toEqual(['pg-settings', 'pg-team', 'pg-taxes', 'pg-money']);
    expect(crew).toEqual(['pg-dash', 'pg-dash']);
  });

  test('pay, team location and Tim are open to a co-owner, shut to plain crew', async ({ page }) => {
    await boot(page);
    await asLinked(page, true);
    const co = await page.evaluate(() => ({ comp: _canViewComp(), geo: _teamGeoAllowed(), timCrew: _timCrew() }));
    await asLinked(page, false);
    const crew = await page.evaluate(() => ({ comp: _canViewComp(), geo: _teamGeoAllowed(), timCrew: _timCrew() }));
    await asOwner(page);
    expect(co).toEqual({ comp: true, geo: true, timCrew: false });
    expect(crew).toEqual({ comp: false, geo: false, timCrew: true });
  });

  test('Settings: a co-owner saves the business settings (zj_data under the business uid); crew never writes them', async ({ page }) => {
    await boot(page);
    const run = (co) => page.evaluate(async (co) => {
      const saved = { supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, cacheOnly: _loadedFromCacheOnly, emp: _isEmployee, cid: _contractorUserId,
        rec: _employeeRecord, co: _coOwner, authS: _authSettingsLoaded, hash: _syncedHash, known: _lastKnownIds };
      const snap = _TD_TABLES.map(({ set, get }) => ({ set, rows: (get() || []).slice() }));
      snap.forEach(({ set }) => set([]));
      const writes = [], rpcs = [];
      const chain = (table) => { const c = { _mk: null,
        select() { return c; }, eq() { return c; }, gt() { return c; }, lt() { return c; }, in() { return c; }, is() { return c; }, order() { return c; }, limit() { return c; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        single() { return Promise.resolve({ data: c._mk || { updated_at: new Date().toISOString() }, error: null }); },
        upsert(v) { writes.push({ table, op: 'upsert', uid: v && (v.user_id || (Array.isArray(v) && v[0] && v[0].user_id)) }); c._mk = { updated_at: new Date().toISOString() }; return c; },
        update(v) { writes.push({ table, op: 'update' }); c._mk = { updated_at: new Date().toISOString() }; return c; },
        then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); } }; return c; };
      _supa = { from: (t) => chain(t), rpc: (fn) => { rpcs.push(fn); return Promise.resolve({ data: null, error: null }); } };
      window._supaUser = { id: 'dad-1', email: 'dad@x.com' };
      _supaCloudLoaded = true; _loadedFromCacheOnly = false; _authSettingsLoaded = true; _syncedHash = {}; _lastKnownIds = {};
      _isEmployee = true; _contractorUserId = 'boss-1'; _coOwner = co;
      _employeeRecord = { contractor_user_id: 'boss-1', employee_user_id: 'dad-1', role: co ? 'owner' : 'tech', active: true,
        permissions: { leads: true, estimate: true, schedule: true, collect: true, clients: true, expenses: true, mileage: true, financials: true, team: true, payroll: true } };
      _TD_TABLES.find(x => x.t === 'td_bids').set([{ id: 'co-bid-1', client_id: 1, amount: 50, status: 'Pending', bid_date: '2026-09-01' }]);
      let threw = null;
      try { await supaSaveToCloud(); } catch (e) { threw = (e && e.message) || String(e); }
      snap.forEach(({ set, rows }) => set(rows));
      _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded; _loadedFromCacheOnly = saved.cacheOnly;
      _isEmployee = saved.emp; _contractorUserId = saved.cid; _employeeRecord = saved.rec; _coOwner = saved.co; _authSettingsLoaded = saved.authS;
      _syncedHash = saved.hash; _lastKnownIds = saved.known;
      return { threw, zj: writes.filter(w => w.table === 'zj_data'), td: writes.filter(w => /^td_/.test(w.table)), rpcs };
    }, co);
    const co = await run(true);
    const crew = await run(false);
    expect(co.threw).toBe(null);
    expect(co.td.length).toBeGreaterThan(0);
    expect(co.zj.map(w => w.op)).toEqual(['upsert']);
    expect(co.zj[0].uid).toBe('boss-1');
    expect(crew.threw).toBe(null);
    expect(crew.zj).toEqual([]);
    expect(crew.rpcs).toContain('bump_account_cursor');
  });

  test('Stripe: a co-owner sees whether card payments are on, and can never start, resume or unlink them', async ({ page }) => {
    await boot(page);
    await asLinked(page, true);
    const r = await page.evaluate(async () => {
      const el = document.createElement('div'); document.body.appendChild(el);
      _renderStripeConnectUI(el, { connected: true, charges_enabled: true, stripe_account_id: 'acct_1' });
      const on = el.textContent;
      _renderStripeConnectUI(el, { connected: false });
      const off = el.textContent, buttons = el.querySelectorAll('button').length;
      el.remove();
      const alerts = [], fetches = [];
      const za = window.zAlert, f = window.fetch;
      window.zAlert = (m) => alerts.push(m); window.fetch = (...a) => { fetches.push(a[0]); return f(...a); };
      try { await startStripeConnect(); await disconnectStripeConnect(); } finally { window.zAlert = za; window.fetch = f; }
      return { on, off, buttons, alerts, fetches: fetches.filter(u => /stripe-connect/.test(String(u))) };
    });
    await asOwner(page);
    expect(r.on).toContain('Stripe connected, payments active');
    expect(r.on).toContain('login that created this business');
    expect(r.off).toContain('Card payments are not on yet');
    expect(r.buttons).toBe(0);
    expect(r.alerts).toEqual(['Card payments are set up from the login that created this business.', 'Card payments are set up from the login that created this business.']);
    expect(r.fetches).toEqual([]);
  });

  test('the server says no: owner screens go away, the offline copy forgets it, and an owner page sends them home', async ({ page }) => {
    await boot(page);
    await asLinked(page, true);
    const r = await page.evaluate(async () => {
      localStorage.setItem('zp3_acct_dad-1', JSON.stringify({ user: _user, isEmployee: true, contractorUserId: 'boss-1', coOwner: true }));
      goPg('pg-settings');
      const saved = _supa;
      _supa = { rpc: async (fn, a) => ({ data: fn === 'is_co_owner' && a.boss === 'boss-1' ? false : null, error: null }) };
      try { await _verifyCoOwner('boss-1'); } finally { _supa = saved; }
      return { co: _coOwner, cache: JSON.parse(localStorage.getItem('zp3_acct_dad-1')).coOwner, page: document.querySelector('.pg.active')?.id,
        settingsNav: document.getElementById('nb-settings').style.display };
    });
    await asOwner(page);
    await page.evaluate(() => { localStorage.removeItem('zp3_acct_dad-1'); goPg('pg-dash'); });
    expect(r).toEqual({ co: false, cache: false, page: 'pg-dash', settingsNav: 'none' });
  });

  test('the server says yes, or cannot be reached: nothing changes', async ({ page }) => {
    await boot(page);
    await asLinked(page, true);
    const r = await page.evaluate(async () => {
      const saved = _supa; const out = [];
      for (const ans of [{ data: true, error: null }, { data: null, error: { message: 'offline' } }]) {
        _supa = { rpc: async () => ans };
        await _verifyCoOwner('boss-1'); out.push(_coOwner);
      }
      _supa = { rpc: async () => { throw new Error('network'); } };
      await _verifyCoOwner('boss-1'); out.push(_coOwner);
      await _verifyCoOwner(null); out.push(_coOwner);
      _supa = saved;
      return out;
    });
    await asOwner(page);
    expect(r).toEqual([true, true, true, true]);
  });

  test('the offline restore brings the co-owner screens back, and an owner login clears the flag', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const saved = { u: _user, emp: _isEmployee, cid: _contractorUserId, co: _coOwner };
      const tk = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
      const key = 'sb-test-auth-token', had = tk ? null : key;
      if (!tk) localStorage.setItem(key, JSON.stringify({ user: { id: 'dad-1' } }));
      const uid = tk ? ((JSON.parse(localStorage.getItem(tk)) || {}).user || {}).id : 'dad-1';
      localStorage.setItem('zp3_acct_' + uid, JSON.stringify({ user: { id: uid, role: 'owner' }, isEmployee: true, contractorUserId: 'boss-1', coOwner: true }));
      _user = null; _restoreIdentityFromCache();
      const a = { co: _coOwner, ui: _ownerUI() };
      localStorage.setItem('zp3_acct_' + uid, JSON.stringify({ user: { id: uid, role: 'owner' }, isEmployee: false }));
      _user = null; _restoreIdentityFromCache();
      const b = { co: _coOwner, ui: _ownerUI() };
      localStorage.removeItem('zp3_acct_' + uid); if (had) localStorage.removeItem(had);
      _user = saved.u; _isEmployee = saved.emp; _contractorUserId = saved.cid; _coOwner = saved.co; applyPermissions();
      return { a, b };
    });
    expect(r.a).toEqual({ co: true, ui: true });
    expect(r.b).toEqual({ co: false, ui: true });
  });

  test('the Team role picker names it plainly and ticks every box', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openInviteEmployeeModal();
      const sel = document.getElementById('_inv-role');
      const label = [...sel.options].find(o => o.value === 'owner').textContent;
      _setEmpRolePreset('owner');
      const all = Object.keys(_EMP_PERM_LABELS).every(p => document.getElementById('_perm-' + p).checked);
      document.getElementById('_emp-invite-ov')?.remove();
      return { label, all };
    });
    expect(r.label).toBe('Owner (sees and runs everything)');
    expect(r.all).toBe(true);
  });

  test('junk in never throws', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const bad = [];
      const saved = _coOwner;
      for (const v of [undefined, null, 0, 'yes', {}]) { try { window._coOwner = v; _ownerUI(); isOwner(); applyPermissions(); } catch (e) { bad.push(String(v)); } }
      _coOwner = saved;
      try { await _verifyCoOwner(undefined); } catch (e) { bad.push('verify'); }
      return { bad, coercedBool: (window._coOwner = 'yes', typeof _coOwner) };
    });
    await asOwner(page);
    expect(r.bad).toEqual([]);
    expect(r.coercedBool).toBe('boolean');
  });
  // Saving an employee sent active:false on EVERY save, so editing somebody
  // who had joined switched them off the business: making Blake an owner
  // locked him out (2026-09-26). Only a brand-new invite starts inactive.
  test('Team save: editing a member never switches them off; a new invite starts inactive; a co-owner saves to the business', async ({ page }) => {
    await boot(page);
    const run = (co, isNew) => page.evaluate(async ({ co, isNew }) => {
      const ups = [];
      const saved = { supa: _supa, user: window._supaUser, emp: _isEmployee, cid: _contractorUserId, co: _coOwner, rec: _employeeRecord, list: S.employees, mint: window._mintCrewInviteToken };
      const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); }, single() { return Promise.resolve({ data: null, error: null }); },
        then(r, j) { return Promise.resolve({ data: [], error: null }).then(r, j); } };
      _supa = { from: (t) => ({ ...chain, upsert: (row) => { if (t === 'team_members') ups.push(row); return Promise.resolve({ error: null }); },
        insert: () => chain, update: () => chain }), rpc: async () => ({ data: null, error: null }),
        auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
      window._mintCrewInviteToken = async () => null;
      window._supaUser = { id: co ? 'dad-1' : 'boss-1', email: 'x@x.com' };
      _isEmployee = co; _contractorUserId = co ? 'boss-1' : null; _coOwner = co;
      _employeeRecord = co ? { contractor_user_id: 'boss-1', employee_user_id: 'dad-1', role: 'owner', active: true, permissions: { team: true, payroll: true } } : null;
      S.employees = [{ id: 7, name: 'Blake Sample', email: 'blake@x.com', role: 'manager', permissions: {} }];
      try {
        if (isNew) { openAddEmployeeModal(); document.getElementById('emp-name').value = 'New Guy'; document.getElementById('emp-email').value = 'new@x.com'; await _saveEmployee(null); }
        else { openEditEmployeeModal(0); document.getElementById('emp-role').value = 'owner'; await _saveEmployee(0); }
      } catch (e) { ups.push({ threw: String(e) }); }
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      _supa = saved.supa; window._supaUser = saved.user; _isEmployee = saved.emp; _contractorUserId = saved.cid; _coOwner = saved.co; _employeeRecord = saved.rec; S.employees = saved.list; window._mintCrewInviteToken = saved.mint;
      applyPermissions();
      return ups;
    }, { co, isNew });
    const edit = await run(false, false);
    const invite = await run(false, true);
    const coEdit = await run(true, false);
    expect(edit.length).toBe(1);
    expect(edit[0]).toMatchObject({ contractor_user_id: 'boss-1', email: 'blake@x.com', role: 'owner' });
    expect('active' in edit[0], 'an edit never touches whether they are on the team').toBe(false);
    expect('invited_at' in edit[0]).toBe(false);
    expect(invite[0]).toMatchObject({ email: 'new@x.com', active: false });
    expect(typeof invite[0].invited_at).toBe('string');
    expect(coEdit[0].contractor_user_id, 'a co-owner edits the business roster, not their own').toBe('boss-1');
    expect('active' in coEdit[0]).toBe(false);
  });
  // The trade pills live on the business's account_config, which crew never
  // load. Blake, made an owner, saw no trade picker (2026-09-26).
  test('the server says yes: the business name and trade lines load, and the trade picker shows', async ({ page }) => {
    await boot(page);
    await asLinked(page, true);
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, acct: _account, cfg: _config };
      localStorage.setItem('zp3_acct_dad-1', JSON.stringify({ user: _user, isEmployee: true, contractorUserId: 'boss-1', coOwner: true }));
      const q = (row) => { const c = { select() { return c; }, eq() { return c; }, maybeSingle: async () => ({ data: row, error: null }) }; return c; };
      _supa = { rpc: async () => ({ data: true, error: null }),
        from: (t) => t === 'accounts' ? q({ id: 'acct-1', owner_id: 'boss-1', business_name: 'Plumbing Solutions' })
                   : q({ account_id: 'acct-1', trade_lines: 'painting,plumbing', business_type: 'plumbing' }) };
      try { await _verifyCoOwner('boss-1'); } finally { _supa = saved.supa; }
      const wrap = document.getElementById('nav-trade-switcher');
      const out = { co: _coOwner, biz: _account && _account.business_name, lines: _getTradeLines(), shown: !!wrap && wrap.style.display !== 'none',
        pills: document.querySelectorAll('#nav-trade-pills button').length, cached: JSON.parse(localStorage.getItem('zp3_acct_dad-1')).config.trade_lines };
      _account = saved.acct; _config = saved.cfg; localStorage.removeItem('zp3_acct_dad-1');
      if (typeof _renderNavTradeSwitcher === 'function') _renderNavTradeSwitcher();
      return out;
    });
    await asOwner(page);
    expect(r).toEqual({ co: true, biz: 'Plumbing Solutions', lines: ['painting', 'plumbing'], shown: true, pills: 2, cached: 'painting,plumbing' });
  });

});
