// @ts-check
// ── The dispatch board, day-of ──────────────────────────────────────────────
//
// Owner (2026-08-01): "What do the arrows mean on dispatch board? How does
// dispatch look on the competition, what do contractors want?" then: "let's get
// it all done."
//
// Three things came out of that, and this file holds all three.
//
// 1. THE ARROWS ARE GONE. They wrote dispatchOrder (the sequence of one
//    person's day) but nothing on screen said so, and moving a job from fourth
//    to first cost three taps each way. Every product in this category reorders
//    by dragging. A grip says what it does and one gesture moves any distance.
//
// 2. LIVE STATUS, which is the one that actually beats them. Jobber, Housecall
//    Pro and ServiceTitan all sell "real-time status from the field", and on
//    every one of them a technician has to TAP en route and arrived. Our
//    geofence already knows: arrivals and departures are logged with no tap at
//    all. The data was collected and simply never read back onto the board.
//
// 3. THE TIMELINE, the day by the clock, built from times that were actually
//    recorded rather than from what somebody meant to happen. The value is the
//    shape: who is full, who has a hole after lunch, who has not started.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Dispatch board', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    await page.evaluate(() => {
      window.__seedBoard = (opts) => {
        opts = opts || {};
        _isEmployee = false;
        S.teamTracking = true;
        S.employees = [
          { id: 'e-dave', name: 'Dave Ruiz', role: 'lead', employee_user_id: 'u-dave' },
          { id: 'e-luis', name: 'Luis Kane', role: 'tech', employee_user_id: 'u-luis' },
        ];
        clients.length = 0;
        clients.push({ id: 1, name: 'Novak Residence', addr: '9 Elm St' });
        clients.push({ id: 2, name: 'Harper Build', addr: '221 Vine' });
        clients.push({ id: 3, name: 'Reyes Remodel', addr: '54 Cedar' });
        jobs.length = 0;
        [1, 2, 3].forEach((n, i) => jobs.push({
          id: 800 + n, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1,
          client_id: n, assignedTo: 'e-dave', dispatchOrder: i,
        }));
        jobs.push({ id: 810, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1,
                    client_id: 1, assignedTo: 'e-luis', dispatchOrder: 0 });
        _dispatchView = 'crew';
        _dispatchStatus = opts.status || {};
        _dispatchDay = opts.day || {};
        _dispatchStatusAt = Date.now();          // hold off the network read
        goPg('pg-dispatch');
        renderDispatch();
      };
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test.beforeEach(async () => { await page.evaluate(() => __seedBoard()); });

  test.describe('reordering by drag', () => {
    test('every assigned job carries a grip, and unassigned jobs do not', async () => {
      // An unassigned job has no day to be third in, so a reorder handle there
      // would be a control that cannot do anything.
      const out = await page.evaluate(() => {
        jobs.find(j => j.id === 803).assignedTo = null;
        renderDispatch();
        const assigned = document.querySelectorAll('.dsp-card[data-emp="e-dave"] .dsp-grip').length;
        const un = document.querySelectorAll('#dispatch-unassigned .dsp-grip').length;
        return { assigned, un };
      });
      expect(out.assigned).toBe(2);
      expect(out.un).toBe(0);
    });

    test('the grip does not block the page from scrolling', async () => {
      // touch-action:none belongs on the HANDLE only. On the whole card it would
      // trap the finger and you could not scroll past the board.
      const out = await page.evaluate(() => {
        const grip = document.querySelector('.dsp-grip');
        const card = grip.closest('.dsp-card');
        return { grip: getComputedStyle(grip).touchAction, card: getComputedStyle(card).touchAction };
      });
      expect(out.grip).toBe('none');
      expect(out.card).not.toBe('none');
    });

    test('dragging a job to the top rewrites the day in that order', async () => {
      const out = await page.evaluate(async () => {
        const host = document.getElementById('pg-dispatch');
        const cards = [...document.querySelectorAll('.dsp-card[data-emp="e-dave"]')];
        const third = cards[2];
        const grip = third.querySelector('.dsp-grip');
        const first = cards[0].getBoundingClientRect();
        const gr = grip.getBoundingClientRect();
        const ev = (type, y) => host.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: gr.left + 5, clientY: y, pointerId: 1,
        }));
        // pointerdown has to originate on the grip for the handler to latch on.
        grip.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, clientX: gr.left + 5, clientY: gr.top + 5, pointerId: 1 }));
        ev('pointermove', first.top + 2);
        ev('pointermove', first.top - 20);
        ev('pointermove', first.top - 40);
        ev('pointerup', first.top - 40);
        await new Promise(r => setTimeout(r, 30));
        return jobs.filter(j => String(j.assignedTo) === 'e-dave')
          .sort((a, b) => (a.dispatchOrder || 0) - (b.dispatchOrder || 0)).map(j => j.id);
      });
      expect(out[0]).toBe(803);
      expect(out).toEqual([803, 801, 802]);
    });

    test('a drag that never moves changes nothing', async () => {
      // A tap on the grip is not a reorder, and must not renumber the day.
      const out = await page.evaluate(async () => {
        const before = jobs.filter(j => String(j.assignedTo) === 'e-dave')
          .sort((a, b) => (a.dispatchOrder || 0) - (b.dispatchOrder || 0)).map(j => j.id);
        const grip = document.querySelector('.dsp-card[data-emp="e-dave"] .dsp-grip');
        const gr = grip.getBoundingClientRect();
        grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: gr.left, clientY: gr.top, pointerId: 2 }));
        document.getElementById('pg-dispatch').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
        await new Promise(r => setTimeout(r, 20));
        const after = jobs.filter(j => String(j.assignedTo) === 'e-dave')
          .sort((a, b) => (a.dispatchOrder || 0) - (b.dispatchOrder || 0)).map(j => j.id);
        return { before, after };
      });
      expect(out.after).toEqual(out.before);
    });

    test('one person\'s drag never reorders another person\'s day', async () => {
      const out = await page.evaluate(() => {
        const luis = jobs.find(j => j.id === 810);
        luis.dispatchOrder = 7;
        _dispatchSetOrder(['810', '801'], 'e-dave');
        return { luis: luis.dispatchOrder, dave: jobs.find(j => j.id === 801).dispatchOrder };
      });
      expect(out.luis).toBe(7);       // untouched
      expect(out.dave).toBe(1);       // its own list still applied
    });
  });

  test.describe('live status, the thing the competition makes you tap for', () => {
    test('a job someone is standing on says so, in green', async () => {
      const html = await page.evaluate(() => {
        __seedBoard({ status: { '801': { onSite: true, first: null, last: null, mins: 95, who: 'Dave Ruiz' } } });
        return document.querySelector('.dsp-card[data-job="801"]').innerHTML;
      });
      expect(html).toContain('On site now');
      expect(html).toContain('Dave Ruiz');
      expect(html).toContain('1h 35m');
    });

    test('a finished job shows when they arrived, left, and how long', async () => {
      const text = await page.evaluate(() => {
        const at = (h, m) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
        __seedBoard({ status: { '802': { onSite: false, first: at(8, 42), last: at(11, 15), mins: 153, who: 'Dave Ruiz' } } });
        return document.querySelector('.dsp-card[data-job="802"]').innerText;
      });
      expect(text).toMatch(/8:42/);
      expect(text).toMatch(/11:15/);
      expect(text).toContain('2h 33m');
    });

    test('a job nothing has happened on says nothing at all', async () => {
      // An empty state that says "nothing yet" on every card all morning is
      // noise. Absent is quieter than present-and-empty.
      const text = await page.evaluate(() => {
        __seedBoard();
        return document.querySelector('.dsp-card[data-job="803"]').innerText;
      });
      expect(text).not.toMatch(/On site|–/);
    });

    test('drive and stop rows are never counted as time on site', async () => {
      // A drive leg that ENDED at a job carries that job_id. Counting it would
      // put the drive there inside the visit.
      const out = await page.evaluate(async () => {
        const at = (h, m) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
        const rows = [
          { job_id: '801', employee_user_id: 'u-dave', arrived_at: at(8, 0), departed_at: at(8, 30), minutes: 30, source: 'drive' },
          { job_id: '801', employee_user_id: 'u-dave', arrived_at: at(8, 30), departed_at: at(9, 30), minutes: 60, source: 'geofence' },
          { job_id: '801', employee_user_id: 'u-dave', arrived_at: at(12, 0), departed_at: at(12, 45), minutes: 45, source: 'stop' },
        ];
        const realSupa = _supa;
        _supa = { from: (t) => ({ select: () => ({ eq: () => ({ gte: async () => ({ data: t === 'job_time_entries' ? rows : [] }) }) }) }) };
        const realUser = _supaUser; _supaUser = { id: 'u-owner' };
        try {
          _dispatchStatusAt = 0;
          await _dispatchLoadStatus(true);
          return _dispatchStatus['801'];
        } finally { _supa = realSupa; _supaUser = realUser; }
      });
      expect(out.mins).toBe(60);       // the geofence visit only
      expect(out.onSite).toBe(false);
    });

    test('a breadcrumb in the last ten minutes is what makes it live', async () => {
      const out = await page.evaluate(async () => {
        const realSupa = _supa, realUser = _supaUser;
        _supaUser = { id: 'u-owner' };
        _supa = { from: (t) => ({ select: () => ({ eq: () => ({ gte: async () => ({
          data: t === 'location_pings' ? [{ employee_user_id: 'u-luis', job_id: '810', ts: new Date().toISOString() }] : [] }) }) }) }) };
        try {
          _dispatchStatusAt = 0;
          await _dispatchLoadStatus(true);
          return _dispatchStatus['810'];
        } finally { _supa = realSupa; _supaUser = realUser; }
      });
      expect(out.onSite).toBe(true);
      expect(out.who).toBe('Luis Kane');
    });

    test('offline keeps the last known status instead of blanking the board', async () => {
      // Losing signal is exactly when a dispatcher most wants to see where
      // everyone last was. Clearing on no-backend also silently emptied any
      // fixture a caller had just set, which is how this was found.
      const out = await page.evaluate(async () => {
        const realUser = _supaUser;
        __seedBoard({ status: { '801': { onSite: true, first: null, last: null, mins: 20, who: 'Dave Ruiz' } } });
        _supaUser = null;
        try {
          _dispatchStatusAt = 0;
          await _dispatchLoadStatus(true);
          renderDispatch();
          return { rendered: !!document.getElementById('_dispatch-body'),
                   kept: !!(_dispatchStatus['801'] && _dispatchStatus['801'].onSite),
                   shown: document.querySelector('.dsp-card[data-job=\"801\"]').innerText };
        } finally { _supaUser = realUser; }
      });
      expect(out.rendered).toBe(true);
      expect(out.kept).toBe(true);
      expect(out.shown).toContain('On site now');
    });
  });

  test.describe('the timeline', () => {
    const seedDay = () => page.evaluate(() => {
      const at = (h, m) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
      __seedBoard({
        status: { '801': { onSite: false, first: at(8, 0), last: at(10, 30), mins: 150, who: 'Dave Ruiz' },
                  '810': { onSite: true, first: at(9, 0), last: null, mins: 60, who: 'Luis Kane' } },
        day: { 'e-dave': [{ jobId: '801', start: at(8, 0), end: at(10, 30) },
                          { jobId: '802', start: at(13, 0), end: at(15, 30) }],
               'e-luis': [{ jobId: '810', start: at(9, 0), end: at(10, 0) }] },
      });
      setDispatchView('timeline');
    });

    test('one strip per crew member, with their logged time', async () => {
      await seedDay();
      // innerText applies text-transform, and the crew name is uppercased for
      // display, so this compares what is RENDERED rather than what was written.
      const text = await page.evaluate(() => document.getElementById('_dispatch-body').innerText);
      expect(text).toMatch(/dave ruiz/i);
      expect(text).toMatch(/luis kane/i);
      expect(text).toContain('5h on site');    // 2h30 + 2h30
      expect(text).toContain('1h on site');
    });

    test('blocks sit where the clock says, not in list order', async () => {
      await seedDay();
      const out = await page.evaluate(() => {
        const first = document.querySelector('#_dispatch-body .dsp-strip');
        // .dsp-block only: the now-marker is also absolutely positioned, and
        // counting it as a job block is how "two jobs" reads as three.
        const blocks = [...first.querySelectorAll('.dsp-block')];
        const r = first.getBoundingClientRect();
        return blocks.map(b => {
          const br = b.getBoundingClientRect();
          return { leftPct: Math.round(((br.left - r.left) / r.width) * 100), w: Math.round(br.width) };
        });
      });
      expect(out.length).toBe(2);
      // The afternoon block starts to the right of the morning one, and both
      // have real width rather than collapsing to a hairline.
      expect(out[1].leftPct).toBeGreaterThan(out[0].leftPct);
      out.forEach(b => expect(b.w).toBeGreaterThan(2));
    });

    test('the window stretches for an early start rather than clipping it', async () => {
      // A 5:30am start must not fall off the left edge of its own strip.
      const out = await page.evaluate(() => {
        const at = (h, m) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
        __seedBoard({ day: { 'e-dave': [{ jobId: '801', start: at(5, 30), end: at(7, 0) }] } });
        setDispatchView('timeline');
        const strip = document.querySelector('#_dispatch-body .dsp-strip');
        const block = strip.querySelector('.dsp-block');
        const sr = strip.getBoundingClientRect(), br = block.getBoundingClientRect();
        return { left: Math.round(br.left - sr.left), right: Math.round(sr.right - br.right) };
      });
      expect(out.left).toBeGreaterThanOrEqual(0);
      expect(out.right).toBeGreaterThanOrEqual(0);
    });

    test('somebody with jobs but no logged time reads as not started', async () => {
      const text = await page.evaluate(() => {
        __seedBoard();
        setDispatchView('timeline');
        return document.getElementById('_dispatch-body').innerText;
      });
      expect(text).toContain('not started');
    });

    test('the view toggle switches both ways and survives a re-render', async () => {
      const out = await page.evaluate(() => {
        setDispatchView('timeline');
        const onTimeline = !!document.getElementById('_dispatch-body').innerText.match(/On site now|Logged today/);
        renderDispatch();
        const stillTimeline = _dispatchView === 'timeline';
        setDispatchView('crew');
        const backToCrew = !!document.querySelector('.dsp-card');
        setDispatchView('nonsense');
        return { onTimeline, stillTimeline, backToCrew, fellBack: _dispatchView };
      });
      expect(out.onTimeline).toBe(true);
      expect(out.stillTimeline).toBe(true);
      expect(out.backToCrew).toBe(true);
      expect(out.fellBack).toBe('crew');   // anything unrecognised is the safe view
    });

    test('nothing runs off a 390px screen in either view', async () => {
      const out = await page.evaluate(() => {
        const measure = () => {
          const body = document.getElementById('_dispatch-body');
          const wide = [...body.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length;
          return { wide, docW: document.documentElement.scrollWidth, vw: window.innerWidth };
        };
        setDispatchView('crew');
        const crew = measure();
        setDispatchView('timeline');
        const timeline = measure();
        return { crew, timeline };
      });
      expect(out.crew.wide).toBe(0);
      expect(out.timeline.wide).toBe(0);
      expect(out.crew.docW).toBeLessThanOrEqual(out.crew.vw + 1);
      expect(out.timeline.docW).toBeLessThanOrEqual(out.timeline.vw + 1);
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
