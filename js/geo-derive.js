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
//   5b. A gap between two automotive segments is a STOP only if the phone can
//      be shown to have stayed put across it: the gap is stillEndMs or longer,
//      or the fixes bracketing it are within a fence radius of each other.
//      Otherwise it was one drive and the classifier was wrong.
//   6. A pending chain that later reaches a saved fence collapses to ONE leg:
//      first saved origin to this fence, direct-route miles, drive minutes =
//      the automotive segments only (a stop is not drive time).
//   7. Same fence both ends is a round trip: NO MILEAGE, ever. If a stop
//      happened between them, the drive time rows are still written and the
//      hole between them is an unsaved job site (owner 2026-09-04). A
//      same-fence loop with no stop in it writes nothing at all.
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
  // PROOF THAT HE STOPPED, inside a drive the tape never ended (owner
  // 2026-09-04: "if we cant reliably tell what happened ... and he was
  // constantly moving during that time I say we merge them, if we can prove he
  // stopped then we split it to a unsaved address").
  //
  // Its own number because the two nearby ones mean different things and
  // neither fits. minLegMs (2 min) is about a journey being too short to
  // matter, and at two minutes this test starts firing on the OWNER's account,
  // which has no missing stops: that is the tell it has gone too far.
  // stillEndMs (10 min) is when a truck that stopped reporting has parked, and
  // at ten it misses a real one: his 3 September, 2:44 to 2:49, six fixes at
  // one identical coordinate 2,395 ft from his dad's shop.
  //
  // Measured on both accounts over seven days, clusters of fixes within
  // radiusFt of each other inside a drive: 2 min gives 36 splits (8 of them
  // the owner's, all wrong), 3 gives 19, 4 gives 12, 5 gives 6, 10 gives 4.
  // Four is the lowest that still leaves the owner's account untouched, and it
  // is the one that catches his 2:44.
  parkedStillMs: 4 * 60000,
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
  // A REPEAT IS NOT A NEW READING (owner 2026-09-04, his 2 September 1:00pm
  // drive: "I know the drive leg should be a lot longer then that").
  //
  // A sleeping phone restates its last position verbatim, and the first row
  // after a journey ends is often one of those. His 2 September: the fix at
  // 13:00:02 carries 39.04403035863875 / -95.71551566659944, the same sixteen
  // digits as 12:49:55 on the approach, and it sits 605 ft from his dad's shop
  // against a 600 ft fence. Five feet, and the arrival resolved to nowhere, so
  // the chain never closed and the whole day derived nothing. The next fix,
  // 13:00:47, is a genuinely new reading 14 ft from the shop.
  //
  // So the arrival is the first fix that actually SAYS something: a candidate
  // repeating the coordinate of the fix immediately before it is skipped. It
  // is not evidence he was not there, it is a reading that carries no
  // information about where he settled. If every candidate is a repeat, the
  // first one still wins, because a stale answer beats no answer.
  const ordered = (fixes || []).filter(f => f && f.lat != null && f.lng != null &&
    typeof f.ts === 'number' && (f.acc == null || Number(f.acc) <= maxAccM))
    .sort((a, b) => a.ts - b.ts);
  let best = null, fallback = null;
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    if (f.ts < ts || f.ts > notAfterTs || f.ts - ts > maxAgeMs) continue;
    if (!fallback) fallback = f;
    const prev = ordered[i - 1];
    if (prev && prev.lat === f.lat && prev.lng === f.lng) continue;
    if (!best || f.ts < best.ts) best = f;
  }
  return best || fallback;
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
// A PARKED TRUCK ENDS THE DRIVE, WHATEVER THE TAPE SAYS.
//
// Owner 2026-09-04: "if it stays automotive or drive, dont want a drive
// through it to stop it and break it up, but would want it to break it up if
// a phone gets left and hasnt changed state."
//
// Jack's 3 September, 1:55 to 2:53pm, came out as two back-to-back drives with
// nothing between them. CoreMotion never left automotive in that whole stretch,
// so the journey builder, which ends a journey on a foot or a long still flip,
// had nothing to end on. The fixes knew: he was 66 ft from his dad's shop at
// 2:14 and then the phone said nothing for THIRTY MINUTES. A truck does not go
// quiet for half an hour on the road.
//
// This is the mirror of _gdStayedPut. That uses "the phone is still producing
// fixes in the same spot" to REFUSE a phantom departure; the same evidence
// asserts an arrival here. It works on STILLNESS, and stillness means one
// thing only: the phone is in the same place before and after. Two other
// readings were tried against his real week and both are wrong.
//
// NOT "a fix landed inside a fence". He drives past his own shop: 14 fixes
// landed inside a fence mid-drive in one week across two accounts, one of them
// two seconds before a fix outside it. That rule would have invented 14 stops.
//
// NOT "the phone went quiet". A silence is not evidence of anything, which the
// data says plainly. Of the six gaps of ten minutes or more inside a drive that
// week, five were the phone sitting at one spot and ONE was Jack covering 4.8
// miles at 22 mph with the radio asleep. Below ten minutes it is worse: of 67
// gaps in the five-to-ten minute band, 63 show him MOVING, a median of two
// miles across the gap. A gap is the tracker failing, not the truck stopping,
// and the only way to tell them apart is where he was on the far side of it.
//
// So the test is a CLUSTER: consecutive fixes within a fence radius of each
// other spanning parkedStillMs. That covers the long silence too, because a
// fix, a thirty-minute hole and a fix at the same spot is one cluster, while
// the same hole with the far end four miles away is not. See parkedStillMs in
// GEO_DERIVE_DEFAULTS for why four minutes and not two, five or ten.
// THE PHONE NEVER LEFT ONE SPOT. The first run of fixes inside a window that
// all sit within radiusFt of each other and span at least minMs, as
// [firstTs, lastTs], or null. One scan, used by both things that need to know
// whether he actually stopped: the parked-truck split below and the
// stop-proof for a gap between two driving segments.
function _gdStillRun(fixes, from, to, minMs, opts) {
  const r = (opts && Number(opts.radiusFt) > 0) ? Number(opts.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  const maxAcc = (opts && Number(opts.maxFixAccM) > 0) ? Number(opts.maxFixAccM) : GEO_DERIVE_DEFAULTS.maxFixAccM;
  const inside = (fixes || []).filter(f => f && f.lat != null && f.lng != null &&
    typeof f.ts === 'number' && f.ts >= from && f.ts <= to &&
    (f.acc == null || Number(f.acc) <= maxAcc)).sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < inside.length; i++) {
    // How long did it sit in this one spot?
    let k = i;
    while (k + 1 < inside.length && _gdMiles(inside[i], inside[k + 1]) * 5280 <= r) k++;
    if (inside[k].ts - inside[i].ts >= minMs) return [inside[i].ts, inside[k].ts, inside[i]];
    i = k;
  }
  return null;
}

function _gdParkedSplit(j, fixes, opts) {
  const still = (Number(opts.parkedStillMs) > 0) ? Number(opts.parkedStillMs) : GEO_DERIVE_DEFAULTS.parkedStillMs;
  const end = (typeof j.endTs === 'number') ? j.endTs : Infinity;
  const run = _gdStillRun(fixes, j.startTs, end, still, opts);
  if (!run) return null;
  // NOBODY DRIVES A MILE IN FIFTEEN SECONDS (owner 2026-09-04, his 2 September
  // 1:00pm drive: "I know the drive leg should be a lot longer then that").
  //
  // A sleeping phone restates its last position verbatim, and two of those in
  // a row look exactly like a parked truck. His 2 September: fixes at 12:44:54
  // and 12:49:40 carrying the same sixteen digits, then 12:49:55, fifteen
  // seconds later and 1.3 miles north. 312 mph. One of those readings is a lie
  // and it is the repeat, so the "stop" between them never happened, and
  // reading it as one cut a 15-minute drive to his dad's shop into two drives
  // of 7 and 3 minutes with a phantom stop wedged between.
  //
  // maxMph, the file's existing "not on the road" speed, and only here: this
  // split has no witness but the fixes. _gdStopProved is asked about a gap the
  // TAPE already broke, so it has a second observer and keeps its evidence.
  const maxAcc = (Number(opts.maxFixAccM) > 0) ? Number(opts.maxFixAccM) : GEO_DERIVE_DEFAULTS.maxFixAccM;
  const lim = (Number(opts.maxMph) > 0) ? Number(opts.maxMph) : GEO_DERIVE_DEFAULTS.maxMph;
  let next = null;
  for (const f of (fixes || [])) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.ts <= run[1] || (f.acc != null && Number(f.acc) > maxAcc)) continue;
    if (!next || f.ts < next.ts) next = f;
  }
  if (next && run[2]) {
    const mi = _gdMiles(run[2], next), dtH = (next.ts - run[1]) / 3600000;
    if (mi > 0.05 && (dtH <= 0 || mi / dtH > lim)) return null;
  }
  return run;
}

// A PARKED TRUCK STAYS PARKED UNTIL SOMETHING SAYS IT MOVED (owner 2026-09-04:
// "would want it to break it up if a phone gets left and hasnt changed state").
//
// The split used to resume the drive at the LAST FIX of the still run, which
// is only where the readings stopped, not where he pulled out. His 3
// September: fixes 14 ft from his dad's shop at 2:03 and 2:14, then the phone
// slept and said nothing at all until the tape flipped at 2:43. Resuming at
// 2:14 cut a 40-minute stop at the shop down to 11 and drew a 29-minute drive
// through the half hour he spent standing in the yard.
//
// So the truck sits until the first thing that shows movement: a fix outside
// the spot it was parked in, or the tape leaving 'still'. Whichever comes
// first, and never past the end of the journey being split.
function _gdParkedResume(cut, fixes, tape, opts, endTs) {
  const at = cut[2];
  if (!at) return cut[1];
  const r = (opts && Number(opts.radiusFt) > 0) ? Number(opts.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  const maxAcc = (opts && Number(opts.maxFixAccM) > 0) ? Number(opts.maxFixAccM) : GEO_DERIVE_DEFAULTS.maxFixAccM;
  let moved = Infinity;
  for (const f of (fixes || [])) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.ts <= cut[1] || f.ts >= moved) continue;
    if (f.acc != null && Number(f.acc) > maxAcc) continue;
    if (_gdMiles(at, f) * 5280 > r) moved = f.ts;
  }
  let flip = Infinity;
  for (const x of (tape || [])) { if (x.ts > cut[1] && x.k !== 'still') { flip = x.ts; break; } }
  const back = Math.min(moved, flip);
  // Nothing said it moved before this journey ended: it never drove again.
  if (!isFinite(back) || back <= cut[0]) return (endTs != null) ? null : cut[1];
  if (endTs != null && back >= endTs) return null;
  return Math.max(back, cut[1]);
}

function _gdJourneys(tape, personId, opts, dayStart, dayEnd, nowMs, fixes) {
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
    // still: parked if it runs long enough before the next transition.
    //
    // THE RUN, NOT THE SAMPLE (owner 2026-09-04, his 2 September 1:00pm drive:
    // "I know the drive leg should be a lot longer then that"). CoreMotion
    // re-states 'still' while nothing changes, and measuring one sample to the
    // NEXT ENTRY read those re-statements as the truck moving again. His
    // 12:52:37 still ran to 13:07:01 automotive, fourteen and a half minutes
    // parked at his dad's shop, but it was logged as two stills 7m26s and
    // 6m58s apart, so neither reached the ten-minute floor and the drive
    // swallowed the whole shop visit. Consecutive stills are one stretch of
    // stillness; the stretch is what gets measured.
    let n = i + 1;
    while (n < t.length && t[n].k === 'still') n++;
    const stillFor = (n < t.length ? t[n].ts : nowMs) - x.ts;
    if (stillFor >= opts.stillEndMs) { cur.endTs = x.ts; out.push(cur); cur = null; i = n - 1; }
  }
  if (cur) { cur.endTs = null; cur.open = true; out.push(cur); }
  // Split every journey the fixes say was interrupted, however many times.
  // Bounded by the fix count: each pass consumes at least one fix.
  const split = [];
  for (const j of out) {
    let head = j, guard = 0;
    while (head && guard++ < 200) {
      const cut = _gdParkedSplit(head, fixes, opts);
      if (!cut || !(cut[0] > head.startTs) || !(head.endTs == null || cut[1] < head.endTs)) break;
      const back = _gdParkedResume(cut, fixes, t, opts, head.endTs);
      split.push({ startTs: head.startTs, id: head.id, endTs: cut[0] });
      // PARKED FOR THE REST OF THE JOURNEY. Nothing showed the truck moving
      // before the flip that ended this journey, so there is no second
      // segment: it sat there until the tape said otherwise, and the dwell
      // between this end and the next departure is the whole of it. His 3
      // September, 2:03 to 2:43 in his dad's yard.
      if (back == null) { head = null; break; }
      head = { startTs: back, id: _gdJourneyId(personId, back, null),
        endTs: head.endTs, open: head.open };
    }
    if (head) split.push(head);
  }
  // "The next geo fence you arrive at THAT DAY": a journey that ends after
  // midnight is still open as far as this day is concerned.
  return split.filter(j => j.startTs >= dayStart && j.startTs < dayEnd)
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

  const journeys = _gdJourneys(inp.tape, inp.personId, opts, dayStart, dayEnd, nowMs, fixes);
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
      if (!chain && fromFence) chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0, drives: [], openSince: j.startTs };
      else if (chain) chain.openSince = j.startTs;
      break;
    }

    // WHERE HE STOPPED BEATS WHERE HE LAST WAS ON THE ROAD (owner 2026-09-04:
    // "none of these drives show the immediate drives he's had from court to
    // Oakley when there was no core motion flip in between").
    //
    // Jack's 31 August, and the reason a 4.4 mile run to his dad's shop came
    // out as a seven-hour drive. He left home at 07:11 and the tape flipped
    // out of automotive at 07:50:34. Two fixes sit near that flip:
    //
    //     07:48:18   3,190 ft from the shop   still on the road
    //     07:53:19      30 ft from the shop   parked at the shop
    //
    // `at()` takes the nearest fix in TIME and does not care which side of the
    // flip it falls on, so the road fix won by 29 seconds, resolved to no
    // fence, and the arrival was discarded as a personal stop. The chain then
    // rolled on until 14:08, swallowing a real 37-minute visit to the shop
    // inside a row labelled "drive". `_gdSettledFixAfter`, written for exactly
    // this, never ran, because `at()` had already returned something.
    //
    // The two candidates were never equivalent. A fix BEFORE the end of a
    // drive is by definition still moving; a fix AFTER the flip, with no
    // automotive between it and the flip (nextStart bounds that), is where the
    // truck came to rest, however late the phone got round to reporting it.
    // His drive pings land every five minutes, so the arrival fix is routinely
    // later than the last road fix is early, and the road fix wins almost
    // every time.
    //
    // So the arrival is resolved the same way the departure already is:
    // _gdParkedFixBefore names the origin from where the truck SAT, and this
    // is its mirror. `at()` stays as the fallback for a journey with nothing
    // after it at all.
    const endFix = _gdSettledFixAfter(fixes, j.endTs, nextStart, opts.parkedFixMaxMs, opts.maxFixAccM) || at(j.endTs);
    const toFence = fenceOf(endFix);
    const autoMs = j.endTs - j.startTs;

    if (!chain) {
      if (!fromFence) {
        // Unknown origin: nothing to measure from. If it ended somewhere
        // saved, a dwell opens there, and that is all.
        if (toFence) arrived = { fence: toFence, ts: j.endTs, journeyId: j.id };
        continue;
      }
      chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0, drives: [] };
    }
    // EACH DRIVE KEEPS ITS OWN SPAN (owner 2026-09-04). A chain through
    // unsaved stops is not one drive: his 1 September ran shop, four
    // customers, home, and the tape flipped onFoot or still at every one of
    // them. Collapsed to a single row it read as one 58-minute drive from
    // 12:04 to 3:00 with four job sites inside it. The MILES still collapse to
    // the direct route (rule 6, and his rule that an unsaved address is never
    // a mileage endpoint); only the TIME stops pretending he was driving the
    // whole while.
    //
    // A STOP MUST BE STILL (owner 2026-09-04: "no way somebody ever hops from
    // a drive to a damn bike"). Splitting on every gap between automotive
    // segments trusted the classifier absolutely, and it should not be
    // trusted: his 3 September, 2:43 to 2:53pm, flipped automotive, cycling,
    // automotive six times while the phone moved 6,309 ft and then 6,469 ft
    // between the supposed stops, about 40 mph. He never got out of the truck,
    // and the day drew six one-minute drives and five stops.
    //
    // So a gap splits the drive only when the phone can be SHOWN to have
    // stayed put across it, the same corroboration _gdStayedPut already
    // demands of a departure. No evidence means no stop, which is the posture
    // of the rest of this file. Deliberately not a speed floor: a gap with one
    // fix or none has no speed to measure, and a four-minute crawl through a
    // lot at 3 mph is still a drive.
    const prevSeg = chain.drives[chain.drives.length - 1];
    const merge = prevSeg && !_gdStopProved(fixes, prevSeg[1], j.startTs, opts);
    if (merge) {
      // One drive all along. It absorbs the gap, so the row's minutes and the
      // span it prints stay the same number, and the stop it was going to be
      // is taken back off the count.
      chain.autoMs += j.endTs - prevSeg[1];
      prevSeg[1] = j.endTs;
      prevSeg[2] = prevSeg[1] - prevSeg[0];
      if (chain.stops > 0) chain.stops -= 1;
    } else {
      chain.autoMs += autoMs;
      chain.drives.push([j.startTs, j.endTs, autoMs]);
    }

    if (!toFence) {
      // Pending: a personal stop, or somewhere not saved. Held, not written.
      chain.stops += 1;
      continue;
    }

    // Resolved at a saved fence.
    const collapsed = chain.stops > 0;
    const sameSpot = _gdSameFence(chain.originFence, toFence);
    const tooShort = !collapsed && autoMs < opts.minLegMs;
    // RULE 7 AMENDED (owner 2026-09-04: "917 am job site mashed against the
    // shop with no drive between it, why?").
    //
    // Rule 7 exists so a round trip never fabricates a mileage row between two
    // endpoints that are the same fence. That is still exactly right, and
    // nothing below changes it. What was wrong was that it threw away the
    // DRIVING too. His 1 September: out of his dad's shop at 9:17, thirty-one
    // minutes and ten and a half miles of continuous breadcrumbs, an hour
    // parked out there on foot, twenty-six minutes back, shop again at 11:20.
    // Because both ends were the shop the whole leg was dropped, so the rail
    // drew one flat "unsaved job site" over two hours and three minutes with
    // two real drives buried inside it.
    //
    // A round trip THROUGH a stop now writes its drive time rows and leaves
    // the hole between them for the clock-remainder rule to name, the same
    // shape as any other unsaved stop. It writes NO mileage: the place he
    // actually went was never saved, and an unsaved address is never a mileage
    // endpoint ("we make no inferences here, this app was built to survive a
    // IRS audit"). A same-fence loop with NO stop in it is still nothing at
    // all, which is what rule 7 was written for.
    //
    // SCOPED TO A FENCE THAT IS NOT HIS HOUSE. Leaving work and coming back to
    // work is work, whatever was in the middle. Leaving the HOUSE and coming
    // back to the house with nothing saved between is Jack's 6:30 gym run, and
    // there is no evidence anywhere in the tape that says otherwise: rule 12
    // keeps the house off the clock and "we make no inferences here."
    const roundTrip = sameSpot && collapsed && !_gdIsHouse(chain.originFence, fences, opts.radiusFt);
    if ((!sameSpot || roundTrip) && !tooShort) {
      const a = chain.originFence, b = toFence;
      let miles, milesFrom;
      if (roundTrip) {
        miles = 0; milesFrom = 'none';
      } else if (collapsed) {
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
        collapsed, stops: chain.stops, roundTrip,
        // The driving segments, in order. One entry unless a stop split them.
        drives: chain.drives.slice(),
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
        name: arrived.fence.name || '', sinceTs: arrived.ts, journeyId: String(arrived.journeyId),
        // IS THIS THE HOUSE? (owner 2026-09-03: "I need it to go away or be
        // very small, right now it's wasted space running when I'm home and
        // done working.") The live screens want to say nothing at all once
        // somebody is home, and they cannot work that out for themselves: a
        // home office and a shop at the same address are two fences, and the
        // shop OUTRANKS the home office, so the dwell at his own house comes
        // back kind 'shop' and looks like the yard. _gdShopIsHome already
        // knows the difference and is the same test rule 11 uses to decide
        // that an evening at the house is not a shift.
        atHome: String(arrived.fence.kind) === 'home_office' ||
                _gdShopIsHome(arrived.fence, fences, opts.radiusFt) };
    }
  }

  // Rule 10: paperwork at the home office.
  const carved = _gdOffice(dwells, open, journeys, fixes, fences, inp.appEvents, dayStart, dayEnd, nowMs, opts);
  // Rule 12: the house is never on the clock.
  const housed = _gdHouseOffTheClock(carved);
  // Rule 11: the day ends with the last real work.
  const ended = _gdEndOfDay(housed, fences, opts, open, journeys.some(j => j && j.open), legs);
  // Rule 13: a visit the day cannot vouch for is a question, not a row.
  const asked = _gdHeldVisits(ended, inp, dayStart);

  return {
    day: inp.day || '',
    dwells: asked.filter(d => d.minutes >= 1),
    legs,
    open,
    // Diagnostic only, never a rule: which branch decided there is nobody on
    // site. Empty when `open` is set.
    openWhy: open ? '' : openWhy,
    // How many fences this derive was handed. A client whose coordinates
    // never made it into the fence list cannot be arrived at, and that is
    // indistinguishable from a day where nobody stopped anywhere.
    fenceCount: fences.length,
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

// Did he actually STOP between these two driving segments?
//
// Two ways to prove it, and both use a number this file already has rather
// than inventing a third:
//   - the gap is stillEndMs or longer, the same "a truck that sits this long
//     has parked" threshold the journey builder uses; or
//   - the last fix before it and the first fix after it are within radiusFt of
//     each other, which is what "the same place" means everywhere else here.
// Neither provable means it was one drive: this never invents a stop.
function _gdStopProved(fixes, gapStart, gapEnd, opts) {
  if (!(gapEnd > gapStart)) return false;
  // TOO SHORT TO BE A ROW IS TOO SHORT TO SPLIT A DRIVE (owner 2026-09-04:
  // "09/03 still show the back to back drives at 214 pm and 248, why werent
  // either saved?").
  //
  // Two rules disagreed about one 55-second gap. This one said "stop": the
  // fixes on both sides sat at the same coordinate, so the phone had stayed
  // put, so the drive split. geoDeriveRows then refused to write the stop,
  // because a gap under minLegMs is noise (the 14:47 artifact, fixed earlier
  // today). The result was the split with nothing in it: two drive rows back
  // to back, which is the exact shape he objected to in the first place.
  //
  // One threshold, both places. A gap that cannot become a row cannot break a
  // drive either.
  const legMin = (opts && Number(opts.minLegMs) > 0) ? Number(opts.minLegMs) : GEO_DERIVE_DEFAULTS.minLegMs;
  if (gapEnd - gapStart < legMin) return false;
  const still = (opts && Number(opts.stillEndMs) > 0) ? Number(opts.stillEndMs) : GEO_DERIVE_DEFAULTS.stillEndMs;
  if (gapEnd - gapStart >= still) return true;
  const r = (opts && Number(opts.radiusFt) > 0) ? Number(opts.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  const maxAcc = (opts && Number(opts.maxFixAccM) > 0) ? Number(opts.maxFixAccM) : GEO_DERIVE_DEFAULTS.maxFixAccM;
  const ok = f => f && f.lat != null && f.lng != null && typeof f.ts === 'number' &&
    (f.acc == null || Number(f.acc) <= maxAcc);
  let before = null, after = null;
  for (const f of (fixes || [])) {
    if (!ok(f)) continue;
    if (f.ts <= gapStart) { if (!before || f.ts > before.ts) before = f; }
    else if (f.ts >= gapEnd) { if (!after || f.ts < after.ts) after = f; }
  }
  if (before && after && _gdMiles(before, after) * 5280 <= r) return true;
  // THE FIXES INSIDE THE GAP ARE THE PROOF (owner 2026-09-04: "if we can prove
  // he stopped then we split it to a unsaved address").
  //
  // The test above asks where the phone was on either SIDE of the gap, which
  // is the only thing available when the gap itself is silent. His 3
  // September, 2:43 to 2:47pm, is the case where it is not: six fixes at one
  // identical coordinate from 2:44 to 2:49, 2,395 ft from his dad's shop.
  // Every one of them sits inside the gap or just past its end, so neither
  // bracket saw them, the last fix before was 2,437 ft away, and the day
  // merged a real stop into one 39-minute drive.
  //
  // Same scan and same threshold as the parked-truck split: a run of fixes
  // that never left one spot for parkedStillMs. The window is widened by that
  // much on each side so a run straddling the gap boundary is seen whole, and
  // the run still has to OVERLAP the gap to count, so a stop that belongs to
  // the drive before or after this one does not split this one.
  const parked = (opts && Number(opts.parkedStillMs) > 0) ? Number(opts.parkedStillMs) : GEO_DERIVE_DEFAULTS.parkedStillMs;
  const run = _gdStillRun(fixes, gapStart - parked, gapEnd + parked, parked, opts);
  return !!(run && run[0] < gapEnd && run[1] > gapStart);
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
    // Merge touching, overlapping, or barely-separated office spans.
    //
    // Barely-separated matters (owner 2026-09-04, on his 31 August rail: two
    // Office rows, 5:48 to 5:49 and 5:49 to 6:00). He backgrounded the app and
    // reopened it eleven seconds later, which is one sitting at the desk, not
    // two. A minute is the same floor the spans themselves are filtered on
    // just below, so nothing survives here that would not survive there.
    const GLUE = 60000;
    const merged = [];
    for (const sp of office) {
      const last = merged[merged.length - 1];
      if (last && sp[0] - last[1] <= GLUE) last[1] = Math.max(last[1], sp[1]); else merged.push(sp.slice());
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
// Somebody's own address: a home office, or a shop sharing its spot with one.
// Two rules already needed this exact test (rule 11's "a day with no work in
// it" and rule 7's round trip), so it is one function, not two spellings.
function _gdIsHouse(fence, fences, radiusFt) {
  if (!fence) return false;
  return String(fence.kind) === 'home_office' || _gdShopIsHome(fence, fences, radiusFt);
}
// Rule 12: THE HOUSE IS NEVER ON THE CLOCK (owner 2026-09-04, naming what a
// crew member's automatic day should hold: "all Jack should see automatic are
// straight drives from his home office to his dads shop and back, that's really
// it then also see time log dwells at his dads shop if he stops there").
//
// This is CLAUDE.md 9.11 finally enforced rather than a new rule. That section
// has said since 2026-08-30 that home office time counts only for the stretches
// the app was actually open, and recorded that it could not be built because
// nothing logged when the app was open. Rule 10 built that log. So the base
// dwell at a home office stops being a row, and the ONLY way the house ever
// contributes time is rule 10's Office carve: app open, outside the working day.
//
// Rule 11 had been carrying half of this by accident, and only half. It drops
// base dwells after the last work, and since 2026-09-03 on a day holding no work
// at all. Neither reaches the MIDDLE of a working day, which is where Jack's sat
// (2026-09-01): home 06:28 to 07:23 Central, then the drive to his dad's shop.
// Before the first work is not after the last, so it survived both branches and
// the rail drew nearly an hour at his own address as time on site.
//
// Only kind 'home_office' is cut, which is already exactly "the house, and not
// also the shop": the fence ranker hands a spot to the shop first, so a house
// that is also somebody's yard comes back kind 'shop' and keeps the owner's rule
// that shop time always counts (9.11), with rule 11 still trimming its evening.
function _gdHouseOffTheClock(dwells) {
  return (dwells || []).filter(d => d && String(d.kind) !== 'home_office');
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
function _gdEndOfDay(dwells, fences, opts, open, driving, legs) {
  const work = dwells.filter(d => !_gdIsBaseKind(d.kind) && d.kind !== 'office');
  // A day with no work anywhere in it. "A yard-only day is a shift" is right
  // for a YARD and wrong for a house, and the difference had never been drawn
  // here: the exemption returned every base dwell untouched, house included.
  //
  // It only shows up on an account whose days can contain no work at all.
  // Jack's do (2026-09-03): home, the gym, home. The gym has no fence, so that
  // journey writes nothing and he ends the day with zero client/job/supply
  // dwells. A shop that is not somebody's house keeps the exemption; a shop
  // sharing its spot with a home office does not, because a day spent entirely
  // at your own house with no work in it is not a shift. (The home office
  // itself never reaches here any more: rule 12 cuts it first, on every day.)
  if (!work.length) {
    // "No work" has to mean no work ANYWHERE, not merely no work DWELL. A day
    // can hold a real client visit that never becomes a dwell of its own,
    // because rule 9 drops the first and last stretch: drive from a client to
    // the house and back and the client is only ever an endpoint. Rule 10 is
    // explicit that inside the working day the house is a legitimate stop, so
    // dropping it there would be wrong.
    //
    // A leg touching a non-base fence is that proof. Jack's day has none:
    // home, the gym, home, and the gym has no fence, so the journey stays
    // pending and writes no leg at all.
    // The only place that does not count as work is somebody's own house. A
    // real shop does (owner rule: shop time always counts), so a day of shop,
    // house, shop is a working day and rule 10's "inside the working day the
    // house is a stop" applies to the middle of it.
    const notHome = f => !!f && !_gdIsHouse(f, fences, opts.radiusFt);
    const workLeg = (legs || []).some(l => l && (notHome(l.from) || notHome(l.to)));
    if (workLeg) return dwells;
    // Only a shop that is the house is left to cut: rule 12 already removed
    // every home_office dwell before this ran.
    return dwells.filter(d => !(String(d.kind) === 'shop' && _gdShopIsHome(d.fence, fences, opts.radiusFt)));
  }
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

// ── Rule 13: a client visit the day cannot vouch for is a question ────────
// Owner 2026-09-04: "He does work for me at my address. He does work for his
// mom and her address. They're all family members ... we wouldn't want time
// log showing her personal family visit." And, on the schedule-only version:
// "that's easy for us but not for contractors who forget to put shit on a
// calendar."
//
// A job's address is already a fence only on the days the job is active. A
// client's address was a fence every day of the year, so Sunday dinner at
// Mom's was "On site, 4h". Now a dwell at a client fence counts as work when
// any ONE of these vouches for it, in order:
//   1. something is scheduled there that day (the fence carries scheduled:true)
//   2. a manual clock is running over it (the clock is the bracket)
//   3. it falls inside working hours on a working day (default 6am to 8pm,
//      Monday to Saturday; per company, Settings)
// Anything else is HELD: it stays on the rail as a question, counts toward
// nothing, and the dashboard card asks. "Working" makes it a real row that
// survives every rebuild (fixed_at); "Personal" dismisses it, and that sticks
// too. Nobody has to keep a calendar for the ordinary case; the question only
// fires on the odd-hours visits, which are the family ones. What it still
// cannot know, and no competitor can either: a genuinely personal weekday
// afternoon at a client with nothing scheduled counts.
function _gdHeldVisits(dwells, inp, dayStart) {
  const clocks = (Array.isArray(inp.clocks) ? inp.clocks : [])
    .map(c => c && { a: Number(c.start), b: Number(c.end) })
    .filter(c => c && c.a > 0 && c.b > c.a);
  const wh = inp.workHours || {};
  const hm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m ? (Number(m[1]) * 60 + Number(m[2])) * 60000 : NaN; };
  let whA = hm(wh.start), whB = hm(wh.end);
  if (!Number.isFinite(whA)) whA = 6 * 3600000;
  if (!Number.isFinite(whB)) whB = 20 * 3600000;
  const days = Array.isArray(wh.days) ? wh.days.map(Number) : [1, 2, 3, 4, 5, 6];
  const dow = new Date(String(inp.day || '') + 'T12:00:00Z').getUTCDay();
  const workDay = Number.isFinite(dow) && days.indexOf(dow) >= 0;
  const overlaps = (d, a, b) => Math.min(d.endTs, b) - Math.max(d.startTs, a) >= 60000;
  return (dwells || []).map(d => {
    if (!d || d.kind !== 'client' || !d.fence || d.fence.scheduled === true) return d;
    if (clocks.some(c => overlaps(d, c.a, c.b))) return d;
    if (workDay && whB > whA && overlaps(d, dayStart + whA, dayStart + whB)) return d;
    return Object.assign({}, d, { held: true });
  });
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
      // No 'place-home' arm: rule 12 means a home_office dwell never reaches
      // here at all, so a branch for it would be a branch that cannot run.
      // js/timelog.js still READS 'place-home' on purpose, for the rows that
      // already carry it and for a hand-fixed one, which geo_replace_day
      // preserves across every re-derive.
      // 'client-held' is rule 13's question. The reader keeps it out of every
      // total and the dashboard asks; geo_replace_day carries the answer
      // (source, under fixed_at) across every rebuild after that.
      source: d.kind === 'office' ? 'place-office'
        : d.held ? 'client-held'
        : (f.jobId != null ? 'geofence' : (f.clientId != null ? 'client' : 'place')),
    }));
  }
  for (const l of (result && result.legs) || []) {
    // ONE ROW PER DRIVE, NOT ONE PER CHAIN (owner 2026-09-04: "right, in
    // between it logs the time as a unsaved job site").
    //
    // A leg through unsaved stops used to write a single row spanning the lot
    // of it. His 1 September: shop at 12:04, four customers, home at 3:18, and
    // the rail drew one 58-minute drive across three hours and eleven minutes
    // with 139 minutes of standing at customers buried inside it. The tape had
    // flipped onFoot, walking, running or still at every one of those four
    // stops; nothing was missing from the evidence, the row was just the wrong
    // shape.
    //
    // Now each driving segment is its own row and the holes between them are
    // left alone, which is exactly what the clock-remainder rule in
    // js/timelog.js is for: uncovered time inside a running clock comes back
    // as "Unsaved job site". So the naming needed no new code, only room to
    // work in.
    //
    // THE MILES DO NOT SPLIT. There is still one mileage row per leg, at the
    // direct route between two SAVED fences (rule 6, and his rule that an
    // unsaved address is never a mileage endpoint: "we make no inferences
    // here, this app was built to survive a IRS audit"). Time and mileage stop
    // being the same row, which is the whole change.
    const segsRaw = (Array.isArray(l.drives) && l.drives.length) ? l.drives
      : [[l.startTs, l.endTs, (l.minutes || 0) * 60000]];
    // A MINUTE IS NOT A DRIVE EITHER. The same floor that refuses to write a
    // one-minute stop refuses to write a one-minute drive BETWEEN two stops:
    // his 2 September, 8:17 to 8:18am, with the phone at one coordinate from
    // 8:03 to 12:32 either side of it, and his 3 September at 10:05. Those are
    // CoreMotion twitching at a parked truck, and drawing them splits one
    // unsaved address into two with a drive wedged in the middle.
    //
    // Interior segments only. The first and last segments of a leg are its
    // departure and its arrival: however short, they are the only thing that
    // says he left the shop or reached it, and dropping one loses the trip.
    const segs = segsRaw.filter((sg, i) => i === 0 || i === segsRaw.length - 1 ||
      (Number(sg[1]) - Number(sg[0])) >= GEO_DERIVE_DEFAULTS.minLegMs);
    segs.forEach((sg, i) => {
      const a = Number(sg[0]), b = Number(sg[1]);
      if (!(a > 0 && b > a)) return;
      time.push({ contractor_user_id: cid, employee_user_id: uid, job_id: null,
        arrived_at: iso(a), departed_at: iso(b),
        minutes: Math.max(1, Math.round(Number(sg[2] || (b - a)) / 60000)),
        // Only the LAST segment actually reaches the destination; the ones
        // before it end at a stop nobody saved, and naming them for where he
        // eventually ended up would be the inference this rule exists to
        // avoid.
        dest_place: (i === segs.length - 1) ? (l.to.name || null) : null,
        client_key: segs.length > 1 ? (l.id + ':' + i) : l.id, source: 'drive' });
    });
    // EVERY STOP IS A ROW (owner 2026-09-04): "we should be logging every flip
    // to onsite unsaved address and every drive with times in between."
    //
    // The gap between two driving segments is a place he got out of the truck
    // that nobody saved. It used to be written by nothing at all, and only
    // appeared on the rail because the clock-remainder rule in js/timelog.js
    // happened to find a hole inside a running manual clock. That made a stop
    // visible only when somebody had clocked in, and invisible on a day the
    // fences alone described. The deriver already knows exactly where these
    // are, so it writes them, and the reader is back to reading.
    //
    // No name and no address, deliberately: an unsaved stop is never given
    // one. What it carries is that it happened, when, and for how long, which
    // is what a stop count and a windshield-time number are made of.
    // A MINUTE IS NOT A STOP (owner 2026-09-04, on his 3 September rail).
    // The floor was 60s and it let one artifact through: 14:47 to 14:48, a
    // single fix, zero feet of movement, and its two bracketing fixes at the
    // identical coordinate. It is the tail of the automotive/cycling
    // flip-flop, where one gap happened to have both ends in the same spot,
    // so "a stop must be still" said stop. A one-minute stop proved by a
    // single fix is noise.
    //
    // minLegMs, not a new number: it is already this file's "too short to be
    // a thing" threshold for a leg, and it means the same here. The default
    // rather than opts.minLegMs because geoDeriveRows is a pure shaper and
    // takes no options; nothing overrides it today.
    const stopMin = GEO_DERIVE_DEFAULTS.minLegMs;
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = Number(segs[i][1]), b = Number(segs[i + 1][0]);
      if (!(a > 0 && b - a >= stopMin)) continue;
      time.push({ contractor_user_id: cid, employee_user_id: uid, job_id: null,
        arrived_at: iso(a), departed_at: iso(b),
        minutes: Math.round((b - a) / 60000),
        dest_place: null, client_key: l.id + ':s' + i, source: 'unsaved' });
    }
    // A round trip writes time but never mileage (rule 7 as amended): both of
    // its endpoints are the same fence, and the place between them was never
    // saved.
    if (l.roundTrip) continue;
    miles.push(Object.assign({
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
    }, l.to.kind === 'supply' ? {
      // THE RECEIPT IS THE PROOF, NOT THE DESTINATION (owner design
      // 2026-08-17, and owner 2026-09-05: "the receipt thing didn't stay
      // alive from my Home Depot run"). A leg that ends at a supply place is
      // HELD until the dashboard card gets its answer: scan the receipt, no
      // receipt, or personal. The engine used to set this; the one-writer
      // rewrite (2959bb3) deleted the engine and nothing set it again, so his
      // 28 August Home Depot leg landed as a plain Supply run and the card
      // never showed. The key is what the card groups visits by.
      pendingReceipt: true, supplyRunKey: String(result.day || '') + '|' + (l.to.name || 'Store'),
    } : {}));
  }
  return { job_time_entries: time, shop_time_entries: shop, td_mileage: miles };
}
