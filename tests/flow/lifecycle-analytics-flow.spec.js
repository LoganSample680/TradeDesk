// THE ANALYTICS LAYER, proven end to end against the real backend: real UI
// actions → real lifecycle_events/proposal_audit_events rows → the Books
// Summary funnel card rendering YOUR OWN real numbers.
//
// This flow exists because the offline shard (e2e-lifecycle-benchmarks.spec.js)
// mocks Supabase entirely: it can prove logLifecycle() builds the right object
// client-side, but nothing before this proved that object ever reaches the real
// database, or that the Books Summary card reads real rows back correctly.
//
// What actually gets driven, and why each half is built the way it is:
//
//   REAL UI  (the entry points that matter, each is its own call site in the app):
//     lead_created      clients.js saveClient
//     proposal_started  generic-estimate.js openFreeFormEstimate → lcProposalStarted
//     proposal_saved    generic-estimate.js (draft save) → lcProposalSaved
//     proposal_sent     proposals.js sendGenericProposal
//     proposal_opened   sign.html view → the REAL log-proposal-view Edge Function
//     signed            sign.html completion → same Edge Function, step='signed'
//
//   DIRECTLY SEEDED (logLifecycle itself, staggered real timestamps):
//     job_scheduled / job_completed / balance_settled. The UI that fires these
//     (schedule modal, clock in/out, mark-complete, collect-payment) is already
//     exhaustively covered by full-lifecycle-flow.spec.js; re-driving all of it
//     here would only duplicate that coverage, not add to it. What THIS flow
//     tests is whether logLifecycle → lifecycle_events → the funnel RPC → the
//     UI agree with each other, which direct calls to the real primitive prove
//     just as well as clicking through four more modals would.
//
// The two halves of the card come from deliberately different places (this is
// documented as a privacy design in lifecycle.js, not an oversight):
//   - "your numbers"      lifecycle_funnel RPC, live, RLS-scoped to your own rows.
//   - "TradeDesk average" analytics_metrics_daily, written by the rollup-analytics
//     worker, and gated behind a ≥5-business threshold in its own RLS policy. A
//     single CI account can never clear that bar, so this flow does NOT assert
//     the benchmark column shows a number: it asserts YOUR OWN column does,
//     which is the deterministic, portable half. The rollup invocation is
//     exercised best-effort (local-stack runs it for real; cloud-mode may
//     reject an unprivileged caller, which is not a failure of this flow).
//
//   suspect chain: lifecycle.js logLifecycle/lcProposalStarted/lcProposalSaved/
//   renderLifecycleFunnel/_lcFetchMine → migrations 20260806 (lifecycle_funnel
//   RPC) → supabase/functions/rollup-analytics.
//
// Seed data is left in the dev account per CLAUDE.md §12.7: no cleanup.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, pick } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'analytics/lifecycle-to-benchmarks';

test.describe('lifecycle events reach the real backend and the Books Summary funnel (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('real actions land as real lifecycle rows and render as your own funnel numbers', async ({ page, browser }) => {
    const uniq = String(Date.now() % 100000).padStart(5, '0') + String(process.pid % 100).padStart(2, '0');
    const clientName = `Analytics Lead ${uniq}`;
    const clientPhone = '3165554' + String(uniq).slice(-3);
    const ctx = { clientId: null, bidId: null, sent: {} };

    // ── 1. LEAD CREATED, the real Add Client form ─────────────────────────────
    await step(page, {
      label: '1. create the lead → lead_created', page: 'pg-clients', role: 'contractor',
      suspect: 'clients.js saveClient → lifecycle.js logLifecycle("lead_created")',
      ruleText: 'saving the lead form must write a real lead_created row to lifecycle_events',
      expected: 'a lifecycle_events row for this client, event=lead_created',
      act: async (p) => {
        await p.evaluate(() => {
          window._showingScheduleAlert = true;   // park unrelated seed-data popups (§12.7)
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
        });
        let n = 0;
        const leadsNav = await p.evaluate(() =>
          (document.getElementById('mtb-leads')?.offsetWidth > 0) ? '#mtb-leads' : '#nb-leads');
        n += await tap(p, leadsNav);
        await p.waitForSelector('#pg-leads.active', { state: 'attached', timeout: 8000 });
        n += await tap(p, '#pg-leads .tbar-r .btn-p');
        await p.waitForSelector('#cf-name', { state: 'visible', timeout: 8000 });
        n += await type(p, '#cf-name', clientName);
        n += await type(p, '#cf-phone', clientPhone);
        n += await type(p, '#cf-street', '900 Analytics Ave');
        n += await type(p, '#cf-city', 'Wichita');
        n += await pick(p, '#cf-partytype', 'Homeowner');
        n += await pick(p, '#cf-source', 'Referral');
        await p.evaluate(() => saveClient());
        // logLifecycle is fire-and-forget by design (never blocks the UI); force
        // the queue out now so the very next assertion sees a real row, not a
        // race against the app's own lazy flush.
        await p.evaluate(async () => { if (typeof _flushLifecycle === 'function') await _flushLifecycle(); });
        await p.waitForTimeout(400);
        return n + 1;
      },
      rule: async (p) => {
        ctx.clientId = await p.evaluate((nm) => (clients.find(c => c.name === nm) || {}).id || null, clientName);
        if (!ctx.clientId) return { ok: false, got: 'client not found locally' };
        const r = await p.evaluate(async (cid) => {
          const { data, error } = await _supa.from('lifecycle_events')
            .select('event, ts').eq('client_id', String(cid)).eq('event', 'lead_created');
          return { rows: data || [], error: error ? error.message : null };
        }, ctx.clientId);
        return { ok: !r.error && r.rows.length > 0 && !!r.rows[0].ts, got: JSON.stringify(r) };
      },
    });

    // ── 2. BUILD THE ESTIMATE, real builder open + save ───────────────────────
    await step(page, {
      label: '2. build the BYO estimate → proposal_started + proposal_saved', page: 'pg-est-generic', role: 'contractor',
      suspect: 'generic-estimate.js openFreeFormEstimate → lcProposalStarted; draft save → lcProposalSaved',
      ruleText: 'opening then saving the builder must write BOTH milestones as real rows, in order',
      expected: 'lifecycle_events has proposal_started AND proposal_saved for this client/bid, started before saved',
      act: async (p) => {
        const clicks = await p.evaluate(async ({ cid }) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          const c = getClientById(cid);
          openFreeFormEstimate(c, null); await wait(400);       // fires lcProposalStarted
          set('gei-client', c.name); set('gei-addr', c.addr || '900 Analytics Ave, Wichita');
          const addItem = async (sec, label, price, notes) => {
            _byoAddItem(sec); await wait(90);
            set('_bya-label', label); set('_bya-price', String(price)); set('_bya-notes', notes);
            _byaConfirm(sec); await wait(90);
          };
          await addItem('Materials', 'Job materials + sundries', 300, 'per scope');
          await addItem('Interior', 'One room repaint', 1200, 'walls only');
          try { _byoUpdateRail(); calcGeiTotal(); } catch (e) {}
          await wait(150);
          return 1 + (1 + 25 + 3 + 9 + 1) + (1 + 20 + 4 + 10 + 1);
        }, { cid: ctx.clientId });

        // Save the draft for real (fires lcProposalSaved), then find the bid.
        // saveGenericEstimate(true) is the actual function name (verified in
        // js/generic-estimate.js); sendGenericProposal also calls this internally
        // as its first action, this direct call just makes step 2's own
        // before/after ordering assertion possible ahead of step 3's send.
        await p.evaluate(async () => { try { saveGenericEstimate(true); } catch (e) {} });
        await p.waitForTimeout(300);
        ctx.bidId = await p.evaluate(({ cid }) => {
          const cands = bids.filter(b => b.client_id === cid).sort((a, b) => (b.id || 0) - (a.id || 0));
          return cands.length ? cands[0].id : null;
        }, { cid: ctx.clientId });
        await p.evaluate(async () => { if (typeof _flushLifecycle === 'function') await _flushLifecycle(); });
        await p.waitForTimeout(400);
        return clicks + 1; // + the save
      },
      rule: async (p) => {
        if (!ctx.bidId) return { ok: false, got: 'no bid found for client after save' };
        const r = await p.evaluate(async ({ cid }) => {
          const { data, error } = await _supa.from('lifecycle_events')
            .select('event, ts').eq('client_id', String(cid)).in('event', ['proposal_started', 'proposal_saved']);
          return { rows: data || [], error: error ? error.message : null };
        }, { cid: ctx.clientId });
        const started = r.rows.find(x => x.event === 'proposal_started');
        const saved = r.rows.find(x => x.event === 'proposal_saved');
        return {
          ok: !r.error && !!started && !!saved && started.ts <= saved.ts,
          got: JSON.stringify(r),
        };
      },
    });

    // ── 3. SEND ────────────────────────────────────────────────────────────────
    await step(page, {
      label: '3. send the proposal → proposal_sent', page: 'pg-est-generic', role: 'contractor',
      suspect: 'proposals.js sendGenericProposal → logLifecycle("proposal_sent")',
      ruleText: 'sending must write a real proposal_sent row AND still stamp the artifact/token as before',
      expected: 'artifact uploaded, signingToken present, lifecycle_events has proposal_sent',
      act: async (p) => {
        await p.evaluate(async () => { try { await sendGenericProposal(false); } catch (e) {} });
        ctx.sent = await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const id = () => (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
          for (let i = 0; i < 30; i++) {
            const b = id() ? bids.find(x => x.id === id()) : null;
            if (b && b.signingToken && b.proposalKey) break;
            await wait(500);
          }
          const bid = bids.find(x => x.id === id());
          let artifact = false;
          if (bid && bid.proposalKey) {
            for (let i = 0; i < 40; i++) {
              try { const { data, error } = await _supa.storage.from('proposals').download(bid.proposalKey); if (data && !error) { artifact = true; break; } } catch (e) {}
              await wait(500);
            }
          }
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
          window._showingScheduleAlert = false;
          const t0 = Date.now();
          while (typeof _sigFeedReady !== 'undefined' && !_sigFeedReady && Date.now() - t0 < 15000) await wait(200);
          if (typeof _flushLifecycle === 'function') await _flushLifecycle();
          return {
            bidId: bid ? bid.id : null, token: bid ? bid.signingToken : null,
            amount: bid ? bid.amount : 0, uid: _supaUser ? _supaUser.id : null, artifact,
            sigFeedReady: typeof _sigFeedReady === 'undefined' ? true : _sigFeedReady,
          };
        });
        ctx.bidId = ctx.sent.bidId;
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(async ({ cid }) => {
          const { data, error } = await _supa.from('lifecycle_events')
            .select('event').eq('client_id', String(cid)).eq('event', 'proposal_sent');
          return { rows: data || [], error: error ? error.message : null };
        }, { cid: ctx.clientId });
        return {
          ok: !!ctx.sent.token && ctx.sent.artifact && ctx.sent.sigFeedReady && !r.error && r.rows.length > 0,
          got: `sent=${JSON.stringify(ctx.sent)} lc=${JSON.stringify(r)}`,
        };
      },
    });

    // ── 4. CLIENT VIEWS + SIGNS, the real link, real Edge Function calls ──────
    const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cp = await clientCtx.newPage();
    await step(page, {
      label: '4. client opens + signs → proposal_opened + signed (real Edge Function)', page: 'sign.html', role: 'client',
      suspect: 'log-proposal-view Edge Function (logAuditEvent) → proposal_audit_events',
      ruleText: 'viewing then signing must write BOTH audit events for real, through the real network call, not a client-side insert',
      expected: 'proposal_audit_events has proposal_opened AND signed for this bid',
      act: async () => {
        const base = process.env.E2E_BASE_URL || 'http://localhost:8788';
        await cp.goto(`${base}/sign.html?t=${ctx.sent.token}&u=${ctx.sent.uid}&b=${ctx.bidId}`, { waitUntil: 'domcontentloaded' });
        await cp.waitForSelector('#approve-btn', { state: 'visible', timeout: 20000 });
        let n = await tap(cp, '#approve-btn');
        await cp.waitForSelector('#sig-name', { state: 'visible', timeout: 10000 });
        n += await type(cp, '#sig-name', clientName);
        await cp.waitForTimeout(300);
        n += await tap(cp, '#sign-btn');
        await cp.waitForSelector('#sign-pay-btns button', { state: 'visible', timeout: 10000 });
        n += await tap(cp, '#sign-pay-btns button:has-text("Cash")');
        await cp.waitForSelector('#sec-cash-confirm-btn', { state: 'visible', timeout: 8000 });
        n += await tap(cp, '#sec-cash-confirm-btn');
        await cp.waitForSelector('#pg-done', { state: 'visible', timeout: 25000 });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(async ({ bidId }) => {
          const { data, error } = await _supa.from('proposal_audit_events')
            .select('event, ts').eq('bid_id', String(bidId));
          return { rows: data || [], error: error ? error.message : null };
        }, { bidId: ctx.bidId });
        const opened = r.rows.some(x => x.event === 'proposal_opened');
        const signed = r.rows.some(x => x.event === 'signed');
        return { ok: !r.error && opened && signed, got: JSON.stringify(r) };
      },
    });
    await clientCtx.close(); // resource cleanup (not data, §12.7)

    // ── 5. THE REST OF THE FUNNEL, the real primitive, staggered timestamps ───
    // The UI paths that fire these (schedule/clock/complete/pay) are already
    // exhaustively covered by full-lifecycle-flow.spec.js. What this flow needs
    // is real, ordered rows for logLifecycle itself, not a second proof that the
    // scheduling modal works.
    await step(page, {
      label: '5. schedule → complete → paid, via the real logLifecycle primitive', page: 'cloud', role: 'contractor',
      suspect: 'lifecycle.js logLifecycle (job_scheduled / job_completed / balance_settled)',
      ruleText: 'three more real, ordered milestones must land for the same bid',
      expected: 'lifecycle_events has job_scheduled, job_completed, balance_settled, all after signed',
      act: async (p) => {
        await p.evaluate(async ({ cid, bid }) => {
          logLifecycle('job_scheduled', { bidId: bid, clientId: cid, jobId: bid });
          await new Promise(r => setTimeout(r, 250));
          logLifecycle('job_completed', { jobId: bid, bidId: bid, clientId: cid });
          await new Promise(r => setTimeout(r, 250));
          logLifecycle('balance_settled', { bidId: bid, clientId: cid });
          if (typeof _flushLifecycle === 'function') await _flushLifecycle();
        }, { cid: ctx.clientId, bid: ctx.bidId });
        await p.waitForTimeout(500);
        return 0; // no user interaction: this proves the substrate, not new UI
      },
      rule: async (p) => {
        const r = await p.evaluate(async ({ cid }) => {
          const { data, error } = await _supa.from('lifecycle_events')
            .select('event, ts').eq('client_id', String(cid))
            .in('event', ['signed', 'job_scheduled', 'job_completed', 'balance_settled']);
          return { rows: data || [], error: error ? error.message : null };
        }, { cid: ctx.clientId });
        const byEvent = {}; r.rows.forEach(x => { byEvent[x.event] = x.ts; });
        const ordered = byEvent.job_scheduled && byEvent.job_completed && byEvent.balance_settled &&
          byEvent.job_scheduled <= byEvent.job_completed && byEvent.job_completed <= byEvent.balance_settled;
        return { ok: !r.error && ordered, got: JSON.stringify(byEvent) };
      },
    });

    // ── 6. THE BOOKS SUMMARY FUNNEL RENDERS YOUR OWN REAL NUMBERS ─────────────
    await step(page, {
      label: '6. Books → Summary → your funnel shows real stages', page: 'pg-tracker', role: 'contractor',
      suspect: 'lifecycle.js renderLifecycleFunnel/_lcFetchMine → lifecycle_funnel RPC (live, RLS-scoped)',
      ruleText: 'the RPC reads YOUR rows live: at least one real stage pair from this run must render with samples > 0',
      expected: '#lc-funnel-mine lists lead_created→proposal_saved (or another pair this run created) with a real duration',
      act: async (p) => {
        let n = await tap(p, '#nb-tracker');
        await p.waitForSelector('#pg-tracker.active', { state: 'attached', timeout: 8000 });
        // Summary is the default tab (owner mandate, 2026-07-14); tap it anyway
        // for a real, honest interaction rather than assuming it's already active.
        n += await tap(p, '#tr-t-summary');
        await p.waitForSelector('#lc-funnel-mine', { state: 'attached', timeout: 8000 });
        await p.waitForTimeout(500);
        // "All your numbers" defaults CLOSED (same _mmtCol_-style pattern,
        // CLAUDE.md §10.6, just under _lcSecOpen_ instead): a real tap opens it.
        const hdr = p.locator('#lc-funnel-mine div[onclick*="_lcTogSection"]').first();
        if (await hdr.isVisible().catch(() => false)) {
          await hdr.click({ timeout: 5000 });
          n += 1;
          await p.waitForTimeout(400);
        }
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const el = document.getElementById('lc-funnel-mine');
          const html = el ? el.innerHTML : '';
          return {
            hasContent: html.length > 0,
            hasLeadToProposal: /New lead to proposal/.test(html),
            hasSentToSigned: /Sent to signed|Signed to scheduled|Job start to finish|Finished to paid in full/.test(html),
            loadingOrEmpty: /Loading your numbers|unavailable right now|Nothing to measure yet/.test(html),
          };
        });
        return {
          ok: r.hasContent && !r.loadingOrEmpty && (r.hasLeadToProposal || r.hasSentToSigned),
          got: JSON.stringify(r),
        };
      },
    });

    // ── 7. BEST-EFFORT: exercise the real rollup, tolerant of environment ─────
    // Local-stack CI serves this fn with --no-verify-jwt (real invocation).
    // Cloud mode may reject an unprivileged caller: that is the fn working AS
    // DESIGNED (service-role only), not a failure of this flow, so both a
    // success and an auth rejection count as "ok". Only a hard crash (500) or
    // total unreachability signal a real problem worth a finding.
    await step(page, {
      label: '7. rollup-analytics is reachable and behaves (best-effort)', page: 'cloud', role: 'contractor',
      suspect: 'supabase/functions/rollup-analytics',
      ruleText: 'the function must either run successfully or reject an unprivileged caller cleanly, never 500 or time out',
      expected: 'HTTP status in {200, 401, 403}',
      act: async (p) => {
        ctx.rollup = await p.evaluate(async () => {
          try {
            // SUPA_URL/SUPA_KEY are the app's real globals (js/cloud.js): whichever
            // Supabase endpoint this session is actually talking to (direct or
            // proxied), same one every other real call in this flow already used.
            const url = (typeof SUPA_URL !== 'undefined' ? SUPA_URL : '') + '/functions/v1/rollup-analytics';
            const res = await fetch(url, {
              method: 'POST',
              headers: { apikey: (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : ''), 'Content-Type': 'application/json' },
            });
            return { status: res.status, ok: res.ok };
          } catch (e) { return { status: 0, error: e.message }; }
        });
        return 0; // background verification, not a user action
      },
      rule: async () => ({
        ok: [200, 401, 403].includes(ctx.rollup.status),
        got: JSON.stringify(ctx.rollup),
      }),
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget).toBe(false);
  });
});
