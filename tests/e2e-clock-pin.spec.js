// @ts-check
// ── The test clock is pinned, and this is what guards the pin ────────────────
//
// Owner, 2026-08-26: "define how local tests can pass but ci fails, shouldn't
// be that way at all."
//
// He was right, and the bill came due that same night. Three separate tests
// failed in CI and passed locally, and the cause in every case was the same
// undeclared input: the wall clock. CI ran them at 00:05, 00:08 and 00:25
// Central, their fixtures were written as "3 hours ago" or "50 minutes ago",
// and the scenario silently moved to the previous day. Nothing was wrong with
// the code, the browser, or the shard. The hour decided the result, and 142
// more fixtures across 19 files are written the same way.
//
// So mockAllExternal (tests/helpers.js) now pins the page's idea of "now" to a
// fixed Central time of day, and CI runs the suite a second time pinned to
// 00:20 so a midnight bug lands on the PR that introduces it.
//
// The pin is shared infrastructure: every spec in the repo boots through it, so
// a defect here is a defect everywhere, silently. That is exactly the kind of
// thing that has to be tested directly rather than trusted (§10.3).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the pinned test clock', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('both ways of reading the clock agree, and land on the pinned time', async () => {
    // The default is 10:00 Central. If a run overrides TD_CLOCK_AT the two
    // readings must still agree with each other, which is the invariant that
    // actually matters: app code uses both forms interchangeably.
    const { byNow, byCtor } = await page.evaluate(() => {
      const ct = (d) => new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      return { byNow: ct(new Date(Date.now())), byCtor: ct(new Date()) };
    });
    expect(byNow).toBe(byCtor);
    const expected = process.env.TD_CLOCK_AT && process.env.TD_CLOCK_AT !== 'off'
      ? process.env.TD_CLOCK_AT.replace(/^(\d):/, '0$1:')
      : '10:00';
    expect(byNow).toBe(expected);
  });

  test('an explicit argument is passed through untouched', async () => {
    // This is the whole reason a fixed OFFSET was chosen over a frozen or faked
    // clock. A fixture that names an instant has to keep meaning that instant,
    // or every date-literal test in the repo starts lying.
    const out = await page.evaluate(() => ({
      iso: new Date('2026-08-21T17:00:00.000Z').toISOString(),
      ms: new Date(1755792000000).getTime(),
      parts: new Date(2026, 0, 15, 9, 30).getHours(),
      parsed: Date.parse('2026-08-21T17:00:00.000Z'),
      utc: Date.UTC(2026, 7, 21),
    }));
    expect(out.iso).toBe('2026-08-21T17:00:00.000Z');
    expect(out.ms).toBe(1755792000000);
    expect(out.parts).toBe(9);
    expect(out.parsed).toBe(Date.parse('2026-08-21T17:00:00.000Z'));
    expect(out.utc).toBe(Date.UTC(2026, 7, 21));
  });

  test('a pinned Date is still a real Date to everything that checks', async () => {
    // The Supabase shim, the app, and Playwright all hand Date objects around
    // and several places branch on instanceof. A pin that broke that would
    // fail in a hundred unrelated ways with no obvious cause.
    const out = await page.evaluate(() => {
      const d = new Date();
      return {
        isDate: d instanceof Date,
        proto: Object.prototype.toString.call(d),
        hasIso: typeof d.toISOString === 'function',
        roundTrip: new Date(d.toISOString()).getTime() === d.getTime(),
        // Called as a plain function, Date() returns a string, never an object.
        asFunction: typeof Date(),
      };
    });
    expect(out.isDate).toBe(true);
    expect(out.proto).toBe('[object Date]');
    expect(out.hasIso).toBe(true);
    expect(out.roundTrip).toBe(true);
    expect(out.asFunction).toBe('string');
  });

  test('time still FLOWS, it is not frozen', async () => {
    // A frozen clock would have been a much bigger change to reason about:
    // every debounce, poll and timeout in the app would behave differently
    // from production. The pin is a fixed offset, so elapsed time is real.
    const out = await page.evaluate(async () => {
      const a = Date.now();
      await new Promise((r) => setTimeout(r, 120));
      const b = Date.now();
      return { delta: b - a };
    });
    expect(out.delta).toBeGreaterThanOrEqual(90);
    expect(out.delta).toBeLessThan(5000);
  });

  test('the pin moves the time of day, never the Central DATE', async () => {
    // Load-bearing. Shifting the date would break every "is this today"
    // comparison in the app (js/finance.js _crewCostRender, js/timelog.js,
    // todayKey) and trade one class of flake for a worse one.
    const out = await page.evaluate(() => ({
      ct: _bizDateStr(new Date()),
      todayKey: (typeof todayKey === 'function') ? todayKey() : null,
    }));
    const realCt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(out.ct).toBe(realCt);
    if (out.todayKey) expect(out.todayKey).toBe(realCt);
  });

  test('the default pin leaves a wide margin on both sides of midnight', async () => {
    // This asserts the property that makes the DEFAULT pin worth having: at
    // 10:00 Central, every relative offset the suite realistically uses stays
    // on one day, so no fixture can straddle by accident.
    //
    // It is deliberately scoped to the default. The midnight CI job pins to
    // 00:20 exactly SO THAT relative fixtures straddle, because that is how it
    // finds the ones that cannot survive it. Asserting no-straddle there would
    // be asserting that the job cannot do its job.
    test.skip(!!process.env.TD_CLOCK_AT && process.env.TD_CLOCK_AT !== '10:00',
      'only meaningful under the default pin; the midnight job straddles on purpose');
    const out = await page.evaluate(() => {
      const day = (t) => _bizDateStr(new Date(t));
      const now = Date.now();
      const bad = [];
      [5, 30, 50, 62, 120, 180, 300].forEach((mins) => {
        if (day(now - mins * 60000) !== day(now)) bad.push(mins);
      });
      return { bad, ok: day(now) };
    });
    expect(out.bad, 'offsets (minutes) that fell onto a different Central day').toEqual([]);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
