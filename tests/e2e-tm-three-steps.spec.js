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
    // One set of steps on every document (owner 2026-09-29, js/doc-steps.js).
    expect(r.title).toContain('Time');
  });

  test('a man working alone gets no chips, just his rate', async () => {
    await open({ solo: true });
    expect(await page.evaluate(() => document.getElementById('tm-who').innerHTML)).toBe('');
    expect(await shown('#tm-rate-row')).toBe(true);
    expect(await page.evaluate(() => document.getElementById('tm-step-2').textContent)).toContain('Time');
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
    expect(await page.evaluate(() => document.getElementById('tm-step-4').textContent)).toContain('Review');
    const sum = await page.evaluate(() => document.getElementById('tm-pay-sum').textContent);
    // Nothing is picked for him (owner 2026-09-29: "that can't default").
    expect(sum).toContain('No deposit, billing not picked');
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

  // CHANGED (§10.4). It used to start from his last T&M's cadence. Owner
  // 2026-09-29: "add in when you will bill, is it due on completion?
  // Remember that can't default." A pick carried over is a default.
  test('a new T&M starts with when-you-bill unpicked, whatever the last one used; a saved one keeps its pick', async () => {
    await open({ bids: [{ id: 1, isTM: true, tmBillingCycle: 'milestone' }] });
    const r = await page.evaluate(() => ({ cyc: _tmBillingCycle, lit: document.querySelectorAll('#tm-cad-main .ios-seg button.on').length,
      kept: _tmSavedCadence({ tmBillingCycle: 'completion' }), old: _tmSavedCadence({}), unpicked: _tmSavedCadence({ tmBillingCycle: '' }), junk: _tmSavedCadence({ tmBillingCycle: 'daily' }) }));
    expect(r).toEqual({ cyc: '', lit: 0, kept: 'completion', old: 'weekly', unpicked: '', junk: '' });
    expect(await page.evaluate(() => typeof _tmLastCadence)).toBe('undefined');
  });

  test('the contract never prints a billing schedule he did not pick', async () => {
    await open({ say: 'Set a tankless' });
    const r = await page.evaluate(async () => {
      let d = ''; const real = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
      return d;
    });
    expect(r).not.toMatch(/Billed weekly|Weekly invoices/);
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

  test('one set of steps on every document: T&M, Build Your Own and the invoice read the same names from one place', async () => {
    await open({ say: 'Set a tankless' });
    const r = await page.evaluate(async () => {
      const tm = [1, 2, 3, 4].map(n => document.querySelector('#tm-step-' + n + ' .t').textContent);
      clients.push({ id: 92002, name: 'Dana Pell', addr: '9 Oak St, Topeka, KS 66603' });
      openQuickInvoice(92002); await new Promise(r => setTimeout(r, 40));
      const qi = [...document.querySelectorAll('#qi-page .ios-stephead .t')].map(t => t.textContent);
      return { tm, qi, names: Object.values(DOC_STEP), shared: typeof docStepHead === 'function' && typeof docStepHtml === 'function' };
    });
    expect(r.tm).toEqual(['The work', 'Time', 'Materials', 'Review']);
    expect(r.names).toEqual(['The work', 'Time', 'Materials', 'Review']);
    expect(r.shared).toBe(true);
    // An invoice with nothing tracked is a set price: The work, What you did, Review.
    expect(r.qi[0]).toBe('The work');
    expect(r.qi[r.qi.length - 1]).toBe('Review');
  });

  // Owner 2026-09-29: "they all should be the same except BYO doesn't get
  // time; it gets scope and materials if applicable".
  test('Build Your Own: The work, Materials, Review, with no Time step', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      openGenericEstimate(getClientById(92001), null, null, { mode: 'byo' }); _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      _byoRenderSections(); _byoUpdateRail();
      return {
        steps: [1, 2, 3].map(n => (document.querySelector('#byo-step-' + n + ' .t') || {}).textContent),
        matState: document.getElementById('byo-step-2').getAttribute('data-state'),
        matInStep: !!document.querySelector('#byo-mat-wrap #mat-card'),
        oneCard: document.querySelectorAll('#gei-byo-page #mat-card').length,
      };
    });
    expect(r.steps).toEqual(['The work', 'Materials', 'Review']);
    expect(r.matState, 'optional, so never the step to do').toBe('todo');
    expect(r.matInStep).toBe(true);
    expect(r.oneCard).toBe(1);
  });

  test('Materials is optional on T&M: a row turns it on, then the row goes away', async () => {
    await open({ say: 'Set a tankless' });
    const before = await shown('#tm-mat-add');
    await page.locator('#tm-mat-add button').click();
    const r = await page.evaluate(() => ({ on: _tmLayers.has('mat'), state: document.getElementById('tm-step-3').getAttribute('data-state') }));
    expect(before).toBe(true);
    expect(r).toEqual({ on: true, state: 'done' });
    expect(await shown('#tm-mat-add')).toBe(false);
  });

  // ── Rooms on T&M: the same module Build Your Own uses (owner 2026-09-30) ──
  const TM_EMAIL = "Hi Tagen,\n\nHere's my estimate for the following work:\n\n- Rough in a surface-mounted washer box, including drain, water, and vent\n- Install 3 hose bibs with piping\n- Cap the gas line to the gas light out front and the existing washer lines\n- Seal ductwork, leaving enough open to keep the crawl space from freezing\n- Secure the tub spout\n\nI appreciate your faith and trust in our plumbing services.\n\nJohn Schonfeldt\nPlumbing Solutions by JS";
  const tmRooms = () => page.evaluate(() => {
    const out = {};
    _geiScopeChips.forEach(l => { const r = _tmRoomOf(l); (out[r] = out[r] || []).push(l); });
    return out;
  });

  test('rooms: a T&M walk that spans rooms is grouped by room on screen and on the customer copy', async () => {
    await open({ say: TM_EMAIL });
    const r = await tmRooms();
    expect(Object.keys(r)).toEqual(['Laundry room', 'Outside', 'Crawlspace', 'Bathroom']);
    expect(r['Laundry room']).toEqual(['Rough in a surface-mounted washer box: drain, water lines and vent', 'Cap the existing washer lines']);
    const ui = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('#tm-scope-wrap .room-name')].map(b => b.textContent.trim()),
      nums: [...document.querySelectorAll('#tm-scope-wrap .ios-num')].map(n => n.textContent),
      sort: [...document.querySelectorAll('#tm-scope-wrap button')].some(b => /work order/.test(b.textContent)),
    }));
    expect(ui.titles).toEqual(['Laundry room', 'Outside', 'Crawlspace', 'Bathroom']);
    expect(ui.nums).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ui.sort).toBe(false);
    const d = await page.evaluate(async () => {
      let h = ''; const o = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = x => { h = x; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = o; }
      return h;
    });
    expect(d.indexOf('Laundry room')).toBeGreaterThan(-1);
    expect(d.indexOf('Laundry room')).toBeLessThan(d.indexOf('Outside'));
    expect(d.indexOf('Crawlspace')).toBeLessThan(d.indexOf('Bathroom'));
    // Saved with the bid, so the rooms come back on the next open.
    const saved = await page.evaluate(() => { const b = {}; b.scopeChips = [..._geiScopeChips]; b.scopeRooms = _tmScopeRoomsSaved(); return b.scopeRooms['Secure the tub spout']; });
    expect(saved).toBe('Bathroom');
  });

  test('rooms: rename a room and drag a step into another, on T&M', async () => {
    await open({ say: TM_EMAIL });
    await page.locator('#tm-scope-wrap .room-name', { hasText: 'Crawlspace' }).click();
    await page.fill('#zprompt-inp', 'Basement');
    await page.click('#zprompt-ok');
    let r = await tmRooms();
    expect(Object.keys(r)).toEqual(['Laundry room', 'Outside', 'Basement', 'Bathroom']);
    const row = page.locator('#tm-scope-wrap .ios-swipe', { hasText: 'Secure the tub spout' });
    const target = page.locator('#tm-scope-wrap .ios-swipe', { hasText: 'Seal the ductwork' });
    await target.evaluate(e => e.scrollIntoView({ block: 'center' }));
    const a = await row.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    // The hold is 380ms; wait for the lift itself, not a guess at the clock.
    await page.waitForFunction(() => !!document.getElementById('room-drag-ghost'), null, { timeout: 3000 });
    const b = await target.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 8 });
    await page.mouse.up();
    r = await tmRooms();
    expect(r['Basement'][0]).toBe('Secure the tub spout');
    expect(r['Bathroom']).toBeUndefined();
    // Numbers follow the new order, one count down the page.
    const nums = await page.evaluate(() => [...document.querySelectorAll('#tm-scope-wrap .ios-num')].map(n => n.textContent));
    expect(nums).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  test('rooms: a one-room walk on T&M stays one numbered list', async () => {
    await open({ say: 'Replace the toilet, reset the vanity and caulk the tub' });
    const r = await page.evaluate(() => ({ on: _tmRoomsOn(), titles: document.querySelectorAll('#tm-scope-wrap .room-name').length }));
    expect(r).toEqual({ on: false, titles: 0 });
  });

  test('no console errors, T&M three steps', async () => {
    assertNoErrors(page, 'T&M three steps');
  });
});
