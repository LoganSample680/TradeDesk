// @ts-check
/**
 * California: a buyer 65 or older has five business days to cancel.
 *
 * Owner, 2026-09-24: "Do it" (add the California senior rule). Cal. Civ. Code
 * §1689.6 gives a buyer aged 65 or older five business days, not three, to
 * cancel a home improvement contract (contracts from Jan 1 2021). The app has
 * no way to know age, so the buyer says so on the signing page; the answer is
 * saved with the signature (signed_proposals.buyer_senior) and the hub counts
 * that bid's deadline from it. Everywhere else stays three.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

test.describe('the law table and the contract clause', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  test('California carries five days for 65+, with its own statute; no other state does', async () => {
    const r = await page.evaluate(() => ({
      ca: STATE_CANCEL.CA,
      others: Object.keys(STATE_CANCEL).filter(k => k !== 'CA' && STATE_CANCEL[k].seniorDays),
    }));
    expect(r.ca.days).toBe(3);
    expect(r.ca.seniorDays).toBe(5);
    expect(r.ca.seniorStatute).toBe('Civ. Code §1689.6');
    expect(r.others).toEqual([]);
  });

  const terms = (addr) => page.evaluate((addr) => {
    bids.length = 0; clients.length = 0;
    clients.push({ id: 97301, name: 'Hetty Green', addr });
    currentClientId = 97301; _activeTrade = 'plumbing';
    openGenericEstimate(getClientById(97301), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false;
    const d = document.createElement('div'); d.innerHTML = _geiBuildTermsHtml();
    return d.textContent;
  }, addr);

  test('a California contract names the five days for a buyer 65 or older', async () => {
    const t = await terms('88 Pine St, Sacramento, CA 95814');
    expect(t).toContain('Buyer may cancel within 3 business days of signing (Civ. Code §1689.5), or within 5 business days if Buyer is 65 or older (Civ. Code §1689.6), for a full refund');
  });

  test('a Kansas contract says nothing about age', async () => {
    const t = await terms('412 Bell St, Topeka, KS 66603');
    expect(t).toContain('Buyer may cancel within 3 business days of signing');
    expect(t).not.toContain('65 or older');
  });

  test('no console errors', async () => { assertNoErrors(page, 'cancel senior terms'); });
});

// ── The signing page ───────────────────────────────────────────────────────
const signProp = (st, addr, id) => ({
  id, status: 'pending', businessName: 'Pruitt Plumbing', businessPhone: '785-555-0142',
  clientName: 'Hetty Green', clientAddr: addr, amount: 4200, deposit: 1050,
  estDays: 1, createdAt: new Date().toISOString(), signingToken: 'tok-sr' + id, contractorUserId: FAKE_USER_ID,
  clientId: 97302, proposalHtml: '<div><div class="prop-mark">Pruitt Plumbing</div></div>',
  termsHtml: '<div><div>1. <strong>Warranty:</strong> One year.</div></div>',
  trade: 'plumbing', surfaces: [], stripeConnectEnabled: false, brandColor: '#C2410C', state: st, cancelDays: 3,
});
async function openSign(page, prop) {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(d => { window.__mockProposalData = d; }, prop);
  await mockAllExternal(page, { proposalData: prop, bidId: prop.id });
  await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${prop.id}_${prop.signingToken}.json`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2500);
  // The notice lives in the signing step, one tap past Approve.
  await page.evaluate(async () => { approveAndSign(); await new Promise(r => setTimeout(r, 500)); });
}
test.describe('the signing page asks, in California only', () => {
  test('California: "I am 65 or older" moves the deadline to five business days, and back', async ({ page }) => {
    await openSign(page, signProp('CA', '88 Pine St, Sacramento, CA 95814', 777301));
    const txt = () => page.evaluate(() => document.getElementById('cancel-notice-text').textContent);
    const before = await txt();
    expect(before).toContain('within 3 business days');
    expect(before).toContain('Civ. Code §1689.5');
    await expect(page.locator('#senior-row')).toBeVisible();
    await expect(page.locator('#senior-row')).toContainText('I am 65 or older');
    await page.locator('#buyer-senior').check();
    const after = await txt();
    expect(after).toContain('within 5 business days');
    expect(after).toContain('Civ. Code §1689.6');
    // Five business days lands later than three.
    const when = t => new Date(t.match(/deadline: (\d\d\/\d\d\/\d{4})/)[1]).getTime();
    expect(when(after)).toBeGreaterThan(when(before));
    expect(await page.evaluate(() => window._buyerSenior)).toBe(true);
    await page.locator('#buyer-senior').uncheck();
    expect(await txt()).toContain('within 3 business days');
    expect(await page.evaluate(() => window._buyerSenior)).toBe(false);
    assertNoErrors(page, 'sign CA senior');
  });

  test('Kansas: no age question, three days', async ({ page }) => {
    await openSign(page, signProp('KS', '412 Bell St, Topeka, KS 66603', 777302));
    expect(await page.locator('#senior-row').count()).toBe(0);
    expect(await page.evaluate(() => document.getElementById('cancel-notice-text').textContent)).toContain('within 3 business days');
    assertNoErrors(page, 'sign KS');
  });

  test('the answer is saved with the signature', async () => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'sign.html'), 'utf8');
    expect(src).toContain('buyer_senior:!!window._buyerSenior');
    expect(src).toContain('buyerSenior:!!window._buyerSenior');
    const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261038_buyer_senior.sql'), 'utf8');
    expect(mig).toMatch(/add column if not exists buyer_senior boolean/);
  });
});

// ── The hub ────────────────────────────────────────────────────────────────
const hub = (senior) => ({
  contractorUserId: FAKE_USER_ID, contractorName: 'Pruitt Plumbing', businessName: 'Pruitt Plumbing',
  contractorPhone: '785-555-0142', clientName: 'Hetty Green', clientAddr: '88 Pine St, Sacramento, CA 95814',
  clientToken: FAKE_TOKEN, brandColor: '#C2410C', stripeEnabled: true, state: 'CA',
  cancelDays: 3, cancelStatute: 'Civ. Code §1689.5', seniorCancelDays: 5, seniorCancelStatute: 'Civ. Code §1689.6',
  jobs: [], payments: [], photos: [], messages: [], notifications: [], invoices: [],
  bids: [{ id: 880301, type: 'Water heater replacement', amount: 4200, deposit: 1050, paid: 1050, balance: 3150, status: 'Closed Won',
    bid_date: '2026-09-24', signedAt: new Date().toISOString(), buyerSenior: senior }],
});
async function bootHub(page, h) {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(d => { window.__mockHubData = d; }, h);
  await mockAllExternal(page);
  await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

test.describe('the hub counts that bid\'s own deadline', () => {
  for (const [senior, days, cite] of [[true, 5, 'Civ. Code §1689.6'], [false, 3, 'Civ. Code §1689.5']]) {
    test(`buyer ${senior ? 'said 65+' : 'did not'}: ${days} business days, ${cite}`, async ({ page }) => {
      await bootHub(page, hub(senior));
      const r = await page.evaluate(() => {
        const b = _hub.bids[0];
        const dl = _cancelDeadline(b.signedAt, _bidCancelDays(b));
        return { days: _bidCancelDays(b), cite: _bidCancelStatute(b), dl: dl && dl.getTime() };
      });
      expect(r.days).toBe(days);
      expect(r.cite).toBe(cite);
      const want = await page.evaluate((n) => {
        const b = _hub.bids[0]; return _cancelDeadline(b.signedAt, n).getTime();
      }, days);
      expect(r.dl).toBe(want);
      assertNoErrors(page, 'hub senior ' + senior);
    });
  }
});
