// @ts-check
/**
 * TIM KNOWS THE APP, 500 SENTENCES OF IT (owner 2026-10-03)
 *
 * "500 prompts a user could ask Tim about tradedesk, he should know
 * everything and take them to the source."
 *
 * tests/fixtures/tim-500.json holds them, written the way a plumber, a painter
 * or an electrician says it into a phone: lowercase, no punctuation, "how do
 * I", "take me to", "I need to", "clock me in". Each one names the SOURCE Tim
 * must land on: a screen, the tab on it, the Settings section, the thing to do
 * (with the customer when one is named), the answer off his own books, or one
 * customer's page. The legend is the `_note` at the top of the fixture.
 *
 * Every sentence goes through timResolve, the same decision the send arrow
 * makes (_timGoRun), so this checks what Tim would actually do and not a copy
 * of it. Then a sample of every kind of DO is run for real, to prove the
 * landing is the screen or the form the expectation names.
 *
 * `notInAppYet` lists sentences a contractor would say that the app has no
 * feature for. They are not counted and not asserted: Tim cannot take anybody
 * to a place that does not exist. Build the feature, then move the sentence up.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const KEY = require('./fixtures/tim-500.json');

const NOW = '2026-09-17T15:00:00Z';

test.describe('Tim: 500 things a contractor asks him', () => {
  let page, results;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    results = await page.evaluate(([key, now]) => {
      clients.length = 0; key.clients.forEach(c => clients.push(Object.assign({}, c)));
      // His price book, so "what do I charge for a faucet" has an answer to give.
      const tr = (typeof _pbTrade === 'function' && _pbTrade()) || 'general';
      S.priceBook = S.priceBook || {}; S.priceBook[tr] = key.book.map(b => Object.assign({}, b));
      const o = { clients: key.clients, book: [], catalog: [], photos: [], now: new Date(now) };
      // The source a plan lands on, in the fixture's own words.
      const source = (p) => {
        if (!p) return 'nothing';
        const nm = c => (c && c.name) || '?';
        switch (p.kind) {
          case 'nav': return p.set ? 'set:' + p.set : p.pg + (p.tab ? '/' + p.tab : '');
          case 'do': return 'do:' + p.act + (p.client ? '@' + nm(p.client) : (p.next ? '@next' : ''));
          case 'ask': return 'ask:' + p.ask;
          case 'client': return 'client:' + nm(p.client);
          case 'build': return 'build@' + nm(p.client);
          case 'estimate': return 'estimate@' + nm(p.plan && p.plan.client);
          case 'newclient': return 'newclient:' + p.subject;
          case 'lead': return 'lead:' + p.name;
          default: return p.kind;
        }
      };
      return key.prompts.map(x => {
        let got, say = '';
        try { const p = timResolve(x.said, o); got = source(p); say = timSay(p); } catch (e) { got = 'THREW ' + e.message; }
        return { area: x.area, said: x.said, expect: x.expect, got, say };
      });
    }, [KEY, NOW]);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the list is 500 sentences, each said once, each with a source', () => {
    expect(KEY.prompts.length).toBe(500);
    const seen = new Set();
    for (const x of KEY.prompts) {
      const k = x.said.toLowerCase().trim();
      expect(seen.has(k), 'said twice: ' + x.said).toBe(false);
      seen.add(k);
      expect(typeof x.expect === 'string' && x.expect.length > 0, x.said).toBe(true);
      expect(typeof x.area === 'string' && x.area.length > 0, x.said).toBe(true);
    }
    // A sentence parked as "not in the app yet" is not also counted above.
    for (const n of KEY.notInAppYet) {
      expect(seen.has(n.said.toLowerCase().trim()), 'parked and counted: ' + n.said).toBe(false);
      expect(n.reason.length, n.said).toBeGreaterThan(10);
    }
  });

  test('every screen and settings section the list names is a real one', async () => {
    const real = await page.evaluate(() => ({
      pages: [...document.querySelectorAll('.pg[id]')].map(el => el.id),
      sets: [...document.querySelectorAll('.set-detail[id^="setd-"]')].map(el => el.id.slice(5)),
    }));
    for (const x of KEY.prompts) {
      const pg = /^(pg-[a-z-]+)/.exec(x.expect);
      if (pg) expect(real.pages, x.said).toContain(pg[1]);
      const set = /^set:(.+)$/.exec(x.expect);
      if (set) expect(real.sets, x.said).toContain(set[1]);
    }
  });

  // One test per area, so a red board says which part of the app Tim lost,
  // and the message lists every sentence that missed with what he did instead.
  const AREAS = [...new Set(KEY.prompts.map(x => x.area))];
  for (const area of AREAS) {
    test(`he takes you to the source: ${area}`, () => {
      const miss = results.filter(r => r.area === area && r.got !== r.expect)
        .map(r => `"${r.said}"\n    want: ${r.expect}\n    got:  ${r.got}`);
      expect(miss, `${area}: ${miss.length} missed\n` + miss.join('\n')).toEqual([]);
    });
  }

  test('he says what he is about to do for everything he places, never undefined', () => {
    const bad = results.filter(r => r.got.indexOf('ask:') !== 0 && r.got !== 'nothing' && r.got !== 'none' &&
      (!r.say || /undefined|null/.test(r.say))).map(r => r.said + ' -> ' + JSON.stringify(r.say));
    expect(bad).toEqual([]);
  });

  test('nothing throws', () => {
    expect(results.filter(r => /^THREW/.test(r.got)).map(r => r.said + ': ' + r.got)).toEqual([]);
  });

  // ── And he actually lands there ─────────────────────────────────────────
  // timRun, the half that touches the app, for one sentence of every kind of
  // place and every DO that opens a screen or a form. The check is the page
  // that ends up active and the control that ends up open, which is what a
  // man holding the phone would see.
  test.describe('landing', () => {
    test.beforeEach(async () => {
      await page.evaluate((key) => {
        clients.length = 0; key.clients.forEach(c => clients.push(Object.assign({}, c)));
        document.querySelectorAll('.zmodal-overlay,#expense-modal,#global-search-overlay,#_text-compose-ov,#_tim-sheet,#_tim-ov').forEach(e => e.remove());
        if (typeof _closeSetDetail === 'function') _closeSetDetail();
        goPg('pg-dash');
      }, KEY);
    });

    const at = () => page.evaluate(() => document.querySelector('.pg.active')?.id);

    test('a tab lands on that tab', async () => {
      const r = await page.evaluate(() => {
        timRun('open my mileage');
        const books = { pg: document.querySelector('.pg.active')?.id, tab: trackerTab };
        timRun('show me my vans');
        const fleet = { pg: document.querySelector('.pg.active')?.id, tab: _fleetTabActive };
        timRun('overdue invoices');
        const money = { pg: document.querySelector('.pg.active')?.id, on: document.querySelector('#mft-overdue')?.classList.contains('active') };
        return { books, fleet, money };
      });
      expect(r.books).toEqual({ pg: 'pg-tracker', tab: 'mileage' });
      expect(r.fleet).toEqual({ pg: 'pg-team', tab: 'fleet' });
      expect(r.money).toEqual({ pg: 'pg-money', on: true });
    });

    test('a settings section opens that section and lights the control', async () => {
      const r = await page.evaluate(() => {
        timRun('change my logo');
        const brand = document.getElementById('setd-branding');
        const out = {
          pg: document.querySelector('.pg.active')?.id,
          open: !!brand && brand.classList.contains('active'),
          lit: !!document.querySelector('#set-logo-btn-brand.tim-point-at'),
        };
        timRun('connect stripe');
        out.stripe = document.getElementById('setd-integrations')?.classList.contains('active');
        return out;
      });
      expect(r).toEqual({ pg: 'pg-settings', open: true, lit: true, stripe: true });
    });

    test('new customer opens the New lead form on Customers', async () => {
      await page.evaluate(() => timRun('add a new customer'));
      expect(await at()).toBe('pg-clients');
      expect(await page.evaluate(() => document.getElementById('cf-title')?.textContent)).toBe('New lead');
    });

    test('a customer by name opens his page, and call/text/email use his own buttons', async () => {
      const r = await page.evaluate(() => {
        timRun('pull up tom becker');
        const open = { pg: document.querySelector('.pg.active')?.id, id: currentClientId };
        timRun('text sandra');
        const text = { id: currentClientId, sheet: !!document.getElementById('_text-compose-ov') };
        return { open, text };
      });
      expect(r.open).toEqual({ pg: 'pg-client-detail', id: 8103 });
      expect(r.text).toEqual({ id: 8102, sheet: true });
    });

    test('an invoice for a named customer opens his quick invoice', async () => {
      await page.evaluate(() => timRun('create an invoice for rick delaney'));
      expect(await at()).toBe('pg-qi');
    });

    test('expense, trip, vehicle and crew open the forms their own buttons open', async () => {
      const r = await page.evaluate(() => {
        const seen = {};
        timRun('add an expense');
        seen.expense = !!document.getElementById('expense-modal');
        document.getElementById('expense-modal')?.remove();
        const calls = [];
        const wrap = (n) => { const f = window[n]; window[n] = function () { calls.push(n); }; return () => { window[n] = f; }; };
        const undo = ['openLogTripModal', 'openAddVehicleModal', 'openAddEmployeeModal', 'openAddSubModal', 'openNewAgreement',
          'openAddLicense', 'openPlaceModal', 'openManualIncomeModal', 'openIntakeFormModal', 'openImportContacts', 'openExportPanel',
          'openWhAdd', 'quickAction', '_dashManualClockIn', 'triggerReceiptScan'].map(wrap);
        try {
          ['log a trip', 'add a truck', 'add a guy to my crew', 'add a sub', 'new contract', 'add my insurance', 'add a supplier',
            'log a cash job', 'send my intake form', 'import my contacts', 'export my books', 'add a recurring service',
            'new estimate', 'schedule a job', 'take a payment', 'take a photo', 'start a drive', 'mark a job done', 'clock me in',
            'scan a receipt'].forEach(s => timRun(s));
        } finally { undo.forEach(u => u()); }
        seen.calls = calls;
        seen.pg = document.querySelector('.pg.active')?.id;
        return seen;
      });
      expect(r.expense).toBe(true);
      expect(r.calls).toEqual(['openLogTripModal', 'openAddVehicleModal', 'openAddEmployeeModal', 'openAddSubModal', 'openNewAgreement',
        'openAddLicense', 'openPlaceModal', 'openManualIncomeModal', 'openIntakeFormModal', 'openImportContacts', 'openExportPanel',
        'openWhAdd', 'quickAction', 'quickAction', 'quickAction', 'quickAction', 'quickAction', 'quickAction', '_dashManualClockIn',
        'triggerReceiptScan']);
    });

    test('clock out when not on the clock says so and changes nothing', async () => {
      const r = await page.evaluate(() => {
        const was = _activeTimer; _activeTimer = null;
        try { timRun('clock me out'); return { pg: document.querySelector('.pg.active')?.id, timer: _activeTimer }; }
        finally { _activeTimer = was; }
      });
      expect(r).toEqual({ pg: 'pg-dash', timer: null });
    });

    test('payment reminders and sign out land on the button, they never press it', async () => {
      const r = await page.evaluate(() => {
        const sent = [];
        const a = window.collSendAllReminders, b = window.supaSignOut;
        window.collSendAllReminders = () => sent.push('reminders');
        window.supaSignOut = () => sent.push('signout');
        try {
          timRun('send payment reminders');
          const money = document.querySelector('.pg.active')?.id;
          timRun('log me out');
          return { money, settings: document.querySelector('.pg.active')?.id, sent };
        } finally { window.collSendAllReminders = a; window.supaSignOut = b; }
      });
      expect(r).toEqual({ money: 'pg-money', settings: 'pg-settings', sent: [] });
    });

    test('help puts what he can do on the sheet, and each one is a sentence he places', async () => {
      const r = await page.evaluate((key) => {
        timRun('what can you do');
        const chips = [...document.querySelectorAll('#_tim-help .tim-chip')].map(b => b.textContent);
        const o = { clients: key.clients, book: [], catalog: [], photos: [] };
        const placed = TIM_HELP_CHIPS.map(c => timResolve(c.say, o).kind);
        return { chips: chips.length, placed };
      }, KEY);
      expect(r.chips).toBe(8);
      expect(r.placed.filter(k => k === 'none')).toEqual([]);
    });

    test('search opens the app search with the words in it', async () => {
      const v = await page.evaluate(() => { timRun('search for water heater'); return document.getElementById('global-search-input')?.value; });
      expect(v).toBe('water heater');
    });
  });

  // ── Things he must NOT do ───────────────────────────────────────────────
  test('a question is never mistaken for a thing to do', async () => {
    const r = await page.evaluate(() => ['how many miles did i log', 'what did i spend on gas', 'who do i bill',
      'how much has rick paid me', 'did i clock in today', 'is it going to rain']
      .map(s => timDo(s, clients)));
    expect(r).toEqual([null, null, null, null, null, null]);
  });

  test('a contact verb with nobody named is not a phone call', async () => {
    const r = await page.evaluate(() => ['call it a day', 'text templates', 'directions'].map(s => (timDo(s, clients) || {}).id || null));
    expect(r).toEqual(['clock-out', null, null]);
  });

  test('the thread says what he did in words, never "Went to do"', async () => {
    const r = await page.evaluate(() => [
      _timLogGot({ kind: 'do', name: 'Clock in' }), _timLogGot({ kind: 'client', name: 'Rick Delaney' }),
      _timLogGot({ kind: 'help' }), _timLogGot({ kind: 'search' })]);
    expect(r).toEqual(['Clock in', 'Opened Rick Delaney', 'Here is what I can do', 'Searched the app']);
  });

  test('junk in, nothing thrown', async () => {
    const ok = await page.evaluate(() => {
      try {
        [null, undefined, '', 5, [], {}, '   ', '???', 'add', 'call', 'search', 'a an the'].forEach(s => {
          timDo(s, clients); timDo(s, null); timResolve(s); timResolve(s, {}); timHelpAsk(s); timSearchAsk(s); timWhere(s);
        });
        return true;
      } catch (e) { return String(e.message); }
    });
    expect(ok).toBe(true);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tim 500'); });
});
