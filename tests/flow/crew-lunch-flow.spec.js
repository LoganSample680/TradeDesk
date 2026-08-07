// @ts-check
// ── Buying the guys lunch, and the receipt that turns up days later ──────────
//
// Owner script (2026-08-02), verbatim: "take a drive go get lunch for the guys,
// scan a receipt in days later and it logs it correctly as business miles".
//
// This is the case the GPS cannot decide on its own. Same restaurant, same half
// hour parked, whether they bought their own sandwich or fed the crew. Their CPA
// draws the line: a personal lunch mid-trip is a detour and only the direct
// miles between the two business points are deductible, while buying the crew
// lunch is a work errand and both legs count in full.
//
// So the receipt decides, and the receipt is almost never scanned at the
// counter. It gets done in the truck at 5pm, or at the kitchen table on Sunday.
// Worse, the app stamps an expense with where they were WHEN THEY LOGGED IT, so
// a late receipt carries the kitchen's coordinate and can never match the diner
// by location. The vendor name and the date they put on it are what survive.
//
// The day is driven twice over, in one pass:
//   1. no receipt yet   → detour: the lunch legs are off the log and the trip
//                          reads supply house to job site, direct
//   2. receipt appears  → errand: both legs back, named after the restaurant
//
// WHERE THIS CAN RUN: MapKit's token is domain-locked to tradedeskpro.app and
// *.pages.dev, so the naming half only means anything on a preview URL. Without
// MapKit the app cannot know a pin is a restaurant at all, the stop is kept as
// an ordinary business stop, and this spec says so rather than pretending.
const { test, expect } = require('@playwright/test');
const { signIn, step, report, resetLedger } = require('./live-helpers');

const FLOW = 'crew-lunch';
const BASELINE = require('./perf-baseline.json');

const JOB   = '309 S Kansas Ave, Topeka, KS';
const DEPOT = 'Home Depot, Topeka, KS';
const DOWNTOWN = { lat: 39.0473, lng: -95.6752 };

test.describe('Lunch for the crew', () => {
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a receipt scanned days later turns the detour back into business miles', async ({ page }) => {
    const runTag = Date.now();

    // ── The day's two known points ──────────────────────────────────────────
    await step(page, {
      label: 'resolve the job and the supply house',
      page: 'geo', role: 'contractor',
      suspect: 'mileage.js _resolveCoords',
      ruleText: 'both business points of the day must resolve to a coordinate',
      expected: 'two coordinates',
      act: async (p) => {
        await p.evaluate(async (a) => {
          window.__crew = {};
          for (const [k, addr] of Object.entries(a.addrs)) window.__crew[k] = await _resolveCoords(addr);
          S.teamTracking = true;
          const j = window.__crew.JOB;
          clients.push({ id: a.tag + 1, name: 'Crew Lunch Client ' + a.tag, addr: a.addrs.JOB });
          jobs.push({ id: a.tag + 2, name: 'Service call ' + a.tag, eventType: 'job', status: 'upcoming',
                      start: todayKey(), days: 1, client_id: a.tag + 1, addr: a.addrs.JOB,
                      lat: j && j.lat, lon: j && j.lng });
          saveAll();
        }, { addrs: { JOB, DEPOT }, tag: runTag });
        return 0;
      },
      rule: async (p) => {
        const d = await p.evaluate(() => window.__crew);
        const missing = Object.entries(d).filter(([, v]) => !v || v.lat == null).map(([k]) => k);
        return { ok: !missing.length, got: missing.length ? 'unresolved: ' + missing.join(',') : 'both resolved' };
      },
    });

    const engine = await page.evaluate(() => ({
      mapkitReady: typeof _mapkitReady !== 'undefined' && !!_mapkitReady,
      host: location.hostname,
    }));
    console.log(`[crew-lunch] routing engine: ${engine.mapkitReady ? 'MapKit (Apple Maps)' : 'Valhalla/OSRM fallback'} on ${engine.host}`);

    // Where they eat, asked of Apple rather than picked by me: the rule under
    // test is about a pin Apple calls a restaurant, so a coordinate I chose
    // would be testing my guess about downtown Topeka instead of the rule.
    const lunch = await page.evaluate(async (at) => {
      if (typeof _mapkitReady === 'undefined' || !_mapkitReady || typeof mapkit === 'undefined') return { named: false };
      try {
        const region = new mapkit.CoordinateRegion(new mapkit.Coordinate(at.lat, at.lng), new mapkit.CoordinateSpan(0.06, 0.06));
        const places = await new Promise((resolve, reject) => {
          new mapkit.Search({ region }).search('restaurant', (err, data) => {
            const list = data && (data.places || data.results);
            if (err || !list || !list.length) { reject(new Error('none')); return; }
            resolve(list);
          });
        });
        const food = places.find(p => p.coordinate && /Restaurant|Cafe|Food|Bakery|Brewery|Bar/i.test(String(p.pointOfInterestCategory || '')));
        if (!food) return { named: false };
        return { lat: food.coordinate.latitude, lng: food.coordinate.longitude,
                 name: food.name || '', category: food.pointOfInterestCategory || '', named: true };
      } catch (_e) { return { named: false }; }
    }, DOWNTOWN);
    console.log(`[crew-lunch] lunch: ${lunch.named ? `${lunch.name} (${lunch.category})` : 'Apple named nothing, so the app cannot know it is a restaurant'}`);
    test.skip(!lunch.named, 'no MapKit on this origin: a stop cannot be known to be a restaurant, so there is no detour to undo');

    const priorTrips = await page.evaluate(() => mileage.filter(m => m.gps && m.legKey).map(m => m.id));

    // ── Drive it ────────────────────────────────────────────────────────────
    // Same shape the Topeka day uses: a ping on site, a ping out on the road,
    // the clock wound back so the leg is a real duration, a ping at the
    // destination, then the dwell. An arrival somewhere the app does not
    // recognise only becomes a stop when they pull out, so "now" is the
    // departure and the arrival was `dwell` ago.
    const hop = async (p, to, minutes, dwell) => p.evaluate(async (a) => {
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng, accuracy: 8 } });
      await ping({ lat: 39.9, lng: -96.9 });
      if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - a.minutes * 60000).toISOString();
      if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - a.minutes * 60000).toISOString();
      await ping(a.to);
      if (a.dwell) {
        if (_geoArrivedAt) _geoArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoStopAnchor) {
          _geoStopAnchor.at = new Date(Date.now() - a.dwell * 60000).toISOString();
          _geoDriveStartedAt = new Date(Date.now() - (a.dwell + a.minutes) * 60000).toISOString();
        }
      }
    }, { to, minutes, dwell: dwell || 0 });

    await step(page, {
      label: 'on the job, then out to the supply house, then to lunch, then back',
      page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing → _geoCloseStop',
      ruleText: 'the whole run logs itself with no taps at all',
      expected: 'four stops driven, zero interactions',
      act: async (p) => {
        await p.evaluate(async () => {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          const j = window.__crew.JOB;
          await _geoOnPing({ coords: { latitude: j.lat, longitude: j.lng, accuracy: 8 } });
        });
        const depot = await p.evaluate(() => window.__crew.DEPOT);
        await hop(p, depot, 14, 20);                       // job → supply house
        await hop(p, { lat: lunch.lat, lng: lunch.lng }, 8, 30);   // → lunch
        const job = await p.evaluate(() => window.__crew.JOB);
        await hop(p, job, 10, 90);                          // → back on the job
        return 0;   // the entire run costs the contractor nothing
      },
      rule: async (p) => {
        const n = await p.evaluate((prior) => {
          const seen = new Set(prior);
          return mileage.filter(m => m.gps && m.legKey && !seen.has(m.id)).length;
        }, priorTrips);
        return { ok: n > 0, got: `${n} trips logged` };
      },
    });

    // ── 1. NO RECEIPT YET: it reads as a personal detour ─────────────────────
    await step(page, {
      label: 'with no receipt, lunch is a detour and the trip is supply house to job',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js _autoNameStopTrip / _poiIsPersonal',
      ruleText: 'a restaurant nobody bought anything at is a personal stop, so the legs either side collapse into one direct trip',
      expected: 'nothing billed to or from the lunch pin',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate((a) => {
          const seen = new Set(a.prior);
          const at = (c) => c && Math.abs(c.lat - a.lunch.lat) < 0.0005 && Math.abs(c.lng - a.lunch.lng) < 0.0005;
          const mine = mileage.filter(m => m.gps && m.legKey && !seen.has(m.id));
          return {
            touching: mine.filter(m => at(m.fromCoord) || at(m.toCoord)).map(m => `${m.from_name} → ${m.to_name}`),
            all: mine.map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, method: m.calc_method })),
          };
        }, { prior: priorTrips, lunch });
        console.log('[crew-lunch] before the receipt:\n' + out.all.map(t =>
          `   ${t.from} → ${t.to}  ${t.miles} mi  (${t.method})`).join('\n'));
        // The direct supply-house-to-job leg, measured, and nothing at the diner.
        const direct = out.all.find(t => /home\s*depot/i.test(t.from || '') && t.miles > 0);
        return {
          ok: !out.touching.length && !!direct,
          got: out.touching.length ? 'billed at the diner: ' + out.touching.join(', ')
             : direct ? `detour collapsed: ${direct.from} → ${direct.to} ${direct.miles} mi` : 'no direct supply-house leg at all',
        };
      },
    });

    // ── 2. THE RECEIPT, DAYS LATE ────────────────────────────────────────────
    // Dated the day of the drive, stamped nowhere near the diner. That is what a
    // real late receipt looks like: the coordinate is honest about the kitchen
    // table, so only the vendor and the date can carry the truth.
    await step(page, {
      label: 'the receipt turns up days later, scanned at the kitchen table',
      page: 'expenses', role: 'contractor',
      suspect: 'places.js expenseForStop → mileage.js reviewDetourReceipts',
      ruleText: 'a receipt for that restaurant on that date makes the stop a work errand, and both legs count in full',
      expected: 'the lunch legs back on the log, named after the restaurant',
      act: async (p) => {
        await p.evaluate((a) => {
          expenses.unshift({
            id: _newId(), date: todayKey(), loggedAt: new Date().toISOString(),
            cat: 'Meals', vendor: a.name, amount: 84.2, pay: 'Business card',
            notes: 'Lunch for the crew ' + a.tag,
            // Scanned at home: the stamp is the kitchen, half a state away.
            lat: 39.9, lon: -96.9, geoAt: new Date().toISOString(), geoAcc: 12,
          });
          saveAll();
          // The same call the expense save path makes (js/finance.js).
          window.__restored = (typeof reviewDetourReceipts === 'function') ? reviewDetourReceipts() : -1;
        }, { name: lunch.name, tag: runTag });
        return 1;   // one deliberate action: logging the receipt
      },
      rule: async (p) => {
        const out = await p.evaluate((a) => {
          const seen = new Set(a.prior);
          const at = (c) => c && Math.abs(c.lat - a.lunch.lat) < 0.0005 && Math.abs(c.lng - a.lunch.lng) < 0.0005;
          const mine = mileage.filter(m => m.gps && m.legKey && !seen.has(m.id));
          return {
            restored: window.__restored,
            toLunch: mine.filter(m => at(m.toCoord)).map(m => ({ to: m.to_name, miles: m.miles, purpose: m.purpose, method: m.calc_method })),
            fromLunch: mine.filter(m => at(m.fromCoord)).map(m => ({ from: m.from_name, miles: m.miles, method: m.calc_method })),
            all: mine.map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, method: m.calc_method })),
          };
        }, { prior: priorTrips, lunch });
        console.log('[crew-lunch] after the receipt:\n' + out.all.map(t =>
          `   ${t.from} → ${t.to}  ${t.miles} mi  (${t.method})`).join('\n'));
        const inLeg = out.toLunch[0], outLeg = out.fromLunch[0];
        const named = (s) => !!s && s.toLowerCase().includes(lunch.name.toLowerCase().replace(/^the\s+/, ''));
        return {
          ok: out.restored === 1 && !!inLeg && !!outLeg &&
              named(inLeg.to) && named(outLeg.from) &&
              inLeg.miles > 0 && outLeg.miles > 0 &&
              inLeg.method === 'auto_route' && outLeg.method === 'auto_route',
          got: `restored ${out.restored}; in: ${inLeg ? `${inLeg.to} ${inLeg.miles} mi (${inLeg.method})` : 'MISSING'}` +
               `; out: ${outLeg ? `${outLeg.from} ${outLeg.miles} mi (${outLeg.method})` : 'MISSING'}`,
        };
      },
    });

    // Running the sweep again must change nothing, or every app load would add
    // another copy of the leg it just restored.
    await step(page, {
      label: 'the sweep is safe to run on every load',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js reviewDetourReceipts idempotency',
      ruleText: 'a restored day stays restored, and does not grow a leg per app load',
      expected: 'the second sweep restores nothing and adds nothing',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate((prior) => {
          const seen = new Set(prior);
          const before = mileage.filter(m => m.gps && m.legKey && !seen.has(m.id)).length;
          const again = reviewDetourReceipts();
          const after = mileage.filter(m => m.gps && m.legKey && !seen.has(m.id)).length;
          return { before, after, again };
        }, priorTrips);
        return {
          ok: out.again === 0 && out.before === out.after,
          got: `${out.before} trips before, ${out.after} after, sweep restored ${out.again}`,
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
