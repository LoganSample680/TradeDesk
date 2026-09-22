// The day stepper: where the arrows can go, and what a tap costs.
//
// Two owner reports on 2026-08-31, one screen:
//
//   "week day changer only lets you go back to the start of the week but it
//    should be smart enough to continue to go backwards into previous weeks
//    with the arrow buttons"
//   "the animations arent smooth at all, they are really laggy to response and
//    not fast" ... "like almost 2 seconds to change a day, thats awful"
//
// The first was two defects wearing one complaint: the sibling list was
// clipped to the week on screen, so there was nowhere to step, AND the arrow's
// enabled state was read off that same clipped list, so the step could not
// even be asked for. The second was never a CSS problem: every tap went back
// through renderTimeLog, which awaited three Supabase queries and the
// CoreMotion tape before anything moved.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { mountDay, mountWeekBars, settleBars } = require('./week-bars-fixture');

// Every day the fixture logs hours on, in calendar order. Aug 30 2026 is a
// Sunday, so Sep 1 to 3 sit in the week of Aug 30: the fixture crosses a week
// boundary AND a month boundary at the same point, which is exactly the step
// the owner could not make.
const DAYS = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
              '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
              '2026-08-17', '2026-08-18', '2026-08-19',
              '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
              '2026-09-01', '2026-09-02', '2026-09-03'];

// Land on one day, then read what the screen says about it. Every helper here
// goes through the real handlers: nothing is injected.
async function toDay(page, day) {
  await page.evaluate((d) => _tlDrillTo('day', d), day);
  await page.waitForTimeout(120);
}
function readState(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('.tl-monav-btn')];
    return {
      day: _tlDrill.day, wk: _tlDrill.wk, mo: _tlDrill.mo, level: _tlDrill.level,
      title: (document.querySelector('.tl-monav-lbl') || {}).textContent,
      back: (document.querySelector('.tl-drill-back') || {}).textContent,
      disabled: btns.map(b => b.disabled),
      rail: document.querySelectorAll('.tl-rail-row').length,
    };
  });
}
const step = (page, d) => page.evaluate((n) => _tlDrillStep(n, _tlLastRows), d)
  .then(() => page.waitForTimeout(120));

test.describe('the day arrows roll into the neighbouring week', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountDay(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'day nav'); });

  test('back from the first day of a week lands on the last day of the one before', async ({ page }) => {
    // Aug 25 is the first day the owner's week of Aug 23 logged anything on.
    // This is the exact tap in the report: the arrow was drawn disabled and
    // the day stepper simply stopped here.
    await toDay(page, '2026-08-25');
    const at = await readState(page);
    expect(at.day).toBe('2026-08-25');
    expect(at.disabled[0], 'the back arrow must be LIVE on the first day of a week').toBe(false);

    await step(page, -1);
    const r = await readState(page);
    expect(r.day).toBe('2026-08-19');
    // The week the header names has to follow the day over the boundary,
    // otherwise the back link sends you to a week you are no longer in.
    expect(r.wk).toBe('2026-08-16');
    expect(r.title).toBe('Wed, Aug 19');
    expect(r.back).toContain('Aug 16');
    expect(r.level).toBe('day');
    expect(r.rail).toBeGreaterThan(0);
  });

  test('forward from the last day of a week crosses the week AND the month', async ({ page }) => {
    // Aug 29 to Sep 1 is both boundaries at once, which is the case that
    // proves the month is derived from the day rather than left behind: land
    // on September's chart still pointing at August and the render snaps the
    // day back where it came from.
    await toDay(page, '2026-08-29');
    const at = await readState(page);
    expect(at.disabled[1], 'the forward arrow must be LIVE on the last day of a week').toBe(false);

    await step(page, 1);
    const r = await readState(page);
    expect(r.day).toBe('2026-09-01');
    expect(r.wk).toBe('2026-08-30');
    expect(r.mo).toBe('2026-09');
    expect(r.title).toBe('Tue, Sep 1');
    // "Week of Aug 30 – Sep 5", the week that straddles the two months.
    expect(r.back).toContain('Aug 30');
    expect(r.back).toContain('Sep 5');
    expect(r.rail).toBeGreaterThan(0);
  });

  test('the ends still stop: no stepping onto a day with no hours', async ({ page }) => {
    // The bound that was always right and stays: only days that HAVE hours,
    // inside the open year. There is nothing past the last of them, which is
    // also why the arrows can never run forward past today.
    await toDay(page, DAYS[0]);
    const first = await readState(page);
    expect(first.disabled[0]).toBe(true);
    await step(page, -1);
    expect((await readState(page)).day).toBe(DAYS[0]);

    await toDay(page, DAYS[DAYS.length - 1]);
    const last = await readState(page);
    expect(last.disabled[1]).toBe(true);
    await step(page, 1);
    expect((await readState(page)).day).toBe(DAYS[DAYS.length - 1]);
  });

  test('walking the whole year back and forward hits every day, in order, once', async ({ page }) => {
    // The real proof there is no dead end left anywhere: from the last day,
    // press back until it stops. Anything that traps the stepper inside a week
    // shows up as a short walk, and anything that bounces shows up as a
    // repeat.
    const r = await page.evaluate((expected) => {
      _tlDrillTo('day', expected[expected.length - 1]);
      const back = [_tlDrill.day];
      for (let i = 0; i < 60; i++) {
        _tlDrillStep(-1, _tlLastRows);
        if (back[back.length - 1] === _tlDrill.day) break;
        back.push(_tlDrill.day);
      }
      const fwd = [_tlDrill.day];
      for (let i = 0; i < 60; i++) {
        _tlDrillStep(1, _tlLastRows);
        if (fwd[fwd.length - 1] === _tlDrill.day) break;
        fwd.push(_tlDrill.day);
      }
      return { back, fwd };
    }, DAYS);
    expect(r.back).toEqual(DAYS.slice().reverse());
    expect(r.fwd).toEqual(DAYS);
  });

  test('the week arrows roll into the neighbouring month the same way', async ({ page }) => {
    // Same root cause, one level up: the week list was clipped to the month on
    // screen, so the first week of a month was a dead end too.
    const r = await page.evaluate(async () => {
      _tlDrillTo('week', '2026-08-30');          // the week that starts in August
      const start = { wk: _tlDrill.wk, mo: _tlDrill.mo,
                      dis: [...document.querySelectorAll('.tl-monav-btn')].map(b => b.disabled) };
      _tlDrillStep(-1, _tlLastRows);
      const back = { wk: _tlDrill.wk, mo: _tlDrill.mo,
                     title: (document.querySelector('.tl-monav-lbl') || {}).textContent };
      _tlDrillStep(1, _tlLastRows);
      const fwd = { wk: _tlDrill.wk, mo: _tlDrill.mo };
      return { start, back, fwd };
    });
    // Its hours are September's (Sep 1 to 3), so that is the month whose chart
    // holds it, and the back arrow is live because August has weeks before it.
    expect(r.start.mo).toBe('2026-09');
    expect(r.start.dis[0]).toBe(false);
    expect(r.back.wk).toBe('2026-08-23');
    expect(r.back.mo).toBe('2026-08');
    expect(r.back.title).toContain('Aug 23');
    expect(r.fwd.wk).toBe('2026-08-30');
    expect(r.fwd.mo).toBe('2026-09');
  });

  test('_tlWeekMonth and _tlMonthKey: junk in, nothing stranded', async ({ page }) => {
    const r = await page.evaluate(() => ({
      // A straddling week is answered by the rows, not by its own start date.
      straddle: _tlWeekMonth('2026-08-30'),
      plain: _tlWeekMonth('2026-08-23'),
      // A week nobody logged anything in falls back to its start date rather
      // than to nothing at all.
      empty: _tlWeekMonth('2026-01-04'),
      junk: [null, undefined, '', 'nonsense', 0, 13].map(v => _tlWeekMonth(v)),
      mo: [_tlMonthKey('2026-08-31'), _tlMonthKey(''), _tlMonthKey(null),
           _tlMonthKey(undefined), _tlMonthKey('nonsense'), _tlMonthKey('2026-13-40')],
    }));
    expect(r.straddle).toBe('2026-09');
    expect(r.plain).toBe('2026-08');
    expect(r.empty).toBe('2026-01');
    r.junk.forEach(v => expect(v).toBe(''));
    expect(r.mo).toEqual(['2026-08', '', '', '', '', '']);
  });

  test('a junk key never parks the drill on a month that does not exist', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _tlDrillTo('day', '2026-08-27');
      const good = { mo: _tlDrill.mo, wk: _tlDrill.wk };
      [null, undefined, '', 'nonsense', 42, {}].forEach(v => {
        try { _tlDrillTo('day', v); } catch (_e) {}
      });
      await new Promise(r2 => setTimeout(r2, 120));
      return { good, mo: _tlDrill.mo, wk: _tlDrill.wk,
               painted: (document.getElementById('tl-list') || {}).innerHTML.trim().length };
    });
    // The month and week fall back to what was already on screen, so the page
    // still has something truthful on it.
    expect(r.good).toEqual({ mo: '2026-08', wk: '2026-08-23' });
    expect(r.mo).toBe('2026-08');
    expect(r.wk).toBe('2026-08-23');
    expect(r.painted).toBeGreaterThan(0);
  });
});

// ── What a tap costs ───────────────────────────────────────────────────────
// Owner: "like almost 2 seconds to change a day, thats awful." The number in
// these assertions is the whole fix, so it is measured, not described.
test.describe('a day change costs no network and no frame', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountDay(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'day nav cost'); });

  test('the new day is on screen in the same task as the tap, with zero fetches', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // Stand in for the real cost: _timeLogRows is three Supabase round trips
      // (_fetchCrewLabor) plus the CoreMotion tape. 300ms is a kind estimate of
      // what the owner was waiting on.
      const base = window._timeLogRows;
      let calls = 0;
      window._timeLogRows = async () => {
        calls++;
        await new Promise(r2 => setTimeout(r2, 300));
        return base();
      };
      _tlRowsAt = Date.now();                     // rows just loaded, nothing to revalidate
      const lbl = () => (document.querySelector('.tl-monav-lbl') || {}).textContent;

      // BEFORE: what every drill tap used to do, a full re-render.
      const b0 = performance.now();
      await renderTimeLog();
      const uncachedMs = performance.now() - b0;
      const uncachedCalls = calls;

      // AFTER: the same visible change, from the rows already in memory.
      _tlDrillTo('day', '2026-08-27');
      calls = 0;
      const was = lbl();
      const t0 = performance.now();
      _tlDrillStep(-1, _tlLastRows);
      // Read the DOM with no await at all: if the paint needed a turn of the
      // event loop this is still the old day.
      const sync = lbl();
      const cachedMs = performance.now() - t0;
      await new Promise(r2 => setTimeout(r2, 400));
      return { uncachedMs, uncachedCalls, cachedMs, was, sync, after: lbl(), calls };
    });
    // The measurement, both directions.
    expect(r.uncachedCalls).toBeGreaterThanOrEqual(1);
    expect(r.uncachedMs, 'a full re-render pays for the fetch').toBeGreaterThan(250);
    expect(r.sync, 'the day must change in the same task as the tap').not.toBe(r.was);
    expect(r.sync).toBe('Wed, Aug 26');
    expect(r.after).toBe('Wed, Aug 26');
    expect(r.cachedMs, 'a drill tap must not wait on anything').toBeLessThan(150);
    expect(r.calls, 'a drill tap must not hit the network at all').toBe(0);
  });

  test('the rows are checked again after the paint, and only repaint on a real change', async ({ page }) => {
    // Painting from memory is only safe because the server is still asked,
    // after the screen is already right. Unchanged rows must NOT repaint: a
    // repaint closes whatever the viewer just opened.
    const same = await page.evaluate(async () => {
      const base = window._timeLogRows;
      let calls = 0;
      window._timeLogRows = async () => { calls++; return base(); };
      _tlRowsAt = 0;                              // stale: the revalidate is due
      _tlDrillStep(-1, _tlLastRows);
      const sync = (document.querySelector('.tl-monav-lbl') || {}).textContent;
      await new Promise(r2 => setTimeout(r2, 300));
      return { calls, sync, after: (document.querySelector('.tl-monav-lbl') || {}).textContent };
    });
    expect(same.calls, 'the check happens, once').toBe(1);
    expect(same.after, 'and it did not move the screen').toBe(same.sync);

    const changed = await page.evaluate(async () => {
      const base = window._timeLogRows;
      window._timeLogRows = async () => {
        const rows = await base();
        return rows.concat([{ id: 'late', date: '2026-08-27', minutes: 60, source: 'manual',
          rawSource: 'manual', clientName: 'Landed while you looked', detail: '', addr: '',
          startTime: '2026-08-27T23:00:00Z', endTime: '2026-08-28T00:00:00Z',
          personName: 'Logan Sample', personUid: null, unpaid: false }]);
      };
      _tlRowsAt = 0;
      // The day's total, which the drill header prints (the rail head's own
      // copy is suppressed inside the drill, one number per screen).
      const tot = () => (document.querySelector('.tl-monav-tot') || {}).textContent;
      _tlDrillTo('day', '2026-08-27');
      const before = tot();
      await new Promise(r2 => setTimeout(r2, 400));
      return { before, after: tot() };
    });
    // A row that landed while the viewer was looking DOES earn the repaint.
    expect(changed.after).not.toBe(changed.before);
  });
});

// ── The touch itself ───────────────────────────────────────────────────────
test.describe('the arrow answers the touch on the same frame', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountWeekBars(page);
    await settleBars(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'arrow press'); });

  test('the press is instant, the release still eases (§8.4)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const css = Array.from(document.styleSheets).flatMap(s => {
        try { return Array.from(s.cssRules); } catch (e) { return []; }
      }).filter(rule => rule.selectorText && /\.tl-monav-btn/.test(rule.selectorText));
      const find = (sel) => (css.find(rule => rule.selectorText.indexOf(sel) === 0) || {}).style;
      const base = find('.tl-monav-btn{') || find('.tl-monav-btn');
      const active = css.find(rule => /:active/.test(rule.selectorText)).style;
      const btn = document.querySelector('.tl-monav-btn');
      return {
        transition: base.transition || base.getPropertyValue('transition'),
        activeTransform: active.transform,
        activeDur: active.getPropertyValue('transition-duration'),
        computed: getComputedStyle(btn).transitionProperty,
        easing: getComputedStyle(btn).transitionTimingFunction,
      };
    });
    // Unchanged: the exact properties, the durations and the entrance easing
    // are all still what §8.4 asks for, and none of it is `transition:all`.
    // (serialization drops `ease`, it being the default, so the easing is
    // asserted off the computed timing-function list instead)
    expect(r.transition).toContain('background 0.14s');
    expect(r.transition).toContain('border-color 0.14s');
    expect(r.transition).toContain('transform 0.14s cubic-bezier(0.22, 1, 0.36, 1)');
    expect(r.transition).not.toContain('all');
    expect(r.computed).toBe('background, border-color, transform');
    expect(r.easing).toBe('ease, ease, cubic-bezier(0.22, 1, 0.36, 1)');
    // Changed: the pressed state lands immediately, so the thumb is answered
    // on the frame it touched rather than 140ms later.
    expect(r.activeTransform).toBe('scale(0.92)');
    expect(r.activeDur).toBe('0s');
  });

  test('the chart still slides, still on transform and opacity only', async ({ page }) => {
    // §8.5: never a layout property, never `all`, never a fake setTimeout
    // transition. The slide is what makes a day change read as a MOVE, and it
    // is only 200ms, so the two seconds were never this.
    const r = await page.evaluate(async () => {
      const frames = {};
      Array.from(document.styleSheets).flatMap(s => {
        try { return Array.from(s.cssRules); } catch (e) { return []; }
      }).forEach(rule => {
        if (rule.type === CSSRule.KEYFRAMES_RULE) frames[rule.name] = rule.cssText;
      });
      _tlDrillTo('day', '2026-08-27');
      await new Promise(r2 => setTimeout(r2, 60));
      _tlDrillStep(-1, _tlLastRows);
      const body = document.querySelector('.tl-drill-body');
      const cs = getComputedStyle(body);
      return { cls: body.className, name: cs.animationName, dur: cs.animationDuration,
               ease: cs.animationTimingFunction,
               fwd: frames['td-mo-fwd'], back: frames['td-mo-back'] };
    });
    expect(r.cls).toContain('tl-mbars-back');
    expect(r.name).toBe('td-mo-back');
    expect(parseFloat(r.dur)).toBeLessThanOrEqual(0.22);
    expect(parseFloat(r.dur)).toBeGreaterThanOrEqual(0.15);
    expect(r.ease).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    [r.fwd, r.back].forEach(kf => {
      expect(kf).toMatch(/transform/);
      expect(kf).toMatch(/opacity/);
      expect(kf).not.toMatch(/(^|[^-])(width|height|top|left|margin)\s*:/);
    });
  });
});

// ── ANSWERING A GAP IS A LOCAL WRITE, SO IT PAINTS LOCALLY ─────────────────
// Owner 2026-09-18: "clicking unaccounted for things in time sheets, clicking
// the button makes the day rail laggy."
//
// Same defect as the drill tap above and NOT the same fix. A drill tap changes
// which slice is on screen, so _tlRowsCache (the assembled rows) answers it
// outright. Answering a gap CHANGES the rows: it pushes a manual entry, so the
// assembled cache is stale by definition and painting from it would redraw the
// day without the row the tap just made. Everything _timeLogRows builds is in
// memory except _fetchCrewLabor, three Supabase queries with no cache of its
// own, so that one call is what the tap was waiting on. It is cached a layer
// down instead: rebuild the local half fresh, reuse the crew payload already
// in hand, and revalidate against the server after the paint.
test.describe('the crew payload is cached so a local write paints at once', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => {};
      window._supaUser = window._supaUser || { id: 'owner-gap', email: 'o@t.com' };
      S.bizTz = 'America/Chicago';
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Count the crew fetches a call makes, and make each one slow enough that an
  // await of it could not possibly be mistaken for a same-task paint.
  const withCounter = (fn) => page.evaluate(async (src) => {
    const keep = window._fetchCrewLabor;
    let hits = 0;
    window._fetchCrewLabor = async () => {
      hits++;
      await new Promise(r => setTimeout(r, 120));
      return { name: {}, entries: [], shopEntries: [] };
    };
    try { const out = await (new Function('return (' + src + ')'))()(); return { hits, out }; }
    finally { window._fetchCrewLabor = keep; }
  }, fn.toString());

  test('a plain call fetches the crew, every time', async () => {
    const r = await withCounter(async () => {
      await _timeLogRows(null);
      await _timeLogRows(null);
      return null;
    });
    expect(r.hits).toBe(2);
  });

  test('crewCached reuses the payload the last plain call left behind', async () => {
    const r = await withCounter(async () => {
      await _timeLogRows(null);            // fills the cache
      await _timeLogRows(null, { crewCached: true });
      await _timeLogRows(null, { crewCached: true });
      return null;
    });
    expect(r.hits).toBe(1);
  });

  test('a crewCached call with nothing cached still goes and gets it: never an empty rail', async () => {
    const r = await page.evaluate(async () => {
      const keep = window._fetchCrewLabor;
      let hits = 0;
      window._fetchCrewLabor = async () => { hits++; return { name: {}, entries: [], shopEntries: [] }; };
      try {
        // The option is only honoured when a payload for the SAME window is in
        // hand, and a different window is the same as none.
        await _timeLogRows('2026-09-01T00:00:00.000Z');
        await _timeLogRows(null, { crewCached: true });
        return hits;
      } finally { window._fetchCrewLabor = keep; }
    });
    expect(r).toBe(2);
  });

  test('the cached payload is the real one: crew rows still come through', async () => {
    const r = await page.evaluate(async () => {
      const keep = window._fetchCrewLabor;
      const me = _supaUser.id;
      window._fetchCrewLabor = async () => ({ name: { [me]: 'Me' }, shopEntries: [],
        entries: [{ id: 'c1', source: 'client', job_id: null, client_key: 'd-c1', dest_place: 'John Doe',
          arrived_at: '2026-09-01T14:00:00.000Z', departed_at: '2026-09-01T15:00:00.000Z', minutes: 60,
          employee_user_id: me, contractor_user_id: me }] });
      try {
        await _timeLogRows(null);
        window._fetchCrewLabor = async () => { throw new Error('must not be called'); };
        const rows = await _timeLogRows(null, { crewCached: true });
        return rows.filter(x => x.rawId === 'c1' || String(x.id).indexOf('c1') >= 0).length;
      } finally { window._fetchCrewLabor = keep; }
    });
    expect(r).toBe(1);
  });

  test('answering a gap shows the new row without waiting on the network', async () => {
    const r = await page.evaluate(async () => {
      const keepF = window._fetchCrewLabor, keepT = timeEntries.slice();
      let hits = 0, slow = false;
      // 2500, not 400. See the budget at the bottom for why the stub delay and
      // the budget have to be far apart.
      window._fetchCrewLabor = async () => {
        hits++;
        if (slow) await new Promise(x => setTimeout(x, 2500));
        return { name: {}, entries: [], shopEntries: [] };
      };
      try {
        await _timeLogRows(null);          // warm the crew cache
        slow = true;
        const before = timeEntries.length;
        const a = '2026-09-01T14:00:00.000Z', b = '2026-09-01T15:00:00.000Z';
        const t0 = Date.now();
        _tlAddUnaccounted(a, b, 'work');
        // One macrotask. If the paint were still behind _fetchCrewLabor the
        // stub could not have resolved and the row would not be there.
        await new Promise(x => setTimeout(x, 0));
        const rows = await _timeLogRows(null, { crewCached: true });
        return { added: timeEntries.length - before, ms: Date.now() - t0,
          landed: rows.some(x => x.startTime === a && x.endTime === b) };
      } finally { window._fetchCrewLabor = keepF; window.timeEntries = keepT; }
    });
    expect(r.added).toBe(1);
    expect(r.landed).toBe(true);
    // BUDGET WIDENED 2026-09-22 (§10.4), and the stub slowed to match. It used
    // to stub 400ms and assert under 400ms, which left no gap at all: the two
    // numbers being equal meant a loaded runner could blow the budget WITHOUT
    // the code ever having awaited the fetch, which is what happened on webkit
    // in CI (509ms, with `added` and `landed` both correct). The assertion was
    // measuring the machine, not the behaviour.
    //
    // What this test actually means is "the row painted instead of waiting on
    // the network", so the stub is now 2500ms and the budget 1200ms. Correct
    // behaviour finishes in single-digit milliseconds and has a second of slack
    // to be slow in; a regression that goes back to awaiting the fetch cannot
    // come in under 2500 and still fails, harder than before.
    expect(r.ms).toBeLessThan(1200);
  });

  // The revalidate is fired but never awaited, and an async function runs to
  // its first await synchronously, so its fetch is already counted by the time
  // renderTimeLog resolves. Counting calls therefore cannot separate the two.
  // What CAN: make the fetch slow and time the render. A render that finished
  // in a fraction of the stub's delay did not wait for it.
  test('the paint does not wait for the crew fetch, and the check still happens', async () => {
    const r = await page.evaluate(async () => {
      const keepF = window._fetchCrewLabor, keepT = timeEntries.slice();
      let hits = 0, slow = false;
      window._fetchCrewLabor = async () => {
        hits++;
        if (slow) await new Promise(x => setTimeout(x, 500));
        return { name: {}, entries: [], shopEntries: [] };
      };
      try {
        // One revalidate at a time is the point of the guard, so a check still
        // running from the test before this one would make this one a no-op and
        // the assertion would be measuring the guard, not the revalidate.
        for (let i = 0; i < 60 && _tlRevalidating; i++) await new Promise(x => setTimeout(x, 50));
        await renderTimeLog();                 // warms the crew cache, fast stub
        const base = hits;
        slow = true;
        const t0 = Date.now();
        await renderTimeLog({ crewCached: true });
        const ms = Date.now() - t0;
        await new Promise(x => setTimeout(x, 700));
        return { ms, after: hits - base };
      } finally { window._fetchCrewLabor = keepF; window.timeEntries = keepT; }
    });
    expect(r.ms).toBeLessThan(500);            // the screen was not behind the fetch
    expect(r.after).toBeGreaterThanOrEqual(1); // and the server was still checked
  });

  test('the same render WITHOUT the option is exactly what was slow before', async () => {
    const r = await page.evaluate(async () => {
      const keepF = window._fetchCrewLabor, keepT = timeEntries.slice();
      window._fetchCrewLabor = async () => {
        await new Promise(x => setTimeout(x, 500));
        return { name: {}, entries: [], shopEntries: [] };
      };
      try {
        const t0 = Date.now();
        await renderTimeLog();
        return Date.now() - t0;
      } finally { window._fetchCrewLabor = keepF; window.timeEntries = keepT; }
    });
    expect(r).toBeGreaterThanOrEqual(500);
  });

  test('a crew fetch that throws is still a rendered screen, not a dead one', async () => {
    const r = await page.evaluate(async () => {
      const keep = window._fetchCrewLabor;
      window._fetchCrewLabor = async () => { throw new Error('offline'); };
      try {
        await renderTimeLog({ crewCached: true });
        const el = document.getElementById('tl-list');
        return { html: !!(el && el.innerHTML.length) };
      } catch (e) { return { html: false, threw: String(e) }; }
      finally { window._fetchCrewLabor = keep; }
    });
    expect(r.html).toBe(true);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
