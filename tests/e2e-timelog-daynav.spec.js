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
