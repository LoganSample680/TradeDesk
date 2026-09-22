// @ts-check
// ── Tim ─────────────────────────────────────────────────────────────────────
//
// This file is Tim's NAVIGATOR and his surface: the screens the app already
// has, the years the books already hold, the customers and price book already
// on the phone, and the dock and sheet he lives in. What he KNOWS about the
// trade moved to js/tim-knowledge.js on 2026-09-19 and is tested next door in
// e2e-tim-knowledge.spec.js.
//
// The line every one of these still holds, and the one that was a promise made
// to a real customer: nothing here calls anything. No model, no key, no
// network, which is why the whole file runs offline.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
// What the first chip actually says, read off TIM_CHIPS in js/tim.js at run
// time rather than copied here, so the test cannot pass against a chip the
// product no longer has.
const TIM_CHIP_FIRST = 'who owes me money';

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
      ['show me the job photos', 'pg-gallery'],
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

    // ── Every screen in the app, accounted for ────────────────────────────────
    //
    // Owner asked why he cannot reach every screen. The answer was that three
    // were missing and nobody had ever counted: pg-checklist was a plain
    // omission (its id says checklist, its heading says Top Clients, and it was
    // renamed without the id ever following), and two need a SUBJECT before
    // they mean anything.
    //
    // A question that needs counting to answer is a question that will have a
    // different answer next month. This counts. Every .pg in index.html is
    // either somewhere Tim can take you by name, or it is on the list below
    // with the reason it cannot be, and a new screen added to the app fails
    // here until somebody decides which it is.
    const NEEDS_A_SUBJECT = {
      'pg-client-detail': 'one customer\'s file. Tim opens it BY NAME, off the ' +
        'who-is-this answer, because "open the customer" with no customer named ' +
        'is a blank screen. Reachable, just never as a bare page.',
      'pg-est-generic': 'the estimate builder. It is opened with a client and a ' +
        'mode by openGenericEstimate, which is the whole estimate path Tim ' +
        'already drives. Landing on it cold shows a form bound to nobody.',
    };
    test('every screen in the app is either reachable by name or listed as needing a subject', async () => {
      const r = await page.evaluate(() => ({
        pages: [...document.querySelectorAll('.pg[id]')].map(el => el.id).sort(),
        tim: [...new Set(TIM_PLACES.map(w => w.pg))].sort(),
      }));
      const unreachable = r.pages.filter(p => r.tim.indexOf(p) < 0);
      expect(unreachable.sort()).toEqual(Object.keys(NEEDS_A_SUBJECT).sort());
      // And nothing in his table points at a screen that is not there any more.
      expect(r.tim.filter(p => r.pages.indexOf(p) < 0)).toEqual([]);
    });

    test('the screen he names is the name written on it, not the name in the id', async () => {
      // pg-checklist renders "Top Clients". A man who asks for the checklist is
      // asking for something this app no longer has; a man who asks for his top
      // clients is asking for that screen. Tim goes by the heading.
      const r = await page.evaluate(() => [
        (timWhere('show me my top clients') || {}).pg,
        (timWhere('pull up the heavy hitters') || {}).pg,
        (timWhere('who are my top customers') || {}).pg,
      ]);
      expect(r).toEqual(['pg-checklist', 'pg-checklist', 'pg-checklist']);
    });

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

  // ── The sheet ─────────────────────────────────────────────────────────────
  test.describe('the sheet itself', () => {
    test.afterEach(async () => { await page.evaluate(() => document.getElementById('_tim-ov')?.remove()); });

    // ASSERTION CHANGED 2026-09-19 (protocol 10.4).
    //
    // Was: Tim opened `.zmodal`, the app's CENTERED prompt. That was correct
    // while Tim was a command box, because a command box is a prompt and 7.3
    // says use the prompt we already have.
    //
    // Now: Tim's sentences are about the proposal on screen ("there is no
    // scaffold on THIS job"), and a centered box covers the thing it is talking
    // about. So he opens the app's OTHER existing shell, the bottom sheet that
    // js/jobs.js `_extendJob` and five others already use: `.zmodal-overlay`
    // for the scrim, a fixed panel rounded at the top, the same rAF slide.
    // Still not hand-rolled, which is what the old assertion was protecting.
    test('it is the app bottom-sheet shell, so the page stays readable behind it', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const ov = document.getElementById('_tim-ov');
        const sheet = document.getElementById('_tim-sheet');
        const cs = sheet && getComputedStyle(sheet);
        return {
          ov: !!ov, cls: ov?.className,
          sheet: !!sheet,
          pinnedToBottom: cs?.position === 'fixed' && cs?.bottom === '0px',
          roundedTopOnly: !!cs && parseFloat(cs.borderTopLeftRadius) > 0 && parseFloat(cs.borderBottomLeftRadius) === 0,
          input: !!document.getElementById('_tim-say'),
          // The page behind it is still there to read, which is the whole reason
          // this is not a centered box any more.
          pageStillUp: !!document.querySelector('.pg.active'),
        };
      });
      expect(r).toEqual({
        ov: true, cls: 'zmodal-overlay', sheet: true,
        pinnedToBottom: true, roundedTopOnly: true, input: true, pageStillUp: true,
      });
    });

    test('opening it ten times without waiting leaves exactly one sheet', async () => {
      const n = await page.evaluate(() => {
        for (let i = 0; i < 10; i++) openTim();
        return document.querySelectorAll('#_tim-ov').length;
      });
      expect(n).toBe(1);
    });

    // ASSERTION CHANGED 2026-09-19 (protocol 10.4). The Go button is gone: the
    // sheet's own buttons are the ones attached to a finding, and the typed
    // path runs on Enter. What has NOT changed, and is what this test was
    // really for, is that he sees what Tim understood before anything moves.
    test('it reads the sentence back before it moves', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const el = document.getElementById('_tim-say');
        const out = () => document.getElementById('_tim-read').textContent;
        const empty = out();
        el.value = 'how about them chiefs';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const lost = out();
        el.value = 'show me my books for last year';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { empty, lost, found: out() };
      });
      expect(r).toEqual({
        empty: '',
        lost: 'Not sure what that is yet',
        found: 'Open Books for 2025',
      });
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

    // ASSERTION CHANGED 2026-09-19 (protocol 10.4). A sheet is dismissed by its
    // close control and by the scrim, the way every other sheet in the app is,
    // rather than by a full-width Cancel button underneath a Go button. Both
    // ways out are still tested, which is what this was guarding.
    test('the close control and the backdrop both close it', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.querySelector('#_tim-sheet button[aria-label="Close"]').click();
        const afterClose = !!document.getElementById('_tim-ov');
        openTim();
        const ov = document.getElementById('_tim-ov');
        ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { afterClose, afterBackdrop: !!document.getElementById('_tim-ov') };
      });
      expect(r).toEqual({ afterClose: false, afterBackdrop: false });
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

    // ── 10.4: this assertion changed with the control it is about ───────────
    // WAS: `#tim-dock` and `#tim-dock-btn`, a disc that floated bottom-right
    // and then tucked against the right edge at mid-height.
    // NOW: `#mtb-tim`, a rounded rectangle raised off the CENTRE of the bottom
    // bar, its bottom edge flush with the bar's top edge. Owner, 2026-09-21:
    // "kinda diggin tim raised off the bar in the center but instead of a
    // circle he can be a more rounded rectangle, if theres insights to see then
    // we get the raised red notification."
    // The INTENT is untouched and is the whole reason this test exists: there
    // is exactly one of him, he carries his mark rather than a line icon, and
    // tapping him opens the sheet. Only the selector moved.
    test('the raised key is on the bar and opens the sheet', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timDockRender();
        const key = document.getElementById('mtb-tim');
        key.click();
        return {
          keys: document.querySelectorAll('#mtb-tim').length,
          shown: !key.hidden,
          hasMark: !!document.querySelector('#mtb-tim-mark img'),
          opened: !!document.getElementById('_tim-sheet'),
        };
      });
      expect(r).toEqual({ keys: 1, shown: true, hasMark: true, opened: true });
    });

    // He is NOT one of the tabs, and this is not a tidiness point.
    // _applyTabOrder (js/navigation.js) walks _MTB_DEFAULT_ORDER calling
    // appendChild for dash, leads, clients and jobs. Tim is not in that list,
    // so for the one commit he lived inside #mtb-inner, every phone with a
    // saved tab order moved those four to the end and left him sitting FIRST.
    // He would have shipped as the left-most tab on exactly the devices whose
    // owners had bothered to customise their bar, and no test would have
    // noticed, because a saved order only exists after somebody drags one.
    // He is not a tab and his SEAT is not draggable, and neither of those is a
    // tidiness point.
    // _applyTabOrder walks _MTB_DEFAULT_ORDER calling appendChild for dash,
    // leads, clients and jobs, which moves all four to the END of #mtb-inner.
    // Anything else living in there is left sitting FIRST. That already
    // shipped once as a bug in one commit, when Tim himself was in the row: on
    // every phone with a saved tab order he became the left-most tab, and no
    // test noticed, because a saved order only exists after somebody drags one.
    // His seat is in the row now, so the same trap is reset and this is what
    // holds it shut: after any reorder the seat goes back to the middle.
    // He himself is outside the bar entirely, for a different reason again
    // (the bar is the masked element, or was; see the ring test).
    test('a saved tab order rearranges the tabs and leaves his seat in the middle', async () => {
      const r = await page.evaluate(() => {
        _applyTabOrder(['jobs', 'leads', 'dash']);
        const dragged = [...document.querySelectorAll('#mtb-inner > *')].map(e => e.id);
        _applyTabOrder(['dash', 'leads', 'jobs']);
        const restored = [...document.querySelectorAll('#mtb-inner > *')].map(e => e.id);
        return {
          dragged, restored,
          timInBar: !!document.querySelector('#mobile-tabbar #mtb-tim'),
          timInInner: !!document.querySelector('#mtb-inner > #mtb-tim'),
        };
      });
      // The tabs obey the saved order; the seat does not travel with them, and
      // it lands on the middle slot of the BAR rather than of this row, which
      // is one further along because More sits outside #mtb-inner.
      // 10.4: these were five long and named Clients until Clients moved into
      // the More menu so Tim could be dead centre. Centring needs an ODD number
      // of slots and the bar had six.
      expect(r.dragged).toEqual(
        ['mtb-jobs', 'mtb-leads', 'mtb-tim-slot', 'mtb-dash']);
      expect(r.restored).toEqual(
        ['mtb-dash', 'mtb-leads', 'mtb-tim-slot', 'mtb-jobs']);
      expect(r.timInInner, 'he is not one of the draggable tabs').toBe(false);
      expect(r.timInBar, 'and he is not inside the bar at all').toBe(false);
    });

    // The mark used to be seven SVG primitives, so it could not fail to arrive:
    // if the string was in the file it was on screen. It is a file now, and the
    // failure mode of a file is silent. `serve -s` answers a missing path with
    // index.html at 200, so a typo in the src does not 404, it hands the <img>
    // a page of HTML and the browser draws nothing. He would still pass every
    // test above with an empty hole where the man is. naturalWidth is the only
    // thing that knows the difference.
    test('the mark is a file that actually arrived', async () => {
      const r = await page.evaluate(async () => {
        document.getElementById('_tim-ov')?.remove();
        timDockRender();
        const img = document.querySelector('#mtb-tim-mark img');
        if (!img) return { found: false };
        if (!img.complete) await img.decode().catch(() => {});
        return {
          found: true,
          natural: img.naturalWidth,
          // 10.4, fifth value: '58' as a floating disc, '26' raised, '24' as
          // a seated inlay, '32' in the ink orb, 36 now. Owner: "make tims
          // face a bit bigger". The orb went to 60 with it.
          drawn: img.getAttribute('width'),
          // Every density has to be listed or a 3x phone silently takes the
          // one file it was given and softens it.
          densities: (img.getAttribute('srcset') || '').split(',').length,
        };
      });
      expect(r.found).toBe(true);
      expect(r.natural).toBeGreaterThan(0);
      expect(r.drawn).toBe('36');
      expect(r.densities).toBe(3);
    });

    // He is inline in a row of scope at 16 and he is the biggest thing on the
    // screen at 58, off the same three files. What must NOT happen is a caller
    // getting a box of a different size than it asked for.
    test('he holds at every size he is asked for', async () => {
      const r = await page.evaluate(() =>
        [16, 20, 26, 34, 58].map(n => {
          const d = document.createElement('div');
          d.innerHTML = timMark(n);
          const i = d.firstChild;
          return [i.tagName, Number(i.getAttribute('width')), Number(i.getAttribute('height')),
            i.getAttribute('sizes')].join(':');
        }));
      expect(r).toEqual([
        'IMG:16:16:16px', 'IMG:20:20:20px', 'IMG:26:26:26px',
        'IMG:34:34:34px', 'IMG:58:58:58px',
      ]);
    });
  });

  // ── The raised key gets out of the way ────────────────────────────────────
  //
  // Rule 15.3: no two interactive controls may overlap, at 390px and at desktop
  // width. This group has outlived three different Tims and the rule is the
  // only thing in it that has not changed.
  //
  // 1. Floating bottom-right. The estimate builder pins a full-width blue bar
  //    across the bottom the moment a line is added, so _timDockLift measured
  //    every fixed bottom bar on each render and stood him on the tallest one.
  //    It obeyed 15.3 by DODGING, and it still left him covering whatever card
  //    was underneath.
  // 2. Tucked against the right edge at mid-height. Nothing fixed lives there,
  //    so 15.3 was met by not being there rather than by dodging.
  // 3. Raised off the centre of the bottom bar, bottom edge flush with its top
  //    edge. 15.3 is met by CONSTRUCTION: bottom:100% puts him wholly above the
  //    bar's padding box, so the tab underneath him keeps every pixel of its
  //    tap target, and there is still nothing to measure.
  //
  // The tests below say that third thing, and they say it by measuring rather
  // than by reading the stylesheet back, because a rule that is overridden
  // somewhere else still reads correctly where it was written.
  test.describe('the raised key does not land on anything', () => {
    test.afterEach(async () => {
      await page.evaluate(() => {
        document.getElementById('gei-cart-bar')?.remove();
        document.getElementById('_tim-ov')?.remove();
      });
    });

    // The one that matters most, and the one a stylesheet cannot be trusted
    // ── 10.4: this assertion has been rewritten three times and the RULE has
    // not moved once. 15.3 is the rule: no two interactive controls may
    // overlap. What changed is how it is met.
    //   1. Floating bottom-right, met by DODGING: _timDockLift measured every
    //      fixed bottom bar on every render and stood him on the tallest one.
    //   2. Raised wholly above the bar, met by ABSENCE: bottom:100% put him
    //      above the padding box so no tab could lose a pixel.
    //   3. Seated in the row, met by RESERVATION: he has his own slot, held by
    //      #mtb-tim-slot, so he can sit down INTO the bar (which is the whole
    //      of "built into the nav bar") and still take nothing off anybody.
    // So the assertion is no longer about height at all. It is that his column
    // is the seat's column and that he touches no tab.
    test('he sits in a slot of his own, so nothing of a tab is spent on him', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const key = document.getElementById('mtb-tim').getBoundingClientRect();
        const seat = document.getElementById('mtb-tim-slot').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('#mobile-tabbar .mtb')].map(t => {
          const b = t.getBoundingClientRect();
          return {
            id: t.id,
            // Any overlap at all, not just an overlap of centres. A thumb that
            // lands on the top eight pixels of Clients and opens Tim is the bug.
            hits: !(key.right <= b.left || key.left >= b.right ||
                    key.bottom <= b.top || key.top >= b.bottom),
            h: Math.round(b.height),
          };
        });
        return {
          offSeat: Math.round((key.left + key.width / 2) - (seat.left + seat.width / 2)),
          // He is allowed to be wider than his seat at the top, where he is
          // above the bar and over nobody. He must not be wider than it DOWN
          // IN the row, which is the part that sits between two tabs.
          wordWidth: Math.round(document.getElementById('mtb-tim-word').getBoundingClientRect().width),
          seatWidth: Math.round(seat.width),
          seatTaps: getComputedStyle(document.getElementById('mtb-tim-slot')).pointerEvents,
          tabs,
        };
      });
      expect(Math.abs(r.offSeat), 'he is not centred on his own seat').toBeLessThanOrEqual(1);
      expect(r.tabs.filter(t => t.hits).map(t => t.id)).toEqual([]);
      expect(r.wordWidth).toBeLessThanOrEqual(r.seatWidth);
      // The seat is furniture, not a second control in the same place as him.
      expect(r.seatTaps).toBe('none');
      // And the tabs beside him are still full-size targets.
      r.tabs.forEach(t => expect(t.h, t.id + ' height').toBeGreaterThanOrEqual(56));
    });

    // ── Built into the bar, and the white that proved he was not ────────────
    // Owner, 2026-09-21: "more pronounced and no white uglyness around the
    // outside at the bottom, want Tim built into the nav bar, a lot of dead
    // space under him that could be filled up."
    // The white was a HOLE. That version masked a notch out of the bar, and a
    // mask cuts the bar away and lets whatever is behind it show through, so
    // every pixel of clearance around him was a pixel of PAGE, which on a light
    // screen is a bright rim. Nothing is cut now: the ring around him is a disc
    // of the bar's own ink painted over the bar rather than out of it.
    // Both halves are geometry, so both can be pinned, and the second one is
    // the one that would silently come back: a future restyle that reached for
    // a mask again would put the white straight back.
    // ── 10.4: the ring is gone and what replaced it is the point ────────────
    // WAS: a disc of the bar's own ink painted around him, which killed the
    // white a masked notch had been showing. It did kill it, and it created
    // the next complaint in the same stroke: above the bar's edge that ink has
    // nothing to be continuous WITH, so it read as a black collar sitting on
    // the page. Owner: "no black background around the top ... make him kinda
    // glass morph into the bar and give shade around the top."
    // NOW the two jobs are separated. GLASS does the blending: he is
    // translucent over a blurred backdrop, so his lower half samples the bar's
    // ink and his upper half samples the page and he shades from one into the
    // other by himself, with nothing drawn between them. SHADE does the
    // separation, and it is shadow rather than paint, so it has no edge.
    // Both are still about the same underlying rule and both would be undone
    // by the same mistake, which is why they are still tested: an opaque fill
    // or a mask on the bar brings back the collar or the white respectively.
    test('he is glass over the bar, with shade rather than an edge', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const orb = document.getElementById('mtb-tim-orb');
        const bar = document.getElementById('mobile-tabbar');
        const cs = getComputedStyle(orb);
        const alpha = (c) => {
          const m = /rgba?\(([^)]+)\)/.exec(c || '');
          if (!m) return 1;
          const p = m[1].split(',').map(x => parseFloat(x));
          return p.length > 3 ? p[3] : 1;
        };
        // The background is a gradient, so the alpha lives in its colour stops.
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []);
        return {
          // Nothing may be cut out of the bar. A mask is what put page behind
          // him, and -webkit- is checked too because that is the property that
          // actually ships on the phones this runs on.
          barMask: getComputedStyle(bar).maskImage || 'none',
          barMaskWk: getComputedStyle(bar).webkitMaskImage || 'none',
          // Translucent, or he is not glass and nothing blends.
          maxAlpha: stops.length ? Math.max.apply(null, stops.map(alpha)) : 1,
          opaqueBg: alpha(cs.backgroundColor),
          blur: cs.backdropFilter || cs.webkitBackdropFilter || '',
          // A LIGHT rim. A dark one tells the eye the thing is a hole.
          rim: cs.borderTopColor,
          // And the shade is shadow. A painted halo was tried and reads as a
          // grey smudge on a light page, because a gradient has a falloff you
          // can see the end of.
          shadow: cs.boxShadow,
          painted: getComputedStyle(orb, '::before').backgroundImage,
        };
      });
      expect(['none', ''], 'a mask on the bar is the white coming back')
        .toContain(r.barMask);
      expect(['none', '']).toContain(r.barMaskWk);
      // ── 10.4: 0.9 became 0.93, and the number is worth explaining ───────
      // The old figure was mine, invented one commit earlier, and the product
      // moved under it: owner asked for him darker and 0.90 landed exactly on
      // the line. What the guard is actually for is stopping somebody filling
      // him in solid, because an opaque disc blends with nothing and the whole
      // morph dies. Anything at 1.0 is that; 0.90 still lets the backdrop tint
      // him and you can still read the page through his top. So the line sits
      // just above where the design now is, which is the most it can be
      // loosened and still catch the thing it was written to catch.
      expect(r.maxAlpha, 'an opaque fill is not glass').toBeLessThan(0.93);
      expect(r.opaqueBg, 'and nothing opaque underneath it either').toBeLessThan(0.93);
      expect(r.blur, 'glass needs the backdrop blurred behind it').toMatch(/blur/);
      // The rim is pale: every channel well above the ink he sits on.
      const rgb = (r.rim.match(/\d+/g) || []).slice(0, 3).map(Number);
      rgb.forEach(c => expect(c, 'the rim has to be light, not ink').toBeGreaterThan(180));
      expect(r.shadow, 'the shade is shadow').toMatch(/rgba?\(/);
      expect(['none', ''], 'no painted halo: it smudges on a light page')
        .toContain(r.painted);
    });

    // The dead space under him is filled with the thing he was missing. Every
    // other slot in this row is a glyph with a word under it; he was the only
    // one without, and a wordless control is the one a man never learns the
    // name of. It has to match its neighbours exactly or the row reads as five
    // of one thing and a guest.
    test('he has a word, on the same line and in the same type as his neighbours', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const w = document.getElementById('mtb-tim-word');
        const tab = document.getElementById('mtb-jobs');
        const cs = getComputedStyle(w), ts = getComputedStyle(tab);
        return {
          text: w.textContent,
          size: cs.fontSize, tabSize: ts.fontSize,
          weight: cs.fontWeight, tabWeight: ts.fontWeight,
          colour: cs.color, tabColour: ts.color,
          // On the SAME line, not near it. Measured off the bottom of each,
          // which is what the eye actually reads along.
          base: Math.round(w.getBoundingClientRect().bottom),
          tabBase: Math.round([...tab.childNodes]
            .filter(n => n.nodeType === 3 && n.textContent.trim()).length
            ? tab.getBoundingClientRect().bottom - parseFloat(ts.paddingBottom)
            : tab.getBoundingClientRect().bottom),
        };
      });
      expect(r.text).toBe('Tim');
      expect(r.size).toBe(r.tabSize);
      expect(r.weight).toBe(r.tabWeight);
      expect(r.colour).toBe(r.tabColour);
      expect(Math.abs(r.base - r.tabBase), 'his word is off the row\'s baseline').toBeLessThanOrEqual(2);
    });

    // ── 10.4: he is no longer on the bar's centreline, on purpose ───────────
    // WAS: dead centre of the bar. Owner sketched the replacement: him
    // "splitting the difference between leads and clients", the bar rounding
    // around him. Six slots now rather than five, his is the third, and dead
    // centre would put him on the seam between his own seat and Clients.
    // What the test is really for is unchanged: he must be where the row says
    // he is, because off-position on a raised control reads as a mistake
    // rather than a choice. So it measures him against his SEAT.
    test('he sits on his seat, between two tabs rather than on one', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const key = document.getElementById('mtb-tim').getBoundingClientRect();
        const seat = document.getElementById('mtb-tim-slot').getBoundingClientRect();
        const kids = [...document.querySelectorAll('#mtb-inner > *')].map(e => e.id);
        return {
          off: Math.abs((key.left + key.width / 2) - (seat.left + seat.width / 2)),
          at: kids.indexOf('mtb-tim-slot'),
          n: kids.length,
        };
      });
      expect(r.off).toBeLessThanOrEqual(1);
      // Between two of them, with tabs on both sides. Which two is the owner's
      // business, since he can drag them; that there are some is not.
      expect(r.at).toBeGreaterThan(0);
      expect(r.at).toBeLessThan(r.n - 1);
    });

    // The bar used to carry overflow:hidden, which would have clipped him in
    // half. The clipping moved onto .mtb, which is the thing that actually had
    // a label to clip, so this asserts he is whole AND that the tabs kept the
    // protection the bar was giving them.
    test('the bar does not clip him, and the tabs still clip themselves', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const key = document.getElementById('mtb-tim');
        return {
          bar: getComputedStyle(document.getElementById('mobile-tabbar')).overflowY,
          tab: getComputedStyle(document.getElementById('mtb-dash')).overflowY,
          h: Math.round(key.getBoundingClientRect().height),
        };
      });
      expect(r.bar).not.toBe('hidden');
      expect(r.tab).toBe('hidden');
      expect(r.h, 'his full height, not a clipped one').toBeGreaterThanOrEqual(40);
    });

    // ── The estimate builder's cart bar, which is the real case ─────────────
    //
    // This test used to assert he was geometrically CLEAR of any bottom bar,
    // whatever its height, and he is not: _geiRenderCartBar pins a full-width
    // blue bar at bottom:0 on step 2 of the builder, and a tall one reaches
    // past the tab bar's top edge and into him.
    //
    // Asserting clearance was asserting the wrong thing. 15.3 is about a thumb
    // landing on a control the man did not mean, and paint order decides that,
    // not bounding boxes. That bar is z-index 8000 against the tab bar's 1000,
    // so it covers the ENTIRE tab bar already, every tab, and has done since
    // long before Tim existed. He is part of that chrome now and he is covered
    // with it: no tap of his is stolen, and none of his steals one, because in
    // any pixel they share the bar is what the browser hands the tap to.
    //
    // So the question is put to the browser directly rather than to arithmetic:
    // over a grid across his whole box, what would a thumb actually hit? The
    // answer has to be him or the bar on top of him, and never a tab.
    test('a bottom bar over the tab bar covers him with it, it never splits a tap', async () => {
      const r = await page.evaluate(() => {
        const out = [];
        const bar = document.createElement('div');
        bar.id = 'gei-cart-bar';
        // The real one's geometry and stacking, from _geiRenderCartBar.
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:8000;background:#2D5DA8';
        document.body.appendChild(bar);
        [56, 88, 140].forEach(h => {
          bar.style.height = h + 'px';
          timDockRender();
          const k = document.getElementById('mtb-tim').getBoundingClientRect();
          // Only the tabs are asked about. A point on one of his rounded
          // corners is not his pixel and resolves to whatever page content is
          // behind him, which is correct: a corner he does not paint is a
          // corner he has no claim on. What must never happen is a thumb aimed
          // at him landing on Leads.
          const wrong = [];
          for (let x = 1; x < k.width; x += 4) {
            for (let y = 1; y < k.height; y += 4) {
              const el = document.elementFromPoint(k.left + x, k.top + y);
              if (el && el.closest('.mtb')) wrong.push(el.closest('.mtb').id + '@' + h);
            }
          }
          out.push([...new Set(wrong)]);
        });
        bar.remove();
        timDockRender();
        return out;
      });
      expect(r, 'a thumb aimed at him landed on a tab').toEqual([[], [], []]);
    });

    // 8.5: the stylesheet owns where he sits and how he is shown, so the JS
    // writes no style property at all. He is toggled with the `hidden`
    // attribute, which is also the honest one: he is display:flex, so the old
    // style.display='' was restoring the wrong default and only worked because
    // nothing measured it.
    test('the stylesheet owns him, so the JS writes no style property', async () => {
      const r = await page.evaluate(() => {
        timDockRender();
        const key = document.getElementById('mtb-tim');
        const dot = document.getElementById('mtb-tim-dot');
        return {
          key: key.getAttribute('style'),
          dot: dot.getAttribute('style'),
          orb: document.getElementById('mtb-tim-orb').getAttribute('style'),
          word: document.getElementById('mtb-tim-word').getAttribute('style'),
          pos: getComputedStyle(key).position,
        };
      });
      expect(r.key, 'inline style on the key').toBeFalsy();
      expect(r.dot, 'inline style on the badge').toBeFalsy();
      expect(r.orb, 'inline style on the orb').toBeFalsy();
      expect(r.word, 'inline style on the word').toBeFalsy();
      // 10.4: 'absolute' while he was a child of the bar. He is a sibling of it
      // now, so the same "the stylesheet owns where he sits" fact is fixed.
      expect(r.pos).toBe('fixed');
    });

    // Quiet he is a key with a face on it; awake he is the same key with a
    // badge in its corner. What must not happen is the badge growing the
    // control itself, because then he moves every time the books change.
    test('a badge changes what he says, never where he is or how big he is', async () => {
      const box = await page.evaluate(() => {
        const real = timNudges;
        const at = () => {
          timDockRender();
          const r = document.getElementById('mtb-tim').getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        };
        timNudges = () => [];
        const quiet = at();
        timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240' }]);
        const one = at();
        timNudges = () => ([
          { id: 'a', line: 'a', figure: '$1' }, { id: 'b', line: 'b', figure: '$2' },
          { id: 'c', line: 'c', figure: '$3' }]);
        const three = at();
        timNudges = real;
        timDockRender();
        return { quiet, one, three };
      });
      expect(box.one).toEqual(box.quiet);
      expect(box.three).toEqual(box.quiet);
    });

    const PAGES = ['pg-dash', 'pg-clients', 'pg-jobs', 'pg-money', 'pg-tracker', 'pg-settings'];
    for (const pg of PAGES) {
      test(`he never sits on a control's tappable centre, quiet or awake: ${pg}`, async () => {
        const hits = await page.evaluate((id) => {
          const real = timNudges;
          goPg(id);
          const overlaps = () => {
            const b = document.getElementById('mtb-tim').getBoundingClientRect();
            const bar = document.getElementById('mobile-tabbar').getBoundingClientRect();
            return [...document.querySelectorAll(
              'button,a,input,select,textarea,[role="button"],[onclick]')]
              .filter(el => {
                if (el.id === 'mtb-tim' || el.closest('#mtb-tim')) return false;
                if (el.closest('#_tim-ov')) return false;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return false;
                if (r.bottom < 0 || r.top > window.innerHeight) return false;   // off screen
                // The point a thumb aims at, not the whole box.
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                // Already behind the tab bar, which is opaque and fixed and has
                // covered it since long before Tim existed. He reaches down into
                // the row now, so without this the test reports him for stealing
                // taps the BAR was already taking: a control a thumb cannot
                // reach is not a control two things are fighting over.
                if (cy >= bar.top && cy <= bar.bottom) return false;
                return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
              })
              .map(el => (el.id || el.className || el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"');
          };
          timNudges = () => [];
          timDockRender();
          const quiet = overlaps();
          timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240' }]);
          timDockRender();
          const awake = overlaps();
          timNudges = real;
          timDockRender();
          return { quiet, awake };
        }, pg);
        expect(hits.quiet).toEqual([]);
        expect(hits.awake).toEqual([]);
      });
    }

    test('it never pushes the page sideways, at phone width or desktop', async () => {
      for (const w of [390, 1280]) {
        await page.setViewportSize({ width: w, height: 844 });
        const over = await page.evaluate(() => {
          timDockRender();
          return document.documentElement.scrollWidth - window.innerWidth;
        });
        expect(over, 'horizontal bleed at ' + w + 'px').toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    });

    // Everything Tim can name is money or a contract, and both sit behind the
    // wall the nav already puts them behind. A crew member gets no Tim.
    test('a crew member gets no key', async () => {
      const r = await page.evaluate(() => {
        const was = _isEmployee;
        _isEmployee = true;
        try { timDockRender(); return document.getElementById('mtb-tim').hidden; }
        finally { _isEmployee = was; timDockRender(); }
      });
      expect(r).toBe(true);
    });

    test('rendering it fifty times leaves one key and throws nothing', async () => {
      const r = await page.evaluate(() => {
        let threw = false;
        try { for (let i = 0; i < 50; i++) timDockRender(); } catch (e) { threw = true; }
        return { threw, n: document.querySelectorAll('#mtb-tim').length };
      });
      expect(r).toEqual({ threw: false, n: 1 });
    });
  });

  // ── At the counter ────────────────────────────────────────────────────────
  //
  // Owner 2026-09-19: "we would never line item out all the shit on the client
  // side but could do it on the contractor side so they could generate a list
  // to check things off as they get it."
  //
  // The app already has that screen. What it did not have was anything on it
  // for a trade that does not paint, which is why Tim's items fold into the
  // Supply List's own sections rather than onto a second checklist (7.3).
  test.describe('the pickup list carries what Tim took off the job', () => {
    const SUPPLY = [
      { id: 'romex', label: '12-2 NM-B romex', qty: 2, unit: 'roll', per: 250, section: 'wire', detail: 'Yellow jacket' },
      { id: 'shingle', label: 'Architectural shingles', qty: 28, unit: 'square', per: 3, section: 'roof' },
      { id: 'scaffold', label: 'Scaffold', qty: 3, unit: 'd', per: 1, section: 'rental' },
    ];

    test.afterEach(async () => {
      await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
    });

    test('a rough-in list shows up under its own trade heads', async () => {
      const r = await page.evaluate(sup => {
        const secs = [];
        _timSupplyInto(secs, { timSupply: sup });
        return secs.map(s => [s.id, s.items.length]);
      }, SUPPLY);
      expect(r).toContainEqual(['rental', 1]);
      expect(r).toContainEqual(['wire', 1]);
      expect(r).toContainEqual(['roof', 1]);
    });

    // A painter's own Rentals section is one section, not two with the same
    // name, which is the whole reason the four ids were kept.
    test('it merges into a section that is already there rather than repeating it', async () => {
      const r = await page.evaluate(sup => {
        const secs = [{ id: 'rental', label: 'Rentals', color: '#5B21B6', bg: '#F5F3FF',
          items: [{ label: 'Pressure washer', qty: 1, unit: 'rental', cat: 'rental' }] }];
        _timSupplyInto(secs, { timSupply: sup });
        const rental = secs.filter(s => s.id === 'rental');
        return { sections: rental.length, items: rental[0].items.map(i => i.label) };
      }, SUPPLY);
      expect(r.sections).toBe(1);
      expect(r.items).toEqual(['Pressure washer', 'Scaffold']);
    });

    // 28 squares is not a thing that can be put on a truck. The counter sells
    // bundles, so the pickup list says bundles and shows the conversion under it.
    test('the count is what the counter sells, with the conversion under it', async () => {
      const r = await page.evaluate(sup => {
        const secs = [];
        _timSupplyInto(secs, { timSupply: sup });
        const sh = secs.find(s => s.id === 'roof').items[0];
        return { qty: sh.qty, unit: sh.unit, detail: sh.detail };
      }, SUPPLY);
      expect(r).toEqual({ qty: '84', unit: 'bundles', detail: '28 squares at 3 bundles' });
    });

    // A bid written before Tim existed, and a bid that came back from sync with
    // junk in it, must not take the supply list down on a man at a counter.
    test('a bid with no list, or a corrupted one, changes nothing and throws nothing', async () => {
      const r = await page.evaluate(() => {
        const out = [];
        let threw = false;
        try {
          [undefined, null, {}, { timSupply: null }, { timSupply: 'nope' },
            { timSupply: [null, {}, { section: 'wire' }] }].forEach(b => {
            const secs = [];
            _timSupplyInto(secs, b);
            out.push(secs.length);
          });
        } catch (e) { threw = true; }
        return { threw, out };
      });
      expect(r).toEqual({ threw: false, out: [0, 0, 0, 0, 0, 0] });
    });
  });

  // ── Starting a proposal through Tim ───────────────────────────────────────
  //
  // Owner 2026-09-19: "you click into him and say you want to build a T&M or a
  // true bid scan or a BYO then he asks is there any site notes like a dog,
  // parking restrictions, etc? Answer then go."
  //
  // Two steps, and the second one is the point. The site note is the only thing
  // on an estimate worth capturing while he is still on the driveway looking at
  // the dog, and the old textarea asked for it on a page he opens to write
  // scope, which is why it was almost always empty.
  test.describe('say the door, answer one question, go', () => {
    const CLIENT = { id: 87701, name: 'Dana Whitfield', addr: '1200 Elm St, Wichita KS 67203' };

    test.beforeEach(async () => {
      await page.evaluate(c => {
        clients.length = 0; clients.push(JSON.parse(JSON.stringify(c)));
        document.getElementById('_tim-ov')?.remove();
        document.getElementById('_style-pick-ov')?.remove();
        window.__picked = null;
        window._pickEstStyle = (style) => { window.__picked = { style, c: _stylePickState && _stylePickState.c }; };
      }, CLIENT);
      await page.evaluate(() => goPg('pg-dash'));
    });

    // ── Which door he asked for ─────────────────────────────────────────────
    test('each of the three is recognised, in the words he says them', async () => {
      const r = await page.evaluate(() => [
        'build me a t and m for dana', 'time and materials for dana', 'bill it hourly',
        'true bid for dana', 'lets scan it', 'truebid', 'trace it from above',
        'build your own for dana', 'byo', 'line items', 'flat price',
      ].map(t => (timStyle(t) || {}).id));
      expect(r).toEqual([
        'tm', 'tm', 'tm',
        'truebid', 'truebid', 'truebid', 'truebid',
        'freeform', 'freeform', 'freeform', 'freeform',
      ]);
    });

    // "Build your own" must not be eaten by "build", and "true bid" must not be
    // eaten by "bid", which on its own means a proposal in general.
    test('a longer phrase wins, and a bare "bid" picks nothing', async () => {
      const r = await page.evaluate(() => [
        (timStyle('build your own') || {}).id,
        timStyle('send that bid'),
        timStyle('what a morning'),
        timStyle(''), timStyle(null),
      ]);
      expect(r).toEqual(['freeform', null, null, null, null]);
    });

    // ── The one question ────────────────────────────────────────────────────
    test('a door plus a customer asks about the site, it does not just open', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const el = document.getElementById('_tim-say');
        el.value = 'build me a t and m for dana';
        _timGo();
        const sheet = document.getElementById('_tim-sheet');
        return { text: sheet ? sheet.textContent : '', opened: !!window.__picked, field: !!document.getElementById('_tim-note') };
      });
      expect(r.text).toContain('Anything the crew should know before they get there?');
      expect(r.text).toContain('A dog, where to park, a gate code, a lock box');
      expect(r.text).toContain('Time and materials for Dana Whitfield');
      expect(r.field).toBe(true);
      // Nothing has opened yet. The question comes first, which is the whole ask.
      expect(r.opened).toBe(false);
    });

    test('the answer is saved and the right door opens, through the app own router', async () => {
      const r = await page.evaluate(() => {
        openTim();
        const el = document.getElementById('_tim-say');
        el.value = 'true bid for dana';
        _timGo();
        document.getElementById('_tim-note').value = 'Dog in the back, park on the street, code 4417';
        _timSaveSiteNoteAndGo();
        return { picked: window.__picked, held: timTakePendingSiteNote(), closed: !document.getElementById('_tim-ov') };
      });
      expect(r.picked.style).toBe('truebid');
      expect(r.picked.c.name).toBe('Dana Whitfield');
      expect(r.held).toBe('Dog in the back, park on the street, code 4417');
      expect(r.closed).toBe(true);
    });

    // "Nope" is an answer to the question, not a gate code. Saving it would put
    // the word nope on a customer house forever.
    test('a no is a no, not a note', async () => {
      const r = await page.evaluate(() => {
        const said = ['no', 'nope', 'nah', 'nothing', 'none', 'not really', 'all good', ''];
        const asNothing = said.map(t => timIsNothing(t));
        openTim();
        document.getElementById('_tim-say').value = 'build your own for dana';
        _timGo();
        document.getElementById('_tim-note').value = 'nope';
        _timSaveSiteNoteAndGo();
        return { asNothing, held: timTakePendingSiteNote(), picked: window.__picked.style };
      });
      expect(r.asNothing).toEqual([true, true, true, true, true, true, true, true]);
      expect(r.held).toBe('');
      expect(r.picked).toBe('freeform');   // still goes, it just saves nothing
    });

    test('"Nothing" skips straight through', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = 'build me a t and m for dana';
        _timGo();
        _timBuildGo();
        return { picked: window.__picked.style, held: timTakePendingSiteNote() };
      });
      expect(r).toEqual({ picked: 'tm', held: '' });
    });

    // Asking a man for a gate code he gave you in May is how an assistant
    // teaches somebody to ignore it.
    test('a property he has been to shows what he said last time, to confirm in one tap', async () => {
      const r = await page.evaluate(() => {
        setSiteNote(clients[0], clients[0].addr, 'Lockbox 5590 on the front porch');
        openTim();
        document.getElementById('_tim-say').value = 'build me a t and m for dana';
        _timGo();
        const sheet = document.getElementById('_tim-sheet');
        return { text: sheet.textContent, asksBlank: !!document.getElementById('_tim-note') };
      });
      expect(r.text).toContain('Anything changed at 1200 Elm St?');
      expect(r.text).toContain('Lockbox 5590 on the front porch');
      expect(r.text).toContain('Still right, start');
      expect(r.asksBlank).toBe(false);
    });

    // ── Which property ──────────────────────────────────────────────────────
    //
    // A client can own five houses and the BUILDER is what decides which one
    // this job is at. Writing the note when he answers would put the gate code
    // for house four on house one, so the answer is held until the page knows.
    test('the note is held until the estimate page knows its address', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = 'build me a t and m for dana';
        _timGo();
        document.getElementById('_tim-note').value = 'Side gate, beware of dog';
        _timSaveSiteNoteAndGo();
        // Not written to the client yet: nothing knows the address.
        const beforeOpen = getSiteNote(clients[0], clients[0].addr);
        // Now the builder opens and the address is real.
        _geiClientId = clients[0].id; _geiIsTM = true; _geiIsFreeForm = false;
        openTMEstimate(clients[0]);
        _tmShowPage();
        return { beforeOpen, afterOpen: getSiteNote(clients[0], clients[0].addr) };
      });
      expect(r.beforeOpen).toBe('');
      expect(r.afterOpen).toBe('Side gate, beware of dog');
    });

    // ── He never said which kind ────────────────────────────────────────────
    test('a customer with no door named gets the three doors, not a guess', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = 'start something for dana';
        _timGo();
        const sheet = document.getElementById('_tim-sheet');
        return { text: sheet.textContent, opened: !!window.__picked };
      });
      expect(r.text).toContain('How are you billing it?');
      expect(r.text).toContain('Time and materials');
      expect(r.text).toContain('TrueBid');
      expect(r.text).toContain('Build your own');
      expect(r.opened).toBe(false);
    });

    test('a door with nobody to build it for is not a build', async () => {
      const r = await page.evaluate(() => {
        goPg('pg-dash');
        openTim();
        document.getElementById('_tim-say').value = 'time and materials';
        const p = _timGo();
        return { kind: p.kind, opened: !!window.__picked };
      });
      expect(r.kind).not.toBe('build');
      expect(r.opened).toBe(false);
    });

    // A sentence that describes the WORK is the existing estimate-speak path
    // and must not be hijacked into the two-step flow.
    test('a sentence with hours in it still goes to the estimate parser', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = 'build a t and m for dana, eight hours';
        const p = _timGo();
        return { kind: p.kind, style: p.style };
      });
      // Still a build, and still T&M: the hours ride along into the builder.
      expect(r.kind).toBe('build');
      expect(r.style).toBe('tm');
    });

    test('the flow survives being cancelled halfway', async () => {
      const r = await page.evaluate(() => {
        openTim();
        document.getElementById('_tim-say').value = 'build me a t and m for dana';
        _timGo();
        _timClose();
        let threw = false;
        try { _timSaveSiteNoteAndGo(); _timBuildGo(); } catch (e) { threw = true; }
        return { threw, opened: !!window.__picked };
      });
      expect(r).toEqual({ threw: false, opened: false });
    });
  });

  // ── What a navigation is allowed to cost ───────────────────────────────────
  // goPg calls timDockRefresh on every page change, which this branch added, and
  // timDockRender was running the whole job analysis behind it: the estimate read
  // off the DOM, every bid through getBidBalance (which walks payments), a scan
  // of expenses for a rental rate, and the state-rule lookup. A frame of that
  // after every navigation in the app is a tax on the whole product, and it got
  // heavier the day _timOwedByClient started matching real rows instead of none.
  //
  // So the navigation path takes a cached answer and every other caller does not,
  // the same split renderTimeLog(opts) draws for a drill tap. Both halves are
  // pinned here, because a cache that never refreshes is a stale pill, and a
  // stale pill about money is worse than no pill at all.
  test.describe('a navigation does not redo the whole analysis', () => {
    test('a direct render always recomputes, a navigation inside the window does not', async () => {
      const r = await page.evaluate(() => {
        const real = timJobSnapshot;
        let n = 0;
        timJobSnapshot = function () { n++; return real.apply(null, arguments); };
        try {
          timDockRender();                   // a real open: computes
          const one = n;
          timDockRender();                   // still a real open: computes again
          const two = n;
          timDockRender({ cached: true });    // a navigation: does not
          timDockRender({ cached: true });
          timDockRender({ cached: true });
          return { one, two, afterThreeNavs: n };
        } finally { timJobSnapshot = real; }
      });
      expect(r.one).toBe(1);
      expect(r.two).toBe(2);
      expect(r.afterThreeNavs).toBe(2);
    });

    test('the cached answer expires, so the pill cannot go stale', async () => {
      const r = await page.evaluate(async () => {
        const real = timJobSnapshot;
        let n = 0;
        timJobSnapshot = function () { n++; return real.apply(null, arguments); };
        try {
          timDockRender({ cached: true });
          const before = n;
          await new Promise(res => setTimeout(res, 420));
          timDockRender({ cached: true });
          return { before, after: n };
        } finally { timJobSnapshot = real; }
      });
      expect(r.after).toBe(r.before + 1);
    });

    // 10.4: this assertion has now changed twice, and the INTENT has not moved
    // either time. It began by proving _timDockLift ran on the cached path too,
    // so a cart bar appearing between navigations still pushed him up; the lift
    // went with the move off the bottom. Then the pill and the breathing disc
    // went with the move onto the bar. What is left is what all three versions
    // were really about: caching the ANALYSIS must not leave him drawn for a
    // state he is no longer in.
    test('a cached render redraws what he says, it does not skip it', async () => {
      // The risk the cache introduces is not a stale ANSWER, which is the whole
      // point of it and lasts a third of a second. It is that a navigation takes
      // the cheap path and leaves the badge behind: a red 1 with no finding
      // behind it, or silence while he has three things to say. So the badge is
      // rebuilt from the answer on every render, cached or not, and this pins
      // that.
      const r = await page.evaluate(() => {
        const real = window.__realNudges || timNudges;
        window.__realNudges = real;
        const dot = document.getElementById('mtb-tim-dot');
        const shape = () => ({ text: dot.textContent, on: !dot.hidden });
        timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240' }]);
        timDockRender();                    // computes: one finding
        const awake = shape();
        dot.hidden = true;                  // something else stomps the DOM
        dot.textContent = '';
        timDockRender({ cached: true });     // a navigation: must redraw it
        const redrawn = shape();
        timNudges = real;
        timDockRender();
        return { awake, redrawn };
      });
      expect(r.awake).toEqual({ text: '1', on: true });
      expect(r.redrawn).toEqual({ text: '1', on: true });
    });

    test('navigating still refreshes him, it is just not doing it twice', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-dash');
        await new Promise(res => requestAnimationFrame(() => res()));
        return !document.getElementById('mtb-tim').hidden;
      });
      expect(r).toBe(true);
    });
  });

  // ── The send arrow ────────────────────────────────────────────────────────
  test.describe('the arrow that sends', () => {
    // 10.4: this asserted the arrow HID on an empty box and appeared when you
    // typed, on the iMessage precedent. The owner sent back a screenshot of the
    // Claude app he was typing in: a mic and a send arrow side by side, both
    // present, and the same is true of ChatGPT and WhatsApp. The swap is the
    // messaging pattern, not the assistant one.
    // The objection it answered still stands though, so what is asserted now is
    // the version that keeps both: always on the row so the thumb knows where
    // it will be, and inert on an empty box so it can never fire on nothing.
    test('it is always on the row, and inert until there is something to send', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timLogClear();
        openTim();
        // The dim is transitioned, so reading opacity straight after changing
        // the value returns the frame it is ON, not the state it is going to.
        // Killing the transition is the deterministic way to assert the END
        // state; sleeping would be asserting the duration by proxy and would
        // flake on a loaded runner, which this suite has already taught twice.
        const stop = document.createElement('style');
        stop.textContent = '#_tim-send{transition:none !important}';
        document.head.appendChild(stop);
        const box = document.getElementById('_tim-say');
        const read = () => {
          const e = document.getElementById('_tim-send');
          const cs = getComputedStyle(e);
          return { shown: cs.display !== 'none', taps: cs.pointerEvents !== 'none',
            dim: Number(cs.opacity) < 0.9 };
        };
        const empty = read();
        // Through the app's own setter (it fires input) rather than a bare
        // write. CHANGED 2026-09-22 with the mechanism: this used to lean on
        // :placeholder-shown reacting to the value alone, which WebKit does not
        // do, so the bare write was driving a path the app does not have. The
        // app never sets this box without firing input any more.
        _timSetSaid(box, 'who owes me money');
        const typed = read();
        _timSetSaid(box, '');
        const cleared = read();
        stop.remove();
        document.getElementById('_tim-ov')?.remove();
        return { empty, typed, cleared };
      });
      // Present the whole time. Dim and untappable with nothing in the box.
      expect(r.empty).toEqual({ shown: true, taps: false, dim: true });
      expect(r.typed).toEqual({ shown: true, taps: true, dim: false });
      // And back again, because the row's data-empty tracks the VALUE through
      // one listener that every write goes through: a paste, a dictation result, an
      // autofill or an undo cannot strand it in the wrong state.
      expect(r.cleared).toEqual({ shown: true, taps: false, dim: true });
    });

    test('the mic keeps its place beside it rather than being replaced', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        openTim();
        const box = document.getElementById('_tim-say');
        const micShown = () => {
          const e = document.getElementById('_tim-mic');
          return e ? getComputedStyle(e).display !== 'none' : 'ABSENT';
        };
        const empty = micShown();
        box.value = 'who owes me money';
        const typed = micShown();
        document.getElementById('_tim-ov')?.remove();
        return { empty, typed };
      });
      // ABSENT on a device with no speech recognition, which is correct and is
      // covered below. What must never happen is it being there and then gone.
      expect(r.typed).toBe(r.empty);
    });

    test('pressing it sends, without touching Enter', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timLogClear();
        openTim();
        document.getElementById('_tim-say').value = 'reglaze the transoms';
        document.getElementById('_tim-send').click();
        const e = timLogEntries()[0];
        const boxNow = document.getElementById('_tim-say').value;
        document.getElementById('_tim-ov')?.remove();
        return { said: e && e.said, boxNow };
      });
      expect(r.said).toBe('reglaze the transoms');
      expect(r.boxNow).toBe('');
    });

    test('a phone with no speech recognition still has a way to send', async () => {
      // The mic only renders when _voiceCapable() is true, which it is not in
      // a headless browser and is not on every device. The arrow is not a
      // companion to the mic, it is the control: if it only existed alongside
      // one, those phones would have a box with no way out of it but the
      // keyboard's return key.
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        openTim();
        const out = {
          voice: typeof _voiceCapable === 'function' ? _voiceCapable() : null,
          mic: !!document.getElementById('_tim-mic'),
          send: !!document.getElementById('_tim-send'),
        };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.send).toBe(true);
      // And when there IS no mic, the arrow is on its own, which is correct.
      if (!r.voice) expect(r.mic).toBe(false);
    });
  });

  // ── What he opens with ────────────────────────────────────────────────────
  //
  // Owner: "what Tim displays first makes zero sense." It did not. Three
  // separate lines all assumed a job was on screen, and they were shown on
  // every screen:
  //   "Reading this job and your price book"   the header subtitle
  //   "Nothing to flag on this job"            when he had no findings
  //   "Nothing on this one worth stopping you for. Say what changed..."
  // Opened from the dashboard, which is where the owner opened him, there is no
  // "this job", no "this one" and nothing that "changed". The first thing he
  // said was about a screen the man was not looking at.
  test.describe('the first thing he says is true where he is standing', () => {
    const open = async (pg) => page.evaluate((p) => {
      document.getElementById('_tim-ov')?.remove();
      window.__realNudges = window.__realNudges || timNudges;
      timNudges = () => [];
      timLogClear();
      goPg(p);
      openTim();
      const t = document.getElementById('_tim-sheet').textContent;
      document.getElementById('_tim-ov')?.remove();
      return t;
    }, pg);
    test.afterAll(async () => {
      await page.evaluate(() => { if (window.__realNudges) timNudges = window.__realNudges; });
    });

    test('off the estimate builder he never mentions a job that is not there', async () => {
      const t = await open('pg-dash');
      expect(t).not.toContain('this job');
      expect(t).not.toContain('this one');
      expect(t).not.toContain('what changed');
      // And no subtitle at all off the builder. "Reading your books" was the
      // app narrating its own filing: it told the owner nothing he did not
      // know and made a message-thread header read like a status bar. Every
      // thread on his phone shows a name and a face and nothing else.
      expect(t).not.toContain('Reading your books');
      expect(t).not.toContain('Reading');
    });

    // ── 10.4: prose became things to touch ──────────────────────────────────
    // WAS: a sentence, "Ask me what you are owed, what you charged for
    // something, or where your work is coming from." It names three real
    // things in the right words and it is still the wrong shape, because
    // reading a description of a question and then typing that question is two
    // steps where there should be none.
    // Jobber shipped the most prominent entry point available to them and then
    // had to publish "50 of the Best Prompts To Try in Jobber AI", because a
    // blank box teaches nobody anything. ServiceTitan's 2026 trades survey
    // names the same wall from the other side: after training and integration,
    // the top barrier is difficulty understanding how to use the tools.
    // The INTENT is unchanged and is why this test exists: he names what he can
    // actually do, in the words a man would use. They are tappable now.
    test('and what he can do is there to be touched, not described', async () => {
      const t = await open('pg-dash');
      expect(t).toContain('What am I owed');
      expect(t).toContain('Hours last week');
      expect(t).toContain('What do I invoice');
    });

    // The rule that makes a chip safe to ship: it has to be a question he
    // really answers, offline, right now. A chip that misses is worse than no
    // chip, because it is the app promising something in its own voice and
    // then failing in front of the man it promised.
    test('every chip is a question he can really answer', async () => {
      const r = await page.evaluate(() => TIM_CHIPS.map(c => {
        const a = timAsk(c.say);
        return { chip: c.chip, hit: !!(a && a.id && a.title) };
      }));
      expect(r.length).toBe(3);
      r.forEach(x => expect(x.hit, x.chip + ' does not answer').toBe(true));
    });

    // A chip is the man typing it, exactly: same box, same door (_timGo), so it
    // is logged as his and lands in the thread as his. No second path, which is
    // also why a chip cannot drift out of step with typing the same words.
    test('tapping one is the same as typing it', async () => {
      const r = await page.evaluate(async () => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        timLogClear();
        goPg('pg-dash');
        openTim();
        document.querySelector('.tim-chip').click();
        await new Promise(res => {
          const t = setInterval(() => {
            if (document.querySelector('.tim-msg.him')) { clearInterval(t); res(); }
          }, 20);
          setTimeout(() => { clearInterval(t); res(); }, 4000);
        });
        const out = {
          said: (document.querySelector('.tim-msg.me .tim-b') || {}).textContent || '',
          logged: (timLogEntries()[0] || {}).said || '',
          stillOpen: !!document.getElementById('_tim-say'),
        };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.said).toBe(TIM_CHIP_FIRST);
      expect(r.logged).toBe(TIM_CHIP_FIRST);
      expect(r.stillOpen, 'and it does not end the conversation either').toBe(true);
    });

    test('on the estimate builder the job copy is right, so it stays', async () => {
      const t = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        timLogClear();
        const c = { id: 96401, name: 'Opening Line', addr: '3 Opening St' };
        clients = clients.filter(x => x.id !== 96401).concat([c]);
        openGenericEstimate(c, null, null, { mode: 'byo' });
        openTim();
        const out = document.getElementById('_tim-sheet').textContent;
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      // With nothing found, the subtitle IS the "nothing to flag" line, so the
      // reading line is not also present: they occupy the same slot.
      expect(t).toContain('Nothing to flag on this job');
      expect(t).toContain('Say what changed');
    });

    test('with a finding up, the subtitle says what he read to get it', async () => {
      const t = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timLogClear();
        const c = { id: 96402, name: 'Subtitle Client', addr: '4 Subtitle St' };
        clients = clients.filter(x => x.id !== 96402).concat([c]);
        openGenericEstimate(c, null, null, { mode: 'byo' });
        timNudges = () => ([{ id: 'a', kind: 'dollar', line: 'Dana still owes on the last one',
          figure: '$1,240', title: '$1,240', what: 'Dana has $1,240 outstanding.',
          cta: 'Open what they owe', alt: 'Not now' }]);
        openTim();
        const out = document.getElementById('_tim-sheet').textContent;
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(t).toContain('Reading this job and your price book');
      expect(t).not.toContain('Nothing to flag');
    });

    // The conversation is the content. Nobody wants a paragraph of
    // introduction sitting on top of their own messages every time.
    test('once there is a thread, the opening line gets out of the way', async () => {
      const t = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        timLogClear();
        goPg('pg-dash');
        timLogSay('who owes me money', { kind: 'ask', title: '$3,500' });
        openTim();
        const out = document.getElementById('_tim-sheet').textContent;
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(t).not.toContain('Ask me what you are owed');
      expect(t).toContain('who owes me money');
    });

    // The three states above all decide at OPEN time, and none of them can see
    // the fourth: the man typing the first thing into an empty sheet. The line
    // stayed, so his own first question and the answer under it were pushed
    // down by a paragraph introducing a conversation that had already started.
    test('and it goes the moment he says something, not on the next open', async () => {
      const t = await page.evaluate(async () => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        timLogClear();
        goPg('pg-dash');
        openTim();
        const before = !!document.getElementById('_tim-hello');
        document.getElementById('_tim-say').value = 'who owes me money';
        _timGo();
        await new Promise(res => {
          const t2 = setInterval(() => {
            if (document.querySelector('.tim-msg.him')) { clearInterval(t2); res(); }
          }, 20);
          setTimeout(() => { clearInterval(t2); res(); }, 4000);
        });
        const out = { before, after: !!document.getElementById('_tim-hello'),
          thread: document.querySelectorAll('.tim-msg').length };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(t.before, 'an empty sheet still gets the line').toBe(true);
      expect(t.after, 'and it is gone once there is a conversation').toBe(false);
      expect(t.thread).toBeGreaterThan(0);
    });
  });

  // ── The badge, and the i that leaves ──────────────────────────────────────
  //
  // Owner asked for a small i in the corner to get people to tap, and then, on
  // the raised key: "if theres insights to see then we get the raised red
  // notification". So one element says both things, because they are the same
  // sentence in two moods: there is something here worth a tap.
  //
  // ── 10.4: one assertion in this group changed its VALUE ──────────────────
  // WAS: the badge only appeared from TWO findings up, because a pill sat
  // beside the dock already speaking the single one aloud, and a badge reading
  // "1" next to it was the app counting out loud.
  // NOW: there is no pill. A raised key has no room beside it for a sentence,
  // so the count IS the whole of what he can say without being tapped, and it
  // starts at one. Nothing else about the group moved.
  //
  // The rest still rests on the i RETIRING. An introduction that repeats is not
  // an introduction, it is clutter with a reason attached, and it would sit on
  // the bar of every screen forever on the app of a man who has been using Tim
  // daily for a year. These tests are mostly about it going away.
  test.describe('the badge counts, and the i that teaches it leaves', () => {
    const fresh = async () => {
      await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        try { localStorage.removeItem('td_tim_met'); } catch (_e) {}
        window.__realNudges = window.__realNudges || timNudges;
        timNudges = () => [];
        timDockRender();
      });
    };
    const badge = () => page.evaluate(() => {
      const b = document.getElementById('mtb-tim-dot');
      return { text: b.textContent, on: !b.hidden, hint: b.classList.contains('hint') };
    });
    const findings = (n) => page.evaluate(count => {
      window.__realNudges = window.__realNudges || timNudges;
      timNudges = () => Array.from({ length: count }, (_, i) =>
        ({ id: 'x' + i, line: 'finding ' + i, figure: '$' + (i + 1),
          title: '$' + (i + 1), what: 'finding ' + i, why: '', cta: 'Do it', alt: 'No' }));
      timDockRender();
    }, n);
    test.afterAll(async () => {
      await page.evaluate(() => {
        if (window.__realNudges) timNudges = window.__realNudges;
        try { localStorage.setItem('td_tim_met', '1'); } catch (_e) {}
        timDockRender();
      });
    });

    test('a phone that has never opened him gets the i', async () => {
      await fresh();
      expect(await badge()).toEqual({ text: 'i', on: true, hint: true });
    });

    test('opening him retires it on the spot, not on the next render', async () => {
      // If it only cleared on the next timDockRender it would sit behind the
      // open sheet and still be there when the sheet closed, having taught
      // nothing.
      await fresh();
      const after = await page.evaluate(() => {
        openTim();
        const b = document.getElementById('mtb-tim-dot');
        const out = { text: b.textContent, on: !b.hidden, hint: b.classList.contains('hint') };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(after).toEqual({ text: '', on: false, hint: false });
    });

    test('and it never comes back', async () => {
      await page.evaluate(() => { timNudges = () => []; timDockRender(); });
      expect(await badge()).toEqual({ text: '', on: false, hint: false });
    });

    // The change from the pill era, written down. One finding is a red 1.
    test('one finding is a red one, not a silent key', async () => {
      await findings(1);
      expect(await badge()).toEqual({ text: '1', on: true, hint: false });
    });

    test('a real count outranks the i, and the i never rides alongside findings', async () => {
      await fresh();
      await findings(3);
      expect(await badge()).toEqual({ text: '3', on: true, hint: false });
    });

    // The badge is his whole unprompted voice, so what it says has to reach
    // somebody who cannot see it.
    test('the count is on the control for a screen reader too', async () => {
      await findings(2);
      const label = await page.evaluate(() =>
        document.getElementById('mtb-tim').getAttribute('aria-label'));
      expect(label).toBe('Tim, 2 things to look at');
      await findings(1);
      expect(await page.evaluate(() =>
        document.getElementById('mtb-tim').getAttribute('aria-label'))).toBe('Tim, 1 thing to look at');
    });

    test('no localStorage is no hint, rather than a hint that never goes away', async () => {
      // A phone in private mode, or with site data blocked, cannot remember
      // being taught. Showing the i forever there is worse than never showing
      // it: it becomes permanent furniture on the one device that can do
      // nothing about it.
      const r = await page.evaluate(() => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = () => { throw new Error('denied'); };
        Storage.prototype.setItem = () => { throw new Error('denied'); };
        try {
          timNudges = () => [];
          timDockRender();
          const b = document.getElementById('mtb-tim-dot');
          return { text: b.textContent, on: !b.hidden };
        } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set; }
      });
      expect(r).toEqual({ text: '', on: false });
    });

    // Nothing found and nothing to teach is silence, and silence costs nothing.
    // A badge that is always there is a badge nobody reads.
    test('nothing found and nothing to teach means no badge at all', async () => {
      await page.evaluate(() => {
        try { localStorage.setItem('td_tim_met', '1'); } catch (_e) {}
        timNudges = () => [];
        timDockRender();
      });
      expect(await badge()).toEqual({ text: '', on: false, hint: false });
    });

    test('he opens on a tap whether or not he is carrying a badge', async () => {
      const r = await page.evaluate(() => {
        const out = {};
        timNudges = () => [];
        timDockRender();
        document.getElementById('mtb-tim').click();
        out.quiet = !!document.getElementById('_tim-sheet');
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240',
          title: '$1,240', what: 'Dana still owes you', why: '', cta: 'Do it', alt: 'No' }]);
        timDockRender();
        document.getElementById('mtb-tim').click();
        out.awake = !!document.getElementById('_tim-sheet');
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r).toEqual({ quiet: true, awake: true });
    });
  });


  // ── The part that actually gets him tapped ────────────────────────────────
  //
  // Owner, 2026-09-21, after five rounds on the shape of him: "Does it scream
  // click me though... I want people to use this thing."
  //
  // It did not, and the shape was never going to fix it. What got the old
  // floating dock tapped was the pill beside it speaking the top finding with
  // the figure on the front, and that died in the move to the bar for a layout
  // reason rather than a product one. A badge reading "2" reports that a number
  // exists. "$1,240, Dana still owes on the last one" is a reason to put a
  // thumb on something.
  //
  // THE GATE IS THE DESIGN, and that is what most of this group is about. A
  // bubble that speaks on every render is a nag, and a nag is dismissed forever
  // after about two days, which costs more attention than it ever bought.
  test.describe('he says it out loud, once, and then stops', () => {
    const FIND = (id, line, figure) => page.evaluate(([i, l, f]) => {
      window.__realNudges = window.__realNudges || timNudges;
      timNudges = () => (f === null ? [] : [{ id: i, line: l, figure: f,
        title: f, what: l, why: '', cta: 'Do it', alt: 'No' }]);
      timDockRender();
    }, [id, line, figure]);
    const bubble = () => page.evaluate(() => {
      const s = document.getElementById('mtb-tim-say');
      return { on: !s.hidden, fig: (s.querySelector('b') || {}).textContent || '',
        line: (s.querySelector('i') || {}).textContent || '' };
    });
    const forget = () => page.evaluate(() => {
      document.getElementById('_tim-ov')?.remove();
      try { localStorage.removeItem('td_tim_said'); localStorage.setItem('td_tim_met', '1'); } catch (_e) {}
      const s = document.getElementById('mtb-tim-say');
      if (s) { s.hidden = true; s.innerHTML = ''; }
    });
    test.afterAll(async () => {
      await page.evaluate(() => {
        if (window.__realNudges) timNudges = window.__realNudges;
        try { localStorage.removeItem('td_tim_said'); } catch (_e) {}
        timDockRender();
      });
    });

    test('a finding is spoken with the figure on the front of it', async () => {
      await forget();
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      expect(await bubble()).toEqual({ on: true,
        fig: '$1,240', line: 'Dana still owes on the last one' });
    });

    // The nag gate. timDockRender runs on every navigation, so without this he
    // would say the same sentence on every screen for the rest of the day.
    test('the same thing is not said twice, however many times he is drawn', async () => {
      await forget();
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      const spoke = await bubble();
      await page.evaluate(() => {
        document.getElementById('mtb-tim-say').hidden = true;
        for (let i = 0; i < 8; i++) { goPg('pg-dash'); timDockRender(); }
      });
      expect(spoke.on).toBe(true);
      expect((await bubble()).on, 'he repeated himself').toBe(false);
    });

    // But the SAME customer owing MORE is news. The signature is the finding's
    // id and its figure together for exactly this reason: an id alone would go
    // quiet forever the first time it fired, and a figure alone would speak
    // again every time two unrelated findings happened to cost the same.
    test('but a changed figure is news, and he says it again', async () => {
      await forget();
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      await page.evaluate(() => { document.getElementById('mtb-tim-say').hidden = true; });
      await FIND('still-owes', 'Dana still owes on the last one', '$2,980');
      expect(await bubble()).toEqual({ on: true,
        fig: '$2,980', line: 'Dana still owes on the last one' });
    });

    test('nothing found is nothing said', async () => {
      await forget();
      await FIND('none', '', null);
      expect((await bubble()).on).toBe(false);
    });

    // A figure with no sentence is a number nobody can act on, and a sentence
    // with no figure is not worth interrupting anybody for.
    test('half a finding is not worth interrupting a man for', async () => {
      await forget();
      await FIND('half', 'Something is off', '');
      expect((await bubble()).on, 'no figure').toBe(false);
      await forget();
      await FIND('half', '', '$900');
      expect((await bubble()).on, 'no sentence').toBe(false);
    });

    test('he does not talk over himself while his sheet is open', async () => {
      await forget();
      await page.evaluate(() => { openTim(); });
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      const out = await bubble();
      await page.evaluate(() => document.getElementById('_tim-ov')?.remove());
      expect(out.on, 'a bubble behind his own open sheet is shouting into a conversation').toBe(false);
    });

    test('and answering him retires it on the spot', async () => {
      await forget();
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      const after = await page.evaluate(() => {
        openTim();
        const out = !document.getElementById('mtb-tim-say').hidden;
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(after).toBe(false);
    });

    // A phone in private mode, or with site data blocked, cannot remember being
    // told. SILENCE is the right failure there: the alternative is a bubble on
    // every single render, forever, on the one device that can do nothing about
    // it. So it writes the signature first and speaks only if the write took.
    test('a phone that cannot remember stays quiet rather than repeating forever', async () => {
      const r = await page.evaluate(() => {
        const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
        Storage.prototype.getItem = () => null;
        Storage.prototype.setItem = () => { throw new Error('denied'); };
        try {
          timNudges = () => ([{ id: 'x', line: 'Something worth money', figure: '$500' }]);
          timDockRender();
          return !document.getElementById('mtb-tim-say').hidden;
        } finally { Storage.prototype.setItem = set; Storage.prototype.getItem = get; }
      });
      expect(r).toBe(false);
    });

    // It is a transient overlay, the same category as .toast, and that is the
    // whole of why it is allowed to cover page content at all. The retirement
    // is a CSS animation ending in visibility:hidden, so it leaves hit-testing
    // on its own with no JS timer touching a style property (8.5).
    test('it retires itself, and stops taking taps when it does', async () => {
      await forget();
      await FIND('still-owes', 'Dana still owes on the last one', '$1,240');
      const hits = () => page.evaluate(() => {
        const s = document.getElementById('mtb-tim-say');
        const r = s.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { vis: getComputedStyle(s).visibility, mine: !!(el && el.closest('#mtb-tim')) };
      });
      // While it is up, the words belong to him: a man reaching for a sentence
      // that just told him he is owed $1,240 is reaching for the $1,240, and
      // handing that tap to whatever list is behind it is the worst answer to it.
      expect(await hits()).toEqual({ vis: 'visible', mine: true });
      await page.waitForTimeout(7600);
      expect(await hits()).toEqual({ vis: 'hidden', mine: false });
    });

    test('a long line does not push the page sideways, at 320px or 390px', async () => {
      for (const w of [320, 390]) {
        await page.setViewportSize({ width: w, height: 844 });
        await forget();
        await FIND('long', 'Kansas will not make you print a price on a time and materials contract', '$12,480');
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - window.innerWidth);
        expect(over, 'horizontal bleed at ' + w + 'px').toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    });

    // Everything Tim can name is money or a contract. A crew member gets no
    // Tim, so a crew member gets no figure shouted at him off the bar either.
    test('a crew member is told nothing', async () => {
      await forget();
      const r = await page.evaluate(() => {
        const was = _isEmployee;
        _isEmployee = true;
        try {
          timNudges = () => ([{ id: 'owed', line: 'Dana still owes', figure: '$1,240' }]);
          timDockRender();
          return { said: !document.getElementById('mtb-tim-say').hidden,
            key: !document.getElementById('mtb-tim').hidden };
        } finally { _isEmployee = was; timDockRender(); }
      });
      expect(r).toEqual({ said: false, key: false });
    });
  });


  // ── The scroll belongs to the sheet ───────────────────────────────────────
  // Owner, 2026-09-21, from his phone: "scroll in tim scrolls the page behind
  // Tim rather than Tim."
  // overscroll-behavior:contain was already on the sheet and on the thread and
  // does not cover this: it stops a scroll CHAINING when a scroller reaches its
  // end, and does nothing when the thing under the thumb was never scrollable.
  // Most of the time the sheet is shorter than its 88vh cap and the thread is
  // shorter than its 206px, so there is no scroller under the touch at all and
  // iOS hands the gesture to the document behind.
  test.describe('the page behind him holds still', () => {
    const openOn = (pg) => page.evaluate((p) => {
      document.getElementById('_tim-ov')?.remove();
      timNudges = () => [];
      goPg(p);
      openTim();
    }, pg);

    // The listener has to be NON-PASSIVE or it is not allowed to cancel
    // anything, and a passive one would look identical in every other respect.
    test('the overlay listens for touchmove, and can actually cancel it', async () => {
      const r = await page.evaluate(async () => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        goPg('pg-dash');
        // Record what the sheet registers, at the moment it registers it.
        const seen = [];
        const orig = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (t, f, o) {
          if (t === 'touchmove' && this.id === '_tim-ov') seen.push(o);
          return orig.call(this, t, f, o);
        };
        try { openTim(); } finally { EventTarget.prototype.addEventListener = orig; }
        const out = { n: seen.length, passive: seen.map(o => o && o.passive) };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.n, 'nothing is listening, so nothing can be stopped').toBe(1);
      expect(r.passive[0], 'a passive listener cannot preventDefault').toBe(false);
    });

    // The rule it enforces: a touchmove over something with nowhere to go is
    // not a scroll, so it is cancelled. Dispatched rather than simulated with
    // real touches, because what is being asserted is the DECISION, and a real
    // gesture would also need a scrollable viewport to prove anything.
    test('a drag over nothing scrollable is cancelled, and one over the thread is not', async () => {
      await openOn('pg-dash');
      const r = await page.evaluate(() => {
        const fire = (el) => {
          const e = new Event('touchmove', { bubbles: true, cancelable: true });
          el.dispatchEvent(e);
          return e.defaultPrevented;
        };
        const ov = document.getElementById('_tim-ov');
        const thread = document.getElementById('_tim-thread');
        const out = {};
        // The backdrop above the sheet: there is nothing there to scroll.
        out.backdrop = fire(ov);
        // A thread with nothing in it cannot scroll either, so the page must
        // still not move: "nothing happens" is the correct outcome, not "the
        // page moves instead".
        out.emptyThread = thread ? fire(thread) : null;
        // Now give it more than it can show. 206px of cap against a dozen
        // messages is a real scroller, and a real scroller is left alone.
        for (let i = 0; i < 14; i++) timLogSay('line ' + i, { kind: 'none' });
        document.getElementById('_tim-ov')?.remove();
        openTim();
        const t2 = document.getElementById('_tim-thread');
        out.scrollable = t2 ? (t2.scrollHeight > t2.clientHeight + 1) : false;
        out.fullThread = t2 ? fire(t2) : null;
        timLogClear();
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.backdrop, 'the backdrop let the page scroll').toBe(true);
      expect(r.emptyThread, 'an empty thread let the page scroll').toBe(true);
      expect(r.scrollable, 'the fixture did not make a scroller').toBe(true);
      expect(r.fullThread, 'a real scroller must be left alone').toBe(false);
    });

    // The sheet's own scroll, for the case that does overflow: his knowledge
    // sheet and the log viewer both run long.
    test('a sheet taller than its cap scrolls itself', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        const sheet = _timSheet('_tim-tall',
          Array.from({ length: 60 }, (_, i) => '<div style="padding:18px">row ' + i + '</div>').join(''));
        const fire = (el) => {
          const e = new Event('touchmove', { bubbles: true, cancelable: true });
          el.dispatchEvent(e); return e.defaultPrevented;
        };
        const out = {
          overflows: sheet.scrollHeight > sheet.clientHeight + 1,
          prevented: fire(sheet),
          contain: getComputedStyle(sheet).overscrollBehaviorY,
        };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.overflows).toBe(true);
      expect(r.prevented, 'the sheet has somewhere to go and was stopped anyway').toBe(false);
      // And when it reaches its end it still does not hand the rest to the page.
      expect(r.contain).toBe('contain');
    });

    // Closing him takes the listener with it. It lives on the overlay, so the
    // overlay being removed is the teardown, and there is nothing left behind
    // to swallow the page's own scrolling afterwards.
    test('and closing him gives the page its scroll back', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timNudges = () => [];
        goPg('pg-dash');
        openTim();
        const had = !!document.getElementById('_tim-ov');
        _timClose();
        const e = new Event('touchmove', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(e);
        return { had, ov: !!document.getElementById('_tim-ov'), prevented: e.defaultPrevented };
      });
      expect(r.had).toBe(true);
      expect(r.ov, 'the overlay outlived the close').toBe(false);
      expect(r.prevented, 'something is still cancelling scrolls on the page').toBe(false);
    });
  });


  // ── What he learns from, and what never leaves the phone ──────────────────
  //
  // Owner, 2026-09-21: "I need tim to learn what everybody puts in so I can
  // improve him though, I need to know if he fails at a task."
  //
  // The thread cannot answer either question and should not try: it is one
  // phone's localStorage, it never syncs, and it is wiped on sign-out. So a
  // second, much smaller thing goes up. THE SCRUB IS THE WHOLE DESIGN, and
  // these tests are mostly about it: the thread carries customer names, what
  // they owe and where somebody worked, and none of that teaches Tim anything.
  // The shape of the question is the entire lesson.
  test.describe('what he learns from, and what stays on the phone', () => {
    const SEED = () => {
      clients.length = 0;
      clients.push(
        { id: 1, name: 'Dana Whitfield' },
        { id: 2, name: 'Art Cheng' },
        { id: 3, name: 'Bo' },                      // too short to be a name
        { id: 4, name: 'Dana Whitfield Roofing' },  // longer, shares a prefix
      );
      try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
    };
    test.beforeEach(async () => { await page.evaluate(SEED); });

    test('a customer name never leaves the phone', async () => {
      const r = await page.evaluate(() => [
        'what does Dana Whitfield owe me',
        'what does Dana owe me',
        'what did I charge Art Cheng for gutters',
      ].map(s => _timScrub(s)));
      r.forEach(s => {
        expect(s.toLowerCase(), 'a name got through: ' + s).not.toContain('dana');
        expect(s.toLowerCase(), 'a name got through: ' + s).not.toContain('cheng');
      });
      // And the SHAPE survives, which is the point of scrubbing rather than
      // dropping the sentence: this is the thing worth learning from.
      expect(r[1]).toBe('what does <customer> owe me');
    });

    // Longest first, or "Dana Whitfield Roofing" comes back as
    // "<customer> Roofing" and the company name is still on its way to a
    // server.
    test('the longest name wins, so half a name is never left behind', async () => {
      const r = await page.evaluate(() => _timScrub('invoice Dana Whitfield Roofing'));
      expect(r).toBe('invoice <customer>');
    });

    // A customer called Art must not eat the word "start", and a two-letter
    // customer called Bo must not eat every "bo" in the language.
    test('it matches names, not letters that happen to be inside words', async () => {
      const r = await page.evaluate(() => [
        _timScrub('start the job'),
        _timScrub('book the boiler'),
        _timScrub('Art Cheng'),
      ]);
      expect(r[0], 'it ate part of a word').toBe('start the job');
      expect(r[1], 'a two-letter name should be skipped entirely').toBe('book the boiler');
      expect(r[2]).toBe('<customer>');
    });

    test('and it never throws, whatever is in the address book', async () => {
      const r = await page.evaluate(() => {
        clients.length = 0;
        clients.push(null, {}, { name: '' }, { name: 'A' }, { name: '.*+?[](){}' });
        let threw = false;
        let out = null;
        try { out = _timScrub('what does .*+?[](){} owe me'); } catch (e) { threw = true; }
        return { threw, out };
      });
      expect(r.threw).toBe(false);
      expect(r.out).toContain('<customer>');
    });

    // What goes in the row, and just as importantly what does not. No figure,
    // no answer, no address: the answer is a fact about his books and this is a
    // record of what he ASKED.
    test('the row carries the question and its outcome, never the answer', async () => {
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
        goPg('pg-dash');
        timLearnFrom('what does Dana owe me',
          { kind: 'ask', ask: 'owed', title: '$3,500', sub: 'Dana Whitfield, 68 days' });
        const q = JSON.parse(localStorage.getItem('td_tim_send') || '[]');
        return { n: q.length, row: q[0], keys: Object.keys(q[0] || {}).sort() };
      });
      expect(r.n).toBe(1);
      expect(r.row.said).toBe('what does <customer> owe me');
      expect(r.row.kind).toBe('ask');
      expect(r.row.family).toBe('owed');
      expect(r.row.page).toBe('pg-dash');
      // The figure and the working are not in the row at all, and cannot be
      // added by accident: this is the whole of the shape.
      expect(r.keys).toEqual(['at', 'family', 'kind', 'page', 'said']);
    });

    // The failures are the rows the owner actually asked for. A miss is
    // kind:'none' with no family, which is what makes them findable.
    test('a miss is recorded as a miss, which is the point of the whole thing', async () => {
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
        timLearnFrom('how do I rewire a panel', { kind: 'none' });
        const q = JSON.parse(localStorage.getItem('td_tim_send') || '[]');
        return q[0];
      });
      expect(r.kind).toBe('none');
      expect(r.family).toBe(null);
      expect(r.said).toBe('how do I rewire a panel');
    });

    // Never awaited, never able to stop a sentence. A man talking to Tim must
    // not be slowed by a log about it, let alone blocked by one.
    test('nothing about sending can break saying', async () => {
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('denied'); };
        let threw = false;
        try {
          timLogClear();
          goPg('pg-dash');
          openTim();
          document.getElementById('_tim-say').value = 'who owes me money';
          _timGo();
        } catch (e) { threw = true; }
        finally { Storage.prototype.setItem = set; }
        await new Promise(res => setTimeout(res, 600));
        const out = { threw, answered: !!document.querySelector('.tim-msg.him') };
        document.getElementById('_tim-ov')?.remove();
        return out;
      });
      expect(r.threw, 'a storage failure reached the send path').toBe(false);
      expect(r.answered, 'and it stopped him answering').toBe(true);
    });

    // Offline is not an error, it is later. The row waits rather than being
    // dropped, because the driveway with no bars is where he gets used.
    test('offline keeps the row rather than losing it', async () => {
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
        const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        try {
          timLearnFrom('what am I owed', { kind: 'ask', ask: 'owed' });
          const sent = await timLearnFlush();
          const q = JSON.parse(localStorage.getItem('td_tim_send') || '[]');
          return { sent, queued: q.length };
        } finally {
          if (desc) Object.defineProperty(Navigator.prototype, 'onLine', desc);
          else delete navigator.onLine;
        }
      });
      expect(r.sent).toBe(0);
      expect(r.queued, 'the row was dropped instead of held').toBe(1);
    });

    // Capped, because an uncapped queue on a phone is a slow leak and the
    // two-hundredth unsent sentence is never the one worth reading.
    test('the queue is capped, and keeps the newest', async () => {
      const r = await page.evaluate(() => {
        try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
        for (let i = 0; i < 260; i++) timLearnFrom('line ' + i, { kind: 'none' });
        const q = JSON.parse(localStorage.getItem('td_tim_send') || '[]');
        return { n: q.length, first: q[0].said, last: q[q.length - 1].said };
      });
      expect(r.n).toBe(200);
      expect(r.last).toBe('line 259');
      expect(r.first).not.toBe('line 0');
    });
  });


  // ── Take them off, and they stay off ──────────────────────────────────────
  //
  // Owner, 2026-09-21, on the T&M screen: "Tim's insights with take them off
  // don't even remove it."
  //
  // Four separate faults were stacked under that one sentence, and any one of
  // them alone was enough to produce it:
  //   1. s.dismissed was the LAST line of timJobSnapshot's big try, after a
  //      dozen reads of the estimate screen. Anything above it throwing left
  //      it as [] and silently un-dismissed everything.
  //   2. _timJobKey is '_' until the first autosave hands the bid an id and
  //      'bid:N' after, so a nudge waved off while building a NEW proposal
  //      came back the moment it saved. Same proposal, same man, new key.
  //   3. The book nudges are not about the job at all, so dismissing them
  //      against one meant they reappeared on the next screen.
  //   4. None of it was persisted, so a reload brought all of it back, and a
  //      reload is what happens when he closes the app on a driveway.
  test.describe('a nudge waved off stays waved off', () => {
    const BOOKS = () => {
      const today = todayKey(), ago = n => addDays(today, -n);
      clients.length = 0; clients.push({ id: 7101, name: 'Rick Delaney' });
      bids.length = 0; bids.push({ id: 8801, client_id: 7101, status: 'Closed Won',
        amount: 4000, date: ago(90), completion_date: ago(68) });
      payments.length = 0; payments.push({ bid_id: 8801, amount: 2000 });
      timResetDismissals();
      window._geiBidId = null;
      // The REAL rules, not whichever stub the last describe left behind.
      // Half this file replaces timNudges to control what he finds, and a
      // describe that forgets to put it back makes these tests assert against
      // a fixed list that no dismissal could ever change. It passed alone and
      // failed in the file, which is the signature of exactly that.
      if (window.__realNudges) timNudges = window.__realNudges;
    };
    const ids = () => page.evaluate(() => (timNudges(timJobSnapshot()) || []).map(n => n.id));
    test.beforeEach(async () => { await page.evaluate(BOOKS); await page.evaluate(() => goPg('pg-dash')); });
    test.afterAll(async () => {
      await page.evaluate(() => { window._geiBidId = null; timResetDismissals(); });
    });

    test('and the bid getting an id does not bring it back', async () => {
      expect(await ids()).toContain('books-late');
      await page.evaluate(() => _timDropNudge('books-late'));
      expect(await ids(), 'it came back on the spot').not.toContain('books-late');
      // The autosave hands the proposal an id. Same proposal, new job key.
      await page.evaluate(() => { window._geiBidId = 8801; });
      expect(await ids(), 'the first autosave brought it back').not.toContain('books-late');
      await page.evaluate(() => { window._geiBidId = null; });
      expect(await ids(), 'leaving the proposal brought it back').not.toContain('books-late');
    });

    // The one that makes "I know" honest rather than permanent. A man who
    // knows Rick owes him $2,000 has not asked never to be told that Rick now
    // owes him $4,400.
    test('but the money moving brings it back, because that is news', async () => {
      await page.evaluate(() => _timDropNudge('books-late'));
      expect(await ids()).not.toContain('books-late');
      const back = await page.evaluate(() => {
        // He did more work on the same job and it is still not paid for.
        bids[0].amount = 6400;
        return (timNudges(timJobSnapshot()) || []).map(n => n.id);
      });
      expect(back, 'the figure changed and he said nothing').toContain('books-late');
    });

    // A JOB nudge is a fact about one proposal, so it is right that it comes
    // back on the next one. That distinction is the whole reason there are two
    // buckets, and losing it would make "not on this job" mean "never again".
    test('a job nudge is off for THIS job and back on the next', async () => {
      const r = await page.evaluate(() => {
        timResetDismissals();
        window._geiBidId = 111;
        timDismiss(_timJobKey(), 'under-book');
        const onThis = timDismissedOn(_timJobKey());
        window._geiBidId = 222;
        const onNext = timDismissedOn(_timJobKey());
        window._geiBidId = null;
        return { onThis, onNext };
      });
      expect(r.onThis).toContain('under-book');
      expect(r.onNext, 'it followed him to a different proposal').not.toContain('under-book');
    });

    // Fault 1, pinned on its own: s.dismissed must survive the estimate screen
    // throwing, because that is what it used to be downstream of.
    test('and it survives the estimate screen falling over', async () => {
      const r = await page.evaluate(() => {
        timResetDismissals();
        timDismiss('_', 'books-late', '2000');
        const real = window._tmStateRule;
        window._tmStateRule = () => { throw new Error('estimate screen is not here'); };
        try {
          const s = timJobSnapshot();
          return { dismissed: s.dismissed, ids: (timNudges(s) || []).map(n => n.id) };
        } finally { window._tmStateRule = real; }
      });
      expect(Array.isArray(r.dismissed), 's.dismissed was never assigned').toBe(true);
      expect(r.ids, 'a throw upstream un-dismissed it').not.toContain('books-late');
    });

    // Fault 4. A reload is not a request to be told everything again.
    test('and a reload does not resurrect it', async () => {
      const r = await page.evaluate(() => {
        timResetDismissals();
        _timDropNudge('books-late');
        const stored = localStorage.getItem('td_tim_off');
        // Wipe what is in memory, exactly as a fresh load would have it, and
        // let the file's own loader read it back.
        _timDismissed = {}; _timDismissedBooks = {};
        const before = (timNudges(timJobSnapshot()) || []).map(n => n.id);
        const r2 = JSON.parse(stored || '{}');
        _timDismissed = r2.job || {}; _timDismissedBooks = r2.books || {};
        const after = (timNudges(timJobSnapshot()) || []).map(n => n.id);
        return { stored: !!stored, before, after };
      });
      expect(r.stored, 'nothing was written to disk at all').toBe(true);
      expect(r.before, 'the fixture did not actually clear memory').toContain('books-late');
      expect(r.after, 'it did not come back off disk').not.toContain('books-late');
    });

    // The foot-gun that made the first attempt at this fix worse than the bug:
    // a caller that does not hand over the figure must not silently no-op.
    test('dismissing without naming the figure still dismisses', async () => {
      const r = await page.evaluate(() => {
        timResetDismissals();
        timDismiss(_timJobKey(), 'books-late');   // no third argument
        return (timNudges(timJobSnapshot()) || []).map(n => n.id);
      });
      expect(r, 'the two-argument call silently did nothing').not.toContain('books-late');
    });

    // "I know" twice is a man who knows about his late money, not a man saying
    // the whole idea was bad. timLearn drops a KIND of nudge for good after two
    // noes, and that must not fire for the books.
    test('knowing about your own money does not teach him to stop looking', async () => {
      const r = await page.evaluate(() => {
        timResetDismissals();
        const seen = [];
        const real = window.timLearn;
        window.timLearn = (kind, id, ok) => { seen.push([kind, id, ok]); };
        try {
          timDismiss('_', 'books-late', '2000');
          timDismiss('_', 'under-book');
          return seen;
        } finally { window.timLearn = real; }
      });
      expect(r.map(x => x[1]), 'a book nudge taught him to drop it').not.toContain('books-late');
      expect(r.map(x => x[1]), 'a job nudge should still teach').toContain('under-book');
    });
  });

  test('no console errors, tim.js', async () => {
    assertNoErrors(page, 'tim.js');
  });
});


// ── TALKING IS THE EASY WAY IN ───────────────────────────────────────────────
//
// Owner, 2026-09-22: "I really want people to use Tim to speak it since speak
// is easier then typing."
//
// The mic was permanently secondary, on the reasoning that a filled ink block
// next to a filled blue arrow is two primaries on one row. True of a row with
// text in it. False of an EMPTY one, where the arrow is already dimmed to 32%
// and takes no taps: nothing was primary, and the only thing he could actually
// do from there was the quietest control on the row.
//
// So the two swap, driven off :placeholder-shown like the arrow already is,
// which means no JS touches a style property (8.5) and dictation, paste,
// autofill and undo cannot strand either one in the wrong state.
test.describe('tim: the mic is the way in', () => {
  let page;

  // The mic only draws where a device can actually dictate, which in a browser
  // is nowhere. _voiceCapable is stubbed so the markup exists to measure; that
  // is the only lie told here, and the swap under test is pure CSS.
  const openWithMic = () => page.evaluate(() => {
    window._voiceCapable = () => true;
    document.getElementById('_tim-ov')?.remove();
    openTim();
  });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // The mechanism itself. :placeholder-shown looked right and did not survive
  // WebKit, so this asserts the thing that replaced it rather than the paint
  // alone: one attribute on the row, tracking the box through typed AND
  // programmatic writes, which is what an iPhone actually does all day.
  test('the row states whether the box is empty, through either kind of write', async () => {
    await openWithMic();
    const r = await page.evaluate(() => {
      const row = () => document.getElementById('_tim-row').getAttribute('data-empty');
      const say = document.getElementById('_tim-say');
      const out = { start: row() };
      _timSetSaid(say, 'who owes me money');
      out.afterSet = row();
      _timSetSaid(say, '');
      out.afterClear = row();
      // Typed, the native way: the listener is the same one.
      say.value = 'x';
      say.dispatchEvent(new Event('input', { bubbles: true }));
      out.afterType = row();
      // Whitespace is not something to send.
      _timSetSaid(say, '   ');
      out.afterSpaces = row();
      _timSetSaid(say, '');
      return out;
    });
    expect(r).toEqual({ start: '1', afterSet: '0', afterClear: '1', afterType: '0', afterSpaces: '1' });
  });

  test('the mic carries no inline fill, so the stylesheet can own both states', async () => {
    const r = await page.evaluate(() => {
      window._voiceCapable = () => true;
      const h = _timAskHtml();
      // The BUTTON's own style attribute only. The little "T" badge nested
      // inside it legitimately carries a background of its own, and slicing to
      // the closing tag swallows it.
      const at = h.slice(h.indexOf('id="_tim-mic"'));
      const m = (at.match(/style="([^"]*)"/) || [])[1] || '';
      return { has: h.indexOf('id="_tim-mic"') >= 0, bg: /background:/.test(m), sh: /box-shadow:/.test(m) };
    });
    expect(r.has).toBe(true);
    // An inline style beats the stylesheet, so either of these would freeze the
    // mic in one state and the swap would silently never happen.
    expect(r.bg, 'an inline background would beat the stylesheet and freeze the swap').toBe(false);
    expect(r.sh).toBe(false);
  });

  // The fill is TRANSITIONED, so it has to be read after the transition rather
  // than in the same task that changed the box: computed style in that task is
  // still the start value, and a test that reads it there passes and fails for
  // reasons that have nothing to do with the rule.
  const micState = async (value) => {
    await page.evaluate((v) => {
      const say = document.getElementById('_tim-say');
      // Through the app's own setter, which fires an input event. WebKit does
      // not re-evaluate :placeholder-shown on a bare script write, so a test
      // that set .value directly was driving a path the app does not have and
      // asserting a repaint no iPhone would ever do.
      if (say) _timSetSaid(say, v);
    }, value);
    await page.waitForTimeout(280);
    return page.evaluate(() => {
      const mic = document.getElementById('_tim-mic'), send = document.getElementById('_tim-send');
      const m = getComputedStyle(mic), s = getComputedStyle(send);
      const rgb = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b); };
      // WHY, not just WHAT. This assertion has failed twice on a browser that
      // cannot be installed behind this proxy, and "expected > 110, received
      // 23" says nothing about which link in the chain broke. These four say
      // whether the value landed, whether the attribute followed it, whether
      // the selector matches, and how many of these rows are even in the DOM.
      return { micLum: lum(m.backgroundColor), sendOpacity: parseFloat(s.opacity), sendTaps: s.pointerEvents,
        _diag: {
          said: JSON.stringify((document.getElementById('_tim-say') || {}).value),
          micAttr: mic.getAttribute('data-empty'),
          rowAttr: (document.getElementById('_tim-row') || {}).getAttribute
            ? document.getElementById('_tim-row').getAttribute('data-empty') : 'NOROW',
          matches: mic.matches('#_tim-mic[data-empty="1"]'),
          rows: document.querySelectorAll('#_tim-row').length,
          mics: document.querySelectorAll('#_tim-mic').length,
          bg: m.backgroundColor,
        } };
    });
  };

  test('on an empty box the mic is the filled key and the arrow is inert', async () => {
    await openWithMic();
    const r = await micState('');
    // Filled ink, not a pale chip: the one thing he can do reads as the thing to do.
    expect(r.micLum, 'the mic is not a filled dark key on an empty box. '
      + JSON.stringify(r._diag)).toBeLessThan(110);
    expect(r.sendOpacity).toBeLessThan(0.5);
    expect(r.sendTaps).toBe('none');
  });

  test('the moment there is text, the arrow takes over and the mic steps back', async () => {
    await openWithMic();
    await micState('');
    const r = await micState('who owes me money');
    // Pale again. Never two filled buttons on one 390px row.
    expect(r.micLum, 'the mic stayed filled while the arrow lit up, two primaries. '
      + JSON.stringify(r._diag)).toBeGreaterThan(110);
    expect(r.sendOpacity).toBe(1);
    expect(r.sendTaps).not.toBe('none');
  });

  // ── THE ONE THAT ACTUALLY BIT ─────────────────────────────────────────────
  //
  // Sending clears the box from script. On WebKit, which is iOS, which is the
  // only platform the mic exists on, that left :placeholder-shown stale: the
  // arrow stayed lit and tappable over an empty box (the dead control the
  // design exists to prevent) and the mic stayed pale instead of returning to
  // the key. Every send, every time.
  test('after a send the row is back to an empty box, not a lit arrow over nothing', async () => {
    await openWithMic();
    await micState('who owes me money');
    const r = await page.evaluate(() => {
      _timGo();
      document.getElementById('_tim-ov')?.remove();
      return null;
    }).then(() => page.evaluate(() => {
      window._voiceCapable = () => true;
      openTim();
      const say = document.getElementById('_tim-say');
      return say ? say.value : 'GONE';
    }));
    expect(r, 'the box kept what was sent').toBe('');
    const st = await micState('');
    expect(st.micLum, 'the mic did not come back to the key after sending').toBeLessThan(110);
    expect(st.sendTaps, 'the arrow still took taps over an empty box').toBe('none');
  });

  // "Say your own" next to a text box is ambiguous: say it how? Where there is
  // a mic, the sentence names it, because a control nobody knows about is not
  // the easy way regardless of how easy it is.
  test('the empty sheet tells him he can talk, and only where he can', async () => {
    const withMic = await page.evaluate(() => { window._voiceCapable = () => true; return _timHelloHtml(); });
    expect(withMic).toContain('tap the mic and just talk');

    const without = await page.evaluate(() => { window._voiceCapable = () => false; return _timHelloHtml(); });
    expect(without, 'it offered a mic to a device that has none').not.toContain('mic');
    expect(without).toContain('type your own');
  });
});
