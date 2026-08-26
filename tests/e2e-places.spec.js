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

  // Full isolation. These are real globals and real localStorage keys, not
  // fixtures, so anything a test sets leaks into the next one. S.officeLat in
  // particular makes renderPlaces() lift a shop in and throws off every count.
  test.beforeEach(async () => {
    await page.evaluate(() => {
      places.length = 0; expenses.length = 0;
      jobs.length = 0; bids.length = 0; payments.length = 0;
      S.officeLat = 0; S.officeLon = 0;
      try {
        localStorage.removeItem('zp3_place_stops');
        localStorage.removeItem('zp3_place_day_anchor');
      } catch (e) {}
      document.getElementById('place-modal')?.remove();
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

  test('an EVENING receipt still creates a place (UTC vs local day bug)', async () => {
    const out = await page.evaluate(() => {
      // rec.date is a LOCAL day key; geoAt is a UTC ISO string. Anywhere west of
      // UTC those disagree all evening: at 9pm Central it is already tomorrow in
      // UTC. Comparing geoAt.slice(0,10) against the local date therefore made
      // EVERY receipt logged after about 6pm look like next-day paperwork, so it
      // silently never became a supply house. Evening supply runs are exactly
      // what this feature is for.
      const p2 = n => String(n).padStart(2, '0');
      const now = new Date();
      // A stamp 3 hours from now: on a runner behind UTC this rolls geoAt into
      // tomorrow UTC while the local day key stays today.
      const later = new Date(now.getTime() + 3 * 3600 * 1000);
      const localDate = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
      const sameLocalDay =
        later.getFullYear() + '-' + p2(later.getMonth() + 1) + '-' + p2(later.getDate()) === localDate;
      expenses.push({
        id: 700, date: localDate, vendor: 'Evening Supply Run', amount: 88,
        lat: 37.777, lon: -97.777, geoAcc: 10, geoAt: later.toISOString(),
      });
      return { made: detectPlacesFromExpenses(), count: places.length, sameLocalDay,
               utcDiffers: later.toISOString().slice(0, 10) !== localDate };
    });
    // Only meaningful while the shifted stamp is still the same LOCAL day.
    if (!out.sameLocalDay) return;
    expect(out.made).toBe(1);
    expect(out.count).toBe(1);
  });

  test('_geoLocalDayKey converts a UTC stamp to the LOCAL calendar day', async () => {
    const out = await page.evaluate(() => {
      const d = new Date();
      const p2 = n => String(n).padStart(2, '0');
      const expected = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      return {
        matchesLocal: _geoLocalDayKey(d.toISOString()) === expected,
        garbageSafe: _geoLocalDayKey('not-a-date'),
        emptySafe: _geoLocalDayKey(''),
      };
    });
    expect(out.matchesLocal).toBe(true);
    expect(out.garbageSafe).toBe('');
    expect(out.emptySafe).toBe('');
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

  // ── A job-linked expense plots at the job site, not where it was logged ────

  test('geoFeed uses the linked job\'s address coords for a job expense, not its own GPS fix', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      jobs.push({ id: 60, client_name: 'Site Job', start: today, lat: 40.0, lon: -80.0 });
      // Logged from the office, nowhere near the job, on purpose.
      expenses.push({ id: 61, date: today, vendor: 'Lowes', amount: 5, job_id: 60, lat: 39.0, lon: -79.0, geoAcc: 10 });
      const feed = geoFeed({ types: ['expense'] });
      jobs.length = 0;
      return feed[0];
    });
    expect(out.lat).toBe(40.0);
    expect(out.lon).toBe(-80.0);
  });

  test('geoFeed falls back to the expense\'s own GPS fix when the linked job has no coords yet', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      jobs.push({ id: 62, client_name: 'Ungeocoded Job', start: today });
      expenses.push({ id: 63, date: today, vendor: 'Lowes', amount: 5, job_id: 62, lat: 39.0, lon: -79.0, geoAcc: 10 });
      const feed = geoFeed({ types: ['expense'] });
      jobs.length = 0;
      return feed[0];
    });
    expect(out.lat).toBe(39.0);
    expect(out.lon).toBe(-79.0);
  });

  test('geoFeed uses a standalone (no job_id) expense\'s own GPS fix as before', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 64, date: today, vendor: 'Home Depot', amount: 5, lat: 39.5, lon: -79.5, geoAcc: 10 });
      return geoFeed({ types: ['expense'] })[0];
    });
    expect(out.lat).toBe(39.5);
    expect(out.lon).toBe(-79.5);
  });

  test('geoFeed prefers a resolved vendor location over the expense\'s own GPS fix', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      // Loose fix (would fail the geoAcc floor on its own) logged nowhere near
      // the store, e.g. receipt done from the truck that night.
      expenses.push({ id: 65, date: today, vendor: 'Ferguson', amount: 5, lat: 30.0, lon: -70.0, geoAcc: 5000, vendorLat: 41.2, vendorLon: -96.2 });
      return geoFeed({ types: ['expense'] })[0];
    });
    expect(out.lat).toBe(41.2);
    expect(out.lon).toBe(-96.2);
  });

  // ── _expenseVendorGeocode: resolve a receipt to the real business, not home ─

  test('_expenseVendorGeocode matches an already-known place first, no network call', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      let called = false;
      window._resolveCoords = async () => { called = true; return { lat: 1, lng: 1 }; };
      savePlace({ name: 'Ferguson Plumbing Supply', kind: 'supply', lat: 41.5, lon: -96.5 });
      expenses.push({ id: 70, date: todayKey(), vendor: 'Ferguson', amount: 5, lat: 39.0, lon: -79.0 });
      await _expenseVendorGeocode();
      window._resolveCoords = realResolve;
      const e = expenses.find(x => x.id === 70);
      return { called, vendorLat: e.vendorLat, vendorLon: e.vendorLon };
    });
    expect(out.called).toBe(false);
    expect(out.vendorLat).toBe(41.5);
    expect(out.vendorLon).toBe(-96.5);
  });

  test('_expenseVendorGeocode falls back to a business-name search when no place matches', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      window._resolveCoords = async (q) => (q === 'Lowes' ? { lat: 42.0, lng: -95.0 } : null);
      expenses.push({ id: 71, date: todayKey(), vendor: 'Lowes', amount: 5, lat: 39.0, lon: -79.0 });
      await _expenseVendorGeocode();
      window._resolveCoords = realResolve;
      const e = expenses.find(x => x.id === 71);
      return { vendorLat: e.vendorLat, vendorLon: e.vendorLon };
    });
    expect(out.vendorLat).toBe(42.0);
    expect(out.vendorLon).toBe(-95.0);
  });

  test('_expenseVendorGeocode skips job-linked and already-resolved expenses', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      let calls = 0;
      window._resolveCoords = async () => { calls++; return { lat: 9, lng: 9 }; };
      expenses.push({ id: 72, date: todayKey(), vendor: 'Skip Job', amount: 5, job_id: 999 });
      expenses.push({ id: 73, date: todayKey(), vendor: 'Skip Resolved', amount: 5, vendorLat: 5, vendorLon: 5 });
      expenses.push({ id: 74, date: todayKey(), vendor: '', amount: 5 });
      await _expenseVendorGeocode();
      window._resolveCoords = realResolve;
      return { calls, e72: expenses.find(x => x.id === 72).vendorLat, e73: expenses.find(x => x.id === 73).vendorLat };
    });
    expect(out.calls).toBe(0);
    expect(out.e72).toBeUndefined();
    expect(out.e73).toBe(5);
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

  test('openGeoMap paints immediately, then repaints once vendor resolution lands', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      window._resolveCoords = async () => { await new Promise(r => setTimeout(r, 20)); return { lat: 44.0, lng: -93.0 }; };
      expenses.push({ id: 80, date: todayKey(), vendor: 'Late Night Receipt', amount: 5, lat: 39.0, lon: -79.0, geoAcc: 10 });
      openGeoMap();
      const immediateHtml = document.getElementById('tr-map-body').innerHTML;
      await new Promise(r => setTimeout(r, 80));
      window._resolveCoords = realResolve;
      const e = expenses.find(x => x.id === 80);
      return {
        paintedImmediately: /maps\?q=/.test(immediateHtml),
        vendorResolved: e.vendorLat === 44.0,
      };
    });
    expect(out.paintedImmediately).toBe(true);
    expect(out.vendorResolved).toBe(true);
  });

  test('the type filter toggles points off and back on', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 60, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      jobs.push({ id: 61, client_name: 'J', start: today, lat: 37.72, lon: -97.37, geoAcc: 10 });
      renderGeoMap();
      const both = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      toggleGeoMapType('expense');
      const off = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      toggleGeoMapType('expense');
      const on = (document.getElementById('tr-map-body').innerHTML.match(/maps\?q=/g) || []).length;
      jobs.length = 0;
      return { both, off, on };
    });
    expect(out.both).toBe(2);
    expect(out.off).toBe(1);
    expect(out.on).toBe(2);
  });

  test('the legend is exactly Proposals, Jobs, Expenses, in that order', async () => {
    const out = await page.evaluate(() => {
      renderGeoMap();
      return [...document.querySelectorAll('#tr-map-filters button')]
        .map(b => b.textContent.replace(/\s*\d+\s*$/, '').trim());
    });
    // Owner-specified order, and it happens to match the order work actually
    // happens in. 'estimate' stays the internal key; this is what it's called.
    expect(out).toEqual(['Proposals', 'Jobs', 'Expenses']);
  });

  test('pins are anchored at the TIP, not centred on the coordinate', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 70, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      renderGeoMap();
      const a = document.querySelector('#tr-map-body a[href*="maps?q="]');
      const st = a.getAttribute('style');
      const mt = /margin:\s*-(\d+(?:\.\d+)?)px\s+0\s+0\s+-(\d+(?:\.\d+)?)px/.exec(st);
      return {
        isSvgPin: /<svg/.test(a.innerHTML),
        marginTop: mt ? parseFloat(mt[1]) : 0,
        marginLeft: mt ? parseFloat(mt[2]) : 0,
        // Assert the RELATIONSHIP, not the numbers: the pin can be resized
        // without this test having to be edited (it was, and it wasn't).
        pinH: _GEO_PIN_H, pinW: _GEO_PIN_W,
        hasGroundShadow: /<ellipse/.test(a.innerHTML),
      };
    });
    expect(out.isSvgPin).toBe(true);
    // Pulled up its full height and left by half its width, so the POINT of the
    // pin sits on the location. A centred dot would be half-height instead.
    expect(out.marginTop).toBe(out.pinH);
    expect(out.marginLeft).toBe(out.pinW / 2);
    // The ground shadow is what makes the precision read at a glance.
    expect(out.hasGroundShadow).toBe(true);
  });

  test('southern pins draw last so they overlap the ones behind', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      // Pushed north-last on purpose: render order must NOT follow feed order.
      expenses.push({ id: 80, date: today, vendor: 'South', amount: 5, lat: 37.60, lon: -97.33, geoAcc: 10 });
      expenses.push({ id: 81, date: today, vendor: 'North', amount: 5, lat: 37.90, lon: -97.33, geoAcc: 10 });
      renderGeoMap();
      return [...document.querySelectorAll('#tr-map-body a[href*="maps?q="]')]
        .map(a => a.getAttribute('title'));
    });
    // North first means south paints over it, which is how a real map stacks.
    expect(out[0]).toContain('North');
    expect(out[1]).toContain('South');
  });

  test('payments and places are stamped and in the feed, but not on the map', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      payments.push({ id: 90, client_name: 'Pay', date: today, amount: 100, lat: 37.68, lon: -97.33, geoAcc: 10 });
      savePlace({ name: 'Ferguson', kind: 'supply', lat: 37.69, lon: -97.34 });
      const feedTypes = geoFeed({}).map(f => f.type).sort();
      renderGeoMap();
      const body = document.getElementById('tr-map-body').innerHTML;
      const legend = [...document.querySelectorAll('#tr-map-filters button')].map(b => b.textContent);
      payments.length = 0;
      return { feedTypes, plotted: (body.match(/maps\?q=/g) || []).length, legendHasPlace: legend.some(l => /Place/.test(l)) };
    });
    // Still captured (drive attribution needs places; payments are real data)...
    expect(out.feedTypes).toContain('payment');
    expect(out.feedTypes).toContain('place');
    // ...just not shown here.
    expect(out.plotted).toBe(0);
    expect(out.legendHasPlace).toBe(false);
  });

  // ── MapKit vs the fallback ────────────────────────────────────────────────
  // MapKit tokens are domain-locked, so it never initialises on localhost and
  // these tests always exercise the fallback unless the flag is forced.

  test('with MapKit unavailable the fallback plot renders (local, offline, tests)', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 95, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      renderGeoMap();
      const body = document.getElementById('tr-map-body').innerHTML;
      return { ready: _geoMapKitReady(), hasSvgPin: /<svg/.test(body), hasCanvas: /tr-map-canvas/.test(body) };
    });
    expect(out.ready).toBe(false);
    expect(out.hasSvgPin).toBe(true);
    expect(out.hasCanvas).toBe(false);
  });

  test('when MapKit IS ready the real map is built and annotated', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 96, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      jobs.push({ id: 97, client_name: 'J', start: today, lat: 37.70, lon: -97.35, geoAcc: 10 });
      const built = { annotations: [], shown: 0, colors: [] };
      window.mapkit = {
        FeatureVisibility: { Hidden: 'h', Adaptive: 'a' },
        Coordinate: function (la, lo) { this.latitude = la; this.longitude = lo; },
        Padding: function () {},
        MarkerAnnotation: function (c, o) { this.coordinate = c; this.color = o.color; this.title = o.title; },
        Map: function () {
          this.annotations = [];
          this.addAnnotations = (a) => { this.annotations = this.annotations.concat(a); built.annotations = this.annotations; built.colors = a.map(x => x.color); };
          this.removeAnnotations = () => { this.annotations = []; };
          this.showItems = (a) => { built.shown = a.length; };
          this.destroy = () => {};
        },
      };
      window._mapkitReady = true;
      try { _mapkitReady = true; } catch (e) {}
      renderGeoMap();
      const body = document.getElementById('tr-map-body').innerHTML;
      delete window.mapkit;
      try { _mapkitReady = false; } catch (e) {}
      tdMapDestroy(_geoMapSt);
      jobs.length = 0;
      return { hasCanvas: /tr-map-canvas/.test(body), n: built.annotations.length, shown: built.shown, colors: built.colors.sort() };
    });
    expect(out.hasCanvas).toBe(true);
    // Real Apple dropped pins, one per record, coloured by type.
    expect(out.n).toBe(2);
    expect(out.shown).toBe(2);
    expect(out.colors).toEqual(['#0E6B39', '#B45309']);
  });

  test('a MapKit constructor failure falls back instead of leaving a blank pane', async () => {
    const out = await page.evaluate(() => {
      const today = todayKey();
      expenses.push({ id: 98, date: today, vendor: 'A', amount: 5, lat: 37.68, lon: -97.33, geoAcc: 10 });
      window.mapkit = {
        FeatureVisibility: { Hidden: 'h', Adaptive: 'a' },
        Map: function () { throw new Error('token rejected'); },
      };
      try { _mapkitReady = true; } catch (e) {}
      let threw = false;
      try { renderGeoMap(); } catch (e) { threw = true; }
      const body = document.getElementById('tr-map-body').innerHTML;
      delete window.mapkit;
      try { _mapkitReady = false; } catch (e) {}
      return { threw, hasSvgPin: /<svg/.test(body) };
    });
    // An expired or origin-mismatched token must degrade, never blank the screen.
    expect(out.threw).toBe(false);
    expect(out.hasSvgPin).toBe(true);
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


  // ── The commute guard (this was documented but NOT implemented) ────────────

  test('an overnight dwell is never offered as a place', async () => {
    const out = await page.evaluate(() => {
      const c = { lat: 37.55, lon: -97.55 }, overnight = 9 * 60 * 60 * 1000;
      recordUnknownStop(c, overnight);
      recordUnknownStop(c, overnight);
      recordUnknownStop(c, overnight);
      return pendingPlaceSuggestions().length;
    });
    // Home. Accepting it would start logging non-deductible commute miles as
    // business trips, silently, on the contractor's behalf.
    expect(out).toBe(0);
  });

  test('the coordinate the day STARTED at is never offered as a place', async () => {
    const out = await page.evaluate(() => {
      const home = { lat: 37.56, lon: -97.56 };
      noteDayStart(home);
      const dwell = 6 * 60 * 1000; // a normal stop length, not overnight
      recordUnknownStop(home, dwell);
      recordUnknownStop(home, dwell);
      recordUnknownStop(home, dwell);
      const atHome = pendingPlaceSuggestions().length;
      // Somewhere else entirely, same dwell, still offered normally.
      const yard = { lat: 37.80, lon: -97.20 };
      recordUnknownStop(yard, dwell); recordUnknownStop(yard, dwell); recordUnknownStop(yard, dwell);
      const total = pendingPlaceSuggestions().length;
      try { localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      return { atHome, total };
    });
    expect(out.atHome).toBe(0);
    expect(out.total).toBe(1); // only the yard
  });

  test('noteDayStart anchors once per day and does not drift', async () => {
    const out = await page.evaluate(() => {
      try { localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      noteDayStart({ lat: 37.10, lon: -97.10 });
      noteDayStart({ lat: 37.90, lon: -97.90 }); // later ping must not overwrite
      const a = JSON.parse(localStorage.getItem('zp3_place_day_anchor') || 'null');
      try { localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      return a;
    });
    expect(out.lat).toBe(37.10);
    expect(out.day).toBeTruthy();
  });

  // ── Proposals are stamped (the map layer used to be permanently empty) ─────
  //
  // Was: _commitProposalSent called _stampGeo(bid) directly, live GPS at the
  // moment "Send" was tapped. A follow-up sent from the truck, the office, or
  // home that night put the pin there instead of at the job, which is the bug
  // the owner reported (2026-08-17): the Proposals layer showed where the
  // proposal was CREATED, not the client's address. Now: _stampBidAddrGeo
  // geocodes the client's address instead, same non-empty goal, right pin.

  test('_commitProposalSent geocodes the client address, not a live GPS fix', async () => {
    const out = await page.evaluate(() => {
      const src = String(_commitProposalSent);
      return {
        // The stamp must live in the same function that sets sentAt, or a
        // proposal sent from the driveway records no location and the map's
        // Proposals layer reads zero forever.
        stampsAddr: /_stampBidAddrGeo/.test(src),
        stampsLiveGeo: /(?<!_stampBidAddr)_stampGeo\(/.test(src),
        setsSentAt: /sentAt/.test(src),
        // Fire-and-forget, never awaited: a slow geocode must not delay a send.
        notAwaited: !/await\s+_stampBidAddrGeo/.test(src),
      };
    });
    expect(out.setsSentAt).toBe(true);
    expect(out.stampsAddr).toBe(true);
    expect(out.stampsLiveGeo).toBe(false);
    expect(out.notAwaited).toBe(true);
  });

  test('_stampBidAddrGeo resolves the client address onto bid.lat/lon', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      window._resolveCoords = async (addr) => (addr === '123 Main St' ? { lat: 41.0, lng: -96.0 } : null);
      clients.push({ id: 'geo-c1', name: 'Geo Client', addr: '123 Main St' });
      const bid = { id: 'geo-b1', client_id: 'geo-c1' };
      bids.push(bid);
      _stampBidAddrGeo(bid);
      await new Promise(r => setTimeout(r, 30));
      window._resolveCoords = realResolve;
      return { lat: bid.lat, lon: bid.lon };
    });
    expect(out.lat).toBe(41.0);
    expect(out.lon).toBe(-96.0);
  });

  test('_stampBidAddrGeo never overwrites a bid already geocoded', async () => {
    const out = await page.evaluate(async () => {
      const realResolve = window._resolveCoords;
      let called = false;
      window._resolveCoords = async () => { called = true; return { lat: 99, lng: 99 }; };
      const bid = { id: 'geo-b2', client_id: 'geo-c1', lat: 41.0, lon: -96.0 };
      _stampBidAddrGeo(bid);
      await new Promise(r => setTimeout(r, 30));
      window._resolveCoords = realResolve;
      return { lat: bid.lat, lon: bid.lon, called };
    });
    expect(out.called).toBe(false);
    expect(out.lat).toBe(41.0);
    expect(out.lon).toBe(-96.0);
  });

  test('_stampBidAddrGeo is a no-op with no resolvable address, never throws', async () => {
    const out = await page.evaluate(async () => {
      clients.push({ id: 'geo-c2', name: 'No Addr Client' });
      const bid = { id: 'geo-b3', client_id: 'geo-c2' };
      let threw = false;
      try { _stampBidAddrGeo(bid); } catch (e) { threw = true; }
      await new Promise(r => setTimeout(r, 30));
      return { threw, lat: bid.lat };
    });
    expect(out.threw).toBe(false);
    expect(out.lat).toBeUndefined();
  });

  // ── The Places screen ─────────────────────────────────────────────────────

  test('the shop is lifted out of the business address into td_places, once', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      S.officeLat = 37.705; S.officeLon = -97.352; S.bname = 'Sample Painting';
      renderPlaces();
      const after1 = places.length;
      renderPlaces();
      renderPlaces();
      const shop = places.find(p => p.kind === 'shop');
      return { after1, total: places.length, name: shop && shop.name, src: shop && shop.confirmedBy };
    });
    expect(out.after1).toBe(1);
    expect(out.total).toBe(1); // idempotent
    expect(out.name).toBe('Sample Painting shop');
    expect(out.src).toBe('business-address');
  });

  test('the places list renders each location with its provenance', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      savePlace({ name: 'Ferguson', kind: 'supply', lat: 1, lon: 2, confirmedBy: 'expense' });
      savePlace({ name: 'The Shop', kind: 'shop', lat: 3, lon: 4, confirmedBy: 'business-address' });
      renderPlaces();
      const html = document.getElementById('place-list').innerHTML;
      return {
        hasFerguson: /Ferguson/.test(html),
        fromReceipt: /From a receipt/.test(html),
        fromAddress: /From your business address/.test(html),
        // Shop sorts first so the anchor location is at the top.
        shopFirst: html.indexOf('The Shop') < html.indexOf('Ferguson'),
      };
    });
    expect(out.hasFerguson).toBe(true);
    expect(out.fromReceipt).toBe(true);
    expect(out.fromAddress).toBe(true);
    expect(out.shopFirst).toBe(true);
  });

  // Owner: "the trip types under Mileage in Books, job site, client consult,
  // those kinds of things need to carry over to places, so those tag in
  // reporting correctly." A place's kind now covers the SAME vocabulary the
  // mileage log reports by (MILE_PURPOSES), so a drive to/from a place saved
  // as a client-consult site or a payment-collection stop tags into that real
  // bucket instead of collapsing into "Other" the way anything but the shop,
  // a supply house, or the home office used to.
  // Owner 2026-08-06, after seeing the first (wider) version of this picker:
  // a Place carries no client_id, so anything inherently tied to ONE specific
  // customer, a job site, a client consult, a payment pickup, can never
  // actually link back to who it's for, and job sites already fence
  // automatically off the real jobs array besides. Scoped down to the fixed
  // points that belong to no client at all. The wider vocabulary (Job site,
  // Client Consult, Payment Collection, Estimate included) stays available
  // on a MANUALLY logged trip, MILE_PURPOSES itself is untouched, only the
  // automatic PLACE side was narrowed.
  test('the Type picker offers only the client-independent kinds, not the full mileage-purpose list', async () => {
    const out = await page.evaluate(() => {
      document.getElementById('place-modal')?.remove();
      openPlaceModal(null, 1, 2);
      const opts = [...document.querySelectorAll('#place-kind option')].map(o => o.value);
      document.getElementById('place-modal')?.remove();
      return { opts, kinds: Object.keys(PLACE_KINDS) };
    });
    expect(out.opts.sort()).toEqual(['business_meeting', 'home_office', 'other', 'shop', 'supply'].sort());
    // Every PLACE_KINDS entry renders as an actual <option>, the picker is not
    // hand-maintained separately from the source of truth it reads from.
    expect(out.opts.sort()).toEqual(out.kinds.sort());
    ['job_site', 'client_consult', 'payment_collection', 'estimate'].forEach(k =>
      expect(out.opts, `"${k}" is client-specific, it belongs to a scheduled job/estimate, not a Place`).not.toContain(k));
  });

  // Owner-reported: the home-office tax disclaimer showed under every Type,
  // not just Home office, so a Shop or Supply house got a CPA warning about
  // a decision that has nothing to do with it.
  test('the home-office disclaimer shows only when Home office is the selected Type', async () => {
    const out = await page.evaluate(() => {
      document.getElementById('place-modal')?.remove();
      openPlaceModal(null, 1, 2);               // defaults to Type=supply
      const hiddenBySupplyDefault = document.getElementById('place-ho-note').style.display === 'none';
      // Real select-and-fire, not a direct function call: the onchange
      // wiring itself is what's under test.
      const sel = document.getElementById('place-kind');
      sel.value = 'home_office';
      sel.dispatchEvent(new Event('change'));
      const shownForHomeOffice = document.getElementById('place-ho-note').style.display === 'block';
      sel.value = 'business_meeting';
      sel.dispatchEvent(new Event('change'));
      const hiddenAgainAfterSwitch = document.getElementById('place-ho-note').style.display === 'none';
      document.getElementById('place-modal')?.remove();
      return { hiddenBySupplyDefault, shownForHomeOffice, hiddenAgainAfterSwitch };
    });
    expect(out.hiddenBySupplyDefault, 'not shown for the default Type').toBe(true);
    expect(out.shownForHomeOffice, 'shows once Home office is picked').toBe(true);
    expect(out.hiddenAgainAfterSwitch, 'hides again switching away from Home office').toBe(true);
  });

  test('editing an existing home-office place opens with the disclaimer already visible', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      const pl = savePlace({ name: 'My Office', kind: 'home_office', lat: 5, lon: 6, confirmedBy: 'manual' });
      document.getElementById('place-modal')?.remove();
      openPlaceModal(pl.id);
      const shown = document.getElementById('place-ho-note').style.display === 'block';
      document.getElementById('place-modal')?.remove();
      return { shown };
    });
    expect(out.shown, 'no onchange has fired yet, the note has to reflect the SAVED kind on open').toBe(true);
  });

  test('every remaining place kind tags its automatic trips into the matching mileage-report purpose', async () => {
    const out = await page.evaluate(() => {
      const cases = [
        { kind: 'business_meeting', want: 'Business meeting' },
        { kind: 'supply', want: 'Supply run' },
        { kind: 'home_office', want: 'Home Office' },
        { kind: 'shop', want: 'Shop' },
      ];
      return cases.map(c => ({ kind: c.kind, want: c.want, got: _autoTripPurpose({ kind: c.kind }) }));
    });
    out.forEach(r => expect(r.got, `place kind "${r.kind}"`).toBe(r.want));
  });

  test('a removed place kind (e.g. a stale saved record) falls back to "Other", never throws', async () => {
    // Belt-and-suspenders for the trim: a place saved under an OLD session's
    // wider vocabulary before this scope-down (or any future removal) must
    // degrade gracefully, not crash the automatic drive log.
    const out = await page.evaluate(() => _autoTripPurpose({ kind: 'client_consult' }));
    expect(out).toBe('Other');
  });

  // Owner 2026-08-06: driving to an advisor's place to talk strategy or work on
  // the brand is a real deductible trip with NO customer attached. It had
  // nowhere to go but 'Other', and 'Client Consult' cannot absorb it without
  // overstating what customer work costs to win. These two must stay separable
  // all the way through to the report, which means distinct labels AND
  // distinct colors, since the breakdown is read by color at a glance.
  test('Business meeting is its own reportable bucket, never folded into Client Consult', async () => {
    const out = await page.evaluate(() => ({
      inPurposes: MILE_PURPOSES.includes('Business meeting'),
      // 'Other' is the catch-all and has to stay last in the picker.
      otherIsLast: MILE_PURPOSES[MILE_PURPOSES.length - 1] === 'Other',
      colored: !!MILE_PURPOSE_COLORS['Business meeting'],
      // The pair most easily confused on the report: same shape of trip, very
      // different money. If these ever collide the split stops being readable.
      distinctFromConsult:
        MILE_PURPOSE_COLORS['Business meeting'].dot !== MILE_PURPOSE_COLORS['Client Consult'].dot,
      fromPlace: _autoTripPurpose({ kind: 'business_meeting' }),
      // Client Consult is scoped out of PLACE_KINDS (client-specific, no
      // client_id on a Place to attach it to), but the PURPOSE itself is
      // untouched, still real, still colored, still pickable by hand.
      consultStillAPurpose: MILE_PURPOSES.includes('Client Consult') && !!MILE_PURPOSE_COLORS['Client Consult'],
      // Every existing purpose survives: renaming or dropping one orphans every
      // mileage row already saved against that exact string.
      legacyIntact: ['Estimate', 'Job site', 'Client Consult', 'Supply run', 'Home Office',
                     'Payment Collection', 'Shop', 'Other'].every(p => MILE_PURPOSES.includes(p)),
    }));
    expect(out.inPurposes, 'Business meeting must be a real mileage purpose').toBe(true);
    expect(out.otherIsLast, '"Other" must remain the last option in the picker').toBe(true);
    expect(out.colored, 'it needs a color or it renders blank on the breakdown').toBe(true);
    expect(out.distinctFromConsult, 'Business meeting and Client Consult must not share a color').toBe(true);
    expect(out.fromPlace).toBe('Business meeting');
    expect(out.consultStillAPurpose, 'Client Consult stays real for manual trip entry').toBe(true);
    expect(out.legacyIntact, 'no existing purpose string may be renamed or removed').toBe(true);
  });

  test('every remaining place-kind purpose is a real bucket the mileage report already colors and groups by', async () => {
    // A purpose _autoTripPurpose can now produce that MILE_PURPOSE_COLORS does
    // not recognize would render on the mileage breakdown with no color and no
    // group, exactly the "does not tag in reporting" failure this was built to
    // fix. Every place kind's purpose has to round-trip through the real table.
    const out = await page.evaluate(() => {
      const kinds = Object.keys(PLACE_KINDS).filter(k => k !== 'other');
      return kinds.map(k => {
        const purpose = _autoTripPurpose({ kind: k });
        return { kind: k, purpose, known: MILE_PURPOSES.includes(purpose), colored: !!MILE_PURPOSE_COLORS[purpose] };
      });
    });
    out.forEach(r => {
      expect(r.known, `"${r.purpose}" (from place kind "${r.kind}") is not in MILE_PURPOSES`).toBe(true);
      expect(r.colored, `"${r.purpose}" has no entry in MILE_PURPOSE_COLORS`).toBe(true);
    });
  });

  test('a saved business-meeting place fences an automatic drive as "Business meeting", not "Other"', async () => {
    const out = await page.evaluate(async () => {
      const realUser = _supaUser, realRoute = _routeDistance;
      _supaUser = { id: 'u-consult' };
      window._routeDistance = _routeDistance = async () => ({ miles: 3, mins: 9 });
      try {
        places.length = 0;
        savePlace({ name: "Advisor's Office", kind: 'business_meeting', lat: 39.10, lon: -95.10, confirmedBy: 'manual' });
        S.officeLat = 39.00; S.officeLon = -95.00; S.teamTracking = true;
        _geoJobCoords = {};
        _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
        _geoShopArrivedAt = null; _geoDriveStartedAt = null;
        _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
        _geoLastFenceAt = null; _geoLegAtShop = false;
        _geoHomeDwell = null; _geoWasAtHome = false;
        _geoLastFenceLoc = null; _geoLegOrigin = null;
        _geoPingBusy = false;
        const before = mileage.length;
        const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lon, accuracy: 8 } });
        await ping({ lat: 39.00, lon: -95.00 });     // at the shop
        // Rewind ONLY _geoLastFenceAt, never _geoDriveStartedAt (arriving at the
        // shop already cleared it back to null): a single ping spanning the whole
        // trip is what the app actually sees on a backgrounded phone, and it is
        // the overnight-style inference branch in _geoOnPing that supplies the
        // leg's origin (_geoLegOrigin) FROM this timestamp. Pre-setting
        // _geoDriveStartedAt here would skip that branch and leave the origin
        // null, which is exactly the mistake that made this test fail the first
        // time (mileageAdded came back empty: _geoAutoMileage refuses a null
        // "from"). Same pattern e2e-geo-auto-mileage.spec.js's drive() helper uses.
        if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - 20 * 60000).toISOString();
        await ping({ lat: 39.10, lon: -95.10 });     // arrive at the advisor's office
        await new Promise(r => setTimeout(r, 30));
        const row = mileage.slice(0, Math.max(0, mileage.length - before))[0];
        return { purpose: row && row.purpose, toName: row && row.to_name };
      } finally {
        _supaUser = realUser;
        window._routeDistance = _routeDistance = realRoute;
      }
    });
    expect(out.toName).toBe("Advisor's Office");
    expect(out.purpose).toBe('Business meeting');
  });

  test('a repeat stop surfaces a suggestion card that can be accepted', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      const c = { lat: 37.81, lon: -97.21 }, dwell = 6 * 60 * 1000;
      recordUnknownStop(c, dwell); recordUnknownStop(c, dwell); recordUnknownStop(c, dwell);
      renderPlaces();
      const shown = /You keep stopping here/.test(document.getElementById('place-suggestions').innerHTML);
      // Accept it through the real modal path.
      openPlaceModal(null, 37.81, -97.21);
      document.getElementById('place-name').value = 'Ferguson';
      _savePlaceFromModal(null);
      const gone = document.getElementById('place-suggestions').innerHTML === '';
      return { shown, gone, saved: places.length, kind: places[0] && places[0].kind };
    });
    expect(out.shown).toBe(true);
    expect(out.saved).toBe(1);
    expect(out.kind).toBe('supply');
    // Accepting clears the suggestion rather than leaving it to nag.
    expect(out.gone).toBe(true);
  });

  test('a suggestion can be rejected as not-work and stays rejected', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      try { localStorage.removeItem('zp3_place_stops'); localStorage.removeItem('zp3_place_day_anchor'); } catch (e) {}
      const c = { lat: 37.82, lon: -97.22 }, dwell = 6 * 60 * 1000;
      recordUnknownStop(c, dwell); recordUnknownStop(c, dwell); recordUnknownStop(c, dwell);
      dismissPlaceSuggestion(37.82, -97.22);
      renderPlaces();
      return { html: document.getElementById('place-suggestions').innerHTML, n: pendingPlaceSuggestions().length };
    });
    expect(out.html).toBe('');
    expect(out.n).toBe(0);
  });

  test('the place modal refuses to save without a name or coordinates', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      openPlaceModal(null, 37.9, -97.9);
      document.getElementById('place-name').value = '';
      _savePlaceFromModal(null);
      const afterNoName = places.length;
      document.getElementById('place-name').value = 'Real Place';
      _savePlaceFromModal(null);
      return { afterNoName, afterName: places.length };
    });
    expect(out.afterNoName).toBe(0);
    expect(out.afterName).toBe(1);
  });

  test('Add-a-location with no pin leads with search, no upfront Name field, not a dead end', async () => {
    const out = await page.evaluate(() => {
      document.getElementById('place-modal')?.remove();
      openPlaceModal();   // the real "+ Add" button path: no coordinates at all
      const modal = document.getElementById('place-modal');
      const inputs = [...modal.querySelectorAll('input:not([type=hidden]), select')].map(el => el.id);
      return {
        hasAddrField: !!document.getElementById('place-addr'),
        hasSuggBox: !!document.getElementById('place-addr-sugg'),
        hasHiddenLat: !!document.getElementById('place-lat'),
        searchPlaceholder: document.getElementById('place-addr')?.placeholder,
        // The search box is the FIRST real field, before Name and before Type,
        // there is nothing to type a name into until something's been searched.
        searchIsFirst: inputs[0] === 'place-addr',
        noteAsksToSearch: /Search a name or address/.test(document.getElementById('place-pin-note')?.innerHTML || ''),
        deadEndGone: !/No coordinates\. Add this from a repeat stop/.test(modal.innerHTML),
      };
    });
    expect(out.hasAddrField).toBe(true);
    expect(out.hasSuggBox).toBe(true);
    expect(out.hasHiddenLat).toBe(true);
    expect(out.searchPlaceholder, 'search leads with business name, address is the fallback').toBe('Business name or address');
    expect(out.searchIsFirst, 'search is the first field, ahead of Name and Type').toBe(true);
    expect(out.noteAsksToSearch).toBe(true);
    expect(out.deadEndGone).toBe(true);
    // Focus lands on the search box, not a Name field the contractor has no
    // reason to type into before they've searched anything. The app focuses on
    // an 80ms setTimeout (places.js openPlaceModal), so a single fixed-delay
    // read races that timer under CI load (WebKit flaked exactly this way);
    // poll for the same outcome instead of betting on scheduler timing.
    await expect.poll(
      () => page.evaluate(() => document.activeElement?.id || ''),
      { timeout: 3000, message: 'focus lands on the address search box' }
    ).toBe('place-addr');
  });

  test('searching an address stamps the pin, autofills the name, and the place saves', async () => {
    const out = await page.evaluate(async () => {
      places.length = 0;
      document.getElementById('place-modal')?.remove();
      openPlaceModal();
      // Stub the geocoder: this spec is offline and the search pipeline
      // (debounce → results → pick → hidden inputs) is what is under test,
      // not Apple's database.
      const orig = window._geocodeAddress;
      window._geocodeAddress = async () => [
        { name: "Ferguson Plumbing", line1: '2121 E Douglas Ave', line2: 'Wichita, KS, 67214', lat: 37.6851, lon: -97.3092 },
        { name: '', line1: '500 S Broadway St', line2: 'Wichita, KS, 67202', lat: 37.68, lon: -97.336 },
      ];
      const addrEl = document.getElementById('place-addr');
      addrEl.value = 'ferguson';
      _placeAddrSearch(addrEl.value);
      await new Promise(r => setTimeout(r, 400));   // past the 280ms debounce
      const box = document.getElementById('place-addr-sugg');
      const shown = box.style.display === 'block';
      const nBtns = box.querySelectorAll('button').length;
      // Pick the first suggestion through the REAL rendered button.
      box.querySelector('button').click();
      const lat = document.getElementById('place-lat').value;
      const lon = document.getElementById('place-lon').value;
      const name = document.getElementById('place-name').value;
      // The pin note shows the picked ADDRESS, never raw coordinates, a
      // contractor recognises "2121 E Douglas Ave", not a lat/lon pair.
      const pinNote = document.getElementById('place-pin-note').innerHTML;
      const pinned = pinNote.includes('2121 E Douglas Ave');
      const noRawCoords = !/\d{2}\.\d{4,}/.test(pinNote);
      const boxHidden = box.style.display === 'none';
      _savePlaceFromModal(null);
      window._geocodeAddress = orig;
      return { shown, nBtns, lat, lon, name, pinned, noRawCoords, boxHidden,
               saved: places.length, savedAddr: places[0] && places[0].addr, savedLat: places[0] && places[0].lat };
    });
    expect(out.shown).toBe(true);
    expect(out.nBtns).toBe(2);
    expect(out.lat).toBe('37.6851');
    expect(out.lon).toBe('-97.3092');
    // The picked business name fills the empty Name field.
    expect(out.name).toBe("Ferguson Plumbing");
    expect(out.pinned).toBe(true);
    expect(out.noRawCoords, 'no raw lat/lon shown to the contractor').toBe(true);
    expect(out.boxHidden).toBe(true);
    expect(out.saved).toBe(1);
    expect(out.savedAddr).toBe('2121 E Douglas Ave, Wichita, KS, 67214');
    expect(out.savedLat).toBe(37.6851);
  });

  test('saving without picking an address refuses, then succeeds once picked', async () => {
    const out = await page.evaluate(async () => {
      places.length = 0;
      document.getElementById('place-modal')?.remove();
      openPlaceModal();
      document.getElementById('place-name').value = 'No Pin Yet';
      _savePlaceFromModal(null);                      // no coordinates picked
      const refusedCount = places.length;
      const orig = window._geocodeAddress;
      window._geocodeAddress = async () => [{ name: 'Ace', line1: '1 Main St', line2: 'Wichita, KS', lat: 37.7, lon: -97.3 }];
      _placeAddrSearch('1 main');
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('place-addr-sugg').querySelector('button').click();
      _savePlaceFromModal(null);
      window._geocodeAddress = orig;
      return { refusedCount, savedCount: places.length };
    });
    expect(out.refusedCount).toBe(0);
    expect(out.savedCount).toBe(1);
  });

  test('a typed name is never overwritten by the picked suggestion', async () => {
    const out = await page.evaluate(async () => {
      places.length = 0;
      document.getElementById('place-modal')?.remove();
      openPlaceModal();
      document.getElementById('place-name').value = 'My Supplier';
      const orig = window._geocodeAddress;
      window._geocodeAddress = async () => [{ name: 'Ferguson Plumbing', line1: '2121 E Douglas', line2: 'Wichita, KS', lat: 37.6, lon: -97.3 }];
      _placeAddrSearch('ferguson');
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('place-addr-sugg').querySelector('button').click();
      const name = document.getElementById('place-name').value;
      document.getElementById('place-modal')?.remove();
      window._geocodeAddress = orig;
      return { name };
    });
    expect(out.name).toBe('My Supplier');
  });

  test('editing a place does not erase its provenance (undefined never overwrites)', async () => {
    const out = await page.evaluate(() => {
      places.length = 0;
      const pl = savePlace({ name: 'Ferguson', kind: 'supply', lat: 1, lon: 2, confirmedBy: 'expense' });
      // The edit modal's save path passes confirmedBy:undefined for existing rows.
      savePlace({ id: pl.id, name: 'Ferguson Plumbing', kind: 'supply', lat: 1, lon: 2, confirmedBy: undefined });
      return { name: places[0].name, src: places[0].confirmedBy };
    });
    expect(out.name).toBe('Ferguson Plumbing');
    expect(out.src).toBe('expense');   // was silently wiped to undefined before the fix
  });

  test('opening a pinned place (edit, or a promoted stop) never shows raw coordinates', async () => {
    const out = await page.evaluate(() => {
      document.getElementById('place-modal')?.remove();
      // A promoted repeat-stop: has a pin, has never had an address searched.
      openPlaceModal(null, 37.81, -97.21);
      // textContent, never innerHTML: the pin note's leading pin SVG has its own
      // decimal path-data numbers (e.g. "4.993", "10.193") that satisfy a loose
      // coordinate pattern just as well as a real lat/lon would, a false
      // positive that has nothing to do with what the note actually SHOWS.
      const promotedNote = document.getElementById('place-pin-note').textContent;
      document.getElementById('place-modal')?.remove();
      // An existing place saved WITH an address (through the search flow).
      places.length = 0;
      const withAddr = savePlace({ name: 'Ferguson', kind: 'supply', lat: 1, lon: 2, addr: '2121 E Douglas Ave, Wichita, KS', confirmedBy: 'manual' });
      openPlaceModal(withAddr.id);
      const editNoteWithAddr = document.getElementById('place-pin-note').textContent;
      document.getElementById('place-modal')?.remove();
      // An older place saved with no address on record at all (pre-dates the
      // search flow, e.g. lifted from an expense receipt's GPS stamp).
      places.length = 0;
      const noAddr = savePlace({ name: 'Old Supply Stop', kind: 'supply', lat: 3, lon: 4, confirmedBy: 'expense' });
      openPlaceModal(noAddr.id);
      const editNoteNoAddr = document.getElementById('place-pin-note').textContent;
      document.getElementById('place-modal')?.remove();
      const coordPattern = /\d{1,3}\.\d{3,}/;
      return {
        promotedHasCoords: coordPattern.test(promotedNote),
        editWithAddrShowsAddr: editNoteWithAddr.includes('2121 E Douglas Ave'),
        editWithAddrHasCoords: coordPattern.test(editNoteWithAddr),
        editNoAddrHasCoords: coordPattern.test(editNoteNoAddr),
        editNoAddrFallback: editNoteNoAddr.includes('Location pinned'),
      };
    });
    expect(out.promotedHasCoords, 'a promoted stop with no address shows no raw lat/lon').toBe(false);
    expect(out.editWithAddrShowsAddr, 'editing a place WITH a saved address shows that address').toBe(true);
    expect(out.editWithAddrHasCoords).toBe(false);
    expect(out.editNoAddrHasCoords, 'a place with no address on record still shows no raw lat/lon').toBe(false);
    expect(out.editNoAddrFallback, 'falls back to a plain "Location pinned" confirmation').toBe(true);
  });

  test('the Places tab is wired into setTrTab on Books', async () => {
    const out = await page.evaluate(() => {
      setTrTab('places');
      return {
        paneShown: document.getElementById('tr-places').style.display !== 'none',
        tabActive: document.getElementById('tr-t-places').classList.contains('active'),
        mileageHidden: document.getElementById('tr-mileage').style.display === 'none',
      };
    });
    expect(out.paneShown).toBe(true);
    expect(out.tabActive).toBe(true);
    expect(out.mileageHidden).toBe(true);
  });

  // ── Time at places: yearly verified hours per place, per person ────────────
  // Reads job_time_entries (source 'place', named by dest_place) and
  // shop_time_entries, grouped per place with an expandable per-person split.
  test.describe('Time at places report', () => {
    // Thenable query stub for both tables, recording the filter args so the
    // year-window test can assert the exact date bounds sent to the backend.
    const installPtrStub = (placeRows, shopRows) => page.evaluate(({ placeRows, shopRows }) => {
      window.__ptrCalls = [];
      window.__origSupaPtr = window.__origSupaPtr || window._supa;
      window.__origSupaEnabled = window.__origSupaEnabled || window.supaEnabled;
      window.__origSupaUserPtr = window.__origSupaUserPtr || window._supaUser;
      window.supaEnabled = () => true;
      window._supaUser = { id: 'ptr-owner' };
      const mk = (tbl) => {
        const q = { _eq: {}, _gte: null, _lt: null };
        q.select = () => q;
        // .is added 2026-08-26: the time-table reads carry
        // .is('deleted_at',null) now, and a builder that only knows the filters
        // it was written against turns a new one into "is is not a function",
        // which surfaces as a missing place name three layers away.
        q.is = () => q;
        q.eq = (c, v) => { q._eq[c] = v; return q; };
        q.gte = (c, v) => { q._gte = v; return q; };
        q.lt = (c, v) => { q._lt = v; return q; };
        q.then = (resolve) => {
          window.__ptrCalls.push({ tbl, eq: q._eq, gte: q._gte, lt: q._lt });
          resolve({ data: tbl === 'job_time_entries' ? placeRows : shopRows, error: null });
        };
        return q;
      };
      window._supa = { ...window.__origSupaPtr, from: (tbl) => (tbl === 'job_time_entries' || tbl === 'shop_time_entries') ? mk(tbl) : window.__origSupaPtr.from(tbl) };
      _ptrCache = {}; _ptrOpen = {}; _ptrYear = null; _ptrBusy = false;
    }, { placeRows, shopRows });
    const restorePtr = () => page.evaluate(() => {
      if (window.__origSupaPtr) window._supa = window.__origSupaPtr;
      if (window.__origSupaEnabled) window.supaEnabled = window.__origSupaEnabled;
      window._supaUser = window.__origSupaUserPtr || null;
      _ptrCache = {}; _ptrOpen = {}; _ptrYear = null;
    });

    test('groups by place with a Shop bucket, formats hours, and counts people', async () => {
      await installPtrStub(
        [
          { employee_user_id: 'emp-1', dest_place: 'Ferguson Supply', minutes: 60, arrived_at: '2026-03-02T14:00:00Z' },
          { employee_user_id: 'ptr-owner', dest_place: 'Ferguson Supply', minutes: 30, arrived_at: '2026-04-08T09:00:00Z' },
          { employee_user_id: 'ptr-owner', dest_place: 'Home Office', minutes: 120, arrived_at: '2026-05-01T08:00:00Z' },
        ],
        [
          { employee_user_id: 'ptr-owner', minutes: 45, arrived_at: '2026-02-11T07:00:00Z' },
          { employee_user_id: 'emp-1', minutes: 15, arrived_at: '2026-02-12T07:00:00Z' },
        ]
      );
      const r = await page.evaluate(async () => {
        const origEmp = S.employees, origOwner = S.ownerName;
        S.employees = [{ employee_user_id: 'emp-1', name: 'Mike Torres' }];
        S.ownerName = 'Pat Owner';
        try {
          renderPlaceTimeReport();
          await new Promise(res => setTimeout(res, 60));
          const html = document.getElementById('place-time-report').innerHTML;
          // Buckets sort by minutes desc: Home Office 120, Ferguson 90, Shop 60.
          _ptrToggle(1); // expand Ferguson
          await new Promise(res => setTimeout(res, 60));
          const expanded = document.getElementById('place-time-report').innerHTML;
          return { html, expanded };
        } finally { S.employees = origEmp; S.ownerName = origOwner; }
      });
      expect(r.html).toContain('Time at places');
      expect(r.html).toContain('Ferguson Supply');
      expect(r.html).toContain('Home Office');
      expect(r.html).toContain('Shop');                 // shop_time_entries bucket
      expect(r.html).toContain('1h 30m');               // Ferguson 60+30
      expect(r.html).toContain('2h');                   // Home Office
      expect(r.html).toContain('4h 30m');               // total 270 mins
      expect(r.html).toContain('People tracked');       // two distinct uids
      expect(r.html).not.toContain('Mike Torres');      // collapsed by default
      expect(r.expanded).toContain('Mike Torres');      // per-person split on expand
      expect(r.expanded).toContain('Pat Owner');
      // The drawer uses THE shared accordion reveal (td-acc-body/td-acc-inner,
      // index.html), the same one Notes/Timeline/Lifecycle use, never a
      // hand-rolled per-accordion animation (CLAUDE.md §7.3, owner call).
      expect(r.expanded).toContain('td-acc-body');
      expect(r.expanded).toContain('td-acc-inner');
      expect(r.html).not.toContain('td-acc-body');      // no empty shell when collapsed
      // Ferguson has a March visit and an April visit: the month breakdown
      // must read oldest to newest (owner call, 2026-08-07), March first.
      expect(r.expanded).toContain('March 2026');
      expect(r.expanded).toContain('April 2026');
      expect(r.expanded.indexOf('March 2026')).toBeLessThan(r.expanded.indexOf('April 2026'));
      await restorePtr();
    });

    test('the per-place drawer breaks down by month and day, oldest to newest, with each visit\'s person and time', async () => {
      await installPtrStub(
        [
          // Same place (Ace Supply), same month (June), two different days,
          // to prove DAY ordering is also oldest-to-newest, not just months.
          { employee_user_id: 'ptr-owner', dest_place: 'Ace Supply', minutes: 25, arrived_at: '2026-06-20T14:00:00Z', departed_at: '2026-06-20T14:25:00Z' },
          { employee_user_id: 'emp-1', dest_place: 'Ace Supply', minutes: 40, arrived_at: '2026-06-05T09:00:00Z', departed_at: '2026-06-05T09:40:00Z' },
          { employee_user_id: 'ptr-owner', dest_place: 'Ace Supply', minutes: 10, arrived_at: '2026-01-03T08:00:00Z', departed_at: '2026-01-03T08:10:00Z' },
        ],
        []
      );
      const r = await page.evaluate(async () => {
        const origEmp = S.employees, origOwner = S.ownerName;
        S.employees = [{ employee_user_id: 'emp-1', name: 'Mike Torres' }];
        S.ownerName = 'Pat Owner';
        try {
          renderPlaceTimeReport();
          await new Promise(res => setTimeout(res, 60));
          _ptrToggle(0); // only one bucket: Ace Supply
          await new Promise(res => setTimeout(res, 60));
          return document.getElementById('place-time-report').innerHTML;
        } finally { S.employees = origEmp; S.ownerName = origOwner; }
      });
      // Months: January before June.
      expect(r).toContain('January 2026');
      expect(r).toContain('June 2026');
      expect(r.indexOf('January 2026')).toBeLessThan(r.indexOf('June 2026'));
      // Days within June: the 5th before the 20th.
      const juneIdx = r.indexOf('June 2026');
      const iFifth = r.indexOf('06/05/2026', juneIdx);
      const iTwentieth = r.indexOf('06/20/2026', juneIdx);
      expect(iFifth).toBeGreaterThan(-1);
      expect(iTwentieth).toBeGreaterThan(-1);
      expect(iFifth).toBeLessThan(iTwentieth);
      // Each visit names who and when.
      expect(r).toContain('Mike Torres');
      expect(r).toContain('Pat Owner');
      expect(r).toContain('9:00a–9:40a');
      expect(r).toContain('2:00p–2:25p');
      await restorePtr();
    });

    test('queries exactly the selected year, and the year picker refetches', async () => {
      await installPtrStub([], []);
      const r = await page.evaluate(async () => {
        const yr = new Date().getFullYear();
        renderPlaceTimeReport();
        await new Promise(res => setTimeout(res, 60));
        const first = window.__ptrCalls.slice();
        _ptrSetYear(yr - 1);
        await new Promise(res => setTimeout(res, 60));
        return { yr, first, all: window.__ptrCalls };
      });
      const jte = r.first.find(c => c.tbl === 'job_time_entries');
      expect(jte.eq.source, 'only place-dwell rows, never job visits').toBe('place');
      expect(jte.eq.contractor_user_id).toBe('ptr-owner');
      expect(jte.gte).toBe(r.yr + '-01-01T00:00:00Z');
      expect(jte.lt).toBe((r.yr + 1) + '-01-01T00:00:00Z');
      const prev = r.all.find(c => c.tbl === 'job_time_entries' && c.gte === (r.yr - 1) + '-01-01T00:00:00Z');
      expect(prev, 'picking last year queries last year\'s window').toBeTruthy();
      expect(prev.lt).toBe(r.yr + '-01-01T00:00:00Z');
      await restorePtr();
    });

    test('no tracked rows renders the empty state, not a broken card', async () => {
      await installPtrStub([], []);
      const r = await page.evaluate(async () => {
        renderPlaceTimeReport();
        await new Promise(res => setTimeout(res, 60));
        return document.getElementById('place-time-report').innerHTML;
      });
      expect(r).toContain('No tracked time for');
      await restorePtr();
    });

    test('field crew without the team permission see no report at all (manager-gated, §9.5)', async () => {
      await installPtrStub(
        [{ employee_user_id: 'emp-1', dest_place: 'Ferguson Supply', minutes: 60, arrived_at: '2026-03-02T14:00:00Z' }], []
      );
      const r = await page.evaluate(async () => {
        const orig = { emp: window._isEmployee, rec: window._employeeRecord };
        try {
          window._isEmployee = true; window._employeeRecord = { permissions: {} };
          renderPlaceTimeReport();
          await new Promise(res => setTimeout(res, 60));
          const gated = document.getElementById('place-time-report').innerHTML;
          window._employeeRecord = { permissions: { team: true } };
          _ptrCache = {};
          renderPlaceTimeReport();
          await new Promise(res => setTimeout(res, 60));
          const managed = document.getElementById('place-time-report').innerHTML;
          return { gated, managed };
        } finally { window._isEmployee = orig.emp; window._employeeRecord = orig.rec; }
      });
      expect(r.gated).toBe('');
      expect(r.managed).toContain('Time at places');
      await restorePtr();
    });

    test('renderPlaces drives the report, the mount lives inside the Books Places pane', async () => {
      await installPtrStub([], []);
      const r = await page.evaluate(async () => {
        renderPlaces();
        await new Promise(res => setTimeout(res, 60));
        const el = document.getElementById('place-time-report');
        return { inPane: !!el && !!el.closest('#tr-places'), rendered: (el?.innerHTML || '').includes('Time at places') };
      });
      expect(r.inPane).toBe(true);
      expect(r.rendered).toBe(true);
      await restorePtr();
    });
  });

  test('zero console errors across the places suite', async () => {
    assertNoErrors(page, 'places, drive attribution and map');
  });
});
