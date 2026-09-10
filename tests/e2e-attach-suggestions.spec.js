// @ts-check
/**
 * "Usually goes with this": the line he forgets.
 *
 * Owner 2026-09-07: "whoever got a tankless unit also gets the isolation
 * valves (service valves, maintenance valves, flush kits, etc)."
 *
 * The package card answers "what do I sell on a job like this" and only shows
 * on an empty estimate. This is the other half and it is the one that costs
 * money: the tankless is already on the estimate, the valves are missing, and
 * nobody notices until the truck is at the house.
 *
 * Source is his own bids, same as the packages. No catalog, so it can never
 * suggest work he does not do.
 *
 * What we verify:
 *  1. The association is real: with the anchor, most of the time, and MORE
 *     often than that line shows up anyway (lift), so his everyday lines stay
 *     out of it
 *  2. Never suggests what is already on the estimate, never the anchor itself
 *  3. Adding uses the BOOK's current price and words, never the old job's
 *  4. It works the same on T&M as on BYO, one renderer
 *  5. Skip is per estimate and never permanent
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const AT_CLIENT = 89001;

// Six past plumbing jobs. Three carry a tankless, and every one of those also
// carries isolation valves and a flush kit. A trip charge is on FIVE of six,
// so it is not an attach, it is just what he sells.
const seedHistory = () => ({
  clientId: AT_CLIENT,
  bids: [
    { id: 89201, lines: ['Tankless water heater, 199k btu', 'Isolation valve kit', 'Flush kit', 'Trip charge'] },
    { id: 89202, lines: ['Tankless water heater, 199k btu', 'Isolation valve kit', 'Flush kit', 'Trip charge'] },
    { id: 89203, lines: ['Tankless water heater, 199k btu', 'Isolation valve kit', 'Gas line, 3/4 CSST', 'Trip charge'] },
    { id: 89204, lines: ['Toilet replacement', 'Wax ring and bolts', 'Trip charge'] },
    { id: 89205, lines: ['Kitchen faucet swap', 'Supply lines', 'Trip charge'] },
    { id: 89206, lines: ['Sump pump replacement', 'Check valve'] }
  ]
});

test.describe('attach suggestions', () => {
  let page;

  const seed = () => page.evaluate(({ clientId, bids: rows }) => {
    clients = clients.filter(c => c.id !== clientId).concat([{ id: clientId, name: 'Ruiz', addr: '4 Attach Rd', phone: '3165550004' }]);
    const ids = rows.map(r => r.id);
    bids = bids.filter(b => !ids.includes(b.id)).concat(rows.map((r, n) => ({
      id: r.id, client_id: clientId, client_name: 'Ruiz', type: 'Plumbing job', trade_type: 'plumbing',
      amount: 1000, status: 'Closed Won', draft: false, bid_date: '2026-0' + (n + 1) + '-01', isFreeForm: true,
      byoItems: r.lines.map((label, i) => ({ id: i + 1, section: 'Work', label, qty: 1, unit: 'ea', rate: 100, price: 100, on: true }))
    })));
    _geiTrade = 'plumbing';
  }, seedHistory());

  // The estimate he is building right now: a tankless, nothing else.
  const openWithTankless = () => page.evaluate(() => {
    _geiEditBidId = 89300; _geiClientId = 89001; _geiIsFreeForm = true; _geiIsTM = false;
    _attachSkipped = [];
    _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Tankless water heater, 199k btu', qty: 1, unit: 'ea', rate: 3200, on: true })];
    _geiLines = []; _geiScopeChips = [];
  });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; window._byoAutosave = () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The association has to be real ──────────────────────────────────────

  test('the valves and the flush kit come up, the trip charge does not', async () => {
    await seed(); await openWithTankless();
    const r = await page.evaluate(() => _attachSuggestions().map(s => ({ label: s.line.label, n: s.n, of: s.of, anchor: s.anchorLabel })));
    const labels = r.map(x => x.label);
    expect(labels, 'on all three tankless jobs').toContain('Isolation valve kit');
    expect(labels, 'on two of the three, still most of them').toContain('Flush kit');
    expect(labels, 'five of six jobs carry it: that is what he sells, not an attach').not.toContain('Trip charge');
    expect(labels, 'one of three is not a habit').not.toContain('Gas line, 3/4 CSST');
    const valves = r.find(x => x.label === 'Isolation valve kit');
    expect(valves.n).toBe(3);
    expect(valves.of).toBe(3);
    expect(valves.anchor, 'the copy names why it is being suggested').toBe('Tankless water heater, 199k btu');
  });

  test('one past job is not a habit: nothing is suggested off a single sighting', async () => {
    const n = await page.evaluate(() => {
      const keep = bids;
      bids = bids.filter(b => b.id === 89201 || b.id === 89204);   // one tankless job only
      const out = _attachSuggestions().length;
      bids = keep;
      return out;
    });
    expect(n).toBe(0);
  });

  test('nothing on the estimate, nothing to attach to', async () => {
    const r = await page.evaluate(() => {
      _byoItems = []; _geiLines = [];
      const out = { n: _attachSuggestions().length, card: _attachCardHTML() };
      return out;
    });
    expect(r.n).toBe(0);
    expect(r.card, 'no card at all, not an empty one').toBe('');
  });

  test('no history at all is quiet, not an error', async () => {
    const r = await page.evaluate(() => {
      const keep = bids; bids = [];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Tankless water heater, 199k btu', qty: 1, rate: 3200, on: true })];
      const out = { n: _attachSuggestions().length, card: _attachCardHTML() };
      bids = keep;
      return out;
    });
    expect(r.n).toBe(0);
    expect(r.card).toBe('');
  });

  // ── 2. Never suggest what is already there ─────────────────────────────────

  test('a line already on the estimate is not suggested again, nor is the anchor', async () => {
    await seed(); await openWithTankless();
    const labels = await page.evaluate(() => {
      _byoItems.push(_byoNormItem({ id: 2, section: 'Work', label: 'Isolation valve kit', qty: 1, rate: 180, on: true }));
      return _attachSuggestions().map(s => s.line.label);
    });
    expect(labels).not.toContain('Isolation valve kit');
    expect(labels).not.toContain('Tankless water heater, 199k btu');
    expect(labels, 'the flush kit is still missing and still worth saying').toContain('Flush kit');
  });

  test('a differently-cased or padded line still counts as already there', async () => {
    await seed(); await openWithTankless();
    const labels = await page.evaluate(() => {
      _byoItems.push(_byoNormItem({ id: 2, section: 'Work', label: '  ISOLATION   valve kit ', qty: 1, rate: 180, on: true }));
      return _attachSuggestions().map(s => s.line.label);
    });
    expect(labels, 'the price book key is what matches, not the typing').not.toContain('Isolation valve kit');
  });

  // ── 3. Adding it uses today's price, not the old job's ─────────────────────

  test('Add pulls the CURRENT book price, unit and description', async () => {
    await seed(); await openWithTankless();
    const r = await page.evaluate(() => {
      _pbLearn('Isolation valve kit', 214, 'kit', 'Pair of service valves with hose bibs and relief, installed');
      _attachAdd(_attachSuggestions().find(s => s.line.label === 'Isolation valve kit').key);
      const it = _byoItems.find(x => _pbKey(x.label) === _pbKey('Isolation valve kit'));
      return it ? { rate: it.rate, unit: it.unit, notes: it.notes, price: it.price, qty: it.qty } : null;
    });
    expect(r, 'it landed on the estimate').not.toBe(null);
    expect(r.rate, 'the book price, not the $100 it was on those old jobs').toBe(214);
    expect(r.unit).toBe('kit');
    expect(r.notes).toContain('service valves');
    expect(r.price).toBe(214);
    expect(r.qty).toBe(1);
  });

  test('Add twice does not double the line', async () => {
    await seed(); await openWithTankless();
    const n = await page.evaluate(() => {
      const k = _attachSuggestions().find(s => s.line.label === 'Flush kit').key;
      _attachAdd(k); _attachAdd(k);
      return _byoItems.filter(x => _pbKey(x.label) === _pbKey('Flush kit')).length;
    });
    expect(n).toBe(1);
  });

  test('Add all takes everything suggested in one tap', async () => {
    await seed(); await openWithTankless();
    const r = await page.evaluate(() => {
      const before = _attachSuggestions().length;
      _attachAddAll();
      return { before, after: _attachSuggestions().length, items: _byoItems.length };
    });
    expect(r.before).toBe(2);
    expect(r.after, 'nothing left to suggest once they are on').toBe(0);
    expect(r.items).toBe(3);
  });

  test('a stale key does not throw or add a phantom line', async () => {
    await seed(); await openWithTankless();
    const n = await page.evaluate(() => { _attachAdd('no such line'); return _byoItems.length; });
    expect(n).toBe(1);
  });

  // ── 4. T&M gets the same card, from the same renderer ──────────────────────

  test('T&M suggests off its material categories and adds a category, not a BYO item', async () => {
    await seed();
    const r = await page.evaluate(() => {
      _geiIsFreeForm = false; _geiIsTM = true; _attachSkipped = [];
      _byoItems = [];
      _geiLines = [{ desc: 'Tankless water heater, 199k btu', qty: 1, unit: 'lot', rate: 3200, total: 3200 }];
      const sugg = _attachSuggestions().map(s => s.line.label);
      _attachAdd(_attachSuggestions().find(s => s.line.label === 'Isolation valve kit').key);
      const added = _geiLines.find(l => _pbKey(l.desc) === _pbKey('Isolation valve kit'));
      return { sugg, byo: _byoItems.length, added: added ? { unit: added.unit, qty: added.qty, total: added.total } : null };
    });
    expect(r.sugg).toContain('Isolation valve kit');
    expect(r.byo, 'a T&M estimate must not grow BYO items').toBe(0);
    expect(r.added, 'the shape _tmMatCatSave writes, so the row stays editable').toEqual({ unit: 'lot', qty: 1, total: 214 });
  });

  test('the card renders into the T&M material list, and into BYO sections', async () => {
    await seed();
    const r = await page.evaluate(() => {
      _geiIsFreeForm = false; _geiIsTM = true; _attachSkipped = [];
      _byoItems = [];
      _geiLines = [{ desc: 'Tankless water heater, 199k btu', qty: 1, unit: 'lot', rate: 3200, total: 3200 }];
      _tmRenderMatList();
      const tm = (document.getElementById('tm-mat-list')?.innerHTML || '').includes('Usually goes with this');
      _geiIsFreeForm = true; _geiIsTM = false;
      _geiLines = [];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Tankless water heater, 199k btu', qty: 1, rate: 3200, on: true })];
      _byoRenderSections();
      const byo = (document.getElementById('byo-sections')?.innerHTML || '').includes('Usually goes with this');
      return { tm, byo };
    });
    expect(r.tm).toBe(true);
    expect(r.byo).toBe(true);
  });

  test('the card sits BELOW the work, not above it', async () => {
    await seed(); await openWithTankless();
    const below = await page.evaluate(() => {
      _byoRenderSections();
      const html = document.getElementById('byo-sections').innerHTML;
      return html.indexOf('Tankless water heater') < html.indexOf('Usually goes with this');
    });
    expect(below, 'a suggestion about what is on the estimate belongs under it').toBe(true);
  });

  // ── 5. Skip means this time ────────────────────────────────────────────────

  test('skip drops one row and leaves the rest', async () => {
    await seed(); await openWithTankless();
    const r = await page.evaluate(() => {
      const k = _attachSuggestions().find(s => s.line.label === 'Flush kit').key;
      _attachSkip(k);
      return { left: _attachSuggestions().map(s => s.line.label), skipped: _attachSkipped.length };
    });
    expect(r.left).toEqual(['Isolation valve kit']);
    expect(r.skipped).toBe(1);
  });

  test('skipping everything hides the card entirely', async () => {
    await seed(); await openWithTankless();
    const card = await page.evaluate(() => {
      _attachSuggestions().forEach(s => _attachSkip(s.key));
      return _attachCardHTML();
    });
    expect(card).toBe('');
  });

  test('a skip never outlives the estimate it was made on', async () => {
    await seed();
    const r = await page.evaluate(() => {
      _attachSkipped = ['flush kit', 'isolation valve kit'];
      openGenericEstimate(getClientById(89001), null, 'plumbing', { mode: 'byo' });
      return _attachSkipped.length;
    });
    expect(r, 'next job the history may say something different').toBe(0);
  });

  // ── Layout and errors ──────────────────────────────────────────────────────

  test('no horizontal bleed at 390px with the card up', async () => {
    await seed(); await openWithTankless();
    const bleed = await page.evaluate(() => {
      _byoShowPage();
      _byoRenderSections();
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(bleed).toBeLessThanOrEqual(1);
  });

  test('no console errors', async () => {
    assertNoErrors(page);
  });
});
