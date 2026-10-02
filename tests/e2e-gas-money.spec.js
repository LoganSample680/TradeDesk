// @ts-check
// ── Gas money for supply runs (Jack, 2026-10-02) ─────────────────────────────
//
// "he wants the ability in mileage to pick out supply house runs only on
// certain days for gas reimbursement, he has menards, neenans lowes and HD."
// Owner on the rate: "dad wants just gas money so city MPG rate by mileage
// would be sweet, drive there and back counts, irs rate would be a nice option."
//
// js/gas-money.js. Seeded like Jack's real log: a shop, the four stores as
// supply places, and drives to and from them on three days, plus drives that
// must never count (a client trip, a personal one, an unsaved end).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('gas money for supply runs', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  // No test needs a real cloud save; a debounced one firing later must not
  // reach a stub (see e2e-mileage-traced's note).
  test.beforeEach(async () => {
    await page.evaluate(() => {
      if (window.__gmRealFlush === undefined && typeof _flushSaveNow === 'function') window.__gmRealFlush = window._flushSaveNow;
      window._flushSaveNow = () => Promise.resolve();
      document.getElementById('gm-ov')?.remove();
    });
  });
  test.afterEach(async () => {
    await page.evaluate(() => {
      if (typeof _syncTimer !== 'undefined' && _syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
      if (window.__gmRealFlush !== undefined) window._flushSaveNow = window.__gmRealFlush;
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  async function seed(opts) {
    return page.evaluate((opts) => {
      window.supaLoadFromCloud = async () => {};
      trackerYear = 2026;
      vehicles.length = 0;
      vehicles.push({ id: 7101, name: '2013 Ford F150', status: 'active', isDefault: true, deductionMethod: 'mileage', cityMpg: opts && opts.noMpg ? 0 : 15 });
      S.gasPrice = opts && opts.noPrice ? 0 : 3;
      S.gasMode = 'gas';
      places.length = 0;
      places.push(
        { id: 1, name: 'Menards', kind: 'supply', lat: 39.0400, lon: -95.7600 },
        { id: 2, name: 'Neenans Co', kind: 'supply', lat: 39.0500, lon: -95.6800 },
        { id: 3, name: "Lowe's", kind: 'supply', lat: 39.0300, lon: -95.7300 },
        { id: 4, name: 'The Home Depot', kind: 'supply', lat: 39.0451, lon: -95.7584 },
        { id: 5, name: 'Plumbing Solutions shop', kind: 'shop', lat: 39.0200, lon: -95.7000 });
      const V = { vehicleId: 7101, vehicle: '2013 Ford F150' };
      mileage.length = 0;
      mileage.push(
        // Sep 28: shop -> Home Depot -> client. Both legs touch the store.
        Object.assign({ id: 'a1', date: '2026-09-28', from_name: 'Plumbing Solutions shop', to_name: 'The Home Depot', miles: 2.5, purpose: 'Supply run' }, V),
        Object.assign({ id: 'a2', date: '2026-09-28', from_name: 'The Home Depot', to_name: 'Tagen Lindstrom (1733 SW Burnett Rd)', miles: 2.3, purpose: 'Client Consult' }, V),
        // Not a supply run: a client to the shop the same day.
        Object.assign({ id: 'a3', date: '2026-09-28', from_name: 'Tagen Lindstrom', to_name: 'Plumbing Solutions shop', miles: 1.7, purpose: 'Shop' }, V),
        // Sep 30: Menards there and back, the arrival matched by the pin only
        // (the end name is an address), still waiting on its receipt.
        Object.assign({ id: 'b1', date: '2026-09-30', from_name: 'Plumbing Solutions shop', to_name: '', to: '5900 SW Huntoon St', toCoord: { lat: 39.0412, lng: -95.7605 }, miles: 3.0, pendingReceipt: true, supplyRunKey: 'k1' }, V),
        Object.assign({ id: 'b2', date: '2026-09-30', from_name: 'Menards', to_name: 'Plumbing Solutions shop', miles: 3.0, purpose: 'Shop' }, V),
        // Oct 1: Neenans, answered personal: never counts.
        Object.assign({ id: 'c1', date: '2026-10-01', from_name: 'Plumbing Solutions shop', to_name: 'Neenans Co', miles: 9.0, personal: true }, V),
        // Oct 1: Lowe's to a place nobody saved: never on a total.
        Object.assign({ id: 'c2', date: '2026-10-01', from_name: "Lowe's", to_name: '', miles: 4.0, addressUnknown: true }, V),
        // Oct 2: Lowe's there and back.
        Object.assign({ id: 'd1', date: '2026-10-02', from_name: 'Plumbing Solutions shop', to_name: "Lowe's", miles: 6.0 }, V),
        Object.assign({ id: 'd2', date: '2026-10-02', from_name: "Lowe's", to_name: 'Plumbing Solutions shop', miles: 6.0 }, V));
      goPg('pg-tracker');
      setTrTab('mileage');
      renderAllMileage();
      return true;
    }, opts || {});
  }

  test('the drives to and from a supply house are the runs, there and back, nothing else', async () => {
    await seed();
    const r = await page.evaluate(() => ({
      ids: gasMoneyTrips(mileage).map(t => t.m.id + ':' + t.store.name),
      days: gasMoneyDays(mileage).map(d => ({ date: d.date, miles: Math.round(d.miles * 10) / 10, stores: d.stores, legs: d.legs.length })),
    }));
    expect(r.ids).toEqual(['a1:The Home Depot', 'a2:The Home Depot', 'b1:Menards', 'b2:Menards', "d1:Lowe's", "d2:Lowe's"]);
    expect(r.days).toEqual([
      { date: '2026-10-02', miles: 12, stores: ["Lowe's"], legs: 2 },
      { date: '2026-09-30', miles: 6, stores: ['Menards'], legs: 2 },
      { date: '2026-09-28', miles: 4.8, stores: ['The Home Depot'], legs: 2 },
    ]);
  });

  test('gas money is miles / city MPG * gas price for the ticked days only', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const days = gasMoneyDays(mileage);
      const two = gasMoneyTotal(days, new Set(['2026-09-28', '2026-10-02']), 'gas');
      const irs = gasMoneyTotal(days, new Set(['2026-09-30']), 'irs');
      return { two, irs, rate: IRS('2026-09-30'), none: gasMoneyTotal(days, new Set(), 'gas') };
    });
    expect(r.two.days).toBe(2);
    expect(r.two.miles).toBeCloseTo(16.8, 5);
    expect(r.two.gallons).toBeCloseTo(16.8 / 15, 5);
    expect(r.two.cost).toBeCloseTo(16.8 / 15 * 3, 5);           // $3.36
    expect(r.irs.cost).toBeCloseTo(6 * r.rate, 5);
    expect(r.none).toEqual({ days: 0, miles: 0, gallons: 0, cost: 0 });
  });

  // Owner 2026-10-02: "it needs to call the current year IRS rate table that
  // updates every year." The IRS option reads the yearly table (IRS() ->
  // _getIrsRateForYear, js/data.js TAX_HISTORY), by the year of each drive,
  // never a number typed into this file.
  test('the IRS option reads the yearly IRS table, by the year of the drive', async () => {
    await seed();
    const r = await page.evaluate(() => ({
      y25: _gmLegCost({ miles: 10, date: '2025-06-01' }, 'irs'), t25: 10 * _getIrsRateForYear(2025),
      y26: _gmLegCost({ miles: 10, date: '2026-06-01' }, 'irs'), t26: 10 * _getIrsRateForYear(2026),
    }));
    expect(r.y25).toBeCloseTo(r.t25, 6);
    expect(r.y26).toBeCloseTo(r.t26, 6);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../js/gas-money.js'), 'utf8');
    expect(src, 'no hardcoded IRS cents in the calculator').not.toMatch(/\.7[0-9]{0,2}\s*\*|0\.70|0\.725/);
  });

  test('a missing price or MPG asks for it instead of saying $0', async () => {
    await seed({ noMpg: true });
    const r = await page.evaluate(() => {
      const days = gasMoneyDays(mileage);
      return { gas: gasMoneyTotal(days, new Set(['2026-09-28']), 'gas').cost, irs: gasMoneyTotal(days, new Set(['2026-09-28']), 'irs').cost };
    });
    expect(r.gas).toBeNull();
    expect(r.irs).toBeGreaterThan(0);
  });

  test('on screen: open, tick two days, the total and the text match', async () => {
    await seed();
    await page.locator('#mil-gas-btn').click();
    await expect(page.locator('#gm-ov .zmodal')).toBeVisible();
    await expect(page.locator('#gm-days .gm-day')).toHaveCount(3);
    await expect(page.locator('#gm-total-amt')).toHaveText('$0.00');
    await expect(page.locator('#gm-share')).toBeDisabled();
    await page.locator('#gm-days .gm-day[data-day="2026-09-28"] input').check();
    await page.locator('#gm-days .gm-day[data-day="2026-10-02"] input').check();
    await expect(page.locator('#gm-total-amt')).toHaveText('$3.36');
    await expect(page.locator('#gm-share')).toBeEnabled();
    const text = await page.evaluate(() => gasMoneyText(gasMoneyDays(mileage), _gmSel, _gmMode()));
    expect(text).toBe([
      'Supply run gas money',
      'Mon, Sep 28: The Home Depot, 4.8 mi',
      "Fri, Oct 2: Lowe's, 12.0 mi",
      'Total: 16.8 mi, 1.1 gal at $3.00 = $3.36',
    ].join('\n'));
  });

  test('the IRS switch, the price and the MPG are kept for next time', async () => {
    await seed();
    await page.locator('#mil-gas-btn').click();
    await page.locator('#gm-all').click();
    await page.locator('#gm-price').fill('3.29');
    await page.locator('#gm-price').dispatchEvent('change');
    await page.locator('#gm-mpg-7101').fill('17');
    await page.locator('#gm-mpg-7101').dispatchEvent('change');
    const kept = await page.evaluate(() => ({ price: S.gasPrice, mpg: getVehicles()[0].cityMpg }));
    expect(kept).toEqual({ price: 3.29, mpg: 17 });
    await expect(page.locator('#gm-total-amt')).toHaveText('$4.41');   // 22.8 / 17 * 3.29
    await page.locator('#gm-mode-irs').click();
    await expect(page.locator('#gm-gas-fields')).toHaveCount(0);
    const irs = await page.evaluate(() => ({ mode: S.gasMode, want: fmt(22.8 * IRS('2026-10-02')) }));
    expect(irs.mode).toBe('irs');
    await expect(page.locator('#gm-total-amt')).toHaveText(irs.want);
    await page.locator('#gm-mode-gas').click();
    await expect(page.locator('#gm-gas-fields')).toHaveCount(1);
  });

  test('no price yet: the sheet asks, Send stays off', async () => {
    await seed({ noPrice: true });
    await page.locator('#mil-gas-btn').click();
    await page.locator('#gm-all').click();
    await expect(page.locator('#gm-need')).toBeVisible();
    await expect(page.locator('#gm-share')).toBeDisabled();
    await page.locator('#gm-none').click();
    await expect(page.locator('#gm-days input:checked')).toHaveCount(0);
  });

  test('no supply house saved: no button on the Mileage screen', async () => {
    await seed();
    const n = await page.evaluate(() => { places.length = 0; renderAllMileage(); return document.querySelectorAll('#mil-gas-btn').length; });
    expect(n).toBe(0);
    const empty = await page.evaluate(() => { openGasMoney(); return !!document.getElementById('gm-empty'); });
    expect(empty).toBe(true);
  });

  test('older days: the Books year picker picks the year, and All years lists every day', async () => {
    await seed();
    const r = await page.evaluate(() => {
      mileage.push({ id: 'old1', date: '2025-11-14', from_name: 'Shop', to_name: 'Menards', miles: 5, vehicleId: 7101 });
      const by = (y) => { trackerYear = y; openGasMoney(); const d = [...document.querySelectorAll('#gm-days .gm-day')].map(e => e.dataset.day); document.getElementById('gm-ov')?.remove(); return d; };
      const out = { y26: by(2026), y25: by(2025), all: by('all') };
      trackerYear = 'all'; openGasMoney();
      out.irsLabel = document.getElementById('gm-mode-irs').textContent;
      document.getElementById('gm-ov')?.remove();
      trackerYear = 2026;
      return out;
    });
    expect(r.y26).toEqual(['2026-10-02', '2026-09-30', '2026-09-28']);
    expect(r.y25).toEqual(['2025-11-14']);
    expect(r.all).toEqual(['2026-10-02', '2026-09-30', '2026-09-28', '2025-11-14']);
    expect(r.irsLabel).not.toContain('NaN');
  });

  test('junk does not throw', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const out = [];
      for (const v of [null, undefined, [], [null], [{}], [{ date: '2026-09-28', miles: 'x', to_name: 'Menards' }], [{ date: '2026-09-28', miles: 1, toCoord: { lat: null } }]]) {
        try { out.push(gasMoneyDays(v).length); } catch (e) { out.push('threw ' + e.message); }
      }
      try { out.push(gasMoneyTotal(null, new Set(), 'gas').days); } catch (e) { out.push('threw'); }
      return out;
    });
    expect(r).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('fits a phone: nothing past the edge', async () => {
    await seed();
    await page.locator('#mil-gas-btn').click();
    await page.locator('#gm-all').click();
    const r = await page.evaluate(() => {
      const box = document.querySelector('#gm-ov .zmodal').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: box.right };
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.right).toBeLessThanOrEqual(r.iw);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'gas money');
  });
});
