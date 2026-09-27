// @ts-check
// ── Service due: every recurring service, on its own interval ────────────────
// Owner 2026-09-27: "annual service needs ability to set your own service
// interval like 3 month 6 month for different jobs other then heaters, could
// be water filters gutter cleaning irrigation drain down heater flushes etc".
//
// The rules these tests defend:
//   - One board for every service (js/wh-board.js), each row labelled with its
//     service and sorted by when it comes due. Not a second board per service.
//   - Each service has a default interval the contractor can change in one
//     place; a customer can have their own, and theirs wins.
//   - Water heaters logged before this change read as heater flushes with no
//     migration, and show on exactly the same day they always did (a month
//     before the year is up). Every other service shows when it is due.
//   - Schedule, "Doing it themselves", "No answer yet" and Undo work for
//     every service the way they always worked for heaters.
//   - Each service has its own text, and the heater's stays on S.whFlushMsg.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Service due: recurring service intervals', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // A clean slate: no equipment, the built-in defaults, a known trade, and a
  // few customers. Dates are built off the page's own today (§5.2.2).
  const seed = (trade) => page.evaluate((trade) => {
    ['_wh-add-ov', '_wh-text-ov', '_wh-ask-ov', '_svc-types-ov', '_svc-every-ov'].forEach(id => document.getElementById(id)?.remove());
    document.querySelectorAll('.toast').forEach(t => t.remove());
    equipment.length = 0; clients.length = 0; jobs.length = 0; bids.length = 0;
    S.whFlushMsg = undefined; S.whSkippedBids = []; S.serviceTypes = {};
    _svcFilter = ''; _svcAddKind = null; _whListQuery = '';
    window._svcKeepTrade = window._svcKeepTrade || { active: window.getActiveTrade, cfg: _config };
    window.getActiveTrade = () => trade || 'plumbing';
    _config = Object.assign({}, window._svcKeepTrade.cfg || {}, { trade_lines: trade || 'plumbing' });
    [['501', 'Dana Due', '5551112222'], ['502', 'Lee Later', '5553334444'], ['503', 'Gus Gutter', '5559990000'],
     ['504', 'Fay Filter', '5552223333'], ['505', 'Ira Irrigate', '5554445555'], ['506', 'Hal Heater', '5556667777']]
      .forEach(([id, name, phone]) => clients.push({ id: +id, name, phone, addr: id + ' Oak St' }));
    return todayKey();
  }, trade);
  const add = (clientId, serviceKind, monthsAgo, extra) => page.evaluate(({ clientId, serviceKind, monthsAgo, extra }) => {
    const t = _svcType(serviceKind);
    const row = saveEquipment({ clientId, kind: (t && t.kind) || (t && t.name) || 'Other', installed: _whAddMonths(todayKey(), -monthsAgo) });
    row.serviceKind = serviceKind;
    Object.assign(row, extra || {});
    return row.id;
  }, { clientId, serviceKind, monthsAgo, extra });
  const boardNames = () => page.evaluate(() => { _renderWhBoard(); return [...document.querySelectorAll('#dash-wh-board .td-wh-row .td-wh-name')].map(b => b.textContent); });

  test.afterAll(async () => {
    try { await page.evaluate(() => { if (window._svcKeepTrade) { window.getActiveTrade = window._svcKeepTrade.active; _config = window._svcKeepTrade.cfg; } }); } catch (_e) {}
  });

  test('an old heater row with no serviceKind is a heater flush, on the same day as before', async () => {
    await seed();
    const r = await page.evaluate(() => {
      const tk = todayKey();
      // Exactly the shape production wrote before 2026-09-27.
      const a = saveEquipment({ clientId: 501, kind: 'Water heater', installed: _whAddMonths(tk, -11) });
      const b = saveEquipment({ clientId: 502, kind: 'Water heater', installed: _whAddMonths(tk, -10) });
      _renderWhBoard();
      return {
        kind: _svcKindOf(a), months: _svcMonths(a), lead: _svcLead(a),
        dueA: _whDueKey(a), expA: _whAddMonths(a.installed, 11), realDue: _svcDueKey(a), expReal: _whAddMonths(a.installed, 12),
        rewritten: 'serviceKind' in a || 'serviceMonths' in b,
        sub: document.querySelector('#dash-wh-board .td-wh-row .td-wh-sub')?.textContent,
      };
    });
    expect(r.kind).toBe('wh-flush');
    expect(r.months).toBe(12);
    expect(r.lead, 'heaters still show a month early').toBe(1);
    expect(r.dueA, 'the board day is the old 11 months, to the day').toBe(r.expA);
    expect(r.realDue).toBe(r.expReal);
    expect(r.rewritten, 'nothing is written back onto the stored row').toBe(false);
    expect(await boardNames()).toEqual(['Dana Due']);
    expect(r.sub).toMatch(/^Water heater flush, due \d\d\/\d\d\/\d{4}$/);
    // Overdue counts from the due date the row shows, not the early board day.
    const st = await page.evaluate(() => {
      const read = () => { _renderWhBoard(); return document.querySelector('#dash-wh-board .td-wh-status')?.textContent; };
      const early = read();
      equipment.find(e => e.clientId === 501).installed = _whAddMonths(todayKey(), -14);
      return { early, late: read() };
    });
    expect(st).toEqual({ early: 'Due now', late: '2 mo overdue' });
  });

  test('each service shows on its own default interval, and not a month before', async () => {
    await seed();
    const cases = [['water-filter', 6], ['gutter', 6], ['irrigation', 12], ['furnace', 12]];
    for (const [key, m] of cases) {
      await page.evaluate(() => { equipment.length = 0; });
      await add(503, key, m);
      await add(504, key, m - 1);
      const r = await page.evaluate((key) => ({ def: _svcType(key).months, names: (() => { _renderWhBoard(); return [...document.querySelectorAll('#dash-wh-board .td-wh-name')].map(n => n.textContent); })() }), key);
      expect(r.def, key + ' default').toBe(m);
      expect(r.names, key + ' shows when due, never early').toEqual(['Gus Gutter']);
    }
  });

  test('changing a service default moves every customer who has no interval of their own', async () => {
    await seed();
    await add(503, 'gutter', 3);
    const own = await add(504, 'gutter', 3, { serviceMonths: 12 });
    expect(await boardNames()).toEqual([]);
    const r = await page.evaluate((own) => {
      const ok = svcSetTypeMonths('gutter', 3);
      const back = svcSetTypeMonths('water-filter', 6);
      return { ok, back, st: JSON.parse(JSON.stringify(S.serviceTypes)), ownDue: _svcMonths(equipment.find(e => e.id === own)) };
    }, own);
    expect(r.ok).toBe(true);
    expect(r.st.gutter).toEqual({ months: 3 });
    expect(r.st['water-filter'], 'the built-in default is never stored').toBeUndefined();
    expect(r.ownDue, "a customer's own interval wins over the default").toBe(12);
    expect(await boardNames()).toEqual(['Gus Gutter']);
  });

  test("a customer's own interval wins, and picking the default puts them back on it", async () => {
    await seed();
    const id = await add(504, 'water-filter', 7, { serviceMonths: 12 });
    expect(await boardNames()).toEqual([]);
    const r = await page.evaluate((id) => {
      const e = equipment.find(x => x.id === id);
      const set = svcSetItemMonths(id, 6);
      return { set, has: 'serviceMonths' in e, months: _svcMonths(e), bad: svcSetItemMonths(id, 30), badMonths: _svcMonths(e) };
    }, id);
    expect(r.set).toBe(true);
    expect(r.has, 'the default is not copied onto the row').toBe(false);
    expect(r.months).toBe(6);
    expect(r.bad).toBe(false);
    expect(r.badMonths).toBe(6);
    expect(await boardNames()).toEqual(['Fay Filter']);
  });

  test('a 3-month filter comes back 3 months after it is done', async () => {
    await seed();
    await page.evaluate(() => svcSetTypeMonths('water-filter', 3));
    const id = await add(504, 'water-filter', 4);
    expect(await boardNames()).toEqual(['Fay Filter']);
    const r = await page.evaluate((id) => {
      const e = equipment.find(x => x.id === id);
      whMarkDiy(id);
      const toast = document.querySelector('.toast')?.textContent || '';
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const due = _whDueKey(e), exp = _whAddMonths(todayKey(), 3);
      // Three months on: the diy entry is now three months old.
      e.flushLog[e.flushLog.length - 1].date = _whAddMonths(todayKey(), -3);
      return { due, exp, toast };
    }, id);
    expect(r.due).toBe(r.exp);
    expect(r.toast).toContain('Back on the board in 3 months');
    expect(await boardNames(), 'and it is due again').toEqual(['Fay Filter']);
    // A job we booked counts the same way, and a canceled one stops counting.
    const b = await page.evaluate((id) => {
      jobs.push({ id: 9901, client_id: 504, eventType: 'job', start: todayKey(), status: 'upcoming' });
      whFlushBooked(id, jobs[jobs.length - 1]);
      _renderWhBoard();
      const gone = document.querySelectorAll('#dash-wh-board .td-wh-name').length;
      jobs[jobs.length - 1].status = 'canceled';
      return { gone };
    }, id);
    expect(b.gone).toBe(0);
    expect(await boardNames()).toEqual(['Fay Filter']);
  });

  test('doing it themselves, undo and no answer yet work for every service', async () => {
    await seed();
    const id = await add(503, 'gutter', 6);
    const r = await page.evaluate((id) => {
      const names = () => { _renderWhBoard(); return [...document.querySelectorAll('#dash-wh-board .td-wh-name')].map(n => n.textContent); };
      const e = equipment.find(x => x.id === id);
      whMarkDiy(id);
      const afterDiy = names();
      const toast = document.querySelector('.toast')?.textContent || '';
      const hasUndo = !!document.querySelector('.toast .td-wh-undo');
      const at = e.flushLog[e.flushLog.length - 1].at;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const undone = whUndoDiy(id, at);
      const afterUndo = names();
      whRollOver(id);
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const afterRoll = names();
      const foot = document.querySelector('#dash-wh-board .td-wh-foot')?.textContent || '';
      e.whSnoozeUntil = todayKey();
      const back = names();
      const chip = document.querySelector('#dash-wh-board .td-wh-chip-roll')?.textContent;
      return { afterDiy, toast, hasUndo, undone, afterUndo, afterRoll, foot, back, chip };
    }, id);
    expect(r.afterDiy).toEqual([]);
    expect(r.toast).toContain('Back on the board in 6 months');
    expect(r.hasUndo).toBe(true);
    expect(r.undone).toBe(true);
    expect(r.afterUndo).toEqual(['Gus Gutter']);
    expect(r.afterRoll).toEqual([]);
    expect(r.foot).toContain('1 rolled to next month');
    expect(r.back).toEqual(['Gus Gutter']);
    expect(r.chip).toBe('Rolled over');
  });

  test('schedule opens the real scheduler named for the service', async () => {
    await seed();
    const id = await add(503, 'gutter', 6);
    await page.evaluate((id) => whScheduleFlush(id), id);
    await page.waitForFunction(() => window._schedPrefill && document.getElementById('s-name').value.includes('gutter'));
    const r = await page.evaluate(() => ({ name: document.getElementById('s-name').value, tip: document.getElementById('sched-tip')?.textContent || '' }));
    expect(r.name).toBe('Gus Gutter, gutter cleaning');
    expect(r.tip).toContain('Gutter cleaning for Gus Gutter');
    const b = await page.evaluate(() => { scheduleJob(); const j = jobs[jobs.length - 1]; const e = equipment[0]; return { logged: (e.flushLog || []).map(f => f.jobId), jobId: j.id, client: j.client_id }; });
    expect(b.logged).toEqual([b.jobId]);
    expect(b.client).toBe(503);
    await page.evaluate(() => { setSchedType('job'); goPg('pg-dash'); });
    expect(await boardNames()).toEqual([]);
  });

  test('every service has its own text, and the heater keeps S.whFlushMsg', async () => {
    await seed();
    const f = await add(504, 'water-filter', 6);
    const h = await page.evaluate(() => saveEquipment({ clientId: 506, kind: 'Water heater', installed: _whAddMonths(todayKey(), -12) }).id);
    const r = await page.evaluate(({ f, h }) => {
      const urls = [];
      window._whOpenSms = u => urls.push(u);
      whTextFlush(f);
      const ph = document.getElementById('_wh-msg').placeholder;
      const sub = document.querySelector('#_wh-text-ov .td-wh-form-sub').textContent;
      document.getElementById('_wh-msg').value = 'Hi {name}, filter time.';
      document.getElementById('_wh-send').click();
      whTextFlush(h);
      const heaterFirst = document.getElementById('_wh-msg').value;
      const heaterPh = document.getElementById('_wh-msg').placeholder;
      document.getElementById('_wh-msg').value = 'Hi {name}, flush time.';
      document.getElementById('_wh-send').click();
      whTextFlush(f);
      const again = document.getElementById('_wh-msg').value;
      document.getElementById('_wh-text-ov')?.remove();
      const c = svcAddCustomType('Dryer vent cleaning', 12);
      const cid = saveEquipment({ clientId: 503, kind: c.name, installed: _whAddMonths(todayKey(), -12) });
      cid.serviceKind = c.key; cid.serviceName = c.name;
      whTextFlush(cid.id);
      const customPh = document.getElementById('_wh-msg').placeholder;
      document.getElementById('_wh-msg').value = 'Hi {name}, vent time.';
      document.getElementById('_wh-send').click();
      return { ph, sub, heaterFirst, heaterPh, again, urls, customPh, st: JSON.parse(JSON.stringify(S.serviceTypes)), wh: S.whFlushMsg, ckey: c.key };
    }, { f, h });
    expect(r.ph).toContain('water filter');
    expect(r.sub).toContain('Water filter change');
    expect(r.heaterFirst, "the filter's message never becomes the heater's").toBe('');
    expect(r.heaterPh).toContain('water heater');
    expect(r.again).toBe('Hi {name}, filter time.');
    expect(r.st['water-filter'].msg).toBe('Hi {name}, filter time.');
    expect(r.wh).toBe('Hi {name}, flush time.');
    expect(r.customPh).toContain('dryer vent cleaning');
    expect(r.st[r.ckey]).toEqual({ custom: true, name: 'Dryer vent cleaning', months: 12, msg: 'Hi {name}, vent time.' });
    expect(r.urls[0]).toBe('sms:5552223333&body=' + encodeURIComponent('Hi Fay, filter time.'));
  });

  test('the board labels each row, sorts by due date across services, and filters in one tap', async () => {
    await seed();
    await add(503, 'gutter', 8);
    await add(504, 'water-filter', 6);
    await add(505, 'irrigation', 15);
    await page.evaluate(() => saveEquipment({ clientId: 506, kind: 'Water heater', installed: _whAddMonths(todayKey(), -11) }));
    const r = await page.evaluate(() => {
      goPg('pg-dash'); _renderWhBoard();
      const read = () => [...document.querySelectorAll('#dash-wh-board .td-wh-row')].map(r => r.querySelector('.td-wh-name').textContent + ' | ' + r.querySelector('.td-wh-sub').textContent.replace(/, due .*/, ''));
      const all = read();
      const chips = [...document.querySelectorAll('#dash-wh-board .td-svc-fchip')].map(b => b.textContent);
      const title = document.querySelector('#dash-wh-board .td-wh-title').firstChild.textContent;
      const hdSub = document.querySelector('#dash-wh-board .td-wh-hd-sub').textContent;
      document.querySelector('#dash-wh-board .td-svc-fchip[data-svc="gutter"]').click();
      const gutterOnly = read();
      const hdGutter = document.querySelector('#dash-wh-board .td-wh-hd-sub').textContent;
      document.querySelector('#dash-wh-board .td-svc-fchip[data-svc=""]').click();
      const back = read();
      return { all, chips, title, hdSub, gutterOnly, hdGutter, back };
    });
    expect(r.title).toBe('Service due');
    expect(r.hdSub).toBe('4 services · 4 due');
    expect(r.all, 'most overdue first, whatever the service').toEqual([
      'Ira Irrigate | Irrigation drain-down',
      'Gus Gutter | Gutter cleaning',
      'Fay Filter | Water filter change',
      'Hal Heater | Water heater flush',
    ]);
    expect(r.chips, 'the plumber sees his services first').toEqual(['All', 'Water heater1', 'Water filter1', 'Irrigation1', 'Gutters1']);
    expect(r.gutterOnly).toEqual(['Gus Gutter | Gutter cleaning']);
    expect(r.hdGutter).toBe('Gutter cleaning · 1 due');
    expect(r.back.length).toBe(4);
  });

  test('the master list labels every row with its service and how often, and changes one customer', async () => {
    await seed();
    const id = await add(503, 'gutter', 3);
    await add(504, 'water-filter', 6);
    const r = await page.evaluate((id) => {
      goPg('pg-wh-list');
      const svc = [...document.querySelectorAll('#wh-list-body .td-wh-svc')].map(s => s.textContent);
      const caps = [...document.querySelectorAll('#wh-list-body .td-wh-list-cap')].map(c => c.textContent);
      const btn = [...document.querySelectorAll('#wh-list-body .td-wh-list-row')].find(r => r.textContent.includes('Gus')).querySelector('.td-svc-every');
      const h = btn.offsetHeight;
      btn.click();
      const open = !!document.getElementById('_svc-every-ov');
      const onBefore = document.querySelector('#_svc-every-ov .td-svc-mchip.on')?.textContent;
      document.querySelector('#_svc-every-ov .td-svc-mchip[data-m="3"]').click();
      const typed = document.getElementById('_svc-every-m').value;
      document.getElementById('_svc-every-save').click();
      const e = equipment.find(x => x.id === id);
      const after = [...document.querySelectorAll('#wh-list-body .td-wh-list-cap')].map(c => c.textContent);
      _whListQuery = '5552'; renderWhList();
      const byPhone = [...document.querySelectorAll('#wh-list-body .td-wh-name')].map(n => n.textContent);
      _whListQuery = ''; goPg('pg-dash');
      return { svc, caps, h, open, onBefore, typed, own: e.serviceMonths, after, byPhone, closed: !document.getElementById('_svc-every-ov') };
    }, id);
    expect(r.svc).toEqual(['Water filter changeevery 6 mo', 'Gutter cleaningevery 6 mo']);
    expect(r.caps).toEqual(['Due now · 1', 'Coming up · 1']);
    expect(r.h, 'a real thumb target').toBeGreaterThanOrEqual(44);
    expect(r.open).toBe(true);
    expect(r.onBefore).toBe('6 mo');
    expect(r.typed).toBe('3');
    expect(r.own).toBe(3);
    expect(r.closed).toBe(true);
    expect(r.after).toEqual(['Due now · 2']);
    expect(r.byPhone, 'the list search is the shared customer search').toEqual(['Fay Filter']);
  });

  test('quick add: services by trade first, interval prefilled, own interval kept, form stays on the service', async () => {
    await seed('landscaping');
    const r = await page.evaluate(() => {
      openWhAdd();
      const chips = [...document.querySelectorAll('#_wh-add-ov .td-svc-tchip')].map(b => b.textContent);
      const first = document.querySelector('#_wh-add-ov .td-svc-tchip.on').textContent;
      const firstMonths = document.getElementById('_svc-months').value;
      // Typed fields survive picking a service.
      document.getElementById('_wh-name').value = 'Pat Newby';
      svcAddPick('water-filter');
      const keptName = document.getElementById('_wh-name').value;
      const months = document.getElementById('_svc-months').value;
      const dateLbl = document.getElementById('_wh-date').closest('.sf-row').querySelector('.sf-lbl').textContent;
      document.getElementById('_wh-add-save').click();
      const errNoDate = document.getElementById('_wh-err').textContent;
      document.getElementById('_wh-date').value = _whAddMonths(todayKey(), -2);
      document.querySelector('#_wh-add-ov .td-svc-mchip[data-m="3"]').click();
      const sub = document.getElementById('_svc-add-sub').textContent;
      document.getElementById('_wh-phone').value = '5550001111';
      document.getElementById('_wh-add-save').click();
      const c = clients.find(x => x.name === 'Pat Newby');
      const e = equipment.find(x => String(x.clientId) === String(c.id));
      const stayed = document.querySelector('#_wh-add-ov .td-svc-tchip.on').textContent;
      const nextMonths = document.getElementById('_svc-months').value;
      const cleared = document.getElementById('_wh-name').value;
      document.getElementById('_wh-add-done').click();
      return { chips, first, firstMonths, keptName, months, dateLbl, errNoDate, sub, row: { kind: e.kind, sk: e.serviceKind, sm: e.serviceMonths, src: e.source }, stayed, nextMonths, cleared };
    });
    expect(r.chips).toEqual(['Gutters', 'Irrigation', 'Water heater', 'Water filter', 'Furnace', 'Custom']);
    expect(r.first, 'a landscaper starts on a landscaping service').toBe('Gutters');
    expect(r.firstMonths).toBe('6');
    expect(r.keptName).toBe('Pat Newby');
    expect(r.months, 'prefilled from the service default').toBe('6');
    expect(r.dateLbl).toBe('Last done');
    expect(r.errNoDate).toBe('Pick when it was last done.');
    expect(r.sub).toBe('Water filter change. They show up on the board 3 months after this date.');
    expect(r.row).toEqual({ kind: 'Water filter change', sk: 'water-filter', sm: 3, src: 'manual' });
    expect(r.stayed).toBe('Water filter');
    expect(r.nextMonths).toBe('3');
    expect(r.cleared).toBe('');
    expect(await boardNames()).toEqual([]);
  });

  test('quick add: a custom service is named once and reused', async () => {
    await seed();
    const r = await page.evaluate(() => {
      openWhAdd('client');
      svcAddPick('__custom');
      document.getElementById('_wh-add-save').click();
      document.getElementById('_wh-date').value = _whAddMonths(todayKey(), -12);
      document.getElementById('_wh-client').value = '503';
      document.getElementById('_wh-add-save').click();
      const errName = document.getElementById('_wh-err').textContent;
      document.getElementById('_svc-custom-name').value = 'Dryer vent cleaning';
      document.getElementById('_wh-add-save').click();
      const keys = Object.keys(S.serviceTypes);
      const onChip = document.querySelector('#_wh-add-ov .td-svc-tchip.on').textContent;
      document.getElementById('_wh-date').value = _whAddMonths(todayKey(), -1);
      document.getElementById('_wh-client').value = '504';
      document.getElementById('_wh-add-save').click();
      document.getElementById('_wh-add-done').click();
      const rows = equipment.map(e => ({ c: e.clientId, sk: e.serviceKind, n: e.serviceName, sm: e.serviceMonths }));
      return { errName, keys, onChip, rows, again: svcAddCustomType('dryer VENT cleaning', 3).key };
    });
    expect(r.errName).toBe('Name the service.');
    expect(r.keys).toEqual(['c-dryer-vent-cleaning']);
    expect(r.onChip).toBe('Dryer vent cleaning');
    expect(r.rows).toEqual([
      { c: 503, sk: 'c-dryer-vent-cleaning', n: 'Dryer vent cleaning', sm: undefined },
      { c: 504, sk: 'c-dryer-vent-cleaning', n: 'Dryer vent cleaning', sm: undefined },
    ]);
    expect(r.again, 'the same name is the same service').toBe('c-dryer-vent-cleaning');
    expect(await boardNames()).toEqual(['Gus Gutter']);
  });

  test('the defaults sheet sets every service in one place', async () => {
    await seed();
    await add(504, 'water-filter', 3);
    const r = await page.evaluate(() => {
      goPg('pg-wh-list');
      document.querySelector('#pg-wh-list .td-wh-tbar-b .td-wh-add').click();
      const rows = [...document.querySelectorAll('#_svc-types-ov .sf-lbl')].map(l => l.textContent);
      document.querySelector('#_svc-types-ov [data-for="_svc-t-water-filter"] .td-svc-mchip[data-m="3"]').click();
      document.getElementById('_svc-t-irrigation').value = '30';
      document.getElementById('_svc-types-save').click();
      const err = document.getElementById('_svc-types-err').textContent;
      document.getElementById('_svc-t-irrigation').value = '9';
      document.getElementById('_svc-types-save').click();
      const closed = !document.getElementById('_svc-types-ov');
      openSvcTypes();
      document.getElementById('_svc-own-name').value = 'Sump pump check';
      document.getElementById('_svc-own-add').click();
      const withOwn = [...document.querySelectorAll('#_svc-types-ov .sf-lbl')].map(l => l.textContent);
      document.getElementById('_svc-types-ov').remove();
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const st = JSON.parse(JSON.stringify(S.serviceTypes));
      goPg('pg-dash');
      return { rows, err, closed, st, withOwn };
    });
    expect(r.rows).toEqual(['Water heater flush', 'Water filter change', 'Irrigation drain-down', 'Gutter cleaning', 'Heater / furnace service', 'Add your own']);
    expect(r.err).toBe('Irrigation drain-down: pick 1 to 24 months.');
    expect(r.closed).toBe(true);
    expect(r.st['water-filter']).toEqual({ months: 3 });
    expect(r.st.irrigation).toEqual({ months: 9 });
    expect(r.st['wh-flush'], 'an unchanged default stores nothing').toBeUndefined();
    expect(r.withOwn).toContain('Sump pump check');
    expect(await boardNames()).toEqual(['Fay Filter']);
  });

  test('proposal finds stay heater only, and another service never hides one', async () => {
    await seed();
    await add(501, 'gutter', 1);
    const r = await page.evaluate(() => {
      bids.push({ id: 9001, client_id: 501, status: 'Closed Won', signedAt: _whAddMonths(todayKey(), -14), notes: 'Water heater swap' });
      bids.push({ id: 9002, client_id: 502, status: 'Closed Won', signedAt: _whAddMonths(todayKey(), -14), notes: 'Gutter cleaning' });
      return _whProposalFinds().map(f => f.clientId);
    });
    expect(r).toEqual([501]);
  });

  test('Tim finds the page by its new name and the old ones', async () => {
    const r = await page.evaluate(() => ['open service due', 'recurring service', 'show me water filters', 'gutter cleaning', 'annual service', 'water heater flushes'].map(s => (timWhere(s) || {}).pg + '|' + (timWhere(s) || {}).name));
    expect(r.every(x => x === 'pg-wh-list|Service due')).toBe(true);
  });

  test('bad input never throws, and bad settings fall back to the defaults', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      const tryIt = (n, f) => { try { f(); out.push(n + ':ok'); } catch (e) { out.push(n + ':' + e.message); } };
      tryIt('type-null', () => _svcTypeOf(null));
      tryIt('kind-junk', () => _svcKindOf('x'));
      tryIt('months-junk', () => { if (_svcMonths({ kind: 'Water heater', serviceMonths: 'soon' }) !== 12) throw new Error('bad'); });
      tryIt('months-zero', () => { if (_svcValidMonths(0) !== null || _svcValidMonths(25) !== null || _svcValidMonths('6') !== 6) throw new Error('bad'); });
      tryIt('item-missing', () => { if (svcSetItemMonths('nope', 3) !== false) throw new Error('bad'); });
      tryIt('type-bad', () => { if (svcSetTypeMonths('gutter', 0) !== false || svcSetTypeMonths('nope', 3) !== false) throw new Error('bad'); });
      tryIt('custom-empty', () => { if (svcAddCustomType('  ', 3) !== null) throw new Error('bad'); });
      tryIt('edit-missing', () => svcEditEvery('nope'));
      tryIt('filter-junk', () => { svcSetFilter('nope'); _renderWhBoard(); svcSetFilter(''); });
      S.serviceTypes = 'junk';
      tryIt('settings-string', () => { if (_svcType('gutter').months !== 6) throw new Error('bad'); });
      S.serviceTypes = [1, 2];
      tryIt('settings-array', () => { if (_svcTypes().length !== 5) throw new Error('bad'); });
      S.serviceTypes = { gutter: { months: 'x' }, 'c-x': { custom: true, name: '' }, 'c-y': null };
      tryIt('settings-bad-values', () => { if (_svcType('gutter').months !== 6 || _svcTypes().length !== 5) throw new Error('bad'); });
      S.serviceTypes = {};
      tryIt('orphan-custom', () => { const t = _svcTypeOf({ serviceKind: 'c-gone', serviceName: 'Pool opening' }); if (t.name !== 'Pool opening') throw new Error('bad'); });
      return out;
    });
    expect(r.filter(x => !x.endsWith(':ok'))).toEqual([]);
  });

  test('layout at 375px: board, list and add sheet stay on screen with 44px targets', async () => {
    await seed();
    await add(503, 'gutter', 8);
    await add(504, 'water-filter', 6);
    await add(505, 'irrigation', 14);
    await page.evaluate(() => { clients.find(c => c.id === 505).name = 'Bartholomew Maximilian Worthington-Smythe III'; });
    const r = await page.evaluate(async () => {
      goPg('pg-dash'); _renderWhBoard();
      const card = document.querySelector('#dash-wh-board .td-wh-card');
      const fchips = [...card.querySelectorAll('.td-svc-fchip')].map(b => b.offsetHeight);
      const board = { sw: document.documentElement.scrollWidth, right: card.getBoundingClientRect().right };
      goPg('pg-wh-list');
      const list = { sw: document.documentElement.scrollWidth };
      const row = document.querySelector('#wh-list-body .td-wh-list-row');
      const clear = row.querySelector('.td-wh-svc').getBoundingClientRect().right <= row.querySelector('.td-wh-list-r').getBoundingClientRect().left + 1;
      goPg('pg-dash');
      openWhAdd();
      // Let the sheet's entrance finish so the boxes are measured at rest.
      await new Promise(res => setTimeout(res, 450));
      const m = document.querySelector('#_wh-add-ov .zmodal').getBoundingClientRect();
      const tEls = [...document.querySelectorAll('#_wh-add-ov .td-svc-chip, #_wh-add-ov .td-svc-mnum')];
      const sheet = { sw: document.documentElement.scrollWidth, right: m.right, left: m.left, minH: Math.min(...tEls.map(b => b.offsetHeight)), maxRight: Math.max(...tEls.map(b => b.getBoundingClientRect().right)) };
      document.getElementById('_wh-add-ov').remove();
      return { iw: innerWidth, fchips, board, list, clear, sheet };
    });
    expect(r.iw).toBe(375);
    expect(r.board.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.board.right).toBeLessThanOrEqual(r.iw);
    expect(Math.min(...r.fchips)).toBeGreaterThanOrEqual(44);
    expect(r.list.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.clear, 'the service line never runs under the due date').toBe(true);
    expect(r.sheet.sw).toBeLessThanOrEqual(r.iw + 1);
    expect(r.sheet.left).toBeGreaterThanOrEqual(0);
    expect(r.sheet.right).toBeLessThanOrEqual(r.iw);
    expect(r.sheet.maxRight).toBeLessThanOrEqual(r.sheet.right);
    expect(r.sheet.minH).toBeGreaterThanOrEqual(44);
  });

  test('no console errors during service interval tests', async () => {
    assertNoErrors(page, 'service-intervals');
  });
});
