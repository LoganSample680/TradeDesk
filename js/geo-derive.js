// ══════════════════════════════════════════════════════════════════════════
// THE DAY DERIVER. One pure function that turns the phone's raw record of a
// day (the CoreMotion tape and the GPS fixes) into the day's time rows and
// mileage legs. It is the only thing allowed to decide what a drive or a
// dwell IS.
//
// Owner spec, 2026-09-02, verbatim where it matters:
//
//   "core motion should mint one id that then follows the journey, when core
//    motion flips id is minted, right away that fires a gps ping that looks up
//    location, find the address and how its saved in the system and applies
//    it correctly to the time log (shop, lead, client address, supply house,
//    etc) then starts real time GPS for the mileage writer if address we grab
//    start time and look for the complete trip of addresses in a data base
//    the next time we have a core motion flip back to walking"
//
//   "we only save automatic logged drive time to time log when we go from one
//    saved address to another saved address inside of tradedesk"
//
//   "closes drive legs with a personal stop into them to do the direct route
//    to the next geo fence you arrive at that day"
//
//   "This rule should also have the ability to clean up mileage and time logs
//    based on core motions iOS tape on boot."
//
// WHY A PURE FUNCTION. Three weeks of the previous design (three observers
// each writing rows for the same event, ~20 sweeps reconciling them, a reader
// correcting the result) never converged because nothing anywhere stated what
// the rows were supposed to be. This file states it. Live tracking calls it
// as each flip lands; boot calls it over the tape's whole seven-day window and
// REPLACES every automatic row for those days with the output. Same input,
// same output, same ids, every time: a rebuild is idempotent by construction
// and a force-quit costs nothing, because the tape is still on the phone.
//
// WHAT IT DOES NOT DO. It never reads globals, never touches the DOM, never
// writes anywhere. It does not know about manual clocks: the clock is an
// INPUT to the reader's blend (js/timelog.js _tlBlendManual), never something
// a rebuild can touch. It does not route: a collapsed leg carries the straight
// line and says so, and an enrichment step can upgrade it to a routed figure
// on the same id without creating a row.
//
// THE RULE, in the order the day happens:
//
//   1. A foot -> automotive transition on the tape is a JOURNEY START. Its id
//      is minted right there, from who and when, so the same flip always
//      mints the same id.
//   2. The fix nearest that flip is looked up: which saved fence contains it.
//      That fence labels the dwell that just ENDED (the departure ping "sees
//      the geofence you're in").
//   3. An automotive -> foot transition is the JOURNEY END. Its fix is looked
//      up the same way.
//   4. Both ends saved and different: a LEG is written (traced-path miles,
//      wheels-turning minutes) and a dwell opens at the destination.
//   5. Destination not saved: the journey is PENDING. Nothing is written. The
//      next journey continues the chain under the FIRST journey's id.
//   6. A pending chain that later reaches a saved fence collapses to ONE leg:
//      first saved origin to this fence, direct-route miles, drive minutes =
//      the automotive segments only (a stop is not drive time).
//   7. Same fence both ends (with or without personal stops between) is a
//      round trip: no leg.
//   8. A chain still pending at the end of the day writes nothing. The manual
//      clock covers it, and the blend already shows that remainder as Manual
//      time.
//   9. A dwell exists only between an arrival and a departure. The first
//      stretch of the day (before any drive) and the last (after the final
//      drive) are not automatic rows: home is not work, and if it was, the
//      clock says so.
// ══════════════════════════════════════════════════════════════════════════

const GEO_DERIVE_DEFAULTS = Object.freeze({
  radiusFt: 600,          // one definition of "inside", replacing 600/797/950
  fixWindowMs: 5 * 60000, // how far from a flip a fix may sit and still be its fix
  minLegMs: 2 * 60000,    // a journey shorter than this is a walk across a fence line
  stillEndMs: 10 * 60000, // a truck that sits this long has parked, foot flip or not
  maxFixAccM: 150,        // fixes worse than this are not part of a path
});

// Fence precedence when more than one contains the fix. His shop and his home
// office are four metres apart; nearest-wins made that a coin toss between two
// payroll rules. Lower number wins; ties fall to the nearer fence.
const GEO_FENCE_RANK = Object.freeze({
  job: 0, shop: 1, home_office: 2, client: 3, supply: 4, business_meeting: 4, other: 5,
});

function _gdKind(k) {
  const s = String(k || '');
  if (s === 'driving' || s === 'automotive') return 'auto';
  if (s === 'onFoot' || s === 'walking' || s === 'running' || s === 'cycling') return 'foot';
  if (s === 'still' || s === 'stationary') return 'still';
  return '';
}

function _gdMiles(a, b) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Deterministic id: who + the flip instant. The plugin may hand us its own id
// on the transition (tape[i].id); that wins, because it was minted at the
// coprocessor's own moment and is what any live row was already keyed on.
function _gdJourneyId(personId, ts, given) {
  if (given) return String(given);
  return 'j-' + String(personId || 'anon').slice(0, 8) + '-' + Math.round(ts).toString(36);
}

// Which saved fence contains this point. ONE function, one radius, one
// precedence. Returns the fence or null.
function geoFenceAt(pt, fences, radiusFt) {
  if (!pt || pt.lat == null || pt.lng == null || !Array.isArray(fences)) return null;
  const r = Number(radiusFt) > 0 ? Number(radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  let best = null, bestRank = Infinity, bestFt = Infinity;
  for (const f of fences) {
    if (!f || f.lat == null || f.lng == null) continue;
    const lim = Number(f.radiusFt) > 0 ? Number(f.radiusFt) : r;
    const ft = _gdMiles(pt, f) * 5280;
    if (ft > lim) continue;
    const rank = GEO_FENCE_RANK[String(f.kind || 'other')];
    const rk = rank == null ? GEO_FENCE_RANK.other : rank;
    if (rk < bestRank || (rk === bestRank && ft < bestFt)) { best = f; bestRank = rk; bestFt = ft; }
  }
  return best;
}

function _gdSameFence(a, b) {
  if (!a || !b) return false;
  return String(a.id) === String(b.id);
}

// The fix nearest a moment, inside the window, ignoring junk accuracy.
function _gdFixNear(fixes, ts, windowMs, maxAccM) {
  let best = null, bestD = Infinity;
  for (const f of fixes) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.acc != null && Number(f.acc) > maxAccM) continue;
    const d = Math.abs(f.ts - ts);
    if (d <= windowMs && d < bestD) { best = f; bestD = d; }
  }
  return best;
}

// The path runs from the departure fix to the arrival fix, both included:
// the arrival ping lands a few seconds after the flip, and dropping it would
// cut the last block off every leg.
function _gdPathMiles(fixes, a, b, maxAccM, endpoints) {
  const pts = fixes.filter(f => f && f.lat != null && f.lng != null && typeof f.ts === 'number' &&
    f.ts >= a && f.ts <= b && (f.acc == null || Number(f.acc) <= maxAccM));
  (endpoints || []).forEach(e => { if (e && pts.indexOf(e) < 0) pts.push(e); });
  pts.sort((x, y) => x.ts - y.ts);
  if (pts.length < 2) return 0;
  let mi = 0;
  for (let i = 1; i < pts.length; i++) mi += _gdMiles(pts[i - 1], pts[i]);
  return mi;
}

// Collapse the raw tape into journeys: [{startTs, endTs, id, open}].
// Starts on foot -> auto. Ends on the first foot after it, or on a still
// stretch longer than stillEndMs (the truck parked and the phone stayed in
// it). Still shorter than that is a red light and does not split a drive.
function _gdJourneys(tape, personId, opts, dayStart, dayEnd, nowMs) {
  const t = (Array.isArray(tape) ? tape : [])
    .map(x => x && typeof x.ts === 'number' ? { ts: x.ts, k: _gdKind(x.kind), id: x.id } : null)
    .filter(x => x && x.k).sort((a, b) => a.ts - b.ts);
  const out = [];
  let cur = null, lastFoot = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.k === 'auto') {
      if (!cur) {
        // A drive that began before this day is not this day's journey.
        if (x.ts < dayStart) { cur = null; continue; }
        cur = { startTs: x.ts, id: _gdJourneyId(personId, x.ts, x.id), endTs: null };
      }
      continue;
    }
    if (!cur) { if (x.k === 'foot') lastFoot = x.ts; continue; }
    if (x.k === 'foot') { cur.endTs = x.ts; out.push(cur); cur = null; lastFoot = x.ts; continue; }
    // still: parked if it runs long enough before the next transition
    const next = t[i + 1];
    const stillFor = (next ? next.ts : nowMs) - x.ts;
    if (stillFor >= opts.stillEndMs) { cur.endTs = x.ts; out.push(cur); cur = null; }
  }
  if (cur) { cur.endTs = null; cur.open = true; out.push(cur); }
  // "The next geo fence you arrive at THAT DAY": a journey that ends after
  // midnight is still open as far as this day is concerned.
  return out.filter(j => j.startTs >= dayStart && j.startTs < dayEnd)
    .map(j => (j.endTs != null && j.endTs >= dayEnd) ? { startTs: j.startTs, id: j.id, endTs: null, open: true } : j);
}

/**
 * geoDeriveDay(input) -> { day, dwells, legs, pending, journeys }
 *
 * input.tape     [{ts, kind, id?}]  motionSince output, any span
 * input.fixes    [{ts, lat, lng, acc?}] every fix the phone has for the span
 * input.fences   [{id, kind, name, lat, lng, radiusFt?, jobId?, clientId?, placeId?, addr?}]
 * input.day      'YYYY-MM-DD' (the Central day to derive)
 * input.dayStart / input.dayEnd  ms bounds of that day (caller owns the zone)
 * input.personId  employee uid (stamped into ids)
 * input.nowMs     for the open tail; defaults to Date.now()
 * input.directMiles(a,b) optional sync resolver for a collapsed leg; default
 *                 straight line, and the leg says which it got.
 * input.opts      overrides for GEO_DERIVE_DEFAULTS
 */
function geoDeriveDay(input) {
  const inp = input || {};
  const opts = Object.assign({}, GEO_DERIVE_DEFAULTS, inp.opts || {});
  const fixes = (Array.isArray(inp.fixes) ? inp.fixes : []).filter(f => f && typeof f.ts === 'number');
  const fences = Array.isArray(inp.fences) ? inp.fences : [];
  const nowMs = typeof inp.nowMs === 'number' ? inp.nowMs : Date.now();
  const dayStart = Number(inp.dayStart), dayEnd = Number(inp.dayEnd);
  const empty = { day: inp.day || '', dwells: [], legs: [], pending: null, journeys: [] };
  if (!(dayStart > 0 && dayEnd > dayStart)) return empty;
  const directMiles = typeof inp.directMiles === 'function' ? inp.directMiles : null;

  const journeys = _gdJourneys(inp.tape, inp.personId, opts, dayStart, dayEnd, nowMs);
  const dwells = [], legs = [];
  const at = ts => _gdFixNear(fixes, ts, opts.fixWindowMs, opts.maxFixAccM);
  const fenceOf = fix => fix ? geoFenceAt(fix, fences, opts.radiusFt) : null;

  // The chain: the first saved origin and the automotive minutes since it.
  let chain = null;          // {id, originFence, startTs, autoMs, stops}
  let arrived = null;        // {fence, ts, journeyId}: an open dwell awaiting its departure

  for (const j of journeys) {
    const startFix = at(j.startTs);
    const depFence = fenceOf(startFix);
    // The departure ping labels the dwell that just ended. If it is missing,
    // the arrival that opened the dwell still knows where it was.
    const fromFence = depFence || (arrived && arrived.fence) || null;

    if (arrived) {
      const f = fromFence && (!depFence || _gdSameFence(depFence, arrived.fence) || !arrived.fence)
        ? (arrived.fence || depFence) : (depFence || arrived.fence);
      const endTs = j.startTs;
      if (f && endTs > arrived.ts) {
        dwells.push(_gdDwell(f, arrived.ts, endTs, arrived.journeyId, false));
      }
      arrived = null;
    }

    if (j.open) {
      // Still driving. Nothing to write yet; the chain (if any) stays open.
      if (!chain && fromFence) chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0, openSince: j.startTs };
      else if (chain) chain.openSince = j.startTs;
      break;
    }

    const endFix = at(j.endTs);
    const toFence = fenceOf(endFix);
    const autoMs = j.endTs - j.startTs;

    if (!chain) {
      if (!fromFence) {
        // Unknown origin: nothing to measure from. If it ended somewhere
        // saved, a dwell opens there, and that is all.
        if (toFence) arrived = { fence: toFence, ts: j.endTs, journeyId: j.id };
        continue;
      }
      chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0 };
    }
    chain.autoMs += autoMs;

    if (!toFence) {
      // Pending: a personal stop, or somewhere not saved. Held, not written.
      chain.stops += 1;
      continue;
    }

    // Resolved at a saved fence.
    const collapsed = chain.stops > 0;
    const sameSpot = _gdSameFence(chain.originFence, toFence);
    const tooShort = !collapsed && autoMs < opts.minLegMs;
    if (!sameSpot && !tooShort) {
      const a = chain.originFence, b = toFence;
      let miles, milesFrom;
      if (collapsed) {
        const d = directMiles ? Number(directMiles(a, b)) : NaN;
        miles = d > 0 ? d : _gdMiles(a, b);
        milesFrom = d > 0 ? 'routed' : 'straight';
      } else {
        const p = _gdPathMiles(fixes, j.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix]);
        miles = p > 0 ? p : _gdMiles(a, b);
        milesFrom = p > 0 ? 'path' : 'straight';
      }
      legs.push({
        id: chain.id, from: a, to: b,
        startTs: chain.startTs, endTs: j.endTs,
        minutes: Math.round(chain.autoMs / 60000),
        miles: Math.round(miles * 10) / 10, milesFrom,
        collapsed, stops: chain.stops,
      });
    }
    chain = null;
    arrived = { fence: toFence, ts: j.endTs, journeyId: j.id };
  }

  // The tail: arrived somewhere saved, no departure flip yet. Rule 9: a dwell
  // is a row only between an arrival and a departure. A later fix OUTSIDE the
  // fence is a departure the tape missed, and closes it at the last fix that
  // was still inside. No such fix means it is genuinely open: reported as
  // `open` for the live screen (on-site card, "at John Doe since 1:25"),
  // never written as a row. That is what keeps an evening at the home office
  // from being paid because nobody drove anywhere afterwards.
  let open = null;
  if (arrived && arrived.fence) {
    let end = arrived.ts, left = false;
    const later = fixes.filter(f => f.ts > arrived.ts && f.ts < dayEnd && (f.acc == null || Number(f.acc) <= opts.maxFixAccM)).sort((a, b) => a.ts - b.ts);
    for (const f of later) {
      if (_gdSameFence(geoFenceAt(f, fences, opts.radiusFt), arrived.fence)) { end = f.ts; continue; }
      left = true; break;
    }
    if (left) {
      if (end > arrived.ts) dwells.push(Object.assign(_gdDwell(arrived.fence, arrived.ts, end, arrived.journeyId, false), { closedBy: 'fix' }));
    } else {
      open = { id: 'd-' + arrived.journeyId, fence: arrived.fence, kind: String(arrived.fence.kind || 'other'),
        name: arrived.fence.name || '', sinceTs: arrived.ts, journeyId: String(arrived.journeyId) };
    }
  }

  return {
    day: inp.day || '',
    dwells: dwells.filter(d => d.minutes >= 1),
    legs,
    open,
    pending: chain ? { id: chain.id, origin: chain.originFence, startTs: chain.startTs, stops: chain.stops, autoMinutes: Math.round(chain.autoMs / 60000) } : null,
    journeys,
  };
}

function _gdDwell(fence, startTs, endTs, journeyId, open) {
  return {
    id: 'd-' + String(journeyId),
    fence, kind: String(fence.kind || 'other'), name: fence.name || '',
    startTs, endTs, minutes: Math.round((endTs - startTs) / 60000),
    journeyId: String(journeyId), open: !!open,
  };
}

// ── Row shapes ──────────────────────────────────────────────────────────────
// The ONE mapping from derived dwells and legs to the rows the readers already
// consume. Kept beside the deriver so the shape is defined once.
//
//   shop dwell            -> shop_time_entries
//   job / client / place  -> job_time_entries (source geofence | client | place)
//   leg                   -> job_time_entries source 'drive' + td_mileage (gps)
//
// client_key carries the journey id, so a rebuild upserts onto its own rows.
function geoDeriveRows(result, ids) {
  const cid = ids && ids.contractorId, uid = ids && ids.employeeId;
  const iso = ms => new Date(ms).toISOString();
  const time = [], shop = [], miles = [];
  for (const d of (result && result.dwells) || []) {
    const base = { contractor_user_id: cid, employee_user_id: uid,
      arrived_at: iso(d.startTs), departed_at: iso(d.endTs), minutes: d.minutes, client_key: d.id };
    if (d.kind === 'shop') { shop.push(base); continue; }
    const f = d.fence || {};
    time.push(Object.assign(base, {
      job_id: f.jobId != null ? String(f.jobId) : null,
      dest_place: f.jobId != null ? null : (d.name || null),
      source: f.jobId != null ? 'geofence' : (f.clientId != null ? 'client' : 'place'),
    }));
  }
  for (const l of (result && result.legs) || []) {
    time.push({ contractor_user_id: cid, employee_user_id: uid, job_id: null,
      arrived_at: iso(l.startTs), departed_at: iso(l.endTs), minutes: l.minutes,
      dest_place: l.to.name || null, client_key: l.id, source: 'drive' });
    miles.push({
      id: l.id, legKey: l.id, gps: true, date: result.day,
      from: l.from.addr || l.from.name || '', from_name: l.from.name || '',
      to: l.to.addr || l.to.name || '', to_name: l.to.name || '',
      fromCoord: { lat: l.from.lat, lng: l.from.lng }, toCoord: { lat: l.to.lat, lng: l.to.lng },
      startedIso: iso(l.startTs), endedIso: iso(l.endTs), mins: l.minutes,
      miles: l.miles, calc_method: 'derived-' + l.milesFrom,
      collapsedStops: l.stops || 0,
      // The destination fence rides along (stripped by the wiring) so the
      // purpose can be resolved through the same table the manual log uses.
      _to: { kind: l.to.kind, clientId: l.to.clientId, jobId: l.to.jobId, placeId: l.to.placeId },
      client_id: l.to.clientId != null ? l.to.clientId : null,
      client_name: l.to.clientId != null ? (l.to.name || '') : '',
      purpose: l.to.kind === 'shop' ? 'Shop' : (l.to.kind === 'supply' ? 'Supply run' : (l.to.clientId != null || l.to.jobId != null ? 'Client Consult' : 'Business')),
      notes: '', start: 0, end: 0, vehicle: '',
    });
  }
  return { job_time_entries: time, shop_time_entries: shop, td_mileage: miles };
}
