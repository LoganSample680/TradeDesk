// @ts-check
// Config for the LIVE-Supabase flow tests under tests/flow. These authenticate
// against the real project and write real rows, so they run via their own
// workflow (.github/workflows/flow-tests.yml) — NEVER inside the fast offline
// shards (the main playwright.config.js excludes tests/flow via testIgnore).
const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/flow',
  fullyParallel: false,
  forbidOnly: isCI,
  // One retry here: these tests touch the network and a real cloud backend, so a
  // transient blip is not the same as a logic failure. The adversarial specs
  // still assert exact post-conditions, so a real bug fails on the retry too.
  retries: isCI ? 1 : 0,
  // Serial: the suite shares one dev account and seeds/cleans real data; parallel
  // workers would race on the same rows.
  workers: 1,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  timeout: 120000,
  expect: { timeout: 15000 },

  use: {
    // The app reaches Supabase through SUPA_URL = location.origin + '/api'
    // (cloud.js), an /api reverse-proxy that ONLY exists on a deployed site —
    // a local `serve` returns index.html for /api and breaks auth. So the live
    // flow tests run against the real deployment where the account exists.
    // Override with E2E_BASE_URL (e.g. the branch-preview URL) when needed.
    baseURL: process.env.E2E_BASE_URL || 'https://tradedeskpro.app',
    // Sent on every request (navigation + the app's /api XHR/fetch) so a
    // Cloudflare WAF rule can skip the bot challenge for CI traffic only.
    // Pair with a Cloudflare custom rule: when http.request.headers["x-e2e-bypass"]
    // equals this secret -> Skip (Bot Fight Mode + managed challenge).
    extraHTTPHeaders: process.env.E2E_BYPASS_SECRET
      ? { 'X-E2E-Bypass': process.env.E2E_BYPASS_SECRET }
      : {},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    viewport: { width: 390, height: 844 },
    bypassCSP: true,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  // No local webServer — baseURL is a remote deployment.
});
