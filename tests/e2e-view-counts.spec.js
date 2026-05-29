// @ts-check
/**
 * E2E tests for proposal view counts and timezone-aware timestamps.
 *
 * What we verify:
 * 1. Dashboard shows view counts (e.g. "3×") when hub_view_count > 1
 * 2. Dashboard shows "Today at H:MM AM/PM" for timestamps from today
 * 3. Dashboard shows "Yesterday at H:MM AM/PM" for timestamps from yesterday
 * 4. Dashboard shows "Mon, May 25 at H:MM AM/PM" for older timestamps
 * 5. View count of 1 shows no "×" suffix (clean — don't show "1×")
 * 6. Both Hub and Proposal opened badges show when both timestamps present
 * 7. Zero console errors throughout
 */

const {
  test, expect,
  mockAllExternal, waitForAppBoot, goPg, assertNoErrors,
  FAKE_BID_ID_1, FAKE_USER_ID,
} = require('./helpers');

// Unique bid IDs for this test file — don't collide with FAKE_BID_ID_1 used elsewhere
const VC_BID_ID = 800001;

// ── Shared setup helper ────────────────────────────────────────────────────────

/**
 * Inject a pending bid + view data into the in-memory store, then re-render
 * the dashboard. Mirrors exactly what the e2e-proposal-ux pipeline test does.
 */
async function injectViewsAndRender(page, opts = {}) {
  const {
    hubTs        = new Date().toISOString(),
    clientTs     = null,
    contractorTs = null,
    hubCount     = 1,
    clientCount  = 0,
    bidId        = VC_BID_ID,
  } = opts;

  await page.evaluate(({ bidId, hubTs, clientTs, contractorTs, hubCount, clientCount }) => {
    // Add (or replace) a pending bid — push so we don't clobber the existing array
    const existing = window.bids.findIndex(b => b.id === bidId);
    const bid = {
      id: bidId,
      client_id: 99901,
      amount: 3500,
      status: 'Pending',
      bid_date: new Date().toISOString().slice(0, 10),
      signingToken: 'vc-test-token',
    };
    if (existing >= 0) window.bids[existing] = bid;
    else window.bids.push(bid);

    // Add client if not already there
    if (!window.clients.find(c => c.id === 99901)) {
      window.clients.push({ id: 99901, name: 'Jerome Bettis', phone: '4125551234', email: 'bettis@steelers.com' });
    }

    // Set view tracking maps (these hit the defineProperty setters on window
    // which write back to the module-level let variables)
    window._proposalViewsByBidHubClient    = hubTs    ? { [String(bidId)]: hubTs }    : {};
    window._proposalViewsByBidClient       = clientTs ? { [String(bidId)]: clientTs } : {};
    window._proposalViewsByBidContractor   = contractorTs ? { [String(bidId)]: contractorTs } : {};
    window._proposalViewsByBidHubCount     = { [String(bidId)]: hubCount };
    window._proposalViewsByBidClientCount  = { [String(bidId)]: clientCount };

    // Make sure the "Make Money Today" section isn't collapsed
    window._mmtCol_pending = false;

    if (typeof renderDash === 'function') renderDash();
  }, { bidId, hubTs, clientTs, contractorTs, hubCount, clientCount });

  await page.waitForTimeout(250);
}

// ── Dashboard view count + timestamp tests ─────────────────────────────────────

test.describe('Dashboard — view counts and timezone timestamps', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Stay on dashboard (default landing page after boot)
  });

  test.afterAll(async () => { await page.context().close(); });

  test('shows time-relative label for hub opened timestamp from 90 minutes ago', async () => {
    // Compute timestamp and expected label inside the browser so both use the same
    // local timezone as _localTs() in dashboard.js. Near midnight UTC the 90-min-ago
    // timestamp crosses a date boundary, making "Today at" wrong but "Yesterday at" correct.
    const { ts, expectedLabel } = await page.evaluate(() => {
      const d = new Date(Date.now() - 90 * 60 * 1000);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yest  = new Date(today.getTime() - 86400000);
      let label;
      if (d >= today) label = 'Today at';
      else if (d >= yest) label = 'Yesterday at';
      else label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      return { ts: d.toISOString(), expectedLabel: label };
    });

    await injectViewsAndRender(page, { hubTs: ts, hubCount: 1 });

    const text = await page.textContent('#pg-dash');
    expect(text, 'Dashboard must say "Hub opened"').toContain('Hub opened');
    expect(text, `Dashboard must show "${expectedLabel}" for 90-min-old timestamp`).toContain(expectedLabel);

    assertNoErrors(page, 'dashboard today timestamp');
  });

  test('shows view count "3×" suffix when hub_view_count > 1', async () => {
    const ts = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    await injectViewsAndRender(page, { hubTs: ts, hubCount: 3 });

    const text = await page.textContent('#pg-dash');
    expect(text, 'Dashboard must show 3× view count').toContain('3×');

    assertNoErrors(page, 'dashboard view count 3x');
  });

  test('does NOT show "1×" when view count is 1', async () => {
    const ts = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    await injectViewsAndRender(page, { hubTs: ts, hubCount: 1 });

    const text = await page.textContent('#pg-dash');
    expect(text, 'Dashboard must not show "1×" (redundant)').not.toContain('1×');

    assertNoErrors(page, 'dashboard no 1x suffix');
  });

  test('shows "Yesterday at H:MM" for hub opened yesterday', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 30, 0, 0); // 2:30 PM yesterday — well past 60m cutoff
    await injectViewsAndRender(page, { hubTs: yesterday.toISOString(), hubCount: 1 });

    const text = await page.textContent('#pg-dash');
    expect(text, 'Dashboard must say "Yesterday at" for yesterday\'s open').toContain('Yesterday at');

    assertNoErrors(page, 'dashboard yesterday timestamp');
  });

  test('shows weekday date for hub opened 4+ days ago', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 4);
    old.setHours(10, 15, 0, 0);
    await injectViewsAndRender(page, { hubTs: old.toISOString(), hubCount: 2 });

    const text = await page.textContent('#pg-dash');
    // Should contain "at" (e.g. "Mon, May 22 at 10:15 AM") but NOT "Today" or "Yesterday"
    expect(text, 'Old timestamp must contain " at " (date + time)').toContain(' at ');
    expect(text, 'Old timestamp must not say "Today"').not.toContain('Today at');
    expect(text, 'Old timestamp must not say "Yesterday"').not.toContain('Yesterday at');

    assertNoErrors(page, 'dashboard old date timestamp');
  });

  test('shows both Hub opened and Proposal opened when both timestamps present', async () => {
    const hubTime    = new Date(Date.now() - 120 * 60 * 1000); // 2h ago
    const clientTime = new Date(Date.now() -  75 * 60 * 1000); // 75m ago

    await injectViewsAndRender(page, {
      hubTs:       hubTime.toISOString(),    hubCount:    2,
      clientTs:    clientTime.toISOString(), clientCount: 1,
    });

    const text = await page.textContent('#pg-dash');
    expect(text, '"Hub opened" badge must appear').toContain('Hub opened');
    expect(text, '"Proposal opened" badge must appear').toContain('Proposal opened');
    expect(text, 'Hub view count 2× must appear').toContain('2×');

    assertNoErrors(page, 'dashboard both timestamps');
  });

  test('shows "Client hasn\'t opened yet" when no timestamps', async () => {
    await injectViewsAndRender(page, {
      hubTs: null, clientTs: null, contractorTs: null,
      hubCount: 0, clientCount: 0,
    });

    const text = await page.textContent('#pg-dash');
    expect(text, 'Must show not-opened message').toContain("hasn't opened yet");

    assertNoErrors(page, 'dashboard not opened yet');
  });
});
