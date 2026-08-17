// @ts-check
// ── Where a record was created: _stampGeo ────────────────────────────────────
//
// Owner direction: stamp coordinates on everything logged, so the app can later
// show a map of where estimates, expenses and jobs actually happened, detect
// supply houses from repeated stops, and attribute drive legs place-to-place.
//
// The expense is the first and strongest anchor, because the receipt supplies
// the business purpose the IRS wants (Pub 463: date, mileage, destination,
// business purpose) without anyone typing it.
//
// Two design rules are load-bearing and are what this suite actually defends:
//
//   1. IT NEVER BLOCKS OR BREAKS THE SAVE. A denied permission, a basement with
//      no signal, a slow lock, or a throwing geolocation API all mean "no
//      coordinate", never "the expense failed". A map is not worth a lost
//      expense.
//   2. IT NEVER PROMPTS. Location is asked for in the setup checklist, in
//      context, with an explanation. A permission dialog erupting out of an
//      unrelated Save button is what gets Deny tapped, and an iOS deny is
//      sticky, so one rude prompt here would poison tracking app-wide.
//
// Also covered: geoAt is stored separately from the record's own date, which is
// what lets a later place-detector tell a receipt logged AT the supply house
// from one logged that night on the sofa (otherwise someone's living room gets
// promoted to a supply house).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Record geo-stamping', () => {
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

  // Swap the geolocation API for a controllable stub, and pin the permission
  // answer, so none of this depends on the runner's real location or a real
  // browser prompt.
  const withGeo = (implFactory, permission) => page.evaluate(({ implSrc, permission }) => {
    window.__realGeo = navigator.geolocation;
    window.__realRead = _geoReadPermission;
    // eslint-disable-next-line no-eval
    const impl = eval('(' + implSrc + ')')();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: impl });
    _geoReadPermission = async () => permission;
  }, { implSrc: implFactory.toString(), permission });

  const restoreGeo = () => page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: window.__realGeo });
    _geoReadPermission = window.__realRead;
    try { localStorage.removeItem('zp3_geo_granted'); } catch (e) {}
  });

  test.afterEach(async () => { await restoreGeo(); });

  // ── The happy path ─────────────────────────────────────────────────────────

  test('stamps lat/lon/geoAcc/geoAt onto the record when permission is granted', async () => {
    await withGeo((() => ({
      getCurrentPosition: (ok) => ok({ coords: { latitude: 37.6889123456, longitude: -97.3361987654, accuracy: 12.4 } }),
    })), 'granted');
    const out = await page.evaluate(async () => {
      const rec = { id: 'x1', vendor: 'Ferguson' };
      _stampGeo(rec);
      await new Promise(r => setTimeout(r, 120));
      return rec;
    });
    // 6dp is ~11cm, far more precision than any of this needs.
    expect(out.lat).toBe(37.688912);
    expect(out.lon).toBe(-97.336199);
    expect(out.geoAcc).toBe(12);
    expect(String(out.geoAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('geoAt is its own field, NOT the record date (the sofa problem)', async () => {
    await withGeo((() => ({
      getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }),
    })), 'granted');
    const out = await page.evaluate(async () => {
      // An expense dated days ago, entered tonight from the couch.
      const rec = { id: 'x2', date: '2026-07-20', vendor: 'Ferguson' };
      _stampGeo(rec);
      await new Promise(r => setTimeout(r, 120));
      return { date: rec.date, geoAt: rec.geoAt };
    });
    // A later place-detector must be able to see these disagree and refuse to
    // promote the living room to a supply house.
    expect(out.date).toBe('2026-07-20');
    expect(out.geoAt.slice(0, 10)).not.toBe('2026-07-20');
  });

  // ── fieldPrefix: stamp WITHOUT clobbering an existing address geocode ──────

  test('a fieldPrefix stamps completedLat/completedLon, never lat/lon', async () => {
    await withGeo((() => ({
      getCurrentPosition: (ok) => ok({ coords: { latitude: 10, longitude: 20, accuracy: 8 } }),
    })), 'granted');
    const out = await page.evaluate(async () => {
      // job.lat/lon already hold an address geocode from day-map.js; a job
      // marked complete must not overwrite it with the crew's live position.
      const rec = { id: 'j1', lat: 37.5, lon: -97.5 };
      _stampGeo(rec, null, 'completed');
      await new Promise(r => setTimeout(r, 120));
      return rec;
    });
    expect(out.lat).toBe(37.5);
    expect(out.lon).toBe(-97.5);
    expect(out.completedLat).toBe(10);
    expect(out.completedLon).toBe(20);
    expect(out.completedGeoAcc).toBe(8);
    expect(String(out.completedGeoAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── Rule 1: never blocks, never breaks ─────────────────────────────────────

  test('a DENIED fix leaves the record untouched and never throws', async () => {
    await withGeo((() => ({
      getCurrentPosition: (_ok, err) => err({ code: 1, message: 'denied' }),
    })), 'granted');
    const out = await page.evaluate(async () => {
      const rec = { id: 'x3', vendor: 'Ferguson' };
      let threw = false;
      try { _stampGeo(rec); } catch (e) { threw = true; }
      await new Promise(r => setTimeout(r, 120));
      return { threw, lat: rec.lat, keys: Object.keys(rec) };
    });
    expect(out.threw).toBe(false);
    expect(out.lat).toBeUndefined();
    expect(out.keys).toEqual(['id', 'vendor']); // nothing added at all
  });

  test('a THROWING geolocation API is swallowed, the record still stands', async () => {
    await withGeo((() => ({
      getCurrentPosition: () => { throw new Error('boom'); },
    })), 'granted');
    const out = await page.evaluate(async () => {
      const rec = { id: 'x4', vendor: 'Ferguson' };
      let threw = false;
      try { _stampGeo(rec); } catch (e) { threw = true; }
      await new Promise(r => setTimeout(r, 120));
      return { threw, lat: rec.lat };
    });
    expect(out.threw).toBe(false);
    expect(out.lat).toBeUndefined();
  });

  test('_stampGeo returns immediately, it does not await the fix', async () => {
    await withGeo((() => ({
      // A fix that never arrives, the basement-with-no-signal case.
      getCurrentPosition: () => {},
    })), 'granted');
    const out = await page.evaluate(() => {
      const t0 = performance.now();
      _stampGeo({ id: 'x5' });
      return performance.now() - t0;
    });
    // Synchronous return. If this ever awaited, an expense save would hang on a
    // GPS lock, which is the one outcome the design refuses.
    expect(out).toBeLessThan(50);
  });

  test('null/undefined records are no-ops', async () => {
    const out = await page.evaluate(() => {
      let threw = false;
      try { _stampGeo(null); _stampGeo(undefined); _stampGeo(); } catch (e) { threw = true; }
      return threw;
    });
    expect(out).toBe(false);
  });

  // ── Rule 2: never prompts ──────────────────────────────────────────────────

  test('does NOT call the geolocation API when permission was never granted', async () => {
    await withGeo((() => ({
      getCurrentPosition: () => { window.__called = (window.__called || 0) + 1; },
    })), 'prompt');
    const out = await page.evaluate(async () => {
      window.__called = 0;
      _stampGeo({ id: 'x6' });
      await new Promise(r => setTimeout(r, 120));
      return window.__called;
    });
    // Calling getCurrentPosition in the 'prompt' state IS the prompt. Never from
    // a Save button.
    expect(out).toBe(0);
  });

  test('does not stamp when permission is denied outright', async () => {
    await withGeo((() => ({
      getCurrentPosition: () => { window.__called = (window.__called || 0) + 1; },
    })), 'denied');
    const out = await page.evaluate(async () => {
      window.__called = 0;
      _stampGeo({ id: 'x7' });
      await new Promise(r => setTimeout(r, 120));
      return window.__called;
    });
    expect(out).toBe(0);
  });

  // ── Safari: 'unsupported' is not the same as 'no' ──────────────────────────

  test("'unsupported' + a recorded prior grant DOES stamp (Safari)", async () => {
    await withGeo((() => ({
      getCurrentPosition: (ok) => ok({ coords: { latitude: 5, longitude: 6, accuracy: 9 } }),
    })), 'unsupported');
    const out = await page.evaluate(async () => {
      localStorage.setItem('zp3_geo_granted', '1');
      const rec = { id: 'x8' };
      _stampGeo(rec);
      await new Promise(r => setTimeout(r, 120));
      return rec.lat;
    });
    // Safari cannot report permission state, so without this fallback Safari
    // users would silently never get a single coordinate.
    expect(out).toBe(5);
  });

  test("'unsupported' with NO prior grant does not stamp", async () => {
    await withGeo((() => ({
      getCurrentPosition: () => { window.__called = (window.__called || 0) + 1; },
    })), 'unsupported');
    const out = await page.evaluate(async () => {
      try { localStorage.removeItem('zp3_geo_granted'); } catch (e) {}
      window.__called = 0;
      _stampGeo({ id: 'x9' });
      await new Promise(r => setTimeout(r, 120));
      return window.__called;
    });
    expect(out).toBe(0);
  });

  // ── The expense row surfaces it, and only when it means something ──────────

  test('the expense row links the pin only for a usable fix', async () => {
    const out = await page.evaluate(() => {
      const seed = [
        { id: 90001, date: todayKey(), vendor: 'Tight Fix', amount: 10, cat: 'materials', lat: 37.1, lon: -97.1, geoAcc: 12 },
        { id: 90002, date: todayKey(), vendor: 'Loose Fix', amount: 10, cat: 'materials', lat: 37.2, lon: -97.2, geoAcc: 3000 },
        { id: 90003, date: todayKey(), vendor: 'No Fix', amount: 10, cat: 'materials' },
      ];
      const orig = expenses.slice();
      expenses.length = 0; seed.forEach(e => expenses.push(e));
      renderExpenses();
      const html = document.getElementById('pg-tracker')?.innerHTML || document.body.innerHTML;
      const res = {
        tight: html.includes('37.1,-97.1'),
        loose: html.includes('37.2,-97.2'),
        none: (html.match(/maps\?q=/g) || []).length,
      };
      expenses.length = 0; orig.forEach(e => expenses.push(e));
      return res;
    });
    expect(out.tight).toBe(true);
    // A 3km fix would drop the pin on the wrong side of a retail park; showing it
    // is worse than showing nothing.
    expect(out.loose).toBe(false);
    expect(out.none).toBe(1);
  });

  test('zero console errors across the geo-stamp suite', async () => {
    assertNoErrors(page, 'record geo-stamping');
  });
});
