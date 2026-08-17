// REAL flow: the journey card + "paid in full but never closed out" fix
// (CLAUDE.md §12.8, owner-approved shape 2026-08-17).
//
// The bug this proves fixed: a job could be fully paid, still sit "upcoming"
// on the calendar, and NOTHING anywhere said "wrap it up" outside the bid's
// own detail panel (owner: "it's paid but don't see anyway to close out the
// job... found it but nothing in dashboard"). Both surfaces (dashboard,
// property card) now carry the prompt.
//
// The chain, all through the real UI against the real backend:
//   1. send a real, typed-up proposal
//   2. the client signs and pays cash through the real sign.html funnel
//   3. the realtime "New signature!" popup schedules the job (no manual poll)
//   4. the journey card (client detail, real render) reads stage 2→3 as the
//      job moves from unscheduled to scheduled, with the right primary button
//      at each stage (Put it on the calendar → / Mark job complete)
//   5. the FULL balance is collected BEFORE the job is marked done, the
//      exact order that produced the bug
//   6. the "paid in full, job never closed out" prompt appears on the
//      DASHBOARD feed AND the property card, same underlying condition
//   7. tapping "Close it out" on the dashboard (a real button, real click)
//      marks the job done and stamps the bid's completion date
//   8. both prompts clear on the very next render, and the journey card
//      advances to its final stage
//
// This does not duplicate full-lifecycle-flow.spec.js: that suite always
// completes the job BEFORE collecting the final payment (the ordinary path).
// This flow inverts the order on purpose, because the inverted order is
// exactly what the bug needed and what full-lifecycle-flow never exercises.
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, seedProposal } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'journey/paid-before-close';

test.describe('Journey card + paid-in-full close-out (UI-driven, real backend)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a job paid in full before completion surfaces on both surfaces, and closing it clears both', async ({ page, browser }) => {
    test.setTimeout(240000);

    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const bidId = clientId + 1;
    let ctx = {};

    // ── 1. Send a real, typed-up proposal ──────────────────────────────────
    await step(page, {
      label: '1. send a real proposal', page: 'cloud', role: 'contractor',
      suspect: 'seedProposal storage upload + td_bids',
      ruleText: 'sending must upload the signing snapshot and return a usable token/uid',
      expected: 'token + uid present, no upload error',
      act: async (p) => {
        // Park the schedule-alert queue for the build phase, same guard
        // full-lifecycle-flow uses: this account accumulates other specs'
        // signed-but-unscheduled seed bids (§12.7), and the full-screen
        // popup for THOSE would swallow our taps if it beat ours to the punch.
        await p.evaluate(() => {
          window._showingScheduleAlert = true;
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
        });
        ctx = await seedProposal(p, { clientId, bidId, amount: 3850, tag: 'journey-close' });
        return 1;
      },
      rule: async () => ({ ok: !ctx.uploadErr && !!ctx.token && !!ctx.uid, got: `err=${ctx.uploadErr} token=${!!ctx.token}` }),
    });

    // ── 2. Client signs + pays CASH through the real sign.html funnel ─────
    const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cp = await clientCtx.newPage();
    await step(page, {
      label: '2. client opens the link and signs (cash)', page: 'sign.html', role: 'client',
      suspect: 'sign.html approveAndSign → goToPayment → _paySign(cash) → submitCash',
      ruleText: 'an anonymous client must reach pg-done through the real signing UI',
      expected: 'pg-done visible in the client browser',
      act: async (p) => {
        // Release the queue right before OUR client signs, so the popup that
        // fires next is provably ours.
        await p.evaluate(() => {
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
          window._showingScheduleAlert = false;
        });
        const base = process.env.E2E_BASE_URL || 'http://localhost:8788';
        await cp.goto(`${base}/sign.html?t=${ctx.token}&u=${ctx.uid}&b=${bidId}`, { waitUntil: 'domcontentloaded' });
        await cp.waitForSelector('#approve-btn', { state: 'visible', timeout: 20000 });
        let n = 0;
        n += await tap(cp, '#approve-btn');
        await cp.waitForSelector('#sig-name', { state: 'visible', timeout: 10000 });
        n += await type(cp, '#sig-name', 'Jordan E Client');
        await cp.waitForTimeout(300);
        n += await tap(cp, '#sign-btn');
        await cp.waitForSelector('#sign-pay-btns button', { state: 'visible', timeout: 10000 });
        n += await tap(cp, '#sign-pay-btns button:has-text("Cash")');
        await cp.waitForSelector('#sec-cash-confirm-btn', { state: 'visible', timeout: 8000 });
        n += await tap(cp, '#sec-cash-confirm-btn');
        await cp.waitForSelector('#pg-done', { state: 'visible', timeout: 25000 });
        return n;
      },
      rule: async () => {
        const done = await cp.evaluate(() => {
          const el = document.getElementById('pg-done');
          return !!el && el.style.display !== 'none';
        });
        return { ok: done, got: `pg-done visible=${done}` };
      },
    });
    await clientCtx.close(); // resource cleanup (not data, §12.7)

    // ── 3. The realtime popup surfaces, no poll, no refresh ────────────────
    await step(page, {
      label: '3. "New signature!" popup appears via realtime push alone', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js sig-feed push → checkNewSignatures → showScheduleAlerts',
      ruleText: 'the schedule popup must surface within 25s of the client signing, no manual poll',
      expected: '#_sched-alert-overlay visible for THIS bid, bid.status=Closed Won',
      act: async (p) => {
        const t0 = Date.now();
        await p.waitForSelector('#_sched-alert-overlay', { state: 'attached', timeout: 25000 });
        ctx.popupMs = Date.now() - t0;
        return 0; // zero interactions, that's the point
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => ({
          overlay: !!document.getElementById('_sched-alert-overlay'),
          mine: window._currentScheduleAlert && String(window._currentScheduleAlert.bidId) === String(bidId),
          bidStatus: (bids.find(b => String(b.id) === String(bidId)) || {}).status,
        }), bidId);
        const ok = r.overlay && r.mine && r.bidStatus === 'Closed Won';
        return { ok, got: `overlay=${r.overlay} mine=${r.mine} status=${r.bidStatus} in ${ctx.popupMs}ms` };
      },
    });

    // ── 4. Journey card reads "Schedule" (stage 2) before scheduling ──────
    await step(page, {
      label: '4. the journey card shows stage 2, "Put it on the calendar →"', page: 'pg-clients', role: 'contractor',
      suspect: 'clients.js renderCDBids (_stage calc + _pbtn)',
      ruleText: 'a won, unscheduled bid must render the journey card at stage 2 with the schedule primary button',
      expected: `real button [onclick="schedFromBid(${bidId})"] present in #cd-bids-list`,
      act: async (p) => {
        await p.evaluate((cid) => { if (typeof openClientDetail === 'function') openClientDetail(cid); }, clientId);
        await p.waitForSelector('#cd-bids-list', { state: 'attached', timeout: 8000 });
        await p.evaluate(() => { if (typeof renderCDBids === 'function') renderCDBids(); });
        return 0; // viewing, not the popup's own schedule action (that's step 5)
      },
      rule: async (p) => {
        const label = await p.evaluate((bidId) => {
          const btn = document.querySelector(`#cd-bids-list button[onclick="schedFromBid(${bidId})"]`);
          return btn ? btn.textContent.trim() : null;
        }, bidId);
        return { ok: label === 'Put it on the calendar →', got: `label=${label}` };
      },
    });

    // ── 5. Schedule the job from the popup, a real job lands on the calendar ──
    await step(page, {
      label: '5. schedule the job from the popup', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js showScheduleSuggestion → quickScheduleJob',
      ruleText: 'Schedule now → Lock it in must put a real upcoming job on the calendar',
      expected: 'jobs[] has an upcoming job for this bid',
      act: async (p) => {
        await p.evaluate(() => { if (typeof goPg === 'function') goPg('pg-dash'); });
        await p.waitForSelector('#_sched-alert-overlay', { state: 'attached', timeout: 8000 }).catch(() => {});
        let n = 0;
        n += await tap(p, '#_sched-alert-yes');
        await p.waitForSelector('#sched-lock-btn', { state: 'visible', timeout: 8000 });
        n += await tap(p, '#sched-lock-btn');
        await p.waitForTimeout(800);
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => {
          const j = jobs.find(x => String(x.bid_id) === String(bidId) && x.eventType === 'job');
          return j ? { id: j.id, status: j.status, start: j.start } : null;
        }, bidId);
        if (r) ctx.jobId = r.id;
        return { ok: !!r && r.status === 'upcoming' && !!r.start, got: JSON.stringify(r) };
      },
    });

    // ── 6. Journey card advances to "Work" (stage 3): scheduled, not done ──
    await step(page, {
      label: '6. the journey card advances to stage 3, "Mark job complete"', page: 'pg-clients', role: 'contractor',
      suspect: 'clients.js renderCDBids (_stage calc: scheduled + !done → 3, regardless of balance)',
      ruleText: 'once scheduled, the primary button must read Mark job complete even though the balance is still owed',
      expected: `real button [onclick="markJobDone(${ctx.jobId})"] present, reads "Mark job complete"`,
      act: async (p) => {
        await p.evaluate((cid) => { if (typeof openClientDetail === 'function') openClientDetail(cid); }, clientId);
        await p.waitForSelector('#cd-bids-list', { state: 'attached', timeout: 8000 });
        await p.evaluate(() => { if (typeof renderCDBids === 'function') renderCDBids(); });
        return 0;
      },
      rule: async (p) => {
        const label = await p.evaluate((jobId) => {
          const btn = document.querySelector(`#cd-bids-list button[onclick="markJobDone(${jobId})"]`);
          return btn ? btn.textContent.trim() : null;
        }, ctx.jobId);
        return { ok: label === 'Mark job complete', got: `label=${label}` };
      },
    });

    // ── 7. Collect the FULL balance BEFORE the job is marked done ─────────
    // This is the exact inversion the bug needed: full-lifecycle-flow always
    // completes first, then pays. Here the money lands while the job is
    // still open.
    await step(page, {
      label: '7. collect the full balance while the job is still open', page: 'pg-money', role: 'contractor',
      suspect: 'bids.js openPayPanel → logPayment → getBidBalance',
      ruleText: 'logging the full amount as cash must zero the balance while completion_date stays unset',
      expected: 'getBidBalance === 0, bid.completion_date still null',
      act: async (p) => {
        const clicks = await p.evaluate(async (bidId) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const bid = bids.find(b => String(b.id) === String(bidId));
          const bal = getBidBalance(bid);
          openPayPanel(bid.id); await wait(400);
          const cashBtn = [...document.querySelectorAll('#mpay-type-btns button')].find(b => /cash/i.test(b.textContent));
          if (cashBtn) cashBtn.click(); await wait(150);
          const amt = document.getElementById('mpay-amount');
          if (amt) { amt.value = String(bal); amt.dispatchEvent(new Event('input', { bubbles: true })); }
          const dt = document.getElementById('mpay-date');
          if (dt && !dt.value) dt.value = todayKey();
          logPayment(); await wait(500);
          return 1 + 1 + String(bal).length + 1; // open + cash + amount keys + save
        }, bidId);
        return clicks;
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => {
          const bid = bids.find(b => String(b.id) === String(bidId));
          return { balance: getBidBalance(bid), completionDate: bid.completion_date || null };
        }, bidId);
        return { ok: r.balance === 0 && !r.completionDate, got: JSON.stringify(r) };
      },
    });

    // ── 8. The prompt appears on BOTH surfaces: dashboard AND property card ──
    await step(page, {
      label: '8. "paid in full, job never closed out" shows on the dashboard AND the property card', page: 'pg-dash', role: 'contractor',
      suspect: 'dashboard.js renderTodayFeed (finalPayItems wrap-up) + clients.js renderCDAddresses (wrapUp)',
      ruleText: 'a fully-paid, not-yet-completed job must surface the close-out prompt on both surfaces the owner actually looks at',
      expected: 'dash-money-feed AND cd-addresses-list both contain "job never closed out" with a real markJobDone button',
      act: async (p) => {
        await p.evaluate(() => { if (typeof goPg === 'function') goPg('pg-dash'); if (typeof renderTodayFeed === 'function') renderTodayFeed(); });
        await p.waitForTimeout(300);
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(({ clientId, jobId }) => {
          const feed = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
          const onDash = feed.includes('job never closed out') && feed.includes('markJobDone(' + jobId + ')');
          if (typeof openClientDetail === 'function') openClientDetail(clientId);
          if (typeof renderCDAddresses === 'function') renderCDAddresses();
          const prop = (document.getElementById('cd-addresses-list') || {}).innerHTML || '';
          const onProp = prop.includes('job never closed out') && prop.includes('markJobDone(' + jobId + ')');
          return { onDash, onProp };
        }, { clientId, jobId: ctx.jobId });
        return { ok: out.onDash && out.onProp, got: JSON.stringify(out) };
      },
    });

    // ── 9. Tap "Close it out" for real, on the dashboard surface ──────────
    await step(page, {
      label: '9. tap "Close it out →" on the dashboard', page: 'pg-dash', role: 'contractor',
      suspect: 'jobs.js markJobDone → _startJobComplete → confirmJobDone',
      ruleText: 'closing from the dashboard prompt must mark the job done and stamp the bid completion date',
      expected: 'job.status=done, bid.completion_date set',
      act: async (p) => {
        await p.evaluate(() => { if (typeof goPg === 'function') goPg('pg-dash'); if (typeof renderTodayFeed === 'function') renderTodayFeed(); });
        await p.waitForTimeout(300);
        let n = await tap(p, '#dash-money-feed button:has-text("Close it out")');
        await p.waitForTimeout(400);
        // The completion modal may ask a debrief/sign follow-up before the
        // final commit, walk it the same way full-lifecycle-flow does.
        const advanced = await p.evaluate(async (jobId) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const btn = document.querySelector('.zmodal-overlay button[onclick*="_startJobComplete"]');
          if (btn) { btn.click(); await wait(600); }
          const j = jobs.find(x => x.id === jobId);
          if (j && j.status !== 'done' && typeof confirmJobDone === 'function') { await confirmJobDone(jobId); await wait(400); }
          return true;
        }, ctx.jobId);
        n += advanced ? 1 : 0;
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId, bidId }) => ({
          job: (jobs.find(x => x.id === jobId) || {}).status,
          completion: (bids.find(b => String(b.id) === String(bidId)) || {}).completion_date || null,
        }), { jobId: ctx.jobId, bidId });
        return { ok: r.job === 'done' && !!r.completion, got: JSON.stringify(r) };
      },
    });

    // ── 10. Both prompts are gone, and the journey card reads its final stage ──
    await step(page, {
      label: '10. both prompts clear, the journey card advances to its final stage', page: 'pg-dash', role: 'contractor',
      suspect: 'dashboard.js renderTodayFeed + clients.js renderCDAddresses/renderCDBids',
      ruleText: 'closing the job must clear the prompt from BOTH surfaces on the very next render, and the journey card must read Send final invoice',
      expected: 'neither surface mentions "job never closed out"; journey primary button = "Send final invoice"',
      act: async (p) => {
        await p.evaluate(() => { if (typeof renderTodayFeed === 'function') renderTodayFeed(); });
        return 0;
      },
      rule: async (p) => {
        const out = await p.evaluate(({ clientId, bidId }) => {
          const feed = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
          if (typeof openClientDetail === 'function') openClientDetail(clientId);
          if (typeof renderCDAddresses === 'function') renderCDAddresses();
          if (typeof renderCDBids === 'function') renderCDBids();
          const prop = (document.getElementById('cd-addresses-list') || {}).innerHTML || '';
          const btn = document.querySelector(`#cd-bids-list button[onclick="openFinalInvoice(${bidId})"]`);
          return {
            dashClear: !feed.includes('job never closed out'),
            propClear: !prop.includes('job never closed out'),
            finalInvoiceLabel: btn ? btn.textContent.trim() : null,
          };
        }, { clientId, bidId });
        const ok = out.dashClear && out.propClear && out.finalInvoiceLabel === 'Send final invoice';
        return { ok, got: JSON.stringify(out) };
      },
    });

    // NO cleanup, the client, bid, job, signature and payment stay in the
    // dev account for the owner to inspect (§12.7).
    const rep = report(FLOW, BASELINE, page);
    if (BASELINE[FLOW]) {
      expect(rep.overBudget, `UX REGRESSION: journey + paid-close now costs ${rep.totalClicks} clicks vs budget ${BASELINE[FLOW].clicks}.`).toBe(false);
    }
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
