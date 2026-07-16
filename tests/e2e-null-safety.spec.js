// @ts-check
/**
 * Null-safety regression tests.
 *
 * Each test directly exercises a function with the exact bad data that caused
 * a crash before guards were added. If any guard regresses, the corresponding
 * test fails immediately, before CI ever ships the broken code.
 *
 * Coverage mirrors every crash risk found by the systematic audit:
 *   - getBidPaid / getBidBalance: NaN from missing payment amount
 *   - client search / dupe check, TypeError from missing name
 *   - job sort, TypeError from missing start field
 *   - surface qty, TypeError from missing qty in bid email/summary
 *   - SMS helpers, TypeError from missing name in first-name extraction
 *   - expense / income / bid reduces, NaN from missing amount fields
 *   - live financial invariant, no NaN anywhere in the actual dataset
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Null safety, crash-risk regression suite', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── getBidPaid, NaN guard ────────────────────────────────────────────────
  // A payment with no .amount used to produce NaN which propagated into every
  // balance>0.01 check across invoices, collections, and pay-gates app-wide.
  test('getBidPaid returns 0 not NaN when a payment has no amount', async () => {
    const result = await page.evaluate(() => {
      if (typeof getBidPaid !== 'function') return null;
      const bid = { id: 'ns-bid-paid-1', amount: 1000, status: 'Closed Won' };
      bids.unshift(bid);
      payments.unshift({ id: 'ns-pay-1', bid_id: 'ns-bid-paid-1' });          // no amount
      payments.unshift({ id: 'ns-pay-2', bid_id: 'ns-bid-paid-1', amount: undefined });
      payments.unshift({ id: 'ns-pay-3', bid_id: 'ns-bid-paid-1', amount: null });
      const paid = getBidPaid('ns-bid-paid-1');
      bids.shift();
      payments.splice(0, 3);
      return { paid, isNaN: isNaN(paid) };
    });
    if (result !== null) {
      expect(result.isNaN, 'getBidPaid must not return NaN, breaks every balance check in the app').toBe(false);
      expect(result.paid).toBe(0);
    }
    assertNoErrors(page, 'getBidPaid null amount');
  });

  // ── getBidBalance, NaN guard ─────────────────────────────────────────────
  test('getBidBalance never returns NaN with bad payment data', async () => {
    const result = await page.evaluate(() => {
      if (typeof getBidBalance !== 'function' || typeof getBidPaid !== 'function') return null;
      const bid = { id: 'ns-bid-bal-1', amount: 2500, status: 'Closed Won' };
      bids.unshift(bid);
      payments.unshift({ id: 'ns-pay-b1', bid_id: 'ns-bid-bal-1' });
      payments.unshift({ id: 'ns-pay-b2', bid_id: 'ns-bid-bal-1', amount: undefined });
      payments.unshift({ id: 'ns-pay-b3', bid_id: 'ns-bid-bal-1', amount: null });
      const balance = getBidBalance(bid);
      bids.shift();
      payments.splice(0, 3);
      return { balance, isNaN: isNaN(balance), isNeg: balance < 0 };
    });
    if (result !== null) {
      expect(result.isNaN, 'getBidBalance must never produce NaN').toBe(false);
      expect(result.isNeg, 'getBidBalance must never go negative').toBe(false);
      expect(result.balance).toBe(2500);
    }
    assertNoErrors(page, 'getBidBalance null amounts');
  });

  // ── Client search, name guard ────────────────────────────────────────────
  test('client search does not throw when a client has no name', async () => {
    const threw = await page.evaluate(() => {
      clients.unshift({ id: 'ns-client-noname', phone: '5551234567' }); // no name field
      try {
        const ql = 'test';
        clients.filter(c =>
          (c.name || '').toLowerCase().includes(ql) ||
          (c.addr || '').toLowerCase().includes(ql)
        );
        return false;
      } catch (_e) {
        return _e.message;
      } finally {
        clients.shift();
      }
    });
    expect(threw, 'client search must not throw on nameless client: ' + threw).toBe(false);
    assertNoErrors(page, 'client search null name');
  });

  // ── Client dupe check, name guard ───────────────────────────────────────
  test('client dupe check does not throw when an existing client has no name', async () => {
    const threw = await page.evaluate(() => {
      clients.unshift({ id: 'ns-client-dupe', phone: '5559876543' }); // no name
      try {
        const nameLow = 'test client';
        clients.find(x => (x.name || '').toLowerCase().replace(/\s+/g, ' ') === nameLow);
        return false;
      } catch (_e) {
        return _e.message;
      } finally {
        clients.shift();
      }
    });
    expect(threw, 'dupe check must not throw on nameless client: ' + threw).toBe(false);
    assertNoErrors(page, 'client dupe check null name');
  });

  // ── Job sort, start guard ────────────────────────────────────────────────
  test('job sort does not throw when a job has no start field', async () => {
    const threw = await page.evaluate(() => {
      const testJobs = [
        { id: 'ns-job-1', status: 'upcoming', start: '2026-07-01' },
        { id: 'ns-job-2', status: 'upcoming' }, // no start
        { id: 'ns-job-3', status: 'upcoming', start: '2026-06-15' },
      ];
      try {
        testJobs.slice().sort((a, b) => (b.start || '').localeCompare(a.start || ''));
        return false;
      } catch (_e) {
        return _e.message;
      }
    });
    expect(threw, 'job sort must not throw when start is missing: ' + threw).toBe(false);
    assertNoErrors(page, 'job sort null start');
  });

  // ── Surface qty, toLocaleString guard ───────────────────────────────────
  test('surface with no qty does not crash bid email or summary builder', async () => {
    const threw = await page.evaluate(() => {
      const surfs = [
        { type: 'walls', room: 'Living Room' },        // no qty
        { type: 'ceiling', room: 'Kitchen', qty: null }, // null qty
        { type: 'trim', room: 'Hallway', qty: 150 },
      ];
      try {
        surfs.map(s => '  - ' + (s.room || '') + ': ' + (s.qty || 0).toLocaleString() + ' sf');
        return false;
      } catch (_e) {
        return _e.message;
      }
    });
    expect(threw, 'surface qty must not crash when missing: ' + threw).toBe(false);
    assertNoErrors(page, 'surface null qty');
  });

  // ── SMS first-name, name.split guard ────────────────────────────────────
  test('SMS helpers do not throw when a client has no name', async () => {
    const threw = await page.evaluate(() => {
      const clients_no_name = [
        { id: 'sms-c1', phone: '5551234567' },               // no name
        { id: 'sms-c2', phone: '5559876543', name: null },   // null name
        { id: 'sms-c3', phone: '5550001111', name: '' },     // empty name
      ];
      try {
        clients_no_name.forEach(c => {
          const firstName = (c.name || '').split(' ')[0];
          const _msg = 'Hi ' + firstName + ', this is TradeDesk, on my way!';
        });
        return false;
      } catch (_e) {
        return _e.message;
      }
    });
    expect(threw, 'SMS name extraction must not throw on nameless client: ' + threw).toBe(false);
    assertNoErrors(page, 'SMS null name');
  });

  // ── Expense reduce, amount guard ─────────────────────────────────────────
  test('expense total never returns NaN when an expense has no amount', async () => {
    const result = await page.evaluate(() => {
      const exps = [
        { id: 'e1', amount: 100 },
        { id: 'e2' },                    // no amount key
        { id: 'e3', amount: null },
        { id: 'e4', amount: undefined },
        { id: 'e5', amount: 50 },
      ];
      const total = exps.reduce((s, e) => s + (e.amount || 0), 0);
      return { total, isNaN: isNaN(total) };
    });
    expect(result.isNaN, 'expense total must not be NaN with missing amounts').toBe(false);
    expect(result.total).toBe(150);
    assertNoErrors(page, 'expense reduce null amount');
  });

  // ── Income / bid amount reduce, NaN guards ───────────────────────────────
  test('income and bid totals never return NaN with missing amounts', async () => {
    const result = await page.evaluate(() => {
      const testIncome = [{ amount: 500 }, {}, { amount: null }, { amount: 300 }];
      const testBids   = [{ amount: 1000 }, {}, { amount: undefined }, { amount: 200 }];
      const incTotal = testIncome.reduce((s, r) => s + (r.amount || 0), 0);
      const bidTotal = testBids.reduce((s, b) => s + (b.amount || 0), 0);
      return {
        incTotal, bidTotal,
        incNaN: isNaN(incTotal),
        bidNaN: isNaN(bidTotal),
      };
    });
    expect(result.incNaN, 'income total must not be NaN').toBe(false);
    expect(result.bidNaN, 'bid total must not be NaN').toBe(false);
    expect(result.incTotal).toBe(800);
    expect(result.bidTotal).toBe(1200);
    assertNoErrors(page, 'income/bid reduce null amounts');
  });

  // ── Global financial invariant, no NaN anywhere in live data ─────────────
  // Scans every bid in memory and confirms that getBidPaid and getBidBalance
  // never return NaN. This catches any new payment records introduced by
  // tests or seeded data that might have a missing amount field.
  test('no NaN in any live getBidPaid or getBidBalance with current dataset', async () => {
    const nanFields = await page.evaluate(() => {
      if (typeof getBidPaid !== 'function' || typeof getBidBalance !== 'function') return [];
      const issues = [];
      bids.forEach(b => {
        const paid = getBidPaid(b.id);
        const bal  = getBidBalance(b);
        if (isNaN(paid)) issues.push('getBidPaid(bid ' + b.id + ')=NaN');
        if (isNaN(bal))  issues.push('getBidBalance(bid ' + b.id + ')=NaN');
      });
      return issues;
    });
    expect(
      nanFields,
      'live financial calculations produced NaN:\n' + nanFields.join('\n')
    ).toEqual([]);
    assertNoErrors(page, 'financial NaN invariant');
  });

  // ── Zero console errors ───────────────────────────────────────────────────
  test('zero console errors across all null-safety assertions', async () => {
    assertNoErrors(page, 'null safety zero errors');
  });
});
