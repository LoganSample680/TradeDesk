// @ts-check
/**
 * One copy of each (audit 2026-10-01). The owner asked how much of the
 * proposal and invoice code is the same and to merge what could be: the
 * customer's invoice, "say it and Tim builds it", the price book list, the
 * dock bar, the deposit-law lookup and the money format. Each has one home
 * now; these tests prove the one home works and the old copies are gone.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test.describe('Shared code, one copy of each', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppBoot(page);
  });
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'shared code'); });

  test('the old copies are gone', async ({ page }) => {
    const r = await page.evaluate(() => ['_qiMoney', '_byoMoney', '_supMoney', '_qiPriceBook'].map(n => typeof window[n]));
    expect(r).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  });

  test('one money format: cents by default, whole dollars on request, and map(fmt) still gives cents', async ({ page }) => {
    const r = await page.evaluate(() => ({ a: fmt(1234.5), b: fmt(1234.5, { whole: true }), c: [5, 6].map(fmt), d: fmt('x'), e: fmt(null, { whole: true }), f: _supFmt('12.345') }));
    expect(r).toEqual({ a: '$1,234.50', b: '$1,235', c: ['$5.00', '$6.00'], d: '$0.00', e: '$0', f: '$12.35' });
  });

  test('one dock bar: Build Your Own and T&M paint the same buttons under their own ids', async ({ page }) => {
    const r = await page.evaluate(() => {
      // The page's own docks (index.html), put back as they were after.
      const b = document.getElementById('byo-dock'), t = document.getElementById('tm-dock');
      const keep = [b.innerHTML, t.innerHTML];
      _docDockPaint('byo', null); _docDockPaint('tm', { label: 'Add a step', fn: 'void 0' });
      const out = { byo: [...b.querySelectorAll('button')].map(x => x.id || x.className), tm: [...t.querySelectorAll('button')].map(x => x.id || x.className), tmLabel: t.querySelector('#tm-dock-go').textContent, state: [b.dataset.state, t.dataset.state] };
      b.innerHTML = keep[0]; t.innerHTML = keep[1]; _docDockPaint('nope', null);
      return out;
    });
    expect(r.byo).toEqual(['tm-dock-tim', 'byo-dock-sign', 'byo-dock-go']);
    expect(r.tm).toEqual(['tm-dock-tim', 'tm-dock-go']);
    expect(r.tmLabel).toBe('Add a step');
    expect(r.state).toEqual(['now', 'todo']);
  });

  test('one deposit-law lookup: the job address decides the state, a business job is under none', async ({ page }) => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('gei-addr'), was = el.value; el.value = '12 Main St, Fresno, CA 93701';
      const keep = _geiIsCommercial;
      _geiIsCommercial = false; const home = _geiDepositLaw();
      _geiIsCommercial = true; const biz = _geiDepositLaw();
      _geiIsCommercial = keep; el.value = was;
      return { st: home.st, applies: home.applies, biz: biz.applies };
    });
    expect(r).toEqual({ st: 'CA', applies: true, biz: false });
  });

  test('one price book list: the invoice and the proposal agree on what he has sold twice', async ({ page }) => {
    const r = await page.evaluate(() => {
      S.priceBook = { plumbing: [{ desc: 'Replace water heater', rate: 1400, n: 3 }, { desc: 'One-off odd job', rate: 50, n: 1 }], hvac: [{ desc: 'Furnace tune-up', rate: 129, n: 2 }] };
      return { inv: _pbList(null, { everyTrade: true }).map(p => p.desc), est: _pbList('plumbing').map(p => p.desc) };
    });
    expect(r.inv).toEqual(['Replace water heater', 'Furnace tune-up']);
    expect(r.est).toEqual(['Replace water heater']);
  });

  test('"say it and Tim builds it" is one helper that all three screens call', async () => {
    const ge = src('js/generic-estimate.js'), qi = src('js/quick-invoice.js');
    expect(ge).toMatch(/function _scopeSayBuild\(key,said,o\)/);
    expect(ge).toMatch(/function _byoTakeSaid[\s\S]{0,200}_scopeSayBuild\('byo'/);
    expect(ge).toMatch(/function _geiScopeBuild[\s\S]{0,600}_scopeSayBuild\(_geiIsTM\?'tm':null/);
    expect(qi).toMatch(/function _qiSayBuild[\s\S]{0,900}_scopeSayBuild\(hourly\?'qi':null/);
    // Only the helper calls timScopeBuild in these three files' build paths.
    expect((ge.match(/timScopeBuild\(said/g) || []).length).toBe(1);
    expect((qi.match(/timScopeBuild\(/g) || []).length).toBe(0);
  });

  test('one invoice document for every bill: a proposal job prints its price, change order and tax in the shared shell', async ({ page }) => {
    const r = await page.evaluate(() => {
      clients.push({ id: 7801, name: 'Ann Lee', addr: '9 Elm St, Wichita, KS', phone: '3165550199', status: 'Client' });
      bids.push({ id: 7802, client_id: 7801, client_name: 'Ann Lee', type: 'Build Your Own Estimate', isFreeForm: true, status: 'Closed Won', amount: 3300, salesTax: 50,
        byoItems: [{ label: 'Repipe the house', section: 'Whole house', on: true }, { label: 'Supplies', _supply: true, on: true }],
        changeOrders: [{ coNum: 1, desc: 'Add a hose bib', delta: 250, signedAt: '2026-09-20T12:00:00Z' }, { coNum: 2, desc: 'Not signed', delta: 999 }] });
      payments.push({ id: 'pp1', bid_id: 7802, amount: 1000, date: '2026-09-21', type: 'deposit', method: 'Card' });
      const doc = _invoiceDocForBid(bids.find(b => b.id === 7802));
      const live = _invoiceDocForBid(bids.find(b => b.id === 7802), { live: true });
      let printed = '';
      const o = window.open; window.open = () => ({ document: { write: (h) => { printed = h; }, close() {} } });
      printInvoice(7802); window.open = o;
      const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' '); };
      return { doc: txt(doc), live: txt(live), printedSame: printed.includes(live), hours: / hrs?\b/.test(txt(doc)) };
    });
    expect(r.doc).toMatch(/Build Your Own[^$]*\$3,000\.00/);       // the price, before the change order and tax
    expect(r.doc).toMatch(/Change order #1 · Add a hose bib\s*\$250\.00/);
    expect(r.doc).not.toContain('Not signed');
    expect(r.doc).toMatch(/Sales tax\s*\$50\.00/);
    expect(r.doc).toMatch(/Total due\s*\$3,300\.00/);
    expect(r.doc).toContain('Repipe the house');
    expect(r.doc).not.toContain('Supplies');
    expect(r.hours).toBe(false);
    expect(r.live).toMatch(/\(\$1,000\.00\)/);
    expect(r.live).toMatch(/Balance due\s*\$2,300\.00/);
    expect(r.printedSame).toBe(true);
  });

  test('sending any bill saves its document for the hub, and the hub snapshot points at it', async ({ page }) => {
    const r = await page.evaluate(async () => {
      clients.push({ id: 7811, name: 'Bo Diaz', addr: '1 Oak', clientToken: 'tok7811', status: 'Client' });
      bids.push({ id: 7812, client_id: 7811, type: 'Time & Materials', isTM: true, status: 'Closed Won', amount: 900 });
      const put = [];
      const keep = { supa: _supa, user: _supaUser, en: window.supaEnabled, hub: window._uploadClientHub, sheet: window.tdSendSheet };
      try {
        window.supaEnabled = () => true; _supaUser = { id: '11111111-2222-3333-4444-555555555555' };
        _supa = Object.assign({}, _supa || {}, { storage: { from: () => ({ upload: async (key, body) => { put.push({ key, body: JSON.parse(body) }); return { error: null }; } }) } });
        window._uploadClientHub = async () => {}; window.tdSendSheet = () => {};
        await _sendPaidInvoice(7812);
        const hb = _buildClientHubSnapshot(7811).bids.find(b => b.id === 7812) || {};
        return { n: put.length, doc: put[0] && put[0].body.invoiceHtml.includes('Time &amp; Materials') || (put[0] && put[0].body.invoiceHtml.includes('Time & Materials')), key: bids.find(b => b.id === 7812).invoiceDocKey === (put[0] && put[0].key), hub: hb.invoiceDocKey === (put[0] && put[0].key) };
      } finally { _supa = keep.supa; _supaUser = keep.user; window.supaEnabled = keep.en; window._uploadClientHub = keep.hub; window.tdSendSheet = keep.sheet; }
    });
    expect(r).toEqual({ n: 1, doc: true, key: true, hub: true });
  });

  test('one storage upload: every document goes through _tdStoreDoc, which never throws', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const keep = _supa; const got = [];
      _supa = { storage: { from: (b) => ({ upload: async (k, body, opt) => { got.push([b, k, typeof body, opt.upsert, opt.cacheControl]); return { error: null }; } }) } };
      const a = await _tdStoreDoc('k1', { a: 1 }), b = await _tdStoreDoc('k2', '{"x":1}', { upsert: false, cache: '3600' });
      _supa = { storage: { from: () => ({ upload: async () => { throw new Error('boom'); } }) } };
      const c = await _tdStoreDoc('k3', {});
      _supa = null; const d = await _tdStoreDoc('k4', {});
      _supa = keep;
      return { got, a: a.error, b: b.error, c: !!c.error, d: !!d.error };
    });
    expect(r.got).toEqual([['proposals', 'k1', 'string', true, '0'], ['proposals', 'k2', 'string', false, '3600']]);
    expect(r).toMatchObject({ a: null, b: null, c: true, d: true });
    for (const f of ['js/agreements.js', 'js/cloud.js', 'js/generic-estimate.js', 'js/photo-gallery.js', 'js/proposals.js', 'js/quick-invoice.js']) {
      expect(src(f), f + ' uploads only through _tdStoreDoc').not.toMatch(/storage\.from\('proposals'\)\.upload\(/);
    }
  });

  test('one estimate save set: the new-bid save writes the crew rates too, through _geiContentFields', async () => {
    const ge = src('js/generic-estimate.js');
    expect((ge.match(/_geiContentFields\(\)/g) || []).length).toBe(4);   // the helper and its three callers
    expect(ge).toMatch(/estCrewRates:Object\.assign\(\{\},_estCrewRates\)/);
    expect(ge).not.toMatch(/_byoSecsSave|_byoTermsSave/);
  });

  test('one note row: Build Your Own uses the same row as T&M and the invoice', async ({ page }) => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'byo-sec-note'; host.dataset.open = '0'; document.body.appendChild(host);
      _geiNote = 'Thanks for having us.';
      _docNoteRender('byo'); const closed = host.textContent;
      _docNoteToggle('byo'); const box = document.getElementById('byo-note');
      const out = { closed, open: !!box, val: box && box.value, row: host.querySelector('.ios-row .ios-lbl').firstChild.textContent };
      host.remove(); _geiNote = '';
      return out;
    });
    expect(r.closed).toContain('On the proposal');
    expect(r).toMatchObject({ open: true, val: 'Thanks for having us.', row: 'Your note to them' });
    expect(src('js/generic-estimate.js')).not.toContain('byo-note-wrap');
  });

  test('money: the estimate code formats through fmt; short drops only .00', async ({ page }) => {
    const r = await page.evaluate(() => [fmt(1200, { short: true }), fmt(62.5, { short: true }), fmt(0, { short: true }), fmt(1199.996, { short: true })]);
    expect(r).toEqual(['$1,200', '$62.50', '$0', '$1,200']);
    const ge = src('js/generic-estimate.js');
    expect(ge).not.toMatch(/const fmt=/);
    expect(ge).not.toMatch(/function _presentMoney/);
  });

  test('the customer pages share one document fetch, with the timeout', async () => {
    const def = /async function _fetchStorageJson\(/g;
    expect((src('client.html').match(def) || []).length).toBe(0);
    expect((src('sign.html').match(def) || []).length).toBe(0);
    expect((src('js/esign.js').match(def) || []).length).toBe(1);
    expect(src('js/esign.js')).toMatch(/AbortController/);
  });

  test('the shared build: steps land on the list it names, parts go to Materials, junk never throws', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = _scopeSayBuild(null, 'Replace the water heater and haul away the old one', { log: false });
      let junk = 'ok';
      try { _scopeSayBuild(null, '', { log: false }); _scopeSayBuild(null, null, { log: false }); } catch (e) { junk = e.message; }
      return { steps: out.built.steps.length > 0, missed: out.missed, filled: out.filled, junk };
    });
    expect(r).toEqual({ steps: true, missed: [], filled: [], junk: 'ok' });
  });
});
