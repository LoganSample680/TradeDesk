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

    test('Personal: clears the held rows from the log ENTIRELY, not just marked', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        const before = mileage.length;
        const n = resolveSupplyRun(k, 'personal');
        return { n, before, after: mileage.length, gone: mileage.every(m => m.supplyRunKey !== k) };
      }, key);
      expect(out.n).toBe(2);
      expect(out.before).toBe(2);
      expect(out.after, 'Personal deletes, it does not mark').toBe(0);
      expect(out.gone).toBe(true);
    });

    test('Personal deletion is recorded as an explicit delete for cross-device sync', async () => {
      // Routed through _userDelete (cloud.js), which diffs every synced
      // array's ids before/after and records whatever disappeared into
      // _locallyDeletedIds.td_mileage. That set is what stops the sync
      // sweep from resurrecting the rows on another device: without it,
      // Personal would look identical to a row nobody ever deleted.
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        const ids = mileage.filter(m => m.supplyRunKey === k).map(m => String(m.id));
        resolveSupplyRun(k, 'personal');
        const tracked = typeof _locallyDeletedIds !== 'undefined' && _locallyDeletedIds.td_mileage
          ? ids.every(id => _locallyDeletedIds.td_mileage.has(id)) : null;
        return { tracked, stillThere: mileage.some(m => m.supplyRunKey === k) };
      }, key);
      expect(out.stillThere).toBe(false);
      if (out.tracked !== null) expect(out.tracked, 'both deleted ids land in the explicit-delete set').toBe(true);
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
    test('a week-old unanswered run disappears; a fresh one stays held', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
        mileage.push({ id: _newId(), date: day(8), miles: 3, pendingReceipt: true, supplyRunKey: day(8) + '|Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: day(2), miles: 3, pendingReceipt: true, supplyRunKey: day(2) + '|Ace2', created_at: new Date().toISOString() });
        const n = _supplyRunSweep();
        return { n, rows: mileage.length, freshStillHeld: mileage[0] && mileage[0].pendingReceipt === true };
      });
      expect(out.n, 'the sweep removed the stale row').toBe(1);
      expect(out.rows, 'it disappears, it is not left behind marked').toBe(1);
      expect(out.freshStillHeld).toBe(true);
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

  test('no console errors', async () => { await assertNoErrors(page); });
});
