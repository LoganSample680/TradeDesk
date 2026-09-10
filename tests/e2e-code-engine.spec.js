// @ts-check
/**
 * The code engine: the gate between a plausible number and a permit.
 *
 * Owner directive 2026-09-07: the code books drive the estimate, behind the
 * scenes, and they have to be RIGHT. Everything here exists to make being
 * wrong structurally impossible rather than merely unlikely.
 *
 * The one that matters most is the verified gate. A dataset an LLM drafted
 * from memory is plausible and wrong, and a wrong ampacity on a permit is the
 * worst thing this product could ship. So an unverified dataset returns no
 * answer at all, not a caveated one, and no caller can talk it into a number.
 *
 * What we verify:
 *  1. Nothing unverified ever produces a value, by any route
 *  2. No edition means no answer: we never guess which code his inspector uses
 *  3. Editions coexist and never bleed into each other
 *  4. Every result carries its provenance, or it is not a result
 *  5. The evaluator is pure and never throws, whatever it is handed
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('code engine', () => {
  let page;

  // Two editions of a make-believe family, so the registry is exercised
  // without asserting a single real code value anywhere in this spec.
  const seedSets = () => page.evaluate(() => {
    codeRegister({
      family: 'test', edition: '2020', verified: true,
      data: { sizes: [15, 20, 30, 40, 60, 100] },
      rules: {
        'sized': (inp, data, h) => ({
          value: h.nextUp(inp.amps, data.sizes), unit: 'A',
          cite: 'TEST 2020 1.1',
          assumed: inp.amps == null ? ['no load given, treated as 0'] : [],
          items: [{ label: 'Breaker', qty: 1, unit: 'ea', why: 'sized to the load' }]
        }),
        'boom': () => { throw new Error('rule blew up'); },
        'nothing': () => null,
        'refuses': () => ({ ok: false, reason: 'need-more', warnings: ['Give me the supply pressure.'] })
      }
    });
    // Same family, later edition, DIFFERENT standard sizes: if editions ever
    // bleed, this is the test that catches it.
    codeRegister({
      family: 'test', edition: '2023', verified: true,
      data: { sizes: [15, 25, 50 ] },
      rules: { 'sized': (inp, data, h) => ({ value: h.nextUp(inp.amps, data.sizes), unit: 'A', cite: 'TEST 2023 1.1' }) }
    });
    // Drafted but never checked by a human against the book.
    codeRegister({
      family: 'draft', edition: '2023', verified: false,
      data: { sizes: [1, 2, 3] },
      rules: { 'sized': (inp, data, h) => ({ value: h.nextUp(inp.amps, data.sizes), unit: 'A' }) }
    });
  });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    await seedSets();
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The gate ────────────────────────────────────────────────────────────

  test('an unverified dataset returns no value, by any route', async () => {
    const r = await page.evaluate(() => {
      const byOpts = codeEval('draft', 'sized', { amps: 2 }, { edition: '2023' });
      S.codeEditions = { draft: '2023' };
      const bySettings = codeEval('draft', 'sized', { amps: 2 });
      delete S.codeEditions;
      return { byOpts, bySettings };
    });
    for (const out of [r.byOpts, r.bySettings]) {
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('unverified');
      expect(out.value, 'not a rounded value, not a hedged one, none').toBe(null);
    }
    expect(r.byOpts.warnings.join(' ')).toContain('has not been checked');
  });

  test('the gate cannot be talked around by a caller', async () => {
    const r = await page.evaluate(() => {
      // Every shape a caller might try to force a value out with.
      return [
        codeEval('draft', 'sized', { amps: 2, verified: true }, { edition: '2023' }),
        codeEval('draft', 'sized', { amps: 2 }, { edition: '2023', verified: true }),
        codeEval('draft', 'sized', { amps: 2 }, { edition: '2023', force: true })
      ].map(x => ({ ok: x.ok, value: x.value }));
    });
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.value).toBe(null); });
  });

  test('verifying is a deliberate act, and then the number flows', async () => {
    const r = await page.evaluate(() => {
      const before = codeEval('draft', 'sized', { amps: 2 }, { edition: '2023' });
      const set = codeSet('draft', '2023');
      set.verified = true; set.verifiedBy = 'a licensed human'; set.verifiedAt = '2026-09-07';
      const after = codeEval('draft', 'sized', { amps: 2 }, { edition: '2023' });
      set.verified = false;
      return { before: before.value, after: after.value };
    });
    expect(r.before).toBe(null);
    expect(r.after).toBe(2);
  });

  // ── 2. Never guess the jurisdiction ────────────────────────────────────────

  test('no edition configured means no answer, not a default', async () => {
    const r = await page.evaluate(() => {
      const keep = S.codeEditions; delete S.codeEditions;
      const out = codeEval('test', 'sized', { amps: 22 });
      S.codeEditions = keep;
      return out;
    });
    expect(r.ok).toBe(false);
    expect(r.reason, 'picking a code cycle for him is how you get a failed inspection').toBe('no-edition');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' ')).toContain('Confirm which TEST edition');
  });

  test('his configured edition is used, and an explicit one overrides it', async () => {
    const r = await page.evaluate(() => {
      S.codeEditions = { test: '2020' };
      const fromSettings = codeEval('test', 'sized', { amps: 22 });
      const override = codeEval('test', 'sized', { amps: 22 }, { edition: '2023' });
      delete S.codeEditions;
      return { fromSettings, override };
    });
    expect(r.fromSettings.value, '2020 sizes: 22 rounds to 30').toBe(30);
    expect(r.fromSettings.edition).toBe('2020');
    expect(r.override.value, '2023 sizes: 22 rounds to 25').toBe(25);
    expect(r.override.edition).toBe('2023');
  });

  test('an edition we do not carry is refused, never approximated', async () => {
    const r = await page.evaluate(() => codeEval('test', 'sized', { amps: 22 }, { edition: '2014' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-dataset');
    expect(r.value, 'the nearest edition we happen to have is not an answer').toBe(null);
  });

  test('editions coexist and are listed oldest first', async () => {
    const r = await page.evaluate(() => ({
      test: codeEditions('test'),
      none: codeEditions('nope'),
      found: !!codeSet('test', '2020'),
      missing: codeSet('test', '1999')
    }));
    expect(r.test, 'five NEC editions are live in the US today, and a sixth lands every three years').toEqual(['2020', '2023']);
    expect(r.none).toEqual([]);
    expect(r.found).toBe(true);
    expect(r.missing).toBe(null);
  });

  // ── 3. A result is never a bare number ─────────────────────────────────────

  test('every result carries the answer, the inputs, the edition and the citation', async () => {
    const r = await page.evaluate(() => codeEval('test', 'sized', { amps: 22 }, { edition: '2020' }));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(30);
    expect(r.unit).toBe('A');
    expect(r.inputs, 'a result you cannot reproduce is not a record').toEqual({ amps: 22 });
    expect(r.family).toBe('test');
    expect(r.edition).toBe('2020');
    expect(r.cite, 'a pointer to the section, never the text of it').toBe('TEST 2020 1.1');
    expect(Array.isArray(r.assumed)).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test('defaults the engine filled in are listed, never silent', async () => {
    const r = await page.evaluate(() => codeEval('test', 'sized', {}, { edition: '2020' }));
    expect(r.assumed, 'a default he never saw is the failure mode with our name on it').toContain('no load given, treated as 0');
  });

  test('items come out priced by nothing: his book does that', async () => {
    const r = await page.evaluate(() => codeEval('test', 'sized', { amps: 22 }, { edition: '2020' }));
    expect(r.items.length).toBe(1);
    expect(r.items[0]).toEqual({ label: 'Breaker', qty: 1, unit: 'ea', why: 'sized to the load' });
    expect(r.items[0].price, 'the code says what is needed, never what it costs').toBe(undefined);
  });

  test('a rule can refuse for want of an input, and says which', async () => {
    const r = await page.evaluate(() => codeEval('test', 'refuses', {}, { edition: '2020' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('need-more');
    expect(r.value).toBe(null);
    expect(r.warnings[0], 'guessing an input is how you size the wrong tank').toContain('supply pressure');
  });

  // ── 4. Purity and the junk-input classes (§11.1) ───────────────────────────

  test('same inputs, same answer, every time', async () => {
    const same = await page.evaluate(() => {
      const runs = [];
      for (let i = 0; i < 25; i++) runs.push(JSON.stringify(codeEval('test', 'sized', { amps: 41 }, { edition: '2020' })));
      return runs.every(x => x === runs[0]);
    });
    expect(same).toBe(true);
  });

  test('twenty concurrent calls do not interfere', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 20; i++) out.push(codeEval('test', 'sized', { amps: i % 2 ? 22 : 41 }, { edition: '2020' }));
      return { odds: out.filter((_, i) => i % 2).every(x => x.value === 30), evens: out.filter((_, i) => !(i % 2)).every(x => x.value === 60) };
    });
    expect(r.odds).toBe(true);
    expect(r.evens).toBe(true);
  });

  test('a rule that throws is contained, and reports rather than crashes', async () => {
    const r = await page.evaluate(() => codeEval('test', 'boom', { amps: 1 }, { edition: '2020' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('threw');
    expect(r.value).toBe(null);
  });

  test('a rule returning nothing is a refusal, not an undefined answer', async () => {
    const r = await page.evaluate(() => codeEval('test', 'nothing', {}, { edition: '2020' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-result');
    expect(r.value).toBe(null);
  });

  test('an unknown rule is refused', async () => {
    const r = await page.evaluate(() => codeEval('test', 'no-such-rule', {}, { edition: '2020' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-rule');
  });

  test('null, undefined and junk arguments never throw', async () => {
    const r = await page.evaluate(() => {
      const tries = [
        () => codeEval(null, null, null, null),
        () => codeEval(undefined, undefined),
        () => codeEval('test', 'sized', null, { edition: '2020' }),
        () => codeEval('test', 'sized', 'a string', { edition: '2020' }),
        () => codeEval('test', 'sized', 0, { edition: '2020' }),
        () => codeEval('test', 'sized', [], { edition: '2020' }),
        () => codeEval(123, 456, { amps: 'lots' }, { edition: '2020' })
      ];
      return tries.map(f => { try { const x = f(); return { threw: false, ok: x.ok, value: x.value }; } catch (e) { return { threw: true }; } });
    });
    r.forEach(x => expect(x.threw).toBe(false));
  });

  test('registering junk is refused rather than half-stored', async () => {
    const r = await page.evaluate(() => ({
      nul: codeRegister(null),
      empty: codeRegister({}),
      noEdition: codeRegister({ family: 'x' }),
      noFamily: codeRegister({ edition: '2023' }),
      good: codeRegister({ family: 'zz', edition: '1', verified: false, rules: {} })
    }));
    expect(r.nul).toBe(false);
    expect(r.empty).toBe(false);
    expect(r.noEdition).toBe(false);
    expect(r.noFamily).toBe(false);
    expect(r.good).toBe(true);
  });

  // ── 5. The rounding helpers, where a code's direction is the rule ──────────

  test('nextUp and nextDown round the way a code says, and admit when they cannot', async () => {
    const r = await page.evaluate(() => {
      const set = codeSet('test', '2020');
      const out = {};
      codeRegister({ family: 'h', edition: '1', verified: true, data: {}, rules: {
        probe: (inp, data, h) => ({ value: {
          exact: h.nextUp(30, set.data.sizes),
          between: h.nextUp(31, set.data.sizes),
          overTop: h.nextUp(5000, set.data.sizes),
          underBottom: h.nextUp(1, set.data.sizes),
          downExact: h.nextDown(30, set.data.sizes),
          downBetween: h.nextDown(31, set.data.sizes),
          downUnder: h.nextDown(1, set.data.sizes),
          emptyList: h.nextUp(5, []),
          up: h.up(2.01), down: h.down(2.99)
        } })
      } });
      return codeEval('h', 'probe', {}, { edition: '1' }).value;
    });
    expect(r.exact, 'a value already at a listed size stays there').toBe(30);
    expect(r.between).toBe(40);
    expect(r.overTop, 'off the top of the table is a real answer: it means ask a pro').toBe(null);
    expect(r.underBottom).toBe(15);
    expect(r.downExact).toBe(30);
    expect(r.downBetween).toBe(30);
    expect(r.downUnder).toBe(null);
    expect(r.emptyList).toBe(null);
    expect(r.up).toBe(3);
    expect(r.down).toBe(2);
  });

  test('no console errors', async () => {
    assertNoErrors(page);
  });
});
