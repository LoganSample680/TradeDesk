// @ts-check
/**
 * What he says on the walk feeds the proposal, and none of it is lost.
 *
 * Owner, 2026-09-26: "do we do voice notes to feed a proposal, that way
 * everything that is said is captured and scoped?" ... "we got this in the
 * way, this is rotted, all those small things that really matter later".
 *
 * Before: every piece of what he said became a numbered step on the contract,
 * remarks included ("The floor under it is rotted, probably from the leak"),
 * and the words themselves were never kept. Now:
 *  - what he will DO is a step; an action riding in a remark is lifted out;
 *  - what he SAW or was TOLD is a note he places: on the proposal (What we
 *    found), for the crew, or nowhere; the bar will not reach Send until each
 *    one is placed;
 *  - every walk is kept word for word on the bid.
 *
 * And T&M materials (owner: "material totals add like they do in BYO but they
 * don't surface in the proposal itself"): the supply house card is on the T&M
 * screen, its totals are his, and the proposal and the amount the customer
 * sees carry none of it.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const WALK = "Okay so we're in the basement, the old water heater is here, we got the furnace in the way so we'll have to move that return duct. The floor under it is rotted, probably from the leak. Pull the old water heater, set a tankless on the wall by the panel. Homeowner wants the shutoff where she can reach it. Gas line looks like half inch, and there's no drain close so we'll need a condensate pump.";

test.describe('walk notes', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const openTM = (id, said) => page.evaluate(({ id, said }) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
    currentClientId = id; _activeTrade = 'plumbing';
    openTMEstimate(getClientById(id));
    if (said != null) { document.getElementById('gei-scope-say').value = said; _geiScopeBuild('tm-scope-wrap'); }
  }, { id, said });
  const doc = () => page.evaluate(async () => {
    let d = ''; const real = window._showProposalPreviewOverlay;
    window._showProposalPreviewOverlay = h => { d = h; };
    try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
    const el = document.createElement('div'); el.innerHTML = d; return el.innerText;
  });

  test('what he will do is a step; what he saw or was told is a note', async () => {
    const r = await page.evaluate((s) => { const b = timScopeBuild(s, { rejected: [] }); return { steps: b.steps.map(x => x.text), notes: b.notes.map(n => n.text), damage: b.notes.filter(n => n.damage).map(n => n.text), asked: b.notes.filter(n => n.asked).map(n => n.text) }; }, WALK);
    expect(r.steps).toEqual(['Move the return duct', 'Pull the old water heater', 'Set a tankless on the wall by the panel', 'Install a condensate pump']);
    expect(r.notes).toContain('The floor under it is rotted, probably from the leak');
    expect(r.notes).toContain('Homeowner wants the shutoff where she can reach it');
    expect(r.notes).toContain("Gas line looks like half inch, and there's no drain close");
    expect(r.damage).toContain('The floor under it is rotted, probably from the leak');
    expect(r.asked).toEqual(['Homeowner wants the shutoff where she can reach it']);
  });

  test('a place is not a system: "by the panel" is not panel work; the furnace in the way is not a furnace job', async () => {
    const ids = await page.evaluate((s) => timScopeBuild(s, { rejected: [] }).implied.map(i => i.id), WALK);
    expect(ids).not.toContain('finish-circuits');
    expect(ids).not.toContain('finish-startup');
    // He only said what the gas line LOOKS like, so Tim still has him check it.
    expect(ids).toContain('install-gas-size');
  });

  test('a plain job with no remarks is unchanged: every piece is a step', async () => {
    const r = await page.evaluate(() => { const b = timScopeBuild('Pull the old water heater, run new pex to the manifold and set a tankless', { rejected: [] }); return { steps: b.steps.map(x => x.text), notes: b.notes.length }; });
    expect(r.steps).toEqual(['Pull the old water heater', 'Run new pex to the manifold', 'Set a tankless']);
    expect(r.notes).toBe(0);
  });

  test('every note must be placed before Send; each place does what it says', async () => {
    await openTM(99901, WALK);
    await page.evaluate(() => { _geiScopeMissed.length = 0; _renderScopeChips('tm-scope-wrap'); });
    const bar = () => page.evaluate(() => [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()));
    expect(await bar()).toEqual(['Place 4 things you said']);
    // Damage leads the list.
    const first = await page.evaluate(() => _geiNotes[0]);
    expect(first.damage).toBe(true);
    const rows = await page.evaluate(() => document.querySelectorAll('#gei-tm-page .ios-said').length);
    expect(rows).toBe(4);
    await page.evaluate(() => {
      const at = re => _geiNotes.findIndex(n => re.test(n.text));
      _geiNotePlace(at(/rotted/), 'found');
      _geiNotePlace(at(/shutoff/), 'found');
      _geiNotePlace(at(/Gas line/), 'crew');
      _geiNotePlace(at(/basement/), 'no');
    });
    expect(await bar()).toEqual(['Check your rate']);
    const crew = await page.evaluate(() => getSiteNote(getClientById(99901), _geiSiteAddr()));
    expect(crew).toContain("Gas line looks like half inch");
    const t = await doc();
    expect(t).toContain('What we found');
    expect(t).toContain('The floor under it is rotted, probably from the leak');
    expect(t).toContain('Homeowner wants the shutoff where she can reach it');
    // Crew only and No never reach the customer.
    expect(t).not.toContain('Gas line looks like half inch');
    expect(t).not.toContain('in the way');
    // And no remark is a numbered step.
    expect(t).toContain('Install a condensate pump');
    expect(t).not.toMatch(/floor under it is rotted[^\n]*\n[^\n]*Pull the old/);
  });

  test('every walk is kept word for word on the bid, and comes back when the draft opens again', async () => {
    await openTM(99902, WALK);
    await page.evaluate(() => { const el = document.getElementById('gei-scope-say'); if (el) { el.value = 'Also the shutoff valve by the dryer is seized'; _geiScopeBuild('tm-scope-wrap'); } });
    const saved = await page.evaluate(() => { saveGenericEstimate(true); const b = bids.find(x => x.id === _geiEditBidId); return { id: b.id, walks: (b.walkNotes || []).map(w => w.said), pending: (b.notesToPlace || []).length }; });
    expect(saved.walks[0]).toBe(WALK);
    expect(saved.walks.length).toBeGreaterThanOrEqual(1);
    expect(saved.pending).toBeGreaterThanOrEqual(4);
    // Open it again: the walks and the unplaced notes are back.
    const back = await page.evaluate((id) => { const b = bids.find(x => x.id === id); openGenericEstimate(getClientById(99902), id); return { walks: _geiWalk.length, notes: _geiNotes.length }; }, saved.id);
    expect(back.walks).toBe(saved.walks.length);
    expect(back.notes).toBe(saved.pending);
    // What you said is one tap away.
    await page.evaluate(() => { _geiWalkOpen = true; _geiRepaintScope(); });
    const shown = await page.evaluate(() => [...document.querySelectorAll('#gei-tm-page .ios-walk .ios-lbl')].map(e => e.textContent));
    expect(shown.some(x => x.includes('The floor under it is rotted'))).toBe(true);
  });

  test('BYO: the same notes, the same card, the same What we found', async () => {
    const r = await page.evaluate((s) => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      clients.length = 0; bids.length = 0;
      clients.push({ id: 99903, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
      currentClientId = 99903; _activeTrade = 'plumbing';
      S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [];
      openGenericEstimate(getClientById(99903), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      document.getElementById('byo-say').value = s; _byoSayBuild();
      return { lines: _byoItems.map(x => x.label), notes: _geiNotes.length, rows: document.querySelectorAll('#gei-byo-page .ios-said').length };
    }, WALK);
    expect(r.lines).toEqual(expect.arrayContaining(['Pull the old water heater', 'Install a condensate pump']));
    expect(r.lines.some(l => /rotted/.test(l)), 'a remark is not a priced line').toBe(false);
    expect(r.notes).toBe(4);
    expect(r.rows).toBe(4);
    await page.evaluate(() => { _geiNotePlace(_geiNotes.findIndex(n => /rotted/.test(n.text)), 'found'); });
    expect(await doc()).toContain('The floor under it is rotted, probably from the leak');
  });

  test('T&M: the supply house card is on the screen, its totals are his, and the proposal carries none of it', async () => {
    await openTM(99904, null);
    await page.evaluate(() => { _geiScopeChips = ['Set a tankless']; _renderScopeChips('tm-scope-wrap');
      const h = _supHost(true); h._supply.items = [{ qty: 1, unit: 'ea', desc: 'Navien NPE-240A', cost: 1650, on: true }, { qty: 3, unit: 'ea', desc: '3/4 ball valve', cost: 21.5, on: true }]; h._supply.markup = 20; _supSync(); });
    const card = await page.evaluate(() => document.getElementById('tm-sup-wrap').innerText.replace(/\s+/g, ' '));
    expect(card).toContain('Supply house');
    expect(card).toContain('Your cost $1,671.50');
    expect(card).toContain('Billed at your markup $2,005.80');
    const t = await doc();
    expect(t).not.toMatch(/Navien|ball valve|2,005|1,671|supply house/i);
    const saved = await page.evaluate(() => { saveGenericEstimate(true); const b = bids.find(x => x.id === _geiEditBidId); return { amount: b.amount, supply: b.tmSupplyTotal }; });
    expect(saved.amount, 'the amount the customer sees').toBe(0);
    expect(saved.supply).toBeCloseTo(2005.8, 2);
  });

  // ── THE iOS REDESIGN (owner, 2026-09-26: "Go for the iOS redesign") ─────
  test('a remark is placed from an iOS action sheet, and the bar walks every one in turn', async () => {
    await openTM(99905, WALK);
    await page.evaluate(() => { _geiScopeMissed.length = 0; _renderScopeChips('tm-scope-wrap'); });
    // One row per remark, no buttons under it: tap for the sheet, swipe for No.
    const row = await page.evaluate(() => { const r = document.querySelector('#gei-tm-page .ios-said'); return { btns: r.querySelectorAll('.ios-pill').length, del: r.querySelector('.ios-del').textContent }; });
    expect(row).toEqual({ btns: 0, del: 'No' });
    await page.waitForTimeout(750);
    await page.locator('#tm-dock-go').click();
    await page.waitForTimeout(350);
    const sheet = await page.evaluate(() => { const s = document.getElementById('_ios-as'); return s ? [...s.querySelectorAll('.ios-as-btn')].map(b => b.textContent) : null; });
    expect(sheet).toEqual(['On the proposal', 'Crew only', 'Not needed', 'Cancel']);
    // Four remarks, four sheets, one after the next.
    for (let i = 0; i < 4; i++) {
      await page.locator('#_ios-as .ios-as-btn', { hasText: i === 0 ? 'On the proposal' : 'Not needed' }).click();
      await page.waitForTimeout(350);
    }
    expect(await page.evaluate(() => ({ left: _geiNotes.length, found: _geiFound.length, sheet: !!document.getElementById('_ios-as') }))).toEqual({ left: 0, found: 1, sheet: false });
  });

  test('Cancel and a tap outside place nothing', async () => {
    await openTM(99906, WALK);
    await page.evaluate(() => _geiNoteSheet(0));
    await page.waitForTimeout(300);
    await page.locator('#_ios-as .ios-as-cancel').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => _geiNoteSheet(0));
    await page.waitForTimeout(300);
    await page.mouse.click(196, 60);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => ({ left: _geiNotes.length, sheet: !!document.getElementById('_ios-as') }))).toEqual({ left: 4, sheet: false });
  });

  test('BYO: "Usually goes with this" is inside Tim\'s card, with what Tim already asks left out', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      clients.length = 0; bids.length = 0;
      clients.push({ id: 99907, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
      currentClientId = 99907; _activeTrade = 'plumbing';
      S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [];
      openGenericEstimate(getClientById(99907), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      document.getElementById('byo-say').value = 'Pull the old water heater and set a tankless'; _byoSayBuild();
      const pg = document.getElementById('gei-byo-page');
      return {
        timCards: pg.querySelectorAll('.ios-tim').length,
        oldCard: [...pg.querySelectorAll('.card-hd-title')].some(e => /Usually goes with this/.test(e.textContent)),
        inTim: [...pg.querySelectorAll('.ios-tim [data-kind="attach"] .ios-lbl')].map(e => e.firstChild.textContent),
        library: _attachSuggestions().map(s => s.line.label),
      };
    });
    expect(r.timCards).toBe(1);
    expect(r.oldCard).toBe(false);
    expect(r.inTim.length).toBeGreaterThan(0);
    // Tim already asks for the permit and haul-off; the library's copies are not shown twice.
    expect(r.inTim.some(l => /permit|haul/i.test(l))).toBe(false);
    // A different part that shares a word ("drain") is not mistaken for the same thing.
    if (r.library.some(l => /drip pan/i.test(l))) expect(r.inTim.some(l => /drip pan/i.test(l))).toBe(true);
  });

  test('the listening sheet is Voice Memos: grabber, clock, red stop, and it says so when it cannot hear', async () => {
    await openTM(99908, null);
    const r = await page.evaluate(async () => {
      window._voiceStart = async () => true; window._voiceStop = async () => '';
      _geiScopeTalk();
      await new Promise(res => setTimeout(res, 200));
      const p = document.getElementById('_tim-listen');
      const stop = document.getElementById('_tim-stop');
      const out = { grab: !!p.querySelector('.tim-rec-grab'), clock: !!document.getElementById('_tim-clock'), stop: stop && stop.getAttribute('aria-label'),
        stopRed: stop && getComputedStyle(stop.querySelector('span')).backgroundColor };
      _timTalkStop(true);
      return out;
    });
    expect(r).toEqual({ grab: true, clock: true, stop: 'Done talking', stopRed: 'rgb(255, 59, 48)' });
  });

  // ── ADDING A PART (owner, 2026-09-26: "Parts needs to be a intuitive add") ──
  test('Add a part: the stepper is the count, return adds it and opens the next row', async () => {
    await openTM(99909, null);
    await page.evaluate(() => { _geiScopeChips = ['Set a tankless']; _renderScopeChips('tm-scope-wrap'); });
    await page.locator('#tm-sup-wrap button', { hasText: 'Add a part' }).click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('sup-add');
    await page.locator('#tm-sup-wrap button[aria-label="One more"]').click();
    await page.locator('#tm-sup-wrap button[aria-label="One more"]').click();
    await page.locator('#sup-add').fill('3/4 ball valve');
    await page.locator('#sup-add').press('Enter');
    // Typed the old way, the words carry the count and the unit.
    await page.locator('#sup-add').fill('20 ft 2in PVC');
    await page.locator('#sup-add').press('Enter');
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => ({ items: _supData().items.map(i => i.qty + ' ' + i.unit + ' ' + i.desc), open: !!document.getElementById('sup-add'), qty: document.getElementById('sup-new-qty').textContent, focus: document.activeElement && document.activeElement.id }));
    expect(r.items).toEqual(['3 ea 3/4 ball valve', '20 ft 2in PVC']);
    expect(r.open).toBe(true);
    expect(r.qty).toBe('1');
    expect(r.focus).toBe('sup-add');
  });

  test('a pasted list goes in whole, and an empty row closes when he leaves it', async () => {
    await openTM(99910, null);
    await page.waitForTimeout(300);
    await page.evaluate(() => { _geiScopeChips = ['Set a tankless']; _renderScopeChips('tm-scope-wrap'); _supStartAdd(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const el = document.getElementById('sup-add');
      const ev = new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
      ev.clipboardData.setData('text/plain', '2 ea 1/2 shark bite coupling\n1 condensate pump\n10 ft 3/4 pex');
      el.dispatchEvent(ev);
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => _supData().items.map(i => i.qty + ' ' + i.unit + ' ' + i.desc))).toEqual(['2 ea 1/2 shark bite coupling', '1 ea condensate pump', '10 ft 3/4 pex']);
    await page.evaluate(() => { document.getElementById('sup-add').blur(); document.body.focus(); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => ({ row: !!document.getElementById('sup-add'), add: [...document.querySelectorAll('#tm-sup-wrap button')].some(b => /Add a part/.test(b.textContent)) }))).toEqual({ row: false, add: true });
  });

  test('no console errors', async () => { assertNoErrors(page, 'walk notes'); });
});
