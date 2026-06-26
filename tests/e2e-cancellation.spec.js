// @ts-check
/**
 * E2E tests — client hub Documents upgrades:
 *
 * 1. Signed Agreement row shows signer name + date/time (from bid fields the
 *    sig-check populates out of signed_proposals).
 * 2. EPA Renovate Right Disclosure appears as its own document row with the
 *    acknowledgement signature metadata (doc 2 of the unified signing flow).
 * 3. Notice of Cancellation is a 3-step friction flow:
 *    Step 1 — reason picker (must select before continuing)
 *    Step 2 — "talk to contractor first" interstitial with call/text links
 *    Step 3 — timed signature form (5-second countdown before submit enables)
 *    Confirmed state once cancelled_at is set.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
        FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

function hubWith(bidExtra = {}, hubExtra = {}) {
  return {
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Zach Pro Painting',
    contractorPhone: '(913) 555-1234',
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

/** Jump directly to the Step 3 signature form and skip the countdown. */
async function skipToCancelForm(page) {
  await page.evaluate((id) => {
    _cancelBidId = id;
    _cancelReason = 'Price concerns';
    document.getElementById('cancel-notice-ov')?.remove();
    const ov = document.createElement('div');
    ov.id = 'cancel-notice-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(ov);
    _cancelShowStep3();
    if (_cancelTimer) { clearInterval(_cancelTimer); _cancelTimer = null; }
    const btn = document.getElementById('cancel-submit-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.textContent = 'Permanently Cancel Agreement'; }
  }, FAKE_BID_ID_1);
}

test.describe('Hub Documents — signature metadata + EPA disclosure doc', () => {
  test('client.html defines escHtml — signature block renders without ReferenceError', async ({ page }) => {
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

test.describe('Notice of Cancellation — 3-step friction flow', () => {
  test('step 1 shows reason picker — Continue disabled until a reason is selected', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    // Reason buttons present
    const reasonCount = await page.locator('#cancel-notice-ov .cancel-reason-opt').count();
    expect(reasonCount, 'must show at least 4 reason options').toBeGreaterThanOrEqual(4);
    // Continue button starts disabled
    const nextBtn = page.locator('#cancel-next1-btn');
    await expect(nextBtn).toBeVisible();
    expect(await nextBtn.isDisabled()).toBe(true);
    assertNoErrors(page, 'step 1 reason picker');
  });

  test('selecting a reason enables Continue and advances to step 2', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    await page.locator('#cancel-notice-ov .cancel-reason-opt').first().click();
    const nextBtn = page.locator('#cancel-next1-btn');
    expect(await nextBtn.isDisabled()).toBe(false);
    await nextBtn.click();
    // Step 2: contractor contact interstitial
    const body = await page.textContent('#cancel-notice-ov');
    expect(body).toContain('Zach Pro Painting');
    // Proceed link present
    await expect(page.locator('#cancel-proceed-btn')).toBeVisible();
    assertNoErrors(page, 'step 2 contractor contact');
  });

  test('step 2 has call and text links for the contractor', async ({ page }) => {
    await bootHub(page, hubWith());
    await page.evaluate(id => _showCancelForm(id), FAKE_BID_ID_1);
    await page.locator('#cancel-notice-ov .cancel-reason-opt').first().click();
    await page.locator('#cancel-next1-btn').click();
    const callLink = await page.locator('#cancel-notice-ov a[href^="tel:"]').getAttribute('href');
    expect(callLink).toContain('9135551234');
    assertNoErrors(page, 'step 2 call link');
  });

  test('cancellation form has typed-name signature input while window open', async ({ page }) => {
    await bootHub(page, hubWith());
    await skipToCancelForm(page);
    await expect(page.locator('#cancel-sig-name')).toBeVisible();
    await expect(page.locator('#cancel-submit-btn')).toBeVisible();
    assertNoErrors(page, 'cancel form e-signable');
  });

  test('short name is rejected with a clear error', async ({ page }) => {
    await bootHub(page, hubWith());
    await skipToCancelForm(page);
    await page.fill('#cancel-sig-name', 'ab');
    await page.click('#cancel-submit-btn');
    const err = await page.textContent('#cancel-err');
    expect(err, 'must ask for full name').toContain('full name');
    assertNoErrors(page, 'cancel short-name guard');
  });

  test('submitting the cancellation shows the confirmed state and Cancelled tag', async ({ page }) => {
    await bootHub(page, hubWith());
    await skipToCancelForm(page);
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

  test('cancelled bid shows cancelled state and no payment CTA in overview', async ({ page }) => {
    await bootHub(page, hubWith({ cancelledAt: new Date().toISOString(), cancelledName: 'Logan Sample' }));
    const overview = await page.textContent('#view-overview');
    // Cancelled bid must show cancelled state label
    expect(overview).toContain('Cancelled');
    // No Stripe payment button should appear
    expect(overview).not.toContain('Secured by Stripe');
    assertNoErrors(page, 'cancelled bid clears balance in overview');
  });
});

// ── Hub snapshot freshness — HTTP cache bypass (stale-balance fix) ────────────
// The hub snapshot JSON is rewritten in storage whenever the contractor logs a
// payment, but Supabase storage's default cache-control: max-age=3600 let the
// browser serve a stale copy (old balance + "Pay" CTA) for up to an hour.
// client.html now fetches the public object URL with cache:'no-store' plus a
// cb= cache-buster. The Supabase shim's in-page fetch interceptor records every
// such request in window.__storageFetches (WebKit-safe — no page.route needed).
test.describe('Hub snapshot — HTTP cache bypass', () => {
  test('hub snapshot is fetched with cache:no-store and a cb= cache-buster', async ({ page }) => {
    await bootHub(page, hubWith());
    const calls = await page.evaluate(() => window.__storageFetches || []);
    const hubCall = calls.find(c => c.url.includes('client-hub/' + FAKE_USER_ID));
    expect(hubCall, 'hub snapshot must be read via the public-URL fetch path; saw: ' + JSON.stringify(calls)).toBeTruthy();
    expect(hubCall.cache, 'hub snapshot fetch must use cache:no-store').toBe('no-store');
    expect(hubCall.url, 'hub snapshot fetch must carry a cache-buster param').toMatch(/[?&]cb=\d+/);
    // And the hub actually rendered from the fresh fetch
    const body = await page.textContent('body');
    expect(body).toContain('Logan Sample');
    assertNoErrors(page, 'hub cache-bypass fetch');
  });

  test('opening a proposal fetches the proposal JSON with cache:no-store + cb=', async ({ page }) => {
    // bootHub → mockAllExternal sets window.__mockProposalData = MOCK_PROPOSAL,
    // so the rendered proposal content comes from MOCK_PROPOSAL.proposalHtml.
    await bootHub(page, hubWith());
    await page.evaluate(id => openProposal(id), FAKE_BID_ID_1);
    await page.waitForTimeout(500);
    const calls = await page.evaluate(() => (window.__storageFetches || []).filter(c => c.url.includes('proposals/') && !c.url.includes('client-hub')));
    expect(calls.length, 'proposal JSON must be read via the public-URL fetch path').toBeGreaterThan(0);
    expect(calls[0].cache).toBe('no-store');
    expect(calls[0].url).toMatch(/[?&]cb=\d+/);
    const propText = await page.textContent('#prop-content');
    expect(propText).toContain('Painting scope');
    assertNoErrors(page, 'proposal cache-bypass fetch');
  });

  test('boot watchdog reveals the error page when every storage request hangs', async ({ page }) => {
    // Dead-network simulation: fetch AND download() never settle. Without the
    // watchdog the boot overlay (fixed, z-9999) would sit on screen forever.
    await page.addInitScript(() => { window.__storageFetchHang = true; window.__BOOT_WATCHDOG_MS = 1500; });
    await bootHub(page, hubWith());
    await page.waitForTimeout(2600); // watchdog (1.5s) + overlay fade-out (~.5s)
    await expect(page.locator('#pg-err')).toBeVisible();
    await expect(page.locator('#boot-overlay')).toBeHidden();
  });

  test('quote-in-progress screen dismisses the boot overlay', async ({ page }) => {
    // Hub JSON missing on both read paths, but onboarding was completed on this
    // device → showQuoteInProgress() must not leave the loader covering the page.
    await page.addInitScript(() => {
      window.__storageFetchFail = true;
      window.__storageDownloadFail = true;
      try { localStorage.setItem('td_onb_done_1', '1'); } catch (_e) {}
    });
    await bootHub(page, hubWith());
    await page.waitForTimeout(800); // overlay fade-out
    const body = await page.textContent('#pg-hub');
    expect(body).toContain('Quote in progress');
    await expect(page.locator('#boot-overlay')).toBeHidden();
    assertNoErrors(page, 'quote-in-progress dismisses boot overlay');
  });

  test('hub still renders via storage.download() fallback when the fresh fetch fails', async ({ page }) => {
    // Simulate a CDN/public-URL failure — the app must fall back to download()
    // and render normally (identical to the pre-fix read path).
    await page.addInitScript(() => { window.__storageFetchFail = true; });
    await bootHub(page, hubWith());
    const calls = await page.evaluate(() => window.__storageFetches || []);
    expect(calls.length, 'fresh fetch must have been attempted first').toBeGreaterThan(0);
    const body = await page.textContent('body');
    expect(body).toContain('Logan Sample');
    expect(body).toContain('Interior Painting');
    assertNoErrors(page, 'hub fallback after fetch failure');
  });
});

// ── Hub hero — stat tiles removed ────────────────────────────────────────────
test.describe('Client hub hero — stat tiles removed', () => {
  test('hub-hero does NOT render Paid / Balance / Photos tiles', async ({ page }) => {
    await bootHub(page, hubWith());
    const count = await page.locator('.hub-mini').count();
    expect(count, 'hub-mini stat tiles must not exist').toBe(0);
    assertNoErrors(page, 'hub-mini tiles removed');
  });
});
