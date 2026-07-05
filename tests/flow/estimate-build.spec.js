// REAL flow — build a detailed paint estimate by driving the actual estimator UI
// (no seeding), price it, build + SEND the proposal, and verify the real proposal
// artifact lands in Supabase storage (the thing that was 404-ing as "Proposal not
// found"). The sent bid must carry the surfaces it was built from — not be hollow.
//
// REFERENCE IMPLEMENTATION for the step() engine (CLAUDE.md §13): every phase is a
// step() — act() returns its interaction count, rule() asserts the post-condition
// and on failure throws a one-line finding() ticket. report() then emits the
// friction profile and gates the click budget against perf-baseline.json.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'estimate-build/interior-1room';

test.describe('estimate build → proposal → real artifact (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('click through a real estimate, send it, and verify the proposal artifact exists', async ({ page }) => {
    // Name with the E2E/ prefix so the scenario sweep can clear it later.
    const client = `E2E Flow Est ${RUN_TAG.slice(-5)}`;

    // ── STEP 1: client info ────────────────────────────────────────────────
    await step(page, {
      label: 'client info → step 2', page: 'pg-est',
      suspect: 'paint-estimate.js validateAndGoStep2',
      ruleText: 'entering client info must advance to the surface builder',
      expected: 'surf-room-name visible',
      act: async (p) => {
        await p.evaluate(() => window.goPg('pg-est'));
        await p.waitForSelector('#e-cname', { timeout: 20000 });
        await p.fill('#e-cname', client);          // keystrokes: client.length
        await p.fill('#e-cphone', '3165551234');   // keystrokes: 10
        await p.fill('#e-caddr', '101 Test St, Wichita, KS 67202'); // keystrokes: 30
        await p.waitForTimeout(300);
        await p.evaluate(() => { try { validateAndGoStep2(); } catch (e) {} }); // 1 tap: "Next"
        await p.waitForTimeout(600);
        // Keystroke-honest: name(client.length) + phone(10) + addr(30) + 1 tap (Next)
        // client = "E2E Flow Est " (13) + RUN_TAG.slice(-5) (5) = 18 → 18+10+30+1 = 59
        return client.length + 10 + 30 + 1;
      },
      rule: async (p) => {
        const ok = await p.locator('#surf-room-name').count().then(c => c > 0).catch(() => false);
        return { ok, got: ok ? 'visible' : 'missing' };
      },
    });

    // ── STEP 3A + 3B: build one measured wall surface. The act captures a trace
    // at every sub-step so a rule failure names the exact break. ────────────
    let trace = {};
    await step(page, {
      label: 'build a measured wall surface', page: 'pg-est 3B',
      suspect: 'estimator surf-step-a/b (paint-estimate.js saveSurfBAndNext)',
      ruleText: 'a measured surface must be recorded',
      expected: 'estSurfaces.length >= 1',
      act: async (p) => {
        await p.waitForSelector('#surf-room-name', { timeout: 12000 });
        await p.fill('#surf-room-name', 'Living Room');
        await p.waitForTimeout(250);
        trace = await p.evaluate(async () => {
          const tr = {}; const g = id => document.getElementById(id);
          const wait = ms => new Promise(r => setTimeout(r, ms));
          tr.surfRoom0 = (typeof surfRoom !== 'undefined') ? surfRoom : 'undef';
          try { setSurfJobType('interior'); } catch (e) { tr.e_jobType = e.message; }
          await wait(250);
          tr.swhatWalls = !!g('swhat-walls');
          const wb = g('swhat-walls'); if (wb) wb.click();
          await wait(150);
          tr.surfWhat = (typeof surfWhatSelected !== 'undefined') ? JSON.stringify(surfWhatSelected) : 'undef';
          try { goSurfStepB(); } catch (e) { tr.e_stepB = e.message; }
          await wait(400);
          tr.stepBDisp = g('surf-step-b') ? g('surf-step-b').style.display : 'noel';
          tr.queue = (typeof surfBQueue !== 'undefined') ? JSON.stringify(surfBQueue) : 'undef';
          try { ['sand', 'prime', 'twocoat', 'cleanup'].forEach(id => toggleScopeRoom(id, 'Living Room')); } catch (e) { tr.e_scope = e.message; }
          // Customer-supplied paint: setPaintSupply('customer') BEFORE goSurfScopeToMeasure
          // so e-customer-paint==='1' and the measure step skips the product/color picker.
          try { setPaintSupply('customer'); } catch (e) { tr.e_paint = e.message; }
          const cp = g('e-customer-paint'); if (cp) cp.value = '1';
          tr.isCustomer = cp ? cp.value : 'noel';
          // goSurfScopeToMeasure() runs renderSurfBCurrent(), which (re)builds the
          // walls dims and the hidden #surf-b-sqft input — so it must come BEFORE we
          // enter measurements, or the render wipes them.
          try { goSurfScopeToMeasure(); } catch (e) { tr.e_toMeasure = e.message; }
          await wait(250);
          tr.surfType = (typeof surfBQueue !== 'undefined') ? surfBQueue[(typeof surfBIdx !== 'undefined') ? surfBIdx : 0] : 'undef';
          // ROOT CAUSE of the old failure: for walls, #surf-b-sqft.oninput is
          // updateWallSqft(), which IGNORES its arg and ALWAYS recomputes value from
          // #surf-b-len × #surf-b-wid (paint-estimate.js:1262-1273). Poking #surf-b-sqft
          // directly + dispatching 'input' therefore zeroed it (len=wid=0 → ''),
          // so saveSurfBAndNext read sqft=0 and bailed. Drive the REAL inputs instead:
          // fill len & wid and let updateWallSqft compute the sqft.
          tr.lenEl = !!g('surf-b-len'); tr.widEl = !!g('surf-b-wid');
          const lenEl = g('surf-b-len'); if (lenEl) { lenEl.value = '20'; lenEl.dispatchEvent(new Event('input', { bubbles: true })); }
          const widEl = g('surf-b-wid'); if (widEl) { widEl.value = '24'; widEl.dispatchEvent(new Event('input', { bubbles: true })); }
          await wait(150);
          tr.sqftEl = !!g('surf-b-sqft');
          tr.sqftVal = g('surf-b-sqft') ? g('surf-b-sqft').value : 'noel'; // 20×24 = 480
          try { saveSurfBAndNext(); } catch (e) { tr.e_save = e.message; }
          await wait(300);
          tr.surfCount = (typeof estSurfaces !== 'undefined') ? estSurfaces.length : -1;
          return tr;
        });
        // Keystroke-honest user thumb-work for ONE measured wall surface:
        //   room name "Living Room" (11 keystrokes) + interior job type tap (1) +
        //   tap "walls" (1) + scope toggles sand/prime/twocoat/cleanup (4 taps) +
        //   "customer paint" tap (1) + length "20" (2 keystrokes) +
        //   width "24" (2 keystrokes) + "Save room" tap (1)
        //   = 11 + 1 + 1 + 4 + 1 + 2 + 2 + 1 = 23
        return 23;
      },
      rule: async () => {
        const ok = (trace.surfCount || 0) >= 1;
        return { ok, got: 'count=' + trace.surfCount + ' trace=' + JSON.stringify(trace) };
      },
    });

    // ── STEP 3 → 4 → 5: price the estimate and render the proposal ──────────
    let built = {};
    await step(page, {
      label: 'price estimate + render proposal', page: 'pg-est 5',
      suspect: 'paint-estimate.js calcEst / proposals.js buildProposal',
      ruleText: 'a built estimate must price > 0 AND render proposal HTML',
      expected: 'final > 0 and proposal non-empty',
      act: async (p) => {
        await p.evaluate(() => { try { goEstStep(4); } catch (e) {} });        // 1 tap: advance to step 4
        await p.waitForTimeout(500);
        // ROOT CAUSE of the old hasProp=false: step 4 carries a REQUIRED
        // "Est. days to complete" field (#e-days, index.html:1781). validateAndGoStep5()
        // hard-gates on it (proposals.js:1762-1767) — when #e-days is empty it pops a
        // zAlert and RETURNS (it does NOT throw), so the test's catch-fallback to
        // goEstStep(5) never fired and buildProposal() (which renders #est-proposal in
        // goEstStep's n===5 branch, proposals.js:1818) was never reached. Fill #e-days
        // like a real user before advancing, so validateAndGoStep5 passes its guard and
        // renders the proposal.
        await p.fill('#e-days', '2');                                          // keystrokes: 1
        await p.evaluate(() => { try { validateAndGoStep5(); } catch (e) { try { goEstStep(5); } catch (e2) {} } }); // 1 tap: advance to step 5
        await p.waitForTimeout(700);
        built = await p.evaluate((cn) => {
          let final = null; try { final = calcEst().final; } catch (e) {}
          const html = (document.getElementById('est-proposal') || {}).innerHTML || '';
          return { final, hasProp: html.length > 200, propHasClient: html.includes(cn) };
        }, client);
        // Keystroke-honest: advance-to-4 tap (1) + days "2" (1 keystroke) +
        //   advance-to-5 tap (1) = 3
        return 3;
      },
      rule: async () => {
        const ok = (built.final > 0) && built.hasProp;
        return { ok, got: 'final=' + built.final + ' hasProp=' + built.hasProp };
      },
    });

    // ── SEND: uploads the real proposal artifact to the 'proposals' bucket ──
    let sent = {};
    await step(page, {
      label: 'send proposal → upload artifact', page: 'pg-est',
      suspect: 'proposals.js sendProposalLink (bid assembly + storage upload)',
      ruleText: 'sending must create a bid carrying its surfaces AND upload the real proposal artifact',
      expected: 'bid + surfaces>=1 + artifact present',
      act: async (p) => {
        await p.evaluate(() => { try { sendProposalLink(); } catch (e) {} }); // 1
        // WEBKIT FIX: sendProposalLink (proposals.js:545) is async — it creates the bid
        // and sets lastCreatedBidId SYNCHRONOUSLY (proposals.js:617), but bid.signingKey
        // is only set AFTER `await shortenUrl()` (proposals.js:683/691), and the storage
        // upload to the 'proposals' bucket only finishes after the awaited Promise.all
        // (proposals.js:694-697). The old fixed 3000ms wait wasn't enough on webkit
        // (slower async/network), so lastCreatedBidId/signingKey weren't ready → bid=false.
        // Poll up to ~15s (500ms steps) until the bid exists AND its signingKey is set —
        // signingKey being present is the deterministic signal that the upload path ran.
        await p.evaluate(async () => {
          const ready = () => {
            const id = (typeof lastCreatedBidId !== 'undefined') ? lastCreatedBidId : null;
            if (!id || typeof bids === 'undefined') return false;
            const b = bids.find(x => x.id === id);
            return !!(b && b.signingKey);
          };
          const wait = ms => new Promise(r => setTimeout(r, ms));
          for (let i = 0; i < 30 && !ready(); i++) { await wait(500); } // up to 15s
        });
        sent = await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const bidId = (typeof lastCreatedBidId !== 'undefined') ? lastCreatedBidId : null;
          const bid = (typeof bids !== 'undefined' && bidId) ? bids.find(b => b.id === bidId) : null;
          const key = bid ? bid.signingKey : null;
          let artifact = false, err = '';
          // ROOT CAUSE of the alternating-browser flake: signingKey is set BEFORE the
          // storage upload Promise.all resolves (proposals.js:683 vs :694-697), and
          // sendProposalLink is fired un-awaited — so the object briefly 404s
          // ("Object not found"). A single download raced the upload. POLL the
          // download until the object actually lands (~25s bound; normally 1-3s).
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
          return { hasBid: !!bid, amount: bid ? bid.amount : null, surfaces: bid ? (bid.surfaces || []).length : 0, key, artifact, err };
        });
        return 1; // 1 tap: "Send to client"
      },
      rule: async () => {
        const ok = sent.hasBid && sent.surfaces >= 1 && sent.artifact;
        return { ok, got: `bid=${sent.hasBid} surfaces=${sent.surfaces} artifact=${sent.artifact} key=${sent.key} err=${sent.err}` };
      },
    });

    // ── FRICTION PROFILE + CLICK-BUDGET GATE (CLAUDE.md §13) ────────────────
    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget,
      `UX REGRESSION: ${FLOW} used ${rep.totalClicks} interactions vs budget ${BASELINE[FLOW] && BASELINE[FLOW].clicks}. ` +
      `Every PR must be as fast or faster (CLAUDE.md §13). If this is an intentional new step, ratchet the baseline up in the same commit and justify it.`
    ).toBe(false);
  });
});
