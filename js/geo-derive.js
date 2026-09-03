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
//  10. EXCEPT PAPERWORK (owner 2026-09-02: "if it's a home office, app time
//      still counts", "yes, count it on no-drive days", and then the edge:
//      "office throws in after the fact for true app time after hours,
//      that's it; never office time unless it's outside of business hours
//      and we're home actively with the app open"). Inside a home-office
//      fence, minutes with the app OPEN are an Office row ONLY outside the
//      working day: before the first drive, after the last real work, or
//      on a day with no drive at all. Inside the working day the house is
//      whatever the dwell says it is (the shop, a home stop), never Office.
//      Carved out of any surrounding home dwell, never laid on top of it,
//      so no minute is counted twice. Presence is proven by fixes inside the
//      fence, never assumed from the app being open somewhere.
//  12. THE TRUCK WAS WHERE THE PHONE SAT (owner 2026-09-02). A departure's
//      origin is the last fix before the automotive flip with no drive on
//      the tape in between, when that fix is inside a fence; the nearest
//      fix inside the window is the fallback. A phone that slept through
//      the flip and woke down the road still names the fence it left.
//      Mirror for arrivals: the first fix after the walking flip and
//      before the next drive, when none sits inside the window.
//  11. THE DAY ENDS WITH THE LAST REAL WORK (owner 2026-08-24, restated
//      2026-09-02 on his own 5:29pm: "those aren't needed"). A dwell at a
//      base (the shop, a home office) that begins after the day's last
//      job, client or supply dwell is not a row, except for a wrap-up
//      allowance at a shop that is NOT also somebody's home: unloading the
//      truck is work, an evening at the house is not. A day with no
//      non-base work at all keeps its base dwells (a crew member's day at
//      the yard is a shift).
// ══════════════════════════════════════════════════════════════════════════

const GEO_DERIVE_DEFAULTS = Object.freeze({
  radiusFt: 600,          // one definition of "inside", replacing 600/797/950
  wrapMin: 30,            // rule 11: unloading at a real shop after the last job
  pathMax: 400,           // breadcrumbs kept on a mileage row (thinned, endpoints survive)
  fixWindowMs: 5 * 60000, // how far from a flip a fix may sit and still be its fix
  parkedFixMaxMs: 12 * 3600000, // how old the parked fix before a departure may be
  maxMph: 90,             // a trace point faster than this from the last kept one is not on the road
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

// THE TRUCK WAS WHERE THE PHONE SAT (owner 2026-09-02, his 7:51 departure).
// A phone asleep at the shop learns about the automotive flip only when a
// location event wakes it, one to three minutes later, by which time the
// nearest fix can already be down the road and outside the fence. But the
// tape says nothing drove between the last fix before the flip and the flip
// itself, so that fix is where the truck was parked, however old it is.
// This is what the old engine got by luck from a stale last-known fix; here
// it is the rule. Bounded by notBeforeTs (the previous journey's end: a fix
// from before an earlier drive says nothing about this one) and by age.
function _gdParkedFixBefore(fixes, ts, notBeforeTs, maxAgeMs, maxAccM) {
  let best = null;
  for (const f of fixes) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.acc != null && Number(f.acc) > maxAccM) continue;
    if (f.ts > ts || f.ts < notBeforeTs || ts - f.ts > maxAgeMs) continue;
    if (!best || f.ts > best.ts) best = f;
  }
  return best;
}
// The arrival's mirror: the first good fix after the walking flip and before
// the next drive, for a phone that only woke once it had parked.
function _gdSettledFixAfter(fixes, ts, notAfterTs, maxAgeMs, maxAccM) {
  let best = null;
  for (const f of fixes) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.acc != null && Number(f.acc) > maxAccM) continue;
    if (f.ts < ts || f.ts > notAfterTs || f.ts - ts > maxAgeMs) continue;
    if (!best || f.ts < best.ts) best = f;
  }
  return best;
}

// A stale coordinate riding on a fence event (a regionEnter row carries the
// last-known position, not a fresh one) landed a mile from the fix taken the
// same second, and the trace zigzagged: the owner's 3-mile drive read 6.1
// (2026-09-02). Two points cannot be a mile apart in the same second, so a
// point that would need more than maxMph from the previous kept one is not
// on the road, and an exact repeat (same place, same instant, from two
// tables) adds nothing.
function _gdCleanTrace(pts, maxMph) {
  const out = [];
  const lim = Number(maxMph) > 0 ? Number(maxMph) : GEO_DERIVE_DEFAULTS.maxMph;
  for (const f of pts) {
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.ts === f.ts && prev.lat === f.lat && prev.lng === f.lng) continue;
      const mi = _gdMiles(prev, f);
      const dtH = (f.ts - prev.ts) / 3600000;
      if (mi > 0.05 && (dtH <= 0 || mi / dtH > lim)) continue;
    }
    out.push(f);
  }
  return out;
}

// The path runs from the departure fix to the arrival fix, both included:
// the arrival ping lands a few seconds after the flip, and dropping it would
// cut the last block off every leg.
function _gdPathMiles(fixes, a, b, maxAccM, endpoints, maxMph) {
  let pts = fixes.filter(f => f && f.lat != null && f.lng != null && typeof f.ts === 'number' &&
    f.ts >= a && f.ts <= b && (f.acc == null || Number(f.acc) <= maxAccM));
  (endpoints || []).forEach(e => { if (e && pts.indexOf(e) < 0) pts.push(e); });
  pts.sort((x, y) => x.ts - y.ts);
  pts = _gdCleanTrace(pts, maxMph);
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
 * input.appEvents [{ts, kind}] app-active | app-background | app-terminate |
 *                 app-relaunch (the plugin's own lifecycle events), for rule 10
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

  for (let ji = 0; ji < journeys.length; ji++) {
    const j = journeys[ji];
    const prevEnd = ji > 0 && typeof journeys[ji - 1].endTs === 'number' ? journeys[ji - 1].endTs : -Infinity;
    const nextStart = ji + 1 < journeys.length ? journeys[ji + 1].startTs : Infinity;
    // Where the truck was parked beats where the phone happened to wake up:
    // a parked fix inside a fence names the origin even when a later fix
    // inside the window sits outside every fence.
    const parkedFix = _gdParkedFixBefore(fixes, j.startTs, prevEnd, opts.parkedFixMaxMs, opts.maxFixAccM);
    const nearFix = at(j.startTs);
    const startFix = (parkedFix && fenceOf(parkedFix)) ? parkedFix : (nearFix || parkedFix);
    const depFence = fenceOf(startFix);
    // The departure ping labels the dwell that just ended. If it is missing,
    // the arrival that opened the dwell still knows where it was.
    const fromFence = depFence || (arrived && arrived.fence) || null;

    // A JOURNEY THAT NEVER LEFT IS NOT A DEPARTURE.
    //
    // CoreMotion calls automotive on things that are not a drive: the radio
    // spinning up on an app relaunch, a phone set on a running truck, a jostle
    // in a tool bag. When such a flip has no closing flip yet, the branch below
    // used to close the dwell at the flip and clear `arrived`, so the tail had
    // nothing left to report and `open` came back null. Nothing is written for
    // a still-open journey either (rule 5), so the day just loses the person:
    // the on-site card falls back to the proximity prompt with no arrival
    // stamp, the Time Log shows the visit ending at the flip, and
    // _liveActOnSite is handed null so the Dynamic Island and lock screen go
    // dark and stay dark.
    //
    // Owner, at John Doe from 08:01 and never away: an open journey minted at
    // 14:19:38, the second a UAT roll reloaded the app, ended his visit there
    // while every single fix after it sat 61 to 317 ft from the client, inside
    // the 600 ft fence. He was still standing in the same spot hours later.
    //
    // So an OPEN journey only ends the dwell once something has actually left
    // the fence. A closed journey is untouched: it has a destination flip and
    // the rest of the loop decides what it was.
    if (arrived && j.open && _gdStayedPut(fixes, arrived.fence, j.startTs, nowMs, opts)) {
      // Went nowhere. Keep standing where we are and ignore this journey.
      continue;
    }
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

    const endFix = at(j.endTs) || _gdSettledFixAfter(fixes, j.endTs, nextStart, opts.parkedFixMaxMs, opts.maxFixAccM);
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
        const p = _gdPathMiles(fixes, j.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix], opts.maxMph);
        miles = p > 0 ? p : _gdMiles(a, b);
        milesFrom = p > 0 ? 'path' : 'straight';
      }
      legs.push({
        id: chain.id, from: a, to: b,
        startTs: chain.startTs, endTs: j.endTs,
        minutes: Math.round(chain.autoMs / 60000),
        miles: Math.round(miles * 10) / 10, milesFrom,
        collapsed, stops: chain.stops,
        // What the phone actually saw between the two flips, for the map and
        // for the route button. A collapsed leg spans the personal stop too,
        // which is the honest picture of where the truck went; the MILES on
        // it are the direct route, per rule 6.
        path: _gdPath(fixes, chain.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix], opts.pathMax, opts.maxMph),
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
  // Why there is no open dwell, for telemetry. Standing inside a fence with
  // the island dark, "open: none" alone could not say which branch dropped the
  // person, and guessing at it from chat burned most of 2026-09-03 on two
  // wrong theories. Named here, at the only place that decides it.
  let openWhy = !arrived ? 'no-arrival' : (!arrived.fence ? 'arrival-unfenced' : 'left');
  if (arrived && arrived.fence) {
    let end = arrived.ts, left = false;
    const later = fixes.filter(f => f.ts > arrived.ts && f.ts < dayEnd && (f.acc == null || Number(f.acc) <= opts.maxFixAccM)).sort((a, b) => a.ts - b.ts);
    // A departure needs CORROBORATION: one fix outside is not leaving.
    //
    // This guard existed in the old engine and was lost in the rewrite. Its
    // original note (js/geo-track.js, owner report 2026-08-06) still holds
    // word for word: "A single fix, especially the first one back after
    // sleep, is never enough on its own: one coarse wake-up fix falsely
    // closed real, still-on-site visits."
    //
    // It bit again on 2026-09-03, harder. Standing at John Doe all day, the
    // 14:19 foreground wake produced one cached fix 343 ft out, past the
    // 300 ft fence. That lone outlier closed a visit that was still running:
    // the Time Log cut the afternoon, and because the closed dwell means
    // `open` is null, _geoOpenDwellPublish had nothing to publish, so
    // _liveActOnSite was never called and the Dynamic Island and lock screen
    // stayed empty all day with no error anywhere to explain it.
    //
    // geo_events stores no accuracy column, so every server fix arrives with
    // acc null and the maxFixAccM filter above can never reject a coarse one.
    // Corroboration is the defence that does not depend on data we do not
    // have: a real departure keeps producing fixes outside, an outlier is
    // followed by fixes back inside.
    // STILL HERE means still inside the fence we arrived at, NOT "that fence
    // still wins the ranking contest against every other fence".
    //
    // geoFenceAt returns the highest-RANKED fence containing a fix (job beats
    // shop beats home_office beats client). Testing the winner against
    // arrived.fence means a dwell opened at a CLIENT is reported as departed
    // the moment any higher-ranked fence starts containing the same spot,
    // with the person standing perfectly still. A job scheduled at that
    // client's address mid-day does exactly that, and so does any re-derive
    // that rebuilds the fence list.
    //
    // Owner, on site at John Doe all day 2026-09-03: the visit was stamped
    // departed at 14:19:38, the instant a UAT roll reloaded the app and
    // rebuilt the fences. Every fix after it sits 61 to 317 ft from the
    // client, well inside the 600 ft fence: nobody went anywhere. Closing it
    // also nulled `open`, so the on-site card had nothing to publish and the
    // Dynamic Island and lock screen stayed empty for the rest of the day.
    //
    // Testing containment against arrived.fence ALONE (the _gdPresence idiom)
    // asks the only question that matters, and a real departure still leaves
    // that fence like any other.
    const inFence = f => _gdSameFence(geoFenceAt(f, [arrived.fence], opts.radiusFt), arrived.fence);
    for (let i = 0; i < later.length; i++) {
      if (inFence(later[i])) { end = later[i].ts; continue; }
      // Outside. Confirmed only if the NEXT fix is also outside; a single
      // outlier between two inside fixes is noise and is skipped.
      const next = later[i + 1];
      if (next && inFence(next)) continue;
      // Nothing after it to corroborate with either: an unconfirmed last
      // reading does not get to end a day that may still be running.
      if (!next) continue;
      left = true; break;
    }
    if (left) {
      if (end > arrived.ts) dwells.push(Object.assign(_gdDwell(arrived.fence, arrived.ts, end, arrived.journeyId, false), { closedBy: 'fix' }));
      openWhy = 'left-at-fix';
    } else {
      openWhy = '';
      open = { id: 'd-' + arrived.journeyId, fence: arrived.fence, kind: String(arrived.fence.kind || 'other'),
        name: arrived.fence.name || '', sinceTs: arrived.ts, journeyId: String(arrived.journeyId) };
    }
  }

  // Rule 10: paperwork at the home office.
  const carved = _gdOffice(dwells, open, journeys, fixes, fences, inp.appEvents, dayStart, dayEnd, nowMs, opts);
  // Rule 11: the day ends with the last real work.
  const ended = _gdEndOfDay(carved, fences, opts, open, journeys.some(j => j && j.open));

  return {
    day: inp.day || '',
    dwells: ended.filter(d => d.minutes >= 1),
    legs,
    open,
    // Diagnostic only, never a rule: which branch decided there is nobody on
    // site. Empty when `open` is set.
    openWhy: open ? '' : openWhy,
    pending: chain ? { id: chain.id, origin: chain.originFence, startTs: chain.startTs, stops: chain.stops, autoMinutes: Math.round(chain.autoMs / 60000) } : null,
    journeys,
  };
}

// Stretches of proven presence inside a fence: consecutive fixes inside it
// are one stretch; the first fix outside ends it at the last one inside.
// Did the phone STAY PUT inside this fence after an automotive flip?
//
// Not the same question as "did it leave". A drive that started 30 seconds ago
// has not left either: there are simply no fixes yet. What separates a real
// departure from a phantom flip is TIME plus continued presence. Somebody who
// flipped to automotive and is still producing fixes inside the same fence ten
// minutes later did not drive off; the radio, a jostle or a relaunch called it
// automotive. Somebody genuinely pulling away stops producing them.
//
// stillEndMs is the same threshold the deriver already uses for "a truck that
// sits this long has parked", which is the identical judgement from the other
// side, so it is reused rather than adding a second number.
function _gdStayedPut(fixes, fence, sinceTs, nowMs, opts) {
  if (!fence) return false;
  const r = (opts && Number(opts.radiusFt) > 0) ? Number(opts.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  const maxAcc = (opts && Number(opts.maxFixAccM) > 0) ? Number(opts.maxFixAccM) : GEO_DERIVE_DEFAULTS.maxFixAccM;
  const settle = (opts && Number(opts.stillEndMs) > 0) ? Number(opts.stillEndMs) : GEO_DERIVE_DEFAULTS.stillEndMs;
  const later = (fixes || []).filter(f => f && typeof f.ts === 'number' && f.ts >= sinceTs &&
    (nowMs == null || f.ts <= nowMs) && f.lat != null && f.lng != null &&
    (f.acc == null || Number(f.acc) <= maxAcc)).sort((a, b) => a.ts - b.ts);
  let outside = 0, proof = false;
  for (const f of later) {
    if (_gdSameFence(geoFenceAt(f, [fence], r), fence)) {
      outside = 0;
      // Still here, well after the flip: that is the proof.
      if (f.ts - sinceTs >= settle) proof = true;
      continue;
    }
    // Two in a row outside is a real departure, and it ends the question even
    // if later fixes wander back (corroborated for the same reason the open
    // tail needs it: geo_events carries no accuracy, so one coarse fix must
    // never decide this on its own).
    if (++outside >= 2) return false;
  }
  return proof;
}

function _gdPresence(fixes, fence, radiusFt, maxAccM) {
  const pts = fixes.filter(f => f && f.lat != null && f.lng != null && typeof f.ts === 'number' &&
    (f.acc == null || Number(f.acc) <= maxAccM)).sort((a, b) => a.ts - b.ts);
  const out = [];
  let cur = null;
  for (const f of pts) {
    const inside = _gdSameFence(geoFenceAt(f, [fence], radiusFt), fence);
    if (inside) { if (cur) cur[1] = f.ts; else cur = [f.ts, f.ts]; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// App-open intervals from the lifecycle tape, clipped to the day.
function _gdAppOpen(appEvents, dayStart, dayEnd, nowMs) {
  // ONLY app-active opens a foreground interval. app-relaunch used to count
  // too, and that was wrong: a relaunch is a new PROCESS, and iOS starts the
  // process on its own for a geofence crossing, a significant-change wake or
  // a silent push, with nobody looking at the screen. Such a launch never
  // becomes active and never enters background either, so the interval it
  // opened stayed open until the next real cycle, or ran to now, and hours of
  // a phone sitting in a pocket at the house counted as paperwork. That is the
  // exact opposite of the rule this serves (owner: "never office time unless
  // it's outside of business hours and we're home actively with the app
  // open"). A relaunch the PERSON caused is followed by its own app-active,
  // which opens the interval properly, so nothing real is lost.
  const ev = (Array.isArray(appEvents) ? appEvents : [])
    .filter(e => e && typeof e.ts === 'number' && e.kind)
    .map(e => ({ ts: e.ts, on: String(e.kind) === 'active' }))
    .sort((a, b) => a.ts - b.ts);
  const out = [];
  let openAt = null;
  for (const e of ev) {
    if (e.on) { if (openAt == null) openAt = e.ts; }
    else if (openAt != null) { out.push([openAt, e.ts]); openAt = null; }
  }
  if (openAt != null) out.push([openAt, Math.min(nowMs, dayEnd)]);
  const lim = Math.min(nowMs, dayEnd);
  return out.map(([a, b]) => [Math.max(a, dayStart), Math.min(b, lim)]).filter(([a, b]) => b > a);
}

function _gdIntersect(A, B) {
  const out = [];
  for (const [a1, a2] of A) for (const [b1, b2] of B) {
    const lo = Math.max(a1, b1), hi = Math.min(a2, b2);
    if (hi > lo) out.push([lo, hi]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// The working day: from the first drive to the end of the last real work.
// Inside it the house is the shop or a stop, never Office; the office rule
// applies before it, after it, and on a day that never had a drive. The end
// is open (Infinity) while a work dwell is open or the truck is on the road,
// the same "the day is not over" reading rule 11 uses.
function _gdWorkWindow(dwells, journeys, open) {
  const js = (journeys || []).filter(j => j && typeof j.startTs === 'number');
  if (!js.length) return null;                            // no drive: no working day
  const start = Math.min.apply(null, js.map(j => j.startTs));
  const work = (dwells || []).filter(d => d && !_gdIsBaseKind(d.kind) && d.kind !== 'office');
  const openWork = !!(open && !_gdIsBaseKind(open.kind) && open.kind !== 'office');
  const driving = js.some(j => j.open);
  const end = (openWork || driving) ? Infinity : (work.length ? Math.max.apply(null, work.map(d => d.endTs)) : start);
  return [start, end];
}

// Office rows for every home-office fence, carved out of home dwells.
function _gdOffice(dwells, open, journeys, fixes, fences, appEvents, dayStart, dayEnd, nowMs, opts) {
  const homes = (fences || []).filter(f => f && String(f.kind) === 'home_office' && f.lat != null && f.lng != null);
  let appOpen = _gdAppOpen(appEvents, dayStart, dayEnd, nowMs);
  // Owner 2026-09-02: "never office time unless it's outside of business
  // hours." His 12:37 at the shop (which is the house) with the app open
  // came out as a two-minute Office row in the middle of a work day, laid
  // over shop time, and the writer refused the overlap. Outside the working
  // day only: before the first drive, after the last work.
  const win = _gdWorkWindow(dwells, journeys, open);
  if (win) {
    const outside = [];
    if (win[0] > dayStart) outside.push([dayStart, win[0]]);
    if (win[1] < dayEnd) outside.push([win[1], dayEnd]);
    appOpen = _gdIntersect(appOpen, outside);
  }
  if (!homes.length || !appOpen.length) return dwells;
  let out = dwells.slice();
  for (const home of homes) {
    // Presence: fixes inside the fence, plus the closed home dwells and the
    // open tail if it is this fence (both already proved by their arrival).
    const presence = _gdPresence(fixes, home, opts.radiusFt, opts.maxFixAccM)
      .concat(dwells.filter(d => _gdSameFence(d.fence, home)).map(d => [d.startTs, d.endTs]))
      .concat(open && _gdSameFence(open.fence, home) ? [[open.sinceTs, Math.min(nowMs, dayEnd)]] : []);
    let office = _gdIntersect(appOpen, presence);
    // Merge touching or overlapping office spans.
    const merged = [];
    for (const sp of office) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push(sp.slice());
    }
    office = merged.filter(([a, b]) => b - a >= 60000);
    if (!office.length) continue;
    // Carve them out of whatever base dwell holds that place at that time.
    //
    // It used to carve ONLY dwells whose fence was this home office. That is
    // not the same set the office spans were built from: _gdPresence tests the
    // home fence ALONE, so any fix at the house counts as present, while the
    // full-array geoFenceAt gives that same fix to the SHOP, because shop
    // outranks home_office and the owner's two fences are 5 m apart. So the
    // house produced a shop dwell, the office row was laid on top of it, and
    // nothing carved it: "geo_replace_day: N overlapping pair(s)", which
    // refuses the WHOLE day. The owner's 2026-09-03 sat refused from 07:48
    // onward, so no arrival, no rows, nothing on the Time Log all day.
    // A shop that shares its spot with a home office is that house.
    const isHere = d => _gdSameFence(d.fence, home) ||
      (d.kind === 'shop' && _gdShopIsHome(d.fence, fences, opts.radiusFt) &&
       _gdMiles(d.fence, home) * 5280 <= (Number(opts.radiusFt) > 0 ? Number(opts.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt));
    const next = [];
    for (const d of out) {
      if (!_gdIsBaseKind(d.kind) || !isHere(d)) { next.push(d); continue; }
      let pieces = [[d.startTs, d.endTs]];
      for (const [oa, ob] of office) {
        const np = [];
        for (const [a, b] of pieces) {
          if (ob <= a || oa >= b) { np.push([a, b]); continue; }
          if (oa > a) np.push([a, oa]);
          if (ob < b) np.push([ob, b]);
        }
        pieces = np;
      }
      // The remainder keeps its OWN identity: carving paperwork out of a shift
      // at the yard leaves shop time, never a home-office row invented from
      // the fence the carve happened to be keyed on.
      pieces.forEach(([a, b]) => { if (b - a >= 60000) next.push(Object.assign(_gdDwell(d.fence, a, b, d.journeyId, false), { closedBy: d.closedBy })); });
    }
    office.forEach(([a, b]) => next.push(Object.assign(_gdDwell(home, a, b, 'o-' + String(home.id) + '-' + Math.round(a).toString(36), false), { kind: 'office' })));
    out = next.sort((x, y) => x.startTs - y.startTs);
  }
  return out;
}

const _GD_BASE = { shop: 1, home_office: 1 };
function _gdIsBaseKind(k) { return !!_GD_BASE[String(k || '')]; }
// A shop that shares its spot with a home office is somebody's house.
function _gdShopIsHome(fence, fences, radiusFt) {
  if (!fence || String(fence.kind) !== 'shop') return false;
  const r = Number(radiusFt) > 0 ? Number(radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  return (fences || []).some(f => f && String(f.kind) === 'home_office' && f.lat != null && f.lng != null &&
    _gdMiles(fence, f) * 5280 <= r);
}
// "After the last real work" can only be judged against everything the day
// holds so far, and a day in progress holds more than its CLOSED dwells:
// an open dwell at a work fence is work under way, and a truck on the road
// right now is going somewhere nobody knows yet. Judged from closed rows
// alone, the owner's 12:12 to 12:47 at the shop, between two client visits,
// was "after the last work" the moment he arrived at the second client,
// because that visit was open and did not count (2026-09-02). It is shop
// time. The evening rule still holds: once the drive has ended, at home or
// at a stop that never resolves, the base dwell after the last work is not
// a row.
function _gdEndOfDay(dwells, fences, opts, open, driving) {
  const work = dwells.filter(d => !_gdIsBaseKind(d.kind) && d.kind !== 'office');
  if (!work.length) return dwells;                       // a yard-only day is a shift
  const openWork = !!(open && !_gdIsBaseKind(open.kind) && open.kind !== 'office');
  if (openWork || driving) return dwells;                // the day is not over
  const lastWorkEnd = Math.max.apply(null, work.map(d => d.endTs));
  const out = [];
  for (const d of dwells) {
    if (!_gdIsBaseKind(d.kind) || d.startTs < lastWorkEnd) { out.push(d); continue; }
    // After the last real work. A real shop gets the wrap-up allowance.
    if (d.kind === 'shop' && !_gdShopIsHome(d.fence, fences, opts.radiusFt)) {
      const cap = d.startTs + (Number(opts.wrapMin) > 0 ? Number(opts.wrapMin) : 0) * 60000;
      if (cap > d.startTs) out.push(Object.assign(_gdDwell(d.fence, d.startTs, Math.min(d.endTs, cap), d.journeyId, false), { closedBy: d.closedBy, wrapped: d.endTs > cap }));
    }
    // A home office, or a shop that is the house: nothing.
  }
  return out;
}

// The breadcrumbs a leg actually recorded, endpoints included, thinned the
// same way the live tracker thins: drop every other interior point until it
// fits, so the trace still starts and ends where it did.
function _gdPath(fixes, a, b, maxAccM, endpoints, max, maxMph) {
  const r5 = v => Math.round(v * 1e5) / 1e5;
  let pts = fixes.filter(f => f && f.lat != null && f.lng != null && typeof f.ts === 'number' &&
    f.ts >= a && f.ts <= b && (f.acc == null || Number(f.acc) <= maxAccM));
  (endpoints || []).forEach(e => { if (e && pts.indexOf(e) < 0) pts.push(e); });
  pts.sort((x, y) => x.ts - y.ts);
  pts = _gdCleanTrace(pts, maxMph);
  let path = pts.map(f => [r5(f.lat), r5(f.lng), Math.round(f.ts)]);
  const lim = Number(max) > 2 ? Number(max) : 400;
  while (path.length > lim) {
    const keep = [path[0]];
    for (let i = 1; i < path.length - 1; i += 2) keep.push(path[i]);
    keep.push(path[path.length - 1]);
    path = keep;
  }
  return path;
}

function _gdDwell(fence, startTs, endTs, journeyId, open) {
  return {
    id: (/^o-/.test(String(journeyId)) ? '' : 'd-') + String(journeyId),
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
      source: d.kind === 'office' ? 'place-office'
        : (f.jobId != null ? 'geofence' : (f.clientId != null ? 'client' : 'place')),
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
      // The mileage list orders by when a row was logged; a derived row is
      // logged at the moment its drive began, which is the order a person
      // expects. (Without these the derived rows sorted arbitrarily.)
      loggedAt: iso(l.startTs), created_at: iso(l.startTs),
      miles: l.miles, calc_method: 'derived-' + l.milesFrom,
      gpsMiles: l.milesFrom === 'path' ? l.miles : 0,
      path: Array.isArray(l.path) ? l.path : [],
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
