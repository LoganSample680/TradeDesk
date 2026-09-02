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

    test('the engine\'s mileage writer is gated too', async () => {
      const r = await page.evaluate(() => {
        const before = mileage.length;
        const out = _geoAutoMileage({ lat: 1, lng: 1, name: 'A' }, { lat: 2, lng: 2, name: 'B' }, 'k1', '2026-09-01T13:00:00Z', true, 10, '2026-09-01T13:10:00Z');
        return { out, added: mileage.length - before };
      });
      expect(r.out).toBeNull();
      expect(r.added).toBe(0);
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

    test('the boot rebuild walks the tape\'s window and derives each covered day once', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        window.mileage = [];
        const days = [];
        const orig = window._geoDeriveDayNow;
        window._geoDeriveDayNow = async (d) => { days.push(d); return { dwells: [], legs: [] }; };
        window._geoDeriveServerFixes = async () => [];
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
