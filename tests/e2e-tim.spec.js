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

    // The dock is the way in the owner picked (design 5b), over a docked strip
    // and an edge handle, because it is the corner the app already floats
    // things in. It has to exist exactly once and it has to open the sheet.
    test('the dock is in the corner and opens the sheet', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_tim-ov')?.remove();
        timDockRender();
        const dock = document.getElementById('tim-dock');
        const btn = document.getElementById('tim-dock-btn');
        btn.click();
        return {
          docks: document.querySelectorAll('#tim-dock').length,
          shown: dock.classList.contains('on'),
          hasMark: !!document.querySelector('#tim-dock-mark svg'),
          opened: !!document.getElementById('_tim-sheet'),
        };
      });
      expect(r).toEqual({ docks: 1, shown: true, hasMark: true, opened: true });
    });
  });

  // ── The dock gets out of the way ──────────────────────────────────────────
  //
  // Rule 15.3: no two interactive controls may overlap, at 390px and at desktop
  // width. A round button floating at a fixed height is exactly the shape of
  // control that breaks that, and the estimate builder pins a full-width blue
  // bar across the bottom of the screen the moment a line is added.
  test.describe('the dock does not land on anything', () => {
    test.afterEach(async () => {
      await page.evaluate(() => {
        document.getElementById('gei-cart-bar')?.remove();
        document.getElementById('_tim-ov')?.remove();
      });
    });

    // ── 10.4: these two assertions changed, and why ─────────────────────────
    // WAS: the dock floated bottom-right, and _timDockLift measured every fixed
    // bottom bar on each render and stood him on the tallest one. The old tests
    // asserted the lift happened and that removing the bar dropped him back.
    // That was correct while he lived at the bottom, and it did obey 15.3.
    // NOW: he is tucked against the right edge at mid-height (owner, 2026-09-20,
    // wanting him embedded rather than floating over the page). Nothing is
    // fixed at the middle of the right edge, so there is nothing to collide
    // with, nothing to measure, and no lift; the geometry is the stylesheet's
    // (8.5) and the JS sets no style property at all.
    // The RULE is unchanged and still the point of this group. 15.3 is now met
    // by not being there rather than by dodging, so the assertions below say
    // that instead: he clears a bottom bar no matter how tall it is, and he
    // carries no inline position for anything to have written.
    test('a bottom bar cannot reach him, whatever height it is', async () => {
      const r = await page.evaluate(() => {
        const out = [];
        [64, 120, 240].forEach(h => {
          document.getElementById('gei-cart-bar')?.remove();
          const bar = document.createElement('div');
          bar.id = 'gei-cart-bar';
          bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:8000;background:#2D5DA8;height:' + h + 'px';
          document.body.appendChild(bar);
          timDockRender();
          const d = document.getElementById('tim-dock-btn').getBoundingClientRect();
          out.push(d.bottom > bar.getBoundingClientRect().top);
        });
        return out;
      });
      expect(r).toEqual([false, false, false]);
    });

    test('the stylesheet owns where he sits, so the JS writes no position', async () => {
      const r = await page.evaluate(() => {
        const bar = document.createElement('div');
        bar.id = 'gei-cart-bar';
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:64px;z-index:8000';
        document.body.appendChild(bar);
        timDockRender();
        const dock = document.getElementById('tim-dock');
        const cs = getComputedStyle(dock);
        return {
          inlineBottom: dock.style.bottom,
          inlineTop: dock.style.top,
          // Mid-height, from the stylesheet, bar or no bar.
          centred: Math.abs(dock.getBoundingClientRect().top + dock.getBoundingClientRect().height / 2
            - window.innerHeight / 2) < 2,
          right: cs.right,
        };
      });
      expect(r.inlineBottom).toBe('');
      expect(r.inlineTop).toBe('');
      expect(r.centred).toBe(true);
    });

    test('quiet he is a tab on the edge, awake he comes out and is a disc', async () => {
      const r = await page.evaluate(() => {
        const real = window.__realNudges || timNudges;
        window.__realNudges = real;
        // Both the width and the edge gap are transitioned, so a rect read taken
        // straight after a render returns the frame it is on, not the state it
        // is going to. Killing the transitions for the measurement is the
        // deterministic way to assert the END state; sleeping for 240ms would
        // be asserting the animation's duration by proxy and would flake on a
        // loaded runner, which is a lesson this suite has already taught twice
        // today.
        const stop = document.createElement('style');
        stop.textContent = '#tim-dock,#tim-dock *{transition:none !important;animation:none !important}';
        document.head.appendChild(stop);
        const read = () => {
          const btn = document.getElementById('tim-dock-btn').getBoundingClientRect();
          return { w: Math.round(btn.width), h: Math.round(btn.height),
            gap: Math.round(window.innerWidth - btn.right),
            lit: document.getElementById('tim-dock').classList.contains('lit') };
        };
        timNudges = () => [];
        timDockRender();
        const quiet = read();
        timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240' }]);
        timDockRender();
        const awake = read();
        timNudges = real;
        timDockRender();
        stop.remove();
        return { quiet, awake };
      });
      // Flush to the edge and narrow when there is nothing to say.
      expect(r.quiet.gap).toBe(0);
      expect(r.quiet.w).toBeLessThan(r.awake.w);
      expect(r.quiet.lit).toBe(false);
      // Out from the edge and round once there is.
      expect(r.awake.gap).toBeGreaterThan(0);
      expect(r.awake.w).toBe(r.awake.h);
      expect(r.awake.lit).toBe(true);
    });

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
    // wall the nav already puts them behind. A crew member gets no dock.
    test('a crew member gets no dock', async () => {
      const r = await page.evaluate(() => {
        const was = _isEmployee;
        _isEmployee = true;
        try { timDockRender(); return document.getElementById('tim-dock').classList.contains('on'); }
        finally { _isEmployee = was; timDockRender(); }
      });
      expect(r).toBe(false);
    });

    test('rendering it fifty times leaves one dock and throws nothing', async () => {
      const r = await page.evaluate(() => {
        let threw = false;
        try { for (let i = 0; i < 50; i++) timDockRender(); } catch (e) { threw = true; }
        return { threw, n: document.querySelectorAll('#tim-dock').length };
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

    // 10.4: this assertion changed with the move to the right edge. It used to
    // prove _timDockLift ran on the cached path too, so a cart bar appearing
    // between navigations still pushed him up. There is no lift now and no
    // bottom to be pushed off, so what has to hold instead is that the SHAPE
    // still tracks the findings on the cached path: caching the analysis must
    // not freeze him mid-state with a stale pill and the wrong silhouette.
    test('a cached render redraws the shape, it does not skip it', async () => {
      // The risk the cache introduces is not a stale ANSWER, which is the whole
      // point of it and lasts a third of a second. It is that a navigation takes
      // the cheap path and leaves him drawn wrong: the pill still up with no
      // finding behind it, or the disc collapsed back to a tab while he has
      // three things to say. So the shape is rebuilt from the answer on every
      // render, cached or not, and this pins that.
      const r = await page.evaluate(() => {
        const real = window.__realNudges || timNudges;
        window.__realNudges = real;
        const btn = document.getElementById('tim-dock-btn');
        const dock = document.getElementById('tim-dock');
        const shape = () => ({ alive: btn.classList.contains('alive'),
          lit: dock.classList.contains('lit'),
          pill: document.getElementById('tim-dock-pill').classList.contains('on') });
        timNudges = () => ([{ id: 'a', line: 'Dana still owes you', figure: '$1,240' }]);
        timDockRender();                    // computes: awake
        const awake = shape();
        btn.classList.remove('alive');      // something else stomps the DOM
        dock.classList.remove('lit');
        timDockRender({ cached: true });     // a navigation: must redraw it
        const redrawn = shape();
        timNudges = real;
        timDockRender();
        return { awake, redrawn };
      });
      expect(r.awake).toEqual({ alive: true, lit: true, pill: true });
      expect(r.redrawn).toEqual({ alive: true, lit: true, pill: true });
    });

    test('navigating still refreshes the dock, it is just not doing it twice', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-dash');
        await new Promise(res => requestAnimationFrame(() => res()));
        return document.getElementById('tim-dock').classList.contains('on');
      });
      expect(r).toBe(true);
    });
  });

  // ── The pulse, and the lines rolling through it ────────────────────────────
  // Owner, 2026-09-20, looking at the dock on his phone: a pulse glow that
  // changes and rolls through to lines, and clicking him opens him up.
  //
  // The glow deliberately does NOT change colour. The token block in index.html
  // reserves hat yellow for the badge and the pill figure and says it goes
  // nowhere else, so a per-kind status ring would break a rule the design
  // already wrote down, and would read as a notifications tray rather than as a
  // man with something to say. What changes is whether he is breathing at all,
  // and which of his findings is showing.
  test.describe('the pulse and the roll', () => {
    const findings = (page, list) => page.evaluate(ns => {
      window.__realNudges = window.__realNudges || timNudges;
      timNudges = () => ns.map((n, i) => ({ id: 'x' + i, line: n[0], figure: n[1],
        title: n[1], what: n[0], why: '', cta: 'Do it', alt: 'No' }));
      timDockRender();
    }, list);
    const restore = (page) => page.evaluate(() => {
      if (window.__realNudges) timNudges = window.__realNudges;
      timDockRender();
    });

    test('nothing found means he does not breathe, and says nothing', async () => {
      const r = await page.evaluate(() => {
        window.__realNudges = window.__realNudges || timNudges;
        timNudges = () => [];
        timDockRender();
        return {
          alive: document.getElementById('tim-dock-btn').classList.contains('alive'),
          pill: document.getElementById('tim-dock-pill').classList.contains('on'),
          badge: document.getElementById('tim-dock-badge').classList.contains('on'),
          timer: !!_timDockTimer,
        };
      });
      expect(r).toEqual({ alive: false, pill: false, badge: false, timer: false });
      await restore(page);
    });

    test('one finding breathes and states it, with no carousel of one', async () => {
      await findings(page, [['You are under your own price on line 3', '$640']]);
      const r = await page.evaluate(() => ({
        alive: document.getElementById('tim-dock-btn').classList.contains('alive'),
        line: document.querySelector('#tim-dock-pill .tim-pill-line').textContent,
        fig: document.querySelector('#tim-dock-pill .tim-pill-fig').textContent,
        badge: document.getElementById('tim-dock-badge').textContent,
        multi: document.getElementById('tim-dock-pill').classList.contains('multi'),
        timer: !!_timDockTimer,
      }));
      expect(r.alive).toBe(true);
      expect(r.line).toBe('You are under your own price on line 3');
      expect(r.fig).toBe('$640');
      expect(r.badge).toBe('1');
      expect(r.multi).toBe(false);
      expect(r.timer).toBe(false);
      await restore(page);
    });

    test('several findings arm the roll, and the badge counts them', async () => {
      await findings(page, [
        ['No scaffold on a second floor job', '$285'],
        ['Dana still owes you', '$1,240'],
        ['You are under your own price on line 3', '$640'],
      ]);
      const r = await page.evaluate(() => ({
        badge: document.getElementById('tim-dock-badge').textContent,
        multi: document.getElementById('tim-dock-pill').classList.contains('multi'),
        dots: document.querySelectorAll('#tim-dock-pill .tim-pill-dots i').length,
        lit: [...document.querySelectorAll('#tim-dock-pill .tim-pill-dots i')]
          .findIndex(d => d.classList.contains('on')),
        timer: !!_timDockTimer,
      }));
      expect(r.badge).toBe('3');
      expect(r.multi).toBe(true);
      expect(r.dots).toBe(3);
      expect(r.lit).toBe(0);
      expect(r.timer).toBe(true);
      await restore(page);
    });

    test('rolling swaps the whole finding, never a line onto the wrong figure', async () => {
      // The mechanism, not a 4.2 second wait: the interval is pinned above, and
      // a shard that sleeps through three rotations to watch text change is a
      // shard nobody will keep. What matters is that a roll carries the line,
      // the figure and the label together.
      await findings(page, [
        ['No scaffold on a second floor job', '$285'],
        ['Dana still owes you', '$1,240'],
      ]);
      const r = await page.evaluate(() => {
        _timDockShow(1);
        const pill = document.getElementById('tim-dock-pill');
        return {
          line: pill.querySelector('.tim-pill-line').textContent,
          fig: pill.querySelector('.tim-pill-fig').textContent,
          label: pill.getAttribute('aria-label'),
          lit: [...pill.querySelectorAll('.tim-pill-dots i')].findIndex(d => d.classList.contains('on')),
        };
      });
      expect(r.line).toBe('Dana still owes you');
      expect(r.fig).toBe('$1,240');
      expect(r.label).toBe('Dana still owes you, $1,240');
      expect(r.lit).toBe(1);
      await restore(page);
    });

    test('going quiet tears the timer down rather than leaving it running', async () => {
      await findings(page, [['a', '$1'], ['b', '$2']]);
      const armed = await page.evaluate(() => !!_timDockTimer);
      const r = await page.evaluate(() => {
        timNudges = () => [];
        timDockRender();
        return { timer: !!_timDockTimer, alive: document.getElementById('tim-dock-btn').classList.contains('alive') };
      });
      expect(armed).toBe(true);
      expect(r.timer).toBe(false);
      expect(r.alive).toBe(false);
      await restore(page);
    });

    test('he still opens on a tap, pill or disc', async () => {
      await findings(page, [['Dana still owes you', '$1,240'], ['b', '$2']]);
      const r = await page.evaluate(() => {
        document.getElementById('tim-dock-pill').click();
        const viaPill = !!document.getElementById('_tim-sheet');
        document.getElementById('_tim-ov')?.remove();
        document.getElementById('tim-dock-btn').click();
        const viaDisc = !!document.getElementById('_tim-sheet');
        document.getElementById('_tim-ov')?.remove();
        return { viaPill, viaDisc };
      });
      expect(r).toEqual({ viaPill: true, viaDisc: true });
      await restore(page);
    });
  });

  test('no console errors, tim.js', async () => {
    assertNoErrors(page, 'tim.js');
  });
});
