// @ts-check
/**
 * The client hub closes, and gets the contractor paid early.
 *
 * Owner, 2026-09-24: "remember the hub has to close and allow them to take
 * action to pay early if they want ... hub needs to close just as good as the
 * proposals do", then "I just want it to work but close people but also get
 * the contractor paid early, cause who wouldn't love to be paid in full early?"
 *
 * What these hold:
 *  - What is due NOW leads: a deposit to start, with PAYING IN FULL as the big
 *    button and the deposit right under it; an overdue balance with its charge.
 *  - A balance due only at completion is offered as "pay early", never as due.
 *  - Paying clears what was paid, not the whole balance.
 *  - A declined proposal never comes back as a win on the re-check.
 *  - The job card says Scheduled before it starts (not "In progress").
 */
const { test, expect, mockAllExternal, assertNoErrors, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const base = (x) => Object.assign({
  contractorUserId: FAKE_USER_ID, contractorName: 'Pruitt Plumbing', businessName: 'Pruitt Plumbing',
  contractorPhone: '785-555-0142', clientName: 'Barry & Hetty Bucknell', clientAddr: '1810 SW Western Ave, Topeka, KS 66604',
  clientToken: FAKE_TOKEN, brandColor: '#C2410C', stripeEnabled: true,
  jobs: [], payments: [], photos: [], messages: [], notifications: [], invoices: [],
}, x);
const heater = x => Object.assign({ id: 880001, type: 'Water heater replacement', amount: 4200, deposit: 1050, status: 'Closed Won',
  bid_date: day(-3), signedAt: new Date(Date.now() - 2 * 86400000).toISOString() }, x);
const painting = { id: 880002, type: 'Exterior painting', amount: 6800, deposit: 0, balance: 6800, status: 'Pending', bid_date: day(-1), signHubUrl: 'https://example.com/sign?key=x' };

async function boot(page, hub) {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(d => { window.__mockHubData = d; }, hub);
  await mockAllExternal(page);
  await page.goto(`/client.html?t=${FAKE_TOKEN}&u=${FAKE_USER_ID}&c=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

test.describe('the hub closes', () => {
  test('deposit due: pay in full leads, the deposit is right under it, and it comes before the next proposal', async ({ page }) => {
    await boot(page, base({ bids: [heater({ paid: 0, balance: 4200 }), painting] }));
    const r = await page.evaluate(() => {
      const card = document.getElementById('pay-card-880001');
      const main = document.getElementById('pay-btn-880001');
      const dep = document.getElementById('pay-dep-btn-880001');
      const sign = [...document.querySelectorAll('.hub-feed-hd')].find(x => /Awaiting your signature/.test(x.textContent));
      return {
        mainTxt: main && main.textContent.trim(), mainFn: main && main.getAttribute('onclick'),
        depTxt: dep && dep.textContent.trim(), depFn: dep && dep.getAttribute('onclick'),
        rows: card && card.textContent,
        before: !!(card && sign && (card.compareDocumentPosition(sign) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    expect(r.mainTxt).toBe('Pay the full $4,200.00');
    expect(r.mainFn).toBe('payBalance(880001)');
    expect(r.depTxt).toBe('Or pay the $1,050.00 deposit');
    expect(r.depFn).toBe('payDeposit(880001)');
    expect(r.rows).toContain('Deposit to start');
    expect(r.rows).toContain('Due when the work is done');
    expect(r.before, 'what is due now comes before the next proposal').toBe(true);
    assertNoErrors(page, 'deposit due');
  });

  test('balance due at completion: offered as "pay early", never as due, after the proposals to sign', async ({ page }) => {
    await boot(page, base({ bids: [heater({ paid: 1050, balance: 3150 }), painting],
      jobs: [{ id: 1, bid_id: 880001, name: 'Water heater replacement', start: day(6), status: 'scheduled' }] }));
    const r = await page.evaluate(() => {
      const card = document.getElementById('pay-card-880001');
      const btn = document.getElementById('pay-btn-880001');
      const sign = [...document.querySelectorAll('.hub-feed-hd')].find(x => /Awaiting your signature/.test(x.textContent));
      return { txt: card && card.textContent, btn: btn && btn.textContent.trim(),
        after: !!(card && sign && (sign.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)),
        timelineBadge: [...document.querySelectorAll('.hub-badge')].map(b => b.textContent.trim()) };
    });
    expect(r.btn).toBe('Pay the $3,150.00 early');
    expect(r.txt).toContain('Nothing is due before then');
    expect(r.after).toBe(true);
    expect(r.timelineBadge.join(' ')).toContain('Due when done');
    expect(r.timelineBadge.join(' ')).not.toContain('Balance due');
  });

  test('overdue: the charge is broken out and the button asks for the whole amount checkout will take', async ({ page }) => {
    await boot(page, base({ bids: [heater({ paid: 1050, balance: 3150, financeCharge: 47.25, daysOverdue: 34, completion_date: day(-40) })] }));
    const r = await page.evaluate(() => ({ txt: document.getElementById('pay-card-880001').textContent, btn: document.getElementById('pay-btn-880001').textContent.trim() }));
    expect(r.txt).toContain('Past due');
    expect(r.txt).toContain('Finance charge (34 days overdue)');
    expect(r.btn).toBe('Pay $3,197.25');
  });

  test('paying the deposit clears the deposit, not the whole balance', async ({ page }) => {
    await boot(page, base({ bids: [heater({ paid: 0, balance: 4200 })] }));
    const r = await page.evaluate(() => {
      sessionStorage.setItem('td_pay_880001', '105000');
      showPaymentSuccess(880001);
      const b = _hub.bids.find(x => x.id === 880001);
      return { paid: b.paid, balance: b.balance, paidInFull: !!document.querySelector('.hub-paid-banner') };
    });
    expect(r.paid).toBe(1050);
    expect(r.balance).toBe(3150);
    expect(r.paidInFull).toBe(false);
  });

  test('a declined proposal is never promoted to a win by the re-check', async ({ page }) => {
    await boot(page, base({ bids: [painting] }));
    const r = await page.evaluate(async () => {
      const real = window._supa;
      window._supa = { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ bid_id: '880002', payment_status: 'declined', signed_at: new Date().toISOString() }] }) }) }) }) };
      try { await _recheckSigned(); } finally { window._supa = real; }
      return _hub.bids.find(x => x.id === 880002).status;
    });
    expect(r).toBe('Pending');
  });

  test('a job that has not started says Scheduled and when, never "In progress"', async ({ page }) => {
    await boot(page, base({ bids: [heater({ paid: 1050, balance: 3150 })],
      jobs: [{ id: 1, bid_id: 880001, name: 'Water heater replacement', start: day(6), status: 'scheduled' }] }));
    const t = await page.evaluate(() => document.querySelector('.hub-feed-item').textContent);
    expect(t).toContain('Scheduled');
    expect(t).toMatch(/Starts \w{3}, \w{3} \d{1,2}/);
    expect(t).not.toContain('In progress');
  });

  test('his colour frames the page: the top bar and the floating nav, the active tab a white pill', async ({ page }) => {
    await boot(page, base({ bids: [painting] }));
    const r = await page.evaluate(() => {
      const nav = getComputedStyle(document.querySelector('.bottom-nav'));
      const act = getComputedStyle(document.querySelector('.bn-item.active'));
      return { navBg: nav.backgroundImage, radius: parseFloat(nav.borderTopLeftRadius), activeBg: act.backgroundColor,
        greet: document.querySelector('.hub-hero-greeting').textContent };
    });
    expect(r.navBg).toContain('gradient');
    expect(r.radius).toBeGreaterThanOrEqual(20);
    expect(r.activeBg).toBe('rgb(255, 255, 255)');
    expect(r.greet).toBe('Hi, Barry & Hetty');
  });
});
