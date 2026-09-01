// @ts-check
// ── The drive window: dense GPS only while a drive is actually happening ─────
//
// Owner, 2026-09-01: "right now when tradedesk backgrounds I see the blue
// navigation arrow, that's old continuous engine ... gps continuous should
// only fire when core motion goes automotive or a force closed app sees a geo
// fence exit so we can draw the route", refined the same day to the exact
// correlation model this file pins:
//
//   "when core motion fires a automotive event and a gps ping or vice versa
//    that should fire the continuous drive tracking, then the 30 minute cron
//    job keeps confirming and checking the location, when automotive goes back
//    to cycling or walking that fire another ping which shuts off the
//    continuous gps, that's the correlation I want"
//
// Four things are under test here and they are all separable:
//   1. The CORRELATION. One signal is never enough, in either direction, and
//      the pairing has a bounded window.
//   2. The CONFIRMER. The existing 30-minute push-ping keeps a real drive's
//      window alive and closes one that should already have ended.
//   3. The CLOSE. Any non-automotive motion kind shuts the radio down, and
//      cycling is one of them even though the server disagrees.
//   4. The COORDINATE BUG this shipped alongside: a visit report and a region
//      wake carry positions that are not where the truck is, and they were
//      extending the odometer.
//
// The Swift half (the safety cap, the keepalive default) is asserted at source
// level, the same way e2e-geo-wake-regions.spec.js pins the wake handler: the
// behaviour itself lives in native/tests/TdGeoPluginTests.swift (§3.3), and
// these guard the contract JS is written against.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

const swiftSrc = () => fs.readFileSync(
  path.join(__dirname, '..', 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');

test.describe('Drive window: the correlation that turns the radio up', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Every test drives the REAL functions with a stubbed plugin and puts the
  // module-scoped state back afterward. Bare bindings, never window.*: these
  // are module-scoped and window.x = would set an unrelated property (the
  // house rule in every other geo spec here).
  const withPlugin = `
    const _saved = {
      td: _geoTdPlugin, at: _geoDriveWinAt, why: _geoDriveWinWhy, asked: _geoDriveWinAskedAt,
      m: _geoDriveCorrMotionAt, f: _geoDriveCorrFixAt, cfix: _geoDriveConfirmFix,
      started: _geoDriveStartedAt, moving: _geoDriveMovingAt, park: _geoParkModeOn,
      lastKind: _geoLastMotionKind, pend: _geoDrivePendingAt,
    };
    const calls = [];
    _geoTdPlugin = () => ({
      setSampling: (o) => { calls.push(o); return Promise.resolve(o); },
      burstFix: () => Promise.resolve({}),
    });
    _geoDriveWinAt = 0; _geoDriveWinWhy = ''; _geoDriveWinAskedAt = 0;
    _geoDriveCorrMotionAt = 0; _geoDriveCorrFixAt = 0; _geoDriveConfirmFix = null;
    _geoLastMotionKind = ''; _geoDrivePendingAt = null; _geoParkModeOn = false;
  `;
  const restore = `
    _geoTdPlugin = _saved.td;
    _geoDriveWinAt = _saved.at; _geoDriveWinWhy = _saved.why; _geoDriveWinAskedAt = _saved.asked;
    _geoDriveCorrMotionAt = _saved.m; _geoDriveCorrFixAt = _saved.f; _geoDriveConfirmFix = _saved.cfix;
    _geoDriveStartedAt = _saved.started; _geoDriveMovingAt = _saved.moving;
    _geoParkModeOn = _saved.park; _geoLastMotionKind = _saved.lastKind;
    _geoDrivePendingAt = _saved.pend;
  `;
  // page.evaluate takes a string EXPRESSION, which is how an async body gets
  // evaluated at all: new Function() builds a plain function and every await
  // below would be a syntax error inside one.
  const run = (body) => page.evaluate(
    `(async () => { ${withPlugin}\ntry{ ${body} }finally{ ${restore} } })()`);

  // ── 1. The correlation ────────────────────────────────────────────────────

  test('an automotive flip ALONE never turns the radio up', async () => {
    // The whole reason the owner asked for a correlation. CoreMotion reads
    // automotive from a ride in somebody else's truck and from a phone
    // jostling on a bench, and neither is a drive worth radio.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      return { calls: calls.length, open: _geoDriveWindowOn(), armed: _geoDriveCorrMotionAt > 0 };
    `);
    expect(r.calls).toBe(0);
    expect(r.open).toBe(false);
    expect(r.armed).toBe(true);   // armed and waiting, which is the point
  });

  test('a GPS ping ALONE never turns the radio up', async () => {
    const r = await run(`
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      return { calls: calls.length, open: _geoDriveWindowOn(), armed: _geoDriveCorrFixAt > 0 };
    `);
    expect(r.calls).toBe(0);
    expect(r.open).toBe(false);
    expect(r.armed).toBe(true);
  });

  test('motion then ping opens the window, in drive mode, with the tight filter', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      return { calls: calls.slice(), open: _geoDriveWindowOn(), why: _geoDriveWinWhy };
    `);
    expect(r.open).toBe(true);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].mode).toBe('drive');
    expect(r.calls[0].distanceFilter).toBe(30);
    expect(r.calls[0].maxMs).toBe(45 * 60000);
    expect(r.why).toContain('motion+fix');
  });

  test('the window carries the batch interval that keeps the phone cool', async () => {
    // Owner 2026-09-01, after a six-minute drive cost 3% and left the phone
    // hot: 127 fixes went out as 127 separate uploads, because a fix every
    // ~2s never coalesced inside the plugin's 1.5s debounce. JS owns the
    // number (3.2), so it has to actually be on the call.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      return { flushMs: (calls[0] || {}).flushMs, konst: _GEO_DRIVE_FLUSH_MS };
    `);
    expect(r.konst).toBe(20000);
    expect(r.flushMs).toBe(20000);
  });

  test('every re-assert carries it too, so a resumed window never reverts to per-fix uploads', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      _geoDriveWinAskedAt = 0;                       // let the throttle through
      _geoDriveWindowOpen('confirm-moved');
      return { n: calls.length, all: calls.every(c => c.flushMs === 20000) };
    `);
    expect(r.n).toBeGreaterThan(1);
    expect(r.all).toBe(true);
  });

  test('closing the window sends no batch interval at all: coarse is coarse', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      _geoDriveWindowClose('rest-still');
      const last = calls[calls.length - 1];
      return { mode: last.mode, flushMs: last.flushMs === undefined ? 'absent' : last.flushMs };
    `);
    expect(r.mode).toBe('coarse');
    expect(r.flushMs).toBe('absent');
  });

  test('ping then motion opens it too: order does not matter', async () => {
    // "or vice versa", verbatim. This is the common order on a fence wake,
    // which lands while the coprocessor is still deciding.
    const r = await run(`
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      const before = _geoDriveWindowOn();
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'still' });
      return { before, after: _geoDriveWindowOn(), mode: (calls[0] || {}).mode };
    `);
    expect(r.before).toBe(false);
    expect(r.after).toBe(true);
    expect(r.mode).toBe('drive');
  });

  test('the two halves must land inside the pairing window, not just eventually', async () => {
    // A walk past a parked truck at 10:00 and a passenger ride at 10:30 are
    // not a departure, however neatly they pair up on a timeline.
    const r = await run(`
      const stale = Date.now() - (_GEO_DRIVE_PAIR_MS + 60000);
      _geoDriveCorrMotionAt = stale;                       // an old, unspent flip
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      return { open: _geoDriveWindowOn(), calls: calls.length, pair: _GEO_DRIVE_PAIR_MS };
    `);
    expect(r.pair).toBe(3 * 60000);
    expect(r.open).toBe(false);
    expect(r.calls).toBe(0);
  });

  test('a replayed buffer from two days ago never opens a window today', async () => {
    // The drain on next boot pushes history through the same functions. Both
    // halves are gated on freshness so two stale halves cannot pair.
    const r = await run(`
      const old = Date.now() - 2 * 86400000;
      await _geoTdEvent({ type: 'motion', ts: old, kind: 'automotive', prevKind: 'walking' }, true);
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 }, __tdTs: old + 1000 });
      return { open: _geoDriveWindowOn(), calls: calls.length };
    `);
    expect(r.open).toBe(false);
    expect(r.calls).toBe(0);
  });

  test('a low-accuracy fix is not a ping: it cannot complete the pair', async () => {
    // Reuses the app's existing "trustworthy enough to act on" bar rather than
    // inventing a second one. A 900m fix pairing with a flip would turn the
    // radio up on a cell-tower estimate.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 900 } });
      return { open: _geoDriveWindowOn(), calls: calls.length };
    `);
    expect(r.open).toBe(false);
    expect(r.calls).toBe(0);
  });

  test('one flip is spent once: it cannot re-open the window against every later fix', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      _geoDriveWindowClose('test');
      const opens = calls.filter(c => c.mode === 'drive').length;
      // A later ping with no new flip must find nothing waiting for it.
      await _geoOnPing({ coords: { latitude: 39.2, longitude: -94.2, accuracy: 10 } });
      return { opens, reopened: _geoDriveWindowOn(),
               opensAfter: calls.filter(c => c.mode === 'drive').length };
    `);
    expect(r.opens).toBe(1);
    expect(r.reopened).toBe(false);
    expect(r.opensAfter).toBe(1);
  });

  // ── 2. The force-closed opener (the owner's explicit "or") ────────────────

  test('a REPLAYED fence exit opens the window on its own: a dead app has no motion stream', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'regionExit', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 20, regionId: 'shop' }, true);
      return { open: _geoDriveWindowOn(), why: _geoDriveWinWhy, mode: (calls[0] || {}).mode };
    `);
    expect(r.open).toBe(true);
    expect(r.why).toContain('fence-exit-replay');
    expect(r.mode).toBe('drive');
  });

  test('a LIVE fence exit is only the ping half: walking off site is not a drive', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'regionExit', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 20, regionId: 'shop' });
      const alone = { open: _geoDriveWindowOn(), calls: calls.length };
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      return { alone, paired: _geoDriveWindowOn() };
    `);
    expect(r.alone.open).toBe(false);
    expect(r.alone.calls).toBe(0);
    expect(r.paired).toBe(true);
  });

  // ── 3. The close ─────────────────────────────────────────────────────────

  for (const kind of ['walking', 'running', 'still', 'cycling']) {
    test(`motion to ${kind} shuts the continuous GPS off`, async () => {
      // CYCLING IS IN THIS LIST ON PURPOSE. The owner named it as a stop
      // condition; ingest-geo (AUTO_KINDS) calls it vehicular. The radio
      // follows the owner, and the disagreement is documented at
      // _geoKindRests rather than silently resolved on the server.
      const r = await run(`
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
        await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
        const opened = _geoDriveWindowOn();
        await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: ${JSON.stringify(kind)}, prevKind: 'automotive' });
        return { opened, open: _geoDriveWindowOn(), last: calls[calls.length - 1] };
      `);
      expect(r.opened).toBe(true);
      expect(r.open).toBe(false);
      expect(r.last.mode).toBe('coarse');
    });
  }

  test('the server and the app disagree about cycling, and the disagreement is deliberate', async () => {
    // Pinned so a future edit to either side has to come past this test.
    const ingest = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'functions', 'ingest-geo', 'index.ts'), 'utf8');
    expect(ingest.includes('const AUTO_KINDS = new Set(["automotive", "driving", "cycling"])'),
      'the server still treats cycling as vehicular; if that changed, revisit _geoKindRests').toBe(true);
    const r = await page.evaluate(() => ({
      rests: _geoKindRests('cycling'), drives: _geoKindDrives('cycling'),
    }));
    expect(r.rests).toBe(true);
    expect(r.drives).toBe(false);
  });

  test('a closed window forgets both halves, so a stale flip cannot resurrect it', async () => {
    const r = await run(`
      _geoDriveCorrMotionAt = Date.now();
      _geoDriveWindowClose('test');
      return { m: _geoDriveCorrMotionAt, f: _geoDriveCorrFixAt, c: _geoDriveConfirmFix };
    `);
    expect(r.m).toBe(0);
    expect(r.f).toBe(0);
    expect(r.c).toBe(null);
  });

  // ── 4. The 30-minute confirmer ───────────────────────────────────────────

  test('the confirmer is the EXISTING cron, not a new timer', async () => {
    const cron = fs.readFileSync(
      path.join(__dirname, '..', '.github', 'workflows', 'geo-ping-cron.yml'), 'utf8');
    expect(cron.includes('*/30 * * * *')).toBe(true);
    expect(cron.includes('push-geo-ping')).toBe(true);
    const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
    // The confirmation rides push-ping. If someone ever adds a setInterval for
    // it instead, this is the line that has to be argued with (7.3).
    expect(js.includes("if(!replay&&ev.type==='push-ping'){const _v=_geoDriveConfirm(ev)"),
      'the 30-minute confirmation must ride the existing push-ping').toBe(true);
  });

  test('a push-ping that MOVED keeps the window alive and pushes the cap out', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      const n0 = calls.length;
      // First confirmation just anchors the position.
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.10, lng: -94.10, acc: 40 });
      // Half an hour later and eight miles away: unambiguously still driving.
      _geoDriveWinAskedAt = 0;   // past the re-assert throttle, as 30 minutes would be
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.20, lng: -94.20, acc: 40 });
      return { open: _geoDriveWindowOn(), added: calls.length - n0,
               last: calls[calls.length - 1] };
    `);
    expect(r.open).toBe(true);
    expect(r.last.mode).toBe('drive');   // re-asserted, never closed
    expect(r.added).toBeGreaterThan(0);
  });

  test('a push-ping that did NOT move closes a window nothing else closed', async () => {
    // The backstop. A drive that ended without a motion edge, a fence, or a
    // leg close leaves the radio up until something notices; this is what
    // notices, within half an hour.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.10, lng: -94.10, acc: 40 });
      const held = _geoDriveWindowOn();
      // Same spot to five decimals: about 20 feet, well under the threshold.
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.10004, lng: -94.10004, acc: 40 });
      return { held, open: _geoDriveWindowOn(), last: calls[calls.length - 1] };
    `);
    expect(r.held).toBe(true);
    expect(r.open).toBe(false);
    expect(r.last.mode).toBe('coarse');
    expect(r.last.reason).toBe('confirm-idle');
  });

  test('a push-ping with no window open is a complete no-op', async () => {
    const r = await run(`
      await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 40 });
      return { calls: calls.length, open: _geoDriveWindowOn() };
    `);
    expect(r.calls).toBe(0);
    expect(r.open).toBe(false);
  });

  test('a push-ping with no fix at all re-asserts rather than closing', async () => {
    // The phone answered the push, so the process is alive and a drive may
    // still be running. The plugin cap is what bounds this case.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      _geoDriveWinAskedAt = 0;
      await _geoTdEvent({ type: 'push-ping', ts: Date.now() });
      return { open: _geoDriveWindowOn(), last: calls[calls.length - 1] };
    `);
    expect(r.open).toBe(true);
    expect(r.last.mode).toBe('drive');
  });

  // ── 5. The plugin's own close comes back to JS ───────────────────────────

  test("the plugin's safety cap firing is reflected in JS state, not just in Swift", async () => {
    // The cap fires without asking; if JS kept believing the window was open
    // it would never re-open it on the next real drive.
    const r = await run(`
      await _geoTdEvent({ type: 'motion', ts: Date.now(), kind: 'automotive', prevKind: 'walking' });
      await _geoOnPing({ coords: { latitude: 39.1, longitude: -94.1, accuracy: 10 } });
      const opened = _geoDriveWindowOn();
      await _geoTdEvent({ type: 'sampling', ts: Date.now(), mode: 'coarse', reason: 'cap' });
      return { opened, open: _geoDriveWindowOn() };
    `);
    expect(r.opened).toBe(true);
    expect(r.open).toBe(false);
  });

  // ── 6. Park, and the arrow the owner actually sees ───────────────────────

  test('backgrounding with nothing driving parks immediately instead of after four minutes', async () => {
    const r = await page.evaluate(() => {
      const saved = { started: _geoDriveStartedAt, moving: _geoDriveMovingAt,
                      park: _geoParkModeOn, enter: window._geoEnterParkMode, at: _geoDriveWinAt };
      let entered = 0;
      try {
        _geoDriveStartedAt = null; _geoDriveMovingAt = 0; _geoParkModeOn = false; _geoDriveWinAt = 0;
        // The handler is bound once at init and calls the module binding.
        const src = _geoTrackInit.toString();
        return {
          hasGuard: src.includes('bg-park-now'),
          guards: src.includes('!_geoDriveWindowOn()&&!_geoDriveStartedAt'),
        };
      } finally {
        _geoDriveStartedAt = saved.started; _geoDriveMovingAt = saved.moving;
        _geoParkModeOn = saved.park; _geoDriveWinAt = saved.at;
      }
    });
    expect(r.hasGuard).toBe(true);
    expect(r.guards).toBe(true);
  });

  test('a drive in progress is never parked out from under itself on background', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
    const i = js.indexOf("_geoParkNote('bg-park-now'");
    expect(i).toBeGreaterThan(-1);
    const guard = js.slice(Math.max(0, i - 400), i);
    expect(guard.includes('!_geoDriveWindowOn()')).toBe(true);
    expect(guard.includes('!_geoDriveStartedAt')).toBe(true);
    expect(guard.includes('_GEO_DRIVE_SHOW_MS')).toBe(true);
  });

  test('no console errors across the drive window', async () => { await assertNoErrors(page); });
});

// ═══════════════════════════════════════════════════════════════════════════
// The coordinate bug: three event types carry positions that are not a position
// ═══════════════════════════════════════════════════════════════════════════
test.describe('visit / regionEnter / regionExit stop moving the odometer', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // The owner's 2026-08-31 drive home, reduced to its bones: a real fix a
  // quarter mile along, then a visit report arriving 18 seconds later carrying
  // the coordinates of the place he had LEFT. The visit yanked the accumulator
  // back to the origin and then counted the way forward again, which is most
  // of why a 3.2 mile route logged 4.8.
  const drive = (evType) => `
    const saved = { started: _geoDriveStartedAt, mi: _geoDriveMiles, steps: _geoDriveSteps,
                    last: _geoDriveLastFix, path: _geoDrivePath, park: _geoParkModeOn,
                    td: _geoTdPlugin };
    try {
      _geoTdPlugin = () => null;
      _geoParkModeOn = false;
      _geoDriveStartedAt = new Date().toISOString();
      _geoDriveMiles = 0; _geoDriveSteps = 0; _geoDriveLastFix = null; _geoDrivePath = [];
      // Origin, then a quarter mile along.
      await _geoOnPing({ coords: { latitude: 39.1000, longitude: -94.1000, accuracy: 8 } });
      await _geoOnPing({ coords: { latitude: 39.1036, longitude: -94.1000, accuracy: 8 } });
      const mid = _geoDriveMiles;
      // ...and the late report, carrying the ORIGIN's coordinates.
      await _geoTdEvent({ type: ${JSON.stringify(evType)}, ts: Date.now(),
                          lat: 39.1000, lng: -94.1000, acc: 60, regionId: 'shop' });
      const after = _geoDriveMiles;
      return { mid, after, steps: _geoDriveSteps,
               lastLat: _geoDriveLastFix && _geoDriveLastFix.lat, pts: _geoDrivePath.length };
    } finally {
      _geoDriveStartedAt = saved.started; _geoDriveMiles = saved.mi; _geoDriveSteps = saved.steps;
      _geoDriveLastFix = saved.last; _geoDrivePath = saved.path; _geoParkModeOn = saved.park;
      _geoTdPlugin = saved.td;
    }
  `;

  for (const t of ['visit', 'regionEnter', 'regionExit']) {
    test(`a ${t} adds no distance and does not move the measuring baseline`, async () => {
      const r = await page.evaluate(`(async () => { ${drive(t)} })()`);
      expect(r.mid).toBeGreaterThan(0.2);        // the real quarter mile landed
      expect(r.after).toBe(r.mid);               // the late report added nothing
      // And the baseline still sits at the last REAL fix, not back at the
      // origin: leaving it moved is what made the return trip get re-counted.
      expect(Math.abs(r.lastLat - 39.1036)).toBeLessThan(1e-6);
      expect(r.pts).toBe(2);                     // and no phantom point on the route
    });
  }

  test('a visit still backdates the arrival: the fix is a flag, not a return', async () => {
    // The whole risk of this change is throwing the baby out. A visit report's
    // TIME is its most valuable property (median 4 minutes late, worst 45) and
    // the backdate path must be untouched.
    const r = await page.evaluate(async () => {
      const saved = { bd: _geoParkBackdate, td: _geoTdPlugin, park: _geoParkModeOn };
      try {
        _geoTdPlugin = () => null; _geoParkModeOn = false; _geoParkBackdate = null;
        const now = Date.now();
        let seen = null;
        const realPing = _geoOnPing;
        // Capture what the backdate was at the moment the ping ran, since the
        // finally block in _geoTdEvent clears it again.
        _geoOnPing = async (pos) => { seen = { bd: _geoParkBackdate, noTrack: !!pos.__tdNoTrack }; };
        await _geoTdEvent({ type: 'visit', ts: now, lat: 39.1, lng: -94.1, acc: 40,
                            arrivalTs: now - 10 * 60000 });
        _geoOnPing = realPing;
        return seen;
      } finally { _geoParkBackdate = saved.bd; _geoTdPlugin = saved.td; _geoParkModeOn = saved.park; }
    });
    expect(r.noTrack).toBe(true);                       // flagged, so no distance
    expect(typeof r.bd).toBe('string');                 // and still backdated
    expect(Date.parse(r.bd)).toBeGreaterThan(0);
  });

  test('an ordinary fix is NOT flagged: only the three late-report types are', async () => {
    const r = await page.evaluate(async () => {
      const saved = { td: _geoTdPlugin, park: _geoParkModeOn, ping: _geoOnPing };
      try {
        _geoTdPlugin = () => null; _geoParkModeOn = false;
        let flag = null;
        _geoOnPing = async (pos) => { flag = !!pos.__tdNoTrack; };
        await _geoTdEvent({ type: 'fix', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 8 });
        return flag;
      } finally { _geoTdPlugin = saved.td; _geoParkModeOn = saved.park; _geoOnPing = saved.ping; }
    });
    expect(r).toBe(false);
  });

  test('no console errors across the late-report path', async () => { await assertNoErrors(page); });
});

// ═══════════════════════════════════════════════════════════════════════════
// The route: captured, capped, persisted, drawn
// ═══════════════════════════════════════════════════════════════════════════
test.describe('The route a leg actually drove', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.bizTz = 'America/Chicago'; });
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('every accumulated hop lands a point, rounded to five decimals', async () => {
    const r = await page.evaluate(async () => {
      const saved = { started: _geoDriveStartedAt, path: _geoDrivePath, last: _geoDriveLastFix,
                      mi: _geoDriveMiles, td: _geoTdPlugin, park: _geoParkModeOn };
      try {
        _geoTdPlugin = () => null; _geoParkModeOn = false;
        _geoDriveStartedAt = new Date().toISOString();
        _geoDrivePath = []; _geoDriveLastFix = null; _geoDriveMiles = 0;
        for (let i = 0; i < 6; i++) {
          await _geoOnPing({ coords: { latitude: 39.1 + i * 0.001, longitude: -94.1, accuracy: 8 } });
        }
        return { n: _geoDrivePath.length, first: _geoDrivePath[0], shape: _geoDrivePath[1] };
      } finally {
        _geoDriveStartedAt = saved.started; _geoDrivePath = saved.path;
        _geoDriveLastFix = saved.last; _geoDriveMiles = saved.mi;
        _geoTdPlugin = saved.td; _geoParkModeOn = saved.park;
      }
    });
    expect(r.n).toBe(6);                       // origin + five hops
    expect(r.first.length).toBe(3);            // [lat, lng, ms]
    expect(String(r.shape[0]).split('.')[1].length).toBeLessThanOrEqual(5);
  });

  test('the cap decimates instead of truncating, so a long drive keeps its shape', async () => {
    // Truncating would draw the first half of a trip as the whole trip, which
    // is worse than drawing nothing.
    const r = await page.evaluate(() => {
      const saved = _geoDrivePath;
      try {
        _geoDrivePath = [];
        const total = _GEO_PATH_MAX + 50;
        for (let i = 0; i < total; i++) _geoPathPush(39 + i * 1e-4, -94, 1000 + i);
        return { n: _geoDrivePath.length, max: _GEO_PATH_MAX, total,
                 firstT: _geoDrivePath[0][2],
                 lastT: _geoDrivePath[_geoDrivePath.length - 1][2] };
      } finally { _geoDrivePath = saved; }
    });
    expect(r.n).toBeLessThanOrEqual(r.max);
    expect(r.n).toBeGreaterThan(r.max / 3);               // decimated, not gutted
    expect(r.firstT).toBe(1000);                          // the leg still starts where it started
    expect(r.lastT).toBe(1000 + r.total - 1);             // ...and still ends where it ended
  });

  test('the path survives a mid-drive reload', async () => {
    const r = await page.evaluate(() => {
      const saved = { path: _geoDrivePath, started: _geoDriveStartedAt, restored: window._geoOpenRestored };
      try {
        _geoDriveStartedAt = new Date().toISOString();
        _geoDrivePath = [[39.1, -94.1, 1], [39.2, -94.2, 2], [39.3, -94.3, 3]];
        _geoPersistOpen(new Date().toISOString());
        const raw = JSON.parse(localStorage.getItem(_GEO_OPEN_KEY) || 'null');
        _geoDrivePath = [];
        window._geoOpenRestored = false;
        _geoRestoreOpen();
        return { stored: raw && (raw.drivePath || []).length, back: _geoDrivePath.length };
      } finally {
        _geoDrivePath = saved.path; _geoDriveStartedAt = saved.started;
        window._geoOpenRestored = saved.restored;
      }
    });
    expect(r.stored).toBe(3);
    expect(r.back).toBe(3);
  });

  test('a corrupt stored path never reaches the map', async () => {
    const r = await page.evaluate(() => {
      const saved = { path: _geoDrivePath, restored: window._geoOpenRestored,
                      raw: localStorage.getItem(_GEO_OPEN_KEY) };
      try {
        _geoDrivePath = [];
        localStorage.setItem(_GEO_OPEN_KEY, JSON.stringify({
          uid: (_supaUser && _supaUser.id) || null, day: todayKey(),
          driveStartedAt: new Date().toISOString(),
          drivePath: [['x', 'y'], null, [39.1], [39.2, -94.2, 5], 'nope'],
          hiddenAt: new Date().toISOString(),
        }));
        window._geoOpenRestored = false;
        _geoRestoreOpen();
        return _geoDrivePath.length;
      } finally {
        _geoDrivePath = saved.path; window._geoOpenRestored = saved.restored;
        if (saved.raw) localStorage.setItem(_GEO_OPEN_KEY, saved.raw);
        else localStorage.removeItem(_GEO_OPEN_KEY);
      }
    });
    expect(r).toBe(1);   // only the one well-formed point survives
  });

  test('autoLogDriveTrip stores a real path and refuses a degenerate one', async () => {
    const r = await page.evaluate(() => {
      const saved = mileage.slice();
      try {
        mileage.length = 0;
        const from = { lat: 39.1, lng: -94.1, name: 'Shop', addr: '1 A St' };
        const to = { lat: 39.2, lng: -94.2, name: 'Job', addr: '2 B St' };
        autoLogDriveTrip({ from, to, legKey: 'k1', startedIso: new Date().toISOString(),
                           path: [[39.1, -94.1, 1], [39.15, -94.15, 2], [39.2, -94.2, 3]] });
        autoLogDriveTrip({ from, to: { lat: 39.3, lng: -94.3, name: 'Job2' }, legKey: 'k2',
                           startedIso: new Date().toISOString(), path: [[39.1, -94.1, 1]] });
        const a = mileage.find(m => m.legKey === 'k1');
        const b = mileage.find(m => m.legKey === 'k2');
        return { a: a && a.path && a.path.length, b: b && b.path };
      } finally { mileage.length = 0; saved.forEach(m => mileage.push(m)); }
    });
    expect(r.a).toBe(3);
    expect(r.b).toBe(undefined);   // two points are a straight line, not a route
  });

  test('re-pointing a leg drops its route as well as its tally', async () => {
    // A map showing a track that starts somewhere other than the row's own
    // From is worse than no map at all.
    const r = await page.evaluate(() => {
      const m = { id: 1, from: 'x', fromCoord: { lat: 1, lng: 1 }, toCoord: { lat: 2, lng: 2 },
                  gpsMiles: 9, path: [[1, 1, 1], [2, 2, 2]], calc_method: 'auto_route' };
      _reoriginTrip(m, { lat: 3, lng: 3, name: 'Real origin', addr: '3 C St' });
      return { gps: m.gpsMiles, path: m.path };
    });
    expect(r.gps).toBe(undefined);
    expect(r.path).toBe(undefined);
  });

  test('the Route button appears only on a row that has a track', async () => {
    // A control whose first click does nothing is a dead button (13.1), so it
    // must not render on a row with nothing to draw.
    const r = await page.evaluate(() => {
      const saved = mileage.slice();
      try {
        mileage.length = 0;
        const base = { date: todayKey(), miles: 3.2, purpose: 'Job site', from: 'A', to: 'B',
                       created_at: new Date().toISOString() };
        mileage.push(Object.assign({ id: 91 }, base, { path: [[39.1, -94.1, 1], [39.2, -94.2, 2]] }));
        mileage.push(Object.assign({ id: 92 }, base));
        // Rendered through _milRenderTripList directly, the same way
        // e2e-supply-receipt.spec.js drives this list: renderAllMileage is the
        // whole screen and answers to trackerYear, the filter bar and the
        // summary rail, none of which this assertion is about.
        _milRenderTripList(mileage, new Date().getFullYear());
        const html = (document.getElementById('mil-table') || {}).innerHTML || '';
        return { with: (html.match(/openMileageRoute\(91\)/g) || []).length,
                 without: (html.match(/openMileageRoute\(92\)/g) || []).length };
      } finally { mileage.length = 0; saved.forEach(m => mileage.push(m)); }
    });
    expect(r.with).toBe(1);
    expect(r.without).toBe(0);
  });

  test('openMileageRoute draws one modal with the route in it, and closes cleanly', async () => {
    const r = await page.evaluate(() => {
      const saved = mileage.slice();
      try {
        mileage.length = 0;
        mileage.push({ id: 93, date: todayKey(), miles: 3.2, from: 'A', to: 'B',
                       from_name: 'Shop', to_name: 'Job',
                       fromCoord: { lat: 39.1, lng: -94.1 }, toCoord: { lat: 39.2, lng: -94.2 },
                       gpsMiles: 3.4, path: [[39.1, -94.1, 1], [39.15, -94.13, 2], [39.2, -94.2, 3]] });
        openMileageRoute(93);
        const ov = document.getElementById('_mil-route-ov');
        const body = document.getElementById('_mil-route-body');
        const out = {
          overlays: document.querySelectorAll('#_mil-route-ov').length,
          isZmodal: !!(ov && ov.classList.contains('zmodal-overlay')),
          hasBox: !!(ov && ov.querySelector('.zmodal')),
          drew: !!(body && body.innerHTML.includes('<svg')),
          // Owner 2026-09-01: "traced over watched and don't need the points".
          // The sample count described how the line was built, not the drive.
          says: !!(ov && ov.textContent.includes('Traced 3.4 mi')
                      && ov.textContent.includes('Logged 3.2 mi')),
          noPts: !!(ov && !/\bpoints\b/.test(ov.textContent)),
          noWatched: !!(ov && !/Watched/.test(ov.textContent)),
        };
        // Idempotent: a second open must replace, never stack.
        openMileageRoute(93);
        out.afterSecond = document.querySelectorAll('#_mil-route-ov').length;
        document.getElementById('_mil-route-ov').remove();
        out.closed = document.querySelectorAll('#_mil-route-ov').length;
        return out;
      } finally { mileage.length = 0; saved.forEach(m => mileage.push(m)); }
    });
    expect(r.overlays).toBe(1);
    expect(r.isZmodal).toBe(true);
    expect(r.hasBox).toBe(true);
    expect(r.drew).toBe(true);
    expect(r.says).toBe(true);
    expect(r.noPts, 'the sample count is gone').toBe(true);
    expect(r.noWatched, '"Watched" is gone with it').toBe(true);
    expect(r.afterSecond).toBe(1);
    expect(r.closed).toBe(0);
  });

  test('openMileageRoute on a row with no path, a missing row, or junk is a silent no-op', async () => {
    const r = await page.evaluate(() => {
      const saved = mileage.slice();
      try {
        mileage.length = 0;
        mileage.push({ id: 94, date: todayKey(), miles: 1 });
        const out = [];
        [94, 9999, null, undefined, 'x', {}].forEach(id => {
          try { openMileageRoute(id); out.push('ok'); } catch (e) { out.push('threw:' + e.message); }
        });
        return { out, overlays: document.querySelectorAll('#_mil-route-ov').length };
      } finally { mileage.length = 0; saved.forEach(m => mileage.push(m)); }
    });
    expect(r.out.every(x => x === 'ok')).toBe(true);
    expect(r.overlays).toBe(0);
  });

  test('the fallback plot frames the route, not just the two endpoints', async () => {
    // A leg that loops outside its own endpoints (the forced detour a route is
    // drawn to show) must not be cropped out of its own picture.
    const r = await page.evaluate(() => {
      const body = document.createElement('div');
      document.body.appendChild(body);
      try {
        tdMapRenderFallback({
          body,
          pts: [{ lat: 39.10, lon: -94.10, type: 'start' }, { lat: 39.11, lon: -94.10, type: 'end' }],
          path: [[39.10, -94.10, 1], [39.50, -94.60, 2], [39.11, -94.10, 3]],
          style: { start: { c: '#0E6B39' }, end: { c: '#dc2626' } },
        });
        const poly = body.querySelector('polyline');
        const pts = (poly && poly.getAttribute('points') || '').split(' ');
        return { has: !!poly, n: pts.length, ys: pts.map(p => +p.split(',')[1]) };
      } finally { body.remove(); }
    });
    expect(r.has).toBe(true);
    expect(r.n).toBe(3);
    // Every drawn point sits inside the 0-100 box: nothing is off the plot.
    expect(r.ys.every(y => y >= -0.01 && y <= 100.01)).toBe(true);
  });

  test('the fallback plot with no path still renders exactly as before', async () => {
    const r = await page.evaluate(() => {
      const body = document.createElement('div');
      document.body.appendChild(body);
      try {
        tdMapRenderFallback({
          body, pts: [{ lat: 39.1, lon: -94.1, type: 'job' }], style: { job: { c: '#0E6B39' } },
        });
        return { poly: body.querySelectorAll('polyline').length, pins: body.querySelectorAll('a').length };
      } finally { body.remove(); }
    });
    expect(r.poly).toBe(0);
    expect(r.pins).toBe(1);
  });

  test('no console errors across route capture and drawing', async () => { await assertNoErrors(page); });
});

// ═══════════════════════════════════════════════════════════════════════════
// The Swift contract JS is written against (native behaviour: native/tests/)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('The native half of the drive window', () => {
  test('setSampling and samplingState are registered with the bridge', () => {
    const s = swiftSrc();
    expect(s.includes('CAPPluginMethod(name: "setSampling"')).toBe(true);
    expect(s.includes('CAPPluginMethod(name: "samplingState"')).toBe(true);
  });

  test('only a drive breadcrumb may wait; everything a person watches stays live', () => {
    // The battery fix must not silently become the live-updates bug it was
    // built alongside (owner 2026-08-31, "these updates aren't coming through
    // live anymore"). Two halves, both asserted: the delay applies to `fix`
    // and only while a window is open, and an EARLIER deadline supersedes a
    // later one so a fence crossing mid-drive still goes out on the short lane.
    const s = swiftSrc();
    const i = s.indexOf('private func flushDelaySec(for type: String)');
    expect(i).toBeGreaterThan(-1);
    const body = s.slice(i, s.indexOf('private func driveFlushDelaySec()'));
    expect(body.includes('type == "fix", driveSamplingOn()'),
      'anything but a breadcrumb, or any event outside a drive, takes the live lane').toBe(true);
    expect(s.includes('if flushPending, let cur = flushDeadline, cur <= due { return }'),
      'a sooner deadline must win, and a later one must not push the window out').toBe(true);
  });

  test('the batch interval comes from JS and is clamped at both ends', () => {
    const s = swiftSrc();
    expect(s.includes('call.getValue("flushMs")'), 'JS owns the number (3.2)').toBe(true);
    expect(s.includes('flushDebounceFloorMs: Double = 1500')).toBe(true);
    expect(s.includes('flushDebounceCeilingMs: Double = 60_000')).toBe(true);
    // Absent means unchanged: a shell whose JS predates the key keeps 1.5s.
    expect(s.includes('flushDebounceMs: Double = 1500')).toBe(true);
    expect(s.includes('let ms = num(st["flushMs"]) else {'),
      'absent or unreadable falls back rather than throwing').toBe(true);
  });

  test('the urgent lane cancels a pending batch instead of letting it re-POST', () => {
    const s = swiftSrc();
    const i = s.indexOf('private func flushUrgently()');
    const body = s.slice(i, i + 900);
    expect(body.includes('flushGen += 1'),
      'a debounced flush already armed must not fire behind the urgent one').toBe(true);
    expect(body.includes('flushDeadline = nil')).toBe(true);
  });

  test('the safety cap exists, is bounded, and reverts without being asked', () => {
    // The single worst outcome this feature can produce is a phone left at
    // kCLLocationAccuracyBest all night because a close never arrived.
    const s = swiftSrc();
    expect(s.includes('samplingCapTimer')).toBe(true);
    expect(s.includes('samplingCapCeilingMs: Double = 4 * 3600_000')).toBe(true);
    expect(s.includes('endDriveSampling(reason: "cap")'),
      'the cap must call the same exit every other closer uses').toBe(true);
    expect(s.includes('func armSamplingCap')).toBe(true);
  });

  test('a relaunch judges the cap from the ORIGINAL start, so it cannot be re-bought forever', () => {
    const s = swiftSrc();
    const i = s.indexOf('private func restoreSamplingWindow()');
    expect(i).toBeGreaterThan(-1);
    const body = s.slice(i, i + 2000);
    expect(body.includes('started + maxMs - Date().timeIntervalSince1970 * 1000')).toBe(true);
    expect(body.includes('drive-off-expired')).toBe(true);
    expect(s.includes('self.restoreSamplingWindow()'), 'load() must run it').toBe(true);
  });

  test('the heartbeat keepalive defaults to OFF: that is the blue arrow', () => {
    const s = swiftSrc();
    expect(s.includes('let keepalive = call.getBool("keepalive") ?? false')).toBe(true);
    expect(s.includes('private var heartbeatKeepalive = false')).toBe(true);
    // ...and no code path may re-assert the coarse session without it.
    expect(/if heartbeatOn && heartbeatKeepalive \{/.test(s)).toBe(true);
    const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
    expect(js.includes('keepalive:false'), 'JS must pass the decision explicitly (3.2)').toBe(true);
  });

  test('stopAll and a burst both hand the radio back through one door', () => {
    const s = swiftSrc();
    expect(s.includes('self.endDriveSampling(reason: "stopAll")')).toBe(true);
    expect(s.includes('func restoreBaselineRadio()')).toBe(true);
    // endBurst must not go dark on top of an open window.
    const i = s.indexOf('private func endBurst()');
    const body = s.slice(i, s.indexOf('// MARK: - The drive window', i));
    expect(body.includes('if driveSamplingOn()')).toBe(true);
  });

  test('a drive-window fix is tagged so JS can tell it from a 3km wake', () => {
    const s = swiftSrc();
    expect(s.includes('if drive { ev["drive"] = true }')).toBe(true);
    expect(s.includes('countWake(drive ? "drive-fix" : "slc")')).toBe(true);
  });

  test('the plugin has adversarial XCTest coverage for every new method (3.3)', () => {
    const t = fs.readFileSync(
      path.join(__dirname, '..', 'native', 'tests', 'TdGeoPluginTests.swift'), 'utf8');
    for (const name of ['SetSampling', 'SamplingState', 'SamplingCap', 'Keepalive']) {
      expect(t.includes(name), `native tests must cover ${name}`).toBe(true);
    }
  });
});
