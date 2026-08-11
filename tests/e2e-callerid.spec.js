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
