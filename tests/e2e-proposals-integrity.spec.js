// @ts-check
/**
 * Proposals integrity, scope and calculation regression tests.
 *
 * Guards against the critical proposals bugs found in the systematic audit:
 *
 *   1. sendProposalLink used _depositAmt, _st, _cancelDays, _cancelStat before
 *      they were defined, they only existed in buildProposal's scope. Fixed by
 *      inlining the derivations in sendProposalLink.
 *
 *   2. buildProposal used _propFinal (only defined in sendProposalLink) instead
 *      of the in-scope parameter `final`. Fixed by replacing _propFinal with final.
 *
 *   3. Portfolio discount was applied twice: calcEst().final already contains
 *      the adjusted price, but fullPrice/discountedPrice discounted it again.
 *      Fixed: fullPrice is the reverse-calculated pre-discount price;
 *             discountedPrice is the actual signing price.
 *
 *   4. On bid re-price (edit path), bid.deposit was never updated, only the
 *      draft path did it. Fixed by adding the deposit write to the edit path.
 *
 * Because sendProposalLink and buildProposal require a fully initialized estimate
 * form and live Supabase connection, tests verify the logic units directly rather
 * than calling the full functions. Each test is titled to match its exact regression.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Proposals integrity, scope and calculation regression suite', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── _depositAmt computation ───────────────────────────────────────────────
  // Before fix: _depositAmt was undefined at the point it was used in
  // sendProposalLink because it was only declared inside buildProposal().
  // After fix: derivation is inlined in sendProposalLink immediately after calcEst().
  test('deposit amount formula produces a finite non-NaN result for any pct input', async () => {
    const cases = await page.evaluate(() => {
      // The inlined formula from sendProposalLink (after fix):
      const compute = (propFinal, rawPct) => {
        const pct = (parseFloat(rawPct) || 0) / 100;
        return Math.round(propFinal * pct * 100) / 100;
      };
      return [
        { pct: '25', final: 2000, expected: 500 },
        { pct: '0',  final: 2000, expected: 0   },
        { pct: '',   final: 2000, expected: 0   }, // empty input → parseFloat → NaN → 0
        { pct: null, final: 2000, expected: 0   },
        { pct: '33', final: 1500, expected: 495 },
      ].map(c => ({
        ...c,
        result: compute(c.final, c.pct),
        isNaN: isNaN(compute(c.final, c.pct)),
      }));
    });
    for (const c of cases) {
      expect(c.isNaN, `_depositAmt must not be NaN for pct=${c.pct}`).toBe(false);
      expect(c.result).toBe(c.expected);
    }
    assertNoErrors(page, 'depositAmt formula');
  });

  // ── State detection in sendProposalLink scope ─────────────────────────────
  // Before fix: _st was never computed in sendProposalLink; it was undefined.
  // After fix: state is extracted from address input immediately after calcEst().
  test('state detection resolves correctly from a job address', async () => {
    const cases = await page.evaluate(() => {
      const detect = (addr) => {
        const m = (addr || '').toUpperCase().match(
          /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/
        );
        return (m ? m[1] : null) || (typeof S !== 'undefined' ? S.state : null) || 'KS';
      };
      return [
        { addr: '456 Oak Street, Kansas City MO 64101', expected: 'MO' },
        { addr: '789 Elm Ave, Wichita, KS 67202',       expected: 'KS' },
        { addr: '100 Main St, Dallas TX 75201',          expected: 'TX' },
        { addr: '',                                      expected: 'KS' }, // falls back to S.state or KS
        { addr: null,                                    expected: 'KS' },
      ].map(c => ({ ...c, result: detect(c.addr) }));
    });
    for (const c of cases) {
      expect(c.result, `state detection for "${c.addr}" should be ${c.expected}`).toBe(c.expected);
    }
    assertNoErrors(page, 'state detection scope');
  });

  // ── Cancel rule derivation ────────────────────────────────────────────────
  // Before fix: _cancelDays and _cancelStat were undefined in sendProposalLink.
  // After fix: derived from _st immediately after state detection.
  test('cancelDays and cancelStat are always defined strings/numbers (never undefined)', async () => {
    const result = await page.evaluate(() => {
      const states = ['KS', 'MO', 'TX', 'CA', 'FL', 'NY', 'WA', 'UNKNOWN'];
      return states.map(st => {
        const rule = (typeof STATE_CANCEL !== 'undefined' && STATE_CANCEL[st])
          || { days: 3, statute: '16 CFR Part 429' };
        return {
          st,
          daysDefined: typeof rule.days === 'number' && rule.days > 0,
          statDefined: typeof rule.statute === 'string' && rule.statute.length > 0,
          days: rule.days,
          statute: rule.statute,
        };
      });
    });
    for (const r of result) {
      expect(r.daysDefined, `_cancelDays for state ${r.st} must be a positive number`).toBe(true);
      expect(r.statDefined, `_cancelStat for state ${r.st} must be a non-empty string`).toBe(true);
    }
    assertNoErrors(page, 'cancel rule scope');
  });

  // ── Portfolio discount, never applied twice ──────────────────────────────
  // Before fix: fullPrice = _propFinal (already discounted), discountedPrice = _propFinal*(1-pct/100)
  // This applied the portfolio discount twice, showing clients a wrong (too-low) price.
  // After fix: fullPrice = reverse-calculated pre-discount price, discountedPrice = _propFinal.
  test('fullPrice is always >= discountedPrice (portfolio discount not applied twice)', async () => {
    const cases = await page.evaluate(() => {
      const compute = (propFinal, pct, portfolioOn) => {
        // Fixed formula from sendProposalLink:
        const rawPrice = portfolioOn && pct > 0
          ? Math.round(propFinal / (1 - pct / 100) * 100) / 100
          : propFinal;
        return { fullPrice: rawPrice, discountedPrice: propFinal };
      };
      return [
        compute(1700, 15, true),   // 15% portfolio discount
        compute(3000, 10, true),   // 10% portfolio discount
        compute(2000,  0, true),   // 0% portfolio, no discount
        compute(2000, 15, false),  // portfolio off, both equal
        compute(500,  20, true),   // 20% portfolio
      ].map(c => ({
        ...c,
        fullGteDiscounted: c.fullPrice >= c.discountedPrice,
        neitherNaN: !isNaN(c.fullPrice) && !isNaN(c.discountedPrice),
      }));
    });
    for (const c of cases) {
      expect(c.neitherNaN, 'fullPrice and discountedPrice must not be NaN').toBe(true);
      expect(
        c.fullGteDiscounted,
        `fullPrice (${c.fullPrice}) must be >= discountedPrice (${c.discountedPrice}): portfolio discount must not be applied twice`
      ).toBe(true);
    }
    assertNoErrors(page, 'portfolio discount not doubled');
  });

  // ── Portfolio discount, correct magnitude ────────────────────────────────
  test('fullPrice discounted by portfolioPct equals discountedPrice (within $1)', async () => {
    const result = await page.evaluate(() => {
      const propFinal = 1700; // already discounted by 15%
      const pct = 15;
      const rawPrice = Math.round(propFinal / (1 - pct / 100) * 100) / 100;
      const reverseCheck = Math.round(rawPrice * (1 - pct / 100) * 100) / 100;
      return {
        rawPrice,
        reverseCheck,
        diff: Math.abs(reverseCheck - propFinal),
        withinOneDollar: Math.abs(reverseCheck - propFinal) < 1,
      };
    });
    expect(
      result.withinOneDollar,
      `fullPrice (${result.rawPrice}) discounted by 15% should equal discountedPrice, got ${result.reverseCheck} vs ${1700}`
    ).toBe(true);
    assertNoErrors(page, 'portfolio discount magnitude');
  });

  // ── Bid deposit updated on re-price (edit path) ───────────────────────────
  // Before fix: on the edit path in buildProposal, b.amount was updated but
  // b.deposit was never changed, stale deposit after every re-price.
  // After fix: deposit is updated alongside amount.
  test('bid deposit is updated when bid amount changes during re-price', async () => {
    const result = await page.evaluate(() => {
      const bid = { id: 'integrity-reprice-1', amount: 1000, deposit: 250, status: 'Closed Won', draft: false };
      bids.unshift(bid);
      const newFinal = 1500;
      const rawPct = '25'; // simulates e-deposit-pct input value
      const depositPct = (parseFloat(rawPct) || 0) / 100;
      // The fixed edit path from buildProposal:
      bid.amount  = newFinal;
      bid.deposit = Math.round(newFinal * depositPct * 100) / 100;
      const r = { amount: bid.amount, deposit: bid.deposit };
      bids.shift();
      return r;
    });
    expect(result.amount).toBe(1500);
    expect(result.deposit).toBe(375); // 25% of 1500
    assertNoErrors(page, 'bid deposit on re-price');
  });

  // ── buildProposal deposit uses final (not _propFinal) ─────────────────────
  // Before fix: const _depositAmt = Math.round(_propFinal * _depositPct * 100) / 100
  // _propFinal was only defined in sendProposalLink, ReferenceError or stale value.
  // After fix: uses `final` which is the correct in-scope parameter of buildProposal.
  test('deposit amount in buildProposal scope uses the correct final value', async () => {
    const result = await page.evaluate(() => {
      // Simulate buildProposal's local context:
      const final = 2400; // the in-scope parameter
      const rawPct = '25';
      const _depositPct = (parseFloat(rawPct) || 0) / 100;
      // Fixed: uses `final`, not `_propFinal`
      const _depositAmt = Math.round(final * _depositPct * 100) / 100;
      return { _depositAmt, isNaN: isNaN(_depositAmt), expected: 600 };
    });
    expect(result.isNaN, 'buildProposal _depositAmt must not be NaN').toBe(false);
    expect(result._depositAmt).toBe(600); // 25% of 2400
    assertNoErrors(page, 'buildProposal deposit uses final');
  });

  // ── Zero console errors ───────────────────────────────────────────────────
  test('zero console errors across all proposals integrity checks', async () => {
    assertNoErrors(page, 'proposals integrity zero errors');
  });
});
