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

    test('still-open (currently clocked in) entries are excluded — they belong in the banner, not the history', async () => {
      const r = await page.evaluate(async () => {
        timeEntries.push({ id: 8990099, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try {
          const rows = await _timeLogRows(null);
          return { ok: true, found: rows.some(x => x.rawId === 8990099) };
        } finally { timeEntries = timeEntries.filter(e => e.id !== 8990099); }
      });
      expect(r.ok).toBe(true);
      expect(r.found).toBe(false);
    });
  });

  test.describe('_tlOpenEntries', () => {
    const OPEN_ID = 8990010;
    test.afterEach(async () => {
      await page.evaluate((id) => { timeEntries = timeEntries.filter(e => e.id !== id); }, OPEN_ID);
    });

    test('golden path — a clocked-in entry shows elapsed minutes and resolved client/job info', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 15 * 60000).toISOString(), end_time: null, minutes: null, open: true, scope_label: 'Sanding', logged_by_uid: null, logged_by_name: 'Owner (me)' });
        const rows = _tlOpenEntries();
        const mine = rows.find(x => x.rawId === id);
        return mine ? { found: true, clientName: mine.clientName, elapsedMin: mine.elapsedMin, detail: mine.detail } : { found: false };
      }, OPEN_ID);
      expect(r.found).toBe(true);
      expect(r.clientName).toBe('Timelog Test Client');
      expect(r.elapsedMin).toBeGreaterThanOrEqual(14);
      expect(r.detail).toBe('Sanding');
    });

    test('closed entries are excluded', async () => {
      const r = await page.evaluate(() => _tlOpenEntries().some(x => x.rawId === 8990001));
      expect(r).toBe(false);
    });

    test('no open entries — returns empty array, no throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, len: _tlOpenEntries().length }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.len).toBe(0);
    });

    test('sorted oldest-first (earliest clock-in shown first)', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push(
          { id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 5 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: id + 1, job_id: 87702, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 30 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'emp-test-uid', logged_by_name: 'Test Crew Member' }
        );
        try { return _tlOpenEntries().map(x => x.rawId); }
        finally { timeEntries = timeEntries.filter(e => e.id !== id + 1); }
      }, OPEN_ID);
      expect(r.indexOf(OPEN_ID + 1)).toBeLessThan(r.indexOf(OPEN_ID));
    });

    test('missing/malformed start_time — does not throw', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: '', start_time: null, end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try { const rows = _tlOpenEntries(); return { ok: true, elapsed: rows.find(x => x.rawId === id)?.elapsedMin }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, OPEN_ID);
      expect(r.ok).toBe(true);
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

  test.describe('_tlWeekKey', () => {
    test('golden path — returns the Sunday of the week containing the date', async () => {
      // 2026-07-15 is a Wednesday; the Sunday before it is 2026-07-12.
      const r = await page.evaluate(() => _tlWeekKey('2026-07-15'));
      expect(r).toBe('2026-07-12');
    });

    test('a Sunday maps to itself', async () => {
      const r = await page.evaluate(() => _tlWeekKey('2026-07-12'));
      expect(r).toBe('2026-07-12');
    });

    test('week spanning a month boundary resolves correctly', async () => {
      // 2026-08-01 is a Saturday; its week starts 2026-07-26.
      const r = await page.evaluate(() => _tlWeekKey('2026-08-01'));
      expect(r).toBe('2026-07-26');
    });

    test('empty/null/malformed date — returns empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: [_tlWeekKey(''), _tlWeekKey(null), _tlWeekKey(undefined), _tlWeekKey('not-a-date')] }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toEqual(['', '', '', '']);
    });
  });

  test.describe('_tlComputeOT', () => {
    test('flags every row for a person whose week totals over 40 hours (2400 min)', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 1300 }, // Mon
          { personUid: 'u1', date: '2026-07-14', minutes: 1300 }, // Tue — total 2600 > 2400
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([true, true]);
    });

    test('does not flag a week at or under 40 hours', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 1200 },
          { personUid: 'u1', date: '2026-07-14', minutes: 1200 }, // total 2400 — not over
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([false, false]);
    });

    test('different people in the same week are tracked independently', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-13', minutes: 2500 },
          { personUid: 'u2', date: '2026-07-13', minutes: 100 },
        ];
        _tlComputeOT(rows);
        return { u1: rows[0].weekOT, u2: rows[1].weekOT };
      });
      expect(r.u1).toBe(true);
      expect(r.u2).toBe(false);
    });

    test('the same person\'s hours in different weeks do not combine', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: 'u1', date: '2026-07-05', minutes: 1300 }, // week of 6/28
          { personUid: 'u1', date: '2026-07-13', minutes: 1300 }, // week of 7/12
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([false, false]);
    });

    test('null personUid (owner) is grouped as its own bucket, not mixed with employees', async () => {
      const r = await page.evaluate(() => {
        const rows = [
          { personUid: null, date: '2026-07-13', minutes: 2500 },
          { personUid: 'u1', date: '2026-07-13', minutes: 2500 },
        ];
        _tlComputeOT(rows);
        return rows.map(r => r.weekOT);
      });
      expect(r).toEqual([true, true]);
    });

    test('empty array — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tlComputeOT([]); return true; } catch (e) { return false; }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('_tlExportCSV', () => {
    test('no rows for the selected year — shows a toast, does not call downloadFile', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let downloadCalled = false, toastMsg = null;
        window.downloadFile = () => { downloadCalled = true; };
        window.showToast = (msg) => { toastMsg = msg; };
        const origRows = _tlLastRows;
        _tlLastRows = [];
        try { _tlExportCSV(); return { downloadCalled, toastMsg }; }
        finally { _tlLastRows = origRows; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r.downloadCalled).toBe(false);
      expect(r.toastMsg).toContain('No time entries');
    });

    test('golden path — builds a CSV with header, escaped fields, and an OT marker', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let captured = null;
        window.downloadFile = (filename, content, type) => { captured = { filename, content, type }; };
        window.showToast = () => {};
        const origRows = _tlLastRows, origYear = _tlYear;
        _tlYear = '2026';
        _tlLastRows = [
          { date: '2026-07-13', personName: 'Owner (me)', clientName: 'Client, "The" Best', addr: '1 Main St', jobName: 'Job A', detail: 'Sanding', source: 'manual', minutes: 90, weekOT: false },
          { date: '2026-07-14', personName: 'Crew A', clientName: 'Other Client', addr: '', jobName: 'Job B', detail: '', source: 'auto', minutes: 2500, weekOT: true },
        ];
        try { _tlExportCSV(); return captured; }
        finally { _tlLastRows = origRows; _tlYear = origYear; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r).toBeTruthy();
      expect(r.type).toBe('text/csv');
      expect(r.filename).toContain('2026');
      expect(r.filename).toContain('.csv');
      expect(r.content).toContain('"Date","Person","Client","Address","Job","Task","Source","Minutes","Duration","Overtime"');
      // Embedded comma+quote in client name must be CSV-escaped, not break the row.
      expect(r.content).toContain('"Client, ""The"" Best"');
      expect(r.content).toContain('Auto (GPS)');
      expect(r.content).toContain('40+ hrs/wk');
    });

    test('rows are exported sorted by date', async () => {
      const r = await page.evaluate(() => {
        const orig = window.downloadFile, origToast = window.showToast;
        let captured = null;
        window.downloadFile = (filename, content) => { captured = content; };
        window.showToast = () => {};
        const origRows = _tlLastRows, origYear = _tlYear;
        _tlYear = '2026';
        _tlLastRows = [
          { date: '2026-07-14', personName: 'B', clientName: '', addr: '', jobName: '', detail: '', source: 'manual', minutes: 30 },
          { date: '2026-07-10', personName: 'A', clientName: '', addr: '', jobName: '', detail: '', source: 'manual', minutes: 30 },
        ];
        try { _tlExportCSV(); return captured; }
        finally { _tlLastRows = origRows; _tlYear = origYear; window.downloadFile = orig; window.showToast = origToast; }
      });
      expect(r.indexOf('2026-07-10')).toBeLessThan(r.indexOf('2026-07-14'));
    });
  });

  test.describe('_tlCanEdit', () => {
    const restore = async () => page.evaluate(() => {
      window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
    });
    test.afterEach(restore);

    test('auto (GPS) source — never editable, even for the owner', async () => {
      const r = await page.evaluate(() => _tlCanEdit({ source: 'auto', personUid: null }));
      expect(r).toBe(false);
    });

    test('auto (GPS) source — never editable, even with payroll permission', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'auto', personUid: 'emp-test-uid' });
      });
      expect(r).toBe(false);
    });

    test('manual entry — owner (non-employee) can always edit, including others\' entries', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(true);
    });

    test('manual entry — employee without payroll permission can edit their OWN entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'emp-test-uid' });
      });
      expect(r).toBe(true);
    });

    test('manual entry — employee without payroll permission CANNOT edit someone else\'s entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(false);
    });

    test('manual entry — employee WITH payroll permission can edit someone else\'s entry', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        return _tlCanEdit({ source: 'manual', personUid: 'someone-else' });
      });
      expect(r).toBe(true);
    });

    test('missing personUid/source — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, v: _tlCanEdit({}) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.v).toBe(false);
    });
  });

  test.describe('_tlRow — Edit/Delete controls', () => {
    test('editable row — renders Edit and Delete buttons wired to the right entry id', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        const html = _tlRow({ id: 'm123', rawId: 123, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60 });
        return html;
      });
      expect(r).toContain('_openEditTimeEntry(123)');
      expect(r).toContain('deleteTimeEntry(123)');
    });

    test('non-editable row (auto/GPS source) — no Edit/Delete buttons', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'a1', rawId: 1, source: 'auto', personName: 'Crew', personUid: 'someone', clientName: 'X', addr: '', jobName: 'Y', detail: 'geo', minutes: 60 });
      });
      expect(r).not.toContain('_openEditTimeEntry');
      expect(r).not.toContain('deleteTimeEntry');
    });

    test('non-editable row (someone else\'s manual entry, no permission) — no Edit/Delete buttons', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        const html = _tlRow({ id: 'm5', rawId: 5, source: 'manual', personName: 'Someone Else', personUid: 'someone-else', clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60 });
        window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
        return html;
      });
      expect(r).not.toContain('_openEditTimeEntry');
      expect(r).not.toContain('deleteTimeEntry');
    });

    test('weekOT true — renders the "OT WK" badge', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm7', rawId: 7, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60, date: '2026-07-13', weekOT: true });
      });
      expect(r).toContain('OT WK');
    });

    test('weekOT false/undefined — no "OT WK" badge', async () => {
      const r = await page.evaluate(() => {
        window._isEmployee = false;
        return _tlRow({ id: 'm8', rawId: 8, source: 'manual', personName: 'Owner (me)', personUid: null, clientName: 'X', addr: '', jobName: 'Y', detail: '', minutes: 60, date: '2026-07-13', weekOT: false });
      });
      expect(r).not.toContain('OT WK');
    });
  });

  test.describe('_tlRenderOpenBanner / open-refresh lifecycle', () => {
    const OPEN_ID = 8990020;
    test.afterEach(async () => {
      await page.evaluate((id) => {
        timeEntries = timeEntries.filter(e => e.id !== id);
        window._isEmployee = false; window._employeeRecord = undefined; window._supaUser = undefined;
        if (typeof _tlStopOpenRefresh === 'function') _tlStopOpenRefresh();
      }, OPEN_ID);
    });

    test('missing #tl-open DOM — no throw', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('tl-open');
        const id = el ? el.id : null;
        if (el) el.id = 'tl-open-hidden-temp';
        try { _tlRenderOpenBanner(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el) el.id = id; }
      });
      expect(r.ok).toBe(true);
    });

    test('no open entries — banner is hidden and empty', async () => {
      const r = await page.evaluate(() => {
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      });
      expect(r.display).toBe('none');
      expect(r.html).toBe('');
    });

    test('my own open entry — shown with person name, client, and elapsed time, no "Clock out" button', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 10 * 60000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      }, OPEN_ID);
      expect(r.display).toBe('block');
      expect(r.html).toContain('Currently clocked in');
      expect(r.html).toContain('Timelog Test Client');
      expect(r.html).not.toContain('forceClockOutEntry');
      expect(r.html).not.toContain('LONG SHIFT');
    });

    test('an entry open 10+ hours is flagged "LONG SHIFT" (likely a forgotten clock-out)', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 11 * 3600000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        return document.getElementById('tl-open').innerHTML;
      }, OPEN_ID);
      expect(r).toContain('LONG SHIFT');
    });

    test('an entry open under 10 hours is NOT flagged', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date(Date.now() - 2 * 3600000).toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        window._isEmployee = false;
        _tlRenderOpenBanner();
        return document.getElementById('tl-open').innerHTML;
      }, OPEN_ID);
      expect(r).not.toContain('LONG SHIFT');
    });

    test('employee without payroll permission — cannot see someone else\'s open entry', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else' });
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: false } };
        window._supaUser = { id: 'emp-test-uid' };
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, html: el.innerHTML };
      }, OPEN_ID);
      expect(r.display).toBe('none');
      expect(r.html).toBe('');
    });

    test('manager with payroll permission — sees others\' open entries with a "Clock out" force button', async () => {
      const r = await page.evaluate((id) => {
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: 'someone-else', logged_by_name: 'Someone Else' });
        window._isEmployee = true;
        window._employeeRecord = { permissions: { payroll: true } };
        window._supaUser = { id: 'emp-test-uid' };
        _tlRenderOpenBanner();
        const el = document.getElementById('tl-open');
        return { display: el.style.display, hasForceBtn: el.innerHTML.includes('forceClockOutEntry(' + id + ')') };
      }, OPEN_ID);
      expect(r.display).toBe('block');
      expect(r.hasForceBtn).toBe(true);
    });

    test('_tlStartOpenRefresh sets a live interval; _tlStopOpenRefresh clears it', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const runningAfterStart = _tlOpenRefreshTimer !== null;
        _tlStopOpenRefresh();
        const clearedAfterStop = _tlOpenRefreshTimer === null;
        return { runningAfterStart, clearedAfterStop };
      });
      expect(r.runningAfterStart).toBe(true);
      expect(r.clearedAfterStop).toBe(true);
    });

    test('calling _tlStartOpenRefresh twice does not leak a second interval', async () => {
      const r = await page.evaluate(() => {
        _tlStartOpenRefresh();
        const first = _tlOpenRefreshTimer;
        _tlStartOpenRefresh();
        const second = _tlOpenRefreshTimer;
        _tlStopOpenRefresh();
        return { changed: first !== second, clearedAfter: _tlOpenRefreshTimer === null };
      });
      expect(r.changed).toBe(true);
      expect(r.clearedAfter).toBe(true);
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

    test('an open (clocked-in) entry appears in the open banner, not in the year/month/day history', async () => {
      const r = await page.evaluate(async () => {
        const id = 8990030;
        timeEntries.push({ id, job_id: 87701, date: new Date().toISOString().slice(0, 10), start_time: new Date().toISOString(), end_time: null, minutes: null, open: true, logged_by_uid: null, logged_by_name: 'Owner (me)' });
        try {
          setTimeLogYear(new Date().getFullYear());
          await renderTimeLog();
          const bannerHtml = document.getElementById('tl-open').innerHTML;
          const listHtml = document.getElementById('tl-list').innerHTML;
          return { inBanner: bannerHtml.includes('Currently clocked in'), inHistory: listHtml.includes('_openEditTimeEntry(' + id + ')') };
        } finally { timeEntries = timeEntries.filter(e => e.id !== id); }
      });
      expect(r.inBanner).toBe(true);
      expect(r.inHistory).toBe(false);
    });

    test('#tl-week-total reflects the live current-week total, independent of the year selector', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        const now = new Date();
        timeEntries = [
          { id: 9990201, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 90, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
          { id: 9990202, job_id: 87701, date: now.toISOString().slice(0, 10), start_time: now.toISOString(), end_time: now.toISOString(), minutes: 45, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
        ];
        try {
          setTimeLogYear(now.getFullYear());
          await renderTimeLog();
          return document.getElementById('tl-week-total').textContent;
        } finally { timeEntries = orig; }
      });
      expect(r).toContain('2h 15m');
      expect(r).toContain('this week');
    });

    test('week total excludes entries outside the current calendar week', async () => {
      const r = await page.evaluate(async () => {
        const orig = timeEntries;
        timeEntries = [
          { id: 9990203, job_id: 87701, date: '2020-01-01', start_time: '2020-01-01T09:00:00Z', end_time: '2020-01-01T10:00:00Z', minutes: 500, open: false, logged_by_uid: null, logged_by_name: 'Owner (me)' },
        ];
        try {
          setTimeLogYear(2020);
          await renderTimeLog();
          return document.getElementById('tl-week-total').textContent;
        } finally { timeEntries = orig; }
      });
      expect(r).not.toContain('500');
      expect(r).not.toContain('8h'); // 500min = 8h20m — must not leak into the current-week total
      expect(r).toContain('this week');
    });

    test('renders the Export CSV button', async () => {
      const r = await page.evaluate(async () => {
        setTimeLogYear(new Date().getFullYear());
        await renderTimeLog();
        return !!document.querySelector('button[onclick="_tlExportCSV()"]');
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
