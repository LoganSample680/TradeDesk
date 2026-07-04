// SCALE BENCHMARKS — drive the REAL estimator at volume to expose where the app
// gives the user no leverage (CLAUDE.md §13.4). These are UX-streamline targets,
// not hard gates: each flow logs its deterministic interaction count via report()
// in CAPTURE mode. A high clicks-per-unit-of-output number is a finding to slim,
// not a CI failure. The ledger names the exact step that costs the most.
//
//   • estimate-build/interior-20room — a full 20-room interior repaint. How many
//     clicks does it cost to bid an entire house? Every added room is pure grind.
//   • estimate-build/tm              — a Time & Materials job (no template; the
//     estimator has to be told crew/rate/hours by hand).
//   • estimate-build/byo             — Build-Your-Own custom line items the
//     estimator has no idea how to price.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

test.describe('estimator scale benchmarks (UX streamline targets)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // ── 20-ROOM INTERIOR REPAINT ──────────────────────────────────────────────
  test('20-room interior repaint — measure the grind of bidding a whole house', async ({ page }) => {
    const FLOW = 'estimate-build/interior-20room';
    const client = `E2E Scale 20rm ${RUN_TAG.slice(-5)}`;
    const ROOMS = 20;

    await step(page, {
      label: 'client info → surface builder', page: 'pg-est',
      suspect: 'paint-estimate.js validateAndGoStep2',
      ruleText: 'client info must advance to the surface builder',
      expected: 'surf-room-name visible',
      act: async (p) => {
        await p.evaluate(() => window.goPg('pg-est'));
        await p.waitForSelector('#e-cname', { timeout: 20000 });
        await p.fill('#e-cname', client);                                 // name "E2E Scale 20rm XXXXX" = 20 keystrokes
        await p.fill('#e-cphone', '3165550020');                          // phone = 10 keystrokes
        await p.fill('#e-caddr', '20 Room Manor, Wichita, KS 67202');     // addr = 32 keystrokes
        await p.waitForTimeout(300);
        await p.evaluate(() => { try { validateAndGoStep2(); } catch (e) {} }); // 1 tap (advance)
        await p.waitForTimeout(500);
        return 64; // goPg(1) + name(20) + phone(10) + addr(32) + validate(1) = 64
      },
      rule: async (p) => {
        const ok = await p.locator('#surf-room-name').count().then(c => c > 0).catch(() => false);
        return { ok, got: ok ? 'visible' : 'missing' };
      },
    });

    // Build all 20 rooms inside one instrumented step. Each room is the SAME
    // grind: name → walls → scope×3 → measure → customer-paint → sqft → save →
    // addAnotherRoom. The returned count is the honest friction number at KEYSTROKE
    // granularity: every typed char (room name + the two dimensions) counts as 1,
    // every tap as 1. Per-room ≈ 8 taps + name(6–7) + len(2) + wid(2). Totals:
    //   taps   = setSurfJobType(1) + addAnotherRoom×19 + 20×8 = 180
    //   typed  = room names(131) + dims(20×4 = 80) = 211
    //   GRAND TOTAL = 391 (this is the grind of bidding a whole house, the point).
    let buildRes = {};
    await step(page, {
      label: `build ${ROOMS} measured rooms`, page: 'pg-est 3',
      suspect: 'paint-estimate.js surf-step-a/b + addAnotherRoom',
      ruleText: `all ${ROOMS} rooms must be recorded as measured surfaces`,
      expected: `estSurfaces.length >= ${ROOMS}`,
      act: async (p) => {
        buildRes = await p.evaluate(async (ROOMS) => {
          const g = id => document.getElementById(id);
          const wait = ms => new Promise(r => setTimeout(r, ms));
          let clicks = 0;
          // Job type is picked once (the estimator keeps it across rooms). +1 tap.
          try { setSurfJobType('interior'); clicks++; } catch (e) { return { err: 'setSurfJobType: ' + e.message, clicks }; }
          await wait(150);
          for (let i = 1; i <= ROOMS; i++) {
            const room = 'Room ' + i;
            // addAnotherRoom() resets surfRoom/surfWhatSelected/surfBQueue and clears
            // the room-name field — so every room after the first re-enters everything.
            if (i > 1) { try { addAnotherRoom(); clicks++; } catch (e) { return { err: 'addAnotherRoom@' + i + ': ' + e.message, clicks, count: estSurfaces.length }; } await wait(80); }
            const nm = g('surf-room-name'); if (nm) { nm.value = room; try { if (typeof onSurfRoomName === 'function') onSurfRoomName(nm); } catch (e) {} } clicks += room.length; // type room name char-by-char ("Room 1"=6 .. "Room 20"=7)
            const wb = g('swhat-walls'); if (wb) wb.click(); clicks++; // tap "walls"
            await wait(60);
            try { goSurfStepB(); } catch (e) { return { err: 'goSurfStepB@' + i + ': ' + e.message, clicks, count: estSurfaces.length }; } clicks++; // "Next"
            await wait(80);
            try { ['sand', 'prime', 'twocoat'].forEach(s => { toggleScopeRoom(s, room); clicks++; }); } catch (e) {} // 3 scope taps
            // Customer paint BEFORE goSurfScopeToMeasure so the measure step hides the
            // product/color picker (e-customer-paint==='1').
            try { setPaintSupply('customer'); } catch (e) {} clicks++; // "customer paint"
            const cp = g('e-customer-paint'); if (cp) cp.value = '1';
            try { goSurfScopeToMeasure(); } catch (e) { return { err: 'goSurfScopeToMeasure@' + i + ': ' + e.message, clicks, count: estSurfaces.length }; } clicks++; // "Measure"
            await wait(60);
            // ROOT CAUSE fix (same as estimate-build): #surf-b-sqft.oninput is
            // updateWallSqft(), which ALWAYS recomputes value from len×wid
            // (paint-estimate.js:1262-1273). Poking #surf-b-sqft directly zeroed it,
            // so saveSurfBAndNext read sqft=0 and never pushed. Drive the real inputs.
            const lenEl = g('surf-b-len'); if (lenEl) { lenEl.value = '20'; lenEl.dispatchEvent(new Event('input', { bubbles: true })); } clicks += 2; // length "20" = 2 keystrokes
            const widEl = g('surf-b-wid'); if (widEl) { widEl.value = '21'; widEl.dispatchEvent(new Event('input', { bubbles: true })); } clicks += 2; // width "21" = 2 keystrokes (20×21 = 420)
            await wait(60);
            try { saveSurfBAndNext(); } catch (e) { return { err: 'saveSurfBAndNext@' + i + ': ' + e.message, clicks, count: estSurfaces.length }; } clicks++; // "Save room"
            await wait(120);
          }
          return { clicks, count: (typeof estSurfaces !== 'undefined') ? estSurfaces.length : -1 };
        }, ROOMS);
        return buildRes.clicks || 0;
      },
      rule: async () => {
        const ok = (buildRes.count || 0) >= ROOMS;
        return { ok, got: `rooms=${buildRes.count} clicks=${buildRes.clicks} err=${buildRes.err || 'none'}` };
      },
    });

    await step(page, {
      label: 'price 20-room estimate', page: 'pg-est 5',
      suspect: 'paint-estimate.js calcEst',
      ruleText: 'a 20-room estimate must price > 0',
      expected: 'final > 0',
      act: async (p) => {
        await p.evaluate(() => { try { goEstStep(4); } catch (e) {} });   // 1
        await p.waitForTimeout(400);
        await p.evaluate(() => { try { validateAndGoStep5(); } catch (e) { try { goEstStep(5); } catch (e2) {} } }); // 2
        await p.waitForTimeout(600);
        return 2;
      },
      rule: async (p) => {
        const final = await p.evaluate(() => { try { return calcEst().final; } catch (e) { return null; } });
        return { ok: final > 0, got: 'final=' + final };
      },
    });

    const rep = report(FLOW, BASELINE, page);   // capture mode — logs N clicks, not gated
    // Scale benchmarks never hard-fail on clicks (§13.4); the count is the finding.
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // ── TIME & MATERIALS (no template — pure manual entry) ─────────────────────
  test('T&M estimate — crew/rate/hours by hand, NTE cap', async ({ page }) => {
    const FLOW = 'estimate-build/tm';
    const client = { id: Date.now(), name: `E2E Scale TM ${RUN_TAG.slice(-5)}`, addr: '7 Hourly Ln, Wichita, KS 67202', phone: '3165550030' };

    let tm = {};
    await step(page, {
      label: 'open T&M + set crew/rate/hours + NTE', page: 'gei-tm',
      suspect: 'generic-estimate.js openTMEstimate / _tmRecalc / _tmCalcNte',
      ruleText: 'a T&M job must price labor from crew×rate×hours and total > 0',
      expected: 'priced total > 0',
      act: async (p) => {
        tm = await p.evaluate(async (c) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const tr = {};
          try { openTMEstimate(c, null); } catch (e) { tr.e_open = e.message; }
          await wait(300);
          try {
            // ROOT CAUSE of the old failure: _tmRecalc (generic-estimate.js:501-516)
            // reads #tm-crew-display.textContent, #tm-rate.value and #tm-hours.value —
            // the single-page T&M layout. The old test wrote to #tm-i-crew-count /
            // #tm-i-rate / #tm-i-hours (the OTHER, wizard layout wired to
            // _tmInputChange), so _tmRecalc read rate=0 hours=0 → labor=0 → no line
            // was added (the upsert only inserts when labor>0). Feed the inputs
            // _tmRecalc actually reads.
            const cc = document.getElementById('tm-crew-display'); if (cc) cc.textContent = '2';
            const rt = document.getElementById('tm-rate'); if (rt) { rt.value = '65'; rt.dispatchEvent(new Event('input', { bubbles: true })); }
            const hr = document.getElementById('tm-hours'); if (hr) { hr.value = '40'; hr.dispatchEvent(new Event('input', { bubbles: true })); }
            _tmRecalc();
          } catch (e) { tr.e_recalc = e.message; }
          await wait(120);
          try {
            const nte = document.getElementById('tm-nte-on'); if (nte) { nte.checked = true; }
            if (typeof _tmCalcNte === 'function') _tmCalcNte();
          } catch (e) { tr.e_nte = e.message; }
          // Labor line total = crew × rate × hours = 2 × 65 × 40 = 5200
          tr.lines = (typeof _geiLines !== 'undefined') ? _geiLines.length : -1;
          tr.laborTotal = (typeof _geiLines !== 'undefined' && _geiLines[0]) ? _geiLines[0].total : null;
          return tr;
        }, client);
        // Honest keystroke-granular thumb-work: open T&M (1 tap) + crew stepper
        // pick (1 tap) + type rate "65" (2 keystrokes) + type hours "40" (2
        // keystrokes) + toggle NTE cap (1 tap) = 7.
        return 7; // open(1) + crew pick(1) + rate"65"(2) + hours"40"(2) + nte toggle(1) = 7
      },
      rule: async () => {
        const ok = (tm.laborTotal || 0) > 0;
        return { ok, got: `lines=${tm.lines} laborTotal=${tm.laborTotal} ${JSON.stringify(tm)}` };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // ── BYO / CUSTOM LINE ITEMS (estimator has no template) ────────────────────
  test('BYO estimate — custom section + custom line items priced by hand', async ({ page }) => {
    const FLOW = 'estimate-build/byo';
    const client = { id: Date.now() + 1, name: `E2E Scale BYO ${RUN_TAG.slice(-5)}`, addr: '9 Custom Ct, Wichita, KS 67202', phone: '3165550040' };

    let byo = {};
    await step(page, {
      label: 'open BYO + add custom section + 2 custom items', page: 'gei-byo',
      suspect: 'generic-estimate.js openFreeFormEstimate / _byoAddItem / _byaConfirm / _byoUpdateRail',
      ruleText: 'custom line items must be recorded and totalled',
      expected: '_byoItems has the added items and total > 0',
      act: async (p) => {
        byo = await p.evaluate(async (c) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const tr = {};
          try { openFreeFormEstimate(c, null); } catch (e) { tr.e_open = e.message; }
          await wait(300);
          // Add a custom section the estimator has no template for.
          try {
            if (typeof _byoAddSection === 'function') {
              _byoAddSection();
              await wait(80);
              const sn = document.getElementById('_byo-sec-name'); if (sn) sn.value = 'Drywall Repair';
              if (typeof _byoConfirmSection === 'function') _byoConfirmSection();
            }
          } catch (e) { tr.e_section = e.message; }
          await wait(120);
          // Add two custom priced line items.
          const addItem = async (label, price, notes) => {
            try {
              _byoAddItem('Drywall Repair');
              await wait(80);
              const l = document.getElementById('_bya-label'); if (l) l.value = label;
              const pr = document.getElementById('_bya-price'); if (pr) pr.value = String(price);
              const nt = document.getElementById('_bya-notes'); if (nt) nt.value = notes;
              if (typeof _byaConfirm === 'function') _byaConfirm('Drywall Repair');
              await wait(80);
            } catch (e) { tr.e_item = (tr.e_item || '') + ' ' + e.message; }
          };
          await addItem('Fill 12 holes & sand smooth', 250, 'interior walls');
          await addItem('Prime & paint patch areas', 150, 'match sheen');
          try { if (typeof _byoUpdateRail === 'function') _byoUpdateRail(); } catch (e) { tr.e_rail = e.message; }
          await wait(80);
          tr.items = (typeof _byoItems !== 'undefined') ? _byoItems.filter(i => i && i.on !== false).length : -1;
          tr.priced = (typeof _byoItems !== 'undefined') ? _byoItems.reduce((s, i) => s + (Number(i && i.price) || 0), 0) : 0;
          return tr;
        }, client);
        // Keystroke-granular: open(1 tap) + addSection(1 tap) + type section name
        // "Drywall Repair"(14) + two custom items. Each item = addItem(1 tap) +
        // typed label + typed price + typed notes + confirm(1 tap):
        //   item1: 1 + "Fill 12 holes & sand smooth"(27) + "250"(3) + "interior walls"(14) + 1 = 46
        //   item2: 1 + "Prime & paint patch areas"(25) + "150"(3) + "match sheen"(11) + 1 = 41
        return 1 + 1 + 14 + 46 + 41; // = 103 (open + addSection + secName(14) + item1(46) + item2(41))
      },
      rule: async () => {
        const ok = (byo.items || 0) >= 2 && (byo.priced || 0) > 0;
        return { ok, got: `items=${byo.items} priced=${byo.priced} ${JSON.stringify(byo)}` };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
