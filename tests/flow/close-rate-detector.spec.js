// Regression guard for the Lead-Sources CLOSE% calc (a bug that WAS here, now fixed).
//
// dashboard.js once computed close% as won/(won+lost), excluding pending leads from
// the denominator — a source with 4 leads / 2 won / 0 lost / 2 pending rendered
// 100% (2/2) while only half the leads actually closed. The fix made it won/leads
// (dashboard.js:1301). This asserts the SHOWN close% equals won/leads of the row it
// sits next to — it now PASSES, and guards the calc from regressing back. Runs in
// the non-blocking flow job.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, finding } = require('./live-helpers');

test.describe('dashboard lead-sources — CLOSE% consistency (bug detector)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { await signIn(page); });

  test('CLOSE% must equal won/leads of the row it is shown next to', async ({ page }) => {
    const r = await page.evaluate(() => {
      const SRC = 'E2E CloseRate Detector';
      // Clean any prior detector rows.
      const detIds = clients.filter(c => c.source === SRC).map(c => c.id);
      if (detIds.length) {
        clients = clients.filter(c => c.source !== SRC);
        bids = bids.filter(b => !detIds.has?.(b.client_id) && !detIds.includes(b.client_id));
      }
      // Seed: 4 leads from this source — 2 WON, 2 still pending (no decided bid).
      const mk = (n) => ({ id: 950000 + n, name: SRC + ' ' + n, source: SRC, phone: '3165550000', notes: '__E2E_DET__' });
      for (let n = 1; n <= 4; n++) clients.push(mk(n));
      // 2 won bids → won=2; the other two clients have no bid → pending, not lost.
      bids.push({ id: 951001, client_id: 950001, client_name: SRC + ' 1', amount: 5000, status: 'Closed Won', draft: false });
      bids.push({ id: 951002, client_id: 950002, client_name: SRC + ' 2', amount: 4000, status: 'Closed Won', draft: false });

      try { window._leadSrcExpanded = true; renderLeadSources(); } catch (e) { return { ok: false, err: e.message }; }

      const el = document.getElementById('dash-sources');
      const txt = el ? el.innerText : '';
      // Find the detector row's close% (first NN% after the source label).
      const m = txt.match(new RegExp(SRC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,60}?(\\d+)%'));
      const shown = m ? parseInt(m[1], 10) : null;

      // NO cleanup of the seeded rows (CLAUDE.md §13.7) — this test renders in memory
      // only and never persists to Supabase, and signIn reloads the page before the
      // next test, so the in-memory seed is harmless. Only reset the expand toggle.
      delete window._leadSrcExpanded;

      return { ok: true, leads: 4, won: 2, shown, expected: Math.round(2 / 4 * 100) };
    });

    expect(r.ok, `renderLeadSources threw: ${r.err}`).toBe(true);
    expect(r.shown, 'detector row close% was not found in #dash-sources').not.toBeNull();
    expect(r.shown, finding({
      page: 'pg-dash · Lead sources', control: 'CLOSE% cell',
      rule: 'close% must equal won/leads for the row it sits next to',
      expected: r.expected + '% (won 2 / leads 4)', got: r.shown + '%',
      suspect: 'dashboard.js:1301-1302 — decided=won+lost excludes pending leads, inflating close%',
    })).toBe(r.expected);
  });
});
