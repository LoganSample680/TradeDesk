// @ts-check
/**
 * E2E tests — client hub Documents upgrades:
 *
 * 1. Signed Agreement row shows signer name + date/time (from bid fields the
 *    sig-check populates out of signed_proposals).
 * 2. EPA Renovate Right Disclosure appears as its own document row with the
 *    acknowledgement signature metadata (doc 2 of the unified signing flow).
 * 3. Notice of Cancellation is e-signable while the rescission window is open:
 *    typed-name input + submit button, short-name guard, and the submitted
 *    (cancelled) state once cancelled_at is set.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
        FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

function hubWith(bidExtra = {}, hubExtra = {}) {
  return {
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Zach Pro Painting',
    clientName: 'Logan Sample',
    clientToken: FAKE_TOKEN,
    epaRequired: true,
    bids: [{
      id: FAKE_BID_ID_1,
      type: 'Interior Painting',
      amount: 5000,
      deposit: 1250,
      balance: 3750,
      status: 'Closed Won',
      bid_date: new Date().toISOString().slice(0, 10),
      signedAt: new Date().toISOString(),
      signerName: 'Logan Sample',
      proposalKey: `proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_tok.json`,
      ...bidExtra,
    }],
    jobs: [],
    payments: [],
    ...hubExtra,
  };
}

async function bootHub(page, hub) {
  await page.addInitScript(d => { window.__mockHubData = d; }, hub);
  await mockAllExternal(page);
  await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

test.describe('Hub Documents — signature metadata + EPA disclosure doc', () => {
  test('client.html defines escHtml — signature block renders without ReferenceError', async ({ page }) => {
    // openProposal's signature block calls escHtml(); client.html historically only
    // defined esc(). The ReferenceError surfaced as "Could not load proposal" on
    // every SIGNED proposal (unsigned ones skip the block).
    await bootHub(page, hubWith());
    const fnType = await page.evaluate(() => typeof escHtml);
    expect(fnType, 'escHtml must be defined in client.html').toBe('function');
    assertNoErrors(page, 'escHtml alias present');
  });

  test('signed agreement row shows signer name and date/time', async ({ page }) => {
    await bootHub(page, hubWith());
    const txt = await page.textContent('#view-documents');
    expect(txt, 'agreement row must show who signed').toContain('Signed by Logan Sample');
    assertNoErrors(page, 'documents signature meta');
  });

  test('EPA Renovate Right Disclosure appears as doc 2 with acknowledgement signature', async ({ page }) => {
    await bootHub(page, hubWith({ epaAckAt: new Date().toISOString() }));
    const txt = await page.textContent('#view-documents');
    expect(txt).toContain('EPA Renovate Right Disclosure');
    expect(txt, 'EPA doc must show acknowledgement signature').toContain('Acknowledged by Logan Sample');
    assertNoErrors(page, 'documents EPA doc row');
  });

  test('document count includes the EPA disclosure', async ({ page }) => {
    await bootHub(page, hubWith({ epaAckAt: new Date().toISOString() }));
    // invoice + agreement + EPA = 3 docs
    const txt = await page.textContent('#view-documents');
    expect(txt).toContain('3 docs');
    assertNoErrors(page, 'documents EPA doc count');
  });

  test('EPA doc opens as a signed acknowledgment with signature image + date/time', async ({ page }) => {
    const SIG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await bootHub(page, hubWith({ epaAckAt: new Date().toISOString(), signatureData: SIG_PNG, rrpFirmCert: 'NAT-12345-1', rrpRenovatorName: 'Zach Painter' }));
    await page.evaluate(id => _showEpaDoc(id), FAKE_BID_ID_1);
    const ov = page.locator('#epa-doc-ov');
    await expect(ov).toBeVisible();
    const body = await ov.textContent();
    expect(body).toContain('Confirmation of Receipt');
    expect(body).toContain('Logan Sample');           // signed by
    expect(body).toContain('NAT-12345-1');            // firm cert
    expect(body).toContain('Zach Painter');           // renovator
    // The actual drawn signature image renders
    const imgCount = await ov.locator('img[alt="Client signature"]').count();
    expect(imgCount, 'signature image must render in EPA doc').toBe(1);
    assertNoErrors(page, 'EPA doc signed acknowledgment');
  });
});

test.describe('Notice of Cancellation — e-sign flow', () => {
  test('cancellation form has typed-name signature input while window open', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    await expect(page.locator('#cancel-sig-name')).toBeVisible();
    await expect(page.locator('#cancel-submit-btn')).toBeVisible();
    assertNoErrors(page, 'cancel form e-signable');
  });

  test('short name is rejected with a clear error', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    await page.fill('#cancel-sig-name', 'ab');
    await page.click('#cancel-submit-btn');
    const err = await page.textContent('#cancel-err');
    expect(err, 'must ask for full name').toContain('full name');
    assertNoErrors(page, 'cancel short-name guard');
  });

  test('submitting the cancellation shows the confirmed state and Cancelled tag', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    await page.fill('#cancel-sig-name', 'Logan Sample');
    await page.click('#cancel-submit-btn');
    await page.waitForTimeout(600);
    // Modal reopens in submitted state
    const body = await page.textContent('body');
    expect(body).toContain('Cancellation submitted');
    // Documents row shows the Cancelled tag
    const docs = await page.textContent('#view-documents');
    expect(docs).toContain('Cancelled');
    assertNoErrors(page, 'cancel submit confirmed state');
  });

  test('already-cancelled bid renders submitted state instead of the form', async ({ page }) => {
    await bootHub(page, hubWith({ cancelledAt: new Date().toISOString(), cancelledName: 'Logan Sample' }));
    const docs = await page.textContent('#view-documents');
    expect(docs).toContain('Cancelled');
    expect(docs).toContain('Submitted');
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    const body = await page.textContent('body');
    expect(body).toContain('Cancellation submitted');
    // No signature input in the cancelled state
    expect(await page.locator('#cancel-sig-name').count()).toBe(0);
    assertNoErrors(page, 'cancelled state renders confirmation');
  });
});
