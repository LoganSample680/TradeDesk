// @ts-check
// ── Receipt-gated supply runs (owner design 2026-08-17) ──────────────────────
//
// The incident this feature exists for: a Sunday personal Home Depot run was
// auto-logged as two business legs, because the destination alone used to be
// proof enough. Now the RECEIPT is the proof. A drive leg touching a 'supply'
// place is written HELD (pendingReceipt) and excluded from every deduction
// total until the dashboard card's three doors answer for it:
//
//   Personal      -> rows kept (unbroken odometer story) but off the books
//   No receipt    -> business, flagged noReceipt, after the IRS disclaimer
//   Scan receipt  -> the quick-expense save settles mileage + expense together
//
// Unanswered runs go personal after 7 days (_supplyRunSweep): the business log
// can never carry a store run nobody stood behind.
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
    test('a leg INTO a supply place is written held and kept out of the deduction', async () => {
      const row = await logLeg(JOB, SUPPLY, 'sr-in-1');
      expect(row).toBeTruthy();
      expect(row.pendingReceipt).toBe(true);
      expect(row.supplyRunKey).toBe(row.date + '|Home Depot');
      const ded = await page.evaluate(() => deductibleTrips(mileage).length);
      expect(ded, 'a held row must not deduct').toBe(0);
    });

    test('the leg back OUT of the supply place is held under the SAME run key', async () => {
      const inRow = await logLeg(JOB, SUPPLY, 'sr-out-1');
      const outRow = await logLeg(SUPPLY, JOB, 'sr-out-2');
      expect(outRow.pendingReceipt).toBe(true);
      expect(outRow.supplyRunKey).toBe(inRow.supplyRunKey);
    });

    test('an ordinary leg is untouched: no hold, deducts as always', async () => {
      const row = await logLeg(HOME, JOB, 'sr-plain-1');
      expect(row.pendingReceipt).toBeUndefined();
      expect(row.supplyRunKey).toBeUndefined();
      const ded = await page.evaluate(() => deductibleTrips(mileage).length);
      expect(ded).toBe(1);
    });

    test('pendingSupplyRuns groups both legs of one visit into one card', async () => {
      await logLeg(JOB, SUPPLY, 'sr-grp-1');
      await logLeg(SUPPLY, JOB, 'sr-grp-2');
      const runs = await page.evaluate(() => pendingSupplyRuns());
      expect(runs.length).toBe(1);
      expect(runs[0].name).toBe('Home Depot');
      expect(runs[0].count).toBe(2);
      expect(runs[0].miles).toBeCloseTo(11.0, 1);   // 5.5 + 5.5 from the stub
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

    test('Personal: rows KEPT in the log (unbroken odometer story) but off the books', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        const n = resolveSupplyRun(k, 'personal');
        return { n, rows: mileage.length, ded: deductibleTrips(mileage).length,
                 personal: mileage.every(m => m.personal === true && m.purpose === 'Personal' && !m.pendingReceipt) };
      }, key);
      expect(out.n).toBe(2);
      expect(out.rows, 'personal rows are marked, never deleted').toBe(2);
      expect(out.personal).toBe(true);
      expect(out.ded).toBe(0);
    });

    test('No receipt: commits as business carrying the noReceipt flag', async () => {
      const key = await seedHeld();
      const out = await page.evaluate((k) => {
        resolveSupplyRun(k, 'noreceipt');
        return { ded: deductibleTrips(mileage).length,
                 flagged: mileage.every(m => m.noReceipt === true && !m.pendingReceipt && !m.personal) };
      }, key);
      expect(out.ded, 'the disclaimer door still deducts').toBe(2);
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
        return { n, stillHeld: mileage.every(m => m.pendingReceipt === true) };
      });
      expect(out.n).toBe(0);
      expect(out.stillHeld).toBe(true);
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
    test('week-old unanswered runs go personal; fresh ones stay held', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const day = (n) => { const d = new Date(Date.now() - n * 86400000); return dateKey(d); };
        mileage.push({ id: _newId(), date: day(8), miles: 3, pendingReceipt: true, supplyRunKey: day(8) + '|Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: day(2), miles: 3, pendingReceipt: true, supplyRunKey: day(2) + '|Ace', created_at: new Date().toISOString() });
        const n = _supplyRunSweep();
        return { n, old: mileage[0], fresh: mileage[1] };
      });
      expect(out.n).toBe(1);
      expect(out.old.personal).toBe(true);
      expect(out.old.purpose).toBe('Personal');
      expect(out.old.pendingReceipt).toBeUndefined();
      expect(out.fresh.pendingReceipt).toBe(true);
      expect(out.fresh.personal).toBeUndefined();
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
    test('the quick-expense modal carries the run key INSIDE the modal and prefills the vendor', async () => {
      // No waits anywhere: the injection is synchronous by design (a 120ms
      // timer version of _supplyRunScan lost this exact race on WebKit CI).
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: todayKey() + '|Home Depot', purpose: 'Supply run', created_at: new Date().toISOString() });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _supplyRunScan(encodeURIComponent(todayKey() + '|Home Depot'));
        return {
          key: (document.getElementById('qe-supply-run') || {}).value || '',
          insideModal: !!document.querySelector('.zmodal-overlay .zmodal #qe-supply-run'),
          vendor: (document.getElementById('qe-vendor') || {}).value || '',
        };
      });
      expect(out.key).toBe(await page.evaluate(() => todayKey() + '|Home Depot'));
      expect(out.insideModal, 'the key rides in the modal, never a global').toBe(true);
      expect(out.vendor).toBe('Home Depot');
      await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
    });

    test('saving the expense commits the held mileage and links the expense id', async () => {
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _supplyRunScan(encodeURIComponent(key));
        document.getElementById('qe-amount').value = '84.12';
        const before = expenses.length;
        saveQuickExpense(null);
        const exp = expenses.length > before ? expenses.find(e => e.vendor === 'Home Depot' && e.amount === 84.12) : null;
        const row = mileage[0];
        return { saved: !!exp, expId: exp && exp.id,
                 committed: !row.pendingReceipt, linked: row.receiptExpenseId,
                 ded: deductibleTrips(mileage).length };
      });
      expect(out.saved).toBe(true);
      expect(out.committed, 'the receipt is the proof: the save commits the run').toBe(true);
      expect(out.linked).toBe(out.expId);
      expect(out.ded).toBe(1);
    });

    test('cancelling the scan modal cannot leak the key onto a later, unrelated expense', async () => {
      const out = await page.evaluate(async () => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        _supplyRunScan(encodeURIComponent(key));
        // Back out, then log a completely unrelated expense the plain way.
        document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
        showQuickExpenseModal(null, null);
        document.getElementById('qe-vendor').value = 'Chick-fil-A';
        document.getElementById('qe-amount').value = '12.00';
        saveQuickExpense(null);
        return { stillHeld: mileage[0].pendingReceipt === true, leaked: !!mileage[0].receiptExpenseId };
      });
      expect(out.stillHeld).toBe(true);
      expect(out.leaked).toBe(false);
    });
  });

  test.describe('the surfaces', () => {
    test('the held card is pinned at the TOP of the dashboard, above the money tiles, with all three doors in order', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        const key = todayKey() + '|Home Depot';
        mileage.push({ id: _newId(), date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 4.2, pendingReceipt: true, supplyRunKey: key, purpose: 'Supply run', created_at: new Date().toISOString() });
        _renderDashSupplyHold();
        const el = document.getElementById('dash-supply-hold');
        const btns = [...el.querySelectorAll('.td-supply-row button')].map(b => b.textContent.trim());
        const scanBtn = el.querySelector('.td-supply-row button.btn-p');
        // The slot itself sits above the widget root (the money tiles), the
        // same pinned position the setup checklist owns.
        const widgets = document.getElementById('dash-widget-root');
        const above = !!(widgets && (el.compareDocumentPosition(widgets) & Node.DOCUMENT_POSITION_FOLLOWING));
        return { html: el.innerHTML, shown: el.style.display !== 'none', btns, scanIsBlue: scanBtn && scanBtn.textContent.trim() === 'Scan receipt', above };
      });
      expect(out.shown).toBe(true);
      expect(out.above, 'the card renders above the money tiles').toBe(true);
      expect(out.html).toContain('Home Depot run');
      expect(out.html).toContain('8.4 mi');
      // The owner's order: Personal on the left, No receipt in the middle,
      // Scan receipt as the blue primary on the right.
      expect(out.btns).toEqual(['Personal', 'No receipt', 'Scan receipt']);
      expect(out.scanIsBlue).toBe(true);
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

    test('the day header deduction preview skips held and personal rows', async () => {
      const out = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 10, purpose: 'Job site', from_name: 'Shop', to_name: 'Job', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 10, pendingReceipt: true, supplyRunKey: todayKey() + '|Ace', purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 10, personal: true, purpose: 'Personal', from_name: 'Ace', to_name: 'Home', created_at: new Date().toISOString() });
        _milRenderTripList(mileage, new Date().getFullYear());
        const ded = document.querySelector('#mil-table .mil-day-ded');
        const mi = document.querySelector('#mil-table .mil-day-miles');
        return { ded: ded ? ded.textContent : '', mi: mi ? mi.textContent : '', rate: IRS(new Date().getFullYear()) };
      });
      // Distance really driven is all 30 miles; the money preview is only the
      // 10 deductible ones.
      expect(out.mi).toContain('30.0');
      expect(out.ded).toContain((10 * out.rate).toFixed(2));
      expect(out.ded).not.toContain((30 * out.rate).toFixed(2));
    });

    test('the mileage log badges held, personal and no-receipt rows', async () => {
      const html = await page.evaluate(() => {
        mileage.length = 0;
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, pendingReceipt: true, supplyRunKey: todayKey() + '|Ace', purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, personal: true, purpose: 'Personal', from_name: 'Home', to_name: 'Ace', created_at: new Date().toISOString() });
        mileage.push({ id: _newId(), date: todayKey(), miles: 4, noReceipt: true, purpose: 'Supply run', from_name: 'Job', to_name: 'Ace', created_at: new Date().toISOString() });
        _milRenderTripList(mileage, new Date().getFullYear());
        return document.getElementById('mil-table').innerHTML;
      });
      expect(html).toContain('Held · receipt?');
      expect(html).toContain('>Personal<');
      expect(html).toContain('>No receipt<');
    });
  });

  test('no console errors', async () => { await assertNoErrors(page); });
});
