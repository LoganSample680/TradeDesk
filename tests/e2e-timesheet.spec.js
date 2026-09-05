// @ts-check
/**
 * Timesheet: review, submit, send (owner 2026-09-05, js/timesheet.js).
 *
 * The page is called what contractors call it. The week chart's button opens a
 * review of the week, every day a door into its rail; a day with a question
 * blocks submit; Submit and send is the one button; the text carries the stamp
 * and the link; the button becomes the stamp; a rejection comes back onto the
 * Needs-an-answer card and buzzes once.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { mountWeekBars } = require('./week-bars-fixture');

async function fakeNative(page) {
  await page.addInitScript(() => {
    const calls = [];
    window.__td = { calls };
    const rec = (name) => (args) => { calls.push({ name, args: args || {} }); return Promise.resolve({ ok: true }); };
    const TdNotify = { permission: () => Promise.resolve({ status: 'granted' }), request: () => Promise.resolve({ granted: true }),
      schedule: rec('schedule'), cancel: rec('cancel'), addListener: () => ({ remove() {} }) };
    window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => (n === 'TdNotify' ? TdNotify : {}), Plugins: { TdNotify } };
  });
}

// A fake Supabase: the RPC answers, and the table read answers with whatever
// the test seeded on window.__tsRows.
const FAKE_SUPA = () => {
  window.__rpc = [];
  window.__tsRows = window.__tsRows || [];
  window._supaUser = { id: 'e2e-user' };
  window._supa = {
    rpc: async (fn, args) => {
      window.__rpc.push([fn, args]);
      if (window.__rpcFail) return { data: null, error: { message: window.__rpcFail } };
      return { data: { token: 'tok_' + args.p_week_start, version: window.__rpcVersion || 1, submitted_at: '2026-09-05T23:42:00Z', status: 'submitted', week_start: args.p_week_start }, error: null };
    },
    from: () => { const q = { select: () => q, eq: () => q, then: (ok) => ok({ data: window.__tsRows, error: null }) }; return q; },
  };
};

test.describe('Timesheet', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await fakeNative(page);
    await mockAllExternal(page);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    await mountWeekBars(page);
  });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      _tsReviewClose(); _tsByWeek = {}; _tsFor = null; _tsLoading = null;
      window.__tsRows = []; window.__rpcFail = null; window.__rpcVersion = 1; window.__td.calls.length = 0;
      localStorage.removeItem('zp3_ts_seen');
      window.pwaShare = async (a) => { (window.__shared = window.__shared || []).push(a); }; window.__shared = [];
    });
    await page.evaluate(FAKE_SUPA);
  });
  test.afterEach(() => { assertNoErrors(page, 'timesheet'); });

  test.describe('the name', () => {
    test('the page, the tab and the menu say Timesheet, not Time Log', async () => {
      const r = await page.evaluate(() => ({
        title: document.querySelector('#pg-timelog .tbar-title').textContent.trim(),
        tab: document.querySelector('#nb-timelog span').textContent.trim(),
        menu: document.getElementById('mmi-timelog').textContent.trim(),
        old: /Time Log/.test(document.getElementById('pg-timelog').textContent) || /Time Log/.test(document.getElementById('nb-timelog').textContent),
      }));
      expect(r.title).toBe('Timesheet');
      expect(r.tab).toBe('Timesheet');
      expect(r.menu).toBe('Timesheet');
      expect(r.old).toBe(false);
    });
    test('the text says Timesheet too', async () => {
      const t = await page.evaluate(() => _tlWeekShareText(_tlLastRows.filter(r => _tlWeekKey(r.date) === _tlDrill.wk), _tlDrill.wk));
      expect(t.startsWith('Timesheet, Aug 23')).toBe(true);
    });
  });

  test.describe('the review', () => {
    test('the button opens the review: the eyebrow, every worked day as a door with its hours, the total, one Submit', async () => {
      const r = await page.evaluate(() => {
        const opened = _tsReviewOpen(_tlDrill.wk);
        const s = document.getElementById('ts-review');
        return { opened, shown: !!s, eyebrow: s.querySelector('.ts-eyebrow').textContent.trim(), title: s.querySelector('.zmodal-title').textContent.trim(),
          days: [...s.querySelectorAll('.ts-day')].map(b => ({ l: b.querySelector('.ts-day-l').textContent.trim(), h: b.querySelector('.ts-day-h').textContent.trim(), chev: !!b.querySelector('.ts-day-chev') })),
          total: s.querySelector('.ts-total b').textContent.trim(), split: s.querySelector('.ts-split').textContent,
          btns: [...s.querySelectorAll('.ts-btns button')].map(b => b.textContent.trim()),
          submitOn: !document.getElementById('ts-submit').disabled,
          sub: s.querySelector('.ts-sub').textContent };
      });
      expect(r.opened).toBe(true);
      expect(r.shown).toBe(true);
      expect(r.eyebrow).toBe('Timesheet');
      expect(r.title).toBe('Aug 23 to 29');
      // The fixture week has hours Tue to Sat and a hole on Wednesday.
      expect(r.days.map(d => d.l.replace(/Needs an answer/, '').trim())).toEqual(['Tue, Aug 25', 'Wed, Aug 26', 'Thu, Aug 27', 'Fri, Aug 28', 'Sat, Aug 29']);
      expect(r.days.every(d => d.chev)).toBe(true);
      expect(r.days[2].h).toBe('9h 54m');
      expect(r.total).toBe('39h 27m');
      expect(r.split).toContain('On site');
      expect(r.btns).toEqual(['Submit and send', 'Cancel']);
      expect(r.sub).toBe('Check each day, then submit. Submitted hours are locked. Fix a day later and submit it again.');
      // No manager-reopen copy, no send-without-submitting (owner 2026-09-05).
      expect(r.sub).not.toMatch(/manager|reopen/i);
      expect(r.btns.join(' ')).not.toMatch(/without/i);
      // Wednesday's hole blocks it.
      expect(r.submitOn).toBe(false);
    });

    test('a day with a question is flagged and names itself under the button; answer it and Submit is live', async () => {
      const r = await page.evaluate(() => {
        _tsReviewOpen(_tlDrill.wk);
        const s = document.getElementById('ts-review');
        const flagged = [...s.querySelectorAll('.ts-day.blocked .ts-day-l')].map(e => e.textContent.trim());
        const why = s.querySelector('.ts-why').textContent.trim();
        _tsReviewClose();
        // Answer the hole: take the unaccounted rows out of the week (as a
        // real answer on the rail would) and open again.
        const saved = _tlLastRows;
        _tlLastRows = saved.filter(r => !(r.source === 'unaccounted' && r.date === '2026-08-26'));
        _tsReviewOpen(_tlDrill.wk);
        const s2 = document.getElementById('ts-review');
        const out = { flagged, why, live: !document.getElementById('ts-submit').disabled, why2: !!s2.querySelector('.ts-why') };
        _tlLastRows = saved; _tsReviewClose();
        return out;
      });
      expect(r.flagged).toEqual(['Wed, Aug 26Needs an answer']);
      expect(r.why).toBe('Answer Wednesday to submit');
      expect(r.live).toBe(true);
      expect(r.why2).toBe(false);
    });

    test('a held visit blocks it the same way', async () => {
      const r = await page.evaluate(() => {
        const rows = [{ date: '2026-08-25', minutes: 60, source: 'auto', rawSource: 'client-held', unpaid: true, startTime: '2026-08-25T22:00:00Z', endTime: '2026-08-25T23:00:00Z' },
                      { date: '2026-08-25', minutes: 120, source: 'auto', rawSource: 'geofence', startTime: '2026-08-25T14:00:00Z', endTime: '2026-08-25T16:00:00Z' }];
        return _tsBlockers(rows);
      });
      expect(r).toEqual(['2026-08-25']);
    });

    test('tapping a day closes the review and opens that day on the rail', async () => {
      const r = await page.evaluate(() => {
        _tsReviewOpen(_tlDrill.wk);
        [...document.querySelectorAll('.ts-day')].find(b => /Thu, Aug 27/.test(b.textContent)).click();
        const out = { sheet: !!document.getElementById('ts-review'), level: _tlDrill.level, day: _tlDrill.day };
        _tlDrillTo('week', '2026-08-23');
        return out;
      });
      expect(r.sheet).toBe(false);
      expect(r.level).toBe('day');
      expect(r.day).toBe('2026-08-27');
    });

    test('nothing to review: a toast, no sheet', async () => {
      const r = await page.evaluate(() => {
        const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
        try { const o = _tsReviewOpen('2001-01-07'); return { o, toasts, sheet: !!document.getElementById('ts-review') }; }
        finally { window.showToast = t; }
      });
      expect(r.o).toBe(false);
      expect(r.sheet).toBe(false);
      expect(r.toasts).toEqual(['No hours logged that week yet']);
    });
  });

  test.describe('submit and send', () => {
    const unblock = () => page.evaluate(() => { window.__savedRows = _tlLastRows; _tlLastRows = _tlLastRows.filter(r => r.source !== 'unaccounted'); });
    const reblock = () => page.evaluate(() => { if (window.__savedRows) _tlLastRows = window.__savedRows; });

    test('the RPC gets the account, the week, the paid minutes, the names and the zone; the text gets the stamp and the link; the sheet closes', async () => {
      await unblock();
      try {
        const r = await page.evaluate(async () => {
          S.bname = 'Sample Plumbing'; S.ownerName = 'Jack Sample';
          localStorage.setItem('zp3_uname_e2e-user', 'Jack Sample');
          _tsReviewOpen(_tlDrill.wk);
          const text = await _tsSubmit(_tlDrill.wk);
          return { rpc: window.__rpc, text, shared: window.__shared, sheet: !!document.getElementById('ts-review'), cached: _tsByWeek[_tlDrill.wk] };
        });
        expect(r.rpc.length).toBe(1);
        expect(r.rpc[0][0]).toBe('timesheet_submit');
        expect(r.rpc[0][1]).toMatchObject({ p_contractor: 'e2e-user', p_week_start: '2026-08-23', p_total_min: 39 * 60 + 27, p_business_name: 'Sample Plumbing', p_person_name: 'Jack Sample', p_biz_tz: 'America/Chicago' });
        expect(r.shared.length).toBe(1);
        expect(r.shared[0].title).toBe('Timesheet');
        expect(r.text).toBe(r.shared[0].text);
        expect(r.text).toMatch(/^Timesheet, Aug 23/);
        expect(r.text).toContain('Total: 39h 27m');
        expect(r.text).toMatch(/\nSubmitted by Jack Sample, Sep 5, \d{1,2}:\d{2} (AM|PM)\n/);
        expect(r.text.trim().split('\n').pop()).toBe(location_origin_placeholder());
        expect(r.sheet).toBe(false);
        expect(r.cached).toMatchObject({ status: 'submitted', token: 'tok_2026-08-23', version: 1 });
      } finally { await reblock(); }
      function location_origin_placeholder() { return 'http://localhost:8899/timesheet.html?t=tok_2026-08-23'; }
    });

    test('a corrected week says so in the text', async () => {
      await unblock();
      try {
        const r = await page.evaluate(async () => { window.__rpcVersion = 2; return _tsSubmit(_tlDrill.wk); });
        expect(r).toContain('Corrected timesheet. Submitted by');
      } finally { await reblock(); }
    });

    test('the server refusing: no text goes out, the sheet stays, the person is told', async () => {
      await unblock();
      try {
        const r = await page.evaluate(async () => {
          const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
          try {
            _tsReviewOpen(_tlDrill.wk);
            window.__rpcFail = 'timesheet_submit: answer the held visits first';
            const a = await _tsSubmit(_tlDrill.wk);
            window.__rpcFail = 'boom';
            const b = await _tsSubmit(_tlDrill.wk);
            return { a, b, toasts, shared: window.__shared.length, sheet: !!document.getElementById('ts-review'), btnOn: !document.getElementById('ts-submit').disabled };
          } finally { window.showToast = t; }
        });
        expect(r.a).toBe(false);
        expect(r.b).toBe(false);
        expect(r.toasts).toEqual(['Answer the held visits first', 'Could not submit, try again']);
        expect(r.shared).toBe(0);
        expect(r.sheet).toBe(true);
        expect(r.btnOn).toBe(true);
      } finally { await reblock(); }
    });

    test('a question still open: submit refuses before it ever asks the server', async () => {
      const r = await page.evaluate(async () => {
        const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
        try { const a = await _tsSubmit(_tlDrill.wk); return { a, toasts, rpc: window.__rpc.length }; } finally { window.showToast = t; }
      });
      expect(r.a).toBe(false);
      expect(r.rpc).toBe(0);
      expect(r.toasts).toEqual(['Answer the open questions first']);
    });

    test('signed out: no submit', async () => {
      const r = await page.evaluate(async () => {
        const s = window._supa; window._supa = null;
        const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
        try { const a = await _tsSubmit(_tlDrill.wk); return { a, toasts }; } finally { window._supa = s; window.showToast = t; }
      });
      expect(r.a).toBe(false);
    });
  });

  test.describe('the stamp on the chart', () => {
    test('nothing submitted: Send this week. Submitted, approved, sent back: the state, still a button into the review', async () => {
      const r = await page.evaluate(() => {
        const wk = _tlDrill.wk;
        const out = {};
        out.none = _tsWeekButtonHtml(wk);
        _tsFor = 'e2e-user';
        _tsByWeek[wk] = { status: 'submitted', submitted_at: '2026-09-05T23:42:00Z', version: 1 }; out.sub = _tsWeekButtonHtml(wk);
        _tsByWeek[wk] = { status: 'submitted', submitted_at: '2026-09-05T23:42:00Z', version: 2 }; out.sub2 = _tsWeekButtonHtml(wk);
        _tsByWeek[wk] = { status: 'approved', approved_at: '2026-09-06T01:10:00Z', approved_name: 'Dad' }; out.ok = _tsWeekButtonHtml(wk);
        _tsByWeek[wk] = { status: 'rejected', rejected_at: '2026-09-06T01:10:00Z', reject_note: 'Thursday should be 8' }; out.back = _tsWeekButtonHtml(wk);
        return out;
      });
      expect(r.none).toContain('Send this week');
      expect(r.none).toContain('_tlShareWeekAt');
      expect(r.sub).toContain('Submitted Sep 5,');
      expect(r.sub).toContain('tl-wbar-stamp ok');
      expect(r.sub).not.toContain('corrected');
      expect(r.sub2).toContain('corrected');
      expect(r.ok).toContain('Approved by Dad');
      expect(r.back).toContain('Sent back: Thursday should be 8');
      expect(r.back).toContain('Fix and resubmit');
      expect(r.back).toContain('tl-wbar-stamp back');
      for (const k of ['sub', 'ok', 'back']) expect(r[k]).toContain('_tlShareWeekAt');
    });

    test('the week chart draws the stamp once the table has answered, and asks the table once', async () => {
      const r = await page.evaluate(async () => {
        window.__tsRows = [{ week_start: '2026-08-23', status: 'submitted', version: 1, token: 'tok', submitted_at: '2026-09-05T23:42:00Z' }];
        _tlDrillTo('week', '2026-08-23');
        const before = document.querySelector('.tl-wbar-share').textContent.trim();
        await _tsLoad();
        renderTimeLog({ cached: true });
        await new Promise(r2 => setTimeout(r2, 50));
        const after = document.querySelector('.tl-wbar-share').textContent.trim();
        return { before, after, loads: _tsFor };
      });
      expect(r.before).toContain('Send this week');
      expect(r.after).toContain('Submitted Sep 5');
      expect(r.loads).toBe('e2e-user');
    });

    test('the review says Submit again on a submitted week and shows the note on a sent-back one', async () => {
      const r = await page.evaluate(() => {
        const wk = _tlDrill.wk;
        _tsFor = 'e2e-user';
        _tsByWeek[wk] = { status: 'submitted', submitted_at: '2026-09-05T23:42:00Z', version: 1 };
        _tsReviewOpen(wk);
        const again = document.getElementById('ts-submit').textContent.trim();
        _tsReviewClose();
        _tsByWeek[wk] = { status: 'rejected', reject_note: 'Thursday should be 8' };
        _tsReviewOpen(wk);
        const note = document.querySelector('#ts-review .ts-note').textContent.trim();
        _tsReviewClose();
        return { again, note };
      });
      expect(r.again).toBe('Submit again and send');
      expect(r.note).toBe('Sent back: Thursday should be 8');
    });
  });

  test.describe('a rejection comes back', () => {
    test('the Needs-an-answer card gets a section naming the week and the note, with one door, and the phone buzzes once', async () => {
      const r = await page.evaluate(async () => {
        window.__tsRows = [{ week_start: '2026-08-23', status: 'rejected', version: 1, token: 'tok', rejected_at: '2026-09-06T01:10:00Z', reject_note: 'Thursday should be 8' }];
        _renderDashTsHold();
        await _tsLoading; await new Promise(r2 => setTimeout(r2, 30));
        const el = document.getElementById('dash-ts-hold');
        const shell = document.getElementById('dash-hold');
        const first = { shown: el.style.display !== 'none', text: el.textContent, btns: [...el.querySelectorAll('button')].map(b => b.textContent.trim()),
          count: document.getElementById('dash-hold-count').textContent.trim(), shell: shell.style.display !== 'none',
          sched: window.__td.calls.filter(c => c.name === 'schedule').map(c => c.args) };
        // Again: same rejection, no second buzz.
        _renderDashTsHold(); await _tsLoading; await new Promise(r2 => setTimeout(r2, 30));
        const sched2 = window.__td.calls.filter(c => c.name === 'schedule').length;
        // Resubmitted: the section goes.
        window.__tsRows = [{ week_start: '2026-08-23', status: 'submitted', version: 2, token: 'tok' }];
        await _tsLoad(true); _renderDashTsHold(); await _tsLoading; await new Promise(r2 => setTimeout(r2, 30));
        return { first, sched2, gone: el.style.display === 'none', shellGone: shell.style.display === 'none' };
      });
      expect(r.first.shown).toBe(true);
      expect(r.first.text).toContain('Timesheet sent back');
      expect(r.first.text).toContain('Aug 23 to 29');
      expect(r.first.text).toContain('Thursday should be 8');
      expect(r.first.btns).toEqual(['Fix and resubmit']);
      expect(r.first.count).toBe('1 held');
      expect(r.first.shell).toBe(true);
      expect(r.first.sched.length).toBe(1);
      expect(r.first.sched[0]).toMatchObject({ id: 'ts:back:2026-08-23', title: 'Timesheet sent back' });
      expect(r.first.sched[0].body).toContain('Thursday should be 8');
      expect(r.sched2).toBe(1);
      expect(r.gone).toBe(true);
      expect(r.shellGone).toBe(true);
    });

    test('Fix and resubmit lands on that week of the Timesheet', async () => {
      const r = await page.evaluate(async () => {
        _tlDrillTo('day', '2026-08-27');
        _tsGoFix('2026-08-23');
        await new Promise(r2 => setTimeout(r2, 120));
        return { pg: document.getElementById('pg-timelog').classList.contains('active'), level: _tlDrill.level, wk: _tlDrill.wk };
      });
      expect(r.pg).toBe(true);
      expect(r.level).toBe('week');
      expect(r.wk).toBe('2026-08-23');
    });
  });

  test.describe('hardening (§11.1)', () => {
    test('junk in never throws', async () => {
      const r = await page.evaluate(async () => {
        try {
          _tsBlockers(null); _tsBlockers([null, {}, 'x']); _tsWeekButtonHtml(null); _tsWeekButtonHtml(''); _tsReviewOpen(null); _tsReviewOpen('nope');
          _tsReviewDay(null); _tsReviewDay('junk'); _paintDashTsHold(null, null); _paintDashTsHold(document.getElementById('dash-ts-hold'), [null, {}, 'x']);
          localStorage.setItem('zp3_ts_seen', '{INVALID{{'); _tsSeen(); _tsRange(null); _tsWhen('nope'); _tsDayName('x');
          await _tsSubmit(null);
          return true;
        } catch (e) { return String(e); }
      });
      expect(r).toBe(true);
    });
    test('the status cache belongs to one login: another uid sees nothing of it', async () => {
      const r = await page.evaluate(() => {
        _tsFor = 'someone-else'; _tsByWeek['2026-08-23'] = { status: 'approved' };
        return _tsWeekButtonHtml('2026-08-23');
      });
      expect(r).toContain('Send this week');
    });
    test('concurrent loads share one request', async () => {
      const r = await page.evaluate(async () => {
        let n = 0; const s = window._supa;
        window._supa = { from: () => { n++; const q = { select: () => q, eq: () => q, then: (ok) => ok({ data: [], error: null }) }; return q; }, rpc: s.rpc };
        _tsFor = null; _tsByWeek = {};
        await Promise.all([_tsLoad(true), _tsLoad(true), _tsLoad(true)]);
        window._supa = s;
        return n;
      });
      expect(r).toBe(1);
    });
  });
});
