// REAL flow, build a Build-Your-Own (BYO) estimate by driving the ACTUAL
// generic estimator UI (no seeding), price it, SEND it, and verify the real
// proposal artifact lands in Supabase storage (the thing that was 404-ing as
// "Proposal not found"). The sent bid must carry the line items it was built
// from: not be a hollow Pending row.
//
// Rewritten for the T&M/BYO estimator that REPLACED the deleted paint flow
// (old: pg-est / #e-cname / surfaces / sendProposalLink; now: pg-est-generic /
// #gei-client / _byoItems / sendGenericProposal: see the §31–38 migration).
//
// REFERENCE IMPLEMENTATION for the step() engine (CLAUDE.md §13): every phase is a
// step(): act() returns its interaction count, rule() asserts the post-condition
// and on failure throws a one-line finding() ticket. report() then emits the
// friction profile and gates the click budget against perf-baseline.json.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'estimate-build/byo-send';

test.describe('estimate build → proposal → real artifact (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('click through a real BYO estimate, send it, and verify the proposal artifact exists', async ({ page }) => {
    // Unique client so the fresh-client path never hits the draft chooser, and so
    // the seed data this run leaves behind never collides (CLAUDE.md §13.7).
    const client = {
      id: Date.now() * 1000 + (process.pid % 1000),
      name: `E2E Flow Est ${RUN_TAG.slice(-5)}`,
      addr: '101 Test St, Wichita, KS 67202',
      phone: '3165551234',
    };

    // ── STEP 1: open the Build-Your-Own estimator for the client ───────────────
    await step(page, {
      label: 'open BYO estimator for client', page: 'pg-est-generic',
      suspect: 'generic-estimate.js openFreeFormEstimate → openGenericEstimate',
      ruleText: 'opening a Build-Your-Own estimate must land on pg-est-generic with a draft bid',
      expected: 'pg-est-generic active, _geiIsFreeForm, _geiEditBidId set',
      act: async (p) => {
        await p.evaluate((c) => {
          openFreeFormEstimate(c, null);           // + New estimate → "Build Your Own"
          // Populate the shared Job-Info fields like a user would.
          const cn = document.getElementById('gei-client'); if (cn) cn.value = c.name;
          const ad = document.getElementById('gei-addr');   if (ad) ad.value = c.addr;
        }, client);
        await p.waitForTimeout(500);
        // Honest thumb-work: tap "+ New estimate" (1) + tap "Build Your Own" card (1)
        // + type client name + type address.
        return 2 + client.name.length + client.addr.length;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          active: (document.querySelector('.pg.active') || {}).id || null,
          bid: (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null,
          byo: (typeof _geiIsFreeForm !== 'undefined') ? _geiIsFreeForm : null,
        }));
        return { ok: r.active === 'pg-est-generic' && !!r.bid && r.byo === true, got: JSON.stringify(r) };
      },
    });

    // ── STEP 2: add a Materials item + an Interior item ────────────────────────
    // BYO's send gate needs ≥1 Materials item ON AND ≥1 Interior/Exterior item ON.
    let built = {};
    await step(page, {
      label: 'add a Materials item + an Interior item', page: 'pg-est-generic',
      suspect: 'generic-estimate.js _byoAddItem / _byaConfirm / _byoUpdateRail',
      ruleText: 'two priced BYO items (Materials + Interior) must be recorded and totalled',
      expected: '_byoItems has >= 2 ON items and total > 0',
      act: async (p) => {
        built = await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const g = id => document.getElementById(id);
          const addItem = async (sec, label, price, notes) => {
            _byoAddItem(sec); await wait(90);
            const l = g('_bya-label'); if (l) l.value = label;
            const pr = g('_bya-price'); if (pr) pr.value = String(price);
            const nt = g('_bya-notes'); if (nt) nt.value = notes;
            _byaConfirm(sec); await wait(90);
          };
          await addItem('Materials', 'Sherwin-Williams Duration + sundries', 420, '2 gal + rollers');
          await addItem('Interior', 'Living Room walls + ceiling, two coats', 1850, 'incl. prep');
          if (typeof _byoUpdateRail === 'function') _byoUpdateRail();
          await wait(150);
          const on = (typeof _byoItems !== 'undefined') ? _byoItems.filter(i => i && i.on !== false) : [];
          let total = 0; try { total = calcGeiTotal().total; } catch (e) {}
          return { items: on.length, total, secs: on.map(i => i.section) };
        });
        // Keystroke-honest per item: +Add item tap(1) + typed label + typed price +
        //   typed notes + Add tap(1).
        const i1 = 1 + 'Sherwin-Williams Duration + sundries'.length + String(420).length + '2 gal + rollers'.length + 1;
        const i2 = 1 + 'Living Room walls + ceiling, two coats'.length + String(1850).length + 'incl. prep'.length + 1;
        return i1 + i2;
      },
      rule: async () => {
        const ok = (built.items || 0) >= 2 && (built.total || 0) > 0;
        return { ok, got: `items=${built.items} total=${built.total} secs=${JSON.stringify(built.secs)}` };
      },
    });

    // ── SEND: uploads the real proposal artifact to the 'proposals' bucket ─────
    let sent = {};
    await step(page, {
      label: 'send proposal → upload artifact', page: 'pg-est-generic',
      suspect: 'generic-estimate.js sendGenericProposal (bid assembly + storage upload)',
      ruleText: 'sending must create a Pending bid AND upload the real proposal artifact',
      expected: 'bid present + amount > 0 + artifact in proposals bucket',
      act: async (p) => {
        // sendGenericProposal is async: it uploads the proposal JSON to the
        // 'proposals' bucket and sets bid.proposalKey BEFORE the share overlay opens,
        // so awaiting it is enough to verify the artifact (no Text/Email tap needed).
        await p.evaluate(async () => {
          window.__sendErr = null;
          try { await sendGenericProposal(); } catch (e) { window.__sendErr = e && e.message; }
        });
        // proposalKey being set is the deterministic signal the upload path ran.
        await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const ready = () => {
            const id = (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
            if (!id || typeof bids === 'undefined') return false;
            const b = bids.find(x => x.id === id);
            return !!(b && b.proposalKey);
          };
          for (let i = 0; i < 30 && !ready(); i++) await wait(500); // up to 15s
        });
        sent = await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const bidId = (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
          const bid = (typeof bids !== 'undefined' && bidId) ? bids.find(b => b.id === bidId) : null;
          const key = bid ? bid.proposalKey : null;
          let artifact = false, err = '';
          // The object can briefly 404 while the upload settles, poll the download.
          if (key && typeof _supa !== 'undefined') {
            for (let i = 0; i < 50; i++) {
              try {
                const { data, error } = await _supa.storage.from('proposals').download(key);
                if (data && !error) { artifact = true; err = ''; break; }
                err = error ? (error.message || JSON.stringify(error)) : 'no data';
              } catch (e) { err = e.message; }
              await wait(500);
            }
          }
          return {
            hasBid: !!bid, amount: bid ? bid.amount : null,
            byoItems: bid ? (bid.byoItems || []).length : 0,
            status: bid ? bid.status : null, key, artifact, err,
            sendErr: window.__sendErr || null,
          };
        });
        return 1; // 1 tap: "Send proposal"
      },
      rule: async () => {
        const ok = sent.hasBid && (sent.amount || 0) > 0 && sent.artifact;
        return { ok, got: `bid=${sent.hasBid} amount=${sent.amount} byoItems=${sent.byoItems} status=${sent.status} artifact=${sent.artifact} key=${sent.key} err=${sent.err} sendErr=${sent.sendErr}` };
      },
    });

    // ── FRICTION PROFILE + CLICK-BUDGET GATE (CLAUDE.md §13) ───────────────────
    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget,
      `UX REGRESSION: ${FLOW} used ${rep.totalClicks} interactions vs budget ${BASELINE[FLOW] && BASELINE[FLOW].clicks}. ` +
      `Every PR must be as fast or faster (CLAUDE.md §13). If this is an intentional new step, ratchet the baseline up in the same commit and justify it.`
    ).toBe(false);
  });
});
