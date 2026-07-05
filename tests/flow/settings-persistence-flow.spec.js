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
const { test, expect } = require('./flow-test');
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
    // A fixed goal (NOT per-pid): settings live in ONE zj_data row keyed only by
    // user_id, so the 3 viewport projects (mobile/tablet/desktop) share it. A pid-
    // unique goal made them clobber each other's value and read back the wrong one.
    // A constant means every project writes/reads the same value — this run still
    // wrote it, so persistence is proven without the shared-row collision.
    const newGoal = 7727;

    // Remember the original goal so we can restore it at the end (no data loss).
    const original = await page.evaluate(() => ({ goal: S.goalMonthly || 0, locG: !!S.locationGranted, locD: !!S.locationDenied, ts: S.settingsTs || 0 }));

    await step(page, {
      label: 'set monthly goal in Settings + simulate location granted, then Save',
      page: 'pg-set', role: 'contractor',
      suspect: 'settings.js saveSettings (goalMonthly harvest + settingsTs bump)',
      ruleText: 'saving Settings must persist the new goal and bump settingsTs',
      expected: `S.goalMonthly=${newGoal}, S.locationGranted=true, settingsTs increased`,
      act: async (p) => {
        // Settings is a master→detail layout: goPg shows the index, and the goal
        // field lives inside the collapsed "Rates & pricing" detail panel
        // (#setd-rates). Open that detail — exactly the row a user taps — before the
        // field is reachable.
        await p.evaluate(() => { goPg('pg-settings'); if (typeof _openSetDetail === 'function') _openSetDetail('rates'); });
        await p.waitForSelector('#set-goal-monthly', { state: 'visible', timeout: 10000 });
        const k = await type(p, '#set-goal-monthly', String(newGoal)); // real key-by-key typing
        // Simulate the outcome of a granted OS location prompt (the dialog itself
        // can't run headless). The grant path sets these flags; saveSettings then
        // pushes the full S — including the now-unstripped location flags — to cloud.
        await p.evaluate(() => { S.locationGranted = true; S.locationDenied = false; });
        // Save, then deterministically confirm the goal LANDS in the cloud zj_data row
        // before the test reboots. saveSettings() fires supaSaveToCloud() but does NOT
        // await it, so on the contended local stack the upsert was still in flight when the
        // reboot wiped zp3_S + reloaded (cancelling it) → cloud kept goal=0. We explicitly
        // await the cloud push here, then poll the real cloud value (a real awaited loop —
        // not waitForFunction, whose async predicate returns a truthy Promise immediately).
        // Captures the save-path guard state so a non-persist fails LOUDLY with the cause.
        original.saveDiag = await p.evaluate(async ({ want }) => {
          saveSettings();
          let saveErr = '';
          try { if (typeof supaSaveToCloud === 'function') await supaSaveToCloud(); } catch (e) { saveErr = (e && e.message) || String(e); }
          let cloudGoal = null, cloudErr = '';
          for (let i = 0; i < 24; i++) {
            try {
              const { data, error } = await _supa.from('zj_data').select('settings').eq('user_id', _supaUser.id).maybeSingle();
              if (error) cloudErr = error.message || error.code || 'err';
              else cloudGoal = (JSON.parse((data && data.settings) || '{}')).goalMonthly ?? null;
            } catch (e) { cloudErr = 'ex:' + (e && e.message); }
            if (cloudGoal === want) break;
            await new Promise(r => setTimeout(r, 500));
          }
          return {
            cloudGoal, cloudErr, saveErr,
            cloudLoaded: (typeof _supaCloudLoaded !== 'undefined') ? _supaCloudLoaded : '?',
            fromCache: (typeof _loadedFromCacheOnly !== 'undefined') ? _loadedFromCacheOnly : '?',
          };
        }, { want: newGoal });
        return k + 3; // open settings + open rates detail + save
      },
      rule: async (p) => {
        const r = await p.evaluate(({ tsBefore }) => ({
          goal: S.goalMonthly, locG: !!S.locationGranted, bumped: (S.settingsTs || 0) > tsBefore,
        }), { tsBefore: original.ts });
        const sd = original.saveDiag || {};
        // HARD-gate on the cloud actually carrying the goal — that's the whole point of the
        // reboot test. sd surfaces the save-time guard state (cloudLoaded=false ⇒ save no-op'd;
        // fromCache=true ⇒ sanity-abort; saveErr ⇒ exception) so a non-persist names its cause.
        return {
          ok: r.goal === newGoal && r.locG === true && r.bumped && sd.cloudGoal === newGoal,
          got: JSON.stringify({ ...r, ...sd }),
        };
      },
    });

    await step(page, {
      label: 'wipe local zp3_S cache and hard-reload (cloud is the only source)',
      page: 'reboot', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud strip + _mergeIncomingSettings precedence',
      ruleText: 'after a cloud-only reboot the goal AND the location flag must come back',
      expected: `goalMonthly=${newGoal} and locationGranted=true restored from Supabase`,
      act: async (p) => {
        // Confirm the cloud STILL has the goal right BEFORE the reboot (step 1 left it 7727).
        const preReboot = await p.evaluate(async () => {
          try { const { data } = await _supa.from('zj_data').select('settings').eq('user_id', _supaUser.id).maybeSingle(); return (JSON.parse((data && data.settings) || '{}')).goalMonthly ?? null; } catch (e) { return 'err:' + (e && e.message); }
        });
        // Delete ONLY the settings cache — the auth session token survives, so the
        // reboot re-authenticates and the values can come back from Supabase alone.
        await p.evaluate(() => { try { localStorage.removeItem('zp3_S'); localStorage.removeItem('zp3_logo'); } catch (e) {} });
        await p.reload({ waitUntil: 'domcontentloaded' });  // a real reboot
        await waitReboot(p);
        // DIAGNOSTIC TIMELINE: poll the cloud right after reboot to catch a 7727→0 clobber
        // and the boot state that accompanies it (which save path wrote the default back).
        const tl = await p.evaluate(async () => {
          const out = [];
          for (let i = 0; i < 8; i++) {
            let cg = null;
            try { const { data } = await _supa.from('zj_data').select('settings').eq('user_id', _supaUser.id).maybeSingle(); cg = (JSON.parse((data && data.settings) || '{}')).goalMonthly ?? null; } catch (e) { cg = 'err'; }
            out.push({ t: i * 400, cg, sg: S.goalMonthly, cl: typeof _supaCloudLoaded !== 'undefined' ? _supaCloudLoaded : '?', foc: typeof _loadedFromCacheOnly !== 'undefined' ? _loadedFromCacheOnly : '?', ps: localStorage.getItem('zp3_pending_sync') });
            await new Promise(r => setTimeout(r, 400));
          }
          let cacheGoal = null;
          try { cacheGoal = ((JSON.parse(localStorage.getItem('zp3_cloud_cache') || '{}').settings) || {}).goalMonthly ?? null; } catch (e) {}
          return { tl: out, cacheGoal, mergeLog: window._mergeLog || [], zjWrites: window._zjWrites || [] };
        });
        original.rebootDiag = { preReboot, ...tl };
        return 1;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          goal: S.goalMonthly, locG: !!S.locationGranted, locD: !!S.locationDenied,
          cloudLoaded: (typeof _supaCloudLoaded !== 'undefined') ? _supaCloudLoaded : '?',
        }));
        const rd = original.rebootDiag || {};
        // The goal must survive (BUG1a) and the location-granted flag must survive the cloud
        // round-trip (BUG1b). rd.preReboot=7727 + rd.tl showing cg going 7727→0 names the clobber.
        return { ok: r.goal === newGoal && r.locG === true, got: JSON.stringify({ ...r, ...rd }) };
      },
    });

    // NO cleanup/restore — the test leaves the new goal + location-granted flag on
    // the dev account on purpose so the owner can confirm persistence by hand
    // (CLAUDE.md §13.7). The owner resets the goal manually if desired.

    const rep = report(FLOW, BASELINE, page);
    expect(rep.totalClicks).toBeGreaterThan(0);
    expect(rep.overBudget).toBe(false);
  });
});
