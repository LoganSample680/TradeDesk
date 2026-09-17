// @ts-check
/**
 * THE RATE SHEET (owner 2026-09-17)
 *
 * "time and materials, need a fast fucking way to get through a bid and not
 * show price if we don't want to."
 *
 * A time-and-materials contract prices the RATE, not the job. The builder used
 * to multiply rate x crew x days into an ESTIMATED TOTAL, print it in the
 * biggest type on the proposal, and refuse the Send button until an estimated-
 * days number existed, so a service call nobody could honestly put a day count
 * on could not be sent at all.
 *
 * These tests hold the two halves that fixes: the send is no longer gated on
 * days, and NO dollar figure reaches the client except the ones he deliberately
 * gave them (the rate, the day rate, an NTE ceiling, a mobilization deposit).
 * The second half is the one worth guarding forever: a regression there puts a
 * number on a contract that was written specifically not to have one.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors,
  FAKE_BID_ID_1, FAKE_USER_ID, FAKE_TOKEN } = require('./helpers');

test.describe('T&M rate sheet: no total, no day count', () => {
  let page;

  const seed = () => page.evaluate(() => {
    clients = clients.filter(c => c.id !== 77701);
    bids = bids.filter(b => b.id !== 66601 && b.id !== 66602);
    clients.push({ id: 77701, name: 'Rate Sheet Client', phone: '316-555-7770',
      addr: '700 Rate Rd, Wichita KS 67202', email: 'rate@ts.test' });
    bids.push(
      // A saved rate sheet: no total, flat mobilization deposit.
      { id: 66601, client_id: 77701, client_name: 'Rate Sheet Client', amount: 0, deposit: 500,
        status: 'Pending', bid_date: '2026-03-02', trade_type: 'plumbing', type: 'Service work',
        geiLines: [], isTM: true, tmRateOnly: true, tmCrewCount: 2, tmRatePerMan: 95,
        tmEstHours: 0, tmBillingCycle: 'weekly', tmDepositPct: 0, tmDepositAmt: 500,
        tmNteCap: 3000, tmNteEnabled: true, tmCapAction: 'Stop & get re-approval' },
      // An ordinary totalled T&M, so nothing below can pass by accident.
      { id: 66602, client_id: 77701, client_name: 'Rate Sheet Client', amount: 4000, deposit: 1000,
        status: 'Pending', bid_date: '2026-03-03', trade_type: 'plumbing', type: 'Repipe',
        geiLines: [], isTM: true, tmCrewCount: 2, tmRatePerMan: 85, tmEstHours: 24,
        tmBillingCycle: 'weekly', tmNteCap: 0 }
    );
  });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await seed();
  });
  test.beforeEach(async () => { await seed(); });
  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 77701);
      bids = bids.filter(b => b.id !== 66601 && b.id !== 66602);
    });
    await page.context().close();
  });

  // ── The switch itself ──────────────────────────────────────────────────────

  test('the switch exists and both halves of the rail are in the DOM', async () => {
    const r = await page.evaluate(() => ({
      sw: !!document.getElementById('tm-i-rateonly'),
      totalHead: !!document.getElementById('tm-rail-total-wrap'),
      rateHead: !!document.getElementById('tm-rail-rate-wrap'),
      daysField: !!document.getElementById('tm-days-f'),
      flatDep: !!document.getElementById('tm-i-dep-flat'),
      fn: typeof _tmSetRateOnly === 'function' && typeof _tmApplyRateOnly === 'function',
    }));
    expect(r).toEqual({ sw: true, totalHead: true, rateHead: true, daysField: true, flatDep: true, fn: true });
  });

  test('on: the total head, the days field and the hour tiles are hidden', async () => {
    const r = await page.evaluate(() => {
      const prev = _tmRateOnly;
      _tmRateOnly = true; _tmApplyRateOnly();
      const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
      const out = {
        total: vis('tm-rail-total-wrap'), rate: vis('tm-rail-rate-wrap'),
        days: vis('tm-days-f'), labor: vis('tm-stat-labor-tile'), hours: vis('tm-stat-days-tile'),
        depPct: vis('tm-deposit-wrap'), depFlat: vis('tm-deposit-flat-wrap'),
        checked: document.getElementById('tm-i-rateonly').checked,
      };
      _tmRateOnly = prev; _tmApplyRateOnly();
      return out;
    });
    expect(r).toEqual({ total: false, rate: true, days: false, labor: false, hours: false,
      depPct: false, depFlat: true, checked: true });
  });

  test('off: the total head comes back and the rate head goes away', async () => {
    const r = await page.evaluate(() => {
      _tmRateOnly = true; _tmApplyRateOnly();
      _tmRateOnly = false; _tmApplyRateOnly();
      const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
      return { total: vis('tm-rail-total-wrap'), rate: vis('tm-rail-rate-wrap'),
        days: vis('tm-days-f'), checked: document.getElementById('tm-i-rateonly').checked };
    });
    expect(r).toEqual({ total: true, rate: false, days: true, checked: false });
  });

  test('flipping it is remembered on the account, so he never flips it twice', async () => {
    const r = await page.evaluate(() => {
      const before = S.tmRateOnly;
      _tmSetRateOnly(true);
      const on = !!S.tmRateOnly;
      _tmSetRateOnly(false);
      const off = !!S.tmRateOnly;
      S.tmRateOnly = before; _tmRateOnly = !!before; _tmApplyRateOnly();
      return { on, off };
    });
    expect(r).toEqual({ on: true, off: false });
  });

  // ── The send gate: days no longer blocks ───────────────────────────────────

  test('a rate sheet sends with a rate and no estimated days', async () => {
    const r = await page.evaluate(async () => {
      const prevAlert = window.zAlert; const seen = [];
      window.zAlert = (msg, o) => { seen.push((o && o.title) || String(msg)); };
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevRate = _tmRatePerMan, prevHrs = _tmEstHours;
      const prevScope = window._geiScopeNoScope;
      _geiIsTM = true; _tmRateOnly = true; _tmRatePerMan = 95; _tmEstHours = 0;
      window._geiScopeNoScope = true;
      // Offline is the next gate after the type checks, so reaching it proves
      // the rate/days pair was accepted. That is the assertion, not the send.
      const prevOnline = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      try { await sendGenericProposal(false); } catch (e) { seen.push('threw:' + e.message); }
      Object.defineProperty(navigator, 'onLine', { get: () => prevOnline, configurable: true });
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _tmRatePerMan = prevRate; _tmEstHours = prevHrs;
      window._geiScopeNoScope = prevScope; window.zAlert = prevAlert;
      return seen;
    });
    expect(r.join('|')).not.toContain('Estimated days required');
    expect(r.join('|')).not.toContain('Rate required');
  });

  test('a rate sheet with no rate is still refused, because the rate IS the bid', async () => {
    const r = await page.evaluate(async () => {
      const prevAlert = window.zAlert; const seen = [];
      window.zAlert = (msg, o) => { seen.push((o && o.title) || String(msg)); };
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevRate = _tmRatePerMan;
      const prevScope = window._geiScopeNoScope;
      _geiIsTM = true; _tmRateOnly = true; _tmRatePerMan = 0;
      window._geiScopeNoScope = true;
      try { await sendGenericProposal(false); } catch (e) { seen.push('threw:' + e.message); }
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _tmRatePerMan = prevRate;
      window._geiScopeNoScope = prevScope; window.zAlert = prevAlert;
      return seen;
    });
    expect(r).toContain('Rate required');
  });

  test('a TOTALLED T&M still demands its estimated days', async () => {
    const r = await page.evaluate(async () => {
      const prevAlert = window.zAlert; const seen = [];
      window.zAlert = (msg, o) => { seen.push((o && o.title) || String(msg)); };
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevRate = _tmRatePerMan, prevHrs = _tmEstHours;
      const prevScope = window._geiScopeNoScope;
      _geiIsTM = true; _tmRateOnly = false; _tmRatePerMan = 95; _tmEstHours = 0;
      window._geiScopeNoScope = true;
      try { await sendGenericProposal(false); } catch (e) { seen.push('threw:' + e.message); }
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _tmRatePerMan = prevRate; _tmEstHours = prevHrs;
      window._geiScopeNoScope = prevScope; window.zAlert = prevAlert;
      return seen;
    });
    expect(r).toContain('Estimated days required');
  });

  // ── What the lists say where a price would go ──────────────────────────────

  test('a bid row shows the rate, never $0', async () => {
    const r = await page.evaluate(() => {
      const rs = bids.find(b => b.id === 66601);
      const tm = bids.find(b => b.id === 66602);
      return { rs: bidAmountLabel(rs, fmt), tm: bidAmountLabel(tm, fmt), none: bidAmountLabel(null, fmt) };
    });
    expect(r.rs).toContain('/hr');
    expect(r.rs).toContain('NTE');
    expect(r.rs).not.toMatch(/^\$0\b/);
    expect(r.tm).toBe('$4,000.00');
    expect(r.none).toBe('$0.00');
  });

  test('a rate sheet with no rate and no cap still reads as something', async () => {
    const r = await page.evaluate(() => bidAmountLabel(
      { isTM: true, tmRateOnly: true, tmRatePerMan: 0, tmNteCap: 0, amount: 0 }, fmt));
    expect(r).toBe('T&M rate');
  });

  test('bidAmountLabel survives junk', async () => {
    const r = await page.evaluate(() => [
      bidAmountLabel(undefined, fmt),
      bidAmountLabel({}, fmt),
      bidAmountLabel({ isTM: true, tmRateOnly: true, tmRatePerMan: 'abc', tmNteCap: null }, fmt),
      bidAmountLabel({ isTM: true, tmRateOnly: true, tmRatePerMan: -5, tmNteCap: 900 }, fmt),
    ]);
    expect(r[0]).toBe('$0.00');
    expect(r[1]).toBe('$0.00');
    expect(r[2]).toBe('T&M rate');
    expect(r[3]).toContain('NTE');
  });

  // ── The deposit: a flat figure, never a percent of a phantom total ─────────

  test('saving a rate sheet stores the flat deposit and a zero percent', async () => {
    const r = await page.evaluate(() => {
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevId = _geiEditBidId;
      const prevRate = _tmRatePerMan, prevCrew = _tmCrewCount;
      _geiIsTM = true; _tmRateOnly = true; _geiEditBidId = 66601;
      _tmRatePerMan = 95; _tmCrewCount = 2;
      const flat = document.getElementById('tm-i-dep-flat');
      const prevFlat = flat.value; flat.value = '750';
      saveGenericEstimate(true);
      const b = bids.find(x => x.id === 66601);
      const out = { pct: b.tmDepositPct, amt: b.tmDepositAmt, dep: b.deposit, rateOnly: b.tmRateOnly };
      flat.value = prevFlat;
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _geiEditBidId = prevId;
      _tmRatePerMan = prevRate; _tmCrewCount = prevCrew;
      return out;
    });
    expect(r.pct).toBe(0);
    expect(r.amt).toBe(750);
    expect(r.dep).toBe(750);
    expect(r.rateOnly).toBe(true);
  });

  test('a totalled T&M still takes its percent', async () => {
    const r = await page.evaluate(() => {
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevId = _geiEditBidId;
      _geiIsTM = true; _tmRateOnly = false; _geiEditBidId = 66602;
      saveGenericEstimate(true);
      const b = bids.find(x => x.id === 66602);
      const out = { pct: b.tmDepositPct, rateOnly: b.tmRateOnly };
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _geiEditBidId = prevId;
      return out;
    });
    expect(r.pct).toBeGreaterThan(0);
    expect(r.rateOnly).toBe(false);
  });

  // ── The terms state the rate, and the cadence stops lying ──────────────────

  test('the terms name the hourly rate on a rate sheet', async () => {
    const r = await page.evaluate(() => {
      const prevTM = _geiIsTM, prevRO = _tmRateOnly, prevRate = _tmRatePerMan, prevCrew = _tmCrewCount;
      _geiIsTM = true; _tmRateOnly = true; _tmRatePerMan = 95; _tmCrewCount = 2;
      const on = _geiBuildTermsHtml();
      _tmRateOnly = false;
      const off = _geiBuildTermsHtml();
      _geiIsTM = prevTM; _tmRateOnly = prevRO; _tmRatePerMan = prevRate; _tmCrewCount = prevCrew;
      return { on, off };
    });
    expect(r.on).toContain('$95 per hour');
    expect(r.on).toContain('No total contract price is stated or implied');
    expect(r.off).not.toContain('No total contract price is stated or implied');
  });

  test('every billing cadence says what it means, not "Bi-weekly" for all three', async () => {
    const r = await page.evaluate(() => {
      const prevTM = _geiIsTM, prevCyc = _tmBillingCycle;
      _geiIsTM = true;
      const out = {};
      ['weekly', 'biweekly', 'milestone', 'completion'].forEach(c => {
        _tmBillingCycle = c;
        const h = _geiBuildTermsHtml();
        const m = h.match(/<strong>Billing:<\/strong>\s*([^<]+)/);
        out[c] = m ? m[1].trim() : null;
      });
      _geiIsTM = prevTM; _tmBillingCycle = prevCyc;
      return out;
    });
    expect(r.weekly).toContain('Weekly invoices');
    expect(r.biweekly).toContain('every two weeks');
    expect(r.milestone).toContain('milestone');
    expect(r.completion).toContain('on completion');
    // The bug this replaces: three different cadences, one sentence.
    expect(new Set(Object.values(r)).size).toBe(4);
  });

  // ── THE DOCUMENT THE CLIENT READS ─────────────────────────────────────────
  // This is the block worth guarding forever. A regression anywhere above is an
  // annoyance; a regression here puts a dollar total on a contract that was
  // written specifically not to have one.

  const buildProposal = (opts) => page.evaluate((o) => {
    const prev = {
      tm: _geiIsTM, ro: _tmRateOnly, rate: _tmRatePerMan, crew: _tmCrewCount,
      hrs: _tmEstHours, cyc: _tmBillingCycle, id: _geiEditBidId, lines: _geiLines,
    };
    const nte = document.getElementById('tm-i-nte');
    const flat = document.getElementById('tm-i-dep-flat');
    const legacyNte = document.getElementById('tm-nte-cap');
    const prevNte = nte.value, prevFlat = flat.value, prevLegacy = legacyNte ? legacyNte.value : '';
    _geiIsTM = true; _tmRateOnly = !!o.rateOnly; _geiEditBidId = o.bidId;
    _tmRatePerMan = o.rate; _tmCrewCount = o.crew; _tmEstHours = o.hours || 0;
    _tmBillingCycle = o.cycle || 'weekly';
    _geiLines = (o.mats || []).map(m => ({ desc: m, qty: 1, unit: 'lot', rate: 400, total: 400 }));
    nte.value = o.nte ? String(o.nte) : '';
    if (legacyNte) legacyNte.value = o.nte ? String(o.nte) : '';
    flat.value = o.dep ? String(o.dep) : '';
    let html = '';
    try { html = sendGenericProposal(true, { silent: true }); } catch (e) { html = 'THREW:' + e.message; }
    nte.value = prevNte; flat.value = prevFlat;
    if (legacyNte) legacyNte.value = prevLegacy;
    _geiIsTM = prev.tm; _tmRateOnly = prev.ro; _tmRatePerMan = prev.rate;
    _tmCrewCount = prev.crew; _tmEstHours = prev.hrs; _tmBillingCycle = prev.cyc;
    _geiEditBidId = prev.id; _geiLines = prev.lines;
    return html;
  }, opts);

  test('the rate sheet proposal says HOURLY RATE, never ESTIMATED TOTAL', async () => {
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 2, dep: 0, nte: 0 });
    expect(html).toContain('HOURLY RATE');
    // The /hr sits in its own span so it can be sized down beside the number.
    expect(html).toMatch(/\$95<span[^>]*>\/hr<\/span>/);
    expect(html).not.toContain('ESTIMATED TOTAL');
    expect(html).not.toContain('Mobilization Deposit');
  });

  test('a totalled T&M proposal still says ESTIMATED TOTAL', async () => {
    const html = await buildProposal({ rateOnly: false, bidId: 66602, rate: 85, crew: 2, hours: 24 });
    expect(html).toContain('ESTIMATED TOTAL');
    expect(html).not.toContain('HOURLY RATE');
  });

  test('a rate sheet prints the crew, the day rate and the cadence', async () => {
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 3, cycle: 'milestone' });
    expect(html).toContain('3 workers');
    expect(html).toContain('$2,280');           // 3 x 95 x 8
    expect(html).toContain('Billed by milestone');
    expect(html).toContain('Billed at actual cost');
  });

  test('NO dollar figure reaches the client except the ones he chose to give', async () => {
    // Material categories carry real costs and must still print without prices.
    const html = await buildProposal({
      rateOnly: true, bidId: 66601, rate: 95, crew: 2, nte: 3000, dep: 500,
      mats: ['Copper and fittings', 'Water heater'],
    });
    expect(html).toContain('Copper and fittings');
    const money = [...html.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map(m => m[0]);
    const allowed = new Set(['$95', '$1,520', '$3,000', '$500']);  // rate, day rate, NTE, deposit
    const strays = money.filter(m => !allowed.has(m));
    expect(strays).toEqual([]);
  });

  test('no NTE and no deposit means the rate and the day rate are the only numbers', async () => {
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 1, nte: 0, dep: 0 });
    const money = [...html.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map(m => m[0]);
    expect([...new Set(money)].sort()).toEqual(['$760', '$95']);
  });

  test('flipping the switch ON strips the labor line and its hour count', async () => {
    // The bug: the days INPUT keeps its value when the field is hidden, so the
    // labor line survived into _geiLines and the client's document read
    // "Labor: 2 workers @ $95/hr x24" under a header promising no total.
    const r = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, ro: _tmRateOnly, lines: _geiLines, rate: _tmRatePerMan,
        crew: _tmCrewCount, hrs: _tmEstHours };
      const days = document.getElementById('tm-i-days');
      const prevDays = days.value;
      _geiIsTM = true; _geiLines = [];
      _tmSetRateOnly(false);
      document.getElementById('tm-i-rate').value = '95';
      _tmCrewCount = 2; document.getElementById('tm-i-crew-count').textContent = '2';
      days.value = '3'; _tmInputChange();
      const withTotal = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length };
      _tmSetRateOnly(true);
      const asSheet = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length,
        daysKept: days.value };
      _tmSetRateOnly(false);
      const backAgain = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length };
      days.value = prevDays;
      _geiIsTM = prev.tm; _tmRateOnly = prev.ro; _geiLines = prev.lines;
      _tmRatePerMan = prev.rate; _tmCrewCount = prev.crew; _tmEstHours = prev.hrs;
      _tmApplyRateOnly();
      return { withTotal, asSheet, backAgain };
    });
    expect(r.withTotal).toEqual({ hrs: 24, labor: 1 });
    // No hours, no labor line, and the number he typed is still in the field.
    expect(r.asSheet).toEqual({ hrs: 0, labor: 0, daysKept: '3' });
    // Turning it back off restores the total without retyping anything.
    expect(r.backAgain).toEqual({ hrs: 24, labor: 1 });
  });

  test('the hour count never reaches the client document', async () => {
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 2, hours: 24 });
    expect(html).not.toContain('x24');
    expect(html).not.toContain('\u00d724');
    expect(html).not.toContain('Labor: 2 workers');
  });

  test('an empty document has no Description heading over nothing', async () => {
    const bare = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 1 });
    expect(bare).not.toContain('>Description<');
    const withMats = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 1,
      mats: ['Copper and fittings'] });
    expect(withMats).toContain('>Description<');
  });

  // ── Concurrency and junk, per §11.1 ───────────────────────────────────────

  test('the switch survives being hammered', async () => {
    const r = await page.evaluate(() => {
      const prev = !!S.tmRateOnly;
      for (let i = 0; i < 20; i++) _tmSetRateOnly(i % 2 === 0);
      const settled = { state: _tmRateOnly, checked: document.getElementById('tm-i-rateonly').checked };
      S.tmRateOnly = prev; _tmSetRateOnly(prev);
      return settled;
    });
    expect(r.state).toBe(false);
    expect(r.checked).toBe(false);
  });

  test('_tmApplyRateOnly does not throw when the page is not in the DOM', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('tm-i-rateonly');
      const parent = el.parentElement;
      const next = el.nextSibling;
      el.remove();
      let ok = true;
      try { _tmApplyRateOnly(); } catch (e) { ok = false; }
      parent.insertBefore(el, next);
      _tmApplyRateOnly();
      return ok;
    });
    expect(r).toBe(true);
  });

  test('_tmSetRateOnly coerces junk to a boolean', async () => {
    const r = await page.evaluate(() => {
      const prev = !!S.tmRateOnly;
      const out = [];
      [undefined, null, 0, '', 'yes', {}].forEach(v => { _tmSetRateOnly(v); out.push(_tmRateOnly); });
      S.tmRateOnly = prev; _tmSetRateOnly(prev);
      return out;
    });
    expect(r).toEqual([false, false, false, false, true, true]);
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'tm rate sheet');
  });
});


// ── WHAT THE CLIENT'S OWN SCREEN SAYS ────────────────────────────────────────
// sign.html is amount-driven throughout: a sticky total, a deposit tile with a
// percent badge, a "balance on completion" line. A rate sheet's amount is 0 by
// design, so every one of those printed $0 or a percent of nothing until it was
// taught to read _prop.rateOnly. These load the REAL signing page.

const RATE_PROP = {
  id: FAKE_BID_ID_1, status: 'pending',
  businessName: 'JS Solutions', businessPhone: '316-555-0100',
  clientName: 'Laurie Bennett', clientAddr: '4213 N Tyler Rd, Wichita KS 67205',
  amount: 0, deposit: 500,
  rateOnly: true, hourlyRate: 95, crewCount: 2, nteCap: 3000, billingCycle: 'weekly',
  createdAt: new Date().toISOString(),
  signingToken: FAKE_TOKEN, contractorUserId: FAKE_USER_ID, clientId: 901,
  proposalHtml: '<p>Diagnose leak. Replace shutoff valves.</p>',
  trade: 'plumbing', stripeConnectEnabled: false,
};

test.describe('sign.html: a rate sheet shows a rate, never $0', () => {
  let page;
  const load = async (browser, prop) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const p = await ctx.newPage();
    await mockAllExternal(p, { proposalData: prop });
    await p.goto('/sign.html?t=' + FAKE_TOKEN + '&u=' + FAKE_USER_ID + '&b=' + FAKE_BID_ID_1,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(3000);
    return p;
  };

  test.beforeAll(async ({ browser }) => { page = await load(browser, RATE_PROP); });
  test.afterAll(async () => { await page.context().close(); });

  test('the sticky bar carries the rate, not a zero total', async () => {
    const r = await page.evaluate(() => ({
      sticky: (document.getElementById('sticky-total') || {}).textContent || '',
      total: (document.getElementById('amt-total') || {}).textContent || '',
      dep: (document.getElementById('amt-dep') || {}).textContent || '',
      bal: (document.getElementById('amt-bal') || {}).textContent || '',
    }));
    expect(r.sticky).toContain('/hr');
    expect(r.sticky).toContain('95');
    expect(r.total).toContain('/hr');
    expect(r.dep).toContain('500');
    expect(r.bal).toContain('weekly');
    expect(r.bal).toContain('3,000');          // the ceiling he chose to give
    expect(r.bal).not.toContain('Balance on completion');
  });

  test('the deposit tile calls it a mobilization deposit, not "25% Deposit"', async () => {
    const r = await page.evaluate(() => {
      _renderPayTiles();
      return {
        badge: (document.getElementById('pay-tile-dep-badge') || {}).textContent || '',
        amt: (document.getElementById('pay-tile-dep-amt') || {}).textContent || '',
        note: (document.getElementById('pay-tile-dep-note') || {}).textContent || '',
        fullHidden: (document.getElementById('pay-tile-full') || {}).style.display === 'none',
      };
    });
    expect(r.badge).toBe('Mobilization deposit');
    expect(r.amt).toContain('500');
    expect(r.note).toContain('weekly');
    expect(r.fullHidden).toBe(true);
    expect(r.badge).not.toContain('%');
  });

  test('the price-hold chip says RATE, because that is what is held', async () => {
    const t = await page.evaluate(() =>
      (document.getElementById('price-held-chip') || {}).textContent || '');
    expect(t.toLowerCase()).toContain('rate is held');
  });

  test('no console errors on the client rate sheet', async () => {
    assertNoErrors(page, 'sign.html rate sheet');
  });
});

test.describe('sign.html: a rate sheet with no deposit asks for nothing today', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page, { proposalData: Object.assign({}, RATE_PROP,
      { deposit: 0, nteCap: 0, stripeConnectEnabled: true }) });
    await page.goto('/sign.html?t=' + FAKE_TOKEN + '&u=' + FAKE_USER_ID + '&b=' + FAKE_BID_ID_1,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('no card checkout for $0, and the manual row still signs', async () => {
    const r = await page.evaluate(() => {
      _renderPayTiles(); _renderSignPayBtns();
      const c = document.getElementById('sign-pay-btns');
      return {
        payNow: !!document.getElementById('_pay-now-btn'),
        later: (c ? c.innerHTML : '').includes('Pay Later'),
        label: (document.querySelector('.sig-pay-opts-label') || {}).textContent || '',
        badge: (document.getElementById('pay-tile-dep-badge') || {}).textContent || '',
      };
    });
    expect(r.payNow).toBe(false);          // a checkout for nothing is a dead button
    expect(r.later).toBe(true);            // never a dead end
    expect(r.label).toBe('Nothing is due today');
    expect(r.badge).toBe('Due today');
  });

  test('the sticky line explains the billing instead of a deposit', async () => {
    const t = await page.evaluate(() =>
      (document.getElementById('sticky-deposit-line') || {}).textContent || '');
    expect(t).toContain('Nothing due today');
    expect(t).toContain('weekly');
  });

  test('no console errors on a zero-deposit rate sheet', async () => {
    assertNoErrors(page, 'sign.html rate sheet, no deposit');
  });
});

// A TOTALLED proposal must be untouched by any of the above.
test.describe('sign.html: an ordinary proposal is unchanged', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page, { proposalData: Object.assign({}, RATE_PROP,
      { rateOnly: false, amount: 10000, deposit: 2500, hourlyRate: 0 }) });
    await page.goto('/sign.html?t=' + FAKE_TOKEN + '&u=' + FAKE_USER_ID + '&b=' + FAKE_BID_ID_1,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('still a total, a percent badge and a balance line', async () => {
    const r = await page.evaluate(() => {
      _renderPayTiles();
      return {
        sticky: (document.getElementById('sticky-total') || {}).textContent || '',
        bal: (document.getElementById('amt-bal') || {}).textContent || '',
        badge: (document.getElementById('pay-tile-dep-badge') || {}).textContent || '',
        chip: (document.getElementById('price-held-chip') || {}).textContent || '',
      };
    });
    expect(r.sticky).toContain('10,000');
    expect(r.sticky).not.toContain('/hr');
    expect(r.bal).toContain('Balance on completion');
    expect(r.badge).toBe('25% Deposit');
    expect(r.chip.toLowerCase()).toContain('price is held');
  });

  // THE ONE THIS SPEC MISSED. Adding the rate-sheet branch to the sticky
  // deposit line stranded the ordinary branch's style.display='block' inside
  // the new else, so a normal proposal wrote the text and left the element
  // hidden. Everything this describe already asserted still passed, because
  // none of it looked at whether the line was VISIBLE. CI shard 6 found it.
  test('the sticky deposit line is actually visible, not just filled in', async () => {
    const line = page.locator('#sticky-deposit-line');
    await expect(line).toBeVisible();
    const t = await line.textContent();
    expect(t).toContain('2,500');
    expect(t).toContain('locks in your spot');
  });

  test('no console errors on an ordinary proposal', async () => {
    assertNoErrors(page, 'sign.html totalled proposal');
  });
});
