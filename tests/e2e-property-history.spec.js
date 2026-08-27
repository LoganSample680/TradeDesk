// @ts-check
/**
 * A property card has to state the money and the schedule honestly.
 *
 * Owner screenshot 2026-08-16: a property with a signed $772.88 job read
 * "$0.00 of $0.00 paid" with the won proposal listed right underneath, and nothing
 * anywhere said the won job had never been put on the calendar. He drove to it.
 *
 * Root cause: getPropertyHistory summed only j.value for billed. A job created from
 * a proposal carries value 0, because the contract money lives on the bid, so a won
 * bid with no job (or with a value-less job) contributed nothing at all.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CID = 980100;

test.describe('Property history: billed money and unscheduled work', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterEach(() => { assertNoErrors(page, 'property history'); });

  // The owner's exact shape: one won bid carrying the money, two value-less jobs.
  test('a won bid with no job still counts toward billed', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid, name: 'FBC', addr: '6800 SW Tenth Ave, Topeka, KS 66615' };
      clients = clients.filter(x => x.id !== cid).concat([c]);
      bids = bids.filter(b => b.client_id !== cid).concat([
        { id: 980201, client_id: cid, name: 'Test', addr: c.addr, amount: 772.88, status: 'Closed Won', bid_date: '2026-08-14' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid).concat([
        { id: 980301, client_id: cid, name: 'FBC, proposal', addr: c.addr, value: 0, status: 'canceled', start: '2026-08-15' },
        { id: 980302, client_id: cid, name: 'FBC, proposal', addr: c.addr, value: 0, status: 'upcoming', start: '2026-08-08' },
      ]);
      payments = payments.filter(p => p.client_id !== cid);
      const h = getPropertyHistory(c, c.addr);
      return { billed: h.billed, paid: h.paid, props: h.proposals.length, jobs: h.jobs.length };
    }, CID);
    expect(r.billed).toBeCloseTo(772.88, 2);   // was 0: the contract lives on the bid
    expect(r.paid).toBeCloseTo(0, 2);
    expect(r.props).toBe(1);
    expect(r.jobs).toBe(2);
  });

  test('a job created from a won bid never double-counts the contract', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 1, name: 'Linked Co', addr: '10 Linked St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 1).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 1).concat([
        { id: 980210, client_id: c.id, name: 'Repaint', addr: c.addr, amount: 4000, status: 'Closed Won', bid_date: '2026-08-01' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 1).concat([
        // The job the bid produced, carrying a copy of the value
        { id: 980310, client_id: c.id, bid_id: 980210, name: 'Repaint', addr: c.addr, value: 4000, status: 'upcoming', start: '2026-08-20' },
        // A separate small job with its own money, no bid behind it
        { id: 980311, client_id: c.id, name: 'Touch-up', addr: c.addr, value: 250, status: 'upcoming', start: '2026-08-25' },
      ]);
      return getPropertyHistory(c, c.addr).billed;
    }, CID);
    expect(r).toBeCloseTo(4250, 2);   // 4000 once, not twice, plus the standalone 250
  });

  test('payments against the bid count as paid at the address', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 2, name: 'Paid Co', addr: '12 Paid Way, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 2).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 2).concat([
        { id: 980220, client_id: c.id, name: 'Job', addr: c.addr, amount: 1000, status: 'Closed Won', bid_date: '2026-08-01' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 2);
      payments = payments.filter(p => p.client_id !== cid + 2).concat([
        { id: 980401, client_id: c.id, bid_id: 980220, amount: 400, date: '2026-08-05' },
      ]);
      const h = getPropertyHistory(c, c.addr);
      return { billed: h.billed, paid: h.paid };
    }, CID);
    expect(r.billed).toBeCloseTo(1000, 2);
    expect(r.paid).toBeCloseTo(400, 2);
  });

  // The other half of the owner's report: nothing said the won job was unscheduled.
  test('a won proposal with nothing on the calendar is flagged Not scheduled', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 3, name: 'Sched Co', addr: '14 Sched Rd, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 3).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 3).concat([
        { id: 980230, client_id: c.id, name: 'Unscheduled work', type: 'Interior', addr: c.addr, amount: 772.88, status: 'Closed Won', bid_date: '2026-08-14' },
        { id: 980231, client_id: c.id, name: 'Scheduled work', type: 'Exterior', addr: c.addr, amount: 900, status: 'Closed Won', bid_date: '2026-08-10' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 3).concat([
        { id: 980330, client_id: c.id, bid_id: 980231, name: 'Scheduled work', addr: c.addr, value: 0, status: 'upcoming', start: '2026-08-22' },
      ]);
      payments = payments.filter(p => p.client_id !== cid + 3);
      currentClientId = c.id;
      openClientDetail(c.id);
      const el = document.getElementById('cd-addresses-list');
      const html = el ? el.innerHTML : '';
      return { flags: (html.match(/Not scheduled/g) || []).length, html: html.length };
    }, CID);
    // Exactly one: the bid with no job. The scheduled one must not be flagged.
    expect(r.flags).toBe(1);
  });

  test('a job with no value of its own shows the contract it came from, not $0.00', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 4, name: 'Zero Co', addr: '16 Zero St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 4).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 4).concat([
        { id: 980240, client_id: c.id, name: 'Deck', type: 'Deck stain', addr: c.addr, amount: 1850, status: 'Closed Won', bid_date: '2026-08-01' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 4).concat([
        { id: 980340, client_id: c.id, bid_id: 980240, name: 'Deck', addr: c.addr, value: 0, status: 'upcoming', start: '2026-08-20' },
      ]);
      payments = payments.filter(p => p.client_id !== cid + 4);
      currentClientId = c.id;
      openClientDetail(c.id);
      const el = document.getElementById('cd-addresses-list');
      const html = el ? el.innerHTML : '';
      // Only the WORK ROWS: the header legitimately reads "$0.00 of $1,850.00 paid"
      // because nothing has been paid yet. Row money cells are DIVs holding just an
      // amount; the header total is a SPAN, so this picks out the rows exactly.
      const rowAmounts = [...el.querySelectorAll('div')]
        .map(d => d.textContent.trim())
        .filter(t => /^\$[\d,]+\.\d\d$/.test(t));
      return { hasBidAmount: /\$1,850\.00/.test(html), rowAmounts };
    }, CID);
    expect(r.hasBidAmount).toBe(true);
    expect(r.rowAmounts).not.toContain('$0.00');   // a job row never reads as free work
    expect(r.rowAmounts).toContain('$1,850.00');   // it shows the contract behind it
  });
});
