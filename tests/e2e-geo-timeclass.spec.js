// @ts-check
// ── Time classification: what a job_time_entries row MEANS ───────────────────
//
// Owner direction (2026-08-01): "if time away from jobs gets logged and all
// that correctly". A minute in the wrong bucket is a payroll error or a bad
// deduction, and it is invisible in a way a missing minute is not: the totals
// still look plausible. Three defects lived here at once.
//
//   1. LUNCH WAS DRIVING. Nothing outside a fence closed the drive clock, so a
//      45-minute lunch rode out on the leg that ended at the next job. Those
//      minutes were compensable time with mileage attached to them.
//   2. TIME AT A KNOWN PLACE VANISHED. Arriving at a supply house closed the
//      drive leg (good) but nothing recorded the dwell, so twenty paid minutes
//      loading material left the day entirely.
//   3. 'drive-personal' WAS BILLED AS JOB LABOR. Three call sites in finance.js
//      tested `source === 'drive'` exactly. A personal-vehicle leg did not
//      match, fell through to the on-site branch, and landed on a job's cost.
//
// The predicates below are the single place that decides any of this, so they
// are worth testing directly, and the source-level checks make sure the money
// views actually go through them rather than re-deriving the rule locally.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

const readJs = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
// Comments explain the very bug being asserted against, so a naive substring
// search matches its own explanation. Strip them first, the same way the
// migration lints do.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test.describe('Time classification', () => {
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

  test('drive predicate covers every drive variant, and nothing else', async () => {
    const out = await page.evaluate(() => ({
      drive: _geoIsDriveSource('drive'),
      personal: _geoIsDriveSource('drive-personal'),
      geofence: _geoIsDriveSource('geofence'),
      gap: _geoIsDriveSource('geofence-gap'),
      manual: _geoIsDriveSource('manual'),
      stop: _geoIsDriveSource('stop'),
      place: _geoIsDriveSource('place'),
      nul: _geoIsDriveSource(null),
      undef: _geoIsDriveSource(undefined),
      empty: _geoIsDriveSource(''),
    }));
    expect(out.drive).toBe(true);
    // The exact-equality version of this returned false, which is the bug.
    expect(out.personal).toBe(true);
    expect(out.geofence).toBe(false);
    expect(out.gap).toBe(false);
    expect(out.manual).toBe(false);
    expect(out.stop).toBe(false);
    expect(out.place).toBe(false);
    expect(out.nul).toBe(false);
    expect(out.undef).toBe(false);
    expect(out.empty).toBe(false);
  });

  test('off-job and place predicates are narrow', async () => {
    const out = await page.evaluate(() => ({
      offStop: _geoIsOffJobSource('stop'),
      offDrive: _geoIsOffJobSource('drive'),
      offGeo: _geoIsOffJobSource('geofence'),
      offNull: _geoIsOffJobSource(null),
      plPlace: _geoIsPlaceSource('place'),
      plStop: _geoIsPlaceSource('stop'),
      plNull: _geoIsPlaceSource(undefined),
    }));
    expect(out.offStop).toBe(true);
    expect(out.offDrive).toBe(false);
    expect(out.offGeo).toBe(false);
    expect(out.offNull).toBe(false);
    expect(out.plPlace).toBe(true);
    expect(out.plStop).toBe(false);
    expect(out.plNull).toBe(false);
  });

  test('no money view re-derives the drive rule with exact equality', async () => {
    ['finance.js', 'timelog.js', 'geo-track.js'].forEach((f) => {
      const src = stripComments(readJs(f));
      expect(src.includes("source==='drive'"), f + " must not test source==='drive' exactly").toBe(false);
      expect(src.includes('source === "drive"'), f + ' must not test source === "drive" exactly').toBe(false);
    });
  });

  test('the crew report keeps off-job time out of paid minutes entirely', async () => {
    const src = stripComments(readJs('finance.js'));
    // e.min drives loaded cost, wage and the OT flag. An off-job stop must
    // return BEFORE it is added, or a lunch break is billed and can push
    // someone into overtime they never worked.
    const i = src.indexOf('_geoIsOffJobSource(en.source)){e.offMin+=m;return;}');
    expect(i, 'off-job entries must short-circuit before e.min').toBeGreaterThan(-1);
    expect(src.indexOf('e.min+=m;', i), 'e.min must be added after the off-job return').toBeGreaterThan(i);
  });

  test('the time log excludes off-job stops from the hours record', async () => {
    const src = stripComments(readJs('timelog.js'));
    expect(src.includes('_geoIsOffJobSource(e.source)')).toBe(true);
  });

  test('a drive leg can be closed at an earlier verified moment', async () => {
    const out = await page.evaluate(() => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'u-timeclass' };
      try {
        const start = new Date(Date.now() - 60 * 60000).toISOString();  // an hour ago
        const parked = new Date(Date.now() - 45 * 60000).toISOString(); // parked 15m in
        _geoDriveEntry(null, start, 'Yard', parked);
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
      return rows;
    });
    expect(out.length).toBe(1);
    // 15 minutes, not 60: without endedIso the parked 45 minutes ride out on
    // this leg, which is exactly how lunch became driving.
    expect(out[0].row.minutes).toBe(15);
    expect(out[0].row.dest_place).toBe('Yard');
    expect(out[0].row.job_id).toBe(null);
  });

  test('a real stop splits the leg, logs itself, and restarts the clock', async () => {
    const out = await page.evaluate(() => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      const saveJob = _geoCurrentJob, saveShop = _geoWasInShop, saveDrive = _geoDriveStartedAt;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'u-timeclass' };
      _geoCurrentJob = null; _geoWasInShop = false;
      let restarted = null;
      try {
        const at = new Date(Date.now() - 50 * 60000).toISOString();     // parked 50m ago
        const lastAt = new Date(Date.now() - 5 * 60000).toISOString();  // pulled out 5m ago
        _geoDriveStartedAt = new Date(Date.now() - 62 * 60000).toISOString(); // left the job 62m ago
        _geoCloseStop({ lat: 44.1, lng: -100.1, at, lastAt });
        restarted = _geoDriveStartedAt;
        return {
          rows, restarted, lastAt,
          leg: rows.find(r => /^drive/.test(r.row.source || '')),
          stop: rows.find(r => r.row.source === 'stop'),
        };
      } finally {
        _geoEnqueue = realEnq; _supaUser = realUser;
        _geoCurrentJob = saveJob; _geoWasInShop = saveShop; _geoDriveStartedAt = saveDrive;
      }
    });
    // The leg ends when they PARKED (62 - 50 = 12m), not when they pulled out.
    expect(out.leg).toBeTruthy();
    expect(out.leg.row.minutes).toBe(12);
    // The stop is its own row, attributed to no job.
    expect(out.stop).toBeTruthy();
    expect(out.stop.row.minutes).toBe(45);
    expect(out.stop.row.job_id).toBe(null);
    // And the next leg begins the moment they pulled out, so the return trip is
    // a real trip rather than starting from wherever they end up next.
    expect(out.restarted).toBe(out.lastAt);
  });

  test('a short dwell is a traffic light, not a stop', async () => {
    const out = await page.evaluate(() => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      const saveDrive = _geoDriveStartedAt, saveJob = _geoCurrentJob;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'u-timeclass' };
      _geoCurrentJob = null;
      try {
        _geoDriveStartedAt = new Date(Date.now() - 30 * 60000).toISOString();
        const at = new Date(Date.now() - 3 * 60000).toISOString();
        const lastAt = new Date(Date.now() - 1 * 60000).toISOString();   // 2 minutes
        _geoCloseStop({ lat: 44.2, lng: -100.2, at, lastAt });
        return { rows, driveUntouched: _geoDriveStartedAt };
      } finally {
        _geoEnqueue = realEnq; _supaUser = realUser;
        _geoDriveStartedAt = saveDrive; _geoCurrentJob = saveJob;
      }
    });
    // Nothing written, and critically the leg is NOT split: a red light must not
    // turn one commute into two trips.
    expect(out.rows.length).toBe(0);
  });

  test('_geoCloseStop survives garbage input', async () => {
    const ok = await page.evaluate(() => {
      try {
        _geoCloseStop(null); _geoCloseStop(undefined); _geoCloseStop({});
        _geoCloseStop({ at: 'nonsense', lastAt: 'nonsense' });
        _geoCloseStop({ lat: 1, lng: 2, at: null, lastAt: null });
        return true;
      } catch (e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('the miscalled unknown-stop recorder is gone from the place fence', async () => {
    const src = stripComments(readJs('geo-track.js'));
    // It passed the coordinate we are at NOW with the dwell of the place we
    // just LEFT: wrong location and wrong duration, and it meant genuine
    // unknown stops were never recorded at all.
    expect(src.includes('recordUnknownStop(here,dwellMs)')).toBe(false);
    expect(src.includes('recordUnknownStop(here, dwellMs)')).toBe(false);
  });

  test('leaving a known place closes its dwell', async () => {
    const out = await page.evaluate(() => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'u-timeclass' };
      try {
        const pl = savePlace({ name: 'E2E Dwell Yard', kind: 'supply', lat: 44.31, lon: -100.31, confirmedBy: 'manual' });
        _geoClosePlaceEntry(pl.id, new Date(Date.now() - 22 * 60000).toISOString());
        deletePlace(pl.id);
        return rows;
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
    });
    expect(out.length).toBe(1);
    expect(out[0].row.source).toBe('place');
    expect(out[0].row.minutes).toBe(22);
    expect(out[0].row.dest_place).toBe('E2E Dwell Yard');
    // Paid work, but not labor on any one job.
    expect(out[0].row.job_id).toBe(null);
  });

  test('a pass-through of a known place logs nothing', async () => {
    const out = await page.evaluate(() => {
      const rows = [];
      const realEnq = _geoEnqueue, realUser = _supaUser;
      _geoEnqueue = (tbl, row) => rows.push({ tbl, row });
      _supaUser = { id: 'u-timeclass' };
      try {
        _geoClosePlaceEntry('nope', new Date(Date.now() - 30000).toISOString());
        _geoClosePlaceEntry('nope', null);
        return rows;
      } finally { _geoEnqueue = realEnq; _supaUser = realUser; }
    });
    expect(out.length).toBe(0);
  });

  test('dest_place ships in a migration', async () => {
    const dir = path.join(__dirname, '..', 'supabase', 'migrations');
    const hit = fs.readdirSync(dir).some(f => /dest_place/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    // The app wrote this column for a whole feature before any migration
    // created it: Dev had it from the dashboard, a clean stack did not, and
    // every drive insert naming a place would have been rejected outright.
    expect(hit, 'job_time_entries.dest_place must exist in a migration').toBe(true);
  });

  test('no flow spec passes itself on a schema gap', async () => {
    const dir = path.join(__dirname, 'flow');
    // A rule that returns ok because a TABLE OR COLUMN was missing is a green
    // test that asserted nothing, which is strictly worse than the failure it
    // hides: dest_place was written by the app for an entire feature with no
    // migration behind it, and two specs reported green the whole time.
    //
    // Deliberately narrow. A skip because an external SERVICE is not wired up
    // (Stripe Connect off on the dev account, an edge function not yet
    // deployed) is a real environment gap that no migration can close, and
    // those stay legal.
    const offenders = fs.readdirSync(dir).filter(f => /\.spec\.js$/.test(f))
      .filter(f => /ok:\s*true,\s*got:\s*'SKIP:[^']*(not provisioned|not migrated|column)/.test(
        fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
