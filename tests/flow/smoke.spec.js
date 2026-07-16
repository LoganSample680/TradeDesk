// Harness smoke test, validates sign-in, the dev-account guard, and teardown
// against the live Supabase project. Skips cleanly when secrets are absent so
// this file is safe to run anywhere (it just no-ops without creds).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, shouldTeardown, signIn, assertDevAccount, teardownAll, DEV_USER_ID, workerAccount } = require('./live-helpers');

test.describe('flow harness, smoke', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test('signs in as the dev account and the teardown guard accepts it', async ({ page }) => {
    await signIn(page);
    const id = await assertDevAccount(page);
    // Assert against the account actually signed into, the per-worker cloud account
    // (DEV/DEV2) OR, in local-stack mode, the fresh account global-setup provisioned for
    // this worker. Hardcoding DEV_USER_ID broke on DEV2 and on the local stack.
    // (assertDevAccount already enforces this identity; this is the explicit echo of it.)
    expect(id).toBe(workerAccount()?.uid || DEV_USER_ID);
    // Default is keep-data so you can review what the suite created. Teardown
    // only runs (and only as a clean no-op here) when E2E_TEARDOWN=1.
    if (shouldTeardown()) await teardownAll(page);
  });
});
