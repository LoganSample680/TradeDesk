// @ts-check
/**
 * The boot screen redesign (owner-approved 2026-09-24) and the white-label look
 * it takes from the contractor's logo.
 *
 *   js/brand-look.js   tdLogoLook, tdLogoKey, tdBootFill
 *   js/settings.js     _tdBrandFromLogo, _updateBootPreview
 *   js/dashboard.js    _dashRevealSkeletons (tdSkelSweep lives in js/brand-look.js)
 *   js/cloud.js        _removeBootOverlay (the 2.15s beat), _showUpdateOverlay
 *   client.html        the hub boot (no "Powered by", ever)
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, FAKE_USER_ID } = require('./helpers');

// Test logos drawn in the page, so nothing depends on a file on disk.
const DRAW = `
  window.__logo = function(kind){
    const c=document.createElement('canvas');c.width=c.height=120;const x=c.getContext('2d');
    if(kind==='black-blue'){x.fillStyle='#000';x.fillRect(0,0,120,120);x.fillStyle='#0a8cf5';x.beginPath();x.arc(60,60,34,0,7);x.fill();}
    if(kind==='white-red'){x.fillStyle='#fff';x.fillRect(0,0,120,120);x.fillStyle='#d32a2a';x.fillRect(30,30,60,60);}
    if(kind==='clear-dark'){x.fillStyle='#1a1a1a';x.fillRect(30,40,60,40);}
    if(kind==='clear-light'){x.fillStyle='#f4f4f4';x.fillRect(30,40,60,40);}
    if(kind==='grey'){x.fillStyle='#222';x.fillRect(0,0,120,120);x.fillStyle='#aaa';x.fillRect(30,30,60,60);}
    return c.toDataURL('image/png');
  };
  window.__img = function(src){return new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;});};
`;

test.describe('brand-look: the look a logo gives the screen', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(DRAW);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('a logo on black keeps black and gives its blue as the accent', async () => {
    const lk = await page.evaluate(async () => tdLogoLook(await __img(__logo('black-blue'))));
    expect(lk.bg).toBe('#000000');
    expect(lk.dark).toBe(true);
    expect(lk.accent).toMatch(/^#0[0-9a-f]8[0-9a-f]f[0-9a-f]$/);   // the #0a8cf5 family
  });

  test('a logo on white keeps white, dark footer text, red accent', async () => {
    const lk = await page.evaluate(async () => tdLogoLook(await __img(__logo('white-red'))));
    expect(lk.bg).toBe('#ffffff');
    expect(lk.dark).toBe(false);
    expect(lk.fg).toContain('0,0,0');
    expect(lk.accent.slice(0, 3)).toBe('#d3');
  });

  test('a transparent logo gets whichever of black or white it reads on', async () => {
    const r = await page.evaluate(async () => ({
      dark: tdLogoLook(await __img(__logo('clear-dark'))).bg,
      light: tdLogoLook(await __img(__logo('clear-light'))).bg,
    }));
    expect(r.dark).toBe('#ffffff');
    expect(r.light).toBe('#000000');
  });

  test('a black and white logo has no accent, so no brand colour is invented', async () => {
    const lk = await page.evaluate(async () => tdLogoLook(await __img(__logo('grey'))));
    expect(lk.accent).toBeNull();
  });

  test('null, undecoded and junk input return null, never throw', async () => {
    const r = await page.evaluate(() => ({
      nul: tdLogoLook(null), und: tdLogoLook(undefined), blank: tdLogoLook(new Image()), junk: tdLogoLook('x'),
    }));
    expect(r).toEqual({ nul: null, und: null, blank: null, junk: null });
  });

  test('tdLogoKey is stable per logo and differs between logos', async () => {
    const r = await page.evaluate(() => {
      const a = __logo('black-blue'), b = __logo('white-red');
      return { same: tdLogoKey(a) === tdLogoKey(a), diff: tdLogoKey(a) !== tdLogoKey(b), empty: tdLogoKey(''), nul: tdLogoKey(null) };
    });
    expect(r.same).toBe(true);
    expect(r.diff).toBe(true);
    expect(r.empty).toBe('');
    expect(r.nul).toBe('');
  });

  test('tdBootFill: logo alone, big, with "Powered by" only when asked', async () => {
    const r = await page.evaluate(async () => {
      const a = document.createElement('div'), b = document.createElement('div');
      tdBootFill(a, { logo: __logo('black-blue'), name: 'Plumbing Solutions', powered: true });
      tdBootFill(b, { logo: __logo('black-blue'), name: 'Plumbing Solutions', powered: false });
      return {
        img: !!a.querySelector('img.bt-logo'), nameShown: !!a.querySelector('.bt-name'),
        footA: (a.querySelector('.bt-foot') || {}).textContent || '', footB: !!b.querySelector('.bt-foot'),
      };
    });
    expect(r.img).toBe(true);
    expect(r.nameShown).toBe(false);          // the logo carries the screen on its own
    expect(r.footA).toBe('Powered by TradeDesk');
    expect(r.footB).toBe(false);
  });

  test('tdBootFill: no logo shows the business name and its initial, escaped', async () => {
    const r = await page.evaluate(() => {
      const a = document.createElement('div');
      tdBootFill(a, { name: '<img src=x onerror=alert(1)>Acme', brand: '#1F4E8C' });
      return { tile: a.querySelector('.bt-tile').textContent, name: a.querySelector('.bt-name').textContent, injected: !!a.querySelector('.bt-name img'), tint: a.querySelector('.bt-tile').style.background };
    });
    expect(r.tile).toBe('<');
    expect(r.name).toContain('Acme');
    expect(r.injected).toBe(false);
    expect(r.tint).toContain('rgb(31, 78, 140)');
  });

  test('tdBootFill: nothing set shows TradeDesk; a status line replaces the footer', async () => {
    const r = await page.evaluate(() => {
      const a = document.createElement('div'), b = document.createElement('div');
      tdBootFill(a, {});
      tdBootFill(b, { name: 'Acme', powered: true, status: 'Updating…' });
      return { word: (a.querySelector('.bt-word') || {}).textContent, foot: b.querySelector('.bt-foot').textContent };
    });
    expect(r.word).toBe('TradeDesk');
    expect(r.foot).toBe('Updating…');
  });

  test('tdBootFill: a cached look paints the right background on the first frame', async () => {
    const r = await page.evaluate(async () => {
      const logo = __logo('white-red');
      localStorage.setItem('zz_test_look', JSON.stringify({ k: tdLogoKey(logo), bg: '#ffffff', fg: 'rgba(0,0,0,.38)' }));
      const a = document.createElement('div');
      tdBootFill(a, { logo, cacheKey: 'zz_test_look', powered: true });
      const first = a.style.background;
      const b = document.createElement('div');
      tdBootFill(b, { logo: __logo('black-blue'), cacheKey: 'zz_test_look' });   // a DIFFERENT logo misses
      const miss = b.style.background;
      localStorage.removeItem('zz_test_look');
      return { first, miss };
    });
    expect(r.first).toContain('255, 255, 255');
    expect(r.miss).toContain('0, 0, 0');
  });

  // Jack's logo is a 1.5 MB PNG, too big for the settings cache (saveAll splits it
  // out on quota), so the boot screen fell back to his business name while the
  // hub, which loads the logo by URL, showed it. A boot-sized copy in the look
  // cache puts the same logo on the first frame of both.
  test('tdBootFill: a read logo caches a boot-sized copy with its look', async () => {
    const r = await page.evaluate(async () => {
      localStorage.removeItem('zz_thumb');
      const big = document.createElement('canvas'); big.width = 1600; big.height = 800;
      const x = big.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1600, 800);
      x.fillStyle = '#0a8cf5'; x.fillRect(400, 200, 800, 400);
      const logo = big.toDataURL('image/png');
      const a = document.createElement('div');
      tdBootFill(a, { logo, cacheKey: 'zz_thumb' });
      for (let i = 0; i < 40 && !localStorage.getItem('zz_thumb'); i++) await new Promise(r => setTimeout(r, 50));
      const c = JSON.parse(localStorage.getItem('zz_thumb') || 'null');
      const t = c && c.img ? await __img(c.img) : null;
      localStorage.removeItem('zz_thumb');
      return { k: c && c.k === tdLogoKey(logo), bg: c && c.bg, w: t && t.naturalWidth, h: t && t.naturalHeight };
    });
    expect(r.k).toBe(true);
    expect(r.bg).toBe('#000000');
    expect(r.w).toBe(600);    // longest side 600, aspect kept
    expect(r.h).toBe(300);
  });

  test('tdBootFill: no logo in hand but a cached copy paints the logo, not the name', async () => {
    const r = await page.evaluate(async () => {
      const logo = __logo('white-red');
      localStorage.setItem('zz_copy', JSON.stringify({ k: tdLogoKey(logo), bg: '#ffffff', fg: 'rgba(0,0,0,.38)', img: logo }));
      const a = document.createElement('div');
      tdBootFill(a, { logo: '', name: 'Plumbing Solutions By JS', cacheKey: 'zz_copy' });
      const img = a.querySelector('img.bt-logo');
      const b = document.createElement('div');
      tdBootFill(b, { logo: '', name: 'Acme' });   // no cache key: the name, as before
      localStorage.removeItem('zz_copy');
      return { img: !!img, src: img && img.src === logo, bg: a.style.background, name: !!a.querySelector('.bt-name'),
        plainName: (b.querySelector('.bt-name') || {}).textContent };
    });
    expect(r.img).toBe(true);
    expect(r.src).toBe(true);
    expect(r.bg).toContain('255, 255, 255');
    expect(r.name).toBe(false);
    expect(r.plainName).toBe('Acme');
  });

  test('tdBootFill: a cache hit paints the small copy, never re-reads the full logo', async () => {
    const r = await page.evaluate(async () => {
      const full = __logo('black-blue'), small = __logo('grey');
      localStorage.setItem('zz_hit', JSON.stringify({ k: tdLogoKey(full), bg: '#000000', fg: 'x', img: small }));
      const a = document.createElement('div');
      tdBootFill(a, { logo: full, cacheKey: 'zz_hit' });
      await new Promise(r => setTimeout(r, 200));
      const c = JSON.parse(localStorage.getItem('zz_hit'));
      localStorage.removeItem('zz_hit');
      return { src: a.querySelector('img.bt-logo').src === small, kept: c.img === small && c.fg === 'x' };
    });
    expect(r.src).toBe(true);
    expect(r.kept).toBe(true);   // cache left alone on a hit
  });

  test('tdBootCacheLogo: caches once, skips a cached logo, survives junk and a full quota', async () => {
    const r = await page.evaluate(async () => {
      const logo = __logo('white-red');
      localStorage.removeItem('zz_bcl');
      let calls = 0;
      tdBootCacheLogo(logo, 'zz_bcl', () => calls++);
      for (let i = 0; i < 40 && !calls; i++) await new Promise(r => setTimeout(r, 50));
      const first = JSON.parse(localStorage.getItem('zz_bcl') || 'null');
      localStorage.setItem('zz_bcl', JSON.stringify({ ...first, bg: '#abcdef' }));
      tdBootCacheLogo(logo, 'zz_bcl', l => { calls++; window.__bclBg = l.bg; });
      const second = JSON.parse(localStorage.getItem('zz_bcl')).bg;
      let threw = false;
      try { tdBootCacheLogo(null, 'zz_bcl'); tdBootCacheLogo(logo, ''); tdBootCacheLogo('not an image', 'zz_junk'); } catch (e) { threw = true; }
      // Quota: the copy is dropped, the look still lands.
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'zz_q' && /"img"/.test(v)) throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
      localStorage.removeItem('zz_q');
      tdBootCacheLogo(__logo('black-blue'), 'zz_q');
      for (let i = 0; i < 40 && !localStorage.getItem('zz_q'); i++) await new Promise(r => setTimeout(r, 50));
      Storage.prototype.setItem = orig;
      const q = JSON.parse(localStorage.getItem('zz_q') || 'null');
      ['zz_bcl', 'zz_q', 'zz_junk'].forEach(k => localStorage.removeItem(k));
      return { calls, img: !!(first && first.img), second, cbBg: window.__bclBg, threw, qBg: q && q.bg, qImg: q && 'img' in q };
    });
    expect(r.img).toBe(true);
    expect(r.second).toBe('#abcdef');   // already cached: not re-read
    expect(r.cbBg).toBe('#abcdef');     // callback still gets the cached look
    expect(r.calls).toBe(2);
    expect(r.threw).toBe(false);
    expect(r.qBg).toBe('#000000');
    expect(r.qImg).toBe(false);
  });

  test('tdBootFill: missing container and repeat calls are safe', async () => {
    const r = await page.evaluate(() => {
      try {
        tdBootFill(null, {}); tdBootFill(undefined);
        const a = document.createElement('div');
        for (let i = 0; i < 5; i++) tdBootFill(a, { name: 'Acme' });
        return { ok: true, stages: a.querySelectorAll('.bt-stage').length, css: document.querySelectorAll('#td-boot-css').length };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.stages).toBe(1);   // rebuilt, never stacked
    expect(r.css).toBe(1);      // the stylesheet is added once
    assertNoErrors(page, 'brand-look');
  });
});

test.describe('app boot screen', () => {
  test('the old glow, bar and status copy are gone; the new screen is up', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const r = await page.evaluate(() => ({
      glow: document.querySelectorAll('.sbo-glow,#_sbo_glow').length,
      bar: document.querySelectorAll('.sbo-bar,#_sbo_bar,.sbo-track').length,
      hint: document.querySelectorAll('#_sbo_hint,.sbo-hint').length,
      stage: document.querySelectorAll('#supa-boot-overlay .bt-stage').length,
    }));
    expect(r.glow).toBe(0);
    expect(r.bar).toBe(0);
    expect(r.hint).toBe(0);
    expect(r.stage).toBe(1);
    await waitForAppBoot(page);
    assertNoErrors(page, 'app boot screen');
  });

  test('"Powered by TradeDesk" follows the Settings switch', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('zz_seeded')) {
        localStorage.setItem('zp3_S', JSON.stringify({ bname: 'Acme Plumbing', poweredBy: false }));
        sessionStorage.setItem('zz_seeded', '1');
      }
    });
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const r = await page.evaluate(() => ({
      name: (document.querySelector('#supa-boot-overlay .bt-name') || {}).textContent || '',
      foot: !!document.querySelector('#supa-boot-overlay .bt-foot'),
    }));
    expect(r.name).toBe('Acme Plumbing');
    expect(r.foot).toBe(false);
  });

  test('a logo the settings cache split out (zp3_logo) still shows on the first frame', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('zz_seeded')) {
        const c = document.createElement('canvas'); c.width = c.height = 60;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 60, 60); x.fillStyle = '#d32a2a'; x.fillRect(15, 15, 30, 30);
        localStorage.setItem('zp3_S', JSON.stringify({ bname: 'Plumbing Solutions By JS', poweredBy: false }));
        localStorage.setItem('zp3_logo', c.toDataURL('image/png'));
        sessionStorage.setItem('zz_seeded', '1');
      }
    });
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const r = await page.evaluate(() => ({
      logo: !!document.querySelector('#supa-boot-overlay img.bt-logo'),
      name: !!document.querySelector('#supa-boot-overlay .bt-name'),
    }));
    expect(r.logo).toBe(true);
    expect(r.name).toBe(false);
    await waitForAppBoot(page);
    assertNoErrors(page, 'split logo boot');
  });

  test('the overlay holds for the 2.15s beat, then lifts and is removed', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    const r0 = await page.evaluate(() => {
      window._bootCascadeRan = false;
      document.getElementById('supa-boot-overlay')?.remove();
      const o = document.createElement('div'); o.id = 'supa-boot-overlay'; document.body.appendChild(o);
      window._sboT0 = Date.now();
      _removeBootOverlay();
      _removeBootOverlay();   // a second boot step calling in during the hold must not cut it short
      return { fading: o.classList.contains('td-fadeout') };
    });
    expect(r0.fading).toBe(false);
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => document.getElementById('supa-boot-overlay').classList.contains('td-fadeout'))).toBe(false);
    await page.waitForFunction(() => !document.getElementById('supa-boot-overlay'), { timeout: 4000 });
    await page.waitForFunction(() => !document.getElementById('pg-dash').classList.contains('boot-cascade'), { timeout: 6000 });
    assertNoErrors(page, 'boot beat');
  });

  test('the "Updating" screen is the same screen with a status line', async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    const r = await page.evaluate(() => {
      document.getElementById('_update-ov')?.remove();
      _showUpdateOverlay(); _showUpdateOverlay();   // second call is a no-op
      const ov = document.getElementById('_update-ov');
      const out = { n: document.querySelectorAll('#_update-ov').length, stage: !!ov.querySelector('.bt-stage'), foot: ov.querySelector('.bt-foot').textContent, old: ov.querySelectorAll('.sbo-bar,.sbo-glow').length };
      ov.remove();
      return out;
    });
    expect(r).toEqual({ n: 1, stage: true, foot: 'Updating…', old: 0 });
    assertNoErrors(page, 'update overlay');
  });
});

test.describe('dashboard boot: shimmer waterfall, then the data lands', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()));
  });
  test.afterAll(async () => { await page.context().close(); });

  test('every shimmer bar is anchored to the page and to one clock', async () => {
    const r = await page.evaluate(() => {
      window._bootSyncPending = true; window._bootSkelDone = false;
      _dashApplySkeletons();
      const bars = [...document.querySelectorAll('#pg-dash .td-boot-skel .td-skel')];
      const out = {
        n: bars.length,
        allSx: bars.every(b => /px$/.test(b.style.getPropertyValue('--sx'))),
        // One batch, one phase: every bar carries the same delay...
        delays: new Set(bars.map(b => b.style.animationDelay)).size,
        anim: bars[0] ? getComputedStyle(bars[0]).animationName : '',
      };
      return out;
    });
    // ...and, once running, every sweep sits at the same point in its cycle
    // (read off the live animations, not recomputed from the page clock).
    const spread = await page.evaluate(async () => {
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const t = document.getAnimations()
        .filter(a => a.animationName === 'td-skel-sweep' && a.effect && a.effect.target && a.effect.target.closest('#pg-dash'))
        .map(a => ((Number(a.currentTime) % 1300) + 1300) % 1300);
      if (!t.length) return 9999;
      const lo = Math.min(...t), hi = Math.max(...t);
      return Math.min(hi - lo, 1300 - (hi - lo));   // distance on the cycle, so 1299 and 1 are 2ms apart
    });
    expect(r.n).toBeGreaterThan(0);
    expect(r.allSx).toBe(true);
    expect(r.delays).toBe(1);
    expect(spread).toBeLessThan(40);
    expect(r.anim).toBe('td-skel-sweep');
  });

  test('the data lands card by card, every shimmer gone inside half a second', async () => {
    const n = await page.evaluate(() => {
      window._bootSyncPending = true; window._bootSkelDone = false;
      _dashApplySkeletons();
      window._bootSkelDone = true; window._bootSyncPending = false;
      const n = document.querySelectorAll('#pg-dash .td-boot-skel-on').length;
      _dashRevealSkeletons();
      return n;
    });
    expect(n).toBeGreaterThan(0);
    await page.waitForFunction(() => !document.querySelector('#pg-dash .td-boot-skel-on,#pg-dash .td-boot-skel'), { timeout: 1500 });
    await page.waitForFunction(() => !document.querySelector('#pg-dash .td-data-in'), { timeout: 1500 });
  });

  test('a card whose shimmer was already replaced shows at once, not on its turn', async () => {
    const r = await page.evaluate(() => {
      window._bootSyncPending = true; window._bootSkelDone = false;
      _dashApplySkeletons();
      const all = [...document.querySelectorAll('#pg-dash .td-boot-skel-on')];
      const bare = all[all.length - 1];
      bare.querySelectorAll(':scope>.td-boot-skel').forEach(s => s.remove());   // a re-render wiped it
      window._bootSkelDone = true; window._bootSyncPending = false;
      _dashRevealSkeletons();
      return new Promise(res => setTimeout(() => res({ n: all.length, bareShown: !bare.classList.contains('td-boot-skel-on') }), 30));
    });
    expect(r.n).toBeGreaterThan(1);
    expect(r.bareShown).toBe(true);
    await page.waitForFunction(() => !document.querySelector('#pg-dash .td-boot-skel-on'), { timeout: 1500 });
  });

  test('reveal with nothing shimmering, or called repeatedly, is a no-op', async () => {
    const r = await page.evaluate(() => {
      try { for (let i = 0; i < 5; i++) _dashRevealSkeletons(); tdSkelSweep(document.createElement("div")); tdSkelSweep(null); return true; }
      catch (e) { return e.message; }
    });
    expect(r).toBe(true);
  });

  // Owner 2026-09-24: "on the road and on site banner still loads in weird
  // and choppy". The banner sits in the KPI widget; it now has its own shimmer
  // card at its last height, and under the shimmer it never waits for the pour
  // or slides open, it lands with its card.
  test('the geo banner has its own shimmer card, sized to its last height', async () => {
    const r = await page.evaluate(() => {
      const keep = localStorage.getItem('zp3_nearby_snap');
      const out = {};
      localStorage.setItem('zp3_nearby_snap', JSON.stringify({ html: '<div>x</div>', ts: Date.now(), uid: null, h: 152 }));
      out.remembered = _dashNearbySkelH();
      localStorage.setItem('zp3_nearby_snap', '{junk');
      out.junk = _dashNearbySkelH();
      localStorage.setItem('zp3_nearby_snap', JSON.stringify({ h: 99999 }));
      out.absurd = _dashNearbySkelH();
      localStorage.removeItem('zp3_nearby_snap');
      out.none = _dashNearbySkelH();
      localStorage.setItem('zp3_nearby_snap', JSON.stringify({ h: 152 }));
      out.inKpi = _tdSkelShape('kpi', 300).includes('height:152px');
      if (keep == null) localStorage.removeItem('zp3_nearby_snap'); else localStorage.setItem('zp3_nearby_snap', keep);
      return out;
    });
    expect(r).toEqual({ remembered: 152, junk: 86, absurd: 86, none: 86, inKpi: true });
  });

  test('under the shimmer the banner neither waits for the pour nor slides open', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-nearby'), d = document.getElementById('pg-dash');
      if (window._nearbyPourWait) { clearInterval(window._nearbyPourWait); window._nearbyPourWait = null; }
      el.style.display = 'none'; el.innerHTML = ''; el.style.maxHeight = ''; el.style.transition = '';
      window._bootSyncPending = true; window._bootSkelDone = false;
      _dashApplySkeletons();
      d.classList.add('boot-cascade');          // the pour is mid-flight
      renderDash();
      const out = {
        underShimmer: !!el.closest('.td-boot-skel-on'),
        shown: el.style.display, slid: el.style.maxHeight, waiting: !!window._nearbyPourWait,
        entrance: /tdNearbyIn/.test(el.innerHTML),
      };
      d.classList.remove('boot-cascade');
      window._bootSkelDone = true; window._bootSyncPending = false;
      _dashRevealSkeletons();
      return out;
    });
    expect(r.underShimmer).toBe(true);
    expect(r.shown).toBe('block');     // in place, hidden only by the shimmer card
    expect(r.slid).toBe('');           // no max-height slide shoving the page
    expect(r.waiting).toBe(false);     // no second reveal after the pour
    expect(r.entrance).toBe(false);    // it fades in with its card, not on its own
    await page.waitForFunction(() => !document.querySelector('#pg-dash .td-boot-skel'), { timeout: 1500 });
  });

  test('nothing on the dashboard moves when the data lands', async () => {
    const r = await page.evaluate(async () => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      renderDash();
      const ws = [...document.querySelectorAll('#dash-widget-root>.td-dw')];
      const real = ws.map(w => w.offsetHeight);
      window._bootSyncPending = true; window._bootSkelDone = false;
      _dashApplySkeletons();
      const skel = ws.map(w => w.offsetHeight);
      window._bootSkelDone = true; window._bootSyncPending = false;
      renderDash(); _dashRevealSkeletons();
      await new Promise(res => setTimeout(res, 900));
      return { real, skel, after: ws.map(w => w.offsetHeight) };
    });
    expect(r.real.some(h => h > 0)).toBe(true);
    expect(r.skel).toEqual(r.real);   // shimmer holds exactly the real space
    expect(r.after).toEqual(r.real);  // and the data lands into it
  });

  test('the banner snapshot remembers its height for the next boot', async () => {
    const h = await page.evaluate(() => {
      window._nearbyLiveRendered = false; window._geoFixSeen = true;
      renderDash();
      const sn = JSON.parse(localStorage.getItem('zp3_nearby_snap') || 'null');
      return { h: sn && sn.h, now: document.getElementById('dash-nearby').offsetHeight };
    });
    expect(h.now).toBeGreaterThan(0);
    expect(h.h).toBe(h.now);
  });

  test('the waterfall drops DOWN into place', async () => {
    const r = await page.evaluate(() => {
      for (const sh of document.styleSheets) {
        try { for (const rule of sh.cssRules) if (rule.name === 'td-card-cascade') return rule.cssRules[0].style.transform; } catch (e) {}
      }
      return null;
    });
    expect(r).toBe('translateY(-16px)');
    assertNoErrors(page, 'dashboard boot reveal');
  });
});

test.describe('brand colour from the logo', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(DRAW);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('fills an empty brand colour from the logo, ADA-clamped', async () => {
    const r = await page.evaluate(async () => {
      S.brandColor = '';
      const set = _tdBrandFromLogo(tdLogoLook(await __img(__logo('black-blue'))));
      return { set, color: S.brandColor, ada: adaBrand(S.brandColor) === S.brandColor };
    });
    expect(r.set).toBe(true);
    expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.ada).toBe(true);
  });

  test('never overwrites a colour the contractor picked', async () => {
    const r = await page.evaluate(async () => {
      S.brandColor = '#123456';
      const set = _tdBrandFromLogo(tdLogoLook(await __img(__logo('white-red'))));
      return { set, color: S.brandColor };
    });
    expect(r).toEqual({ set: false, color: '#123456' });
  });

  test('no accent, null or junk look leaves it alone', async () => {
    const r = await page.evaluate(() => {
      S.brandColor = '';
      const out = [_tdBrandFromLogo(null), _tdBrandFromLogo(undefined), _tdBrandFromLogo({}), _tdBrandFromLogo({ accent: null })];
      return { out, color: S.brandColor };
    });
    expect(r.out).toEqual([false, false, false, false]);
    expect(r.color).toBe('');
  });

  test('the Settings preview shows the logo on its own background', async () => {
    const r = await page.evaluate(async () => {
      const prevLogo = S.logoData;
      S.logoData = __logo('white-red');
      const wrap = document.getElementById('boot-preview-bg');
      _updateBootPreview();
      await new Promise(r => setTimeout(r, 200));
      const out = { bg: wrap ? wrap.style.background : 'missing', img: !!document.querySelector('#boot-preview-logo img'), bar: !!document.getElementById('boot-preview-bar') };
      S.logoData = prevLogo; _updateBootPreview();
      return out;
    });
    expect(r.bg).toContain('255, 255, 255');
    expect(r.img).toBe(true);
    expect(r.bar).toBe(false);   // the old progress bar is gone from the preview too
    assertNoErrors(page, 'brand from logo');
  });
});

test.describe('client hub boot', () => {
  const hub = (extra = {}) => ({ clientId: 931, contractorUserId: FAKE_USER_ID, contractorName: 'Plumbing Solutions by JS', clientName: 'Dana', bids: [], jobs: [], payments: [], messages: [], notifications: [], invoices: [], photos: [], ...extra });

  test('shows the contractor, and never "Powered by TradeDesk"', async ({ page }) => {
    await page.addInitScript(h => { window.__mockHubData = h; }, hub());
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('#boot-overlay .bt-name'), { timeout: 8000 });
    const r = await page.evaluate(() => ({
      name: document.querySelector('#boot-overlay .bt-name').textContent,
      text: document.getElementById('boot-overlay').textContent,
      old: document.querySelectorAll('#boot-overlay .cbo-bar,#boot-overlay .cbo-glow,#boot-bar').length,
    }));
    expect(r.name).toBe('Plumbing Solutions by JS');
    expect(r.text).not.toContain('Powered by');
    expect(r.old).toBe(0);
    assertNoErrors(page, 'hub boot name');
  });

  test('a repeat visit paints the cached contractor on the first frame', async ({ page }) => {
    await page.addInitScript(({ h, uid }) => {
      window.__mockHubData = h;
      localStorage.setItem('td_hub_brand_' + uid, JSON.stringify({ name: 'Cached Co', color: '#1F4E8C' }));
    }, { h: hub({ contractorName: 'Cached Co' }), uid: FAKE_USER_ID });
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('#boot-overlay .bt-name'), { timeout: 8000 });
    expect(await page.evaluate(() => document.querySelector('#boot-overlay .bt-name').textContent)).toBe('Cached Co');
  });

  test('a logo with no brand colour sets the hub colour from the logo', async ({ page }) => {
    await page.addInitScript(DRAW);
    await page.addInitScript(() => {
      const c = document.createElement('canvas'); c.width = c.height = 120; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 120, 120); x.fillStyle = '#0a8cf5'; x.beginPath(); x.arc(60, 60, 34, 0, 7); x.fill();
      window.__mockHubData = { clientId: 932, contractorName: 'Logo Co', clientName: 'Dana', logoData: c.toDataURL('image/png'), bids: [], jobs: [], payments: [], messages: [], notifications: [], invoices: [], photos: [] };
    });
    await mockAllExternal(page);
    await page.goto(`/client.html?c=932&u=${FAKE_USER_ID}&t=boot932`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const ov = document.getElementById('boot-overlay');
      return ov && ov.querySelector('img.bt-logo') && /rgb\(0, 0, 0\)/.test(ov.style.background);
    }, { timeout: 8000 });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--denim').trim().toLowerCase().startsWith('#0'), { timeout: 8000 });
    const r = await page.evaluate(() => ({ foot: !!document.querySelector('#boot-overlay .bt-foot') }));
    expect(r.foot).toBe(false);
    assertNoErrors(page, 'hub logo colour');
  });

  // Owner 2026-09-25: the hub links "don't share the same exact animation the
  // app does". After the logo the hub now plays the app's load: the cards drop
  // in as shimmer, one band sweeps them, then each fills in a shuffled order.
  const HUB_FULL = () => hub({ clientName: 'Dana Miller', clientAddr: '3 Timeline Ave',
    jobs: [{ id: 5001, bid_id: null, name: 'Water heater', start: '2026-09-28', days: 1, status: 'scheduled', photos: [] }] });

  test('after the logo, the hub cards pour in as shimmer, then each fills with its data', async ({ page }) => {
    await page.addInitScript(h => { window.__mockHubData = h; window._forceBootDwell = true; }, HUB_FULL());
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#view-overview .hub-skel').length > 0, { timeout: 8000 });
    const during = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('#view-overview .hub-skel .td-skel')];
      const covered = [...document.querySelectorAll('#view-overview>.hub-hero,#view-overview .card')];
      return {
        cards: covered.length,
        allCovered: covered.every(c => c.classList.contains('hub-skel-on') && c.querySelector(':scope>.hub-skel')),
        bars: bars.length,
        swept: bars.every(b => b.classList.contains('td-sweep') && /px$/.test(b.style.getPropertyValue('--sx'))),
        oneClock: new Set(bars.map(b => b.style.animationDelay)).size,
        anim: getComputedStyle(bars[0]).animationName,
        cascade: document.getElementById('view-overview').classList.contains('hub-cascade'),
      };
    });
    expect(during.cards).toBeGreaterThanOrEqual(2);
    expect(during.allCovered).toBe(true);
    expect(during.bars).toBeGreaterThanOrEqual(4);
    expect(during.swept).toBe(true);
    expect(during.oneClock).toBe(1);
    expect(during.anim).toBe('td-skel-sweep');
    expect(during.cascade).toBe(true);   // the shimmer drops down with the waterfall
    await page.waitForFunction(() => !document.querySelector('#view-overview .hub-skel,#view-overview .hub-skel-on'), { timeout: 5000 });
    const after = await page.evaluate(() => ({
      text: document.getElementById('view-overview').textContent,
      greet: !!document.querySelector('#view-overview .hub-hero-greeting'),
    }));
    expect(after.text).toContain('Water heater');
    expect(after.greet).toBe(true);
    assertNoErrors(page, 'hub shimmer load');
  });

  test('the fast paths (errors, the test mock) never shimmer', async ({ page }) => {
    await page.addInitScript(h => { window.__mockHubData = h; }, HUB_FULL());
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('boot-overlay')).display === 'none', { timeout: 8000 });
    expect(await page.locator('#view-overview .hub-skel').count()).toBe(0);
  });

  test('skeleton helpers: no stacking, no overview, nothing to reveal, all safe', async ({ page }) => {
    await page.addInitScript(h => { window.__mockHubData = h; }, HUB_FULL());
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('#view-overview .card'), { timeout: 8000 });
    const r = await page.evaluate(async () => {
      try {
        _hubRevealSkeletons();                          // nothing shimmering: no-op
        _hubApplySkeletons(); _hubApplySkeletons();     // twice: one cover per card
        const per = [...document.querySelectorAll('#view-overview .hub-skel-on')].map(c => c.querySelectorAll(':scope>.hub-skel').length);
        for (let i = 0; i < 3; i++) _hubRevealSkeletons();
        await new Promise(r => setTimeout(r, 900));
        const left = document.querySelectorAll('#view-overview .hub-skel,#view-overview .hub-skel-on').length;
        const ov = document.getElementById('view-overview'); ov.id = 'x-ov';
        const none = _hubApplySkeletons().length;
        ov.id = 'view-overview';
        return { ok: true, per, left, none };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.per.length).toBeGreaterThan(0);
    expect(r.per.every(n => n === 1)).toBe(true);
    expect(r.left).toBe(0);
    expect(r.none).toBe(0);
    assertNoErrors(page, 'hub skeleton helpers');
  });

  test('reduced motion: the hub goes straight to its data, no shimmer', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(h => { window.__mockHubData = h; window._forceBootDwell = true; }, HUB_FULL());
    await mockAllExternal(page);
    await page.goto(`/client.html?c=931&u=${FAKE_USER_ID}&t=boot931`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('view-overview').classList.contains('hub-cascade'), { timeout: 8000 });
    expect(await page.locator('#view-overview .hub-skel').count()).toBe(0);
    await ctx.close();
  });
});
