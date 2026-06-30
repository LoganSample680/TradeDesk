// REAL flow — proves a LEGIT proposal shows up inside the CLIENT HUB (the thing
// that was 404-ing as "Proposal not found" / showing hollow hubs). Drives the
// REAL hub pipeline: seed a client + a Pending proposal bid → build & upload the
// hub snapshot via the actual production functions (proposals.js
// _buildClientHubSnapshot + _uploadClientHub) → then open the REAL client.html
// hub (anon, no login, same /api proxy) and assert the proposal renders as a
// .hub-bid-row under "Awaiting your signature" — NOT the "Hub not found" state.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal } = require('./live-helpers');
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
        // Seed a REAL typed-up, sent proposal (random client/address, real
        // proposalHtml + uploaded artifact) — not a hollow Pending row.
        await seedProposal(p, { clientId, bidId, amount: AMOUNT, tag: 'hub' });
        hub = await p.evaluate(async ({ clientId }) => {
          let url = null;
          if (typeof _uploadClientHub === 'function') url = await _uploadClientHub(clientId); // real build + upload
          // Read the token from the RETURNED URL — the authoritative artifact the hub
          // snapshot was keyed with and that client.html actually resolves from. Re-reading
          // clients[].clientToken races a realtime cloud-reload that can swap the array out
          // from under us between the await and the find (shared-account multi-device sync).
          const m = (url || '').match(/[?&]t=([^&]+)/);
          const token = m ? decodeURIComponent(m[1]) : null;
          return { url, token, uid: (_supaUser && _supaUser.id) || null };
        }, { clientId });
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

  // A closed-out (declined) proposal must STAY in the hub Documents as a read-only
  // record carrying its reason — not vanish once it leaves Pending. Guards the new
  // close-out → hub-refresh path + the renderDocuments declined card.
  test('a closed-out proposal stays in the hub Documents — read-only, with its reason', async ({ page }) => {
    const clientId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const bidId = clientId + 1;
    const REASON = 'Went with another contractor';

    let hub = {};
    await step(page, {
      label: 'send proposal → close out (declined) → re-upload hub', page: 'cloud', role: 'contractor',
      suspect: 'bids.js _submitCloseOutEstimate hub refresh + proposals.js _buildClientHubSnapshot (lostReason)',
      ruleText: 'closing out a proposal must keep it in the hub snapshot carrying status Closed Lost + the reason',
      expected: 'hub token minted; snapshot rebuilt after close-out',
      act: async (p) => {
        await seedProposal(p, { clientId, bidId, amount: 5200, tag: 'hubdecl' });
        hub = await p.evaluate(async ({ bidId, clientId, reason }) => {
          // Close out exactly as _submitCloseOutEstimate does (status + reason), then
          // re-publish the hub via the real production function.
          const b = bids.find(x => x.id === bidId);
          if (b) { b.status = 'Closed Lost'; b.draft = false; b.lostReason = reason; b.lostNote = ''; b.lostAt = new Date().toISOString(); }
          if (typeof saveAll === 'function') saveAll();
          let url = null;
          if (typeof _uploadClientHub === 'function') url = await _uploadClientHub(clientId);
          const m = (url || '').match(/[?&]t=([^&]+)/);
          return { url, token: m ? decodeURIComponent(m[1]) : null, uid: (_supaUser && _supaUser.id) || null };
        }, { bidId, clientId, reason: REASON });
        return 1;
      },
      rule: async () => ({ ok: !!hub.token && !!hub.uid, got: `token=${!!hub.token} uid=${!!hub.uid} url=${hub.url}` }),
    });

    await step(page, {
      label: 'open hub Documents → declined card present, no Review & Sign', page: 'client.html', role: 'client',
      suspect: 'client.html renderDocuments — declined card (lostReason; no sign action)',
      ruleText: 'the declined proposal must render in Documents with its reason and NO Review & Sign action',
      expected: 'a DECLINED card showing the reason; zero sign buttons in Documents',
      act: async (p) => {
        const hubPage = await p.context().newPage();
        const base = `/client.html?t=${hub.token}&u=${hub.uid}&c=${clientId}`;
        let ok = false, got = '';
        for (let i = 0; i < 4 && !ok; i++) {
          await hubPage.goto(base + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await hubPage.waitForSelector('.nav-item, #pg-err', { timeout: 12000 }).catch(() => {});
          await hubPage.evaluate(() => { if (typeof switchView === 'function') switchView('documents'); }).catch(() => {});
          await hubPage.waitForTimeout(400);
          // Expand the declined card so its (collapsed) reason body renders into innerText.
          await hubPage.evaluate((id) => { if (typeof _toggleDoc === 'function') _toggleDoc(id); }, bidId).catch(() => {});
          await hubPage.waitForTimeout(250);
          const declinedBadges = await hubPage.getByText('DECLINED', { exact: false }).count().catch(() => 0);
          const reasonShown = await hubPage.locator('#db-' + bidId).innerText().then(t => t.includes(REASON)).catch(() => false);
          // A declined record must never offer signing.
          const signBtns = await hubPage.locator('.hub-btn-sign, a:has-text("Review & Sign"), button:has-text("Review & Sign")').count().catch(() => 0);
          const errVisible = await hubPage.locator('#pg-err').isVisible().catch(() => false);
          ok = declinedBadges >= 1 && reasonShown && signBtns === 0 && !errVisible;
          got = `declinedBadges=${declinedBadges} reasonShown=${reasonShown} signBtns=${signBtns} errVisible=${errVisible} attempt=${i + 1}`;
          if (!ok) await hubPage.waitForTimeout(2500);
        }
        hub.render = { ok, got };
        await hubPage.close().catch(() => {});
        return 1;
      },
      rule: async () => ({ ok: hub.render.ok, got: hub.render.got }),
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
