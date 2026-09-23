// @ts-check
/**
 * The 30-second T&M.
 *
 * Owner, 2026-09-22: "I want T&M to be generated in under 30 seconds."
 *
 * A stopwatch in CI would grade the CI machine, not the flow. That mistake is
 * already on the record here (e2e-timelog-daynav, where the stub delay and the
 * budget were both 400ms and the test measured the runner), so this spec counts
 * the thing a contractor actually spends, which is TAPS, and never asserts wall
 * clock. Four taps from a client record to a rate sheet with a scope on it is
 * the shape the owner asked for, and each of the three tests below guards one
 * of the three things that were costing him taps or lying to him about where
 * he was.
 *
 * The standing start is the real one: a customer he already has, one address,
 * one trade, and the rate he has used on every job before this one.
 */

const { test, expect, mockAllExternal, waitForAppBoot } = require('./helpers');

test.describe('a T&M in under thirty seconds', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // Opens a fresh T&M on a fresh client and shows the page, which is what the
  // real Start proposal → Time & Materials pair of taps ends up doing.
  async function freshTM(p, clientId) {
    await p.evaluate((id) => {
      clients.length = 0;
      clients.push({ id, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603', phone: '7855550142' });
      currentClientId = id;
      bids.length = 0;
      openTMEstimate(getClientById(id));
    }, clientId);
    await p.waitForTimeout(400);
    await p.evaluate(() => { _geiIsTM = true; _tmShowPage(); });
    await p.waitForTimeout(200);
  }

  // ── 1. Step one is honest about whether anything is written ────────────────
  //
  // _tmScopeDone() read _geiJobScope, which is the repair-vs-improvement TAX
  // classification and is initialised to 'repair' on every estimate this app
  // has ever opened. So a brand new T&M reported "The work: Written above" with
  // nothing written, and the rail moved its next-move marker down to the rate.
  // The one screen whose entire job is saying what is still missing was telling
  // him the customer-facing half was already done.
  test('a brand new T&M says the work is the next thing to do', async () => {
    await freshTM(page, 88801);
    const s = await page.evaluate(() => ({
      scopeDone: _tmScopeDone(),
      jobScope: _geiJobScope,
      next: (_tmSteps().find(x => x.rec) || {}).k,
      scopeValue: (_tmSteps().find(x => x.k === 'scope') || {}).value,
    }));
    expect(s.jobScope, 'the tax classification still defaults the way it always has').toBeTruthy();
    expect(s.scopeDone, 'nothing is written, so the scope step is not done').toBe(false);
    expect(s.next, 'the work is the next move on an empty proposal').toBe('scope');
    expect(s.scopeValue).not.toMatch(/written/i);
  });

  // ── 2. The rate box and the rail agree ─────────────────────────────────────
  //
  // Opening a T&M autosaves a draft bid straight away, and _tmShowPage restored
  // the layer set FROM that draft. A draft has no tmLayers and no figures to
  // derive any from, so the restore returned an empty set and wiped the rate
  // layer the open path had just switched on. His own rate sat in the box and
  // in the folded summary line while the rail called it Not set and pointed the
  // next-move marker at it.
  test('the rate he already uses is on it, and the rail says so too', async () => {
    await freshTM(page, 88802);
    const s = await page.evaluate(() => ({
      layers: [..._tmLayers],
      rate: Number(_tmRatePerMan),
      box: (document.getElementById('tm-i-rate') || {}).value,
      rateStep: _tmSteps().find(x => x.k === 'rate'),
    }));
    expect(s.rate, 'his settings rate is what a new T&M opens with').toBeGreaterThan(0);
    expect(s.layers, 'the rate layer survives the draft-bid restore').toContain('rate');
    expect(s.box, 'and it is in the box he can see').toBeTruthy();
    expect(s.rateStep.done, 'so the rail must not call it Not set').toBe(true);
    expect(s.rateStep.value, 'the rail states the same figure the fold does').toContain(String(s.rate));
  });

  // ── 3. Four taps ───────────────────────────────────────────────────────────
  //
  // Start proposal, Time & Materials, say the work, build the steps. At the end
  // of those four the document has a scope in work order and a rate on it, and
  // the only thing the rail still wants is the ceiling. Everything past this
  // point is him choosing to add, not him being made to.
  test('four taps put a scope and a rate on the document', async () => {
    await freshTM(page, 88803); // taps 1 and 2
    const out = await page.evaluate(() => {
      // tap 3: he says it (the mic writes into the same box the keyboard does)
      const el = document.getElementById('gei-scope-say');
      el.value = 'Pull the old water heater, run new pex to the manifold and set a tankless';
      // tap 4: build the steps
      _geiScopeBuild('tm-scope-wrap');
      return {
        chips: _geiScopeChips.slice(),
        missed: (typeof _geiScopeMissed !== 'undefined' && _geiScopeMissed) ? _geiScopeMissed.map(m => m.step) : [],
        steps: _tmSteps().map(x => ({ k: x.k, done: !!x.done, rec: !!x.rec })),
      };
    });

    expect(out.chips.length, 'one sentence, three steps').toBe(3);
    const done = out.steps.filter(s => s.done).map(s => s.k);
    expect(done, 'the work is on it').toContain('scope');
    expect(done, 'and so is the rate').toContain('rate');
    const next = out.steps.find(s => s.rec);
    expect(next && next.k, 'the only thing left to ask for is the ceiling').toBe('cap');
    // And the whole reason the sentence goes through Tim rather than into a
    // notes field: he gets back the steps he did not say.
    expect(out.missed.length, 'Tim names what was left out').toBeGreaterThan(0);
  });

  // ── 4. Agreeing with all of it costs one tap ───────────────────────────────
  //
  // A water heater swap comes back with four forgotten steps. A man who agrees
  // with all four should not have to say so four times, which is four taps
  // against a thirty second budget.
  test('add all takes the whole list in one tap, each to its own place', async () => {
    await freshTM(page, 88804);
    const out = await page.evaluate(() => {
      document.getElementById('gei-scope-say').value =
        'Pull the old water heater, run new pex to the manifold and set a tankless';
      _geiScopeBuild('tm-scope-wrap');
      const missedBefore = _geiScopeMissed.length;
      const btn = [...document.querySelectorAll('#tm-scope-wrap button')]
        .find(b => /^Add all /.test((b.textContent || '').trim()));
      const label = btn ? btn.textContent.trim() : null;
      if (btn) btn.click();
      return { missedBefore, label, missedAfter: _geiScopeMissed.length, chips: _geiScopeChips.slice() };
    });

    expect(out.missedBefore, 'a heater swap drags several steps in with it').toBeGreaterThan(1);
    // Changed 2026-09-23 (§10.4, owner: "not every job requires a permit or
    // inspection though"). The permit is his call and the unit is his to name,
    // so Add all counts and takes the rest and leaves those two to him.
    expect(out.label, 'the button counts them so he knows what he is agreeing to')
      .toBe('Add all ' + (out.missedBefore - 2));
    expect(out.missedAfter, 'only his two calls are left after the one tap').toBe(2);
    expect(out.chips.length, 'every one of them landed on the scope')
      .toBe(3 + out.missedBefore - 2);
    // Placed by stage, not appended. A shutoff step at the bottom of the list is
    // the one place it is no use to anybody.
    // THE WHOLE ORDER, not the two ends. Checking only the first and last line
    // is how "Pressure test" landed third, above "Pull the old water heater",
    // and this test still passed (2026-09-23): his own steps had no stage Tim
    // knew, counted as last, and the finish step was slotted ahead of them.
    // The gas line, the venting and the condensate (2026-09-23, owner: "tim
    // should be smart enough to add in the model and venting requirements")
    // land with the rough-in and the install they belong to.
    expect(out.chips).toEqual([
      'Shut the water off and drain it down',
      'Protect the floors along the path in and out',
      'Pull the old water heater',
      'Run new pex to the manifold',
      "Check the gas line against the new unit's full load and upsize it where it falls short",
      'Set a tankless',
      "Run new venting for the new unit, to the maker's instructions",
      'Run the condensate drain for the new unit',
      'Pressure test and check every joint for leaks',
      'Haul off debris and leave the site broom clean',
    ]);
  });

  // One missed step gets no bulk button, because "Add all 1" is not a sentence.
  test('a single forgotten step is just an Add', async () => {
    await freshTM(page, 88805);
    const out = await page.evaluate(() => {
      document.getElementById('gei-scope-say').value = 'Set the new vanity and top';
      _geiScopeBuild('tm-scope-wrap');
      return {
        missed: _geiScopeMissed.length,
        hasAll: [...document.querySelectorAll('#tm-scope-wrap button')]
          .some(b => /^Add all /.test((b.textContent || '').trim())),
      };
    });
    expect(out.missed).toBe(1);
    expect(out.hasAll).toBe(false);
  });

  // ── What the customer is handed ───────────────────────────────────────────
  //
  // Owner, 2026-09-23: "still look damn good and create a professional bid".
  // The page being quick is half of it; the other half is that nothing on the
  // document reads like a spreadsheet or like a note to the crew.
  const docFor = (p, id, addr, days) => p.evaluate(async ([cid, a, d]) => {
    document.querySelectorAll('.zmodal-overlay,#_prop-preview-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id: cid, name: 'Ray Whitcomb', addr: a, phone: '785-555-0142' });
    currentClientId = cid; openTMEstimate(getClientById(cid));
    _geiIsTM = true; _tmShowPage();
    document.getElementById('gei-scope-say').value = 'Pull the old water heater and set a tankless';
    _geiScopeBuild('tm-scope-wrap'); _geiScopeTakeAllMissed();
    if (d) { _tmStepAct('est'); document.getElementById('tm-i-days').value = String(d); }
    _tmInputChange();
    let doc = '';
    const prev = window._showProposalPreviewOverlay;
    window._showProposalPreviewOverlay = h => { doc = h; };
    try { await sendGenericProposal(true); } catch (e) {}
    window._showProposalPreviewOverlay = prev;
    document.getElementById('_prop-preview-ov')?.remove();
    const el = document.createElement('div'); el.innerHTML = doc;
    return el.textContent.replace(/\s+/g, ' ');
  }, [id, addr, days || 0]);

  test('an estimate line reads as English, not as its storage format', async () => {
    const t = await docFor(page, 88806, '12 Main St, Lancaster, PA 17601', 3);
    expect(t).toContain('Labor, 1 worker at $');
    expect(t).toContain('an hour');
    expect(t).toContain('24 hours');
    expect(t).not.toMatch(/ @ \$/);
    expect(t).not.toMatch(/×\d/);
  });

  test('the customer phone is written like a phone number', async () => {
    const t = await docFor(page, 88807, '412 Bell St, Topeka, KS 66603');
    expect(t).toContain('(785) 555-0142');
  });

  // Tim's steps land on the customer's contract, so they are written for the
  // customer: "you" there means the homeowner, and "the path you are carrying
  // through" told the homeowner they were carrying a water heater.
  test('the steps Tim adds are written for the contract, not to the crew', async () => {
    const steps = await page.evaluate(() => TIM_IMPLIED.filter(r => r.step).map(r => r.step));
    expect(steps.filter(s => /\byou\b|\byour\b/i.test(s))).toEqual([]);
  });
});
