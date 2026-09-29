// @ts-check
/**
 * Quick invoice (js/quick-invoice.js, owner 2026-09-26): bill a customer with
 * no proposal. Home > Invoice > pick who > Hourly (tracked time + receipts,
 * each person at their own rate) or Set price (typed lines, price book) >
 * Send. Saved as a won bid (the diagnostic-charge shape) so Collect and the
 * customer's hub pick it up, and the next invoice starts after it.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const T0 = '2026-09-24T14:00:00.000Z';

async function boot(page, w) {
  if (w) await page.setViewportSize({ width: w, height: 800 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate((T0) => {
    const mk = (id, name, addr, phone) => ({ id, name, addr, phone: phone || '', status: 'Client' });
    clients.splice(0, clients.length,
      mk(901, 'John Doe', '1418 Maple Ave, Springfield, IL', '5555550101'),
      mk(902, 'Mary Smith', '77 Lakeview Dr, Springfield, IL'),
      mk(903, 'Karen Smith', '310 W Oak St, Rochester, IL'));
    jobs.push({ id: 'j901', client_id: 901, start: todayKey(), days: 1 }, { id: 'j902', client_id: 902, start: todayKey(), days: 1 });
    S.laborRate = 70;
    S.ownerName = 'Mike Sample';
    S.employees = [{ name: 'Jack Sample', email: 'jack@x.com', billRate: 85 }];
    S.priceBook = { plumbing: [{ desc: 'Replace water heater', rate: 1400, unit: 'ea', n: 3 }, { desc: 'Haul away old unit', rate: 75, unit: 'ea', n: 2 }] };
    const t = Date.parse(T0), h = 3600e3;
    window._jobTimeEntriesByJob = {
      j901: [
        { arrivedAt: new Date(t).toISOString(), departedAt: new Date(t + 6.5 * h).toISOString(), minutes: 390, employeeName: 'Jack Sample' },
        { arrivedAt: new Date(t).toISOString(), departedAt: new Date(t + 6.5 * h).toISOString(), minutes: 390, employeeName: 'Mike Sample' },
      ],
      j902: [{ arrivedAt: new Date(t - 86400e3).toISOString(), departedAt: new Date(t - 86400e3 + h).toISOString(), minutes: 60, employeeName: 'Mike Sample' }],
    };
    expenses.push({ id: 'e1', client_id: 901, vendor: 'Ferguson', amount: 300, date: '2026-09-24' }, { id: 'e2', client_id: 902, vendor: 'Menards', amount: 40, date: '2026-09-23' });
  }, T0);
}

test.describe('Quick invoice', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'quick invoice'); });

  test('Invoice sits on the home screen right after Proposal', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#dash-quick .qa')].map(b => b.textContent.trim());
      return { i: btns.indexOf('Invoice'), p: btns.indexOf('Proposal') };
    });
    expect(r.i).toBe(r.p + 1);
  });

  // Changed 2026-09-26 (owner: "where is the huge quick invoice list we talked
  // about? Just see a weak ass search"). The list used to be only who was
  // tracked in the last 7 days, so with no tracked visits there was no list.
  // It is every customer now, Working now first, with the search on top.
  test('the picker lists every customer with their street and status, working now first, search on top', async ({ page }) => {
    await boot(page);
    await page.click('#qa-invoice-btn');
    const r = await page.evaluate(() => {
      const box = document.querySelector('.zmodal');
      // Ready to bill houses lead the list (e2e-ready-to-bill.spec.js); this
      // test is about the customer rows under them.
      const rows = [...box.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => !/Ready to bill/.test(b.textContent)).map(b => b.textContent.replace(/\s+/g, ' ').trim());
      const search = box.querySelector('#qp-search'), list = box.querySelector('#qp-sugs');
      return { text: box.textContent, rows, searchFirst: !!(search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(r.text).toContain('Invoice');   // one name everywhere (Earl): no "Quick invoice"
    expect(r.text).not.toContain('Quick invoice');
    expect(r.text).toMatch(/Your customers|then your customers/);
    expect(r.rows.length).toBe(3);
    expect(r.rows[0]).toContain('John Doe');
    expect(r.rows[0]).toContain('1418 Maple Ave');
    expect(r.rows[0]).toContain('Working now');
    expect(r.rows.join(' | ')).toContain('Karen Smith');
    expect(r.rows.join(' | ')).toContain('310 W Oak St');
    expect(r.searchFirst, 'the search box sits above the list').toBe(true);
  });

  test('no tracked time anywhere: the list is still every customer, not an empty search box', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window._jobTimeEntriesByJob = {}; jobs.length = 0; openQuickInvoicePicker(); });
    const n = await page.locator('#qp-sugs [data-action="invoice"]').count();
    expect(n).toBe(3);
  });

  test('typing narrows the same list in place; a phone number works; nothing found offers New client', async ({ page }) => {
    await boot(page);
    await page.click('#qa-invoice-btn');
    const shown = () => page.evaluate(() => [...document.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => b.style.display !== 'none').map(b => b.textContent.trim().split(/\s{2,}|\n/)[0]));
    await page.fill('#qp-search', 'smith');
    const smith = await shown();
    await page.fill('#qp-search', '555-0101');
    const phone = await shown();
    await page.fill('#qp-search', 'zzzz');
    const none = await shown();
    const newShown = await page.locator('#qp-new-wrap').isVisible();
    await page.fill('#qp-search', '');
    const all = await shown();
    expect(smith.join(' ')).toMatch(/Mary Smith/);
    expect(smith.join(' ')).toMatch(/Karen Smith/);
    expect(smith.join(' ')).not.toMatch(/John Doe/);
    expect(phone.join(' ')).toMatch(/John Doe/);
    expect(phone.length).toBe(1);
    expect(none).toEqual([]);
    expect(newShown).toBe(true);
    // Empty again: the Ready to bill houses (John and Mary have unbilled time
    // here) on top, then every customer not already listed above.
    expect(all.length).toBe(3);
    expect(await page.locator('#qp-results button').count(), 'no second list stacked under the first').toBe(0);
    await page.fill('#qp-search', 'smith');
    expect(await page.evaluate(() => [...document.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => b.style.display !== 'none').every(b => getComputedStyle(b).display === 'flex')), 'a narrowed row is still a row').toBe(true);
  });

  test('tapping a customer on the list opens their invoice', async ({ page }) => {
    await boot(page);
    await page.click('#qa-invoice-btn');
    await page.locator('#qp-sugs [data-action="invoice"]', { hasText: 'Karen Smith' }).click();
    const r = await page.evaluate(() => ({ pg: document.querySelector('.pg.active').id, text: document.getElementById('qi-page').textContent }));
    expect(r.pg).toBe('pg-qi');
    expect(r.text).toContain('Karen Smith');
  });

  test('Hourly: each person at their own rate, receipts, and the total', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => openQuickInvoice(901));
    const r = await page.evaluate(() => ({
      active: document.querySelector('.pg.active').id,
      seg: document.querySelector('#qi-page .qi-seg .on').textContent,
      text: document.getElementById('qi-page').textContent,
      total: document.getElementById('qi-total').textContent,
      send: document.getElementById('qi-send').textContent,
    }));
    expect(r.active).toBe('pg-qi');
    expect(r.seg).toBe('Hourly');
    expect(r.text).toContain('Jack Sample');
    expect(r.text).toContain('6h 30m on site at');  // hours at the rate (Earl: "which rate wins?")
    expect(r.text).toContain('$552.50');           // 6.5h x $85
    expect(r.text).toContain('$455.00');           // owner at the labor rate, 6.5h x $70
    expect(r.text).toContain('Ferguson');
    expect(r.total).toBe('$1,307.50');
    expect(r.send).toBe('Text it to John Doe · $1,307.50');  // the total rides on the pinned button   // full name: "John" read like his crewman (Earl)
  });

  // The tracker writes a visit as job_id null + dest_place "Name (street)"
  // (CLAUDE.md 17). The invoice read only job_id rows, so John Doe's real
  // 4-hour days showed "Nothing tracked" (owner 2026-09-26, with a screenshot).
  test('visits the tracker filed by place, not job, are billed: his name and street, each person, drives and other customers left off', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._jobTimeEntriesByJob = {};
      clients.find(c => c.id === 901).extraAddresses = [{ addr: '9 Lake Rd, Springfield, IL', label: 'Rental' }];
      const H = 3600e3, t = Date.parse('2026-09-22T13:00:00Z');
      const row = (o) => Object.assign({ job_id: null, employee_user_id: 'boss-uid', source: 'client', arrived_at: new Date(t).toISOString(), departed_at: new Date(t + 4 * H).toISOString(), minutes: 240 }, o);
      const saved = { f: window._fetchCrewLabor, se: window.supaEnabled, su: window._supaUser, sp: window._supa };
      window._supaUser = { id: 'boss-uid' }; window.supaEnabled = () => true; window._supa = window._supa || {};
      let resolve; const gate = new Promise(r => { resolve = r; });
      window._fetchCrewLabor = async () => { await gate; return { name: { 'jack-uid': 'Jack Sample' }, entries: [
        row({ dest_place: 'John Doe (1418 Maple Ave)' }),
        row({ dest_place: 'John Doe (1418 Maple Ave)', employee_user_id: 'jack-uid', arrived_at: new Date(t + 24 * H).toISOString(), departed_at: new Date(t + 26 * H).toISOString(), minutes: 120 }),
        row({ dest_place: 'John Doe (Rental)', arrived_at: new Date(t + 48 * H).toISOString(), departed_at: new Date(t + 49 * H).toISOString(), minutes: 60 }),
        row({ dest_place: 'John Doe (1418 Maple Ave)', source: 'drive', minutes: 30 }),
        row({ dest_place: 'John Doe (1418 Maple Ave)', source: 'dismissed', minutes: 90 }),
        row({ dest_place: 'Mary Smith (77 Lakeview Dr)', minutes: 500 }),
      ] }; };
      S.ownerName = 'Mike Sample';
      openQuickInvoice(901, '1418 Maple Ave, Springfield, IL');
      const shimmer = !!document.querySelector('#qi-page .td-skel');
      resolve();
      await new Promise(r => setTimeout(r, 50));
      const text = document.getElementById('qi-page').textContent;
      const lines = _qi.tracked.filter(l => l.kind === 'time').map(l => ({ who: l.who, mins: l.mins }));
      const mode = _qi.mode, nav = document.querySelector('#qi-page .ios-navbtn.bold').textContent;
      window._fetchCrewLabor = saved.f; window.supaEnabled = saved.se; window._supaUser = saved.su; window._supa = saved.sp;
      return { shimmer, lines, mode, nav, text };
    });
    expect(r.shimmer, 'a shimmer while the visits load, not "Nothing tracked"').toBe(true);
    // The Rental's hour is its own invoice now (owner 2026-09-27: one bill per house).
    // One line per person per day, oldest day first (owner 2026-09-29: a card a day).
    expect(r.lines).toEqual([{ who: 'Mike Sample', mins: 240 }, { who: 'Jack Sample', mins: 120 }]);
    expect(r.mode).toBe('hourly');
    expect(r.text).not.toContain('Nothing tracked');
    expect(r.nav, 'Save top right, the way proposals do it; Preview sits by Send').toBe('Save');
  });

  // Owner 2026-09-27: "drive time should have a toggle that's set by user
  // level if they want to include it", then "really the only billable time in
  // time and materials is drive time and job site time". Shop time is pay, not
  // a bill: it is on the timesheet, never on the customer's invoice.
  test('job site time is billed; drive time only with the switch on, a shared leg split in half, held legs never; shop time never', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._jobTimeEntriesByJob = {};
      delete S.qiBillDrive;
      const H = 3600e3, M = 60e3, t = Date.parse('2026-09-22T13:00:00Z');
      const at = (o, mins) => ({ arrived_at: new Date(t + o).toISOString(), departed_at: new Date(t + o + mins * M).toISOString(), minutes: mins });
      const row = (o) => Object.assign({ job_id: null, employee_user_id: 'boss-uid', source: 'client' }, o);
      const saved = { f: window._fetchCrewLabor, se: window.supaEnabled, su: window._supaUser, sp: window._supa, sc: window._settingsChanged };
      let saves = 0; window._settingsChanged = () => { saves++; };
      window._supaUser = { id: 'boss-uid' }; window.supaEnabled = () => true; window._supa = window._supa || {};
      window._fetchCrewLabor = async () => ({ name: { 'jack-uid': 'Jack Sample' }, entries: [
        row(Object.assign({ dest_place: 'John Doe (1418 Maple Ave)' }, at(0, 240))),
        row(Object.assign({ dest_place: 'Mary Smith (77 Lakeview Dr)' }, at(5 * H, 240))),
        row(Object.assign({ source: 'drive', origin_place: 'Shop', dest_place: 'John Doe (1418 Maple Ave)' }, at(-10 * M, 10))),
        row(Object.assign({ source: 'drive', origin_place: 'John Doe (1418 Maple Ave)', dest_place: 'Mary Smith (77 Lakeview Dr)' }, at(4 * H + 5 * M, 20))),
        row(Object.assign({ source: 'drive', origin_place: 'Mary Smith (77 Lakeview Dr)', dest_place: 'Shop' }, at(9 * H + 5 * M, 15))),
        row(Object.assign({ source: 'drive-held', origin_place: 'Shop', dest_place: 'John Doe (1418 Maple Ave)' }, at(-2 * H, 45))),
      ], shopEntries: [
        Object.assign({ employee_user_id: 'boss-uid' }, at(-2 * H, 60)),
        Object.assign({ employee_user_id: 'jack-uid' }, at(-2 * H, 30)),
      ] });
      openQuickInvoice(901);
      await new Promise(r => setTimeout(r, 50));
      const off = _qi.tracked.filter(l => l.kind === 'time').map(l => ({ who: l.who, mins: l.mins, detail: l.detail }));
      _qiDays(_qi.tracked).forEach(d => _qi.open.add(d)); renderQuickInvoice();   // days fold to one line; open them to read
      const offText = document.getElementById('qi-page').textContent;
      document.getElementById('qi-drive').click();
      const on = _qi.tracked.filter(l => l.kind === 'time').map(l => ({ who: l.who, mins: l.mins, detail: l.detail, amount: l.amount }));
      const checked = document.getElementById('qi-drive').checked, setting = S.qiBillDrive;
      document.getElementById('qi-drive').click();
      const back = _qi.tracked.filter(l => l.kind === 'time').map(l => l.mins);
      Object.assign(window, { _fetchCrewLabor: saved.f, supaEnabled: saved.se, _supaUser: saved.su, _supa: saved.sp, _settingsChanged: saved.sc });
      delete S.qiBillDrive;
      return { off, offText, on, checked, setting, back, saves };
    });
    expect(r.off).toEqual([{ who: 'Mike Sample', mins: 240, detail: '4h on site' }]);
    expect(r.offText).toContain('Bill drive time');
    expect(r.offText).toContain('4h on site at');
    expect(r.offText).not.toMatch(/shop/i);
    expect(r.on).toEqual([{ who: 'Mike Sample', mins: 260, detail: '4h on site, 20m driving', amount: 303.33 }]);
    expect(r.checked).toBe(true);
    expect(r.setting).toBe(true);
    expect(r.back).toEqual([240]);
    expect(r.saves, 'the switch is his setting, saved each time').toBe(2);
  });

  // Owner 2026-09-27: "the quick invoice search sheet is only bringing up the
  // primary address not the multiple options like what we have in TrueShot,
  // should we make that search shared code?"
  test('one shared customer search: a second house is found by its street in every picker, and nobody matches by phone on a word', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      clients.find(c => c.id === 901).extraAddresses = [{ addr: '9 Lake Rd, Springfield, IL', label: 'Rental' }];
      const byStreet = clients.filter(c => clientMatches(c, '9 lake')).map(c => c.name);
      const byWord = clients.filter(c => clientMatches(c, 'smith')).map(c => c.name);
      const byPhone = clients.filter(c => clientMatches(c, '555-0101')).map(c => c.name);
      const sub = clientAddrSub(clients.find(c => c.id === 901));
      const subHit = clientAddrSub(clients.find(c => c.id === 901), '9 lake');
      // The invoice picker narrows in place on the same text.
      openQuickInvoicePicker();
      const inp = document.getElementById('qp-search'); inp.value = '9 lake'; onQPSearch(inp);
      const shown = [...document.querySelectorAll('#qp-sugs [data-action="invoice"]')].filter(b => b.style.display !== 'none').map(b => b.textContent);
      closeTopModal && closeTopModal();
      // The Clients page and the new-customer check read it too.
      const gate = _newcGateMatches('9 lake').map(c => c.name);
      return { byStreet, byWord, byPhone, sub, subHit, shown, gate };
    });
    expect(r.byStreet).toEqual(['John Doe']);
    expect(r.byWord.sort()).toEqual(['Karen Smith', 'Mary Smith']);
    expect(r.byPhone).toEqual(['John Doe']);
    expect(r.sub).toBe('2 addresses');
    expect(r.subHit).toBe('9 Lake Rd · Rental');
    expect(r.shown.length).toBe(1);
    expect(r.shown[0]).toContain('John Doe');
    expect(r.shown[0], 'the row names the house that matched').toContain('9 Lake Rd · Rental');
    expect(r.gate).toEqual(['John Doe']);
  });

  // Owner 2026-09-27: "can I search my person then in that person pick the
  // address?" then "whatever is most intuitive". A search that already names
  // one house goes straight to it; a search by name asks which property.
  test('searching a street and tapping goes straight to that house; searching the name asks which one', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      clients.find(c => c.id === 901).extraAddresses = [{ addr: '9 Lake Rd, Springfield, IL', label: 'Rental' }];
      const pick = (q) => {
        openQuickInvoicePicker();
        const inp = document.getElementById('qp-search'); inp.value = q; onQPSearch(inp);
        [...document.querySelectorAll('#qp-sugs [data-action="invoice"]')].find(b => b.style.display !== 'none' && /John Doe/.test(b.textContent)).click();
      };
      pick('9 lake');
      const street = { asked: !!document.getElementById('_addrpick-ov'), addr: _qi && _qi.addr, pg: document.querySelector('.pg.active').id };
      _qi = null;
      pick('maple');
      const primary = { asked: !!document.getElementById('_addrpick-ov'), addr: _qi && _qi.addr };
      _qi = null;
      pick('john');
      const byName = { asked: !!document.getElementById('_addrpick-ov') };
      document.getElementById('_addrpick-ov')?.remove();
      return { street, primary, byName, one: clientMatchedAddr(clients.find(c => c.id === 902), '77') };
    });
    expect(r.street).toEqual({ asked: false, addr: '9 Lake Rd, Springfield, IL', pg: 'pg-qi' });
    expect(r.primary).toEqual({ asked: false, addr: '1418 Maple Ave, Springfield, IL' });
    expect(r.byName.asked).toBe(true);
    expect(r.one, 'one house: nothing to choose, nothing to name').toBe(null);
  });

  test('a customer with two houses is asked which one; that invoice bills that house only, and billing it leaves the other house unbilled', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._jobTimeEntriesByJob = {};
      clients.find(c => c.id === 901).extraAddresses = [{ addr: '9 Lake Rd, Springfield, IL', label: 'Rental' }];
      const H = 3600e3, t = Date.parse('2026-09-22T13:00:00Z');
      const row = (o) => Object.assign({ job_id: null, employee_user_id: 'boss-uid', source: 'client', arrived_at: new Date(t).toISOString(), departed_at: new Date(t + 4 * H).toISOString(), minutes: 240 }, o);
      const saved = { f: window._fetchCrewLabor, se: window.supaEnabled, su: window._supaUser, sp: window._supa };
      window._supaUser = { id: 'boss-uid' }; window.supaEnabled = () => true; window._supa = window._supa || {};
      window._fetchCrewLabor = async () => ({ name: {}, entries: [
        row({ dest_place: 'John Doe (1418 Maple Ave)' }),
        row({ dest_place: 'John Doe (Rental)', arrived_at: new Date(t + 24 * H).toISOString(), departed_at: new Date(t + 25 * H).toISOString(), minutes: 60 }),
      ] });
      openQuickInvoice(901);
      const asked = !!document.getElementById('_addrpick-ov');
      const choices = [...document.querySelectorAll('#_addrpick-sheet [onclick^="_addrPickChoose"]')].map(e => e.textContent);
      _addrPickChoose(1);
      await new Promise(res => setTimeout(res, 50));
      const rental = { head: document.querySelector('#qi-page .ios-sub').textContent, mins: _qi.tracked.filter(l => l.kind === 'time').map(l => l.mins) };
      const bid = _qiSave();
      openQuickInvoice(901, '1418 Maple Ave, Springfield, IL');
      await new Promise(res => setTimeout(res, 50));
      const primary = _qi.tracked.filter(l => l.kind === 'time').map(l => l.mins);
      openQuickInvoice(901, '9 Lake Rd, Springfield, IL');
      await new Promise(res => setTimeout(res, 50));
      const rentalAgain = _qi.tracked.filter(l => l.kind === 'time').map(l => l.mins);
      Object.assign(window, { _fetchCrewLabor: saved.f, supaEnabled: saved.se, _supaUser: saved.su, _supa: saved.sp });
      return { asked, choices, rental, qiAddr: bid && bid.qiAddr, addr: bid && bid.addr, primary, rentalAgain };
    });
    expect(r.asked).toBe(true);
    expect(r.choices.length).toBe(2);
    expect(r.rental.head).toContain('9 Lake Rd');
    expect(r.rental.mins).toEqual([60]);
    expect(r.qiAddr).toBe('9 Lake Rd, Springfield, IL');
    expect(r.addr).toBe('9 Lake Rd, Springfield, IL');
    expect(r.primary, 'the other house is still unbilled').toEqual([240]);
    expect(r.rentalAgain, 'the billed house starts after its invoice').toEqual([]);
  });

  test('offline, or the load fails: the screen keeps what it had and says nothing tracked only when that is true', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const saved = { f: window._fetchCrewLabor, se: window.supaEnabled };
      window.supaEnabled = () => false;
      openQuickInvoice(901);
      await new Promise(r => setTimeout(r, 30));
      const offline = _qi.tracked.filter(l => l.kind === 'time').length;
      window.supaEnabled = () => true; window._supaUser = window._supaUser || { id: 'u' }; window._supa = window._supa || {};
      window._fetchCrewLabor = async () => { throw new Error('network'); };
      openQuickInvoice(901);
      await new Promise(r => setTimeout(r, 30));
      const failed = _qi.tracked.filter(l => l.kind === 'time').length, loading = _qi.loading;
      window._fetchCrewLabor = saved.f; window.supaEnabled = saved.se;
      return { offline, failed, loading };
    });
    expect(r.offline).toBe(2);
    expect(r.failed).toBe(2);
    expect(r.loading).toBe(false);
  });

  // "Do we add in talk to Tim like we do for proposals to speak to what we
  // did?" (owner 2026-09-27). Same box and splitter as Build Your Own.
  test('Talk to Tim, hourly: what he did is listed as work done, on the preview and the saved invoice, never a price', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _activeTrade = 'plumbing';
      openQuickInvoice(901); _qiSetMode('hourly');
      const before = _qiTotal();
      document.getElementById('qi-say').value = 'Pulled the old water heater, set a tankless and hauled the old one away';
      _qiSayBuild();
      const work = _qi.work.slice(), after = _qiTotal();
      const box = document.getElementById('qi-say').value;
      const doc = _qiDocHtml();
      _qiDropWork(work.length - 1);
      const dropped = _qi.work.length;
      const bid = _qiSave();
      return { work, before, after, box, docHas: work.every(w => doc.includes(w)), dropped, saved: bid && bid.qiWork, desc: bid && bid.desc };
    });
    expect(r.work.length).toBeGreaterThanOrEqual(2);
    expect(r.after, 'work done never changes the price').toBe(r.before);
    expect(r.box, 'the box is cleared for the next thing').toBe('');
    expect(r.docHas).toBe(true);
    expect(r.dropped).toBe(r.work.length - 1);
    expect(r.saved.length).toBe(r.work.length - 1);
    expect(r.desc.split('\n')[0]).toBe(r.work[0]);
  });

  test('Talk to Tim, set price: each thing he did is a line, priced from his book when it knows it, blank when it does not', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      _activeTrade = 'plumbing';
      openQuickInvoice(902); _qiSetMode('set');
      document.getElementById('qi-say').value = 'Replace water heater and fixed the leak under the sink';
      _qiSayBuild();
      return _qi.typed.map(l => ({ desc: l.desc, amount: l.amount }));
    });
    expect(r.length).toBeGreaterThanOrEqual(2);
    const heater = r.find(l => /water heater/i.test(l.desc));
    expect(heater && heater.amount, 'his price book rate').toBe(1400);
    expect(r.some(l => l.amount === ''), 'an unknown line is left blank to price').toBe(true);
  });

  test('Talk to Tim: an empty box asks for words; Done talking builds the lines by itself', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      openQuickInvoice(901); _qiSetMode('hourly');
      const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
      _qiSayBuild();
      window.showToast = t;
      // Done talking with words in the box goes straight to the build, the way
      // the proposal box does.
      _timTalkTarget = 'qi-say'; _timTalking = true; window._voiceStop = async () => 'Snaked the main line';
      await _timTalkStop();
      return { toasts, work: _qi.work.slice() };
    });
    expect(r.toasts).toEqual(['Type or say what you did first']);
    expect(r.work.join(' ')).toMatch(/snaked the main line/i);
  });

  // Owner 2026-09-27: "Talk to Tim code should be shared as well, don't hand
  // roll another one, it just points at proposals and invoices."
  test('Talk to Tim is one shared box: the invoice, BYO and T&M boxes are the same markup, each naming only what happens when he stops', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      window._voiceCapable = () => true;
      openQuickInvoice(901);
      const qi = document.getElementById('qi-say');
      const qiBtn = [...document.querySelectorAll('#qi-page button')].find(b => /Talk to Tim/.test(b.textContent));
      const byo = timSayBox({ id: 'byo-say', done: '_byoSayBuild', placeholder: 'x' });
      const gone = ['_qiTalk', '_qiSaySteps', '_byoTalk', '_geiScopeTalk', '_tmSayBox', '_tmVoiceBtn'].filter(n => typeof window[n] === 'function');
      // Stopping talking calls whatever the box names, on any screen.
      const calls = [];
      window.__fakeDone = () => calls.push(document.getElementById('fake-say').value);
      document.body.insertAdjacentHTML('beforeend', timSayField('fake-say', 'p', '__fakeDone'));
      _timTalkTarget = 'fake-say'; _timTalking = true; window._voiceStop = async () => 'Set the new toilet';
      await _timTalkStop();
      document.getElementById('fake-say').remove();
      return {
        qiDone: qi.dataset.timDone, qiClass: qi.className, qiBtn: qiBtn && qiBtn.getAttribute('onclick'),
        same: byo.replace(/byo-say/g, 'ID').replace(/_byoSayBuild/g, 'DONE').replace(/placeholder="[^"]*"/, '') ===
          timSayBox({ id: 'qi-say', done: '_qiSayBuild', placeholder: 'y' }).replace(/qi-say/g, 'ID').replace(/_qiSayBuild/g, 'DONE').replace(/placeholder="[^"]*"/, ''),
        gone, calls, steps: timSaySteps('fixed it'),
      };
    });
    expect(r.qiDone).toBe('_qiSayBuild');
    expect(r.qiClass).toBe('ios-say');
    expect(r.qiBtn).toBe("_timTalkToggle('qi-say')");
    expect(r.same, 'two screens, one box').toBe(true);
    expect(r.gone, 'the hand-rolled copies are deleted').toEqual([]);
    expect(r.calls).toEqual(['Set the new toilet']);
    expect(r.steps).toEqual(['Fixed it']);
  });

  test('changing a rate reprices that line and the total', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => openQuickInvoice(901));
    await page.fill('input[aria-label="Rate for Mike Sample"]', '90');
    expect(await page.textContent('#qi-total')).toBe('$1,437.50');
  });

  test('Set price: typed lines and the price book, no tracked time on the bill', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { openQuickInvoice(901); _qiSetMode('set'); });
    expect(await page.textContent('#qi-page')).not.toContain('Jack Sample');
    await page.click('text=Add from price book');
    await page.click('.qi-pb button:has-text("Replace water heater")');
    expect(await page.textContent('#qi-total')).toBe('$1,400.00');
    await page.click('text=Add a charge');   // a charge is one line, one price; a part has a count
    await page.locator('.qi-desc').nth(1).fill('Haul away');
    await page.locator('#qi-page .ios-val input').nth(1).fill('75');
    expect(await page.textContent('#qi-total')).toBe('$1,475.00');
  });

  test('Send saves a won invoice Collect can see, remembers the mode, and never bills the same work twice', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiSend();
      const again = _qiUnbilled(901);
      return {
        bid: { kind: bid.kind, status: bid.status, amount: bid.amount, lines: bid.lineItems.length, exp: bid.qiExpenseIds, through: !!bid.qiTimeThrough, days: bid.qiDays },
        balance: getBidBalance(bid),
        inCollect: bids.filter(b => b.status === 'Closed Won' && getBidBalance(b) > 0.01).some(b => b.id === bid.id),
        mode: getClientById(901).qiMode,
        again: again.lines.length,
        page: document.querySelector('.pg.active').id,
      };
    });
    // The invoice carries its days, never a through-mark: a through-mark lost a
    // day he left for later (Earl's audit 2026-09-29).
    // One line for the day: parts cost is off by default, so the day's labor and
    // parts go out as one amount (owner 2026-09-29).
    expect(r.bid).toEqual({ kind: 'quick_invoice', status: 'Closed Won', amount: 1307.5, lines: 1, exp: ['e1'], through: false, days: ['2026-09-24'] });
    expect(r.balance).toBe(1307.5);
    expect(r.inCollect).toBe(true);
    expect(r.mode).toBe('hourly');
    expect(r.again).toBe(0);
    expect(r.page).toBe('pg-dash');
  });

  test('a customer with nothing tracked opens on Set price; an empty invoice will not send', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const n = bids.length;
      openQuickInvoice(903);
      const seg = document.querySelector('#qi-page .qi-seg .on').textContent;
      const out = qiSend();
      return { seg, sent: !!out, grew: bids.length !== n };
    });
    expect(r.seg).toBe('Set price');
    expect(r.sent).toBe(false);
    expect(r.grew).toBe(false);
  });

  test('time on a job with a proposal stays off, and the screen says to bill it from that job', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      bids.push({ id: 'b77', client_id: 901, type: 'Time & Materials', isTM: true, status: 'Closed Won', amount: 2000 });
      payments.push({ id: 'p77', bid_id: 'b77', amount: 500, date: '2026-09-20', method: 'Card' });
      jobs.find(j => j.id === 'j901').bid_id = 'b77';
      openQuickInvoice(901);
      return { text: document.getElementById('qi-page').textContent, total: document.getElementById('qi-total').textContent };
    });
    expect(r.text).not.toContain('Jack Sample');
    expect(r.text).toContain('John has a');
    expect(r.text).toContain('$500 paid');
    expect(r.text).toContain('Bill that one from the job');
    expect(r.total).toBe('$300.00');                 // only the receipt is left
  });

  test('a proposal job paid in full says nothing', async ({ page }) => {
    await boot(page);
    const t = await page.evaluate(() => {
      bids.push({ id: 'b78', client_id: 901, type: 'Build Your Own Estimate', isFreeForm: true, status: 'Closed Won', amount: 800 });
      payments.push({ id: 'p78', bid_id: 'b78', amount: 800, date: '2026-09-20', method: 'Cash' });
      jobs.find(j => j.id === 'j901').bid_id = 'b78';
      openQuickInvoice(901);
      return document.getElementById('qi-page').textContent;
    });
    expect(t).not.toContain('Bill that one from the job');
  });

  test('See it opens the invoice in the proposal\'s own letterhead, before anything is saved', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const n = bids.length;
      openQuickInvoice(901);
      qiSeeIt();
      const ov = document.getElementById('_prop-preview-ov');
      return { text: ov && ov.textContent, cover: !!(ov && ov.querySelector('.prop-cover')), saved: bids.length !== n };
    });
    expect(r.cover, 'the same cover the proposal opens on').toBe(true);
    expect(r.text).toContain('Billed to');
    // Time on site and crew size, never man-hours or names (owner 2026-09-29).
    expect(r.text).toContain('Labor · 6.5 hrs on site · 2 techs');
    // Parts default to "in the total, not listed" (owner 2026-09-29).
    expect(r.text).not.toContain('Materials included');
    expect(r.text).not.toContain('$300.00');
    expect(r.text).not.toContain('Jack Sample');
    expect(r.text).not.toContain('Draft');
    expect(r.text).toContain('INV-');
    expect(r.text).toContain('Total due');
    expect(r.text).toContain('$1,307.50');
    expect(r.text).not.toContain('Valid until');
    expect(r.saved).toBe(false);
  });

  test('Pay now saves the invoice and opens the pay panel on it', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiPayNow();
      return { kind: bid && bid.kind, active: window.activePayBidId === bid.id || (typeof activePayBidId !== 'undefined' && activePayBidId === bid.id) };
    });
    expect(r.kind).toBe('quick_invoice');
    expect(r.active).toBe(true);
    expect(await page.locator('#mpay-btn-deposit').count(), 'no deposit on a finished job').toBe(0);
  });

  test('each customer says whether the work is going on, coming up, or done', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      jobs.push({ id: 'jnow', client_id: 902, start: todayKey(), days: 2 });
      jobs.push({ id: 'jnext', client_id: 903, start: addDays(todayKey(), 5), days: 1 });
      jobs.find(j => j.id === 'j901').status = 'done';
      jobs.find(j => j.id === 'j901').completion_date = '2026-09-24';
      jobs.find(j => j.id === 'j901').start = '2026-09-20';
      openQuickInvoice(902);
      const pill902 = document.querySelector('#qi-page .qi-st').textContent;
      return { s901: _qiStatus(901), s902: pill902, s903: _qiStatus(903).label, none: _qiStatus(999) };
    });
    expect(r.s901.label).toBe('Done Sep 24');
    expect(r.s902).toBe('Working now');
    expect(r.s903).toMatch(/^Scheduled /);
    expect(r.none).toBe(null);
  });

  test('the printed invoice lists each line', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(() => {
      openQuickInvoice(901);
      const bid = qiSend();
      let out = '';
      const orig = window.open;
      window.open = () => ({ document: { write: (s) => { out += s; }, close() {} }, focus() {}, print() {} });
      try { printInvoice(bid.id); } catch (_e) {}
      window.open = orig;
      return out;
    });
    expect(html).toContain('Labor · 6.5 hrs on site · 2 techs');
    expect(html).not.toContain('Jack Sample');
    // Parts default to in the total and not listed; never the store receipts.
    expect(html).not.toContain('Materials included');
    expect(html).not.toContain('Ferguson');
  });

  test('crew never reach the invoice screen', async ({ page }) => {
    await boot(page);
    const id = await page.evaluate(() => {
      const was = window._isEmployee;
      window._isEmployee = true;
      try { goPg('pg-qi'); } finally { window._isEmployee = was; }
      return document.querySelector('.pg.active').id;
    });
    expect(id).not.toBe('pg-qi');
  });

  // Owner 2026-09-28: "time to search for hours is slow". The invoice asks the
  // server for this customer's rows only, skips shop rows, and runs the reads
  // side by side; everybody else's _fetchCrewLabor call is unchanged.
  test('hours: one customer\'s rows only, no shop read, reads side by side', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const calls = []; let open = 0, peak = 0;
      const mk = (t) => { const c = { t, f: [] }; calls.push(c);
        const q = { select: () => q, is: () => q, eq: () => q, gte: () => q, or: (x) => { c.or = x; return q; },
          then: (res, rej) => { open++; peak = Math.max(peak, open); return new Promise(r => setTimeout(r, 30)).then(() => { open--; return { data: [] }; }).then(res, rej); } };
        return q; };
      const saved = { sp: window._supa, se: window.supaEnabled, su: window._supaUser };
      window._supa = { from: mk }; window.supaEnabled = () => true; window._supaUser = { id: 'owner-uid' };
      const c = clients.find(x => x.id === 901);
      c.extraAddresses = [{ label: 'Rental', addr: '9 "Quoted" Ln, Springfield, IL' }];
      await _fetchCrewLabor('2026-09-01T00:00:00Z', { noShop: true, only: _qiOnly(c) });
      const one = { tables: calls.map(x => x.t), or: calls.find(x => x.t === 'job_time_entries').or, peak };
      calls.length = 0; peak = 0;
      await _fetchCrewLabor('2026-09-01T00:00:00Z');
      const all = { tables: calls.map(x => x.t).sort(), or: calls.find(x => x.t === 'job_time_entries').or, peak };
      const none = await _fetchCrewLabor(null, { only: { jobIds: [], places: [] } });
      Object.assign(window, { _supa: saved.sp, supaEnabled: saved.se, _supaUser: saved.su });
      return { one, all, none: none.entries.length, esc: _crewOnlyOr({ jobIds: ['j9', 'x;drop'], places: ['A "B" (C)'] }) };
    });
    expect(r.one.tables).not.toContain('shop_time_entries');
    expect(r.one.or).toContain('job_id.in.(j901)');
    expect(r.one.or).toContain('dest_place.in.(');
    expect(r.one.or).toContain('John Doe');
    expect(r.one.peak, 'the reads run side by side').toBeGreaterThanOrEqual(2);
    expect(r.all.tables, 'everyone else still gets every table').toEqual(['job_time_entries', 'shop_time_entries', 'team_members']);
    expect(r.all.or).toBeUndefined();
    expect(r.all.peak).toBe(3);
    expect(r.none).toBe(0);
    expect(r.esc).toBe('job_id.in.(j9,xdrop),dest_place.in.("A \\"B\\" (C)"),origin_place.in.("A \\"B\\" (C)")');
  });

  test('hours: what the Time Log already fetched paints at once', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const t = Date.parse('2026-09-25T15:00:00Z'), h = 3600e3;
      _tlCrewCache = { since: new Date(Date.now() - 200 * 86400e3).toISOString(), payload: { name: { 'u1': 'Jack Sample' }, entries: [
        { employee_user_id: 'u1', job_id: null, dest_place: _geoFenceName('Mary Smith', '77 Lakeview Dr'), source: 'visit', arrived_at: new Date(t).toISOString(), departed_at: new Date(t + 2 * h).toISOString(), minutes: 120 },
      ] } };
      const saved = window.supaEnabled; window.supaEnabled = () => false;
      openQuickInvoice(902);
      const lines = _qi.tracked.filter(l => l.kind === 'time').map(l => l.who + ' ' + l.mins);
      window.supaEnabled = saved; _tlCrewCache = null;
      return lines;
    });
    expect(r).toContain('Jack Sample 120');
  });

  for (const w of [320, 390]) {
    test('no bleed at ' + w + 'px', async ({ page }) => {
      await boot(page, w);
      await page.evaluate(() => openQuickInvoice(901));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
});
