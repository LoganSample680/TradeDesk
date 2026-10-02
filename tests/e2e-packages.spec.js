// @ts-check
/**
 * Start from what he already sells.
 *
 * Owner 2026-09-07: smart enough and fast enough that the whole thing gets
 * built and presented at the house. The research says the same thing from the
 * other side: 78% of homeowners hire whoever answers first, and a reply inside
 * a minute books 73% of the time against 4% after half an hour. The document
 * cannot win that race, only the clock can.
 *
 * Everything else in the estimate is already free: the name writes itself, the
 * scope comes from the lines, the exclusions are presets, the description comes
 * back out of the price book. The last expensive thing is naming the six lines
 * he sells on every job of this kind, and he has already typed them on every
 * previous bid.
 *
 * What we verify:
 *  1. "Same as last time" is the most recent real bid for THIS trade
 *  2. "What you always sell" needs enough history and must differ from the last
 *  3. Applying carries his CURRENT book price and words, not the old job's
 *  4. The card is only on an empty estimate, and only when there is history
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('packages from his own history', () => {
  let page;

  const seed = (rows) => page.evaluate(list => {
    bids = bids.filter(b => !String(b.id).startsWith('91'));
    bids = bids.concat(list.map(r => ({
      id: r.id, client_id: 91001, client_name: 'Pkg', trade_type: r.trade || 'plumbing',
      bid_date: r.date, status: r.status || 'Closed Won', draft: false,
      byoItems: (r.lines || []).map((l, i) => ({ id: i + 1, section: 'Work', label: l, qty: 1, unit: 'ea', rate: 100, price: 100, notes: 'old words', on: true }))
    })));
    _byoItems = []; _geiEditBidId = null; _geiTrade = 'plumbing'; _geiIsFreeForm = true; _geiIsTM = false;
    S.priceBook = {};
  }, rows);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. Same as last time ───────────────────────────────────────────────────

  test('the most recent bid for this trade, newest first', async () => {
    await seed([
      { id: 91001, date: '2026-08-01', lines: ['Old job line'] },
      { id: 91002, date: '2026-09-01', lines: ['Water heater replacement', 'Expansion tank', 'Drain pan'] },
    ]);
    const r = await page.evaluate(() => _pkgSuggestions('plumbing'));
    expect(r[0].key).toBe('last');
    expect(r[0].lines.map(l => l.label)).toEqual(['Water heater replacement', 'Expansion tank', 'Drain pan']);
    expect(r[0].sub).toContain('3 lines');
  });

  test('another trade\'s bids are never offered', async () => {
    await seed([
      { id: 91001, date: '2026-09-01', trade: 'roofing', lines: ['Tear-off'] },
      { id: 91002, date: '2026-08-01', trade: 'plumbing', lines: ['Shutoff valve'] },
    ]);
    const r = await page.evaluate(() => _pkgSuggestions('plumbing'));
    expect(r[0].lines.map(l => l.label)).toEqual(['Shutoff valve']);
  });

  test('an empty bid, a cancelled one, and the one being edited are all skipped', async () => {
    const r = await page.evaluate(() => {
      bids = bids.filter(b => !String(b.id).startsWith('91')).concat([
        { id: 91009, trade_type: 'plumbing', bid_date: '2026-09-05', byoItems: [] },
        { id: 91008, trade_type: 'plumbing', bid_date: '2026-09-04', cancelledAt: 'x', byoItems: [{ id: 1, label: 'Cancelled line', on: true }] },
        { id: 91007, trade_type: 'plumbing', bid_date: '2026-09-03', byoItems: [{ id: 1, label: 'Being edited', on: true }] },
        { id: 91006, trade_type: 'plumbing', bid_date: '2026-09-02', byoItems: [{ id: 1, label: 'The real one', on: true }] },
      ]);
      _geiEditBidId = 91007;
      const out = _pkgSuggestions('plumbing');
      _geiEditBidId = null;
      return out;
    });
    expect(r[0].lines.map(l => l.label), 'a blank stub is not a job he sold').toEqual(['The real one']);
  });

  test('no history at all offers nothing', async () => {
    const r = await page.evaluate(() => {
      bids = bids.filter(b => !String(b.id).startsWith('91'));
      return _pkgSuggestions('plumbing');
    });
    expect(r).toEqual([]);
  });

  // ── 2. What you always sell ────────────────────────────────────────────────

  test('the usual package needs enough history behind it', async () => {
    await seed([
      { id: 91001, date: '2026-09-01', lines: ['A', 'B'] },
      { id: 91002, date: '2026-08-01', lines: ['A', 'B'] },
    ]);
    const r = await page.evaluate(() => _pkgSuggestions('plumbing').map(x => x.key));
    expect(r, 'two bids is a last time, not a usually').toEqual(['last']);
  });

  test('lines on most jobs become the package, rare ones do not', async () => {
    await seed([
      { id: 91001, date: '2026-09-01', lines: ['Water heater', 'Expansion tank', 'One-off oddity'] },
      { id: 91002, date: '2026-08-01', lines: ['Water heater', 'Expansion tank', 'Drain pan'] },
      { id: 91003, date: '2026-07-01', lines: ['Water heater', 'Expansion tank', 'Drain pan'] },
      { id: 91004, date: '2026-06-01', lines: ['Water heater', 'Expansion tank', 'Drain pan'] },
    ]);
    const r = await page.evaluate(() => _pkgSuggestions('plumbing'));
    const usual = r.find(x => x.key === 'usual');
    expect(usual).toBeTruthy();
    const labels = usual.lines.map(l => l.label);
    expect(labels).toContain('Water heater');
    expect(labels).toContain('Expansion tank');
    expect(labels, 'on three of four jobs, so it is usual').toContain('Drain pan');
    expect(labels, 'once in four is not a package').not.toContain('One-off oddity');
    expect(usual.sub).toContain('4 jobs');
  });

  test('when the usual package IS the last job, it is not offered twice', async () => {
    await seed([
      { id: 91001, date: '2026-09-01', lines: ['A', 'B'] },
      { id: 91002, date: '2026-08-01', lines: ['A', 'B'] },
      { id: 91003, date: '2026-07-01', lines: ['A', 'B'] },
      { id: 91004, date: '2026-06-01', lines: ['A', 'B'] },
    ]);
    const r = await page.evaluate(() => _pkgSuggestions('plumbing').map(x => x.key));
    expect(r, 'the same button twice is not a choice').toEqual(['last']);
  });

  // ── 3. Applying it ─────────────────────────────────────────────────────────

  test('the book supplies the current price and the current words', async () => {
    await seed([{ id: 91002, date: '2026-09-01', lines: ['Water heater replacement', 'Expansion tank'] }]);
    const r = await page.evaluate(() => {
      // The book has since learned a new rate and a real description.
      _pbLearn('Water heater replacement', 1650, 'ea', '50 gal gas, haul-off, new flex lines');
      _pkgApply('last');
      return _byoItems.map(i => ({ label: i.label, rate: i.rate, notes: i.notes, qty: i.qty, unit: i.unit }));
    });
    expect(r.length).toBe(2);
    expect(r[0].rate, 'his CURRENT price, not what the old job charged').toBe(1650);
    expect(r[0].notes).toBe('50 gal gas, haul-off, new flex lines');
    expect(r[0].qty, 'the count is the one thing that is genuinely per job').toBe(1);
    expect(r[1].rate, 'a line the book does not know keeps the old job\'s rate').toBe(100);
    expect(r[1].notes).toBe('old words');
  });

  // Owner 2026-09-30: "if we add what we did last time it doesn't break the
  // steps down like we do with Tim today". Jack's real last bid, word for word.
  test('Same as last time goes through Tim: a lumped old line comes back as today\'s steps and rooms', async () => {
    await page.evaluate(() => {
      bids = bids.filter(b => !String(b.id).startsWith('91')).concat([{ id: 91010, client_id: 91001, trade_type: 'plumbing', bid_date: '2026-09-30', status: 'Draft', byoItems: [
        'Rough surface mounted washer box drain and water and vent',
        'Electrical for washer receptacle and receptacle for dryer',
        'Drill hole and run dryer vent to outside',
        '3 hose bibs and piping',
        'Cap the gas line to the gas light out front and existing washer lines and seal duct except enough to keep crawl from freezing',
        'Secure the tub spout',
      ].map((l, i) => ({ id: i + 1, section: 'Work', label: l, qty: 1, unit: 'ea', rate: 0, price: 0, notes: '', on: true })) }]);
      _byoItems = []; _geiEditBidId = null; _geiTrade = 'plumbing'; _geiIsFreeForm = true; _geiIsTM = false; S.priceBook = {};
    });
    const r = await page.evaluate(() => { _pkgApply('last'); return _byoItems.map(i => ({ l: i.label, s: i.section })); });
    const labels = r.map(x => x.l.toLowerCase());
    expect(labels.some(l => /^cap .*gas/.test(l) && !/washer/.test(l)), 'the gas cap is its own step').toBe(true);
    expect(labels.some(l => /washer lines/.test(l) && !/gas/.test(l)), 'the washer lines are their own step').toBe(true);
    expect(new Set(r.map(x => x.s)).size, 'grouped by room, like a typed scope').toBeGreaterThan(1);
  });

  test('a last bid that was a pasted letter in one line comes back as steps, not one line', async () => {
    const letter = "Here's my estimate $2800 to rough surface mounted washer box drain and water and vent. I have included electrical for washer receptacle and receptacle for dryer as well. I will drill hole and run dryer vent to outside. We will secure the tub spout. My estimate is good for 14 days. John Schonfeldt Plumbing Solutions by JS";
    await page.evaluate((letter) => {
      bids = bids.filter(b => !String(b.id).startsWith('91')).concat([{ id: 91011, client_id: 91001, trade_type: 'plumbing', bid_date: '2026-09-30', status: 'Draft',
        byoItems: [{ id: 1, section: 'Work', label: '5713 SW 14th street', qty: 1, unit: 'ea', rate: 2800, price: 2800, notes: letter, on: true }] }]);
      _byoItems = []; _geiEditBidId = null; _geiTrade = 'plumbing'; _geiIsFreeForm = true; _geiIsTM = false; S.priceBook = {};
    }, letter);
    const r = await page.evaluate(() => { _pkgApply('last'); return { n: _byoItems.filter(i => !i._supply).length, labels: _byoItems.map(i => i.label) }; });
    expect(r.n).toBeGreaterThanOrEqual(4);
    expect(r.labels.join('|')).not.toMatch(/5713 SW 14th/);
    await assertNoErrors(page);
  });

  test('applying twice never doubles a line up', async () => {
    await seed([{ id: 91002, date: '2026-09-01', lines: ['A', 'B'] }]);
    const n = await page.evaluate(() => { _pkgApply('last'); _pkgApply('last'); return _byoItems.length; });
    expect(n).toBe(2);
  });

  test('a bad key and an empty history apply nothing and never throw', async () => {
    await seed([{ id: 91002, date: '2026-09-01', lines: ['A'] }]);
    const r = await page.evaluate(() => {
      let threw = false;
      try { _pkgApply('nonsense'); _pkgApply(); _pkgApply(null); } catch (e) { threw = true; }
      return { threw, n: _byoItems.length };
    });
    expect(r.threw).toBe(false);
    expect(r.n).toBe(0);
  });

  // ── 4. When the card shows ─────────────────────────────────────────────────

  test('the card is on an empty estimate and gone the moment there is a line', async () => {
    await seed([{ id: 91002, date: '2026-09-01', lines: ['A', 'B'] }]);
    const r = await page.evaluate(() => {
      const empty = _pkgCardHTML();
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Something', rate: 10, on: true })];
      const filled = _pkgCardHTML();
      _byoItems = [_byoNormItem({ id: 1, section: 'Disclosures', label: 'Lead-safe', rate: 0, _rrp: true, on: true })];
      const onlyRrp = _pkgCardHTML();
      return { hasEmpty: empty.includes('Start from what you sell'), filled, onlyRrp: onlyRrp.includes('Start from what you sell') };
    });
    expect(r.hasEmpty).toBe(true);
    expect(r.filled, 'once there is a line it has done its job').toBe('');
    expect(r.onlyRrp, 'an auto-injected disclosure is not a line he wrote').toBe(true);
  });

  test('no history means no card, not an empty one', async () => {
    const html = await page.evaluate(() => {
      bids = bids.filter(b => !String(b.id).startsWith('91'));
      _byoItems = [];
      return _pkgCardHTML();
    });
    expect(html).toBe('');
  });

  test('no console errors across the package loop', async () => {
    await assertNoErrors(page);
  });
});
