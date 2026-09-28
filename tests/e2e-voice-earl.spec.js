// @ts-check
/**
 * Earl talks to Tim for fifteen minutes.
 *
 * The audit, 2026-09-27: persona Earl, 58, iPhone SE (375 by 667), a slow
 * talker who rests twenty seconds to five minutes between thoughts, dictating
 * a plumbing job into Talk to Tim. What it found, and what these hold:
 *  - The mic restarted on every 1.5 seconds of quiet (332 restarts in 13
 *    minutes), and a restart can swallow the next first word. A build that
 *    sends the native "ended" event now restarts ONLY on that event, and keeps
 *    every word in it. An old build keeps the quiet restart (fallback).
 *  - A replaced session's late callback could end the new one (fixed in Swift,
 *    and the JS drops an old generation too).
 *  - A dead mic, a locked screen, a phone call: the panel said "Tim is
 *    listening" over nothing. Now it says Paused, tap to keep going.
 *  - The screen locked mid-sentence: a wake lock is held while he talks.
 *  - Fifteen minutes of words pushed Done talking off an SE screen.
 *  - "Nothing is added until you approve it" was not true on the estimate.
 *  - The steps: a silent 40-line cap, "no wait, make that three", "uh", spoken
 *    numbers and prices, a run-on with no punctuation, and scaffold and primer
 *    offered on a plumbing job.
 *
 * The native plugin is faked the way SFSpeechRecognizer behaves: one session
 * at a time, numbered, whose text grows as he talks and which ends itself.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SE = { width: 375, height: 667 };

// Earl's job walk, one sentence per entry, punctuated the way the phone does
// it since the plugin turned punctuation on.
const EARL = [
  'Okay so this is the Hendersons, upstairs bathroom and the basement.',
  'We are gonna shut the water off at the main first.',
  'Drain the lines down from the basement.',
  'Pull the old water heater out of the basement.',
  'It is a fifty gallon gas unit, uh, probably fifteen years old.',
  'Haul the old heater off to the scrap yard.',
  'Set a new Rheem fifty gallon gas water heater on a new stand.',
  'Put in two new shutoff valves, no wait, make that three.',
  'Run new three quarter pex from the heater to the manifold.',
  'Put the expansion tank next to the heater.',
  'Um, replace the gas flex line and the drip leg.',
  'Run new venting to the chimney liner.',
  'Install a new drain pan with a drain line to the floor drain.',
  'Then we go upstairs to the bathroom.',
  'Pull the toilet and set it aside.',
  'Replace the wax ring and the closet bolts.',
  'Reset the toilet on a new flange, you know, the old one is cracked.',
  'Replace the angle stops under the vanity.',
  'Run new supply lines to the faucet.',
  'Swap the old faucet for a new Moen faucet the customer bought.',
  'Replace the p trap and the tailpiece.',
  'Cut out the tub spout and put in a new diverter spout.',
  'Replace the shower valve cartridge.',
  'Actually scratch that.',
  'Rebuild the shower valve with a new cartridge and new seats.',
  'Open the access panel behind the tub.',
  'Check the drain and overflow for leaks.',
  'Replace the drain and overflow gasket.',
  'Patch the access panel when we are done.',
  'Snake the bathroom sink drain, it runs slow.',
  'Clear the main line from the basement cleanout.',
  'Camera the main line and show the customer.',
  'Put in a new hose bib on the back of the house.',
  'Insulate the pipes in the crawl space by the garage.',
  'Replace eighteen feet of galvanized with pex in the crawl space.',
  'Add two new shark bite couplings, like I said, only where we have to.',
  'Pressure test the new lines.',
  'Light the pilot and check the burner.',
  'Test the temperature and pressure relief valve.',
  'Set the water heater to one hundred twenty degrees.',
  'Flush the lines and check every faucet for air.',
  'Clean up the basement and the bathroom.',
  'Pull the permit for the water heater.',
];
// His rests, in real milliseconds. Fifteen minutes squeezed to seconds: a
// minute of his is about one second here, and several rests are longer than
// the old 1.5 second quiet restart, which is the point.
const RESTS = [300, 1800, 400, 2200, 500, 350, 1700, 450, 600, 2000, 300, 400];

const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

test.describe('Earl talks to Tim for fifteen minutes', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  // A fake TdVoice. `ended` says whether this is a new build that sends the
  // "ended" event. Words said into a session that is not live are LOST, the
  // way they are on a phone, and counted.
  const setup = (o) => page.evaluate((o) => {
    const f = { starts: 0, stops: 0, ends: 0, live: false, gen: 0, text: '', cbs: {}, lost: [], failNext: 0 };
    window.__f = f;
    window.__word = (w) => {
      if (!f.live) { f.lost.push(w); return; }
      f.text = f.text ? f.text + ' ' + w : w;
      f.cbs.partial && f.cbs.partial({ text: f.text, final: false, gen: f.gen });
    };
    // The phone ends the session: its minute is up, or it decided he stopped.
    window.__end = (reason) => {
      if (!f.live) return;
      f.live = false; f.ends++;
      const g = f.gen;
      if (f.text) f.cbs.partial && f.cbs.partial({ text: f.text, final: true, gen: g });
      if (o.ended) f.cbs.ended && f.cbs.ended({ text: f.text, gen: g, reason: reason || 'final' });
    };
    // The cancel race: the replaced session calling back late.
    window.__ghost = () => {
      f.cbs.partial && f.cbs.partial({ text: 'ghost words from an old session', final: false, gen: f.gen - 1 });
      f.cbs.ended && f.cbs.ended({ text: 'ghost', gen: f.gen - 1, reason: 'error' });
    };
    window._voicePlugin = () => ({
      available: async () => (o.ended
        ? { status: 'granted', onDevice: true, available: true, events: ['partial', 'ended'] }
        : { status: 'granted', onDevice: true, available: true }),
      request: async () => ({ granted: true }),
      addListener: async (n, cb) => { f.cbs[n] = cb; return { remove() { if (f.cbs[n] === cb) delete f.cbs[n]; } }; },
      start: async () => {
        f.starts++;
        if (f.failNext > 0) { f.failNext--; throw new Error('audio session busy'); }
        f.gen++; f.live = true; f.text = '';
        return o.ended ? { started: true, gen: f.gen } : { started: true };
      },
      stop: async () => { f.stops++; f.live = false; return { text: f.text }; },
    });
    // A wake lock that counts.
    const wl = { requests: 0, released: 0, active: 0 };
    window.__wl = wl;
    if (o.wake !== false) {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
        wl.requests++; wl.active++;
        const s = { type, released: false, addEventListener() {}, release: async () => { if (!s.released) { s.released = true; wl.released++; wl.active--; } } };
        return s;
      } } });
    } else {
      try { delete navigator.wakeLock; } catch (_e) {}
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    try { _voiceEndedCap = false; } catch (_e) {}
    try { _wakeLock = null; } catch (_e) {}   // js/pwa.js's one lock, fresh per test
    document.querySelectorAll('#_style-pick-ov,.zmodal-overlay,#_tim-listen,#_tim-listen-host').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id: o.id, name: 'Henderson', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
    currentClientId = o.id;
    _activeTrade = 'plumbing';
    openTMEstimate(getClientById(o.id));
  }, o);

  const hide = (hidden) => page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const box = () => page.evaluate(() => document.getElementById('gei-scope-say').value);
  const label = () => page.evaluate(() => (document.getElementById('_tim-listen-label') || {}).textContent || '');

  // The fifteen minutes, run inside the page so the timing is the page's own.
  const talk = (o) => page.evaluate(async ({ sentences, rests, sessionMs, ghostEvery }) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let born = Date.now(), restarts = 0, lastGen = window.__f.gen;
    const age = () => {
      if (window.__f.gen !== lastGen) { lastGen = window.__f.gen; born = Date.now(); restarts++; if (ghostEvery && restarts % ghostEvery === 0) window.__ghost(); }
      return Date.now() - born;
    };
    for (let i = 0; i < sentences.length; i++) {
      for (const w of sentences[i].split(' ')) {
        await sleep(12);
        age();
        // Its minute is up, mid-sentence or not.
        if (sessionMs && age() > sessionMs) { window.__end('timeout'); await sleep(5); age(); }
        window.__word(w);
      }
      // He rests. The phone often ends the session on the pause.
      const rest = rests[i % rests.length];
      if (sessionMs && rest > 1000) { await sleep(250); window.__end('final'); }
      await sleep(rest);
      age();
    }
  }, o);

  test('fifteen minutes, forty-three sentences, sessions ending every minute: every word once, no restart on quiet', async () => {
    test.setTimeout(150000);
    await setup({ id: 99301, ended: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__f.starts)).toBe(1);
    expect(await page.evaluate(() => window.__wl.active), 'the screen is kept on while he talks').toBe(1);
    await talk({ sentences: EARL, rests: RESTS, sessionMs: 1000, ghostEvery: 3 });
    const r = await page.evaluate(() => ({ starts: window.__f.starts, ends: window.__f.ends, lost: window.__f.lost.slice() }));
    expect(r.ends, 'the phone ended sessions all through it').toBeGreaterThan(10);
    expect(r.starts, 'one start, then exactly one restart per ended session: never on quiet').toBe(r.ends + 1);
    expect(r.lost, 'no word was said into a closed mic').toEqual([]);
    const said = await box();
    expect(said).not.toContain('ghost');
    expect(words(said), 'every word, in order, exactly once').toEqual(words(EARL.join(' ')));

    // ── The panel after fifteen minutes, on an SE ──
    const p = await page.evaluate(() => {
      const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const done = [...document.querySelectorAll('#_tim-listen button')].find(b => /Done talking/.test(b.textContent));
      const db = done.getBoundingClientRect();
      const tr = document.getElementById('_tim-transcript');
      return {
        panel: rect('_tim-listen'), label: rect('_tim-listen-label'), clock: rect('_tim-clock'),
        done: { top: db.top, bottom: db.bottom },
        h: innerHeight, w: innerWidth, sw: document.documentElement.scrollWidth,
        atBottom: tr.scrollHeight - tr.scrollTop - tr.clientHeight,
        clipped: tr.scrollHeight > tr.clientHeight,
        foot: document.getElementById('_tim-listen-foot').textContent,
      };
    });
    expect(p.panel.top, 'the panel starts on screen').toBeGreaterThanOrEqual(0);
    expect(p.panel.bottom).toBeLessThanOrEqual(p.h + 1);
    for (const k of ['label', 'clock', 'done']) {
      expect(p[k].top, k + ' on screen').toBeGreaterThanOrEqual(0);
      expect(p[k].bottom, k + ' on screen').toBeLessThanOrEqual(p.h + 1);
    }
    expect(p.clipped, 'the transcript is capped, not the panel').toBe(true);
    expect(p.atBottom, 'and it shows the last thing he said').toBeLessThan(3);
    expect(p.sw).toBeLessThanOrEqual(p.w + 1);
    expect(p.foot, 'the words are true: Done makes the lines').toContain('Tim makes the lines when you tap Done');
    expect(p.foot).not.toContain('Nothing is added until you approve it');

    // ── Done: the lines ──
    await page.evaluate(() => _timTalkToggle());
    await page.waitForTimeout(600);
    const b = await page.evaluate(() => ({ chips: _geiScopeChips.slice(), live: window.__f.live, missed: _geiScopeMissed.map(m => m.id) }));
    expect(b.live, 'mic off').toBe(false);
    expect(b.chips.length, 'a line per thing he said, none dropped').toBeGreaterThanOrEqual(38);
    expect(b.chips).toContain('Put in 3 new shutoff valves');
    expect(b.chips).not.toContain('Replace the shower valve cartridge');
    expect(b.chips).toContain('Rebuild the shower valve with a new cartridge and new seats');
    expect(b.chips).toContain('Pull the permit for the water heater');
    expect(b.chips.join(' ')).not.toMatch(/\b(uh|um)\b/i);
    expect(b.chips.join(' ')).not.toMatch(/you know|like I said|no wait/i);
    expect(b.chips.some(c => /Replace 18 feet of galvanized/.test(c))).toBe(true);
    expect(b.chips.some(c => /three quarter pex/.test(c)), 'a pipe size is not a sum').toBe(true);
    expect(b.missed, 'a plumbing job is not offered scaffold').not.toContain('access-scaffold');
    expect(b.missed, 'or primer').not.toContain('finish-prime-drywall');
    expect(b.missed, 'the access panel is not a breaker panel').not.toContain('access-power-off');
  });

  test('a build that sends "ended" does not restart on quiet: a long rest is just a rest', async () => {
    await setup({ id: 99302, ended: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__word('Pull'); window.__word('the'); window.__word('heater.'); });
    await page.waitForTimeout(3200);
    expect(await page.evaluate(() => window.__f.starts), 'no restart during a three second rest').toBe(1);
    // The bars lie flat while nothing is being said.
    const a = await page.evaluate(() => document.getElementById('_tim-wave').innerHTML);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getElementById('_tim-wave').innerHTML)).toBe(a);
    await page.evaluate(() => { window.__word('Set'); window.__word('a'); window.__word('tankless.'); });
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(await box()).toBe('Pull the heater. Set a tankless.');
  });

  test('an old build (no "ended") keeps the quiet restart and loses nothing across it', async () => {
    await setup({ id: 99303, ended: false });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    const part = ['Pull the old water heater.', 'Set a tankless on the wall.', 'Run new gas line to it.'];
    for (const s of part) {
      await page.evaluate((s) => s.split(' ').forEach(w => window.__word(w)), s);
      // The old build dies silently on the pause: no final, no event.
      await page.evaluate(() => { window.__f.live = false; });
      await page.waitForTimeout(2100);
    }
    const r = await page.evaluate(() => ({ starts: window.__f.starts, lost: window.__f.lost.slice() }));
    expect(r.starts, 'restarted on quiet after each dead session').toBeGreaterThanOrEqual(4);
    expect(r.lost).toEqual([]);
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(words(await box())).toEqual(words(part.join(' ')));
  });

  test('the screen locks: Paused, tap to keep going; the bars stop; tapping picks up where he left off', async () => {
    await setup({ id: 99304, ended: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    expect(await label()).toBe('Tim is listening');
    await page.evaluate(() => 'Pull the old water heater.'.split(' ').forEach(w => window.__word(w)));
    await hide(true);
    await page.waitForTimeout(300);
    const p = await page.evaluate(() => ({ live: window.__f.live, paused: _voiceIsPaused(), holds: _voiceHoldsWake() }));
    expect(await label()).toBe('Paused, tap to keep going');
    expect(p.live, 'the mic is off while the page is hidden').toBe(false);
    expect(p.holds, 'and listening no longer holds the screen on').toBe(false);
    expect(p.paused).toBe(true);
    const a = await page.evaluate(() => document.getElementById('_tim-wave').innerHTML);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getElementById('_tim-wave').innerHTML), 'the bars do not move while paused').toBe(a);
    // Back to the app: still paused, honestly, until he taps.
    await hide(false);
    await page.waitForTimeout(300);
    expect(await label()).toBe('Paused, tap to keep going');
    const starts = await page.evaluate(() => window.__f.starts);
    await page.locator('#_tim-listen-top').click();
    await page.waitForTimeout(300);
    expect(await label()).toBe('Tim is listening');
    const q = await page.evaluate(() => ({ starts: window.__f.starts, live: window.__f.live, wl: window.__wl.active }));
    expect(q.starts).toBe(starts + 1);
    expect(q.live).toBe(true);
    expect(q.wl, 'the screen is kept on again').toBe(1);
    await page.evaluate(() => 'Set a tankless.'.split(' ').forEach(w => window.__word(w)));
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(await box()).toBe('Pull the old water heater. Set a tankless.');
  });

  test('a restart that fails says Paused; a tap that works starts it again', async () => {
    await setup({ id: 99305, ended: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    await page.evaluate(() => 'Pull the old water heater.'.split(' ').forEach(w => window.__word(w)));
    // A phone call takes the audio session: the phone ends the task, and the
    // restart is refused.
    await page.evaluate(() => { window.__f.failNext = 1; window.__end('error'); });
    await page.waitForTimeout(300);
    expect(await label()).toBe('Paused, tap to keep going');
    expect(await page.evaluate(() => _voiceHoldsWake())).toBe(false);
    await page.locator('#_tim-listen-top').click();
    await page.waitForTimeout(300);
    expect(await label()).toBe('Tim is listening');
    await page.evaluate(() => 'Set a tankless.'.split(' ').forEach(w => window.__word(w)));
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(await box()).toBe('Pull the old water heater. Set a tankless.');
  });

  // Off the estimate page (which holds the screen on by itself, js/pwa.js), so
  // what is measured is listening's own hold: taken at start, let go on a
  // pause, taken again on the tap, let go at Done.
  test('the screen is kept on while he talks and let go when he stops or it pauses', async () => {
    await setup({ id: 99307, ended: true });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      goPg('pg-dash');
      const el = document.createElement('textarea'); el.id = 'zz-wake-target'; document.body.appendChild(el);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => _timTalkToggle('zz-wake-target'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__wl.active), 'held while talking').toBe(1);
    await hide(true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__wl.active), 'let go when paused').toBe(0);
    await hide(false);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__wl.active), 'not taken back until he taps').toBe(0);
    await page.locator('#_tim-listen-top').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__wl.active), 'held again').toBe(1);
    await page.evaluate(() => 'Gate code 4471.'.split(' ').forEach(w => window.__word(w)));
    await page.evaluate(() => _timTalkToggle());
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ wl: window.__wl.active, v: document.getElementById('zz-wake-target').value }));
    expect(r.wl, 'let go at Done').toBe(0);
    expect(r.v).toBe('Gate code 4471.');
    await page.evaluate(() => document.getElementById('zz-wake-target').remove());
  });

  test('a phone with no wake lock talks the same, and nothing throws', async () => {
    await setup({ id: 99306, ended: true, wake: false });
    await page.waitForTimeout(400);
    await page.evaluate(() => _timTalkToggle('gei-scope-say'));
    await page.waitForTimeout(300);
    await page.evaluate(() => 'Set a tankless.'.split(' ').forEach(w => window.__word(w)));
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(await box()).toBe('Set a tankless.');
  });

  test('the note field says what Done really does', async () => {
    const r = await page.evaluate(() => {
      const el = document.createElement('textarea'); el.id = 'zz-note-target'; document.body.appendChild(el);
      const prev = _timTalkTarget;
      _timTalkTarget = 'zz-note-target';
      const note = _timTalkFoot();
      _timTalkTarget = '_tim-say';
      const read = _timTalkFoot();
      _timTalkTarget = prev; el.remove();
      return { note, read };
    });
    expect(r.note).toBe('Keep going as long as you want. Your words go in the box when you tap Done.');
    expect(r.read, 'Tim\'s own sheet does ask before it changes anything').toContain('Nothing is added until you approve it');
  });

  test('no console errors', async () => { assertNoErrors(page, 'voice earl'); });
});

// ── What Tim makes of what Earl said ───────────────────────────────────────
test.describe('Earl\'s words, made into lines', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: SE });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });
  const split = (t) => page.evaluate((t) => timScopeFrom(t), t);

  test('W6: a long walk keeps every step, no silent cap', async () => {
    const r = await page.evaluate(() => timScopeFrom(Array.from({ length: 60 }, (_, i) => 'Replace valve number ' + (i + 1) + '.').join(' ')).length);
    expect(r).toBe(60);
  });

  test('W7: "no wait, make that three" replaces the number; "scratch that" drops the clause', async () => {
    expect(await split('Put in two new valves, no wait, make that three.')).toEqual(['Put in 3 new valves']);
    expect(await split('Put in two new valves. No wait, make that three.')).toEqual(['Put in 3 new valves']);
    expect(await split('Run 40 feet of pex, actually make it 60.')).toEqual(['Run 60 feet of pex']);
    expect(await split('Replace the cartridge. Actually scratch that. Rebuild the valve.')).toEqual(['Rebuild the valve']);
    expect(await split('pull the heater then set a tank scratch that set a tankless')).toEqual(['Pull the heater', 'Set a tankless']);
    // Run-on: only the last step goes, never half the job.
    expect(await split('pull the toilet set it aside replace the wax ring scratch that replace the flange')).toEqual(['Pull the toilet', 'Set it aside', 'Replace the flange']);
    // "make it" with nothing to correct is left as he said it.
    expect(await split('Put in the vanity and make it level.')).toEqual(['Put in the vanity and make it level']);
  });

  test('W8: "uh", "um", "you know", "like I said" come out; umbrella and plumbing stay', async () => {
    expect(await split('We uh pull the um old heater, you know, then haul it off like I said.')).toEqual(['Pull the old heater', 'Haul it off']);
    expect(await split('Move the umbrella stand by the plumbing wall.')).toEqual(['Move the umbrella stand by the plumbing wall']);
    expect(await split('Call and let you know when it ships.')).toEqual(['Call and let you know when it ships']);
  });

  test('W9: number words are digits, prices are dollars, and a pipe size is left alone', async () => {
    const r = await page.evaluate(() => [
      'two', 'eighteen hundred', 'twenty five hundred dollars', 'three and a half hours', 'two hundred and fifty dollars',
      'two fifty dollars', 'haul the old one away', 'three quarter pex', 'half the wall', 'a hundred feet',
    ].map(t => _timkNumbers(t)));
    expect(r).toEqual(['2', '1800', '$2500', '3.5 hours', '$250', '$250', 'haul the old one away', 'three quarter pex', 'half the wall', '100 feet']);
  });

  test('W9: a price he says reaches the line price, on Build Your Own and the quick invoice', async () => {
    const r = await page.evaluate(() => {
      const s = timScopeBuild('Replace the shutoff valve for two hundred and fifty dollars. Set a tankless.', { rejected: [] }).steps;
      return s.map(x => [x.text, x.price]);
    });
    expect(r).toEqual([['Replace the shutoff valve', 250], ['Set a tankless', 0]]);
    // A price in the middle of a sentence is not the line's price.
    const mid = await page.evaluate(() => timScopeBuild('The tankless would be twenty five hundred dollars if they want it.', { rejected: [] }).steps.map(x => [x.text, x.price]));
    expect(mid).toEqual([['The tankless would be $2500 if they want it', 0]]);

    const byo = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      bids.length = 0; clients.length = 0;
      clients.push({ id: 99311, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603' });
      currentClientId = 99311; _activeTrade = 'plumbing';
      S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [{ desc: 'Replace the shutoff valve', rate: 90, unit: 'ea', n: 3 }];
      openGenericEstimate(getClientById(99311), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      document.getElementById('byo-say').value = 'Replace the shutoff valve for two hundred and fifty dollars. Snake the main line.';
      _byoSayBuild();
      return _byoItems.filter(x => !x._rrp).map(x => [x.label, x.price]);
    });
    expect(byo).toContainEqual(['Replace the shutoff valve', 250]);
    expect(byo).toContainEqual(['Snake the main line', 0]);

    const qi = await page.evaluate(() => {
      openQuickInvoice(99311); _qiSetMode('set');
      document.getElementById('qi-say').value = 'Snaked the main line for three hundred dollars';
      _qiSayBuild();
      return _qi.typed.map(l => [l.desc, l.amount]);
    });
    expect(qi).toContainEqual(['Snaked the main line', 300]);
  });

  test('W10: a run-on with no punctuation splits into sensible lines', async () => {
    const run = 'i pulled the old water heater i set a tankless also run new gas line so we need to vent it out the side wall '
      + 'and then flush the lines next check every faucet after that clean up the basement';
    const r = await split(run);
    expect(r).toEqual([
      'Pulled the old water heater', 'Set a tankless', 'Run new gas line', 'Vent it out the side wall',
      'Flush the lines', 'Check every faucet', 'Clean up the basement',
    ]);
    // A place is not a joiner.
    expect(await split('put the expansion tank next to the heater')).toEqual(['Put the expansion tank next to the heater']);
    // "also" joining two nouns is not two steps.
    expect(await split('paint the walls and also the ceiling')).toEqual(['Paint the walls and also the ceiling']);
  });

  test('W10: Earl\'s whole walk with no punctuation never piles sentences into one line', async () => {
    const run = EARL.join(' ').replace(/[.,;!?]/g, '').toLowerCase();
    const r = await split(run);
    expect(r.length).toBeGreaterThanOrEqual(35);
    const longest = Math.max(...r.map(l => words(l).length));
    expect(longest, 'no line holds a paragraph').toBeLessThanOrEqual(22);
  });

  test('trade filter: a plumbing job is not offered scaffold or primer; a paint job still is', async () => {
    const r = await page.evaluate(() => {
      const ids = (t, trade) => timImplied(t, timScopeFrom(t).map(x => ({ text: x })), { trade }).map(x => x.id);
      return {
        plumbUpstairs: ids('Replace the toilet in the upstairs bathroom and patch the drywall', 'plumbing'),
        plumbNoTrade: ids('Replace the toilet in the upstairs bathroom', ''),
        paint: ids('Second floor, strip and repaint the west elevation, patch the drywall', 'painting'),
        paintNoTrade: ids('Second floor, strip and repaint the west elevation', ''),
      };
    });
    expect(r.plumbUpstairs).not.toContain('access-scaffold');
    expect(r.plumbUpstairs).not.toContain('finish-prime-drywall');
    expect(r.plumbUpstairs).not.toContain('prep-consumables');
    expect(r.plumbNoTrade, 'upstairs indoors is not a scaffold job whatever the trade').not.toContain('access-scaffold');
    expect(r.paint).toContain('access-scaffold');
    expect(r.paint).toContain('prep-consumables');
    expect(r.paintNoTrade).toContain('access-scaffold');
  });

  test('no console errors', async () => { assertNoErrors(page, 'voice earl lines'); });
});
