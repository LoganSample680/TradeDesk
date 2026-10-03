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
      _supa = { storage: { from: () => ({ upload: () => { throw new Error('sync boom'); } }) } };
      const e = await _tdStoreDoc('k5', {});
      _supa = { storage: { from: () => ({ upload: async () => ({ error: { message: 'denied' } }) }) } };
      const f = await _tdStoreDoc('k6', {});
      _supa = null; const d = await _tdStoreDoc('k4', {});
      _supa = keep;
      // An async function that awaits the upload, not a returned .then() chain:
      // the chain cost a first photo after boot "Promise was collected" (see
      // the first-shot block in e2e-photo-capture).
      return { got, a: a.error, b: b.error, c: !!c.error, d: !!d.error, e: !!e.error, f: f.error && f.error.message,
        isAsync: _tdStoreDoc.constructor.name };
    });
    expect(r.got).toEqual([['proposals', 'k1', 'string', true, '0'], ['proposals', 'k2', 'string', false, '3600']]);
    expect(r).toMatchObject({ a: null, b: null, c: true, d: true, e: true, f: 'denied', isAsync: 'AsyncFunction' });
    expect(src('js/utils.js')).not.toMatch(/Promise\.resolve\(_supa\.storage\.from\('proposals'\)/);
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

  // Audit run 3: four readers each picked a bid's work lines their own way, so
  // the hub, the invoice and the job clock listed different work.
  test('one reader for the work on a bid: hub, invoice and job clock agree', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = { id: 88001, client_id: 1, amount: 900, type: 'Build Your Own Estimate',
        byoItems: [{ label: 'Replace water heater', section: 'Work', on: true }, { label: 'Never picked', on: false },
          { label: 'Fittings', on: true, _supply: true }, { label: 'Lead-safe setup', on: true, _rrp: true }],
        scopeChips: ['Replace water heater', 'Haul-off'], geiDesc: 'Old unit hauled away' };
      const hub = _bidScopeLines(b);
      const inv = _bidWorkItems(b).map(x => x.label);
      const clock = _jobScopesFromBid(b).map(x => x.label);
      const junk = [null, undefined, 'x', 0, {}].map(v => { try { return _bidWorkItems(v).length; } catch (e) { return 'threw'; } });
      return { hub, inv, clock, junk, docHas: _invoiceDocForBid(b).includes('Haul-off') };
    });
    expect(r.hub).toEqual(['Replace water heater', 'Haul-off', 'Old unit hauled away']);
    expect(r.inv).toEqual(r.hub);
    expect(r.clock).toEqual(['Replace water heater', 'Haul-off']);
    expect(r.junk).toEqual([0, 0, 0, 0, 0]);
    expect(r.docHas).toBe(true);
  });
});

// Audit run 4 (2026-10-01): the leftovers. Three were bugs: the deposit was
// worked out in four places (one skipped the business-job exemption on save),
// the Build Your Own rail asked for sales tax its own way, and the trade
// template add ignored the rate he typed on the first add. The rest are one
// home each for code that had two or more.
test.describe('Shared code, the leftovers', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppBoot(page);
  });
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'shared code leftovers'); });

  // A Build Your Own estimate for one client at `addr`, one priced line.
  const openByo = (page, o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_gei-ip-ov,#_byo-add-modal,.toast').forEach(e => e.remove());
    bids.length = 0; clients.length = 0;
    clients.push({ id: 97001, name: 'Ray Whitcomb', addr: o.addr });
    currentClientId = 97001;
    _activeTrade = 'plumbing';
    S.depositPct = o.pct;
    openGenericEstimate(getClientById(97001), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
    const dp = document.getElementById('byo-deposit-pct'); if (dp) dp.value = '';
    _byoItems.length = 0;
    _byoItems.push({ id: 1, label: 'Replace the water heater', section: 'Work', qty: 1, unit: 'ea', rate: o.price, price: o.price, on: true });
    _byoRenderSections(); _byoUpdateRail();
  }, o);

  // BUG 1. The save re-read the state itself and capped a business job's
  // deposit even though the screen (and the law) said it was fine.
  test('bug: a business job is not capped on save; a home job still is', async ({ page }) => {
    await openByo(page, { addr: '12 Main St, Fresno, CA 93701', pct: 50, price: 10000 });
    const r = await page.evaluate(() => {
      const keep = _geiIsCommercial;
      const run = (biz) => {
        _geiIsCommercial = biz;
        const before = bids.length;
        saveGenericEstimate(true);
        const b = bids.find(x => x.id === _geiEditBidId) || bids[bids.length - 1];
        return { deposit: b && b.deposit, screen: _byoDepositState(calcGeiTotal().total), grew: bids.length >= before };
      };
      const biz = run(true), home = run(false);
      _geiIsCommercial = keep;
      return { biz: biz.deposit, bizOver: biz.screen.over, home: home.deposit, homeOver: home.screen.over };
    });
    // California caps a home job at $1,000 or 10 percent, whichever is less.
    expect(r).toEqual({ biz: 5000, bizOver: false, home: 1000, homeOver: true });
  });

  test('bug: every deposit copy reads _byoDepositState, whole dollars on every screen', async ({ page }) => {
    await openByo(page, { addr: '412 Bell St, Topeka, KS 66603', pct: 25, price: 1234.5 });
    const r = await page.evaluate(() => {
      const total = calcGeiTotal().total;
      const want = _byoDepositState(total).amt;
      _byoAutosave();
      const b = bids.find(x => x.id === _geiEditBidId);
      return { want, whole: Number.isInteger(want), present: _presentDeposit(null, true, total), autosave: b ? b.deposit : 'no bid' };
    });
    expect(r.whole).toBe(true);
    expect(r.present).toBe(r.want);
    expect(r.autosave).toBe(r.want);
    const ge = src('js/generic-estimate.js');
    // The percent is read in one place for the money: _byoDepositState.
    expect((ge.match(/total\*_geiDepositPct\(\)|_geiDepositPct\(\)\/100|total\*pct\/100\*100|total\*depPct/g) || []).length).toBe(0);
    // The dead T&M branch inside the not-T&M clamp is gone.
    expect(ge).not.toMatch(/if\(_geiIsTM\)_tmFields\.tmDepositAmt=_deposit/);
  });

  // BUG 2. The rail built its own _docSalesTax call; it reads the proposal's now.
  test('bug: the Build Your Own rail shows the tax calcGeiTotal gives the proposal', async ({ page }) => {
    await openByo(page, { addr: '412 Bell St, Topeka, KS 66603', pct: 25, price: 800 });
    const r = await page.evaluate(() => {
      const real = calcGeiTotal();
      _byoUpdateRail();
      const row = document.getElementById('byo-rail-tax-row');
      const same = { amt: document.getElementById('byo-rail-tax-amt').textContent, want: fmt(real.salesTax), shown: row.style.display !== 'none' || !real.salesTaxLabel };
      // Whatever the proposal says, the rail says: prove it reads calcGeiTotal.
      const orig = window.calcGeiTotal;
      window.calcGeiTotal = function () { const t = orig.apply(this, arguments); return Object.assign({}, t, { salesTax: 12.34, salesTaxLabel: 'Test tax' }); };
      try { _byoUpdateRail(); } finally { window.calcGeiTotal = orig; }
      const forced = { amt: document.getElementById('byo-rail-tax-amt').textContent, lbl: document.getElementById('byo-rail-tax-lbl').textContent, total: document.getElementById('byo-rail-total').textContent };
      _byoUpdateRail();
      return { same, forced };
    });
    expect(r.same.amt).toBe(r.same.want);
    expect(r.same.shown).toBe(true);
    expect(r.forced).toEqual({ amt: '$12.34', lbl: 'Test tax', total: '$812.34' });
    expect(src('js/generic-estimate.js')).not.toMatch(/function _byoUpdateRail[\s\S]{0,1200}_docSalesTax\(/);
  });

  // BUG 3. The price was worked out before his rate was saved, and the
  // rate was never used, so the first add ignored the number he typed.
  test('bug: the trade template add uses the rate he typed, on the first add', async ({ page }) => {
    const r = await page.evaluate(() => {
      _geiLines = []; S.myRates = {};
      const job = { id: 'tst-job', name: 'Test job', unit: 'ea', labor: 100, mat: 20 };
      const el = document.createElement('input'); el.value = '300'; document.body.appendChild(el);
      _geiAddWithRate(job, el);
      const typed = _geiLines.map(l => ({ desc: l.desc, rate: l.rate, jobId: l.jobId || null }));
      _geiLines = [];
      el.value = String(_geiJobPrice({ id: 'other', name: 'Other', unit: 'ea', labor: 100, mat: 20 }).labor + 20);
      _geiAddWithRate({ id: 'other', name: 'Other', unit: 'ea', labor: 100, mat: 20 }, el);
      const market = _geiLines.map(l => l.desc);
      _geiLines = [];
      _geiAddTemplate({ id: 'tpl', name: 'Template', unit: 'ea', labor: 50, mat: 10 });
      const tpl = _geiLines.map(l => ({ desc: l.desc, rate: l.rate, jobId: l.jobId || null }));
      el.remove(); _geiLines = [];
      let junk = 'ok';
      try { _geiPushJobLines(null, 1, 1); _geiPushJobLines('x'); _geiPushJobLines({}, 'a', null); } catch (e) { junk = e.message; }
      const left = _geiLines.length; _geiLines = [];
      return { typed, saved: S.myRates['tst-job'], market, tpl, junk, left };
    });
    expect(r.typed).toEqual([{ desc: 'Test job, labor', rate: 300, jobId: 'tst-job' }]);
    expect(r.saved).toEqual({ labor: 300, mat: 0 });
    expect(r.market).toEqual(['Other, labor', 'Materials']);
    expect(r.tpl).toEqual([{ desc: 'Template, labor', rate: 50, jobId: null }, { desc: 'Materials', rate: 10, jobId: null }]);
    expect(r.junk).toBe('ok');
    expect(r.left).toBe(0);
  });

  test('the dead second T&M deposit and billing cycle are gone; the cap inputs stay', async ({ page }) => {
    const r = await page.evaluate(() => ({
      fns: ['_tmCalcDeposit', '_tmSetCycle', '_tmSyncCycleButtons', '_tmCalcNte', '_tmSaved', '_qiWorkSaved', '_byoDockBuild', '_tmDockBuild',
        '_shortDate', '_geiCents', '_supCents', '_coLinesHTML'].filter(n => typeof window[n] !== 'undefined'),
      els: ['gei-tm-terms', 'tm-dep-pct', 'tm-dep-amt', 'tm-nte-wrap', 'tmc-weekly', 'tmc-biweekly', 'tmc-milestone', 'tmc-completion'].filter(id => document.getElementById(id)),
      kept: ['tm-nte-cap', 'tm-nte-on'].map(id => !!document.getElementById(id)),
    }));
    expect(r.fns).toEqual([]);
    expect(r.els).toEqual([]);
    expect(r.kept).toEqual([true, true]);
  });

  test('_docTaxRateFor: the database rate or null, never throws', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = lookupSalesTaxRate;
      const out = {};
      try {
        lookupSalesTaxRate = async () => ({ rate: 9.15, source: 'db_zip' });
        out.db = await _docTaxRateFor('412 Bell St, Topeka, KS 66603');
        lookupSalesTaxRate = async () => ({ rate: 6.5, source: 'hardcoded' });
        out.hard = await _docTaxRateFor('412 Bell St, Topeka, KS 66603');
        lookupSalesTaxRate = async () => { throw new Error('down'); };
        out.down = await _docTaxRateFor('412 Bell St, Topeka, KS 66603');
        out.junk = await Promise.all([null, undefined, '', 42, {}].map(v => _docTaxRateFor(v)));
      } finally { lookupSalesTaxRate = orig; }
      return out;
    });
    expect(r.db).toEqual({ rate: 9.15, source: 'db_zip' });
    expect(r.hard).toBeNull();
    expect(r.down).toBeNull();
    expect(r.junk).toEqual([null, null, null, null, null]);
  });

  test('_scopeRowsSaved: one saved shape for T&M and the invoice', async ({ page }) => {
    const r = await page.evaluate(() => {
      const rows = [{ label: 'Pull the heater', section: 'Work', notes: 'n', on: true, _written: true, _tim: 'x', id: 7 }, { label: '  ', section: 'Work' }, { label: 'Off one', on: false }];
      return {
        all: _scopeRowsSaved(rows),
        named: _scopeRowsSaved(rows, { named: true }).map(x => x.label),
        tim: _scopeRowsSaved(rows, { named: true, tim: true })[0]._tim,
        junk: [null, undefined, 'x', 5, [null, 3, 'y']].map(v => _scopeRowsSaved(v).length),
      };
    });
    expect(r.all[0]).toEqual({ label: 'Pull the heater', section: 'Work', notes: 'n', on: true, _written: true });
    expect(r.all.length).toBe(3);
    expect(r.all[2].on).toBe(false);
    expect(r.named).toEqual(['Pull the heater', 'Off one']);
    expect(r.tim).toBe('x');
    expect(r.junk).toEqual([0, 0, 0, 0, 0]);
  });

  test('_docDockBuild: builds what is in the box, else points at the box', async ({ page }) => {
    const r = await page.evaluate(() => {
      const box = document.createElement('textarea'); box.id = '_dock-test-box'; document.body.appendChild(box);
      let n = 0;
      _docDockBuild('_dock-test-box', () => n++);
      const empty = n;
      box.value = 'Replace the heater';
      _docDockBuild('_dock-test-box', () => n++);
      let junk = 'ok';
      try { _docDockBuild('nope', null); _docDockBuild(null); _docDockBuild('_dock-test-box', 'not a function'); } catch (e) { junk = e.message; }
      box.remove();
      document.querySelectorAll('.toast').forEach(e => e.remove());
      return { empty, built: n, junk };
    });
    expect(r).toEqual({ empty: 0, built: 1, junk: 'ok' });
  });

  test('_stateOf: the address, else his state, else Kansas, with the no-default option', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keep = S.state;
      const out = {};
      S.state = 'TX';
      out.addr = _stateOf('12 Main St, Fresno, CA 93701');
      out.own = _stateOf('no state here');
      S.state = '';
      out.ks = _stateOf('');
      out.none = _stateOf('', { fallback: '' });
      out.junk = [null, undefined, 42, {}].map(v => _stateOf(v));
      S.state = keep;
      return out;
    });
    expect(r).toEqual({ addr: 'CA', own: 'TX', ks: 'KS', none: '', junk: ['KS', 'KS', 'KS', 'KS'] });
  });

  test('_geiTaxCertNote: new construction names the form, anything else clears it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const el = document.createElement('div'); el.textContent = 'old';
      const keep = _geiJobScope;
      _geiJobScope = 'repair'; _geiTaxCertNote(el);
      const repair = el.textContent;
      _geiJobScope = 'improvement'; _geiTaxCertNote(el);
      const improve = el.textContent.length > 0;
      let junk = 'ok';
      try { _geiTaxCertNote(null); _geiTaxCertNote(undefined); } catch (e) { junk = e.message; }
      _geiJobScope = keep;
      return { repair, improve, junk };
    });
    expect(r).toEqual({ repair: '', improve: true, junk: 'ok' });
  });

  test('_rrpCerts: only live lead-paint certificates, blank when none', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keep = licenses;
      licenses = [
        { typeId: 'epa_firm', licenseNumber: 'OLD-1', expiryDate: '2000-01-01' },
        { typeId: 'epa_firm', licenseNumber: 'NAT-123' },
        { typeId: 'epa_renovator', licenseNumber: 'R-9', holderName: 'Ray Whitcomb', expiryDate: '2999-01-01' },
      ];
      const live = _rrpCerts();
      licenses = [null, 'x'];
      const junk = _rrpCerts();
      licenses = keep;
      return { live, junk };
    });
    expect(r.live).toEqual({ rrpFirmCertNum: 'NAT-123', rrpRenovatorName: 'Ray Whitcomb', rrpRenovatorCertNum: 'R-9' });
    expect(r.junk).toEqual({ rrpFirmCertNum: '', rrpRenovatorName: '', rrpRenovatorCertNum: '' });
  });

  test('one US date stamp: fmtDateMDY is what the estimate prints', async ({ page }) => {
    const r = await page.evaluate(() => ({
      d: fmtDateMDY(new Date(2026, 0, 5)), k: fmtDateMDY('2026-03-01'),
      valid: _fmtValidUntil('2027-03-01'), junk: [null, '', 'garbage', 12345].map(v => _fmtValidUntil(v)),
    }));
    expect(r).toEqual({ d: '01/05/2026', k: '03/01/2026', valid: '03/01/2027', junk: ['', '', '', ''] });
    expect(src('js/generic-estimate.js')).not.toMatch(/toLocaleDateString\('en-US',\{year:'numeric',month:'2-digit',day:'2-digit'\}\)/);
  });

  test('_cents: half up at the cent, junk is zero', async ({ page }) => {
    const r = await page.evaluate(() => [_cents(1.005), _cents(2.5 * 3.33), _cents(-1.005), _cents('12.345'), _cents('x'), _cents(null), _cents(undefined), _cents(Infinity - Infinity)]);
    expect(r).toEqual([1.01, 8.33, -1.01, 12.35, 0, 0, 0, 0]);
    // Money rounds through _cents; what is left rounds a quantity, not money.
    const left = ['js/quick-invoice.js', 'js/true-measure.js', 'js/materials.js', 'js/supply-list.js']
      .flatMap(f => src(f).split('\n').filter(l => /Math\.round\([^;]*\*100\)\/100/.test(l)).map(l => f + ': ' + l.trim().slice(0, 40)));
    expect(left).toEqual([
      'js/quick-invoice.js: function _qiQty(l){const q=Number(l&&l.q',
      'js/quick-invoice.js: const n=Math.round((Number(m&&m.qty)||1)',
      'js/supply-list.js: return Math.min(SUP_MARKUP_MAX,Math.roun',
    ]);
  });

  test('_median: the middle value, null when there is nothing', async ({ page }) => {
    const r = await page.evaluate(() => ({
      odd: _median([3, 1, 2]), even: _median([4, 1, 3, 2]), mixed: _median(['a', NaN, 5, null]),
      junk: [[], null, undefined, 'x', {}].map(v => _median(v)),
      pb: _pbHrs({ h: [2, 0, 4, -1, 6] }), hist: (() => { const k = S.scopeHistory; S.scopeHistory = { z: [{ hrs: 1 }, { hrs: 3 }] }; const v = _scopeHistoryHrs('z'); S.scopeHistory = k; return v; })(),
    }));
    expect(r).toEqual({ odd: 2, even: 2.5, mixed: 5, junk: [null, null, null, null, null], pb: 4, hist: 2 });
  });

  test('the add/edit sheet: one shell, one form reader', async ({ page }) => {
    await openByo(page, { addr: '412 Bell St, Topeka, KS 66603', pct: 25, price: 500 });
    const r = await page.evaluate(() => {
      _byoAddItem('Work');
      const open = !!document.getElementById('_byo-add-modal');
      document.getElementById('_bya-label').value = 'replace the shutoff';
      document.getElementById('_bya-price').value = '85';
      document.getElementById('_bya-notes').value = 'Quarter turn';
      const form = _byaReadForm();
      document.getElementById('_byo-add-modal').remove();
      const empty = _byaReadForm();
      const ov = _byaSheet('<b id="_bya-shell-test">x</b>');
      const shell = { one: document.querySelectorAll('#_byo-add-modal').length, inner: !!document.getElementById('_bya-shell-test') };
      _byaSheet(null);
      const replaced = document.querySelectorAll('#_byo-add-modal').length;
      ov.remove(); document.getElementById('_byo-add-modal')?.remove();
      return { open, form: { label: form.label.toLowerCase(), rate: form.rate, notes: form.notes }, empty: empty.label, shell, replaced };
    });
    expect(r.open).toBe(true);
    expect(r.form).toEqual({ label: 'replace the shutoff', rate: 85, notes: 'Quarter turn' });
    expect(r.empty).toBe('');
    expect(r.shell).toEqual({ one: 1, inner: true });
    expect(r.replaced).toBe(1);
  });

  test('_estCrewRestore: copies the crew off the bid, nobody when there is none', async ({ page }) => {
    const r = await page.evaluate(() => {
      const b = { estCrew: ['a@x.com'], estCrewRates: { 'a@x.com': 80 } };
      _estCrewRestore(b);
      _estCrew.push('b@x.com');
      const copied = b.estCrew.length === 1 && _estCrewRates['a@x.com'] === 80 && _estCrewRates !== b.estCrewRates;
      const junk = [null, undefined, 'x', { estCrew: 'no', estCrewRates: 5 }].map(v => { _estCrewRestore(v); return _estCrew.length + Object.keys(_estCrewRates).length; });
      return { copied, junk };
    });
    expect(r).toEqual({ copied: true, junk: [0, 0, 0, 0] });
  });

  test('_geiFoldPaint: the facts line and the job line paint the same way', async ({ page }) => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<span id="_fp-text"></span><div id="_fp-card"></div><button id="_fp-chev"></button><span id="_fq-text"></span><div id="_fq-fields"></div><button id="_fq-chev"></button>';
      document.body.appendChild(host);
      _geiFoldPaint('_fp', 'Kansas · Repair', true);
      _geiFoldPaint('_fq', 'Ray · 412 Bell St', false);
      const g = id => document.getElementById(id);
      const out = { a: [g('_fp-text').textContent, g('_fp-card').style.display, g('_fp-chev').textContent], b: [g('_fq-text').textContent, g('_fq-fields').style.display, g('_fq-chev').textContent] };
      let junk = 'ok';
      try { _geiFoldPaint('nope', null, true); _geiFoldPaint(null); _geiFoldPaint('_fp', undefined, false); } catch (e) { junk = e.message; }
      out.blank = g('_fp-text').textContent;
      host.remove();
      return Object.assign(out, { junk });
    });
    expect(r).toEqual({ a: ['Kansas · Repair', '', 'Done'], b: ['Ray · 412 Bell St', 'none', 'Change'], blank: '', junk: 'ok' });
  });

  test('_propLogoSrc reads _propLogoFields', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keep = [S.logoUrl, S.logoHash, S.logoData];
      S.logoData = 'data:image/png;base64,AAA'; S.logoUrl = 'https://x.test/logo.png'; S.logoHash = 'stale';
      const stale = _propLogoSrc();
      S.logoHash = String(_hubHash(S.logoData));
      const cur = _propLogoSrc();
      S.logoData = ''; S.logoUrl = ''; S.logoHash = '';
      const none = _propLogoSrc();
      [S.logoUrl, S.logoHash, S.logoData] = keep;
      return { stale, cur, none };
    });
    expect(r).toEqual({ stale: 'data:image/png;base64,AAA', cur: 'https://x.test/logo.png', none: '' });
  });

  test('_tmMoneyRow: one row for both T&M money views, the sub escaped', async ({ page }) => {
    const r = await page.evaluate(() => {
      const strong = _tmMoneyRow('You keep', '<b>30</b> cents', '$300', true, 'var(--c-green)');
      const plain = _tmMoneyRow('You bill', 'x', '$900', false);
      let junk = 'ok';
      try { _tmMoneyRow(); _tmMoneyRow(null, null, null, null, null); } catch (e) { junk = e.message; }
      return { esc: strong.includes('&lt;b&gt;30'), green: strong.includes('color:var(--c-green)'), plain: plain.includes('color:var(--text);font-variant'), junk };
    });
    expect(r).toEqual({ esc: true, green: true, plain: true, junk: 'ok' });
  });

  test('the customer pages share proposal-sign, the view log and the Stripe mount (js/esign.js)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const out = {};
      // The view log: one POST, never throws.
      const of = window.fetch; const sent = [];
      window.fetch = (u, init) => { sent.push([String(u), init && init.body]); return Promise.resolve(new Response('{}')); };
      try { _logProposalView({ bidId: '7', step: 'approved' }); _logProposalView(); _logProposalView(null); } finally { window.fetch = of; }
      out.log = sent.map(s => [s[0].endsWith('/functions/v1/log-proposal-view'), s[1]]);
      // proposal-sign: the hub adds its link, sign.html sends its own key.
      const oi = _supa.functions.invoke; const calls = [];
      _supa.functions.invoke = async (name, o) => { calls.push([name, o.body]); return { data: { ok: true }, error: null }; };
      try {
        out.signed = await _proposalSign({ action: 'sign', key: 'k' });
        await _proposalSign({ action: 'co' }, { hub: true });
        await _proposalSign(null);
        _supa.functions.invoke = async () => ({ data: { error: 'nope' }, error: null });
        try { await _proposalSign({}); out.err = 'no throw'; } catch (e) { out.err = e.message; }
      } finally { _supa.functions.invoke = oi; }
      out.calls = calls.map(c => [c[0], Object.keys(c[1]).sort().join(',')]);
      // Stripe: a Checkout Session hides our button, a PaymentIntent shows it when ready.
      const os = window.Stripe; const ev = {};
      window.Stripe = (pk, opt) => ({
        acct: opt && opt.stripeAccount,
        initEmbeddedCheckout: async (o) => ({ mount: (sel) => { ev.cs = sel; }, destroy: () => {} }),
        elements: () => ({ create: () => ({ mount: (sel) => { ev.pi = sel; }, on: (n, f) => { ev[n] = f; } }) }),
      });
      const box = document.createElement('div'); box.id = '_stripe-test'; box.innerHTML = 'loading'; document.body.appendChild(box);
      const btn = document.createElement('button'); btn.style.display = 'none'; btn.disabled = true;
      try {
        const a = await _tdMountStripe({ clientSecret: 'cs_test_1', publishableKey: 'pk', connectedAccountId: 'acct_1' }, { container: '_stripe-test', submitBtn: btn });
        out.cs = { sel: ev.cs, elements: a.elements, destroy: typeof a.inst.destroy, btn: btn.style.display, cleared: box.innerHTML };
        let lost = 0;
        const b = await _tdMountStripe({ clientSecret: 'pi_test_1', publishableKey: 'pk' }, { container: '_stripe-test', submitBtn: btn, onLoadError: () => lost++ });
        ev.ready(); ev.loaderror();
        out.pi = { sel: ev.pi, elements: !!b.elements, btn: [btn.style.display, btn.disabled], lost };
      } finally { window.Stripe = os; box.remove(); }
      return out;
    });
    expect(r.log).toEqual([[true, '{"bidId":"7","step":"approved"}'], [true, '{}'], [true, '{}']]);
    expect(r.signed).toEqual({ ok: true });
    expect(r.calls).toEqual([['proposal-sign', 'action,key'], ['proposal-sign', 'action,c,t,u'], ['proposal-sign', '']]);
    expect(r.err).toBe('nope');
    expect(r.cs).toEqual({ sel: '#_stripe-test', elements: null, destroy: 'function', btn: 'none', cleared: '' });
    expect(r.pi).toEqual({ sel: '#_stripe-test', elements: true, btn: ['block', false], lost: 1 });
    // Both pages load the module, and neither keeps its own copy.
    const client = src('client.html'), sign = src('sign.html');
    expect(client).toMatch(/<script src="js\/esign\.js"><\/script>/);
    expect(sign).toMatch(/<script src="js\/esign\.js"><\/script>/);
    expect(client).not.toMatch(/function _hubSignCall|functions\/v1\/log-proposal-view|initEmbeddedCheckout/);
    expect(sign).not.toMatch(/function _signCall|functions\/v1\/log-proposal-view|initEmbeddedCheckout/);
  });

  test('the app and the hub share _cdnPhoto, adaBrand and the change order rows (js/brand-look.js)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      cdn: [_cdnPhoto('https://x.supabase.co/storage/v1/object/public/gallery/u/a.jpg'), _cdnPhoto(''), _cdnPhoto(null), _cdnPhoto('data:image/png;base64,a')],
      ada: [adaBrand('#1B3465'), adaBrand('#FFFFFF') !== '#ffffff', adaBrand(''), adaBrand(null)],
      rows: tdCoLinesHTML([{ desc: '<Stack>', amt: 780 }, { amt: 20 }], 'blue', 'add', escHtml, fmt),
      sub: tdCoLinesHTML([{ desc: 'Tile', amt: 400 }], 'red', 'sub', escHtml, fmt).includes('-$400.00'),
      junk: [null, undefined, 'x', []].map(v => tdCoLinesHTML(v, 'blue', 'add', escHtml, fmt)),
    }));
    // Localhost: the gallery address passes through.
    expect(r.cdn).toEqual(['https://x.supabase.co/storage/v1/object/public/gallery/u/a.jpg', '', null, 'data:image/png;base64,a']);
    expect(r.ada).toEqual(['#1b3465', true, '', '']);
    expect(r.rows).toContain('&lt;Stack&gt;');
    expect(r.rows).toContain('+$800.00');
    expect(r.rows).not.toContain('undefined');
    expect(r.sub).toBe(true);
    expect(r.junk).toEqual(['', '', '', '']);
    const client = src('client.html'), look = src('js/brand-look.js');
    expect(client).toMatch(/<script src="js\/brand-look\.js"><\/script>/);
    expect(client).not.toMatch(/function _cdnPhoto|function _adaBrand|function _hubCOLinesHTML/);
    expect(src('js/proposals.js')).not.toMatch(/function _cdnPhoto|function _coLinesHTML/);
    expect(src('js/utils.js')).not.toMatch(/function adaBrand/);
    expect(look).toMatch(/function adaBrand[\s\S]*function _cdnPhoto[\s\S]*function tdCoLinesHTML/);
  });

  // The copied-code check (owner 2026-10-01). It runs in CI on every PR; these
  // pin the three things it caught on the way in.
  test('the copied-code check exists and runs on every PR', async () => {
    const yml = src('.github/workflows/test.yml');
    expect(yml).toMatch(/node scripts\/ci\/dup-check\.mjs/);
    const chk = src('scripts/ci/dup-check.mjs');
    expect(chk).toMatch(/const WINDOW = 5;/);
    expect(chk).toMatch(/use _cents/);
    expect(chk).toMatch(/25% deposit/);
    expect(chk).toMatch(/use fmt/);
  });
  test('the industrial proposal asks for his deposit, not a flat 25%', async () => {
    const s = src('js/generic-estimate.js');
    expect(s).not.toMatch(/midPrice\*0\.25/);
    expect(s).not.toMatch(/>25% Deposit Due/);
    expect(s).toMatch(/const _indDepPct=_geiDepositDefault\(\);/);
  });
  test('the customer pages share one phone and zip listener', async () => {
    for (const f of ['client.html', 'intake.html']) {
      expect(src(f)).toContain('<script src="js/num-public.js"></script>');
      expect(src(f)).not.toContain("document.addEventListener('input',function(e){");
    }
  });
});
