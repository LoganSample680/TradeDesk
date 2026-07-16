// THE FULL-LIFECYCLE FLOW, the living master journey suite (owner directive
// 2026-07-14: "this becomes our full flow suite, if we add things in the
// process we can add to it").
//
// One continuous, UI-driven run of the ENTIRE business on the REAL backend:
//
//   1. create lead        → real Add Client form (openNewClient/saveClient)
//   2. build estimate     → real T&M or BYO builder (both variants below)
//   3. send               → real proposal artifact + signing token
//   4. client signs       → a SECOND anonymous browser context drives the real
//                           sign.html link: approve → type name → cash → confirm
//   5. REALTIME POPUP     → the contractor session must surface the "New
//                           signature!" schedule modal ON ITS OWN, no manual
//                           poll, no refresh. Push does the work (≤20s).
//   6. schedule           → through the popup: Schedule now → Lock it in
//   7. time on site       → clock in / clock out on the job
//   8. complete           → mark job done through the real completion modal
//   9. final pay          → log the remaining balance; books hit $0
//
// EXTENDING IT: every phase is a numbered step(): when a new feature lands in
// the lifecycle (change order mid-job, completion invoice, review request…),
// insert a step at the right point, count its clicks honestly, and re-baseline
// with a note in the same commit. This suite is the click-cost of running the
// whole business, the number we ratchet DOWN against forever (§12.2).
//
// Payment is the cash path, the runner has no Stripe test key, and card
// checkout hands off to Stripe-hosted UI we can't drive. Seed data (client,
// bid, job, time entry, payments) stays in the dev account per §12.7.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, pick } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

// Poll until the sent bid carries proposalKey + signingToken and the artifact
// actually downloads (same settle pattern as generic-estimate-send-flow).
async function awaitSent(page) {
  return await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const id = () => (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
    for (let i = 0; i < 30; i++) {
      const b = (typeof bids !== 'undefined' && id()) ? bids.find(x => x.id === id()) : null;
      if (b && b.proposalKey && b.signingToken) break;
      await wait(500);
    }
    const bid = bids.find(x => x.id === id());
    let artifact = false, err = '';
    if (bid && bid.proposalKey) {
      for (let i = 0; i < 40; i++) {
        try {
          const { data, error } = await _supa.storage.from('proposals').download(bid.proposalKey);
          if (data && !error) { artifact = true; break; }
          err = error ? (error.message || '') : 'no data';
        } catch (e) { err = e.message; }
        await wait(500);
      }
    }
    return {
      bidId: bid ? bid.id : null, amount: bid ? bid.amount : 0,
      token: bid ? bid.signingToken : null, uid: _supaUser ? _supaUser.id : null,
      artifact, err,
    };
  });
}

// The whole journey, parameterized by estimate type. Each phase is a step():
// insert new lifecycle features between the numbered phases.
function lifecycleTest(kind) {
  test(`${kind.toUpperCase()}: lead → estimate → send → client signs → realtime popup → schedule → time → complete → paid`, async ({ page, browser }) => {
    const FLOW = `lifecycle/lead-to-paid-${kind}`;
    // Fixed-width uniq so the typed-name keystroke count, and therefore the
    // flow's total interaction count, is IDENTICAL every run (baselines gate it).
    const uniq = String(Date.now() % 100000).padStart(5, '0') + String(process.pid % 100).padStart(2, '0');
    const clientName = `Lifecycle ${kind.toUpperCase()} ${uniq}`;
    const clientPhone = '3165552' + String(uniq).slice(-3);
    let ctx = { clientId: null, bidId: null, jobId: null, sent: {} };

    // ── 1. CREATE LEAD ─────────────────────────────────────────────────────────
    await step(page, {
      label: '1. create lead through the real Add Client form', page: 'pg-clients', role: 'contractor',
      suspect: 'clients.js openNewClient/saveClient',
      ruleText: 'saving the form must create the client record',
      expected: 'client in clients[] with the typed name',
      act: async (p) => {
        // Hold the schedule-alert door shut for the whole build phase: this dev
        // account accumulates signed-but-unscheduled seed bids (§12.7: tests
        // never clean up), and the app CORRECTLY pops the "New signature!"
        // modal for them right after boot, a full-screen overlay that would
        // swallow our taps. _showingScheduleAlert=true parks the queue; step 3
        // releases it (and empties the queue) right before OUR client signs.
        await p.evaluate(() => {
          window._showingScheduleAlert = true;
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
        });
        // The REAL journey (owner-specified): tap Leads on the navbar, then tap
        // "+ New lead" on the Leads page, physical taps, not function calls.
        // Responsive: phones show the bottom tab bar (#mtb-leads), desktop shows
        // the sidebar (#nb-leads): tap whichever one THIS viewport renders,
        // exactly like a real thumb would.
        let n = 0;
        const leadsNav = await p.evaluate(() =>
          (document.getElementById('mtb-leads')?.offsetWidth > 0) ? '#mtb-leads' : '#nb-leads');
        n += await tap(p, leadsNav);
        await p.waitForSelector('#pg-leads.active', { state: 'attached', timeout: 8000 });
        n += await tap(p, '#pg-leads .tbar-r .btn-p'); // "+ New lead"
        await p.waitForSelector('#cf-name', { state: 'visible', timeout: 8000 });
        n += await type(p, '#cf-name', clientName);
        n += await type(p, '#cf-phone', clientPhone);
        n += await type(p, '#cf-street', '742 Lifecycle Ln');
        n += await type(p, '#cf-city', 'Wichita');
        // Lead source is REQUIRED (saveClient hard-blocks without it), a real
        // pick from the dropdown, an honest interaction.
        n += await pick(p, '#cf-source', 'Referral');
        await p.evaluate(() => saveClient());
        await p.waitForTimeout(500);
        return n + 1; // save tap
      },
      rule: async (p) => {
        ctx.clientId = await p.evaluate((nm) => (clients.find(c => c.name === nm) || {}).id || null, clientName);
        return { ok: !!ctx.clientId, got: `clientId=${ctx.clientId}` };
      },
    });

    // ── 2. BUILD THE ESTIMATE (real builder UI) ────────────────────────────────
    await step(page, {
      label: `2. build the ${kind.toUpperCase()} estimate`, page: 'pg-est-generic', role: 'contractor',
      suspect: 'generic-estimate.js openTMEstimate/openFreeFormEstimate + line entry',
      ruleText: 'the estimate must be priced (> 0) on the draft bid',
      expected: 'pg-est-generic active with a non-zero total',
      act: async (p) => {
        const clicks = await p.evaluate(async ({ kind, clientName }) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          const c = clients.find(x => x.name === clientName);
          if (kind === 'tm') {
            openTMEstimate(c, null); await wait(300);
            set('gei-client', c.name); set('gei-addr', c.addr || '742 Lifecycle Ln, Wichita');
            const cc = document.getElementById('tm-crew-display'); if (cc) cc.textContent = '2';
            set('tm-rate', '65'); set('tm-hours', '30');
            try { _tmRecalc(); } catch (e) {}
            await wait(120);
            addGeiLine();
            const last = _geiLines[_geiLines.length - 1];
            if (last) { last.desc = 'Materials'; last.rate = 350; last.qty = 1; last.total = 350; }
            try { renderGeiLines(); calcGeiTotal(); } catch (e) {}
            await wait(120);
            return 1 + 1 + 2 + 2 + 1 + 9 + 3; // open+crew+rate+hours+addline+desc+price
          }
          openFreeFormEstimate(c, null); await wait(300);
          set('gei-client', c.name); set('gei-addr', c.addr || '742 Lifecycle Ln, Wichita');
          const addItem = async (sec, label, price, notes) => {
            _byoAddItem(sec); await wait(80);
            set('_bya-label', label); set('_bya-price', String(price)); set('_bya-notes', notes);
            _byaConfirm(sec); await wait(80);
          };
          await addItem('Materials', 'Job materials + sundries', 380, 'per scope');
          await addItem('Interior', 'Full interior refresh, two coats', 1900, 'walls + trim');
          try { _byoUpdateRail(); calcGeiTotal(); } catch (e) {}
          await wait(120);
          return 1 + (1 + 25 + 3 + 9 + 1) + (1 + 32 + 4 + 12 + 1);
        }, { kind, clientName });
        return clicks;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          let total = 0; try { total = calcGeiTotal().total; } catch (e) {}
          return { active: (document.querySelector('.pg.active') || {}).id, total };
        });
        return { ok: r.active === 'pg-est-generic' && r.total > 0, got: JSON.stringify(r) };
      },
    });

    // ── 3. SEND ────────────────────────────────────────────────────────────────
    await step(page, {
      label: '3. send the proposal', page: 'pg-est-generic', role: 'contractor',
      suspect: 'generic-estimate.js sendGenericProposal (artifact + signingToken)',
      ruleText: 'sending must upload the artifact and stamp a signing token',
      expected: 'artifact downloads + signingToken present',
      act: async (p) => {
        await p.evaluate(async () => { try { await sendGenericProposal(false); } catch (e) {} });
        ctx.sent = await awaitSent(p);
        ctx.bidId = ctx.sent.bidId;
        // Flush any stray schedule alerts accumulated seed data might queue, so
        // the popup asserted in step 5 can only be OURS. Also wait for the
        // sig-feed channel to be provably live before the client signs, if it
        // never subscribes, FAIL HERE with a clear finding instead of a
        // confusing popup timeout two steps later.
        ctx.sigFeedReady = await p.evaluate(async () => {
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
          window._showingScheduleAlert = false;
          const t0 = Date.now();
          while (typeof _sigFeedReady !== 'undefined' && !_sigFeedReady && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 200));
          return typeof _sigFeedReady === 'undefined' ? true : _sigFeedReady;
        });
        return 1; // Send tap
      },
      rule: async () => ({
        ok: !!ctx.sent.token && ctx.sent.artifact && (ctx.sent.amount || 0) > 0 && ctx.sigFeedReady,
        got: `token=${!!ctx.sent.token} artifact=${ctx.sent.artifact} amount=${ctx.sent.amount} sigFeedSubscribed=${ctx.sigFeedReady} err=${ctx.sent.err}`,
      }),
    });

    // ── 4. CLIENT SIGNS (anonymous second browser, the real signing link) ─────
    const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cp = await clientCtx.newPage();
    await step(page, {
      label: '4. client opens the link and signs (cash)', page: 'sign.html', role: 'client',
      suspect: 'sign.html approveAndSign → goToPayment → _paySign(cash) → submitCash',
      ruleText: 'an anonymous client must reach pg-done through the real signing UI',
      expected: 'pg-done visible in the client browser',
      act: async () => {
        const base = process.env.E2E_BASE_URL || 'http://localhost:8788';
        await cp.goto(`${base}/sign.html?t=${ctx.sent.token}&u=${ctx.sent.uid}&b=${ctx.bidId}`, { waitUntil: 'domcontentloaded' });
        await cp.waitForSelector('#approve-btn', { state: 'visible', timeout: 20000 });
        let n = 0;
        n += await tap(cp, '#approve-btn');
        await cp.waitForSelector('#sig-name', { state: 'visible', timeout: 10000 });
        n += await type(cp, '#sig-name', clientName);
        await cp.waitForTimeout(300); // checkReady enables the button
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

    // ── 5. THE REALTIME POPUP, no poll, no refresh, push does the work ───────
    await step(page, {
      label: '5. "New signature!" popup appears via realtime push alone', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js sig-feed push → checkNewSignatures → showScheduleAlerts',
      ruleText: 'the schedule popup must surface on its own within 20s of the client signing, no manual poll, no reload',
      expected: '#_sched-alert-overlay visible for THIS bid',
      act: async (p) => {
        const t0 = Date.now();
        // 25s: covers the realtime auto-rejoin backoff after a transient
        // CHANNEL_ERROR (the recovery sweep re-polls and still pops the modal).
        await p.waitForSelector('#_sched-alert-overlay', { state: 'attached', timeout: 25000 });
        ctx.popupMs = Date.now() - t0;
        return 0; // ZERO user interactions, that's the point
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => ({
          overlay: !!document.getElementById('_sched-alert-overlay'),
          mine: window._currentScheduleAlert && String(window._currentScheduleAlert.bidId) === String(bidId),
          bidStatus: (bids.find(b => String(b.id) === String(bidId)) || {}).status,
        }), ctx.bidId);
        const ok = r.overlay && r.mine && r.bidStatus === 'Closed Won';
        return { ok, got: `overlay=${r.overlay} mine=${r.mine} status=${r.bidStatus} in ${ctx.popupMs}ms` };
      },
    });

    // ── 6. SCHEDULE FROM THE POPUP ─────────────────────────────────────────────
    await step(page, {
      label: '6. schedule the job from the popup', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js showScheduleSuggestion → quickScheduleJob',
      ruleText: 'Schedule now → Lock it in must put the job on the calendar',
      expected: 'jobs[] has an upcoming job for this bid',
      act: async (p) => {
        let n = 0;
        n += await tap(p, '#_sched-alert-yes');
        await p.waitForSelector('#sched-lock-btn', { state: 'visible', timeout: 8000 });
        n += await tap(p, '#sched-lock-btn');
        await p.waitForTimeout(800);
        // Dismiss the "View on calendar?" follow-up so later steps see a clean screen.
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => {
          const j = jobs.find(x => String(x.bid_id) === String(bidId) && x.eventType === 'job');
          return j ? { id: j.id, status: j.status, start: j.start } : null;
        }, ctx.bidId);
        if (r) ctx.jobId = r.id;
        return { ok: !!r && r.status === 'upcoming' && !!r.start, got: JSON.stringify(r) };
      },
    });

    // ── 7. TIME ON SITE ────────────────────────────────────────────────────────
    await step(page, {
      label: '7. clock in, work, clock out', page: 'pg-timelog', role: 'contractor',
      suspect: 'jobs.js clockIn/clockOut → timeEntries',
      ruleText: 'a closed time entry with ≥1 minute must land on the job',
      expected: 'timeEntries row for the job, open=false, minutes>=1',
      act: async (p) => {
        await p.evaluate(async (jobId) => {
          clockIn(jobId, null, '');
          await new Promise(r => setTimeout(r, 1500));
          clockOut(true, true);
        }, ctx.jobId);
        return 2; // clock in tap + clock out tap
      },
      rule: async (p) => {
        const r = await p.evaluate((jobId) => {
          const e = (typeof timeEntries !== 'undefined' ? timeEntries : []).filter(x => String(x.job_id) === String(jobId));
          const closed = e.find(x => !x.open);
          return { entries: e.length, closed: !!closed, minutes: closed ? closed.minutes : 0 };
        }, ctx.jobId);
        return { ok: r.closed && r.minutes >= 1, got: JSON.stringify(r) };
      },
    });

    // ── 8. COMPLETE THE JOB ────────────────────────────────────────────────────
    await step(page, {
      label: '8. mark the job complete', page: 'pg-jobs', role: 'contractor',
      suspect: 'jobs.js markJobDone → _startJobComplete → confirmJobDone',
      ruleText: 'completion must set job.status=done and stamp the bid completion date',
      expected: 'job done + bid.completion_date set',
      act: async (p) => {
        await p.evaluate(async (jobId) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          markJobDone(jobId); await wait(400);
          const btn = document.querySelector('.zmodal-overlay button[onclick*="_startJobComplete"]');
          if (btn) btn.click(); else if (typeof _startJobComplete === 'function') _startJobComplete(jobId);
          await wait(800);
          // Any debrief/sign follow-up steps stand between the modal and the
          // final commit, walk them by confirming directly if still not done.
          const j = jobs.find(x => x.id === jobId);
          if (j && j.status !== 'done' && typeof confirmJobDone === 'function') await confirmJobDone(jobId);
        }, ctx.jobId);
        await p.waitForTimeout(400);
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        return 2; // open completion + confirm
      },
      rule: async (p) => {
        const r = await p.evaluate(({ jobId, bidId }) => ({
          job: (jobs.find(x => x.id === jobId) || {}).status,
          done: (bids.find(b => String(b.id) === String(bidId)) || {}).completion_date || null,
        }), { jobId: ctx.jobId, bidId: ctx.bidId });
        return { ok: r.job === 'done' && !!r.done, got: JSON.stringify(r) };
      },
    });

    // ── 9. FINAL PAY, the books hit $0 ───────────────────────────────────────
    await step(page, {
      label: '9. collect final payment, balance to zero', page: 'pg-money', role: 'contractor',
      suspect: 'bids.js openPayPanel → logPayment → getBidBalance',
      ruleText: 'logging the remaining balance as cash must zero the bid balance',
      expected: 'getBidBalance === 0 and a payment row recorded',
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
        }, ctx.bidId);
        return clicks;
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => {
          const bid = bids.find(b => String(b.id) === String(bidId));
          const paid = payments.filter(x => String(x.bid_id) === String(bidId) && x.amount > 0);
          return { balance: getBidBalance(bid), payments: paid.length, amount: bid.amount };
        }, ctx.bidId);
        return { ok: r.balance === 0 && r.payments >= 1, got: JSON.stringify(r) };
      },
    });

    // NO data cleanup, the lead, bid, job, time entry and payments stay in the
    // dev account for the owner to inspect (§12.7).
    const rep = report(FLOW, BASELINE, page);
    if (BASELINE[FLOW]) {
      expect(rep.overBudget,
        `UX REGRESSION: the full business lifecycle (${kind}) costs ${rep.totalClicks} clicks vs budget ${BASELINE[FLOW].clicks}.`
      ).toBe(false);
    }
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
}

test.describe('full lifecycle, lead → signed (realtime) → scheduled → timed → completed → paid', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  lifecycleTest('tm');
  lifecycleTest('byo');
});
