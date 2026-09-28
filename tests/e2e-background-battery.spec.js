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
    await page.evaluate(() => {
      const n = document.createElement('span'); n.id = '__onsite'; n.setAttribute('data-onsite-since', String(Date.now() - 3 * 3600000 - 5 * 60000));
      n.textContent = 'untouched'; document.body.appendChild(n);
    });
    await hide();
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

  test('no console errors, background battery', async () => { assertNoErrors(page); });
});
