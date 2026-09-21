// @ts-check
// ── What Tim was told, and what he could not place ───────────────────────────
//
// Owner ask, 2026-09-20: "I just want him to understand what I'm saying and we
// can log how he's being interacted with so if somebody asks something he
// doesn't know we can make those improvements."
//
// So the thing under test is not really the transcript. Anyone can push strings
// into an array. What has to hold is the part that makes the log worth opening:
//
//   1. A sentence Tim placed produces NO miss. A list that flags words he
//      understood is a list nobody reads twice, and then the real gaps are
//      invisible, which is worse than having no list.
//   2. A sentence he could not place is recorded AS that, in his own words,
//      not silently dropped. That branch is the whole reason this exists.
//   3. It never throws and never blocks him. It runs on every sentence, so a
//      log that can break the thing it logs is a net loss.
//   4. It stays on this phone. §18.3, and the log is nothing but customer
//      names, site addresses and prices.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SEED = () => {
  _activeTrade = 'painting';
  S.priceBook = { painting: [
    { desc: 'Strip and repaint, west elevation', rate: 2180, unit: 'lot', n: 5, last: '2026-05-02' },
    { desc: 'Prep and pressure wash', rate: 320, unit: 'lot', n: 11, last: '2026-07-01' },
  ] };
  clients.length = 0;
  clients.push({ id: 55501, name: 'Dana Whitfield', phone: '316-555-0101',
    addr: '1200 Elm St, Wichita KS 67203', email: 'dana@ts.test' });
};

test.describe('the tim log', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(SEED);
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => { await page.evaluate(() => timLogClear()); });

  test.describe('what it keeps', () => {
    test('a sentence and what he made of it land together', async () => {
      const r = await page.evaluate(() => {
        timLogSay('strip and repaint the west elevation', { kind: 'read', read: {
          order: [{ text: 'Strip and repaint, west elevation' }], materials: [], hours: 16,
        } });
        const e = timLogEntries()[0];
        return { said: e.said, kind: e.kind, got: e.got, n: timLogEntries().length };
      });
      expect(r.n).toBe(1);
      expect(r.said).toBe('strip and repaint the west elevation');
      expect(r.kind).toBe('read');
      // The summary is the point: the sentence alone never says why he failed.
      expect(r.got).toContain('1 step');
      expect(r.got).toContain('16 hrs');
    });

    test('newest first, because the one being diagnosed is the last one said', async () => {
      const r = await page.evaluate(() => {
        timLogSay('first thing', { kind: 'none' });
        timLogSay('second thing', { kind: 'none' });
        return timLogEntries().map(e => e.said);
      });
      expect(r).toEqual(['second thing', 'first thing']);
    });

    test('it stops at sixty, so a phone never carries an unbounded log', async () => {
      const r = await page.evaluate(() => {
        for (let i = 0; i < 75; i++) timLogSay('sentence ' + i, { kind: 'none' });
        const all = timLogEntries();
        return { n: all.length, newest: all[0].said, oldest: all[all.length - 1].said };
      });
      expect(r.n).toBe(60);
      expect(r.newest).toBe('sentence 74');
      // The first fifteen fell off the front, not the back.
      expect(r.oldest).toBe('sentence 15');
    });

    test('a dictated paragraph cannot push the rest of the log out by itself', async () => {
      const r = await page.evaluate(() => {
        timLogSay('x'.repeat(4000), { kind: 'none' });
        return timLogEntries()[0].said.length;
      });
      expect(r).toBe(240);
    });

    test('it survives a reload, which is the whole reason it is on disk', async () => {
      await page.evaluate(() => timLogSay('the gutters come off first', { kind: 'none' }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppBoot(page);
      const r = await page.evaluate(() => timLogEntries().map(e => e.said));
      expect(r).toEqual(['the gutters come off first']);
      await page.evaluate(SEED);
    });
  });

  test.describe('the words he did not know', () => {
    test('a sentence he placed leaves no miss behind', async () => {
      const r = await page.evaluate(() => timLogGaps(
        'strip and repaint the west elevation for Dana',
        { order: [{ text: 'Strip and repaint, west elevation' }],
          client: { name: 'Dana Whitfield' }, materials: [], fromBook: [], implied: [] }));
      expect(r).toEqual([]);
    });

    test('a word nothing in the read accounts for is the miss', async () => {
      const r = await page.evaluate(() => timLogGaps(
        'strip the west elevation and reglaze the transoms',
        { order: [{ text: 'Strip and repaint, west elevation' }],
          materials: [], fromBook: [], implied: [] }));
      expect(r).toContain('reglaze');
      expect(r).toContain('transoms');
      // And nothing he did account for rode along with them.
      expect(r).not.toContain('strip');
      expect(r).not.toContain('elevation');
    });

    test('a longer word counts as placing the shorter one he said', async () => {
      // Generous on purpose: he said "paint", the book line reads "repaint".
      // Flagging that as a gap is how a miss list loses its credibility.
      const r = await page.evaluate(() => timLogGaps('paint the siding',
        { order: [{ text: 'Strip and repaint the siding' }], materials: [], fromBook: [], implied: [] }));
      expect(r).toEqual([]);
    });

    test('a material he matched is not a miss, even when no step names it', async () => {
      const r = await page.evaluate(() => timLogGaps('five gallons of Duration in Iron Ore',
        { order: [], fromBook: [], implied: [],
          materials: [{ heard: 'duration', label: 'Duration exterior, Iron Ore' }] }));
      expect(r).not.toContain('duration');
      expect(r).not.toContain('iron');
    });

    test('the filler words in the middle of a sentence are never a gap', async () => {
      const r = await page.evaluate(() => timLogGaps(
        'and then you should also take the thing out of there',
        { order: [], materials: [], fromBook: [], implied: [] }));
      expect(r).toEqual([]);
    });

    test('with no read at all, every real word is a miss', async () => {
      const r = await page.evaluate(() => timLogGaps('reglaze the transoms', null));
      expect(r).toEqual(['reglaze', 'transoms']);
    });

    test('a word said three times is counted three times, and sorts to the top', async () => {
      const r = await page.evaluate(() => {
        for (let i = 0; i < 3; i++) timLogSay('reglaze the transoms', { kind: 'none' });
        timLogSay('soffit', { kind: 'none' });
        return timLogMisses();
      });
      expect(r[0].word).toBe('reglaze');
      expect(r[0].n).toBe(3);
      expect(r.find(m => m.word === 'soffit').n).toBe(1);
    });
  });

  test.describe('the ones he could not place at all', () => {
    test('a sentence that resolved to nothing is kept as exactly that', async () => {
      const r = await page.evaluate(() => {
        timLogSay('reglaze the transoms on the north side', { kind: 'none' });
        const b = timLogBlanks();
        return { n: b.length, said: b[0].said, got: b[0].got };
      });
      expect(r.n).toBe(1);
      expect(r.said).toBe('reglaze the transoms on the north side');
      expect(r.got).toContain('could not place');
    });

    test('a sentence he did place is not a blank', async () => {
      const r = await page.evaluate(() => {
        timLogSay('build me a t and m for dana', { kind: 'build', style: 'tm' });
        return { blanks: timLogBlanks().length, got: timLogEntries()[0].got };
      });
      expect(r.blanks).toBe(0);
      expect(r.got).toContain('Opened');
    });
  });

  test.describe('it can never break the thing it is logging', () => {
    test('junk in place of a read is recorded, not thrown', async () => {
      const r = await page.evaluate(() => {
        const out = [];
        [null, undefined, 0, 'nope', { order: 'not an array' }, { materials: [null] }].forEach(bad => {
          try { out.push(!!timLogSay('a sentence', { kind: 'read', read: bad })); }
          catch (e) { out.push('THREW: ' + e.message); }
        });
        return out;
      });
      expect(r).toEqual([true, true, true, true, true, true]);
    });

    test('an empty or absent sentence still returns an entry rather than throwing', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: !!timLogSay('', {}) && !!timLogSay(null, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('a corrupted log on disk reads as empty instead of breaking the boot', async () => {
      await page.evaluate(() => localStorage.setItem('td_tim_log', '{not json at all'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppBoot(page);
      const r = await page.evaluate(() => ({ n: timLogEntries().length, tim: typeof openTim }));
      expect(r.n).toBe(0);
      expect(r.tim).toBe('function');
      await page.evaluate(SEED);
    });
  });

  test.describe('saying it through the real door', () => {
    test('what he types into Tim is what lands in the log', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'reglaze the transoms on the north side';
        _timGo();
        document.getElementById('_tim-ov')?.remove();
        return timLogEntries().map(e => ({ said: e.said, kind: e.kind }));
      });
      expect(r.length).toBe(1);
      expect(r[0].said).toBe('reglaze the transoms on the north side');
      // Nothing on the dashboard answers that sentence, which is the branch
      // this whole file was written for.
      expect(r[0].kind).toBe('none');
    });

    test('an empty box is not an interaction and is not logged', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = '   ';
        _timGo();
        document.getElementById('_tim-ov')?.remove();
        return timLogEntries().length;
      });
      expect(r).toBe(0);
    });

    test('a build is logged as the door it opened', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'build me a t and m for dana';
        _timGo();
        document.getElementById('_tim-ov')?.remove();
        const e = timLogEntries()[0];
        return { kind: e.kind, got: e.got };
      });
      expect(r.kind).toBe('build');
      expect(r.got).toContain('Opened');
    });

    test('a read does not get credited with the PREVIOUS read\'s words', async () => {
      // _timJob holds whatever was last shown. If the wrapper handed it over on
      // a sentence that produced no read, Tim would be credited with placing
      // words he never saw, and a real gap would go unreported.
      const r = await page.evaluate(() => {
        _timJob = { order: [{ text: 'Strip and repaint, west elevation' }],
          materials: [], fromBook: [], implied: [] };
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'strip the west elevation';
        _timGo();
        document.getElementById('_tim-ov')?.remove();
        const e = timLogEntries()[0];
        return { kind: e.kind, miss: e.miss };
      });
      expect(r.kind).toBe('none');
      expect(r.miss).toContain('strip');
      expect(r.miss).toContain('elevation');
    });
  });

  test.describe('the panel', () => {
    test('it opens, and says what it has', async () => {
      const r = await page.evaluate(() => {
        timLogSay('reglaze the transoms', { kind: 'none' });
        openTimLog();
        const h = document.getElementById('_tim-log-sheet').innerHTML;
        document.getElementById('_tim-ov')?.remove();
        return h;
      });
      expect(r).toContain('reglaze');
      expect(r).toContain('transoms');
      expect(r).toContain('Words I did not know');
    });

    test('empty, it invites rather than apologises', async () => {
      const r = await page.evaluate(() => {
        openTimLog();
        const h = document.getElementById('_tim-log-sheet').innerHTML;
        document.getElementById('_tim-ov')?.remove();
        return h;
      });
      expect(r).toContain('Nothing yet');
      expect(r).not.toContain('Words I did not know');
    });

    test('Tim\'s own sheet stays clean while the log is empty', async () => {
      const r = await page.evaluate(() => {
        const empty = _timLogRowHtml();
        timLogSay('reglaze the transoms', { kind: 'none' });
        return { empty, filled: _timLogRowHtml() };
      });
      expect(r.empty).toBe('');
      expect(r.filled).toContain('1 thing you have said to me');
      expect(r.filled).toContain('I did not know');
    });

    test('clearing it empties the panel and the disk together', async () => {
      const r = await page.evaluate(() => {
        timLogSay('reglaze the transoms', { kind: 'none' });
        openTimLog();
        _timLogWipe();
        const h = document.getElementById('_tim-log-sheet').innerHTML;
        document.getElementById('_tim-ov')?.remove();
        return { n: timLogEntries().length, disk: localStorage.getItem('td_tim_log'), h };
      });
      expect(r.n).toBe(0);
      expect(r.disk).toBe('[]');
      expect(r.h).toContain('Nothing yet');
    });

    test('the copied text carries the version, the misses and the sentences', async () => {
      const r = await page.evaluate(() => {
        timLogSay('reglaze the transoms', { kind: 'none' });
        return timLogText();
      });
      expect(r).toContain('Tim log');
      expect(r).toContain('knowledge loaded');
      expect(r).toContain('Did not know:');
      expect(r).toContain('reglaze');
    });
  });

  test.describe('whether his knowledge loaded at all', () => {
    test('with everything present it says so, and flags nothing', async () => {
      const r = await page.evaluate(() => ({ l: timLogLoaded(), all: timLogAllLoaded() }));
      expect(r.l).toEqual({ knowledge: true, nudge: true, book: true });
      expect(r.all).toBe(true);
    });

    test('a missing knowledge file is the loudest thing on the screen', async () => {
      // The failure that produced this file looked exactly like a parsing bug:
      // the surface loads, Tim opens, and nothing happens, because a cached
      // index.html never fetched the three script tags this release added.
      // Simulated by taking the function away, which is what that looks like
      // from in here.
      const r = await page.evaluate(() => {
        const real = window.timReadJob;
        try {
          // eslint-disable-next-line no-global-assign
          timReadJob = undefined;
          const row = _timLogRowHtml();
          openTimLog();
          const h = document.getElementById('_tim-log-sheet').innerHTML;
          document.getElementById('_tim-ov')?.remove();
          return { all: timLogAllLoaded(), row, h, text: timLogText() };
        } finally { timReadJob = real; }
      });
      expect(r.all).toBe(false);
      // It speaks up on Tim's own sheet even with an empty log, because every
      // other thing he says is unreliable in this state.
      expect(r.row).toContain('Tim is only half here');
      expect(r.h).toContain('What I know did not load');
      expect(r.h).toContain('Close the app all the way');
      expect(r.text).toContain('knowledge MISSING');
    });

    test('taking it away does not stick once it is back', async () => {
      const r = await page.evaluate(() => timLogAllLoaded());
      expect(r).toBe(true);
    });
  });

  test.describe('it stays on the phone', () => {
    test('the log lives in one localStorage key and nowhere else', async () => {
      const r = await page.evaluate(() => {
        timLogClear();
        timLogSay('reglaze the transoms', { kind: 'none' });
        return Object.keys(localStorage).filter(k => {
          try { return (localStorage.getItem(k) || '').indexOf('reglaze') >= 0; }
          catch (_e) { return false; }
        });
      });
      expect(r).toEqual(['td_tim_log']);
    });

    test('nothing in it is handed to the telemetry pipeline', async () => {
      // js/observability.js ships to an edge function and enforces a no-PII
      // rule centrally. This log is nothing BUT names, addresses and prices,
      // so it must never reach that door.
      const r = await page.evaluate(() => {
        const sent = [];
        const real = (typeof _supa !== 'undefined' && _supa && _supa.functions)
          ? _supa.functions.invoke : null;
        if (real) _supa.functions.invoke = (name, arg) => {
          sent.push(JSON.stringify({ name, arg })); return Promise.resolve({});
        };
        try {
          timLogSay('reglaze the transoms for Dana Whitfield at 1200 Elm St', { kind: 'none' });
          openTimLog();
          document.getElementById('_tim-ov')?.remove();
          return sent.filter(s => s.indexOf('reglaze') >= 0 || s.indexOf('Elm St') >= 0);
        } finally { if (real) _supa.functions.invoke = real; }
      });
      expect(r).toEqual([]);
    });
  });

  // ── The thread ────────────────────────────────────────────────────────────
  //
  // The owner asked three questions, watched the sheet return to its opening
  // line, and said Tim did nothing. Two of the three possible outcomes really
  // did leave no trace on that sheet: a sentence he could not place got a 2.6
  // second toast, and one he could place closed the sheet and navigated away.
  // These pin that every sentence now leaves a mark on the sheet it was said
  // into.
  test.describe('the last things he was told, on the sheet', () => {
    test('an empty log says so rather than drawing furniture', async () => {
      const r = await page.evaluate(() => _timThreadHtml());
      expect(r).toContain('Nothing asked yet');
    });

    test('every outcome lands in it, including the ones he could not place', async () => {
      const r = await page.evaluate(() => {
        timLogSay('who owes me money', { kind: 'ask', title: '$3,500' });
        timLogSay('open my leads', { kind: 'nav', name: 'Leads' });
        timLogSay('reglaze the transoms', { kind: 'none' });
        const el = document.createElement('div');
        el.innerHTML = _timThreadHtml();
        // The two lines of a turn read separately: what was said, what came
        // back. textContent on the wrapper runs them together, which says
        // nothing about whether they are two distinct blocks on the screen.
        return [...el.children].map(c => [...c.children].map(x => x.textContent.trim()));
      });
      expect(r).toEqual([
        ['who owes me money', '$3,500'],
        ['open my leads', 'Opened Leads'],
        ['reglaze the transoms', 'I could not place that one.'],
      ]);
    });

    // The figure, not a sentence about having produced a figure. A thread of
    // "Answered off your own numbers" tells a man nothing he did not know.
    test('an answer shows what he actually said', async () => {
      const r = await page.evaluate(() => {
        timLogSay('how much did I make in 2026', { kind: 'ask', title: '$4,400' });
        return timLogEntries()[0].got;
      });
      expect(r).toBe('$4,400');
    });

    test('oldest at the top, newest at the bottom, and it stops at eight', async () => {
      const r = await page.evaluate(() => {
        for (let i = 1; i <= 11; i++) timLogSay('question ' + i, { kind: 'none' });
        const el = document.createElement('div');
        el.innerHTML = _timThreadHtml();
        const said = [...el.children].map(c => c.firstChild.textContent.trim());
        return { n: said.length, first: said[0], last: said[said.length - 1] };
      });
      expect(r).toEqual({ n: 8, first: 'question 4', last: 'question 11' });
    });

    test('a sentence with markup in it is printed, never rendered', async () => {
      const r = await page.evaluate(() => {
        timLogSay('<img src=x onerror=alert(1)>bill Dana', { kind: 'none' });
        const el = document.createElement('div');
        el.innerHTML = _timThreadHtml();
        return { imgs: el.querySelectorAll('img').length, text: el.textContent };
      });
      expect(r.imgs).toBe(0);
      expect(r.text).toContain('<img src=x onerror=alert(1)>bill Dana');
    });

    test('the sheet shows it, and saying something adds to it and clears the box', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timLogSay('earlier question', { kind: 'ask', title: '$1,240' });
        openTim();
        const before = document.getElementById('_tim-thread').textContent;
        const el = document.getElementById('_tim-say');
        el.value = 'reglaze the transoms';
        _timGo();
        const box = document.getElementById('_tim-thread');
        const out = {
          before: before.indexOf('earlier question') >= 0,
          after: box.textContent.indexOf('reglaze the transoms') >= 0,
          keptOld: box.textContent.indexOf('earlier question') >= 0,
          boxCleared: document.getElementById('_tim-say').value,
        };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r).toEqual({ before: true, after: true, keptOld: true, boxCleared: '' });
    });

    test('refreshing it when the sheet is not open does nothing and throws nothing', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        try { _timThreadRefresh(); return 'ok'; } catch (e) { return 'THREW: ' + e.message; }
      });
      expect(r).toBe('ok');
    });
  });

  test('no console errors, tim-log.js', async () => { await assertNoErrors(page); });
});
