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
const { WEEK_ROWS, WEEK_DAYS, mountWeekBars, settleBars } = require('./week-bars-fixture');

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

  test('_tlBarAmtParts: hours over minutes, nothing abbreviated, junk degrades', async ({ page }) => {
    // Owner 2026-08-30: "don't want hours cutting off." Every earlier attempt
    // shrank the number to fit the column; this one splits it across two lines
    // so no value is ever truncated at any width.
    const r = await page.evaluate(() => [0, 5, 45, 60, 365, 539, 714, 1440,
      null, undefined, 'x', -30].map(_tlBarAmtParts));
    expect(r.slice(0, 8)).toEqual([
      { top: '0m', sub: '' },      // nothing
      { top: '5m', sub: '' },      // under an hour: no hours line to draw
      { top: '45m', sub: '' },
      { top: '1h', sub: '' },      // a clean hour, never "1h" over a lonely 0m
      { top: '6h', sub: '5m' },
      { top: '8h', sub: '59m' },
      { top: '11h', sub: '54m' },  // the one that used to overrun its neighbour
      { top: '24h', sub: '' },
    ]);
    // Math.max(0, NaN) is NaN, so a garbage value once printed "NaNm".
    expect(r.slice(8)).toEqual([{ top: '0m', sub: '' }, { top: '0m', sub: '' },
                                { top: '0m', sub: '' }, { top: '0m', sub: '' }]);
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
    await mountWeekBars(page);
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
    const r = await page.evaluate(() => ({
      top: [...document.querySelectorAll('.tl-wbar-amt')].map(el => el.textContent),
      sub: [...document.querySelectorAll('.tl-wbar-sub')].map(el => el.textContent),
    }));
    // Wed carries a 45-minute unpaid hole that must not count:
    // 21 + 187 + 157 = 365 paid minutes.
    expect(r.top).toEqual(['—', '—', '8h', '6h', '9h', '11h', '2h']);
    expect(r.sub).toEqual(['', '', '59m', '5m', '54m', '54m', '35m']);
    // The empty ones are still IN the DOM: a conditional span made those
    // columns a row shorter and the seven bars stopped sharing a baseline.
    expect(r.sub.length).toBe(7);
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
        // The bar goes DOWN a level now, to that day, instead of switching a
        // chip in a picker that no longer exists.
        drills: (b.getAttribute('onclick') || '').includes("_tlDrillTo('day'"),
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

test.describe('week bars: sharing a week as text', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountWeekBars(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'week bars share'); });

  test('the text is written for an SMS bubble, not a terminal', async ({ page }) => {
    const t = await page.evaluate(([rows, days]) => _tlWeekShareText(rows, days[0]),
      [WEEK_ROWS, WEEK_DAYS]);
    // Tabs and runs of spaces are how a "neatly aligned" export turns into
    // ragged noise the moment it lands in a message.
    expect(t).not.toMatch(/\t/);
    expect(t).not.toMatch(/ {2,}/);
    expect(t.split('\n').every(l => l.length <= 72)).toBe(true);
    // Days with nothing logged are left out, not printed as zeros.
    expect(t).not.toContain('Sun 8/23');
    expect(t).not.toContain('Mon 8/24');
    expect(t).toContain('Thu 8/27: 9h 54m');
    expect(t).toContain('Total: 39h 27m');
    // The split, from the same fold the bars and the card use.
    expect(t).toContain('On site 33h 46m');
    expect(t).toContain('Driving 2h 51m');
  });

  test('an unanswered hole is named on the day it belongs to', async ({ page }) => {
    // A number somebody is about to act on has to say when it is incomplete.
    const t = await page.evaluate(([rows, days]) => _tlWeekShareText(rows, days[0]),
      [WEEK_ROWS, WEEK_DAYS]);
    expect(t).toContain('Wed 8/26: 6h 5m (45m unaccounted)');
    expect((t.match(/unaccounted/g) || []).length).toBe(1);
  });

  test('it sends the week ON SCREEN, not whatever week today falls in', async ({ page }) => {
    // The old share was hardwired to the current calendar week: open the week
    // of the 23rd, tap share, get this week's numbers instead.
    const r = await page.evaluate(async () => {
      const shared = [];
      window.pwaShare = async (a) => { shared.push(a); };
      // A WEEK KEY now. It used to read _tlWeekCache, which the accordion list
      // populated and nothing does since the drill replaced it.
      await _tlShareWeekAt(_tlDrill.wk);
      return { n: shared.length, text: shared[0] && shared[0].text, key: _tlDrill.wk };
    });
    expect(r.n).toBe(1);
    expect(r.text).toContain('Aug 23 – 29');
    expect(r.text).toContain('Total: 39h 27m');
  });

  test('empty and junk input never share a misleading blank', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const shared = [], toasts = [];
      window.pwaShare = async (a) => { shared.push(a); };
      window.showToast = (m) => { toasts.push(m); };
      await _tlShareText([], '2026-08-23', 'x');
      await _tlShareText(null, '2026-08-23', 'x');
      return { shared: shared.length, toasts,
               junk: _tlWeekShareText(null, null), noWk: _tlWeekShareText([], null) };
    });
    expect(r.shared).toBe(0);
    expect(r.toasts.length).toBe(2);
    // Never a share sheet with nothing in it, and never a throw.
    expect(r.junk).toContain('Total: 0m');
    expect(r.noWk).toContain('Total: 0m');
  });

  test('the button rides on the week it sends', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = document.querySelector('.tl-wbar-share');
      return { inWrap: !!b.closest('.tl-wbar-wrap'), tag: b.tagName, type: b.type,
               calls: b.getAttribute('onclick'),
               h: Math.round(b.getBoundingClientRect().height) };
    });
    expect(r.inWrap).toBe(true);
    expect(r.tag).toBe('BUTTON');
    expect(r.type).toBe('button');
    expect(r.calls).toContain('_tlShareWeekAt');
    expect(r.h).toBeGreaterThanOrEqual(24);
  });
});

test.describe('week bars: layout integrity (§15.3)', () => {
  for (const w of [320, 390]) {
    test('no bleed and no label collision at ' + w + 'px', async ({ page }) => {
      await page.setViewportSize({ width: w, height: 780 });
      await settleBars(page);   // labels move as the bars grow
      await mockAllExternal(page);
      await page.goto('/index.html');
      await waitForAppBoot(page);
      await mountWeekBars(page);
      const r = await page.evaluate(() => {
        const amts = [...document.querySelectorAll('.tl-wbar-amt')]
          .map(el => el.getBoundingClientRect());
        const subs = [...document.querySelectorAll('.tl-wbar-sub')]
          .map(el => el.getBoundingClientRect());
        // "11h 54m" used to run straight into the next day's number at 320px.
        // Two labels overlapping is a defect, not a cosmetic nit: it makes both
        // unreadable at exactly the width most phones use.
        let collisions = 0;
        for (let i = 1; i < amts.length; i++) if (amts[i].left < amts[i - 1].right - 0.5) collisions++;
        for (let i = 1; i < subs.length; i++) {
          if (!subs[i].width || !subs[i - 1].width) continue;
          if (subs[i].left < subs[i - 1].right - 0.5) collisions++;
        }
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
