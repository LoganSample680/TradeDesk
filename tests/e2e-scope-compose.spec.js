// @ts-check
// ── SAY THE JOB, GET THE SCOPE ───────────────────────────────────────────────
//
// Owner, 2026-09-22: "I really want to retire the scope picker on every bid,
// instead I want you to type up what youre doing or speak it to tim and he
// builds the scope in order broken down by steps in order. Tim cant forget a
// step."
//
// The picker asked a man to find his own job in somebody else's list, on every
// bid, forever. He has already said the job out loud twice before he opens the
// app. So the box takes that sentence and js/tim-knowledge.js turns it into
// steps, offline, with no model call.
//
// The splitting itself is held in e2e-tim-knowledge.spec.js, where it is pure.
// These hold the screen: that the box is what he meets, that his steps land on
// the card, that the ones he forgot arrive as an OFFER with the reason on them,
// and that accepting one puts it where the work actually happens.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the scope you say out loud', () => {
  let page;

  const open = () => page.evaluate(() => {
    _activeTrade = 'painting';
    S.priceBook = { painting: [] };
    clients.length = 0; bids.length = 0;
    clients.push({ id: 55501, name: 'Dana Whitfield', addr: '1200 Elm St, Wichita KS 67203' });
    openTMEstimate(clients[0]);
  });

  const reset = () => page.evaluate(() => {
    _tmShowPage();
    _geiScopeChips.length = 0;
    _geiScopeNoScope = false;
    _geiScopeMissed = [];
    _geiRenderScopeCard('tm');
    _renderScopeChips('tm-scope-wrap');
    document.getElementById('_tim-ov')?.remove();
  });

  const say = (words) => page.evaluate((w) => {
    const t = document.getElementById('gei-scope-say');
    if (!t) return 'NO BOX';
    t.value = w;
    _geiScopeBuild('tm-scope-wrap');
    return null;
  }, words);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await open();
    await page.waitForTimeout(600);
  });
  test.beforeEach(async () => { await reset(); });
  test.afterAll(async () => { await page.context().close(); });

  // ── WHAT HE MEETS ─────────────────────────────────────────────────────────

  test('an empty scope offers the box, not the picker', async () => {
    const t = await page.evaluate(() =>
      (document.getElementById('tm-scope-wrap') || {}).textContent.replace(/\s+/g, ' ').trim());
    expect(t).toContain('Tell me what you are doing');
    expect(t).toContain('Build the steps');
    // The list is still reachable. Retiring a thing people rely on is a one
    // way door, and this has been live for one afternoon.
    expect(t).toContain('Or pick from a list');
  });

  test('the box is a real field with a worked example in it', async () => {
    const r = await page.evaluate(() => {
      const t = document.getElementById('gei-scope-say');
      return { there: !!t, tag: t && t.tagName, ph: t && t.placeholder };
    });
    expect(r.there).toBe(true);
    expect(r.tag).toBe('TEXTAREA');
    // A placeholder that shows the SHAPE of an answer, not "enter scope".
    expect(r.ph).toContain('Tear out');
    expect(r.ph.length).toBeGreaterThan(40);
  });

  // ── HIS SENTENCE, HIS STEPS ───────────────────────────────────────────────

  test('what he said becomes numbered steps on the card, in his order', async () => {
    await say("okay so we're gonna tear out the old vanity, run new supply lines, "
      + 'set the new one and top, then caulk it and test everything');
    const r = await page.evaluate(() => ({
      chips: _geiScopeChips.slice(),
      shown: document.getElementById('tm-scope-wrap').textContent.replace(/\s+/g, ' '),
    }));
    expect(r.chips).toEqual([
      'Tear out the old vanity',
      'Run new supply lines',
      'Set the new one and top',
      'Caulk it and test everything',
    ]);
    // On the card, not just in the array. The card rebuilds the wrap the rows
    // live in, so painting them in the wrong order lands four steps in state
    // and an empty card, which is exactly what the first build did.
    expect(r.shown).toContain('Tear out the old vanity');
    expect(r.shown).toContain('Caulk it and test everything');
  });

  test('saying more adds to the list rather than starting it again', async () => {
    await say('tear off the old shingles');
    await page.evaluate(() => _geiScopeSayMore('tm-scope-wrap'));
    await say('dry in with synthetic, then new architectural shingles');
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips).toEqual([
      'Tear off the old shingles',
      'Dry in with synthetic',
      'New architectural shingles',
    ]);
  });

  test('the same step said twice does not land twice', async () => {
    await say('haul off the debris');
    await page.evaluate(() => _geiScopeSayMore('tm-scope-wrap'));
    await say('haul off the debris');
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips.length).toBe(1);
  });

  test('nothing said changes nothing', async () => {
    await page.evaluate(() => { document.getElementById('gei-scope-say').value = '   '; _geiScopeBuild('tm-scope-wrap'); });
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips).toEqual([]);
  });

  // ── AND TIM CANNOT FORGET A STEP ──────────────────────────────────────────

  test('what he left out arrives as an offer, with the reason in his own words', async () => {
    await say('stripping the failed paint on the second floor south elevation, '
      + 'replace any rotted trim, prime the bare wood, then two coats');
    const r = await page.evaluate(() => ({
      missed: _geiScopeMissed.map(m => ({ id: m.id, say: m.say, because: m.because, step: m.step })),
      shown: document.getElementById('tm-scope-wrap').textContent.replace(/\s+/g, ' '),
      chips: _geiScopeChips.slice(),
    }));
    expect(r.missed.map(m => m.id)).toContain('access-scaffold');
    // Nothing moved on its own. Rule 3 of js/tim-knowledge.js: nothing Tim
    // guessed becomes a fact until the contractor accepts it.
    expect(r.chips, 'Tim put a step on the contract without being asked')
      .not.toContain('Set scaffold');
    expect(r.shown).toContain('You did not say');
    expect(r.shown).toContain('You never said scaffold up first');
  });

  // A supply rule is a thing you BUY. Numbering "Primer, masking, sandpaper"
  // on a contract a homeowner signs is not a step, it is a shopping list.
  test('a materials-only rule never reaches the numbered scope', async () => {
    await say('strip and repaint the west elevation');
    const r = await page.evaluate(() => _geiScopeMissed.map(m => m.id));
    expect(r).not.toContain('prep-consumables');
    const every = await page.evaluate(() => _geiScopeMissed.every(m => !!m.step));
    expect(every, 'an offer with no step in it is not a scope line').toBe(true);
  });

  // THE ONE THE FEATURE IS NAMED AFTER. Scaffold goes up AND it comes down, and
  // the coming down is the step everybody forgets.
  test('accepting one adds the step it drags with it, at the end', async () => {
    await say('stripping the failed paint on the second floor south elevation, then two coats');
    await page.evaluate(() => _geiScopeTakeMissed('access-scaffold'));
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips[0], 'a scaffold step at the end of the list is useless').toBe('Set scaffold');
    expect(chips[chips.length - 1]).toBe('Strike scaffold');
  });

  // The line a homeowner reads is "Set scaffold". "Scaffold goes up before
  // anything is stripped" is Tim talking to the contractor.
  test('the contract gets the step, not the telling off', async () => {
    await say('stripping the failed paint on the second floor south elevation, then two coats');
    await page.evaluate(() => _geiScopeTakeMissed('access-scaffold'));
    const chips = await page.evaluate(() => _geiScopeChips.slice());
    expect(chips.join(' | ')).not.toContain('goes up before');
  });

  test('turning one down takes it off the card and leaves the scope alone', async () => {
    await say('stripping the failed paint on the second floor south elevation, then two coats');
    const before = await page.evaluate(() => _geiScopeChips.length);
    await page.evaluate(() => _geiScopeDropMissed('access-scaffold'));
    const r = await page.evaluate(() => ({
      ids: _geiScopeMissed.map(m => m.id),
      n: _geiScopeChips.length,
      shown: document.getElementById('tm-scope-wrap').textContent,
    }));
    expect(r.ids).not.toContain('access-scaffold');
    expect(r.n).toBe(before);
    expect(r.shown).not.toContain('You never said scaffold up first');
  });

  // SUBJECT CHANGED 2026-09-22, and the rule it guards is unchanged: a job that
  // drags nothing in must show no offer block. The old subject was a kitchen
  // faucet, which stopped being one of those the day Tim learned to say "shut
  // the water off first" on a live water line, and that nudge is correct on a
  // faucet swap. So the subject moved to a job that genuinely drags nothing in
  // rather than the assertion being weakened to accommodate a right answer.
  test('a job that drags nothing in shows no offer block at all', async () => {
    await say('hang the new mailbox');
    const shown = await page.evaluate(() =>
      document.getElementById('tm-scope-wrap').textContent);
    expect(shown).toContain('Hang the new mailbox');
    expect(shown).not.toContain('You did not say');
  });

  test('no console errors across the whole compose path', async () => {
    assertNoErrors(page, 'scope compose');
  });
});


// ── THE PROPERTY NOTE, READ RATHER THAN QUOTED ───────────────────────────────
//
// Owner, 2026-09-22: "how do we beautify the property note for dog access and
// things like that?"
//
// The sentence is written once, in a driveway, and read for years afterwards by
// whoever pulls up at that gate. The reading itself is held in
// e2e-tim-knowledge.spec.js, where it is pure. These hold the screens: that the
// chips replace the clamped paragraph where they exist, that his own words come
// back untouched the moment he taps in, and that a note Tim could not read
// still shows the thing he actually wrote.
test.describe('the property note on screen', () => {
  let page;

  const note = (text) => page.evaluate((t) => {
    const c = clients.filter(x => x.id === 55502)[0];
    setSiteNote(c, '9 Gate Rd, Wichita KS 67202', t);
    _geiSiteNoteOpen = false;
    _geiRenderSiteNoteField('tm');
    const wrap = document.getElementById('tm-sitenote-wrap');
    return (wrap ? wrap.textContent : '').replace(/\s+/g, ' ').trim();
  }, text);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      clients.length = 0; bids.length = 0;
      clients.push({ id: 55502, name: 'Gate Client', addr: '9 Gate Rd, Wichita KS 67202' });
      openTMEstimate(clients[0]);
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => { _tmShowPage(); document.getElementById('_tim-ov')?.remove(); });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the facts replace the paragraph on the row', async () => {
    const t = await note('Code 4417 on the side gate. Dog is friendly but barks. '
      + 'Park on the street, the driveway cracks.');
    expect(t).toContain('Park on the street');
    expect(t).toContain('Dog, friendly');
    expect(t).toContain('Gate 4417');
    // The paragraph is not ALSO sitting there. Two readings of the same
    // sentence on one row is the density this app spent the day shedding.
    expect(t, 'the chips and the paragraph were both on the row')
      .not.toContain('the driveway cracks');
    // Still says whose property and that it is not for the customer.
    expect(t).toContain('crew only');
  });

  // Half a reading is worse than none. If Tim cannot see the facts, the man's
  // own words are the best thing on offer and he still gets them.
  test('a note it cannot read still shows what he wrote', async () => {
    const t = await note('Ring twice and wait, he is slow on the stairs');
    expect(t).toContain('Ring twice and wait');
  });

  // His words, untouched, the moment he taps in. Nothing here rewrites a
  // sentence, it only reads one.
  test('tapping in gives him back exactly what he typed', async () => {
    const said = 'Code 4417 on the side gate. Dog is friendly. Park on the street.';
    await note(said);
    const v = await page.evaluate(() => {
      _geiToggleSiteNote('tm');
      return (document.getElementById('gei-sitenote') || {}).value;
    });
    expect(v).toBe(said);
    await page.evaluate(() => { _geiSiteNoteOpen = false; _geiRenderSiteNoteField('tm'); });
  });

  test('an empty note is still an invitation, not a blank row', async () => {
    const t = await note('');
    expect(t).toContain('Gate code, dog, where to park');
    expect(t).toContain('Never on the proposal');
  });

  // The screen that matters more: this is the one read at the gate, so it gets
  // the chips for the glance AND the sentence for what the chips cannot carry.
  test('the crew gets both the facts and the sentence', async () => {
    const r = await page.evaluate(() => {
      const c = clients.filter(x => x.id === 55502)[0];
      setSiteNote(c, c.addr, 'Code 4417 on the side gate. Dog is friendly but barks. '
        + 'Park on the street, the driveway cracks.');
      const sa = document.getElementById('s-addr');
      if (sa) sa.value = c.addr;
      _schedSiteNote(55502);
      const el = document.getElementById('s-sitenote');
      return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
    });
    expect(r).toContain('Gate 4417');
    expect(r).toContain('Dog, friendly');
    expect(r, 'the crew lost the detail the chips cannot carry')
      .toContain('the driveway cracks');
  });
});
