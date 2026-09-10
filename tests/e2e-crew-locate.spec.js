// @ts-check
// ── Push to locate ───────────────────────────────────────────────────────────
// The tracking engine is event-driven on purpose: a parked phone turns GPS off
// and lets the region hardware watch for a departure. What that gives up is
// knowing where somebody is BETWEEN events, which is exactly the question a
// manager has when a customer calls. Push to locate answers it on demand: the
// manager asks, that one phone wakes, takes one fix, and goes back to sleep.
//
// These tests defend the two things that make it safe to ship:
//   1. Consent gates it. A phone whose owner never accepted the tracking notice
//      returns a reason, never coordinates. The consent is standing, given once
//      before anything was logged, so an individual check is silent on the crew
//      phone (owner call 2026-08-09) and journaled rather than announced.
//   2. It never lies to the manager. A phone that did not answer is reported
//      as a phone that did not answer, never as a location.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('push to locate', () => {
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

  // A loopback broadcast bus standing in for Supabase realtime: every channel
  // built on it delivers to every other, which is what one account's crew
  // sharing a channel actually looks like on the wire.
  const bus = async (opts) => page.evaluate((o) => {
    const subs = [];
    window.__bus = {
      subs,
      fire(event, payload) { subs.forEach(h => (h[event] || []).forEach(fn => fn({ payload }))); },
      sent: [],
    };
    window._supa = {
      channel() {
        const h = {};
        const ch = {
          on(_t, opt, fn) { (h[opt.event] || (h[opt.event] = [])).push(fn); return ch; },
          subscribe() { return ch; },
          send(msg) { window.__bus.sent.push(msg); window.__bus.fire(msg.event, msg.payload); },
        };
        subs.push(h);
        return ch;
      },
      removeChannel() {},
      from: () => ({ insert: () => Promise.resolve({}), select() { return this; } }),
    };
    window.S = window.S || {};
    S.teamTracking = o.teamTracking !== false;
    window._supaUser = { id: 'crew-uid-1' };
    window._isEmployee = false;
    window._contractorUserId = null;
    localStorage.setItem('geo_owner_consent', o.consent || '1');
    if (o.osDenied) localStorage.setItem('td_geo_os_denied', '1'); else localStorage.removeItem('td_geo_os_denied');
    localStorage.removeItem('td_crew_locate_log');
    window.__toasts = [];
    window.showToast = (m) => window.__toasts.push(m);
    navigator.geolocation.getCurrentPosition = o.noFix
      ? (_ok, err) => setTimeout(() => err && err({ code: 2 }), 20)
      : (ok) => setTimeout(() => ok({ coords: { latitude: 41.52, longitude: -88.08, accuracy: 11 } }), 25);
    _crewLocateTeardown();
    _crewLocateInit();
  }, opts || {});

  // Injects what a PEER's request looks like arriving on the channel.
  const ask = (payload, waitMs) => page.evaluate(async ([p, ms]) => {
    const got = new Promise(res => {
      const ch = _supa.channel('probe');
      ch.on('broadcast', { event: 'locate_ack' }, m => res(m.payload));
      setTimeout(() => res(null), ms);
    });
    window.__bus.fire('locate_req', p);
    return await got;
  }, [payload, waitMs || 2500]);

  test('a consenting phone answers with a real position', async () => {
    await bus();
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r1', by: 'boss-uid', byName: 'Dana' });
    expect(ack.ok).toBe(true);
    expect(typeof ack.lat).toBe('number');
    expect(typeof ack.lng).toBe('number');
    expect(ack.reqId, 'the answer is matched to the question, not the newest one').toBe('r1');
  });

  // Owner call (2026-08-09): a Locate must not interrupt the crew member. The
  // consent that covers it was given once, when they accepted the tracking
  // notice before anything was ever logged; an individual check is not a fresh
  // decision they get asked about, and no competitor's map notifies the tech
  // either. The record below is the audit trail, not a notification.
  test('a locate is silent on the crew phone: no toast, no banner', async () => {
    await bus();
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r2', by: 'boss-uid', byName: 'Dana' });
    const r = await page.evaluate(() => ({
      toasts: window.__toasts.length,
      overlays: document.querySelectorAll('.zmodal-overlay').length,
    }));
    expect(ack.ok, 'it still answers').toBe(true);
    expect(r.toasts, 'nothing is put on the crew member\'s screen').toBe(0);
    expect(r.overlays).toBe(0);
  });

  test('a phone addressed to somebody else says nothing at all', async () => {
    await bus();
    const ack = await ask({ uid: 'some-other-uid', reqId: 'r3', by: 'boss-uid', byName: 'Dana' }, 900);
    expect(ack, 'one ask must not make every phone on the account report in').toBe(null);
  });

  test('no consent means a reason, never coordinates', async () => {
    await bus({ consent: 'declined' });
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r4', by: 'boss-uid', byName: 'Dana' });
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('no-consent');
    expect(ack.lat, 'a declined phone leaks nothing').toBeUndefined();
  });

  test('tracking switched off for the account is its own honest reason', async () => {
    await bus({ teamTracking: false });
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r5', by: 'boss-uid', byName: 'Dana' });
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe('tracking-off');
  });

  test('location denied in phone settings is not confused with silence', async () => {
    await bus({ osDenied: true });
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r6', by: 'boss-uid', byName: 'Dana' });
    expect(ack.reason, 'the manager needs to know it is fixable in Settings').toBe('os-denied');
  });

  test('a phone that answers but cannot get a fix says so', async () => {
    await bus({ noFix: true });
    const ack = await ask({ uid: 'crew-uid-1', reqId: 'r7', by: 'boss-uid', byName: 'Dana' }, 20000);
    expect(ack.ok).toBe(false);
    expect(ack.reason, 'awake-but-blind is different information from asleep').toBe('no-fix');
  });

  test('every ask is journaled on the device it was asked of, silently', async () => {
    await bus();
    await ask({ uid: 'crew-uid-1', reqId: 'r8', by: 'boss-uid', byName: 'Dana' });
    await bus({ consent: 'declined' });
    await ask({ uid: 'crew-uid-1', reqId: 'r9', by: 'boss-uid', byName: 'Pat' });
    const log = await page.evaluate(() => _crewLocateHistory());
    // bus() clears the journal, so the second run holds exactly the refusal.
    expect(log.length).toBe(1);
    expect(log[0].by).toBe('Pat');
    expect(log[0].answered).toBe(false);
  });

  test('the requester never answers its own request', async () => {
    await bus();
    const acks = await page.evaluate(async () => {
      const seen = [];
      const ch = _supa.channel('probe');
      ch.on('broadcast', { event: 'locate_ack' }, m => seen.push(m.payload));
      const p = crewLocateRequest('crew-uid-1');   // asking for MY OWN uid
      await new Promise(r => setTimeout(r, 900));
      return seen.length;
    });
    expect(acks, 'a self-addressed ask would otherwise loop forever').toBe(0);
  });

  test('silence is reported as silence, with a timeout not a location', async () => {
    await bus();
    const r = await page.evaluate(async () => {
      window.__bus.fire = () => {};          // nobody is listening: an asleep phone
      const started = Date.now();
      const res = await Promise.race([
        crewLocateRequest('nobody-home'),
        new Promise(x => setTimeout(() => x({ ok: false, reason: 'harness-timeout' }), 24000)),
      ]);
      return { res, ms: Date.now() - started };
    });
    expect(r.res.ok).toBe(false);
    expect(r.res.reason).toBe('timeout');
    expect(r.res.lat, 'no coordinates are invented for a phone that never spoke').toBeUndefined();
  });

  test('every reason a manager can see is plain English, not a code', async () => {
    const texts = await page.evaluate(() =>
      ['timeout', 'no-fix', 'no-consent', 'tracking-off', 'os-denied', 'offline', 'nonsense']
        .map(c => _crewLocateReasonText(c)));
    texts.forEach(t => {
      expect(t.length).toBeGreaterThan(8);
      expect(t, 'a reason code must never reach a contractor').not.toMatch(/[a-z]-[a-z]/);
    });
  });

  // The fresh-fix channel push-to-locate depends on. Inside the shell
  // navigator.geolocation is shimmed to serve a cached fix for up to two
  // minutes, which is right for weather and wrong for "where are you now", so
  // the answer has to come from the engine's own fix funnel.
  test('the engine publishes every fix to fresh-fix subscribers', async () => {
    const r = await page.evaluate(async () => {
      const out = await new Promise(res => {
        const un = _geoOnFreshFix(f => { un(); res(f); });
        setTimeout(() => res(null), 2000);
        _geoOnPing({ coords: { latitude: 41.71, longitude: -88.31, accuracy: 6 } });
      });
      // And unsubscribing really stops delivery.
      let after = 0;
      const un2 = _geoOnFreshFix(() => { after++; });
      un2();
      _geoOnPing({ coords: { latitude: 41.72, longitude: -88.32, accuracy: 6 } });
      await new Promise(r2 => setTimeout(r2, 200));
      return { out, after };
    });
    expect(r.out && r.out.lat).toBeCloseTo(41.71, 3);
    expect(r.out.ts, 'the timestamp is what proves the fix is fresh').toBeGreaterThan(0);
    expect(r.after, 'an unsubscribed listener is really gone').toBe(0);
  });

  test('signing out lets go of the account channel', async () => {
    await bus();
    const r = await page.evaluate(async () => {
      _crewLocateTeardown();
      // A request with no channel resolves offline rather than hanging forever.
      // Asked about a PEER: this test is about the channel, and the peer path is
      // the channel path. Since 2026-09-06 asking about YOURSELF is answered by
      // this phone directly and needs no channel at all, so it would (rightly)
      // not be offline here.
      const keep = window._supa;
      window._supa = null;
      try { return await crewLocateRequest('crew-uid-2'); }
      finally { window._supa = keep; }
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('offline');
  });

  test('and your own phone still answers you with no channel at all', async () => {
    await bus();
    const r = await page.evaluate(async () => {
      _crewLocateTeardown();
      const keep = window._supa;
      window._supa = null;
      try { return await crewLocateRequest('crew-uid-1'); }
      finally { window._supa = keep; }
    });
    expect(r.ok, 'the fix is on this device; nothing has to be asked').toBe(true);
  });

  test('no console errors across push to locate', async () => { await assertNoErrors(page); });

  // ── Locating yourself (owner 2026-09-06) ──────────────────────────────────
  // A solo contractor IS the crew, so a manager asking where he is is the
  // common case. It used to always time out: the channel does not deliver a
  // device its own broadcast, and the responder refuses when the asker is the
  // answerer, so the row claimed his phone was asleep while it was in his hand.
  test.describe('locating yourself', () => {
    test('answers from this phone, with no round trip at all', async () => {
      await bus();
      const r = await page.evaluate(async () => {
        window.__bus.sent.length = 0;
        const res = await crewLocateRequest('crew-uid-1');
        return { res, sent: window.__bus.sent.length };
      });
      expect(r.res.ok, 'his own phone can answer him').toBe(true);
      expect(r.res.lat).toBeCloseTo(41.52, 2);
      expect(r.sent, 'nothing goes over the channel to ask yourself').toBe(0);
    });

    test('the fresh fix becomes the new last-known, same as an answered one', async () => {
      await bus();
      const wrote = await page.evaluate(async () => {
        const seen = [];
        const real = window._geoWritePing;
        window._geoWritePing = (here, acc, at) => seen.push({ here, acc, at });
        await crewLocateRequest('crew-uid-1');
        window._geoWritePing = real;
        return seen;
      });
      expect(wrote.length, 'written once, to the same place the responder writes').toBe(1);
      expect(wrote[0].here.lat).toBeCloseTo(41.52, 2);
      expect(typeof wrote[0].at, 'stamped with the fix moment, not the write moment').toBe('number');
    });

    test('consent and OS denial still gate it, exactly as for anybody else', async () => {
      await bus({ teamTracking: false });
      const off = await page.evaluate(() => crewLocateRequest('crew-uid-1'));
      expect(off.ok).toBe(false);
      expect(off.reason).toBe('tracking-off');
      await bus({ osDenied: true });
      const denied = await page.evaluate(() => crewLocateRequest('crew-uid-1'));
      expect(denied.reason).toBe('os-denied');
    });

    test('no fix says no fix, never "their phone is asleep"', async () => {
      await bus({ noFix: true });
      const r = await page.evaluate(() => crewLocateRequest('crew-uid-1'));
      expect(r.ok).toBe(false);
      expect(r.reason, 'a phone in your hand is not asleep').toBe('no-fix');
      const said = await page.evaluate(() => _crewLocateReasonText('no-fix'));
      expect(said).toMatch(/could not get a fix/);
    });

    test('asking about somebody else still goes over the channel', async () => {
      await bus();
      await page.evaluate(() => { window.__bus.sent.length = 0; crewLocateRequest('crew-uid-2'); });
      const sent = await page.evaluate(() => window.__bus.sent.map(m => m.event));
      expect(sent, 'the crew path is untouched').toContain('locate_req');
    });
  });
});
