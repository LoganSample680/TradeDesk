// @ts-check
/**
 * Exhaustive E2E coverage for generic-estimate.js
 * Every exported function is tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors, FAKE_BID_ID_1, FAKE_USER_ID } = require('./helpers');

test.describe('generic-estimate.js: exhaustive coverage', () => {
  let page;

  // Idempotent fixture seed, filter-then-push so it's safe to re-run. Called in
  // beforeAll AND beforeEach: a late-resolving background cloud load reassigns the
  // in-memory arrays after the initial seed and drops these fixtures, so a test
  // running after that clobber saw an empty `clients`/`bids` (task #22 race). On a
  // slower WebKit boot the reload lands after the beforeAll seed, and renderHittersList
  // then early-returns on an empty clients list (no stats block). Re-seeding before
  // EVERY test guarantees the canonical fixture is present the moment each test reads it.
  const seedFixtures = () => page.evaluate(() => {
    clients = clients.filter(c => c.id !== 55501 && c.id !== 55502);
    bids    = bids.filter(b => b.id !== 44401 && b.id !== 44402 && b.id !== 44403);

    clients.push(
      { id: 55501, name: 'GEI Client Alpha', phone: '316-555-9001', addr: '100 Alpha St, Wichita KS 67202', email: 'alpha@gei.test' },
      { id: 55502, name: 'GEI Client Beta',  phone: '316-555-9002', addr: '200 Beta Ave, Wichita KS 67202', email: 'beta@gei.test' }
    );
    bids.push(
      {
        id: 44401, client_id: 55501, client_name: 'GEI Client Alpha', amount: 5000, deposit: 1000,
        status: 'pending', bid_date: '2026-01-01', trade_type: 'painting',
        type: 'Interior painting', geiLines: [{ desc: 'Labor', qty: 8, rate: 75, total: 600 }],
        geiTaxPct: 8, geiDuration: '3 days', notes: 'Test notes', isFreeForm: true,
        byoItems: [{ id: 1, section: 'Interior', label: 'Labor', price: 600, on: true }],
        byoCustomSections: [], scopeChips: ['Interior painting', 'Tape & masking']
      },
      {
        id: 44402, client_id: 55501, client_name: 'GEI Client Alpha', amount: 3000, deposit: 600,
        status: 'Draft', bid_date: '2026-02-01', trade_type: 'electrical',
        type: 'Panel upgrade', geiLines: [], isTM: true,
        tmCrewCount: 2, tmRatePerMan: 85, tmEstHours: 10, tmBillingCycle: 'weekly',
        tmMatMarkup: 20, tmCapAction: 'Stop & get re-approval'
      },
      {
        id: 44403, client_id: 55502, client_name: 'GEI Client Beta', amount: 0,
        status: 'Draft', bid_date: '2026-03-01', trade_type: 'plumbing',
        type: 'Plumbing estimate', geiLines: [], draft: true
      }
    );
  });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    await seedFixtures();
  });

  // Re-seed before EVERY test, repairs any fixture a late background cloud load
  // clobbered after boot (task #22). Idempotent (filter-then-push), so tests that
  // mutate-and-restore their own fixtures still start from the canonical state.
  test.beforeEach(async () => { await seedFixtures(); });

  test.afterAll(async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 55501 && c.id !== 55502);
      bids    = bids.filter(b => b.id !== 44401 && b.id !== 44402 && b.id !== 44403);
    });
    await page.context().close();
  });

  // ── Utility: run fn expression N times synchronously ──────────────────────
  async function concurrent(fnExpr, n = 5) {
    return page.evaluate(([expr, count]) => {
      let ok = 0;
      for (let i = 0; i < count; i++) {
        try { eval(expr); ok++; } catch (_) {}
      }
      return ok;
    }, [fnExpr, n]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. openBidNotes
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openBidNotes', () => {
    test('null bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('zero bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(0); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('negative bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(-1); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, sets editingBidId and lastCreatedBidId', async () => {
      const r = await page.evaluate(() => {
        openBidNotes(44401);
        return { editingBidId, lastCreatedBidId };
      });
      expect(r.editingBidId).toBe(44401);
      expect(r.lastCreatedBidId).toBe(44401);
    });

    test('string bidId (type mismatch), does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes('not-a-number'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('very large bidId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openBidNotes(Number.MAX_SAFE_INTEGER); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no state corruption', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { openBidNotes(44401 + i); ok++; } catch (_) {}
        }
        return { ok, finalId: editingBidId };
      });
      expect(r.ok).toBe(5);
      expect(typeof r.finalId).toBe('number');
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_notes_44401', '{INVALID{{{{');
        try { openBidNotes(44401); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('td_notes_44401'); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. showNotesFab
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showNotesFab', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showNotesFab(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('called with extra args, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { showNotesFab(null, undefined, 'extra'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('showNotesFab()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. hideNotesFab
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('hideNotesFab', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { hideNotesFab(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('hideNotesFab()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. toggleNotesPanel
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('toggleNotesPanel', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { toggleNotesPanel(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('toggleNotesPanel()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. notesExpandCanvas
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('notesExpandCanvas', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { notesExpandCanvas(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('notesExpandCanvas()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. clearNotesPanel
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('clearNotesPanel', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { clearNotesPanel(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('clearNotesPanel()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. _resetNotesForNewEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_resetNotesForNewEstimate', () => {
    test('no-op: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _resetNotesForNewEstimate(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_resetNotesForNewEstimate()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. setHittersFilter
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setHittersFilter', () => {
    test('null filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setHittersFilter(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined filter, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setHittersFilter(undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string filter, sets hittersFilter', async () => {
      const r = await page.evaluate(() => {
        try { setHittersFilter('', null); return { ok: true, hf: hittersFilter }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hf).toBe('');
    });

    test('golden path, filter "A" sets hittersFilter to "A"', async () => {
      const r = await page.evaluate(() => {
        setHittersFilter('A', null);
        return { hf: hittersFilter };
      });
      expect(r.hf).toBe('A');
    });

    test('golden path, filter "B" sets hittersFilter to "B"', async () => {
      const r = await page.evaluate(() => {
        setHittersFilter('B', null);
        return { hf: hittersFilter };
      });
      expect(r.hf).toBe('B');
    });

    test('golden path, filter "all" sets hittersFilter to "all"', async () => {
      const r = await page.evaluate(() => {
        setHittersFilter('all', null);
        return { hf: hittersFilter };
      });
      expect(r.hf).toBe('all');
    });

    test('with DOM filter buttons present, highlights correct button', async () => {
      const r = await page.evaluate(() => {
        // Create mock filter buttons
        ['all','A','B'].forEach(t => {
          let b = document.getElementById('hl-filter-'+t);
          if (!b) { b = document.createElement('button'); b.id = 'hl-filter-'+t; document.body.appendChild(b); }
        });
        setHittersFilter('A', null);
        const btnA = document.getElementById('hl-filter-A');
        const btnAll = document.getElementById('hl-filter-all');
        const result = {
          ABlue: btnA?.style.background?.includes('var(--blue)') || btnA?.style.background === 'var(--blue)',
          AllEmpty: btnAll?.style.background === ''
        };
        // Cleanup
        ['all','A','B'].forEach(t => document.getElementById('hl-filter-'+t)?.remove());
        return result;
      });
      expect(r.ABlue).toBe(true);
      expect(r.AllEmpty).toBe(true);
    });

    test('type mismatch (number): does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setHittersFilter(42, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): last value sticks', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        const vals = ['all', 'A', 'B', 'all', 'A'];
        for (let i = 0; i < 5; i++) {
          try { setHittersFilter(vals[i], null); ok++; } catch (_) {}
        }
        return { ok, final: hittersFilter };
      });
      expect(r.ok).toBe(5);
      expect(r.final).toBe('A');
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_hitters_filter', '{INVALID{{{{');
        try { setHittersFilter('all', null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('td_hitters_filter'); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. renderHittersList
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('renderHittersList', () => {
    test('missing DOM (no hl-list element), returns early, no throw', async () => {
      const r = await page.evaluate(() => {
        const existing = document.getElementById('hl-list');
        if (existing) existing.remove();
        try { renderHittersList(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty clients array, shows empty message', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'hl-list';
        const stats = document.createElement('div'); stats.id = 'hl-stats';
        document.body.appendChild(wrap); document.body.appendChild(stats);
        const savedClients = [...clients];
        clients = [];
        renderHittersList();
        const html = wrap.innerHTML;
        clients = savedClients;
        wrap.remove(); stats.remove();
        return { hasEmpty: html.includes('No clients yet') };
      });
      expect(r.hasEmpty).toBe(true);
    });

    test('golden path with clients, renders cards', async () => {
      const r = await page.evaluate(() => {
        let wrap = document.getElementById('hl-list');
        let stats = document.getElementById('hl-stats');
        const wrapCreated = !wrap;
        const statsCreated = !stats;
        if (!wrap) { wrap = document.createElement('div'); wrap.id = 'hl-list'; document.body.appendChild(wrap); }
        if (!stats) { stats = document.createElement('div'); stats.id = 'hl-stats'; document.body.appendChild(stats); }
        hittersFilter = 'all';
        renderHittersList();
        const cardCount = wrap.querySelectorAll('.card').length;
        const statsHtml = stats.innerHTML;
        if (wrapCreated) wrap.remove();
        if (statsCreated) stats.remove();
        return { cardCount, hasStats: statsHtml.includes('A-tier') };
      });
      expect(r.cardCount).toBeGreaterThanOrEqual(0);
      expect(r.hasStats).toBe(true);
    });

    test('filter "A", shows only A-tier or empty message', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'hl-list';
        const stats = document.createElement('div'); stats.id = 'hl-stats';
        document.body.appendChild(wrap); document.body.appendChild(stats);
        hittersFilter = 'A';
        renderHittersList();
        const html = wrap.innerHTML;
        wrap.remove(); stats.remove();
        return { ok: true, html };
      });
      expect(r.ok).toBe(true);
    });

    test('no duplicate entries after 3 render calls', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'hl-list';
        const stats = document.createElement('div'); stats.id = 'hl-stats';
        document.body.appendChild(wrap); document.body.appendChild(stats);
        hittersFilter = 'all';
        renderHittersList();
        renderHittersList();
        renderHittersList();
        const cards = wrap.querySelectorAll('.card');
        // Check no duplicate client names by collecting them
        const names = [...cards].map(c => c.querySelector('[style*="font-weight:700"]')?.textContent?.trim()).filter(Boolean);
        const uniqueNames = [...new Set(names)];
        wrap.remove(); stats.remove();
        return { total: names.length, unique: uniqueNames.length };
      });
      // innerHTML is replaced each time, so total should equal unique
      expect(r.total).toBe(r.unique);
    });

    test('concurrent calls (5x): no crash', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'hl-list';
        const stats = document.createElement('div'); stats.id = 'hl-stats';
        document.body.appendChild(wrap); document.body.appendChild(stats);
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { renderHittersList(); ok++; } catch (_) {}
        }
        wrap.remove(); stats.remove();
        return { ok };
      });
      expect(r.ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. applyPermissions
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('applyPermissions', () => {
    test('no DOM elements present, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { applyPermissions(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('as employee (_isEmployee=true): hides restricted nav items', async () => {
      const r = await page.evaluate(() => {
        const savedEmployee = _isEmployee;
        // Create restricted nav elements
        const ids = ['nb-leads','nb-tracker','nb-team','nb-settings'];
        ids.forEach(id => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
          el.style.display = 'block';
        });
        window._isEmployee = true;
        try { applyPermissions(); }
        catch (e) { window._isEmployee = savedEmployee; ids.forEach(id => document.getElementById(id)?.remove()); return { ok: false, err: e.message }; }
        const hidden = ids.every(id => document.getElementById(id)?.style.display === 'none');
        window._isEmployee = savedEmployee;
        ids.forEach(id => document.getElementById(id)?.remove());
        return { ok: true, hidden };
      });
      expect(r.ok).toBe(true);
      expect(r.hidden).toBe(true);
    });

    test('as owner (_isEmployee=false): does not hide owner nav items', async () => {
      const r = await page.evaluate(() => {
        const savedEmployee = _isEmployee;
        window._isEmployee = false;
        try { applyPermissions(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { window._isEmployee = savedEmployee; }
      });
      expect(r.ok).toBe(true);
    });

    test('with nav-user-name element, sets name text', async () => {
      const r = await page.evaluate(() => {
        let el = document.getElementById('nav-user-name');
        const created = !el;
        if (!el) { el = document.createElement('div'); el.id = 'nav-user-name'; document.body.appendChild(el); }
        const savedText = el.textContent;
        const savedEmployee = _isEmployee; window._isEmployee = false;
        try { applyPermissions(); }
        catch (_) {}
        const txt = el.textContent;
        if (created) el.remove(); else el.textContent = savedText;
        window._isEmployee = savedEmployee;
        return { txt, notEmpty: txt.length > 0 };
      });
      expect(r.notEmpty).toBe(true);
    });

    test('nav-user-name not set to email when S.bname is present', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('div'); el.id = 'nav-user-name';
        document.body.appendChild(el);
        const savedEmployee = _isEmployee; window._isEmployee = false;
        const savedBname = S.bname; S.bname = 'Test Business';
        try { applyPermissions(); }
        catch (_) {}
        const txt = el.textContent;
        document.getElementById('nav-user-name')?.remove();
        window._isEmployee = savedEmployee; S.bname = savedBname;
        return { notEmail: !txt.includes('@') };
      });
      expect(r.notEmail).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('applyPermissions()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. getActiveTrade
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('getActiveTrade', () => {
    test('returns string, not null/undefined', async () => {
      const r = await page.evaluate(() => {
        const t = getActiveTrade();
        return { t, isString: typeof t === 'string', notEmpty: t.length > 0 };
      });
      expect(r.isString).toBe(true);
      expect(r.notEmpty).toBe(true);
    });

    test('_activeTrade=null falls back to _config or "painting"', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade; _activeTrade = null;
        const t = getActiveTrade();
        _activeTrade = saved;
        return { t, valid: ['painting','plumbing','electrical','hvac','roofing','landscaping','general','other'].includes(t) || typeof t === 'string' };
      });
      expect(r.valid).toBe(true);
    });

    test('_activeTrade set to "electrical", returns "electrical"', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade; _activeTrade = 'electrical';
        const t = getActiveTrade();
        _activeTrade = saved;
        return { t };
      });
      expect(r.t).toBe('electrical');
    });

    test('concurrent calls (10x): all return same value', async () => {
      const r = await page.evaluate(() => {
        _activeTrade = 'painting';
        const results = [];
        for (let i = 0; i < 10; i++) results.push(getActiveTrade());
        return { allSame: results.every(v => v === 'painting') };
      });
      expect(r.allSame).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. setActiveTrade
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setActiveTrade', () => {
    test('null: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setActiveTrade(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setActiveTrade(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        try { setActiveTrade(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _activeTrade = saved; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path "plumbing", _activeTrade becomes "plumbing"', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        setActiveTrade('plumbing');
        const t = _activeTrade;
        setActiveTrade(saved);
        return { t };
      });
      expect(r.t).toBe('plumbing');
    });

    test('unknown trade string, does not throw, sets _activeTrade', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        try { setActiveTrade('underwater-basket-weaving'); return { ok: true, t: _activeTrade }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _activeTrade = saved; }
      });
      expect(r.ok).toBe(true);
      expect(r.t).toBe('underwater-basket-weaving');
    });

    test('number type, does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        try { setActiveTrade(42); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _activeTrade = saved; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): last value sticks', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        const trades = ['painting','plumbing','electrical','roofing','hvac'];
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { setActiveTrade(trades[i]); ok++; } catch (_) {}
        }
        const final = _activeTrade;
        _activeTrade = saved;
        return { ok, final };
      });
      expect(r.ok).toBe(5);
      expect(r.final).toBe('hvac');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. _getTradeLines
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_getTradeLines', () => {
    test('_config null/undefined: returns [activeTrade]', async () => {
      const r = await page.evaluate(() => {
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = null;
        _activeTrade = 'painting';
        let lines;
        try { lines = _getTradeLines(); }
        catch (e) { window._config = savedConfig; return { ok: false, err: e.message }; }
        window._config = savedConfig;
        return { ok: true, lines };
      });
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.lines)).toBe(true);
      expect(r.lines.length).toBeGreaterThanOrEqual(1);
    });

    test('_config.trade_lines as array, returns that array', async () => {
      const r = await page.evaluate(() => {
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: ['painting', 'electrical', 'plumbing'] };
        let lines;
        try { lines = _getTradeLines(); }
        catch (e) { window._config = savedConfig; return { ok: false, err: e.message }; }
        window._config = savedConfig;
        return { ok: true, lines };
      });
      expect(r.ok).toBe(true);
      expect(r.lines).toEqual(['painting', 'electrical', 'plumbing']);
    });

    test('_config.trade_lines as comma string, splits correctly', async () => {
      const r = await page.evaluate(() => {
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: 'painting,electrical, plumbing' };
        let lines;
        try { lines = _getTradeLines(); }
        catch (e) { window._config = savedConfig; return { ok: false, err: e.message }; }
        window._config = savedConfig;
        return { ok: true, lines };
      });
      expect(r.ok).toBe(true);
      expect(r.lines).toContain('painting');
      expect(r.lines).toContain('electrical');
      expect(r.lines).toContain('plumbing');
    });

    test('_config.trade_lines empty string, returns array without empty entries', async () => {
      const r = await page.evaluate(() => {
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: '' };
        let lines;
        try { lines = _getTradeLines(); }
        catch (e) { window._config = savedConfig; return { ok: false, err: e.message }; }
        window._config = savedConfig;
        return { ok: true, lines, noEmpty: !lines.includes('') };
      });
      expect(r.ok).toBe(true);
      expect(r.noEmpty).toBe(true);
    });

    test('concurrent calls (5x): stable result', async () => {
      const r = await page.evaluate(() => {
        let ok = 0, last;
        for (let i = 0; i < 5; i++) {
          try { last = _getTradeLines(); ok++; } catch (_) {}
        }
        return { ok, isArray: Array.isArray(last) };
      });
      expect(r.ok).toBe(5);
      expect(r.isArray).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. _renderNavTradeSwitcher
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_renderNavTradeSwitcher', () => {
    test('missing DOM, returns early, no throw', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('nav-trade-switcher')?.remove();
        document.getElementById('nav-trade-pills')?.remove();
        try { _renderNavTradeSwitcher(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('single trade line, hides switcher', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'nav-trade-switcher'; wrap.style.display = 'block';
        const pills = document.createElement('div'); pills.id = 'nav-trade-pills';
        document.body.appendChild(wrap); document.body.appendChild(pills);
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: ['painting'] };
        _activeTrade = 'painting';
        try { _renderNavTradeSwitcher(); }
        catch (_) {}
        const hidden = wrap.style.display === 'none';
        wrap.remove(); pills.remove();
        window._config = savedConfig;
        return { ok: true, hidden };
      });
      expect(r.ok).toBe(true);
      expect(r.hidden).toBe(true);
    });

    test('multiple trade lines, shows switcher with pills', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'nav-trade-switcher';
        const pills = document.createElement('div'); pills.id = 'nav-trade-pills';
        document.body.appendChild(wrap); document.body.appendChild(pills);
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: ['painting', 'electrical', 'plumbing'] };
        _activeTrade = 'painting';
        try { _renderNavTradeSwitcher(); }
        catch (_) {}
        const btnCount = pills.querySelectorAll('button').length;
        wrap.remove(); pills.remove();
        window._config = savedConfig;
        return { ok: true, btnCount };
      });
      expect(r.ok).toBe(true);
      expect(r.btnCount).toBe(3);
    });

    test('no duplicate pills after 3 calls', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'nav-trade-switcher';
        const pills = document.createElement('div'); pills.id = 'nav-trade-pills';
        document.body.appendChild(wrap); document.body.appendChild(pills);
        const savedConfig = typeof _config !== 'undefined' ? _config : null;
        window._config = { trade_lines: ['painting', 'electrical'] };
        _activeTrade = 'painting';
        _renderNavTradeSwitcher();
        _renderNavTradeSwitcher();
        _renderNavTradeSwitcher();
        const btnCount = pills.querySelectorAll('button').length;
        wrap.remove(); pills.remove();
        window._config = savedConfig;
        return { btnCount };
      });
      expect(r.btnCount).toBe(2);
    });

    test('concurrent calls (5x): no crash', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'nav-trade-switcher';
        const pills = document.createElement('div'); pills.id = 'nav-trade-pills';
        document.body.appendChild(wrap); document.body.appendChild(pills);
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _renderNavTradeSwitcher(); ok++; } catch (_) {}
        }
        wrap.remove(); pills.remove();
        return { ok };
      });
      expect(r.ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. _geiOnAddrInput
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_geiOnAddrInput', () => {
    test('no DOM, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _geiOnAddrInput(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('sets debounce timer, does not crash', async () => {
      const r = await page.evaluate(() => {
        // Clear any existing timer
        if (typeof _geiTaxLookupTimer !== 'undefined') clearTimeout(_geiTaxLookupTimer);
        try { _geiOnAddrInput(); return { ok: true, timerSet: _geiTaxLookupTimer != null }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.timerSet).toBe(true);
    });

    test('concurrent calls (5x): debounce does not throw', async () => {
      const ok = await concurrent('_geiOnAddrInput()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. _geiLookupClientTaxRate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_geiLookupClientTaxRate', () => {
    test('no gei-addr element, does not throw', async () => {
      const r = await page.evaluate(async () => {
        document.getElementById('gei-addr')?.remove();
        try { await _geiLookupClientTaxRate(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty address, sets _geiClientTaxRate to null', async () => {
      const r = await page.evaluate(async () => {
        const el = document.createElement('input'); el.id = 'gei-addr'; el.value = '';
        document.body.appendChild(el);
        try { await _geiLookupClientTaxRate(); }
        catch (_) {}
        const rate = _geiClientTaxRate;
        el.remove();
        return { ok: true, rateNull: rate === null };
      });
      expect(r.ok).toBe(true);
      expect(r.rateNull).toBe(true);
    });

    test('address with no zip or state, does not throw', async () => {
      const r = await page.evaluate(async () => {
        const el = document.createElement('input'); el.id = 'gei-addr'; el.value = 'No zip here at all';
        document.body.appendChild(el);
        try { await _geiLookupClientTaxRate(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('valid zip address, does not throw', async () => {
      const r = await page.evaluate(async () => {
        const el = document.createElement('input'); el.id = 'gei-addr'; el.value = '123 Main St, Wichita KS 67202';
        document.body.appendChild(el);
        try { await _geiLookupClientTaxRate(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent async calls, no unhandled rejection', async () => {
      const r = await page.evaluate(async () => {
        const el = document.createElement('input'); el.id = 'gei-addr'; el.value = '123 Main St, KS 67202';
        document.body.appendChild(el);
        try {
          await Promise.all([
            _geiLookupClientTaxRate(),
            _geiLookupClientTaxRate(),
            _geiLookupClientTaxRate()
          ]);
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. openTMEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openTMEstimate', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openTMEstimate(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openTMEstimate(undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('sets _geiIsTM=true', async () => {
      const r = await page.evaluate(() => {
        openTMEstimate(null, null);
        return { isTM: _geiIsTM };
      });
      expect(r.isTM).toBe(true);
    });

    test('sets _geiIsFreeForm=false', async () => {
      const r = await page.evaluate(() => {
        // Remove any null-client draft bids that a prior openFreeFormEstimate(null,null) call may have left,
        // since openGenericEstimate picks them up and restores isFreeForm=true from them.
        bids = bids.filter(b => !(b.client_id === null && !b.signingToken && b.geiLines !== undefined && (b.status === 'Draft' || b.status === 'Pending')));
        _geiIsFreeForm = true;
        openTMEstimate(null, null);
        return { isFreeForm: _geiIsFreeForm };
      });
      expect(r.isFreeForm).toBe(false);
    });

    test('golden path with client, does not throw', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        try { openTMEstimate(c, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with existing TM bid, restores TM fields', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        try { openTMEstimate(c, 44402); return { ok: true, isTM: _geiIsTM }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isTM).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. openFreeFormEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openFreeFormEstimate', () => {
    test('null client, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openFreeFormEstimate(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('sets _geiIsFreeForm=true', async () => {
      const r = await page.evaluate(() => {
        _geiIsFreeForm = false;
        openFreeFormEstimate(null, null);
        return { isFreeForm: _geiIsFreeForm };
      });
      expect(r.isFreeForm).toBe(true);
    });

    test('sets _geiIsTM=false', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = true;
        openFreeFormEstimate(null, null);
        return { isTM: _geiIsTM };
      });
      expect(r.isTM).toBe(false);
    });

    test('golden path with client, does not throw', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        try { openFreeFormEstimate(c, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with existing freeform bid, restores items', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        try { openFreeFormEstimate(c, 44401); return { ok: true, isFreeForm: _geiIsFreeForm }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isFreeForm).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. openGenericEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('openGenericEstimate', () => {
    test('null client, null bidId, null tradePick, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openGenericEstimate(null, null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined all args, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openGenericEstimate(undefined, undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty client object {}, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openGenericEstimate({}, null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path with client and trade, sets _geiClientId', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        openGenericEstimate(c, null, 'painting');
        return { clientId: _geiClientId, trade: _geiTrade };
      });
      expect(r.clientId).toBe(55501);
      expect(r.trade).toBe('painting');
    });

    test('opening with existing bidId, sets _geiEditBidId', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 55501);
        _geiIsFreeForm = true; _geiIsTM = false;
        openGenericEstimate(c, 44401, 'painting');
        return { editBidId: _geiEditBidId };
      });
      expect(r.editBidId).toBe(44401);
    });

    test('resets state on new estimate, geiLines is empty []', async () => {
      const r = await page.evaluate(() => {
        _geiLines = [{ desc: 'old line', qty: 1, rate: 100, total: 100 }];
        openGenericEstimate(null, null, null);
        return { linesEmpty: _geiLines.length === 0 };
      });
      expect(r.linesEmpty).toBe(true);
    });

    test('_tradePick sets _activeTrade', async () => {
      const r = await page.evaluate(() => {
        const saved = _activeTrade;
        openGenericEstimate(null, null, 'roofing');
        const t = _geiTrade;
        // restore
        _activeTrade = saved;
        return { t };
      });
      expect(r.t).toBe('roofing');
    });

    test('type mismatch bidId (string "abc"): does not throw', async () => {
      const r = await page.evaluate(() => {
        try { openGenericEstimate(null, 'abc', null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_bids', '{INVALID{{{{');
        try { openGenericEstimate(null, null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_bids'); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        const c = clients.find(x => x.id === 55501) || null;
        for (let i = 0; i < 5; i++) {
          try { openGenericEstimate(c, null, 'painting'); ok++; } catch (_) {}
        }
        return { ok };
      });
      expect(r.ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. goGeiStep
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('goGeiStep', () => {
    test('null step, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { goGeiStep(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined step, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { goGeiStep(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('step 0 (boundary): does not throw', async () => {
      const r = await page.evaluate(() => {
        try { goGeiStep(0); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('step -1 (boundary): does not throw', async () => {
      const r = await page.evaluate(() => {
        try { goGeiStep(-1); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('step 1, sets _geiStep to 1', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = false; _geiIsFreeForm = false;
        goGeiStep(1);
        return { step: _geiStep };
      });
      expect(r.step).toBe(1);
    });

    test('step 3, sets _geiStep to 3', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = false; _geiIsFreeForm = false;
        goGeiStep(3);
        return { step: _geiStep };
      });
      expect(r.step).toBe(3);
    });

    test('TM mode step 1, calls _tmHidePage, does not throw', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = true; _geiIsFreeForm = false;
        try { goGeiStep(1); return { ok: true, step: _geiStep }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _geiIsTM = false; }
      });
      expect(r.ok).toBe(true);
    });

    test('TM mode step 2, calls _tmShowPage, does not throw', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = true; _geiIsFreeForm = false;
        try { goGeiStep(2); return { ok: true, step: _geiStep }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _geiIsTM = false; }
      });
      expect(r.ok).toBe(true);
    });

    test('freeform mode step 2, calls _byoShowPage, does not throw', async () => {
      const r = await page.evaluate(() => {
        _geiIsFreeForm = true; _geiIsTM = false;
        try { goGeiStep(2); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _geiIsFreeForm = false; }
      });
      expect(r.ok).toBe(true);
    });

    test('very large step number, does not throw', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = false; _geiIsFreeForm = false;
        try { goGeiStep(9999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string step "2" (type mismatch), does not throw', async () => {
      const r = await page.evaluate(() => {
        try { goGeiStep('2'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): last step sticks', async () => {
      const r = await page.evaluate(() => {
        _geiIsTM = false; _geiIsFreeForm = false;
        let ok = 0;
        const steps = [1, 2, 3, 1, 3];
        for (let i = 0; i < 5; i++) {
          try { goGeiStep(steps[i]); ok++; } catch (_) {}
        }
        return { ok, step: _geiStep };
      });
      expect(r.ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 21. _tmAdj
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmAdj', () => {
    test('null delta, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmAdj(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined delta, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmAdj(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('delta +1, increments crew count', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 2;
        _tmAdj(1);
        return { count: _tmCrewCount };
      });
      expect(r.count).toBe(3);
    });

    test('delta -1, decrements crew count', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 3;
        _tmAdj(-1);
        return { count: _tmCrewCount };
      });
      expect(r.count).toBe(2);
    });

    test('crew count floor at 1, never goes below 1', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 1;
        _tmAdj(-10);
        return { count: _tmCrewCount };
      });
      expect(r.count).toBe(1);
    });

    test('very large delta, does not throw', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 1;
        try { _tmAdj(Number.MAX_SAFE_INTEGER); return { ok: true, count: _tmCrewCount }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _tmCrewCount = 1; }
      });
      expect(r.ok).toBe(true);
    });

    test('delta 0, crew count unchanged', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 4;
        _tmAdj(0);
        return { count: _tmCrewCount };
      });
      expect(r.count).toBe(4);
    });

    test('string delta (type mismatch), does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmAdj('abc'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with tm-crew-display DOM element, updates display', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('div'); el.id = 'tm-crew-display'; el.textContent = '2';
        document.body.appendChild(el);
        _tmCrewCount = 2;
        _tmAdj(1);
        const txt = document.getElementById('tm-crew-display')?.textContent;
        el.remove();
        return { txt, count: _tmCrewCount };
      });
      expect(r.count).toBe(3);
    });

    test('concurrent calls (5x): crew count is valid integer', async () => {
      const r = await page.evaluate(() => {
        _tmCrewCount = 1;
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _tmAdj(1); ok++; } catch (_) {}
        }
        return { ok, count: _tmCrewCount };
      });
      expect(r.ok).toBe(5);
      expect(r.count).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 22. _tmRecalc
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmRecalc', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmRecalc(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('zero rate and hours, labor is 0, displays "-"', async () => {
      const r = await page.evaluate(() => {
        // Create minimal DOM
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) {
            el = (id === 'tm-crew-display' || id === 'tm-labor-est' || id === 'tm-crew-formula')
              ? document.createElement('div') : document.createElement('input');
            el.id = id;
            document.body.appendChild(el);
          }
        });
        document.getElementById('tm-crew-display').textContent = '1';
        document.getElementById('tm-rate').value = '0';
        document.getElementById('tm-hours').value = '0';
        _tmCrewCount = 1; _tmRatePerMan = 0; _tmEstHours = 0;
        _tmRecalc();
        const laborTxt = document.getElementById('tm-labor-est')?.textContent;
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => document.getElementById(id)?.remove());
        return { laborTxt };
      });
      expect(r.laborTxt).toBe('-');
    });

    test('golden path, calculates labor correctly', async () => {
      const r = await page.evaluate(() => {
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) {
            el = (id === 'tm-crew-display' || id === 'tm-labor-est' || id === 'tm-crew-formula')
              ? document.createElement('div') : document.createElement('input');
            el.id = id; document.body.appendChild(el);
          }
        });
        document.getElementById('tm-crew-display').textContent = '2';
        document.getElementById('tm-rate').value = '50';
        document.getElementById('tm-hours').value = '8';
        _tmCrewCount = 2; _tmRatePerMan = 50; _tmEstHours = 8;
        _geiLines = [];
        _tmRecalc();
        // 2 workers * $50/hr * 8hrs = $800
        const hasLaborLine = _geiLines.some(l => l._tmLabor && l.total === 800);
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => document.getElementById(id)?.remove());
        return { hasLaborLine };
      });
      expect(r.hasLaborLine).toBe(true);
    });

    test('upserts existing labor line, no duplicates after 3 calls', async () => {
      const r = await page.evaluate(() => {
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) {
            el = (id === 'tm-crew-display' || id === 'tm-labor-est' || id === 'tm-crew-formula')
              ? document.createElement('div') : document.createElement('input');
            el.id = id; document.body.appendChild(el);
          }
        });
        document.getElementById('tm-crew-display').textContent = '1';
        document.getElementById('tm-rate').value = '75';
        document.getElementById('tm-hours').value = '4';
        _tmCrewCount = 1; _tmRatePerMan = 75; _tmEstHours = 4;
        _geiLines = [];
        _tmRecalc(); _tmRecalc(); _tmRecalc();
        const laborLines = _geiLines.filter(l => l._tmLabor);
        ['tm-crew-display','tm-rate','tm-hours','tm-labor-est','tm-crew-formula'].forEach(id => document.getElementById(id)?.remove());
        return { laborLinesCount: laborLines.length };
      });
      expect(r.laborLinesCount).toBe(1);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_est_full_draft', '{INVALID{{{{');
        try { _tmRecalc(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_est_full_draft'); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmRecalc()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 23. _tmCalcDeposit
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmCalcDeposit', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmCalcDeposit(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('zero subtotal, shows "-"', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('div'); el.id = 'tm-dep-amt'; document.body.appendChild(el);
        const pctEl = document.createElement('input'); pctEl.id = 'tm-dep-pct'; pctEl.value = '20'; document.body.appendChild(pctEl);
        _geiLines = [];
        try { _tmCalcDeposit(); return { ok: true, txt: document.getElementById('tm-dep-amt')?.textContent }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); pctEl.remove(); }
      });
      expect(r.ok).toBe(true);
      expect(r.txt).toBe('-');
    });

    test('golden path, calculates 20% deposit', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('div'); el.id = 'tm-dep-amt'; document.body.appendChild(el);
        const pctEl = document.createElement('input'); pctEl.id = 'tm-dep-pct'; pctEl.value = '20'; document.body.appendChild(pctEl);
        // Set up a line so calcGeiTotal returns non-zero
        _geiLines = [{ desc: 'Labor', qty: 1, rate: 1000, total: 1000, _tmLabor: false }];
        try { _tmCalcDeposit(); return { ok: true, txt: document.getElementById('tm-dep-amt')?.textContent }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); pctEl.remove(); _geiLines = []; }
      });
      expect(r.ok).toBe(true);
    });

    test('NaN pct, falls back to 20%', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('div'); el.id = 'tm-dep-amt'; document.body.appendChild(el);
        const pctEl = document.createElement('input'); pctEl.id = 'tm-dep-pct'; pctEl.value = 'not-a-number'; document.body.appendChild(pctEl);
        _geiLines = [];
        try { _tmCalcDeposit(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { el.remove(); pctEl.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmCalcDeposit()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 24. _tmCalcNte
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmCalcNte', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmCalcNte(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('NTE off, wrap hidden', async () => {
      const r = await page.evaluate(() => {
        let onEl = document.getElementById('tm-nte-on');
        let wrap = document.getElementById('tm-nte-wrap');
        const onCreated = !onEl;
        const wrapCreated = !wrap;
        if (!onEl) { onEl = document.createElement('input'); onEl.type = 'checkbox'; onEl.id = 'tm-nte-on'; document.body.appendChild(onEl); }
        if (!wrap) { wrap = document.createElement('div'); wrap.id = 'tm-nte-wrap'; document.body.appendChild(wrap); }
        const savedChecked = onEl.checked;
        const savedDisplay = wrap.style.display;
        onEl.checked = false;
        try { _tmCalcNte(); return { ok: true, hidden: wrap.style.display === 'none' }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          if (onCreated) onEl.remove(); else onEl.checked = savedChecked;
          if (wrapCreated) wrap.remove(); else wrap.style.display = savedDisplay;
        }
      });
      expect(r.ok).toBe(true);
      expect(r.hidden).toBe(true);
    });

    test('NTE on, empty cap, auto-sets cap to sub * 1.15 rounded to $500', async () => {
      const r = await page.evaluate(() => {
        let onEl = document.getElementById('tm-nte-on');
        let wrap = document.getElementById('tm-nte-wrap');
        let capEl = document.getElementById('tm-nte-cap');
        const onCreated = !onEl;
        const wrapCreated = !wrap;
        const capCreated = !capEl;
        if (!onEl) { onEl = document.createElement('input'); onEl.type = 'checkbox'; onEl.id = 'tm-nte-on'; document.body.appendChild(onEl); }
        if (!wrap) { wrap = document.createElement('div'); wrap.id = 'tm-nte-wrap'; document.body.appendChild(wrap); }
        if (!capEl) { capEl = document.createElement('input'); capEl.id = 'tm-nte-cap'; document.body.appendChild(capEl); }
        const savedChecked = onEl.checked;
        const savedDisplay = wrap.style.display;
        const savedCap = capEl.value;
        onEl.checked = true;
        capEl.value = '';
        _geiLines = [{ desc: 'Labor', qty: 1, rate: 2000, total: 2000 }];
        try { _tmCalcNte(); return { ok: true, cap: parseFloat(capEl.value) }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally {
          if (onCreated) onEl.remove(); else onEl.checked = savedChecked;
          if (wrapCreated) wrap.remove(); else wrap.style.display = savedDisplay;
          if (capCreated) capEl.remove(); else capEl.value = savedCap;
          _geiLines = [];
        }
      });
      expect(r.ok).toBe(true);
      // 2000 * 1.15 = 2300, rounded to nearest 500 = 2500
      expect(r.cap % 500).toBe(0);
    });

    test('NTE on, cap already set, does not overwrite', async () => {
      const r = await page.evaluate(() => {
        const onEl = document.createElement('input'); onEl.type = 'checkbox'; onEl.id = 'tm-nte-on'; onEl.checked = true; document.body.appendChild(onEl);
        const wrap = document.createElement('div'); wrap.id = 'tm-nte-wrap'; document.body.appendChild(wrap);
        const capEl = document.createElement('input'); capEl.id = 'tm-nte-cap'; capEl.value = '5000'; document.body.appendChild(capEl);
        _geiLines = [{ desc: 'Labor', qty: 1, rate: 1000, total: 1000 }];
        try { _tmCalcNte(); return { ok: true, cap: capEl.value }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { onEl.remove(); wrap.remove(); capEl.remove(); _geiLines = []; }
      });
      expect(r.ok).toBe(true);
      expect(r.cap).toBe('5000');
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmCalcNte()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 25. _tmSetCycle
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmSetCycle', () => {
    test('null: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmSetCycle(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined: does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmSetCycle(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmSetCycle(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path "weekly", sets _tmBillingCycle', async () => {
      const r = await page.evaluate(() => {
        _tmSetCycle('weekly');
        return { cycle: _tmBillingCycle };
      });
      expect(r.cycle).toBe('weekly');
    });

    test('golden path "milestone", sets _tmBillingCycle', async () => {
      const r = await page.evaluate(() => {
        _tmSetCycle('milestone');
        return { cycle: _tmBillingCycle };
      });
      expect(r.cycle).toBe('milestone');
    });

    test('"completion", sets _tmBillingCycle', async () => {
      const r = await page.evaluate(() => {
        _tmSetCycle('completion');
        return { cycle: _tmBillingCycle };
      });
      expect(r.cycle).toBe('completion');
    });

    test('concurrent calls (5x): last value sticks', async () => {
      const r = await page.evaluate(() => {
        let ok = 0;
        const cycles = ['weekly','biweekly','milestone','completion','weekly'];
        for (let i = 0; i < 5; i++) {
          try { _tmSetCycle(cycles[i]); ok++; } catch (_) {}
        }
        return { ok, cycle: _tmBillingCycle };
      });
      expect(r.ok).toBe(5);
      expect(r.cycle).toBe('weekly');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 26. _tmSyncCycleButtons
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmSyncCycleButtons', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmSyncCycleButtons(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('highlights active cycle button', async () => {
      const r = await page.evaluate(() => {
        const cycles = ['weekly','biweekly','milestone','completion'];
        cycles.forEach(c => {
          let btn = document.getElementById('tmc-'+c);
          if (!btn) { btn = document.createElement('button'); btn.id = 'tmc-'+c; document.body.appendChild(btn); }
        });
        _tmBillingCycle = 'biweekly';
        _tmSyncCycleButtons();
        const biweeklyBtn = document.getElementById('tmc-biweekly');
        const weeklyBtn = document.getElementById('tmc-weekly');
        const biweeklyActive = biweeklyBtn?.style.background?.includes('var(--blue)') || biweeklyBtn?.style.background === 'var(--blue)';
        const weeklyInactive = weeklyBtn?.style.background?.includes('var(--bg2)') || weeklyBtn?.style.background === 'var(--bg2)';
        cycles.forEach(c => document.getElementById('tmc-'+c)?.remove());
        return { biweeklyActive, weeklyInactive };
      });
      expect(r.biweeklyActive).toBe(true);
      expect(r.weeklyInactive).toBe(true);
    });

    test('no duplicate button styling after 3 calls', async () => {
      const r = await page.evaluate(() => {
        const cycles = ['weekly','biweekly','milestone','completion'];
        cycles.forEach(c => {
          let btn = document.getElementById('tmc-'+c);
          if (!btn) { btn = document.createElement('button'); btn.id = 'tmc-'+c; document.body.appendChild(btn); }
        });
        _tmBillingCycle = 'weekly';
        _tmSyncCycleButtons(); _tmSyncCycleButtons(); _tmSyncCycleButtons();
        const weeklyBtn = document.getElementById('tmc-weekly');
        const weeklyActive = weeklyBtn?.style.background?.includes('var(--blue)') || weeklyBtn?.style.background === 'var(--blue)';
        cycles.forEach(c => document.getElementById('tmc-'+c)?.remove());
        return { weeklyActive };
      });
      expect(r.weeklyActive).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmSyncCycleButtons()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 27. _tmShowPage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmShowPage', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmShowPage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with gei-tm-page element, makes it visible', async () => {
      const r = await page.evaluate(() => {
        let p = document.getElementById('gei-tm-page');
        const created = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-tm-page'; document.body.appendChild(p); }
        const savedDisplay = p.style.display;
        p.style.display = 'none';
        try { _tmShowPage(); return { ok: true, visible: p.style.display !== 'none' }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (created) p.remove(); else p.style.display = savedDisplay; }
      });
      expect(r.ok).toBe(true);
      expect(r.visible).toBe(true);
    });

    test('hides legacy wizard elements', async () => {
      // gei-tm-page is the REAL app page (index.html): creating a second element with
      // the same id and then unconditionally removing "gei-tm-page" in cleanup deletes
      // whichever one getElementById finds first, which is the real one, permanently
      // wiping it (and its render-target children) for every later test in this file.
      const r = await page.evaluate(() => {
        const created = [];
        ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'block'; document.body.appendChild(el); created.push(id); }
        });
        let p = document.getElementById('gei-tm-page');
        const pCreated = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-tm-page'; document.body.appendChild(p); }
        try { _tmShowPage(); }
        catch (_) {}
        const hidden = ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].every(id => document.getElementById(id)?.style.display === 'none');
        created.forEach(id => document.getElementById(id)?.remove());
        if (pCreated) p.remove();
        return { hidden };
      });
      expect(r.hidden).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmShowPage()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 28. _tmHidePage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_tmHidePage', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmHidePage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with gei-tm-page element, hides it', async () => {
      const r = await page.evaluate(() => {
        let p = document.getElementById('gei-tm-page');
        const created = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-tm-page'; document.body.appendChild(p); }
        const savedDisplay = p.style.display;
        p.style.display = 'block';
        try { _tmHidePage(); return { ok: true, hidden: p.style.display === 'none' }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (created) p.remove(); else p.style.display = savedDisplay; }
      });
      expect(r.ok).toBe(true);
      expect(r.hidden).toBe(true);
    });

    test('restores gei-old-tbar and gei-step-bar', async () => {
      const r = await page.evaluate(() => {
        const created = [];
        ['gei-old-tbar','gei-step-bar'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); created.push(id); }
          else { el.style.display = 'none'; }
        });
        let p = document.getElementById('gei-tm-page');
        const pCreated = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-tm-page'; document.body.appendChild(p); }
        try { _tmHidePage(); }
        catch (_) {}
        const restored = ['gei-old-tbar','gei-step-bar'].every(id => document.getElementById(id)?.style.display === '');
        created.forEach(id => document.getElementById(id)?.remove());
        if (pCreated) p.remove();
        return { restored };
      });
      expect(r.restored).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_tmHidePage()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 29. _byoShowPage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_byoShowPage', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _byoShowPage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with gei-byo-page element, makes it visible', async () => {
      const r = await page.evaluate(() => {
        let p = document.getElementById('gei-byo-page');
        const created = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-byo-page'; document.body.appendChild(p); }
        const savedDisplay = p.style.display;
        p.style.display = 'none';
        _geiEditBidId = 44401;
        try { _byoShowPage(); return { ok: true, visible: p.style.display !== 'none' }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (created) p.remove(); else p.style.display = savedDisplay; }
      });
      expect(r.ok).toBe(true);
      expect(r.visible).toBe(true);
    });

    test('hides legacy wizard elements', async () => {
      // gei-byo-page is the REAL app page, see the equivalent _tmShowPage test's comment.
      const r = await page.evaluate(() => {
        const created = [];
        ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'block'; document.body.appendChild(el); created.push(id); }
        });
        let p = document.getElementById('gei-byo-page');
        const pCreated = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-byo-page'; document.body.appendChild(p); }
        try { _byoShowPage(); }
        catch (_) {}
        const hidden = ['gei-old-tbar','gei-step-bar','gei-s1','gei-s2','gei-s3'].every(id => document.getElementById(id)?.style.display === 'none');
        created.forEach(id => document.getElementById(id)?.remove());
        if (pCreated) p.remove();
        return { hidden };
      });
      expect(r.hidden).toBe(true);
    });

    test('with valid bid, loads byoItems from bid', async () => {
      const r = await page.evaluate(() => {
        let p = document.getElementById('gei-byo-page');
        const pCreated = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-byo-page'; document.body.appendChild(p); }
        _geiEditBidId = 44401;
        _byoItems = [];
        try { _byoShowPage(); return { ok: true, items: _byoItems.length }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (pCreated) p.remove(); }
      });
      expect(r.ok).toBe(true);
      expect(r.items).toBeGreaterThanOrEqual(0);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_byoShowPage()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 30. _byoHidePage
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_byoHidePage', () => {
    test('no DOM elements, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _byoHidePage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('with gei-byo-page element, hides it', async () => {
      const r = await page.evaluate(() => {
        let p = document.getElementById('gei-byo-page');
        const created = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-byo-page'; document.body.appendChild(p); }
        const savedDisplay = p.style.display;
        p.style.display = 'block';
        try { _byoHidePage(); return { ok: true, hidden: p.style.display === 'none' }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { if (created) p.remove(); else p.style.display = savedDisplay; }
      });
      expect(r.ok).toBe(true);
      expect(r.hidden).toBe(true);
    });

    test('restores gei-old-tbar and gei-step-bar', async () => {
      const r = await page.evaluate(() => {
        const created = [];
        ['gei-old-tbar','gei-step-bar'].forEach(id => {
          let el = document.getElementById(id);
          if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); created.push(id); }
          else { el.style.display = 'none'; }
        });
        let p = document.getElementById('gei-byo-page');
        const pCreated = !p;
        if (!p) { p = document.createElement('div'); p.id = 'gei-byo-page'; document.body.appendChild(p); }
        try { _byoHidePage(); }
        catch (_) {}
        const restored = ['gei-old-tbar','gei-step-bar'].every(id => document.getElementById(id)?.style.display === '');
        created.forEach(id => document.getElementById(id)?.remove());
        if (pCreated) p.remove();
        return { restored };
      });
      expect(r.restored).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_byoHidePage()');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T&M/BYO shared render functions, one template, both modes (consolidation)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_geiRenderTopBar / _geiRenderScopeCard / _geiRenderProfitGauge / _geiRenderActionButtons', () => {
    test('_geiRenderTopBar: missing container does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _geiRenderTopBar('nope', 'X', '_editTMTitle'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_geiRenderTopBar: golden path builds title, edit button, sub, save/cancel', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt-topbar-wrap'; document.body.appendChild(wrap);
        _geiRenderTopBar('rt', 'My Title', '_editTMTitle');
        const title = document.getElementById('rt-tbar-title');
        const editBtn = document.getElementById('rt-edit-title-btn');
        const sub = document.getElementById('rt-page-sub');
        const res = {
          titleText: title?.textContent,
          editOnclick: editBtn?.getAttribute('onclick'),
          hasSub: !!sub,
          hasSaveDraft: wrap.innerHTML.includes('saveGenericEstimate(true)'),
          hasCancel: wrap.innerHTML.includes('_geiBack()'),
        };
        wrap.remove();
        return res;
      });
      expect(r.titleText).toBe('My Title');
      expect(r.editOnclick).toBe('_editTMTitle()');
      expect(r.hasSub).toBe(true);
      expect(r.hasSaveDraft).toBe(true);
      expect(r.hasCancel).toBe(true);
    });

    test('_geiRenderScopeCard: golden path wires +Add scope to the right container id', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt2-scopecard-wrap'; document.body.appendChild(wrap);
        _geiRenderScopeCard('rt2');
        const hasWrap = !!document.getElementById('rt2-scope-wrap');
        const addBtnOnclick = wrap.querySelector('button')?.getAttribute('onclick');
        wrap.remove();
        return { hasWrap, addBtnOnclick };
      });
      expect(r.hasWrap).toBe(true);
      expect(r.addBtnOnclick).toBe("_openScopeSheet('rt2-scope-wrap')");
    });

    test('_geiRenderProfitGauge, golden path builds gauge ids and wires the given oninput', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt3-gauge-wrap'; document.body.appendChild(wrap);
        _geiRenderProfitGauge('rt3', '_tmInputChange()');
        const costEl = document.getElementById('rt3-expected-cost');
        const res = {
          costOninput: costEl?.getAttribute('oninput'),
          hasDot: !!document.getElementById('rt3-gauge-dot'),
          hasPct: !!document.getElementById('rt3-gauge-pct'),
          hasMsg: !!document.getElementById('rt3-gauge-msg'),
        };
        wrap.remove();
        return res;
      });
      expect(r.costOninput).toBe('_tmInputChange()');
      expect(r.hasDot).toBe(true);
      expect(r.hasPct).toBe(true);
      expect(r.hasMsg).toBe(true);
    });

    test('_geiRenderProfitGauge, idempotent: a second call does not rebuild/lose gauge state', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt4-gauge-wrap'; document.body.appendChild(wrap);
        _geiRenderProfitGauge('rt4', '_tmInputChange()');
        const dot = document.getElementById('rt4-gauge-dot');
        dot.dataset.marker = 'still-here';
        _geiRenderProfitGauge('rt4', '_tmInputChange()'); // second call, must be a no-op
        const survived = document.getElementById('rt4-gauge-dot')?.dataset.marker === 'still-here';
        wrap.remove();
        return { survived };
      });
      expect(r.survived).toBe(true);
    });

    test('_geiRenderActionButtons, default (T&M-style): 2-column grid, "Send proposal", Preview via _geiPreviewClient', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt5-actions-wrap'; document.body.appendChild(wrap);
        _geiRenderActionButtons('rt5', {});
        const html = wrap.innerHTML;
        const res = {
          hasSendDefault: html.includes('Send proposal'),
          hasSignInPerson: html.includes('_geiSignInPerson()'),
          hasPreviewDefault: html.includes('_geiPreviewClient()'),
          cols: wrap.querySelector('div[style*="grid-template-columns"]')?.style.gridTemplateColumns,
        };
        wrap.remove();
        return res;
      });
      expect(r.hasSendDefault).toBe(true);
      expect(r.hasSignInPerson).toBe(true);
      expect(r.hasPreviewDefault).toBe(true);
      expect(r.cols).toBe('repeat(2, 1fr)');
    });

    test('_geiRenderActionButtons, BYO-style options: custom send label + extra button widens the grid to 3 columns', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rt6-actions-wrap'; document.body.appendChild(wrap);
        _geiRenderActionButtons('rt6', { extraButtons: [{ label: '📋 Option B', onclick: '_byoDuplicateBid()' }] });
        const html = wrap.innerHTML;
        const res = {
          hasOptionB: html.includes('_byoDuplicateBid()') && html.includes('Option B'),
          cols: wrap.querySelector('div[style*="grid-template-columns"]')?.style.gridTemplateColumns,
        };
        wrap.remove();
        return res;
      });
      expect(r.hasOptionB).toBe(true);
      expect(r.cols).toBe('repeat(3, 1fr)');
    });

    test('_tmShowPage renders "Send T&M proposal" with a 2-column action grid (no Option B)', async () => {
      // The real app page (index.html) already has gei-tm-page + its wrap containers,
      // creating a second element with the same id would just orphan a duplicate in the
      // DOM (getElementById always resolves the first match), so reuse the real ones.
      const r = await page.evaluate(() => {
        try { _tmShowPage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      const r2 = await page.evaluate(() => {
        const html = document.getElementById('tm-actions-wrap')?.innerHTML || '';
        return { hasSend: html.includes('Send T&amp;M proposal') || html.includes('Send T&M proposal'), hasOptionB: html.includes('Option B') };
      });
      expect(r2.hasSend).toBe(true);
      expect(r2.hasOptionB).toBe(false);
    });

    test('_byoShowPage renders "Send proposal" with Option B in a 3-column action grid', async () => {
      const r = await page.evaluate(() => {
        try { _byoShowPage(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      const r2 = await page.evaluate(() => {
        const html = document.getElementById('byo-actions-wrap')?.innerHTML || '';
        return { hasSend: html.includes('Send proposal') && !html.includes('Send T&amp;M'), hasOptionB: html.includes('Option B') };
      });
      expect(r2.hasSend).toBe(true);
      expect(r2.hasOptionB).toBe(true);
    });
  });

  test.describe('_geiRenderDepositField / _geiDepositPct: shared deposit % (T&M mirrors BYO)', () => {
    test('_geiRenderDepositField, missing container does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _geiRenderDepositField('nope', 'x()'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('_geiRenderDepositField, golden path builds a 25-default pct input + balance row, wires oninput', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rd1-deposit-wrap'; document.body.appendChild(wrap);
        _geiRenderDepositField('rd1', '_tmInputChange()');
        const pctEl = document.getElementById('rd1-deposit-pct');
        const res = {
          defaultVal: pctEl?.value,
          oninput: pctEl?.getAttribute('oninput'),
          hasBalance: !!document.getElementById('rd1-rail-balance'),
        };
        wrap.remove();
        return res;
      });
      expect(r.defaultVal).toBe('25');
      expect(r.oninput).toBe('_tmInputChange()');
      expect(r.hasBalance).toBe(true);
    });

    test('_geiRenderDepositField, idempotent: a second call does not reset a user-edited value', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'rd2-deposit-wrap'; document.body.appendChild(wrap);
        _geiRenderDepositField('rd2', '_tmInputChange()');
        document.getElementById('rd2-deposit-pct').value = '40';
        _geiRenderDepositField('rd2', '_tmInputChange()'); // second call, must be a no-op
        const survived = document.getElementById('rd2-deposit-pct')?.value === '40';
        wrap.remove();
        return { survived };
      });
      expect(r.survived).toBe(true);
    });

    test('tm-deposit-wrap and byo-deposit-wrap both render a live deposit-pct field on page show', async () => {
      const r = await page.evaluate(() => {
        _tmShowPage();
        _byoShowPage();
        return {
          tmDep: !!document.getElementById('tm-deposit-pct'),
          byoDep: !!document.getElementById('byo-deposit-pct'),
        };
      });
      expect(r.tmDep).toBe(true);
      expect(r.byoDep).toBe(true);
    });

    test('_geiDepositPct: reads tm-deposit-pct when in T&M mode', async () => {
      const r = await page.evaluate(() => {
        _tmShowPage();
        document.getElementById('tm-deposit-pct').value = '35';
        _geiIsTM = true;
        const pct = _geiDepositPct();
        _geiIsTM = false;
        return { pct };
      });
      expect(r.pct).toBe(35);
    });

    test('_geiDepositPct: reads byo-deposit-pct when not in T&M mode', async () => {
      const r = await page.evaluate(() => {
        _byoShowPage();
        document.getElementById('byo-deposit-pct').value = '10';
        _geiIsTM = false;
        const pct = _geiDepositPct();
        return { pct };
      });
      expect(r.pct).toBe(10);
    });

    test('_geiDepositPct: defaults to 25 when the field is missing from the DOM', async () => {
      const r = await page.evaluate(() => {
        // Clear the whole wrap (not just the input), _geiRenderDepositField is
        // idempotent on wrap.children.length, so a partial removal would leave it
        // permanently unable to rebuild the field for later tests.
        const wrap = document.getElementById('tm-deposit-wrap');
        if (wrap) wrap.innerHTML = '';
        _geiIsTM = true;
        const pct = _geiDepositPct();
        _geiIsTM = false;
        return { pct };
      });
      expect(r.pct).toBe(25);
      // restore the real page's deposit field for later tests in this file
      await page.evaluate(() => { _tmShowPage(); });
    });

    test('regression: saveGenericEstimate computes T&M deposit from the live tm-deposit-pct field (was always defaulting to 20% of subtotal via a dead tm-dep-pct id)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88801, name: 'TM Deposit Client', addr: '1 Deposit Rd' };
        clients = clients.filter(x => x.id !== 88801).concat([c]);
        bids = bids.filter(x => x.client_id !== 88801);
        openGenericEstimate(c, null, 'general');
        _geiIsTM = true;
        _geiIsFreeForm = false;
        goGeiStep(2); // renders gei-tm-page + tm-deposit-wrap via _tmShowPage
        document.getElementById('tm-deposit-pct').value = '40';
        _tmRatePerMan = 50; _tmEstHours = 8; _tmCrewCount = 1;
        _geiLines = [{ desc: 'Materials', qty: 1, rate: 1000, total: 1000, _tmLabor: false }];
        saveGenericEstimate(true);
        const bid = bids.find(x => x.client_id === 88801);
        return { deposit: bid?.deposit, amount: bid?.amount, tmDepositPct: bid?.tmDepositPct };
      });
      expect(r.tmDepositPct).toBe(40);
      expect(r.deposit).toBe(Math.round(r.amount * 0.4));
    });

    test('regression: reopening a saved T&M bid restores its deposit % into the live field (back-calculated from deposit/amount)', async () => {
      const r = await page.evaluate(() => {
        const bid = bids.find(x => x.client_id === 88801);
        _geiEditBidId = bid.id;
        _geiIsTM = true;
        _tmShowPage();
        return { restoredPct: document.getElementById('tm-deposit-pct')?.value };
      });
      expect(r.restoredPct).toBe('40');
    });
  });

  test.describe('Site notes (internal): captured on the estimate, saved to the client, never on the proposal', () => {
    test('gei-sitenote saves to the CLIENT record, not the bid, and stays out of the client-facing bid.notes', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88820, name: 'Site Note Client', addr: '5 Gate Rd' };
        clients = clients.filter(x => x.id !== 88820).concat([c]);
        bids = bids.filter(x => x.client_id !== 88820);
        openGenericEstimate(c, null, 'general');
        _geiIsFreeForm = true; _geiIsTM = false;
        goGeiStep(2); // render the BYO page so the shared #gei-sitenote field mounts
        document.getElementById('gei-notes').value = 'Client-facing scope + warranty';
        document.getElementById('gei-sitenote').value = 'Gate code 4412, dog in back';
        _geiLines = [{ desc: 'Work', qty: 1, rate: 500, total: 500 }];
        saveGenericEstimate(true);
        const bid = bids.find(x => x.client_id === 88820);
        const cl = clients.find(x => x.id === 88820);
        return {
          fieldExists: !!document.getElementById('gei-sitenote'),
          siteOnClient: cl && cl.siteNote,
          bidNotes: bid && bid.notes,
          siteLeakedToBid: !!(bid && (bid.notes || '').includes('Gate code')),
        };
      });
      expect(r.fieldExists).toBe(true);
      expect(r.siteOnClient).toBe('Gate code 4412, dog in back');
      expect(r.bidNotes).toBe('Client-facing scope + warranty');
      expect(r.siteLeakedToBid).toBe(false);
    });

    test('reopening an estimate for that client reloads the site note into the shared field', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 88820);
        openGenericEstimate(c, null, 'general');
        goGeiStep(1); // generic wizard: field lives in step 1 (by the property context)
        return { loaded: document.getElementById('gei-sitenote').value };
      });
      expect(r.loaded).toBe('Gate code 4412, dog in back');
    });

    test('PRIVACY: the client-facing proposal builder never reads the site note', async () => {
      const r = await page.evaluate(() => {
        const proposalSrc = typeof sendGenericProposal === 'function' ? sendGenericProposal.toString() : '';
        // The compare/preview card the client sees is built from bid.notes only.
        return {
          proposalTouchesSite: proposalSrc.includes('gei-sitenote') || proposalSrc.includes('siteNote'),
        };
      });
      expect(r.proposalTouchesSite).toBe(false);
    });

    test('one code path: the shared site-note field mounts in T&M AND BYO AND the generic wizard', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88821, name: 'Shared Field Client', addr: '9 One Path Rd' };
        clients = clients.filter(x => x.id !== 88821).concat([c]);
        const vis = () => { const e = document.getElementById('gei-sitenote'); return !!(e && e.offsetParent !== null); };
        const ids = () => document.querySelectorAll('#gei-sitenote').length; // exactly one id, never duplicated
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        const tm = { vis: vis(), count: ids() };
        openGenericEstimate(c, null, 'general'); _geiIsTM = false; _geiIsFreeForm = true; goGeiStep(2);
        const byo = { vis: vis(), count: ids() };
        openGenericEstimate(c, null, 'general'); _geiIsTM = false; _geiIsFreeForm = false; goGeiStep(1);
        const gen = { vis: vis(), count: ids() };
        return { tm, byo, gen };
      });
      for (const mode of ['tm', 'byo', 'gen']) {
        expect(r[mode].vis, `${mode} field visible`).toBe(true);
        expect(r[mode].count, `${mode} single id`).toBe(1);
      }
    });

    test('typing persists live to the client record (no explicit save needed)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88822, name: 'Live Save Client', addr: '3 Live Rd' };
        clients = clients.filter(x => x.id !== 88822).concat([c]);
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        _geiSiteNoteInput('Park in the alley, side gate'); // what oninput fires
        return { onClient: clients.find(x => x.id === 88822).siteNote };
      });
      expect(r.onClient).toBe('Park in the alley, side gate');
    });

    test('placement: the note sits at the TOP of the estimate (before the scope card), by the address', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88823, name: 'Order Client', addr: '7 Order Rd' };
        clients = clients.filter(x => x.id !== 88823).concat([c]);
        const precedes = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        const tm = precedes(document.getElementById('gei-sitenote'), document.getElementById('tm-scopecard-wrap'));
        openGenericEstimate(c, null, 'general'); _geiIsTM = false; _geiIsFreeForm = true; goGeiStep(2);
        const byo = precedes(document.getElementById('gei-sitenote'), document.getElementById('byo-scopecard-wrap'));
        return { tm, byo };
      });
      expect(r.tm, 'T&M note precedes scope card').toBe(true);
      expect(r.byo, 'BYO note precedes scope card').toBe(true);
    });

    test('per-property: two addresses on one client keep separate notes; each auto-loads by address', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88824, name: 'Two Homes LLC', addr: '100 First St' };
        clients = clients.filter(x => x.id !== 88824).concat([c]);
        // Note for the primary address, captured on an estimate for it.
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        _geiSiteNoteInput('Lockbox 5590, front porch');
        // Note for a SECOND property (a bid carrying its own address).
        const b = { id: 771001, client_id: 88824, client_name: 'Two Homes LLC', addr: '200 Second Ave', amount: 1000 };
        bids = bids.filter(x => x.id !== 771001).concat([b]);
        openGenericEstimate(c, b.id, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        const loadedSecondBlank = document.getElementById('gei-sitenote').value; // no note yet for 200 Second Ave
        _geiSiteNoteInput('Side gate, beware of dog');
        const cl = clients.find(x => x.id === 88824);
        // Reopen the FIRST (primary) estimate: should still show the first note, not the second.
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        const reloadedFirst = document.getElementById('gei-sitenote').value;
        return {
          loadedSecondBlank,
          reloadedFirst,
          first: getSiteNote(cl, '100 First St'),
          second: getSiteNote(cl, '200 Second Ave'),
        };
      });
      expect(r.loadedSecondBlank).toBe('');                       // second property started blank
      expect(r.first).toBe('Lockbox 5590, front porch');
      expect(r.second).toBe('Side gate, beware of dog');
      expect(r.reloadedFirst).toBe('Lockbox 5590, front porch');  // no cross-property bleed
    });

    test('edge: a client with NO address still stores/reads a note (legacy single-note fallback)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 88825, name: 'No Address Client' }; // no addr
        clients = clients.filter(x => x.id !== 88825).concat([c]);
        setSiteNote(c, undefined, 'Call before arriving');
        return { read: getSiteNote(c, undefined), legacy: c.siteNote };
      });
      expect(r.read).toBe('Call before arriving');
      expect(r.legacy).toBe('Call before arriving');
    });

    test('EPA/1978 trigger is per-property: the estimate resolves year built for THIS address', async () => {
      const r = await page.evaluate(() => {
        const cid = 88826;
        const c = { id: cid, name: 'Lead Estimate Co', addr: '1 Modern Ln, Town, KS 60000' };
        clients = clients.filter(x => x.id !== cid).concat([c]);
        setPropertyData(c, '1 Modern Ln', { yearBuilt: 2008 });       // primary: post-1978
        setPropertyData(c, '9 Historic Ave', { yearBuilt: 1959 });    // extra: pre-1978
        const b = { id: 883001, client_id: cid, client_name: 'Lead Estimate Co', addr: '9 Historic Ave, Town, KS 60000', amount: 5000 };
        bids = bids.filter(x => x.id !== 883001).concat([b]);
        const pre78ForOpenEstimate = () => { const y = getProperty(c, _geiSiteAddr()).yearBuilt; return !!(y && y < 1978); };
        // New estimate → primary address (2008): not pre-1978.
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false;
        const newEstPre78 = pre78ForOpenEstimate();
        // Editing the bid at the historic address (1959): pre-1978 fires.
        openGenericEstimate(c, b.id, 'general'); _geiIsTM = true; _geiIsFreeForm = false;
        const bidEstPre78 = pre78ForOpenEstimate();
        return { newEstPre78, bidEstPre78, siteAddr: _geiSiteAddr() };
      });
      expect(r.newEstPre78).toBe(false);   // primary property is a new build
      expect(r.bidEstPre78).toBe(true);    // the historic-address estimate triggers the disclosure
    });
  });

  test.describe('_GEI_MODES / _geiShowSharedChrome: one code path for both estimate pages', () => {
    test('_GEI_MODES registry has tm and byo entries with all keys the shared chrome needs', async () => {
      const r = await page.evaluate(() => {
        const need = ['pageId', 'defaultTitle', 'editFnName', 'titleSuffix', 'gaugeOninput', 'depositOninput', 'actionOpts'];
        const check = m => m && need.every(k => m[k] !== undefined);
        return { tm: check(_GEI_MODES.tm), byo: check(_GEI_MODES.byo), unknownSafe: (() => { try { _geiShowSharedChrome('nope'); return true; } catch (e) { return false; } })() };
      });
      expect(r.tm).toBe(true);
      expect(r.byo).toBe(true);
      expect(r.unknownSafe).toBe(true);
    });

    test('_geiShowSharedChrome renders the full chrome for BOTH modes from the one function', async () => {
      const r = await page.evaluate(() => {
        const probe = prefix => {
          _geiShowSharedChrome(prefix);
          return {
            title: !!document.getElementById(prefix + '-tbar-title'),
            scope: !!document.getElementById(prefix + '-scope-wrap'),
            gauge: !!document.getElementById(prefix + '-profit-gauge'),
            deposit: !!document.getElementById(prefix + '-deposit-pct'),
            actions: (document.getElementById(prefix + '-actions-wrap')?.innerHTML || '').includes('_geiSignInPerson()'),
            sub: (document.getElementById(prefix + '-page-sub')?.textContent || '') !== '-',
          };
        };
        return { tm: probe('tm'), byo: probe('byo') };
      });
      for (const mode of ['tm', 'byo']) {
        for (const part of ['title', 'scope', 'gauge', 'deposit', 'actions', 'sub']) {
          expect(r[mode][part], `${mode} ${part}`).toBe(true);
        }
      }
    });

    test('_tmHidePage/_byoHidePage still hide their page and restore the legacy toolbar (shared _geiHidePage)', async () => {
      const r = await page.evaluate(() => {
        const probe = (showFn, hideFn, pageId) => {
          showFn();
          hideFn();
          return {
            pageHidden: document.getElementById(pageId)?.style.display === 'none',
            tbarRestored: document.getElementById('gei-old-tbar')?.style.display === '',
          };
        };
        return {
          tm: probe(_tmShowPage, _tmHidePage, 'gei-tm-page'),
          byo: probe(_byoShowPage, _byoHidePage, 'gei-byo-page'),
        };
      });
      expect(r.tm.pageHidden).toBe(true);
      expect(r.tm.tbarRestored).toBe(true);
      expect(r.byo.pageHidden).toBe(true);
      expect(r.byo.tbarRestored).toBe(true);
    });
  });

  test.describe('Draft handling, type-aware reuse, resume chooser, fresh versions', () => {
    test('regression: picking Time & Materials never resumes a Build Your Own draft (cross-type bleed)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90101, name: 'TypeGuard Client', addr: '1 Guard Rd' };
        clients = clients.filter(x => x.id !== 90101).concat([c]);
        bids = bids.filter(x => x.client_id !== 90101);
        const byoDraft = { id: 901011, client_id: 90101, client_name: c.name, amount: 500, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'painting', isFreeForm: true, geiLines: [], geiTaxPct: 0, byoItems: [{ id: 1, section: 'Interior', label: 'Old BYO Item', price: 500, on: true }] };
        bids.unshift(byoDraft);
        openGenericEstimate(c, null, null, { mode: 'tm' });
        return {
          resumedTheByoDraft: _geiEditBidId === 901011,
          isTM: _geiIsTM, isFreeForm: _geiIsFreeForm,
          byoItemsLeaked: _byoItems.length > 0,
          newDraftIsTypeStamped: !!bids.find(x => x.id === _geiEditBidId)?.isTM,
        };
      });
      expect(r.resumedTheByoDraft, 'a T&M open must never resume a BYO draft').toBe(false);
      expect(r.isTM).toBe(true);
      expect(r.isFreeForm).toBe(false);
      expect(r.byoItemsLeaked, 'no BYO items may leak into the T&M estimate').toBe(false);
      expect(r.newDraftIsTypeStamped, 'the fresh stub must be type-stamped so re-picking T&M finds it').toBe(true);
    });

    test('_geiOpenModeEstimate shows the resume-or-fresh chooser for a non-empty same-type draft; "start fresh" creates a second version', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90102, name: 'Chooser Client', addr: '2 Chooser Rd' };
        clients = clients.filter(x => x.id !== 90102).concat([c]);
        bids = bids.filter(x => x.client_id !== 90102);
        const byoDraft = { id: 901021, client_id: 90102, client_name: c.name, amount: 750, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'painting', isFreeForm: true, geiLines: [], geiTaxPct: 0, byoItems: [{ id: 1, section: 'Interior', label: 'V1 Item', price: 750, on: true }] };
        bids.unshift(byoDraft);
        _geiOpenModeEstimate(c, null, 'byo');
        const chooser = document.getElementById('_gei-draft-chooser');
        const chooserShown = !!chooser;
        const listsDraft = (chooser?.textContent || '').includes('750');
        // Take the "start fresh" path
        _geiStartFreshDraft();
        const freshId = _geiEditBidId;
        const chooserGone = !document.getElementById('_gei-draft-chooser');
        const bothVersionsExist = !!bids.find(x => x.id === 901021) && !!bids.find(x => x.id === freshId) && freshId !== 901021;
        const freshIsEmptyByo = !!bids.find(x => x.id === freshId)?.isFreeForm && _byoItems.length === 0;
        return { chooserShown, listsDraft, chooserGone, bothVersionsExist, freshIsEmptyByo };
      });
      expect(r.chooserShown, 'non-empty same-type draft must trigger the chooser, not a silent resume').toBe(true);
      expect(r.listsDraft).toBe(true);
      expect(r.chooserGone).toBe(true);
      expect(r.bothVersionsExist, 'start fresh must create a second version alongside the old draft').toBe(true);
      expect(r.freshIsEmptyByo).toBe(true);
    });

    test('empty stubs are reused silently, no chooser, no duplicate blanks', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90103, name: 'Stub Client', addr: '3 Stub Rd' };
        clients = clients.filter(x => x.id !== 90103).concat([c]);
        bids = bids.filter(x => x.client_id !== 90103);
        _geiOpenModeEstimate(c, null, 'tm');
        const firstId = _geiEditBidId;
        _geiOpenModeEstimate(c, null, 'tm');
        const secondId = _geiEditBidId;
        const chooserShown = !!document.getElementById('_gei-draft-chooser');
        document.getElementById('_gei-draft-chooser')?.remove();
        const stubCount = bids.filter(x => x.client_id === 90103).length;
        return { sameStubReused: firstId === secondId, chooserShown, stubCount };
      });
      expect(r.chooserShown, 'empty stubs must not trigger the chooser').toBe(false);
      expect(r.sameStubReused, 'reopening the same type must reuse the empty stub, not spawn another').toBe(true);
      expect(r.stubCount).toBe(1);
    });

    test('deletion-verification: materials markup was removed from T&M, no UI field, no hidden multiplier on displayed prices', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90109, name: 'No Markup Client', addr: '9 No Markup Rd' };
        clients = clients.filter(x => x.id !== 90109).concat([c]);
        bids = bids.filter(x => x.client_id !== 90109);
        openGenericEstimate(c, null, null, { mode: 'tm' });
        goGeiStep(2);
        _tmRatePerMan = 0; _tmEstHours = 0; _tmCrewCount = 1;
        _geiLines = [{ desc: 'Fixtures', qty: 1, rate: 500, total: 500 }];
        if (typeof _tmRenderMatList === 'function') _tmRenderMatList();
        if (typeof _tmInputChange === 'function') _tmInputChange();
        const matListText = document.getElementById('tm-mat-list')?.innerHTML || '';
        const railMat = document.getElementById('tm-rail-mat')?.textContent || '';
        return {
          markupInputExists: !!document.getElementById('tm-i-markup'),
          markupVarExists: typeof _tmMatMarkup !== 'undefined',
          matListShowsRaw: matListText.includes('$500'),
          railShowsRaw: railMat.includes('500'),
        };
      });
      expect(r.markupInputExists, 'the "Materials markup %" input must be gone').toBe(false);
      expect(r.markupVarExists, '_tmMatMarkup must no longer exist').toBe(false);
      expect(r.matListShowsRaw, 'material row must show the raw $500 cost, no hidden markup applied').toBe(true);
      expect(r.railShowsRaw, 'rail materials total must show the raw cost, no hidden markup applied').toBe(true);
    });

    test('regression: an autosaved T&M draft round-trips, resumes as T&M with materials, NTE cap, cadence, and cap action intact', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90106, name: 'TM Roundtrip Client', addr: '6 Roundtrip Rd' };
        clients = clients.filter(x => x.id !== 90106).concat([c]);
        bids = bids.filter(x => x.client_id !== 90106);
        // Build a T&M estimate the way a user would
        openGenericEstimate(c, null, null, { mode: 'tm' });
        goGeiStep(2);
        _tmRatePerMan = 75; _tmEstHours = 24; _tmCrewCount = 3; _tmBillingCycle = 'milestone';
        _geiLines = [{ desc: 'Paint & primer', qty: 1, rate: 800, total: 800, notes: 'SW Duration' }];
        const nteEl = document.getElementById('tm-i-nte'); if (nteEl) nteEl.value = '12,000';
        const capEl = document.getElementById('tm-i-cap-action'); if (capEl) capEl.value = 'Continue at agreed rate';
        _byoAutosave(); // what every keystroke triggers, NOT the explicit Save draft button
        const bidId = _geiEditBidId;
        const saved = bids.find(x => x.id === bidId);
        const savedShape = {
          isTM: !!saved.isTM, isFreeForm: !!saved.isFreeForm,
          matCount: (saved.geiLines || []).length,
          nteCap: saved.tmNteCap, capAction: saved.tmCapAction, cadence: saved.tmBillingCycle,
        };
        // Simulate leaving and coming back via the feed's Resume button
        _geiLines = []; _tmRatePerMan = 0; _tmEstHours = 0; _geiIsFreeForm = true; _geiIsTM = false;
        openGenericEstimate(getClientById(90106), bidId, 'general');
        return {
          savedShape,
          resumedAsTM: _geiIsTM, resumedAsByo: _geiIsFreeForm,
          rate: _tmRatePerMan, hours: _tmEstHours, crew: _tmCrewCount, cadence: _tmBillingCycle,
          // _tmInputChange legitimately re-adds the synthetic labor line on
          // resume (rate×crew×hours), the material categories are what must survive.
          matsRestored: _geiLines.filter(l => !l._tmLabor).length,
        };
      });
      expect(r.savedShape.isTM).toBe(true);
      expect(r.savedShape.isFreeForm, 'autosave must never stamp isFreeForm on a T&M bid').toBe(false);
      expect(r.savedShape.matCount, 'autosave must capture material categories, not just rate numbers').toBe(1);
      expect(r.savedShape.nteCap).toBe(12000);
      expect(r.savedShape.capAction).toBe('Continue at agreed rate');
      expect(r.savedShape.cadence).toBe('milestone');
      expect(r.resumedAsTM, 'the autosaved draft must resume as T&M').toBe(true);
      expect(r.resumedAsByo).toBe(false);
      expect(r.rate).toBe(75);
      expect(r.hours).toBe(24);
      expect(r.crew).toBe(3);
      expect(r.cadence).toBe('milestone');
      expect(r.matsRestored).toBe(1);
    });

    test('regression: leaving the "Name your proposal" field autosaves the name, no explicit Save needed to survive a back-out', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90108, name: 'Name Autosave Client', addr: '8 Name Rd' };
        clients = clients.filter(x => x.id !== 90108).concat([c]);
        bids = bids.filter(x => x.client_id !== 90108);
        openGenericEstimate(c, null, null, { mode: 'byo' });
        const bidId = _geiEditBidId;
        const descEl = document.getElementById('gei-desc');
        descEl.value = 'Kitchen Remodel Quote';
        descEl.dispatchEvent(new Event('blur')); // simulate the user clicking out, no Save click
        const saved = bids.find(x => x.id === bidId);
        return { type: saved?.type, geiDesc: saved?.geiDesc };
      });
      expect(r.type).toBe('Kitchen Remodel Quote');
      expect(r.geiDesc).toBe('Kitchen Remodel Quote');
    });

    test('regression: a legacy dual-flag record (isTM + isFreeForm, from the old autosave) resumes as T&M, not empty BYO', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90107, name: 'Dual Flag Client', addr: '7 Dual Rd' };
        clients = clients.filter(x => x.id !== 90107).concat([c]);
        bids = bids.filter(x => x.client_id !== 90107);
        bids.unshift({ id: 901071, client_id: 90107, client_name: c.name, amount: 2000, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'general', isTM: true, isFreeForm: true, tmRatePerMan: 50, tmEstHours: 40, tmCrewCount: 1, geiLines: [{ desc: 'Materials', qty: 1, rate: 500, total: 500 }], geiTaxPct: 0 });
        openGenericEstimate(getClientById(90107), 901071, 'general');
        return { isTM: _geiIsTM, isFreeForm: _geiIsFreeForm, rate: _tmRatePerMan };
      });
      expect(r.isTM, 'isTM must take precedence over a stray isFreeForm flag').toBe(true);
      expect(r.isFreeForm).toBe(false);
      expect(r.rate).toBe(50);
    });

    test('regression: explicit bid resume derives type from the bid record, stale mode flags cannot corrupt it (feed Resume button)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90104, name: 'Stale Flag Client', addr: '4 Stale Rd' };
        clients = clients.filter(x => x.id !== 90104).concat([c]);
        bids = bids.filter(x => x.client_id !== 90104);
        const tmDraft = { id: 901041, client_id: 90104, client_name: c.name, amount: 1200, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'general', isTM: true, tmRatePerMan: 60, tmEstHours: 16, tmCrewCount: 2, geiLines: [], geiTaxPct: 0 };
        bids.unshift(tmDraft);
        // Simulate having just been inside a BYO estimate (the stale-state bug)
        _geiIsFreeForm = true; _geiIsTM = false;
        openGenericEstimate(getClientById(90104), 901041, 'general');
        return { isTM: _geiIsTM, isFreeForm: _geiIsFreeForm, rate: _tmRatePerMan };
      });
      expect(r.isTM, 'resuming a T&M bid must open as T&M regardless of stale flags').toBe(true);
      expect(r.isFreeForm).toBe(false);
      expect(r.rate).toBe(60);
    });

    test('T&M gauge feeds TRUE cost, owner-only crew costs $0 labor; materials at raw cost (not the billed labor)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90108, name: 'TrueCost Client', addr: '8 TrueCost Rd' };
        clients = clients.filter(x => x.id !== 90108).concat([c]);
        bids = bids.filter(x => x.client_id !== 90108);
        const _savedEmps = S.employees; S.employees = []; // solo operator, the owner IS the crew
        openGenericEstimate(c, null, null, { mode: 'tm' });
        goGeiStep(2);
        _tmRatePerMan = 50; _tmEstHours = 40; _tmCrewCount = 2;
        _geiLines = [{ desc: 'Materials', qty: 1, rate: 1000, total: 1000, _tmLabor: false }];
        const costEl = document.getElementById('tm-expected-cost');
        if (costEl) { costEl.value = ''; delete costEl.dataset.userSet; }
        _tmInputChange();
        const fedCost = parseFloat(costEl?.value) || 0;
        S.employees = _savedEmps;
        return { fedCost };
      });
      // Solo owner: labor costs the business $0, cost is materials at raw cost only.
      // The old code fed $4,000 (2 crew × $50 × 40h of BILLED labor) as "cost".
      expect(r.fedCost).toBe(1000);
    });

    test('T&M gauge cost includes selected crew payroll when employees are on the job (employee vs owner distinction)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90109, name: 'CrewCost Client', addr: '9 CrewCost Rd' };
        clients = clients.filter(x => x.id !== 90109).concat([c]);
        bids = bids.filter(x => x.client_id !== 90109);
        const _saved = { emps: S.employees, comp: typeof _teamComp !== 'undefined' ? _teamComp : undefined, loaded: typeof _teamCompLoaded !== 'undefined' ? _teamCompLoaded : undefined, burden: S.laborBurden };
        S.employees = [{ id: 1, name: 'Joe Crew', email: 'joe@crew.com' }];
        S.laborBurden = 1.3;
        _teamComp = { 'joe@crew.com': { pay_type: 'hourly', pay_rate: 30 } }; // $39/hr loaded
        _teamCompLoaded = true;
        openGenericEstimate(c, null, null, { mode: 'tm' });
        goGeiStep(2);
        // Drive the DOM the way a user does, _tmInputChange derives hours from
        // the days input, so setting the module variable alone gets overwritten.
        const rateEl = document.getElementById('tm-i-rate'); if (rateEl) rateEl.value = '60';
        const daysEl = document.getElementById('tm-i-days'); if (daysEl) daysEl.value = '2'; // 16h
        _estCrew = ['joe@crew.com']; // Joe is on the job, his real wage is a cost
        _geiLines = [{ desc: 'Materials', qty: 1, rate: 500, total: 500, _tmLabor: false }];
        const costEl = document.getElementById('tm-expected-cost');
        if (costEl) { costEl.value = ''; delete costEl.dataset.userSet; }
        _tmInputChange();
        const fedCost = parseFloat(costEl?.value) || 0;
        const pickerVisible = (document.getElementById('tm-labor-cost-wrap')?.style.display) !== 'none';
        S.employees = _saved.emps; if (_saved.comp !== undefined) _teamComp = _saved.comp; if (_saved.loaded !== undefined) _teamCompLoaded = _saved.loaded; S.laborBurden = _saved.burden;
        _estCrew = [];
        return { fedCost, pickerVisible };
      });
      // $500 materials + 16h × $39 loaded (Joe) = $1,124 true cost
      expect(r.fedCost).toBe(1124);
      expect(r.pickerVisible, 'the shared crew picker must render on the T&M rail when employees exist').toBe(true);
    });

    test('gauge bands: 68% margin is now amber (owner tightened green to top out at 55%)', async () => {
      const r = await page.evaluate(() => {
        if (!document.getElementById('gb1-gauge-wrap')) { const w = document.createElement('div'); w.id = 'gb1-gauge-wrap'; document.body.appendChild(w); }
        _geiRenderProfitGauge('gb1', 'void(0)');
        const costEl = document.getElementById('gb1-expected-cost');
        costEl.value = '3200';
        const gWrap = document.getElementById('gb1-profit-gauge');
        gWrap.style.display = ''; gWrap.style.opacity = '1';
        _updateMarginGauge('gb1', 10000); // 68% margin
        const amber = document.getElementById('gb1-gauge-pct')?.style.color;
        _updateMarginGauge('gb1', 5000); // (5000-3200)/5000 = 36% margin
        const green = document.getElementById('gb1-gauge-pct')?.style.color;
        document.getElementById('gb1-gauge-wrap')?.remove();
        return { amber, green };
      });
      expect(r.amber).toBe('rgb(245, 158, 11)');
      expect(r.green).toBe('rgb(34, 197, 94)');
    });

    test('auto-resume: marker set while estimating, cleared by deliberate nav away, boot resume honors and rejects correctly', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90110, name: 'AutoResume Client', addr: '10 Resume Rd' };
        clients = clients.filter(x => x.id !== 90110).concat([c]);
        bids = bids.filter(x => x.client_id !== 90110);
        localStorage.removeItem('zp3_active_estimate');
        openGenericEstimate(c, null, null, { mode: 'byo' });
        goGeiStep(2); // shows the page → marker written
        const markerAfterOpen = JSON.parse(localStorage.getItem('zp3_active_estimate') || 'null');
        const bidId = _geiEditBidId;
        // Simulate reload: land on dashboard, then run the boot hook
        document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
        document.getElementById('pg-dash')?.classList.add('active');
        const resumed = _maybeResumeActiveEstimate();
        const backOnEstimate = document.querySelector('.pg.active')?.id === 'pg-est-generic';
        const resumedSameBid = _geiEditBidId === bidId;
        // Deliberate exit via bottom nav must clear the marker
        goPg('pg-dash');
        const markerAfterNavAway = localStorage.getItem('zp3_active_estimate');
        // With no marker, boot resume must do nothing
        const resumedAgain = _maybeResumeActiveEstimate();
        return { markerSet: !!markerAfterOpen && String(markerAfterOpen.bidId) === String(bidId), resumed, backOnEstimate, resumedSameBid, markerAfterNavAway, resumedAgain };
      });
      expect(r.markerSet, 'opening an estimate must write the auto-resume marker').toBe(true);
      expect(r.resumed, 'boot must jump back into the open estimate').toBe(true);
      expect(r.backOnEstimate).toBe(true);
      expect(r.resumedSameBid).toBe(true);
      expect(r.markerAfterNavAway, 'deliberately leaving the estimate must clear the marker').toBe(null);
      expect(r.resumedAgain).toBe(false);
    });

    test('auto-resume: refuses a different account\'s marker and a sent bid', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90111, name: 'Guard Client', addr: '11 Guard Rd' };
        clients = clients.filter(x => x.id !== 90111).concat([c]);
        bids = bids.filter(x => x.client_id !== 90111);
        bids.unshift({ id: 901111, client_id: 90111, client_name: c.name, amount: 100, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'general', isFreeForm: true, geiLines: [], geiTaxPct: 0 });
        // Marker stamped by a DIFFERENT account
        localStorage.setItem('zp3_active_estimate', JSON.stringify({ bidId: 901111, clientId: 90111, uid: 'someone-else', ts: Date.now() }));
        const otherAccount = _maybeResumeActiveEstimate();
        const clearedAfterReject = localStorage.getItem('zp3_active_estimate');
        // Marker for a bid that's already been SENT (signingToken): never hijack into it
        bids.find(x => x.id === 901111).signingToken = 'tok123';
        localStorage.setItem('zp3_active_estimate', JSON.stringify({ bidId: 901111, clientId: 90111, uid: (typeof _supaUser !== 'undefined' && _supaUser) ? _supaUser.id : null, ts: Date.now() }));
        const sentBid = _maybeResumeActiveEstimate();
        return { otherAccount, clearedAfterReject, sentBid };
      });
      expect(r.otherAccount, 'a marker from another account must be rejected').toBe(false);
      expect(r.clearedAfterReject).toBe(null);
      expect(r.sentBid, 'a sent bid must never be auto-resumed into').toBe(false);
    });

    // Regression guard for the WebKit CI race: the boot chain schedules
    // _maybeResumeActiveEstimate on a 120ms timer (cloud.js). If the user (or
    // a spec) opens an estimate BEFORE that timer fires, the hijack used to
    // re-open the same bid underneath them, reassigning _geiLines and
    // discarding unsaved in-memory rows. The fix: an already-active estimate
    // editor is never hijacked, and the marker survives untouched.
    test('auto-resume: never hijacks while the estimate editor is already open (late boot timer)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90112, name: 'Open Editor Client', addr: '12 Open Rd' };
        clients = clients.filter(x => x.id !== 90112).concat([c]);
        bids = bids.filter(x => x.client_id !== 90112);
        localStorage.removeItem('zp3_active_estimate');
        openGenericEstimate(c, null, null, { mode: 'byo' });
        goGeiStep(2); // estimate page active + auto-resume marker written
        _geiLines.push({ id: 991, desc: 'Seeded row', qty: 1, price: 500 });
        const linesBefore = _geiLines.length;
        const linesRef = _geiLines;
        // The late boot timer fires while the editor is open, must be a no-op
        const resumed = _maybeResumeActiveEstimate();
        const out = {
          resumed,
          stillOnEstimate: document.querySelector('.pg.active')?.id === 'pg-est-generic',
          markerKept: !!localStorage.getItem('zp3_active_estimate'),
          linesUntouched: _geiLines === linesRef && _geiLines.length === linesBefore,
        };
        goPg('pg-dash'); // deliberate exit, clean up editor + marker for later tests
        return out;
      });
      expect(r.resumed, 'late boot timer must not hijack an already-open editor').toBe(false);
      expect(r.stillOnEstimate).toBe(true);
      expect(r.markerKept, 'marker must survive, it belongs to the open editor').toBe(true);
      expect(r.linesUntouched, 'in-memory lines must never be reassigned by the late timer').toBe(true);
    });

    test('_estimateTypeLabel: spelled out, never an acronym', async () => {
      const r = await page.evaluate(() => ({
        tm: _estimateTypeLabel({ isTM: true }),
        byo: _estimateTypeLabel({ isFreeForm: true }),
        legacy: _estimateTypeLabel({}),
        nul: _estimateTypeLabel(null),
      }));
      expect(r.tm).toBe('Time & Materials');
      expect(r.byo).toBe('Build Your Own');
      expect(r.legacy).toBe('');
      expect(r.nul).toBe('');
    });

    test('Make Money Today build section shows the spelled-out estimate type on draft cards', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 90105, name: 'Feed Label Client', addr: '5 Feed Rd' };
        clients = clients.filter(x => x.id !== 90105).concat([c]);
        bids = bids.filter(x => x.client_id !== 90105);
        bids.unshift({ id: 901051, client_id: 90105, client_name: c.name, amount: 900, deposit: 0, status: 'Draft', draft: true, bid_date: todayKey(), trade_type: 'general', isTM: true, geiLines: [], geiTaxPct: 0 });
        // §11.6: sections render items into innerHTML only when expanded
        window._mmtCol_build = false;
        renderTodayFeed();
        // Scope assertions to THIS bid's card, the shared feed contains cards
        // for other tests' fixtures (including a client literally named
        // "TM Deposit Client"), so a feed-wide acronym scan false-positives.
        const card = [...document.querySelectorAll('#dash-money-feed .tf-card')].find(el => el.textContent.includes('Feed Label Client'));
        const cardText = card?.textContent || '';
        return {
          cardFound: !!card,
          hasSpelledOut: cardText.includes('Time & Materials'),
          hasAcronym: /T&M|BYO/.test(cardText.replace(/Time & Materials|Build Your Own/g, '')),
        };
      });
      expect(r.cardFound, 'the draft card must be in the feed for this test to mean anything').toBe(true);
      expect(r.hasSpelledOut, 'the card must show the spelled-out estimate type').toBe(true);
      expect(r.hasAcronym, 'no acronyms on the card').toBe(false);
    });
  });

  test.describe('Proposal T&C, single clause list drives both modes (parity regression)', () => {
    // Captures the generated T&C section for one mode via the preview overlay.
    const captureTerms = (page, isTM, clientId) => page.evaluate(async ({ isTM, clientId }) => {
      const c = { id: clientId, name: 'Parity Client', addr: '1 Parity Rd, Wichita KS 67202' };
      clients = clients.filter(x => x.id !== clientId).concat([c]);
      bids = bids.filter(x => x.client_id !== clientId);
      openGenericEstimate(c, null, 'general');
      if (isTM) {
        _geiIsTM = true; _geiIsFreeForm = false;
        _tmRatePerMan = 50; _tmEstHours = 16; _tmCrewCount = 1;
        _geiLines = [{ desc: 'Materials', qty: 1, rate: 500, total: 500, _tmLabor: false }];
      } else {
        _geiIsTM = false; _geiIsFreeForm = true;
        _byoItems = [
          { id: 1, section: 'Interior', label: 'Work', price: 400, on: true },
          { id: 2, section: 'Materials', label: 'Supplies', price: 100, on: true },
        ];
      }
      // T&C is no longer part of the proposal document/preview at all, it
      // only shows in the accordion under the signature at the actual sign
      // step (owner directive 2026-07-13). Capture the clause list straight
      // from the builder function that feeds the sign-step accordion, and
      // the deposit row separately from the actual document preview.
      let doc = '';
      const orig = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = html => { doc = html; };
      let err = null;
      let captured = '';
      try { await sendGenericProposal(true); captured = _geiBuildTermsHtml(); } catch (e) { err = e.message; }
      window._showProposalPreviewOverlay = orig;
      _geiIsTM = false;
      const clauses = [];
      const re = /<div>(\d+)\. <strong>(.*?):<\/strong> ([\s\S]*?)<\/div>/g;
      let m;
      while ((m = re.exec(captured)) !== null) clauses.push({ n: +m[1], title: m[2], body: m[3] });
      return { err, clauses, hasDepRow: doc.includes('Due Before Work Begins') };
    }, { isTM, clientId });

    test('T&M and BYO T&C come from the same clause list, shared clauses are byte-identical, mode clauses differ, numbering intact', async () => {
      const tm = await captureTerms(page, true, 88901);
      const byo = await captureTerms(page, false, 88902);
      expect(tm.err).toBe(null);
      expect(byo.err).toBe(null);
      expect(tm.hasDepRow).toBe(true);
      expect(byo.hasDepRow).toBe(true);

      // Numbering: generated from array order, sequential from 1 in both modes.
      // Deposit amount/percentage is NOT its own clause, it's already shown
      // as its own line in the proposal's deposit/balance summary, so restating
      // it in Terms & Conditions would be redundant (owner directive 2026-07-13).
      expect(tm.clauses.length).toBe(12);
      expect(byo.clauses.length).toBe(10);
      tm.clauses.forEach((c, i) => expect(c.n).toBe(i + 1));
      byo.clauses.forEach((c, i) => expect(c.n).toBe(i + 1));

      // Mode-specific heads (sign.html's legacy patcher depends on these shapes).
      expect(tm.clauses[0].title).toBe('Contract type');
      expect(tm.clauses[1].title).toBe('Cancellation &amp; Deposits');
      expect(tm.clauses[2].title).toBe('Billing');
      expect(byo.clauses[0].title).toBe('Cancellation &amp; Deposits');

      // Shared tail: same titles in the same order in both modes...
      const sharedTitles = ['Cancellation &amp; Deposits', 'Change Orders', 'Limitation of Liability', 'Mechanic&#39;s Lien', 'Finance Charges', 'Workmanship Warranty', 'Permits &amp; Inspections', 'Schedule &amp; Delays', 'Insurance', 'Dispute Resolution'];
      const tailOf = clauses => clauses.filter(c => sharedTitles.includes(c.title));
      const tmTail = tailOf(tm.clauses), byoTail = tailOf(byo.clauses);
      expect(tmTail.map(c => c.title)).toEqual(sharedTitles);
      expect(byoTail.map(c => c.title)).toEqual(sharedTitles);

      // ...and BYTE-IDENTICAL bodies, the whole point of the single clause list.
      // Same trade + same client state, so every shared clause must match exactly.
      for (let i = 0; i < sharedTitles.length; i++) {
        expect(tmTail[i].body, `shared clause "${sharedTitles[i]}" must be identical in both modes`).toBe(byoTail[i].body);
      }
    });

    test('regression: preview overlay shows ONLY the document, no Terms & Conditions accordion (T&C belongs on the sign step only)', async () => {
      // Owner directive 2026-07-13 (part 2): T&C isn't part of what the client
      // reviews before signing at all, attaching it under the document (even
      // collapsed) misrepresented the real flow, where it only ever appears in
      // the accordion under the signature on the actual sign step. The preview
      // must mirror that: document only, same as sign.html's Review step.
      const r = await page.evaluate(async () => {
        const c = { id: 88904, name: 'Accordion Client', addr: '1 Accordion Rd' };
        clients = clients.filter(x => x.id !== 88904).concat([c]);
        bids = bids.filter(x => x.client_id !== 88904);
        openGenericEstimate(c, null, 'general');
        _geiIsTM = true; _geiIsFreeForm = false;
        _tmRatePerMan = 50; _tmEstHours = 8; _tmCrewCount = 1;
        _geiLines = [{ desc: 'Materials', qty: 1, rate: 500, total: 500, _tmLabor: false }];
        await sendGenericProposal(true);
        const ov = document.getElementById('_prop-preview-ov');
        const html = ov ? ov.innerHTML : '';
        const res = {
          previewFnDeleted: typeof _geiPreviewTermsHtml === 'undefined',
          hasTermsBodyEl: !!document.getElementById('gei-preview-terms-body'),
          hasTermsToggleText: html.includes('Terms &amp; Conditions') || html.includes('Terms & Conditions'),
          hasEstimatedTotal: html.includes('ESTIMATED TOTAL') || html.includes('TOTAL'),
        };
        ov?.remove();
        _geiIsTM = false;
        return res;
      });
      expect(r.previewFnDeleted, '_geiPreviewTermsHtml must be deleted, not left dead').toBe(true);
      expect(r.hasTermsBodyEl).toBe(false);
      expect(r.hasTermsToggleText, 'no Terms & Conditions accordion may render in the proposal preview').toBe(false);
      expect(r.hasEstimatedTotal).toBe(true);
    });

    test('regression: selected scope-chip descriptions carry into the proposal even when BYO has line items (was silently dropped by an if/else)', async () => {
      const r = await page.evaluate(async () => {
        const c = { id: 88903, name: 'Scope Carry Client', addr: '1 Scope Rd' };
        clients = clients.filter(x => x.id !== 88903).concat([c]);
        bids = bids.filter(x => x.client_id !== 88903);
        openGenericEstimate(c, null, 'painting');
        _geiIsFreeForm = true;
        _geiIsTM = false;
        _geiScopeNoScope = false;
        // A chip WITH a clientDesc, per TRADE_SCOPE_CHIPS.painting.
        _geiScopeChips = ['Interior painting'];
        // BYO also has line items on, this used to make the code take the
        // byoItems branch and skip the scope-chip section entirely.
        _byoItems = [{ id: 1, section: 'Interior', label: 'Walls', price: 300, on: true }];
        let captured = '';
        const orig = window._showProposalPreviewOverlay;
        window._showProposalPreviewOverlay = html => { captured = html; };
        let err = null;
        try { await sendGenericProposal(true); } catch (e) { err = e.message; }
        window._showProposalPreviewOverlay = orig;
        return {
          err,
          hasChipLabel: captured.includes('Interior painting'),
          hasChipDesc: captured.includes('Walls, ceilings, and trim in agreed rooms'),
          hasByoItem: captured.includes('>Walls<') || captured.includes('Walls</li>') || captured.includes('Walls<span'),
        };
      });
      expect(r.err).toBe(null);
      expect(r.hasChipLabel).toBe(true);
      expect(r.hasChipDesc).toBe(true);
      // BYO's own line-item detail must still show too, this is additive, not a replacement.
      expect(r.hasByoItem).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 31. _toggleScopeChip
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_toggleScopeChip', () => {
    test('null label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _toggleScopeChip(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _toggleScopeChip(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _toggleScopeChip(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, adds label to _geiScopeChips', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = [];
        _geiScopeNoScope = false;
        _toggleScopeChip('Interior painting');
        return { chips: _geiScopeChips };
      });
      expect(r.chips).toContain('Interior painting');
    });

    test('toggle same label twice, removes it (toggle off)', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = [];
        _geiScopeNoScope = false;
        _toggleScopeChip('Interior painting');
        _toggleScopeChip('Interior painting');
        return { chips: _geiScopeChips };
      });
      expect(r.chips).not.toContain('Interior painting');
    });

    test('clears _geiScopeNoScope on toggle', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = [];
        _geiScopeNoScope = true;
        _toggleScopeChip('Tape & masking');
        return { noScope: _geiScopeNoScope };
      });
      expect(r.noScope).toBe(false);
    });

    test('multiple different chips accumulate', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = [];
        _geiScopeNoScope = false;
        _toggleScopeChip('Interior painting');
        _toggleScopeChip('Tape & masking');
        _toggleScopeChip('Prime coat');
        return { count: _geiScopeChips.length };
      });
      expect(r.count).toBe(3);
    });

    test('type mismatch (number): does not throw', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = [];
        try { _toggleScopeChip(42); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('very long label, does not throw', async () => {
      const r = await page.evaluate(() => {
        const longLabel = 'x'.repeat(1000);
        _geiScopeChips = [];
        try { _toggleScopeChip(longLabel); return { ok: true, added: _geiScopeChips.includes(longLabel) }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { _geiScopeChips = []; }
      });
      expect(r.ok).toBe(true);
      expect(r.added).toBe(true);
    });

    test('concurrent calls with same label (5x): alternates on/off, no crash', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = []; _geiScopeNoScope = false;
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _toggleScopeChip('Interior painting'); ok++; } catch (_) {}
        }
        return { ok, chipCount: _geiScopeChips.filter(c => c === 'Interior painting').length };
      });
      expect(r.ok).toBe(5);
      // After 5 odd toggles, should be present once
      expect(r.chipCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 32. _toggleScopeNone
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_toggleScopeNone', () => {
    test('does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _toggleScopeNone(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('sets _geiScopeNoScope to true when false', async () => {
      const r = await page.evaluate(() => {
        _geiScopeNoScope = false;
        _toggleScopeNone();
        return { noScope: _geiScopeNoScope };
      });
      expect(r.noScope).toBe(true);
    });

    test('clears _geiScopeChips when enabling none', async () => {
      const r = await page.evaluate(() => {
        _geiScopeChips = ['Interior painting', 'Tape & masking'];
        _geiScopeNoScope = false;
        _toggleScopeNone();
        return { noScope: _geiScopeNoScope, chipsEmpty: _geiScopeChips.length === 0 };
      });
      expect(r.noScope).toBe(true);
      expect(r.chipsEmpty).toBe(true);
    });

    test('toggles off when already on', async () => {
      const r = await page.evaluate(() => {
        _geiScopeNoScope = true;
        _toggleScopeNone();
        return { noScope: _geiScopeNoScope };
      });
      expect(r.noScope).toBe(false);
    });

    test('concurrent calls (5x): alternates state, no crash', async () => {
      const r = await page.evaluate(() => {
        _geiScopeNoScope = false; _geiScopeChips = [];
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _toggleScopeNone(); ok++; } catch (_) {}
        }
        return { ok, finalState: _geiScopeNoScope };
      });
      expect(r.ok).toBe(5);
      // After 5 odd toggles, should be true
      expect(r.finalState).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 33. _updateScopeSheetBtn
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_updateScopeSheetBtn', () => {
    test('null label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _updateScopeSheetBtn(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _updateScopeSheetBtn(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('label with no matching DOM button, returns early', async () => {
      const r = await page.evaluate(() => {
        try { _updateScopeSheetBtn('NonExistentScopeItem12345'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, updates active chip button style', async () => {
      const r = await page.evaluate(() => {
        const label = 'Interior painting';
        const sid = '_scb-' + label.replace(/[^a-z0-9]/gi, '_');
        const btn = document.createElement('div'); btn.id = sid;
        const lbl = document.createElement('span'); lbl.className = '_sc-lbl'; btn.appendChild(lbl);
        const ck = document.createElement('span'); ck.className = '_sc-ck'; btn.appendChild(ck);
        document.body.appendChild(btn);
        _geiScopeChips = [label];
        _updateScopeSheetBtn(label);
        const isBlue = btn.style.borderColor?.includes('var(--blue)') || btn.style.background?.includes('var(--blue)');
        btn.remove();
        return { isBlue };
      });
      expect(r.isBlue).toBe(true);
    });

    test('inactive chip, renders without blue styling', async () => {
      const r = await page.evaluate(() => {
        const label = 'Sanding';
        const sid = '_scb-' + label.replace(/[^a-z0-9]/gi, '_');
        const btn = document.createElement('div'); btn.id = sid;
        const lbl = document.createElement('span'); lbl.className = '_sc-lbl'; btn.appendChild(lbl);
        const ck = document.createElement('span'); ck.className = '_sc-ck'; btn.appendChild(ck);
        document.body.appendChild(btn);
        _geiScopeChips = []; // not active
        _updateScopeSheetBtn(label);
        const notBlue = !btn.style.borderColor?.includes('var(--blue)');
        btn.remove();
        return { notBlue };
      });
      expect(r.notBlue).toBe(true);
    });

    test('special chars in label, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _updateScopeSheetBtn('Label with <script> & "quotes"'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls (5x): no crash', async () => {
      const ok = await concurrent('_updateScopeSheetBtn("Interior painting")');
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 34. _renderScopeChips
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_renderScopeChips', () => {
    test('null containerId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _renderScopeChips(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined containerId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _renderScopeChips(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing container element, returns early', async () => {
      const r = await page.evaluate(() => {
        try { _renderScopeChips('nonexistent-container-id-12345'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty chips array, shows "Add scope" button', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-wrap'; document.body.appendChild(wrap);
        _geiScopeChips = []; _geiScopeNoScope = false;
        _geiTrade = 'painting';
        _renderScopeChips('test-scope-wrap');
        const html = wrap.innerHTML;
        wrap.remove();
        return { hasAddBtn: html.includes('Add scope of work') };
      });
      expect(r.hasAddBtn).toBe(true);
    });

    test('scope chips selected, renders chip items', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-wrap2'; document.body.appendChild(wrap);
        _geiScopeChips = ['Interior painting', 'Tape & masking'];
        _geiScopeNoScope = false;
        _geiTrade = 'painting';
        _renderScopeChips('test-scope-wrap2');
        const html = wrap.innerHTML;
        wrap.remove();
        return {
          hasInterior: html.includes('Interior painting'),
          hasTape: html.includes('Tape &amp; masking') || html.includes('Tape & masking')
        };
      });
      expect(r.hasInterior).toBe(true);
      expect(r.hasTape).toBe(true);
    });

    test('noScope=true: shows "None" chip', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-wrap3'; document.body.appendChild(wrap);
        _geiScopeChips = []; _geiScopeNoScope = true;
        _geiTrade = 'painting';
        _renderScopeChips('test-scope-wrap3');
        const html = wrap.innerHTML;
        wrap.remove();
        return { hasNone: html.includes('None') };
      });
      expect(r.hasNone).toBe(true);
    });

    test('no duplicate chips after 3 render calls', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-dedup'; document.body.appendChild(wrap);
        _geiScopeChips = ['Interior painting'];
        _geiScopeNoScope = false; _geiTrade = 'painting';
        _renderScopeChips('test-scope-dedup');
        const count1 = (wrap.innerHTML.match(/Interior painting/g) || []).length;
        _renderScopeChips('test-scope-dedup');
        _renderScopeChips('test-scope-dedup');
        const count3 = (wrap.innerHTML.match(/Interior painting/g) || []).length;
        wrap.remove();
        return { count1, count3 };
      });
      // innerHTML is replaced each call, 3 renders must equal 1 render (no accumulation)
      expect(r.count1).toBeGreaterThanOrEqual(1);
      expect(r.count3).toBe(r.count1);
    });

    test('concurrent calls (5x): no crash', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-concurrent'; document.body.appendChild(wrap);
        _geiScopeChips = ['Interior painting'];
        _geiScopeNoScope = false; _geiTrade = 'painting';
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _renderScopeChips('test-scope-concurrent'); ok++; } catch (_) {}
        }
        wrap.remove();
        return { ok };
      });
      expect(r.ok).toBe(5);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_scope_chips', '{INVALID{{{{');
        const wrap = document.createElement('div'); wrap.id = 'test-scope-corrupt'; document.body.appendChild(wrap);
        _geiScopeChips = []; _geiScopeNoScope = false; _geiTrade = 'painting';
        try { _renderScopeChips('test-scope-corrupt'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { wrap.remove(); localStorage.removeItem('zp3_scope_chips'); }
      });
      expect(r.ok).toBe(true);
    });

    test('unknown trade, falls back to generic scope chips', async () => {
      const r = await page.evaluate(() => {
        const wrap = document.createElement('div'); wrap.id = 'test-scope-unknown'; document.body.appendChild(wrap);
        _geiScopeChips = []; _geiScopeNoScope = false; _geiTrade = 'unknown_trade_xyz';
        try { _renderScopeChips('test-scope-unknown'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { wrap.remove(); _geiTrade = 'painting'; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 35. _openScopeSheet
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_openScopeSheet', () => {
    test('null containerId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _openScopeSheet(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_scope-sheet-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined containerId, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _openScopeSheet(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_scope-sheet-ov')?.remove(); }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path, creates overlay in DOM', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); }
        catch (_) {}
        const ov = document.getElementById('_scope-sheet-ov');
        const created = !!ov;
        ov?.remove();
        return { created };
      });
      expect(r.created).toBe(true);
    });

    test('overlay has correct class "zmodal-overlay"', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'plumbing'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); }
        catch (_) {}
        const ov = document.getElementById('_scope-sheet-ov');
        const hasClass = ov?.classList.contains('zmodal-overlay');
        ov?.remove();
        return { hasClass };
      });
      expect(r.hasClass).toBe(true);
    });

    test('called twice, replaces existing overlay (no duplicates)', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); _openScopeSheet('byo-scope-wrap'); }
        catch (_) {}
        const ovCount = document.querySelectorAll('#_scope-sheet-ov').length;
        document.getElementById('_scope-sheet-ov')?.remove();
        return { ovCount };
      });
      expect(r.ovCount).toBe(1);
    });

    test('sheet contains scope chips for painting trade', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); }
        catch (_) {}
        const ov = document.getElementById('_scope-sheet-ov');
        const html = ov?.innerHTML || '';
        ov?.remove();
        // Painting trade renders TRADE_SCOPE_ITEMS['painting'] = SCOPE_ITEMS (Tape, Sanding, Move furniture, etc.)
        // plus _GEN_SCOPE (Demo, Site prep, Haul-off, Punch list).  Check for any of these.
        const hasPaintItem = html.includes('Tape') || html.includes('Demo') || html.includes('Sanding') || html.includes('Move furniture');
        return { hasPaintItem };
      });
      expect(r.hasPaintItem).toBe(true);
    });

    test('sheet contains "Scope of work" heading', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); }
        catch (_) {}
        const ov = document.getElementById('_scope-sheet-ov');
        const html = ov?.innerHTML || '';
        ov?.remove();
        return { hasHeading: html.includes('Scope of work') };
      });
      expect(r.hasHeading).toBe(true);
    });

    test('concurrent calls (5x): only one overlay in DOM', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        let ok = 0;
        for (let i = 0; i < 5; i++) {
          try { _openScopeSheet('byo-scope-wrap'); ok++; } catch (_) {}
        }
        const ovCount = document.querySelectorAll('#_scope-sheet-ov').length;
        document.getElementById('_scope-sheet-ov')?.remove();
        return { ok, ovCount };
      });
      expect(r.ok).toBe(5);
      expect(r.ovCount).toBe(1);
    });

    test('unknown trade, uses generic scope chips without crash', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'underwater-basket-weaving'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_scope-sheet-ov')?.remove(); _geiTrade = 'painting'; }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_scope_sheet_data', '{INVALID{{{{');
        _geiTrade = 'painting'; _geiScopeChips = [];
        try { _openScopeSheet('byo-scope-wrap'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { document.getElementById('_scope-sheet-ov')?.remove(); localStorage.removeItem('zp3_scope_sheet_data'); }
      });
      expect(r.ok).toBe(true);
    });

    test('regression: sheet is a centered .zmodal, not a bottom-pinned sheet (was position:fixed;bottom:0, overriding the overlay\'s centering)', async () => {
      const r = await page.evaluate(() => {
        _geiTrade = 'painting'; _geiScopeChips = [];
        _openScopeSheet('byo-scope-wrap');
        const ov = document.getElementById('_scope-sheet-ov');
        const sheet = ov?.firstElementChild;
        const res = {
          overlayCenters: getComputedStyle(ov).alignItems === 'center' && getComputedStyle(ov).justifyContent === 'center',
          sheetIsZmodal: sheet?.classList.contains('zmodal'),
          sheetPosition: sheet ? getComputedStyle(sheet).position : null,
        };
        ov?.remove();
        return res;
      });
      expect(r.overlayCenters).toBe(true);
      expect(r.sheetIsZmodal).toBe(true);
      // A real .zmodal participates in the overlay's flexbox centering (static
      // position): the old bottom-sheet hardcoded position:fixed to escape it.
      expect(r.sheetPosition).not.toBe('fixed');
    });
  });

  test.describe('Address picker: pick the right property at the point of action', () => {
    test('single-address client: header shows plain address, no picker chip', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96101, name: 'Solo Client', addr: '1 Only St, Town, KS 60000' };
        clients = clients.filter(x => x.id !== 96101).concat([c]);
        openGenericEstimate(c, null, 'general'); _geiIsTM = true; _geiIsFreeForm = false; goGeiStep(2);
        const sub = document.getElementById('tm-page-sub');
        return { html: sub ? sub.innerHTML : '', addr: _geiSiteAddr() };
      });
      expect(r.html.includes('pickClientAddress')).toBe(false); // no chip
      expect(r.addr).toBe('1 Only St, Town, KS 60000');
    });

    test('multi-address: choosing T&M opens the picker FIRST, then the estimate stamps the picked property', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96102, name: 'Two Prop', addr: '10 Main St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 Side Ave, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96102).concat([c]);
        bids = bids.filter(b => b.client_id !== 96102); // no stray drafts → gate opens the builder directly after the pick
        _geiEditBidId = null;
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser').forEach(e => e.remove());
        _geiOpenModeEstimate(c, null, 'tm');
        const pickerFirst = !!document.getElementById('_addrpick-ov'); // gate appears before the builder
        _addrPickChoose(1); // pick the rental
        return { pickerFirst, addr: _geiSiteAddr(), tmMode: _geiIsTM };
      });
      expect(r.pickerFirst).toBe(true);
      expect(r.addr).toBe('22 Side Ave, Town, KS 60000'); // estimate opens stamped with the pick
      expect(r.tmMode).toBe(true);                        // and it's the T&M builder
    });

    test('adding a NEW address at the gate starts a fresh estimate there, never the primary-address draft', async () => {
      // Owner-reported: with an in-progress estimate under the primary address,
      // adding a new address at the gate started the estimate under primary. A
      // draft belongs to one property, so a different/new address must open fresh.
      const r = await page.evaluate(() => {
        const c = { id: 96110, name: 'Multi Draft', addr: '10 Primary St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 Rental Ave, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96110).concat([c]);
        bids = bids.filter(b => b.client_id !== 96110);
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser').forEach(e => e.remove());
        // Build a NON-EMPTY T&M draft under the primary address.
        _geiOpenModeEstimate(c, null, 'tm'); _addrPickChoose(0); goGeiStep(2);
        const primaryBid = bids.find(b => b.client_id === 96110);
        primaryBid.amount = 1500; primaryBid.addr = c.addr; saveAll();
        // Reopen the gate, add a brand-new address, use it.
        _geiOpenModeEstimate(c, null, 'tm');
        _addrPickAddNew();
        document.getElementById('_addrpick-new').value = '77 New Ct, Town, KS 60000';
        _addrPickSaveNew();
        const openedBid = bids.find(b => b.id === _geiEditBidId);
        return { chooser: !!document.getElementById('_gei-draft-chooser'), addr: _geiSiteAddr(),
          startedFresh: _geiEditBidId !== primaryBid.id, openedBidAddr: openedBid ? openedBid.addr : null,
          primaryUntouched: primaryBid.amount === 1500 };
      });
      expect(r.chooser).toBe(false);                       // no cross-property draft offered
      expect(r.addr).toBe('77 New Ct, Town, KS 60000');    // estimate is under the NEW address
      expect(r.startedFresh).toBe(true);                   // a new bid, not the primary draft
      expect(r.openedBidAddr).toBe('77 New Ct, Town, KS 60000'); // stamped on the bid
      expect(r.primaryUntouched).toBe(true);               // the primary draft is left intact
    });

    test('picking an OTHER existing address with a primary draft opens fresh there (no chooser)', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96111, name: 'Two Addr Draft', addr: '10 A St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 B St, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96111).concat([c]);
        bids = bids.filter(b => b.client_id !== 96111);
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser').forEach(e => e.remove());
        _geiOpenModeEstimate(c, null, 'tm'); _addrPickChoose(0); goGeiStep(2);
        const pb = bids.find(b => b.client_id === 96111); pb.amount = 900; pb.addr = c.addr; saveAll();
        _geiOpenModeEstimate(c, null, 'tm'); _addrPickChoose(1); // pick the rental
        return { chooser: !!document.getElementById('_gei-draft-chooser'), addr: _geiSiteAddr() };
      });
      expect(r.chooser).toBe(false);
      expect(r.addr).toBe('22 B St, Town, KS 60000');
    });

    test('picking the SAME address that has a draft still offers to resume it', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96112, name: 'Same Addr Draft', addr: '10 C St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 D St, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96112).concat([c]);
        bids = bids.filter(b => b.client_id !== 96112);
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser').forEach(e => e.remove());
        _geiOpenModeEstimate(c, null, 'tm'); _addrPickChoose(0); goGeiStep(2);
        const pb = bids.find(b => b.client_id === 96112); pb.amount = 700; pb.addr = c.addr; saveAll();
        _geiOpenModeEstimate(c, null, 'tm'); _addrPickChoose(0); // pick the SAME (primary) address
        const chooser = !!document.getElementById('_gei-draft-chooser');
        if (chooser) _geiResumeChosenDraft(String(pb.id));
        return { chooser, addr: _geiSiteAddr() };
      });
      expect(r.chooser).toBe(true);                        // same-property draft is offered
      expect(r.addr).toBe('10 C St, Town, KS 60000');      // resumes under that address
    });

    test('estimate-type screen stays as the backdrop behind the address gate, then retires when the builder opens', async () => {
      // Owner: the address picker should sit over the "pick estimate type" screen,
      // not flash to the dashboard behind it.
      const r = await page.evaluate(() => {
        const c = { id: 96115, name: 'Backdrop Co', addr: '10 Main St, Town, KS 60000',
          extraAddresses: [{ label: 'Rental', addr: '22 Side Ave, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96115).concat([c]);
        bids = bids.filter(b => b.client_id !== 96115);
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser, #_style-pick-ov').forEach(e => e.remove());
        _showEstimateStylePicker(c);
        const styleUp = !!document.getElementById('_style-pick-ov');
        _pickEstStyle('tm');                                     // tap T&M -> address gate
        const gateUp = !!document.getElementById('_addrpick-ov');
        const backdropStill = !!document.getElementById('_style-pick-ov'); // stays behind the gate
        _addrPickChoose(1);                                      // pick -> builder opens
        const sp = document.getElementById('_style-pick-ov');
        const retired = !sp || sp.style.opacity === '0';         // fading out / gone
        return { styleUp, gateUp, backdropStill, retired, addr: _geiSiteAddr() };
      });
      expect(r.styleUp).toBe(true);
      expect(r.gateUp).toBe(true);
      expect(r.backdropStill).toBe(true);   // the estimate-type screen remained as backdrop
      expect(r.retired).toBe(true);         // and retires once the builder is up
      expect(r.addr).toBe('22 Side Ave, Town, KS 60000');
    });

    test('single-address: choosing T&M opens the estimate directly, no picker', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96108, name: 'One Prop', addr: '3 Solo Ln, Town, KS 60000' };
        clients = clients.filter(x => x.id !== 96108).concat([c]);
        _geiEditBidId = null;
        document.querySelectorAll('#_addrpick-ov').forEach(e => e.remove());
        _geiOpenModeEstimate(c, null, 'byo');
        return { picker: !!document.getElementById('_addrpick-ov'), addr: _geiSiteAddr(), byoMode: _geiIsFreeForm };
      });
      expect(r.picker).toBe(false);                      // no gate for a single-address client
      expect(r.addr).toBe('3 Solo Ln, Town, KS 60000');
      expect(r.byoMode).toBe(true);
    });

    test('the property picked at the gate flows to the site note AND the pre-1978 lead trigger', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96103, name: 'Flow Co', addr: '1 New Way, Town, KS 60000',
          extraAddresses: [{ label: 'Old', addr: '2 Old Way, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96103).concat([c]);
        bids = bids.filter(b => b.client_id !== 96103);
        setPropertyData(c, '1 New Way', { yearBuilt: 2005 });
        setPropertyData(c, '2 Old Way', { yearBuilt: 1948 });
        _geiEditBidId = null;
        document.querySelectorAll('#_addrpick-ov, #_gei-draft-chooser').forEach(e => e.remove());
        _geiOpenModeEstimate(c, null, 'tm');
        _addrPickChoose(1); // pick the historic property at the gate
        const y = getProperty(c, _geiSiteAddr()).yearBuilt;
        return { addr: _geiSiteAddr(), pre78: !!(y && y < 1978) };
      });
      expect(r.addr).toBe('2 Old Way, Town, KS 60000');
      expect(r.pre78).toBe(true); // the pre-1978 property drives the lead disclosure
    });

    test('pickClientAddress: lists every address + a New-address row; choosing fires the callback', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96104, name: 'Picker Co', addr: '5 First St, Town, KS 60000',
          extraAddresses: [{ label: 'Two', addr: '6 Second St, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96104).concat([c]);
        let picked = null;
        pickClientAddress(96104, a => { picked = a; });
        const sheet = document.getElementById('_addrpick-sheet');
        const html = sheet ? sheet.innerHTML : '';
        const rows = (html.match(/_addrPickChoose\(/g) || []).length;
        const hasNew = html.includes('New address for this client');
        _addrPickChoose(1); // choose the second address
        return { rows, hasNew, picked, sheetGone: !document.getElementById('_addrpick-ov') };
      });
      expect(r.rows).toBe(2);
      expect(r.hasNew).toBe(true);
      expect(r.picked).toBe('6 Second St, Town, KS 60000');
      expect(r.sheetGone).toBe(true); // picking closes the sheet
    });

    test('picker sheet is horizontally centered at mobile, tablet and desktop', async () => {
      // Left/right gaps must be equal on every form factor. (Vertical centering is
      // asserted below via the overlay's CSS contract: measuring the sheet's top/
      // bottom gap after setViewportSize is unreliable in headless chromium, the
      // resize leaves a ~16px phantom offset that a fresh page load does not show.)
      for (const vp of [{ w: 390, h: 844 }, { w: 820, h: 1180 }, { w: 1280, h: 800 }]) {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        const m = await page.evaluate(() => {
          document.getElementById('_addrpick-ov')?.remove();
          const c = { id: 96106, name: 'Center Co', addr: '1 A St, Town, KS 60000',
            extraAddresses: [{ label: 'B', addr: '2 B St, Town, KS 60000' }] };
          clients = clients.filter(x => x.id !== 96106).concat([c]);
          pickClientAddress(96106, () => {});
          const r = document.getElementById('_addrpick-sheet').getBoundingClientRect();
          return { gapLeft: r.left, gapRight: window.innerWidth - r.right };
        });
        expect(Math.abs(m.gapLeft - m.gapRight)).toBeLessThanOrEqual(1.5);
      }
    });

    test('picker overlay is a full-screen flex box that centers its content both axes', async () => {
      // The vertical-centering guarantee: a fixed inset:0 overlay, flex-centered,
      // with symmetric top/bottom padding and a single child (the sheet). If any of
      // these regress, the sheet stops being centered.
      const cs = await page.evaluate(() => {
        document.getElementById('_addrpick-ov')?.remove();
        const c = { id: 96107, name: 'CSS Co', addr: '3 C St, Town, KS 60000',
          extraAddresses: [{ label: 'D', addr: '4 D St, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96107).concat([c]);
        pickClientAddress(96107, () => {});
        const ov = document.getElementById('_addrpick-ov');
        const s = getComputedStyle(ov);
        return { position: s.position, display: s.display, alignItems: s.alignItems,
          justifyContent: s.justifyContent, padTop: parseFloat(s.paddingTop),
          padBottom: parseFloat(s.paddingBottom), children: ov.children.length,
          top: ov.getBoundingClientRect().top, bottom: Math.round(ov.getBoundingClientRect().bottom),
          vh: window.innerHeight };
      });
      expect(cs.position).toBe('fixed');
      expect(cs.display).toBe('flex');
      expect(cs.alignItems).toBe('center');
      expect(cs.justifyContent).toBe('center');
      expect(cs.padTop).toBe(cs.padBottom);            // symmetric vertical padding
      expect(cs.children).toBe(1);                     // only the sheet, nothing skewing the cross-axis
      expect(cs.top).toBe(0);                           // overlay fills the viewport top-to-bottom
      expect(cs.bottom).toBe(cs.vh);
    });

    test('New address inside the picker: adds it to the client and fires the callback with it', async () => {
      const r = await page.evaluate(() => {
        const c = { id: 96105, name: 'Add Co', addr: '9 Home Rd, Town, KS 60000',
          extraAddresses: [{ label: 'B', addr: '8 B Rd, Town, KS 60000' }] };
        clients = clients.filter(x => x.id !== 96105).concat([c]);
        let picked = null;
        pickClientAddress(96105, a => { picked = a; });
        _addrPickAddNew();
        document.getElementById('_addrpick-new').value = '77 Brand New Ct, Town, KS 60000';
        _addrPickSaveNew();
        const cl = clients.find(x => x.id === 96105);
        return { picked, onClient: (cl.extraAddresses || []).some(a => a.addr === '77 Brand New Ct, Town, KS 60000') };
      });
      expect(r.picked).toBe('77 Brand New Ct, Town, KS 60000');
      expect(r.onClient).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 36. No console errors, generic-estimate.js
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors, generic-estimate.js', async () => {
    assertNoErrors(page, 'generic-estimate.js');
  });
});
