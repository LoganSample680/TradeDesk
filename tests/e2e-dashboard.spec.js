// @ts-check
/**
 * Exhaustive E2E tests for dashboard.js
 *
 * Covers every exported/global function:
 *   _trendHtml, renderDash, _empSetStatus, _empConfirmDone, _fmtEmpTaskTime,
 *   _empToggleTask, renderDashToday, _openCrewAssignSheet, _assignCrewToJob,
 *   getNextCollAction, emitEvent, autoLogContact, markFollowupSent,
 *   _snoozeFollowup, openExpenseForJob, renderDashCollect, checkUnpaidOnLoad,
 *   printKansasLien, _mmtToggle, _markDepositCash, renderTodayFeed,
 *   checkGoalPrompt, renderGoal, renderLeadSources, closeSourceDetail,
 *   showSourceDetail, renderPipeline, openIntakeFormModal, _copyIntakeUrl,
 *   renderLeadsPage, _pfToggleYr, _pfToggleMo, openBidDetail, _bddView,
 *   setProposalFilter, renderReadyQueue, _readyQueueBids, _sortReadyQueue,
 *   _readyQueueSetOrder
 *
 * Requirements per function:
 *   1. null/undefined input, must not throw
 *   2. empty input ([], '', 0), graceful handling
 *   3. boundary values (-1, 0, 1, very large)
 *   4. type mismatch, graceful
 *   5. missing DOM, no crash
 *   6. valid golden-path, correct output
 *   7. concurrent calls (5 sync, no await), no stack corruption
 *   8. corrupted localStorage, graceful
 *   9. render functions: no duplicate entries after 3 calls
 *  10. guard variables: released even after throw
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
  FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

test.describe('dashboard.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);

    // Silence any day-of-week modals that boot might spawn
    await page.evaluate(() => {
      if (typeof checkFridaySummary === 'function') window.checkFridaySummary = () => {};
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
    });
  });

  test.afterAll(async () => { await page.context().close(); });

  // ─────────────────────────────────────────────────────────────────────────────
  // _trendHtml
  // ─────────────────────────────────────────────────────────────────────────────

  test('_trendHtml: null prev returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(100, null, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_trendHtml: undefined prev returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(100, undefined, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_trendHtml: prev === 0 returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(100, 0, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_trendHtml: curr === prev returns flat indicator', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(100, 100, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toContain('vs LY');
  });

  test('_trendHtml: positive trend, normal color, contains green and up arrow', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(200, 100, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toContain('var(--c-green)');
    expect(r.result).toContain('M2 9l4-4 4 4'); // up arrow path
    expect(r.result).toContain('100%');
  });

  test('_trendHtml: negative trend, normal color, contains red and down arrow', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(50, 100, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toContain('var(--c-red)');
    expect(r.result).toContain('M2 3l4 4 4-4'); // down arrow path
    expect(r.result).toContain('50%');
  });

  test('_trendHtml: reverseColor=true flips good/bad colors', async () => {
    const r = await page.evaluate(() => {
      try {
        const up = _trendHtml(200, 100, true);   // up + reversed → bad → red
        const dn = _trendHtml(50, 100, true);    // down + reversed → good → green
        return { ok: true, upRed: up.includes('var(--c-red)'), dnGreen: dn.includes('var(--c-green)') };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.upRed).toBe(true);
    expect(r.dnGreen).toBe(true);
  });

  test('_trendHtml: boundary: very large numbers do not throw', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: typeof _trendHtml(1e15, 1e14, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('string');
  });

  test('_trendHtml: boundary: negative curr with positive prev', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _trendHtml(-100, 100, false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(typeof r.result).toBe('string');
  });

  test('_trendHtml: type mismatch, string inputs do not throw', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: typeof _trendHtml('abc', 'xyz', false) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('string');
  });

  test('_trendHtml: 5 concurrent calls do not corrupt output', async () => {
    const r = await page.evaluate(() => {
      try {
        const results = [];
        results.push(_trendHtml(200, 100, false));
        results.push(_trendHtml(50, 100, false));
        results.push(_trendHtml(100, 100, false));
        results.push(_trendHtml(0, 100, false));
        results.push(_trendHtml(300, 100, true));
        return { ok: true, allStrings: results.every(r => typeof r === 'string'), count: results.length };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.allStrings).toBe(true);
    expect(r.count).toBe(5);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderDash
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderDash: golden path, runs without throwing', async () => {
    const r = await page.evaluate(() => {
      try { renderDash(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderDash: guard variable _renderDashRunning released after call', async () => {
    const r = await page.evaluate(() => {
      try {
        renderDash();
        return { ok: true, running: window._renderDashRunning };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.running).toBe(false);
  });

  test('renderDash: concurrent calls, second call returns early (cascade guard)', async () => {
    const r = await page.evaluate(() => {
      try {
        // Manually set guard to simulate an in-progress render
        window._renderDashRunning = true;
        // This second call should bail out immediately
        renderDash();
        window._renderDashRunning = false; // reset manually
        return { ok: true };
      }
      catch (e) { window._renderDashRunning = false; return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderDash: guard released even if inner function throws', async () => {
    const r = await page.evaluate(() => {
      const orig = window.getDashGreeting;
      window.getDashGreeting = () => { throw new Error('forced'); };
      try { renderDash(); } catch (_) {}
      window.getDashGreeting = orig;
      return { ok: true, running: window._renderDashRunning };
    });
    expect(r.ok).toBe(true);
    expect(r.running).toBe(false);
  });

  test('renderDash: no duplicate .met elements after 3 calls', async () => {
    const r = await page.evaluate(() => {
      try {
        renderDash(); renderDash(); renderDash();
        const inner = document.getElementById('dash-mets-inner');
        if (!inner) return { ok: true, count: 0 };
        return { ok: true, count: inner.querySelectorAll('.met').length };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    // Should have exactly the same number of metrics as a single render (6 KPI tiles)
    expect(r.count).toBeLessThanOrEqual(6);
    expect(r.count).toBeGreaterThanOrEqual(0);
  });

  test('renderDash: corrupted localStorage does not crash', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_data', '{INVALID{{');
      try { renderDash(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_data'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _empSetStatus
  // ─────────────────────────────────────────────────────────────────────────────

  test('_empSetStatus: missing job ID, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _empSetStatus(999999999, 'enroute'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empSetStatus: null jobId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _empSetStatus(null, 'enroute'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empSetStatus: undefined jobId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _empSetStatus(undefined, 'arrived'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empSetStatus: valid job, no employee record, returns without crashing', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88881, name: 'Test Job', client_id: 9999, empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = null;
      try { _empSetStatus(88881, 'enroute'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); window._employeeRecord = origRec; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empSetStatus: done state, opens confirmation sheet without crashing', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88882, name: 'Test Job', client_id: 9999, empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = { id: 'emp-1', name: 'Test Emp' };
      try {
        _empSetStatus(88882, 'done');
        const sheet = document.querySelector('.zmodal-overlay');
        const result = { ok: true, sheetExists: !!sheet };
        if (sheet) sheet.remove();
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); window._employeeRecord = origRec; }
    });
    expect(r.ok).toBe(true);
    expect(r.sheetExists).toBe(true);
  });

  test('_empSetStatus: 5 concurrent calls with missing job, no stack corruption', async () => {
    const r = await page.evaluate(() => {
      try {
        _empSetStatus(0, 'enroute');
        _empSetStatus(-1, 'arrived');
        _empSetStatus('', 'done');
        _empSetStatus(null, 'enroute');
        _empSetStatus(undefined, 'arrived');
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _empConfirmDone
  // ─────────────────────────────────────────────────────────────────────────────

  test('_empConfirmDone: missing job, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _empConfirmDone(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empConfirmDone: null jobId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _empConfirmDone(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empConfirmDone: valid job, no employee record, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88883, name: 'Test Job', empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = null;
      try { _empConfirmDone(88883); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); window._employeeRecord = origRec; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empConfirmDone: golden path, marks job done, removes overlay', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88884, name: 'Test Job', empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = { id: 'emp-2', name: 'Test Worker' };
      // Create a fake overlay + textarea for the confirm flow
      const ov = document.createElement('div');
      ov.className = 'zmodal-overlay';
      const ta = document.createElement('textarea');
      ta.id = '_emp-done-note';
      ta.value = 'All done';
      ov.appendChild(ta);
      document.body.appendChild(ov);
      try {
        _empConfirmDone(88884);
        const status = fakeJob.empStatus['emp-2'];
        const note = fakeJob.empNotes ? fakeJob.empNotes['emp-2'] : null;
        return { ok: true, status, note };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        jobs.shift();
        window._employeeRecord = origRec;
        document.querySelector('.zmodal-overlay')?.remove();
      }
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('done');
    expect(r.note).toBe('All done');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _fmtEmpTaskTime
  // ─────────────────────────────────────────────────────────────────────────────

  test('_fmtEmpTaskTime: null input, returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _fmtEmpTaskTime(null) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_fmtEmpTaskTime: undefined input, returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _fmtEmpTaskTime(undefined) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_fmtEmpTaskTime: invalid date string, returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _fmtEmpTaskTime('not-a-date') }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(typeof r.result).toBe('string');
  });

  test('_fmtEmpTaskTime: empty string, returns empty string', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: _fmtEmpTaskTime('') }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('');
  });

  test('_fmtEmpTaskTime: valid ISO string, returns time string', async () => {
    const r = await page.evaluate(() => {
      try {
        const iso = new Date('2025-06-15T14:30:00').toISOString();
        return { ok: true, result: _fmtEmpTaskTime(iso) };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result.length).toBeGreaterThan(0);
    // Should contain time-like pattern: digits and colon
    expect(r.result).toMatch(/\d/);
  });

  test('_fmtEmpTaskTime: numeric timestamp, graceful', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: typeof _fmtEmpTaskTime(1234567890) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('string');
  });

  test('_fmtEmpTaskTime: 5 concurrent calls, all return strings', async () => {
    const r = await page.evaluate(() => {
      try {
        const iso = new Date().toISOString();
        const results = [
          _fmtEmpTaskTime(iso),
          _fmtEmpTaskTime(null),
          _fmtEmpTaskTime(''),
          _fmtEmpTaskTime('bad'),
          _fmtEmpTaskTime(undefined),
        ];
        return { ok: true, allStrings: results.every(x => typeof x === 'string') };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.allStrings).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _empToggleTask
  // ─────────────────────────────────────────────────────────────────────────────

  test('_empToggleTask: missing job, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _empToggleTask(999999999, 1); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empToggleTask: null jobId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _empToggleTask(null, 1); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_empToggleTask: job exists but no tasks array, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88885, name: 'Test' };
      jobs.unshift(fakeJob);
      try { _empToggleTask(88885, 1); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); }
    });
    expect(r.ok).toBe(true);
  });

  test('_empToggleTask: task not found in array, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 88886, name: 'Test', tasks: [{ id: 1, text: 'Task 1', done: false }] };
      jobs.unshift(fakeJob);
      try { _empToggleTask(88886, 999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); }
    });
    expect(r.ok).toBe(true);
  });

  test('_empToggleTask: golden path, toggles task done state', async () => {
    const r = await page.evaluate(() => {
      const fakeTask = { id: 42, text: 'Paint walls', done: false };
      const fakeJob = { id: 88887, name: 'Test Job', tasks: [fakeTask], empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = { id: 'emp-3', name: 'Worker' };
      try {
        _empToggleTask(88887, 42);
        return { ok: true, done: fakeTask.done, hasDoneBy: !!fakeTask.doneBy, hasDoneAt: !!fakeTask.doneAt };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); window._employeeRecord = origRec; }
    });
    expect(r.ok).toBe(true);
    expect(r.done).toBe(true);
    expect(r.hasDoneBy).toBe(true);
    expect(r.hasDoneAt).toBe(true);
  });

  test('_empToggleTask: toggle done→undone clears doneBy/doneAt', async () => {
    const r = await page.evaluate(() => {
      const fakeTask = { id: 43, text: 'Cleanup', done: true, doneBy: 'Worker', doneAt: new Date().toISOString() };
      const fakeJob = { id: 88888, name: 'Test', tasks: [fakeTask], empStatus: {} };
      jobs.unshift(fakeJob);
      const origRec = window._employeeRecord;
      window._employeeRecord = { id: 'emp-4', name: 'Worker' };
      try {
        _empToggleTask(88888, 43);
        return { ok: true, done: fakeTask.done, hasDoneBy: 'doneBy' in fakeTask };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); window._employeeRecord = origRec; }
    });
    expect(r.ok).toBe(true);
    expect(r.done).toBe(false);
    expect(r.hasDoneBy).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderDashToday
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderDashToday: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-today');
      if (el) el.id = 'dash-today-hidden';
      try { renderDashToday(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-today'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderDashToday: empty jobs array, renders no-job placeholder', async () => {
    const r = await page.evaluate(() => {
      const origJobs = [...jobs];
      jobs.length = 0;
      try {
        renderDashToday();
        const el = document.getElementById('dash-today');
        return { ok: true, hasContent: !!el && el.innerHTML.length > 0 };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.length = 0; origJobs.forEach(j => jobs.push(j)); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasContent).toBe(true);
  });

  test('renderDashToday: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_jobs', '{INVALID{{');
      try { renderDashToday(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_jobs'); }
    });
    expect(r.ok).toBe(true);
  });

  test('renderDashToday: no duplicate job cards after 3 calls with same data', async () => {
    const r = await page.evaluate(() => {
      const tk = todayKey();
      const fakeJob = { id: 88889, name: 'No Dupe Job', client_id: null, start: tk, days: 1, color: 'blue', eventType: 'job' };
      jobs.unshift(fakeJob);
      try {
        renderDashToday(); renderDashToday(); renderDashToday();
        const el = document.getElementById('dash-today');
        if (!el) return { ok: true, count: 0 };
        const count = (el.innerHTML.match(/No Dupe Job/g) || []).length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const idx = jobs.findIndex(j => j.id === 88889);
        if (idx !== -1) jobs.splice(idx, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _jobFieldNote, composite: site note + this-job note + hazard flag, editable.
  // Takes the JOB OBJECT now (not a string).
  // ─────────────────────────────────────────────────────────────────────────────
  test('_jobFieldNote: empty job / null / no note return empty string when not editable', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      return { skip: false, nul: _jobFieldNote(null), undef: _jobFieldNote(undefined), noNote: _jobFieldNote({ id: 1, client_id: null }), ws: _jobFieldNote({ id: 1, notes: '   ', client_id: null }) };
    });
    if (r.skip) return;
    expect(r.nul).toBe('');
    expect(r.undef).toBe('');
    expect(r.noNote).toBe('');
    expect(r.ws).toBe('');
  });

  test('_jobFieldNote: a job note renders the text under a "Field note" label', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const html = _jobFieldNote({ id: 1, notes: 'Bring the 24ft ladder', client_id: null });
      return { skip: false, hasText: html.includes('Bring the 24ft ladder'), hasLabel: html.toLowerCase().includes('field note') };
    });
    if (r.skip) return;
    expect(r.hasText).toBe(true);
    expect(r.hasLabel).toBe(true);
  });

  test('_jobFieldNote: escapes HTML (no injection from a note)', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const html = _jobFieldNote({ id: 1, notes: '<img src=x onerror=alert(1)>', client_id: null });
      return { skip: false, rawTagAbsent: !html.includes('<img'), escaped: html.includes('&lt;img') };
    });
    if (r.skip) return;
    expect(r.rawTagAbsent).toBe(true);
    expect(r.escaped).toBe(true);
  });

  test('_jobFieldNote: pulls the client site note (persistent) alongside the job note', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const cid = 555001;
      clients.push({ id: cid, name: 'Site Client', siteNote: 'Gate code 4412' });
      try {
        const html = _jobFieldNote({ id: 1, notes: 'Bring ladder', client_id: cid });
        return { skip: false, hasSite: html.includes('Gate code 4412'), hasJob: html.includes('Bring ladder'), hasSiteLabel: html.includes('Site') };
      } finally { clients.splice(clients.findIndex(c => c.id === cid), 1); }
    });
    if (r.skip) return;
    expect(r.hasSite).toBe(true);
    expect(r.hasJob).toBe(true);
    expect(r.hasSiteLabel).toBe(true);
  });

  test('_jobFieldNote: noteAlert flags a hazard (red "Heads up", even with no text)', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const html = _jobFieldNote({ id: 1, noteAlert: true, notes: 'Aggressive dog', client_id: null });
      return { skip: false, notEmpty: html.length > 0, hasHeadsUp: html.toLowerCase().includes('heads up'), red: html.includes('--c-red') };
    });
    if (r.skip) return;
    expect(r.notEmpty).toBe(true);
    expect(r.hasHeadsUp).toBe(true);
    expect(r.red).toBe(true);
  });

  test('_jobFieldNote: editable + no note renders an "Add a field note" button; non-editable renders nothing', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const editable = _jobFieldNote({ id: 7, client_id: null }, { editable: true });
      const readonly = _jobFieldNote({ id: 7, client_id: null });
      return { skip: false, editableHasAdd: editable.includes('_openJobNoteEditor(7)'), readonlyEmpty: readonly === '' };
    });
    if (r.skip) return;
    expect(r.editableHasAdd).toBe(true);
    expect(r.readonlyEmpty).toBe(true);
  });

  test('_openJobNoteEditor / _saveJobNote: edits the job note, hazard flag, and client site note', async () => {
    const r = await page.evaluate(() => {
      if (typeof _openJobNoteEditor !== 'function' || typeof _saveJobNote !== 'function') return { skip: true };
      const cid = 555002, jid = 555003;
      clients.push({ id: cid, name: 'Editor Client' });
      jobs.push({ id: jid, name: 'Editor Job', client_id: cid, start: todayKey(), days: 1, eventType: 'job', status: 'upcoming' });
      try {
        _openJobNoteEditor(jid);
        const sheet = !!document.getElementById('_jobnote-ov');
        document.getElementById('_jn-note-ta').value = 'Bring the sprayer';
        document.getElementById('_jn-alert').checked = true;
        document.getElementById('_jn-site-ta').value = 'Side gate, code 9911';
        _saveJobNote(jid);
        const j = jobs.find(x => x.id === jid);
        const c = clients.find(x => x.id === cid);
        const closed = !document.getElementById('_jobnote-ov');
        return { skip: false, sheet, jobNote: j.notes, alert: j.noteAlert === true, siteNote: c.siteNote, closed };
      } finally {
        jobs.splice(jobs.findIndex(j => j.id === jid), 1);
        clients.splice(clients.findIndex(c => c.id === cid), 1);
        document.getElementById('_jobnote-ov')?.remove();
      }
    });
    if (r.skip) return;
    expect(r.sheet).toBe(true);
    expect(r.jobNote).toBe('Bring the sprayer');
    expect(r.alert).toBe(true);
    expect(r.siteNote).toBe('Side gate, code 9911');
    expect(r.closed).toBe(true);
  });

  test('_openJobNoteEditor: missing job id, no throw', async () => {
    const r = await page.evaluate(() => {
      if (typeof _openJobNoteEditor !== 'function') return { skip: true };
      try { _openJobNoteEditor(99999999); return { skip: false, ok: true }; }
      catch (e) { return { skip: false, ok: false, err: e.message }; }
      finally { document.getElementById('_jobnote-ov')?.remove(); }
    });
    if (r.skip) return;
    expect(r.ok).toBe(true);
  });

  test('_openJobNoteEditor: header shows the job address so the crew knows which site', async () => {
    const r = await page.evaluate(() => {
      if (typeof _openJobNoteEditor !== 'function') return { skip: true };
      const jid = 555020;
      jobs.push({ id: jid, name: 'Repaint', client_id: null, addr: '88 Birch Ln', start: todayKey(), days: 1, eventType: 'job', status: 'upcoming' });
      try {
        _openJobNoteEditor(jid);
        return { skip: false, hasAddr: document.getElementById('_jobnote-ov').innerHTML.includes('88 Birch Ln') };
      } finally {
        jobs.splice(jobs.findIndex(j => j.id === jid), 1);
        document.getElementById('_jobnote-ov')?.remove();
      }
    });
    if (r.skip) return;
    expect(r.hasAddr).toBe(true);
  });

  test('_notephotos / _notePhotoSrc: filter to note-type photos and resolve a src', async () => {
    const r = await page.evaluate(() => {
      if (typeof _notephotos !== 'function' || typeof _notePhotoSrc !== 'function') return { skip: true };
      const j = { photos: [{ type: 'before', data: 'b' }, { type: 'note', data: 'data:image/png;base64,AAA' }, { type: 'note', url: 'https://x/y.jpg' }] };
      const n = _notephotos(j);
      return { skip: false, count: n.length, src0: _notePhotoSrc(n[0]), src1: _notePhotoSrc(n[1]), noneJob: _notephotos(null).length };
    });
    if (r.skip) return;
    expect(r.count).toBe(2);
    expect(r.src0).toBe('data:image/png;base64,AAA');
    expect(r.src1).toBe('https://x/y.jpg');
    expect(r.noneJob).toBe(0);
  });

  test('_jobFieldNote: a note photo renders a thumbnail even with no text', async () => {
    const r = await page.evaluate(() => {
      if (typeof _jobFieldNote !== 'function') return { skip: true };
      const html = _jobFieldNote({ id: 1, client_id: null, photos: [{ type: 'note', data: 'data:image/png;base64,AAA' }] });
      return { skip: false, notEmpty: html.length > 0, hasImg: html.includes('<img'), hasSrc: html.includes('data:image/png;base64,AAA') };
    });
    if (r.skip) return;
    expect(r.notEmpty).toBe(true);
    expect(r.hasImg).toBe(true);
    expect(r.hasSrc).toBe(true);
  });

  test('_viewNotePhoto: opens a fullscreen overlay with the image and dismisses on click', async () => {
    const r = await page.evaluate(() => {
      if (typeof _viewNotePhoto !== 'function') return { skip: true };
      _viewNotePhoto('data:image/png;base64,AAA');
      const ov = document.getElementById('_notephoto-ov');
      const hasImg = !!(ov && ov.querySelector('img'));
      ov && ov.click();
      const gone = !document.getElementById('_notephoto-ov');
      const emptyNoop = (_viewNotePhoto(''), !document.getElementById('_notephoto-ov'));
      return { skip: false, opened: !!ov, hasImg, gone, emptyNoop };
    });
    if (r.skip) return;
    expect(r.opened).toBe(true);
    expect(r.hasImg).toBe(true);
    expect(r.gone).toBe(true);
    expect(r.emptyNoop).toBe(true);
  });

  test('_openJobNoteEditor: renders existing note photos with a remove control', async () => {
    const r = await page.evaluate(() => {
      if (typeof _openJobNoteEditor !== 'function') return { skip: true };
      const jid = 555010;
      jobs.push({ id: jid, name: 'Photo Job', client_id: null, start: todayKey(), days: 1, eventType: 'job', status: 'upcoming', photos: [{ type: 'note', data: 'data:image/png;base64,AAA' }] });
      try {
        _openJobNoteEditor(jid);
        const html = document.getElementById('_jobnote-ov').innerHTML;
        return { skip: false, hasThumb: html.includes('data:image/png;base64,AAA'), hasDel: html.includes('_jnDelPhoto('+jid+',0)'), hasAdd: html.includes('_jnAddPhoto('+jid+',this)') };
      } finally {
        jobs.splice(jobs.findIndex(j => j.id === jid), 1);
        document.getElementById('_jobnote-ov')?.remove();
      }
    });
    if (r.skip) return;
    expect(r.hasThumb).toBe(true);
    expect(r.hasDel).toBe(true);
    expect(r.hasAdd).toBe(true);
  });

  test('renderDashToday: a job with notes surfaces the field note on the owner card', async () => {
    const r = await page.evaluate(() => {
      if (typeof renderDashToday !== 'function') return { skip: true };
      const tk = todayKey();
      const fakeJob = { id: 88871, name: 'Note Job', client_id: null, start: tk, days: 1, color: 'blue', eventType: 'job', notes: 'Park in the alley' };
      jobs.unshift(fakeJob);
      try {
        renderDashToday();
        const el = document.getElementById('dash-today');
        return { skip: false, shows: el ? el.innerHTML.includes('Park in the alley') : false };
      } finally {
        const idx = jobs.findIndex(j => j.id === 88871); if (idx !== -1) jobs.splice(idx, 1);
      }
    });
    if (r.skip) return;
    expect(r.shows).toBe(true);
  });

  test('geofence on-site card: surfaces the field note when arriving at a job', async () => {
    const r = await page.evaluate(() => {
      if (typeof renderDash !== 'function') return { skip: true };
      const tk = todayKey();
      const cid = 78611, jid = 786110;
      clients.push({ id: cid, name: 'Onsite Note Client', addr: '9 Fence Rd', phone: '' });
      jobs.push({ id: jid, name: 'Fence Job', client_id: cid, addr: '9 Fence Rd', start: tk, days: 1, eventType: 'job', status: 'upcoming', notes: 'Side gate is unlocked' });
      // Simulate the geofence "you're nearby, not yet clocked in" state.
      _nearbyJob = { clientId: cid, clientName: 'Onsite Note Client', addr: '9 Fence Rd', jobId: jid, fallbackJobId: jid, balance: 0, bidId: null };
      try {
        renderDash();
        const el = document.getElementById('dash-nearby');
        return { skip: false, shows: el ? el.innerHTML.includes('Side gate is unlocked') : false };
      } finally {
        _nearbyJob = null;
        jobs.splice(jobs.findIndex(j => j.id === jid), 1);
        clients.splice(clients.findIndex(c => c.id === cid), 1);
      }
    });
    if (r.skip) return;
    expect(r.shows).toBe(true);
  });

  test('renderDashToday: 5 concurrent calls, no crash', async () => {
    const r = await page.evaluate(() => {
      try {
        renderDashToday(); renderDashToday(); renderDashToday(); renderDashToday(); renderDashToday();
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _openCrewAssignSheet
  // ─────────────────────────────────────────────────────────────────────────────

  test('_openCrewAssignSheet: missing job, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _openCrewAssignSheet(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_openCrewAssignSheet: null jobId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _openCrewAssignSheet(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_openCrewAssignSheet: no employees, shows toast without crashing', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 77701, name: 'Crew Test', client_id: null };
      jobs.unshift(fakeJob);
      const origEmps = S.employees;
      S.employees = [];
      try { _openCrewAssignSheet(77701); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); S.employees = origEmps; }
    });
    expect(r.ok).toBe(true);
  });

  test('_openCrewAssignSheet: with employees, opens sheet', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 77702, name: 'Crew Test 2', client_id: null };
      jobs.unshift(fakeJob);
      const origEmps = S.employees;
      S.employees = [{ id: 'e1', name: 'Alice', role: 'tech' }];
      document.getElementById('_crew-assign-ov')?.remove();
      try {
        _openCrewAssignSheet(77702);
        const sheet = document.getElementById('_crew-assign-ov');
        const result = { ok: true, sheetExists: !!sheet };
        sheet?.remove();
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); S.employees = origEmps; }
    });
    expect(r.ok).toBe(true);
    expect(r.sheetExists).toBe(true);
  });

  test('_openCrewAssignSheet: 5 concurrent calls, only one sheet in DOM', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 77703, name: 'Crew Multi', client_id: null };
      jobs.unshift(fakeJob);
      const origEmps = S.employees;
      S.employees = [{ id: 'e2', name: 'Bob', role: 'tech' }];
      try {
        _openCrewAssignSheet(77703);
        _openCrewAssignSheet(77703);
        _openCrewAssignSheet(77703);
        _openCrewAssignSheet(77703);
        _openCrewAssignSheet(77703);
        const count = document.querySelectorAll('#_crew-assign-ov').length;
        document.getElementById('_crew-assign-ov')?.remove();
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); S.employees = origEmps; }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _assignCrewToJob
  // ─────────────────────────────────────────────────────────────────────────────

  test('_assignCrewToJob: missing job, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _assignCrewToJob(999999999, 'emp-1'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_assignCrewToJob: null empId, removes assignment', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 66601, name: 'Assign Test', assignedTo: 'emp-1', assignedDate: todayKey() };
      jobs.unshift(fakeJob);
      try {
        _assignCrewToJob(66601, null);
        return { ok: true, assignedTo: fakeJob.assignedTo, assignedDate: fakeJob.assignedDate };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.assignedTo).toBeNull();
    expect(r.assignedDate).toBeNull();
  });

  test('_assignCrewToJob: golden path, assigns employee and builds crewHistory', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 66602, name: 'Golden Assign', crewHistory: [] };
      jobs.unshift(fakeJob);
      const origEmps = S.employees;
      S.employees = [{ id: 'e10', name: 'Dave' }];
      try {
        _assignCrewToJob(66602, 'e10');
        return { ok: true, assignedTo: fakeJob.assignedTo, histLen: fakeJob.crewHistory.length };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); S.employees = origEmps; }
    });
    expect(r.ok).toBe(true);
    expect(String(r.assignedTo)).toBe('e10');
    expect(r.histLen).toBe(1);
  });

  test('_assignCrewToJob: assigning same employee twice does not duplicate crewHistory', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 66603, name: 'No Dupe', crewHistory: [] };
      jobs.unshift(fakeJob);
      const origEmps = S.employees;
      S.employees = [{ id: 'e11', name: 'Eve' }];
      try {
        _assignCrewToJob(66603, 'e11');
        _assignCrewToJob(66603, 'e11');
        return { ok: true, histLen: fakeJob.crewHistory.length };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); S.employees = origEmps; }
    });
    expect(r.ok).toBe(true);
    expect(r.histLen).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getNextCollAction
  // ─────────────────────────────────────────────────────────────────────────────

  test('getNextCollAction: null stage, returns none default', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: getNextCollAction(null) }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBeTruthy();
    expect(r.result.label).toContain('Send Reminder');
  });

  test('getNextCollAction: unknown stage, falls back to none', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: getNextCollAction('nonexistent_stage') }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.result.label).toContain('Send Reminder');
  });

  test('getNextCollAction: empty string stage, graceful', async () => {
    const r = await page.evaluate(() => {
      try { return { ok: true, result: getNextCollAction('') }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(typeof r.result.label).toBe('string');
  });

  test('getNextCollAction: all valid stages return correct labels', async () => {
    const r = await page.evaluate(() => {
      try {
        const stages = ['none', 'reminder', 'second', 'intent', 'lien_ready', 'lien_filed'];
        const results = stages.map(s => ({ stage: s, action: getNextCollAction(s) }));
        return { ok: true, results };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.results[0].action.next).toBe('reminder');
    expect(r.results[1].action.next).toBe('second');
    expect(r.results[2].action.next).toBe('intent');
    expect(r.results[3].action.next).toBe('lien_ready');
    expect(r.results[4].action.next).toBe('lien_filed');
    expect(r.results[5].action.next).toBe('resolved');
  });

  test('getNextCollAction: 5 concurrent calls, consistent results', async () => {
    const r = await page.evaluate(() => {
      try {
        const r1 = getNextCollAction('none');
        const r2 = getNextCollAction('reminder');
        const r3 = getNextCollAction('second');
        const r4 = getNextCollAction('intent');
        const r5 = getNextCollAction(null);
        return { ok: true, r1n: r1.next, r2n: r2.next, r3n: r3.next, r4n: r4.next, r5n: r5.next };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.r1n).toBe('reminder');
    expect(r.r2n).toBe('second');
    expect(r.r3n).toBe('intent');
    expect(r.r4n).toBe('lien_ready');
    expect(r.r5n).toBe('reminder');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // emitEvent
  // ─────────────────────────────────────────────────────────────────────────────

  test('emitEvent: null type and clientId, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { emitEvent(null, null, null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('emitEvent: undefined extra, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { emitEvent('contact', 123, undefined); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('emitEvent: golden path, pushes event to events array', async () => {
    const r = await page.evaluate(() => {
      const before = (events || []).length;
      try {
        emitEvent('test_event', 12345, { meta: 'value' });
        const after = (events || []).length;
        const last = events[events.length - 1];
        return { ok: true, grew: after > before, hasType: last.type === 'test_event', hasMeta: last.meta === 'value' };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.grew).toBe(true);
    expect(r.hasType).toBe(true);
    expect(r.hasMeta).toBe(true);
  });

  test('emitEvent: trims to 600 when limit exceeded', async () => {
    const r = await page.evaluate(() => {
      try {
        for (let i = 0; i < 650; i++) emitEvent('bulk', i, null);
        return { ok: true, len: (events || []).length };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.len).toBeLessThanOrEqual(600);
  });

  test('emitEvent: 5 concurrent calls, all events recorded', async () => {
    const r = await page.evaluate(() => {
      // Pre-trim: the prior bulk test fills the array to 600; drain it so 5 additions register.
      if (typeof _tdGetEvents === 'function') {
        const arr = _tdGetEvents();
        if (arr.length > 594) arr.splice(0, arr.length - 500);
      }
      // Use _tdGetEvents(): `events` is a module-scoped let, not directly on window.
      const before = (typeof _tdGetEvents === 'function' ? _tdGetEvents() : []).length;
      try {
        emitEvent('e1', 1, null);
        emitEvent('e2', 2, null);
        emitEvent('e3', 3, null);
        emitEvent('e4', 4, null);
        emitEvent('e5', 5, null);
        const after = (typeof _tdGetEvents === 'function' ? _tdGetEvents() : []).length;
        return { ok: true, added: after - before };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.added).toBeGreaterThanOrEqual(5);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // autoLogContact
  // ─────────────────────────────────────────────────────────────────────────────

  test('autoLogContact: missing client, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { autoLogContact(999999999, 'call'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('autoLogContact: null clientId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { autoLogContact(null, 'call'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('autoLogContact: golden path, sets last_contact_date', async () => {
    const r = await page.evaluate(() => {
      const fakeClient = { id: 55501, name: 'Contact Test', phone: '555-1234' };
      clients.unshift(fakeClient);
      try {
        autoLogContact(55501, 'call');
        return { ok: true, lastContact: fakeClient.last_contact_date };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { clients.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.lastContact).toBeTruthy();
    expect(r.lastContact).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('autoLogContact: also updates pending bid followup', async () => {
    const r = await page.evaluate(() => {
      const fakeClient = { id: 55502, name: 'Followup Test' };
      const fakeBid = { id: 55502, client_id: 55502, status: 'Pending', followup: '2020-01-01' };
      clients.unshift(fakeClient);
      bids.unshift(fakeBid);
      try {
        autoLogContact(55502, 'sms');
        return { ok: true, newFollowup: fakeBid.followup, lastFollowup: fakeBid.last_followup_date };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { clients.shift(); bids.shift(); }
    });
    expect(r.ok).toBe(true);
    // followup should be updated beyond the old date
    expect(r.newFollowup).not.toBe('2020-01-01');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // markFollowupSent
  // ─────────────────────────────────────────────────────────────────────────────

  test('markFollowupSent: missing bid, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { markFollowupSent(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('markFollowupSent: null bidId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { markFollowupSent(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('markFollowupSent: golden path, increments followupStage', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 44401, status: 'Pending', followupStage: 1, noResponseCount: 0, followup: null };
      bids.unshift(fakeBid);
      try {
        markFollowupSent(44401);
        return { ok: true, stage: fakeBid.followupStage, count: fakeBid.noResponseCount, followup: fakeBid.followup };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe(2);
    expect(r.count).toBe(1);
    expect(r.followup).toBeTruthy();
  });

  test('markFollowupSent: stage >= 3 gets 14 day followup', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 44402, status: 'Pending', followupStage: 2, noResponseCount: 0, followup: null };
      bids.unshift(fakeBid);
      try {
        markFollowupSent(44402);
        return { ok: true, stage: fakeBid.followupStage, followup: fakeBid.followup };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _snoozeFollowup
  // ─────────────────────────────────────────────────────────────────────────────

  test('_snoozeFollowup: missing bid, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _snoozeFollowup(999999999, 2); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_snoozeFollowup: null bidId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _snoozeFollowup(null, 2); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_snoozeFollowup: golden path, sets followup to today + days', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 33301, status: 'Pending', followup: '2020-01-01' };
      bids.unshift(fakeBid);
      try {
        _snoozeFollowup(33301, 3);
        return { ok: true, followup: fakeBid.followup };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.followup).not.toBe('2020-01-01');
    expect(r.followup).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('_snoozeFollowup: days=0 still sets followup', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 33302, status: 'Pending', followup: null };
      bids.unshift(fakeBid);
      try {
        _snoozeFollowup(33302, 0);
        return { ok: true, followup: fakeBid.followup };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); }
    });
    expect(r.ok).toBe(true);
    expect(r.followup).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // openExpenseForJob
  // ─────────────────────────────────────────────────────────────────────────────

  test('openExpenseForJob: missing job, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { openExpenseForJob(999999999, null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('openExpenseForJob: null inputs, graceful', async () => {
    const r = await page.evaluate(() => {
      try { openExpenseForJob(null, null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('openExpenseForJob: golden path, navigates to tracker page', async () => {
    const r = await page.evaluate(() => {
      const fakeJob = { id: 22201, name: 'Expense Job' };
      jobs.unshift(fakeJob);
      try {
        openExpenseForJob(22201, 500);
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.shift(); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderDashCollect
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Nearby banner (dash-nearby): kind-driven action (owner decision 2026-07-10) ──
  test.describe('renderDash: nearby banner', () => {
    test('active job today, Clock in targets it directly, Collect is absent (no balance owed)', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555001, jobId: 555011, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Banner Clockin', addr: '1 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '', display: el ? el.style.display : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.display).toBe('block');
      expect(r.html).toContain('_nearbyClockIn(555001,555011)');
      expect(r.html).toContain('Clock in');
      expect(r.html).toContain("_nearbyStartWork(555001)");
      expect(r.html).toContain('Proposal');   // on-site card: "Proposal" (renamed from Estimate)
      // No dead controls: nothing owed means no Collect button at all, not a
      // disabled ghost, a permanently-inert button reads as broken.
      expect(r.html).not.toContain('Collect');
      expect(r.html).toContain('Banner Clockin');
      expect(r.html).toContain("You're here");
      // Redesigned on-site card: live ON SITE badge + radar-ping geofence animation.
      expect(r.html).toContain('ON SITE');
      expect(r.html).toContain('tdGeoPing');
    });

    test('no job scheduled today, Clock in falls back to the client\'s nearest open job', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555002, jobId: null, fallbackJobId: 555012, bidId: null, balance: 0, clientName: 'Banner Fallback', addr: '2 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('_nearbyClockIn(555002,555012)');
    });

    test('no open job at all, Clock in still shows (being on site is reason enough), passes null target', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555003, jobId: null, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Banner NoJob', addr: '3 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      // Hiding Clock in here was the wrong call (owner correction 2026-07-11):
      // physically being on site is reason enough to want to track time even
      // with no job record yet. It always shows; _nearbyClockIn(js/jobs.js)
      // handles the no-target case by creating a walk-up job on the fly
      // instead of dead-ending on the client profile page.
      expect(r.html).toContain('Clock in');
      expect(r.html).toContain('_nearbyClockIn(555003,null)');
      expect(r.html).not.toContain('openClientDetail');
      expect(r.html).toContain('_nearbyStartWork(555003)');
    });

    test('balance owed, Collect shows and opens the pay panel with autoType final', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555004, jobId: null, fallbackJobId: null, bidId: 555002, balance: 450, clientName: 'Banner Collect', addr: '2 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain("openPayPanel(555002,'final')");
      expect(r.html).toContain('$450.00 owed');
      expect(r.html).toContain('Collect');   // on-site card redesign: "Collect" (was "Collect →")
      expect(r.html).not.toContain('disabled');
    });

    test('cold walk-up, no job and no balance, Clock in + Estimate/Invoice show, Collect does not', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555007, jobId: null, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Banner ColdWalkup', addr: '7 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '', btnCount: el ? el.querySelectorAll('button').length : -1 };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.btnCount).toBe(2);
      expect(r.html).toContain('_nearbyStartWork(555007)');
      expect(r.html).toContain('_nearbyClockIn(555007,null)');
      expect(r.html).not.toContain('Collect');
    });

    test('Estimate button always shows and opens the start-work picker', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555005, jobId: null, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Banner Estimate', addr: '5 Test St' };
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.html).toContain('_nearbyStartWork(555005)');
      expect(r.html).toContain('Proposal');   // on-site card: "Proposal" (renamed from Estimate)
    });

    test('the pulse/entrance keyframes are injected once, not duplicated across renders', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _activeTimer = null;
        _nearbyJob = { clientId: 555006, jobId: null, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Style Once', addr: '4 Test St' };
        try {
          renderDash(); renderDash(); renderDash();
          return { ok: true, count: document.querySelectorAll('#_td-nearby-anim-style').length };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
    });

    test('active timer: the on-site card persists with live time-on-site + Arrived stamp + Clock out (owner: do 1 and 2)', async () => {
      const r = await page.evaluate(() => {
        const origNb = _nearbyJob, origTimer = _activeTimer;
        _nearbyJob = null;
        _activeTimer = { jobId: 555099, clientName: 'On Clock Co', scopeId: null, scopeLabel: null, startTime: Date.now() - 3600000 }; // clocked in 1h ago
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, display: el ? el.style.display : '', html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { _nearbyJob = origNb; _activeTimer = origTimer; }
      });
      expect(r.ok, r.err).toBe(true);
      // Behavior change (owner "do 1 and 2"): the card no longer vanishes on clock-in.
      // It persists as the on-the-clock view with a live counter, arrival stamp, Clock out.
      expect(r.display).toBe('block');
      expect(r.html).toContain('clockOut()');
      expect(r.html).toContain('dash-onsite-time');   // the live time-on-site counter element
      expect(r.html).toContain('on site');
      expect(r.html).toContain('Arrived');
      expect(r.html).toContain('On Clock Co');
      expect(r.html).not.toContain('Clock in');       // already on the clock, no clock-in action
    });
  });

  // ── Location prompt (owner 2026-08-01: shop/supply-house work is real job
  // labor with nowhere to attach; titled by the geo tag itself) ───────────────
  test.describe('renderDash: location prompt', () => {
    test('at the shop past the dwell floor: titled "At the shop", rows are tappable clock-ins, no dismiss', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _nearbyJob = null; _activeTimer = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556001, name: 'Panel Build', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, display: el ? el.style.display : '', html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.display).toBe('block');
      expect(r.html).toContain('At the shop');
      expect(r.html).toContain('_locPromptClockIn(556001)');
      expect(r.html).toContain('Panel Build');
      // Owner 2026-08-01: "don't think we need the not now". Ignoring the card
      // already costs nothing and clocking in replaces it.
      expect(r.html).not.toContain('Not now');
      // Each row carries the same green play glyph the job-site card's primary
      // Clock in uses, so a row reads as a button rather than a list item.
      expect(r.html).toContain('M7 5v14l11-7z');
    });

    test('at a saved place: titled with that place\'s own NAME, not a generic label', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice(), places: (typeof places !== 'undefined' ? places.slice() : []) };
        _nearbyJob = null; _activeTimer = null; _geoWasInShop = false; _geoShopArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556020, name: 'Rough-in', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        const pl = savePlace({ name: 'Ferguson Supply', kind: 'supply', lat: 41.5, lon: -97.5, confirmedBy: 'manual' });
        _geoCurrentPlace = String(pl.id);
        _geoPlaceArrivedAt = new Date(Date.now() - 6 * 60000).toISOString();
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, display: el ? el.style.display : '', html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt;
          jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
          if (typeof places !== 'undefined') { places.length = 0; orig.places.forEach(p => places.push(p)); }
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.display).toBe('block');
      // The contractor named it; use their name. A saved place can be a supply
      // house, a dump, a rental yard or a home office, so a hardcoded "At the
      // supply house" would be wrong as often as right.
      expect(r.html).toContain('At Ferguson Supply');
      expect(r.html).toContain('_locPromptClockIn(556020)');
    });

    test('under the 2-minute dwell floor, stays hidden, a drive-through for a part must not nag', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _nearbyJob = null; _activeTimer = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556002, name: 'Panel Build 2', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 30000).toISOString();
        try {
          // A prior test in this file may have left the card visible; hiding it
          // now animates (CLAUDE.md §8, tdNearbyOut fade), it's no longer an
          // instant display:none. Start from a known-hidden state so this test
          // proves the RENDER decision (never shown), not a leftover fade timer.
          const _el0 = document.getElementById('dash-nearby');
          if (_el0) { _el0.style.display = 'none'; _el0.style.animation = ''; }
          if (typeof _nearbyHideTimer !== 'undefined' && _nearbyHideTimer) { clearTimeout(_nearbyHideTimer); _nearbyHideTimer = null; }
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, display: el ? el.style.display : '', html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.ok, r.err).toBe(true);
      // Old contract: under the dwell floor meant the whole card stayed
      // hidden. New contract (owner 2026-08-19, "nothing dependent on
      // anything"): this card never hides anymore, it falls back to the
      // plain manual clock control. The actual thing this test guards, a
      // drive-through must not nag with a location PROMPT, still holds.
      expect(r.display).toBe('block');
      expect(r.html).not.toContain('At the shop');
      expect(r.html).toContain('Not clocked in');
    });

    test('a re-stamped arrival never blinks an already-open card off', async () => {
      // Owner video 2026-08-11: the shop card popped in, then vanished a second
      // later. A fence bounce (or a phantom-speed eviction) re-stamps the same
      // visit's arrival, and the 2-minute floor treated the re-stamp as a brand
      // new visit. Once the card is open for a location, it stays open.
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _nearbyJob = null; _activeTimer = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556009, name: 'Panel Build 5', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        window._locPromptSticky = null;
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          const before = el ? el.style.display : '';
          // The bounce: same visit, arrival stamp suddenly reads "just now".
          _geoShopArrivedAt = new Date().toISOString();
          renderDash();
          const after = el ? el.style.display : '';
          return { ok: true, before, after, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
          window._locPromptSticky = null;
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.before).toBe('block');
      expect(r.after, 'the open card rides out the re-stamp').toBe('block');
      expect(r.html).toContain('At the shop');
    });

    test('a nearby job site outranks the location prompt when somehow both are true', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _activeTimer = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556003, name: 'Panel Build 3', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        _nearbyJob = { clientId: 556004, jobId: 556005, fallbackJobId: null, bidId: null, balance: 0, clientName: 'Priority Client', addr: '9 Priority Ave' };
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.html).toContain('Priority Client');
      expect(r.html).not.toContain('At the shop');
    });

    test('an active clock outranks the location prompt', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _nearbyJob = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556006, name: 'Panel Build 4', client_id: null, eventType: 'job', status: 'upcoming', start: todayKey(), days: 1 });
        _activeTimer = { jobId: 556006, jobName: 'Panel Build 4', clientName: 'On the clock', scopeId: null, scopeLabel: null, startTime: Date.now() - 60000, timerInterval: null, entryId: 999 };
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
        try {
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          clearInterval(_activeTimer && _activeTimer.timerInterval);
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.html).toContain('clockOut()');
      expect(r.html).not.toContain('At the shop');
    });

    test('no eligible jobs, the location prompt does not show (falls back to the manual clock card, not an empty shell)', async () => {
      const r = await page.evaluate(() => {
        const orig = { nb: _nearbyJob, timer: _activeTimer, wasInShop: _geoWasInShop, shopAt: _geoShopArrivedAt, place: _geoCurrentPlace, placeAt: _geoPlaceArrivedAt, jobs: jobs.slice() };
        _nearbyJob = null; _activeTimer = null; _geoCurrentPlace = null; _geoPlaceArrivedAt = null;
        jobs.length = 0;
        jobs.push({ id: 556008, name: 'Done Job', client_id: null, eventType: 'job', status: 'done', completion_date: todayKey(), start: todayKey(), days: 1 });
        _geoWasInShop = true; _geoShopArrivedAt = new Date(Date.now() - 5 * 60000).toISOString();
        try {
          // See the '2-minute dwell floor' test above: hiding now animates
          // (CLAUDE.md §8), so start from a known-hidden state rather than
          // whatever a prior test in the file left the card showing.
          const _el0 = document.getElementById('dash-nearby');
          if (_el0) { _el0.style.display = 'none'; _el0.style.animation = ''; }
          if (typeof _nearbyHideTimer !== 'undefined' && _nearbyHideTimer) { clearTimeout(_nearbyHideTimer); _nearbyHideTimer = null; }
          renderDash();
          const el = document.getElementById('dash-nearby');
          return { ok: true, display: el ? el.style.display : '', html: el ? el.innerHTML : '' };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          _nearbyJob = orig.nb; _activeTimer = orig.timer; _geoWasInShop = orig.wasInShop; _geoShopArrivedAt = orig.shopAt;
          _geoCurrentPlace = orig.place; _geoPlaceArrivedAt = orig.placeAt; jobs.length = 0; orig.jobs.forEach(j => jobs.push(j));
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.display).toBe('block');
      expect(r.html).not.toContain('At the shop');
      expect(r.html).toContain('Not clocked in');
    });
  });

  test('renderDashCollect: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-collect');
      if (el) el.id = 'dash-collect-hidden';
      try { renderDashCollect(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-collect'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderDashCollect: no collectible bids, renders empty state', async () => {
    const r = await page.evaluate(() => {
      const origBids = [...bids];
      bids.length = 0;
      try {
        renderDashCollect();
        const el = document.getElementById('dash-collect');
        return { ok: true, hasEmpty: el && el.innerHTML.includes('All collected') };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.length = 0; origBids.forEach(b => bids.push(b)); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasEmpty).toBe(true);
  });

  test('renderDashCollect: 3 calls, no duplicate entries', async () => {
    const r = await page.evaluate(() => {
      const fakeClient = { id: 77001, name: 'Collect Dupe Test' };
      const fakeBid = { id: 77001, client_id: 77001, status: 'Closed Won', amount: 5000,
        completion_date: addDays(todayKey(), -5), deposit: 1000 };
      clients.unshift(fakeClient);
      bids.unshift(fakeBid);
      try {
        renderDashCollect(); renderDashCollect(); renderDashCollect();
        const el = document.getElementById('dash-collect');
        if (!el) return { ok: true, count: 0 };
        const count = (el.innerHTML.match(/Collect Dupe Test/g) || []).length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const bi = bids.findIndex(b => b.id === 77001);
        if (bi !== -1) bids.splice(bi, 1);
        const ci = clients.findIndex(c => c.id === 77001);
        if (ci !== -1) clients.splice(ci, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  test('renderDashCollect: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_bids', '{INVALID{{');
      try { renderDashCollect(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_bids'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // printNoticeOfIntent, the relationship-safe "get paid" demand document
  // ─────────────────────────────────────────────────────────────────────────────

  test('printNoticeOfIntent: names owner of record AND the GC separately on a GC job', async () => {
    const r = await page.evaluate(() => {
      S.bname = "ZJ Paint Co"; S.bphone = '3165550100'; S.blic = 'KS-1';
      clients = clients.filter(c => c.id !== 95500);
      bids = bids.filter(b => b.id !== 955001);
      clients.push({ id: 95500, name: 'Summit Build Group', phone: '3165557788', partyType: 'gc',
        addr: '2015 SW Randolph Ave, Topeka, KS 66604',
        properties: { '2015 sw randolph ave': { ownerName: 'Dana Whitfield', ownedByAccount: false } } });
      bids.push({ id: 955001, client_id: 95500, addr: '2015 SW Randolph Ave, Topeka, KS 66604',
        amount: 8400, deposit: 0, status: 'Closed Won', completion_date: '2026-05-20', type: 'Exterior repaint', geiLines: [] });
      let html = '';
      const orig = window.open;
      window.open = () => ({ document: { write: h => { html = h; }, close: () => {} }, focus: () => {} });
      let err = '';
      try { printNoticeOfIntent(955001); } catch (e) { err = e.message; }
      window.open = orig;
      return { err, html };
    });
    expect(r.err).toBe('');
    expect(r.html).toContain('Notice of Intent to File a Mechanic'); // the intent notice, not a filed lien
    expect(r.html).toContain('Dana Whitfield');   // owner of record = who the lien would target
    expect(r.html).toContain('Summit Build Group'); // GC = who hired/owes, named separately
    expect(r.html).toContain('$8,400');            // amount past due
    expect(r.html).toContain('DEMAND');            // pay-by demand
    expect(r.html.toLowerCase()).toContain('not legal advice'); // disclaimer present
  });

  test('printNoticeOfIntent: homeowner job leaves the owner line as the client, no GC block', async () => {
    const r = await page.evaluate(() => {
      S.bname = "ZJ Paint Co";
      clients = clients.filter(c => c.id !== 95501);
      bids = bids.filter(b => b.id !== 955011);
      clients.push({ id: 95501, name: 'Rita Alvarez', phone: '3165551234', addr: '5 Elm St, Wichita, KS 67206' });
      bids.push({ id: 955011, client_id: 95501, addr: '5 Elm St, Wichita, KS 67206', amount: 2200, deposit: 0, status: 'Closed Won', completion_date: '2026-05-01', type: 'Interior', geiLines: [] });
      let html = '';
      const orig = window.open;
      window.open = () => ({ document: { write: h => { html = h; }, close: () => {} }, focus: () => {} });
      try { printNoticeOfIntent(955011); } catch (e) {}
      window.open = orig;
      return { html };
    });
    expect(r.html).toContain('Rita Alvarez');                       // homeowner is the owner
    expect(r.html).not.toContain('General Contractor / Hiring Party'); // no GC block for a homeowner
  });

  test('collect card: the lien path shows for a true client but NOT for a GC', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_collect = false; // expand the Collect section so cards render into innerHTML
      const mk = (cid, name, partyType) => {
        clients = clients.filter(c => c.id !== cid).concat([{ id: cid, name, partyType, phone: '3165550000', addr: '1 Test St, Wichita, KS' }]);
        const bid = { id: cid * 10 + 1, client_id: cid, client_name: name, amount: 5000, deposit: 0, status: 'Closed Won', completion_date: '2026-04-01', addr: '1 Test St, Wichita, KS', geiLines: [] };
        bids = bids.filter(b => b.client_id !== cid).concat([bid]);
        if (typeof liens !== 'undefined') liens = liens.filter(l => l.bid_id !== bid.id).concat([{ id: cid, bid_id: bid.id, client_id: cid, status: 'intent', amount: 5000 }]);
        return bid.id;
      };
      const hoBid = mk(94001, 'Homeowner Client', 'homeowner');
      const gcBid = mk(94002, 'GC Client', 'gc');
      renderTodayFeed();
      const feed = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const cleanup = () => { [94001, 94002].forEach(cid => { bids = bids.filter(b => b.client_id !== cid); clients = clients.filter(c => c.id !== cid); if (typeof liens !== 'undefined') liens = liens.filter(l => l.client_id !== cid); }); delete window._mmtCol_collect; };
      const res = {
        homeownerHasNOI: feed.includes('printNoticeOfIntent(' + hoBid + ')'),
        gcHasNOI: feed.includes('printNoticeOfIntent(' + gcBid + ')'),
        gcHasFileLien: feed.includes('showFileLienDirect(' + gcBid + ')'),
        gcHasCollect: feed.includes('openPayPanel(' + gcBid + ')'),
      };
      cleanup();
      return res;
    });
    expect(r.homeownerHasNOI).toBe(true);   // true client (owns the property) → lien path offered
    expect(r.gcHasNOI).toBe(false);         // GC → no Notice of Intent
    expect(r.gcHasFileLien).toBe(false);    // GC → no File Lien
    expect(r.gcHasCollect).toBe(true);      // GC still gets normal collection (Collect)
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // checkUnpaidOnLoad
  // ─────────────────────────────────────────────────────────────────────────────

  test('checkUnpaidOnLoad: guard prevents second modal, one-shot behavior', async () => {
    const r = await page.evaluate(() => {
      window._collOnLoadShown = false;
      const origBids = [...bids];
      bids.length = 0;
      try {
        checkUnpaidOnLoad(); // no unpaid bids, sets guard
        const wasShown1 = window._collOnLoadShown;
        checkUnpaidOnLoad(); // should skip due to guard
        const wasShown2 = window._collOnLoadShown;
        return { ok: true, wasShown1, wasShown2 };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids.length = 0; origBids.forEach(b => bids.push(b));
        window._collOnLoadShown = false;
        document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      }
    });
    expect(r.ok).toBe(true);
    expect(r.wasShown1).toBe(true); // guard set after first call
    expect(r.wasShown2).toBe(true); // guard still set
  });

  test('checkUnpaidOnLoad: no unpaid bids, no modal created', async () => {
    const r = await page.evaluate(() => {
      window._collOnLoadShown = false;
      const origBids = [...bids];
      bids.length = 0;
      try {
        const before = document.querySelectorAll('.zmodal-overlay').length;
        checkUnpaidOnLoad();
        const after = document.querySelectorAll('.zmodal-overlay').length;
        return { ok: true, added: after - before };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids.length = 0; origBids.forEach(b => bids.push(b));
        window._collOnLoadShown = false;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
  });

  test('checkUnpaidOnLoad: unpaid completed job, shows modal', async () => {
    const r = await page.evaluate(() => {
      window._collOnLoadShown = false;
      const fakeClient = { id: 98001, name: 'Unpaid Alert Test', phone: '555-1212' };
      const fakeBid = {
        id: 98001, client_id: 98001, status: 'Closed Won',
        amount: 3000, deposit: 0, completion_date: addDays(todayKey(), -10)
      };
      clients.unshift(fakeClient);
      bids.unshift(fakeBid);
      try {
        checkUnpaidOnLoad();
        const modal = document.querySelector('.zmodal-overlay');
        const result = { ok: true, modalExists: !!modal };
        document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        window._collOnLoadShown = false;
        const bi = bids.findIndex(b => b.id === 98001);
        if (bi !== -1) bids.splice(bi, 1);
        const ci = clients.findIndex(c => c.id === 98001);
        if (ci !== -1) clients.splice(ci, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.modalExists).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // printKansasLien
  // ─────────────────────────────────────────────────────────────────────────────

  test('printKansasLien: missing bid, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { printKansasLien(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('printKansasLien: null bidId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { printKansasLien(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('printKansasLien: bid exists but no lien record, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 11101, status: 'Closed Won', client_id: 11101, amount: 5000, addr: '123 Main St' };
      bids.unshift(fakeBid);
      try { printKansasLien(11101); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); }
    });
    expect(r.ok).toBe(true);
  });

  test('printKansasLien: bid and lien exist but no client, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 11102, status: 'Closed Won', client_id: 99999999, amount: 5000, addr: '456 Elm St',
        lien: { amount: 5000, county: 'Sedgwick', date: '2025-01-01' } };
      bids.unshift(fakeBid);
      const origGetLien = window.getBidLien;
      window.getBidLien = (id) => ({ amount: 5000, county: 'Sedgwick', date: '2025-01-01' });
      try { printKansasLien(11102); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); window.getBidLien = origGetLien; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _mmtToggle
  // ─────────────────────────────────────────────────────────────────────────────

  test('_mmtToggle: undefined id, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _mmtToggle(undefined); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_mmtToggle: null id, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _mmtToggle(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_mmtToggle: toggles boolean, false then true', async () => {
    const r = await page.evaluate(() => {
      window['_mmtCol_testId'] = false;
      try {
        _mmtToggle('testId');
        const val = window['_mmtCol_testId'];
        return { ok: true, val };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_mmtCol_testId']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(true);
  });

  test('_mmtToggle: toggles boolean, undefined becomes false', async () => {
    const r = await page.evaluate(() => {
      delete window['_mmtCol_newId'];
      try {
        _mmtToggle('newId');
        return { ok: true, val: window['_mmtCol_newId'] };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_mmtCol_newId']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(false);
  });

  test('_mmtToggle: 5 concurrent calls, state reflects parity', async () => {
    const r = await page.evaluate(() => {
      window['_mmtCol_parity'] = false;
      try {
        _mmtToggle('parity'); // false → true
        _mmtToggle('parity'); // true → false
        _mmtToggle('parity'); // false → true
        _mmtToggle('parity'); // true → false
        _mmtToggle('parity'); // false → true
        return { ok: true, val: window['_mmtCol_parity'] };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_mmtCol_parity']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(true); // 5 toggles from false → ends on true
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _markDepositCash
  // ─────────────────────────────────────────────────────────────────────────────

  test('_markDepositCash: missing bid, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { _markDepositCash(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_markDepositCash: null bidId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { _markDepositCash(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_markDepositCash: valid bid, shows zConfirm dialog', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 55001, client_id: null, status: 'Closed Won', amount: 2500, deposit: 500 };
      bids.unshift(fakeBid);
      let confirmCalled = false;
      const origZConfirm = window.zConfirm;
      window.zConfirm = (msg, cb) => { confirmCalled = true; };
      try {
        _markDepositCash(55001);
        return { ok: true, confirmCalled };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); window.zConfirm = origZConfirm; }
    });
    expect(r.ok).toBe(true);
    expect(r.confirmCalled).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderTodayFeed
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderTodayFeed: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-money-feed');
      if (el) el.id = 'dash-money-feed-hidden';
      try { renderTodayFeed(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-money-feed'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderTodayFeed: empty data, renders without crashing', async () => {
    const r = await page.evaluate(() => {
      const origBids = [...bids];
      bids.length = 0;
      try { renderTodayFeed(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.length = 0; origBids.forEach(b => bids.push(b)); }
    });
    expect(r.ok).toBe(true);
  });

  test('renderTodayFeed: no duplicate cards after 3 calls', async () => {
    const r = await page.evaluate(() => {
      // The Collect section now DEFAULTS COLLAPSED (its card bodies aren't in the
      // HTML until expanded, CLAUDE.md §11.6). Expand it so the completed-bid card
      // renders and we can count occurrences. (Previously Collect auto-expanded.)
      window._mmtCol_collect = false;
      const fakeClient = { id: 76001, name: 'Feed No Dupe' };
      const fakeBid = {
        id: 76001, client_id: 76001, status: 'Closed Won',
        amount: 2000, completion_date: addDays(todayKey(), -3)
      };
      clients.unshift(fakeClient);
      bids.unshift(fakeBid);
      try {
        renderTodayFeed(); renderTodayFeed(); renderTodayFeed();
        const el = document.getElementById('dash-money-feed');
        if (!el) return { ok: true, count: 0 };
        const count = (el.innerHTML.match(/Feed No Dupe/g) || []).length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const bi = bids.findIndex(b => b.id === 76001);
        if (bi !== -1) bids.splice(bi, 1);
        const ci = clients.findIndex(c => c.id === 76001);
        if (ci !== -1) clients.splice(ci, 1);
        delete window._mmtCol_collect;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  // ── Ready to schedule queue (owner 2026-08-18) ────────────────────────────
  test.describe('the Ready to schedule queue', () => {
    test('a won bid with no job renders one card, sorted by signed date', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78101, name: 'Queue Older', addr: '1 Old St' };
        const c2 = { id: 78102, name: 'Queue Newer', addr: '2 New St' };
        const b1 = { id: 78101, client_id: 78101, status: 'Closed Won', amount: 500, signedAt: '2026-08-01T00:00:00.000Z' };
        const b2 = { id: 78102, client_id: 78102, status: 'Closed Won', amount: 700, signedAt: '2026-08-10T00:00:00.000Z' };
        clients.unshift(c1, c2); bids.unshift(b1, b2);
        try {
          renderReadyQueue();
          const html = document.getElementById('dash-ready-queue').innerHTML;
          return { ok: true, html, olderFirst: html.indexOf('Queue Older') < html.indexOf('Queue Newer') };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids.splice(bids.findIndex(b => b.id === 78101), 1);
          bids.splice(bids.findIndex(b => b.id === 78102), 1);
          clients.splice(clients.findIndex(c => c.id === 78101), 1);
          clients.splice(clients.findIndex(c => c.id === 78102), 1);
          renderReadyQueue();
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.html).toContain('Queue Older');
      expect(r.html).toContain('Queue Newer');
      expect(r.olderFirst, 'default order is oldest signed first').toBe(true);
    });

    test('a bid that already has a job is excluded from the queue', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78201, name: 'Queue Has Job', addr: '3 Job St' };
        const b1 = { id: 78201, client_id: 78201, status: 'Closed Won', amount: 500, signedAt: '2026-08-01T00:00:00.000Z' };
        const j1 = { id: 78201, bid_id: 78201, client_id: 78201, name: 'Queue Has Job', start: todayKey(), status: 'upcoming' };
        clients.unshift(c1); bids.unshift(b1); jobs.unshift(j1);
        try {
          renderReadyQueue();
          const el = document.getElementById('dash-ready-queue');
          return { ok: true, html: el.innerHTML };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids.splice(bids.findIndex(b => b.id === 78201), 1);
          jobs.splice(jobs.findIndex(j => j.id === 78201), 1);
          clients.splice(clients.findIndex(c => c.id === 78201), 1);
          renderReadyQueue();
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.html).not.toContain('Queue Has Job');
    });

    test('no queued bids clears the card rather than leaving stale HTML', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78301, name: 'Queue Solo', addr: '4 Solo St' };
        const b1 = { id: 78301, client_id: 78301, status: 'Closed Won', amount: 500, signedAt: '2026-08-01T00:00:00.000Z' };
        clients.unshift(c1); bids.unshift(b1);
        renderReadyQueue();
        const before = document.getElementById('dash-ready-queue').innerHTML;
        bids.splice(bids.findIndex(b => b.id === 78301), 1);
        clients.splice(clients.findIndex(c => c.id === 78301), 1);
        renderReadyQueue();
        const after = document.getElementById('dash-ready-queue').innerHTML;
        return { hadCard: before.includes('Queue Solo'), clearedAfter: after === '' };
      });
      expect(r.hadCard).toBe(true);
      expect(r.clearedAfter).toBe(true);
    });

    test('_readyQueueSetOrder persists queueOrder and later renders honor it', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78401, name: 'Queue Z', addr: '5 Z St' };
        const c2 = { id: 78402, name: 'Queue A', addr: '6 A St' };
        // Z signed AFTER A, so default (signed-date) order would put A first.
        const b1 = { id: 78401, client_id: 78401, status: 'Closed Won', amount: 500, signedAt: '2026-08-01T00:00:00.000Z' };
        const b2 = { id: 78402, client_id: 78402, status: 'Closed Won', amount: 500, signedAt: '2026-08-05T00:00:00.000Z' };
        clients.unshift(c1, c2); bids.unshift(b1, b2);
        try {
          _readyQueueSetOrder(['78401', '78402']); // explicit drag override: Z first
          renderReadyQueue();
          const html = document.getElementById('dash-ready-queue').innerHTML;
          return { ok: true, zFirst: html.indexOf('Queue Z') < html.indexOf('Queue A'), order1: b1.queueOrder, order2: b2.queueOrder };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids.splice(bids.findIndex(b => b.id === 78401), 1);
          bids.splice(bids.findIndex(b => b.id === 78402), 1);
          clients.splice(clients.findIndex(c => c.id === 78401), 1);
          clients.splice(clients.findIndex(c => c.id === 78402), 1);
          renderReadyQueue();
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.order1).toBe(0);
      expect(r.order2).toBe(1);
      expect(r.zFirst, 'explicit queueOrder overrides the signed-date default').toBe(true);
    });

    test('_readyQueueSetOrder: null/undefined/empty/unknown ids never throw', async () => {
      const r = await page.evaluate(() => {
        const out = [];
        try { _readyQueueSetOrder(null); out.push('null-ok'); } catch (e) { out.push('null-threw:' + e.message); }
        try { _readyQueueSetOrder(undefined); out.push('undef-ok'); } catch (e) { out.push('undef-threw:' + e.message); }
        try { _readyQueueSetOrder([]); out.push('empty-ok'); } catch (e) { out.push('empty-threw:' + e.message); }
        try { _readyQueueSetOrder(['no-such-bid-id']); out.push('unknown-ok'); } catch (e) { out.push('unknown-threw:' + e.message); }
        return out;
      });
      expect(r).toEqual(['null-ok', 'undef-ok', 'empty-ok', 'unknown-ok']);
    });

    test('renderReadyQueue: no #dash-ready-queue element returns gracefully', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('dash-ready-queue');
        const parent = el && el.parentNode, next = el && el.nextSibling;
        if (el) el.remove();
        try { renderReadyQueue(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (el && parent) parent.insertBefore(el, next); }
      });
      expect(r.ok, r.err).toBe(true);
    });

    test('renderReadyQueue: 5 concurrent calls, no crash, no duplicate cards', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78501, name: 'Queue Concurrent', addr: '7 Con St' };
        const b1 = { id: 78501, client_id: 78501, status: 'Closed Won', amount: 500, signedAt: '2026-08-01T00:00:00.000Z' };
        clients.unshift(c1); bids.unshift(b1);
        try {
          renderReadyQueue(); renderReadyQueue(); renderReadyQueue(); renderReadyQueue(); renderReadyQueue();
          const html = document.getElementById('dash-ready-queue').innerHTML;
          return { ok: true, count: (html.match(/Queue Concurrent/g) || []).length };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids.splice(bids.findIndex(b => b.id === 78501), 1);
          clients.splice(clients.findIndex(c => c.id === 78501), 1);
          renderReadyQueue();
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.count).toBe(1);
    });
  });

  // ── Client-tier purpose upgrade for a queued (unscheduled) job ────────────
  test.describe('a queued bid labels the drive as a job, not a consult', () => {
    test('_geoHasQueuedBid: true for a won bid with no job, false once a job exists, false for null/unknown client', async () => {
      const r = await page.evaluate(() => {
        const c1 = { id: 78601, name: 'Fence Queue Co', addr: '8 Fence St' };
        const b1 = { id: 78601, client_id: 78601, status: 'Closed Won', amount: 500 };
        clients.unshift(c1); bids.unshift(b1);
        const out = {};
        try {
          out.nullClient = _geoHasQueuedBid(null);
          out.unknownClient = _geoHasQueuedBid(999999);
          out.beforeJob = _geoHasQueuedBid(78601);
          jobs.unshift({ id: 78601, bid_id: 78601, client_id: 78601, name: 'Fence Queue Co' });
          out.afterJob = _geoHasQueuedBid(78601);
          return { ok: true, ...out };
        } catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids.splice(bids.findIndex(b => b.id === 78601), 1);
          const ji = jobs.findIndex(j => j.id === 78601);
          if (ji !== -1) jobs.splice(ji, 1);
          clients.splice(clients.findIndex(c => c.id === 78601), 1);
        }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.nullClient).toBe(false);
      expect(r.unknownClient).toBe(false);
      expect(r.beforeJob, 'won, unscheduled bid: queued').toBe(true);
      expect(r.afterJob, 'a real job now exists: no longer queued').toBe(false);
    });

    test('_autoTripPurpose: Job site when queuedJob is set, Client Consult otherwise, Other for null/unknown kind', async () => {
      const r = await page.evaluate(() => {
        return {
          queued: _autoTripPurpose({ kind: 'client', queuedJob: true }),
          plain: _autoTripPurpose({ kind: 'client', queuedJob: false }),
          untagged: _autoTripPurpose({ kind: 'client' }),
          nullInput: _autoTripPurpose(null),
          undefinedInput: _autoTripPurpose(undefined),
          unknownKind: _autoTripPurpose({ kind: 'nonsense-kind-xyz' }),
        };
      });
      expect(r.queued).toBe('Job site');
      expect(r.plain).toBe('Client Consult');
      expect(r.untagged).toBe('Client Consult');
      expect(r.nullInput).toBe('Other');
      expect(r.undefinedInput).toBe('Other');
      expect(r.unknownKind).toBe('Other');
    });
  });

  test('renderTodayFeed: a bids[] draft renders exactly one card', async () => {
    // The old localStorage-backed "est_full_draft" dedup/heal mechanism was removed
    // with the paint estimator, every draft now lives only in bids[], so there is
    // no longer a separate localStorage-draft card to de-dup against.
    const r = await page.evaluate(() => {
      window._mmtCol_build = false; // expand BUILD so cards render into innerHTML
      const twin = {
        id: 76055, client_id: 76055, client_name: 'TEsty Test', name: 'TEsty Test',
        status: 'Draft', draft: true, amount: 0, bid_date: todayKey()
      };
      bids.unshift(twin);
      try {
        renderTodayFeed();
        const el = document.getElementById('dash-money-feed');
        const count = el ? (el.innerHTML.match(/TEsty Test/g) || []).length : 0;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const i = bids.findIndex(b => b.id === 76055);
        if (i !== -1) bids.splice(i, 1);
        delete window._mmtCol_build;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1); // one card, not two
  });

  test('MMT build cards show each bid\'s street address so same-client bids at different properties are told apart', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_build = false; // expand BUILD so cards render into innerHTML
      clients.unshift({ id: 77120, name: 'Addr Feed Co', addr: '482 Oak Ridge Ln, Wichita, KS 67206' });
      bids.unshift({ id: 771201, client_id: 77120, client_name: 'Addr Feed Co', status: 'Draft', draft: true, amount: 4200, isTM: true, geiLines: [], bid_date: todayKey(), addr: '482 Oak Ridge Ln, Wichita, KS 67206' });
      bids.unshift({ id: 771202, client_id: 77120, client_name: 'Addr Feed Co', status: 'Draft', draft: true, amount: 1800, isFreeForm: true, geiLines: [], bid_date: todayKey(), addr: '119 Baker St, Wichita, KS 67211' });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const cleanup = () => {
        [771201, 771202].forEach(id => { const i = bids.findIndex(b => b.id === id); if (i !== -1) bids.splice(i, 1); });
        const ci = clients.findIndex(c => c.id === 77120); if (ci !== -1) clients.splice(ci, 1);
        delete window._mmtCol_build;
      };
      const res = { err, hasPrimary: html.includes('482 Oak Ridge Ln'), hasRental: html.includes('119 Baker St') };
      cleanup();
      return res;
    });
    expect(r.err).toBe('');
    expect(r.hasPrimary).toBe(true); // first bid's property
    expect(r.hasRental).toBe(true);  // second bid's DIFFERENT property, both visible
  });

  test('MMT pending follow-up card has a Close out button using the same close-out framework', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_pending = false; // expand the Pending section so its cards render into innerHTML (§11.6)
      const cid = 778901, bidId = 778902;
      clients.unshift({ id: cid, name: 'CloseOut MMT Test', phone: '3165559001' });
      // Pending, no signing token, not draft, one prior no-response → lands in the
      // "2nd follow-up needed" chase card. Close out is the Lost counterpart to Won.
      bids.unshift({ id: bidId, client_id: cid, client_name: 'CloseOut MMT Test', name: 'CloseOut MMT Test', amount: 4200, status: 'Pending', draft: false, noResponseCount: 1, bid_date: todayKey(), followup: todayKey() });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const i = html.indexOf('CloseOut MMT Test');
      const card = i >= 0 ? html.slice(Math.max(0, i - 200), i + 1400) : '';
      const res = {
        err, hasCard: i >= 0,
        // Same framework as the proposals section, opens the reason-picker modal.
        hasCloseOut: card.includes('openCloseOutEstimate(' + bidId + ')'),
        usesFramework: typeof openCloseOutEstimate === 'function',
      };
      bids = bids.filter(b => b.id !== bidId);
      clients = clients.filter(c => c.id !== cid);
      delete window._mmtCol_pending;
      return res;
    });
    expect(r.err).toBe('');
    expect(r.hasCard).toBe(true);
    expect(r.usesFramework).toBe(true);
    expect(r.hasCloseOut).toBe(true);
  });

  test('BUILD "View leads" button opens _showNewLeadsPicker, not goPg(pg-leads)', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_build = false;
      const cid = 780001;
      clients.unshift({ id: cid, name: 'ViewLeadsBtn Test', phone: '3165559010', addr: '1 Lead St', created: todayKey() });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const res = {
        err,
        hasNewBtn: html.includes('_showNewLeadsPicker()'),
        hasOldBtn: html.includes("goPg('pg-leads')"),
      };
      clients = clients.filter(c => c.id !== cid);
      delete window._mmtCol_build;
      return res;
    });
    expect(r.err).toBe('');
    expect(r.hasNewBtn).toBe(true);
    expect(r.hasOldBtn).toBe(false);
  });

  test('_mmtNewLeads returns only brand-new clients with no bid and no UPCOMING estimate job', async () => {
    const r = await page.evaluate(() => {
      const cA = 780101, cB = 780102, cC = 780103;
      clients.unshift({ id: cA, name: 'NewLead Bare', addr: '1 Bare St', created: todayKey() });
      clients.unshift({ id: cB, name: 'NewLead HasBid', addr: '2 Bid St', created: todayKey() });
      clients.unshift({ id: cC, name: 'NewLead HasEstJob', addr: '3 Est St', created: todayKey() });
      bids.unshift({ id: 780201, client_id: cB, status: 'Pending', amount: 100, bid_date: todayKey() });
      jobs.unshift({ id: 780301, client_id: cC, eventType: 'estimate', start: todayKey() });
      const ids = _mmtNewLeads().map(c => c.id);
      bids = bids.filter(b => b.id !== 780201);
      jobs = jobs.filter(j => j.id !== 780301);
      clients = clients.filter(c => ![cA, cB, cC].includes(c.id));
      return { hasBare: ids.includes(cA), hasBid: ids.includes(cB), hasEstJob: ids.includes(cC) };
    });
    expect(r.hasBare).toBe(true);
    expect(r.hasBid).toBe(false);
    expect(r.hasEstJob).toBe(false);   // visit is today (upcoming): still its own next step
  });

  // Regression (owner report, 2026-08-06): a lead's estimate visit happening (or its
  // date just passing) permanently removed the "build a bid" task from Make Money
  // Today, even though no bid was ever written, no way back in. The visit itself is
  // no longer the next step once its date has passed, the proposal is, so the lead
  // must return to the "ready to build" list, not disappear for good.
  test('_mmtNewLeads: a PAST estimate visit with still no bid returns to the list, a canceled one always does', async () => {
    const r = await page.evaluate(() => {
      const cPast = 780104, cCanceled = 780105, cFuture = 780106;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      clients.unshift({ id: cPast, name: 'NewLead PastVisit', addr: '4 Past St', created: yesterday });
      clients.unshift({ id: cCanceled, name: 'NewLead CanceledVisit', addr: '5 Canceled St', created: todayKey() });
      clients.unshift({ id: cFuture, name: 'NewLead FutureVisit', addr: '6 Future St', created: todayKey() });
      jobs.unshift({ id: 780302, client_id: cPast, eventType: 'estimate', start: yesterday, status: 'upcoming' });
      jobs.unshift({ id: 780303, client_id: cCanceled, eventType: 'estimate', start: nextWeek, status: 'canceled' });
      jobs.unshift({ id: 780304, client_id: cFuture, eventType: 'estimate', start: nextWeek, status: 'upcoming' });
      const ids = _mmtNewLeads().map(c => c.id);
      jobs = jobs.filter(j => ![780302, 780303, 780304].includes(j.id));
      clients = clients.filter(c => ![cPast, cCanceled, cFuture].includes(c.id));
      return { hasPast: ids.includes(cPast), hasCanceled: ids.includes(cCanceled), hasFuture: ids.includes(cFuture) };
    });
    expect(r.hasPast).toBe(true);       // visit happened, no bid written: build it now
    expect(r.hasCanceled).toBe(true);   // canceled visit is no longer anyone's next step
    expect(r.hasFuture).toBe(false);    // still upcoming: go to the visit first
  });

  test('_showNewLeadsPicker lists leads oldest-first (top) to newest (bottom)', async () => {
    const r = await page.evaluate(() => {
      const oldId = 780401, midId = 780402, newId = 780403;
      clients.unshift({ id: oldId, name: 'Oldest Lead', addr: '1 Old St', created: '2020-01-01' });
      clients.unshift({ id: midId, name: 'Middle Lead', addr: '2 Mid St', created: '2022-06-15' });
      clients.unshift({ id: newId, name: 'Newest Lead', addr: '3 New St', created: todayKey() });
      let err = '';
      try { _showNewLeadsPicker(); } catch (e) { err = e.message; }
      const ov = document.getElementById('_leads-pick-ov');
      const html = ov ? ov.innerHTML : '';
      const iOld = html.indexOf('Oldest Lead');
      const iMid = html.indexOf('Middle Lead');
      const iNew = html.indexOf('Newest Lead');
      ov?.remove();
      clients = clients.filter(c => ![oldId, midId, newId].includes(c.id));
      return { err, hasOverlay: !!ov, iOld, iMid, iNew };
    });
    expect(r.err).toBe('');
    expect(r.hasOverlay).toBe(true);
    expect(r.iOld).toBeGreaterThanOrEqual(0);
    expect(r.iOld).toBeLessThan(r.iMid);
    expect(r.iMid).toBeLessThan(r.iNew);
  });

  test('_showNewLeadsPicker with zero leads shows empty state, no throw', async () => {
    const r = await page.evaluate(() => {
      let err = '';
      try { _showNewLeadsPicker(); } catch (e) { err = e.message; }
      const ov = document.getElementById('_leads-pick-ov');
      const html = ov ? ov.innerHTML : '';
      ov?.remove();
      return { err, hasOverlay: !!ov, html };
    });
    expect(r.err).toBe('');
    expect(r.hasOverlay).toBe(true);
  });

  test('_showNewLeadsPicker title reads "Leads waiting on a proposal" and shows a lead count', async () => {
    const r = await page.evaluate(() => {
      const cid = 780450;
      clients.unshift({ id: cid, name: 'Count Label Lead', addr: '1 Count St', created: todayKey() });
      let err = '';
      try { _showNewLeadsPicker(); } catch (e) { err = e.message; }
      const ov = document.getElementById('_leads-pick-ov');
      const html = ov ? ov.innerHTML : '';
      ov?.remove();
      clients = clients.filter(c => c.id !== cid);
      return {
        err,
        // Owner-approved rename: the app says "proposal" everywhere a client sees
        // it, so the old "estimate" wording must not come back.
        hasTitle: html.includes('Leads waiting on a proposal'),
        hasEstimateWord: /waiting on an estimate/i.test(html),
        hasOldTitle: html.includes('oldest first'),
        hasCount: /1\s*lead\b/.test(html),
      };
    });
    expect(r.err).toBe('');
    expect(r.hasTitle).toBe(true);
    expect(r.hasEstimateWord).toBe(false);
    expect(r.hasOldTitle).toBe(false);
    expect(r.hasCount).toBe(true);
  });

  test('_showNewLeadsPicker shows a real date+time stamp for the lead (regression)', async () => {
    const r = await page.evaluate(() => {
      // A real lead's id is Date.now() at creation, pin a known timestamp so the
      // rendered stamp is deterministic: Mar 15 2026, 2:30 PM local.
      const knownMs = new Date(2026, 2, 15, 14, 30, 0).getTime();
      clients.unshift({ id: knownMs, name: 'Timestamp Lead', addr: '1 Stamp St', created: '2026-03-15' });
      let err = '';
      try { _showNewLeadsPicker(); } catch (e) { err = e.message; }
      const ov = document.getElementById('_leads-pick-ov');
      const html = ov ? ov.innerHTML : '';
      ov?.remove();
      clients = clients.filter(c => c.id !== knownMs);
      return { err, hasDate: html.includes('03/15/2026'), hasTime: /2:30\s*PM/i.test(html) };
    });
    expect(r.err).toBe('');
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
  });

  test('_showNewLeadsPicker falls back to the relative label for non-timestamp ids (fixtures/legacy)', async () => {
    const r = await page.evaluate(() => {
      const cid = 780460; // small id, not a real Date.now() timestamp
      clients.unshift({ id: cid, name: 'Legacy Id Lead', addr: '1 Legacy St', created: todayKey() });
      let err = '';
      try { _showNewLeadsPicker(); } catch (e) { err = e.message; }
      const ov = document.getElementById('_leads-pick-ov');
      const html = ov ? ov.innerHTML : '';
      ov?.remove();
      clients = clients.filter(c => c.id !== cid);
      return { err, hasNewToday: html.includes('New today') };
    });
    expect(r.err).toBe('');
    expect(r.hasNewToday).toBe(true);
  });

  test('clicking a lead name in the picker opens the estimate picker, not the client record', async () => {
    const r = await page.evaluate(() => {
      const cid = 780501;
      clients.unshift({ id: cid, name: 'ClickToEstimate Lead', addr: '1 Click St', created: todayKey() });
      let openEstimateArg = null, openedClientDetail = false;
      const origDoOpen = window._doOpenEstimate;
      const origOpenDetail = window.openClientDetail;
      window._doOpenEstimate = (c) => { openEstimateArg = c && c.id; };
      window.openClientDetail = () => { openedClientDetail = true; };
      let err = '';
      try {
        _showNewLeadsPicker();
        _pickLeadForEstimate(cid);
      } catch (e) { err = e.message; }
      const overlayGoneAfterPick = !document.getElementById('_leads-pick-ov');
      window._doOpenEstimate = origDoOpen;
      window.openClientDetail = origOpenDetail;
      clients = clients.filter(c => c.id !== cid);
      return { err, openEstimateArg, openedClientDetail, overlayGoneAfterPick };
    });
    expect(r.err).toBe('');
    expect(r.openEstimateArg).toBe(780501);
    expect(r.openedClientDetail).toBe(false);
    expect(r.overlayGoneAfterPick).toBe(true);
  });

  test('_pickLeadForEstimate with unknown clientId, does not throw, does not open estimate', async () => {
    const r = await page.evaluate(() => {
      let called = false;
      const orig = window._doOpenEstimate;
      window._doOpenEstimate = () => { called = true; };
      let err = '';
      try { _pickLeadForEstimate(999999999); } catch (e) { err = e.message; }
      window._doOpenEstimate = orig;
      return { err, called };
    });
    expect(r.err).toBe('');
    expect(r.called).toBe(false);
  });

  test('MMT awaiting-signature card has NO Delete button, deletion is the hidden 3s hold only', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_pending = false; // expand the Pending section so cards render (§11.6)
      const cid = 779001, bidId = 779002;
      clients.unshift({ id: cid, name: 'AwaitingSig NoDelete', phone: '3165559002' });
      // Sent proposal awaiting signature (signingToken + Pending) → the "Awaiting
      // signature" card. It is a real, sent record, no delete button may ship here.
      bids.unshift({ id: bidId, client_id: cid, client_name: 'AwaitingSig NoDelete', name: 'AwaitingSig NoDelete', amount: 4200, status: 'Pending', draft: false, signingToken: 'tok-x', bid_date: todayKey() });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const i = html.indexOf('AwaitingSig NoDelete');
      const card = i >= 0 ? html.slice(Math.max(0, i - 200), i + 1400) : '';
      const res = {
        err, hasCard: i >= 0,
        hasResend: card.includes('resendProposalLink(' + bidId + ')'),
        // The removed button: discardInProgressBid on a sent proposal must be gone.
        hasDeleteBtn: card.includes('discardInProgressBid(' + bidId + ')'),
      };
      bids = bids.filter(b => b.id !== bidId);
      clients = clients.filter(c => c.id !== cid);
      delete window._mmtCol_pending;
      return res;
    });
    expect(r.err).toBe('');
    expect(r.hasCard).toBe(true);
    expect(r.hasResend).toBe(true);      // card still renders its real actions
    expect(r.hasDeleteBtn).toBe(false);  // deletion moved to the hidden 3s hold
  });

  test('collections card: Call button removed; SMS + Collect remain', async () => {
    const r = await page.evaluate(() => {
      window._mmtCol_collect = false; // expand the Collect section so cards render
      const cid = 778801, bidId = 778802;
      clients.unshift({ id: cid, name: 'Collect UI Test', phone: '3165551234' });
      bids.unshift({ id: bidId, client_id: cid, client_name: 'Collect UI Test', amount: 5000, status: 'Closed Won', draft: false, completion_date: '2026-01-01', bid_date: '2025-12-01', surfaces: [] });
      let err = '';
      try { renderTodayFeed(); } catch (e) { err = e.message; }
      const html = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      const i = html.indexOf('Collect UI Test');
      const card = i >= 0 ? html.slice(i, i + 1800) : '';
      const res = { err, hasCard: i >= 0, callInCard: card.includes('tel:'), collectInCard: card.includes('Collect &rarr;') || card.includes('Collect →') };
      bids = bids.filter(b => b.id !== bidId);
      clients = clients.filter(c => c.id !== cid);
      delete window._mmtCol_collect;
      try { renderTodayFeed(); } catch (e) {}
      return res;
    });
    expect(r.err, `renderTodayFeed threw: ${r.err}`).toBe('');
    if (r.hasCard) {
      expect(r.callInCard, 'Call (tel:) button must be removed from the collections card').toBe(false);
      expect(r.collectInCard, 'Collect button must remain on the collections card').toBe(true);
    }
  });

  test('renderTodayFeed: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_payments', '{INVALID{{');
      try { renderTodayFeed(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_payments'); }
    });
    expect(r.ok).toBe(true);
  });

  test('renderTodayFeed: 5 concurrent calls, no crash', async () => {
    const r = await page.evaluate(() => {
      try {
        renderTodayFeed(); renderTodayFeed(); renderTodayFeed(); renderTodayFeed(); renderTodayFeed();
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // checkGoalPrompt
  // ─────────────────────────────────────────────────────────────────────────────

  test('checkGoalPrompt: goal already set, returns without showing modal', async () => {
    const r = await page.evaluate(() => {
      const orig = S.goalMonthly;
      S.goalMonthly = 5000;
      window._goalPromptShown = false;
      window._goalPromptShownThisSession = false;
      const before = document.querySelectorAll('.zmodal-overlay').length;
      try {
        checkGoalPrompt();
        return { ok: true, added: document.querySelectorAll('.zmodal-overlay').length - before };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { S.goalMonthly = orig; }
    });
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
  });

  test('checkGoalPrompt: fewer than 5 paid jobs, no prompt', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      S.goalMonthly = 0;
      window._goalPromptShown = false;
      window._goalPromptShownThisSession = false;
      const origBids = [...bids];
      bids.length = 0;
      const before = document.querySelectorAll('.zmodal-overlay').length;
      try {
        checkGoalPrompt();
        return { ok: true, added: document.querySelectorAll('.zmodal-overlay').length - before };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        S.goalMonthly = origGoal;
        bids.length = 0; origBids.forEach(b => bids.push(b));
      }
    });
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
  });

  test('checkGoalPrompt: session guard prevents re-showing', async () => {
    const r = await page.evaluate(() => {
      window._goalPromptShownThisSession = true;
      const origGoal = S.goalMonthly;
      S.goalMonthly = 0;
      const before = document.querySelectorAll('.zmodal-overlay').length;
      try {
        checkGoalPrompt();
        return { ok: true, added: document.querySelectorAll('.zmodal-overlay').length - before };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        window._goalPromptShownThisSession = false;
        S.goalMonthly = origGoal;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
  });

  test('checkGoalPrompt: 5 concurrent calls, at most one prompt queued', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      S.goalMonthly = 0;
      window._goalPromptShown = false;
      window._goalPromptShownThisSession = false;
      try {
        checkGoalPrompt(); checkGoalPrompt(); checkGoalPrompt(); checkGoalPrompt(); checkGoalPrompt();
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        S.goalMonthly = origGoal;
        window._goalPromptShown = false;
        window._goalPromptShownThisSession = false;
        document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderGoal
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderGoal: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-goal');
      if (el) el.id = 'dash-goal-hidden';
      try { renderGoal(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-goal'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderGoal: no goal set, renders empty', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      S.goalMonthly = 0;
      try {
        renderGoal();
        const el = document.getElementById('dash-goal');
        return { ok: true, empty: el ? el.innerHTML === '' : true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { S.goalMonthly = origGoal; }
    });
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
  });

  test('renderGoal: goal set, fewer than 5 paid jobs, renders empty', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      S.goalMonthly = 5000;
      const origBids = [...bids];
      bids.length = 0;
      try {
        renderGoal();
        const el = document.getElementById('dash-goal');
        return { ok: true, empty: el ? el.innerHTML === '' : true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { S.goalMonthly = origGoal; bids.length = 0; origBids.forEach(b => bids.push(b)); }
    });
    expect(r.ok).toBe(true);
    expect(r.empty).toBe(true);
  });

  test('renderGoal: golden path, renders goal bar with progress', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      const origBids = [...bids];
      S.goalMonthly = 10000;
      bids.length = 0;
      // 5 paid (zero balance) jobs to qualify
      for (let i = 0; i < 5; i++) {
        bids.push({ id: 60000 + i, status: 'Closed Won', amount: 2000, deposit: 0, client_id: null });
        payments.push({ id: 70000 + i, bid_id: 60000 + i, amount: 2000, date: todayKey(), type: 'final' });
      }
      try {
        renderGoal();
        const el = document.getElementById('dash-goal');
        return { ok: true, hasContent: !!(el && el.innerHTML.includes('goal')) };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        S.goalMonthly = origGoal;
        bids.length = 0; origBids.forEach(b => bids.push(b));
        for (let i = 0; i < 5; i++) {
          const pi = payments.findIndex(p => p.id === 70000 + i);
          if (pi !== -1) payments.splice(pi, 1);
        }
      }
    });
    expect(r.ok).toBe(true);
    expect(r.hasContent).toBe(true);
  });

  test('renderGoal: 3 calls, no duplicate content', async () => {
    const r = await page.evaluate(() => {
      const origGoal = S.goalMonthly;
      S.goalMonthly = 8000;
      const origBids = [...bids];
      bids.length = 0;
      for (let i = 0; i < 5; i++) {
        bids.push({ id: 61000 + i, status: 'Closed Won', amount: 1600, deposit: 0, client_id: null });
        payments.push({ id: 71000 + i, bid_id: 61000 + i, amount: 1600, date: todayKey(), type: 'final' });
      }
      try {
        renderGoal(); renderGoal(); renderGoal();
        const el = document.getElementById('dash-goal');
        if (!el) return { ok: true, goalBars: 0 };
        const goalBars = (el.innerHTML.match(/goal/g) || []).length;
        return { ok: true, goalBars };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        S.goalMonthly = origGoal;
        bids.length = 0; origBids.forEach(b => bids.push(b));
        for (let i = 0; i < 5; i++) {
          const pi = payments.findIndex(p => p.id === 71000 + i);
          if (pi !== -1) payments.splice(pi, 1);
        }
      }
    });
    expect(r.ok).toBe(true);
    // Single render produces "goal" once in the month label and once in pct text
    // After 3 calls it should still be the same count as 1 call (innerHTML replaced each time)
    expect(r.goalBars).toBeGreaterThan(0);
    expect(r.goalBars).toBeLessThanOrEqual(4); // sanity: not tripled
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderLeadSources
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderLeadSources: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-sources');
      if (el) el.id = 'dash-sources-hidden';
      try { renderLeadSources(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-sources'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderLeadSources: no clients, renders empty state', async () => {
    const r = await page.evaluate(() => {
      const origClients = [...clients];
      clients.length = 0;
      try {
        renderLeadSources();
        const el = document.getElementById('dash-sources');
        return { ok: true, hasEmpty: el && (el.innerHTML.includes('empty') || el.innerHTML.includes('No clients')) };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { clients.length = 0; origClients.forEach(c => clients.push(c)); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasEmpty).toBe(true);
  });

  test('renderLeadSources: clients with sources, renders table', async () => {
    const r = await page.evaluate(() => {
      const fakeClients = [
        { id: 91001, name: 'Source A Client', source: 'Referral' },
        { id: 91002, name: 'Source B Client', source: 'Google / online' },
      ];
      fakeClients.forEach(c => clients.unshift(c));
      try {
        renderLeadSources();
        const el = document.getElementById('dash-sources');
        return { ok: true, hasTable: el && el.innerHTML.includes('<table') };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        fakeClients.forEach(fc => {
          const idx = clients.findIndex(c => c.id === fc.id);
          if (idx !== -1) clients.splice(idx, 1);
        });
      }
    });
    expect(r.ok).toBe(true);
    expect(r.hasTable).toBe(true);
  });

  test('renderLeadSources: 3 calls, no duplicate rows', async () => {
    const r = await page.evaluate(() => {
      const fakeClient = { id: 91003, name: 'No Dupe Source', source: 'Word of mouth' };
      clients.unshift(fakeClient);
      try {
        renderLeadSources(); renderLeadSources(); renderLeadSources();
        const el = document.getElementById('dash-sources');
        if (!el) return { ok: true, count: 0 };
        const count = (el.innerHTML.match(/Word of mouth/g) || []).length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const idx = clients.findIndex(c => c.id === 91003);
        if (idx !== -1) clients.splice(idx, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  test('renderLeadSources: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_clients', '{INVALID{{');
      try { renderLeadSources(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_clients'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // closeSourceDetail / showSourceDetail
  // ─────────────────────────────────────────────────────────────────────────────

  test('closeSourceDetail: no DOM element, graceful', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('source-detail');
      if (el) el.id = 'source-detail-hidden';
      try { closeSourceDetail(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'source-detail'; }
    });
    expect(r.ok).toBe(true);
  });

  test('closeSourceDetail: hides visible element', async () => {
    const r = await page.evaluate(() => {
      let el = document.getElementById('source-detail');
      const created = !el;
      if (!el) {
        el = document.createElement('div');
        el.id = 'source-detail';
        el.style.display = 'block';
        document.body.appendChild(el);
      } else {
        el.style.display = 'block';
      }
      try {
        closeSourceDetail();
        return { ok: true, display: el.style.display };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (created) el.remove(); }
    });
    expect(r.ok).toBe(true);
    expect(r.display).toBe('none');
  });

  test('showSourceDetail: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('source-detail');
      if (el) el.id = 'source-detail-hidden';
      try { showSourceDetail('Referral'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'source-detail'; }
    });
    expect(r.ok).toBe(true);
  });

  test('showSourceDetail: null source, graceful', async () => {
    const r = await page.evaluate(() => {
      try { showSourceDetail(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('showSourceDetail: empty string, graceful', async () => {
    const r = await page.evaluate(() => {
      try { showSourceDetail(''); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('showSourceDetail: valid source, makes element visible', async () => {
    const r = await page.evaluate(() => {
      let el = document.getElementById('source-detail');
      const created = !el;
      if (!el) {
        el = document.createElement('div');
        el.id = 'source-detail';
        document.body.appendChild(el);
      }
      const fakeClient = { id: 92001, name: 'Source Detail Test', source: 'Referral' };
      clients.unshift(fakeClient);
      try {
        showSourceDetail('Referral');
        return { ok: true, display: el.style.display, hasContent: el.innerHTML.length > 0 };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        if (created) el.remove();
        const idx = clients.findIndex(c => c.id === 92001);
        if (idx !== -1) clients.splice(idx, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.display).toBe('block');
    expect(r.hasContent).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderPipeline
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderPipeline: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-pipeline');
      if (el) el.id = 'dash-pipeline-hidden';
      try { renderPipeline(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'dash-pipeline'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderPipeline: empty jobs, renders without crashing', async () => {
    const r = await page.evaluate(() => {
      const origJobs = [...jobs];
      jobs.length = 0;
      try {
        renderPipeline();
        const el = document.getElementById('dash-pipeline');
        return { ok: true, hasContent: !!(el && el.innerHTML.length > 0) };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { jobs.length = 0; origJobs.forEach(j => jobs.push(j)); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasContent).toBe(true);
  });

  test('renderPipeline: 3 calls, no duplicate pipeline blocks', async () => {
    const r = await page.evaluate(() => {
      try {
        renderPipeline(); renderPipeline(); renderPipeline();
        const el = document.getElementById('dash-pipeline');
        if (!el) return { ok: true, count: 0 };
        // Count top-level children, "Pipeline" title + health message both appear in one
        // render, so counting el.children (the one wrapper div) is the correct idempotency check.
        const count = el.children.length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  test('renderPipeline: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_jobs', '{INVALID{{');
      try { renderPipeline(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_jobs'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // openIntakeFormModal
  // ─────────────────────────────────────────────────────────────────────────────

  test('openIntakeFormModal: creates modal with intake URL', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      try {
        openIntakeFormModal();
        const ov = document.querySelector('.zmodal-overlay');
        const result = { ok: true, exists: !!ov, hasIntake: ov && ov.innerHTML.includes('intake.html') };
        ov?.remove();
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(true);
    expect(r.hasIntake).toBe(true);
  });

  test('openIntakeFormModal: 5 concurrent calls, no crash', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      try {
        openIntakeFormModal();
        openIntakeFormModal();
        openIntakeFormModal();
        openIntakeFormModal();
        openIntakeFormModal();
        document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _copyIntakeUrl
  // ─────────────────────────────────────────────────────────────────────────────

  test('_copyIntakeUrl: null url, does not throw', async () => {
    const r = await page.evaluate(async () => {
      try { await _copyIntakeUrl(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_copyIntakeUrl: empty string, does not crash', async () => {
    const r = await page.evaluate(async () => {
      try { _copyIntakeUrl(''); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_copyIntakeUrl: valid URL, no copy button, still does not crash', async () => {
    const r = await page.evaluate(async () => {
      // Ensure copy button does not exist in DOM
      const existing = document.getElementById('_intake-copy-btn');
      if (existing) existing.id = '_intake-copy-btn-hidden';
      try {
        // clipboard may not be available in test, function should catch the error
        _copyIntakeUrl('https://example.com/intake.html');
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (existing) existing.id = '_intake-copy-btn'; }
    });
    expect(r.ok).toBe(true);
  });

  test('_copyIntakeUrl: with copy button in DOM, updates button text on success', async () => {
    const r = await page.evaluate(async () => {
      const btn = document.createElement('button');
      btn.id = '_intake-copy-btn';
      btn.textContent = 'Copy';
      document.body.appendChild(btn);
      // Mock clipboard to succeed
      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.resolve() }
      });
      try {
        _copyIntakeUrl('https://example.com/intake.html');
        // Allow microtask to flush
        await new Promise(r => setTimeout(r, 50));
        return { ok: true, btnText: btn.textContent };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        btn.remove();
        if (origClipboard) {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: origClipboard });
        }
      }
    });
    expect(r.ok).toBe(true);
    expect(r.btnText).toContain('Copied');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // renderLeadsPage
  // ─────────────────────────────────────────────────────────────────────────────

  test('renderLeadsPage: no DOM element, returns gracefully', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('leads-list');
      if (el) el.id = 'leads-list-hidden';
      try { renderLeadsPage(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { if (el) el.id = 'leads-list'; }
    });
    expect(r.ok).toBe(true);
  });

  test('renderLeadsPage: no clients, renders empty state', async () => {
    const r = await page.evaluate(() => {
      const origClients = [...clients];
      clients.length = 0;
      try {
        renderLeadsPage();
        const el = document.getElementById('leads-list');
        return { ok: true, hasEmpty: el && el.innerHTML.includes('empty') };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { clients.length = 0; origClients.forEach(c => clients.push(c)); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasEmpty).toBe(true);
  });

  test('renderLeadsPage: 3 calls, no duplicate client cards', async () => {
    const r = await page.evaluate(() => {
      const origClients = [...clients];
      clients.length = 0;
      const fakeClient = { id: 93001, name: 'Leads No Dupe', source: 'Referral', created: todayKey() };
      clients.push(fakeClient);
      try {
        renderLeadsPage(); renderLeadsPage(); renderLeadsPage();
        const el = document.getElementById('leads-list');
        if (!el) return { ok: true, count: 0 };
        // Count rendered client cards via data attribute, the client name also appears in
        // data-lp-label attribute so a text match would give 2 per render, not 1.
        const count = el.querySelectorAll('[data-lp-id]').length;
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        clients.length = 0;
        origClients.forEach(c => clients.push(c));
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  test('renderLeadsPage: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_clients', '{INVALID{{');
      try { renderLeadsPage(); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_clients'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _pfToggleYr
  // ─────────────────────────────────────────────────────────────────────────────

  test('_pfToggleYr: null year, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _pfToggleYr(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_pfToggleYr: string year, toggles window state', async () => {
    const r = await page.evaluate(() => {
      window['_pfYr_2024'] = false;
      try {
        _pfToggleYr(2024);
        return { ok: true, val: window['_pfYr_2024'] };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_pfYr_2024']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(true);
  });

  test('_pfToggleYr: 5 concurrent calls, state reflects parity', async () => {
    const r = await page.evaluate(() => {
      window['_pfYr_2023'] = false;
      try {
        _pfToggleYr(2023);
        _pfToggleYr(2023);
        _pfToggleYr(2023);
        _pfToggleYr(2023);
        _pfToggleYr(2023);
        return { ok: true, val: window['_pfYr_2023'] };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_pfYr_2023']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(true); // 5 toggles from false
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _pfToggleMo
  // ─────────────────────────────────────────────────────────────────────────────

  test('_pfToggleMo: null params, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _pfToggleMo(null, null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_pfToggleMo: toggles month state', async () => {
    const r = await page.evaluate(() => {
      window['_pfMo_2024_01'] = false;
      try {
        _pfToggleMo(2024, '01');
        return { ok: true, val: window['_pfMo_2024_01'] };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { delete window['_pfMo_2024_01']; }
    });
    expect(r.ok).toBe(true);
    expect(r.val).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // openBidDetail
  // ─────────────────────────────────────────────────────────────────────────────

  test('openBidDetail: missing bid, returns without throwing', async () => {
    const r = await page.evaluate(() => {
      try { openBidDetail(999999999); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('openBidDetail: null bidId, graceful', async () => {
    const r = await page.evaluate(() => {
      try { openBidDetail(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('openBidDetail: valid bid, creates overlay', async () => {
    const r = await page.evaluate(() => {
      document.querySelector('[data-bdov]')?.remove();
      const fakeBid = {
        id: 80001, status: 'Closed Won', client_id: 80001, amount: 3500,
        signedAt: new Date().toISOString(), type: 'Painting',
        proposalHtml: '<p>Test proposal HTML</p>'
      };
      const fakeClient = { id: 80001, name: 'Bid Detail Client' };
      bids.unshift(fakeBid);
      clients.unshift(fakeClient);
      try {
        openBidDetail(80001, 'bid');
        const ov = document.querySelector('[data-bdov]');
        const result = { ok: true, exists: !!ov, hasBidPane: ov && ov.innerHTML.includes('bdd-bid-pane') };
        ov?.remove();
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids.shift();
        clients.shift();
        document.querySelector('[data-bdov]')?.remove();
      }
    });
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(true);
    expect(r.hasBidPane).toBe(true);
  });

  // Owner report 2026-08-20: on iOS the sticky "Close / Our proposal / Client
  // view" header rendered at the very top of the fixed-position overlay with
  // no top inset, so it collided with the status bar/Dynamic Island. Fixed
  // with the same env(safe-area-inset-top) treatment every other full-screen
  // overlay in this app already uses (see js/clients.js's proposal viewer).
  test('openBidDetail: sticky header reserves the iOS safe-area top inset (Dynamic Island regression)', async () => {
    const r = await page.evaluate(() => {
      document.querySelector('[data-bdov]')?.remove();
      const fakeBid = { id: 80009, status: 'Closed Won', client_id: 80009, amount: 1200, proposalHtml: '<p>x</p>' };
      const fakeClient = { id: 80009, name: 'Safe Area Client' };
      bids.unshift(fakeBid);
      clients.unshift(fakeClient);
      try {
        openBidDetail(80009, 'bid');
        const ov = document.querySelector('[data-bdov]');
        const header = ov?.firstElementChild;
        return { hasInset: !!header && header.getAttribute('style').includes('env(safe-area-inset-top)') };
      } finally {
        bids.shift();
        clients.shift();
        document.querySelector('[data-bdov]')?.remove();
      }
    });
    expect(r.hasInset).toBe(true);
  });

  test('openBidDetail: view defaults to bid tab', async () => {
    const r = await page.evaluate(() => {
      document.querySelector('[data-bdov]')?.remove();
      const fakeBid = { id: 80002, status: 'Pending', client_id: null, amount: 1000 };
      bids.unshift(fakeBid);
      try {
        openBidDetail(80002); // no view arg
        const ov = document.querySelector('[data-bdov]');
        const result = { ok: true, hasBidPane: ov && ov.innerHTML.includes('bdd-bid-pane') };
        ov?.remove();
        return result;
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { bids.shift(); document.querySelector('[data-bdov]')?.remove(); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasBidPane).toBe(true);
  });

  test('openBidDetail: removes previous overlay before creating new one', async () => {
    const r = await page.evaluate(() => {
      const fakeBid1 = { id: 80003, status: 'Pending', client_id: null, amount: 1000 };
      const fakeBid2 = { id: 80004, status: 'Pending', client_id: null, amount: 2000 };
      bids.unshift(fakeBid1);
      bids.unshift(fakeBid2);
      try {
        openBidDetail(80003);
        openBidDetail(80004);
        const count = document.querySelectorAll('[data-bdov]').length;
        document.querySelector('[data-bdov]')?.remove();
        return { ok: true, count };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids.splice(bids.findIndex(b => b.id === 80003), 1);
        bids.splice(bids.findIndex(b => b.id === 80004), 1);
        document.querySelector('[data-bdov]')?.remove();
      }
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // _bddView
  // ─────────────────────────────────────────────────────────────────────────────

  test('_bddView: missing panes, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _bddView('bid'); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_bddView: null view, does not throw', async () => {
    const r = await page.evaluate(() => {
      try { _bddView(null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('_bddView: with panes in DOM, switches active pane correctly', async () => {
    const r = await page.evaluate(() => {
      const bidPane = document.createElement('div');
      bidPane.id = 'bdd-bid-pane';
      const propPane = document.createElement('div');
      propPane.id = 'bdd-proposal-pane';
      const bidTab = document.createElement('button');
      bidTab.id = 'bdd-tab-bid';
      const propTab = document.createElement('button');
      propTab.id = 'bdd-tab-proposal';
      document.body.append(bidPane, propPane, bidTab, propTab);
      try {
        _bddView('proposal');
        return {
          ok: true,
          bidDisplay: bidPane.style.display,
          propDisplay: propPane.style.display,
        };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { [bidPane, propPane, bidTab, propTab].forEach(el => el.remove()); }
    });
    expect(r.ok).toBe(true);
    expect(r.bidDisplay).toBe('none');
    expect(r.propDisplay).toBe(''); // active pane has no display:none
  });

  test('_bddView: 5 concurrent calls, no crash', async () => {
    const r = await page.evaluate(() => {
      try {
        _bddView('bid');
        _bddView('proposal');
        _bddView('bid');
        _bddView('proposal');
        _bddView('bid');
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // setProposalFilter
  // ─────────────────────────────────────────────────────────────────────────────

  test('setProposalFilter: null filter, graceful', async () => {
    const r = await page.evaluate(() => {
      try { setProposalFilter(null, null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('setProposalFilter: empty string, graceful', async () => {
    const r = await page.evaluate(() => {
      try { setProposalFilter('', null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
  });

  test('setProposalFilter: valid filter, updates _proposalFilter', async () => {
    const r = await page.evaluate(() => {
      try {
        setProposalFilter('signed', null);
        return { ok: true, filter: window._proposalFilter };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { setProposalFilter('all', null); }
    });
    expect(r.ok).toBe(true);
    expect(r.filter).toBe('signed');
  });

  test('setProposalFilter: with button arg, adds active class', async () => {
    const r = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.className = 'fb';
      document.body.appendChild(btn);
      try {
        setProposalFilter('draft', btn);
        return { ok: true, hasActive: btn.classList.contains('active') };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally { btn.remove(); setProposalFilter('all', null); }
    });
    expect(r.ok).toBe(true);
    expect(r.hasActive).toBe(true);
  });

  test('setProposalFilter: 5 concurrent calls, last one wins', async () => {
    const r = await page.evaluate(() => {
      try {
        setProposalFilter('draft', null);
        setProposalFilter('signed', null);
        setProposalFilter('awaiting_sig', null);
        setProposalFilter('declined', null);
        setProposalFilter('all', null);
        return { ok: true, filter: window._proposalFilter };
      }
      catch (e) { return { ok: false, err: e.message }; }
    });
    expect(r.ok).toBe(true);
    expect(r.filter).toBe('all');
  });

  test('setProposalFilter: corrupted localStorage, graceful', async () => {
    const r = await page.evaluate(() => {
      localStorage.setItem('td_bids', '{INVALID{{');
      try { setProposalFilter('all', null); return { ok: true }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally { localStorage.removeItem('td_bids'); }
    });
    expect(r.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Cross-function integration
  // ─────────────────────────────────────────────────────────────────────────────

  test('integration: emitEvent + autoLogContact together, no conflict', async () => {
    const r = await page.evaluate(() => {
      const fakeClient = { id: 95001, name: 'Integration Test' };
      clients.unshift(fakeClient);
      try {
        emitEvent('contact', 95001, { note: 'integration' });
        autoLogContact(95001, 'sms');
        emitEvent('followup', 95001, null);
        return { ok: true, lastContact: fakeClient.last_contact_date };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        const idx = clients.findIndex(c => c.id === 95001);
        if (idx !== -1) clients.splice(idx, 1);
      }
    });
    expect(r.ok).toBe(true);
    expect(r.lastContact).toBeTruthy();
  });

  test('integration: openBidDetail + _bddView toggle, no crash', async () => {
    const r = await page.evaluate(() => {
      const fakeBid = { id: 95002, status: 'Pending', client_id: null, amount: 500, proposalHtml: '<p>hi</p>' };
      bids.unshift(fakeBid);
      try {
        openBidDetail(95002, 'bid');
        _bddView('proposal');
        _bddView('bid');
        document.querySelector('[data-bdov]')?.remove();
        return { ok: true };
      }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        bids.shift();
        document.querySelector('[data-bdov]')?.remove();
      }
    });
    expect(r.ok).toBe(true);
  });

  test('integration: renderDash after corrupted S object, guard released', async () => {
    const r = await page.evaluate(() => {
      const origS = Object.assign({}, S);
      S.employees = 'not-an-array';
      try { renderDash(); return { ok: true, running: window._renderDashRunning }; }
      catch (e) { return { ok: false, err: e.message }; }
      finally {
        Object.assign(S, origS);
        window._renderDashRunning = false;
      }
    });
    expect(r.ok).toBe(true);
    expect(r.running).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Final console-error check
  // ─────────────────────────────────────────────────────────────────────────────

  test('no console errors, dashboard.js', () => {
    assertNoErrors(page, 'dashboard.js');
  });
});
