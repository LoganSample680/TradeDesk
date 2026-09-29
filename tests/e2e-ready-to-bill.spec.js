// @ts-check
/**
 * Ready to bill (js/quick-invoice.js, owner 2026-09-29).
 *
 * Owner: "pull hours if there are hours, pull receipts to total up materials
 * but not show them ... another dashboard for invoices then clicking into them
 * opens up the invoice thing we already created", then "three days at Tagen's,
 * each day we do something different ... click them all together".
 *
 *   - Home lists every house with unbilled hours, oldest first, one row a house
 *   - the invoice shows one card a day, each with its own total, all checked
 *   - a day left unchecked is still there next time (Earl: a through-mark lost it)
 *   - days settled outside the app come off the list and are not a sale
 *   - riders: John has no app and rides with Jack, so he gets Jack's hours
 *   - a person's rate is one number across the whole invoice
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const D1 = '2026-09-22T15:00:00.000Z', D2 = '2026-09-23T15:00:00.000Z', D3 = '2026-09-24T15:00:00.000Z';

async function boot(page, w) {
  if (w) await page.setViewportSize({ width: w, height: 800 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate(({ D1, D2, D3 }) => {
    const mk = (id, name, addr) => ({ id, name, addr, phone: '5555550101', status: 'Client' });
    clients.splice(0, clients.length,
      mk(701, 'Tagen Miller', '2210 Birch Ln, Springfield, IL'),
      mk(702, 'Mary Smith', '77 Lakeview Dr, Springfield, IL'),
      mk(703, 'Pat Neenan', '412 Oak St, Springfield, IL'));
    jobs.splice(0, jobs.length, { id: 'jp', client_id: 703, bid_id: 'bp', start: '2026-09-20', days: 1 });
    bids.splice(0, bids.length, { id: 'bp', client_id: 703, status: 'Closed Won', amount: 2180, type: 'Fixed', kind: 'byo' });
    expenses.splice(0, expenses.length,
      { id: 'x1', client_id: 701, vendor: 'Ferguson', amount: 120, date: '2026-09-22' },
      { id: 'x2', client_id: 701, vendor: 'Menards', amount: 66, date: '2026-09-22' });
    window._jobTimeEntriesByJob = {};
    S.laborRate = 70;
    S.ownerName = 'John Miller';
    S.ownerBillRate = 125;
    S.employees = [{ name: 'Jack Sample', email: 'jack@x.com', billRate: 75 }];
    delete S.qiRiders; delete S.qiBillDrive;
    const H = 3600e3;
    const row = (at, hrs, place, uid) => ({ job_id: null, employee_user_id: uid || 'jack-uid', source: 'client', dest_place: place,
      arrived_at: at, departed_at: new Date(Date.parse(at) + hrs * H).toISOString(), minutes: hrs * 60 });
    window._rtbLab = { name: { 'jack-uid': 'Jack Sample', 'boss-uid': 'John Miller' }, entries: [
      row(D1, 6, 'Tagen Miller (2210 Birch Ln)'),
      row(D2, 3.5, 'Tagen Miller (2210 Birch Ln)'),
      row(D3, 2, 'Tagen Miller (2210 Birch Ln)'),
      row(D2, 3, 'Mary Smith (77 Lakeview Dr)'),
      row(D1, 5, 'Pat Neenan (412 Oak St)'),
    ] };
    window._supaUser = { id: 'boss-uid' }; window.supaEnabled = () => true; window._supa = window._supa || {};
    window._settingsChanged = () => {};
    window._fetchCrewLabor = async () => window._rtbLab;
    _tb = { at: Date.now(), lab: window._rtbLab };
  }, { D1, D2, D3 });
}
const open = (page, cid) => page.evaluate(async (cid) => { openQuickInvoice(cid); await new Promise(r => setTimeout(r, 30)); }, cid);

test.describe('Ready to bill', () => {
  test('Home lists each house with unbilled hours, oldest first, with its days and total; a house with an open proposal is not on it', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _renderToBill();
      const el = document.getElementById('dash-to-bill');
      return {
        shown: el.style.display !== 'none',
        names: [...el.querySelectorAll('.tb-name')].map(n => n.textContent),
        subs: [...el.querySelectorAll('.tb-sub')].map(n => n.textContent),
        amts: [...el.querySelectorAll('.tb-amt')].map(n => n.textContent),
        before: document.getElementById('dash-to-bill').compareDocumentPosition(document.getElementById('dash-nearby')) & Node.DOCUMENT_POSITION_FOLLOWING,
      };
    });
    expect(r.shown).toBe(true);
    expect(r.names).toEqual(['Tagen Miller', 'Mary Smith']);
    expect(r.subs[0]).toBe('Sep 22 · 3 days · 2210 Birch Ln');
    // 11.5h x $75 + $186 of receipts
    expect(r.amts[0]).toBe('$1,048.50');
    expect(r.subs[1]).toBe('Sep 23 · 3h · 77 Lakeview Dr');
    expect(r.before, 'below the tiles, above Clock in').toBeTruthy();
  });

  test('tapping a row opens that house\'s invoice with a card a day and the same total as the row', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      _renderToBill();
      document.querySelector('#dash-to-bill .tb-row').click();
      await new Promise(r => setTimeout(r, 30));
      _qiDays(_qi.tracked).forEach(d => _qi.open.add(d)); renderQuickInvoice();
      return {
        page: document.querySelector('.pg.active').id,
        days: [...document.querySelectorAll('#qi-page .qi-day-hd b')].map(b => b.textContent),
        dayTotals: [...document.querySelectorAll('#qi-page .qi-dt')].map(b => b.textContent),
        total: document.getElementById('qi-total').textContent,
        text: document.getElementById('qi-page').textContent,
      };
    });
    expect(r.page).toBe('pg-qi');
    expect(r.days).toEqual(['Tue, Sep 22', 'Wed, Sep 23', 'Thu, Sep 24']);
    expect(r.dayTotals).toEqual(['$636.00', '$262.50', '$150.00']);
    expect(r.total).toBe('$1,048.50');
    expect(r.text).toContain('Days at this house');
    expect(r.text).toContain('Ferguson $120.00, Menards $66.00');   // his screen names the stores
  });

  test('the customer\'s copy gets one Materials line a day, never the store receipts, and each line says its day', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => ({ lines: _qiLines().map(l => l.desc), doc: _qiDocHtml() }));
    expect(r.lines).toEqual(['Sep 22 · Jack Sample: 6h on site', 'Sep 22 · Materials', 'Sep 23 · Jack Sample: 3h 30m on site', 'Sep 24 · Jack Sample: 2h on site']);
    expect(r.doc).not.toContain('Ferguson');
    expect(r.doc).not.toContain('Menards');
  });

  test('uncheck a day: the total drops, Send bills the checked days, and the skipped day is still there next time', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      document.querySelector('#qi-page .qi-day[data-day="2026-09-23"] .qi-chk-btn').click();
      const total = document.getElementById('qi-total').textContent;
      const bid = qiSend();
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      return { total, days: bid.qiDays, amount: bid.amount, left: _qiDays(_qi.tracked), leftTotal: document.getElementById('qi-total').textContent };
    });
    expect(r.total).toBe('$786.00');
    expect(r.days).toEqual(['2026-09-22', '2026-09-24']);
    expect(r.amount).toBe(786);
    expect(r.left, 'the Tuesday he left for later is not lost').toEqual(['2026-09-23']);
    expect(r.leftTotal).toBe('$262.50');
  });

  // Earl 2026-09-29: "three SE screens before the Text it button". Each day
  // is one line until it is opened, and Send stays pinned on screen.
  test('each day is one line until opened; the circle checks it in or out; Send is pinned with the total on it', async ({ page }) => {
    await boot(page, 375);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const lines = () => document.querySelectorAll('#qi-page .qi-day .ios-row:not(.qi-day-hd)').length;
      const folded = lines();
      const head = document.querySelector('#qi-page .qi-day[data-day="2026-09-22"] .qi-day-open-btn').textContent;
      document.querySelector('#qi-page .qi-day[data-day="2026-09-22"] .qi-day-open-btn').click();
      const opened = { lines: lines(), exp: document.querySelector('#qi-page .qi-day[data-day="2026-09-22"] .qi-day-open-btn').getAttribute('aria-expanded') };
      document.querySelector('#qi-page .qi-day[data-day="2026-09-23"] .qi-chk-btn').click();
      const off = _qi.off.has('2026-09-23');
      document.querySelector('#qi-page .qi-day[data-day="2026-09-23"] .qi-day-open-btn').click();
      const reopened = { off: _qi.off.has('2026-09-23'), open: _qi.open.has('2026-09-23') };
      const bar = document.querySelector('#qi-page .qi-actions');
      window.scrollTo(0, 0);
      const b = bar.getBoundingClientRect();
      return { folded, head, opened, off, reopened, pos: getComputedStyle(bar).position, onScreen: b.bottom <= innerHeight && b.top >= 0,
        send: document.getElementById('qi-send').textContent };
    });
    expect(r.folded, 'three days, three lines, nothing else').toBe(0);
    expect(r.head).toContain('Tue, Sep 22');
    expect(r.head).toContain('Jack · 6h');
    expect(r.head).toContain('$636.00');
    expect(r.opened.lines, 'Jack, Materials, and Add crew').toBe(3);
    expect(r.opened.exp).toBe('true');
    expect(r.off).toBe(true);
    expect(r.reopened, 'opening a day left off checks it back in').toEqual({ off: false, open: true });
    expect(r.pos).toBe('sticky');
    expect(r.onScreen, 'Send is on screen before any scrolling on an SE').toBe(true);
    expect(r.send).toBe('Text it to Tagen Miller · $1,048.50');
  });

  // Earl 2026-09-29: "one way in". The Invoice button lists the Ready to bill
  // houses first, each straight to its drafted bill; typing searches customers.
  test('the Invoice button opens Ready to bill first; a ready row goes straight to that house; typing searches customers', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      openQuickInvoicePicker();
      const box = document.querySelector('.zmodal');
      const rows = [...box.querySelectorAll('#qp-sugs [data-action="invoice"]')];
      const first = rows[0].textContent.replace(/\s+/g, ' ').trim();
      const label = box.textContent.includes('Ready to bill first, then your customers');
      const names = [...box.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => b.style.display !== 'none').map(b => b.querySelector('div div:first-child').textContent);
      const s = box.querySelector('#qp-search'); s.value = 'mary'; s.dispatchEvent(new Event('input'));
      const typed = [...box.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => b.style.display !== 'none').map(b => b.textContent.replace(/\s+/g, ' ').trim());
      s.value = ''; s.dispatchEvent(new Event('input'));
      box.querySelector('#qp-sugs [data-action="invoice"]').click();
      await new Promise(r => setTimeout(r, 30));
      return { first, label, names, typed, page: document.querySelector('.pg.active').id, cid: _qi && _qi.cid };
    });
    expect(r.first).toContain('Tagen Miller');
    expect(r.first).toContain('Ready to bill · $1,048.50');
    expect(r.label).toBe(true);
    expect(r.names, 'a one-house customer on top is not listed twice').toEqual(['Tagen Miller', 'Mary Smith', 'Pat Neenan']);
    expect(r.typed).toHaveLength(1);
    expect(r.typed[0]).not.toContain('Ready to bill');
    expect(r.page).toBe('pg-qi');
    expect(r.cid).toBe(701);
  });

  test('one day on the bill is open by itself', async ({ page }) => {
    await boot(page);
    await open(page, 702);
    const r = await page.evaluate(() => document.querySelectorAll('#qi-page .qi-day .ios-row:not(.qi-day-hd)').length);
    expect(r).toBeGreaterThan(0);
  });

  test('Team: what somebody bills is set on the person and every invoice and estimate reads it', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _openEmpModal(S.employees[0], 0);
      const inp = document.getElementById('emp-bill-rate');
      const before = inp.value;
      inp.value = '82';
      const btn = [...document.querySelectorAll('#emp-modal-overlay button')].find(b => /^Save/.test(b.textContent.trim()));
      btn.click();
      return { before, saved: S.employees[0].billRate, invoice: _qiRateFor('Jack Sample'), estimate: _billRateFor('jack@x.com'),
        payKept: !document.getElementById('emp-modal-overlay') };
    });
    expect(r.before).toBe('75');
    expect(r.saved).toBe(82);
    expect(r.invoice).toBe(82);
    expect(r.estimate).toBe(82);
    expect(r.payKept).toBe(true);
  });

  test('Select none and Select all flip every day at once', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const btn = () => document.querySelector('#qi-page .ios-h button');
      const first = btn().textContent; btn().click();
      const none = document.getElementById('qi-total').textContent, second = btn().textContent; btn().click();
      return { first, none, second, all: document.getElementById('qi-total').textContent };
    });
    expect(r).toEqual({ first: 'Select none', none: '$0.00', second: 'Select all', all: '$1,048.50' });
  });

  test('already billed outside TradeDesk: those days come off the list for good and are not a sale', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const nBids = bids.length;
      window.zConfirm = (msg, yes) => { window._rtbMsg = msg; yes(); };
      document.querySelector('#qi-page .qi-day[data-day="2026-09-24"] .qi-chk-btn').click();
      document.getElementById('qi-elsewhere').click();
      const c = getClientById(701);
      _renderToBill();
      return { msg: window._rtbMsg, bids: bids.length - nBids, elsewhere: c.qiElsewhere, page: document.querySelector('.pg.active').id,
        names: [...document.querySelectorAll('#dash-to-bill .tb-name')].map(n => n.textContent),
        left: _qiDays(_qiUnbilled(701, _qiVisitsFor(c, window._rtbLab.entries, window._rtbLab.name, '')).lines) };
    });
    expect(r.msg).toContain('These 2 days were already billed outside TradeDesk?');
    expect(r.bids, 'no invoice is made, so it never counts as revenue').toBe(0);
    expect(r.elsewhere).toHaveLength(1);
    expect(r.elsewhere[0].days).toEqual(['2026-09-22', '2026-09-23']);
    expect(r.elsewhere[0].expIds).toEqual(['x1', 'x2']);
    expect(r.page).toBe('pg-dash');
    expect(r.left).toEqual(['2026-09-24']);
    // Tagen's oldest open day is now Sep 24, so Mary's Sep 23 goes first.
    expect(r.names).toEqual(['Mary Smith', 'Tagen Miller']);
  });

  test('riders: John has no app and rides with Jack, so each of Jack\'s days bills John too at his own rate; a day John tracked himself uses his own hours', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      S.qiRiders = { 'John Miller': 'Jack Sample' };
      window._rtbLab.entries.push({ job_id: null, employee_user_id: 'boss-uid', source: 'client', dest_place: 'Tagen Miller (2210 Birch Ln)',
        arrived_at: '2026-09-24T15:00:00.000Z', departed_at: '2026-09-24T16:00:00.000Z', minutes: 60 });
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      const john = _qi.tracked.filter(l => l.who === 'John Miller').map(l => ({ day: l.day, mins: l.mins, rate: l.rate, rider: l.rider || null }));
      _qiDays(_qi.tracked).forEach(d => _qi.open.add(d)); renderQuickInvoice();
      return { john, text: document.getElementById('qi-page').textContent };
    });
    expect(r.john).toEqual([
      { day: '2026-09-22', mins: 360, rate: 125, rider: 'Jack Sample' },
      { day: '2026-09-23', mins: 210, rate: 125, rider: 'Jack Sample' },
      { day: '2026-09-24', mins: 60, rate: 125, rider: null },
    ]);
    expect(r.text).toContain('6h, rode with Jack');
  });

  test('a rider can be taken off one day only', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      S.qiRiders = { 'John Miller': 'Jack Sample' };
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      const i = _qi.tracked.findIndex(l => l.who === 'John Miller' && l.day === '2026-09-23');
      _qiDropTracked(i);
      return _qi.tracked.filter(l => l.who === 'John Miller').map(l => l.day);
    });
    expect(r).toEqual(['2026-09-22', '2026-09-24']);
  });

  test('Add crew puts somebody on one day with the lead\'s hours; Every day makes him a rider for good', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      _qiDayOpen('2026-09-22');
      const day = document.querySelector('#qi-page .qi-day[data-day="2026-09-22"]');
      [...day.querySelectorAll('button')].find(b => b.textContent === 'Add crew').click();
      const choices = [...document.querySelectorAll('#qi-page .qi-crew button')].map(b => b.textContent);
      [...document.querySelectorAll('#qi-page .qi-crew button')].find(b => b.textContent === 'John Miller').click();
      const line = _qi.tracked.find(l => l.who === 'John Miller');
      const total = document.getElementById('qi-total').textContent;
      document.querySelector('#qi-page .qi-always').click();
      await new Promise(r => setTimeout(r, 10));
      return { choices, line: { day: line.day, mins: line.mins, amount: line.amount }, total, riders: S.qiRiders,
        johnDays: _qi.tracked.filter(l => l.who === 'John Miller').map(l => l.day) };
    });
    expect(r.choices).toEqual(['John Miller']);
    expect(r.line).toEqual({ day: '2026-09-22', mins: 360, amount: 750 });
    expect(r.total).toBe('$1,798.50');
    expect(r.riders).toEqual({ 'John Miller': 'Jack Sample' });
    expect(r.johnDays).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
  });

  test('a person\'s rate is one number on the invoice: change Jack on one day and every day moves; a rate typed for somebody with none is kept', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      ['2026-09-22', '2026-09-23', '2026-09-24'].forEach(d => _qiDayOpen(d));
      const inp = document.querySelector('#qi-page .qi-day[data-day="2026-09-23"] .qi-rate input');
      inp.value = '80'; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new Event('change'));
      const jack = _qi.tracked.filter(l => l.who === 'Jack Sample').map(l => l.amount);
      const kept = S.employees[0].billRate;
      S.employees[0].billRate = 0;
      const inp2 = document.querySelector('#qi-page .qi-day[data-day="2026-09-22"] .qi-rate input');
      inp2.value = '90'; inp2.dispatchEvent(new Event('input')); inp2.dispatchEvent(new Event('change'));
      return { jack, total: document.getElementById('qi-total').textContent, kept, learned: S.employees[0].billRate,
        other: document.querySelector('#qi-page .qi-day[data-day="2026-09-24"] .qi-rate input').value };
    });
    expect(r.jack).toEqual([480, 280, 160]);
    expect(r.kept, 'a rate he already has is changed for this invoice only').toBe(75);
    expect(r.learned, 'somebody with no rate keeps the one he typed').toBe(90);
    expect(r.other).toBe('90');
    expect(r.total).toBe('$1,221.00');
  });

  // Owner 2026-09-29: "updates in one spot show all". The estimate and the
  // invoice read one rate lookup (personBillRate, js/data.js); the copies each
  // screen had of its own are gone.
  test('one rate lookup: a rate set on the estimate is the invoice\'s rate, and one kept from the invoice is the estimate\'s', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _setBillRate('jack@x.com', 88, true);
      const onInvoice = _qiRateFor('Jack Sample');
      S.employees.push({ name: 'Rico Diaz', email: 'rico@x.com' });
      _qiRememberRate('Rico Diaz', 64);
      const onEstimate = _billRateFor('rico@x.com');
      const owner = [personBillRate('John Miller'), setPersonBillRate('John Miller', 130), personBillRate('john miller'), _qiRateFor('John Miller')];
      return { onInvoice, onEstimate, owner, stranger: personBillRate('Nobody'), none: personBillRate('') };
    });
    expect(r.onInvoice).toBe(88);
    expect(r.onEstimate).toBe(64);
    expect(r.owner).toEqual([125, true, 130, 130]);
    expect(r.stranger).toBe(0);
    expect(r.none).toBe(0);
  });

  // Owner 2026-09-29: "like #3 under the tiles but gotta make it so people
  // will click it". One line: what is waiting, how long, the total. Tap it
  // and the houses fold open; with one house it goes straight to the bill.
  test('Home shows one line under the tiles: what is waiting, how long, the total; tap folds the houses open', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _tbExpanded = false;
      _renderToBill();
      const el = document.getElementById('dash-to-bill');
      const sum = el.querySelector('.tb-sum');
      const closed = { title: sum.querySelector('b').textContent, age: sum.querySelector('.tb-age').textContent,
        total: sum.querySelector('.tb-total').textContent, inert: el.querySelector('.tb-list').hasAttribute('inert'),
        expanded: sum.getAttribute('aria-expanded'), shared: el.querySelectorAll('.ios-group .ios-row').length,
        old: el.querySelectorAll('.tb-list,.tb-hd,.tb-foot').length, late: sum.classList.contains('late') };
      sum.click();
      const s2 = document.querySelector('#dash-to-bill .tb-sum');
      const open = { inert: document.querySelector('#dash-to-bill .tb-list').hasAttribute('inert'), expanded: s2.getAttribute('aria-expanded'),
        rows: document.querySelectorAll('#dash-to-bill .tb-list .tb-row').length };
      return { closed, open };
    });
    expect(r.closed.title).toBe('Ready to bill');
    expect(r.closed.age).toMatch(/^2 houses · \d+ days$/);
    expect(r.closed.total).toBe('$1,274');
    expect(r.closed.inert, 'folded shut, the house rows cannot be tapped').toBe(true);
    expect(r.closed.expanded).toBe('false');
    expect(r.closed.shared, 'built from the shared iOS rows').toBe(3);
    expect(r.closed.old, 'one list wrapper, no header or footer of its own').toBe(1);
    expect(r.open).toEqual({ inert: false, expanded: 'true', rows: 2 });
  });

  test('with one house waiting, the line opens that invoice in one tap', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._rtbLab.entries = window._rtbLab.entries.filter(e => !/^Mary/.test(e.dest_place));
      _renderToBill();
      const age = document.querySelector('#dash-to-bill .tb-age').textContent;
      document.querySelector('#dash-to-bill .tb-sum').click();
      await new Promise(r => setTimeout(r, 30));
      return { age, page: document.querySelector('.pg.active').id, who: _qi && _qi.cid };
    });
    expect(r.age).toMatch(/^Tagen Miller · \d+ days$/);
    expect(r.page).toBe('pg-qi');
    expect(r.who).toBe(701);
  });

  test('two weeks unbilled turns the line orange', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const d = new Date(Date.now() - 20 * 86400000); d.setHours(10, 0, 0, 0);
      window._rtbLab.entries.push({ job_id: null, employee_user_id: 'jack-uid', source: 'client', dest_place: 'Mary Smith (77 Lakeview Dr)',
        arrived_at: d.toISOString(), departed_at: new Date(d.getTime() + 3600e3).toISOString(), minutes: 60 });
      _renderToBill();
      const s = document.querySelector('#dash-to-bill .tb-sum');
      return { late: s.classList.contains('late'), age: s.querySelector('.tb-age').textContent };
    });
    expect(r.late).toBe(true);
    expect(r.age).toContain('2 houses · 20 days');
  });

  test('an invoice from before days were kept still covers what it billed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      bids.push({ id: 'old', client_id: 701, kind: 'quick_invoice', status: 'Closed Won', amount: 1, qiAddr: '', qiTimeThrough: '2026-09-22T23:00:00.000Z', qiExpenseIds: ['x1', 'x2'] });
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      return _qiDays(_qi.tracked);
    });
    expect(r).toEqual(['2026-09-23', '2026-09-24']);
  });

  test('crew never see the card; offline it is not shown', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById('dash-to-bill');
      const was = window._ownerUI; window._ownerUI = () => false;
      _renderToBill();
      const crew = el.style.display;
      window._ownerUI = was;
      const se = window.supaEnabled; window.supaEnabled = () => false;
      _renderToBill();
      const offline = el.style.display;
      window.supaEnabled = se;
      return { crew, offline };
    });
    expect(r).toEqual({ crew: 'none', offline: 'none' });
  });

  test('the old names are gone: no through-mark on a new invoice, no per-store receipt lines', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => ({ receipts: _qi.tracked.filter(l => l.kind === 'receipt').map(l => l.desc) }));
    expect(r.receipts).toEqual(['Materials']);
  });

  for (const w of [375, 390]) {
    test('no bleed at ' + w + 'px, Home card and invoice', async ({ page }) => {
      await boot(page, w);
      const r = await page.evaluate(async () => {
        S.qiRiders = { 'John Miller': 'Jack Sample' };
        goPg('pg-dash'); _renderToBill();
        const card = document.getElementById('dash-to-bill').getBoundingClientRect();
        const home = { right: card.right, sw: document.documentElement.scrollWidth };
        openQuickInvoice(701);
        await new Promise(r => setTimeout(r, 30));
        document.querySelector('#qi-page .qi-day [onclick^="_qiAddCrewOpen"]')?.click();
        return { home, sw: document.documentElement.scrollWidth, iw: innerWidth };
      });
      expect(r.home.sw).toBeLessThanOrEqual(r.iw + 1);
      expect(r.home.right).toBeLessThanOrEqual(r.iw);
      expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
      assertNoErrors(page, 'ready to bill ' + w);
    });
  }
});
