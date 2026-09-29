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
    // Sending opens an sms: link, which can navigate the page out from under
    // a test that keeps working after Send (midnight clock run, 2026-09-29).
    // These tests are about what gets billed, not the text itself.
    window._sendPaidInvoice = () => {};
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
    expect(r.opened.lines, 'what was done, Jack, Materials, and Add crew').toBe(4);
    expect(r.opened.exp).toBe('true');
    expect(r.off).toBe(true);
    expect(r.reopened, 'opening a day left off checks it back in').toEqual({ off: false, open: true });
    expect(r.pos, 'the T&M estimate\'s bar, pinned to the screen').toBe('fixed');
    expect(r.onScreen, 'Send is on screen before any scrolling on an SE').toBe(true);
    expect(r.send).toBe('Send it · $1,048.50');
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

  test('swipe a day left and tap Already billed: only that day comes off, its receipts with it, and the bill stays open', async ({ page }) => {
    await boot(page, 390);
    await open(page, 701);
    await page.evaluate(() => { window.zConfirm = (msg, yes) => { window._rtbMsg = msg; yes(); }; });
    const hd = page.locator('#qi-page .qi-day[data-day="2026-09-22"] .qi-day-hd');
    const box = await hd.boundingBox();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 80, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width - 140, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#qi-page .qi-day[data-day="2026-09-22"] .ios-swipe')).toHaveClass(/open/);
    await page.locator('#qi-page .qi-day[data-day="2026-09-22"] .qi-billed').click();
    const r = await page.evaluate(() => {
      const c = getClientById(701);
      return { msg: window._rtbMsg, elsewhere: c.qiElsewhere, page: document.querySelector('.pg.active').id,
        days: [...document.querySelectorAll('#qi-page .qi-day[data-day]')].map(d => d.dataset.day), total: _qiTotal() };
    });
    expect(r.msg).toContain('This day was already billed outside TradeDesk?');
    expect(r.elsewhere).toHaveLength(1);
    expect(r.elsewhere[0].days).toEqual(['2026-09-22']);
    expect(r.elsewhere[0].expIds).toEqual(['x1', 'x2']);
    expect(r.page).toBe('pg-qi');
    expect(r.days).toEqual(['2026-09-23', '2026-09-24']);
    expect(r.total).toBe(412.5);                                // 5.5 hrs at $75, no receipts left
  });

  test('swiping the last day off goes home, nothing is left to bill', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window.zConfirm = (msg, yes) => yes();
      openQuickInvoice(702); await new Promise(r => setTimeout(r, 30));
      qiBilledElsewhere('2026-09-23');
      return { page: document.querySelector('.pg.active').id, qi: _qi, days: getClientById(702).qiElsewhere[0].days };
    });
    expect(r).toEqual({ page: 'pg-dash', qi: null, days: ['2026-09-23'] });
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

// ── The customer's copy, Save, set price, photos (owner 2026-09-29) ─────────
// Owner: "we do not want to show the price per employee", "putting nine hours
// on their [bill] confuse them", "No. Draft doesn't show a number", "the save
// in the top right hand corner on their proposals needs to carry over", "a
// preview button down at the bottom next to send", "allow them to set a fixed
// price", and TrueShot's before and after on the bill.
test.describe('Invoice: the customer copy', () => {
  const doc = (page) => page.evaluate(() => _qiDocHtml());
  // Illinois (the fixture's state) requires the rate on a T&M bill, so these
  // run at a Kansas house, where he decides; the Arizona test covers the lock.
  const ks = (page) => page.evaluate(() => { getClientById(701).addr = '2210 Birch Ln, Topeka, KS 66615'; });

  test('the invoice has its number from the moment it opens, on the screen, the preview and the sent bill', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const num = _qiNum(), sub = document.querySelector('#qi-page .ios-sub').textContent, d = _qiDocHtml();
      const bid = qiSend();
      return { num, sub, inDoc: d.includes(num), sent: 'INV-' + String(bid.id).slice(-6) };
    });
    expect(r.num).toMatch(/^INV-\w{6}$/);
    expect(r.sub).toContain(r.num);
    expect(r.inDoc).toBe(true);
    expect(r.sent).toBe(r.num);
  });

  test('by default: each day is the work, time on site and crew size; no names, no man-hours, no rate, parts included', async ({ page }) => {
    await boot(page);
    await ks(page);
    await page.evaluate(() => { S.qiRiders = { 'John Miller': 'Jack Sample' }; });
    await open(page, 701);
    await page.evaluate(() => { _qi.dayNote['2026-09-22'] = 'Replaced the main shutoff'; });
    const d = await doc(page);
    expect(d).toContain('Replaced the main shutoff');
    expect(d).toContain('Labor · 6 hrs on site · 2 techs');     // two people for 6 hours, never "12 hrs"
    expect(d).not.toContain('12 hrs');
    expect(d).not.toContain('Jack');
    expect(d).not.toContain('John Miller');
    expect(d).not.toContain('/hr');
    // Parts: in the total, not listed, by default (owner 2026-09-29).
    expect(d).not.toMatch(/(Parts|Materials)/);
    expect(d).not.toContain('$186.00');                          // the parts money is only inside the day's total
    expect(d).toContain('$1,386.00');
  });

  test('Show my hourly rate and parts With prices put them on; Always makes it every invoice', async ({ page }) => {
    await boot(page);
    await ks(page);
    await page.evaluate(() => { S.qiRiders = { 'John Miller': 'Jack Sample' }; });
    await open(page, 701);
    const r = await page.evaluate(() => {
      document.getElementById('qi-show-rate').click();
      document.querySelector('#qi-parts-mode [data-mode="priced"]').click();
      const d = _qiDocHtml();
      const n = [...document.querySelectorAll('#qi-page .qi-always')].filter(b => b.textContent === 'Always').length;
      document.querySelector('#qi-page .qi-always').click();
      document.querySelector('#qi-page .qi-always').click();
      openQuickInvoice(701, '');
      return { d, n, copy: JSON.parse(JSON.stringify(S.copyShow)), next: { rate: _qiShowRate(), parts: _qiPartsMode() } };
    });
    expect(r.d).toContain('$75 to $125/hr');
    expect(r.d).toContain('$186.00');
    expect(r.d).toContain('$1,200.00');                          // labor on its own line once parts are shown
    expect(r.n).toBe(2);
    expect(r.copy.invoice).toEqual({ rate: true, partsMode: 'priced' });
    expect(r.next).toEqual({ rate: true, parts: 'priced' });
  });

  // Owner 2026-09-29: "default to show a total price not showing materials
  // and prices ... toggle it on if they want to show the materials no price
  // and a third to show materials and price".
  test('parts three ways: total only (default), listed without prices, listed with prices; the total never changes', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      _qiAddPart();
      const i = _qi.typed.length - 1;
      _qi.typed[i].desc = 'Supply line'; _qi.typed[i].amount = '18';
      _qiQtyStep(i, 1);
      const seen = {};
      ['total', 'items', 'priced'].forEach(m => {
        _qiSetPartsMode(m);
        const d = _qiDocHtml(), items = _qiCustomerItems();
        seen[m] = { list: d.includes('2 supply lines') || d.includes('2 × Supply line'), price: d.includes('$36.00'), receipts: items.some(l => /Materials$/.test(l.desc) && l.amount === 186),
          total: _qiTotal(), sum: Math.round(items.reduce((s2, l) => s2 + l.amount, 0) * 100) / 100 };
      });
      return { def: copyPartsMode('invoice'), seen, qty: _qi.typed[i].qty, seg: [...document.querySelectorAll('#qi-parts-mode button')].map(b => b.textContent) };
    });
    expect(r.def).toBe('total');
    expect(r.qty).toBe(2);
    expect(r.seg).toEqual(['Total only', 'List them', 'With prices']);
    expect(r.seen.total).toEqual({ list: false, price: false, receipts: false, total: 1084.5, sum: 1084.5 });
    expect(r.seen.items).toEqual({ list: true, price: false, receipts: false, total: 1084.5, sum: 1084.5 });
    expect(r.seen.priced).toEqual({ list: true, price: true, receipts: true, total: 1084.5, sum: 1084.5 });
  });

  test('a part has a count: minus and plus change it, never below one, and the line is count times the price of one', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      document.getElementById('qi-add-part').click();
      const row = [...document.querySelectorAll('#qi-page .qi-part')].pop();
      row.querySelector('.qi-desc').value = 'Fill valve'; row.querySelector('.qi-desc').dispatchEvent(new Event('input'));
      const price = row.querySelector('.ios-val input'); price.value = '22'; price.dispatchEvent(new Event('input'));
      const [minus, plus] = row.querySelectorAll('.qi-qty button');
      plus.click(); plus.click(); const three = { n: row.querySelector('.qi-qty b').textContent, total: document.getElementById('qi-total').textContent };
      minus.click(); minus.click(); minus.click(); minus.click();
      return { three, floor: row.querySelector('.qi-qty b').textContent, line: _qiLines().find(l => l.part) };
    });
    expect(r.three).toEqual({ n: '3', total: '$1,114.50' });
    expect(r.floor).toBe('1');
    expect(r.line.amount).toBe(22);
  });

  test('where the state requires the rate on a time and materials bill, the switch is on and locked', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { getClientById(701).addr = '2210 Birch Ln, Phoenix, AZ 85001'; });
    await open(page, 701);
    const r = await page.evaluate(() => ({ locked: document.getElementById('qi-show-rate').disabled, on: _qiShowRate(), doc: _qiDocHtml().includes('/hr') }));
    expect(r).toEqual({ locked: true, on: true, doc: true });
  });

  test('the proposal and the invoice read one setting for the rate, each with its own starting point', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      delete S.copyShow; delete S.tmHideRate;
      const start = { proposal: copyShows('proposal', 'rate'), invoice: copyShows('invoice', 'rate'), parts: copyShows('invoice', 'parts') };
      _tmSetHideRate(true);
      return { start, proposal: copyShows('proposal', 'rate'), legacy: S.tmHideRate, def: _tmHideRateDefault() };
    });
    expect(r.start).toEqual({ proposal: true, invoice: false, parts: false });
    expect(r.proposal).toBe(false);
    expect(r.legacy).toBe(true);
    expect(r.def).toBe(true);
  });

  test('Save keeps the invoice as a draft on Ready to bill; it is not a sale and it opens again as he left it', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      const n = bids.length, id = _qi.id;
      _qi.dayNote['2026-09-23'] = 'Snaked the kitchen drain';
      document.querySelector('#qi-page .qi-day[data-day="2026-09-24"] .qi-chk-btn').click();
      document.getElementById('qi-fixed-on').click();
      const f = document.getElementById('qi-fixed'); f.value = '900'; f.dispatchEvent(new Event('input'));
      document.getElementById('qi-save').click();
      _renderToBill();
      const home = document.querySelector('#dash-to-bill .tb-sub') && [...document.querySelectorAll('#dash-to-bill .tb-row')].map(b => b.textContent);
      const saved = { bids: bids.length - n, page: document.querySelector('.pg.active').id };
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      return { saved, home, back: { id: _qi.id === id, note: _qi.dayNote['2026-09-23'], off: [..._qi.off], fixed: _qi.fixed, total: document.getElementById('qi-total').textContent } };
    });
    expect(r.saved).toEqual({ bids: 0, page: 'pg-dash' });
    expect(r.home.join(' ')).toContain('Draft ·');
    expect(r.home.join(' ')).toContain('$900');
    expect(r.back).toEqual({ id: true, note: 'Snaked the kitchen drain', off: ['2026-09-24'], fixed: 900, total: '$900.00' });
  });

  test('sending a saved draft sends it once and clears the draft', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      qiSaveDraft();
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      const bid = qiSend();
      return { drafts: Object.keys(getClientById(701).qiDrafts || {}).length, kind: bid.kind };
    });
    expect(r).toEqual({ drafts: 0, kind: 'quick_invoice' });
  });

  test('a set price: the customer sees the work and one number; the days are still billed', async ({ page }) => {
    await boot(page);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      document.getElementById('qi-fixed-on').click();
      const start = document.getElementById('qi-total').textContent;
      const f = document.getElementById('qi-fixed'); f.value = '950'; f.dispatchEvent(new Event('input'));
      const d = _qiDocHtml();
      const bid = qiSend();
      return { start, hrs: /hrs? on site/.test(d), has: d.includes('$950.00'), amount: bid.amount, days: bid.qiDays, items: bid.lineItems.length };
    });
    expect(r.start).toBe('$1,048.50');
    expect(r.hrs).toBe(false);
    expect(r.has).toBe(true);
    expect(r.amount).toBe(950);
    expect(r.days).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(r.items).toBe(1);
  });

  test('before and after from TrueShot: the newest pair at this house goes on; tap for another; the switch takes them off', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const ph = (id, type, at) => ({ id, type, client_id: 701, addr: '2210 Birch Ln, Springfield, IL', thumbUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', uploadedAt: at });
      photos.splice(0, photos.length, ph(1, 'before', '2026-09-22T15:00:00Z'), ph(2, 'before', '2026-09-22T16:00:00Z'), ph(3, 'after', '2026-09-24T16:00:00Z'),
        Object.assign(ph(4, 'after', '2026-09-24T16:00:00Z'), { client_id: 702 }));
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      const first = _qiPhotoPair();
      const d1 = _qiDocHtml();
      _qiPhotoNext('before');
      const second = _qiPhotoPair().before.id;
      document.getElementById('qi-photos-on').click();
      const d2 = _qiDocHtml();
      return { b: first.before.id, a: first.after.id, docHas: />Before</.test(d1) && />After</.test(d1), second, off: />Before</.test(d2) };
    });
    expect(r.b, 'the newest Before').toBe(2);
    expect(r.a, 'this customer only').toBe(3);
    expect(r.docHas).toBe(true);
    expect(r.second).toBe(1);
    expect(r.off).toBe(false);
  });

  // Owner 2026-09-29: "I don't even think Settings is the right spot for your
  // hourly rate. I think it belongs under team."
  test('rates live under Team: yours and the default; Settings points there; the invoice reads them', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      goPg('pg-team'); renderTeam();
      const own = document.getElementById('team-owner-rate'), def = document.getElementById('team-labor-rate');
      const before = { own: own.value, def: def.value };
      own.value = '140'; own.dispatchEvent(new Event('change'));
      def.value = '65'; def.dispatchEvent(new Event('change'));
      return { before, owner: S.ownerBillRate, labor: S.laborRate, johnRate: _qiRateFor('John Miller'), stranger: _qiRateFor('Rico Diaz'),
        settingsField: !!document.getElementById('set-labor-rate'), toTeam: !!document.getElementById('set-rates-team') };
    });
    expect(r.before).toEqual({ own: '125', def: '70' });
    expect(r.owner).toBe(140);
    expect(r.labor).toBe(65);
    expect(r.johnRate, 'the owner bills his own rate').toBe(140);
    expect(r.stranger, 'anyone without a rate gets the default').toBe(65);
    expect(r.settingsField, 'the old Settings box is gone').toBe(false);
    expect(r.toTeam).toBe(true);
  });

  // Owner 2026-09-29: "rate should go on the person right?" The You / Everyone
  // else box read as two more people; each rate now sits on its own row.
  test('each person carries their own bill rate on their Team row; the default is one quiet line', async ({ page }) => {
    await boot(page, 390);
    const r = await page.evaluate(() => {
      goPg('pg-team'); renderTeam();
      const list = document.getElementById('team-page-list');
      const jack = document.getElementById('team-bill-0');
      const before = jack.value;
      jack.value = '80'; jack.dispatchEvent(new Event('change'));
      const ownerRow = document.getElementById('team-owner-rate').closest('div[style]').parentElement.textContent;
      return { before, jackRate: _qiRateFor('Jack Sample'), stored: S.employees[0].billRate, ownerRow,
        oldBox: /What you bill an hour|Everyone else/.test(list.textContent),
        defaultLine: document.getElementById('team-rates').textContent,
        bleed: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r.before).toBe('75');
    expect(r.stored).toBe(80);
    expect(r.jackRate, 'the invoice reads the rate set on his row').toBe(80);
    expect(r.ownerRow).toContain('You');
    expect(r.oldBox, 'no separate You / Everyone else box').toBe(false);
    expect(r.defaultLine).toContain('Anyone without a rate bills');
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  // Owner 2026-09-29: "streamline how T&M proposals look so invoices look the
  // exact same ... what do we call the payment step in the other things?"
  test('same top and bar as the T&M estimate: Back, Invoice, Save; the customer large; Tim, Collect, Send it; See what they get under the page', async ({ page }) => {
    await boot(page, 390);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('#qi-page .ios-nav');
      const bar = document.getElementById('qi-dock');
      const out = {
        nav: [...nav.querySelectorAll('button')].map(b => b.textContent.trim()), navTitle: nav.querySelector('.ios-navtitle').textContent,
        title: document.querySelector('#qi-page .ios-title').textContent, sub: document.querySelector('#qi-page .ios-sub').textContent,
        bar: [...bar.querySelectorAll('.ios-btn')].map(b => b.id), tim: !!bar.querySelector('.tm-dock-tim'),
        appBars: ['mobile-topbar', 'mobile-tabbar'].map(id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'none'; }),
        collect: document.getElementById('qi-paynow').textContent, see: document.getElementById('qi-preview').textContent,
        bleed: document.documentElement.scrollWidth - innerWidth,
      };
      document.getElementById('qi-preview').click();
      out.preview = !!document.getElementById('_prop-preview-ov');
      out.phone = _qiDocHtml().includes('(555) 555-0101') && _propPhone('5555550101') === '(555) 555-0101';
      return out;
    });
    expect(r.nav).toEqual(['Back', 'Save']);
    expect(r.navTitle).toBe('Invoice');
    expect(r.title).toBe('Tagen Miller');
    expect(r.sub).toMatch(/^INV-\d{6} · 2210 Birch Ln$/);
    expect(r.bar).toEqual(['qi-paynow', 'qi-send']);
    expect(r.tim).toBe(true);
    expect(r.appBars, 'full screen while he works, like the estimate').toEqual(['none', 'none']);
    expect(r.collect, 'the word every screen uses for the Get paid panel').toBe('Collect');
    expect(r.see).toBe('See what they get');
    expect(r.preview).toBe(true);
    expect(r.phone, 'the phone prints the way the proposal prints it').toBe(true);
    expect(r.bleed).toBeLessThanOrEqual(1);
    assertNoErrors(page, 'invoice copy');
  });
});

// ── Add time from the day (Jack 2026-09-29, the Tagen Burnett bid) ─────────
// Owner's rules: time on site and the first drive there count by themselves;
// a supply run that leaves his house and comes straight back counts too
// (labeled, one tap takes it off); everything else from that day waits in
// Add time, checked already when he was the only customer that day.
test.describe('Invoice: add time from the day', () => {
  const day = async (page, opts) => page.evaluate((opts) => {
    getClientById(701).addr = '2210 Birch Ln, Topeka, KS 66615';
    const T = (h, m) => '2026-09-25T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00.000Z';
    const r = (id, src, from, to, a, z, mins) => ({ id, job_id: null, employee_user_id: 'jack-uid', source: src, origin_place: from, dest_place: to, arrived_at: a, departed_at: z, minutes: mins });
    const H = 'Tagen Miller (2210 Birch Ln)';
    const entries = [
      r(101, 'drive', 'Shop', H, T(13, 0), T(13, 20), 20),
      r(102, 'client', null, H, T(13, 20), T(15, 20), 120),
      r(103, 'drive', H, 'Ferguson', T(15, 20), T(15, 35), 15),
      r(104, 'place', null, 'Ferguson', T(15, 35), T(15, 55), 20),
      r(105, 'drive', 'Ferguson', H, T(15, 55), T(16, 10), 15),
      r(106, 'client', null, H, T(16, 10), T(18, 10), 120),
      r(107, 'drive', H, 'Shop', T(18, 10), T(18, 30), 20),
    ];
    if (opts && opts.second) entries.push(r(108, 'client', null, 'Mary Smith (77 Lakeview Dr)', T(19, 0), T(20, 0), 60));
    window._rtbLab = { name: { 'jack-uid': 'Jack Sample' }, entries, shopEntries: [{ id: 201, employee_user_id: 'jack-uid', arrived_at: T(18, 30), departed_at: T(19, 0), minutes: 30 }] };
    expenses.splice(0, expenses.length);
  }, opts);
  const openIt = (page) => page.evaluate(async () => { openQuickInvoice(701); await new Promise(r => setTimeout(r, 60)); _qi.open.add('2026-09-25'); renderQuickInvoice(); });
  const jack = () => _qi.tracked.filter(l => l.who === 'Jack Sample').map(l => ({ mins: l.mins, extra: l.extra || null }));

  test('on site and the first drive there count by themselves; the supply run between two visits counts too, labeled', async ({ page }) => {
    await boot(page);
    await day(page);
    await openIt(page);
    const r = await page.evaluate((jack) => {
      const f = new Function('return (' + jack + ')()');
      return { lines: f(), text: document.getElementById('qi-page').textContent, total: _qiTotal() };
    }, jack.toString());
    expect(r.lines).toEqual([{ mins: 260, extra: null }, { mins: 15, extra: 'e103' }, { mins: 20, extra: 'e104' }, { mins: 15, extra: 'e105' }]);
    expect(r.text).toContain('Ferguson · 20m, between visits');
    expect(r.total).toBe(387.5);                               // 310 minutes at $75
  });

  test('Add time lists the rest of the day; he was the only customer, so opening it checks them and they count', async ({ page }) => {
    await boot(page);
    await day(page);
    await openIt(page);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('qi-addtime-2026-09-25');
      const label = btn.textContent;
      btn.click();
      const rows = [...document.querySelectorAll('#qi-page .qi-x-row')].map(b => ({ t: b.querySelector('.ios-lbl').firstChild.textContent, on: b.getAttribute('aria-pressed') }));
      const note = !!document.querySelector('#qi-page .qi-xnote');
      const total = _qiTotal();
      document.querySelectorAll('#qi-page .qi-x-row')[1].click();       // the shop was not his
      const after = _qiTotal();
      const d = _qiDocHtml();
      return { label, rows, note, total, after, doc: /Labor · 6 hrs on site/.test(d) || /Labor · 5.\d hrs on site/.test(d) };
    });
    expect(r.label).toBe('Add time from this day (2)');
    expect(r.rows).toEqual([{ t: 'Drive · Here to Shop', on: 'true' }, { t: 'Shop', on: 'true' }]);
    expect(r.note).toBe(true);
    expect(r.total).toBe(450);                                  // 360 minutes at $75
    expect(r.after).toBe(412.5);
    expect(r.doc).toBe(true);
  });

  test('another customer the same day: nothing is checked for him; the run between his visits still counts', async ({ page }) => {
    await boot(page);
    await day(page, { second: true });
    await openIt(page);
    const r = await page.evaluate(() => {
      document.getElementById('qi-addtime-2026-09-25').click();
      return { on: [...document.querySelectorAll('#qi-page .qi-x-row')].map(b => b.getAttribute('aria-pressed')), note: !!document.querySelector('#qi-page .qi-xnote'), total: _qiTotal() };
    });
    expect(r.on).toEqual(['false', 'false']);
    expect(r.note).toBe(false);
    expect(r.total).toBe(387.5);
  });

  test('one tap takes the run between visits off; time pulled onto a bill is never offered again', async ({ page }) => {
    await boot(page);
    await day(page);
    await openIt(page);
    const r = await page.evaluate(async () => {
      const i = _qi.tracked.findIndex(l => l.extra === 'e104');
      _qiDropTracked(i);
      const dropped = _qiTotal();
      _qiExtraOpen('2026-09-25');
      const bid = qiSend();
      // Everything pulled is marked on the bill, so no invoice (his or another
      // customer's) can offer it again; the day itself is billed.
      return { dropped, pulled: bid.qiPulled.sort(), marked: [..._qiPulledAll()].sort(), days: bid.qiDays };
    });
    expect(r.dropped).toBe(362.5);
    expect(r.pulled).toEqual(['e103', 'e105', 'e107', 's201']);
    expect(r.marked).toEqual(['e103', 'e105', 'e107', 's201']);
    expect(r.days).toEqual(['2026-09-25']);
  });

  test('drive time off leaves every drive off, the first one and the ones he adds', async ({ page }) => {
    await boot(page);
    await day(page);
    await page.evaluate(() => { S.qiBillDrive = false; });
    await openIt(page);
    const r = await page.evaluate(() => { _qiExtraOpen('2026-09-25'); return _qi.tracked.filter(l => l.who === 'Jack Sample').map(l => l.extra || 'base'); });
    expect(r).toEqual(['base', 'e104', 's201']);
  });
});

test.describe('Ready to bill: drafts', () => {
  test('saved invoices sit in a Drafts group at the top; the rest are Not started', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      openQuickInvoice(702); await new Promise(r => setTimeout(r, 30));
      qiSaveDraft();
      _tbExpanded = true; _renderToBill();
      const el = document.getElementById('dash-to-bill');
      return { groups: [...el.querySelectorAll('.tb-grp')].map(g => g.textContent), names: [...el.querySelectorAll('.tb-name')].map(n => n.textContent),
        age: el.querySelector('.tb-age').textContent, draftRow: el.querySelector('.tb-row').classList.contains('tb-draft') };
    });
    expect(r.groups).toEqual(['Drafts', 'Not started']);
    expect(r.names).toEqual(['Mary Smith', 'Tagen Miller']);
    expect(r.age).toContain('2 houses · 1 draft');
    expect(r.draftRow).toBe(true);
  });
});
