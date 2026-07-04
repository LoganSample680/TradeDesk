// REAL flow — live coverage for the three UI toggles shipped this round, driving the
// actual app (no stubs): clicking a proposal stat tile filters the list, the team-member
// Permissions block is a default-closed accordion that opens on tap, and a kanban column
// header collapses the bid cards inside it. None need seeded data — they assert the real
// render + the real click handler's effect on real globals/DOM.
const { test, expect } = require('@playwright/test');
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

  test('Crew Today card labels the cost "Labor cost" (renamed from "Loaded labor")', async ({ page }) => {
    await step(page, {
      label: 'seed a today time entry, render Crew Today', page: 'pg-dash', role: 'contractor',
      suspect: 'finance.js _renderDashCrewToday → "Labor cost" label',
      ruleText: 'the Crew Today card must render and label the cost column "Labor cost", never the old "Loaded labor"',
      expected: '#dash-crew-today visible with "Labor cost" and no "Loaded labor"',
      act: async (p) => {
        const r = await p.evaluate(async () => {
          const uid = _supaUser.id;
          const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || uid;
          S.teamTracking = true; // owner-only card is gated on this
          let insErr = null;
          try {
            const { error } = await _supa.from('job_time_entries').insert({
              contractor_user_id: cid, employee_user_id: uid, job_id: String(Date.now() * 1000),
              minutes: 120, source: 'geofence', arrived_at: new Date().toISOString(),
            });
            insErr = error ? (error.message || 'insert error') : null;
          } catch (e) { insErr = 'ex: ' + (e && e.message); }
          if (typeof _renderDashCrewToday === 'function') await _renderDashCrewToday();
          return { insErr };
        });
        p.__ins = r.insErr;
        await p.waitForTimeout(400);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const el = document.getElementById('dash-crew-today');
          const html = el ? (el.innerHTML || '') : '';
          return { rendered: !!el && el.style.display !== 'none', hasNew: html.includes('Labor cost'), hasOld: html.includes('Loaded labor') };
        });
        return { ok: r.rendered && r.hasNew && !r.hasOld, got: JSON.stringify({ ...r, ins: p.__ins }) };
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
