// ── NEC rules ───────────────────────────────────────────────────────────────
//
// The National Electrical Code, expressed as procedures over a dataset. It
// registers onto js/code-engine.js and obeys that file's three rules, so read
// its header first. The short version, restated here because breaking any one
// of them ships a wrong number onto a permit:
//
//   1. NO VALUES LIVE IN THIS FILE. Not one ampacity, not one demand factor,
//      not one fill percentage. Every number comes out of codes/nec-2023.json,
//      which a human typed from a purchased book. If you find yourself about
//      to write `* 0.35` or `3 // VA per sq ft`, stop: that belongs in the
//      dataset as a null somebody fills in.
//   2. THE PROCEDURES ARE OURS. 17 USC 102(b) does not reach a method of
//      operation, so "sum these, apply the band factors, round up to the next
//      standard size" is ours to write. The book's words and layout are not.
//      See codes/README.md.
//   3. PURE. `(inputs, data, helpers) -> result`. No globals, no clock, no
//      network, no DOM. Same inputs, same answer, forever, which is the only
//      reason a worked example from the book can be used as a test.
//
// WHAT A RULE RETURNS. The shape is fixed by _codeResult in code-engine.js and
// nothing else survives the trip, so everything a caller needs has to fit in
// it. Within that, this module keeps one extra convention:
//
//   `value` is ALWAYS an object of named numbers, never a bare scalar, and
//   `unit` names the primary one. A service calculation genuinely answers
//   three questions at once (what the load is, what it draws, what to install)
//   and picking one to return would just push the other two into a second call
//   that could disagree with the first.
//
// REFUSAL IS A FIRST-CLASS ANSWER. A rule refuses, loudly and by name, when:
//
//   reason 'missing-data'  the dataset leaf it needs is still null. The
//                          warning names the exact path, so "we cannot answer
//                          that yet" is actionable instead of mysterious.
//   reason 'bad-input'     the caller handed us something that is not a
//                          number, or is negative, or names a size the table
//                          does not have.
//   reason 'out-of-range'  the input is real but sits off the end of a table
//                          (an ambient nobody tabulated, a range bigger than
//                          the demand table covers). Off the top of a table is
//                          a real answer and it means ask a pro.
//   reason 'unsupported'   the code section has a branch we have deliberately
//                          not implemented (Table 220.55 Note 2, unequal
//                          ranges). Saying so beats guessing.
//
// Never soften a refusal into a plausible number. A blank screen costs a phone
// call; a wrong service size costs a re-inspection and a rewire.

// ── Small shared plumbing ───────────────────────────────────────────────────

// Dotted path read. Returns undefined rather than throwing, because a half
// filled dataset is the normal state of this file's life, not an error.
function _necGet(obj, path) {
  const parts = String(path).split('.');
  let o = obj;
  for (let i = 0; i < parts.length; i++) {
    if (o === null || o === undefined || typeof o !== 'object') return undefined;
    o = o[parts[i]];
  }
  return o;
}

// "Filled in" means present AND not null AND, for a table, not empty. An empty
// array is exactly as unusable as a null and must refuse the same way.
function _necHas(data, path) {
  const v = _necGet(data, path);
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function _necMissing(data, paths) {
  const out = [];
  for (let i = 0; i < (paths || []).length; i++) {
    if (!_necHas(data, paths[i])) out.push(paths[i]);
  }
  return out;
}

function _necRefuse(reason, message, inputs, cite) {
  return {
    ok: false, reason: reason, value: null, unit: '',
    inputs: inputs || {}, cite: cite || '',
    assumed: [], items: [],
    warnings: [message]
  };
}

function _necRefuseMissing(missing, inputs, cite) {
  return _necRefuse('missing-data',
    'This NEC edition has no value yet for: ' + missing.join(', ') +
    '. Somebody holding the published edition types those into codes/nec-2023.json before this can answer.',
    inputs, cite);
}

// A number, or null if it is not one. Numeric strings are accepted because a
// form field hands us '2200' and refusing that would be pedantry, not safety.
// Everything else, including '', NaN, Infinity and objects, is null.
function _necNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (Array.isArray(v)) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// A count or measurement that cannot sensibly be negative.
function _necNonNeg(v) {
  const n = _necNum(v);
  return (n === null || n < 0) ? null : n;
}

function _necRound(n, places) {
  const p = Math.pow(10, places || 0);
  return Math.round((Number(n) || 0) * p) / p;
}

// Float noise must never push a load onto the next breaker size. Everything
// that feeds a nextUp lookup goes through this first.
const _NEC_EPS = 1e-9;

// An `assumed` entry. Objects rather than strings so a test can check the key
// and the UI still has something printable.
function _necAssume(key, value, label) {
  return { key: key, value: value, label: label };
}

// Band tables (Table 220.45 general lighting demand, and anything shaped like
// it): rows {uptoVa, pct}, ascending, the last row carrying uptoVa null to
// mean "and everything above". Returns null when the rows are malformed, so a
// mistyped dataset refuses instead of quietly under-calculating a service.
//
// The WHOLE table is validated before any of it is used. Validating as we
// accumulate looks equivalent and is not: a small load stops early, so a table
// whose open band was typed FIRST would be accepted for a 12,500 VA dwelling
// and rejected for a 100,000 VA one. A dataset is either usable or it is not,
// and that cannot depend on the load being asked about.
function _necBandDemand(rows, total) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const bands = [];
  let prev = 0, seenOpen = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const pct = _necNum(r.pct);
    if (pct === null || pct < 0) return null;
    if (seenOpen) return null;                                // the open band must be last
    const upto = (r.uptoVa === null || r.uptoVa === undefined) ? Infinity : _necNum(r.uptoVa);
    if (upto === null || upto <= prev) return null;           // not ascending
    if (upto === Infinity) seenOpen = true;
    bands.push({ from: prev, to: upto, pct: pct });
    prev = upto;
  }
  if (!seenOpen) return null;                                 // no "and everything above" row

  let out = 0;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const amount = Math.max(0, Math.min(total, b.to) - b.from);
    if (!amount) continue;
    out += amount * b.pct / 100;
  }
  return out;
}

// Trade sizes ('1/2', '1', '1-1/4', '2-1/2') as numbers, so they can be put in
// order. NEVER trust object key order for these: JavaScript hoists integer-like
// keys ahead of everything else, so Object.keys on a raceway table hands back
// '1' before '1/2' and the "smallest that fits" answer comes out one size too
// big. That bug shipped once in this file and this parser is why it cannot
// again. Returns null for anything it does not recognise.
function _necTradeSizeValue(s) {
  const str = String(s).trim();
  const m = /^(?:(\d+)(?:-(\d+)\/(\d+))?|(\d+)\/(\d+))$/.exec(str);
  if (!m) return null;
  if (m[4] !== undefined) {
    const den = Number(m[5]);
    return den ? Number(m[4]) / den : null;
  }
  const whole = Number(m[1]);
  if (m[2] === undefined) return whole;
  const den = Number(m[3]);
  return den ? whole + Number(m[2]) / den : null;
}

// Ascending, by actual size. Anything unparseable sorts to the end rather than
// being dropped, so a dataset typo is visible instead of silently skipped.
function _necTradeSizesAscending(table) {
  return Object.keys(table || {}).slice().sort(function (a, b) {
    const av = _necTradeSizeValue(a), bv = _necTradeSizeValue(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  });
}

// Count tables (Table 220.54 dryer demand, Table 310.15(C)(1) adjustment):
// rows are either {count, pct} for an exact count or {countFrom, countTo, pct}
// for a band, countTo null meaning open ended. First match wins.
function _necCountPct(rows, count) {
  if (!Array.isArray(rows)) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const pct = _necNum(r.pct);
    if (pct === null) continue;
    if (r.count !== undefined && r.count !== null) {
      if (_necNum(r.count) === count) return pct;
      continue;
    }
    const from = _necNum(r.countFrom);
    const to = (r.countTo === null || r.countTo === undefined) ? Infinity : _necNum(r.countTo);
    if (from === null || to === null) continue;
    if (count >= from && count <= to) return pct;
  }
  return null;
}

// Table 220.55 Column C, same row shapes as above but the payload is kW.
function _necCountKw(rows, count) {
  if (!Array.isArray(rows)) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    if (r.count !== undefined && r.count !== null) {
      if (_necNum(r.count) === count) return _necNum(r.kw);
      continue;
    }
    const from = _necNum(r.countFrom);
    const to = (r.countTo === null || r.countTo === undefined) ? Infinity : _necNum(r.countTo);
    if (from === null || to === null) continue;
    if (count >= from && count <= to) {
      const base = _necNum(r.kwBase);
      const per = _necNum(r.kwPerUnit);
      if (base === null || per === null) return _necNum(r.kw);
      const overFrom = _necNum(r.countOver);
      const over = count - (overFrom === null ? from - 1 : overFrom);
      return base + per * Math.max(0, over);
    }
  }
  return null;
}

// "Each additional kW or MAJOR fraction thereof" (Table 220.55 Note 1). A
// major fraction is more than half. Exactly half is not major, so this is not
// Math.round, which rounds .5 up.
function _necMajorFraction(n) {
  const whole = Math.floor(n);
  return (n - whole > 0.5) ? whole + 1 : whole;
}

// The largest conductor in a set, by AWG. Smaller gauge number is bigger wire,
// so this is a min over the numbers. Only plain AWG sizes are meaningful here
// (the box-fill allowance table stops well short of kcmil), so a size that is
// not a plain number returns null and the caller refuses.
function _necLargestAwg(sizes) {
  let best = null;
  for (let i = 0; i < (sizes || []).length; i++) {
    const n = Number(sizes[i]);
    if (!isFinite(n)) return null;
    if (best === null || n < best) best = n;
  }
  return best === null ? null : String(best);
}

// ── Rule: dwelling-load ─────────────────────────────────────────────────────
//
// Article 220, the service and feeder calculation for a one-family dwelling.
// This is the flagship: the LiDAR scan already knows the conditioned square
// footage, so the contractor supplies nameplates and gets a service size.
//
// Two methods, both real, and which one the caller picked is recorded:
//   'standard' Part III, the long way. Always permitted.
//   'optional' 220.82, permitted for a dwelling served by a single 120/240 V
//              set of service conductors at or above the code's floor.
//
// Inputs (every one of them optional except sqft):
//   method            'standard' | 'optional'
//   sqft              conditioned floor area, square feet
//   volts             service voltage, default 240
//   smallApplianceCircuits, laundryCircuits   default to the code minimums
//   appliances        [{label, va, kind}] where kind is 'fixed' | 'motor'
//   ranges            [{kw}] or rangeKw, the cooking appliances
//   dryers            [{va}] or dryerVa
//   hvac              {acVa, heatPumpVa, supplementalHeatVa, spaceHeatVa,
//                      spaceHeatUnits, centralSpaceHeatVa}
//
// value: {calculatedVa, calculatedAmps, serviceAmps, breakdown:[{label, va, cite}]}
function _necDwellingLoad(inp, data, h) {
  const cite = '220 Part III; 220.82; 230.79(C); 240.6(A)';
  const assumed = [];
  const warnings = [];

  const sqft = _necNonNeg(inp.sqft);
  if (sqft === null) {
    return _necRefuse('bad-input', 'Conditioned floor area (sqft) must be a number of square feet, zero or more.', { sqft: inp.sqft }, cite);
  }

  let method = inp.method === undefined || inp.method === null ? null : String(inp.method);
  if (method !== 'standard' && method !== 'optional') {
    if (method !== null) {
      return _necRefuse('bad-input', 'method must be "standard" or "optional".', { method: inp.method }, cite);
    }
    method = 'standard';
    assumed.push(_necAssume('method', 'standard',
      'Article 220 Part III standard calculation. The 220.82 optional method usually gives a smaller service.'));
  }

  let volts = _necNum(inp.volts);
  if (inp.volts !== undefined && inp.volts !== null && (volts === null || volts <= 0)) {
    return _necRefuse('bad-input', 'volts must be a positive number.', { volts: inp.volts }, cite);
  }
  if (volts === null) {
    volts = 240;
    assumed.push(_necAssume('volts', 240, 'Service voltage 240 V, single phase 3 wire.'));
  }

  // Normalize the appliance inputs into one shape before any arithmetic, so
  // the two methods disagree about factors and never about what is on the job.
  const appliances = [];
  const rawAppl = Array.isArray(inp.appliances) ? inp.appliances : [];
  for (let i = 0; i < rawAppl.length; i++) {
    const a = rawAppl[i] || {};
    const va = _necNonNeg(a.va);
    if (va === null) {
      return _necRefuse('bad-input', 'Appliance "' + (a.label || i) + '" needs a nameplate VA of zero or more.', { appliances: inp.appliances }, cite);
    }
    appliances.push({ label: String(a.label || 'Appliance'), va: va, kind: a.kind === 'motor' ? 'motor' : 'fixed' });
  }

  const ranges = [];
  const rawRanges = Array.isArray(inp.ranges) ? inp.ranges : (inp.rangeKw === undefined || inp.rangeKw === null ? [] : [{ kw: inp.rangeKw }]);
  for (let i = 0; i < rawRanges.length; i++) {
    const r = rawRanges[i] || {};
    const kw = _necNonNeg(r.kw !== undefined ? r.kw : r);
    if (kw === null) {
      return _necRefuse('bad-input', 'Each cooking appliance needs a kW rating of zero or more.', { ranges: inp.ranges, rangeKw: inp.rangeKw }, cite);
    }
    ranges.push({ label: String(r.label || 'Range'), kw: kw });
  }

  const dryers = [];
  const rawDryers = Array.isArray(inp.dryers) ? inp.dryers : (inp.dryerVa === undefined || inp.dryerVa === null ? [] : [{ va: inp.dryerVa }]);
  for (let i = 0; i < rawDryers.length; i++) {
    const d = rawDryers[i] || {};
    const va = _necNonNeg(d.va !== undefined ? d.va : d);
    if (va === null) {
      return _necRefuse('bad-input', 'Each clothes dryer needs a nameplate VA of zero or more.', { dryers: inp.dryers, dryerVa: inp.dryerVa }, cite);
    }
    dryers.push({ label: String(d.label || 'Clothes dryer'), va: va });
  }

  const hv = inp.hvac || {};
  const hvac = {
    acVa: _necNonNeg(hv.acVa) || 0,
    heatPumpVa: _necNonNeg(hv.heatPumpVa) || 0,
    supplementalHeatVa: _necNonNeg(hv.supplementalHeatVa) || 0,
    spaceHeatVa: _necNonNeg(hv.spaceHeatVa) || 0,
    spaceHeatUnits: _necNonNeg(hv.spaceHeatUnits) || 0,
    centralSpaceHeatVa: _necNonNeg(hv.centralSpaceHeatVa) || 0
  };

  const resolved = {
    method: method, sqft: sqft, volts: volts,
    appliances: appliances, ranges: ranges, dryers: dryers, hvac: hvac
  };

  const out = (method === 'optional')
    ? _necDwellingOptional(resolved, inp, data, assumed, warnings)
    : _necDwellingStandard(resolved, inp, data, assumed, warnings);
  if (out.refuse) { out.refuse.inputs = resolved; return out.refuse; }

  const totalVa = out.breakdown.reduce(function (s, b) { return s + b.va; }, 0);
  const amps = totalVa / volts;

  const ocpd = _necGet(data, 'standardOcpdAmps');
  const minSvc = _necNum(_necGet(data, 'dwelling.serviceMinAmps'));
  const miss = _necMissing(data, ['standardOcpdAmps', 'dwelling.serviceMinAmps']);
  if (miss.length) return _necRefuseMissing(miss, resolved, cite);

  const next = h.nextUp(amps - _NEC_EPS, ocpd);
  if (next === null) {
    return _necRefuse('out-of-range',
      'The calculated load of ' + _necRound(amps, 1) + ' A is above the largest standard overcurrent device in the dataset. This one needs an engineer.',
      resolved, cite);
  }
  const serviceAmps = Math.max(next, minSvc);

  warnings.push('Service conductor sizing under 310.12 is a separate step and is not calculated here.');
  warnings.push('Confirm the result against the edition and amendments your inspector enforces.');

  return {
    ok: true,
    value: {
      calculatedVa: _necRound(totalVa, 1),
      calculatedAmps: _necRound(amps, 1),
      serviceAmps: serviceAmps,
      breakdown: out.breakdown.map(function (b) {
        return { label: b.label, va: _necRound(b.va, 1), cite: b.cite };
      })
    },
    unit: 'A',
    inputs: resolved,
    cite: cite,
    assumed: assumed,
    items: [{
      label: 'Service equipment, ' + serviceAmps + ' A',
      qty: 1, unit: 'ea',
      why: 'Calculated load ' + _necRound(totalVa, 0) + ' VA, ' + _necRound(amps, 1) + ' A at ' + volts + ' V'
    }],
    warnings: warnings
  };
}

// 220.52 general lighting, small appliance and laundry, shared by both methods
// because they count the same loads and only the demand factor differs.
function _necDwellingGeneral(r, inp, data, assumed) {
  const need = ['dwelling.generalLightingVaPerSqft', 'dwelling.smallApplianceCircuitVa',
    'dwelling.smallApplianceCircuitsMin', 'dwelling.laundryCircuitVa', 'dwelling.laundryCircuitsMin'];
  const miss = _necMissing(data, need);
  if (miss.length) return { miss: miss };

  const vaSqft = _necNum(_necGet(data, 'dwelling.generalLightingVaPerSqft'));
  const saVa = _necNum(_necGet(data, 'dwelling.smallApplianceCircuitVa'));
  const saMin = _necNum(_necGet(data, 'dwelling.smallApplianceCircuitsMin'));
  const lVa = _necNum(_necGet(data, 'dwelling.laundryCircuitVa'));
  const lMin = _necNum(_necGet(data, 'dwelling.laundryCircuitsMin'));

  let sa = _necNonNeg(inp.smallApplianceCircuits);
  if (sa === null) {
    sa = saMin;
    assumed.push(_necAssume('smallApplianceCircuits', saMin, 'Small appliance branch circuits at the code minimum.'));
  } else if (sa < saMin) {
    sa = saMin;
    assumed.push(_necAssume('smallApplianceCircuits', saMin, 'Raised to the code minimum number of small appliance branch circuits.'));
  }
  let laundry = _necNonNeg(inp.laundryCircuits);
  if (laundry === null) {
    laundry = lMin;
    assumed.push(_necAssume('laundryCircuits', lMin, 'Laundry branch circuits at the code minimum.'));
  }

  return {
    lighting: r.sqft * vaSqft,
    smallAppliance: sa * saVa,
    laundry: laundry * lVa
  };
}

// Table 220.55, the cooking appliance demand. Returns {va} or {refuse}.
function _necCookingDemand(ranges, data) {
  if (!ranges.length) return { va: 0 };

  const c = _necGet(data, 'dwelling.cooking') || {};
  const colALimit = _necNum(c.colALimitKw);
  const colBLimit = _necNum(c.colBLimitKw);
  const colCLimit = _necNum(c.colCLimitKw);
  const colCMax = _necNum(c.colCMaxKw);
  const miss = _necMissing(data, ['dwelling.cooking.colALimitKw', 'dwelling.cooking.colBLimitKw',
    'dwelling.cooking.colCLimitKw', 'dwelling.cooking.colCMaxKw']);
  if (miss.length) return { miss: miss };

  const n = ranges.length;
  const kws = ranges.map(function (x) { return x.kw; });
  const maxKw = Math.max.apply(null, kws);
  const nameplateKw = kws.reduce(function (s, k) { return s + k; }, 0);

  // The small bands work off nameplate and a percentage.
  if (maxKw <= colALimit) {
    const pct = _necCountPct(c.colARows, n);
    if (pct === null) return { miss: ['dwelling.cooking.colARows (count ' + n + ')'] };
    return { va: nameplateKw * 1000 * pct / 100 };
  }
  if (maxKw <= colBLimit) {
    const pct = _necCountPct(c.colBRows, n);
    if (pct === null) return { miss: ['dwelling.cooking.colBRows (count ' + n + ')'] };
    return { va: nameplateKw * 1000 * pct / 100 };
  }

  const colC = _necCountKw(c.colCRows, n);
  if (colC === null) return { miss: ['dwelling.cooking.colCRows (count ' + n + ')'] };

  if (maxKw <= colCLimit) return { va: colC * 1000 };

  if (maxKw > colCMax) {
    return {
      refuse: _necRefuse('out-of-range',
        'A cooking appliance rated ' + maxKw + ' kW is above what Table 220.55 covers. Size it by hand.',
        {}, 'Table 220.55')
    };
  }

  // Note 1 territory. It is written for ranges of the SAME rating; unequal
  // ratings above the limit are Note 2, which averages them and is a different
  // procedure. We refuse rather than approximate.
  const allSame = kws.every(function (k) { return k === kws[0]; });
  if (!allSame) {
    return {
      refuse: _necRefuse('unsupported',
        'Unequal cooking appliances above ' + colCLimit + ' kW fall under Table 220.55 Note 2, which this rule does not implement. Calculate that one by hand.',
        {}, 'Table 220.55 Note 2')
    };
  }
  const perKwPct = _necNum(_necGet(data, 'dwelling.cooking.note1.perKwPct'));
  if (perKwPct === null) return { miss: ['dwelling.cooking.note1.perKwPct'] };
  const steps = _necMajorFraction(maxKw - colCLimit);
  return { va: colC * 1000 * (1 + steps * perKwPct / 100) };
}

// 220.54, electric clothes dryers.
function _necDryerDemand(dryers, data) {
  if (!dryers.length) return { va: 0 };
  const minVa = _necNum(_necGet(data, 'dwelling.dryer.minVa'));
  const miss = _necMissing(data, ['dwelling.dryer.minVa', 'dwelling.dryer.demandRows']);
  if (miss.length) return { miss: miss };
  const total = dryers.reduce(function (s, d) { return s + Math.max(d.va, minVa); }, 0);
  const pct = _necCountPct(_necGet(data, 'dwelling.dryer.demandRows'), dryers.length);
  if (pct === null) return { miss: ['dwelling.dryer.demandRows (count ' + dryers.length + ')'] };
  return { va: total * pct / 100 };
}

function _necDwellingStandard(r, inp, data, assumed, warnings) {
  const gen = _necDwellingGeneral(r, inp, data, assumed);
  if (gen.miss) return { refuse: _necRefuseMissing(gen.miss, {}, '220.52') };

  const lightingTotal = gen.lighting + gen.smallAppliance + gen.laundry;
  const rows = _necGet(data, 'dwelling.generalDemandRows');
  if (!_necHas(data, 'dwelling.generalDemandRows')) {
    return { refuse: _necRefuseMissing(['dwelling.generalDemandRows'], {}, 'Table 220.45') };
  }
  const lightingDemand = _necBandDemand(rows, lightingTotal);
  if (lightingDemand === null) {
    return {
      refuse: _necRefuse('bad-data',
        'dwelling.generalDemandRows in codes/nec-2023.json is not a usable band table: rows must ascend by uptoVa and the last row must carry uptoVa null.',
        {}, 'Table 220.45')
    };
  }

  const breakdown = [{
    label: 'General lighting, receptacles, small appliance and laundry (after demand)',
    va: lightingDemand, cite: '220.41; 220.52; Table 220.45'
  }];

  // 220.53, the four-or-more rule on fastened-in-place appliances.
  const fixed = r.appliances.filter(function (a) { return a.kind === 'fixed'; });
  if (fixed.length) {
    const trig = _necNum(_necGet(data, 'dwelling.fixedAppliance.triggerCount'));
    const pct = _necNum(_necGet(data, 'dwelling.fixedAppliance.pct'));
    const miss = _necMissing(data, ['dwelling.fixedAppliance.triggerCount', 'dwelling.fixedAppliance.pct']);
    if (miss.length) return { refuse: _necRefuseMissing(miss, {}, '220.53') };
    const sum = fixed.reduce(function (s, a) { return s + a.va; }, 0);
    const applied = fixed.length >= trig ? sum * pct / 100 : sum;
    breakdown.push({
      label: 'Fastened-in-place appliances (' + fixed.length + ')',
      va: applied, cite: '220.53'
    });
  }

  const dry = _necDryerDemand(r.dryers, data);
  if (dry.miss) return { refuse: _necRefuseMissing(dry.miss, {}, '220.54') };
  if (dry.va) breakdown.push({ label: 'Electric clothes dryer', va: dry.va, cite: '220.54' });

  const cook = _necCookingDemand(r.ranges, data);
  if (cook.refuse) return { refuse: cook.refuse };
  if (cook.miss) return { refuse: _necRefuseMissing(cook.miss, {}, 'Table 220.55') };
  if (cook.va) breakdown.push({ label: 'Cooking appliances', va: cook.va, cite: 'Table 220.55' });

  // 220.60, noncoincident loads: heat and cooling never run together, so only
  // the larger of the two is in the calculation.
  const heatVa = r.hvac.spaceHeatVa + r.hvac.centralSpaceHeatVa + r.hvac.heatPumpVa + r.hvac.supplementalHeatVa;
  const acVa = r.hvac.acVa;
  if (heatVa || acVa) {
    const heatPct = _necNum(_necGet(data, 'dwelling.heatPct'));
    const acPct = _necNum(_necGet(data, 'dwelling.acPct'));
    const miss = _necMissing(data, ['dwelling.heatPct', 'dwelling.acPct']);
    if (miss.length) return { refuse: _necRefuseMissing(miss, {}, '220.60') };
    const heat = heatVa * heatPct / 100;
    const cool = acVa * acPct / 100;
    breakdown.push({
      label: heat >= cool ? 'Space heating (larger of heat and cooling)' : 'Air conditioning (larger of heat and cooling)',
      va: Math.max(heat, cool), cite: '220.60'
    });
    if (r.hvac.heatPumpVa && r.hvac.acVa) {
      warnings.push('A heat pump compressor that also cools is one load, not two. Confirm it has not been counted on both sides.');
    }
  }

  // 430.24, the largest motor at an uplift on top of everything else.
  const motors = r.appliances.filter(function (a) { return a.kind === 'motor'; });
  if (motors.length) {
    const pct = _necNum(_necGet(data, 'dwelling.largestMotorPct'));
    if (pct === null) return { refuse: _necRefuseMissing(['dwelling.largestMotorPct'], {}, '430.24') };
    const largest = motors.reduce(function (m, a) { return Math.max(m, a.va); }, 0);
    breakdown.push({ label: 'Largest motor uplift', va: largest * pct / 100, cite: '430.24' });
    const motorSum = motors.reduce(function (s, a) { return s + a.va; }, 0);
    breakdown.push({ label: 'Motors at nameplate', va: motorSum, cite: '220.50' });
  }

  return { breakdown: breakdown };
}

function _necDwellingOptional(r, inp, data, assumed, warnings) {
  const gen = _necDwellingGeneral(r, inp, data, assumed);
  if (gen.miss) return { refuse: _necRefuseMissing(gen.miss, {}, '220.82(B)') };

  const o = _necGet(data, 'dwelling.optional') || {};
  const miss = _necMissing(data, ['dwelling.optional.generalFirstVa', 'dwelling.optional.generalFirstPct',
    'dwelling.optional.generalRemainderPct']);
  if (miss.length) return { refuse: _necRefuseMissing(miss, {}, '220.82(B)') };

  // 220.82(B): everything except the heating and cooling, at nameplate, then
  // one band factor over the whole pile. Ranges and dryers get no separate
  // demand factor here, which is the whole point of the optional method.
  let nameplate = gen.lighting + gen.smallAppliance + gen.laundry;
  nameplate += r.appliances.reduce(function (s, a) { return s + a.va; }, 0);
  nameplate += r.ranges.reduce(function (s, x) { return s + x.kw * 1000; }, 0);
  nameplate += r.dryers.reduce(function (s, d) { return s + d.va; }, 0);

  const firstVa = _necNum(o.generalFirstVa);
  const firstPct = _necNum(o.generalFirstPct);
  const remPct = _necNum(o.generalRemainderPct);
  const first = Math.min(nameplate, firstVa) * firstPct / 100;
  const rest = Math.max(0, nameplate - firstVa) * remPct / 100;

  const breakdown = [{
    label: 'General loads at nameplate, banded (' + _necRound(nameplate, 0) + ' VA in)',
    va: first + rest, cite: '220.82(B)'
  }];

  // 220.82(C): six selections, take whichever is largest. Only the ones the
  // caller actually has equipment for are considered.
  const hvac = r.hvac;
  const anyHvac = hvac.acVa || hvac.heatPumpVa || hvac.supplementalHeatVa || hvac.spaceHeatVa || hvac.centralSpaceHeatVa;
  if (anyHvac) {
    const pcts = _necGet(data, 'dwelling.optional.hvacPct') || {};
    const thresh = _necNum(_necGet(data, 'dwelling.optional.heatUnitThreshold'));
    const cand = [];
    const needPct = [];

    function consider(va, pctKey, label) {
      if (!va) return;
      const p = _necNum(pcts[pctKey]);
      if (p === null) { needPct.push('dwelling.optional.hvacPct.' + pctKey); return; }
      cand.push({ va: va * p / 100, label: label });
    }

    consider(hvac.acVa, 'ac', 'Air conditioning');
    if (hvac.heatPumpVa && hvac.supplementalHeatVa) {
      consider(hvac.heatPumpVa + hvac.supplementalHeatVa, 'heatPumpWithSupplemental', 'Heat pump with supplemental heat');
    } else if (hvac.heatPumpVa) {
      consider(hvac.heatPumpVa, 'heatPumpNoSupplemental', 'Heat pump, supplemental locked out');
    }
    if (hvac.spaceHeatVa) {
      if (thresh === null) needPct.push('dwelling.optional.heatUnitThreshold');
      else if (hvac.spaceHeatUnits < thresh) consider(hvac.spaceHeatVa, 'spaceHeatUnder', 'Electric space heating, fewer than ' + thresh + ' units');
      else consider(hvac.spaceHeatVa, 'spaceHeatAtOrOver', 'Electric space heating, ' + thresh + ' units or more');
    }
    consider(hvac.centralSpaceHeatVa, 'centralSpaceHeat', 'Central electric space heating');

    if (needPct.length) return { refuse: _necRefuseMissing(needPct, {}, '220.82(C)') };
    if (cand.length) {
      const win = cand.reduce(function (m, x) { return x.va > m.va ? x : m; }, cand[0]);
      breakdown.push({ label: win.label + ' (largest of the 220.82(C) selections)', va: win.va, cite: '220.82(C)' });
    }
  }

  const minAmps = _necNum(_necGet(data, 'dwelling.optional.minServiceAmps'));
  if (minAmps === null) return { refuse: _necRefuseMissing(['dwelling.optional.minServiceAmps'], {}, '220.82(A)') };
  warnings.push('The optional method applies only to a dwelling served by a single set of 120/240 V service conductors rated ' + minAmps + ' A or more.');

  return { breakdown: breakdown };
}

// ── Rule: conductor-ampacity ────────────────────────────────────────────────
//
// Table 310.16 with the two corrections that are forgotten most often, plus
// the termination limit that quietly caps them both.
//
// Inputs: size, material 'cu'|'al', insulationC 60|75|90, ambientC,
//         currentCarrying, terminationC, lengthFt, conductorsPerRun
// value: {baseAmps, tempFactor, adjustPct, correctedAmps,
//         terminationLimitAmps, allowedAmps, maxOcpdAmps}
function _necConductorAmpacity(inp, data, h) {
  const cite = 'Table 310.16; Table 310.15(B)(1); Table 310.15(C)(1); 110.14(C); 240.4(D)';
  const assumed = [];
  const warnings = [];

  const size = (inp.size === undefined || inp.size === null) ? null : String(inp.size).trim();
  if (!size) return _necRefuse('bad-input', 'size is required, for example "12" or "4/0" or "250".', { size: inp.size }, cite);

  const material = String(inp.material || 'cu').toLowerCase();
  if (material !== 'cu' && material !== 'al') {
    return _necRefuse('bad-input', 'material must be "cu" or "al".', { material: inp.material }, cite);
  }
  if (inp.material === undefined || inp.material === null) {
    assumed.push(_necAssume('material', 'cu', 'Copper conductors.'));
  }

  let insulationC = _necNum(inp.insulationC);
  if (insulationC === null) {
    insulationC = 90;
    assumed.push(_necAssume('insulationC', 90, 'Conductor insulation rated 90 C, the usual THHN/THWN-2.'));
  }
  if (insulationC !== 60 && insulationC !== 75 && insulationC !== 90) {
    return _necRefuse('bad-input', 'insulationC must be 60, 75 or 90.', { insulationC: inp.insulationC }, cite);
  }

  const table = _necGet(data, 'ampacity.' + material);
  if (!table) return _necRefuseMissing(['ampacity.' + material], { size: size, material: material }, cite);
  if (!Object.prototype.hasOwnProperty.call(table, size)) {
    return _necRefuse('bad-input', 'Table 310.16 in this dataset has no size "' + size + '".', { size: size, material: material }, cite);
  }
  const basePath = 'ampacity.' + material + '.' + size + '.' + insulationC;
  const base = _necNum(_necGet(data, basePath));
  if (base === null) return _necRefuseMissing([basePath], { size: size, material: material, insulationC: insulationC }, cite);

  let ambientC = _necNum(inp.ambientC);
  const baseAmbient = _necNum(_necGet(data, 'ampacityBaseAmbientC'));
  if (ambientC === null) {
    if (baseAmbient === null) return _necRefuseMissing(['ampacityBaseAmbientC'], { size: size }, cite);
    ambientC = baseAmbient;
    assumed.push(_necAssume('ambientC', baseAmbient, 'Ambient temperature the table itself is built on, so no correction applies.'));
  }

  let currentCarrying = _necNonNeg(inp.currentCarrying);
  if (currentCarrying === null) {
    currentCarrying = 3;
    assumed.push(_necAssume('currentCarrying', 3, 'Three current-carrying conductors in the raceway or cable.'));
  }

  let terminationC = _necNum(inp.terminationC);
  if (terminationC === null) {
    terminationC = _necNum(_necGet(data, 'terminationDefaultC'));
    if (terminationC === null) return _necRefuseMissing(['terminationDefaultC'], { size: size }, cite);
    assumed.push(_necAssume('terminationC', terminationC, 'Equipment terminations rated ' + terminationC + ' C. Check the label: this is the number that usually decides the answer.'));
  }
  if (terminationC !== 60 && terminationC !== 75 && terminationC !== 90) {
    return _necRefuse('bad-input', 'terminationC must be 60, 75 or 90.', { terminationC: inp.terminationC }, cite);
  }

  // Table 310.15(B)(1), ambient correction.
  const rows = _necGet(data, 'tempCorrectionRows');
  if (!_necHas(data, 'tempCorrectionRows')) return _necRefuseMissing(['tempCorrectionRows'], { ambientC: ambientC }, cite);
  let tempFactor = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const lo = (r.minC === null || r.minC === undefined) ? -Infinity : _necNum(r.minC);
    const hi = (r.maxC === null || r.maxC === undefined) ? Infinity : _necNum(r.maxC);
    if (lo === null || hi === null) continue;
    if (ambientC >= lo && ambientC <= hi) { tempFactor = _necNum(r['f' + insulationC]); break; }
  }
  if (tempFactor === null) {
    return _necRefuse('out-of-range',
      'No ambient correction factor is tabulated for ' + ambientC + ' C at a ' + insulationC + ' C insulation rating.',
      { ambientC: ambientC, insulationC: insulationC }, 'Table 310.15(B)(1)');
  }

  // Table 310.15(C)(1), conductor count adjustment. Below the first tabulated
  // band there is nothing to adjust, which is the table's own premise, not a
  // number we invented.
  const adjRows = _necGet(data, 'adjustmentRows');
  if (!_necHas(data, 'adjustmentRows')) return _necRefuseMissing(['adjustmentRows'], { currentCarrying: currentCarrying }, cite);
  let lowestBand = Infinity;
  for (let i = 0; i < adjRows.length; i++) {
    const f = _necNum((adjRows[i] || {}).countFrom);
    if (f !== null && f < lowestBand) lowestBand = f;
  }
  let adjustPct;
  if (currentCarrying < lowestBand) {
    adjustPct = 100;
  } else {
    adjustPct = _necCountPct(adjRows, currentCarrying);
    if (adjustPct === null) {
      return _necRefuse('out-of-range',
        'No adjustment factor is tabulated for ' + currentCarrying + ' current-carrying conductors.',
        { currentCarrying: currentCarrying }, 'Table 310.15(C)(1)');
    }
  }

  const corrected = base * tempFactor * (adjustPct / 100);

  const termPath = 'ampacity.' + material + '.' + size + '.' + terminationC;
  const termLimit = _necNum(_necGet(data, termPath));
  if (termLimit === null) return _necRefuseMissing([termPath], { size: size, terminationC: terminationC }, cite);

  const allowed = Math.min(corrected, termLimit);
  if (corrected > termLimit) {
    warnings.push('The termination rating, not the conductor, is what limits this run. 110.14(C).');
  }

  const maxOcpd = _necNum(_necGet(data, 'smallConductorMaxOcpd.' + material + '.' + size));
  if (maxOcpd !== null) {
    warnings.push('240.4(D) caps the overcurrent device on ' + size + ' ' + material.toUpperCase() + ' at ' + maxOcpd + ' A regardless of ampacity.');
  }

  const items = [];
  const lengthFt = _necNonNeg(inp.lengthFt);
  if (lengthFt) {
    const per = _necNonNeg(inp.conductorsPerRun) || currentCarrying;
    items.push({
      label: size + ' ' + material.toUpperCase() + ' conductor, ' + insulationC + ' C',
      qty: _necRound(lengthFt * per, 0), unit: 'ft',
      why: lengthFt + ' ft run, ' + per + ' conductors'
    });
  }

  return {
    ok: true,
    value: {
      baseAmps: base,
      tempFactor: tempFactor,
      adjustPct: adjustPct,
      correctedAmps: _necRound(corrected, 1),
      terminationLimitAmps: termLimit,
      allowedAmps: _necRound(allowed, 1),
      maxOcpdAmps: maxOcpd
    },
    unit: 'A',
    inputs: {
      size: size, material: material, insulationC: insulationC, ambientC: ambientC,
      currentCarrying: currentCarrying, terminationC: terminationC
    },
    cite: cite,
    assumed: assumed,
    items: items,
    warnings: warnings
  };
}

// ── Rule: voltage-drop ──────────────────────────────────────────────────────
//
// Voltage drop is NOT an enforceable requirement in the NEC. It lives in
// Informational Notes, and this rule says so every single time rather than
// printing a red FAIL that an inspector never asked for.
//
// Inputs: amps, lengthFt (one way), size, material, phase 1|3, volts,
//         raceway 'pvc'|'steel'|'alum', resistance 'ac'|'dc', parallelSets
// value: {dropVolts, percent, endVolts, ohmsPerKft, adviceMaxPct, withinAdvice}
function _necVoltageDrop(inp, data, h) {
  const cite = 'Chapter 9 Table 8; Chapter 9 Table 9; 210.19(A) Informational Note; 215.2(A) Informational Note';
  const assumed = [];

  const amps = _necNonNeg(inp.amps);
  const lengthFt = _necNonNeg(inp.lengthFt);
  if (amps === null || lengthFt === null) {
    return _necRefuse('bad-input', 'amps and lengthFt must both be numbers of zero or more. lengthFt is the one-way run.',
      { amps: inp.amps, lengthFt: inp.lengthFt }, cite);
  }

  const size = (inp.size === undefined || inp.size === null) ? null : String(inp.size).trim();
  if (!size) return _necRefuse('bad-input', 'size is required.', { size: inp.size }, cite);

  const material = String(inp.material || 'cu').toLowerCase();
  if (material !== 'cu' && material !== 'al') {
    return _necRefuse('bad-input', 'material must be "cu" or "al".', { material: inp.material }, cite);
  }
  if (inp.material === undefined || inp.material === null) assumed.push(_necAssume('material', 'cu', 'Copper conductors.'));

  let phase = _necNum(inp.phase);
  if (phase === null) { phase = 1; assumed.push(_necAssume('phase', 1, 'Single phase.')); }
  if (phase !== 1 && phase !== 3) {
    return _necRefuse('bad-input', 'phase must be 1 or 3.', { phase: inp.phase }, cite);
  }

  let volts = _necNum(inp.volts);
  if (volts === null || volts <= 0) {
    if (inp.volts !== undefined && inp.volts !== null) {
      return _necRefuse('bad-input', 'volts must be a positive number.', { volts: inp.volts }, cite);
    }
    volts = phase === 3 ? 208 : 240;
    assumed.push(_necAssume('volts', volts, 'Nominal system voltage ' + volts + ' V.'));
  }

  let parallelSets = _necNonNeg(inp.parallelSets);
  if (!parallelSets) { parallelSets = 1; }

  let source = String(inp.resistance || '').toLowerCase();
  if (source !== 'ac' && source !== 'dc') {
    source = 'ac';
    assumed.push(_necAssume('resistance', 'ac', 'Chapter 9 Table 9 effective impedance, which is what a raceway run actually sees.'));
  }
  let raceway = String(inp.raceway || '').toLowerCase();
  if (source === 'ac' && ['pvc', 'steel', 'alum'].indexOf(raceway) < 0) {
    raceway = 'pvc';
    assumed.push(_necAssume('raceway', 'pvc', 'Nonmetallic raceway.'));
  }

  const props = _necGet(data, 'conductorProps.' + material);
  if (!props) return _necRefuseMissing(['conductorProps.' + material], { size: size, material: material }, cite);
  if (!Object.prototype.hasOwnProperty.call(props, size)) {
    return _necRefuse('bad-input', 'The conductor property table in this dataset has no size "' + size + '".', { size: size }, cite);
  }
  const key = source === 'dc' ? 'dcOhmsPerKft'
    : (raceway === 'steel' ? 'acOhmsPerKftSteel' : raceway === 'alum' ? 'acOhmsPerKftAlum' : 'acOhmsPerKftPvc');
  const path = 'conductorProps.' + material + '.' + size + '.' + key;
  const ohmsPerKft = _necNum(_necGet(data, path));
  if (ohmsPerKft === null) return _necRefuseMissing([path], { size: size, material: material }, cite);

  // Two conductors of length in a single phase loop; the line-to-line figure
  // on three phase is the root-three form.
  const mult = phase === 3 ? Math.sqrt(3) : 2;
  const dropVolts = mult * amps * (ohmsPerKft / 1000) * lengthFt / parallelSets;
  const percent = volts ? (dropVolts / volts) * 100 : null;

  const scope = String(inp.scope || 'branch').toLowerCase();
  const advicePath = scope === 'feeder-and-branch' ? 'voltageDropAdviceTotalPct' : 'voltageDropAdviceBranchPct';
  const advice = _necNum(_necGet(data, advicePath));

  return {
    ok: true,
    value: {
      dropVolts: _necRound(dropVolts, 2),
      percent: percent === null ? null : _necRound(percent, 2),
      endVolts: _necRound(volts - dropVolts, 2),
      ohmsPerKft: ohmsPerKft,
      adviceMaxPct: advice,
      withinAdvice: (advice === null || percent === null) ? null : percent <= advice
    },
    unit: 'V',
    inputs: {
      amps: amps, lengthFt: lengthFt, size: size, material: material,
      phase: phase, volts: volts, resistance: source, raceway: raceway, parallelSets: parallelSets
    },
    cite: cite,
    assumed: assumed,
    items: [],
    warnings: ['Voltage drop is an Informational Note in the NEC, not a requirement. Treat this as engineering advice, not a code pass or fail.']
  };
}

// ── Rule: conduit-fill ──────────────────────────────────────────────────────
//
// Inputs: conduit, tradeSize, conductors [{size, insulation, count}],
//         nipple, lengthFt
// value: {conductorCount, conductorAreaSqIn, allowedAreaSqIn, conduitAreaSqIn,
//         percentFill, fits, minTradeSize}
function _necConduitFill(inp, data, h) {
  const cite = 'Chapter 9 Table 1 and Note 4; Chapter 9 Table 4; Chapter 9 Table 5; 300.17';
  const assumed = [];
  const warnings = [];

  const conduit = String(inp.conduit || '').toLowerCase();
  if (!conduit) return _necRefuse('bad-input', 'conduit is required, for example "emt".', { conduit: inp.conduit }, cite);
  const conduitTable = _necGet(data, 'conduitArea.' + conduit);
  if (!conduitTable) {
    return _necRefuse('bad-input', 'This dataset has no raceway type "' + conduit + '".', { conduit: conduit }, cite);
  }

  const conductors = Array.isArray(inp.conductors) ? inp.conductors : null;
  if (!conductors || !conductors.length) {
    return _necRefuse('bad-input', 'conductors must be a non-empty array of {size, insulation, count}.', { conductors: inp.conductors }, cite);
  }

  let count = 0, area = 0;
  const missing = [];
  for (let i = 0; i < conductors.length; i++) {
    const c = conductors[i] || {};
    const n = _necNonNeg(c.count === undefined ? 1 : c.count);
    const size = (c.size === undefined || c.size === null) ? null : String(c.size).trim();
    if (n === null || !size) {
      return _necRefuse('bad-input', 'Each conductor entry needs a size and a count of zero or more.', { conductors: inp.conductors }, cite);
    }
    let insul = (c.insulation === undefined || c.insulation === null) ? null : String(c.insulation).toLowerCase();
    if (!insul) {
      insul = 'thhn-thwn-2';
      assumed.push(_necAssume('insulation', insul, 'THHN/THWN-2 insulation on the ' + size + ' conductors.'));
    }
    const table = _necGet(data, 'conductorAreaSqIn.' + insul);
    if (!table) {
      return _necRefuse('bad-input', 'This dataset has no insulation type "' + insul + '".', { conductors: inp.conductors }, cite);
    }
    if (!Object.prototype.hasOwnProperty.call(table, size)) {
      return _necRefuse('bad-input', 'Chapter 9 Table 5 in this dataset has no size "' + size + '".', { conductors: inp.conductors }, cite);
    }
    const a = _necNum(table[size]);
    if (a === null) { missing.push('conductorAreaSqIn.' + insul + '.' + size); continue; }
    count += n;
    area += n * a;
  }
  if (missing.length) return _necRefuseMissing(missing, { conduit: conduit }, cite);
  if (!count) return _necRefuse('bad-input', 'The conductor list adds up to zero conductors.', { conductors: inp.conductors }, cite);

  const nipple = inp.nipple === true;

  // Which printed column applies. The book prints these columns already
  // rounded, so read the column when it is there and only fall back to
  // multiplying the total area when it is not.
  function allowedFor(entry) {
    if (!entry) return null;
    const printed = nipple ? entry.nippleSqIn
      : count === 1 ? entry.oneSqIn
        : count === 2 ? entry.twoSqIn
          : entry.over2SqIn;
    const p = _necNum(printed);
    if (p !== null) return { sqIn: p, computed: false };
    const total = _necNum(entry.totalSqIn);
    const pctKey = nipple ? 'nipple' : count === 1 ? 'one' : count === 2 ? 'two' : 'overTwo';
    const pct = _necNum(_necGet(data, 'fillPct.' + pctKey));
    if (total === null || pct === null) return null;
    return { sqIn: total * pct / 100, computed: true, pct: pct };
  }

  const tradeSize = (inp.tradeSize === undefined || inp.tradeSize === null) ? null : String(inp.tradeSize).trim();

  // The smallest trade size of this raceway type that holds the bundle. This is
  // the number the contractor actually wants: not "does 1/2 work" but "what do
  // I buy". Sorted by real size, never by object key order, see
  // _necTradeSizesAscending.
  let minTradeSize = null;
  const sizesInOrder = _necTradeSizesAscending(conduitTable);
  for (let i = 0; i < sizesInOrder.length; i++) {
    const al = allowedFor(conduitTable[sizesInOrder[i]]);
    if (al && area <= al.sqIn + _NEC_EPS) { minTradeSize = sizesInOrder[i]; break; }
  }

  if (!tradeSize) {
    if (!minTradeSize) {
      return _necRefuseMissing(['conduitArea.' + conduit + ' (no trade size in this dataset has a usable area yet)'], { conduit: conduit }, cite);
    }
    assumed.push(_necAssume('tradeSize', minTradeSize, 'Smallest ' + conduit.toUpperCase() + ' that holds this bundle.'));
  }
  const useSize = tradeSize || minTradeSize;
  if (!Object.prototype.hasOwnProperty.call(conduitTable, useSize)) {
    return _necRefuse('bad-input', conduit.toUpperCase() + ' has no trade size "' + useSize + '" in this dataset.', { conduit: conduit, tradeSize: useSize }, cite);
  }
  const entry = conduitTable[useSize];
  const al = allowedFor(entry);
  if (!al) {
    return _necRefuseMissing(['conduitArea.' + conduit + '.' + useSize + ' (printed fill column or totalSqIn plus fillPct)'], { conduit: conduit, tradeSize: useSize }, cite);
  }
  if (al.computed) {
    warnings.push('Allowed area was computed as ' + al.pct + '% of the raceway area because the printed fill column is not typed in yet. The book rounds its own columns, so this can differ in the last digit.');
  }
  const totalSqIn = _necNum(entry.totalSqIn);

  const fits = area <= al.sqIn + _NEC_EPS;
  if (!fits) warnings.push('This bundle does not fit. The smallest ' + conduit.toUpperCase() + ' that does is ' + (minTradeSize || 'not in this dataset') + '.');

  const items = [];
  const lengthFt = _necNonNeg(inp.lengthFt);
  if (lengthFt) {
    items.push({
      label: (minTradeSize || useSize) + ' in ' + conduit.toUpperCase(),
      qty: _necRound(lengthFt, 0), unit: 'ft',
      why: count + ' conductors, ' + _necRound(area, 4) + ' sq in of fill'
    });
  }

  return {
    ok: true,
    value: {
      conductorCount: count,
      conductorAreaSqIn: _necRound(area, 4),
      allowedAreaSqIn: _necRound(al.sqIn, 4),
      conduitAreaSqIn: totalSqIn,
      percentFill: totalSqIn ? _necRound((area / totalSqIn) * 100, 2) : null,
      fits: fits,
      minTradeSize: minTradeSize
    },
    unit: '%',
    inputs: { conduit: conduit, tradeSize: useSize, nipple: nipple, conductors: conductors },
    cite: cite,
    assumed: assumed,
    items: items,
    warnings: warnings
  };
}

// ── Rule: box-fill ──────────────────────────────────────────────────────────
//
// 314.16(B). Every allowance is reported as its own line, because the argument
// on site is never about the total, it is about whether the clamps counted.
//
// Inputs: boxCuIn or box (a key in data.boxVolumeCuIn),
//         conductors [{size, count}], devices, clamps, supportFittings,
//         grounds {size, count}, isolatedGround
// value: {requiredCuIn, boxCuIn, fits, spareCuIn, allowances:[{label, cuIn, cite}]}
function _necBoxFill(inp, data, h) {
  const cite = '314.16(A); 314.16(B); Table 314.16(B)';
  const assumed = [];
  const warnings = [];

  const allow = _necGet(data, 'boxVolumeAllowanceCuIn');
  if (!allow) return _necRefuseMissing(['boxVolumeAllowanceCuIn'], {}, cite);

  const conductors = Array.isArray(inp.conductors) ? inp.conductors : null;
  if (!conductors || !conductors.length) {
    return _necRefuse('bad-input', 'conductors must be a non-empty array of {size, count}.', { conductors: inp.conductors }, cite);
  }

  const missing = [];
  const sizesPresent = [];
  let conductorCuIn = 0, conductorCount = 0;
  for (let i = 0; i < conductors.length; i++) {
    const c = conductors[i] || {};
    const size = (c.size === undefined || c.size === null) ? null : String(c.size).trim();
    const n = _necNonNeg(c.count === undefined ? 1 : c.count);
    if (!size || n === null) {
      return _necRefuse('bad-input', 'Each conductor entry needs a size and a count of zero or more.', { conductors: inp.conductors }, cite);
    }
    if (!Object.prototype.hasOwnProperty.call(allow, size)) {
      return _necRefuse('bad-input', 'Table 314.16(B) in this dataset has no size "' + size + '".', { conductors: inp.conductors }, cite);
    }
    const v = _necNum(allow[size]);
    if (v === null) { missing.push('boxVolumeAllowanceCuIn.' + size); continue; }
    if (n > 0) sizesPresent.push(size);
    conductorCuIn += n * v;
    conductorCount += n;
  }

  const grounds = inp.grounds || null;
  let groundSize = null, groundCount = 0;
  if (grounds) {
    groundCount = _necNonNeg(grounds.count === undefined ? 1 : grounds.count) || 0;
    groundSize = (grounds.size === undefined || grounds.size === null) ? null : String(grounds.size).trim();
    if (groundCount > 0) {
      if (!groundSize || !Object.prototype.hasOwnProperty.call(allow, groundSize)) {
        return _necRefuse('bad-input', 'The grounding conductor size is missing or is not in Table 314.16(B) in this dataset.', { grounds: inp.grounds }, cite);
      }
      if (_necNum(allow[groundSize]) === null) missing.push('boxVolumeAllowanceCuIn.' + groundSize);
    }
  }

  if (missing.length) return _necRefuseMissing(missing, {}, cite);

  const largest = _necLargestAwg(sizesPresent);
  if (largest === null) {
    return _necRefuse('bad-input', 'Box fill allowances are per AWG size. One of the conductor sizes is not a plain AWG number.', { conductors: inp.conductors }, cite);
  }
  const largestCuIn = _necNum(allow[largest]);

  const allowances = [];
  if (conductorCuIn) {
    allowances.push({ label: conductorCount + ' conductors', cuIn: conductorCuIn, cite: '314.16(B)(1)' });
  }

  // (B)(2). One or more internal cable clamps is ONE allowance, not one each.
  if (inp.clamps === true) {
    allowances.push({ label: 'Internal cable clamps', cuIn: largestCuIn, cite: '314.16(B)(2)' });
  }

  // (B)(3). Each fixture stud or hickey is its own allowance.
  const fittings = _necNonNeg(inp.supportFittings) || 0;
  if (fittings) {
    allowances.push({ label: fittings + ' support fittings', cuIn: fittings * largestCuIn, cite: '314.16(B)(3)' });
  }

  // (B)(4). Each yoke, at the multiplier, sized on the largest conductor
  // connected to it. We use the largest in the box unless told otherwise,
  // which is the conservative direction.
  const devices = _necNonNeg(inp.devices) || 0;
  if (devices) {
    const mult = _necNum(_necGet(data, 'boxDeviceMultiplier'));
    if (mult === null) return _necRefuseMissing(['boxDeviceMultiplier'], {}, '314.16(B)(4)');
    let devSize = (inp.deviceConductorSize === undefined || inp.deviceConductorSize === null) ? null : String(inp.deviceConductorSize).trim();
    if (!devSize) {
      devSize = largest;
      assumed.push(_necAssume('deviceConductorSize', largest, 'Devices counted against the largest conductor in the box.'));
    }
    if (!Object.prototype.hasOwnProperty.call(allow, devSize) || _necNum(allow[devSize]) === null) {
      return _necRefuseMissing(['boxVolumeAllowanceCuIn.' + devSize], {}, '314.16(B)(4)');
    }
    allowances.push({ label: devices + ' devices or yokes', cuIn: devices * mult * _necNum(allow[devSize]), cite: '314.16(B)(4)' });
  }

  // (B)(5). ALL equipment grounding conductors together count as one, plus one
  // more for an isolated ground group. Counting them individually is the most
  // common way to oversize a box.
  if (groundCount > 0) {
    const gv = _necNum(allow[groundSize]);
    const n = 1 + (inp.isolatedGround === true ? 1 : 0);
    allowances.push({
      label: groundCount + ' equipment grounding conductors' + (inp.isolatedGround === true ? ' plus an isolated ground' : ''),
      cuIn: n * gv, cite: '314.16(B)(5)'
    });
  }

  const requiredCuIn = allowances.reduce(function (s, a) { return s + a.cuIn; }, 0);

  let boxCuIn = _necNum(inp.boxCuIn);
  if (boxCuIn === null && inp.box) {
    const key = String(inp.box);
    const map = _necGet(data, 'boxVolumeCuIn') || {};
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      return _necRefuse('bad-input', 'This dataset has no box named "' + key + '".', { box: inp.box }, cite);
    }
    boxCuIn = _necNum(map[key]);
    if (boxCuIn === null) return _necRefuseMissing(['boxVolumeCuIn.' + key], {}, '314.16(A)');
  }

  const fits = boxCuIn === null ? null : boxCuIn + _NEC_EPS >= requiredCuIn;
  if (fits === false) warnings.push('This box is too small for what is going in it. It needs at least ' + _necRound(requiredCuIn, 2) + ' cubic inches.');
  if (boxCuIn === null) warnings.push('No box volume was supplied, so this is the required volume only. Boxes below 100 cubic inches carry their volume on the box.');

  const items = [];
  if (fits !== true) {
    items.push({
      label: 'Box, ' + _necRound(requiredCuIn, 2) + ' cu in minimum',
      qty: 1, unit: 'ea',
      why: conductorCount + ' conductors, ' + devices + ' devices'
    });
  }

  return {
    ok: true,
    value: {
      requiredCuIn: _necRound(requiredCuIn, 3),
      boxCuIn: boxCuIn,
      fits: fits,
      spareCuIn: boxCuIn === null ? null : _necRound(boxCuIn - requiredCuIn, 3),
      allowances: allowances.map(function (a) { return { label: a.label, cuIn: _necRound(a.cuIn, 3), cite: a.cite }; })
    },
    unit: 'in3',
    inputs: {
      conductors: conductors, devices: devices, clamps: inp.clamps === true,
      supportFittings: fittings, grounds: grounds, isolatedGround: inp.isolatedGround === true,
      boxCuIn: boxCuIn
    },
    cite: cite,
    assumed: assumed,
    items: items,
    warnings: warnings
  };
}

// ── Registration ────────────────────────────────────────────────────────────


// ── 210.52(A)(1): how many receptacles a wall space needs ────────────────────
//
// The caller measures the house and hands over wall spaces in feet; this says
// how many receptacles each one takes. The split is deliberate and it is the
// whole point of putting this here: measuring a wall is OUR geometry and it is
// always allowed, while deciding how far apart receptacles may sit is the
// book's and it waits for the book.
//
// This rule exists because those distances were living as literals in
// js/scan.js, typed from memory, feeding a priced bid line whose note cited
// "NEC 210.52" by name. A number on a contractor's bid, with the code cited as
// its authority, that nobody ever read out of the code. That is the exposure
// the whole codes/ design exists to remove, and it does not care that it was
// only four numbers.
function _necReceptacleSpacing(inp, data, h) {
  const cite = '210.52(A)(1)';
  const sp = _necGet(data, 'receptacleSpacing') || {};
  const maxGap = _necNum(sp.maxGapFt);
  const fromBreak = _necNum(sp.fromBreakFt);
  const minSpace = _necNum(sp.minWallSpaceFt);

  const missing = [];
  if (maxGap === null || maxGap <= 0) missing.push('receptacleSpacing.maxGapFt');
  if (fromBreak === null || fromBreak <= 0) missing.push('receptacleSpacing.fromBreakFt');
  if (minSpace === null || minSpace < 0) missing.push('receptacleSpacing.minWallSpaceFt');
  if (missing.length) return _necRefuseMissing(missing, inp, cite);

  const spaces = Array.isArray(inp.wallSpaceFt) ? inp.wallSpaceFt : null;
  if (!spaces) {
    return _necRefuse('bad-input', 'wallSpaceFt must be an array of wall space lengths in feet.', inp, cite);
  }

  let total = 0;
  const per = [];
  for (let i = 0; i < spaces.length; i++) {
    const ft = _necNum(spaces[i]);
    if (ft === null || ft < 0) {
      return _necRefuse('bad-input', 'Every wall space must be a length in feet, zero or more.', inp, cite);
    }
    // Under the smallest wall space the rule speaks to, nothing is required.
    if (ft < minSpace) { per.push(0); continue; }
    // No point along the space may be further than fromBreak from a
    // receptacle, which is the same as saying they sit at most maxGap apart.
    const n = Math.max(1, h.up(ft / maxGap));
    per.push(n);
    total += n;
  }

  return {
    ok: true, value: total, unit: 'receptacles', cite: cite,
    inputs: { wallSpaceFt: spaces },
    detail: { perSpace: per, maxGapFt: maxGap, fromBreakFt: fromBreak, minWallSpaceFt: minSpace },
    items: total ? [{ label: 'Receptacle', qty: total, unit: 'ea',
                      why: 'Spacing required by NEC ' + cite }] : []
  };
}

// ── 210.8(A): which rooms need GFCI protection ───────────────────────────────
//
// A list, not a calculation, and it is still the book's list. Same reason as
// above: "GFCI-required room" was a hardcoded array of six words.
function _necGfciRequired(inp, data, h) {
  const cite = '210.8(A)';
  const kinds = _necGet(data, 'gfciRoomKinds');
  if (!Array.isArray(kinds) || !kinds.length) {
    return _necRefuseMissing(['gfciRoomKinds'], inp, cite);
  }
  const name = String(inp.roomName === undefined ? '' : inp.roomName).toLowerCase();
  if (!name) {
    return _necRefuse('bad-input', 'roomName is required.', inp, cite);
  }
  const hit = kinds.filter(function (k) {
    const word = String((k && k.kind !== undefined) ? k.kind : k || '').toLowerCase();
    return word && name.indexOf(word) >= 0;
  }).map(function (k) { return String((k && k.kind !== undefined) ? k.kind : k); });

  return {
    ok: true, value: hit.length > 0, unit: '', cite: cite,
    inputs: { roomName: inp.roomName },
    detail: { matched: hit }
  };
}

const NEC_RULES = {
  'dwelling-load': _necDwellingLoad,
  'conductor-ampacity': _necConductorAmpacity,
  'voltage-drop': _necVoltageDrop,
  'conduit-fill': _necConduitFill,
  'box-fill': _necBoxFill,
  'receptacle-spacing': _necReceptacleSpacing,
  'gfci-required': _necGfciRequired
};

// Takes a parsed dataset file and hands the engine a set. The rules are the
// same functions for every edition; only the numbers differ, which is the
// whole reason editions accumulate rather than fork.
function necRegisterDataset(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.family !== 'nec' || !json.edition) return false;
  if (typeof codeRegister !== 'function') return false;
  return codeRegister({
    family: 'nec',
    edition: String(json.edition),
    // Never coerce this to anything but the file's own boolean. A dataset that
    // forgot the flag is unverified, full stop.
    verified: json.verified === true,
    verifiedBy: json.verifiedBy || '',
    verifiedAt: json.verifiedAt || '',
    sources: json.sources || {},
    todo: json.todo || [],
    data: json.data || {},
    rules: NEC_RULES
  });
}

// Fetches one edition file and registers it. Returns false rather than
// throwing on any failure: a missing code file must never break app boot.
async function necLoadCodes(url) {
  const u = url || 'codes/nec-2023.json';
  try {
    const res = await fetch(u, { cache: 'no-store' });
    if (!res || !res.ok) return false;
    const json = await res.json();
    return necRegisterDataset(json);
  } catch (e) {
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.necRules = NEC_RULES;
  window.necRegisterDataset = necRegisterDataset;
  window.necLoadCodes = necLoadCodes;
  // Self-load when the engine is present, so adding the two script tags is the
  // whole install. Guarded for tests that want to control registration.
  if (typeof codeRegister === 'function' && window.__necNoAutoLoad !== true) {
    necLoadCodes();
  }
}
