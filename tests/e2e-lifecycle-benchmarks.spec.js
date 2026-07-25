// @ts-check
/**
 * Coverage for js/lifecycle.js reporting: the Books Summary card that pairs a
 * contractor's own pipeline numbers with the TradeDesk-wide average.
 *
 * The privacy design is the thing worth guarding here. A contractor's own
 * numbers come from an RPC that row-level security pins to their rows. The
 * platform averages come from pre-aggregated rows that the server refuses to
 * hand over unless at least five separate businesses stand behind them. The app
 * never runs a cross-account query, so these tests assert that the card degrades
 * to "no TradeDesk average yet" rather than inventing or leaking a number.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('lifecycle.js: your numbers vs TradeDesk', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  // ── Books opens on Summary ────────────────────────────────────────────────
  test.describe('Books lands on Summary', () => {
    test('Summary is the default tab, and it is the first button', async () => {
      const r = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.fbar .fb'))
          .filter(b => (b.id || '').startsWith('tr-t-'));
        return {
          defaultTab: typeof trackerTab !== 'undefined' ? trackerTab : null,
          firstBtnId: btns.length ? btns[0].id : null,
          summaryActive: !!document.getElementById('tr-t-summary')?.classList.contains('active'),
          incomeActive: !!document.getElementById('tr-t-income')?.classList.contains('active'),
        };
      });
      expect(r.defaultTab).toBe('summary');
      expect(r.firstBtnId).toBe('tr-t-summary');
      expect(r.summaryActive).toBe(true);
      expect(r.incomeActive).toBe(false);
    });

    test('the Summary panel is the visible one before any tap', async () => {
      const r = await page.evaluate(() => ({
        summary: document.getElementById('tr-summary')?.getAttribute('style') || '',
        income: document.getElementById('tr-income')?.getAttribute('style') || '',
      }));
      expect(r.summary).not.toContain('display:none');
      expect(r.income).toContain('display:none');
    });

    test('switching tabs still works both ways', async () => {
      const r = await page.evaluate(() => {
        setTrTab('income', document.getElementById('tr-t-income'));
        const afterIncome = document.getElementById('tr-summary').style.display;
        setTrTab('summary', document.getElementById('tr-t-summary'));
        const afterSummary = document.getElementById('tr-summary').style.display;
        return { afterIncome, afterSummary };
      });
      expect(r.afterIncome).toBe('none');
      expect(r.afterSummary).toBe('block');
    });
  });

  // ── The owner-only card is gone, not hidden (§7.1) ────────────────────────
  test.describe('the separate All-accounts card was removed', () => {
    test('neither the card nor its mount exists in the DOM', async () => {
      expect(await page.locator('#lc-funnel-all-card').count()).toBe(0);
      expect(await page.locator('#lc-funnel-all').count()).toBe(0);
    });

    test('renderLifecycleFunnel no longer takes a scope argument', async () => {
      // One audience now. A second argument would mean the cross-account path
      // came back into the client, which is exactly what this PR removed.
      const len = await page.evaluate(() =>
        typeof renderLifecycleFunnel === 'function' ? renderLifecycleFunnel.length : -1);
      expect(len).toBe(1);
    });
  });

  // ── Duration formatting ───────────────────────────────────────────────────
  test.describe('the old single-value formatter is gone', () => {
    test('_lcDur no longer exists', async () => {
      // It was replaced by the unit-matched pair (_lcUnitFor + _lcDurIn). Leaving
      // it defined would let a future row format one side independently and
      // reintroduce "33 hr vs 2 days" on the same line.
      const t = await page.evaluate(() => typeof _lcDur);
      expect(t).toBe('undefined');
    });
  });

  test.describe('_lcUnitFor', () => {
    const cases = [
      [[0.5, 0.4], 'min'], [[0.9, 0.2], 'min'],
      [[1, 2], 'hr'], [[47, 3], 'hr'], [[0.5, 6], 'hr'],
      [[48, 3], 'day'], [[10, 200], 'day'],
      // The unit follows the LARGER value so the smaller never rounds to zero.
      [[0.1, 100], 'day'],
    ];
    for (const [input, expected] of cases) {
      test(`${JSON.stringify(input)} picks ${expected}`, async () => {
        const got = await page.evaluate(v => _lcUnitFor(v[0], v[1]), input);
        expect(got).toBe(expected);
      });
    }
    test('nothing usable falls back to hours rather than throwing', async () => {
      const r = await page.evaluate(() => [
        _lcUnitFor(), _lcUnitFor(NaN), _lcUnitFor(0, -1), _lcUnitFor(null, undefined),
      ]);
      r.forEach(v => expect(v).toBe('hr'));
    });
  });

  test.describe('_lcDurIn', () => {
    const cases = [
      [[null, 'hr'], '-'], [[0, 'hr'], '-'], [[-5, 'day'], '-'], [['nonsense', 'hr'], '-'],
      [[0.5, 'min'], '30 min'], [[0.005, 'min'], '1 min'],
      [[1, 'hr'], '1 hr'], [[9.94, 'hr'], '9.9 hr'], [[12, 'hr'], '12 hr'],
      [[48, 'day'], '2 days'], [[240, 'day'], '10 days'], [[30, 'day'], '1.3 days'],
    ];
    for (const [input, expected] of cases) {
      test(`${JSON.stringify(input)} reads as "${expected}"`, async () => {
        const got = await page.evaluate(v => _lcDurIn(v[0], v[1]), input);
        expect(got).toBe(expected);
      });
    }
    test('both sides of a row always carry the same unit word', async () => {
      const r = await page.evaluate(() => {
        const u = _lcUnitFor(33, 52);          // 33 hr vs 52 hr → days
        return [_lcDurIn(33, u), _lcDurIn(52, u)];
      });
      expect(r[0]).toContain('days');
      expect(r[1]).toContain('days');
    });
  });

  // ── Sample size in plain words ────────────────────────────────────────────
  test.describe('_lcSample', () => {
    test('never shows a bare "n"', async () => {
      const r = await page.evaluate(() => [_lcSample(0), _lcSample(1), _lcSample(12), _lcSample(null)]);
      expect(r[0]).toBe('0 so far');
      expect(r[1]).toBe('1 so far');
      expect(r[2]).toBe('12 so far');
      expect(r[3]).toBe('0 so far');
      r.forEach(s => expect(s).not.toMatch(/\bn\s*=/));
    });
  });

  // ── Position encoding: the rail replaces the arithmetic ──────────────────
  test.describe('_lcOffset', () => {
    test('right of centre always means better, for BOTH kinds of metric', async () => {
      const r = await page.evaluate(() => ({
        // A duration: lower is better, so being faster must push the marker right.
        fastDuration: _lcOffset(5, 10, true),
        slowDuration: _lcOffset(20, 10, true),
        // A rate: higher is better, so a bigger rate must ALSO push it right.
        highRate: _lcOffset(60, 40, false),
        lowRate: _lcOffset(20, 40, false),
      }));
      expect(r.fastDuration).toBeGreaterThan(0);
      expect(r.slowDuration).toBeLessThan(0);
      expect(r.highRate).toBeGreaterThan(0);
      expect(r.lowRate).toBeLessThan(0);
    });

    test('an outlier is clamped so it cannot push the marker off the rail', async () => {
      // One lead that sat for six months would otherwise blow out the scale and
      // make every other row on the card unreadable.
      const r = await page.evaluate(() => [_lcOffset(10000, 10, true), _lcOffset(1, 10000, false)]);
      expect(r[0]).toBe(-1);                  // hits the clamp exactly
      expect(r[1]).toBeLessThan(-0.99);       // approaches it without a divide-by-zero
      r.forEach(v => { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); });
    });

    test('missing or zero inputs yield no marker at all', async () => {
      const r = await page.evaluate(() => [
        _lcOffset(5, NaN, true), _lcOffset(5, 0, true), _lcOffset(0, 10, true),
        _lcOffset(null, 10, true), _lcOffset(5, undefined, false),
      ]);
      r.forEach(v => expect(v).toBeNull());
    });
  });

  test.describe('_lcVerdict', () => {
    test('a duration says faster or slower; a rate says better or worse', async () => {
      const r = await page.evaluate(() => ({
        dur: _lcVerdict(_lcOffset(5, 10, true), true),
        rate: _lcVerdict(_lcOffset(60, 40, false), false),
      }));
      expect(r.dur).toBe('50% faster');
      expect(r.rate).toBe('50% better');
    });
    test('within 5% reads as about average, not a false win', async () => {
      const r = await page.evaluate(() => _lcVerdict(_lcOffset(102, 100, false), false));
      expect(r).toBe('about average');
    });
    test('no offset means no words, so nothing is implied', async () => {
      const r = await page.evaluate(() => _lcVerdict(null, true));
      expect(r).toBe('');
    });
    test('the meaning survives without colour: every verdict carries a word', async () => {
      // Green and amber sit at deltaE 7.5 under deuteranopia, below the safe
      // separation floor, so colour can never be the only carrier.
      const r = await page.evaluate(() => [
        _lcVerdict(0.5, true), _lcVerdict(-0.5, true), _lcVerdict(0.01, true),
      ]);
      expect(r[0]).toContain('faster');
      expect(r[1]).toContain('slower');
      expect(r[2]).toBe('about average');
    });
  });

  test.describe('the old text-only comparison helper is gone', () => {
    test('_lcCompare no longer exists', async () => {
      // Replaced by _lcOffset (position) + _lcVerdict (words). Leaving it would
      // let a row go back to colour-and-percentage with no positional encoding.
      const t = await page.evaluate(() => typeof _lcCompare);
      expect(t).toBe('undefined');
    });
  });

  // ── Stage keying ──────────────────────────────────────────────────────────
  test.describe('_lcStageKey', () => {
    test('keys on the event pair, never the display label', async () => {
      const r = await page.evaluate(() =>
        _lcStageKey({ stage: 'Anything At All', from_event: 'proposal_sent', to_event: 'signed' }));
      expect(r).toBe('proposal_sent>signed');
    });
    test('a row missing its events still produces a string, not a throw', async () => {
      const r = await page.evaluate(() => { try { return _lcStageKey({}); } catch (e) { return 'THREW'; } });
      expect(r).toBe('>');
    });
    test('every ordered stage has a plain-English label', async () => {
      const missing = await page.evaluate(() =>
        LC_STAGE_ORDER.filter(k => !LC_STAGE_LABEL[k]));
      expect(missing).toEqual([]);
    });
  });

  // ── Close rate by lead source ─────────────────────────────────────────────
  test.describe('_lcCloseRateBySource', () => {
    test.beforeAll(async () => {
      await page.evaluate(() => {
        clients = clients.filter(c => c.id < 991000 || c.id > 991999);
        bids = bids.filter(b => b.id < 992000 || b.id > 992999);
        clients.push(
          { id: 991001, name: 'Ref One', source: 'Referral' },
          { id: 991002, name: 'Ref Two', source: 'Referral' },
          { id: 991003, name: 'Ref Three', source: 'Referral' },
          { id: 991004, name: 'Goog One', source: 'Google / online' },
          { id: 991005, name: 'No Source Set' },
        );
        bids.push(
          { id: 992001, client_id: 991001, status: 'Closed Won', amount: 1000 },
          { id: 992002, client_id: 991002, status: 'Closed Lost', amount: 1000 },
          // 991003 still pending: it must count in the denominator.
          { id: 992003, client_id: 991003, status: 'Sent', amount: 1000 },
          { id: 992004, client_id: 991004, status: 'Closed Won', amount: 1000 },
        );
      });
    });

    test('rate is wins over TOTAL leads, so a pending lead still counts against it', async () => {
      const r = await page.evaluate(() => _lcCloseRateBySource().find(x => x.src === 'Referral'));
      expect(r.leads).toBe(3);
      expect(r.won).toBe(1);
      // 1 of 3, not 1 of 2. Counting only decided leads would say 50%.
      expect(Math.round(r.rate)).toBe(33);
    });

    test('a lead with no source is left out rather than bucketed as blank', async () => {
      const r = await page.evaluate(() => _lcCloseRateBySource().map(x => x.src));
      expect(r).toContain('Referral');
      expect(r).toContain('Google / online');
      expect(r).not.toContain('');
    });

    test('sources come back busiest first', async () => {
      const r = await page.evaluate(() => _lcCloseRateBySource().map(x => x.leads));
      for (let i = 1; i < r.length; i++) expect(r[i - 1]).toBeGreaterThanOrEqual(r[i]);
    });

    test('no clients at all does not throw', async () => {
      const ok = await page.evaluate(() => {
        const save = clients; clients = [];
        try { _lcCloseRateBySource(); return true; } catch (e) { return false; } finally { clients = save; }
      });
      expect(ok).toBe(true);
    });
  });

  // ── Trade comes from the picker that already exists ───────────────────────
  test.describe('_lcMyTrade', () => {
    test('reads the same field the onboarding and Settings trade pickers write', async () => {
      const r = await page.evaluate(() => {
        const save = window._config;
        try {
          window._config = { business_type: 'HVAC' };
          const a = _lcMyTrade();
          window._config = { business_type: 'painting', trade_lines: 'painting,roofing' };
          const b = _lcMyTrade();
          return { a, b };
        } finally { window._config = save; }
      });
      expect(r.a).toBe('hvac');            // normalized, so it matches the benchmark scope key
      // A multi-trade account groups on its PRIMARY trade, which is what
      // business_type already holds; trade_lines must not override it.
      expect(r.b).toBe('painting');
    });

    test('an account with no trade set yields empty, never a guess', async () => {
      const r = await page.evaluate(() => {
        const save = window._config;
        try {
          window._config = {};
          const a = _lcMyTrade();
          window._config = null;
          const b = _lcMyTrade();
          return [a, b];
        } finally { window._config = save; }
      });
      expect(r).toEqual(['', '']);
    });

    test('no invented field: setting S.businessType alone does not fake a trade', async () => {
      // The first cut of this read S.businessType, which the app never writes.
      // Guarding it stops the lookup drifting off the real picker again.
      const r = await page.evaluate(() => {
        const saveC = window._config, saveS = S.businessType;
        try { window._config = {}; S.businessType = 'plumbing'; return _lcMyTrade(); }
        finally { window._config = saveC; S.businessType = saveS; }
      });
      expect(r).toBe('');
    });
  });

  test.describe('_lcTradeLabel', () => {
    test('uses the app-wide trade labels, not a second copy', async () => {
      const r = await page.evaluate(() => [
        _lcTradeLabel('painting'), _lcTradeLabel('hvac'), _lcTradeLabel('landscaping'),
      ]);
      expect(r).toEqual(['Painting', 'HVAC', 'Landscaping']);
    });
    test('an unknown or empty trade degrades instead of printing undefined', async () => {
      const r = await page.evaluate(() => [_lcTradeLabel('welding'), _lcTradeLabel('')]);
      expect(r).toEqual(['Welding', '']);
    });
  });

  // ── Rendering ─────────────────────────────────────────────────────────────
  test.describe('renderLifecycleFunnel', () => {
    const MINE = [
      { stage: 'Sent to signed', from_event: 'proposal_sent', to_event: 'signed', samples: 4, median_hours: 10, avg_hours: 30 },
      { stage: 'Lead to proposal', from_event: 'lead_created', to_event: 'proposal_saved', samples: 6, median_hours: 2, avg_hours: 5 },
    ];

    // Stand in for Supabase so the card can be driven without a backend. Defined
    // with page.evaluate rather than addInitScript on purpose: a boot helper that
    // also sets _supa would overwrite an init script and silently undo this.
    test.beforeAll(async () => {
      await page.evaluate(() => {
        window.__install = (mine, benchRows) => {
          window.__lcMine = mine; window.__lcBench = benchRows;
          window.__supaSave = window._supa;
          window._supa = {
            rpc: async () => ({ data: window.__lcMine, error: null }),
            from: () => ({
              select: () => ({ order: () => ({ limit: async () => ({ data: window.__lcBench, error: null }) }) }),
            }),
          };
        };
      });
    });

    test.afterEach(async () => {
      await page.evaluate(() => { if (window.__supaSave !== undefined) window._supa = window.__supaSave; });
    });

    test('stages render in pipeline order, not alphabetically', async () => {
      const r = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        window._lcSecOpen_speed = true;       // the step detail is collapsed by default
        await renderLifecycleFunnel('lc-funnel-mine');
        const html = document.getElementById('lc-funnel-mine').innerHTML;
        return {
          leadIdx: html.indexOf('Lead comes in, proposal written'),
          sentIdx: html.indexOf('Sent, signed'),
        };
      }, MINE);
      // "Lead comes in" precedes "Sent, signed" in the pipeline; alphabetically
      // the RPC returns "Lead to proposal" before "Sent to signed" too, so this
      // asserts the label mapping is applied, and the order survives it.
      expect(r.leadIdx).toBeGreaterThan(-1);
      expect(r.sentIdx).toBeGreaterThan(r.leadIdx);
    });

    test('with no benchmark rows the card says so instead of showing a hole', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        window._lcSecOpen_speed = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('No TradeDesk average yet');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('undefined');
    });

    test('a published benchmark appears beside the contractor number with a verdict', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 40, median: 20, avg: 30, value: null, day: '2026-07-24' },
        ]);
        window._lcSecOpen_speed = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('TradeDesk');
      // Their 10 hr against a platform 20 hr is twice as fast. A duration says
      // "faster", not "better", because that is how a contractor says it.
      expect(html).toContain('50% faster');
    });

    test('the newest day wins when several days are present', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 40, median: 20, avg: 30, value: null, day: '2026-07-24' },
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 9, median: 500, avg: 500, value: null, day: '2026-01-01' },
        ]);
        window._lcSecOpen_speed = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('50% faster');   // the 20 hr row, not the stale 500 hr one
      expect(html).not.toContain('21 days');
    });

    test('close rate by lead source renders with its own benchmark', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_close_rate_source', scope: 'source:Referral', n: 30, median: null, avg: null, value: 50, day: '2026-07-24' },
        ]);
        window._lcSecOpen_src = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('Where your work comes from');
      expect(html).toContain('Referral');
      // The sample count survives ALONGSIDE the verdict. "33% worse" drawn from
      // three leads must never read as a settled fact about the business.
      expect(html).toContain('33% worse');
      expect(html).toContain('1 of 3 leads');
    });

    test('the privacy floor is stated on the card', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('five separate businesses');
    });

    test('an RPC failure degrades to a message, never a broken card', async () => {
      const html = await page.evaluate(async () => {
        window.__supaSave = window._supa;
        window._supa = { rpc: async () => ({ data: null, error: { message: 'nope' } }),
                         from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      });
      expect(html).toContain('unavailable');
    });

    test('a missing mount element is a no-op, not a throw', async () => {
      const ok = await page.evaluate(async () => {
        try { await renderLifecycleFunnel('no-such-mount-id'); return true; } catch (e) { return false; }
      });
      expect(ok).toBe(true);
    });

    test('five concurrent renders do not crash the page', async () => {
      const ok = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        try {
          await Promise.all([0, 1, 2, 3, 4].map(() => renderLifecycleFunnel('lc-funnel-mine')));
          return true;
        } catch (e) { return false; }
      }, MINE);
      expect(ok).toBe(true);
    });
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'lifecycle benchmarks');
  });
});
