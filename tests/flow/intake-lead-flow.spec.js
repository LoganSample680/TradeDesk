// REAL flow — the public lead-intake funnel (task #30). The QR/intake page
// (intake.html?a=<account_id>) is how a brand-new prospect reaches a contractor.
// A real public visitor (a fully isolated anon context, NO contractor session)
// fills the form and submits; intake.html inserts into the inbound_leads table for
// that account_id. We then assert — on the contractor's authenticated session —
// that the lead actually landed in inbound_leads (the same table _loadPendingInbound
// reads to show the inbound inbox). End-to-end across the public→contractor seam.
//
// Seed lead is left in the account per CLAUDE.md §13.7.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, scopeBypassHeader } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'intake/public-lead';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';

test.describe('public intake lead funnel (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a public visitor submits the intake form and the lead reaches the contractor', async ({ page, browser }) => {
    test.setTimeout(120000);
    // The contractor's accounts.id is the ACCOUNT_ID the intake URL needs.
    const acctId = await page.evaluate(() => (typeof _account !== 'undefined' && _account ? _account.id : null));
    test.skip(!acctId, 'dev account has no accounts row — cannot drive intake');

    const leadName = `E2E Intake Lead ${process.pid}`;
    const leadPhone = '3165550' + String(process.pid % 1000).padStart(3, '0');
    let submitted = {};

    // ── A real public visitor (isolated anon context) fills + submits the form. ──
    await step(page, {
      label: 'public visitor submits the intake form', page: 'intake.html', role: 'client',
      suspect: 'intake.html submitForm (insert into inbound_leads)',
      ruleText: 'submitting the public intake form must show the confirmation (the insert succeeded)',
      expected: 'confirmation screen shown (#pg-form hidden)',
      act: async () => {
        const ctx = await browser.newContext({ baseURL: BASE, bypassCSP: true });
        await scopeBypassHeader(ctx, BASE);
        const ip = await ctx.newPage();
        let confirmed = false, got = '';
        try {
          await ip.goto(`/intake.html?a=${acctId}&cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await ip.waitForSelector('#f-name', { timeout: 15000 });
          const fill = async (sel, val) => { await ip.locator(sel).click({ timeout: 8000 }).catch(() => {}); await ip.locator(sel).pressSequentially(val, { delay: 0 }).catch(() => {}); };
          await fill('#f-name', leadName);
          await fill('#f-phone', leadPhone);
          await fill('#f-street', '742 Evergreen Terrace');
          await fill('#f-city', 'Wichita');
          await fill('#f-state', 'KS');
          await fill('#f-zip', '67202');
          await fill('#f-notes', 'E2E intake — exterior repaint quote please');
          await ip.locator('#submit-btn').click({ timeout: 8000 }).catch(() => {});
          // showConfirm() hides #pg-form on success.
          confirmed = await ip.waitForFunction(() => {
            const f = document.getElementById('pg-form');
            return !f || f.offsetParent === null || getComputedStyle(f).display === 'none';
          }, null, { timeout: 12000 }).then(() => true).catch(() => false);
          const errVisible = await ip.locator('#form-err').isVisible().catch(() => false);
          got = `confirmed=${confirmed} errVisible=${errVisible}`;
        } finally {
          await ctx.close().catch(() => {});
        }
        submitted = { confirmed, got };
        // name(len)+phone(10)+street(20)+city(7)+state(2)+zip(5)+notes(40)+submit(1)
        return leadName.length + 10 + 20 + 7 + 2 + 5 + 40 + 1;
      },
      rule: async () => ({ ok: submitted.confirmed, got: submitted.got }),
    });

    // ── The contractor's session must see the lead in inbound_leads. ──
    await step(page, {
      label: 'lead lands in the contractor inbound inbox', page: 'pg-leads', role: 'contractor',
      suspect: 'cloud.js _loadPendingInbound (inbound_leads select by account_id)',
      ruleText: 'the submitted lead must exist in inbound_leads for this account (status pending)',
      expected: `inbound_leads has "${leadName}" with the submitted phone`,
      act: async (p) => {
        // Re-query inbound_leads as the contractor (RLS allows the account owner).
        const found = await p.evaluate(async ({ acctId, leadName }) => {
          for (let i = 0; i < 6; i++) {
            try {
              const { data } = await _supa.from('inbound_leads').select('id,name,phone,status,account_id').eq('account_id', acctId);
              const row = (data || []).find(r => r.name === leadName);
              if (row) return { has: true, phone: row.phone, status: row.status };
            } catch (e) { /* retry */ }
            await new Promise(r => setTimeout(r, 1500));
          }
          return { has: false };
        }, { acctId, leadName });
        p.__lead = found;
        return 0; // pure verification of the public submission's persistence
      },
      rule: async (p) => {
        const r = p.__lead || {};
        return { ok: !!r.has && r.phone === leadPhone, got: JSON.stringify(r) };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
