// @ts-check
// ── Nothing polls or ticks for a screen nobody can see (owner 2026-09-28) ────
//
// Jack's phone ran 4 to 5% an hour for weeks and 8 to 10% the first day
// keep-awake held the app alive in his pocket. Keep-awake itself is a 3km
// location session, cheap. What it kept alive was a page acting as though
// somebody was looking at it: the server logs show his phone asking "anything
// new?" about every 15 seconds all morning, because the hidden throttle on the
// reconcile heartbeat measured the last LOAD, and a check that finds nothing
// never loads. Plus an inbox poll every 30 seconds and four once-a-second
// display ticks.
//
// Keep-awake stays on (owner: "I want it under 10 seconds"). The page just
// stops working for an audience that is not there.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('a backgrounded page does no screen work', () => {
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

  // The phone in a pocket, and back out again. An own property shadows the
  // prototype getter; deleting it restores the real one.
  const hide = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  const show = () => page.evaluate(() => { delete document.hidden; delete document.visibilityState; });
  test.afterEach(async () => { await show(); });

  test('the reconcile heartbeat throttles from the last CHECK, not the last load', async () => {
    const body = await page.evaluate(async () => (await fetch('/js/cloud.js')).text());
    const tick = body.slice(body.indexOf('const _heartbeatTick=()=>{'), body.indexOf('setTimeout(_heartbeatTick,_RECONCILE_HEARTBEAT_MS);'));
    expect(tick, 'measured from whichever came last, the load or the hidden check').toContain('Math.max(window._lastCloudLoadAt||0,window._lastHiddenCursorAt||0)');
    expect(tick, 'and a hidden check is what stamps it').toContain('if(_hid)window._lastHiddenCursorAt=Date.now();');
    expect(tick).toContain('_HIDDEN_CURSOR_MIN_MS');
    expect(body).toMatch(/const _HIDDEN_CURSOR_MIN_MS=60000;/);
  });

  test('the inbox poll skips a hidden page', async () => {
    const body = await page.evaluate(async () => (await fetch('/js/cloud.js')).text());
    expect(body).toContain('setInterval(()=>{if(!document.hidden)_loadPendingInbound();},30000);');
    expect(body, 'the unconditional poll is gone').not.toContain('setInterval(()=>_loadPendingInbound(),30000);');
  });

  test('the clock banner does not tick while hidden, and catches up the moment it shows', async () => {
    await page.evaluate(() => {
      window.__keepTimer = _activeTimer;
      let el = document.getElementById('clock-banner-time');
      if (!el) { el = document.createElement('span'); el.id = 'clock-banner-time'; el.dataset.tmp = '1'; document.body.appendChild(el); }
      el.textContent = 'untouched';
      _activeTimer = { jobId: 'j1', jobName: 'J', clientName: 'C', scopeLabel: null, startTime: Date.now() - 125000, timerInterval: null };
    });
    await hide();
    const hidden = await page.evaluate(() => { updateClockTimer(); return document.getElementById('clock-banner-time').textContent; });
    await show();
    const shown = await page.evaluate(() => {
      updateClockTimer();
      const t = document.getElementById('clock-banner-time').textContent;
      _activeTimer = window.__keepTimer;
      const el = document.getElementById('clock-banner-time'); if (el && el.dataset.tmp) el.remove();
      return t;
    });
    expect(hidden).toBe('untouched');
    expect(shown).not.toBe('untouched');
    expect(shown).toMatch(/2/);
  });

  test('the on-site figure does not tick while hidden', async () => {
    // Hidden FIRST. The app's own once-a-second ticker is running, so a figure
    // planted on a visible page can be written by it before the hide lands,
    // and the test then reads the ticker's work as if it ran while hidden
    // (webkit, shard 1, 2026-10-01).
    await hide();
    await page.evaluate(() => {
      const n = document.createElement('span'); n.id = '__onsite'; n.setAttribute('data-onsite-since', String(Date.now() - 3 * 3600000 - 5 * 60000));
      n.textContent = 'untouched'; document.body.appendChild(n);
    });
    const hidden = await page.evaluate(() => { _geoOnsiteTick(); return document.getElementById('__onsite').textContent; });
    await show();
    const shown = await page.evaluate(() => { _geoOnsiteTick(); const n = document.getElementById('__onsite'); const t = n.textContent; n.remove(); return t; });
    expect(hidden).toBe('untouched');
    expect(shown).toBe('3h 5m');
  });

  test('the drive timer does not tick while hidden', async () => {
    await page.evaluate(() => {
      window.__keepGpsStart = gps.startTime;
      let el = document.getElementById('cd-timer');
      if (!el) { el = document.createElement('span'); el.id = 'cd-timer'; el.dataset.tmp = '1'; document.body.appendChild(el); }
      el.textContent = 'untouched';
      gps.startTime = Date.now() - 65000;
    });
    await hide();
    const hidden = await page.evaluate(() => { updateDriveTimer(); return document.getElementById('cd-timer').textContent; });
    await show();
    const shown = await page.evaluate(() => {
      updateDriveTimer();
      const el = document.getElementById('cd-timer'); const t = el.textContent;
      if (el.dataset.tmp) el.remove();
      gps.startTime = window.__keepGpsStart;
      return t;
    });
    expect(hidden).toBe('untouched');
    expect(shown).toMatch(/^1:0[5-9]$/);
  });

  test('none of them throw with their targets missing, hidden or not', async () => {
    const ok = await page.evaluate(() => {
      try {
        const keep = { t: _activeTimer, g: gps.startTime };
        _activeTimer = null; gps.startTime = 0;
        updateClockTimer(); updateDriveTimer(); _geoOnsiteTick();
        _activeTimer = keep.t; gps.startTime = keep.g;
        return true;
      } catch (e) { return String(e.message); }
    });
    expect(ok).toBe(true);
    await hide();
    const ok2 = await page.evaluate(() => { try { updateClockTimer(); updateDriveTimer(); _geoOnsiteTick(); return true; } catch (e) { return String(e.message); } });
    expect(ok2).toBe(true);
  });

  // ── ON SCREEN IS NOT MOVING (owner 2026-09-30) ─────────────────────────
  // Jack opened the app 65 times one morning, standing at the yard or at home,
  // and every open switched full-accuracy GPS on: 33 starts. An open lights the
  // GPS now only when the motion tape says the truck is moving.
  test('opening the app while standing still does not light the GPS', async () => {
    const r = await page.evaluate(async () => {
      const was = { k: _geoLastMotionKind, win: _geoDriveWinAt, drv: _geoDriveStartedAt };
      const out = {};
      try {
        _geoDriveWinAt = 0; _geoDriveStartedAt = null;
        for (const k of ['still', 'walking', 'automotive', 'cycling', '']) {
          _geoLastMotionKind = k;
          out[k || 'unknown'] = _geoLooksMoving();
        }
      } finally { _geoLastMotionKind = was.k; _geoDriveWinAt = was.win; _geoDriveStartedAt = was.drv; }
      // The three places an open used to light the GPS, all asking now. The
      // foreground handler is only bound once tracking starts, so it is read
      // off the source rather than fired here.
      const src = await (await fetch('/js/geo-track.js')).text();
      return { out,
        onOpen: src.includes('if(_geoParkModeOn&&_geoLooksMoving())_geoExitParkMode();'),
        onBoot: src.includes('if(_geoAppOnScreen()&&_geoLooksMoving()){_geoExitParkMode();return;}'),
        onPark: src.includes("if(_geoAppOnScreen()&&_geoLooksMoving()){\n    _geoParkNote('park-defer','app on screen');"),
        bare: (src.match(/if\(_geoParkModeOn\)_geoExitParkMode\(\);/g) || []).length };
    });
    expect(r.out, 'still and walking are not moving; a drive is; unknown behaves as before')
      .toEqual({ still: false, walking: false, automotive: true, cycling: true, unknown: true });
    expect([r.onOpen, r.onBoot, r.onPark], 'the open, the boot and the park defer all ask').toEqual([true, true, true]);
    expect(r.bare, 'no unconditional exit left behind').toBe(0);
  });

  test('a drive already running counts as moving, whatever the last reading', async () => {
    const r = await page.evaluate(() => {
      const was = { k: _geoLastMotionKind, win: _geoDriveWinAt, drv: _geoDriveStartedAt };
      try {
        _geoLastMotionKind = 'still'; _geoDriveWinAt = 0; _geoDriveStartedAt = Date.now() - 60000;
        const a = _geoLooksMoving();
        _geoDriveStartedAt = null; _geoDriveWinAt = Date.now();
        const b = _geoLooksMoving();
        return { a, b };
      } finally { _geoLastMotionKind = was.k; _geoDriveWinAt = was.win; _geoDriveStartedAt = was.drv; }
    });
    expect(r).toEqual({ a: true, b: true });
  });

  // ── IN A POCKET, NOTHING LISTENS (owner 2026-10-01) ─────────────────────
  // Jack's 30 September: 2.5%/hr before the shift keep-awake, 4 to 10%/hr
  // after, 10%/hr standing still at the shop. The page held its realtime socket
  // open in his pocket and every row the server wrote was pushed back to it.
  // A fake client records what the pocket does to it.
  const fakeSupa = () => page.evaluate(() => {
    window.__realSupa = window._supa;
    window.__realCap = window.Capacitor;
    window.Capacitor = Object.assign({}, window.__realCap || {}, { isNativePlatform: () => true });
    window.__keep = { sub: _realtimeSubscribed, emp: typeof _isEmployee !== 'undefined' ? _isEmployee : false, user: window._supaUser };
    const log = window.__rt = { removed: [], disconnects: 0, connects: 0, joined: [] };
    const chan = (topic) => { const c = { topic: 'realtime:' + topic, on() { return c; }, subscribe() { log.joined.push(topic); return c; }, send() {} }; return c; };
    const live = [chan('td-sync-u1'), chan('sig-feed-u1'), chan('user-data-u1'), chan('td-crew-c1')];
    window._supa = {
      getChannels: () => live.slice(),
      removeChannel: (c) => { log.removed.push(c.topic.replace('realtime:', '')); live.splice(live.indexOf(c), 1); },
      removeAllChannels: () => { live.length = 0; },
      channel: (t) => chan(t),
      realtime: { disconnect() { log.disconnects++; }, connect() { log.connects++; } },
      auth: window.__realSupa && window.__realSupa.auth,
    };
    window._supaUser = { id: 'u1' };
    // Crew-locate joins its own channel on a timer of its own. Inside this fake
    // window it would join 'td-crew-u1' on the fake client whenever that timer
    // happened to land, and the pocket then (rightly) closed it too, so the
    // list below grew a fifth name on some runs and not others (webkit, #149,
    // 2026-10-02). The channels in play are the four above, every run.
    window.__realCrewLocateInit = _crewLocateInit;
    _crewLocateInit = () => null;
    _realtimeSubscribed = true;
    window.__reconciles = 0;
    window.__realReconcile = _scheduleReconcile;
    _scheduleReconcile = () => { window.__reconciles++; };
  });
  const restoreSupa = () => page.evaluate(() => {
    if (_rtPocketT) { clearTimeout(_rtPocketT); _rtPocketT = null; }
    _rtPocketed = false;
    window._supa = window.__realSupa; window._supaUser = window.__keep.user;
    window.Capacitor = window.__realCap;
    _realtimeSubscribed = window.__keep.sub; _isEmployee = window.__keep.emp;
    _scheduleReconcile = window.__realReconcile;
    _crewLocateInit = window.__realCrewLocateInit;
  });

  test('an owner phone in a pocket closes the socket, and reopens and catches up on screen', async () => {
    await fakeSupa();
    try {
      await hide();
      const pocket = await page.evaluate(() => { _isEmployee = false; const did = _rtPocket(); return { did, pocketed: _rtPocketed, rt: JSON.parse(JSON.stringify(window.__rt)) }; });
      await show();
      const back = await page.evaluate(() => { const did = _rtUnpocket(); return { did, pocketed: _rtPocketed, rt: window.__rt, reconciles: window.__reconciles }; });
      expect(pocket.did).toBe(true);
      expect(pocket.pocketed).toBe(true);
      expect(pocket.rt.removed.sort(), 'every channel, Locate included: nobody locates the owner').toEqual(['sig-feed-u1', 'td-crew-c1', 'td-sync-u1', 'user-data-u1']);
      expect(pocket.rt.disconnects).toBe(1);
      expect(back.did).toBe(true);
      expect(back.pocketed).toBe(false);
      expect(back.rt.connects).toBe(1);
      expect(back.rt.joined, 'the data channels come back').toEqual(expect.arrayContaining(['td-sync-u1', 'sig-feed-u1', 'user-data-u1']));
      expect(back.reconciles, 'one catch-up for whatever the socket missed').toBe(1);
    } finally { await restoreSupa(); }
  });

  test('a crew phone keeps the Locate channel open in the pocket', async () => {
    await fakeSupa();
    try {
      await hide();
      const r = await page.evaluate(() => { _isEmployee = true; _rtPocket(); return JSON.parse(JSON.stringify(window.__rt)); });
      expect(r.removed.sort()).toEqual(['sig-feed-u1', 'td-sync-u1', 'user-data-u1']);
      expect(r.disconnects, 'the socket stays up for the manager asking where the truck is').toBe(0);
    } finally { await restoreSupa(); }
  });

  test('an app switch is not a pocket: nothing closes inside the grace, and a visible screen closes nothing', async () => {
    await fakeSupa();
    try {
      await hide();
      const armed = await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); return { timer: !!_rtPocketT, pocketed: _rtPocketed, removed: window.__rt.removed.length, grace: _RT_POCKET_GRACE_MS }; });
      await show();
      const back = await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); return { timer: !!_rtPocketT, pocketed: _rtPocketed, removed: window.__rt.removed.length, again: _rtPocket() }; });
      expect(armed).toEqual({ timer: true, pocketed: false, removed: 0, grace: 30000 });
      expect(back).toEqual({ timer: false, pocketed: false, removed: 0, again: false });
    } finally { await restoreSupa(); }
  });

  test('signing out while pocketed leaves nothing to reopen under the next account', async () => {
    await fakeSupa();
    try {
      await hide();
      const r = await page.evaluate(() => { _isEmployee = false; _rtPocket(); _teardownRealtimeChannels(); return { pocketed: _rtPocketed, reopened: _rtUnpocket() }; });
      expect(r).toEqual({ pocketed: false, reopened: false });
    } finally { await restoreSupa(); }
  });

  test('a browser tab never pockets: only the native shell is held awake', async () => {
    await fakeSupa();
    try {
      await hide();
      const r = await page.evaluate(() => {
        window.Capacitor = window.__realCap;              // a plain browser
        document.dispatchEvent(new Event('visibilitychange'));
        return { timer: !!_rtPocketT, did: _rtPocket(), removed: window.__rt.removed.length };
      });
      expect(r).toEqual({ timer: false, did: false, removed: 0 });
    } finally { await restoreSupa(); }
  });

  // Born in a pocket: iOS killed Jack's app at 10:01 and relaunched it in the
  // background, so the screen never came on and no 'hidden' change ever fired.
  test('an app relaunched in the background arms the pocket as its channels open', async () => {
    await fakeSupa();
    try {
      await hide();
      const r = await page.evaluate(() => {
        _isEmployee = false;
        _rtArmPocket();
        const armed = !!_rtPocketT;
        clearTimeout(_rtPocketT); _rtPocketT = null;
        return armed;
      });
      const src = await page.evaluate(async () => (await fetch('/js/cloud.js')).text());
      expect(r, 'a hidden boot starts the same countdown the screen going off would').toBe(true);
      expect(src, 'and it is called where the channels open').toMatch(/_initRealtimeSubscriptions\(uid\);[\s\S]{0,600}?_rtArmPocket\(\);\}/);
    } finally { await restoreSupa(); }
  });

  test('a visible boot arms nothing', async () => {
    await fakeSupa();
    try {
      const r = await page.evaluate(() => { _rtArmPocket(); return !!_rtPocketT; });
      expect(r).toBe(false);
    } finally { await restoreSupa(); }
  });

  test('pocketed, the background check drops to once every five minutes', async () => {
    const body = await page.evaluate(async () => (await fetch('/js/cloud.js')).text());
    expect(body).toMatch(/const _HIDDEN_CURSOR_POCKET_MS=300000;/);
    expect(body).toContain('const _hidMin=_rtPocketed?_HIDDEN_CURSOR_POCKET_MS:_HIDDEN_CURSOR_MIN_MS;');
  });

  test('rows never ride the socket: the geo upload is a plain post to ingest-geo', async () => {
    const src = await page.evaluate(async () => (await fetch('/js/geo-track.js')).text());
    const fn = src.slice(src.indexOf('function _geoIngestPost('), src.indexOf('function _geoIngestPost(') + 1500);
    expect(fn).toContain('ingest-geo');
    expect(fn).not.toMatch(/\.channel\(|realtime/);
  });

  test('no console errors, background battery', async () => { assertNoErrors(page); });
});
