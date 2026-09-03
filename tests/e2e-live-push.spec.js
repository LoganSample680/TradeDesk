// @ts-check
/**
 * Live Activities + remote push, the JS halves (owner ask 2026-08-17).
 *
 * Both features are native, so what CAN be tested offline is the part that
 * actually holds the rules: every decision lives in JS by design (CLAUDE.md
 * 3.2), so these specs drive js/live-activity.js and js/push.js against a fake
 * plugin and assert the payloads, the update economy, and the teardown.
 *
 * The economy matters as much as the correctness: ActivityKit budgets updates,
 * and the geo engine pings far more often than the card changes, so an
 * unchanged ping MUST NOT spend one.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// Install a fake Capacitor + TdLive/TdPush before the app boots, so the modules
// resolve a "native" platform and every call is recorded for inspection.
async function fakeNative(page) {
  await page.addInitScript(() => {
    const calls = [];
    window.__td = { calls, listeners: {} };
    const rec = (name) => (args) => { calls.push({ name, args: args || {} }); return Promise.resolve({ ok: true }); };
    const TdLive = {
      isSupported: () => Promise.resolve({ supported: true, enabled: true }),
      start: rec('start'), update: rec('update'), end: rec('end'), endAll: rec('endAll'),
      addListener: (ev, cb) => { window.__td.liveListeners = window.__td.liveListeners || {}; window.__td.liveListeners[ev] = cb; return { remove() {} }; },
    };
    const TdPush = {
      permission: () => Promise.resolve({ status: 'ask' }),
      register: rec('register'),
      lastTap: () => Promise.resolve({}),
      addListener: (ev, cb) => { window.__td.listeners[ev] = cb; return { remove() {} }; },
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      registerPlugin: (n) => (n === 'TdLive' ? TdLive : n === 'TdPush' ? TdPush : {}),
      Plugins: { TdLive, TdPush },
    };
  });
}

test.describe('Live Activities: what reaches the lock screen', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await fakeNative(page);
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.beforeEach(async () => { await page.evaluate(() => { window.__td.calls.length = 0; }); });
  test.afterEach(() => { assertNoErrors(page, 'live activity'); });

  test('clocking in starts a timer card carrying the client, not a per-second string', async () => {
    const r = await page.evaluate(async () => {
      const t = { jobId: 1, jobName: 'Repaint', clientName: 'FBC', scopeLabel: 'Interior', startTime: 1755000000000 };
      _liveActClockIn(t);
      await new Promise(r => setTimeout(r, 60));
      return window.__td.calls.map(c => ({ name: c.name, a: c.args }));
    });
    expect(r.length).toBe(1);
    expect(r[0].name).toBe('start');
    expect(r[0].a.channel).toBe('clock');
    expect(r[0].a.kind).toBe('CLOCKED IN');
    expect(r[0].a.title).toBe('FBC');
    expect(r[0].a.detail).toBe('Interior');
    // The clock must be rendered on-device from a start time, never pushed.
    expect(r[0].a.timer).toBe(true);
    expect(r[0].a.startedAt).toBe(1755000000);
    // Two-clock card (owner feedback 2026-08-19): site arrival and step start
    // are the same instant for a fresh job, so both clocks match here.
    expect(r[0].a.dualTimer).toBe(true);
    expect(r[0].a.siteStartedAt).toBe(1755000000);
  });

  // ── Lock-screen "Next"/"Clock out" button payload (owner 2026-08-19) ──────
  // Mocks the plugin call (same style as the rest of this file) and asserts
  // the SHAPE the widget's LiveActivityIntent depends on: jobId,
  // contractorUserId, and the next-scope chain, all embedded so the button
  // never has to fetch anything before it can act.
  test.describe('lock-screen scope-switch payload', () => {
    test.afterEach(async () => {
      await page.evaluate(() => {
        jobs = (jobs || []).filter(j => j.id !== 88801);
        bids = (bids || []).filter(b => b.id !== 88901);
      });
    });

    test('carries job/account identity even for a job outside the local fixtures', async () => {
      const r = await page.evaluate(async () => {
        window.__td.calls.length = 0;
        _liveActClockIn({ jobId: 5, jobName: 'X', clientName: 'Y', scopeLabel: '', startTime: Date.now() });
        await new Promise(res => setTimeout(res, 60));
        return window.__td.calls[0].args;
      });
      expect(r.jobId).toBe('5');
      expect(typeof r.contractorUserId).toBe('string');
      expect(typeof r.loggedByUid).toBe('string');
      expect(typeof r.supaBaseUrl).toBe('string');
      // No scopeId was passed: currentScopeId is empty, and the fallback
      // default scope list still gives the button somewhere to go.
      expect(r.currentScopeId).toBe('');
      expect(r.nextScopeId).not.toBe('');
      expect(r.isLastScope).toBe(false);
      expect(() => JSON.parse(r.scopeQueue)).not.toThrow();
      expect(Array.isArray(JSON.parse(r.scopeQueue))).toBe(true);
    });

    test('the next scope is whatever comes after the current one in getJobScopes order', async () => {
      const r = await page.evaluate(async () => {
        jobs = (jobs || []).filter(j => j.id !== 88801);
        bids = (bids || []).filter(b => b.id !== 88901);
        bids.push({
          id: 88901, client_id: 1, amount: 100, status: 'Closed Won',
          roomScopeMap: { Room: { sand: { active: true }, prime: { active: true }, cleanup: { active: true } } },
        });
        jobs.push({ id: 88801, client_id: 1, bid_id: 88901, name: 'Live push fixture job', eventType: 'job', status: 'scheduled' });
        window.__td.calls.length = 0;
        // Clocked into the FIRST of three scopes: Next should point at the second.
        _liveActClockIn({ jobId: 88801, jobName: 'Live push fixture job', clientName: 'Live push fixture job', scopeId: 'sand', scopeLabel: 'Sanding', startTime: Date.now() });
        await new Promise(res => setTimeout(res, 60));
        return window.__td.calls[0].args;
      });
      expect(r.currentScopeId).toBe('sand');
      expect(r.nextScopeId).toBe('prime');
      expect(r.nextScopeLabel).toBeTruthy();
      expect(r.isLastScope).toBe(false);
      const queue = JSON.parse(r.scopeQueue);
      expect(queue.map(s => s.id)).toEqual(['cleanup']);
    });

    test('clocked into the LAST scope: isLastScope true, empty next, empty queue (button reads "Clock out")', async () => {
      const r = await page.evaluate(async () => {
        jobs = (jobs || []).filter(j => j.id !== 88801);
        bids = (bids || []).filter(b => b.id !== 88901);
        bids.push({
          id: 88901, client_id: 1, amount: 100, status: 'Closed Won',
          roomScopeMap: { Room: { sand: { active: true }, prime: { active: true } } },
        });
        jobs.push({ id: 88801, client_id: 1, bid_id: 88901, name: 'Live push fixture job', eventType: 'job', status: 'scheduled' });
        window.__td.calls.length = 0;
        _liveActClockIn({ jobId: 88801, jobName: 'Live push fixture job', clientName: 'Live push fixture job', scopeId: 'prime', scopeLabel: 'Primer coat', startTime: Date.now() });
        await new Promise(res => setTimeout(res, 60));
        return window.__td.calls[0].args;
      });
      expect(r.isLastScope).toBe(true);
      expect(r.nextScopeId).toBe('');
      expect(r.nextScopeLabel).toBe('');
      expect(JSON.parse(r.scopeQueue)).toEqual([]);
    });

    test('null/undefined jobId, does not throw and yields a terminal (no-button) shape', async () => {
      const r = await page.evaluate(async () => {
        window.__td.calls.length = 0;
        let threw = false;
        try {
          _liveActClockIn({ jobId: null, jobName: 'No job', clientName: 'No job', startTime: Date.now() });
          _liveActClockIn({ jobId: undefined, jobName: 'No job', clientName: 'No job', startTime: Date.now() });
        } catch (e) { threw = true; }
        await new Promise(res => setTimeout(res, 60));
        return { threw, last: window.__td.calls.length ? window.__td.calls[window.__td.calls.length - 1].args : null };
      });
      expect(r.threw).toBe(false);
      expect(r.last).not.toBeNull();
      expect(r.last.jobId).toBe('');
    });
  });

  test('the title is never repeated underneath itself', async () => {
    const r = await page.evaluate(async () => {
      // No scope label and no separate client: detail would duplicate the title.
      _liveActClockIn({ jobId: 2, jobName: 'Smith', clientName: 'Smith', scopeLabel: '', startTime: Date.now() });
      await new Promise(r => setTimeout(r, 60));
      return window.__td.calls[0].args;
    });
    expect(r.title).toBe('Smith');
    expect(r.detail).toBe('');
  });

  test('clocking out ends the card', async () => {
    const r = await page.evaluate(async () => {
      _liveActClockOut();
      await new Promise(r => setTimeout(r, 60));
      return window.__td.calls.map(c => ({ name: c.name, ch: c.args.channel }));
    });
    expect(r).toEqual([{ name: 'end', ch: 'clock' }]);
  });

  // Regression (CI, webkit shard 1, 2026-09-03): the not-ready diagnostic
  // toasted on EVERY caller, including the ordinary web case where there is
  // no Capacitor at all. That put a floating element over the Home card
  // between a visibility check and a boundingBox measurement, and it would
  // have popped a meaningless toast on every arrival for every web user.
  // A person can only act on the on-device cases, so only those speak.
  test('no plugin at all is silent: the web app never toasts about Live Activities', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const toasts = [];
      const realToast = window._toast;
      window._toast = (m) => { toasts.push(String(m)); };
      window.Capacitor = { isNativePlatform: () => false, registerPlugin: () => ({}), Plugins: {} };
      try {
        // Force the readiness cache to re-evaluate against the web platform.
        const keep = window._liveSupported; window._liveSupported = undefined;
        const ok = await _liveActSet('drive', { kind: 'DRIVING', title: 'On the road' });
        window._liveSupported = keep;
        return { ok, toasts };
      } finally { window.Capacitor = realCap; window._toast = realToast; }
    });
    expect(r.ok).toBe(false);
    expect(r.toasts).toEqual([]);
  });

  // Owner 2026-09-03, home for the evening with the card still up: "I need it
  // to go away or be very small, right now it's wasted space running when I'm
  // home and done working."
  test('no on-site card at the house, and an existing one ends on arrival there', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const since = Date.now() - 45 * 60000;
      const atDoe = { id: 'd-doe', name: 'John Doe', kind: 'client', sinceTs: since, atHome: false, fence: {} };
      const atHouse = { id: 'd-home', name: 'TradeDesk shop', kind: 'shop', sinceTs: Date.now() - 5 * 60000, atHome: true, fence: {} };
      // A real visit puts a card up.
      _liveActOnSite(atDoe); await new Promise(r => setTimeout(r, 60));
      const atWork = window.__td.calls.filter(c => c.name === 'start').length;
      // Driving home and arriving: the card comes down, nothing replaces it.
      const homeAccepted = _liveActOnSite(atHouse);
      await new Promise(r => setTimeout(r, 60));
      const ended = window.__td.calls.filter(c => c.name === 'end').length;
      const startsAfter = window.__td.calls.filter(c => c.name === 'start').length;
      // And asking again at home never puts one back.
      _liveActOnSite(atHouse); await new Promise(r => setTimeout(r, 60));
      return { atWork, homeAccepted, ended, startsAfter,
               startsFinal: window.__td.calls.filter(c => c.name === 'start').length };
    });
    expect(r.atWork).toBe(1);          // a client visit is worth a card
    expect(r.homeAccepted).toBe(false); // the house is not
    expect(r.ended).toBe(1);            // and it took the old one down
    expect(r.startsAfter).toBe(1);      // nothing started in its place
    expect(r.startsFinal).toBe(1);      // still nothing, however often we ask
  });

  // The one that actually explains the whole day (owner 2026-09-03, confirmed
  // from his own telemetry): liveact_refused carried iOS's own words, "The
  // operation couldn't be completed. Target is not foreground". ActivityKit
  // refuses Activity.request() from a backgrounded app. Every on-site card is
  // requested by the geo engine with the phone in a pocket, so every one was
  // refused; the drive card flashed up for a second only because he happened
  // to have the app open at that instant.
  test('a start refused for being backgrounded is replayed the next time the app is on screen', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const P = window.Capacitor.registerPlugin('TdLive');
      const realStart = P.start;
      let backgrounded = true;
      P.start = (args) => {
        window.__td.calls.push({ name: 'start', args: args || {} });
        return Promise.resolve(backgrounded
          ? { ok: false, reason: "The operation couldn't be completed. Target is not foreground" }
          : { ok: true, id: 'a1' });
      };
      try {
        const since = Date.now() - 30 * 60000;
        const dwell = { id: 'd-fg', name: 'John Doe', kind: 'client', sinceTs: since, fence: { addr: '2950 SW McClure Rd' } };
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 60));
        const afterRefusal = window.__td.calls.filter(c => c.name === 'start').length;
        // The phone comes back on screen. The held payload is replayed.
        //
        // _liveActForeground is called directly rather than by dispatching a
        // visibilitychange event: that event wakes EVERY listener in the app,
        // including the cloud sync, which then failed against this spec's
        // Supabase stub and tripped assertNoErrors in a later test on shard 3.
        // The listener wiring itself is one line and is not what this asserts.
        backgrounded = false;
        await _liveActForeground();
        await new Promise(r => setTimeout(r, 120));
        const afterForeground = window.__td.calls.filter(c => c.name === 'start').length;
        // And the card that is now up is remembered, so an unchanged assert
        // does not spend another ActivityKit call.
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 60));
        const afterRepeat = window.__td.calls.filter(c => c.name === 'start').length;
        return { afterRefusal, afterForeground, afterRepeat };
      } finally { P.start = realStart; await _liveActEndAll(); }
    });
    expect(r.afterRefusal).toBe(1);          // refused while backgrounded
    expect(r.afterForeground).toBe(2);       // replayed on foreground
    expect(r.afterRepeat).toBe(2);           // and then deduped
  });

  // Regression (owner 2026-09-03: nothing on the island all day, on drive,
  // arrival OR departure). The plugin RESOLVES {ok:false, reason} when
  // ActivityKit refuses; _liveActSet used to cache the state signature
  // anyway, so that one refusal was permanent: every later call with the
  // same state hit the dedup and returned without ever retrying the start.
  test('a refused start is not remembered, so the next assert retries it', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const P = window.Capacitor.registerPlugin('TdLive');
      const realStart = P.start;
      let refuse = true;
      P.start = (args) => {
        window.__td.calls.push({ name: 'start', args: args || {} });
        return Promise.resolve(refuse ? { ok: false, reason: 'not allowed from background' } : { ok: true });
      };
      try {
        const since = Math.floor(Date.now() / 1000) - 600;
        const dwell = { id: 'd-r', name: 'John Doe', kind: 'client', sinceTs: since * 1000, fence: {} };
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 40));
        const afterRefusal = window.__td.calls.filter(c => c.name === 'start').length;
        // Same dwell again: because the refusal was not cached, this must
        // reach the plugin a second time instead of being deduped away.
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 40));
        const afterRetry = window.__td.calls.filter(c => c.name === 'start').length;
        // Now the phone allows it: the card goes up and THAT is remembered.
        refuse = false;
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 40));
        const afterSuccess = window.__td.calls.filter(c => c.name === 'start').length;
        _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 40));
        const afterDedup = window.__td.calls.filter(c => c.name === 'start').length;
        return { afterRefusal, afterRetry, afterSuccess, afterDedup };
      } finally { P.start = realStart; await _liveActEndAll(); }
    });
    expect(r.afterRefusal).toBe(1);
    expect(r.afterRetry).toBe(2);      // retried, not silently deduped
    expect(r.afterSuccess).toBe(3);
    expect(r.afterDedup).toBe(3);      // success IS cached: no wasted budget
  });

  // ── The on-site card (owner 2026-09-02) ────────────────────────────────
  // "A popup on the dynamic island and lock screen when we arrive with a
  // running timer of how long we're there." Driven by the deriver's open
  // dwell, the same fact the dashboard card and the Time Log's live row read.
  test('arriving somewhere saved starts a ticking ON SITE card from the arrival instant', async () => {
    const r = await page.evaluate(async () => {
      window.__td.calls.length = 0;
      await _liveActEndAll(); window.__td.calls.length = 0;
      const since = Date.now() - 12 * 60000;
      const dwell = { id: 'd-j-x', name: 'John Doe', kind: 'client', sinceTs: since, sinceIso: new Date(since).toISOString(), journeyId: 'x', fence: { addr: '2950 SW McClure Rd' } };
      const ok = _liveActOnSite(dwell);
      await new Promise(r => setTimeout(r, 50));
      const again = _liveActOnSite(dwell);                 // same dwell: nothing spent
      await new Promise(r => setTimeout(r, 50));
      const calls = window.__td.calls.map(c => [c.name, c.args.channel, c.args.kind, c.args.title, c.args.detail, c.args.timer, c.args.startedAt, c.args.tint]);
      _liveActOnSite(null);                                 // left: the card ends
      await new Promise(r => setTimeout(r, 50));
      return { ok, again, calls, since, ended: window.__td.calls.slice(-1)[0] };
    });
    expect(r.ok).toBe(true);
    expect(r.again).toBe(true);
    expect(r.calls).toEqual([['start', 'onsite', 'ON SITE', 'John Doe', '2950 SW McClure Rd', true, Math.floor(r.since / 1000), '#F2A93B']]);
    expect(r.ended.name).toBe('end');
    expect(r.ended.args.channel).toBe('onsite');
  });

  test('the shop is named as the shop, and a fence with no address shows the arrival time', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const since = Date.now() - 5 * 60000;
      _liveActOnSite({ id: 'd-1', name: 'TradeDesk shop', kind: 'shop', sinceTs: since, fence: {} });
      await new Promise(r => setTimeout(r, 50));
      const c = window.__td.calls[0];
      _liveActOnSite(null); await new Promise(r => setTimeout(r, 30));
      return [c.args.kind, c.args.title, /^Arrived \d/.test(c.args.detail)];
    });
    expect(r).toEqual(['AT THE SHOP', 'TradeDesk shop', true]);
  });

  test('a clocked-in person keeps the clock card: the on-site card yields and returns on clock-out', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const since = Date.now() - 3 * 60000;
      const dwell = { id: 'd-2', name: 'John Doe', kind: 'client', sinceTs: since, fence: { addr: '2950 SW McClure Rd' } };
      window._geoOpenDwell = dwell;
      _liveActOnSite(dwell); await new Promise(r => setTimeout(r, 50));
      _liveActClockIn({ jobId: null, clientName: 'John Doe', scopeLabel: 'Trim', startTime: Date.now() });
      await new Promise(r => setTimeout(r, 80));
      const duringClock = window.__td.calls.map(c => c.name + ':' + c.args.channel);
      const yielded = _liveActOnSite(dwell);                // clock card live: no on-site card
      await new Promise(r => setTimeout(r, 30));
      window.__td.calls.length = 0;
      await _liveActClockOut();
      await new Promise(r => setTimeout(r, 80));
      const afterOut = window.__td.calls.map(c => c.name + ':' + c.args.channel);
      window._geoOpenDwell = null; _liveActOnSite(null); await new Promise(r => setTimeout(r, 30));
      return { duringClock, yielded, afterOut };
    });
    expect(r.duringClock).toEqual(['start:onsite', 'end:onsite', 'start:clock']);
    expect(r.yielded).toBe(false);
    expect(r.afterOut).toEqual(['end:clock', 'start:onsite']);
  });

  test('the drive card goes up the moment the drive window opens, tally or not', async () => {
    const r = await page.evaluate(async () => {
      await _liveActEndAll(); window.__td.calls.length = 0;
      const keep = window._geoDriving;
      window._geoDriving = () => false;
      const keepWin = _geoDriveWinAt;
      try {
        _geoDriveWinAt = Date.now(); _geoDriveMiles = 0; _geoDriveSteps = 0; _geoLegOrigin = { name: 'TradeDesk shop' };
        _liveActDrive(); await new Promise(r => setTimeout(r, 50));
        const up = window.__td.calls.map(c => [c.name, c.args.channel, c.args.kind, c.args.detail, c.args.value]);
        _geoDriveWinAt = 0; window.__td.calls.length = 0;
        _liveActDrive(); await new Promise(r => setTimeout(r, 50));
        return { up, down: window.__td.calls.map(c => c.name + ':' + c.args.channel) };
      } finally { window._geoDriving = keep; _geoDriveWinAt = keepWin; }
    });
    expect(r.up).toEqual([['start', 'drive', 'DRIVING', 'From TradeDesk shop', 'logging']]);
    expect(r.down).toEqual(['end:drive']);
  });

  test('an unchanged drive ping never spends an ActivityKit update', async () => {
    const r = await page.evaluate(async () => {
      window._geoDriving = () => true;
      _geoDriveMiles = 4.25; _geoDriveSteps = 12;
      _geoLegOrigin = { name: 'Shop' };
      _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      const first = window.__td.calls.length;
      // Same tenth of a mile: the card reads identically, so nothing is sent.
      _geoDriveMiles = 4.29;
      _liveActDrive(); _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      const afterSame = window.__td.calls.length;
      // A new tenth is a real change and does go out.
      _geoDriveMiles = 4.9;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      return { first, afterSame, afterChange: window.__td.calls.length, calls: window.__td.calls.map(c => c.name) };
    });
    expect(r.first).toBe(1);
    expect(r.afterSame).toBe(1);       // two more pings, zero updates spent
    expect(r.afterChange).toBe(2);
    expect(r.calls).toEqual(['start', 'update']);
  });

  test('the drive card says what the dashboard banner says', async () => {
    const r = await page.evaluate(async () => {
      window.__td.calls.length = 0;
      window._geoDriving = () => true;
      _geoDriveMiles = 7.7; _geoDriveSteps = 20;
      _geoLegOrigin = { name: 'Home office' };
      _liveActDrive();
      await new Promise(r => setTimeout(r, 60));
      return window.__td.calls.pop().args;
    });
    expect(r.kind).toBe('DRIVING');
    expect(r.title).toBe('On the road');   // the banner's own words
    expect(r.detail).toBe('From Home office');
    expect(r.value).toBe('7.7 mi');
    expect(r.timer).toBe(false);
  });

  test('a tally built from too few fixes withholds the number instead of guessing', async () => {
    const r = await page.evaluate(async () => {
      window.__td.calls.length = 0;
      window._geoDriving = () => true;
      _geoDriveMiles = 2.2; _geoDriveSteps = 1;   // one hop: a guess
      _geoLegOrigin = null;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 60));
      return window.__td.calls.pop().args;
    });
    expect(r.value).toBe('logging');
    expect(r.detail).toBe('Mileage is logging');
  });

  test('parking ends the drive card', async () => {
    const r = await page.evaluate(async () => {
      window._geoDriving = () => true;
      _geoDriveMiles = 3.3; _geoDriveSteps = 9;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      window.__td.calls.length = 0;
      window._geoDriving = () => false;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      const ended = window.__td.calls.map(c => ({ n: c.name, ch: c.args.channel }));
      // Already ended: a further ping must stay silent, not end it repeatedly.
      window.__td.calls.length = 0;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 50));
      return { ended, afterwards: window.__td.calls.length };
    });
    expect(r.ended).toEqual([{ n: 'end', ch: 'drive' }]);
    expect(r.afterwards).toBe(0);
  });

  test('a drive and a clock can be live at once without colliding', async () => {
    const r = await page.evaluate(async () => {
      window.__td.calls.length = 0;
      window._geoDriving = () => true;
      _geoDriveMiles = 1.5; _geoDriveSteps = 8;
      _liveActDrive();
      _liveActClockIn({ jobId: 9, jobName: 'J', clientName: 'C', scopeLabel: 'S', startTime: Date.now() });
      await new Promise(r => setTimeout(r, 80));
      return [...new Set(window.__td.calls.map(c => c.args.channel))].sort();
    });
    expect(r).toEqual(['clock', 'drive']);
  });

  test('the clock card asks for a push token, the drive card stays phone-driven', async () => {
    const r = await page.evaluate(async () => {
      window.__td.calls.length = 0;
      _liveActClockIn({ jobId: 3, jobName: 'P', clientName: 'PushCo', scopeLabel: '', startTime: Date.now() });
      window._geoDriving = () => true;
      _geoDriveMiles = 9.9; _geoDriveSteps = 15; _geoLegOrigin = null;
      _liveActDrive();
      await new Promise(r => setTimeout(r, 80));
      const byCh = {};
      window.__td.calls.forEach(c => { byCh[c.args.channel] = c.args.push; });
      return byCh;
    });
    // The server can end a clock (force clock-out); nothing server-side knows
    // more about a drive than the phone in the truck, so no token is spent.
    expect(r.clock).toBe(true);
    expect(r.drive).toBe(false);
  });

  test('an activity token is stored keyed user+channel so rotations overwrite', async () => {
    const r = await page.evaluate(async () => {
      const rows = [];
      window._supaUser = { id: 'crew-1' };
      window._contractorUserId = 'boss-1';
      const prev = window._supa;
      window._supa = { from: () => ({ upsert: (row, opts) => { rows.push({ row, opts }); return Promise.resolve({ error: null }); } }) };
      const cb = window.__td.liveListeners && window.__td.liveListeners.activityToken;
      if (cb) { cb({ channel: 'clock', token: 'act-tok-1' }); cb({ channel: 'clock', token: 'act-tok-2' }); }
      await new Promise(r => setTimeout(r, 40));
      window._supa = prev;
      return { wired: !!cb, rows };
    });
    expect(r.wired).toBe(true);
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].row).toMatchObject({ user_id: 'crew-1', channel: 'clock', token: 'act-tok-1', contractor_user_id: 'boss-1' });
    expect(r.rows[1].row.token).toBe('act-tok-2');
    // The (user, channel) conflict target is what makes a rotation an
    // overwrite instead of a second row the server would push to blindly.
    expect(r.rows[0].opts.onConflict).toBe('user_id,channel');
  });

  test('force clock-out asks the server to end the crew phone card', async () => {
    const r = await page.evaluate(async () => {
      const invoked = [];
      const prev = window._supa;
      window._supa = { functions: { invoke: (name, opts) => { invoked.push({ name, body: opts && opts.body }); return Promise.resolve({ data: { ok: true } }); } } };
      _liveActRemoteEnd('crew-uid-9', 'clock');
      await new Promise(r => setTimeout(r, 40));
      window._supa = prev;
      return invoked;
    });
    expect(r.length).toBe(1);
    expect(r[0].name).toBe('update-live-activity');
    expect(r[0].body.user).toBe('crew-uid-9');
    expect(r[0].body.channel).toBe('clock');
    expect(r[0].body.event).toBe('end');
    // Every ContentState field must ship or iOS silently drops the push.
    // siteStartedAt/dualTimer added 2026-08-19 for the two-clock CLOCKED IN
    // card; the edge function backfills both even though this call site never
    // sets them, same as it already did for startedAt/tint.
    const st = r[0].body.state;
    for (const k of ['kind', 'title', 'detail', 'value', 'timer', 'startedAt', 'siteStartedAt', 'dualTimer', 'tint']) {
      expect(st).toHaveProperty(k);
    }
  });

  test('nothing throws when the app is not running in the shell', async () => {
    const ok = await page.evaluate(async () => {
      const cap = window.Capacitor;
      window.Capacitor = { isNativePlatform: () => false };
      try {
        _liveActClockIn({ jobId: 1, jobName: 'x', clientName: 'y', startTime: Date.now() });
        _liveActClockOut();
        window._geoDriving = () => true;
        _liveActDrive();
        await new Promise(r => setTimeout(r, 60));
        return true;
      } catch (e) { return false; } finally { window.Capacitor = cap; }
    });
    expect(ok).toBe(true);
  });
});

test.describe('Remote push: token handling and tap routing', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await fakeNative(page);
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterEach(() => { assertNoErrors(page, 'push'); });

  // A TestFlight build mints SANDBOX device tokens; the same app from the App
  // Store mints PRODUCTION ones. The wrong gateway answers BadDeviceToken,
  // which is indistinguishable from an uninstalled app, so a single static
  // APNS_ENV silently drops every push for half the fleet during any rollout
  // where both builds are live AND marks those good tokens dead on the way
  // past. Owner asked directly (2026-08-27) whether production would handle
  // itself; it would not have, so the environment is now a per-token fact.
  test('APNs sends survive the wrong gateway, and only condemn a token both refuse', async () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const apns = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'apns.ts'), 'utf8');
    expect(apns.includes('export async function apnsSend'),
      'both push functions must share one sender, never hand-roll the retry').toBe(true);
    expect(apns.includes('APNS_OTHER_HOST'),
      'without the other gateway there is no fallback to make').toBe(true);
    // The retry must be reached BEFORE a token is written off, or the
    // fallback exists but never runs.
    const badIdx = apns.indexOf('if (badToken(');
    const deadIdx = apns.indexOf('return { ok: false, dead: true }');
    expect(badIdx).toBeGreaterThan(-1);
    expect(deadIdx).toBeGreaterThan(badIdx);
    for (const fn of ['send-push', 'push-geo-ping']) {
      const src = fs.readFileSync(path.join(root, 'supabase', 'functions', fn, 'index.ts'), 'utf8');
      expect(src.includes('apnsSend('), `${fn} must send through the shared sender`).toBe(true);
      expect(src.includes('APNS_HOST'), `${fn} must not pin itself to one gateway`).toBe(false);
    }
  });

  test('a notification tap lands on the right screen, and an unknown one still goes somewhere', async () => {
    const r = await page.evaluate(async () => {
      const seen = [];
      const oClient = window.openClientDetail, oBid = window.viewBidFromTimeline, oGo = window.goPg;
      window.openClientDetail = (id) => seen.push('client:' + id);
      window.viewBidFromTimeline = (id) => seen.push('bid:' + id);
      window.goPg = (p) => seen.push('pg:' + p);
      try {
        _pushRoute({ route: 'bid', id: 77, client_id: 5 });
        _pushRoute({ route: 'client', id: 9 });
        _pushRoute({ route: 'money' });
        _pushRoute({ route: 'something-we-never-shipped' });
        _pushRoute(null);
      } finally {
        window.openClientDetail = oClient; window.viewBidFromTimeline = oBid; window.goPg = oGo;
      }
      return seen;
    });
    // A proposal push opens the client, then scrolls to the bid.
    expect(r.slice(0, 2)).toEqual(['client:5', 'bid:77']);
    expect(r[2]).toBe('client:9');
    expect(r[3]).toBe('pg:pg-dash');
    // Unknown route: still navigates rather than appearing to do nothing.
    expect(r[4]).toBe('pg:pg-dash');
    expect(r.length).toBe(5);   // a null payload is ignored entirely
  });

  // Siri/Shortcuts intents (owner ask 2026-08-17) route through the SAME
  // dispatcher a push tap uses (§7.3), never a parallel one: TdIntents.drain()
  // hands _pushRoute a plain {route} exactly like a push payload does.
  test('a Siri/Shortcuts intent routes through the same dispatcher a push tap uses', async () => {
    const r = await page.evaluate(async () => {
      const seen = [];
      const oGo = window.goPg, oExp = window.showQuickExpenseModal, oLead = window.openNewClient;
      window.goPg = (p) => seen.push('pg:' + p);
      window.showQuickExpenseModal = (...a) => seen.push('expense:' + JSON.stringify(a));
      window.openNewClient = () => seen.push('lead');
      try {
        _pushRoute({ route: 'clockin' });
        _pushRoute({ route: 'expense' });
        _pushRoute({ route: 'lead' });
      } finally {
        window.goPg = oGo; window.showQuickExpenseModal = oExp; window.openNewClient = oLead;
      }
      return seen;
    });
    expect(r[0]).toBe('pg:pg-timelog');
    expect(r[1]).toBe('expense:[null,null]');
    expect(r[2]).toBe('lead');
  });

  test('the intents plugin getter is native-only, exactly like the push plugin getter', async () => {
    const off = await page.evaluate(() => {
      const cap = window.Capacitor;
      try {
        window.Capacitor = undefined;
        return typeof _intentsPlugin === 'function' ? _intentsPlugin() : 'missing';
      } finally { window.Capacitor = cap; }
    });
    expect(off).toBe(null);
  });

  test('the token is stored against the account whose events this phone should hear', async () => {
    const r = await page.evaluate(async () => {
      const rows = [];
      window._supaUser = { id: 'user-abc' };
      window._contractorUserId = 'boss-xyz';     // an employee on their boss's account
      const prev = window._supa;
      window._supa = { from: () => ({ upsert: (row, opts) => { rows.push({ row, opts }); return Promise.resolve({ error: null }); } }) };
      const ok = await _pushSaveToken('devtok-1');
      window._supa = prev;
      return { ok, rows, cached: localStorage.getItem('zp3_push_token') };
    });
    expect(r.ok).toBe(true);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].row.user_id).toBe('user-abc');
    expect(r.rows[0].row.contractor_user_id).toBe('boss-xyz');
    expect(r.rows[0].row.platform).toBe('ios');
    // Upserting on the token is what stops one handset accumulating rows and
    // receiving every message two or three times.
    expect(r.rows[0].opts.onConflict).toBe('token');
    expect(r.cached).toBe('devtok-1');
  });

  test('an owner registers against their own account', async () => {
    const r = await page.evaluate(async () => {
      let row = null;
      window._supaUser = { id: 'owner-1' };
      window._contractorUserId = null;           // owners have no separate account id
      const prev = window._supa;
      window._supa = { from: () => ({ upsert: (x) => { row = x; return Promise.resolve({ error: null }); } }) };
      await _pushSaveToken('devtok-2');
      window._supa = prev;
      return row;
    });
    expect(r.contractor_user_id).toBe('owner-1');
  });

  test('an empty token and a signed-out app are both refused quietly', async () => {
    const r = await page.evaluate(async () => {
      const prevU = window._supaUser, prevS = window._supa;
      let called = 0;
      window._supa = { from: () => ({ upsert: () => { called++; return Promise.resolve({ error: null }); } }) };
      window._supaUser = { id: 'u' };
      const empty = await _pushSaveToken('');
      window._supaUser = null;
      const signedOut = await _pushSaveToken('tok');
      window._supaUser = prevU; window._supa = prevS;
      return { empty, signedOut, called };
    });
    expect(r.empty).toBe(false);
    expect(r.signedOut).toBe(false);
    expect(r.called).toBe(0);
  });

  test('signing out forgets this device so the next person never gets the old account pushes', async () => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('zp3_push_token', 'devtok-3');
      const deleted = [];
      const prev = window._supa;
      window._supa = { from: () => ({ delete: () => ({ eq: (col, val) => { deleted.push([col, val]); return Promise.resolve({ error: null }); } }) }) };
      await _pushForget();
      window._supa = prev;
      return { deleted, cached: localStorage.getItem('zp3_push_token') };
    });
    expect(r.deleted).toEqual([['token', 'devtok-3']]);
    expect(r.cached).toBe(null);
  });

  test('permission is never requested on boot', async () => {
    const r = await page.evaluate(() => window.__td.calls.filter(c => c.name === 'register').length);
    expect(r).toBe(0);
  });
});
