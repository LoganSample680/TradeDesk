// REAL flow — the jobs lifecycle (task #4): schedule a job from a Closed Won bid,
// clock in, clock out (a real time entry), and mark the job complete (which must
// mirror completion_date onto the bid). Drives the actual UI funcs
// (bids.js schedFromBid, finance.js scheduleJob, jobs.js clockIn/clockOut/
// markJobDone/confirmJobDone) against a tagged throwaway bid. Each assertion is a
// step() so a regression throws a one-line finding().
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'jobs/schedule-clock-complete';

test.describe('jobs lifecycle (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('schedule a job, clock in/out, then mark it complete (mirrors to the bid)', async ({ page }) => {
    const bidId = Date.now() * 1000 + Math.floor(Math.random() * 1000); // entropy: no cross-viewport collision
    const clientId = bidId + 1;
    // Far-future, weekday start to avoid colliding with a real booked day.
    const start = new Date(Date.now() + 250 * 86400000).toISOString().slice(0, 10);
    const doneDate = new Date(Date.now() + 252 * 86400000).toISOString().slice(0, 10);

    await step(page, {
      label: 'seed a Closed Won bid', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud',
      ruleText: 'the seeded Closed Won bid must exist with no completion date',
      expected: 'bid present, status Closed Won, completion_date null',
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId }) => {
          clients.push({ id: clientId, name: 'E2E Jobs Client', phone: '3165550999', addr: '999 Job Ln, Wichita, KS 67202', _e2e: 'jobs' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E Jobs Client', amount: 4200, status: 'Closed Won', bid_date: new Date().toISOString().slice(0, 10), completion_date: null, _e2e: 'jobs' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { bidId, clientId });
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          return { has: !!b, status: b ? b.status : null, comp: b ? b.completion_date : 'x' };
        }, { bidId });
        return { ok: r.has && r.status === 'Closed Won' && !r.comp, got: JSON.stringify(r) };
      },
    });

    let jobId = null;
    await step(page, {
      label: 'schedule a job from the bid', page: 'pg-sched', role: 'contractor',
      suspect: 'bids.js schedFromBid + finance.js scheduleJob',
      ruleText: 'scheduling must create an upcoming job linked to the bid',
      expected: 'a job with eventType=job, status=upcoming, bid_id set',
      act: async (p) => {
        await p.evaluate(({ bidId }) => { schedFromBid(bidId); }, { bidId });   // 1 tap (open scheduler)
        await p.waitForSelector('#s-name', { timeout: 8000 });
        await p.evaluate(({ bidId, start }) => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
          set('s-bid-sel', String(bidId)); // bid <select> = 1 tap
          set('s-name', 'Interior paint'); // name field — typed = 14 keystrokes
          set('s-start', start);           // start date <input type=date> = 1 tap
          set('s-days', '1');              // days field — typed "1" = 1 keystroke
        }, { bidId, start });
        await p.evaluate(() => { scheduleJob(); }, {});                          // 1 tap (submit)
        await p.waitForTimeout(400);
        jobId = await p.evaluate(({ bidId }) => {
          const j = jobs.find(x => x.bid_id === bidId);
          return j ? j.id : null;
        }, { bidId });
        return 19; // schedFromBid(1) + bid pick(1) + name"Interior paint"(14) + start date(1) + days"1"(1) + scheduleJob(1) = 19
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const j = jobs.find(x => x.bid_id === bidId);
          return j ? { status: j.status, eventType: j.eventType, hasBid: j.bid_id === bidId } : null;
        }, { bidId });
        return { ok: !!r && r.hasBid && r.eventType === 'job' && r.status === 'upcoming', got: JSON.stringify(r) };
      },
    });

    await step(page, {
      label: 'clock in to the job', page: 'clock', role: 'contractor',
      suspect: 'jobs.js clockIn / _activeTimer',
      ruleText: 'clocking in must start the active timer on this job',
      expected: '_activeTimer set for the job',
      act: async (p) => {
        await p.evaluate(({ jobId }) => { clockIn(jobId, 'sand', 'Sanding'); }, { jobId }); // 1
        await p.waitForTimeout(150);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId }) => {
          return { active: typeof _activeTimer !== 'undefined' && !!_activeTimer, job: (typeof _activeTimer !== 'undefined' && _activeTimer) ? _activeTimer.jobId : null };
        }, { jobId });
        return { ok: r.active && r.job === jobId, got: JSON.stringify(r) };
      },
    });

    await step(page, {
      label: 'clock out — records a time entry', page: 'clock', role: 'contractor',
      suspect: 'jobs.js clockOut (timeEntries push, Math.max(1,minutes))',
      ruleText: 'clocking out must record a time entry for the job with at least 1 minute',
      expected: 'a timeEntries row with job_id, minutes>=1, scope_id=sand',
      act: async (p) => {
        await p.evaluate(() => { clockOut(true, true); }, {}); // 1
        await p.waitForTimeout(300);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId }) => {
          const e = (typeof timeEntries !== 'undefined' ? timeEntries : []).find(t => t.job_id === jobId);
          return e ? { minutes: e.minutes, scope: e.scope_id } : null;
        }, { jobId });
        return { ok: !!r && r.minutes >= 1 && r.scope === 'sand', got: r ? JSON.stringify(r) : 'no time entry' };
      },
    });

    await step(page, {
      label: 'mark the job complete', page: 'jobs', role: 'contractor',
      suspect: 'jobs.js markJobDone/confirmJobDone (mirror completion_date to bid)',
      ruleText: 'completing the job must set job.completion_date AND mirror it onto the bid',
      expected: 'job.status=done, job + bid completion_date both set',
      act: async (p) => {
        await p.evaluate(({ jobId }) => { markJobDone(jobId); }, { jobId });    // 1 tap (mark done)
        await p.waitForTimeout(250);
        await p.evaluate(({ doneDate }) => { const el = document.getElementById('job-done-date'); if (el) el.value = doneDate; }, { doneDate }); // date <input type=date> = 1 tap
        await p.evaluate(({ jobId }) => { confirmJobDone(jobId); }, { jobId }); // 1 tap (confirm)
        await p.waitForTimeout(400);
        return 3; // markJobDone(1) + done-date pick(1) + confirmJobDone(1) = 3 (no free-text typed)
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId, bidId }) => {
          const j = jobs.find(x => x.id === jobId);
          const b = bids.find(x => x.id === bidId);
          return { jStatus: j ? j.status : null, jComp: j ? j.completion_date : null, bComp: b ? b.completion_date : null };
        }, { jobId, bidId });
        const memOk = r.jStatus === 'done' && !!r.jComp && r.bComp === r.jComp;
        // TRUE end-to-end: completion must have persisted to the cloud on BOTH the
        // job (td_jobs) and the mirrored bid (td_bids), not just in-memory arrays.
        const [cJobs, cBids] = [await cloudRows(p, 'td_jobs'), await cloudRows(p, 'td_bids')];
        const cj = cJobs.find(j => String(j.id) === String(jobId));
        const cb = cBids.find(b => String(b.id) === String(bidId));
        const cloudOk = !!cj && cj.status === 'done' && !!cj.completion_date && !!cb && cb.completion_date === cj.completion_date;
        return { ok: memOk && cloudOk, got: `mem=${JSON.stringify(r)} cloudJob=${cj ? cj.status + '/' + cj.completion_date : 'ABSENT'} cloudBidComp=${cb ? cb.completion_date : 'ABSENT'}` };
      },
    });

    // NO cleanup — the bid, job, time entry + client stay in the dev account on
    // purpose so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
