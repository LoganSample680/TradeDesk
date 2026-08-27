// REAL flow, drives TrueBid (the flagship proposal-type picker) → TrueMeasure
// (the aerial map-trace tool, works on any phone, no LiDAR needed) against the
// ACTUAL deployed app and REAL Supabase. Opens a real client record, taps the
// TrueBid card, traces a shape on the REAL MapKit map, confirms the measured
// line, and proves it lands in the Build-Your-Own estimate builder as a real,
// visible line item.
//
// This spec exists to guard TWO specific production bugs found and fixed this
// session in the seed-to-estimate hand-off (_geiPendingSeedLines,
// js/generic-estimate.js openGenericEstimate):
//
//   BUG 1 — openGenericEstimate's resume-existing-draft lookup used to run
//   AFTER the seed was applied, so resuming an old/abandoned draft silently
//   overwrote a just-confirmed TrueMeasure line. The fix moved seed-application
//   to run AFTER the resume lookup settles. To actually exercise the bug, this
//   spec first creates and abandons an empty BYO draft for the client (Step 1),
//   so the LATER TrueMeasure hand-off genuinely hits the resume path (proven by
//   asserting the resumed bid id equals the original stub's id), not a fresh
//   empty draft that would never have exercised the ordering bug at all.
//
//   BUG 2 — BYO mode's actual rendering (_byoShowPage) reads items off
//   `byoItems` on the BID RECORD, never `_geiLines` directly. A seed that only
//   updated the in-memory `_geiLines` was invisible the instant a contractor
//   opened a real BYO estimate. This spec asserts the line exists in
//   bid.byoItems (not just _geiLines) AND is actually painted into the
//   #byo-sections DOM, not just present in memory.
//
// Offline-mocked coverage of both already exists (tests/e2e-true-measure.spec.js);
// this is the live counterpart CLAUDE.md §12.8 requires: an offline mock can
// accidentally mock away the exact interaction that broke in production.
//
// REAL-CONSTRAINT WORTH KNOWING: MapKit JS is domain-locked
// (_mapkitAuthorizedOrigin, js/mileage.js) to tradedeskpro.app and *.pages.dev
// only. The self-hosted local runner (flow-tests-selfhosted.yml) serves the app
// from http://localhost:8788 — NOT an authorized origin — so running this spec
// there will legitimately hit the "aerial map isn't available here" fallback,
// not the real map. Step 2 below asserts the REAL MapKit instance loaded
// specifically so that gap is a loud, named failure instead of a silent
// work-around. To get real map coverage, run this against the cloud
// flow-tests.yml preview (a real *.pages.dev branch deploy) or against
// production (the config's default baseURL, tradedeskpro.app).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger, tap, type } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'truebid/truemeasure-to-byo';

// A real physical tap at a SPECIFIC point inside an element (not its center):
// tracing a shape needs distinct points, which the shared tap(sel) helper (always
// clicks dead center) can't produce. This is still a genuine mouse/touch gesture
// at real screen coordinates, never a page.evaluate shortcut. Local to this spec
// (not added to live-helpers.js) since no other flow needs point-in-element taps
// (CLAUDE.md §10.3: don't touch shared infra for a single spec's need).
async function tapMapPoint(page, dxFrac, dyFrac) {
  const box = await page.locator('#tm-map').boundingBox();
  if (!box) throw new Error('tapMapPoint: #tm-map not visible');
  const x = box.x + box.width * dxFrac;
  const y = box.y + box.height * dyFrac;
  await page.mouse.click(x, y);
  return 1;
}

test.describe('TrueBid → TrueMeasure → BYO estimate (UI-driven, real map)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('trace a real shape on the map and land it as a real BYO line item', async ({ page }) => {
    // Unique client so reruns never collide (CLAUDE.md §12.7): seed data is left
    // in the dev account on purpose for the owner to poke at, never torn down.
    const client = {
      id: Date.now() * 1000 + (process.pid % 1000),
      name: `TrueBid E2E ${RUN_TAG.slice(-6)}`,
      addr: '4200 E Kellogg Dr, Wichita, KS 67218',
    };
    let stubBidId = null;

    // Pure fixture creation, not a user-facing action of the feature under test
    // (equivalent to signIn/resetLedger's exemption, CLAUDE.md §12.1): a real
    // contractor already HAS the client record by this point, they don't type
    // it in as part of the TrueBid flow. Every established flow spec seeds
    // clients this same way (see tests/flow/live-helpers.js seedProposal and
    // every clients.push(...) call across tests/flow/*.spec.js).
    await page.evaluate((c) => {
      clients.push({ id: c.id, name: c.name, addr: c.addr, phone: '3165550188', source: 'Referral' });
      if (typeof saveAll === 'function') saveAll();
    }, client);

    // ── STEP 1: open the client, start a BYO estimate and abandon it EMPTY (the
    // exact precondition bug 1 needs), then re-enter via the TrueBid card and
    // land on TrueMeasure (this device/CI has no LiDAR, so the picker auto-skips
    // straight to the one capable tool). ──────────────────────────────────────
    await step(page, {
      label: 'open client → abandon an empty BYO draft → TrueBid → TrueMeasure',
      page: 'pg-client-detail',
      suspect: 'js/clients.js openEstimateForClient/_pickEstStyle + js/true-measure.js _tmOpenTrueSuite',
      ruleText: 'tapping TrueBid must auto-launch TrueMeasure (no LiDAR here) with a real, EMPTY BYO draft already on record for this client, the exact precondition the seed-overwrite regression needs',
      expected: 'a Draft/isFreeForm bid exists with 0 geiLines/byoItems, and the TrueMeasure overlay is open for this client',
      act: async (p) => {
        let n = 0;
        // Open the client record: 1 tap, matching the established convention in
        // tests/flow/payments-liens-flow.spec.js for "open client record" on a
        // just-seeded client not yet visible in any rendered list.
        await p.evaluate((cid) => { if (typeof openClientDetail === 'function') openClientDetail(cid); }, client.id);
        n += 1;
        n += await tap(p, '#cd-estimate-actions button');                       // "New proposal"
        n += await tap(p, `button[onclick="_pickEstStyle('freeform')"]`);       // "Build Your Own" card
        n += await tap(p, '#gei-old-tbar button[onclick="_geiToStylePicker()"]'); // "← Pick a different type" (abandon, empty)
        n += await tap(p, `button[onclick="_pickEstStyle('truebid')"]`);        // "TrueBid" card, the flagship
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((cid) => {
          const b = (typeof bids !== 'undefined' ? bids : []).find(x => x.client_id === cid && x.isFreeForm === true && x.status === 'Draft');
          return {
            found: !!b, id: b ? b.id : null,
            geiLen: b ? (b.geiLines || []).length : -1,
            byoLen: b ? (b.byoItems || []).length : -1,
            tmOpenForClient: !!(typeof _tmState !== 'undefined' && _tmState && _tmState.c && _tmState.c.id === cid),
            tmOvVisible: !!document.getElementById('_tm-ov'),
          };
        }, client.id);
        stubBidId = r.id;
        const ok = r.found && r.geiLen === 0 && r.byoLen === 0 && r.tmOpenForClient && r.tmOvVisible;
        return { ok, got: JSON.stringify(r) };
      },
    });

    // ── STEP 2: the aerial map must be the REAL MapKit instance, not the
    // domain-lock fallback. This is its own step so a red run here reads as a
    // named, specific finding, not a confusing "0 points traced" failure two
    // steps later. ──────────────────────────────────────────────────────────
    await step(page, {
      label: 'aerial map loads the real MapKit instance (not the fallback)',
      page: 'truemeasure',
      suspect: 'js/true-measure.js _tmInitMap — MapKit is domain-locked to tradedeskpro.app / *.pages.dev, see the file header of this spec',
      ruleText: 'the aerial map must render the real satellite MapKit view on this deployed origin, never the "isn\'t available here" fallback',
      expected: '_tmState.map is truthy, #tm-unavailable is not shown',
      act: async (p) => {
        await p.waitForFunction(() => {
          const fb = document.getElementById('tm-unavailable');
          const fallbackShown = !!fb && getComputedStyle(fb).display !== 'none';
          return (typeof _tmState !== 'undefined' && _tmState && _tmState.map) || fallbackShown;
        }, { timeout: 8000 }).catch(() => {});
        return 0; // pure observation, no user action
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const fb = document.getElementById('tm-unavailable');
          return {
            mapReady: !!(typeof _tmState !== 'undefined' && _tmState && _tmState.map),
            fallbackShown: !!fb && getComputedStyle(fb).display !== 'none',
            origin: location.origin,
          };
        });
        return { ok: r.mapReady && !r.fallbackShown, got: JSON.stringify(r) };
      },
    });

    // ── STEP 3: trace a real 4-point area on the map with real mouse/touch
    // taps at distinct coordinates. ─────────────────────────────────────────
    let measured = {};
    await step(page, {
      label: 'trace a 4-point area on the live map',
      page: 'truemeasure',
      suspect: 'js/true-measure.js _tmAddPoint / _tmRedraw / _tmMeasure / _tmAreaFt2',
      ruleText: 'four real taps on the map must register as traced points and produce a nonzero measured area that unlocks Add to estimate',
      expected: 'points.length === 4, measured value > 0, #tm-cta enabled',
      act: async (p) => {
        let n = 0;
        n += await tap(p, '#tm-mode-toggle .mode-btn[data-m="area"]'); // force Area mode, deterministic regardless of trade default
        n += await tapMapPoint(p, 0.40, 0.40);
        n += await tapMapPoint(p, 0.60, 0.40);
        n += await tapMapPoint(p, 0.60, 0.60);
        n += await tapMapPoint(p, 0.40, 0.60);
        await p.waitForTimeout(200);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const m = (typeof _tmMeasure === 'function') ? _tmMeasure() : { value: 0 };
          const cta = document.getElementById('tm-cta');
          return {
            points: (typeof _tmState !== 'undefined' && _tmState) ? _tmState.points.length : -1,
            value: m.value, unit: m.unit,
            ctaDisabled: cta ? cta.disabled : null,
          };
        });
        measured = r;
        return { ok: r.points === 4 && r.value > 0 && r.ctaDisabled === false, got: JSON.stringify(r) };
      },
    });

    // ── STEP 4: the confirm screen must prefill from the real trace + the
    // account's TrueMeasure rate (0 is expected/correct on a fresh account). ──
    await step(page, {
      label: 'confirm screen prefills quantity from the trace and rate from _tmRates()',
      page: 'truemeasure',
      suspect: 'js/true-measure.js _tmConfirmScreen',
      ruleText: 'the confirm screen must prefill qty from the live trace and rate from _tmRates() (0 is expected and correct when no rate is set yet, never a mismatched number)',
      expected: 'qty === traced value, rate === _tmRates() area/roof rate for the active trade',
      act: async (p) => {
        const n = await tap(p, '#tm-cta');
        await p.waitForSelector('#_tm-confirm-ov', { state: 'visible', timeout: 8000 });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const qty = document.getElementById('tm-c-qty')?.value;
          const rate = document.getElementById('tm-c-rate')?.value;
          const desc = document.getElementById('tm-c-desc')?.value;
          const rates = (typeof _tmRates === 'function') ? _tmRates() : {};
          const trade = (typeof getActiveTrade === 'function') ? getActiveTrade() : '';
          const m = (typeof _tmMeasure === 'function') ? _tmMeasure() : {};
          const expectedRate = trade === 'roofing' ? (rates.roofSquare || 0) : (rates.areaSqFt || 0);
          return { qty, rate, desc, expectedQty: m.value, expectedRate };
        });
        const ok = Number(r.qty) === Number(r.expectedQty) && Number(r.rate) === Number(r.expectedRate) && !!r.desc;
        return { ok, got: JSON.stringify(r) };
      },
    });

    // ── STEP 5: confirm the measurement → Add to estimate. This is the exact
    // hand-off both production bugs lived in: proves the resumed bid is the
    // SAME id as the abandoned stub (bug 1: seed survives resume, not just a
    // fresh empty draft that would never exercise the ordering bug), AND that
    // the line is in bid.byoItems (bug 2: what BYO rendering actually reads,
    // not just _geiLines) AND genuinely painted into the DOM. ────────────────
    const DESC = 'TrueBid QA test area';
    await step(page, {
      label: 'type a description, add to estimate → real line lands in the BYO builder',
      page: 'pg-est-generic',
      suspect: 'js/true-measure.js _tmAddToEstimate + js/generic-estimate.js openGenericEstimate seed-consumption block + _byoShowPage',
      ruleText: 'the confirmed measurement must survive the resume-existing-draft lookup (bug 1) AND land in byoItems on the bid record so it is actually visible in BYO mode (bug 2), not just sit in _geiLines',
      expected: 'pg-est-generic active, resumed bid id === the abandoned stub id, _geiLines + bid.byoItems + the #byo-sections DOM all carry the line',
      act: async (p) => {
        let n = 0;
        n += await type(p, '#tm-c-desc', DESC);
        n += await tap(p, '#_tm-confirm-ov .btn-p');
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((desc) => {
          const active = (document.querySelector('.pg.active') || {}).id || null;
          const bidId = (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
          const bid = (typeof bids !== 'undefined' && bidId) ? bids.find(b => b.id === bidId) : null;
          const geiLine = (typeof _geiLines !== 'undefined') ? _geiLines.find(l => l.desc === desc) : null;
          const byoItem = bid ? (bid.byoItems || []).find(i => i.label === desc) : null;
          const domHas = (document.getElementById('byo-sections') || {}).innerText?.includes(desc) || false;
          return {
            active, bidId, isFreeForm: (typeof _geiIsFreeForm !== 'undefined') ? _geiIsFreeForm : null,
            hasGeiLine: !!geiLine, geiLineQty: geiLine ? geiLine.qty : null,
            hasByoItem: !!byoItem, byoItemPrice: byoItem ? byoItem.price : null, domHas,
          };
        }, DESC);
        r.stubBidId = stubBidId;
        const ok = r.active === 'pg-est-generic' && r.isFreeForm === true && r.bidId === stubBidId &&
          r.hasGeiLine && r.hasByoItem && r.domHas;
        return { ok, got: JSON.stringify(r) };
      },
    });

    // NO cleanup: the client + BYO estimate stay in the dev account on purpose
    // (CLAUDE.md §12.7) so the owner can open the app and inspect exactly what
    // TrueBid → TrueMeasure produced.

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget,
      `UX REGRESSION: ${FLOW} used ${rep.totalClicks} interactions vs budget ${BASELINE[FLOW] && BASELINE[FLOW].clicks}. ` +
      `Every PR must be as fast or faster (CLAUDE.md §12.2). If this is an intentional new step, ratchet the baseline up in the same commit and justify it.`
    ).toBe(false);
  });
});
