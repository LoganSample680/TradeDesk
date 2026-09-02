// @ts-check
// ── The manual clock mingles with the derived day ───────────────────────────
//
// Owner 2026-09-02: "then we wrap up time log where our manual time blends
// with automatic stops that day, need manual to mingle with automatic time
// logs cleanly."
//
// The rule (owner 2026-09-01, kept): the clock is the outer bracket and the
// automatic rows are the detail. Every automatic row inside the clock keeps
// its own minutes; the clock keeps only what nothing explains, and that
// remainder reads as Manual time. Nothing is counted twice, the day totals
// the clock when the clock brackets everything, and an untracked stretch
// (a client the app has no fence for) is exactly the remainder.
//
// With the deriver in front of it the blend's input is a clean partition:
// no overlaps, no duplicates, no round trips to withdraw first. So this is
// the whole reader now: derived rows, the blend, and the holes.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const DAY = '2026-09-01';
const DAY_START = Date.parse('2026-09-01T05:00:00Z');
const T = (h, m) => new Date(DAY_START + h * 3600000 + m * 60000).toISOString();

// Rows in the shape geo_replace_day stores and _fetchCrewLabor returns.
const row = (id, source, st, en, extra) => Object.assign({ id, source, job_id: null, client_key: 'd-' + id,
  arrived_at: st, departed_at: en, minutes: Math.round((Date.parse(en) - Date.parse(st)) / 60000), dest_place: null }, extra || {});

test.describe('manual clock over a derived day', () => {
  let page, ME;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    ME = await page.evaluate(() => {
      window.supaLoadFromCloud = async () => {};
      window._supaUser = window._supaUser || { id: 'owner-blend', email: 'o@t.com' };
      S.bizTz = 'America/Chicago'; S.bname = 'JS Solutions';
      return _supaUser.id;
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Feed the reader exactly what the tables hold, and read back what it draws.
  const render = (entries, shop, clocks) => page.evaluate(async ([entries, shop, clocks, DAY]) => {
    const me = _supaUser.id;
    const keepT = timeEntries.slice(); const keepF = window._fetchCrewLabor;
    window.timeEntries = clocks.map((c, i) => ({ id: 900 + i, job_id: null, date: DAY, start_time: c[0], end_time: c[1],
      minutes: Math.round((Date.parse(c[1]) - Date.parse(c[0])) / 60000), logged_by_uid: null, logged_by_name: 'Me', open: false }));
    window._fetchCrewLabor = async () => ({ name: { [me]: 'Me' },
      entries: entries.map(e => ({ ...e, employee_user_id: me, contractor_user_id: me })),
      shopEntries: shop.map(e => ({ ...e, employee_user_id: me, contractor_user_id: me })) });
    try {
      const rows = (await _timeLogRows(null)).filter(r => r.date === DAY)
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
      const hm = t => t ? new Date(t).toISOString().slice(11, 16) : '';
      return rows.map(r => ({ t: hm(r.startTime) + '-' + hm(r.endTime), src: r.source, raw: r.rawSource || '',
        min: r.minutes, unpaid: !!r.unpaid, clockPaid: !!r.clockPaid, blended: r.blendedMin || 0, name: r.clientName, kind: _tlRailKind(r) }));
    } finally { window.timeEntries = keepT; window._fetchCrewLabor = keepF; }
  }, [entries, shop, clocks, DAY]);

  test('the owner\'s derived day under a clock that brackets it: nothing counted twice', async () => {
    const entries = [
      row('l1', 'drive', T(7, 52), T(8, 3), { dest_place: 'John Doe' }),
      row('d1', 'client', T(8, 3), T(12, 21), { dest_place: 'John Doe' }),
      row('l2', 'drive', T(12, 21), T(12, 31), { dest_place: 'JS Solutions shop' }),
      row('l3', 'drive', T(13, 17), T(13, 25), { dest_place: 'John Doe' }),
      row('d2', 'client', T(13, 25), T(17, 8), { dest_place: 'John Doe' }),
      row('l4', 'drive', T(17, 8), T(17, 16), { dest_place: '2015 SW Randolph Ave' }),
    ];
    const shop = [row('s1', 'shop', T(12, 31), T(13, 17))];
    const r = await render(entries, shop, [[T(7, 30), T(17, 30)]]);
    const auto = r.filter(x => x.src !== 'manual');
    const clock = r.find(x => x.src === 'manual');
    // Every automatic row keeps its own minutes.
    expect(auto.map(x => [x.t, x.min])).toEqual([
      ['12:52-13:03', 11], ['13:03-17:21', 258], ['17:21-17:31', 10], ['17:31-18:17', 46],
      ['18:17-18:25', 8], ['18:25-22:08', 223], ['22:08-22:16', 8],
    ]);
    // The clock ran 600 minutes; 564 of them are itemised below it.
    expect(clock).toBeTruthy();
    expect(clock.blended).toBe(564);
    expect(clock.min).toBe(36);
    // And the day totals the clock, not the clock plus the fences.
    const total = r.reduce((s, x) => s + (x.unpaid ? 0 : x.min), 0);
    expect(total).toBe(600);
  });

  test('Jack\'s shape: an untracked client in the middle is exactly the clock\'s remainder', async () => {
    // Drove house -> dad's shop before clocking in (not inside the clock, so
    // not blended), clocked in at 7:42, in the shop fence until 9:17, two
    // hours at a client with no fence, back in the fence 11:18 to 3:00.
    const shop = [row('s1', 'shop', T(7, 42), T(9, 17)), row('s2', 'shop', T(11, 18), T(15, 0))];
    const entries = [row('l0', 'drive', T(7, 20), T(7, 42), { dest_place: 'Dad\'s shop' })];
    const r = await render(entries, shop, [[T(7, 42), T(15, 0)]]);
    const clock = r.find(x => x.src === 'manual');
    expect(clock.blended).toBe(95 + 222);
    // 7:42 to 3:00 is 438 minutes; the fences explain 317; the client with no
    // fence is the 121 that remain, and they read as Manual time.
    expect(clock.min).toBe(121);
    expect(clock.kind).toBe('manual');
    // The drive before the clock is its own paid row, untouched by the blend.
    const drive = r.find(x => x.raw === 'drive');
    expect([drive.min, drive.unpaid]).toEqual([22, false]);
    const total = r.reduce((s, x) => s + (x.unpaid ? 0 : x.min), 0);
    expect(total).toBe(22 + 438);
  });

  test('an automatic row only partly inside the clock is prorated, never double counted', async () => {
    // Fence 8:00 to 10:00, clock 9:00 to 12:00: sixty of the fence's minutes
    // fall inside the clock and only those come off it.
    const entries = [row('d1', 'client', T(8, 0), T(10, 0), { dest_place: 'John Doe' })];
    const r = await render(entries, [], [[T(9, 0), T(12, 0)]]);
    const clock = r.find(x => x.src === 'manual');
    expect(clock.blended).toBe(60);
    expect(clock.min).toBe(120);
    const total = r.reduce((s, x) => s + x.min, 0);
    expect(total).toBe(120 + 120);
  });

  test('two clocks in one day each blend only what sits inside them', async () => {
    const entries = [row('d1', 'client', T(8, 0), T(9, 0)), row('d2', 'client', T(14, 0), T(15, 0))];
    const r = await render(entries, [], [[T(7, 0), T(10, 0)], [T(13, 0), T(16, 0)]]);
    const clocks = r.filter(x => x.src === 'manual');
    expect(clocks.map(c => [c.blended, c.min])).toEqual([[60, 120], [60, 120]]);
  });

  test('a fence wider than the clock never drives the clock below zero', async () => {
    const entries = [row('d1', 'client', T(6, 0), T(18, 0))];
    const r = await render(entries, [], [[T(9, 0), T(10, 0)]]);
    const clock = r.find(x => x.src === 'manual');
    expect(clock.min).toBe(0);
    expect(clock.blended).toBe(60);
  });

  test('a clock with no automatic rows under it is plain manual time, and a day with no clock is the fences alone', async () => {
    const a = await render([], [], [[T(9, 0), T(12, 0)]]);
    expect(a.map(x => [x.src, x.min, x.blended])).toEqual([['manual', 180, 0]]);
    const b = await render([row('d1', 'client', T(8, 0), T(9, 30))], [], []);
    expect(b.filter(x => x.src === 'manual')).toHaveLength(0);
    expect(b.find(x => x.src !== 'manual').min).toBe(90);
  });

  test('the reader is two passes and nothing else', async () => {
    // What the blend is allowed to do is the whole reader now: no round trip
    // withdrawal, no gap absorption, no duplicate drop, no repair pass.
    const r = await page.evaluate(() => ['_tlBlendManual', '_tlFillUnaccounted'].map(n => typeof window[n])
      .concat(['_tlDemoteRoundTrips', '_tlAbsorbGaps', '_tlStopAnchored', '_tlRepairPass'].map(n => typeof window[n])));
    expect(r).toEqual(['function', 'function', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  test('no console errors', async () => { assertNoErrors(page, 'blend'); });
});
