// The week bars: how much, and does anything look wrong.
//
// The first version of this view was a timeline, seven lanes on a shared clock
// axis. The owner's verdict was "that's gotta be the ugliest thing I've ever
// saw," and the research behind the replacement said the same thing with more
// words: nobody draws a week as a timeline, because the question at the truck
// is "how much, and which day looks wrong," not "when exactly." That is why
// these tests are about totals, the 8-hour line and the unanswered-hole badge,
// and not about where a segment sits on a clock.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { WEEK_ROWS, WEEK_DAYS, renderWeekRail } = require('./week-bars-fixture');

test.describe('week bars: pure helpers', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await page.evaluate(() => { try { S.bizTz = 'America/Chicago'; } catch (_e) {} });
  });
  // Per test, on that test's own page: assertNoErrors reads page._consoleErrors,
  // so calling it at describe level (with anything but a booted page) is a check
  // that can never fail.
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'week bars helpers'); });

  test('_tlBarAmt: zero-padded, hour-less under an hour, junk degrades to 0m', async ({ page }) => {
    const r = await page.evaluate(() => [
      _tlBarAmt(0), _tlBarAmt(5), _tlBarAmt(45), _tlBarAmt(60), _tlBarAmt(365),
      _tlBarAmt(539), _tlBarAmt(714), _tlBarAmt(1440),
      _tlBarAmt(null), _tlBarAmt(undefined), _tlBarAmt('x'), _tlBarAmt(-30),
    ]);
    expect(r.slice(0, 8)).toEqual(
      ['0m', '5m', '45m', '1h00', '6h05', '8h59', '11h54', '24h00']);
    // 6h05, never 6h5: at this size a stray single digit reads as a different
    // number entirely.
    expect(r[4]).toBe('6h05');
    expect(r.slice(8)).toEqual(['0m', '0m', '0m', '0m']);
  });

  test('_tlBarCeiling: headroom over the tallest day, never under four hours', async ({ page }) => {
    const r = await page.evaluate(() => ({
      empty: _tlBarCeiling([]),
      nul: _tlBarCeiling(null),
      zeros: _tlBarCeiling([0, 0, 0]),
      // A light week keeps the 4h floor so its shape still reads.
      light: _tlBarCeiling([30, 60, 45]),
      // A real week clears its tallest day, so no bar ever hits the ceiling.
      real: _tlBarCeiling([539, 365, 594, 714, 155]),
    }));
    expect(r.empty).toBe(240);
    expect(r.nul).toBe(240);
    expect(r.zeros).toBe(240);
    expect(r.light).toBe(240);
    expect(r.real).toBeGreaterThan(714);
    expect(r.real).toBeLessThan(714 * 1.3);
  });

  test('the timeline version is gone, not hidden (§7)', async ({ page }) => {
    const r = await page.evaluate(() => [
      '_tlWeekRailHtml', '_tlWeekLaneSegs', '_tlMinOfDay', '_tlHourLabel',
    ].map(n => typeof window[n]));
    expect(r).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  });
});

test.describe('week bars: markup', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'week bars markup'); });

  test('empty inputs render nothing at all, never a naked chart', async ({ page }) => {
    const r = await page.evaluate(() => ({
      noRows: _tlWeekBarsHtml([], ['2026-08-23'], 'k'),
      noDays: _tlWeekBarsHtml([{ date: '2026-08-23', minutes: 60 }], [], 'k'),
      nul: _tlWeekBarsHtml(null, null, 'k'),
      junk: _tlWeekBarsHtml('rows', 'days', 'k'),
    }));
    expect(r.noRows).toBe('');
    expect(r.noDays).toBe('');
    expect(r.nul).toBe('');
    expect(r.junk).toBe('');
  });

  test('seven columns, one per calendar day, in calendar order', async ({ page }) => {
    const r = await page.evaluate(() => ({
      dows: [...document.querySelectorAll('.tl-wbar-dow')].map(el => el.textContent),
      cols: document.querySelectorAll('.tl-wbar-col').length,
    }));
    expect(r.cols).toBe(7);
    expect(r.dows).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });

  test('bar height is the day total against one ceiling, tallest day never clipped', async ({ page }) => {
    const r = await page.evaluate(() => {
      const plots = [...document.querySelectorAll('.tl-wbar-plot')];
      return plots.map(p => {
        const st = p.querySelector('.tl-wbar-stack');
        return { plot: Math.round(p.getBoundingClientRect().height),
                 bar: Math.round(st.getBoundingClientRect().height) };
      });
    });
    // Same ruler for every day.
    expect(new Set(r.map(x => x.plot)).size).toBe(1);
    // Nothing logged Sun and Mon.
    expect(r[0].bar).toBeLessThanOrEqual(3);
    expect(r[1].bar).toBeLessThanOrEqual(3);
    // Fri (11h54) is the tallest and still has headroom under the ceiling.
    const bars = r.map(x => x.bar);
    expect(Math.max(...bars)).toBe(r[5].bar);
    expect(r[5].bar).toBeLessThan(r[5].plot);
    // Thu 9h54 taller than Tue 8h59 taller than Wed 6h05 taller than Sat 2h35.
    expect(r[4].bar).toBeGreaterThan(r[2].bar);
    expect(r[2].bar).toBeGreaterThan(r[3].bar);
    expect(r[3].bar).toBeGreaterThan(r[6].bar);
  });

  test('the 8-hour guide is drawn OVER the bars, where the long days are', async ({ page }) => {
    // Behind them it vanished under every column tall enough to matter, which
    // is exactly the set of days it exists to flag.
    const r = await page.evaluate(() => {
      const g = document.querySelector('.tl-wbar-guide');
      const area = document.querySelector('.tl-wbar-plotarea');
      const stack = document.querySelectorAll('.tl-wbar-stack')[5];   // Fri
      const gb = g.getBoundingClientRect(), sb = stack.getBoundingClientRect();
      return {
        exists: !!g, label: g.textContent,
        areaZ: getComputedStyle(area).zIndex,
        listZ: getComputedStyle(document.querySelector('.tl-wbar')).zIndex,
        // The line crosses Friday's bar: below its top, above its base.
        crossesFri: gb.top > sb.top && gb.top < sb.bottom,
      };
    });
    expect(r.exists).toBe(true);
    expect(r.label).toBe('8h');
    expect(Number(r.areaZ)).toBeGreaterThan(Number(r.listZ));
    expect(r.crossesFri).toBe(true);
  });

  test('the unanswered hole is a question mark on that day, not a colour', async ({ page }) => {
    // WCAG 1.4.1: "this day still needs an answer" cannot be carried by hue.
    const r = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.tl-wbar-col')];
      const q = document.querySelector('.tl-wbar-q');
      const stack = document.querySelectorAll('.tl-wbar-stack')[3];   // Wed
      const qb = q.getBoundingClientRect(), sb = stack.getBoundingClientRect();
      return {
        which: cols.map(c => !!c.querySelector('.tl-wbar-q')),
        text: q.textContent,
        // It rides just above the top of the bar, not at the top of the column.
        aboveBar: qb.bottom <= sb.top + 2 && sb.top - qb.bottom < 24,
      };
    });
    expect(r.which).toEqual([false, false, false, true, false, false, false]);
    expect(r.text).toBe('?');
    expect(r.aboveBar).toBe(true);
  });

  test('the hours under each bar are text, and exclude unpaid time', async ({ page }) => {
    const amts = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wbar-amt')].map(el => el.textContent));
    // Wed carries a 45-minute unpaid hole that must not count:
    // 21 + 187 + 157 = 365 paid minutes.
    expect(amts).toEqual(['—', '—', '8h59', '6h05', '9h54', '11h54', '2h35']);
  });

  test('the stack is bucket-ordered bottom-up, same colours as the split bar', async ({ page }) => {
    const r = await page.evaluate(() => {
      const st = document.querySelectorAll('.tl-wbar-stack')[4];      // Thu 8/27
      const segs = [...st.querySelectorAll('.tl-wbar-seg')];
      return { titles: segs.map(s => s.getAttribute('title')),
               heights: segs.map(s => Math.round(s.getBoundingClientRect().height)) };
    });
    // Rendered top to bottom, so On site is LAST: it is the base of the stack.
    expect(r.titles[r.titles.length - 1]).toContain('On site');
    expect(r.titles.join(' ')).toContain('Driving');
    expect(r.titles.join(' ')).toContain('Shop');
    // A six-minute load on a ten-hour day is still drawn.
    r.heights.forEach(h => expect(h).toBeGreaterThanOrEqual(2));
  });

  test('each column is a real button that drills into that day', async ({ page }) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wbar-hit')].map((b, i) => ({
        tag: b.tagName, type: b.type,
        aria: b.getAttribute('aria-label'),
        drills: (b.getAttribute('onclick') || '').includes("'" + i + "'"),
        w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height),
      })));
    r.forEach(b => {
      expect(b.tag).toBe('BUTTON');
      expect(b.type).toBe('button');
      expect(b.drills).toBe(true);
      // WCAG 2.5.8: 24px minimum target, both axes.
      expect(b.w).toBeGreaterThanOrEqual(24);
      expect(b.h).toBeGreaterThanOrEqual(24);
      expect(b.aria).toBeTruthy();
    });
    expect(r[0].aria).toContain('nothing logged');
    expect(r[3].aria).toContain('unaccounted');
  });

  test('the chart is an ordered list of days', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ol = document.querySelector('.tl-wbar');
      return { tag: ol.tagName, kids: [...ol.children].map(c => c.tagName) };
    });
    expect(r.tag).toBe('OL');
    expect(new Set(r.kids)).toEqual(new Set(['LI']));
  });
});

test.describe('week bars: layout integrity (§15.3)', () => {
  for (const w of [320, 390]) {
    test('no bleed and no label collision at ' + w + 'px', async ({ page }) => {
      await page.setViewportSize({ width: w, height: 780 });
      await mockAllExternal(page);
      await page.goto('/index.html');
      await waitForAppBoot(page);
      await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
      const r = await page.evaluate(() => {
        const amts = [...document.querySelectorAll('.tl-wbar-amt')]
          .map(el => el.getBoundingClientRect());
        // "11h 54m" used to run straight into the next day's number at 320px.
        // Two labels overlapping is a defect, not a cosmetic nit: it makes both
        // unreadable at exactly the width most phones use.
        let collisions = 0;
        for (let i = 1; i < amts.length; i++) if (amts[i].left < amts[i - 1].right - 0.5) collisions++;
        return {
          sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          collisions,
          // Each label also has to stay inside its own column.
          spill: [...document.querySelectorAll('.tl-wbar-col')].filter(c => {
            const a = c.querySelector('.tl-wbar-amt');
            return a && a.getBoundingClientRect().width > c.getBoundingClientRect().width + 0.5;
          }).length,
          lines: [...document.querySelectorAll('.tl-wbar-amt')]
            .map(el => Math.round(el.getBoundingClientRect().height)),
        };
      });
      expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
      expect(r.collisions).toBe(0);
      expect(r.spill).toBe(0);
      // Every label on one line, so the seven columns stay bottom-aligned.
      expect(new Set(r.lines).size).toBe(1);
    });
  }
});
