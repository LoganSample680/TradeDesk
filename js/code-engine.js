// ── The code engine ─────────────────────────────────────────────────────────
//
// Owner directive 2026-09-07: the code books drive the estimate, behind the
// scenes, correctly. He never opens a calculator. He builds an estimate, this
// runs on what is already on it, and the required lines appear in the same
// card the history suggestions use, at his prices, one tap.
//
// THREE RULES, and they are the whole design.
//
// 1. FACTS AND PROCEDURES, NEVER DOCUMENTS. See codes/README.md. Every dataset
//    under codes/ is values and rules in OUR schema, typed out of a purchased
//    book. No code text, no layout, no scans. A citation is a reference and is
//    fine; a paragraph is not.
//
// 2. NOTHING UNVERIFIED EVER REACHES A RESULT. A dataset an LLM drafted is
//    plausible and wrong, and a wrong ampacity on a permit is the worst thing
//    this product could ship. `verified:false` returns no answer at all. A
//    human holding the edition flips it, by name, on a date.
//
// 3. PURE, LIKE THE DERIVER. Same inputs, same answer, always, no clock, no
//    network, no globals (see js/geo-derive.js, which earned this rule the
//    hard way). That is what makes it testable against the code's own
//    published worked examples, which is how we prove correctness rather than
//    assert it.
//
// The result object carries five things, and it carries them together on
// purpose: the answer, what went in, which edition, every default the engine
// filled in, and the citation. That one object is the audit trail, the
// disclaimer, and what prints on the proposal. Anything that returns a bare
// number is wrong.

// Loaded datasets, keyed 'family:edition'. Registered at boot, never mutated.
const _CODE_SETS = Object.create(null);

// A rule id is 'family:edition:rule', e.g. 'nec:2023:dwelling-load'.
function codeRegister(set) {
  if (!set || !set.family || !set.edition) return false;
  const key = String(set.family) + ':' + String(set.edition);
  _CODE_SETS[key] = set;
  return true;
}
function codeSet(family, edition) {
  return _CODE_SETS[String(family) + ':' + String(edition)] || null;
}
function codeEditions(family) {
  const f = String(family) + ':';
  return Object.keys(_CODE_SETS).filter(k => k.indexOf(f) === 0)
    .map(k => k.slice(f.length)).sort();
}

// Which edition this account is on for a family. He confirms it once, because
// he knows what his inspector enforces and no public dataset does: the only
// vendor holding local amendments (UpCodes) does not sell an API, and every
// other source is state-level. Asking beats pretending.
function codeEditionFor(family, opts) {
  const o = opts || {};
  if (o.edition) return String(o.edition);
  const s = (typeof S !== 'undefined' && S && S.codeEditions) ? S.codeEditions : null;
  if (s && s[family]) return String(s[family]);
  return null;
}

// The one result shape. Nothing else may be returned to a caller.
function _codeResult(fields) {
  const f = fields || {};
  return {
    ok: f.ok !== false,
    reason: f.reason || '',
    value: (f.value === undefined ? null : f.value),
    unit: f.unit || '',
    // What the caller handed us, echoed back. A result you cannot reproduce
    // is not a record of anything.
    inputs: f.inputs || {},
    // Which book, which edition. Prints on the output, every time.
    family: f.family || '',
    edition: f.edition || '',
    // Section reference. A pointer, never the text.
    cite: f.cite || '',
    // Every value the engine chose because the caller did not supply one.
    // Owner rule: never auto-fill silently. A default he never saw is the
    // failure mode with our name on it, so they are listed and they print.
    assumed: f.assumed || [],
    // Lines this rule says the job needs, ready for _geiAddRememberedLine.
    // {label, qty, unit, why} - never a price. His book prices it.
    items: f.items || [],
    // Anything the contractor must confirm before this is trustworthy.
    warnings: f.warnings || [],
    // The working shown. A caller that has to place what the rule counted
    // (receptacles along a wall, conductors in a raceway) needs the breakdown,
    // not just the total, and dropping it here silently gave one caller a
    // count of five and nowhere to draw them. js/loadcalc.js already carries
    // the same field for the same reason.
    detail: f.detail || {}
  };
}

// THE entry point. Every code calculation in the app comes through here.
//
//   codeEval('nec', 'dwelling-load', {sqft: 2200, ...})
//
// Returns the result shape above, always, including on refusal. Callers branch
// on `ok` and must render nothing when it is false.
function codeEval(family, ruleId, inputs, opts) {
  const o = opts || {};
  const inp = inputs || {};
  const edition = codeEditionFor(family, o);
  if (!edition) {
    return _codeResult({ ok: false, reason: 'no-edition', family: family, inputs: inp,
      warnings: ['Confirm which ' + String(family).toUpperCase() + ' edition your inspector enforces.'] });
  }
  const set = codeSet(family, edition);
  if (!set) {
    return _codeResult({ ok: false, reason: 'no-dataset', family: family, edition: edition, inputs: inp });
  }
  // Rule 2. This is the gate, and it is not negotiable or configurable.
  if (!set.verified) {
    return _codeResult({ ok: false, reason: 'unverified', family: family, edition: edition, inputs: inp,
      warnings: ['This code data has not been checked against the published edition yet.'] });
  }
  const rule = set.rules && set.rules[ruleId];
  if (typeof rule !== 'function') {
    return _codeResult({ ok: false, reason: 'no-rule', family: family, edition: edition, inputs: inp });
  }
  let out;
  try {
    out = rule(inp, set.data || {}, _codeHelpers);
  } catch (e) {
    return _codeResult({ ok: false, reason: 'threw', family: family, edition: edition, inputs: inp });
  }
  if (!out || typeof out !== 'object') {
    return _codeResult({ ok: false, reason: 'no-result', family: family, edition: edition, inputs: inp });
  }
  return _codeResult(Object.assign({}, out, {
    family: family, edition: edition,
    inputs: Object.assign({}, inp, out.inputs || {})
  }));
}

// Shared arithmetic every family needs. Kept here so a rounding rule is
// decided once rather than three times, three ways.
const _codeHelpers = {
  // Codes round in specified directions and the direction is part of the
  // rule, never a preference. A caller that wants "about right" is in the
  // wrong module.
  up: function (n) { return Math.ceil(Number(n) || 0); },
  down: function (n) { return Math.floor(Number(n) || 0); },
  // The next size at or above a value, from an ascending list of standard
  // sizes. The single most common move in every code book there is.
  nextUp: function (n, sizes) {
    const v = Number(n) || 0;
    const list = (sizes || []).slice().sort(function (a, b) { return a - b; });
    for (let i = 0; i < list.length; i++) if (list[i] >= v) return list[i];
    return null;   // off the top of the table is a real answer: it means ask a pro
  },
  // Largest listed size at or below. Used where a code rounds down.
  nextDown: function (n, sizes) {
    const v = Number(n) || 0;
    const list = (sizes || []).slice().sort(function (a, b) { return b - a; });
    for (let i = 0; i < list.length; i++) if (list[i] <= v) return list[i];
    return null;
  },
  num: function (n, dflt) { const v = Number(n); return isFinite(v) ? v : (dflt || 0); }
};

if (typeof window !== 'undefined') {
  window.codeRegister = codeRegister;
  window.codeSet = codeSet;
  window.codeEditions = codeEditions;
  window.codeEditionFor = codeEditionFor;
  window.codeEval = codeEval;
}
