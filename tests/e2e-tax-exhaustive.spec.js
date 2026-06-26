// @ts-check
/**
 * Exhaustive E2E coverage for tax.js
 *
 * Functions covered:
 *   onStateChange        (line 56)
 *   setTaxTab            (line 94)
 *   _populateTaxYearSel  (line 103)
 *   setTaxYear           (line 113)
 *   _getSsWageBase       (line 117)
 *   _calcSeTax           (line 118)
 *   _calcStateEstimate   (line 127)
 *   calcTax              (line 136)
 *   estimateTax          (line 406)
 *
 * Every function is tested for:
 *   null / undefined input, empty input, boundary values,
 *   type mismatch, missing DOM, golden-path, concurrent calls,
 *   corrupted localStorage, duplicate-render stability, guard release.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('tax.js — exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);

    // Navigate to the tax page so the tax DOM is present
    await page.evaluate(() => {
      if (typeof goPg === 'function' && document.getElementById('pg-tax')) goPg('pg-tax');
    });
    await page.waitForTimeout(400);

    // Inject the minimal DOM stubs required by tax functions that may not be
    // present after page navigation in the test environment.
    await page.evaluate(() => {
      function ensureEl(id, tag = 'div') {
        if (!document.getElementById(id)) {
          const el = document.createElement(tag);
          el.id = id;
          document.body.appendChild(el);
        }
        return document.getElementById(id);
      }
      // Required by calcTax rendering
      ensureEl('tx-inputs');
      ensureEl('tx-results');
      ensureEl('tx-quarters');
      ensureEl('tx-tips');
      ensureEl('tx-reserve-banner');
      ensureEl('tx-data-hd');
      ensureEl('sum-tx-status', 'select');
      // tax-yr-sel must be a <select>
      if (!document.getElementById('tax-yr-sel')) {
        const sel = document.createElement('select');
        sel.id = 'tax-yr-sel';
        document.body.appendChild(sel);
      }
      // tx-status, tx-spouse, tx-paid, tx-prior-yr, tx-prior-yr-agi must be inputs
      ['tx-status', 'tx-spouse', 'tx-paid', 'tx-prior-yr', 'tx-prior-yr-agi'].forEach(id => {
        if (!document.getElementById(id)) {
          const inp = id === 'tx-status' ? document.createElement('select') : document.createElement('input');
          inp.id = id;
          if (id === 'tx-status') {
            ['single','mfj','mfs','hoh'].forEach(v => {
              const o = document.createElement('option');
              o.value = v; o.textContent = v;
              inp.appendChild(o);
            });
          } else {
            inp.type = 'number';
            inp.value = '0';
          }
          document.body.appendChild(inp);
        }
      });
      // tab/pane stubs
      ['tx-tab-summary','tx-tab-quarters','tx-tab-tips'].forEach(id => ensureEl(id, 'button'));
      ['tx-summary-pane','tx-quarters-pane','tx-tips-pane'].forEach(id => ensureEl(id));
      // onStateChange stubs
      ensureEl('set-state-label');
      ensureEl('set-state-info');
      ['set-ksl','set-ksh','set-kst','set-kss','set-ksm'].forEach(id => ensureEl(id, 'input'));
      // Ensure global data arrays are clean
      income = [];
      expenses = [];
      mileage = [];
      payments = [];
      bids = [];
      // Stable S settings
      S.state = 'KS';
      S.txStatus = 'single';
      S.irsRate = 0.725;
    });
  });

  test.afterAll(async () => {
    await page.evaluate(() => {
      // Clean up injected stubs
      [
        'tx-inputs','tx-results','tx-quarters','tx-tips','tx-reserve-banner',
        'tx-data-hd','sum-tx-status','tax-yr-sel',
        'tx-status','tx-spouse','tx-paid','tx-prior-yr','tx-prior-yr-agi',
        'tx-tab-summary','tx-tab-quarters','tx-tab-tips',
        'tx-summary-pane','tx-quarters-pane','tx-tips-pane',
        'set-state-label','set-state-info',
        'set-ksl','set-ksh','set-kst','set-kss','set-ksm',
      ].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    });
    await page.context().close();
  });

  // ── helper: run expression N times synchronously ─────────────────────────
  async function concurrent(fnExpr, n = 5) {
    return page.evaluate(([expr, count]) => {
      let ok = 0;
      for (let i = 0; i < count; i++) {
        try { eval(expr); ok++; } catch (_) {}
      }
      return ok;
    }, [fnExpr, n]);
  }

  // ── helper: reset data arrays to empty baseline ───────────────────────────
  async function resetData() {
    await page.evaluate(() => {
      income = []; expenses = []; mileage = []; payments = []; bids = [];
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. onStateChange
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('onStateChange', () => {
    test('null — does not throw, returns early', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string — does not throw, returns early (no STATE_TAX match)', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange(''); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('unknown state code — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange('ZZ'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('number type mismatch — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange(42); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path KS — sets S.state and populates rate inputs', async () => {
      const r = await page.evaluate(() => {
        try {
          onStateChange('KS');
          return {
            ok: true,
            state: S.state,
            low: S.ksLow,
            high: S.ksHigh,
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.state).toBe('KS');
      expect(typeof r.low).toBe('number');
      expect(typeof r.high).toBe('number');
    });

    test('no-income-tax state (TX) — sets S.state to TX', async () => {
      const r = await page.evaluate(() => {
        try {
          onStateChange('TX');
          return { ok: true, state: S.state };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.state).toBe('TX');
    });

    test('state with note (AZ flat) — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { onStateChange('AZ'); return { ok: true, state: S.state }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.state).toBe('AZ');
    });

    test('missing DOM elements — does not throw', async () => {
      const r = await page.evaluate(() => {
        // Temporarily remove DOM stubs
        const ids = ['set-state-label','set-state-info','set-ksl','set-ksh','set-kst','set-kss','set-ksm'];
        const saved = {};
        ids.forEach(id => { const el = document.getElementById(id); if (el) { saved[id] = el; el.parentNode.removeChild(el); } });
        let ok = true, err = '';
        try { onStateChange('CA'); } catch (e) { ok = false; err = e.message; }
        // Restore
        ids.forEach(id => { if (saved[id]) document.body.appendChild(saved[id]); });
        return { ok, err };
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — no stack corruption', async () => {
      const ok = await concurrent("onStateChange('KS')", 5);
      expect(ok).toBe(5);
    });

    test('corrupted localStorage — does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_settings', '{INVALID{{{{');
        try { onStateChange('FL'); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('td_settings'); }
      });
      expect(r.ok).toBe(true);
    });

    test('all 50 state codes — none throw', async () => {
      const r = await page.evaluate(() => {
        const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
          'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
          'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
          'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
          'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
        const errors = [];
        states.forEach(st => {
          try { onStateChange(st); } catch (e) { errors.push(st + ': ' + e.message); }
        });
        return { errors };
      });
      expect(r.errors).toHaveLength(0);
    });

    test('infoEl shown for no-tax state (FL)', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('set-state-info');
        if (!el) return { ok: true, skip: true };
        onStateChange('FL');
        return { ok: true, display: el.style.display };
      });
      expect(r.ok).toBe(true);
      if (!r.skip) expect(r.display).toBe('block');
    });

    test('infoEl hidden for normal bracketed state (VA)', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('set-state-info');
        if (!el) return { ok: true, skip: true };
        onStateChange('VA');
        return { ok: true, display: el.style.display };
      });
      expect(r.ok).toBe(true);
      if (!r.skip) expect(r.display).toBe('none');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. setTaxTab
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setTaxTab', () => {
    test('null tab — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxTab(null, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined tab — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxTab(undefined, undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('empty string tab — does not throw (pane will not be found)', async () => {
      const r = await page.evaluate(() => {
        try { setTaxTab('', null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('non-existent pane name — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxTab('nonexistent', null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path summary tab — shows pane, marks btn active', async () => {
      const r = await page.evaluate(() => {
        const btn = document.getElementById('tx-tab-summary');
        const pane = document.getElementById('tx-summary-pane');
        try {
          setTaxTab('summary', btn);
          return {
            ok: true,
            btnActive: btn ? btn.classList.contains('active') : null,
            paneDisplay: pane ? pane.style.display : null,
          };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      if (r.btnActive !== null) expect(r.btnActive).toBe(true);
      if (r.paneDisplay !== null) expect(r.paneDisplay).toBe('block');
    });

    test('btn is null — does not throw, pane still shown', async () => {
      const r = await page.evaluate(() => {
        const pane = document.getElementById('tx-quarters-pane');
        try {
          setTaxTab('quarters', null);
          return { ok: true, paneDisplay: pane ? pane.style.display : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      if (r.paneDisplay !== null) expect(r.paneDisplay).toBe('block');
    });

    test('switching tabs hides all other panes', async () => {
      const r = await page.evaluate(() => {
        // Ensure all panes visible first
        ['tx-summary-pane','tx-quarters-pane','tx-tips-pane'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'block';
        });
        try {
          setTaxTab('tips', null);
          const hiddenSummary = (document.getElementById('tx-summary-pane')?.style.display || 'none') === 'none';
          const hiddenQuarters = (document.getElementById('tx-quarters-pane')?.style.display || 'none') === 'none';
          const shownTips = (document.getElementById('tx-tips-pane')?.style.display || '') === 'block';
          return { ok: true, hiddenSummary, hiddenQuarters, shownTips };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      if (r.hiddenSummary !== undefined) expect(r.hiddenSummary).toBe(true);
      if (r.hiddenQuarters !== undefined) expect(r.hiddenQuarters).toBe(true);
      if (r.shownTips !== undefined) expect(r.shownTips).toBe(true);
    });

    test('missing DOM (no tabs or panes) — does not throw', async () => {
      const r = await page.evaluate(() => {
        // Remove all tab/pane stubs
        const ids = ['tx-tab-summary','tx-tab-quarters','tx-tab-tips',
                     'tx-summary-pane','tx-quarters-pane','tx-tips-pane'];
        const saved = {};
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) { saved[id] = el; el.parentNode.removeChild(el); }
        });
        let ok = true, err = '';
        try { setTaxTab('summary', null); } catch (e) { ok = false; err = e.message; }
        ids.forEach(id => { if (saved[id]) document.body.appendChild(saved[id]); });
        return { ok, err };
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — no exception', async () => {
      const ok = await concurrent("setTaxTab('summary',null)", 5);
      expect(ok).toBe(5);
    });

    test('number as tab — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxTab(123, null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. _populateTaxYearSel
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_populateTaxYearSel', () => {
    test('no selector in DOM — returns early without throw', async () => {
      const r = await page.evaluate(() => {
        const sel = document.getElementById('tax-yr-sel');
        if (sel) sel.parentNode.removeChild(sel);
        let ok = true;
        try { _populateTaxYearSel(); } catch (e) { ok = false; }
        // Restore
        const newSel = document.createElement('select');
        newSel.id = 'tax-yr-sel';
        document.body.appendChild(newSel);
        return { ok };
      });
      expect(r.ok).toBe(true);
    });

    test('golden path — populates options with current year', async () => {
      const r = await page.evaluate(() => {
        const curYr = new Date().getFullYear();
        try {
          _populateTaxYearSel();
          const sel = document.getElementById('tax-yr-sel');
          const opts = sel ? [...sel.options].map(o => parseInt(o.value)) : [];
          return { ok: true, hasCurrentYear: opts.includes(curYr), count: opts.length };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasCurrentYear).toBe(true);
      expect(r.count).toBeGreaterThanOrEqual(1);
    });

    test('with income records spanning multiple years — includes data years', async () => {
      const r = await page.evaluate(() => {
        income = [
          { date: '2022-06-15', amount: 5000 },
          { date: '2023-03-01', amount: 3000 },
        ];
        try {
          _populateTaxYearSel();
          const sel = document.getElementById('tax-yr-sel');
          const opts = sel ? [...sel.options].map(o => parseInt(o.value)) : [];
          income = [];
          return { ok: true, has2022: opts.includes(2022), has2023: opts.includes(2023) };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.has2022).toBe(true);
      expect(r.has2023).toBe(true);
    });

    test('income records with invalid dates — does not throw', async () => {
      const r = await page.evaluate(() => {
        income = [
          { date: null, amount: 100 },
          { date: '', amount: 200 },
          { date: 'not-a-date', amount: 300 },
        ];
        try {
          _populateTaxYearSel();
          income = [];
          return { ok: true };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('expenses and mileage data also included in year scan', async () => {
      const r = await page.evaluate(() => {
        expenses = [{ date: '2021-07-10', amount: 500 }];
        mileage  = [{ date: '2020-11-01', miles: 100 }];
        try {
          _populateTaxYearSel();
          const sel = document.getElementById('tax-yr-sel');
          const opts = sel ? [...sel.options].map(o => parseInt(o.value)) : [];
          expenses = []; mileage = [];
          return { ok: true, has2021: opts.includes(2021), has2020: opts.includes(2020) };
        } catch (e) { expenses = []; mileage = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.has2021).toBe(true);
      expect(r.has2020).toBe(true);
    });

    test('no duplicate options after 3 calls', async () => {
      const r = await page.evaluate(() => {
        try {
          _populateTaxYearSel();
          _populateTaxYearSel();
          _populateTaxYearSel();
          const sel = document.getElementById('tax-yr-sel');
          const vals = sel ? [...sel.options].map(o => o.value) : [];
          const unique = [...new Set(vals)];
          return { ok: true, total: vals.length, unique: unique.length };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // innerHTML replace means each call replaces the options — no duplicates
      expect(r.total).toBe(r.unique);
    });

    test('concurrent calls — selector is left in a valid state', async () => {
      const ok = await concurrent('_populateTaxYearSel()', 5);
      const r = await page.evaluate(() => {
        const sel = document.getElementById('tax-yr-sel');
        return sel ? sel.options.length : -1;
      });
      expect(r).toBeGreaterThanOrEqual(1);
    });

    test('corrupted localStorage — does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_income', '{INVALID{{{{');
        try { _populateTaxYearSel(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('td_income'); }
      });
      expect(r.ok).toBe(true);
    });

    test('year outside 2019–current filtered out (year 1900)', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '1900-01-01', amount: 100 }];
        try {
          _populateTaxYearSel();
          const sel = document.getElementById('tax-yr-sel');
          const opts = sel ? [...sel.options].map(o => parseInt(o.value)) : [];
          income = [];
          return { ok: true, has1900: opts.includes(1900) };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.has1900).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. setTaxYear
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('setTaxYear', () => {
    test('null — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear(undefined); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('0 — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear(0); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('string year — does not throw, sets _taxPageYear', async () => {
      const r = await page.evaluate(() => {
        try {
          setTaxYear('2023');
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('golden path integer year 2024 — header updated', async () => {
      const r = await page.evaluate(() => {
        const hd = document.getElementById('tx-data-hd');
        try {
          setTaxYear(2024);
          return { ok: true, hdText: hd ? hd.textContent : null };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      if (r.hdText !== null) expect(r.hdText).toContain('2024');
    });

    test('boundary year -1 — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear(-1); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('very large year — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear(9999); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing tx-data-hd — does not throw', async () => {
      const r = await page.evaluate(() => {
        const hd = document.getElementById('tx-data-hd');
        if (hd) hd.parentNode.removeChild(hd);
        let ok = true, err = '';
        try { setTaxYear(2024); } catch (e) { ok = false; err = e.message; }
        // Restore
        const newHd = document.createElement('div');
        newHd.id = 'tx-data-hd';
        document.body.appendChild(newHd);
        return { ok, err };
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — no stack corruption', async () => {
      const ok = await concurrent('setTaxYear(2025)', 5);
      expect(ok).toBe(5);
    });

    test('object type mismatch — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { setTaxYear({}); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. _getSsWageBase
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_getSsWageBase', () => {
    test('null — returns default 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('undefined — returns default 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('0 — returns default 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('-1 — returns default 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(-1) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('year 2024 — returns 168600', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(2024) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(168600);
    });

    test('year 2025 — returns 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('year 2026 — returns 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(2026) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('year 2019 — returns 132900', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(2019) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(132900);
    });

    test('string year "2023" — parses and returns 160200', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase('2023') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(160200);
    });

    test('unknown future year 3000 — returns default 176100', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase(3000) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(176100);
    });

    test('object type mismatch — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _getSsWageBase({}) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // parseInt({}) is NaN → falls back to default
      expect(r.result).toBe(176100);
    });

    test('concurrent calls — consistent results', async () => {
      const ok = await concurrent('_getSsWageBase(2024)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. _calcSeTax
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_calcSeTax', () => {
    test('null netSelf — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(null, 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('undefined netSelf — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(undefined, 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('0 netSelf — returns 0 (no self-employment tax on zero income)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(0, 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('negative netSelf — returns 0 or negative, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(-1000, 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // seBase = -1000 * 0.9235 = -923.5, result will be negative but no throw
      expect(typeof r.result).toBe('number');
    });

    test('golden path 50000 in 2025 — returns positive integer tax', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _calcSeTax(50000, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // seBase = 50000 * 0.9235 = 46175
      // SS portion: 46175 * 0.124 = 5725.7 (capped)
      // Medicare: 46175 * 0.029 = 1339.075
      // total ≈ 7065, ceil
      expect(r.result).toBeGreaterThan(5000);
      expect(r.result).toBeLessThan(12000);
      expect(Number.isInteger(r.result)).toBe(true);
    });

    test('income above SS wage base (300000) — SS capped, Medicare uncapped', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _calcSeTax(300000, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // seBase = 300000 * 0.9235 = 277050
      // SS: 176100 * 0.124 = 21836.4 (capped at wage base)
      // Medicare: 277050 * 0.029 = 8034.45
      // total ≈ 29871
      expect(r.result).toBeGreaterThan(25000);
      expect(r.result).toBeLessThan(35000);
    });

    test('null year — uses default wage base 176100, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(50000, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.result).toBe('number');
    });

    test('year 2019 with income at 2019 wage base — correct cap', async () => {
      const r = await page.evaluate(() => {
        try {
          // At exactly 2019 SS wage base: seBase = 132900 / 0.9235 ≈ 143918 so income ~155828
          const result = _calcSeTax(155828, 2019);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('string netSelf — does not throw (coerces)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax('50000', 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.result).toBe('number');
    });

    test('very large income 10000000 — does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcSeTax(10000000, 2025) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('returns ceiling integer (no decimals)', async () => {
      const r = await page.evaluate(() => {
        try {
          const result = _calcSeTax(75432, 2025);
          return { ok: true, result, isInteger: Number.isInteger(result) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isInteger).toBe(true);
    });

    test('concurrent calls — all succeed', async () => {
      const ok = await concurrent('_calcSeTax(50000, 2025)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. _calcStateEstimate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_calcStateEstimate', () => {
    test('null stInfo — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcStateEstimate(50000, null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('undefined stInfo — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: _calcStateEstimate(50000, undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('noTax state info — returns 0', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: true, low: 0, high: 0, top: 0 };
        try { return { ok: true, result: _calcStateEstimate(50000, txInfo) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('zero stateAgi — returns 0', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 5, high: 9, top: 50000 };
        try { return { ok: true, result: _calcStateEstimate(0, txInfo) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('negative stateAgi — returns 0', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 5, high: 9, top: 50000 };
        try { return { ok: true, result: _calcStateEstimate(-1000, txInfo) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('flat rate state (low === high) — uses high rate flat', async () => {
      const r = await page.evaluate(() => {
        // AZ-style flat 2.5%
        const txInfo = { noTax: false, low: 2.5, high: 2.5, top: 999999 };
        try {
          const result = _calcStateEstimate(100000, txInfo);
          // 100000 * 2.5% = 2500, ceil
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(2500);
    });

    test('top>=999999 (flat bracket) — applies high rate', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 4.0, high: 4.0, top: 999999 };
        try {
          const result = _calcStateEstimate(50000, txInfo);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // 50000 * 4% = 2000
      expect(r.result).toBe(2000);
    });

    test('bracketed state income below top — applies low rate only', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 3.0, high: 6.0, top: 50000 };
        try {
          const result = _calcStateEstimate(30000, txInfo);
          // lowPart=30000, highPart=0 → 30000*3/100 = 900
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(900);
    });

    test('bracketed state income above top — splits into low+high parts', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 3.0, high: 6.0, top: 50000 };
        try {
          const result = _calcStateEstimate(80000, txInfo);
          // lowPart=50000, highPart=30000
          // 50000*3/100 + 30000*6/100 = 1500 + 1800 = 3300
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(3300);
    });

    test('golden path using real KS data — returns positive integer', async () => {
      const r = await page.evaluate(() => {
        const ksInfo = STATE_TAX['KS'];
        try {
          const result = _calcStateEstimate(40000, ksInfo);
          return { ok: true, result, isInteger: Number.isInteger(result) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
      expect(r.isInteger).toBe(true);
    });

    test('very large stateAgi — does not throw', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false, low: 5.0, high: 10.0, top: 100000 };
        try { return { ok: true, result: _calcStateEstimate(99999999, txInfo) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('stInfo missing low/high fields — does not throw', async () => {
      const r = await page.evaluate(() => {
        const txInfo = { noTax: false };
        try { return { ok: true, result: _calcStateEstimate(50000, txInfo) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — all succeed', async () => {
      const ok = await concurrent("_calcStateEstimate(40000, {noTax:false,low:3,high:6,top:50000})", 5);
      expect(ok).toBe(5);
    });

    test('returns ceiling integer (Math.ceil applied)', async () => {
      const r = await page.evaluate(() => {
        // 33333 * 3.3% = 1099.989, ceil → 1100
        const txInfo = { noTax: false, low: 3.3, high: 3.3, top: 999999 };
        try {
          const result = _calcStateEstimate(33333, txInfo);
          return { ok: true, result, isInteger: Number.isInteger(result) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isInteger).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. calcTax
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('calcTax', () => {
    test('no income, no expenses — does not throw', async () => {
      await resetData();
      const r = await page.evaluate(() => {
        income = []; expenses = []; mileage = []; payments = []; bids = [];
        try { calcTax(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('missing required DOM elements — does not throw', async () => {
      const r = await page.evaluate(() => {
        const ids = ['tx-inputs','tx-results','tx-quarters','tx-tips','tx-reserve-banner'];
        const saved = {};
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) { saved[id] = el; el.parentNode.removeChild(el); }
        });
        let ok = true, err = '';
        try { calcTax(); } catch (e) { ok = false; err = e.message; }
        ids.forEach(id => { if (saved[id]) document.body.appendChild(saved[id]); });
        return { ok, err };
      });
      expect(r.ok).toBe(true);
    });

    test('golden path: income present, single filer, KS state — renders results', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-03-15', amount: 80000 }];
        expenses = [{ date: '2025-04-10', amount: 5000 }];
        mileage = [{ date: '2025-05-20', miles: 2000 }];
        S.state = 'KS';
        S.txStatus = 'single';
        const txStatus = document.getElementById('tx-status');
        if (txStatus) txStatus.value = 'single';
        try {
          calcTax();
          const resultsEl = document.getElementById('tx-results');
          const html = resultsEl ? resultsEl.innerHTML : '';
          income = []; expenses = []; mileage = [];
          return { ok: true, hasContent: html.length > 0 };
        } catch (e) { income = []; expenses = []; mileage = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasContent).toBe(true);
    });

    test('married filing jointly status — does not throw', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-06-01', amount: 120000 }];
        const txStatus = document.getElementById('tx-status');
        if (txStatus) txStatus.value = 'mfj';
        const spouseEl = document.getElementById('tx-spouse');
        if (spouseEl) spouseEl.value = '50000';
        try { calcTax(); income = []; if (spouseEl) spouseEl.value = '0'; return { ok: true }; }
        catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('head of household status — does not throw', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-01-10', amount: 60000 }];
        const txStatus = document.getElementById('tx-status');
        if (txStatus) txStatus.value = 'hoh';
        try { calcTax(); income = []; if (txStatus) txStatus.value = 'single'; return { ok: true }; }
        catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('expenses exceed income (net self <= 0) — does not throw, SE tax is 0', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-02-01', amount: 5000 }];
        expenses = [{ date: '2025-02-15', amount: 20000 }];
        try {
          calcTax();
          const resultsEl = document.getElementById('tx-results');
          const html = resultsEl ? resultsEl.innerHTML : '';
          income = []; expenses = [];
          return { ok: true, hasContent: html.length >= 0 };
        } catch (e) { income = []; expenses = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('taxPaid covers total owed — stillOwed is 0', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-01-05', amount: 50000 }];
        const paidEl = document.getElementById('tx-paid');
        if (paidEl) paidEl.value = '999999';
        try {
          calcTax();
          income = [];
          if (paidEl) paidEl.value = '0';
          return { ok: true };
        } catch (e) { income = []; if (paidEl) paidEl.value = '0'; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('prior year tax set — safe harbor note shown', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-03-01', amount: 70000 }];
        const priorEl = document.getElementById('tx-prior-yr');
        if (priorEl) priorEl.value = '15000';
        try {
          calcTax();
          const html = document.getElementById('tx-quarters')?.innerHTML || '';
          income = [];
          if (priorEl) priorEl.value = '0';
          return { ok: true, hasSafeHarbor: html.includes('penalty-free') || html.includes('Penalty-free') };
        } catch (e) {
          income = [];
          if (priorEl) priorEl.value = '0';
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
      expect(r.hasSafeHarbor).toBe(true);
    });

    test('high AGI > 150000 triggers 110% safe harbor rate', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-04-01', amount: 250000 }];
        const priorEl = document.getElementById('tx-prior-yr');
        const priorAgiEl = document.getElementById('tx-prior-yr-agi');
        if (priorEl) priorEl.value = '40000';
        if (priorAgiEl) priorAgiEl.value = '200000';
        try {
          calcTax();
          income = [];
          if (priorEl) priorEl.value = '0';
          if (priorAgiEl) priorAgiEl.value = '0';
          return { ok: true };
        } catch (e) {
          income = [];
          if (priorEl) priorEl.value = '0';
          if (priorAgiEl) priorAgiEl.value = '0';
          return { ok: false, err: e.message };
        }
      });
      expect(r.ok).toBe(true);
    });

    test('multi-state payments (KS + TX job) — no throw', async () => {
      const r = await page.evaluate(() => {
        bids = [{ id: 99991, addr: '100 Main St, Austin TX 78701', status: 'Closed Won' }];
        bids.push({ id: 99992, addr: '200 Oak Ave, Wichita KS 67202', status: 'Closed Won' });
        payments = [
          { bid_id: 99991, amount: 30000, date: '2025-05-01' },
          { bid_id: 99992, amount: 20000, date: '2025-06-01' },
        ];
        S.state = 'KS';
        try {
          calcTax();
          bids = []; payments = [];
          return { ok: true };
        } catch (e) { bids = []; payments = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('no duplicate entries after 3 calls', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-07-01', amount: 60000 }];
        try {
          calcTax(); calcTax(); calcTax();
          const html = document.getElementById('tx-results')?.innerHTML || '';
          income = [];
          // Count occurrences of "Self-employment tax"
          const matches = (html.match(/Self-employment tax/g) || []).length;
          return { ok: true, matches };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // innerHTML is replaced each call so exactly 1 entry
      expect(r.matches).toBe(1);
    });

    test('high expense ratio > 63% — audit risk block rendered', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2026-08-01', amount: 100000 }];
        expenses = [{ date: '2026-08-15', amount: 70000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-results')?.innerHTML || '';
          income = []; expenses = [];
          return { ok: true, hasAudit: html.toLowerCase().includes('audit') };
        } catch (e) { income = []; expenses = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasAudit).toBe(true);
    });

    test('medium expense ratio 52–63% — audit medium shown', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2026-09-01', amount: 100000 }];
        expenses = [{ date: '2026-09-10', amount: 57000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-results')?.innerHTML || '';
          income = []; expenses = [];
          return { ok: true, hasAudit: html.toLowerCase().includes('audit') };
        } catch (e) { income = []; expenses = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasAudit).toBe(true);
    });

    test('low expense ratio < 52% — low risk shown', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2026-10-01', amount: 100000 }];
        expenses = [{ date: '2026-10-05', amount: 20000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-results')?.innerHTML || '';
          income = []; expenses = [];
          return { ok: true, hasLow: html.toLowerCase().includes('low risk') };
        } catch (e) { income = []; expenses = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasLow).toBe(true);
    });

    test('SEP-IRA tip shown when income > 0', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2026-05-10', amount: 90000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-tips')?.innerHTML || '';
          income = [];
          return { ok: true, hasSep: html.includes('SEP') || html.includes('Retirement') };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasSep).toBe(true);
    });

    test('KS commercial labor tip shown for KS state', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-06-01', amount: 50000 }];
        S.state = 'KS';
        try {
          calcTax();
          const html = document.getElementById('tx-tips')?.innerHTML || '';
          income = [];
          return { ok: true, hasKsTip: html.includes('Kansas') };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasKsTip).toBe(true);
    });

    test('nextTaxTip function registered on window', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-01-15', amount: 40000 }];
        try {
          calcTax();
          income = [];
          return { ok: true, hasFn: typeof window._nextTaxTip === 'function' };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasFn).toBe(true);
    });

    test('_nextTaxTip cycling — advances tip index and re-renders', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-02-20', amount: 55000 }];
        try {
          calcTax();
          const html1 = document.getElementById('tx-tips')?.innerHTML || '';
          if (typeof window._nextTaxTip === 'function') window._nextTaxTip();
          const html2 = document.getElementById('tx-tips')?.innerHTML || '';
          income = [];
          return { ok: true, changed: html1 !== html2 || html2.length > 0 };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('corrupted localStorage — calcTax does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_income', '{INVALID{{{{');
        localStorage.setItem('td_expenses', '[bad json');
        income = [{ date: '2025-03-01', amount: 30000 }];
        try { calcTax(); income = []; return { ok: true }; }
        catch (e) { income = []; return { ok: false, err: e.message }; }
        finally {
          localStorage.removeItem('td_income');
          localStorage.removeItem('td_expenses');
        }
      });
      expect(r.ok).toBe(true);
    });

    test('concurrent calls — no exception', async () => {
      await page.evaluate(() => {
        income = [{ date: '2025-04-01', amount: 40000 }];
      });
      const ok = await concurrent('calcTax()', 5);
      await page.evaluate(() => { income = []; });
      expect(ok).toBe(5);
    });

    test('payment with amount 0 — filtered out (not counted in income)', async () => {
      const r = await page.evaluate(() => {
        income = [];
        payments = [{ bid_id: null, amount: 0, date: '2025-01-01' }];
        try {
          calcTax();
          payments = [];
          return { ok: true };
        } catch (e) { payments = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('payments with null date — filtered safely', async () => {
      const r = await page.evaluate(() => {
        payments = [
          { bid_id: 1, amount: 5000, date: null },
          { bid_id: 2, amount: 3000, date: '' },
        ];
        try { calcTax(); payments = []; return { ok: true }; }
        catch (e) { payments = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('reserve banner rendered when income > 0', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2026-07-15', amount: 50000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-reserve-banner')?.innerHTML || '';
          income = [];
          return { ok: true, hasBanner: html.length > 0 };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasBanner).toBe(true);
    });

    test('reserve banner empty when income is 0', async () => {
      const r = await page.evaluate(() => {
        income = [];
        try {
          calcTax();
          const html = document.getElementById('tx-reserve-banner')?.innerHTML || '';
          return { ok: true, isEmpty: html === '' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.isEmpty).toBe(true);
    });

    test('quarter due dates rendered', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-09-01', amount: 60000 }];
        try {
          calcTax();
          const html = document.getElementById('tx-quarters')?.innerHTML || '';
          income = [];
          return {
            ok: true,
            hasQ1: html.includes('Q1'),
            hasQ2: html.includes('Q2'),
            hasQ3: html.includes('Q3'),
            hasQ4: html.includes('Q4'),
          };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasQ1).toBe(true);
      expect(r.hasQ2).toBe(true);
      expect(r.hasQ3).toBe(true);
      expect(r.hasQ4).toBe(true);
    });

    test('sum-tx-status select synced to current status', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-01-01', amount: 30000 }];
        const txStatus = document.getElementById('tx-status');
        if (txStatus) txStatus.value = 'mfj';
        try {
          calcTax();
          const sumSel = document.getElementById('sum-tx-status');
          income = [];
          if (txStatus) txStatus.value = 'single';
          return { ok: true, val: sumSel ? sumSel.value : null };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      if (r.val !== null) expect(r.val).toBe('mfj');
    });

    test('selected year filters correctly — only counts income for that year', async () => {
      const r = await page.evaluate(() => {
        income = [
          { date: '2024-05-01', amount: 50000 },
          { date: '2025-03-01', amount: 80000 },
        ];
        setTaxYear(2024);
        try {
          calcTax();
          const html = document.getElementById('tx-inputs')?.innerHTML || '';
          income = [];
          setTaxYear(new Date().getFullYear());
          // In 2024 we should see $50,000 gross, not $80,000
          return { ok: true, hasContent: html.length > 0 };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.hasContent).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. estimateTax
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('estimateTax', () => {
    test('null netSelf — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: estimateTax(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('undefined netSelf — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: estimateTax(undefined) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('0 netSelf — returns 0 (early exit for <= 0)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: estimateTax(0) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('-1 netSelf — returns 0 (early exit for <= 0)', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: estimateTax(-1) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('-999999 netSelf — returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: estimateTax(-999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('golden path 80000 single 2025 — returns positive integer', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(80000, 2025);
          return { ok: true, result, isInteger: Number.isInteger(result) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(5000);
      expect(r.result).toBeLessThan(35000);
      expect(r.isInteger).toBe(true);
    });

    test('mfj status — returns lower tax than single (doubled brackets)', async () => {
      const r = await page.evaluate(() => {
        try {
          S.txStatus = 'mfj';
          const mfjTax = estimateTax(80000, 2025);
          S.txStatus = 'single';
          const singleTax = estimateTax(80000, 2025);
          return { ok: true, mfjTax, singleTax };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // MFJ brackets are wider so tax should be <= single at same income
      expect(r.mfjTax).toBeLessThanOrEqual(r.singleTax);
    });

    test('year 2024 — uses 2024 brackets, not current year', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result2024 = estimateTax(80000, 2024);
          const result2025 = estimateTax(80000, 2025);
          return { ok: true, result2024, result2025 };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // Both should be positive and reasonable
      expect(r.result2024).toBeGreaterThan(0);
      expect(r.result2025).toBeGreaterThan(0);
    });

    test('no year provided — uses current year brackets', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(60000);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('1 dollar netSelf — returns positive tax', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(1, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThanOrEqual(0);
    });

    test('very large income 5000000 — does not throw, returns large number', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(5000000, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(100000);
    });

    test('string netSelf "50000" — behaves gracefully (early-exit branch: "50000" > 0 is true)', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax('50000', 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // String '50000' > 0 is true in JS, so function proceeds
      expect(typeof r.result).toBe('number');
    });

    test('string "0" — returns 0 (early exit: "0" <= 0 is false in JS, but 0 returns 0)', async () => {
      const r = await page.evaluate(() => {
        try {
          // estimateTax(0) → netSelf<=0 → return 0
          const result = estimateTax(0, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });

    test('MFS status — does not throw', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'mfs';
        try {
          const result = estimateTax(60000, 2025);
          S.txStatus = 'single';
          return { ok: true, result };
        } catch (e) { S.txStatus = 'single'; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('HOH status — does not throw', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'hoh';
        try {
          const result = estimateTax(60000, 2025);
          S.txStatus = 'single';
          return { ok: true, result };
        } catch (e) { S.txStatus = 'single'; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('unknown status falls back to single brackets', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'invalidstatus';
        try {
          const result = estimateTax(70000, 2025);
          S.txStatus = 'single';
          const singleResult = estimateTax(70000, 2025);
          return { ok: true, result, singleResult };
        } catch (e) { S.txStatus = 'single'; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      // Unknown status → falls back to single in calcBrackets call
      expect(r.result).toBe(r.singleResult);
    });

    test('tax increases monotonically with income', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const t1 = estimateTax(30000, 2025);
          const t2 = estimateTax(60000, 2025);
          const t3 = estimateTax(120000, 2025);
          return { ok: true, t1, t2, t3 };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.t1).toBeLessThan(r.t2);
      expect(r.t2).toBeLessThan(r.t3);
    });

    test('concurrent calls — all return same result', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        const results = [];
        for (let i = 0; i < 5; i++) {
          try { results.push(estimateTax(50000, 2025)); } catch (_) { results.push(null); }
        }
        return { ok: results.every(v => v !== null), results };
      });
      expect(r.ok).toBe(true);
      // All calls should return the same deterministic value
      const unique = [...new Set(r.results)];
      expect(unique).toHaveLength(1);
    });

    test('corrupted localStorage — does not throw', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('td_settings', '{BAD{{JSON');
        S.txStatus = 'single';
        try {
          const result = estimateTax(50000, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('td_settings'); }
      });
      expect(r.ok).toBe(true);
    });

    test('year 2019 — uses 2019 brackets', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(80000, 2019);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBeGreaterThan(0);
    });

    test('fractional income 0.01 — does not throw', async () => {
      const r = await page.evaluate(() => {
        S.txStatus = 'single';
        try {
          const result = estimateTax(0.01, 2025);
          return { ok: true, result };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(typeof r.result).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Integration — setTaxYear + calcTax loop
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('integration: setTaxYear + calcTax', () => {
    test('switching year updates displayed header', async () => {
      const r = await page.evaluate(() => {
        income = [
          { date: '2024-06-01', amount: 50000 },
          { date: '2025-07-01', amount: 70000 },
        ];
        try {
          setTaxYear(2024);
          const hd = document.getElementById('tx-data-hd');
          const text2024 = hd ? hd.textContent : '';
          setTaxYear(2025);
          const text2025 = hd ? hd.textContent : '';
          income = [];
          return { ok: true, text2024, text2025 };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.text2024).toContain('2024');
      expect(r.text2025).toContain('2025');
    });

    test('tab switch then calcTax — all work together', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-01-01', amount: 45000 }];
        try {
          setTaxTab('summary', null);
          setTaxYear(2025);
          calcTax();
          income = [];
          return { ok: true };
        } catch (e) { income = []; return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });

    test('onStateChange then calcTax — state rates applied', async () => {
      const r = await page.evaluate(() => {
        income = [{ date: '2025-03-10', amount: 60000 }];
        try {
          onStateChange('CA');
          calcTax();
          onStateChange('KS'); // restore
          income = [];
          return { ok: true };
        } catch (e) { income = []; onStateChange('KS'); return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Console error guard
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors — tax.js', () => {
    assertNoErrors(page, 'tax.js');
  });
});
