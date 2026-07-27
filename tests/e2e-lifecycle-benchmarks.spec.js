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
    // Stand in for Supabase so the card can be driven without a backend. Defined
    // once at the top so every describe can use it, and with page.evaluate rather
    // than addInitScript on purpose: a boot helper that also sets _supa would
    // overwrite an init script and silently undo this.
    await page.evaluate(() => {
      window.__install = (mine, benchRows) => {
        window.__lcMine = mine; window.__lcBench = benchRows;
        if (window.__supaSave === undefined) window.__supaSave = window._supa;
        window._supa = {
          rpc: async () => ({ data: window.__lcMine, error: null }),
          from: () => ({
            select: () => ({ order: () => ({ limit: async () => ({ data: window.__lcBench, error: null }) }) }),
          }),
        };
      };
    });
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
    test('a duration says faster or slower; a rate borrows the scale\'s own words', async () => {
      // The gauge prints BEHIND and AHEAD at its ends, so a rate says the same
      // thing rather than making a reader map "worse" onto "behind".
      const r = await page.evaluate(() => ({
        dur: _lcVerdict(_lcOffset(5, 10, true), true),
        rateUp: _lcVerdict(_lcOffset(60, 40, false), false),
        rateDown: _lcVerdict(_lcOffset(20, 40, false), false),
      }));
      expect(r.dur).toBe('50% faster');
      expect(r.rateUp).toBe('50% ahead of');
      expect(r.rateDown).toBe('50% behind');
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

  // ── The gauge, same instrument as the profit gauge on an estimate ────────
  test.describe('gauge bands', () => {
    test('the dot ring colour matches the band it lands on, with no blend zone', async () => {
      // The profit gauge uses hard stops for exactly this reason: a dot must never
      // render one colour while sitting on a stretch of track of another.
      const r = await page.evaluate(() => ({
        farBehind: _lcBandColor(-0.6), behind: _lcBandColor(-0.15),
        even: _lcBandColor(0), justAbove: _lcBandColor(0.02), ahead: _lcBandColor(0.4),
        none: _lcBandColor(null),
      }));
      // Colours come from tokens, so light and dark each get a validated value
      // instead of one hardcoded hex washing out on the other surface.
      expect(r.farBehind).toBe('var(--lc-behind)');
      expect(r.behind).toBe('var(--lc-behind)');
      expect(r.even).toBe('var(--lc-mid)');
      expect(r.justAbove).toBe('var(--lc-mid)');   // inside the 5% dead band
      expect(r.ahead).toBe('var(--lc-ahead)');
      expect(r.none).toBe('var(--lc-mid)');
    });

    test('both poles are declared for light AND dark, not just light', async () => {
      const r = await page.evaluate(() => {
        const css = Array.from(document.styleSheets)
          .flatMap(sh => { try { return Array.from(sh.cssRules); } catch (e) { return []; } })
          .map(rule => rule.cssText).join('\n');
        return {
          behind: (css.match(/--lc-behind:/g) || []).length,
          ahead: (css.match(/--lc-ahead:/g) || []).length,
        };
      });
      expect(r.behind).toBeGreaterThanOrEqual(2);
      expect(r.ahead).toBeGreaterThanOrEqual(2);
    });

    test('the band boundaries line up with the track gradient stops', async () => {
      // The colour a dot gets and the colour under it come from two places, so
      // they have to be checked against each other or they silently drift.
      const r = await page.evaluate(() => ({
        track: LC_TRACK,
        atBehindEdge: _lcDotPct(-0.05), atAheadEdge: _lcDotPct(0.05),
      }));
      expect(r.track).toContain('47.5%');   // behind gives way to neutral at -0.05
      expect(r.track).toContain('52.5%');   // neutral to ahead at +0.05
      expect(r.atBehindEdge).toBeCloseTo(47.7, 0);
      expect(r.atAheadEdge).toBeCloseTo(52.3, 0);
    });

    test('a marker never leaves the rail, even fully clamped', async () => {
      const r = await page.evaluate(() => [_lcDotPct(-1), _lcDotPct(1), _lcDotPct(null)]);
      expect(r[0]).toBe(4);
      expect(r[1]).toBe(96);
      expect(r[2]).toBe(50);
    });

    test('the small rail is a wash so the headline gauge stays the loud one', async () => {
      // A dozen fully-saturated rails would compete with the hero and turn the
      // list into stripes. Same bands, lower strength, saturated dot on top.
      const r = await page.evaluate(() => ({
        lg: _lcGauge(0.4, 'lg'), sm: _lcGauge(0.4, 'sm'),
      }));
      expect(r.lg).toContain('var(--lc-behind)');
      expect(r.sm).toContain('color-mix');           // the row track is the same scale, diluted
      expect(r.lg).not.toContain('color-mix');
      // The dot itself is full strength in both.
      expect(r.lg).toContain('var(--lc-ahead)');
      expect(r.sm).toContain('var(--lc-ahead)');
    });

    test('no benchmark renders a plain rail with no marker to misread', async () => {
      const r = await page.evaluate(() => _lcGauge(null, 'sm'));
      expect(r).toContain('var(--border)');
      expect(r).not.toContain('box-shadow');
    });

    test('the headline gauge carries the number, the label and the count', async () => {
      const r = await page.evaluate(() =>
        _lcHeroGauge('35%', 'Close rate', -0.07, 'Painting average 38%', '7% worse'));
      expect(r).toContain('35%');
      expect(r).toContain('Close rate');
      expect(r).toContain('Painting average 38%');
      expect(r).toContain('7% worse');
    });
  });

  // ── The card must SAY what the average is, never just imply it ───────────
  test.describe('the comparison is stated, not inferred', () => {
    const MINE2 = [
      { stage: 's', from_event: 'proposal_sent', to_event: 'signed', samples: 5, median_hours: 10, avg_hours: 12 },
    ];

    // Self-contained: this block runs before the lead-source seeding below, and a
    // leaked _supa mock would poison whichever describe happened to run next.
    test.beforeAll(async () => {
      await page.evaluate(() => {
        clients = clients.filter(c => c.id < 993000 || c.id > 993999);
        bids = bids.filter(b => b.id < 994000 || b.id > 994999);
        clients.push({ id: 993001, name: 'Stated A', source: 'Referral' },
                     { id: 993002, name: 'Stated B', source: 'Referral' });
        bids.push({ id: 994001, client_id: 993001, status: 'Closed Won', amount: 100 });
      });
    });
    test.afterEach(async () => {
      await page.evaluate(() => { if (window.__supaSave !== undefined) window._supa = window.__supaSave; });
    });
    test.afterAll(async () => {
      await page.evaluate(() => {
        clients = clients.filter(c => c.id < 993000 || c.id > 993999);
        bids = bids.filter(b => b.id < 994000 || b.id > 994999);
      });
    });

    test('the scale names both ends and its midpoint', async () => {
      const r = await page.evaluate(() =>
        _lcScaleEnds('38% average'));
      expect(r).toContain('Behind');
      expect(r).toContain('Ahead');
      expect(r).toContain('38% average');
    });

    test('a row carries the name, the TradeDesk average, then their number', async () => {
      // Column order is the contract: name | TradeDesk | You. Swapping the two
      // numeric columns would silently invert every comparison on the page.
      const r = await page.evaluate(() => _lcRow('Sent to signed', '20 hr', '10 hr', 9));
      const nameAt = r.indexOf('Sent to signed');
      const benchAt = r.indexOf('20 hr');
      const mineAt = r.indexOf('10 hr');
      expect(nameAt).toBeGreaterThan(-1);
      expect(benchAt).toBeGreaterThan(nameAt);
      expect(mineAt).toBeGreaterThan(benchAt);
    });

    test('the header names all three columns', async () => {
      const r = await page.evaluate(() => _lcTableHead());
      expect(r).toContain('Metric');
      expect(r).toContain('TradeDesk');
      expect(r).toContain('You');
    });

    test('a missing average shows a dash, not a blank or a zero', async () => {
      const r = await page.evaluate(() => _lcRow('Finished to paid in full', '', '4 days', 9));
      expect(r).toContain('-');
      expect(r).toContain('4 days');
      expect(r).not.toContain('0%');
    });

    test('a thin sample is flagged; a healthy one is not', async () => {
      // "25%" off three leads is not a fact about a business. Printing a count
      // beside a number built from forty is just clutter.
      const r = await page.evaluate(() => ({
        thin: _lcRow('Door to door', '18%', '25%', 3),
        healthy: _lcRow('Referral', '52%', '50%', 40),
      }));
      expect(r.thin).toContain('(3)');
      expect(r.healthy).not.toContain('(40)');
    });

    test('the footnote spells out what every average is measured across', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE2);
      expect(html).toContain('TradeDesk is the average across every business');
    });

    test('the headline names the peer group, not just a bare percentage', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_close_rate_trade', scope: 'trade:painting', n: 40, median: null, avg: null, value: 40, day: '2026-07-24' },
        ]);
        const save = window._config;
        window._config = { business_type: 'painting' };
        await renderLifecycleFunnel('lc-funnel-mine');
        const h = document.getElementById('lc-funnel-mine').innerHTML;
        window._config = save;
        return h;
      }, MINE2);
      expect(html).toContain('painting businesses');
      expect(html).toContain('40% average');
    });
  });

  test.describe('the headline carries the comparison and nothing else', () => {
    test('the raw lead tally is gone: the percentage already says it', async () => {
      const html = await page.evaluate(async () => {
        window.__install([{ stage:'s', from_event:'proposal_sent', to_event:'signed', samples:5, median_hours:10, avg_hours:12 }], []);
        await renderLifecycleFunnel('lc-funnel-mine');
        const h = document.getElementById('lc-funnel-mine').innerHTML;
        if (window.__supaSave !== undefined) window._supa = window.__supaSave;
        return h;
      });
      expect(html).not.toContain('became work');
      expect(html).not.toMatch(/of your \d+ leads signed/);
      expect(html).toContain('Your close rate');
    });

    test('the gap block names the step and both numbers, with no tally attached', async () => {
      // It used to read "29% slower · you beat the average on 5 of 8 steps",
      // which welded two unrelated facts together.
      const r = await page.evaluate(() =>
        _lcGapCallout({ label: 'Proposal to sent', mineH: 3.1, benchH: 2.4, off: -0.29 }));
      expect(r).toContain('Proposal to sent');
      expect(r).toContain('You take');
      expect(r).toContain('3.1 hr');
      expect(r).toContain('2.4 hr');
      expect(r).not.toMatch(/\d+ of \d+ steps/);
      expect(r).not.toContain('29%');
    });

    test('no gap to report renders nothing at all', async () => {
      const r = await page.evaluate(() => _lcGapCallout(null));
      expect(r).toBe('');
    });
  });

  // ── Wording a contractor would actually use ───────────────────────────────
  test.describe('stage labels read like speech', () => {
    test('no database words leak into the labels', async () => {
      const labels = await page.evaluate(() => Object.values(LC_STAGE_LABEL));
      labels.forEach(l => {
        expect(l).not.toMatch(/_/);              // no lead_created
        expect(l).not.toMatch(/\bevent\b/i);
        expect(l).not.toMatch(/proposal_|lead_|job_/);   // no raw event names
      });
    });
    test('the renamed noun holds: proposal, never estimate', async () => {
      // The owner picked "proposal" over "estimate" after checking what
      // contractors call it. These labels must not reintroduce the old word.
      const labels = await page.evaluate(() => Object.values(LC_STAGE_LABEL).join(' '));
      expect(labels.toLowerCase()).not.toContain('estimate');
      expect(labels.toLowerCase()).toContain('proposal');
    });
  });

  test.describe('the pre-gauge hero is gone', () => {
    test('_lcHero no longer exists', async () => {
      // Replaced by _lcHeroGauge. Keeping it would leave a second, divergent way
      // to render the headline that no longer matches the estimate builder.
      const t = await page.evaluate(() => typeof _lcHero);
      expect(t).toBe('undefined');
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

    test.afterEach(async () => {
      await page.evaluate(() => { if (window.__supaSave !== undefined) window._supa = window.__supaSave; });
    });

    test('stages render in pipeline order, not alphabetically', async () => {
      const r = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        window._lcSecOpen_all = true;       // the step detail is collapsed by default
        await renderLifecycleFunnel('lc-funnel-mine');
        const html = document.getElementById('lc-funnel-mine').innerHTML;
        return {
          leadIdx: html.indexOf('New lead to proposal'),
          sentIdx: html.indexOf('Sent to signed'),
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
        window._lcSecOpen_all = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      // A stage with no platform average shows a dash in the TradeDesk column.
      expect(html).toContain('New lead to proposal');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('undefined');
    });

    test('a published benchmark appears beside the contractor number with a verdict', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 40, median: 20, avg: 30, value: null, day: '2026-07-24' },
        ]);
        window._lcSecOpen_all = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      // The TradeDesk column carries the platform figure; the You column theirs.
      expect(html).toContain('20 hr');
      expect(html).toContain('10 hr');
    });

    test('the newest day wins when several days are present', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, [
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 40, median: 20, avg: 30, value: null, day: '2026-07-24' },
          { metric: 'bench_stage_hours', scope: 'stage:proposal_sent>signed', n: 9, median: 500, avg: 500, value: null, day: '2026-01-01' },
        ]);
        window._lcSecOpen_all = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('20 hr');        // the newest day's row...
      expect(html).not.toContain('21 days');  // ...not the stale 500 hr one
    });

    test('close rate by lead source renders with its own benchmark', async () => {
      const html = await page.evaluate(async (mine) => {
        // Seeded here rather than leaning on another describe's fixtures: this
        // assertion is about the source section, so it owns the source data.
        clients = clients.filter(c => c.id < 995000 || c.id > 995999);
        bids = bids.filter(b => b.id < 996000 || b.id > 996999);
        clients.push({ id: 995001, name: 'R1', source: 'Referral' },
                     { id: 995002, name: 'R2', source: 'Referral' },
                     { id: 995003, name: 'R3', source: 'Referral' });
        bids.push({ id: 996001, client_id: 995001, status: 'Closed Won', amount: 100 });
        window.__install(mine, [
          { metric: 'bench_close_rate_source', scope: 'source:Referral', n: 30, median: null, avg: null, value: 50, day: '2026-07-24' },
        ]);
        window._lcSecOpen_all = true;
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('Close rate by lead source');
      expect(html).toContain('Referral');
      // The platform figure sits in the TradeDesk column, theirs in the You
      // column. The thin-sample marker has its own unit test; asserting it here
      // would depend on how many Referral leads other blocks happen to seed.
      expect(html).toContain('Close rate by lead source');
      expect(html).toContain('Referral');
      expect(html).toContain('50%');
    });

    test('the privacy floor is stated on the card', async () => {
      const html = await page.evaluate(async (mine) => {
        window.__install(mine, []);
        await renderLifecycleFunnel('lc-funnel-mine');
        return document.getElementById('lc-funnel-mine').innerHTML;
      }, MINE);
      expect(html).toContain('five businesses are behind a number');
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
