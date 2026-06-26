// Adversarial flow spec — 50-state legal correctness, ONE test per state.
//
// The proposal Terms & Conditions inject the lien notice and cancellation
// citation verbatim:
//   • clause 6 "Mechanic's Lien Notice" = _lienNotice(state, party)   proposals.js:1284
//   • cancellation citation             = _cancelCitation(state)      proposals.js:1319
// Both pull from STATE_LIEN / STATE_CANCEL. Each state is its own test() so the
// suite shows 50 granular results and a failure names the exact state.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, finding } = require('./live-helpers');

const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

test.describe('legal — 50-state lien + cancellation statutes in proposal T&C', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  let page;
  let results = {};

  test.beforeAll(async ({ browser }) => {
    // Sign in ONCE and precompute every state's strings — the per-state tests
    // below are then cheap assertions against this map. Manual context so the
    // baseURL + Cloudflare-bypass header from the config are applied here too.
    const ctx = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL || 'https://tradedeskpro.app',
      extraHTTPHeaders: process.env.E2E_BYPASS_SECRET ? { 'X-E2E-Bypass': process.env.E2E_BYPASS_SECRET } : {},
      bypassCSP: true,
      viewport: { width: 390, height: 844 },
    });
    page = await ctx.newPage();
    await signIn(page);
    results = await page.evaluate((states) => {
      const map = {};
      states.forEach(st => {
        const lienData = (typeof STATE_LIEN !== 'undefined') ? STATE_LIEN[st] : null;
        const cancelData = (typeof STATE_CANCEL !== 'undefined') ? STATE_CANCEL[st] : null;
        let lienNote = '', cancelCite = '';
        try { lienNote = (typeof _lienNotice === 'function') ? _lienNotice(st, 'Acme Painting Co') : ''; } catch (e) { lienNote = 'ERR:' + e.message; }
        try { cancelCite = (typeof _cancelCitation === 'function') ? _cancelCitation(st) : ''; } catch (e) { cancelCite = 'ERR:' + e.message; }
        map[st] = {
          lienStatute: lienData ? lienData.statute : null,
          cancelStatute: cancelData ? cancelData.statute : null,
          lienNoteHasStatute: !!(lienData && lienNote.includes(lienData.statute)),
          lienGeneric: lienNote.includes("applicable mechanic's lien statutes"),
          cancelCite,
          cancelExact: !!(cancelData && cancelCite === cancelData.statute),
          cancelFederal: cancelCite.includes('16 CFR'),
        };
      });
      return map;
    }, STATES);
  });

  test.afterAll(async () => { if (page) await page.context().close(); });

  for (const st of STATES) {
    test(`${st} — exact lien + cancellation statute carries into T&C`, async () => {
      const r = results[st];
      expect(r, `no result computed for ${st}`).toBeTruthy();
      expect(r.lienStatute, finding({ page: 'proposal T&C', control: `STATE_LIEN[${st}]`, rule: 'state must define a lien statute', expected: 'statute string', got: String(r.lienStatute), suspect: 'legal.js STATE_LIEN' })).toBeTruthy();
      expect(r.cancelStatute, finding({ page: 'proposal T&C', control: `STATE_CANCEL[${st}]`, rule: 'state must define a cancellation statute', expected: 'statute string', got: String(r.cancelStatute), suspect: 'legal.js STATE_CANCEL' })).toBeTruthy();
      expect(r.lienNoteHasStatute, finding({ page: 'proposal T&C', control: `_lienNotice(${st})`, rule: "clause 6 cites the state's exact lien statute", expected: `contains "${r.lienStatute}"`, got: r.lienGeneric ? 'generic fallback' : 'statute missing', suspect: 'legal.js:_lienNotice / proposals.js:1284' })).toBe(true);
      expect(r.lienGeneric, finding({ page: 'proposal T&C', control: `_lienNotice(${st})`, rule: 'no generic lien fallback', expected: 'state-specific', got: 'generic', suspect: 'legal.js STATE_LIEN' })).toBe(false);
      expect(r.cancelExact, finding({ page: 'proposal T&C', control: `_cancelCitation(${st})`, rule: "cancellation cites the state's exact statute", expected: r.cancelStatute, got: r.cancelCite, suspect: 'legal.js:_cancelCitation / proposals.js:1319' })).toBe(true);
      expect(r.cancelFederal, finding({ page: 'proposal T&C', control: `_cancelCitation(${st})`, rule: 'no federal 16 CFR fallback', expected: 'state statute', got: '16 CFR', suspect: 'legal.js STATE_CANCEL' })).toBe(false);
    });
  }
});
