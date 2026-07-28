// REAL flow: QR lead tracking (PR #62 + the ROI/cost tie-in built alongside it).
// A contractor creates a QR source, a real anon visitor scans the physical
// code (functions/q/[[code]].js), lands on the tracked intake form, submits
// it, the contractor promotes the resulting lead, and logs what the code
// cost — all against the REAL deployed backend, not mocks. This is the gap
// offline shard coverage structurally cannot close: those specs fully mock
// _supa.from(...).insert()/.select(), so they never once exercise real RLS.
// Exactly that gap is what caught a real bug while this test was being
// designed — _qrCreateSource/_qrLoadSources/openIntakeFormModal were using
// _effectiveUid() (the signed-in user's own id) for qr_sources.account_id
// and intake.html's ?a= param, when both need accounts.id (_account.id, a
// SEPARATE gen_random_uuid() assigned at account creation). The RLS insert
// policy silently rejects the wrong id — no offline test could ever have
// caught it since none of them touch real Postgres RLS.
//
// Chain covered end to end:
//   contractor creates a QR source (real taps)
//     -> anon visitor scans /q/<code> (real Cloudflare Pages Function, logs 'scan')
//     -> anon visitor fills + submits the tracked intake form (logs 'form_opened' + 'submitted')
//     -> inbound_leads row carries the resolved label as its source (not 'qr_form')
//     -> contractor promotes the lead, the new client's source is the label
//     -> contractor logs what the code cost, ties into the existing
//        marketing-expense ROI table (dashboard.js renderLeadSources)
//
// Seed data (the QR source, its lead, the client, the expense) is left in
// the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, scopeBypassHeader, tap, type, pick, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'qr-leads/scan-to-labeled-lead';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';

test.describe('QR lead tracking: scan -> tracked form -> labeled lead -> ROI (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a QR code is created, scanned, submitted, promoted, and its cost tied into ROI', async ({ page, browser }) => {
    // 5 real steps, each hitting live Supabase, on a Dev account with years of
    // accumulated seed data (CLAUDE.md §12.7: live tests never clean up), so
    // signIn/cloud-boot alone eats real time before any step here even starts.
    // 150000 wasn't enough (confirmed: steps 1-3 — create source, real anon
    // scan+redirect+submit, event/label verification — all passed for real
    // against live Supabase before the overall test timeout hit mid-step-4).
    test.setTimeout(240000);

    const acctId = await page.evaluate(() => (typeof _account !== 'undefined' && _account) ? _account.id : null);
    test.skip(!acctId, 'dev account has no accounts row, cannot drive QR lead tracking');

    // migrations + Edge Functions only push to the Dev Supabase project on merge
    // to main (deploy-functions.yml), so a brand-new table/function from an
    // unmerged PR is legitimately absent here — soft-skip rather than fail,
    // same pattern as open-tracking-flow.spec.js's proposal_views probe.
    // ANY error here (not a specific message/code match — a first pass at that
    // missed PostgREST's actual schema-cache-miss shape, PGRST205, which lives
    // in error.code, not error.message) means treat it as unreachable and skip;
    // there's no scenario where an unexpected error here should hard-fail the
    // whole flow instead of skipping cleanly.
    const schemaProbe = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('qr_sources').select('id').limit(1);
        return { reachable: !error, errInfo: error ? JSON.stringify(error) : null };
      } catch (e) { return { reachable: false, errInfo: 'threw: ' + e.message }; }
    });
    test.skip(!schemaProbe.reachable, 'qr_sources/qr_events not yet migrated onto the Dev Supabase project — pushes on merge to main, this flow test goes live then. ' + (schemaProbe.errInfo || ''));

    const qrLabel = `E2E QR Truck Wrap ${process.pid}`;
    const leadName = `E2E QR Lead ${process.pid}`;
    const leadPhone = '3165551' + String(process.pid % 1000).padStart(3, '0');
    let sourceId = null, sourceCode = null;

    // ── Contractor creates a QR source: real taps, the actual owner journey ──
    // (Leads -> "Get leads" -> "Get QR codes..." -> fill + Create), not a
    // shortcut function call.
    await step(page, {
      label: 'contractor creates a QR source', page: 'pg-qr-leads', role: 'contractor',
      suspect: 'qr-leads.js _qrCreateSource',
      ruleText: 'creating a QR source must insert a real qr_sources row for this account',
      expected: `qr_sources has a row labeled "${qrLabel}"`,
      act: async (p) => {
        let n = 0;
        const leadsNav = await p.evaluate(() =>
          (document.getElementById('mtb-leads')?.offsetWidth > 0) ? '#mtb-leads' : '#nb-leads');
        n += await tap(p, leadsNav);
        await p.waitForSelector('#pg-leads.active', { state: 'attached', timeout: 8000 });
        n += await tap(p, '#pg-leads .tbar-r button:has-text("Get leads")');
        await p.waitForSelector('.zmodal-overlay', { state: 'visible', timeout: 8000 });
        n += await tap(p, '.zmodal-overlay button:has-text("Get QR codes")');
        await p.waitForSelector('#pg-qr-leads.active', { state: 'attached', timeout: 8000 });
        n += await type(p, '#qr-new-label', qrLabel);
        n += await pick(p, '#qr-new-cat', 'Vehicle / truck wrap');
        n += await tap(p, '#pg-qr-leads button:has-text("Create")');
        return n;
      },
      rule: async (p) => {
        // Re-query as the contractor: the insert must have actually landed
        // (RLS-legal), not just appeared in the in-memory _qrSources array.
        let row = null;
        for (let i = 0; i < 6; i++) {
          const { data } = await p.evaluate(async ({ acctId, qrLabel }) => {
            const { data } = await _supa.from('qr_sources').select('id,code,account_id,label').eq('account_id', acctId);
            return { data };
          }, { acctId, qrLabel });
          row = (data || []).find(r => r.label === qrLabel);
          if (row) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        if (row) { sourceId = row.id; sourceCode = row.code; }
        return { ok: !!row && row.account_id === acctId, got: JSON.stringify(row) };
      },
    });

    // ── A real public visitor (isolated anon context) scans the code, gets
    // redirected, and lands on the tracked form — then fills + submits it. ──
    let visitorResult = {};
    await step(page, {
      label: 'anon visitor scans the code and submits the tracked form', page: 'intake.html', role: 'client',
      suspect: 'functions/q/[[code]].js + intake.html _qrLog',
      ruleText: 'scanning /q/<code> must redirect with ?src=<code>, and submitting must show the confirmation',
      expected: `redirected to intake.html?a=${acctId}&src=${sourceCode}, confirmation shown`,
      act: async () => {
        const ctx = await browser.newContext({ baseURL: BASE, bypassCSP: true });
        await scopeBypassHeader(ctx, BASE);
        const ip = await ctx.newPage();
        let confirmed = false, redirectOk = false, got = '';
        try {
          await ip.goto(`/q/${sourceCode}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await ip.waitForSelector('#f-name', { timeout: 15000 });
          redirectOk = ip.url().includes(`src=${sourceCode}`);
          const fill = async (sel, val) => { await ip.locator(sel).click({ timeout: 8000 }).catch(() => {}); await ip.locator(sel).pressSequentially(val, { delay: 0 }).catch(() => {}); };
          await fill('#f-name', leadName);
          await fill('#f-phone', leadPhone);
          await fill('#f-street', '19 Truck Wrap Way');
          await fill('#f-city', 'Wichita');
          await fill('#f-state', 'KS');
          await fill('#f-zip', '67202');
          await fill('#f-notes', 'E2E QR flow, saw the truck wrap');
          await ip.locator('#submit-btn').click({ timeout: 8000 }).catch(() => {});
          confirmed = await ip.waitForFunction(() => {
            const f = document.getElementById('pg-form');
            return !f || f.offsetParent === null || getComputedStyle(f).display === 'none';
          }, null, { timeout: 12000 }).then(() => true).catch(() => false);
          got = `redirectOk=${redirectOk} confirmed=${confirmed} url=${ip.url()}`;
        } finally {
          await ctx.close().catch(() => {});
        }
        visitorResult = { confirmed, redirectOk, got };
        // name+phone+street+city+state+zip+notes+submit, honest per-field cost
        return leadName.length + leadPhone.length + 16 + 7 + 2 + 5 + 30 + 1;
      },
      rule: async () => ({ ok: visitorResult.redirectOk && visitorResult.confirmed, got: visitorResult.got }),
    });

    // ── The scan + form_opened + submitted events must all be logged
    // server-side (service-role only, a scanner's own browser cannot forge
    // these), and the inbound lead must carry the resolved LABEL as its
    // source, not the generic 'qr_form' fallback. ──
    let leadRow = null;
    await step(page, {
      label: 'scan/open/submit events logged, lead carries the resolved label', page: 'pg-leads', role: 'contractor',
      suspect: 'supabase/functions/log-qr-event + intake.html _qrLabel resolution',
      ruleText: 'qr_events must have scan+form_opened+submitted for this source, and inbound_leads.source must be the QR label',
      expected: `3 event types logged for ${sourceId}, inbound_leads.source="${qrLabel}"`,
      act: async (p) => {
        let events = [], lead = null;
        for (let i = 0; i < 6; i++) {
          const res = await p.evaluate(async ({ sourceId, acctId, leadName }) => {
            const { data: ev } = await _supa.from('qr_events').select('event').eq('qr_source_id', sourceId);
            const { data: leads } = await _supa.from('inbound_leads').select('id,name,source,phone').eq('account_id', acctId);
            return { ev: ev || [], lead: (leads || []).find(r => r.name === leadName) || null };
          }, { sourceId, acctId, leadName });
          events = res.ev; lead = res.lead;
          if (lead && new Set(events.map(e => e.event)).size >= 3) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        leadRow = lead;
        p.__qrCheck = { types: [...new Set(events.map(e => e.event))].sort(), lead };
        return 0; // pure verification, no new interaction
      },
      rule: async (p) => {
        const r = p.__qrCheck || {};
        const hasAll = ['form_opened', 'scan', 'submitted'].every(e => r.types?.includes(e));
        const labelOk = r.lead && r.lead.source === qrLabel;
        return { ok: hasAll && labelOk, got: JSON.stringify(r) };
      },
    });

    // ── Contractor promotes the lead: real tap on "Add to pipeline" for
    // THIS specific row (not a shortcut function call — the exact button a
    // real owner would tap, targeted precisely since accumulated seed data
    // from prior runs means other pending leads are legitimately on screen too). ──
    test.skip(!leadRow, 'lead never landed in inbound_leads, cannot promote it');
    await step(page, {
      label: 'contractor promotes the lead, source carries through as the client source', page: 'pg-leads', role: 'contractor',
      suspect: 'cloud.js _promoteInbound',
      ruleText: 'promoting the inbound lead must create a client whose source is the QR label, not "QR form"',
      expected: `a client named "${leadName}" with source "${qrLabel}"`,
      act: async (p) => {
        await p.evaluate(() => { if (typeof _loadPendingInbound === 'function') return _loadPendingInbound(); });
        await p.waitForFunction((id) => {
          return typeof _pendingInbound !== 'undefined' && _pendingInbound.some(r => r.id === id);
        }, leadRow.id, { timeout: 15000 }).catch(() => {});
        await p.evaluate(() => { if (document.querySelector('.pg.active')?.id !== 'pg-leads') renderLeadsPage(); });
        return await tap(p, `button[onclick="_promoteInbound('${leadRow.id}')"]`);
      },
      rule: async (p) => {
        const found = await p.evaluate(async (name) => {
          for (let i = 0; i < 6; i++) {
            const c = clients.find(x => x.name === name);
            if (c) return c;
            await new Promise(r => setTimeout(r, 1000));
          }
          return null;
        }, leadName);
        return { ok: !!found && found.source === qrLabel, got: JSON.stringify(found) };
      },
    });

    // ── Contractor logs what this code cost — ties directly into the
    // existing marketing-expense ROI table (dashboard.js renderLeadSources),
    // not a parallel system. ──
    const costAmount = '47.50';
    await step(page, {
      label: 'contractor logs the QR source\'s cost', page: 'pg-qr-leads', role: 'contractor',
      suspect: 'qr-leads.js _qrLogCost + finance.js expSave',
      ruleText: 'logging a cost from the QR card must save a marketing expense tagged with this source\'s label',
      expected: `td_expenses has a marketing expense, lead_source="${qrLabel}", amount=${costAmount}`,
      act: async (p) => {
        let n = 0;
        const leadsNav = await p.evaluate(() =>
          (document.getElementById('mtb-leads')?.offsetWidth > 0) ? '#mtb-leads' : '#nb-leads');
        n += await tap(p, leadsNav);
        await p.waitForSelector('#pg-leads.active', { state: 'attached', timeout: 8000 });
        n += await tap(p, '#pg-leads .tbar-r button:has-text("Get leads")');
        await p.waitForSelector('.zmodal-overlay', { state: 'visible', timeout: 8000 });
        n += await tap(p, '.zmodal-overlay button:has-text("Get QR codes")');
        await p.waitForSelector('#pg-qr-leads.active', { state: 'attached', timeout: 8000 });
        await p.evaluate(() => _qrLoadSources());
        await p.waitForSelector(`button[onclick="_qrLogCost('${sourceId}')"]`, { timeout: 10000 });
        n += await tap(p, `button[onclick="_qrLogCost('${sourceId}')"]`);
        await p.waitForSelector('#expense-modal', { state: 'visible', timeout: 8000 });
        n += await type(p, '#em-amount', costAmount);
        n += await tap(p, '#exp-save-btn');
        return n;
      },
      rule: async (p) => {
        let row = null;
        for (let i = 0; i < 6; i++) {
          const rows = await cloudRows(p, 'td_expenses');
          row = rows.find(e => e.cat === 'marketing' && e.lead_source === qrLabel);
          if (row) break;
          await new Promise(r => setTimeout(r, 1500));
        }
        return { ok: !!row && Number(row.amount) === Number(costAmount), got: JSON.stringify(row) };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
