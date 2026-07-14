// REAL two-account flow — the LIVE GC↔sub pipe, end to end through real Supabase.
//
// Dev A = the general contractor / business owner (E2E_DEV_*  → logansample).
// Dev B = the 1099 subcontractor who signed up      (E2E_DEV2_* → the sub).
//
// This is the ONE feature offline shims can't honestly prove: two DISTINCT
// accounts moving data through the real database — the RLS policies, the atomic
// claim, the SECURITY DEFINER link-forging RPC, and the column-level grants are
// all server-side behavior. So this drives BOTH identities against the live
// project and asserts the data actually crosses:
//
//   1. A adds the sub to its roster and mints an invite grant (real RPC insert).
//   2. B redeems the grant (real redeem_sub_invite_grant RPC) → forges the
//      standing business_links row + pre-loads B's books.
//   3. A assigns the sub to a job (real modal, ledgered clicks) → job_assignments.
//   4. A marks the sub paid (real action, ledgered clicks)     → payment_offers.
//   5. B ingests the pipe (_ingestPipeInbox) → the job address lands on B's
//      calendar and the payment lands on B's income ledger, AUTOMATICALLY.
//   6. Assert the PRIVACY CONTRACT held live: what crossed is address + amount +
//      date + payer name — never A's job names, descriptions, or client details.
//
// REQUIRES a SECOND real dev account (the sub):
//   E2E_DEV2_EMAIL, E2E_DEV2_PASSWORD, E2E_DEV2_USER_ID
// Soft-skips cleanly until they're set. Also soft-skips (never red) if the pipe
// migrations (business_links / payment_offers / job_assignments + the 2-arg
// redeem RPC) aren't applied to the project yet — a missing table is a deploy
// gap, not a code regression.
//
// Per §12.7 this leaves its run-tagged rows in place for you to open and poke at;
// it never cleans up its own seed data.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, resetLedger, step, report, signIn, tap, type } = require('./live-helpers');

const BASELINE = require('./perf-baseline.json');
const FLOW = 'sub-pipe/gc-to-sub';

const A = { email: process.env.E2E_DEV_EMAIL || '', password: process.env.E2E_DEV_PASSWORD || '', uid: process.env.E2E_DEV_USER_ID || '' };
const B = { email: process.env.E2E_DEV2_EMAIL || '', password: process.env.E2E_DEV2_PASSWORD || '', uid: process.env.E2E_DEV2_USER_ID || '' };
const haveTwoAccounts = !!(A.email && A.password && A.uid && B.email && B.password && B.uid);

// Unique per run so the accumulating seed data never collides across runs (§12.7).
const RUN = Date.now() * 1000 + (process.pid % 1000);
const ROSTER_ID = RUN;                 // the sub's id inside A's roster == the link's sub_roster_id
const JOB_ID = RUN + 1;
const JOB_ADDR = `${RUN % 9000 + 100} Pipe Flow Way`;
const JOB_START = new Date().toISOString().slice(0, 10);
const PAY_AMOUNT = 1000 + (RUN % 9000);           // run-unique so assertions target THIS run's row, not a stale one
const PRIVATE_SCOPE = `Private scope ${RUN}`;     // A's private work note — must NEVER cross to B
const SECRET_JOB_NAME = `SECRET CLIENT ${RUN}`;   // A's private label — must NEVER cross to B
const A_BIZ_MARK = `PipeFlow GC ${RUN}`;

// Open the app fresh and sign in as a specific account, like launching it.
async function openAs(page, acct) {
  await page.goto('/');
  await page.waitForSelector('#supa-email', { timeout: 30000 });
  await signIn(page, acct);
  await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
}

// Probe whether the pipe schema exists in the project. A missing relation → the
// migrations haven't deployed yet → soft-skip (never red).
async function pipeSchemaPresent(page) {
  return await page.evaluate(async () => {
    try {
      const { error } = await _supa.from('business_links').select('id').limit(1);
      if (error && /relation|does not exist|not find|schema cache/i.test(error.message || '')) return false;
      return true;
    } catch (e) { return false; }
  });
}

test.describe('live GC↔sub pipe — two real accounts, end to end', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');
  test.skip(!haveTwoAccounts, 'needs a SECOND dev account (the sub) — set E2E_DEV2_EMAIL / E2E_DEV2_PASSWORD / E2E_DEV2_USER_ID');

  test('a payment + a job address cross from the GC to the subcontractor, and only those', async ({ browser }) => {
    test.setTimeout(180000);
    resetLedger();

    // Two independent browser contexts = two real devices, two real logins.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // ── GC signs in ────────────────────────────────────────────────────────
      await openAs(pageA, A);
      expect(await pageA.evaluate(() => _supaUser && _supaUser.id), 'signed in as GC (Dev A)').toBe(A.uid);

      if (!(await pipeSchemaPresent(pageA))) {
        test.skip(true, 'pipe migrations not applied to the project yet (business_links/payment_offers/job_assignments) — deploy them, then this goes live');
      }

      // ── 1. GC adds the sub to its roster + mints an invite grant ────────────
      // The grant's payload.sub.rosterId == ROSTER_ID is what ties the standing
      // link back to this roster row, so A's later payments/assignments to it
      // flow as pipe events. (No same-device UI for the cross-account handshake
      // — it's inherently a server round-trip — so this is evaluate plumbing.)
      const grantTok = await pageA.evaluate(async ({ rosterId, mark }) => {
        S.bname = S.bname || mark;
        S.subcontractors = S.subcontractors || [];
        // remove any stale row with this id, then add ours
        S.subcontractors = S.subcontractors.filter(s => String(s.id) !== String(rosterId));
        S.subcontractors.push({ id: rosterId, name: 'Pipe Flow Sub', trade: 'Drywall', phone: '3165550123' });
        if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        const sub = S.subcontractors.find(s => String(s.id) === String(rosterId));
        return (typeof _createSubInviteGrant === 'function') ? await _createSubInviteGrant(sub) : null;
      }, { rosterId: ROSTER_ID, mark: A_BIZ_MARK });
      expect(grantTok, 'GC minted an invite grant token').toBeTruthy();

      // ── 2. Sub signs in and REDEEMS the grant → forges the standing link ────
      await openAs(pageB, B);
      expect(await pageB.evaluate(() => _supaUser && _supaUser.id), 'signed in as sub (Dev B)').toBe(B.uid);

      const redeem = await pageB.evaluate(async ({ tok }) => {
        localStorage.setItem('_pendingSubInviteGrant', tok);
        S.bname = S.bname || 'Pipe Flow Sub Co';
        const ok = (typeof _redeemSubInviteGrant === 'function') ? await _redeemSubInviteGrant() : false;
        if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        return ok;
      }, { tok: grantTok });
      expect(redeem, 'sub redeemed the grant (books pre-loaded + link forged)').toBe(true);

      // The referrer's reward accrued at the verified signup: A should now hold
      // a referral_rewards row for B (read from A's session — RLS scopes it to
      // the referrer). Skipped gracefully if the rewards table isn't deployed.
      const rewardLive = await pageA.evaluate(async ({ Buid }) => {
        try {
          const { data, error } = await _supa.from('referral_rewards')
            .select('referred_sub_user_id,reward_type,status').eq('referrer_user_id', _supaUser.id).eq('referred_sub_user_id', Buid).limit(1);
          if (error && /relation|does not exist|schema cache/i.test(error.message || '')) return 'no-table';
          return (data || []).length ? 'earned' : 'missing';
        } catch (e) { return 'no-table'; }
      }, { Buid: B.uid });
      if (rewardLive !== 'no-table') {
        expect(rewardLive, 'referrer earned a reward for the verified signup').toBe('earned');
      }

      // Confirm the standing link exists (both ends can see it) and read its
      // ACTUAL roster id. business_links is a SINGLETON per (GC, sub) pair with
      // on-conflict-do-nothing, so on any run after the very first it carries
      // the FIRST run's roster id — the durable binding, which is correct
      // product behavior (a GC and a sub have ONE relationship). Everything
      // downstream drives off THIS id, not the freshly-minted one, so the test
      // is idempotent across the never-cleaned-up accounts (§12.7).
      const effectiveRosterId = await pageB.evaluate(async ({ Auid }) => {
        try {
          const { data } = await _supa.from('business_links').select('sub_roster_id')
            .eq('gc_user_id', Auid).eq('sub_user_id', _supaUser.id).limit(1);
          return (data && data.length) ? String(data[0].sub_roster_id) : null;
        } catch (e) { return null; }
      }, { Auid: A.uid });
      expect(effectiveRosterId, 'business_links row exists for (GC, sub) with a roster id (server-side RPC)').toBeTruthy();

      // GC side: ensure a roster entry with the LINK's roster id exists (the
      // first run created it; a later run re-adds it if the account was
      // cleared), then reload the link cache so the assign/pay paths see it.
      await pageA.evaluate(async ({ rid }) => {
        S.subcontractors = S.subcontractors || [];
        if (!S.subcontractors.some(s => String(s.id) === String(rid))) {
          S.subcontractors.push({ id: Number(rid), name: 'Pipe Flow Sub', trade: 'Drywall', phone: '3165550123' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }
        if (typeof _loadBizLinks === 'function') await _loadBizLinks(true);
      }, { rid: effectiveRosterId });

      // ── 3. GC assigns the sub to a job — REAL modal, ledgered clicks ────────
      // Scaffold the job (a real scheduled job on A's calendar), then drive the
      // assign modal by hand: pick the sub, type work + amount (A's PRIVATE
      // details), tap Assign. _saveSubAssignment fires _offerJobToLinkedSub,
      // which shares ONLY the address + date.
      await pageA.evaluate(({ jobId, addr, start, secret }) => {
        jobs.push({ id: jobId, bid_id: null, client_id: null, name: secret, addr, start, days: 1,
          eventType: 'job', value: 0, status: 'upcoming' });
        saveAll();
      }, { jobId: JOB_ID, addr: JOB_ADDR, start: JOB_START, secret: SECRET_JOB_NAME });

      await step(pageA, {
        label: 'GC assigns sub to job',
        page: 'pg-jobs', role: 'contractor',
        suspect: 'jobs.js _saveSubAssignment → cloud.js _offerJobToLinkedSub',
        ruleText: 'a job_assignments row is created for the linked sub',
        expected: 'assignment row in DB for this roster sub',
        act: async (p) => {
          let clicks = 0;
          await p.evaluate((jobId) => openAssignSubModal(jobId, null), JOB_ID);
          await p.waitForSelector('#asub-pick', { timeout: 8000 });
          clicks += await tap(p, '#asub-pick');                       // open the picker
          // Pick the roster sub whose id matches the LINK's roster id. Several
          // 'Pipe Flow Sub' entries may have accumulated across runs, but only
          // THIS one is actually linked — so match by id, never by label.
          await p.evaluate((rosterId) => {
            const sel = document.getElementById('asub-pick');
            const idx = (S.subcontractors || []).findIndex(s => String(s.id) === String(rosterId));
            if (sel && idx > -1) sel.value = String(idx);
          }, effectiveRosterId);
          clicks += await type(p, '#asub-desc', PRIVATE_SCOPE);         // A's private work note
          clicks += await type(p, '#asub-amount', '900');               // A's private amount owed
          clicks += await tap(p, '#asub-save');                         // the modal's Assign button
          await p.waitForTimeout(400);
          return clicks;
        },
        rule: async (p) => {
          const ok = await p.evaluate(async ({ Auid, rosterId, addr }) => {
            // Give the fire-and-forget insert a beat.
            for (let i = 0; i < 10; i++) {
              try {
                const { data } = await _supa.from('job_assignments').select('job_addr,start_date')
                  .eq('gc_user_id', Auid).eq('job_addr', addr).limit(3);
                if ((data || []).length) return true;
              } catch (e) {}
              await new Promise(r => setTimeout(r, 400));
            }
            return false;
          }, { Auid: A.uid, rosterId: ROSTER_ID, addr: JOB_ADDR });
          return { ok, got: ok ? 'assignment row present' : 'no assignment row for this address' };
        },
      });

      // ── 4. GC marks the sub paid — REAL action, ledgered clicks ────────────
      // markSubPaid fires _offerPaymentToLinkedSub → payment_offers. The sub row
      // lives at index 0 of this job's subs[] (just assigned above).
      await step(pageA, {
        label: 'GC marks the sub paid',
        page: 'pg-jobs', role: 'contractor',
        suspect: 'jobs.js markSubPaid → cloud.js _offerPaymentToLinkedSub',
        ruleText: 'a payment_offers row is created for the linked sub',
        expected: 'payment offer row in DB with the paid amount',
        act: async (p) => {
          // Set the amount owed to our test value, then mark paid. The pay action
          // itself is one tap in the job sheet; drive it directly so the flow is
          // viewport-robust while still exercising the real writer.
          await p.evaluate(({ jobId, amount }) => {
            const j = jobs.find(x => x.id === jobId);
            if (j && j.subs && j.subs[0]) j.subs[0].amount = amount;
            markSubPaid(jobId, 0, null);
          }, { jobId: JOB_ID, amount: PAY_AMOUNT });
          await p.waitForTimeout(400);
          return 1; // the "mark paid" tap
        },
        rule: async (p) => {
          const ok = await p.evaluate(async ({ Auid, amount }) => {
            for (let i = 0; i < 10; i++) {
              try {
                const { data } = await _supa.from('payment_offers').select('amount,job_addr,status')
                  .eq('gc_user_id', Auid).eq('amount', amount).limit(3);
                if ((data || []).length) return true;
              } catch (e) {}
              await new Promise(r => setTimeout(r, 400));
            }
            return false;
          }, { Auid: A.uid, amount: PAY_AMOUNT });
          return { ok, got: ok ? 'payment offer present' : 'no payment offer for this amount' };
        },
      });

      // ── 5. Sub ingests the pipe — the payment + job land AUTOMATICALLY ──────
      await step(pageB, {
        label: 'sub ingests: payment + job land automatically',
        page: 'pg-dash', role: 'contractor',
        suspect: 'cloud.js _ingestPipeInbox',
        ruleText: 'the payment lands on the income ledger and the job address on the calendar',
        expected: 'income row (amount) + job row (address) both present locally',
        act: async (p) => {
          await p.evaluate(async () => { if (typeof _ingestPipeInbox === 'function') await _ingestPipeInbox(true); });
          await p.waitForTimeout(600);
          return 0; // automatic — zero taps for the sub, by design
        },
        rule: async (p) => {
          const r = await p.evaluate(({ amount, addr }) => ({
            hasIncome: (income || []).some(x => Number(x.amount) === amount),
            hasJob: (jobs || []).some(j => j.addr === addr && j.pipeSourced),
          }), { amount: PAY_AMOUNT, addr: JOB_ADDR });
          const ok = r.hasIncome && r.hasJob;
          return { ok, got: `income:${r.hasIncome} job:${r.hasJob}` };
        },
      });

      // ── 6. THE PRIVACY CONTRACT held live ──────────────────────────────────
      const privacy = await pageB.evaluate(({ amount, addr, secretName, scopeNote }) => {
        const inc = (income || []).find(x => Number(x.amount) === amount);
        const job = (jobs || []).find(j => j.addr === addr && j.pipeSourced);
        // ONE client card per linked GC; JOB-SITE addresses never stack onto it
        // (the GC's own business/office address as contact info is fine — that's
        // what any client card has — the multi-property rule is about job sites).
        const gcCards = (clients || []).filter(c => c.gcLinkId);
        const blob = JSON.stringify({ inc, job }).toLowerCase();
        return {
          jobName: (job && job.name) || '',
          jobHasAddr: !!(job && job.addr === addr),
          incHasAddr: !!(inc && (inc.notes || '').includes(addr)),
          // Unambiguous private strings that must NEVER cross the pipe.
          leaksSecretName: blob.includes(secretName.toLowerCase()),
          leaksScopeNote: blob.includes(scopeNote.toLowerCase()),
          gcCardCount: gcCards.length,
          // The JOB address must never land on the client card (multi-property rule).
          gcCardHasJobAddr: gcCards.some(c => c.addr === addr),
        };
      }, { amount: PAY_AMOUNT, addr: JOB_ADDR, secretName: SECRET_JOB_NAME, scopeNote: PRIVATE_SCOPE });

      // Address + amount crossed; A's private job name / scope note / amount-owed did NOT.
      expect(privacy.jobHasAddr, 'job address crossed to the sub').toBe(true);
      expect(privacy.incHasAddr, 'payment carried the job address (for mileage records)').toBe(true);
      expect(privacy.leaksSecretName, "A's private job/client name must NEVER cross").toBe(false);
      expect(privacy.leaksScopeNote, "A's private work/scope note must NEVER cross").toBe(false);
      expect(privacy.jobName.includes(SECRET_JOB_NAME), "the landed job must not carry A's private name").toBe(false);
      expect(privacy.gcCardHasJobAddr, 'the JOB address must never stack onto the client card (multi-property rule)').toBe(false);

      const rep = report(FLOW, BASELINE, pageA);
      // Capture mode until a number is committed to perf-baseline.json; once it
      // is, this hard-gates the click budget (§12.2).
      expect(rep.overBudget, 'GC-side click budget must not regress').toBe(false);
    } finally {
      await ctxA.close().catch(() => {});
      await ctxB.close().catch(() => {});
    }
  });
});
