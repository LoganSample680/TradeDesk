// @ts-check
/**
 * Plumbing code: the IPC and the UPC, and the wall between them.
 *
 * The bug this whole spec exists to make impossible is not bad arithmetic. It
 * is right arithmetic on the other book's table. The IPC and the UPC give the
 * same fixture different drainage fixture units, so a total built from the
 * wrong one is a wrong pipe size that looks perfect all the way to the
 * inspection and shows up two years later as a drain that backs up.
 *
 * Note what this file does NOT do: it asserts no real code value anywhere.
 * Every number below comes from a make-believe dataset invented in this file,
 * with values chosen to be obviously fake (11, 77, 5000) so nobody can ever
 * mistake one for something read out of a book. The real datasets ship with
 * every slot null and verified:false, and the first group of tests is about
 * exactly that: they return nothing, by every route, until a human types the
 * tables in from the purchased edition and signs for them.
 *
 * What we verify:
 *  1. The shipped datasets are empty and unverified, and produce no number
 *  2. IPC and UPC can never cross: not by registration, not by rules, not by
 *     citation, and not by anything the caller passes in
 *  3. The rules compute, refuse, and say which input or which table is missing
 *  4. Every §11.1 input class: null, empty, boundary, type mismatch,
 *     concurrent, post-error
 *  5. Real worked examples, waiting on a human with the book (test.fixme)
 */

const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const MODULE = path.join(__dirname, '..', 'js', 'code-ipc.js');

// ── Make-believe datasets ────────────────────────────────────────────────────
//
// Same schema as the real files, deliberately absurd values, and DIFFERENT
// values between the two families so a crossed wire shows up as a number
// rather than as nothing. If the wall ever leaks, an IPC bathtub comes back
// as 77 and the test says so.
const fakeSet = (family, edition, v) => ({
  schema: 'td-plumb-1', family, edition,
  title: 'NOT A CODE BOOK: test fixture',
  verified: true, verifiedBy: 'the test suite', verifiedAt: '2026-09-07',
  todo: [], sources: {}, lookup: {},
  cites: {
    'dfu-total': v.tag + ' T1', 'drain-size': v.tag + ' T2', 'drain-slope': v.tag + ' T2a',
    'vent-size': v.tag + ' T3', 'wsfu-total': v.tag + ' T4', 'water-service-size': v.tag + ' T5',
    'water-heater-expansion': v.tag + ' T6', 'water-heater-relief': v.tag + ' T7'
  },
  shapes: {},
  fixtures: {
    bathtub: {
      label: 'Bathtub', trapSizeIn: { private: 1.5, public: 1.5 },
      dfu: { private: v.tub, public: v.tub },
      wsfu: { private: { cold: 1, hot: 1, total: v.tubW }, public: { cold: 1, hot: 1, total: v.tubW } }
    },
    lavatory: {
      label: 'Lavatory (bathroom sink)', trapSizeIn: { private: 1.25, public: 1.25 },
      dfu: { private: v.lav, public: v.lavPub },
      wsfu: { private: { cold: 1, hot: 1, total: v.lavW }, public: { cold: 1, hot: 1, total: v.lavW } }
    },
    // Present in the catalogue, no value on file. This is the shape every row
    // of both real datasets is in today.
    'shower-stall': {
      label: 'Shower stall', trapSizeIn: { private: null, public: null },
      dfu: { private: null, public: null },
      wsfu: { private: { cold: null, hot: null, total: null }, public: { cold: null, hot: null, total: null } }
    },
    'water-closet-tank': {
      label: 'Water closet, tank type', trapSizeIn: { private: 3, public: 3 },
      dfu: { private: v.wc, public: v.wc },
      wsfu: { private: { cold: 1, hot: 0, total: v.wcW }, public: { cold: 1, hot: 0, total: v.wcW } }
    },
    'water-closet-flushometer': {
      label: 'Water closet, flushometer', trapSizeIn: { private: 3, public: 3 },
      dfu: { private: v.wc * 2, public: v.wc * 2 },
      wsfu: { private: { cold: 1, hot: 0, total: v.wcW }, public: { cold: 1, hot: 0, total: v.wcW } }
    }
  },
  dfu: { unlistedByTrapSizeIn: [], continuousFlowDfuPerGpm: v.cf },
  drain: {
    minSizeIn: 1.5, minSizeForWaterClosetIn: 3, defaultSlopeInPerFt: null,
    slopesInPerFt: [0.125, 0.25],
    horizontalBranch: [{ sizeIn: 2, maxDfu: v.b2 }, { sizeIn: 3, maxDfu: v.b3 }, { sizeIn: 4, maxDfu: v.b4 }],
    stack: [
      { sizeIn: 2, maxDfuTotal: v.b2, maxDfuPerBranchInterval: 2, maxBranchIntervals: 3 },
      { sizeIn: 3, maxDfuTotal: v.b3, maxDfuPerBranchInterval: 20, maxBranchIntervals: 3 },
      { sizeIn: 4, maxDfuTotal: v.b4, maxDfuPerBranchInterval: 200, maxBranchIntervals: 3 }
    ],
    buildingDrain: [
      { sizeIn: 3, maxDfuBySlope: { '0.125': v.b3, '0.25': v.b4 } },
      { sizeIn: 4, maxDfuBySlope: { '0.125': v.b4, '0.25': v.b4 * 2 } }
    ]
  },
  vent: {
    minSizeIn: 1.25, minFractionOfDrainSize: 0.5,
    table: [
      { drainSizeIn: 2, maxDfu: 10, maxLengthFtByVentSize: { '1.25': 20, '1.5': 100, '2': 500 } },
      { drainSizeIn: 3, maxDfu: 100, maxLengthFtByVentSize: { '1.5': 30, '2': 200, '3': 900 } }
    ]
  },
  water: {
    minServiceSizeIn: 0.75, minDistributionSizeIn: 0.5, continuousFlowWsfuPerGpm: 1,
    serviceSizing: [
      { pressureRange: { minPsi: 30, maxPsi: 45 }, meterSizeIn: 0.625, serviceSizeIn: 0.75, distributionSizeIn: 0.5, maxWsfuByLengthFt: { '40': v.w1, '100': 3, '200': 1 } },
      { pressureRange: { minPsi: 30, maxPsi: 45 }, meterSizeIn: 0.75, serviceSizeIn: 1, distributionSizeIn: 0.75, maxWsfuByLengthFt: { '40': v.w2, '100': 30, '200': 10 } },
      { pressureRange: { minPsi: 46, maxPsi: 60 }, meterSizeIn: 0.625, serviceSizeIn: 0.75, distributionSizeIn: 0.5, maxWsfuByLengthFt: { '40': v.w3, '100': 9, '200': 3 } }
    ]
  },
  waterHeater: {
    expansion: {
      requiredOnClosedSystem: true, method: null,
      waterExpansionFactorByTempF: {}, acceptanceFactorMethod: null, standardTankSizesGal: [2, 4.4]
    },
    relief: { tempPressureValveRequired: true, maxSetPsi: 150, maxSetTempF: 210, dischargePipeSizeRule: null, dischargeMaxElbows: null, dischargeMaxLengthFt: null }
  }
});

const IPC_FAKE = { tag: 'FAKEIPC', tub: 11, lav: 5, lavPub: 6, wc: 40, cf: 2, b2: 10, b3: 100, b4: 5000, tubW: 3, lavW: 7, wcW: 13, w1: 2, w2: 60, w3: 4 };
const UPC_FAKE = { tag: 'FAKEUPC', tub: 77, lav: 9, lavPub: 12, wc: 80, cf: 4, b2: 20, b3: 300, b4: 9000, tubW: 5, lavW: 11, wcW: 17, w1: 1, w2: 40, w3: 2 };

test.describe('plumbing code: IPC and UPC', () => {
  let page;

  const seed = () => page.evaluate(({ ipc, upc }) => {
    window._reg = {
      ipc: codeIpcRegister(ipc),
      upc: codeIpcRegister(upc)
    };
    S.codeEditions = { ipc: 'test-ipc', upc: 'test-upc' };
    return window._reg;
  }, { ipc: fakeSet('ipc', 'test-ipc', IPC_FAKE), upc: fakeSet('upc', 'test-upc', UPC_FAKE) });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
    // The module may or may not be wired into index.html yet (index.html is
    // owned elsewhere this session). Either way the spec runs against the real
    // file on disk, never a copy.
    const has = await page.evaluate(() => typeof window.codeIpcRegister === 'function');
    if (!has) await page.addScriptTag({ path: MODULE });
    await seed();
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The shipped datasets: empty, unverified, and silent ────────────────

  test('both shipped datasets load, and both declare themselves unverified', async () => {
    const r = await page.evaluate(async () => {
      const out = await codeIpcBoot();
      return {
        out,
        ipc: (() => { const s = codeSet('ipc', '2021'); return s && { verified: s.verified, by: s.verifiedBy, at: s.verifiedAt, fam: s.data.family }; })(),
        upc: (() => { const s = codeSet('upc', '2024'); return s && { verified: s.verified, by: s.verifiedBy, at: s.verifiedAt, fam: s.data.family }; })()
      };
    });
    expect(r.out.map(x => x.ok)).toEqual([true, true]);
    expect(r.ipc.verified, 'an LLM drafted this shape, nobody has checked the values').toBe(false);
    expect(r.upc.verified).toBe(false);
    expect(r.ipc.by).toBe('');
    expect(r.ipc.fam).toBe('ipc');
    expect(r.upc.fam).toBe('upc');
  });

  test('there is not one number in either shipped file: every value slot is null', async () => {
    const r = await page.evaluate(() => {
      const scan = (node, at, found) => {
        if (node === null) return found;
        if (Array.isArray(node)) { node.forEach((x, i) => scan(x, at + '[' + i + ']', found)); return found; }
        if (typeof node === 'object') { Object.keys(node).forEach(k => scan(node[k], at + '.' + k, found)); return found; }
        if (typeof node === 'number') found.push(at + ' = ' + node);
        return found;
      };
      const groups = ['fixtures', 'dfu', 'drain', 'vent', 'water', 'waterHeater', 'shapes'];
      const one = (fam, ed) => {
        const d = codeSet(fam, ed).data;
        const found = [];
        groups.forEach(g => scan(d[g], fam + '.' + g, found));
        return found;
      };
      return { ipc: one('ipc', '2021'), upc: one('upc', '2024') };
    });
    expect(r.ipc, 'a value here that nobody typed out of the book is the worst thing this product could ship').toEqual([]);
    expect(r.upc).toEqual([]);
  });

  test('each shipped file names exactly which tables a human still has to fill', async () => {
    const r = await page.evaluate(() => {
      const one = (fam, ed) => {
        const d = codeSet(fam, ed).data;
        return {
          todo: d.todo.length,
          mentionsDfu: d.todo.join(' ').indexOf('drainage fixture units') >= 0,
          sources: Object.keys(d.sources).map(k => d.sources[k]),
          hasLookup: !!(d.lookup && d.lookup.publisher)
        };
      };
      return { ipc: one('ipc', '2021'), upc: one('upc', '2024') };
    });
    expect(r.ipc.todo).toBeGreaterThan(5);
    expect(r.ipc.mentionsDfu).toBe(true);
    expect(r.ipc.sources.every(x => x === null), 'nothing was filled, so nothing has a source').toBe(true);
    expect(r.ipc.hasLookup, 'where the human should go looking').toBe(true);
    expect(r.upc.todo).toBeGreaterThan(5);
    expect(r.upc.sources.every(x => x === null)).toBe(true);
  });

  test('every rule on a shipped dataset returns no value at all', async () => {
    const r = await page.evaluate(() => {
      const inputs = {
        'dfu-total': { fixtures: [{ type: 'bathtub', qty: 1 }] },
        'drain-size': { dfu: 20, kind: 'branch' },
        'vent-size': { dfu: 20, drainSizeIn: 3, developedLengthFt: 40 },
        'wsfu-total': { fixtures: [{ type: 'bathtub', qty: 1 }] },
        'water-service-size': { wsfu: 20, pressurePsi: 50, developedLengthFt: 80 },
        'water-heater-relief': { closedSystem: true, systemVolumeGal: 50, supplyPsi: 60, reliefSetPsi: 150, incomingTempF: 50, setpointTempF: 130 }
      };
      const out = {};
      codeIpcRuleIds().forEach(id => {
        out[id] = ['ipc', 'upc'].map(fam => {
          const r = codeEval(fam, id, inputs[id], { edition: fam === 'ipc' ? '2021' : '2024' });
          return { ok: r.ok, reason: r.reason, value: r.value, warn: r.warnings.join(' ') };
        });
      });
      return out;
    });
    Object.keys(r).forEach(id => {
      r[id].forEach(x => {
        expect(x.ok, id + ' must refuse').toBe(false);
        expect(x.reason, id).toBe('unverified');
        expect(x.value, id + ' must not return a number, not even a hedged one').toBe(null);
      });
    });
    expect(r['dfu-total'][0].warn).toContain('has not been checked');
  });

  test('the gate cannot be talked around from the plumbing side either', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 }, verified: true }, { edition: '2021' }),
      codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }, { edition: '2021', verified: true, force: true }),
      codeEval('upc', 'dfu-total', { fixtures: { bathtub: 1 } }, { edition: '2024', force: true })
    ].map(x => ({ ok: x.ok, value: x.value, reason: x.reason })));
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.value).toBe(null); expect(x.reason).toBe('unverified'); });
  });

  // ── 2. The wall between the two books ─────────────────────────────────────

  test('the same house totals differently under each book, and each answer says which book', async () => {
    const r = await page.evaluate(() => {
      const house = { fixtures: [{ type: 'bathtub', qty: 2 }, { type: 'lavatory', qty: 3 }] };
      return { ipc: codeEval('ipc', 'dfu-total', house), upc: codeEval('upc', 'dfu-total', house) };
    });
    expect(r.ipc.value, '2 tubs at 11 plus 3 lavs at 5').toBe(37);
    expect(r.upc.value, 'the same house, the other book: 2 at 77 plus 3 at 9').toBe(181);
    expect(r.ipc.family).toBe('ipc');
    expect(r.ipc.edition).toBe('test-ipc');
    expect(r.upc.family).toBe('upc');
    expect(r.upc.edition).toBe('test-upc');
    expect(r.ipc.cite).toBe('FAKEIPC T1');
    expect(r.upc.cite, 'a citation is read out of the dataset, so it cannot come from the other book').toBe('FAKEUPC T1');
  });

  test('IPC rules handed UPC data refuse instead of computing', async () => {
    const r = await page.evaluate(() => {
      // The exact mislabelling this design is built against: the right rules,
      // the wrong book, registered under a family that lies.
      codeRegister({
        family: 'ipc', edition: 'crossed', verified: true,
        data: codeSet('upc', 'test-upc').data,
        rules: _plumbRulesFor('ipc')
      });
      const out = codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }, { edition: 'crossed' });
      // And the mirror image.
      codeRegister({
        family: 'upc', edition: 'crossed', verified: true,
        data: codeSet('ipc', 'test-ipc').data,
        rules: _plumbRulesFor('upc')
      });
      const back = codeEval('upc', 'drain-size', { dfu: 5 }, { edition: 'crossed' });
      return { out, back };
    });
    expect(r.out.ok).toBe(false);
    expect(r.out.reason).toBe('family-mismatch');
    expect(r.out.value, 'not 77, not 11, nothing').toBe(null);
    expect(r.out.warnings.join(' ')).toContain('different fixture units');
    expect(r.back.ok).toBe(false);
    expect(r.back.reason).toBe('family-mismatch');
    expect(r.back.value).toBe(null);
  });

  test('every rule refuses a crossed dataset, not just the ones that read fixtures', async () => {
    const r = await page.evaluate(() => {
      const inputs = {
        'dfu-total': { fixtures: { bathtub: 1 } },
        'drain-size': { dfu: 5 },
        'vent-size': { dfu: 5, drainSizeIn: 2, developedLengthFt: 10 },
        'wsfu-total': { fixtures: { bathtub: 1 } },
        'water-service-size': { wsfu: 1, pressurePsi: 40, developedLengthFt: 30 },
        'water-heater-relief': { closedSystem: false }
      };
      return codeIpcRuleIds().map(id => {
        const x = codeEval('ipc', id, inputs[id], { edition: 'crossed' });
        return { id, ok: x.ok, reason: x.reason, value: x.value };
      });
    });
    r.forEach(x => {
      expect(x.ok, x.id).toBe(false);
      expect(x.reason, x.id).toBe('family-mismatch');
      expect(x.value, x.id).toBe(null);
    });
  });

  test('a dataset is registered under the family written inside it, never one a caller picks', async () => {
    const r = await page.evaluate(() => {
      const upcJson = JSON.parse(JSON.stringify(codeSet('upc', 'test-upc').data));
      upcJson.edition = 'sneaky';
      // There is no family argument to get wrong: the file says what it is.
      const reg = codeIpcRegister(upcJson);
      return {
        reg,
        landedUnderIpc: !!codeSet('ipc', 'sneaky'),
        landedUnderUpc: !!codeSet('upc', 'sneaky')
      };
    });
    expect(r.reg.family, 'the file said upc, so upc it is').toBe('upc');
    expect(r.landedUnderIpc).toBe(false);
    expect(r.landedUnderUpc).toBe(true);
  });

  test('a caller cannot smuggle a family in through the inputs', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total',
      { fixtures: { bathtub: 1 }, codeFamily: 'upc', family: 'upc' }));
    expect(r.value, 'the IPC bathtub, whatever the caller wrote in the inputs').toBe(11);
    expect(r.inputs.codeFamily, 'the record shows the book the number actually came from').toBe('ipc');
    expect(r.family).toBe('ipc');
  });

  test('a jurisdiction on one book gets nothing from the other', async () => {
    const r = await page.evaluate(() => {
      const keep = S.codeEditions;
      S.codeEditions = { ipc: 'test-ipc' };          // an IPC jurisdiction
      const asked = codeEval('upc', 'dfu-total', { fixtures: { bathtub: 1 } });
      S.codeEditions = keep;
      return asked;
    });
    expect(r.ok).toBe(false);
    expect(r.reason, 'no UPC edition on file for this account, so no UPC answer').toBe('no-edition');
    expect(r.value).toBe(null);
  });

  test('the module itself contains no code value and no section number', async () => {
    const src = require('fs').readFileSync(MODULE, 'utf8');
    // Citation strings live in the datasets. If one ever appears here, it can
    // be printed under the wrong book's number.
    expect(src.match(/\b(IPC|UPC)\s+\d/g), 'a section reference belongs in the dataset, not in the rules').toBe(null);
    // The tell-tale of a hand-written table: a bare list of pipe sizes.
    expect(src).not.toMatch(/\[\s*1\.25\s*,\s*1\.5\s*,\s*2\s*,/);
  });

  test('a loaded dataset cannot be edited at runtime', async () => {
    const r = await page.evaluate(() => {
      const d = codeSet('ipc', 'test-ipc').data;
      const before = d.fixtures.bathtub.dfu.private;
      try { d.fixtures.bathtub.dfu.private = 999; } catch (e) { /* strict mode would throw */ }
      try { d.fixtures.newthing = { dfu: { private: 1 } }; } catch (e) { /* */ }
      return { before, after: d.fixtures.bathtub.dfu.private, added: !!d.fixtures.newthing, frozen: Object.isFrozen(d) };
    });
    expect(r.frozen).toBe(true);
    expect(r.after, 'a code value that can be patched in place is not a record of anything').toBe(r.before);
    expect(r.added).toBe(false);
  });

  test('registering junk is refused, and never half-stored', async () => {
    const r = await page.evaluate(() => ({
      nul: codeIpcRegister(null),
      empty: codeIpcRegister({}),
      str: codeIpcRegister('a file'),
      wrongFamily: codeIpcRegister({ schema: 'td-plumb-1', family: 'nec', edition: '2023' }),
      wrongSchema: codeIpcRegister({ schema: 'something-else', family: 'ipc', edition: '2021' }),
      noEdition: codeIpcRegister({ schema: 'td-plumb-1', family: 'ipc' })
    }));
    expect(r.nul.ok).toBe(false);
    expect(r.empty.ok).toBe(false);
    expect(r.str.ok).toBe(false);
    expect(r.wrongFamily.reason, 'this module owns plumbing, not the electrical book').toBe('unknown-family');
    expect(r.wrongSchema.reason).toBe('schema-mismatch');
    expect(r.noEdition.reason).toBe('no-edition');
  });

  // ── 3a. Fixture unit totals ───────────────────────────────────────────────

  test('a total is fixtures times counts, and says it assumed a dwelling', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1, lavatory: 2 } }));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(21);
    expect(r.unit).toBe('dfu');
    expect(r.inputs.fixtureCount).toBe(3);
    expect(r.assumed.join(' '), 'a default he never saw is the failure mode with our name on it').toContain('treated as private');
    expect(r.items, 'a fixture unit total does not put anything on the truck').toEqual([]);
  });

  test('public occupancy reads the public column and is not assumed', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total', { fixtures: { lavatory: 1 }, use: 'public' }));
    expect(r.value, 'the public column, 6, not the private 5').toBe(6);
    expect(r.assumed).toEqual([]);
  });

  test('a fixture in the catalogue with no value on file returns nothing, not zero', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1, 'shower-stall': 1 } }));
    expect(r.ok, 'Number(null) is 0, and a house totalled as zero fixture units is the bug this catches').toBe(false);
    expect(r.reason).toBe('missing-value');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' ')).toContain('Shower stall');
  });

  test('"toilet" is refused because the two kinds are not the same load', async () => {
    const r = await page.evaluate(() => ({
      vague: codeEval('ipc', 'dfu-total', { fixtures: { toilet: 1 } }),
      named: codeEval('ipc', 'dfu-total', { fixtures: { 'water-closet-tank': 1 } }),
      other: codeEval('ipc', 'dfu-total', { fixtures: { 'water-closet-flushometer': 1 } })
    }));
    expect(r.vague.ok).toBe(false);
    expect(r.vague.reason).toBe('ambiguous-fixture');
    expect(r.vague.value).toBe(null);
    expect(r.vague.warnings.join(' ')).toContain('water-closet-flushometer');
    expect(r.named.value).toBe(40);
    expect(r.other.value, 'the other kind, and it is not the same number').toBe(80);
  });

  test('a synonym that cannot change the value is accepted', async () => {
    const r = await page.evaluate(() => ['tub', 'Bath Tub', 'BATHTUB', 'lav', 'bathroom sink']
      .map(n => codeEval('ipc', 'dfu-total', { fixtures: [{ type: n, qty: 1 }] }).value));
    expect(r).toEqual([11, 11, 11, 5, 5]);
  });

  test('a fixture nobody has heard of is refused, never skipped', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1, 'koi pond': 1 } }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown-fixture');
    expect(r.value, 'a total missing a fixture looks exactly like a correct one').toBe(null);
    expect(r.warnings.join(' ')).toContain('koi pond');
  });

  test('a junk count is refused rather than silently treated as one', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'dfu-total', { fixtures: [{ type: 'bathtub', qty: -2 }] }),
      codeEval('ipc', 'dfu-total', { fixtures: [{ type: 'bathtub', qty: 'two' }] }),
      codeEval('ipc', 'dfu-total', { fixtures: [{ type: 'bathtub', qty: 0 }] })
    ].map(x => ({ ok: x.ok, reason: x.reason, value: x.value })));
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.reason).toBe('bad-input'); expect(x.value).toBe(null); });
  });

  test('both list shapes are accepted and agree', async () => {
    const r = await page.evaluate(() => ({
      arr: codeEval('ipc', 'dfu-total', { fixtures: [{ type: 'bathtub', qty: 2 }] }).value,
      map: codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 2 } }).value,
      bare: codeEval('ipc', 'dfu-total', { fixtures: ['bathtub', 'bathtub'] }).value
    }));
    expect(r.arr).toBe(22);
    expect(r.map).toBe(22);
    expect(r.bare).toBe(22);
  });

  test('an empty fixture list is a refusal, not a total of zero', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'dfu-total', { fixtures: [] }),
      codeEval('ipc', 'dfu-total', { fixtures: {} }),
      codeEval('ipc', 'dfu-total', {})
    ].map(x => ({ ok: x.ok, reason: x.reason, value: x.value })));
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.reason).toBe('no-fixtures'); expect(x.value).toBe(null); });
  });

  test('continuous flow converts at the rate on file, and refuses without it', async () => {
    const r = await page.evaluate(() => {
      const withRate = codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 }, continuousFlowGpm: 3 });
      const upc = codeEval('upc', 'dfu-total', { fixtures: { bathtub: 1 }, continuousFlowGpm: 3 });
      return { withRate, upc };
    });
    expect(r.withRate.value, '11 plus 3 gpm at 2 per gpm').toBe(17);
    expect(r.upc.value, 'the other book converts at a different rate too: 77 plus 3 at 4').toBe(89);
  });

  test('an unrecognised occupancy word is refused rather than defaulted', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 }, use: 'commercialish' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-input');
    expect(r.value).toBe(null);
  });

  // ── 3b. Drain sizing ──────────────────────────────────────────────────────

  test('a branch takes the smallest listed size that carries the load', async () => {
    const r = await page.evaluate(() => ({
      exact: codeEval('ipc', 'drain-size', { dfu: 10 }),
      over: codeEval('ipc', 'drain-size', { dfu: 11, kind: 'branch' }),
      big: codeEval('ipc', 'drain-size', { dfu: 101, kind: 'branch' })
    }));
    expect(r.exact.value, 'a load exactly at the capacity stays on that size').toBe(2);
    expect(r.exact.unit).toBe('in');
    expect(r.over.value).toBe(3);
    expect(r.big.value).toBe(4);
    expect(r.exact.assumed.join(' ')).toContain('horizontal fixture branch');
  });

  test('the two books size the same load differently', async () => {
    const r = await page.evaluate(() => ({
      ipc: codeEval('ipc', 'drain-size', { dfu: 15, kind: 'branch' }).value,
      upc: codeEval('upc', 'drain-size', { dfu: 15, kind: 'branch' }).value
    }));
    expect(r.ipc).toBe(3);
    expect(r.upc, 'this table carries 20 on a 2 inch, so the same load lands a size smaller').toBe(2);
  });

  test('past the top of the table is a refusal, not the largest size', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'drain-size', { dfu: 999999, kind: 'branch' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('over-table');
    expect(r.value, 'off the top of the table means ask a pro, not "use a 4 inch"').toBe(null);
    expect(r.warnings.join(' ')).toContain('engineer');
  });

  test('a building drain will not be sized without a slope', async () => {
    const r = await page.evaluate(() => ({
      none: codeEval('ipc', 'drain-size', { dfu: 50, kind: 'building-drain' }),
      eighth: codeEval('ipc', 'drain-size', { dfu: 50, kind: 'building-drain', slopeInPerFt: 0.125 }),
      quarter: codeEval('ipc', 'drain-size', { dfu: 4000, kind: 'building-drain', slopeInPerFt: 0.25 }),
      unlisted: codeEval('ipc', 'drain-size', { dfu: 50, kind: 'building-drain', slopeInPerFt: 0.5 })
    }));
    expect(r.none.ok, 'a flatter run carries less, so picking the slope for him is how a drain ends up undersized').toBe(false);
    expect(r.none.reason).toBe('need-slope');
    expect(r.none.value).toBe(null);
    expect(r.eighth.value).toBe(3);
    expect(r.quarter.value).toBe(3);
    expect(r.unlisted.ok, 'a slope the table does not carry is a missing column, not a nearby one').toBe(false);
    expect(r.unlisted.reason).toBe('missing-value');
  });

  test('a run carrying a water closet is raised to the minimum, and says so', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'drain-size', { dfu: 2, kind: 'branch', waterClosets: 1 }));
    expect(r.value).toBe(3);
    expect(r.assumed.join(' ')).toContain('water closet');
  });

  test('a stack respects both its limits: the total and any one branch interval', async () => {
    const r = await page.evaluate(() => ({
      total: codeEval('ipc', 'drain-size', { dfu: 90, kind: 'stack' }),
      spread: codeEval('ipc', 'drain-size', { dfu: 90, kind: 'stack', branchIntervals: 3 }),
      tight: codeEval('ipc', 'drain-size', { dfu: 90, kind: 'stack', branchIntervals: 1 })
    }));
    expect(r.total.value, '90 fits a 3 inch on the total column').toBe(3);
    expect(r.spread.value, '90 over 3 intervals is 30 on each, past what a 3 inch takes from one interval').toBe(4);
    expect(r.tight.value).toBe(3);
    expect(r.spread.assumed.join(' ')).toContain('branch intervals');
  });

  test('a pipe line only appears when the length is known, and it carries no price', async () => {
    const r = await page.evaluate(() => ({
      withLen: codeEval('ipc', 'drain-size', { dfu: 10, kind: 'branch', lengthFt: 24 }),
      without: codeEval('ipc', 'drain-size', { dfu: 10, kind: 'branch' })
    }));
    expect(r.without.items, 'we do not invent a length so a line can exist').toEqual([]);
    expect(r.withLen.items.length).toBe(1);
    expect(r.withLen.items[0].qty).toBe(24);
    expect(r.withLen.items[0].unit).toBe('ft');
    expect(r.withLen.items[0].label).toContain('2 in');
    expect(r.withLen.items[0].why).toContain('10 dfu');
    expect(r.withLen.items[0].price, 'the code says what is needed, never what it costs').toBe(undefined);
    expect(r.withLen.items[0].rate).toBe(undefined);
  });

  test('a load that is not a number is refused, and an unknown run type too', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'drain-size', {}),
      codeEval('ipc', 'drain-size', { dfu: 'lots' }),
      codeEval('ipc', 'drain-size', { dfu: -5 }),
      codeEval('ipc', 'drain-size', { dfu: NaN }),
      codeEval('ipc', 'drain-size', { dfu: 10, kind: 'sideways' })
    ].map(x => ({ ok: x.ok, reason: x.reason, value: x.value })));
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.reason).toBe('bad-input'); expect(x.value).toBe(null); });
  });

  test('a zero load is a real question and gets the smallest listed size', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'drain-size', { dfu: 0, kind: 'branch' }));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(2);
  });

  test('a half-filled table refuses: the smallest that fits cannot be read off a blank column', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('ipc', 'test-ipc').data));
      d.edition = 'holey';
      d.drain.horizontalBranch[0].maxDfu = null;      // the 2 inch row is blank
      codeIpcRegister(d);
      return codeEval('ipc', 'drain-size', { dfu: 50, kind: 'branch' }, { edition: 'holey' });
    });
    expect(r.ok, 'the 3 inch would fit, but the blank 2 inch row might have too').toBe(false);
    expect(r.reason).toBe('missing-value');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' ')).toContain('type that table in');
  });

  // ── 3c. Vent sizing ───────────────────────────────────────────────────────

  test('a vent is sized off its load, its drain and its length, and needs all three', async () => {
    const r = await page.evaluate(() => ({
      good: codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 2, developedLengthFt: 15 }),
      longer: codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 2, developedLengthFt: 90 }),
      noLen: codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 2 }),
      noDrain: codeEval('ipc', 'vent-size', { dfu: 5, developedLengthFt: 15 })
    }));
    expect(r.good.value).toBe(1.25);
    expect(r.good.unit).toBe('in');
    expect(r.longer.value, 'a longer run needs a bigger vent, which is the whole point of the table').toBe(1.5);
    expect(r.noLen.ok).toBe(false);
    expect(r.noLen.reason).toBe('need-more');
    expect(r.noLen.warnings.join(' ')).toContain('developed length');
    expect(r.noDrain.ok).toBe(false);
  });

  test('a vent is never smaller than half its drain', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 3, developedLengthFt: 20 }));
    expect(r.value, 'the 1.5 column reaches 30 ft, and half of a 3 inch drain is 1.5').toBe(1.5);
  });

  test('a length past the table is refused, and so is a drain size it does not carry', async () => {
    const r = await page.evaluate(() => ({
      farTooLong: codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 2, developedLengthFt: 9000 }),
      noRow: codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 6, developedLengthFt: 20 }),
      tooMuch: codeEval('ipc', 'vent-size', { dfu: 5000, drainSizeIn: 2, developedLengthFt: 20 })
    }));
    Object.keys(r).forEach(k => {
      expect(r[k].ok, k).toBe(false);
      expect(r[k].reason, k).toBe('over-table');
      expect(r[k].value, k).toBe(null);
    });
  });

  test('the vent line carries the length that was actually given', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'vent-size', { dfu: 5, drainSizeIn: 2, developedLengthFt: 15 }));
    expect(r.items.length).toBe(1);
    expect(r.items[0]).toEqual({ label: 'Vent pipe, 1.25 in', qty: 15, unit: 'ft', why: '5 dfu at 15 ft developed length' });
  });

  // ── 3d. Water supply ──────────────────────────────────────────────────────

  test('supply fixture units total off the supply column, not the drainage one', async () => {
    const r = await page.evaluate(() => ({
      ipc: codeEval('ipc', 'wsfu-total', { fixtures: { bathtub: 1, lavatory: 1 } }),
      upc: codeEval('upc', 'wsfu-total', { fixtures: { bathtub: 1, lavatory: 1 } })
    }));
    expect(r.ipc.value, '3 plus 7, and nothing to do with the 11 and 5 on the drainage side').toBe(10);
    expect(r.ipc.unit).toBe('wsfu');
    expect(r.upc.value).toBe(16);
    expect(r.ipc.assumed.join(' ')).toContain('combined');
  });

  test('the cold and hot sides are separate questions', async () => {
    const r = await page.evaluate(() => ({
      cold: codeEval('ipc', 'wsfu-total', { fixtures: { bathtub: 2 }, which: 'cold' }).value,
      hot: codeEval('ipc', 'wsfu-total', { fixtures: { bathtub: 2 }, which: 'hot' }).value,
      total: codeEval('ipc', 'wsfu-total', { fixtures: { bathtub: 2 }, which: 'total' }).value,
      junk: codeEval('ipc', 'wsfu-total', { fixtures: { bathtub: 2 }, which: 'lukewarm' })
    }));
    expect(r.cold).toBe(2);
    expect(r.hot).toBe(2);
    expect(r.total).toBe(6);
    expect(r.junk.ok).toBe(false);
    expect(r.junk.reason).toBe('bad-input');
  });

  test('the service is sized by pressure band, then length column, then load', async () => {
    const r = await page.evaluate(() => ({
      small: codeEval('ipc', 'water-service-size', { wsfu: 2, pressurePsi: 40, developedLengthFt: 40 }),
      bigger: codeEval('ipc', 'water-service-size', { wsfu: 50, pressurePsi: 40, developedLengthFt: 40 }),
      higherPressure: codeEval('ipc', 'water-service-size', { wsfu: 4, pressurePsi: 50, developedLengthFt: 40 })
    }));
    expect(r.small.value).toBe(0.75);
    expect(r.small.unit).toBe('in');
    expect(r.bigger.value, '50 does not fit the 3/4 at this pressure and length').toBe(1);
    expect(r.higherPressure.value, 'the same house on a better street pressure').toBe(0.75);
  });

  test('the length column used is the first one at or past the actual run, and it is declared', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'water-service-size', { wsfu: 3, pressurePsi: 40, developedLengthFt: 70 }));
    expect(r.inputs.lengthColumnFt).toBe(100);
    expect(r.assumed.join(' ')).toContain('100 ft column');
    expect(r.value).toBe(0.75);
  });

  test('pressure and length are never guessed', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'water-service-size', { wsfu: 10 }),
      codeEval('ipc', 'water-service-size', { wsfu: 10, pressurePsi: 40 }),
      codeEval('ipc', 'water-service-size', { wsfu: 10, developedLengthFt: 40 }),
      codeEval('ipc', 'water-service-size', {})
    ].map(x => ({ ok: x.ok, reason: x.reason, value: x.value, w: x.warnings.join(' ') })));
    r.forEach(x => { expect(x.ok).toBe(false); expect(x.reason).toBe('need-more'); expect(x.value).toBe(null); });
    expect(r[0].w).toContain('pressure');
    expect(r[1].w).toContain('developed length');
  });

  test('a pressure outside every band is refused, and so is a run past the table', async () => {
    const r = await page.evaluate(() => ({
      low: codeEval('ipc', 'water-service-size', { wsfu: 2, pressurePsi: 12, developedLengthFt: 40 }),
      high: codeEval('ipc', 'water-service-size', { wsfu: 2, pressurePsi: 200, developedLengthFt: 40 }),
      far: codeEval('ipc', 'water-service-size', { wsfu: 2, pressurePsi: 40, developedLengthFt: 5000 }),
      heavy: codeEval('ipc', 'water-service-size', { wsfu: 99999, pressurePsi: 40, developedLengthFt: 40 })
    }));
    Object.keys(r).forEach(k => {
      expect(r[k].ok, k).toBe(false);
      expect(r[k].reason, k).toBe('over-table');
      expect(r[k].value, k).toBe(null);
    });
    expect(r.low.warnings.join(' ')).toContain('booster');
  });

  test('the service result puts the pipe, the main and the meter on the job, unpriced', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'water-service-size', { wsfu: 2, pressurePsi: 40, developedLengthFt: 40 }));
    const labels = r.items.map(i => i.label);
    expect(labels[0]).toContain('Water service pipe');
    expect(r.items[0].qty).toBe(40);
    expect(labels.join(' ')).toContain('Water distribution main');
    expect(labels.join(' ')).toContain('Water meter');
    r.items.forEach(i => {
      expect(i.price).toBe(undefined);
      expect(Object.keys(i).sort()).toEqual(['label', 'qty', 'unit', 'why']);
    });
  });

  // ── 3e. Thermal expansion on a closed system ──────────────────────────────

  test('it will not answer until it knows whether the system is closed', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'water-heater-relief', { heaterType: 'tankless' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('need-more');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' ')).toContain('check valve');
  });

  test('an open system needs no expansion tank, and says on whose word', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'water-heater-relief', { closedSystem: false, heaterType: 'tank' }));
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
    expect(r.unit).toBe('gal');
    expect(r.items).toEqual([]);
    expect(r.warnings.join(' ')).toContain('backflow preventer');
  });

  test('the heater is not what sizes the tank, and the rule says exactly what is', async () => {
    const r = await page.evaluate(() => ['tank', 'tankless', 'boiler'].map(t =>
      codeEval('ipc', 'water-heater-relief', { closedSystem: true, heaterType: t })));
    r.forEach(x => {
      expect(x.ok, 'btu does not size an expansion tank').toBe(false);
      expect(x.reason).toBe('need-more');
      expect(x.value).toBe(null);
      const w = x.warnings.join(' ');
      expect(w).toContain('volume');
      expect(w).toContain('supply pressure');
      expect(w).toContain('relief valve setting');
      expect(w).toContain('incoming cold water temperature');
      expect(w).toContain('setpoint');
    });
    expect(r[1].warnings.join(' '), 'a tankless holds almost nothing itself, so the question is the piping').toContain('piping');
  });

  test('nonsense pressures and temperatures are caught before anything is computed', async () => {
    const full = { closedSystem: true, heaterType: 'tank', systemVolumeGal: 50, supplyPsi: 60, reliefSetPsi: 150, incomingTempF: 50, setpointTempF: 130 };
    const r = await page.evaluate((full) => ({
      reliefLow: codeEval('ipc', 'water-heater-relief', Object.assign({}, full, { reliefSetPsi: 40 })),
      coldSet: codeEval('ipc', 'water-heater-relief', Object.assign({}, full, { setpointTempF: 40 })),
      badType: codeEval('ipc', 'water-heater-relief', Object.assign({}, full, { heaterType: 'magic' }))
    }), full);
    Object.keys(r).forEach(k => {
      expect(r[k].ok, k).toBe(false);
      expect(r[k].reason, k).toBe('bad-input');
      expect(r[k].value, k).toBe(null);
    });
    expect(r.reliefLow.warnings.join(' ')).toContain('no room for expansion');
  });

  test('with every input in hand it still refuses, because the sizing method is not on file', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'water-heater-relief', {
      closedSystem: true, heaterType: 'tank', systemVolumeGal: 50,
      supplyPsi: 60, reliefSetPsi: 150, incomingTempF: 50, setpointTempF: 130
    }));
    expect(r.ok, 'a plausible tank size either weeps the relief nightly or does nothing, and both look fine on the invoice').toBe(false);
    expect(r.reason).toBe('missing-value');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' ')).toContain('expansion sizing method');
  });

  test('naming a method does not conjure the arithmetic for it', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('ipc', 'test-ipc').data));
      d.edition = 'method-named';
      d.waterHeater.expansion.method = 'acceptance-factor';
      d.waterHeater.expansion.waterExpansionFactorByTempF = { '130': 0.0175 };
      codeIpcRegister(d);
      return codeEval('ipc', 'water-heater-relief', {
        closedSystem: true, heaterType: 'tank', systemVolumeGal: 50,
        supplyPsi: 60, reliefSetPsi: 150, incomingTempF: 50, setpointTempF: 130
      }, { edition: 'method-named' });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-value');
    expect(r.value).toBe(null);
    expect(r.warnings.join(' '), 'the arithmetic gets written against the worked example that comes with the method').toContain('acceptance-factor');
  });

  // ── 4. The §11.1 input classes ────────────────────────────────────────────

  test('null, undefined, empty and junk arguments never throw, and never produce a number', async () => {
    const r = await page.evaluate(() => {
      const junk = [null, undefined, {}, [], '', 'a string', 0, 42, NaN, Infinity, -1, true,
        { fixtures: null }, { fixtures: 'bathtub' }, { fixtures: 7 }, { dfu: Number.MAX_SAFE_INTEGER },
        { dfu: Number.MIN_SAFE_INTEGER }, { fixtures: [null, undefined, {}, 'bathtub'] }];
      const out = [];
      codeIpcRuleIds().forEach(id => {
        ['ipc', 'upc'].forEach(fam => {
          junk.forEach((j, n) => {
            try {
              const x = codeEval(fam, id, j);
              out.push({ id, fam, n, threw: false, ok: x.ok, value: x.value, isNum: typeof x.value === 'number' });
            } catch (e) {
              out.push({ id, fam, n, threw: true, err: String(e) });
            }
          });
        });
      });
      return out;
    });
    r.forEach(x => expect(x.threw, x.id + ' #' + x.n).toBe(false));
    r.filter(x => !x.ok).forEach(x => expect(x.value, x.id + ' #' + x.n + ' refused but returned a value').toBe(null));
  });

  test('a rule is pure: the same question gets the same answer twenty-five times', async () => {
    const same = await page.evaluate(() => {
      const runs = [];
      for (let i = 0; i < 25; i++) {
        runs.push(JSON.stringify([
          codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 2, lavatory: 1 } }),
          codeEval('ipc', 'drain-size', { dfu: 37, kind: 'branch', lengthFt: 12 }),
          codeEval('upc', 'wsfu-total', { fixtures: { bathtub: 1 } })
        ]));
      }
      return runs.every(x => x === runs[0]);
    });
    expect(same).toBe(true);
  });

  test('thirty concurrent calls across both books do not bleed into each other', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 30; i++) {
        out.push(codeEval(i % 2 ? 'upc' : 'ipc', 'dfu-total', { fixtures: { bathtub: 1 } }));
      }
      return {
        ipc: out.filter((_, i) => !(i % 2)).every(x => x.value === 11 && x.family === 'ipc'),
        upc: out.filter((_, i) => i % 2).every(x => x.value === 77 && x.family === 'upc')
      };
    });
    expect(r.ipc).toBe(true);
    expect(r.upc).toBe(true);
  });

  test('a refusal leaves nothing behind: the next good call is unaffected', async () => {
    const r = await page.evaluate(() => {
      const before = codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }).value;
      codeEval('ipc', 'dfu-total', { fixtures: { 'koi pond': 1 } });
      codeEval('ipc', 'drain-size', { dfu: 'lots' });
      codeEval('ipc', 'water-heater-relief', {});
      codeEval('ipc', 'dfu-total', null);
      const after = codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }).value;
      return { before, after };
    });
    expect(r.after).toBe(r.before);
    expect(r.after).toBe(11);
  });

  test('an unknown rule id on a plumbing family is refused', async () => {
    const r = await page.evaluate(() => codeEval('ipc', 'sprinkler-density', { dfu: 1 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-rule');
    expect(r.value).toBe(null);
  });

  test('every rule id the module advertises actually exists on both families', async () => {
    const r = await page.evaluate(() => {
      const ids = codeIpcRuleIds();
      return {
        ids,
        families: codeIpcFamilies(),
        missing: ids.filter(id => ['ipc', 'upc'].some(f =>
          codeEval(f, id, {}).reason === 'no-rule'))
      };
    });
    expect(r.ids.sort()).toEqual(['dfu-total', 'drain-size', 'vent-size', 'water-heater-relief', 'water-service-size', 'wsfu-total']);
    expect(r.families.sort()).toEqual(['ipc', 'upc']);
    expect(r.missing).toEqual([]);
  });

  test('every result carries its book, its edition and its citation, refusals included', async () => {
    const r = await page.evaluate(() => [
      codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }),
      codeEval('upc', 'drain-size', { dfu: 5 }),
      codeEval('ipc', 'vent-size', { dfu: 5 })
    ]);
    r.forEach(x => {
      expect(['ipc', 'upc']).toContain(x.family);
      expect(x.edition).toMatch(/^test-/);
      expect(Array.isArray(x.assumed)).toBe(true);
      expect(Array.isArray(x.warnings)).toBe(true);
      expect(Array.isArray(x.items)).toBe(true);
    });
    expect(r[0].cite).toBe('FAKEIPC T1');
    expect(r[1].cite).toBe('FAKEUPC T2');
  });

  test('a dataset with no citations on file still answers, but says the reference is missing', async () => {
    const r = await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(codeSet('ipc', 'test-ipc').data));
      d.edition = 'nocites'; d.cites = {};
      codeIpcRegister(d);
      return codeEval('ipc', 'dfu-total', { fixtures: { bathtub: 1 } }, { edition: 'nocites' });
    });
    expect(r.ok).toBe(true);
    expect(r.cite).toBe('');
    expect(r.warnings.join(' ')).toContain('No section reference');
  });

  // ── 5. The real numbers, waiting on a human with the book ─────────────────
  //
  // These are the tests that will actually prove correctness, and they cannot
  // be written from memory. Each needs a worked example out of the purchased
  // edition, typed in by the person who flips verified:true. Until then they
  // are recorded here so the gap is visible rather than forgotten.

  test.fixme('IPC 2021: a published worked example totals to the published answer', async () => {
    // NEEDS A HUMAN: a worked fixture-unit example from the 2021 IPC (the
    // commentary or the appendix), its fixture list and its printed total.
    // Fill codes/ipc-2021.json fixtures[*].dfu first.
  });

  test.fixme('UPC 2024: the same house totals to the UPC answer, and it is a different number', async () => {
    // NEEDS A HUMAN: the same fixture list under the 2024 UPC with its own
    // printed total. This is the test that proves the divergence is real and
    // that we carry both, rather than one dressed up as two.
  });

  test.fixme('IPC 2021: building drain sizing matches the table at 1/8 and 1/4 slope', async () => {
    // NEEDS A HUMAN: two rows of the building drain table, one at each slope,
    // with the fixture unit load that sits just under and just over the break.
  });

  test.fixme('IPC 2021: vent sizing matches the table at the maximum developed length', async () => {
    // NEEDS A HUMAN: one row of the vent table: drain size, load, vent size,
    // and the maximum length printed for it.
  });

  test.fixme('expansion tank sizing matches a manufacturer worked example', async () => {
    // NEEDS A HUMAN: the sizing method the code or the listed standard names,
    // plus one worked example (system volume, supply pressure, relief setting,
    // temperature rise, and the tank the example arrives at). The arithmetic
    // gets written against that example, not before it.
  });

  test('no console errors', async () => {
    assertNoErrors(page);
  });
});
