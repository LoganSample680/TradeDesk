// REAL flow — proposal open-tracking (task #10). Proves the "👀 Opened" signal is
// real end-to-end: the contractor sends a proposal, a CLIENT (a fully isolated
// browser context with NO contractor session) opens the client.html hub, which
// POSTs to the log-proposal-view edge function (hub_opened_at), and then the
// contractor's app — via _fetchProposalViews() — must see that the proposal was
// opened. The isolation matters: client.html deliberately skips logging when the
// viewer IS the contractor, so a same-context page would never log a view.
//
// Soft-skips (pass with a note) if proposal_views isn't reachable in this env, so
// the gate never deadlocks on a not-yet-deployed analytics table.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, seedProposal, scopeBypassHeader } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'open-tracking/hub-opened';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';

test.describe('proposal open-tracking (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a client opening the hub marks the proposal Opened for the contractor', async ({ page }) => {
    const clientId = Date.now() * 1000 + (process.pid % 1000);
    const bidId = clientId + 1;

    // ── Send the proposal: seed + build & upload the hub via the real code. ──
    let hub = {};
    await step(page, {
      label: 'send proposal → upload client hub', page: 'cloud', role: 'contractor',
      suspect: 'proposals.js _uploadClientHub',
      ruleText: 'building the hub must mint a token + upload a snapshot carrying the pending proposal',
      expected: 'hub token + uid present',
      act: async (p) => {
        // Real typed-up, sent proposal (random client/address + real proposalHtml).
        await seedProposal(p, { clientId, bidId, amount: 4800, tag: 'open' });
        hub = await p.evaluate(async ({ clientId }) => {
          let url = null;
          if (typeof _uploadClientHub === 'function') url = await _uploadClientHub(clientId);
          const c = clients.find(x => x.id === clientId);
          return { url, token: c ? c.clientToken : null, uid: (_supaUser && _supaUser.id) || null };
        }, { clientId });
        return 1;
      },
      rule: async () => ({ ok: !!hub.token && !!hub.uid, got: `token=${!!hub.token} uid=${!!hub.uid}` }),
    });

    // ── A real CLIENT (isolated context, no contractor session) opens the hub. ──
    await step(page, {
      label: 'client opens hub → contractor sees Opened', page: 'client.html', role: 'client',
      suspect: 'client.html log-proposal-view fetch → cloud.js _fetchProposalViews',
      ruleText: 'a client hub open must register as Opened on the contractor side (or soft-skip if proposal_views is absent)',
      expected: 'contractor _proposalViewsByBidHubClient[bidId] populated',
      act: async (p) => {
        // Fully isolated browser context: no shared auth, so client.html treats the
        // viewer as a real client and fires the view log.
        const cctx = await p.context().browser().newContext({ baseURL: BASE, bypassCSP: true });
        await scopeBypassHeader(cctx, BASE);
        const cpage = await cctx.newPage();
        const url = `/client.html?t=${hub.token}&u=${hub.uid}&c=${clientId}`;
        for (let i = 0; i < 3; i++) {
          await cpage.goto(url + '&cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          const rendered = await cpage.waitForSelector('.hub-bid-row, #pg-err', { timeout: 12000 }).then(() => true).catch(() => false);
          if (rendered && await cpage.locator('.hub-bid-row').count()) break;
          await cpage.waitForTimeout(1500);
        }
        await cpage.waitForTimeout(2500); // let the edge function persist the view
        await cctx.close().catch(() => {});

        // Contractor side: re-fetch views until the hub-open lands (edge function +
        // table write can lag a couple seconds). Distinguish "absent table" → skip.
        const probe = await p.evaluate(async ({ bidId }) => {
          let opened = false, tableErr = false;
          for (let i = 0; i < 8 && !opened; i++) {
            try {
              if (typeof _fetchProposalViews === 'function') await _fetchProposalViews();
            } catch (e) { tableErr = true; }
            const m = (typeof _proposalViewsByBidHubClient !== 'undefined') ? _proposalViewsByBidHubClient : {};
            if (m && m[bidId]) { opened = true; break; }
            await new Promise(r => setTimeout(r, 1500));
          }
          // Probe whether proposal_views is even reachable, to allow a clean skip.
          let reachable = true;
          try {
            const { error } = await _supa.from('proposal_views').select('bid_id').limit(1);
            if (error && (/does not exist|relation|PGRST/i.test(error.message || '') || error.code === '42P01')) reachable = false;
          } catch (e) { reachable = false; }
          // Probe whether the log-proposal-view EDGE FUNCTION is deployed — the hub open is
          // logged by it, so on a from-migrations local stack (edge runtime absent) the table
          // is reachable but the view never lands. A 404/502/503/0 means skip, not fail.
          let edgeFnUp = true;
          try {
            const sess = await _supa.auth.getSession();
            const tok = (sess && sess.data && sess.data.session && sess.data.session.access_token) || (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '');
            const r = await fetch(SUPA_URL + '/functions/v1/log-proposal-view', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', apikey: (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : '') }, body: '{}' });
            if ([0, 404, 502, 503].includes(r.status)) edgeFnUp = false;
          } catch (e) { edgeFnUp = false; }
          return { opened, tableErr, reachable, edgeFnUp };
        }, { bidId });
        hub.openProbe = probe;
        return 1;
      },
      rule: async () => {
        if (!hub.openProbe.reachable || !hub.openProbe.edgeFnUp) {
          return { ok: true, got: 'SKIP — proposal_views / log-proposal-view edge fn not available in this env (pending deploy): ' + JSON.stringify(hub.openProbe) };
        }
        return { ok: hub.openProbe.opened, got: JSON.stringify(hub.openProbe) };
      },
    });

    // NO cleanup — the client, bid + hub snapshot stay in the dev account on purpose
    // so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
