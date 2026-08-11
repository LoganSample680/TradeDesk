// @ts-check
// ── Caller ID (owner 2026-08-11) ─────────────────────────────────────────────
// "Simply always return the business name we already save in the app based on
// the phone number that's entered." The native half publishes to an iOS Call
// Directory extension; everything decided here is the JS half: which contacts
// go out, what the label says, and the ordering iOS demands.
//
// THE FAILURE THIS SUITE EXISTS TO PREVENT: iOS rejects the ENTIRE entry set,
// silently, if numbers are not in ascending order. No crash, no message, every
// client just quietly stops being named. It cannot be caught by looking.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Caller ID publishing', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('_callerIdE164: real numbers convert, junk is refused', async () => {
    const r = await page.evaluate(() => ({
      plain: _callerIdE164('3165550100'),
      formatted: _callerIdE164('(316) 555-0100'),
      withCountry: _callerIdE164('1-316-555-0100'),
      dotted: _callerIdE164('316.555.0100'),
      intl: _callerIdE164('442071838750'),
      short: _callerIdE164('5550100'),
      extension: _callerIdE164('101'),
      zip: _callerIdE164('67203'),
      badArea: _callerIdE164('1165550100'),   // area code cannot start with 1
      badExchange: _callerIdE164('3161550100'), // exchange cannot start with 1
      empty: _callerIdE164(''),
      nul: _callerIdE164(null),
      undef: _callerIdE164(undefined),
      garbage: _callerIdE164('call me!'),
    }));
    expect(r.plain, '10 digits gain the country code').toBe(13165550100);
    expect(r.formatted, 'display formatting is stripped').toBe(13165550100);
    expect(r.withCountry, 'a leading 1 is not doubled').toBe(13165550100);
    expect(r.dotted).toBe(13165550100);
    expect(r.intl, 'an international number passes through').toBe(442071838750);
    expect(r.short, 'too short to dial').toBe(null);
    expect(r.extension).toBe(null);
    expect(r.zip, 'a zip code is not a phone number').toBe(null);
    expect(r.badArea, 'NANP area codes start 2-9').toBe(null);
    expect(r.badExchange, 'NANP exchanges start 2-9').toBe(null);
    expect(r.empty).toBe(null);
    expect(r.nul).toBe(null);
    expect(r.undef).toBe(null);
    expect(r.garbage).toBe(null);
  });

  test('_callerIdList: ascending order, de-duped, unusable records dropped', async () => {
    const r = await page.evaluate(() => {
      const saved = clients.slice();
      try {
        clients.length = 0;
        clients.push(
          { id: 9001, name: 'Zeta Roofing', phone: '(918) 555-0142' },
          { id: 9002, name: 'Alpha Plumbing', phone: '316-555-0100' },
          { id: 9003, name: '', phone: '316-555-0199' },          // no name to show
          { id: 9004, name: 'No Phone Co', phone: '' },           // nothing to match
          { id: 9005, name: 'Bad Number LLC', phone: '123' },     // not dialable
          { id: 9006, name: 'Old Tenant', phone: '620-555-0177' },
          { id: 9007, name: 'New Tenant', phone: '(620) 555-0177' }, // same line, later record
          { id: 9008, name: 'x'.repeat(120), phone: '405-555-0123' },
        );
        const list = _callerIdList();
        const nums = list.map(e => e.number);
        return {
          list,
          sorted: nums.every((n, i) => i === 0 || n > nums[i - 1]),
          names: list.map(e => e.label),
          longLabel: (list.find(e => e.number === 14055550123) || {}).label.length,
        };
      } finally { clients.length = 0; saved.forEach(c => clients.push(c)); }
    });
    expect(r.sorted, 'STRICTLY ascending: iOS silently drops an unsorted set').toBe(true);
    // Eight rows in, four entries out: two rows share one line (later wins),
    // and three are unusable (no name, no phone, not dialable).
    expect(r.list.length, 'four distinct publishable numbers from eight rows').toBe(4);
    expect(r.names).not.toContain('No Phone Co');
    expect(r.names).not.toContain('Bad Number LLC');
    expect(r.names).not.toContain('Old Tenant');
    expect(r.names, 'the later record wins a shared line').toContain('New Tenant');
    expect(r.longLabel, 'labels are capped, iOS truncates anyway').toBe(60);
    expect(r.list[0].number, 'lowest number first').toBe(13165550100);
  });

  test('publishes to the plugin, skips an identical republish, resumes on a real change', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, savedClients = clients.slice();
      const pushes = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdCallerId' ? {
            setContacts: (o) => { pushes.push(o.contacts.length); return Promise.resolve({ count: o.contacts.length, reloaded: true }); },
            status: () => Promise.resolve({ status: 'enabled', count: pushes.length }),
          } : null,
        };
        clients.length = 0;
        clients.push({ id: 9101, name: 'First Client', phone: '316-555-0101' });
        await _callerIdSync();
        const first = pushes.length;
        await _callerIdSync();                       // nothing changed
        const afterRepeat = pushes.length;
        clients.push({ id: 9102, name: 'Second Client', phone: '316-555-0102' });
        await _callerIdSync();                       // a real change
        return { first, afterRepeat, afterChange: pushes.length, counts: pushes };
      } finally { window.Capacitor = realCap; clients.length = 0; savedClients.forEach(c => clients.push(c)); }
    });
    expect(r.first, 'the first publish goes out').toBe(1);
    expect(r.afterRepeat, 'an identical list never re-reloads the extension').toBe(1);
    expect(r.afterChange, 'a new client publishes again').toBe(2);
    expect(r.counts).toEqual([1, 2]);
  });

  test('browser and PWA: no plugin means no publish and no error', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = undefined;
        const synced = await _callerIdSync();
        const status = await _callerIdStatus();
        _callerIdSyncSoon(1); // must not schedule anything or throw
        return { synced, status };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.synced, 'nothing to publish to').toBe(null);
    expect(r.status.status).toBe('unsupported');
  });

  test('the enable walkthrough names the exact Settings path and opens it', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      let opened = 0;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            setContacts: () => Promise.resolve({ count: 0, reloaded: true }),
            openSettings: () => { opened++; return Promise.resolve(); },
          }),
        };
        _callerIdPrompt();
        const text = document.querySelector('#_cid-ov .zmodal')?.textContent || '';
        document.getElementById('_cid-go')?.click();
        await new Promise(res => setTimeout(res, 50));
        const gone = !document.getElementById('_cid-ov');
        // And the escape hatch: reopening and dismissing leaves nothing behind.
        _callerIdPrompt();
        document.getElementById('_cid-later')?.click();
        return { text, opened, gone, dismissed: !document.getElementById('_cid-ov') };
      } finally { window.Capacitor = realCap; document.getElementById('_cid-ov')?.remove(); }
    });
    expect(r.text).toContain('Call Blocking');
    expect(r.text, 'names the app they must toggle').toContain('TradeDesk');
    expect(r.opened, 'one tap lands in the right Settings screen').toBe(1);
    expect(r.gone).toBe(true);
    expect(r.dismissed).toBe(true);
  });

  test('no console errors during caller ID tests', async () => {
    assertNoErrors(page, 'caller ID');
  });
});

// ── On-device receipt reading (owner 2026-08-11) ─────────────────────────────
// "Is this instant and more accurate?" Apple's OCR reads characters fast and
// offline but has no judgment; these tests pin the judgment layer, which is
// the half that decides whether a contractor's expense is right.
//
// THE BUG THIS EXISTS TO PREVENT is documented and real: raw OCR asked for the
// total confidently returns the SUBTOTAL.
test.describe('On-device receipt parsing', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the total beats the subtotal, the tax, and the cash tendered', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'HOME DEPOT',
      '4600 W KELLOGG DR',
      'WICHITA KS 67209',
      '316-555-0142',
      '2x4x8 STUD           $4.28',
      'DECK SCREWS 5LB     $42.97',
      'SUBTOTAL            $47.25',
      'SALES TAX            $3.66',
      'TOTAL               $50.91',
      'CASH               $60.00',
      'CHANGE              $9.09',
      '08/09/2026 14:22',
    ]));
    expect(r.amount, 'the total, never the subtotal').toBe('50.91');
    expect(r.vendor).toBe('HOME DEPOT');
    expect(r.date).toBe('2026-08-09');
  });

  test('a label on its own line still finds its number (thermal receipts)', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      "MENARDS",
      'PVC ELBOW              3.18',
      'SUBTOTAL',
      '28.44',
      'TOTAL',
      '30.76',
      '7/4/26',
    ]));
    expect(r.amount, 'the number under TOTAL, not under SUBTOTAL').toBe('30.76');
    expect(r.date, 'two-digit years are this century').toBe('2026-07-04');
  });

  test('grand total wins over an earlier total', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'ACE HARDWARE', 'TOTAL     100.00', 'DELIVERY   25.00', 'GRAND TOTAL  125.00',
    ]));
    expect(r.amount).toBe('125.00');
  });

  test('no labelled total: the largest amount in the bottom half, flagged as a guess', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'Corner Lumber', 'plywood 4x8', '38.50', 'delivery', '62.75',
    ]));
    expect(r.amount).toBe('62.75');
    expect(r.guessed, 'the caller can tell this was inferred').toBe(true);
  });

  test('vendor skips phone numbers, street addresses, and receipt headers', async () => {
    const r = await page.evaluate(() => ({
      header: _rcptParseLines(['RECEIPT #4471', '1200 N Main St', '316-555-0100', 'Bobs Paint Supply', 'TOTAL 12.00']).vendor,
      digits: _rcptParseLines(['#8842119', '2026', 'Sherwin Williams', 'TOTAL 88.00']).vendor,
    }));
    expect(r.header, 'the store name, not the receipt number or address').toBe('Bobs Paint Supply');
    expect(r.digits).toBe('Sherwin Williams');
  });

  test('money detection refuses quantities, SKUs, and phone fragments', async () => {
    const r = await page.evaluate(() => ({
      good: _rcptMoneyIn('TOTAL $1,234.56'),
      plain: _rcptMoneyIn('48.10'),
      qty: _rcptMoneyIn('QTY 3'),
      sku: _rcptMoneyIn('SKU 884211900'),
      phone: _rcptMoneyIn('316-555-0100'),
      empty: _rcptMoneyIn(''),
      nul: _rcptMoneyIn(null),
    }));
    expect(r.good).toEqual([1234.56]);
    expect(r.plain).toEqual([48.10]);
    expect(r.qty, 'a bare integer is not money').toEqual([]);
    expect(r.sku).toEqual([]);
    expect(r.phone).toEqual([]);
    expect(r.empty).toEqual([]);
    expect(r.nul).toEqual([]);
  });

  test('garbage and empty input never throw', async () => {
    const r = await page.evaluate(() => {
      const cases = [[], null, undefined, [''], ['   '], ['%%%', '@@@'], [null, undefined, 42]];
      return cases.map(c => { try { const p = _rcptParseLines(c); return { ok: true, amount: p.amount, vendor: p.vendor }; } catch (e) { return { ok: false }; } });
    });
    r.forEach(x => expect(x.ok, 'a bad OCR read must never break the expense flow').toBe(true));
  });

  test('the local read never overwrites a value already on the form', async () => {
    const r = await page.evaluate(() => {
      const mk = (id, val) => { const el = document.createElement('input'); el.id = id; el.value = val; el.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(el); return el; };
      document.getElementById('em-vendor')?.remove();
      document.getElementById('em-amount')?.remove();
      const v = mk('em-vendor', 'Typed By Hand'), a = mk('em-amount', '');
      const filled = _rcptApplyLocalRead({ vendor: 'OCR Vendor', amount: '50.91' });
      const out = { filled, vendor: v.value, amount: a.value };
      v.remove(); a.remove();
      return out;
    });
    expect(r.vendor, 'a hand-typed vendor is never clobbered').toBe('Typed By Hand');
    expect(r.amount, 'an empty field is filled').toBe('50.91');
    expect(r.filled).toBe(1);
  });

  test('no console errors during receipt parsing tests', async () => {
    assertNoErrors(page, 'on-device receipt parsing');
  });
});
