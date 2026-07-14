// REAL flow — live coverage for the three UI toggles shipped this round, driving the
// actual app (no stubs): clicking a proposal stat tile filters the list, the team-member
// Permissions block is a default-closed accordion that opens on tap, and a kanban column
// header collapses the bid cards inside it. None need seeded data — they assert the real
// render + the real click handler's effect on real globals/DOM.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'ui/toggles';

test.describe('UI toggles — proposal tiles, permissions accordion, kanban collapse (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('tapping the Signed stat tile filters the proposals list to signed', async ({ page }) => {
    await step(page, {
      label: 'open Proposals, tap the Signed tile', page: 'pg-proposals', role: 'contractor',
      suspect: 'dashboard.js renderProposalsPage met tiles → onclick setProposalFilter(\'signed\')',
      ruleText: 'tapping the Signed stat tile must set the proposal filter to signed and activate its tab',
      expected: '_proposalFilter === "signed" and #pft-signed is active',
      act: async (p) => {
        await p.evaluate(() => { goPg('pg-proposals'); });
        await p.waitForSelector('#proposals-mets .met', { state: 'visible', timeout: 12000 });
        // The 2nd tile is "Signed" (Sent · Signed · Awaiting sig · Close rate).
        const n = await tap(p, '#proposals-mets .met:nth-child(2)');
        await p.waitForTimeout(150);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          filter: (typeof _proposalFilter !== 'undefined') ? _proposalFilter : null,
          tabActive: !!document.getElementById('pft-signed')?.classList.contains('active'),
        }));
        return { ok: r.filter === 'signed' && r.tabActive, got: JSON.stringify(r) };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('team-member Permissions is a default-closed accordion that opens on tap', async ({ page }) => {
    await step(page, {
      label: 'open Add-member modal, expand Permissions', page: 'pg-team', role: 'contractor',
      suspect: 'cloud.js _employeeModalHTML .perms-acc + _togglePermsAccordion',
      ruleText: 'Permissions must default closed (max-height 0) and open (>0) when the header is tapped',
      expected: 'perms-acc closed initially, then open after tapping the header',
      act: async (p) => {
        await p.evaluate(() => { openAddEmployeeModal(); });
        // 'attached', NOT 'visible': .perms-acc is the collapsed accordion (max-height:0),
        // so it's present but zero-height until opened — waiting for visible would hang.
        await p.waitForSelector('.perms-acc', { state: 'attached', timeout: 12000 });
        await p.waitForSelector('.perms-chev', { state: 'visible', timeout: 12000 });
        p.__closed0 = await p.evaluate(() => {
          const a = document.querySelector('.perms-acc');
          return !!a && (a.style.maxHeight === '' || a.style.maxHeight === '0px');
        });
        // The chevron lives inside the tappable header; clicking it bubbles to the header's
        // onclick=_togglePermsAccordion. (A real thumb taps the row.)
        const n = await tap(p, '.perms-chev');
        await p.waitForTimeout(300); // let the max-height transition settle
        p.__openAfter = await p.evaluate(() => {
          const a = document.querySelector('.perms-acc');
          return !!a && !!a.style.maxHeight && a.style.maxHeight !== '0px';
        });
        return n;
      },
      rule: async (p) => ({
        ok: p.__closed0 === true && p.__openAfter === true,
        got: `closedInitially=${p.__closed0} openAfterTap=${p.__openAfter}`,
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // 2026-07-14 owner directive ("simplify before we scale"): the Crew Today
  // dashboard card is DELETED — it duplicated the Time log "Currently clocked
  // in" banner; crew cost lives in Books (_openCrewCost). Per §7.1 the live
  // suite asserts the deletion on the real app: function gone, element gone,
  // and the Books report entry point still intact.
  test('Crew Today dashboard card is DELETED; Books crew-cost report survives', async ({ page }) => {
    await step(page, {
      label: 'assert the Crew Today card is gone on the live app', page: 'pg-dash', role: 'contractor',
      suspect: 'finance.js (deleted _renderDashCrewToday) + dashboard.js renderDash + index.html widget root',
      ruleText: 'the deleted card must have NO function, NO element, NO crew widget wrapper — and _openCrewCost (Books) must still exist',
      expected: 'fn gone + element gone + widget gone + Books report intact',
      act: async (p) => {
        await p.evaluate(() => { if (typeof renderDash === 'function') renderDash(); });
        await p.waitForTimeout(400);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          fnExists: typeof _renderDashCrewToday === 'function',
          elExists: !!document.getElementById('dash-crew-today'),
          widgetExists: !!document.querySelector('.td-dw[data-dw="crew"]'),
          booksIntact: typeof _openCrewCost === 'function' && typeof _fetchCrewLabor === 'function',
        }));
        return { ok: !r.fnExists && !r.elExists && !r.widgetExists && r.booksIntact, got: JSON.stringify(r) };
      },
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  test('tapping a kanban column header collapses the bid cards inside it', async ({ page }) => {
    await step(page, {
      label: 'open Jobs board, collapse the first column', page: 'pg-jobs', role: 'contractor',
      suspect: 'jobs.js _renderJobsKanban .kcol-hd onclick=_toggleKcol → hides .kcol-body',
      ruleText: 'tapping a kanban column header must hide its .kcol-body and record the collapse',
      expected: 'first column .kcol-body display:none and window._kcolCollapsed[id] true',
      act: async (p) => {
        await p.evaluate(() => { goPg('pg-jobs'); if (typeof renderJobsPage === 'function') renderJobsPage(); });
        await p.waitForSelector('.kcol .kcol-hd', { state: 'visible', timeout: 12000 });
        p.__before = await p.evaluate(() => {
          const b = document.querySelector('.kcol .kcol-body');
          return b ? (b.style.display || 'shown') : 'no-body';
        });
        const n = await tap(p, '.kcol .kcol-hd');
        await p.waitForTimeout(150);
        p.__after = await p.evaluate(() => {
          const col = document.querySelector('.kcol');
          const b = col && col.querySelector('.kcol-body');
          const id = col && col.getAttribute('data-status');
          return { disp: b ? (b.style.display || 'shown') : 'no-body', collapsed: !!(window._kcolCollapsed && id && window._kcolCollapsed[id]) };
        });
        return n;
      },
      rule: async (p) => ({
        ok: p.__after.disp === 'none' && p.__after.collapsed === true,
        got: JSON.stringify({ before: p.__before, after: p.__after }),
      }),
    });
    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
