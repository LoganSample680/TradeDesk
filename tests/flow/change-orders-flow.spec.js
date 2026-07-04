// REAL flow — the change-order document chain (CLAUDE.md §9.2: native change
// orders are the biggest gap vs ServiceTitan/Jobber/HCP). Drives the actual CO
// builder (proposals.js showChangeOrderModal → setCOType → _reviewCO →
// _sendCOToHub) against a tagged throwaway bid and asserts the delta math and the
// pending-client persistence — WITHOUT rolling the bid total (that only happens
// when the client signs in the hub), so no real bid is mutated.
//
// FINDING (recorded, not built — §9 backlog): completion invoices are NOT a
// signable document. openInvoice() is a view-only statement of account; there is
// no js/completion-invoice.js, no send/sign, and it is not cloud-synced. The
// document chain is therefore HALF complete: change orders ship, completion
// invoices do not. This test guards the half that exists.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'change-order/add-delta';

test.describe('change order document chain (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('create a +$450 change order on a bid and persist it pending-client with correct delta', async ({ page }) => {
    const bidId = Date.now() * 1000 + Math.floor(Math.random() * 1000); // entropy: no cross-viewport collision
    const clientId = bidId + 1;
    const BASE = 5000;
    const ADD = 450;

    // ── Seed a tagged bid + client and persist them (the CO needs a real bid). ──
    await step(page, {
      label: 'seed a $5000 test bid + client', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud',
      ruleText: 'the seeded bid must exist in memory with its base amount',
      expected: 'bid present with amount 5000, changeOrders empty',
      act: async (p) => {
        await p.evaluate(async ({ bidId, clientId, BASE }) => {
          clients.push({ id: clientId, name: 'E2E CO Client', phone: '3165550450', email: 'co@e2e.test', _e2e: 'change-order' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E CO Client', amount: BASE, deposit: 0, status: 'Closed Won', surfaces: [], changeOrders: [], _e2e: 'change-order' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        }, { bidId, clientId, BASE });
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          return { has: !!b, amount: b ? b.amount : null, cos: b ? (b.changeOrders || []).length : -1 };
        }, { bidId });
        return { ok: r.has && r.amount === BASE && r.cos === 0, got: JSON.stringify(r) };
      },
    });

    // ── Drive the real CO builder: open → describe → type=add → amount → review
    // → send-to-hub. Assert the delta + newAmount the production code computed. ──
    let co = {};
    await step(page, {
      label: 'build +$450 add CO and send to hub', page: 'change-order', role: 'contractor',
      suspect: 'proposals.js _reviewCO delta calc + _sendCOToHub persistence',
      ruleText: 'a +$450 add change order must persist with delta +450, newAmount = base+450, status pending_client, and must NOT roll the bid total yet',
      expected: 'delta=450 newAmount=5450 status=pending_client bid.amount unchanged=5000',
      act: async (p) => {
        await p.evaluate(({ bidId, clientId }) => { showChangeOrderModal(bidId, clientId); }, { bidId, clientId }); // 1 tap (open CO modal)
        await p.waitForSelector('#co-desc', { timeout: 8000 });
        await p.fill('#co-desc', 'Added master bedroom ceiling — two coats');           // textarea — typed = 40 keystrokes
        await p.evaluate(({ bidId }) => { setCOType('add', bidId); }, { bidId });        // 1 tap (pick type=add)
        await p.fill('#co-amount', String(ADD));                                          // amount field — typed "450" = 3 keystrokes
        await p.evaluate(({ bidId }) => { _previewCO(bidId); }, { bidId });
        await p.evaluate(({ bidId, clientId }) => { _reviewCO(bidId, clientId); }, { bidId, clientId }); // 1 tap (review)
        await p.waitForTimeout(300);
        await p.evaluate(({ bidId, clientId }) => { _sendCOToHub(bidId, clientId); }, { bidId, clientId }); // 1 tap (send to hub)
        await p.waitForTimeout(1500);
        co = await p.evaluate(({ bidId }) => {
          const b = bids.find(x => x.id === bidId);
          const c = b && (b.changeOrders || [])[0];
          return { amount: b ? b.amount : null, co: c || null };
        }, { bidId });
        return 47; // open(1) + desc"Added master bedroom ceiling — two coats"(40) + setCOType(1) + amount"450"(3) + review(1) + send(1) = 47
      },
      rule: async (p) => {
        const c = co.co;
        const memOk = !!c && c.delta === ADD && c.newAmount === BASE + ADD && c.status === 'pending_client' && co.amount === BASE;
        // TRUE end-to-end: the change order must have persisted onto the bid in the
        // cloud (td_bids.data.changeOrders), not just the in-memory bids[] array.
        const cloud = await cloudRows(p, 'td_bids');
        const cb = cloud.find(b => String(b.id) === String(bidId));
        const cc = cb && (cb.changeOrders || [])[0];
        const cloudOk = !!cc && cc.delta === ADD && cc.newAmount === BASE + ADD;
        return { ok: memOk && cloudOk, got: c ? `mem(delta=${c.delta} newAmount=${c.newAmount} status=${c.status}) cloudDelta=${cc ? cc.delta : 'CO ABSENT'}` : 'no CO recorded' };
      },
    });

    // NO cleanup — the bid, change order + client stay in the dev account on purpose
    // so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
