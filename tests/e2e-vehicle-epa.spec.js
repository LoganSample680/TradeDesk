// @ts-check
// ── EPA fuel economy on the vehicle (owner 2026-10-02) ───────────────────────
//
// "I'm an automated mofo, so I would want it to grab that data and store it."
// js/vehicle-epa.js reads a truck's name (or VIN) into year, make and model,
// asks fueleconomy.gov for the EPA's MPG, and stores it on the vehicle. The
// EPA and NHTSA answers here are copies of their real responses (fetched
// 2026-10-02) served by the test, so nothing reaches the network.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// 2013 Ford, cut to what the F150 lookup reads. Option ids and MPG are real.
const MODELS_2013_FORD = ['Edge AWD', 'F150 Pickup 2WD', 'F150 Pickup 4WD', 'F150 Raptor Pickup 4WD', 'Focus FWD'];
const OPTIONS = {
  'F150 Pickup 2WD': [['33184', 'Auto (S6), 8 cyl, 6.2 L'], ['33188', 'Auto (S6), 6 cyl, 3.5 L, Turbo']],
  'F150 Pickup 4WD': [['33198', 'Auto (S6), 8 cyl, 6.2 L'], ['33204', 'Auto (S6), 6 cyl, 3.5 L, Turbo']],
  'F150 Raptor Pickup 4WD': [['33300', 'Auto (S6), 8 cyl, 6.2 L']],
};
const MPG = { '33184': [13, 18], '33188': [16, 22], '33198': [12, 16], '33204': [15, 21], '33300': [11, 14] };

test.describe('EPA MPG on the vehicle', () => {
  let page;
  const hits = [];
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    // Registered after mockAllExternal, so these win for their hosts.
    await page.route('https://www.fueleconomy.gov/**', async (route) => {
      const u = new URL(route.request().url());
      hits.push(u.pathname + u.search);
      if (window_offline) return route.abort('internetdisconnected');
      const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
      const p = u.pathname.replace('/ws/rest/vehicle/', '');
      const q = u.searchParams;
      if (p === 'menu/make') return json({ menuItem: [{ text: 'Chevrolet', value: 'Chevrolet' }, { text: 'Ford', value: 'Ford' }] });
      if (p === 'menu/model' && q.get('make') === 'Ford' && q.get('year') === '2013') return json({ menuItem: MODELS_2013_FORD.map(m => ({ text: m, value: m })) });
      if (p === 'menu/model' && q.get('make') === 'Chevrolet') return json({ menuItem: [{ text: 'Silverado 2WD', value: 'Silverado 2WD' }, { text: 'Silverado 4WD', value: 'Silverado 4WD' }] });
      if (p === 'menu/options') {
        const o = OPTIONS[q.get('model')] || [];
        // The real API answers a single option as an object, not an array.
        const items = o.map(([value, text]) => ({ text, value }));
        return json({ menuItem: items.length === 1 ? items[0] : items });
      }
      if (MPG[p]) return json({ city08: String(MPG[p][0]), highway08: String(MPG[p][1]) });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route('https://vpic.nhtsa.dot.gov/**', async (route) => {
      hits.push('vpic');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ Results: [{ ModelYear: '2013', Make: 'FORD', Model: 'F-150', DriveType: '4WD/4-Wheel Drive/4x4', EngineCylinders: '6', DisplacementL: '3.5' }] }) });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  let window_offline = false;
  test.beforeEach(async () => {
    window_offline = false;
    hits.length = 0;
    await page.evaluate(() => {
      if (window.__epaRealFlush === undefined && typeof _flushSaveNow === 'function') window.__epaRealFlush = window._flushSaveNow;
      window._flushSaveNow = () => Promise.resolve();
      window.supaLoadFromCloud = async () => {};
      vehicles.length = 0;
    });
  });
  test.afterEach(async () => {
    await page.evaluate(() => {
      document.getElementById('gm-ov')?.remove();
      if (typeof _syncTimer !== 'undefined' && _syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
      if (window.__epaRealFlush !== undefined) window._flushSaveNow = window.__epaRealFlush;
    });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('a name is read into year, make and model', async () => {
    const r = await page.evaluate(() => ['2013 Ford F150', '2019 F-150', '2016 Ram 1500', '2020 Chevy Silverado 1500', 'Silverado 1500 2018', 'Work truck', '2013', '', null, undefined, 42]
      .map(n => { try { return epaParseName(n); } catch (e) { return 'threw'; } }));
    expect(r).toEqual([
      { year: 2013, make: 'Ford', model: 'F150' },
      { year: 2019, make: 'Ford', model: 'F-150' },
      { year: 2016, make: 'Ram', model: '1500' },
      { year: 2020, make: 'Chevy', model: 'Silverado 1500' },
      { year: 2018, make: 'Chevrolet', model: 'Silverado 1500' },
      null, null, null, null, null, null,
    ]);
  });

  test('model matching: the same truck, never a different one or a heavy-duty borrow', async () => {
    const r = await page.evaluate((list) => ({
      f150: epaMatchModels(list, 'F150'),
      f150dash: epaMatchModels(list, 'F-150'),
      f150_4wd: epaMatchModels(list, 'F150', '4wd'),
      raptor: epaMatchModels(list, 'F150 Raptor'),
      none: epaMatchModels(list, 'Ranger'),
      c15: epaMatchModels(['Silverado C15 2WD', 'Silverado K15 4WD', 'Silverado 15 Hybrid 2WD'], 'Silverado 1500'),
      bare: epaMatchModels(['Silverado 2WD', 'Silverado 4WD'], 'Silverado 1500'),
      hd: epaMatchModels(['Silverado 2WD', 'Silverado 4WD'], 'Silverado 2500'),
      junk: [epaMatchModels(null, 'F150'), epaMatchModels(list, ''), epaMatchModels(list, null)],
    }), MODELS_2013_FORD);
    expect(r.f150).toEqual(['F150 Pickup 2WD', 'F150 Pickup 4WD']);
    expect(r.f150dash).toEqual(['F150 Pickup 2WD', 'F150 Pickup 4WD']);
    expect(r.f150_4wd).toEqual(['F150 Pickup 4WD']);
    expect(r.raptor).toEqual(['F150 Raptor Pickup 4WD']);
    expect(r.none).toEqual([]);
    expect(r.c15).toEqual(['Silverado C15 2WD', 'Silverado K15 4WD', 'Silverado 15 Hybrid 2WD']);
    expect(r.bare).toEqual(['Silverado 2WD', 'Silverado 4WD']);
    expect(r.hd, 'a 2500 never borrows a 1500 MPG').toEqual([]);
    expect(r.junk).toEqual([[], [], []]);
  });

  test('a new truck by name: stored on the vehicle, the middle MPG used until he picks', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8101, name: '2013 Ford F150', status: 'active' });
      const changed = await epaFillVehicle(getVehicles()[0]);
      const v = getVehicles()[0];
      return { changed, year: v.epa.year, make: v.epa.make, model: v.epa.model, source: v.epa.source, ids: v.epa.options.map(o => o.id + ':' + o.city),
        pick: v.epa.pick, mpg: v.cityMpg, src: v.mpgSource, range: epaRange(v) };
    });
    expect(r.changed).toBe(true);
    expect(r).toMatchObject({ year: 2013, make: 'Ford', model: 'F150', source: 'name', pick: null, src: 'epa' });
    expect(r.ids).toEqual(['33184:13', '33188:16', '33198:12', '33204:15']);   // no Raptor
    expect(r.mpg).toBe(13);                                                    // middle of 12, 13, 15, 16
    expect(r.range).toEqual({ low: 12, high: 16 });
  });

  test('stored once: opening again does not ask the EPA again; a rename does', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8102, name: '2013 Ford F150', status: 'active' });
      await epaFillVehicle(getVehicles()[0]);
      return true;
    });
    expect(r).toBe(true);
    const first = hits.length;
    expect(first).toBeGreaterThan(0);
    const again = await page.evaluate(async () => epaFillVehicle(getVehicles()[0]));
    expect(again).toBe(false);
    expect(hits.length).toBe(first);
    // Renamed to a truck the stub has no engines for: asked again, and the
    // old F150 figures are not left standing on a Silverado.
    const renamed = await page.evaluate(async () => { getVehicles()[0].name = '2020 Chevy Silverado 1500'; const c = await epaFillVehicle(getVehicles()[0]); const e = getVehicles()[0].epa; return { c, none: !!e.none, options: e.options || null, mpg: getVehicles()[0].cityMpg }; });
    expect(renamed).toEqual({ c: true, none: true, options: null, mpg: 0 });
    expect(hits.length).toBeGreaterThan(first);
  });

  test('a VIN names the engine: one option, picked, exact MPG', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8103, name: 'Work truck', vin: '1FTFW1ET5DFA00000', status: 'active' });
      await epaFillVehicle(getVehicles()[0]);
      const v = getVehicles()[0];
      return { source: v.epa.source, ids: v.epa.options.map(o => o.id), pick: v.epa.pick, mpg: v.cityMpg };
    });
    expect(hits).toContain('vpic');
    expect(r).toEqual({ source: 'vin', ids: ['33204'], pick: '33204', mpg: 15 });
  });

  test('his number wins: typed, or already there before the lookup', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8104, name: '2013 Ford F150', status: 'active', cityMpg: 14 });
      vehicles.push({ id: 8105, name: '2013 Ford F150', status: 'active', cityMpg: 11, mpgSource: 'user' });
      await epaFillVehicle(getVehicles()[0]);
      await epaFillVehicle(getVehicles()[1]);
      return getVehicles().map(v => ({ mpg: v.cityMpg, has: !!(v.epa && v.epa.options) }));
    });
    expect(r).toEqual([{ mpg: 14, has: true }, { mpg: 11, has: true }]);
  });

  test('picking the engine sets the MPG; nonsense picks do nothing', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8106, name: '2013 Ford F150', status: 'active' });
      await epaFillVehicle(getVehicles()[0]);
      epaPick(8106, '33204');
      const a = getVehicles()[0].cityMpg;
      epaPick(8106, 'nope'); epaPick(9999, '33204'); epaPick(null, null);
      return { a, b: getVehicles()[0].cityMpg, pick: getVehicles()[0].epa.pick, cm: epaCityMpg(getVehicles()[0]) };
    });
    expect(r).toEqual({ a: 15, b: 15, pick: '33204', cm: 15 });
  });

  test('heavy-duty or no signal: stored as no match, never a guess, nothing thrown', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8107, name: '2018 Silverado 2500', status: 'active' });
      vehicles.push({ id: 8108, name: 'Work truck', status: 'active' });
      await epaFillVehicle(getVehicles()[0]);
      await epaFillVehicle(getVehicles()[1]);
      const out = [];
      for (const v of [null, undefined, {}, { id: 1 }]) { try { out.push(await epaFillVehicle(v)); } catch (e) { out.push('threw'); } }
      return { hd: getVehicles()[0].epa.none, hdMpg: getVehicles()[0].cityMpg || 0, plain: getVehicles()[1].epa.none, out, cm: epaCityMpg(null), rg: epaRange({}) };
    });
    expect(r).toEqual({ hd: true, hdMpg: 0, plain: true, out: [false, false, false, false], cm: 0, rg: null });
    window_offline = true;
    const off = await page.evaluate(async () => {
      vehicles.push({ id: 8109, name: '2013 Ford F150', status: 'active' });
      await epaFillVehicle(getVehicles().find(v => v.id === 8109));
      return getVehicles().find(v => v.id === 8109).epa;
    });
    expect(off.none).toBe(true);
  });

  test('a sync swapping the truck out mid-lookup: nothing written to the stale copy', async () => {
    const r = await page.evaluate(async () => {
      vehicles.push({ id: 8110, name: '2013 Ford F150', status: 'active' });
      const p = epaFillVehicle(getVehicles()[0]);
      vehicles.length = 0;
      vehicles.push({ id: 8110, name: '2014 Tacoma', status: 'active' });
      const c = await p;
      return { c, epa: getVehicles()[0].epa || null };
    });
    expect(r).toEqual({ c: false, epa: null });
  });

  test('saving a truck looks it up', async () => {
    await page.evaluate(() => {
      // The first truck also opens the odometer prompt half a second later;
      // that is another feature's sheet, kept out of this test.
      window.__epaOdo = window._checkOdometerPrompt; window._checkOdometerPrompt = () => {};
      openAddVehicleModal();
      document.getElementById('fv-name').value = '2013 Ford F150';
      saveFleetVehicle();
    });
    await expect.poll(() => page.evaluate(() => { const v = getVehicles()[0]; return v && v.epa && v.epa.model; })).toBe('F150');
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); window._checkOdometerPrompt = window.__epaOdo; });
  });

  test('gas money sheet: shows the EPA range, the engine list sets the MPG', async () => {
    await page.evaluate(() => {
      vehicles.push({ id: 8111, name: '2013 Ford F150', status: 'active' });
      places.length = 0;
      places.push({ id: 1, name: 'Menards', kind: 'supply', lat: 39.04, lon: -95.76 });
      mileage.length = 0;
      mileage.push({ id: 'g1', date: '2026-09-30', from_name: 'Shop', to_name: 'Menards', miles: 6, vehicleId: 8111, vehicle: '2013 Ford F150' });
      trackerYear = 2026; S.gasMode = 'gas'; S.gasPrice = 3;
      openGasMoney();
    });
    await expect(page.locator('#gm-epa-8111')).toBeVisible();
    await expect(page.locator('#gm-gas-fields .gm-epa').first()).toContainText('12 to 16 city');
    await expect(page.locator('#gm-mpg-8111')).toHaveValue('13');
    await page.locator('#gm-epa-8111').selectOption('33204');
    await expect(page.locator('#gm-mpg-8111')).toHaveValue('15');
    await page.locator('#gm-all').click();
    await expect(page.locator('#gm-total-amt')).toHaveText('$1.20');          // 6 / 15 * 3
    // Typed over: his number stays, the EPA line says what it found.
    await page.locator('#gm-mpg-8111').fill('11');
    await page.locator('#gm-mpg-8111').dispatchEvent('change');
    await expect(page.locator('#gm-gas-fields .gm-epa').first()).toContainText('You typed 11');
    const src = await page.evaluate(() => getVehicles().find(v => v.id === 8111).mpgSource);
    expect(src).toBe('user');
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'vehicle epa');
  });
});
