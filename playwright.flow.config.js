// @ts-check
// Config for the LIVE-Supabase flow tests under tests/flow. These authenticate
// against the real project and write real rows, so they run via their own
// workflow (.github/workflows/flow-tests.yml) — NEVER inside the fast offline
// shards (the main playwright.config.js excludes tests/flow via testIgnore).
const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/flow',
  // PARALLEL on one shared dev login — safe because every flow test writes
  // uniquely-tagged rows (Date.now ids) and the cloud save is a row-level upsert
  // by id, so concurrent workers touch different rows and can't clobber each
  // other; soft-deletes are scoped per-worker; the one global sweep (scenarios)
  // is scoped to its own runTag. This is what gets the growing suite under a few
  // minutes instead of ~20 serial.
  fullyParallel: true,
  forbidOnly: isCI,
  // No retries on the live suite: it's non-blocking, and a retry DOUBLES the cost
  // of every hung test (120s→240s) for no gating benefit — the prime driver of the
  // suite's wall-clock. A real transient blip just shows as a single red in a
  // non-gating job; we'd rather have a fast suite than auto-retry hangs.
  retries: 0,
  // PARALLEL (4 in CI). History: dropped 4→2→1 chasing "cloud ABSENT" failures that I
  // wrongly blamed on a parallel soft-delete clobber. The evidence disproved it — the
  // SERIAL run still had the same 33 failures; the real cause was async-flush READ
  // TIMING (the rule read before _flushSaveNow landed), now fixed by step()'s poll in
  // live-helpers.js. And the original reason workers were lowered (the /api proxy
  // saturating under load) is gone too: direct-Supabase is the default now, so workers
  // hit Supabase directly with no proxy bottleneck. Serial bought only slowness
  // (~30min/190 tests). Parallel + step-poll = fast AND correct.
  // 3 in CI: 4 workers all booting the app (each a full sign-in + cloud load) against
  // one local server + one shared dev project created enough contention that slow boots
  // left inputs "resolved to hidden" past the waits. 3 keeps most of the ~3× speedup
  // with materially less boot contention. (Paired with the local-server pinning proxy
  // mode so no per-boot direct probe.)
  workers: isCI ? 3 : 1,
  // CI emits a JSON report (machine-readable failure dump) + an HTML report dir
  // (uploaded as an artifact) so a red run is never a black box — the json carries
  // every test's error text + the finding() ticket, the html is browsable offline.
  reporter: isCI
    ? [['github'], ['list'], ['json', { outputFile: 'flow-results.json' }], ['html', { open: 'never' }]]
    : [['list']],
  // 90s per WHOLE test: multi-save flows (seed-save + several steps + cleanup-save)
  // need headroom because each supaSaveToCloud writes the full account, which is
  // slower as the shared dev account accumulates E2E rows. 45s was too aggressive
  // and timed those flows out at the cleanup. Parallelism (not this ceiling) drives
  // wall-clock, so fast tests still finish fast — this is only a safety cap.
  timeout: 90000,
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
