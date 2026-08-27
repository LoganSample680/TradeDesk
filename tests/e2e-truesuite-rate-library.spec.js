// @ts-check
/**
 * E2E tests, TrueSuite rate library (Settings → TrueSuite rate library).
 *
 * A dedicated screen so a contractor can pre-fill every TrueMeasure/TrueScan
 * $ rate once, instead of typing it live on a measurement's confirm screen.
 * This is a pure new WRITER: it sets the exact same S.* keys that
 * js/true-measure.js `_tmRates()` and js/scan-estimate.js `_scanRates()` /
 * `_scanElecRates()` already read, zero changes to either reader file.
 *
 * Coverage:
 * 1. Blank fields save as 0 (never NaN/undefined) across all 11 rate fields.
 * 2. Golden path: fill every field with a distinct value → Save → full page
 *    reload → S.trueMeasureRates / S.scanRates / S.scanElecRates and the form
 *    both hold the saved values.
 * 3. Integration: a rate saved here shows up pre-filled the next time
 *    TrueScan's estimate builder opens its rate panel, for both the surface
 *    (painting) and device (electrical) rate sets, proving the settings
 *    screen and scan-estimate.js are actually wired together through S.*,
 *    not just independently correct.
 * 4. Same integration proof for TrueMeasure's confirm screen, guarded with
 *    test.skip() when js/true-measure.js is not present in this branch
 *    snapshot (the reader/writer contract is still exercised via #3 and the
 *    S.trueMeasureRates round trip in #1/#2 either way).
 * 5. Zero console errors throughout.
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

// A fabricated RoomPlan capture, identical shape to fabricatedRoom() in
// e2e-scan.spec.js (not exported from there, so duplicated here): a 12ft x
// 10ft room, 8ft ceilings, one door, one window. Only used to give
// _scanParseRoom something real to turn into a room so openScanEstimate has
// surfaces/devices to price against the rates this screen just saved.
function fabricatedRoom() {
  const L = 3.6576, W = 3.048, H = 2.4384;
  const wall = (id, dir, cx, cz, len) => ({
    identifier: id,
    category: { wall: {} },
    dimensions: [len, H, 0],
    transform: [dir[0], 0, dir[1], 0, 0, 1, 0, 0, -dir[1], 0, dir[0], 0, cx, H / 2, cz, 1],
  });
  return JSON.stringify({
    identifier: 'room-1', story: 0, version: 2,
    walls: [
      wall('w-n', [1, 0], 0, -W / 2, L),
      wall('w-s', [1, 0], 0, W / 2, L),
      wall('w-e', [0, 1], L / 2, 0, W),
      wall('w-w', [0, 1], -L / 2, 0, W),
    ],
    doors: [{
      identifier: 'd-1', parentIdentifier: 'w-s',
      category: { door: { isOpen: false } },
      dimensions: [0.9144, 2.0320, 0],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 1.0, W / 2, 1],
    }],
    windows: [{
      identifier: 'win-1', parentIdentifier: 'w-n',
      category: { window: {} },
      dimensions: [1.2192, 1.2192, 0],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.6, 1.5, -W / 2, 1],
    }],
    openings: [],
    objects: [],
    floors: [{
      identifier: 'f-1', category: { floor: {} },
      dimensions: [L, 0, W],
      polygonCorners: [[-L / 2, 0, -W / 2], [L / 2, 0, -W / 2], [L / 2, 0, W / 2], [-L / 2, 0, W / 2]],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }],
  });
}

/** Every rate field on the screen: input id → [S container, S key]. */
const RATE_FIELDS = [
  { id: 'tr-tm-area',      s: 'trueMeasureRates', k: 'areaSqFt' },
  { id: 'tr-tm-roof',      s: 'trueMeasureRates', k: 'roofSquare' },
  { id: 'tr-tm-dist',      s: 'trueMeasureRates', k: 'distanceLf' },
  { id: 'tr-scan-wall',    s: 'scanRates',        k: 'wall' },
  { id: 'tr-scan-ceiling', s: 'scanRates',        k: 'ceiling' },
  { id: 'tr-scan-trim',    s: 'scanRates',        k: 'trimLf' },
  { id: 'tr-scan-door',    s: 'scanRates',        k: 'door' },
  { id: 'tr-scan-window',  s: 'scanRates',        k: 'window' },
  { id: 'tr-scan-outlet',  s: 'scanElecRates',    k: 'outlet' },
  { id: 'tr-scan-sw',      s: 'scanElecRates',    k: 'sw' },
  { id: 'tr-scan-gfci',    s: 'scanElecRates',    k: 'gfci' },
];

/** Open the rate library sub-screen from within Settings. */
async function openRateLibrary(page) {
  await goPg(page, 'pg-settings');
  await page.evaluate(() => _openSetDetail('truerates'));
  await page.waitForTimeout(150);
}

async function fillAndSave(page, pairs) {
  await page.evaluate((pairs) => {
    for (const [id, val] of pairs) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
    saveTrueRates();
  }, pairs);
  await page.waitForTimeout(200);
}

async function readState(page) {
  return page.evaluate((fields) => {
    const out = {};
    for (const f of fields) {
      const el = document.getElementById(f.id);
      out[f.id] = { input: el ? el.value : null, s: (S[f.s] || {})[f.k] };
    }
    return out;
  }, RATE_FIELDS);
}

test.describe('TrueSuite rate library', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('navigation entry point opens the rate library from Settings', async () => {
    await goPg(page, 'pg-settings');
    const row = await page.evaluate(() => !!document.querySelector('[onclick*="_openSetDetail(\'truerates\')"]'));
    expect(row, 'a Settings row must link to the truerates detail panel').toBe(true);
    await page.evaluate(() => _openSetDetail('truerates'));
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => document.getElementById('setd-truerates')?.classList.contains('active'));
    expect(active, 'the panel becomes active on open').toBe(true);
    assertNoErrors(page, 'opening the TrueSuite rate library');
  });

  test('blank fields save as 0, never NaN or undefined', async () => {
    await openRateLibrary(page);
    // Every field left blank
    await fillAndSave(page, RATE_FIELDS.map(f => [f.id, '']));
    const state = await readState(page);
    for (const f of RATE_FIELDS) {
      expect(state[f.id].s, `S.${f.s}.${f.k} must be exactly 0 when the field is blank`).toBe(0);
      expect(Number.isNaN(state[f.id].s), `S.${f.s}.${f.k} must never be NaN`).toBe(false);
    }
    assertNoErrors(page, 'blank rate library save');
  });

  test('golden path: fill every field, save, reload, values persist', async () => {
    await openRateLibrary(page);
    const values = { 'tr-tm-area': '2.25', 'tr-tm-roof': '450', 'tr-tm-dist': '3.5',
      'tr-scan-wall': '2.75', 'tr-scan-ceiling': '1.9', 'tr-scan-trim': '3.1', 'tr-scan-door': '65', 'tr-scan-window': '45',
      'tr-scan-outlet': '95', 'tr-scan-sw': '75', 'tr-scan-gfci': '140' };
    await fillAndSave(page, Object.entries(values));

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await openRateLibrary(page);

    const state = await readState(page);
    for (const f of RATE_FIELDS) {
      const expected = parseFloat(values[f.id]);
      expect(state[f.id].s, `S.${f.s}.${f.k} must hold the saved value after reload`).toBe(expected);
      expect(parseFloat(state[f.id].input), `#${f.id} must show the saved value after reload`).toBe(expected);
    }
    assertNoErrors(page, 'rate library golden path persistence');
  });

  test('a rate saved here pre-fills TrueScan\'s rate panel (surfaces + electrical)', async () => {
    await openRateLibrary(page);
    await fillAndSave(page, [
      ['tr-scan-wall', '4.4'], ['tr-scan-ceiling', '2.2'], ['tr-scan-trim', '1.1'], ['tr-scan-door', '70'], ['tr-scan-window', '55'],
      ['tr-scan-outlet', '110'], ['tr-scan-sw', '85'], ['tr-scan-gfci', '160'],
    ]);

    const r = await page.evaluate((raw) => {
      const savedClients = clients.slice();
      const savedTrade = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
      try {
        clients.length = 0; clients.push({ id: 900901, name: 'Rate Library Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        saveScan({ id: 'scan-rl-1', clientId: 900901, rooms: [room], name: 'Rate library scan' });
        setActiveTrade('painting');
        openScanEstimate(clients[0]);
        const wall = +document.getElementById('_se-ov')?.querySelector('input[onchange*="wall"]')?.value;
        const surfacesOpened = !!document.getElementById('_se-ov');
        document.getElementById('_se-ov')?.remove(); _seState = null;
        setActiveTrade('electrical');
        openScanEstimate(clients[0]);
        const outlet = +document.getElementById('_se-ov')?.querySelector('input[onchange*="outlet"]')?.value;
        const elecOpened = !!document.getElementById('_se-ov');
        return { surfacesOpened, wall, elecOpened, outlet };
      } finally {
        deleteScan('scan-rl-1');
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        setActiveTrade(savedTrade);
        document.getElementById('_se-ov')?.remove(); _seState = null;
        goPg('pg-dash');
      }
    }, fabricatedRoom());

    expect(r.surfacesOpened, 'TrueScan builder opens for the painting/surfaces lens').toBe(true);
    expect(r.wall, 'the wall rate pre-fills from the rate library, not 0').toBe(4.4);
    expect(r.elecOpened, 'TrueScan builder opens for the electrical lens').toBe(true);
    expect(r.outlet, 'the outlet rate pre-fills from the rate library, not 0').toBe(110);
    assertNoErrors(page, 'TrueScan rate pre-fill integration');
  });

  test('a rate saved here pre-fills TrueMeasure\'s confirm screen', async () => {
    const has = await page.evaluate(() => typeof _tmConfirmScreen === 'function' && typeof _tmRates === 'function');
    test.skip(!has, 'js/true-measure.js is not present in this branch snapshot; the S.trueMeasureRates round trip is still proven by the blank-field and golden-path tests above, and will pre-fill automatically once true-measure.js lands, since it reads the exact same S.trueMeasureRates shape this screen writes.');

    await openRateLibrary(page);
    await fillAndSave(page, [['tr-tm-area', '3.3'], ['tr-tm-roof', '525'], ['tr-tm-dist', '2.8']]);

    const r = await page.evaluate(() => {
      try {
        _tmState = { mode: 'area', points: [{ lat: 0, lng: 0 }, { lat: 0.0001, lng: 0 }, { lat: 0.0001, lng: 0.0001 }], c: { id: 900902, name: 'TM Client' } };
        if (typeof getActiveTrade === 'function') setActiveTrade && setActiveTrade('painting');
        _tmConfirmScreen();
        const rate = +document.getElementById('tm-c-rate')?.value;
        const opened = !!document.getElementById('_tm-confirm-ov');
        return { opened, rate };
      } finally {
        document.getElementById('_tm-confirm-ov')?.remove();
        _tmState = null;
      }
    });
    expect(r.opened, 'the confirm screen opens').toBe(true);
    expect(r.rate, 'the area rate pre-fills from the rate library, not 0').toBe(3.3);
    assertNoErrors(page, 'TrueMeasure rate pre-fill integration');
  });

  test('zero console errors across the TrueSuite rate library session', async () => {
    assertNoErrors(page, 'TrueSuite rate library session');
  });
});
