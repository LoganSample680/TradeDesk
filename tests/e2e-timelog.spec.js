// @ts-check
/**
 * Exhaustive E2E coverage for js/timelog.js — the Time Log page (js/timelog.js,
 * js/navigation.js goPg wiring) merging manual clock entries (timeEntries) with
 * GPS auto-tracked entries (job_time_entries via _fetchCrewLabor).
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('timelog.js — exhaustive coverage', () => {
  let page;

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
      { id: 8990001, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, scope_id: 'sand', scope_label: 'Sanding', logged_by_uid: null, logged_by_name: 'Owner (me)' },
      { id: 8990002, job_id: 87702, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 45, scope_id: null, scope_label: null, logged_by_uid: 'emp-test-uid', logged_by_name: 'Test Crew Member' }
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

  test.beforeEach(async () => { await seedFixtures(); });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 89901 && c.id !== 89902);
      bids    = bids.filter(b => b.id !== 88801);
      jobs    = jobs.filter(j => j.id !== 87701 && j.id !== 87702);
      timeEntries = timeEntries.filter(e => e.job_id !== 87701 && e.job_id !== 87702);
    });
    await page.context().close();
  });

  test.describe('_tlSinceISO', () => {
    test('today — returns an ISO string at start of today', async () => {
      const r = await page.evaluate(() => {
        const iso = _tlSinceISO('today');
        return { iso, isString: typeof iso === 'string', isMidnight: new Date(iso).getHours() === 0 };
      });
      expect(r.isString).toBe(true);
      expect(r.isMidnight).toBe(true);
    });

    test('week — returns an ISO string ~7 days back', async () => {
      const r = await page.evaluate(() => {
        const iso = _tlSinceISO('week');
        const days = (Date.now() - new Date(iso).getTime()) / 86400000;
        return { days };
      });
      expect(r.days).toBeGreaterThan(6);
      expect(r.days).toBeLessThan(8);
    });

    test('month — returns an ISO string ~30 days back', async () => {
      const r = await page.evaluate(() => {
        const iso = _tlSinceISO('month');
        const days = (Date.now() - new Date(iso).getTime()) / 86400000;
        return { days };
      });
      expect(r.days).toBeGreaterThan(29);
      expect(r.days).toBeLessThan(31);
    });

    test('all — returns null (no lower bound)', async () => {
      const r = await page.evaluate(() => _tlSinceISO('all'));
      expect(r).toBe(null);
    });

    test('unknown range string — falls back to null, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, val: _tlSinceISO('bogus') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.val).toBe(null);
    });

    test('null/undefined — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlSinceISO(null); _tlSinceISO(undefined); return true; }
        catch (e) { return false; }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('_tlJobClientInfo', () => {
    test('job with bid — resolves client name/addr through the bid', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87701));
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.addr).toBe('1 Timelog St, Wichita KS 67202');
      expect(r.jobName).toBe('Timelog job with bid');
    });

    test('job with no bid — resolves client directly via job.client_id', async () => {
      const r = await page.evaluate(() => _tlJobClientInfo(87702));
      expect(r.clientName).toBe('Timelog No-Bid Client');
      expect(r.jobName).toBe('Timelog walk-up job');
    });

    test('nonexistent jobId — returns em-dash placeholders, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlJobClientInfo(999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v.jobName).toBe('—');
      expect(r.v.clientName).toBe('—');
    });

    test('null jobId — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlJobClientInfo(null); return true; } catch (e) { return false; }
      });
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

    test('sinceISO in the far future — excludes all manual entries', async () => {
      const r = await page.evaluate(async () => {
        const future = new Date(Date.now() + 365 * 86400000).toISOString();
        const rows = await _timeLogRows(future);
        return rows.some(x => x.id === 'm8990001' || x.id === 'm8990002');
      });
      expect(r).toBe(false);
    });

    test('sinceISO null — includes all manual entries regardless of age', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        return rows.filter(x => x.id === 'm8990001' || x.id === 'm8990002').length;
      });
      expect(r).toBe(2);
    });

    test('rows are sorted by date descending', async () => {
      const r = await page.evaluate(async () => {
        const rows = await _timeLogRows(null);
        const dates = rows.map(x => x.date).filter(Boolean);
        const sorted = [...dates].sort((a, b) => b.localeCompare(a));
        return JSON.stringify(dates) === JSON.stringify(sorted);
      });
      expect(r).toBe(true);
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

  test.describe('_tlDateLabel', () => {
    test('valid date string — formats as "Mon D"', async () => {
      const r = await page.evaluate(() => _tlDateLabel('2026-03-15'));
      expect(r).toMatch(/Mar 15/);
    });

    test('null — returns empty string, does not throw', async () => {
      const r = await page.evaluate(() => { try { return _tlDateLabel(null); } catch (e) { return 'THREW'; } });
      expect(r).toBe('');
    });

    test('undefined — returns empty string', async () => {
      const r = await page.evaluate(() => _tlDateLabel(undefined));
      expect(r).toBe('');
    });

    test('garbage string — does not throw, returns something', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlDateLabel('not-a-date') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  test.describe('renderTimeLog', () => {
    test('missing #tl-list DOM — returns gracefully, no throw', async () => {
      const r = await page.evaluate(async () => {
        const el = document.getElementById('tl-list');
        const id = el ? el.id : null;
        if (el) el.id = 'tl-list-hidden-temp';
        try { await renderTimeLog('week'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el) el.id = id; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — owner sees both manual entries, shows total', async () => {
      const r = await page.evaluate(async () => {
        goPg('pg-timelog');
        await renderTimeLog('all');
        const html = document.getElementById('tl-list').innerHTML;
        const total = document.getElementById('tl-total').textContent;
        return { hasOwnerEntry: html.includes('Timelog Test Client'), hasCrewEntry: html.includes('Timelog No-Bid Client'), total };
      });
      expect(r.hasOwnerEntry).toBe(true);
      expect(r.hasCrewEntry).toBe(true);
      expect(r.total).toContain('total');
    });

    test('range buttons — active class follows the current range', async () => {
      const r = await page.evaluate(async () => {
        await renderTimeLog('month');
        const active = [...document.querySelectorAll('#tl-range-bar .fb.active')].map(b => b.dataset.range);
        return active;
      });
      expect(r).toEqual(['month']);
    });

    test('empty range (far future window has nothing) — shows empty state, not an error', async () => {
      const r = await page.evaluate(async () => {
        const origSince = window._tlSinceISO;
        window._tlSinceISO = () => new Date(Date.now() + 365 * 86400000).toISOString();
        await renderTimeLog('today');
        const html = document.getElementById('tl-list').innerHTML;
        window._tlSinceISO = origSince;
        return html;
      });
      expect(r).toContain('No time logged');
    });

    test('employee without payroll permission — sees only their own entries', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee, origEmpRecord = window._employeeRecord, origSupaUser = window._supaUser;
        window._isEmployee = true;
        window._employeeRecord = { name: 'Test Crew Member', permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        await renderTimeLog('all');
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee; window._employeeRecord = origEmpRecord; window._supaUser = origSupaUser;
        return { hasOwn: html.includes('Timelog No-Bid Client'), hasOthers: html.includes('Timelog Test Client') };
      });
      expect(r.hasOwn).toBe(true);
      expect(r.hasOthers).toBe(false);
    });

    test('owner (non-employee) always sees everyone regardless of _canViewComp internals', async () => {
      const r = await page.evaluate(async () => {
        const origIsEmployee = window._isEmployee;
        window._isEmployee = false;
        await renderTimeLog('all');
        const html = document.getElementById('tl-list').innerHTML;
        window._isEmployee = origIsEmployee;
        return html.includes('Timelog Test Client') && html.includes('Timelog No-Bid Client');
      });
      expect(r).toBe(true);
    });

    test('called with no argument — reuses the last range instead of throwing', async () => {
      const r = await page.evaluate(async () => {
        try { await renderTimeLog('week'); await renderTimeLog(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('5 concurrent calls — no throw', async () => {
      const r = await page.evaluate(async () => {
        try {
          await Promise.all([renderTimeLog('today'), renderTimeLog('week'), renderTimeLog('month'), renderTimeLog('all'), renderTimeLog('week')]);
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
        return { active, hasList: !!document.getElementById('tl-list') };
      });
      expect(r.active).toBe(true);
      expect(r.hasList).toBe(true);
    });
  });

  test('no console errors during time log tests', async () => {
    await assertNoErrors(page);
  });
});
