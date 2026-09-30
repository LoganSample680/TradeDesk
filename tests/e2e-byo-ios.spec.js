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
 *  - The bar: Price it out, Set the price, then Sign here / Send it.
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

  test('the bar says Price it out until there are some', async () => {
    await open();
    expect(await bar()).toEqual(['Price it out']);
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
    // Changed 2026-09-26 (§10.4, owner: "BYO should carry over as much as
    // possible with shared code"). The bar now walks Tim's leftovers first and
    // asks him to check the total and deposit before Send, the same walk as
    // T&M (e2e-tm-guided.spec.js). Tim's leftovers are answered here.
    expect((await bar())[0]).toMatch(/^Tim caught \d+ things? you left out$/);
    await page.evaluate(() => { _byoMissed.length = 0; _byoRenderSteps(); });
    expect(await bar()).toEqual(['Set the price']);
    await priceAll(900);
    expect(await bar()).toEqual(['Check the price']);
    await page.evaluate(() => _geiNumsMark());
    expect(await bar()).toEqual(['Sign here', 'Send it']);
  });

  test('one price for the whole job: fill the scope, type Their price, no line needs a price (owner 2026-09-30)', async () => {
    await open();
    await say('pull the old water heater, run new pex, set a tankless');
    await page.evaluate(() => { _byoMissed.length = 0; _byoRenderSteps(); });
    expect(await bar()).toEqual(['Set the price']);
    await page.locator('#byo-dock-go').click({ delay: 20 });
    await page.waitForTimeout(800);            // _tmDockReady ignores a tap right after the label changes
    await page.locator('#byo-dock-go').click();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('byo-price-in');
    await page.locator('#byo-price-in').pressSequentially('2800');
    await page.locator('#byo-price-in').blur();
    await page.evaluate(() => _byoRenderSteps());
    const r = await page.evaluate(() => ({
      total: calcGeiTotal().sub, lines: _byoItems.map(it => it.price), job: _byoJobPrice,
    }));
    expect(r.total).toBe(2800);
    expect(r.lines).toEqual([0, 0, 0]);         // his lines stay plain scope
    expect(r.job).toBe(2800);
    // Typing his own price is checking it, the same as the deposit box.
    expect(await bar()).toEqual(['Sign here', 'Send it']);
    const d = await doc();
    expect(d).toContain('2,800');
    // Cleared, the lines add up as before and the bar asks for a price again.
    await page.locator('#byo-price-in').fill('');
    await page.locator('#byo-price-in').dispatchEvent('input');
    await page.evaluate(() => _byoRenderSteps());
    expect(await page.evaluate(() => calcGeiTotal().sub)).toBe(0);
    expect(await bar()).toEqual(['Set the price']);
  });

  test('deposit: none unless he sets one, and a 0 he sets sticks, here and in Settings (owner 2026-09-30)', async () => {
    const r = await page.evaluate(() => {
      const o = window._settingsChanged; window._settingsChanged = () => {};
      try {
        delete S.depositPct;
        const never = _geiDepositDefault();
        S.depositPct = 25;
        _geiIsTM = false;
        const el = document.getElementById('byo-deposit-pct');
        el.value = '0'; _geiRememberDeposit();
        const learned = S.depositPct;
        el.value = ''; const next = _geiDepositPct();
        // Settings: typing 0 used to save as 25.
        loadSettingsForm();
        const box = document.getElementById('set-deposit-pct');
        const shown = box ? box.value : null;
        return { never, learned, next, shown };
      } finally { window._settingsChanged = o; S.depositPct = 25; }
    });
    expect(r).toEqual({ never: 0, learned: 0, next: 0, shown: '0' });
  });

  test('a pasted estimate letter: price and days filled in, courtesy and signature left out (Jack 2026-09-30)', async () => {
    await open();
    const r = await page.evaluate(() => {
      S.bname = 'Plumbing Solutions by JS'; S.ownerName = 'John Schonfeldt';
      document.getElementById('byo-say').value = "Here’s my estimate $2800 to rough surface mounted washer box drain and water and vent. I have included electrical for washer receptacle and receptacle for dryer as well. I will drill hole and run dryer vent to outside. I have also included 3 hose bibs and piping. We will secure the tub spout. My estimate is good for 14 days. If you approve  I can  start asap. I appreciate your faith and trust in our plumbing services and look forward to working with you on this project. John Schonfeldt Plumbing Solutions by JS";
      _byoSayBuild();
      _byoRenderPrice();
      const sel = document.getElementById('byo-valid-days');
      return { labels: _byoItems.map(x => x.label), price: _byoJobPrice, days: _geiValidDays, sel: sel && sel.value,
        total: calcGeiTotal().sub, lines: _byoItems.map(x => x.price) };
    });
    expect(r.price).toBe(2800);
    expect(r.days).toBe(14);
    expect(r.sel).toBe('14');
    expect(r.total).toBe(2800);
    expect(r.labels.length).toBeGreaterThanOrEqual(4);
    r.labels.forEach(l => expect(l).not.toMatch(/estimate|\$|good for|approve|appreciate|look forward|Schonfeldt|Plumbing Solutions|start asap/i));
    // His sentences whole, in his order, and printed that way: no fragments
    // like "Drill hole" on their own, no stage headings reshuffling them.
    // Changed 2026-09-30 (owner): the lines read the way a plumber writes
    // them on a customer's copy, and his closing words are his signed note.
    expect(r.labels).toEqual([
      'Rough in surface-mounted washer box: drain, water lines and vent',
      'Rough in electrical outlets for the washer and dryer',
      'Drill an exterior hole and run the dryer vent outside',
      'Install 3 hose bibs and piping',
      'Secure the tub spout',
    ]);
    const note = await page.evaluate(() => ({ note: _geiNote, by: _geiNoteBy }));
    expect(note.note).toMatch(/^If you approve I can start ASAP\. I appreciate your faith and trust in our plumbing services/);
    expect(note.by).toBe('John Schonfeldt');
    const d = await doc();
    expect(d).toContain('A note from John');
    expect(d).toContain('faith and trust');
    const i1 = d.indexOf('Rough in surface-mounted'), i2 = d.indexOf('Secure the tub spout');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(d).not.toContain('The new work');
  });

  const EMAIL_BULLETS = "Hi Tagen,\n\nHere's my estimate of $2,800 for the following work:\n\n- Rough in a surface-mounted washer box, including drain, water, and vent\n- Electrical for the washer receptacle and a dryer receptacle\n- Drill through and run the dryer vent to the outside\n- Install 3 hose bibs with piping\n- Cap the gas line to the gas light out front and the existing washer lines\n- Seal ductwork, leaving enough open to keep the crawl space from freezing\n- Secure the tub spout\n\nThis estimate is good for 14 days. If you approve, I can start as soon as possible.\n\nI appreciate your faith and trust in our plumbing services and look forward to working with you on this project, as well as any future projects or service and maintenance needs.\n\nJohn Schonfeldt\nPlumbing Solutions by JS";
  test('a pasted email with bullets and line breaks: every bullet is a step (owner 2026-09-30, "I can\'t find a line in that")', async () => {
    await open();
    const r = await page.evaluate(() => {
      // Pasted on a DIFFERENT business's account (the owner's own): the
      // signature block is still a name, never a step.
      S.bname = 'Sample Painting'; S.ownerName = 'Logan Sample';
      document.getElementById('byo-say').value = "Hi Tagen,\n\nHere's my estimate of $2,800 for the following work:\n\n- Rough in a surface-mounted washer box, including drain, water, and vent\n- Electrical for the washer receptacle and a dryer receptacle\n- Drill through and run the dryer vent to the outside\n- Install 3 hose bibs with piping\n- Cap the gas line to the gas light out front and the existing washer lines\n- Seal ductwork, leaving enough open to keep the crawl space from freezing\n- Secure the tub spout\n\nThis estimate is good for 14 days. If you approve, I can start as soon as possible.\n\nI appreciate your faith and trust in our plumbing services and look forward to working with you on this project, as well as any future projects or service and maintenance needs.\n\nJohn Schonfeldt\nPlumbing Solutions by JS";
      _byoSayBuild();
      // "3 hose bibs with piping" also names what he buys; that lands in its
      // own Materials section, which is not a scope line.
      const steps = _byoItems.filter(x => !x._supply && x.label !== 'Materials');
      return { labels: steps.map(x => x.label), price: _byoJobPrice, days: _geiValidDays, note: _geiNote, by: _geiNoteBy };
    });
    // Stored grouped by room (2026-09-30, one list for BYO and T&M), the same
    // order the screen and the customer's copy show: the washer lines join
    // the laundry room, the gas light stays outside.
    expect(r.labels).toEqual([
      'Rough in a surface-mounted washer box: drain, water lines and vent',
      'Rough in electrical outlets for the washer and dryer',
      'Drill an exterior hole and run the dryer vent outside',
      'Cap the existing washer lines',
      'Install 3 hose bibs with piping',
      'Cap the gas line to the gas light out front',
      'Seal the ductwork, leaving enough open to keep the crawlspace from freezing',
      'Secure the tub spout',
    ]);
    expect(r.price).toBe(2800);
    expect(r.days).toBe(14);
    expect(r.note).toMatch(/faith and trust/);
    expect(r.by).toBe('John Schonfeldt');
    // Materials: only what he counted. The line break ends a line, so "a dryer
    // receptacle" and the next bullet's "Drill through" are never one part,
    // and "a" is grammar in a written estimate, not a count (owner 2026-09-30).
    const m = await page.evaluate((t) => timScopeBuild(t).materials.map(x => x.item), EMAIL_BULLETS);
    expect(m).toEqual(['Hose bibs']);
  });

  test('Proposals signed by: a note with no signer comes from that name, blank falls back to the owner (owner 2026-09-30)', async () => {
    await open();
    const r = await page.evaluate(() => {
      const was = S.signAs, wasOwner = S.ownerName;
      try {
        S.ownerName = 'Jack Schonfeldt';
        S.signAs = 'John Schonfeldt';
        const john = _propNoteHtml('I appreciate your faith and trust.', '');
        const signer = _propSigner();
        S.signAs = '';
        const own = _propSigner();
        const field = !!document.getElementById('set-signas');
        return { john: /A note from John/.test(john), signer, own, field };
      } finally { S.signAs = was; S.ownerName = wasOwner; }
    });
    expect(r.john).toBe(true);
    expect(r.signer).toBe('John Schonfeldt');
    expect(r.own.length).toBeGreaterThan(0);
    expect(r.own).not.toBe('John Schonfeldt');
    expect(r.field).toBe(true);
  });

  // ── ROOMS (owner 2026-09-30, Jack picked the room layout) ─────────────────
  const EMAIL = "Hi Tagen,\n\nHere's my estimate of $2,800 for the following work:\n\n- Rough in a surface-mounted washer box, including drain, water, and vent\n- Electrical for the washer receptacle and a dryer receptacle\n- Drill through and run the dryer vent to the outside\n- Install 3 hose bibs with piping\n- Cap the gas line to the gas light out front and the existing washer lines\n- Seal ductwork, leaving enough open to keep the crawl space from freezing\n- Secure the tub spout\n\nThis estimate is good for 14 days. If you approve, I can start as soon as possible.\n\nI appreciate your faith and trust in our plumbing services.\n\nJohn Schonfeldt\nPlumbing Solutions by JS";
  const rooms = () => page.evaluate(() => {
    const out = {};
    _byoItems.filter(x => !x._supply && x.label !== 'Materials').forEach(x => { (out[x.section] = out[x.section] || []).push(x.label); });
    return out;
  });

  test('rooms: a job that spans rooms lands one section per room, in his order', async () => {
    await open();
    await page.evaluate((t) => { S.bname = 'Plumbing Solutions by JS'; document.getElementById('byo-say').value = t; _byoSayBuild(); }, EMAIL);
    const r = await rooms();
    expect(Object.keys(r)).toEqual(['Laundry room', 'Outside', 'Crawlspace', 'Bathroom']);
    expect(r['Laundry room']).toEqual([
      'Rough in a surface-mounted washer box: drain, water lines and vent',
      'Rough in electrical outlets for the washer and dryer',
      'Drill an exterior hole and run the dryer vent outside',
      'Cap the existing washer lines',
    ]);
    expect(r['Outside']).toEqual(['Install 3 hose bibs with piping', 'Cap the gas line to the gas light out front']);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#byo-sections .room-name')].map(b => b.textContent.trim()));
    expect(titles).toEqual(['Laundry room', 'Outside', 'Crawlspace', 'Bathroom']);
    const shared = await page.evaluate(() => {
      let n = 0; const o = window._roomStackHtml;
      window._roomStackHtml = function (...a) { n++; return o.apply(this, a); };
      try { _byoRenderSections(); return n; } finally { window._roomStackHtml = o; }
    });
    expect(shared).toBe(1);   // the same stack T&M draws with
    const d = await doc();
    const at = k => d.indexOf(k);
    expect(at('Laundry room')).toBeGreaterThan(-1);
    expect(at('Laundry room')).toBeLessThan(at('Outside'));
    expect(at('Outside')).toBeLessThan(at('Crawlspace'));
    expect(at('Crawlspace')).toBeLessThan(at('Bathroom'));
  });

  test('rooms: one room, or a painting job, stays one plain list', async () => {
    await open();
    await say('Replace the toilet, reset the vanity and caulk the tub');
    const one = await rooms();
    expect(Object.keys(one)).toEqual(['Work']);
    const t = await page.evaluate(() => ({ a: timRoomOf('run the dryer vent outside'), b: timRoomOf('install 3 hose bibs'), c: timRoomOf('patch drywall'), d: timScopeBuild('patch the hallway and paint the trim').byRoom }));
    expect(t).toEqual({ a: 'Laundry room', b: 'Outside', c: null, d: false });
  });

  test('rooms: tap a title to rename it, and its lines go with it', async () => {
    await open();
    await page.evaluate((t) => { document.getElementById('byo-say').value = t; _byoSayBuild(); }, EMAIL);
    await page.locator('#byo-sections .room-name', { hasText: 'Crawlspace' }).click();
    await page.fill('#zprompt-inp', 'Basement');
    await page.click('#zprompt-ok');
    const r = await rooms();
    expect(Object.keys(r)).toEqual(['Laundry room', 'Outside', 'Basement', 'Bathroom']);
    expect(r['Basement']).toEqual(['Seal the ductwork, leaving enough open to keep the crawlspace from freezing']);
    // Renaming onto a room that already exists merges the two.
    const merged = await page.evaluate(() => { _byoApplyRename('Bathroom', 'laundry room'); return _byoCustomSections.slice(); });
    expect(merged).not.toContain('Bathroom');
    const blank = await page.evaluate(() => _byoApplyRename('Outside', '   '));
    expect(blank).toBe(false);
  });

  test('rooms: hold a line and drag it into another room', async () => {
    await open();
    await page.evaluate((t) => { document.getElementById('byo-say').value = t; _byoSayBuild(); }, EMAIL);
    const row = page.locator('#byo-sections .byo-line', { hasText: 'Secure the tub spout' });
    const target = page.locator('#byo-sections .byo-line', { hasText: 'Seal the ductwork' });
    // Both mid-screen, clear of the edges where a held line scrolls the page.
    // A "Set $2,800 ..." toast lands at the bottom a moment after a build;
    // clear it so the finger presses the row, not the toast.
    await page.waitForTimeout(450);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await target.evaluate(e => e.scrollIntoView({ block: 'center' }));
    const a = await row.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    // The hold is 380ms; wait for the lift itself, not a guess at the clock.
    await page.waitForFunction(() => !!document.getElementById('room-drag-ghost'), null, { timeout: 6000 });
    const lifted = await page.evaluate(() => !!document.getElementById('room-drag-ghost'));
    const b = await target.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 8 });
    await page.mouse.up();
    const r = await rooms();
    expect(lifted).toBe(true);
    expect(r['Crawlspace'][0]).toBe('Secure the tub spout');
    expect(r['Bathroom']).toBeUndefined();
    // A quick tap is still a tap: it opens the line, it does not move it.
    const ghost = await page.evaluate(() => !!document.getElementById('room-drag-ghost'));
    expect(ghost).toBe(false);
    const moved = await page.evaluate(() => {
      const i = _byoItems.findIndex(x => x.label === 'Cap the existing washer lines');
      _byoMoveLine(i, 'Crawlspace', null);
      return _byoItems.filter(x => x.section === 'Crawlspace').map(x => x.label).pop();
    });
    expect(moved).toBe('Cap the existing washer lines');
  });

  test('the keyboard closing is "done": pasted text becomes lines without a button', async () => {
    await open();
    const box = page.locator('#byo-say');
    await box.fill('Replace the water heater and haul the old one away');
    await page.evaluate(() => document.getElementById('byo-say').blur());
    await page.waitForFunction(() => _byoItems.length > 0, null, { timeout: 3000 });
    const r = await page.evaluate(() => _byoItems.map(x => x.label));
    expect(r.length).toBeGreaterThan(0);
    // An empty box closing does nothing, and never nags.
    await open();
    await page.evaluate(() => { const el = document.getElementById('byo-say'); el.focus(); el.blur(); });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => _byoItems.length)).toBe(0);
  });

  test('the job clock bar never sits under the status bar: hidden in the editor, full width under the top bar elsewhere (owner 2026-09-30)', async () => {
    await open();
    const r = await page.evaluate(async () => {
      _activeTimer = { clientName: 'Tagen Lindstrom', scopeLabel: 'General', start: Date.now() };
      showClockBanner();
      const b = document.getElementById('clock-banner');
      const inEditor = getComputedStyle(b).display;
      goPg('pg-dash');
      await new Promise(res => setTimeout(res, 150));
      const rc = b.getBoundingClientRect(), tb = document.getElementById('mobile-topbar').getBoundingClientRect();
      const out = { inEditor, left: rc.left, width: rc.width, top: rc.top, under: tb.bottom, vw: innerWidth };
      hideClockBanner(); _activeTimer = null;
      return out;
    });
    expect(r.inEditor).toBe('none');
    expect(r.left).toBe(0);
    expect(r.width).toBe(r.vw);
    expect(r.top).toBeGreaterThanOrEqual(r.under - 1);
  });

  test('trade: the trade he picks carries, through a reload and a draft, and the words never overrule it (owner 2026-09-30)', async () => {
    const r = await page.evaluate((t) => {
      const was = { cfg: _config, act: _activeTrade };
      const key = _tradeKey();
      let saved = null; try { saved = localStorage.getItem(key); } catch (_e) {}
      try {
        _config = Object.assign({}, _config || {}, { business_type: 'landscaping', trade_lines: 'painting,plumbing' });
        try { localStorage.removeItem(key); } catch (_e) {}
        _activeTrade = null;
        const start = getActiveTrade();                    // never the signup trade he does not run
        setActiveTrade('plumbing');                        // the pick
        _activeTrade = null;                               // a reload wipes memory...
        const afterReload = getActiveTrade();              // ...and the pick comes back
        _rememberTrade('roofing');
        const notHis = _tradeStart(_config);               // a trade he does not run is ignored
        // Picked PAINTING, pasted a plumbing letter: the pick stands.
        setActiveTrade('painting');
        clients.push({ id: 96101, name: 'Logan Sample', addr: '2015 SW Randolph Ave, Topeka, KS 66604' });
        openGenericEstimate(getClientById(96101), null, null, { mode: 'byo' });
        _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
        document.getElementById('byo-say').value = t; _byoSayBuild();
        const kept = _geiTrade;
        // Picked PLUMBING: a room-grouped repair with no parts is not taxed.
        setActiveTrade('plumbing');
        openGenericEstimate(getClientById(96101), null, null, { mode: 'byo' });
        _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
        _geiClientTaxRate = { rate: 9.15, source: 'test' };
        _byoItems.length = 0; _byoJobPrice = 0; _byoRenderSections();
        document.getElementById('byo-say').value = t; _byoSayBuild();
        const tot = calcGeiTotal();
        // A draft reopens on its own trade, whatever the app is on now.
        bids.push({ id: 96102, client_id: 96101, trade_type: 'plumbing', status: 'Draft' });
        const draftTrade = _geiBidTrade(96102);
        return { start, afterReload, notHis, kept, trade: _geiTrade, tax: tot.salesTax, sub: tot.sub, draftTrade,
          name: _geiAutoName(), gone: typeof timTradeOf };
      } finally {
        _config = was.cfg; _activeTrade = was.act; _geiClientTaxRate = null;
        try { if (saved == null) localStorage.removeItem(key); else localStorage.setItem(key, saved); } catch (_e) {}
      }
    }, EMAIL_BULLETS);
    expect(r.start).toBe('painting');
    expect(r.afterReload).toBe('plumbing');
    expect(r.notHis).toBe('painting');
    expect(r.kept).toBe('painting');
    expect(r.trade).toBe('plumbing');
    expect(r.sub).toBe(2800);
    expect(r.tax).toBe(0);            // Kansas plumbing repair, rooms, no parts
    // Your cost starts at 0: nothing he did not type (the drive, crew pay).
    const cost = await page.evaluate(() => { _byoUpdateRail(); _byoRenderPrice(); return { rail: (document.getElementById('byo-expected-cost') || {}).value || '', card: (document.getElementById('byo-cost-in') || {}).value || '' }; });
    expect(cost).toEqual({ rail: '', card: '' });
    expect(r.draftTrade).toBe('plumbing');
    expect(r.name).not.toMatch(/^Materials/);
    expect(r.gone).toBe('undefined'); // the word-reading guess is deleted (§7.1)
  });

  test('Good for: the picker sets the days the price holds, and it is saved on the draft', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    const r = await page.evaluate(() => {
      _geiValidDays = 0; _byoRenderPrice();
      const sel = document.getElementById('byo-valid-days');
      const std = sel.value;
      sel.value = '60'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const b = bids.find(x => x.id === _geiEditBidId); if (b) _byoAutosave();
      return { std, now: _geiValidDays, opts: [...document.getElementById('byo-valid-days').options].map(o => o.value), saved: b ? b.validDays : 'none' };
    });
    expect(r.std).toBe(String(await page.evaluate(() => _estValidDays())));
    expect(r.now).toBe(60);
    expect(r.opts).toEqual(expect.arrayContaining(['7', '14', '30', '60', '90']));
    if (r.saved !== 'none') expect(r.saved).toBe(60);
    await page.evaluate(() => { _geiValidDays = 0; });
  });

  test('a line whose description is a whole letter prints as steps, not one block; an address name is dropped', async () => {
    const r = await page.evaluate(() => {
      S.bname = 'Plumbing Solutions by JS';
      const items = _byoPrintItems([{ label: '5713 SW 14th street', section: 'Work', on: true, price: 2800,
        notes: 'Here’s my estimate $2800 to rough surface mounted washer box drain and water and vent. I will drill hole and run dryer vent to outside. I have also included 3 hose bibs and piping. My estimate is good for 14 days. If you approve I can start asap.' },
        { label: 'Secure the tub spout', section: 'Work', on: true, notes: 'Tighten and caulk.' }]);
      return items.map(x => x.label);
    });
    expect(r).not.toContain('5713 SW 14th street');
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r[r.length - 1]).toBe('Secure the tub spout');
    r.forEach(l => expect(l).not.toMatch(/estimate|good for|approve/i));
  });

  test('the proposal file carries his logo URL, color and business email for the sign page', async () => {
    const r = await page.evaluate(() => {
      const save = { u: S.logoUrl, h: S.logoHash, d: S.logoData, c: S.brandColor };
      S.logoData = 'data:image/png;base64,AAAA'; S.logoUrl = 'https://mwtsmctajhrrybblgorf.supabase.co/storage/v1/object/public/gallery/u/branding/logo-1.png';
      S.logoHash = String(_hubHash(S.logoData)); S.brandColor = '#2d5da8';
      const good = _propLogoFields();
      S.logoHash = 'stale';
      const stale = _propLogoFields();
      Object.assign(S, { logoUrl: save.u, logoHash: save.h, logoData: save.d, brandColor: save.c });
      return { good, stale };
    });
    expect(r.good.logoUrl).toMatch(/gallery\/u\/branding\/logo-1\.png$/);
    expect(r.good.logoData).toBe('');
    expect(r.good.brandColor).toBeTruthy();
    expect(r.stale.logoUrl).toBe('');
    expect(r.stale.logoData).toBe('data:image/png;base64,AAAA');
  });

  test('no deposit is not a line on the customer copy (owner 2026-09-30)', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => { _byoJobPrice = 1500; _byoUpdateRail(); const el = document.getElementById('byo-deposit-pct'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const d = await doc();
    expect(d).not.toMatch(/Deposit \(0%\)/);
    expect(d).toContain('1,500');
    await page.evaluate(() => { _byoJobPrice = 0; S.depositPct = 25; });
  });

  test('the text says his trade: a plumber\'s proposal is never "painting" (2026-09-30)', async () => {
    await open();
    const r = await page.evaluate(() => { const b = bids.find(x => x.id === _geiEditBidId); if (b) b.trade_type = 'plumbing'; _geiTrade = 'plumbing'; return _smsProposalWord(); });
    expect(r).toBe('plumbing proposal');
    const src = await page.evaluate(() => String(sendProposalViaSms));
    expect(src).not.toMatch(/painting proposal/);
  });

  test('your profit: a bar and the words for where it sits, live as the cost is typed (owner 2026-09-30)', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    await page.evaluate(() => { _byoJobPrice = 2800; _byoUpdateRail(); _byoRenderPrice(); });
    const read = () => page.evaluate(() => ({
      val: document.getElementById('byo-profit-val').textContent,
      bar: getComputedStyle(document.getElementById('byo-profit-bar')).display !== 'none',
      msg: document.getElementById('byo-profit-msg').textContent,
      dot: document.getElementById('byo-profit-dot').style.left,
    }));
    const none = await read();
    expect(none).toMatchObject({ val: 'Add your cost', bar: false, msg: '' });
    await page.locator('#byo-cost-in').click();
    await page.locator('#byo-cost-in').pressSequentially('1680');
    const good = await read();
    expect(good).toMatchObject({ val: '40% · $1,120', bar: true, msg: 'Priced right, solid margin for this job', dot: '40%' });
    await page.locator('#byo-cost-in').fill('');
    await page.locator('#byo-cost-in').pressSequentially('2500');
    const thin = await read();
    expect(thin.msg).toBe('Underpriced: consider raising your rate');
    // The boxes look like boxes.
    const border = await page.evaluate(() => ['byo-price-in', 'byo-cost-in', 'byo-dep-in'].map(id => getComputedStyle(document.getElementById(id)).borderTopWidth));
    border.forEach(w => expect(w).toBe('1px'));
    await page.evaluate(() => { _byoJobPrice = 0; });
  });

  test('a scope line is words and a price: no how many, no each (owner 2026-09-30)', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    const r = await page.evaluate(() => {
      _byoEditItem(0);
      const m = document.getElementById('_byo-add-modal');
      const shown = id => { const e = document.getElementById(id); return !!e && e.type !== 'hidden' && !!e.offsetParent; };
      const out = { qty: shown('_bya-qty'), unit: shown('_bya-unit'), price: shown('_bya-price'), title: m.textContent.includes('Edit this line') };
      document.getElementById('_bya-price').value = '650';
      _byaEditConfirm(0);
      out.saved = { qty: _byoItems[0].qty, price: _byoItems[0].price };
      // A materials line keeps how many and what each.
      _byoAddItem('Materials');
      out.matQty = shown('_bya-qty'); out.matUnit = shown('_bya-unit');
      document.getElementById('_byo-add-modal').remove();
      return out;
    });
    expect(r).toEqual({ qty: false, unit: false, price: true, title: true, saved: { qty: 1, price: 650 }, matQty: true, matUnit: true });
  });

  test('the job price is never learned as one line\'s price, and it saves with the draft', async () => {
    await open();
    await say('pull the old water heater, set a tankless');
    const r = await page.evaluate(() => {
      _byoJobPrice = 2800; _byoUpdateRail();
      const learned = [];
      const orig = window._pbLearn; window._pbLearn = (d, rate) => learned.push(Number(rate) || 0);
      try { _pbLearnAll(); } finally { window._pbLearn = orig; }
      const b = bids.find(x => x.id === _geiEditBidId);
      if (b) _byoAutosave();
      return { carrier: _geiLines.filter(l => l._lump).length, sub: _geiLines.reduce((s, l) => s + l.total, 0), learned, saved: b ? b.byoJobPrice : 'none' };
    });
    expect(r.carrier).toBe(1);
    expect(r.sub).toBe(2800);
    expect(r.learned.some(x => x >= 2800)).toBe(false);
    if (r.saved !== 'none') expect(r.saved).toBe(2800);
    await page.evaluate(() => { _byoJobPrice = 0; _byoUpdateRail(); });
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
    // Changed 2026-09-26 (§10.4, owner: "BYO should carry over as much as
    // possible with shared code"). The bar now walks Tim's leftovers first and
    // asks him to check the total and deposit before Send, the same walk as
    // T&M (e2e-tm-guided.spec.js). Tim's leftovers are answered here.
    await page.evaluate(() => { _byoMissed.length = 0; });
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

  test('Earl: a double tap on Price it out never sends anything', async () => {
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
