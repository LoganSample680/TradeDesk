// @ts-check
// ── Places, drive attribution and the map ────────────────────────────────────
//
// The fence machine knew two kinds of place, the shop and job sites, so supply
// houses were invisible and drive tracking was wrong three ways:
//
//   1. Time PARKED at a supply house counted as driving. Nothing contained the
//      truck, so the clock ran while it sat in the lot and those minutes landed
//      on the next job's leg.
//   2. A supply run that returned to the shop logged NOTHING, because a drive
//      entry was only ever written on arriving at a JOB. A real deductible round
//      trip produced zero miles.
//   3. Every leg billed to its destination job, so shop -> supply -> job charged
//      that job for the supply stop too.
//
// Mileage is a deduction, so these are accuracy defects. This suite defends the
// rules that keep the numbers honest, especially the ones that stop the app
// inflating someone's deduction on their behalf:
//
//   • a receipt only creates a place if the stamp is CONTEMPORANEOUS with the
//     expense date (otherwise the coordinate is the sofa, not the supply house)
//   • a loose fix never creates a place and never plots
//   • an unknown stop is OFFERED after repetition, never assumed
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Places, drive attribution and the map', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test.beforeEach(async () => {
    await page.evaluate(() => {
      places.length = 0; expenses.length = 0;
      try { localStorage.removeItem('zp3_place_stops'); } catch (e) {}
    });
  });

  // ── The synced table, not a settings key ───────────────────────────────────

  test('td_places is registered in the sync fabric', async () => {
    const out = await page.evaluate(() => {
      const t = (_TD_TABLES || []).find(x => x.t === 'td_places');
      if (!t) return { found: false };
      places.length = 0;
      t.set([{ id: 1, name: 'Ferguson', lat: 1, lon: 2 }]);
      const afterSet = places.length;
      return { found: true, afterSet, getsLive: t.get() === places, swept: !!_lastKnownIds.td_places };
    });
    expect(out.found).toBe(true);
    expect(out.afterSet).toBe(1);
    // get() must hand back the LIVE array, not a copy, or writes vanish.
    expect(out.getsLive).toBe(true);
    expect(out.swept).toBe(true);
  });

  // ── Creation from a receipt ────────────────────────────────────────────────

  test('a contemporaneous receipt with a tight fix becomes a named supply house', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 1, date: today, vendor: 'Ferguson Plumbing', amount: 340,
                      lat: 37.688, lon: -97.336, geoAcc: 11, geoAt: today + 'T14:02:00Z' });
      const made = detectPlacesFromExpenses();
      return { made, places: JSON.parse(JSON.stringify(places)) };
    });
    expect(out.made).toBe(1);
    expect(out.places[0].name).toBe('Ferguson Plumbing');
    expect(out.places[0].kind).toBe('supply');
    // The provenance matters: this one is receipt-backed, which is the strongest
    // kind (destination AND business purpose, per Pub 463).
    expect(out.places[0].confirmedBy).toBe('expense');
  });

  test('a receipt logged that evening from the sofa does NOT create a place', async () => {
    const out = await page.evaluate(() => {
      expenses.push({ id: 2, date: '2026-07-20', vendor: 'Ferguson Plumbing', amount: 340,
                      lat: 37.5, lon: -97.5, geoAcc: 8, geoAt: '2026-07-22T21:40:00Z' });
      return { made: detectPlacesFromExpenses(), count: places.length };
    });
    // Otherwise the contractor's living room becomes a supply house and every
    // future drive leg through it is misattributed.
    expect(out.made).toBe(0);
    expect(out.count).toBe(0);
  });

  test('a loose fix never creates a place', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 3, date: today, vendor: 'Somewhere', amount: 10,
                      lat: 37.6, lon: -97.3, geoAcc: 3000, geoAt: today + 'T10:00:00Z' });
      return { made: detectPlacesFromExpenses(), count: places.length };
    });
    // A 3km wifi fix would put the pin on the wrong side of a retail park.
    expect(out.made).toBe(0);
    expect(out.count).toBe(0);
  });

  test('detection is idempotent: re-running never duplicates a place', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 4, date: today, vendor: 'Ferguson', amount: 10,
                      lat: 37.688, lon: -97.336, geoAcc: 11, geoAt: today + 'T10:00:00Z' });
      detectPlacesFromExpenses();
      detectPlacesFromExpenses();
      detectPlacesFromExpenses();
      return places.length;
    });
    expect(out).toBe(1);
  });

  test('a second receipt at the same lot does not create a second place', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 5, date: today, vendor: 'Ferguson', amount: 10,
                      lat: 37.688, lon: -97.336, geoAcc: 11, geoAt: today + 'T10:00:00Z' });
      detectPlacesFromExpenses();
      // ~90ft away, same parking lot.
      expenses.push({ id: 6, date: today, vendor: 'Ferguson Plumbing Supply', amount: 22,
                      lat: 37.68825, lon: -97.336, geoAcc: 9, geoAt: today + 'T15:00:00Z' });
      detectPlacesFromExpenses();
      return places.length;
    });
    expect(out).toBe(1);
  });

  // ── Lookup ────────────────────────────────────────────────────────────────

  test('placeAt matches inside the fence and misses outside it', async () => {
    const out = await page.evaluate(() => {
      savePlace({ name: 'Shop', kind: 'shop', lat: 37.688, lon: -97.336 });
      return {
        inside: !!placeAt({ lat: 37.68815, lon: -97.336 }),   // ~55ft
        outside: !!placeAt({ lat: 37.75, lon: -97.336 }),     // miles away
        nullSafe: placeAt(null),
        emptySafe: placeAt({}),
      };
    });
    expect(out.inside).toBe(true);
    expect(out.outside).toBe(false);
    expect(out.nullSafe).toBe(null);
    expect(out.emptySafe).toBe(null);
  });

  test('a per-place fenceFt overrides the default radius', async () => {
    const out = await page.evaluate(() => {
      savePlace({ name: 'Lumber yard', kind: 'supply', lat: 37.688, lon: -97.336, fenceFt: 2000 });
      // ~1100ft: outside the 600ft default, inside this yard's own fence.
      return !!placeAt({ lat: 37.6910, lon: -97.336 });
    });
    expect(out).toBe(true);
  });

  // ── Repeat stops are offered, never assumed ───────────────────────────────

  test('a stop under 5 minutes is not recorded at all', async () => {
    const out = await page.evaluate(() => {
      recordUnknownStop({ lat: 37.7, lon: -97.4 }, 60 * 1000);
      return pendingPlaceSuggestions().length;
    });
    // A traffic light is not a stop.
    expect(out).toBe(0);
  });

  test('an unknown stop is offered only after it repeats', async () => {
    const out = await page.evaluate(() => {
      const c = { lat: 37.7, lon: -97.4 }, dwell = 6 * 60 * 1000;
      recordUnknownStop(c, dwell);
      const after1 = pendingPlaceSuggestions().length;
      recordUnknownStop(c, dwell);
      const after2 = pendingPlaceSuggestions().length;
      recordUnknownStop(c, dwell);
      const after3 = pendingPlaceSuggestions().length;
      return { after1, after2, after3 };
    });
    // We know someone stops there. We do NOT know what it is, or that it is
    // business, so it is a question rather than a new place.
    expect(out.after1).toBe(0);
    expect(out.after2).toBe(0);
    expect(out.after3).toBe(1);
  });

  test('a stop inside an existing place is never suggested', async () => {
    const out = await page.evaluate(() => {
      savePlace({ name: 'Ferguson', kind: 'supply', lat: 37.7, lon: -97.4 });
      const c = { lat: 37.7, lon: -97.4 }, dwell = 6 * 60 * 1000;
      recordUnknownStop(c, dwell); recordUnknownStop(c, dwell); recordUnknownStop(c, dwell);
      return pendingPlaceSuggestions().length;
    });
    expect(out).toBe(0);
  });

  test('a suggestion can be dismissed', async () => {
    const out = await page.evaluate(() => {
      const c = { lat: 37.7, lon: -97.4 }, dwell = 6 * 60 * 1000;
      recordUnknownStop(c, dwell); recordUnknownStop(c, dwell); recordUnknownStop(c, dwell);
      const before = pendingPlaceSuggestions().length;
      dismissPlaceSuggestion(37.7, -97.4);
      return { before, after: pendingPlaceSuggestions().length };
    });
    expect(out.before).toBe(1);
    expect(out.after).toBe(0);
  });

  // ── Delete registers with the sweep ───────────────────────────────────────

  test('deleting a place records the id so the cloud sweep can remove it', async () => {
    const out = await page.evaluate(() => {
      const pl = savePlace({ name: 'Gone', kind: 'other', lat: 1, lon: 2 });
      const id = String(pl.id);
      deletePlace(id);
      return {
        removed: !places.find(p => String(p.id) === id),
        markedDeleted: !!(_locallyDeletedIds.td_places && _locallyDeletedIds.td_places.has(id)),
      };
    });
    expect(out.removed).toBe(true);
    // Without this the row resurrects on every other device (§9.8).
    expect(out.markedDeleted).toBe(true);
  });

  // ── The map feed ──────────────────────────────────────────────────────────

  test('geoFeed merges every stamped record type and skips unstamped ones', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 10, date: today, vendor: 'Ferguson', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      expenses.push({ id: 11, date: today, vendor: 'No coords', amount: 5 });
      jobs.push({ id: 12, client_name: 'Smith', start: today, lat: 37.69, lon: -97.34, geoAcc: 10 });
      bids.push({ id: 13, client_name: 'Jones', date: today, lat: 37.70, lon: -97.35, geoAcc: 10 });
      payments.push({ id: 14, client_name: 'Smith', date: today, amount: 500, lat: 37.71, lon: -97.36, geoAcc: 10 });
      savePlace({ name: 'Shop', kind: 'shop', lat: 37.72, lon: -97.37 });
      const feed = geoFeed({});
      const types = feed.map(f => f.type).sort();
      jobs.length = 0; bids.length = 0; payments.length = 0;
      return { n: feed.length, types };
    });
    expect(out.n).toBe(5); // the unstamped expense is absent
    expect(out.types).toEqual(['estimate', 'expense', 'job', 'payment', 'place']);
  });

  test('geoFeed drops points whose fix is too loose to mean anything', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 20, date: today, vendor: 'Tight', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 20 });
      expenses.push({ id: 21, date: today, vendor: 'Loose', amount: 5, lat: 37.69, lon: -97.34, geoAcc: 4000 });
      return geoFeed({ types: ['expense'] }).map(f => f.label);
    });
    expect(out).toEqual(['Tight']);
  });

  test('geoFeed filters by type', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 30, date: today, vendor: 'E', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      savePlace({ name: 'P', kind: 'shop', lat: 37.72, lon: -97.37 });
      return {
        onlyPlaces: geoFeed({ types: ['place'] }).map(f => f.type),
        onlyExpenses: geoFeed({ types: ['expense'] }).map(f => f.type),
      };
    });
    expect(out.onlyPlaces).toEqual(['place']);
    expect(out.onlyExpenses).toEqual(['expense']);
  });

  // ── The map renders ───────────────────────────────────────────────────────

  test('the map renders a dot per point and an empty state with none', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      renderGeoMap();
      const emptyHtml = document.getElementById('tr-map-body').innerHTML;
      expenses.push({ id: 40, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      expenses.push({ id: 41, date: today, vendor: 'B', amount: 5, lat: 37.70, lon: -97.35, geoAcc: 10 });
      renderGeoMap();
      const html = document.getElementById('tr-map-body').innerHTML;
      return {
        emptyMentionsAuto: /automatically/i.test(emptyHtml),
        dots: (html.match(/maps\?q=/g) || []).length,
      };
    });
    expect(out.emptyMentionsAuto).toBe(true);
    expect(out.dots).toBe(2);
  });

  test('a single point does not divide by zero, it renders centred', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 50, date: today, vendor: 'Only', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      let threw = false;
      try { renderGeoMap(); } catch (e) { threw = true; }
      const html = document.getElementById('tr-map-body').innerHTML;
      return { threw, hasDot: /maps\?q=/.test(html), hasNaN: /NaN/.test(html) };
    });
    expect(out.threw).toBe(false);
    expect(out.hasDot).toBe(true);
    // A zero-span bounding box is the obvious crash here.
    expect(out.hasNaN).toBe(false);
  });

  test('the type filter toggles points off and back on', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 60, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      savePlace({ name: 'P', kind: 'shop', lat: 37.72, lon: -97.37 });
      renderGeoMap();
      const both = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      toggleGeoMapType('expense');
      const off = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      toggleGeoMapType('expense');
      const on = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      return { both, off, on };
    });
    expect(out.both).toBe(2);
    expect(out.off).toBe(1);
    expect(out.on).toBe(2);
  });

  test('the map tab is wired into setTrTab', async () => {
    const out = await page.evaluate(() => {
      setTrTab('map', document.getElementById('tr-t-map'));
      return {
        paneShown: document.getElementById('tr-map').style.display === 'block',
        tabActive: document.getElementById('tr-t-map').classList.contains('active'),
        othersHidden: document.getElementById('tr-expenses').style.display === 'none',
      };
    });
    expect(out.paneShown).toBe(true);
    expect(out.tabActive).toBe(true);
    expect(out.othersHidden).toBe(true);
  });

  // ── Corrupt / hostile input ───────────────────────────────────────────────

  test('savePlace refuses a place with no coordinates', async () => {
    const out = await page.evaluate(() => ({
      noCoords: savePlace({ name: 'Nowhere' }),
      nullArg: savePlace(null),
      count: places.length,
    }));
    expect(out.noCoords).toBe(null);
    expect(out.nullArg).toBe(null);
    expect(out.count).toBe(0);
  });

  test('a corrupted stop cache never throws', async () => {
    const out = await page.evaluate(() => {
      localStorage.setItem('zp3_place_stops', '{NOT JSON{{{');
      let threw = false;
      try { recordUnknownStop({ lat: 1, lon: 2 }, 6 * 60 * 1000); pendingPlaceSuggestions(); }
      catch (e) { threw = true; }
      return threw;
    });
    expect(out).toBe(false);
  });

  test('zero console errors across the places suite', async () => {
    assertNoErrors(page, 'places, drive attribution and map');
  });
});
