// REAL flow — the page crawler (task #13 core, the broad "agentic dickhead"
// sweep). After signing into the live account it discovers EVERY .pg view in the
// DOM and navigates to each one through the real goPg() router, twice in rapid
// succession (to stress the per-page render race guards), asserting that every
// page:
//   1. actually becomes the active view (goPg routed correctly), and
//   2. produced ZERO console errors while rendering live data.
//
// It is deliberately NON-destructive: it only navigates, never clicks buttons,
// so it is safe to run against the real account every time. A page that throws
// while rendering real data — the single most common prod regression — fails here
// with the exact page id, no repro needed.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, finding } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'crawler/every-page';

// Benign console noise from third-party CDNs / mocked-absent network. Mirrors the
// offline assertNoErrors() filter so the crawler only ever fails on REAL app bugs.
const BENIGN = [
  'favicon', 'net::ERR', 'ERR_CONNECTION', 'Failed to load resource', 'apple-mapkit',
  'cdn.apple-mapkit', 'js.stripe.com', 'cdn.jsdelivr', 'AggregateError', 'JSON Parse error',
  'Unhandled Promise Rejection', 'mapkit', '401', '403',
];
function realError(text) { return !BENIGN.some(b => text.includes(b)); }

test.describe('page crawler — every view renders clean (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('navigate to every .pg view (twice each) with zero console errors', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && realError(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => { if (realError(String(e))) errors.push('pageerror: ' + e.message); });

    // Discover every page id the app actually ships, in DOM order.
    const pages = await page.evaluate(() =>
      [...document.querySelectorAll('.pg')].map(el => el.id).filter(Boolean)
    );
    expect(pages.length, 'expected the app to expose .pg views').toBeGreaterThan(5);

    for (const pid of pages) {
      await step(page, {
        label: `navigate → ${pid}`, page: pid, role: 'contractor',
        suspect: `whichever render fn ${pid} calls in goPg()`,
        ruleText: 'navigating to the page must activate it AND log no console errors',
        expected: `#${pid}.active and zero new console errors`,
        act: async (p) => {
          const before = errors.length;
          // Double-navigate fast: first hop away, then two hops to the target in
          // the same tick — exercises the render race guard a real fast-tapper hits.
          await p.evaluate((id) => { goPg('pg-dash'); goPg(id); goPg(id); }, pid);
          await p.waitForTimeout(250);
          p.__errDelta = errors.length - before;
          return 2; // two real taps on the target
        },
        rule: async (p) => {
          const active = await p.evaluate((id) => {
            const el = document.getElementById(id);
            return !!el && el.classList.contains('active');
          }, pid);
          const errDelta = p.__errDelta || 0;
          const newErrs = errDelta > 0 ? errors.slice(-errDelta) : [];
          return { ok: active && errDelta === 0, got: `active=${active} newErrors=${errDelta} ${newErrs.slice(0, 2).join(' | ')}` };
        },
      });
    }

    // Land back on the dashboard so the session is left in a normal state.
    await page.evaluate(() => goPg('pg-dash'));

    const rep = report(FLOW, BASELINE);
    expect(errors, finding({
      page: 'crawler', control: 'console', rule: 'no page may log a console error while rendering live data',
      expected: 'zero console errors across all pages', got: errors.length + ' error(s): ' + errors.slice(0, 5).join(' || '),
    })).toEqual([]);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
