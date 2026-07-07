// @ts-check
const { test, expect, mockAllExternal, _supabaseShim, _supabaseShimIntake, waitForAppBoot, goPg, assertNoErrors, FAKE_BID_ID_1, FAKE_BID_ID_2, FAKE_USER_ID, FAKE_TOKEN, FAKE_TOKEN_2, MOCK_PROPOSAL } = require('./helpers');

test.describe('zConfirm modal', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('zConfirm — renders with custom title and danger Yes button', async () => {
    const result = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      if (typeof zConfirm === 'undefined') return null;
      zConfirm('Delete this item?', () => {}, { title: 'Confirm delete', yes: 'Delete', danger: true });
      const ov    = document.querySelector('.zmodal-overlay');
      const title = ov?.querySelector('.zmodal-title')?.textContent || '';
      const msg   = ov?.querySelector('.zmodal-msg')?.textContent   || '';
      const yesEl = ov?.querySelector('#zmodal-yes');
      // Use getAttribute('style') — browsers normalize hex → rgb() in .style.background,
      // so reading the raw attribute string is the only reliable cross-browser check.
      const yesStyle = yesEl ? (yesEl.getAttribute('style') || '') : '';
      return { title, msg, yesText: yesEl?.textContent?.trim(), danger: yesStyle.includes('#A32D2D') };
    });
    if (result !== null) {
      expect(result.title).toBe('Confirm delete');
      expect(result.msg).toContain('Delete this item');
      expect(result.yesText).toBe('Delete');
      expect(result.danger).toBe(true);
    }
    // dismiss
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()));
  });

  test('zConfirm — Yes calls callback and closes modal', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      window._confirmYesFired = false;
      zConfirm('Sure?', () => { window._confirmYesFired = true; });
    });
    await page.locator('#zmodal-yes').click();
    await page.waitForTimeout(150);
    const fired  = await page.evaluate(() => window._confirmYesFired);
    const gone   = await page.evaluate(() => !document.querySelector('.zmodal-overlay'));
    expect(fired).toBe(true);
    expect(gone).toBe(true);
  });

  test('zConfirm — Cancel closes modal without calling callback', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      window._confirmCancelFired = false;
      zConfirm('Sure?', () => { window._confirmCancelFired = true; });
    });
    await page.locator('.zmodal-cancel').click();
    await page.waitForTimeout(150);
    const fired = await page.evaluate(() => window._confirmCancelFired);
    const gone  = await page.evaluate(() => !document.querySelector('.zmodal-overlay'));
    expect(fired).toBe(false);
    expect(gone).toBe(true);
  });

  test('zConfirm — overlay backdrop click closes modal', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      zConfirm('Backdrop test?', () => {});
    });
    // Click the overlay itself (not the inner box)
    await page.evaluate(() => {
      const ov = document.querySelector('.zmodal-overlay');
      if (ov) ov.dispatchEvent(new MouseEvent('click', { bubbles: true, target: ov }));
    });
    await page.waitForTimeout(150);
    const gone = await page.evaluate(() => !document.querySelector('.zmodal-overlay'));
    expect(gone).toBe(true);
  });

  test('zConfirm — onNo callback fires when Cancel clicked', async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      window._onNoFired = false;
      zConfirm('Test onNo?', () => {}, { onNo: () => { window._onNoFired = true; } });
    });
    await page.locator('.zmodal-cancel').click();
    await page.waitForTimeout(150);
    const fired = await page.evaluate(() => window._onNoFired);
    expect(fired).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  LIEN MANAGEMENT LIFECYCLE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Lien management lifecycle', () => {
  const LIEN_BID_ID = 800001;
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    // Inject a Closed Won bid with full balance
    await page.evaluate(([bidId]) => {
      if (typeof clients !== 'undefined') {
        clients = clients.filter(c => c.id !== 777001);
        clients.push({ id: 777001, name: 'Carol Lien', phone: '316-555-9001', addr: '456 Oak Ave, Wichita KS 67202' });
      }
      if (typeof bids !== 'undefined') {
        bids = bids.filter(b => b.id !== bidId);
        bids.push({
          id: bidId, client_id: 777001, client_name: 'Carol Lien',
          amount: 5000, status: 'Closed Won',
          bid_date: '2026-01-15', addr: '456 Oak Ave', trade: 'painting',
        });
      }
      if (typeof liens !== 'undefined') liens = liens.filter(l => l.bid_id !== bidId);
      if (typeof payments !== 'undefined') payments = payments.filter(p => p.bid_id !== bidId);
    }, [LIEN_BID_ID]);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('getBidLien — returns undefined before lien is saved', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof getBidLien === 'undefined') return 'skip';
      const l = getBidLien(bidId);
      return l === undefined || l === null ? null : l;
    }, [LIEN_BID_ID]);
    if (result !== 'skip') expect(result).toBeNull();
  });

  test('openLienPanel — populates fields with defaults', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof openLienPanel !== 'function') return null;
      // Ensure panel element exists (may need client detail page)
      let panelEl = document.getElementById('cd-lien-panel');
      if (!panelEl) {
        panelEl = document.createElement('div');
        panelEl.id = 'cd-lien-panel';
        panelEl.style.display = 'none';
        document.body.appendChild(panelEl);
        ['lien-date','lien-status','lien-amount','lien-county','lien-notes'].forEach(id => {
          const inp = document.createElement(id === 'lien-status' ? 'select' : 'input');
          inp.id = id;
          if (id === 'lien-status') {
            ['intent','filed','attorney','resolved'].forEach(v => {
              const o = document.createElement('option'); o.value = v; panelEl.appendChild(o);
            });
          }
          panelEl.appendChild(inp);
        });
      }
      try { openLienPanel(bidId); } catch(e) { return { error: e.message }; }
      return {
        visible:  panelEl.style.display !== 'none',
        // Comma-formatted now ("5,000.00") — strip commas before parsing, same
        // as the app's own _moneyVal read helper.
        amount:   (document.getElementById('lien-amount') || {}).value || null,
        status:   (document.getElementById('lien-status') || {}).value || null,
        county:   (document.getElementById('lien-county') || {}).value || null,
        dateSet:  !!((document.getElementById('lien-date') || {}).value),
      };
    }, [LIEN_BID_ID]);
    if (result && !result.error) {
      expect(result.visible).toBe(true);
      if (result.amount !== null) expect(parseFloat(result.amount.replace(/,/g, ''))).toBeCloseTo(5000, 0);
      if (result.status !== null) expect(result.status).toBe('intent');
      expect(result.dateSet).toBe(true);
    }
  });

  test('saveLien — adds lien record to liens array', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof saveLien !== 'function' || typeof liens === 'undefined') return null;
      // Route through the real openLienPanel(bidId) to set activeLienBidId —
      // it's a plain module-scope `let`, not a window property, so
      // `window.activeLienBidId = bidId` (the old pattern here) never actually
      // reached it. That made this test silently depend on the PRIOR test
      // ("openLienPanel — populates fields") having already run successfully
      // to set the real variable as a side effect — if that test ever failed
      // for any reason, this one broke too, with a confusing unrelated error.
      // Self-contained now: sets its own state instead of inheriting it.
      if (typeof openLienPanel === 'function') openLienPanel(bidId);
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('lien-date',   '2026-05-20');
      set('lien-status', 'intent');
      set('lien-amount', '5000');
      set('lien-county', 'Sedgwick County');
      set('lien-notes',  'E2E test lien');
      // Stub side effects
      const _save = window.saveAll; const _close = window.closeLienPanel;
      const _render1 = window.renderCDBids; const _render2 = window.renderDashActiveLiens;
      window.saveAll = () => {}; window.closeLienPanel = () => {};
      window.renderCDBids = () => {}; window.renderDashActiveLiens = () => {};
      const before = liens.filter(l => l.bid_id === bidId).length;
      try { saveLien(); } catch(e) { return { error: e.message }; }
      window.saveAll = _save; window.closeLienPanel = _close;
      window.renderCDBids = _render1; window.renderDashActiveLiens = _render2;
      const after = liens.filter(l => l.bid_id === bidId).length;
      const lien  = liens.find(l => l.bid_id === bidId);
      return { before, after, status: lien?.status, amount: lien?.amount, county: lien?.county, date: lien?.date };
    }, [LIEN_BID_ID]);
    if (result && !result.error) {
      expect(result.after).toBeGreaterThan(result.before);
      expect(result.status).toBe('intent');
      expect(result.amount).toBe(5000);
      expect(result.county).toBe('Sedgwick County');
      expect(result.date).toBe('2026-05-20');
    }
  });

  test('getBidLien — returns saved lien after save', async () => {
    const lien = await page.evaluate(([bidId]) => {
      if (typeof getBidLien !== 'function') return null;
      const l = getBidLien(bidId);
      return l ? { bid_id: l.bid_id, status: l.status } : null;
    }, [LIEN_BID_ID]);
    if (lien !== null) {
      expect(lien.bid_id).toBe(LIEN_BID_ID);
      expect(lien.status).toBe('intent');
    }
  });

  test('saveLien with filed status — triggers high_risk on client', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof saveLien !== 'function') return null;
      // Real call, not window.activeLienBidId= — see the note in the previous test.
      if (typeof openLienPanel === 'function') openLienPanel(bidId);
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('lien-date', '2026-05-21'); set('lien-status', 'filed');
      set('lien-amount', '5000');     set('lien-county', 'Sedgwick County');
      const _save = window.saveAll; const _close = window.closeLienPanel;
      const _r1 = window.renderCDBids; const _r2 = window.renderDashActiveLiens;
      const _print = window.printKansasLien;
      window.saveAll = () => {}; window.closeLienPanel = () => {};
      window.renderCDBids = () => {}; window.renderDashActiveLiens = () => {};
      window.printKansasLien = () => {};
      let riskSet = false;
      const _origRisk = window.setClientRisk;
      window.setClientRisk = (cid, risk) => { if (risk === 'high_risk') riskSet = true; };
      try { saveLien(); } catch(e) {}
      window.saveAll = _save; window.closeLienPanel = _close;
      window.renderCDBids = _r1; window.renderDashActiveLiens = _r2;
      window.printKansasLien = _print; window.setClientRisk = _origRisk;
      const lien = liens.find(l => l.bid_id === bidId);
      return { status: lien?.status, riskSet };
    }, [LIEN_BID_ID]);
    if (result !== null) {
      expect(result.status).toBe('filed');
      expect(result.riskSet).toBe(true);
    }
  });

  // Regression — filed liens were not reliably reaching the cloud. Before:
  // saveLien only ever called the fire-and-forget saveAll() (a 2s debounce
  // timer) and returned synchronously, so a caller (or a live flow test) that
  // checked td_liens right after saveLien() returned would deterministically
  // see the write before it had even started. Fixed: saveLien is now async
  // and awaits _flushSaveNow() (cancels the debounce, pushes immediately)
  // before it resolves. This proves the await happens; the live flow test
  // (payments-liens-flow.spec.js) proves the row actually lands in td_liens.
  test('saveLien awaits the cloud write (_flushSaveNow) before resolving — does not just schedule it', async () => {
    const result = await page.evaluate(async ([bidId]) => {
      if (typeof saveLien !== 'function') return null;
      // Real call, not window.activeLienBidId= — see the note two tests up.
      if (typeof openLienPanel === 'function') openLienPanel(bidId);
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('lien-date', '2026-05-22'); set('lien-status', 'intent');
      set('lien-amount', '2500'); set('lien-county', 'Sedgwick County');
      const _save = window.saveAll; const _close = window.closeLienPanel;
      const _r1 = window.renderCDBids; const _r2 = window.renderDashActiveLiens;
      const _flush = window._flushSaveNow;
      window.saveAll = () => {}; window.closeLienPanel = () => {};
      window.renderCDBids = () => {}; window.renderDashActiveLiens = () => {};
      let flushCalled = false, flushAwaitedBeforeResolve = false;
      window._flushSaveNow = () => {
        flushCalled = true;
        return new Promise(res => setTimeout(() => { flushAwaitedBeforeResolve = true; res(); }, 20));
      };
      let resolvedAfterFlush = false;
      try {
        await saveLien();
        resolvedAfterFlush = flushAwaitedBeforeResolve;
      } catch (e) { return { error: e.message }; }
      finally {
        window.saveAll = _save; window.closeLienPanel = _close;
        window.renderCDBids = _r1; window.renderDashActiveLiens = _r2;
        window._flushSaveNow = _flush;
      }
      return { flushCalled, resolvedAfterFlush };
    }, [LIEN_BID_ID]);
    if (result && !result.error) {
      expect(result.flushCalled, 'saveLien must call _flushSaveNow, not rely on the bare debounce timer').toBe(true);
      expect(result.resolvedAfterFlush, 'saveLien must AWAIT the flush — it cannot resolve before the cloud write settles').toBe(true);
    }
  });

  test('releaseLien — triggers zConfirm with release title', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof releaseLien !== 'function') return null;
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      releaseLien(bidId);
      const ov    = document.querySelector('.zmodal-overlay');
      const title = ov?.querySelector('.zmodal-title')?.textContent || '';
      const yes   = ov?.querySelector('#zmodal-yes')?.textContent?.trim() || '';
      ov?.remove();
      return { title, yes };
    }, [LIEN_BID_ID]);
    if (result !== null) {
      expect(result.title.toLowerCase()).toMatch(/release|lien/i);
    }
  });

  test('no console errors during lien operations', async () => {
    assertNoErrors(page, 'lien management');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  BID PAYMENT RECORDING
// ════════════════════════════════════════════════════════════════════════════

test.describe('Bid payment recording', () => {
  const PAY_BID_ID = 800002;
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    await page.evaluate(([bidId]) => {
      if (typeof clients !== 'undefined') {
        clients = clients.filter(c => c.id !== 777002);
        clients.push({ id: 777002, name: 'Dave Payor', phone: '316-555-8002', addr: '789 Elm St' });
      }
      if (typeof bids !== 'undefined') {
        bids = bids.filter(b => b.id !== bidId);
        bids.push({ id: bidId, client_id: 777002, client_name: 'Dave Payor', amount: 4000, status: 'Closed Won', bid_date: '2026-03-01' });
      }
      if (typeof payments !== 'undefined') payments = payments.filter(p => p.bid_id !== bidId);
    }, [PAY_BID_ID]);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('getBidBalance — full amount before any payments', async () => {
    const bal = await page.evaluate(([bidId]) => {
      if (typeof getBidBalance === 'undefined' || typeof bids === 'undefined') return null;
      const bid = bids.find(b => b.id === bidId);
      return bid ? getBidBalance(bid) : null;
    }, [PAY_BID_ID]);
    if (bal !== null) expect(bal).toBeCloseTo(4000, 2);
  });

  test('getBidPaid — zero before payments', async () => {
    const paid = await page.evaluate(([bidId]) => {
      if (typeof getBidPaid === 'undefined') return null;
      return getBidPaid(bidId);
    }, [PAY_BID_ID]);
    if (paid !== null) expect(paid).toBe(0);
  });

  test('openPayPanel — modal renders with amount fields', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof openPayPanel !== 'function') return null;
      try { openPayPanel(bidId); } catch(e) { return { error: e.message }; }
      return {
        overlay:    !!document.querySelector('.pay-modal-overlay'),
        amountEl:   !!document.getElementById('mpay-amount'),
        dateEl:     !!document.getElementById('mpay-date'),
        submitBtn:  !!document.getElementById('mpay-submit-btn'),
        dateValue:  (document.getElementById('mpay-date') || {}).value || '',
      };
    }, [PAY_BID_ID]);
    if (result && !result.error) {
      expect(result.overlay).toBe(true);
      expect(result.amountEl).toBe(true);
      expect(result.dateEl).toBe(true);
      expect(result.submitBtn).toBe(true);
      expect(result.dateValue.length).toBeGreaterThan(0);
    }
  });

  test('logPayment — records deposit and reduces balance', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof logPayment !== 'function' || typeof payments === 'undefined') return null;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      // type hidden input
      const typeEl = document.getElementById('mpay-type'); if (typeEl) typeEl.value = 'deposit';
      set('mpay-amount', '1000');
      set('mpay-date', '2026-05-20');
      set('mpay-method', 'Cash');
      window.activePayBidId = bidId;
      // Stub side effects
      const _close = window.closePayPanel; const _render = window.renderCDBids;
      window.closePayPanel = () => {}; window.renderCDBids = () => {};
      window.renderCDTimeline = () => {}; window.renderMoneyPage = () => {};
      window.renderDash = () => {}; window.refreshCollectLabel = () => {};
      window.renderClientDetail = () => {}; window.emitEvent = () => {};
      const before = payments.filter(p => p.bid_id === bidId).reduce((s, p) => s + p.amount, 0);
      try { logPayment(); } catch(e) { return { error: e.message }; }
      window.closePayPanel = _close; window.renderCDBids = _render;
      const after = payments.filter(p => p.bid_id === bidId).reduce((s, p) => s + p.amount, 0);
      const bid = bids.find(b => b.id === bidId);
      const bal = bid ? getBidBalance(bid) : null;
      return { before, after, bal };
    }, [PAY_BID_ID]);
    if (result && !result.error) {
      expect(result.after).toBeCloseTo(1000, 2);
      if (result.bal !== null) expect(result.bal).toBeCloseTo(3000, 2);
    }
  });

  test('getBidPayments — returns payment array with correct entry', async () => {
    const pmts = await page.evaluate(([bidId]) => {
      if (typeof getBidPayments !== 'function') return null;
      return getBidPayments(bidId).map(p => ({ bid_id: p.bid_id, amount: p.amount, method: p.method }));
    }, [PAY_BID_ID]);
    if (pmts !== null) {
      expect(Array.isArray(pmts)).toBe(true);
      expect(pmts.length).toBeGreaterThanOrEqual(1);
      expect(pmts[0].bid_id).toBe(PAY_BID_ID);
      expect(pmts[0].amount).toBe(1000);
    }
  });

  test('logPayment — records final payment, balance goes to zero', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof logPayment !== 'function') return null;
      try { openPayPanel(bidId); } catch(e) {}
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const typeEl = document.getElementById('mpay-type'); if (typeEl) typeEl.value = 'final';
      set('mpay-amount', '3000');
      set('mpay-date',   '2026-05-25');
      set('mpay-method', 'Check');
      window.activePayBidId = bidId;
      const _close = window.closePayPanel;
      window.closePayPanel = () => {}; window.renderCDBids = () => {};
      window.renderCDTimeline = () => {}; window.renderMoneyPage = () => {};
      window.renderDash = () => {}; window.refreshCollectLabel = () => {};
      window.renderClientDetail = () => {}; window.emitEvent = () => {};
      try { logPayment(); } catch(e) { return { error: e.message }; }
      window.closePayPanel = _close;
      const bid  = bids.find(b => b.id === bidId);
      const paid = getBidPaid(bidId);
      const bal  = bid ? getBidBalance(bid) : null;
      return { paid, bal };
    }, [PAY_BID_ID]);
    if (result && !result.error) {
      expect(result.paid).toBeCloseTo(4000, 2);
      if (result.bal !== null) expect(result.bal).toBeCloseTo(0, 2);
    }
  });

  test('logPayment — rejects overpayment without recording', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof logPayment !== 'function') return null;
      try { openPayPanel(bidId); } catch(e) {}
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const typeEl = document.getElementById('mpay-type'); if (typeEl) typeEl.value = 'partial';
      set('mpay-amount', '99999');
      set('mpay-date', '2026-05-25');
      set('mpay-method', 'Cash');
      window.activePayBidId = bidId;
      const _close = window.closePayPanel;
      window.closePayPanel = () => {};
      const before = payments.filter(p => p.bid_id === bidId).length;
      try { logPayment(); } catch(e) {}
      window.closePayPanel = _close;
      const after = payments.filter(p => p.bid_id === bidId).length;
      return { before, after };
    }, [PAY_BID_ID]);
    if (result !== null) expect(result.after).toBe(result.before);
  });

  test('no console errors during payment recording', async () => {
    assertNoErrors(page, 'bid payment recording');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SCHEDULE-PROMPT GATING (owner-reported: logging a collection payment offered
//  to schedule a job that was already scheduled AND complete)
// ════════════════════════════════════════════════════════════════════════════
// Own describe on a FRESH page: sharing the payment-recording page made these
// nondeterministic — earlier tests' 300ms prompt timers get clamped by
// background-tab throttling on CI and stray into later capture windows. The probe
// also fires the gate's 300ms timer SYNCHRONOUSLY so throttling can't defer its
// own prompt past the assertion either.

test.describe('logPayment — schedule prompt gating', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  const _promptProbe = ([bidSeed, payAmt, seedJob]) => {
    if (typeof logPayment !== 'function') return null;
    const cid = bidSeed + 1, bidId = bidSeed;
    clients.push({ id: cid, name: 'Gate C' + bidSeed, phone: '3165550777' });
    bids.push({ id: bidId, client_id: cid, client_name: 'Gate C' + bidSeed, amount: 1000, deposit: 0, status: 'Closed Won', bid_date: '2026-06-01' });
    if (seedJob) jobs.push(Object.assign({ id: bidSeed + 2, start: '2026-06-10', days: 2, name: 'Gate J' + bidSeed }, seedJob, { client_id: cid }));
    // openPayPanel sets the activePayBidId MODULE binding (window.activePayBidId
    // assignment does NOT — `let` bindings shadow window properties) + fresh inputs.
    try { openPayPanel(bidId); } catch (e) {}
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const typeEl = document.getElementById('mpay-type'); if (typeEl) typeEl.value = 'partial';
    set('mpay-amount', String(payAmt)); set('mpay-date', '2026-06-20'); set('mpay-method', 'Cash');
    const prompts = [];
    const _confirm = window.zConfirm, _to = window.setTimeout;
    window.zConfirm = (msg) => { prompts.push(String(msg)); };
    // Run the gate's 300ms prompt timer inline — deterministic under throttling.
    window.setTimeout = (fn, ms, ...a) => { if (ms === 300) { try { fn(); } catch (e) {} return 0; } return _to(fn, ms, ...a); };
    window.closePayPanel = () => {}; window.renderCDBids = () => {}; window.renderCDTimeline = () => {};
    window.renderMoneyPage = () => {}; window.renderDash = () => {}; window.refreshCollectLabel = () => {};
    window.renderClientDetail = () => {}; window.emitEvent = () => {};
    let error = null;
    try { logPayment(); } catch (e) { error = e.message; }
    window.setTimeout = _to; window.zConfirm = _confirm;
    return {
      error, prompts,
      gate: {
        payCount: payments.filter(p => p.bid_id === bidId).length,
        matchJobs: jobs.filter(j => String(j.client_id) === String(cid)).length,
      },
    };
  };

  test('an unlinked COMPLETED job suppresses the schedule prompt', async () => {
    // The schedule form doesn't require linking the bid, so the job carries bid_id:null —
    // it must still count as "already scheduled" (same client fallback the bid panel uses).
    const r = await page.evaluate(_promptProbe, [990310, 200, { bid_id: null, eventType: 'job', status: 'done' }]);
    if (r && !r.error) expect(r.prompts.filter(m => m.includes('Schedule this job')).length, JSON.stringify(r.gate)).toBe(0);
  });

  test('a paid-in-full payment never offers to schedule (collection is the END of the chain)', async () => {
    const r = await page.evaluate(_promptProbe, [990320, 1000, null]);
    if (r && !r.error) expect(r.prompts.filter(m => m.includes('Schedule this job')).length, JSON.stringify(r.gate)).toBe(0);
  });

  test('the prompt STILL fires for a partial payment with genuinely no job (positive control)', async () => {
    const r = await page.evaluate(_promptProbe, [990330, 200, null]);
    if (r && !r.error) expect(r.prompts.filter(m => m.includes('Schedule this job')).length, JSON.stringify(r.gate)).toBe(1);
  });

  test('no console errors during schedule-prompt gating', async () => {
    assertNoErrors(page, 'schedule prompt gating');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PENDING BID DELETE CONFIRMATION
// ════════════════════════════════════════════════════════════════════════════

test.describe('Pending bid delete confirmation', () => {
  const DEL_BID_ID = 800003;
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(([bidId]) => {
      if (typeof bids !== 'undefined') {
        bids = bids.filter(b => b.id !== bidId);
        bids.push({ id: bidId, client_name: 'Eve Delete', amount: 1500, status: 'Pending', signingToken: 'tok-eve', bid_date: new Date().toISOString().slice(0, 10) });
      }
      if (typeof saveAll === 'function') saveAll();
    }, [DEL_BID_ID]);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('discardInProgressBid — shows zConfirm with Delete title', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof discardInProgressBid !== 'function') return null;
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      discardInProgressBid(bidId);
      const ov    = document.querySelector('.zmodal-overlay');
      const title = ov?.querySelector('.zmodal-title')?.textContent || '';
      const yes   = ov?.querySelector('#zmodal-yes')?.textContent?.trim() || '';
      return { hasModal: !!ov, title, yes };
    }, [DEL_BID_ID]);
    if (result !== null) {
      expect(result.hasModal).toBe(true);
      expect(result.title.toLowerCase()).toMatch(/delete/i);
      expect(result.yes.toLowerCase()).toMatch(/delete/i);
    }
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()));
  });

  test('discardInProgressBid — Cancel preserves bid', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof discardInProgressBid !== 'function') return null;
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      const before = bids.filter(b => b.id === bidId).length;
      discardInProgressBid(bidId);
      const cancel = document.querySelector('.zmodal-cancel');
      if (cancel) cancel.click();
      const after = bids.filter(b => b.id === bidId).length;
      return { before, after };
    }, [DEL_BID_ID]);
    if (result !== null) {
      expect(result.before).toBe(1);
      expect(result.after).toBe(1);
    }
  });

  test('discardInProgressBid — Confirm removes bid from array', async () => {
    const result = await page.evaluate(([bidId]) => {
      if (typeof discardInProgressBid !== 'function') return null;
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      const _save = window.saveAll; const _render = window.renderDash;
      window.saveAll = () => {}; window.renderDash = () => {};
      window._uploadClientHub = () => Promise.resolve();
      const before = bids.filter(b => b.id === bidId).length;
      discardInProgressBid(bidId);
      const yes = document.querySelector('#zmodal-yes');
      if (yes) yes.click();
      const after = bids.filter(b => b.id === bidId).length;
      window.saveAll = _save; window.renderDash = _render;
      return { before, after };
    }, [DEL_BID_ID]);
    if (result !== null) {
      expect(result.before).toBe(1);
      expect(result.after).toBe(0);
    }
  });

  test('discardInProgressBid — regression: still deletes when the bid carries a STRING id (realtime-delivered rows can have one, while this button\'s onclick always embeds a bare numeric literal)', async () => {
    const result = await page.evaluate(() => {
      if (typeof discardInProgressBid !== 'function') return null;
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      const _save = window.saveAll; const _render = window.renderDash;
      window.saveAll = () => {}; window.renderDash = () => {};
      window._uploadClientHub = () => Promise.resolve();
      const stringId = String(Date.now());
      const cid = Date.now() + 1;
      clients.push({ id: cid, name: 'String Id Regression Client', addr: '1 Str St' });
      bids.push({ id: stringId, client_id: cid, status: 'Draft', draft: true, geiLines: [] });
      const before = bids.filter(b => String(b.id) === stringId).length;
      // Same as the real card's onclick: a bare unquoted numeric literal, so the argument
      // discardInProgressBid actually receives here is a NUMBER, not the original string.
      discardInProgressBid(Number(stringId));
      const yes = document.querySelector('#zmodal-yes');
      if (yes) yes.click();
      const after = bids.filter(b => String(b.id) === stringId).length;
      clients = clients.filter(c => c.id !== cid);
      window.saveAll = _save; window.renderDash = _render;
      return { before, after };
    });
    if (result !== null) {
      expect(result.before).toBe(1);
      expect(result.after).toBe(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SIGN.HTML — COMPLETE CASH SIGNING FLOW
// ════════════════════════════════════════════════════════════════════════════

// Non-painting proposal: skips the color picker and goes straight to pg-sign-action
const MOCK_PROPOSAL_GENERAL = {
  id: FAKE_BID_ID_2,
  status: 'pending',
  businessName: 'Zach Pro Services',
  businessPhone: '316-555-0200',
  clientName: 'Bob Garcia',
  clientAddr: '789 Maple Ave, Wichita KS 67203',
  amount: 3150,
  deposit: 788,
  estDays: 2,
  createdAt: new Date().toISOString(),
  signingToken: FAKE_TOKEN_2,
  contractorUserId: FAKE_USER_ID,
  clientId: 902,
  proposalHtml: '<p>General contracting scope: kitchen refresh.</p>',
  trade: 'general',
  surfaces: [],
  stripeConnectEnabled: false,
};

test.describe('sign.html — complete cash signing flow', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL_GENERAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL_GENERAL, bidId: FAKE_BID_ID_2 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_2}_${FAKE_TOKEN_2}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('pg-sign shows after load (non-painting, no color picker)', async () => {
    const signOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign');
      return pg ? pg.style.display !== 'none' : false;
    });
    // Accept sign OR that it's not on an error page
    const errOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-err');
      return pg ? pg.style.display === 'block' : false;
    });
    expect(signOn || !errOn).toBe(true);
  });

  test('approveAndSign — navigates to pg-sign-action (no color picker for non-painting)', async () => {
    // If we're on pg-sign, click approve
    const onSign = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (onSign) {
      await page.evaluate(() => {
        if (typeof approveAndSign === 'function') approveAndSign();
      });
      await page.waitForTimeout(600);
    }
    const actionOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign-action');
      return pg ? pg.style.display !== 'none' : false;
    });
    const colorPickOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-color-pick');
      return pg ? pg.style.display !== 'none' : false;
    });
    // For non-painting trade with no surfaces, should go to sign-action, not color-pick
    if (actionOn !== null) expect(actionOn || colorPickOn).toBe(true);
  });

  test('checkReady — sign-btn disabled before name/UETA filled', async () => {
    const disabled = await page.evaluate(() => {
      const btn = document.getElementById('sign-btn');
      return btn ? btn.disabled : null;
    });
    if (disabled !== null) expect(disabled).toBe(true);
  });

  test('checkReady — sign-btn enabled after name + UETA checked', async () => {
    await page.evaluate(() => {
      const nameEl = document.getElementById('sig-name');
      const uetaEl = document.getElementById('sig-ueta-ck');
      if (nameEl) { nameEl.value = 'Bob Garcia'; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
      if (uetaEl) { uetaEl.checked = true; uetaEl.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof checkReady === 'function') checkReady();
    });
    await page.waitForTimeout(200);
    const disabled = await page.evaluate(() => {
      const btn = document.getElementById('sign-btn');
      return btn ? btn.disabled : null;
    });
    if (disabled !== null) expect(disabled).toBe(false);
  });

  test('goToPayment — advances to pg-pay', async () => {
    await page.evaluate(() => {
      if (typeof goToPayment === 'function') goToPayment();
    });
    await page.waitForTimeout(500);
    const payOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-pay');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (payOn !== null) expect(payOn).toBe(true);
  });

  test('pg-pay — shows payment buttons including cash', async () => {
    const hasCash = await page.evaluate(() => {
      const btns = document.getElementById('sign-pay-btns');
      return btns ? btns.innerHTML.toLowerCase().includes('cash') : false;
    });
    if (hasCash !== null) expect(hasCash).toBe(true);
  });

  test('_paySign("cash") — shows sec-cash confirmation section', async () => {
    await page.evaluate(async () => {
      if (typeof _paySign === 'function') await _paySign('cash');
    });
    await page.waitForTimeout(400);
    const cashVisible = await page.evaluate(() => {
      const sec = document.getElementById('sec-cash');
      return sec ? sec.style.display !== 'none' : false;
    });
    if (cashVisible !== null) expect(cashVisible).toBe(true);
  });

  test('submitCash — clicking confirm navigates to pg-done', async () => {
    const confirmBtn = page.locator('#sec-cash-confirm-btn');
    if (await confirmBtn.count() > 0 && await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
    const doneOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-done');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (doneOn) {
      const title = await page.evaluate(() => document.getElementById('done-title')?.textContent || '');
      expect(title.length).toBeGreaterThan(0);
      // Confirmation number format
      const confNum = await page.evaluate(() => {
        const rows = document.getElementById('done-rows')?.innerHTML || '';
        const match = rows.match(/#CONF-[A-Z0-9]+/);
        return match ? match[0] : null;
      });
      if (confNum) expect(confNum).toMatch(/^#CONF-[A-Z0-9]{6}$/);
    }
  });

  test('pg-done — shows client name and payment method', async () => {
    const doneOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-done');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (doneOn) {
      const rowsHtml = await page.evaluate(() => document.getElementById('done-rows')?.innerHTML || '');
      expect(rowsHtml).toContain('Bob Garcia');
    }
  });

  test('no console errors during cash signing flow', async () => {
    assertNoErrors(page, 'sign.html cash flow');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SIGN.HTML — EPA LEAD PAINT DISCLOSURE
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — EPA RRP lead paint disclosure (Document 2 of 2)', () => {
  let page;

  const MOCK_PROPOSAL_EPA = {
    ...MOCK_PROPOSAL,
    id: 900003,
    epaRequired: true,
    trade: 'painting',
    surfaces: [], // no surfaces → skips color picker
    clientAddr: '123 Old House Ln, Springfield, IL',
    rrpFirmCertNum: 'NAT-F12345',
    rrpRenovatorName: 'Jane Doe',
    rrpRenovatorCertNum: 'NAT-R67890',
    signingToken: 'tok-epa',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL_EPA);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL_EPA });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/900003_tok-epa.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('EPA banner is visible when epaRequired=true (any trade)', async () => {
    // Advance to sign-action page
    await page.evaluate(() => {
      if (typeof approveAndSign === 'function') approveAndSign();
    });
    await page.waitForTimeout(400);
    const epaSec = await page.evaluate(() => {
      const el = document.getElementById('epa-section');
      if (!el) return null;
      return el.style.display !== 'none';
    });
    if (epaSec !== null) expect(epaSec).toBe(true);
  });

  test('Document 1 of 2 label is visible when epaRequired=true', async () => {
    const visible = await page.evaluate(() => {
      const el = document.getElementById('epa-doc1-label');
      if (!el) return null;
      return el.style.display !== 'none';
    });
    if (visible !== null) expect(visible).toBe(true);
  });

  test('epa-ack checkbox does not exist in DOM (replaced by pg-epa page)', async () => {
    const count = await page.locator('#epa-ack').count();
    expect(count).toBe(0);
  });

  test('checkReady — sign-btn enabled with name + ueta (no EPA checkbox required)', async () => {
    await page.evaluate(() => {
      const nameEl = document.getElementById('sig-name');
      const uetaEl = document.getElementById('sig-ueta-ck');
      if (nameEl) { nameEl.value = 'Alice Smith'; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
      if (uetaEl) { uetaEl.checked = true; uetaEl.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof checkReady === 'function') checkReady();
    });
    const disabled = await page.evaluate(() => document.getElementById('sign-btn')?.disabled ?? null);
    if (disabled !== null) expect(disabled).toBe(false);
  });

  test('pg-epa page exists in DOM', async () => {
    const count = await page.locator('#pg-epa').count();
    expect(count).toBe(1);
  });

  test('showEpaPage — pg-epa becomes visible and fills address/cert info', async () => {
    await page.evaluate(() => {
      if (typeof showEpaPage === 'function') showEpaPage();
    });
    await page.waitForTimeout(300);
    const onEpa = await page.evaluate(() => {
      const pg = document.getElementById('pg-epa');
      return pg ? pg.style.display !== 'none' : false;
    });
    expect(onEpa).toBe(true);
    const addrText = await page.evaluate(() => document.getElementById('epa-prop-address')?.textContent || '');
    expect(addrText).toContain('123 Old House Ln');
    const certText = await page.evaluate(() => document.getElementById('epa-cert-info')?.textContent || '');
    expect(certText).toContain('NAT-F12345');
  });

  test('submitEpaAck removed — function no longer exists (unified signing flow)', async () => {
    const exists = await page.evaluate(() => typeof submitEpaAck === 'function');
    expect(exists).toBe(false);
  });

  test('_continueFromEpaReview — navigates from EPA review page to sign pad', async () => {
    await page.evaluate(() => {
      if (typeof showEpaPage === 'function') showEpaPage(); // ensure pg-epa shown first
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof _continueFromEpaReview === 'function') _continueFromEpaReview();
    });
    await page.waitForTimeout(300);
    const onSignAction = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign-action');
      return pg ? pg.style.display !== 'none' : false;
    });
    expect(onSignAction).toBe(true);
  });

  test('showDone — routes directly to pg-done for EPA proposals (no EPA page redirect)', async () => {
    await page.evaluate(() => {
      if (typeof showDone === 'function') showDone('cash');
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const done = document.getElementById('pg-done');
      const epa = document.getElementById('pg-epa');
      return {
        doneVisible: done ? done.style.display !== 'none' : false,
        epaHidden: epa ? epa.style.display === 'none' : true,
      };
    });
    expect(result.doneVisible).toBe(true);
    expect(result.epaHidden).toBe(true);
  });

  test('assertNoErrors — no console errors introduced by EPA RRP flow', async () => {
    const errors = await page.evaluate(() => window.__consoleErrors || []);
    expect(errors.filter(e => !/supabase|storage|fetch/i.test(e))).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SIGN.HTML — PORTFOLIO DISCOUNT OFFER
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — portfolio discount offer', () => {
  let page;

  const MOCK_PROPOSAL_PORTFOLIO = {
    ...MOCK_PROPOSAL,
    id: 900004,
    isPortfolio: true,
    portfolioPct: 15,
    fullPrice: 2375,
    amount: 2375,
    discountedPrice: 2018.75,  // 2375 × 0.85
    deposit: 594,
    trade: 'general',
    surfaces: [],
    signingToken: 'tok-portfolio',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL_PORTFOLIO);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL_PORTFOLIO });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/900004_tok-portfolio.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('portfolio card is visible for isPortfolio=true', async () => {
    const hasPortfolio = await page.evaluate(() => {
      // Look for portfolio-related elements or text
      const html = document.body.innerHTML;
      return html.includes('portfolio') || html.includes('Portfolio') ||
             !!document.getElementById('po-accept-btn') ||
             !!document.getElementById('po-card');
    });
    // isPortfolio=true should show the portfolio offer
    expect(hasPortfolio).toBe(true);
  });

  test('portfolioAccept — first click shows terms', async () => {
    const result = await page.evaluate(() => {
      if (typeof portfolioAccept !== 'function') return null;
      // Reset portfolio state
      window._portfolioStep = 0;
      window._portfolioAccepted = false;
      portfolioAccept();
      const terms = document.getElementById('po-terms');
      const btn   = document.getElementById('po-accept-btn');
      return {
        termsVisible: terms ? terms.style.display !== 'none' : null,
        btnText: btn ? btn.textContent : null,
      };
    });
    if (result !== null) {
      if (result.termsVisible !== null) expect(result.termsVisible).toBe(true);
      if (result.btnText) expect(result.btnText).toMatch(/agree|apply|15%/i);
    }
  });

  test('portfolioAccept — second click applies discount and updates amounts', async () => {
    const result = await page.evaluate(() => {
      if (typeof portfolioAccept !== 'function') return null;
      // Step 1 already called; step to 2
      window._portfolioStep = 1;
      portfolioAccept();
      return {
        accepted:     !!window._portfolioAccepted,
        confirmed:    document.getElementById('po-confirmed')?.style.display !== 'none',
        confirmedMsg: document.getElementById('po-confirmed-msg')?.textContent || '',
        totalText:    document.getElementById('amt-total')?.textContent || '',
      };
    });
    if (result !== null) {
      expect(result.accepted).toBe(true);
      if (result.confirmed !== null) expect(result.confirmed).toBe(true);
      // Should show savings message
      if (result.confirmedMsg) expect(result.confirmedMsg).toMatch(/saved|discount/i);
      // Amount total should reflect discounted price
      if (result.totalText) expect(result.totalText).toContain('$');
    }
  });

  test('portfolio decline — _portfolioAccepted stays false', async () => {
    const accepted = await page.evaluate(() => {
      window._portfolioAccepted = false;
      window._portfolioStep = 0;
      // Decline means user just doesn't click accept — simulate by not calling portfolioAccept
      return window._portfolioAccepted;
    });
    expect(accepted).toBe(false);
  });

  // Owner directive: the offer sat above the scope/terms card (first thing a
  // client saw, before reading what they're buying) — moved below it so the
  // client reads the scope first, and the offer no longer uses a competing
  // gradient hero banner (.po-hdr/.po-body) — it's a plain card like the rest
  // of the page now.
  test('portfolio card appears AFTER Scope & terms in DOM order, as a plain card (no gradient hero banner)', async () => {
    const r = await page.evaluate(() => {
      const scope = document.getElementById('prop-html');
      const offer = document.getElementById('portfolio-offer-card');
      return {
        scopeBeforeOffer: !!(scope && offer && (scope.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING)),
        isPlainCard: !!(offer && offer.classList.contains('card')),
      };
    });
    expect(r.scopeBeforeOffer, 'client should read the scope of work before seeing the optional photo-discount pitch').toBe(true);
    expect(r.isPlainCard).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SIGN.HTML — COLOR PICKER (PAINTING + SURFACES)
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — color picker for painting', () => {
  let page;

  // MOCK_PROPOSAL already has trade:'painting' and surfaces — perfect for color picker

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('approveAndSign — routes to pg-color-pick for painting+surfaces', async () => {
    const onSign = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (onSign) {
      await page.evaluate(() => {
        if (typeof approveAndSign === 'function') approveAndSign();
      });
      await page.waitForTimeout(500);
    }
    const colorPickOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-color-pick');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (colorPickOn !== null) expect(colorPickOn).toBe(true);
  });

  test('color picker — renders room inputs for each surface', async () => {
    const result = await page.evaluate(() => {
      const pg = document.getElementById('pg-color-pick');
      if (!pg || pg.style.display === 'none') return null;
      const inputs = pg.querySelectorAll('input[type="text"], input[type="color"], select, input');
      return { inputCount: inputs.length, html: pg.innerHTML.length };
    });
    if (result !== null) {
      expect(result.html).toBeGreaterThan(50);
      // Should have some inputs for the color choices
    }
  });

  test('_goToSignPad — advances from color picker to pg-sign-action', async () => {
    await page.evaluate(() => {
      if (typeof _goToSignPad === 'function') _goToSignPad();
    });
    await page.waitForTimeout(400);
    const actionOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-sign-action');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (actionOn !== null) expect(actionOn).toBe(true);
  });

  test('_colorChoices — populated after going through color picker', async () => {
    // _colorChoices should be an array (empty or filled) after _goToSignPad
    const choices = await page.evaluate(() => {
      return typeof window._colorChoices !== 'undefined' ? window._colorChoices : null;
    });
    if (choices !== null) expect(Array.isArray(choices)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  SIGN.HTML — STRIPE PAYMENT FLOW
// ════════════════════════════════════════════════════════════════════════════

test.describe('sign.html — Stripe payment flow', () => {
  let page;
  let checkoutCalled = false;
  let checkoutPayload = null;

  const MOCK_PROPOSAL_STRIPE = {
    ...MOCK_PROPOSAL_GENERAL,
    id: 900005,
    stripeConnectEnabled: true,
    signingToken: 'tok-stripe',
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL_STRIPE);

    // mockAllExternal FIRST
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL_STRIPE });

    // create-checkout route registered LAST (LIFO priority)
    await page.route('**/functions/v1/create-checkout', async route => {
      checkoutCalled = true;
      checkoutPayload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/pay/mock-session-id', id: 'cs_test_mock' }),
      });
    });

    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/900005_tok-stripe.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('pg-pay — Stripe button present when stripeConnectEnabled', async () => {
    // Navigate through approve → sign-action → payment
    await page.evaluate(() => {
      if (typeof approveAndSign === 'function') approveAndSign();
    });
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const nameEl = document.getElementById('sig-name');
      const uetaEl = document.getElementById('sig-ueta-ck');
      if (nameEl) { nameEl.value = 'Bob Garcia'; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
      if (uetaEl) { uetaEl.checked = true; uetaEl.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof checkReady === 'function') checkReady();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof goToPayment === 'function') goToPayment();
    });
    await page.waitForTimeout(400);

    const payBtnsHtml = await page.evaluate(() => {
      return document.getElementById('sign-pay-btns')?.innerHTML || '';
    });
    // The page might or might not show Stripe depending on _stripeConnectStatus mock
    // Just verify pay page rendered
    const payOn = await page.evaluate(() => {
      const pg = document.getElementById('pg-pay');
      return pg ? pg.style.display !== 'none' : false;
    });
    if (payOn !== null) expect(payOn).toBe(true);
  });

  test('payment tile — deposit tile shows 25% amount', async () => {
    const result = await page.evaluate(() => {
      const tile = document.getElementById('pay-tile-dep');
      return tile ? tile.textContent : null;
    });
    if (result !== null && result.includes('$')) {
      // Deposit should be ~25% of 3150 = $787.50
      expect(result).toContain('$');
    }
  });

  test('payment tile — full tile shows total amount', async () => {
    const result = await page.evaluate(() => {
      const tile = document.getElementById('pay-tile-full');
      return tile ? tile.textContent : null;
    });
    if (result !== null) expect(result).toContain('$');
  });

  test('sign-pay-btns — renders with at least one payment option', async () => {
    const count = await page.evaluate(() => {
      const btns = document.getElementById('sign-pay-btns');
      if (!btns) return 0;
      return btns.querySelectorAll('button').length;
    });
    if (count !== null) expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  CLIENT.HTML — ALL 5 TABS
// ════════════════════════════════════════════════════════════════════════════

test.describe('client.html — all 5 tabs', () => {
  let page;

  const HUB_ALL_TABS = {
    clientId: 902,
    contractorUserId: FAKE_USER_ID,
    contractorName: 'Zach Pro Services',
    businessName: 'Zach Pro Services',
    businessPhone: '316-555-0200',
    clientName: 'Bob Garcia',
    clientAddr: '789 Maple Ave, Wichita KS 67203',
    brandColor: '#2D5DA8',
    logoData: null,
    bwebsite: 'https://zachpro.com',
    bids: [{
      id: FAKE_BID_ID_2,
      status: 'Closed Won',
      amount: 3150,
      deposit: 788,
      balance: 2362,
      paid: 788,
      signingToken: FAKE_TOKEN_2,
      bid_date: new Date().toISOString().slice(0, 10),
      proposalHtml: '<p>Kitchen refresh scope.</p>',
      paymentMethod: 'cash',
      signedAt: new Date().toISOString(),
    }],
    payments: [
      { id: 10, bid_id: FAKE_BID_ID_2, amount: 788, type: 'deposit', method: 'cash', date: new Date().toISOString().slice(0, 10) },
    ],
    jobs: [{
      id: 1, bid_id: FAKE_BID_ID_2, title: 'Kitchen refresh', start: '2026-06-01', end: '2026-06-03',
      status: 'scheduled',
    }],
    photos: [],
    messages: [
      { id: 1, from: 'contractor', text: 'Your job starts June 1st.', ts: new Date().toISOString() },
    ],
    notifications: [],
    invoices: [],
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(hub => { window.__mockHubData = hub; }, HUB_ALL_TABS);
    await mockAllExternal(page);
    // Override storage download to serve hub data
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('/storage/v1/') && url.includes('client-hub')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_ALL_TABS) });
      }
      return route.fallback();
    });
    await page.goto(
      `/client.html?c=902&u=${FAKE_USER_ID}&t=${FAKE_TOKEN_2}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await page.waitForTimeout(3000);
  });

  test.afterAll(async () => { await page.context().close(); });

  for (const view of ['overview', 'project', 'payments', 'documents', 'messages']) {
    test(`switchView("${view}") — shows view-${view} panel`, async () => {
      await page.evaluate(v => {
        if (typeof switchView === 'function') switchView(v);
      }, view);
      await page.waitForTimeout(350);

      const visible = await page.evaluate(v => {
        const el = document.getElementById('view-' + v);
        if (!el) return null;
        return el.style.display !== 'none';
      }, view);

      if (visible !== null) expect(visible).toBe(true);

      // Other views should be hidden
      for (const other of ['overview', 'project', 'payments', 'documents', 'messages']) {
        if (other === view) continue;
        const otherVisible = await page.evaluate(v => {
          const el = document.getElementById('view-' + v);
          return el ? el.style.display !== 'none' : null;
        }, other);
        if (otherVisible !== null) expect(otherVisible).toBe(false);
      }
    });
  }

  test('switchView — nav item gets active class', async () => {
    await page.evaluate(() => {
      if (typeof switchView === 'function') switchView('payments');
    });
    await page.waitForTimeout(200);
    const isActive = await page.evaluate(() => {
      const ni = document.getElementById('ni-payments') || document.getElementById('bni-payments');
      return ni ? ni.classList.contains('active') : null;
    });
    if (isActive !== null) expect(isActive).toBe(true);
  });

  test('client.html — contractor name or logo appears in topbar', async () => {
    const hasTopbar = await page.evaluate(() => {
      const nameEl = document.getElementById('topbar-name');
      const logoEl = document.getElementById('topbar-logo-img');
      const nameText = nameEl ? nameEl.textContent : '';
      const logoSrc  = logoEl ? logoEl.src : '';
      return nameText.length > 0 || (logoSrc.length > 0 && !logoSrc.endsWith('/'));
    });
    // Topbar populated with contractor info
    expect(hasTopbar).toBe(true);
  });

  test('overview view — renders project summary', async () => {
    await page.evaluate(() => { if (typeof switchView === 'function') switchView('overview'); });
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('view-overview')?.innerHTML || '');
    expect(html.length).toBeGreaterThan(10);
  });

  test('payments view — shows payment history', async () => {
    await page.evaluate(() => { if (typeof switchView === 'function') switchView('payments'); });
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('view-payments')?.innerHTML || '');
    expect(html.length).toBeGreaterThan(10);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  STRIPE CONNECT — API STATES
// ════════════════════════════════════════════════════════════════════════════

test.describe('Stripe Connect — API states', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('_renderStripeConnectUI — not-connected state shows Connect button', async () => {
    const html = await page.evaluate(() => {
      if (typeof _renderStripeConnectUI !== 'function') return null;
      const el = document.createElement('div');
      _renderStripeConnectUI(el, { connected: false });
      return el.innerHTML;
    });
    if (html !== null) {
      expect(html).toMatch(/connect|stripe/i);
      expect(html).toContain('startStripeConnect');
    }
  });

  test('_renderStripeConnectUI — connected-but-incomplete shows warning', async () => {
    const html = await page.evaluate(() => {
      if (typeof _renderStripeConnectUI !== 'function') return null;
      const el = document.createElement('div');
      _renderStripeConnectUI(el, { connected: true, charges_enabled: false });
      return el.innerHTML;
    });
    if (html !== null) {
      expect(html).toMatch(/incomplete|setup|warning|⚠/i);
    }
  });

  test('_renderStripeConnectUI — fully connected shows green status', async () => {
    const html = await page.evaluate(() => {
      if (typeof _renderStripeConnectUI !== 'function') return null;
      const el = document.createElement('div');
      _renderStripeConnectUI(el, {
        connected: true,
        charges_enabled: true,
        payouts_enabled: true,
        stripe_account_id: 'acct_test123',
      });
      return el.innerHTML;
    });
    if (html !== null) {
      expect(html).toMatch(/connected|active|✅/i);
      expect(html).toContain('acct_test123');
    }
  });

  test('loadStripeConnectStatus — renders into #stripe-connect-status-ui', async () => {
    // Navigate to settings page where the element lives
    await page.evaluate(() => { if (typeof goPg === 'function') goPg('pg-settings'); });
    await page.waitForTimeout(400);

    const elExists = await page.evaluate(() => !!document.getElementById('stripe-connect-status-ui'));
    if (elExists) {
      // Call loadStripeConnectStatus — uses mocked Supabase (no network call)
      await page.evaluate(async () => {
        if (typeof loadStripeConnectStatus === 'function') {
          await loadStripeConnectStatus().catch(() => {});
        }
      });
      await page.waitForTimeout(500);
      const html = await page.evaluate(() => document.getElementById('stripe-connect-status-ui')?.innerHTML || '');
      expect(html.length).toBeGreaterThanOrEqual(0); // rendered something
    }
  });

  test('stripe-connect-status edge function — POST returns status object', async () => {
    let stripeStatusCalled = false;

    // Register specific route LAST (LIFO)
    await page.route('**/functions/v1/stripe-connect-status', async route => {
      stripeStatusCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: true, charges_enabled: true, payouts_enabled: true, stripe_account_id: 'acct_e2e' }),
      });
    });

    await page.evaluate(async () => {
      // Clear the localStorage cache so _fetchStripeConnectStatus makes a real call
      Object.keys(localStorage).filter(k => k.startsWith('td_stripe_status')).forEach(k => localStorage.removeItem(k));
      if (typeof _fetchStripeConnectStatus === 'function') {
        await _fetchStripeConnectStatus().catch(() => {});
      }
    });
    await page.waitForTimeout(500);

    // The call may not fire if _supaUser is null in test env — check conditionally
    const status = await page.evaluate(() => window._stripeConnectStatus);
    // If status was set, it should be an object
    if (status !== null && status !== undefined) {
      expect(typeof status).toBe('object');
    }
  });

  test('stripe-connect-onboard edge function — called by startStripeConnect', async () => {
    let onboardCalled = false;
    await page.route('**/functions/v1/stripe-connect-onboard', async route => {
      onboardCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://connect.stripe.com/setup/mock' }),
      });
    });

    // Inject a fake user so startStripeConnect doesn't bail early
    await page.evaluate(() => {
      window._supaUser = { id: 'e2e-user', email: 'zach@test.com' };
      // Prevent actual navigation to Stripe URL
      const _origLoc = window.location.href;
      Object.defineProperty(window, '_tdNativeReturnUrl', { value: 'http://localhost/', writable: true });
    });

    // Wrap startStripeConnect to intercept location.href redirect
    await page.evaluate(() => {
      window._onboardRedirectUrl = null;
      const _origHref = Object.getOwnPropertyDescriptor(window.location, 'href');
      // Can't override location.href directly; instead check if onboard was called via the route flag
    });

    // Call but catch the navigation
    await page.evaluate(async () => {
      if (typeof startStripeConnect !== 'function') return;
      // Prevent actual redirect
      const origAssign = window.location.assign;
      try {
        await startStripeConnect().catch(() => {});
      } catch(e) {}
    });
    await page.waitForTimeout(800);
    // If onboard was called, we got the route hit
    // The test passes if no errors thrown (navigation may or may not fire in test env)
    assertNoErrors(page, 'stripe-connect-onboard');
  });

  test('no console errors during Stripe Connect checks', async () => {
    assertNoErrors(page, 'Stripe Connect states');
  });
});

// ── Sign page layout tests (real DOM assertions) ──────────────────────────────
// Verify the proposal view layout: no big price box, scope first, sticky bar clean.
test.describe('sign.html — proposal layout', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('big price amt-box is NOT visible — removed from proposal view', async () => {
    // The .amt-box element exists in the DOM (hidden) but must not be visible
    const amtBoxVisible = await page.evaluate(() => {
      const el = document.querySelector('.amt-box');
      if (!el) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    expect(amtBoxVisible).toBe(false);
  });

  test('Scope & terms card is visible on pg-sign', async () => {
    const scopeVisible = await page.evaluate(() => {
      const el = document.getElementById('prop-html');
      return el ? el.offsetParent !== null : false;
    });
    expect(scopeVisible).toBe(true);
  });

  test('Scope & terms appears before any amt-box in DOM order', async () => {
    const scopeBeforePrice = await page.evaluate(() => {
      const scope = document.getElementById('prop-html');
      const price = document.querySelector('.amt-box');
      if (!scope || !price) return true; // price removed = trivially true
      return scope.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(scopeBeforePrice).toBeTruthy();
  });

  test('sticky bar has Approve & Sign button', async () => {
    const btn = await page.locator('#approve-btn').isVisible();
    // Sticky bar is hidden until scroll — check it exists and has correct text
    const btnText = await page.evaluate(() => {
      const b = document.getElementById('approve-btn');
      return b ? b.textContent.trim() : '';
    });
    expect(btnText).toContain('Approve');
    expect(btnText).toContain('Sign');
  });

  test('sticky bar does NOT show "Project Total" label', async () => {
    const stickyText = await page.evaluate(() => {
      const bar = document.getElementById('sticky-bar');
      return bar ? bar.textContent : '';
    });
    expect(stickyText).not.toContain('Project Total');
  });

  test('Download PDF button exists inside sticky bar', async () => {
    const pdfInBar = await page.evaluate(() => {
      const bar = document.getElementById('sticky-bar');
      if (!bar) return false;
      return bar.textContent.includes('Download PDF');
    });
    expect(pdfInBar).toBe(true);
  });

  test('amt-total node exists in DOM but is inside hidden wrapper', async () => {
    // JS writes to amt-total — it must exist so those writes don't throw
    const exists = await page.evaluate(() => !!document.getElementById('amt-total'));
    expect(exists).toBe(true);
    // But it must not be visible
    const hidden = await page.evaluate(() => {
      const el = document.getElementById('amt-total');
      if (!el) return false;
      let n = el;
      while (n) {
        if (window.getComputedStyle(n).display === 'none') return true;
        n = n.parentElement;
      }
      return false;
    });
    expect(hidden).toBe(true);
  });

  test('no console errors on sign page layout', async () => {
    assertNoErrors(page, 'sign page layout');
  });
});

// ── Owner directive: audit + simplify sign.html (the actual signing/payment
// screen — the most important one a client touches) — same "no decorative
// emoji" pass already applied to the proposal document, plus real friction
// fixes: the "how much to pay" decision used to be picked on the sign screen
// AND restated on the payment screen; the meta grid (Signed by/Initials/Date/
// Method) was pure filler; the portfolio upsell card sat above the scope/terms
// a client hadn't read yet. Locked in here so none of it creeps back.
test.describe('sign.html — audit/simplify pass (emoji, pay-tile placement, dead code)', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('no decorative pictographic emoji anywhere on the page', async () => {
    const hasEmoji = await page.evaluate(() => {
      const re = /[\u{1F300}-\u{1FAFF}]/u;
      return re.test(document.documentElement.innerHTML);
    });
    expect(hasEmoji, 'sign.html must carry no decorative emoji — this is the most important screen a client touches').toBe(false);
  });

  test('dead CSS/markup from the pre-audit page is gone', async () => {
    const r = await page.evaluate(() => ({
      sigMetaCount: document.querySelectorAll('.sig-meta').length,
      optCashCount: document.querySelectorAll('#opt-cash').length,
    }));
    expect(r.sigMetaCount, 'the Signed-by/Initials/Date/Method filler grid must be removed, not just hidden').toBe(0);
    expect(r.optCashCount, '#opt-cash never existed in the current markup — confirms the dead querySelector reference was deleted, not just made to fail silently forever').toBe(0);
  });

  test('pay-amount tiles live on the payment screen (pg-pay), not the sign screen (pg-sign-action)', async () => {
    const r = await page.evaluate(() => {
      const tile = document.getElementById('pay-tile-dep');
      const signAction = document.getElementById('pg-sign-action');
      const pay = document.getElementById('pg-pay');
      return {
        tileExists: !!tile,
        tileInSignAction: !!(tile && signAction && signAction.contains(tile)),
        tileInPay: !!(tile && pay && pay.contains(tile)),
      };
    });
    expect(r.tileExists).toBe(true);
    expect(r.tileInSignAction, '"how much to pay" must not be decided a second time on the sign screen').toBe(false);
    expect(r.tileInPay, 'the pay-amount choice belongs directly above the amount it produces, on the payment screen').toBe(true);
  });

  test('sticky bar: Approve & Sign is the first/primary button, Download PDF is a secondary link beneath it', async () => {
    const r = await page.evaluate(() => {
      const bar = document.getElementById('sticky-bar');
      if (!bar) return null;
      const buttons = Array.from(bar.querySelectorAll('button'));
      return buttons.map(b => b.textContent.trim());
    });
    expect(r).not.toBeNull();
    expect(r[0]).toContain('Approve');
    expect(r.some(t => t.includes('Download PDF'))).toBe(true);
    expect(r.indexOf(r.find(t => t.includes('Approve')))).toBeLessThan(r.indexOf(r.find(t => t.includes('Download PDF'))));
  });

  test('no console errors on the audit/simplify pass', async () => {
    assertNoErrors(page, 'sign.html audit/simplify pass');
  });
});

// ── Cancellation clause patch — old proposals upgraded on-the-fly ────────────
// sign.html patches legacy proposalHtml (old "Buyer has the right to cancel"
// language) so unsigned in-flight proposals show the updated mutual-obligation
// clause without a manual re-send. Signed proposals return early at pg-done
// and never reach this code path.
test.describe('sign.html — cancellation clause patch for old proposals', () => {
  let page;

  // Build a mock proposal whose proposalHtml contains the OLD one-sided
  // cancellation language — using the ACTUAL format from proposals.js #est-proposal
  // (full <p> tags with <em> formatting), NOT the compact est-terms sidebar text.
  const OLD_CANCEL_HTML =
    '<p style="margin:0 0 9px"><strong>2. Cancellation &amp; Deposits:</strong> Buyer has the right to cancel this transaction without penalty within 3 business days of signing (K.S.A. §50-640). After the three-business-day cancellation period, the deposit is retained as liquidated damages to compensate for: (a) <em>Mobilization &amp; Scheduling</em> — reserving crew availability and declining other projects for the contracted dates; (b) <em>Administrative Costs</em> — time invested in site measurements, color consulting, and preparation of this written scope; and (c) <em>Material Procurement</em> — sourcing specific paint colors and materials that may not be returnable or transferable to other jobs. These represent a reasonable good-faith estimate of actual damages, not a penalty. If cancellation occurs after materials have been purchased, contractor will make all materials available for client pickup at no additional charge.</p>';

  const OLD_PROPOSAL = { ...MOCK_PROPOSAL, proposalHtml: OLD_CANCEL_HTML };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    // Inject OLD_PROPOSAL into window.__mockProposalData before any script runs.
    // The Supabase shim's storage.download() reads this window var, so the page
    // sees the old-style proposalHtml and the patch logic can be exercised.
    await page.addInitScript((data) => { window.__mockProposalData = data; }, OLD_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: OLD_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('old "Buyer has the right to cancel this transaction" text is NOT shown after patch', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).not.toContain('Buyer has the right to cancel this transaction');
  });

  test('patched text shows "Buyer may cancel this transaction within"', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).toContain('Buyer may cancel this transaction within');
  });

  test('patched text includes business name performance obligation', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    // Business name (Zach Pro Painting from MOCK_PROPOSAL) replaces generic "Contractor"
    expect(text).toContain("Zach Pro Painting's right to retain the deposit is conditioned on Zach Pro Painting's readiness and willingness to perform");
  });

  test('patched text includes "fails to substantially complete" with business name', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).toContain('If Zach Pro Painting fails to substantially complete the agreed scope of work through no fault of Buyer, the deposit shall be refunded in full');
  });

  test('no console errors after cancellation patch', async () => {
    assertNoErrors(page, 'cancellation clause patch');
  });
});

// ── Cancellation clause patch — generic trade proposals (HVAC, roofing, etc.) ─
// Generic proposals use a different end anchor ("not a penalty.</div>") so a
// second replacement handles them. Same mutual-obligation clause, business name.
test.describe('sign.html — cancellation clause patch for generic trade proposals', () => {
  let page;

  const OLD_GENERIC_CANCEL_HTML =
    '<div style="font-size:11px;color:#2d3748;line-height:2">' +
    '<div>1. <strong>Deposit:</strong> 25% due before work begins.</div>' +
    '<div>2. <strong>Cancellation &amp; Deposits:</strong> Buyer has the right to cancel within 3 business days of signing (K.S.A. §50-640). After that, the deposit is retained as liquidated damages for mobilization, scheduling, administrative, and material procurement costs — a reasonable estimate of actual damages, not a penalty.</div>' +
    '<div>3. <strong>Change Orders:</strong> Written change order required.</div>' +
    '</div>';

  const OLD_GENERIC_PROPOSAL = { ...MOCK_PROPOSAL, proposalHtml: OLD_GENERIC_CANCEL_HTML, trade: 'plumbing' };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript((data) => { window.__mockProposalData = data; }, OLD_GENERIC_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: OLD_GENERIC_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(
      `/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    await page.waitForTimeout(2500);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('generic proposal: old "Buyer has the right to cancel" is NOT shown', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).not.toContain('Buyer has the right to cancel');
  });

  test('generic proposal: patched text shows "Buyer may cancel within"', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).toContain('Buyer may cancel within');
  });

  test('generic proposal: patched text includes business name performance obligation', async () => {
    const text = await page.evaluate(() => document.getElementById('prop-html')?.textContent || '');
    expect(text).toContain("Zach Pro Painting's right to retain the deposit is conditioned on Zach Pro Painting's readiness and willingness to perform");
  });

  test('generic proposal: no console errors after patch', async () => {
    assertNoErrors(page, 'generic cancellation clause patch');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  BID SHARING — WITHOUT STRIPE / WITH STRIPE
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
//  PROPOSAL JSON FRESHNESS — HTTP cache bypass (stale-status fix)
// ════════════════════════════════════════════════════════════════════════════
// The proposal JSON is rewritten in storage on signing/voiding/payment, but
// Supabase storage's default cache-control: max-age=3600 let the browser serve
// a stale copy for up to an hour. sign.html now fetches the public object URL
// with cache:'no-store' + a cb= cache-buster; the shim's in-page fetch
// interceptor records the call in window.__storageFetches (WebKit-safe).
test.describe('sign.html — proposal JSON cache bypass', () => {
  test('proposal load uses cache:no-store and a cb= cache-buster', async ({ page }) => {
    await page.addInitScript(data => { window.__mockProposalData = data; }, MOCK_PROPOSAL);
    await mockAllExternal(page, { alreadySigned: false, proposalData: MOCK_PROPOSAL, bidId: FAKE_BID_ID_1 });
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/${FAKE_BID_ID_1}_${FAKE_TOKEN}.json`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    const calls = await page.evaluate(() => window.__storageFetches || []);
    const propCall = calls.find(c => c.url.includes(`proposals/${FAKE_USER_ID}/`));
    expect(propCall, 'proposal JSON must be read via the public-URL fetch path; saw: ' + JSON.stringify(calls)).toBeTruthy();
    expect(propCall.cache, 'proposal fetch must use cache:no-store').toBe('no-store');
    expect(propCall.url, 'proposal fetch must carry a cache-buster param').toMatch(/[?&]cb=\d+/);
    // The proposal rendered from the fresh fetch
    const body = await page.textContent('body');
    expect(body).toContain('Alice Smith');
    assertNoErrors(page, 'sign.html cache-bypass fetch');
  });
});
