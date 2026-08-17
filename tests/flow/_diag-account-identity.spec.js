// READ-ONLY diagnostic (owner ask 2026-08-17): confirm whose account the
// promoted DEV2 test login (tradedeskprosupport@gmail.com) actually writes
// to. Every live spec tonight showed _isEmployee:true and a "DEV A" business
// name in the topbar, which only happens if this login is a crew member of
// SOME employer account, not its own independent business. If that employer
// is the owner's real logansample97@gmail.com account, every write this
// login makes (regardless of which email is logged in) lands there via
// contractor_user_id, which is how test data could appear on the personal
// account even after its own credentials were removed.
//
// NO WRITES. NO saveAll(). NO teardown. Signs in, reads state, reports,
// closes. Nothing here can mutate any account's data.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn } = require('./live-helpers');

test.describe('Diagnostic: whose account does the test login actually write to', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test('read-only identity report, no data touched', async ({ page }) => {
    await signIn(page);
    // Give the cloud settings load a moment to settle so S.bname etc. are real,
    // not the pre-load defaults.
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => ({
      loginEmail: (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.email : null,
      loginUserId: (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null,
      isEmployee: typeof _isEmployee !== 'undefined' ? _isEmployee : null,
      contractorUserId: typeof _contractorUserId !== 'undefined' ? _contractorUserId : null,
      employeeRecordName: (typeof _employeeRecord !== 'undefined' && _employeeRecord) ? (_employeeRecord.name || null) : null,
      businessName: (typeof S !== 'undefined' && S) ? (S.bname || null) : null,
      businessPhone: (typeof S !== 'undefined' && S) ? (S.bphone || null) : null,
      businessEmail: (typeof S !== 'undefined' && S) ? (S.bemail || null) : null,
    }));
    console.log('ACCOUNT_IDENTITY_REPORT ' + JSON.stringify(info, null, 2));
    // Not a real assertion, just keeps the test from being flagged empty.
    expect(info.loginEmail).toBeTruthy();
  });
});
