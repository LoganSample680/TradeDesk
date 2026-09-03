// @ts-check
/**
 * The day that ended on its own (owner 2026-09-02, js/day-end.js).
 *
 * Jack's manual clock ran 12h 55m because the phone came home at 7:40 PM and
 * nobody stopped it. The rule: the phone PROPOSES and the person confirms.
 * A local notification ("Hey Jack! Looks like your day ended at 7:40 PM.
 * Tap to confirm.") plus a Home card whose Yes clocks him out AT 7:40, not at
 * the moment of the tap. The morning mirror proposes a clock-in from the
 * departure. A drive withdraws the proposal, Undo makes it never have happened.
 *
 * Everything is JS by design (CLAUDE.md 3.2), so all of it runs here against a
 * fake TdNotify that records what would have reached the lock screen.
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

// 7:44 AM (the morning mirror's departure), named as an instant (CLAUDE.md
// 5.2.2). The evening fixtures are built on the PAGE's today instead
// (seedOpenClock below): a clock is "from yesterday" or not by the pinned
// clock's date, so a fixed date here would go stale at midnight.
const START = Date.parse('2026-09-02T12:44:00.000Z');
const HOME_FENCE = { id: 'f-home', kind: 'home_office', name: '7402 SW 22nd Ct', addr: '7402 SW 22nd Ct' };
const SHOP_FENCE = { id: 'f-shop', kind: 'shop', name: '1200 SW Oakley Ave', addr: '1200 SW Oakley Ave' };

test.describe('Day end: the phone proposes, the person confirms', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await fakeNative(page);
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.beforeEach(async () => {
    await page.evaluate(({ START }) => {
      window.__td.calls.length = 0;
      S.bizTz = 'America/Chicago';
      S.ownerName = 'Jack Sample';
      try { if (typeof _supaUser !== 'undefined' && _supaUser && _supaUser.id) localStorage.setItem('zp3_uname_' + _supaUser.id, 'Jack Sample'); } catch (_e) {}
      localStorage.removeItem('zp3_day_end');
      localStorage.removeItem('zp3_day_end_arr');
      if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; hideClockBanner(); }
      window._geoOpenDwell = null;
      timeEntries = [];
      _dayEndLast = null;
    }, { START });
  });
  test.afterEach(() => { assertNoErrors(page, 'day end'); });

  // The open manual entry Jack started at home this morning, adopted by the
  // same boot rehydrate the real app uses.
  // Today, 7:44 AM to 7:40 PM business time, on the page's clock.
  async function seedOpenClock() {
    return page.evaluate(() => {
      const tb = _geoDayBounds(_geoDayKeyOf(Date.now(), _geoBizTz()));
      const START = tb.start + (7 * 60 + 44) * 60000, HOME = tb.start + (19 * 60 + 40) * 60000;
      const row = { id: 9001, job_id: null, date: todayKey(), start_time: new Date(START).toISOString(), end_time: null, minutes: null,
        scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Jack Sample', open: true };
      timeEntries.push(row);
      _rehydrateActiveTimer();
      return { timer: !!_activeTimer, entryId: _activeTimer && _activeTimer.entryId, START, HOME };
    });
  }
  const homeDwell = (HOME) => ({ id: 'd1', name: HOME_FENCE.name, kind: 'home_office', sinceTs: HOME, fence: HOME_FENCE });
  const dayRes = (HOME) => ({ legs: [{ id: 'l1', from: SHOP_FENCE, to: HOME_FENCE, startTs: HOME - 14 * 60000, endTs: HOME }], journeys: [{ id: 'j1', open: false }] });

  test('home office + running clock + a drive today: proposes the arrival as the clock-out and schedules the nudge', async () => {
    const d0 = await seedOpenClock();
    expect(d0.timer).toBe(true);
    const r = await page.evaluate(async ({ dwell, res, HOME }) => {
      const nowBefore = Date.now();
      const ret = _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      const again = _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      const p = _dayEndPending();
      return { ret, again, p, name: _dayEndFirstName(), calls: window.__td.calls.filter((c) => c.name === 'schedule').map((c) => c.args), nowBefore, now: Date.now(), nine: _dayEndNudgeAt(21), nineKey: _geoDayKeyOf(_dayEndNudgeAt(21), 'America/Chicago'), todayKey: _geoDayKeyOf(Date.now(), 'America/Chicago') };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME), HOME: d0.HOME });
    expect(r.ret).toBe('new');
    expect(r.again).toBe(true);              // the same dwell proposes once
    expect(r.name).toBe('Jack');
    expect(r.p).toMatchObject({ kind: 'end', entryId: 9001, endMs: d0.HOME, where: HOME_FENCE.name });
    // One nudge, 20 minutes after the arrival or right now, whichever is later.
    const first = r.calls.find((c) => c.id === 'dayend');
    expect(first).toBeTruthy();
    expect(first.title).toBe('Hey Jack!');
    expect(first.body).toBe('Looks like your day ended at 7:40 PM. Tap to confirm.');
    // Compared against the page's own clock, never the runner's (CLAUDE.md 5.2.2).
    const floor = d0.HOME + 20 * 60000;
    if (r.nowBefore <= floor) expect(first.atMs).toBe(floor);
    else { expect(first.atMs).toBeGreaterThanOrEqual(r.nowBefore); expect(first.atMs).toBeLessThanOrEqual(r.now); }
    expect(r.calls.filter((c) => c.id === 'dayend').length).toBe(1);
    // The second nudge is 9 PM in the BUSINESS zone (the runner is on UTC), and
    // only if that is still after the first one.
    expect(r.nineKey).toBe(r.todayKey);
    expect(new Date(r.nine).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })).toBe('9:00 PM');
    const second = r.calls.find((c) => c.id === 'dayend2');
    if (r.nine > first.atMs + 60000) { expect(second).toBeTruthy(); expect(second.atMs).toBe(r.nine); expect(second.body).toBe(first.body); }
    else expect(second).toBeFalsy();
  });

  test('no drive today: the house is just where they are, nothing proposed', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(({ dwell }) => ({ ret: _dayEndOnDwell(dwell, { legs: [], journeys: [] }), p: _dayEndPending() }), { dwell: homeDwell(d0.HOME) });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  test('no running clock at the home office: nothing to end', async () => {
    const HOME = Date.parse('2026-09-03T00:40:00.000Z');
    const r = await page.evaluate(({ dwell, res }) => ({ ret: _dayEndOnDwell(dwell, res), p: _dayEndPending() }), { dwell: homeDwell(HOME), res: dayRes(HOME) });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  test('the truck moves again: the proposal is withdrawn and the nudges cancelled', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(async ({ dwell, res }) => {
      _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      window.__td.calls.length = 0;
      _dayEndOnDrive();
      await new Promise((k) => setTimeout(k, 60));
      return { p: _dayEndPending(), cancel: window.__td.calls.filter((c) => c.name === 'cancel').map((c) => c.args) };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    expect(r.p).toBeNull();
    expect(r.cancel.length).toBe(1);
    expect(r.cancel[0].ids).toEqual(['dayend', 'dayend2']);
  });

  test('confirm closes the entry AT the arrival, not at the tap; Undo puts it back open', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(async ({ dwell, res, HOME, START }) => {
      _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      window.__td.calls.length = 0;
      const ok = _dayEndConfirm();
      await new Promise((k) => setTimeout(k, 60));
      const e = timeEntries.find((x) => x.id === 9001);
      const after = { ok, open: e.open, end: e.end_time, minutes: e.minutes, timer: !!_activeTimer, pending: _dayEndPending(),
        toast: !!document.querySelector('.td-dayend-toast'), stored: localStorage.getItem('zp3_day_end'),
        cancel: window.__td.calls.filter((c) => c.name === 'cancel').map((c) => c.args) };
      const undone = _dayEndUndo();
      const e2 = timeEntries.find((x) => x.id === 9001);
      return { after, undone, open2: e2.open, end2: e2.end_time, min2: e2.minutes, timer2: !!_activeTimer, timerEntry: _activeTimer && _activeTimer.entryId };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME), HOME: d0.HOME, START: d0.START });
    expect(r.after.ok).toBe(true);
    expect(r.after.open).toBe(false);
    expect(r.after.end).toBe(new Date(d0.HOME).toISOString());
    expect(r.after.minutes).toBe(Math.round((d0.HOME - d0.START) / 60000));
    expect(r.after.timer).toBe(false);
    expect(r.after.pending).toBeNull();
    expect(r.after.stored).toBeNull();
    expect(r.after.toast).toBe(true);
    // The toast stays inside a 390px screen and wraps to a line or two (CLAUDE.md 15.3).
    const tb = await page.locator('.td-dayend-toast').boundingBox();
    expect(tb.x).toBeGreaterThanOrEqual(0);
    expect(tb.x + tb.width).toBeLessThanOrEqual(390);
    expect(tb.height).toBeLessThan(70);
    expect(r.after.cancel[0].ids).toEqual(['dayend', 'dayend2']);
    expect(r.undone).toBe(true);
    expect(r.open2).toBe(true);
    expect(r.end2).toBeNull();
    expect(r.min2).toBeNull();
    expect(r.timer2).toBe(true);
    expect(r.timerEntry).toBe(9001);
  });

  test('a proposal dies with its entry: closed by hand means nothing left to answer', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(({ dwell, res }) => {
      _dayEndOnDwell(dwell, res);
      clockOut(true, true);
      return { p: _dayEndPending(), stored: localStorage.getItem('zp3_day_end') };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    expect(r.p).toBeNull();
    expect(r.stored).toBeNull();
  });

  test('the Home card carries the copy and the two answers; "Still working" dismisses', async () => {
    const d0 = await seedOpenClock();
    await page.evaluate(({ dwell, res }) => { _dayEndOnDwell(dwell, res); goPg('pg-dash'); renderDash(); }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    const card = page.locator('#dash-nearby');
    await expect(card).toContainText('YOUR DAY');
    await expect(card).toContainText('Looks like your day ended at 7:40 PM');
    await expect(card).toContainText('Back at ' + HOME_FENCE.name);
    await expect(page.locator('#dash-dayend-yes')).toHaveText('Clock out at 7:40 PM');
    await expect(page.locator('#dash-dayend-no')).toHaveText('Still working');
    // Only one primary action on the card (CLAUDE.md 15.1), and it sits on the
    // right, "Still working" on the left (owner 2026-09-03).
    expect(await card.locator('button').count()).toBe(2);
    const [noBox, yesBox] = await Promise.all([page.locator('#dash-dayend-no').boundingBox(), page.locator('#dash-dayend-yes').boundingBox()]);
    expect(noBox.x + noBox.width).toBeLessThanOrEqual(yesBox.x);
    await page.locator('#dash-dayend-no').click();
    const r = await page.evaluate(() => ({ p: _dayEndPending(), timer: !!_activeTimer, html: document.getElementById('dash-nearby').innerHTML }));
    expect(r.p).toBeNull();
    expect(r.timer).toBe(true);               // dismiss never touches the clock
    expect(r.html).not.toContain('YOUR DAY');
    expect(r.html).toContain('Clock out');    // the normal on-the-clock card is back
  });

  test('tapping Yes on the card clocks out at the arrival time', async () => {
    const d0 = await seedOpenClock();
    await page.evaluate(({ dwell, res }) => { _dayEndOnDwell(dwell, res); goPg('pg-dash'); renderDash(); }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    await page.locator('#dash-dayend-yes').click();
    const r = await page.evaluate(() => { const e = timeEntries.find((x) => x.id === 9001); return { open: e.open, end: e.end_time, timer: !!_activeTimer, html: document.getElementById('dash-nearby').innerHTML }; });
    expect(r.open).toBe(false);
    expect(r.end).toBe(new Date(d0.HOME).toISOString());
    expect(r.timer).toBe(false);
    expect(r.html).not.toContain('YOUR DAY');
  });

  test('wired: the deriver publish reaches the proposal, and repaints the card on a same-dwell publish', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(async ({ dwell, res }) => {
      goPg('pg-dash'); renderDash();
      const key = _geoDayKeyOf(Date.now(), _geoBizTz());
      const open = { id: dwell.id, name: dwell.name, kind: dwell.kind, sinceTs: dwell.sinceTs, fence: dwell.fence };
      // First publish with no drive: nothing. Second publish, same dwell, now
      // with the leg that ended here: the proposal lands and the card repaints.
      _geoOpenDwellPublish(key, { open, legs: [], journeys: [] });
      const before = { p: _dayEndPending(), html: document.getElementById('dash-nearby').innerHTML.includes('YOUR DAY') };
      _geoOpenDwellPublish(key, Object.assign({ open }, res));
      await new Promise((k) => setTimeout(k, 60));
      return { before, p: _dayEndPending(), html: document.getElementById('dash-nearby').innerHTML.includes('YOUR DAY'), dwell: window._geoOpenDwell && window._geoOpenDwell.id };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    expect(r.before.p).toBeNull();
    expect(r.before.html).toBe(false);
    expect(r.p).toMatchObject({ kind: 'end', entryId: 9001 });
    expect(r.html).toBe(true);
    expect(r.dwell).toBe('d1');
  });

  test('wired: opening the drive window withdraws the proposal', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(async ({ dwell, res }) => {
      _dayEndOnDwell(dwell, res);
      // A fake TdGeo so the window can open at all; only the hook matters here.
      const Td = { setSampling: () => Promise.resolve({}) };
      const orig = _geoTdPlugin;
      window._geoTdPlugin = () => Td;
      try {
        _geoDriveWindowClose('test');
        _geoDriveWindowOpen('test');
      } finally { window._geoTdPlugin = orig; _geoDriveWindowClose('test'); }
      return { p: _dayEndPending() };
    }, { dwell: homeDwell(d0.HOME), res: dayRes(d0.HOME) });
    expect(r.p).toBeNull();
  });

  test('morning mirror: no clock running, drove from home to the shop: proposes the departure as the clock-in', async () => {
    const dep = START, arr = START + 11 * 60000;
    const r = await page.evaluate(async ({ dep, arr, SHOP_FENCE, HOME_FENCE }) => {
      // A manual-clock user: an entry of theirs three days ago, none today.
      const old = Date.now() - 3 * 86400000;
      timeEntries.push({ id: 8001, job_id: null, date: _geoDayKeyOf(old, _geoBizTz()), start_time: new Date(old).toISOString(), end_time: new Date(old + 3600000).toISOString(), minutes: 60, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false });
      const dwell = { id: 'd2', name: SHOP_FENCE.name, kind: 'shop', sinceTs: arr, fence: SHOP_FENCE };
      const res = { legs: [{ id: 'l0', from: HOME_FENCE, to: SHOP_FENCE, startTs: dep, endTs: arr }], journeys: [] };
      const ret = _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      const p = _dayEndPending();
      const calls = window.__td.calls.filter((c) => c.name === 'schedule').map((c) => c.args);
      goPg('pg-dash'); renderDash();
      const html = document.getElementById('dash-nearby').innerHTML;
      const ok = _dayEndConfirm();
      const e = timeEntries.find((x) => x.open);
      return { ret, p, calls, html, ok, start: e && e.start_time, date: e && e.date, timer: !!_activeTimer, timerEntry: _activeTimer && _activeTimer.entryId === (e && e.id), pending: _dayEndPending() };
    }, { dep, arr, SHOP_FENCE, HOME_FENCE });
    expect(r.ret).toBe('new');
    expect(r.p).toMatchObject({ kind: 'start', startMs: dep, where: SHOP_FENCE.name });
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toMatchObject({ id: 'daystart', title: 'Hey Jack!', body: 'Looks like you started at 7:44 AM. Tap to clock in.', atMs: 0 });
    expect(r.html).toContain('Looks like you started at 7:44 AM');
    expect(r.html).toContain('Clock in from 7:44 AM');
    expect(r.html).toContain('Not today');
    expect(r.ok).toBe(true);
    expect(r.start).toBe(new Date(dep).toISOString());
    expect(r.date).toBe('2026-09-02');
    expect(r.timer).toBe(true);
    expect(r.timerEntry).toBe(true);
    expect(r.pending).toBeNull();
  });

  test('morning mirror: Undo removes the entry it created', async () => {
    const dep = START, arr = START + 11 * 60000;
    const r = await page.evaluate(({ dep, arr, SHOP_FENCE, HOME_FENCE }) => {
      const old = Date.now() - 3 * 86400000;
      timeEntries.push({ id: 8002, job_id: null, date: _geoDayKeyOf(old, _geoBizTz()), start_time: new Date(old).toISOString(), end_time: new Date(old + 3600000).toISOString(), minutes: 60, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false });
      _dayEndOnDwell({ id: 'd2', name: SHOP_FENCE.name, kind: 'shop', sinceTs: arr, fence: SHOP_FENCE }, { legs: [{ from: HOME_FENCE, to: SHOP_FENCE, startTs: dep, endTs: arr }], journeys: [] });
      _dayEndConfirm();
      const n1 = timeEntries.length;
      const undone = _dayEndUndo();
      return { n1, undone, n2: timeEntries.length, timer: !!_activeTimer, anyOpen: timeEntries.some((x) => x.open) };
    }, { dep, arr, SHOP_FENCE, HOME_FENCE });
    expect(r.n1).toBe(2);
    expect(r.undone).toBe(true);
    expect(r.n2).toBe(1);
    expect(r.timer).toBe(false);
    expect(r.anyOpen).toBe(false);
  });

  test('a GPS-only user (no manual entry in two weeks) is never asked to clock in', async () => {
    const dep = START, arr = START + 11 * 60000;
    const r = await page.evaluate(({ dep, arr, SHOP_FENCE, HOME_FENCE }) => {
      const ret = _dayEndOnDwell({ id: 'd2', name: SHOP_FENCE.name, kind: 'shop', sinceTs: arr, fence: SHOP_FENCE }, { legs: [{ from: HOME_FENCE, to: SHOP_FENCE, startTs: dep, endTs: arr }], journeys: [] });
      return { ret, p: _dayEndPending(), calls: window.__td.calls.length };
    }, { dep, arr, SHOP_FENCE, HOME_FENCE });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
    expect(r.calls).toBe(0);
  });

  test('the mirror needs a leg FROM the home office: a drive from the supply house is not a day starting', async () => {
    const dep = START, arr = START + 11 * 60000;
    const r = await page.evaluate(({ dep, arr, SHOP_FENCE }) => {
      const old = Date.now() - 3 * 86400000;
      timeEntries.push({ id: 8003, job_id: null, date: _geoDayKeyOf(old, _geoBizTz()), start_time: new Date(old).toISOString(), end_time: new Date(old + 3600000).toISOString(), minutes: 60, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false });
      const ret = _dayEndOnDwell({ id: 'd2', name: SHOP_FENCE.name, kind: 'shop', sinceTs: arr, fence: SHOP_FENCE }, { legs: [{ from: { id: 'f-sup', kind: 'supply', name: 'Ferguson' }, to: SHOP_FENCE, startTs: dep, endTs: arr }], journeys: [] });
      return { ret, p: _dayEndPending() };
    }, { dep, arr, SHOP_FENCE });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  test('a start proposal dies once any entry exists for the day', async () => {
    const dep = START, arr = START + 11 * 60000;
    const r = await page.evaluate(({ dep, arr, SHOP_FENCE, HOME_FENCE }) => {
      const old = Date.now() - 3 * 86400000;
      timeEntries.push({ id: 8004, job_id: null, date: _geoDayKeyOf(old, _geoBizTz()), start_time: new Date(old).toISOString(), end_time: new Date(old + 3600000).toISOString(), minutes: 60, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false });
      _dayEndOnDwell({ id: 'd2', name: SHOP_FENCE.name, kind: 'shop', sinceTs: arr, fence: SHOP_FENCE }, { legs: [{ from: HOME_FENCE, to: SHOP_FENCE, startTs: dep, endTs: arr }], journeys: [] });
      const p1 = _dayEndPending();
      clockIn(null);
      return { p1, p2: _dayEndPending(), stored: localStorage.getItem('zp3_day_end') };
    }, { dep, arr, SHOP_FENCE, HOME_FENCE });
    expect(r.p1).toMatchObject({ kind: 'start' });
    expect(r.p2).toBeNull();
    expect(r.stored).toBeNull();
  });

  test('null, garbage and corrupt storage never throw', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      out.nullDwell = _dayEndOnDwell(null, null);
      out.noRes = _dayEndOnDwell({ kind: 'home_office', sinceTs: 0 }, undefined);
      out.strDwell = _dayEndOnDwell('home', { legs: [{}] });
      localStorage.setItem('zp3_day_end', '{INVALID JSON{{{{');
      out.corrupt = _dayEndPending();
      localStorage.setItem('zp3_day_end', JSON.stringify({ kind: 'end', entryId: 424242, endMs: 1 }));
      out.ghost = _dayEndPending();
      out.ghostStored = localStorage.getItem('zp3_day_end');
      out.confirmNothing = _dayEndConfirm();
      out.undoNothing = _dayEndUndo();
      out.text = _dayEndCardText(null);
      return out;
    });
    expect(r.nullDwell).toBe(false);
    expect(r.noRes).toBe(false);
    expect(r.strDwell).toBe(false);
    expect(r.corrupt).toBeNull();
    expect(r.ghost).toBeNull();
    expect(r.ghostStored).toBeNull();
    expect(r.confirmNothing).toBe(false);
    expect(r.undoNothing).toBe(false);
    expect(r.text).toBeNull();
  });

  test('crew: a clock that is not mine is not mine to end', async () => {
    const HOME = Date.parse('2026-09-03T00:40:00.000Z');
    const r = await page.evaluate(({ dwell, res, START }) => {
      timeEntries.push({ id: 9002, job_id: null, date: todayKey(), start_time: new Date(START).toISOString(), end_time: null, minutes: null, logged_by_uid: 'someone-else', logged_by_name: 'Other', open: true });
      return { ret: _dayEndOnDwell(dwell, res), p: _dayEndPending() };
    }, { dwell: homeDwell(HOME), res: dayRes(HOME), START });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  // ── The clock that crossed midnight (owner 2026-09-03) ──────────────────
  // Jack's 7:44 AM clock was still open at 7 AM the next day. Owner: "before
  // he has the ability to clock in he needs to clock out and it show his
  // 7:40 pm proposal time, should carry over today."
  // Yesterday is computed on the PAGE's clock so the pin decides the day.
  async function seedStaleClock() {
    return page.evaluate(() => {
      const today = _geoDayKeyOf(Date.now(), _geoBizTz());
      const tb = _geoDayBounds(today);
      const yKey = _geoDayKeyOf(tb.start - 3600000, _geoBizTz());
      const yb = _geoDayBounds(yKey);
      const start = yb.start + (7 * 60 + 44) * 60000, home = yb.start + (19 * 60 + 40) * 60000;
      timeEntries.push({ id: 9101, job_id: null, date: yKey, start_time: new Date(start).toISOString(), end_time: null, minutes: null,
        scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Jack Sample', open: true });
      _rehydrateActiveTimer();
      return { today, yKey, start, home, todayStart: tb.start, timer: !!_activeTimer };
    });
  }

  test('midnight: a clock from yesterday ends at yesterday\'s last arrival home, not today\'s', async () => {
    const d = await seedStaleClock();
    expect(d.timer).toBe(true);
    const r = await page.evaluate(async ({ d, HOME_FENCE, SHOP_FENCE }) => {
      // The boot rebuild derives yesterday: a run to the shop and back.
      const noted = _dayEndNoteDay(d.yKey, { legs: [
        { id: 'y1', from: HOME_FENCE, to: SHOP_FENCE, startTs: d.start + 5 * 60000, endTs: d.start + 20 * 60000 },
        { id: 'y2', from: SHOP_FENCE, to: HOME_FENCE, startTs: d.home - 14 * 60000, endTs: d.home },
      ], journeys: [] });
      await new Promise((k) => setTimeout(k, 60));
      const p = _dayEndPending();
      const calls = window.__td.calls.filter((c) => c.name === 'schedule').map((c) => c.args);
      const text = _dayEndCardText(p);
      return { noted, p, calls, text, arr: JSON.parse(localStorage.getItem('zp3_day_end_arr')) };
    }, { d, HOME_FENCE, SHOP_FENCE });
    expect(r.noted).toBe(true);
    expect(r.p).toMatchObject({ kind: 'end', entryId: 9101, endMs: d.home, stale: true, day: d.yKey, where: HOME_FENCE.name });
    expect(r.arr[d.yKey]).toEqual({ ms: d.home, name: HOME_FENCE.name });
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toMatchObject({ id: 'dayend', title: 'Hey Jack!', body: 'Looks like your day ended at 7:40 PM yesterday. Tap to confirm.', atMs: 0 });
    expect(r.text.title).toBe('Looks like your day ended at 7:40 PM yesterday');
    expect(r.text.yes).toBe('Clock out at 7:40 PM yesterday');
  });

  test('midnight: today\'s drive home does not move the time, and today\'s drive out does not withdraw it', async () => {
    const d = await seedStaleClock();
    const r = await page.evaluate(async ({ d, HOME_FENCE, SHOP_FENCE }) => {
      _dayEndNoteDay(d.yKey, { legs: [{ from: SHOP_FENCE, to: HOME_FENCE, startTs: d.home - 14 * 60000, endTs: d.home }], journeys: [] });
      // This morning: out at 5:34, back at 6:27, the deriver publishes the house as a fresh arrival.
      const back = d.todayStart + (6 * 60 + 27) * 60000;
      const key = _geoDayKeyOf(Date.now(), _geoBizTz());
      const todayRes = { open: { id: 'd9', name: HOME_FENCE.name, kind: 'home_office', sinceTs: back, fence: HOME_FENCE },
        legs: [{ from: HOME_FENCE, to: HOME_FENCE, startTs: d.todayStart + (5 * 60 + 34) * 60000, endTs: back }], journeys: [{ id: 'jt', open: false }] };
      _geoOpenDwellPublish(key, todayRes);
      const p1 = _dayEndPending();
      _dayEndOnDrive();
      _geoOpenDwellPublish(key, { open: null, legs: todayRes.legs, journeys: todayRes.journeys });
      const p2 = _dayEndPending();
      const html = (goPg('pg-dash'), renderDash(), document.getElementById('dash-nearby').innerHTML);
      return { p1, p2, html };
    }, { d, HOME_FENCE, SHOP_FENCE });
    expect(r.p1).toMatchObject({ kind: 'end', endMs: d.home, stale: true });
    expect(r.p2).toMatchObject({ kind: 'end', endMs: d.home, stale: true });
    expect(r.html).toContain('Clock out at 7:40 PM yesterday');
  });

  test('midnight: Yes closes yesterday\'s entry at 7:40 PM with yesterday\'s minutes', async () => {
    const d = await seedStaleClock();
    const r = await page.evaluate(async ({ d, HOME_FENCE, SHOP_FENCE }) => {
      _dayEndNoteDay(d.yKey, { legs: [{ from: SHOP_FENCE, to: HOME_FENCE, startTs: d.home - 14 * 60000, endTs: d.home }], journeys: [] });
      goPg('pg-dash'); renderDash();
      document.getElementById('dash-dayend-yes').click();
      const e = timeEntries.find((x) => x.id === 9101);
      return { open: e.open, end: e.end_time, minutes: e.minutes, date: e.date, timer: !!_activeTimer, pending: _dayEndPending() };
    }, { d, HOME_FENCE, SHOP_FENCE });
    expect(r.open).toBe(false);
    expect(r.end).toBe(new Date(d.home).toISOString());
    expect(r.minutes).toBe(716);
    expect(r.date).toBe(d.yKey);
    expect(r.timer).toBe(false);
    expect(r.pending).toBeNull();
  });

  test('midnight: last night\'s proposal (made before the day rolled) carries over as it is', async () => {
    const d = await seedStaleClock();
    const r = await page.evaluate(({ d, HOME_FENCE }) => {
      localStorage.setItem('zp3_day_end', JSON.stringify({ kind: 'end', entryId: 9101, endMs: d.home, day: d.yKey, madeAt: d.home + 60000, where: HOME_FENCE.name }));
      _dayEndOnDrive();
      const p = _dayEndPending();
      return { p, text: _dayEndCardText(p) };
    }, { d, HOME_FENCE });
    expect(r.p).toMatchObject({ kind: 'end', endMs: d.home });
    expect(r.text.yes).toBe('Clock out at 7:40 PM yesterday');
  });

  test('midnight: no arrival home on record means no guess', async () => {
    const d = await seedStaleClock();
    const r = await page.evaluate(({ d, HOME_FENCE, SHOP_FENCE }) => {
      _dayEndNoteDay(d.yKey, { legs: [{ from: HOME_FENCE, to: SHOP_FENCE, startTs: d.start + 5 * 60000, endTs: d.start + 20 * 60000 }], journeys: [] });
      return { p: _dayEndPending(), calls: window.__td.calls.length, stale: _dayEndStale() };
    }, { d, HOME_FENCE, SHOP_FENCE });
    expect(r.p).toBeNull();
    expect(r.stale).toBe(false);
    expect(r.calls).toBe(0);
  });

  test('midnight: an arrival from BEFORE the clock started is not its end', async () => {
    const d = await seedStaleClock();
    const r = await page.evaluate(({ d, HOME_FENCE, SHOP_FENCE }) => {
      _dayEndNoteDay(d.yKey, { legs: [{ from: SHOP_FENCE, to: HOME_FENCE, startTs: d.start - 60 * 60000, endTs: d.start - 30 * 60000 }], journeys: [] });
      return { p: _dayEndPending() };
    }, { d, HOME_FENCE, SHOP_FENCE });
    expect(r.p).toBeNull();
  });

  test('midnight: a clock started today is never treated as stale', async () => {
    const d0 = await seedOpenClock();
    const r = await page.evaluate(() => {
      const today = _geoDayKeyOf(Date.now(), _geoBizTz());
      const yKey = _geoDayKeyOf(_geoDayBounds(today).start - 3600000, _geoBizTz());
      _dayEndNoteDay(yKey, { legs: [{ from: { kind: 'shop' }, to: { kind: 'home_office', name: 'x' }, startTs: 1, endTs: _geoDayBounds(yKey).start + 70000000 }], journeys: [] });
      return { stale: !!_dayEndStaleEntry(), p: _dayEndPending() };
    });
    expect(r.stale).toBe(false);
    expect(r.p).toBeNull();
  });

  test('midnight: noting a day never throws on junk', async () => {
    const r = await page.evaluate(() => ({ a: _dayEndNoteDay(null, null), b: _dayEndNoteDay('nope', {}), c: _dayEndNoteDay('2026-01-01', { legs: 'x' }), d: (localStorage.setItem('zp3_day_end_arr', '{{bad'), _dayEndStale()) }));
    expect(r.a).toBe(false); expect(r.b).toBe(false); expect(r.c).toBe(false); expect(r.d).toBe(false);
  });
});
