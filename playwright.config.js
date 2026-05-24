// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60000,
  expect: { timeout: 10000 },

  use: {
    baseURL: 'http://localhost:8899',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 },
    // bypassCSP so inline scripts in the app don't get blocked
    bypassCSP: true,
    // All external routes are mocked per-test; no real network needed
    offline: false,
  },

  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 14'],
        // WebKit is the primary target (Safari engine)
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
    // `serve` ships static files; -s enables SPA fallback (serve index.html for unknown routes)
    command: 'npx serve . -p 8899 -s --no-clipboard',
    port: 8899,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
