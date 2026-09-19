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
  state: 'Kansas', stateRule: 'none', tm: true, moneyLayers: 2,
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

    test('the exact lines the design called for, all five of them', async () => {
      const r = await nudge(LOUD);
      const said = r.map(n => [n.line, n.figure]);
      expect(said).toContainEqual(['No scaffold on a second floor job', '$285']);
      expect(said).toContainEqual(['You are under your own price on line 3', '$640']);
      expect(said).toContainEqual(['Dana still owes on the last one', '$1,240']);
      expect(said).toContainEqual(['Your last three of these ran over', '31%']);
      expect(said).toContainEqual(['Kansas will not make you print a price', 'saves 4 taps']);
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

  test('no console errors, tim-nudge.js', async () => {
    assertNoErrors(page, 'tim-nudge.js');
  });
});
