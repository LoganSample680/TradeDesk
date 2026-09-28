// @ts-check
/**
 * BLAKE SAMPLE (owner 2026-09-28)
 *
 * "Go look at the T&M for Blake Sample and what I said versus what Tim spit
 * out, terrible. Also the profit down at the bottom is showing as zero and
 * says to raise my rates."
 *
 * Two bugs on one proposal:
 *   1. The phone heard "we're putting a Corro-Protec powered anode rod in,
 *      we'll be removing the old" as "where putting a core protect powered and
 *      load rod in will be removing the old", and Tim split it into "Install
 *      where" and "Rod in will be", which went on the proposal.
 *   2. A rate sheet (rate, no hours) with a supply house quote on it. The
 *      quote line carries the MARKED-UP price, and it was costed at that
 *      price, so the parts markup read as zero; with no hours, labor billed
 *      nothing, and the rows told him to raise his rate.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// What the saved proposal says the phone handed Tim (its scope lines rebuilt
// into the sentence they came from).
const HEARD = 'Shut the water off and drain it down. Doing a water heater, Bradford White. '
  + 'Install where putting a core protect powered and load rod in will be removing the old, putting in the new. '
  + 'Pressure test and check every joint for leaks.';

test.describe('Blake Sample: what he said is what the proposal says', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });
  const split = (t) => page.evaluate((t) => timScopeFrom(t), t);

  test('the heard sentence becomes the job he described, one step a line', async () => {
    expect(await split(HEARD)).toEqual([
      'Shut the water off and drain it down',
      'Doing a water heater, Bradford White install',
      'Putting a Corro-Protec powered anode rod in',
      'Removing the old',
      'Putting in the new',
      'Pressure test and check every joint for leaks',
    ]);
  });

  test('the same words with no punctuation at all come out the same way', async () => {
    const run = 'doing a water heater bradford white install where putting a core protect powered and load rod in will be removing the old putting in the new';
    expect(await split(run)).toEqual([
      'Doing a water heater bradford white install',
      'Putting a Corro-Protec powered anode rod in',
      'Removing the old',
      'Putting in the new',
    ]);
  });

  test('no line on the proposal is a dangling half sentence', async () => {
    const r = await split(HEARD);
    for (const line of r) {
      expect(line, line).not.toMatch(/\b(?:where|will be|we'll be|rod in will)$/i);
      expect(line.split(/\s+/).length, line).toBeGreaterThan(2);
    }
  });

  test('trade words the phone gets wrong are put right', async () => {
    const r = await page.evaluate(() => [
      'put in a core protect rod', 'chorro protec anode', 'powered and load rod', 'power an old rod',
      'swap the and load rod', 'a new an old rod',
    ].map(_timkHeard));
    expect(r).toEqual([
      'put in a Corro-Protec rod', 'Corro-Protec anode', 'powered anode rod', 'powered anode rod',
      'swap the anode rod', 'a new anode rod',
    ]);
  });

  test('the second walk, word for word as the phone logged it', async () => {
    // td_tim_asks, 2026-09-28 01:24 UTC, T&M, Blake Sample's proposal.
    expect(await split('I am doing a water heater Adding in A protect powered rod Removing the old unit')).toEqual([
      'Doing a water heater',
      'Adding in a Corro-Protec powered anode rod',
      'Removing the old unit',
    ]);
    const r = await page.evaluate(() => ['swap the power rod', 'a powered anode rod', 'protect the floor with drop cloths', 'the power washer'].map(_timkHeard));
    expect(r).toEqual(['swap the powered anode rod', 'a powered anode rod', 'protect the floor with drop cloths', 'the power washer']);
  });

  test('and nothing that was already right is touched', async () => {
    const same = [
      'The heater, we were testing it',
      'Paint the walls where peeling is worst',
      'Take the old one and load the truck',
      'Mark where the drain runs',
      'They were running late so we will be back Monday',
      'Pull the curtain rod and patch the wall',
    ];
    const r = await page.evaluate((s) => s.map(_timkHeard), same);
    expect(r).toEqual(same);
  });

  test('an anode rod or a curtain rod is a thing, not a drain being rodded', async () => {
    expect(await split('swap the old anode rod in the heater')).toEqual(['Swap the old anode rod in the heater']);
    expect(await split('take down the curtain rod over the tub')).toEqual(['Take down the curtain rod over the tub']);
    // Rodding a drain is still work of its own.
    expect(await split('pull the toilet rod the main line out to the street')).toEqual(['Pull the toilet', 'Rod the main line out to the street']);
  });

  test('junk into the hearing pass does not throw', async () => {
    const r = await page.evaluate(() => [null, undefined, '', 0, '...', 'where', 'will be'].map(v => { try { return typeof _timkHeard(v); } catch (e) { return 'threw'; } }));
    expect(r.every(x => x === 'string')).toBe(true);
  });

  test('no console errors', async () => { assertNoErrors(page, 'blake sample scope'); });
});

test.describe('Blake Sample: the money rows on a rate sheet', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForFunction(() => window._supaCloudLoaded === true, null, { timeout: 15000 }).catch(() => {});
  });
  test.afterAll(async () => { await page.context().close(); });

  // Opens a T&M rate sheet at $125 an hour with the Neenan quote on it:
  // $1,356.43 of parts at 20 percent, billed at $1,627.72.
  const openBlake = (ownerRate) => page.evaluate((ownerRate) => {
    clients = clients.filter(c => c.id !== 99801);
    clients.push({ id: 99801, name: 'Blake Sample', addr: '100 Sample St, Wichita KS 67202' });
    S.employees = [];
    S.ownerPay = ownerRate ? { type: 'hourly', rate: ownerRate } : null;
    if (ownerRate) { S.ownerHourlyRate = ownerRate; } else { delete S.ownerHourlyRate; }
    openGenericEstimate(getClientById(99801), null, 'plumbing', { mode: 'tm', forceNew: true });
    return new Promise(res => setTimeout(() => {
      _geiIsTM = true; _tmShowPage();
      _tmRateOnly = true; _tmRatePerMan = 125; _tmEstHours = 0; _tmCrewCount = 1;
      if (Array.isArray(_estCrew)) _estCrew.length = 0;
      const rateBox = document.getElementById('tm-i-rate'); if (rateBox) rateBox.value = '125';
      _geiLines = _geiLines.filter(l => !l._supply);
      _geiLines.push({ desc: 'Materials', qty: 1, unit: 'lot', rate: 1627.72, total: 1627.72, notes: '',
        _supply: { items: [{ desc: 'Bradford White 50 gal', cost: 1356.43, on: true }], markup: 20 } });
      _tmInputChange();
      const el = document.getElementById('tm-money-rows');
      const g = document.getElementById('tm-profit-gauge');
      res({ gauge: !!g && g.style.opacity === '0', text: el ? el.innerText : '', loaded: typeof _ownerLoadedHourly === 'function' ? _ownerLoadedHourly() : -1 });
    }, 400));
  }, ownerRate);

  test('the parts markup is what he keeps on the quote, never zero', async () => {
    const r = await openBlake(0);
    expect(r.text).toContain('On the parts');
    expect(r.text).toContain('$271');
    expect(r.text).toContain('$1,356');
  });

  test('a rate sheet is never told to raise its rate over a missing hour count', async () => {
    const r = await openBlake(0);
    expect(r.text).not.toMatch(/raising the rate/i);
    expect(r.text).not.toMatch(/You keep\s*\$0\b/);
    expect(r.text).toContain('You bill an hour');
    expect(r.text).toContain('$125');
    // The job margin gauge measured parts markup as profit and called the
    // rate underpriced. With no job total it stands down.
    expect(r.gauge, 'the job margin gauge is hidden on a rate sheet').toBe(true);
  });

  test('with no pay of his own on file, it says where to put it instead of guessing', async () => {
    const r = await openBlake(0);
    test.skip(r.loaded > 0, 'this account already costs the owner hour');
    expect(r.text).toContain('Put your own pay in Settings');
  });

  test('with his pay on file, it shows what one hour keeps', async () => {
    const r = await page.evaluate(() => _tmMoneyPerHourHtml({ perHour: 125, hourCost: 45, matBill: 1627.72, materials: 1356.43 }));
    const text = r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('You keep an hour');
    expect(text).toContain('$80');
    expect(text).toContain('64 cents on the dollar');
    expect(text).toContain('$271');
  });

  test('a totalled T&M still gets the whole-job rows', async () => {
    const r = await page.evaluate(() => {
      _tmRenderMoneyRows({ bill: 4000, hours: 24, perHour: 125, pay: 1200, materials: 500, cost: 1700 });
      return document.getElementById('tm-money-rows').innerText;
    });
    expect(r).toContain('You keep');
    expect(r).not.toContain('You keep an hour');
  });

  test('bad input to the per-hour rows never throws', async () => {
    const r = await page.evaluate(() => [
      { perHour: 125 }, { perHour: 125, hourCost: 200 }, { perHour: 125, matBill: 'x', materials: null },
    ].map(n => { try { return typeof _tmMoneyPerHourHtml(n); } catch (e) { return 'threw'; } }));
    expect(r).toEqual(['string', 'string', 'string']);
  });

  test('no console errors', async () => { assertNoErrors(page, 'blake sample money'); });
});
