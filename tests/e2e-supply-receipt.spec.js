// @ts-check
// ── Receipt-gated supply runs (owner design 2026-08-17) ──────────────────────
//
// The incident this feature exists for: a Sunday personal Home Depot run was
// auto-logged as two business legs, because the destination alone used to be
// proof enough. Now the RECEIPT is the proof. A drive leg touching a 'supply'
// place is written HELD (pendingReceipt) and excluded from every deduction
// total until the dashboard card's three doors answer for it:
//
//   Personal      -> the held rows are deleted, never belonged in the log
//   No receipt    -> business, flagged noReceipt, after the IRS disclaimer
//   Scan receipt  -> the quick-expense save settles mileage + expense together
//
// Repeat visits to the SAME store nest under one accordion card instead of
// piling up as separate top-level cards (owner: "stack... nesting under that
// store with an accordion dropdown"). Ignore a run long enough and the 7-day
// sweep answers Personal for you: it disappears the same way a manual
// Personal tap would.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Receipt-gated supply runs', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  // Log one auto leg through the real entry point. The router is stubbed to a
  // fixed number: what is under test is the HOLD, not MapKit's arithmetic.
  const logLeg = (from, to, legKey) => page.evaluate(async (a) => {
    const realRoute = _routeDistance;
    window._routeDistance = _routeDistance = async () => ({ miles: 5.5, mins: 12 });
    try {
      const rec = autoLogDriveTrip({ from: a.from, to: a.to, legKey: a.legKey });
      await new Promise(r => setTimeout(r, 30));
      return rec ? mileage.find(m => m.legKey === a.legKey) : null;
    } finally {
      window._routeDistance = _routeDistance = realRoute;
    }
  }, { from, to, legKey });

  const SUPPLY = { lat: 38.12, lng: -94.12, kind: 'supply', name: 'Home Depot' };
  const JOB    = { lat: 38.06, lng: -94.06, kind: 'job', name: 'Miller Residence' };
  const HOME   = { lat: 38.18, lng: -94.18 };

  test.beforeEach(async () => {
    await page.evaluate(() => { mileage.length = 0; });
  });

  test.describe('the hold', () => {




    test('pendingSupplyStores nests multiple visits to the SAME store, oldest first', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
        // Three days at Home Depot, seeded out of order, plus one at Ace.
        mileage.push({ id: _newId(), date: day(0), miles: 4, pendingReceipt: true, supplyRunKey: day(0) + '|Home Depot', created_at: new Date(Date.now() - 0).toISOString() });
        mileage.push({ id: _newId(), date: day(3), miles: 4, pendingReceipt: true, supplyRunKey: day(3) + '|Home Depot', created_at: new Date(Date.now() - 3 * 86400000).toISOString() });
        mileage.push({ id: _newId(), date: day(1), miles: 4, pendingReceipt: true, supplyRunKey: day(1) + '|Home Depot', created_at: new Date(Date.now() - 1 * 86400000).toISOString() });
        mileage.push({ id: _newId(), date: day(0), miles: 2, pendingReceipt: true, supplyRunKey: day(0) + '|Ace', created_at: new Date().toISOString() });
        return pendingSupplyStores();
      });
      expect(out.length).toBe(2);
      const hd = out.find(s => s.name === 'Home Depot');
      expect(hd.count).toBe(3);
      // Oldest to newest inside the store.
      const dates = hd.visits.map(v => v.date);
      expect(dates).toEqual([...dates].sort());
    });
  });

  test.describe('the three doors', () => {
    const seedHeld = () => page.evaluate(() => {
      mileage.length = 0;
      const key = todayKey() + '|Home Depot';
      mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
      mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
      return key;
    });

    // AMENDED 2026-09-05 (10.4). Personal used to DELETE the held rows (owner
    // 2026-08-17). A held leg is a derived leg now and the deriver owns it: the
    // next rebuild re-derives the same journey id, geo_replace_day clears the
    // tombstone and re-inserts it, and the run comes back held. A delete is
    // not a stable answer to a row that will be written again; personal:true
    // is, and every money total already excludes it. The row stays in the
    // log, off the books, which is what the toast has always said.
    test('Personal: marks the held rows personal and keeps them in the log, off the books', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        const before = mileage.length;
        const n = resolveSupplyRun(k, 'personal');
        const rows = mileage.filter(m => m.supplyRunKey === k);
        return { n, before, after: mileage.length,
          marked: rows.every(m => m.personal === true && !m.pendingReceipt),
          offBooks: deductibleTrips(mileage).length === 0 && reimbursableTrips(mileage).length === 0,
          heldGone: pendingSupplyRuns().length === 0 };
      }, key);
      expect(out.n).toBe(2);
      expect(out.before).toBe(2);
      expect(out.after, 'the log keeps its odometer story').toBe(2);
      expect(out.marked).toBe(true);
      expect(out.offBooks, 'and no total counts them').toBe(true);
      expect(out.heldGone, 'and the card has nothing left to ask').toBe(true);
    });

    test('an answered run stays answered when the deriver writes the same leg again', async () => {
      // The carry-across in js/geo-track.js: whatever the person answered
      // rides onto the re-derived leg, and the fresh hold is dropped.
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = todayKey(), key = day + '|Home Depot';
        const leg = (extra) => Object.assign({ id: 'j-x-1', legKey: 'j-x-1', gps: true, date: day, miles: 4,
          pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', startedIso: new Date().toISOString() }, extra || {});
        const results = {};
        for (const [name, answer] of [['personal', 'personal'], ['noreceipt', 'noreceipt'], ['receipt', 'receipt']]) {
          mileage.length = 0;
          _geoDeriveApplyMileage(day, [leg()]);
          resolveSupplyRun(key, answer, answer === 'receipt' ? 777001 : undefined);
          _geoDeriveApplyMileage(day, [leg()]);          // the rebuild
          const m = mileage.find(x => x.id === 'j-x-1');
          results[name] = { held: !!m.pendingReceipt, personal: !!m.personal, noReceipt: !!m.noReceipt, exp: m.receiptExpenseId };
        }
        // And a run nobody answered stays held through a rebuild.
        mileage.length = 0;
        _geoDeriveApplyMileage(day, [leg()]); _geoDeriveApplyMileage(day, [leg()]);
        results.unanswered = { held: !!mileage[0].pendingReceipt, n: mileage.length };
        return results;
      });
      expect(out.personal).toEqual({ held: false, personal: true, noReceipt: false, exp: undefined });
      expect(out.noreceipt).toEqual({ held: false, personal: false, noReceipt: true, exp: undefined });
      expect(out.receipt).toEqual({ held: false, personal: false, noReceipt: false, exp: 777001 });
      expect(out.unanswered).toEqual({ held: true, n: 1 });
    });

    test('No receipt: commits as business carrying the noReceipt flag', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        resolveSupplyRun(k, 'noreceipt');
        return { ded: deductibleTrips(mileage).length, rows: mileage.length,
                 flagged: mileage.every(m => m.noReceipt === true && !m.pendingReceipt) };
      }, key);
      expect(out.ded, 'the disclaimer door still deducts').toBe(2);
      expect(out.rows, 'no receipt keeps the rows, unlike Personal').toBe(2);
      expect(out.flagged).toBe(true);
    });

    test('Receipt: commits and links the expense that proved it', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        resolveSupplyRun(k, 'receipt', 777001);
        return { ded: deductibleTrips(mileage).length,
                 linked: mileage.every(m => m.receiptExpenseId === 777001 && !m.pendingReceipt) };
      }, key);
      expect(out.ded).toBe(2);
      expect(out.linked).toBe(true);
    });

    test('an unknown key resolves nothing and touches nothing', async () => {
      await seedHeld();
      const out = await page.evaluate(() => {
        const n = resolveSupplyRun('2020-01-01|Nowhere', 'personal');
        return { n, stillHeld: mileage.every(m => m.pendingReceipt === true), stillTwo: mileage.length === 2 };
      });
      expect(out.n).toBe(0);
      expect(out.stillHeld).toBe(true);
      expect(out.stillTwo).toBe(true);
    });

    test('the No receipt door shows the IRS disclaimer FIRST, and Yes commits', async () => {
      const key = await seedHeld();
      await page.evaluate((k) => { _supplyRunNoReceipt(encodeURIComponent(k)); }, key);
      const msg = await page.locator('.zmodal-overlay .zmodal-msg').innerText();
      expect(msg).toContain('IRS may disallow the mileage and the expense');
      // Still held while the disclaimer is on screen: showing it is not consent.
      expect(await page.evaluate(() => mileage.every(m => m.pendingReceipt === true))).toBe(true);
      await page.click('#zmodal-yes');
      const out = await page.evaluate(() => ({
        flagged: mileage.every(m => m.noReceipt === true && !m.pendingReceipt),
        modalGone: !document.querySelector('.zmodal-overlay'),
      }));
      expect(out.flagged).toBe(true);
      expect(out.modalGone).toBe(true);
    });

    test('backing out of the disclaimer leaves the run held', async () => {
      const key = await seedHeld();
      await page.evaluate((k) => { _supplyRunNoReceipt(encodeURIComponent(k)); }, key);
      await page.click('.zmodal-overlay .zmodal-cancel');
      expect(await page.evaluate(() => mileage.every(m => m.pendingReceipt === true))).toBe(true);
    });
  });

  test.describe('the 7-day sweep', () => {
    // AMENDED 2026-09-05 (10.4): off the books, not deleted, for the reason
    // on _supplyRunSettleByKeys. The week-old run is marked personal and
    // leaves the card; the fresh one stays held.
    test('a week-old unanswered run goes off the books; a fresh one stays held', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
        mileage.push({ id: _newId(), date: day(8), miles: 3, pendingReceipt: true, supplyRunKey: day(8) + '|Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: day(2), miles: 3, pendingReceipt: true, supplyRunKey: day(2) + '|Ace2', created_at: new Date().toISOString() });
        const n = _supplyRunSweep();
        const stale = mileage[0], fresh = mileage[1];
        return { n, rows: mileage.length,
          staleSettled: !!stale && stale.personal === true && !stale.pendingReceipt,
          freshStillHeld: !!fresh && fresh.pendingReceipt === true && !fresh.personal,
          onCard: pendingSupplyRuns().length };
      });
      expect(out.n, 'the sweep settled the stale row').toBe(1);
      expect(out.rows, 'off the books, still in the log').toBe(2);
      expect(out.staleSettled).toBe(true);
      expect(out.freshStillHeld).toBe(true);
      expect(out.onCard, 'only the fresh one is still asked about').toBe(1);
    });

    test('a corrupt date cannot crash the sweep or be swept', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: 'not-a-date', miles: 3, pendingReceipt: true, supplyRunKey: 'x|Ace', created_at: new Date().toISOString() });
        try { return { n: _supplyRunSweep(), held: mileage[0].pendingReceipt === true, threw: false }; }
        catch (e) { return { threw: true }; }
      });
      expect(out.threw).toBe(false);
      expect(out.n).toBe(0);
      expect(out.held).toBe(true);
    });
  });

  // ── The receipt card's sibling: visits that need an answer (rule 13) ────
  test.describe('visits need an answer', () => {
    const ROWS = [
      { id: 'v1', arrived_at: '2026-08-30T22:00:00Z', departed_at: '2026-08-31T01:00:00Z', minutes: 180, dest_place: 'Mom', job_id: null },
      { id: 'v2', arrived_at: '2026-08-23T21:00:00Z', departed_at: '2026-08-23T23:00:00Z', minutes: 120, dest_place: 'Dad', job_id: null },
    ];
    test('the card lists each held visit with a Working and a Personal door, and hides with nothing to ask', async () => {
      const r = await page.evaluate((rows) => {
        const el = document.getElementById('dash-visit-hold');
        _paintDashVisitHold(el, rows);
        // AMENDED 2026-09-05 (10.4): the count moved off the section and onto the
        // one Needs-an-answer shell (#dash-hold-count) when the two cards became
        // one (owner: "Combine them"). The section itself carries no count.
        const shell = document.getElementById('dash-hold');
        const shown = { display: el.style.display, names: [...el.querySelectorAll('.td-supply-visit')].map(v => v.firstElementChild.textContent),
          doors: [...el.querySelectorAll('button')].map(b => b.textContent.trim()), held: /2 held/.test(document.getElementById('dash-hold-count').textContent),
          shellShown: shell.style.display !== 'none', noOwnCount: !/held/.test(el.textContent) };
        _paintDashVisitHold(el, []);
        return { shown, hidden: el.style.display === 'none' && el.innerHTML === '', shellHidden: document.getElementById('dash-supply-hold').style.display === 'none' ? shell.style.display === 'none' : true };
      }, ROWS);
      expect(r.shown.display).toBe('block');
      expect(r.shown.names).toEqual(['Mom', 'Dad']);
      expect(r.shown.doors).toEqual(['Personal', 'Working', 'Personal', 'Working']);
      expect(r.shown.held).toBe(true);
      expect(r.shown.shellShown).toBe(true);
      expect(r.shown.noOwnCount, 'the count lives on the shell, not the section').toBe(true);
      expect(r.hidden).toBe(true);
      expect(r.shellHidden, 'nothing left in either section: the whole card goes').toBe(true);
    });

    test('answering goes through geo_answer_visit and takes the visit off the card at once', async () => {
      const r = await page.evaluate(async (rows) => {
        const saved = { supa: window._supa, user: window._supaUser, toast: window.showToast };
        const calls = [], toasts = [];
        window._supa = { rpc: async (fn, args) => { calls.push([fn, args]); return { error: null }; } };
        window._supaUser = { id: 'me' }; window.showToast = (t) => toasts.push(t);
        try {
          _visitHoldCache = { at: Date.now(), rows: rows.slice(), uid: 'me' };
          const el = document.getElementById('dash-visit-hold');
          _paintDashVisitHold(el, _visitHoldCache.rows);
          await _visitHoldAnswer('v1', 'working');
          const left = [...el.querySelectorAll('.td-supply-visit')].map(v => v.firstElementChild.textContent);
          await _visitHoldAnswer('v2', 'personal');
          return { calls, left, empty: el.style.display === 'none', toasts };
        } finally { window._supa = saved.supa; window._supaUser = saved.user; window.showToast = saved.toast; _visitHoldCache = { at: 0, rows: [], uid: null }; }
      }, ROWS);
      expect(r.calls).toEqual([['geo_answer_visit', { p_id: 'v1', p_mode: 'working' }], ['geo_answer_visit', { p_id: 'v2', p_mode: 'personal' }]]);
      expect(r.left).toEqual(['Dad']);
      expect(r.empty).toBe(true);
      expect(r.toasts).toEqual(['Counted as work', 'Kept off the books']);
    });

    test('a refused answer puts the visit back and says so', async () => {
      const r = await page.evaluate(async (rows) => {
        const saved = { supa: window._supa, user: window._supaUser, toast: window.showToast };
        const toasts = [];
        window._supa = { rpc: async () => ({ error: { message: 'geo_answer_visit: not your visit' } }),
          // order-agnostic chain: the filter order is the soft-delete lint's business, not this test's
          from: () => { const q = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }; return q; } };
        window._supaUser = { id: 'me' }; window.showToast = (t) => toasts.push(t);
        try {
          _visitHoldCache = { at: Date.now(), rows: rows.slice(), uid: 'me' };
          const el = document.getElementById('dash-visit-hold');
          _paintDashVisitHold(el, _visitHoldCache.rows);
          await _visitHoldAnswer('v1', 'working');
          await new Promise(r2 => setTimeout(r2, 50));
          return { toasts, cacheCleared: _visitHoldCache.at === 0 || _visitHoldCache.rows.length === 2 };
        } finally { window._supa = saved.supa; window._supaUser = saved.user; window.showToast = saved.toast; _visitHoldCache = { at: 0, rows: [], uid: null }; }
      }, ROWS);
      expect(r.toasts).toEqual(['Could not save that answer, try again']);
      expect(r.cacheCleared).toBe(true);
    });

    test('junk in never throws', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('dash-visit-hold');
        try { _paintDashVisitHold(el, null); _paintDashVisitHold(el, [null, {}, { id: 'x' }]); _paintDashVisitHold(null, []); return true; } catch (e) { return String(e); }
      });
      expect(r).toBe(true);
    });
  });

  test.describe('the scan door settles both books in one save', () => {
    test('Scan receipt opens the REAL scanner flow: camera fired, key inside the modal, vendor/date/category prefilled', async () => {
      // Owner 2026-08-26, screenshot in hand: this button opened the bare
      // quick-expense form, keyboard up, no camera anywhere. The button says
      // SCAN, so it must open openExpenseFlow and fire the scanner in the
      // same tap. No waits anywhere: the injection is synchronous by design
      // (a 120ms timer version of _supplyRunScan lost that race on WebKit CI).
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: '2026-08-20', miles: 4, pendingReceipt: true, supplyRunKey: '2026-08-20|Home Depot', purpose: 'Supply run', created_at: new Date().toISOString() });
        document.getElementById('expense-modal')?.remove();
        const realScanner = window._showReceiptScanner;
        let scannerFired = 0;
        window._showReceiptScanner = () => { scannerFired++; };
        try {
          _supplyRunScan(encodeURIComponent('2026-08-20|Home Depot'));
          return {
            scannerFired,
            fullFlow: !!document.getElementById('expense-modal'),
            quickModal: !!document.querySelector('.zmodal-overlay'),
            key: (document.getElementById('qe-supply-run') || {}).value || '',
            insideModal: !!document.querySelector('#expense-modal #qe-supply-run'),
            vendor: (document.getElementById('em-vendor') || {}).value || '',
            date: (document.getElementById('em-date') || {}).value || '',
            cat: (document.getElementById('em-cat') || {}).value || '',
          };
        } finally {
          window._showReceiptScanner = realScanner;
          if (typeof closeExpenseFlow === 'function') closeExpenseFlow();
        }
      });
      expect(out.fullFlow, 'openExpenseFlow, not the quick modal').toBe(true);
      expect(out.quickModal).toBe(false);
      expect(out.scannerFired, 'the camera opens on the same tap').toBe(1);
      expect(out.key).toBe('2026-08-20|Home Depot');
      expect(out.insideModal, 'the key rides in the modal, never a global').toBe(true);
      expect(out.vendor).toBe('Home Depot');
      // The receipt in their hand is dated the day of the VISIT, not the day
      // they finally answered the card.
      expect(out.date).toBe('08/20/2026');
      expect(out.cat).toBe('materials');
    });

    test('saving the expense commits the held mileage and links the expense id', async () => {
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const savedExp = expenses.slice();
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        document.getElementById('expense-modal')?.remove();
        const realScanner = window._showReceiptScanner;
        window._showReceiptScanner = () => {};
        try {
          _supplyRunScan(encodeURIComponent(key));
          document.getElementById('em-amount').value = '84.12';
          const before = expenses.length;
          await expSave();
          const exp = expenses.length > before ? expenses.find(e => e.vendor === 'Home Depot' && e.amount === 84.12) : null;
          const row = mileage[0];
          return { saved: !!exp, expId: exp && exp.id,
                   committed: !row.pendingReceipt, linked: row.receiptExpenseId,
                   ded: deductibleTrips(mileage).length };
        } finally {
          window._showReceiptScanner = realScanner;
          if (typeof closeExpenseFlow === 'function') closeExpenseFlow();
          expenses.length = 0; savedExp.forEach(e => expenses.push(e));
        }
      });
      expect(out.saved).toBe(true);
      expect(out.committed, 'the receipt is the proof: the save commits the run').toBe(true);
      expect(out.linked).toBe(out.expId);
      expect(out.ded).toBe(1);
    });

    test('cancelling the scan modal cannot leak the key onto a later, unrelated expense', async () => {
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const savedExp = expenses.slice();
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        document.getElementById('expense-modal')?.remove();
        const realScanner = window._showReceiptScanner;
        window._showReceiptScanner = () => {};
        try {
          _supplyRunScan(encodeURIComponent(key));
          // Back out: the key lives in the modal, so closing takes it too.
          closeExpenseFlow();
          // Then log a completely unrelated expense the plain full-flow way.
          openExpenseFlow();
          document.getElementById('em-vendor').value = 'Chick-fil-A';
          document.getElementById('em-amount').value = '12.00';
          await expSave();
          return { stillHeld: mileage[0].pendingReceipt === true, leaked: !!mileage[0].receiptExpenseId };
        } finally {
          window._showReceiptScanner = realScanner;
          if (typeof closeExpenseFlow === 'function') closeExpenseFlow();
          expenses.length = 0; savedExp.forEach(e => expenses.push(e));
        }
      });
      expect(out.stillHeld).toBe(true);
      expect(out.leaked).toBe(false);
    });
  });

  test.describe('the surfaces', () => {
    test('the held card is pinned at the TOP of the dashboard, above the money tiles', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const el = document.getElementById('dash-supply-hold');
        const widgets = document.getElementById('dash-widget-root');
        const above = !!(widgets && (el.compareDocumentPosition(widgets) & Node.DOCUMENT_POSITION_FOLLOWING));
        return { shown: el.style.display !== 'none', above };
      });
      expect(out.shown).toBe(true);
      expect(out.above, 'the card renders above the money tiles').toBe(true);
    });

    test('one store, one visit: a plain card with date/time and the three doors in order, no miles, no leg count', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const el = document.getElementById('dash-supply-hold');
        const store = el.querySelector('.td-supply-store');
        const btns = [...store.querySelectorAll('.td-supply-visit button')].map(b => b.textContent.trim());
        const scanBtn = store.querySelector('.td-supply-visit button.btn-p');
        return {
          html: el.innerHTML,
          storeName: store.querySelector('.td-supply-store-hd .name').textContent.trim(),
          hasBadge: !!store.querySelector('.td-supply-store-badge'),
          btns, scanIsBlue: scanBtn && scanBtn.textContent.trim() === 'Scan receipt',
        };
      });
      expect(out.storeName).toBe('Home Depot');
      expect(out.hasBadge, 'a single visit gets no count badge').toBe(false);
      expect(out.html).not.toContain(' mi<');
      expect(out.html).not.toContain('legs');
      expect(out.html).toMatch(/\d{1,2}:\d{2}[ap]/);
      expect(out.btns).toEqual(['Personal', 'No receipt', 'Scan receipt']);
      expect(out.scanIsBlue).toBe(true);
    });

    test('multiple visits to the same store nest under ONE accordion, oldest first, with a count badge', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
        mileage.push({ id: _newId(), date: day(2), miles: 3, pendingReceipt: true, supplyRunKey: day(2) + '|Home Depot', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
        mileage.push({ id: _newId(), date: day(0), miles: 3, pendingReceipt: true, supplyRunKey: day(0) + '|Home Depot', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const el = document.getElementById('dash-supply-hold');
        const stores = el.querySelectorAll('.td-supply-store');
        const visits = el.querySelectorAll('.td-supply-visit');
        const badge = el.querySelector('.td-supply-store-badge');
        const visitDates = [...visits].map(v => v.querySelector('div').textContent.trim());
        return { storeCount: stores.length, visitCount: visits.length, badge: badge ? badge.textContent.trim() : '', visitDates };
      });
      expect(out.storeCount, 'one top-level card for the store, not two').toBe(1);
      expect(out.visitCount).toBe(2);
      expect(out.badge).toBe('2');
      // Oldest visit text sorts before the newest visit text (both "Mon D" format).
      const parsed = out.visitDates.map(t => new Date(t.split(' · ')[0] + ' ' + new Date().getFullYear()));
      expect(parsed[0].getTime()).toBeLessThanOrEqual(parsed[1].getTime());
    });

    test('the store accordion defaults open (it is a live prompt, not an archive) and tapping closes it', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const store = document.querySelector('#dash-supply-hold .td-supply-store');
        const openBefore = store.classList.contains('open');
        store.querySelector('.td-supply-store-hd').click();
        const openAfter = store.classList.contains('open');
        return { openBefore, openAfter };
      });
      // The single/most-recent store defaults open (an actionable prompt, not
      // an archive), and the toggle flips it.
      expect(out.openBefore).toBe(true);
      expect(out.openAfter).toBe(false);
    });

    test('answered runs clear the card completely, gone like the setup checklist', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const shownBefore = document.getElementById('dash-supply-hold').style.display !== 'none';
        resolveSupplyRun(key, 'noreceipt');
        _renderDashSupplyHold();
        const el = document.getElementById('dash-supply-hold');
        return { shownBefore, shownAfter: el.style.display !== 'none', empty: el.innerHTML === '' };
      });
      expect(out.shownBefore).toBe(true);
      expect(out.shownAfter).toBe(false);
      expect(out.empty).toBe(true);
    });

    test('the old money-feed card is GONE: held runs no longer render there', async () => {
      const feed = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        renderTodayFeed();
        return document.getElementById('dash-money-feed').innerHTML;
      });
      expect(feed).not.toContain('mileage held until you answer');
      expect(feed).not.toContain('_supplyRunPersonal');
    });

    test('the day header deduction preview skips held rows', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 10, purpose: 'Job site', from_name: 'Shop', to_name: 'Job', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 10, pendingReceipt: true, supplyRunKey: todayKey() + '|Ace', purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        _milRenderTripList(mileage, new Date().getFullYear());
        const ded = document.querySelector('#mil-table .mil-day-ded');
        const mi = document.querySelector('#mil-table .mil-day-miles');
        return { ded: ded ? ded.textContent : '', mi: mi ? mi.textContent : '', rate: IRS(new Date().getFullYear()) };
      });
      // Distance really driven is all 20 miles; the money preview is only the
      // 10 deductible ones.
      expect(out.mi).toContain('20.0');
      expect(out.ded).toContain((10 * out.rate).toFixed(2));
      expect(out.ded).not.toContain((20 * out.rate).toFixed(2));
    });

    test('the mileage log badges held and no-receipt rows; Personal never appears there (it deletes)', async () => {
      const html = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: todayKey() + '|Ace', purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, noReceipt: true, purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        _milRenderTripList(mileage, new Date().getFullYear());
        return document.getElementById('mil-table').innerHTML;
      });
      expect(html).toContain('Held · receipt?');
      expect(html).toContain('>No receipt<');
    });
  });

  // ── ONE card, two sections (owner 2026-09-05: "Combine them") ─────────────
  // Two amber cards stacked at the top read as two alarms and pushed the money
  // tiles off the screen. Now one shell (#dash-hold) carries the title and the
  // count; store runs and visits are sections inside it, each with its own
  // doors, because the answers really are different.
  test.describe('one Needs-an-answer card', () => {
    const VISITS = [
      { id: 'v1', arrived_at: '2026-08-30T22:00:00Z', departed_at: '2026-08-31T01:00:00Z', minutes: 180, dest_place: 'Mom', job_id: null },
      { id: 'v2', arrived_at: '2026-08-23T21:00:00Z', departed_at: '2026-08-23T23:00:00Z', minutes: 120, dest_place: 'Dad', job_id: null },
    ];
    const seedRun = () => page.evaluate(() => {
      mileage.length = 0;
      const key = todayKey() + '|Home Depot';
      mileage.push({ id: _newId(), date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
      _renderDashSupplyHold();
      return key;
    });
    test.afterEach(async () => {
      await page.evaluate(() => { mileage.length = 0; _renderDashSupplyHold(); _paintDashVisitHold(document.getElementById('dash-visit-hold'), []); });
    });

    test('both kinds held: one shell, one title, the count is the SUM, each section keeps its own doors', async () => {
      await seedRun();
      const r = await page.evaluate((rows) => {
        _paintDashVisitHold(document.getElementById('dash-visit-hold'), rows);
        const shell = document.getElementById('dash-hold');
        const secs = [...shell.querySelectorAll('.td-hold-sec-t')].map(e => e.textContent.trim());
        return {
          shown: shell.style.display !== 'none',
          cards: shell.querySelectorAll('.card').length,
          title: shell.querySelector('.td-hold-title').textContent.trim(),
          count: document.getElementById('dash-hold-count').textContent.trim(),
          secs,
          storeDoors: [...document.querySelectorAll('#dash-supply-hold .td-supply-visit button')].map(b => b.textContent.trim()),
          visitDoors: [...document.querySelectorAll('#dash-visit-hold .td-supply-visit button')].map(b => b.textContent.trim()),
          oldTitles: /Store runs need an answer|Visits need an answer/.test(shell.textContent),
        };
      }, VISITS);
      expect(r.shown).toBe(true);
      expect(r.cards, 'one card, not one per kind').toBe(1);
      expect(r.title).toBe('Needs an answer');
      expect(r.count).toBe('3 held');
      expect(r.secs).toEqual(['Store runs', 'Visits']);
      expect(r.storeDoors).toEqual(['Personal', 'No receipt', 'Scan receipt']);
      expect(r.visitDoors).toEqual(['Personal', 'Working', 'Personal', 'Working']);
      expect(r.oldTitles, 'the two old card titles are gone').toBe(false);
    });

    test('the count follows the answers: 3, then 1, then the card is gone', async () => {
      const key = await seedRun();
      const r = await page.evaluate(async ({ rows, key }) => {
        const saved = { supa: window._supa, user: window._supaUser, toast: window.showToast };
        window._supa = { rpc: async () => ({ error: null }) }; window._supaUser = { id: 'me' }; window.showToast = () => {};
        try {
          _visitHoldCache = { at: Date.now(), rows: rows.slice(), uid: 'me' };
          _paintDashVisitHold(document.getElementById('dash-visit-hold'), _visitHoldCache.rows);
          const c = () => document.getElementById('dash-hold-count').textContent.trim();
          const out = [c()];
          await _visitHoldAnswer('v1', 'working'); await _visitHoldAnswer('v2', 'personal');
          out.push(c());
          resolveSupplyRun(key, 'noreceipt'); _renderDashSupplyHold();
          out.push(c());
          return { out, gone: document.getElementById('dash-hold').style.display === 'none' };
        } finally { window._supa = saved.supa; window._supaUser = saved.user; window.showToast = saved.toast; _visitHoldCache = { at: 0, rows: [], uid: null }; }
      }, { rows: VISITS, key });
      expect(r.out).toEqual(['3 held', '1 held', '']);
      expect(r.gone).toBe(true);
    });

    test('the shell is what the boot skeleton covers, as one card, and it sits above the money tiles', async () => {
      await seedRun();
      const r = await page.evaluate(() => {
        const shell = document.getElementById('dash-hold');
        const widgets = document.getElementById('dash-widget-root');
        const above = !!(widgets && (shell.compareDocumentPosition(widgets) & Node.DOCUMENT_POSITION_FOLLOWING));
        const src = _dashApplySkeletons.toString();
        return { above, targetsShell: /#dash-hold\b/.test(src) && !/#dash-supply-hold/.test(src) && !/#dash-visit-hold/.test(src) };
      });
      expect(r.above).toBe(true);
      expect(r.targetsShell, 'the skeleton shimmers the one shell, not the two sections').toBe(true);
    });

    test('layout (§15.3): no bleed and no overlapping doors at 320px', async () => {
      await seedRun();
      await page.setViewportSize({ width: 320, height: 700 });
      try {
        const r = await page.evaluate((rows) => {
          _paintDashVisitHold(document.getElementById('dash-visit-hold'), rows);
          const shell = document.getElementById('dash-hold');
          const btns = [...shell.querySelectorAll('button')].map(b => b.getBoundingClientRect());
          let overlap = false;
          for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
            const a = btns[i], b = btns[j];
            if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
          }
          return { bleed: document.documentElement.scrollWidth > window.innerWidth + 1, right: shell.getBoundingClientRect().right <= window.innerWidth, overlap };
        }, VISITS);
        expect(r.bleed).toBe(false);
        expect(r.right).toBe(true);
        expect(r.overlap).toBe(false);
      } finally { await page.setViewportSize({ width: 390, height: 844 }); }
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
