// @ts-check
// Config for the PREVIEW DEPLOY SMOKE (tests/preview-smoke). Runs against the ACTUAL
// Cloudflare deployment (PREVIEW_URL) after a build, NOT localhost — it exists to catch
// deploy/environment issues (stale-cache version mismatch, the real /api worker, MapKit's
// domain-locked token) that the off-Cloudflare flow gate can't see. Deliberately tiny.
//
// No globalSetup: this is the real deployed app + its real Supabase, so there is no
// local-stack provisioning to do (that lives in the flow config).
const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/preview-smoke',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,            // a deploy smoke must pass on the first attempt (no masking)
  workers: 1,
  reporter: isCI
    ? [['github'], ['list'], ['json', { outputFile: 'preview-smoke-results.json' }]]
    : [['list']],
  timeout: 60000,
  expect: { timeout: 15000 },

  use: {
    // The deployed URL to smoke. The workflow sets PREVIEW_URL to the deployment that
    // just went live; falls back to E2E_BASE_URL, then production.
    baseURL: process.env.PREVIEW_URL || process.env.E2E_BASE_URL || 'https://tradedeskpro.app',
    // CI-only WAF bypass header (no-op when the secret is unset), same as the flow config.
    extraHTTPHeaders: process.env.E2E_BYPASS_SECRET
      ? { 'X-E2E-Bypass': process.env.E2E_BYPASS_SECRET }
      : {},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    bypassCSP: true,
  },

  // iPhone first — contractors are on iPhones and it's the MapKit/iOS WebKit path that
  // matters most; Chromium second for breadth. Two projects × 4 small tests is still
  // only dozens of requests.
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
  ],
});
