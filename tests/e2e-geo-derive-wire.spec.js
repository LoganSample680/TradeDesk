// @ts-check
// ── The deriver, wired into the engine ──────────────────────────────────────
//
// js/geo-derive.js decides what the day was. This spec covers the plumbing
// around it in js/geo-track.js and js/cloud.js (owner 2026-09-02):
//
//   * ONE WRITER. The engine's own row writes are gated at the single choke
//     point (_geoEnqueue) and the engine's mileage writer (_geoAutoMileage).
//     Human rows (a manual clock-out, a hand-fixed row) still land.
//   * The fix log: every fix the phone takes is kept locally, capped, pruned.
//   * Central day bounds from Intl, DST included.
//   * A derive enqueues ONE durable item per day carrying the whole day, the
//     newest replacing any older one still waiting, and the drain calls
//     geo_replace_day with it. Offline it waits; refused it is dropped.
//   * An empty tape derives nothing: a browser must never wipe a day.
//   * The in-memory mileage array is updated so the settings-blob sweep
//     cannot retire the derived legs, and hand-set attributes ride across.
//   * Derived GPS legs are never sweep-eligible on any device (_sweepGuarded).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// ── The day this spec derives is RELATIVE, on purpose ──────────────────────
// It used to be the fixed date '2026-09-01', and that passed for exactly
// eight days. _geoFixLogSeed / _geoAppLogSeed prune anything older than
// _GEO_FIXLOG_KEEP_MS (8 days) measured from Date.now(), so on 2026-09-09 the
// cut landed in the middle of that day and the two morning fixes the server
// handed back were dropped before the test could read them. Nothing was
// wrong with the code: the calendar moved. A day the app is meant to still
// remember has to BE a day the app still remembers, so it is derived from
// the clock, two days back, and the Central midnight comes from Intl so a
// DST boundary cannot shift it either (CLAUDE.md 5.2.2).
const CENTRAL = 'America/Chicago';
const centralParts = (ms) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: CENTRAL, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
};
const centralOff = (ms) => centralParts(ms) - ms;
const centralDayKey = (ms) => new Date(centralParts(ms)).toISOString().slice(0, 10);
const centralMidnight = (key) => { const u = Date.parse(key + 'T00:00:00Z'); return u - centralOff(u - centralOff(u)); };
const DAY = centralDayKey(Date.now() - 2 * 86400000);
const DAY_START = centralMidnight(DAY);
const DAY_END = centralMidnight(centralDayKey(DAY_START + 36 * 3600000));
const PREV_DAY = centralDayKey(DAY_START - 12 * 3600000);
const T = (h, m) => DAY_START + h * 3600000 + m * 60000;
const SHOP = { lat: 39.0307066, lng: -95.7112082 };
const DOE = { lat: 39.0123292, lng: -95.7464936 };

test.describe('geo-derive wiring', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      window.__realDrain = _geoDrainQueue;
      window.__realRoute = _routeDistance;   // the specs above stub it; the router test needs the real one
      // AND THE REAL TAPE READER. 'a no-drive day with app activity at home'
      // replaces _geoDeriveTape with a stub returning [] and never puts it
      // back, so every tape test after it in this file was reading the stub:
      // they assert "nothing came back" and an empty array satisfies that
      // whatever the code does. Captured here, before any test runs, and
      // restored by withTape() so those assertions test the function again.
      window.__realDeriveTape = _geoDeriveTape;
      window.supaLoadFromCloud = async () => {};
      window._supaUser = window._supaUser || { id: '30a2b589-e081-4351-9f18-b1efba238c2d', email: 'o@t.com' };
      localStorage.removeItem('zp3_geo_queue');
      localStorage.removeItem('zp3_geo_fixlog');
    });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_fixlog');
      // A fence crossing or an app-active in an earlier test arms a 4-second
      // live derive (_geoDeriveLiveSoon) and boot arms a 2.5-second rebuild;
      // either landing inside a later test's window counts an extra day
      // (CI, WebKit, 2026-09-02: the lock-policy test saw 3 and 4 days for
      // two rebuilds). Every test starts with no timer left over.
      if (_geoDeriveLiveT) { clearTimeout(_geoDeriveLiveT); _geoDeriveLiveT = null; }
      if (_geoDeriveRebuildT) { clearTimeout(_geoDeriveRebuildT); _geoDeriveRebuildT = null; }
    });
  });

  test.describe('one writer', () => {
    test('the flag is on, and the engine\'s automatic rows go nowhere', async () => {
      const r = await page.evaluate(() => {
        const q = () => JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]');
        const drain = window._geoDrainQueue; window._geoDrainQueue = () => {};
        try {
          _geoEnqueue('job_time_entries', { contractor_user_id: 'C', employee_user_id: 'E', source: 'client', arrived_at: '2026-09-01T13:00:00Z', departed_at: '2026-09-01T14:00:00Z', minutes: 60, client_key: 'vis-1' });
          _geoEnqueue('job_time_entries', { contractor_user_id: 'C', employee_user_id: 'E', source: 'drive', client_key: 'leg-1' });
          _geoEnqueue('shop_time_entries', { contractor_user_id: 'C', employee_user_id: 'E', client_key: 'shop-1' });
          const afterAuto = q().length;
          _geoEnqueue('job_time_entries', { contractor_user_id: 'C', employee_user_id: 'E', source: 'manual', client_key: 'man-1' });
          _geoEnqueue('job_time_entries', { contractor_user_id: 'C', employee_user_id: 'E', source: 'geofence', client_key: 'fixed-abc' });
          const afterHuman = q().map(x => x.row.client_key);
          return { flag: _GEO_DERIVER_WRITES, afterAuto, afterHuman };
        } finally { window._geoDrainQueue = drain; }
      });
      expect(r.flag).toBe(true);
      expect(r.afterAuto, 'client, drive and shop rows from the engine are dropped').toBe(0);
      expect(r.afterHuman, 'a manual clock-out and a hand-fixed row still land').toEqual(['man-1', 'fixed-abc']);
    });

  });

  // ── Where the clock was tapped ────────────────────────────────────────
  // Owner 2026-09-04: "does clock in and clock out button surface a gps ping
  // where it happened? it should." It did not: clockIn wrote a timeEntries row
  // with a timestamp and nothing else.
  test.describe('the clock leaves a ping', () => {
    const arm = (page, opts) => page.evaluate((o) => {
      window.__posts = [];
      window.__geoErr = null;
      const realFetch = window.fetch;
      window.fetch = async (url, init) => {
        if (String(url).indexOf('/functions/v1/ingest-geo') >= 0) {
          window.__posts.push({ url: String(url), body: JSON.parse((init && init.body) || '{}'),
            auth: (init && init.headers && init.headers.Authorization) || '' });
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return realFetch(url, init);
      };
      window.__restore = () => { window.fetch = realFetch; };
      navigator.geolocation.getCurrentPosition = (ok, err) => {
        if (o.deny) { if (err) err({ code: 1 }); return; }
        ok({ coords: { latitude: 39.0456577, longitude: -95.7151106, accuracy: 8 } });
      };
      window._geoCanStamp = async () => !o.noPerm;
      window._supa = window._supa || {};
      window._supa.auth = { getSession: async () => ({ data: o.noSession ? {} : { session: { access_token: 'tok-1' } } }) };
      window.supaEnabled = () => !o.offline;
    }, opts || {});
    const drain = async (page) => { await page.waitForTimeout(120); };
    const posts = (page) => page.evaluate(() => { const p = window.__posts; window.__restore && window.__restore(); return p; });

    test('clocking in posts one clock-in event with the coordinates', async () => {
      await arm(page, {});
      await page.evaluate(() => { _geoClockPing('in'); });
      await drain(page);
      const p = await posts(page);
      expect(p.length).toBe(1);
      expect(p[0].auth).toBe('Bearer tok-1');
      expect(p[0].body.events.length).toBe(1);
      const ev = p[0].body.events[0];
      expect(ev.type).toBe('clock-in');
      expect([ev.lat, ev.lng]).toEqual([39.045658, -95.715111]);
      expect(ev.ts).toBeGreaterThan(0);
      // THE PING IS NOT AN ADDRESS. Nothing on it can steer the deriver or
      // the reader (owner 2026-09-04: the clock stays a placeholder that says
      // "grab everything in between" and no more).
      expect(ev.regionId).toBeUndefined();
      expect(ev.dest_place).toBeUndefined();
      expect(ev.name).toBeUndefined();
    });

    test('clocking out posts a clock-out event', async () => {
      await arm(page, {});
      await page.evaluate(() => { _geoClockPing('out'); });
      await drain(page);
      const p = await posts(page);
      expect(p.length).toBe(1);
      expect(p[0].body.events[0].type).toBe('clock-out');
    });

    // A CLOCK MUST NEVER FAIL BECAUSE LOCATION DID. Every one of these is a
    // silent no-op, never a throw and never a blocked clock.
    for (const [name, o] of [['permission not granted', { noPerm: true }],
                             ['location denied at the prompt', { deny: true }],
                             ['no session', { noSession: true }],
                             ['offline / supabase disabled', { offline: true }]]) {
      test('no ping and no error when ' + name, async () => {
        await arm(page, o);
        const threw = await page.evaluate(() => {
          try { _geoClockPing('in'); return false; } catch (e) { return true; }
        });
        await drain(page);
        expect(threw).toBe(false);
        expect((await posts(page)).length).toBe(0);
      });
    }

    test('junk in is a no-op, never a throw', async () => {
      await arm(page, {});
      const threw = await page.evaluate(() => {
        try { _geoClockPing(); _geoClockPing(null); _geoClockPing(7); _geoClockPing({}); return false; }
        catch (e) { return true; }
      });
      await drain(page);
      expect(threw).toBe(false);
      // Anything that is not 'out' is a clock-in: there are only two ends.
      const p = await posts(page);
      expect(p.every(x => x.body.events[0].type === 'clock-in')).toBe(true);
    });

    // The WIRING, not just the function: it is the clock buttons that have to
    // call it, and only when the time was actually kept.
    test('clockIn pings, clockOut pings, and a discarded session does not', async () => {
      const r = await page.evaluate(() => {
        const seen = [];
        const real = window._geoClockPing;
        window._geoClockPing = (k) => seen.push(k);
        const keepT = timeEntries.slice(), keepJ = jobs.slice();
        const savedToast = window.showToast, savedBan = window.showClockBanner, savedHide = window.hideClockBanner;
        window.showToast = () => {}; window.showClockBanner = () => {}; window.hideClockBanner = () => {};
        try {
          clockIn(null, null, null);
          const afterIn = seen.slice();
          clockOut(true, true);
          const afterOut = seen.slice();
          clockIn(null, null, null);
          clockOut(false, true);          // discarded: not a clock-out anybody made
          return { afterIn, afterOut, all: seen.slice() };
        } finally {
          window._geoClockPing = real;
          window.showToast = savedToast; window.showClockBanner = savedBan; window.hideClockBanner = savedHide;
          timeEntries.length = 0; keepT.forEach(x => timeEntries.push(x));
          jobs.length = 0; keepJ.forEach(x => jobs.push(x));
        }
      });
      expect(r.afterIn).toEqual(['in']);
      expect(r.afterOut).toEqual(['in', 'out']);
      expect(r.all, 'the discard adds an in and no out').toEqual(['in', 'out', 'in']);
    });

    // The deriver may use them: both are live getCurrentPosition reads taken
    // at the tap, which is the exact test _GEO_FRESH_FIX_TYPES applies.
    test('the deriver counts a clock ping as a fresh fix', async () => {
      const types = await page.evaluate(() => _GEO_FRESH_FIX_TYPES.slice());
      expect(types).toContain('fix');
      expect(types).toContain('clock-in');
      expect(types).toContain('clock-out');
    });
  });

  test.describe('the fix log', () => {
    test('keeps what the phone saw, in order, without the same fix twice', async () => {
      const r = await page.evaluate(() => {
        _geoFixLogPush(1000, 39.1, -95.7, 8);
        _geoFixLogPush(1000, 39.1, -95.7, 8);       // duplicate
        _geoFixLogPush(2000, 39.2, -95.7, 3000);
        _geoFixLogPush('junk', 39.2, -95.7);        // no time
        _geoFixLogPush(3000, 'x', -95.7);           // no position
        _geoFixLogPush(4000, 39.3, -95.7, null);
        return _geoFixLogRead();
      });
      expect(r.map(f => [f.ts, f.lat, f.acc])).toEqual([[1000, 39.1, 8], [2000, 39.2, 3000], [4000, 39.3, null]]);
    });

    test('prunes older than eight days and caps the count', async () => {
      const r = await page.evaluate(() => {
        const now = 1_800_000_000_000;
        _geoFixLogPush(now - 9 * 86400000, 39, -95, 5);   // too old once a newer one lands
        _geoFixLogPush(now, 39, -95, 5);
        const afterPrune = _geoFixLogRead().length;
        localStorage.setItem('zp3_geo_fixlog', JSON.stringify(Array.from({ length: 6000 }, (_, i) => ({ ts: now + i, lat: 39, lng: -95, acc: 5 }))));
        _geoFixLogPush(now + 7000, 39.5, -95, 5);
        const cap = _geoFixLogRead();
        return { afterPrune, capLen: cap.length, last: cap[cap.length - 1].lat };
      });
      expect(r.afterPrune).toBe(1);
      expect(r.capLen).toBe(6000);
      expect(r.last).toBe(39.5);
    });

    test('a fix through the event router and a ping both land in it', async () => {
      const r = await page.evaluate(async () => {
        const t0 = Date.now() - 1500, t1 = Date.now() - 1000;
        await _geoTdEvent({ type: 'fix', ts: t0, lat: 39.01, lng: -95.71, acc: 6 }, false).catch(() => {});
        await _geoTdEvent({ type: 'motion', ts: t1, kind: 'onFoot' }, false).catch(() => {});   // no fix, not logged
        const log = _geoFixLogRead();
        return { hasFix: log.some(f => f.lat === 39.01 && f.lng === -95.71), motionLogged: log.some(f => f.ts === t1) };
      });
      expect(r.hasFix).toBe(true);
      expect(r.motionLogged).toBe(false);
    });
  });

  test.describe('the app log (rule 10)', () => {
    test('lifecycle events land in it from the router, and a fix on them lands in the fix log', async () => {
      const r = await page.evaluate(async () => {
        localStorage.removeItem('zp3_geo_applog');
        const t0 = Date.now() - 5000;
        await _geoTdEvent({ type: 'app-active', ts: t0, lat: 39.01, lng: -95.69, acc: 5 }, false).catch(() => {});
        await _geoTdEvent({ type: 'app-background', ts: t0 + 2000 }, false).catch(() => {});
        _geoAppLogPush(t0 + 2500, 'background');
        _geoAppLogPush('junk', 'active'); _geoAppLogPush(t0 + 3000, '');
        return { app: _geoAppLogRead().map(e => e.kind), fix: _geoFixLogRead().some(f => f.lat === 39.01 && f.lng === -95.69) };
      });
      expect(r.app).toEqual(['active', 'background']);
      expect(r.fix).toBe(true);
    });

    test('a no-drive day with app activity at home still derives', async () => {
      const r = await page.evaluate(async () => {
        localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_applog'); localStorage.removeItem('zp3_geo_fixlog');
        S.bizTz = 'America/Chicago'; window.mileage = [];
        window.places = [{ id: 77, kind: 'home_office', name: 'Home office', lat: 39.0100, lon: -95.6900 }];
        window._geoDeriveTape = async () => [];
        window._geoDrainQueue = () => {};
        // A PAST day: an app span still open is capped at now, so a future
        // fixture would derive nothing (the deriver was right, the first cut of
        // this test was not).
        const day = '2026-08-30', t = h => Date.parse('2026-08-30T05:00:00Z') + h * 3600000;
        _geoFixLogPush(t(9), 39.0100, -95.6900, 5); _geoFixLogPush(t(11), 39.0100, -95.6900, 5);
        _geoAppLogPush(t(10), 'active'); _geoAppLogPush(t(11), 'background');
        const res = await _geoDeriveDayNow(day, null);
        const q = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]');
        return { res: res && res.dwells.map(d => [d.kind, d.minutes]), q: q.map(x => x.args.p_time.map(r => r.source)),
          sweep: q.map(x => x.args.p_sweep) };
      });
      expect(r.res).toEqual([['office', 60]]);
      expect(r.q).toEqual([['place-office']]);
      // NO TAPE, NO SWEEP: the office row may be added, but this derive had no
      // motion history for the day, so it must not be allowed to retire
      // anything geo_replace_day already holds for it.
      expect(r.sweep).toEqual([false]);
    });
  });

  // ── Rule 13's witnesses come from the app ───────────────────────────────
  test.describe('rule 13 wiring', () => {
    test('a client fence carries scheduled:true only on a day that client has a job or estimate', async () => {
      const r = await page.evaluate(() => {
        window.clients = [{ id: 501, name: 'Mom', addr: '1 Family Ln' }, { id: 502, name: 'Cust', addr: '2 Work St' }];
        localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 501: { addr: '1 Family Ln', lat: 39.01, lng: -95.7, lon: -95.7 }, 502: { addr: '2 Work St', lat: 39.02, lon: -95.71 } }));
        window.jobs = [{ id: 9001, client_id: 501, name: 'Mom job', eventType: 'job', start: '2026-09-01', days: 2, status: 'upcoming' },
                       { id: 9002, client_id: 502, name: 'Old', eventType: 'estimate', start: '2026-08-20', days: 1, status: 'upcoming' },
                       { id: 9003, client_id: 502, name: 'Canceled', eventType: 'job', start: '2026-09-01', days: 1, status: 'canceled' }];
        const on = _geoDeriveFences('2026-09-01').filter(f => f.kind === 'client').map(f => [f.name, !!f.scheduled]);
        const off = _geoDeriveFences('2026-09-05').filter(f => f.kind === 'client').map(f => [f.name, !!f.scheduled]);
        return { on, off };
      });
      expect(r.on).toEqual([['Mom', true], ['Cust', false]]);
      expect(r.off).toEqual([['Mom', false], ['Cust', false]]);
    });

    // ── The coordinates live on the record now (owner 2026-09-11) ─────────
    //
    // "so we would need coordinates based on the address entered saved on the
    // back end?" Yes. They were computed on the device and kept in
    // localStorage only: on the day this shipped, all eleven client records
    // held zero coordinates while ten had addresses, so a deriver running
    // anywhere but that one phone could not name a single client visit.
    test('a client fence resolves from the record on a phone that has never geocoded', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        try {
          localStorage.removeItem('zp3_nearby_geo');          // brand-new device
          window.clients = [{ id: 611, name: 'Laurie', addr: '9 Elm St', lat: 39.011, lon: -95.78, geoAddr: '9 Elm St' }];
          window.jobs = [];
          const f = _geoDeriveFences('2026-09-01').filter(x => x.kind === 'client');
          return { n: f.length, name: f[0] && f[0].name, lat: f[0] && f[0].lat, lng: f[0] && f[0].lng };
        } finally { if (saved) localStorage.setItem('zp3_nearby_geo', saved); }
      });
      expect(r.n, 'the fence exists with no device cache at all').toBe(1);
      expect(r.name).toBe('Laurie');
      expect(r.lat).toBeCloseTo(39.011, 5);
      expect(r.lng).toBeCloseTo(-95.78, 5);
    });

    // A client who moves must not keep a fence on the old house. The cache has
    // always guarded this with entry.addr === c.addr; the record carries the
    // same guard or it becomes the one copy nobody validates.
    test('a record whose address has changed since is refused, not trusted', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        try {
          localStorage.removeItem('zp3_nearby_geo');
          window.clients = [{ id: 612, name: 'Moved', addr: '77 New Rd', lat: 39.011, lon: -95.78, geoAddr: '9 Old St' }];
          window.jobs = [];
          return _geoDeriveFences('2026-09-01').filter(x => x.kind === 'client').length;
        } finally { if (saved) localStorage.setItem('zp3_nearby_geo', saved); }
      });
      expect(r, 'stale coordinates are no fence at all').toBe(0);
    });

    test('the record wins over a device cache that disagrees', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        try {
          window.clients = [{ id: 613, name: 'Both', addr: '5 Main St', lat: 40.0, lon: -96.0, geoAddr: '5 Main St' }];
          window.jobs = [];
          localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 613: { addr: '5 Main St', lat: 12.34, lon: -56.78 } }));
          const f = _geoDeriveFences('2026-09-01').filter(x => x.kind === 'client')[0];
          return { lat: f && f.lat, lng: f && f.lng };
        } finally { if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo'); }
      });
      expect(r.lat, 'the durable copy, not this device\'s guess').toBeCloseTo(40.0, 5);
      expect(r.lng).toBeCloseTo(-96.0, 5);
    });

    test('seeding pours the record into the cache, skipping moved and already-warm clients', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        try {
          window.clients = [
            { id: 621, addr: 'A St', lat: 1, lon: 2, geoAddr: 'A St' },        // seeds
            { id: 622, addr: 'B St', lat: 3, lon: 4, geoAddr: 'OLD St' },      // moved: skipped
            { id: 623, addr: 'C St' },                                          // no coords: skipped
            { id: 624, addr: 'D St', lat: 5, lon: 6, geoAddr: 'D St' },        // already warm: skipped
          ];
          localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 624: { addr: 'D St', lat: 5, lon: 6 } }));
          const added = _geoSeedClientCache();
          const cache = JSON.parse(localStorage.getItem('zp3_nearby_geo') || '{}');
          return { added, keys: Object.keys(cache).sort(), seeded: cache['621'] };
        } finally { if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo'); }
      });
      expect(r.added, 'one client needed seeding').toBe(1);
      expect(r.keys).toEqual(['621', '624']);
      expect(r.seeded).toEqual({ lat: 1, lon: 2, addr: 'A St' });
    });

    // THE HALF THAT WAS MISSING (2026-09-11). The first attempt at this
    // backfilled nothing on the owner's own account, because
    // _backfillNearbyGeoCache only geocodes clients whose CACHE is missing or
    // stale. A phone that had already geocoded its book had an empty uncached
    // list, so the sweep did nothing and the record stayed null forever, on
    // precisely the population the backfill exists for.
    test('a warm cache is written UP to a record that has none, with no geocode', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        const realSave = window.saveAll, realGeo = window._geocodeAddr;
        let saves = 0, geocodes = 0;
        try {
          window.saveAll = () => { saves++; };
          window._geocodeAddr = () => { geocodes++; return Promise.resolve(null); };
          window.clients = [
            { id: 701, addr: '1 A St' },                                       // cache only: writes up
            { id: 702, addr: '2 B St' },                                       // cache only: writes up
            { id: 703, addr: '3 C St', lat: 9, lon: 9, geoAddr: '3 C St' },    // already both: untouched
          ];
          localStorage.setItem('zp3_nearby_geo', JSON.stringify({
            701: { addr: '1 A St', lat: 39.1, lon: -95.1 },
            702: { addr: '2 B St', lat: 39.2, lon: -95.2 },
            703: { addr: '3 C St', lat: 9, lon: 9 },
          }));
          const n = _geoSyncClientCoords();
          return { n, saves, geocodes, c1: window.clients[0], c3: window.clients[2] };
        } finally {
          window.saveAll = realSave; window._geocodeAddr = realGeo;
          if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo');
        }
      });
      expect(r.n.up, 'two clients had coordinates the account could not see').toBe(2);
      expect(r.n.down, 'nothing needed pouring the other way').toBe(0);
      expect(r.geocodes, 'the coordinates were already on the device: no lookup').toBe(0);
      expect(r.saves, 'one save for the whole pass, not one per client').toBe(1);
      expect(r.c1.lat).toBeCloseTo(39.1, 5);
      expect(r.c1.geoAddr).toBe('1 A St');
      expect(r.c3.lat, 'a client already correct is left alone').toBe(9);
    });

    test('a stale cache entry is never written up', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        const realSave = window.saveAll; let saves = 0;
        try {
          window.saveAll = () => { saves++; };
          window.clients = [{ id: 711, addr: '9 New Rd' }];
          localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 711: { addr: '4 Old Way', lat: 1, lon: 2 } }));
          const n = _geoSyncClientCoords();
          return { n, saves, lat: window.clients[0].lat };
        } finally {
          window.saveAll = realSave;
          if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo');
        }
      });
      expect(r.n.up, 'the client moved, so the cached coordinates are wrong too').toBe(0);
      expect(r.saves, 'nothing to write means no save at all').toBe(0);
      expect(r.lat).toBeUndefined();
    });

    test('a boot with both copies already agreeing writes nothing anywhere', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        const realSave = window.saveAll; let saves = 0;
        try {
          window.saveAll = () => { saves++; };
          window.clients = [{ id: 721, addr: '7 Same St', lat: 5, lon: 6, geoAddr: '7 Same St' }];
          localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 721: { addr: '7 Same St', lat: 5, lon: 6 } }));
          return { n: _geoSyncClientCoords(), saves };
        } finally {
          window.saveAll = realSave;
          if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo');
        }
      });
      expect(r.n).toEqual({ down: 0, up: 0 });
      expect(r.saves, 'this runs on every boot: a settled book must be silent').toBe(0);
    });

    test('recording a geocode writes both copies, and writes nothing when already correct', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        const realSave = window.saveAll;
        let saves = 0;
        try {
          window.saveAll = () => { saves++; };
          localStorage.removeItem('zp3_nearby_geo');
          window.clients = [{ id: 631, addr: '2 Oak Ave' }];
          _geoRecordClientCoords(631, '2 Oak Ave', { lat: 39.5, lon: -95.5 });
          const afterFirst = saves;
          _geoRecordClientCoords(631, '2 Oak Ave', { lat: 39.5, lon: -95.5 });  // same again
          const c = window.clients[0];
          const cache = JSON.parse(localStorage.getItem('zp3_nearby_geo') || '{}');
          return { afterFirst, total: saves, lat: c.lat, lon: c.lon, geoAddr: c.geoAddr, cached: cache['631'] };
        } finally {
          window.saveAll = realSave;
          if (saved) localStorage.setItem('zp3_nearby_geo', saved); else localStorage.removeItem('zp3_nearby_geo');
        }
      });
      expect(r.afterFirst, 'the first geocode is written up').toBe(1);
      expect(r.total, 'the second changes nothing, so it must not fire a save').toBe(1);
      expect(r.lat).toBe(39.5);
      expect(r.geoAddr, 'the address the coordinates came from rides along').toBe('2 Oak Ave');
      expect(r.cached).toEqual({ lat: 39.5, lon: -95.5, addr: '2 Oak Ave' });
    });

    test('a client with no coordinates anywhere still has no fence', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_nearby_geo');
        try {
          localStorage.removeItem('zp3_nearby_geo');
          window.clients = [{ id: 641, name: 'Unlocated', addr: '404 Nowhere' }];
          window.jobs = [];
          return _geoDeriveFences('2026-09-01').filter(x => x.kind === 'client').length;
        } finally { if (saved) localStorage.setItem('zp3_nearby_geo', saved); }
      });
      expect(r).toBe(0);
    });

    test('the clocks are this person\'s own, closed, and touching the day', async () => {
      const r = await page.evaluate(() => {
        const savedTE = window.timeEntries, savedU = window._supaUser, savedE = window._isEmployee;
        try {
          window._supaUser = { id: 'me' }; window._isEmployee = false;
          window.timeEntries = [
            { id: 1, start_time: '2026-09-01T13:00:00Z', end_time: '2026-09-01T17:00:00Z', logged_by_uid: null },   // the owner's
            { id: 2, start_time: '2026-09-01T13:00:00Z', end_time: '2026-09-01T17:00:00Z', logged_by_uid: 'crew' },  // somebody else's
            { id: 3, start_time: '2026-08-20T13:00:00Z', end_time: '2026-08-20T17:00:00Z', logged_by_uid: null },   // another day
            { id: 4, start_time: '2026-09-01T18:00:00Z', end_time: null, open: true, logged_by_uid: null },          // still running
            null, { id: 5 },
          ];
          const ds = Date.parse('2026-09-01T05:00:00Z');
          const owner = _geoDeriveClocks(ds, ds + 86400000).map(c => [new Date(c.start).toISOString(), new Date(c.end).toISOString()]);
          window._supaUser = { id: 'crew' }; window._isEmployee = true;
          const crew = _geoDeriveClocks(ds, ds + 86400000).length;
          return { owner, crew };
        } finally { window.timeEntries = savedTE; window._supaUser = savedU; window._isEmployee = savedE; }
      });
      expect(r.owner).toEqual([['2026-09-01T13:00:00.000Z', '2026-09-01T17:00:00.000Z']]);
      expect(r.crew).toBe(1);
    });

    test('working hours default to 6am to 8pm Monday to Saturday, and Settings overrides them', async () => {
      const r = await page.evaluate(async () => {
        const saved = S.workHours;
        try {
          delete S.workHours; const def = _geoWorkHours();
          S.workHours = { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }; const set = _geoWorkHours();
          S.workHours = { start: 'junk', end: '', days: [] }; const junk = _geoWorkHours();
          // and the Settings form round-trips it
          const si = document.getElementById('set-wh-start'), ei = document.getElementById('set-wh-end'), sa = document.getElementById('set-wh-sat');
          let form = null;
          // saveSettings refuses to harvest a form that was never filled (the
          // registerDevice wipe guard), so fill it the way Settings does first.
          if (si && ei && sa && typeof loadSettingsForm === 'function') {
            loadSettingsForm();
            si.value = '07:30'; ei.value = '18:00'; sa.checked = false;
            await saveSettings(); await new Promise(r2 => setTimeout(r2, 50)); form = S.workHours;
          }
          return { def, set, junk, form };
        } finally { S.workHours = saved; }
      });
      expect(r.def).toEqual({ start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] });
      expect(r.set).toEqual({ start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] });
      expect(r.junk).toEqual({ start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] });
      if (r.form) expect(r.form).toEqual({ start: '07:30', end: '18:00', days: [1, 2, 3, 4, 5] });
    });
  });

  // ── The tape belongs to whoever has been carrying the phone ─────────────
  // Owner 2026-09-04: "say jack signs out of this device and onto another,
  // what happens to the deriver if he signs on a new device or a shared ipad
  // that others use? How do we ensure we dont re-derive rows that arent
  // accurate?"
  test.describe('the tape belongs to whoever has been carrying the phone', () => {
    const TAPE = [
      { ts: Date.parse('2026-08-25T13:00:00Z'), kind: 'automotive' },
      { ts: Date.parse('2026-08-25T13:30:00Z'), kind: 'onFoot' },
      { ts: Date.parse('2026-09-01T13:00:00Z'), kind: 'automotive' },
      { ts: Date.parse('2026-09-01T13:30:00Z'), kind: 'onFoot' },
    ];
    const withTape = () => page.evaluate((T) => {
      window.__realTd = window._geoTdPlugin;
      window._geoTdPlugin = () => ({ motionSince: async ({ sinceMs }) => ({ available: true, transitions: T.filter(t => t.ts >= (sinceMs || 0)) }) });
      window._geoDeriveTape = window.__realDeriveTape;   // see the note in beforeAll
    }, TAPE);
    const restore = () => page.evaluate(() => { window._geoTdPlugin = window.__realTd; localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log'); });

    test('a brand-new device has no usable history for yesterday, and today from now on', async () => {
      await withTape();
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log'); localStorage.removeItem('zp3_geo_derive_ver');
          const savedUser = window._supaUser; window._supaUser = { id: 'jack' };
          try {
            const before = await _geoDeriveTape(0);       // no claim yet: trusts nothing older than now
            _geoTapeClaim();
            const o = JSON.parse(localStorage.getItem('zp3_geo_tape_owner'));
            const after = await _geoDeriveTape(0);
            return { before: before.length, after: after.length, uid: o.uid, sinceRecent: Date.now() - o.since < 5000 };
          } finally { window._supaUser = savedUser; }
        });
        expect(r.before, 'nothing before the claim').toBe(0);
        expect(r.after, 'the past week of somebody else\'s phone is not his').toBe(0);
        expect(r.uid).toBe('jack');
        expect(r.sinceRecent, 'the claim starts now, not last week').toBe(true);
      } finally { await restore(); }
    });

    test('a phone that was already deriving keeps its seven-day window across the upgrade', async () => {
      await withTape();
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
          localStorage.setItem('zp3_geo_derive_ver', 'older-build');
          const savedUser = window._supaUser; window._supaUser = { id: 'jack' };
          try {
            _geoTapeClaim();
            const o = JSON.parse(localStorage.getItem('zp3_geo_tape_owner'));
            const days = (Date.now() - o.since) / 86400000;
            return { days, seen: (await _geoDeriveTape(0)).map(t => t.ts) };
          } finally { window._supaUser = savedUser; localStorage.removeItem('zp3_geo_derive_ver'); }
        });
        expect(Math.round(r.days)).toBe(7);
        // Only the Sept 1 pair is inside a seven-day window from today-ish
        // (the fixture is dated; what matters is the window is seven days,
        // not zero and not forever).
        expect(r.seen.every(ts => ts >= Date.now() - 7 * 86400000 - 60000)).toBe(true);
      } finally { await restore(); }
    });

    test('somebody else signing in takes the phone: the previous claim is over', async () => {
      await withTape();
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log'); localStorage.removeItem('zp3_geo_derive_ver');
          const savedUser = window._supaUser;
          try {
            // A HANDOVER TAKES TIME. Three claims in the same millisecond make
            // zero-length spans, which the reader drops as the nothing they
            // are, so the clock has to move the way a real day does.
            const realNow = Date.now; let t = realNow.call(Date);
            Date.now = () => t;
            const later = ms => { t += ms; };
            window._supaUser = { id: 'jack' }; _geoTapeClaim();
            const jack1 = JSON.parse(localStorage.getItem('zp3_geo_tape_owner'));
            later(3600000);
            window._supaUser = { id: 'dad' }; _geoTapeClaim();
            const dad = JSON.parse(localStorage.getItem('zp3_geo_tape_owner'));
            later(3600000);
            // Jack again, later: a fresh claim, never the old one back.
            window._supaUser = { id: 'jack' }; _geoTapeClaim();
            const jack2 = JSON.parse(localStorage.getItem('zp3_geo_tape_owner'));
            later(3600000);
            Date.now = realNow;
            // Dad is no longer holding the phone, but the log remembers the
            // span he DID hold, and that span is his to read. See the
            // assertion note below: this is the behaviour that changed.
            window._supaUser = { id: 'dad' };
            const dadWindows = _geoTapeMine().length;
            const dadReadsJacksTape = (await _geoDeriveTape(0)).some(t => t.ts > jack2.since);
            const shared = _geoTapeShared();
            return { jack1: jack1.uid, dad: dad.uid, jack2: jack2.uid, fresh: jack2.since >= dad.since,
              dadWindows, dadReadsJacksTape, shared };
          } finally { window._supaUser = savedUser; }
        });
        expect([r.jack1, r.dad, r.jack2]).toEqual(['jack', 'dad', 'jack']);
        expect(r.fresh, 'a new claim, not the old one resurrected').toBe(true);
        // ASSERTION RESTATED 2026-09-10, and the old one was right when it
        // was written. With a single {uid, since} slot there was no record of
        // who had held the phone when, so "you are not the current owner"
        // was the only safe answer and dad read nothing.
        //
        // It is wrong now, and it is wrong in a way that cost the owner an
        // afternoon: on a phone two businesses share, that rule means every
        // sign-in permanently blinds the other account to its own history.
        // His 1:26pm arrival at John Doe could not be closed and could not be
        // rebuilt afterwards, because signing back in started his read floor
        // at that instant. The claim is a log now, so a person reads the
        // spans they actually held and nobody else's.
        expect(r.dadWindows, 'dad held the phone once, so he has one span to read').toBe(1);
        expect(r.dadReadsJacksTape, 'his own span only, never the minutes jack holds now').toBe(false);
        expect(r.shared, 'two accounts on one handset inside the window').toBe(true);
      } finally { await restore(); }
    });

    test('no signed-in user claims nothing and reads nothing', async () => {
      await withTape();
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
          const savedUser = window._supaUser; window._supaUser = null;
          try { _geoTapeClaim(); return { key: localStorage.getItem('zp3_geo_tape_owner'), n: (await _geoDeriveTape(0)).length }; }
          finally { window._supaUser = savedUser; }
        });
        expect(r.key).toBeNull();
        expect(r.n).toBe(0);
      } finally { await restore(); }
    });

    test('the log survives a handover and back: each account reads its own spans', async () => {
      await withTape();
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
          localStorage.removeItem('zp3_geo_derive_ver');
          const savedUser = window._supaUser;
          try {
            // His real 10 September, compressed: his own morning, four hours
            // on the other account, then back. Each step needs real elapsed
            // time or the spans are zero-length and mean nothing.
            const realNow = Date.now; let t = realNow.call(Date);
            Date.now = () => t;
            const later = ms => { t += ms; };
            window._supaUser = { id: 'logan' }; _geoTapeClaim();
            const loganFirst = _geoTapeSince();
            later(8 * 3600000);
            window._supaUser = { id: 'blake' }; _geoTapeClaim();
            later(4 * 3600000);
            window._supaUser = { id: 'logan' }; _geoTapeClaim();
            later(60000);
            // THE WHOLE POINT: back on his own account, he can still reach
            // the morning he actually held, not just this instant.
            const out = { reachesMorning: _geoTapeSince() <= loganFirst, spans: _geoTapeMine().length };
            Date.now = realNow;
            return out;
          } finally { window._supaUser = savedUser; }
        });
        expect(r.reachesMorning, 'signing back in must not throw away his own morning').toBe(true);
        expect(r.spans, 'two separate spells holding the phone').toBe(2);
      } finally { await restore(); }
    });

    test('release closes the span without opening another', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
        const savedUser = window._supaUser;
        try {
          window._supaUser = { id: 'logan' }; _geoTapeClaim();
          const openBefore = JSON.parse(localStorage.getItem('zp3_geo_tape_log')).filter(x => x.to == null).length;
          _geoTapeRelease();
          const log = JSON.parse(localStorage.getItem('zp3_geo_tape_log'));
          _geoTapeRelease();   // idempotent: nothing open to close
          return { openBefore, openAfter: log.filter(x => x.to == null).length, kept: log.length,
            stillLen: JSON.parse(localStorage.getItem('zp3_geo_tape_log')).length };
        } finally { window._supaUser = savedUser; }
      });
      expect(r.openBefore).toBe(1);
      expect(r.openAfter, 'signing out ends your hold on the tape').toBe(0);
      expect(r.kept, 'the span is closed, never deleted: it is what you read back').toBe(1);
      expect(r.stillLen, 'releasing twice adds nothing').toBe(1);
    });

    test('a visit that starts under one business can still end under it', async () => {
      // Owner 2026-09-10: "doesn't the ladder tell us if an on site visit
      // started under one business and therefore it must end on that
      // business?" It does, and clipping the tape to the signed-in login's
      // own spans made it impossible. His real day: arrive at John Doe at
      // 1:26pm on his account, drive away at 5:14pm on the other one. The
      // departure has to stay readable or rule 5 throws the visit away.
      const TAPE2 = [
        { ts: Date.parse('2026-09-10T18:26:00Z'), kind: 'onFoot' },      // arrives, his hat
        { ts: Date.parse('2026-09-10T22:14:00Z'), kind: 'automotive' },  // leaves, other hat
      ];
      await page.evaluate((T) => {
        window.__realTd2 = window._geoTdPlugin;
        window._geoTdPlugin = () => ({ motionSince: async ({ sinceMs }) => ({ available: true, transitions: T.filter(t => t.ts >= (sinceMs || 0)) }) });
        window._geoDeriveTape = window.__realDeriveTape;
      }, TAPE2);
      try {
        const r = await page.evaluate(async () => {
          localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
          const savedUser = window._supaUser;
          const realNow = Date.now; let t = Date.parse('2026-09-10T17:00:00Z');
          Date.now = () => t;
          try {
            window._supaUser = { id: 'logan' }; _geoTapeClaim();   // his morning
            t = Date.parse('2026-09-10T20:41:00Z');
            window._supaUser = { id: 'blake' }; _geoTapeClaim();   // hands it over 3:41pm
            t = Date.parse('2026-09-10T23:30:00Z');
            window._supaUser = { id: 'logan' };
            const tape = await _geoDeriveTape(0);
            return { shared: _geoTapeShared(), seen: tape.map(x => x.kind),
              hasDeparture: tape.some(x => x.kind === 'automotive') };
          } finally { window._supaUser = savedUser; Date.now = realNow; }
        });
        expect(r.shared, 'two accounts on this handset').toBe(true);
        expect(r.hasDeparture, 'the departure fell in the other hat and must still be readable, or the visit has one end and is thrown away').toBe(true);
        expect(r.seen).toEqual(['onFoot', 'automotive']);
      } finally {
        await page.evaluate(() => { window._geoTdPlugin = window.__realTd2; });
      }
    });

    test('switching business drops the other account fences from the phone', async () => {
      // Owner 2026-09-10, signed into his second business: "it says I'm at
      // Tradedesk shop under sample co." The coprocessor still held the first
      // account's regions, so his Sample Co session opened a dwell on a
      // TradeDesk place four metres from its shop.
      const r = await page.evaluate(() => {
        const saved = { user: window._supaUser, cid: window._geoCid, td: window._geoTdPlugin, park: _geoParkModeOn };
        const stops = [];
        try {
          localStorage.removeItem('zp3_geo_armed_for');
          window._geoTdPlugin = () => ({ stopAll: (a) => { stops.push((a && a.reason) || '?'); } });
          window._supaUser = { id: 'logan' }; window._geoCid = () => 'logan';
          _geoDisarmIfForeign();                        // first arm on this phone
          const afterFirst = stops.length;
          _geoDisarmIfForeign();                        // same account again: no drop
          const afterSame = stops.length;
          // He switches. A stale dwell and open entry are sitting there.
          localStorage.setItem('zp3_geo_dwell', JSON.stringify({ uid: 'logan', d: { name: 'TradeDesk shop' } }));
          localStorage.setItem('zp3_geo_open', JSON.stringify({ uid: 'logan' }));
          window._geoOpenDwell = { name: 'TradeDesk shop' };
          _geoParkModeOn = true;
          window._supaUser = { id: 'blake' }; window._geoCid = () => 'blake';
          _geoDisarmIfForeign();
          return { afterFirst, afterSame, afterSwitch: stops.length, reason: stops[stops.length - 1] || null,
            dwellGone: localStorage.getItem('zp3_geo_dwell') === null,
            openGone: localStorage.getItem('zp3_geo_open') === null,
            liveGone: window._geoOpenDwell === null,
            parkOff: _geoParkModeOn === false,
            tag: localStorage.getItem('zp3_geo_armed_for') };
        } finally {
          window._supaUser = saved.user; window._geoCid = saved.cid;
          window._geoTdPlugin = saved.td; _geoParkModeOn = saved.park;
          localStorage.removeItem('zp3_geo_armed_for');
          localStorage.removeItem('zp3_geo_dwell'); localStorage.removeItem('zp3_geo_open');
          window._geoOpenDwell = null;
        }
      });
      expect(r.afterFirst, 'nothing to drop on a phone that has armed nothing yet').toBe(0);
      expect(r.afterSame, 'the same account booting twice must not disarm itself').toBe(0);
      expect(r.afterSwitch, 'the other business fences are dropped').toBe(1);
      expect(r.reason).toBe('account changed');
      expect(r.dwellGone, 'a dwell named for the old account cannot survive the switch').toBe(true);
      expect(r.openGone).toBe(true);
      expect(r.liveGone).toBe(true);
      expect(r.parkOff, 'park was armed on the old account fences').toBe(true);
      expect(r.tag).toBe('blake|blake');
    });

    test('a crew hat and an owner hat on one login are different fence sets', async () => {
      // Same login, two businesses: the tag is person AND account, because a
      // crew member's fences are their employer's, not their own.
      const r = await page.evaluate(() => {
        const saved = { user: window._supaUser, cid: window._geoCid, td: window._geoTdPlugin };
        const stops = [];
        try {
          localStorage.removeItem('zp3_geo_armed_for');
          window._geoTdPlugin = () => ({ stopAll: () => { stops.push(1); } });
          window._supaUser = { id: 'blake' }; window._geoCid = () => 'logan';   // crew hat on TradeDesk
          _geoDisarmIfForeign();
          window._geoCid = () => 'blake';                                       // owner hat, Sample Co
          _geoDisarmIfForeign();
          return { drops: stops.length, tag: localStorage.getItem('zp3_geo_armed_for') };
        } finally {
          window._supaUser = saved.user; window._geoCid = saved.cid; window._geoTdPlugin = saved.td;
          localStorage.removeItem('zp3_geo_armed_for');
        }
      });
      expect(r.drops, 'the same person changing hats still changes fence sets').toBe(1);
      expect(r.tag).toBe('blake|blake');
    });

    test('the seven-day rebuild is per person, not per phone', async () => {
      // Owner 2026-09-10: "I'm in my own account now looking at Aldi guys
      // that's not fixed." The other account on the same handset had booted
      // the new build first and spent the shared version marker, so his own
      // account got the two-day window and never re-derived 6 September.
      const r = await page.evaluate(() => {
        const saved = { user: window._supaUser, ver: window._geoDeriveAppVer };
        try {
          window._geoDeriveAppVer = () => '09.10.26.22';
          ['logan', 'blake', 'anon'].forEach(u => localStorage.removeItem('zp3_geo_derive_ver_' + u));
          localStorage.removeItem('zp3_geo_derive_ver');
          window._supaUser = { id: 'blake' };
          const blakeFirst = _geoDeriveRebuildDays();                 // never seen it: full
          localStorage.setItem(_geoDeriveVerSeenKey(), '09.10.26.22'); // blake finishes his rebuild
          localStorage.setItem('zp3_geo_derive_ver', '09.10.26.22');   // and stamps the device marker
          const blakeAgain = _geoDeriveRebuildDays();                 // seen: live window
          window._supaUser = { id: 'logan' };
          const loganAfter = _geoDeriveRebuildDays();                 // MUST still be full
          localStorage.setItem(_geoDeriveVerSeenKey(), '09.10.26.22');
          const loganAgain = _geoDeriveRebuildDays();
          return { blakeFirst, blakeAgain, loganAfter, loganAgain };
        } finally {
          window._supaUser = saved.user; window._geoDeriveAppVer = saved.ver;
          ['logan', 'blake', 'anon'].forEach(u => localStorage.removeItem('zp3_geo_derive_ver_' + u));
          localStorage.removeItem('zp3_geo_derive_ver');
        }
      });
      expect(r.blakeFirst, 'a build this account has not derived on rebuilds the week').toBe(7);
      expect(r.blakeAgain, 'and not again on the next boot').toBe(2);
      expect(r.loganAfter, 'the other account spending the marker must not cost him his rebuild').toBe(7);
      expect(r.loganAgain).toBe(2);
    });

    test('one account on the phone is never treated as shared', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
        const savedUser = window._supaUser;
        try {
          window._supaUser = { id: 'logan' }; _geoTapeClaim(); _geoTapeClaim(); _geoTapeClaim();
          const solo = _geoTapeShared();
          window._supaUser = { id: 'blake' }; _geoTapeClaim();
          return { solo, shared: _geoTapeShared() };
        } finally { window._supaUser = savedUser; }
      });
      expect(r.solo, 'signing in repeatedly is still one person').toBe(false);
      expect(r.shared).toBe(true);
    });

    test('junk in the claim slot is ignored, never a throw', async () => {
      const r = await page.evaluate(async () => {
        const out = [];
        for (const junk of ['{INVALID', '{"uid":"jack"}', '{"since":5}', '[]', 'null']) {
          localStorage.setItem('zp3_geo_tape_owner', junk);
          try { out.push(_geoTapeOwner() === null && typeof _geoTapeSince() === 'number'); } catch (e) { out.push('THREW'); }
        }
        localStorage.removeItem('zp3_geo_tape_owner'); localStorage.removeItem('zp3_geo_tape_log');
        return out;
      });
      expect(r).toEqual([true, true, true, true, true]);
    });
  });

  test.describe('the Central day', () => {
    test('bounds come out of Intl, in daylight and standard time', async () => {
      const r = await page.evaluate(() => {
        S.bizTz = 'America/Chicago';
        const a = _geoDayBounds('2026-09-01'), b = _geoDayBounds('2026-01-15');
        return { a: [new Date(a.start).toISOString(), new Date(a.end).toISOString()],
          b: [new Date(b.start).toISOString(), new Date(b.end).toISOString()],
          junk: [_geoDayBounds(''), _geoDayBounds('nope'), _geoDayBounds(null)],
          key: _geoDayKeyOf(Date.parse('2026-09-02T04:59:00Z'), 'America/Chicago') };
      });
      expect(r.a).toEqual(['2026-09-01T05:00:00.000Z', '2026-09-02T05:00:00.000Z']);
      expect(r.b).toEqual(['2026-01-15T06:00:00.000Z', '2026-01-16T06:00:00.000Z']);
      expect(r.junk).toEqual([null, null, null]);
      expect(r.key, 'four fifty-nine UTC on the 2nd is still the 1st in Central').toBe('2026-09-01');
    });
  });

  test.describe('deriving a day', () => {
    const tape = [
      { ts: T(7, 40), kind: 'onFoot' }, { ts: T(7, 52), kind: 'driving' }, { ts: T(8, 3), kind: 'onFoot' },
      { ts: T(12, 21), kind: 'driving' }, { ts: T(12, 31), kind: 'onFoot' },
    ];
    const seed = async () => page.evaluate(([tape, SHOP, DOE, T, OWNED_SINCE]) => {
      S.bizTz = 'America/Chicago';
      S.officeLat = SHOP.lat; S.officeLon = SHOP.lng; S.bname = 'JS Solutions';
      window.places = [];
      window.clients = [{ id: 1788214075432, name: 'John Doe', addr: '2950 SW McClure Rd' }];
      localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 1788214075432: { addr: '2950 SW McClure Rd', lat: DOE.lat, lon: DOE.lng } }));
      window._geoDeriveTape = async () => tape;
      // This phone has been this person's since long before the day: the
      // normal case, and the one in which a sweep is allowed at all.
      localStorage.setItem('zp3_geo_tape_owner', JSON.stringify({ uid: _supaUser.id, since: OWNED_SINCE }));
      // One account has ever held this phone, so the ownership guard
      // (geoSpanClaim) is off and these tests read the single-account path.
      localStorage.removeItem('zp3_geo_tape_log');
      window._geoDrainQueue = () => {};   // hold the queue so it can be inspected
      window._routeDistance = async () => ({ miles: 0, mins: 0 });   // no router unless a test brings one
      _geoFixLogPush(T[0], SHOP.lat, SHOP.lng, 5);
      _geoFixLogPush(T[1], DOE.lat, DOE.lng, 5);
      _geoFixLogPush(T[2], DOE.lat, DOE.lng, 5);
      _geoFixLogPush(T[3], SHOP.lat, SHOP.lng, 5);
      _geoFixLogPush(T[4], SHOP.lat, SHOP.lng, 5);
    }, [tape, SHOP, DOE, [T(7, 52) + 5000, T(8, 3) + 5000, T(12, 21) + 5000, T(12, 31) + 5000, T(13, 0)], DAY_START - 30 * 86400000]);

    test('one queue item per day, carrying the whole day for geo_replace_day', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        const res = await _geoDeriveDayNow(DAY, null);
        const q = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]');
        return { res: { d: res.dwells.length, l: res.legs.length }, q: q.map(x => ({ rpc: x.rpc, key: x.row.client_key, args: x.args })) };
      }, DAY);
      expect(r.res).toEqual({ d: 1, l: 2 });
      expect(r.q).toHaveLength(1);
      const it = r.q[0];
      expect(it.rpc).toBe('geo_replace_day');
      expect(it.key).toBe('rpc:' + DAY);
      expect(it.args.p_sweep, 'the tape covered the day, so the sweep is allowed').toBe(true);
      expect(it.args.p_day).toBe(DAY);
      expect(it.args.p_employee).toBe(await page.evaluate(() => _supaUser.id));
      expect(it.args.p_day_start).toBe(new Date(DAY_START).toISOString());
      expect(it.args.p_day_end).toBe(new Date(DAY_END).toISOString());
      expect(it.args.p_time.map(x => x.source)).toEqual(['client', 'drive', 'drive']);
      expect(it.args.p_time[0].dest_place).toBe('John Doe');
      expect(it.args.p_shop).toEqual([]);
      expect(it.args.p_miles).toHaveLength(2);
      expect(it.args.p_miles[0].legKey).toBe(it.args.p_time[1].client_key);
    });

    // Owner 2026-09-04, walking it through: "I sign out and sign in on jacks
    // phone, we both have different core motions, what happens." The claim
    // starts at the swap. The morning's rows came from the other phone and are
    // not in this derive's set; a sweep would have retired them.
    test('a phone claimed part-way through the day may add, never retire', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        // Claimed at 10am on the day itself.
        localStorage.setItem('zp3_geo_tape_owner', JSON.stringify({ uid: _supaUser.id, since: Date.parse(DAY + 'T15:00:00Z') }));
        const res = await _geoDeriveDayNow(DAY, null);
        const q = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]');
        return { rows: q[0] && q[0].args.p_time.length, sweep: q[0] && q[0].args.p_sweep, derived: !!res };
      }, DAY);
      expect(r.derived).toBe(true);
      expect(r.rows, 'what it can prove still lands').toBeGreaterThan(0);
      expect(r.sweep, 'but nothing from before the claim is retired').toBe(false);
    });

    test('a second derive of the same day replaces the item, never stacks a second', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        await _geoDeriveDayNow(DAY, null);
        await _geoDeriveDayNow(DAY, null);
        const q = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]');
        return q.map(x => x.row.client_key);
      }, DAY);
      expect(r).toEqual(['rpc:' + DAY]);
    });

    test('an empty tape derives nothing and touches no queue: a browser cannot wipe a day', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window._geoDeriveTape = async () => [];
        const res = await _geoDeriveDayNow(DAY, null);
        const other = await (async () => { window._geoDeriveTape = async () => [{ ts: DAY_START - 5 * 86400000 + 10 * 3600000, kind: 'driving' }]; return _geoDeriveDayNow(DAY, null); })();
        return { res, other, q: JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length };
      }, DAY);
      expect(r.res).toBeNull();
      expect(r.other, 'a tape that does not cover the day is the same as no tape').toBeNull();
      expect(r.q).toBe(0);
    });

    test('the in-memory mileage follows: old legs for the day go, hand trips stay, the vehicle rides across', async () => {
      await seed();
      const r = await page.evaluate(async ([DAY, PREV_DAY]) => {
        window.mileage = [
          { id: 'old-gps', gps: true, date: DAY, miles: 9 },
          { id: 'hand', gps: false, date: DAY, miles: 12 },
          { id: 'other-day', gps: true, date: PREV_DAY, miles: 4 },
        ];
        const first = await _geoDeriveDayNow(DAY, null);
        const legId = first.legs[0].id;
        mileage.find(m => m.id === legId).vehicle = '2018 Silverado 2500';
        await _geoDeriveDayNow(DAY, null);
        return { ids: mileage.map(m => m.id).sort(), veh: mileage.find(m => m.id === legId).vehicle, legId };
      }, [DAY, PREV_DAY]);
      expect(r.ids).not.toContain('old-gps');
      expect(r.ids).toContain('hand');
      expect(r.ids).toContain('other-day');
      expect(r.ids).toContain(r.legId);
      expect(r.veh).toBe('2018 Silverado 2500');
    });

    test('the drain calls geo_replace_day with the item and removes it; a network failure leaves it', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        await _geoDeriveDayNow(DAY, null);
        const calls = [];
        const origSupa = window._supa;
        window._supa = { rpc: async (name, args) => { calls.push({ name, day: args.p_day, n: args.p_time.length }); return { data: { ok: true }, error: null }; },
          from: origSupa.from.bind(origSupa) };
        // Restore the real drain for this call (a function declaration cannot
        // be restored with delete; it is kept by reference in beforeAll).
        window._geoDrainQueue = window.__realDrain;
        try {
          await _geoDrainQueue();
          const left = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
          // Now a transient failure: the item must survive for the next drain.
          window._geoDrainQueue = () => {};
          await _geoDeriveDayNow(DAY, null);
          window._geoDrainQueue = window.__realDrain;
          window._supa = { rpc: async () => ({ data: null, error: { message: 'Failed to fetch' } }), from: origSupa.from.bind(origSupa) };
          await _geoDrainQueue();
          const leftAfterFail = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
          return { calls, left, leftAfterFail };
        } finally { window._supa = origSupa; window._geoDrainQueue = () => {}; }
      }, DAY);
      expect(r.calls).toEqual([{ name: 'geo_replace_day', day: DAY, n: 3 }]);
      expect(r.left).toBe(0);
      expect(r.leftAfterFail).toBe(1);
    });

    test('a project without the function yet does not block the queue behind a stuck item', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        await _geoDeriveDayNow(DAY, null);
        const origSupa = window._supa;
        window._supa = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.geo_replace_day(...) in the schema cache', code: 'PGRST202' } }),
          from: origSupa.from.bind(origSupa) };
        window._geoDrainQueue = window.__realDrain;
        try { await _geoDrainQueue(); return JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length; }
        finally { window._supa = origSupa; window._geoDrainQueue = () => {}; }
      }, DAY);
      expect(r).toBe(0);
    });

    // ── Missing evidence is not an empty day ──────────────────────────────
    // Owner 2026-09-02, 22:33: "I also logged back in and see my mileage gone
    // for today when I should have four trips". A live derive on a fresh
    // build had the tape and no fixes, resolved nothing, and replaced the day
    // with nothing.
    test('drives on the tape that resolve to nowhere: no queue item, a note, and the day is left alone', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [{ id: 'leg-live', gps: true, date: DAY, miles: 9 }];
        localStorage.removeItem('zp3_geo_fixlog'); localStorage.removeItem('td_geo_park_log');
        const real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        window._geoDeriveServerFixes = async () => { const o = []; o.appEvents = []; return o; };
        try {
          const res = await _geoDeriveDayNow(DAY, null);
          const notes = JSON.parse(localStorage.getItem('td_geo_park_log') || '[]').filter(n => n.ev === 'derive-skip');
          return { res, q: JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length, notes: notes.map(n => n.x), miles: mileage.map(m => m.id) };
        } finally { window._geoDeriveServerFixes = real; }
      }, DAY);
      expect(r.res).toBeNull();
      expect(r.q, 'nothing is sent to geo_replace_day').toBe(0);
      expect(r.notes).toEqual([DAY + ': 2 drives on the tape, none resolved']);
      expect(r.miles, 'the in-memory legs are not touched either').toEqual(['leg-live']);
    });

    test('a thin local log asks the server once and keeps what it got', async () => {
      await seed();
      const r = await page.evaluate(async ([DAY, SHOP, DOE, T]) => {
        window.mileage = [];
        localStorage.removeItem('zp3_geo_fixlog'); localStorage.removeItem('zp3_geo_applog');
        const real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        const calls = [];
        window._geoDeriveServerFixes = async (a, b) => {
          calls.push([a, b]);
          const o = [{ ts: T[0], lat: SHOP.lat, lng: SHOP.lng, acc: null }, { ts: T[1], lat: DOE.lat, lng: DOE.lng, acc: 5 },
            { ts: T[2], lat: DOE.lat, lng: DOE.lng, acc: 5 }, { ts: T[3], lat: SHOP.lat, lng: SHOP.lng, acc: 5 }, { ts: T[4], lat: SHOP.lat, lng: SHOP.lng, acc: 5 },
            { ts: T[1], lat: DOE.lat, lng: DOE.lng, acc: 5 }];   // the same fix twice from two tables
          o.appEvents = [{ ts: T[2], kind: 'active' }, { ts: T[3], kind: 'background' }];
          return o;
        };
        try {
          const res = await _geoDeriveDayNow(DAY, null);
          const log = _geoFixLogRead(), app = _geoAppLogRead();
          return { res: { d: res.dwells.length, l: res.legs.length }, calls, log: log.map(f => f.ts), app: app.map(e => [e.ts, e.kind]),
            q: JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length };
        } finally { window._geoDeriveServerFixes = real; }
      }, [DAY, SHOP, DOE, [T(7, 52) + 5000, T(8, 3) + 5000, T(12, 21) + 5000, T(12, 31) + 5000, T(13, 0)]]);
      expect(r.res, 'the server\'s fixes resolve the day').toEqual({ d: 1, l: 2 });
      expect(r.q).toBe(1);
      expect(r.calls).toEqual([[DAY_START - 2 * 3600000, DAY_START + 86400000]]);
      expect(r.log, 'seeded, sorted, no fix twice').toEqual([T(7, 52) + 5000, T(8, 3) + 5000, T(12, 21) + 5000, T(12, 31) + 5000, T(13, 0)]);
      expect(r.app).toEqual([[T(12, 21) + 5000, 'active'], [T(12, 31) + 5000, 'background']]);
    });

    test('a log that already knows the day does not ask the server', async () => {
      await seed();
      const r = await page.evaluate(async ([DAY, SHOP, T]) => {
        window.mileage = [];
        for (let i = 0; i < 30; i++) _geoFixLogPush(T + i * 60000, SHOP.lat, SHOP.lng, 5);
        const real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        let calls = 0;
        window._geoDeriveServerFixes = async () => { calls++; const o = []; o.appEvents = []; return o; };
        try { const res = await _geoDeriveDayNow(DAY, null); return { calls, l: res.legs.length }; }
        finally { window._geoDeriveServerFixes = real; }
      }, [DAY, SHOP, T(13, 5)]);
      expect(r.calls).toBe(0);
      expect(r.l).toBe(2);
    });

    test('the seed is bounded: eight days, the newest six thousand, and junk is ignored', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('zp3_geo_fixlog'); localStorage.removeItem('zp3_geo_applog');
        const now = Date.now();
        const list = [{ ts: now - 9 * 86400000, lat: 39, lng: -95 }, { ts: 'x', lat: 39, lng: -95 }, { lat: 39, lng: -95 }, { ts: now - 1000, lat: 'a', lng: -95 }, null];
        for (let i = 0; i < 6500; i++) list.push({ ts: now - 7 * 86400000 + i * 1000, lat: 39, lng: -95 });
        _geoFixLogSeed(list); _geoFixLogSeed(null); _geoFixLogSeed([]);
        _geoAppLogSeed([{ ts: now - 5000, kind: 'active' }, { ts: now - 5000, kind: 'active' }, { ts: now - 4000 }, { kind: 'background' }, null]);
        _geoAppLogSeed(undefined);
        const log = _geoFixLogRead();
        return { n: log.length, oldest: log[0].ts >= now - 8 * 86400000, app: _geoAppLogRead().length };
      });
      expect(r.n).toBe(6000);
      expect(r.oldest).toBe(true);
      expect(r.app).toBe(1);
    });

    test('a leg\'s miles are the road distance when the router answers, never less than the trace', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        localStorage.removeItem('zp3_geo_routes');
        const calls = [];
        window._routeDistance = async (a, b) => { calls.push([a.lat, b.lat]); return { miles: 3.2, mins: 9 }; };
        const first = await _geoDeriveDayNow(DAY, null);
        const q1 = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]')[0].args.p_miles;
        // Same day again: the cache answers, the router is not asked twice.
        await _geoDeriveDayNow(DAY, null);
        const cache = JSON.parse(localStorage.getItem('zp3_geo_routes') || '{}');
        // A router that says less than the trace does not shrink the leg.
        window._routeDistance = async () => ({ miles: 0.4, mins: 2 });
        localStorage.removeItem('zp3_geo_routes');
        await _geoDeriveDayNow(DAY, null);
        const q3 = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]')[0].args.p_miles;
        // A router that throws leaves the trace's number.
        window._routeDistance = async () => { throw new Error('offline'); };
        localStorage.removeItem('zp3_geo_routes');
        await _geoDeriveDayNow(DAY, null);
        const q4 = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]')[0].args.p_miles;
        return { legs: first.legs.map(l => l.miles), q1: q1.map(m => [m.miles, m.routeMiles, m.calc_method]), calls: calls.length,
          cacheN: Object.keys(cache).length, q3: q3.map(m => [m.miles, m.calc_method]), q4: q4.map(m => [m.miles, m.calc_method]),
          inMem: mileage.map(m => m.miles) };
      }, DAY);
      expect(r.q1).toEqual([[3.2, 3.2, 'derived-routed'], [3.2, 3.2, 'derived-routed']]);
      expect(r.calls, 'one call per distinct pair of ends').toBe(2);
      expect(r.cacheN).toBe(2);
      for (let i = 0; i < 2; i++) {
        expect(r.q3[i][0]).toBeCloseTo(r.legs[i], 5);
        expect(r.q3[i][1]).toBe('derived-path');
        expect(r.q4[i][0]).toBeCloseTo(r.legs[i], 5);
      }
      expect(r.inMem).toEqual(r.q4.map(x => x[0]));
    });

    test('once the table has taken a day, the list is read back from it', async () => {
      await seed();
      const r = await page.evaluate(async ([DAY, PREV_DAY]) => {
        window.mileage = [{ id: 'hand', gps: false, date: DAY, miles: 12 }, { id: 'stray', gps: true, date: DAY, miles: 1 }];
        await _geoDeriveDayNow(DAY, null);
        const legIds = mileage.filter(m => m.gps).map(m => m.id).sort();
        // Something on the phone drops a leg from the list (the old classifier
        // did exactly this); a person also set a vehicle on the other one.
        mileage.splice(mileage.findIndex(m => m.id === legIds[0]), 1);
        mileage.find(m => m.id === legIds[1]).vehicle = 'F-250';
        const origSupa = window._supa;
        const serverRows = legIds.map(id => ({ id, data: { id, gps: true, date: DAY, miles: 3.2, from_name: 'S', to_name: 'D' } }))
          .concat([{ id: 'other-day', data: { id: 'other-day', gps: true, date: PREV_DAY, miles: 2 } }]);
        const sel = { data: serverRows, error: null };
        const chain = { eq: () => chain, is: () => chain, then: (res) => res(sel) };
        window._supa = { rpc: async () => ({ data: { ok: true }, error: null }), from: (t) => t === 'td_mileage' ? { select: () => chain } : origSupa.from(t) };
        window._geoDrainQueue = window.__realDrain;
        try {
          await _geoDrainQueue();
          await new Promise(r => setTimeout(r, 50));
          return { ids: mileage.map(m => m.id).sort(), veh: mileage.find(m => m.id === legIds[1]).vehicle, miles: mileage.filter(m => m.gps).map(m => m.miles),
            direct: await _geoDeriveSyncMileage(DAY), junk: [await _geoDeriveSyncMileage(''), await _geoDeriveSyncMileage(null)] };
        } finally { window._supa = origSupa; window._geoDrainQueue = () => {}; }
      }, [DAY, PREV_DAY]);
      expect(r.ids).toEqual(['hand'].concat(r.ids.filter(i => /^j-/.test(i))).sort());
      expect(r.ids.filter(i => /^j-/.test(i))).toHaveLength(2);
      expect(r.ids).not.toContain('stray');
      expect(r.ids).not.toContain('other-day');
      expect(r.veh, 'what a person set on the row survives the read-back').toBe('F-250');
      expect(r.miles).toEqual([3.2, 3.2]);
      expect(r.direct).toBe(2);
      expect(r.junk).toEqual([0, 0]);
    });

    test('the server fetch pages by capture time until a short page, so a dense leg comes back whole', async () => {
      const r = await page.evaluate(async () => {
        const origSupa = window._supa;
        const calls = [];
        const rowsFor = (table, sel) => {
          if (table === 'geo_events' && sel === 'ts,lat,lon') return Array.from({ length: 1300 }, (_, i) => ({ ts: new Date(Date.parse('2026-09-01T17:20:00Z') + i * 1000).toISOString(), lat: 39 + i * 1e-5, lon: -95 }));
          if (table === 'geo_events') return [{ ts: '2026-09-01T18:00:00.000Z', type: 'app-active' }];
          return [{ ts: '2026-09-01T17:25:00.000Z', lat: 39.5, lon: -95.5, accuracy: 7 }];
        };
        const chain = (table, sel) => {
          const c = {};
          ['eq', 'like', 'gte', 'lt', 'not', 'order'].forEach(k => { c[k] = () => c; });
          c.in = (col, vals) => { calls.push(['in', col, vals.slice()]); return c; };
          c.range = async (a, b) => { calls.push([table, sel, a, b]); return { data: rowsFor(table, sel).slice(a, b + 1), error: null }; };
          return c;
        };
        window._supa = { from: (t) => ({ select: (sel) => chain(t, sel) }), rpc: origSupa.rpc };
        try {
          const out = await _geoDeriveServerFixes(Date.parse('2026-09-01T05:00:00Z'), Date.parse('2026-09-02T05:00:00Z'));
          return { n: out.length, app: out.appEvents, first: out[0], last: out[out.length - 1], calls,
            sorted: out.slice(0, 1300).every((f, i, a) => i === 0 || f.ts >= a[i - 1].ts) };
        } finally { window._supa = origSupa; }
      });
      expect(r.n).toBe(1301);
      expect(r.app).toEqual([{ ts: Date.parse('2026-09-01T18:00:00Z'), kind: 'active' }]);
      expect(r.calls.filter(c => c[1] === 'ts,lat,lon').map(c => [c[2], c[3]])).toEqual([[0, 999], [1000, 1999]]);
      expect(r.calls.filter(c => c[0] === 'location_pings')).toHaveLength(1);
      // Only rows whose position is fresh feed the trace: never a fence or
      // motion row's stale last-known, and since 2026-09-03 never a push-ping
      // either. silentPush reports mgr().location without requesting a fix, so
      // it carries whatever the phone last resolved: 343 ft off on the owner's
      // own John Doe visit, past the 300 ft fence, which manufactured the
      // phantom exits behind "geo_replace_day: 4 overlapping pair(s)".
      // AMENDED 2026-09-04: the two clock pings joined the list. They are the
      // same kind of thing as 'fix', a live getCurrentPosition read taken at
      // the moment of the tap, which is exactly the test this filter applies.
      // A fence row, a motion row and a push-ping still never qualify.
      const ins = r.calls.filter(c => c[0] === 'in');
      expect(ins.length).toBeGreaterThan(0);
      ins.forEach(c => expect(c).toEqual(['in', 'type', ['fix', 'clock-in', 'clock-out']]));
      expect(r.sorted).toBe(true);
      expect(r.last.acc).toBe(7);
    });

    test('a complete, dense trace is the drive; the router only outranks a thin one or one that woke late', async () => {
      const r = await page.evaluate(async () => {
        window._routeDistance = async () => ({ miles: 3.9, mins: 10 });
        localStorage.removeItem('zp3_geo_routes');
        const from = { lat: 39.0123292, lng: -95.7464936 }, to = { lat: 39.0307066, lng: -95.7112082 };
        const t0 = Date.parse('2026-09-01T17:21:30Z'), t1 = Date.parse('2026-09-01T17:31:24Z');
        const line = (n, a, b) => Array.from({ length: n }, (_, i) => [a.lat + (b.lat - a.lat) * i / (n - 1), a.lng + (b.lng - a.lng) * i / (n - 1), t0 + (t1 - t0) * i / (n - 1)]);
        const row = (path, miles) => ({ id: 'x', fromCoord: from, toCoord: to, startedIso: new Date(t0).toISOString(), endedIso: new Date(t1).toISOString(), miles, gpsMiles: miles, calc_method: 'derived-path', path });
        const dense = row(line(120, from, to), 3.0);
        const thin = row(line(6, from, to), 2.4);
        const late = row(line(120, { lat: 39.0200, lng: -95.7300 }, to), 2.1);   // starts a mile in
        const noPath = { id: 'y', fromCoord: from, toCoord: to, startedIso: new Date(t0).toISOString(), endedIso: new Date(t1).toISOString(), miles: 2.3, gpsMiles: 0, calc_method: 'derived-straight', path: [] };
        await _geoDeriveRouteMiles([dense, thin, late, noPath]);
        return [dense, thin, late, noPath].map(m => [m.miles, m.calc_method, m.routeMiles]);
      });
      expect(r).toEqual([[3.0, 'derived-path', 3.9], [3.9, 'derived-routed', 3.9], [3.9, 'derived-routed', 3.9], [3.9, 'derived-routed', 3.9]]);
    });

    test('a collapsed leg\'s direct route is capped by the road actually driven through the stop', async () => {
      const r = await page.evaluate(async () => {
        window._routeDistance = async () => ({ miles: 3.9, mins: 10 });
        localStorage.removeItem('zp3_geo_routes');
        const from = { lat: 39.0123292, lng: -95.7464936 }, to = { lat: 39.0307066, lng: -95.7112082 };
        const t0 = Date.parse('2026-09-01T22:08:04Z'), t1 = Date.parse('2026-09-01T22:29:43Z');
        const stop = { lat: 39.0318, lng: -95.7254 };
        const seg = (n, a, b, s, e) => Array.from({ length: n }, (_, i) => [a.lat + (b.lat - a.lat) * i / (n - 1), a.lng + (b.lng - a.lng) * i / (n - 1), s + (e - s) * i / (n - 1)]);
        const path = seg(8, from, stop, t0, t0 + 6 * 60000).concat(seg(8, stop, to, t1 - 5 * 60000, t1));
        const via = { id: 'v', fromCoord: from, toCoord: to, startedIso: new Date(t0).toISOString(), endedIso: new Date(t1).toISOString(), miles: 2.3, gpsMiles: 0, calc_method: 'derived-straight', collapsedStops: 1, path };
        const late = Object.assign({}, via, { id: 'l', path: path.slice(3) });   // woke late: the trace starts past the origin
        await _geoDeriveRouteMiles([via, late]);
        return { via: [via.miles, via.calc_method, via.routeMiles], late: [late.miles, late.calc_method], driven: Math.round(_milePathMiles(via) * 10) / 10 };
      });
      expect(r.driven).toBeGreaterThan(2.3);
      expect(r.driven).toBeLessThan(3.9);
      expect(r.via).toEqual([r.driven, 'derived-via', 3.9]);
      expect(r.late, 'no fence-to-fence trace to cap with: the router stands').toEqual([3.9, 'derived-routed']);
    });

    // The router picks the fastest road, not the one driven: Doe to the shop
    // came back 3.9 by the highway for a drive the owner makes in 3.2 on the
    // surface streets, on a leg whose radio was off and whose trace was seven
    // points (2026-09-02, "mileage route is wrong"). Seven points still say
    // which road it was.
    test('a thin trace steers the router through its breadcrumbs; a collapsed leg stays on the direct route', async () => {
      const r = await page.evaluate(async () => {
        const calls = [];
        window._routeDistance = async (f, t, via) => { calls.push(Array.isArray(via) ? via.length : -1); return { miles: (via && via.length) ? 3.2 : 3.9, mins: 10 }; };
        localStorage.removeItem('zp3_geo_routes');
        const from = { lat: 39.0132, lng: -95.7462 }, to = { lat: 39.0308, lng: -95.7112 };
        const t0 = Date.parse('2026-09-02T17:02:27Z'), t1 = Date.parse('2026-09-02T17:12:37Z');
        const iso = t => new Date(t).toISOString();
        // The owner's actual seven points: two at the origin fence, one just
        // outside it, one mid-drive repeated with a stale position, one at
        // the shop.
        const path = [[39.01339, -95.74587, t0 + 41000], [39.01339, -95.74587, t0 + 58000], [39.01245, -95.7401, t0 + 125000],
          [39.02946, -95.72357, t0 + 425000], [39.02946, -95.72357, t0 + 471000], [39.03078, -95.71122, t1]];
        const thin = { id: 't', fromCoord: from, toCoord: to, startedIso: iso(t0), endedIso: iso(t1), miles: 2.5, gpsMiles: 2.5, calc_method: 'derived-path', path };
        const collapsed = { id: 'c', fromCoord: from, toCoord: to, startedIso: iso(t0), endedIso: iso(t1), miles: 2.3, gpsMiles: 0, calc_method: 'derived-straight', collapsedStops: 1, path };
        const bare = { id: 'b', fromCoord: from, toCoord: to, startedIso: iso(t0), endedIso: iso(t1), miles: 2.3, gpsMiles: 0, calc_method: 'derived-straight', path: [] };
        const via = _geoRouteVia(thin);
        await _geoDeriveRouteMiles([thin, collapsed, bare]);
        // A dense trace hands the router at most a handful, spread down the road.
        const many = Object.assign({}, thin, { path: Array.from({ length: 60 }, (_, i) => [from.lat + (to.lat - from.lat) * i / 59, from.lng + (to.lng - from.lng) * i / 59, t0 + (t1 - t0) * i / 59]) });
        const spread = _geoRouteVia(many);
        return { via, calls, thin: [thin.miles, thin.calc_method, thin.routeMiles], collapsed: [collapsed.miles, collapsed.calc_method], driven: Math.round(_milePathMiles(collapsed) * 10) / 10, bare: [bare.miles, bare.calc_method],
          spread: spread.length, spreadOrdered: spread.every((c, i, a) => i === 0 || c.lat > a[i - 1].lat), cache: Object.keys(JSON.parse(localStorage.getItem('zp3_geo_routes') || '{}')) };
      });
      // Only the two points clear of both fences, the stale repeat dropped.
      expect(r.via).toEqual([{ lat: 39.01245, lng: -95.7401 }, { lat: 39.02946, lng: -95.72357 }]);
      // The collapsed and the bare leg ask the same direct question: one router call, then the cache.
      expect(r.calls).toEqual([2, 0]);
      expect(r.thin).toEqual([3.2, 'derived-routed', 3.2]);
      // Rule 6: the direct route asked without waypoints (the stop is not on
      // it), then capped by the road driven since this trace spans fence to fence.
      expect(r.collapsed).toEqual([r.driven, 'derived-via']);
      expect(r.driven).toBeLessThan(3.9);
      expect(r.bare).toEqual([3.9, 'derived-routed']);
      expect(r.spread).toBe(4);
      expect(r.spreadOrdered).toBe(true);
      // The steered and the direct answers are different routes: different cache keys.
      expect(r.cache).toHaveLength(2);
      expect(r.cache.some(k => k.split('>').length === 4)).toBe(true);
    });

    test('_routeDistance carries the waypoints to every router it asks', async () => {
      const r = await page.evaluate(async () => {
        const from = { lat: 39.0132, lng: -95.7462 }, to = { lat: 39.0308, lng: -95.7112 }, via = [{ lat: 39.01245, lng: -95.7401 }, { lat: 39.02946, lng: -95.72357 }];
        _routeDistance = window.__realRoute;
        const realFetch = window.fetch, realReady = _mapkitReady, realMapkit = window.mapkit;   // _mapkitReady is a script-scoped let
        const seen = [];
        window.fetch = async (u, o) => {
          seen.push({ u: String(u), body: o && o.body ? JSON.parse(o.body) : null });
          if (/valhalla/.test(String(u))) return { json: async () => ({ trip: { summary: { length: 3.2, time: 600 } } }) };
          return { json: async () => ({ code: 'Ok', routes: [{ distance: 3.2 * 1609.344, duration: 600 }] }) };
        };
        try {
          _mapkitReady = false;
          const a = await _routeDistance(from, to, via);
          const b = await _routeDistance(from, to);
          // MapKit: one origin to one destination per request, so the
          // waypoint route is the sum of its segments.
          const legs = [];
          window.mapkit = { Coordinate: function (lat, lng) { this.lat = lat; this.lng = lng; }, Directions: function () { this.route = (req, cb) => { legs.push([req.origin.lat, req.destination.lat]); cb(null, { routes: [{ distance: 1000, expectedTravelTime: 120 }] }); }; } };
          window.mapkit.Directions.Transport = { Automobile: 'auto' };
          _mapkitReady = true;
          const c = await _routeDistance(from, to, via);
          return { a, b, c, legs, seen };
        } finally { window.fetch = realFetch; _mapkitReady = realReady; if (realMapkit) window.mapkit = realMapkit; else delete window.mapkit; }
      });
      expect(r.a).toEqual({ miles: 3.2, mins: 10 });
      const val = r.seen.filter(s => /valhalla/.test(s.u));
      expect(val[0].body.locations).toEqual([{ lon: -95.7462, lat: 39.0132 }, { lon: -95.7401, lat: 39.01245, type: 'through' }, { lon: -95.72357, lat: 39.02946, type: 'through' }, { lon: -95.7112, lat: 39.0308 }]);
      expect(val[1].body.locations).toEqual([{ lon: -95.7462, lat: 39.0132 }, { lon: -95.7112, lat: 39.0308 }]);
      const osrm = r.seen.filter(s => /osrm/.test(s.u));
      expect(osrm[0].u).toContain('/driving/-95.7462,39.0132;-95.7401,39.01245;-95.72357,39.02946;-95.7112,39.0308?');
      expect(osrm[1].u).toContain('/driving/-95.7462,39.0132;-95.7112,39.0308?');
      expect(r.legs).toEqual([[39.0132, 39.01245], [39.01245, 39.02946], [39.02946, 39.0308]]);
      expect(r.c).toEqual({ miles: 1.9, mins: 6 });
    });

    test('the legs paint the moment the day is derived; the road miles are a second paint', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [];
        localStorage.removeItem('zp3_geo_routes');
        let release; const gate = new Promise(res => { release = res; });
        window._routeDistance = async () => { await gate; return { miles: 3.2, mins: 9 }; };
        const p = _geoDeriveDayNow(DAY, null);
        await new Promise(res => setTimeout(res, 300));
        const before = mileage.filter(m => m.gps).map(m => [m.miles > 0, m.calc_method]);
        const queuedBefore = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
        release(); await p;
        const after = mileage.filter(m => m.gps).map(m => m.calc_method);
        const queuedAfter = JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length;
        return { before, queuedBefore, after, queuedAfter };
      }, DAY);
      expect(r.before).toEqual([[true, 'derived-path'], [true, 'derived-path']]);
      expect(r.queuedBefore, 'the table is written once the miles are final').toBe(0);
      expect(r.after).toEqual(['derived-routed', 'derived-routed']);
      expect(r.queuedAfter).toBe(1);
    });

    test('the phone\'s own fix log takes fresh positions only', async () => {
      const r = await page.evaluate(async () => {
        localStorage.removeItem('zp3_geo_fixlog');
        const ts = Date.now() - 60000;
        const ev = (type, i) => ({ type, ts: ts + i, lat: 39.01 + i * 1e-4, lng: -95.69, acc: 5, regionId: type === 'regionExit' ? 'shop' : undefined });
        // Live, not replayed: a replayed ping is history, and only the live
        // push-ping path feeds the log. The two side effects of a live ping
        // (a derive, an update check) are held for the test.
        const keepLive = window._geoDeriveLiveSoon, keepUpd = window._geoBgUpdateCheck;
        window._geoDeriveLiveSoon = () => {}; window._geoBgUpdateCheck = () => {};
        try {
          for (const e of [ev('regionExit', 1), ev('regionEnter', 2), ev('motion', 3), ev('visit', 4), ev('fix', 5), ev('push-ping', 6), ev('heartbeat', 7)]) {
            try { await _geoTdEvent(e, false); } catch (_e) {}
          }
          return _geoFixLogRead().filter(f => f.ts >= ts).map(f => f.ts - ts).sort((a, b) => a - b);
        } finally { window._geoDeriveLiveSoon = keepLive; window._geoBgUpdateCheck = keepUpd; }
      });
      // Fence, motion and visit rows carry a stale last-known position; a
      // heartbeat's is the 3 km keepalive fix. Only a real fix and a ping.
      expect(r).toEqual([5, 6]);
    });

    test('today\'s open dwell is published for the screens, and only today\'s', async () => {
      const r = await page.evaluate(async ([SHOP, DOE]) => {
        window.mileage = []; window._geoOpenDwell = null;
        S.bizTz = 'America/Chicago'; S.officeLat = SHOP.lat; S.officeLon = SHOP.lng; S.bname = 'JS Solutions';
        window.clients = [{ id: 1788214075432, name: 'John Doe', addr: '2950 SW McClure Rd' }];
        localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 1788214075432: { addr: '2950 SW McClure Rd', lat: DOE.lat, lon: DOE.lng } }));
        localStorage.removeItem('zp3_geo_fixlog'); localStorage.removeItem('zp3_geo_queue');
        // Anchored to today's start, not to "two hours ago": at the midnight
        // clock pin (00:20) two hours ago is yesterday (CLAUDE.md 5.2.2).
        const now = Date.now();
        const today = _geoDayKeyOf(now, 'America/Chicago');
        const t0 = Math.max(_geoDayBounds(today).start + 60000, now - 120 * 60000), t1 = t0 + 10 * 60000;
        window._geoDeriveTape = async () => [{ ts: t0 - 3600000, kind: 'onFoot' }, { ts: t0, kind: 'driving' }, { ts: t1, kind: 'onFoot' }];
        _geoFixLogPush(t0 + 5000, SHOP.lat, SHOP.lng, 5); _geoFixLogPush(t1 + 5000, DOE.lat, DOE.lng, 5); _geoFixLogPush(now - 60000, DOE.lat, DOE.lng, 5);
        for (let i = 0; i < 25; i++) _geoFixLogPush(t0 + 6000 + i * 20000, SHOP.lat + (DOE.lat - SHOP.lat) * i / 25, SHOP.lng + (DOE.lng - SHOP.lng) * i / 25, 5);
        const res = await _geoDeriveDayNow(today, null);
        const od = window._geoOpenDwell;
        // A past day never touches it.
        window._geoDeriveTape = async () => [{ ts: Date.parse('2026-08-20T14:00:00Z'), kind: 'onFoot' }, { ts: Date.parse('2026-08-20T15:00:00Z'), kind: 'driving' }, { ts: Date.parse('2026-08-20T15:20:00Z'), kind: 'onFoot' }];
        await _geoDeriveDayNow('2026-08-20', null);
        const still = window._geoOpenDwell;
        // Today with nobody on site clears it. The flip alone is not enough
        // any more (owner rule 2026-09-03: the visit stays open until
        // CoreMotion says automotive AND the fixes actually leave the fence),
        // so the truck has to be seen pulling away, not just declared to.
        const tDep = Math.max(t1 + 60000, now - 30 * 60000);   // after the arrival, whatever the hour
        window._geoDeriveTape = async () => [{ ts: t0 - 3600000, kind: 'onFoot' }, { ts: t0, kind: 'driving' }, { ts: t1, kind: 'onFoot' }, { ts: tDep, kind: 'driving' }];
        _geoFixLogPush(tDep + 120000, DOE.lat + 0.02, DOE.lng, 5);
        _geoFixLogPush(tDep + 240000, DOE.lat + 0.04, DOE.lng, 5);
        await _geoDeriveDayNow(today, null);
        return { open: !!(res && res.open), od: od && { name: od.name, kind: od.kind, since: od.sinceTs, cid: od.fence && od.fence.clientId }, t1, still: still && still.name, after: window._geoOpenDwell };
      }, [SHOP, DOE]);
      expect(r.open).toBe(true);
      expect(r.od).toEqual({ name: 'John Doe', kind: 'client', since: r.t1, cid: 1788214075432 });
      expect(r.still).toBe('John Doe');
      expect(r.after).toBeNull();
    });

    // Regression (owner 2026-09-03: on site since 8:01a, nothing on the
    // island). The Live Activity used to be requested only when the dwell
    // CHANGED, so the one attempt at the arrival instant was all there was:
    // a bridge that wasn't ready yet left the island empty for the whole
    // dwell with nothing to retry it. Every publish must re-assert it.
    test('an unchanged open dwell still re-asserts the on-site Live Activity', async () => {
      const r = await page.evaluate(async () => {
        const keep = window._liveActOnSite;
        const seen = [];
        window._liveActOnSite = (d) => { seen.push(d ? String(d.name || '') : null); return true; };
        try {
          const since = Date.now() - 20 * 60000;
          const mk = () => ({ open: { id: 'd-same', name: 'John Doe', kind: 'client', sinceTs: since, journeyId: 'j1',
            fence: { id: 'f1', kind: 'client', name: 'John Doe', jobId: null, clientId: 7, addr: '2950 SW McClure Rd' } } });
          const today = _geoDayKeyOf(Date.now(), _geoBizTz());
          window._geoOpenDwell = null;
          _geoOpenDwellPublish(today, mk());          // arrival: the first assert
          const first = seen.length;
          _geoOpenDwellPublish(today, mk());          // identical dwell: must assert again
          _geoOpenDwellPublish(today, mk());
          return { first, total: seen.length, names: seen };
        } finally { window._liveActOnSite = keep; }
      });
      expect(r.first).toBe(1);
      expect(r.total).toBe(3);
      expect(r.names).toEqual(['John Doe', 'John Doe', 'John Doe']);
    });

    test('a router that never answers cannot stall the derive', async () => {
      const r = await page.evaluate(async () => {
        const keep = _GEO_ROUTE_TIMEOUT_MS; _GEO_ROUTE_TIMEOUT_MS = 150;
        localStorage.removeItem('zp3_geo_routes');
        window._routeDistance = () => new Promise(() => {});
        const from = { lat: 39.0123292, lng: -95.7464936 }, to = { lat: 39.0307066, lng: -95.7112082 };
        const m = { id: 'x', fromCoord: from, toCoord: to, startedIso: '2026-09-01T17:21:30Z', endedIso: '2026-09-01T17:31:24Z', miles: 2.4, gpsMiles: 2.4, calc_method: 'derived-path', path: [] };
        const t = Date.now();
        try { await _geoDeriveRouteMiles([m]); return { ms: Date.now() - t, miles: m.miles, cm: m.calc_method, rm: m.routeMiles }; }
        finally { _GEO_ROUTE_TIMEOUT_MS = keep; }
      });
      expect(r.ms).toBeLessThan(2000);
      expect([r.miles, r.cm, r.rm]).toEqual([2.4, 'derived-path', undefined]);
    });

    test('a day is locked: the boot rebuild covers two days, and reaches back a week only when the rules changed', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const days = [];
        const origNow = window._geoDeriveDayNow, real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        window._geoDeriveDayNow = async (d) => { days.push(d); return { dwells: [], legs: [] }; };
        window._geoDeriveServerFixes = async () => { const o = []; o.appEvents = []; return o; };
        try {
          // RESTATED 2026-09-10 (CLAUDE.md 10.4). This used to set the
          // device-wide key, which was right when one marker served the whole
          // handset. It is per-uid now, because on a shared phone the first
          // account to boot a new build was spending the other's seven-day
          // rebuild: the owner's 6 September row was stranded exactly that
          // way. The device-wide key still exists and still means "this
          // handset has derived before" for _geoTapeClaim.
          localStorage.setItem(_geoDeriveVerSeenKey(), APP_VERSION);
          await _geoDeriveRebuild();
          const same = days.length; days.length = 0;
          localStorage.setItem(_geoDeriveVerSeenKey(), '00.00.00.0');
          await _geoDeriveRebuild();
          const changed = days.length;
          const stamped = localStorage.getItem(_geoDeriveVerSeenKey());
          const stampedDevice = localStorage.getItem('zp3_geo_derive_ver');
          // Coming back after half an hour runs it again; sooner does not.
          window._geoDeriveRebuilt = true; _geoDeriveRebuildT = null;
          _geoDeriveRebuiltAt = Date.now();
          const soon = _geoDeriveRebuildIfStale();
          days.length = 0; _geoDeriveRebuiltAt = Date.now() - 31 * 60000;
          const later = _geoDeriveRebuildIfStale();
          await new Promise(res => setTimeout(res, 50));
          return { same, changed, stamped, stampedDevice, soon, later, ran: days.length };
        } finally { window._geoDeriveDayNow = origNow; window._geoDeriveServerFixes = real; }
      });
      expect(r.same).toBe(2);
      expect(r.changed).toBe(7);
      expect(r.stamped).toBe(await page.evaluate(() => APP_VERSION));
      expect(r.stampedDevice, 'the device-wide marker is still written, for _geoTapeClaim').toBe(await page.evaluate(() => APP_VERSION));
      expect(r.soon).toBe(false);
      expect(r.later).toBe(true);
      expect(r.ran).toBe(2);
    });

    // CI, WebKit, 2026-09-02: the test above counted four days for two
    // rebuilds. A stale check that lands while a rebuild is still running
    // started another on top of it, because the finished stamp is written
    // at the END. One rebuild at a time; the second caller gets the first.
    test('a rebuild already running is handed back, never doubled', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const days = [];
        const origNow = window._geoDeriveDayNow, real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        window._geoDeriveDayNow = async (d) => { days.push(d); await new Promise(res => setTimeout(res, 30)); return { dwells: [], legs: [] }; };
        window._geoDeriveServerFixes = async () => { const o = []; o.appEvents = []; return o; };
        try {
          localStorage.setItem(_geoDeriveVerSeenKey(), APP_VERSION);   // per-uid now, see 10.4 note above
          window._geoDeriveRebuilt = true; _geoDeriveRebuildT = null;
          _geoDeriveRebuiltAt = Date.now() - 31 * 60000;
          const p1 = _geoDeriveRebuild();
          const stale = _geoDeriveRebuildIfStale();          // lands mid-rebuild
          const p2 = _geoDeriveRebuild();
          const shared = p1 === p2;
          await Promise.all([p1, p2]);
          const once = days.length;
          // Finished: the next call is a fresh rebuild again.
          await _geoDeriveRebuild();
          return { stale, shared, once, twice: days.length };
        } finally { window._geoDeriveDayNow = origNow; window._geoDeriveServerFixes = real; }
      });
      expect(r.stale).toBe(true);
      expect(r.shared).toBe(true);
      expect(r.once).toBe(2);
      expect(r.twice).toBe(4);
    });

    test('the dashboard card shows the open dwell with an arrival stamp and a figure that ticks', async () => {
      const r = await page.evaluate(async () => {
        const since = Date.now() - 95 * 60000;
        window._activeTimer = null;
        const keepDrv = window._geoDriving; window._geoDriving = () => false;
        window._geoOpenDwell = { id: 'd-x', name: 'John Doe', kind: 'client', sinceTs: since, sinceIso: new Date(since).toISOString(), journeyId: 'x',
          fence: { id: 'client-1788214075432', kind: 'client', name: 'John Doe', clientId: 1788214075432, addr: '2950 SW McClure Rd' } };
        try {
          goPg && goPg('pg-dash');
          renderDash();
          await new Promise(res => setTimeout(res, 400));
          const el = document.getElementById('dash-nearby');
          const html = el ? el.innerHTML : '';
          const node = el && el.querySelector('[data-onsite-since]');
          const first = node && node.textContent;
          node && node.setAttribute('data-onsite-since', String(Date.now() - 3660000));
          _geoOnsiteTick();
          const ticked = node && node.textContent;
          window._geoOpenDwell = null;
          renderDash();
          await new Promise(res => setTimeout(res, 400));
          const gone = !document.querySelector('#dash-nearby [data-onsite-since]');
          return { has: /John Doe/.test(html) && /Arrived/.test(html), clockIn: /clockIn\(/.test(html), proposal: /_nearbyStartWork\(1788214075432\)/.test(html), first, ticked, gone };
        } finally { window._geoDriving = keepDrv; }
      });
      expect(r.has).toBe(true);
      // Was clockIn===true. The auto-detected dwell card no longer offers a
      // manual clock (owner 2026-09-03): the deriver already owns this dwell
      // and writes its time row, so a manual clock on top of it is a second
      // observer of one physical event (CLAUDE.md 17). The arrival stamp and
      // the ticking figure below ARE the clock.
      expect(r.clockIn).toBe(false);
      expect(r.proposal).toBe(true);
      expect(r.first).toBe('1h 35m');
      expect(r.ticked).toBe('1h 1m');
      expect(r.gone).toBe(true);
    });

    test('a live fence crossing and a return to the foreground re-derive the day; a replay does not', async () => {
      const r = await page.evaluate(async () => {
        const out = [];
        const fire = async (ev, replay) => { clearTimeout(_geoDeriveLiveT); _geoDeriveLiveT = null; try { await _geoTdEvent(ev, replay); } catch (_e) {} out.push(!!_geoDeriveLiveT); clearTimeout(_geoDeriveLiveT); _geoDeriveLiveT = null; };
        const keepRebuild = window._geoDeriveRebuildIfStale, keepTape = window._geoTapeDriveCheck;
        window._geoDeriveRebuildIfStale = () => false; window._geoTapeDriveCheck = async () => false;
        try {
          await fire({ type: 'regionExit', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 12, regionId: 'client-1' }, false);
          await fire({ type: 'regionEnter', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 12, regionId: 'client-1' }, false);
          await fire({ type: 'app-active', ts: Date.now() }, false);
          await fire({ type: 'regionExit', ts: Date.now(), lat: 39.1, lng: -94.1, acc: 12, regionId: 'client-1' }, true);
          await fire({ type: 'regionExit', ts: Date.now() - 3600000, lat: 39.1, lng: -94.1, acc: 12, regionId: 'client-1' }, false);
        } finally { window._geoDeriveRebuildIfStale = keepRebuild; window._geoTapeDriveCheck = keepTape; }
        return out;
      });
      expect(r).toEqual([true, true, true, false, false]);
    });

    test('the boot rebuild seeds the local logs from the server before it derives', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        localStorage.removeItem('zp3_geo_fixlog'); localStorage.removeItem('zp3_geo_applog');
        const real = window.__realServerFixes = window.__realServerFixes || _geoDeriveServerFixes;
        const origNow = window._geoDeriveDayNow;
        const now = Date.now();
        let logAtDerive = -1;
        window._geoDeriveDayNow = async () => { logAtDerive = _geoFixLogRead().length; return { dwells: [], legs: [] }; };
        window._geoDeriveServerFixes = async () => { const o = [{ ts: now - 3600000, lat: 39.01, lng: -95.69, acc: 4 }, { ts: now - 1800000, lat: 39.02, lng: -95.70, acc: 4 }]; o.appEvents = [{ ts: now - 3000000, kind: 'active' }]; return o; };
        try { await _geoDeriveRebuild(); return { logAtDerive, log: _geoFixLogRead().length, app: _geoAppLogRead().map(e => e.kind) }; }
        finally { window._geoDeriveDayNow = origNow; window._geoDeriveServerFixes = real; }
      });
      expect(r.logAtDerive, 'seeded before the first day is derived').toBe(2);
      expect(r.log).toBe(2);
      expect(r.app).toEqual(['active']);
    });

    test('the boot rebuild walks the tape\'s window and derives each covered day once', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        window.mileage = [];
        const days = [];
        const orig = window._geoDeriveDayNow;
        window._geoDeriveDayNow = async (d) => { days.push(d); return { dwells: [], legs: [] }; };
        window._geoDeriveServerFixes = async () => [];
        // A rule change (no stamp for this version) is what reaches back the
        // full week; a locked week derives two days (the test above). The
        // stamp is per-uid now, see the 10.4 note on the first of these.
        localStorage.removeItem(_geoDeriveVerSeenKey());
        localStorage.removeItem('zp3_geo_derive_ver');
        try { const n = await _geoDeriveRebuild(); return { n, days }; }
        finally { window._geoDeriveDayNow = orig; }
      });
      expect(r.n).toBe(7);
      expect(r.days).toHaveLength(7);
      expect(new Set(r.days).size).toBe(7);
      expect(r.days[6]).toBe(await page.evaluate(() => _geoDayKeyOf(Date.now(), 'America/Chicago')));
    });

    test('_geoDeriveRebuildSoon runs once per boot', async () => {
      const r = await page.evaluate(() => {
        window._geoDeriveRebuilt = false;
        _geoDeriveRebuildSoon(); _geoDeriveRebuildSoon();
        const armed = !!_geoDeriveRebuildT;
        clearTimeout(_geoDeriveRebuildT); _geoDeriveRebuildT = null;
        window._geoDeriveRebuilt = true;
        _geoDeriveRebuildSoon();
        return { armed, again: !!_geoDeriveRebuildT };
      });
      expect(r.armed).toBe(true);
      expect(r.again).toBe(false);
    });
  });

  // ── The open dwell survives a reload ──────────────────────────────────────
  // Owner 2026-09-05: the on-site card's Arrived stamp and its counting timer
  // were lost on a reboot, a UAT roll or a force close. The card draws off
  // window._geoOpenDwell, which only the deriver wrote, so a reload came back
  // with nothing until the boot rebuild finished.
  test.describe('the open dwell survives a reload', () => {
    const seed = (over) => page.evaluate(({ over }) => {
      localStorage.removeItem('zp3_geo_dwell');
      window._geoOpenDwell = null;
      const now = Date.now();
      const d = Object.assign({ id: 'd1', name: 'John Doe', kind: 'client', sinceTs: now - 3600000,
                                atHome: false, sinceIso: new Date(now - 3600000).toISOString(),
                                journeyId: 'j1', fence: null }, (over && over.d) || {});
      localStorage.setItem('zp3_geo_dwell', JSON.stringify(Object.assign({
        d, at: now, uid: (window._supaUser && window._supaUser.id) || null, day: todayKey(),
      }, (over && over.wrap) || {})));
      window._geoOpenDwell = null;
      const ok = _geoRestoreDwell();
      return { ok, name: window._geoOpenDwell && window._geoOpenDwell.name,
               since: window._geoOpenDwell && window._geoOpenDwell.sinceTs };
    }, { over });

    test('publishing writes it down, and a fresh boot reads it back', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('zp3_geo_dwell');
        const now = Date.now();
        _geoOpenDwellPublish(todayKey(), { open: { id: 'd9', name: 'John Doe', kind: 'client',
          sinceTs: now - 1800000, journeyId: 'j9' }, dwells: [], legs: [], journeys: [] });
        const wrote = JSON.parse(localStorage.getItem('zp3_geo_dwell') || 'null');
        window._geoOpenDwell = null;              // the reload
        const ok = _geoRestoreDwell();
        return { wrote: !!(wrote && wrote.d && wrote.d.id === 'd9'),
                 ok, back: window._geoOpenDwell && window._geoOpenDwell.id,
                 since: window._geoOpenDwell && window._geoOpenDwell.sinceTs };
      });
      expect(r.wrote, 'the publish persists the dwell').toBe(true);
      expect(r.ok).toBe(true);
      expect(r.back, 'the same dwell comes back after the reload').toBe('d9');
      expect(r.since, 'and its arrival instant is intact, so the timer counts from the right moment')
        .toBeGreaterThan(0);
    });

    test('a publish with nothing open clears it, so a card cannot resurrect', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({ d: { id: 'x', sinceTs: Date.now() },
          at: Date.now(), uid: (window._supaUser && window._supaUser.id) || null, day: todayKey() }));
        _geoOpenDwellPublish(todayKey(), { open: null, dwells: [], legs: [], journeys: [] });
        const raw = localStorage.getItem('zp3_geo_dwell');
        window._geoOpenDwell = null;
        return { raw, ok: _geoRestoreDwell(), after: window._geoOpenDwell };
      });
      expect(r.raw, 'nothing open means nothing stored').toBe(null);
      expect(r.ok).toBe(false);
      expect(r.after).toBe(null);
    });

    test('live state always wins: a restore never clobbers a running dwell', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({ d: { id: 'stale', name: 'Old', sinceTs: Date.now() - 60000 },
          at: Date.now(), uid: (window._supaUser && window._supaUser.id) || null, day: todayKey() }));
        window._geoOpenDwell = { id: 'live', name: 'Now', sinceTs: Date.now() };
        const ok = _geoRestoreDwell();
        const out = { ok, id: window._geoOpenDwell.id };
        window._geoOpenDwell = null;
        return out;
      });
      expect(r.ok).toBe(false);
      expect(r.id).toBe('live');
    });

    test("another login's dwell is not mine", async () => {
      const r = await seed({ wrap: { uid: 'somebody-else' } });
      expect(r.ok).toBe(false);
    });

    test('yesterday is not today', async () => {
      const r = await seed({ wrap: { day: '2020-01-01' } });
      expect(r.ok, 'a dwell from another day never paints today\'s card').toBe(false);
    });

    test('a phone that has been dead for an hour is a guess, not a fact', async () => {
      // The age is computed INSIDE the page: the page clock is pinned and the
      // runner's is not, so an absolute stamp built on this side would be off
      // by the pin's offset (CLAUDE.md 5.2.2).
      const r = await page.evaluate(() => {
        const now = Date.now();
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({
          d: { id: 'old', name: 'John Doe', kind: 'client', sinceTs: now - 3600000 },
          at: now - 60 * 60000, uid: (window._supaUser && window._supaUser.id) || null, day: todayKey() }));
        window._geoOpenDwell = null;
        const ok = _geoRestoreDwell();
        const out = { ok, after: window._geoOpenDwell };
        window._geoOpenDwell = null;
        localStorage.removeItem('zp3_geo_dwell');
        return out;
      });
      expect(r.ok, 'freshness is judged on the last confirmation, not on the arrival').toBe(false);
      expect(r.after).toBe(null);
    });

    test('a dwell confirmed a minute ago comes back even if it started this morning', async () => {
      const r = await page.evaluate(() => {
        const now = Date.now();
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({
          d: { id: 'am', name: 'John Doe', kind: 'client', sinceTs: now - 8 * 3600000 },
          at: now - 60000, uid: (window._supaUser && window._supaUser.id) || null, day: todayKey() }));
        window._geoOpenDwell = null;
        const ok = _geoRestoreDwell();
        const out = { ok, since: window._geoOpenDwell && window._geoOpenDwell.sinceTs, now };
        window._geoOpenDwell = null;
        return out;
      });
      expect(r.ok, 'an all-day visit is not stale just because it is long').toBe(true);
      expect(r.now - r.since).toBeGreaterThan(7 * 3600000);
    });

    test('junk in storage never throws and never paints', async () => {
      const r = await page.evaluate(() => {
        const cases = ['{BROKEN{{', 'null', '[]', '{"d":null}', '{"d":{"sinceTs":0}}', '{"d":{}}'];
        const out = [];
        for (const c of cases) {
          localStorage.setItem('zp3_geo_dwell', c);
          window._geoOpenDwell = null;
          let threw = false;
          try { out.push(_geoRestoreDwell()); } catch (e) { threw = true; out.push('THREW'); }
          if (threw) break;
        }
        localStorage.removeItem('zp3_geo_dwell');
        window._geoOpenDwell = null;
        return out;
      });
      expect(r.every(x => x === false), 'every junk shape declines quietly').toBe(true);
    });

    test('_geoRestoreOpen brings the dwell back too, on a day with no open entry', async () => {
      const r = await page.evaluate(() => {
        const now = Date.now();
        localStorage.removeItem('zp3_geo_open');       // the fence machine has nothing open
        localStorage.setItem('zp3_geo_dwell', JSON.stringify({
          d: { id: 'boot', name: 'John Doe', kind: 'client', sinceTs: now - 900000 },
          at: now, uid: (window._supaUser && window._supaUser.id) || null, day: todayKey() }));
        window._geoOpenDwell = null;
        window._geoOpenRestored = false;               // one-shot guard, re-armed for this test
        _geoRestoreOpen();
        const out = { id: window._geoOpenDwell && window._geoOpenDwell.id };
        window._geoOpenDwell = null;
        localStorage.removeItem('zp3_geo_dwell');
        return out;
      });
      expect(r.id, 'the boot restore is where the card gets its state back').toBe('boot');
    });
  });

  // ── The 30-minute ping takes a real fix, during work ──────────────────────
  // Owner 2026-09-05, on the live crew map: the ping used to carry only a
  // cached position the deriver refuses to trust. It now buys one burst,
  // and only while there is work to see.
  test.describe('the 30-minute ping buys a real fix', () => {
    // The plugin and the drive-window clock are module-level bindings, not
    // window properties: assigned bare, the way every other geo spec does it.
    const setup = (over) => page.evaluate(({ over }) => {
      const saved = { hours: S.workHours, td: _geoTdPlugin, win: _geoDriveWinAt };
      S.workHours = { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] };
      window._geoOpenDwell = null;
      _geoDriveWinAt = 0;
      _geoPingBurstAt = 0;
      window.__bursts = [];
      _geoTdPlugin = () => ({ burstFix: async (a) => { window.__bursts.push(a); return a; } });
      if (over && over.hours) S.workHours = over.hours;
      if (over && over.dwell) window._geoOpenDwell = over.dwell;
      if (over && over.driving) _geoDriveWinAt = Date.now();
      const why = _geoPingBurstOk();
      const fired = _geoPingBurst();
      const out = { why, fired, n: window.__bursts.length, secs: window.__bursts[0] && window.__bursts[0].seconds };
      S.workHours = saved.hours; _geoTdPlugin = saved.td; _geoDriveWinAt = saved.win;
      window._geoOpenDwell = null;
      return out;
    }, { over });

    test('inside work hours, away from home, it fires one 12 second burst', async () => {
      const r = await setup({});
      expect(r.why, 'nothing stands in the way').toBe('');
      expect(r.fired).toBe(true);
      expect(r.n).toBe(1);
      expect(r.secs).toBe(12);
    });

    test('at home it does not fire, whatever the hour', async () => {
      const r = await setup({ dwell: { id: 'h', sinceTs: Date.now(), atHome: true } });
      expect(r.why).toBe('home');
      expect(r.n, 'a phone in the driveway is not a crew map').toBe(0);
    });

    test('outside work hours it does not fire', async () => {
      const r = await setup({ hours: { start: '06:00', end: '06:01', days: [0, 1, 2, 3, 4, 5, 6] } });
      expect(['off-hours', 'off-day']).toContain(r.why);
      expect(r.n).toBe(0);
    });

    test('on a day nobody works it does not fire', async () => {
      const r = await page.evaluate(() => {
        const prev = S.workHours;
        const dow = new Date().getDay();
        S.workHours = { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6].filter(d => d !== dow) };
        window._geoOpenDwell = null; _geoDriveWinAt = 0;
        const why = _geoPingBurstOk();
        S.workHours = prev;
        return why;
      });
      expect(r).toBe('off-day');
    });

    test('an open drive window outranks it: the window is already better', async () => {
      const r = await setup({ driving: true });
      expect(r.why).toBe('drive');
      expect(r.n).toBe(0);
    });

    test('two pings inside ten minutes buy one burst, not two', async () => {
      const r = await page.evaluate(() => {
        const saved = { hours: S.workHours, td: _geoTdPlugin, win: _geoDriveWinAt };
        S.workHours = { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] };
        window._geoOpenDwell = null; _geoDriveWinAt = 0; _geoPingBurstAt = 0;
        window.__bursts = [];
        _geoTdPlugin = () => ({ burstFix: async (a) => { window.__bursts.push(a); return a; } });
        const a = _geoPingBurst(), b = _geoPingBurst(), c = _geoPingBurst();
        S.workHours = saved.hours; _geoTdPlugin = saved.td; _geoDriveWinAt = saved.win;
        return { a, b, c, n: window.__bursts.length };
      });
      expect(r.a).toBe(true);
      expect(r.b).toBe(false);
      expect(r.c).toBe(false);
      expect(r.n).toBe(1);
    });

    test('the push-ping itself still claims no position', async () => {
      // The whole reason the ping went blind. The burst is a SEPARATE fix
      // event; nothing here re-trusts the ping's own cached coordinates.
      const r = await page.evaluate(() => _GEO_FRESH_FIX_TYPES.slice());
      expect(r).not.toContain('push-ping');
      expect(r).toContain('fix');
    });

    test('no plugin, no throw', async () => {
      const r = await page.evaluate(() => {
        const saved = { hours: S.workHours, td: _geoTdPlugin, win: _geoDriveWinAt };
        S.workHours = { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] };
        window._geoOpenDwell = null; _geoDriveWinAt = 0; _geoPingBurstAt = 0;
        _geoTdPlugin = () => null;
        let threw = false, out = null;
        try { out = _geoPingBurst(); } catch (e) { threw = true; }
        _geoTdPlugin = saved.td; S.workHours = saved.hours; _geoDriveWinAt = saved.win;
        return { threw, out };
      });
      expect(r.threw).toBe(false);
      expect(r.out).toBe(false);
    });
  });

  // ── A blind ping buys its own fix (Jack, 2026-09-08) ──────────────────────
  // Thirty pings from Sunday noon to Monday 7:34am with no coordinate, and
  // the morning drive never had a start. A ping that does not know where it
  // is asks, home or not, hour or not.
  test.describe('a blind ping buys its own fix', () => {
    const blind = (over) => page.evaluate(({ over }) => {
      const saved = { hours: S.workHours, td: _geoTdPlugin, win: _geoDriveWinAt, note: _geoParkNote };
      // The gates that stop a NORMAL burst, all closed at once.
      S.workHours = { start: '06:00', end: '06:01', days: [0, 1, 2, 3, 4, 5, 6] };
      window._geoOpenDwell = { id: 'h', sinceTs: Date.now(), atHome: true };
      _geoDriveWinAt = over && over.driving ? Date.now() : 0;
      _geoPingBurstAt = over && over.recent ? Date.now() : 0;
      const notes = [];
      _geoParkNote = (ev, x) => notes.push([ev, String(x)]);
      window.__bursts = [];
      _geoTdPlugin = over && over.noPlugin ? (() => null) : (() => ({ burstFix: async (a) => { window.__bursts.push(a); return a; } }));
      let out;
      try { out = { fired: _geoPingBlindBurst(), bursts: window.__bursts.slice(), notes, normal: _geoPingBurstOk() }; }
      finally { S.workHours = saved.hours; _geoTdPlugin = saved.td; _geoDriveWinAt = saved.win; _geoParkNote = saved.note; window._geoOpenDwell = null; }
      return out;
    }, { over });

    test('at home, off hours, it still fires: four seconds, and says why', async () => {
      const r = await blind({});
      expect(r.normal, 'the normal burst would have been refused here').not.toBe('');
      expect(r.fired).toBe(true);
      expect(r.bursts).toEqual([{ seconds: 4, reason: 'push-ping had no fix' }]);
      expect(r.notes).toEqual([['ping-blind-burst', '4s']]);
    });

    test('an open drive window still outranks it', async () => {
      const r = await blind({ driving: true });
      expect(r.fired).toBe(false);
      expect(r.bursts).toEqual([]);
      expect(r.notes).toEqual([['ping-blind-skip', 'drive']]);
    });

    test('the ten-minute gap is shared with the normal burst', async () => {
      const r = await blind({ recent: true });
      expect(r.fired).toBe(false);
      expect(r.notes).toEqual([['ping-blind-skip', 'gap']]);
    });

    test('no plugin, no throw', async () => {
      const r = await blind({ noPlugin: true });
      expect(r.fired).toBe(false);
    });

    test('the push-ping handler routes on the blind flag, and on a missing fix for an older shell', async () => {
      const r = await page.evaluate(async () => {
        const saved = { blind: _geoPingBlindBurst, normal: _geoPingBurst, note: _geoParkNote, rearm: _geoWakeRearm,
          radio: _geoRadioCheck, upd: _geoBgUpdateCheck, derive: _geoDeriveLiveSoon, confirm: _geoDriveConfirm, fix: _geoFixLogPush };
        const calls = [];
        _geoPingBlindBurst = () => { calls.push('blind'); return true; };
        _geoPingBurst = () => { calls.push('normal'); return true; };
        _geoParkNote = () => {}; _geoWakeRearm = async () => false; _geoRadioCheck = async () => null; _geoBgUpdateCheck = () => {};
        _geoDeriveLiveSoon = () => {}; _geoDriveConfirm = () => ''; _geoFixLogPush = () => {};
        try {
          // An older shell: no blind field, no coordinate.
          await _geoTdEvent({ type: 'push-ping', ts: Date.now() });
          // A ping that knows where it is: the gates apply as before.
          await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.02, lng: -95.79, acc: 9 });
          // A STALE cache: it carries a position AND the blind flag, and the
          // flag wins (owner 2026-09-09).
          await _geoTdEvent({ type: 'push-ping', ts: Date.now(), lat: 39.02, lng: -95.79, acc: 9, blind: true, staleMs: 900000 });
          // Replayed: describes a ping that already happened.
          await _geoTdEvent({ type: 'push-ping', ts: Date.now(), blind: true }, true);
          return calls;
        } finally {
          _geoPingBlindBurst = saved.blind; _geoPingBurst = saved.normal; _geoParkNote = saved.note; _geoWakeRearm = saved.rearm;
          _geoRadioCheck = saved.radio; _geoBgUpdateCheck = saved.upd; _geoDeriveLiveSoon = saved.derive; _geoDriveConfirm = saved.confirm; _geoFixLogPush = saved.fix;
        }
      });
      expect(r).toEqual(['blind', 'normal', 'blind']);
    });

    // THE SOURCE PIN LIVES HERE, NOT IN SWIFT (2026-09-09, red once). An
    // XCTest that read the plugin's own source through #filePath could never
    // work: scripts/ios-add-native-tests.rb copies the test file into a
    // generated Xcode project, so its path at runtime is
    // native/ios/App/TdNativeTests/, and no string replacement finds the
    // plugin from there. Node reads the repo at a stable path; XCTest gets
    // the behaviour tests.
    test('the plugin does the same for itself when JS is not there to ask', () => {
      const fs = require('fs'), path = require('path');
      const s = fs.readFileSync(path.join(__dirname, '..', 'native', 'td-geo', 'ios', 'Plugin', 'TdGeoPlugin.swift'), 'utf8');
      const push = s.indexOf('@objc private func silentPush(');
      const body = s.slice(push, push + 4000);
      expect(body.includes('ev["blind"] = true')).toBe(true);
      expect(body.includes('beginBurst(seconds: TdGeoPlugin.blindPingBurstSec,')).toBe(true);
      // Empty and stale take the same branch, and the ledger names which.
      expect(body.includes('if cached == nil || ageMs > TdGeoPlugin.blindPingStaleMs {')).toBe(true);
      // A stale ping still carries where the phone WAS, marked with its age,
      // for the crew map's last-known dot.
      expect(body.includes('if ageMs > TdGeoPlugin.blindPingStaleMs { ev["staleMs"] = ageMs }')).toBe(true);
      expect(body.includes('reason: cached == nil ? "push-ping had no fix" : "push-ping fix was stale"')).toBe(true);
      expect(s.includes('private static let blindPingBurstSec: Double = 4')).toBe(true);
      expect(s.includes('private static let blindPingStaleMs: Double = 5 * 60_000')).toBe(true);
      const t = fs.readFileSync(path.join(__dirname, '..', 'native', 'tests', 'TdGeoPluginTests.swift'), 'utf8');
      expect(t.includes('testSilentPush_withNoCachedPositionSaysBlindAndBuysAShortBurst')).toBe(true);
      expect(t.includes('testBeginBurst_secondCallInsideARunningBurstOpensNoSecondSession')).toBe(true);
      expect(t.includes('testBlindPingStaleWindow_isMinutesAndMatchesTheDeriversIdeaOfCurrent')).toBe(true);
    });
  });

  // ── The ping carries what the map needs ───────────────────────────────────
  // Owner 2026-09-05: "like Life360 but better." A ping used to be a position
  // and nothing else, so the map could only draw a dot with an age on it.
  test.describe('the ping says more than where', () => {
    const withState = (setup) => page.evaluate(({ setup }) => {
      const saved = { job: _geoCurrentJob, shop: _geoWasInShop, place: _geoCurrentPlace,
                      mph: _geoDriveMph, started: _geoDriveStartedAt, moving: _geoDriveMovingAt,
                      origin: _geoLegOrigin, dwell: window._geoOpenDwell, batt: _geoBattPeek,
                      win: _geoDriveWinAt };
      _geoCurrentJob = null; _geoWasInShop = false; _geoCurrentPlace = null;
      _geoDriveMph = 0; _geoDriveStartedAt = null; _geoDriveMovingAt = 0; _geoLegOrigin = null;
      _geoDriveWinAt = 0;
      window._geoOpenDwell = null;
      if (setup.job) _geoCurrentJob = setup.job;
      if (setup.shop) _geoWasInShop = true;
      if (setup.place) _geoCurrentPlace = setup.place;
      if (setup.dwell) window._geoOpenDwell = setup.dwell;
      if (setup.origin) _geoLegOrigin = setup.origin;
      // The drive WINDOW is what the event-driven engine actually raises; the
      // watcher-based _geoDriving() stays false because the new engine keeps
      // the watcher off between drives. Both paths are covered below.
      if (setup.driving) { _geoDriveWinAt = Date.now(); _geoDriveMph = setup.mph || 0; }
      if (setup.batt !== undefined) _geoBattPeek = () => (setup.batt === null ? null : { level: setup.batt, charging: false });

      let sent = null;
      const savedSupa = window._supa, savedUser = window._supaUser;
      window._supaUser = { id: 'emp-uid' };
      window._supa = { from: () => ({ insert: (row) => { sent = row; return { then: (a) => { a(); return { catch: () => {} }; } }; } }) };
      const state = _geoPingState();
      const dest = _geoPingDest(state);
      _geoWritePing({ lat: 41.5, lng: -88.1 }, 12);
      window._supa = savedSupa; window._supaUser = savedUser;

      _geoCurrentJob = saved.job; _geoWasInShop = saved.shop; _geoCurrentPlace = saved.place;
      _geoDriveMph = saved.mph; _geoDriveStartedAt = saved.started; _geoDriveMovingAt = saved.moving;
      _geoLegOrigin = saved.origin; window._geoOpenDwell = saved.dwell; _geoBattPeek = saved.batt;
      _geoDriveWinAt = saved.win;
      return { state, dest, sent };
    }, { setup });

    test('standing on a job writes state site and names it', async () => {
      const r = await withState({ job: 9001, dwell: { id: 'd', kind: 'client', name: 'Kitchen repaint, Alvarez', sinceTs: Date.now(), journeyId: 'j7' } });
      expect(r.state).toBe('site');
      expect(r.dest).toBe('Kitchen repaint, Alvarez');
      expect(r.sent.state).toBe('site');
      expect(r.sent.journey_id).toBe('j7');
      expect(r.sent.job_id).toBe('9001');
    });

    test('driving beats every fence, and carries the speed', async () => {
      const r = await withState({ driving: true, mph: 42.4, job: 9001, origin: { name: 'TradeDesk shop' } });
      expect(r.state, 'a truck on the road is not standing at the job it just left').toBe('drive');
      expect(r.sent.speed_mph, 'rounded, not a float on a pin').toBe(42);
      expect(r.dest).toBe('from TradeDesk shop');
    });

    test('the watcher-based drive banner counts too, not just the window', async () => {
      const r = await page.evaluate(() => {
        const saved = { w: _geoWatchId, s: _geoDriveStartedAt, m: _geoDriveMovingAt, win: _geoDriveWinAt, job: _geoCurrentJob };
        _geoDriveWinAt = 0; _geoCurrentJob = 9001;
        _geoWatchId = 99; _geoDriveStartedAt = new Date().toISOString(); _geoDriveMovingAt = Date.now();
        const state = _geoPingState();
        _geoWatchId = saved.w; _geoDriveStartedAt = saved.s; _geoDriveMovingAt = saved.m;
        _geoDriveWinAt = saved.win; _geoCurrentJob = saved.job;
        return state;
      });
      expect(r, 'the old engine says driving through the watcher').toBe('drive');
    });

    test('speed is written only on a drive: a pocket reading at a job is noise', async () => {
      const r = await withState({ job: 9001, mph: 3 });
      expect(r.state).toBe('site');
      expect(r.sent.speed_mph).toBe(null);
    });

    test('the shop beats a saved place, and a place beats a job', async () => {
      const a = await withState({ shop: true, place: 'p1', job: 9001 });
      expect(a.state).toBe('shop');
      const b = await withState({ place: 'p1', job: 9001 });
      expect(b.state).toBe('place');
    });

    test('the open dwell is the fallback when no fence resolved', async () => {
      const r = await withState({ dwell: { id: 'd', kind: 'shop', name: 'The yard', sinceTs: Date.now() } });
      expect(r.state).toBe('shop');
      expect(r.dest).toBe('The yard');
    });

    test('nothing resolved writes nulls, exactly like every row before today', async () => {
      const r = await withState({});
      expect(r.state).toBe(null);
      expect(r.sent.state).toBe(null);
      expect(r.sent.dest).toBe(null);
      expect(r.sent.journey_id).toBe(null);
      expect(r.sent.speed_mph).toBe(null);
      expect(r.sent.lat).toBe(41.5);
    });

    test('battery rides the last stats read, never a fresh plugin call', async () => {
      const r = await withState({ job: 9001, batt: 0.41 });
      expect(r.sent.battery).toBe(0.41);
      const none = await withState({ job: 9001, batt: null });
      expect(none.sent.battery, 'unreadable stays unreadable, never a fake 100%').toBe(null);
    });

    test('junk state never throws and never poisons the row', async () => {
      const r = await page.evaluate(() => {
        const saved = { dwell: window._geoOpenDwell, job: _geoCurrentJob };
        const out = [];
        for (const d of [null, {}, { kind: 'nonsense' }, { name: 123 }, { journeyId: {} }]) {
          window._geoOpenDwell = d; _geoCurrentJob = null;
          try { out.push(typeof _geoPingState()); } catch (e) { out.push('THREW'); }
          try { _geoPingDest(_geoPingState()); } catch (e) { out.push('THREW'); }
        }
        window._geoOpenDwell = saved.dwell; _geoCurrentJob = saved.job;
        return out;
      });
      expect(r).not.toContain('THREW');
    });

    test('the label is capped so one long job name cannot bloat every row', async () => {
      const r = await withState({ dwell: { id: 'd', kind: 'client', name: 'x'.repeat(400), sinceTs: Date.now() } });
      expect(r.dest.length).toBe(120);
    });
  });

  // ── The ping is stamped when the FIX happened ─────────────────────────────
  // Owner's account 2026-09-05: 257 pings inside 1.35 seconds across 191
  // distinct positions, a buffered replay all claiming to be current.
  test.describe('a ping carries the moment of its fix', () => {
    const write = (offsetMs) => page.evaluate(({ offsetMs }) => {
      let sent = null;
      const savedSupa = window._supa, savedUser = window._supaUser;
      window._supaUser = { id: 'emp-uid' };
      window._supa = { from: () => ({ insert: (row) => { sent = row; return { then: (a) => { a(); return { catch: () => {} }; } }; } }) };
      const now = Date.now();
      _geoWritePing({ lat: 41.5, lng: -88.1 }, 10, offsetMs == null ? undefined : now + offsetMs);
      window._supa = savedSupa; window._supaUser = savedUser;
      return { ts: sent && sent.ts, now };
    }, { offsetMs });

    test('a replayed fix from two hours ago is stamped two hours ago', async () => {
      const r = await write(-2 * 3600000);
      const drift = r.now - Date.parse(r.ts);
      expect(drift).toBeGreaterThan(2 * 3600000 - 5000);
      expect(drift).toBeLessThan(2 * 3600000 + 5000);
    });

    test('a live fix is stamped now', async () => {
      const r = await write(0);
      expect(Math.abs(r.now - Date.parse(r.ts))).toBeLessThan(2000);
    });

    test('no moment given still writes a valid row, stamped now', async () => {
      const r = await write(null);
      expect(isFinite(Date.parse(r.ts))).toBe(true);
      expect(Math.abs(r.now - Date.parse(r.ts))).toBeLessThan(2000);
    });

    test('a clock running fast can never put a pin in the future', async () => {
      const r = await write(60 * 60000);
      expect(Date.parse(r.ts), 'clamped to now, or it owns the top of every newest-first read')
        .toBeLessThanOrEqual(r.now + 1000);
    });

    test('junk moments fall back to now instead of writing null', async () => {
      const r = await page.evaluate(() => {
        const savedSupa = window._supa, savedUser = window._supaUser;
        window._supaUser = { id: 'emp-uid' };
        const out = [];
        for (const bad of [NaN, -1, 0, 'nope', {}, Infinity]) {
          let sent = null;
          window._supa = { from: () => ({ insert: (row) => { sent = row; return { then: (a) => { a(); return { catch: () => {} }; } }; } }) };
          _geoWritePing({ lat: 41.5, lng: -88.1 }, 10, bad);
          out.push(sent && isFinite(Date.parse(sent.ts)));
        }
        window._supa = savedSupa; window._supaUser = savedUser;
        return out;
      });
      expect(r.every(Boolean)).toBe(true);
    });
  });

  // ── The radio budget watchdog ─────────────────────────────────────────────
  // The leak ran four and a half hours because nothing was watching. The
  // plugin already counted the seconds; nothing ever read them in anger.
  test.describe('the radio budget watchdog', () => {
    const run = (setup) => page.evaluate(async ({ setup }) => {
      const saved = { td: _geoTdPlugin, drive: _geoDriveWinAt, saw: _geoRadioSawDrive, obs: window._obs };
      window.__tracked = [];
      window._obs = { track: (n, d) => window.__tracked.push([n, d]) };
      _geoTdPlugin = () => ({ stats: async () => ({ gpsOnMs: setup.gpsNow }) });
      _geoDriveWinAt = setup.driving ? Date.now() : 0;
      _geoRadioSawDrive = !!setup.sawDrive;
      localStorage.removeItem('zp3_geo_radio');
      if (setup.base) {
        localStorage.setItem('zp3_geo_radio', JSON.stringify({ at: Date.now() - setup.ageMs, gps: setup.gpsBase }));
      }
      const res = await _geoRadioCheck();
      const out = { res, tracked: window.__tracked.slice(),
                    stored: JSON.parse(localStorage.getItem('zp3_geo_radio') || 'null') };
      _geoTdPlugin = saved.td; _geoDriveWinAt = saved.drive;
      _geoRadioSawDrive = saved.saw; window._obs = saved.obs;
      localStorage.removeItem('zp3_geo_radio');
      return out;
    }, { setup });

    test('radio on for most of an idle hour is reported', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 0, gpsNow: 55 * 60000 });
      expect(r.res, 'the leak is named, not swallowed').not.toBe(null);
      expect(r.tracked[0][0]).toBe('radio_budget');
      expect(r.tracked[0][1]).toContain('55m radio');
    });

    test('a window containing a drive is never judged', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 0, gpsNow: 55 * 60000, sawDrive: true });
      expect(r.res, 'a drive earns the radio, by design').toBe(null);
      expect(r.tracked.length).toBe(0);
    });

    test('a drive open right now is also not judged', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 0, gpsNow: 55 * 60000, driving: true });
      expect(r.res).toBe(null);
    });

    test('a normal idle hour says nothing', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 0, gpsNow: 3 * 60000 });
      expect(r.res).toBe(null);
      expect(r.tracked.length).toBe(0);
    });

    test('a short window is not judged, one burst would skew it', async () => {
      const r = await run({ base: true, ageMs: 10 * 60000, gpsBase: 0, gpsNow: 9 * 60000 });
      expect(r.res).toBe(null);
    });

    test('no baseline takes one instead of reporting a nonsense delta', async () => {
      const r = await run({ gpsNow: 900000 });
      expect(r.res).toBe(null);
      expect(r.stored.gps).toBe(900000);
    });

    test('a counter reset under us re-baselines rather than reporting negative', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 5000000, gpsNow: 12000 });
      expect(r.res).toBe(null);
      expect(r.stored.gps).toBe(12000);
    });

    test('every check re-baselines, so one window is never counted twice', async () => {
      const r = await run({ base: true, ageMs: 60 * 60000, gpsBase: 0, gpsNow: 55 * 60000 });
      expect(r.stored.gps).toBe(55 * 60000);
    });

    test('no plugin, no throw, no report', async () => {
      const r = await page.evaluate(async () => {
        const saved = _geoTdPlugin;
        _geoTdPlugin = () => null;
        let threw = false, res;
        try { res = await _geoRadioCheck(); } catch (e) { threw = true; }
        _geoTdPlugin = saved;
        return { threw, res };
      });
      expect(r.threw).toBe(false);
      expect(r.res).toBe(null);
    });
  });

  test.describe('the sweep guard (js/cloud.js)', () => {
    test('a derived GPS leg is never sweep-eligible, on either row shape', async () => {
      const r = await page.evaluate(() => [
        _sweepGuarded('td_mileage', { id: 'a', data: { gps: true } }),
        _sweepGuarded('td_mileage', { id: 'a', gps: true }),
        _sweepGuarded('td_mileage', { id: 'a', data: { gps: false } }),
        _sweepGuarded('td_mileage', { id: 'a' }),
        _sweepGuarded('td_clients', { id: 'a', data: { gps: true } }),
        _sweepGuarded('td_mileage', null),
      ]);
      expect(r).toEqual([true, true, false, false, false, false]);
    });
  });

  // ── WHAT ACTUALLY RUNS THE DERIVE (Jack, 2026-09-08) ──────────────────────
  //
  // The deriver was never wrong about his morning. Nothing ever asked it.
  //
  // He drove in at 7:44, parked at the shop at 7:57 and left the phone in the
  // truck, so the tape flipped automotive -> `still` and never to onFoot. The
  // journey-end trigger tested `_foot(cur)`, which `still` is not, so it did
  // not fire. The two push-pings that came after it (8:00 and 8:30) did call
  // the derive, but through a 4-second setTimeout armed inside a background
  // wake that iOS suspended before it could fire. The 8:14 relaunch was a
  // location wake, not a person, so no app-active came either. His day sat
  // underived on the phone until he opened the app, and no screen anywhere
  // said the trip was missing.
  //
  // The deriver already knew about phones left in trucks: stillEndMs is ten
  // minutes, "a truck that sits this long has parked, foot flip or not", and
  // there is a test for it in tests/e2e-geo-derive.spec.js. Only the wiring
  // had not been told. So these tests are about WHO CALLS, and about the one
  // thing that turned a missed call into a silent one: an edge that arrives
  // on a background wake must derive NOW, in the runtime it actually has,
  // never on a timer into a process that is about to be suspended.
  test.describe('what runs a live derive', () => {
    // Every case records the `why` and whether it asked for the immediate
    // path, then the real function is put back. Nothing here derives for
    // real: the point is which calls are made, not what they produce.
    async function calls(events) {
      return page.evaluate(async (evs) => {
        const keep = window._geoDeriveLiveSoon, keepUpd = window._geoBgUpdateCheck;
        const seen = [];
        window._geoDeriveLiveSoon = (why, now) => { seen.push({ why, now: !!now }); };
        window._geoBgUpdateCheck = () => {};
        try {
          for (const e of evs) {
            try { await _geoTdEvent(Object.assign({ ts: Date.now() }, e), false); } catch (_e) {}
          }
          return seen;
        } finally { window._geoDeriveLiveSoon = keep; window._geoBgUpdateCheck = keepUpd; }
      }, events);
    }
    const motion = (kind, prevKind) => ({ type: 'motion', kind, prevKind });

    test('a phone left in the truck ends the journey: automotive to still derives', async () => {
      // THE BUG, as a test. Before the fix this returned [].
      const r = await calls([motion('automotive', 'walking'), motion('still', 'automotive')]);
      expect(r.some(c => c.why === 'flip'), 'automotive to still is a journey end').toBe(true);
    });

    test('and it does not wait four seconds to do it', async () => {
      // The half that made it silent rather than late. A flip arrives on a
      // background wake exactly like a ping does.
      const r = await calls([motion('automotive', 'walking'), motion('still', 'automotive')]);
      expect(r.find(c => c.why === 'flip').now).toBe(true);
    });

    test('walking off still ends it too: the old case is not traded for the new one', async () => {
      for (const k of ['onFoot', 'walking', 'running']) {
        const r = await calls([motion('automotive', 'walking'), motion(k, 'automotive')]);
        expect(r.some(c => c.why === 'flip'), k + ' ends a journey').toBe(true);
      }
    });

    test('cycling does not end a journey', async () => {
      // Deliberate, and the reason is already in js/geo-track.js: the server
      // counts cycling as vehicular. A truck crawling through a lot reads as
      // cycling, and calling that a journey end splits one drive into two.
      const r = await calls([motion('automotive', 'walking'), motion('cycling', 'automotive')]);
      expect(r.some(c => c.why === 'flip')).toBe(false);
    });

    test('coming to rest from a standstill is not a journey end either', async () => {
      // No drive to end. Only automotive -> rest counts.
      const r = await calls([motion('still', 'onFoot'), motion('onFoot', 'still')]);
      expect(r.some(c => c.why === 'flip')).toBe(false);
    });

    test('the 30-minute ping derives now, not on a timer', async () => {
      // The load-bearing one for his actual morning. At the instant the truck
      // stops, the stillness is zero minutes long and the journey cannot
      // close yet (stillEndMs is ten). It is the NEXT ping that closes it, so
      // that ping is the last thing standing between a real drive and a hole
      // in the day.
      const r = await calls([{ type: 'push-ping', lat: 39.01, lng: -95.69, acc: 5 }]);
      const c = r.find(x => x.why === 'push-ping');
      expect(c, 'a ping asks for a derive').toBeTruthy();
      expect(c.now, 'and cannot afford to wait for a timer').toBe(true);
    });

    test('a background relaunch derives: iOS wakes the app without ever making it active', async () => {
      const r = await calls([{ type: 'app-relaunch' }]);
      const c = r.find(x => x.why === 'app-relaunch');
      expect(c).toBeTruthy();
      expect(c.now).toBe(true);
    });

    test('wake-on-move derives now: it IS the relaunch', async () => {
      const r = await calls([{ type: 'wake-move', lat: 39.01, lng: -95.69, acc: 5 }]);
      const c = r.find(x => x.why === 'wake-move');
      expect(c).toBeTruthy();
      expect(c.now).toBe(true);
    });

    test('the foreground sources keep the debounce they were given', async () => {
      // The 4 seconds is not a bug, it is a burst absorber, and a fence
      // crossing genuinely arrives in bursts. Only the wake-driven callers
      // needed taking off it.
      const r = await calls([
        { type: 'regionEnter', regionId: 'shop', lat: 39.01, lng: -95.69 },
        { type: 'regionExit', regionId: 'shop', lat: 39.01, lng: -95.69 },
      ]);
      const fence = r.filter(c => c.why === 'regionEnter' || c.why === 'regionExit');
      expect(fence.length, 'both crossings ask').toBe(2);
      expect(fence.every(c => c.now === false), 'and both are content to wait').toBe(true);
    });

    test('an immediate derive leaves no timer armed behind it', async () => {
      // Belt and braces on the real function: `now` must not also arm the
      // 4-second path, or a suspended process still has a stale timer to
      // fire on its next wake and the day gets derived twice for nothing.
      const r = await page.evaluate(async () => {
        const keepDay = window._geoDeriveDayNow;
        let ran = 0;
        window._geoDeriveDayNow = async () => { ran++; return null; };
        try {
          _geoDeriveLiveSoon('test-debounced');
          const armedAfterDebounced = _geoDeriveLiveT != null;
          await _geoDeriveLiveSoon('test-now', true);
          return { armedAfterDebounced, armedAfterNow: _geoDeriveLiveT != null, ran };
        } finally {
          window._geoDeriveDayNow = keepDay;
          if (_geoDeriveLiveT) { clearTimeout(_geoDeriveLiveT); window._geoDeriveLiveT = null; }
        }
      });
      expect(r.armedAfterDebounced, 'the debounced path arms a timer').toBe(true);
      // The immediate call cancels the pending one and runs instead of arming.
      expect(r.armedAfterNow).toBe(false);
      expect(r.ran, 'it derived once, right then').toBe(1);
    });
  });

  // The journal that has to outlive a bad boot (owner 2026-09-09). The build
  // that never started its geo layer ran for an hour; the build that replaced
  // it wrote 30 lines of its own boot inside a minute, and the bad boot's
  // lines were gone before anyone could read them.
  test.describe('the park journal keeps 200 lines', () => {
    test('the cap is 200, the newest survive, and it persists', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('td_geo_park_log'); _geoParkLog.length = 0;
        for (let i = 0; i < 260; i++) _geoParkNote('probe', 'line ' + i);
        const stored = JSON.parse(localStorage.getItem('td_geo_park_log') || '[]');
        return { mem: _geoParkLog.length, stored: stored.length, first: stored[0].x, last: stored[stored.length - 1].x };
      });
      expect(r.mem).toBe(200);
      expect(r.stored).toBe(200);
      expect(r.first, 'the oldest sixty were dropped, nothing newer').toBe('line 60');
      expect(r.last).toBe('line 259');
    });
  });

  test('no console errors across the wiring', async () => {
    assertNoErrors(page, 'geo-derive wiring');
  });
});
