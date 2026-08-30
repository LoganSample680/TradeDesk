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
      const before = _tlMonthSel;
      ['', null, undefined, '2026', '2026-13-01', 'August', 13, {}].forEach(v => {
        try { setTimeLogMonth(v); } catch (_e) {}
      });
      return { before, after: _tlMonthSel };
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

  test('a back arrow, the month, a forward arrow', async ({ page }) => {
    // Replaced a twelve-chip row that never fit a phone, scrolled, and so had
    // to scroll ITSELF back into view to be usable (owner 2026-08-30).
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.tl-monav');
      const btns = [...nav.querySelectorAll('.tl-monav-btn')];
      return {
        chips: document.querySelectorAll('.tl-mpicker').length,
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
    expect(r.aria[0]).toContain('Previous month');
    expect(r.aria[1]).toContain('Next month');
    expect(r.aria[1]).toContain('September 2026');
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
      _tlMonthStep(1); await new Promise(r2 => setTimeout(r2, 60));
      out.fwd = label();
      out.dirFwd = _tlMonthDir;
      // Past the end is a no-op, never a blank chart.
      _tlMonthStep(1); await new Promise(r2 => setTimeout(r2, 60));
      out.past = label();
      _tlMonthStep(-1); await new Promise(r2 => setTimeout(r2, 60));
      out.back = label();
      out.dirBack = _tlMonthDir;
      _tlMonthStep(-1); await new Promise(r2 => setTimeout(r2, 60));
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
    const r = await page.evaluate(() => _tlMonthSel);
    expect(r).toBe('2026-08');
  });

  test('the chart slides in from the side you came from', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _tlMonthStep(1); await new Promise(r2 => setTimeout(r2, 60));
      const fwd = document.querySelector('.tl-mbars').className;
      _tlMonthStep(-1); await new Promise(r2 => setTimeout(r2, 60));
      const back = document.querySelector('.tl-mbars').className;
      // A jump with no direction must not inherit the last tap's animation.
      setTimeLogMonth('2026-09'); await new Promise(r2 => setTimeout(r2, 60));
      const jump = document.querySelector('.tl-mbars').className;
      return { fwd, back, jump };
    });
    expect(r.fwd).toContain('tl-mbars-fwd');
    expect(r.back).toContain('tl-mbars-back');
    expect(r.jump).not.toContain('tl-mbars-fwd');
    expect(r.jump).not.toContain('tl-mbars-back');
  });

  test('one month at a time, and it prints no header of its own', async ({ page }) => {
    const r = await page.evaluate(() => ({
      months: document.querySelectorAll('.bk-month').length,
      // The nav above already names the month and carries its total, so an
      // accordion header saying both again is the duplication the week body
      // was already caught for.
      hdrs: document.querySelectorAll('.bk-month-hd').length,
      titles: document.querySelectorAll('.bk-month-title').length,
    }));
    expect(r.months).toBe(1);
    expect(r.hdrs).toBe(0);
    expect(r.titles).toBe(0);
  });

  test('one bar per week, oldest first, each drilling into its own week', async ({ page }) => {
    const r = await page.evaluate(() => {
      const bars = document.querySelector('.tl-mbars');
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
    r.opens.forEach(o => expect(o).toContain('_tlOpenWeek('));
    expect(r.opens[3]).toContain('2026-08-23');
  });

  test('the unanswered hole is flagged at month zoom too', async ({ page }) => {
    const which = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-mbars .tl-wbar-col')]
        .map(c => !!c.querySelector('.tl-wbar-q')));
    // Only the week of 08/23 carries the 45-minute unaccounted stretch.
    expect(which).toEqual([false, false, false, true]);
  });

  test('tapping a week bar opens that week below', async ({ page }) => {
    const before = await page.evaluate(() =>
      !!document.querySelector('#bk-tl-wk-2026-08-20260816.open'));
    await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.tl-mbars .tl-wbar-hit')];
      cols[2].click();          // week of 08/16
    });
    await page.waitForTimeout(150);
    const after = await page.evaluate(() =>
      !!document.querySelector('#bk-tl-wk-2026-08-20260816.open'));
    expect(before).toBe(false);
    expect(after, 'the bar is the map, the accordion is the detail').toBe(true);
  });

  test('_tlOpenWeek on a week that is not on screen is a no-op, never a throw', async ({ page }) => {
    const ok = await page.evaluate(() => {
      try { _tlOpenWeek('2026-03', '2026-03-01'); _tlOpenWeek('', ''); _tlOpenWeek(null, null);
            return true; } catch (_e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('the page-level Share button is gone, not hidden behind the other two', async ({ page }) => {
    // Three Send buttons on one screen, meaning three different ranges, was
    // the clutter. Send this month and Send this week stayed; the page-level
    // one, which always meant "this calendar week" regardless of what was on
    // screen, did not.
    const r = await page.evaluate(() => {
      const el = document.getElementById('tl-share');
      return { display: el.style.display, html: el.innerHTML,
               month: !!document.querySelector('.tl-mbars .tl-wbar-share'),
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
      const team = { bars: !!document.querySelector('.tl-mbars'),
                     cards: !!document.querySelector('.tl-emp-row'),
                     nav: !!document.querySelector('.tl-monav') };
      _tlScope = orig;
      await renderTimeLog();
      const me = { bars: !!document.querySelector('.tl-mbars') };
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
