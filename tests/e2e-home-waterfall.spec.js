// @ts-check
/**
 * The home screen loads as one top-down waterfall (owner 2026-10-01: "it's not
 * a smooth waterfall down load from top to bottom with the on site card coming
 * in so late, also the skeleton shimmers don't match up the tiles, it should
 * be like shuffling from the top down like iOS does").
 *
 *   A. The boot placeholder IS the home screen: a redacted copy of each
 *      widget's own markup (_dashSkelClone + _tdRedact), so every block sits
 *      exactly where its content will land.
 *   B. ONE cascade per boot (_armBootCascade): blocks fade and rise in reading
 *      order, each placeholder piece fading out on its content's beat.
 *   C. The ON SITE card paints from the deriver's last answer kept on the
 *      phone (_geoRestoreEarly), so it lands in its place in the waterfall.
 *
 * Functions under test:
 *   js/dashboard.js  _dashApplySkeletons _dashSkelClone _dashWfBlocks _dashWfStamp
 *                    _dashRevealSkeletons _dashClearSkeletons _nearbyGeoPending
 *   js/cloud.js      _armBootCascade _bootSyncSettled
 *   js/utils.js      _tdRedact
 *   js/geo-track.js  _geoRestoreEarly _geoRestoreDayAnswer _geoPersistDayAnswer
 *   js/quick-invoice.js _renderToBill (no loading bar for a row that was not there)
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('home waterfall', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.waitForFunction(() => !document.getElementById('pg-dash').classList.contains('boot-cascade'), null, { timeout: 8000 });
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      document.getElementById('supa-boot-overlay')?.remove();
      window._bootSyncPending = false; window._bootSkelDone = true;
    });
  });
  test.afterAll(async () => { await page.close(); });

  // Rects of every real block and every placeholder piece, as the page holds them.
  const rects = () => page.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const w = _dashWfBlocks();
    const byY = (a, b) => a.y - b.y || a.x - b.x;
    return { real: w.real.map(b => R(b.el)).sort(byY), skel: w.skel.map(b => R(b.el)).sort(byY), beats: w.beats };
  });
  // The location banner answers after an awaited permission query, i.e. after
  // the render that called it (late on WebKit). Measuring before it lands
  // compares a page with the banner to one without, so every measurement
  // waits for it first; the app's side of that (the late banner gets its own
  // placeholder) is its own test below.
  // The permission read (_geoRefreshPermCache) is a second late painter: when
  // it resolves it re-renders the setup checklist and the banner. Under CI load
  // it can land after the banner call above, so wait for it too, then until
  // the block count holds still.
  const settled = () => page.evaluate(async () => {
    if (typeof _geoReadPermission === 'function') { try { await _geoReadPermission(); } catch (e) {} }
    if (typeof _geoPermissionBanner === 'function') await _geoPermissionBanner();
    let last = -1, same = 0;
    for (let i = 0; i < 40 && same < 3; i++) {
      await new Promise(r => setTimeout(r, 50));
      const n = _dashWfBlocks().real.length;
      same = n === last ? same + 1 : 0; last = n;
    }
  });
  const enterSkel = async () => {
    await page.evaluate(() => {
      window._bootSyncPending = true; window._bootSkelDone = false; window._bootCascadeRan = false;
      _dashApplySkeletons();
    });
    await settled();
  };
  const leaveSkel = () => page.evaluate(() => {
    window._bootSyncPending = false; window._bootSkelDone = true;
    try { clearTimeout(window._bootSkelTimer); } catch (e) {}
    window._bootSkelTimer = null;
    _dashClearSkeletons(); _dashWfClear();
    document.getElementById('pg-dash').classList.remove('boot-cascade');
  });

  test('A. every placeholder piece sits on its real block within 1px', async () => {
    await page.evaluate(() => { goPg('pg-dash'); renderDash(); });
    await settled();
    const before = await rects();
    await enterSkel();
    const r = await rects();
    const shape = await page.evaluate(() => ({
      greeting: !!document.querySelector('#pg-dash>.tbar>.td-boot-skel .tbar-l .td-skel'),
      segment: document.querySelectorAll('#pg-dash>.tbar>.td-boot-skel .seg-btn').length,
      tiles: document.querySelectorAll('[data-dw="kpi"]>.td-boot-skel .met').length,
      card: !!document.querySelector('[data-dw="kpi"]>.td-boot-skel #dash-nearby'),
      realHidden: getComputedStyle(document.getElementById('dash-kpi')).visibility,
      // the words are gone, only bars remain
      wordsShowing: [...document.querySelectorAll('#pg-dash .td-boot-skel .td-rx')].some(s => getComputedStyle(s).color !== 'rgba(0, 0, 0, 0)'),
      live: document.querySelectorAll('#pg-dash .td-boot-skel [data-onsite-since],#pg-dash .td-boot-skel [onclick]').length,
    }));
    await leaveSkel();
    expect(shape.greeting, 'the greeting block is in the placeholder').toBe(true);
    expect(shape.segment, 'so is the Month/Quarter/Year/All row').toBe(4);
    expect(shape.tiles, 'six tiles, the real six').toBe(6);
    expect(shape.card, 'the ON SITE slot is in it').toBe(true);
    expect(shape.realHidden, 'real content stays laid out, just unseen').toBe('hidden');
    expect(shape.wordsShowing).toBe(false);
    expect(shape.live, 'no ticking figures or taps in a placeholder').toBe(0);
    expect(r.skel.length).toBe(r.real.length);
    expect(r.real.length).toBeGreaterThan(8);
    r.real.forEach((b, i) => {
      const s = r.skel[i];
      for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(s[k] - b[k]), `block ${i} ${k}`).toBeLessThanOrEqual(1);
    });
    // and the placeholder going up moved nothing either
    expect(r.real.length).toBe(before.real.length);
    r.real.forEach((b, i) => expect(Math.abs(b.y - before.real[i].y), `block ${i} moved`).toBeLessThanOrEqual(1));
  });

  test('A. the data landing moves no block', async () => {
    await page.evaluate(() => renderDash());
    await enterSkel();
    const skel = await rects();
    await page.evaluate(() => { window._bootSkelDone = true; window._bootSyncPending = false; renderDash(); _dashRevealSkeletons(); });
    await page.waitForFunction(() => !document.querySelector('#pg-dash .td-boot-skel') && !document.getElementById('pg-dash').classList.contains('boot-cascade'), null, { timeout: 3000 });
    await settled();
    const after = await rects();
    expect(after.real.length).toBe(skel.skel.length);
    after.real.forEach((b, i) => {
      expect(Math.abs(b.y - skel.skel[i].y), `block ${i} y`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - skel.skel[i].h), `block ${i} h`).toBeLessThanOrEqual(1);
    });
  });

  // CI 2026-10-02, WebKit only: 17 real blocks against 16 placeholder pieces.
  // The 17th was the location banner (#dash-geo-perm): it shows after an
  // awaited permission query, so it landed after the placeholder was copied
  // and appeared bare, shoving the page down under the shimmer.
  test('A. a block that answers late still gets its placeholder, and joins the pour on its beat', async () => {
    const r = await page.evaluate(async () => {
      const el = document.getElementById('dash-geo-perm');
      const saved = { q: navigator.permissions && navigator.permissions.query, todo: window._setupTodoShowsLocation, html: el.innerHTML, disp: el.style.display };
      const slow = (state) => { navigator.permissions.query = () => new Promise(res => setTimeout(() => res({ state }), 60)); };
      try {
        window._setupTodoShowsLocation = () => false;
        el.style.display = 'none'; el.innerHTML = '';
        window._bootSyncPending = true; window._bootSkelDone = false; window._bootCascadeRan = false;
        _dashApplySkeletons();
        const before = !!el.querySelector(':scope>.td-boot-skel');
        slow('prompt');
        await _geoPermissionBanner();
        const shown = el.style.display === 'block';
        const covered = el.classList.contains('td-boot-skel-on') && !!el.querySelector(':scope>.td-boot-skel .td-skel');
        // and when it goes away again, so does its placeholder
        slow('granted');
        await _geoPermissionBanner();
        const gone = !el.querySelector(':scope>.td-boot-skel');
        return { before, shown, covered, gone };
      } finally {
        navigator.permissions.query = saved.q; window._setupTodoShowsLocation = saved.todo;
        el.innerHTML = saved.html; el.style.display = saved.disp;
        window._bootSyncPending = false; window._bootSkelDone = true;
        try { clearTimeout(window._bootSkelTimer); } catch (e) {}
        window._bootSkelTimer = null;
        _dashClearSkeletons();
      }
    });
    expect(r).toEqual({ before: false, shown: true, covered: true, gone: true });
  });

  test('A. _tdRedact: bars where words were, blobs for badges, nothing live; junk input is a no-op', async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<div style="background:linear-gradient(#22c55e,#0E6B39);padding:10px"><span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#16a34a"><svg width="10" height="10"></svg></span>' +
        '<span style="background:#0E6B39;color:#fff;padding:4px 9px;font-size:10px">ON SITE</span><div>John Doe</div>' +
        '<span style="animation:tdNearbyDot 1s infinite;width:6px;height:6px;display:inline-block"></span></div>';
      document.body.appendChild(host);
      const src = host.firstElementChild, dst = src.cloneNode(true);
      host.appendChild(dst);
      _tdRedact(src, dst);
      const out = {
        root: dst.style.background.indexOf('var(--bg-card') > -1,
        blob: dst.children[0].classList.contains('td-skel'),
        svgHidden: dst.querySelector('svg').style.visibility,
        pill: dst.children[1].classList.contains('td-rx-pill') && dst.children[1].classList.contains('td-skel'),
        bar: !!dst.children[2].querySelector('.td-skel.td-rx'),
        dot: dst.children[3].style.visibility,
        srcUntouched: !src.querySelector('.td-skel') && src.innerHTML.indexOf('td-rx') < 0,
      };
      out.junk = [_tdRedact(null, null), _tdRedact(src, document.createElement('p'))].map(x => x === null ? 'null' : x.tagName);
      host.remove();
      return out;
    });
    expect(r).toEqual({ root: true, blob: true, svgHidden: 'hidden', pill: true, bar: true, dot: 'hidden', srcUntouched: true, junk: ['null', 'P'] });
  });

  test('B. one cascade, in reading order, each placeholder piece on its content\'s beat', async () => {
    await page.evaluate(() => renderDash());
    await enterSkel();
    const r = await page.evaluate(async () => {
      window._bootSkelDone = true; window._bootSyncPending = false;
      renderDash();
      _dashRevealSkeletons();
      const d = document.getElementById('pg-dash');
      const w = _dashWfBlocks();
      const beats = w.real.map(b => ({ y: b.y, d: parseFloat(b.el.style.getPropertyValue('--wf-d')) }));
      const skelBeats = w.skel.map(b => ({ i: b.i, d: parseFloat(b.el.style.getPropertyValue('--wf-d')) }));
      const anim = getComputedStyle(w.real[0].el).animationName;
      const skAnim = w.skel[0] ? getComputedStyle(w.skel[0].el).animationName : '';
      // When does each real block first show? Sampled every frame.
      const seen = new Map();
      const t0 = performance.now();
      await new Promise(res => {
        const f = () => {
          w.real.forEach((b, i) => { if (!seen.has(i) && parseFloat(getComputedStyle(b.el).opacity) > 0.05) seen.set(i, performance.now() - t0); });
          if (performance.now() - t0 < 900) requestAnimationFrame(f); else res();
        };
        requestAnimationFrame(f);
      });
      // A second arm and a render mid-pour change nothing.
      const ranOnce = window._bootCascadeRan;
      _armBootCascade();
      return { cascade: d.classList.contains('boot-cascade'), ranOnce, beats, skelBeats, anim, skAnim,
        firstSeen: w.real.map((b, i) => ({ y: b.y, t: seen.get(i) })) };
    });
    expect(r.ranOnce).toBe(true);
    expect(r.anim).toBe('td-wf-in');
    expect(r.skAnim).toBe('td-wf-out');
    // Delays never go backwards down the page, and each step is 45ms.
    for (let i = 1; i < r.beats.length; i++) {
      expect(r.beats[i].d, `block ${i}`).toBeGreaterThanOrEqual(r.beats[i - 1].d);
      if (r.beats[i].y > r.beats[i - 1].y + 6 && r.beats[i].y < 844) expect(r.beats[i].d - r.beats[i - 1].d).toBe(45);
    }
    expect(r.beats[0].d).toBe(0);
    // every placeholder piece shares a beat with a real block
    const real = new Set(r.beats.map(b => b.d));
    r.skelBeats.forEach(s => expect(real.has(s.d)).toBe(true));
    // and they really did appear top to bottom
    const shown = r.firstSeen.filter(b => b.t != null);
    expect(shown.length).toBeGreaterThan(5);
    for (let i = 1; i < shown.length; i++) if (shown[i].y > shown[i - 1].y + 6) expect(shown[i].t + 20).toBeGreaterThanOrEqual(shown[i - 1].t);
    await page.waitForFunction(() => !document.getElementById('pg-dash').classList.contains('boot-cascade'), null, { timeout: 3000 });
    const after = await page.evaluate(() => {
      renderDash();
      return { replayed: document.getElementById('pg-dash').classList.contains('boot-cascade'), stamps: document.querySelectorAll('#pg-dash [data-wf]').length, skels: document.querySelectorAll('#pg-dash .td-boot-skel,#pg-dash .td-skel-host').length };
    });
    expect(after).toEqual({ replayed: false, stamps: 0, skels: 0 });
  });

  test('B. the overlay lifting onto the placeholder does not pour; the data landing does', async () => {
    const r = await page.evaluate(async () => {
      window._sboT0 = 0; window._bootShimmerT0 = null; window._bootSettleWaitT0 = null;
      window._bootSyncPending = true; window._bootSkelDone = false; window._bootCascadeRan = false;
      document.getElementById('supa-boot-overlay')?.remove();
      const o = document.createElement('div'); o.id = 'supa-boot-overlay'; document.body.appendChild(o);
      _removeBootOverlay();
      const atLift = { cascade: document.getElementById('pg-dash').classList.contains('boot-cascade'), skel: !!document.querySelector('#pg-dash .td-boot-skel'), ran: window._bootCascadeRan };
      document.getElementById('supa-boot-overlay')?.remove();
      _bootSyncSettled();
      let waited = 0;
      while (!window._bootCascadeRan && waited < 3000) { await new Promise(res => setTimeout(res, 50)); waited += 50; }
      return { atLift, poured: window._bootCascadeRan };
    });
    expect(r.atLift).toEqual({ cascade: false, skel: true, ran: false });
    expect(r.poured).toBe(true);
    await page.waitForFunction(() => !document.getElementById('pg-dash').classList.contains('boot-cascade'), null, { timeout: 3000 });
  });

  test('B. a render mid-pour stamps only what the pour has not reached, never replays', async () => {
    const r = await page.evaluate(() => {
      window._bootCascadeRan = false;
      window._bootSyncPending = false; window._bootSkelDone = true;
      renderDash();
      _armBootCascade();
      window._bootWfT0 = performance.now() - 10000;  // pretend the pour is long past every beat
      document.getElementById('dash-kpi').innerHTML = document.getElementById('dash-kpi').innerHTML;  // fresh tiles
      renderDash();
      return [...document.querySelectorAll('#dash-kpi .met')].filter(m => m.hasAttribute('data-wf')).length;
    });
    expect(r, 'fresh tiles whose beat already passed just show').toBe(0);
    await page.waitForFunction(() => !document.getElementById('pg-dash').classList.contains('boot-cascade'), null, { timeout: 3000 });
  });

  test('C. the ON SITE card paints from the dwell kept on the phone, before any derive', async () => {
    const r = await page.evaluate(() => {
      const saved = { user: window._supaUser, track: S.teamTracking };
      try {
        window._supaUser = { id: 'wf-user' };
        S.teamTracking = true;
        const day = todayKey(), now = Date.now();
        const reset = () => { window._geoOpenDwell = null; window._geoEarlyFor = null; window._geoDayKnown = false; window._geoDayAnswered = false; window._nearbyLiveRendered = false; window._nbWaitT0 = null; window._nbBootWait = false; };
        const kind = () => document.getElementById('dash-nearby').dataset.kind;
        window._bootSyncPending = true; window._bootSkelDone = false;   // a boot: the card would otherwise wait
        // 1. A dwell the deriver published five minutes ago.
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({ d: { id: 'd1', name: 'John Doe', kind: 'job', sinceTs: now - 47 * 60000, sinceIso: new Date(now - 47 * 60000).toISOString(), counts: true, fence: { kind: 'job', clientId: 901, addr: '2950 SW McClure Rd' } }, at: now - 300000, uid: 'wf-user', day }));
        localStorage.setItem('zp3_geo_dayans', JSON.stringify({ at: now - 300000, uid: 'wf-user', day }));
        reset(); renderDash();
        const withDwell = { kind: kind(), text: document.getElementById('dash-nearby').textContent.indexOf('John Doe') > -1 };
        // 2. The deriver said nobody was on site: the plain card, no wait.
        localStorage.removeItem('zp3_geo_dwell');
        reset(); renderDash();
        const nobody = kind();
        // 3. Nothing on the phone: the card holds its slot as a placeholder.
        localStorage.removeItem('zp3_geo_dayans');
        reset(); renderDash();
        const unknown = kind();
        // 4. Someone else's answer, or a stale one, is not ours.
        localStorage.setItem('zp3_geo_dayans', JSON.stringify({ at: now - 300000, uid: 'other', day }));
        reset(); renderDash();
        const other = kind();
        localStorage.setItem('zp3_geo_dayans', JSON.stringify({ at: now - 3600000, uid: 'wf-user', day }));
        reset(); renderDash();
        const stale = kind();
        localStorage.setItem('zp3_geo_dayans', '{junk');
        reset();
        let threw = false; try { renderDash(); } catch (e) { threw = true; }
        return { withDwell, nobody, unknown, other, stale, threw };
      } finally {
        localStorage.removeItem('zp3_geo_dwell'); localStorage.removeItem('zp3_geo_dayans');
        window._supaUser = saved.user; S.teamTracking = saved.track;
        window._geoOpenDwell = null; window._geoDayKnown = false; window._geoEarlyFor = null;
        window._bootSyncPending = false; window._bootSkelDone = true;
        try { clearTimeout(window._bootSkelTimer); } catch (e) {}
        window._bootSkelTimer = null;
        _dashClearSkeletons();
      }
    });
    expect(r.withDwell).toEqual({ kind: 'dwell', text: true });
    expect(r.nobody).toBe('manual');
    expect(r.unknown).toBe('skel');
    expect(r.other).toBe('skel');
    expect(r.stale).toBe('skel');
    expect(r.threw).toBe(false);
  });

  test('C. publishing today\'s answer keeps it for the next boot, even when nobody is on site', async () => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('zp3_geo_dayans');
      _geoOpenDwellPublish(todayKey(), { open: null, dwells: [], legs: [], journeys: [] });
      const s = JSON.parse(localStorage.getItem('zp3_geo_dayans') || 'null');
      window._geoDayKnown = false;
      const back = _geoRestoreDayAnswer();
      const out = { kept: !!(s && s.day === todayKey()), back, known: window._geoDayKnown };
      localStorage.removeItem('zp3_geo_dayans'); window._geoDayKnown = false;
      return out;
    });
    expect(r).toEqual({ kept: true, back: true, known: true });
  });

  test('C. the ON SITE placeholder is the ON SITE card, redacted, at the remembered height', async () => {
    const r = await page.evaluate(() => {
      const saved = { user: window._supaUser, track: S.teamTracking, snap: localStorage.getItem('zp3_nearby_snap') };
      try {
        window._supaUser = { id: 'wf-user2' }; S.teamTracking = true;
        localStorage.removeItem('zp3_geo_dwell'); localStorage.removeItem('zp3_geo_dayans');
        const out = {};
        for (const h of [128, 178]) {
          localStorage.setItem('zp3_nearby_snap', JSON.stringify({ ts: Date.now(), uid: 'wf-user2', h }));
          window._geoOpenDwell = null; window._geoEarlyFor = null; window._geoDayKnown = false; window._geoDayAnswered = false; window._nearbyLiveRendered = false; window._nbWaitT0 = null;
          window._bootSyncPending = true; window._bootSkelDone = false;
          renderDash();
          const el = document.getElementById('dash-nearby');
          const sk = el.querySelector('.td-nb-skel');
          out[h] = { kind: el.dataset.kind, h: el.offsetHeight, badge: !!sk.querySelector('span.td-skel[style*="border-radius: 50%"],span.td-skel[style*="border-radius:50%"]'),
            pill: !!sk.querySelector('.td-rx-pill'), bars: sk.querySelectorAll('.td-skel.td-rx').length, button: !!sk.querySelector('button') };
        }
        return out;
      } finally {
        window._supaUser = saved.user; S.teamTracking = saved.track;
        if (saved.snap == null) localStorage.removeItem('zp3_nearby_snap'); else localStorage.setItem('zp3_nearby_snap', saved.snap);
        window._bootSyncPending = false; window._bootSkelDone = true;
        try { clearTimeout(window._bootSkelTimer); } catch (e) {}
        window._bootSkelTimer = null;
        _dashClearSkeletons();
      }
    });
    for (const h of ['128', '178']) {
      expect(r[h].kind).toBe('skel');
      expect(r[h].h, 'holds the space the card took last time').toBe(Number(h));
      expect(r[h].badge, 'round pin badge').toBe(true);
      expect(r[h].pill, 'the pill').toBe(true);
      expect(r[h].bars, 'title and two meta lines as bars').toBeGreaterThanOrEqual(3);
    }
    expect(r['128'].button).toBe(false);
    expect(r['178'].button, 'a tall last card had a button row').toBe(true);
  });

  test('no node is replaced on timer ticks', async () => {
    const r = await page.evaluate(async () => {
      window._bootSyncPending = false; window._bootSkelDone = true;
      const t = Date.now() - 12 * 60000;
      window._geoOpenDwell = { id: 'd2', name: 'John Doe', kind: 'job', sinceTs: t, sinceIso: new Date(t).toISOString(), counts: true, fence: { kind: 'job', clientId: 901, addr: '2950 SW McClure Rd' } };
      renderDash();
      const el = document.getElementById('dash-nearby');
      // The card arrives by a kind change (the previous test left the
      // placeholder up), so it cross-fades: the old card rides along as a
      // ghost for 180ms and _nearbyXfadeEnd removes it. That removal is the
      // fade finishing, not a tick, so wait it out before watching. (CI caught
      // it on WebKit, where the loop below outlasts the 200ms fade timer.)
      await new Promise(res => { const w = () => (!el._nbXfT && !el.querySelector('.td-nb-ghost')) ? res() : setTimeout(w, 20); w(); });
      // A tick sets a figure's text, which swaps that one TEXT node; no
      // ELEMENT may ever be added or removed by a tick or a same-kind render.
      const muts = [];
      const mo = new MutationObserver(ms => ms.forEach(m => [...m.addedNodes, ...m.removedNodes].forEach(n => { if (n.nodeType === 1) muts.push(n.nodeName + '.' + n.className); })));
      mo.observe(el, { subtree: true, childList: true });
      const nodes = [...el.querySelectorAll('*')];
      for (let i = 0; i < 4; i++) { if (typeof _geoOnsiteTick === 'function') _geoOnsiteTick(); renderDash(); await new Promise(res => setTimeout(res, 30)); }
      mo.disconnect();
      const same = nodes.every(n => el.contains(n)) && el.querySelectorAll('*').length === nodes.length;
      window._geoOpenDwell = null;
      return { muts: muts.length, list: muts, kind: el.dataset.kind, same };
    });
    expect(r.kind).toBe('dwell');
    expect(r.list, 'ticks and same-kind renders only change text').toEqual([]);
    expect(r.same, 'every node of the card is the node it was').toBe(true);
  });

  test('Ready to bill draws no loading bar when it was empty last time', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-to-bill');
      const saved = { tb: _tb, can: window._tbCan, on: window._tbOnline, load: window._tbLoad };
      try {
        window._tbCan = () => true; window._tbOnline = () => true; window._tbLoad = () => {};
        _tb = null;
        localStorage.setItem('zp3_tb_shown', '0');
        _renderToBill();
        const empty = el.style.display;
        localStorage.setItem('zp3_tb_shown', '1');
        _renderToBill();
        const had = { display: el.style.display, bar: !!el.querySelector('.td-skel') };
        return { empty, had };
      } finally {
        _tb = saved.tb; window._tbCan = saved.can; window._tbOnline = saved.on; window._tbLoad = saved.load;
        localStorage.removeItem('zp3_tb_shown');
        _renderToBill();
      }
    });
    expect(r.empty).toBe('none');
    expect(r.had).toEqual({ display: '', bar: true });
  });

  test('reduced motion keeps the order as a plain fade', async () => {
    const r = await page.evaluate(() => {
      const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } })
        .filter(x => x.media && /prefers-reduced-motion/.test(x.media.mediaText)).map(x => x.cssText).join(' ');
      return { fade: /boot-cascade \[data-wf\][^}]*td-wf-fade/.test(css) };
    });
    expect(r.fade).toBe(true);
  });

  test('old boot pieces are gone', async () => {
    const r = await page.evaluate(() => ({
      shape: typeof _tdSkelShape, nbHtml: typeof _dashNearbySkelHTML,
      cardCascade: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).some(x => x.name === 'td-card-cascade' || x.name === 'td-met-enter'),
    }));
    expect(r).toEqual({ shape: 'undefined', nbHtml: 'undefined', cardCascade: false });
    assertNoErrors(page, 'home waterfall');
  });
});
