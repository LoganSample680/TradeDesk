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
    expect(clock.min + r.filter(x => x.raw === 'clock-span').reduce((n, x) => n + x.min, 0)).toBe(36);
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
    const site = r.find(x => x.raw === 'clock-span');
    expect(site, 'the untracked client in the middle').toBeTruthy();
    expect(site.min).toBe(121);
    // AMENDED 2026-09-16 (10.4). It was kind 'site' named "Unsaved address".
    // It is Manual time now and carries no name, because this row has never
    // known an address: all it knows is that the clock was running and nothing
    // tracked the stretch. Owner 2026-09-16, reading Jack's rail, took the
    // shop at 1:27 followed by "Unsaved address" at 1:57 for a lost drive. He
    // had not moved. Not one total changes; only the claim does.
    expect(site.kind).toBe('off');
    expect(site.name).toBe('');
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
    expect(clock.min + r.filter(x => x.raw === 'clock-span').reduce((n, x) => n + x.min, 0)).toBe(120);
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
    const sites = r.filter(x => x.raw === 'clock-span');
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

  // ── HIS 10h43m AT THE SHOP (owner 2026-09-13) ──────────────────────────
  // "Says I arrived 10:14, why is it still going and counting?" Because an
  // open dwell has no departure, so this row is now minus the arrival with no
  // ceiling, and he had not left the house since that morning.
  //
  // The day-end work the night before stopped the Home card and the open
  // banner and left this row alone, on the reasoning that the rail draws the
  // day's shape and the row was labelled "not counted". He found it within
  // hours. A number that size on a timesheet reads as a claim whatever the
  // caption says.
  test('home with the workday over: the rail stops drawing the live row, and only then', async () => {
    const r = await page.evaluate(async () => {
      const keepT = timeEntries.slice(), keepF = window._fetchCrewLabor, keepD = window._geoOpenDwell;
      window.timeEntries = [];
      window._fetchCrewLabor = async () => ({ name: {}, entries: [], shopEntries: [] });
      const dayStart = _geoDayBounds(_geoDayKeyOf(Date.now(), 'America/Chicago')).start;
      const since = Math.max(dayStart + 60000, Date.now() - 10 * 3600000 - 43 * 60000);
      const mk = (over) => Object.assign({ id: 'd-home', name: 'TradeDesk shop', kind: 'shop',
        sinceTs: since, sinceIso: new Date(since).toISOString(), journeyId: 'h',
        atHome: true, counts: false, fence: { addr: '2015 SW Randolph Ave' } }, over || {});
      const live = async (d) => { window._geoOpenDwell = d;
        return (await _timeLogRows(null)).filter(x => x.live); };
      try {
        return {
          // His case: at his own address, the workday over.
          over: (await live(mk())).length,
          // Home at lunch, workday still open: the rail still draws it.
          midday: (await live(mk({ counts: true }))).map(x => [x.clientName, x.detail]),
          // A customer's address never takes this rule, at any hour, counted
          // or not: that one is a real question about a real visit.
          client: (await live(mk({ atHome: false, kind: 'client', name: 'John Doe' })))
            .map(x => [x.clientName, x.detail]),
        };
      } finally { window.timeEntries = keepT; window._fetchCrewLabor = keepF; window._geoOpenDwell = keepD; }
    });
    expect(r.over, 'nothing is drawn once he is home and the day is done').toBe(0);
    expect(r.midday.length).toBe(1);
    expect(r.midday[0][1]).toBe('On site now');
    expect(r.client.length).toBe(1);
    expect(r.client[0]).toEqual(['John Doe', 'Here now, not counted']);
  });

  test('the reader is two passes and nothing else', async () => {
    // What the blend is allowed to do is the whole reader now: no round trip
    // withdrawal, no gap absorption, no duplicate drop, no repair pass.
    const r = await page.evaluate(() => ['_tlBlendManual', '_tlFillUnaccounted'].map(n => typeof window[n])
      .concat(['_tlDemoteRoundTrips', '_tlAbsorbGaps', '_tlStopAnchored', '_tlRepairPass'].map(n => typeof window[n])));
    expect(r).toEqual(['function', 'function', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  // Rule 13 on the rail: a held visit is a question in no total; a dismissed
  // one is a row nothing draws.
  //
  // AMENDED 2026-09-16. This used to assert the dismissed visit produced no
  // row at all, and that was correct for what it could see: the rail does not
  // draw it and no total counts it. It was wrong about the mechanism, and the
  // mechanism is what broke Jack's day. A row that is absent from `rows` is a
  // hole, and under a manual clock _tlBlendManual fills holes with paid time,
  // so his answered-Personal stop at Laurie Schonfeldt came back as 68 paid
  // minutes of "manual time". The row now EXISTS and carries `dismissed`,
  // which is the same shape a personal gap answer has always had
  // (_tlIsPersonalGap): every span-aware pass sees the stretch covered, and
  // _tlDayRailHtml is the only thing that drops it. Unpaid and undrawn are
  // still asserted below, so nothing this test was protecting has moved.
  test('a held visit is unpaid and says so; a dismissed one is covered but never drawn', async () => {
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
                 dis: byId('d1') && { unpaid: byId('d1').unpaid, dismissed: !!byId('d1').dismissed },
                 rail: _tlDayRailHtml(rows.filter(x => x.date === '2026-08-23')),
                 paid: _tlPaidMin(rows) };
      } finally { window._fetchCrewLabor = saved; }
    });
    // unpaid stays: a held visit is still in no total, which is the whole
    // point of rule 13. The KIND and the words changed on 2026-09-10: it used
    // to fall through to the unpaid catch-all and read "Manual time · unpaid",
    // which is not manual and is not a verdict, and it used to send him to the
    // Home screen for the answer that now sits on the row.
    expect(r.held).toEqual({ unpaid: true, detail: 'Not counted until you answer', kind: 'held' });
    // It is there, so the blend can never mistake it for an empty stretch.
    expect(r.dis).toEqual({ unpaid: true, dismissed: true });
    // AMENDED AGAIN 2026-09-16, same day, second half of the same report:
    // "he didn't mean to hit personal." It used to be drawn nowhere, and that
    // is what made a one-tap answer permanent: no row, no control on it, no
    // way back. It draws now, grey, in no total, carrying the one chip that
    // undoes the tap. "Not counted" is still asserted above; "invisible" was
    // never the requirement, it was the bug.
    expect(r.rail).toContain('data-kind="personal"');
    expect(r.paid).toBe(120);
  });

  // ── HIS ANSWER SURVIVES HIS OWN CLOCK (owner 2026-09-16) ─────────────────
  //
  // "Also why is Laurie Schonfeldt sitting as manual time?" Jack answered that
  // stop Personal at 1:34pm. His clock ran anyway, so the reader dropped the
  // row, found 68 minutes of clock that nothing explained, and billed them
  // back as a paid untracked row. The answer took the stop off the rail and
  // left the pay on the day. This is the permanent guard: a dismissed stretch
  // under a clock is COVERED, so no filler row is ever written over it.
  test('a stop answered Personal is not re-billed by the clock that brackets it', async () => {
    const entries = [
      row('p1', 'dismissed', T(7, 59), T(9, 7), { dest_place: 'Laurie Schonfeldt' }),
      row('l1', 'drive', T(9, 7), T(9, 30), { dest_place: 'John Doe' }),
      row('c1', 'client', T(9, 30), T(16, 0), { dest_place: 'John Doe' }),
    ];
    const rows = await render(entries, [], [[T(7, 54), T(16, 39)]]);
    const hm = t => t.slice(11, 16);
    const span = hm(T(7, 59)) + '-' + hm(T(9, 7));
    // Nothing invented over the personal stretch.
    expect(rows.filter(r => r.raw === 'clock-span' && r.t.slice(0, 5) < hm(T(9, 7)) && r.t.slice(6) > hm(T(7, 59)))).toEqual([]);
    // The stop itself is present, unpaid, and carries the dismissed flag.
    const p = rows.find(r => r.t === span);
    expect(p && { min: p.min, unpaid: p.unpaid, name: p.name }).toEqual({ min: 68, unpaid: true, name: 'Laurie Schonfeldt' });
  });

  // The undo itself. It is the only way back from a one-tap answer, and it
  // goes through the SAME door the Home card's answers do (_visitHoldAnswer,
  // 'working'), so one definition of what an answer means serves both (7.3).
  test('an answered-Personal row of your own offers It was work', async () => {
    const r = await page.evaluate(() => {
      const mine = { id: 'x', rawId: 'row-uuid', source: 'auto', rawSource: 'dismissed', dismissed: true,
        unpaid: true, minutes: 68, date: '2026-09-01', personUid: _supaUser.id, clientName: 'Laurie Schonfeldt',
        detail: 'Personal (not counted)', startTime: '2026-09-01T13:00:00.000Z', endTime: '2026-09-01T14:08:00.000Z' };
      const theirs = Object.assign({}, mine, { id: 'y', rawId: 'row-2', personUid: 'someone-else' });
      return { mine: _tlDayRailHtml([mine]), theirs: _tlDayRailHtml([theirs]) };
    });
    expect(r.mine).toContain('It was work');
    expect(r.mine).toContain("_visitHoldAnswer('row-uuid','working')");
    // Never on somebody else's row: answering for another person is not a
    // thing a shared timesheet gets to do, the same gate the Working/Personal
    // chips already carry.
    expect(r.theirs).not.toContain('It was work');
    // And it is still in no total either way.
    expect(r.mine).toContain('data-kind="personal"');
  });

  // ── THE VIEWER IS NOT THE PERSON (owner report 2026-09-14) ──────────────
  //
  // Every test above stamps the automatic rows with the SAME uid the session
  // is signed in as, so the null-uid clock and the fences always landed in
  // one bucket and the blend always ran. That is the fixture agreeing with
  // the code, which is the exact failure the 2026-09-01 note at the top of
  // _tlBlendManual warned about, one layer up.
  //
  // Read a day that belongs to somebody else (the support view: the login is
  // the owner's, the account on screen is Jack's) and the two came apart. His
  // clock carries logged_by_uid null and folded under the VIEWER; his drives
  // and visits carry his own uid and folded under HIM; the bucket with his
  // rows in it had no clock, so the blend returned before it did anything.
  // 509 clocked minutes then counted in full on top of the 479 minutes of
  // driving and site time they already contain.
  //
  // His real 14 September, to the minute.
  test('a day read through the support view still blends: the clock is the bracket, not an extra shift', async () => {
    const JACK = '987ebc83-1567-49e1-9dd3-b89b0cf9121b';
    const r = await page.evaluate(async ([JACK, DAY, DAY_START]) => {
      const T = (h, m) => new Date(DAY_START + h * 3600000 + m * 60000).toISOString();
      const keepT = timeEntries.slice(), keepF = window._fetchCrewLabor;
      const keepU = window._supaUser, keepB = window._OPS_BOOT, keepV = window._opsView;
      const mk = (id, source, a, b, dest) => ({ id, source, job_id: null, client_key: 'd-' + id,
        employee_user_id: JACK, contractor_user_id: JACK, arrived_at: a, departed_at: b,
        minutes: Math.round((Date.parse(b) - Date.parse(a)) / 60000), dest_place: dest || null });
      const entries = [
        mk('l1', 'drive', T(7, 24), T(7, 48), 'JS Solutions shop'),
        mk('l2', 'drive', T(7, 59), T(8, 14), 'Bill Lorson'),
        mk('d1', 'client', T(8, 14), T(9, 22), 'Bill Lorson'),
        mk('l3', 'drive', T(9, 22), T(9, 42), 'JS Solutions shop'),
        mk('l4', 'drive', T(9, 55), T(10, 10)),
        mk('s0', 'unsaved', T(10, 10), T(10, 39)),
        mk('l5', 'drive', T(10, 39), T(11, 20), 'Bill Lorson'),
        mk('d2', 'client', T(11, 20), T(15, 43), 'Bill Lorson'),
      ];
      const shop = [mk('sh1', 'shop', T(7, 48), T(7, 59)), mk('sh2', 'shop', T(9, 42), T(9, 55))];
      // The login is the owner; the account being read is Jack's.
      window._supaUser = { id: 'viewer-owner-uid', email: 'o@t.com' };
      window._OPS_BOOT = true; window._opsView = { target: JACK };
      // Exactly how the table holds an employee's clock: no logged_by_uid.
      window.timeEntries = [{ id: 901, job_id: null, date: DAY, start_time: T(7, 44), end_time: T(16, 13),
        minutes: 509, logged_by_uid: null, logged_by_name: 'Jack Schonfeldt', open: false }];
      window._fetchCrewLabor = async () => ({ name: { [JACK]: 'Jack Schonfeldt' }, entries, shopEntries: shop });
      try {
        const rows = (await _timeLogRows(null)).filter(x => x.date === DAY);
        const clock = rows.find(x => x.source === 'manual');
        return {
          acting: _tlActingUid(),
          uids: Array.from(new Set(rows.map(x => String(x.personUid || '')))).sort(),
          blended: clock ? clock.blendedMin || 0 : -1,
          clockMin: clock ? clock.minutes : -1,
          site: rows.filter(x => x.rawSource === 'clock-span').reduce((n, x) => n + x.minutes, 0),
          paid: rows.reduce((n, x) => n + (x.unpaid ? 0 : x.minutes), 0),
        };
      } finally {
        window.timeEntries = keepT; window._fetchCrewLabor = keepF;
        window._supaUser = keepU; window._OPS_BOOT = keepB; window._opsView = keepV;
      }
    }, [JACK, DAY, DAY_START]);
    // The identity the page buckets under is the BUSINESS on screen, never
    // the login. This is the assertion that actually fails without the fix.
    expect(r.acting).toBe(JACK);
    // And nothing folded under the viewer: his clock carries no uid, so it
    // has to land on him.
    expect(r.uids).toEqual(['', JACK]);
    // 07:44 to 15:43 is covered end to end by his own rows, so the clock
    // hands over 479 of its 509 minutes.
    expect(r.blended).toBe(479);
    // The 30 minutes after his last row and before he clocked out are the
    // remainder, named rather than left on the clock (2026-09-04).
    expect(r.clockMin + r.site).toBe(30);
    // THE WHOLE POINT. 499 minutes of tracked rows plus the 30 the clock
    // still explains. Not 988, which is what a clock that never blended
    // gives: 509 + 479 counted twice over the same afternoon.
    expect(r.paid).toBe(529);
  });

  // HIS ACTUAL DAY, ROW FOR ROW OUT OF THE TABLES, duplicate included.
  // The owner opened it and the Time Log read 19h06m. That is the clock plus
  // every automatic row with nothing subtracted anywhere.
  //
  // THE ANSWER IS THE FENCES, NOT THE CLOCK (owner 2026-09-01: "the fences
  // are what happened; the clock adds nothing"). His rows start twenty
  // minutes before he clocked in and run to 15:43 while he clocked out at
  // 16:13, so what they cover already exceeds the clock: the remainder floors
  // at zero and the day is the automatic total. A day that comes out at the
  // CLOCK here would be just as wrong in the other direction.
  test('Jack\'s 14 September through the support view: the day is his rows, not his rows plus his clock', async () => {
    const JACK = '987ebc83-1567-49e1-9dd3-b89b0cf9121b';
    const D = '2026-09-14';
    const r = await page.evaluate(async ([JACK, D]) => {
      const keepT = timeEntries.slice(), keepF = window._fetchCrewLabor;
      const keepU = window._supaUser, keepB = window._OPS_BOOT, keepV = window._opsView;
      const mk = (key, source, a, b, min, dest) => ({ id: key, source, job_id: null, client_key: key,
        employee_user_id: JACK, contractor_user_id: JACK,
        arrived_at: D + 'T' + a + 'Z', departed_at: D + 'T' + b + 'Z', minutes: min,
        dest_place: dest || null });
      const entries = [
        mk('j-mu17spln', 'drive', '12:24:03.226', '12:48:00.805', 24, 'JS Solutions shop'),
        mk('j-mu1925w4', 'drive', '12:59:23.859', '13:14:01.076', 15, 'Bill Lorson'),
        // The duplicate, exactly as the table holds it: one physical stop
        // under two keys, because one derive run split the journey there and
        // a later one did not. Left in on purpose. The blend has to be right
        // about the day even while the rows under it are wrong.
        mk('j-mu1925w4:s0', 'client', '13:14:01.076', '14:22:44.957', 69, 'Bill Lorson'),
        mk('d-j-mu1925w4', 'client', '13:14:01.076', '14:22:44.957', 69, 'Bill Lorson'),
        mk('j-mu1c1crh', 'drive', '14:22:44.957', '14:42:25.106', 20, 'JS Solutions shop'),
        mk('j-mu1d7p2e:0', 'drive', '14:55:40.454', '15:10:09.800', 14, null),
        mk('j-mu1d7p2e:s0', 'unsaved', '15:10:09.800', '15:39:49.184', 30, null),
        mk('j-mu1d7p2e:1', 'drive', '15:39:49.184', '16:20:26.286', 41, 'Bill Lorson'),
        mk('d-j-mu1ffssg', 'client', '16:20:26.286', '20:43:12.679', 263, 'Bill Lorson'),
      ];
      const shop = [
        mk('d-j-mu17x5hf', 'shop', '12:48:00.805', '12:59:23.860', 11),
        mk('d-j-mu1c1crh', 'shop', '14:42:25.107', '14:55:40.454', 13),
      ];
      window._supaUser = { id: 'viewer-owner-uid', email: 'o@t.com' };
      window._OPS_BOOT = true; window._opsView = { target: JACK };
      window.timeEntries = [{ id: 1789389874109, job_id: null, date: D,
        start_time: D + 'T12:44:34.110Z', end_time: D + 'T21:13:31.312Z',
        minutes: 509, logged_by_uid: null, logged_by_name: 'Jack Schonfeldt', open: false }];
      window._fetchCrewLabor = async () => ({ name: { [JACK]: 'Jack Schonfeldt' }, entries, shopEntries: shop });
      try {
        const rows = (await _timeLogRows(null)).filter(x => x.date === D);
        const clock = rows.find(x => x.source === 'manual');
        return {
          autoSum: entries.concat(shop).reduce((n, e) => n + e.minutes, 0),
          clockMin: clock ? clock.minutes : -1,
          blended: clock ? clock.blendedMin || 0 : -1,
          paid: rows.reduce((n, x) => n + (x.unpaid ? 0 : x.minutes), 0),
        };
      } finally {
        window.timeEntries = keepT; window._fetchCrewLabor = keepF;
        window._supaUser = keepU; window._OPS_BOOT = keepB; window._opsView = keepV;
      }
    }, [JACK, D]);
    // The rows on the table, as they stand, duplicate and all.
    expect(r.autoSum).toBe(569);
    // The clock hands over everything it can and keeps nothing: his rows
    // already cover more of it than it has minutes.
    expect(r.clockMin).toBe(0);
    // The day is what the phone watched. NOT 569 + 509 = 1078, which is what
    // a blend that never ran produces, and not 509 either.
    expect(r.paid).toBe(r.autoSum);
    expect(r.paid).toBe(569);
    expect(r.paid).not.toBe(569 + 509);
  });

  test('no console errors', async () => { assertNoErrors(page, 'blend'); });
});


// ── ONE DWELL, ONE ROW (owner 2026-09-18) ─────────────────────────────────
//
// A dwell with no departure yet is stored now, so the ops portal and Crew Cost
// can see who is on site without this phone being open. This screen already
// had the same fact and a better version of it: the live row built from
// window._geoOpenDwell, which ticks and says "On site now". Letting the stored
// row through as well would draw the same dwell twice, once live and once as a
// dead 0m row, and a NaN duration if anything tried to measure it.
test.describe('the stored open row never doubles the live one', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.supaLoadFromCloud = async () => {};
      window._supaUser = window._supaUser || { id: 'owner-open', email: 'o@t.com' };
      S.bizTz = 'America/Chicago'; S.bname = 'JS Solutions';
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  const draw = (entries, shop) => page.evaluate(async ([entries, shop, DAY]) => {
    const me = _supaUser.id;
    const keepF = window._fetchCrewLabor, keepT = timeEntries.slice(), keepO = window._geoOpenDwell;
    window._geoOpenDwell = null;              // the live row is its own test
    window.timeEntries = [];
    window._fetchCrewLabor = async () => ({ name: { [me]: 'Me' },
      entries: entries.map(e => ({ ...e, employee_user_id: me, contractor_user_id: me })),
      shopEntries: shop.map(e => ({ ...e, employee_user_id: me, contractor_user_id: me })) });
    try {
      const rows = (await _timeLogRows(null)).filter(r => r.date === DAY);
      const total = rows.reduce((s, x) => s + (Number(x.minutes) || 0), 0);
      return { n: rows.length, keys: rows.map(r => r.clientKey), total, finite: Number.isFinite(total) };
    } finally { window._fetchCrewLabor = keepF; window.timeEntries = keepT; window._geoOpenDwell = keepO; }
  }, [entries, shop, DAY]);

  test('a job row with no departure draws nothing, so the dwell is not doubled', async () => {
    const r = await draw([
      row('l1', 'drive', T(8, 0), T(8, 20), { dest_place: 'John Doe' }),
      { id: 'o1', source: 'open', job_id: null, client_key: 'd-o1', dest_place: 'John Doe',
        arrived_at: T(8, 20), departed_at: null, minutes: null },
    ], []);
    expect(r.n, 'only the closed row is drawn').toBe(1);
    expect(r.keys).toEqual(['d-l1']);
  });

  test('a shop row with no departure is skipped too', async () => {
    const r = await draw([], [{ id: 'o2', client_key: 'd-o2', arrived_at: T(9, 0), departed_at: null, minutes: null }]);
    expect(r.n).toBe(0);
  });

  test('a null departure never becomes NaN minutes', async () => {
    // Worse than a missing row: nobody can tell what a NaN was supposed to be.
    const r = await draw([{ id: 'o3', source: 'open', job_id: null, client_key: 'd-o3',
      dest_place: null, arrived_at: T(10, 0), departed_at: null, minutes: null }], []);
    expect(r.finite).toBe(true);
    expect(r.total).toBe(0);
    expect(r.n).toBe(0);
  });
});
