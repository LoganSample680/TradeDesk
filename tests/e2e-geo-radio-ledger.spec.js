// @ts-check
// ── The radio ledger, JS side (owner 2026-09-08) ─────────────────────────────
//
// "Do I have something that tells me when the gps radio fires and the exact
// reason and time by user? If I don't I need that."
//
// The plugin writes one row per session change at the line that touches the
// receiver (TdGeoPlugin.radioLog, covered in native/tests). This spec covers
// the JS half of the contract:
//
//   * every call that can turn the receiver on carries a `reason`, so the row
//     the plugin writes says WHY and not just THAT;
//   * the one receiver the plugin cannot see (the background-geolocation
//     plugin's watcher) is written by JS through the same edge function, in
//     the same row shape, with source 'js';
//   * the reader is a pure render over geo_radio_day rows, so it is judged
//     here without a server, and the screen is only a frame around it.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the radio ledger', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Every plugin call that can turn the receiver on, driven through the real
  // JS entry point, with the plugin stubbed to record what it was asked.
  async function askedWith(run) {
    return page.evaluate(async (runSrc) => {
      const saved = { td: _geoTdPlugin, at: _geoDriveWinAt, why: _geoDriveWinWhy, asked: _geoDriveWinAskedAt,
        park: _geoParkModeOn, hb: _geoHbArmedAtMs, burstAt: _geoPingBurstAt };
      const calls = {};
      const rec = (name) => (o) => { (calls[name] = calls[name] || []).push(o || {}); return Promise.resolve({ on: true, armed: 1, seconds: 12, supported: true }); };
      _geoTdPlugin = () => ({
        setSampling: rec('setSampling'), burstFix: rec('burstFix'), startHeartbeat: rec('startHeartbeat'),
        stopHeartbeat: rec('stopHeartbeat'), setWakeOnMove: rec('setWakeOnMove'), startEvents: rec('startEvents'),
        startParked: rec('startParked'), stopAll: rec('stopAll'),
      });
      _geoDriveWinAt = 0; _geoDriveWinWhy = ''; _geoDriveWinAskedAt = 0; _geoHbArmedAtMs = 0; _geoPingBurstAt = 0;
      try {
        await (new Function('calls', runSrc))(calls);
        await new Promise(r => setTimeout(r, 30));
        return calls;
      } finally {
        _geoTdPlugin = saved.td; _geoDriveWinAt = saved.at; _geoDriveWinWhy = saved.why; _geoDriveWinAskedAt = saved.asked;
        _geoParkModeOn = saved.park; _geoHbArmedAtMs = saved.hb; _geoPingBurstAt = saved.burstAt;
      }
    }, run);
  }

  test.describe('every call that can turn the receiver on says why', () => {
    test('the drive window carries the reason it was opened for, and the one it was closed for', async () => {
      const c = await askedWith(`_geoDriveWindowOpen('flip: walking->automotive'); _geoDriveWindowClose('park');`);
      const open = (c.setSampling || []).find(o => o.mode === 'drive');
      const close = (c.setSampling || []).find(o => o.mode === 'coarse');
      expect(open && open.reason).toBe('flip: walking->automotive');
      expect(close && close.reason).toBe('park');
    });

    test('a ping burst names the ping', async () => {
      const c = await askedWith(`
        const keep = _geoPingBurstOk; _geoPingBurstOk = () => '';
        try { _geoPingBurst(); } finally { _geoPingBurstOk = keep; }`);
      expect((c.burstFix || [])[0] && c.burstFix[0].reason).toBe('push-ping burst');
    });

    test('the shift heartbeat says shift start; parking at home says so too', async () => {
      const c = await askedWith(`
        const keep = _placeIsLikelyHome; _placeIsLikelyHome = (p) => !!(p && p.lat === 39.9);
        try { _geoHeartbeatSync(null); _geoHeartbeatSync({ lat: 39.9, lng: -94.9 }); } finally { _placeIsLikelyHome = keep; }`);
      expect((c.startHeartbeat || [])[0] && c.startHeartbeat[0].reason).toBe('shift start');
      expect((c.stopHeartbeat || [])[0] && c.stopHeartbeat[0].reason).toBe('parked at home');
    });

    test('the wake-on-move stream says it was armed by a park', async () => {
      const c = await askedWith(`_geoWakeOnMoveArm(_geoTdPlugin());`);
      expect((c.setWakeOnMove || [])[0]).toEqual(expect.objectContaining({ on: true, reason: 'park armed' }));
    });

    test('a boot with no park to restore disarms the stream and says why', async () => {
      const c = await askedWith(`
        window._geoParkRestored = false; localStorage.removeItem('zp3_geo_park');
        _geoParkRestore();`);
      expect((c.setWakeOnMove || [])[0]).toEqual(expect.objectContaining({ on: false, reason: 'no park on this boot' }));
    });

    test('a park exit and a tracking stop each tell stopAll who is ending it', async () => {
      const c = await askedWith(`
        _geoParkModeOn = true; _geoExitParkMode();
        stopGeoTracking();`);
      const reasons = (c.stopAll || []).map(o => o.reason);
      expect(reasons).toContain('park exit');
      expect(reasons).toContain('tracking off');
    });

    test('the reason is a label on the call, never a separate row the plugin has to guess at', async () => {
      // The contract is the argument, so the plugin cannot be asked and the
      // ledger cannot be right without it. Source guarantee for the calls
      // above that are hard to drive end to end (the park arm's startEvents).
      const src = await page.evaluate(() => _geoEnterParkMode.toString());
      expect(src).toMatch(/startEvents\(\{regions:_regs,reason:_armReason\}\)/);
      expect(src).toMatch(/startParked\(\{regions:_regs\.slice\(0,1\),reason:_armReason\}\)/);
    });
  });

  test.describe('the JS-side rows', () => {
    // The watcher belongs to a different plugin; the row for it goes to the
    // same edge function the plugin flushes to, in the same shape.
    async function posted(run) {
      return page.evaluate(async (runSrc) => {
        const saved = { fetch: window.fetch, supa: window._supa, url: window._SUPA_DIRECT_URL, en: window.supaEnabled };
        const bodies = [];
        window.fetch = (url, opts) => { bodies.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };
        window._supa = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
        window._SUPA_DIRECT_URL = 'https://x.supabase.co';
        window.supaEnabled = () => true;
        try {
          (new Function(runSrc))();
          await new Promise(r => setTimeout(r, 30));
          return bodies;
        } finally { window.fetch = saved.fetch; window._supa = saved.supa; window._SUPA_DIRECT_URL = saved.url; window.supaEnabled = saved.en; }
      }, run);
    }

    test('a watcher row goes to ingest-geo with the ledger shape and source js', async () => {
      const b = await posted(`_geoRadioNote('js-watcher', true, 'tracking start');`);
      expect(b.length).toBe(1);
      expect(b[0].url).toMatch(/\/functions\/v1\/ingest-geo$/);
      const ev = b[0].body.events[0];
      expect(ev).toEqual(expect.objectContaining({ type: 'radio', session: 'js-watcher', on: true, reason: 'tracking start', trigger: 'js', source: 'js' }));
      expect(typeof ev.ts).toBe('number');
    });

    test('an OFF row carries no accuracy: nothing is being requested', async () => {
      const b = await posted(`_geoRadioNote('js-watcher', false, 'tracking off');`);
      const ev = b[0].body.events[0];
      expect(ev.on).toBe(false);
      expect(ev.accuracy).toBeUndefined();
    });

    test('a reason is bounded to the label the server keeps', async () => {
      const b = await posted(`_geoRadioNote('js-watcher', true, 'x'.repeat(500));`);
      expect(b[0].body.events[0].reason.length).toBe(60);
    });

    test('with the cloud off nothing is posted and nothing throws', async () => {
      const r = await page.evaluate(() => {
        const keep = window.supaEnabled; window.supaEnabled = () => false;
        try { _geoRadioNote('js-watcher', true, 'x'); return true; } catch (_e) { return false; } finally { window.supaEnabled = keep; }
      });
      expect(r).toBe(true);
    });

    test('the clock stamp rides the same poster', async () => {
      // One fetch for every JS-originated event (7.3). A second copy of the
      // poster is how the two drift apart.
      const src = await page.evaluate(() => _geoClockPing.toString());
      expect(src).toContain('_geoIngestPost([ev])');
      expect(src).not.toContain('functions/v1/ingest-geo');
    });
  });

  test.describe('the reader', () => {
    const row = (o) => Object.assign({ session: 'drive', on_at: '2026-09-08T13:00:00Z', off_at: '2026-09-08T13:20:00Z',
      minutes: 20, accuracy: 'best', reason: 'flip', off_reason: 'park', trigger: 'js', source: 'native', open: false }, o);

    test('an empty day says so', async () => {
      const h = await page.evaluate(() => _geoRadioRender([]));
      expect(h).toMatch(/Nothing on the ledger/);
    });

    test('a session reads as a sentence: what, when to when, how long, why', async () => {
      const h = await page.evaluate((r) => _geoRadioRender([r]), row({}));
      expect(h).toContain('Drive window');
      expect(h).toContain('20m');
      expect(h).toContain('on: flip');
      expect(h).toContain('off: park');
    });

    test('the headline is receiver minutes, and fences and the stream session itself are not receiver minutes', async () => {
      // His own morning: the stream's session row is the indicator, the burn
      // is its moving episodes. Fences hold no receiver at all.
      const h = await page.evaluate((rows) => _geoRadioRender(rows), [
        row({ session: 'fences', minutes: 600 }),
        row({ session: 'wake-stream', minutes: 600 }),
        row({ session: 'wake-moving', minutes: 13 }),
        row({ session: 'wake-moving', minutes: 11 }),
        row({ session: 'drive', minutes: 9 }),
      ]);
      expect(h).toMatch(/Receiver on 33 min/);
    });

    test('an open session is marked still running, at the top and on the row', async () => {
      const h = await page.evaluate((r) => _geoRadioRender([r]), row({ open: true, off_at: null, session: 'wake-moving', minutes: 41 }));
      expect(h).toContain('still running');
      expect(h).toContain('→ now');
    });

    test('iOS as the trigger is said, because nobody in JS asked for it', async () => {
      const h = await page.evaluate((r) => _geoRadioRender([r]), row({ session: 'wake-moving', trigger: 'ios', reason: 'iOS: movement resumed', off_reason: 'iOS: stationary' }));
      expect(h).toContain('by ios');
      expect(h).toContain('Wake stream: radio running');
    });

    test('an unknown session name still renders, as itself', async () => {
      const h = await page.evaluate((r) => _geoRadioRender([r]), row({ session: 'something-new' }));
      expect(h).toContain('something-new');
    });

    test('junk rows never throw', async () => {
      const ok = await page.evaluate(() => {
        try {
          _geoRadioRender(null); _geoRadioRender('x'); _geoRadioRender([null, {}, { session: 'drive' }, { session: 'drive', minutes: 'abc', on_at: 'nope' }]);
          return true;
        } catch (_e) { return false; }
      });
      expect(ok).toBe(true);
    });

    test('the screen is the app\'s one modal, fed by the one server function', async () => {
      const r = await page.evaluate(async () => {
        const saved = window._supa;
        window._supa = { rpc: async (fn, args) => ({ data: [{ session: 'burst', on_at: '2026-09-08T13:00:00Z', off_at: '2026-09-08T13:00:12Z', minutes: 0.2, reason: 'push-ping burst', off_reason: 'timer', trigger: 'js', open: false }], error: null, fn, args }) };
        let asked = null;
        const realRpc = window._supa.rpc; window._supa.rpc = async (fn, args) => { asked = { fn, args }; return realRpc(fn, args); };
        try {
          await openRadioLedger('uid-1', 'Jack', '2026-09-08');
          const ov = document.getElementById('_geo-radio-ov');
          const out = { modal: !!(ov && ov.querySelector('.zmodal')), text: ov ? ov.textContent : '', asked };
          ov && ov.remove();
          return out;
        } finally { window._supa = saved; }
      });
      expect(r.modal).toBe(true);
      expect(r.asked).toEqual({ fn: 'geo_radio_day', args: { p_uid: 'uid-1', p_day: '2026-09-08' } });
      expect(r.text).toContain('Jack');
      expect(r.text).toContain('Ping burst');
    });

    test('a server error is said on the screen, not swallowed', async () => {
      const t = await page.evaluate(async () => {
        const saved = window._supa;
        window._supa = { rpc: async () => ({ data: null, error: new Error('permission denied for function geo_radio_day') }) };
        try {
          await openRadioLedger('uid-1', 'Jack', '2026-09-08');
          const ov = document.getElementById('_geo-radio-ov'); const t = ov ? ov.textContent : ''; ov && ov.remove(); return t;
        } finally { window._supa = saved; }
      });
      expect(t).toMatch(/Could not load the ledger/);
    });

    test('the crew map offers it beside Locate, on the same function', async () => {
      // The button is markup inside day-map.js; assert on the served source
      // so a rename of the renderer does not silently lose the button.
      const dm = await page.evaluate(async () => (await (await fetch('/js/day-map.js')).text()));
      expect(dm).toMatch(/openRadioLedger\(/);
      expect(dm).toMatch(/_dm-radio/);
    });
  });

  test('no console errors across the ledger', async () => {
    assertNoErrors(page, 'radio ledger');
  });
});
