// @ts-check
// ── T&M in three steps: The job, Who's going, Getting paid ───────────────────
//
// Owner 2026-09-29: "I find myself going back-and-forth all over the page from
// when the payment is due, if it's due on completion or upfront ... how many
// people were on the job, it just doesn't seem smooth yet." And, on Jack and
// John: John has no app, the customer never sees names, just "2 techs".
//
//   1 The job        Tim's list of what he did not say folds to one line.
//   2 Who's going    tap the people; that IS the head count and the hourly
//                    rate (the sum of their rates). Anyone without a rate gets
//                    an orange Rate? and the bar asks for it by name.
//   3 Getting paid   one filled-in line, tap to change. Opens on its own only
//                    when the state's law needs something in it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const JACK = 'jack@ts.test';
const JOHN = 'john@ts.test';

test.describe('T&M in three steps', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const open = (o) => page.evaluate(([j, h, opt]) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    S.ownerName = 'Logan Sample'; S.ownerBillRate = 110; S.ownerPayRate = 40; S.ownerPayType = 'hourly';
    S.employees = opt.solo ? [] : [
      { name: 'Jack Miller', email: j, role: 'Apprentice', pay_type: 'hourly', pay_rate: 22, billRate: 90 },
      { name: 'John Sample', email: h, role: 'Plumber' },
    ];
    _estCrew = []; _estCrewRates = {};
    clients.length = 0; bids.length = 0;
    (opt.bids || []).forEach(b => bids.push(b));
    clients.push({ id: 92001, name: 'Ray Whitcomb', addr: opt.addr || '412 Bell St, Topeka, KS 66603' });
    currentClientId = 92001;
    openTMEstimate(getClientById(92001));
    if (opt.say) { document.getElementById('gei-scope-say').value = opt.say; _geiScopeBuild('tm-scope-wrap'); }
  }, [JACK, JOHN, o || {}]);

  const shown = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s); return !!e && e.getClientRects().length > 0;
  }, sel);

  // ── 2 Who's going ─────────────────────────────────────────────────────────
  test('the owner and every employee are chips, owner first', async () => {
    await open();
    const r = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('#tm-who .tm-who-chip')].map(b => b.textContent.trim()),
      title: document.getElementById('tm-step-2').textContent,
    }));
    expect(r.chips).toEqual(['Logan', 'Jack', 'John']);
    expect(r.title).toContain("Who's going");
  });

  test('a man working alone gets no chips, just his rate', async () => {
    await open({ solo: true });
    expect(await page.evaluate(() => document.getElementById('tm-who').innerHTML)).toBe('');
    expect(await shown('#tm-rate-row')).toBe(true);
    expect(await page.evaluate(() => document.getElementById('tm-step-2').textContent)).toContain('Your rate');
  });

  test('picking the crew sets the head count and the hour, and hides both old fields', async () => {
    await open();
    await page.locator('#tm-who .tm-who-chip', { hasText: 'Logan' }).tap();
    await page.locator('#tm-who .tm-who-chip', { hasText: 'Jack' }).tap();
    const r = await page.evaluate(() => ({ n: _tmCrewCount, hr: _tmHourlyBill(), status: document.getElementById('tm-step-2').textContent }));
    expect(r.n).toBe(2);
    expect(r.hr).toBe(200);
    expect(r.status).toContain('2 people · $200/hr');
    expect(await shown('#tm-rate-row')).toBe(false);
    expect(await shown('#tm-crew-row')).toBe(false);
  });

  test('tapping a picked chip takes them off', async () => {
    await open();
    const chip = page.locator('#tm-who .tm-who-chip', { hasText: 'Jack' });
    await chip.tap();
    await page.locator('#tm-who .tm-who-chip', { hasText: 'Jack' }).tap();
    expect(await page.evaluate(() => _estCrew.slice())).toEqual([]);
    expect(await shown('#tm-rate-row')).toBe(true);
  });

  test('someone with no rate gets Rate?, and the bar asks for it by name', async () => {
    await open({ say: 'Set a tankless' });
    await page.evaluate(() => { _geiScopeMissed = []; _renderScopeChips('tm-scope-wrap'); });
    await page.locator('#tm-who .tm-who-chip', { hasText: 'John' }).tap();
    const r = await page.evaluate(() => ({
      need: [...document.querySelectorAll('#tm-who .qi-rate.need input')].map(i => i.placeholder),
      bar: [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()),
    }));
    expect(r.need).toEqual(['Rate?']);
    expect(r.bar).toEqual(["Add John's rate"]);
  });

  test('the rate typed there is saved on the person, so it is asked once', async () => {
    await open();
    await page.locator('#tm-who .tm-who-chip', { hasText: 'John' }).tap();
    const inp = page.locator('#tm-who .qi-rate.need input');
    await inp.fill('85');
    await inp.dispatchEvent('change');
    const r = await page.evaluate((h) => ({ onPerson: S.employees.find(e => e.email === h).billRate, hr: _tmHourlyBill(), need: document.querySelectorAll('#tm-who .qi-rate.need').length }), JOHN);
    expect(r).toEqual({ onPerson: 85, hr: 85, need: 0 });
  });

  test('junk in a crew rate is refused, never a negative or NaN hour', async () => {
    await open();
    await page.locator('#tm-who .tm-who-chip', { hasText: 'John' }).tap();
    for (const junk of ['abc', '-50', '$$', '']) {
      const r = await page.evaluate(([h, v]) => { _tmWhoRate({ value: v }, h); return _billRateFor(h); }, [JOHN, junk]);
      expect(r >= 0 && Number.isFinite(r), junk).toBe(true);
    }
  });

  // ── What the customer reads ────────────────────────────────────────────────
  test('the customer reads "2 techs", never a name', async () => {
    await open();
    await page.evaluate(() => {
      _tmAddLayer('est');
      _toggleCrewMember(_tmOwnerKey()); _toggleCrewMember('jack@ts.test');
      document.getElementById('tm-i-days').value = '2'; _tmInputChange();
    });
    const line = await page.evaluate(() => (_geiLines.find(l => l._tmLabor) || {}).desc);
    expect(line).toBe('Labor: 2 techs · $200/hr on site');
    expect(line).not.toMatch(/Logan|Jack/);
  });

  test('the owner on the crew is costed at his own loaded rate', async () => {
    await open();
    const r = await page.evaluate(() => {
      _tmAddLayer('est');
      _toggleCrewMember(_tmOwnerKey());
      document.getElementById('tm-i-days').value = '1'; _tmInputChange();
      return { cost: _estLaborCost(), own: Math.round(8 * _ownerLoadedHourly()) };
    });
    expect(r.own).toBeGreaterThan(0);
    expect(r.cost).toBe(r.own);
  });

  test('the rail states the cost but has no second set of crew chips', async () => {
    await open();
    await page.evaluate(() => _toggleCrewMember('jack@ts.test'));
    const r = await page.evaluate(() => (document.getElementById('tm-labor-cost-wrap') || {}).textContent || '');
    expect(r).not.toContain('+ Jack');
    expect(r).not.toContain('− Jack');
  });

  // ── 3 Getting paid ────────────────────────────────────────────────────────
  test('Getting paid is one filled-in line until he taps it', async () => {
    await open();
    expect(await page.evaluate(() => document.getElementById('tm-step-3').textContent)).toContain('Getting paid');
    const sum = await page.evaluate(() => document.getElementById('tm-pay-sum').textContent);
    expect(sum).toContain('No deposit, bills weekly');
    expect(await shown('#tm-dep-row')).toBe(false);
    await page.locator('#tm-pay-btn').tap();
    expect(await shown('#tm-dep-row')).toBe(true);
    await page.locator('#tm-pay-btn').tap();
    expect(await shown('#tm-dep-row')).toBe(false);
  });

  test('a deposit and a cadence show up in the line', async () => {
    await open();
    await page.locator('#tm-pay-btn').tap();
    await page.locator('#tm-dep-seg button', { hasText: 'Amount' }).tap();
    await page.locator('#tm-i-dep-flat').fill('500');
    await page.evaluate(() => { _tmInputChange(); _tmCadence('completion'); _tmRenderBillTerms(); });
    expect(await page.evaluate(() => document.getElementById('tm-pay-sum').textContent)).toContain('$500 deposit, bills at the end');
  });

  test('a new T&M bills the way his last one did', async () => {
    await open({ bids: [{ id: 1, isTM: true, tmBillingCycle: 'milestone' }, { id: 2, isTM: false, tmBillingCycle: 'completion' }] });
    expect(await page.evaluate(() => _tmBillingCycle)).toBe('milestone');
    await open({ bids: [] });
    expect(await page.evaluate(() => _tmBillingCycle)).toBe('weekly');
  });

  test('a state that requires the limit opens Getting paid on its own', async () => {
    await open({ addr: '9 Elm St, Springfield, IL 62701', say: 'Set a tankless' });
    await page.evaluate(() => { const e = document.getElementById('tm-i-rate'); e.value = '45'; _tmInputChange(); });
    expect(await page.evaluate(() => document.getElementById('tm-pay-group').classList.contains('open'))).toBe(true);
    expect(await shown('#tm-i-nte')).toBe(true);
  });

  // ── 1 The job: Tim folds ──────────────────────────────────────────────────
  test("Tim's list is one line: count, Add all, Review", async () => {
    await open({ say: 'pull the old water heater and set a tankless' });
    const r = await page.evaluate(() => ({
      open: document.querySelector('#tm-scope-wrap .ios-tim').classList.contains('open'),
      rows: [...document.querySelectorAll('#tm-scope-wrap .ios-tim > .ios-swipe')].filter(e => e.getClientRects().length).length,
      head: document.querySelector('#tm-scope-wrap .ios-tim-h').textContent,
    }));
    expect(r.open).toBe(false);
    expect(r.rows).toBe(0);
    expect(r.head).toMatch(/You did not say\d+ things · Review/);
    await page.locator('#tm-scope-wrap .ios-tim-h .who').tap();
    expect(await page.evaluate(() => [...document.querySelectorAll('#tm-scope-wrap .ios-tim > .ios-swipe')].filter(e => e.getClientRects().length).length)).toBeGreaterThan(0);
    await page.evaluate(() => { _timMissOpen = false; });
  });

  test('what only he can answer stays open after Add all', async () => {
    await open({ say: 'pull the old water heater and set a tankless' });
    await page.locator('#tm-scope-wrap button', { hasText: /^Add all/ }).tap();
    expect(await page.evaluate(() => document.querySelector('#tm-scope-wrap .ios-tim').classList.contains('open'))).toBe(true);
  });

  // ── Layout ────────────────────────────────────────────────────────────────
  test('no horizontal bleed at 390 with a full crew and Getting paid open', async () => {
    await open();
    await page.evaluate(() => { _toggleCrewMember(_tmOwnerKey()); _toggleCrewMember('jack@ts.test'); _toggleCrewMember('john@ts.test'); _tmPayOpen = true; _tmRenderPay(); });
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth,
      right: Math.max(...[...document.querySelectorAll('#tm-who .tm-who-chip, #tm-who .qi-rate')].map(e => e.getBoundingClientRect().right)) }));
    expect(r.sw).toBeLessThanOrEqual(r.w + 1);
    expect(r.right).toBeLessThanOrEqual(r.w);
  });

  test('no console errors, T&M three steps', async () => {
    assertNoErrors(page, 'T&M three steps');
  });
});
