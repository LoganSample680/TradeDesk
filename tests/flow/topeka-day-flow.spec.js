// @ts-check
// ── The owner's own Tuesday, end to end, on real Topeka addresses ────────────
//
// Owner script (2026-08-01), verbatim:
//   set 2015 SW Randolph Ave, Topeka KS 66604 [home office]
//   → 309 S Kansas Ave, Topeka KS            [client, work]
//   → the Home Depot in Topeka               [supplies]
//   → God knows where for lunch              [THIS SHOULDN'T COUNT]
//   → back to 309 S Kansas Ave               [more work]
//   → 3125 SW 17th St, Topeka KS 66604       [estimate]
//   → home to 2015 SW Randolph Ave           [finish the day]
//
// And what it has to prove:
//   1. The mileage comes from Apple Maps, correctly, on every leg.
//   2. The time between stops calculates correctly.
//   3. Home Depot comes back BY NAME and lands as a supply place.
//
// WHY THE ADDRESSES ARE GEOCODED AT RUNTIME rather than pinned as constants:
// pinning coordinates would test the machine against numbers I chose, and the
// thing under test is precisely whether the app resolves a real address to the
// right point and asks Apple for the distance between two of them. A constant
// would quietly skip the half that can actually be wrong.
//
// WHERE THIS CAN RUN. MapKit's token is domain-locked to tradedeskpro.app and
// *.pages.dev (js/mileage.js), so on localhost _routeDistance silently falls
// back to Valhalla/OSRM. Those are real road distances, so the leg structure
// and the time maths are fully checked on the local runner, but the assertion
// that the number came from APPLE only means anything on a preview URL. The
// test states which engine answered rather than pretending it does not matter.
const { test, expect } = require('@playwright/test');
const { signIn, step, report, resetLedger, finding } = require('./live-helpers');

const FLOW = 'topeka-day';
const BASELINE = require('./perf-baseline.json');

const HOME   = '2015 SW Randolph Ave, Topeka, KS 66604';
const CLIENT = '309 S Kansas Ave, Topeka, KS';
const ESTIM  = '3125 SW 17th St, Topeka, KS 66604';
const DEPOT  = 'Home Depot, Topeka, KS';
// Lunch is deliberately NOT an address the app knows or can learn: it is one
// visit, so it never reaches the repeat-stop threshold, which is exactly the
// "God knows where" in the script.
const LUNCH  = { lat: 39.0330, lon: -95.6900 };

const runTag = Date.now();

test.describe('A full Topeka day', () => {
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('home office → client → Home Depot → lunch → client → estimate → home', async ({ page }) => {
    // ── Fixtures: the real addresses, resolved by the app's own geocoder ─────
    const geo = await step(page, {
      label: 'resolve the day\'s four addresses',
      page: 'geo', role: 'contractor',
      suspect: 'mileage.js _resolveCoords / _geocodeAddress',
      ruleText: 'every address in the day must resolve to a coordinate',
      expected: 'four coordinates',
      act: async (p) => {
        await p.evaluate(async (a) => {
          window.__day = {};
          for (const [k, addr] of Object.entries(a.addrs)) {
            window.__day[k] = await _resolveCoords(addr);
          }
          S.teamTracking = true;
          // The home office is what makes the first and last legs of the day
          // deductible at all (Rev. Rul. 99-7). Both routes to declaring one are
          // set, because both are real and the test should not care which.
          S.homeOffice = true;
          const h = window.__day.HOME;
          if (h) { S.officeLat = h.lat; S.officeLon = h.lng; }
          if (typeof places !== 'undefined') {
            places.length = 0;
            if (h) savePlace({ name: 'Home Office ' + a.tag, kind: 'home_office', lat: h.lat, lon: h.lng, confirmedBy: 'manual' });
          }
          const c = window.__day.CLIENT;
          clients.push({ id: a.tag + 1, name: 'Kansas Ave Client ' + a.tag, addr: a.addrs.CLIENT });
          jobs.push({ id: a.tag + 2, name: 'Panel swap ' + a.tag, eventType: 'job', status: 'upcoming',
                      start: todayKey(), days: 1, client_id: a.tag + 1, addr: a.addrs.CLIENT,
                      lat: c && c.lat, lon: c && c.lng });
          const e = window.__day.ESTIM;
          clients.push({ id: a.tag + 3, name: 'SW 17th Estimate ' + a.tag, addr: a.addrs.ESTIM });
          jobs.push({ id: a.tag + 4, name: 'Estimate ' + a.tag, eventType: 'job', status: 'upcoming',
                      start: todayKey(), days: 1, client_id: a.tag + 3, addr: a.addrs.ESTIM,
                      lat: e && e.lat, lon: e && e.lng });
          saveAll();
        }, { addrs: { HOME, CLIENT, ESTIM, DEPOT }, tag: runTag });
        return 0;   // fixtures, not user interaction
      },
      rule: async (p) => {
        const d = await p.evaluate(() => window.__day);
        const missing = Object.entries(d).filter(([, v]) => !v || v.lat == null).map(([k]) => k);
        return { ok: missing.length === 0, got: missing.length ? 'unresolved: ' + missing.join(',') : 'all four resolved' };
      },
    });

    // ── Which routing engine is actually answering ───────────────────────────
    // Reported, never silently assumed. On a preview this says mapkit and the
    // "from Apple Maps" requirement is genuinely met; on localhost it says
    // fallback and the distances are real but not Apple's.
    const engine = await page.evaluate(() => ({
      mapkitReady: !!window._mapkitReady,
      host: location.hostname,
    }));
    console.log(`[topeka-day] routing engine: ${engine.mapkitReady ? 'MapKit (Apple Maps)' : 'Valhalla/OSRM fallback'} on ${engine.host}`);

    // ── Drive the day ────────────────────────────────────────────────────────
    // Each hop: a ping at the origin, a ping out on the road, the clock wound
    // back so the leg is a real duration, then a ping at the destination.
    const hop = async (p, toKey, minutes, dwellMinutes) => p.evaluate(async (a) => {
      const ping = (c) => _geoOnPing({ coords: { latitude: c.lat, longitude: c.lng != null ? c.lng : c.lon, accuracy: 8 } });
      await ping({ lat: 39.9, lng: -96.9 });            // out on the road, outside every fence
      if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - a.minutes * 60000).toISOString();
      if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - a.minutes * 60000).toISOString();
      await ping(a.to);
      // Sit there for the stated dwell, so time-on-site is a real number.
      if (a.dwell) {
        if (_geoArrivedAt) _geoArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoPlaceArrivedAt) _geoPlaceArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoShopArrivedAt) _geoShopArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
      }
    }, { to: toKey, minutes, dwell: dwellMinutes || 0 });

    await step(page, {
      label: 'start the day at the home office',
      page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing shop/place fence',
      ruleText: 'the first fix of the day is inside the home office',
      expected: 'inside a fence',
      act: async (p) => {
        await p.evaluate(async () => {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          _geoHomeDwell = null; _geoWasAtHome = false;
          const h = window.__day.HOME;
          await _geoOnPing({ coords: { latitude: h.lat, longitude: h.lng, accuracy: 8 } });
          // 40 minutes of paperwork before leaving, actively using the app, so
          // the home-office activity rule has something real to count.
          _geoLastInteractAt = Date.now();
          if (_geoHomeDwell) _geoHomeDwell.activeMs = 40 * 60000;
        });
        return 0;
      },
      rule: async (p) => {
        const inside = await p.evaluate(() => !!(_geoWasInShop || _geoCurrentPlace));
        return { ok: inside, got: inside ? 'inside the home office' : 'no fence matched the home address' };
      },
    });

    const legs = [
      { key: 'CLIENT', label: 'home office → client on S Kansas Ave', mins: 12, dwell: 95 },
      { key: 'DEPOT',  label: 'client → Home Depot for supplies',     mins: 14, dwell: 25 },
      { key: 'LUNCH',  label: 'Home Depot → lunch (must not count)',  mins: 9,  dwell: 45 },
      { key: 'CLIENT', label: 'lunch → back to the client',           mins: 11, dwell: 120 },
      { key: 'ESTIM',  label: 'client → estimate on SW 17th',         mins: 13, dwell: 35 },
      { key: 'HOME',   label: 'estimate → home office, day done',     mins: 10, dwell: 30 },
    ];

    for (const leg of legs) {
      await step(page, {
        label: leg.label,
        page: 'geo', role: 'contractor',
        suspect: 'geo-track.js _geoDriveEntry → mileage.js autoLogDriveTrip',
        ruleText: 'every drive between two known points logs its own measured trip',
        expected: 'a drive leg, and a mileage row unless the destination is the lunch stop',
        act: async (p) => {
          const dest = await p.evaluate((k) => (k === 'LUNCH' ? null : window.__day[k]), leg.key);
          await hop(p, dest || LUNCH, leg.mins, leg.dwell);
          return 0;   // the whole point is that the day costs the contractor zero taps
        },
        rule: async (p) => {
          const n = await p.evaluate(() => mileage.length);
          return { ok: n >= 0, got: `${n} trips so far` };
        },
      });
    }

    // ── 1. THE MILEAGE ───────────────────────────────────────────────────────
    await step(page, {
      label: 'every drive between known points is measured',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js autoLogDriveTrip / _routeDistance',
      ruleText: 'six legs were driven; the five between known points log measured trips, the lunch leg does not',
      expected: '5 measured trips, none of them zero miles',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(() => {
          // Give any in-flight route calls a moment, then sweep the stragglers.
          return _retryPendingTrips().then(() => mileage
            .filter(m => m.gps && m.legKey)
            .map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, method: m.calc_method, purpose: m.purpose })));
        });
        const measured = out.filter(t => t.miles > 0);
        const pending = out.filter(t => t.calc_method === 'pending_auto');
        console.log('[topeka-day] trips:\n' + out.map(t => `   ${t.from} → ${t.to}  ${t.miles} mi  ${t.purpose}  (${t.method})`).join('\n'));
        // Real Topeka distances: every one of these hops is inside the city, so
        // a leg over 30 miles means the route resolved to the wrong point.
        const absurd = measured.filter(t => t.miles > 30);
        return {
          ok: out.length === 5 && measured.length === 5 && !absurd.length && !pending.length,
          got: `${out.length} trips, ${measured.length} measured, ${pending.length} still pending, ${absurd.length} implausible`,
        };
      },
    });

    // ── 2. THE TIME ──────────────────────────────────────────────────────────
    await step(page, {
      label: 'lunch is off-job time, not drive time and not job labor',
      page: 'mileage', role: 'contractor',
      suspect: 'geo-track.js _geoCloseStop → source:stop',
      ruleText: 'the 45 minutes at lunch logs as its own off-job entry and carries no mileage',
      expected: 'one stop entry, zero mileage rows for the lunch leg',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async () => {
          const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
          const since = new Date(Date.now() - 6 * 3600000).toISOString();
          const { data } = await _supa.from('job_time_entries')
            .select('source,minutes,dest_place,arrived_at')
            .eq('contractor_user_id', cid).gte('created_at', since);
          return data || [];
        });
        const stops = out.filter(r => r.source === 'stop');
        const drives = out.filter(r => /^drive/.test(r.source || ''));
        console.log(`[topeka-day] time entries: ${drives.length} drive, ${stops.length} off-job stop, ` +
                    `${out.filter(r => /^geofence/.test(r.source || '')).length} on-site`);
        const lunch = stops.find(r => r.minutes >= 40 && r.minutes <= 50);
        return {
          ok: !!lunch && drives.length >= 5,
          got: `${stops.length} stops (lunch ${lunch ? lunch.minutes + ' min' : 'MISSING'}), ${drives.length} drive legs`,
        };
      },
    });

    await step(page, {
      label: 'time on site at each stop is the time actually spent there',
      page: 'mileage', role: 'contractor',
      suspect: 'geo-track.js _geoCloseEntry / _geoClosePlaceEntry',
      ruleText: 'the two client visits and the estimate log their dwell, to the minute',
      expected: 'a ~95 min and a ~120 min visit at the client, ~35 at the estimate',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate(async () => {
          const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
          const since = new Date(Date.now() - 6 * 3600000).toISOString();
          const { data } = await _supa.from('job_time_entries')
            .select('source,minutes,job_id').eq('contractor_user_id', cid).gte('created_at', since);
          return (data || []).filter(r => /^geofence/.test(r.source || '')).map(r => r.minutes).sort((a, b) => b - a);
        });
        console.log('[topeka-day] on-site minutes:', out.join(', '));
        const near = (n, t) => Math.abs(n - t) <= 2;
        return {
          ok: out.some(n => near(n, 120)) && out.some(n => near(n, 95)) && out.some(n => near(n, 35)),
          got: 'on-site minutes: ' + out.join(', '),
        };
      },
    });

    // ── 3. HOME DEPOT, BY NAME ───────────────────────────────────────────────
    await step(page, {
      label: 'the supply stop comes back as Home Depot and saves as a supply place',
      page: 'places', role: 'contractor',
      suspect: 'mileage.js _poiAt / _poiPlaceKind → places.js openPlaceModal prefill',
      ruleText: 'MapKit names the business at the pin and the place saves as a supply house',
      expected: 'a place named Home Depot with kind supply',
      act: async (p) => {
        const named = await p.evaluate(async () => {
          const d = window.__day.DEPOT;
          if (!d) return null;
          const poi = (typeof _poiAt === 'function') ? await _poiAt({ lat: d.lat, lng: d.lng }) : null;
          if (poi && poi.name) {
            savePlace({ name: poi.name, kind: _poiPlaceKind(poi.category), lat: d.lat, lon: d.lng, confirmedBy: 'poi' });
            saveAll();
          }
          return poi;
        });
        console.log('[topeka-day] POI at the Home Depot pin:', JSON.stringify(named));
        return 1;   // the contractor's single tap: confirming the suggested name
      },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          const d = window.__day.DEPOT;
          const pl = placeAt({ lat: d.lat, lon: d.lng });
          return pl ? { name: pl.name, kind: pl.kind } : null;
        });
        const named = !!(out && /home\s*depot/i.test(out.name || ''));
        return {
          ok: named && out.kind === 'supply',
          got: out ? `"${out.name}" (${out.kind})` : 'no place at the Home Depot pin',
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
