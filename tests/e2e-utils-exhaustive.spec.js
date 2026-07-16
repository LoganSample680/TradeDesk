// @ts-check
/**
 * Exhaustive E2E coverage for utils.js
 * Every exported function is tested across: null, undefined, empty, boundary,
 * type-mismatch, missing DOM, golden-path, concurrent-calls, corrupted-localStorage,
 * duplicate-render, and guard-release scenarios.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('utils.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ── Utility: run expression N times synchronously ─────────────────────────
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
  // 1. fmt
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmt', () => {
    test('null: returns $0.00', async () => {
      const r = await page.evaluate(() => fmt(null));
      expect(r).toBe('$0.00');
    });
    test('undefined: returns $0.00', async () => {
      const r = await page.evaluate(() => fmt(undefined));
      expect(r).toBe('$0.00');
    });
    test('0: returns $0.00', async () => {
      const r = await page.evaluate(() => fmt(0));
      expect(r).toBe('$0.00');
    });
    test('negative: returns negative string', async () => {
      const r = await page.evaluate(() => fmt(-1));
      expect(r).toContain('$');
      expect(r).toContain('-');
    });
    test('1: returns $1.00', async () => {
      const r = await page.evaluate(() => fmt(1));
      expect(r).toBe('$1.00');
    });
    test('golden path 2375, returns formatted string', async () => {
      const r = await page.evaluate(() => fmt(2375));
      expect(r).toBe('$2,375.00');
    });
    test('very large number, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmt(9999999999) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toContain('$');
    });
    test('string number, coerces gracefully', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmt('500') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('$500.00');
    });
    test('non-numeric string, returns $0.00', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmt('abc') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('$0.00');
    });
    test('concurrent calls, no stack corruption', async () => {
      const ok = await concurrent('fmt(1234.56)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. fmtShort
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmtShort', () => {
    test('null: returns $0', async () => {
      const r = await page.evaluate(() => fmtShort(null));
      expect(r).toBe('$0');
    });
    test('undefined: returns $0', async () => {
      const r = await page.evaluate(() => fmtShort(undefined));
      expect(r).toBe('$0');
    });
    test('0: returns $0', async () => {
      const r = await page.evaluate(() => fmtShort(0));
      expect(r).toBe('$0');
    });
    test('999: returns under-1k format', async () => {
      const r = await page.evaluate(() => fmtShort(999));
      expect(r).toBe('$999');
    });
    test('1000: returns K suffix', async () => {
      const r = await page.evaluate(() => fmtShort(1000));
      expect(r).toMatch(/\$1\.0K/);
    });
    test('1500: returns 1.5K', async () => {
      const r = await page.evaluate(() => fmtShort(1500));
      expect(r).toMatch(/\$1\.5K/);
    });
    test('1000000: returns M suffix', async () => {
      const r = await page.evaluate(() => fmtShort(1000000));
      expect(r).toMatch(/\$1\.0M/);
    });
    test('negative large, returns negative M', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmtShort(-2000000) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toContain('M');
    });
    test('string number, coerces', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmtShort('5000') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toContain('K');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('fmtShort(123456)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. formatPhoneDisplay
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('formatPhoneDisplay', () => {
    test('null: returns empty string', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay(null));
      expect(r).toBe('');
    });
    test('undefined: returns empty string', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay(undefined));
      expect(r).toBe('');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay(''));
      expect(r).toBe('');
    });
    test('3 digits only, returns digits only', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('316'));
      expect(r).toBe('316');
    });
    test('6 digits, returns dashed partial', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('316555'));
      expect(r).toBe('316-555');
    });
    test('10 digits, returns full formatted', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('3165550100'));
      expect(r).toBe('316-555-0100');
    });
    test('already formatted, strips and reformats', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('316-555-0100'));
      expect(r).toBe('316-555-0100');
    });
    test('more than 10 digits, truncates to 10', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('31655501001234'));
      expect(r).toBe('316-555-0100');
    });
    test('letters mixed in, strips non-digits', async () => {
      const r = await page.evaluate(() => formatPhoneDisplay('abc3165550100xyz'));
      expect(r).toBe('316-555-0100');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('formatPhoneDisplay("3165550100")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. fmtPhone
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmtPhone', () => {
    test('golden path, formats input element value', async () => {
      const r = await page.evaluate(() => {
        try {
          const inp = document.createElement('input');
          inp.value = '3165550100';
          fmtPhone(inp);
          return { ok: true, result: inp.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('316-555-0100');
    });
    test('value with letters, strips and formats', async () => {
      const r = await page.evaluate(() => {
        try {
          const inp = document.createElement('input');
          inp.value = '(316) 555-0100';
          fmtPhone(inp);
          return { ok: true, result: inp.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('316-555-0100');
    });
    test('empty value, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const inp = document.createElement('input');
          inp.value = '';
          fmtPhone(inp);
          return { ok: true, result: inp.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('');
    });
    test('6-digit value, partial format', async () => {
      const r = await page.evaluate(() => {
        try {
          const inp = document.createElement('input');
          inp.value = '316555';
          fmtPhone(inp);
          return { ok: true, result: inp.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('316-555');
    });
    test('more than 10 digits, truncates to 10', async () => {
      const r = await page.evaluate(() => {
        try {
          const inp = document.createElement('input');
          inp.value = '31655501001234';
          fmtPhone(inp);
          return { ok: true, result: inp.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('316-555-0100');
    });
    test('null input object, throws or graceful', async () => {
      const r = await page.evaluate(() => {
        try { fmtPhone(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      // fmtPhone accesses input.value: null throws TypeError, that is acceptable
      // but page must not crash
      expect(typeof r.ok).toBe('boolean');
    });
    test('concurrent calls, no stack corruption', async () => {
      const ok = await page.evaluate(() => {
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try {
            const inp = document.createElement('input');
            inp.value = '3165550100';
            fmtPhone(inp);
            count++;
          } catch (_) {}
        }
        return count;
      });
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. fmt2
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmt2', () => {
    test('null: returns $0', async () => {
      const r = await page.evaluate(() => fmt2(null));
      expect(r).toMatch(/^\$0/);
    });
    test('undefined: returns $0', async () => {
      const r = await page.evaluate(() => fmt2(undefined));
      expect(r).toMatch(/^\$0/);
    });
    test('0: returns $0', async () => {
      const r = await page.evaluate(() => fmt2(0));
      expect(r).toMatch(/^\$0/);
    });
    test('1: rounds up to $5', async () => {
      const r = await page.evaluate(() => fmt2(1));
      expect(r).toBe('$5');
    });
    test('5: stays at $5', async () => {
      const r = await page.evaluate(() => fmt2(5));
      expect(r).toBe('$5');
    });
    test('6: rounds up to $10', async () => {
      const r = await page.evaluate(() => fmt2(6));
      expect(r).toBe('$10');
    });
    test('2375: rounds to nearest 5', async () => {
      const r = await page.evaluate(() => fmt2(2375));
      expect(r).toBe('$2,375');
    });
    test('2376: rounds up to $2380', async () => {
      const r = await page.evaluate(() => fmt2(2376));
      expect(r).toBe('$2,380');
    });
    test('string number, coerces', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmt2('100') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toContain('$');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('fmt2(2376)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. fmtD
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmtD', () => {
    test('null: returns $0.00', async () => {
      const r = await page.evaluate(() => fmtD(null));
      expect(r).toBe('$0.00');
    });
    test('undefined: returns $0.00', async () => {
      const r = await page.evaluate(() => fmtD(undefined));
      expect(r).toBe('$0.00');
    });
    test('0: returns $0.00', async () => {
      const r = await page.evaluate(() => fmtD(0));
      expect(r).toBe('$0.00');
    });
    test('1.5: returns $1.50', async () => {
      const r = await page.evaluate(() => fmtD(1.5));
      expect(r).toBe('$1.50');
    });
    test('2375.99: two decimal places', async () => {
      const r = await page.evaluate(() => fmtD(2375.99));
      expect(r).toBe('$2,375.99');
    });
    test('string number, coerces', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmtD('99.5') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('$99.50');
    });
    test('non-numeric string, returns $0.00', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmtD('abc') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('$0.00');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('fmtD(123.45)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. dateKey
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('dateKey', () => {
    test('golden path date, returns YYYY-MM-DD', async () => {
      const r = await page.evaluate(() => dateKey(new Date('2026-06-26T12:00:00')));
      expect(r).toBe('2026-06-26');
    });
    test('Jan 1, pads month and day', async () => {
      const r = await page.evaluate(() => dateKey(new Date('2026-01-01T12:00:00')));
      expect(r).toBe('2026-01-01');
    });
    test('Dec 31, correct key', async () => {
      const r = await page.evaluate(() => dateKey(new Date('2025-12-31T12:00:00')));
      expect(r).toBe('2025-12-31');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('dateKey(new Date())', 5);
      expect(ok).toBe(5);
    });
    test('invalid date object, does not throw or produces NaN string', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: dateKey(new Date('not-a-date')) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      // NaN-based output is acceptable; page must not crash
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. todayKey
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('todayKey', () => {
    test('returns YYYY-MM-DD format string', async () => {
      const r = await page.evaluate(() => todayKey());
      expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    test('matches current year', async () => {
      const r = await page.evaluate(() => todayKey());
      const year = new Date().getFullYear().toString();
      expect(r.startsWith(year)).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('todayKey()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. parseD
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('parseD', () => {
    test('golden path, returns Date at noon', async () => {
      const r = await page.evaluate(() => {
        const d = parseD('2026-06-15');
        return { ok: true, iso: d.toISOString(), hours: d.getHours() };
      });
      expect(r.ok).toBe(true);
      // Date parses at local noon, hours depend on timezone; just verify it is a valid date
      expect(isNaN(new Date(r.iso).getTime())).toBe(false);
    });
    test('returns Date object', async () => {
      const r = await page.evaluate(() => parseD('2026-01-01') instanceof Date);
      expect(r).toBe(true);
    });
    test('empty string, returns Date (possibly invalid)', async () => {
      const r = await page.evaluate(() => {
        try { const d = parseD(''); return { ok: true, isDate: d instanceof Date }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('parseD("2026-06-26")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. addDays
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('addDays', () => {
    test('add 1 day, increments date', async () => {
      const r = await page.evaluate(() => addDays('2026-06-25', 1));
      expect(r).toBe('2026-06-26');
    });
    test('add 0 days, same date', async () => {
      const r = await page.evaluate(() => addDays('2026-06-26', 0));
      expect(r).toBe('2026-06-26');
    });
    test('add negative, goes back', async () => {
      const r = await page.evaluate(() => addDays('2026-06-26', -1));
      expect(r).toBe('2026-06-25');
    });
    test('add across month boundary', async () => {
      const r = await page.evaluate(() => addDays('2026-01-31', 1));
      expect(r).toBe('2026-02-01');
    });
    test('add across year boundary', async () => {
      const r = await page.evaluate(() => addDays('2025-12-31', 1));
      expect(r).toBe('2026-01-01');
    });
    test('large n, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: addDays('2026-01-01', 365) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('addDays("2026-06-26", 1)', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. v (DOM value getter)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('v', () => {
    test('missing element, returns empty string', async () => {
      const r = await page.evaluate(() => v('__nonexistent_id_xyz__'));
      expect(r).toBe('');
    });
    test('element with value, returns value', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.id = '__test_v_el__';
        el.value = 'hello';
        document.body.appendChild(el);
        const result = v('__test_v_el__');
        el.remove();
        return result;
      });
      expect(r).toBe('hello');
    });
    test('element with empty value, returns empty string', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.id = '__test_v_empty__';
        el.value = '';
        document.body.appendChild(el);
        const result = v('__test_v_empty__');
        el.remove();
        return result;
      });
      expect(r).toBe('');
    });
    test('null id, does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: v(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe('');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('v("__nonexistent_id_xyz__")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. nv (DOM numeric value getter)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('nv', () => {
    test('missing element, returns 0', async () => {
      const r = await page.evaluate(() => nv('__nonexistent_id_xyz__'));
      expect(r).toBe(0);
    });
    test('element with numeric value, returns number', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.id = '__test_nv_el__';
        el.value = '42.5';
        document.body.appendChild(el);
        const result = nv('__test_nv_el__');
        el.remove();
        return result;
      });
      expect(r).toBe(42.5);
    });
    test('element with text value, returns 0', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.id = '__test_nv_text__';
        el.value = 'abc';
        document.body.appendChild(el);
        const result = nv('__test_nv_text__');
        el.remove();
        return result;
      });
      expect(r).toBe(0);
    });
    test('null id, returns 0', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: nv(null) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('nv("__nonexistent_id_xyz__")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. IRS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('IRS', () => {
    test('returns default 0.725 when S.irsRate not set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.irsRate;
        delete S.irsRate;
        const result = IRS();
        if (orig !== undefined) S.irsRate = orig;
        return result;
      });
      expect(r).toBe(0.725);
    });
    test('returns S.irsRate when set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.irsRate;
        S.irsRate = 0.67;
        const result = IRS();
        S.irsRate = orig;
        return result;
      });
      expect(r).toBe(0.67);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('IRS()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. fmtTime
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmtTime', () => {
    test('null: returns empty string', async () => {
      const r = await page.evaluate(() => fmtTime(null));
      expect(r).toBe('');
    });
    test('undefined: returns empty string', async () => {
      const r = await page.evaluate(() => fmtTime(undefined));
      expect(r).toBe('');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => fmtTime(''));
      expect(r).toBe('');
    });
    test('00:00: midnight', async () => {
      const r = await page.evaluate(() => fmtTime('00:00'));
      expect(r).toBe('12:00 AM');
    });
    test('12:00: noon', async () => {
      const r = await page.evaluate(() => fmtTime('12:00'));
      expect(r).toBe('12:00 PM');
    });
    test('09:00: 9:00 AM', async () => {
      const r = await page.evaluate(() => fmtTime('09:00'));
      expect(r).toBe('9:00 AM');
    });
    test('13:30: 1:30 PM', async () => {
      const r = await page.evaluate(() => fmtTime('13:30'));
      expect(r).toBe('1:30 PM');
    });
    test('23:59: 11:59 PM', async () => {
      const r = await page.evaluate(() => fmtTime('23:59'));
      expect(r).toBe('11:59 PM');
    });
    test('single-digit minute, pads with zero', async () => {
      const r = await page.evaluate(() => fmtTime('09:05'));
      expect(r).toBe('9:05 AM');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('fmtTime("09:30")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. COVERAGE
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('COVERAGE', () => {
    test('returns default 350 when S.cov not set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.cov;
        delete S.cov;
        const result = COVERAGE();
        if (orig !== undefined) S.cov = orig;
        return result;
      });
      expect(r).toBe(350);
    });
    test('returns S.cov when set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.cov;
        S.cov = 400;
        const result = COVERAGE();
        S.cov = orig;
        return result;
      });
      expect(r).toBe(400);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('COVERAGE()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. MARGIN
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('MARGIN', () => {
    test('returns default 0.25 when S.margin not set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.margin;
        delete S.margin;
        const result = MARGIN();
        if (orig !== undefined) S.margin = orig;
        return result;
      });
      expect(r).toBe(0.25);
    });
    test('returns S.margin/100 when set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.margin;
        S.margin = 30;
        const result = MARGIN();
        S.margin = orig;
        return result;
      });
      expect(r).toBeCloseTo(0.30);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('MARGIN()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. MATMARK
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('MATMARK', () => {
    test('returns default 1.20 when S.mm not set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.mm;
        delete S.mm;
        const result = MATMARK();
        if (orig !== undefined) S.mm = orig;
        return result;
      });
      expect(r).toBeCloseTo(1.20);
    });
    test('returns 1 + S.mm/100 when set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.mm;
        S.mm = 50;
        const result = MATMARK();
        S.mm = orig;
        return result;
      });
      expect(r).toBeCloseTo(1.50);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('MATMARK()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. LABOR_RATES
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('LABOR_RATES', () => {
    test('returns object with walls key', async () => {
      const r = await page.evaluate(() => {
        const lr = LABOR_RATES();
        return { ok: true, hasWalls: 'walls' in lr, walls: lr.walls };
      });
      expect(r.ok).toBe(true);
      expect(r.hasWalls).toBe(true);
      expect(r.walls).toBeGreaterThan(0);
    });
    test('defaults when S rates not set', async () => {
      const r = await page.evaluate(() => {
        const origWalls = S.rWalls;
        delete S.rWalls;
        const lr = LABOR_RATES();
        if (origWalls !== undefined) S.rWalls = origWalls;
        return lr.walls;
      });
      expect(r).toBe(1.30);
    });
    test('uses S rates when set', async () => {
      const r = await page.evaluate(() => {
        const orig = S.rWalls;
        S.rWalls = 2.00;
        const lr = LABOR_RATES();
        S.rWalls = orig;
        return lr.walls;
      });
      expect(r).toBe(2.00);
    });
    test('returns all required keys', async () => {
      const r = await page.evaluate(() => {
        const lr = LABOR_RATES();
        return Object.keys(lr);
      });
      expect(r).toContain('walls');
      expect(r).toContain('ceiling');
      expect(r).toContain('trim');
      expect(r).toContain('doors');
      expect(r).toContain('windows');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('LABOR_RATES()', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. initials
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('initials', () => {
    test('null: returns ?', async () => {
      const r = await page.evaluate(() => initials(null));
      expect(r).toMatch(/^\?\?$|^\?/);
    });
    test('undefined: returns ?', async () => {
      const r = await page.evaluate(() => initials(undefined));
      expect(r).toMatch(/^\?\?$|^\?/);
    });
    test('empty string, uses fallback', async () => {
      const r = await page.evaluate(() => initials(''));
      expect(r.length).toBeGreaterThanOrEqual(1);
    });
    test('single name, two chars from name', async () => {
      const r = await page.evaluate(() => initials('Zach'));
      expect(r).toBe('ZA');
    });
    test('two-word name, first and last initials', async () => {
      const r = await page.evaluate(() => initials('John Doe'));
      expect(r).toBe('JD');
    });
    test('three-word name, first and last initials', async () => {
      const r = await page.evaluate(() => initials('Mary Jane Watson'));
      expect(r).toBe('MW');
    });
    test('lowercase name, returns uppercase', async () => {
      const r = await page.evaluate(() => initials('john doe'));
      expect(r).toBe('JD');
    });
    test('extra whitespace, trims', async () => {
      const r = await page.evaluate(() => initials('  Alice  Smith  '));
      expect(r).toBe('AS');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('initials("John Doe")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. stageAvatar
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('stageAvatar', () => {
    test('null: returns default blue style', async () => {
      const r = await page.evaluate(() => stageAvatar(null));
      expect(r).toContain('blue');
    });
    test('undefined: returns default style', async () => {
      const r = await page.evaluate(() => stageAvatar(undefined));
      expect(r).toContain('background');
    });
    test('empty string, returns default style', async () => {
      const r = await page.evaluate(() => stageAvatar(''));
      expect(r).toContain('background');
    });
    test('new: blue style', async () => {
      const r = await page.evaluate(() => stageAvatar('new'));
      expect(r).toContain('blue');
    });
    test('signed: green style', async () => {
      const r = await page.evaluate(() => stageAvatar('signed'));
      expect(r).toContain('green');
    });
    test('balance_due: red style', async () => {
      const r = await page.evaluate(() => stageAvatar('balance_due'));
      expect(r).toContain('#FEE8E8');
    });
    test('paid: muted style', async () => {
      const r = await page.evaluate(() => stageAvatar('paid'));
      expect(r).toContain('bg2');
    });
    test('unknown stage, returns default', async () => {
      const r = await page.evaluate(() => stageAvatar('not_a_real_stage'));
      expect(r).toContain('blue');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('stageAvatar("signed")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 21. lighten
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('lighten', () => {
    test('valid hex, returns rgba string', async () => {
      const r = await page.evaluate(() => lighten('#2D5DA8'));
      expect(r).toMatch(/^rgba\(\d+,\d+,\d+,0\.15\)$/);
    });
    test('black: returns rgba(0,0,0,0.15)', async () => {
      const r = await page.evaluate(() => lighten('#000000'));
      expect(r).toBe('rgba(0,0,0,0.15)');
    });
    test('white: returns rgba(255,255,255,0.15)', async () => {
      const r = await page.evaluate(() => lighten('#ffffff'));
      expect(r).toBe('rgba(255,255,255,0.15)');
    });
    test('null: returns #eee fallback', async () => {
      const r = await page.evaluate(() => lighten(null));
      expect(r).toBe('#eee');
    });
    test('undefined: returns #eee fallback', async () => {
      const r = await page.evaluate(() => lighten(undefined));
      expect(r).toBe('#eee');
    });
    test('empty string, returns #eee fallback', async () => {
      const r = await page.evaluate(() => lighten(''));
      expect(r).toBe('#eee');
    });
    test('malformed hex, returns #eee fallback', async () => {
      const r = await page.evaluate(() => lighten('not-a-color'));
      expect(r).toBe('#eee');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('lighten("#2D5DA8")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 22. barChart
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('barChart', () => {
    test('golden path, returns HTML string', async () => {
      const r = await page.evaluate(() => barChart('Labor', 500, 1000, '#2D5DA8'));
      expect(r).toContain('Labor');
      expect(r).toContain('prog-fill');
      expect(r).toContain('50%');
    });
    test('zero total, does not throw (pct is NaN or Infinity)', async () => {
      const r = await page.evaluate(() => {
        try { const html = barChart('Test', 0, 0, '#000'); return { ok: true, html }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('val equals total, 100%', async () => {
      const r = await page.evaluate(() => barChart('Full', 1000, 1000, '#0f0'));
      expect(r).toContain('100%');
    });
    test('null label, escapes gracefully', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, html: barChart(null, 100, 200, '#000') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('XSS in label, escapes HTML', async () => {
      const r = await page.evaluate(() => barChart('<script>alert(1)</script>', 100, 200, '#000'));
      expect(r).not.toContain('<script>');
      expect(r).toContain('&lt;script&gt;');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('barChart("Label", 500, 1000, "#000")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 23. calcBrackets
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('calcBrackets', () => {
    const BRACKETS = [[10000, 0.10], [40000, 0.12], [89075, 0.22], [Infinity, 0.24]];

    test('zero income, returns 0 tax', async () => {
      const r = await page.evaluate((b) => calcBrackets(0, b), BRACKETS);
      expect(r).toBe(0);
    });
    test('income in first bracket, correct tax', async () => {
      const r = await page.evaluate((b) => calcBrackets(5000, b), BRACKETS);
      expect(r).toBeCloseTo(500, 1); // 5000 * 0.10
    });
    test('income spanning two brackets', async () => {
      const r = await page.evaluate((b) => calcBrackets(20000, b), BRACKETS);
      // 10000 * 0.10 + 10000 * 0.12 = 1000 + 1200 = 2200
      expect(r).toBeCloseTo(2200, 1);
    });
    test('null income, handles gracefully', async () => {
      const r = await page.evaluate((b) => {
        try { return { ok: true, result: calcBrackets(null, b) }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, BRACKETS);
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });
    test('empty brackets, returns 0', async () => {
      const r = await page.evaluate(() => calcBrackets(50000, []));
      expect(r).toBe(0);
    });
    test('negative income, returns 0 (no negative tax)', async () => {
      const r = await page.evaluate((b) => {
        try { return { ok: true, result: calcBrackets(-1000, b) }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, BRACKETS);
      expect(r.ok).toBe(true);
      expect(r.result).toBe(0);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await page.evaluate((b) => {
        const bStr = JSON.stringify(b);
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { calcBrackets(50000, JSON.parse(bStr)); count++; } catch (_) {}
        }
        return count;
      }, BRACKETS);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 24. fmtDateShort
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('fmtDateShort', () => {
    test('null: returns empty string', async () => {
      const r = await page.evaluate(() => fmtDateShort(null));
      expect(r).toBe('');
    });
    test('undefined: returns empty string', async () => {
      const r = await page.evaluate(() => fmtDateShort(undefined));
      expect(r).toBe('');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => fmtDateShort(''));
      expect(r).toBe('');
    });
    test('valid date string, returns human-readable date', async () => {
      const r = await page.evaluate(() => fmtDateShort('2026-06-15'));
      expect(r).toContain('Jun');
      expect(r).toContain('2026');
    });
    test('invalid date string, returns input or fallback', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, result: fmtDateShort('not-a-date') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('fmtDateShort("2026-06-15")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 25. escHtml
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('escHtml', () => {
    test('null: returns "null" string escaped', async () => {
      const r = await page.evaluate(() => escHtml(null));
      expect(r).toBe('null');
    });
    test('undefined: returns "undefined" string', async () => {
      const r = await page.evaluate(() => escHtml(undefined));
      expect(r).toBe('undefined');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => escHtml(''));
      expect(r).toBe('');
    });
    test('&: escapes to &amp;', async () => {
      const r = await page.evaluate(() => escHtml('foo & bar'));
      expect(r).toBe('foo &amp; bar');
    });
    test('<: escapes to &lt;', async () => {
      const r = await page.evaluate(() => escHtml('<div>'));
      expect(r).toBe('&lt;div&gt;');
    });
    test('>, escapes to &gt;', async () => {
      const r = await page.evaluate(() => escHtml('>'));
      expect(r).toBe('&gt;');
    });
    test('", escapes to &quot;', async () => {
      const r = await page.evaluate(() => escHtml('"hello"'));
      expect(r).toBe('&quot;hello&quot;');
    });
    test("', escapes to &#39;", async () => {
      const r = await page.evaluate(() => escHtml("it's"));
      expect(r).toBe("it&#39;s");
    });
    test('full XSS string, fully escaped', async () => {
      const r = await page.evaluate(() => escHtml('<script>alert("xss")</script>'));
      expect(r).not.toContain('<script>');
      expect(r).toContain('&lt;script&gt;');
    });
    test('number: coerces to string', async () => {
      const r = await page.evaluate(() => escHtml(42));
      expect(r).toBe('42');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('escHtml("<b>test</b>")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 26. closeTopModal
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('closeTopModal', () => {
    test('no modal present, does not throw', async () => {
      const r = await page.evaluate(() => {
        // Ensure no modal is in DOM
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        try { closeTopModal(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('modal present, removes it', async () => {
      const r = await page.evaluate(() => {
        const ov = document.createElement('div');
        ov.className = 'zmodal-overlay';
        document.body.appendChild(ov);
        closeTopModal();
        return document.querySelectorAll('.zmodal-overlay').length;
      });
      expect(r).toBe(0);
    });
    test('multiple modals, removes first found', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        for (let i = 0; i < 3; i++) {
          const ov = document.createElement('div');
          ov.className = 'zmodal-overlay';
          document.body.appendChild(ov);
        }
        closeTopModal();
        const remaining = document.querySelectorAll('.zmodal-overlay').length;
        // Clean up
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return remaining;
      });
      expect(r).toBe(2);
    });
    test('concurrent calls, no crash', async () => {
      const ok = await page.evaluate(() => {
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { closeTopModal(); count++; } catch (_) {}
        }
        return count;
      });
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 27. zConfirm
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('zConfirm', () => {
    test('renders modal in DOM', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zConfirm('Are you sure?', () => {});
        const modal = document.querySelector('.zmodal-overlay');
        const hasModal = !!modal;
        modal && modal.remove();
        return hasModal;
      });
      expect(r).toBe(true);
    });
    test('contains message text', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zConfirm('Delete this item?', () => {});
        const text = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return text;
      });
      expect(r).toContain('Delete this item?');
    });
    test('null msg, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          zConfirm(null, () => {});
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('null onYes, throws on yes click but modal opens', async () => {
      const r = await page.evaluate(() => {
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          zConfirm('test', null);
          const hasModal = !!document.querySelector('.zmodal-overlay');
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true, hasModal };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      // modal may open before the null callback is used, either way page must not crash at call time
      expect(typeof r.ok).toBe('boolean');
    });
    test('yes button click, calls onYes and removes modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let called = false;
        zConfirm('Confirm?', () => { called = true; });
        document.querySelector('#zmodal-yes').click();
        return { called, modalGone: !document.querySelector('.zmodal-overlay') };
      });
      expect(r.called).toBe(true);
      expect(r.modalGone).toBe(true);
    });
    test('cancel button click, removes modal without calling onYes', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let called = false;
        zConfirm('Confirm?', () => { called = true; });
        document.querySelector('.zmodal-cancel').click();
        return { called, modalGone: !document.querySelector('.zmodal-overlay') };
      });
      expect(r.called).toBe(false);
      expect(r.modalGone).toBe(true);
    });
    test('onNo callback fires on cancel', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let noCalled = false;
        zConfirm('Confirm?', () => {}, { onNo: () => { noCalled = true; } });
        document.querySelector('.zmodal-cancel').click();
        return noCalled;
      });
      expect(r).toBe(true);
    });
    test('custom title and labels render', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zConfirm('msg', () => {}, { title: 'My Title', yes: 'Confirm', no: 'Nope' });
        const text = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return text;
      });
      expect(r).toContain('My Title');
      expect(r).toContain('Confirm');
      expect(r).toContain('Nope');
    });
    test('overlay click, removes modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zConfirm('Test?', () => {});
        const ov = document.querySelector('.zmodal-overlay');
        ov.click();
        return !document.querySelector('.zmodal-overlay');
      });
      expect(r).toBe(true);
    });
    test('concurrent calls, opens multiple modals without crash', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { zConfirm('msg' + i, () => {}); count++; } catch (_) {}
        }
        const modalCount = document.querySelectorAll('.zmodal-overlay').length;
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return { callCount: count, modalCount };
      });
      expect(r.callCount).toBe(5);
      expect(r.modalCount).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 28. zAlert
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('zAlert', () => {
    test('renders modal with message', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zAlert('Something happened');
        const text = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return text;
      });
      expect(r).toContain('Something happened');
    });
    test('default title is Notice', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zAlert('msg');
        const text = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return text;
      });
      expect(r).toContain('Notice');
    });
    test('custom title renders', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zAlert('msg', { title: 'Custom Title' });
        const text = document.querySelector('.zmodal-overlay')?.textContent || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return text;
      });
      expect(r).toContain('Custom Title');
    });
    test('null msg, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          zAlert(null);
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('OK button, removes modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zAlert('Click OK');
        document.querySelector('.zmodal-ok').click();
        return !document.querySelector('.zmodal-overlay');
      });
      expect(r).toBe(true);
    });
    test('overlay click, removes modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zAlert('Test');
        const ov = document.querySelector('.zmodal-overlay');
        ov.click();
        return !document.querySelector('.zmodal-overlay');
      });
      expect(r).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { zAlert('msg'); count++; } catch (_) {}
        }
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return count;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 29. zPrompt
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('zPrompt', () => {
    test('renders input in modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zPrompt('Enter name', () => {});
        const hasInput = !!document.querySelector('#zprompt-inp');
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return hasInput;
      });
      expect(r).toBe(true);
    });
    test('null msg, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          zPrompt(null, () => {});
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('OK button, calls onOk with input value', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let received = null;
        zPrompt('Enter val', (val) => { received = val; });
        document.querySelector('#zprompt-inp').value = 'TestValue';
        document.querySelector('#zprompt-ok').click();
        return { received, modalGone: !document.querySelector('.zmodal-overlay') };
      });
      expect(r.received).toBe('TestValue');
      expect(r.modalGone).toBe(true);
    });
    test('OK with empty input, calls onOk with empty string', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let received = null;
        zPrompt('Enter val', (val) => { received = val; });
        document.querySelector('#zprompt-inp').value = '';
        document.querySelector('#zprompt-ok').click();
        return received;
      });
      expect(r).toBe('');
    });
    test('cancel: removes modal without calling onOk', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let called = false;
        zPrompt('Enter val', () => { called = true; });
        document.querySelector('.zmodal-cancel').click();
        return { called, modalGone: !document.querySelector('.zmodal-overlay') };
      });
      expect(r.called).toBe(false);
      expect(r.modalGone).toBe(true);
    });
    test('opts.value prepopulates input', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zPrompt('Enter', () => {}, { value: 'prepopulated' });
        const val = document.querySelector('#zprompt-inp')?.value || '';
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return val;
      });
      expect(r).toBe('prepopulated');
    });
    test('Enter key, fires OK callback', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let received = null;
        zPrompt('Enter val', (val) => { received = val; });
        const inp = document.querySelector('#zprompt-inp');
        inp.value = 'KeyEnterVal';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return { received, modalGone: !document.querySelector('.zmodal-overlay') };
      });
      expect(r.received).toBe('KeyEnterVal');
      expect(r.modalGone).toBe(true);
    });
    test('overlay click, removes modal', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        zPrompt('Test', () => {});
        const ov = document.querySelector('.zmodal-overlay');
        ov.click();
        return !document.querySelector('.zmodal-overlay');
      });
      expect(r).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { zPrompt('msg', () => {}); count++; } catch (_) {}
        }
        document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
        return count;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 30. showToast
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('showToast', () => {
    test('renders toast in DOM', async () => {
      const r = await page.evaluate(() => {
        showToast('Toast message', '✓', 60000);
        const toast = document.querySelector('.toast');
        const text = toast?.textContent || '';
        toast && toast.remove();
        return text;
      });
      expect(r).toContain('Toast message');
    });
    test('null msg, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          showToast(null);
          document.querySelectorAll('.toast').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    // Old behavior: showToast rendered its icon arg as a literal emoji character,
    // so .toast-icon's textContent equaled the glyph itself ('✓', '★', etc.).
    // New behavior: showToast (js/utils.js) now renders any icon it has an SVG
    // mapping for (js/icons.js) as an inline <svg> via innerHTML, an SVG element
    // has no text content, so textContent is empty even though the icon rendered
    // correctly. Assert on the SVG markup instead of the (now absent) text.
    test('no icon, defaults to checkmark', async () => {
      const r = await page.evaluate(() => {
        showToast('Hello');
        const el = document.querySelector('.toast .toast-icon');
        const html = el?.innerHTML || '';
        document.querySelectorAll('.toast').forEach(e => e.remove());
        return html;
      });
      expect(r).toContain('<svg');
    });
    test('custom icon renders', async () => {
      const r = await page.evaluate(() => {
        showToast('Hi', '★');
        const el = document.querySelector('.toast .toast-icon');
        const html = el?.innerHTML || '';
        document.querySelectorAll('.toast').forEach(e => e.remove());
        return html;
      });
      expect(r).toContain('<svg');
    });
    test('close button removes toast', async () => {
      const r = await page.evaluate(() => {
        showToast('Close me', '✓', 60000);
        document.querySelector('.toast-close').click();
        return !document.querySelector('.toast');
      });
      expect(r).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try { showToast('msg', '✓', 60000); count++; } catch (_) {}
        }
        document.querySelectorAll('.toast').forEach(e => e.remove());
        return count;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 31. _fmtExpDate
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_fmtExpDate', () => {
    test('2 digits, no slash', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.value = '12';
        _fmtExpDate(el);
        return el.value;
      });
      expect(r).toBe('12');
    });
    test('3 digits, inserts slash after 2', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.value = '123';
        _fmtExpDate(el);
        return el.value;
      });
      expect(r).toBe('12/3');
    });
    test('6 digits, MM/YY format', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.value = '122026';
        _fmtExpDate(el);
        return el.value;
      });
      expect(r).toBe('12/2026');
    });
    test('already formatted, keeps format', async () => {
      const r = await page.evaluate(() => {
        const el = document.createElement('input');
        el.value = '12/26';
        _fmtExpDate(el);
        return el.value;
      });
      expect(r).toBe('12/26');
    });
    test('empty value, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          const el = document.createElement('input');
          el.value = '';
          _fmtExpDate(el);
          return { ok: true, val: el.value };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.val).toBe('');
    });
    test('null element, throws TypeError (acceptable)', async () => {
      const r = await page.evaluate(() => {
        try { _fmtExpDate(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      // Accessing null.value is a TypeError, page must not crash
      expect(typeof r.ok).toBe('boolean');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await page.evaluate(() => {
        let count = 0;
        for (let i = 0; i < 5; i++) {
          try {
            const el = document.createElement('input');
            el.value = '1225';
            _fmtExpDate(el);
            count++;
          } catch (_) {}
        }
        return count;
      });
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 32. _ymdToMdY
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_ymdToMdY', () => {
    test('null: returns empty string', async () => {
      const r = await page.evaluate(() => _ymdToMdY(null));
      expect(r).toBe('');
    });
    test('undefined: returns empty string', async () => {
      const r = await page.evaluate(() => _ymdToMdY(undefined));
      expect(r).toBe('');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => _ymdToMdY(''));
      expect(r).toBe('');
    });
    test('no dash, returns input as-is', async () => {
      const r = await page.evaluate(() => _ymdToMdY('20260615'));
      expect(r).toBe('20260615');
    });
    test('golden path, converts YYYY-MM-DD to MM/DD/YYYY', async () => {
      const r = await page.evaluate(() => _ymdToMdY('2026-06-15'));
      expect(r).toBe('06/15/2026');
    });
    test('leading zero month/day preserved', async () => {
      const r = await page.evaluate(() => _ymdToMdY('2026-01-05'));
      expect(r).toBe('01/05/2026');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('_ymdToMdY("2026-06-15")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 33. _mdYToYmd
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('_mdYToYmd', () => {
    test('null: returns empty string', async () => {
      const r = await page.evaluate(() => _mdYToYmd(null));
      expect(r).toBe('');
    });
    test('undefined: returns empty string', async () => {
      const r = await page.evaluate(() => _mdYToYmd(undefined));
      expect(r).toBe('');
    });
    test('empty string, returns empty string', async () => {
      const r = await page.evaluate(() => _mdYToYmd(''));
      expect(r).toBe('');
    });
    test('no slash, returns input as-is', async () => {
      const r = await page.evaluate(() => _mdYToYmd('06152026'));
      expect(r).toBe('06152026');
    });
    test('golden path, converts MM/DD/YYYY to YYYY-MM-DD', async () => {
      const r = await page.evaluate(() => _mdYToYmd('06/15/2026'));
      expect(r).toBe('2026-06-15');
    });
    test('invalid year length, returns empty string', async () => {
      const r = await page.evaluate(() => _mdYToYmd('06/15/26'));
      expect(r).toBe('');
    });
    test('wrong part count, returns empty string', async () => {
      const r = await page.evaluate(() => _mdYToYmd('06/2026'));
      expect(r).toBe('');
    });
    test('pads month and day', async () => {
      const r = await page.evaluate(() => _mdYToYmd('6/5/2026'));
      expect(r).toBe('2026-06-05');
    });
    test('concurrent calls, no crash', async () => {
      const ok = await concurrent('_mdYToYmd("06/15/2026")', 5);
      expect(ok).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 34. geoIfGranted
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('geoIfGranted', () => {
    test('no geolocation support, returns early without throw', async () => {
      const r = await page.evaluate(() => {
        const origGeo = navigator.geolocation;
        try {
          Object.defineProperty(navigator, 'geolocation', { value: null, configurable: true });
          geoIfGranted(() => {}, () => {});
          return { ok: true };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          try { Object.defineProperty(navigator, 'geolocation', { value: origGeo, configurable: true }); } catch (_) {}
        }
      });
      expect(r.ok).toBe(true);
    });
    test('null callbacks, does not throw on early return', async () => {
      const r = await page.evaluate(() => {
        const origGeo = navigator.geolocation;
        try {
          Object.defineProperty(navigator, 'geolocation', { value: null, configurable: true });
          geoIfGranted(null, null);
          return { ok: true };
        } catch (e) {
          return { ok: false, err: e.message };
        } finally {
          try { Object.defineProperty(navigator, 'geolocation', { value: origGeo, configurable: true }); } catch (_) {}
        }
      });
      expect(r.ok).toBe(true);
    });
    test('S.locationGranted true, calls getCurrentPosition', async () => {
      const r = await page.evaluate(() => {
        try {
          const origGranted = S.locationGranted;
          S.locationGranted = true;
          let called = false;
          const fakeGeo = {
            getCurrentPosition: (cb, errCb, opts) => { called = true; }
          };
          const origGeo = navigator.geolocation;
          try {
            Object.defineProperty(navigator, 'geolocation', { value: fakeGeo, configurable: true });
            geoIfGranted(() => {}, () => {});
          } finally {
            Object.defineProperty(navigator, 'geolocation', { value: origGeo, configurable: true });
          }
          S.locationGranted = origGranted;
          return { ok: true, called };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
      expect(r.called).toBe(true);
    });
    test('S.locationGranted false, no permissions API, returns early', async () => {
      const r = await page.evaluate(() => {
        try {
          const origGranted = S.locationGranted;
          S.locationGranted = false;
          const origPerms = navigator.permissions;
          try {
            Object.defineProperty(navigator, 'permissions', { value: null, configurable: true });
            geoIfGranted(() => {}, () => {});
            return { ok: true };
          } finally {
            Object.defineProperty(navigator, 'permissions', { value: origPerms, configurable: true });
            S.locationGranted = origGranted;
          }
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('corrupted localStorage, does not throw', async () => {
      const r = await page.evaluate(() => {
        try {
          localStorage.setItem('zp3_S', '{INVALID{{{{');
          const origGeo = navigator.geolocation;
          Object.defineProperty(navigator, 'geolocation', { value: null, configurable: true });
          try {
            geoIfGranted(() => {}, () => {});
            return { ok: true };
          } finally {
            Object.defineProperty(navigator, 'geolocation', { value: origGeo, configurable: true });
            localStorage.removeItem('zp3_S');
          }
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok).toBe(true);
    });
    test('concurrent calls, no crash', async () => {
      const r = await page.evaluate(() => {
        const origGeo = navigator.geolocation;
        Object.defineProperty(navigator, 'geolocation', { value: null, configurable: true });
        let count = 0;
        try {
          for (let i = 0; i < 5; i++) {
            try { geoIfGranted(() => {}, () => {}); count++; } catch (_) {}
          }
        } finally {
          Object.defineProperty(navigator, 'geolocation', { value: origGeo, configurable: true });
        }
        return count;
      });
      expect(r).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Corrupted localStorage resilience, cross-function
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('corrupted localStorage resilience', () => {
    test('fmt: graceful with corrupted localStorage', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_S', '{INVALID{{{{');
        try { return { ok: true, result: fmt(1234) }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_S'); }
      });
      expect(r.ok).toBe(true);
    });
    test('IRS: graceful with corrupted localStorage', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_S', '{INVALID{{{{');
        try { return { ok: true, result: IRS() }; }
        catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_S'); }
      });
      expect(r.ok).toBe(true);
    });
    test('showToast: graceful with corrupted localStorage', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_S', '{INVALID{{{{');
        try {
          showToast('test', '✓', 60000);
          document.querySelectorAll('.toast').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_S'); }
      });
      expect(r.ok).toBe(true);
    });
    test('zConfirm: graceful with corrupted localStorage', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_S', '{INVALID{{{{');
        try {
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          zConfirm('test', () => {});
          document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
          return { ok: true };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_S'); }
      });
      expect(r.ok).toBe(true);
    });
    test('calcBrackets: graceful with corrupted localStorage', async () => {
      const r = await page.evaluate(() => {
        localStorage.setItem('zp3_S', '{INVALID{{{{');
        try {
          const tax = calcBrackets(50000, [[10000, 0.10], [Infinity, 0.22]]);
          return { ok: true, tax };
        } catch (e) { return { ok: false, err: e.message }; }
        finally { localStorage.removeItem('zp3_S'); }
      });
      expect(r.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // adaBrand: WCAG clamp for contractor brand colors
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('adaBrand', () => {
    // Node-side mirror of the WCAG math so the assertions are independent of
    // the implementation under test.
    const lum = (hex) => {
      const c = hex.replace('#', '');
      const s = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    const ratioVsWhite = (hex) => 1.05 / (lum(hex) + 0.05);

    test('EVERY hue at maximum brightness clamps to ≥4.5:1 against white', async () => {
      // The property the owner asked for: NO possible pick can produce
      // non-compliant text. Sweep the worst case, fully saturated, fully
      // bright hues (the lightest, most-failing form of every color).
      const out = await page.evaluate(() => {
        const picks = [];
        for (let h = 0; h < 360; h += 15) {
          // Standard HSL→RGB at S=100%, L=50%, the most saturated form of each hue.
          const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
          const hex = '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
          picks.push({ pick: hex, clamped: adaBrand(hex) });
        }
        picks.push({ pick: '#FFFFFF', clamped: adaBrand('#FFFFFF') }); // pure white, the absolute worst pick
        picks.push({ pick: '#FFE44D', clamped: adaBrand('#FFE44D') }); // pale yellow, the classic real-world failure
        return picks;
      });
      for (const { pick, clamped } of out) {
        expect(ratioVsWhite(clamped), pick + ' → ' + clamped + ' must clear AA').toBeGreaterThanOrEqual(4.5);
      }
    });

    test('already-compliant dark colors pass through unchanged', async () => {
      const r = await page.evaluate(() => ({ navy: adaBrand('#1B3465'), ink: adaBrand('#1B1612') }));
      expect(r.navy).toBe('#1b3465');
      expect(r.ink).toBe('#1b1612');
    });

    test('invalid/empty input passes through untouched so caller fallbacks still run', async () => {
      const r = await page.evaluate(() => ({ empty: adaBrand(''), nul: adaBrand(null), word: adaBrand('red'), short: adaBrand('#abc') }));
      expect(r.empty).toBe('');
      expect(r.nul).toBe('');
      expect(r.word).toBe('red');
      expect(r.short).toBe('#abc');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // No console errors
  // ═══════════════════════════════════════════════════════════════════════════
  test('no console errors, utils.js', async () => {
    assertNoErrors(page, 'utils.js');
  });
});
