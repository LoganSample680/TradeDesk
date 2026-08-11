// @ts-check
// ── Local notifications (owner 2026-08-11) ───────────────────────────────────
// Scheduled ON the phone: no server, no push cost, and they fire with no
// signal. Everything decided here is JS, so the rules are testable and
// tunable without an iOS build. What these lock down:
//   • a notification storm never happens (one per day, not one per job)
//   • ids are stable, so re-scheduling REPLACES instead of stacking
//   • nothing is ever scheduled without permission
//   • the arrival tap-back fires once per arrival, not once per GPS ping
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Local notifications', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('tomorrow: one notification naming the first job, never one per job', async () => {
    const r = await page.evaluate(() => {
      const saved = jobs.slice();
      try {
        const now = new Date(2026, 7, 10, 12, 0, 0).getTime();      // Aug 10 2026, noon
        jobs.length = 0;
        jobs.push(
          { id: 7001, name: 'Miller repaint', start: '2026-08-11', time: '13:00', status: 'upcoming' },
          { id: 7002, name: 'Oak St trim', start: '2026-08-11', time: '07:30', status: 'upcoming' },
          { id: 7003, name: 'Next week', start: '2026-08-18', time: '09:00', status: 'upcoming' },
          { id: 7004, name: 'Cancelled one', start: '2026-08-11', time: '06:00', status: 'canceled' },
        );
        const t = _notifyTomorrowJobs(now);
        return { id: t.id, title: t.title, body: t.body, at: new Date(t.atMs).getHours(), atDay: new Date(t.atMs).getDate() };
      } finally { jobs.length = 0; saved.forEach(j => jobs.push(j)); }
    });
    expect(r.title, 'the EARLIEST job leads, not the first in the array').toContain('Oak St trim');
    expect(r.title, 'with its start time in plain English').toContain('7:30am');
    expect(r.body, 'two real jobs, the cancelled one ignored').toContain('2 jobs');
    expect(r.body).toContain('+1 more');
    expect(r.at, 'the evening before, 7pm').toBe(19);
    expect(r.atDay, 'scheduled on the 10th for the 11th').toBe(10);
    expect(r.id, 'the id carries the date so re-running replaces, never stacks').toBe('tomorrow:2026-08-11');
  });

  test('tomorrow: nothing scheduled when tomorrow is empty', async () => {
    const r = await page.evaluate(() => {
      const saved = jobs.slice();
      try {
        jobs.length = 0;
        jobs.push({ id: 7010, name: 'Today only', start: '2026-08-10', time: '09:00', status: 'upcoming' });
        return _notifyTomorrowJobs(new Date(2026, 7, 10, 12).getTime());
      } finally { jobs.length = 0; saved.forEach(j => jobs.push(j)); }
    });
    expect(r, 'a quiet tomorrow means silence').toBe(null);
  });

  test('overdue: one summary of everything owed, 14 days after completion', async () => {
    const r = await page.evaluate(() => {
      const savedBids = bids.slice(), savedPay = payments.slice();
      try {
        const now = new Date(2026, 7, 10).getTime();
        bids.length = 0;
        bids.push(
          { id: 8001, status: 'Closed Won', amount: 4000, completion_date: '2026-06-01' }, // 70 days late
          { id: 8002, status: 'Closed Won', amount: 1500, completion_date: '2026-08-05' }, // 5 days: not late yet
          { id: 8003, status: 'Closed Won', amount: 2000, completion_date: '2026-05-01' }, // late but PAID below
          { id: 8004, status: 'Draft', amount: 9999, completion_date: '2026-01-01' },      // never won
        );
        // Paid means payment RECORDS, not a field on the bid: getBidBalance
        // subtracts getBidPaid(id), so this is what "settled up" looks like.
        payments.length = 0;
        payments.push({ id: 9500, bid_id: 8003, amount: 2000, date: '2026-05-15' });
        const o = _notifyOverdue(now);
        return { id: o.id, title: o.title, body: o.body, at: o.atMs };
      } finally { bids.length = 0; savedBids.forEach(b => bids.push(b)); payments.length = 0; savedPay.forEach(p => payments.push(p)); }
    });
    expect(r.title, 'only the genuinely late, unpaid, won job').toContain('4,000');
    expect(r.body).toContain('1 job past due');
    expect(r.body, 'says how stale the oldest is').toContain('70 days');
    expect(r.at, 'overdue money is now, not scheduled').toBe(0);
    expect(r.id, 'one per day at most').toBe('overdue:2026-08-10');
  });

  test('overdue: silent when nothing is actually late', async () => {
    const r = await page.evaluate(() => {
      const saved = bids.slice();
      try {
        bids.length = 0;
        bids.push({ id: 8020, status: 'Closed Won', amount: 500, completion_date: '2026-08-09' });
        return _notifyOverdue(new Date(2026, 7, 10).getTime());
      } finally { bids.length = 0; saved.forEach(b => bids.push(b)); }
    });
    expect(r).toBe(null);
  });

  test('nothing is ever scheduled without permission, and no plugin is silent', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, savedJobs = jobs.slice();
      const scheduled = [];
      try {
        jobs.length = 0;
        jobs.push({ id: 7100, name: 'Tomorrow job', start: '2026-08-11', time: '08:00', status: 'upcoming' });
        // denied
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            permission: () => Promise.resolve({ status: 'denied' }),
            schedule: (o) => { scheduled.push(o.id); return Promise.resolve({ scheduled: true }); },
          }),
        };
        const denied = await _notifyRefresh(new Date(2026, 7, 10, 12).getTime());
        const afterDenied = scheduled.length;
        // granted
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            permission: () => Promise.resolve({ status: 'granted' }),
            schedule: (o) => { scheduled.push(o.id); return Promise.resolve({ scheduled: true }); },
          }),
        };
        const granted = await _notifyRefresh(new Date(2026, 7, 10, 12).getTime());
        // no plugin at all
        window.Capacitor = undefined;
        const none = await _notifyRefresh(new Date(2026, 7, 10, 12).getTime());
        return { denied: denied.scheduled, afterDenied, granted: granted.scheduled, none: none.scheduled, ids: scheduled };
      } finally { window.Capacitor = realCap; jobs.length = 0; savedJobs.forEach(j => jobs.push(j)); }
    });
    expect(r.denied, 'denied means nothing is scheduled').toBe(0);
    expect(r.afterDenied, 'and the plugin is never even called to schedule').toBe(0);
    expect(r.granted, 'granted schedules the tomorrow reminder').toBeGreaterThanOrEqual(1);
    expect(r.none, 'a browser has nothing to schedule to').toBe(0);
  });

  test('arrival fires once per arrival, and re-arms after leaving', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const fired = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            permission: () => Promise.resolve({ status: 'granted' }),
            schedule: (o) => { fired.push(o.title); return Promise.resolve({ scheduled: true }); },
          }),
        };
        await _notifyArrival('Sarah Miller', 'Oak St repaint');
        await _notifyArrival('Sarah Miller', 'Oak St repaint');  // same id: replaces, never stacks
        return { fired };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.fired.length).toBe(2);
    expect(r.fired[0], 'names the client, not a coordinate').toContain('Sarah Miller');
  });

  test('time formatting reads like a person wrote it', async () => {
    const r = await page.evaluate(() => ({
      morning: _notifyPrettyTime('07:30'),
      noon: _notifyPrettyTime('12:00'),
      afternoon: _notifyPrettyTime('13:45'),
      midnight: _notifyPrettyTime('00:15'),
      onTheHour: _notifyPrettyTime('09:00'),
      junk: _notifyPrettyTime('nonsense'),
      empty: _notifyPrettyTime(''),
    }));
    expect(r.morning).toBe('7:30am');
    expect(r.noon).toBe('12pm');
    expect(r.afternoon).toBe('1:45pm');
    expect(r.midnight).toBe('12:15am');
    expect(r.onTheHour, 'no pointless :00').toBe('9am');
    expect(r.junk).toBe('nonsense');
    expect(r.empty).toBe('');
  });

  test('no console errors during notification tests', async () => {
    assertNoErrors(page, 'local notifications');
  });
});
