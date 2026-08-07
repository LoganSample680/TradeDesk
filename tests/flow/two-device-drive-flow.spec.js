// @ts-check
// ── Two trucks logging drives in the same minute ────────────────────────────
//
// Owner (2026-08-03): "prove the last 5." This is the first, and the one I said
// I'd most want closed before this reaches production.
//
// The sweep's id-based safety is already proven multi-device by
// offline-sync-race-flow.spec.js, but it proves it on BIDS. This PR made the
// geofence write mileage rows by itself, on every phone in the crew, with no
// human involved and no way for either device to know the other just wrote one.
// That is a different shape of concurrent write from a contractor tapping Save
// on two tabs, and it is the shape this PR introduced, so it gets its own proof
// against the real backend.
//
// The failure this guards against is not a crash. It is a drive that was logged,
// synced, and then silently deleted by the OTHER phone's next save, because the
// old sweep removed any row it knew about but could no longer see. Nobody would
// notice until a mileage log came up short at tax time.
//
// Leaves its data (CLAUDE.md 12.7).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, scopeBypassHeader } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'two-device-drive';
const BASE = process.env.E2E_BASE_URL || 'https://tradedeskpro.app';

// One device = one browser context, signed into the same account. Two phones in
// two trucks, both belonging to one contractor.
async function device(browser, label) {
  const ctx = await browser.newContext({ baseURL: BASE, bypassCSP: true });
  await scopeBypassHeader(ctx, BASE);
  const page = await ctx.newPage();
  await signIn(page);
  return { ctx, page, label };
}

// The REAL entry point the geofence uses, not a hand-built row: what is under
// test is what autoLogDriveTrip plus the sync fabric do when two of them fire at
// once, so going around either would prove nothing.
async function logDrive(page, tag, from, to) {
  return await page.evaluate(async (a) => {
    const rec = autoLogDriveTrip({
      from: { lat: a.from.lat, lng: a.from.lng, name: a.from.name, kind: a.from.kind, addr: a.from.name },
      to: { lat: a.to.lat, lng: a.to.lng, name: a.to.name, kind: a.to.kind, addr: a.to.name },
      legKey: a.tag, startedIso: new Date().toISOString(),
    });
    if (!rec) return null;
    saveAll();
    await _flushSaveNow();
    return rec.id;
  }, { tag, from, to });
}

// Pull fresh from the backend and report which of these ids this device can see.
async function reloadAndSee(page, ids) {
  return await page.evaluate(async (a) => {
    for (let i = 0; i < 60 && (typeof _pendingSavePromise !== 'undefined' && _pendingSavePromise); i++) {
      try { await _pendingSavePromise; } catch (e) {}
      await new Promise(r => setTimeout(r, 50));
    }
    for (let i = 0; i < 60 && (typeof _loadInProgress !== 'undefined' && _loadInProgress); i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud({ silent: true });
    return a.ids.map(id => {
      const m = mileage.find(x => String(x.id) === String(id));
      return { id, seen: !!m, started: !!(m && m.startedIso), miles: m && m.miles };
    });
  }, { ids });
}

test.describe('two devices driving at once', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('two drives logged in the same minute both survive, on both devices', async ({ browser }) => {
    test.setTimeout(180000);
    const tag = Date.now();
    const A = await device(browser, 'truck A');
    const B = await device(browser, 'truck B');
    let idA = null, idB = null;

    try {
      // ── Both trucks arrive somewhere at the same moment ──────────────────
      await step(A.page, {
        label: 'two trucks close a leg simultaneously',
        page: 'mileage', role: 'contractor',
        suspect: 'mileage.js autoLogDriveTrip + cloud.js supaSaveToCloud sweep',
        ruleText: 'two devices logging a drive at the same time each write a row and neither save removes the other\'s',
        expected: 'both rows in the cloud',
        act: async () => {
          // Genuinely concurrent: both saves in flight against one account.
          [idA, idB] = await Promise.all([
            logDrive(A.page, 'dev-a-' + tag,
              { lat: 39.0307, lng: -95.7113, name: 'Shop', kind: 'shop' },
              { lat: 39.0556, lng: -95.6720, name: 'Truck A job ' + tag, kind: 'job' }),
            logDrive(B.page, 'dev-b-' + tag,
              { lat: 39.0307, lng: -95.7113, name: 'Shop', kind: 'shop' },
              { lat: 39.0111, lng: -95.7500, name: 'Truck B job ' + tag, kind: 'job' }),
          ]);
          return 0;   // the geofence did this, nobody tapped anything
        },
        rule: async () => {
          if (!idA || !idB) return { ok: false, got: `a row was never written: A=${idA} B=${idB}` };
          const out = await A.page.evaluate(async (a) => {
            const uid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
            const { data } = await _supa.from('td_mileage').select('id,data,deleted_at')
              .eq('user_id', uid).in('id', [String(a.idA), String(a.idB)]);
            const live = (data || []).filter(r => !r.deleted_at);
            return { found: live.length, ids: live.map(r => String(r.id)),
                     softDeleted: (data || []).filter(r => r.deleted_at).map(r => String(r.id)) };
          }, { idA, idB });
          return {
            ok: out.found === 2,
            got: `${out.found}/2 rows live in the cloud` +
                 (out.softDeleted.length ? ` · SOFT-DELETED BY THE PEER: ${out.softDeleted.join(', ')}` : ''),
          };
        },
      });

      // ── The half a single device cannot check: what the OTHER one sees ────
      await step(A.page, {
        label: 'each truck sees the other truck\'s drive after a reload',
        page: 'mileage', role: 'contractor',
        suspect: 'cloud.js supaLoadFromCloud + _lastKnownIds sweep',
        ruleText: 'after reloading, each device holds both drives with the new fields intact',
        expected: 'both rows on both devices',
        act: async () => 0,
        rule: async () => {
          const [seenByA, seenByB] = await Promise.all([
            reloadAndSee(A.page, [idA, idB]),
            reloadAndSee(B.page, [idA, idB]),
          ]);
          const missing = [];
          seenByA.forEach(r => { if (!r.seen) missing.push(`A cannot see ${r.id}`); });
          seenByB.forEach(r => { if (!r.seen) missing.push(`B cannot see ${r.id}`); });
          // startedIso is one of this PR's added fields, read here on a device
          // that did not write it.
          const noStart = [...seenByA, ...seenByB].filter(r => r.seen && !r.started);
          return {
            ok: !missing.length && !noStart.length,
            got: missing.length ? missing.join('; ')
               : noStart.length ? `leg start missing on ${noStart.length} row(s) after the round trip`
               : 'both devices hold both drives, leg starts intact',
          };
        },
      });

      // ── The delayed peer: B saves again having never learned about A ───────
      await step(A.page, {
        label: 'a device that saves again does not sweep away the peer\'s drive',
        page: 'mileage', role: 'contractor',
        suspect: 'cloud.js supaSaveToCloud _locallyDeletedIds sweep',
        ruleText: 'a later save from one device must never soft-delete a row the other device created',
        expected: 'both rows still live after a second save',
        act: async () => {
          // B logs a third drive and saves. Under the old sweep, anything B knew
          // about but could no longer see went with it.
          await logDrive(B.page, 'dev-b2-' + tag,
            { lat: 39.0111, lng: -95.7500, name: 'Truck B job ' + tag, kind: 'job' },
            { lat: 39.0307, lng: -95.7113, name: 'Shop', kind: 'shop' });
          return 0;
        },
        rule: async () => {
          const out = await A.page.evaluate(async (a) => {
            const uid = (typeof _contractorUserId !== 'undefined' && _contractorUserId) || _supaUser.id;
            const { data } = await _supa.from('td_mileage').select('id,deleted_at')
              .eq('user_id', uid).in('id', [String(a.idA), String(a.idB)]);
            return { live: (data || []).filter(r => !r.deleted_at).length,
                     killed: (data || []).filter(r => r.deleted_at).map(r => String(r.id)) };
          }, { idA, idB });
          return {
            ok: out.live === 2,
            got: `${out.live}/2 still live` +
                 (out.killed.length ? ` · the peer's save DELETED: ${out.killed.join(', ')}` : ''),
          };
        },
      });
    } finally {
      // Resource cleanup only, never data (CLAUDE.md 12.7).
      await A.ctx.close().catch(() => {});
      await B.ctx.close().catch(() => {});
    }

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
