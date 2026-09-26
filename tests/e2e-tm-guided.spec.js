// @ts-check
/**
 * The T&M and Build Your Own bars hold his hand to Send.
 *
 * Owner, 2026-09-26: "even I would race to get the proposal done, there was a
 * ton of shit I would've missed if my hand wasn't held, rate, how much my
 * hourly number was, how many people, Tim's recommendations to add more
 * steps, also didn't see away to add the model after the fact once I said to
 * add in all of Tim's recommendations".
 *
 * His rate and one person are filled in for him, so the bar went from Build
 * the steps straight to Send it and nothing was ever looked at. Now the one
 * button at the bottom walks him: what Tim caught, Tim's questions (the
 * permit, the unit), the rate and the people in one Yes that says the numbers,
 * then Send.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the bar walks him to Send', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const open = (id) => page.evaluate((id) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
    currentClientId = id; _activeTrade = 'plumbing';
    openTMEstimate(getClientById(id));
    document.getElementById('gei-scope-say').value = 'Pull the old water heater, run new pex to the manifold and set a tankless';
  }, id);
  const bar = () => page.evaluate(() => [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()));
  // The bar ignores a tap for 700ms after its label changes (a double tap
  // must not send); a person's next tap comes later than that.
  const tap = async () => { await page.waitForTimeout(750); await page.locator('#tm-dock-go').click(); await page.waitForTimeout(400); };

  test('Build, what Tim caught, his questions, the rate, then Send', async () => {
    await open(99401);
    await page.waitForTimeout(400);
    await tap();
    expect((await bar())[0]).toMatch(/^Tim caught \d+ things you left out$/);
    // Add all takes the steps; the permit and the unit are his to answer.
    await page.locator('#tm-scope-wrap button', { hasText: /^Add all/ }).first().click();
    await page.waitForTimeout(300);
    expect(await bar()).toEqual(['Tim has 2 questions']);
    // The bar takes him to them, with the cursor in the unit's box: the way to
    // add the model after Add all.
    await tap();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('tim-ask-detail-model');
    await page.locator('#gei-tm-page .ios-tim .ios-no', { hasText: /^No$/ }).first().click();
    await page.fill('#tim-ask-detail-model', 'Navien NPE-240A');
    await page.locator('#gei-tm-page .ios-tim .ios-ask-row .ios-pill').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => _geiScopeChips.some(c => /Navien NPE-240A/.test(c))), 'the unit is named on the job').toBe(true);
    expect(await page.evaluate(() => _geiScopeChips.some(c => /permit/i.test(c))), 'No means no permit').toBe(false);
    // The rate: first he is taken to it, then the Yes says the numbers.
    expect(await bar()).toEqual(['Check your rate']);
    expect(await page.evaluate(() => document.getElementById('tm-step-2').getAttribute('data-state')), 'not ticked while unchecked').toBe('now');
    await tap();
    expect(await bar()).toEqual(['Yes: $45/hr, 1 person']);
    await tap();
    expect(await bar()).toEqual(['Sign here', 'Send it']);
    expect(await page.evaluate(() => document.getElementById('tm-step-2').getAttribute('data-state'))).toBe('done');
  });

  test('changing the rate or the people is checking them: no Yes needed', async () => {
    await open(99402);
    await page.waitForTimeout(400);
    await tap();
    await page.evaluate(() => { _geiScopeMissed.length = 0; _tmRenderSteps(); });
    expect(await bar()).toEqual(['Check your rate']);
    await page.locator('#tm-sec-bill button[aria-label="One more"]').click();
    await page.waitForTimeout(200);
    expect(await bar()).toEqual(['Sign here', 'Send it']);
    await open(99403);
    await page.waitForTimeout(400);
    await tap();
    await page.evaluate(() => { _geiScopeMissed.length = 0; _tmRenderSteps(); });
    await page.locator('#tm-i-rate').fill('95');
    await page.locator('#tm-i-rate').dispatchEvent('input');
    await page.waitForTimeout(200);
    expect(await bar()).toEqual(['Sign here', 'Send it']);
  });

  test('a new proposal asks again; the one he checked is remembered', async () => {
    await open(99404);
    await page.waitForTimeout(400);
    await tap();
    await page.evaluate(() => { _geiScopeMissed.length = 0; _tmMarkRateChecked(); });
    const bidA = await page.evaluate(() => _geiEditBidId);
    expect(await bar()).toEqual(['Sign here', 'Send it']);
    await open(99405);
    await page.waitForTimeout(400);
    await tap();
    await page.evaluate(() => { _geiScopeMissed.length = 0; _tmRenderSteps(); });
    expect(await bar(), 'a different proposal is checked on its own').toEqual(['Check your rate']);
    expect(await page.evaluate((id) => { _geiEditBidId = id; return _tmRateChecked(); }, bidA)).toBe(true);
  });

  // ── BUILD YOUR OWN, SAME WALK (owner, 2026-09-26: "BYO should carry over as
  // much as possible with shared code") ──────────────────────────────────────
  // One Tim step, one card with a No on every row, one "check the figures"
  // step. BYO has no hourly rate: what it fills in for him is the deposit, and
  // the Yes says the total and the deposit. Tim comes before the prices, since
  // a step he adds is a line that needs one.
  const openByo = (id) => page.evaluate((id) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
    currentClientId = id; _activeTrade = 'plumbing';
    S.priceBook = S.priceBook || {}; S.priceBook.plumbing = [];
    openGenericEstimate(getClientById(id), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
    document.getElementById('byo-say').value = 'Pull the old water heater, run new pex to the manifold and set a tankless';
  }, id);
  const byoBar = () => page.evaluate(() => [...document.querySelectorAll('#byo-dock .ios-btn')].map(b => b.textContent.trim()));
  const byoTap = async () => { await page.waitForTimeout(750); await page.locator('#byo-dock-go').click(); await page.waitForTimeout(400); };

  test('BYO: build, what Tim caught, his questions, the prices, the total and deposit, then Send', async () => {
    await openByo(99410);
    await page.waitForTimeout(400);
    await byoTap();
    expect((await byoBar())[0]).toMatch(/^Tim caught \d+ things you left out$/);
    await page.locator('#gei-byo-page button', { hasText: /^Add all/ }).first().click();
    await page.waitForTimeout(300);
    expect(await byoBar()).toEqual(['Tim has 2 questions']);
    await byoTap();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('tim-ask-detail-model');
    // The same card as T&M: a No beside every Add.
    const noes = await page.evaluate(() => [...document.querySelectorAll('#gei-byo-page .ios-tim .ios-no')].map(b => b.textContent.trim()));
    expect(noes).toEqual(['No', 'Skip this']);
    await page.locator('#gei-byo-page .ios-tim .ios-no', { hasText: /^No$/ }).first().click();
    // Scoped to this screen: the T&M page above still holds its own hidden
    // copy of the box, which is the bug _timMissAskEl fixes.
    await page.fill('#gei-byo-page #tim-ask-detail-model', 'Navien NPE-240A');
    await page.locator('#gei-byo-page .ios-tim .ios-ask-row .ios-pill').click();
    await page.waitForTimeout(300);
    expect(await byoBar()).toEqual(['Price every line']);
    await page.evaluate(() => { _byoItems.forEach(it => { if (!(Number(it.price) > 0)) { it.price = 350; it.rate = 350; } }); _byoRenderSections(); _byoUpdateRail(); });
    expect(await byoBar()).toEqual(['Check the price']);
    expect(await page.evaluate(() => document.getElementById('byo-step-2').getAttribute('data-state')), 'not ticked while unchecked').toBe('now');
    await byoTap();
    expect((await byoBar())[0]).toMatch(/^Yes: \$[\d,]+, 25% deposit$/);
    await byoTap();
    expect(await byoBar()).toEqual(['Sign here', 'Send it']);
    expect(await page.evaluate(() => document.getElementById('byo-step-2').getAttribute('data-state'))).toBe('done');
  });

  test('BYO: changing the deposit is checking it', async () => {
    await openByo(99411);
    await page.waitForTimeout(400);
    await byoTap();
    await page.evaluate(() => { _byoMissed.length = 0; _byoItems.forEach(it => { it.price = 350; it.rate = 350; }); _byoRenderSections(); _byoUpdateRail(); });
    expect(await byoBar()).toEqual(['Check the price']);
    await page.locator('#byo-dep-in').fill('30');
    await page.locator('#byo-dep-in').dispatchEvent('input');
    await page.waitForTimeout(200);
    expect(await byoBar()).toEqual(['Sign here', 'Send it']);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tm guided'); });
});
