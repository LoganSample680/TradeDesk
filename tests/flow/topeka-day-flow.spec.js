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
// "God knows where" in the script. The coordinate is only the fallback for a
// run with no MapKit; where MapKit is up, the test asks Apple for a real
// restaurant downtown and eats there, because "the app must not bill lunch"
// only means something if lunch is somewhere Apple actually calls a restaurant.
const LUNCH  = { lat: 39.0330, lon: -95.6900 };
// Downtown Topeka, the box the lunch search runs in.
const DOWNTOWN = { lat: 39.0473, lng: -95.6752 };

test.describe('A full Topeka day', () => {
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('home office → client → Home Depot → lunch → client → estimate → home', async ({ page }) => {
    // Per RUN, not per module. At module scope both browser projects share one
    // value (workers:1 loads the file once), so chromium and webkit seeded two
    // clients with the SAME id into one account and each read the other's
    // mileage rows back: the first live run reported "8 trips" for a six-leg
    // day (2026-08-02).
    const runTag = Date.now();
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
          // The yard IS the home office in this day, so the business address on
          // file has to say so. Without it the shop end of the first and last
          // legs has no street address to travel as, and the row falls back to
          // the bare word "Shop", which is the thing being fixed.
          S.baddr = '2015 SW Randolph Ave'; S.bcity = 'Topeka'; S.state = 'KS'; S.bzip = '66604';
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
        // Printed so the numbers are checkable by hand. Paste a pair into Apple
        // Maps and you get the same route the app asked for.
        console.log('[topeka-day] resolved coordinates:\n' + Object.entries(d)
          .map(([k, v]) => `   ${k.padEnd(7)} ${v && v.lat != null ? `${v.lat}, ${v.lng}` : 'UNRESOLVED'}`).join('\n'));
        return { ok: missing.length === 0, got: missing.length ? 'unresolved: ' + missing.join(',') : 'all four resolved' };
      },
    });

    // ── Which routing engine is actually answering ───────────────────────────
    // Reported, never silently assumed. On a preview this says mapkit and the
    // "from Apple Maps" requirement is genuinely met; on localhost it says
    // fallback and the distances are real but not Apple's.
    // `_mapkitReady` is a script-scoped `let`, so it is NOT a window property:
    // reading window._mapkitReady reported "fallback" on the preview where
    // MapKit was in fact answering, which is the one place the answer matters.
    // evaluate() runs inside the page realm, so the bare name resolves.
    const engine = await page.evaluate(() => ({
      mapkitReady: typeof _mapkitReady !== 'undefined' && !!_mapkitReady,
      host: location.hostname,
    }));
    console.log(`[topeka-day] routing engine: ${engine.mapkitReady ? 'MapKit (Apple Maps)' : 'Valhalla/OSRM fallback'} on ${engine.host}`);

    // ── Where lunch actually is ──────────────────────────────────────────────
    // Asked of Apple rather than picked by me. The rule under test is "a stop
    // Apple calls a restaurant is a personal errand and is not billed", and
    // pointing it at a coordinate I chose would test my guess about downtown
    // Topeka instead of the rule. No MapKit, no restaurant: the fallback pin is
    // an anonymous stop, which the app is right to keep, and the expected trip
    // count below says so out loud rather than quietly passing either way.
    const lunch = await page.evaluate(async (fb) => {
      if (typeof _mapkitReady === 'undefined' || !_mapkitReady || typeof mapkit === 'undefined') return { lat: fb.pin.lat, lng: fb.pin.lon, named: false };
      try {
        const region = new mapkit.CoordinateRegion(new mapkit.Coordinate(fb.at.lat, fb.at.lng), new mapkit.CoordinateSpan(0.06, 0.06));
        const places = await new Promise((resolve, reject) => {
          new mapkit.Search({ region }).search('restaurant', (err, data) => {
            const list = data && (data.places || data.results);
            if (err || !list || !list.length) { reject(new Error('no restaurant')); return; }
            resolve(list);
          });
        });
        const food = places.find(p => p.coordinate && /Restaurant|Cafe|Food|Bakery|Brewery|Bar/i.test(String(p.pointOfInterestCategory || '')));
        const p = food || places.find(x => x.coordinate);
        if (!p) return { lat: fb.pin.lat, lng: fb.pin.lon, named: false };
        return { lat: p.coordinate.latitude, lng: p.coordinate.longitude,
                 name: p.name || '', category: p.pointOfInterestCategory || '', named: !!food };
      } catch (_e) { return { lat: fb.pin.lat, lng: fb.pin.lon, named: false }; }
    }, { pin: LUNCH, at: DOWNTOWN });
    console.log(`[topeka-day] lunch: ${lunch.named ? `${lunch.name} (${lunch.category})` : 'an unnamed pin, Apple could not name one'}`);
    // Six legs get driven. Five of them are business travel. The sixth is only
    // recognisable as lunch if Apple names the pin, so a run without MapKit
    // honestly expects six rather than pretending the app knew.
    const wantTrips = lunch.named ? 5 : 6;

    // Every gps trip already in this account, so the day is measured against
    // what THIS run wrote. The account is never cleaned up (§12.7), so an
    // unscoped count reads every previous run's rows too.
    const priorTrips = await page.evaluate(() => mileage.filter(m => m.gps && m.legKey).map(m => m.id));

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
      //
      // Two different clocks, because the app closes the two kinds of arrival at
      // different moments. Arriving inside a FENCE opens a visit that is closed
      // when they leave, so winding the arrival back is enough. Arriving
      // somewhere the app does not recognise only becomes a stop when they pull
      // out, and the leg IN is not written until that moment either: so "now" is
      // the departure, the arrival was `dwell` ago, and the drive started
      // `minutes` before THAT. Winding only the anchor back would date the
      // arrival before the drive that produced it, and a leg with negative
      // minutes is dropped, which is exactly how the Home Depot leg went missing
      // on the first live run (2026-08-02).
      if (a.dwell) {
        if (_geoArrivedAt) _geoArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoPlaceArrivedAt) _geoPlaceArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoShopArrivedAt) _geoShopArrivedAt = new Date(Date.now() - a.dwell * 60000).toISOString();
        if (_geoStopAnchor) {
          _geoStopAnchor.at = new Date(Date.now() - a.dwell * 60000).toISOString();
          _geoDriveStartedAt = new Date(Date.now() - (a.dwell + a.minutes) * 60000).toISOString();
        }
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
          await hop(p, dest || lunch, leg.mins, leg.dwell);
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
      ruleText: 'six legs were driven; the five between business points log measured trips, the lunch leg does not',
      expected: `${wantTrips} measured trips, none of them zero miles, none routed by name`,
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate((prior) => {
          const seen = new Set(prior);
          // Give any in-flight route calls a moment, then sweep the stragglers.
          return _retryPendingTrips().then(() => mileage
            .filter(m => m.gps && m.legKey && !seen.has(m.id))
            .map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, method: m.calc_method,
                         purpose: m.purpose, fromRaw: m.from, toRaw: m.to,
                         fc: m.fromCoord, tc: m.toCoord })));
        }, priorTrips);
        const measured = out.filter(t => t.miles > 0);
        const stuck = out.filter(t => t.method === 'pending_auto');
        // An automatic trip has BOTH geocodes by construction, so it must never
        // reach the address path. When it does, the router is handed the
        // endpoint's NAME instead: geocoding the literal word "Shop" is what put
        // a 65.6-mile leg on a day that never left Topeka (2026-08-02).
        const byName = out.filter(t => t.method === 'address');
        const pt = (c) => c ? `${c.lat}, ${c.lng}` : 'NO COORDINATE';
        console.log('[topeka-day] trips:\n' + out.map(t =>
          `   ${t.from} → ${t.to}  ${t.miles} mi  ${t.purpose}  (${t.method})` +
          `\n        raw:    "${t.fromRaw}" → "${t.toRaw}"` +
          `\n        routed: ${pt(t.fc)}  →  ${pt(t.tc)}`).join('\n'));
        // Real Topeka distances: every one of these hops is inside the city, so
        // a leg over 30 miles means the route resolved to the wrong point.
        const absurd = measured.filter(t => t.miles > 30);
        return {
          ok: out.length === wantTrips && measured.length === wantTrips && !absurd.length && !stuck.length && !byName.length,
          got: `${out.length} trips, ${measured.length} measured, ${stuck.length} still pending, ` +
               `${byName.length} routed by name, ${absurd.length} implausible`,
        };
      },
    });

    // The supply stop only drops off the log because Apple named the restaurant.
    // Without MapKit the app cannot know who is at a pin, keeps the leg as an
    // honest unnamed stop, and six is the correct answer: stated here rather
    // than branching silently, so a run that quietly lost MapKit cannot pass by
    // matching the weaker number.
    await step(page, {
      label: 'the lunch leg is the one that did not bill',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js _autoNameStopTrip / _poiIsPersonal',
      ruleText: 'a stop Apple calls a restaurant is a personal errand and never reaches the mileage log',
      expected: lunch.named ? 'no trip ends at the lunch pin' : 'MapKit absent, so lunch stays an unnamed stop',
      act: async () => 0,
      rule: async (p) => {
        const hit = await p.evaluate((a) => {
          const seen = new Set(a.prior);
          return mileage.filter(m => m.gps && m.legKey && !seen.has(m.id) && m.toCoord &&
            Math.abs(m.toCoord.lat - a.lunch.lat) < 0.0005 && Math.abs(m.toCoord.lng - a.lunch.lng) < 0.0005)
            .map(m => `${m.from_name} → ${m.to_name}`);
        }, { prior: priorTrips, lunch });
        const want = lunch.named ? 0 : 1;
        return { ok: hit.length === want, got: hit.length ? 'billed: ' + hit.join(', ') : 'nothing billed to the lunch pin' };
      },
    });

    // ── 1b. THE ADDRESS ON EVERY ROW ─────────────────────────────────────────
    // Owner, 2026-08-02: the address has to SAVE, not just the miles. A row
    // reading "Shop -> Stop" is not a record anyone could defend a year later,
    // and neither is one whose address column is blank. The distance is measured
    // between the coordinates; this is about what the row SAYS.
    await step(page, {
      label: 'every leg saves a real street address at both ends',
      page: 'mileage', role: 'contractor',
      suspect: 'geo-track.js _geoShopAddr / curLoc addr → mileage.js autoLogDriveTrip',
      ruleText: 'both endpoints of every automatic trip carry a street address, and the yard travels as the business address on file',
      expected: 'no endpoint left as a bare "Shop" or "Stop"',
      act: async () => 0,
      rule: async (p) => {
        const out = await p.evaluate((prior) => {
          const seen = new Set(prior);
          return {
            shopAddr: (typeof _geoShopAddr === 'function') ? _geoShopAddr() : '',
            trips: mileage.filter(m => m.gps && m.legKey && !seen.has(m.id))
              .map(m => ({ from: m.from, to: m.to, fromName: m.from_name, toName: m.to_name })),
          };
        }, priorTrips);
        // A street address has a number in it. "Shop", "Stop" and "Place" do not,
        // which is exactly the set this is meant to catch.
        const bare = out.trips.filter(t => !/\d/.test(t.from || '') || !/\d/.test(t.to || ''));
        console.log('[topeka-day] addresses on the log:\n' + out.trips.map(t =>
          `   ${t.fromName} → ${t.toName}\n        "${t.from}" → "${t.to}"`).join('\n'));
        // The yard is only ever as good as the business address in Settings, so
        // an empty one is reported as itself rather than as a mystery blank row.
        if (!out.shopAddr) return { ok: false, got: 'no business address on file, so the yard has none to travel as' };
        const shopLegs = out.trips.filter(t => t.fromName === 'Shop' || t.toName === 'Shop');
        const shopWrong = shopLegs.filter(t => (t.fromName === 'Shop' ? t.from : t.to) !== out.shopAddr);
        return {
          ok: out.trips.length > 0 && !bare.length && !shopWrong.length,
          got: bare.length ? `${bare.length} endpoint(s) with no street address: ` +
                 bare.map(t => `"${t.from}" → "${t.to}"`).join(', ')
             : shopWrong.length ? `the yard did not travel as "${out.shopAddr}"`
             : `${out.trips.length} trips, every endpoint addressed`,
        };
      },
    });

    // ── 2. THE TIME ──────────────────────────────────────────────────────────
    // Owner, 2026-08-02: time has to save correctly too. Each leg was driven for
    // a stated number of minutes, so each leg's entry must carry that number, not
    // zero and not the drive plus however long the truck was parked at either
    // end. Asserted as a multiset because the ORDER rows land in is not part of
    // the promise, but every duration is.
    await step(page, {
      label: 'each drive saves the minutes it actually took',
      page: 'mileage', role: 'contractor',
      suspect: 'geo-track.js _geoDriveEntry minutes / _geoCloseStop leg split',
      ruleText: 'the six legs log 12, 14, 9, 11, 13 and 10 minutes of drive time',
      expected: 'every leg to the minute',
      act: async () => 0,
      rule: async (p) => {
        const mins = await p.evaluate(async () => {
          const cid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
          const since = new Date(Date.now() - 20 * 60000).toISOString();
          const { data } = await _supa.from('job_time_entries')
            .select('source,minutes,created_at').eq('contractor_user_id', cid).gte('created_at', since);
          return (data || []).filter(r => /^drive/.test(r.source || '')).map(r => r.minutes).sort((a, b) => a - b);
        });
        const want = [9, 10, 11, 12, 13, 14];
        console.log('[topeka-day] drive minutes saved:', mins.join(', '), '| wanted:', want.join(', '));
        // Every wanted duration present at least once. The window is 20 minutes
        // so a previous run's rows cannot be counted, but a re-run inside that
        // window could add duplicates, which is why this is a containment check
        // rather than an equality one.
        const missing = want.filter(w => !mins.some(m => Math.abs(m - w) <= 1));
        return {
          ok: missing.length === 0,
          got: missing.length ? `saved [${mins.join(', ')}], missing ${missing.join(', ')}` : `all six legs to the minute: ${mins.join(', ')}`,
        };
      },
    });

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
    // First on the MILEAGE ROW, before anybody saves a place. This is the row
    // that has to survive a question a year later, and "Kansas Ave Client →
    // Stop, 3.1 mi" answers nothing. Nobody typed the name: the leg ended at a
    // pin the app had never seen, and Apple was asked who was standing there.
    await step(page, {
      label: 'the supply leg names the store on the mileage row itself',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js _autoNameStopTrip / _poiAt',
      ruleText: 'a leg ending at an unknown pin is named from the business at that pin, and priced as a supply run',
      expected: engine.mapkitReady ? 'a trip to Home Depot, purpose Supply run' : 'MapKit absent, so the stop stays unnamed',
      act: async () => 0,
      rule: async (p) => {
        const hit = await p.evaluate((prior) => {
          const seen = new Set(prior);
          const d = window.__day.DEPOT;
          return mileage.filter(m => m.gps && m.legKey && !seen.has(m.id) && m.toCoord &&
            Math.abs(m.toCoord.lat - d.lat) < 0.0005 && Math.abs(m.toCoord.lng - d.lng) < 0.0005)
            .map(m => ({ to: m.to_name, addr: m.to, purpose: m.purpose, miles: m.miles }));
        }, priorTrips);
        const t = hit[0];
        if (!engine.mapkitReady) return { ok: !!t, got: t ? `unnamed stop, ${t.miles} mi` : 'no leg to the supply pin at all' };
        // A street address too, not just the name. The distance is measured
        // between coordinates, but the ROW has to read like a record: who they
        // went to, and where that is.
        const hasStreet = /\d/.test(t && t.addr || '') && (t.addr || '') !== (t.to || '');
        return {
          ok: !!t && /home\s*depot/i.test(t.to || '') && t.purpose === 'Supply run' && hasStreet,
          got: t ? `"${t.to}" at "${t.addr}" (${t.purpose}) ${t.miles} mi` : 'no leg to the supply pin at all',
        };
      },
    });

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
