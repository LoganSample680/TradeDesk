// @ts-check
/**
 * Type it or Talk to Tim, in every trade.
 *
 * Owner, 2026-09-23: "In the spot where we type the work does it change per
 * trade? Cause what I want (for marketing) is to say type it or Talk to Tim
 * where they speak what all they are doing, Tim parses it, organizes it and
 * finds gaps so the scope of work is detailed and nothing is forgotten."
 *
 * Run against one spoken job per trade, Tim found a plumber's gaps and a
 * haul-off for everybody else, and nothing at all on a paint job. The box
 * showed a bathroom vanity to a roofer. These hold the promise per trade:
 * the sentence each trade actually says, and the steps that trade leaves off
 * the paper. They also hold the other half of the rule, that Tim stays quiet
 * when the man said it himself.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('type it or talk to Tim, in every trade', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const gaps = (said) => page.evaluate((s) => {
    const b = timScopeBuild(s, { rejected: [] });
    return b.implied.filter(i => i.step).map(i => i.id);
  }, said);

  // ── WHAT EACH TRADE LEAVES OFF THE PAPER ──────────────────────────────────

  test('plumbing: water off, permit, protect the path, test, haul off', async () => {
    const ids = await gaps('pull the old water heater, run new pex to the manifold and set a tankless');
    expect(ids).toEqual(expect.arrayContaining(['access-water-off', 'access-permit', 'protect-path', 'finish-test', 'clean-haul']));
  });

  test('electrical: power off, permit, test and label', async () => {
    const ids = await gaps('swap the old panel for a 200 amp, run a new circuit to the garage and add two outlets');
    expect(ids).toEqual(expect.arrayContaining(['access-power-off', 'access-permit', 'finish-circuits']));
  });

  test('roofing: permit, tarp, flashing, magnet sweep', async () => {
    const ids = await gaps('tear off the old shingles, replace rotted decking, put down ice and water shield and shingle it');
    expect(ids).toEqual(expect.arrayContaining(['access-permit', 'protect-landscape', 'install-flashing', 'clean-magnet']));
    // He said ice and water shield, so Tim does not tell him about it.
    expect(ids).not.toContain('install-underlayment');
  });

  test('painting: cover and mask, and a walk-through', async () => {
    const ids = await gaps('pressure wash the house, scrape and caulk the trim, prime the bare wood and paint two coats');
    expect(ids).toEqual(expect.arrayContaining(['protect-mask-outside', 'clean-walkthrough']));
  });

  test('painting inside: the floors and furniture are covered, not the plants', async () => {
    const ids = await gaps('paint the kitchen walls and ceiling two coats');
    expect(ids).toContain('protect-mask-inside');
    expect(ids).not.toContain('protect-mask-outside');
  });

  test('HVAC: permit, recover the refrigerant, vacuum the lines, start it up', async () => {
    const ids = await gaps('pull the old furnace and ac, set a new heat pump and air handler, and run a new line set');
    expect(ids).toEqual(expect.arrayContaining(['access-permit', 'demo-refrigerant', 'finish-vacuum', 'finish-startup']));
  });

  test('flooring: acclimate, move the furniture, baseboards and transitions', async () => {
    const ids = await gaps('rip out the carpet in the living room, level the subfloor and lay luxury vinyl plank');
    expect(ids).toEqual(expect.arrayContaining(['access-acclimate', 'protect-furniture', 'restore-floor-trim']));
  });

  test('drywall after a leak: dust, dry before closing up, prime', async () => {
    const ids = await gaps('cut out the water damaged drywall in the basement, hang new board, tape and mud it and texture');
    expect(ids).toEqual(expect.arrayContaining(['protect-dust', 'repair-dry', 'finish-prime-drywall']));
  });

  // ── AND QUIET WHEN HE SAID IT ─────────────────────────────────────────────

  test('a roofer who said all of it hears none of the roof rules', async () => {
    const ids = await gaps('pull the permit, tarp the landscaping, tear off the old shingles, dry in with synthetic underlayment, '
      + 'new drip edge and flashing, architectural shingles, magnet sweep and haul off');
    ['access-permit', 'protect-landscape', 'install-underlayment', 'install-flashing', 'clean-magnet', 'clean-haul']
      .forEach(id => expect(ids, id).not.toContain(id));
  });

  test('an HVAC tech who said all of it hears none of the HVAC rules', async () => {
    const ids = await gaps('pull the permit, recover the refrigerant, pull the old condenser, set the new one, '
      + 'run a new line set, pull a vacuum, start it up and haul off the old unit');
    ['access-permit', 'demo-refrigerant', 'finish-vacuum', 'finish-startup'].forEach(id => expect(ids, id).not.toContain(id));
  });

  // The rules above are Tim's habits, and they go on a contract the homeowner
  // reads. Same standing rules as the rest of TIM_IMPLIED.
  test('every new step is written for the contract, and none claims to be code', async () => {
    const bad = await page.evaluate(() => TIM_IMPLIED.filter(r => {
      const copy = [r.say, r.because, r.step, r.pairs && r.pairs.step].filter(Boolean).join(' ');
      return /\b(NEC|IPC|IRC|IBC|UPC|NFPA|code|article|section|requires?|required)\b/i.test(copy)
        || /\byou\b|\byour\b/i.test(r.step || '') || r.source !== 'trade';
    }).map(r => r.id));
    expect(bad).toEqual([]);
  });

  // ── THE UNIT AND WHAT IT HOOKS UP TO (owner, 2026-09-23) ──────────────────
  //
  // "tim should be smart enough to add in the model and venting requirements".
  const all = (said) => page.evaluate((s) => timScopeBuild(s, { rejected: [] }).implied.map(i => i.id), said);

  test('a gas tankless: the gas line, the venting, the condensate, and which unit', async () => {
    const ids = await all('pull the old water heater and set a tankless');
    expect(ids).toEqual(expect.arrayContaining(['install-gas-size', 'install-vent', 'install-condensate', 'detail-model']));
  });

  test('an electric tankless has no gas line and no flue to ask about', async () => {
    const ids = await all('pull the old water heater and set an electric tankless');
    ['install-gas-size', 'install-vent', 'install-condensate'].forEach(id => expect(ids, id).not.toContain(id));
  });

  test('quiet when he said it: the unit named, the vent and gas line in his words', async () => {
    const ids = await all('pull the old water heater, upsize the gas line, set a Navien NPE-240A tankless, run new venting and the condensate line to the drain');
    ['install-gas-size', 'install-vent', 'install-condensate', 'detail-model'].forEach(id => expect(ids, id).not.toContain(id));
    // A model number alone is enough, no maker needed.
    expect(await all('swap the furnace for a new 96% furnace, model GMVC960803BN')).not.toContain('detail-model');
  });

  test('a paint job has no unit to name', async () => {
    expect(await all('paint the kitchen walls and ceiling two coats')).not.toContain('detail-model');
  });

  // The permit is his call (owner: "not every job requires a permit or
  // inspection though"). Asked, never swept in, and he is only asked twice.
  const tmMissed = (said) => page.evaluate((s) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id: 94002, name: 'Sam Ortiz', addr: '412 Bell St, Topeka, KS 66603' });
    currentClientId = 94002; _activeTrade = 'plumbing';
    openTMEstimate(getClientById(94002));
    document.getElementById('gei-scope-say').value = s;
    _geiScopeBuild('tm-scope-wrap');
  }, said);

  test('Add all leaves the permit and the unit for him', async () => {
    await tmMissed('pull the old water heater and set a tankless');
    const r = await page.evaluate(() => {
      const pill = [...document.querySelectorAll('#tm-scope-wrap button')].find(b => /^Add all/.test(b.textContent));
      const before = _geiScopeMissed.length;
      _geiScopeTakeAllMissed();
      return { pill: pill && pill.textContent, before, left: _geiScopeMissed.map(m => m.id).sort(), chips: _geiScopeChips.slice() };
    });
    expect(r.left).toEqual(['access-permit', 'detail-model']);
    expect(r.pill).toBe('Add all ' + (r.before - 2));
    expect(r.chips.join(' ')).not.toMatch(/permit/i);
  });

  test('he names the unit and it goes into his own line; blank does nothing', async () => {
    await tmMissed('pull the old water heater and set a tankless');
    const r = await page.evaluate(() => {
      _geiScopeTakeMissed('detail-model');
      const blank = { chips: _geiScopeChips.slice(), still: _geiScopeMissed.some(m => m.id === 'detail-model') };
      document.getElementById('tim-ask-detail-model').value = 'Rinnai RE199iN';
      _geiScopeTakeMissed('detail-model');
      return { blank, chips: _geiScopeChips.slice(), still: _geiScopeMissed.some(m => m.id === 'detail-model') };
    });
    expect(r.blank.still).toBe(true);
    expect(r.blank.chips).toEqual(['Pull the old water heater', 'Set a tankless']);
    expect(r.chips).toEqual(['Pull the old water heater', 'Set a tankless, Rinnai RE199iN']);
    expect(r.still).toBe(false);
  });

  test('the answer field is big enough for a thumb and does not zoom the page', async () => {
    await tmMissed('pull the old water heater and set a tankless');
    const r = await page.evaluate(() => {
      const f = document.getElementById('tim-ask-detail-model');
      const b = f.getBoundingClientRect();
      return { h: b.height, fs: parseFloat(getComputedStyle(f).fontSize) };
    });
    expect(r.h).toBeGreaterThanOrEqual(44);
    expect(r.fs).toBeGreaterThanOrEqual(16);
  });

  test('turned down twice on water heaters, he stops asking there, and still asks on a panel', async () => {
    const r = await page.evaluate(() => {
      const st = (typeof _timStore === 'function') ? _timStore() : null;
      if (st) Object.keys(st).filter(k => /access-permit/.test(k)).forEach(k => delete st[k]);
      const offered = s => timScopeBuild(s, { rejected: [] }).implied.some(i => i.id === 'access-permit');
      const drop = s => { const im = timScopeBuild(s, { rejected: [] }).implied.find(i => i.id === 'access-permit'); _timMissLearn(im, false); };
      drop('pull the old water heater and set a tankless');
      const afterOne = offered('swap the water heater');
      drop('pull the old water heater and set a new one');
      return { afterOne, afterTwo: offered('swap the water heater'), panel: offered('swap the old panel for a 200 amp') };
    });
    expect(r.afterOne).toBe(true);
    expect(r.afterTwo).toBe(false);
    expect(r.panel).toBe(true);
  });

  // ── THE BOX ───────────────────────────────────────────────────────────────

  const openFor = (trade, voice) => page.evaluate(([t, v]) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    window.__voice = v;
    if (!window.__realVoiceCapable) window.__realVoiceCapable = window._voiceCapable;
    window._voiceCapable = () => !!window.__voice;
    clients.length = 0; bids.length = 0;
    clients.push({ id: 94001, name: 'Sam Ortiz', addr: '412 Bell St, Topeka, KS 66603' });
    currentClientId = 94001;
    _activeTrade = t;
    openTMEstimate(getClientById(94001));
    return {
      ph: document.getElementById('gei-scope-say').placeholder,
      talk: [...document.querySelectorAll('#tm-scope-wrap button')].some(b => /Talk to Tim/.test(b.textContent)),
      foot: document.querySelector('#tm-scope-wrap .ios-foot').textContent,
    };
  }, [trade, voice]);

  test('the example in the box is the contractor\'s own trade', async () => {
    const roof = await openFor('roofing', false);
    expect(roof.ph).toContain('shingles');
    const hvac = await openFor('hvac', false);
    expect(hvac.ph).toContain('heat pump');
    const paint = await openFor('painting', false);
    expect(paint.ph).toContain('two coats');
  });

  test('with the app\'s microphone, Talk to Tim sits under the box', async () => {
    const r = await openFor('plumbing', true);
    expect(r.talk).toBe(true);
    expect(r.foot).toContain('Tim puts it in order and finds what you left out');
  });

  test('in a browser, it points at the keyboard mic instead', async () => {
    const r = await openFor('plumbing', false);
    expect(r.talk).toBe(false);
    expect(r.foot).toContain('tap the mic on your keyboard');
  });

  // Talk to Tim means he takes it from there: when the man stops talking,
  // the steps are built, in his words, with what he left out.
  test('when he stops talking, the steps are built without another tap', async () => {
    await openFor('plumbing', true);
    const r = await page.evaluate(async () => {
      const realStart = window._voiceStart, realStop = window._voiceStop;
      window._voiceStart = () => {};
      window._voiceStop = () => Promise.resolve('pull the old water heater and set a tankless');
      try {
        _timTalkToggle('gei-scope-say');
        _timTalkToggle('gei-scope-say');
        await new Promise(res => setTimeout(res, 50));
      } finally { window._voiceStart = realStart; window._voiceStop = realStop; }
      return { chips: _geiScopeChips.slice(), missed: _geiScopeMissed.length };
    });
    expect(r.chips).toEqual(['Pull the old water heater', 'Set a tankless']);
    expect(r.missed).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await page.evaluate(() => { if (window.__realVoiceCapable) window._voiceCapable = window.__realVoiceCapable; }).catch(() => {});
  });

  test('no console errors', async () => { assertNoErrors(page, 'every trade'); });
});
