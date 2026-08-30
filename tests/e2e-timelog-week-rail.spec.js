// The week rail: seven lanes on ONE shared clock axis.
//
// The premise the whole component rests on is that 8am lands at the same x on
// every lane. If that stops being true the picture is not merely ugly, it is
// lying about the week, so it gets a hard assertion here rather than an eye
// test on a screenshot.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { WEEK_ROWS, WEEK_DAYS, renderWeekRail } = require('./week-rail-fixture');

test.describe('week rail: pure helpers', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await page.evaluate(() => { try { S.bizTz = 'America/Chicago'; } catch (_e) {} });
  });
  // Per test, on that test's own page: assertNoErrors reads page._consoleErrors,
  // so calling it at describe level (with anything but a booted page) is a check
  // that can never fail.
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'week rail helpers'); });

  test('_tlMinOfDay: null, empty, garbage and a real instant', async ({ page }) => {
    const r = await page.evaluate(() => ({
      nul: _tlMinOfDay(null),
      undef: _tlMinOfDay(undefined),
      none: _tlMinOfDay(),
      empty: _tlMinOfDay(''),
      junk: _tlMinOfDay('not a date'),
      num: _tlMinOfDay(0),
      // 12:59:06Z is 07:59 Central on 2026-08-27 (CDT, UTC-5).
      real: _tlMinOfDay('2026-08-27T12:59:06Z'),
      midnight: _tlMinOfDay('2026-08-27T05:00:00Z'),
    }));
    expect(r.nul).toBe(null);
    expect(r.undef).toBe(null);
    expect(r.none).toBe(null);
    expect(r.empty).toBe(null);
    expect(r.junk).toBe(null);
    expect(r.real).toBe(7 * 60 + 59);
    expect(r.midnight).toBe(0);
    // 0 is the epoch and new Date(0) is a valid instant, which is exactly the
    // trap: null coerces to it too. No row in this app ever carries a numeric
    // timestamp, so only a string or a Date is accepted and a null start_time
    // is dropped instead of being drawn at 6pm.
    expect(r.num).toBe(null);
  });

  test('_tlHourLabel: every boundary reads as a clock hour', async ({ page }) => {
    const r = await page.evaluate(() =>
      [0, 60, 660, 720, 780, 1380, 1439, 1440].map(_tlHourLabel));
    expect(r).toEqual(['12a', '1a', '11a', '12p', '1p', '11p', '11p', '12a']);
  });

  test('_tlWeekLaneSegs: null, empty, unsorted, zero-length and no end time', async ({ page }) => {
    const r = await page.evaluate(() => ({
      nul: _tlWeekLaneSegs(null).length,
      undef: _tlWeekLaneSegs(undefined).length,
      str: _tlWeekLaneSegs('nope').length,
      empty: _tlWeekLaneSegs([]).length,
      holes: _tlWeekLaneSegs([null, undefined, {}, { startTime: 'junk' }]).length,
      // Given out of order, must come back in order.
      order: _tlWeekLaneSegs([
        { startTime: '2026-08-27T20:00:00Z', endTime: '2026-08-27T21:00:00Z', minutes: 60 },
        { startTime: '2026-08-27T13:00:00Z', endTime: '2026-08-27T14:00:00Z', minutes: 60 },
      ]).map(s => s.a),
      // No end time: falls back to start + minutes.
      noEnd: _tlWeekLaneSegs([
        { startTime: '2026-08-27T13:00:00Z', minutes: 45 },
      ]).map(s => [s.a, s.b]),
      // Zero-length is not a segment.
      zero: _tlWeekLaneSegs([
        { startTime: '2026-08-27T13:00:00Z', endTime: '2026-08-27T13:00:00Z', minutes: 0 },
      ]).length,
    }));
    expect(r.nul).toBe(0);
    expect(r.undef).toBe(0);
    expect(r.str).toBe(0);
    expect(r.empty).toBe(0);
    expect(r.holes).toBe(0);
    expect(r.order).toEqual([8 * 60, 15 * 60]);
    expect(r.noEnd).toEqual([[8 * 60, 8 * 60 + 45]]);
    // A zero-length segment is dropped, not drawn as a hairline at 0 minutes.
    expect(r.zero).toBe(0);
  });

  test('a row running past business midnight stops at the edge of its own lane', async ({ page }) => {
    // 19:58 Central on 08/27 through 05:19 on 08/28. The row is filed under
    // 08/27, so it may occupy that lane to the right edge and no further:
    // painting it onto 08/28 would put hours on a day the row does not claim.
    const r = await page.evaluate(() => _tlWeekLaneSegs([{
      startTime: '2026-08-28T00:58:12Z', endTime: '2026-08-28T10:19:48Z', minutes: 562,
    }]).map(s => [s.a, s.b]));
    expect(r).toEqual([[19 * 60 + 58, 1440]]);
  });
});

test.describe('week rail: markup', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'week rail markup'); });

  test('empty inputs render nothing at all, never a naked shell', async ({ page }) => {
    const r = await page.evaluate(() => ({
      noRows: _tlWeekRailHtml([], ['2026-08-23'], 'k'),
      noDays: _tlWeekRailHtml([{ date: '2026-08-23', startTime: '2026-08-23T13:00:00Z', minutes: 60 }], [], 'k'),
      nul: _tlWeekRailHtml(null, null, 'k'),
      junk: _tlWeekRailHtml('rows', 'days', 'k'),
    }));
    expect(r.noRows).toBe('');
    expect(r.noDays).toBe('');
    expect(r.nul).toBe('');
    expect(r.junk).toBe('');
  });

  test('seven lanes, one per calendar day, in calendar order', async ({ page }) => {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wrail-day')].map(el => el.textContent));
    expect(labels).toEqual(['Sun 8/23', 'Mon 8/24', 'Tue 8/25', 'Wed 8/26',
                            'Thu 8/27', 'Fri 8/28', 'Sat 8/29']);
  });

  test('a day with nothing on it is marked by attribute, never the global .empty class', async ({ page }) => {
    // index.html owns a global `.empty` (the centred 48px empty-state block).
    // A lane wearing it grew to 126px and shoved the week apart. Regression
    // guard: found by measuring, so it stays measured.
    const r = await page.evaluate(() => {
      const lanes = [...document.querySelectorAll('.tl-wrail-lane')];
      return {
        marked: lanes.map(l => l.hasAttribute('data-empty')),
        usesEmptyClass: lanes.some(l => l.classList.contains('empty')),
        heights: lanes.map(l => Math.round(l.getBoundingClientRect().height)),
      };
    });
    expect(r.marked).toEqual([true, true, false, false, false, false, false]);
    expect(r.usesEmptyClass).toBe(false);
    // Every lane the same height, give or take the 1px separator.
    expect(Math.max(...r.heights) - Math.min(...r.heights)).toBeLessThanOrEqual(2);
  });

  test('one shared axis: every lane track has the same left edge and width', async ({ page }) => {
    // THE contract. If these drift, 8am is at a different x on different days
    // and the picture is lying about the week.
    const r = await page.evaluate(() => {
      const tracks = [...document.querySelectorAll('.tl-wrail-track')]
        .map(t => t.getBoundingClientRect());
      const axis = document.querySelector('.tl-wrail-axis-in').getBoundingClientRect();
      return {
        lefts: tracks.map(b => Math.round(b.left)),
        widths: tracks.map(b => Math.round(b.width)),
        axisLeft: Math.round(axis.left), axisWidth: Math.round(axis.width),
      };
    });
    expect(new Set(r.lefts).size).toBe(1);
    expect(new Set(r.widths).size).toBe(1);
    // The hour labels sit over the same column they are measuring.
    expect(Math.abs(r.axisLeft - r.lefts[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(r.axisWidth - r.widths[0])).toBeLessThanOrEqual(1);
  });

  test('segments stay inside their track and never collapse to nothing', async ({ page }) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wrail-seg')].map(s => ({
        l: parseFloat(s.style.left), w: parseFloat(s.style.width),
      })));
    expect(r.length).toBeGreaterThan(10);
    r.forEach(s => {
      expect(s.l).toBeGreaterThanOrEqual(0);
      expect(s.w).toBeGreaterThanOrEqual(0.7);   // the hairline floor
      expect(s.l + s.w).toBeLessThanOrEqual(100.01);
    });
  });

  test('the unanswered hole is hatched AND carries a question mark, not just a colour', async ({ page }) => {
    // WCAG 1.4.1: "this day still needs an answer" cannot be carried by hue.
    const r = await page.evaluate(() => {
      const lanes = [...document.querySelectorAll('.tl-wrail-lane')];
      return {
        qs: lanes.map(l => !!l.querySelector('.tl-wrail-q')),
        qText: (document.querySelector('.tl-wrail-q') || {}).textContent,
        gapSegs: document.querySelectorAll('.tl-wrail-seg[data-kind="gap"]').length,
      };
    });
    // Only Wed 8/26 has the unaccounted stretch.
    expect(r.qs).toEqual([false, false, false, true, false, false, false]);
    expect(r.qText).toBe('?');
    expect(r.gapSegs).toBe(1);
  });

  test('a lane total excludes unpaid time and reads as text, not colour', async ({ page }) => {
    const amts = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wrail-amt')].map(el => el.textContent.replace('?', '').trim()));
    expect(amts[0]).toBe('—');                 // Sun, nothing logged
    expect(amts[1]).toBe('—');                 // Mon
    expect(amts[4]).toBe('9h 54m');            // Thu 8/27, the owner's real day
    // Wed carries a 45-minute unpaid hole that must not be counted:
    // 21 + 187 + 157 = 365 paid minutes.
    expect(amts[3]).toBe('6h 5m');
  });

  test('each lane is a real button that drills into that day', async ({ page }) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-wrail-hit')].map((b, i) => ({
        tag: b.tagName, type: b.type,
        aria: b.getAttribute('aria-label'),
        drills: (b.getAttribute('onclick') || '').includes("'" + i + "'"),
        h: Math.round(b.getBoundingClientRect().height),
      })));
    r.forEach((b, i) => {
      expect(b.tag).toBe('BUTTON');
      expect(b.type).toBe('button');
      expect(b.drills).toBe(true);
      // WCAG 2.5.8: 24px minimum target.
      expect(b.h).toBeGreaterThanOrEqual(24);
      expect(b.aria).toBeTruthy();
    });
    expect(r[0].aria).toContain('nothing logged');
    expect(r[3].aria).toContain('unaccounted');
  });

  test('the rail is an ordered list of days', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ol = document.querySelector('.tl-wrail');
      return { tag: ol.tagName, kids: [...ol.children].map(c => c.tagName) };
    });
    expect(r.tag).toBe('OL');
    expect(new Set(r.kids)).toEqual(new Set(['LI']));
  });
});

test.describe('week rail: layout integrity (§15.3)', () => {
  for (const w of [320, 390]) {
    test('no horizontal bleed at ' + w + 'px', async ({ page }) => {
      await page.setViewportSize({ width: w, height: 780 });
      await mockAllExternal(page);
      await page.goto('/index.html');
      await waitForAppBoot(page);
      await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
      const r = await page.evaluate(() => {
        const host = document.getElementById('wrail-host');
        const over = [...host.querySelectorAll('.tl-wrail-day,.tl-wrail-amt,.tl-wrail-track')]
          .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).length;
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, over };
      });
      expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
      expect(r.over).toBe(0);
    });
  }
});
