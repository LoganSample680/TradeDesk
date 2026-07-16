// @ts-check
/**
 * E2E tests, Change Order remote e-signature via the client hub:
 *
 * 1. A pending change order (status:'pending_client') renders a prominent
 *    approval card in the hub Overview and an "Action needed" row in Documents.
 * 2. The review modal (_showCODoc) shows the original contract amount, the
 *    adjustment, the highlighted new contract total, the legal paragraph, and
 *    a signature canvas + typed-name input.
 * 3. The legal paragraph says "original contract", never "painting contract"
 *    (the app serves all trades).
 * 4. Signing (drawn signature + typed full name) writes the signature and
 *    re-renders: modal flips to the signed-document state, the approval card
 *    disappears from Overview, Documents shows signer metadata.
 * 5. A CO already signed in signed_proposals renders as a signed document with
 *    signature image + signer + date/time (EPA-doc pattern).
 * 6. TradeDesk side: the in-person CO document offers "Send to Client Hub" and
 *    its legal text also says "original contract".
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
        FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

const SIG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PENDING_CO = {
  id: 111,
  coNum: 1,
  desc: 'Added master bedroom ceiling and hallway accent wall',
  type: 'add',
  amount: 450,
  delta: 450,
  originalAmount: 5000,
  newAmount: 5450,
  status: 'pending_client',
  sentAt: new Date().toISOString(),
};

const SIGNED_CO = {
  ...PENDING_CO,
  status: 'signed',
  signedAt: new Date().toISOString(),
  signerName: 'Logan Sample',
  sigData: SIG_PNG,
};

function hubWith(bidExtra = {}, hubExtra = {}) {
  return {
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Zach Pro Painting',
    contractorPhone: '(913) 555-1234',
    clientName: 'Logan Sample',
    clientToken: FAKE_TOKEN,
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

/** Open the CO modal and wait for the canvas wiring (100ms setTimeout). */
async function openCOModal(page) {
  await page.evaluate(id => _showCODoc(id, 1), FAKE_BID_ID_1);
  await page.waitForTimeout(300);
}

test.describe('Client hub, pending change order surfaces for approval', () => {
  test('pending CO renders a prominent approval card in Overview', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    const overview = await page.textContent('#view-overview');
    expect(overview, 'overview must surface the pending CO').toContain('Change Order needs your signature');
    expect(overview).toContain('CO #1');
    expect(overview).toContain(PENDING_CO.desc);
    // Review & sign entry point present
    expect(await page.locator(`#co-card-${FAKE_BID_ID_1}-1`).count()).toBe(1);
    assertNoErrors(page, 'pending CO overview card');
  });

  test('pending CO renders an Action needed row in Documents', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    const docs = await page.textContent('#view-documents');
    expect(docs).toContain('Change Order #1');
    expect(docs, 'pending CO must be flagged for action').toContain('Action needed');
    assertNoErrors(page, 'pending CO documents row');
  });

  test('CO modal shows original amount, adjustment, and new contract total', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    await openCOModal(page);
    const ov = page.locator('#co-hub-ov');
    await expect(ov).toBeVisible();
    const body = await ov.textContent();
    expect(body).toContain('CO #1');
    expect(body).toContain('Original Contract');
    expect(body).toContain('$5,000.00');                 // original
    expect(body).toContain('+$450.00');                  // adjustment
    expect(body).toContain('New Contract Total');
    expect(body).toContain('$5,450.00');                 // new total
    expect(body).toContain(PENDING_CO.desc);
    // Signature inputs present in the pending state
    await expect(page.locator('#co-hub-canvas')).toBeVisible();
    await expect(page.locator('#co-hub-sign-name')).toBeVisible();
    await expect(page.locator('#co-hub-sign-btn')).toBeVisible();
    assertNoErrors(page, 'CO modal amounts');
  });

  test('legal text says "original contract", never "painting contract"', async ({ page }) => {
    // Lives inside the shared esignConsentHTML() terms accordion now (owner
    // directive 2026-07-13), collapsed by default, but textContent reads it
    // regardless of display:none.
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    await openCOModal(page);
    const legal = await page.textContent('#co-hub-terms-body');
    expect(legal).toContain('modify the original contract');
    expect(legal, 'app serves all trades, no painting-specific contract language').not.toContain('painting contract');
    expect(legal).toContain('15 U.S.C.');
    assertNoErrors(page, 'CO legal paragraph');
  });

  test('signing without a typed name is rejected with a clear error', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    await openCOModal(page);
    await page.click('#co-hub-sign-btn');
    const err = await page.textContent('#co-hub-err');
    expect(err, 'must ask for full name').toContain('full name');
    assertNoErrors(page, 'CO sign name guard');
  });

  test('no separate "I agree" checkbox: the signature itself is the consent (owner directive 2026-07-13)', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    await openCOModal(page);
    const ckCount = await page.locator('#co-hub-ck').count();
    expect(ckCount, 'checkbox must be deleted, not just hidden').toBe(0);
    // Terms accordion is still there, just collapsed, the terms didn't vanish, only the checkbox did.
    await expect(page.locator('button:has-text("Terms & Conditions")')).toBeVisible();
    assertNoErrors(page, 'CO consent checkbox deletion proof');
  });

  test('signing with drawn signature + typed name shows the signed state everywhere', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [PENDING_CO] }));
    await openCOModal(page);
    // Draw on the signature canvas
    await page.evaluate(() => {
      const c = document.getElementById('co-hub-canvas');
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(20, 20, 80, 30);
    });
    await page.fill('#co-hub-sign-name', 'Logan Sample');
    await page.click('#co-hub-sign-btn');
    await page.waitForTimeout(600);
    // Modal shows "You're all set!" confirmation screen
    const modal = await page.textContent('#co-hub-ov');
    expect(modal).toContain("You're all set!");
    expect(modal).toContain('Logan Sample');
    expect(modal).toContain('Back to hub');
    // Approval card is gone from Overview
    const overview = await page.textContent('#view-overview');
    expect(overview).not.toContain('Change Order needs your signature');
    // Documents row shows signer metadata
    const docs = await page.textContent('#view-documents');
    expect(docs).toContain('Signed by Logan Sample');
    // Contract total rolled to the new amount in the hub
    const amt = await page.evaluate(id => _hub.bids.find(b => b.id === id).amount, FAKE_BID_ID_1);
    expect(amt).toBe(5450);
    assertNoErrors(page, 'CO sign happy path');
  });

  test('signed CO renders in Documents as a signed document with signature image', async ({ page }) => {
    await bootHub(page, hubWith({ changeOrders: [SIGNED_CO] }));
    const docs = await page.textContent('#view-documents');
    expect(docs).toContain('Change Order #1');
    expect(docs).toContain('Signed by Logan Sample');
    // No pending approval card in Overview
    const overview = await page.textContent('#view-overview');
    expect(overview).not.toContain('Change Order needs your signature');
    // Open the signed document, signature image + signer + date/time render
    await openCOModal(page);
    const ov = page.locator('#co-hub-ov');
    await expect(ov).toBeVisible();
    const body = await ov.textContent();
    expect(body).toContain('Approved & Signed');
    expect(body).toContain('Logan Sample');
    expect(body).toContain('$5,450.00');
    const imgCount = await ov.locator('img[alt="Client signature"]').count();
    expect(imgCount, 'signature image must render in signed CO doc').toBe(1);
    // No signing inputs in the signed state
    expect(await page.locator('#co-hub-sign-name').count()).toBe(0);
    assertNoErrors(page, 'signed CO document');
  });
});

test.describe('TradeDesk: in-person CO flow still works and offers hub sending', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('CO sign document offers in-person signing AND Send to Client Hub', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      const fakeBid = { id: 990001, amount: 5000, surfaces: [] };
      const fakeClient = { name: 'Test Client' };
      const coData = { desc: 'Add deck railing', type: 'add', amount: 450, delta: 450, originalAmount: 5000, newAmount: 5450, coNum: 1 };
      _showCOSignDocument(fakeBid, fakeClient, coData, 1);
    });
    await page.waitForTimeout(300);
    // In-person canvas still present
    expect(await page.locator('#co-sign-canvas').count()).toBe(1);
    // New remote option present
    const hubBtn = page.locator('#co-send-hub-btn');
    await expect(hubBtn).toBeVisible();
    expect(await hubBtn.textContent()).toContain('Send to Client Hub');
    // Legal text fixed: trade-neutral language
    const body = await page.textContent('body');
    expect(body).toContain('modify the original contract');
    expect(body).not.toContain('painting contract');
    await page.evaluate(() => { document.getElementById('co-sign-canvas')?.closest('[style*=fixed]')?.remove(); });
    assertNoErrors(page, 'CO sign document with hub option');
  });

  test('_sendCOToHub and showChangeOrderModal are defined', async () => {
    const types = await page.evaluate(() => ({
      send: typeof _sendCOToHub,
      modal: typeof showChangeOrderModal,
      submit: typeof _submitCOSign,
      notify: typeof _showCONotifyModal,
    }));
    expect(types.send, '_sendCOToHub must exist').toBe('function');
    expect(types.modal, 'in-person entry point must still exist').toBe('function');
    expect(types.submit, 'in-person signing must still exist').toBe('function');
    expect(types.notify, 'notify-client modal must exist').toBe('function');
    assertNoErrors(page, 'CO function presence');
  });

  test('Send to Client Hub opens the proposal-style send modal (Text / Email / Other)', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      // Sign-in state may not survive the mocked boot, _sendCOToHub and the
      // notify modal only need a user id to build the hub URL.
      _supaUser = _supaUser || { id: 'e2e-user' };
      if (!clients.find(c => c.id === 990077)) clients.push({ id: 990077, name: 'Norah Notify', phone: '(316) 555-7777', clientToken: 'tok-co-notify-e2e' });
      if (!bids.find(b => b.id === 990011)) bids.push({ id: 990011, client_id: 990077, status: 'Closed Won', amount: 5000, bid_date: todayKey(), type: 'Interior Painting', surfaces: [] });
      const coData = { desc: 'Add hallway accent wall', type: 'add', amount: 300, delta: 300, originalAmount: 5000, newAmount: 5300, coNum: 1 };
      _showCOSignDocument(bids.find(x => x.id === 990011), clients.find(x => x.id === 990077), coData, 990077);
    });
    await page.waitForTimeout(300);
    // Clear any stray modal overlay a prior test left open, then force the click:
    // in WebKit a leftover .zmodal-overlay intercepts pointer events and the click
    // retries until the 60s timeout closes the context (flake). force dispatches to
    // the real target button regardless.
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove()));
    await page.click('#co-send-hub-btn', { force: true });
    // _sendCOToHub opens the job sheet + send modal after 300ms, the EXACT
    // same Text / Email / Other-app overlay proposals use (_showGeiSendOverlay)
    await page.waitForSelector('#_co-send-overlay', { timeout: 5000 });
    const body = await page.textContent('#_co-send-overlay');
    expect(body, 'modal must announce the CO').toContain('CO #1');
    expect(body, 'must offer the same send options as proposals').toContain('Text');
    expect(body).toContain('Email');
    expect(body).toContain('Other app');
    // Old custom notify modal was replaced, assert it is gone, not duplicated
    const oldCount = await page.locator('#co-notify-ov').count();
    expect(oldCount, 'old co-notify-ov modal must be deleted').toBe(0);
    // Share data drives the same sms/email senders proposals use
    const share = await page.evaluate(() => _coShareData);
    expect(share.cphone, 'sms path must target the client phone').toBe('3165557777');
    expect(share.coNum).toBe(1);
    expect(share.url, 'must carry the client hub URL').toContain('client.html?t=tok-co-notify-e2e');
    // Cleanup: close modals and drop seeded records
    await page.evaluate(() => {
      document.getElementById('_co-send-overlay')?.remove();
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      let i = bids.findIndex(b => b.id === 990011); if (i >= 0) bids.splice(i, 1);
      i = clients.findIndex(c => c.id === 990077); if (i >= 0) clients.splice(i, 1);
      saveAll();
    });
    assertNoErrors(page, 'CO send modal after hub send');
  });

  // Regression: change orders were not reliably reaching the cloud. Before:
  // _sendCOToHub only ever called the fire-and-forget saveAll() (a 2s debounce
  // timer), then returned immediately, the live flow test's 1500ms wait was
  // shorter than that timer, so it deterministically checked the cloud before
  // the write had even started. A second saveAll() from _showCONotifyModal (for
  // a client with no clientToken yet) could push the real upload out further
  // still. Fixed: _sendCOToHub now awaits _flushSaveNow() (cancels the debounce,
  // pushes immediately) before it resolves, so a caller that awaits it, or
  // simply gives it a moment, can rely on the CO having actually reached the
  // cloud, not merely been scheduled. This proves the await happens; the live
  // flow test (change-orders-flow.spec.js) proves the row actually lands.
  test('_sendCOToHub awaits the cloud write (_flushSaveNow) before resolving, does not just schedule it', async () => {
    const r = await page.evaluate(async () => {
      const bidId = 990501, clientId = 990502;
      const savedFlush = window._flushSaveNow;
      let flushCalled = false, flushAwaitedBeforeResolve = false;
      window._flushSaveNow = () => {
        flushCalled = true;
        return new Promise(res => setTimeout(() => { flushAwaitedBeforeResolve = true; res(); }, 20));
      };
      clients.push({ id: clientId, name: 'CO Flush Client', clientToken: 'tok-flush-e2e' });
      bids.push({ id: bidId, client_id: clientId, amount: 5000, changeOrders: [], surfaces: [] });
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed';
      ov.innerHTML = '<canvas id="co-sign-canvas"></canvas>';
      ov.dataset.coData = JSON.stringify({ desc: 'Flush guard', type: 'add', amount: 100, delta: 100, originalAmount: 5000, newAmount: 5100, coNum: 1 });
      document.body.appendChild(ov);
      const origSupaUser = window._supaUser, origSupaEnabled = window.supaEnabled;
      window._supaUser = window._supaUser || { id: 'e2e-user' };
      window.supaEnabled = () => true;
      try {
        await _sendCOToHub(bidId, clientId);
        return { flushCalled, resolvedAfterFlush: flushAwaitedBeforeResolve };
      } finally {
        window._flushSaveNow = savedFlush;
        window._supaUser = origSupaUser; window.supaEnabled = origSupaEnabled;
        document.getElementById('_co-send-overlay')?.remove();
        document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
        let i = bids.findIndex(b => b.id === bidId); if (i >= 0) bids.splice(i, 1);
        i = clients.findIndex(c => c.id === clientId); if (i >= 0) clients.splice(i, 1);
      }
    });
    expect(r.flushCalled, '_sendCOToHub must call _flushSaveNow, not rely on the bare debounce timer').toBe(true);
    expect(r.resolvedAfterFlush, '_sendCOToHub must AWAIT the flush, it cannot resolve before the cloud write settles').toBe(true);
  });
});
