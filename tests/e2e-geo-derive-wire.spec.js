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

const DAY = '2026-09-01';
const DAY_START = Date.parse('2026-09-01T05:00:00Z');
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
      window.supaLoadFromCloud = async () => {};
      window._supaUser = window._supaUser || { id: '30a2b589-e081-4351-9f18-b1efba238c2d', email: 'o@t.com' };
      localStorage.removeItem('zp3_geo_queue');
      localStorage.removeItem('zp3_geo_fixlog');
    });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => { localStorage.removeItem('zp3_geo_queue'); localStorage.removeItem('zp3_geo_fixlog'); });
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
        return { res: res && res.dwells.map(d => [d.kind, d.minutes]), q: q.map(x => x.args.p_time.map(r => r.source)) };
      });
      expect(r.res).toEqual([['office', 60]]);
      expect(r.q).toEqual([['place-office']]);
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
    const seed = async () => page.evaluate(([tape, SHOP, DOE, T]) => {
      S.bizTz = 'America/Chicago';
      S.officeLat = SHOP.lat; S.officeLon = SHOP.lng; S.bname = 'JS Solutions';
      window.places = [];
      window.clients = [{ id: 1788214075432, name: 'John Doe', addr: '2950 SW McClure Rd' }];
      localStorage.setItem('zp3_nearby_geo', JSON.stringify({ 1788214075432: { addr: '2950 SW McClure Rd', lat: DOE.lat, lon: DOE.lng } }));
      window._geoDeriveTape = async () => tape;
      window._geoDrainQueue = () => {};   // hold the queue so it can be inspected
      window._routeDistance = async () => ({ miles: 0, mins: 0 });   // no router unless a test brings one
      _geoFixLogPush(T[0], SHOP.lat, SHOP.lng, 5);
      _geoFixLogPush(T[1], DOE.lat, DOE.lng, 5);
      _geoFixLogPush(T[2], DOE.lat, DOE.lng, 5);
      _geoFixLogPush(T[3], SHOP.lat, SHOP.lng, 5);
      _geoFixLogPush(T[4], SHOP.lat, SHOP.lng, 5);
    }, [tape, SHOP, DOE, [T(7, 52) + 5000, T(8, 3) + 5000, T(12, 21) + 5000, T(12, 31) + 5000, T(13, 0)]]);

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
      expect(it.key).toBe('rpc:2026-09-01');
      expect(it.args.p_day).toBe(DAY);
      expect(it.args.p_employee).toBe(await page.evaluate(() => _supaUser.id));
      expect(it.args.p_day_start).toBe('2026-09-01T05:00:00.000Z');
      expect(it.args.p_day_end).toBe('2026-09-02T05:00:00.000Z');
      expect(it.args.p_time.map(x => x.source)).toEqual(['client', 'drive', 'drive']);
      expect(it.args.p_time[0].dest_place).toBe('John Doe');
      expect(it.args.p_shop).toEqual([]);
      expect(it.args.p_miles).toHaveLength(2);
      expect(it.args.p_miles[0].legKey).toBe(it.args.p_time[1].client_key);
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
      expect(r).toEqual(['rpc:2026-09-01']);
    });

    test('an empty tape derives nothing and touches no queue: a browser cannot wipe a day', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window._geoDeriveTape = async () => [];
        const res = await _geoDeriveDayNow(DAY, null);
        const other = await (async () => { window._geoDeriveTape = async () => [{ ts: Date.parse('2026-08-20T15:00:00Z'), kind: 'driving' }]; return _geoDeriveDayNow(DAY, null); })();
        return { res, other, q: JSON.parse(localStorage.getItem('zp3_geo_queue') || '[]').length };
      }, DAY);
      expect(r.res).toBeNull();
      expect(r.other, 'a tape that does not cover the day is the same as no tape').toBeNull();
      expect(r.q).toBe(0);
    });

    test('the in-memory mileage follows: old legs for the day go, hand trips stay, the vehicle rides across', async () => {
      await seed();
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [
          { id: 'old-gps', gps: true, date: DAY, miles: 9 },
          { id: 'hand', gps: false, date: DAY, miles: 12 },
          { id: 'other-day', gps: true, date: '2026-08-31', miles: 4 },
        ];
        const first = await _geoDeriveDayNow(DAY, null);
        const legId = first.legs[0].id;
        mileage.find(m => m.id === legId).vehicle = '2018 Silverado 2500';
        await _geoDeriveDayNow(DAY, null);
        return { ids: mileage.map(m => m.id).sort(), veh: mileage.find(m => m.id === legId).vehicle, legId };
      }, DAY);
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
      expect(r.notes).toEqual(['2026-09-01: 2 drives on the tape, none resolved']);
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
      const r = await page.evaluate(async (DAY) => {
        window.mileage = [{ id: 'hand', gps: false, date: DAY, miles: 12 }, { id: 'stray', gps: true, date: DAY, miles: 1 }];
        await _geoDeriveDayNow(DAY, null);
        const legIds = mileage.filter(m => m.gps).map(m => m.id).sort();
        // Something on the phone drops a leg from the list (the old classifier
        // did exactly this); a person also set a vehicle on the other one.
        mileage.splice(mileage.findIndex(m => m.id === legIds[0]), 1);
        mileage.find(m => m.id === legIds[1]).vehicle = 'F-250';
        const origSupa = window._supa;
        const serverRows = legIds.map(id => ({ id, data: { id, gps: true, date: DAY, miles: 3.2, from_name: 'S', to_name: 'D' } }))
          .concat([{ id: 'other-day', data: { id: 'other-day', gps: true, date: '2026-08-30', miles: 2 } }]);
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
      }, DAY);
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
      // motion row's stale last-known.
      const ins = r.calls.filter(c => c[0] === 'in');
      expect(ins.length).toBeGreaterThan(0);
      ins.forEach(c => expect(c).toEqual(['in', 'type', ['fix', 'push-ping']]));
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
        // Today with nobody on site clears it.
        const tDep = Math.max(t1 + 60000, now - 30 * 60000);   // after the arrival, whatever the hour
        window._geoDeriveTape = async () => [{ ts: t0 - 3600000, kind: 'onFoot' }, { ts: t0, kind: 'driving' }, { ts: t1, kind: 'onFoot' }, { ts: tDep, kind: 'driving' }];
        await _geoDeriveDayNow(today, null);
        return { open: !!(res && res.open), od: od && { name: od.name, kind: od.kind, since: od.sinceTs, cid: od.fence && od.fence.clientId }, t1, still: still && still.name, after: window._geoOpenDwell };
      }, [SHOP, DOE]);
      expect(r.open).toBe(true);
      expect(r.od).toEqual({ name: 'John Doe', kind: 'client', since: r.t1, cid: 1788214075432 });
      expect(r.still).toBe('John Doe');
      expect(r.after).toBeNull();
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
          localStorage.setItem('zp3_geo_derive_ver', APP_VERSION);
          await _geoDeriveRebuild();
          const same = days.length; days.length = 0;
          localStorage.setItem('zp3_geo_derive_ver', '00.00.00.0');
          await _geoDeriveRebuild();
          const changed = days.length;
          const stamped = localStorage.getItem('zp3_geo_derive_ver');
          // Coming back after half an hour runs it again; sooner does not.
          window._geoDeriveRebuilt = true; _geoDeriveRebuildT = null;
          _geoDeriveRebuiltAt = Date.now();
          const soon = _geoDeriveRebuildIfStale();
          days.length = 0; _geoDeriveRebuiltAt = Date.now() - 31 * 60000;
          const later = _geoDeriveRebuildIfStale();
          await new Promise(res => setTimeout(res, 50));
          return { same, changed, stamped, soon, later, ran: days.length };
        } finally { window._geoDeriveDayNow = origNow; window._geoDeriveServerFixes = real; }
      });
      expect(r.same).toBe(2);
      expect(r.changed).toBe(7);
      expect(r.stamped).toBe(await page.evaluate(() => APP_VERSION));
      expect(r.soon).toBe(false);
      expect(r.later).toBe(true);
      expect(r.ran).toBe(2);
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
          return { has: /John Doe/.test(html) && /Arrived/.test(html), clockIn: /clockIn\(null\)/.test(html), proposal: /_nearbyStartWork\(1788214075432\)/.test(html), first, ticked, gone };
        } finally { window._geoDriving = keepDrv; }
      });
      expect(r.has).toBe(true);
      expect(r.clockIn).toBe(true);
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
        // full week; a locked week derives two days (the test above).
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

  test('no console errors across the wiring', async () => {
    assertNoErrors(page, 'geo-derive wiring');
  });
});
