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

// 7:44 AM and 7:40 PM Central on one day, named as instants (CLAUDE.md 5.2.2).
const START = Date.parse('2026-09-02T12:44:00.000Z');
const HOME = Date.parse('2026-09-03T00:40:00.000Z');
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
      if (typeof _activeTimer !== 'undefined' && _activeTimer) { clearInterval(_activeTimer.timerInterval); _activeTimer = null; hideClockBanner(); }
      window._geoOpenDwell = null;
      timeEntries = [];
      _dayEndLast = null;
    }, { START });
  });
  test.afterEach(() => { assertNoErrors(page, 'day end'); });

  // The open manual entry Jack started at home this morning, adopted by the
  // same boot rehydrate the real app uses.
  async function seedOpenClock() {
    return page.evaluate(({ START }) => {
      const row = { id: 9001, job_id: null, date: todayKey(), start_time: new Date(START).toISOString(), end_time: null, minutes: null,
        scope_id: null, scope_label: null, logged_by_uid: null, logged_by_name: 'Jack Sample', open: true };
      timeEntries.push(row);
      _rehydrateActiveTimer();
      return { timer: !!_activeTimer, entryId: _activeTimer && _activeTimer.entryId };
    }, { START });
  }
  const homeDwell = () => ({ id: 'd1', name: HOME_FENCE.name, kind: 'home_office', sinceTs: HOME, fence: HOME_FENCE });
  const dayRes = () => ({ legs: [{ id: 'l1', from: SHOP_FENCE, to: HOME_FENCE, startTs: HOME - 14 * 60000, endTs: HOME }], journeys: [{ id: 'j1', open: false }] });

  test('home office + running clock + a drive today: proposes the arrival as the clock-out and schedules the nudge', async () => {
    const seeded = await seedOpenClock();
    expect(seeded.timer).toBe(true);
    const r = await page.evaluate(async ({ dwell, res, HOME }) => {
      const nowBefore = Date.now();
      const ret = _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      const again = _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      const p = _dayEndPending();
      return { ret, again, p, name: _dayEndFirstName(), calls: window.__td.calls.filter((c) => c.name === 'schedule').map((c) => c.args), nowBefore, now: Date.now(), nine: _dayEndNudgeAt(21), nineKey: _geoDayKeyOf(_dayEndNudgeAt(21), 'America/Chicago'), todayKey: _geoDayKeyOf(Date.now(), 'America/Chicago') };
    }, { dwell: homeDwell(), res: dayRes(), HOME });
    expect(r.ret).toBe('new');
    expect(r.again).toBe(true);              // the same dwell proposes once
    expect(r.name).toBe('Jack');
    expect(r.p).toMatchObject({ kind: 'end', entryId: 9001, endMs: HOME, where: HOME_FENCE.name });
    // One nudge, 20 minutes after the arrival or right now, whichever is later.
    const first = r.calls.find((c) => c.id === 'dayend');
    expect(first).toBeTruthy();
    expect(first.title).toBe('Hey Jack!');
    expect(first.body).toBe('Looks like your day ended at 7:40 PM. Tap to confirm.');
    // Compared against the page's own clock, never the runner's (CLAUDE.md 5.2.2).
    const floor = HOME + 20 * 60000;
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
    await seedOpenClock();
    const r = await page.evaluate(({ dwell }) => ({ ret: _dayEndOnDwell(dwell, { legs: [], journeys: [] }), p: _dayEndPending() }), { dwell: homeDwell() });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  test('no running clock at the home office: nothing to end', async () => {
    const r = await page.evaluate(({ dwell, res }) => ({ ret: _dayEndOnDwell(dwell, res), p: _dayEndPending() }), { dwell: homeDwell(), res: dayRes() });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });

  test('the truck moves again: the proposal is withdrawn and the nudges cancelled', async () => {
    await seedOpenClock();
    const r = await page.evaluate(async ({ dwell, res }) => {
      _dayEndOnDwell(dwell, res);
      await new Promise((k) => setTimeout(k, 60));
      window.__td.calls.length = 0;
      _dayEndOnDrive();
      await new Promise((k) => setTimeout(k, 60));
      return { p: _dayEndPending(), cancel: window.__td.calls.filter((c) => c.name === 'cancel').map((c) => c.args) };
    }, { dwell: homeDwell(), res: dayRes() });
    expect(r.p).toBeNull();
    expect(r.cancel.length).toBe(1);
    expect(r.cancel[0].ids).toEqual(['dayend', 'dayend2']);
  });

  test('confirm closes the entry AT the arrival, not at the tap; Undo puts it back open', async () => {
    await seedOpenClock();
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
    }, { dwell: homeDwell(), res: dayRes(), HOME, START });
    expect(r.after.ok).toBe(true);
    expect(r.after.open).toBe(false);
    expect(r.after.end).toBe(new Date(HOME).toISOString());
    expect(r.after.minutes).toBe(Math.round((HOME - START) / 60000));
    expect(r.after.timer).toBe(false);
    expect(r.after.pending).toBeNull();
    expect(r.after.stored).toBeNull();
    expect(r.after.toast).toBe(true);
    expect(r.after.cancel[0].ids).toEqual(['dayend', 'dayend2']);
    expect(r.undone).toBe(true);
    expect(r.open2).toBe(true);
    expect(r.end2).toBeNull();
    expect(r.min2).toBeNull();
    expect(r.timer2).toBe(true);
    expect(r.timerEntry).toBe(9001);
  });

  test('a proposal dies with its entry: closed by hand means nothing left to answer', async () => {
    await seedOpenClock();
    const r = await page.evaluate(({ dwell, res }) => {
      _dayEndOnDwell(dwell, res);
      clockOut(true, true);
      return { p: _dayEndPending(), stored: localStorage.getItem('zp3_day_end') };
    }, { dwell: homeDwell(), res: dayRes() });
    expect(r.p).toBeNull();
    expect(r.stored).toBeNull();
  });

  test('the Home card carries the copy and the two answers; "Still working" dismisses', async () => {
    await seedOpenClock();
    await page.evaluate(({ dwell, res }) => { _dayEndOnDwell(dwell, res); goPg('pg-dash'); renderDash(); }, { dwell: homeDwell(), res: dayRes() });
    const card = page.locator('#dash-nearby');
    await expect(card).toContainText('YOUR DAY');
    await expect(card).toContainText('Looks like your day ended at 7:40 PM');
    await expect(card).toContainText('Back at ' + HOME_FENCE.name);
    await expect(page.locator('#dash-dayend-yes')).toHaveText('Clock out at 7:40 PM');
    await expect(page.locator('#dash-dayend-no')).toHaveText('Still working');
    // Only one primary action on the card (CLAUDE.md 15.1).
    expect(await card.locator('button').count()).toBe(2);
    await page.locator('#dash-dayend-no').click();
    const r = await page.evaluate(() => ({ p: _dayEndPending(), timer: !!_activeTimer, html: document.getElementById('dash-nearby').innerHTML }));
    expect(r.p).toBeNull();
    expect(r.timer).toBe(true);               // dismiss never touches the clock
    expect(r.html).not.toContain('YOUR DAY');
    expect(r.html).toContain('Clock out');    // the normal on-the-clock card is back
  });

  test('tapping Yes on the card clocks out at the arrival time', async () => {
    await seedOpenClock();
    await page.evaluate(({ dwell, res }) => { _dayEndOnDwell(dwell, res); goPg('pg-dash'); renderDash(); }, { dwell: homeDwell(), res: dayRes() });
    await page.locator('#dash-dayend-yes').click();
    const r = await page.evaluate(({ HOME }) => { const e = timeEntries.find((x) => x.id === 9001); return { open: e.open, end: e.end_time, timer: !!_activeTimer, html: document.getElementById('dash-nearby').innerHTML }; }, { HOME });
    expect(r.open).toBe(false);
    expect(r.end).toBe(new Date(HOME).toISOString());
    expect(r.timer).toBe(false);
    expect(r.html).not.toContain('YOUR DAY');
  });

  test('wired: the deriver publish reaches the proposal, and repaints the card on a same-dwell publish', async () => {
    await seedOpenClock();
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
    }, { dwell: homeDwell(), res: dayRes() });
    expect(r.before.p).toBeNull();
    expect(r.before.html).toBe(false);
    expect(r.p).toMatchObject({ kind: 'end', entryId: 9001 });
    expect(r.html).toBe(true);
    expect(r.dwell).toBe('d1');
  });

  test('wired: opening the drive window withdraws the proposal', async () => {
    await seedOpenClock();
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
    }, { dwell: homeDwell(), res: dayRes() });
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
    const r = await page.evaluate(({ dwell, res, START }) => {
      timeEntries.push({ id: 9002, job_id: null, date: todayKey(), start_time: new Date(START).toISOString(), end_time: null, minutes: null, logged_by_uid: 'someone-else', logged_by_name: 'Other', open: true });
      return { ret: _dayEndOnDwell(dwell, res), p: _dayEndPending() };
    }, { dwell: homeDwell(), res: dayRes(), START });
    expect(r.ret).toBe(false);
    expect(r.p).toBeNull();
  });
});
