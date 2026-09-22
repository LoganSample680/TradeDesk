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

  test('the chip row and both halves of the rail are in the DOM', async () => {
    const r = await page.evaluate(() => ({
      row: !!document.getElementById('tm-add-row'),
      totalHead: !!document.getElementById('tm-rail-total-wrap'),
      rateHead: !!document.getElementById('tm-rail-rate-wrap'),
      daysField: !!document.getElementById('tm-days-f'),
      flatDep: !!document.getElementById('tm-i-dep-flat'),
      fn: typeof _tmAddLayer === 'function' && typeof _tmApplyLayers === 'function'
        && typeof _tmToggleLayer === 'function',
      // The switch this replaced is DELETED, not hidden (§7).
      gone: !document.getElementById('tm-i-rateonly') && typeof window._tmSetRateOnly === 'undefined',
    }));
    expect(r).toEqual({ row: true, totalHead: true, rateHead: true, daysField: true,
      flatDep: true, fn: true, gone: true });
  });

  test('Rate without Estimate is a rate sheet: no days, no total', async () => {
    const r = await page.evaluate(() => {
      const prev = [..._tmLayers];
      _tmLayers = new Set(['rate']); _tmApplyLayers();
      const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
      const out = {
        total: vis('tm-rail-total-wrap'), rate: vis('tm-rail-rate-wrap'),
        days: vis('tm-days-f'), labor: vis('tm-stat-labor-tile'), hours: vis('tm-stat-days-tile'),
        rateBlk: vis('tm-blk-rate'), derived: _tmRateOnly,
      };
      _tmLayers = new Set(prev); _tmApplyLayers();
      return out;
    });
    expect(r).toEqual({ total: false, rate: true, days: false, labor: false, hours: false,
      rateBlk: true, derived: true });
  });

  test('adding Estimate brings the day count and the total back', async () => {
    const r = await page.evaluate(() => {
      const prev = [..._tmLayers];
      _tmLayers = new Set(['rate']); _tmApplyLayers();
      _tmAddLayer('est');
      const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
      const out = { total: vis('tm-rail-total-wrap'), rate: vis('tm-rail-rate-wrap'),
        days: vis('tm-days-f'), derived: _tmRateOnly };
      _tmLayers = new Set(prev); _tmApplyLayers();
      return out;
    });
    expect(r).toEqual({ total: true, rate: false, days: true, derived: false });
  });

  test('Estimate pulls Rate in with it, and dropping Rate takes Estimate too', async () => {
    const r = await page.evaluate(() => {
      const prev = [..._tmLayers];
      _tmLayers = new Set(); _tmApplyLayers();
      _tmAddLayer('est');
      const after = [..._tmLayers].sort();
      _tmDropLayer('rate');
      const gone = [..._tmLayers].sort();
      _tmLayers = new Set(prev); _tmApplyLayers();
      return { after, gone };
    });
    expect(r.after).toEqual(['est', 'rate']);
    expect(r.gone).toEqual([]);
  });

  test('a fresh T&M proposal starts with no layers at all', async () => {
    // Deliberate: the fast path is the empty one. His last proposal's shape is
    // NOT carried over, because carrying it over is how the page grew to 35
    // controls in the first place.
    const r = await page.evaluate(() => {
      openGenericEstimate(getClientById(77701), null, 'plumbing', { mode: 'tm', forceNew: true });
      return new Promise(res => setTimeout(() => {
        _geiIsTM = true; _tmShowPage();
        res({ layers: [..._tmLayers], rateOnly: _tmRateOnly });
      }, 400));
    });
    expect(r.layers).toEqual([]);
    expect(r.rateOnly).toBe(false);
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
      _geiIsTM = true; _geiEditBidId = 66601;
      _tmLayers = new Set(['rate']); _tmApplyLayers();
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
      _geiIsTM = true; _geiEditBidId = 66602;
      _tmLayers = new Set(['rate', 'est']); _tmApplyLayers();
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
    // A T&M that DOES carry an estimate still names the rate, it just does not
    // claim there is no total. Pennsylvania's HICPA defines a T&M contract as
    // payment "based on the actual cost of labor at a specified hourly rate",
    // so the rate is a required term whether or not an estimate is shown.
    expect(r.off).toContain('$95 per hour');
    expect(r.off).toContain('not a fixed price');
    expect(r.off).not.toContain('No total contract price is stated or implied');
  });

  test('a T&M proposal with no rate entered has no rate clause to state', async () => {
    const r = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, rate: _tmRatePerMan };
      _geiIsTM = true; _tmRatePerMan = 0;
      const h = _geiBuildTermsHtml();
      _geiIsTM = prev.tm; _tmRatePerMan = prev.rate;
      return h;
    });
    expect(r).not.toContain('per hour, per worker');
  });

  test('a fixed-price proposal never gets a rate clause', async () => {
    const r = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, rate: _tmRatePerMan };
      _geiIsTM = false; _tmRatePerMan = 95;
      const h = _geiBuildTermsHtml();
      _geiIsTM = prev.tm; _tmRatePerMan = prev.rate;
      return h;
    });
    expect(r).not.toContain('per hour, per worker');
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
      layers: [..._tmLayers],
    };
    const nte = document.getElementById('tm-i-nte');
    const flat = document.getElementById('tm-i-dep-flat');
    const legacyNte = document.getElementById('tm-nte-cap');
    const prevNte = nte.value, prevFlat = flat.value, prevLegacy = legacyNte ? legacyNte.value : '';
    _geiIsTM = true; _geiEditBidId = o.bidId;
    _tmLayers = new Set(o.rateOnly ? ['rate'] : ['rate', 'est']);
    _tmApplyLayers();
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
    _tmLayers = new Set(prev.layers); _tmApplyLayers();
    return html;
  }, opts);

  test('the T&M proposal never shows the rate, and never shows a total', async () => {
    // Owner 2026-09-17: "hourly rate never gets exposed to the proposal itself."
    // The rate is collected so the app can total the job off the clock. It is a
    // backend number and this asserts it stays one.
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 2, dep: 0, nte: 0 });
    expect(html).toContain('TIME &amp; MATERIALS');
    expect(html).not.toContain('HOURLY RATE');
    expect(html).not.toContain('ESTIMATED TOTAL');
    expect(html).not.toContain('/hr');
    expect(html).not.toContain('95');
    expect(html).not.toContain('Mobilization Deposit');
  });

  test('a totalled T&M proposal still says ESTIMATED TOTAL', async () => {
    const html = await buildProposal({ rateOnly: false, bidId: 66602, rate: 85, crew: 2, hours: 24 });
    expect(html).toContain('ESTIMATED TOTAL');
    expect(html).not.toContain('HOURLY RATE');
  });

  test('a T&M proposal prints the billing cadence and nothing about the crew', async () => {
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 3, cycle: 'milestone' });
    expect(html).toContain('Billed at each agreed milestone');
    // Crew size and day rate are both routes back to the rate. Neither ships.
    expect(html).not.toContain('3 workers');
    expect(html).not.toContain('$2,280');
    expect(html).not.toContain('Day rate');
  });

  test('NO dollar figure reaches the client except the ones he chose to give', async () => {
    // Material categories carry real costs and must still print without prices.
    const html = await buildProposal({
      rateOnly: true, bidId: 66601, rate: 95, crew: 2, nte: 3000, dep: 500,
      mats: ['Copper and fittings', 'Water heater'],
    });
    expect(html).toContain('Copper and fittings');
    const money = [...html.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map(m => m[0]);
    // ONLY the two he deliberately handed the customer: the ceiling and the
    // deposit. No rate, no day rate, no material costs, no total.
    const allowed = new Set(['$3,000', '$500']);
    const strays = money.filter(m => !allowed.has(m));
    expect(strays).toEqual([]);
  });

  test('no cap and no deposit means the document carries no money at all', async () => {
    // This is the Kansas case in one assertion: a scope, the billing terms, and
    // a signature. Not one dollar figure anywhere on it.
    const html = await buildProposal({ rateOnly: true, bidId: 66601, rate: 95, crew: 1, nte: 0, dep: 0 });
    const money = [...html.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map(m => m[0]);
    expect(money).toEqual([]);
  });

  test('dropping Estimate strips the labor line and its hour count', async () => {
    // The bug this guards: the days INPUT keeps its value when the field is
    // hidden, so the labor line survived into the document and the client read
    // "Labor: 2 workers @ $95/hr x24" under a header promising no total.
    const r = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, lines: _geiLines, rate: _tmRatePerMan,
        crew: _tmCrewCount, hrs: _tmEstHours, layers: [..._tmLayers] };
      const days = document.getElementById('tm-i-days');
      const prevDays = days.value;
      _geiIsTM = true; _geiLines = [];
      _tmLayers = new Set(['rate', 'est']); _tmApplyLayers();
      document.getElementById('tm-i-rate').value = '95';
      _tmCrewCount = 2; document.getElementById('tm-i-crew-count').textContent = '2';
      days.value = '3'; _tmInputChange();
      const withTotal = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length };
      _tmDropLayer('est');
      const asSheet = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length,
        daysKept: days.value };
      _tmAddLayer('est');
      const backAgain = { hrs: _tmEstHours, labor: _geiLines.filter(l => l._tmLabor).length };
      days.value = prevDays;
      _geiIsTM = prev.tm; _geiLines = prev.lines; _tmRatePerMan = prev.rate;
      _tmCrewCount = prev.crew; _tmEstHours = prev.hrs;
      _tmLayers = new Set(prev.layers); _tmApplyLayers();
      return { withTotal, asSheet, backAgain };
    });
    expect(r.withTotal).toEqual({ hrs: 24, labor: 1 });
    expect(r.asSheet).toEqual({ hrs: 0, labor: 0, daysKept: '3' });
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

  test('a chip survives being hammered', async () => {
    const r = await page.evaluate(() => {
      const prev = [..._tmLayers];
      for (let i = 0; i < 20; i++) _tmToggleLayer('mat');
      const settled = { on: _tmLayers.has('mat') };
      _tmLayers = new Set(prev); _tmApplyLayers();
      return settled;
    });
    expect(r.on).toBe(false);
  });

  test('_tmApplyLayers does not throw when its row is not in the DOM', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('tm-add-row');
      const parent = el.parentElement, next = el.nextSibling;
      el.remove();
      let ok = true;
      try { _tmApplyLayers(); } catch (e) { ok = false; }
      parent.insertBefore(el, next);
      _tmApplyLayers();
      return ok;
    });
    expect(r).toBe(true);
  });

  test('a layer name that does not exist is ignored, not stored', async () => {
    const r = await page.evaluate(() => {
      const prev = [..._tmLayers];
      _tmLayers = new Set();
      [undefined, null, 0, '', 'nope', {}, 'RATE'].forEach(v => { try { _tmAddLayer(v); } catch (e) {} });
      const out = [..._tmLayers];
      _tmLayers = new Set(prev); _tmApplyLayers();
      return out;
    });
    expect(r).toEqual([]);
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
    // The rate is a backend number. With a cap set, the cap heads the bar.
    expect(r.sticky).not.toContain('/hr');
    expect(r.sticky).not.toContain('95');
    expect(r.sticky).toContain('3,000');
    expect(r.total).toContain('3,000');
    expect(r.dep).toContain('500');
    expect(r.bal).toContain('weekly');
    expect(r.bal).toContain('3,000');          // the ceiling he chose to give
    // Their words. Homeowners ask "what's the most this could be?", they never
    // say "not to exceed", so neither does anything they read.
    expect(r.bal).toContain('The most it can cost you');
    expect(r.bal).not.toContain('not to exceed');
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

  test('with no cap either, the bar says what it is instead of a number', async () => {
    const r = await page.evaluate(() => ({
      sticky: (document.getElementById('sticky-total') || {}).textContent || '',
      bal: (document.getElementById('amt-bal') || {}).textContent || '',
    }));
    expect(r.sticky).toBe('Time & materials');
    expect(r.sticky).not.toContain('$');
    expect(r.bal).toContain('time and materials used');
    expect(r.bal).not.toContain('$');
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


// ── WHAT A STATE FORCES ONTO THE PROPOSAL ────────────────────────────────────
// Owner 2026-09-17: nothing is required "except in the states that require it."
// These are the states that require it. Getting this wrong in either direction
// is a real cost: force a cap in Kansas and the fast path is gone, fail to
// force one in Massachusetts and the contract does not satisfy the statute.
// The survey behind the table, with confidence per state, is in
// docs/home-improvement-price-rules.md.

test.describe('the state decides what cannot be removed', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('Kansas forces nothing, which is the whole point', async () => {
    const r = await page.evaluate(() => statePriceRule('KS'));
    expect(r.rule).toBe('none');
  });

  test('the states with no home improvement statute force nothing either', async () => {
    const r = await page.evaluate(() =>
      ['KS','TX','GA','NC','SC','MO','OK','NE','WY','ND','SD','NM','AL','AK','ID','UT','MT','WV','KY','NH','MS','AR']
        .filter(s => statePriceRule(s).rule !== 'none'));
    expect(r).toEqual([]);
  });

  test('California blocks, and it is the only one that does', async () => {
    const r = await page.evaluate(() => {
      const all = Object.keys(STATE_PRICE_RULE);
      return { ca: statePriceRule('CA').rule, blockers: all.filter(k => STATE_PRICE_RULE[k].rule === 'block') };
    });
    expect(r.ca).toBe('block');
    expect(r.blockers).toEqual(['CA']);
  });

  test('the total-required states force the cap and carry their citation', async () => {
    const r = await page.evaluate(() =>
      ['AZ','HI','NV','IL','MA','IN','VA','PA','ME'].map(s => {
        const x = statePriceRule(s);
        return { s, rule: x.rule, cited: !!x.statute, noted: !!x.note };
      }));
    r.forEach(x => {
      expect(x.rule, x.s + ' must force the cap').toBe('cap');
      expect(x.cited, x.s + ' must name its statute').toBe(true);
      expect(x.noted, x.s + ' must say why in plain words').toBe(true);
    });
  });

  test('Tennessee is NOT on the list', async () => {
    // The widely repeated "six dollars-and-cents states" list names Tennessee.
    // Its actual wording, "the agreed upon consideration", is the loosest in
    // the survey. Putting it back would force a cap on a state that never asked.
    const r = await page.evaluate(() => statePriceRule('TN').rule);
    expect(r).toBe('none');
  });

  test('a warn state warns and never blocks', async () => {
    const r = await page.evaluate(() => {
      const all = Object.keys(STATE_PRICE_RULE).filter(k => STATE_PRICE_RULE[k].rule === 'warn');
      return all.map(k => ({ k, note: STATE_PRICE_RULE[k].note }));
    });
    expect(r.length).toBeGreaterThan(0);
    r.forEach(x => expect(x.note.length, x.k + ' must explain itself').toBeGreaterThan(20));
  });

  test('an unknown or junk state forces nothing rather than throwing', async () => {
    const r = await page.evaluate(() =>
      [undefined, null, '', 'ZZ', 'kansas', 42, {}].map(v => {
        try { return statePriceRule(v).rule; } catch (e) { return 'THREW'; }
      }));
    expect(r).toEqual(['none', 'none', 'none', 'none', 'none', 'none', 'none']);
  });

  test('lower case resolves the same as upper', async () => {
    const r = await page.evaluate(() => [statePriceRule('ma').rule, statePriceRule('MA').rule]);
    expect(r[0]).toBe(r[1]);
  });

  test('_maxDepositNoTotal still answers for every listed state', async () => {
    const r = await page.evaluate(() =>
      Object.keys(STATE_PRICE_RULE).filter(k => {
        const v = _maxDepositNoTotal(k);
        return !(v === Infinity || v > 0);
      }));
    expect(r).toEqual([]);
  });
});


// ── THE CAP SPEAKS THE CUSTOMER'S LANGUAGE ───────────────────────────────────
// Across the customer-side research the phrase "not to exceed" appears almost
// entirely in contractor and legal writing. What homeowners actually ask is
// "what's the most this could be?". The trade phrase stays in the terms, where
// a statute expects it, and nowhere a customer reads casually.

test.describe('the cap is worded the way a customer asks for it', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the document says the most it can cost, not the trade phrase', async () => {
    const html = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, rate: _tmRatePerMan, id: _geiEditBidId, layers: [..._tmLayers] };
      _geiIsTM = true; _tmRatePerMan = 95;
      _tmLayers = new Set(['rate', 'cap']);
      const nte = document.getElementById('tm-i-nte'), legacy = document.getElementById('tm-nte-cap');
      const pn = nte.value, pl = legacy ? legacy.value : '';
      nte.value = '3,000'; if (legacy) legacy.value = '3000';
      _tmApplyLayers();
      let h = '';
      try { h = sendGenericProposal(true, { silent: true }); } catch (e) { h = 'THREW:' + e.message; }
      nte.value = pn; if (legacy) legacy.value = pl;
      _geiIsTM = prev.tm; _tmRatePerMan = prev.rate; _geiEditBidId = prev.id;
      _tmLayers = new Set(prev.layers); _tmApplyLayers();
      return h;
    });
    expect(html).toContain('The most this can cost you');
    expect(html).not.toContain('Not to exceed');
  });

  test('the builder heading says it too', async () => {
    const t = await page.evaluate(() =>
      (document.getElementById('tm-nte-head') || {}).textContent || '');
    expect(t.toLowerCase()).toContain('most it can cost');
  });

  test('the trade phrase survives in the terms, where a statute expects it', async () => {
    const h = await page.evaluate(() => {
      const prev = { tm: _geiIsTM, rate: _tmRatePerMan };
      _geiIsTM = true; _tmRatePerMan = 95;
      const legacy = document.getElementById('tm-nte-cap');
      const pl = legacy ? legacy.value : '';
      if (legacy) legacy.value = '3000';
      const out = _geiBuildTermsHtml();
      if (legacy) legacy.value = pl;
      _geiIsTM = prev.tm; _tmRatePerMan = prev.rate;
      return out;
    });
    expect(h).toContain('not to exceed');
  });

  // ── WHAT HE IS ABOUT TO SEND, SAID OUT LOUD ───────────────────────────────
  //
  // Owner, 2026-09-22, on this screen: "I'm honestly lost on what I even need
  // to do ... the flow just seems broken, doesn't seem natural."
  //
  // The page was six ＋ chips with nothing above them. It KNEW things it never
  // said: that the scope alone is already a complete proposal, that a rate with
  // no day count prints no total, that Estimate needs Rate. Six equal buttons
  // give a man no way to tell whether he is finished.
  // So the row answers the question he is actually asking, which is not "what
  // can I add" (the chips already show that) but "what happens if I send this
  // now". These tests are about that sentence being TRUE in each shape, because
  // a status line that lies is worse than no status line.
  test.describe('the row says what this proposal currently is', () => {
    const shapeIn = (layers) => page.evaluate((ks) => {
      const prev = [..._tmLayers];
      _tmLayers = new Set(ks);
      _tmApplyLayers();
      const row = document.getElementById('tm-add-row');
      const txt = (row ? row.textContent : '').replace(/\s+/g, ' ').trim();
      _tmLayers = new Set(prev); _tmApplyLayers();
      return txt;
    }, layers);

    // The state nobody believes is finished, and the one the owner explicitly
    // asked for in September: "just get the scope signed, no deposit no payment
    // upfront if they want it to work that way".
    test('scope on its own is named as a complete proposal, not an empty one', async () => {
      const t = await shapeIn([]);
      expect(t).toContain('Scope only, no price');
      expect(t).toContain('complete proposal');
    });

    // The distinction the code has always drawn and never explained:
    // _tmRateOnly is rate without est, and a rate with no day count behind it
    // has no total to print.
    // ASSERTION CHANGED 2026-09-22 (§10.4). It used to require the sentence to
    // say "Add Estimate". Owner: "does time and materials even need estimate
    // cause why put a price on time and materials???" Fair question, and the
    // answer is mostly no: nine of the ten states that force a number onto a
    // T&M job want a CEILING, and only Pennsylvania names an estimate. So the
    // page no longer answers "they want a number" by offering a guess at the
    // hours dressed up as a total. It offers the ceiling, which is the honest
    // number and the one they were asking for. Estimate is still one tap away
    // in the chip row; it is just not the advice any more.
    test('a rate with no day count says there is no total, and points at the ceiling', async () => {
      const t = await shapeIn(['rate']);
      expect(t).toContain('A rate, no total');
      // Sentence-initial now that the line was shortened, hence the capital.
      expect(t).toContain('Nothing has told it how many days');
      expect(t).toContain('give them the ceiling');
      expect(t, 'the old advice was to add an estimate, which is the thing T&M exists not to do')
        .not.toContain('Add Estimate to put a number on it');
    });

    test('a rate with a day count says there is one', async () => {
      const t = await shapeIn(['rate', 'est']);
      expect(t).toContain('A rate and a total');
      expect(t).not.toContain('no total');
    });

    // Everything on: the sentence has to grow with it rather than going stale,
    // because a status line that stops tracking is the thing that made the page
    // untrustworthy in the first place.
    test('and it names every layer that is actually on', async () => {
      const t = await shapeIn(['rate', 'est', 'mat', 'dep', 'cap']);
      expect(t).toContain('plus materials');
      expect(t).toContain('deposit due up front');
      expect(t).toContain('cannot go past the cap');
    });

    // ASSERTION CHANGED 2026-09-22 (§10.4). It used to require the prose
    // "Add Rate unless the labor is agreed some other way". That sentence was
    // deleted when the shape line became step 4's hint and had to stop being
    // the longest thing on the panel. The advice did not go anywhere: it is
    // step 2, sitting above it with its own Add button, which is a better way
    // to say "add the rate" than a sentence telling him to go find a chip.
    test('materials with no rate says the labor is missing, and offers the rate', async () => {
      const t = await shapeIn(['mat']);
      expect(t).toContain('no labor rate');
      expect(t).toContain('What an hour costs');
    });

    // Tapping Estimate turns Rate on with it (_tmAddLayer follows `needs`),
    // which is right and was silent. A man should know what he just pressed.
    test('the one dependency on the row is stated, and only while it matters', async () => {
      const off = await shapeIn([]);
      expect(off).toContain('Estimate turns on Rate with it');
      const on = await shapeIn(['rate']);
      expect(on, 'it kept saying it after Rate was already on').not.toContain('Estimate turns on Rate with it');
    });

    // American spelling, because every other money word on this screen is
    // (the rail says Labor) and a proposal that mixes them reads as bought in.
    test('it speaks the same English as the rest of the screen', async () => {
      const t = await shapeIn(['mat']);
      expect(t).not.toContain('labour');
    });
  });

});


// ── HIS RATE IS HIS BUSINESS, EXCEPT WHERE IT IS NOT ─────────────────────────
//
// Owner, 2026-09-22: "we want rate because then Tim can feed a quick invoice"
// and then "how do we give contractors the opportunity to hide the rate in the
// proposal but it be something they have to toggle, if they usually hide their
// rate does it persist?"
//
// Those two sentences are one flag away from contradicting each other, so the
// code separates the facts they are each about: the rate is ON THE JOB (it
// runs the hours and feeds the invoice) and separately the customer DOES OR
// DOES NOT READ IT. Turning the second off must not reach the first, or the
// invoice he turned the rate on for goes back to zero.
//
// Everything below guards one of three promises: hidden means hidden in every
// place the number reaches a customer, a statute outranks the toggle, and the
// answer follows him to the next job without following a sent proposal back.

test.describe('keeping the rate off the proposal', () => {
  let page;

  // The builder, in T&M, with a rate on it and nothing statutory in the way.
  // The INPUTS are filled, not just the variables, because _tmInputChange reads
  // the fields back on every keystroke and on every flip of this toggle: a test
  // that set only the variables would be testing a state the app cannot be in.
  // 2 workers at $95 over 5 days = $190/hr, 40 hr, $7,600.
  const openTM = (addr) => page.evaluate((a) => {
    _geiIsTM = true; _geiIsFreeForm = false;
    _geiEditBidId = null;
    _tmLayers = new Set(['rate', 'est']);
    _tmRateOnly = false;
    const sv = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    sv('gei-addr', a || '');
    sv('tm-i-rate', '95');
    sv('tm-i-days', '5');
    const crew = document.getElementById('tm-i-crew-count');
    if (crew) crew.textContent = '2';
    _tmApplyLayers();
    _tmInputChange();
  }, addr);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.beforeEach(async () => {
    // A Kansas address: nothing in STATE_PRICE_RULE locks the rate there, so
    // the toggle is his to make. Cleared preference, so nothing leaks between.
    await page.evaluate(() => { try { if (S) S.tmHideRate = false; } catch (_e) {} });
    await openTM('700 Rate Rd, Wichita KS 67202');
    await page.evaluate(() => _tmSetHideRate(false));
  });
  test.afterAll(async () => {
    await page.evaluate(() => { try { if (S) S.tmHideRate = false; } catch (_e) {} });
    await page.context().close();
  });

  const terms = () => page.evaluate(() => _geiBuildTermsHtml());

  // ── HIDDEN MEANS HIDDEN ────────────────────────────────────────────────────

  // Shown first, so the test below is proving a removal and not an absence
  // that was there all along.
  test('shown, the terms state the rate in dollars per hour', async () => {
    const h = await terms();
    expect(h).toContain('$95 per hour');
  });

  test('hidden, the whole rate clause comes out of the terms', async () => {
    await page.evaluate(() => _tmSetHideRate(true));
    const h = await terms();
    expect(h).not.toContain('per hour');
    expect(h, 'the clause was softened instead of removed').not.toContain('95');
    // And the contract is still a time-and-materials contract, not a silence.
    expect(h).toContain('Time &amp; Materials');
  });

  // The second place the number reaches him, and the one that is easy to
  // forget: a line reading "40 hr @ $190" hands back by division exactly what
  // the clause above just stopped printing.
  test('the labor line stops being hours at a rate and becomes one lump', async () => {
    const shown = await page.evaluate(() => {
      _tmInputChange();
      return _geiLines.filter(l => l._tmLabor)[0] || null;
    });
    expect(shown).toMatchObject({ unit: 'hr', qty: 40, rate: 190 });

    const hid = await page.evaluate(() => {
      _tmSetHideRate(true);
      return _geiLines.filter(l => l._tmLabor)[0] || null;
    });
    expect(hid.unit).toBe('lot');
    expect(hid.qty).toBe(1);
    // Same money owed. Only the arithmetic that recovers the rate is gone.
    expect(hid.total).toBe(shown.total);
    expect(hid.rate).toBe(shown.total);
    expect(hid.desc).not.toContain('/hr');
    expect(hid.desc).not.toContain('95');
  });

  // The whole point of the owner's sentence: the rate is still ON the job.
  // If hiding it zeroed _tmRatePerMan, Tim's worksheet would price those hours
  // at nothing and the invoice he turned the rate on for would come out empty.
  test('hiding it does not take the rate off the job', async () => {
    const r = await page.evaluate(() => {
      _tmSetHideRate(true);
      return { rate: _tmRatePerMan, saved: (() => {
        const b = {}; b.tmRatePerMan = _tmRatePerMan; b.tmHideRate = !!_tmHideRate; return b;
      })() };
    });
    expect(r.rate).toBe(95);
    expect(r.saved).toEqual({ tmRatePerMan: 95, tmHideRate: true });
  });

  // ── WHERE IT IS NOT HIS CALL ──────────────────────────────────────────────

  // Pennsylvania's HICPA defines T&M as payment "based on the actual cost of
  // labor at a specified hourly rate". A PA proposal with the rate hidden is
  // not a T&M contract. The boundary reused here is the one the file already
  // draws (a statute that LOCKS the rate layer), so this test is really
  // holding that the two stay tied together.
  test('a state that requires the rate does not offer the toggle at all', async () => {
    const r = await page.evaluate(() => {
      const el = document.getElementById('gei-addr');
      if (el) el.value = '12 Main St, Philadelphia PA 19103';
      _tmApplyLayers();
      const wrap = document.getElementById('tm-hide-rate-wrap');
      return {
        can: _tmCanHideRate(),
        box: !!document.getElementById('tm-hide-rate'),
        txt: (wrap ? wrap.textContent : '').replace(/\s+/g, ' ').trim(),
      };
    });
    expect(r.can).toBe(false);
    expect(r.box, 'a checkbox he cannot legally use was still tappable').toBe(false);
    // Told why, and told by whom, rather than just missing.
    expect(r.txt).toContain('Pennsylvania');
    expect(r.txt).toContain('73 P.S. 517.7');
  });

  // The proposal he started in Kansas and finished on a Philadelphia job.
  // The flag travels with the draft; the printing rule is decided where the
  // work is, at the moment the document is built.
  test('a proposal carried into that state prints the rate anyway', async () => {
    const h = await page.evaluate(() => {
      _tmSetHideRate(true);
      const el = document.getElementById('gei-addr');
      if (el) el.value = '12 Main St, Philadelphia PA 19103';
      return _geiBuildTermsHtml();
    });
    expect(h).toContain('$95 per hour');
  });

  test('and the labor line comes back as hours at a rate there too', async () => {
    const l = await page.evaluate(() => {
      _tmSetHideRate(true);
      const el = document.getElementById('gei-addr');
      if (el) el.value = '12 Main St, Philadelphia PA 19103';
      _tmInputChange();
      return _geiLines.filter(x => x._tmLabor)[0] || null;
    });
    expect(l.unit).toBe('hr');
    expect(l.desc).toContain('$95/hr');
  });

  // ── AND NOT IN THE FILE BEHIND THE PAGE EITHER ────────────────────────────
  //
  // sendGenericProposal writes a proposals/<uid>/<id>_<token>.json that the
  // customer's browser downloads to render sign.html, and it carried an
  // hourlyRate field. Nothing in sign.html reads it, so nothing on screen was
  // wrong, and that is exactly why it would have survived: a number he
  // deliberately kept off the document sitting in the payload behind it, one
  // devtools tab away.
  //
  // This one reads the source rather than the running app, because reaching
  // that object at runtime means standing up an upload. It is guarding the
  // shape of one expression, which is all that went wrong.
  test('the payload that reaches the customer does not carry the rate', () => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'generic-estimate.js'), 'utf8');
    const line = src.split('\n').filter(l => /^\s*hourlyRate:/.test(l))[0] || '';
    expect(line, 'hourlyRate: left the proposal payload entirely').toBeTruthy();
    expect(line, 'hourlyRate went back to shipping the rate unconditionally')
      .toContain('_tmHideRate');
    expect(line).toContain('_tmCanHideRate');
  });

  // ── DOES IT PERSIST ───────────────────────────────────────────────────────

  // "if they usually hide their rate does it persist?" On S, not on the device,
  // so it follows him to the tablet in the truck rather than living on one
  // phone. A man who hides his rate hides it on every job and should not have
  // to remember to say so on every job.
  test('the answer is remembered on the account, not the phone', async () => {
    const on = await page.evaluate(() => { _tmSetHideRate(true); return !!S.tmHideRate; });
    expect(on).toBe(true);
    const off = await page.evaluate(() => { _tmSetHideRate(false); return !!S.tmHideRate; });
    expect(off).toBe(false);
    // Assigning it onto S is not remembering it: S only reaches disk when
    // something calls the save. This asserts the write, not the variable.
    const stored = await page.evaluate(() => {
      _tmSetHideRate(true);
      try { return !!JSON.parse(localStorage.getItem('zp3_S') || '{}').tmHideRate; }
      catch (_e) { return 'UNPARSEABLE'; }
    });
    expect(stored, 'the preference never reached storage, so it dies with the tab').toBe(true);
  });

  test('a brand new proposal opens the way he left the last one', async () => {
    const r = await page.evaluate(() => {
      S.tmHideRate = true;
      const was = _tmHideRateDefault();
      // What openGenericEstimate does on a fresh one, without the navigation.
      _tmHideRate = _tmHideRateDefault();
      return { def: was, fresh: _tmHideRate };
    });
    expect(r).toEqual({ def: true, fresh: true });
  });

  // The one case where the preference must NOT win. He sent a proposal with
  // the rate printed, then turned the preference on. Reopening that proposal
  // has to show him what the customer is holding, not what he does now.
  test('a saved proposal resumes the way it was sent, not the way he works now', async () => {
    const r = await page.evaluate(() => {
      S.tmHideRate = true;
      const line = (b) => (b.tmHideRate !== undefined) ? !!b.tmHideRate : _tmHideRateDefault();
      return {
        sentShown: line({ tmHideRate: false }),
        sentHidden: line({ tmHideRate: true }),
        // A bid saved before this existed has no answer of its own, so the
        // standing preference is all there is to go on.
        legacy: line({}),
      };
    });
    expect(r).toEqual({ sentShown: false, sentHidden: true, legacy: true });
  });

  // Same rule, run through the real resume path rather than a copy of its
  // arithmetic, so the two cannot drift apart.
  test('the real resume path honours the bid over the preference', async () => {
    const r = await page.evaluate(async () => {
      S.tmHideRate = true;
      clients = clients.filter(c => c.id !== 77709);
      bids = bids.filter(b => b.id !== 66609);
      clients.push({ id: 77709, name: 'Resume Client', phone: '316-555-7779',
        addr: '709 Resume Rd, Wichita KS 67202' });
      bids.push({ id: 66609, client_id: 77709, client_name: 'Resume Client', amount: 7600,
        deposit: 0, status: 'Pending', bid_date: '2026-03-04', trade_type: 'plumbing',
        type: 'Repipe', geiLines: [], isTM: true, tmCrewCount: 2, tmRatePerMan: 95,
        tmEstHours: 40, tmBillingCycle: 'weekly', tmHideRate: false });
      try { openGenericEstimate(clients.filter(c => c.id === 77709)[0], 66609, 'plumbing'); }
      catch (_e) {}
      const out = !!_tmHideRate;
      clients = clients.filter(c => c.id !== 77709);
      bids = bids.filter(b => b.id !== 66609);
      return out;
    });
    expect(r, 'the preference overwrote what the customer was actually sent').toBe(false);
  });
});


// ── WHY PUT A PRICE ON TIME AND MATERIALS ────────────────────────────────────
//
// Owner, 2026-09-22: "So does time and materials even need estimate cause why
// put a price on time and materials???"
//
// Mostly it does not, and the file already knew: _tmLockedLayers has always
// locked rate and cap and never est, because of the ten states that force a
// number onto a T&M job, nine want a CEILING ("the total amount to be paid",
// "a cap the total cannot exceed") and only Pennsylvania names an estimate.
// Only the screen disagreed. It put Estimate second, left the cap sixth where
// it read as an afterthought, and printed ESTIMATED TOTAL in 21px in the accent
// bar while the ceiling that actually protected the customer sat in the terms
// in 11px.
//
// These hold the corrected order: an estimate is a guess at the hours, a cap is
// a promise about the bill, and only one of those belongs in the big type.

test.describe('the ceiling leads, not the guess', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── THE ROW ───────────────────────────────────────────────────────────────

  test('the cap chip sits second, ahead of Estimate', async () => {
    const order = await page.evaluate(() => TM_LAYERS.map(l => l.k));
    expect(order.slice(0, 3)).toEqual(['rate', 'cap', 'est']);
  });

  test('nothing in the ordering broke the dependency or the locks', async () => {
    const r = await page.evaluate(() => ({
      // Estimate still cannot stand on its own: a day count has nothing to
      // multiply without a rate.
      needs: (TM_LAYERS.filter(l => l.k === 'est')[0] || {}).needs,
      // Each layer still owns the block it shows, cap included.
      blocks: TM_LAYERS.filter(l => l.blk).map(l => l.k).sort(),
      keys: TM_LAYERS.map(l => l.k).sort(),
    }));
    expect(r.needs).toBe('rate');
    expect(r.keys).toEqual(['cap', 'dep', 'est', 'excl', 'mat', 'rate']);
    expect(r.blocks).toEqual(['cap', 'excl', 'mat', 'rate']);
  });

  // ── THE STEPS ─────────────────────────────────────────────────────────────
  //
  // Owner, same message: "need clear action item steps that look clean and
  // understand what's going on."

  const stepsIn = (setup) => page.evaluate((s) => {
    _geiIsTM = true;
    const sv = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    sv('gei-addr', s.addr || '700 Rate Rd, Wichita KS 67202');
    _geiScopeChips = s.scope ? ['x'] : [];
    _geiJobScope = ''; _geiScopeNoScope = false; _geiLines = [];
    _tmRatePerMan = s.rate || 0; sv('tm-i-rate', s.rate ? String(s.rate) : '');
    sv('tm-i-nte', s.cap ? String(s.cap) : '');
    _tmLayers = new Set(s.layers);
    return _tmSteps().map(x => ({ n: x.n, k: x.k, done: !!x.done, rec: !!x.rec, act: x.act || null }));
  }, setup);

  test('there are four of them, in the order the job is actually done', async () => {
    const s = await stepsIn({ layers: ['rate'] });
    expect(s.map(x => x.k)).toEqual(['scope', 'rate', 'cap', 'send']);
  });

  // The whole point of a numbered list is that exactly one line is the next
  // move. Two "do this next" tags, each with its own filled button, is the
  // six-chips problem again in a taller box.
  test('exactly one step is ever marked as the next move', async () => {
    for (const setup of [
      { layers: ['rate'] },
      { layers: ['rate'], scope: true },
      { layers: ['rate'], scope: true, rate: 95 },
      { layers: ['rate', 'cap'], scope: true, rate: 95, cap: 3000 },
    ]) {
      const s = await stepsIn(setup);
      expect(s.filter(x => x.rec).length,
        'more than one next move on ' + JSON.stringify(setup)).toBeLessThanOrEqual(1);
    }
  });

  // And it has to be the FIRST thing he has not done. A ceiling is not the next
  // move while there is still no rate on the job.
  test('the next move is the rate while there is no rate', async () => {
    const s = await stepsIn({ layers: ['rate'], scope: true });
    expect((s.filter(x => x.rec)[0] || {}).k).toBe('rate');
  });

  test('and it becomes the ceiling the moment the rate is in', async () => {
    const s = await stepsIn({ layers: ['rate'], scope: true, rate: 95 });
    expect((s.filter(x => x.rec)[0] || {}).k).toBe('cap');
  });

  // Nothing left to press: the steps go quiet rather than inventing a chore.
  test('with the rate and the ceiling both in, nothing is nagging him', async () => {
    const s = await stepsIn({ layers: ['rate', 'cap'], scope: true, rate: 95, cap: 3000 });
    expect(s.filter(x => x.rec).length).toBe(0);
    expect(s.filter(x => x.done).map(x => x.k)).toEqual(['scope', 'rate', 'cap']);
  });

  // A layer switched on with an empty box is not a step done. This is the
  // difference between the chip row (what is on) and the steps (what is true).
  test('a cap layer with no number in it does not count as done', async () => {
    const s = await stepsIn({ layers: ['rate', 'cap'], scope: true, rate: 95, cap: 0 });
    expect((s.filter(x => x.k === 'cap')[0] || {}).done).toBe(false);
  });

  test('the steps render into the row, and the send step carries the shape sentence', async () => {
    const t = await page.evaluate(() => {
      _geiIsTM = true;
      _tmLayers = new Set(['rate']); _tmRatePerMan = 95;
      const e = document.getElementById('tm-i-rate'); if (e) e.value = '95';
      _tmApplyLayers();
      const row = document.getElementById('tm-add-row');
      return (row ? row.textContent : '').replace(/\s+/g, ' ').trim();
    });
    expect(t).toContain('Do this next');
    expect(t).toContain('The most it can cost');
    expect(t).toContain('Send it');
    // Folded into step 4 rather than sitting in a card of its own, which is how
    // four steps were added without making the panel taller.
    expect(t).toContain('A rate, no total');
    expect(t).not.toContain('Send it now and they get');
  });

  // California will not take a T&M home improvement contract at all, so a
  // checklist there would be walking him through something he must not do.
  test('a state that forbids T&M gets the warning and no steps', async () => {
    const t = await page.evaluate(() => {
      const e = document.getElementById('gei-addr');
      if (e) e.value = '1 Ocean Ave, Los Angeles CA 90291';
      _geiIsTM = true; _tmLayers = new Set(['rate']);
      _tmApplyLayers();
      const row = document.getElementById('tm-add-row');
      const out = (row ? row.textContent : '').replace(/\s+/g, ' ').trim();
      if (e) e.value = '700 Rate Rd, Wichita KS 67202';
      _tmApplyLayers();
      return out;
    });
    expect(t).toContain('does not allow');
    expect(t, 'it walked him through a contract his state will not take').not.toContain('Do this next');
  });

  // ── THE DOCUMENT ──────────────────────────────────────────────────────────

  const doc = (cap) => page.evaluate((c) => {
    const prev = { tm: _geiIsTM, rate: _tmRatePerMan, only: _tmRateOnly, layers: [..._tmLayers] };
    _geiIsTM = true; _geiIsFreeForm = false;
    _tmLayers = new Set(['rate', 'est']); _tmRateOnly = false;
    _tmRatePerMan = 95; _tmEstHours = 40; _tmCrewCount = 2;
    const sv = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    sv('gei-addr', '700 Rate Rd, Wichita KS 67202');
    sv('tm-i-rate', '95'); sv('tm-i-days', '5');
    sv('tm-nte-cap', c ? String(c) : ''); sv('tm-i-nte', c ? String(c) : '');
    let h = '';
    try { h = sendGenericProposal(true, { silent: true }); } catch (e) { h = 'THREW:' + e.message; }
    document.getElementById('_prop-preview-ov')?.remove();
    _geiIsTM = prev.tm; _tmRatePerMan = prev.rate; _tmRateOnly = prev.only;
    _tmLayers = new Set(prev.layers);
    return h;
  }, cap);

  // The old shape, still correct where there is no ceiling to lead with.
  test('with no ceiling, the estimated total is still the big number', async () => {
    const h = await doc(0);
    expect(h).toContain('ESTIMATED TOTAL');
    expect(h).not.toContain('THE MOST THIS CAN COST YOU');
  });

  // The fix. The cap used to appear NOWHERE in the money footer when there was
  // an estimate: it was one clause of eleven in the terms, in 11px, while a
  // guess at the hours sat in the accent bar in 21px.
  test('with a ceiling, the ceiling is the big number and the guess steps down', async () => {
    const h = await doc(12000);
    expect(h).toContain('THE MOST THIS CAN COST YOU');
    expect(h).toContain('$12,000');
    // Nothing is hidden: the estimate is still on the page, just not shouting.
    expect(h).toContain('not a fixed price');
    // And it is not still claiming to be the total.
    expect(h).not.toContain('ESTIMATED TOTAL');
  });

  // A ceiling with no qualifier is a promise he cannot keep: approved extras
  // are exactly how a T&M job legitimately passes its cap.
  test('the big ceiling says what lifts it', async () => {
    const h = await doc(12000);
    expect(h).toContain('Unless you approve more in writing');
  });
});
