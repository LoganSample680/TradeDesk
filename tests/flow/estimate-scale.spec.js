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
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

test.describe('estimator scale benchmarks (UX streamline targets)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // ── 20-ITEM CUSTOM BID (Build-Your-Own at volume) ─────────────────────────
  // The paint "20-room interior repaint" grind benchmark went away with the paint
  // estimator; the current volume grind is a big custom bid where the estimator has
  // no template — every line item is typed by hand. Same intent (§13.4): count the
  // clicks it costs to bid a big job, so the ledger names the streamline target.
  test('20-item custom bid — measure the grind of a big Build-Your-Own estimate', async ({ page }) => {
    const FLOW = 'estimate-build/byo-20item';
    const client = { id: Date.now(), name: `E2E Scale BYO20 ${RUN_TAG.slice(-5)}`, addr: '20 Custom Manor, Wichita, KS 67202', phone: '3165550020' };
    const N = 20;

    let buildRes = {};
    await step(page, {
      label: `open BYO + add ${N} custom line items`, page: 'pg-est-generic',
      suspect: 'generic-estimate.js openFreeFormEstimate / _byoAddItem / _byaConfirm',
      ruleText: `all ${N} custom items must be recorded as priced BYO line items`,
      expected: `_byoItems has >= ${N} ON items and total > 0`,
      act: async (p) => {
        buildRes = await p.evaluate(async ({ N, client }) => {
          const g = id => document.getElementById(id);
          const wait = ms => new Promise(r => setTimeout(r, ms));
          let clicks = 0;
          try { openFreeFormEstimate(client, null); clicks++; } catch (e) { return { err: 'open: ' + e.message, clicks }; }
          await wait(400);
          // Spread items across the default sections. Each added item is pure grind:
          // +Add item tap, typed label, typed price, Add tap — the count is the point.
          const SECS = ['Interior', 'Exterior', 'Materials', 'Add-ons'];
          for (let i = 1; i <= N; i++) {
            const sec = SECS[i % SECS.length];
            const label = 'Custom line item ' + i;
            const price = 100 + i * 10;
            try { _byoAddItem(sec); clicks++; } catch (e) { return { err: '_byoAddItem@' + i + ': ' + e.message, clicks, count: (typeof _byoItems !== 'undefined' ? _byoItems.length : -1) }; }
            await wait(40);
            const l = g('_bya-label'); if (l) l.value = label; clicks += label.length;                  // type label
            const pr = g('_bya-price'); if (pr) pr.value = String(price); clicks += String(price).length; // type price
            try { _byaConfirm(sec); clicks++; } catch (e) { return { err: '_byaConfirm@' + i + ': ' + e.message, clicks, count: _byoItems.length }; }
            await wait(40);
          }
          try { if (typeof _byoUpdateRail === 'function') _byoUpdateRail(); } catch (e) {}
          await wait(100);
          let total = 0; try { total = calcGeiTotal().total; } catch (e) {}
          return { clicks, count: (typeof _byoItems !== 'undefined') ? _byoItems.filter(i => i && i.on !== false).length : -1, total, err: null };
        }, { N, client });
        return buildRes.clicks || 0;
      },
      rule: async () => {
        const ok = (buildRes.count || 0) >= N && (buildRes.total || 0) > 0;
        return { ok, got: `items=${buildRes.count} clicks=${buildRes.clicks} total=${buildRes.total} err=${buildRes.err || 'none'}` };
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
