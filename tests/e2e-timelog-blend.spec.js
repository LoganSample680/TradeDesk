// @ts-check
// ── The manual clock mingles with the derived day ───────────────────────────
//
// Owner 2026-09-02: "then we wrap up time log where our manual time blends
// with automatic stops that day, need manual to mingle with automatic time
// logs cleanly."
//
// The rule (owner 2026-09-01): the clock is the outer bracket and the
// automatic rows are the detail. Every automatic row inside the clock keeps
// its own minutes; the clock keeps only what nothing explains. Nothing is
// counted twice and the day totals the clock when the clock brackets
// everything.
//
// AMENDED 2026-09-04. That remainder used to read as "Manual time", which
// said nothing at all about a stretch that on Jack's account IS the working
// day: 2h 3m of his 1 September sat in it with no name. The owner drew the
// rule out: "if we see a manual clock in, and then there's unaccounted for
// time after, meaning he's not inside a shop fence and is still clocked in
// and not back home at his office, that means that unaccounted for time is a
// unsaved job site." So the remainder is now handed to named Job site rows
// and the clock gives up those minutes rather than holding them anonymously.
//
// THE TOTAL IS THE INVARIANT, and every test below still asserts it: naming
// time must never add any. What moved is only which row carries it.
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
    // The leading 12:30-12:52 is the 22 minutes of clock before his first
    // drive: clocked in, not yet anywhere the fences know. Under the
    // 2026-09-04 rule that is a Job site like any other uncovered stretch.
    expect(auto.map(x => [x.t, x.min])).toEqual([
      ['12:30-12:52', 22],
      ['12:52-13:03', 11], ['13:03-17:21', 258], ['17:21-17:31', 10], ['17:31-18:17', 46],
      ['18:17-18:25', 8], ['18:25-22:08', 223], ['22:08-22:16', 8],
      // And the trailing 14 minutes after his last drive home, before he
      // clocked out. 22 + 14 is exactly the 36 the clock used to hold unnamed.
      ['22:16-22:30', 14],
    ]);
    // The clock ran 600 minutes; 564 of them are itemised below it.
    expect(clock).toBeTruthy();
    expect(clock.blended).toBe(564);
    // The 36 minutes nothing itemised are now a Job site rather than sitting
    // unnamed on the clock (2026-09-04). Same minutes, named row.
    expect(clock.min + r.filter(x => x.raw === 'site').reduce((n, x) => n + x.min, 0)).toBe(36);
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
    // fence is the 121 that remain. This is the exact case the owner named on
    // 2026-09-04, so those 121 minutes now say what they are instead of
    // reading as anonymous Manual time.
    const site = r.find(x => x.raw === 'site');
    expect(site, 'the untracked client in the middle').toBeTruthy();
    expect(site.min).toBe(121);
    expect(site.kind).toBe('site');
    // Renamed 2026-09-04: "rather than unsaved job site do we say Unsaved
    // Address." Half of these are a supply house or a gate.
    expect(site.name).toBe('Unsaved address');
    expect(clock.min).toBe(0);
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
    // The two hours of clock the fence did not reach are a Job site now.
    expect(clock.min + r.filter(x => x.raw === 'site').reduce((n, x) => n + x.min, 0)).toBe(120);
    const total = r.reduce((s, x) => s + x.min, 0);
    expect(total).toBe(120 + 120);
  });

  test('two clocks in one day each blend only what sits inside them', async () => {
    const entries = [row('d1', 'client', T(8, 0), T(9, 0)), row('d2', 'client', T(14, 0), T(15, 0))];
    const r = await render(entries, [], [[T(7, 0), T(10, 0)], [T(13, 0), T(16, 0)]]);
    const clocks = r.filter(x => x.src === 'manual');
    // Each clock still blends only its own hour, and each hands its own
    // remaining two hours to a Job site of its own: the point of the test is
    // that neither clock reaches into the other, and it still holds.
    expect(clocks.map(c => c.blended)).toEqual([60, 60]);
    // FOUR job sites, not two, and that is right: each clock has an hour of
    // fence in its middle, so each leaves a free hour either side of it. The
    // point of this test is that neither clock reaches into the other, and
    // that is what the split proves.
    const sites = r.filter(x => x.raw === 'site');
    expect(sites.map(x => [x.t, x.min])).toEqual([
      ['12:00-13:00', 60], ['14:00-15:00', 60],
      ['18:00-19:00', 60], ['20:00-21:00', 60],
    ]);
    clocks.forEach(c => expect(c.min).toBe(0));
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

  test('where I am right now is a live row on today\'s rail and a line on the open banner', async () => {
    const r = await page.evaluate(async () => {
      const me = _supaUser.id;
      const keepT = timeEntries.slice(); const keepF = window._fetchCrewLabor;
      window.timeEntries = [];
      window._fetchCrewLabor = async () => ({ name: {}, entries: [], shopEntries: [] });
      // Anchored to today's start: at the midnight clock pin "47 minutes
      // ago" is yesterday (CLAUDE.md 5.2.2). The minutes are read back from
      // the same clock the row is built on.
      const dayStart = _geoDayBounds(_geoDayKeyOf(Date.now(), 'America/Chicago')).start;
      const since = Math.max(dayStart + 60000, Date.now() - 47 * 60000);
      const expectMin = Math.max(0, Math.round((Date.now() - since) / 60000));
      window._geoOpenDwell = { id: 'd-j-x', name: 'John Doe', kind: 'client', sinceTs: since, sinceIso: new Date(since).toISOString(), journeyId: 'x', fence: { addr: '2950 SW McClure Rd' } };
      try {
        const rows = await _timeLogRows(null);
        const live = rows.filter(x => x.live);
        // Yesterday's dwell is not today's row.
        window._geoOpenDwell.sinceTs = since - 86400000; window._geoOpenDwell.sinceIso = new Date(since - 86400000).toISOString();
        const stale = (await _timeLogRows(null)).filter(x => x.live).length;
        window._geoOpenDwell.sinceTs = since; window._geoOpenDwell.sinceIso = new Date(since).toISOString();
        let host = document.getElementById('tl-open');
        if (!host) { host = document.createElement('div'); host.id = 'tl-open'; document.body.appendChild(host); }
        _tlRenderOpenBanner();
        const banner = host.innerHTML;
        // The rail row for a visit still going: arrival "to -", no amount
        // on the right until they leave (owner 2026-09-02).
        const railRow = live.length ? _tlRailRow(live[0]) : '';
        const railSub = (railRow.match(/tl-rail-sub">([^<]*)</) || [])[1] || '';
        const railDur = (railRow.match(/tl-rail-dur[^>]*>([^<]*)</) || [])[1] || '';
        window._geoOpenDwell = null;
        _tlRenderOpenBanner();
        const cleared = host.style.display;
        return { expectMin, live: live.map(x => [x.clientName, x.minutes, x.rawSource, x.personUid === me, x.detail, _tlRailKind(x)]), stale, banner: { onsite: /ON SITE/.test(banner), name: /John Doe/.test(banner), clockOut: /Clock out/.test(banner), tick: /data-tl-open-start="/.test(banner) }, cleared, railSub, railDur };
      } finally { window.timeEntries = keepT; window._fetchCrewLabor = keepF; window._geoOpenDwell = null; }
    });
    expect(r.live).toEqual([['John Doe', r.expectMin, 'client', true, 'On site now', 'job']]);
    expect(r.railSub).toMatch(/ to -$/);
    expect(r.railDur.trim()).toBe('');
    expect(r.expectMin).toBeGreaterThanOrEqual(1);
    expect(r.stale).toBe(0);
    expect(r.banner).toEqual({ onsite: true, name: true, clockOut: false, tick: true });
    expect(r.cleared).toBe('none');
  });

  test('the reader is two passes and nothing else', async () => {
    // What the blend is allowed to do is the whole reader now: no round trip
    // withdrawal, no gap absorption, no duplicate drop, no repair pass.
    const r = await page.evaluate(() => ['_tlBlendManual', '_tlFillUnaccounted'].map(n => typeof window[n])
      .concat(['_tlDemoteRoundTrips', '_tlAbsorbGaps', '_tlStopAnchored', '_tlRepairPass'].map(n => typeof window[n])));
    expect(r).toEqual(['function', 'function', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  // Rule 13 on the rail: a held visit is a question in no total; a dismissed
  // one is not a row at all.
  test('a held visit is unpaid and says so; a dismissed one is gone', async () => {
    const r = await page.evaluate(async () => {
      const saved = window._fetchCrewLabor;
      try {
        window._fetchCrewLabor = async () => ({ name: { me: 'Me' }, shopEntries: [], entries: [
          { id: 'h1', employee_user_id: 'me', job_id: null, dest_place: 'Mom', source: 'client-held', arrived_at: '2026-08-30T22:00:00Z', departed_at: '2026-08-31T01:00:00Z', minutes: 180 },
          { id: 'd1', employee_user_id: 'me', job_id: null, dest_place: 'Mom', source: 'dismissed',   arrived_at: '2026-08-23T22:00:00Z', departed_at: '2026-08-24T01:00:00Z', minutes: 180 },
          { id: 'c1', employee_user_id: 'me', job_id: null, dest_place: 'Cust', source: 'client',    arrived_at: '2026-08-31T15:00:00Z', departed_at: '2026-08-31T17:00:00Z', minutes: 120 },
        ] });
        const rows = await _timeLogRows(null);
        const byId = id => rows.find(x => x.rawId === id);
        return { held: byId('h1') && { unpaid: byId('h1').unpaid, detail: byId('h1').detail, kind: _tlRailKind(byId('h1')) },
                 dismissed: !!byId('d1'), paid: _tlPaidMin(rows) };
      } finally { window._fetchCrewLabor = saved; }
    });
    expect(r.held).toEqual({ unpaid: true, detail: 'Working here? Answer on Home', kind: 'off' });
    expect(r.dismissed).toBe(false);
    expect(r.paid).toBe(120);
  });

  test('no console errors', async () => { assertNoErrors(page, 'blend'); });
});
