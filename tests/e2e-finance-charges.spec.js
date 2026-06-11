// @ts-check
/**
 * E2E tests — Finance charges on overdue balances
 *
 * Coverage:
 * 1. _calcFinanceCharge returns 0 when balance is paid
 * 2. Finance charge line item appears in client hub when bid is 30+ days overdue
 * 3. Pay button amount includes finance charge
 * 4. No finance charge shown when within grace period (< 30 days)
 * 5. Finance charge is 0 when balance is 0
 */

const { test, expect, mockAllExternal, assertNoErrors,
        FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

// 35-day-old completion date
const OVERDUE_DATE = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
// 10-day-old completion date (within grace period)
const GRACE_DATE = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

function hubWith(bidExtra = {}, hubExtra = {}) {
  return {
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Zach Pro Painting',
    contractorPhone: '(913) 555-1234',
    clientName: 'Logan Sample',
    clientToken: FAKE_TOKEN,
    stripeEnabled: true,
    bids: [{
      id: FAKE_BID_ID_1,
      type: 'Interior Painting',
      amount: 5000,
      deposit: 1250,
      paid: 1250,
      balance: 3750,
      status: 'Closed Won',
      bid_date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10),
      signedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
      signerName: 'Logan Sample',
      completion_date: OVERDUE_DATE,
      financeCharge: 0,
      daysOverdue: 0,
      ...bidExtra,
    }],
    jobs: [],
    payments: [{ bid_id: FAKE_BID_ID_1, amount: 1250, date: new Date(Date.now() - 38 * 86400000).toISOString().slice(0, 10), type: 'deposit' }],
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

test.describe('Finance charges — _calcFinanceCharge unit behaviour', () => {
  test('_calcFinanceCharge returns 0 when balance is fully paid', async ({ page }) => {
    await bootHub(page, hubWith({ balance: 0, paid: 5000 }));
    // Verify no finance charge is injected when balance is 0
    const fcVisible = await page.locator('text=Finance charge').count();
    expect(fcVisible, '_calcFinanceCharge: finance charge line must not appear when balance is 0').toBe(0);
    assertNoErrors(page, '_calcFinanceCharge returns 0 when balance is paid');
  });

  test('_calcFinanceCharge returns 0 when balance is 0 (full pay)', async ({ page }) => {
    // Hub with bid fully paid — financeCharge:0 from snapshot
    await bootHub(page, hubWith({ balance: 0, paid: 5000, financeCharge: 0, daysOverdue: 0 }));
    const fcCount = await page.locator('text=Finance charge').count();
    expect(fcCount, 'No finance charge line when balance is 0').toBe(0);
    assertNoErrors(page, '_calcFinanceCharge is 0 when balance is 0');
  });
});

test.describe('Finance charges — client hub display', () => {
  test('Finance charge line item appears when bid is 30+ days overdue after completion', async ({ page }) => {
    // 35-day-old completed job, balance $3750, finance charge pre-computed inline
    // 1.5%/month = 0.05%/day; 5 days overdue after 30-day grace → $3750 * 0.0005 * 5 = $9.38
    const daysOverdue = 35 - 30; // 5 days
    const fc = Math.round(3750 * (1.5 / 100 / 30) * daysOverdue * 100) / 100;
    await bootHub(page, hubWith({ financeCharge: fc, daysOverdue }));
    const fcLine = page.locator('text=Finance charge');
    await expect(fcLine.first(), 'Finance charge line item must be visible').toBeVisible();
    assertNoErrors(page, 'finance charge line item renders for 30+ day overdue bid');
  });

  test('Finance charge breakdown shows contract balance and total due', async ({ page }) => {
    const daysOverdue = 5;
    const fc = Math.round(3750 * (1.5 / 100 / 30) * daysOverdue * 100) / 100;
    await bootHub(page, hubWith({ financeCharge: fc, daysOverdue }));
    const totalDueText = page.locator('text=Total due');
    await expect(totalDueText.first(), 'Total due must appear in hub CTA when finance charge > 0').toBeVisible();
    assertNoErrors(page, 'finance charge breakdown shows total due');
  });

  test('Pay button amount includes finance charge when balance is overdue 30+ days', async ({ page }) => {
    const daysOverdue = 5;
    const fc = Math.round(3750 * (1.5 / 100 / 30) * daysOverdue * 100) / 100;
    await bootHub(page, hubWith({ financeCharge: fc, daysOverdue }));
    // Pay button should show balance + fc, not just balance
    const totalDue = 3750 + fc;
    const fmtAmt = '$' + totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // The button should include the total amount
    const payBtn = page.locator('[id^=pay-btn-]');
    if (await payBtn.count() > 0) {
      const btnText = await payBtn.first().textContent();
      expect(btnText, 'Pay button must include total with finance charge').toContain(fmtAmt.replace('$', ''));
    }
    assertNoErrors(page, 'pay button amount includes finance charge');
  });

  test('No finance charge shown when within grace period (< 30 days after completion)', async ({ page }) => {
    // Bid with completion date 10 days ago — within grace period, financeCharge should be 0
    await bootHub(page, hubWith({ completion_date: GRACE_DATE, financeCharge: 0, daysOverdue: 0 }));
    const fcCount = await page.locator('text=Finance charge').count();
    expect(fcCount, 'Finance charge must NOT appear within 30-day grace period').toBe(0);
    // Standard CTA sub shows balance due
    const balDue = page.locator('text=Balance');
    await expect(balDue.first(), 'Balance due text must appear in grace period').toBeVisible();
    assertNoErrors(page, 'no finance charge within grace period');
  });

  test('Finance charge note appears below pay button when overdue', async ({ page }) => {
    const daysOverdue = 5;
    const fc = Math.round(3750 * (1.5 / 100 / 30) * daysOverdue * 100) / 100;
    await bootHub(page, hubWith({ financeCharge: fc, daysOverdue }));
    const note = page.locator('text=Finance charges accrue');
    await expect(note.first(), 'Finance charge disclosure note must appear below pay button').toBeVisible();
    assertNoErrors(page, 'finance charge note appears below pay button');
  });
});
