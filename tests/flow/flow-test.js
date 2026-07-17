// ─────────────────────────────────────────────────────────────────────────────
// Drop-in replacement for `require('@playwright/test')` across every tests/flow
// spec. Overrides the built-in `context` fixture (which `page` is built on top
// of, so this covers both) to scope the CI-only Cloudflare WAF bypass header to
// the app's OWN origin, see scopeBypassHeader() in live-helpers.js for why a
// blanket context-wide header broke fonts/analytics/Stripe/Supabase calls.
//
// Every other flow-test behavior (baseURL, timeouts, projects, etc.) is
// unchanged: only where the bypass header gets attached moves from
// playwright.flow.config.js's `use.extraHTTPHeaders` to here.
// ─────────────────────────────────────────────────────────────────────────────
const base = require('@playwright/test');
const { scopeBypassHeader } = require('./live-helpers');

const test = base.test.extend({
  context: async ({ context, baseURL }, use) => {
    await scopeBypassHeader(context, baseURL);
    await use(context);
  },
});

module.exports = { ...base, test };
