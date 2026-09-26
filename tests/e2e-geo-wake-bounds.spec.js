// @ts-check
// ── The wake stream is retired (owner 2026-09-23: "no arrow") ───────────────
//
// It was meant to rest while the truck sat and wake the app when it moved.
// Fourteen days of every phone's ledger: about 3,200 arms, not one
// "stationary". Each arm opened "moving at stream start", the two-minute tape
// grace dropped it, and the blue arrow showed for those two minutes every
// park. The owner chose no arrow, so JS never arms it again, and says OFF at
// every park and every boot so a shell still holding one from an older build
// lets go. What wakes a parked phone now is the kerb region, tightened to
// _GEO_PARK_REGION_M (e2e-geo-wake-regions pins that half).
//
// This file keeps the park-restore cases that used to live beside the stream,
// because they are about the park, not the stream.
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const readJs = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

test.describe('the wake stream is retired', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Close the boot's own restore latch so a note or an off call a case sees
    // is one it caused (webkit shard 3, 2026-09-10). The restore cases below
    // save and reopen it themselves.
    await page.evaluate(() => { window._geoParkRestored = true; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test.describe('nothing can arm it', () => {
    test('the arm, the re-arm, the gate, the flag and the bookkeeping are gone', async () => {
      const r = await page.evaluate(() => ({
        arm: typeof window._geoWakeOnMoveArm, rearm: typeof window._geoWakeRearm, gate: typeof window._geoWakeArmOk,
        flag: (() => { try { return typeof _GEO_WAKE_ON_MOVE; } catch (e) { return 'undefined'; } })(),
        armed: (() => { try { return typeof _geoWakeArmed; } catch (e) { return 'undefined'; } })(),
        quiet: (() => { try { return typeof _geoWakeQuietSinceMs; } catch (e) { return 'undefined'; } })(),
      }));
      expect(r).toEqual({ arm: 'undefined', rearm: 'undefined', gate: 'undefined', flag: 'undefined', armed: 'undefined', quiet: 'undefined' });
    });

    test('no JS anywhere asks the plugin for on:true', () => {
      const dir = path.join(__dirname, '..', 'js');
      const hits = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
        .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
          // Code only: the history of the arm is still told in comments.
          .filter(l => !/^\s*\/\//.test(l))
          .some(l => /setWakeOnMove\(\{\s*on\s*:\s*true/.test(l)));
      expect(hits).toEqual([]);
    });

    test('the push-ping no longer re-arms anything, and diagnostics no longer claim a stream', () => {
      const src = readJs('geo-track.js');
      expect(src.includes("_geoWakeRearm")).toBe(false);
      expect(src.includes("['Wake stream'")).toBe(false);
    });
  });

  test.describe('the off switch', () => {
    const offRun = (body) => page.evaluate(async (bodySrc) => {
      const saved = { td: _geoTdPlugin };
      const calls = [];
      _geoTdPlugin = () => ({ setWakeOnMove: (o) => { calls.push(o); return Promise.resolve({ on: false }); } });
      try {
        const ret = await (new (Object.getPrototypeOf(async function () {}).constructor)(bodySrc))();
        await new Promise(r => setTimeout(r, 10));
        return { ret, calls };
      } finally { _geoTdPlugin = saved.td; }
    }, body);

    test('it asks for off, with a reason, and says it asked', async () => {
      const r = await offRun('return _geoWakeStreamOff("because")');
      expect(r.ret).toBe(true);
      expect(r.calls).toEqual([{ on: false, reason: 'because' }]);
    });

    test('no reason still gives one', async () => {
      const r = await offRun('return _geoWakeStreamOff()');
      expect(r.calls).toEqual([{ on: false, reason: 'stream retired' }]);
    });

    test('a shell without the method, no plugin, a plugin that throws or rejects: a quiet false or true, never a throw', async () => {
      const r = await page.evaluate(async () => {
        const saved = _geoTdPlugin;
        const out = {};
        try {
          _geoTdPlugin = () => ({ startEvents: () => {} }); out.old = _geoWakeStreamOff('x');
          _geoTdPlugin = () => null; out.none = _geoWakeStreamOff('x');
          _geoTdPlugin = () => { throw new Error('boom'); }; out.threw = _geoWakeStreamOff('x');
          _geoTdPlugin = () => ({ setWakeOnMove: () => Promise.reject(new Error('nope')) }); out.rejected = _geoWakeStreamOff('x');
          _geoTdPlugin = () => ({ setWakeOnMove: () => { throw new Error('sync'); } }); out.syncThrow = _geoWakeStreamOff('x');
          await new Promise(r => setTimeout(r, 10));
          return out;
        } finally { _geoTdPlugin = saved; }
      });
      expect(r).toEqual({ old: false, none: false, threw: false, rejected: true, syncThrow: false });
    });

    test('ten at once send ten offs and never throw', async () => {
      const r = await offRun('let n=0; for(let i=0;i<10;i++){ if(_geoWakeStreamOff("burst")) n++; } return n;');
      expect(r.ret).toBe(10);
      expect(r.calls.length).toBe(10);
      expect(r.calls.every(c => c.on === false)).toBe(true);
    });

    test('a restored park says off, so a phone still holding one from an older build lets go', async () => {
      const r = await page.evaluate(async () => {
        const saved = { td: _geoTdPlugin, park: _geoParkModeOn, user: window._supaUser, restored: window._geoParkRestored, note: _geoParkNote };
        const calls = [];
        _geoTdPlugin = () => ({ setWakeOnMove: (o) => { calls.push(o); return Promise.resolve({ on: false }); } });
        _geoParkNote = () => {};
        _geoParkModeOn = false; window._geoParkRestored = false; window._supaUser = { id: 'owner-uid' };
        localStorage.setItem('zp3_geo_park', JSON.stringify({ spot: { lat: 41.5, lng: -88.1, name: 'Shop' }, at: Date.now() - 60000, uid: 'owner-uid' }));
        try {
          const restored = _geoParkRestore();
          await new Promise(r => setTimeout(r, 10));
          return { restored, calls };
        } finally {
          localStorage.removeItem('zp3_geo_park');
          _geoTdPlugin = saved.td; _geoParkModeOn = saved.park; window._supaUser = saved.user;
          window._geoParkRestored = saved.restored; _geoParkNote = saved.note;
        }
      });
      expect(r.restored).toBe(true);
      expect(r.calls).toEqual([{ on: false, reason: 'park restored, stream retired' }]);
    });

    test('a boot with no park says off, as before', async () => {
      const r = await page.evaluate(async () => {
        const saved = { td: _geoTdPlugin, user: window._supaUser, restored: window._geoParkRestored, note: _geoParkNote };
        const calls = [];
        _geoTdPlugin = () => ({ setWakeOnMove: (o) => { calls.push(o); return Promise.resolve({ on: false }); } });
        _geoParkNote = () => {};
        window._geoParkRestored = false; window._supaUser = { id: 'owner-uid' };
        localStorage.removeItem('zp3_geo_park');
        try { const restored = _geoParkRestore(); await new Promise(r => setTimeout(r, 10)); return { restored, calls }; }
        finally { _geoTdPlugin = saved.td; window._supaUser = saved.user; window._geoParkRestored = saved.restored; _geoParkNote = saved.note; }
      });
      expect(r.restored).toBe(false);
      expect(r.calls.map(c => c.on)).toEqual([false]);
    });

    test('an older shell dropping a stream is journalled and reaches nothing else', async () => {
      const r = await page.evaluate(async () => {
        const saved = { note: _geoParkNote, fixes: (window._geoFixLog || []).length, fence: _geoLastFenceLoc };
        const notes = [];
        _geoParkNote = (ev, x) => notes.push([ev, String(x)]);
        try {
          await _geoTdEvent({ type: 'wake-drop', ts: Date.now(), reason: 'tape says still', lat: 41.5, lng: -88.1 });
          await _geoTdEvent({ type: 'wake-drop', ts: Date.now(), reason: 'replayed', lat: 41.5, lng: -88.1 }, true);
          return { notes, fenceSame: _geoLastFenceLoc === saved.fence };
        } finally { _geoParkNote = saved.note; }
      });
      expect(r.notes).toEqual([['wake-drop', 'tape says still']]);
      expect(r.fenceSame, 'a drop never moves the fence machine').toBe(true);
    });

    // It said so inside the answer from iOS until 2026-09-26; that answer
    // waits for the next app open when the park happens as the app
    // backgrounds, so everything in the park now runs before it is awaited.
    test('park mode says off where it used to arm, before iOS answers (source guarantee)', () => {
      const src = readJs('geo-track.js');
      const a = src.indexOf('function _geoEnterParkMode(');
      const wait = src.indexOf('Promise.resolve(_armCall)', a);
      expect(a).toBeGreaterThan(-1);
      expect(wait).toBeGreaterThan(a);
      const off = src.indexOf("_geoWakeStreamOff('park armed, stream retired')", a);
      expect(off).toBeGreaterThan(a);
      expect(off, 'said in the same tick, not in the .then').toBeLessThan(wait);
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
