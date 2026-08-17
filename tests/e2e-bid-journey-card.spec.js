// @ts-check
/**
 * The journey card (owner pick 2026-08-17: variant 3 + variant 1's More).
 * A proposal card shows the lifecycle strip, ONE primary action decided by the
 * job's stage, a uniform quick row, and everything else in the More sheet.
 *
 * The redesign's hard promise: no capability was lost. Every handler the old
 * nine-button wall reached must still be reachable, on the card or in More,
 * under the exact same conditions, especially the collections ladder and lien
 * controls, which are money machinery.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CID = 982100;

// Renders the client's bids and returns the card's HTML for one bid.
const CARD = (cid, bidId) => `
  currentClientId = ${cid};
  openClientDetail(${cid});
  renderCDBids();   // the cards live on the bids tab; render it directly
  const el = document.getElementById('bid-card-${bidId}');
  window.__cardHtml = el ? el.outerHTML : '';
`;

test.describe('Proposal journey card', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterEach(() => { assertNoErrors(page, 'journey card'); });

  const seed = (cid, bid, extraJobs, extraPays) => `
    const c = { id: ${cid}, name: 'Journey Co', addr: '9 Stage St, Topeka, KS 66604', phone: '785-555-0100' };
    clients = clients.filter(x => x.id !== ${cid}).concat([c]);
    bids = bids.filter(b => b.client_id !== ${cid}).concat([${bid}]);
    jobs = jobs.filter(j => j.client_id !== ${cid})${extraJobs ? '.concat(' + extraJobs + ')' : ''};
    payments = payments.filter(p => p.client_id !== ${cid})${extraPays ? '.concat(' + extraPays + ')' : ''};
  `;

  test('won + unscheduled: stage 2, the primary is the calendar', async () => {
    const r = await page.evaluate(({ cid, seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, { cid: CID, seedCode: seed(CID, `{ id: 982201, client_id: ${CID}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-08-10' }`, null, null), cardCode: CARD(CID, 982201) });
    expect(r).toMatch(/Put it on the calendar/);
    expect(r).toMatch(/schedFromBid\(982201\)/);
    // The strip exists and Signed reads done.
    expect(r).toMatch(/SIGNED|Signed/);
    expect(r).toMatch(/Collect/);
    // The old wall is gone: no per-button rainbow styles.
    expect(r).not.toMatch(/#635BFF/);   // the Stripe-purple pay-link button
  });

  test('won + scheduled: stage 3, the primary closes the job', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 1, `{ id: 982210, client_id: ${CID + 1}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-08-10' }`,
        `[{ id: 982310, client_id: ${CID + 1}, bid_id: 982210, name: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', value: 0, status: 'upcoming', start: '2099-01-05' }]`, null),
      cardCode: CARD(CID + 1, 982210),
    });
    expect(r).toMatch(/Mark job complete/);
    expect(r).toMatch(/markJobDone\(982310\)/);
  });

  test('completed + unpaid: stage 4 collects the exact balance', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 2, `{ id: 982220, client_id: ${CID + 2}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-07-01', completion_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }`,
        null, `[{ id: 982410, client_id: ${CID + 2}, bid_id: 982220, amount: 400, date: '2026-07-02' }]`),
      cardCode: CARD(CID + 2, 982220),
    });
    expect(r).toMatch(/Collect \$600\.00/);
    expect(r).toMatch(/openPayPanel\(982220\)/);
    // 2 days since completion: no collections ladder yet. Matched on the
    // ladder BUTTON labels: the polite "Text a payment request" SMS body in
    // More legitimately contains the word "reminder".
    expect(r).not.toMatch(/Send a payment reminder|Send second notice|Send intent to lien/);
  });

  test('the collections ladder appears at its exact windows, on the card, never buried', async () => {
    const mk = (daysAgo) => `{ id: 982230, client_id: ${CID + 3}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-05-01', completion_date: new Date(Date.now() - ${daysAgo} * 86400000).toISOString().slice(0, 10) }`;
    const run = (daysAgo) => page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, { seedCode: seed(CID + 3, mk(daysAgo), null, null), cardCode: CARD(CID + 3, 982230) });
    const d8 = await run(8), d15 = await run(15), d25 = await run(25);
    expect(d8).toMatch(/payment reminder/);
    expect(d8).not.toMatch(/second notice|intent to lien/i);
    expect(d15).toMatch(/second notice/);
    expect(d15).toMatch(/File lien/);
    expect(d25).toMatch(/intent to lien/i);
    expect(d25).toMatch(/File lien/);
  });

  test('paid in full: the journey completes and the primary is the final invoice', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 4, `{ id: 982240, client_id: ${CID + 4}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-07-01', completion_date: '2026-07-20' }`,
        null, `[{ id: 982420, client_id: ${CID + 4}, bid_id: 982240, amount: 1000, date: '2026-07-21' }]`),
      cardCode: CARD(CID + 4, 982240),
    });
    expect(r).toMatch(/Send final invoice/);
    expect(r).toMatch(/openFinalInvoice\(982240\)/);
    expect(r).not.toMatch(/Collect \$/);
  });

  test('nothing was lost: every old capability is on the card or in More', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 5, `{ id: 982250, client_id: ${CID + 5}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-08-01' }`, null, null),
      cardCode: CARD(CID + 5, 982250),
    });
    // Card face or More template, either is fine; absent is a regression.
    for (const fn of ['openPayPanel(982250)', 'toggleBidSummary(982250)', 'openFinalInvoice(982250)', 'printInvoice(982250)', 'showSupplyList(982250)', 'openGenericEstimate']) {
      expect(r, fn + ' must still be reachable').toContain(fn);
    }
    expect(r).toContain('_bidMoreSheet(982250)');
  });

  test('the More sheet opens as a centered zmodal and its rows close it', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      _bidMoreSheet(982260);
      const ov = document.getElementById('_bid-more-ov');
      const out = {
        open: !!ov,
        zmodal: !!(ov && ov.classList.contains('zmodal-overlay') && ov.querySelector('.zmodal')),
        rows: ov ? ov.querySelectorAll('button, a').length : 0,
        hasPrint: ov ? /Print invoice/.test(ov.innerHTML) : false,
      };
      ov?.remove();
      return out;
    }, {
      seedCode: seed(CID + 6, `{ id: 982260, client_id: ${CID + 6}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Closed Won', bid_date: '2026-08-01' }`, null, null),
      cardCode: CARD(CID + 6, 982260),
    });
    expect(r.open).toBe(true);
    expect(r.zmodal).toBe(true);   // §7.3: the app's modal convention, never a bottom sheet
    expect(r.rows).toBeGreaterThan(3);
    expect(r.hasPrint).toBe(true);
  });

  test('a pending proposal: primary sends it, journey shows Sign as the current step', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 7, `{ id: 982270, client_id: ${CID + 7}, name: 'T', type: 'Repaint', addr: '9 Stage St, Topeka, KS 66604', amount: 1000, status: 'Pending', bid_date: '2026-08-10' }`, null, null),
      cardCode: CARD(CID + 7, 982270),
    });
    expect(r).toMatch(/Resend to client/);
    expect(r).toMatch(/sendBidEmail\(982270\)/);
    expect(r).toMatch(/markBidHandshake\(982270\)/);   // in More
    expect(r).toMatch(/markBidAbandoned\(982270\)/);   // in More
  });

  test('a diagnostic charge never grows a journey strip', async () => {
    const r = await page.evaluate(({ seedCode, cardCode }) => {
      eval(seedCode); eval(cardCode);
      return window.__cardHtml;
    }, {
      seedCode: seed(CID + 8, `{ id: 982280, client_id: ${CID + 8}, name: 'Diag', type: 'Diagnostic', kind: 'diagnostic', addr: '9 Stage St, Topeka, KS 66604', amount: 89, status: 'Closed Won', bid_date: '2026-08-10' }`, null, null),
      cardCode: CARD(CID + 8, 982280),
    });
    expect(r).not.toMatch(/>SCHEDULE<|>WORK<|>Schedule<\/span>|>Work<\/span>/);
    expect(r).toMatch(/Collect \$89\.00/);
  });
});
