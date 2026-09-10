// @ts-check
/**
 * The sizing estimate (js/loadcalc.js).
 *
 * What this file is really guarding, in order of how badly it would hurt:
 *
 *  1. THE DISCLAIMER CANNOT COME OFF. Every result, including every refusal,
 *     carries the not-for-permit line, and no argument, flag or key removes
 *     it. If somebody adds an option that suppresses it, this file goes red.
 *  2. THE NAME STAYS OFF THE PRODUCT. The industry's standard residential
 *     procedure is a registered trademark and its approved software is
 *     licensed by name. We hold no such licence, so the served module is
 *     scanned, character by character, for that name and for any claim of
 *     permit acceptability. Physics is legal; the trademark is not ours.
 *  3. IT IS PURE. Same input, same answer, forever. The estimate is proved
 *     against worked arithmetic below, and a function that reads a clock or
 *     the DOM cannot be proved against anything.
 *  4. NOTHING UNSOURCED IS PRESENTED AS FACT. Every envelope number in the
 *     table is a placeholder today and every one of them has to reach the
 *     `assumed` list saying so.
 *  5. THE GEOMETRY IS THE SCAN'S. One geometry model (js/scan.js), consumed,
 *     never a second one. Including the part scan.js does not answer: which
 *     walls face outside.
 *
 * Sanity vectors. The three transmission vectors below are the standard
 * Q = A x U x dT arithmetic taken from a published worked example
 * (https://pexuniverse.com/calculate-heat-loss: 0.07 x 138 x 77 = 744,
 * 0.65 x 14 x 77 = 701, 0.05 x 352 x 77 = 1355). They verify OUR ARITHMETIC,
 * not anybody's assumptions: the U-values and areas are handed in by the test.
 * Tolerance is +/- 1 BTU/h, which is rounding and nothing else. A whole-house
 * end-to-end vector needs a real certified calculation to check against and
 * nobody has supplied one, so it is a test.fixme at the bottom naming exactly
 * what a human has to produce.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// A two-room ranch, in the shape js/scan.js's parser emits: metres, y-up, the
// plan on the x/z plane. Rooms are 4 m x 4 m side by side, so the wall at x=4
// is shared and must come out INTERIOR, and the six walls around the outside
// must come out exterior. One window on an outside wall, one on the shared
// wall (which must be ignored: an interior wall has no exterior glass).
const twoRoomScan = () => {
  const wall = (ax, az, bx, bz, extra) => Object.assign({
    id: ax + ',' + az + '-' + bx + ',' + bz,
    ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az), h: 2.5, ey: 1.25,
    doors: [], windows: []
  }, extra || {});
  return {
    id: 'scan-lc-1', clientId: 77001, name: 'Ranch',
    rooms: [
      {
        label: 'Living room', story: 1, floorM2: 16, wallM2: 40, openM2: 4, winM2: 4,
        perimM: 16, hM: 2.5, doorN: 0, winN: 2,
        walls: [
          wall(0, 0, 4, 0, { windows: [{ w: 1.4, h: 1.43, area: 2, kind: 'window', off: 2 }] }),
          wall(4, 0, 4, 4, { windows: [{ w: 1.4, h: 1.43, area: 2, kind: 'window', off: 2 }] }),
          wall(4, 4, 0, 4),
          wall(0, 4, 0, 0)
        ]
      },
      {
        label: 'Bedroom', story: 1, floorM2: 16, wallM2: 40, openM2: 0, winM2: 0,
        perimM: 16, hM: 2.5, doorN: 0, winN: 0,
        walls: [
          wall(4, 0, 8, 0),
          wall(8, 0, 8, 4),
          wall(8, 4, 4, 4),
          wall(4, 4, 4, 0)
        ]
      }
    ]
  };
};

// A bare-bones geometry object, so a vector can isolate one assembly at a time.
const boxGeo = (over) => Object.assign({
  ok: true, source: 'scan',
  conditionedSqFt: 1000, volumeFt3: 0,
  exteriorWallSqFt: 0, windowSqFt: 0, doorSqFt: 0, ceilingSqFt: 0, floorSqFt: 0,
  storyCount: 1, bedrooms: 0, exteriorWallCount: 4, interiorWallCount: 0,
  rooms: [], notes: []
}, over || {});

// dT of 77 F: -7 outside, 70 inside. Matches the worked example's delta.
const DESIGN_77 = { heatDB: -7, coolDB: 95, indoorHeatDB: 70, indoorCoolDB: 75, coolGrainsDiff: 30 };

const goodInput = (over) => Object.assign({
  sqFt: 2000, storyCount: 1, ceilingHeightFt: 8,
  design: DESIGN_77,
  envelope: { vintage: '1980-1999', zone: 5 },
  occupants: 4, foundation: 'slab', ductLocation: 'conditioned'
}, over || {});

test.describe('sizing estimate', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    // index.html loads this module now, so injecting it again redeclares its
    // top-level consts and throws a SyntaxError into the page. Inject only when
    // the app has not already provided it, the same guard the NEC spec carries
    // for the same reason.
    if (!await page.evaluate(() => typeof window.loadcalcEstimate === 'function')) {
      await page.addScriptTag({ url: '/js/loadcalc.js' });
    }
    await page.waitForFunction(() => typeof window.loadcalcEstimate === 'function');
  });
  test.afterAll(async () => { await page.context().close(); });

  // ── 1. The disclaimer cannot come off ──────────────────────────────────────

  test('every good result leads with the not-for-permit line', async () => {
    const r = await page.evaluate((i) => {
      const out = loadcalcEstimate(i);
      return { ok: out.ok, first: out.warnings[0], not: LOADCALC_NOT_FOR_PERMIT };
    }, goodInput());
    expect(r.ok).toBe(true);
    expect(r.first).toBe(r.not);
    expect(r.first).toContain('not for permit');
  });

  test('every refusal carries it too, not just the answers', async () => {
    const rows = await page.evaluate((good) => {
      const cases = {
        nothing: {},
        noGeometry: { design: { heatDB: 0, coolDB: 95 }, envelope: { vintage: '1980-1999' } },
        noDesign: { sqFt: 2000, envelope: { vintage: '1980-1999' } },
        noEnvelope: { sqFt: 2000, design: { heatDB: 0, coolDB: 95 } },
        badVintage: Object.assign({}, good, { envelope: { vintage: 'not a vintage' } }),
        noScan: null
      };
      const out = {};
      Object.keys(cases).forEach(k => {
        const res = cases[k] === null ? loadcalcFromScan('nope') : loadcalcEstimate(cases[k]);
        out[k] = { ok: res.ok, reason: res.reason, first: res.warnings[0], value: res.value };
      });
      return out;
    }, goodInput());
    Object.keys(rows).forEach(k => {
      expect(rows[k].ok, k + ' must refuse').toBe(false);
      expect(rows[k].first, k + ' must still carry the disclaimer').toContain('not for permit');
      expect(rows[k].value, k + ' must not hand back a number').toBe(null);
    });
    expect(rows.nothing.reason).toBe('no-geometry');
    expect(rows.noDesign.reason).toBe('no-design-temps');
    expect(rows.noEnvelope.reason).toBe('no-envelope');
    expect(rows.badVintage.reason).toBe('no-envelope');
    expect(rows.noScan.reason).toBe('no-scan');
  });

  test('nothing you can pass in suppresses it', async () => {
    const r = await page.evaluate((good) => {
      const tries = [
        Object.assign({}, good, { warnings: [] }),
        Object.assign({}, good, { warnings: ['mine only'] }),
        Object.assign({}, good, { suppressWarnings: true }),
        Object.assign({}, good, { notForPermit: false }),
        Object.assign({}, good, { permitReady: true, certified: true, disclaimer: false })
      ];
      return tries.map(t => {
        const out = loadcalcEstimate(t);
        return { first: out.warnings[0], has: out.warnings.indexOf(LOADCALC_NOT_FOR_PERMIT) === 0 };
      });
    }, goodInput());
    r.forEach((x, i) => {
      expect(x.has, 'attempt ' + i + ' to switch the disclaimer off').toBe(true);
      expect(x.first).toContain('not for permit');
    });
  });

  test('mutating one result\'s warnings cannot poison the next one', async () => {
    const r = await page.evaluate((good) => {
      const a = loadcalcEstimate(good);
      a.warnings.length = 0;                      // a caller vandalising the array
      LOADCALC_ENVELOPES._probe = true;
      const b = loadcalcEstimate(good);
      return { a: a.warnings.length, b: b.warnings[0] };
    }, goodInput());
    expect(r.a).toBe(0);
    expect(r.b).toContain('not for permit');
  });

  // ── 2. The name stays off the product ──────────────────────────────────────

  test('the served module does not contain the trademarked name, in any casing', async () => {
    const hits = await page.evaluate(async () => {
      const src = await (await fetch('/js/loadcalc.js')).text();
      const bad = [/manual\s*-?\s*j/i, /manual\s*-?\s*s\b/i, /manual\s*-?\s*d\b/i];
      return { len: src.length, hits: bad.map(re => (src.match(re) || [])[0] || null) };
    });
    expect(hits.len, 'the module actually loaded').toBeGreaterThan(1000);
    hits.hits.forEach(h => expect(h, 'trademarked procedure name found in the module').toBe(null));
  });

  test('nothing the module emits claims permit acceptability or certification', async () => {
    const words = await page.evaluate((good) => {
      const r = loadcalcEstimate(good);
      const text = [].concat(r.warnings, r.assumed, r.items.map(i => i.label + ' ' + i.why)).join(' | ');
      return {
        text,
        // "certified" is allowed to appear, but only ever pointing AWAY from
        // this output: "not a certified calculation", "have a certified
        // calculation run". What must never appear is this output calling
        // ITSELF certified, approved or permit-ready.
        claims: [
          /manual\s*-?\s*j/i.test(text),
          /permit[- ]ready/i.test(text),
          /code[- ]compliant/i.test(text),
          /approved by/i.test(text),
          /certified (sizing )?estimate/i.test(text),
          /this .{0,30}\bis (certified|approved|acceptable)/i.test(text)
        ]
      };
    }, goodInput());
    words.claims.forEach((c, i) => expect(c, 'claim pattern ' + i + ' present in output text').toBe(false));
    expect(words.text).toContain('not for permit');
  });

  test('the user-facing wording is a sizing estimate, and it says what it is not', async () => {
    const r = await page.evaluate((good) => loadcalcEstimate(good), goodInput());
    expect(r.family).toBe('loadcalc');
    expect(r.unit).toBe('BTU/h');
    const permitItem = r.items.find(i => /certified load calculation/i.test(i.label));
    expect(permitItem, 'the estimate itself sells the real calculation').toBeTruthy();
    expect(permitItem.why).toContain('not a permit document');
    expect(permitItem).not.toHaveProperty('price');
    expect(permitItem).not.toHaveProperty('rate');
  });

  // ── 3. The result shape is code-engine.js's ────────────────────────────────

  test('a result carries value, inputs, assumed, warnings and items, on both paths', async () => {
    const r = await page.evaluate((good) => {
      const shape = o => Object.keys(o).sort();
      return { good: shape(loadcalcEstimate(good)), bad: shape(loadcalcEstimate(null)) };
    }, goodInput());
    ['ok', 'reason', 'value', 'unit', 'inputs', 'family', 'edition', 'cite', 'assumed', 'items', 'warnings']
      .forEach(k => {
        expect(r.good, 'ok result missing ' + k).toContain(k);
        expect(r.bad, 'refusal missing ' + k).toContain(k);
      });
  });

  test('items are estimate lines, never prices', async () => {
    const items = await page.evaluate((good) => loadcalcEstimate(good).items, goodInput());
    expect(items.length).toBeGreaterThan(0);
    items.forEach(i => {
      expect(Object.keys(i).sort()).toEqual(['label', 'qty', 'unit', 'why']);
      expect(typeof i.label).toBe('string');
      expect(typeof i.why, 'every line explains itself').toBe('string');
      expect(i.why.length).toBeGreaterThan(10);
      expect(JSON.stringify(i)).not.toMatch(/\$/);
    });
  });

  // ── 4. Design temperatures: the licensing gate ─────────────────────────────

  test('no design temperatures, no answer: it refuses instead of guessing', async () => {
    const r = await page.evaluate(() => {
      const out = loadcalcEstimate({ sqFt: 2000, envelope: { vintage: '1980-1999' } });
      return { ok: out.ok, reason: out.reason, why: out.warnings.join(' ') };
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-design-temps');
    expect(r.why).toContain('licensed');
    expect(r.why, 'it tells him the two ways out').toMatch(/enter the winter and summer design temperatures/i);
  });

  test('half a design condition is still no design condition', async () => {
    const r = await page.evaluate(() => ['heatDB', 'coolDB'].map(k => {
      const design = {}; design[k] = 50;
      return loadcalcEstimate({ sqFt: 2000, design, envelope: { vintage: '1980-1999' } }).reason;
    }));
    expect(r).toEqual(['no-design-temps', 'no-design-temps']);
  });

  test('the lookup ships empty and says why, and refuses rather than returning zero', async () => {
    const r = await page.evaluate(() => {
      loadcalcClearDesignTemps();
      const out = loadcalcDesignLookup('67202');
      return { ok: out.ok, reason: out.reason, note: out.note, sets: loadcalcDesignSets().length,
        licensed: LOADCALC_SOURCES['ashrae-169'].status, typedIn: LOADCALC_SOURCES['ashrae-169'].typedIn };
    });
    expect(r.sets).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-design-data');
    expect(r.note).toContain('licensed');
    expect(r.licensed, 'the source map records that this data is not ours to ship').toBe('licensed');
    expect(r.typedIn).toBe(false);
  });

  test('a dataset can be dropped in later and the lookup starts answering', async () => {
    const r = await page.evaluate(() => {
      loadcalcClearDesignTemps();
      loadcalcRegisterDesignTemps({
        id: 'test-set', source: 'computed from NOAA NCEI hourly records', verified: true,
        byKey: { '67202': { heatDB: 6, coolDB: 99, coolWB: 74 } }
      });
      const hit = loadcalcDesignLookup('67202');
      const miss = loadcalcDesignLookup('00000');
      loadcalcClearDesignTemps();
      const after = loadcalcDesignLookup('67202');
      return { hit, miss: miss.reason, after: after.reason, gone: loadcalcDesignSets().length };
    });
    expect(r.hit.ok).toBe(true);
    expect(r.hit.design.heatDB).toBe(6);
    expect(r.hit.source).toContain('NOAA');
    expect(r.miss).toBe('no-design-match');
    expect(r.after).toBe('no-design-data');
    expect(r.gone).toBe(0);
  });

  test('an unverified dataset is skipped, exactly like a code dataset would be', async () => {
    const r = await page.evaluate(() => {
      loadcalcClearDesignTemps();
      loadcalcRegisterDesignTemps({ id: 'draft', verified: false, byKey: { x: { heatDB: 1, coolDB: 2 } } });
      const out = loadcalcDesignLookup('x');
      loadcalcClearDesignTemps();
      return out.reason;
    });
    expect(r).toBe('no-design-match');
  });

  test('a dataset whose lookup throws does not take the estimate down with it', async () => {
    const r = await page.evaluate(() => {
      loadcalcClearDesignTemps();
      loadcalcRegisterDesignTemps({ id: 'boom', verified: true, lookup: () => { throw new Error('nope'); } });
      const out = loadcalcDesignLookup('x');
      loadcalcClearDesignTemps();
      return out.reason;
    });
    expect(r).toBe('no-design-match');
  });

  test('hand-entered design temperatures are recorded as hand-entered', async () => {
    const a = await page.evaluate((good) => loadcalcEstimate(good).assumed.join(' | '), goodInput());
    expect(a).toMatch(/entered by hand/i);
    expect(a).toContain('-7 F winter');
    const b = await page.evaluate((good) => loadcalcEstimate(good).assumed.join(' | '),
      goodInput({ design: Object.assign({}, DESIGN_77, { source: 'computed from NOAA NCEI' }) }));
    expect(b).toContain('Design temperatures from: computed from NOAA NCEI');
  });

  // ── 5. Nothing unsourced is presented as fact ──────────────────────────────

  test('the envelope table is unverified and every value in it is flagged', async () => {
    const r = await page.evaluate(() => {
      const t = LOADCALC_ENVELOPES;
      const flat = [];
      Object.keys(t.vintages).forEach(vk => {
        const v = t.vintages[vk];
        ['wallR', 'ceilR', 'floorR', 'windowU', 'windowSHGC', 'doorU', 'ach50'].forEach(k => {
          flat.push({ vk, k, ph: v[k] && v[k].ph, src: v[k] && v[k].src, v: v[k] && v[k].v });
        });
        Object.keys(v.byZone || {}).forEach(b => Object.keys(v.byZone[b]).forEach(k => {
          flat.push({ vk: vk + '/' + b, k, ph: v.byZone[b][k].ph, src: v.byZone[b][k].src, v: v.byZone[b][k].v });
        }));
      });
      return { verified: t.verified, by: t.verifiedBy, flat, srcIds: Object.keys(LOADCALC_SOURCES) };
    });
    expect(r.verified, 'no human has checked this table').toBe(false);
    expect(r.by).toBe('');
    expect(r.flat.length).toBeGreaterThan(30);
    r.flat.forEach(f => {
      expect(f.ph, f.vk + '.' + f.k + ' must be flagged as a placeholder').toBe(true);
      expect(f.src, f.vk + '.' + f.k + ' must name a source').toBeTruthy();
      expect(r.srcIds, f.vk + '.' + f.k + ' names an unknown source ' + f.src).toContain(f.src);
      expect(typeof f.v, f.vk + '.' + f.k + ' must be usable arithmetic').toBe('number');
    });
  });

  test('every placeholder the estimate actually used reaches the assumed list', async () => {
    const r = await page.evaluate((good) => {
      const out = loadcalcEstimate(good);
      return { assumed: out.assumed, warnings: out.warnings, sources: Object.keys(out.sources) };
    }, goodInput());
    const joined = r.assumed.join(' | ');
    ['Wall assembly R', 'Ceiling assembly R', 'Window U-factor', 'Blower-door air changes'].forEach(k => {
      expect(joined, k + ' never printed').toContain(k);
    });
    const placeholders = r.assumed.filter(a => a.indexOf('PLACEHOLDER') === 0);
    expect(placeholders.length, 'the placeholders announce themselves').toBeGreaterThanOrEqual(5);
    expect(r.warnings.join(' ')).toMatch(/every envelope number below is a placeholder/i);
    expect(r.sources, 'the result carries the map of where the numbers must come from').toContain('doe-ba-hsp');
  });

  test('a value the contractor supplied is not reported as an assumption', async () => {
    const r = await page.evaluate((good) => {
      const out = loadcalcEstimate(good);
      return out.assumed.join(' | ');
    }, goodInput({ envelope: { vintage: '1980-1999', zone: 5, overrides: { wallR: 21, ach50: 3.2 } } }));
    expect(r).not.toMatch(/Wall assembly R assumed/);
    expect(r, 'a measured blower-door number is worth calling out').toContain('3.2 ACH50');
  });

  test('the source map is honest about which sources are ours to ship', async () => {
    const r = await page.evaluate(() => Object.keys(LOADCALC_SOURCES).map(k => ({
      k, status: LOADCALC_SOURCES[k].status, typedIn: LOADCALC_SOURCES[k].typedIn
    })));
    r.forEach(s => {
      expect(['physics', 'public', 'licensed', 'unsourced'], s.k + ' has an unknown status').toContain(s.status);
      if (s.status === 'licensed' || s.status === 'unsourced') {
        expect(s.typedIn, s.k + ' is licensed or unsourced and must not be marked typed in').toBe(false);
      }
    });
    expect(r.find(x => x.k === 'ashrae-169').status).toBe('licensed');
    expect(r.find(x => x.k === 'noaa-ncei').status).toBe('public');
    expect(r.find(x => x.k === 'nrel-tmy3').status).toBe('public');
    expect(r.find(x => x.k === 'doe-ba-hsp').status).toBe('public');
    expect(r.find(x => x.k === 'air-props').status).toBe('physics');
  });

  test('the climate zone band changes the envelope, and says which band it used', async () => {
    const r = await page.evaluate((good) => {
      const hot = loadcalcEstimate(Object.assign({}, good, { envelope: { vintage: '2010-plus', zone: 1 } }));
      const cold = loadcalcEstimate(Object.assign({}, good, { envelope: { vintage: '2010-plus', zone: 8 } }));
      const none = loadcalcEstimate(Object.assign({}, good, { envelope: { vintage: '2010-plus' } }));
      const junk = loadcalcEstimate(Object.assign({}, good, { envelope: { vintage: '2010-plus', zone: 42 } }));
      return {
        hotCeil: hot.detail.uFactors.ceiling, coldCeil: cold.detail.uFactors.ceiling,
        hotBand: hot.inputs.envelope.band, coldBand: cold.inputs.envelope.band,
        noneBand: none.inputs.envelope.band, noneSaid: none.assumed.join(' | '),
        junkOk: junk.ok, junkWarn: junk.warnings.join(' ')
      };
    }, goodInput());
    expect(r.hotBand).toBe('1-2');
    expect(r.coldBand).toBe('7-8');
    expect(r.coldCeil, 'a cold-zone ceiling loses less per sq ft').toBeLessThan(r.hotCeil);
    expect(r.noneBand).toBe(null);
    expect(r.noneSaid).toContain('no climate zone given');
    expect(r.junkOk, 'a nonsense zone is a warning, not a refusal').toBe(true);
    expect(r.junkWarn).toContain('not one of the eight zones');
  });

  // ── 6. Sanity vectors: the arithmetic, checked ─────────────────────────────
  // Q = A x U x dT, against a published worked example. Tolerance +/- 1 BTU/h,
  // which is rounding to whole BTU and nothing more.

  test('vector: wall transmission, 0.07 x 138 sq ft x 77 F = 744 BTU/h', async () => {
    const q = await page.evaluate(({ geo, design }) => loadcalcEstimate({
      geometry: geo, design,
      envelope: { vintage: 'pre-1960', overrides: { wallR: 1 / 0.07, ach50: 0 } },
      foundation: 'slab', ductLocation: 'conditioned', occupants: 2
    }).detail.loads.heatingEnvelopeBtuh,
    { geo: boxGeo({ exteriorWallSqFt: 138 }), design: DESIGN_77 });
    expect(Math.abs(q - 744), 'got ' + q).toBeLessThanOrEqual(1);
  });

  test('vector: window transmission, 0.65 x 14 sq ft x 77 F = 701 BTU/h', async () => {
    const q = await page.evaluate(({ geo, design }) => loadcalcEstimate({
      geometry: geo, design,
      envelope: { vintage: 'pre-1960', overrides: { windowU: 0.65, ach50: 0 } },
      foundation: 'slab', ductLocation: 'conditioned', occupants: 2
    }).detail.loads.heatingEnvelopeBtuh,
    { geo: boxGeo({ windowSqFt: 14 }), design: DESIGN_77 });
    expect(Math.abs(q - 701), 'got ' + q).toBeLessThanOrEqual(1);
  });

  test('vector: ceiling transmission, 0.05 x 352 sq ft x 77 F = 1355 BTU/h', async () => {
    const q = await page.evaluate(({ geo, design }) => loadcalcEstimate({
      geometry: geo, design,
      envelope: { vintage: 'pre-1960', overrides: { ceilR: 1 / 0.05, ach50: 0 } },
      foundation: 'slab', ductLocation: 'conditioned', occupants: 2
    }).detail.loads.heatingEnvelopeBtuh,
    { geo: boxGeo({ ceilingSqFt: 352 }), design: DESIGN_77 });
    expect(Math.abs(q - 1355), 'got ' + q).toBeLessThanOrEqual(1);
  });

  test('the air-side constants are derived from the stated air properties, not remembered', async () => {
    const r = await page.evaluate(() => {
      const p = LOADCALC_PHYS;
      return {
        sens: p.minPerHour * p.airDensityLbFt3 * p.airCpBtuLbF,
        lat: p.minPerHour * p.airDensityLbFt3 * (p.hfgBtuLb / p.grainsPerLb),
        ton: p.btuhPerTon
      };
    });
    expect(r.sens).toBeCloseTo(1.08, 6);
    expect(r.lat).toBeCloseTo(0.682, 3);
    expect(r.ton).toBe(12000);
  });

  test('vector: infiltration, 10,000 ft3 at 10 ACH50 over a divisor of 20 = 6,930 BTU/h', async () => {
    // 10/20 = 0.5 natural air changes; 0.5 x 10000 / 60 = 83.33 CFM;
    // 1.08 x 83.33 x 77 = 6,930.
    const q = await page.evaluate(({ geo, design }) => loadcalcEstimate({
      geometry: geo, design,
      envelope: { vintage: 'pre-1960', overrides: { ach50: 10, nFactor: 20, wallR: 1e9, ceilR: 1e9 } },
      foundation: 'slab', ductLocation: 'conditioned', occupants: 2
    }).detail.loads.heatingInfiltrationBtuh,
    { geo: boxGeo({ volumeFt3: 10000 }), design: DESIGN_77 });
    expect(Math.abs(q - 6930), 'got ' + q).toBeLessThanOrEqual(1);
  });

  test('the duct penalty multiplies the whole load, and names itself', async () => {
    const r = await page.evaluate(({ geo, design }) => {
      const mk = loc => loadcalcEstimate({
        geometry: geo, design, envelope: { vintage: 'pre-1960', overrides: { wallR: 10, ach50: 0 } },
        foundation: 'slab', ductLocation: loc, occupants: 2
      });
      const inside = mk('conditioned'), attic = mk('attic');
      return { inside: inside.value.heatingBtuh, attic: attic.value.heatingBtuh,
        said: attic.assumed.join(' | '), mult: attic.detail.loads.ductMultiplier };
    }, { geo: boxGeo({ exteriorWallSqFt: 1000 }), design: DESIGN_77 });
    expect(r.attic).toBe(Math.round(r.inside * r.mult));
    expect(r.mult).toBe(1.25);
    expect(r.said).toContain('PLACEHOLDER');
    expect(r.said).toContain('Ducts in a vented attic');
  });

  test('the equipment range is nominal sizes around the load, and heating is an OUTPUT', async () => {
    const r = await page.evaluate((good) => loadcalcEstimate(good).value, goodInput());
    expect(r.coolingTotalBtuh).toBe(r.coolingSensibleBtuh + r.coolingLatentBtuh);
    const eq = r.equipment;
    expect(eq.coolingTonsLow * 12000, 'the low size covers the load').toBeGreaterThanOrEqual(r.coolingTotalBtuh);
    expect(eq.coolingTonsHigh, 'the range is one nominal step').toBeGreaterThan(eq.coolingTonsLow);
    expect(eq.heatingOutputLowBtuh).toBe(r.heatingBtuh);
    expect(eq.heatingRangeNote).toMatch(/output/i);
    expect(eq.heatingRangeNote).toMatch(/efficiency/i);
  });

  test('a load bigger than the largest single unit says so instead of inventing a size', async () => {
    const r = await page.evaluate(({ geo, design }) => {
      const out = loadcalcEstimate({
        geometry: geo, design,
        envelope: { vintage: 'pre-1960', overrides: { wallR: 0.5, ach50: 40 } },
        foundation: 'slab', ductLocation: 'attic', occupants: 20
      });
      return { low: out.value.equipment.coolingTonsLow, warn: out.warnings.join(' ') };
    }, { geo: boxGeo({ exteriorWallSqFt: 40000, volumeFt3: 400000, conditionedSqFt: 40000 }), design: DESIGN_77 });
    expect(r.low).toBe(null);
    expect(r.warn).toMatch(/more than one system/i);
  });

  // ── 7. It is pure ──────────────────────────────────────────────────────────

  test('the compute path reads no clock, no DOM, no storage and no app state', async () => {
    const r = await page.evaluate(() => {
      // Strings and comments first. The module says "not a permit document."
      // in a warning, and scanning raw source for `document.` flags English
      // prose as a DOM read. What is being asserted is what the CODE touches.
      const strip = t => t
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
      const src = strip([loadcalcEstimate, loadcalcScanGeometry].map(f => f.toString()).join('\n'));
      return {
        clock: /Date\.now|new Date|performance\.now/.test(src),
        // Property ACCESS on the globals, not the words: `window:` and
        // `windowSqFt` are legitimate field names on a geometry object and an
        // earlier version of this regex flagged them.
        dom: /\b(document|window)\s*[.[]/.test(src),
        storage: /localStorage|sessionStorage|indexedDB/.test(src),
        net: /\bfetch\b|XMLHttpRequest|_supa\b/.test(src),
        rand: /Math\.random/.test(src),
        appState: /\bS\.[a-zA-Z]/.test(src),
        registry: /_LC_DESIGN_SETS/.test(src)
      };
    });
    Object.keys(r).forEach(k => expect(r[k], 'the pure path touches ' + k).toBe(false));
  });

  test('same input, same answer, ten times, with the clock moved underneath it', async () => {
    const r = await page.evaluate((good) => {
      const real = Date.now; let t = 0;
      Date.now = () => (t += 86400000);
      const outs = [];
      for (let i = 0; i < 10; i++) outs.push(JSON.stringify(loadcalcEstimate(good)));
      Date.now = real;
      return { same: outs.every(o => o === outs[0]), one: outs[0].length };
    }, goodInput());
    expect(r.same).toBe(true);
    expect(r.one).toBeGreaterThan(500);
  });

  test('it does not mutate the object it was handed', async () => {
    const r = await page.evaluate((good) => {
      const before = JSON.stringify(good);
      loadcalcEstimate(good);
      return { same: JSON.stringify(good) === before };
    }, goodInput());
    expect(r.same).toBe(true);
  });

  test('it runs with the DOM torn out from under it', async () => {
    const r = await page.evaluate((good) => {
      const keep = document.body.innerHTML;
      document.body.innerHTML = '';
      let out = null, threw = null;
      try { out = loadcalcEstimate(good); } catch (e) { threw = String(e); }
      document.body.innerHTML = keep;
      return { ok: out && out.ok, btu: out && out.value.heatingBtuh, threw };
    }, goodInput());
    expect(r.threw).toBe(null);
    expect(r.ok).toBe(true);
    expect(r.btu).toBeGreaterThan(0);
  });

  // ── 8. Input classes (§11.1) ───────────────────────────────────────────────

  test('null, undefined and no argument at all are refusals, not crashes', async () => {
    const r = await page.evaluate(() => [undefined, null, 0, '', false, NaN, [], 'string', 42, () => 1]
      .map(v => { try { const o = loadcalcEstimate(v); return o.ok + ':' + o.reason; } catch (e) { return 'THREW ' + e; } })
      .concat([(() => { try { const o = loadcalcEstimate(); return o.ok + ':' + o.reason; } catch (e) { return 'THREW ' + e; } })()]));
    r.forEach(x => expect(x, 'unexpected result ' + x).toBe('false:no-geometry'));
  });

  test('type mismatches on every numeric input are refused or ignored, never NaN', async () => {
    const r = await page.evaluate((good) => {
      const tries = [
        Object.assign({}, good, { sqFt: 'two thousand' }),
        Object.assign({}, good, { sqFt: {} }),
        Object.assign({}, good, { design: { heatDB: 'cold', coolDB: 'hot' } }),
        Object.assign({}, good, { design: { heatDB: null, coolDB: null } }),
        Object.assign({}, good, { occupants: 'four' }),
        Object.assign({}, good, { storyCount: 'two' }),
        Object.assign({}, good, { ceilingHeightFt: 'eight' }),
        Object.assign({}, good, { foundation: 999 }),
        Object.assign({}, good, { ductLocation: [] }),
        Object.assign({}, good, { envelope: 'old' }),
        Object.assign({}, good, { envelope: { vintage: '1980-1999', overrides: 'lots' } }),
        Object.assign({}, good, { envelope: { vintage: '1980-1999', overrides: { wallR: 'thirteen' } } })
      ];
      return tries.map(t => {
        try {
          const o = loadcalcEstimate(t);
          const s = JSON.stringify(o.value);
          return { ok: o.ok, reason: o.reason, nan: /null|NaN/.test(String(s)) && o.ok };
        } catch (e) { return { threw: String(e) }; }
      });
    }, goodInput());
    r.forEach((x, i) => {
      expect(x.threw, 'case ' + i + ' threw').toBeUndefined();
      if (x.ok) expect(x.nan, 'case ' + i + ' produced NaN or null inside a good answer').toBe(false);
    });
  });

  test('boundaries: zero, one, negative, and absurdly large', async () => {
    const r = await page.evaluate((good) => {
      const mk = over => { try { return loadcalcEstimate(Object.assign({}, good, over)); } catch (e) { return { threw: String(e) }; } };
      return {
        zero: mk({ sqFt: 0 }),
        one: mk({ sqFt: 1 }),
        negative: mk({ sqFt: -2000 }),
        huge: mk({ sqFt: Number.MAX_SAFE_INTEGER }),
        infinite: mk({ sqFt: Infinity }),
        noDelta: mk({ design: { heatDB: 70, coolDB: 75, indoorHeatDB: 70, indoorCoolDB: 75 } }),
        inverted: mk({ design: { heatDB: 100, coolDB: 20, indoorHeatDB: 70, indoorCoolDB: 75 } }),
        zeroOccupants: mk({ occupants: 0 }),
        manyOccupants: mk({ occupants: 1000 })
      };
    }, goodInput());
    expect(r.zero.reason).toBe('no-geometry');
    expect(r.negative.reason).toBe('no-geometry');
    expect(r.infinite.reason).toBe('no-geometry');
    expect(r.one.ok).toBe(true);
    expect(r.one.value.heatingBtuh).toBeGreaterThan(0);
    expect(r.huge.ok).toBe(true);
    expect(Number.isFinite(r.huge.value.heatingBtuh)).toBe(true);
    expect(r.noDelta.ok).toBe(true);
    expect(r.noDelta.value.heatingBtuh, 'no temperature difference, no transmission load').toBe(0);
    expect(r.noDelta.warnings.join(' ')).toMatch(/no heating load/i);
    expect(r.inverted.warnings.join(' ')).toMatch(/no heating load|no cooling load/i);
    expect(r.zeroOccupants.inputs.occupants, 'zero people is treated as not stated').toBe(4);
    expect(r.manyOccupants.value.coolingLatentBtuh).toBeGreaterThan(r.zeroOccupants.value.coolingLatentBtuh);
  });

  test('called concurrently a hundred times it stays deterministic and holds no state', async () => {
    const r = await page.evaluate(async (good) => {
      const jobs = [];
      for (let i = 0; i < 100; i++) {
        jobs.push(Promise.resolve().then(() => JSON.stringify(loadcalcEstimate(
          i % 2 ? good : Object.assign({}, good, { sqFt: 3000 })))));
      }
      const outs = await Promise.all(jobs);
      const a = outs.filter((_, i) => i % 2), b = outs.filter((_, i) => !(i % 2));
      return { aSame: a.every(x => x === a[0]), bSame: b.every(x => x === b[0]), differ: a[0] !== b[0] };
    }, goodInput());
    expect(r.aSame).toBe(true);
    expect(r.bSame).toBe(true);
    expect(r.differ, 'a bigger house is a bigger load').toBe(true);
  });

  test('after a refusal, the very next good call is unaffected', async () => {
    const r = await page.evaluate((good) => {
      const clean = JSON.stringify(loadcalcEstimate(good));
      loadcalcEstimate(null);
      loadcalcEstimate({ sqFt: 'x' });
      loadcalcEstimate({ envelope: { vintage: 'garbage' } });
      try { loadcalcEstimate(Object.defineProperty({}, 'geometry', { get() { throw new Error('boom'); } })); } catch (e) { /* the caller's problem, not ours */ }
      return { same: JSON.stringify(loadcalcEstimate(good)) === clean };
    }, goodInput());
    expect(r.same).toBe(true);
  });

  test('the module reads no localStorage, so corrupting it changes nothing', async () => {
    const r = await page.evaluate((good) => {
      const before = JSON.stringify(loadcalcEstimate(good));
      localStorage.setItem('zp3_loadcalc', '{INVALID JSON{{{{');
      localStorage.setItem('zp3_cloud_cache', '{{{{');
      const after = JSON.stringify(loadcalcEstimate(good));
      localStorage.removeItem('zp3_loadcalc');
      return before === after;
    }, goodInput());
    expect(r).toBe(true);
  });

  // ── 9. The scan is the geometry model ──────────────────────────────────────

  test('it consumes the scan record scan.js already produces, and finds the shared wall', async () => {
    const g = await page.evaluate((sc) => loadcalcScanGeometry(sc), twoRoomScan());
    expect(g.ok).toBe(true);
    expect(g.source).toBe('scan');
    expect(g.exteriorWallCount, 'six walls face out, two are the shared partition').toBe(6);
    expect(g.interiorWallCount).toBe(2);
    // 32 m2 of floor, 2.5 m ceilings.
    expect(g.conditionedSqFt).toBe(344);
    expect(g.volumeFt3).toBe(2825);
    // Six exterior walls of 4 m x 2.5 m, less the 2 m2 window that is on one
    // of them. The window on the SHARED wall is not exterior glass.
    expect(g.exteriorWallSqFt).toBe(624);
    expect(g.windowSqFt).toBe(22);
    expect(g.storyCount).toBe(1);
    expect(g.bedrooms, 'the room the contractor named Bedroom').toBe(1);
    expect(g.rooms.map(r => r.name)).toEqual(['Living room', 'Bedroom']);
  });

  test('it does not re-parse RoomPlan: hand it a raw capture and it declines', async () => {
    const r = await page.evaluate(() => [
      loadcalcScanGeometry(null),
      loadcalcScanGeometry({}),
      loadcalcScanGeometry({ rooms: [] }),
      loadcalcScanGeometry({ walls: [], doors: [], windows: [] })   // a raw CapturedRoom
    ].map(x => x.ok + ':' + x.reason));
    r.forEach(x => expect(x).toBe('false:no-rooms'));
  });

  test('a one-room scan says out loud that it cannot tell inside from outside', async () => {
    const r = await page.evaluate((sc) => {
      const one = Object.assign({}, sc, { rooms: [sc.rooms[0]] });
      const g = loadcalcScanGeometry(one);
      return { notes: g.notes.join(' '), ext: g.exteriorWallCount, intr: g.interiorWallCount };
    }, twoRoomScan());
    expect(r.ext).toBe(4);
    expect(r.intr).toBe(0);
    expect(r.notes).toMatch(/only one room was scanned/i);
    expect(r.notes).toMatch(/far too high/i);
  });

  test('a two-storey scan takes the ceiling off the top floor and the floor off the bottom', async () => {
    const r = await page.evaluate((sc) => {
      const up = JSON.parse(JSON.stringify(sc));
      up.rooms[1].story = 2;
      up.rooms[1].walls.forEach(w => { w.ax += 100; w.bx += 100; });   // stacked, not adjacent
      const g = loadcalcScanGeometry(up);
      return { c: g.ceilingSqFt, f: g.floorSqFt, s: g.storyCount, notes: g.notes.join(' '), extra: g.exteriorWallCount };
    }, twoRoomScan());
    expect(r.s).toBe(2);
    expect(r.c, 'floor 2 only').toBe(172);
    expect(r.f, 'floor 1 only').toBe(172);
    expect(r.extra, 'nothing shares a wall across floors').toBe(8);
    expect(r.notes).toMatch(/spans 2 floors/i);
  });

  test('the scan drives a full estimate, and the room split says what it is', async () => {
    const r = await page.evaluate(({ sc, design }) => {
      const g = loadcalcScanGeometry(sc);
      const out = loadcalcEstimate({ geometry: g, design, envelope: { vintage: '1960-1979', zone: 5 },
        foundation: 'vented-crawl', ductLocation: 'attic' });
      return { ok: out.ok, heat: out.value.heatingBtuh, rooms: out.detail.rooms,
        assumed: out.assumed.join(' | '), src: out.inputs.geometry.source,
        occ: out.inputs.occupants };
    }, { sc: twoRoomScan(), design: DESIGN_77 });
    expect(r.ok).toBe(true);
    expect(r.heat).toBeGreaterThan(0);
    expect(r.src).toBe('scan');
    expect(r.rooms.map(x => x.name)).toEqual(['Living room', 'Bedroom']);
    expect(r.rooms[0].heatingBtuh + r.rooms[1].heatingBtuh).toBeCloseTo(r.heat, -1);
    expect(r.assumed, 'never let anybody size a register off this').toMatch(/not room-by-room calculations/i);
    expect(r.occ, 'one bedroom in the scan, plus one').toBe(2);
  });

  test('no scan attached: square footage works, and every guess it made is listed', async () => {
    const r = await page.evaluate((good) => {
      const out = loadcalcEstimate(good);
      return { ok: out.ok, src: out.inputs.geometry.source, assumed: out.assumed.join(' | '),
        warn: out.warnings.join(' '), items: out.items.map(i => i.label) };
    }, goodInput());
    expect(r.ok).toBe(true);
    expect(r.src).toBe('sqft');
    expect(r.assumed).toMatch(/shape allowance/i);
    expect(r.assumed).toMatch(/glass at 15%/i);
    expect(r.assumed).toContain('PLACEHOLDER');
    expect(r.warn).toMatch(/A scan of the actual rooms replaces every one of those guesses/i);
    expect(r.items.join(' | '), 'and it offers to go measure').toMatch(/Measure the house/);
  });

  test('a measured blower-door number on the scan beats the vintage preset', async () => {
    const r = await page.evaluate(({ sc, design }) => {
      const list = [Object.assign({}, sc, { _ach50: 3.1 })];
      const keep = window.getScans;
      window.getScans = () => list;
      const out = loadcalcFromScan('scan-lc-1', { design, envelope: { vintage: 'pre-1960', zone: 5 } });
      const missing = loadcalcFromScan('not-a-scan', { design });
      window.getScans = keep;
      return { ach: out.detail.infiltration.ach50, ok: out.ok,
        said: out.assumed.join(' | '), missing: missing.reason,
        items: out.items.map(i => i.label).join(' | ') };
    }, { sc: twoRoomScan(), design: DESIGN_77 });
    expect(r.ok).toBe(true);
    expect(r.ach, 'the preset for pre-1960 is 18, the measured number is 3.1').toBe(3.1);
    expect(r.said).toContain('3.1 ACH50');
    expect(r.items, 'no need to sell a blower door test once one has been done').not.toMatch(/Blower door test/);
    expect(r.missing).toBe('no-scan');
  });

  test('loadcalcFromScan survives a store that throws instead of answering', async () => {
    const r = await page.evaluate(() => {
      const keep = window.getScans;
      window.getScans = () => { throw new Error('cloud is down'); };
      const a = loadcalcFromScan('scan-lc-1');
      window.getScans = undefined;
      const b = loadcalcFromScan('scan-lc-1');
      window.getScans = keep;
      return [a.reason + ':' + a.ok + ':' + a.warnings[0].slice(0, 17),
              b.reason + ':' + b.ok + ':' + b.warnings[0].slice(0, 17)];
    });
    r.forEach(x => expect(x).toBe('no-scan:false:Planning estimate'));
  });

  test('a scan with rubbish in the rooms array does not throw', async () => {
    const r = await page.evaluate(() => {
      const junk = { id: 'j', rooms: [null, {}, { walls: 'nope' }, { floorM2: 'x', walls: [{ len: 0 }] },
        { floorM2: 12, hM: 2.4, walls: [{ ax: 0, az: 0, bx: 3, bz: 0, len: 3, h: 2.4, windows: [{ area: 'x' }], doors: [{ area: null }] }] }] };
      try { const g = loadcalcScanGeometry(junk); return { ok: g.ok, sq: g.conditionedSqFt, w: g.exteriorWallSqFt }; }
      catch (e) { return { threw: String(e) }; }
    });
    expect(r.threw).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.sq)).toBe(true);
    expect(Number.isFinite(r.w)).toBe(true);
  });

  // ── 10. What a human still has to supply ───────────────────────────────────

  test.fixme('vector: a whole-house estimate against a certified calculation', async () => {
    // BLOCKED ON A HUMAN, deliberately, not on code.
    //
    // Every vector above proves the arithmetic. None of them prove the
    // ASSUMPTIONS, because the assumptions are placeholders (see the envelope
    // table) and there is no free reference case to check them against.
    //
    // To turn this on, somebody has to supply, from ONE real house:
    //   1. a certified room-by-room load calculation done by a third party,
    //      with its heating and cooling totals;
    //   2. that house's actual assemblies: wall, ceiling and floor R, window
    //      U and SHGC, and a measured blower-door ACH50;
    //   3. the design temperatures that calculation used, and their source;
    //   4. the duct location and the occupancy it assumed.
    // Then encode it here with a stated tolerance. Anything inside roughly
    // 15% is a pass for a planning estimate; outside that, the placeholders
    // in LOADCALC_ENVELOPES are the first suspects, not the arithmetic.
  });

  test.fixme('the envelope table matches the Building America defaults', async () => {
    // BLOCKED ON A HUMAN. LOADCALC_ENVELOPES is entirely placeholders today.
    // Somebody reads the DOE / NREL Building America House Simulation
    // Protocols (public, free, docs.nrel.gov/docs/fy11osti/49246.pdf) for the
    // pre-code vintages and the IECC prescriptive minimums for 2000 onward,
    // replaces each _lcPh with an _lcOk, and sets verified/verifiedBy/
    // verifiedAt. This test then asserts every value against what they typed
    // and the 'every value is a placeholder' test above is inverted.
  });

  test.fixme('design temperatures computed from public NOAA records', async () => {
    // BLOCKED ON A DATASET, and it is a build, not a lookup. The 99% / 1%
    // tables everyone quotes are licensed (LOADCALC_SOURCES['ashrae-169']),
    // so the route that is actually ours is to COMPUTE the percentiles from
    // NOAA NCEI hourly records, which are public domain, and ship that as a
    // registered dataset. When one exists, this test registers it, looks up a
    // real postcode, and asserts the estimate no longer refuses.
  });

  // ── Errors ─────────────────────────────────────────────────────────────────

  test('no console errors', async () => {
    assertNoErrors(page);
  });
});

// ── Which way the walls face ────────────────────────────────────────────────
//
// The residential load procedure resolves glass by compass direction, and
// until now the geometry
// pass collapsed every window in the house into one number. These tests pin
// the two halves separately, because only one of them is knowable from the
// code: which side of a wall is outdoors is geometry, and which direction that
// is on Earth depends on a compass convention that has never been checked
// against a real scan.

test.describe('sizing estimate: orientation', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    if (!await page.evaluate(() => typeof window.loadcalcScanGeometry === 'function')) {
      await page.addScriptTag({ url: '/js/loadcalc.js' });
    }
  });
  test.afterAll(async () => { await page.context().close(); });

  // A 4m x 4m box room, walls running clockwise, one window on each wall.
  // Scene axes: +x right, -z "forward". With no compass heading, a wall whose
  // outward normal points along -z is the zero bearing.
  // Both halves of the compass. headingDeg alone is the bearing the phone
  // faced when the compass was sampled; the scene's own zero was fixed two
  // seconds earlier, when the session started. Scene north is the difference,
  // so a fixture that supplies only one half is a scan with no usable compass,
  // which is exactly what the old-scan test below asserts.
  const BOX = (headingDeg, camYawDeg) => ({
    headingDeg: headingDeg,
    headingCamYawDeg: (camYawDeg === undefined ? 0 : camYawDeg),
    rooms: [{
      label: 'Box', story: 1, floorM2: 16, hM: 2.5, winM2: 4,
      poly: [[0, 0], [4, 0], [4, 4], [0, 4]],
      walls: [
        { ax: 0, az: 0, bx: 4, bz: 0, len: 4, h: 2.5, windows: [{ area: 1 }], doors: [] },
        { ax: 4, az: 0, bx: 4, bz: 4, len: 4, h: 2.5, windows: [{ area: 2 }], doors: [] },
        { ax: 4, az: 4, bx: 0, bz: 4, len: 4, h: 2.5, windows: [{ area: 3 }], doors: [] },
        { ax: 0, az: 4, bx: 0, bz: 0, len: 4, h: 2.5, windows: [{ area: 4 }], doors: [] }
      ]
    }]
  });

  test('every window lands on exactly one side and none go missing', async () => {
    const r = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    expect(r.ok).toBe(true);
    const dirs = Object.keys(r.byOrientation);
    expect(dirs.sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
    // 1 + 2 + 3 + 4 m2 of glass, and the split must conserve it.
    const split = dirs.reduce((t, k) => t + r.byOrientation[k].windowSqFt, 0);
    expect(Math.abs(split - r.windowSqFt)).toBeLessThanOrEqual(2);   // rounding only
    // Four walls, four directions, each used once.
    expect(dirs.filter(k => r.byOrientation[k].windowSqFt > 0).length).toBe(4);
  });

  test('opposite walls come out on opposite sides', async () => {
    const r = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    const at = area => Object.keys(r.byOrientation)
      .find(k => Math.abs(r.byOrientation[k].windowSqFt - Math.round(area * 10.7639)) <= 1);
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };
    // The 1 m2 window and the 3 m2 window are on facing walls of the box.
    expect(opposite[at(1)]).toBe(at(3));
    expect(opposite[at(2)]).toBe(at(4));
  });

  test('the compass rotates the whole house, it does not reshuffle it', async () => {
    const a = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    const b = await page.evaluate(x => loadcalcScanGeometry(x), BOX(90, 0));
    // A quarter turn moves every side by exactly two octants, so the sorted
    // list of areas is unchanged and only the labels move.
    const areas = o => Object.keys(o.byOrientation).map(k => o.byOrientation[k].windowSqFt).sort((x, y) => x - y);
    expect(areas(b)).toEqual(areas(a));
    const ring = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    ring.forEach((k, i) => {
      expect(b.byOrientation[ring[(i + 2) % 8]].windowSqFt).toBe(a.byOrientation[k].windowSqFt);
    });
  });

  test('a scan with no compass says so instead of inventing north', async () => {
    const r = await page.evaluate(b => loadcalcScanGeometry(b), BOX(undefined, undefined));
    expect(r.hasCompass).toBe(false);
    expect(r.notes.join(' ')).toMatch(/no usable compass/i);
    // The split is still produced, because it is still useful relative to the
    // scan; it just must not be read as north and south.
    expect(r.byOrientation).toBeTruthy();
  });

  test('the compass mapping is flagged unverified until a real scan checks it', async () => {
    const r = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    // Getting the sign backwards puts south glass on the north side and halves
    // a cooling load silently. It stays flagged until somebody scans a house
    // whose facing they know.
    expect(r.orientationUnverified).toBe(true);
    expect(r.notes.join(' ')).toMatch(/not been checked against a scan of a house whose facing is known/i);
  });

  test('each room carries its own eight sides', async () => {
    const r = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    const room = r.rooms[0];
    expect(Object.keys(room.byOrientation).sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
    // One room, so the room's split is the whole house's split.
    Object.keys(r.byOrientation).forEach(k => {
      expect(room.byOrientation[k].windowSqFt).toBe(r.byOrientation[k].windowSqFt);
    });
  });

  test('a wall with no length is counted in the totals but not given a direction', async () => {
    const bad = BOX(0, 0);
    bad.rooms[0].walls.push({ ax: 1, az: 1, bx: 1, bz: 1, len: 2, h: 2.5, windows: [{ area: 5 }], doors: [] });
    const r = await page.evaluate(b => loadcalcScanGeometry(b), bad);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/no usable direction/i);
    // It still contributes glass to the house total, so nothing is lost.
    expect(r.windowSqFt).toBeGreaterThan(
      Object.keys(r.byOrientation).reduce((t, k) => t + r.byOrientation[k].windowSqFt, 0));
  });

  test('a scan taken before the camera yaw was recorded is not believed', async () => {
    // The compass fix has two halves and old scans only carry one. Believing
    // the raw heading would put south glass on whichever side the phone
    // happened to be facing two seconds into the walk, which is worse than
    // saying nothing: it looks like an answer.
    const r = await page.evaluate(() => loadcalcScanGeometry({
      headingDeg: 137, rooms: [{ label: 'Old', story: 1, floorM2: 16, hM: 2.5, winM2: 1,
        poly: [[0,0],[4,0],[4,4],[0,4]],
        walls: [{ ax: 0, az: 0, bx: 4, bz: 0, len: 4, h: 2.5, windows: [{ area: 1 }], doors: [] }] }]
    }));
    expect(r.hasCompass).toBe(false);
    expect(r.notes.join(' ')).toMatch(/no usable compass/i);
  });

  test('the two halves subtract, so turning the phone before the read changes nothing', async () => {
    // Same house, same true north, two different moments of sampling. If the
    // yaw were ignored these would disagree by 90 degrees.
    const a = await page.evaluate(b => loadcalcScanGeometry(b), BOX(0, 0));
    const b = await page.evaluate(x => loadcalcScanGeometry(x), BOX(90, 90));
    expect(b.byOrientation).toEqual(a.byOrientation);
  });

  test('rubbish geometry does not throw', async () => {
    const r = await page.evaluate(() => {
      const junk = { headingDeg: 'north', rooms: [{ label: 'x', poly: 'nope', walls: [
        { ax: null, az: undefined, bx: 'a', bz: {}, len: 3, h: 2 }] }] };
      try { return { threw: false, ok: loadcalcScanGeometry(junk).ok }; }
      catch (e) { return { threw: true, msg: String(e) }; }
    });
    expect(r.threw).toBe(false);
  });
});
