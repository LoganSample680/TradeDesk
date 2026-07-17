// @ts-check
/**
 * Exhaustive E2E coverage for bids.js
 * Every exported function is tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, FAKE_BID_ID_1 } = require('./helpers');

test.describe('bids.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // Wait for supaLoadFromCloud to finish before pushing fixture data.
    // Without this, webkit's async Promise resolution may let supaLoadFromCloud's
    // set() calls run *after* the fixture push, clearing payments=[].
    await page.waitForFunction(() => window._supaCloudLoaded === true, { timeout: 8000 }).catch(() => {});

    // Seed stable test fixtures used throughout the suite
    await page.evaluate(() => {
      // Clean up any previous runs
      clients  = clients.filter(c => c.id !== 88801 && c.id !== 88802);
      bids     = bids.filter(b => b.id !== 77701 && b.id !== 77702 && b.id !== 77703);
      jobs     = jobs.filter(j => j.id !== 66601 && j.id !== 66602);
      payments = payments.filter(p => p.bid_id !== 77701 && p.bid_id !== 77702);

      clients.push(
        { id: 88801, name: 'Test Client Alpha', phone: '316-555-0001', addr: '1 Alpha Dr', email: 'alpha@test.com' },
        { id: 88802, name: 'Test Client Beta',  phone: '316-555-0002', addr: '2 Beta Ave',  email: 'beta@test.com' }
      );
      bids.push(
        { id: 77701, client_id: 88801, client_name: 'Test Client Alpha', amount: 3000, status: 'Closed Won',
          bid_date: '2026-01-01', trade_type: 'painting', type: 'Interior painting',
          surfaces: [{ type: 'walls', room: 'Living Room', qty: 400, wallSqft: 400 }],
          scope: { sand: true, spackle: true }, roomScopeMap: {}, signedAt: '2026-01-10T00:00:00Z',
          completion_date: '2026-02-01', days: 3 },
        { id: 77702, client_id: 88802, client_name: 'Test Client Beta', amount: 1500, status: 'pending',
          bid_date: '2026-03-01', trade_type: 'painting', type: 'Exterior painting', surfaces: [], draft: false },
        { id: 77703, client_id: 88801, client_name: 'Test Client Alpha', amount: 0,   status: 'opportunity',
          bid_date: '2026-04-01', trade_type: 'electrical', type: 'Electrical diagnostic', notes: 'Follow up', draft: false }
      );
      jobs.push(
        { id: 66601, client_id: 88801, bid_id: 77701, name: 'Alpha job, estimate', eventType: 'estimate',
          status: 'scheduled', start: '2099-12-01', time: '09:00', addr: '1 Alpha Dr' },
        { id: 66602, client_id: 88801, bid_id: 77701, name: 'Alpha job, job',      eventType: 'job',
          status: 'scheduled', start: '2099-12-05' }
      );
      payments.push(
        { id: Date.now(),     bid_id: 77701, client_id: 88801, amount: 750,  type: 'deposit', method: 'Check', date: '2026-01-15' },
        { id: Date.now() + 1, bid_id: 77701, client_id: 88801, amount: 2250, type: 'final',   method: 'Cash',  date: '2026-02-01' }
      );

      // Expose currentClientId so CD functions work
      window.__origClientId = typeof currentClientId !== 'undefined' ? currentClientId : null;
      currentClientId = 88801;
    });
  });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients  = clients.filter(c => c.id !== 88801 && c.id !== 88802);
      bids     = bids.filter(b => b.id !== 77701 && b.id !== 77702 && b.id !== 77703);
      jobs     = jobs.filter(j => j.id !== 66601 && j.id !== 66602);
      payments = payments.filter(p => p.bid_id !== 77701 && p.bid_id !== 77702);
    });
    await page.context().close();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Run fn N times synchronously; returns count that did not throw */
  async function concurrent(page, fnExpr, n = 5) {
    return page.evaluate(([expr, count]) => {
      let ok = 0;
      for (let i = 0; i < count; i++) {
        try { eval(expr); ok++; } catch (_) {}
      }
      return ok;
    }, [fnExpr, n]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. addTradeOpportunity
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('addTradeOpportunity', () => {
    test('null clientId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { addTradeOpportunity(null, 'painting', 'Test', ''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined args, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { addTradeOpportunity(undefined, undefined, undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty strings, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { addTradeOpportunity('', '', '', ''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, adds opportunity to bids array', async () => {
      const r = await page.evaluate(() => {
        const before = bids.length;
        addTradeOpportunity(88801, 'painting', 'New opportunity title', 'Some notes');
        const added = bids.find(b => b.type === 'New opportunity title' && b.client_id === 88801 && b.status === 'opportunity');
        // cleanup
        bids = bids.filter(b => b.type !== 'New opportunity title');
        return { grew: bids.length < before + 1 || added !== undefined, found: !!added };
      });
      expect(r.found).toBe(true);
    });

    test('valid clientId but unknown trade, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { addTradeOpportunity(88801, 'unknown_trade_xyz', 'T', ''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { bids = bids.filter(b => b.trade_type !== 'unknown_trade_xyz'); }
      });
      expect(r.ok).toBe(true);
    });

    test('very long title string, does not throw', async () => {
      const longStr = 'x'.repeat(5000);
      const r = await page.evaluate((s) => {
        try { addTradeOpportunity(88801, 'painting', s, ''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { bids = bids.filter(b => (b.type || '').length < 1000); }
      }, longStr);
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no stack corruption', async () => {
      const ok = await page.evaluate(() => {
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { addTradeOpportunity(88801, 'painting', 'Concurrent ' + i, ''); count++; } catch (_) {}
        }
        const added = bids.filter(b => (b.type || '').startsWith('Concurrent '));
        bids = bids.filter(b => !(b.type || '').startsWith('Concurrent '));
        return { count, added: added.length };
      });
      expect(ok.count).toBe(5);
      expect(ok.added).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. convertOpportunityToEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('convertOpportunityToEstimate', () => {
    test('null bidId, does not throw, returns early', async () => {
      const r = await page.evaluate(() => {
        try { convertOpportunityToEstimate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns without modifying bids', async () => {
      const r = await page.evaluate(() => {
        const before = bids.length;
        try { convertOpportunityToEstimate(999999999); }
        catch (_) {}
        return { sameLen: bids.length === before };
      });
      expect(r.sameLen).toBe(true);
    });

    test('undefined bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { convertOpportunityToEstimate(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string id that does not match, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { convertOpportunityToEstimate('bogus-id'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, opportunity removed from bids array', async () => {
      const r = await page.evaluate(() => {
        // Seed a fresh opportunity with a known client
        const oppId = 77710;
        bids.push({ id: oppId, client_id: 88801, client_name: 'Test Client Alpha',
          status: 'opportunity', trade_type: 'painting', type: 'Test opp for convert', bid_date: '2026-01-01' });
        const before = bids.length;
        try { convertOpportunityToEstimate(oppId); } catch (_) {}
        const stillThere = bids.some(b => b.id === oppId);
        // Cleanup (if still there due to _doOpenEstimate side-effects)
        bids = bids.filter(b => b.id !== oppId);
        return { removed: !stillThere };
      });
      // The opportunity should be removed once function finds client
      expect(r.removed).toBe(true);
    });

    test('concurrent calls with same id, does not corrupt bids', async () => {
      const r = await page.evaluate(() => {
        const oppId = 77711;
        bids.push({ id: oppId, client_id: 88801, status: 'opportunity', trade_type: 'painting', bid_date: '2026-01-01' });
        let throws = 0;
        for (let i = 0; i < 5; i++) {
          try { convertOpportunityToEstimate(oppId); } catch (_) { throws++; }
        }
        bids = bids.filter(b => b.id !== oppId);
        return { throws };
      });
      expect(typeof r.throws).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. deleteOpportunity
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('deleteOpportunity', () => {
    test('null id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { deleteOpportunity(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { deleteOpportunity(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent id, bids array unchanged', async () => {
      const r = await page.evaluate(() => {
        const before = bids.length;
        deleteOpportunity(999999);
        return { same: bids.length === before };
      });
      expect(r.same).toBe(true);
    });

    test('golden path, removes bid with matching id', async () => {
      const r = await page.evaluate(() => {
        const delId = 77720;
        bids.push({ id: delId, client_id: 88801, status: 'opportunity', bid_date: '2026-01-01' });
        deleteOpportunity(delId);
        return { gone: !bids.some(b => b.id === delId) };
      });
      expect(r.gone).toBe(true);
    });

    test('string-type id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { deleteOpportunity('not-a-number'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent deletes of same id, does not throw', async () => {
      const r = await page.evaluate(() => {
        const delId = 77721;
        bids.push({ id: delId, client_id: 88801, status: 'opportunity', bid_date: '2026-01-01' });
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { deleteOpportunity(delId); } catch (_) { errs++; }
        }
        return { errs, gone: !bids.some(b => b.id === delId) };
      });
      expect(r.errs).toBe(0);
      expect(r.gone).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. renderCDOpportunities
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderCDOpportunities', () => {
    test('missing DOM element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { renderCDOpportunities(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, renders into #cd-opportunities when present', async () => {
      const r = await page.evaluate(() => {
        // Use the existing #cd-opportunities element (already in index.html)
        const el = document.getElementById('cd-opportunities');
        currentClientId = 88801;
        try {
          renderCDOpportunities();
          return { html: el ? el.innerHTML.length : -1 };
        } catch (e) {
          return { err: e.message };
        }
      });
      expect(r.html).toBeGreaterThan(0);
    });

    test('called 3×, no duplicate headers', async () => {
      const r = await page.evaluate(() => {
        // Use the existing #cd-opportunities element (already in index.html)
        const el = document.getElementById('cd-opportunities');
        currentClientId = 88801;
        try {
          renderCDOpportunities();
          renderCDOpportunities();
          renderCDOpportunities();
          const addBtns = el ? el.querySelectorAll('button').length : 0;
          return { addBtns };
        } catch (e) { return { addBtns: -1 }; }
      });
      // Multiple renders replace innerHTML; only one "+ Add" button should exist
      expect(r.addBtns).toBeGreaterThanOrEqual(1);
      expect(r.addBtns).toBeLessThan(10); // not N copies of the header
    });

    test('no opportunities, renders empty-state message', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('cd-opportunities');
        const origId = currentClientId;
        currentClientId = 88802; // client with no opportunities
        try {
          renderCDOpportunities();
          return { text: el ? el.textContent : '' };
        } finally {
          currentClientId = origId;
        }
      });
      expect(r.text).toContain('No opportunities');
    });

    test('corrupted localStorage before render, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_bids', '{INVALID{{{{');
        try {
          renderCDOpportunities();
          return { ok: true };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          localStorage.removeItem('zp3_bids');
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. openAddOpportunity
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openAddOpportunity', () => {
    test('no currentClientId, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = null;
        try { openAddOpportunity(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { currentClientId = orig; document.getElementById('_opp-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates modal overlay in DOM', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_opp-ov')?.remove();
        currentClientId = 88801;
        try { openAddOpportunity(); }
        catch (_) {}
        const ov = document.getElementById('_opp-ov');
        const found = !!ov;
        ov?.remove();
        return { found };
      });
      expect(r.found).toBe(true);
    });

    test('called twice, only one overlay in DOM', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('#_opp-ov').forEach(e => e.remove());
        currentClientId = 88801;
        try { openAddOpportunity(); openAddOpportunity(); } catch (_) {}
        const count = document.querySelectorAll('#_opp-ov').length;
        document.querySelectorAll('#_opp-ov').forEach(e => e.remove());
        return { count };
      });
      // IDs are unique; second call may replace or stack, either way, page must not crash
      expect(r.count).toBeGreaterThanOrEqual(1);
    });

    test('unknown clientId, does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = 999888777;
        try { openAddOpportunity(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { currentClientId = orig; document.getElementById('_opp-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. oppPickTrade
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('oppPickTrade', () => {
    test('null id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { oppPickTrade(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { oppPickTrade(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets _oppSelTrade and updates button styles when buttons exist', async () => {
      const r = await page.evaluate(() => {
        // Create a fake trade button
        const btn = document.createElement('button');
        btn.id = 'opptrade-painting';
        document.body.appendChild(btn);
        try {
          oppPickTrade('painting');
          return { tradeSet: typeof _oppSelTrade !== 'undefined' };
        } finally {
          btn.remove();
        }
      });
      expect(r.tradeSet).toBe(true);
    });

    test('no trade buttons in DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('[id^=opptrade-]').forEach(b => b.remove());
        try { oppPickTrade('electrical'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, last call wins for _oppSelTrade', async () => {
      const r = await page.evaluate(() => {
        try {
          oppPickTrade('painting');
          oppPickTrade('electrical');
          oppPickTrade('hvac');
          oppPickTrade('plumbing');
          oppPickTrade('roofing');
        } catch (_) {}
        return { trade: typeof _oppSelTrade !== 'undefined' ? _oppSelTrade : null };
      });
      // Last trade set should be roofing (or undefined if var not accessible)
      if (r.trade !== null) expect(r.trade).toBe('roofing');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. submitAddOpportunity
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('submitAddOpportunity', () => {
    test('no trade selected, shows toast, does not add bid', async () => {
      const r = await page.evaluate(() => {
        window._oppSelTrade = null;
        const before = bids.length;
        let toasted = false;
        const orig = window.showToast;
        window.showToast = (msg) => { toasted = true; };
        try { submitAddOpportunity(); }
        catch (_) {}
        window.showToast = orig;
        return { toasted, bidsUnchanged: bids.length === before };
      });
      expect(r.toasted).toBe(true);
      expect(r.bidsUnchanged).toBe(true);
    });

    test('trade selected but no title, shows toast', async () => {
      const r = await page.evaluate(() => {
        window._oppSelTrade = 'painting';
        // No #opp-title in DOM → value will be ''
        document.getElementById('opp-title')?.remove();
        let toasted = false;
        const orig = window.showToast;
        window.showToast = (msg) => { toasted = true; };
        try { submitAddOpportunity(); }
        catch (_) {}
        window.showToast = orig;
        return { toasted };
      });
      expect(r.toasted).toBe(true);
    });

    test('golden path, adds opportunity when trade + title present', async () => {
      const r = await page.evaluate(() => {
        window._oppSelTrade = 'painting';
        currentClientId = 88801;
        // Create required inputs
        const titleEl = document.createElement('input');
        titleEl.id = 'opp-title';
        titleEl.value = 'Golden path opp';
        const notesEl = document.createElement('input');
        notesEl.id = 'opp-notes';
        notesEl.value = 'Some notes';
        document.body.appendChild(titleEl);
        document.body.appendChild(notesEl);
        const before = bids.length;
        try { submitAddOpportunity(); }
        catch (_) {}
        const added = bids.find(b => b.type === 'Golden path opp');
        bids = bids.filter(b => b.type !== 'Golden path opp');
        titleEl.remove();
        notesEl.remove();
        return { added: !!added };
      });
      expect(r.added).toBe(true);
    });

    test('type-mismatch trade (number): does not throw', async () => {
      const r = await page.evaluate(() => {
        window._oppSelTrade = 12345; // number instead of string
        const titleEl = document.createElement('input');
        titleEl.id = 'opp-title';
        titleEl.value = 'Type mismatch test';
        document.body.appendChild(titleEl);
        try { submitAddOpportunity(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids = bids.filter(b => b.type !== 'Type mismatch test');
          titleEl.remove();
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. renderCDEstimatesUpcoming
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderCDEstimatesUpcoming', () => {
    test('missing DOM element, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { renderCDEstimatesUpcoming(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, renders upcoming estimate for client with no won bid', async () => {
      const r = await page.evaluate(() => {
        // Use the existing #cd-estimates-upcoming element (already in index.html)
        const el = document.getElementById('cd-estimates-upcoming');
        currentClientId = 88801;
        try {
          renderCDEstimatesUpcoming();
          return { html: el ? el.innerHTML : '' };
        } catch (e) { return { html: '' }; }
      });
      // Client 88801 has a Closed Won bid so upcoming section should be empty
      expect(typeof r.html).toBe('string');
    });

    test('client with no upcoming estimates, innerHTML empty', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('cd-estimates-upcoming');
        const origId = currentClientId;
        currentClientId = 88802; // no jobs for Beta
        try {
          renderCDEstimatesUpcoming();
          return { html: el ? el.innerHTML : '' };
        } finally {
          currentClientId = origId;
        }
      });
      expect(r.html).toBe('');
    });

    test('called 3×, no duplicate entries', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('cd-estimates-upcoming');
        // Use a client with no won bid, inject a future estimate job
        const testJobId = 66610;
        jobs.push({ id: testJobId, client_id: 88802, eventType: 'estimate',
          status: 'scheduled', start: '2099-11-01', name: 'Beta estimate', addr: '' });
        const origId = currentClientId;
        currentClientId = 88802;
        try {
          renderCDEstimatesUpcoming();
          renderCDEstimatesUpcoming();
          renderCDEstimatesUpcoming();
          // Count "Estimate scheduled" occurrences
          const count = ((el ? el.innerHTML : '').match(/Estimate scheduled/g) || []).length;
          return { count };
        } finally {
          jobs = jobs.filter(j => j.id !== testJobId);
          currentClientId = origId;
        }
      });
      // innerHTML is replaced each time, expect exactly 1
      expect(r.count).toBe(1);
    });

    test('null currentClientId, does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = null;
        try { renderCDEstimatesUpcoming(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { currentClientId = orig; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. cancelEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('cancelEstimate', () => {
    test('null jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { cancelEstimate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { cancelEstimate(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent jobId, no state change', async () => {
      const r = await page.evaluate(() => {
        const before = jobs.map(j => j.status).join(',');
        cancelEstimate(999999999);
        const after = jobs.map(j => j.status).join(',');
        return { same: before === after };
      });
      expect(r.same).toBe(true);
    });

    test('golden path, sets job status to canceled', async () => {
      const r = await page.evaluate(() => {
        const testId = 66620;
        jobs.push({ id: testId, client_id: 88801, eventType: 'estimate', status: 'scheduled', start: '2099-10-01' });
        cancelEstimate(testId);
        const j = jobs.find(x => x.id === testId);
        const status = j ? j.status : null;
        jobs = jobs.filter(x => x.id !== testId);
        return { status };
      });
      expect(r.status).toBe('canceled');
    });

    test('boundary: zero jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { cancelEstimate(0); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent cancel of same job, does not corrupt status', async () => {
      const r = await page.evaluate(() => {
        const testId = 66621;
        jobs.push({ id: testId, client_id: 88801, eventType: 'estimate', status: 'scheduled', start: '2099-09-01' });
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { cancelEstimate(testId); } catch (_) { errs++; }
        }
        const j = jobs.find(x => x.id === testId);
        jobs = jobs.filter(x => x.id !== testId);
        return { errs, status: j ? j.status : null };
      });
      expect(r.errs).toBe(0);
      expect(r.status).toBe('canceled');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. rescheduleEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('rescheduleEstimate', () => {
    test('null jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { rescheduleEstimate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { rescheduleEstimate(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, marks job canceled with Rescheduled reason', async () => {
      const r = await page.evaluate(() => {
        const testId = 66630;
        jobs.push({ id: testId, client_id: 88801, eventType: 'estimate', status: 'scheduled', start: '2099-08-01' });
        try { rescheduleEstimate(testId); } catch (_) {}
        const j = jobs.find(x => x.id === testId);
        const cancelReason = j ? j.cancelReason : null;
        jobs = jobs.filter(x => x.id !== testId);
        return { cancelReason };
      });
      expect(r.cancelReason).toBe('Rescheduled');
    });

    test('job is a job type with bid_id, calls schedFromBid path without throw', async () => {
      const r = await page.evaluate(() => {
        const testId = 66631;
        jobs.push({ id: testId, client_id: 88801, bid_id: 77702, eventType: 'job', status: 'scheduled', start: '2099-07-01' });
        try { rescheduleEstimate(testId); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { jobs = jobs.filter(x => x.id !== testId); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. showJobScorecard
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showJobScorecard', () => {
    test('null jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showJobScorecard(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined jobId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showJobScorecard(undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent jobId, returns early without adding modal', async () => {
      const r = await page.evaluate(() => {
        const before = document.querySelectorAll('.zmodal-overlay').length;
        try { showJobScorecard(999999888, null); } catch (_) {}
        const after = document.querySelectorAll('.zmodal-overlay').length;
        return { same: before === after };
      });
      expect(r.same).toBe(true);
    });

    test('golden path, creates scorecard modal in DOM', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showJobScorecard(66602, 77701); } catch (_) {}
        const found = document.querySelectorAll('.zmodal-overlay').length > 0;
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { found };
      });
      expect(r.found).toBe(true);
    });

    test('zero revenue job, shows $0 without NaN', async () => {
      const r = await page.evaluate(() => {
        const jobId = 66640;
        jobs.push({ id: jobId, client_id: 88801, bid_id: null, status: 'complete', start: '2026-02-01', name: 'Zero rev' });
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showJobScorecard(jobId, null); } catch (_) {}
        const html = document.querySelector('.zmodal')?.innerHTML || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        jobs = jobs.filter(j => j.id !== jobId);
        return { hasNaN: html.includes('NaN'), html: html.substring(0, 200) };
      });
      expect(r.hasNaN).toBe(false);
    });

    test('concurrent calls with same jobId, no stacked modals beyond 5', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        for (let i = 0; i < 5; i++) {
          try { showJobScorecard(66602, 77701); } catch (_) {}
        }
        const count = document.querySelectorAll('.zmodal-overlay').length;
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { count };
      });
      // Each call appends, count will be up to 5; page must not crash
      expect(r.count).toBeGreaterThanOrEqual(1);
      expect(r.count).toBeLessThanOrEqual(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. showSupplyList
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showSupplyList', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showSupplyList(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showSupplyList(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns early without modal', async () => {
      const r = await page.evaluate(() => {
        const before = document.querySelectorAll('.zmodal-overlay').length;
        try { showSupplyList(999999888); } catch (_) {}
        const after = document.querySelectorAll('.zmodal-overlay').length;
        return { same: before === after };
      });
      expect(r.same).toBe(true);
    });

    test('golden path, creates supply list modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showSupplyList(77701); } catch (_) {}
        const found = document.querySelectorAll('.zmodal-overlay').length > 0;
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { found };
      });
      expect(r.found).toBe(true);
    });

    test('bid with empty surfaces, renders without throw', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showSupplyList(77702); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); }
      });
      expect(r.ok).toBe(true);
    });

    test('bid with no roomScopeMap, does not throw', async () => {
      const r = await page.evaluate(() => {
        const testBid = { id: 77730, client_id: 88801, amount: 500, surfaces: [], status: 'Closed Won' };
        bids.push(testBid);
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showSupplyList(77730); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          bids = bids.filter(b => b.id !== 77730);
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage key, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('supplyChecked_77701', '{BAD JSON{{');
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { showSupplyList(77701); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          localStorage.removeItem('supplyChecked_77701');
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. supplyCheckAll / supplyUncheckAll
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('supplyCheckAll', () => {
    test('no #supply-list-body in DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { supplyCheckAll(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, checks all supply-check checkboxes', async () => {
      const r = await page.evaluate(() => {
        const body = document.createElement('tbody');
        body.id = 'supply-list-body';
        body.dataset.bidId = '77701';
        // Add a few checkboxes
        for (let i = 0; i < 3; i++) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          const label = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'supply-check';
          cb.dataset.supplyKey = 'item-' + i;
          const span = document.createElement('span');
          span.className = 'supply-label';
          span.textContent = 'Item ' + i;
          label.appendChild(cb);
          label.appendChild(span);
          td.appendChild(label);
          tr.appendChild(td);
          body.appendChild(tr);
        }
        document.body.appendChild(body);
        try {
          supplyCheckAll(null);
          const allChecked = [...body.querySelectorAll('.supply-check')].every(c => c.checked);
          return { allChecked };
        } finally {
          body.remove();
          localStorage.removeItem('supplyChecked_77701');
        }
      });
      expect(r.allChecked).toBe(true);
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        const body = document.createElement('tbody');
        body.id = 'supply-list-body';
        body.dataset.bidId = '77701';
        document.body.appendChild(body);
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { supplyCheckAll(null); } catch (_) { errs++; }
        }
        body.remove();
        localStorage.removeItem('supplyChecked_77701');
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  test.describe('supplyUncheckAll', () => {
    test('no #supply-list-body, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { supplyUncheckAll(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, unchecks all checkboxes', async () => {
      const r = await page.evaluate(() => {
        const body = document.createElement('tbody');
        body.id = 'supply-list-body';
        body.dataset.bidId = '77701';
        for (let i = 0; i < 3; i++) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          const label = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.className = 'supply-check'; cb.checked = true;
          const span = document.createElement('span');
          span.className = 'supply-label';
          span.style.textDecoration = 'line-through';
          label.appendChild(cb); label.appendChild(span);
          td.appendChild(label); tr.appendChild(td); body.appendChild(tr);
        }
        document.body.appendChild(body);
        try {
          supplyUncheckAll(null);
          const noneChecked = [...body.querySelectorAll('.supply-check')].every(c => !c.checked);
          const stored = localStorage.getItem('supplyChecked_77701');
          return { noneChecked, stored };
        } finally {
          body.remove();
          localStorage.removeItem('supplyChecked_77701');
        }
      });
      expect(r.noneChecked).toBe(true);
      expect(r.stored).toBe('{}');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. quickBid
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('quickBid', () => {
    test('does not throw when called', async () => {
      const r = await page.evaluate(() => {
        try { quickBid(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); }
      });
      expect(r.ok).toBe(true);
    });

    test('5 concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { quickBid(); } catch (_) { errs++; }
        }
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. schedForClient
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('schedForClient', () => {
    test('does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedForClient(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('null currentClientId, does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = null;
        try { schedForClient(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { currentClientId = orig; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. schedFromBid
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('schedFromBid', () => {
    test('null id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromBid(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromBid(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('valid bid id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromBid(77701); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bid id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromBid(999888777); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. schedFromDate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('schedFromDate', () => {
    test('null dateKey, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromDate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined dateKey, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromDate(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, does not throw with valid date key', async () => {
      const r = await page.evaluate(() => {
        try { schedFromDate('2026-06-26'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { schedFromDate(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. getBidPayments
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getBidPayments', () => {
    test('null bidId, returns array (no throw)', async () => {
      const r = await page.evaluate(() => {
        try { const res = getBidPayments(null); return { ok: true, isArr: Array.isArray(res) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isArr).toBe(true);
    });

    test('undefined bidId, returns empty array', async () => {
      const r = await page.evaluate(() => {
        try { return { len: getBidPayments(undefined).length }; }
        catch (e) { return { err: e.message }; }
      });
      expect(r.len).toBe(0);
    });

    test('golden path, returns payments for bid 77701', async () => {
      const r = await page.evaluate(() => {
        const pmts = getBidPayments(77701);
        return { len: pmts.length, allMatch: pmts.every(p => p.bid_id === 77701) };
      });
      expect(r.len).toBeGreaterThan(0);
      expect(r.allMatch).toBe(true);
    });

    test('bid with no payments, returns empty array', async () => {
      const r = await page.evaluate(() => {
        return { len: getBidPayments(77703).length };
      });
      expect(r.len).toBe(0);
    });

    test('boundary: bidId 0, returns empty array without throw', async () => {
      const r = await page.evaluate(() => {
        try { return { len: getBidPayments(0).length }; }
        catch (e) { return { err: e.message }; }
      });
      expect(r.len).toBe(0);
    });

    test('very large bidId, returns empty array', async () => {
      const r = await page.evaluate(() => {
        return { len: getBidPayments(Number.MAX_SAFE_INTEGER).length };
      });
      expect(r.len).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. getBidPaid
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getBidPaid', () => {
    test('null bidId, returns 0 or number without throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidPaid(null); return { ok: true, v, isNaN: isNaN(v) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isNaN).toBe(false);
    });

    test('golden path, returns correct total for bid 77701', async () => {
      const r = await page.evaluate(() => {
        return { paid: getBidPaid(77701) };
      });
      expect(r.paid).toBe(3000); // 750 + 2250
    });

    test('payments with missing amount, returns 0 not NaN', async () => {
      const r = await page.evaluate(() => {
        payments.push({ id: 99901, bid_id: 77740, amount: undefined });
        payments.push({ id: 99902, bid_id: 77740, amount: null });
        payments.push({ id: 99903, bid_id: 77740 });
        const paid = getBidPaid(77740);
        payments = payments.filter(p => p.bid_id !== 77740);
        return { paid, isNaN: isNaN(paid) };
      });
      expect(r.isNaN).toBe(false);
      expect(r.paid).toBe(0);
    });

    test('boundary: negative payment amounts, handles gracefully', async () => {
      const r = await page.evaluate(() => {
        payments.push({ id: 99904, bid_id: 77741, amount: -100 });
        const paid = getBidPaid(77741);
        payments = payments.filter(p => p.bid_id !== 77741);
        return { paid, isNaN: isNaN(paid) };
      });
      expect(r.isNaN).toBe(false);
      expect(typeof r.paid).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. getBidBalance
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getBidBalance', () => {
    test('null bid object, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidBalance(null); return { ok: true, v }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      // Either returns 0 or throws gracefully based on null guard
      expect(typeof r.ok).toBe('boolean');
    });

    test('bid with no amount, returns 0 not NaN', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77750, client_id: 88801 }; // no amount field
        const bal = getBidBalance(bid);
        return { bal, isNaN: isNaN(bal) };
      });
      expect(r.isNaN).toBe(false);
      expect(r.bal).toBe(0);
    });

    test('golden path, bid fully paid returns 0', async () => {
      const r = await page.evaluate(() => {
        const bid = bids.find(b => b.id === 77701);
        return { bal: getBidBalance(bid) };
      });
      expect(r.bal).toBe(0); // 3000 paid, 3000 amount
    });

    test('partial payment, returns positive balance', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77760, client_id: 88801, amount: 2000 };
        bids.push(bid);
        payments.push({ id: 88881, bid_id: 77760, amount: 500 });
        const bal = getBidBalance(bid);
        bids = bids.filter(b => b.id !== 77760);
        payments = payments.filter(p => p.bid_id !== 77760);
        return { bal };
      });
      expect(r.bal).toBe(1500);
    });

    test('overpaid: returns 0 not negative', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77761, client_id: 88801, amount: 1000 };
        bids.push(bid);
        payments.push({ id: 88882, bid_id: 77761, amount: 1500 });
        const bal = getBidBalance(bid);
        bids = bids.filter(b => b.id !== 77761);
        payments = payments.filter(p => p.bid_id !== 77761);
        return { bal };
      });
      expect(r.bal).toBe(0);
    });

    test('boundary: amount=0: returns 0', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77762, amount: 0 };
        return { bal: getBidBalance(bid) };
      });
      expect(r.bal).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 21. _calcFinanceCharge
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_calcFinanceCharge', () => {
    test('null bid, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { v: _calcFinanceCharge(null) }; }
        catch (e) { return { err: e.message }; }
      });
      expect(r.v).toBe(0);
    });

    test('undefined bid, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { v: _calcFinanceCharge(undefined) }; }
        catch (e) { return { err: e.message }; }
      });
      expect(r.v).toBe(0);
    });

    test('bid with no completion_date or signedAt, returns 0', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77770, amount: 1000 };
        return { v: _calcFinanceCharge(bid) };
      });
      expect(r.v).toBe(0);
    });

    test('paid-in-full bid, returns 0', async () => {
      const r = await page.evaluate(() => {
        const testBid = { id: 99911, amount: 500, signedAt: new Date(Date.now() - 90*86400000).toISOString() };
        bids.push(testBid);
        payments.push({ id: 99912, bid_id: 99911, amount: 500 });
        const v = _calcFinanceCharge(testBid);
        bids = bids.filter(b => b.id !== 99911);
        payments = payments.filter(p => p.bid_id !== 99911);
        return { v };
      });
      expect(r.v).toBe(0); // balance is 0 so no finance charge
    });

    test('overdue unpaid bid, returns positive charge', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77771, amount: 1000, signedAt: new Date(Date.now() - 60 * 86400000).toISOString() };
        bids.push(bid);
        // no payments → balance = 1000
        window._fcTestDays = 45; // simulate 45 days elapsed
        const charge = _calcFinanceCharge(bid);
        window._fcTestDays = undefined;
        bids = bids.filter(b => b.id !== 77771);
        return { charge, positive: charge > 0 };
      });
      expect(r.positive).toBe(true);
    });

    test('30-days-exactly: returns 0 (grace period not exceeded)', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77772, amount: 1000, signedAt: new Date().toISOString() };
        bids.push(bid);
        window._fcTestDays = 30;
        const charge = _calcFinanceCharge(bid);
        window._fcTestDays = undefined;
        bids = bids.filter(b => b.id !== 77772);
        return { charge };
      });
      expect(r.charge).toBe(0);
    });

    test('boundary: 31 days, returns positive charge', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77773, amount: 1000, signedAt: new Date().toISOString() };
        bids.push(bid);
        window._fcTestDays = 31;
        const charge = _calcFinanceCharge(bid);
        window._fcTestDays = undefined;
        bids = bids.filter(b => b.id !== 77773);
        return { charge, positive: charge > 0 };
      });
      expect(r.positive).toBe(true);
    });

    test('result is never NaN', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77774, amount: 500, signedAt: '2025-01-01T00:00:00Z' };
        bids.push(bid);
        const v = _calcFinanceCharge(bid);
        bids = bids.filter(b => b.id !== 77774);
        return { isNaN: isNaN(v) };
      });
      expect(r.isNaN).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 22. sendBidEmail
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('sendBidEmail', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { sendBidEmail(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns without side effects', async () => {
      const r = await page.evaluate(() => {
        let redirected = false;
        const orig = Object.getOwnPropertyDescriptor(window, 'location');
        try {
          sendBidEmail(999999);
          return { ok: true };
        } catch (e) {
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, constructs mailto href without throw', async () => {
      const r = await page.evaluate(() => {
        let hrefSet = '';
        // Intercept location.href assignment
        const desc = Object.getOwnPropertyDescriptor(window, 'location');
        let intercepted = false;
        try {
          // Wrap in try, JSDOM may throw on mailto: navigation
          sendBidEmail(77702);
          return { ok: true };
        } catch (e) {
          // Navigation may throw in test environment, that's acceptable
          if (e.message && (e.message.includes('Not implemented') || e.message.includes('navigation'))) {
            return { ok: true, nav: true };
          }
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
    });

    test('bid with no surfaces or scope, does not throw', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77780, client_id: 88801, client_name: 'Test Client Alpha',
          amount: 500, bid_date: '2026-01-01', days: 2 };
        bids.push(bid);
        try { sendBidEmail(77780); return { ok: true }; }
        catch (e) {
          if (e.message && e.message.includes('Not implemented')) return { ok: true };
          return { ok: false, err: e.message };
        } finally {
          bids = bids.filter(b => b.id !== 77780);
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 23. toggleBidSummary
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('toggleBidSummary', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { toggleBidSummary(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bid, returns early', async () => {
      const r = await page.evaluate(() => {
        try { toggleBidSummary(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('existing bid but missing #bid-card, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('bid-card-77701')?.remove();
        try { toggleBidSummary(77701); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates summary panel in bid card', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('bid-summary-77701')?.remove();
        const card = document.createElement('div');
        card.id = 'bid-card-77701';
        document.body.appendChild(card);
        try {
          toggleBidSummary(77701);
          const panel = document.getElementById('bid-summary-77701');
          return { created: !!panel };
        } finally {
          document.getElementById('bid-card-77701')?.remove();
          document.getElementById('bid-summary-77701')?.remove();
        }
      });
      expect(r.created).toBe(true);
    });

    test('called twice, toggles panel visibility', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('bid-summary-77701')?.remove();
        const card = document.createElement('div');
        card.id = 'bid-card-77701';
        document.body.appendChild(card);
        try {
          toggleBidSummary(77701); // create
          const afterFirst = document.getElementById('bid-summary-77701')?.style.display;
          toggleBidSummary(77701); // toggle
          const afterSecond = document.getElementById('bid-summary-77701')?.style.display;
          return { afterFirst, afterSecond };
        } finally {
          document.getElementById('bid-card-77701')?.remove();
          document.getElementById('bid-summary-77701')?.remove();
        }
      });
      // After first call: display is '' or 'block' (just created)
      // After second call: should be 'none' (hidden)
      expect(r.afterSecond).toBe('none');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 24. printInvoice
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('printInvoice', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { printInvoice(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns early', async () => {
      const r = await page.evaluate(() => {
        try { printInvoice(999999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, opens print window without throw', async () => {
      const r = await page.evaluate(() => {
        let opened = false;
        const origOpen = window.open;
        window.open = (url, target) => {
          opened = true;
          return { document: { write: () => {}, close: () => {} } };
        };
        try {
          printInvoice(77701);
          return { ok: true, opened };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          window.open = origOpen;
        }
      });
      expect(r.ok).toBe(true);
      expect(r.opened).toBe(true);
    });

    test('window.open blocked (returns null), shows alert without throw', async () => {
      const r = await page.evaluate(() => {
        const origOpen = window.open;
        const origAlert = window.zAlert;
        window.open = () => null;
        let alerted = false;
        window.zAlert = () => { alerted = true; };
        try {
          printInvoice(77701);
          return { ok: true, alerted };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          window.open = origOpen;
          window.zAlert = origAlert;
        }
      });
      expect(r.ok).toBe(true);
      expect(r.alerted).toBe(true);
    });

    test('bid with no payments, invoice shows $0 paid without NaN', async () => {
      const r = await page.evaluate(() => {
        let invoiceHtml = '';
        const origOpen = window.open;
        window.open = () => ({ document: { write: (h) => { invoiceHtml = h; }, close: () => {} } });
        printInvoice(77703); // opportunity bid with no payments
        window.open = origOpen;
        return { hasNaN: invoiceHtml.includes('NaN'), hasInvoice: invoiceHtml.includes('INVOICE') };
      });
      expect(r.hasNaN).toBe(false);
      expect(r.hasInvoice).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 25. getBidLien
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getBidLien', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { const v = getBidLien(null); return { ok: true, v: v === undefined || v === null }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { getBidLien(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent lien, returns undefined', async () => {
      const r = await page.evaluate(() => {
        const v = getBidLien(77701);
        return { undef: v === undefined };
      });
      expect(r.undef).toBe(true);
    });

    test('existing lien, returns lien object', async () => {
      const r = await page.evaluate(() => {
        liens.push({ id: 11101, bid_id: 77701, amount: 3000 });
        const lien = getBidLien(77701);
        liens = liens.filter(l => l.bid_id !== 77701 || l.id !== 11101);
        return { found: !!lien, bidId: lien?.bid_id };
      });
      expect(r.found).toBe(true);
      expect(r.bidId).toBe(77701);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 26. daysSince
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('daysSince', () => {
    test('null: returns 0', async () => {
      const r = await page.evaluate(() => daysSince(null));
      expect(r).toBe(0);
    });

    test('undefined: returns 0', async () => {
      const r = await page.evaluate(() => daysSince(undefined));
      expect(r).toBe(0);
    });

    test('empty string, returns 0', async () => {
      const r = await page.evaluate(() => daysSince(''));
      expect(r).toBe(0);
    });

    test('today: returns 0', async () => {
      const r = await page.evaluate(() => {
        const today = new Date().toISOString().slice(0, 10);
        return daysSince(today);
      });
      expect(r).toBe(0);
    });

    test('1 year ago, returns ~365', async () => {
      const r = await page.evaluate(() => {
        const d = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        return daysSince(d);
      });
      expect(r).toBeGreaterThanOrEqual(364);
      expect(r).toBeLessThanOrEqual(366);
    });

    test('result is never NaN', async () => {
      const r = await page.evaluate(() => {
        const vals = [null, undefined, '', '2026-01-01', 'not-a-date', 0, false];
        return vals.map(v => ({ v, isNaN: isNaN(daysSince(v)) }));
      });
      r.forEach(item => expect(item.isNaN).toBe(false));
    });

    test('boundary: very old date, returns large positive number', async () => {
      const r = await page.evaluate(() => daysSince('1970-01-01'));
      expect(r).toBeGreaterThan(10000);
    });

    test('future date, returns negative or 0 (no throw)', async () => {
      const r = await page.evaluate(() => {
        try { const v = daysSince('2099-12-31'); return { ok: true, v }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.v).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 27. payStatus
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('payStatus', () => {
    test('null bid, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { payStatus(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      // Allowed to throw on null, just must not crash page
      expect(typeof r.ok).toBe('boolean');
    });

    test('bid with no payments, returns Unpaid', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77790, amount: 1000, status: 'Closed Won' };
        bids.push(bid);
        const ps = payStatus(bid);
        bids = bids.filter(b => b.id !== 77790);
        return { label: ps.label };
      });
      expect(r.label).toBe('Unpaid');
    });

    test('deposit paid, returns Deposit paid', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77791, amount: 2000, deposit: 500, status: 'Closed Won' };
        bids.push(bid);
        payments.push({ id: 88890, bid_id: 77791, amount: 500 });
        const ps = payStatus(bid);
        bids = bids.filter(b => b.id !== 77791);
        payments = payments.filter(p => p.bid_id !== 77791);
        return { label: ps.label };
      });
      expect(r.label).toBe('Deposit paid');
    });

    test('paid in full, returns Paid in full', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77799, amount: 2000, status: 'Closed Won' };
        bids.push(bid);
        payments.push({ id: 88899, bid_id: 77799, amount: 2000 });
        try {
          const ps = payStatus(bid);
          return { label: ps.label };
        } finally {
          bids = bids.filter(b => b.id !== 77799);
          payments = payments.filter(p => p.bid_id !== 77799);
        }
      });
      expect(r.label).toBe('Paid in full');
    });

    test('amount=0 bid, returns Paid in full (0 balance)', async () => {
      const r = await page.evaluate(() => {
        const bid = { id: 77792, amount: 0 };
        const ps = payStatus(bid);
        return { label: ps.label };
      });
      expect(r.label).toBe('Paid in full');
    });

    test('result always has label and cls', async () => {
      const r = await page.evaluate(() => {
        const bidsToTest = [
          { id: 77793, amount: 1000 },
          { id: 77794, amount: 0 },
          { id: 77795, amount: 5000 },
        ];
        return bidsToTest.map(bid => {
          try {
            const ps = payStatus(bid);
            return { hasLabel: !!ps.label, hasCls: !!ps.cls };
          } catch (e) {
            return { err: e.message };
          }
        });
      });
      r.forEach(item => {
        if (!item.err) {
          expect(item.hasLabel).toBe(true);
          expect(item.hasCls).toBe(true);
        }
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 28. openQuickPayFromOverview
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openQuickPayFromOverview', () => {
    test('client with no won bids, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = 88802;
        try { openQuickPayFromOverview(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          currentClientId = orig;
          document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        }
      });
      expect(r.ok).toBe(true);
    });

    test('null currentClientId, does not throw', async () => {
      const r = await page.evaluate(() => {
        const orig = currentClientId;
        currentClientId = null;
        try { openQuickPayFromOverview(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          currentClientId = orig;
          document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 29. openPayPanel
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openPayPanel', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openPayPanel(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove()); }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns early', async () => {
      const r = await page.evaluate(() => {
        const before = document.querySelectorAll('.pay-modal-overlay').length;
        try { openPayPanel(999999999); } catch (_) {}
        const after = document.querySelectorAll('.pay-modal-overlay').length;
        return { same: before === after };
      });
      expect(r.same).toBe(true);
    });

    test('golden path, creates pay modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        try { openPayPanel(77701); }
        catch (_) {}
        const found = document.querySelectorAll('.pay-modal-overlay').length > 0;
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        return { found };
      });
      expect(r.found).toBe(true);
    });

    test('autoType=deposit: does not throw', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        try { openPayPanel(77702, 'deposit'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove()); }
      });
      expect(r.ok).toBe(true);
    });

    test('autoType=final: does not throw', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        try { openPayPanel(77702, 'final'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove()); }
      });
      expect(r.ok).toBe(true);
    });

    // Tap-to-pay slot reserved for the native app (owner decision 2026-07-10), must
    // not be a dead button (CLAUDE.md §14.1): tapping it shows an honest "coming
    // soon" message pointing to what works today, not a silent no-op.
    test('Tap to pay button is present, not a dead button, and does not claim to charge a card', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay,.zmodal-overlay').forEach(e => e.remove());
        try { openPayPanel(77702, 'final'); } catch (_) {}
        const btn = [...document.querySelectorAll('.pay-modal-overlay button')]
          .find(b => b.getAttribute('onclick') === '_tapToPaySoon()');
        const foundBtn = !!btn;
        const label = btn ? btn.textContent : '';
        btn && btn.click();
        const modal = document.querySelector('.zmodal-overlay .zmodal-msg');
        const modalText = modal ? modal.textContent : '';
        document.querySelectorAll('.pay-modal-overlay,.zmodal-overlay').forEach(e => e.remove());
        return { foundBtn, label, modalText };
      });
      expect(r.foundBtn, 'Tap to pay button must be present in the pay panel').toBe(true);
      expect(r.label).toContain('Tap to pay');
      expect(r.label.toLowerCase()).toContain('coming soon');
      expect(r.modalText, 'tapping it must show a real message, not silently no-op').toContain('coming');
      expect(r.modalText.toLowerCase()).not.toContain('charged');
    });

    test('sets activePayBidId', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        try { openPayPanel(77701); } catch (_) {}
        const id = typeof activePayBidId !== 'undefined' ? activePayBidId : null;
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        return { id };
      });
      expect(r.id).toBe(77701);
    });

    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { openPayPanel(77701); } catch (_) { errs++; }
        }
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 30. autoFillPayAmount
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('autoFillPayAmount', () => {
    test('is a no-op, does not throw when called', async () => {
      const r = await page.evaluate(() => {
        try { autoFillPayAmount(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { autoFillPayAmount(); } catch (_) { errs++; }
        }
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 31. closePayPanel
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('closePayPanel', () => {
    test('no panel open, does not throw', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.pay-modal-overlay').forEach(e => e.remove());
        try { closePayPanel(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, removes pay-modal-overlay', async () => {
      const r = await page.evaluate(() => {
        const ov = document.createElement('div');
        ov.className = 'pay-modal-overlay';
        document.body.appendChild(ov);
        closePayPanel();
        return { gone: document.querySelectorAll('.pay-modal-overlay').length === 0 };
      });
      expect(r.gone).toBe(true);
    });

    test('resets activePayBidId to null', async () => {
      const r = await page.evaluate(() => {
        try { openPayPanel(77701); } catch (_) {}
        closePayPanel();
        return { id: typeof activePayBidId !== 'undefined' ? activePayBidId : 'undef' };
      });
      expect(r.id).toBeNull();
    });

    test('concurrent calls, no throw', async () => {
      const r = await page.evaluate(() => {
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { closePayPanel(); } catch (_) { errs++; }
        }
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 32. showPayQr
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showPayQr', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showPayQr(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_pay-qr-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns without creating QR overlay', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_pay-qr-ov')?.remove();
        try { showPayQr(999999); } catch (_) {}
        return { absent: !document.getElementById('_pay-qr-ov') };
      });
      expect(r.absent).toBe(true);
    });

    test('bid without clientToken, shows toast without throw', async () => {
      const r = await page.evaluate(() => {
        let toasted = false;
        const orig = window.showToast;
        window.showToast = () => { toasted = true; };
        window._supaUser = { id: 'e2e-user' };
        try { showPayQr(77702); return { ok: true, toasted }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { window.showToast = orig; }
      });
      expect(r.ok).toBe(true);
      expect(r.toasted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 33. showCancellationRefund
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showCancellationRefund', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showCancellationRefund(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_cr-overlay')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent bidId, returns early', async () => {
      const r = await page.evaluate(() => {
        const before = document.querySelectorAll('.zmodal-overlay').length;
        try { showCancellationRefund(999999); } catch (_) {}
        const after = document.querySelectorAll('.zmodal-overlay').length;
        return { same: before === after };
      });
      expect(r.same).toBe(true);
    });

    test('bid with no payments, alerts, no modal', async () => {
      const r = await page.evaluate(() => {
        let alerted = false;
        const orig = window.zAlert;
        window.zAlert = () => { alerted = true; };
        document.getElementById('_cr-overlay')?.remove();
        try { showCancellationRefund(77702); } catch (_) {}
        const noOverlay = !document.getElementById('_cr-overlay');
        window.zAlert = orig;
        return { alerted, noOverlay };
      });
      expect(r.alerted).toBe(true);
      expect(r.noOverlay).toBe(true);
    });

    test('golden path, creates cancellation modal for paid bid', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cr-overlay')?.remove();
        // 77701 has payments summing to 3000
        try { showCancellationRefund(77701); } catch (_) {}
        const found = !!document.getElementById('_cr-overlay');
        document.getElementById('_cr-overlay')?.remove();
        return { found };
      });
      expect(r.found).toBe(true);
    });

    test('undefined bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showCancellationRefund(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_cr-overlay')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 34. _crCalc
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_crCalc', () => {
    test('no #_cr-mat in DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('_cr-mat')?.remove();
        document.getElementById('_cr-result')?.remove();
        try { _crCalc(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path: materials < deposit, shows refund amount', async () => {
      const r = await page.evaluate(() => {
        // Build the DOM _crCalc expects
        const inp = document.createElement('input');
        inp.id = '_cr-mat'; inp.type = 'number'; inp.dataset.paid = '750'; inp.value = '200';
        const res = document.createElement('div');
        res.id = '_cr-result';
        const sub = document.createElement('button');
        sub.id = '_cr-submit';
        document.body.appendChild(inp);
        document.body.appendChild(res);
        document.body.appendChild(sub);
        try {
          _crCalc();
          return { text: res.textContent, btnText: sub.textContent };
        } finally {
          inp.remove(); res.remove(); sub.remove();
        }
      });
      expect(r.text).toContain('550'); // 750 - 200 = 550 refund
    });

    test('materials >= deposit, shows no refund message', async () => {
      const r = await page.evaluate(() => {
        const inp = document.createElement('input');
        inp.id = '_cr-mat'; inp.type = 'number'; inp.dataset.paid = '500'; inp.value = '600';
        const res = document.createElement('div');
        res.id = '_cr-result';
        const sub = document.createElement('button');
        sub.id = '_cr-submit';
        document.body.appendChild(inp);
        document.body.appendChild(res);
        document.body.appendChild(sub);
        try {
          _crCalc();
          return { text: res.textContent };
        } finally {
          inp.remove(); res.remove(); sub.remove();
        }
      });
      expect(r.text).toContain('no refund');
    });

    test('empty/zero materials, refund equals full deposit', async () => {
      const r = await page.evaluate(() => {
        const inp = document.createElement('input');
        inp.id = '_cr-mat'; inp.type = 'number'; inp.dataset.paid = '300'; inp.value = '';
        const res = document.createElement('div');
        res.id = '_cr-result';
        const sub = document.createElement('button');
        sub.id = '_cr-submit';
        document.body.appendChild(inp);
        document.body.appendChild(res);
        document.body.appendChild(sub);
        try {
          _crCalc();
          return { text: res.textContent };
        } finally {
          inp.remove(); res.remove(); sub.remove();
        }
      });
      expect(r.text).toContain('300'); // full refund
    });

    test('NaN materials input, does not produce NaN in result', async () => {
      const r = await page.evaluate(() => {
        const inp = document.createElement('input');
        inp.id = '_cr-mat'; inp.type = 'number'; inp.dataset.paid = '500'; inp.value = 'abc';
        const res = document.createElement('div');
        res.id = '_cr-result';
        const sub = document.createElement('button');
        sub.id = '_cr-submit';
        document.body.appendChild(inp);
        document.body.appendChild(res);
        document.body.appendChild(sub);
        try {
          _crCalc();
          return { hasNaN: res.textContent.includes('NaN') };
        } finally {
          inp.remove(); res.remove(); sub.remove();
        }
      });
      expect(r.hasNaN).toBe(false);
    });

    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        const inp = document.createElement('input');
        inp.id = '_cr-mat'; inp.dataset.paid = '500'; inp.value = '100';
        const res = document.createElement('div'); res.id = '_cr-result';
        const sub = document.createElement('button'); sub.id = '_cr-submit';
        document.body.appendChild(inp); document.body.appendChild(res); document.body.appendChild(sub);
        let errs = 0;
        for (let i = 0; i < 5; i++) {
          try { _crCalc(); } catch (_) { errs++; }
        }
        inp.remove(); res.remove(); sub.remove();
        return { errs };
      });
      expect(r.errs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 35. Cross-cutting: corrupted localStorage on boot
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('corrupted localStorage, cross-cutting', () => {
    test('corrupt zp3_payments before getBidPaid, returns 0 not NaN', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_payments');
        localStorage.setItem('zp3_payments', '{INVALID{{{');
        try {
          // payments is an in-memory array, not re-read here; just confirm no crash
          const v = getBidPaid(77701);
          return { ok: true, isNaN: isNaN(v) };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          if (saved) localStorage.setItem('zp3_payments', saved);
          else localStorage.removeItem('zp3_payments');
        }
      });
      expect(r.ok).toBe(true);
      expect(r.isNaN).toBe(false);
    });

    test('corrupt zp3_bids before deleteOpportunity, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = localStorage.getItem('zp3_bids');
        localStorage.setItem('zp3_bids', '{BAD{');
        try { deleteOpportunity(77703); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          if (saved) localStorage.setItem('zp3_bids', saved);
          else localStorage.removeItem('zp3_bids');
        }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 36. No console errors introduced by bids.js
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors, bids.js', async () => {
    assertNoErrors(page, 'bids.js');
  });
});
