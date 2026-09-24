// @ts-check
/**
 * Build Your Own, as the same iPhone editor as T&M.
 *
 * Owner, 2026-09-23: "now what about the BYO design, the true custom
 * estimate", then "go for it ... still want the ability to name the proposal
 * if wanted on both ... Still want them to show profit percentage", "customers
 * just want them to see the final estimate price", and on the wording: "yes go
 * with your price".
 *
 * What these hold:
 *  - One nav bar, the customer as the title, a visible pencil to name it.
 *  - Type it or Talk to Tim: the sentence becomes lines, priced from his own
 *    book when he has priced that work before, never from a guess.
 *  - Lines are rows: check, title, price; description full width under them.
 *  - The price group: their price, his cost and profit (never on the
 *    proposal), the deposit against the state limit.
 *  - The bar: Build the lines, Price every line, then Sign here / Send it.
 *  - The proposal: YOUR PRICE, fixed, moved only by a change order.
 *  - Earl, 58, on an iPhone SE, cannot break it.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SE = { width: 375, height: 667 };

test.describe('Build Your Own, as an iPhone editor', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const open = (o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_gei-ip-ov,#_byo-add-modal,.toast').forEach(e => e.remove());
    document.body.classList.remove('dark');
    bids.length = 0; clients.length = 0;
    clients.push({ id: 96001, name: 'Ray Whitcomb', addr: o.addr || '412 Bell St, Topeka, KS 66603' });
    currentClientId = 96001;
    _activeTrade = 'plumbing';
    if (typeof S !== 'undefined') {
      S.priceBook = S.priceBook || {};
      S.priceBook.plumbing = (o.book || []).map(b => Object.assign({ unit: 'ea', n: 3 }, b));
      // His standard deposit is remembered between jobs; each test starts
      // from the same one.
      S.depositPct = 25;
    }
    openGenericEstimate(getClientById(96001), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
    window.scrollTo(0, 0);
  }, o || {});
  const say = (t) => page.evaluate((t) => { document.getElementById('byo-say').value = t; _byoSayBuild(); }, t);
  const bar = () => page.evaluate(() => [...document.querySelectorAll('#byo-dock .ios-btn')].map(b => b.textContent.trim()));
  const priceAll = (n) => page.evaluate((n) => { _byoItems.forEach(it => { if (!(it.price > 0)) { it.price = n; it.rate = n; } }); _byoRenderSections(); _byoUpdateRail(); }, n);
  const doc = () => page.evaluate(async () => {
    let d = ''; const o = window._showProposalPreviewOverlay;
    window._showProposalPreviewOverlay = h => { d = h; };
    try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = o; }
    return d;
  });

  // ── THE TOP ───────────────────────────────────────────────────────────────

  test('one nav bar, the customer as the title, and a pencil to name it', async () => {
    await open();
    const r = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('#byo-topbar-wrap .ios-nav button')].map(b => b.textContent.trim()),
      nav: document.querySelector('#byo-topbar-wrap .ios-navtitle').textContent,
      title: document.getElementById('byo-tbar-title').textContent,
      pencil: !!document.querySelector('#byo-topbar-wrap .ios-rename'),
      appBars: ['mobile-topbar', 'mobile-tabbar'].map(id => getComputedStyle(document.getElementById(id)).display),
    }));
    expect(r.buttons).toEqual(['Back', 'Save']);
    expect(r.nav).toBe('Build Your Own');
    expect(r.title).toBe('Ray Whitcomb');
    expect(r.pencil).toBe(true);
    expect(r.appBars).toEqual(['none', 'none']);
  });

  test('he can name it, and clearing the name gives the customer back', async () => {
    await open();
    await page.locator('#byo-edit-title-btn').tap();
    await page.locator('#byo-tbar-title input').fill('Basement water heater');
    await page.locator('#byo-tbar-title input').press('Enter');
    expect(await page.evaluate(() => document.getElementById('byo-tbar-title').textContent)).toBe('Basement water heater');
    await page.locator('#byo-edit-title-btn').tap();
    await page.locator('#byo-tbar-title input').fill('');
    await page.locator('#byo-tbar-title input').press('Enter');
    expect(await page.evaluate(() => ({ t: document.getElementById('byo-tbar-title').textContent, set: _geiDescUserSet })))
      .toEqual({ t: 'Ray Whitcomb', set: false });
  });

  test('T&M has the same pencil', async () => {
    const r = await page.evaluate(() => {
      bids.length = 0; openTMEstimate(getClientById(96001));
      return !!document.querySelector('#tm-topbar-wrap .ios-rename');
    });
    expect(r).toBe(true);
  });

  // ── THE WORK ──────────────────────────────────────────────────────────────

  test('the bar says Build the lines until there are some', async () => {
    await open();
    expect(await bar()).toEqual(['Build the lines']);
  });

  test('a sentence becomes lines, priced from his own book where he has priced it before', async () => {
    await open({ book: [{ desc: 'Pull the old water heater', rate: 450 }] });
    await say('pull the old water heater, set a 50 gallon power vent');
    const r = await page.evaluate(() => _byoItems.map(it => [it.label, it.price]));
    expect(r).toEqual([['Pull the old water heater', 450], ['Set a 50 gallon power vent', 0]]);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#byo-sections .byo-line .ios-fact')].map(e => e.textContent));
    expect(rows).toEqual(['$450', 'Add price']);
  });

  // A guessed number on a contract is worse than a blank that asks.
  test('a line he has never priced is never given a guessed price', async () => {
    await open();
    await say('run new gas line to the heater');
    expect(await page.evaluate(() => _byoItems.map(it => it.price))).toEqual([0]);
  });

  test('what he left out comes back as lines he can add, all at once', async () => {
    await open();
    await say('pull the old water heater and set a tankless');
    const before = await page.evaluate(() => _byoItems.length);
    const missed = await page.evaluate(() => _byoMissed.length);
    expect(missed).toBeGreaterThan(1);
    await page.evaluate(() => _byoTakeAllMissed());
    const r = await page.evaluate(() => ({ n: _byoItems.length, left: _byoMissed.map(m => m.id).sort(), labels: _byoItems.map(x => x.label) }));
    // 2026-09-23 (§10.4, owner): the permit is his call ("not every job
    // requires a permit") and the unit is his to name, so Add all leaves both.
    expect(r.left).toEqual(['access-permit', 'detail-model']);
    expect(r.n).toBe(before + missed - 2);
    expect(new Set(r.labels).size).toBe(r.labels.length);
  });

  test('the bar walks him to the unpriced line, then offers Sign here and Send it', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    expect(await bar()).toEqual(['Price every line']);
    await priceAll(900);
    expect(await bar()).toEqual(['Sign here', 'Send it']);
  });

  test('a line swiped away by a fat thumb comes back with Undo', async () => {
    await open();
    await say('pull the old water heater, run new pex, set a tankless');
    await page.evaluate(() => document.querySelectorAll('#byo-sections .ios-swipe[data-kind="line"] .ios-del')[1].click());
    expect(await page.evaluate(() => _byoItems.map(x => x.label))).toEqual(['Pull the old water heater', 'Set a tankless']);
    await page.locator('.toast .tm-undo').tap();
    expect(await page.evaluate(() => _byoItems.map(x => x.label))).toEqual(['Pull the old water heater', 'Run new pex', 'Set a tankless']);
  });

  test('a new job is one plain list, no section headings', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    expect(await page.evaluate(() => [...document.querySelectorAll('#byo-sections .ios-h')].filter(h => h.offsetParent).length)).toBe(0);
  });

  // ── THE PRICE ─────────────────────────────────────────────────────────────

  test('his cost gives him his profit, on this screen only', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    await priceAll(1000);
    await page.locator('#byo-cost-in').fill('1300');
    await page.locator('#byo-cost-in').dispatchEvent('input');
    const r = await page.evaluate(() => document.getElementById('byo-profit-val').textContent);
    expect(r).toBe('35% · $700');
    const d = await doc();
    expect(d).not.toContain('1,300');
    expect(d).not.toMatch(/profit/i);
  });

  test('the deposit is a percent with its dollars, held to the state limit', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608' });
    await say('pull the old water heater, set a tankless');
    await priceAll(1500);
    await page.locator('#byo-dep-in').fill('50');
    await page.locator('#byo-dep-in').dispatchEvent('input');
    await page.locator('#byo-dep-in').blur();
    await page.evaluate(() => _byoRenderSteps());
    const r = await page.evaluate(() => ({ pct: _geiDepositPct(), note: document.getElementById('byo-dep-note').textContent }));
    expect(r.pct).toBe(50);
    expect(r.note).toContain('Massachusetts allows up to');
    expect(await bar()).toEqual(['Lower the deposit']);
  });

  // ── WHAT THEY GET ─────────────────────────────────────────────────────────

  test('the proposal is one fixed price, never the line prices', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    await priceAll(1250);
    const d = await doc();
    expect(d).toContain('YOUR PRICE');
    expect(d).toContain('Fixed price for the work listed. Anything added or changed is a change order you sign.');
    expect(d).toContain('$2,500');
    expect(d).not.toContain('$1,250');
    expect(d).toContain('Pull the old water heater');
  });

  // ── EARL ──────────────────────────────────────────────────────────────────

  test('Earl: every control is big enough for his thumb', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    await priceAll(800);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#gei-byo-page .split-est > div:first-child button, #gei-byo-page .split-est > div:first-child input, #byo-topbar-wrap button, #byo-dock button').forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('[style*="display: none"]') || el.classList.contains('ios-del')) return;
        const row = el.tagName === 'INPUT' ? el.closest('.ios-row') : null;
        const rr = row ? row.getBoundingClientRect() : r;
        if (rr.height < 44 || rr.width < 44) out.push((el.id || el.textContent.trim().slice(0, 20) || el.className) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height));
      });
      return out;
    });
    expect(small).toEqual([]);
  });

  test('Earl: a double tap on Build the lines never sends anything', async () => {
    await open({ book: [{ desc: 'Pull the old water heater', rate: 450 }, { desc: 'Set a tankless', rate: 3200 }] });
    await page.evaluate(() => { document.getElementById('byo-say').value = 'pull the old water heater, set a tankless'; });
    await page.locator('#byo-dock-go').tap();
    await page.locator('#byo-dock-go').tap().catch(() => {});
    const r = await page.evaluate(() => ({ lines: _byoItems.length, sent: !!document.getElementById('_gei-send-overlay') }));
    expect(r).toEqual({ lines: 2, sent: false });
  });

  test('Earl: junk in his cost and the deposit never shows as junk', async () => {
    await open();
    await say('set a tankless');
    await priceAll(3000);
    for (const t of ['abc', '-500', '$$$', '12.5.6']) {
      await page.locator('#byo-cost-in').fill(t); await page.locator('#byo-cost-in').dispatchEvent('input');
      await page.locator('#byo-dep-in').fill(t); await page.locator('#byo-dep-in').dispatchEvent('input');
      const txt = await page.evaluate(() => document.getElementById('gei-byo-page').innerText + document.getElementById('byo-dock').innerText);
      expect(/\bNaN\b|\bundefined\b|\bInfinity\b/.test(txt), t).toBe(false);
    }
  });

  test('Earl: with Display Zoom and a long line, nothing runs off the side', async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    try {
      await open();
      await say('replace the entire run of galvanized from the meter all the way back to the water heater including every fitting behind the finished basement wall');
      await priceAll(12345);
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(r.sw).toBeLessThanOrEqual(r.cw);
    } finally { await page.setViewportSize(SE); }
  });

  test('no console errors', async () => { assertNoErrors(page, 'BYO iOS'); });
});
