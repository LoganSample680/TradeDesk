// @ts-check
/**
 * The home screen's on-site card: one shimmer, then one clean swap
 * (owner 2026-10-01: the ON SITE / DRIVING card "lags in and switches").
 *
 * Recorded before the fix, on a real signed-in boot (cached snapshot, then the
 * cloud load, then the deriver a moment later):
 *   owner: shimmer > "Not clocked in" > hard cut to ON SITE (85px to 128px)
 *   crew : shimmer > ON SITE > ON SITE rebuilt > ON SITE rebuilt
 * Three root causes, each covered here:
 *   1. The banner painted "Not clocked in" before the deriver had answered.
 *      It now holds its own shimmer until the day's answer lands (or a cap).
 *   2. Every renderDash rebuilt the whole card. Same kind now morphs the
 *      text in place; the node, its timer target and its animations survive.
 *   3. A kind change was a hard cut with a height jump. It now cross-fades
 *      over 180ms with the height eased from old to new.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, _supabaseShim } = require('./helpers');

// ── A real signed-in boot, offline ──────────────────────────────────────────
// The standard shim answers every query empty; this layer answers per table
// after a delay so supaInit > loadAccountData > supaLoadFromCloud > settle
// runs exactly as it does on a phone.
function bootShim() {
  return _supabaseShim() + `
(function(){
  const base = window.supabase.createClient;
  window.supabase.createClient = function(u,k){
    const c = base(u,k);
    const D = () => window.__bootData || {};
    const later = (v, ms) => new Promise(r => setTimeout(() => r({ data: v, error: null }), ms));
    c.from = function(t){
      const q = {};
      ['select','insert','upsert','update','delete','eq','neq','gt','lt','gte','lte','in','is','not','or','filter','match','ilike','like','contains','containedBy','order','limit','range'].forEach(m => q[m] = () => q);
      const tab = (D().tables || {})[t];
      q.single = q.maybeSingle = () => later(tab && !Array.isArray(tab) ? tab : (Array.isArray(tab) ? tab[0] || null : null), 250);
      q.then = (ok, bad) => later(Array.isArray(tab) ? tab : (tab ? [tab] : []), 400).then(ok, bad);
      q.catch = () => Promise.resolve([]);
      return q;
    };
    c.rpc = function(fn){
      const r = (D().rpc || {})[fn];
      if (r !== undefined) return later(r, 400);
      return Promise.resolve({ data: null, error: { code: 'offline', message: 'offline shim: rpc(' + fn + ') not mocked' } });
    };
    return c;
  };
})();`;
}

const CLIENT = { id: 901, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' };

// who: 'owner' (back at the shop after a drive, nothing persisted) or 'crew'
// (Jack, on site at a client, his dwell persisted by the last session).
async function bootSignedIn(page, who) {
  const crew = who === 'crew';
  const uid = crew ? 'jack-user' : 'e2e-user';
  const settings = { bname: 'Sample Co', teamTracking: true };
  const tables = crew ? {
    users: null,
    team_members: [{ id: 77, contractor_user_id: 'owner-boss', employee_user_id: uid, name: 'Jack', role: 'tech', permissions: {}, active: true, joined_at: '2026-01-01' }],
  } : {
    users: { id: uid, account_id: 'acct-1' },
    accounts: { id: 'acct-1', business_name: 'Sample Co' },
    zj_data: { settings, checks_state: {}, updated_at: '2026-10-01T12:00:00.000Z' },
    td_clients: [{ id: '901', data: CLIENT, updated_at: '2026-10-01T12:00:00.000Z' }],
  };
  const rpc = crew ? { load_account_data: { td_clients: [{ id: '901', data: CLIENT }] }, get_account_cursor: null } : {};
  const dwell = crew
    ? { id: 'dj1', name: 'John Doe', kind: 'job', agoMin: 47, counts: true, fence: { id: 'f901', kind: 'job', name: 'John Doe', clientId: 901, addr: CLIENT.addr } }
    : { id: 'ds1', name: 'Shop', kind: 'shop', agoMin: 3, counts: true, fence: { id: 'shop', kind: 'shop', name: 'Shop', addr: '100 Yard Rd, Topeka, KS' } };

  await mockAllExternal(page);
  await page.route(u => u.href.includes('/js/vendor/supabase'), r => r.fulfill({ status: 200, contentType: 'application/javascript', body: bootShim() }));
  await page.addInitScript(({ crew, uid, tables, rpc, settings, dwell, client }) => {
    if (crew) window.__overrideSessionUserId = uid;
    window.__bootData = { tables, rpc };
    const mk = (d) => { const o = { ...d }; o.sinceTs = Math.floor(Date.now() / 60000) * 60000 - d.agoMin * 60000; o.sinceIso = new Date(o.sinceTs).toISOString(); o.journeyId = 'j'; return o; };
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('sb-testref-auth-token', JSON.stringify({ access_token: 'at', refresh_token: 'rt', user: { id: uid } }));
      localStorage.setItem('zp3_cloud_cache', JSON.stringify({ _owner: uid, _dataOwner: crew ? 'owner-boss' : uid, clients: [client], settings }));
      localStorage.setItem('zp3_nearby_snap', JSON.stringify({ ts: Date.now(), uid, h: 150 }));
      if (crew) {
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({ d: mk(dwell), at: Date.now() - 300000, uid, day: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) }));
        localStorage.setItem('zp3_crew_choice_' + uid, 'owner-boss');
      }
    }
    // The boot rebuild's insides only: the real _geoDeriveRebuildSoon timer
    // and _geoDeriveRebuild wrapper run; the deriver's verdict lands 600ms in.
    const arm = () => {
      if (typeof window._geoDeriveRebuildRun !== 'function') return setTimeout(arm, 20);
      window._geoDeriveRebuildRun = async () => {
        await new Promise(r => setTimeout(r, 600));
        const d = mk(dwell);
        if (crew) d.sinceTs += 20000;   // the server's arrival differs a little from the cached one
        _geoOpenDwellPublish(_geoDayKeyOf(Date.now(), _geoBizTz()), { open: d, dwells: [], legs: [], journeys: [] });
        return 1;
      };
    };
    arm();
    // Every change to the card's content, and the boot shimmer lifting.
    window.__swaps = [];
    const kindOf = (el) => {
      // The live card only: mid cross-fade the old one rides along as a ghost.
      const live = [...el.children].filter(c => !c.classList.contains('td-nb-ghost'));
      const h = live.map(c => c.outerHTML).join('');
      if (h.indexOf('td-nb-skel') > -1) return 'skeleton';
      if (h.indexOf('DRIVING') > -1) return 'driving';
      if (h.indexOf('ON SITE') > -1) return 'onsite';
      if (h.indexOf('Not clocked in') > -1) return 'none';
      return 'other';
    };
    new MutationObserver(ms => {
      const nb = document.getElementById('dash-nearby');
      if (!nb) return;
      let replaced = false, ghostOnly = true, lift = false;
      for (const m of ms) {
        if (m.type === 'childList' && m.target === nb) {
          replaced = true;
          if (![...m.addedNodes, ...m.removedNodes].every(n => n.classList && n.classList.contains('td-nb-ghost'))) ghostOnly = false;
        }
        if (m.type === 'attributes' && m.target.dataset && m.target.dataset.dw === 'kpi' && !m.target.classList.contains('td-boot-skel-on') && !window.__lifted) lift = true;
      }
      if (lift) { window.__lifted = true; window.__swaps.push({ ev: 'lift', kind: kindOf(nb) }); }
      if (replaced && !ghostOnly) window.__swaps.push({ ev: 'swap', kind: kindOf(nb), visible: !!window.__lifted });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }, { crew, uid, tables, rpc, settings, dwell, client: CLIENT });
  await page.goto('/');
  await page.waitForFunction(() => window._bootSkelDone === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window._geoDayAnswered === true, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => ({ swaps: window.__swaps, text: document.getElementById('dash-nearby').innerText, kids: document.getElementById('dash-nearby').children.length }));
}

test.describe('On-site card boots with one shimmer and one swap', () => {
  test('owner back at the shop: shimmer holds until the deriver answers, then one cross-fade to ON SITE', async ({ page }) => {
    test.setTimeout(60000);
    const r = await bootSignedIn(page, 'owner');
    const visible = r.swaps.filter(s => s.ev === 'swap' && s.visible).map(s => s.kind);
    const lift = r.swaps.find(s => s.ev === 'lift');
    expect(lift && lift.kind, 'the page shimmer lifts onto the card shimmer, never onto a guess').toBe('skeleton');
    expect(visible, 'exactly one visible swap, straight to the right card').toEqual(['onsite']);
    expect(r.swaps.some(s => s.kind === 'none'), '"Not clocked in" never painted, not even under the shimmer').toBe(false);
    expect(r.text).toContain('Shop');
    expect(r.kids, 'the cross-fade cleaned up after itself').toBe(1);
    assertNoErrors(page, 'owner boot');
  });

  test('crew on site at a client: the restored card is revealed once and only its text moves after', async ({ page }) => {
    test.setTimeout(60000);
    const r = await bootSignedIn(page, 'crew');
    const visible = r.swaps.filter(s => s.ev === 'swap' && s.visible);
    const lift = r.swaps.find(s => s.ev === 'lift');
    expect(lift && lift.kind, 'revealed already showing ON SITE').toBe('onsite');
    expect(visible, 'the deriver and later renders never rebuild the card').toEqual([]);
    expect(r.text).toContain('John Doe');
    assertNoErrors(page, 'crew boot');
  });
});

test.describe('On-site card: updates in place, cross-fades on a change of kind', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mockAllExternal(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.evaluate(() => {
      document.getElementById('dash-setup-todo')?.remove();
      document.getElementById('dash-geo-perm')?.remove();
      window._bootSyncPending = false; window._bootSkelDone = true;
      document.getElementById('pg-dash')?.classList.remove('boot-cascade');
      // The boot's own deriver rebuild (scheduled 2.5s after tracking starts)
      // is a real "answer on its way" (_nearbyGeoPending). These tests decide
      // for themselves whether one is coming, so the boot's is let finish and
      // not rescheduled. On a loaded WebKit runner it was still in flight when
      // they ran, and the card rightly waited for it (CI 2026-10-02).
      window._geoDeriveRebuilt = true;
    });
    await page.waitForFunction(() => !(typeof _geoDeriveRebuildT !== 'undefined' && _geoDeriveRebuildT) && !(typeof _geoDeriveRebuildP !== 'undefined' && _geoDeriveRebuildP), null, { timeout: 15000 });
  });
  test.afterAll(async () => { await page.close(); });

  const dwell = (agoMin, extra) => `(() => { const t = Date.now() - ${agoMin} * 60000; return Object.assign({ id: 'd1', name: 'John Doe', kind: 'job', sinceTs: t, sinceIso: new Date(t).toISOString(), counts: true, fence: { kind: 'job', clientId: 901, addr: '2950 SW McClure Rd' } }, ${JSON.stringify(extra || {})}); })()`;

  test('the 1s tick and a same-kind re-render keep the same card node and only move the text', async () => {
    const r = await page.evaluate(async (mk) => {
      window._geoOpenDwell = eval(mk);
      renderDash();
      const el = document.getElementById('dash-nearby');
      const card = el.firstElementChild;
      const span = el.querySelector('[data-onsite-since]');
      const ping = el.querySelector('[style*="tdGeoPing"]');
      if (typeof _geoOnsiteTickStart === 'function') _geoOnsiteTickStart();
      // Same dwell, arrival re-stamped by a later derive: same kind.
      window._geoOpenDwell = Object.assign({}, window._geoOpenDwell, { sinceTs: window._geoOpenDwell.sinceTs - 3600000 });
      window._geoOpenDwell.sinceIso = new Date(window._geoOpenDwell.sinceTs).toISOString();
      renderDash();
      await new Promise(res => setTimeout(res, 1100));
      renderDash();
      return {
        sameCard: el.firstElementChild === card,
        sameSpan: el.querySelector('[data-onsite-since]') === span,
        samePing: el.querySelector('[style*="tdGeoPing"]') === ping,
        text: span.textContent, kids: el.children.length,
      };
    }, dwell(12));
    expect(r.sameCard, 'card node survives').toBe(true);
    expect(r.sameSpan, 'the ticking figure is the same node').toBe(true);
    expect(r.samePing, 'the ping rings never restart').toBe(true);
    expect(r.text, 'and its text did move').toMatch(/^1h 1[12]m$/);
    expect(r.kids).toBe(1);
  });

  test('updateClockTimer ticks #dash-onsite-time without replacing the clock card', async () => {
    const r = await page.evaluate(async () => {
      const saved = _activeTimer;
      try {
        window._geoOpenDwell = null;
        _activeTimer = { startTime: Date.now() - 125 * 60000, clientName: 'Tick Test', jobId: null };
        renderDash();
        const el = document.getElementById('dash-nearby');
        const card = el.firstElementChild, t = document.getElementById('dash-onsite-time');
        updateClockTimer();
        renderDash();
        updateClockTimer();
        return { same: el.firstElementChild === card, sameT: document.getElementById('dash-onsite-time') === t, text: t.textContent };
      } finally { _activeTimer = saved; renderDash(); }
    });
    expect(r.same).toBe(true);
    expect(r.sameT).toBe(true);
    expect(r.text).toBe('2h 5m');
  });

  test('driving to on site cross-fades with the height eased, never blank, never a jump', async () => {
    const r = await page.evaluate(async (mk) => {
      const el = document.getElementById('dash-nearby');
      const realDriving = window._geoDriving;
      try {
        window._geoOpenDwell = null;
        window._geoDriving = () => true;
        renderDash();
        await new Promise(res => setTimeout(res, 50));
        const oldH = el.offsetHeight;
        const oldIds = el.querySelectorAll('[id]').length;
        const below = el.nextElementSibling;
        window._geoDriving = realDriving;
        window._geoOpenDwell = eval(mk);
        renderDash();
        const first = { h: el.offsetHeight, kids: el.children.length, ghost: !!el.querySelector(':scope>.td-nb-ghost'), ghostIds: el.querySelectorAll(':scope>.td-nb-ghost [id]').length, oldHadIds: oldIds };
        const hs = [];
        const t0 = performance.now();
        while (performance.now() - t0 < 320) { hs.push(el.offsetHeight); await new Promise(res => requestAnimationFrame(res)); }
        return { oldH, first, hs, endH: el.offsetHeight, kids: el.children.length, kind: el.dataset.kind, xf: el.classList.contains('td-nb-xf'), styleH: el.style.height, text: el.innerText };
      } finally { window._geoDriving = realDriving; window._geoOpenDwell = null; renderDash(); }
    }, dwell(4));
    expect(r.oldH).toBeGreaterThan(60);
    expect(r.first.h, 'the first frame keeps the old height').toBe(r.oldH);
    expect(r.first.ghost, 'the old card is still there, fading').toBe(true);
    expect(r.first.oldHadIds, 'the DRIVING card carries ids (the case under test)').toBeGreaterThan(0);
    expect(r.first.ghostIds, 'the fading ghost carries no ids, so a lookup by id only finds the live card').toBe(0);
    const lo = Math.min(r.oldH, r.endH), hi = Math.max(r.oldH, r.endH);
    for (const h of r.hs) { expect(h).toBeGreaterThanOrEqual(lo - 1); expect(h).toBeLessThanOrEqual(hi + 1); }
    expect(r.kids, 'ghost removed after the fade').toBe(1);
    expect(r.xf).toBe(false);
    expect(r.styleH, 'no height left pinned').toBe('');
    expect(r.kind).toBe('dwell');
    expect(r.text).toContain('ON SITE');
  });

  test('with tracking on, the card shimmers until the day is answered, then paints once', async () => {
    const r = await page.evaluate(async () => {
      const el = document.getElementById('dash-nearby');
      const keep = { tt: S.teamTracking, ans: window._geoDayAnswered, t0: window._nbWaitT0, boot: window._nbBootWait, live: window._nearbyLiveRendered };
      try {
        S.teamTracking = true; window._geoDayAnswered = false; window._nbWaitT0 = null;
        window._geoOpenDwell = null;
        el.dataset.kind = ''; el.innerHTML = '';
        // Nothing on its way (a plain browser session): paints at once.
        window._nbBootWait = false; window._nearbyLiveRendered = false;
        renderDash();
        const nothingComing = el.dataset.kind;
        // A signed-in boot with the deriver still to answer.
        window._nbBootWait = true; window._nearbyLiveRendered = false;
        el.dataset.kind = ''; el.innerHTML = '';
        renderDash();
        const waiting = { kind: el.dataset.kind, skel: !!el.querySelector('.td-nb-skel .td-skel'), h: el.offsetHeight, snapH: _dashNearbySkelH() };
        renderDash();   // a second render while waiting changes nothing
        const stillSkel = el.dataset.kind === 'skel';
        const first = _geoDayAnsweredMark(), second = _geoDayAnsweredMark();
        renderDash();
        await new Promise(res => setTimeout(res, 260));
        const after = { kind: el.dataset.kind, text: el.innerText };
        // The cap: a deriver that never answers costs a few seconds, never the card.
        window._geoDayAnswered = false; window._nbWaitT0 = Date.now() - 7000;
        renderDash();
        await new Promise(res => setTimeout(res, 260));
        const capped = el.dataset.kind;
        // A real card has painted: never back to the shimmer, answer or not.
        window._geoDayAnswered = false; window._nbWaitT0 = null;
        renderDash();
        const neverBack = el.dataset.kind;
        return { nothingComing, waiting, stillSkel, first, second, after, capped, neverBack };
      } finally {
        S.teamTracking = keep.tt; window._geoDayAnswered = keep.ans; window._nbWaitT0 = keep.t0; window._nbBootWait = keep.boot; window._nearbyLiveRendered = keep.live;
        renderDash();
      }
    });
    expect(r.nothingComing, 'no answer coming: no wait').toBe('manual');
    expect(r.waiting.kind).toBe('skel');
    expect(r.waiting.skel, 'the shared .td-skel shimmer').toBe(true);
    expect(r.waiting.h, 'holding the last card height').toBe(r.waiting.snapH);
    expect(r.stillSkel).toBe(true);
    expect(r.first).toBe(true);
    expect(r.second, 'answered once per boot').toBe(false);
    expect(r.after.kind).toBe('manual');
    expect(r.after.text).toContain('Not clocked in');
    expect(r.capped).toBe('manual');
    expect(r.neverBack).toBe('manual');
  });

  test('_nearbyPaint and _nearbyMorph: null, repeat and shape-change inputs', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      out.nullEl = _nearbyPaint(null, '<div></div>', 'x', true);
      const el = document.createElement('div');
      document.body.appendChild(el);
      try {
        out.set = _nearbyPaint(el, '<div><b>1</b></div>', 'a', true);
        out.same = _nearbyPaint(el, '<div><b>1</b></div>', 'a', false);
        const b = el.querySelector('b');
        out.morph = _nearbyPaint(el, '<div><b>2</b></div>', 'a', false);
        out.keptB = el.querySelector('b') === b && b.textContent === '2';
        out.reshape = _nearbyPaint(el, '<div><b>2</b><i>x</i></div>', 'a', false);
        out.reshaped = el.querySelectorAll('i').length === 1 && el.children.length === 1;
        out.empty = _nearbyPaint(el, '', 'b', true);
        out.emptyKids = el.childNodes.length;
        // Something else emptied the host after a paint: the same markup is NOT
        // 'same', it is painted again (CI 2026-10-02, WebKit: an emptied card
        // stayed empty and its stored height came back 0).
        _nearbyPaint(el, '<div><b>9</b></div>', 'e', true);
        el.innerHTML = '';
        out.emptied = _nearbyPaint(el, '<div><b>9</b></div>', 'e', false);
        out.emptiedKids = el.querySelectorAll('b').length;
        for (let i = 0; i < 10; i++) _nearbyPaint(el, '<p>' + i + '</p>', i % 2 ? 'c' : 'd', false);
        _nearbyXfadeEnd(el);
        out.burst = el.children.length;
        _nearbyXfadeEnd(null);
      } finally { el.remove(); }
      return out;
    });
    expect(r.nullEl).toBe('same');
    expect(r.set).toBe('set');
    expect(r.same).toBe('same');
    expect(r.morph).toBe('morph');
    expect(r.keptB).toBe(true);
    expect(r.reshape).toBe('morph');
    expect(r.reshaped).toBe(true);
    expect(r.empty).toBe('set');
    expect(r.emptyKids).toBe(0);
    expect(r.emptied).not.toBe('same');
    expect(r.emptiedKids).toBe(1);
    expect(r.burst, 'rapid kind changes never stack ghosts').toBe(1);
  });

  // The frozen HTML snapshot is gone (it painted a card kind that was no
  // longer true). Only its height is kept, for the shimmer.
  test('a stored HTML snapshot never paints, and the stored copy carries only the height', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-nearby');
      const uid = (typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id) || null;
      localStorage.setItem('zp3_nearby_snap', JSON.stringify({ html: '<div id="snap-probe">ON SITE</div>', ts: Date.now(), uid, h: 140 }));
      window._nearbyLiveRendered = false;
      el.dataset.kind = ''; el.innerHTML = '';
      renderDash();
      const stored = JSON.parse(localStorage.getItem('zp3_nearby_snap') || 'null');
      return { probe: !!document.getElementById('snap-probe'), html: stored && ('html' in stored), h: stored && stored.h };
    });
    expect(r.probe).toBe(false);
    expect(r.html).toBe(false);
    expect(r.h).toBeGreaterThan(0);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'on-site card smooth');
  });
});
