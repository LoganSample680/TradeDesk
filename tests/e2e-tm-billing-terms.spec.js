// @ts-check
/**
 * How a T&M proposal bills: Materials, Up front, and nothing that pretends
 * to be a price.
 *
 * Owner, 2026-09-23: "how can you get a mobilization deposit on something you
 * don't put a price on, don't think for time and materials an estimate or
 * materials section should be in there ... Should the deposit go off the not
 * to exceed cap?" Then: "Let's get it right."
 *
 * So:
 *  - Up front is None or a flat figure he names. Never a percent.
 *  - With a ceiling, the deposit is measured against it, and a state that
 *    limits a deposit to a share of the price is held to that share of the
 *    ceiling. With no ceiling in such a state, there is nothing to measure,
 *    so a deposit needs the ceiling first. Send and Sign refuse otherwise.
 *  - Materials is one term: at cost, or cost plus a percent, printed on the
 *    contract whether or not the rate is.
 *  - Estimate and material categories are not offered on a new T&M.
 *    Pennsylvania's estimate is on the page because the statute asks for it.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('T&M billing terms: materials, up front, and the law', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Opens a T&M for a home at `addr`, with a job, a rate, and optionally a
  // ceiling and an up-front figure.
  const open = (o) => page.evaluate((o) => {
    document.querySelectorAll('.zmodal-overlay,#_style-pick-ov,#_gei-ip-ov').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id: 93001, name: 'Pat Lowe', addr: o.addr });
    currentClientId = 93001;
    if (typeof S !== 'undefined') { S.tmMatMarkup = 0; S.tmMatMarkupLast = 0; }
    openTMEstimate(getClientById(93001));
    if (o.commercial) { _geiIsCommercial = true; }
    _geiScopeChips = ['Set a tankless']; _renderScopeChips('tm-scope-wrap');
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; };
    set('tm-i-rate', '85');
    if (o.cap) set('tm-i-nte', String(o.cap));
    if (o.dep != null) { _tmDepMode(1); set('tm-i-dep-flat', String(o.dep)); }
    _tmInputChange();
  }, o);

  const state = () => page.evaluate(() => {
    const D = _tmDepositState();
    const L = _tmLegal();
    return {
      amt: D.amt, max: isFinite(D.max) ? Math.floor(D.max) : null, needCap: D.needCap, over: D.over,
      problems: L.problems.map(p => p.k),
      bar: [...document.querySelectorAll('#tm-dock .ios-btn')].map(b => b.textContent.trim()),
      note: document.getElementById('tm-dep-note').textContent,
    };
  });

  // ── UP FRONT ──────────────────────────────────────────────────────────────

  test('a new T&M asks for nothing up front', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => ({
      on: _tmLayers.has('dep'), amt: _tmDeposit(),
      seg: document.querySelector('#tm-dep-seg button.on').textContent,
      rowShown: document.getElementById('tm-dep-amt-row').style.display !== 'none',
    }));
    expect(r).toEqual({ on: false, amt: 0, seg: 'None', rowShown: false });
  });

  test('Amount opens the figure, and it is saved, sent and printed as that figure', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603', dep: 1800 });
    const r = await page.evaluate(() => {
      saveGenericEstimate(true);
      const b = bids.find(x => x.id === _geiEditBidId);
      return { dep: b.deposit, amt: b.tmDepositAmt, pct: b.tmDepositPct,
        seg: document.querySelector('#tm-dep-seg button.on').textContent };
    });
    expect(r).toEqual({ dep: 1800, amt: 1800, pct: 0, seg: 'Amount' });
    expect((await state()).problems).toEqual([]);
  });

  test('None takes it back off, figure and all', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603', dep: 900 });
    const r = await page.evaluate(() => { _tmDepMode(0); return { amt: _tmDeposit(), box: document.getElementById('tm-i-dep-flat').value }; });
    expect(r).toEqual({ amt: 0, box: '' });
  });

  // No limit in Kansas: any figure, ceiling or not.
  test('in a state with no deposit limit, any figure stands', async () => {
    const s = await (open({ addr: '412 Bell St, Topeka, KS 66603', dep: 5000 }).then(state));
    expect(s.problems).toEqual([]);
    expect(s.bar).toEqual(['Sign here', 'Send it']);
  });

  // Massachusetts: a third of the contract price. No ceiling, no price.
  test('where the limit is a share of the price, a deposit needs the ceiling first', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608', dep: 500 });
    const s = await state();
    expect(s.needCap).toBe(true);
    expect(s.problems).toContain('cap');
    expect(s.bar).toEqual(['Add the most it can cost']);
    expect(s.note).toContain('Put in the most it can cost first');
  });

  test('with a ceiling, a deposit over the state share of it is refused, with the figure', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608', cap: 3000, dep: 1500 });
    const s = await state();
    expect(s.over).toBe(true);
    expect(s.max).toBe(999);
    expect(s.problems).toContain('dep');
    expect(s.bar).toEqual(['Lower the deposit']);
  });

  test('within the share, it says what it is against the ceiling', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608', cap: 3000, dep: 900 });
    const s = await state();
    expect(s.problems).toEqual([]);
    expect(s.note).toContain('30% of the most it can cost');
    expect(s.note).toContain('Massachusetts allows up to a third');
  });

  // Deposit limits are home-improvement law.
  test('a business job is not held to the home-improvement limit', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608', dep: 4000, commercial: true });
    expect((await state()).problems).toEqual([]);
  });

  test('Send refuses a deposit the state does not allow, and offers the fix', async () => {
    await open({ addr: '9 Elm St, Worcester, MA 01608', cap: 3000, dep: 1500 });
    const r = await page.evaluate(() => {
      const real = window.zConfirm; let seen = null;
      window.zConfirm = (msg, yes, opts) => { seen = { msg, yes: opts && opts.yes }; };
      try { sendGenericProposal(); } finally { window.zConfirm = real; }
      return seen;
    });
    expect(r && r.yes).toBe('Lower the deposit');
    expect(r && r.msg).toContain('Massachusetts');
  });

  test('the proposal prints the figure as "Up front", never a percent', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603', cap: 6000, dep: 1200 });
    const html = await page.evaluate(() => sendGenericProposal(true, { silent: true }));
    expect(html).toContain('Up Front, Before Work Begins');
    expect(html).toContain('$1,200');
    expect(html).not.toMatch(/Deposit \(\d+%\)/);
  });

  // ── MATERIALS ─────────────────────────────────────────────────────────────

  test('materials default to at cost, and the contract says so', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => ({
      seg: document.querySelector('#tm-mat-seg button.on').textContent,
      terms: _geiBuildTermsHtml(),
    }));
    expect(r.seg).toBe('At cost');
    expect(r.terms).toContain('actual cost, with no markup');
    expect(r.terms).toContain('receipt is attached to each bill');
  });

  test('Plus markup takes a percent, prints it, and is remembered for the next job', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => {
      _tmMatMode(1);
      const i = document.getElementById('tm-i-matpct'); i.value = '18'; _tmMatPctInput(i);
      return { m: _tmMatMarkup, terms: _geiBuildTermsHtml(), remembered: S.tmMatMarkup };
    });
    expect(r.m).toBe(18);
    expect(r.terms).toContain('cost plus 18%');
    expect(r.remembered).toBe(18);
  });

  // The rate can be kept off the proposal; how materials are charged cannot.
  test('the materials term stays on the contract when the rate is kept off it', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const terms = await page.evaluate(() => { _tmSetHideRate(true); const t = _geiBuildTermsHtml(); _tmSetHideRate(false); return t; });
    expect(terms).not.toContain('per hour');
    expect(terms).toContain('Materials are billed');
  });

  // The total cannot say something the contract does not: markup applies to
  // materials only, at the contract's percent.
  test('the markup lands on materials, not on the labor', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => {
      const prev = _geiLines;
      _geiLines = [{ desc: 'Labor', qty: 1, rate: 1000, _tmLabor: true }, { desc: 'Copper', qty: 1, rate: 200 }];
      _tmMatMarkup = 10;
      const t = calcGeiTotal();
      _geiLines = prev; _tmMatMarkup = 0;
      return t.markup;
    });
    expect(r).toBe(20);
  });

  // ── WHAT IS OFFERED ───────────────────────────────────────────────────────

  test('More options no longer offers Estimate, Materials or Deposit on a new T&M', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => {
      _tmMoreOpen = true; _tmApplyLayers();
      const ks = [...document.querySelectorAll('#tm-more-row input.ios-switch')].map(i => i.getAttribute('data-layer'));
      _tmMoreOpen = false; _tmApplyLayers();
      return ks;
    });
    expect(r).not.toContain('est');
    expect(r).not.toContain('mat');
    expect(r).not.toContain('dep');
    expect(r).toContain('excl');
  });

  // A draft built before this keeps its switch, so he can turn it off.
  test('a draft that already has an estimate keeps the switch to turn it off', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603' });
    const r = await page.evaluate(() => {
      _tmLayers = new Set(['rate', 'cap', 'est']); _tmMoreOpen = true; _tmApplyLayers();
      const ks = [...document.querySelectorAll('#tm-more-row input.ios-switch')].map(i => i.getAttribute('data-layer'));
      _tmLayers = new Set(['rate', 'cap']); _tmMoreOpen = false; _tmApplyLayers();
      return ks;
    });
    expect(r).toContain('est');
  });

  test('Pennsylvania: the days are on the page, because the statute asks', async () => {
    await open({ addr: '5 Oak St, Harrisburg, PA 17101' });
    const r = await page.evaluate(() => ({
      locked: [..._tmLockedLayers()].sort(),
      days: document.getElementById('tm-days-f').offsetParent !== null,
    }));
    expect(r.locked).toContain('est');
    expect(r.days).toBe(true);
  });

  // ── COLLECTING IT ─────────────────────────────────────────────────────────
  // A rate sheet's amount is 0 by design, so the payment panel called it paid
  // in full and offered nothing to collect, and once the figure up front was
  // paid it would have called the job overpaid.
  test('a signed rate sheet with money up front shows it due, then paid', async () => {
    const r = await page.evaluate(() => {
      const b = { id: 93501, client_id: 93001, isTM: true, tmRateOnly: true, amount: 0, deposit: 1800, status: 'Closed Won' };
      bids.push(b);
      const before = payStatus(b).label;
      payments.push({ id: 93502, bid_id: 93501, amount: 1800 });
      const after = payStatus(b).label;
      payments.splice(payments.findIndex(p => p.id === 93502), 1);
      bids.splice(bids.findIndex(x => x.id === 93501), 1);
      return { before, after };
    });
    expect(r.before).toContain('Up front due');
    expect(r.before).toContain('1,800');
    expect(r.after).toBe('Up front paid');
  });

  test('the payment panel offers the figure up front on a rate sheet, and no refund', async () => {
    const r = await page.evaluate(() => {
      const b = { id: 93503, client_id: 93001, isTM: true, tmRateOnly: true, amount: 0, deposit: 1800, status: 'Closed Won' };
      bids.push(b);
      openPayPanel(93503, 'deposit');
      const ov = document.querySelector('.pay-modal-overlay');
      const out = { text: ov ? ov.textContent : '', prefill: typeof _mpayPrefill !== 'undefined' ? _mpayPrefill : null };
      document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
      bids.splice(bids.findIndex(x => x.id === 93503), 1);
      return out;
    });
    expect(r.prefill).toBe(1800);
    expect(r.text).toContain('1,800');
    expect(r.text).not.toContain('Refund owed');
  });

  // THE RATE SWITCH. Owner, 2026-09-23: "keep my rate off my proposal, what
  // indicates off or on the final proposal? ... even I don't know what side
  // keeps it on or off." The rate is never printed on the proposal page
  // (owner, 2026-09-17); this switch decides whether it is a term in the
  // contract they sign. It reads as what it does now: blue means it is in the
  // contract, and the line under it says where the customer reads it.
  test('the rate switch says where the customer reads the rate', async () => {
    await open({ addr: '412 Bell St, Topeka, KS 66603', cap: 4500 });
    const r = await page.evaluate(async () => {
      const grab = async () => {
        let doc = ''; const o = window._showProposalPreviewOverlay;
        window._showProposalPreviewOverlay = h => { doc = h; };
        try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = o; }
        return doc;
      };
      const read = async () => ({
        label: document.querySelector('#tm-hide-rate-wrap .ios-lbl').firstChild.textContent,
        sw: document.getElementById('tm-show-rate').checked,
        sub: document.getElementById('tm-show-rate-sub').textContent,
        doc: await grab(), terms: _geiBuildTermsHtml(),
      });
      _tmSetHideRate(false); const on = await read();
      _tmSetHideRate(true); const off = await read();
      _tmSetHideRate(false);
      document.querySelectorAll('#_prop-preview-ov').forEach(e => e.remove());
      return { on, off };
    });
    expect(r.on.label).toBe('Rate in the contract');
    expect(r.on.sw).toBe(true);
    expect(r.on.sub).toContain('They sign to $85 an hour');
    expect(r.on.terms).toContain('$85 per hour');
    expect(r.on.doc, 'never on the proposal page').not.toContain('$85');
    expect(r.off.sw).toBe(false);
    expect(r.off.sub).toBe('Nowhere they see. You still bill the hours at $85.');
    expect(r.off.terms).not.toContain('$85');
    expect(r.off.doc).not.toContain('$85');
  });

  test('no console errors', async () => { assertNoErrors(page, 'T&M billing terms'); });
});
