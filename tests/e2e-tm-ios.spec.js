// @ts-check
/**
 * The T&M screen, as an iPhone app.
 *
 * Owner, 2026-09-23: "is it premium like a true IOS app?" It was not: six
 * button styles, a box inside a box inside a box, a ✕ on every line and three
 * rows of chrome before the first field. Then: "So let's go do it."
 *
 * The makeover is the inset-grouped list iOS itself uses: one nav bar, one
 * tint, flat groups, rows removed by swiping or with Edit, and switches for
 * things that are on or off. These hold the parts of it that are behaviour
 * rather than paint, because paint is the easy part to lose to the next
 * change nobody thought was a design change.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the T&M screen, as an iPhone app', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const open = (said) => page.evaluate((s) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    document.body.classList.remove('dark');
    clients.length = 0; bids.length = 0;
    clients.push({ id: 91001, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603' });
    currentClientId = 91001;
    openTMEstimate(getClientById(91001));
    if (s) { document.getElementById('gei-scope-say').value = s; _geiScopeBuild('tm-scope-wrap'); }
  }, said || '');

  test('one nav bar: Back and Save, and no second row of buttons under the title', async () => {
    await open();
    const r = await page.evaluate(() => {
      const bar = document.getElementById('tm-topbar-wrap');
      return {
        buttons: [...bar.querySelectorAll('.ios-nav button')].map(b => b.textContent.trim()),
        oldRow: /Save draft|Cancel/.test(bar.textContent),
      };
    });
    expect(r.buttons).toEqual(['Back', 'Save']);
    expect(r.oldRow).toBe(false);
  });

  // An iOS title names the thing on the screen. "Proposal" named every screen
  // in this part of the app.
  test('the title is the customer until he names it', async () => {
    await open();
    const t = await page.evaluate(() => document.getElementById('tm-tbar-title').textContent);
    expect(t).toBe('Ray Whitcomb');
  });

  test('a step is removed by swiping it left and tapping Delete', async () => {
    await open('Pull the old water heater, run new pex to the manifold and set a tankless');
    const row = page.locator('#tm-scope-wrap .ios-swipe[data-kind="step"]').nth(1);
    await row.scrollIntoViewIfNeeded();
    const b = await row.boundingBox();
    if (!b) throw new Error('no row');
    await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width - 30 - i * 12, b.y + b.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const open1 = await page.evaluate(() => document.querySelectorAll('#tm-scope-wrap .ios-swipe.open').length);
    expect(open1, 'the swipe opened exactly one row').toBe(1);
    await page.locator('#tm-scope-wrap .ios-swipe.open .ios-del').click();
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips).toEqual(['Pull the old water heater', 'Set a tankless']);
  });

  // A tap is not a swipe. The row must not move for a finger that did not
  // travel, or every tap on "Add" would half-open the row under it.
  test('a tap does not open a row', async () => {
    await open('Pull the old water heater and set a tankless');
    const row = page.locator('#tm-scope-wrap .ios-swipe[data-kind="step"]').first();
    await row.click();
    const n = await page.evaluate(() => document.querySelectorAll('#tm-scope-wrap .ios-swipe.open').length);
    expect(n).toBe(0);
  });

  // For anyone who does not swipe: Edit puts a red minus on every row.
  test('Edit shows a minus on every step, and the minus removes it', async () => {
    await open('Pull the old water heater, run new pex to the manifold and set a tankless');
    await page.locator('#tm-scope-edit').click();
    const minus = await page.locator('#tm-scope-wrap .ios-swipe[data-kind="step"] .ios-minus').count();
    expect(minus).toBe(3);
    await page.locator('#tm-scope-wrap .ios-swipe[data-kind="step"] .ios-minus').first().click();
    const r = await page.evaluate(() => ({ chips: _geiScopeChips.slice(), label: document.getElementById('tm-scope-edit').textContent }));
    expect(r.chips).toEqual(['Run new pex to the manifold', 'Set a tankless']);
    expect(r.label, 'still in Edit until he says Done').toBe('Done');
    await page.locator('#tm-scope-edit').click();
    expect(await page.locator('#tm-scope-wrap .ios-minus').count()).toBe(0);
  });

  test('a forgotten step he does not need is swiped away, and Tim learns it', async () => {
    await open('Pull the old water heater and set a tankless');
    const before = await page.evaluate(() => _geiScopeMissed.map(m => m.id));
    expect(before.length).toBeGreaterThan(1);
    await page.evaluate(() => {
      document.querySelector('#tm-scope-wrap .ios-swipe[data-kind="missed"] .ios-del').click();
    });
    const after = await page.evaluate(() => _geiScopeMissed.map(m => m.id));
    expect(after).toEqual(before.slice(1));
    expect(await page.evaluate(() => _geiScopeChips.length), 'dismissing never adds it').toBe(2);
  });

  // ONE TINT. Send is filled, Sign it here is tinted, the rest are words. The
  // green and black slabs were three colours saying "press me" at once.
  // On the bar since 2026-09-23 (§10.4): the page's own copies are hidden on
  // a phone, so the bar's pair is what he sees.
  test('two buttons at the bottom, both in the one tint', async () => {
    await open('Pull the old water heater');
    await page.evaluate(() => { const e = document.getElementById('tm-i-rate'); e.value = '45'; _tmInputChange(); });
    const r = await page.evaluate(() => {
      const w = document.getElementById('tm-dock');
      const big = [...w.querySelectorAll('.ios-btn')];
      const tint = getComputedStyle(document.getElementById('gei-tm-page')).getPropertyValue('--ios-tint').trim();
      return {
        labels: big.map(b => b.textContent.trim()),
        fill: getComputedStyle(big[1]).backgroundColor,
        signText: getComputedStyle(big[0]).color,
        blue: getComputedStyle(document.body).getPropertyValue('--blue').trim(),
        tint,
      };
    });
    expect(r.labels).toEqual(['Sign here', 'Send it']);
    const rgb = (hex) => { const h = hex.replace('#', ''); return 'rgb(' + [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')'; };
    expect(r.fill).toBe(rgb(r.blue));
    expect(r.signText).toBe(rgb(r.blue));
  });

  // A thing that is on or off is a switch on an iPhone.
  test('More options are switches, and a switch turns its part on', async () => {
    await open('Pull the old water heater');
    const r = await page.evaluate(() => {
      _tmMoreOpen = true; _tmApplyLayers();
      const sw = document.querySelector('#tm-more-row input.ios-switch[data-layer="mat"]');
      const before = _tmLayers.has('mat');
      sw.click();
      const out = { kind: sw.type, before, after: _tmLayers.has('mat'),
        blk: document.getElementById('tm-blk-mat').style.display !== 'none' };
      _tmToggleLayer('mat'); _tmMoreOpen = false; _tmApplyLayers();
      return out;
    });
    expect(r).toEqual({ kind: 'checkbox', before: false, after: true, blk: true });
  });

  // White on the lighter blue dark mode uses measured under 3:1, so the filled
  // button takes a deeper blue there. Both themes clear 4.5:1.
  test('Send is readable in light and in dark', async () => {
    await open('Pull the old water heater');
    await page.evaluate(() => { const e = document.getElementById('tm-i-rate'); e.value = '45'; _tmInputChange(); });
    const ratios = await page.evaluate(() => {
      const lum = c => { const m = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = el => { const a = lum(getComputedStyle(el).color), b = lum(getComputedStyle(el).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const btn = document.querySelector('#tm-dock .ios-btn-fill');
      const light = ratio(btn);
      document.body.classList.add('dark');
      const dark = ratio(btn);
      document.body.classList.remove('dark');
      return { light, dark };
    });
    expect(ratios.light).toBeGreaterThanOrEqual(4.5);
    expect(ratios.dark).toBeGreaterThanOrEqual(4.5);
  });

  // ── TWO STEPS AND A BAR ───────────────────────────────────────────────────
  //
  // Owner, 2026-09-23: "it all looks like it runs together", then, of the
  // three big numbered sections that followed: "does it look like something
  // a pro UX designer would ship? I don't think so." Now: 1 The job and
  // 2 How it bills as headings, and step 3 is the bar pinned to the bottom of
  // the screen: Tim, and one button that is always the next thing.
  const steps = () => page.evaluate(() => {
    const h = n => { const el = document.getElementById('tm-step-' + n);
      return { state: el.getAttribute('data-state'), text: el.textContent.replace(/\s+/g, ' ').trim() }; };
    const d = document.getElementById('tm-dock');
    return [h(1), h(2), { state: d.getAttribute('data-state'),
      buttons: [...d.querySelectorAll('.ios-btn')].map(b => b.textContent.trim()) }];
  });
  const setRate = (v) => page.evaluate((r) => {
    const e = document.getElementById('tm-i-rate'); e.value = r; _tmInputChange();
  }, v);

  test('a fresh page: step 1 is on, and the bar says Build the steps', async () => {
    await open();
    await setRate('');
    const s = await steps();
    expect(s.map(x => x.state)).toEqual(['now', 'todo', 'todo']);
    // Nothing beside the heading: the box under it already says what to do.
    expect(s[0].text).toBe('1The job');
    expect(s[2].buttons).toEqual(['Build the steps']);
  });

  // The bar's button does the thing, not just name it: with words in the box
  // it builds the steps.
  test('Build the steps in the bar builds them from the box', async () => {
    await open();
    await page.evaluate(() => { document.getElementById('gei-scope-say').value = 'Pull the old water heater and set a tankless'; });
    await page.locator('#tm-dock-go').click();
    expect(await page.evaluate(() => _geiScopeChips.slice())).toEqual(['Pull the old water heater', 'Set a tankless']);
  });

  test('the job written: step 1 is checked with Edit beside it, and the bar asks for the rate', async () => {
    await open('Pull the old water heater and set a tankless');
    await setRate('');
    const s = await steps();
    expect(s[0].state).toBe('done');
    expect(s[0].text).toContain('Edit');
    expect(s[1].state).toBe('now');
    expect(s[2].buttons).toEqual(['Add your rate']);
    await page.locator('#tm-dock-go').click();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('tm-i-rate');
  });

  test('with a rate, step 2 is checked with its figure and the bar is Sign here and Send it', async () => {
    await open('Pull the old water heater and set a tankless');
    await setRate('45');
    const s = await steps();
    expect(s.map(x => x.state)).toEqual(['done', 'done', 'now']);
    expect(s[1].text).toContain('$45/hr');
    expect(s[2].buttons).toEqual(['Sign here', 'Send it']);
    // The bar names the next thing, so an optional field carries no tag.
    const tag = await page.evaluate(() => document.querySelectorAll('#tm-sec-bill .ios-tag').length);
    expect(tag).toBe(0);
  });

  // The law still marks its own field, in red, with the reason.
  test('a field the state requires is still marked where it is typed', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      clients.length = 0;
      clients.push({ id: 91002, name: 'Dana Pell', addr: '9 Elm St, Springfield, IL 62701' });
      currentClientId = 91002;
      openTMEstimate(getClientById(91002));
      _geiScopeChips = ['Set a tankless']; _renderScopeChips('tm-scope-wrap');
      const e = document.getElementById('tm-i-rate'); e.value = '45'; _tmInputChange();
    });
    const r = await page.evaluate(() => ({
      rule: _tmStateRule().rule,
      tags: [...document.querySelectorAll('#tm-sec-bill .ios-tag')].map(t => t.textContent),
      bar: [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()),
    }));
    expect(r.rule, 'Illinois requires the total cost').toBe('cap');
    expect(r.tags).toEqual(['Required here']);
    expect(r.bar).toEqual(['Add the most it can cost']);
  });

  // For Tim: "step 2" is one place, and he can ask whether it is done.
  test('Tim can go to a step by number and hear where it stands', async () => {
    await open('Pull the old water heater');
    await setRate('');
    const r = await page.evaluate(() => [_tmGoStep(1), _tmGoStep(2), _tmGoStep(3), _tmGoStep(9)]);
    expect(r).toEqual(['done', 'now', 'todo', null]);
  });

  // ── FULL SCREEN ───────────────────────────────────────────────────────────
  // The app's black bar over the page's own Back and Save, and the tab bar
  // and Tim's orb floating over the form, were two apps on one screen.
  test('while the T&M page is up, the app bars step aside, and come back after', async () => {
    await open('Pull the old water heater');
    const shown = () => page.evaluate(() => ['mobile-topbar', 'mobile-tabbar'].map(id => getComputedStyle(document.getElementById(id)).display));
    expect(await shown()).toEqual(['none', 'none']);
    await page.evaluate(() => { document.getElementById('gei-tm-page').style.display = 'none'; });
    expect((await shown()).every(d => d !== 'none'), 'the app bars came back').toBe(true);
    await page.evaluate(() => { document.getElementById('gei-tm-page').style.display = ''; });
  });

  // Pinned to the screen, not to the page: an animated ancestor once carried
  // it 1,000px down the page.
  test('the bar sits on the bottom edge of the screen', async () => {
    await open('Pull the old water heater');
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const b = document.getElementById('tm-dock').getBoundingClientRect();
      return { bottom: Math.round(b.bottom), vh: window.innerHeight, h: Math.round(b.height) };
    });
    expect(r.bottom).toBe(r.vh);
    expect(r.h).toBeGreaterThan(50);
  });

  test('no console errors on the iOS screen', async () => {
    assertNoErrors(page, 'T&M iOS');
  });
});
