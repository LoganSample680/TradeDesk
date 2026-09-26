// @ts-check
// ── What Tim knows ───────────────────────────────────────────────────────────
//
// Owner direction 2026-09-19 reversed half of the 2026-09-17 rule: Tim may hold
// trade knowledge now. It kept the other half, and these tests exist to hold
// THAT line, because it is the one a customer was promised: everything below
// runs with no network, no key and no model, which is why the whole file is
// pure evaluation against js/tim-knowledge.js.
//
// The other thing every test here is protecting: Tim states where a line came
// from, in the contractor's own words, and he never silently changes a number
// the contractor said.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// The materials sentence the owner wrote the feature for, said the way he said
// it: gauges, degrees, packs and counts, no units and no punctuation to help.
const ROUGH_IN = 'Two rolls of 12-2 and three of 14-2, one 6-3 for the range. '
  + 'Two hundred amp panel, forty space, dozen twenty amp singles. '
  + 'Box of single gangs and staples. '
  + 'Four inch wyes, six forty fives and four twenty two and a halfs, eighty foot of three inch. '
  + 'Twenty eight squares of architectural, six rolls of synthetic.';

const PAINT_JOB = 'T and M for the Whitfields, three days. Second floor, so scaffold on the west side. '
  + 'Gutters come off first and go back after. Five gallons of Duration in Iron Ore and a case of caulk.';

// A book the size the feature is actually used at. The rare-word weighting in
// timBookLines only means anything against a real spread of lines, so a two row
// book would prove nothing.
const BOOK = [
  { desc: 'Strip and repaint, west elevation', rate: 2180, unit: 'lot', n: 5 },
  { desc: 'Remove and reset gutters', rate: 340, unit: 'lot', n: 3 },
  { desc: 'Body and trim, two coats', rate: 0.78, unit: 'sq ft', n: 9 },
  { desc: 'Prep and pressure wash', rate: 320, unit: 'lot', n: 11 },
  { desc: 'Replace rotted trim', rate: 25.65, unit: 'lin ft', n: 6 },
  { desc: 'Strip failed paint', rate: 1.15, unit: 'sq ft', n: 4 },
  { desc: 'Caulk windows and doors', rate: 14, unit: 'ea', n: 3 },
  { desc: 'Paint front door', rate: 180, unit: 'ea', n: 2 },
  { desc: 'Stain and seal deck', rate: 2.1, unit: 'sq ft', n: 2 },
  { desc: 'Replace damaged siding boards', rate: 38, unit: 'ea', n: 2 },
  { desc: 'Haul off and dispose', rate: 150, unit: 'lot', n: 7 },
  { desc: 'Mask windows and fixtures', rate: 95, unit: 'lot', n: 4 },
];

test.describe('tim knows the trade', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── Numbers, the way a tradesman says them ────────────────────────────────
  test.describe('spoken numbers', () => {
    test('a run of number words is one number', async () => {
      const r = await page.evaluate(() => [
        timSpokenNumber('two'), timSpokenNumber('twenty eight'), timSpokenNumber('two hundred'),
        timSpokenNumber('forty'), timSpokenNumber('twenty two and a half'), timSpokenNumber('a dozen'),
      ]);
      expect(r).toEqual([2, 28, 200, 40, 22.5, 12]);
    });

    // THE WHOLE REASON THIS IS NOT A MODEL. "six forty fives" is a count and a
    // part with nothing between them, and a plain left-to-right adder reads it
    // as 51 and gets the line wrong. A ones word in front of a tens word cannot
    // be one spoken number, so it is two, and that single rule carries the
    // entire sentence below.
    test('a count touching a part is two numbers, not one', async () => {
      const r = await page.evaluate(() => timDigits(' six forty fives and four twenty two and a halfs '));
      expect(r.trim()).toBe('6 45s and 4 22.5s');
    });

    test('the whole rough-in sentence comes out in digits', async () => {
      const r = await page.evaluate(t => timDigits(_timkNorm(t)), ROUGH_IN);
      expect(r).toContain('2 rolls of 12-2');
      expect(r).toContain('3 of 14-2');
      expect(r).toContain('200 amp panel 40 space');
      expect(r).toContain('12 20 amp singles');
      expect(r).toContain('80 foot of 3 inch');
      expect(r).toContain('28 squares of architectural');
    });

    test('nothing, junk and a sentence with no numbers all survive', async () => {
      const r = await page.evaluate(() => [
        timSpokenNumber(''), timSpokenNumber(null), timSpokenNumber('banana'),
        timDigits(''), timDigits(null), timDigits('strip the south wall'),
      ]);
      expect(r).toEqual([null, null, null, '', '', 'strip the south wall']);
    });
  });

  // ── Materials ─────────────────────────────────────────────────────────────
  test.describe('materials, in the units the app already prices in', () => {
    test('twelve items across three trades, each with the count he said', async () => {
      const r = await page.evaluate(t => {
        const m = timMaterials(t);
        return {
          n: m.length,
          trades: timTradesOn(m).sort(),
          rows: m.map(x => [x.id, x.qty, x.unit, x.label]),
        };
      }, ROUGH_IN);
      expect(r.n).toBe(12);
      expect(r.trades).toEqual(['electrical', 'plumbing', 'roofing']);
      expect(r.rows).toContainEqual(['romex', 2, 'roll', '12-2 NM-B romex']);
      expect(r.rows).toContainEqual(['romex', 3, 'roll', '14-2 NM-B romex']);
      expect(r.rows).toContainEqual(['romex', 1, 'roll', '6-3 NM-B romex']);
      expect(r.rows).toContainEqual(['panel', 1, 'ea', '200 A main lug panel']);
      expect(r.rows).toContainEqual(['breaker', 12, 'ea', '20 A single pole breaker']);
      expect(r.rows).toContainEqual(['fitting-deg', 6, 'ea', '4 in PVC wye, 45 degree']);
      expect(r.rows).toContainEqual(['fitting-deg', 4, 'ea', '4 in PVC wye, 22.5 degree']);
      expect(r.rows).toContainEqual(['shingle', 28, 'square', 'Architectural shingles']);
    });

    // The size said once in front of two counted parts is the size, not an
    // eleventh fitting. "Four inch wyes, six forty fives and four twenty two
    // and a halfs" is ten fittings, not eleven.
    test('a size stated once is not counted as its own line', async () => {
      const n = await page.evaluate(t => timMaterials(t).filter(m => m.id === 'wye').length, ROUGH_IN);
      expect(n).toBe(0);
    });

    // Every unit here has to exist in _UNITS_BY_TRADE / _UNITS_EXTRA. Tim does
    // not get to invent a unit, because a unit the rest of the app cannot price
    // in is a line that cannot be edited anywhere else.
    test('every unit is one the app already carries', async () => {
      const bad = await page.evaluate(t => {
        const known = new Set([].concat(
          ...Object.values(_UNITS_BY_TRADE), _UNITS_EXTRA, _UNITS_COMMON, ['d', 'items'],
        ).map(u => String(u).toLowerCase()));
        return timMaterials(t).map(m => m.unit).filter(u => !known.has(String(u).toLowerCase()));
      }, ROUGH_IN + ' ' + PAINT_JOB);
      expect(bad).toEqual([]);
    });

    test('a count buys what the counter sells it in', async () => {
      const r = await page.evaluate(t => {
        const m = timMaterials(t);
        const by = id => timLineFigures(m.find(x => x.id === id));
        return { shingle: by('shingle'), romex: by('romex'), pvc: by('pvc-bare'), box: by('box') };
      }, ROUGH_IN);
      expect(r.shingle).toEqual({ qtyLabel: '84 bundles', packNote: '28 squares at 3 bundles' });
      expect(r.romex).toEqual({ qtyLabel: '2 rolls', packNote: '250 ft' });
      expect(r.pvc).toEqual({ qtyLabel: '80 lin ft', packNote: 'Eight 10 ft lengths' });
      expect(r.box).toEqual({ qtyLabel: '1 box', packNote: 'of 100' });
    });

    // RULE 2 OF THE FILE HEADER. His own figures disagree, Tim says both and
    // changes neither. A man who finds the app quietly editing his counts stops
    // reading the list, and an unread list is worse than no list.
    test('when his numbers disagree, both are said and neither is changed', async () => {
      const r = await page.evaluate(t => {
        const m = timMaterials(t);
        return { notes: timCoverage(m), underlay: m.find(x => x.id === 'underlay').qty };
      }, ROUGH_IN);
      expect(r.notes.length).toBe(1);
      expect(r.notes[0].line).toContain('84 bundles');
      expect(r.notes[0].line).toContain('covers 60 squares');
      expect(r.notes[0].line).toContain('I left it as you said it');
      expect(r.underlay).toBe(6);   // untouched, which is the point
    });

    test('an empty prompt is an empty list, never a crash', async () => {
      const r = await page.evaluate(() => [
        timMaterials('').length, timMaterials(null).length, timMaterials(undefined).length,
        timCoverage(null).length, timCoverage([]).length,
      ]);
      expect(r).toEqual([0, 0, 0, 0, 0]);
    });
  });

  // ── The order the work happens in ─────────────────────────────────────────
  test.describe('work order', () => {
    test('a scope said backwards comes out forwards', async () => {
      const r = await page.evaluate(() => timOrderScope([
        'Haul off debris daily',
        'Prime bare wood, two finish coats',
        'Set scaffold on the west side',
        'Strip failed paint',
      ]).map(s => s.text));
      expect(r).toEqual([
        'Set scaffold on the west side',
        'Strip failed paint',
        'Prime bare wood, two finish coats',
        'Haul off debris daily',
      ]);
    });

    // Stable inside a stage: two steps Tim puts in the same stage keep the order
    // the contractor gave them, because at that point he knows the job and Tim
    // does not. Sorting is not rewriting.
    test('two steps in the same stage keep his order', async () => {
      const r = await page.evaluate(() => timOrderScope([
        'Strip failed paint on the south elevation',
        'Strip failed paint on the west elevation',
      ]).map(s => s.text));
      expect(r[0]).toContain('south');
      expect(r[1]).toContain('west');
    });

    test('a step Tim cannot place holds its own position instead of being swept to one end', async () => {
      const r = await page.evaluate(() => timOrderScope([
        'Set scaffold',
        'Call the inspector about the meter',
        'Haul off debris',
      ]).map(s => s.text));
      expect(r[1]).toBe('Call the inspector about the meter');
    });

    test('a list already in order comes back identical', async () => {
      const r = await page.evaluate(() => {
        const l = ['Set scaffold', 'Strip failed paint', 'Prime and two coats', 'Haul off debris'];
        return timOrderScope(l).map(s => s.text);
      });
      expect(r).toEqual(['Set scaffold', 'Strip failed paint', 'Prime and two coats', 'Haul off debris']);
    });

    test('nothing, junk and objects without text are all handled', async () => {
      const r = await page.evaluate(() => [
        timOrderScope(null).length, timOrderScope([]).length, timOrderScope(['', '  ']).length,
        timOrderScope([{}, { text: '' }]).length, timOrderScope('not an array').length,
      ]);
      expect(r).toEqual([0, 0, 0, 0, 0]);
    });
  });

  // ── What the job drags in with it ─────────────────────────────────────────
  test.describe('what he did not say', () => {
    // The owner's test for this whole feature: would a 55 year old master read
    // it and think "oh yeah, I forgot that", or would it annoy him? That is why
    // it is worded as a correction with a reason, not a suggestion.
    test('second floor with no scaffold step is a correction, with the reason', async () => {
      const r = await page.evaluate(t => timImplied(t, [{ text: 'Strip failed paint' }])
        .find(x => x.id === 'access-scaffold'), PAINT_JOB);
      expect(r.say).toBe('Scaffold goes up before anything is stripped');
      expect(r.because).toBe('You never said scaffold up first. It has to be.');
      expect(r.hours).toBe(6);
      expect(r.stage).toBe('access');
    });

    test('a job that already has scaffold on it gets told nothing', async () => {
      const r = await page.evaluate(t => timImplied(t, [{ text: 'Set scaffold, west side' }])
        .some(x => x.id === 'access-scaffold'), PAINT_JOB);
      expect(r).toBe(false);
    });

    test('gutters become two steps, at the two ends of the job', async () => {
      const r = await page.evaluate(t => {
        const g = timImplied(t, [{ text: 'Strip failed paint' }]).find(x => x.id === 'protect-gutters');
        const order = timOrderScope([
          { text: 'Strip failed paint' },
          { text: g.step, stage: g.stage },
          { text: g.pairs.step, stage: g.pairs.stage },
        ]).map(s => s.text);
        return { because: g.because, order };
      }, PAINT_JOB);
      expect(r.because).toBe('Off first, back on last, the way you said');
      expect(r.order).toEqual(['Remove gutters', 'Strip failed paint', 'Rehang gutters']);
    });

    test('a rule he waved off on this job does not come back on it', async () => {
      const r = await page.evaluate(t => timImplied(t, [{ text: 'Strip failed paint' }],
        { rejected: ['access-scaffold'] }).some(x => x.id === 'access-scaffold'), PAINT_JOB);
      expect(r).toBe(false);
    });

    // SUBJECT CHANGED 2026-09-22, and the rule it guards is unchanged: Tim has
    // to be capable of saying nothing. The old subject was a kitchen faucet,
    // which stopped being a quiet job the day he learned to say "shut the water
    // off first" on a live water line. That nudge is correct on a faucet swap,
    // so the right move was a genuinely quiet job, not a weaker assertion.
    test('a quiet job gets told nothing at all', async () => {
      const r = await page.evaluate(() => timImplied('Hang the new mailbox', [{ text: 'Hang the new mailbox' }]));
      expect(r).toEqual([]);
    });

    // ── The steps a man forgets, which is the whole promise ──────────────────
    //
    // Owner: "Tim cant forget a step." He had four rules and every one of them
    // was a painter's, so the owner's own first T&M (a water heater swap) came
    // back with nothing left to add. These are the sequences that are habit in
    // every trade, and each one stays quiet unless its own system is named.
    test('a live water line gets the shutoff, first', async () => {
      const r = await page.evaluate(() => timImplied(
        'Pull the old water heater, run new pex to the manifold and set a tankless',
        [{ text: 'Pull the old water heater' }, { text: 'Run new pex to the manifold' }, { text: 'Set a tankless' }]));
      const ids = r.map(x => x.id);
      expect(ids, 'the water comes off before anything opens').toContain('access-water-off');
      expect(ids, 'and it gets tested before he leaves').toContain('finish-test');
      expect(ids, 'and the old one goes somewhere').toContain('clean-haul');
      // The first thing done ON SITE (2026-09-23, §10.4): the permit is paper,
      // and it now comes ahead of everything, which is where it belongs.
      const onSite = r.filter(x => x.id !== 'access-permit');
      expect(onSite[0].id, 'the shutoff is the first thing he reads, not the last').toBe('access-water-off');
      expect(ids[0], 'and only the paperwork comes ahead of it').toBe('access-permit');
    });

    // The reason there are three shutoff rules and not one. Half of all water
    // heaters are electric, so a sentence that never said gas never hears about
    // gas: a nudge on the wrong system is worse than no nudge.
    test('an electric water heater is never told to shut the gas off', async () => {
      const ids = await page.evaluate(() => timImplied(
        'Swap the electric water heater out', [{ text: 'Swap the electric water heater out' }]).map(x => x.id));
      expect(ids).toContain('access-water-off');
      expect(ids).not.toContain('access-gas-off');
    });

    test('a gas furnace hears about the gas valve and not the water', async () => {
      const ids = await page.evaluate(() => timImplied(
        'Swap the gas furnace out and run new black iron to it',
        [{ text: 'Swap the gas furnace out' }, { text: 'Run new black iron to it' }]).map(x => x.id));
      expect(ids).toContain('access-gas-off');
      expect(ids).not.toContain('access-water-off');
    });

    test('a panel change hears about the breaker and nothing wet', async () => {
      const ids = await page.evaluate(() => timImplied(
        'Change out the panel and pull new romex to the kitchen',
        [{ text: 'Change out the panel' }, { text: 'Pull new romex to the kitchen' }]).map(x => x.id));
      expect(ids).toContain('access-power-off');
      expect(ids).not.toContain('access-water-off');
      expect(ids).not.toContain('access-gas-off');
    });

    // The man who narrates the whole job properly is the one who must hear the
    // least. If this ever fails, the feature has become noise.
    test('a man who said all of it gets told none of it', async () => {
      const r = await page.evaluate(() => timImplied(
        'Shut the water off, pull the old heater, set the new one, pressure it up and haul the old one off',
        [{ text: 'Shut the water off' }, { text: 'Pull the old heater' }, { text: 'Set the new one' },
          { text: 'Pressure it up' }, { text: 'Haul the old one off' }]));
      expect(r.map(x => x.id)).toEqual([]);
    });

    // "Pull the old water heater" is a tear-out with two hundred pounds to get
    // rid of at the end of it. The verb list knew tear out, tear off, strip,
    // demo and replace, which is how a painter talks, so it said nothing.
    test('the haul-off knows how a man says it who is not a painter', async () => {
      const said = await page.evaluate(() => ['pull the old unit', 'take out the old range',
        'rip out the cabinets', 'swap the disposal', 'change out the condenser', 'cut out the failed section']
        .map(s => timImplied(s, [{ text: s }]).some(x => x.id === 'clean-haul')));
      expect(said, 'every one of these ends with something in the truck').toEqual(
        [true, true, true, true, true, true]);
    });

    // What he did not say comes back in the order he would do it, same spine
    // the scope itself is sorted on. It used to come back in whatever order the
    // rules sit in the file, which put haul-off above the shutoff.
    test('the forgotten steps read in work order', async () => {
      const stages = await page.evaluate(() => timImplied(
        'Pull the old water heater and set a tankless',
        [{ text: 'Pull the old water heater' }, { text: 'Set a tankless' }]).map(x => x.stage));
      const order = ['access', 'protect', 'demo', 'rough', 'repair', 'prep', 'install', 'finish', 'restore', 'clean'];
      const ix = s => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
      const sorted = stages.map(ix);
      expect(sorted, 'out of order: ' + JSON.stringify(stages))
        .toEqual([...sorted].sort((a, b) => a - b));
    });
  });

  // ── Finding the line in his own book ──────────────────────────────────────
  test.describe('his own book', () => {
    // "gutters come off first and go back after" is plainly "Remove and reset
    // gutters" and scores 0.33 on a word count, which is why spkServices misses
    // it. Weighing the words against HIS book, where "gutters" appears in one
    // line out of twelve, finds it. That weighting is the only learned thing in
    // the file, and it is learned from the book he filled.
    test('a line is found by the word that can only mean that line', async () => {
      const r = await page.evaluate(([t, b]) => timBookLines(t, b, []).map(x => x.desc), [PAINT_JOB, BOOK]);
      expect(r).toContain('Remove and reset gutters');
      expect(r).toContain('Strip and repaint, west elevation');
    });

    test('a sentence about none of it finds none of it', async () => {
      const r = await page.evaluate(b => timBookLines('what a morning', b, []), BOOK);
      expect(r).toEqual([]);
    });

    test('an empty book falls through to the shipped catalogue, and says so', async () => {
      const r = await page.evaluate(() => timBookLines('install a kitchen faucet', [],
        [{ name: 'Install kitchen faucet', labor: 200, mat: 85 }]));
      expect(r.length).toBe(1);
      expect(r[0].from).toBe('catalog');
      expect(r[0].rate).toBe(285);
    });

    test('no book and no catalogue is nothing, not a throw', async () => {
      const r = await page.evaluate(() => [
        timBookLines('anything', [], []).length, timBookLines('anything', null, null).length,
        timBookLines(null, [{ desc: 'x', rate: 1 }], []).length,
      ]);
      expect(r).toEqual([0, 0, 0]);
    });
  });

  // ── The whole spoken job ──────────────────────────────────────────────────
  test.describe('one sentence, read back', () => {
    const read = (said) => page.evaluate(([t, b]) => {
      const j = timReadJob(t, { clients: [{ id: 1, name: 'Dana Whitfield' }], book: b, catalog: [] });
      return {
        client: j.client && j.client.name, type: j.type,
        saidHours: j.saidHours, addedHours: j.addedHours, hours: j.hours,
        fromBook: j.fromBook.map(s => [s.text, s.rate, s.why]),
        implied: j.implied.map(r => r.say),
        order: j.order.map(s => s.text),
        supplies: j.materials.map(m => [m.label, m.qty, m.unit]),
      };
    }, [said, BOOK]);

    test('the whole painting job, in work order, with the hours it really takes', async () => {
      const j = await read(PAINT_JOB);
      expect(j.client).toBe('Dana Whitfield');
      expect(j.type).toBe('tm');
      // Three days is 24 hours, plus 6 for setting and striking the scaffold.
      expect(j.saidHours).toBe(24);
      expect(j.addedHours).toBe(6);
      expect(j.hours).toBe(30);
      expect(j.order).toEqual([
        'Set scaffold',
        'Remove gutters',
        'Strip and repaint, west elevation',
        'Rehang gutters',
        'Strike scaffold',
        'Haul off debris and leave the site broom clean',
      ]);
    });

    test('every priced line says where its price came from', async () => {
      const j = await read(PAINT_JOB);
      expect(j.fromBook.length).toBeGreaterThan(0);
      j.fromBook.forEach(([, , why]) => expect(why).toBe('Your price, from the last five of these'));
    });

    // A rental is priced in days, and the days are the job's. Three days of work
    // is three days on the yard ticket, not one.
    test('the rental is as long as the job', async () => {
      const j = await read(PAINT_JOB);
      expect(j.supplies).toContainEqual(['Scaffold', 3, 'd']);
    });

    // A shopping list is a supply line, not a step. It is already below and it
    // does not belong twice.
    test('what he is buying does not become something he is doing', async () => {
      const j = await read(PAINT_JOB);
      expect(j.order.join(' | ')).not.toContain('gallons');
      expect(j.supplies.map(s => s[0])).toContain('Duration exterior, Iron Ore');
    });

    test('an empty sentence reads back as nothing, not as a job', async () => {
      const r = await page.evaluate(() => {
        const j = timReadJob('', { clients: [], book: [], catalog: [] });
        return { order: j.order.length, mats: j.materials.length, hours: j.hours };
      });
      expect(r).toEqual({ order: 0, mats: 0, hours: 0 });
    });

    test('null and junk options do not throw', async () => {
      const threw = await page.evaluate(() => {
        try { timReadJob(null); timReadJob(undefined, null); timReadJob(42, {}); return false; }
        catch (e) { return true; }
      });
      expect(threw).toBe(false);
    });
  });

  // ── What he accepted stops being a guess ──────────────────────────────────
  test.describe('learning, at the same bar the price book uses', () => {
    test.beforeEach(async () => { await page.evaluate(() => { S.timLearned = {}; }); });

    // n:1, exactly as _pbLearn treats a price. One acceptance is a contractor
    // being agreeable on a Tuesday. Two is a habit.
    test('one yes is not settled, two is', async () => {
      const r = await page.evaluate(() => {
        const a = timKnows('implied', 'access-scaffold');
        timLearn('implied', 'access-scaffold', true);
        const b = timKnows('implied', 'access-scaffold');
        timLearn('implied', 'access-scaffold', true);
        return { none: a, one: b, two: timKnows('implied', 'access-scaffold') };
      });
      expect(r).toEqual({ none: false, one: false, two: true });
    });

    // He is allowed to teach Tim to shut up, and it has to stick, or the feature
    // becomes the thing he turns off.
    test('two noes drop it for good, and timImplied stops offering it', async () => {
      const r = await page.evaluate(t => {
        timLearn('implied', 'access-scaffold', false);
        timLearn('implied', 'access-scaffold', false);
        const job = timReadJob(t, { clients: [], book: [], catalog: [] });
        return { dropped: timDropped('implied', 'access-scaffold'),
          offered: job.implied.some(r2 => r2.id === 'access-scaffold') };
      }, PAINT_JOB);
      expect(r).toEqual({ dropped: true, offered: false });
    });

    test('it rides on S, so it saves and syncs like every other setting', async () => {
      const r = await page.evaluate(() => {
        timLearn('implied', 'clean-haul', true);
        return !!(S.timLearned && S.timLearned['implied:clean-haul']);
      });
      expect(r).toBe(true);
    });

    test('junk keys change nothing and throw nothing', async () => {
      const r = await page.evaluate(() => {
        timLearn(null, null, true); timLearn('', '', false);
        return [timKnows(null, null), timDropped(undefined, undefined), Object.keys(S.timLearned).length];
      });
      expect(r).toEqual([false, false, 0]);
    });
  });

  // ── The line between Tim and the code books ───────────────────────────────
  //
  // Owner 2026-09-19: Tim will be fed code books. js/code-engine.js is where
  // those live, and this group is the fence between the two. It is here before
  // the first dataset lands rather than after, because the failure it prevents
  // is a contractor reading one of Tim's habits as something his inspector
  // will hold him to.
  test.describe('tim does not speak for a code book', () => {
    // Everything in TIM_IMPLIED is sequence and habit. None of it is law, and
    // the flag is what the screen uses to keep the two under separate headings.
    test('every rule Tim owns is marked as trade knowledge, not code', async () => {
      const r = await page.evaluate(() => TIM_IMPLIED.map(x => [x.id, x.source]));
      expect(r.length).toBeGreaterThan(0);
      r.forEach(([, source]) => expect(source).toBe('trade'));
    });

    test('and it survives into what the screen is handed', async () => {
      const r = await page.evaluate(t => timImplied(t, [{ text: 'Strip failed paint' }])
        .map(x => x.source), PAINT_JOB);
      expect(r.length).toBeGreaterThan(0);
      r.forEach(source => expect(source).toBe('trade'));
    });

    // None of Tim's copy may cite a section, name a code family, or claim a
    // requirement. "It has to be" is a fact about the sequence of work;
    // "NEC 210.52 requires" is a different kind of claim entirely and does not
    // belong in a hand-written table.
    test('nothing Tim says cites a code, a section or a requirement', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        TIM_IMPLIED.forEach(r => {
          const copy = [r.say, r.because, r.step, r.pairs && r.pairs.step].filter(Boolean).join(' ');
          if (/\b(NEC|IPC|IRC|IBC|UPC|NFPA|code|article|section|§)\b/i.test(copy)) out.push([r.id, copy]);
          if (/\b(\d{3}\.\d+)\b/.test(copy)) out.push([r.id, copy]);
        });
        return out;
      });
      expect(bad).toEqual([]);
    });

    // THE GATE, and it is the engine's, not Tim's. No confirmed edition, an
    // unverified dataset, or a rule that does not exist all return nothing, and
    // Tim must not soften any of them into a rule of thumb. A plausible wrong
    // answer on a permit is the worst thing this product could ship.
    test('an unconfirmed edition gets no answer, not a guess', async () => {
      const r = await page.evaluate(() => {
        const was = S.codeEditions;
        S.codeEditions = null;
        try { return timCode('nec', 'dwelling-load', { sqft: 2200 }); }
        finally { S.codeEditions = was; }
      });
      expect(r).toBeNull();
    });

    test('an unverified dataset gets no answer either', async () => {
      const r = await page.evaluate(() => {
        codeRegister({ family: 'tst', edition: '2099', verified: false,
          rules: { thing: () => ({ ok: true, value: 42, items: [{ label: 'Should never appear', qty: 1 }] }) } });
        return timCode('tst', 'thing', {}, { edition: '2099' });
      });
      expect(r).toBeNull();
    });

    test('a rule the edition does not have gets no answer', async () => {
      const r = await page.evaluate(() => {
        codeRegister({ family: 'tst2', edition: '2099', verified: true, rules: {} });
        return timCode('tst2', 'missing-rule', {}, { edition: '2099' });
      });
      expect(r).toBeNull();
    });

    // When the engine DOES answer, Tim passes it through and adds nothing: the
    // edition and the section ride along so the line can be told from his own,
    // and no price is invented because his book prices it.
    test('a verified answer comes through with its edition and citation, and no price', async () => {
      const r = await page.evaluate(() => {
        codeRegister({ family: 'tst3', edition: '2023', verified: true, rules: {
          circuits: () => ({ ok: true, value: 2, unit: 'circuits', cite: '210.11(C)(1)',
            items: [{ label: '20 A small appliance circuit', qty: 2, unit: 'ea', why: 'Two required' }],
            assumed: ['kitchen'], warnings: [] }),
        } });
        return timCode('tst3', 'circuits', {}, { edition: '2023' });
      });
      expect(r.source).toBe('code');
      expect(r.edition).toBe('2023');
      expect(r.cite).toBe('210.11(C)(1)');
      expect(r.heading).toBe('TST3 2023');
      expect(r.items).toEqual([{ label: '20 A small appliance circuit', qty: 2, unit: 'ea', why: 'Two required' }]);
      expect(r.assumed).toEqual(['kitchen']);
      // His book prices it. The code book only says it is needed.
      r.items.forEach(i => expect(i).not.toHaveProperty('rate'));
    });

    test('no engine on the page at all is silence, not a throw', async () => {
      const r = await page.evaluate(() => {
        const was = window.codeEval;
        window.codeEval = undefined;
        try { return timCode('nec', 'anything', {}); }
        catch (e) { return 'threw'; }
        finally { window.codeEval = was; }
      });
      expect(r).toBeNull();
    });

    test('junk arguments are silence too', async () => {
      const r = await page.evaluate(() => [
        timCode(null, null), timCode('', ''), timCode('nec'), timCode(undefined, undefined, undefined, undefined),
      ]);
      expect(r).toEqual([null, null, null, null]);
    });
  });

  // ── SAY THE JOB, GET THE SCOPE ─────────────────────────────────────────────
  //
  // Owner, 2026-09-22: "I really want to retire the scope picker on every bid,
  // instead I want you to type up what youre doing or speak it to tim and he
  // builds the scope in order broken down by steps in order. Tim cant forget a
  // step."
  //
  // A picker asks a man to find his job in somebody else's list. He has already
  // said the job out loud twice before he opens the app. So these hold the
  // split: his sentence in, his steps out, in HIS words. A step that comes back
  // reworded is the feature lying to him about his own scope.
  test.describe('a sentence becomes steps', () => {
    const split = (t) => page.evaluate((x) => timScopeFrom(x), t);

    test('the way a man actually dictates one, filler and all', async () => {
      const r = await split("okay so we're gonna tear out the old vanity, run new "
        + 'supply lines, set the new vanity and top, then caulk it and test everything');
      expect(r).toEqual([
        'Tear out the old vanity',
        'Run new supply lines',
        'Set the new vanity and top',
        'Caulk it and test everything',
      ]);
    });

    // The throat clearing is not the work. "Okay so we're going to" has no
    // business in a numbered line a homeowner reads.
    test('the run-up to the sentence does not become step one', async () => {
      const r = await split('So first we are going to pull a permit. Then I will dig the trench.');
      expect(r).toEqual(['Pull a permit', 'Dig the trench']);
    });

    test('a typed list is already steps, whatever he marked them with', async () => {
      const r = await split('- tear off the old shingles\n- dry in with synthetic\n'
        + '2. new architectural shingles\n\u2022 ridge vent');
      expect(r).toEqual([
        'Tear off the old shingles',
        'Dry in with synthetic',
        'New architectural shingles',
        'Ridge vent',
      ]);
    });

    // THE ONE THAT IS ACTUALLY HARD. Both of these open with a verb after the
    // comma, and only one of them is a new step. The difference is whether
    // anything is being acted on: a step names its object, a manner phrase is
    // verbs and particles all the way down.
    test('a comma that starts a new action splits, and one that says how does not', async () => {
      expect(await split('tear out the vanity, run the supply lines'))
        .toEqual(['Tear out the vanity', 'Run the supply lines']);
      expect(await split('paint the kitchen two coats, cut and rolled'))
        .toEqual(['Paint the kitchen two coats, cut and rolled']);
      expect(await split('replace with new copper, tested and pressured up'))
        .toEqual(['Replace with new copper, tested and pressured up']);
    });

    // Regression: the verb list was harvested out of TIM_STAGES, which carries
    // "rotted" as a thing a man says. With "rotted" counted as a verb this read
    // as verbs all the way down and glued itself to the step before it.
    test('a step whose object is a material still splits off', async () => {
      const r = await split('strip the failed paint, replace rotted trim, prime and two coats');
      expect(r).toEqual([
        'Strip the failed paint',
        'Replace rotted trim',
        'Prime and two coats',
      ]);
    });

    // ── THE ONE OFF A REAL BID ────────────────────────────────────────────
    //
    // Owner, 2026-09-22, first thing he built with it: "tried to use tim to
    // build and it didnt do what I wanted it to do on the scope, it didnt
    // break anything down, just added it in one step."
    //
    // Read off td_bids, exactly as he typed it, title-casing and typos and all
    // ("Tid" for rid, "Outting" for putting). Two faults, and the first is the
    // one that matters: EVERY doubled-consonant gerund failed. "putting"
    // strips to "putt", not "put", and so do getting, setting, cutting,
    // running, digging and stripping, which is most of how a man narrates a
    // day. Neither verb in his sentence was recognised as a verb, so there was
    // nothing to split on and the whole thing came back as one step.
    test('the sentence he actually typed, broken where he meant it', async () => {
      const r = await split('Putting In A Water Softener, Getting Tid Of Some Copper '
        + 'For Pex A And Outting In A Tankless Water heater');
      expect(r).toEqual([
        'Putting In A Water Softener',
        'Getting Tid Of Some Copper For Pex A',
        'Outting In A Tankless Water heater',
      ]);
    });

    test('a doubled consonant is still the same verb', async () => {
      const r = await page.evaluate(() => ['putting', 'getting', 'setting', 'cutting',
        'running', 'digging', 'stripping'].map(w => _timkVerbLike(w)));
      expect(r, 'this is most of how a man narrates a day').toEqual(
        [true, true, true, true, true, true, true]);
    });

    // "and" is two different words. Two verbs sharing one object is ONE step;
    // two verbs with an object each is two. A dictated sentence often has no
    // commas at all, so "and" is the only seam there is.
    test('and joins a compound verb but separates two jobs', async () => {
      // One object between them: one step.
      expect(await split('Locate and cut out the failed section of main'))
        .toEqual(['Locate and cut out the failed section of main']);
      expect(await split('set the new vanity and top'))
        .toEqual(['Set the new vanity and top']);
      // A bare -ing after "and" is usually a noun in this trade.
      expect(await split('replace the rotted trim and siding'))
        .toEqual(['Replace the rotted trim and siding']);
      // An object each: two steps.
      expect(await split('pulling the old heater and running new gas line'))
        .toEqual(['Pulling the old heater', 'Running new gas line']);
    });

    test('a one word step is a step', async () => {
      const r = await split('dig the trench, lay the conduit, backfill');
      expect(r).toEqual(['Dig the trench', 'Lay the conduit', 'Backfill']);
    });

    test('nothing in, nothing out, and no throw on junk', async () => {
      expect(await split('')).toEqual([]);
      expect(await split('   \n  ')).toEqual([]);
      // 42 is not a step. A fragment with nothing to read in it is noise from a
      // stray keypress or a dictation stumble, not a line a homeowner is meant
      // to see numbered on a contract.
      expect(await page.evaluate(() => [
        timScopeFrom(null).length, timScopeFrom(undefined).length, timScopeFrom(42).length,
      ])).toEqual([0, 0, 0]);
    });

    test('the same step said twice is one step', async () => {
      const r = await split('haul off the debris. Haul off the debris.');
      expect(r.length).toBe(1);
    });
  });

  test.describe('and Tim cannot forget a step', () => {
    test('his own words come back in his own order, with the stage on each', async () => {
      const r = await page.evaluate(() => timScopeBuild(
        "tear out the old vanity, run new supply lines, set the new vanity and top, "
        + 'then caulk it and test everything'));
      expect(r.steps.map(s => s.text)).toEqual([
        'Tear out the old vanity',
        'Run new supply lines',
        'Set the new vanity and top',
        'Caulk it and test everything',
      ]);
      // Staged, so the card can say what each one is, without being moved.
      expect(r.steps[0].stageName).toBe('Tear out');
      expect(r.steps[2].stageName).toBe('Install');
    });

    // The sort is an OFFER. Tim put the caulk before the vanity went in, because
    // caulk reads as prep on a paint job and as the last thing on a vanity. He
    // was wrong and the contractor was right, which is this file's own rule.
    test('it does not quietly reorder him, it says whether sorting would move anything', async () => {
      const r = await page.evaluate(() => timScopeBuild(
        'tear out the old vanity, set the new vanity and top, caulk it'));
      expect(r.steps.map(s => s.text)[1]).toBe('Set the new vanity and top');
      expect(typeof r.outOfOrder).toBe('boolean');
    });

    // The whole point of the feature. He said second floor and never said
    // scaffold, and the proposal would not have stood up.
    test('the steps he did not say come back with the reason, in his words', async () => {
      const r = await page.evaluate(() => timScopeBuild(
        'strip the failed paint on the second floor south elevation, replace rotted trim, prime and two coats'));
      const says = r.implied.map(i => i.say).join(' | ');
      expect(says).toContain('Scaffold');
      // Never a rationale, always a thing he said or a thing on the job.
      r.implied.forEach(i => {
        expect(i.because, 'a forgotten step arrived with no reason on it').toBeTruthy();
        expect(i.source, 'trade knowledge must never masquerade as code').toBe('trade');
      });
    });

    test('a job that drags nothing in says nothing', async () => {
      const r = await page.evaluate(() => timScopeBuild('swap the kitchen faucet'));
      expect(Array.isArray(r.implied)).toBe(true);
    });

    test('junk in does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, n: timScopeBuild(null).steps.length + timScopeBuild(undefined).steps.length }; }
        catch (e) { return { ok: false, e: e.message }; }
      });
      expect(r).toEqual({ ok: true, n: 0 });
    });
  });

  // ── WHAT STOPS A CREW AT THE KERB ─────────────────────────────────────────
  //
  // Owner, 2026-09-22: "how do we beautify the property note for dog access and
  // things like that?"
  //
  // It is read by somebody standing at a gate with a toolbox in one hand, and a
  // paragraph clamped to two lines is not readable in that posture. So the
  // sentence is READ, never rewritten: his words stay exactly as typed and the
  // chips are a reading of them.
  //
  // A wrong chip is worse than no chip, because this is the one a crew ACTS on,
  // so most of these are about refusing to guess.
  test.describe('the property note, read', () => {
    const facts = (t) => page.evaluate((x) =>
      timSiteFacts(x).map(f => f.k + ':' + f.label), t);

    test('the three things the field itself asks for', async () => {
      const r = await facts('Code 4417 on the side gate. Dog is friendly but barks. '
        + 'Park on the street, the driveway cracks.');
      expect(r).toEqual(['park:Park on the street', 'dog:Dog, friendly', 'code:Gate 4417']);
    });

    // THE ONE THAT MATTERS MOST. A crew that reads "Dog" on a property with no
    // dog wastes a trip to the truck for nothing; worse, it teaches them the
    // chips lie, and then they stop reading the one that says "Dog, careful".
    test('"no dog" is a man answering the question, not a dog', async () => {
      expect(await facts('park in the alley, no dog')).toEqual(['park:Park in the alley']);
      expect(await facts('there is no dog now')).toEqual([]);
    });

    test('careful outranks friendly when both words are in there', async () => {
      const r = await facts('friendly enough but the dog bites if you reach over');
      expect(r).toEqual(['dog:Dog, careful']);
    });

    // Which code it is, because a bare 4417 makes a man try the front door
    // first and stand there.
    test('the code says what to punch it into', async () => {
      expect(await facts('lockbox 1199 by the front door')).toEqual(['code:Lockbox 1199']);
      expect(await facts('keypad 5567')).toEqual(['code:Keypad 5567']);
      expect(await facts('alarm 9911')).toEqual(['code:Alarm 9911']);
      // Said the other way round, which is how most people say it.
      expect(await facts('4417 on the side gate')).toEqual(['code:Gate 4417']);
      // A bare "code" with a specific word elsewhere takes the specific one.
      expect(await facts('the code is 8823, it is the gate')).toEqual(['code:Gate 8823']);
    });

    test('being told where NOT to park outranks being told where to', async () => {
      expect(await facts('do not park in the driveway')).toEqual(['park:Not the driveway']);
      expect(await facts("don't park on the lawn")).toEqual(['park:Not the lawn']);
      expect(await facts('no parking out front')).toEqual(['park:No parking']);
    });

    // You park ON a street and IN an alley. Getting this wrong reads as a
    // machine wrote it, which is the thing being fixed.
    test('it speaks English about where the truck goes', async () => {
      expect(await facts('park in the alley')).toEqual(['park:Park in the alley']);
      expect(await facts('park on the street')).toEqual(['park:Park on the street']);
    });

    test('a key hidden somewhere is worth a chip', async () => {
      expect(await facts('key under the mat')).toEqual(['key:Key under the mat']);
    });

    test('a note with nothing in it to find says nothing', async () => {
      expect(await facts('Nothing special, just knock twice')).toEqual([]);
      expect(await facts('')).toEqual([]);
    });

    test('junk in does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          return { ok: true, n: timSiteFacts(null).length + timSiteFacts(undefined).length
            + timSiteFacts(42).length + timSiteFacts({}).length };
        } catch (e) { return { ok: false, e: e.message }; }
      });
      expect(r).toEqual({ ok: true, n: 0 });
    });

    // Never a rewrite. Every label is either his own word or a fixed phrase
    // built from it, and the sentence itself is untouched by all of this.
    test('every fact carries an icon and a short label', async () => {
      const r = await page.evaluate(() => timSiteFacts(
        'gate code 8823, shepherd out back, do not park in the driveway, key under the mat'));
      expect(r.length).toBe(4);
      r.forEach(f => {
        expect(f.icon, 'a chip with no icon').toBeTruthy();
        expect(f.label.length, 'a label too long to read at a gate').toBeLessThan(30);
        expect(f.k).toBeTruthy();
      });
    });
  });

  test('no console errors, tim-knowledge.js', async () => {
    assertNoErrors(page, 'tim-knowledge.js');
  });
});
