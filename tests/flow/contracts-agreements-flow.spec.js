// REAL flow — the document-relationship chain (task #6): create a recurring
// maintenance contract for a client, then create a partnership/employment
// agreement and mark it signed. Drives the actual UI funcs (contracts.js
// openNewContractModal/_ctSaveNew, agreements.js openNewAgreement/_agSave/
// markAgreementSigned). Each assertion is a step() so a regression throws a
// one-line finding(). Both stores round-trip through the cloud (td_contracts /
// td_agreements) so the seed save proves the write path end-to-end.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, type, cloudRows, seedName, seedAddr } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'docs/contract-agreement-sign';

test.describe('contracts & agreements (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('create a maintenance contract, then an agreement, and sign it', async ({ page }) => {
    const stamp = process.pid;
    const clientId = Date.now() * 1000 + (stamp % 1000);
    const clientName = seedName();              // real client, not "E2E Contract Client"
    const clientAddr = seedAddr();
    const ctTitle = 'Annual exterior touch-up & caulk';
    const agParty = seedName();                 // real partner name

    // ── Maintenance contract via the real modal ───────────────────────────────
    await step(page, {
      label: 'create a maintenance contract for a client', page: 'pg-clients', role: 'contractor',
      suspect: 'contracts.js _ctSaveNew (contracts.push + saveAll)',
      ruleText: 'saving the contract modal must create an active contract for the client',
      expected: `a contract titled "${ctTitle}", amount 1800, active`,
      act: async (p) => {
        await p.evaluate(({ clientId, clientName, clientAddr }) => {
          clients.push({ id: clientId, name: clientName, addr: clientAddr, phone: '3165550222', source: 'Repeat client', _e2e: 'docs' });
          openNewContractModal(clientId);
        }, { clientId, clientName, clientAddr });
        await p.waitForSelector('#ct-title', { timeout: 10000 });
        const k1 = await type(p, '#ct-title', ctTitle);
        const k2 = await type(p, '#ct-amount', '1800');
        await p.evaluate(({ clientId }) => { _ctSaveNew(clientId); }, { clientId });
        await p.waitForTimeout(500);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return k1 + k2 + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate((t) => {
          const c = (contracts || []).find(x => x.title === t);
          return c ? { amount: c.amount, active: c.active } : null;
        }, ctTitle);
        return { ok: !!r && r.amount === 1800 && r.active === true, got: JSON.stringify(r) };
      },
    });

    let agId = null;
    // ── Partnership/employment agreement via the real modal ───────────────────
    await step(page, {
      label: 'create an agreement (partnership terms)', page: 'pg-contracts', role: 'contractor',
      suspect: 'agreements.js _agSave (agreements.push + saveAll)',
      ruleText: 'saving the agreement modal must create a draft agreement with the party + terms',
      expected: `a draft agreement for "${agParty}" with non-empty terms`,
      act: async (p) => {
        await p.evaluate(() => { openNewAgreement(); });
        await p.waitForSelector('#_ag-party', { timeout: 10000 });
        const k1 = await type(p, '#_ag-party', agParty);
        const k2 = await type(p, '#_ag-title', `E2E Profit-Share ${process.pid}`);
        // profit_share is the default type → template body is pre-filled, so terms
        // are non-empty without typing a wall of text (a real user accepts the tpl).
        await p.evaluate(() => { _agSave(); });
        await p.waitForTimeout(400);
        agId = await p.evaluate((party) => {
          const a = (agreements || []).find(x => x.party === party);
          return a ? a.id : null;
        }, agParty);
        return k1 + k2 + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate((party) => {
          const a = (agreements || []).find(x => x.party === party);
          return a ? { status: a.status, hasBody: !!(a.body && a.body.length > 10) } : null;
        }, agParty);
        return { ok: !!r && r.status === 'draft' && r.hasBody, got: JSON.stringify(r) };
      },
    });

    await step(page, {
      label: 'mark the agreement signed', page: 'pg-contracts', role: 'contractor',
      suspect: 'agreements.js markAgreementSigned (status=signed, signedAt set)',
      ruleText: 'marking signed must set status=signed and stamp signedAt',
      expected: 'agreement.status=signed with a signedAt timestamp',
      act: async (p) => {
        await p.evaluate(({ agId }) => { markAgreementSigned(agId); }, { agId });
        await p.waitForTimeout(400);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ agId }) => {
          const a = (agreements || []).find(x => x.id === agId);
          return a ? { status: a.status, signedAt: !!a.signedAt } : null;
        }, { agId });
        const memOk = !!r && r.status === 'signed' && r.signedAt;
        // TRUE end-to-end: the signed agreement must also be in the cloud (td_agreements).
        const cloud = await cloudRows(p, 'td_agreements');
        const ca = cloud.find(a => String(a.id) === String(agId));
        const cloudOk = !!ca && ca.status === 'signed' && !!ca.signedAt;
        return { ok: memOk && cloudOk, got: `mem=${JSON.stringify(r)} cloudStatus=${ca ? ca.status : 'ROW ABSENT'}` };
      },
    });

    // NO cleanup — the contract, agreement + client stay in the dev account on
    // purpose so the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
