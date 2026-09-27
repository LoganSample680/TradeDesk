// @ts-check
// What you owe this week (owner 2026-09-27, "go fix it all").
//
// Earl, 58, iPhone SE, on a Friday: what do I owe each of my three guys?
// Payroll counted unpaid rows (Mike's 45-minute unanswered gap became
// overtime, Joe's lunches pushed him to 40h), treated a 1099 sub as W-2,
// paid a crew member who had not joined yet for the OWNER's clock, and Crew
// Cost disagreed with all of it (last 7 days, per-day "OT 5d", no premium).
// One pay function now (_payPersonPeriod) and every screen calls it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Sun 2026-09-20 to Sat 2026-09-26.
const WK = '2026-09-20';
const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];

const EMPS = [
  { id: 1, name: 'Mike Rowe', role: 'tech', email: 'mike@x.com', employee_user_id: 'u-mike', classification: 'Journeyman' },
  { id: 2, name: 'Joe Dunn', role: 'tech', email: 'joe@x.com', employee_user_id: 'u-joe', classification: '' },
  { id: 3, name: 'Sam Pike', role: 'tech', email: 'sam@x.com', employee_user_id: 'u-sam', classification: 'Subcontractor' },
  { id: 4, name: 'New Guy', role: 'tech', email: 'new@x.com', employee_user_id: null, classification: '' },
];
const COMP = {
  'mike@x.com': { pay_type: 'hourly', pay_rate: 22 },
  'joe@x.com': { pay_type: 'hourly', pay_rate: 25 },
  'sam@x.com': { pay_type: 'hourly', pay_rate: 30 },
  'new@x.com': { pay_type: 'hourly', pay_rate: 20 },
};
// Rows in the Time Log's own shape (js/timelog.js _timeLogRows).
function weekRows(days) {
  const rows = [];
  days.forEach((d, i) => {
    // Mike: 9h a day = 45h paid, plus one 45-minute hole nobody answered.
    rows.push({ personUid: 'u-mike', date: d, minutes: 540, source: 'auto', unpaid: false });
    if (i === 0) rows.push({ personUid: 'u-mike', date: d, minutes: 45, source: 'unaccounted', unpaid: true });
    // Joe: 7.5h paid + a 30-minute unpaid lunch a day = 37.5h paid, 40h on the clock.
    rows.push({ personUid: 'u-joe', date: d, minutes: 450, source: 'manual', unpaid: false });
    rows.push({ personUid: 'u-joe', date: d, minutes: 30, source: 'manual', unpaid: true, detail: 'Break (unpaid)' });
    // Sam (1099): 8.4h a day = 42h.
    rows.push({ personUid: 'u-sam', date: d, minutes: 504, source: 'auto', unpaid: false });
    // The owner's own manual clock: personUid null. Nobody else may be paid for it.
    rows.push({ personUid: null, date: d, minutes: 480, source: 'manual', unpaid: false });
  });
  return rows;
}

async function boot(page, opts) {
  await mockAllExternal(page);
  await page.goto('/index.html');
  await waitForAppBoot(page);
  await page.evaluate(({ emps, comp, rows, canComp }) => {
    S.employees = emps;
    _teamComp = comp;
    _teamCompLoaded = true;
    window._canViewComp = () => canComp;
    window._timeLogRows = async () => rows;
  }, { emps: EMPS, comp: COMP, rows: weekRows(DAYS), canComp: opts && opts.canComp === false ? false : true });
}

test.describe('the one pay function', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'pay week'); });

  test('unpaid gap and unpaid break are excluded, weekly OT at 1.5x to the cent', async ({ page }) => {
    const r = await page.evaluate(async (wk) => {
      const b = await _paySummaryBuild(wk, '2026-09-26', 'weekly');
      const by = {}; b.rows.forEach(x => { by[x.employee.name] = x; });
      return { mike: by['Mike Rowe'], joe: by['Joe Dunn'], sam: by['Sam Pike'], newGuy: by['New Guy'], totals: b.totals };
    }, WK);
    // Old code: 45.75h -> $1,069.75 (the gap became OT). Owed: 40h x $22 + 5h x $33.
    expect(r.mike.regMin).toBe(2400);
    expect(r.mike.otMin).toBe(300);
    expect(r.mike.grossWages).toBe(1045);
    expect(r.mike.otPremium).toBe(55);
    // Old code: 40h -> $1,000 (lunches counted). Owed: 37.5h x $25.
    expect(r.joe.regMin).toBe(2250);
    expect(r.joe.otMin).toBe(0);
    expect(r.joe.grossWages).toBe(937.5);
    expect(r.joe.liab.employeeFica).toBeGreaterThan(0);
  });

  test('a 1099 sub is hours x rate: no overtime, no tax lines', async ({ page }) => {
    const r = await page.evaluate(async (wk) => {
      const b = await _paySummaryBuild(wk, '2026-09-26', 'weekly');
      const sam = b.rows.find(x => x.employee.name === 'Sam Pike');
      const html = _paySummaryRowHTML(sam);
      return { sam, html, subPay: b.totals.subPay };
    }, WK);
    expect(r.sam.kind).toBe('1099');
    expect(r.sam.otMin).toBe(0);
    expect(r.sam.grossWages).toBe(1260);   // 42h x $30, no premium
    expect(r.sam.liab).toBeNull();
    expect(r.subPay).toBe(1260);
    expect(r.html).not.toContain('FICA');
    expect(r.html).not.toContain('FUTA');
    expect(r.html).toContain('1099');
  });

  test('a crew member with no login yet is never paid for the owner\'s clock', async ({ page }) => {
    const r = await page.evaluate(async (wk) => {
      const b = await _paySummaryBuild(wk, '2026-09-26', 'weekly');
      const ng = b.rows.find(x => x.employee.name === 'New Guy');
      return { ng, html: _paySummaryRowHTML(ng) };
    }, WK);
    expect(r.ng.pending).toBe(true);
    expect(r.ng.paidMin).toBe(0);
    expect(r.ng.grossWages).toBe(0);
    expect(r.html).toContain("Hasn't joined yet");
    expect(r.html).not.toContain('Pay them');
  });

  test('_payPersonPeriod edge inputs', async ({ page }) => {
    const r = await page.evaluate(() => ({
      nul: _payPersonPeriod(null, null),
      empty: _payPersonPeriod([], { pay_type: 'hourly', pay_rate: 20 }),
      junk: _payPersonPeriod([null, 5, 'x', { date: 'bad', minutes: 'abc' }], { pay_rate: 'abc' }),
      boundary: _payPersonPeriod([{ date: '2026-09-21', minutes: 2400 }], { pay_type: 'hourly', pay_rate: 20 }),
      oneOver: _payPersonPeriod([{ date: '2026-09-21', minutes: 2401 }], { pay_type: 'hourly', pay_rate: 20 }),
      twoWeeks: _payPersonPeriod([{ date: '2026-09-14', minutes: 2460 }, { date: '2026-09-21', minutes: 2460 }], { pay_type: 'hourly', pay_rate: 20 }),
      salary: _payPersonPeriod([{ date: '2026-09-21', minutes: 3000 }], { pay_type: 'salary', pay_rate: 52000 }, { periodsPerYear: 52 }),
      owner: _payPersonPeriod([{ date: '2026-09-21', minutes: 3000 }], { pay_type: 'hourly', pay_rate: 20 }, { kind: 'owner' }),
      oldGone: typeof window._paySummaryWeeklySplit,
    }));
    expect(r.nul.wages).toBe(0);
    expect(r.empty).toMatchObject({ paidMin: 0, regMin: 0, otMin: 0, wages: 0 });
    expect(r.junk.wages).toBe(0);
    expect(r.boundary).toMatchObject({ regMin: 2400, otMin: 0, wages: 800 });
    expect(r.oneOver).toMatchObject({ regMin: 2400, otMin: 1 });
    expect(r.twoWeeks).toMatchObject({ regMin: 4800, otMin: 120 });   // no cross-week bleed
    expect(r.salary.wages).toBe(1000);                               // a paycheck, not hours
    expect(r.owner).toMatchObject({ otMin: 0, wages: 1000 });         // 50h x $20, no OT for himself
    // The old split that counted unpaid rows is deleted, not left beside it (§7).
    expect(r.oldGone).toBe('undefined');
  });
});

test.describe('what you owe this week', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'owe list'); });

  test('the list shows Pay them per person, the timesheet stamp, and Total cash needed separately', async ({ page }) => {
    const r = await page.evaluate(async (wk) => {
      const queried = [];
      const makeQ = (tbl) => {
        const q = { _f: {} };
        q.select = () => q; q.is = () => q;
        q.eq = (k, v) => { q._f[k] = v; return q; };
        q.then = (res, rej) => {
          queried.push({ tbl, f: q._f });
          const data = tbl === 'td_timesheets' ? [
            { employee_user_id: 'u-mike', week_start: wk, status: 'submitted', version: 1 },
            { employee_user_id: 'u-joe', week_start: wk, status: 'approved', version: 1 },
          ] : [];
          return Promise.resolve({ data, error: null }).then(res, rej);
        };
        return q;
      };
      _supa = { from: (t) => makeQ(t), rpc: async () => ({ data: null, error: null }) };
      await openPayOwe(wk);
      const ov = document.getElementById('pay-owe-ov');
      const cards = [...ov.querySelectorAll('.pay-person')].map(c => ({
        uid: c.getAttribute('data-uid'),
        them: (c.querySelector('.pay-them') || {}).textContent || '',
        ts: (c.querySelector('.pay-ts') || {}).textContent || '',
      }));
      return {
        title: ov.textContent.includes('What you owe this week'),
        cards,
        cash: (ov.querySelector('.pay-total-cash') || {}).textContent,
        them: (ov.querySelector('.pay-total-them') || {}).textContent,
        estimate: ov.textContent.includes('before income tax withholding'),
        tsQuery: queried.find(q => q.tbl === 'td_timesheets'),
      };
    }, WK);
    expect(r.title).toBe(true);
    const by = {}; r.cards.forEach(c => { by[c.uid] = c; });
    expect(by['u-mike'].them).toBe('$1,045.00');
    expect(by['u-mike'].ts).toBe('Submitted');
    expect(by['u-joe'].them).toBe('$937.50');
    expect(by['u-joe'].ts).toBe('Approved');
    expect(by['u-sam'].them).toBe('$1,260.00');
    expect(by['u-sam'].ts).toBe('Not sent yet');
    expect(r.them).toBe('$3,242.50');
    // Cash needed is Pay them plus the employer's FICA and FUTA on the W-2s only.
    const cash = Number(String(r.cash).replace(/[$,]/g, ''));
    expect(cash).toBeGreaterThan(3242.5);
    expect(r.estimate).toBe(true);
    // The owner reads the crew's rows for exactly this week.
    expect(r.tsQuery.f.week_start).toBe(WK);
  });

  test('at 375px nothing bleeds off the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const r = await page.evaluate(async (wk) => {
      await openPayOwe(wk);
      const box = document.querySelector('#pay-owe-ov .zmodal').getBoundingClientRect();
      const over = [...document.querySelectorAll('#pay-owe-ov .pay-person')]
        .filter(c => c.getBoundingClientRect().right > window.innerWidth + 1).length;
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, right: box.right, over };
    }, WK);
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.right).toBeLessThanOrEqual(r.iw + 1);
    expect(r.over).toBe(0);
  });
});

test.describe('Team timesheet carries the dollars, for the owner only', () => {
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'team owe'); });

  async function mountTeamNow(page) {
    // Rows dated in the CURRENT week (the pinned page clock decides it), so
    // the card's "this week" and the fixture agree whatever day CI runs.
    await page.evaluate(() => {
      const wk = _tlWeekKey(todayKey());
      window._timeLogRows = async () => [
        { personUid: 'u-mike', personName: 'Mike Rowe', date: wk, minutes: 2700, source: 'auto', unpaid: false },
        { personUid: 'u-mike', personName: 'Mike Rowe', date: wk, minutes: 45, source: 'unaccounted', unpaid: true },
        { personUid: 'u-joe', personName: 'Joe Dunn', date: wk, minutes: 2250, source: 'manual', unpaid: false },
      ];
      if (typeof goPg === 'function') goPg('pg-timelog');
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => { setTimeLogYear(Number(todayKey().slice(0, 4))); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { _tlDrill.uid = null; setTimeLogScope('team'); });
    await page.waitForTimeout(400);
  }

  test('owner: the entry sits at the top and each card says what that person is owed', async ({ page }) => {
    await boot(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await mountTeamNow(page);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('tl-owe-btn');
      const owes = [...document.querySelectorAll('.tl-emp-owe')].map(e => e.textContent);
      return {
        btn: btn ? btn.textContent : null,
        firstInList: btn ? btn === document.getElementById('tl-list').firstElementChild : false,
        owes,
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      };
    });
    expect(r.btn).toContain('What you owe this week');
    expect(r.btn).toContain('$1,982.50');          // 1,045.00 + 937.50
    expect(r.firstInList).toBe(true);
    expect(r.owes).toContain('Owes $1,045.00 this week');
    expect(r.owes).toContain('Owes $937.50 this week');
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    await page.locator('#tl-owe-btn').click();
    await expect(page.locator('#pay-owe-ov')).toBeVisible();
  });

  test('crew without pay permission never sees a dollar', async ({ page }) => {
    await boot(page, { canComp: false });
    await mountTeamNow(page);
    const r = await page.evaluate(async () => ({
      btn: !!document.getElementById('tl-owe-btn'),
      owes: document.querySelectorAll('.tl-emp-owe').length,
      map: _payOweWeekMap([{ personUid: 'u-mike', date: todayKey(), minutes: 600 }]),
      opened: await openPayOwe(),
      ov: !!document.getElementById('pay-owe-ov'),
      ts: await _tsCrewLoad('2026-09-20'),
    }));
    expect(r.btn).toBe(false);
    expect(r.owes).toBe(0);
    expect(r.map).toEqual({});
    expect(r.opened).toBe(false);
    expect(r.ov).toBe(false);
    expect(r.ts).toEqual({});
  });
});

test.describe('Crew Cost agrees with Payroll', () => {
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'crew cost'); });

  test('same week, same dollars, Sun to Sat, weekly OT with the premium', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const today = _bizDateStr(new Date());
      const wk = _tlWeekKey(today);
      const rows = [
        { personUid: 'u-mike', personName: 'Mike Rowe', date: today, minutes: 2700, source: 'auto', unpaid: false },
        { personUid: 'u-mike', personName: 'Mike Rowe', date: today, minutes: 45, source: 'unaccounted', unpaid: true },
        { personUid: 'u-joe', personName: 'Joe Dunn', date: today, minutes: 2250, source: 'manual', unpaid: false },
        { personUid: 'u-joe', personName: 'Joe Dunn', date: today, minutes: 150, source: 'manual', unpaid: true },
      ];
      window._timeLogRows = async () => rows;
      const makeQ = (data) => { const q = { _d: { data, error: null } }; q.then = (res, rej) => Promise.resolve(q._d).then(res, rej); ['select', 'eq', 'is', 'gte', 'lt', 'lte', 'not', 'order', 'limit'].forEach(k => { q[k] = () => q; }); return q; };
      const orig = { supa: _supa, supaUser: _supaUser, en: window.supaEnabled };
      _supa = { from: (t) => makeQ(t === 'team_members' ? [
        { employee_user_id: 'u-mike', name: 'Mike Rowe', email: 'mike@x.com', pay_type: 'hourly', pay_rate: 22 },
        { employee_user_id: 'u-joe', name: 'Joe Dunn', email: 'joe@x.com', pay_type: 'hourly', pay_rate: 25 },
      ] : []) };
      window.supaEnabled = () => true;
      _supaUser = _supaUser || { id: 'owner-test' };
      const pr = await _paySummaryBuild(wk, (() => { const d = new Date(wk + 'T00:00:00'); d.setDate(d.getDate() + 6); return dateKey(d); })(), 'weekly');
      document.getElementById('_crew-cost-ov')?.remove();
      _openCrewCost();
      await _crewCostRender('week');
      const body = document.getElementById('_crew-cost-body');
      const rowFor = n => [...body.children].find(c => (c.textContent || '').includes(n));
      const out = {
        ccMike: (rowFor('Mike Rowe')?.querySelector('.cc-pay') || {}).textContent,
        ccJoe: (rowFor('Joe Dunn')?.querySelector('.cc-pay') || {}).textContent,
        ot: (rowFor('Mike Rowe')?.querySelector('.cc-ot') || {}).textContent || '',
        oldFlag: /OT \d+d/.test(body.innerHTML),
        prMike: fmt(pr.rows.find(x => x.uid === 'u-mike').grossWages),
        prJoe: fmt(pr.rows.find(x => x.uid === 'u-joe').grossWages),
      };
      document.getElementById('_crew-cost-ov')?.remove();
      _supa = orig.supa; _supaUser = orig.supaUser; window.supaEnabled = orig.en;
      return out;
    });
    expect(r.prMike).toBe('$1,045.00');
    expect(r.prJoe).toBe('$937.50');
    expect(r.ccMike).toBe(r.prMike);
    expect(r.ccJoe).toBe(r.prJoe);
    expect(r.ot).toContain('5.0h overtime');
    expect(r.oldFlag).toBe(false);
  });
});
