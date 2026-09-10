// @ts-check
/**
 * Needs an answer: the nudge (owner 2026-09-05, js/hold-nudge.js).
 *
 * A held store run and a held client visit sit on the Home card until they
 * are answered. This is the buzz that gets them answered, and the whole
 * design is WHEN: the first stop after the store for the receipt (on the
 * seat, hands free), the arrival home for the visit (the day winding down),
 * 9 pm only if something is still open. Never on the move. One buzz, not
 * two: when day-end proposes the clock-out at the same arrival, its
 * notification carries the question. The copy names the store and the
 * client (owner: "Use client name").
 *
 * Everything is JS (CLAUDE.md 3.2), so all of it runs here against a fake
 * TdNotify that records what would have reached the lock screen, the same
 * harness e2e-day-end uses.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function fakeNative(page) {
  await page.addInitScript(() => {
    const calls = [];
    window.__td = { calls };
    const rec = (name) => (args) => { calls.push({ name, args: args || {} }); return Promise.resolve({ ok: true }); };
    const TdNotify = {
      permission: () => Promise.resolve({ status: 'granted' }),
      request: () => Promise.resolve({ granted: true }),
      schedule: rec('schedule'), cancel: rec('cancel'),
      addListener: () => ({ remove() {} }),
    };
    const TdLive = {
      isSupported: () => Promise.resolve({ supported: true, enabled: true }),
      start: rec('live.start'), update: rec('live.update'), end: rec('live.end'), endAll: rec('live.endAll'),
      addListener: () => ({ remove() {} }),
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      registerPlugin: (n) => (n === 'TdNotify' ? TdNotify : n === 'TdLive' ? TdLive : {}),
      Plugins: { TdNotify, TdLive },
    };
  });
}

const HOME_FENCE = { id: 'f-home', kind: 'home_office', name: '7402 SW 22nd Ct', addr: '7402 SW 22nd Ct' };
const JOB_FENCE = { id: 'f-job', kind: 'job', name: 'Smith kitchen', addr: '1 Main St' };
const STORE_FENCE = { id: 'f-hd', kind: 'supply', name: 'Home Depot', addr: '2 Main St' };
const MOM_FENCE = { id: 'f-mom', kind: 'client', name: 'Mom', addr: '3 Main St', clientId: 7 };

test.describe('Needs an answer: the nudge', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await fakeNative(page);
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });

  test.beforeEach(async () => {
    await page.evaluate(async () => {
      if (_geoDeriveLiveT) { clearTimeout(_geoDeriveLiveT); _geoDeriveLiveT = null; }
      if (_geoDeriveRebuildT) { clearTimeout(_geoDeriveRebuildT); _geoDeriveRebuildT = null; }
      window._geoDeriveRebuilt = true;
      if (_geoDeriveRebuildP) { try { await _geoDeriveRebuildP; } catch (_e) {} }
      window.__td.calls.length = 0;
      S.bizTz = 'America/Chicago';
      S.ownerName = 'Jack Sample';
      try { if (typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id) localStorage.setItem('zp3_uname_' + _supaUser.id, 'Jack Sample'); } catch (_e) {}
      localStorage.removeItem('zp3_hold_nudge');
      localStorage.removeItem('zp3_day_end');
      localStorage.removeItem('zp3_day_end_arr');
      if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; hideClockBanner(); }
      window._geoOpenDwell = null;
      timeEntries = [];
      mileage.length = 0;
    });
  });
  test.afterEach(() => { assertNoErrors(page, 'hold nudge'); });

  // Helpers on the page's clock (CLAUDE.md 5.2.2): today's business day.
  const seedRun = (store) => page.evaluate((store) => {
    const key = todayKey() + '|' + store;
    mileage.push({ id: _newId(), gps: true, date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
    return key;
  }, store);
  const at = (h, m) => page.evaluate(({ h, m }) => _geoDayBounds(_geoDayKeyOf(Date.now(), _geoBizTz())).start + (h * 60 + m) * 60000, { h, m });
  const dwell = (fence, sinceTs) => ({ id: 'd-' + fence.id, name: fence.name, kind: fence.kind, sinceTs, fence });
  const heldRes = (extra) => Object.assign({ dwells: [{ id: 'd-j-mom', kind: 'client', name: 'Mom', fence: MOM_FENCE, startTs: 1, endTs: 2, minutes: 95, held: true }], legs: [], journeys: [] }, extra || {});
  const sched = () => page.evaluate(() => window.__td.calls.filter((c) => c.name === 'schedule').map((c) => c.args));
  const cancels = () => page.evaluate(() => window.__td.calls.filter((c) => c.name === 'cancel').map((c) => c.args));

  test.describe('the store run: the first stop after the store', () => {
    test('parked at the job after Home Depot: one buzz, the store by name, no second one for the same run', async () => {
      await seedRun('Home Depot');
      const ts = await at(9, 30);
      const r = await page.evaluate(({ d }) => {
        const a = _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] });
        const b = _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] });
        return { a, b };
      }, { d: dwell(JOB_FENCE, ts) });
      expect(r.a).toBe('new');
      expect(r.b).toBe(false);
      const s = await sched();
      expect(s.length).toBe(1);
      expect(s[0]).toMatchObject({ id: 'hold:store', title: 'Got the Home Depot receipt?', atMs: 0 });
      expect(s[0].body).toContain('Scan it now');
    });

    test('AT the store, or on the move, nothing fires: the receipt is not in hand yet', async () => {
      await seedRun('Home Depot');
      const ts = await at(9, 0);
      const r = await page.evaluate(({ store, moving }) => ({
        atStore: _holdNudgeOnDwell(store, { dwells: [], legs: [], journeys: [] }),
        moving: _holdNudgeOnDwell(null, { dwells: [], legs: [], journeys: [] }),
        noSince: _holdNudgeOnDwell(moving, { dwells: [], legs: [], journeys: [] }),
      }), { store: dwell(STORE_FENCE, ts), moving: { id: 'x', kind: 'job', name: 'x', sinceTs: 0 } });
      expect(r).toEqual({ atStore: false, moving: false, noSince: false });
      expect(await sched()).toEqual([]);
    });

    test('two stores on one run: one buzz names both', async () => {
      await seedRun('Home Depot');
      await seedRun('Ferguson');
      const ts = await at(10, 0);
      await page.evaluate(({ d }) => _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] }), { d: dwell(JOB_FENCE, ts) });
      const s = await sched();
      expect(s.length).toBe(1);
      expect(s[0].title).toBe('Got the Ferguson and Home Depot receipts?');
    });

    test('yesterday\'s run is not today\'s nudge: it is on the card, the buzz is for today', async () => {
      await page.evaluate(() => {
        const y = dateKey(new Date(Date.now() - 86400000));
        mileage.push({ id: _newId(), gps: true, date: y, miles: 4.2, pendingReceipt: true, supplyRunKey: y + '|Home Depot', created_at: new Date(Date.now() - 86400000).toISOString() });
      });
      const ts = await at(9, 30);
      const r = await page.evaluate(({ d }) => _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] }), { d: dwell(JOB_FENCE, ts) });
      expect(r).toBe(false);
      expect(await sched()).toEqual([]);
    });

    test('answering the run cancels what is still pending', async () => {
      const key = await seedRun('Home Depot');
      const ts = await at(9, 30);
      await page.evaluate(({ d }) => _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] }), { d: dwell(JOB_FENCE, ts) });
      await page.evaluate((key) => resolveSupplyRun(key, 'noreceipt'), key);
      const c = await cancels();
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c[c.length - 1].ids).toEqual(['hold:store', 'hold:home', 'hold:eve']);
    });
  });

  test.describe('the visit: the arrival home', () => {
    test('home with a held visit and no day-end proposal: the question names Mom, waits twenty minutes, and 9 pm backs it up', async () => {
      const ts = await at(18, 40);
      const r = await page.evaluate(({ d, res }) => {
        const ret = _holdNudgeOnDwell(d, res);
        const again = _holdNudgeOnDwell(d, res);
        return { ret, again, nine: _dayEndNudgeAt(21), now: Date.now() };
      }, { d: dwell(HOME_FENCE, ts), res: heldRes() });
      expect(r.ret).toBe('new');
      expect(r.again, 'the same arrival asks once').toBe(false);
      const s = await sched();
      const home = s.find((c) => c.id === 'hold:home');
      expect(home).toBeTruthy();
      expect(home.title).toBe('Hey Jack!');
      expect(home.body).toBe('Was Mom work or personal? Tap to answer.');
      expect(home.atMs).toBeGreaterThanOrEqual(ts + 20 * 60000 - 1);
      const eve = s.find((c) => c.id === 'hold:eve');
      if (r.nine > home.atMs + 60000) { expect(eve).toBeTruthy(); expect(eve.atMs).toBe(r.nine); expect(eve.body).toBe(home.body); }
      else expect(eve).toBeFalsy();
    });

    test('a store run still open at home rides the same line: receipt first, then the visit', async () => {
      await seedRun('Home Depot');
      const ts = await at(18, 40);
      await page.evaluate(({ d, res }) => _holdNudgeOnDwell(d, res), { d: dwell(HOME_FENCE, ts), res: heldRes() });
      const s = await sched();
      const home = s.find((c) => c.id === 'hold:home');
      expect(home.body).toBe('Home Depot receipt still needed. Was Mom work or personal? Tap to answer.');
    });

    test('two visits read as a pair, three as a count', async () => {
      const ts = await at(18, 40);
      const r = await page.evaluate(({ d }) => {
        const mk = (id, name) => ({ id, kind: 'client', name, fence: { id: 'f' + id, kind: 'client', name }, startTs: 1, endTs: 2, minutes: 30, held: true });
        _holdNudgeNote({ dwells: [mk('d-1', 'Mom'), mk('d-2', 'Dad')] });
        const two = _holdNudgeLine();
        _holdNudgeNote({ dwells: [mk('d-3', 'Uncle Ray')] });
        const three = _holdNudgeLine();
        return { two, three };
      }, { d: dwell(HOME_FENCE, ts) });
      expect(r.two).toBe('Were Mom and Dad work or personal?');
      expect(r.three).toBe('Were Mom and 2 more work or personal?');
    });

    test('home with nothing to ask: silence', async () => {
      const ts = await at(18, 40);
      const r = await page.evaluate(({ d }) => _holdNudgeOnDwell(d, { dwells: [{ id: 'd-x', kind: 'client', name: 'Mom', held: false, startTs: 1, endTs: 2, minutes: 30 }], legs: [], journeys: [] }), { d: dwell(HOME_FENCE, ts) });
      expect(r).toBe(false);
      expect(await sched()).toEqual([]);
    });

    test('a fresh arrival home is a fresh question; the visit is not asked at the customer\'s house', async () => {
      const t1 = await at(12, 0), t2 = await at(18, 40);
      const r = await page.evaluate(({ mom, h1, h2, res }) => {
        const atMom = _holdNudgeOnDwell(mom, res);
        const a = _holdNudgeOnDwell(h1, res);
        const b = _holdNudgeOnDwell(h2, res);
        return { atMom, a, b };
      }, { mom: dwell(MOM_FENCE, t1 - 3600000), h1: dwell(HOME_FENCE, t1), h2: dwell(HOME_FENCE, t2), res: heldRes() });
      expect(r.atMom).toBe(false);
      expect(r.a).toBe('new');
      expect(r.b).toBe('new');
      expect((await sched()).filter((c) => c.id === 'hold:home').length).toBe(2);
    });
  });

  test.describe('one buzz, not two: folded into the day-end proposal', () => {
    // The open manual clock Jack started at home this morning, so day-end
    // has a clock-out to propose at the arrival home.
    async function seedOpenClock() {
      return page.evaluate(() => {
        const tb = _geoDayBounds(_geoDayKeyOf(Date.now(), _geoBizTz()));
        const START = tb.start + (7 * 60 + 44) * 60000;
        const row = { id: 9101, job_id: null, date: todayKey(), start_time: new Date(START).toISOString(), end_time: null, minutes: null,
          scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Jack Sample', open: true };
        timeEntries.push(row);
        _rehydrateActiveTimer();
        return { timer: !!_activeTimer };
      });
    }
    // A day with a drive home (day-end needs one to propose) and, optionally,
    // the held dwells the deriver saw on the way.
    const dayRes = (HOME, dwells) => ({ dwells: dwells || [], legs: [{ id: 'l1', from: JOB_FENCE, to: HOME_FENCE, startTs: HOME - 14 * 60000, endTs: HOME }], journeys: [{ id: 'j1', open: false }] });

    test('the publish order: the day-end body already asks about Mom, and nothing extra is scheduled', async () => {
      const d0 = await seedOpenClock();
      expect(d0.timer).toBe(true);
      const HOME = await at(19, 40);
      const r = await page.evaluate(({ d, res }) => {
        // The same three calls, in the same order, as _geoOpenDwellPublish.
        _holdNudgeNote(res);
        const de = _dayEndOnDwell(d, res);
        const hn = _holdNudgeOnDwell(d, res);
        return { de, hn };
      }, { d: dwell(HOME_FENCE, HOME), res: dayRes(HOME, heldRes().dwells) });
      expect(r.de, 'day-end proposed the clock-out').toBe('new');
      expect(r.hn, 'the nudge folded into it').toBe('new');
      const s = await sched();
      const de = s.filter((c) => c.id === 'dayend');
      expect(de.length).toBe(1);
      expect(de[0].body).toBe('Looks like your day ended at 7:40 PM. Was Mom work or personal? Tap to confirm.');
      expect(s.find((c) => c.id === 'hold:home'), 'no second buzz for the same arrival').toBeFalsy();
      expect(s.find((c) => c.id === 'hold:eve')).toBeFalsy();
    });

    test('the publish itself wires all three, in that order', async () => {
      const src = await page.evaluate(() => _geoOpenDwellPublish.toString());
      const iNote = src.indexOf('_holdNudgeNote('), iDay = src.indexOf('_dayEndOnDwell('), iNudge = src.indexOf('_holdNudgeOnDwell(');
      expect(iNote).toBeGreaterThan(0);
      expect(iDay).toBeGreaterThan(iNote);
      expect(iNudge).toBeGreaterThan(iDay);
    });

    test('answered while the proposal stands: the day-end body is rewritten without the question, same ids, same times', async () => {
      await seedOpenClock();
      const HOME = await at(19, 40);
      await page.evaluate(({ d, res }) => { _holdNudgeNote(res); _dayEndOnDwell(d, res); _holdNudgeOnDwell(d, res); }, { d: dwell(HOME_FENCE, HOME), res: dayRes(HOME, heldRes().dwells) });
      const before = (await sched()).filter((c) => c.id === 'dayend' || c.id === 'dayend2');
      expect(before.length).toBeGreaterThanOrEqual(1);
      expect(before[0].body).toContain('Was Mom work or personal?');
      await page.evaluate(() => { window.__td.calls.length = 0; _holdNudgeAnswered('d-j-mom'); });
      const after = (await sched()).filter((c) => c.id === 'dayend' || c.id === 'dayend2');
      expect(after.length).toBe(before.length);
      after.forEach((c, i) => {
        expect(c.body).toBe('Looks like your day ended at 7:40 PM. Tap to confirm.');
        expect(c.atMs).toBe(before[i].atMs);
        expect(c.id).toBe(before[i].id);
      });
      const c = await cancels();
      expect(c[c.length - 1].ids).toEqual(['hold:store', 'hold:home', 'hold:eve']);
    });

    test('an answered visit stays answered through the next rebuild: the deriver still says held, the nudge does not re-ask', async () => {
      const HOME = await at(19, 40);
      const r = await page.evaluate(({ d, res }) => {
        _holdNudgeNote(res);
        _holdNudgeAnswered('d-j-mom');
        _holdNudgeNote(res);              // the rebuild re-emits it held
        return { line: _holdNudgeLine(), ret: _holdNudgeOnDwell(d, res) };
      }, { d: dwell(HOME_FENCE, HOME), res: heldRes() });
      expect(r.line).toBe('');
      expect(r.ret).toBe(false);
    });

    test('no day-end body change when there is nothing to ask', async () => {
      await seedOpenClock();
      const HOME = await at(19, 40);
      await page.evaluate(({ d, res }) => { _holdNudgeNote(res); _dayEndOnDwell(d, res); _holdNudgeOnDwell(d, res); }, { d: dwell(HOME_FENCE, HOME), res: dayRes(HOME) });
      const de = (await sched()).find((c) => c.id === 'dayend');
      expect(de.body).toBe('Looks like your day ended at 7:40 PM. Tap to confirm.');
    });
  });

  test.describe('the Home card answers strike the nudge', () => {
    test('the visit door passes the row\'s client_key through, and the fetch asks for it', async () => {
      const r = await page.evaluate(async () => {
        const saved = { supa: window._supa, user: window._supaUser, toast: window.showToast };
        window._supa = { rpc: async () => ({ error: null }) }; window._supaUser = { id: 'me' }; window.showToast = () => {};
        try {
          _holdNudgeNote({ dwells: [{ id: 'd-j-mom', kind: 'client', name: 'Mom', held: true, startTs: 1, endTs: 2, minutes: 30 }] });
          _visitHoldCache = { at: Date.now(), rows: [{ id: 'v1', arrived_at: '2026-08-30T22:00:00Z', minutes: 30, dest_place: 'Mom', job_id: null, client_key: 'd-j-mom' }], uid: 'me' };
          const before = _holdNudgeLine();
          await _visitHoldAnswer('v1', 'personal');
          return { before, after: _holdNudgeLine(), fetchSrc: _visitHoldFetch.toString() };
        } finally { window._supa = saved.supa; window._supaUser = saved.user; window.showToast = saved.toast; _visitHoldCache = { at: 0, rows: [], uid: null }; }
      });
      expect(r.before).toBe('Was Mom work or personal?');
      expect(r.after).toBe('');
      expect(r.fetchSrc).toContain('client_key');
    });

    test('the 7-day sweep answers too', async () => {
      await page.evaluate(() => {
        const old = dateKey(new Date(Date.now() - 9 * 86400000));
        mileage.push({ id: _newId(), gps: true, date: old, miles: 4.2, pendingReceipt: true, supplyRunKey: old + '|Home Depot', created_at: new Date(Date.now() - 9 * 86400000).toISOString() });
        window.__td.calls.length = 0;
        _supplyRunSweep();
      });
      const c = await cancels();
      expect(c.length).toBe(1);
    });
  });

  test.describe('hardening (§11.1)', () => {
    test('junk in never throws: null, strings, missing storage, corrupted state', async () => {
      const r = await page.evaluate(() => {
        try {
          localStorage.setItem('zp3_hold_nudge', '{INVALID JSON{{{{');
          _holdNudgeNote(null); _holdNudgeNote('x'); _holdNudgeNote({ dwells: [null, {}, { held: true }] });
          _holdNudgeOnDwell('x', null); _holdNudgeOnDwell({ kind: 'home_office', sinceTs: 'nope' }, {});
          _holdNudgeLine(); _holdNudgeAnswered(null); _holdNudgeAnswered({}); _dayEndRenotify();
          return true;
        } catch (e) { return String(e); }
      });
      expect(r).toBe(true);
    });

    test('the state turns over with the business day: yesterday\'s nudges do not block today\'s', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_hold_nudge', JSON.stringify({ day: '2001-01-01', stores: ['x'], homeAt: 5, visits: [{ id: 'z', name: 'Ghost' }], answered: [] }));
        const st = _holdState();
        return { day: st.day === _holdTodayKey(), fresh: st.stores.length === 0 && st.homeAt === 0 && st.visits.length === 0 };
      });
      expect(r.day).toBe(true);
      expect(r.fresh).toBe(true);
    });

    test('concurrent publishes: ten at once still schedule the store buzz exactly once', async () => {
      await seedRun('Home Depot');
      const ts = await at(9, 30);
      await page.evaluate(({ d }) => { for (let i = 0; i < 10; i++) _holdNudgeOnDwell(d, { dwells: [], legs: [], journeys: [] }); }, { d: dwell(JOB_FENCE, ts) });
      expect((await sched()).filter((c) => c.id === 'hold:store').length).toBe(1);
    });

    test('nothing goes to managers: no send-push call anywhere in the module', async () => {
      const src = await page.evaluate(() => [_holdNudgeOnDwell, _holdNudgeAnswered, _holdNudgeLine, _holdNudgeNote].map((f) => f.toString()).join('\n'));
      expect(src).not.toContain('send-push');
      expect(src).not.toContain('toRole');
    });
  });
});
