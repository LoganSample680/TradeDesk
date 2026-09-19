// @ts-check
// ── A rate per person ────────────────────────────────────────────────────────
//
// Owner 2026-09-19: "could this give me the ability to do two different rates on
// time and materials for the people I add?"
//
// A lead and an apprentice do not bill the same, so the rate belongs to the
// WORKER and the job shows the total per hour that comes out of it. Two numbers
// per person, and rule 18.2 says they must never be conflated:
//
//   pay_rate  what they cost you   already per person, already behind _canViewComp
//   billRate  what they are sold for   new, and the only one a client ever sees
//
// The other half of this file is the compatibility half, and it matters more
// than the feature: every bid written before per-person rates existed has to
// price to the same cent it always did.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const MARCO = 'marco@ts.test';
const JESS = 'jess@ts.test';

test.describe('the rate belongs to the person', () => {
  let page;

  const seed = () => page.evaluate(([m, j]) => {
    S.employees = [
      { name: 'Marco Reyes', email: m, role: 'Lead painter', pay_type: 'hourly', pay_rate: 26 },
      { name: 'Jess Cole', email: j, role: 'Painter', pay_type: 'hourly', pay_rate: 24 },
    ];
    _estCrew = [];
    _estCrewRates = {};
    _tmCrewCount = 2;
    _tmRatePerMan = 85;
  }, [MARCO, JESS]);

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.beforeEach(async () => { await seed(); });
  test.afterAll(async () => { await page.context().close(); });

  // ── Where a rate comes from ───────────────────────────────────────────────
  test.describe('three places, nearest first', () => {
    test('this job beats their default, their default beats nothing', async () => {
      const r = await page.evaluate(([m]) => {
        const none = _billRateFor(m);
        S.employees[0].billRate = 90;
        const byDefault = _billRateFor(m);
        _estCrewRates[m] = 95;
        return { none, byDefault, onThisJob: _billRateFor(m) };
      }, [MARCO]);
      expect(r).toEqual({ none: 0, byDefault: 90, onThisJob: 95 });
    });

    test('a name nobody has, and junk, are zero rather than a throw', async () => {
      const r = await page.evaluate(() => [
        _billRateFor('nobody@ts.test'), _billRateFor(''), _billRateFor(null), _billRateFor(undefined),
      ]);
      expect(r).toEqual([0, 0, 0, 0]);
    });

    // The point of the rate living on the worker: set it once and it follows
    // them onto the next job instead of being typed again.
    test('set as a default, it is on the person and survives the next job', async () => {
      const r = await page.evaluate(([m]) => {
        _setBillRate(m, 95, true);
        const onPerson = S.employees[0].billRate;
        _estCrewRates = {};              // next job, nothing typed on it yet
        return { onPerson, nextJob: _billRateFor(m) };
      }, [MARCO]);
      expect(r).toEqual({ onPerson: 95, nextJob: 95 });
    });

    test('set for this job only, it does not follow them anywhere', async () => {
      const r = await page.evaluate(([m]) => {
        _setBillRate(m, 95, false);
        const onPerson = S.employees[0].billRate;
        _estCrewRates = {};
        return { onPerson: onPerson || 0, nextJob: _billRateFor(m) };
      }, [MARCO]);
      expect(r).toEqual({ onPerson: 0, nextJob: 0 });
    });

    test('a zero clears it rather than storing a zero rate', async () => {
      const r = await page.evaluate(([m]) => {
        _setBillRate(m, 95, false);
        _setBillRate(m, 0, false);
        return { stored: Object.prototype.hasOwnProperty.call(_estCrewRates, m), rate: _billRateFor(m) };
      }, [MARCO]);
      expect(r).toEqual({ stored: false, rate: 0 });
    });
  });

  // ── What the job bills ────────────────────────────────────────────────────
  test.describe('what comes off the job per hour', () => {
    test('two men at their own rates is the sum of those rates', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m, j];
        _estCrewRates[m] = 95; _estCrewRates[j] = 75;
        return { crew: _crewHourlyBill(), billed: _tmHourlyBill() };
      }, [MARCO, JESS]);
      expect(r).toEqual({ crew: 170, billed: 170 });
    });

    test('five men, five rates, one figure', async () => {
      const r = await page.evaluate(() => {
        S.employees = [80, 75, 70, 65, 60].map((rate, i) => ({
          name: 'Hand ' + i, email: 'h' + i + '@ts.test', pay_type: 'hourly', pay_rate: 20, billRate: rate,
        }));
        _estCrew = S.employees.map(e => e.email);
        _estCrewRates = {};
        return _tmHourlyBill();
      });
      expect(r).toBe(350);
    });

    // THE COMPATIBILITY HALF. Nobody has a rate of their own, so the job prices
    // exactly the way it did before this feature existed: crew count times the
    // one flat rate. A regression here silently re-prices every saved bid.
    test('with no per-person rates it is still crew times the flat rate, to the cent', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m, j];
        _estCrewRates = {};
        _tmCrewCount = 2; _tmRatePerMan = 85;
        return { crew: _crewHourlyBill(), billed: _tmHourlyBill() };
      }, [MARCO, JESS]);
      expect(r).toEqual({ crew: 0, billed: 170 });
    });

    test('nobody on the job at all falls back to the flat rate too', async () => {
      const r = await page.evaluate(() => {
        _estCrew = []; _estCrewRates = {};
        _tmCrewCount = 1; _tmRatePerMan = 85;
        return { crew: _crewHourlyBill(), billed: _tmHourlyBill() };
      });
      expect(r).toEqual({ crew: 0, billed: 85 });
    });

    // One man priced and one not is the state he will actually be in halfway
    // through typing. It must not price the unpriced man at the flat rate and
    // quietly double-count: he bills nothing until a number is on him.
    test('half-typed rates count only what has a number on it', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m, j];
        _estCrewRates = {}; _estCrewRates[m] = 95;
        return _tmHourlyBill();
      }, [MARCO, JESS]);
      expect(r).toBe(95);
    });
  });

  // ── Cost is not price ─────────────────────────────────────────────────────
  test.describe('what they cost is a different number', () => {
    // Rule 18.2, as an assertion. Raising what a man is SOLD for must not move
    // what he COSTS, or the margin on every job is a fiction.
    test('changing what someone bills does not change what they cost', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m, j];
        const before = _estLaborCost();
        _setBillRate(m, 500, true);
        return { before, after: _estLaborCost(), pay: S.employees[0].pay_rate };
      }, [MARCO, JESS]);
      expect(r.after).toBe(r.before);
      expect(r.pay).toBe(26);
    });

    test('the bill rate is stored somewhere else entirely from the pay rate', async () => {
      const r = await page.evaluate(([m]) => {
        _setBillRate(m, 95, true);
        const e = S.employees[0];
        return { bill: e.billRate, pay: e.pay_rate, same: e.billRate === e.pay_rate };
      }, [MARCO]);
      expect(r).toEqual({ bill: 95, pay: 26, same: false });
    });
  });

  // ── Saying it back ────────────────────────────────────────────────────────
  test.describe('how it reads', () => {
    test('names and figures, because that is how he checks it', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m, j];
        _estCrewRates[m] = 95; _estCrewRates[j] = 75;
        return _crewRateWords();
      }, [MARCO, JESS]);
      expect(r).toBe('Marco at $95, Jess at $75');
    });

    test('the rate table draws a row per person on the job, and none for anyone else', async () => {
      const r = await page.evaluate(([m, j]) => {
        _estCrew = [m];
        _estCrewRates[m] = 95;
        const html = _crewRatesHtml(S.employees);
        return { hasMarco: html.indexOf('Marco') >= 0, hasJess: html.indexOf('Jess') >= 0,
          saysTotal: html.indexOf('One on site bills $95 an hour') >= 0 };
      }, [MARCO, JESS]);
      expect(r).toEqual({ hasMarco: true, hasJess: false, saysTotal: true });
    });

    // Nobody on the job means no table. A two column grid asking a man working
    // alone to price a crew of nobody is noise, and the flat rate field above is
    // still the right control for him.
    test('nobody on the job means no table at all', async () => {
      const r = await page.evaluate(() => { _estCrew = []; return _crewRatesHtml(S.employees); });
      expect(r).toBe('');
    });
  });

  // ── Set it once ───────────────────────────────────────────────────────────
  test.describe('the offer to stop typing it', () => {
    const withHistory = (n) => page.evaluate(([m, count]) => {
      bids.length = 0;
      for (let i = 0; i < count; i++) bids.push({ id: 92000 + i, estCrewRates: { [m]: 95 } });
      delete S.employees[0].billRate;
      return _billRateHabit(m);
    }, [MARCO, n]);

    test('twice is not a habit', async () => { expect(await withHistory(2)).toBeNull(); });

    test('three of the same figure is', async () => {
      const r = await withHistory(3);
      expect(r.rate).toBe(95);
      expect(r.n).toBe(3);
      expect(r.name).toBe('Marco');
    });

    test('somebody who already has a default is not asked again', async () => {
      const r = await page.evaluate(([m]) => {
        bids.length = 0;
        for (let i = 0; i < 5; i++) bids.push({ id: 92100 + i, estCrewRates: { [m]: 95 } });
        S.employees[0].billRate = 90;
        return _billRateHabit(m);
      }, [MARCO]);
      expect(r).toBeNull();
    });

    test('junk history and junk emails are null, not a throw', async () => {
      const r = await page.evaluate(() => {
        bids.length = 0;
        bids.push(null, {}, { estCrewRates: null }, { estCrewRates: { 'x@y.z': 'not a number' } });
        return [_billRateHabit('nobody@ts.test'), _billRateHabit(''), _billRateHabit(null)];
      });
      expect(r).toEqual([null, null, null]);
    });
  });

  test('no console errors, crew bill rates', async () => {
    assertNoErrors(page, 'crew bill rates');
  });
});
