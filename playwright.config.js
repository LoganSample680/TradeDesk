// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests',
  // fullyParallel: false keeps tests within each describe block sequential
  // (they often share page state). Workers still run DIFFERENT describe blocks
  // in parallel — safe because each worker gets its own browser context.
  fullyParallel: false,
  forbidOnly: isCI,

  // retries: 2 in CI means:
  //   - 3 total attempts per test
  //   - Passes on retry → marked FLAKY in report (not a hard failure)
  //   - Fails all 3 → hard FAILED
  // This surfaces flaky tests without blocking the whole suite.
  retries: isCI ? 2 : 0,

  // CI: 4 workers — Playwright tests are I/O-bound (waiting for browser events,
  // not burning CPU), so 4 workers run efficiently on a 2-vCPU GitHub Actions
  // runner. With 2 browser projects (webkit + chromium), this gives 2 workers
  // per browser instead of 1, halving per-browser time within each shard.
  // Combined with the 4-shard matrix in test.yml the effective parallelism is
  // 4 shards × 4 workers = 16 streams → target ~1 min wall time.
  workers: isCI ? 4 : 1,

  // In CI: github reporter annotates failures inline on the PR diff.
  // html report is always uploaded as an artifact so failures AND flaky
  // tests are browsable after every run.
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  timeout: 60000,
  expect: { timeout: 10000 },

  use: {
    baseURL: 'http://localhost:8899',

    // Capture a trace on first retry — opens as a zip in the Playwright
    // report and lets you step through every network request, DOM state,
    // and screenshot at the moment of failure.
    trace: 'on-first-retry',

    // Screenshot on failure for quick visual triage.
    screenshot: 'only-on-failure',

    // Video on first retry — pairs with trace for flaky tests.
    video: 'on-first-retry',

    viewport: { width: 390, height: 844 },
    bypassCSP: true,
    offline: false,
  },

  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 14'],
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],

  webServer: {
    command: 'npx serve . -p 8899 -s --no-clipboard',
    port: 8899,
    reuseExistingServer: !isCI,
    timeout: 30000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
