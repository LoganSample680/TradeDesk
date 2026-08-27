// LIVE verification (owner ask 2026-08-17): before the owner wipes their real
// account via "Clear all data" and starts fresh, confirm on the TRUE
// independent dev account (tradedeskprosupport@gmail.com, no longer employee-
// linked to anyone, per tonight's team_members delete) that a Clear All Data
// leaves nothing behind: no cloud rows, no armed fence, no local
// stop-detection state. Two real gaps were just fixed and need proving live,
// not just in the offline shards:
//
//   1. team_members severance (settings.js _clearTeamLinksCloud) - this run
//      itself is proof: if Dev2 were still linked, _isEmployee would read
//      true and businessName would read "DEV A" again.
//   2. stopGeoTracking() + local stop-detection state (zp3_place_stops,
//      zp3_place_day_anchor) now torn down by clearAllData(), previously only
//      by sign-out. "The John Doe geo fence" outliving John Doe was this gap.
//
// This seeds real rows into the dev account and leaves NOTHING behind
// (clearAllData IS the teardown here, per §12.7 "no unless it's the point").
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, cloudRows } = require('./live-helpers');

test.describe('Live: Clear all data disarms everything, no bleed-over', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test('fresh account after clearAllData: no cloud rows, no fence, no local stop state', async ({ page }) => {
    await signIn(page);
    await page.waitForTimeout(1500);

    // ── 0. Confirm this login is genuinely independent now, not employee-linked ──
    const identity = await page.evaluate(() => ({
      isEmployee: typeof _isEmployee !== 'undefined' ? _isEmployee : null,
      contractorUserId: typeof _contractorUserId !== 'undefined' ? _contractorUserId : null,
    }));
    expect(identity.isEmployee, 'Dev2 must no longer be employee-linked after the team_members delete').toBeFalsy();

    // ── 1. Seed a client + job (with an address to geocode into _geoJobCoords) ──
    const seedTag = 'fence-verify-' + Date.now();
    await page.evaluate(async ({ seedTag }) => {
      const cid = Date.now() * 1000 + 1;
      clients.push({ id: cid, name: 'John Doe ' + seedTag, addr: '200 E William St, Wichita, KS 67202', source: 'Referral' });
      const jid = Date.now() * 1000 + 2;
      jobs.push({ id: jid, client_id: cid, client_name: 'John Doe ' + seedTag, name: 'Fence verify job', addr: '200 E William St, Wichita, KS 67202', start: todayKey() });
      savePlace({ name: 'Fence Verify Place ' + seedTag, kind: 'supply', lat: 37.6889, lon: -97.3361 });
      // Populate the job-coordinate cache and the local repeated-stop detector
      // directly, the exact state stopGeoTracking()/clearAllData must clear.
      if (typeof _geoJobCoords !== 'undefined') _geoJobCoords[jid] = { lat: 37.6889, lng: -97.3361, src: 'test' };
      localStorage.setItem('zp3_place_stops', JSON.stringify([{ lat: 37.6889, lon: -97.3361, n: 3 }]));
      localStorage.setItem('zp3_place_day_anchor', JSON.stringify({ lat: 37.6889, lon: -97.3361, day: todayKey() }));
      if (typeof _flushSaveNow === 'function') await _flushSaveNow(); else saveAll();
    }, { seedTag });
    await page.waitForTimeout(1500);

    // Confirm the seed actually landed in the cloud before testing the wipe.
    const seededRows = await cloudRows(page, 'td_clients');
    const seedLanded = seededRows.some(r => (r.name || '').includes(seedTag));
    expect(seedLanded, 'seed client must land in the cloud before clearAllData can be tested against it').toBe(true);

    // ── 2. Run the real clearAllData(), auto-confirming its two prompts ──────
    await page.evaluate(async () => {
      window.__origZConfirm = window.zConfirm;
      window.zConfirm = (_msg, onYes) => { try { onYes && onYes(); } catch (e) {} };
      clearAllData();
      // clearAllData's confirmed callback is async end to end (flush, crew
      // cloud clear, team links clear); give it real time against the real
      // backend, not the offline suite's 50ms.
      await new Promise(r => setTimeout(r, 4000));
      window.zConfirm = window.__origZConfirm;
    });
    await page.waitForTimeout(1500);

    // ── 3. Verify: cloud is empty, fence is disarmed, local state is gone ────
    const [clientRows, jobRows, placeRows, local] = await Promise.all([
      cloudRows(page, 'td_clients'),
      cloudRows(page, 'td_jobs'),
      cloudRows(page, 'td_places'),
      page.evaluate(() => ({
        geoJobCoordsEmpty: typeof _geoJobCoords === 'undefined' || Object.keys(_geoJobCoords).length === 0,
        stopsCleared: localStorage.getItem('zp3_place_stops') === null,
        anchorCleared: localStorage.getItem('zp3_place_day_anchor') === null,
      })),
    ]);

    expect(clientRows.length, 'no clients should survive Clear all data').toBe(0);
    expect(jobRows.length, 'no jobs should survive Clear all data').toBe(0);
    expect(placeRows.length, 'no places should survive Clear all data').toBe(0);
    expect(local.geoJobCoordsEmpty, '_geoJobCoords must be cleared, or a deleted job keeps fencing').toBe(true);
    expect(local.stopsCleared, 'zp3_place_stops must be cleared, local-only bookkeeping the array wipe never reaches').toBe(true);
    expect(local.anchorCleared, 'zp3_place_day_anchor must be cleared').toBe(true);
  });
});
