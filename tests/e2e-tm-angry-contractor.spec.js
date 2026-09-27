// @ts-check
/**
 * Earl.
 *
 * Owner, 2026-09-23: "playwright tested as a pissed off Contractor who was 58
 * and fucking hate technology. Stress test the shit out of it break it destroy
 * it get pissed off at it. I don't want this to be any capability of anger."
 *
 * Earl is 58. He has thick thumbs, reading glasses he left in the truck, an
 * iPhone SE because it fits in his shirt pocket, and no patience. He taps
 * twice because the first one "didn't take". He types "$85/hr" into a box
 * that already has a dollar sign. He dictates with no punctuation. He hits
 * Back halfway through and expects his work to still be there. He does not
 * read anything longer than a line.
 *
 * Every test here is something that would make Earl throw the phone. They
 * are written as what Earl expects, not what the code does.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SE = { width: 375, height: 667 };

test.describe('Earl, 58, hates technology', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const fresh = (o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_gei-ip-ov,.pay-modal-overlay').forEach(e => e.remove());
    document.body.classList.toggle('dark', !!o.dark);
    bids.length = 0; clients.length = 0;
    clients.push({ id: 95001, name: o.name || 'Earl Pruitt', addr: o.addr || '412 Bell St, Topeka, KS 66603' });
    currentClientId = 95001;
    _activeTrade = o.trade || 'plumbing';
    if (typeof S !== 'undefined') { S.tmHideRate = false; }
    openTMEstimate(getClientById(95001));
    window.scrollTo(0, 0);
  }, o || {});
  const say = (t) => page.evaluate((t) => { document.getElementById('gei-scope-say').value = t; }, t);
  const typeIn = async (id, text) => { await page.locator('#' + id).fill(''); await page.locator('#' + id).pressSequentially(text); };
  const visibleText = () => page.evaluate(() => document.getElementById('gei-tm-page').innerText + ' ' + (document.getElementById('tm-dock') || {}).innerText);
  const junk = (t) => /\bNaN\b|\bundefined\b|\bInfinity\b|\[object|null\b/.test(t);
  const bar = () => page.evaluate(() => [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()));

  // ── FIRST LOOK ────────────────────────────────────────────────────────────

  test('on a small phone he can see where to type and the button, without scrolling', async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const box = document.getElementById('gei-scope-say').getBoundingClientRect();
      const dock = document.getElementById('tm-dock').getBoundingClientRect();
      return { boxTop: box.top, boxBottom: box.bottom, dockTop: dock.top, vh: innerHeight };
    });
    expect(r.boxBottom, 'the box is on the first screen').toBeLessThan(r.dockTop);
    expect(r.dockTop, 'the button is on the first screen').toBeLessThan(r.vh);
  });

  test('nothing goes sideways on a small phone, even with a long name and address', async () => {
    await fresh({ name: 'Bartholomew Montgomery-Richardson III', addr: '12345 North Old Settlers Memorial Highway Apt 2B, Mechanicsburg, PA 17055' });
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(r.sw).toBeLessThanOrEqual(r.cw);
  });

  // ── THUMBS ────────────────────────────────────────────────────────────────

  test('every thing he can tap is big enough for a thumb', async () => {
    await fresh();
    await say('pull the old water heater and set a tankless');
    await page.evaluate(() => { _geiScopeBuild('tm-scope-wrap'); _tmDepMode(1); });
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#gei-tm-page button, #gei-tm-page input, #gei-tm-page label.ios-row, #tm-dock button').forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return;
        if (el.closest('[style*="display: none"]')) return;
        // A field inside a <label> row is focused by a tap anywhere on the row,
        // so the ROW is the target, not the digits.
        const row = el.tagName === 'INPUT' ? el.closest('label.ios-row, .ios-row') : null;
        const rr = row ? row.getBoundingClientRect() : r;
        const h = rr.height, w = rr.width;
        if (h < 44 || w < 44) out.push((el.id || el.textContent.trim().slice(0, 24) || el.className) + ' ' + Math.round(w) + 'x' + Math.round(h));
      });
      return out;
    });
    expect(small, 'too small for a thumb').toEqual([]);
  });

  test('tapping the big button twice builds the steps once', async () => {
    await fresh();
    await say('pull the old water heater, set a tankless');
    await page.locator('#tm-dock-go').tap();
    await page.locator('#tm-dock-go').tap().catch(() => {});
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips).toEqual(['Pull the old water heater', 'Set a tankless']);
  });

  test('Add all, hammered, adds each once', async () => {
    await fresh();
    await say('pull the old water heater and set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    const b = page.locator('#tm-scope-wrap button', { hasText: /^Add all/ });
    await b.tap();
    await page.evaluate(() => { for (let i = 0; i < 5; i++) _geiScopeTakeAllMissed(); });
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(new Set(chips).size, 'no step twice').toBe(chips.length);
  });

  test('None and Amount, tapped back and forth ten times, end where he left them', async () => {
    await fresh();
    for (let i = 0; i < 10; i++) {
      await page.locator('#tm-dep-seg button', { hasText: i % 2 ? 'None' : 'Amount' }).tap();
    }
    const r = await page.evaluate(() => ({ on: _tmLayers.has('dep'), shown: document.getElementById('tm-dep-amt-row').style.display !== 'none', amt: _tmDeposit() }));
    expect(r).toEqual({ on: false, shown: false, amt: 0 });
  });

  // ── WHAT HE TYPES ─────────────────────────────────────────────────────────

  test('the big button with nothing typed tells him what to do', async () => {
    await fresh();
    await page.locator('#tm-dock-go').tap();
    const r = await page.evaluate(() => ({
      focused: document.activeElement && document.activeElement.id,
      toast: [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map(t => t.textContent).join(' '),
    }));
    expect(r.focused).toBe('gei-scope-say');
    expect(r.toast, 'something on screen says what to do').toMatch(/\S/);
  });

  test('dictated with no commas and no "and", it still comes out as steps', async () => {
    await fresh();
    await say('pull the old water heater put in a new tankless haul the old one away');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips.length, JSON.stringify(chips)).toBeGreaterThanOrEqual(3);
  });

  test('ALL CAPS, typos and an emoji do not break it', async () => {
    await fresh();
    await say('PULL THE OLD WATTER HEATER, PUT IN A NEW ONE 💩, HAUL IT OFF');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(junk(await visibleText())).toBe(false);
  });

  test('a pasted novel does not freeze the phone or bury him in steps', async () => {
    await fresh();
    const novel = Array.from({ length: 400 }, (_, i) => 'replace section ' + i + ' of the copper, ').join('');
    await say(novel);
    const t = await page.evaluate(() => { const a = performance.now(); _geiScopeBuild('tm-scope-wrap'); return performance.now() - a; });
    expect(t, 'ms').toBeLessThan(1500);
    expect(await page.evaluate(() => _geiScopeChips.length)).toBeLessThanOrEqual(40);
  });

  // Every way a man writes money.
  for (const [typed, want] of [['$85/hr', 85], ['85.50', 85.5], ['85 bucks', 85], ['$ 85', 85], ['1,250', 1250]]) {
    test('rate typed as "' + typed + '" is read as ' + want, async () => {
      await fresh();
      await typeIn('tm-i-rate', typed);
      const r = await page.evaluate(() => Number(_tmRatePerMan));
      expect(r).toBe(want);
      expect(junk(await visibleText())).toBe(false);
    });
  }

  for (const typed of ['eighty five', '-20', 'abc', '💰', '0']) {
    test('rate typed as "' + typed + '" never shows junk, and the button still says what to do', async () => {
      await fresh();
      await say('set a tankless'); await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
      await typeIn('tm-i-rate', typed);
      expect(junk(await visibleText())).toBe(false);
      const r = await page.evaluate(() => Number(_tmRatePerMan));
      expect(r >= 0, 'never a negative rate').toBe(true);
      if (!(r > 0)) expect(await bar()).toEqual(['Add your rate']);
    });
  }

  test('a rate of a million is questioned, not quietly put on a contract', async () => {
    await fresh();
    await typeIn('tm-i-rate', '1000000');
    const r = await page.evaluate(() => (document.getElementById('tm-step-2') || {}).textContent + ' ' + ((document.getElementById('tm-lbl-rate') || {}).textContent || ''));
    expect(r).toMatch(/check|sure|high/i);
  });

  test('money up front bigger than the most it can cost is stopped, in any state', async () => {
    await fresh();
    await say('set a tankless'); await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await typeIn('tm-i-rate', '85');
    await typeIn('tm-i-nte', '3000');
    await page.locator('#tm-dep-seg button', { hasText: 'Amount' }).tap();
    await typeIn('tm-i-dep-flat', '5000');
    expect(await bar()).toEqual(['Lower the deposit']);
  });

  test('clearing the rate after typing it puts the button back, with no junk', async () => {
    await fresh();
    await say('set a tankless'); await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await typeIn('tm-i-rate', '85');
    // Changed 2026-09-26 (§10.4, owner: "even I would race to get the proposal
    // done, there was a ton of shit I would've missed if my hand wasn't held,
    // rate, how much my hourly number was, how many people, Tim's
    // recommendations"). Send now waits until Tim's leftovers are answered and
    // the rate and people are checked; e2e-tm-guided.spec.js covers that walk.
    // Typing the rate is checking it; Tim's leftovers are answered here.
    await page.evaluate(() => { _geiScopeMissed.length = 0; _tmRenderSteps(); });
    expect(await bar()).toEqual(['Sign here', 'Send it']);
    await page.locator('#tm-i-rate').fill('');
    await page.locator('#tm-i-rate').dispatchEvent('input');
    expect(await bar()).toEqual(['Add your rate']);
    expect(junk(await visibleText())).toBe(false);
  });

  // ── WHEN HE MESSES UP ─────────────────────────────────────────────────────

  test('a step deleted by a fat thumb can be put back', async () => {
    await fresh();
    await say('pull the old water heater, run new pex, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await page.evaluate(() => document.querySelector('#tm-scope-wrap .ios-swipe[data-kind="step"] .ios-del').click());
    const undo = page.locator('text=/^Undo$/').first();
    await expect(undo, 'an Undo is offered').toBeVisible({ timeout: 1500 });
    await undo.tap();
    expect(await page.evaluate(() => _geiScopeChips.slice())).toEqual(['Pull the old water heater', 'Run new pex', 'Set a tankless']);
  });

  test('Back halfway through, then open the customer again: his work is still there', async () => {
    await fresh();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await typeIn('tm-i-rate', '85');
    await page.locator('#tm-topbar-wrap [aria-label="Back"]').tap();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(e => { const y = [...e.querySelectorAll('button')].find(b => /keep|save|leave/i.test(b.textContent)); if (y) y.click(); }));
    const r = await page.evaluate(() => {
      const b = bids.find(x => x.client_id === 95001 && x.isTM);
      return b ? { chips: b.scopeChips, rate: b.tmRatePerMan } : null;
    });
    expect(r, 'the draft was kept').not.toBeNull();
    expect(r.chips).toEqual(['Pull the old water heater', 'Set a tankless']);
    expect(r.rate).toBe(85);
  });

  test('Send with nothing on it tells him the one thing to do, with a button that does it', async () => {
    await fresh();
    const r = await page.evaluate(() => {
      const real = window.zConfirm, realToast = window.showToast; let seen = null, toast = null;
      window.zConfirm = (m, y, o) => { seen = { m, yes: o && o.yes }; };
      window.showToast = (m) => { toast = m; };
      try { sendGenericProposal(); } finally { window.zConfirm = real; window.showToast = realToast; }
      return { seen, toast };
    });
    expect(r.seen || r.toast, 'he is told something').toBeTruthy();
  });

  // ── WHERE HE IS ───────────────────────────────────────────────────────────

  test('offline in a basement, it still builds, saves and shows no error', async () => {
    await fresh();
    await ctx.setOffline(true);
    try {
      await say('pull the old water heater, set a tankless');
      await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
      await typeIn('tm-i-rate', '85');
      await page.evaluate(() => saveGenericEstimate(true));
      expect(await page.evaluate(() => _geiScopeChips.length)).toBe(2);
    } finally { await ctx.setOffline(false); }
  });

  test('nothing on the page is stuck under the bottom bar', async () => {
    await fresh();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await typeIn('tm-i-rate', '85');
    const r = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const dock = document.getElementById('tm-dock').getBoundingClientRect();
      const kids = [...document.querySelectorAll('#gei-tm-page button, #gei-tm-page input')].filter(e => e.offsetParent && !e.closest('#tm-dock'));
      const last = kids.map(e => e.getBoundingClientRect()).filter(r => r.height).sort((a, b) => b.bottom - a.bottom)[0];
      return { lastBottom: last.bottom, dockTop: dock.top };
    });
    expect(r.lastBottom).toBeLessThanOrEqual(r.dockTop);
  });

  test('turned sideways, the bar does not eat the screen', async () => {
    await fresh();
    await page.setViewportSize({ width: SE.height, height: SE.width });
    try {
      const r = await page.evaluate(() => ({ dock: document.getElementById('tm-dock').getBoundingClientRect().height, vh: innerHeight }));
      expect(r.dock).toBeLessThan(r.vh * 0.3);
    } finally { await page.setViewportSize(SE); }
  });

  // iPhone "Display Zoom", which is how a man who cannot read the small print
  // makes everything bigger: the phone reports a 320 point wide screen.
  test('with Display Zoom on, nothing runs off the side', async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    try {
      await fresh({ name: 'Bartholomew Montgomery-Richardson III' });
      await say('pull the old water heater, run new pex to the manifold, set a tankless');
      await page.evaluate(() => { _geiScopeBuild('tm-scope-wrap'); _tmDepMode(1); });
      const r = await page.evaluate(() => {
        const cw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#gei-tm-page *, #tm-dock *')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.width && e.offsetParent && r.right > cw + 1 && !e.closest('.ios-swipe .ios-del');
        }).map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().right)).slice(0, 8);
      });
      expect(r).toEqual([]);
    } finally { await page.setViewportSize(SE); }
  });

  test('in the dark, every word he has to read is readable', async () => {
    await fresh({ dark: true });
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    const bad = await page.evaluate(() => {
      const lum = c => { const m = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const bgOf = el => { let e = el; while (e) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; e = e.parentElement; } return 'rgb(0,0,0)'; };
      const out = [];
      document.querySelectorAll('#gei-tm-page *, #tm-dock *').forEach(el => {
        if (!el.offsetParent || !el.childNodes.length) return;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!own) return;
        if (el.closest('input,textarea')) return;
        const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 3) out.push(el.textContent.trim().slice(0, 30) + ' ' + ratio.toFixed(2));
      });
      document.body.classList.remove('dark');
      return out;
    });
    expect(bad).toEqual([]);
  });

  // ── ROUND TWO: EARL GETS MEANER ───────────────────────────────────────────

  // Bids live in the cloud, with an offline queue, and both have their own
  // suites. What this page owes Earl is that every change he makes is handed
  // to that save, the moment he makes it, so closing the app loses nothing.
  test('every change he makes is saved the moment he makes it', async () => {
    await fresh();
    const r = await page.evaluate(() => {
      let n = 0; const real = window.saveAll;
      window.saveAll = function () { n++; return real.apply(this, arguments); };
      try {
        document.getElementById('gei-scope-say').value = 'pull the old water heater, set a tankless';
        _geiScopeBuild('tm-scope-wrap'); const a = n;
        const e = document.getElementById('tm-i-rate'); e.value = '85'; _tmInputChange(); const b = n;
        _tmDepMode(1); const c = n;
        _tmDelStep('Set a tankless'); const f = n;
        return [a > 0, b > a, c > b, f > c];
      } finally { window.saveAll = real; }
    });
    expect(r, '[build, rate, up front, delete]').toEqual([true, true, true, true]);
  });

  test('he deletes every step: he is back at the box, and the button says Build', async () => {
    await fresh();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await page.evaluate(() => { _geiScopeChips.slice().forEach(l => _tmDelStep(l)); });
    expect(await page.evaluate(() => !!document.getElementById('gei-scope-say'))).toBe(true);
    expect(await bar()).toEqual(['Build the steps']);
    expect(junk(await visibleText())).toBe(false);
  });

  test('the crew stepper, hammered both ways, never goes below one or silly high', async () => {
    await fresh();
    await page.evaluate(() => { for (let i = 0; i < 30; i++) _tmCrewStep(-1); });
    expect(await page.evaluate(() => _tmCrewCount)).toBe(1);
    await page.evaluate(() => { for (let i = 0; i < 200; i++) _tmCrewStep(1); });
    const n = await page.evaluate(() => _tmCrewCount);
    expect(n).toBeLessThanOrEqual(50);
    expect(junk(await visibleText())).toBe(false);
  });

  test('a step he typed as one long rant wraps on the phone instead of running off it', async () => {
    await fresh();
    await say('replace the entire run of galvanized from the meter all the way back to the water heater including every fitting elbow and union behind the finished basement wall that the last guy boxed in with no access panel whatsoever');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(r.sw).toBeLessThanOrEqual(r.cw);
  });

  test('saying the same job again adds nothing twice', async () => {
    await fresh();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await page.evaluate(() => { _geiScopeSayMore('tm-scope-wrap'); document.getElementById('gei-scope-say').value = 'PULL THE OLD WATER HEATER and set a tankless'; _geiScopeBuild('tm-scope-wrap'); });
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips).toEqual(['Pull the old water heater', 'Set a tankless']);
  });

  test('a typed list with bullets and blank lines is read as his list', async () => {
    await fresh();
    await say('- pull old heater\n\n• set new tankless\n3) haul off old one\n   \n');
    await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    expect(await page.evaluate(() => _geiScopeChips.slice())).toEqual(['Pull old heater', 'Set new tankless', 'Haul off old one']);
  });

  test('junk in the up-front box never shows as junk or goes on a contract', async () => {
    await fresh();
    await page.locator('#tm-dep-seg button', { hasText: 'Amount' }).tap();
    for (const t of ['abc', '1,2,3', '-500', '$$$', '12.5.6']) {
      await typeIn('tm-i-dep-flat', t);
      const d = await page.evaluate(() => _tmDeposit());
      expect(d >= 0 && Number.isFinite(d), t + ' -> ' + d).toBe(true);
      expect(junk(await visibleText()), t).toBe(false);
    }
  });

  test('Sign here with the deposit over the limit stops him, the same as Send', async () => {
    await fresh({ addr: '9 Elm St, Worcester, MA 01608' });
    await say('set a tankless'); await page.evaluate(() => _geiScopeBuild('tm-scope-wrap'));
    await typeIn('tm-i-rate', '85'); await typeIn('tm-i-nte', '3000');
    await page.locator('#tm-dep-seg button', { hasText: 'Amount' }).tap();
    await typeIn('tm-i-dep-flat', '2500');
    const r = await page.evaluate(() => {
      const real = window.zConfirm; let seen = null;
      window.zConfirm = (m, y, o) => { seen = o && o.yes; };
      try { _geiSignInPerson(); } finally { window.zConfirm = real; }
      return { seen, sheet: !!document.getElementById('_gei-ip-ov') };
    });
    expect(r.seen).toBe('Lower the deposit');
    expect(r.sheet).toBe(false);
  });

  test('Tim, opened and closed ten times, never leaves a sheet stuck over the job', async () => {
    await fresh();
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { if (typeof openTim === 'function') openTim(); });
      await page.evaluate(() => { if (typeof closeTim === 'function') closeTim(); else document.querySelectorAll('#_tim-sheet,#_tim-ov').forEach(e => e.remove()); });
    }
    await page.waitForTimeout(400);
    const hit = await page.evaluate(() => {
      const r = document.getElementById('tm-dock-go').getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el && (el.id || el.closest('#tm-dock') ? 'dock' : el.className);
    });
    expect(hit).toBe('dock');
  });

  test('Earl never saw a console error', async () => { assertNoErrors(page, 'Earl'); });
});
