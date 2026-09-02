// @ts-check
// ── The old design is gone, and CI proves it (CLAUDE.md 7.1) ────────────────
//
// Owner 2026-09-02: one deriver decides what the day was (js/geo-derive.js),
// one function writes it (geo_replace_day), and the screens only read. The
// previous design had three observers writing rows for one event, about
// twenty sweeps reconciling them on boot and on every Time Log open, and a
// reader correcting the result. Every one of those is deleted here, not
// gated, not commented out, and this spec is what keeps them deleted.
//
// A name coming back means a second writer or a second brain came back with
// it, which is exactly the loop that took three weeks to end.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const GONE = {
  'engine sweeps and the reconciler (js/geo-track.js)': [
    '_geoReconPings', '_geoPingTrim', '_geoReconcileFromMileage', '_geoCleanupSweeps',
    '_geoDedupTimeEntries', '_geoIntervalGaps', '_geoMergeAdjacentVisits', '_geoAbsorbGapsIntoStops',
    '_geoRepairStopRows', '_geoTimeEntriesSettleChain', '_geoDriveTapeTrim', '_geoClientRelabelSweep',
    '_geoDupeSweep', '_geoTapeRegradeSweep', '_geoDwellRetroSweep', '_geoRetimeMileageLeg',
    '_geoRetimeToTapeSweep', '_geoTapeFillSweep', '_geoLoadRetroSweep', '_geoTruncateDayAfter',
    '_geoHomeRegradeSweep', '_geoSyncDriveTimeEntries', '_geoVerifyReconciled', '_geoDedupShopTimeEntries',
  ],
  'the reader-side shop graders (js/geo-track.js)': [
    '_geoShopPaidSpans', '_geoActiveTrim', '_geoShopIsHome', '_geoLearnIdleCap', '_geoIdleGaps',
    '_geoShopPaidMin', '_geoShopPaidRange', '_geoRowInWorkday', '_geoShopCutoffs', '_geoOpenVisitAnchor',
    '_geoIsWorkAnchorSource', '_geoIsBaseRow', '_geoBaseNames', '_geoShopPrepMs', '_geoShopWrapMs',
  ],
  'the engine\'s own row and mileage writers (js/geo-track.js)': [
    '_geoAutoMileage', '_geoEnqueueStopRow',
  ],
  'mileage sweeps and the four "same drive" tests (js/mileage.js)': [
    '_milePersonalStopSweep', '_mileMotionHealSweep', '_mileSameDrive', '_mileServerRefine',
    '_mileWorkdaySweep', '_mileFlightSweep', '_mileSameJourney', '_mileSameLeg', '_mileSameArrival',
    '_mileTripWinner', '_mileDedupTrips', 'autoLogDriveTrip',
  ],
  'the reader\'s correction chain (js/timelog.js, js/finance.js)': [
    '_tlStopAnchored', '_tlShopTape', '_tlAbsorbGaps', '_tlDemoteRoundTrips', '_tlTrimCoveredGapRows',
    '_tlRepairPass', '_tlRepairAfterPaint', '_ccShopTape',
  ],
};

test.describe('the old writers, sweeps and corrections are gone', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  for (const [group, names] of Object.entries(GONE)) {
    test(group, async () => {
      const present = await page.evaluate((ns) => ns.filter(n => typeof window[n] !== 'undefined'), names);
      expect(present, 'these must not exist').toEqual([]);
    });
  }

  test('what replaced them exists, and is the only writer', async () => {
    const r = await page.evaluate(() => ({
      derive: typeof geoDeriveDay, rows: typeof geoDeriveRows, fence: typeof geoFenceAt,
      wire: typeof _geoDeriveDayNow, rebuild: typeof _geoDeriveRebuild, gate: _GEO_DERIVER_WRITES,
      blend: typeof _tlBlendManual, unaccounted: typeof _tlFillUnaccounted,
    }));
    expect(r).toEqual({ derive: 'function', rows: 'function', fence: 'function', wire: 'function',
      rebuild: 'function', gate: true, blend: 'function', unaccounted: 'function' });
  });

  test('the boot no longer runs a sweep chain, and the Time Log never writes', async () => {
    // The realtime handlers used to arm two timers that re-ran sweeps 1.5s
    // after every incoming row. Neither timer is ever set now.
    const r = await page.evaluate(() => ({
      rt1: window._rtTimeDedupTimer, rt2: window._rtMileHealTimer,
      flags: ['_mileMotionHealRan', '_milePersonalSweepRan', '_mileWorkdaySweepRan', '_mileFlightSweepRan']
        .filter(k => k in window),
    }));
    expect(r.rt1).toBeUndefined();
    expect(r.rt2).toBeUndefined();
    expect(r.flags).toEqual([]);
  });

  test('no console errors', async () => { assertNoErrors(page, 'gone'); });
});
