// @ts-check
// ── Water heater flush board (owner 2026-09-25) ──────────────────────────────
// A rolling 11-month board at the top of the dashboard: who had a water heater
// put in (or flushed) 11+ months ago, a Text button, and the two answers the
// customer gives: "schedule it" or "I'll do it myself".
//
// The rules these tests defend:
//   - The board is DERIVED from equipment rows. A flush job that gets canceled
//     stops counting and the customer comes back on their own.
//   - "Schedule" opens the real scheduler, and the job it books is linked to
//     the client even though no proposal is behind it.
//   - "Doing it themselves" restarts the 11-month clock, it never deletes
//     anybody, and it can be undone.
//   - "No answer yet" rolls the customer to the 1st of next month.
//   - The row is iOS-shaped: one Text button, tap the row to record the
//     answer, swipe for the same answers in one motion.
//   - The owner's old books get in three ways: won proposals, quick add, and
//     picking an existing client.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Water heater flush board', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // A clean slate plus three customers: one due (12 months), one not yet
  // (3 months), and one with no install date at all. Dates are built off the
  // page's own today so the pinned clock and the fixture always agree (§5.2.2).
  const seed = () => page.evaluate(() => {
    document.getElementById('_wh-add-ov')?.remove();
    document.getElementById('_wh-text-ov')?.remove();
    equipment.length = 0;
    clients.length = 0;
    jobs.length = 0;
    bids.length = 0;
    S.whFlushMsg = undefined;
    S.whSkippedBids = [];
    window._schedPrefill = null;
    const tk = todayKey();
    clients.push({ id: 501, name: 'Dana Due', phone: '5551112222', addr: '1 Oak St' });
    clients.push({ id: 502, name: 'Lee Later', phone: '5553334444', addr: '2 Elm St' });
    clients.push({ id: 503, name: 'Nia Nodate', phone: '', addr: '' });
    saveEquipment({ clientId: 501, kind: 'Water heater', installed: _whAddMonths(tk, -12) });
    saveEquipment({ clientId: 502, kind: 'Water heater', installed: _whAddMonths(tk, -3) });
    saveEquipment({ clientId: 503, kind: 'Water heater', installed: '' });
    saveEquipment({ clientId: 502, kind: 'Furnace', installed: '2010' });
    _renderWhBoard();
    return tk;
  });
  const boardNames = () => page.evaluate(() =>
    [...document.querySelectorAll('#dash-wh-board .td-wh-row .td-wh-name')].map(b => b.textContent));

  test('dates: every shape a plate or a memory gives, and nonsense refused', async () => {
    const r = await page.evaluate(() => ({
      iso: _whParseDate('2025-10-04'),
      us: _whParseDate('10/4/2025'),
      short: _whParseDate('10/4/25'),
      month: _whParseDate('03/2018'),
      year: _whParseDate('2018'),
      empty: _whParseDate(''),
      nul: _whParseDate(null),
      junk: _whParseDate('last spring'),
      badMonth: _whParseDate('2025-13-01'),
      jan31: _whAddMonths('2025-01-31', 1),
      back: _whAddMonths('2025-03-15', -12),
      cycle: _whAddMonths('2024-11-10', 11),
    }));
    expect(r.iso).toBe('2025-10-04');
    expect(r.us).toBe('2025-10-04');
    expect(r.short).toBe('2025-10-04');
    expect(r.month, 'a bare month is the 1st').toBe('2018-03-01');
    expect(r.year, 'a bare year is Jan 1, which errs toward due sooner').toBe('2018-01-01');
    expect(r.empty).toBe(null);
    expect(r.nul).toBe(null);
    expect(r.junk).toBe(null);
    expect(r.badMonth).toBe(null);
    expect(r.jan31, 'month math never spills into the next month').toBe('2025-02-28');
    expect(r.back).toBe('2024-03-15');
    expect(r.cycle).toBe('2025-10-10');
  });

  test('the board shows only who is due, never other equipment, and counts the rest', async () => {
    await seed();
    expect(await boardNames()).toEqual(['Dana Due']);
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-wh-board');
      return {
        shown: el.style.display,
        count: el.querySelector('.td-wh-count')?.textContent,
        foot: el.querySelector('.td-wh-foot')?.textContent || '',
        texts: [...el.querySelectorAll('.td-wh-row .btn')].map(b => b.textContent.trim()),
      };
    });
    expect(r.shown).toBe('block');
    expect(r.count).toBe('1');
    expect(r.foot, 'the next customer coming due is named').toContain('Lee Later');
    expect(r.foot, 'a unit with no date is counted, never silently dropped').toContain('1 water heater has no install date');
    expect(r.texts, 'one button on the row, the one you use first').toEqual(['Text']);
  });

  test('money numbers first: the board sits right under the money tiles', async () => {
    const r = await page.evaluate(() => {
      const b = document.getElementById('dash-wh-board');
      const kpi = document.getElementById('dash-kpi');
      const alerts = document.querySelector('#dash-widget-root .td-dw[data-dw="alerts"]');
      const follows = (x, y) => !!(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { afterTiles: follows(kpi, b), beforeNext: follows(b, alerts), inKpi: !!b.closest('.td-dw[data-dw="kpi"]') };
    });
    expect(r.afterTiles).toBe(true);
    expect(r.beforeNext).toBe(true);
    expect(r.inKpi, 'rides the tiles widget so a widget reorder can never separate them').toBe(true);
  });

  test('doing it themselves restarts the clock: gone now, back in 11 months', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const e = equipment.find(x => x.clientId === 501);
      whMarkDiy(e.id);
      const last = _whLastService(e);
      return { last, due: _whDueKey(e), tk: todayKey(), still: equipment.some(x => x.clientId === 501) };
    });
    expect(await boardNames()).toEqual([]);
    expect(r.last.how).toBe('diy');
    expect(r.last.date).toBe(r.tk);
    expect(r.due).toBe(await page.evaluate(tk => _whAddMonths(tk, 11), r.tk));
    expect(r.still, 'the customer is never deleted').toBe(true);
  });

  test('schedule opens the real scheduler prefilled and books a job linked to the client', async () => {
    await seed();
    await page.evaluate(() => whScheduleFlush(equipment.find(x => x.clientId === 501).id));
    await page.waitForFunction(() => window._schedPrefill && document.getElementById('s-name').value.includes('flush'));
    const pre = await page.evaluate(() => ({
      name: document.getElementById('s-name').value,
      addr: document.getElementById('s-addr').value,
      start: document.getElementById('s-start').value,
      jobTab: document.getElementById('sched-tab-job').classList.contains('active'),
    }));
    expect(pre.name).toBe('Dana Due, water heater flush');
    expect(pre.addr).toBe('1 Oak St');
    expect(pre.start).toBeTruthy();
    expect(pre.jobTab).toBe(true);
    const r = await page.evaluate(() => {
      scheduleJob();
      const j = jobs[jobs.length - 1];
      const e = equipment.find(x => x.clientId === 501);
      _renderWhBoard();
      return { client: j && j.client_id, bid: j && j.bid_id, logged: (e.flushLog || []).map(f => ({ how: f.how, jobId: f.jobId })), jobId: j && j.id, prefill: window._schedPrefill };
    });
    expect(r.client, 'a flush job with no proposal still belongs to its client').toBe(501);
    expect(r.bid).toBe(null);
    expect(r.logged).toEqual([{ how: 'us', jobId: r.jobId }]);
    expect(r.prefill, 'the prefill never leaks into the next booking').toBe(null);
    expect(await boardNames()).toEqual([]);

    // Canceling the flush job puts the customer straight back on the board.
    await page.evaluate(jobId => { jobs.find(j => j.id === jobId).status = 'canceled'; _renderWhBoard(); }, r.jobId);
    expect(await boardNames()).toEqual(['Dana Due']);
  });

  test('switching the scheduler tab drops the prefill, so a normal job is never mislinked', async () => {
    await seed();
    await page.evaluate(() => whScheduleFlush(equipment.find(x => x.clientId === 501).id));
    await page.waitForFunction(() => !!window._schedPrefill);
    const r = await page.evaluate(() => { setSchedType('estimate'); return window._schedPrefill; });
    expect(r).toBe(null);
    await page.evaluate(() => { setSchedType('job'); goPg('pg-dash'); });
  });

  test('text: writes once, saves for reuse, fills the first name, stamps the row', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const urls = [];
      window._whOpenSms = u => urls.push(u);
      const e = equipment.find(x => x.clientId === 501);
      whTextFlush(e.id);
      const first = document.getElementById('_wh-msg').value;
      const boxChecked = document.getElementById('_wh-save').checked;
      document.getElementById('_wh-msg').value = 'Hi {name}, flush time. Want us out?';
      document.getElementById('_wh-send').click();
      const saved = S.whFlushMsg;
      whTextFlush(e.id);
      const second = document.getElementById('_wh-msg').value;
      document.getElementById('_wh-text-ov')?.remove();
      return { first, boxChecked, saved, second, urls, texted: !!e.whTextedAt, chip: !!document.querySelector('#dash-wh-board .td-wh-chip') };
    });
    expect(r.first, 'nothing is written for them the first time').toBe('');
    expect(r.boxChecked, 'reuse is on by default the first time').toBe(true);
    expect(r.saved).toBe('Hi {name}, flush time. Want us out?');
    expect(r.second, 'the next text starts from their saved message').toBe('Hi {name}, flush time. Want us out?');
    expect(r.urls).toEqual(['sms:5551112222&body=' + encodeURIComponent('Hi Dana, flush time. Want us out?')]);
    expect(r.texted).toBe(true);
    expect(r.chip, 'the row shows it was texted').toBe(true);
  });

  test('text: an empty message sends nothing, and no phone means no text', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const urls = [];
      window._whOpenSms = u => urls.push(u);
      const e = equipment.find(x => x.clientId === 501);
      whTextFlush(e.id);
      document.getElementById('_wh-send').click();
      const stillOpen = !!document.getElementById('_wh-text-ov');
      document.getElementById('_wh-text-ov')?.remove();
      whTextFlush(equipment.find(x => x.clientId === 503).id);
      const noPhoneModal = !!document.getElementById('_wh-text-ov');
      whTextFlush('nope');
      return { urls, stillOpen, noPhoneModal, texted: !!e.whTextedAt };
    });
    expect(r.urls).toEqual([]);
    expect(r.stillOpen).toBe(true);
    expect(r.texted).toBe(false);
    expect(r.noPhoneModal).toBe(false);
  });

  test('won proposals that mention a water heater are offered, added in one tap, or skipped', async () => {
    await seed();
    const r = await page.evaluate(() => {
      equipment.length = 0;
      const tk = todayKey();
      const old = _whAddMonths(tk, -14);
      bids.push({ id: 9001, client_id: 501, status: 'Closed Won', signedAt: old + 'T15:00:00Z', lineItems: [{ desc: '50 gal Water Heater install' }] });
      bids.push({ id: 9002, client_id: 502, status: 'Closed Won', signedAt: old, notes: 'Repaint kitchen' });
      bids.push({ id: 9003, client_id: 503, status: 'Pending', signedAt: old, notes: 'water heater' });
      _renderWhBoard();
      const offered = document.querySelector('#dash-wh-board .td-wh-find')?.textContent || '';
      const finds = _whProposalFinds().map(f => ({ c: f.clientId, d: f.date }));
      whAddFromProposals();
      const added = equipment.filter(e => e.kind === 'Water heater').map(e => ({ c: e.clientId, d: e.installed, src: e.source, bid: e.bidId }));
      const offeredAfter = _whProposalFinds().length;
      return { offered, finds, added, offeredAfter, old };
    });
    expect(r.offered).toContain('Found 1 water heater install');
    expect(r.finds, 'only WON proposals that name a water heater').toEqual([{ c: 501, d: r.old }]);
    expect(r.added).toEqual([{ c: 501, d: r.old, src: 'proposal', bid: 9001 }]);
    expect(r.offeredAfter, 'once on the board it is never offered again').toBe(0);
    expect(await boardNames()).toEqual(['Dana Due']);

    const s = await page.evaluate(() => {
      equipment.length = 0;
      whSkipProposals();
      return { left: _whProposalFinds().length, skipped: S.whSkippedBids };
    });
    expect(s.left, '"Not these" stops the offer').toBe(0);
    expect(s.skipped).toEqual([9001]);
  });

  test('the install date comes from the job that did the work when there is one', async () => {
    await seed();
    const r = await page.evaluate(() => {
      equipment.length = 0;
      bids.push({ id: 9101, client_id: 501, status: 'Closed Won', signedAt: '2024-01-05', notes: 'Water heater swap' });
      jobs.push({ id: 7001, bid_id: 9101, client_id: 501, eventType: 'job', start: '2024-02-20', status: 'done' });
      return _whProposalFinds()[0].date;
    });
    expect(r).toBe('2024-02-20');
  });

  test('quick add: a new customer goes in with name, phone and date, and the form stays open', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const before = clients.length;
      openWhAdd();
      document.getElementById('_wh-add-save').click();
      const errNoDate = document.getElementById('_wh-err').textContent;
      const tk = todayKey();
      document.getElementById('_wh-date').value = _whAddMonths(tk, -11);
      document.getElementById('_wh-add-save').click();
      const errNoName = document.getElementById('_wh-err').textContent;
      document.getElementById('_wh-name').value = 'Pat Newby';
      document.getElementById('_wh-phone').value = '555-000-1111';
      document.getElementById('_wh-date').value = _whAddMonths(tk, -11);
      document.getElementById('_wh-add-save').click();
      const c = clients.find(x => x.name === 'Pat Newby');
      const e = c && equipment.find(x => String(x.clientId) === String(c.id));
      const reopened = !!document.getElementById('_wh-add-ov') && document.getElementById('_wh-name').value === '';
      document.getElementById('_wh-add-done').click();
      return { errNoDate, errNoName, added: clients.length - before, phone: c && c.phone, kind: e && e.kind, installed: e && e.installed, src: e && e.source, reopened, closed: !document.getElementById('_wh-add-ov'), exp: _whAddMonths(tk, -11) };
    });
    expect(r.errNoDate).toBe('Pick the install date.');
    expect(r.errNoName).toBe('Enter a name.');
    expect(r.added).toBe(1);
    expect(r.phone).toBe('555-000-1111');
    expect(r.kind).toBe('Water heater');
    expect(r.installed).toBe(r.exp);
    expect(r.src).toBe('manual');
    expect(r.reopened, 'ready for the next one right away').toBe(true);
    expect(r.closed).toBe(true);
    expect(await boardNames()).toContain('Pat Newby');
  });

  test('quick add: picking an existing client adds no duplicate client, and a future date is refused', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const before = clients.length;
      const eqBefore = equipment.length;
      openWhAdd('client');
      const hasPicker = !!document.getElementById('_wh-client');
      document.getElementById('_wh-client').value = '502';
      document.getElementById('_wh-date').value = _whAddMonths(todayKey(), 2);
      document.getElementById('_wh-add-save').click();
      const errFuture = document.getElementById('_wh-err').textContent;
      document.getElementById('_wh-date').value = _whAddMonths(todayKey(), -13);
      document.getElementById('_wh-add-save').click();
      document.getElementById('_wh-add-done').click();
      return { hasPicker, errFuture, clientsAdded: clients.length - before, eqAdded: equipment.length - eqBefore };
    });
    expect(r.hasPicker).toBe(true);
    expect(r.errFuture).toBe('The install date is in the future.');
    expect(r.clientsAdded).toBe(0);
    expect(r.eqAdded).toBe(1);
    // 13 months ago is more overdue than Dana's 12, so it sorts first.
    expect(await boardNames()).toEqual(['Lee Later', 'Dana Due']);
  });

  test('hidden for crew, and for a non-plumber with no water heaters anywhere', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const wasEmp = window._isEmployee;
      window._isEmployee = true;
      _renderWhBoard();
      const crew = document.getElementById('dash-wh-board').style.display;
      window._isEmployee = wasEmp;
      equipment.length = 0;
      bids.length = 0;
      const plumber = typeof getActiveTrade === 'function' && getActiveTrade() === 'plumbing';
      _renderWhBoard();
      return { crew, empty: document.getElementById('dash-wh-board').style.display, plumber };
    });
    expect(r.crew).toBe('none');
    expect(r.empty).toBe(r.plumber ? 'block' : 'none');
  });

  test('bad input never throws', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      const tryIt = (n, f) => { try { f(); out.push(n + ':ok'); } catch (e) { out.push(n + ':' + e.message); } };
      tryIt('diy-missing', () => whMarkDiy('nope'));
      tryIt('sched-missing', () => whScheduleFlush(undefined));
      tryIt('booked-missing', () => whFlushBooked('nope', null));
      tryIt('last-null', () => _whLastService(null));
      tryIt('due-junk', () => _whDueKey({ installed: 'soon', flushLog: 'x' }));
      tryIt('bid-null', () => _whBidMentions(null));
      tryIt('fill-null', () => _whFillMsg(null, null));
      tryIt('render-x10', () => { for (let i = 0; i < 10; i++) _renderWhBoard(); });
      const el = document.getElementById('dash-wh-board');
      el.remove();
      tryIt('render-no-dom', () => _renderWhBoard());
      document.getElementById('dash-widget-root').before(el);
      return out;
    });
    expect(r.every(x => x.endsWith(':ok'))).toBe(true);
  });

  test('undo puts them straight back, and only undoes that one answer', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const e = equipment.find(x => x.clientId === 501);
      e.flushLog = [{ date: '2020-01-01', how: 'diy', at: 'old' }];
      whMarkDiy(e.id);
      const at = e.flushLog[e.flushLog.length - 1].at;
      const gone = [...document.querySelectorAll('#dash-wh-board .td-wh-name')].length;
      const hasUndo = !!document.querySelector('.toast .td-wh-undo');
      const ok = whUndoDiy(e.id, at);
      const again = whUndoDiy(e.id, at);
      document.querySelectorAll('.toast').forEach(t => t.remove());
      return { gone, hasUndo, ok, again, log: e.flushLog.map(f => f.at) };
    });
    expect(r.gone).toBe(0);
    expect(r.hasUndo).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.again, 'a second undo does nothing').toBe(false);
    expect(r.log, 'older history is untouched').toEqual(['old']);
    expect(await boardNames()).toEqual(['Dana Due']);
  });

  test('tapping the row asks "What did Dana say?" and each answer does its job', async () => {
    await seed();
    await page.evaluate(() => goPg('pg-dash'));
    // A DOM click, so the boot shimmer still covering the dashboard on a slow
    // engine cannot hold the tap hostage. What is under test is the row's own
    // handler, not the shimmer.
    await page.evaluate(() => document.querySelector('#dash-wh-board .td-wh-row .td-wh-name').click());
    const r = await page.evaluate(() => ({
      title: document.querySelector('#_wh-ask-ov .zmodal-title')?.textContent,
      btns: [...document.querySelectorAll('#_wh-ask-ov button')].map(b => b.textContent.trim()),
    }));
    expect(r.title).toBe('What did Dana say?');
    expect(r.btns).toEqual(['Schedule it', 'Doing it themselves', 'No answer yet', 'Open customer']);
    await page.evaluate(() => document.getElementById('_wh-ask-diy').click());
    expect(await page.evaluate(() => !document.getElementById('_wh-ask-ov'))).toBe(true);
    expect(await boardNames()).toEqual([]);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  });

  test('the Text button texts, it does not open the question', async () => {
    await seed();
    await page.evaluate(() => { window._whOpenSms = () => {}; goPg('pg-dash'); });
    await page.evaluate(() => document.querySelector('#dash-wh-board .td-wh-txt').click());
    const r = await page.evaluate(() => ({ ask: !!document.getElementById('_wh-ask-ov'), text: !!document.getElementById('_wh-text-ov') }));
    expect(r.ask).toBe(false);
    expect(r.text).toBe(true);
    await page.evaluate(() => document.getElementById('_wh-text-ov')?.remove());
  });

  test('no answer yet rolls them to the 1st of next month, then they come back marked', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const e = equipment.find(x => x.clientId === 501);
      const tk = todayKey();
      whRollOver(e.id);
      const until = e.whSnoozeUntil;
      const hiddenNow = [...document.querySelectorAll('#dash-wh-board .td-wh-name')].map(n => n.textContent);
      const foot = document.querySelector('#dash-wh-board .td-wh-foot')?.textContent || '';
      // Next month arrives: the snooze has passed.
      e.whSnoozeUntil = tk;
      _renderWhBoard();
      const back = [...document.querySelectorAll('#dash-wh-board .td-wh-name')].map(n => n.textContent);
      const chip = document.querySelector('#dash-wh-board .td-wh-chip-roll')?.textContent;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const [y, m] = tk.split('-').map(Number);
      const exp = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
      return { until, exp, hiddenNow, foot, back, chip };
    });
    expect(r.until).toBe(r.exp);
    expect(r.hiddenNow).toEqual([]);
    expect(r.foot).toContain('1 rolled to next month');
    expect(r.back).toEqual(['Dana Due']);
    expect(r.chip).toBe('Rolled over');
  });

  test('a rollover or a text from last year never follows them into this year', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const e = equipment.find(x => x.clientId === 501);
      const old = new Date(Date.now() - 400 * 86400000).toISOString();
      e.whTextedAt = old;
      e.whSnoozedAt = old;
      e.whSnoozeUntil = '2099-01-01';
      _renderWhBoard();
      return {
        names: [...document.querySelectorAll('#dash-wh-board .td-wh-name')].map(n => n.textContent),
        chips: document.querySelectorAll('#dash-wh-board .td-wh-chip').length,
      };
    });
    expect(r.names, 'a stale snooze cannot hide this year').toEqual(['Dana Due']);
    expect(r.chips).toBe(0);
  });

  test('swipe right schedules, swipe left marks doing it themselves, a short swipe does nothing', async () => {
    await seed();
    await page.evaluate(() => goPg('pg-dash'));
    const swipe = (dx) => page.evaluate((dx) => {
      const row = document.querySelector('#dash-wh-board .td-wh-row');
      const r = row.getBoundingClientRect();
      const y = r.top + r.height / 2, x = r.left + r.width / 2;
      // Desktop WebKit has no Touch constructor, so build plain events that
      // carry a touches list, which is all the handlers read.
      const fire = (type, cx) => {
        const ev = new Event(type, { bubbles: true });
        Object.defineProperty(ev, 'touches', { value: cx == null ? [] : [{ clientX: cx, clientY: y }] });
        row.dispatchEvent(ev);
      };
      fire('touchstart', x);
      fire('touchmove', x + dx / 2);
      fire('touchmove', x + dx);
      fire('touchend', null);
    }, dx);
    await swipe(40);
    expect(await boardNames(), 'a short swipe springs back').toEqual(['Dana Due']);
    await swipe(-250);
    expect(await boardNames()).toEqual([]);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await seed();
    await page.evaluate(() => goPg('pg-dash'));
    await swipe(250);
    await page.waitForFunction(() => window._schedPrefill && document.getElementById('s-name').value.includes('flush'));
    expect(await page.evaluate(() => document.getElementById('s-name').value)).toBe('Dana Due, water heater flush');
    await page.evaluate(() => { setSchedType('job'); goPg('pg-dash'); });
  });

  test('master list: every water heater, grouped by what happens next, searchable', async () => {
    await seed();
    const r = await page.evaluate(async () => {
      const tk = todayKey();
      clients.push({ id: 504, name: 'Sam Scheduled', phone: '5557778888', addr: '9 Birch Ln' });
      clients.push({ id: 505, name: 'Rae Rolled', phone: '5556667777', addr: '' });
      clients.push({ id: 506, name: 'Dee Diy', phone: '', addr: '' });
      const s = saveEquipment({ clientId: 504, kind: 'Water heater', installed: _whAddMonths(tk, -12) });
      jobs.push({ id: 8801, client_id: 504, eventType: 'job', start: _whAddMonths(tk, 1), status: 'upcoming' });
      s.flushLog = [{ date: _whAddMonths(tk, 1), how: 'us', jobId: 8801 }];
      const ro = saveEquipment({ clientId: 505, kind: 'Water heater', installed: _whAddMonths(tk, -12) });
      whRollOver(ro.id);
      const d = saveEquipment({ clientId: 506, kind: 'Water heater', installed: _whAddMonths(tk, -12) });
      whMarkDiy(d.id);
      document.querySelectorAll('.toast').forEach(t => t.remove());
      goPg('pg-wh-list');
      const read = () => [...document.querySelectorAll('#wh-list-body .td-wh-list-cap')].map(c => c.textContent);
      const names = () => [...document.querySelectorAll('#wh-list-body .td-wh-name')].map(n => n.textContent);
      const subs = () => Object.fromEntries([...document.querySelectorAll('#wh-list-body .td-wh-list-row')].map(r => [r.querySelector('.td-wh-name').textContent, r.querySelector('.td-wh-sub').textContent]));
      const caps = read(), all = names(), sub = subs();
      _whListQuery = 'birch'; renderWhList();
      const byAddr = names();
      _whListQuery = 'zzz'; renderWhList();
      const none = document.querySelector('#wh-list-body .td-wh-list-empty')?.textContent;
      _whListQuery = ''; renderWhList();
      return { caps, all, sub, byAddr, none, active: document.getElementById('pg-wh-list').classList.contains('active') };
    });
    expect(r.active).toBe(true);
    expect(r.caps).toEqual(['Due now · 1', 'Rolled to next month · 1', 'Set for the year · 3', 'No install date · 1']);
    expect(r.all).toContain('Dana Due');
    expect(r.all).toContain('Nia Nodate');
    expect(r.all.filter(n => n === 'Lee Later').length, 'furnaces never show, only water heaters').toBe(1);
    expect(r.sub['Sam Scheduled']).toMatch(/^Flush scheduled /);
    expect(r.sub['Dee Diy']).toMatch(/^Doing it themselves, /);
    expect(r.byAddr, 'search reaches the address too').toEqual(['Sam Scheduled']);
    expect(r.none).toBe('Nobody matches that search.');
    await page.evaluate(() => goPg('pg-dash'));
  });

  test('master list: the board header and See all open it; crew are kept out', async () => {
    await seed();
    const r = await page.evaluate(() => {
      goPg('pg-dash'); _renderWhBoard();
      const all = document.querySelector('#dash-wh-board .td-wh-all');
      const label = all && all.textContent;
      all.click();
      const viaAll = document.getElementById('pg-wh-list').classList.contains('active');
      goPg('pg-dash'); _renderWhBoard();
      document.querySelector('#dash-wh-board .td-wh-hd-txt').click();
      const viaHeader = document.getElementById('pg-wh-list').classList.contains('active');
      const was = window._isEmployee; window._isEmployee = true;
      goPg('pg-wh-list');
      const crewLanded = document.querySelector('.pg.active').id;
      window._isEmployee = was; goPg('pg-dash');
      return { label, viaAll, viaHeader, crewLanded };
    });
    expect(r.label).toBe('See all 3');
    expect(r.viaAll).toBe(true);
    expect(r.viaHeader).toBe(true);
    expect(r.crewLanded).toBe('pg-dash');
  });

  test('master list: layout holds on a phone with a long name', async () => {
    await seed();
    const r = await page.evaluate(() => {
      clients.find(c => c.id === 501).name = 'Bartholomew Maximilian Worthington-Smythe III';
      goPg('pg-wh-list');
      const row = document.querySelector('#wh-list-body .td-wh-list-row');
      const nm = row.querySelector('.td-wh-name').getBoundingClientRect();
      const rt = row.querySelector('.td-wh-list-r').getBoundingClientRect();
      const out = { sw: document.documentElement.scrollWidth, iw: innerWidth, clear: nm.right <= rt.left + 1 };
      goPg('pg-dash');
      return out;
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.clear).toBe(true);
  });

  test('add form: the install date has a real tap target, and the whole row opens it', async () => {
    const r = await page.evaluate(() => {
      openWhAdd();
      const d = document.getElementById('_wh-date');
      const h = d.getBoundingClientRect().height;
      const row = d.closest('.sf-row');
      const isLabel = row && row.tagName === 'LABEL';
      row.querySelector('.sf-lbl').click();
      const focused = document.activeElement === d;
      document.getElementById('_wh-add-ov')?.remove();
      return { h, isLabel, focused };
    });
    expect(r.h, 'an empty date on iPhone collapsed to nothing to tap').toBeGreaterThanOrEqual(24);
    expect(r.isLabel).toBe(true);
    expect(r.focused, 'tapping the row label lands in the date').toBe(true);
  });

  test('layout: nothing bleeds off a phone screen', async () => {
    await seed();
    await page.evaluate(() => { goPg('pg-dash'); clients.find(c => c.id === 501).name = 'Bartholomew Maximilian Worthington-Smythe III'; _renderWhBoard(); });
    const r = await page.evaluate(() => {
      const card = document.querySelector('#dash-wh-board .td-wh-card');
      const btns = [...card.querySelectorAll('.td-wh-row .btn')].map(b => b.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i], b = btns[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
      }
      const nm = card.querySelector('.td-wh-name').getBoundingClientRect();
      const tb = card.querySelector('.td-wh-txt').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: card.getBoundingClientRect().right, overlap, nameClear: nm.right <= tb.left };
    });
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.right).toBeLessThanOrEqual(r.iw);
    expect(r.overlap).toBe(false);
    expect(r.nameClear, 'a long name truncates before the Text button').toBe(true);
  });

  test('no console errors during water heater board tests', async () => {
    assertNoErrors(page, 'wh-board');
  });
});
