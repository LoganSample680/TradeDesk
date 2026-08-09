// @ts-check
// ── Tapping Drive while the geofence is already watching ────────────────────
//
// Owner (2026-08-02): "starting a manual drive between two geocodes should
// always save the geocode length."
//
// Two things are measuring the same truck. The geofence runs geocode to geocode
// across the whole journey and Apple measures it. The Drive button captures
// whatever the contractor remembered to tap through, with the miles typed at the
// end. When both describe the same drive there must be exactly ONE row, because
// two is a double deduction, and it must be the measured one, because a number
// typed from memory is not the record anyone would want to defend.
//
// The hard case is tapping MID-drive. The leg began before the tap and closed
// after it, so arrival times alone call it a different journey; only the leg's
// START settles it. An earlier version of this got it backwards and threw the
// measured row away, which is the whole reason this spec exists rather than
// living only in the offline suite.
//
// The drive itself is real: pings through the geofence against the real backend,
// with Apple measuring the distance. Only the Drive button's state is set
// directly, because its UI lives on the client detail page and the thing under
// test is which ROW survives, not how the button is styled.
const { test, expect } = require('@playwright/test');
const { signIn, step, report, resetLedger } = require('./live-helpers');

const FLOW = 'manual-drive';
const BASELINE = require('./perf-baseline.json');

const SHOP = '2015 SW Randolph Ave, Topeka, KS 66604';
const JOB  = '309 S Kansas Ave, Topeka, KS';

test.describe('The Drive button against the geofence', () => {
  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('starting a drive mid-journey still saves the measured geocode length', async ({ page }) => {
    const runTag = Date.now();

    await step(page, {
      label: 'set up the yard and the job',
      page: 'geo', role: 'contractor',
      suspect: 'mileage.js _resolveCoords',
      ruleText: 'both ends of the drive must resolve',
      expected: 'two coordinates',
      act: async (p) => {
        await p.evaluate(async (a) => {
          window.__md = {};
          for (const [k, addr] of Object.entries(a.addrs)) window.__md[k] = await _resolveCoords(addr);
          S.teamTracking = true;
          const s = window.__md.SHOP;
          if (s) { S.officeLat = s.lat; S.officeLon = s.lng; }
          S.baddr = '2015 SW Randolph Ave'; S.bcity = 'Topeka'; S.state = 'KS'; S.bzip = '66604';
          const j = window.__md.JOB;
          clients.push({ id: a.tag + 1, name: 'Manual Drive Client ' + a.tag, addr: a.addrs.JOB });
          jobs.push({ id: a.tag + 2, name: 'Panel work ' + a.tag, eventType: 'job', status: 'upcoming',
                      start: todayKey(), days: 1, client_id: a.tag + 1, addr: a.addrs.JOB,
                      lat: j && j.lat, lon: j && j.lng });
          saveAll();
        }, { addrs: { SHOP, JOB }, tag: runTag });
        return 0;
      },
      rule: async (p) => {
        const d = await p.evaluate(() => window.__md);
        const missing = Object.entries(d).filter(([, v]) => !v || v.lat == null).map(([k]) => k);
        return { ok: !missing.length, got: missing.length ? 'unresolved: ' + missing.join(',') : 'both resolved' };
      },
    });

    const engine = await page.evaluate(() => ({
      mapkitReady: typeof _mapkitReady !== 'undefined' && !!_mapkitReady,
      host: location.hostname,
    }));
    console.log(`[manual-drive] routing engine: ${engine.mapkitReady ? 'MapKit (Apple Maps)' : 'Valhalla/OSRM fallback'} on ${engine.host}`);

    // EVERY id, not just the automatic ones. The account is never cleaned up
    // (CLAUDE.md 12.7), and a snapshot of only gps rows made every hand-entered
    // trip from every previous run look new to the final check: the first live
    // run reported six rows for a one-leg drive, five of them months old.
    const priorTrips = await page.evaluate(() => mileage.map(m => m.id));

    // ── Pull out of the yard, tap Drive ten minutes in, arrive ──────────────
    await step(page, {
      label: 'leave the yard, tap Drive part-way, arrive at the job',
      page: 'geo', role: 'contractor',
      suspect: 'geo-track.js _geoOnPing → mileage.js autoLogDriveTrip',
      ruleText: 'the geofence logs the whole leg even though a manual drive was started part-way through it',
      expected: 'one automatic trip, measured yard to job',
      act: async (p) => {
        await p.evaluate(async () => {
          _geoCurrentJob = null; _geoArrivedAt = null; _geoWasInShop = false;
          _geoShopArrivedAt = null; _geoDriveStartedAt = null;
          _geoCurrentPlace = null; _geoPlaceArrivedAt = null; _geoStopAnchor = null;
          _geoLastFenceAt = null; _geoLegAtShop = false;
          _geoLastFenceLoc = null; _geoLegOrigin = null;
          gps.active = false; gps.startTime = null;
          const s = window.__md.SHOP;
          await _geoOnPing({ coords: { latitude: s.lat, longitude: s.lng, accuracy: 8 } });
        });
        // On the road, and the leg clock wound back so it reads as 22 minutes.
        await p.evaluate(async () => {
          await _geoOnPing({ coords: { latitude: 39.9, longitude: -96.9, accuracy: 8 } });
          if (_geoDriveStartedAt) _geoDriveStartedAt = new Date(Date.now() - 22 * 60000).toISOString();
          if (_geoLastFenceAt) _geoLastFenceAt = new Date(Date.now() - 22 * 60000).toISOString();
        });
        // THE TAP, twelve minutes into a twenty-two minute drive.
        await p.evaluate(() => {
          gps.active = true;
          gps.startTime = Date.now() - 12 * 60000;
          gps.vehicle = (getVehicles()[0] || {}).name || 'Truck';
          gps.purpose = 'Job site';
          gps.clientId = null;
        });
        // Arrive.
        await p.evaluate(async () => {
          const j = window.__md.JOB;
          await _geoOnPing({ coords: { latitude: j.lat, longitude: j.lng, accuracy: 8 } });
        });
        return 1;   // the one tap: starting the drive
      },
      rule: async (p) => {
        const out = await p.evaluate((prior) => {
          const seen = new Set(prior);
          return mileage.filter(m => m.gps && m.legKey && !seen.has(m.id))
            .map(m => ({ from: m.from_name, to: m.to_name, miles: m.miles, method: m.calc_method, started: !!m.startedIso }));
        }, priorTrips);
        console.log('[manual-drive] after arriving:\n' + out.map(t =>
          `   ${t.from} → ${t.to}  ${t.miles} mi  (${t.method})`).join('\n'));
        const t = out[0];
        // Suppressing this row was the old behaviour and the bug: the measured
        // leg has to exist before End Drive can prefer it.
        return {
          ok: out.length === 1 && !!t && t.miles > 0 && t.method === 'auto_route' && t.started,
          got: out.length === 1 && t ? `${t.from} → ${t.to} ${t.miles} mi (${t.method}), leg start recorded: ${t.started}`
             : `${out.length} automatic trips, expected exactly one`,
        };
      },
    });

    // ── End Drive, typing a number that only covers the tail ────────────────
    await step(page, {
      label: 'end the drive and type the miles they remember',
      page: 'mileage', role: 'contractor',
      suspect: 'mileage.js saveEndDriveModal duplicate resolution',
      ruleText: 'the measured geocode-to-geocode row survives and the typed number does not become a second trip',
      expected: 'still one trip, still the measured distance',
      act: async (p) => {
        await p.evaluate(() => {
          document.getElementById('end-miles-modal')?.remove();
          const inp = document.createElement('input');
          inp.id = 'end-miles-modal';
          inp.value = '3';            // the tail of the drive, from memory
          document.body.appendChild(inp);
          saveEndDriveModal();
          inp.remove();
        });
        return 1;   // the second tap: ending the drive
      },
      rule: async (p) => {
        const out = await p.evaluate((prior) => {
          const seen = new Set(prior);
          const mine = mileage.filter(m => !seen.has(m.id));
          return {
            rows: mine.map(m => ({ miles: m.miles, method: m.calc_method })),
            driveRunning: !!gps.active,
          };
        }, priorTrips);
        console.log('[manual-drive] after End Drive:\n' + out.rows.map(t =>
          `   ${t.miles} mi  (${t.method})`).join('\n'));
        const typed = out.rows.filter(t => t.method === 'gps_time');
        const measured = out.rows.filter(t => t.method === 'auto_route');
        return {
          ok: out.rows.length === 1 && measured.length === 1 && !typed.length &&
              measured[0].miles > 3 && !out.driveRunning,
          got: `${out.rows.length} row(s): ${out.rows.map(t => `${t.miles} mi ${t.method}`).join(', ')}` +
               (out.driveRunning ? ' · drive still running' : ''),
        };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
