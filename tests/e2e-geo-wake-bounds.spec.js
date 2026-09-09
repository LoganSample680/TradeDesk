// @ts-check
// ── The wake stream is bounded, JS side (owner 2026-09-08) ───────────────────
//
// Eight days of the owner's own phone: 45 moving episodes, 2 of them a drive,
// the longest 36.6 hours with every fix inside one foot. He asked for
// "a proposal that keeps the phone in a truck logic but also turns off the
// gps after a bit." Four rules (js/geo-track.js, _geoWakeOnMoveArm):
//
//   1. the tape outranks the stream          (native, TdGeoPluginTests)
//   2. don't arm where a phone is never still (JS: _geoWakeArmOk)
//   3. cap a moving episode with no drive     (native, TdGeoPluginTests)
//   4. re-arm on the next quiet ping          (JS: _geoWakeRearm)
//
// This spec covers 2 and 4, the numbers JS sends for 1 and 3, what JS does
// with the plugin's `wake-drop`, and pins the Swift side by source so the
// two halves cannot drift apart without a red shard.
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const swiftSrc = () => fs.readFileSync(path.join(__dirname, '..', 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');
const swiftTests = () => fs.readFileSync(path.join(__dirname, '..', 'native', 'tests', 'TdGeoPluginTests.swift'), 'utf8');

test.describe('the wake stream is bounded', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Every case runs the real entry point with the plugin, the gate and the
  // tape stubbed, and puts everything back.
  async function run(src) {
    return page.evaluate(async (runSrc) => {
      const saved = { td: _geoTdPlugin, note: _geoParkNote, ok: _geoWakeArmOk, tape: _geoMotionTape,
        park: _geoParkModeOn, armed: _geoWakeArmed, quiet: _geoWakeQuietSinceMs, win: _geoDriveWinAt,
        spot: _geoParkSpot, burstOk: _geoPingBurstOk, home: window._placeIsLikelyHome, dwell: window._geoOpenDwell };
      const rec = { calls: [], notes: [] };
      _geoParkNote = (ev, x) => rec.notes.push([ev, String(x == null ? '' : x)]);
      _geoTdPlugin = () => ({
        setWakeOnMove: (o) => { rec.calls.push(o); return Promise.resolve({ on: true, supported: true }); },
        motionSince: () => Promise.resolve({ available: true, transitions: [] }),
      });
      _geoParkModeOn = false; _geoWakeArmed = false; _geoWakeQuietSinceMs = 0; _geoDriveWinAt = 0; _geoParkSpot = null;
      try {
        // An async body, so a case can await the entry points it drives.
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        rec.ret = await (new AsyncFunction(runSrc))();
        await new Promise(r => setTimeout(r, 20));
        rec.armed = _geoWakeArmed; rec.quiet = _geoWakeQuietSinceMs;
        return rec;
      } finally {
        _geoTdPlugin = saved.td; _geoParkNote = saved.note; _geoWakeArmOk = saved.ok; _geoMotionTape = saved.tape;
        _geoParkModeOn = saved.park; _geoWakeArmed = saved.armed; _geoWakeQuietSinceMs = saved.quiet;
        _geoDriveWinAt = saved.win; _geoParkSpot = saved.spot; _geoPingBurstOk = saved.burstOk;
        window._placeIsLikelyHome = saved.home; window._geoOpenDwell = saved.dwell;
      }
    }, src);
  }

  test.describe('the numbers ride the arm (rules 1 and 3 are enforced natively with them)', () => {
    test('twelve minutes moving, two minutes of tape grace, and a reason', async () => {
      const r = await run(`_geoWakeArmOk = () => ''; return _geoWakeOnMoveArm(_geoTdPlugin(), null);`);
      expect(r.ret).toBe(true);
      expect(r.calls).toEqual([{ on: true, reason: 'park armed', maxMovingMs: 12 * 60000, tapeGraceMs: 2 * 60000 }]);
    });

    test('the constants are minutes, not hours, and the grace outlasts CoreMotion lag', async () => {
      const c = await page.evaluate(() => ({ moving: _GEO_WAKE_MAX_MOVING_MS, grace: _GEO_WAKE_TAPE_GRACE_MS }));
      // The longest real wake -> drive window measured was 10.7 minutes; the
      // cap has to clear it, and a cap in hours is the 36.6-hour episode.
      expect(c.moving).toBeGreaterThanOrEqual(11 * 60000);
      expect(c.moving).toBeLessThanOrEqual(30 * 60000);
      // The tape lags a real departure 30 to 90 s; the grace must cover it.
      expect(c.grace).toBeGreaterThanOrEqual(90000);
      expect(c.grace).toBeLessThanOrEqual(5 * 60000);
    });

    test('the arm remembers a yes and not a no', async () => {
      const yes = await run(`_geoWakeArmOk = () => ''; _geoWakeOnMoveArm(_geoTdPlugin(), null);`);
      expect(yes.armed).toBe(true);
      const no = await run(`_geoWakeArmOk = () => '';
        _geoWakeOnMoveArm({ setWakeOnMove: () => Promise.resolve({ on: false, supported: false }) }, null);`);
      expect(no.armed).toBe(false);
      const failed = await run(`_geoWakeArmOk = () => '';
        _geoWakeOnMoveArm({ setWakeOnMove: () => Promise.reject(new Error('nope')) }, null);`);
      expect(failed.armed).toBe(false);
    });

    test('a custom reason rides the call; no reason means the park', async () => {
      const r = await run(`_geoWakeArmOk = () => '';
        _geoWakeOnMoveArm(_geoTdPlugin(), null, 're-armed on a quiet ping');
        _geoWakeOnMoveArm(_geoTdPlugin(), null, '');
        _geoWakeOnMoveArm(_geoTdPlugin(), null, undefined);`);
      expect(r.calls.map(c => c.reason)).toEqual(['re-armed on a quiet ping', 'park armed', 'park armed']);
    });
  });

  test.describe('rule 2: never armed where a phone is never still', () => {
    test('a park at the likely-home pin is skipped and says so', async () => {
      const r = await run(`
        window._placeIsLikelyHome = (c) => !!(c && c.lat === 39.9);
        _geoPingBurstOk = () => '';
        return [_geoWakeArmOk({ lat: 39.9, lng: -94.9 }), _geoWakeArmOk({ lat: 39.1, lng: -94.9 }), _geoWakeArmOk(null),
                _geoWakeOnMoveArm(_geoTdPlugin(), { lat: 39.9, lng: -94.9 })];`);
      expect(r.ret).toEqual(['home', '', '', false]);
      expect(r.calls).toEqual([]);
      expect(r.notes).toEqual([['wake-skip', 'home']]);
    });

    test('an open dwell at home, an off day and off hours are skipped; a drive window or no window is not', async () => {
      const r = await run(`
        window._placeIsLikelyHome = () => false;
        const out = {};
        for (const why of ['home', 'off-day', 'off-hours', 'drive', 'no-window', '', 'err']) {
          _geoPingBurstOk = () => why;
          out[why || 'blank'] = _geoWakeArmOk({ lat: 39.1, lng: -94.9 });
        }
        return out;`);
      expect(r.ret).toEqual({ home: 'home', 'off-day': 'off-day', 'off-hours': 'off-hours', drive: '', 'no-window': '', blank: '', err: '' });
    });

    test('the gate reads the real clock and work week through _geoPingBurstOk', async () => {
      // Pinned clock is 10:00 Central (5.2.2); the default work week has a
      // day off, so both answers are reachable without touching the clock.
      const r = await page.evaluate(() => {
        const saved = { dwell: window._geoOpenDwell, wh: (typeof S !== 'undefined' && S) ? S.workHours : undefined, win: _geoDriveWinAt, home: window._placeIsLikelyHome };
        window._placeIsLikelyHome = () => false;
        _geoDriveWinAt = 0;
        try {
          window._geoOpenDwell = { atHome: true };
          const home = _geoWakeArmOk(null);
          window._geoOpenDwell = null;
          S.workHours = { start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6, 0].filter(d => d !== new Date().getDay()) };
          const offDay = _geoWakeArmOk(null);
          S.workHours = { start: '11:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6] };
          const offHours = _geoWakeArmOk(null);
          S.workHours = { start: '06:00', end: '20:00', days: [0, 1, 2, 3, 4, 5, 6] };
          const open = _geoWakeArmOk(null);
          return { home, offDay, offHours, open };
        } finally {
          window._geoOpenDwell = saved.dwell; if (typeof S !== 'undefined' && S) S.workHours = saved.wh;
          _geoDriveWinAt = saved.win; window._placeIsLikelyHome = saved.home;
        }
      });
      expect(r).toEqual({ home: 'home', offDay: 'off-day', offHours: 'off-hours', open: '' });
    });

    test('the gate never throws: junk spots, no places module, a gate that throws', async () => {
      const r = await run(`
        const out = [];
        window._placeIsLikelyHome = () => { throw new Error('boom'); };
        out.push(_geoWakeArmOk({ lat: 1, lng: 2 }));
        window._placeIsLikelyHome = undefined;
        _geoPingBurstOk = () => { throw new Error('boom'); };
        out.push(_geoWakeArmOk({ lat: 1, lng: 2 }));
        _geoPingBurstOk = () => '';
        for (const junk of [undefined, null, 0, '', 'spot', [], {}, { lat: 'x' }]) out.push(_geoWakeArmOk(junk));
        return out;`);
      expect(r.ret.every(v => v === '')).toBe(true);
    });

    test('park mode passes the park spot to the gate', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
      const i = js.indexOf("_geoParkNote('park-on'");
      expect(i).toBeGreaterThan(-1);
      const slice = js.slice(i, i + 900);
      expect(slice.includes('_geoWakeQuietSinceMs=Date.now();')).toBe(true);
      expect(slice.includes('_geoWakeOnMoveArm(Td,_at)')).toBe(true);
    });
  });

  test.describe("the plugin's wake-drop", () => {
    test('a live drop forgets the arm, restarts the quiet clock, and journals the reason', async () => {
      const r = await run(`
        _geoWakeArmed = true;
        await _geoTdEvent({ type: 'wake-drop', ts: 1700000000000, reason: 'moving 12m, no drive window', lat: 39.01, lng: -95.69, acc: 8 });
        return { armed: _geoWakeArmed, quiet: _geoWakeQuietSinceMs };`);
      expect(r.ret).toEqual({ armed: false, quiet: 1700000000000 });
      expect(r.notes).toEqual([['wake-drop', 'moving 12m, no drive window']]);
    });

    test('a replayed drop describes a stream that is already gone and changes nothing', async () => {
      const r = await run(`
        _geoWakeArmed = true; _geoWakeQuietSinceMs = 5;
        await _geoTdEvent({ type: 'wake-drop', ts: 1700000000000, reason: 'tape says still' }, true);
        return { armed: _geoWakeArmed, quiet: _geoWakeQuietSinceMs };`);
      expect(r.ret).toEqual({ armed: true, quiet: 5 });
      expect(r.notes).toEqual([]);
    });

    test('its position never reaches the fix log or the fence machine', async () => {
      const r = await page.evaluate(async () => {
        const saved = { fix: _geoFixLogPush, note: _geoParkNote };
        let fixes = 0;
        _geoFixLogPush = () => { fixes++; };
        _geoParkNote = () => {};
        try {
          await _geoTdEvent({ type: 'wake-drop', ts: Date.now(), reason: 'tape says still', lat: 39.01, lng: -95.69, acc: 8 });
          return { fixes };
        } finally { _geoFixLogPush = saved.fix; _geoParkNote = saved.note; }
      });
      expect(r.fixes).toBe(0);
    });

    test('a drop with no reason and no timestamp still lands cleanly', async () => {
      const r = await run(`
        _geoWakeArmed = true;
        await _geoTdEvent({ type: 'wake-drop' });
        return { armed: _geoWakeArmed, quietSet: _geoWakeQuietSinceMs > 0 };`);
      expect(r.ret).toEqual({ armed: false, quietSet: true });
      expect(r.notes).toEqual([['wake-drop', '']]);
    });
  });

  test.describe('rule 4: re-armed on the next quiet ping', () => {
    const quietTape = `_geoMotionTape = async () => [{ kind: 'still', ts: 1 }];`;

    test('parked, down, gate open, tape still since the park: the stream goes back up', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeArmed = false; _geoWakeQuietSinceMs = 1000; _geoParkSpot = { lat: 39.1, lng: -94.9, name: 'shop' };
        _geoWakeArmOk = () => ''; ${quietTape}
        return await _geoWakeRearm();`);
      expect(r.ret).toBe(true);
      expect(r.calls).toEqual([{ on: true, reason: 're-armed on a quiet ping', maxMovingMs: 12 * 60000, tapeGraceMs: 2 * 60000 }]);
      expect(r.armed).toBe(true);
    });

    test('a walk on the tape since the park is a phone on a person: no re-arm, and it says why', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeQuietSinceMs = 1000;
        _geoWakeArmOk = () => '';
        _geoMotionTape = async () => [{ kind: 'still', ts: 900 }, { kind: 'onFoot', ts: 2000 }, { kind: 'still', ts: 3000 }];
        return await _geoWakeRearm();`);
      expect(r.ret).toBe(false);
      expect(r.calls).toEqual([]);
      expect(r.notes).toEqual([['wake-rearm-skip', 'tape moved']]);
    });

    test('a transition from before the quiet clock started does not count', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeQuietSinceMs = 5000;
        _geoWakeArmOk = () => '';
        _geoMotionTape = async () => [{ kind: 'driving', ts: 4000 }, { kind: 'still', ts: 4900 }];
        return await _geoWakeRearm();`);
      expect(r.ret).toBe(true);
      expect(r.calls.length).toBe(1);
    });

    test('the tape is asked from the quiet clock, and its absence is a skip, not a blind re-arm', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeQuietSinceMs = 123456;
        _geoWakeArmOk = () => '';
        let asked = null;
        _geoMotionTape = async (since) => { asked = since; return null; };
        const ret = await _geoWakeRearm();
        return { ret, asked };`);
      expect(r.ret).toEqual({ ret: false, asked: 123456 });
      expect(r.calls).toEqual([]);
      expect(r.notes).toEqual([['wake-rearm-skip', 'no tape']]);
    });

    test('not parked, already armed, or a drive window open: nothing is asked', async () => {
      const r = await run(`
        _geoWakeArmOk = () => ''; ${quietTape}
        const out = [];
        _geoParkModeOn = false; _geoWakeArmed = false; _geoDriveWinAt = 0; out.push(await _geoWakeRearm());
        _geoParkModeOn = true; _geoWakeArmed = true; out.push(await _geoWakeRearm());
        _geoWakeArmed = false; _geoDriveWinAt = Date.now(); out.push(await _geoWakeRearm());
        return out;`);
      expect(r.ret).toEqual([false, false, false]);
      expect(r.calls).toEqual([]);
      expect(r.notes).toEqual([]);
    });

    test('the gate closes it silently: the ping asks every half hour and the journal must not fill with it', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeArmOk = () => 'home'; ${quietTape}
        return await _geoWakeRearm();`);
      expect(r.ret).toBe(false);
      expect(r.calls).toEqual([]);
      expect(r.notes).toEqual([]);
    });

    test('a shell without the stream, or a tape that throws, is a quiet false', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeArmOk = () => '';
        const out = [];
        _geoTdPlugin = () => ({ startEvents: () => {} });
        out.push(await _geoWakeRearm());
        _geoTdPlugin = () => null;
        out.push(await _geoWakeRearm());
        _geoTdPlugin = () => ({ setWakeOnMove: (o) => { out.push('CALLED'); return Promise.resolve({ on: true }); } });
        _geoMotionTape = async () => { throw new Error('boom'); };
        out.push(await _geoWakeRearm());
        return out;`);
      expect(r.ret).toEqual([false, false, false]);
    });

    test('ten pings at once ask the tape ten times and never throw', async () => {
      const r = await run(`
        _geoParkModeOn = true; _geoWakeArmOk = () => ''; ${quietTape}
        const rs = await Promise.all(Array.from({ length: 10 }, () => _geoWakeRearm()));
        return rs;`);
      expect(r.ret.every(v => v === true)).toBe(true);
    });

    test('the push-ping is what runs it, live only', async () => {
      const r = await page.evaluate(async () => {
        const saved = { rearm: _geoWakeRearm, note: _geoParkNote, burst: _geoPingBurst, radio: _geoRadioCheck, upd: _geoBgUpdateCheck, derive: _geoDeriveLiveSoon, confirm: _geoDriveConfirm, fix: _geoFixLogPush };
        let n = 0;
        _geoWakeRearm = async () => { n++; return false; };
        _geoParkNote = () => {}; _geoPingBurst = () => false; _geoRadioCheck = async () => null; _geoBgUpdateCheck = () => {};
        _geoDeriveLiveSoon = () => {}; _geoDriveConfirm = () => ''; _geoFixLogPush = () => {};
        try {
          await _geoTdEvent({ type: 'push-ping', ts: Date.now() });
          const live = n;
          await _geoTdEvent({ type: 'push-ping', ts: Date.now() }, true);
          await _geoTdEvent({ type: 'heartbeat', ts: Date.now() });
          return { live, after: n };
        } finally {
          _geoWakeRearm = saved.rearm; _geoParkNote = saved.note; _geoPingBurst = saved.burst; _geoRadioCheck = saved.radio;
          _geoBgUpdateCheck = saved.upd; _geoDeriveLiveSoon = saved.derive; _geoDriveConfirm = saved.confirm; _geoFixLogPush = saved.fix;
        }
      });
      expect(r).toEqual({ live: 1, after: 1 });
    });
  });

  test.describe('the memory of the arm dies with the park', () => {
    test('a park exit forgets it', async () => {
      const r = await page.evaluate(() => {
        const saved = { park: _geoParkModeOn, armed: _geoWakeArmed, td: _geoTdPlugin, note: _geoParkNote, start: startGeoTracking };
        _geoTdPlugin = () => ({ stopAll: () => {} }); _geoParkNote = () => {}; startGeoTracking = () => {};
        _geoParkModeOn = true; _geoWakeArmed = true;
        try { _geoExitParkMode(); return _geoWakeArmed; }
        finally { _geoParkModeOn = saved.park; _geoWakeArmed = saved.armed; _geoTdPlugin = saved.td; _geoParkNote = saved.note; startGeoTracking = saved.start; }
      });
      expect(r).toBe(false);
    });

    test('tracking off forgets it', async () => {
      const r = await page.evaluate(() => {
        const saved = { armed: _geoWakeArmed, td: _geoTdPlugin, note: _geoParkNote };
        _geoTdPlugin = () => ({ stopAll: () => {} }); _geoParkNote = () => {};
        _geoWakeArmed = true;
        try { stopGeoTracking(); return _geoWakeArmed; }
        finally { _geoWakeArmed = saved.armed; _geoTdPlugin = saved.td; _geoParkNote = saved.note; }
      });
      expect(r).toBe(false);
    });

    test('the diagnostics panel shows it', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'geo-track.js'), 'utf8');
      expect(js.includes("['Wake stream',_geoWakeArmed?'armed':'off']")).toBe(true);
    });
  });

  test.describe('the Swift half, pinned by source (rules 1 and 3 run while JS sleeps)', () => {
    test('the bounds are read off the call, clamped, persisted beside the flag, and echoed', () => {
      const s = swiftSrc();
      expect(s.includes('private let wakeCfgKey = "td_geo_wake_cfg"')).toBe(true);
      expect(s.includes('private static let wakeMaxMovingDefaultMs: Double = 12 * 60_000')).toBe(true);
      expect(s.includes('private static let wakeTapeGraceDefaultMs: Double = 2 * 60_000')).toBe(true);
      const set = s.indexOf('@objc func setWakeOnMove(');
      const body = s.slice(set, set + 1400);
      expect(body.includes('TdGeoPlugin.clampWakeMoving(self.num(call.getValue("maxMovingMs")))')).toBe(true);
      expect(body.includes('TdGeoPlugin.clampWakeGrace(self.num(call.getValue("tapeGraceMs")))')).toBe(true);
      expect(body.includes('forKey: self.wakeCfgKey')).toBe(true);
      expect(body.includes('"maxMovingMs": maxMoving, "tapeGraceMs": grace')).toBe(true);
    });

    test('a drop is an event JS reads, a native ledger row, and a cleared flag so a relaunch cannot re-arm it', () => {
      const s = swiftSrc();
      const drop = s.indexOf('private func wakeDrop(reason: String)');
      expect(drop).toBeGreaterThan(-1);
      const body = s.slice(drop, drop + 700);
      expect(body.includes('event(type: "wake-drop"')).toBe(true);
      expect(body.includes('stopWakeOnMove(reason: reason, trigger: "native")')).toBe(true);
      expect(body.includes('removeObject(forKey: wakeKey)')).toBe(true);
    });

    test('rule 1: the motion stream feeds the grace, and the grace re-reads the tape when it fires', () => {
      const s = swiftSrc();
      const flip = s.indexOf('self.lastMotionKind = kind');
      expect(flip).toBeGreaterThan(-1);
      expect(s.slice(flip, flip + 120).includes('self.wakeTapeChanged(kind)')).toBe(true);
      const fired = s.indexOf('private func wakeTapeGraceFired()');
      expect(s.slice(fired, fired + 500).includes('lastMotionKind == "still"')).toBe(true);
      expect(s.slice(fired, fired + 500).includes('wakeDrop(reason: "tape says still")')).toBe(true);
    });

    test('rule 3: the episode starts the cap, rest and a drive window stand it down, the window closing re-arms it', () => {
      const s = swiftSrc();
      const upd = s.indexOf('private func onWakeUpdate(');
      const body = s.slice(upd, upd + 4000);
      expect(body.includes('wakeCancelTimers()')).toBe(true);
      expect(body.includes('if !driveSamplingOn() {\n            armWakeMovingCap()')).toBe(true);
      const cap = s.indexOf('private func wakeMovingCapFired()');
      expect(s.slice(cap, cap + 700).includes('if driveSamplingOn() { return }')).toBe(true);
      expect(s.slice(cap, cap + 700).includes('no drive window')).toBe(true);
      const end = s.indexOf('private func endDriveSampling(');
      expect(s.slice(end, end + 1600).includes('if wakeMovingOpen() { armWakeMovingCap() }')).toBe(true);
    });

    test('the native tests cover both exits', () => {
      const t = swiftTests();
      for (const name of [
        'testWakeBounds_clampJunkAndFillAbsent',
        'testSetWakeOnMove_persistsTheBoundsJsSentAndEchoesThem',
        'testWakeMovingCap_dropsTheStreamJournalsAndClearsTheFlag',
        'testWakeMovingCap_standsDownWhileTheDriveWindowOwnsTheRadio',
        'testWakeTapeGrace_dropsOnlyIfTheTapeStillSaysStillWhenItFires',
        'testWakeBounds_rapidRepeatedFiresNeverCrashOrDoubleDrop',
      ]) expect(t.includes(name), `native tests must cover ${name}`).toBe(true);
    });
  });

  // The arrow after the 19:02 watchdog reload (owner 2026-09-08): a boot that
  // remembers a park still started the continuous watcher, and the park
  // routine then refused to remove it because it believed it was parked.
  test.describe('a boot into a remembered park does not start the watcher', () => {
    const boot = (visible) => page.evaluate((visible) => {
      const saved = { park: _geoParkModeOn, on: _geoAppOnScreen, exit: _geoExitParkMode, note: _geoParkNote,
        bg: _geoNativePlugin, wid: _geoNativeWatcherId, starting: _geoNativeStarting, web: _geoWatchId };
      const out = { added: 0, exits: 0, notes: [] };
      _geoParkModeOn = true; _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null;
      _geoAppOnScreen = () => visible;
      _geoExitParkMode = () => { out.exits++; _geoParkModeOn = false; };
      _geoParkNote = (ev, x) => out.notes.push([ev, String(x)]);
      _geoNativePlugin = () => ({ addWatcher: () => { out.added++; return new Promise(() => {}); }, removeWatcher: () => {} });
      try { startGeoTracking(); return out; }
      finally {
        _geoParkModeOn = saved.park; _geoAppOnScreen = saved.on; _geoExitParkMode = saved.exit; _geoParkNote = saved.note;
        _geoNativePlugin = saved.bg; _geoNativeWatcherId = saved.wid; _geoNativeStarting = saved.starting; _geoWatchId = saved.web;
      }
    }, visible);

    test('hidden (a background relaunch, a reload behind the lock screen): stays parked on the fences', async () => {
      const r = await boot(false);
      expect(r.added, 'no continuous watcher, no indicator').toBe(0);
      expect(r.exits).toBe(0);
      expect(r.notes).toEqual([['start-skip', 'parked, app hidden']]);
    });

    test('visible: the park is exited properly, which is what restarts the watcher', async () => {
      const r = await boot(true);
      expect(r.exits).toBe(1);
      expect(r.added, 'the exit owns the restart; this call adds nothing itself').toBe(0);
    });

    test('with no park remembered the start is exactly what it was', async () => {
      const r = await page.evaluate(() => {
        const saved = { park: _geoParkModeOn, bg: _geoNativePlugin, wid: _geoNativeWatcherId, starting: _geoNativeStarting, web: _geoWatchId, note: _geoParkNote };
        let added = 0;
        _geoParkModeOn = false; _geoNativeWatcherId = null; _geoNativeStarting = false; _geoWatchId = null; _geoParkNote = () => {};
        _geoNativePlugin = () => ({ addWatcher: () => { added++; return new Promise(() => {}); }, removeWatcher: () => {} });
        try { startGeoTracking(); return { added, starting: _geoNativeStarting }; }
        finally {
          _geoParkModeOn = saved.park; _geoNativePlugin = saved.bg; _geoNativeWatcherId = saved.wid;
          _geoNativeStarting = saved.starting; _geoWatchId = saved.web; _geoParkNote = saved.note;
        }
      });
      expect(r).toEqual({ added: 1, starting: true });
    });

    test('the park restore is not a decision until the login is known', async () => {
      const r = await page.evaluate(() => {
        const saved = { td: _geoTdPlugin, park: _geoParkModeOn, user: window._supaUser, restored: window._geoParkRestored, note: _geoParkNote };
        window.__wake = [];
        _geoTdPlugin = () => ({ setWakeOnMove: async (a) => { window.__wake.push(a); return a; } });
        _geoParkNote = () => {};
        _geoParkModeOn = false; window._geoParkRestored = false;
        localStorage.setItem('zp3_geo_park', JSON.stringify({ spot: { lat: 41.5, lng: -88.1, name: 'Shop' }, at: Date.now() - 60000, uid: 'owner-uid' }));
        try {
          window._supaUser = null;
          const early = _geoParkRestore();
          const out = { early, restoredFlag: window._geoParkRestored, kept: !!localStorage.getItem('zp3_geo_park'), disarms: window.__wake.length };
          window._supaUser = { id: 'owner-uid' };
          out.later = _geoParkRestore();
          out.park = _geoParkModeOn;
          return out;
        } finally {
          localStorage.removeItem('zp3_geo_park');
          _geoTdPlugin = saved.td; _geoParkModeOn = saved.park; window._supaUser = saved.user;
          window._geoParkRestored = saved.restored; _geoParkNote = saved.note;
        }
      });
      expect(r.early).toBe(false);
      expect(r.restoredFlag, 'the once-per-boot latch must not close on a non-answer').toBe(false);
      expect(r.kept, 'the stored park is not forgotten').toBe(true);
      expect(r.disarms, 'and the stream is not disarmed on a guess').toBe(0);
      expect(r.later).toBe(true);
      expect(r.park).toBe(true);
    });
  });

  test('no console errors', async () => {
    await assertNoErrors(page);
  });
});
