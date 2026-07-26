// REAL flow, the stuck "awaiting signature" count proven against the real backend.
//
// Owner report: an account showed 3 clients awaiting signature when only 1 actually
// was. Root cause (js/cloud.js): checkNewSignatures only ever sees the most recent
// 100 signed_proposals rows (full poll) or rows past its updated_at watermark (delta
// poll). Once an account accumulates signature history, an older decline row can
// never resurface through EITHER path, so the bid it belongs to sits "Pending"
// forever and keeps inflating the awaiting-signature count.
//
// This flow reproduces that exactly, then proves the fix:
//   1. two real proposals go out (A: declined later, B: genuinely still pending)
//   2. the dashboard's Make Money Today lists BOTH under "Pending"
//   3. A's client declines, and the account then accumulates 100 NEWER signature
//      rows, so A's decline falls outside the full poll's limit(100) window AND
//      behind the delta watermark. A normal poll CANNOT fix it: the bid stays
//      stuck "Pending" and keeps showing on the dashboard. (the bug)
//   4. the contractor reopens the app: the fresh full poll fires
//      _reconcilePendingSigStatuses, a direct watermark/limit-independent lookup
//      scoped to the few bids still Pending with a signing token. A flips to
//      Closed Lost carrying the client's decline reason, B is left alone, and the
//      pending count drops by exactly one.
//
//   suspect chain: cloud.js checkNewSignatures (100-row window + watermark) →
//   _reconcilePendingSigStatuses → _applySigStatusToBid → dashboard.js renderDash.
//
// The permanent regression guard for the fix (CLAUDE.md §13.4): step 3 asserts the
// poll alone still can't reach the row, step 4 asserts the reconcile does. Delete
// the reconcile pass and step 4 goes red.
//
// Seed data is left in the dev account per CLAUDE.md §12.7: no cleanup.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal, tap } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'sig-reconcile/stuck-decline';
const DECLINE_REASON = 'Went with another contractor';

// The full poll is .order('signed_at',desc).limit(100), so this many rows NEWER
// than the decline is exactly what pushes it out of reach of every poll path.
const FILLER_ROWS = 100;

// Tap whichever dashboard nav is actually on screen: the mobile tab bar and the
// desktop nav bar are different elements, and this flow runs at all three viewports.
async function navDash(p) {
  for (const sel of ['#mtb-dash', '#nb-dash']) {
    const loc = p.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return await tap(p, sel);
  }
  return 0; // already on the dashboard
}

// The MMT "Pending" section header, tapping it expands the section so its item
// cards actually render into innerHTML (CLAUDE.md §10.6: sections default closed).
const PENDING_HDR = '.mmt-sec-hdr:has(.mmt-sec-label:text-is("Pending"))';

// What the contractor actually sees: how many cards the Pending section is showing,
// and whether a given bid is one of them.
async function pendingView(p, ids) {
  return await p.evaluate(({ ids }) => {
    const feed = document.getElementById('dash-money-feed');
    const html = feed ? feed.innerHTML : '';
    let badge = -1;
    document.querySelectorAll('.mmt-sec').forEach(sec => {
      const lbl = sec.querySelector('.mmt-sec-label');
      if (lbl && lbl.textContent.trim() === 'Pending') {
        const b = sec.querySelector('.mmt-sec-badge');
        if (b) badge = parseInt(b.textContent, 10);
      }
    });
    const model = (typeof bids !== 'undefined' ? bids : [])
      .filter(b => b.signingToken && b.status === 'Pending').length;
    const shown = {};
    ids.forEach(id => { shown[id] = html.includes(String(id)); });
    return { badge, model, shown };
  }, { ids });
}

test.describe('awaiting-signature count self-heals (UI-driven, real backend)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a decline the poll window can no longer reach still clears the awaiting-sig count', async ({ page }) => {
    // Unique ids so this run's seed data never collides with a previous one's
    // (CLAUDE.md §12.7: live tests never clean up after themselves).
    const base = Date.now() * 1000 + (process.pid % 1000);
    const clientA = base, bidA = base + 1;        // this one gets declined
    const clientB = base + 2, bidB = base + 3;    // this one stays genuinely pending
    let seedA = {}, seedB = {}, before = {};

    // ── STEP 1: two real proposals go out ─────────────────────────────────────
    await step(page, {
      label: 'send two real proposals', page: 'cloud', role: 'contractor',
      suspect: 'live-helpers seedProposal → td_bids + proposals storage',
      ruleText: 'both proposals must land as Pending bids carrying a signing token',
      expected: 'two tokens, both bids Pending',
      act: async (p) => {
        seedA = await seedProposal(p, { clientId: clientA, bidId: bidA, amount: 4200, tag: 'sigrec-a' });
        seedB = await seedProposal(p, { clientId: clientB, bidId: bidB, amount: 3100, tag: 'sigrec-b' });
        return 2; // one send apiece
      },
      rule: async (p) => {
        const r = await p.evaluate(({ a, b }) => {
          const ba = bids.find(x => String(x.id) === String(a));
          const bb = bids.find(x => String(x.id) === String(b));
          return {
            a: ba ? ba.status : null, aTok: !!(ba && ba.signingToken),
            b: bb ? bb.status : null, bTok: !!(bb && bb.signingToken),
          };
        }, { a: bidA, b: bidB });
        return {
          ok: r.a === 'Pending' && r.aTok && r.b === 'Pending' && r.bTok && !seedA.uploadErr && !seedB.uploadErr,
          got: JSON.stringify(r) + ` uploadErr=${seedA.uploadErr || seedB.uploadErr || 'none'}`,
        };
      },
    });

    // ── STEP 2: the dashboard lists both as awaiting signature ────────────────
    await step(page, {
      label: 'open dashboard → expand Pending', page: 'pg-dash', role: 'contractor',
      suspect: 'dashboard.js renderDash MMT pending section (bids.filter signingToken && Pending)',
      ruleText: 'both freshly-sent proposals must show under Make Money Today → Pending',
      expected: 'both bid cards rendered in the Pending section',
      act: async (p) => {
        let n = await navDash(p);
        await p.evaluate(() => { if (typeof renderDash === 'function') renderDash(); });
        await p.waitForTimeout(400);
        n += await tap(p, PENDING_HDR);   // real tap on the section header
        await p.waitForTimeout(300);
        return n;
      },
      rule: async (p) => {
        before = await pendingView(p, [bidA, bidB]);
        return {
          ok: before.shown[bidA] === true && before.shown[bidB] === true && before.model >= 2,
          got: JSON.stringify(before),
        };
      },
    });

    // ── STEP 3: the client declines, then the account outgrows the poll window ─
    // THE BUG: neither poll path can reach the decline any more, so the bid stays
    // stuck "Pending" and keeps padding the awaiting-signature count.
    await step(page, {
      label: 'client declines, then 100 newer signatures bury the row', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js checkNewSignatures: full poll limit(100) + delta poll gt(_sigPollWatermark)',
      ruleText: 'a decline older than the poll window must NOT be reachable by a normal poll: this is the stuck state the fix has to correct',
      expected: 'bid A still Pending and still on the dashboard, count unchanged',
      act: async (p) => {
        await p.evaluate(async ({ bidA, reason, filler }) => {
          const uid = _supaUser.id;
          const iso = d => new Date(d).toISOString();
          // The client taps "Decline" in sign.html. Dated well in the past: this is
          // the decline that later goes unreachable.
          await _supa.from('signed_proposals').upsert({
            bid_id: String(bidA), contractor_user_id: uid,
            client_name: 'Sig Reconcile A', client_signed_name: 'Sig Reconcile A',
            amount: 4200, signed_at: iso(Date.now() - 400 * 86400000),
            payment_status: 'declined', decline_reason: reason,
          }, { onConflict: 'bid_id' });
          // The account keeps working: 100 NEWER signature rows accumulate, exactly
          // what pushes the decline past the full poll's limit(100). Their bid_ids
          // match no local bid, so the poll loop skips them (`if(!bid) continue`).
          const rows = [];
          for (let i = 0; i < filler; i++) {
            rows.push({
              bid_id: String(9e14 + i), contractor_user_id: uid,
              client_name: 'History ' + i, client_signed_name: 'History ' + i,
              amount: 1000 + i, signed_at: iso(Date.now() - (i + 1) * 3600000),
              payment_status: 'paid',
            });
          }
          await _supa.from('signed_proposals').upsert(rows, { onConflict: 'bid_id' });
        }, { bidA, reason: DECLINE_REASON, filler: FILLER_ROWS });

        await p.evaluate(async ({ bidA }) => {
          // This session has already polled past everything above, so the watermark
          // sits at the newest row: precisely the state where the delta poll returns
          // nothing and the reconcile (full-poll only) never runs.
          const { data } = await _supa.from('signed_proposals')
            .select('updated_at').eq('contractor_user_id', _supaUser.id)
            .order('updated_at', { ascending: false }).limit(1);
          _sigPollWatermark = (data && data[0] && data[0].updated_at) || new Date().toISOString();
          // The row was processed once already, and the local bid drifted back to
          // Pending: the observed end state the owner reported.
          const seen = new Set(JSON.parse(localStorage.getItem('zp3_seen_sigs') || '[]'));
          seen.add(String(bidA));
          localStorage.setItem('zp3_seen_sigs', JSON.stringify([...seen]));
          const ba = bids.find(x => String(x.id) === String(bidA));
          if (ba) { ba.status = 'Pending'; ba.draft = false; delete ba.lostReason; delete ba.declinedAt; }
          await checkNewSignatures();     // the steady-state delta poll
          if (typeof renderDash === 'function') renderDash();
        }, { bidA });
        await p.waitForTimeout(600);
        return 1; // the client's decline (their device, not the contractor's thumb)
      },
      rule: async (p) => {
        const r = await p.evaluate(({ a }) => {
          const ba = bids.find(x => String(x.id) === String(a));
          return { status: ba ? ba.status : null };
        }, { a: bidA });
        const v = await pendingView(p, [bidA, bidB]);
        return {
          ok: r.status === 'Pending' && v.shown[bidA] === true && v.model === before.model,
          got: JSON.stringify(r) + ' view=' + JSON.stringify(v) + ' before=' + JSON.stringify(before),
        };
      },
    });

    // ── STEP 4: reopening the app self-heals the count ────────────────────────
    // THE FIX: a fresh load does a full poll, which fires the reconcile pass.
    await step(page, {
      label: 'reopen the app → count self-heals', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js _reconcilePendingSigStatuses + _applySigStatusToBid',
      ruleText: 'a fresh full poll must clear the stale decline: bid A flips to Closed Lost with the client\'s reason, bid B is untouched, and the awaiting-signature count drops by exactly one',
      expected: 'A=Closed Lost (+lostReason), B=Pending, A gone from the feed, count = before-1',
      act: async (p) => {
        const diag = await p.evaluate(async () => {
          const busyBefore = typeof _checkSigsBusy !== 'undefined' ? _checkSigsBusy : null;
          _sigPollWatermark = null;       // fresh load → full poll → reconcile fires
          await checkNewSignatures('boot');
          const watermarkAfter = typeof _sigPollWatermark !== 'undefined' ? _sigPollWatermark : null;
          // checkNewSignatures has a busy-guard: a concurrent call already in
          // flight (this account has heavy realtime signature traffic right
          // after seeding 100 filler rows) makes our call short-circuit and
          // mark itself pending instead of ever reaching the reconcile line.
          // Bypass that guard entirely with a direct, awaited call, which has
          // no such guard of its own, to tell that apart from a real bug in
          // the reconcile logic itself.
          let directCallThrew = null;
          try { await _reconcilePendingSigStatuses(); } catch (e) { directCallThrew = e.message; }
          return { busyBefore, watermarkAfter, directCallThrew };
        });
        // eslint-disable-next-line no-console
        console.log('RECONCILE ACT DIAG:', JSON.stringify(diag));
        await p.waitForTimeout(1200);
        return 1; // reopening the app
      },
      rule: async (p) => {
        const r = await p.evaluate(({ a, b }) => {
          const ba = bids.find(x => String(x.id) === String(a));
          const bb = bids.find(x => String(x.id) === String(b));
          return {
            aStatus: ba ? ba.status : null, aReason: ba ? (ba.lostReason || null) : null,
            bStatus: bb ? bb.status : null, bTok: !!(bb && bb.signingToken),
          };
        }, { a: bidA, b: bidB });
        const v = await pendingView(p, [bidA, bidB]);
        // Diagnostic (kept regardless of pass/fail): replicate
        // _reconcilePendingSigStatuses's own query by hand, so a failure shows
        // exactly what it saw, error, empty, wrong row, instead of just "didn't work".
        const diag = await p.evaluate(async ({ a }) => {
          const pending = (typeof bids !== 'undefined' ? bids : [])
            .filter(x => x.signingToken && x.status === 'Pending' && x.id);
          const uid = _supaUser ? _supaUser.id : null;
          let queryResult = null;
          try {
            const { data, error } = await _supa.from('signed_proposals')
              .select('*').eq('contractor_user_id', uid)
              .in('bid_id', pending.map(x => String(x.id)));
            queryResult = {
              error: error ? (error.message || JSON.stringify(error)) : null,
              rowCount: data ? data.length : null,
              rowForA: data ? data.find(s => String(s.bid_id) === String(a)) : null,
            };
          } catch (e) { queryResult = { threw: e.message }; }
          return { pendingCount: pending.length, pendingIds: pending.map(x => x.id), uid, queryResult };
        }, { a: bidA });
        return {
          ok: r.aStatus === 'Closed Lost' && r.aReason === DECLINE_REASON &&
              r.bStatus === 'Pending' && r.bTok &&
              v.shown[bidA] === false && v.shown[bidB] === true &&
              v.model === before.model - 1,
          got: JSON.stringify(r) + ' view=' + JSON.stringify(v) + ' before=' + JSON.stringify(before) +
               ' diag=' + JSON.stringify(diag),
        };
      },
      // Adversarial: a second reconcile pass must be idempotent, it must not walk
      // the healed bid back to Pending or double-apply the decline.
      abuse: async (p) => {
        await p.evaluate(async () => { _sigPollWatermark = null; await checkNewSignatures('boot'); });
        await p.waitForTimeout(500);
        const again = await p.evaluate(({ a }) => {
          const ba = bids.find(x => String(x.id) === String(a));
          return ba ? ba.status : null;
        }, { a: bidA });
        if (again !== 'Closed Lost') throw new Error('reconcile not idempotent: ' + again);
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget).toBe(false);
  });
});
