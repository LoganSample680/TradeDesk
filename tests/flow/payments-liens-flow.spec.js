// REAL flow — the money-collection chain (task #5): record a deposit, log a
// refund (negative row), watch the balance recompute, then file a mechanic's
// lien. Drives the actual UI funcs (bids.js openPayPanel→logPayment,
// showCancellationRefund path via the refund pay-type, openLienPanel→saveLien)
// against a tagged throwaway bid so no real money record is mutated. Every
// assertion is a step() so a regression throws a one-line finding().
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'collect/deposit-refund-lien';

test.describe('payments, deposit, refund, lien (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('record a deposit, log a refund, balance recomputes, then file a lien', async ({ page }) => {
    const bidId = Date.now() * 1000 + Math.floor(Math.random() * 1000); // entropy: no cross-viewport collision
    const clientId = bidId + 1;
    const BASE = 5000, DEP = 1000, REF = 500;
    const today = new Date().toISOString().slice(0, 10);
    const compDate = new Date(Date.now() - 25 * 86400000).toISOString().slice(0, 10); // 25d ago → lien-eligible

    // ── Seed a closed-won bid completed 25 days ago (lien-eligible). ──
    await step(page, {
      label: 'seed a $5000 closed-won bid', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud',
      ruleText: 'the seeded bid must exist with its base amount and a full (unpaid) balance',
      expected: 'bid amount 5000, balance 5000',
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId, BASE, compDate }) => {
          clients.push({ id: clientId, name: 'E2E Collect Client', phone: '3165550500', addr: '500 Lien St, Wichita, KS 67202', _e2e: 'collect' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E Collect Client', amount: BASE, status: 'Closed Won', bid_date: new Date().toISOString().slice(0, 10), completion_date: compDate, _e2e: 'collect' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { bidId, clientId, BASE, compDate });
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          return { amount: b ? b.amount : null, bal: b ? getBidBalance(b) : null };
        }, { bidId });
        return { ok: r.amount === BASE && r.bal === BASE, got: JSON.stringify(r) };
      },
    });

    // ── Record a $1000 deposit through the real pay panel. ──
    await step(page, {
      label: 'record a $1000 deposit', page: 'pay-panel', role: 'contractor',
      suspect: 'bids.js openPayPanel/logPayment + getBidBalance',
      ruleText: 'a $1000 deposit must drop the balance to base-1000 and add a deposit payment row',
      expected: 'balance 4000, one deposit payment',
      act: async (p) => {
        // Open the pay panel asking for the deposit type. openPayPanel auto-fires
        // selectPayType for autoType 'deposit' (bids.js:929-931), which reveals
        // #mpay-detail-fields + #mpay-amount-row, so the amount field is visible.
        await p.evaluate(({ bidId }) => { openPayPanel(bidId, 'deposit'); }, { bidId });   // 1 tap (open)
        await p.waitForSelector('#mpay-amount', { state: 'visible', timeout: 8000 });
        // selectPayType pre-fills the deposit amount and makes it readOnly, so type
        // the exact amount the user wants and fill the remaining fields by hand.
        await p.evaluate(({ today, DEP }) => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.readOnly = false; el.value = v; } };
          set('mpay-amount', String(DEP));   // amount field — typed "1000" = 4 keystrokes
          set('mpay-date', today);           // date field — date picker = 1 tap
          set('mpay-method', 'Check');       // method <select> = 1 tap
          set('mpay-ref', '1001');           // check # field — typed "1001" = 4 keystrokes
        }, { today, DEP });
        // Tap "Record payment".
        await p.evaluate(() => { logPayment(); }, {});                                      // 1 tap (submit)
        await p.waitForTimeout(400);
        return 12; // open(1) + amount"1000"(4) + date pick(1) + method pick(1) + ref"1001"(4) + submit(1) = 12
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          const ps = payments.filter(x => x.bid_id === bidId);
          return { bal: b ? getBidBalance(b) : null, n: ps.length, dep: ps.filter(x => x.type === 'deposit').length };
        }, { bidId });
        return { ok: r.bal === BASE - DEP && r.dep === 1, got: JSON.stringify(r) };
      },
    });

    // ── Log a $500 refund (negative row) — balance must climb back up. ──
    await step(page, {
      label: 'log a $500 refund', page: 'pay-panel', role: 'contractor',
      suspect: 'bids.js logPayment refund branch (negative amount) + getBidPaid',
      ruleText: 'a $500 refund must store a negative payment and raise the balance by 500',
      expected: 'balance 4500 (refund reduces paid total)',
      act: async (p) => {
        // openPayPanel takes no autoType for refunds, so it does NOT auto-fire
        // selectPayType — #mpay-detail-fields/#mpay-amount stay display:none. The
        // refund button lives inside #_mpay-adj-btns (also display:none). The real
        // user flow: open the panel, tap "⋯ Adjustments & refunds" to reveal the
        // adjustment buttons, then tap "Issue refund to client" — that button's
        // onclick=selectPayType(this,bidId) reveals the amount row (bids.js:1130-1157).
        await p.evaluate(({ bidId }) => { openPayPanel(bidId, 'refund'); }, { bidId });   // 1 tap (open)
        await p.waitForSelector('.pay-modal-overlay', { timeout: 8000 });
        await p.evaluate(() => { _mpayToggleAdj(); }, {});                                 // 1 tap (reveal adjustments)
        // Tap the refund button itself so selectPayType runs against its element.
        await p.click('.pay-modal-overlay button[data-ptype="refund"]');                  // 1 tap (pick refund)
        await p.waitForSelector('#mpay-amount', { state: 'visible', timeout: 8000 });
        await p.evaluate(({ today, REF }) => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.readOnly = false; el.value = v; } };
          set('mpay-amount', String(REF));   // refund amount field — typed "500" = 3 keystrokes
          set('mpay-date', today);           // date field — date picker = 1 tap
        }, { today, REF });
        // Tap "Issue refund".
        await p.evaluate(() => { logPayment(); }, {});                                     // 1 tap (submit)
        await p.waitForTimeout(400);
        return 8; // open(1) + adj toggle(1) + refund pick(1) + amount"500"(3) + date pick(1) + submit(1) = 8
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          const neg = payments.filter(x => x.bid_id === bidId && x.amount < 0).length;
          return { bal: b ? getBidBalance(b) : null, neg };
        }, { bidId });
        return { ok: r.bal === BASE - DEP + REF && r.neg === 1, got: JSON.stringify(r) };
      },
    });

    // ── File a mechanic's lien for the outstanding balance. ──
    await step(page, {
      label: 'file a mechanic’s lien', page: 'lien-panel', role: 'contractor',
      suspect: 'bids.js openLienPanel/saveLien + getBidLien',
      ruleText: 'filing a lien must record a filed lien for this bid carrying the outstanding balance',
      expected: 'getBidLien status=filed, amount=outstanding balance',
      act: async (p) => {
        const bal = BASE - DEP + REF;
        // #cd-lien-panel and its fields live INSIDE #cdt-bids-content, which is
        // display:none until the client detail page is open and the Bids tab is
        // active (clients.js setCDTab:1241-1252). openLienPanel only unhides
        // #cd-lien-panel itself (bids.js:1303), not its hidden ancestor — so the
        // real user reveal path is: open the client record, switch to the Bids tab,
        // THEN tap "File lien". Drive that path so #lien-amount actually becomes
        // visible instead of staying inside a collapsed container.
        await p.evaluate(({ clientId }) => { openClientDetail(clientId); }, { clientId }); // 1 tap (open client record)
        await p.evaluate(() => { setCDTab('bids'); }, {});                                 // 1 tap (Bids tab)
        await p.evaluate(({ bidId }) => { openLienPanel(bidId); }, { bidId });             // 1 tap (File lien)
        await p.waitForSelector('#lien-amount', { state: 'visible', timeout: 8000 });
        await p.evaluate(({ today, bal }) => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
          set('lien-status', 'filed');               // status <select> = 1 tap
          set('lien-amount', String(bal));           // amount field — bal=4500, typed "4500" = 4 keystrokes
          set('lien-date', today);                   // date field — date picker = 1 tap
          set('lien-county', 'Sedgwick County, KS'); // county field — typed = 19 keystrokes
          set('lien-notes', 'E2E lien');             // notes field — typed = 8 keystrokes
        }, { today, bal });
        await p.evaluate(() => { saveLien(); }, {});                                      // 1 tap (submit)
        await p.waitForTimeout(400);
        return 37; // openClient(1) + bidsTab(1) + openLien(1) + status pick(1) + amount"4500"(4) + date pick(1) + county(19) + notes(8) + submit(1) = 37
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const l = (typeof getBidLien === 'function') ? getBidLien(bidId) : liens.find(x => x.bid_id === bidId);
          return l ? { status: l.status, amount: l.amount, county: l.county } : null;
        }, { bidId });
        const memOk = !!r && r.status === 'filed' && r.amount === BASE - DEP + REF && /Sedgwick|KS/.test(r.county || '');
        // TRUE end-to-end: the filed lien must also be in the cloud (td_liens).
        const cloud = await cloudRows(p, 'td_liens');
        const cl = cloud.find(l => String(l.bid_id) === String(bidId));
        const cloudOk = !!cl && cl.status === 'filed' && cl.amount === BASE - DEP + REF;
        return { ok: memOk && cloudOk, got: r ? `mem=${JSON.stringify(r)} cloudLien=${cl ? cl.status + '/' + cl.amount : 'ROW ABSENT'}` : 'no lien recorded' };
      },
    });

    // NO cleanup — the bid, payments, liens + client stay in the dev account on
    // purpose so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
