// REAL flow — the mileage/drive logger (task #7 remainder): drive the actual
// End-Drive modal and its save path (mileage.js showEndDrive → saveEndDriveModal),
// which is where the IRS-deductible trip is written. We seed the in-flight `gps`
// trip state directly rather than going through confirmStartDrive(), because the
// start path fires an SMS "on my way" redirect + a GPS capture that can't run
// headless — the data-writing half is the part under test. mileage.unshift rows
// round-trip through td_mileage, so the save proves the write path end-to-end.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, type, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'mileage/log-drive';

test.describe('mileage drive logger (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('log a deductible trip through the End-Drive modal', async ({ page }) => {
    const stamp = process.pid;
    const clientId = Date.now() * 1000 + (stamp % 1000);
    const cName = `E2E Drive Client ${stamp}`;

    await step(page, {
      label: 'end an in-flight drive and save the miles', page: 'pg-mileage', role: 'contractor',
      suspect: 'mileage.js saveEndDriveModal (mileage.unshift + _flushSaveNow)',
      ruleText: 'saving the End-Drive modal must record a mileage row for the client with miles>0',
      expected: `a mileage row for "${cName}", 12.4 mi, calc_method gps_time`,
      act: async (p) => {
        await p.evaluate(({ clientId, cName }) => {
          // Seed a phone-less client (no SMS redirect) and an active trip mid-drive.
          clients.push({ id: clientId, name: cName, _e2e: 'mileage' });
          gps.active = true; gps.vehicle = 'E2E Truck'; gps.purpose = 'Work drive';
          gps.clientId = clientId; gps.clientName = cName;
          gps.startTime = Date.now() - 10 * 60000; gps.startCoords = { lat: 37.6872, lon: -97.3301 };
          showEndDrive();                                  // 1 tap — open End-Drive modal
        }, { clientId, cName });
        await p.waitForSelector('#end-miles-modal', { timeout: 10000 });
        // showEndDrive() runs a 100ms setTimeout that focus()+select()s this input (so the user
        // can overtype the GPS-estimate prefill). Let that auto-select fire FIRST — if it lands
        // mid-typing it select-all-replaces the partial value (e.g. "12" → "." → ".4" = 0.4).
        await p.waitForTimeout(150);
        const k = await type(p, '#end-miles-modal', '12.4'); // real keystrokes
        await p.evaluate(() => { saveEndDriveModal(); });    // 1 tap — Save trip
        await p.waitForTimeout(700);
        await p.evaluate(async () => { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); });
        return 1 + k + 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ clientId }) => {
          const m = (mileage || []).find(x => x.client_id === clientId);
          return m ? { miles: m.miles, method: m.calc_method, active: gps.active } : null;
        }, { clientId });
        // TRUE end-to-end: the trip must also be in the cloud (td_mileage), not just
        // the in-memory mileage[] array.
        const cloud = await cloudRows(p, 'td_mileage');
        const cm = cloud.find(m => String(m.client_id) === String(clientId));
        const cloudOk = !!cm && cm.miles === 12.4;
        const memOk = !!r && r.miles === 12.4 && r.method === 'gps_time' && r.active === false;
        return { ok: memOk && cloudOk, got: `mem=${JSON.stringify(r)} cloudMiles=${cm ? cm.miles : 'ROW ABSENT'}` };
      },
    });

    // NO cleanup — the mileage row + client stay in the dev account on purpose so
    // the owner can inspect what this test created (CLAUDE.md §13.7).

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
