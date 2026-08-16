// @ts-check
/**
 * The client hub snapshot carries the estimate's SCOPE, not just its type.
 *
 * Owner 2026-08-16, asking how the invoice pulls detail from the proposal: it did
 * not. The invoice rendered bid.lineItems, a field no bid has ever had, so every
 * real invoice fell through to a single line reading the estimate type. The rich
 * "Work performed" list only ever appeared in seeded screenshots.
 *
 * bid.scope is now derived from where scope actually lives: surfaces on a paint
 * estimate (grouped by room), scopeChips and geiDesc on generic and BYO estimates,
 * desc on a diagnostic. Strings only, by construction, so the one-price rule holds:
 * there is no quantity or rate in this list to leak onto the document.
 */
const { test, expect, mockAllExternal, waitForAppBoot } = require('./helpers');
test('snapshot derives scope from each estimate type', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
  const r = await page.evaluate(() => {
    clients.push({ id: 96001, name: 'Scope Client', phone: '3165550100', addr: '7 Scope St' });
    bids.push({ id: 960010, client_id: 96001, amount: 2000, status: 'Closed Won', type: 'Interior',
      surfaces: [{ room: 'Living Room', type: 'walls', qty: 400 }, { room: 'Living Room', type: 'ceiling', qty: 200 },
                 { room: 'Hallway', type: 'walls', qty: 120 }] });
    bids.push({ id: 960011, client_id: 96001, amount: 1500, status: 'Closed Won', type: 'Build Your Own Estimate',
      scopeChips: ['Panel upgrade', 'Add two circuits'], geiDesc: 'Replace exterior GFCI\nHaul off debris' });
    const snap = _buildClientHubSnapshot(96001);
    const a = snap.bids.find(b => b.id === 960010), b = snap.bids.find(b => b.id === 960011);
    return { paint: a.scope, gen: b.scope };
  });
  console.log(JSON.stringify(r, null, 1));
  expect(r.paint).toEqual(['Living Room: walls, ceiling', 'Hallway: walls']);
  expect(r.gen).toEqual(['Panel upgrade', 'Add two circuits', 'Replace exterior GFCI', 'Haul off debris']);
  await ctx.close();
});
