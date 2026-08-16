// @ts-check
/**
 * TradeDesk never adds a fee to what the client pays.
 *
 * Owner rule 2026-08-15: "we can't allow passing fees to the person until stripe
 * natively does it."
 *
 * What was there before: a Settings toggle ("Pass credit card fee to client") that
 * wrote S.ccSurchargeEnabled / S.ccSurchargePct, carried both into every proposal
 * snapshot, and made sign.html tell the homeowner "3% fee on credit cards". The
 * charge path never actually added the fee, so the disclosure was announcing a
 * charge that never arrived. The toggle also allowed up to 4% with no state gate:
 * surcharging is banned outright in CT, MA, ME and PR, capped at 2% in CO, and
 * capped at 3% by the card networks everywhere else since April 2023.
 *
 * These tests are the permanent guard (CLAUDE.md §7.1: a removal must be proven,
 * not just replaced). They fail if the setting, the snapshot fields, or the
 * client-facing fee copy ever come back.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, MOCK_PROPOSAL, FAKE_TOKEN, FAKE_BID_ID_1 } = require('./helpers');

test.describe('No surcharge: the client is never charged a fee', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test('the Settings toggle and its percent field are gone from the DOM', async () => {
    const r = await page.evaluate(() => ({
      wrap: document.querySelectorAll('#stripe-surcharge-wrap').length,
      toggle: document.querySelectorAll('#set-cc-surcharge-enabled').length,
      pct: document.querySelectorAll('#set-cc-surcharge-pct').length,
      pctWrap: document.querySelectorAll('#set-cc-surcharge-pct-wrap').length,
    }));
    expect(r.wrap).toBe(0);
    expect(r.toggle).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.pctWrap).toBe(0);
    assertNoErrors(page, 'surcharge settings removed');
  });

  test('saving settings never writes a surcharge key, even if one is already stored', async () => {
    const r = await page.evaluate(() => {
      // An account that had the toggle ON before it was removed
      S.ccSurchargeEnabled = true;
      S.ccSurchargePct = 4;
      const before = { on: S.ccSurchargeEnabled, pct: S.ccSurchargePct };
      try { saveSettings(); } catch (e) { return { err: e.message }; }
      return { before, on: S.ccSurchargeEnabled, pct: S.ccSurchargePct };
    });
    expect(r.err).toBeUndefined();
    expect(r.before.on).toBe(true);      // the legacy value really was set
    expect(r.on).toBeUndefined();        // and saving drops it rather than round-tripping it
    expect(r.pct).toBeUndefined();
  });

  test('the proposal snapshot carries no surcharge fields', async () => {
    const r = await page.evaluate(() => {
      S.ccSurchargeEnabled = true;   // even with a legacy value sitting in settings
      S.ccSurchargePct = 3;
      const src = (typeof _uploadClientHub === 'function') ? _uploadClientHub.toString() : '';
      const proposalSrc = (typeof buildProposalSnapshot === 'function') ? buildProposalSnapshot.toString() : '';
      return {
        // No builder anywhere may put these keys into a snapshot
        inHub: /ccSurcharge/.test(src),
        inProposal: /ccSurcharge/.test(proposalSrc),
      };
    });
    expect(r.inHub).toBe(false);
    expect(r.inProposal).toBe(false);
  });
});

test.describe('No surcharge: sign.html ignores a legacy proposal that still has the flag', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    // Proposals uploaded BEFORE the removal still carry these keys in storage, and
    // they will for as long as those files live. The signing page must ignore them.
    await mockAllExternal(page, {
      proposalData: { ...MOCK_PROPOSAL, stripeConnectEnabled: true, ccSurchargeEnabled: true, ccSurchargePct: 4 },
    });
    await page.goto('/sign.html?t=' + FAKE_TOKEN + '&b=' + FAKE_BID_ID_1, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
  });

  test('no fee line is shown to the client', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    expect(txt).not.toMatch(/fee on credit cards/i);
    expect(txt).not.toMatch(/processing fee/i);
    expect(txt).not.toMatch(/\d+% fee/i);
  });

  test('the pay button renders without reading the legacy flag', async () => {
    const r = await page.evaluate(() => {
      const src = (typeof _renderSignPayBtns === 'function') ? _renderSignPayBtns.toString() : '';
      return { hasReader: /ccSurcharge|surchargeOn/.test(src), fn: typeof _renderSignPayBtns };
    });
    if (r.fn !== 'function') return;   // page variant without the helper
    expect(r.hasReader).toBe(false);
  });
});
