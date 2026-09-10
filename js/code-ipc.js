// ── Plumbing: the IPC and the UPC, side by side, never touching ─────────────
//
// Two families live in this one file because they answer the same five
// questions with different numbers, and keeping them apart is the entire job.
//
// THE DIVERGENCE, and why it is the design concern and not a detail.
// The IPC and the UPC assign different drainage fixture unit values to the
// same fixture. Same bathtub, same house, two books, two numbers, and the
// gap is large enough to move a total across a pipe size boundary. Nobody
// gets a citation for it. What happens is the drain is undersized, it backs
// up two years later, and it is our number on the permit.
//
// So the failure mode this module is built against is not "wrong arithmetic,"
// it is "right arithmetic on the other book's table," which looks perfect all
// the way to the inspection. Five things make it structurally impossible
// rather than merely unlikely:
//
//   1. TWO FILES, NEVER MERGED. codes/ipc-2021.json and codes/upc-2024.json
//      are separate datasets registered under separate families. There is no
//      merge step, no default, no "fall back to the other one," and no shared
//      table anywhere in this file. Grep it: this module contains no fixture
//      unit, no pipe size, no capacity. Not one. Every number comes out of
//      the dataset the engine hands the rule.
//
//   2. THE RULES ARE STAMPED WITH THEIR FAMILY AT BUILD TIME. `_plumbRules
//      ('ipc')` and `_plumbRules('upc')` build two separate closures. Each
//      rule's first act is to compare the family it was built for against
//      `data.family` written inside the dataset. A mismatch returns
//      {ok:false, reason:'family-mismatch'} and no value. So even if someone
//      registers the UPC file under the 'ipc' key, or swaps the files on
//      disk, the rule refuses instead of computing.
//
//   3. REGISTRATION CHECKS THE FILE'S OWN DECLARATION. codeIpcRegister()
//      reads `family` out of the JSON and registers under THAT, never under
//      a caller-supplied name. You cannot mislabel a dataset at the door.
//
//   4. CITATIONS COME OUT OF THE DATASET. No section number is written in
//      this file. `cite` is read from `data.cites[...]`, so an IPC section
//      string physically cannot appear on a UPC result: it is not in the
//      UPC file, and it is not in this code either.
//
//   5. THE ANSWER CARRIES ITS BOOK. codeEval stamps family and edition on
//      every result, so a number that got as far as the screen still says
//      which book it came from, and the caller renders that.
//
// Which family a job uses is the jurisdiction's decision, held in
// S.codeEditions ({ipc:'2021'} or {upc:'2024'}), confirmed once by the
// contractor because he knows what his inspector enforces. This module never
// picks. No edition configured means no answer (code-engine.js), which is the
// correct behaviour: guessing the book is the same bug as guessing the value.
//
// PURITY. Same rule as js/geo-derive.js, and it is here for the same reason.
// Every rule is a pure function of (inputs, dataset): no clock, no network, no
// globals, no reading S. The only thing in this file that touches the network
// is codeIpcBoot(), which fetches the two JSON files and registers them, and
// it is not a rule and never runs inside one.
//
// VALUES. Neither dataset has a single number in it today. Every slot is null
// and both files carry verified:false, so codeEval refuses everything here
// until a human holding the purchased edition types the tables in and signs
// for them. That is not a gap to be filled in later by inference: an LLM's
// fixture unit table is plausible and wrong, and this feeds permit work. The
// rules below are therefore written to REFUSE loudly and name what is missing,
// which is what they will do on the shipped datasets. See codes/README.md.
//
// Wrapped in an IIFE (unlike the older top-level-const files) so loading it
// twice, which a test harness can do, is harmless rather than a SyntaxError.

(function () {
  'use strict';

  // The shape both dataset files declare. A file that does not say this is
  // not this module's data and is refused at registration.
  const SCHEMA = 'td-plumb-1';

  // The only two families this module will ever build rules for.
  const FAMILIES = ['ipc', 'upc'];

  const RULE_IDS = ['dfu-total', 'drain-size', 'vent-size', 'wsfu-total',
    'water-service-size', 'water-heater-relief'];

  // ── Small pure helpers ───────────────────────────────────────────────────

  // null, not 0, for anything that is not actually a number. This is the most
  // load-bearing four lines in the file: every unfilled slot in both datasets
  // is null, and Number(null) is 0, so a lazier version of this would have
  // quietly totalled a house of missing fixture units as zero fixture units
  // and sized the drain off it. Booleans, arrays and objects are not numbers
  // either, whatever Number() says about them.
  function _num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    if (typeof v === 'object') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  function _norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function _slug(s) { return _norm(s).replace(/ /g, '-'); }
  // Float dust only. Not a code rounding rule: those are helpers.up/down and
  // they belong to the rule that invokes them.
  function _tidy(n) { return Math.round(n * 1000) / 1000; }

  // ── Fixture vocabulary ───────────────────────────────────────────────────
  //
  // OUR names, so an estimate line can be matched to a dataset row. These are
  // synonyms, not values: every one maps a phrase to the SAME fixture, never
  // to a choice between two fixtures that carry different unit values.
  const ALIAS = {
    'lav': 'lavatory',
    'bathroom sink': 'lavatory',
    'basin': 'lavatory',
    'tub': 'bathtub',
    'bath': 'bathtub',
    'bath tub': 'bathtub',
    'tub shower': 'bathtub-shower',
    'tub shower combo': 'bathtub-shower',
    'bathtub with shower': 'bathtub-shower',
    'shower': 'shower-stall',
    'stand up shower': 'shower-stall',
    'washing machine': 'clothes-washer',
    'washer': 'clothes-washer',
    'laundry sink': 'laundry-tub',
    'utility sink': 'laundry-tub',
    'mop sink': 'mop-basin',
    'janitor sink': 'mop-basin',
    'dw': 'dishwasher',
    'hose bib': 'hose-bibb',
    'sillcock': 'hose-bibb',
    'spigot': 'hose-bibb',
    'water cooler': 'drinking-fountain',
    'full bath': 'bathroom-group-full',
    'half bath': 'bathroom-group-half',
    'powder room': 'bathroom-group-half'
  };

  // Words that name a FAMILY of fixtures whose members carry different unit
  // values. Guessing between them silently changes the total, so we refuse and
  // make the caller say which. "Toilet" is the one that matters: tank type and
  // flushometer are not the same load in either book.
  const AMBIGUOUS = {
    'toilet': ['water-closet-tank', 'water-closet-flushometer'],
    'water closet': ['water-closet-tank', 'water-closet-flushometer'],
    'wc': ['water-closet-tank', 'water-closet-flushometer'],
    'urinal': ['urinal-tank', 'urinal-flushometer']
  };

  // Resolve a caller's word to a dataset fixture key.
  // -> {key} | {ambiguous:[keys]} | {unknown:true}
  function _fixtureKey(name, data) {
    const n = _norm(name);
    if (!n) return { unknown: true };
    const fx = (data && data.fixtures) || {};
    const direct = _slug(n);
    if (Object.prototype.hasOwnProperty.call(fx, direct)) return { key: direct };
    if (Object.prototype.hasOwnProperty.call(ALIAS, n)) {
      const k = ALIAS[n];
      if (Object.prototype.hasOwnProperty.call(fx, k)) return { key: k };
      return { unknown: true };
    }
    if (Object.prototype.hasOwnProperty.call(AMBIGUOUS, n)) return { ambiguous: AMBIGUOUS[n].slice() };
    return { unknown: true };
  }

  // Accepts either shape, because callers differ and neither is wrong:
  //   [{type:'lavatory', qty:2}, ...]     an estimate's fixture list
  //   {lavatory: 2, bathtub: 1}           a quick count
  // Anything else is not a fixture list and yields [].
  function _fixtureList(inp) {
    const raw = inp && (inp.fixtures !== undefined ? inp.fixtures : inp.fixture);
    const out = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (f) {
        if (f == null) return;
        if (typeof f === 'string') { out.push({ raw: f, qty: 1 }); return; }
        if (typeof f !== 'object') return;
        const name = f.type !== undefined ? f.type : (f.fixture !== undefined ? f.fixture : f.name);
        const given = f.qty !== undefined ? f.qty : (f.count !== undefined ? f.count : undefined);
        out.push(_qty(name, given));
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) { out.push(_qty(k, raw[k])); });
    }
    return out;
  }
  // A count that is not a positive number is never silently dropped and never
  // rounded to one: it comes back marked so the rule can refuse and say which
  // line was junk. A dropped fixture is a wrong total that looks right.
  function _qty(name, given) {
    if (given === undefined) return { raw: name, qty: 1 };
    const q = _num(given);
    if (q == null || q <= 0) return { raw: name, qty: 0, bad: true };
    return { raw: name, qty: q };
  }

  // Walk a fixture list once, resolving every name and reading one value out
  // of each matched record. Shared by the drainage and the supply totals
  // because they differ only in which value they read, and writing that loop
  // twice is how the two totals drift apart.
  function _tally(list, data, read) {
    const out = { total: 0, counted: 0, unknown: [], ambiguous: [], unvalued: [], badQty: [] };
    list.forEach(function (f) {
      if (f.bad) { out.badQty.push(String(f.raw)); return; }
      const k = _fixtureKey(f.raw, data);
      if (k.ambiguous) { out.ambiguous.push(String(f.raw) + ' (say which: ' + k.ambiguous.join(', ') + ')'); return; }
      if (!k.key) { out.unknown.push(String(f.raw)); return; }
      const rec = data.fixtures[k.key];
      const v = _num(read(rec));
      if (v == null) { out.unvalued.push((rec && rec.label) || k.key); return; }
      out.total += v * f.qty;
      out.counted += f.qty;
    });
    return out;
  }

  // ── The guard every rule opens with ──────────────────────────────────────
  //
  // FAM is captured when the rule set is built and is never read from the
  // caller. data.family is written inside the JSON file. If those two ever
  // disagree, the two books have crossed and we stop.
  function _guard(FAM, data) {
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'no-data', value: null,
        warnings: ['No ' + FAM.toUpperCase() + ' code data is loaded.'] };
    }
    if (data.schema !== SCHEMA) {
      return { ok: false, reason: 'schema-mismatch', value: null,
        warnings: ['This ' + FAM.toUpperCase() + ' dataset is not in the shape these rules read.'] };
    }
    if (data.family !== FAM) {
      const got = data.family ? String(data.family).toUpperCase() : 'an unnamed book';
      return { ok: false, reason: 'family-mismatch', value: null,
        warnings: [FAM.toUpperCase() + ' rules were handed ' + got + ' data. ' +
          'These books assign different fixture units to the same fixture, so nothing is computed.'] };
    }
    return null;
  }

  function _cite(data, key) {
    const c = data && data.cites && data.cites[key];
    return c ? String(c) : '';
  }
  function _citeWarn(data, key, warnings) {
    if (!_cite(data, key)) warnings.push('No section reference is recorded for this rule in the ' +
      String(data.family || '').toUpperCase() + ' dataset.');
  }

  // "private" or "public" occupancy. Defaulted, and therefore declared.
  function _useOf(inp, assumed) {
    const u = _norm(inp && inp.use);
    if (u === 'public') return 'public';
    if (u === 'private') return 'private';
    if (u) return null;             // a word we do not recognise is not a default
    assumed.push('occupancy not given, treated as private (a dwelling)');
    return 'private';
  }

  // A table column is only usable whole. "The smallest size that fits" cannot
  // be answered from a half-filled column, because a smaller row with a blank
  // capacity might have been the answer. So any null in the column refuses.
  function _column(rows, get) {
    if (!Array.isArray(rows) || !rows.length) return { ok: false, empty: true, list: [] };
    const list = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const size = _num(r.sizeIn !== undefined ? r.sizeIn : r.drainSizeIn);
      const cap = get(r);
      if (size == null || cap == null) return { ok: false, empty: false, list: [] };
      list.push({ size: size, cap: cap, row: r });
    }
    list.sort(function (a, b) { return a.size - b.size; });
    return { ok: true, empty: false, list: list };
  }

  // Smallest listed size whose capacity carries the load. null means the load
  // is off the top of the table, which is a real answer: it means ask a pro.
  function _smallestThatFits(list, load) {
    for (let i = 0; i < list.length; i++) if (list[i].cap >= load) return list[i];
    return null;
  }

  // One refusal ladder for both totals, in severity order. A total is all or
  // nothing: there is no partial answer here, because a total missing one
  // fixture is indistinguishable from a correct one.
  function _tallyRefusal(FAM, data, citeKey, t, cite, assumed) {
    if (t.badQty.length) {
      return { ok: false, reason: 'bad-input', value: null, cite: cite, assumed: assumed,
        warnings: ['These have a count that is not a positive number: ' + t.badQty.join(', ') + '.'] };
    }
    if (t.ambiguous.length) {
      return { ok: false, reason: 'ambiguous-fixture', value: null, cite: cite, assumed: assumed,
        warnings: ['These name more than one fixture and they do not carry the same load: ' + t.ambiguous.join('; ')] };
    }
    if (t.unknown.length) {
      return { ok: false, reason: 'unknown-fixture', value: null, cite: cite, assumed: assumed,
        warnings: ['Not in the ' + FAM.toUpperCase() + ' fixture table: ' + t.unknown.join(', ') +
          '. An unlisted fixture is sized off its trap, which needs the trap size.'] };
    }
    if (t.unvalued.length) return _missing(data, citeKey, t.unvalued.join(', '), assumed);
    return null;
  }

  function _missing(data, citeKey, what, assumed) {
    return {
      ok: false, reason: 'missing-value', value: null,
      cite: _cite(data, citeKey), assumed: assumed || [],
      warnings: [String(data.family || '').toUpperCase() + ' ' + String(data.edition || '') +
        ' is missing the values this needs: ' + what + '. A human has to type that table in from the book.']
    };
  }

  // ── The rules ────────────────────────────────────────────────────────────
  //
  // Built once per family. Nothing below reads a table constant, a size list,
  // or a fixture value from this file, because there are none: every number
  // comes from `data`, which the engine took from the registered dataset for
  // the family the caller asked for.
  function _plumbRules(FAM) {

    // ── 1. Drainage fixture units ─────────────────────────────────────────
    function dfuTotal(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'dfu-total', warnings);
      const cite = _cite(data, 'dfu-total');

      const use = _useOf(inp, assumed);
      if (!use) return { ok: false, reason: 'bad-input', value: null, cite: cite,
        warnings: ['Occupancy must be "private" or "public".'] };

      const list = _fixtureList(inp);
      const flow = _num(inp && inp.continuousFlowGpm) || 0;
      if (!list.length && flow <= 0) {
        return { ok: false, reason: 'no-fixtures', value: null, cite: cite, assumed: assumed,
          warnings: ['List the fixtures before this can total anything.'] };
      }

      const t = _tally(list, data, function (rec) { return rec && rec.dfu && rec.dfu[use]; });

      if (flow > 0) {
        const per = _num(data.dfu && data.dfu.continuousFlowDfuPerGpm);
        if (per == null) t.unvalued.push('continuous flow, fixture units per gpm');
        else t.total += flow * per;
      }

      const stop = _tallyRefusal(FAM, data, 'dfu-total', t, cite, assumed);
      if (stop) return stop;

      return {
        ok: true, value: _tidy(t.total), unit: 'dfu', cite: cite, assumed: assumed, warnings: warnings,
        inputs: { use: use, fixtureCount: t.counted, codeFamily: data.family },
        items: []
      };
    }

    // ── 2. Drain and branch sizing ────────────────────────────────────────
    function drainSize(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'drain-size', warnings);
      const cite = _cite(data, 'drain-size');

      const dfu = _num(inp && inp.dfu);
      if (dfu == null || dfu < 0) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite,
          warnings: ['Give the drainage fixture unit load as a number. Run dfu-total first.'] };
      }

      let kind = _norm(inp && inp.kind).replace(/ /g, '-');
      if (!kind) { kind = 'branch'; assumed.push('no run type given, treated as a horizontal fixture branch'); }
      const KINDS = ['branch', 'stack', 'building-drain', 'building-sewer'];
      if (KINDS.indexOf(kind) < 0) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite, assumed: assumed,
          warnings: ['Run type must be one of: ' + KINDS.join(', ') + '.'] };
      }

      let chosen = null, slope = null;

      if (kind === 'branch') {
        const col = _column(data.drain && data.drain.horizontalBranch, function (r) { return _num(r.maxDfu); });
        if (!col.ok) return _missing(data, 'drain-size', 'the horizontal branch capacity column', assumed);
        chosen = _smallestThatFits(col.list, dfu);
      } else if (kind === 'stack') {
        const intervals = _num(inp && inp.branchIntervals);
        const col = _column(data.drain && data.drain.stack, function (r) { return _num(r.maxDfuTotal); });
        if (!col.ok) return _missing(data, 'drain-size', 'the stack capacity column', assumed);
        if (intervals != null && intervals > 1) {
          // A stack has two limits and both bind: the whole stack, and what
          // may land on it from any one branch interval.
          const per = _column(data.drain && data.drain.stack, function (r) { return _num(r.maxDfuPerBranchInterval); });
          if (!per.ok) return _missing(data, 'drain-size', 'the stack per-branch-interval capacity column', assumed);
          const perLoad = dfu / intervals;
          for (let i = 0; i < col.list.length; i++) {
            const byTotal = col.list[i];
            const byInterval = per.list.filter(function (x) { return x.size === byTotal.size; })[0];
            if (byTotal.cap >= dfu && byInterval && byInterval.cap >= perLoad) { chosen = byTotal; break; }
          }
          assumed.push('the load was spread evenly over ' + intervals + ' branch intervals');
        } else {
          if (intervals == null) assumed.push('no branch interval count given, sized on the stack total only');
          chosen = _smallestThatFits(col.list, dfu);
        }
      } else {
        // Building drain and building sewer are sized by slope, and the slope
        // is not ours to pick: a flatter run carries less.
        slope = _num(inp && inp.slopeInPerFt);
        if (slope == null) {
          slope = _num(data.drain && data.drain.defaultSlopeInPerFt);
          if (slope == null) {
            return { ok: false, reason: 'need-slope', value: null, cite: _cite(data, 'drain-slope'), assumed: assumed,
              warnings: ['Give the slope in inches per foot. A building drain carries a different load at 1/8 than at 1/4, and picking one for you is how a drain ends up undersized.'] };
          }
          assumed.push('no slope given, used the dataset default of ' + slope + ' in/ft');
        }
        const key = String(slope);
        const col = _column(data.drain && data.drain.buildingDrain, function (r) {
          const m = r.maxDfuBySlope || {};
          return Object.prototype.hasOwnProperty.call(m, key) ? _num(m[key]) : null;
        });
        if (!col.ok) {
          if (col.empty) return _missing(data, 'drain-size', 'the building drain table', assumed);
          return _missing(data, 'drain-size', 'the building drain capacity column at ' + slope + ' in/ft', assumed);
        }
        chosen = _smallestThatFits(col.list, dfu);
      }

      if (!chosen) {
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [dfu + ' fixture units is past the largest size the ' + FAM.toUpperCase() +
            ' table lists. This one needs an engineer, not a lookup.'] };
      }

      let size = chosen.size;
      // Floors that are rules in their own right, applied only when the value
      // is on file. When it is not, we say so rather than quietly skipping it.
      const floor = _num(data.drain && data.drain.minSizeIn);
      if (floor != null && size < floor) { size = floor; assumed.push('raised to the minimum drain size of ' + floor + ' in'); }
      const wcs = _num(inp && inp.waterClosets);
      if (wcs != null && wcs > 0) {
        const wcMin = _num(data.drain && data.drain.minSizeForWaterClosetIn);
        if (wcMin == null) warnings.push('The minimum size for a run carrying a water closet is not on file yet, so it was not applied.');
        else if (size < wcMin) { size = wcMin; assumed.push('raised to ' + wcMin + ' in because the run carries a water closet'); }
      }

      const items = [];
      const len = _num(inp && inp.lengthFt);
      if (len != null && len > 0) {
        items.push({ label: 'Drain pipe, ' + size + ' in', qty: len, unit: 'ft',
          why: 'minimum size for ' + dfu + ' dfu' + (slope != null ? ' at ' + slope + ' in/ft' : '') });
      }

      return {
        ok: true, value: size, unit: 'in', cite: cite, assumed: assumed, warnings: warnings,
        inputs: { dfu: dfu, kind: kind, slopeInPerFt: slope, codeFamily: data.family },
        items: items
      };
    }

    // ── 3. Vent sizing ────────────────────────────────────────────────────
    function ventSize(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'vent-size', warnings);
      const cite = _cite(data, 'vent-size');

      const dfu = _num(inp && inp.dfu);
      const drain = _num(inp && inp.drainSizeIn);
      const len = _num(inp && inp.developedLengthFt);
      const miss = [];
      if (dfu == null || dfu < 0) miss.push('the fixture unit load on the vent');
      if (drain == null || drain <= 0) miss.push('the size of the drain being vented');
      if (len == null || len < 0) miss.push('the developed length of the vent');
      if (miss.length) {
        return { ok: false, reason: 'need-more', value: null, cite: cite,
          warnings: ['Vent sizing needs ' + miss.join(', ') + '. Length is the whole point of the table, so it is not defaulted.'] };
      }

      const rows = (data.vent && data.vent.table) || [];
      if (!Array.isArray(rows) || !rows.length) return _missing(data, 'vent-size', 'the vent sizing table', assumed);

      // The row for this drain size, at or above this load.
      const cands = rows.filter(function (r) {
        return _num(r.drainSizeIn) === drain && _num(r.maxDfu) != null && _num(r.maxDfu) >= dfu;
      }).sort(function (a, b) { return _num(a.maxDfu) - _num(b.maxDfu); });
      if (!cands.length) {
        const anyForSize = rows.some(function (r) { return _num(r.drainSizeIn) === drain; });
        if (!anyForSize) {
          return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
            warnings: ['The ' + FAM.toUpperCase() + ' vent table on file has no row for a ' + drain + ' in drain.'] };
        }
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [dfu + ' fixture units is past what the table lists for a ' + drain + ' in drain.'] };
      }
      const row = cands[0];

      const byVent = row.maxLengthFtByVentSize || {};
      const sizes = Object.keys(byVent).map(function (k) { return { size: _num(k), max: _num(byVent[k]) }; })
        .filter(function (x) { return x.size != null; })
        .sort(function (a, b) { return a.size - b.size; });
      if (!sizes.length) return _missing(data, 'vent-size', 'the maximum vent lengths for a ' + drain + ' in drain', assumed);
      if (sizes.some(function (x) { return x.max == null; })) {
        return _missing(data, 'vent-size', 'part of the maximum vent length row for a ' + drain + ' in drain', assumed);
      }

      let pick = null;
      for (let i = 0; i < sizes.length; i++) if (sizes[i].max >= len) { pick = sizes[i]; break; }
      if (!pick) {
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [len + ' ft is longer than any vent size the table allows off a ' + drain + ' in drain. Shorten the run or take it to an engineer.'] };
      }

      let size = pick.size;
      const minIn = _num(data.vent && data.vent.minSizeIn);
      if (minIn != null && size < minIn) { size = minIn; assumed.push('raised to the minimum vent size of ' + minIn + ' in'); }
      const frac = _num(data.vent && data.vent.minFractionOfDrainSize);
      if (frac == null) warnings.push('The rule that a vent may not be smaller than a fraction of its drain is not on file yet, so it was not applied.');
      else if (size < drain * frac) { size = drain * frac; assumed.push('raised to ' + _tidy(size) + ' in, the smallest allowed off a ' + drain + ' in drain'); }

      const items = [{ label: 'Vent pipe, ' + _tidy(size) + ' in', qty: len, unit: 'ft',
        why: dfu + ' dfu at ' + len + ' ft developed length' }];

      return {
        ok: true, value: _tidy(size), unit: 'in', cite: cite, assumed: assumed, warnings: warnings,
        inputs: { dfu: dfu, drainSizeIn: drain, developedLengthFt: len, codeFamily: data.family },
        items: items
      };
    }

    // ── 4a. Water supply fixture units ────────────────────────────────────
    function wsfuTotal(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'wsfu-total', warnings);
      const cite = _cite(data, 'wsfu-total');

      const use = _useOf(inp, assumed);
      if (!use) return { ok: false, reason: 'bad-input', value: null, cite: cite,
        warnings: ['Occupancy must be "private" or "public".'] };

      let which = _norm(inp && inp.which);
      if (!which) { which = 'total'; assumed.push('no side given, totalled the combined (hot and cold) column'); }
      if (['total', 'cold', 'hot'].indexOf(which) < 0) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite, assumed: assumed,
          warnings: ['Side must be "total", "cold" or "hot".'] };
      }

      const list = _fixtureList(inp);
      const flow = _num(inp && inp.continuousFlowGpm) || 0;
      if (!list.length && flow <= 0) {
        return { ok: false, reason: 'no-fixtures', value: null, cite: cite, assumed: assumed,
          warnings: ['List the fixtures before this can total anything.'] };
      }

      const t = _tally(list, data, function (rec) {
        return rec && rec.wsfu && rec.wsfu[use] && rec.wsfu[use][which];
      });

      if (flow > 0) {
        const per = _num(data.water && data.water.continuousFlowWsfuPerGpm);
        if (per == null) t.unvalued.push('continuous flow, supply fixture units per gpm');
        else t.total += flow * per;
      }

      const stop = _tallyRefusal(FAM, data, 'wsfu-total', t, cite, assumed);
      if (stop) return stop;

      return {
        ok: true, value: _tidy(t.total), unit: 'wsfu', cite: cite, assumed: assumed, warnings: warnings,
        inputs: { use: use, which: which, fixtureCount: t.counted, codeFamily: data.family },
        items: []
      };
    }

    // ── 4b. Water service and distribution sizing ─────────────────────────
    function waterServiceSize(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'water-service-size', warnings);
      const cite = _cite(data, 'water-service-size');

      const wsfu = _num(inp && inp.wsfu);
      const psi = _num(inp && inp.pressurePsi);
      const len = _num(inp && inp.developedLengthFt);
      const miss = [];
      if (wsfu == null || wsfu < 0) miss.push('the supply fixture unit load (run wsfu-total first)');
      if (psi == null || psi <= 0) miss.push('the available street pressure in psi');
      if (len == null || len <= 0) miss.push('the developed length of the run in feet');
      if (miss.length) {
        return { ok: false, reason: 'need-more', value: null, cite: cite,
          warnings: ['Supply sizing needs ' + miss.join(', ') + '. Pressure and length decide this table, so neither is defaulted.'] };
      }

      const rows = (data.water && data.water.serviceSizing) || [];
      if (!Array.isArray(rows) || !rows.length) return _missing(data, 'water-service-size', 'the water sizing table', assumed);

      const band = rows.filter(function (r) {
        const lo = _num(r.pressureRange && r.pressureRange.minPsi);
        const hi = _num(r.pressureRange && r.pressureRange.maxPsi);
        return lo != null && hi != null && psi >= lo && psi <= hi;
      });
      if (!band.length) {
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [psi + ' psi is outside every pressure band the ' + FAM.toUpperCase() +
            ' table on file covers. Below the bottom band means a booster; above the top means a regulator.'] };
      }

      // Length columns are "up to and including", so take the first column at
      // or beyond the actual run.
      const cols = Object.keys(band[0].maxWsfuByLengthFt || {}).map(function (k) { return _num(k); })
        .filter(function (n) { return n != null; }).sort(function (a, b) { return a - b; });
      if (!cols.length) return _missing(data, 'water-service-size', 'the length columns of the water sizing table', assumed);
      let col = null;
      for (let i = 0; i < cols.length; i++) if (cols[i] >= len) { col = cols[i]; break; }
      if (col == null) {
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [len + ' ft is longer than the table goes. A run that long is a pressure-loss calculation, not a lookup.'] };
      }

      const usable = [];
      for (let i = 0; i < band.length; i++) {
        const r = band[i];
        const cap = _num((r.maxWsfuByLengthFt || {})[String(col)]);
        const svc = _num(r.serviceSizeIn);
        if (cap == null || svc == null) return _missing(data, 'water-service-size', 'part of the ' + psi + ' psi band at the ' + col + ' ft column', assumed);
        usable.push({ cap: cap, row: r, svc: svc });
      }
      usable.sort(function (a, b) { return a.svc - b.svc; });
      let pick = null;
      for (let i = 0; i < usable.length; i++) if (usable[i].cap >= wsfu) { pick = usable[i]; break; }
      if (!pick) {
        return { ok: false, reason: 'over-table', value: null, cite: cite, assumed: assumed,
          warnings: [wsfu + ' fixture units is past the largest service the table lists at ' + psi + ' psi over ' + col + ' ft.'] };
      }

      let svc = pick.svc;
      const svcMin = _num(data.water && data.water.minServiceSizeIn);
      if (svcMin != null && svc < svcMin) { svc = svcMin; assumed.push('raised to the minimum water service size of ' + svcMin + ' in'); }
      let dist = _num(pick.row.distributionSizeIn);
      const distMin = _num(data.water && data.water.minDistributionSizeIn);
      if (dist != null && distMin != null && dist < distMin) { dist = distMin; assumed.push('raised the distribution main to the minimum of ' + distMin + ' in'); }
      const meter = _num(pick.row.meterSizeIn);

      if (col > len) assumed.push('sized on the ' + col + ' ft column, the first one at or past the ' + len + ' ft run');

      const items = [{ label: 'Water service pipe, ' + svc + ' in', qty: len, unit: 'ft',
        why: wsfu + ' wsfu at ' + psi + ' psi over ' + len + ' ft' }];
      if (dist != null) items.push({ label: 'Water distribution main, ' + dist + ' in', qty: 1, unit: 'run',
        why: 'goes with a ' + svc + ' in service at this load' });
      if (meter != null) items.push({ label: 'Water meter, ' + meter + ' in', qty: 1, unit: 'ea',
        why: 'the meter this row of the table is sized around' });

      return {
        ok: true, value: svc, unit: 'in', cite: cite, assumed: assumed, warnings: warnings,
        inputs: { wsfu: wsfu, pressurePsi: psi, developedLengthFt: len, lengthColumnFt: col,
          meterSizeIn: meter, distributionSizeIn: dist, codeFamily: data.family },
        items: items
      };
    }

    // ── 5. Thermal expansion and relief on a closed system ────────────────
    //
    // The owner's question is "what size expansion tank goes with what size
    // tankless, boiler or tank." The honest answer is that the heater's size
    // is not what decides it. An expansion tank is sized from the volume of
    // water that is trapped, how far it expands (incoming temperature to
    // setpoint), the supply pressure it starts at, and the relief setting it
    // must not reach. A 199k tankless holds about a quart and a 50 gallon tank
    // holds 50, and two systems with the same heater need different tanks if
    // their piping volumes or pressures differ.
    //
    // So this rule does not map btu to tank size. It asks for what actually
    // decides it and refuses by name when it is missing, which is the whole
    // point: a guessed expansion tank either weeps the relief valve every
    // night or does nothing at all, and both look fine on the invoice.
    function waterHeaterRelief(inp, data, h) {
      const bad = _guard(FAM, data); if (bad) return bad;
      const assumed = [], warnings = [];
      _citeWarn(data, 'water-heater-expansion', warnings);
      const cite = _cite(data, 'water-heater-expansion');

      const closed = inp ? inp.closedSystem : undefined;
      if (closed !== true && closed !== false) {
        return { ok: false, reason: 'need-more', value: null, cite: cite,
          warnings: ['Say whether this is a closed system. A check valve, pressure reducing valve or backflow preventer on the service makes it closed, and that is what creates the expansion problem in the first place.'] };
      }

      const heater = _norm(inp && inp.heaterType);
      if (heater && ['tank', 'tankless', 'boiler', 'indirect'].indexOf(heater) < 0) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite,
          warnings: ['Heater type must be tank, tankless, boiler or indirect.'] };
      }

      if (!closed) {
        const req = data.waterHeater && data.waterHeater.expansion &&
          data.waterHeater.expansion.requiredOnClosedSystem;
        if (req == null) warnings.push('Whether this code requires expansion control on a closed system is not on file yet.');
        return {
          ok: true, value: 0, unit: 'gal', cite: cite, assumed: assumed,
          inputs: { closedSystem: false, heaterType: heater || null, codeFamily: data.family },
          warnings: warnings.concat(['Answered as an open system, on your word. If there is a check valve, PRV or backflow preventer anywhere on the service, it is closed and this answer is wrong.']),
          items: []
        };
      }

      // Closed. Now the inputs that actually decide the size.
      const vol = _num(inp && inp.systemVolumeGal);
      const supply = _num(inp && inp.supplyPsi);
      const relief = _num(inp && inp.reliefSetPsi);
      const inTemp = _num(inp && inp.incomingTempF);
      const setTemp = _num(inp && inp.setpointTempF);

      const miss = [];
      if (vol == null || vol <= 0) {
        miss.push(heater === 'tankless'
          ? 'the volume of water held in the whole closed system (a tankless holds almost none itself, so this is the piping and anything else trapped behind the valve)'
          : 'the volume of water held in the whole closed system, in gallons');
      }
      if (supply == null || supply <= 0) miss.push('the supply pressure in psi, which is the pressure the tank is precharged to');
      if (relief == null || relief <= 0) miss.push('the relief valve setting in psi, which is the pressure the system must never reach');
      if (inTemp == null) miss.push('the incoming cold water temperature');
      if (setTemp == null) miss.push('the heater setpoint temperature');

      if (miss.length) {
        return {
          ok: false, reason: 'need-more', value: null, cite: cite, assumed: assumed,
          warnings: ['An expansion tank is not sized off the heater. It is sized off ' + miss.join('; ') +
            '. Two identical heaters need different tanks when those differ, so nothing is guessed here.'],
          items: []
        };
      }
      if (relief <= supply) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite, assumed: assumed,
          warnings: ['The relief setting (' + relief + ' psi) is at or below the supply pressure (' + supply + ' psi). Check both readings: there is no room for expansion between them.'] };
      }
      if (setTemp <= inTemp) {
        return { ok: false, reason: 'bad-input', value: null, cite: cite, assumed: assumed,
          warnings: ['The setpoint (' + setTemp + '°F) is at or below the incoming temperature (' + inTemp + '°F). Water that is not heated does not expand.'] };
      }

      // Every input is present and sane. The sizing method and its factors are
      // still a table somebody has to type in, and until they do this returns
      // nothing rather than a plausible tank size.
      const exp = (data.waterHeater && data.waterHeater.expansion) || {};
      if (exp.method == null) {
        return _missing(data, 'water-heater-expansion',
          'the expansion sizing method and its water expansion factors', assumed);
      }
      const factors = exp.waterExpansionFactorByTempF || {};
      if (!Object.keys(factors).length) {
        return _missing(data, 'water-heater-expansion', 'the water expansion factors by temperature', assumed);
      }
      // Deliberately not implemented past this point. The method itself is a
      // value on file, not something to infer: when a human fills in
      // expansion.method the arithmetic for that named method gets written
      // here, against the worked example that comes with it.
      return _missing(data, 'water-heater-expansion',
        'the arithmetic for the "' + String(exp.method) + '" sizing method, which is written once the method is on file', assumed);
    }

    return {
      'dfu-total': dfuTotal,
      'drain-size': drainSize,
      'vent-size': ventSize,
      'wsfu-total': wsfuTotal,
      'water-service-size': waterServiceSize,
      'water-heater-relief': waterHeaterRelief
    };
  }

  // ── Registration ─────────────────────────────────────────────────────────
  //
  // The family comes out of the FILE, never out of the caller. That is what
  // makes mislabelling a dataset impossible at the door, and it is why there
  // is no family argument here to get wrong.
  function codeIpcRegister(json) {
    if (!json || typeof json !== 'object') return { ok: false, reason: 'no-data' };
    const fam = String(json.family || '');
    if (FAMILIES.indexOf(fam) < 0) return { ok: false, reason: 'unknown-family' };
    if (json.schema !== SCHEMA) return { ok: false, reason: 'schema-mismatch' };
    if (!json.edition) return { ok: false, reason: 'no-edition' };
    if (typeof codeRegister !== 'function') return { ok: false, reason: 'no-engine' };

    // Frozen so nothing downstream can edit a code value at runtime. A dataset
    // that can be patched in place is not a record of anything.
    const data = _deepFreeze(json);
    const okReg = codeRegister({
      family: fam,
      edition: String(json.edition),
      verified: json.verified === true,
      verifiedBy: json.verifiedBy || '',
      verifiedAt: json.verifiedAt || '',
      data: data,
      rules: _plumbRules(fam)
    });
    return { ok: !!okReg, reason: okReg ? '' : 'rejected', family: fam, edition: String(json.edition) };
  }

  function _deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.getOwnPropertyNames(o).forEach(function (k) { _deepFreeze(o[k]); });
    return Object.freeze(o);
  }

  // The only thing in this file that touches the network. Not a rule, never
  // called from one: the rules stay pure.
  function codeIpcBoot(opts) {
    const o = opts || {};
    const base = o.base || 'codes/';
    const files = o.files || ['ipc-2021.json', 'upc-2024.json'];
    return Promise.all(files.map(function (f) {
      return fetch(base + f, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return j ? codeIpcRegister(j) : { ok: false, reason: 'fetch-failed', file: f }; })
        .catch(function () { return { ok: false, reason: 'fetch-failed', file: f }; });
    }));
  }

  if (typeof window !== 'undefined') {
    window.codeIpcRegister = codeIpcRegister;
    window.codeIpcBoot = codeIpcBoot;
    // Exposed for tests and for a settings screen that lists what it can do.
    window.codeIpcRuleIds = function () { return RULE_IDS.slice(); };
    window.codeIpcFamilies = function () { return FAMILIES.slice(); };
    window._plumbFixtureKey = _fixtureKey;
    window._plumbRulesFor = _plumbRules;
    // Self-load when the engine is present, the same way js/code-nec.js does,
    // so adding the script tag is the whole install. Guarded for tests that
    // want to control registration themselves.
    if (typeof codeRegister === 'function' && window.__plumbNoAutoLoad !== true) {
      codeIpcBoot();
    }
  }
})();
