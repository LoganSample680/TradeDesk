// @ts-check
// ── Next: the one thing this customer is waiting on ──────────────────────────
//
// Owner 2026-09-29: "a Next button on each customer/job pointing at the single
// next step." Money first (worked and not billed, then billed and not
// collected), then the paperwork that gets to money. New proposal stays one
// tap away under it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Next on the customer page', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Seeds one customer, the bids and jobs given, and opens their page.
  const show = (o) => page.evaluate((opt) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,[data-bdov]').forEach(e => e.remove());
    clients.length = 0; bids.length = 0; jobs.length = 0;
    if (typeof payments !== 'undefined') payments.length = 0;
    _tb = opt.ready ? { at: Date.now(), lab: opt.ready } : null;
    clients.push({ id: 93001, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603', phone: opt.phone === false ? '' : '7855550100' });
    (opt.bids || []).forEach(b => bids.push(Object.assign({ client_id: 93001 }, b)));
    (opt.jobs || []).forEach(j => jobs.push(Object.assign({ client_id: 93001 }, j)));
    if (opt.readyRows) window._tbRows = () => opt.readyRows;
    openClientDetail(93001);
    const n = document.getElementById('cd-next');
    return {
      next: n ? n.textContent.replace(/\s+/g, ' ').trim() : null,
      nx: _clientNext(93001),
      newProp: [...document.querySelectorAll('#cd-estimate-actions button')].some(b => /New proposal/.test(b.textContent)),
      // Measured in the same pass as the render: a late boot sync can swap
      // the arrays and re-render the page between two evaluates.
      sw: document.documentElement.scrollWidth, w: innerWidth,
      right: n ? n.getBoundingClientRect().right : null,
      filled: [...document.querySelectorAll('#cd-estimate-actions button')].filter(b => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
    };
  }, o || {});

  const daysAgo = (n) => page.evaluate((d) => addDays(todayKey(), -d), n);

  test('a new lead has no Next, just New proposal', async () => {
    const r = await show();
    expect(r.next).toBeNull();
    expect(r.nx).toBeNull();
    expect(r.newProp).toBe(true);
  });

  test('a saved proposal nobody sent: Send the proposal', async () => {
    const r = await show({ bids: [{ id: 501, status: 'Pending', amount: 2400, bid_date: await daysAgo(1) }] });
    expect(r.nx.k).toBe('send');
    expect(r.next).toContain('Send the proposal');
    expect(r.newProp).toBe(true);
  });

  test('sent and not signed for days: Follow up, which texts them', async () => {
    const r = await show({ bids: [{ id: 502, status: 'Pending', amount: 2400, signingToken: 't', bid_date: await daysAgo(5) }] });
    expect(r.nx).toMatchObject({ k: 'follow', fn: 'textClient()' });
    expect(r.next).toContain('Proposal out 5 days');
  });

  test('sent yesterday is not chased yet', async () => {
    const r = await show({ bids: [{ id: 503, status: 'Pending', amount: 2400, signingToken: 't', bid_date: await daysAgo(1) }] });
    expect(r.nx.k).toBe('wait');
  });

  test('no phone means no Follow up to text', async () => {
    const r = await show({ phone: false, bids: [{ id: 504, status: 'Pending', amount: 2400, signingToken: 't', bid_date: await daysAgo(9) }] });
    expect(r.nx.k).toBe('wait');
  });

  test('signed and not on the calendar: Schedule the job', async () => {
    const r = await show({ bids: [{ id: 505, status: 'Closed Won', amount: 3000, bid_date: await daysAgo(2) }] });
    expect(r.nx).toMatchObject({ k: 'schedule', fn: 'schedFromBid(505)' });
  });

  test('signed and scheduled with a balance: Collect it', async () => {
    const r = await show({
      bids: [{ id: 506, status: 'Closed Won', amount: 3000, bid_date: await daysAgo(20) }],
      jobs: [{ id: 7001, bid_id: 506, start: await daysAgo(10), days: 1, status: 'done' }],
    });
    expect(r.nx.k).toBe('collect');
    expect(r.next).toContain('Collect $3,000');
  });

  test('worked and not billed beats everything else', async () => {
    const r = await show({
      bids: [{ id: 507, status: 'Pending', amount: 2400, bid_date: await daysAgo(1) }],
      ready: [{}], readyRows: [{ cid: 93001, name: 'Ray Whitcomb', pick: '412 Bell St', days: ['2026-09-20', '2026-09-21'], total: 1240 }],
    });
    expect(r.nx.k).toBe('bill');
    expect(r.next).toContain('Bill $1,240');
    expect(r.next).toContain('2 days of work not billed yet');
  });

  test('another house on Ready to bill is not this customer', async () => {
    const r = await show({ ready: [{}], readyRows: [{ cid: 99999, name: 'Someone', pick: '', days: ['2026-09-20'], total: 500 }] });
    expect(r.nx).toBeNull();
  });

  test('Next is the only big button, and nothing bleeds at 390', async () => {
    const r = await show({ bids: [{ id: 508, status: 'Closed Won', amount: 3000, bid_date: await daysAgo(2) }] });
    expect(r.right).not.toBeNull();
    expect(r.sw).toBeLessThanOrEqual(r.w + 1);
    expect(r.right).toBeLessThanOrEqual(r.w);
    expect(r.filled).toBe(1);
  });

  test('junk ids are null, not a throw', async () => {
    const r = await page.evaluate(() => [_clientNext(null), _clientNext(undefined), _clientNext('nope'), _clientNext(-1)]);
    expect(r).toEqual([null, null, null, null]);
  });

  test('no console errors, client next', async () => {
    await page.evaluate(() => { _tb = null; });
    assertNoErrors(page, 'client next');
  });
});
