// @ts-check
/**
 * Exhaustive E2E coverage for js/timelog.js — the Time Log page. Structure
 * mirrors Books exactly: year selector → month accordions (newest first,
 * current month open by default) → day accordions within each month (newest
 * first), reusing _bkTogMonth/_bkTogDay/_bkRenderDays from js/finance.js.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('timelog.js — exhaustive coverage', () => {
  let page;
  const thisYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);
  const curMonthPrefix = new Date().toISOString().slice(0, 7);
  const todayStr = new Date().toISOString().slice(0, 10);

  const SEED_FIXTURES_FN = () => {
    clients = clients.filter(c => c.id !== 89901 && c.id !== 89902);
    bids    = bids.filter(b => b.id !== 88801);
    jobs    = jobs.filter(j => j.id !== 87701 && j.id !== 87702);
    timeEntries = (timeEntries || []).filter(e => e.job_id !== 87701 && e.job_id !== 87702);

    clients.push(
      { id: 89901, name: 'Timelog Test Client', phone: '316-555-8001', addr: '1 Timelog St, Wichita KS 67202' },
      { id: 89902, name: 'Timelog No-Bid Client', phone: '316-555-8002', addr: '2 Timelog Ave, Wichita KS 67202' }
    );
    bids.push(
      { id: 88801, client_id: 89901, client_name: 'Timelog Test Client', amount: 2000, status: 'Closed Won', bid_date: '2026-01-01' }
    );
    jobs.push(
      { id: 87701, client_id: 89901, bid_id: 88801, name: 'Timelog job with bid', eventType: 'job', status: 'scheduled', start: '2099-06-01', actualHours: 0 },
      { id: 87702, client_id: 89902, bid_id: null, name: 'Timelog walk-up job', eventType: 'job', status: 'upcoming', start: '2099-06-02', actualHours: 0 }
    );
    const now = new Date();
    timeEntries.push(
      // Current month/day — this month's accordion should default open.
      { id: 8990001, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, scope_id: 'sand', scope_label: 'Sanding', logged_by_uid: null, logged_by_name: 'Owner (me)' },
      { id: 8990002, job_id: 87702, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 45, scope_id: null, scope_label: null, logged_by_uid: 'emp-test-uid', logged_by_name: 'Test Crew Member' },
      // A prior month, same year — proves month grouping/sorting works.
      { id: 8990003, job_id: 87701, date: `${new Date().getFullYear()}-01-05`, start_time: `${new Date().getFullYear()}-01-05T09:00:00Z`, end_time: `${new Date().getFullYear()}-01-05T10:00:00Z`, minutes: 60, scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Owner (me)' },
      // A prior year — proves the year selector filters correctly.
      { id: 8990004, job_id: 87701, date: `${new Date().getFullYear() - 1}-05-10`, start_time: `${new Date().getFullYear() - 1}-05-10T09:00:00Z`, end_time: `${new Date().getFullYear() - 1}-05-10T10:00:00Z`, minutes: 30, scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Owner (me)' }
    );
  };
  const seedFixtures = () => page.evaluate(() => window.__seedTimelogFixtures());

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(`window.__seedTimelogFixtures = ${SEED_FIXTURES_FN.toString()}`);
    await seedFixtures();
  });

  test.beforeEach(async () => {
    await seedFixtures();
    await page.evaluate(() => { _tlYear = null; });
  });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 89901 && c.id !== 89902);
      bids    = bids.filter(b => b.id !== 88801);
      jobs    = jobs.filter(j => j.id !== 87701 && j.id !== 87702);
      timeEntries = timeEntries.filter(e => e.job_id !== 87701 && e.job_id !== 87702);
    });
    await page.context().close();
  });

  test.describe('_tlJobClientInfo', () => {
    test('job with bid — resolves client name/addr through the bid', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87701));
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.addr).toBe('1 Timelog St, Wichita KS 67202');
    });

    test('job with no bid — resolves client directly via job.client_id', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87702));
      expect(r.clientName).toBe('Timelog No-Bid Client');
    });

    test('nonexistent jobId — returns em-dash placeholders, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlJobClientInfo(999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v.jobName).toBe('—');
    });

    test('null jobId — does not throw', async () => {
      const r = await page.evaluate(() => { try { _tlJobClientInfo(null); return true; } catch (e) { return false; } });
      expect(r).toBe(true);
    });
  });

  test.describe('_timeLogRows', () => {
    test('golden path — includes manual entries with resolved client/job info', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const mine = rows.find(x => x.id === 'm8990001');
        return mine ? { found: true, clientName: mine.clientName, source: mine.source, minutes: mine.minutes, personName: mine.personName } : { found: false };
      });
      expect(r.found).toBe(true);
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.source).toBe('manual');
      expect(r.minutes).toBe(90);
      expect(r.personName).toBe('Owner (me)');
    });

    test('carries logged_by_uid through as personUid (employee attribution)', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const theirs = rows.find(x => x.id === 'm8990002');
        return theirs ? { personUid: theirs.personUid, personName: theirs.personName } : null;
      });
      expect(r).toBeTruthy();
      expect(r.personUid).toBe('emp-test-uid');
      expect(r.personName).toBe('Test Crew Member');
    });

    test('sinceISO null — includes entries from every seeded year', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        return rows.filter(x => ['m8990001', 'm8990002', 'm8990003', 'm8990004'].includes(x.id)).length;
      });
      expect(r).toBe(4);
    });

    test('empty timeEntries and no crew data — resolves to empty array, no throw', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [];
        try { const rows = await _timeLogRows(null); return { ok: true, len: rows.length }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { timeEntries = orig; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBe(0);
    });

    test('concurrent calls — no throw, no corruption', async () => {
      const r = await page.evaluate(async () => {
        try {
          const results = await Promise.all([_timeLogRows(null), _timeLogRows(null), _timeLogRows(null)]);
          return { ok: true, allSameLength: results.every(x => x.length === results[0].length) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.allSameLength).toBe(true);
    });
  });

  test.describe('_tlYears', () => {
    test('golden path — distinct years, sorted newest first', async () => {
      const r = await page.evaluate(() => {
        const rows = [{ date: '2024-01-01' }, { date: '2026-05-01' }, { date: '2025-06-01' }, { date: '2026-08-01' }];
        return _tlYears(rows);
      });
      expect(r).toEqual(['2026', '2025', '2024']);
    });

    test('empty rows — falls back to the current calendar year', async () => {
      const r = await page.evaluate(() => _tlYears([]));
      expect(r).toEqual([String(new Date().getFullYear())]);
    });

    test('rows with missing/malformed dates — skipped, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlYears([{ date: '' }, { date: null }, { }, { date: 'not-a-date' }]) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual([String(new Date().getFullYear())]);
    });
  });

  test.describe('renderTimeLog', () => {
    test('missing #tl-list DOM — returns gracefully, no throw', async () => {
      const r = await page.evaluate(async () => {
        const el = document.getElementById('tl-list');
        const id = el ? el.id : null;
        if (el) el.id = 'tl-list-hidden-temp';
        try { await renderTimeLog(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el) el.id = id; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — year selector populated, current year shown, total in header', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-timelog');
        await renderTimeLog();
        const sel = document.getElementById('tl-year-sel');
        const opts = [...sel.options].map(o => o.value);
        return { opts, selected: sel.value, total: document.getElementById('tl-total').textContent };
      });
      expect(r.opts).toContain(thisYear);
      expect(r.opts).toContain(lastYear);
      expect(r.opts[0]).toBe(thisYear); // newest year first
      expect(r.selected).toBe(thisYear);
      expect(r.total).toContain('total');
    });

    test('current year — shows this year\'s entries, not last year\'s', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return document.getElementById('tl-list').innerHTML;
      });
      expect(r).toContain('Timelog Test Client');
      expect(r).toContain('Timelog No-Bid Client');
    });

    test('month accordions — newest month sorts first', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return [...document.querySelectorAll('.bk-month')].map(el => el.id);
      });
      // curMonthPrefix (e.g. bk-tl-mo-2026-07) should sort before bk-tl-mo-2026-01
      const idx = (yyyymm) => r.indexOf('bk-tl-mo-' + yyyymm);
      expect(idx(curMonthPrefix)).toBeGreaterThanOrEqual(0);
      expect(idx(`${new Date().getFullYear()}-01`)).toBeGreaterThan(idx(curMonthPrefix));
    });

    test('current month accordion is open by default', async () => {
      const r = await page.evaluate(async (curMo) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const el = document.getElementById('bk-tl-mo-' + curMo);
        return el ? el.classList.contains('open') : null;
      }, curMonthPrefix);
      expect(r).toBe(true);
    });

    test('day accordions within a month — newest day sorts first', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const monthEl = document.getElementById('bk-tl-mo-' + new Date().toISOString().slice(0, 7));
        return monthEl ? [...monthEl.querySelectorAll('.bk-day')].map(el => el.id) : [];
      });
      expect(r.length).toBeGreaterThan(0);
      // The current-day entry should appear in this month's day list.
      expect(r.some(id => id.includes(todayStr.replace(/-/g, '')))).toBe(true);
    });

    test('requesting a year with no data clamps back to the newest year that has data (matches Books\' own year-selector behavior)', async () => {
      // The dropdown itself only ever lists years present in the data (same as
      // Books' tracker-year-sel/getTrackerYears) — 1999 can never be a real
      // selection, so _tlPopulateYearSel snaps it back to years[0] rather than
      // rendering a state the UI can't otherwise reach.
      const r = await page.evaluate(async () => {
        setTimeLogYear(1999);
        await renderTimeLog();
        return { year: _tlYear, sel: document.getElementById('tl-year-sel').value };
      });
      expect(r.year).not.toBe('1999');
      expect(r.sel).not.toBe('1999');
    });

    test('no time entries at all — shows the empty state for the fallback (current) year', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [];
        _tlYear = null;
        try {
          await renderTimeLog();
          return { html: document.getElementById('tl-list').innerHTML, total: document.getElementById('tl-total').textContent, year: _tlYear };
        } finally { timeEntries = orig; }
      });
      expect(r.year).toBe(thisYear);
      expect(r.html).toContain('No time logged in ' + thisYear);
      expect(r.total).toBe('');
    });

    test('employee without payroll permission — sees only their own entries', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        return { hasOwn: html.includes('Timelog No-Bid Client'), hasOthers: html.includes('Timelog Test Client') };
      });
      expect(r.hasOwn).toBe(true);
      expect(r.hasOthers).toBe(false);
    });

    test('owner (non-employee) always sees everyone', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee;
        window._isEmployee = false;
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee;
        return html.includes('Timelog Test Client') && html.includes('Timelog No-Bid Client');
      });
      expect(r).toBe(true);
    });

    test('5 concurrent calls — no throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          await Promise.all([renderTimeLog(), renderTimeLog(), renderTimeLog(), renderTimeLog(), renderTimeLog()]);
          return true;
        } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('setTimeLogYear', () => {
    test('changes the selected year and re-renders', async () => {
      const r = await page.evaluate(async (ly) => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        setTimeLogYear(parseInt(ly));
        await new Promise(res => setTimeout(res, 50));
        return { year: _tlYear, sel: document.getElementById('tl-year-sel').value };
      }, lastYear);
      expect(r.year).toBe(lastYear);
    });

    test('numeric and string year both work', async () => {
      const r = await page.evaluate(async () => {
        try {
          setTimeLogYear(2026);
          await new Promise(res => setTimeout(res, 30));
          setTimeLogYear('2026');
          await new Promise(res => setTimeout(res, 30));
          return true;
        } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('navigation', () => {
    test('goPg(\'pg-timelog\') activates the page and renders entries', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-timelog');
        await new Promise(res => setTimeout(res, 50));
        const active = document.getElementById('pg-timelog')?.classList.contains('active');
        return { active, hasList: !!document.getElementById('tl-list'), hasYearSel: !!document.getElementById('tl-year-sel') };
      });
      expect(r.active).toBe(true);
      expect(r.hasList).toBe(true);
      expect(r.hasYearSel).toBe(true);
    });
  });

  test('no console errors during time log tests', async () => {
    await assertNoErrors(page);
  });
});
