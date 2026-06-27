// REAL flow — proves a LEGIT proposal shows up inside the CLIENT HUB (the thing
// that was 404-ing as "Proposal not found" / showing hollow hubs). Drives the
// REAL hub pipeline: seed a client + a Pending proposal bid → build & upload the
// hub snapshot via the actual production functions (proposals.js
// _buildClientHubSnapshot + _uploadClientHub) → then open the REAL client.html
// hub (anon, no login, same /api proxy) and assert the proposal renders as a
// .hub-bid-row under "Awaiting your signature" — NOT the "Hub not found" state.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'client-hub/proposal-visible';

test.describe('client hub shows a real proposal (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a sent proposal renders in the client hub (not "Proposal not found")', async ({ page }) => {
    // Entropy so concurrent browser projects can't collide on the same id/token.
    const clientId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const bidId = clientId + 1;
    const AMOUNT = 6400;

    // ── Seed a client + a Pending proposal bid, then build+upload the hub via the
    // REAL production code (so the snapshot is produced exactly as in the app). ──
    let hub = {};
    await step(page, {
      label: 'send proposal → upload client hub', page: 'cloud', role: 'contractor',
      suspect: 'proposals.js _buildClientHubSnapshot + _uploadClientHub',
      ruleText: 'building the hub must mint a token and upload a snapshot carrying the pending proposal',
      expected: 'hub token minted + upload returns a client.html url',
      act: async (p) => {
        hub = await p.evaluate(async ({ clientId, bidId, AMOUNT }) => {
          const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
          clients.push({ id: clientId, name: 'E2E Hub Client', phone: '3165550700', addr: '700 Hub St, Wichita, KS 67202', _e2e: 'hub' });
          bids.push({ id: bidId, client_id: clientId, client_name: 'E2E Hub Client', amount: AMOUNT, deposit: 1600, status: 'Pending', type: 'Interior / Exterior', bid_date: new Date().toISOString().slice(0, 10), signingToken: token, surfaces: [{ type: 'walls', room: 'Living Room', qty: 480 }], _e2e: 'hub' });
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
          let url = null;
          if (typeof _uploadClientHub === 'function') url = await _uploadClientHub(clientId); // real build + upload, awaits when new
          const c = clients.find(x => x.id === clientId);
          return { url, token: c ? c.clientToken : null, uid: (_supaUser && _supaUser.id) || null };
        }, { clientId, bidId, AMOUNT });
        return 1;
      },
      rule: async () => {
        const ok = !!hub.token && !!hub.uid;
        return { ok, got: `token=${!!hub.token} uid=${!!hub.uid} url=${hub.url}` };
      },
    });

    // ── Open the REAL client hub (fresh page, no contractor login) and assert the
    // proposal renders. Retry a few times for storage propagation. ──
    await step(page, {
      label: 'open client hub → proposal visible', page: 'client.html', role: 'client',
      suspect: 'client.html init/renderOverview (hub snapshot fetch + render)',
      ruleText: 'the client hub must render the pending proposal as a .hub-bid-row and NOT show the "Hub not found" error',
      expected: '>=1 .hub-bid-row, #pg-err not visible',
      act: async (p) => {
        const hubPage = await p.context().newPage();
        const base = `/client.html?t=${hub.token}&u=${hub.uid}&c=${clientId}`;
        let ok = false, got = '';
        for (let i = 0; i < 4 && !ok; i++) {
          await hubPage.goto(base + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await hubPage.waitForSelector('.hub-bid-row, #pg-err', { timeout: 12000 }).catch(() => {});
          const errVisible = await hubPage.locator('#pg-err').isVisible().catch(() => false);
          const rows = await hubPage.locator('.hub-bid-row').count().catch(() => 0);
          const hasSign = await hubPage.locator('.hub-btn-sign, a:has-text("Review & Sign")').count().catch(() => 0);
          ok = rows >= 1 && !errVisible;
          got = `rows=${rows} signBtns=${hasSign} errVisible=${errVisible} attempt=${i + 1}`;
          if (!ok) await hubPage.waitForTimeout(2500);
        }
        hub.render = { ok, got };
        await hubPage.close().catch(() => {});
        return 1;
      },
      rule: async () => ({ ok: hub.render.ok, got: hub.render.got }),
    });

    // NO cleanup — the client, bid + hub snapshot stay in the dev account on purpose
    // so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
