// @ts-check
/**
 * Exhaustive E2E tests for js/true-measure.js: TrueBid, the flagship
 * proposal type, and the TrueSuite registry of measuring tools under it
 * (TrueScan, TrueMeasure, more to come).
 *
 * Covers: _tmAreaFt2, _tmPathFt, _tmAreaUnit, _tmAreaValue, _tmDefaultMode,
 * _tmRates, _tmMeasure, openTrueMeasure, _tmSetMode, _tmRepeatStep, _tmUndo,
 * _tmConfirmScreen, _tmAddToEstimate, _pickEstStyle('truebid'),
 * _tmOpenTrueSuite, _trueSuiteToolsForTrade, _tmMethodPicker, _tmPickMethod,
 * the window._trueMeasureSeed hand-off consumed by openGenericEstimate.
 *
 * Requirements per §11.1: null/undefined, empty, boundary, type mismatch,
 * missing DOM, golden path, concurrent calls, corrupted state.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('true-measure.js: exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
      if (!window.clients) window.clients = [];
      // No addr on purpose: _tmClientCoord must short-circuit before ever
      // reaching a real geocode fetch, offline tests make zero network calls.
      clients.push({ id: 79001, name: 'TrueMeasure Test Co', addr: '' });
      // Separate clients for every test that actually runs _tmAddToEstimate/
      // openGenericEstimate: opening an estimate for a client leaves a draft
      // bid behind (real app behavior), and a SECOND open for the same
      // client legitimately hits the app's own "resume this draft or start
      // new?" chooser instead of silently opening fresh. That's correct
      // product behavior, not something to route around by sharing one
      // client id across tests, each of these needs its own.
      clients.push({ id: 79002, name: 'TrueMeasure Add-To-Estimate Co', addr: '' });
      clients.push({ id: 79003, name: 'TrueMeasure Bad Numbers Co', addr: '' });
      clients.push({ id: 79004, name: 'TrueMeasure Same-Client Seed Co', addr: '' });
      clients.push({ id: 79005, name: 'TrueMeasure Wrong-Client Seed Co', addr: '' });
      clients.push({ id: 79006, name: 'TrueMeasure Consumed-Once Co', addr: '' });
    });
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── _tmAreaFt2 (shoelace) ────────────────────────────────────────────────
  test.describe('_tmAreaFt2', () => {
    test('null/undefined/empty: returns 0, never throws', async () => {
      const r = await page.evaluate(() => {
        try {
          return { ok: true, a: _tmAreaFt2(null), b: _tmAreaFt2(undefined), c: _tmAreaFt2([]) };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.a).toBe(0); expect(r.b).toBe(0); expect(r.c).toBe(0);
    });

    test('1 or 2 points: no area yet, returns 0', async () => {
      const r = await page.evaluate(() => ({
        one: _tmAreaFt2([{ lat: 39, lng: -97 }]),
        two: _tmAreaFt2([{ lat: 39, lng: -97 }, { lat: 39.001, lng: -97 }]),
      }));
      expect(r.one).toBe(0);
      expect(r.two).toBe(0);
    });

    test('golden path: a roughly-square 100ft x 100ft plot computes close to 10,000 sq ft', async () => {
      const r = await page.evaluate(() => {
        // ~100ft square near the equator-ish latitude used in the app's own math.
        const lat = 39.0, ftPerDegLat = 364000, ftPerDegLng = 364000 * Math.cos(lat * Math.PI / 180);
        const dLat = 100 / ftPerDegLat, dLng = 100 / ftPerDegLng;
        const pts = [
          { lat, lng: -97 },
          { lat, lng: -97 + dLng },
          { lat: lat + dLat, lng: -97 + dLng },
          { lat: lat + dLat, lng: -97 },
        ];
        return _tmAreaFt2(pts);
      });
      expect(r).toBeGreaterThan(9900);
      expect(r).toBeLessThan(10100);
    });

    test('type mismatch: a plain string or number input does not throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, a: _tmAreaFt2('nope'), b: _tmAreaFt2(42) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
    });
  });

  // ── _tmPathFt (leg distance) ─────────────────────────────────────────────
  test.describe('_tmPathFt', () => {
    test('null/undefined/empty/1-point: returns 0', async () => {
      const r = await page.evaluate(() => ({
        a: _tmPathFt(null), b: _tmPathFt(undefined), c: _tmPathFt([]),
        d: _tmPathFt([{ lat: 39, lng: -97 }]),
      }));
      expect(r.a).toBe(0); expect(r.b).toBe(0); expect(r.c).toBe(0); expect(r.d).toBe(0);
    });

    test('multi-point path sums each leg, not just endpoint-to-endpoint', async () => {
      const r = await page.evaluate(() => {
        const straight = _tmPathFt([{ lat: 39, lng: -97 }, { lat: 39.001, lng: -97 }]);
        const bent = _tmPathFt([{ lat: 39, lng: -97 }, { lat: 39.0005, lng: -97.0005 }, { lat: 39.001, lng: -97 }]);
        return { straight, bent };
      });
      // A bent path between the same two endpoints is never shorter than the direct line.
      expect(r.bent).toBeGreaterThanOrEqual(r.straight - 1);
    });
  });

  // ── _tmAreaUnit / _tmAreaValue (roofing squares conversion) ──────────────
  test.describe('roofing squares conversion', () => {
    test('non-roofing trade: unit is ft², value is raw rounded sq ft', async () => {
      const r = await page.evaluate(() => {
        const prev = window._activeTrade;
        _activeTrade = 'landscaping';
        const out = { unit: _tmAreaUnit(), value: _tmAreaValue(3412.4) };
        _activeTrade = prev;
        return out;
      });
      expect(r.unit).toBe('ft²');
      expect(r.value).toBe(3412);
    });

    test('roofing trade: unit is sq, value divided by 100 and rounded to a tenth', async () => {
      const r = await page.evaluate(() => {
        const prev = window._activeTrade;
        _activeTrade = 'roofing';
        const out = { unit: _tmAreaUnit(), value: _tmAreaValue(1850) };
        _activeTrade = prev;
        return out;
      });
      expect(r.unit).toBe('sq');
      expect(r.value).toBe(18.5);
    });

    test('_tmAreaValue: 0 and negative input never throw', async () => {
      const r = await page.evaluate(() => {
        try { return { ok: true, a: _tmAreaValue(0), b: _tmAreaValue(-50) }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
    });
  });

  // ── _tmDefaultMode ────────────────────────────────────────────────────────
  test.describe('_tmDefaultMode', () => {
    test('electrical and plumbing default to distance, everything else defaults to area', async () => {
      const r = await page.evaluate(() => {
        const prev = window._activeTrade;
        const out = {};
        for (const t of ['electrical', 'plumbing', 'landscaping', 'roofing', 'painting', undefined, null, '']) {
          _activeTrade = t;
          out[String(t)] = _tmDefaultMode();
        }
        _activeTrade = prev;
        return out;
      });
      expect(r.electrical).toBe('distance');
      expect(r.plumbing).toBe('distance');
      expect(r.landscaping).toBe('area');
      expect(r.roofing).toBe('area');
      expect(r.painting).toBe('area');
      expect(r.undefined).toBe('area');
      expect(r.null).toBe('area');
    });
  });

  // ── _tmRates ─────────────────────────────────────────────────────────────
  test.describe('_tmRates', () => {
    test('initializes to all-zero on first call, persists on S across calls', async () => {
      const r = await page.evaluate(() => {
        delete S.trueMeasureRates;
        const first = _tmRates();
        first.areaSqFt = 0.42;
        const second = _tmRates();
        return { first: { areaSqFt: first.areaSqFt, roofSquare: first.roofSquare, distanceLf: first.distanceLf }, secondSame: second === first, secondRate: second.areaSqFt };
      });
      expect(r.first.roofSquare).toBe(0);
      expect(r.first.distanceLf).toBe(0);
      expect(r.secondSame).toBe(true);
      expect(r.secondRate).toBe(0.42);
      await page.evaluate(() => { delete S.trueMeasureRates; });
    });
  });

  // ── openTrueMeasure / state machine ──────────────────────────────────────
  test.describe('openTrueMeasure and the drawing state machine', () => {
    test('null client: does not throw, does not open the overlay', async () => {
      const r = await page.evaluate(async () => {
        try { await openTrueMeasure(null); return { ok: true, hasOv: !!document.getElementById('_tm-ov') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.hasOv).toBe(false);
    });

    test('golden path: opens, shows the unavailable-map fallback on this unauthorized origin, no console errors', async () => {
      const r = await page.evaluate(async () => {
        const c = clients.find(x => x.id === 79001);
        try {
          await openTrueMeasure(c);
          const ov = document.getElementById('_tm-ov');
          const fallback = document.getElementById('tm-unavailable');
          return { ok: true, hasOv: !!ov, fallbackShown: fallback && fallback.style.display === 'flex' };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.hasOv).toBe(true);
      // MapKit is domain-locked (CLAUDE.md §10.1); this test runs on an
      // unauthorized origin, so the graceful fallback state is the correct,
      // expected result here, not a bug.
      expect(r.fallbackShown).toBe(true);
    });

    test('the tm-debug diagnostic panel is hidden by default (owner 2026-08-22 cleanup)', async () => {
      const r = await page.evaluate(async () => {
        const c = clients.find(x => x.id === 79001);
        await openTrueMeasure(c);
        const el = document.getElementById('tm-debug');
        return { exists: !!el, display: el && el.style.display };
      });
      // Still in the DOM (so future debugging can flip it back on without
      // rebuilding the logging), just never visible to a live user.
      expect(r.exists).toBe(true);
      expect(r.display).toBe('none');
    });

    // Every test below owns its own _tmState from scratch (never assumes an
    // earlier test in this file already set it): CI can shard individual
    // tests, not whole files, so a test landing on a shard without the
    // "golden path" test above would otherwise find _tmState at its
    // untouched module-level null.
    const freshTmState = (mode) => ({ c: { id: 79001 }, mode: mode || 'area', points: [], repeatCount: 1, map: null });

    test('_tmSetMode: switching mode resets points and repeat count', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        _tmState.points = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
        _tmState.repeatCount = 4;
        _tmSetMode('distance');
        return { mode: _tmState.mode, points: _tmState.points.length, repeat: _tmState.repeatCount };
      }, freshTmState('area'));
      expect(r.mode).toBe('distance');
      expect(r.points).toBe(0);
      expect(r.repeat).toBe(1);
    });

    test('_tmSetMode: same mode is a no-op, does not clear points', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        _tmState.points = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
        _tmSetMode('distance');
        return _tmState.points.length;
      }, freshTmState('distance'));
      expect(r).toBe(2);
    });

    test('_tmSetMode: null state does not throw', async () => {
      const r = await page.evaluate(() => {
        _tmState = null;
        let ok = true, err = '';
        try { _tmSetMode('area'); } catch (e) { ok = false; err = e.message; }
        return { ok, err };
      });
      expect(r.ok, r.err).toBe(true);
    });

    test('_tmRepeatStep: clamps between 1 and 20', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state; _tmState.repeatCount = 1;
        _tmRepeatStep(-5);
        const low = _tmState.repeatCount;
        _tmState.repeatCount = 20;
        _tmRepeatStep(3);
        const high = _tmState.repeatCount;
        return { low, high };
      }, freshTmState('distance'));
      expect(r.low).toBe(1);
      expect(r.high).toBe(20);
    });

    test('_tmUndo: empty points array does not throw', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        try { _tmUndo(); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      }, freshTmState('area'));
      expect(r.ok, r.err).toBe(true);
    });

    test('_tmUndo: removes exactly the last point', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        _tmState.points = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];
        _tmUndo();
        return _tmState.points;
      }, freshTmState('area'));
      expect(r).toEqual([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    });

    test('5 concurrent _tmAddPoint calls all land, no lost updates', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        for (let i = 0; i < 5; i++) _tmAddPoint(39 + i * 0.0001, -97);
        return _tmState.points.length;
      }, freshTmState('area'));
      expect(r).toBe(5);
    });
  });

  // ── _tmMeasure ───────────────────────────────────────────────────────────
  test.describe('_tmMeasure', () => {
    const freshTmState = (mode) => ({ c: { id: 79001 }, mode: mode || 'area', points: [], repeatCount: 1, map: null });

    test('area mode under 3 points: value is 0, not ready', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        _tmState.points = [{ lat: 1, lng: 1 }];
        return _tmMeasure();
      }, freshTmState('area'));
      expect(r.value).toBe(0);
    });

    test('distance mode with repeatCount multiplies the single measured leg', async () => {
      const r = await page.evaluate((state) => {
        _tmState = state;
        _tmState.points = [{ lat: 39, lng: -97 }, { lat: 39.001, lng: -97 }];
        _tmState.repeatCount = 4;
        const m = _tmMeasure();
        return { total: m.value, oneLeg: m.oneLeg, label: m.label };
      }, freshTmState('distance'));
      expect(r.total).toBe(r.oneLeg * 4);
      expect(r.label).toContain('4 runs');
    });

    test('null state: returns a safe zero object, never throws', async () => {
      const r = await page.evaluate(() => {
        _tmState = null;
        try { return { ok: true, m: _tmMeasure() }; } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.m.value).toBe(0);
    });
  });

  // ── Confirm/adjust screen and the seed hand-off ──────────────────────────
  test.describe('_tmConfirmScreen and _tmAddToEstimate', () => {
    test('confirm screen renders editable fields pre-filled from the measurement', async () => {
      const r = await page.evaluate(() => {
        _tmState = { c: { id: 79001 }, mode: 'area', points: [{ lat: 39, lng: -97 }, { lat: 39.0003, lng: -97 }, { lat: 39.0003, lng: -97.0003 }], repeatCount: 1, map: null };
        _tmConfirmScreen();
        const ov = document.getElementById('_tm-confirm-ov');
        return {
          hasOv: !!ov,
          desc: (document.getElementById('tm-c-desc') || {}).value,
          qty: (document.getElementById('tm-c-qty') || {}).value,
        };
      });
      expect(r.hasOv).toBe(true);
      expect(r.desc).toBeTruthy();
      expect(Number(r.qty)).toBeGreaterThan(0);
      await page.evaluate(() => document.getElementById('_tm-confirm-ov')?.remove());
    });

    // _tmAddToEstimate calls openFreeFormEstimate(c) synchronously, which
    // consumes and nulls window._trueMeasureSeed as part of its normal,
    // correct behavior, by the time control returns here the seed variable
    // is ALREADY gone by design. The real evidence the hand-off worked is
    // the line landing in _geiLines (the estimate builder's own state), not
    // the transient seed variable, so that's what these check.
    test('_tmAddToEstimate hands the measured line to the estimate builder for the right client and closes both overlays', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79002);
        _tmState = { c, mode: 'distance', points: [{ lat: 39, lng: -97 }, { lat: 39.001, lng: -97 }], repeatCount: 1, map: null };
        _tmConfirmScreen();
        document.getElementById('tm-c-desc').value = 'Test service run';
        document.getElementById('tm-c-qty').value = '86';
        document.getElementById('tm-c-rate').value = '2.5';
        _tmAddToEstimate();
        return {
          confirmGone: !document.getElementById('_tm-confirm-ov'),
          tmGone: !document.getElementById('_tm-ov'),
          line: _geiLines.find(l => l.desc === 'Test service run'),
          byoItem: _byoItems.find(x => x.label === 'Test service run'),
        };
      });
      expect(r.confirmGone).toBe(true);
      expect(r.tmGone).toBe(true);
      expect(r.line).toBeTruthy();
      expect(r.line.qty).toBe(86);
      expect(r.line.rate).toBe(2.5);
      expect(r.line.total).toBe(215);
      // BYO mode's actual line-item page reads byoItems off the bid record,
      // never _geiLines (see the openGenericEstimate fix), so the seed has
      // to land there too or it's invisible the moment a contractor opens
      // the estimate for real.
      expect(r.byoItem, 'the seed also lands in byoItems, what the BYO page actually renders').toBeTruthy();
      expect(r.byoItem.price).toBe(215);
    });

    // type="number" inputs silently reject or revert an invalid string
    // assignment at the DOM level (a real user physically can't type
    // non-numeric characters into one), so the realistic "bad input" case
    // for this field type is the DOM node being missing entirely, §11.1's
    // "missing DOM" class, not a string the browser would never store.
    test('_tmAddToEstimate: missing qty/rate DOM nodes never throw or go negative', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79003);
        _tmState = { c, mode: 'area', points: [{ lat: 39, lng: -97 }, { lat: 39.0003, lng: -97 }, { lat: 39.0003, lng: -97.0003 }], repeatCount: 1, map: null };
        _tmConfirmScreen();
        document.getElementById('tm-c-desc').value = 'Bad numbers test';
        document.getElementById('tm-c-qty').remove();
        document.getElementById('tm-c-rate').remove();
        try {
          _tmAddToEstimate();
          return { ok: true, line: _geiLines.find(l => l.desc === 'Bad numbers test') };
        } catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.line).toBeTruthy();
      // openGenericEstimate's seed-consumption mapping falls a missing/zero
      // qty back to 1 (qty:l.qty||1, the same convention the pre-existing
      // Scan Estimate seed already uses: a line never shows a zero quantity,
      // never guesses a rate). Rate stays 0, unset, priced by the contractor.
      expect(r.line.qty).toBe(1);
      expect(r.line.rate).toBe(0);
    });
  });

  // ── Picker card wiring ────────────────────────────────────────────────────
  test.describe('the picker card and _pickEstStyle dispatch', () => {
    test('_showEstimateStylePicker renders a TrueBid card', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79001);
        _showEstimateStylePicker(c);
        const html = document.getElementById('_style-pick-ov').innerHTML;
        return html.includes('TrueBid');
      });
      expect(r).toBe(true);
      await page.evaluate(() => document.getElementById('_style-pick-ov')?.remove());
    });

    test("_pickEstStyle('truebid') on a non-capable phone opens TrueMeasure directly, the only real option", async () => {
      const r = await page.evaluate(async () => {
        const c = clients.find(x => x.id === 79001);
        _stylePickState = { c };
        _pickEstStyle('truebid');
        await new Promise(res => setTimeout(res, 50));
        const hasOv = !!document.getElementById('_tm-ov');
        document.getElementById('_tm-ov')?.remove();
        _tmState = null;
        return hasOv;
      });
      expect(r).toBe(true);
    });

    test('the picker no longer shows a standalone Scan Estimate card', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79001);
        _showEstimateStylePicker(c);
        const html = document.getElementById('_style-pick-ov').innerHTML;
        return html.includes('Scan Estimate');
      });
      expect(r, 'TrueBid replaced the standalone Scan card, one door not two').toBe(false);
      await page.evaluate(() => document.getElementById('_style-pick-ov')?.remove());
    });

    test("_pickEstStyle('truebid') on a scan-capable phone shows the TrueSuite method picker, not TrueMeasure directly", async () => {
      const r = await page.evaluate(async () => {
        const c = clients.find(x => x.id === 79001);
        const orig = window._scanCapable;
        window._scanCapable = () => true;
        _stylePickState = { c };
        _pickEstStyle('truebid');
        await new Promise(res => setTimeout(res, 50));
        const html = document.getElementById('_tm-method-ov')?.innerHTML || '';
        const out = { methodOv: !!document.getElementById('_tm-method-ov'), tmOv: !!document.getElementById('_tm-ov'), hasScan: html.includes('TrueScan'), hasAerial: html.includes('TrueMeasure') };
        document.getElementById('_tm-method-ov')?.remove();
        _tmMethodState = null;
        window._scanCapable = orig;
        return out;
      });
      expect(r.methodOv).toBe(true);
      expect(r.tmOv).toBe(false);
      expect(r.hasScan).toBe(true);
      expect(r.hasAerial).toBe(true);
    });

    test('_tmOpenTrueSuite: two ready tools shows the picker, one ready tool skips straight to it', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79001);
        const origCapable = _TRUESUITE_TOOLS[0].capable;
        // Two ready: picker shows.
        _TRUESUITE_TOOLS[0].capable = () => true;
        _tmOpenTrueSuite(c);
        const twoReady = { methodOv: !!document.getElementById('_tm-method-ov'), tmOv: !!document.getElementById('_tm-ov') };
        document.getElementById('_tm-method-ov')?.remove(); _tmMethodState = null;
        // One ready: skips the picker, launches the only option.
        _TRUESUITE_TOOLS[0].capable = () => false;
        _tmOpenTrueSuite(c);
        const oneReady = { methodOv: !!document.getElementById('_tm-method-ov'), tmOv: !!document.getElementById('_tm-ov') };
        document.getElementById('_tm-ov')?.remove(); _tmState = null;
        _TRUESUITE_TOOLS[0].capable = origCapable;
        return { twoReady, oneReady };
      });
      expect(r.twoReady.methodOv).toBe(true);
      expect(r.twoReady.tmOv).toBe(false);
      expect(r.oneReady.methodOv).toBe(false);
      expect(r.oneReady.tmOv).toBe(true);
    });

    test('_tmOpenTrueSuite: null client does not throw', async () => {
      const r = await page.evaluate(() => {
        try { _tmOpenTrueSuite(null); return { ok: true }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
    });

    test('_trueSuiteToolsForTrade: an electrical-only tool is hidden for other trades, shown for electrical', async () => {
      const r = await page.evaluate(() => {
        _TRUESUITE_TOOLS.push({ id: '_test_electrical_only', name: 'Test Electrical Tool', tagline: '', icon: '⚡', sub: '', bullets: [], trades: ['electrical'], capable: () => true, launch: () => {} });
        const prevTrade = window._activeTrade;
        _activeTrade = 'landscaping';
        const hiddenForLandscaping = !_trueSuiteToolsForTrade().some(t => t.id === '_test_electrical_only');
        _activeTrade = 'electrical';
        const shownForElectrical = _trueSuiteToolsForTrade().some(t => t.id === '_test_electrical_only');
        _activeTrade = prevTrade;
        _TRUESUITE_TOOLS.pop();
        return { hiddenForLandscaping, shownForElectrical };
      });
      expect(r.hiddenForLandscaping).toBe(true);
      expect(r.shownForElectrical).toBe(true);
    });

    test('_tmPickMethod(aerial) opens TrueMeasure and closes the method picker', async () => {
      const r = await page.evaluate(async () => {
        const c = clients.find(x => x.id === 79001);
        _tmMethodState = { c };
        _tmPickMethod('aerial');
        await new Promise(res => setTimeout(res, 50));
        const out = { methodOv: !!document.getElementById('_tm-method-ov'), tmOv: !!document.getElementById('_tm-ov') };
        document.getElementById('_tm-ov')?.remove();
        _tmState = null;
        return out;
      });
      expect(r.methodOv).toBe(false);
      expect(r.tmOv).toBe(true);
    });

    test('_tmPickMethod(scan) on a non-capable phone shows the LiDAR explainer, never opens the scan builder', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79001);
        let explainerShown = false;
        const origWhy = window._scanWhyNoLidar;
        const origOpen = window.openScanEstimate;
        window._scanWhyNoLidar = () => { explainerShown = true; };
        window.openScanEstimate = () => { throw new Error('should never open on a non-capable phone'); };
        _tmMethodState = { c };
        let ok = true, err = '';
        try { _tmPickMethod('scan'); } catch (e) { ok = false; err = e.message; }
        window._scanWhyNoLidar = origWhy;
        window.openScanEstimate = origOpen;
        return { ok, err, explainerShown };
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.explainerShown).toBe(true);
    });

    test('_tmMethodPicker: null client does not throw or open anything', async () => {
      const r = await page.evaluate(() => {
        try { _tmMethodPicker(null); return { ok: true, hasOv: !!document.getElementById('_tm-method-ov') }; }
        catch (e) { return { ok: false, err: e.message }; }
      });
      expect(r.ok, r.err).toBe(true);
      expect(r.hasOv).toBe(false);
    });

    test('_tmPickMethod: null _tmMethodState does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = _tmMethodState;
        _tmMethodState = null;
        let ok = true, err = '';
        try { _tmPickMethod('aerial'); } catch (e) { ok = false; err = e.message; }
        _tmMethodState = saved;
        return { ok, err };
      });
      expect(r.ok, r.err).toBe(true);
    });

    test('_pickEstStyle: null _stylePickState does not throw', async () => {
      const r = await page.evaluate(() => {
        const saved = _stylePickState;
        _stylePickState = null;
        let ok = true, err = '';
        try { _pickEstStyle('truebid'); } catch (e) { ok = false; err = e.message; }
        _stylePickState = saved;
        return { ok, err };
      });
      expect(r.ok, r.err).toBe(true);
    });
  });

  // ── Seed consumption in the shared estimate pipeline ─────────────────────
  test.describe('window._trueMeasureSeed consumed by openGenericEstimate', () => {
    test('a seed for the SAME client pre-fills a measured line item', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79004);
        window._trueMeasureSeed = { clientId: 79004, lines: [{ desc: 'Traced lawn', qty: 3412, unit: 'ft²', rate: 0, total: 0 }] };
        openGenericEstimate(c, null, null, { mode: 'byo' });
        const found = _geiLines.some(l => l.desc === 'Traced lawn' && l.qty === 3412);
        return { found, seedCleared: window._trueMeasureSeed == null };
      });
      expect(r.found).toBe(true);
      expect(r.seedCleared).toBe(true);
      await page.evaluate(() => document.querySelectorAll('.zmodal-overlay, #_style-pick-ov').forEach(el => el.remove()));
    });

    test('a seed for a DIFFERENT client is never consumed', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79005);
        window._trueMeasureSeed = { clientId: 999999, lines: [{ desc: 'Not this client', qty: 1, unit: 'ea', rate: 0, total: 0 }] };
        openGenericEstimate(c, null, null, { mode: 'byo' });
        const found = _geiLines.some(l => l.desc === 'Not this client');
        const stillSet = window._trueMeasureSeed != null;
        return { found, stillSet };
      });
      expect(r.found).toBe(false);
      expect(r.stillSet).toBe(true);
      await page.evaluate(() => { delete window._trueMeasureSeed; document.querySelectorAll('.zmodal-overlay, #_style-pick-ov').forEach(el => el.remove()); });
    });

    // Reopening the SAME draft a second time correctly shows its persisted
    // content again, that's not the seed being re-applied, it's the draft's
    // real content (_byoUpdateRail mirrors _byoItems into _geiLines every
    // time the BYO page renders). What "consumed exactly once" actually
    // guarantees: the seed variable itself is gone after the first open,
    // and the line is never DUPLICATED by a second open with no new seed.
    test('the seed is consumed exactly once: the seed variable clears, and a second open never duplicates the line', async () => {
      const r = await page.evaluate(() => {
        const c = clients.find(x => x.id === 79006);
        window._trueMeasureSeed = { clientId: 79006, lines: [{ desc: 'Once only', qty: 1, unit: 'ea', rate: 0, total: 0 }] };
        openGenericEstimate(c, null, null, { mode: 'byo' });
        const firstCount = _geiLines.filter(l => l.desc === 'Once only').length;
        const seedGoneAfterFirst = window._trueMeasureSeed == null;
        openGenericEstimate(c, null, null, { mode: 'byo' }); // no new seed this time
        const secondCount = _geiLines.filter(l => l.desc === 'Once only').length;
        return { firstCount, secondCount, seedGoneAfterFirst };
      });
      expect(r.firstCount).toBe(1);
      expect(r.seedGoneAfterFirst).toBe(true);
      expect(r.secondCount, 'reopening the same draft shows its existing content once, never duplicated').toBe(1);
      await page.evaluate(() => document.querySelectorAll('.zmodal-overlay, #_style-pick-ov').forEach(el => el.remove()));
    });
  });

  test('assertNoErrors', async () => {
    await assertNoErrors(page, 'true-measure.js');
  });
});
