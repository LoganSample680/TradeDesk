// @ts-check
// ── Dual-hat accounts (§9.10 slice 1): crew by day, owner by night, ONE login ──
//
// What this suite locks down:
//
// 1. HAT RESOLUTION. An owner login that is ALSO an active crew member surfaces
//    both hats (window._hatCrewLinks / _hatOwnsBusiness) and honors the persisted
//    zp3_hat_<uid> choice. A stale crew hat (the boss removed the link) silently
//    self-clears back to the owner path, never an error, never a dead boot.
//
// 2. THE DATA WALL. Both hats share the same login id, so every owner-tag guard
//    that compares _owner alone is blind to a hat switch. The _dataOwner tag (the
//    BUSINESS whose rows a snapshot holds) closes that: switchHat clears the cloud
//    cache and delta cursor outright, and the offline-pending blob is refused
//    across hats at read time rather than deleted (the other hat still owns it).
//
// 3. THE CREW-CACHE REGRESSION. The load-failure cache guard added in e8a5f06
//    compared _owner (the crew LOGIN's id) against the load uid (the BOSS's id),
//    wrongly rejecting a crew session's own legitimate offline cache. _dataOwner
//    is the fix, this suite pins both directions: own cache accepted, foreign
//    hat's cache rejected.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Dual-hat accounts: switcher + data wall', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Stub reconnect-driven loads (the fleet-spec flake fix), but keep a handle to
    // the real function: the cache-guard regression test below exercises the REAL
    // supaLoadFromCloud's catch-block fallback.
    await page.evaluate(() => { window.__realSupaLoad = supaLoadFromCloud; window.supaLoadFromCloud = async () => {}; });
  });

  // ── 1. Hat resolution in loadAccountData ────────────────────────────────────

  function fakeSupaFor(usersRow, teamRows) {
    // Minimal thenable-chain stub covering exactly the tables loadAccountData
    // touches on the owner path: users, accounts, account_config, vehicles,
    // team_members, zj_data. Each from() chain resolves with the right shape.
    return `(function(){
      const usersRow=${JSON.stringify(usersRow)};
      const teamRows=${JSON.stringify(teamRows)};
      const chain=(t)=>{
        const c={_t:t,select(){return c;},eq(){return c;},is(){return c;},order(){return c;},update(){return c;},upsert(){return c;},
          maybeSingle(){
            if(t==='users')return Promise.resolve({data:usersRow,error:null});
            if(t==='accounts')return Promise.resolve({data:{id:'acct-1',business_name:'Night Landscaping'},error:null});
            if(t==='account_config')return Promise.resolve({data:{business_type:'landscaping'},error:null});
            if(t==='zj_data')return Promise.resolve({data:null,error:null});
            return Promise.resolve({data:null,error:null});
          },
          then(res,rej){
            if(t==='team_members')return Promise.resolve({data:teamRows,error:null}).then(res,rej);
            return Promise.resolve({data:[],error:null}).then(res,rej);
          }};
        return c;
      };
      return {from:(t)=>chain(t),rpc:()=>Promise.resolve({data:null,error:null})};
    })()`;
  }

  test('owner login with an active crew link surfaces both hats and defaults to owner', async () => {
    const r = await page.evaluate(async ({ supaSrc }) => {
      const saved = { supa: _supa, user: window._supaUser, isEmp: _isEmployee, cid: _contractorUserId, rec: _employeeRecord, u: _user, links: window._hatCrewLinks, owns: window._hatOwnsBusiness };
      try {
        localStorage.removeItem('zp3_hat_dual-u1');
        _supa = eval(supaSrc);
        window._supaUser = { id: 'dual-u1', email: 'dual@test.com' };
        const ok = await loadAccountData();
        return {
          ok,
          owns: window._hatOwnsBusiness,
          links: (window._hatCrewLinks || []).length,
          isEmployee: _isEmployee,
        };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _isEmployee = saved.isEmp;
        _contractorUserId = saved.cid; _employeeRecord = saved.rec; _user = saved.u;
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns;
        localStorage.removeItem('zp3_hat_dual-u1'); localStorage.removeItem('zp3_acct_dual-u1');
        applyPermissions();
      }
    }, { supaSrc: fakeSupaFor({ id: 'dual-u1', account_id: 'acct-1' }, [{ contractor_user_id: 'boss-1', name: 'BIL', role: 'plumber', active: true, id: 'tm-1' }]) });
    expect(r.ok, 'owner path resolves').toBe(true);
    expect(r.owns, 'login is flagged as owning a business').toBe(true);
    expect(r.links, 'the crew link is surfaced for the switcher').toBe(1);
    expect(r.isEmployee, 'no stored hat means the owner hat wins, same as before the feature').toBe(false);
  });

  test('a stored crew hat routes the SAME login through the standard crew-linking path', async () => {
    const r = await page.evaluate(async ({ supaSrc }) => {
      const saved = { supa: _supa, user: window._supaUser, isEmp: _isEmployee, cid: _contractorUserId, rec: _employeeRecord, u: _user, links: window._hatCrewLinks, owns: window._hatOwnsBusiness };
      const origToast = window.showToast; window.showToast = () => {};
      try {
        localStorage.setItem('zp3_hat_dual-u1', 'crew:boss-1');
        _supa = eval(supaSrc);
        window._supaUser = { id: 'dual-u1', email: 'dual@test.com' };
        const ok = await loadAccountData();
        return {
          ok,
          isEmployee: _isEmployee,
          boss: _contractorUserId,
          owns: window._hatOwnsBusiness, // still true: the switcher must offer the way back
          steered: localStorage.getItem('zp3_crew_choice_dual-u1'),
        };
      } finally {
        window.showToast = origToast;
        _supa = saved.supa; window._supaUser = saved.user; _isEmployee = saved.isEmp;
        _contractorUserId = saved.cid; _employeeRecord = saved.rec; _user = saved.u;
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns;
        ['zp3_hat_dual-u1', 'zp3_acct_dual-u1', 'zp3_crew_choice_dual-u1'].forEach(k => localStorage.removeItem(k));
        applyPermissions();
      }
    }, { supaSrc: fakeSupaFor({ id: 'dual-u1', account_id: 'acct-1' }, [{ contractor_user_id: 'boss-1', name: 'BIL', role: 'plumber', active: true, id: 'tm-1' }]) });
    expect(r.ok, 'crew hat resolves through the crew path').toBe(true);
    expect(r.isEmployee, 'the session IS a crew session, identical to a crew-only login').toBe(true);
    expect(r.boss, 'scoped to the chosen boss').toBe('boss-1');
    expect(r.owns, 'the way back to their own business stays offered').toBe(true);
    expect(r.steered, 'multi-crew deterministic pick is steered at the chosen boss').toBe('boss-1');
  });

  test('a stale crew hat (link deactivated) self-clears and lands in their own business', async () => {
    const r = await page.evaluate(async ({ supaSrc }) => {
      const saved = { supa: _supa, user: window._supaUser, isEmp: _isEmployee, cid: _contractorUserId, rec: _employeeRecord, u: _user, links: window._hatCrewLinks, owns: window._hatOwnsBusiness };
      try {
        localStorage.setItem('zp3_hat_dual-u1', 'crew:boss-GONE');
        _supa = eval(supaSrc);
        window._supaUser = { id: 'dual-u1', email: 'dual@test.com' };
        const ok = await loadAccountData();
        return { ok, isEmployee: _isEmployee, hatCleared: localStorage.getItem('zp3_hat_dual-u1') === null };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _isEmployee = saved.isEmp;
        _contractorUserId = saved.cid; _employeeRecord = saved.rec; _user = saved.u;
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns;
        ['zp3_hat_dual-u1', 'zp3_acct_dual-u1'].forEach(k => localStorage.removeItem(k));
        applyPermissions();
      }
    }, { supaSrc: fakeSupaFor({ id: 'dual-u1', account_id: 'acct-1' }, []) });
    expect(r.ok).toBe(true);
    expect(r.isEmployee, 'falls back to the owner hat, never a dead boot').toBe(false);
    expect(r.hatCleared, 'the stale hat is dropped so future boots stop re-checking it').toBe(true);
  });

  // ── 2. switchHat: persistence + the hard wall ───────────────────────────────

  test('switchHat persists the choice, clears cache + delta cursor, leaves offline-pending, reloads', async () => {
    const r = await page.evaluate(async () => {
      const saved = { user: window._supaUser, timer: typeof _syncTimer !== 'undefined' ? _syncTimer : null };
      // location.reload cannot be stubbed reliably cross-browser; sacrifice-free
      // probe: stub via history alteration is worse, so wrap reload calls through
      // a temporary override on the prototype where supported, else detect via
      // beforeunload. Simplest robust route: spy on Location.prototype not
      // allowed, so instead call switchHat in a sandboxed frame? Overkill here:
      // switchHat's ONLY unobservable step is reload, everything else is
      // localStorage, assert those and accept the reload attempt in an iframe.
      const fr = document.createElement('iframe');
      fr.style.display = 'none';
      document.body.appendChild(fr);
      try {
        window._supaUser = { id: 'dual-u1' };
        if (typeof _syncTimer !== 'undefined') _syncTimer = null;
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: 'dual-u1', _dataOwner: 'dual-u1', clients: [] }));
        localStorage.setItem('zp3_delta_meta', JSON.stringify({ _owner: 'dual-u1', cursor: new Date().toISOString() }));
        localStorage.setItem('zp3_offline_pending', JSON.stringify({ _owner: 'dual-u1', _dataOwner: 'dual-u1', clients: [{ id: 'keep-me' }] }));
        // Run the function body against a fake location so the test page survives.
        const fn = window.switchHat.toString();
        const patched = fn.replace('location.reload()', 'window.__hatReloaded=true');
        window.__hatReloaded = false;
        await eval('(' + patched + ')')('boss-1');
        return {
          hat: localStorage.getItem('zp3_hat_dual-u1'),
          cacheGone: localStorage.getItem('zp3_cloud_cache') === null,
          deltaGone: localStorage.getItem('zp3_delta_meta') === null,
          pendingKept: localStorage.getItem('zp3_offline_pending') !== null,
          reloaded: window.__hatReloaded,
        };
      } finally {
        fr.remove();
        window._supaUser = saved.user;
        ['zp3_hat_dual-u1', 'zp3_offline_pending'].forEach(k => localStorage.removeItem(k));
        delete window.__hatReloaded;
      }
    });
    expect(r.hat, 'crew hat persisted as crew:<cid>').toBe('crew:boss-1');
    expect(r.cacheGone, 'outgoing hat snapshot cleared (the hard wall)').toBe(true);
    expect(r.deltaGone, 'outgoing hat delta cursor cleared').toBe(true);
    expect(r.pendingKept, 'offline-pending is NEVER deleted here, it may hold the other hat\'s unsaved records').toBe(true);
    expect(r.reloaded, 'ends in a clean reload, the reload IS the reset machinery').toBe(true);
  });

  // ── 3. The _dataOwner wall ──────────────────────────────────────────────────

  test('_readOwnedOfflinePending refuses the other hat\'s blob without deleting it', async () => {
    const r = await page.evaluate(() => {
      const saved = { user: window._supaUser, isEmp: _isEmployee, cid: _contractorUserId };
      try {
        // Same login, blob written under the CREW hat (dataOwner = the boss)...
        window._supaUser = { id: 'dual-u1' };
        _isEmployee = false; _contractorUserId = null; // ...being read under the OWNER hat
        localStorage.setItem('zp3_offline_pending', JSON.stringify({ _owner: 'dual-u1', _dataOwner: 'boss-1', clients: [{ id: 'boss-client' }] }));
        const got = _readOwnedOfflinePending();
        const stillThere = localStorage.getItem('zp3_offline_pending') !== null;
        // And the hat's own blob is still served.
        localStorage.setItem('zp3_offline_pending', JSON.stringify({ _owner: 'dual-u1', _dataOwner: 'dual-u1', clients: [{ id: 'own-client' }] }));
        const own = _readOwnedOfflinePending();
        return { crossHatRefused: got === null, notDeleted: stillThere, ownServed: !!(own && own.clients && own.clients[0].id === 'own-client') };
      } finally {
        window._supaUser = saved.user; _isEmployee = saved.isEmp; _contractorUserId = saved.cid;
        localStorage.removeItem('zp3_offline_pending');
      }
    });
    expect(r.crossHatRefused, 'the other hat\'s unsaved records must never merge into this hat').toBe(true);
    expect(r.notDeleted, 'refused, not destroyed: the other hat can still drain it later').toBe(true);
    expect(r.ownServed, 'the hat\'s own blob still merges normally').toBe(true);
  });

  test('crew session\'s own cache passes the load-failure guard; the other hat\'s is rejected (e8a5f06 regression)', async () => {
    const r = await page.evaluate(async () => {
      const saved = {
        supa: _supa, user: window._supaUser, loaded: _supaCloudLoaded, owner: _loadedDataOwner,
        cursor: _deltaCursor, emp: _isEmployee, cid: _contractorUserId,
        clients: clients.slice(), bids: bids.slice(),
        wlc: _writeLocalCache,
      };
      // Diagnosed from CI (diag: hit:false, err:null, len:0 both directions): the
      // app's background save path calls _writeLocalCache mid-test and OVERWRITES
      // the seeded zp3_cloud_cache with the mock session's own snapshot, whose
      // _dataOwner matches neither hat, so the guard (correctly) rejects it and
      // the test reads as a guard failure. Silence the writer for the duration.
      _writeLocalCache = () => {};
      const run = async (cacheDataOwner, marker) => {
        localStorage.setItem('zp3_cloud_cache', JSON.stringify({
          _owner: 'dual-u1',            // the crew LOGIN, same for both hats
          _dataOwner: cacheDataOwner,   // the business the rows belong to
          clients: [{ id: marker, name: marker }],
          bids: [], jobs: [], payments: [], income: [], expenses: [], mileage: [],
        }));
        _supa = { from: () => { throw new Error('simulated network failure'); }, rpc: () => Promise.resolve({ data: null, error: null }) };
        window._supaUser = { id: 'dual-u1' };
        _supaCloudLoaded = false; _isEmployee = true; _contractorUserId = 'boss-1'; // load uid = boss-1
        _loadedDataOwner = null; _deltaCursor = null;
        // Hermetic entry state: any of these left over from the app's own mocked
        // boot (an in-flight load, a scheduled debounce, dev-support mode) makes
        // supaLoadFromCloud bail or detour before it ever reaches the fallback
        // under test, which reads as a guard failure when it's a fixture leak.
        _loadInProgress = false; _activeLoadPromise = null;
        if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
        _pendingSavePromise = null; _devSupportMode = false;
        localStorage.removeItem('zp3_offline_pending');
        clients.length = 0; bids.length = 0;
        // Decisive tracing: supaLoadFromCloud narrates its catch paths via
        // console.warn ("Cloud load failed", "Cache load failed: <reason>"), so
        // capturing warns during the call distinguishes every way this can paint
        // nothing: no warns = early return before the try; "Cloud load failed"
        // alone = catch entered but cache missing; both = the guard's reason is
        // in the second warn's text.
        const warns = [];
        const origWarn = console.warn;
        console.warn = (...a) => { warns.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
        let err = null;
        try { await window.__realSupaLoad({ silent: false }); } catch (e) { err = e?.message || String(e); }
        console.warn = origWarn;
        return {
          hit: clients.some(c => c.id === marker), err, len: clients.length,
          warns: warns.filter(w => /load failed/i.test(w)).slice(0, 4),
          uidProbe: (_isEmployee ? _contractorUserId : (window._supaUser && window._supaUser.id)) || null,
          cacheAfter: !!localStorage.getItem('zp3_cloud_cache'),
          realFnType: typeof window.__realSupaLoad,
        };
      };
      try {
        const own = await run('boss-1', 'crew-own-cache');       // written by THIS crew session
        const other = await run('dual-u1', 'owner-hat-cache');   // written by the OWNER hat
        return { ownAccepted: own.hit, otherRejected: !other.hit, diag: JSON.stringify({ own, other }) };
      } finally {
        _supa = saved.supa; window._supaUser = saved.user; _supaCloudLoaded = saved.loaded;
        _loadedDataOwner = saved.owner; _deltaCursor = saved.cursor; _isEmployee = saved.emp; _contractorUserId = saved.cid;
        _writeLocalCache = saved.wlc;
        clients.length = 0; saved.clients.forEach(c => clients.push(c));
        bids.length = 0; saved.bids.forEach(b => bids.push(b));
        localStorage.removeItem('zp3_cloud_cache');
        _loadInProgress = false; _activeLoadPromise = null;
        applyPermissions();
      }
    });
    expect(r.ownAccepted, 'a crew session\'s own cache is legitimate offline fallback (was wrongly rejected by the bare _owner guard). diag: ' + r.diag).toBe(true);
    expect(r.otherRejected, 'the owner hat\'s cache must never paint into a crew session. diag: ' + r.diag).toBe(true);
  });

  // ── 4. The switcher UI ──────────────────────────────────────────────────────

  test('_hatSwitcherMenu lists both hats, marks the current one, and routes taps to switchHat', async () => {
    const r = await page.evaluate(() => {
      const saved = { links: window._hatCrewLinks, owns: window._hatOwnsBusiness, isEmp: _isEmployee };
      try {
        window._hatCrewLinks = [{ contractor_user_id: 'boss-1', name: 'BIL', role: 'plumber' }];
        window._hatOwnsBusiness = true;
        _isEmployee = false;
        _hatSwitcherMenu();
        const ov = document.getElementById('_hat-switch-ov');
        const html = ov ? ov.innerHTML : '';
        const out = {
          open: !!ov,
          hasOwner: html.includes('Owner'),
          hasCrew: html.includes('Crew'),
          currentMarked: html.includes('CURRENT'),
          routesToSwitchHat: html.includes("switchHat('boss-1')"),
        };
        ov?.remove();
        return out;
      } finally {
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns; _isEmployee = saved.isEmp;
      }
    });
    expect(r.open).toBe(true);
    expect(r.hasOwner).toBe(true);
    expect(r.hasCrew).toBe(true);
    expect(r.currentMarked, 'the active hat reads as current, not tappable').toBe(true);
    expect(r.routesToSwitchHat).toBe(true);
  });

  test('employee sign-out menu offers "Switch to my business" only for dual-hat logins', async () => {
    const r = await page.evaluate(() => {
      const saved = { owns: window._hatOwnsBusiness, rec: _employeeRecord };
      try {
        _employeeRecord = { id: 'emp-hat-1', name: 'BIL', role: 'plumber' };
        window._hatOwnsBusiness = true;
        _employeeSignOutMenu();
        const withHat = document.getElementById('_emp-signout-ov')?.innerHTML.includes('Switch to my business');
        document.getElementById('_emp-signout-ov')?.remove();
        window._hatOwnsBusiness = false;
        _employeeSignOutMenu();
        const withoutHat = document.getElementById('_emp-signout-ov')?.innerHTML.includes('Switch to my business');
        document.getElementById('_emp-signout-ov')?.remove();
        return { withHat: !!withHat, withoutHat: !!withoutHat };
      } finally {
        window._hatOwnsBusiness = saved.owns; _employeeRecord = saved.rec;
      }
    });
    expect(r.withHat, 'dual-hat crew session gets the flip back to their own business').toBe(true);
    expect(r.withoutHat, 'a crew-only login never sees a business it does not have').toBe(false);
  });

  test('the top-left brand becomes the switcher for dual-hat logins, stays the egg otherwise', async () => {
    const r = await page.evaluate(() => {
      const saved = { links: window._hatCrewLinks, owns: window._hatOwnsBusiness, isEmp: _isEmployee };
      const probe = () => {
        _applyEmployeeNavGating();
        const chev = document.getElementById('topbar-hat-chev');
        document.getElementById('mobile-topbar-brand')?.click();
        const menuOpen = !!document.getElementById('_hat-switch-ov');
        document.getElementById('_hat-switch-ov')?.remove();
        // Gating with 2+ hats also fires the one-time coach bubble as a real side
        // effect; leaving it in the DOM makes the coach test's own "no bubble yet"
        // precondition false and it early-returns without setting its flag (the
        // exact CI failure this line exists to prevent).
        document.getElementById('_hat-coach')?.remove();
        return { chevShown: !!(chev && chev.style.display !== 'none'), menuOpen };
      };
      try {
        // Owner hat with a crew link: brand switches, chevron shows.
        _isEmployee = false; window._hatOwnsBusiness = true;
        window._hatCrewLinks = [{ contractor_user_id: 'boss-1', name: 'BIL', role: 'plumber' }];
        const multi = probe();
        // Single-hat owner: brand goes back to the egg, chevron hides.
        window._hatCrewLinks = []; window._hatOwnsBusiness = true;
        const single = probe();
        // Crew hat whose login owns a business: brand switches there too.
        _isEmployee = true; window._hatOwnsBusiness = true; window._hatCrewLinks = [];
        const crewSide = probe();
        return { multi, single, crewSide };
      } finally {
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns; _isEmployee = saved.isEmp;
        _applyEmployeeNavGating();
        document.getElementById('_hat-switch-ov')?.remove();
      }
    });
    expect(r.multi.chevShown, 'chevron renders when the tap actually switches').toBe(true);
    expect(r.multi.menuOpen, 'brand tap opens the switcher for a dual-hat owner').toBe(true);
    expect(r.single.chevShown, 'no second hat, no chevron, the affordance never lies').toBe(false);
    expect(r.single.menuOpen, 'single-hat brand tap never opens the switcher').toBe(false);
    expect(r.crewSide.menuOpen, 'crew hat with an owned business gets the switcher from the same spot').toBe(true);
  });

  test('the switcher teaches itself: one-time coach bubble, post-switch toast, never a recurring nag', async () => {
    const r = await page.evaluate(async () => {
      const saved = { links: window._hatCrewLinks, owns: window._hatOwnsBusiness, isEmp: _isEmployee, user: window._supaUser };
      const origToast = window.showToast;
      let toasts = [];
      window.showToast = (msg) => { toasts.push(String(msg)); };
      try {
        window._supaUser = { id: 'coach-u1' };
        localStorage.removeItem('zp3_hat_coach_coach-u1');
        sessionStorage.removeItem('_hatJustSwitched');
        _isEmployee = false; window._hatOwnsBusiness = true;
        window._hatCrewLinks = [{ contractor_user_id: 'boss-1', name: 'BIL', role: 'plumber' }];
        document.getElementById('supa-boot-overlay')?.remove();
        // A bubble left over from ANY earlier test (other suites' loadAccountData
        // calls fire the real coach too) trips _hatTeachOnce's already-shown
        // early-return before it ever sets this uid's flag.
        document.getElementById('_hat-coach')?.remove();
        // First multi-hat render: bubble appears, flag set.
        _applyEmployeeNavGating();
        await new Promise(res => setTimeout(res, 50));
        const bubbleFirst = !!document.getElementById('_hat-coach');
        const flagSet = localStorage.getItem('zp3_hat_coach_coach-u1') === '1';
        document.getElementById('_hat-coach')?.remove();
        // Second render: never again.
        _applyEmployeeNavGating();
        await new Promise(res => setTimeout(res, 50));
        const bubbleSecond = !!document.getElementById('_hat-coach');
        // Post-switch boot: toast names the surface, flag cleared, no bubble.
        localStorage.removeItem('zp3_hat_coach_coach-u1');
        sessionStorage.setItem('_hatJustSwitched', '1');
        _applyEmployeeNavGating();
        await new Promise(res => setTimeout(res, 50));
        const toastFired = toasts.some(t => t.includes('business name'));
        const sessionCleared = sessionStorage.getItem('_hatJustSwitched') === null;
        const bubbleAfterToast = !!document.getElementById('_hat-coach');
        return { bubbleFirst, flagSet, bubbleSecond, toastFired, sessionCleared, bubbleAfterToast };
      } finally {
        window.showToast = origToast;
        window._hatCrewLinks = saved.links; window._hatOwnsBusiness = saved.owns;
        _isEmployee = saved.isEmp; window._supaUser = saved.user;
        localStorage.removeItem('zp3_hat_coach_coach-u1');
        sessionStorage.removeItem('_hatJustSwitched');
        document.getElementById('_hat-coach')?.remove();
        _applyEmployeeNavGating();
      }
    });
    expect(r.bubbleFirst, 'first multi-hat render shows the coach bubble').toBe(true);
    expect(r.flagSet, 'shown once means flagged immediately').toBe(true);
    expect(r.bubbleSecond, 'never a second bubble').toBe(false);
    expect(r.toastFired, 'the boot after a switch names the surface in a toast').toBe(true);
    expect(r.sessionCleared, 'the just-switched flag is consumed, no repeat toast').toBe(true);
    expect(r.bubbleAfterToast, 'using the switcher means the bubble is never needed').toBe(false);
  });

  test('zero console errors across the dual-hat suite', async () => {
    assertNoErrors(page, 'dual-hat accounts');
  });
});
