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
      _geoMapDestroy();
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

  test('_commitProposalSent stamps the bid, so the Proposals layer is not always empty', async () => {
    const out = await page.evaluate(() => {
      const src = String(_commitProposalSent);
      return {
        // The stamp must live in the same function that sets sentAt, or a
        // proposal sent from the driveway records no location and the map's
        // Proposals layer reads zero forever.
        stampsGeo: /_stampGeo/.test(src),
        setsSentAt: /sentAt/.test(src),
        // Fire-and-forget, never awaited: a slow GPS lock must not delay a send.
        notAwaited: !/await\s+_stampGeo/.test(src),
      };
    });
    expect(out.setsSentAt).toBe(true);
    expect(out.stampsGeo).toBe(true);
    expect(out.notAwaited).toBe(true);
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

  test('Add-a-location with no pin offers an address search, not a dead end', async () => {
    const out = await page.evaluate(() => {
      document.getElementById('place-modal')?.remove();
      openPlaceModal();   // the real "+ Add" button path: no coordinates at all
      return {
        hasAddrField: !!document.getElementById('place-addr'),
        hasSuggBox: !!document.getElementById('place-addr-sugg'),
        hasHiddenLat: !!document.getElementById('place-lat'),
        noteAsksForAddress: /Search a name or address/.test(document.getElementById('place-pin-note')?.innerHTML || ''),
        labelLeadsWithName: /Business name or address/.test(document.getElementById('place-modal').innerHTML),
        deadEndGone: !/No coordinates\. Add this from a repeat stop/.test(document.getElementById('place-modal').innerHTML),
      };
    });
    expect(out.hasAddrField).toBe(true);
    expect(out.hasSuggBox).toBe(true);
    expect(out.hasHiddenLat).toBe(true);
    expect(out.noteAsksForAddress).toBe(true);
    expect(out.labelLeadsWithName, 'the field leads with business name, address is the fallback').toBe(true);
    expect(out.deadEndGone).toBe(true);
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
      const pinned = /Pinned at 37\.68510/.test(document.getElementById('place-pin-note').innerHTML);
      const boxHidden = box.style.display === 'none';
      _savePlaceFromModal(null);
      window._geocodeAddress = orig;
      return { shown, nBtns, lat, lon, name, pinned, boxHidden,
               saved: places.length, savedAddr: places[0] && places[0].addr, savedLat: places[0] && places[0].lat };
    });
    expect(out.shown).toBe(true);
    expect(out.nBtns).toBe(2);
    expect(out.lat).toBe('37.6851');
    expect(out.lon).toBe('-97.3092');
    // The picked business name fills the empty Name field.
    expect(out.name).toBe("Ferguson Plumbing");
    expect(out.pinned).toBe(true);
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

  test('the Places tab is wired into setFleetTab', async () => {
    const out = await page.evaluate(() => {
      setFleetTab('places');
      return {
        paneShown: document.getElementById('ft-places').style.display !== 'none',
        tabActive: document.getElementById('ft-t-places').classList.contains('active'),
        fleetHidden: document.getElementById('ft-fleet').style.display === 'none',
      };
    });
    expect(out.paneShown).toBe(true);
    expect(out.tabActive).toBe(true);
    expect(out.fleetHidden).toBe(true);
  });

  test('zero console errors across the places suite', async () => {
    assertNoErrors(page, 'places, drive attribution and map');
  });
});
