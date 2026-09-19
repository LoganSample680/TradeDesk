// Screenshot harness for Tim and the estimate screens (§0 step 0.5). Not a
// gate: the assertions live in e2e-tim*.spec.js and e2e-crew-bill-rate.spec.js.
// This renders the real screens on the real Whitfield job the designs are drawn
// on, so the pictures can be put next to the design renders before anything is
// deployed.
const { test, mockAllExternal, waitForAppBoot } = require('./helpers');

const OUT = process.env.SHOT_DIR || '.';

const SEED = () => {
  _activeTrade = 'painting';
  S.employees = [
    { name: 'Marco Reyes', email: 'marco@ts.test', role: 'Lead painter', pay_type: 'hourly', pay_rate: 26, billRate: 95 },
    { name: 'Jess Cole', email: 'jess@ts.test', role: 'Painter', pay_type: 'hourly', pay_rate: 24, billRate: 75 },
  ];
  S.priceBook = { painting: [
    { desc: 'Strip and repaint, west elevation', rate: 2180, unit: 'lot', n: 5, last: '2026-05-02' },
    { desc: 'Remove and reset gutters', rate: 340, unit: 'lot', n: 3, last: '2026-06-11' },
    { desc: 'Body and trim, two coats', rate: 0.78, unit: 'sq ft', n: 9, last: '2026-04-20' },
    { desc: 'Prep and pressure wash', rate: 320, unit: 'lot', n: 11, last: '2026-07-01' },
    { desc: 'Replace rotted trim', rate: 25.65, unit: 'lin ft', n: 6, last: '2026-06-02' },
    // Materials he has bought before, so the supply list can read back what he
    // paid instead of showing a column of blanks.
    { desc: 'Duration exterior, Iron Ore', rate: 82.4, unit: 'gal', n: 7, last: '2026-07-14' },
    { desc: 'Exterior caulk', rate: 78, unit: 'ea', n: 5, last: '2026-06-28' },
    { desc: 'Primer, masking, sandpaper', rate: 39.2, unit: 'ea', n: 4, last: '2026-07-02' },
    { desc: 'Scaffold', rate: 95, unit: 'd', n: 3, last: '2026-05-19' },
  ] };
  // What they COST comes from the RLS-gated comp cache, never from the employee
  // row, so the fixture has to seed it the way a signed-in owner would have it.
  S.laborBurden = 1.3;
  _teamComp = {
    'marco@ts.test': { pay_type: 'hourly', pay_rate: 26.3 },
    'jess@ts.test': { pay_type: 'hourly', pay_rate: 24.2 },
  };
  _teamCompLoaded = true;
  clients.length = 0;
  clients.push({ id: 55501, name: 'Dana Whitfield', phone: '316-555-0101',
    addr: '1200 Elm St, Wichita KS 67203', email: 'dana@ts.test' });
  bids.length = 0;
};

const OPEN_TM = () => {
  // openTMEstimate lands on step 1 (who and where). The T&M page proper is the
  // next one, and it is the screen the design is drawn on.
  _tmShowPage();
  _geiScopeChips.length = 0;
  ['Strip failed paint on the south and west elevations',
   'Replace rotted trim and siding board for board as found',
   'Prime the bare wood, then two finish coats',
   'Haul off debris daily and leave the site broom clean'].forEach(s => _geiScopeChips.push(s));
  _geiScopeNoScope = false;
  _tmLayers = new Set(['rate', 'est', 'dep']);
  _tmCrewCount = 2; _tmRatePerMan = 85;
  _estCrew = ['marco@ts.test', 'jess@ts.test'];
  const d = document.getElementById('tm-i-days'); if (d) d.value = '10';
  const r = document.getElementById('tm-i-rate'); if (r) r.value = '85';
  _tmApplyLayers();
  _tmInputChange();
  // The card first, then the rows into it: _geiRenderScopeCard rebuilds the
  // wrap, so painting the rows before it wipes them.
  _geiRenderScopeCard('tm');
  _renderScopeChips('tm-scope-wrap');
  timDockRender();
};

test.describe('tim screenshots', () => {
  test('the screens the designs are drawn on', async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);

    await page.evaluate(SEED);
    await page.evaluate(() => openTMEstimate(clients[0]));
    await page.waitForTimeout(700);
    await page.evaluate(OPEN_TM);
    await page.waitForTimeout(500);

    // 4b: the T&M page, scope numbered in work order, dock in the corner.
    await page.screenshot({ path: OUT + '/app-4b-tm-page.png' });

    // 4a + 4c: the rail, crew and rates then the three money rows.
    await page.evaluate(() => {
      const r = document.querySelector('.summary-rail');
      if (r) r.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + '/app-4a-4c-rail.png' });

    // 5d + 6c: the sheet the dock opens.
    await page.evaluate(() => { window.scrollTo(0, 0); openTim(); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/app-5d-sheet.png' });

    // 4d + 4e: what Tim made of a spoken job.
    await page.evaluate(() => _timShowRead(
      'T and M for the Whitfields, three days. Second floor, so scaffold on the west side. '
      + 'Gutters come off first and go back after. Five gallons of Duration in Iron Ore and a case of caulk.'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/app-4d-readback.png' });
    await page.evaluate(() => { const s = document.getElementById('_tim-sheet'); if (s) s.scrollTop = 560; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/app-4d-readback-lower.png' });

    // 8b: the book read out of proposals already sent.
    await page.evaluate(() => {
      document.getElementById('_tim-ov')?.remove();
      bids.length = 0;
      for (let i = 0; i < 4; i++) bids.push({ id: 93000 + i, trade_type: 'painting', status: 'sent', byoItems: [
        { label: 'Body and trim, two coats', price: 0.78, unit: 'sq ft' },
        { label: 'Prep and pressure wash', price: 320, unit: 'lot' },
        { label: 'Replace rotted trim', price: i % 2 ? 28 : 22, unit: 'lin ft' },
        { label: 'One off line ' + i, price: 60, unit: 'ea' },
      ] });
      S.priceBook = {};
      openTimBook();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/app-8b-book.png' });
  });
});
