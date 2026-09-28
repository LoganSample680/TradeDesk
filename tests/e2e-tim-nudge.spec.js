// @ts-check
// ── When Tim is allowed to interrupt ─────────────────────────────────────────
//
// One rule, and every test here exists to hold it: **Tim speaks when he can
// name a dollar, a percentage, or a law.** Otherwise the dock sits there with
// no pill on it and he is quiet.
//
// That bar is the entire product decision. A contractor does not open an
// assistant to chat, he opens it because it just told him something about THIS
// job that costs him money. So three sentences are banned by construction, and
// there is a test below for each:
//
//   "Ask Tim anything"       a greeting, nothing is at stake
//   "Tim has 3 suggestions"  three of what, worth what
//   anything naming AI       he is trying to get a proposal out before supper,
//                            and e2e-no-ai-copy already forbids the word
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// A job with something wrong in every category, so the ranking has something to
// rank. Individual rules are switched off below by emptying their inputs.
const LOUD = {
  // tmEst: he has put an estimated TOTAL on a time and materials job, which as
  // of 2026-09-22 is the one thing a no-price state has an opinion worth
  // repeating about. The rule used to fire on any money layer at all, which
  // since the rate defaults on meant every T&M in the state.
  state: 'Kansas', stateRule: 'none', tm: true, moneyLayers: 2, tmEst: true,
  high: true, hasAccess: false, accessCost: 285, accessDays: 3,
  accessWhere: 'west elevation', accessWhen: 'the Kellerman house in May', accessHours: 6,
  under: { at: 3, desc: 'Body and trim, two coats', rate: 0.62, bookRate: 0.78, n: 9, gap: 640 },
  owed: 1240, clientName: 'Dana Whitfield', clientFirst: 'Dana', owedDays: 41,
  overrun: { n: 3, pct: 31, hours: 9 },
  dismissed: [],
  _amounts: { 'access-missing': 285, 'under-book': 640, 'still-owes': 1240 },
};

test.describe('when tim speaks', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(() => { S.timLearned = {}; timResetDismissals(); }); });

  const nudge = (snap) => page.evaluate(s => timNudges(s), snap);

  // ── The bar ───────────────────────────────────────────────────────────────
  test.describe('a dollar, a percentage, or a law', () => {
    test('every line he is shown carries one of the three', async () => {
      const r = await nudge(LOUD);
      expect(r.length).toBeGreaterThan(0);
      r.forEach(n => {
        expect(['dollar', 'percent', 'law']).toContain(n.kind);
        expect(n.figure).toBeTruthy();
        expect(n.line).toBeTruthy();
      });
    });

    // 10.4: two of these five changed wording on 2026-09-20 and the facts
    // behind them did not. "You are under your own price on line 3" became
    // "Line 3 is under your own price"; "Your last three of these ran over"
    // became "These take longer than the estimate". Same rule, same trigger,
    // same figure. What moved is who the sentence is about. The tone test
    // below is the reason, and it is the one that now holds the line.
    test('the exact lines the design called for, all five of them', async () => {
      const r = await nudge(LOUD);
      const said = r.map(n => [n.line, n.figure]);
      expect(said).toContainEqual(['No scaffold on a second floor job', '$285']);
      expect(said).toContainEqual(['Line 3 is under your own price', '$640']);
      expect(said).toContainEqual(['Dana still owes on the last one', '$1,240']);
      expect(said).toContainEqual(['These take longer than the estimate', '31%']);
      // The figure used to be "saves 4 taps", which next to the line rendered
      // as "saves 4 taps Kansas will not make you print a price": two strings
      // that do not compose into a sentence. The figure is the state now, so
      // the bubble reads as one.
      expect(said).toContainEqual(['Kansas does not ask for one on a time and materials job', 'No total required']);
    });

    // ── He is not allowed to be a dick about it ──────────────────────────────
    //
    // The pill is the only part of Tim that speaks without being asked. It
    // turns up mid-estimate, at a kitchen table, sometimes with the customer
    // reading over the guy's shoulder. So the sentence has to be about the
    // JOB. "You are under your own price" and "Your last three ran over" are
    // both true and both about the man, and a man who feels graded by his own
    // software turns it off and never turns it back on.
    //
    // This walks every line, title, what, why, cta and alt of every rule under
    // a snapshot that fires all of them, and fails on a sentence that opens by
    // pointing, or on a word that grades rather than reports. It is deliberately
    // mechanical: tone is exactly the thing that rots one careless string at a
    // time, and a comment asking the next person to be careful has never once
    // stopped that. "you" and "your" are fine mid-sentence and everywhere in
    // the body copy, because "your own price" and "your book" are the whole
    // point: the number came off HIS books, not a market rate.
    test('nothing he says opens by pointing at the man, or grades him', async () => {
      const bad = await page.evaluate(() => {
        const snap = { state: 'Kansas', stateRule: 'none', tm: true, moneyLayers: 2,
          high: true, hasAccess: false, accessCost: 285, accessDays: 2, accessHours: 3,
          under: { at: 3, gap: 640, rate: 1200, bookRate: 1450, desc: 'Repipe', n: 6 },
          owed: 1240, owedDays: 47, clientName: 'Dana Reed', clientFirst: 'Dana',
          overrun: { n: 3, pct: 31, hours: 6 } };
        // Opening a sentence with "You are" / "You have" / "Your" makes the
        // subject the reader. Anywhere else in the sentence it is possessive
        // and welcome.
        const points = /^(you|your)\b/i;
        // Words that deliver a verdict rather than a fact. "over" and "under"
        // are NOT here: "under your own price" measures a gap against his own
        // book, which is a number, not an opinion.
        const grades = /\b(should(n't)?|must|need to|failed?|wrong|mistake|careless|sloppy|too (low|slow|late)|again|always|never learn|bad)\b/i;
        // The pointing rule is for the surfaces he shows UNASKED: the pill line
        // and the heading it opens to. The body is different, and the first run
        // of this test proved it by flagging "Your book says $1,450 and you have
        // charged that on 6 of these" and "You said second floor" — which are
        // the two most trustworthy sentences Tim owns. Both are him citing the
        // man's own records back to him, which is the opposite of grading him,
        // and both are read only after a deliberate tap. Grading is banned
        // everywhere, because there is no surface where it helps.
        const HEAD = ['line', 'title'], ALL = ['line', 'title', 'what', 'why', 'cta', 'alt'];
        const out = [];
        timNudges(snap).forEach(n => {
          ALL.forEach(k => {
            const t = String(n[k] == null ? '' : n[k]).trim();
            if (!t) return;
            if (HEAD.indexOf(k) >= 0 && points.test(t)) out.push(n.id + '.' + k + ' points: "' + t + '"');
            const g = t.match(grades);
            if (g) out.push(n.id + '.' + k + ' grades ("' + g[0] + '"): "' + t + '"');
          });
        });
        return out;
      });
      expect(bad).toEqual([]);
    });

    // A job with nothing wrong on it gets NO pill. Not an empty state, not a
    // greeting, not a count: silence, and silence costs nothing.
    test('a job with nothing wrong on it gets no pill at all', async () => {
      const r = await nudge({ state: 'Kansas', stateRule: 'none', tm: false, high: false, owed: 0 });
      expect(r).toEqual([]);
      const top = await page.evaluate(() => timTopNudge({ state: 'Kansas', stateRule: 'none', tm: false, owed: 0 }));
      expect(top).toBeNull();
    });

    // The three banned sentences, checked against the source rather than a
    // screen, because they are exactly the kind of copy that creeps back into a
    // template nobody opened.
    test('no greeting, no count of his own output, and never the word AI', async () => {
      const r = await page.evaluate(() => TIM_NUDGE_RULES.map(x => JSON.stringify(x)).join(' ').toLowerCase());
      expect(r).not.toContain('ask tim anything');
      expect(r).not.toContain('suggestion');
      expect(r).not.toMatch(/\bai\b/);
      expect(r).not.toContain('let me help');
    });

    // A rule that cannot fill in a figure does not get to interrupt him. This is
    // enforced in timNudges rather than trusted to each rule, so a rule added
    // later cannot quietly become a greeting.
    test('a rule with no figure to name is dropped, not shown blank', async () => {
      const r = await nudge(Object.assign({}, LOUD, { accessCost: 0, high: true, hasAccess: false }));
      expect(r.some(n => n.id === 'access-missing')).toBe(false);
    });
  });

  // ── One at a time, worst first ────────────────────────────────────────────
  test.describe('which one he sees', () => {
    // Money outranks a percentage outranks a law, because a dollar he is about
    // to lose is the only one of the three that moves a man mid-task. Two pills
    // is a list, and a list is something to deal with later.
    test('the biggest dollar is the one on the dock', async () => {
      const top = await page.evaluate(s => timTopNudge(s), LOUD);
      expect(top.id).toBe('still-owes');
      expect(top.figure).toBe('$1,240');
    });

    test('dollars before percentages before laws', async () => {
      const kinds = await page.evaluate(s => timNudges(s).map(n => n.kind), LOUD);
      const rank = { dollar: 3, percent: 2, law: 1 };
      for (let i = 1; i < kinds.length; i++) expect(rank[kinds[i - 1]]).toBeGreaterThanOrEqual(rank[kinds[i]]);
    });

    test('a state that will not take the contract at all says so here, not at the send button', async () => {
      const r = await nudge({ state: 'California', stateRule: 'block', tm: true,
        stateNote: 'California requires a contract amount in dollars and cents.' });
      expect(r[0].line).toBe('California will not take a time and materials contract');
      expect(r[0].cta).toBe('Switch to fixed price');
    });
  });

  // ── The payoff ────────────────────────────────────────────────────────────
  test.describe('what he gets when he taps it', () => {
    // He tapped because of $285, so $285 is the first thing on the sheet and the
    // button under it does the whole job.
    test('the figure he tapped leads, with what it is and why', async () => {
      const n = await page.evaluate(s => timNudges(s).find(x => x.id === 'access-missing'), LOUD);
      expect(n.title).toBe('$285');
      expect(n.what).toBe('Scaffold, 3 days, west elevation.');
      expect(n.why).toContain('You said second floor');
      expect(n.why).toContain('It adds 6 hours to set and strike');
      expect(n.cta).toBe('Add it to the job');
      expect(n.alt).toBe('We own one');
    });

    test('every nudge has both a way to take it and a way to refuse it', async () => {
      const r = await nudge(LOUD);
      r.forEach(n => { expect(n.cta).toBeTruthy(); expect(n.alt).toBeTruthy(); });
    });
  });

  // ── Waved off ─────────────────────────────────────────────────────────────
  test.describe('he is allowed to make it stop', () => {
    test('waved off on this job, gone from this job', async () => {
      const r = await page.evaluate(s => {
        timDismiss('bid:1', 'access-missing');
        const snap = Object.assign({}, s, { dismissed: timDismissedOn('bid:1') });
        return timNudges(snap).some(n => n.id === 'access-missing');
      }, LOUD);
      expect(r).toBe(false);
    });

    test('the other job still hears about it', async () => {
      const r = await page.evaluate(s => {
        timDismiss('bid:1', 'access-missing');
        const snap = Object.assign({}, s, { dismissed: timDismissedOn('bid:2') });
        return timNudges(snap).some(n => n.id === 'access-missing');
      }, LOUD);
      expect(r).toBe(true);
    });

    // Twice on two jobs and this kind of find stops being offered anywhere. He
    // is allowed to teach Tim to shut up, and it has to stick or he turns the
    // whole thing off instead.
    test('waved off twice and that kind of find stops for good', async () => {
      const r = await page.evaluate(s => {
        timDismiss('bid:1', 'access-missing');
        timDismiss('bid:2', 'access-missing');
        return { dropped: timDropped('nudge', 'access-missing'),
          anywhere: timNudges(Object.assign({}, s, { dismissed: [] })).some(n => n.id === 'access-missing') };
      }, LOUD);
      expect(r).toEqual({ dropped: true, anywhere: false });
    });

    test('taking it counts the other way, so a useful find is not silenced by one refusal', async () => {
      const r = await page.evaluate(s => {
        timDismiss('bid:1', 'access-missing');
        timAccepted('access-missing');
        timAccepted('access-missing');
        return timNudges(Object.assign({}, s, { dismissed: [] })).some(n => n.id === 'access-missing');
      }, LOUD);
      expect(r).toBe(true);
    });
  });

  // ── Reading the screen ────────────────────────────────────────────────────
  test.describe('the snapshot it reads', () => {
    test('it survives being called with no estimate on screen', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        const s = timJobSnapshot();
        return { obj: typeof s === 'object', nudges: timNudges(s).length };
      });
      expect(r.obj).toBe(true);
      expect(typeof r.nudges).toBe('number');
    });

    test('junk in is an empty list out, never a throw', async () => {
      const r = await page.evaluate(() => [
        timNudges(null).length, timNudges(undefined).length, timNudges({}).length,
        timNudges('nonsense').length, timTopNudge(null),
      ]);
      expect(r).toEqual([0, 0, 0, 0, null]);
    });

    test('the state is named, not abbreviated, because he reads a sentence', async () => {
      const r = await nudge(Object.assign({}, LOUD, { state: 'Kansas' }));
      expect(r.map(n => n.line).join(' ')).toContain('Kansas');
      expect(r.map(n => n.line).join(' ')).not.toMatch(/\bKS\b/);
    });
  });

  // ── THE BUTTON THAT NEVER DID ANYTHING ────────────────────────────────────
  //
  // Owner, 2026-09-21, on this exact nudge: "Tim's insights with take them off
  // don't even remove it and the flow just seems broken". It was right: there
  // was no branch for state-frees in _timTakeNudge, so the blue button closed
  // the sheet and nothing moved.
  //
  // It had also gone from wrong-button to wrong-advice. Since the rate defaults
  // on so Tim can invoice the clocked hours, "take the money blocks off" fired
  // on every T&M in a no-price state and argued against the steps an inch
  // above it. It now fires on the one case that is genuinely news, and the
  // button does the thing it says.
  test.describe('the state-frees nudge', () => {
    test('it stays quiet on a rate-only job, which is the shape it used to nag', async () => {
      const r = await nudge(Object.assign({}, LOUD, { tmEst: false, moneyLayers: 1 }));
      expect(r.map(n => n.id)).not.toContain('state-frees');
    });

    test('it speaks when a total is on a T&M job the state does not want one on', async () => {
      const r = await nudge(Object.assign({}, LOUD, { tmEst: true }));
      expect(r.map(n => n.id)).toContain('state-frees');
    });

    // A state with a price rule of its own is not the silence this is about.
    test('it stays quiet where the state does have an opinion', async () => {
      const r = await nudge(Object.assign({}, LOUD, { tmEst: true, stateRule: 'cap' }));
      expect(r.map(n => n.id)).not.toContain('state-frees');
    });

    test('the bubble reads as one sentence, not two glued together', async () => {
      const n = (await nudge(Object.assign({}, LOUD, { tmEst: true })))
        .filter(x => x.id === 'state-frees')[0];
      expect(n).toBeTruthy();
      // <b>figure</b><i>line</i>, so the two are read end to end.
      expect(n.figure + ' ' + n.line)
        .toBe('No total required Kansas does not ask for one on a time and materials job');
      // And the state is named once, not twice.
      expect((n.figure + ' ' + n.line).match(/Kansas/g).length).toBe(1);
      expect(n.figure, 'the figure went back to being a tap count').not.toMatch(/tap/i);
    });

    test('the button says what it does, and doing it takes the total off', async () => {
      const r = await page.evaluate(() => {
        // _timTakeNudge rebuilds the snapshot off the LIVE page and returns
        // early if the nudge is not really there, so the page has to be in the
        // state that produces it: a T&M with a total, at an address in a state
        // with no price rule of its own.
        _geiIsTM = true;
        _tmLayers = new Set(['rate', 'est']);
        const a = document.getElementById('gei-addr');
        if (a) a.value = '1200 Elm St, Wichita KS 67203';
        const fired = timNudges(timJobSnapshot()).map(n => n.id);
        const before = [..._tmLayers];
        _timTakeNudge('state-frees');
        return { fired, before, after: [..._tmLayers] };
      });
      expect(r.fired, 'the fixture never produced the nudge, so this proves nothing')
        .toContain('state-frees');
      expect(r.before).toContain('est');
      expect(r.after, 'the button closed the sheet and left the total on').not.toContain('est');
      // And it did not take the rate with it: that is what Tim invoices on.
      expect(r.after).toContain('rate');
    });
  });

  test('no console errors, tim-nudge.js', async () => {
    assertNoErrors(page, 'tim-nudge.js');
  });
});
