// REAL flow — build a detailed paint estimate by driving the actual estimator UI
// (no seeding), price it, build + SEND the proposal, and verify the real proposal
// artifact lands in Supabase storage (the thing that was 404-ing as "Proposal not
// found"). The sent bid must carry the surfaces it was built from — not be hollow.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, finding, RUN_TAG } = require('./live-helpers');

test.describe('estimate build → proposal → real artifact (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('click through a real estimate, send it, and verify the proposal artifact exists', async ({ page }) => {
    // Name with the E2E/ prefix so the scenario sweep can clear it later.
    const client = `E2E Flow Est ${RUN_TAG.slice(-5)}`;

    // ── STEP 1: client info ────────────────────────────────────────────────
    await page.evaluate(() => window.goPg('pg-est'));
    await page.waitForSelector('#e-cname', { timeout: 20000 });
    await page.fill('#e-cname', client);
    await page.fill('#e-cphone', '3165551234');
    await page.fill('#e-caddr', '101 Test St, Wichita, KS 67202');
    await page.waitForTimeout(300);
    await page.evaluate(() => { try { validateAndGoStep2(); } catch (e) {} });
    await page.waitForTimeout(600);

    // ── STEP 3A + 3B: build one measured wall surface, capturing a trace at
    // every sub-step so a failure names the exact break. ───────────────────
    await page.waitForSelector('#surf-room-name', { timeout: 12000 });
    await page.fill('#surf-room-name', 'Living Room');
    await page.waitForTimeout(250);
    const t = await page.evaluate(async () => {
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
      try { ['sand', 'prime', 'twocoat', 'cleanup'].forEach(id => toggleScopeRoom(id, 'Living Room')); } catch (e) { tr.e_scope = e.message; }
      try { goSurfScopeToMeasure(); } catch (e) { tr.e_toMeasure = e.message; }
      await wait(250);
      try { setPaintSupply('customer'); } catch (e) { tr.e_paint = e.message; }
      // saveSurfBAndNext reads isCustomer from #e-customer-paint.value==='1' to skip
      // the product/color/finish validation; set it directly so the surface saves.
      const cp = g('e-customer-paint'); if (cp) cp.value = '1';
      tr.isCustomer = cp ? cp.value : 'noel';
      tr.sqftEl = !!g('surf-b-sqft');
      const sf = g('surf-b-sqft'); if (sf) { sf.value = '480'; sf.dispatchEvent(new Event('input', { bubbles: true })); }
      await wait(150);
      try { saveSurfBAndNext(); } catch (e) { tr.e_save = e.message; }
      await wait(300);
      tr.surfCount = (typeof estSurfaces !== 'undefined') ? estSurfaces.length : -1;
      return tr;
    });
    expect(t.surfCount, finding({ page: 'pg-est 3B', control: 'build a measured wall surface', rule: 'a measured surface must be recorded', expected: '>= 1', got: 'count=' + t.surfCount + ' trace=' + JSON.stringify(t), suspect: 'estimator surf-step-a/b' })).toBeGreaterThanOrEqual(1);

    // ── STEP 3 → 4 → 5 ─────────────────────────────────────────────────────
    await page.evaluate(() => { try { goEstStep(4); } catch (e) {} });
    await page.waitForTimeout(500);
    await page.evaluate(() => { try { validateAndGoStep5(); } catch (e) { try { goEstStep(5); } catch (e2) {} } });
    await page.waitForTimeout(700);

    // Real price + rendered proposal.
    const built = await page.evaluate((cn) => {
      let final = null; try { final = calcEst().final; } catch (e) {}
      const html = (document.getElementById('est-proposal') || {}).innerHTML || '';
      return { final, hasProp: html.length > 200, propHasClient: html.includes(cn) };
    }, client);
    expect(built.final, finding({ page: 'pg-est 5', control: 'calcEst().final', rule: 'a built estimate must price greater than 0', expected: '> 0', got: String(built.final), suspect: 'paint-estimate.js calcEst' })).toBeGreaterThan(0);
    expect(built.hasProp, finding({ page: 'pg-est 5', control: '#est-proposal', rule: 'proposal HTML must render from the built estimate', expected: 'non-empty', got: 'empty', suspect: 'proposals.js buildProposal' })).toBe(true);

    // ── SEND: uploads the real proposal artifact to the 'proposals' bucket ──
    await page.evaluate(() => { try { sendProposalLink(); } catch (e) {} });
    await page.waitForTimeout(3000);

    const sent = await page.evaluate(async () => {
      const bidId = (typeof lastCreatedBidId !== 'undefined') ? lastCreatedBidId : null;
      const bid = (typeof bids !== 'undefined' && bidId) ? bids.find(b => b.id === bidId) : null;
      const key = bid ? bid.signingKey : null;
      let artifact = false, err = '';
      if (key && typeof _supa !== 'undefined') {
        try { const { data, error } = await _supa.storage.from('proposals').download(key); artifact = !!data && !error; if (error) err = error.message || JSON.stringify(error); }
        catch (e) { err = e.message; }
      }
      return { hasBid: !!bid, amount: bid ? bid.amount : null, surfaces: bid ? (bid.surfaces || []).length : 0, key, artifact, err };
    });
    expect(sent.hasBid, finding({ page: 'pg-est', control: 'sendProposalLink', rule: 'sending must create the bid', expected: 'bid exists', got: 'none', suspect: 'proposals.js sendProposalLink' })).toBe(true);
    expect(sent.surfaces, finding({ page: 'bid', control: 'bid.surfaces', rule: 'the sent bid must carry the surfaces it was built from (not hollow)', expected: '>= 1', got: String(sent.surfaces), suspect: 'sendProposalLink bid assembly' })).toBeGreaterThanOrEqual(1);
    expect(sent.artifact, finding({ page: 'storage proposals/', control: 'proposal artifact', rule: 'the real proposal JSON must exist in storage (no "Proposal not found")', expected: 'artifact present @ ' + sent.key, got: 'missing: ' + sent.err, suspect: 'sendProposalLink storage upload' })).toBe(true);
  });
});
