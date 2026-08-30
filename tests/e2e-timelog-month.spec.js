// The month level: pick a month, see its weeks as bars.
//
// Owner, 2026-08-30: "we also need a monthly picker that shows weekly bars and
// fills the page then a way to pick previous months inside of the year we have
// open." It REPLACED the list of twelve collapsed month accordions rather than
// sitting above it, because a list and a picker are two navigations for one
// job and cutting the second one is what he has asked for all session.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { MONTH_ROWS, mountMonth } = require('./week-bars-fixture');

test.describe('month bars: pure helpers', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await page.evaluate(() => { try { S.bizTz = 'America/Chicago'; } catch (_e) {} });
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'month helpers'); });

  test('_tlWeekShortLabel: the week named by the day it starts', async ({ page }) => {
    const r = await page.evaluate(() => [
      _tlWeekShortLabel('2026-08-23'), _tlWeekShortLabel('2026-01-04'),
      _tlWeekShortLabel('2026-12-27'), _tlWeekShortLabel(''),
      _tlWeekShortLabel(null), _tlWeekShortLabel('nonsense'),
    ]);
    // No leading zeros: six of these sit across a 320px phone.
    expect(r.slice(0, 3)).toEqual(['8/23', '1/4', '12/27']);
    expect(r.slice(3)).toEqual(['', '', 'nonsense']);
  });

  test('_tlBarsHtml: nothing to draw is nothing drawn, never an empty frame', async ({ page }) => {
    const r = await page.evaluate(() => ({
      nul: _tlBarsHtml(null, {}),
      empty: _tlBarsHtml([], {}),
      junk: _tlBarsHtml('groups', {}),
      holes: _tlBarsHtml([null, undefined, 'x'], {}),
      // Groups that exist but hold no paid minutes: a chart of seven zeros
      // says nothing and takes a screenful to say it.
      allZero: _tlBarsHtml([{ label: 'A', rows: [] }, { label: 'B', rows: [] }], {}),
    }));
    expect(r.nul).toBe('');
    expect(r.empty).toBe('');
    expect(r.junk).toBe('');
    expect(r.holes).toBe('');
    expect(r.allZero).toBe('');
  });

  test('_tlBarsHtml: the guide is drawn only when it falls inside the chart', async ({ page }) => {
    const r = await page.evaluate(() => {
      const g = (min, guideMin) => _tlBarsHtml(
        [{ label: 'A', rows: [{ date: '2026-08-23', minutes: min, source: 'manual' }] }],
        { guideMin, guideLabel: 'X' });
      return {
        inside: g(600, 480).includes('tl-wbar-guide'),
        // A 40h line over a week that logged two hours would sit far above
        // every bar and squash them all into the floor.
        outside: g(120, 2400).includes('tl-wbar-guide'),
        none: g(600, 0).includes('tl-wbar-guide'),
      };
    });
    expect(r.inside).toBe(true);
    expect(r.outside).toBe(false);
    expect(r.none).toBe(false);
  });

  test('setTimeLogMonth refuses anything that is not a month', async ({ page }) => {
    const r = await page.evaluate(() => {
      const before = _tlDrill.mo;
      ['', null, undefined, '2026', '2026-13-01', 'August', 13, {}].forEach(v => {
        try { setTimeLogMonth(v); } catch (_e) {}
      });
      return { before, after: _tlDrill.mo };
    });
    expect(r.after).toBe(r.before);
  });

  test('_tlMonthShareText: one line per week, written for a text message', async ({ page }) => {
    const t = await page.evaluate((rows) => _tlMonthShareText(rows, '2026-08'), MONTH_ROWS);
    expect(t).not.toMatch(/\t/);
    expect(t).not.toMatch(/ {2,}/);
    expect(t.split('\n').every(l => l.length <= 72)).toBe(true);
    expect(t).toContain('August 2026');
    expect(t).toContain('Wk Aug 23 – 29: 39h 27m (45m unaccounted)');
    // The fixture also carries September. A message headed "August 2026" must
    // total August, so the function filters by the month it is labelling
    // rather than trusting whatever the caller handed it.
    expect(t).toContain('Total: 97h 42m');
    expect(t).not.toContain('September');
    expect(t).toContain('On site');
  });

  test('_tlMonthShareText degrades on junk instead of throwing', async ({ page }) => {
    const r = await page.evaluate(() => ({
      nul: _tlMonthShareText(null, null),
      empty: _tlMonthShareText([], '2026-08'),
    }));
    // _fmtMin(0) is the empty string, which on a page is invisible and in a
    // message is a line reading "Total:" with a blank after it.
    expect(r.nul).toContain('Total: 0m');
    expect(r.empty).toContain('Total: 0m');
  });
});

test.describe('month bars: the page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountMonth(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'month page'); });

  test('the accordion-and-chip navigation is deleted, not orphaned (§7)', async ({ page }) => {
    const r = await page.evaluate(() => ['_tlOpenWeek', '_tlMonthStep', '_tlMonthNavHtml',
      '_tlMonthPickerHtml', '_tlScrollMonthIntoView'].map(n => typeof window[n]));
    expect(r).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  test('a back arrow, the month, a forward arrow', async ({ page }) => {
    // Replaced a twelve-chip row that never fit a phone, scrolled, and so had
    // to scroll ITSELF back into view to be usable (owner 2026-08-30).
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.tl-monav');
      const btns = [...nav.querySelectorAll('.tl-monav-btn')];
      return {
        chips: document.querySelectorAll('.tl-mpicker').length,
        back: !!nav.parentElement.querySelector('.tl-drill-back'),
        label: nav.querySelector('.tl-monav-lbl').textContent,
        total: nav.querySelector('.tl-monav-tot').textContent,
        n: btns.length,
        aria: btns.map(b => b.getAttribute('aria-label')),
        disabled: btns.map(b => b.disabled),
        // The label is the only thing on the row that changes, so a reader
        // following focus on an arrow has to be told what it changed to.
        live: nav.querySelector('[aria-live]').getAttribute('aria-live'),
        // WCAG 2.5.8, with room for a thumb.
        sizes: btns.map(b => Math.round(b.getBoundingClientRect().width)),
      };
    });
    expect(r.chips, 'the chip row is gone, not hidden').toBe(0);
    expect(r.label).toBe('August 2026');
    // The month's total moved here from the accordion header this replaced.
    expect(r.total).toBe('97h 42m');
    expect(r.n).toBe(2);
    expect(r.aria[0]).toContain('Previous');
    expect(r.aria[1]).toContain('Next');
    // Month is the TOP of the drill, so there is nothing to go back up to.
    expect(r.back).toBe(false);
    // August is the earliest month with hours, so back is dead and forward is
    // live. Disabled, never hidden: a control that vanishes makes the row jump.
    expect(r.disabled).toEqual([true, false]);
    expect(r.live).toBe('polite');
    r.sizes.forEach(w => expect(w).toBeGreaterThanOrEqual(24));
  });

  test('the arrows step to the next month that HAS hours, and stop at the ends', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const label = () => document.querySelector('.tl-monav-lbl').textContent;
      const out = { start: label() };
      const step = (d) => _tlDrillStep(d, _tlLastRows);
      step(1); await new Promise(r2 => setTimeout(r2, 60));
      out.fwd = label();
      out.dirFwd = _tlMonthDir;
      // Past the end is a no-op, never a blank chart.
      step(1); await new Promise(r2 => setTimeout(r2, 60));
      out.past = label();
      step(-1); await new Promise(r2 => setTimeout(r2, 60));
      out.back = label();
      out.dirBack = _tlMonthDir;
      step(-1); await new Promise(r2 => setTimeout(r2, 60));
      out.before = label();
      return out;
    });
    expect(r.start).toBe('August 2026');
    expect(r.fwd).toBe('September 2026');
    expect(r.past, 'past the last month is a no-op').toBe('September 2026');
    expect(r.back).toBe('August 2026');
    expect(r.before, 'and before the first is too').toBe('August 2026');
    // The direction is decided by the step, because only the caller knows
    // which way it went; the CSS slide reads it off the element.
    expect(r.dirFwd).toBe('fwd');
    expect(r.dirBack).toBe('back');
  });

  test('the default month is STORED, so the arrows work on a fresh open', async ({ page }) => {
    // It used to be computed for the render and thrown away, which left
    // _tlMonthStep looking up index -1 and both arrows dead until something
    // else happened to set the month. On a fresh open that is never.
    // ONE variable holds the selected month. There were briefly two, and the
    // arrows wrote one while the render read the other, so stepping to
    // September rendered August and the arrows looked broken.
    const r = await page.evaluate(() => ({ drill: _tlDrill.mo, gone: typeof window._tlMonthSel }));
    expect(r.drill).toBe('2026-08');
    expect(r.gone).toBe('undefined');
  });

  test('the chart slides in from the side you came from', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const cls = () => document.querySelector('.tl-drill-body').className;
      _tlDrillStep(1, _tlLastRows); await new Promise(r2 => setTimeout(r2, 60));
      const fwd = cls();
      _tlDrillStep(-1, _tlLastRows); await new Promise(r2 => setTimeout(r2, 60));
      const back = cls();
      // A jump with no direction must not inherit the last tap's animation.
      _tlDrillTo('month', '2026-09'); await new Promise(r2 => setTimeout(r2, 60));
      const jump = cls();
      return { fwd, back, jump };
    });
    expect(r.fwd).toContain('tl-mbars-fwd');
    expect(r.back).toContain('tl-mbars-back');
    expect(r.jump).not.toContain('tl-mbars-fwd');
    expect(r.jump).not.toContain('tl-mbars-back');
  });

  test('one level on screen, one chart, one header', async ({ page }) => {
    // The rule the whole rebuild rests on. The week accordion list under the
    // month chart was the maze: a second way to do the drill the bars already
    // do, repeating every total the chart above it drew.
    const r = await page.evaluate(() => ({
      charts: document.querySelectorAll('.tl-wbar').length,
      heads: document.querySelectorAll('.tl-monav').length,
      weekAccordions: document.querySelectorAll('.bk-week').length,
      monthAccordions: document.querySelectorAll('.bk-month').length,
      // Chip tabs were the fourth idiom on the page.
      chips: document.querySelectorAll('.tl-picker').length,
    }));
    expect(r.charts).toBe(1);
    expect(r.heads).toBe(1);
    expect(r.weekAccordions, 'the accordion list is gone, not hidden').toBe(0);
    expect(r.monthAccordions).toBe(0);
    expect(r.chips).toBe(0);
  });

  test('one bar per week, oldest first, each drilling into its own week', async ({ page }) => {
    const r = await page.evaluate(() => {
      const bars = document.querySelector('.tl-drill-body');
      const cols = [...bars.querySelectorAll('.tl-wbar-col')];
      return {
        n: cols.length,
        labels: cols.map(c => c.querySelector('.tl-wbar-dow').textContent),
        amts: cols.map(c => c.querySelector('.tl-wbar-amt').textContent +
                            c.querySelector('.tl-wbar-sub').textContent),
        opens: cols.map(c => c.querySelector('.tl-wbar-hit').getAttribute('onclick')),
        guide: (bars.querySelector('.tl-wbar-guide') || {}).textContent,
      };
    });
    expect(r.n).toBe(4);
    // A month runs left to right, and the eye is being asked to read a trend.
    expect(r.labels).toEqual(['8/2', '8/9', '8/16', '8/23']);
    expect(r.amts).toEqual(['24h22m', '26h35m', '7h18m', '39h27m']);
    // 40 hours is the line that changes what somebody does next at this zoom,
    // the way 8 hours is at the week's.
    expect(r.guide).toBe('40h');
    // A bar goes DOWN a level now, instead of opening an accordion below.
    r.opens.forEach(o => expect(o).toContain("_tlDrillTo('week'"));
    expect(r.opens[3]).toContain('2026-08-23');
  });

  test('the unanswered hole is flagged at month zoom too', async ({ page }) => {
    const which = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-drill-body .tl-wbar-col')]
        .map(c => !!c.querySelector('.tl-wbar-q')));
    // Only the week of 08/23 carries the 45-minute unaccounted stretch.
    expect(which).toEqual([false, false, false, true]);
  });

  test('tapping a week bar goes DOWN to that week', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const before = { level: _tlDrill.level, charts: document.querySelectorAll('.tl-wbar').length };
      [...document.querySelectorAll('.tl-drill-body .tl-wbar-hit')][2].click();  // week of 08/16
      await new Promise(r2 => setTimeout(r2, 80));
      return {
        before,
        level: _tlDrill.level, wk: _tlDrill.wk,
        // Still ONE chart: the level replaced itself rather than stacking a
        // second one underneath, which is what the accordion list used to do.
        charts: document.querySelectorAll('.tl-wbar').length,
        back: (document.querySelector('.tl-drill-back') || {}).textContent,
        title: document.querySelector('.tl-monav-lbl').textContent,
      };
    });
    expect(r.before.level).toBe('month');
    expect(r.before.charts).toBe(1);
    expect(r.level).toBe('week');
    expect(r.wk).toBe('2026-08-16');
    expect(r.charts, 'one level, one chart').toBe(1);
    expect(r.title).toContain('Aug 16');
    // The back link NAMES where it goes, because "back" alone makes somebody
    // guess and guessing is what this rebuild undoes.
    expect(r.back).toContain('August 2026');
  });

  test('drilling to something that is not there degrades, never throws', async ({ page }) => {
    const r = await page.evaluate(() => {
      try {
        _tlDrillTo('week', '2026-03-01');      // a week in another month
        _tlDrillTo('day', 'nonsense');
        _tlDrillTo('nowhere', 'x');
        _tlDrillTo(null, null);
        _tlDrillUp(); _tlDrillUp(); _tlDrillUp();
        return { ok: true, level: _tlDrill.level };
      } catch (_e) { return { ok: false, err: String(_e && _e.message) }; }
    });
    expect(r.ok).toBe(true);
    // Whatever it was handed, it lands somewhere real rather than on a blank
    // chart: an out-of-month week falls back to the month's own last week.
    expect(['month', 'week', 'day']).toContain(r.level);
  });

  test('the page-level Share button is gone, not hidden behind the other two', async ({ page }) => {
    // Three Send buttons on one screen, meaning three different ranges, was
    // the clutter. Send this month and Send this week stayed; the page-level
    // one, which always meant "this calendar week" regardless of what was on
    // screen, did not.
    const r = await page.evaluate(() => {
      const el = document.getElementById('tl-share');
      return { display: el.style.display, html: el.innerHTML,
               month: !!document.querySelector('.tl-drill-body .tl-wbar-share'),
               fn: typeof _tlShareWeek };
    });
    expect(r.display).toBe('none');
    expect(r.html).toBe('');
    expect(r.month, 'Send this month is on the chart it sends').toBe(true);
    // The function stays: the two contextual buttons were built out of it.
    expect(r.fn).toBe('function');
  });

  test('Team keeps the cards and skips the chart, same split the week makes', async ({ page }) => {
    // Folding a whole crew into one bar per week hides who did what, which is
    // the single thing the per-person cards exist to show.
    const r = await page.evaluate(async () => {
      const orig = _tlScope;
      _tlScope = 'team';
      await renderTimeLog();
      const team = { bars: !!document.querySelector('.tl-wbar'),
                     cards: !!document.querySelector('.tl-emp-row'),
                     nav: !!document.querySelector('.tl-monav') };
      _tlScope = orig;
      await renderTimeLog();
      const me = { bars: !!document.querySelector('.tl-wbar') };
      return { team, me };
    });
    expect(r.team.bars).toBe(false);
    expect(r.team.cards, 'Team still separates people').toBe(true);
    // The nav is navigation, not a chart: both scopes need to reach a month.
    expect(r.team.nav).toBe(true);
    expect(r.me.bars).toBe(true);
  });

  test('no horizontal bleed at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.tl-monav');
      const lbl = nav.querySelector('.tl-monav-lbl');
      const nb = nav.getBoundingClientRect(), lb = lbl.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth,
               inside: lb.left >= nb.left - 1 && lb.right <= nb.right + 1 };
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    // One line, no scrolling: the whole reason this replaced the chip row.
    expect(r.inside).toBe(true);
  });
});
