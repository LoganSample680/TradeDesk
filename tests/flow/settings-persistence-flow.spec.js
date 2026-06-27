// REAL flow — settings persistence across a hard reboot (task #8, and the live
// companion to tests/e2e-mmt-persistence-regression.spec.js). This is the
// abusive version of the goal + location persistence fix: it drives the actual
// Settings form, saves to the REAL cloud, then DELETES the local zp3_S cache and
// reloads the page so the only way the values can come back is from Supabase.
//
// If the cloud strip (the original bug) ever returns, or the goal/location write
// stops bumping settingsTs, the post-reboot assertion fails with a finding().
//
//   suspect chain: settings.js saveSettings (settingsTs bump) → cloud.js
//   supaSaveToCloud (must NOT strip location) → cloud.js _mergeIncomingSettings.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, type, tap } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'settings/persist-across-reboot';

// Wait for the app to finish booting + the cloud settings load after a reload.
// The Supabase auth token lives under its own localStorage key (sb-*-auth-token),
// so wiping zp3_S keeps the session — the app re-auths itself and loads from cloud.
async function waitReboot(page) {
  await page.waitForFunction(() => typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id, { timeout: 30000 });
  await page.waitForFunction(() => typeof _supaCloudLoaded === 'undefined' || _supaCloudLoaded === true, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
}

test.describe('settings persistence (UI-driven, real reboot)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('goal + location survive a cloud-only reboot (zp3_S wiped)', async ({ page }) => {
    // A unique goal value so we can prove THIS run wrote it (not a stale value).
    // Kept deterministic per process via pid so concurrent viewports don't collide.
    const newGoal = 7000 + (process.pid % 900);

    // Remember the original goal so we can restore it at the end (no data loss).
    const original = await page.evaluate(() => ({ goal: S.goalMonthly || 0, locG: !!S.locationGranted, locD: !!S.locationDenied, ts: S.settingsTs || 0 }));

    await step(page, {
      label: 'set monthly goal in Settings + simulate location granted, then Save',
      page: 'pg-set', role: 'contractor',
      suspect: 'settings.js saveSettings (goalMonthly harvest + settingsTs bump)',
      ruleText: 'saving Settings must persist the new goal and bump settingsTs',
      expected: `S.goalMonthly=${newGoal}, S.locationGranted=true, settingsTs increased`,
      act: async (p) => {
        await p.evaluate(() => { goPg('pg-set'); });       // 1 tap — open Settings (fills the form)
        await p.waitForSelector('#set-goal-monthly', { timeout: 10000 });
        const k = await type(p, '#set-goal-monthly', String(newGoal)); // real key-by-key typing
        // Simulate the outcome of a granted OS location prompt (the dialog itself
        // can't run headless). The grant path sets these flags; saveSettings then
        // pushes the full S — including the now-unstripped location flags — to cloud.
        await p.evaluate(() => { S.locationGranted = true; S.locationDenied = false; });
        await p.evaluate(() => { saveSettings(); });        // 1 tap — Save button
        await p.waitForTimeout(1200);                       // let supaSaveToCloud land
        return k + 2;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ tsBefore }) => ({
          goal: S.goalMonthly, locG: !!S.locationGranted, bumped: (S.settingsTs || 0) > tsBefore,
        }), { tsBefore: original.ts });
        return { ok: r.goal === newGoal && r.locG === true && r.bumped, got: JSON.stringify(r) };
      },
    });

    await step(page, {
      label: 'wipe local zp3_S cache and hard-reload (cloud is the only source)',
      page: 'reboot', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud strip + _mergeIncomingSettings precedence',
      ruleText: 'after a cloud-only reboot the goal AND the location flag must come back',
      expected: `goalMonthly=${newGoal} and locationGranted=true restored from Supabase`,
      act: async (p) => {
        // Delete ONLY the settings cache — the auth session token survives, so the
        // reboot re-authenticates and the values can come back from Supabase alone.
        await p.evaluate(() => { try { localStorage.removeItem('zp3_S'); localStorage.removeItem('zp3_logo'); } catch (e) {} });
        await p.reload({ waitUntil: 'domcontentloaded' });  // a real reboot
        await waitReboot(p);
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({ goal: S.goalMonthly, locG: !!S.locationGranted, locD: !!S.locationDenied }));
        // The goal must survive (BUG1a) and the location-granted flag must survive
        // the cloud round-trip (BUG1b — it used to be stripped from the payload).
        return { ok: r.goal === newGoal && r.locG === true, got: JSON.stringify(r) };
      },
    });

    // NO cleanup/restore — the test leaves the new goal + location-granted flag on
    // the dev account on purpose so the owner can confirm persistence by hand
    // (CLAUDE.md §13.7). The owner resets the goal manually if desired.

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
