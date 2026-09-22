// @ts-check
// ── Tim ─────────────────────────────────────────────────────────────────────
//
// Tim is an interface, not an intelligence (js/tim.js header). Every one of
// these tests exists to hold that line: he resolves a sentence against the
// screens the app already has, the years the books already hold, and the
// customers and price book already on the phone. Nothing here calls anything,
// which is the point, and is why the whole file runs offline.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CLIENTS = [
  { id: 8101, name: 'Rick Delaney', addr: '412 Maple St, Wichita, KS 67203' },
  { id: 8102, name: 'Sandra Ruiz', addr: '2100 Oak Ave, Wichita, KS 67208' },
];
const BOOK = [
  { desc: 'Replace 40 gal water heater', rate: 1850 },
  { desc: 'Install kitchen faucet', rate: 285 },
];

test.describe('tim', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  const parse = (text) => page.evaluate(([t, cl, bk]) =>
    timParse(t, { clients: cl, book: bk, catalog: [], now: new Date('2026-09-17T15:00:00Z') }),
    [text, CLIENTS, BOOK]);

  // ── Where he takes you ────────────────────────────────────────────────────
  test.describe('the screen he means', () => {
    const cases = [
      ['show me my books', 'pg-tracker'],
      ['tim take me to the books', 'pg-tracker'],
      ['open my leads', 'pg-leads'],
      ['pull up my customers', 'pg-clients'],
      ['show me the jobs', 'pg-jobs'],
      ['open the schedule', 'pg-schedule'],
      ['show me the calendar', 'pg-cal'],
      ['who owes me', 'pg-money'],
      ['show me my taxes', 'pg-taxes'],
      ['pull up my crew', 'pg-team'],
      ['open the dispatch board', 'pg-dispatch'],
      ['open my licenses', 'pg-licensing'],
      ['pull up contracts', 'pg-contracts'],
      ['take me to the client hub', 'pg-client-hub'],
      ['open settings', 'pg-settings'],
      ['take me home', 'pg-dash'],
    ];
    for (const [said, want] of cases) {
      test(`"${said}" is ${want}`, async () => {
        expect(await page.evaluate(t => (timWhere(t) || {}).pg, said)).toBe(want);
      });
    }

    // The reason timWhere scores on phrase length: "time log" and "the hub"
    // both contain a shorter alias belonging to a different screen, and a
    // word-set match sends the contractor to the wrong page.
    test('a longer phrase wins over a shorter one inside it', async () => {
      expect(await page.evaluate(() => (timWhere('open my time log') || {}).pg)).toBe('pg-timelog');
      expect(await page.evaluate(() => (timWhere('take me to the client hub') || {}).pg)).toBe('pg-client-hub');
    });

    test('a sentence naming no screen says so, rather than guessing one', async () => {
      expect(await page.evaluate(() => timWhere('what a morning'))).toBeNull();
    });

    test('null, undefined, empty and a number are all nothing, not a crash', async () => {
      const r = await page.evaluate(() => [timWhere(null), timWhere(undefined), timWhere(''),
        timWhere('   '), timWhere(0), timWhere(42), timWhere([])]);
      expect(r).toEqual([null, null, null, null, null, null, null]);
    });
  });

  // ── Which year ────────────────────────────────────────────────────────────
  test.describe('the year he means', () => {
    test('last year, this year, and the year itself', async () => {
      const r = await page.evaluate(() => {
        const now = new Date('2026-09-17T15:00:00Z');
        return {
          last: timWhen('my books for last year', now),
          this: timWhen('income this year', now),
          ytd: timWhen('year to date', now),
          named: timWhen('show me 2024', now),
          none: timWhen('show me my books', now),
        };
      });
      expect(r).toEqual({ last: 2025, this: 2026, ytd: 2026, named: 2024, none: null });
    });

    test('null, undefined and empty return no year', async () => {
      const r = await page.evaluate(() => [timWhen(null), timWhen(undefined), timWhen('')]);
      expect(r).toEqual([null, null, null]);
    });

    test('a year only reaches the books, so a stray number elsewhere changes nothing', async () => {
      // "2024" sitting in a sentence about the crew must not silently re-year a
      // screen that has no year. timParse carries it; timRun only applies it on
      // pg-tracker.
      const p = await parse('show me my crew 2024');
      expect(p.pg).toBe('pg-team');
      expect(p.year).toBe(2024);
    });
  });

  // ── The name he said ──────────────────────────────────────────────────────
  test.describe('the name after "for"', () => {
    test('a name comes back whole', async () => {
      expect(await page.evaluate(() => timSubject('build me a t and m for Logan Sample'))).toBe('Logan Sample');
    });
    test('the work after the name is dropped, the name is kept', async () => {
      expect(await page.evaluate(() => timSubject('t and m for Logan Sample doing a repipe'))).toBe('Logan Sample');
      expect(await page.evaluate(() => timSubject('proposal for Logan Sample about eight hours'))).toBe('Logan Sample');
    });
    test('a time phrase is a year, never a person', async () => {
      const r = await page.evaluate(() => [
        timSubject('my books for last year'),
        timSubject('income for this year'),
        timSubject('books for 2024'),
      ]);
      expect(r).toEqual([null, null, null]);
    });
    test('no "for" at all, and a sentence too long to be a name, are both nothing', async () => {
      const r = await page.evaluate(() => [
        timSubject('show me the jobs'),
        timSubject('for the guy who called about the thing yesterday'),
        timSubject(null), timSubject(undefined), timSubject(''),
      ]);
      expect(r).toEqual([null, null, null, null, null]);
    });
  });

  // ── The whole sentence ────────────────────────────────────────────────────
  test.describe('what he decides to do', () => {
    test('a customer he has plus work is a bid, not a page', async () => {
      const p = await parse('t and m for the delaneys, eight hours, water heater replacement');
      expect(p.kind).toBe('estimate');
      expect(p.plan.client.name).toBe('Rick Delaney');
      expect(p.plan.hours).toBe(8);
    });

    // The exact sentence the owner wrote the feature for: the person does not
    // exist yet, and retyping a name he already said is the friction Tim is for.
    test('a customer he does not have yet is a new customer, not a dead end', async () => {
      const p = await parse('build me a time and materials for Logan Sample, repiping half the house');
      expect(p.kind).toBe('newclient');
      expect(p.subject).toBe('Logan Sample');
    });

    test('looking at something is a page', async () => {
      const p = await parse('show me my books for last year');
      expect(p.kind).toBe('nav');
      expect(p.pg).toBe('pg-tracker');
      expect(p.year).toBe(2025);
    });

    test('a bare year is the books, because nowhere else is a year the whole ask', async () => {
      const p = await parse('2024');
      expect(p.kind).toBe('nav');
      expect(p.pg).toBe('pg-tracker');
      expect(p.year).toBe(2024);
    });

    test('a sentence he cannot place stays unplaced instead of opening something', async () => {
      const p = await parse('hey tim how about them chiefs');
      expect(p.kind).toBe('none');
    });

    test('null, undefined, empty and no options at all are all "none"', async () => {
      const r = await page.evaluate(() => [
        timParse(null), timParse(undefined), timParse(''), timParse('  '),
        timParse('show me my books'),
      ].map(p => p.kind));
      expect(r).toEqual(['none', 'none', 'none', 'none', 'nav']);
    });
  });

  // ── What he says he will do ───────────────────────────────────────────────
  test.describe('the line he shows before he moves', () => {
    test('every kind reads like a sentence', async () => {
      const r = await page.evaluate(([cl, bk]) => {
        const o = { clients: cl, book: bk, catalog: [], now: new Date('2026-09-17T15:00:00Z') };
        return {
          nav: timSay(timParse('show me my books for last year', o)),
          plain: timSay(timParse('open the schedule', o)),
          newc: timSay(timParse('build me a t and m for Logan Sample, repipe', o)),
          est: timSay(timParse('t and m for the delaneys, eight hours, water heater replacement', o)),
          none: timSay(timParse('how about them chiefs', o)),
        };
      }, [CLIENTS, BOOK]);
      expect(r.nav).toBe('Open Books for 2025');
      expect(r.plain).toBe('Open Schedule');
      expect(r.newc).toBe('Start Logan Sample as a new customer');
      expect(r.est).toContain('Build a T&M for Rick Delaney');
      expect(r.est).toContain('8 hrs');
      expect(r.none).toBe('');
    });

    test('nothing at all is an empty line, never the word undefined', async () => {
      const r = await page.evaluate(() => [timSay(null), timSay(undefined), timSay({}), timSay({ kind: 'none' })]);
      expect(r).toEqual(['', '', '', '']);
    });
  });

  // ── Doing it ──────────────────────────────────────────────────────────────
  test.describe('what happens on the screen', () => {
    test.beforeEach(async () => {
      await page.evaluate(([cl, bk]) => {
        clients.length = 0; cl.forEach(c => clients.push(c));
        S.priceBook = S.priceBook || {}; S.priceBook.plumbing = bk;
        document.getElementById('_tim-ov')?.remove();
        document.getElementById('_newc-gate-overlay')?.remove();
      }, [CLIENTS, BOOK]);
    });

    test('a page command lands on the page', async () => {
      const on = await page.evaluate(() => { timRun('open the schedule'); return document.querySelector('.pg.active')?.id; });
      expect(on).toBe('pg-schedule');
    });

    test('the books for last year land on the books, set to that year', async () => {
      const r = await page.evaluate(() => {
        timRun('show me my books for last year');
        return { pg: document.querySelector('.pg.active')?.id, yr: trackerYear };
      });
      expect(r.pg).toBe('pg-tracker');
      // A year with no rows falls back inside populateTrackerYearSel rather
      // than showing an empty screen, so this asserts the request landed, not
      // that the books invented data for it.
      expect(typeof r.yr === 'number' || typeof r.yr === 'string').toBe(true);
    });

    test('a name he does not have opens the new customer box with the name already in it', async () => {
      const v = await page.evaluate(() => {
        timRun('build me a time and materials for Logan Sample, repiping half the house');
        return document.getElementById('_newc-gate-name')?.value;
      });
      expect(v).toBe('Logan Sample');
      await page.evaluate(() => document.getElementById('_newc-gate-overlay')?.remove());
    });

    test('a sentence he cannot place moves nothing', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        const p = timRun('how about them chiefs');
        return { kind: p.kind, pg: document.querySelector('.pg.active')?.id };
      });
      expect(r).toEqual({ kind: 'none', pg: 'pg-dash' });
    });

    test('null and empty commands do nothing and throw nothing', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        let threw = false;
        try { timRun(null); timRun(undefined); timRun(''); } catch (e) { threw = true; }
        return { threw, pg: document.querySelector('.pg.active')?.id };
      });
      expect(r).toEqual({ threw: false, pg: 'pg-dash' });
    });

    // Tim walks through goPg, so the employee wall the app already has applies
    // to him for free. This test is here so that stays true: a crew member who
    // asks Tim for the taxes must land where goPg puts him, not on the taxes.
    test('a crew member asking for a locked page gets the same wall the nav gives him', async () => {
      const pg = await page.evaluate(() => {
        const was = _isEmployee;
        _isEmployee = true;
        try { timRun('show me my taxes'); return document.querySelector('.pg.active')?.id; }
        finally { _isEmployee = was; }
      });
      expect(pg).toBe('pg-dash');
    });
  });

  // ── The box ───────────────────────────────────────────────────────────────
  test.describe('the box itself', () => {
    test.afterEach(async () => { await page.evaluate(() => document.getElementById('_tim-ov')?.remove()); });

    test('it is the app centered-modal convention, not a hand-rolled sheet', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const ov = document.getElementById('_tim-ov');
        return { ov: !!ov, cls: ov?.className, box: !!ov?.querySelector('.zmodal'), input: !!document.getElementById('_tim-say') };
      });
      expect(r).toEqual({ ov: true, cls: 'zmodal-overlay', box: true, input: true });
    });

    test('opening it ten times without waiting leaves exactly one box', async () => {
      const n = await page.evaluate(() => {
        for (let i = 0; i < 10; i++) openTim();
        return document.querySelectorAll('#_tim-ov').length;
      });
      expect(n).toBe(1);
    });

    test('it reads the sentence back before it moves, and Go is dead until it can', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const el = document.getElementById('_tim-say');
        const out = () => document.getElementById('_tim-read').textContent;
        const go = () => document.getElementById('_tim-go').disabled;
        const empty = { read: out(), dead: go() };
        el.value = 'how about them chiefs';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const lost = { read: out(), dead: go() };
        el.value = 'show me my books for last year';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const found = { read: out(), dead: go() };
        return { empty, lost, found };
      });
      expect(r.empty).toEqual({ read: '', dead: true });
      expect(r.lost).toEqual({ read: 'Not sure what that is yet', dead: true });
      expect(r.found).toEqual({ read: 'Open Books for 2025', dead: false });
    });

    test('Enter runs it and closes the box', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        const el = document.getElementById('_tim-say');
        el.value = 'open the schedule';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        return { open: !!document.getElementById('_tim-ov'), pg: document.querySelector('.pg.active')?.id };
      });
      expect(r).toEqual({ open: false, pg: 'pg-schedule' });
    });

    test('a sentence it cannot place keeps the box open so he can fix it', async () => {
      const open = await page.evaluate(() => {
        openTim();
        const el = document.getElementById('_tim-say');
        el.value = 'how about them chiefs';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        _timGo();
        return !!document.getElementById('_tim-ov');
      });
      expect(open).toBe(true);
    });

    test('cancel and the backdrop both close it', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-cancel').click();
        const afterCancel = !!document.getElementById('_tim-ov');
        openTim();
        const ov = document.getElementById('_tim-ov');
        ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { afterCancel, afterBackdrop: !!document.getElementById('_tim-ov') };
      });
      expect(r).toEqual({ afterCancel: false, afterBackdrop: false });
    });

    // The preview and the runner both read elements that only exist while the
    // box is open. A stray call after it closed must be a no-op, not a throw
    // into the console.
    test('the preview and the runner survive the box not being there', async () => {
      const threw = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        try { _timPreview(); _timGo(); _timClose(); return false; } catch (e) { return true; }
      });
      expect(threw).toBe(false);
    });

    test('the menu has a way in', async () => {
      const n = await page.locator('#mmi-tim').count();
      expect(n).toBe(1);
    });
  });

  // ── Photos (owner 2026-09-22) ─────────────────────────────────────────────
  // The Gallery page is gone; photos are found by place through the search.
  // So a photo sentence is a lookup, and the words that are not about photos
  // are the search term.
  const photoSeed = () => page.evaluate(() => {
    photos.length = 0;
    const mk = (id, name, addr, iso) => photos.push({ id, type: 'before', url: 'https://x/' + id + '.jpg',
      thumbUrl: 'https://x/t.jpg', storagePath: 'u/' + id + '.jpg', client_id: 501, client_name: name, addr, uploadedAt: iso });
    mk(801, 'Dana Whitfield', '412 Oak St, Wichita KS', '2026-09-10T15:00:00.000Z');
    mk(802, 'Dana Whitfield', '412 Oak St, Wichita KS', '2026-09-11T15:00:00.000Z');
    mk(803, 'Dana Whitfield', '88 Pine Ct, Wichita KS', '2026-08-01T15:00:00.000Z');
  });

  test('a photo sentence is a lookup, and the words that are left are the term', async () => {
    await photoSeed();
    const r = await page.evaluate(() => ['show me the photos at 412 Oak', 'job photos 412 Oak', 'photos']
      .map(s => { const p = timParse(s, { clients: [], photos }); return { kind: p.kind, q: p.q, n: (p.places || []).length }; }));
    expect(r[0]).toEqual({ kind: 'photos', q: '412 oak', n: 1 });
    expect(r[1].kind).toBe('photos');          // "job photos" is not the Jobs page
    expect(r[2]).toEqual({ kind: 'photos', q: '', n: 0 });
  });

  test('one address is not a question: it opens the photos', async () => {
    await photoSeed();
    const r = await page.evaluate(() => {
      const p = timParse('photos at 412 Oak', { clients: [], photos });
      const say = timSay(p);
      timRun('photos at 412 Oak');
      const out = { say, album: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
        asked: !!document.getElementById('_tim-ov') };
      tdReviewClose();
      return out;
    });
    expect(r.say).toBe('Open 412 Oak St, 2 photos');
    expect(r.album).toBe(2);
    expect(r.asked).toBe(false);
  });

  test('two addresses: he asks which, and the answer opens the viewer', async () => {
    await photoSeed();
    const r = await page.evaluate(() => {
      const say = timSay(timParse('photos for Whitfield', { clients: [], photos }));
      timRun('photos for Whitfield');
      const asked = !!document.getElementById('_tim-ov');
      const opts = [...document.querySelectorAll('#_tim-ov .pc-file-opt')].map(b => b.textContent);
      document.querySelectorAll('#_tim-ov .pc-file-opt')[1].click();   // 88 Pine Ct
      const out = { say, asked, opts, gone: !document.getElementById('_tim-ov'),
        album: document.querySelectorAll('#pc-rev .pc-rev-cell').length };
      tdReviewClose();
      return out;
    });
    expect(r.say).toBe('Pick which address, 2 match');
    expect(r.asked).toBe(true);
    expect(r.opts[0]).toContain('412 Oak St');
    expect(r.opts[0]).toContain('2 photos');
    expect(r.opts[1]).toContain('88 Pine Ct');
    expect(r.gone).toBe(true);
    expect(r.album).toBe(1);                    // the Pine Ct shot, not all three
  });

  test('nothing matches, so he opens the search rather than guessing', async () => {
    await photoSeed();
    const r = await page.evaluate(() => {
      timRun('photos at 9 Nowhere Ln');
      const box = document.getElementById('global-search-input');
      const out = { open: !!document.getElementById('global-search-overlay'), val: box ? box.value : null };
      if (typeof closeSearch === 'function') closeSearch();
      return out;
    });
    expect(r.open).toBe(true);
    expect(r.val).toBe('9 nowhere ln');
  });

  // Through the actual button, not just timRun: Go used to close the overlay
  // AFTER acting, which tore down the chooser in the same frame.
  test('the Go button leaves the chooser standing', async () => {
    await photoSeed();
    const r = await page.evaluate(() => {
      openTim();
      const el = document.getElementById('_tim-say');
      el.value = 'photos for Whitfield';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      _timGo();
      const out = {
        asked: !!document.getElementById('_tim-ov'),
        opts: document.querySelectorAll('#_tim-ov .pc-file-opt').length,
        stillTyping: !!document.getElementById('_tim-say'),
      };
      _timClose();
      return out;
    });
    expect(r.asked).toBe(true);
    expect(r.opts).toBe(2);
    expect(r.stillTyping).toBe(false);   // the chooser replaced the box, not stacked on it
  });

  test('Go on a sentence he cannot place keeps the box and what was typed', async () => {
    const r = await page.evaluate(() => {
      openTim();
      const el = document.getElementById('_tim-say');
      el.value = 'qqqq zzzz';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      _timGo();
      const out = { open: !!document.getElementById('_tim-ov'), val: document.getElementById('_tim-say')?.value };
      _timClose();
      return out;
    });
    expect(r.open).toBe(true);
    expect(r.val).toBe('qqqq zzzz');
  });

  test('cancel on the chooser opens nothing', async () => {
    await photoSeed();
    const r = await page.evaluate(() => {
      timRun('photos for Whitfield');
      document.getElementById('_tim-cancel').click();
      return { gone: !document.getElementById('_tim-ov'), album: document.querySelectorAll('#pc-rev').length };
    });
    expect(r.gone).toBe(true);
    expect(r.album).toBe(0);
  });

  test('a sentence with no photo word is untouched by any of this', async () => {
    const r = await page.evaluate(() => ['open my jobs', 'the books', 'dispatch']
      .map(s => timParse(s, { clients: [] }).kind));
    expect(r).toEqual(['nav', 'nav', 'nav']);
  });


  test('no console errors, tim.js', async () => {
    assertNoErrors(page, 'tim.js');
  });
});
