// ── Sizing estimate: the HVAC load module ────────────────────────────────────
//
// WHAT THIS IS, AND WHAT IT IS CAREFULLY NOT.
//
// This produces a SIZING ESTIMATE: heating and cooling in BTU/h and a nominal
// equipment size range, derived from measured geometry and a set of stated
// assumptions. It is a planning number for a proposal conversation. It is NOT
// a permit document, it is NOT a certified load calculation, and nothing in
// this file, in the UI it feeds, or in the proposal it prints on may say or
// imply otherwise. `LOADCALC_NOT_FOR_PERMIT` is the first warning on every
// result, including the refusals, and there is no input, flag, or option
// anywhere in this module that removes it. That is deliberate: the moment a
// contractor can turn the disclaimer off is the moment we are the ones who
// sized somebody's equipment.
//
// The industry's standard residential procedure is published under a
// registered trademark and its approved software is licensed by name. We do
// not hold that license, so we do not use that name, do not claim conformance
// with it, and do not imply permit acceptability. Heat-transfer arithmetic
// itself is a method, not an expression, and 17 USC 102(b) puts methods
// outside copyright entirely (same reasoning as codes/README.md). So the
// physics below is ours to implement. The name is not ours to use. Keep that
// line exactly where it is.
//
// THE RULES, inherited from js/code-engine.js because they were right there:
//
// 1. PURE. `loadcalcEstimate(input)` is same-inputs-same-output forever: no
//    clock, no network, no globals, no reads of S. js/geo-derive.js earned
//    this rule the hard way and it is what makes the vectors at the bottom of
//    tests/e2e-loadcalc.spec.js mean anything. The only impure thing here is
//    `loadcalcFromScan`, which looks a scan up and then hands a plain object
//    to the pure function. That boundary is the whole design.
//
// 2. NOTHING UNVERIFIED IS PRESENTED AS FACT. An LLM will produce an R-value
//    that looks right and is not. Every assembly number in `LOADCALC_ENVELOPES`
//    is currently a PLACEHOLDER: it carries `ph:true`, names the public source
//    a human must type it out of, and prints into `assumed` with the word
//    PLACEHOLDER in it. `LOADCALC_SOURCES` is the map of where each one has to
//    come from and whether that source is even redistributable. Flipping a
//    value to verified is a human act by somebody holding the document.
//
// 3. NEVER AUTO-FILL SILENTLY (owner rule, code-engine.js). Every value this
//    module chose rather than received is in `assumed`, in plain words, and it
//    prints. A default he never saw is the failure mode with our name on it.
//
// WHY THIS DOES NOT RIDE `codeEval`. It is the same result shape on purpose,
// and callers can treat the two identically. But codeEval keys on
// family+edition and gates on a verified code dataset, and a sizing estimate
// has no edition and is not a code rule: there is no book to be on the 2023
// printing of. Forcing it through that door would have meant inventing a fake
// family, which is worse than mirroring 25 lines of a result constructor.
//
// DESIGN TEMPERATURES ARE NOT SHIPPED, AND THAT IS A LICENSING ANSWER, NOT AN
// OVERSIGHT. See `LOADCALC_SOURCES['ashrae-169']`. The 99%/1% design
// conditions everyone in the trade quotes are published tables that are
// licensed for software use for a fee; we do not hold that license, so we do
// not ship them. The lookup below therefore returns ok:false until a dataset
// is registered, and `loadcalcEstimate` refuses rather than guessing at the
// one input the whole answer scales linearly with. A contractor who types his
// own design temperatures in gets a real answer immediately.

// The line that never comes off. Every result carries it, first, always.
const LOADCALC_NOT_FOR_PERMIT =
  'Planning estimate only, not for permit. This is a sizing estimate from measured geometry and the assumptions listed above it, not a certified room-by-room load calculation. Have a certified calculation run before ordering equipment or pulling a permit.';

// ── Where every number is supposed to come from ──────────────────────────────
// status: 'physics'  a constant that follows from stated physical properties
//         'public'   a freely redistributable public dataset or document
//         'licensed' real, citable, and NOT ours to redistribute
//         'unsourced' we have nothing yet: a placeholder lives here
// typedIn: has a human actually read the document and entered the values?
const LOADCALC_SOURCES = {
  'air-props': {
    name: 'Standard sea-level dry air properties',
    status: 'physics', typedIn: true,
    note: 'Density 0.075 lb/ft3 and specific heat 0.24 Btu/lb-F at sea level. The familiar 1.08 and 0.68 air-side constants are derived from these below rather than typed in as magic numbers.'
  },
  'ashrae-169': {
    name: 'Published 99% / 1% climatic design conditions',
    status: 'licensed', typedIn: false,
    url: 'https://www.ashrae.org/technical-resources/bookstore/climate-design-data',
    note: 'The design-condition tables are copyrighted and are licensed to software developers for a fee, with a required attribution line. We do not hold that license, so no design temperatures ship in this file. Register a dataset with loadcalcRegisterDesignTemps() or have the contractor enter the two temperatures.'
  },
  'noaa-ncei': {
    name: 'NOAA NCEI station observations and climate normals',
    status: 'public', typedIn: false,
    url: 'https://www.ncei.noaa.gov/',
    note: 'US federal observations, public domain, no key required. Percentile design temperatures can be COMPUTED from these hourly records rather than copied out of a licensed table. That computation is the clean way to fill the design-temperature gap and it is not done here.'
  },
  'nrel-tmy3': {
    name: 'NREL TMY3 / NSRDB typical meteorological year data',
    status: 'public', typedIn: false,
    url: 'https://nsrdb.nrel.gov/',
    note: 'Free to use and copy with a DOE/NREL/Alliance credit. Another viable route to computed design conditions and to solar gain factors.'
  },
  'doe-ba-hsp': {
    name: 'DOE / NREL Building America House Simulation Protocols',
    status: 'public', typedIn: false,
    url: 'https://docs.nrel.gov/docs/fy11osti/49246.pdf',
    note: 'Federal technical report, freely distributable. Section II carries default envelope characteristics for existing homes by vintage, which is exactly what LOADCALC_ENVELOPES needs. NOBODY HAS TYPED THEM IN YET: every vintage value below is a placeholder until somebody reads this document and replaces it.'
  },
  'iecc-prescriptive': {
    name: 'IECC prescriptive envelope minimums by climate zone',
    status: 'licensed', typedIn: false,
    note: 'The individual R-value and U-factor numbers are facts and may be typed into our own schema (codes/README.md); the tables and text are not ours to reproduce. This is the right source for the newer vintages, where the envelope is whatever code required that year in that zone.'
  },
  'lbnl-infiltration': {
    name: 'LBNL infiltration model (blower-door to natural air change)',
    status: 'public', typedIn: false,
    note: 'The divisor that turns a measured ACH50 into a natural air-change rate varies with stories, shielding and climate. The single number used below is a placeholder standing in for that table.'
  },
  'occupant-gains': {
    name: 'Per-occupant sensible and latent heat gain',
    status: 'licensed', typedIn: false,
    note: 'The per-person gain figures in common use come from published tables. Values below are flagged placeholders, not quotations.'
  },
  'solar-gain': {
    name: 'Glazing solar heat gain factors by orientation',
    status: 'licensed', typedIn: false,
    note: 'Orientation-by-orientation gain factors are table data. Phase 1 uses one flagged aggregate factor and says so. The scan does record a compass heading, so a computed per-window figure off public TMY data is the real fix.'
  },
  'duct-loss': {
    name: 'Duct conduction and leakage penalty by duct location',
    status: 'unsourced', typedIn: false,
    note: 'No source selected yet. The multipliers below are placeholders.'
  },
  'nominal-sizes': {
    name: 'Standard nominal equipment sizes',
    status: 'public', typedIn: true,
    note: 'Residential cooling equipment is manufactured in half-ton steps and one ton is 12,000 BTU/h by definition. Both are facts about the market, not table data.'
  }
};

// ── Physical constants, derived rather than remembered ───────────────────────
// The 1.08 and 0.68 that every heat-load worksheet uses are not magic; they
// fall straight out of air density, specific heat, minutes per hour, the latent
// heat of vaporisation and the 7000 grains in a pound. Deriving them here means
// a reader can check them, and means an elevation correction has one place to
// go later.
const LOADCALC_PHYS = {
  airDensityLbFt3: 0.075,      // sea level, standard dry air
  airCpBtuLbF: 0.24,
  hfgBtuLb: 1061,              // latent heat of vaporisation of water
  grainsPerLb: 7000,
  minPerHour: 60,
  btuhPerTon: 12000            // definitional
};
// Sensible: BTU/h = 60 min/hr x lb/ft3 x Btu/lb-F x CFM x dT  =>  ~1.08
const _LC_SENS_K = LOADCALC_PHYS.minPerHour * LOADCALC_PHYS.airDensityLbFt3 * LOADCALC_PHYS.airCpBtuLbF;
// Latent: 60 x lb/ft3 x (Btu/lb / grains per lb) x CFM x d-grains  =>  ~0.68
const _LC_LAT_K = LOADCALC_PHYS.minPerHour * LOADCALC_PHYS.airDensityLbFt3 * (LOADCALC_PHYS.hfgBtuLb / LOADCALC_PHYS.grainsPerLb);
// Note for whoever compares this against the per-room infiltration figure on
// the scan's HVAC lens (js/scan.js `_scanHvacNumbers`): that one uses the
// rounded 1.1 and 0.68 rather than these derived values. The 2% gap is far
// inside the assumption error on either number and is not worth a divergence
// warning, but it IS why the two screens will not agree to the BTU.

const _LC_M2FT = 3.280839895;   // identical to _SCAN_M2FT; scan.js owns the
                                // geometry model, this module only converts it.
const _LC_FT2_PER_M2 = _LC_M2FT * _LC_M2FT;

// A placeholder value. `v` is usable arithmetic so the estimate can run, `ph`
// says do not trust it, `src` says which document replaces it.
function _lcPh(v, src, what) { return { v: v, ph: true, src: src, what: what }; }
// A value we can actually stand behind.
function _lcOk(v, src, what) { return { v: v, ph: false, src: src, what: what }; }

// ── Envelope presets ─────────────────────────────────────────────────────────
// Nobody is entering forty R-values on a phone at a kitchen table, so the
// contractor picks a construction vintage and a climate zone and this table
// fills the assemblies. That convenience is the entire reason this table
// exists, and it is also the most dangerous thing in the file, because a
// preset is invisible: it produces a confident number from values the user
// never saw. So every one of them prints into `assumed`, by name, with its
// number, and right now every one of them says PLACEHOLDER.
//
// `verified:false` is the honest state of this table today. Flipping it is a
// human act: read the Building America protocols (public, free) for the older
// vintages and the IECC minimums for the newer ones, replace each _lcPh with
// an _lcOk, record who and when, and only then set verified true.
//
// R-values are assembly (whole-wall) values in hr-ft2-F/Btu, not cavity
// insulation alone, because the arithmetic below inverts them straight to a
// U-factor. Window U and SHGC are whole-unit values. ach50 is the blower-door
// number a test would have produced; a real measured one always beats it.
const LOADCALC_ENVELOPES = {
  verified: false,
  verifiedBy: '',
  verifiedAt: '',
  // Climate zone bands only change the numbers where the era's code changed
  // with the zone. Older housing was built to whatever was local practice, so
  // its band overrides are empty on purpose rather than invented.
  zoneBands: ['1-2', '3-4', '5-6', '7-8'],
  vintages: {
    'pre-1960': {
      label: 'Pre-1960',
      note: 'Little or no wall insulation typical, single glazing or an added storm, leaky.',
      wallR: _lcPh(4, 'doe-ba-hsp', 'assembly R of an uninsulated framed wall'),
      ceilR: _lcPh(7, 'doe-ba-hsp', 'assembly R of a lightly insulated attic floor'),
      floorR: _lcPh(4, 'doe-ba-hsp', 'assembly R over an unconditioned space'),
      windowU: _lcPh(1.0, 'doe-ba-hsp', 'whole-window U of single glazing'),
      windowSHGC: _lcPh(0.7, 'doe-ba-hsp', 'solar heat gain coefficient, clear single glazing'),
      doorU: _lcPh(0.5, 'doe-ba-hsp', 'whole-door U, solid wood'),
      ach50: _lcPh(18, 'doe-ba-hsp', 'blower-door air changes at 50 Pa'),
      byZone: {}
    },
    '1960-1979': {
      label: '1960 to 1979',
      note: 'Some cavity insulation, mostly single glazing, still leaky.',
      wallR: _lcPh(7, 'doe-ba-hsp', 'assembly R, partially insulated framed wall'),
      ceilR: _lcPh(11, 'doe-ba-hsp', 'assembly R, attic floor'),
      floorR: _lcPh(6, 'doe-ba-hsp', 'assembly R over an unconditioned space'),
      windowU: _lcPh(0.9, 'doe-ba-hsp', 'whole-window U'),
      windowSHGC: _lcPh(0.68, 'doe-ba-hsp', 'solar heat gain coefficient'),
      doorU: _lcPh(0.5, 'doe-ba-hsp', 'whole-door U'),
      ach50: _lcPh(14, 'doe-ba-hsp', 'blower-door air changes at 50 Pa'),
      byZone: {}
    },
    '1980-1999': {
      label: '1980 to 1999',
      note: 'Cavity insulation normal, double glazing arriving through the era.',
      wallR: _lcPh(11, 'doe-ba-hsp', 'assembly R, insulated framed wall'),
      ceilR: _lcPh(19, 'doe-ba-hsp', 'assembly R, attic floor'),
      floorR: _lcPh(11, 'doe-ba-hsp', 'assembly R over an unconditioned space'),
      windowU: _lcPh(0.65, 'doe-ba-hsp', 'whole-window U, early double glazing'),
      windowSHGC: _lcPh(0.6, 'doe-ba-hsp', 'solar heat gain coefficient'),
      doorU: _lcPh(0.4, 'doe-ba-hsp', 'whole-door U'),
      ach50: _lcPh(10, 'doe-ba-hsp', 'blower-door air changes at 50 Pa'),
      byZone: {}
    },
    '2000-2009': {
      label: '2000 to 2009',
      note: 'Built to an energy code, so the envelope tracks the climate zone.',
      wallR: _lcPh(13, 'iecc-prescriptive', 'assembly R, code-minimum wall'),
      ceilR: _lcPh(30, 'iecc-prescriptive', 'assembly R, code-minimum ceiling'),
      floorR: _lcPh(19, 'iecc-prescriptive', 'assembly R, code-minimum floor'),
      windowU: _lcPh(0.5, 'iecc-prescriptive', 'code-minimum whole-window U'),
      windowSHGC: _lcPh(0.4, 'iecc-prescriptive', 'code-maximum solar heat gain coefficient'),
      doorU: _lcPh(0.35, 'iecc-prescriptive', 'whole-door U'),
      ach50: _lcPh(7, 'doe-ba-hsp', 'blower-door air changes at 50 Pa'),
      byZone: {
        '1-2': { ceilR: _lcPh(30, 'iecc-prescriptive', 'ceiling R, hot zones'), windowU: _lcPh(0.75, 'iecc-prescriptive', 'window U, hot zones') },
        '7-8': { ceilR: _lcPh(49, 'iecc-prescriptive', 'ceiling R, cold zones'), windowU: _lcPh(0.35, 'iecc-prescriptive', 'window U, cold zones') }
      }
    },
    '2010-plus': {
      label: '2010 and newer',
      note: 'Tighter code, mandatory blower-door testing in the later years.',
      wallR: _lcPh(16, 'iecc-prescriptive', 'assembly R, code-minimum wall with sheathing'),
      ceilR: _lcPh(38, 'iecc-prescriptive', 'assembly R, code-minimum ceiling'),
      floorR: _lcPh(19, 'iecc-prescriptive', 'assembly R, code-minimum floor'),
      windowU: _lcPh(0.32, 'iecc-prescriptive', 'code-minimum whole-window U'),
      windowSHGC: _lcPh(0.3, 'iecc-prescriptive', 'code-maximum solar heat gain coefficient'),
      doorU: _lcPh(0.3, 'iecc-prescriptive', 'whole-door U'),
      ach50: _lcPh(4, 'doe-ba-hsp', 'blower-door air changes at 50 Pa'),
      byZone: {
        '1-2': { ceilR: _lcPh(30, 'iecc-prescriptive', 'ceiling R, hot zones'), windowU: _lcPh(0.4, 'iecc-prescriptive', 'window U, hot zones') },
        '7-8': { ceilR: _lcPh(49, 'iecc-prescriptive', 'ceiling R, cold zones'), windowU: _lcPh(0.28, 'iecc-prescriptive', 'window U, cold zones') }
      }
    }
  }
};

// What sits under the floor decides whether the floor loses heat at all.
const LOADCALC_FOUNDATIONS = {
  'slab': { label: 'Slab on grade', floorExposed: false, note: 'Slab edge loss is a perimeter calculation, not an area one, and is not modelled in phase 1.' },
  'vented-crawl': { label: 'Vented crawlspace', floorExposed: true },
  'unconditioned-basement': { label: 'Unconditioned basement', floorExposed: true },
  'conditioned-basement': { label: 'Conditioned basement', floorExposed: false, note: 'Basement walls below grade are not modelled in phase 1.' },
  'over-conditioned': { label: 'Over conditioned space', floorExposed: false }
};

// Ducts outside the envelope are a real and large penalty. There is no source
// behind these multipliers yet, so they are placeholders and they say so.
const LOADCALC_DUCTS = {
  'conditioned': { label: 'Ducts inside conditioned space', mult: _lcOk(1.0, 'duct-loss', 'no penalty for ducts inside the envelope') },
  'attic': { label: 'Ducts in a vented attic', mult: _lcPh(1.25, 'duct-loss', 'duct conduction and leakage penalty') },
  'crawl': { label: 'Ducts in a crawlspace or unconditioned basement', mult: _lcPh(1.2, 'duct-loss', 'duct conduction and leakage penalty') },
  'ductless': { label: 'Ductless', mult: _lcOk(1.0, 'duct-loss', 'no ducts') },
  'unknown': { label: 'Duct location not stated', mult: _lcPh(1.2, 'duct-loss', 'duct penalty assumed because the duct location was not stated') }
};

// Internal gains. Sensible warms the room, latent is moisture the coil has to
// wring out. Both figures below are placeholders standing in for published
// per-person values.
const LOADCALC_GAINS = {
  personSensible: _lcPh(230, 'occupant-gains', 'sensible gain per occupant'),
  personLatent: _lcPh(200, 'occupant-gains', 'latent gain per occupant'),
  applianceSensible: _lcPh(1200, 'occupant-gains', 'whole-house appliance and lighting sensible gain'),
  // One aggregate number standing in for a per-orientation table. The scan
  // records a compass heading, so this is the first thing phase 2 should
  // replace with a computed per-window figure off public TMY data.
  glazingGainPerFt2: _lcPh(30, 'solar-gain', 'aggregate solar gain per square foot of glass')
};

// Manufactured sizes. Facts about what you can actually buy.
const LOADCALC_NOMINAL_TONS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];

// ── Design temperatures: registered, never shipped ───────────────────────────
// Empty by design (see the header). A dataset is `{id, name, source, verified,
// lookup(loc) -> {heatDB, coolDB, coolWB} | null}` or `{..., byKey:{...}}`.
// Registration is the ONLY way a design temperature appears without the
// contractor typing one, and the registry is deliberately outside the pure
// function: `loadcalcEstimate` never reads it.
const _LC_DESIGN_SETS = Object.create(null);
function loadcalcRegisterDesignTemps(set) {
  if (!set || !set.id) return false;
  _LC_DESIGN_SETS[String(set.id)] = set;
  return true;
}
function loadcalcDesignSets() { return Object.keys(_LC_DESIGN_SETS).sort(); }
function loadcalcClearDesignTemps() {
  Object.keys(_LC_DESIGN_SETS).forEach(function (k) { delete _LC_DESIGN_SETS[k]; });
}
// Returns {ok, design, source} or {ok:false, reason}. Impure by nature: it
// reads the registry. Callers hand the `design` it returns to the pure
// function, they never let the pure function reach in here.
function loadcalcDesignLookup(loc) {
  const keys = Object.keys(_LC_DESIGN_SETS);
  if (!keys.length) {
    return { ok: false, reason: 'no-design-data', design: null, source: null,
      note: LOADCALC_SOURCES['ashrae-169'].note };
  }
  for (let i = 0; i < keys.length; i++) {
    const set = _LC_DESIGN_SETS[keys[i]];
    if (!set || set.verified === false) continue;
    let hit = null;
    try {
      if (typeof set.lookup === 'function') hit = set.lookup(loc);
      else if (set.byKey && loc != null) hit = set.byKey[String(loc)] || null;
    } catch (_e) { hit = null; }
    if (hit && isFinite(Number(hit.heatDB)) && isFinite(Number(hit.coolDB))) {
      return { ok: true, design: hit, source: set.source || set.id, reason: '' };
    }
  }
  return { ok: false, reason: 'no-design-match', design: null, source: null,
    note: 'A design-temperature dataset is registered but has nothing for this location.' };
}

// ── The result shape ─────────────────────────────────────────────────────────
// Deliberately the same object js/code-engine.js `_codeResult` returns, so a
// caller can render a sizing estimate and a code rule through one renderer.
// The extra `detail` and `sources` keys are additive and a code-shaped reader
// ignores them.
function _lcResult(f) {
  f = f || {};
  const warnings = [LOADCALC_NOT_FOR_PERMIT].concat(Array.isArray(f.warnings) ? f.warnings : []);
  return {
    ok: f.ok !== false,
    reason: f.reason || '',
    value: (f.value === undefined ? null : f.value),
    unit: f.unit || '',
    inputs: f.inputs || {},
    family: 'loadcalc',
    edition: '',
    cite: f.cite || '',
    assumed: Array.isArray(f.assumed) ? f.assumed : [],
    items: Array.isArray(f.items) ? f.items : [],
    // The not-for-permit line is prepended HERE, in the one constructor every
    // exit path goes through, rather than at each return. There is no branch
    // that can skip it and no argument that can remove it.
    warnings: warnings,
    detail: f.detail || {},
    sources: f.sources || {}
  };
}

const _lcNum = function (n, dflt) { const v = Number(n); return isFinite(v) ? v : (dflt === undefined ? 0 : dflt); };
const _lcPos = function (n) { const v = Number(n); return (isFinite(v) && v > 0) ? v : 0; };
const _lcRound = function (n) { const v = Number(n); return isFinite(v) ? Math.round(v) : 0; };

// ── Scan reuse: one geometry model, and it is scan.js's ──────────────────────
// §7.3. js/scan.js already parses RoomPlan into room records with floorM2,
// wallM2, openM2, winM2, perimM, hM, doorN, winN, story, label and per-wall
// endpoints with their openings resolved onto them. This function CONSUMES
// that record. It does not re-parse CapturedRoom JSON, it does not hold its
// own idea of what a room is, and if the scan parser changes shape this
// follows it rather than drifting away from it.
//
// The one thing scan.js does not answer is which walls face outside, and it is
// the question the whole heat loss turns on. RoomPlan does not label a wall
// exterior. Summing every wall in the house would count each interior
// partition twice AND treat it as losing heat to the weather, which on a
// four-bedroom ranch is wrong by more than a factor of two. So: a wall is
// INTERIOR when some other room on the same floor has a wall lying on top of
// it. Two rooms sharing a partition each see it from their own side, so the
// two segments are near-parallel, within a wall thickness of each other, and
// overlap along their length. Everything left over faces out.
//
// Pure: takes the scan record, returns geometry. No lookups, no globals.
// ── Which way a wall faces ───────────────────────────────────────────────────
//
// The industry's residential procedure resolves glass load by compass
// direction, and so does the physics: south glass in July is a
// different building from north glass, and collapsing both into one "window
// square feet" number is the single largest avoidable error in a load
// calculation done from good geometry. The scan already carries everything
// needed and this is where it stops being thrown away.
//
// TWO PARTS, and only the first is certain.
//
// 1. WHICH WAY THE WALL FACES, in the scan's own frame. Certain. A wall run
//    has two perpendiculars; the outward one is whichever points away from the
//    room's own centre. No compass involved.
//
// 2. WHICH WAY THAT IS ON EARTH. NOT yet verified. `scan.headingDeg` is the
//    compass reading captured with the scan, and the convention below takes it
//    to be the bearing of the scene's -z axis, which is what the plan's north
//    arrow (js/scan.js, "6. North arrow when the compass grabbed a heading")
//    is drawn from. That is a reading of the code, not a measurement. Until it
//    is checked against one real scan of a house whose facing is known, every
//    result carries `orientationUnverified` and says so in `notes`.
//
//    Getting this backwards puts south glass on the north side and quietly
//    halves a cooling load, so it is flagged rather than assumed correct. When
//    it is confirmed, the fix is _LC_HEADING_SIGN and nothing else.
const _LC_HEADING_SIGN = 1;

const _LC_OCTANTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// The outward unit normal of a wall, in scene coordinates. `cx,cz` is a point
// known to be inside the room.
function _lcWallNormal(w, cx, cz) {
  const dx = _lcNum(w.bx) - _lcNum(w.ax), dz = _lcNum(w.bz) - _lcNum(w.az);
  const len = Math.hypot(dx, dz);
  if (!len) return null;
  const ux = dx / len, uz = dz / len;
  // Midpoint, relative to the room's centre.
  const mx = (_lcNum(w.ax) + _lcNum(w.bx)) / 2 - cx;
  const mz = (_lcNum(w.az) + _lcNum(w.bz)) / 2 - cz;
  // Of the two perpendiculars, the outward one leans away from the centre.
  const nx = -uz, nz = ux;
  return (nx * mx + nz * mz) >= 0 ? { x: nx, z: nz } : { x: -nx, z: -nz };
}

// Mean of a room's floor polygon, or of its wall endpoints when there is none.
function _lcRoomCentre(r) {
  const poly = (r && Array.isArray(r.poly)) ? r.poly : null;
  let sx = 0, sz = 0, n = 0;
  if (poly && poly.length) {
    poly.forEach(function (p) {
      if (!Array.isArray(p)) return;
      sx += _lcNum(p[0]); sz += _lcNum(p[1]); n++;
    });
  }
  if (!n) {
    (Array.isArray(r && r.walls) ? r.walls : []).forEach(function (w) {
      sx += _lcNum(w.ax) + _lcNum(w.bx); sz += _lcNum(w.az) + _lcNum(w.bz); n += 2;
    });
  }
  return n ? { x: sx / n, z: sz / n } : { x: 0, z: 0 };
}

// Compass bearing of a scene-space normal, 0 = north, clockwise. headingDeg is
// the scan's compass reading; without it the bearing is relative to the scan.
function _lcBearing(n, headingDeg) {
  // 0 degrees is the scene's -z axis, increasing clockwise toward +x.
  let deg = Math.atan2(n.x, -n.z) * 180 / Math.PI;
  const head = Number(headingDeg);
  if (isFinite(head)) deg += _LC_HEADING_SIGN * head;
  deg = deg % 360;
  return deg < 0 ? deg + 360 : deg;
}

function _lcOctant(bearingDeg) {
  const i = Math.round(_lcNum(bearingDeg) / 45) % 8;
  return _LC_OCTANTS[(i + 8) % 8];
}

// An empty per-direction tally. Always all eight keys, so a caller never has
// to guard for a missing side.
function _lcOrientBucket() {
  const o = {};
  _LC_OCTANTS.forEach(function (k) { o[k] = { wallSqFt: 0, windowSqFt: 0, doorSqFt: 0 }; });
  return o;
}
function _lcOrientAdd(bucket, oct, wallM2, glassM2, doorM2) {
  const b = bucket[oct];
  if (!b) return;
  b.wallSqFt += wallM2 * _LC_FT2_PER_M2;
  b.windowSqFt += glassM2 * _LC_FT2_PER_M2;
  b.doorSqFt += doorM2 * _LC_FT2_PER_M2;
}
function _lcOrientRound(bucket) {
  const o = {};
  Object.keys(bucket).forEach(function (k) {
    o[k] = {
      wallSqFt: _lcRound(bucket[k].wallSqFt),
      windowSqFt: _lcRound(bucket[k].windowSqFt),
      doorSqFt: _lcRound(bucket[k].doorSqFt)
    };
  });
  return o;
}

function loadcalcScanGeometry(scan, opts) {
  const o = opts || {};
  const rooms = (scan && Array.isArray(scan.rooms)) ? scan.rooms : [];
  const notes = [];
  if (!rooms.length) return { ok: false, reason: 'no-rooms', notes: ['The scan has no rooms in it.'] };

  const storyOf = function (r) { return Math.max(1, _lcNum(r && r.story, 1)); };
  // One centre per room, for deciding which side of a wall is outdoors.
  const centres = rooms.map(_lcRoomCentre);
  // SCENE NORTH, not the raw compass reading.
  //
  // headingDeg is the bearing the phone faced when the compass was sampled,
  // and the scene's own zero was fixed when the session started, two seconds
  // earlier. Subtracting the camera's yaw at that same instant turns one
  // useless number into an exact one. A scan taken before the plugin sent the
  // yaw has no way to recover it, so it is treated as having no compass at
  // all rather than being quietly believed.
  const headingDeg = Number(scan && scan.headingDeg);
  const camYaw = Number(scan && scan.headingCamYawDeg);
  const hasHeading = isFinite(headingDeg) && headingDeg >= 0
                  && isFinite(camYaw) && camYaw >= 0;
  const sceneNorth = hasHeading ? (((headingDeg - camYaw) % 360) + 360) % 360 : null;
  const stories = Array.from(new Set(rooms.map(storyOf))).sort(function (a, b) { return a - b; });
  const topStory = stories[stories.length - 1], botStory = stories[0];

  // Every wall in the building, tagged with its room and floor.
  const all = [];
  rooms.forEach(function (r, ri) {
    (Array.isArray(r && r.walls) ? r.walls : []).forEach(function (w) {
      const len = _lcPos(w && w.len);
      if (!len) return;
      all.push({ ri: ri, story: storyOf(r), w: w, len: len, h: _lcPos(w.h) || _lcPos(r.hM) || 2.44 });
    });
  });

  // Tolerances, in metres, and they are judgement calls rather than physics:
  // a stud wall with finish both sides is roughly 0.13 m thick and LiDAR
  // tracking drifts a degree or two over a floor (see _scanSquareWalls).
  const TOUCH_M = _lcPos(o.sharedWallToleranceM) || 0.45;
  const PARALLEL = 0.18;      // sine of the angle between the two segments
  const OVERLAP_M = 0.6;      // how much of a run has to coincide to count

  const shared = function (a, b) {
    const ax = a.w.bx - a.w.ax, az = a.w.bz - a.w.az;
    const bx = b.w.bx - b.w.ax, bz = b.w.bz - b.w.az;
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const ux = ax / la, uz = az / la, vx = bx / lb, vz = bz / lb;
    if (Math.abs(ux * vz - uz * vx) > PARALLEL) return false;        // not parallel
    // Perpendicular distance from b's midpoint to a's line.
    const mx = (b.w.ax + b.w.bx) / 2 - a.w.ax, mz = (b.w.az + b.w.bz) / 2 - a.w.az;
    if (Math.abs(mx * (-uz) + mz * ux) > TOUCH_M) return false;      // too far apart
    // Overlap of b's projection onto a's run.
    const p1 = (b.w.ax - a.w.ax) * ux + (b.w.az - a.w.az) * uz;
    const p2 = (b.w.bx - a.w.ax) * ux + (b.w.bz - a.w.az) * uz;
    const lo = Math.max(0, Math.min(p1, p2)), hi = Math.min(la, Math.max(p1, p2));
    return (hi - lo) >= Math.min(OVERLAP_M, Math.min(la, lb) * 0.5);
  };

  let extWallM2 = 0, extGlassM2 = 0, extDoorM2 = 0, intWallCount = 0, extWallCount = 0;
  const byOrient = _lcOrientBucket();
  const roomOrient = rooms.map(function () { return _lcOrientBucket(); });
  let unfacedWalls = 0;
  all.forEach(function (a) {
    const interior = all.some(function (b) { return b.ri !== a.ri && b.story === a.story && shared(a, b); });
    if (interior) { intWallCount++; return; }
    extWallCount++;
    const gross = a.len * a.h;
    let glass = 0, door = 0;
    (Array.isArray(a.w.windows) ? a.w.windows : []).forEach(function (x) { glass += _lcPos(x && x.area); });
    // An archway is a hole in an interior wall, never an exterior door. scan.js
    // keeps both in the wall's `doors` list and separates them with `kind`.
    (Array.isArray(a.w.doors) ? a.w.doors : []).forEach(function (x) {
      if (x && x.kind === 'opening') return;
      door += _lcPos(x && x.area);
    });
    const openings = Math.min(gross * 0.9, glass + door);   // an opening cannot eat the whole wall
    const net = Math.max(0, gross - openings);
    extWallM2 += net;
    extGlassM2 += glass; extDoorM2 += door;

    // Same wall, now filed by the direction it faces.
    const c = centres[a.ri] || { x: 0, z: 0 };
    const n = _lcWallNormal(a.w, c.x, c.z);
    if (!n) { unfacedWalls++; return; }
    const oct = _lcOctant(_lcBearing(n, sceneNorth));
    _lcOrientAdd(byOrient, oct, net, glass, door);
    _lcOrientAdd(roomOrient[a.ri], oct, net, glass, door);
  });

  let floorM2 = 0, volM3 = 0, ceilM2 = 0, exposedFloorM2 = 0;
  const roomOut = [];
  rooms.forEach(function (r, ri) {
    const fm = _lcPos(r && r.floorM2), hm = _lcPos(r && r.hM) || 2.44;
    floorM2 += fm; volM3 += fm * hm;
    if (storyOf(r) === topStory) ceilM2 += fm;
    if (storyOf(r) === botStory) exposedFloorM2 += fm;
    roomOut.push({
      name: String((r && r.label) || 'Room'), story: storyOf(r),
      sqFt: _lcRound(fm * _LC_FT2_PER_M2),
      volumeFt3: _lcRound(fm * hm * _LC_FT2_PER_M2 * _LC_M2FT),
      windowSqFt: _lcRound(_lcPos(r && r.winM2) * _LC_FT2_PER_M2),
      // The procedure is per room and per direction, so a room carries its own
      // eight sides rather than a single window number.
      byOrientation: _lcOrientRound(roomOrient[ri] || _lcOrientBucket()),
      idx: ri
    });
  });

  // A one-room scan cannot answer the shared-wall question at all: there is no
  // other room to share with, so everything reads exterior. For a real single
  // room inside a house that is badly wrong, and it is the caller's business
  // to know which they scanned.
  if (rooms.length === 1) {
    notes.push('Only one room was scanned, so every wall in it is being treated as an exterior wall. If this room sits inside a larger house, the heating number will be far too high.');
  }
  if (!extWallCount) {
    notes.push('No exterior walls could be identified in this scan.');
  }
  if (!hasHeading) {
    notes.push('This scan carries no usable compass reading, so the per-direction areas are angles within the scan itself, not north, south, east and west. Solar gain cannot be resolved by direction from it. Scans taken before the app recorded which way the camera was pointing when the compass was read are in this group.');
  } else {
    notes.push('The compass mapping has not been checked against a scan of a house whose facing is known, so treat the per-direction split as provisional.');
  }
  if (unfacedWalls) {
    notes.push(unfacedWalls + ' exterior wall(s) had no usable direction and are counted in the totals but not in the per-direction split.');
  }
  if (stories.length > 1) {
    notes.push('Scan spans ' + stories.length + ' floors: the ceiling area is floor ' + topStory + ' only and the exposed floor area is floor ' + botStory + ' only.');
  }

  // Bedrooms drive the default occupancy, and the scan already knows their
  // names because the contractor labelled them in the viewer.
  const bedrooms = rooms.filter(function (r) { return /bed/i.test(String((r && r.label) || '')); }).length;

  return {
    ok: true,
    source: 'scan',
    conditionedSqFt: _lcRound(floorM2 * _LC_FT2_PER_M2),
    volumeFt3: _lcRound(volM3 * _LC_FT2_PER_M2 * _LC_M2FT),
    exteriorWallSqFt: _lcRound(extWallM2 * _LC_FT2_PER_M2),
    windowSqFt: _lcRound(extGlassM2 * _LC_FT2_PER_M2),
    doorSqFt: _lcRound(extDoorM2 * _LC_FT2_PER_M2),
    ceilingSqFt: _lcRound(ceilM2 * _LC_FT2_PER_M2),
    floorSqFt: _lcRound(exposedFloorM2 * _LC_FT2_PER_M2),
    storyCount: stories.length,
    bedrooms: bedrooms,
    exteriorWallCount: extWallCount,
    interiorWallCount: intWallCount,
    rooms: roomOut,
    byOrientation: _lcOrientRound(byOrient),
    // True when the eight directions are real compass directions rather than
    // angles in the scan's own frame. See _LC_HEADING_SIGN.
    orientationUnverified: true,
    hasCompass: hasHeading,
    notes: notes
  };
}

// When there is no scan, a total square footage and a story count are all a
// contractor will reliably give you on the phone. Everything else has to be
// assumed, and every one of those assumptions is returned so it can print.
function _lcGeometryFromSqFt(sqFt, opts) {
  const o = opts || {};
  const area = _lcPos(sqFt);
  if (!area) return { ok: false, reason: 'no-area' };
  const stories = Math.max(1, Math.round(_lcNum(o.storyCount, 1)));
  const ht = _lcPos(o.ceilingHeightFt) || 8;
  const footprint = area / stories;
  // A perfectly square footprint has the least wall per square foot of floor,
  // so a real house always has more. 1.15 is a shape allowance and it is a
  // guess, which is why it is returned as an assumption.
  const shape = _lcPos(o.shapeFactor) || 1.15;
  const perim = 4 * Math.sqrt(footprint) * shape;
  const grossWall = perim * ht * stories;
  const glazeRatio = (o.glazingRatio != null) ? _lcPos(o.glazingRatio) : 0.15;
  const glass = area * glazeRatio;
  const doorArea = _lcPos(o.doorSqFt) || 42;                 // two exterior doors
  return {
    ok: true, source: 'sqft',
    conditionedSqFt: _lcRound(area),
    volumeFt3: _lcRound(area * ht),
    exteriorWallSqFt: _lcRound(Math.max(0, grossWall - glass - doorArea)),
    windowSqFt: _lcRound(glass),
    doorSqFt: _lcRound(doorArea),
    ceilingSqFt: _lcRound(footprint),
    floorSqFt: _lcRound(footprint),
    storyCount: stories, bedrooms: 0,
    exteriorWallCount: 0, interiorWallCount: 0, rooms: [],
    assumedShape: { shape: shape, ht: ht, glazeRatio: glazeRatio, doorArea: doorArea },
    notes: []
  };
}

// Resolve one envelope value through the zone override, and record it.
function _lcEnvVal(vint, band, key) {
  const over = (vint.byZone && vint.byZone[band]) ? vint.byZone[band][key] : null;
  return over || vint[key] || null;
}
function _lcBandFor(zone) {
  const z = Math.round(_lcNum(zone, 0));
  if (z >= 1 && z <= 2) return '1-2';
  if (z >= 3 && z <= 4) return '3-4';
  if (z >= 5 && z <= 6) return '5-6';
  if (z >= 7 && z <= 8) return '7-8';
  return null;
}

// ── The estimate ─────────────────────────────────────────────────────────────
// PURE. Everything it needs arrives in `input`. It reads no globals, takes no
// clock, and returns the same object for the same argument forever.
//
//   loadcalcEstimate({
//     sqFt: 2200,                        // or geometry: loadcalcScanGeometry(scan)
//     storyCount: 1, ceilingHeightFt: 8,
//     design: { heatDB: 8, coolDB: 95, coolWB: 75 },   // REQUIRED, see header
//     envelope: { vintage: '1980-1999', zone: 5, overrides: { ach50: 6.2 } },
//     occupants: 4, foundation: 'vented-crawl', ductLocation: 'attic'
//   })
//
// Returns the code-engine result shape. On refusal it still returns that
// shape, still carries the not-for-permit line, and `value` is null.
function loadcalcEstimate(input) {
  const inp = (input && typeof input === 'object') ? input : {};
  const assumed = [];
  const warnings = [];
  const usedSources = {};
  const noteSrc = function (id) { if (LOADCALC_SOURCES[id]) usedSources[id] = LOADCALC_SOURCES[id]; };

  // Pull a value, record it as an assumption when we chose it rather than
  // being told it, and shout when it is a placeholder.
  const take = function (given, preset, label, unit) {
    if (given != null && isFinite(Number(given))) return Number(given);
    if (!preset || !isFinite(Number(preset.v))) return null;
    noteSrc(preset.src);
    const src = LOADCALC_SOURCES[preset.src] || {};
    assumed.push((preset.ph ? 'PLACEHOLDER, not from a checked source: ' : '') +
      label + ' assumed ' + preset.v + (unit ? ' ' + unit : '') +
      ' (' + (preset.what || '') + '; needs ' + (src.name || preset.src) + ')');
    return Number(preset.v);
  };

  // ── Geometry ───────────────────────────────────────────────────────────────
  let geo = null;
  if (inp.geometry && typeof inp.geometry === 'object' && inp.geometry.ok !== false &&
      _lcPos(inp.geometry.conditionedSqFt)) {
    geo = inp.geometry;
  } else if (_lcPos(inp.sqFt)) {
    geo = _lcGeometryFromSqFt(inp.sqFt, inp);
  }
  if (!geo || geo.ok === false || !_lcPos(geo.conditionedSqFt)) {
    return _lcResult({ ok: false, reason: 'no-geometry', inputs: inp, sources: usedSources,
      warnings: ['No floor area to work from. Attach a scan or enter the conditioned square footage.'] });
  }
  if (geo.source === 'sqft' && geo.assumedShape) {
    const a = geo.assumedShape;
    assumed.push('No scan attached, so the shell was estimated from ' + geo.conditionedSqFt +
      ' sq ft over ' + geo.storyCount + ' floor' + (geo.storyCount > 1 ? 's' : '') +
      ': ' + a.ht + ' ft ceilings, a shape allowance of ' + a.shape +
      ' on a square footprint, glass at ' + Math.round(a.glazeRatio * 100) + '% of floor area, ' +
      a.doorArea + ' sq ft of exterior door. PLACEHOLDER shape and glazing figures, no source behind them.');
    warnings.push('Shell dimensions were estimated from square footage alone. A scan of the actual rooms replaces every one of those guesses with a measurement.');
  }
  (Array.isArray(geo.notes) ? geo.notes : []).forEach(function (n) { warnings.push(n); });

  // ── Design temperatures: the hard gate ─────────────────────────────────────
  const d = (inp.design && typeof inp.design === 'object') ? inp.design : {};
  const heatDB = Number(d.heatDB), coolDB = Number(d.coolDB);
  if (!isFinite(heatDB) || !isFinite(coolDB)) {
    noteSrc('ashrae-169'); noteSrc('noaa-ncei'); noteSrc('nrel-tmy3');
    return _lcResult({ ok: false, reason: 'no-design-temps', inputs: inp, sources: usedSources,
      assumed: assumed,
      warnings: ['No outdoor design temperatures. The published 99% / 1% design-condition tables are licensed and are not shipped with this app, so either enter the winter and summer design temperatures for this address or register a dataset. Nothing is guessed here on purpose: the whole answer scales directly with these two numbers.'] });
  }
  const indoorHeat = isFinite(Number(d.indoorHeatDB)) ? Number(d.indoorHeatDB) : (assumed.push('Indoor winter temperature assumed 70 F (the contractor did not state one)'), 70);
  const indoorCool = isFinite(Number(d.indoorCoolDB)) ? Number(d.indoorCoolDB) : (assumed.push('Indoor summer temperature assumed 75 F (the contractor did not state one)'), 75);
  if (d.source) assumed.push('Design temperatures from: ' + String(d.source));
  else assumed.push('Design temperatures entered by hand: ' + heatDB + ' F winter, ' + coolDB + ' F summer. Nobody checked them against a published table.');
  const dtHeat = indoorHeat - heatDB;
  const dtCool = coolDB - indoorCool;
  if (dtHeat <= 0) warnings.push('Winter design temperature is at or above the indoor temperature, so there is no heating load to estimate.');
  if (dtCool <= 0) warnings.push('Summer design temperature is at or below the indoor temperature, so there is no cooling load to estimate.');

  // ── Envelope ───────────────────────────────────────────────────────────────
  const env = (inp.envelope && typeof inp.envelope === 'object') ? inp.envelope : {};
  const vintKey = String(env.vintage || '');
  const vint = LOADCALC_ENVELOPES.vintages[vintKey];
  if (!vint) {
    return _lcResult({ ok: false, reason: 'no-envelope', inputs: inp, sources: usedSources, assumed: assumed,
      warnings: ['Pick a construction vintage. Options: ' + Object.keys(LOADCALC_ENVELOPES.vintages).join(', ') + '.'] });
  }
  const band = _lcBandFor(env.zone);
  if (env.zone != null && !band) warnings.push('Climate zone ' + env.zone + ' is not one of the eight zones, so no zone-specific envelope values were applied.');
  const ov = (env.overrides && typeof env.overrides === 'object') ? env.overrides : {};
  assumed.push('Envelope preset: ' + vint.label + (band ? ', climate zone band ' + band : ', no climate zone given') + '. ' + vint.note);
  if (!LOADCALC_ENVELOPES.verified) {
    warnings.push('Every envelope number below is a placeholder. No human has checked this table against a published source yet, so treat the result as an order-of-magnitude figure until they do.');
  }

  const wallR = take(ov.wallR, _lcEnvVal(vint, band, 'wallR'), 'Wall assembly R', '');
  const ceilR = take(ov.ceilR, _lcEnvVal(vint, band, 'ceilR'), 'Ceiling assembly R', '');
  const floorR = take(ov.floorR, _lcEnvVal(vint, band, 'floorR'), 'Floor assembly R', '');
  const winU = take(ov.windowU, _lcEnvVal(vint, band, 'windowU'), 'Window U-factor', '');
  const winSHGC = take(ov.windowSHGC, _lcEnvVal(vint, band, 'windowSHGC'), 'Window solar heat gain coefficient', '');
  const doorU = take(ov.doorU, _lcEnvVal(vint, band, 'doorU'), 'Door U-factor', '');
  const ach50 = take(ov.ach50, _lcEnvVal(vint, band, 'ach50'), 'Blower-door air changes at 50 Pa', 'ACH50');
  if (ov.ach50 != null && isFinite(Number(ov.ach50))) assumed.push('Blower-door number supplied: ' + Number(ov.ach50) + ' ACH50. A measured number beats every preset in this table.');

  const uWall = wallR > 0 ? 1 / wallR : 0;
  const uCeil = ceilR > 0 ? 1 / ceilR : 0;
  const uFloor = floorR > 0 ? 1 / floorR : 0;

  const found = LOADCALC_FOUNDATIONS[String(inp.foundation || '')] || LOADCALC_FOUNDATIONS['slab'];
  if (!inp.foundation) assumed.push('Foundation assumed slab on grade, so no floor heat loss is counted. Say vented-crawl or unconditioned-basement if the floor is over open air.');
  if (found.note) assumed.push(found.label + ': ' + found.note);

  // ── Envelope conduction: area x U x delta-T, one assembly at a time ────────
  const aWall = _lcPos(geo.exteriorWallSqFt);
  const aWin = _lcPos(geo.windowSqFt);
  const aDoor = _lcPos(geo.doorSqFt);
  const aCeil = _lcPos(geo.ceilingSqFt);
  const aFloor = found.floorExposed ? _lcPos(geo.floorSqFt) : 0;
  const ua = aWall * uWall + aWin * _lcPos(winU) + aDoor * _lcPos(doorU) + aCeil * uCeil + aFloor * uFloor;

  // ── Infiltration ──────────────────────────────────────────────────────────
  const nFactorPh = _lcPh(18, 'lbnl-infiltration', 'divisor turning ACH50 into a natural air-change rate');
  const nFactor = take(ov.nFactor, nFactorPh, 'Blower-door to natural air change divisor', '') || 18;
  const volume = _lcPos(geo.volumeFt3);
  const achNat = nFactor > 0 ? (_lcPos(ach50) / nFactor) : 0;
  const cfm = achNat * volume / 60;
  const infilHeat = _LC_SENS_K * cfm * Math.max(0, dtHeat);
  const infilCoolSens = _LC_SENS_K * cfm * Math.max(0, dtCool);
  const grains = isFinite(Number(d.coolGrainsDiff)) ? Number(d.coolGrainsDiff)
    : (noteSrc('ashrae-169'), assumed.push('PLACEHOLDER, not from a checked source: humidity difference assumed 30 grains per pound. The real figure comes from the summer design wet-bulb, which is part of the same licensed design-condition table.'), 30);
  const infilCoolLat = _LC_LAT_K * cfm * Math.max(0, grains);
  assumed.push('Air-side constants derived from standard sea-level air, not looked up: sensible ' +
    (Math.round(_LC_SENS_K * 1000) / 1000) + ' and latent ' + (Math.round(_LC_LAT_K * 1000) / 1000) +
    ' BTU/h per CFM. No elevation correction is applied, so a house well above sea level reads high.');

  // ── Internal and solar gains ──────────────────────────────────────────────
  let occupants = _lcNum(inp.occupants, 0);
  if (!occupants) {
    // The usual convention is bedrooms plus one. The scan already knows how
    // many rooms the contractor labelled as bedrooms.
    if (_lcPos(geo.bedrooms)) { occupants = geo.bedrooms + 1; assumed.push('Occupancy assumed ' + occupants + ': ' + geo.bedrooms + ' rooms in the scan are named as bedrooms, plus one. PLACEHOLDER convention, no source checked.'); }
    else { occupants = 4; assumed.push('PLACEHOLDER, not from a checked source: occupancy assumed 4 people because nothing in the job says otherwise.'); }
  }
  const pSens = take(null, LOADCALC_GAINS.personSensible, 'Sensible gain per occupant', 'BTU/h');
  const pLat = take(null, LOADCALC_GAINS.personLatent, 'Latent gain per occupant', 'BTU/h');
  const appl = take(inp.applianceSensibleBtuh, LOADCALC_GAINS.applianceSensible, 'Appliance and lighting gain', 'BTU/h');
  const glassGain = take(inp.glazingGainPerFt2, LOADCALC_GAINS.glazingGainPerFt2, 'Solar gain per sq ft of glass', 'BTU/h');
  const solar = aWin * _lcPos(glassGain);
  if (aWin > 0) warnings.push('Solar gain uses one flat figure for all the glass in the house. Orientation is not modelled in this version, so a house with most of its glass facing west is under-estimated.');

  const duct = LOADCALC_DUCTS[String(inp.ductLocation || 'unknown')] || LOADCALC_DUCTS['unknown'];
  const ductMult = take(null, duct.mult, duct.label, '');

  // ── Totals ────────────────────────────────────────────────────────────────
  const heatEnvelope = ua * Math.max(0, dtHeat);
  const heatingBtuh = (heatEnvelope + infilHeat) * _lcPos(ductMult);
  const coolSensible = (ua * Math.max(0, dtCool) + infilCoolSens + solar +
    occupants * _lcPos(pSens) + _lcPos(appl)) * _lcPos(ductMult);
  const coolLatent = infilCoolLat + occupants * _lcPos(pLat);
  // Round the two halves FIRST and add the rounded halves, so the sensible and
  // latent numbers on screen always add up to the total on screen. Rounding
  // all three independently puts them out by a BTU, and a contractor reading a
  // proposal where the parts do not sum to the total is right to stop trusting
  // the whole page.
  const coolSensibleR = _lcRound(coolSensible);
  const coolLatentR = _lcRound(coolLatent);
  const coolTotal = coolSensibleR + coolLatentR;

  // ── Equipment size range ──────────────────────────────────────────────────
  // Cooling: the smallest nominal size that covers the load, and the next one
  // up. Presented as a RANGE and nothing more, because the rule about how far
  // above the load you may go is a published sizing procedure and not ours to
  // restate. Heating: the required OUTPUT, not an input rating; converting to
  // input is the contractor's efficiency, not our arithmetic.
  noteSrc('nominal-sizes');
  const tonsNeeded = coolTotal / LOADCALC_PHYS.btuhPerTon;
  let tonLow = null, tonHigh = null;
  for (let i = 0; i < LOADCALC_NOMINAL_TONS.length; i++) {
    if (LOADCALC_NOMINAL_TONS[i] >= tonsNeeded) { tonLow = LOADCALC_NOMINAL_TONS[i]; tonHigh = LOADCALC_NOMINAL_TONS[i + 1] || null; break; }
  }
  if (tonLow == null) warnings.push('The cooling load is above the largest single residential unit in the list (' +
    LOADCALC_NOMINAL_TONS[LOADCALC_NOMINAL_TONS.length - 1] + ' ton). This house wants more than one system and that is a design conversation, not an estimate.');
  const equipment = {
    coolingTonsNeeded: Math.round(tonsNeeded * 100) / 100,
    coolingTonsLow: tonLow, coolingTonsHigh: tonHigh,
    heatingOutputLowBtuh: _lcRound(heatingBtuh),
    heatingOutputHighBtuh: _lcRound(heatingBtuh * 1.15),
    heatingRangeNote: 'Required heat OUTPUT at design conditions, with a 15% allowance on the upper end for recovery. Input rating depends on the efficiency of the unit you quote.'
  };

  // ── Per-room split ────────────────────────────────────────────────────────
  // Honest label: this is a DISTRIBUTION of one whole-house number by floor
  // area, not a load calculated room by room. It is useful for talking about
  // registers and it is not useful for anything else, and it says so.
  const roomRows = [];
  if (Array.isArray(geo.rooms) && geo.rooms.length && _lcPos(geo.conditionedSqFt)) {
    geo.rooms.forEach(function (r) {
      const share = _lcPos(r.sqFt) / _lcPos(geo.conditionedSqFt);
      roomRows.push({ name: r.name, story: r.story, sqFt: r.sqFt,
        heatingBtuh: _lcRound(heatingBtuh * share), coolingBtuh: _lcRound(coolTotal * share) });
    });
    assumed.push('The per-room numbers are the whole-house figure split by floor area. They are not room-by-room calculations and must not be used to size a register or a branch duct.');
  }

  // ── Lines for the estimate. Never a price: his book prices it. ────────────
  const items = [];
  if (tonLow != null) {
    items.push({ label: 'Cooling equipment, ' + tonLow + (tonHigh ? ' to ' + tonHigh : '') + ' ton',
      qty: 1, unit: 'ea',
      why: 'Estimated cooling load ' + coolTotal.toLocaleString() + ' BTU/h (' + equipment.coolingTonsNeeded + ' ton) at ' + coolDB + ' F outdoor, ' + indoorCool + ' F indoor' });
  }
  if (heatingBtuh > 0) {
    items.push({ label: 'Heating equipment, ' + _lcRound(heatingBtuh).toLocaleString() + ' to ' + _lcRound(heatingBtuh * 1.15).toLocaleString() + ' BTU/h output',
      qty: 1, unit: 'ea',
      why: 'Estimated heating load ' + _lcRound(heatingBtuh).toLocaleString() + ' BTU/h at ' + heatDB + ' F outdoor, ' + indoorHeat + ' F indoor' });
  }
  items.push({ label: 'Certified load calculation before equipment order', qty: 1, unit: 'ea',
    why: 'This sizing estimate is a planning number and is not a permit document. The certified calculation is the one the inspector and the manufacturer warranty want.' });
  if (ov.ach50 == null || !isFinite(Number(ov.ach50))) {
    items.push({ label: 'Blower door test', qty: 1, unit: 'ea',
      why: 'Air leakage is assumed from the building vintage right now. A measured number replaces the single biggest guess in this estimate.' });
  }
  if (geo.source === 'sqft') {
    items.push({ label: 'Measure the house', qty: 1, unit: 'ea',
      why: 'Wall, glass and ceiling areas were estimated from total square footage. A LiDAR scan measures them instead.' });
  }

  return _lcResult({
    ok: true,
    unit: 'BTU/h',
    value: {
      heatingBtuh: _lcRound(heatingBtuh),
      coolingSensibleBtuh: coolSensibleR,
      coolingLatentBtuh: coolLatentR,
      coolingTotalBtuh: coolTotal,
      equipment: equipment
    },
    inputs: {
      geometry: geo, design: { heatDB: heatDB, coolDB: coolDB, indoorHeatDB: indoorHeat, indoorCoolDB: indoorCool, source: d.source || 'entered by hand' },
      envelope: { vintage: vintKey, zone: (env.zone == null ? null : env.zone), band: band, overrides: ov },
      occupants: occupants, foundation: found.label, ductLocation: duct.label
    },
    assumed: assumed,
    items: items,
    warnings: warnings,
    sources: usedSources,
    detail: {
      dtHeat: dtHeat, dtCool: dtCool,
      uaBtuhF: Math.round(ua * 100) / 100,
      areas: { wallSqFt: aWall, windowSqFt: aWin, doorSqFt: aDoor, ceilingSqFt: aCeil, floorSqFt: aFloor },
      uFactors: { wall: uWall, ceiling: uCeil, floor: uFloor, window: _lcPos(winU), door: _lcPos(doorU), windowSHGC: _lcPos(winSHGC) },
      infiltration: { ach50: _lcPos(ach50), nFactor: nFactor, achNatural: Math.round(achNat * 1000) / 1000, cfm: Math.round(cfm * 10) / 10 },
      loads: {
        heatingEnvelopeBtuh: _lcRound(heatEnvelope), heatingInfiltrationBtuh: _lcRound(infilHeat),
        coolingEnvelopeBtuh: _lcRound(ua * Math.max(0, dtCool)), coolingInfiltrationSensibleBtuh: _lcRound(infilCoolSens),
        coolingInfiltrationLatentBtuh: _lcRound(infilCoolLat), solarBtuh: _lcRound(solar),
        occupantSensibleBtuh: _lcRound(occupants * _lcPos(pSens)), occupantLatentBtuh: _lcRound(occupants * _lcPos(pLat)),
        applianceSensibleBtuh: _lcRound(_lcPos(appl)), ductMultiplier: _lcPos(ductMult)
      },
      rooms: roomRows,
      envelopeTableVerified: LOADCALC_ENVELOPES.verified
    }
  });
}

// ── The impure edge ──────────────────────────────────────────────────────────
// Looks the scan up, looks the design temperatures up, then hands a plain
// object to the pure function. Nothing below this line does arithmetic.
function loadcalcFromScan(scanId, opts) {
  const o = opts || {};
  let scan = null;
  try {
    const list = (typeof getScans === 'function') ? getScans() : [];
    scan = (list || []).find(function (s) { return String(s && s.id) === String(scanId); }) || null;
  } catch (_e) { scan = null; }
  if (!scan) {
    return _lcResult({ ok: false, reason: 'no-scan', inputs: { scanId: scanId },
      warnings: ['That scan could not be found on this account.'] });
  }
  const geo = loadcalcScanGeometry(scan, o);
  if (!geo || geo.ok === false) {
    return _lcResult({ ok: false, reason: geo ? geo.reason : 'no-geometry', inputs: { scanId: scanId },
      warnings: (geo && geo.notes) || ['That scan has no room geometry in it.'] });
  }
  let design = o.design || null;
  if (!design) {
    const look = loadcalcDesignLookup(o.location);
    if (look.ok) design = Object.assign({}, look.design, { source: look.source });
  }
  // A measured blower-door number lives on the scan already (the HVAC lens
  // writes `_ach50`), so it beats the vintage preset without being asked for.
  const overrides = Object.assign({}, (o.envelope && o.envelope.overrides) || {});
  if (overrides.ach50 == null && scan._ach50 != null && isFinite(Number(scan._ach50))) overrides.ach50 = Number(scan._ach50);
  return loadcalcEstimate(Object.assign({}, o, {
    geometry: geo,
    design: design || {},
    envelope: Object.assign({}, o.envelope || {}, { overrides: overrides }),
    scanId: scan.id
  }));
}

if (typeof window !== 'undefined') {
  window.loadcalcEstimate = loadcalcEstimate;
  window.loadcalcScanGeometry = loadcalcScanGeometry;
  window.loadcalcFromScan = loadcalcFromScan;
  window.loadcalcDesignLookup = loadcalcDesignLookup;
  window.loadcalcRegisterDesignTemps = loadcalcRegisterDesignTemps;
  window.loadcalcClearDesignTemps = loadcalcClearDesignTemps;
  window.loadcalcDesignSets = loadcalcDesignSets;
  window.LOADCALC_SOURCES = LOADCALC_SOURCES;
  window.LOADCALC_ENVELOPES = LOADCALC_ENVELOPES;
  window.LOADCALC_NOT_FOR_PERMIT = LOADCALC_NOT_FOR_PERMIT;
  window.LOADCALC_PHYS = LOADCALC_PHYS;
  window.LOADCALC_NOMINAL_TONS = LOADCALC_NOMINAL_TONS;
}
