// REAL flow, the dispatch board (task #18 core): assign a scheduled job to a
// crew member through the real Assign sheet (cloud.js _dispatchAssign →
// _dispatchDoAssign) and verify the assignment + the durable crewHistory record
// that powers the estimate crew-trust ranking. Jobs round-trip through td_jobs
// and S.employees rides the settings payload, so the seed save proves the write
// path end-to-end.
//
// NOTE: live GPS geo-fencing (arrive/depart time-on-site) can't run headless, it
// needs real location pings within business hours, so this covers the
// deterministic assignment half, which is where the dispatch data is written.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows, seedName, seedAddr } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'dispatch/assign-crew';

test.describe('dispatch board (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('assign a job to a crew member via the Assign sheet', async ({ page }) => {
    const stamp = process.pid;
    const jobId = Date.now() * 1000 + (stamp % 1000);
    const empId = 'e2e-emp-' + stamp;
    const empName = seedName();                 // a real crew name, not "E2E Crew"
    const clientId = jobId + 7;
    const clientName = seedName();
    const jobAddr = seedAddr();                 // a real address, not "No address"
    const today = new Date().toISOString().slice(0, 10);

    // Owner spec 2026-07-18 ("merge but easy to shift whose on what jobs"):
    // assignment now persists for the job's whole scheduled span rather than
    // requiring a daily assignedDate reconfirmation, so _dispatchDoAssign no
    // longer stamps assignedDate on assign.
    await step(page, {
      label: 'assign a job to a crew member from the Assign sheet', page: 'pg-dispatch', role: 'contractor',
      suspect: 'cloud.js _dispatchDoAssign (j.assignedTo + crewHistory + saveAll)',
      ruleText: 'tapping a crew member in the Assign sheet must assign the job and record crew history',
      expected: `job.assignedTo=${empId}, crewHistory includes it, persists without a daily date stamp`,
      act: async (p) => {
        await p.evaluate(({ jobId, empId, empName, clientId, clientName, jobAddr, today }) => {
          // Seed a crew member + a realistic scheduled job (real client, real
          // address, real job title) for today, not "E2E Dispatch Job / No address".
          S.employees = (S.employees || []).filter(e => e.id !== empId);
          S.employees.push({ id: empId, name: empName, role: 'Painter' });
          clients.push({ id: clientId, name: clientName, addr: jobAddr, source: 'Referral', _e2e: 'dispatch' });
          jobs.push({ id: jobId, client_id: clientId, name: 'Interior repaint, ' + clientName, addr: jobAddr,
            eventType: 'job', status: 'upcoming', start: today, days: 1, _e2e: 'dispatch' });
          _dispatchAssign(jobId);                          // 1 tap, open the Assign sheet
        }, { jobId, empId, empName, clientId, clientName, jobAddr, today });
        // Tap the crew member's button in the sheet (matches the seeded name).
        await p.waitForSelector('.zmodal-overlay', { timeout: 10000 });
        await p.locator('.zmodal-overlay button', { hasText: empName }).first().click({ timeout: 8000 });
        await p.waitForTimeout(500);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return 2; // open sheet (1) + tap crew member (1)
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId, empId }) => {
          const j = jobs.find(x => x.id === jobId);
          return j ? { assignedTo: String(j.assignedTo), inHistory: (j.crewHistory || []).map(String).includes(String(empId)), noDateStamp: j.assignedDate == null } : null;
        }, { jobId, empId });
        // TRUE end-to-end: the assignment must also be in the cloud (td_jobs), not
        // just the in-memory jobs[] array.
        const cloud = await cloudRows(p, 'td_jobs');
        const cj = cloud.find(j => String(j.id) === String(jobId));
        const cloudOk = !!cj && String(cj.assignedTo) === String(empId);
        const memOk = !!r && r.assignedTo === empId && r.inHistory && r.noDateStamp;
        return { ok: memOk && cloudOk, got: `mem=${JSON.stringify(r)} cloudAssignedTo=${cj ? cj.assignedTo : 'ROW ABSENT'}` };
      },
    });

    // NO cleanup, the assigned job + crew member stay in the dev account on purpose
    // so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
