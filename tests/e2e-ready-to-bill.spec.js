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
    delete S.qiRiders; delete S.qiBillDrive; delete S.crewNoApp;
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
    window.__realSend = window.__realSend || window._sendPaidInvoice;   // the start-to-finish test puts it back
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
    expect(r.text).toContain('3 days not billed yet');
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
      const bid = (_qi && (_qi.due = _qi.due || 'receipt'), qiSend());
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
      _qi.due = 'receipt'; renderQuickInvoice();   // he picked when it is due
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
    expect(r.opened.lines, 'what was done, Jack and Materials (+ Add person is once, above the days)').toBe(3);
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

  test('Uncheck all and Check all flip every day at once', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const btn = () => document.querySelector('#qi-page .ios-h button');
      const first = btn().textContent; btn().click();
      const none = document.getElementById('qi-total').textContent, second = btn().textContent; btn().click();
      return { first, none, second, all: document.getElementById('qi-total').textContent };
    });
    expect(r).toEqual({ first: 'Uncheck all', none: '$0.00', second: 'Check all', all: '$1,048.50' });
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

  // Owner 2026-09-29: "that person shouldn't just ride along forever ... we
  // type them up and their rate and it doubles the man hours". CHANGED
  // (§10.4): riders were a setting (S.qiRiders) asked once and remembered for
  // every invoice. Now + Add person is on the invoice itself and forgotten
  // after it; only the rate stays, on the person.
  test('+ Add person from the team: every day gets the hours of whoever worked it, at their own rate; a day they tracked keeps their own', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._rtbLab.entries.push({ job_id: null, employee_user_id: 'boss-uid', source: 'client', dest_place: 'Tagen Miller (2210 Birch Ln)',
        arrived_at: '2026-09-24T15:00:00.000Z', departed_at: '2026-09-24T16:00:00.000Z', minutes: 60 });
      openQuickInvoice(701);
      await new Promise(r => setTimeout(r, 30));
      document.getElementById('qi-add-person').click();
      const rows = [...document.querySelectorAll('#qi-page .qi-person-row')].map(b => [b.dataset.who, b.getAttribute('aria-pressed')]);
      const john = _qi.tracked.filter(l => l.who === 'John Miller').map(l => ({ day: l.day, mins: l.mins, rate: l.rate, rider: l.rider || null }));
      const folded = document.querySelector('#qi-page .qi-people-row small').textContent;
      return { rows, john, folded };
    });
    // John tracked the 24th himself, so he is already checked.
    expect(r.rows).toEqual([['Jack Sample', 'true'], ['John Miller', 'true']]);
    expect(r.folded).toBe('Jack, John');
    expect(r.john).toEqual([{ day: '2026-09-24', mins: 60, rate: 125, rider: null }]);
  });

  test('+ Add person: the owner rides every day at his rate, and his hours for one day can be changed', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      document.getElementById('qi-add-person').click();
      const choices = [...document.querySelectorAll('#qi-page .qi-person-row[aria-pressed="false"]')].map(b => b.dataset.who);
      document.querySelector('#qi-page .qi-person-row[data-who="John Miller"]').click();
      const john = _qi.tracked.filter(l => l.who === 'John Miller').map(l => [l.day, l.mins]);
      _qiDayOpen('2026-09-22');
      const inp = document.querySelector('#qi-page .qi-day[data-day="2026-09-22"] .qi-hrs input');
      inp.value = '4'; inp.dispatchEvent(new Event('change'));
      const after = _qi.tracked.find(l => l.who === 'John Miller' && l.day === '2026-09-22');
      return { choices, john, after: [after.mins, after.amount], other: _qi.tracked.find(l => l.who === 'John Miller' && l.day === '2026-09-23').mins,
        remembered: S.qiRiders || null, folded: document.querySelector('#qi-page .qi-people-row small').textContent };
    });
    expect(r.choices).toEqual(['John Miller']);
    expect(r.john).toEqual([['2026-09-22', 360], ['2026-09-23', 210], ['2026-09-24', 120]]);
    expect(r.after, 'John left early: 4 hours at $125').toEqual([240, 500]);
    expect(r.other, 'only that day moves').toBe(210);
    expect(r.remembered, 'nothing rides along to the next invoice').toBeNull();
    expect(r.folded).toBe('Jack, John');
  });

  test('two people with no app: typed with a rate, they double the man-hours, and next time it is just the name', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      document.getElementById('qi-add-person').click();
      const add = (n, rate) => {
        document.getElementById('qi-new-name').value = n; document.getElementById('qi-new-rate').value = rate;
        [...document.querySelectorAll('#qi-page .qi-new button')].find(b => b.textContent === 'Add').click();
      };
      add('Mike Dunn', '60'); add('Sam Ortiz', '55');
      const day = _qi.tracked.filter(l => l.day === '2026-09-22' && l.kind === 'time').map(l => [l.who, l.mins, l.rate]);
      const kept = JSON.parse(JSON.stringify(S.crewNoApp));
      _qi = null; openQuickInvoice(701); await new Promise(r => setTimeout(r, 30));
      const fresh = _qi.tracked.some(l => l.who === 'Mike Dunn');
      document.getElementById('qi-add-person').click();
      const offered = [...document.querySelectorAll('#qi-page .qi-person-row[aria-pressed="false"]')].map(b => b.dataset.who);
      return { day, kept, fresh, offered, rate: personBillRate('Mike Dunn') };
    });
    expect(r.day).toEqual([['Jack Sample', 360, 75], ['Mike Dunn', 360, 60], ['Sam Ortiz', 360, 55]]);
    expect(r.kept).toEqual([{ name: 'Mike Dunn', billRate: 60 }, { name: 'Sam Ortiz', billRate: 55 }]);
    expect(r.fresh, 'not on the next invoice by itself').toBe(false);
    expect(r.offered).toEqual(['John Miller', 'Mike Dunn', 'Sam Ortiz']);
    expect(r.rate).toBe(60);
  });

  test('an added person can come off one day, or off the whole invoice', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      _qiAddPerson('John Miller');
      const i = _qi.tracked.findIndex(l => l.who === 'John Miller' && l.day === '2026-09-23');
      _qiDropTracked(i);
      const oneOff = _qi.tracked.filter(l => l.who === 'John Miller').map(l => l.day);
      document.getElementById('qi-add-person').click();
      document.querySelector('#qi-page .qi-person-row[data-who="John Miller"]').click();
      return { oneOff, gone: _qi.tracked.some(l => l.who === 'John Miller'), crew: _qi.crew.slice() };
    });
    expect(r.oneOff).toEqual(['2026-09-22', '2026-09-24']);
    expect(r).toMatchObject({ gone: false, crew: [] });
  });

  test('someone who tracked their own time can be unchecked off the whole bill, and checked back', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      document.getElementById('qi-add-person').click();
      document.querySelector('#qi-page .qi-person-row[data-who="Jack Sample"]').click();
      const off = { jack: _qi.tracked.some(l => l.who === 'Jack Sample'), checked: document.querySelector('#qi-page .qi-person-row[data-who="Jack Sample"]').getAttribute('aria-pressed') };
      document.querySelector('#qi-page .qi-person-row[data-who="Jack Sample"]').click();
      return { off, back: _qi.tracked.filter(l => l.who === 'Jack Sample').length };
    });
    expect(r.off).toEqual({ jack: false, checked: 'false' });
    expect(r.back).toBe(3);
  });

  // Owner 2026-09-29: "a hidden obvious way to put corrected manual time in
  // if you don't agree", then: "what the hell does fix hours mean, what does
  // edited tracked 3 hr 30 minutes mean". CHANGED (§10.4): no "fix hours"
  // link; the hours are a box like the rate, and a change says so in words.
  test('changing hours: tap the hours, type, the line says the phone said otherwise, Put it back restores them', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      _qiDayOpen('2026-09-22');
      const day = () => document.querySelector('#qi-page .qi-day[data-day="2026-09-22"]');
      const before = day().querySelector('.qi-time .qi-from').textContent;
      const inp = day().querySelector('.qi-time .qi-hrs input');
      inp.value = '5'; inp.dispatchEvent(new Event('change'));
      const jack = _qi.tracked.find(l => l.day === '2026-09-22' && l.who === 'Jack Sample');
      const note = day().querySelector('.qi-edited').textContent;
      const other = _qi.tracked.find(l => l.day === '2026-09-23' && l.who === 'Jack Sample').mins;
      _qiAddPerson('John Miller');
      const john = _qi.tracked.find(l => l.day === '2026-09-22' && l.who === 'John Miller').mins;
      const doc = _qiDocHtml();
      [...day().querySelectorAll('.qi-fix')].find(b => b.textContent === 'Put it back').click();
      const back = _qi.tracked.find(l => l.day === '2026-09-22' && l.who === 'Jack Sample');
      return { before, jack: [jack.mins, jack.amount, jack.orig], note, other, john, doc5: doc.includes('5 hrs'), back: [back.mins, !!back.edited],
        gone: [...document.querySelectorAll('#qi-page button')].some(b => /fix hours/i.test(b.textContent)) };
    });
    expect(r.before).toBe('From the phone: 6h on site');
    expect(r.jack).toEqual([300, 375, 360]);
    expect(r.note).toBe('You changed this. The phone said 6h.');
    expect(r.other, 'only that day').toBe(210);
    expect(r.john, 'someone added beside him follows the changed hours').toBe(300);
    expect(r.doc5, 'the customer copy bills the changed hours').toBe(true);
    expect(r.back).toEqual([360, false]);
    expect(r.gone, 'no "fix hours" jargon').toBe(false);
  });

  test('the invoice is four numbered steps: The work, Time, Materials, Review with the math', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => ({
      steps: [...document.querySelectorAll('#qi-page .ios-stephead .t')].map(t => t.textContent),
      math: [...document.querySelectorAll('#qi-page .qi-math-box .ios-row')].map(x => x.querySelector('.ios-lbl').firstChild.textContent + '=' + x.querySelector('.ios-fact').textContent),
      send: document.getElementById('qi-send-total').textContent,
      // Each setting sits in the step it is about, out in the open (owner
      // 2026-09-29: "why is drive time in options and not with time?").
      where: ['qi-drive', 'qi-fixed-on', 'qi-show-rate', 'qi-parts-mode'].map(id => {
        const el = document.getElementById(id); let n = el; const heads = [...document.querySelectorAll('#qi-page .ios-stephead')];
        return heads.filter(h => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).map(h => h.querySelector('.t').textContent).pop() + ':' + (el.offsetParent !== null);
      }),
      drawer: !!document.querySelector('#qi-page .qi-opts'),
    }));
    expect(r.steps).toEqual(['The work', 'Time', 'Materials', 'Review']);
    expect(r.math).toEqual(['Labor=$862.50', 'Materials=$186.00', 'Total=$1,048.50']);
    expect(r.send).toBe('$1,048.50');
    expect(r.where).toEqual(['Time:true', 'Review:true', 'Review:true', 'Review:true']);
    expect(r.drawer, 'no Options drawer').toBe(false);
  });

  test('fix hours refuses junk, a negative and more than a day', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => ['abc', '-3', '25', ''].map(v => { _qiRiderSet('2026-09-22', 'Jack Sample', v); return _qi.tracked.find(l => l.day === '2026-09-22' && l.who === 'Jack Sample').mins; }));
    expect(r).toEqual([360, 360, 360, 360]);
  });

  // Owner 2026-09-29: "add in when you will bill, is it due on completion?
  // Remember that can't default."
  test('when it is due: nothing picked, the bar asks, Send waits; the pick prints on their copy and saves on the invoice', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const before = { bar: document.getElementById('qi-next')?.textContent, send: !!document.getElementById('qi-send'),
        lit: document.querySelectorAll('#qi-due .ios-seg button.on').length, sent: qiSend() };
      document.getElementById('qi-next').click();
      const asking = document.getElementById('qi-due').classList.contains('asking');
      document.querySelector('#qi-due button[data-due="15"]').click();
      const after = { send: document.getElementById('qi-send')?.textContent, doc: _qiDocHtml() };
      const bid = qiSend();
      return { before, asking, after: { send: after.send, due: /Due by [A-Z][a-z]{2} \d{1,2}/.test(after.doc) }, saved: [bid.qiDue, bid.dueDate] };
    });
    expect(r.before).toEqual({ bar: "Pick when it's due", send: false, lit: 0, sent: false });
    expect(r.asking).toBe(true);
    expect(r.after.send).toContain('Send it');
    expect(r.after.due).toBe(true);
    expect(r.saved[0]).toBe('15');
    expect(r.saved[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('Collect is paid now, so it does not ask when it is due; a missing rate still comes first on the bar', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { S.employees[0].billRate = 0; S.laborRate = 0; });
    await open(page, 701);
    const r = await page.evaluate(() => {
      const bar = document.getElementById('qi-next').textContent;
      _qi.tracked.filter(l => l.kind === 'time').forEach(l => { l.rate = 75; l.amount = Math.round(l.mins / 60 * 75 * 100) / 100; });
      window.openPayPanel = () => {};
      const paid = qiPayNow();
      return { bar, paid: !!paid };
    });
    expect(r.bar).toBe("Add Jack's rate");
    expect(r.paid).toBe(true);
  });

  test('a junk due value is ignored, and a saved draft keeps the pick', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(async () => {
      _qiSetDue('tomorrow'); _qiSetDue(null); const junk = _qi.due;
      _qiSetDue('7'); qiSaveDraft();
      _qi = null; openQuickInvoice(701); await new Promise(r => setTimeout(r, 30));
      return { junk, kept: _qi.due };
    });
    expect(r).toEqual({ junk: null, kept: '7' });
  });

  test('one line per person: the hours box is the whole day, runs included; changing it keeps the runs; the × takes the person off that day', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      getClientById(701).addr = '2210 Birch Ln, Topeka, KS 66615';
      const T = (h, m) => '2026-09-25T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00.000Z';
      const r = (id, src, from, to, a, z, mins) => ({ id, job_id: null, employee_user_id: 'jack-uid', source: src, origin_place: from, dest_place: to, arrived_at: a, departed_at: z, minutes: mins });
      const H = 'Tagen Miller (2210 Birch Ln)';
      window._rtbLab = { name: { 'jack-uid': 'Jack Sample' }, entries: [
        r(101, 'drive', 'Shop', H, T(13, 0), T(13, 20), 20), r(102, 'client', null, H, T(13, 20), T(15, 20), 120),
        r(103, 'drive', H, 'Ferguson', T(15, 20), T(15, 35), 15), r(104, 'place', null, 'Ferguson', T(15, 35), T(15, 55), 20),
        r(105, 'drive', 'Ferguson', H, T(15, 55), T(16, 10), 15), r(106, 'client', null, H, T(16, 10), T(18, 10), 120)], shopEntries: [] };
      expenses.splice(0, expenses.length);
    });
    const r = await page.evaluate(async () => {
      openQuickInvoice(701); await new Promise(r => setTimeout(r, 60)); _qi.open.add('2026-09-25'); renderQuickInvoice();
      const day = () => document.querySelector('#qi-page .qi-day[data-day="2026-09-25"]');
      const one = { rows: day().querySelectorAll('.qi-time').length, rates: day().querySelectorAll('.qi-rate').length,
        hrs: day().querySelector('.qi-hrs input').value, amt: day().querySelector('.qi-pamt').textContent, sep: day().querySelector('.qi-math').textContent.includes(' at ') };
      const inp = day().querySelector('.qi-hrs input'); inp.value = '5'; inp.dispatchEvent(new Event('change'));
      const after = { total: _qi.tracked.filter(l => l.day === '2026-09-25' && l.kind === 'time').reduce((s, l) => s + l.mins, 0),
        runs: _qi.tracked.filter(l => l.extra).length, note: day().querySelector('.qi-edited').textContent };
      day().querySelector('.qi-x').click();
      return { one, after, gone: !_qi.tracked.some(l => l.day === '2026-09-25' && l.kind === 'time') };
    });
    expect(r.one).toEqual({ rows: 1, rates: 1, hrs: '5.2', amt: '$387.50', sep: true });
    expect(r.after).toEqual({ total: 300, runs: 3, note: 'You changed this. The phone said 5h 10m.' });
    expect(r.gone).toBe(true);
  });

  test('junk in + Add person adds nobody and never throws', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const n = _qi.tracked.length;
      const res = ['', '   ', null, undefined].map(v => _qiAddPerson(v, 'abc'));
      _qiAddPerson('Pat Lee', '-40');
      return { res, same: _qi.tracked.length, n, rate: personBillRate('Pat Lee'), pat: _qi.tracked.filter(l => l.who === 'Pat Lee').every(l => l.rate >= 0) };
    });
    expect(r.res).toEqual([false, false, false, false]);
    expect(r.rate, 'a negative rate is refused, not flipped').toBe(0);
    expect(r.pat).toBe(true);
  });

  test('the old rider pieces are gone', async ({ page }) => {
    await boot(page);
    // An account that set a rider before this change: the setting is ignored.
    await page.evaluate(() => { S.qiRiders = { 'John Miller': 'Jack Sample' }; });
    await open(page, 701);
    const r = await page.evaluate(() => ({
      fns: ['_qiRiders', '_qiRideAlways', '_qiRiderAskHtml', '_qiRiderPick', '_qiRiderNone', '_qiRiderCandidates', '_qiAddRider', '_qiAddCrewOpen'].filter(f => typeof window[f] === 'function'),
      ask: !!document.getElementById('qi-ask'),
      john: _qi.tracked.some(l => l.who === 'John Miller'),
      everyDay: [...document.querySelectorAll('#qi-page button')].some(b => b.textContent === 'Every day' || b.textContent === 'Add crew'),
    }));
    expect(r).toEqual({ fns: [], ask: false, john: false, everyDay: false });
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
        goPg('pg-dash'); _renderToBill();
        const card = document.getElementById('dash-to-bill').getBoundingClientRect();
        const home = { right: card.right, sw: document.documentElement.scrollWidth };
        openQuickInvoice(701);
        await new Promise(r => setTimeout(r, 30));
        _qiAddPerson('John Miller'); document.getElementById('qi-add-person').click();
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
      const bid = (_qi && (_qi.due = _qi.due || 'receipt'), qiSend());
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
    await open(page, 701);
    await page.evaluate(() => _qiAddPerson('John Miller'));
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
    await open(page, 701);
    await page.evaluate(() => _qiAddPerson('John Miller'));
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
      _matPut('Materials', { label: 'Supply line', qty: 2, unit: 'ea', rate: 18, notes: '' });
      const i = _qi.typed.findIndex(l => l.part);
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
    expect(r.seg).toEqual(['Just the total', 'List the items', 'Items and prices']);
    expect(r.seen.total).toEqual({ list: false, price: false, receipts: false, total: 1084.5, sum: 1084.5 });
    expect(r.seen.items).toEqual({ list: true, price: false, receipts: false, total: 1084.5, sum: 1084.5 });
    expect(r.seen.priced).toEqual({ list: true, price: true, receipts: true, total: 1084.5, sum: 1084.5 });
  });

  // Owner 2026-09-29: "use the same one that's in proposal for T&M and BYO,
  // should carry over to bill and invoices". The invoice's Materials step is
  // the proposals' Materials card (js/materials.js): the same add sheet, the
  // same rows, the same supply house list with Load a quote.
  test('Materials on the invoice is the proposal card: + Add item opens the same sheet, the row is count times price', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const card = document.querySelector('#qi-mat #mat-card');
      card.querySelector('.card-hd button').click();
      const sheet = !!document.getElementById('_byo-add-modal');
      document.getElementById('_bya-label').value = 'Fill valve';
      document.getElementById('_bya-qty').value = '3';
      document.getElementById('_bya-price').value = '22';
      document.querySelector('#_byo-add-modal button.btn-p').click();
      const rows = [...document.querySelectorAll('#qi-mat .mat-rows')].map(e => e.textContent).join(' ');
      return { sheet, rows, line: _qiLines().find(l => l.part), total: document.getElementById('qi-total').textContent,
        sup: !!document.querySelector('#qi-mat #sup-card'),
        load: [...document.querySelectorAll('#qi-mat .sup-actions button')].map(b => b.textContent),
        cards: document.querySelectorAll('#mat-card').length };
    });
    expect(r.sheet).toBe(true);
    expect(r.rows).toContain('Fill valve');
    expect(r.line).toMatchObject({ qty: 3, amount: 66, desc: '3 fill valves' });
    expect(r.total).toBe('$1,114.50');
    expect(r.sup).toBe(true);
    expect(r.load).toEqual(['Send to supply house', 'Load a quote']);
    expect(r.cards).toBe(1);
  });

  test('the supply house list rides on the bill as one Materials line at the marked-up price, never at $0', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const h = _supHost(true);
      const empty = _qiLines().some(l => l.desc === 'Materials' && l.kind === 'line');
      h._supply.items = [{ qty: 2, unit: 'ea', desc: 'Ball valve', cost: 40, on: true }, { qty: 1, unit: 'ea', desc: 'Nipple', cost: 10, on: true }];
      h._supply.vendor = 'Ferguson';
      _supSetMarkup(20); _supSync();              // the box waits for the pause; the sync is what the pause runs
      const line = _qiLines().find(l => l.part);
      return { empty, line, total: _qiTotal(), card: document.querySelector('#qi-mat #sup-card').textContent };
    });
    expect(r.empty).toBe(false);
    expect(r.line).toMatchObject({ desc: 'Materials (Ferguson)', amount: 60 });
    expect(r.total).toBe(1108.5);
    expect(r.card).toContain('Ball valve');
  });

  // Owner 2026-09-29: a supply line Tim misheard ("copper pipe with pex a
  // pipe") had no way to be fixed. Tap it, retype it, the price stays.
  test('a supply house line is tapped and retyped; its price stays; emptied, it goes', async ({ page }) => {
    await boot(page, 390);
    await open(page, 701);
    await page.evaluate(() => { const h = _supHost(true); h._supply.items = [{ qty: 10, unit: 'foot', desc: 'Copper pipe with PEX a pipe', cost: 38, on: true }, { qty: 2, unit: 'ea', desc: 'Sharkbite coupling', cost: 12, on: true }]; _supSync(); });
    await page.locator('#qi-mat .sup-row[data-i="0"] .sup-desc').click();
    const inp = page.locator('#zprompt-inp');
    await inp.fill('10 ft PEX-A pipe');
    await page.locator('#zprompt-ok').click();
    const a = await page.evaluate(() => ({ items: _supData().items.map(it => it.qty + ' ' + it.unit + ' ' + it.desc + ' ' + it.cost), shown: document.querySelector('#qi-mat .sup-row[data-i="0"]').textContent }));
    await page.locator('#qi-mat .sup-row[data-i="1"] .sup-qty').click();
    await page.locator('#zprompt-inp').fill('');
    await page.locator('#zprompt-ok').click();
    const b = await page.evaluate(() => _supData().items.length);
    expect(a.items).toEqual(['10 ft PEX-A pipe 38', '2 ea Sharkbite coupling 12']);
    expect(a.shown).toContain('PEX-A pipe');
    expect(b).toBe(1);
    assertNoErrors(page, 'supply line edit');
  });

  test('edit and delete go through the same card; the old part rows and their stepper are gone', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      _matPut('Materials', { label: 'Wax ring', qty: 1, unit: 'ea', rate: 9, notes: '' }); _matRefresh();
      const i = _qi.typed.findIndex(l => l.part);
      _matWrite(i, { label: 'Wax ring kit', qty: 2, unit: 'ea', rate: 12, notes: '' }); _matRefresh();
      const edited = _qiLines().find(l => l.part);
      _matDel(i);
      return { edited, left: _qi.typed.filter(l => l.part).length,
        gone: [typeof _qiAddPart, typeof _qiQtyStep, typeof _qiMatItem],
        dom: document.querySelectorAll('#qi-add-part, #qi-page .qi-qty, #qi-page .qi-part').length };
    });
    expect(r.edited).toMatchObject({ qty: 2, amount: 24 });
    expect(r.left).toBe(0);
    expect(r.gone).toEqual(['undefined', 'undefined', 'undefined']);
    expect(r.dom).toBe(0);
  });

  test('back on a proposal, the card is the proposal\'s again, not the invoice\'s', async ({ page }) => {
    await boot(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      const onInvoice = _matIsQI();
      openFreeFormEstimate(getClientById(701));
      return { onInvoice, onByo: _matIsQI(), mode: _supMode() };
    });
    expect(r).toEqual({ onInvoice: true, onByo: false, mode: 'byo' });
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
      const bid = (_qi && (_qi.due = _qi.due || 'receipt'), qiSend());
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
      const bid = (_qi && (_qi.due = _qi.due || 'receipt'), qiSend());
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

  // Owner 2026-09-29: "Bill at versus true hourly rate is different things."
  // Earl: pay lived in the Edit screen and the rate on the row; both are on the row now.
  test('each person shows what they bill and what they are paid, side by side; the line under says what an hour really costs and keeps', async ({ page }) => {
    await boot(page, 390);
    const r = await page.evaluate(async () => {
      S.laborBurden = 1.3; S.ownerPayType = 'hourly'; S.ownerPayRate = 0;
      _teamComp['jack@x.com'] = { pay_type: 'hourly', pay_rate: 25 }; window._teamCompLoaded = true;
      goPg('pg-team'); renderTeam();
      const lines = () => [...document.querySelectorAll('#team-page-list .td-rate-cost')].map(b => b.textContent.trim());
      const before = lines();
      const chips = [...document.querySelectorAll('#team-page-list .td-rate-row')][1].querySelectorAll('.td-rate-chip');
      // Your own pay, from your row.
      const own = document.getElementById('team-owner-pay');
      own.value = '40'; own.dispatchEvent(new Event('change'));
      // Jack's, from his.
      const updates = [];
      window._supa = { from: (t) => ({ update: (row) => ({ eq: (k1, v1) => ({ eq: async (k2, v2) => { updates.push({ t, row, [k1]: v1, [k2]: v2 }); return { error: null }; } }) }) }) };
      window._supaUser = { id: 'boss-uid' };
      await _teamPaySet(0, '27');
      return { before, chips: [...chips].map(c => c.textContent.replace(/\s+/g, '')), ownerPay: S.ownerPayRate, jack: _teamComp['jack@x.com'], updates, after: lines(),
        bleed: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r.before[0], 'no pay of your own yet').toBe('Put in pay to see what an hour earns you');
    expect(r.before[1]).toBe('Costs you $32.50/hr with 30% for taxes and insurance · you keep $42.50/hr');
    expect(r.chips, 'Bills and Pays, side by side').toEqual(['Bills$/hr', 'Pays$/hr']);
    expect(r.ownerPay).toBe(40);
    expect(r.jack).toEqual({ pay_type: 'hourly', pay_rate: 27 });
    expect(r.updates).toEqual([{ t: 'team_members', row: { pay_type: 'hourly', pay_rate: 27 }, contractor_user_id: 'boss-uid', email: 'jack@x.com' }]);
    expect(r.after[0]).toBe('Costs you $52.00/hr with 30% for taxes and insurance · you keep $73.00/hr');
    expect(r.after[1]).toBe('Costs you $35.10/hr with 30% for taxes and insurance · you keep $39.90/hr');
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  test('pay from the row: junk and a negative are refused; crew who may not see pay get no pay chip', async ({ page }) => {
    await boot(page, 390);
    const r = await page.evaluate(async () => {
      const a = [await _teamPaySet(99, '10'), await _teamPaySet(0, 'abc'), await _teamPaySet(0, '-5'), _teamOwnerPaySet('x')];
      const keep = window._canViewComp; window._canViewComp = () => false;
      goPg('pg-team'); renderTeam();
      const pays = document.querySelectorAll('#team-page-list .td-pay-chip').length;
      window._canViewComp = keep;
      return { a, pays };
    });
    expect(r.a).toEqual([false, false, false, false]);
    expect(r.pays).toBe(0);
  });


  // Owner 2026-09-29: "streamline how T&M proposals look so invoices look the
  // exact same ... what do we call the payment step in the other things?"
  test('same top and bar as the T&M estimate: Back, Invoice, Save; the customer large; Tim, Collect, Send it; See what they get under the page', async ({ page }) => {
    await boot(page, 390);
    await ks(page);
    await open(page, 701);
    const r = await page.evaluate(() => {
      _qi.due = 'receipt'; renderQuickInvoice();   // he picked when it is due
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
      return { lines: f(), text: document.getElementById('qi-page').textContent, total: _qiTotal(), rows: document.querySelectorAll('#qi-page .qi-day[data-day="2026-09-25"] .qi-time').length };
    }, jack.toString());
    expect(r.lines).toEqual([{ mins: 260, extra: null }, { mins: 15, extra: 'e103' }, { mins: 20, extra: 'e104' }, { mins: 15, extra: 'e105' }]);
    // One line for Jack that day (owner 2026-09-29: four "Logan Sample" rows
    // were unreadable); the run is said on it (§10.4).
    expect(r.text).toContain('+ 50m Ferguson run');
    expect(r.rows, 'one line per person per day').toBe(1);
    expect(r.total).toBe(387.5);                               // 310 minutes at $75
  });

  // Owner 2026-09-29, a screenshot: Logan 9.7h, Blake "same hours as Logan"
  // 8.5h. "it's not, why?" Blake rode along for the runs too.
  // Owner 2026-09-29: "same test ... adding in more time". Somebody with no
  // app, a shop stop from Other time that day, and his hours typed over.
  test('start to finish with more time: a person with no app, the shop stop, hours typed over, sent. 15 taps', async ({ page }) => {
    test.setTimeout(90000);
    await boot(page, 390); await day(page);
    await page.evaluate(() => { window._sendPaidInvoice = window.__realSend; S.bname = 'Sample Plumbing'; window._uploadClientHub = async () => {}; getClientById(701).clientToken = 'tok701'; _tb = { at: Date.now(), lab: window._rtbLab }; goPg('pg-dash'); _renderToBill(); });
    const log = []; let taps = 0, keys = 0;
    const tap = async (label, sel) => { const l = page.locator(sel).first(); try { await l.scrollIntoViewIfNeeded({ timeout: 3000 }); await l.click({ timeout: 3000 }); taps++; await page.waitForTimeout(500); log.push('tap  ' + label); } catch (e) { log.push('FAILED ' + label + ' ' + sel); } };
    const type = async (label, sel, text) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.click(); taps++; await l.pressSequentially(text); keys += text.length; log.push('type ' + label + ' (' + text.length + ')'); };
    const rows = await page.locator('#dash-to-bill .tb-row').count();
    log.push('card rows ' + rows);
    await tap('Ready to bill', '#dash-to-bill .tb-sum');
    if (!(await page.locator('#qi-page #qi-say').count())) { await page.waitForTimeout(400); await tap('Tagen Miller', '#dash-to-bill .tb-row:has-text("Tagen")'); }
    await page.waitForSelector('#qi-page #qi-say', { timeout: 4000 });
    await page.waitForTimeout(400);
    await type('what we did', '#qi-say', 'Replaced the water heater.');
    await tap('Add to work done', '#qi-page button:has-text("Add to work done")');
    await tap('Who was on it', '#qi-add-person');
    await type('new person', '#qi-new-name', 'Blake Sample');
    await type('their rate', '#qi-new-rate', '45');
    await tap('Add', '#qi-page .qi-new .ios-pill');
    await tap('day card open', '#qi-page .qi-day[data-day="2026-09-25"] .qi-day-open-btn');
    log.push('open? ' + await page.evaluate(() => _qi.open.has('2026-09-25')));
    await tap('Other time that day', '#qi-addtime-2026-09-25');
    await tap('At the shop', '#qi-page .qi-x-row:has-text("At the shop")');
    const hrs = page.locator('#qi-page .qi-time:has-text("Blake") .qi-hrs input');
    await hrs.scrollIntoViewIfNeeded(); await hrs.click(); taps++; await hrs.fill(''); await hrs.pressSequentially('6'); keys += 1; await hrs.press('Enter'); await hrs.blur(); log.push('type Blake hours 6');
    await page.waitForTimeout(400);
    await tap('bar', '#qi-go button');
    await tap('On receipt', '#qi-due button[data-due="receipt"]');
    await tap('bar Send', '#qi-go button');
    await page.waitForSelector('.td-send', { timeout: 5000 }).catch(() => {});
    await tap('Text it', '[data-send="text"]');
    const out = await page.evaluate(() => { const b = bids.find(x => x.kind === 'quick_invoice'); return b ? { sent: !!b.sentAt, total: b.amount, lines: (b.lineItems || []).map(l => l.desc + ' ' + l.amount) } : null; });
    console.log('[start-to-finish] invoice with more time: ' + taps + ' taps, ' + keys + ' keys\n  ' + log.join('\n  '));
    expect(log.filter(l => /FAILED/.test(l))).toEqual([]);
    // Jack 4h 20m + the 30m shop stop at $75, Blake typed to 6h at $45.
    expect(out).toMatchObject({ sent: true, total: 695 });
    expect(taps, log.join('\n')).toBeLessThanOrEqual(15);
    assertNoErrors(page, 'invoice with more time');
  });

  test('someone added with no app gets the same hours as the lead, runs included; typed hours are the whole day', async ({ page }) => {
    await boot(page, 390);
    await day(page);
    await openIt(page);
    const r = await page.evaluate(() => {
      _qiAddPerson('Blake Sample', '45');
      const mins = who => _qi.tracked.filter(l => l.kind === 'time' && l.who === who && l.day === '2026-09-25').reduce((s2, l) => s2 + l.mins, 0);
      const row = [...document.querySelectorAll('#qi-page .qi-day[data-day="2026-09-25"] .qi-time')].find(e => /Blake/.test(e.textContent));
      const same = { jack: mins('Jack Sample'), blake: mins('Blake Sample'), hrs: row.querySelector('.qi-hrs input').value, from: row.querySelector('.qi-from').textContent,
        top: row.querySelector('.qi-p-top').textContent.replace(/\s+/g, ' ').trim() };
      _qiRiderSet('2026-09-25', 'Blake Sample', '4');
      return { same, typed: mins('Blake Sample'), bleed: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r.same.blake).toBe(r.same.jack);
    expect(r.same.jack).toBe(310);
    expect(r.same.hrs).toBe('5.2');
    expect(r.same.from).toContain('Same hours as Jack');
    expect(r.same.top).toBe('Blake Sample$232.50×');
    expect(r.typed).toBe(240);
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  // Owner 2026-09-29: "what about the times that you're in the shop for three
  // hours before a job, that's not billable". Nothing outside the job counts on
  // its own, not even on a day he was the only customer; Add time is for the
  // odd miss.
  test('Add time lists the rest of the day, all unchecked even on his only job that day; one tap adds a line', async ({ page }) => {
    await boot(page);
    await day(page);
    await openIt(page);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('qi-addtime-2026-09-25');
      const label = btn.textContent;
      btn.click();
      const rows = [...document.querySelectorAll('#qi-page .qi-x-row')].map(b => ({ t: b.querySelector('.ios-lbl').firstChild.textContent, on: b.getAttribute('aria-pressed') }));
      const total = _qiTotal();
      document.querySelectorAll('#qi-page .qi-x-row')[1].click();       // this time the shop was his
      return { label, rows, total, after: _qiTotal() };
    });
    expect(r.label).toBe('Other time that day (2)');
    expect(r.rows).toEqual([{ t: "Drive, Tagen's to the shop", on: 'false' }, { t: 'At the shop', on: 'false' }]);
    expect(r.total, 'opening it adds nothing').toBe(387.5);
    expect(r.after).toBe(425);                                  // + 30m at $75
  });

  test('a run back to the shop in the middle of his job counts by itself, labeled, like a supply run', async ({ page }) => {
    await boot(page);
    await day(page);
    await page.evaluate(() => {
      const L = window._rtbLab;
      L.entries = L.entries.filter(e => e.id !== 104).map(e => e.id === 103 ? Object.assign({}, e, { dest_place: 'Shop' }) : e.id === 105 ? Object.assign({}, e, { origin_place: 'Shop' }) : e);
      L.shopEntries.push({ id: 202, employee_user_id: 'jack-uid', arrived_at: '2026-09-25T15:35:00.000Z', departed_at: '2026-09-25T15:55:00.000Z', minutes: 20 });
    });
    await openIt(page);
    const r = await page.evaluate(() => ({ extras: _qi.tracked.filter(l => l.extra).map(l => l.extra), text: document.getElementById('qi-page').textContent, total: _qiTotal() }));
    expect(r.extras).toEqual(['e103', 's202', 'e105']);
    expect(r.text).toContain('+ 50m shop run');
    expect(r.total).toBe(387.5);                               // the same 310 minutes, shop instead of Ferguson
  });

  // Owner 2026-09-29, screenshot: "Drive · Here to somewhere", "A stop":
  // "what do these somewhere things even mean".
  test('no "somewhere": places are named the way he says them, an unnamed stop says so, and each has its clock times', async ({ page }) => {
    await boot(page);
    await day(page);
    await page.evaluate(() => {
      const L = window._rtbLab;
      const T = (h, m) => '2026-09-25T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00.000Z';
      L.entries.push({ id: 109, job_id: null, employee_user_id: 'jack-uid', source: 'drive', origin_place: 'Tagen Miller (2210 Birch Ln)', dest_place: '', arrived_at: T(20, 0), departed_at: T(20, 20), minutes: 20 });
      L.entries.push({ id: 110, job_id: null, employee_user_id: 'jack-uid', source: 'place', origin_place: null, dest_place: '', arrived_at: T(20, 20), departed_at: T(20, 40), minutes: 20 });
      L.entries.push({ id: 111, job_id: null, employee_user_id: 'jack-uid', source: 'drive', origin_place: '', dest_place: '', arrived_at: T(20, 40), departed_at: T(20, 50), minutes: 10 });
    });
    await openIt(page);
    const r = await page.evaluate(() => {
      document.getElementById('qi-addtime-2026-09-25').click();
      return [...document.querySelectorAll('#qi-page .qi-x-row')].map(b => ({ t: b.querySelector('.ios-lbl').firstChild.textContent, sub: b.querySelector('small').textContent }));
    });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/somewhere|Somewhere|A stop|Here to/);
    expect(r.map(x => x.t), 'in the order they happened').toEqual(["Drive, Tagen's to the shop", 'At the shop', "Drive from Tagen's", 'Stop, place not saved', 'Drive, places not saved']);
    r.forEach(x => expect(x.sub).toMatch(/\d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M/));
  });

  test('another customer the same day: nothing is checked for him; the run between his visits still counts', async ({ page }) => {
    await boot(page);
    await day(page, { second: true });
    await openIt(page);
    const r = await page.evaluate(() => {
      document.getElementById('qi-addtime-2026-09-25').click();
      return { on: [...document.querySelectorAll('#qi-page .qi-x-row')].map(b => b.getAttribute('aria-pressed')), total: _qiTotal() };
    });
    expect(r.on).toEqual(['false', 'false']);
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
      const bid = (_qi && (_qi.due = _qi.due || 'receipt'), qiSend());
      // Everything pulled is marked on the bill, so no invoice (his or another
      // customer's) can offer it again; the day itself is billed.
      return { dropped, pulled: bid.qiPulled.sort(), marked: [..._qiPulledAll()].sort(), days: bid.qiDays };
    });
    expect(r.dropped).toBe(362.5);
    expect(r.pulled).toEqual(['e103', 'e105']);
    expect(r.marked).toEqual(['e103', 'e105']);
    expect(r.days).toEqual(['2026-09-25']);
  });

  test('drive time off leaves every drive off, the first one and the ones he adds', async ({ page }) => {
    await boot(page);
    await day(page);
    await page.evaluate(() => { S.qiBillDrive = false; });
    await openIt(page);
    const r = await page.evaluate(() => { _qiExtraOpen('2026-09-25'); return _qi.tracked.filter(l => l.who === 'Jack Sample').map(l => l.extra || 'base'); });
    expect(r).toEqual(['base', 'e104']);
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

// START TO FINISH, AS A PERSON DOES IT: Home, Ready to bill, the invoice, sent.
// Every tap is a real click on the real control, every word typed key by key.
test.describe('Invoice start to finish', () => {
// Owner 2026-09-29: "honestly run a playwright test on invoice from start to
// finish from bill section to completion, how long are we looking at?"
test('a repaint with nothing new keeps the same rows, so a tap on the way down still lands', async ({ page }) => {
  await boot(page, 390);
  const r = await page.evaluate(async () => {
    goPg('pg-dash'); _renderToBill();
    for (let i = 0; i < 40 && !document.querySelector('#dash-to-bill .tb-sum .tb-total'); i++) await new Promise(res => setTimeout(res, 50));
    _tbExpanded = true; _renderToBill();
    const row = document.querySelector('#dash-to-bill .tb-row');
    _renderToBill(); if (typeof renderDash === 'function') renderDash();
    const same = document.querySelector('#dash-to-bill .tb-row') === row && row.isConnected;
    _tbExpanded = false; _renderToBill();
    const closed = !document.querySelector('#dash-to-bill .tb-list.open');
    return { row: !!row, same, closed };
  });
  expect(r).toEqual({ row: true, same: true, closed: true });
  assertNoErrors(page, 'ready to bill repaint');
});

test('Home > Ready to bill > the invoice > sent: 8 taps and what he typed, the work in his own sentence case', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page, 390);
  await page.evaluate(() => { window._sendPaidInvoice = window.__realSend; S.bname = 'Sample Plumbing'; window._uploadClientHub = async () => {}; getClientById(701).clientToken = 'tok701'; });
  const log = []; let taps = 0, keys = 0, scrolls = 0;
  const t0 = Date.now();
  const tap = async (label, loc) => {
    const l = page.locator(loc).first();
    const before = await page.evaluate(() => { const s = document.scrollingElement; const q = document.getElementById('qi-page'); return (s ? s.scrollTop : 0) + (q ? q.scrollTop : 0); });
    await l.scrollIntoViewIfNeeded();
    const after = await page.evaluate(() => { const s = document.scrollingElement; const q = document.getElementById('qi-page'); return (s ? s.scrollTop : 0) + (q ? q.scrollTop : 0); });
    if (Math.abs(after - before) > 40) { scrolls++; log.push('  (scroll)'); }
    const s = Date.now(); await l.click(); taps++;
    await page.waitForTimeout(50);
    log.push('tap  ' + label + '  ' + (Date.now() - s) + 'ms');
  };
  const type = async (label, loc, text) => {
    const l = page.locator(loc).first();
    await l.scrollIntoViewIfNeeded(); await l.click(); taps++;
    await l.pressSequentially(text); keys += text.length;
    log.push('type ' + label + '  (' + text.length + ' keys)');
  };
  await page.evaluate(() => { goPg('pg-dash'); _renderToBill(); });
  await tap('Ready to bill card', '#dash-to-bill .tb-sum');
  // The list redraws as it opens; wait for the open one, or WebKit hands the
  // tap to the row it is about to throw away (CI shard 3, 2026-09-29).
  await page.waitForSelector('#dash-to-bill .tb-list.open .tb-row');
  await page.waitForTimeout(250);
  await tap('Tagen Miller', '#dash-to-bill .tb-list.open .tb-row:has-text("Tagen Miller")');
  await page.waitForSelector('#qi-page #qi-say');
  await type('what we did', '#qi-say', 'Replaced the water heater and the shutoff valve.');
  await tap('Add to work done', '#qi-page button:has-text("Add to work done")');
  const bar1 = await page.locator('#qi-go').textContent();
  await tap('bar: ' + bar1.trim(), '#qi-go button');
  await tap('On receipt', '#qi-due button[data-due="receipt"]');
  const bar2 = await page.locator('#qi-go').textContent();
  await tap('bar: ' + bar2.trim(), '#qi-go button');
  await page.waitForSelector('.td-send');
  await tap('Text it to them', '[data-send="text"]');
  const ms = Date.now() - t0;
  const out = await page.evaluate(() => { const b = bids.find(x => x.kind === 'quick_invoice'); return { sent: !!(b && b.sentAt), total: b && b.amount, days: b && b.qiDays.length, work: b && b.qiWork }; });
  expect(out).toEqual({ sent: true, total: 1048.5, days: 3, work: ['Replaced the water heater and the shutoff valve'] });
  expect(taps, log.join('\n')).toBeLessThanOrEqual(8);
  expect(keys).toBe(48);
  expect(ms, 'the app itself is never the slow part').toBeLessThan(15000);
  assertNoErrors(page, 'invoice start to finish');
});
});
