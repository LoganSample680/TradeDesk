// GENERATED FILE. DO NOT EDIT.
//
// Built from js/geo-derive.js by scripts/gen-shared-deriver.mjs. That file is
// the one deriver (CLAUDE.md 17); this is the same bytes with an export line,
// so the phone and the server can never be running different rules. Change the
// rules there, run the generator, commit both.
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
//  14. A DRIVE WITH AN UNSAVED END IS STILL A DRIVE (owner 2026-09-08:
//      "only things with addresses saved should update any totals, if a
//      address gets added it can add the mileage back on the deriver").
//      Rules 5, 7 and 8 used to write NOTHING for a journey that started or
//      ended somewhere unsaved, so the drive vanished from every screen and
//      the day showed a hole where it had been. Now such a journey writes a
//      TRACED leg: the phone's own breadcrumb miles, never a routed number
//      (a route needs two addresses), flagged addressUnknown so it is on no
//      total anywhere, with the unsaved end named as exactly that. Saving the
//      address makes it a fence; the next derive of that day finds the fence,
//      writes the real leg under the SAME journey id, and the traced row is
//      replaced. Nothing is inferred and nothing is claimed: the drive is
//      shown, the deduction waits for the address.
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
  // The same coordinate, to the digit, this close together is one reading
  // that reached the log through two doors (a location_pings row and a
  // geo_events fix, 1 ms apart), not two readings that agree.
  sameReadingMs: 5000,
});

// Fence precedence when more than one contains the fix. His shop and his home
// office are four metres apart; nearest-wins made that a coin toss between two
// payroll rules. Lower number wins; ties fall to the nearer fence.
const GEO_FENCE_RANK = Object.freeze({
  job: 0, shop: 1, home_office: 2, client: 3, supply: 4, business_meeting: 4, other: 5,
});

// ── ONE RADIUS, EVERY KIND (owner 2026-09-16) ────────────────────────────
// "Go switch the fence back to 600 feet. The problem was never the fence
// being 600 feet, it was the fact that we only grabbed the address for Jack
// on one iOS ping rather than the address and coordinates on the cluster."
//
// This briefly shrank a client and a home office to 0.4 of the account
// radius, to stop a customer down the street claiming the stop. That was
// treating the symptom. The stop was named from ONE arrival ping, taken
// while the truck was still rolling in, and a single ping can land next
// door however wide the circle is. Rule 22 (_gdReseatDwells) is the real
// answer: the stop is named from the median of every fix taken while he
// sat there, which is the cluster and not a ping.
//
// So the circle is the account's radius again, for every kind, and a
// narrowed radius never gets to hide the fact that the deriver is reading
// the wrong point. A fence carrying its own radiusFt still wins outright:
// that is a number a person typed about a specific place.
function _gdFenceLimitFt(f, radiusFt) {
  if (f && Number(f.radiusFt) > 0) return Number(f.radiusFt);
  return Number(radiusFt) > 0 ? Number(radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
}

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
    const lim = _gdFenceLimitFt(f, r);
    const ft = _gdMiles(pt, f) * 5280;
    if (ft > lim) continue;
    const rank = GEO_FENCE_RANK[String(f.kind || 'other')];
    const rk = rank == null ? GEO_FENCE_RANK.other : rank;
    if (rk < bestRank || (rk === bestRank && ft < bestFt)) { best = f; bestRank = rk; bestFt = ft; }
  }
  return best;
}

// ── RULE 15: A CLOSED FENCE CROSSING SAYS WHERE THE PHONE WAS ─────────────
// Owner 2026-09-15: "I just want the stale cache fixed from his phone to
// close out the day right."
//
// A fix SAMPLES a position; region monitoring watches the BOUNDARY, in the
// kernel, and fires on the edge whether or not this app has runtime. That is
// the one observer a suspended phone cannot degrade, and it is what answers
// Jack's 4:01pm: the app was suspended from 4:01 to 4:36, so the only four
// fixes in the dwell are one cached coordinate restated verbatim 1,279 ft
// from his own yard, while the yard's crossing pair sat right across it.
//
// This is the SECOND attempt. The first shipped and was reverted the same
// evening because it got two things wrong, and both are fixed here by
// construction rather than by conditions bolted on:
//
// 1. IT NAMED THE FENCE FROM THE CROSSING'S ID, and one building answers to
//    several. Jack's yard fired all three of these on one morning:
//      07:43:00  regionEnter  place-1788216906515011
//      07:43:00  regionEnter  shop
//      07:43:14  regionEnter  place:1788216906515011
//    The settings shop, a td_places row at the identical coordinate, and a
//    third id with a colon where the others have a hyphen. Keying on the id
//    renamed every drive of his day off "JS Solutions shop" onto "1200 SW
//    Oakley Ave". So the id is used ONLY to find where the crossing happened;
//    the fence is then named by geoFenceAt at that position, exactly as a fix
//    would be. Three ids for one place give one answer, and the file keeps
//    one definition of which circle wins.
//
// 2. IT TRUSTED AN ENTER WITH NO EXIT, and ran it to now. Jack's 'shop'
//    crossing entered at 07:43 and never exited, so that span swallowed the
//    whole day and put his 10:10 stop, three miles east, at the yard. An
//    unpaired enter is not a span: the app may have been dead when the exit
//    fired, the fence may have been unregistered mid-day, the id may be one
//    of the duplicates above. Only a CLOSED pair is evidence, which on his
//    real day leaves exactly the three that are true (07:43-07:59,
//    09:37-09:56, 15:58-16:36) and drops exactly the two that are not.
//
// Overlapping spans rank the way geoFenceAt ranks overlapping circles, so one
// precedence governs the file; on a tie the span that STARTED later wins,
// because entering B while still inside A is standing in B.
// ── RULE 21: THE CROSSING KNOWS WHEN HE ARRIVED (owner 2026-09-15) ────────
// "I shouldn't be babysitting his day and telling you what happened."
//
// His 15 September: the phone crossed his mother's fence at 07:59:25 and
// CoreMotion did not drop out of automotive until 08:30:53, thirty-one minutes
// later, because the app was terminated at 08:01 and nothing sampled a fix in
// between. A journey ends on that flip, so a five-minute drive was written as
// thirty-six and her house did not start until 08:30. Every minute of it was
// on the wrong row.
//
// The OS was watching the fence the whole time and said so. When a CLOSED
// crossing pair opens inside a journey and is still open when the tape finally
// flips, he was already there: the journey ends at the crossing. It is the
// same evidence rule 15 already trusts for WHERE, used for WHEN, and it is
// only ever allowed to make a drive SHORTER, never to invent one.
//
// A drive that passes THROUGH a fence is untouched, because its crossing
// closes before the journey does.
function _gdRegionSpanList(regions, fences, radiusFt) {
  const byId = new Map();
  (Array.isArray(fences) ? fences : []).forEach(f => { if (f && f.id != null) byId.set(String(f.id), f); });
  const rows = (Array.isArray(regions) ? regions : [])
    .filter(r => r && typeof r.ts === 'number' && r.id != null && byId.has(String(r.id)))
    .sort((a, b) => a.ts - b.ts);
  const open = new Map(), spans = [];
  for (const r of rows) {
    const id = String(r.id);
    if (r.enter) { if (!open.has(id)) open.set(id, r.ts); continue; }
    const from = open.get(id);
    if (from == null) continue;
    open.delete(id);
    const at = byId.get(id);
    // The crossing says WHERE, geoFenceAt says WHICH. See 1 above.
    const f = geoFenceAt(at, fences, radiusFt);
    if (f && r.ts > from) spans.push({ from, to: r.ts, f });
  }
  // Whatever is left in `open` never closed, and is dropped. See 2 above.
  return spans;
}
function _gdRegionSpans(regions, fences, radiusFt) {
  const spans = _gdRegionSpanList(regions, fences, radiusFt);
  if (!spans.length) return () => null;
  return (ts) => {
    if (typeof ts !== 'number') return null;
    let best = null, bestRank = Infinity, bestFrom = -Infinity;
    for (const s of spans) {
      if (ts < s.from || ts > s.to) continue;
      const rank = GEO_FENCE_RANK[String(s.f.kind || 'other')];
      const rk = rank == null ? GEO_FENCE_RANK.other : rank;
      if (rk < bestRank || (rk === bestRank && s.from > bestFrom)) { best = s.f; bestRank = rk; bestFrom = s.from; }
    }
    return best;
  };
}

// ── THE ARRIVAL THAT ENDS THE DAY (owner 2026-09-16) ─────────────────────
// "Why am I as Logan Sample missing my last drive for the day still."
//
// Because the whole write was being thrown away, and had been all evening:
//
//   error_log  01:13:01Z, app 09.15.26.17
//   "geo derive refused: geo_replace_day: 1 overlapping pair(s) in the
//    derived set"
//
// geo_replace_day refuses a SET with any overlap in it and discards all of
// it, which is right (17: one writer, one transaction, no half-written day).
// The overlap was his last drive against the dwell it arrived at:
//
//   drive   17:41:19 - 17:54:39      the tape stayed automotive
//   office  17:50:14 - 17:53:29      the crossing said he was home
//
// The crossing at 17:50:14 is exactly what rule 21 exists to read, and rule
// 21 never saw it, because _gdRegionSpanList drops an enter that never
// exited and he never left again: it was the last arrival of the day. So the
// one crossing that most needs to end a drive is precisely the one shape the
// span list throws away.
//
// The reason it throws it away is sound and is NOT weakened here: an unpaired
// enter cannot be a SPAN, because a span says WHERE somebody was for its
// whole length, and Jack's 07:43 'shop' enter never exited and swallowed his
// entire day. That stays exactly as it was.
//
// But rule 21 does not want a span. It wants an INSTANT: the moment the
// kernel saw the boundary crossed inward, which it reports on the edge
// whether or not this app has runtime, and which is the same whether an exit
// ever follows. So the instant is admitted on its own, with one condition
// that a span could never give: A FIX AFTER IT, STILL INSIDE THE FENCE. That
// is what separates arriving from driving past with a lost exit, and it is
// the same "proven by fixes inside the fence" standard rule 10 already uses.
//
// Rule 21 can still only ever make a drive SHORTER, never invent one.
function _gdOpenArrivals(regions, fences, radiusFt, fixes) {
  const byId = new Map();
  (Array.isArray(fences) ? fences : []).forEach(f => { if (f && f.id != null) byId.set(String(f.id), f); });
  const rows = (Array.isArray(regions) ? regions : [])
    .filter(r => r && typeof r.ts === 'number' && r.id != null && byId.has(String(r.id)))
    .sort((a, b) => a.ts - b.ts);
  // Last enter wins for an id, and any exit clears it: what is left is an
  // arrival nobody ever left.
  const open = new Map();
  for (const r of rows) {
    const id = String(r.id);
    if (r.enter) { if (!open.has(id)) open.set(id, r.ts); continue; }
    open.delete(id);
  }
  const out = [];
  for (const [id, ts] of open) {
    // The crossing says WHERE, geoFenceAt says WHICH: same as the span list,
    // so one building answering to three ids still gives one answer.
    const f = geoFenceAt(byId.get(id), fences, radiusFt);
    if (!f) continue;
    // HE WAS STILL THERE AFTERWARDS, and a fix has to say so. Without this a
    // lost exit on a fence he merely drove past would end the drive at the
    // roadside.
    const proven = (Array.isArray(fixes) ? fixes : []).some(fx => fx && fx.ts > ts &&
      fx.lat != null && fx.lng != null && _gdSameFence(geoFenceAt(fx, fences, radiusFt), f));
    if (proven) out.push({ from: ts, to: Infinity, f, unpaired: true });
  }
  return out;
}

// Rule 21, applied to the journey list before anything reads it, so the leg
// and the dwell after it move together: one boundary, not two.
function _gdArrivalTrim(journeys, spans) {
  if (!Array.isArray(journeys) || !Array.isArray(spans) || !spans.length) return journeys;
  return journeys.map((j) => {
    if (!j || typeof j.endTs !== 'number' || typeof j.startTs !== 'number') return j;
    let arrival = null, fence = null;
    for (const s of spans) {
      // Entered after this drive began, before the tape said it ended, and
      // still inside at that moment: he was parked in there the whole time.
      if (!(s.from > j.startTs && s.from < j.endTs && s.to >= j.endTs)) continue;
      if (arrival == null || s.from < arrival) { arrival = s.from; fence = s.f; }
    }
    // ── AND THE CROSSING NAMES THE PLACE, NOT JUST THE MOMENT ────────────
    // The OS region is WIDER than the app's own fence circle, so the instant
    // the boundary fires he is not yet "inside" by this file's radius: on his
    // 15 September the crossing fired 0.4 miles out, and trimming the drive
    // there left the arrival to be named by a fix still on the road. The leg
    // came back "Destination not saved" and the dwell never opened at all,
    // which is a different wrong answer from the one this rule fixed.
    //
    // It is the same evidence either way. Rule 15 already trusts the crossing
    // for WHERE and rule 21 trusts it for WHEN; asking the fixes to re-answer
    // WHERE at a moment the crossing itself chose is asking the weaker witness
    // a question the stronger one already answered.
    return arrival == null ? j
      : Object.assign({}, j, { endTs: arrival }, fence ? { endFence: fence } : {});
  });
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
// ── WHERE THE TRUCK ACTUALLY SAT (owner 2026-09-12) ────────────────────────
// His 11 September evening, an unsaved stop offered for saving as "3600 SW
// Lincolnshire". He was at 6812 SW Finsbury, 0.84 miles away.
//
// Across the whole 2h43m he was parked, the phone logged four fixes:
//   19:03:33  39.00232,-95.76751     4,415 ft from where he parked
//   19:06:04  39.00232,-95.76751     identical, to five decimals
//   19:06:45  39.01050,-95.77900        27 ft from where he parked
//   19:08:35  39.01050,-95.77900     identical
// He went still at 18:05 at 39.01046,-95.77908 and drove off at 20:48 from
// 39.01396,-95.78085. Both agree with the SECOND pair. The first pair is one
// cached reading replayed twice and contradicted forty seconds later.
//
// _gdSettledFixAfter already refuses two shapes of stale reading: a fix
// repeating the one immediately before it, and a fix repeating any reading
// taken on the drive that just ended. This pair defeats both. Its predecessor
// is a road fix from 18:05, and the coordinate itself never appears on that
// drive, so it is simply the first eligible candidate and it wins.
//
// THE REAL PROBLEM IS THAT ONE FIX WAS ANSWERING TWO QUESTIONS. Which fence
// the stop is in has to be decided near the ARRIVAL, and _gdSettledFixAfter is
// right for that, timing and all. Where the truck sat, which is what the Save
// button on an unsaved stop writes into a new client record, is a question
// about the whole dwell, and the first reading in it is no more authoritative
// than any other.
//
// So this asks the dwell as a whole and takes the position its fixes AGREE on,
// which is the same posture as _gdStopProved ("no evidence means no stop") one
// question over. On a tie the LATER group wins, because a stale cache is by
// definition a replay of an older reading: the live one cannot be the one that
// was already on file. Fence resolution is untouched.
function _gdStopFix(fixes, fromTs, toTs, maxAccM, fallback) {
  const groups = new Map();
  (fixes || []).forEach((f) => {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') return;
    if (f.acc != null && Number(f.acc) > maxAccM) return;
    if (f.ts < fromTs || f.ts > toTs) return;
    const k = f.lat + ',' + f.lng;
    const g = groups.get(k);
    if (!g) groups.set(k, { n: 1, last: f });
    else { g.n += 1; if (f.ts > g.last.ts) g.last = f; }
  });
  let best = null;
  groups.forEach((g) => {
    if (!best || g.n > best.n || (g.n === best.n && g.last.ts > best.last.ts)) best = g;
  });
  // ── NOTHING REPEATED, SO ASK THE CLUSTER (owner 2026-09-16) ─────────────
  // "Then when you save it calls and says alright app, what was the tightest
  // cluster on gps pings and what address does this belong to."
  //
  // That is what this was reaching for and only half doing. The grouping above
  // counts EXACT repeats, which is the right test when iOS restates one cached
  // coordinate verbatim, and it was written against a real incident where it
  // did. But a truck parked with a live radio produces readings that agree
  // within five feet and repeat none of them: every group is n=1, and the
  // winner is then just the LAST fix of the dwell, which is the one taken as
  // he rolled back out. Jack's 15 September stop is exactly that shape: 297,
  // 296, 295, 295, 300, then 250.
  //
  // So when nothing repeats, take the fix nearest the MEDIAN of the stop,
  // which is rule 22's own answer to the same question one field over
  // (_gdSpotOf). Same posture, same function, one meaning of "where the truck
  // sat". A repeat still beats it, because a coordinate the phone stated
  // twice is evidence the median is not.
  if (best && best.n === 1) {
    const spot = _gdSpotOf(fixes, fromTs, toTs, maxAccM);
    if (spot) {
      let near = null, nearFt = Infinity;
      (fixes || []).forEach((f) => {
        if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') return;
        if (f.acc != null && Number(f.acc) > maxAccM) return;
        if (f.ts < fromTs || f.ts > toTs) return;
        const ft = _gdMiles(f, spot) * 5280;
        if (ft < nearFt) { near = f; nearFt = ft; }
      });
      if (near) return near;
    }
  }
  return best ? best.last : fallback;
}

function _gdSettledFixAfter(fixes, ts, notAfterTs, maxAgeMs, maxAccM, sinceTs) {
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
  //
  // AND A REPEAT OF THE ROAD IS THE ROAD (owner 2026-09-09, 13:06:55). The
  // restated position is not always the row immediately before: he parked at
  // John Doe at 13:05, a fresh ping at 13:03:05 sat between, and the cache the
  // phone then restated was the 13:02:02 road fix, 0.8 mi out. With `sinceTs`
  // (the start of the journey that just ended) a candidate repeating ANY
  // reading taken on that drive is skipped for the same reason: the truck
  // cannot have come to rest on a coordinate it was passing through, and a
  // reading that says it did is the cache talking. Today it resolved to the
  // client only because a stale fence row happened to sit in the right slot.
  const ordered = (fixes || []).filter(f => f && f.lat != null && f.lng != null &&
    typeof f.ts === 'number' && (f.acc == null || Number(f.acc) <= maxAccM))
    .sort((a, b) => a.ts - b.ts);
  const road = _gdRoadReadings(ordered, sinceTs, ts);
  let best = null, fallback = null;
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    if (f.ts < ts || f.ts > notAfterTs || f.ts - ts > maxAgeMs) continue;
    if (!fallback) fallback = f;
    const prev = ordered[i - 1];
    if (prev && prev.lat === f.lat && prev.lng === f.lng) continue;
    if (road.has(f.lat + ',' + f.lng)) continue;
    if (!best || f.ts < best.ts) best = f;
  }
  return best || fallback;
}
// The coordinates read while the truck was moving, sinceTs up to but not
// including ts: the set a cached restatement after the stop is drawn from. A
// reading AT the end is where it stopped, not the road (a drive split at a
// parked spot ends on that spot's first fix). Empty when no sinceTs is given,
// which leaves the immediately-before rule on its own.
function _gdRoadReadings(ordered, sinceTs, ts) {
  const road = new Set();
  if (typeof sinceTs !== 'number' || !(sinceTs < ts)) return road;
  for (const f of ordered) { if (f.ts >= sinceTs && f.ts < ts) road.add(f.lat + ',' + f.lng); }
  return road;
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
 * input.crew     true when this person is CREW on somebody else's account,
 *                false/absent for the business owner deriving their own day.
 *                Rule 20 is the only thing that reads it, and it is the whole
 *                of that rule's gate (owner 2026-09-16).
 * input.nowMs     for the open tail; defaults to Date.now()
 * input.directMiles(a,b) optional sync resolver for a collapsed leg; default
 *                 straight line, and the leg says which it got.
 * input.regions   [{ts, id, enter}] the OS's own fence crossings, for rule 15
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

  // Rule 15 and rule 21 read the same crossings: one says which fence an
  // instant belongs to, the other says when a drive into it actually ended.
  const regionSpans = _gdRegionSpanList(inp.regions, fences, opts.radiusFt);
  // Rule 21 reads the closed pairs AND the unpaired arrivals; rule 15 reads
  // only the closed pairs, which is the distinction _gdOpenArrivals exists to
  // draw. Never the other way round.
  const journeys = _gdArrivalTrim(
    _gdJourneys(inp.tape, inp.personId, opts, dayStart, dayEnd, nowMs, fixes),
    regionSpans.concat(_gdOpenArrivals(inp.regions, fences, opts.radiusFt, fixes)));
  const dwells = [], legs = [];
  const at = ts => _gdFixNear(fixes, ts, opts.fixWindowMs, opts.maxFixAccM);
  const fenceOf = fix => fix ? geoFenceAt(fix, fences, opts.radiusFt) : null;
  // Rule 15 (above): where a CLOSED crossing pair covers the instant, the
  // boundary the OS watched beats the position this app happened to sample.
  // Where none does, nothing changes: fenceAt IS fenceOf.
  const inside = _gdRegionSpans(inp.regions, fences, opts.radiusFt);   // same crossings, read for WHERE
  const fenceAt = (fix, ts) => inside(ts) || fenceOf(fix);
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
    const depFence = fenceAt(startFix, j.startTs);
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
      if (!chain && fromFence) chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0, via: [], drives: [], openSince: j.startTs };
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
    const endFix = _gdSettledFixAfter(fixes, j.endTs, nextStart, opts.parkedFixMaxMs, opts.maxFixAccM, j.startTs) || at(j.endTs);
    // Rule 21's arrival, when it trimmed this journey: the crossing named the
    // place and this file does not second-guess it (see _gdArrivalTrim).
    const toFence = j.endFence || fenceAt(endFix, j.endTs);
    const autoMs = j.endTs - j.startTs;

    if (!chain) {
      if (!fromFence) {
        // Unknown origin: nothing to ROUTE from, but the phone still watched
        // the road. Rule 14: a traced leg, breadcrumb miles, off every total,
        // with the unsaved end saying so. If it ended somewhere saved, a
        // dwell opens there as before.
        if (startFix && endFix && autoMs >= opts.minLegMs) {
          const a = _gdUnsavedEnd(startFix), b = toFence || _gdUnsavedEnd(endFix);
          const p = _gdPathMiles(fixes, j.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix], opts.maxMph);
          const miles = p > 0 ? p : _gdMiles(a, b);
          if (miles > 0) {
            legs.push({
              id: j.id, from: a, to: b, startTs: j.startTs, endTs: j.endTs,
              minutes: Math.round(autoMs / 60000),
              miles: Math.round(miles * 10) / 10, milesFrom: p > 0 ? 'path' : 'straight',
              collapsed: false, stops: 0, roundTrip: false,
              traced: true, unsavedFrom: true, unsavedTo: !toFence,
              drives: [[j.startTs, j.endTs, autoMs, j.id, j.id]],
              path: _gdPath(fixes, j.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix], opts.pathMax, opts.maxMph),
            });
          }
        }
        if (toFence) arrived = { fence: toFence, ts: j.endTs, journeyId: j.id, startTs: j.startTs };
        continue;
      }
      chain = { id: j.id, originFence: fromFence, startTs: j.startTs, autoMs: 0, stops: 0, via: [], drives: [] };
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
      prevSeg[4] = j.id;
      if (chain.stops > 0) { chain.stops -= 1; if (chain.via) chain.via.pop(); }
    } else {
      chain.autoMs += autoMs;
      chain.drives.push([j.startTs, j.endTs, autoMs, j.id, j.id]);
    }

    if (!toFence) {
      // Pending: a personal stop, or somewhere not saved. Held, not written.
      // WHERE THE STOP WAS is kept (owner 2026-09-09, on Jack's Wednesday: a
      // shop-to-shop row through a place he never saved). The row's two ends
      // are both the shop, so the Save button on it had only the shop to
      // offer, and saving the address would have opened a lead at his own
      // yard. The settled fix at each held stop rides along as `via`, so the
      // row can say where the truck actually went and the lead form opens
      // there.
      chain.stops += 1;
      // NOT endFix. That one is chosen for the ARRIVAL, to decide which fence
      // the stop is in, and the first reading of a dwell is no authority on
      // where the truck sat (owner 2026-09-12, 3600 SW Lincolnshire). This is
      // the position the whole dwell agrees on, and it is what the Save button
      // writes into a new client record.
      const stopFix = _gdStopFix(fixes, j.endTs, nextStart, opts.maxFixAccM, endFix);
      if (stopFix) (chain.via = chain.via || []).push({ lat: Number(stopFix.lat), lng: Number(stopFix.lng), ts: j.endTs, key: 'd-' + j.id });
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
    // RULE 17 amends this: a house loop is suppressed BY THE WINDOW, not here.
    // Rule 7 refuses a same-spot round trip out of the house because that is
    // the gym run, and that is still right for a day nobody was working. But
    // "leaving the house and coming back with nothing saved between" is also
    // what a real job at an address nobody has saved looks like, and this
    // decided it before anything knew whether the workday was open. It is
    // marked now and judged later (_gdDayWindow), so a clocked loop survives
    // and an unclocked one still does not. A house loop can never OPEN the
    // window (it touches no business fence), so there is no circularity.
    const houseLoop = sameSpot && collapsed && !roundTrip;
    if ((!sameSpot || roundTrip || houseLoop) && !tooShort) {
      const a = chain.originFence, b = toFence;
      let miles, milesFrom;
      // A house loop is a round trip in every respect but where it started, so
      // it earns the same treatment: breadcrumb miles, never a routed number,
      // and traced so no total can claim it until the stop is saved.
      const loop = roundTrip || houseLoop;
      if (loop) {
        // Rule 14: the place he actually went was never saved, so there is
        // still no routed number; the breadcrumbs are shown and claimed by
        // nobody. Saving that stop turns this into two real legs.
        const p = _gdPathMiles(fixes, chain.startTs, j.endTs, opts.maxFixAccM, [startFix, endFix], opts.maxMph);
        miles = p > 0 ? p : 0; milesFrom = p > 0 ? 'path' : 'none';
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
        collapsed, stops: chain.stops, roundTrip, houseLoop,
        // Rule 14: a round trip through an unsaved stop is a traced row,
        // never a claimed one.
        traced: loop && miles > 0, unsavedVia: loop,
        // The held stops, in order, where the truck sat: what a via row's
        // Save button saves.
        via: (chain.via || []).slice(),
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
    arrived = { fence: toFence, ts: j.endTs, journeyId: j.id, startTs: j.startTs };
  }

  // Rule 14, the day-end case (rule 8 as amended): a chain that reached its
  // last CLOSED journey without ever arriving anywhere saved. Nothing was
  // written and the drive vanished. Now it is a traced leg from the saved
  // origin to wherever the truck last came to rest, breadcrumb miles, off
  // every total, the far end named as unsaved. A chain whose last journey is
  // still OPEN (openSince set) is still driving and stays pending exactly as
  // before; the live screens read `pending` for that.
  if (chain && !chain.openSince && Array.isArray(chain.drives) && chain.drives.length && chain.autoMs >= opts.minLegMs) {
    const lastEnd = Number(chain.drives[chain.drives.length - 1][1]);
    const restFix = _gdSettledFixAfter(fixes, lastEnd, Infinity, opts.parkedFixMaxMs, opts.maxFixAccM, Number(chain.drives[chain.drives.length - 1][0])) || at(lastEnd);
    if (restFix) {
      const a = chain.originFence, b = _gdUnsavedEnd(restFix);
      const p = _gdPathMiles(fixes, chain.startTs, lastEnd, opts.maxFixAccM, [null, restFix], opts.maxMph);
      const miles = p > 0 ? p : _gdMiles(a, b);
      if (miles > 0) {
        legs.push({
          id: chain.id, from: a, to: b, startTs: chain.startTs, endTs: lastEnd,
          minutes: Math.round(chain.autoMs / 60000),
          miles: Math.round(miles * 10) / 10, milesFrom: p > 0 ? 'path' : 'straight',
          collapsed: chain.stops > 0, stops: chain.stops, roundTrip: false,
          traced: true, unsavedFrom: false, unsavedTo: true,
          drives: chain.drives.slice(),
          path: _gdPath(fixes, chain.startTs, lastEnd, opts.maxFixAccM, [null, restFix], opts.pathMax, opts.maxMph),
        });
      }
    }
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
    const rows = fixes.filter(f => f.ts > arrived.ts && f.ts < dayEnd && (f.acc == null || Number(f.acc) <= opts.maxFixAccM)).sort((a, b) => a.ts - b.ts);
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
    // ONE READING, HOWEVER MANY ROWS (owner 2026-09-09, 13:06:55). The phone
    // restated its cached position after he had parked at John Doe: the same
    // sixteen digits as the 13:02:02 road fix, 0.8 mi from the client, and it
    // reached the server twice, 1 ms apart (a location_pings row and a
    // geo_events fix from the same reading). The second row was taken as the
    // "next fix also outside" that corroborates a departure, so the visit
    // closed at its own arrival instant: no dwell, no open tail, no on-site
    // card, the working day ended at 12:03, the 12:23 app-open became an
    // Office row, and the house dwell after it was dropped as after-hours.
    // That double write happens hundreds of times a day; it only bites when
    // the reading it doubles is a stale one outside the fence.
    //
    // Same idiom as _gdSettledFixAfter and _gdCleanTrace, both halves of it:
    // a row repeating the coordinate of the row before it, within
    // sameReadingMs, is the same reading, not a witness (minutes apart it is
    // still two rows: a parked truck is allowed to sit still, and the run
    // keeps its LAST timestamp so an inside reading moves `end` exactly as it
    // did); and a row repeating a coordinate read on the drive that arrived
    // here is the cache restating the road, and is no witness to anything.
    const sameMs = Number(opts.sameReadingMs) > 0 ? Number(opts.sameReadingMs) : GEO_DERIVE_DEFAULTS.sameReadingMs;
    const road = _gdRoadReadings(fixes.filter(f => f.lat != null && f.lng != null), arrived.startTs, arrived.ts);
    const later = [];
    for (const f of rows) {
      if (road.has(f.lat + ',' + f.lng)) continue;
      const prev = later[later.length - 1];
      if (prev && prev.lat === f.lat && prev.lng === f.lng && f.ts - prev.ts <= sameMs) { later[later.length - 1] = f; continue; }
      later.push(f);
    }
    // ── YOU CANNOT LEAVE A PLACE YOU HAVE NOT REACHED YET ────────────────
    // Owner 2026-09-16: "my onsite banner at john doe didnt grab my arrival
    // time and incremement the time up nor do I see my log beginning at john
    // doe starting at 143 pm like I used to."
    //
    // A fenced arrival is stamped at the OS region crossing, and iOS fires
    // that at the FULL region radius: his 13:43:37 enter sits 785 ft from the
    // pin. inFence measures against the kind-scaled span instead (a client is
    // 0.4 of the account radius, 240 ft), so the last ten fixes of the drive
    // up the street, 761, 745, 638, 586, 501, 456, 431, 430, 401 and 299 ft,
    // are every one of them "outside". The first two corroborated each other,
    // the visit closed at its own arrival instant with no length, and because
    // a closed visit means `open` is null, rule 11 then read the day as
    // having ended at 12:45 and dropped his 12:59 to 13:36 shop dwell as
    // after-hours. One missed arrival, two holes, on the same afternoon.
    //
    // So the departure scan starts at the first fix that is genuinely inside.
    // Everything before it is the approach, and an approach is not a
    // departure. If NO fix is ever inside, he drove past without arriving:
    // that is the old behaviour and is kept exactly as it was, the scan runs
    // from the top and closes the visit at its own instant, writing nothing.
    const reached = later.findIndex(inFence);
    for (let i = reached > 0 ? reached : 0; i < later.length; i++) {
      if (inFence(later[i])) { end = later[i].ts; continue; }
      // Outside. Confirmed only if the NEXT fix is also outside; a single
      // outlier between two inside fixes is noise and is skipped.
      const next = later[i + 1];
      if (next && inFence(next)) continue;
      // Nothing after it to corroborate with either: an unconfirmed last
      // reading does not get to end a day that may still be running.
      if (!next) continue;
      // Rule 15: a fix drifting outside is the weakest possible evidence that
      // somebody left, and while the OS's own closed crossing still covers
      // this instant for this very fence, it is not evidence at all. Jack's
      // 4:01pm is exactly that shape.
      if (_gdSameFence(inside(later[i].ts), arrived.fence)) continue;
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
  // ── RULE 5, AMENDED: A PLACE NOBODY SAVED IS STILL A PLACE ──────────────
  // Owner 2026-09-18, on Jack: "he's like 700 feet away from the shop at a on
  // site address 2 and a half blocks from his dads shop", and then the design
  // he had already asked for once: "consolidate pings off cordinates and
  // compare the two, different cordinates between core motion flips means were
  // at a new address, but I guess that didnt carry over."
  //
  // Half of it had carried over. Rule 22 (_gdReseatDwells) names a stop from
  // the median of every fix taken while he sat there, in his own words, rather
  // than from one arrival ping. But rule 22 can only reseat a stop that EXISTS,
  // and rule 5 says a journey ending somewhere unsaved writes nothing, so no
  // stop was ever created for it to work on. The clustering rule was sitting
  // behind a gate that never opened.
  //
  // His morning: shop 07:35 to 07:53, then 767 ft to a job site nobody has
  // saved, where he has been ever since. The engine asked "which saved fence
  // contains this fix", got nothing, and stopped asking. It never asked the
  // question he is asking: is this even the same place I was before.
  //
  // So an arrival with no fence now opens a dwell too, seated on the CLUSTER
  // (the same _gdSpotOf median rule 22 uses), named as exactly what it is.
  // Scope, deliberately narrow, because this is the live report only:
  //   * It is an OPEN dwell, so it reaches the screens and the ops portal as
  //     the open row (no departure, no minutes) and claims nothing: an open
  //     row has no minutes to claim. What the DRIVE here was worth is rule
  //     14's decision and still is. Nothing about totals moves.
  //   * It stays open until a journey actually leaves. A flip that ends where
  //     it started never closes it, which is the other half of Jack's
  //     morning: a false automotive flip at 08:27 that travelled 120 ft
  //     inside a 220 ft parked cluster ended a stop he is still sitting in.
  //   * It needs a real cluster, not one ping. Without _GD_RESEAT_MIN_FIXES
  //     fixes to agree with each other there is nothing to be confident about
  //     and the old answer (nobody on site) stands.
  //   * unsaved:true rides on it so the screens know to offer Save this
  //     address rather than draw a name they do not have. Saving it makes a
  //     fence, and the next derive of the day finds it at both ends.
  // Read off the JOURNEY, not off `arrived`: on this path `arrived` was never
  // set at all (openWhy said 'no-arrival'), because the only place it is
  // assigned for a closing journey is behind `if (toFence)`. That is rule 5
  // itself, in one line: no fence, no arrival, nothing to stand on.
  else if (!open && journeys.length && !journeys.some(j => j && j.open)) {
    const lastJ = journeys[journeys.length - 1];
    const t0 = Number(lastJ && lastJ.endTs);
    const spot = t0 > 0 ? _gdSpotOf(fixes, t0, dayEnd, opts.maxFixAccM) : null;
    // Nowhere saved is the whole condition. A cluster that IS inside a fence
    // belongs to the branch above, and rule 22 has already had its say there.
    if (spot && !geoFenceAt(spot, fences, opts.radiusFt)) {
      open = { id: 'd-' + lastJ.id, fence: _gdUnsavedEnd(spot), kind: 'unsaved',
        name: '', sinceTs: t0, journeyId: String(lastJ.id),
        unsaved: true, spot, atHome: false };
      openWhy = '';
    }
  }

  // Rule 22: the stop sits where the phone SAT (see _gdReseatDwells), before
  // any rule below reads which fence it is at.
  const seated = _gdReseatDwells(dwells, fixes, fences, opts);
  // Rule 10: paperwork at the home office.
  const carved = _gdOffice(seated, open, journeys, fixes, fences, inp.appEvents, dayStart, dayEnd, nowMs, opts);
  // Rule 12: the house is never on the clock.
  const housed = _gdHouseOffTheClock(carved);
  // Rule 11: the day ends with the last real work.
  const ended = _gdEndOfDay(housed, fences, opts, open, journeys.some(j => j && j.open), legs,
    _gdClockSpans(inp));
  // Rule 13: a visit the day cannot vouch for is a question, not a row.
  const asked = _gdHeldVisits(ended, inp, dayStart);
  // Rule 15: and the drives between them, using rule 13's own answer.
  const askedLegs = _gdHeldLegs(legs, asked, inp, dayStart, fences, opts);
  // Rule 17: the workday window, computed ONCE from the two signals the owner
  // named. Rules 15 and 16 both read it rather than each guessing again.
  const win = _gdDayWindow(askedLegs, asked, inp, opts, dayEnd, fences);
  // Everything between the bookends counts: a drive rule 15 could not vouch
  // for on its own is work if the workday was open around it.
  const winLegs = win
    ? askedLegs.map(l => (l && l.held === true && _gdInWindow(win, l))
        ? Object.assign({}, l, { held: false, inWindow: true }) : l)
    : askedLegs;
  // Rule 16: a day that never reached business at all writes no drives. A
  // house loop (rule 7) survives only inside the window.
  const laddered = _gdEmptyDayLegs(winLegs, asked, inp, open,
    journeys.some(j => j && j.open), win, fences, opts.radiusFt);
  // Rule 20: the commute is marked, not deleted. The leg is a real drive and
  // the map, the route and every structural rule above still need it; what it
  // must never do is bill. geoDeriveRows writes no mileage row and no drive
  // time row for it, which is where "no hours, no miles" actually lives.
  const realLegs = _gdCommuteMark(laddered, fences, opts.radiusFt, inp.crew === true,
    _gdClockSpans(inp));
  // WOULD THIS BILL IF IT CLOSED NOW? The open dwell is published straight to
  // the screens (_geoOpenDwellPublish) and skips every rule above on the way,
  // so a man standing in his own kitchen read as time on the clock at the shop
  // (owner 2026-09-06). It still reports where he is; it now also says whether
  // that is work, and the rail can stop calling it time.
  if (open) open.counts = _gdOpenCounts(open, asked, win, nowMs);

  return {
    day: inp.day || '',
    dwells: asked.filter(d => d.minutes >= 1),
    legs: realLegs,
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
// Rule 14's answer for the live screens: an open dwell at somebody's own
// address is not time until the day lands in real work. Same test the writer
// uses, read off the dwells that survived it, so the rail and the row can
// never disagree.
// ── AND THE DAY HAS TO BE ABLE TO END (owner 2026-09-12) ──────────────────
// "How does a day with automatic drives end? Right now they can't and my own
// account is proof." It could not, and this is where.
//
// An open dwell has no departure yet, so it runs to this moment by
// definition. At his own house, on any day that reached real work, the test
// below said it counted, and it went on saying so all evening and all night,
// because nothing about a man sitting in his kitchen ever changes. The
// screens drew "On site now" against it until he drove somewhere.
//
// Rule 17 already worked out when the workday closed (the last real work plus
// the wrap, or the last clock-out) and nobody asked it. Now it does: past
// that, at your own address, you are home. Drive out again and a new journey
// re-opens the window, so this can never strand a day that was not over.
//
// Deliberately measured against NOW and not against the arrival: getting home
// at 17:39 does not end a workday that runs to 18:09, and the half-hourly
// re-derive is what flips it once it does.
function _gdOpenCounts(open, dwells, win, nowMs) {
  if (!open) return false;
  if (!open.atHome) return true;
  if (win && Number(nowMs) > Number(win.close)) return false;
  return (dwells || []).some(d => d && !_gdIsBaseKind(d.kind) && d.kind !== 'office');
}
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
function _gdEndOfDay(dwells, fences, opts, open, driving, legs, clockSpans) {
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
    // Rule 14: THE DAY HAS TO LAND IN REAL WORK (owner 2026-09-06, looking at
    // his own live day: "I drove out, never entered a job fence so is that how
    // we split it? Has to land in a job fence? If not general clock in handles
    // it").
    //
    // It does. Landing means a DWELL at a job, client or supply fence. Driving
    // past one, or out to an address that never resolves, is not landing.
    //
    // This replaces a "a leg touched a non-house fence" escape hatch that let
    // any resolved endpoint flip a whole day back to billable. His 2026-09-06:
    // out at 10:28, a stop that never resolved, home at 12:22, and then hours
    // at his own address reading as shop time on the rail. Nothing that day
    // was work, and the manual clock is how a day like that gets claimed.
    return dwells.filter(d => !(String(d.kind) === 'shop' && _gdShopIsHome(d.fence, fences, opts.radiusFt)));
  }
  const openWork = !!(open && !_gdIsBaseKind(open.kind) && open.kind !== 'office');
  if (openWork || driving) return dwells;                // the day is not over
  const lastWorkEnd = Math.max.apply(null, work.map(d => d.endTs));
  const firstWorkStart = Math.min.apply(null, work.map(d => d.startTs));
  const wrapMs = (Number(opts.wrapMin) > 0 ? Number(opts.wrapMin) : 0) * 60000;
  const trim = (d, a, b) => (b > a)
    ? Object.assign(_gdDwell(d.fence, a, b, d.journeyId, false), { closedBy: d.closedBy, wrapped: (b - a) < (d.endTs - d.startTs) })
    : null;
  const out = [];
  for (const d of dwells) {
    if (!_gdIsBaseKind(d.kind)) { out.push(d); continue; }
    // THE CLOCK OUTRANKS THIS RULE TOO. The wrap is for a phone left at the
    // yard after hours, and nobody is clocked in after hours. Jack's 13:27 to
    // 15:22 at the yard sat inside an eight-hour punch and was still cut to 30
    // minutes, which is the hole the rail then dressed up as an address.
    if (_gdUnderClock(clockSpans, d.startTs, d.endTs)) { out.push(d); continue; }
    // Rule 14, second half: A HOME SHOP IS A BOOKEND, NEVER THE DAY. On a day
    // that did land in real work, the house earns the truck-loading window on
    // either side of it and nothing else. It used to keep every minute that
    // started before the last work end, so one job at 3pm paid for the whole
    // morning at his own address.
    //
    // This is the wider reading of the 2026-08-24 rule that CLAUDE.md 9.11
    // said only the owner could authorise, and he did (2026-09-06): a house
    // that is also a yard gets the same bounded wrap a real yard gets, at both
    // ends, instead of everything before the last job and nothing after. It is
    // capped at wrapMin, so it cannot repeat the 19h38m the evening trim was
    // written for. Real work at a home shop in the middle of the day is the
    // manual clock's job, by his own instruction.
    if (d.kind === 'shop' && _gdShopIsHome(d.fence, fences, opts.radiusFt)) {
      // BEFORE the first work of the day: the loading window, and only that.
      // This is the half that was wrong. A dwell starting before the last work
      // end was kept in FULL, so one job at 3pm paid for the whole morning at
      // his own address (owner 2026-09-06, watching it happen live).
      if (d.endTs <= firstWorkStart) { const row = wrapMs ? trim(d, Math.max(d.startTs, d.endTs - wrapMs), d.endTs) : null; if (row) out.push(row); continue; }
      // BETWEEN two pieces of work: kept whole, unchanged. Work on both sides
      // is the strongest proof there is that the stop was the truck, not the
      // couch (owner 2026-09-02, "the shop between two jobs is the shop").
      if (d.startTs < lastWorkEnd) { out.push(d); continue; }
      // AFTER the last work: nothing, unchanged. A real yard gets 30 minutes
      // to unload; an evening at the house does not (owner 2026-09-02 on his
      // own 5:29, "those aren't needed").
      continue;
    }
    if (d.startTs < lastWorkEnd) { out.push(d); continue; }
    // ── THE WRAP IS FOR A DAY THAT ENDED, NOT A YARD HE DROVE OUT OF ─────
    // Owner 2026-09-16: "From JS Solutions shop to the unsaved address at 157
    // pm for Jack we're missing a fucking drive dude."
    //
    // No drive is missing. His phone never moved: the tape reads still, onFoot,
    // still from 13:51 to 15:21 without touching automotive once, and the fixes
    // sit 11 to 20 feet from the yard until 14:06, when one cached coordinate
    // 1,161 ft out repeats verbatim at 14:06, 14:38, 15:00 and 15:25. He left
    // at 15:22:07, and the fence agreed: the exit fired at 15:25:40.
    //
    // What is missing is 1h25m of YARD time, and this branch took it. The wrap
    // was written for a phone that sits at the yard after hours (one session
    // ran to 11:48pm and would have added 19h38m to a week), so it allows 30
    // minutes to unload and drops the rest. It fired here because "the last
    // real work" is computed from DWELLS, and his 3:38pm stop was at an
    // address nobody saved, which is not a dwell. So a day that was still
    // going looked, to this rule, like a day that had ended at 1:22.
    //
    // HE LEFT AGAIN AND THE DAY CARRIED ON, AND THAT IS THE WHOLE TEST.
    //
    // "Left again" on its own is too loose, because the drive HOME is also
    // leaving: a yard dwell that ends with him going home is precisely the
    // 19h38m case this rule was written for, and that one must still be
    // capped. What separates Jack's afternoon from it is where the next leg
    // went. He drove out of the yard to an address nobody saved and spent 43
    // minutes there; the day was not over, it was still going.
    //
    // So: a leg after this dwell that ends anywhere but a house, or a CHAIN
    // (more than one hop, which by definition has a stop inside it). Straight
    // home, one hop, is the day ending and keeps the unload window.
    const houseEnd = (l) => !!(l && l.to && l.to.unsaved !== true &&
      _gdIsHouse(l.to, fences, opts.radiusFt));
    const wentOnWorking = (legs || []).some(l => l && typeof l.startTs === 'number' &&
      l.startTs >= d.endTs - 60000 &&
      (!houseEnd(l) || (Array.isArray(l.drives) && l.drives.length > 1)));
    if (wentOnWorking) { out.push(d); continue; }
    // After the last real work. A real shop gets the wrap-up allowance.
    if (d.kind === 'shop') {
      const row = trim(d, d.startTs, Math.min(d.endTs, d.startTs + wrapMs));
      if (row) out.push(row);
    }
    // A home office: nothing.
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
// ── RULE 19: THE DAY LEARNS WHEN THIS PERSON USUALLY WORKS ────────────────
// Owner 2026-09-15: "Jack's day is 8 am to 5 pm really but sometimes gets off
// before that, we know his clock in and clock out behavior so how do we run
// this ladder off the times we know he usually works? This could be global."
//
// The company's Settings hours are one number for everybody, and they exist to
// cover the forgetful contractor for free (rule 13). They cannot tell a crew
// member who starts at 7:45 from an owner who invoices at 10pm, and the
// question this now has to answer is exactly that: was this drive part of THIS
// person's working day.
//
// His own clock punches answer it, and far more sharply than a setting could.
// Jack's seven clocked days, Central: in at 7:42, 7:44, 7:44, 7:45, 7:54,
// 7:55, 7:58, and out between 15:00 and 19:30. A sixteen-minute band on the
// in. The 5:29am gym run is more than two hours before the earliest he has
// ever started; that is not a close call, it is a different part of the day.
//
// THE EDGES ARE THE EXTREMES, PADDED, NOT THE MEDIAN, and the asymmetry is
// deliberate: missing a real job costs the owner money, while letting one gym
// trip through costs a greyed row he can dismiss. So the window is as wide as
// the person has ever been, plus an hour each way, minus the single most
// extreme sample on each side so one 4am start cannot poison it forever.
//
// ONLY CLOCKS ON OR BEFORE THE DAY BEING DERIVED. A day's rows must not change
// because of a punch from three weeks later; re-deriving September 1st next
// month has to reach the same answer it reached then.
//
// UNDER FIVE CLOCKED DAYS THERE IS NO PATTERN, only a couple of points, so the
// company setting stands. A new hire is covered from day one, just loosely.
//
// input.clockHistory is [{day, inMin, outMin}], minutes after that day's local
// midnight, resolved by the caller: it already owns the Central day maths and
// this file must not grow a second copy of it (a DST day is 23 or 25 hours and
// a modulo would be wrong twice a year).
const GEO_LEARNED_MIN_DAYS = 5;
const GEO_LEARNED_PAD_MS = 3600000;
function _gdLearnedHours(inp) {
  const day = String((inp && inp.day) || '');
  const rows = (Array.isArray(inp && inp.clockHistory) ? inp.clockHistory : [])
    .filter(r => r && typeof r.inMin === 'number' && typeof r.outMin === 'number'
      && r.outMin > r.inMin && String(r.day || '') && String(r.day) <= day);
  if (rows.length < GEO_LEARNED_MIN_DAYS) return null;
  const ins = rows.map(r => r.inMin).sort((a, b) => a - b);
  const outs = rows.map(r => r.outMin).sort((a, b) => a - b);
  // Drop the one outlier at each end. With exactly the minimum that still
  // leaves three days either side of the edge being chosen.
  const a = ins[1], b = outs[outs.length - 2];
  if (!(a >= 0 && b > a)) return null;
  return { a: a * 60000 - GEO_LEARNED_PAD_MS, b: b * 60000 + GEO_LEARNED_PAD_MS };
}
// The working day, as one answer: its bounds in ms after local midnight, and
// whether this is a working day at all. One definition, because rule 13 asks
// it about visits and rule 16 asks it about drives, and they cannot disagree.
function _gdDayShape(inp) {
  const wh = (inp && inp.workHours) || {};
  const hm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m ? (Number(m[1]) * 60 + Number(m[2])) * 60000 : NaN; };
  let whA = hm(wh.start), whB = hm(wh.end);
  if (!Number.isFinite(whA)) whA = 6 * 3600000;
  if (!Number.isFinite(whB)) whB = 20 * 3600000;
  // Rule 19: what this person actually does REPLACES what the company wrote
  // down, because it is measured rather than guessed and it is already padded
  // by an hour each way with its outliers trimmed off. The setting is the
  // fallback for anybody too new to have a pattern, not a floor under one.
  //
  // Replacing can make the window narrower than the company's, and that is the
  // point: Jack has never once started before 7:42, so the company's 6am tells
  // us nothing about his morning. What keeps that safe is where this window is
  // USED. A drive between two saved fences counts at any hour, and so does one
  // a clock covers; the window only ever arbitrates a drive that can vouch for
  // neither, which is the ambiguous loop through somewhere nobody saved. The
  // worst it can do is drop one of those, and the whole reason it exists is
  // that one of those is a gym run.
  const learned = _gdLearnedHours(inp);
  if (learned) { whA = learned.a; whB = learned.b; }
  const days = Array.isArray(wh.days) ? wh.days.map(Number) : [1, 2, 3, 4, 5, 6];
  const dow = new Date(String((inp && inp.day) || '') + 'T12:00:00Z').getUTCDay();
  return { whA, whB, learned: !!learned, workDay: Number.isFinite(dow) && days.indexOf(dow) >= 0 };
}

// ── THE CLOCK IS THE BRACKET (owner 2026-09-16) ──────────────────────────
// "Everything between a manual clock in for Jack shows drive to address,
//  onsite time then drive to next address onsite time, drive to shop, shop
//  time, drive from shop to address, onsite time then clock out."
//
// He has said this, in one form or another, since the first week. It is one
// rule and it outranks every rule in this file that can take something OFF a
// day: the commute (20), the unload wrap (14), and the held visit (13). Those
// exist to answer a question the evidence leaves open. A manual clock closes
// it. A person who punched in is telling you, at the time and in their own
// words, that this stretch is work, and no amount of geometry gets to argue.
//
// So: inside a clock nothing is refused and nothing is a question. Outside a
// clock every rule below still decides, exactly as it did, which is what keeps
// the 5am gym trip and the evening at the yard out of the day.
function _gdClockSpans(inp) {
  return (Array.isArray(inp && inp.clocks) ? inp.clocks : [])
    .map(c => c && { a: Number(c.start), b: Number(c.end) })
    .filter(c => c && c.a > 0 && c.b > c.a);
}
// A minute of real overlap, the same threshold rules 13 and 16 already use, so
// a clock that merely abuts a row does not claim it.
function _gdUnderClock(spans, a, b) {
  return (spans || []).some(c => Math.min(b, c.b) - Math.max(a, c.a) >= 60000);
}
function _gdHeldVisits(dwells, inp, dayStart) {
  const clocks = (Array.isArray(inp.clocks) ? inp.clocks : [])
    .map(c => c && { a: Number(c.start), b: Number(c.end) })
    .filter(c => c && c.a > 0 && c.b > c.a);
  const { whA, whB, workDay } = _gdDayShape(inp);
  const overlaps = (d, a, b) => Math.min(d.endTs, b) - Math.max(d.startTs, a) >= 60000;
  return (dwells || []).map(d => {
    if (!d || d.kind !== 'client' || !d.fence || d.fence.scheduled === true) return d;
    if (clocks.some(c => overlaps(d, c.a, c.b))) return d;
    // ── THE CONTACT ANSWERING IN ADVANCE (owner 2026-09-12) ───────────────
    // "Add in ability to mark a contact as family member so time flags itself
    // as need marked personal or work."
    //
    // This is the hole the paragraph above names and could not close: a
    // genuinely personal WEEKDAY AFTERNOON at a client with nothing scheduled
    // looks exactly like work, because the working-day window is the widest
    // of the three witnesses and it was only ever meant to cover the
    // forgetful contractor for free.
    //
    // Marking the contact takes that one witness away and leaves the other
    // two, which is the whole change. An explicit signal still vouches: a job
    // ON THE CALENDAR at a family member's address is work, and so is a
    // manual clock running over the visit, because that is the person saying
    // they are working right now. What no longer counts as evidence is
    // merely being there on a Tuesday.
    //
    // Deliberately held rather than dropped. "Personal" is still the owner's
    // answer to give, not this function's to assume, and a held visit already
    // counts toward nothing and asks on the card. Dropping it silently would
    // lose the one case he DOES bill for at that address.
    //
    // ── THE THIRD WITNESS: OPEN ON THE BOOKS (owner 2026-09-12) ──────────
    // "flag the question if it's work or personal if there's no active job
    // or proposal that's open on the books."
    //
    // The calendar witness above is DATE-BOUND: `scheduled` means a job whose
    // dates cover this very day. That is too narrow for the way the work
    // actually arrives. A live job at a family member's address is business
    // whether or not today is one of its scheduled days, and a proposal still
    // sitting out there unanswered is a reason to be at the address at all:
    // walking the job, measuring, chasing the signature.
    //
    // So the fence carries `onBooks` (js/geo-track.js _geoDeriveFences and
    // geo_fences_for, the one pair that has to agree): a job not canceled,
    // complete or done, or a bid still open (Pending, sent, opportunity, or
    // won and not yet closed out). A DRAFT never counts: nothing has been put
    // in front of the client, so it is not evidence of anything.
    //
    // It vouches for the visit exactly the way the calendar does, and it
    // vouches ONLY for a family contact's benefit here; an ordinary client
    // never needed it, because the working-day window already covered them.
    if (d.fence.personal === true && d.fence.onBooks !== true) return Object.assign({}, d, { held: true });
    if (workDay && whB > whA && overlaps(d, dayStart + whA, dayStart + whB)) return d;
    return Object.assign({}, d, { held: true });
  });
}

// ── Rule 17: THE WORKDAY WINDOW (owner 2026-09-12) ────────────────────────
// "We got a business fence to business fence to start the work timer, and or
// we got a manual clock in and clock out, and everything in between those
// times." And, on the drive that happens before the clock: "some days Jack
// went straight from home to a job site, but he had a manual clock in in the
// middle of the day."
//
// Rules 7, 11, 15 and 16 each made their OWN guess about whether the day
// counted, from different evidence, at different points in the pipeline. That
// is why a real trip could vanish while a gym run wrote mileage: nothing in
// the file knew, as one fact, whether the workday was open. This is that fact.
//
// OPENS at the EARLIER of the two signals, which is the whole point of his
// second sentence. Measured on the crew member's own week: he clocks in when
// he ARRIVES, not when he leaves. 31 August he pulled out at 7:09 and clocked
// in at 7:55, a 46-minute drive to the yard that a clock-anchored window would
// have thrown away, and 1 and 9 September are the same by 19 minutes. The
// mirror case is 8 September: clocked in at 7:58, first drive not until 13:28,
// a morning at the shop with no drive in it that only the clock can open.
// Either signal can be first. Whichever is, opens the day.
//
// CLOSES at the LATER of the last clock-out or the last business arrival plus
// the shop wrap (rule 11's number, owner 2026-08-24, already chosen for the
// phone that sits at the yard all evening). So an evening gym run after a real
// workday falls OUTSIDE the window and is still not work, which is the case
// that stops "the day was open" from meaning "everything today was work."
//
// WHAT COUNTS AS THE FENCE SIGNAL is rule 15's answer, not a new one: a leg
// that reaches a business end (a job, the yard, a supply house, or a client
// the day can stand behind). NOT "business fence to BUSINESS fence" in the
// literal sense, which was checked against both real accounts and is wrong:
// only 3 of the crew member's 7 work days pass it, because the other four run
// house -> yard -> house and his house is one end. 12 September is the proof,
// 13.9 miles out to the yard and back with no clock, which both-ends deletes.
// One business end plus the clock classifies all 24 days across both accounts
// correctly, and kills exactly the four nobody worked.
//
// A HOUSE LOOP CAN NEVER OPEN THE WINDOW. It touches no business fence by
// definition, so rule 7 can mark one and let this judge it without the two
// ever depending on each other.
//
// NOT the same thing as _gdWorkWindow above, which is rule 10's narrower
// question (first drive to last real work) and exists only to decide when the
// house may be Office. That one is left exactly as it is: widening it would
// move Office rows on days nobody asked about.
function _gdDayWindow(legs, dwells, inp, opts, dayEnd, fences) {
  let open = Infinity, close = -Infinity;
  (Array.isArray(inp.clocks) ? inp.clocks : []).forEach((c) => {
    const a = Number(c && c.start), b = Number(c && c.end);
    if (a > 0 && b > a) { if (a < open) open = a; if (b > close) close = b; }
  });
  const wrap = Number(opts && opts.wrapMin) >= 0
    ? Number(opts.wrapMin) : GEO_DERIVE_DEFAULTS.wrapMin;
  // ── THE WRAP IS FOR UNLOADING, SO IT ONLY EXISTS WHERE YOU UNLOAD ──────
  // Rule 11's wrapMin is the half hour after the last job for putting the
  // truck away at a real yard. It was added to the end of EVERY leg and
  // every dwell, which includes arriving at your own driveway, and on the
  // owner's account that is the same coordinate as the yard: his shop fence
  // sits 20 ft from his home office. So every time he got home the workday
  // stretched another thirty minutes past the moment he stopped working, and
  // the evening that followed landed inside it (his 10 and 11 September).
  //
  // Same call the vouches ladder already makes one rule up (a shop that is
  // your house is your house), applied to the one place that never got the
  // memo. Nothing changes for a yard a mile and a half from the house, which
  // is the crew member's, and it keeps its wrap exactly as before.
  const wrapFor = (fence) => (_gdIsHouse(fence, fences, opts && opts.radiusFt) ? 0 : wrap * 60000);
  (legs || []).forEach((l) => {
    // Rule 15 has already said which legs reach business; a held one has not.
    if (!l || l.held === true || l.houseLoop === true) return;
    if (Number(l.startTs) > 0 && l.startTs < open) open = l.startTs;
    const end = Number(l.endTs) + wrapFor(l.to);
    if (end > close) close = end;
  });
  (dwells || []).forEach((d) => {
    if (!d || _gdIsBaseKind(d.kind) || d.kind === 'office' || d.held === true) return;
    if (Number(d.startTs) > 0 && d.startTs < open) open = d.startTs;
    const end = Number(d.endTs) + wrapFor(d.fence);
    if (end > close) close = end;
  });
  if (!isFinite(open) || !(close > open)) return null;
  return { open, close: Math.min(close, Number(dayEnd) || close) };
}
// ── INSIDE THE WINDOW MEANS INSIDE IT, NOT TOUCHING IT ────────────────────
// This used to pass on one minute of OVERLAP, and the comment claimed that
// was "no part-credit" when it was nothing but part-credit: his 11 September
// evening loop ran 17:45 to 20:58 against a window that closed at 18:09, and
// came in whole on 24 minutes of contact. A three-hour trip does not join the
// workday because its first six minutes did.
//
// Containment, both ends. A leg that starts before the day opened or ends
// after it closed is not in the day, and the two signals that OPEN a window
// (a clock, a leg that reached business) are contained in it by construction,
// so nothing that genuinely belongs to the day is excluded by tightening this.
function _gdInWindow(win, r) {
  if (!win || !r) return false;
  const a = Number(r.startTs), b = Number(r.endTs);
  if (!(a > 0 && b >= a)) return false;
  return a >= win.open && b <= win.close;
}

// ── Rule 16: a day that never reached business writes no drives ───────────
// Owner 2026-09-12, on a crew member's unclocked days: "he should only have
// drives and mileage on the days there was a clock in ... Jack doesn't have
// two back to back fences going all the way back to the shop on those days he
// doesn't have a clock does he?"
//
// He does not, and that is the rule. Checked against every day the crew member
// has on record: all six of his clocked days open with a leg from his house to
// the yard or to a real customer, and not one of the four unclocked days
// touches a business address anywhere. Two of them are the same gym run a week
// apart, out at 5:25 and home by 6:21, both ends unsaved.
//
// So this is rule 11's test, finally applied to the legs. Rule 11 already
// throws away a day's base dwells when nothing in it landed in real work
// ("Jack's do: home, the gym, home"). It never did the same for the drives,
// and that asymmetry is why the gym ran up mileage rows on a day the time log
// correctly showed as empty.
//
// ── THE LADDER, AS THE OWNER STATED IT (2026-09-15) ───────────────────────
// "In order to start the day, we need back to back fence stops aligned with
// core motion or a manual clock in to happen." Then, having spotted the hole
// in his own rule: "What if the first stop of the day isn't a saved address
// nor is the clock in button hit, then we have missing rows."
//
// He is right, and the hole is not fixable by looking harder at the tape: a
// gym run and a first job at an address nobody saved are THE SAME DATA. Leave
// the house, stop somewhere unsaved, come home. No rule reading only the
// breadcrumbs can separate them, so any rule that kills one kills the other.
//
// What separates them is WHEN. So the day-start question is answered by the
// witness ladder rule 13 already uses for visits, applied to drives, with rule
// 19's learned hours in place of the company setting:
//
//   1. the drive vouches for itself: two different saved fences, off the tape
//   2. a manual clock covers it
//   3. it sits wholly inside this person's working day (rule 19)
//   4. none of those: it is not written
//
// Rungs 1 and 2 are his rule, unchanged and unconditional on the hour. Rung 3
// is the answer to his catch-22: a 9am run to a customer nobody has saved is
// written, greyed, earning nothing, with the Save button on it, so the row is
// there to be named and nothing goes missing. Rung 4 is the gym, out at 5:29
// and home by 6:27, two hours before Jack has ever clocked in.
//
// WHOLLY inside, not touching: his gym run ends at 6:27 and would overlap a
// 6am company window by 27 minutes. Same rule _gdInWindow already states for
// the workday ("inside the window means inside it, not touching it").
//
// A leg that is NOT held reached business on its own and is rung 1 by
// definition, so it never has to ask the hour.
// ── RULE 20: THE COMMUTE IS NOT WORK, AND IT IS NOT MILEAGE ───────────────
// Owner 2026-09-15: "He doesn't get paid for his drive to his dads shop or
// when he goes home, his time runs on arrival to the shop and or clock in time
// and out time, we dont want to show his mileage to his dads or from home."
//
// This is the IRS commuting rule and that is why it is global rather than one
// man's exception: travel between your home and your regular place of work is
// never claimable, and everything from arrival onward is. Jack happening not
// to own the shop he reports to is incidental; an employee of any contractor
// on this app has the same two drives every day.
//
// THE SHOP IS THE REGULAR PLACE, and no box has to be ticked to say so (owner
// 2026-09-15: "globally the process will be employees drive to the shop don't
// get logged, but anything from the shop out to the next job does. The trigger
// would be shop to address and/or clock in"). The account already says where
// the shop is, so the rule needs no setup and is right on day one for every
// account: the checkbox is the EXCEPTION, for a second yard somebody reports
// to that is not the registered shop.
//
// A leg with a HOUSE at one end and that place at the other, in either
// direction, is the commute: no time row, no mileage row, nothing on the rail.
// Arrival is where the day starts, which is what the owner asked for, and the
// dwell at the shop is untouched because being there IS the work.
//
// A HOME OFFICE DOES NOT EXEMPT IT, and that is deliberate rather than an
// oversight. The tax code would let a genuine principal-place-of-business home
// office claim that first drive; the owner's rule is that the day runs from
// arrival at the shop or the clock, whichever comes first, and his own house
// is a home_office place. Naming it here so the next reader knows the narrower
// reading was chosen, not missed.
//
// EVERY OTHER LEG OUT OF THAT PLACE IS WORK, unchanged. Shop to a customer,
// shop to a supply house, customer back to the shop: all still claimed. Only
// the two ends of the commute itself are refused, which is exactly the line
// the deduction draws.
//
// It is dropped BEFORE the ladder rather than inside it, and unconditionally:
// a commute covered by a manual clock is still a commute. The clock says he
// was working, not that the drive was billable, and rule 16's rungs are about
// whether a drive can be PLACED, which this one can, precisely.
// ONE BUILDING ANSWERS TO SEVERAL FENCES, and this rule cannot be the third
// thing to forget it. His yard is registered twice on his own account: the
// built-in Settings shop and the td_places row migrated from it, same
// coordinate, same rank, so which one a leg's end carries is decided by
// nothing better than list order. Ticking the box on one of them has to work.
//
// Same shape _gdShopIsHome already uses for the other duplicate-registration
// question ("is there a home office standing at this shop"), so there is one
// idiom for "what else is at this spot" rather than two.
// The shop, or anywhere the box was ticked. A house that happens to be a shop
// is not caught here: _gdCommuteMark refuses a leg whose ends are both the
// house, which is the owner's own account (his shop fence sits on his desk).
function _gdReportsKind(f) {
  return !!f && (f.commute === true || String(f.kind) === 'shop');
}
function _gdReportsHere(fence, fences, radiusFt) {
  if (!fence || fence.lat == null || fence.lng == null) return false;
  if (_gdReportsKind(fence)) return true;
  const r = Number(radiusFt) > 0 ? Number(radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  return (fences || []).some(f => _gdReportsKind(f) && f.lat != null && f.lng != null &&
    _gdMiles(fence, f) * 5280 <= r);
}
// RULE 20, THIRD SHAPE (owner 2026-09-15). The first two anchored on the SHOP
// and both were wrong about his real days:
//
//   v1/v2  "house to the place you report to"   His first drive that morning
//          went to his MOTHER'S, not the yard, so it billed. And the drive
//          home billed too, because he stopped at one address on the way and
//          a chain was exempt.
//
// His rule, in his words, was never about the shop: "his time runs on arrival
// and out at clock out." So the anchor is the HOUSE and the DAY:
//
//   THE FIRST DRIVE OUT OF HIS HOUSE AND THE LAST DRIVE BACK TO IT ARE HIS
//   OWN, whatever sits at the other end.
//
// That is the IRS commuting line too (first trip out, last trip home), it
// kills the drive to his mother's without a word about family, and it cannot
// eat a customer stop, because only the FIRST and LAST hop of the day are ever
// refused and everything between them is untouched.
//
// It marks SEGMENTS, not whole legs. The 15 September drive home was the yard,
// an unsaved address for 43 minutes, then his driveway: one leg, two hops. The
// old rule exempted the whole thing to protect the stop in the middle; this
// refuses the final hop and leaves the stop exactly where it is.
function _gdCommuteMark(legs, fences, radiusFt, crew, clockSpans) {
  // ── AND ONLY FOR CREW ─────────────────────────────────────────────────
  // Owner 2026-09-16, asked straight out whether a drive from the house to a
  // customer job should bill: "for a business owner it does, but for Jack it
  // doesn't."
  //
  // That is the whole gate, and it is the line the tax code draws in the same
  // place. An owner with a home office has their principal place of business
  // at home, so every drive out of the door is already work. An employee
  // getting themselves to the first job of the day is commuting, whoever owns
  // the address at the far end.
  //
  // It replaces a geographic proxy ("does this account have a base away from
  // the house"), which happened to give the right answer on the owner's own
  // account, where his shop fence sits four metres from his desk, and the
  // WRONG one for any owner whose yard is across town: their drive in would
  // have been refused. Crew is the actual question, so crew is what is asked.
  const list = Array.isArray(legs) ? legs.filter(Boolean) : [];
  if (!list.length) return legs;
  // THE CLOCK OUTRANKS THIS RULE. Jack punches in at his own house at 07:54
  // and pulls out of the driveway at 07:54:54; that drive is inside his shift
  // because he said so. The commute rule is for the drive nobody claimed.
  const clocked = (l) => !!l && _gdUnderClock(clockSpans, l.startTs, l.endTs);
  const house = (e) => !!e && e.unsaved !== true && _gdIsHouse(e, fences, radiusFt);
  const reports = (e) => !!e && e.unsaved !== true && _gdReportsHere(e, fences, radiusFt);
  // ── OR A BASE THAT IS NOT HIS HOUSE, WHICH IS THE OTHER HALF ──────────
  // Owner 2026-09-16: "for a business owner it does, but for Jack it doesn't."
  // Gating on the crew hat alone was the wrong reading of that and it broke
  // the very person it was written for. In the DATA Jack is not crew: his
  // rows carry contractor_user_id === employee_user_id, he has no
  // team_members row anywhere, and his login owns its own account. So `crew`
  // is false for him and his commutes billed, which is the exact opposite of
  // what the owner asked for, twice.
  //
  // Both of his sentences are true at once under one test, and it is the
  // question the tax code actually asks: IS HOME THE BASE? The owner's shop
  // fence sits four metres from his desk, so home IS his place of business
  // and every drive out of the door is work. Jack's base is his dad's yard
  // eight miles away, so his first drive out and his last drive back are his
  // own, whether or not anybody ever links him as crew.
  //
  // Crew stays in as the other half: a crew member whose employer registered
  // no shop at all still commutes to the first job of the day.
  //
  // ── AND HOME BEING THE BASE OUTRANKS BOTH (owner 2026-09-16, third round)
  // "Rebuilt, still missing a shit load of miles."
  //
  // It was the crew flag every time. Three fixes in one day moved that
  // question to three different places a support view could still answer
  // wrongly: _isEmployee, a cached copy of it, then the uids on the write.
  // Every one is session state, and a wrong answer on the OWNER'S OWN account
  // silently retires his first drive out and his last drive home. His 15
  // September replays to four legs with the flag off and to exactly the two
  // that were left in the table with it on, every single round.
  //
  // So the flag stops being able to reach him at all. If this account reports
  // to a base that IS the person's house, there is no commute to find: home is
  // the place of business, and the drive out of the door is the first business
  // mile of the day. That is the tax rule, it is a fact about the FENCES, and
  // nothing on a screen can poison it. His shop fence sits four metres from
  // his desk, so this is his case exactly.
  //
  // It cannot reach Jack: his 7402 SW 22nd Ct is a home_office, which is not a
  // place anybody reports to, and his dad's yard is eight miles away. Nor a
  // crew member with no base registered, whose commute still comes from the
  // flag below.
  const homeBase = (fences || []).some(f => f && f.lat != null && f.lng != null &&
    _gdReportsHere(f, fences, radiusFt) && _gdIsHouse(f, fences, radiusFt));
  if (homeBase) return legs;
  const awayBase = (fences || []).some(f => f && f.lat != null && f.lng != null &&
    _gdReportsHere(f, fences, radiusFt) && !_gdIsHouse(f, fences, radiusFt));
  if (!crew && !awayBase) return legs;
  const order = list.slice().sort((a, b) => a.startTs - b.startTs).filter(l => !clocked(l));
  if (!order.length) return legs;
  const mark = new Map();     // leg -> {first:bool, last:bool}
  const put = (l, k) => { const m = mark.get(l) || {}; m[k] = true; mark.set(l, m); };
  // The first hop of the day that LEAVES the house.
  for (const l of order) {
    if (!house(l.from)) continue;
    // A house loop is rule 7's round trip, not a commute.
    if (house(l.to) && (!Array.isArray(l.drives) || l.drives.length <= 1)) break;
    put(l, 'first'); break;
  }
  // The last hop of the day that ARRIVES at the house.
  for (let i = order.length - 1; i >= 0; i--) {
    const l = order[i];
    if (!house(l.to)) continue;
    if (house(l.from) && (!Array.isArray(l.drives) || l.drives.length <= 1)) break;
    put(l, 'last'); break;
  }
  // And the standing exception that has nothing to do with the day's shape: a
  // place somebody ticked "I report here", or the shop itself. A drive between
  // that and the house is a commute at any hour, because it is the same two
  // ends every day (a second yard, a supply house he starts at).
  for (const l of order) {
    if (Array.isArray(l.drives) && l.drives.length > 1) continue;
    if (house(l.from) && house(l.to)) continue;
    if ((house(l.from) && reports(l.to)) || (reports(l.from) && house(l.to))) {
      put(l, 'first'); put(l, 'last');
    }
  }
  // ── A COMMUTE HAS NOTHING IN IT ───────────────────────────────────────
  // If the SAME leg is both the day's first drive out of the house and its
  // last drive back to it, then the whole day is one journey: house, one or
  // more addresses nobody saved, house. Every hop of it would be refused, and
  // that is wrong twice over. It is wrong in principle, because a stop in the
  // middle is exactly what makes a trip not a commute (the same reading v2
  // had, kept here and only here); and it was wrong in fact, because the leg
  // then carried no mileage row, the rail's Save button resolves a stop's
  // coordinate off that row, and six and a half hours at an address he could
  // no longer name was the result (owner 2026-09-16: "no unsaved addresses
  // with no option to fill?").
  //
  // Single-hop legs are untouched: house straight to the yard and back is two
  // separate legs, each with nothing in it, and both are still commutes.
  for (const l of order) {
    const m = mark.get(l);
    if (m && m.first && m.last && Array.isArray(l.drives) && l.drives.length > 1) mark.delete(l);
  }
  if (!mark.size) return legs;
  return list.map((l) => {
    const m = mark.get(l);
    if (!m) return l;
    const n = Array.isArray(l.drives) ? l.drives.length : 1;
    // Which hops of this leg are refused: the opening one, the closing one, or
    // (a door-to-door drive) the only one there is.
    const segs = [];
    if (m.first) segs.push(0);
    if (m.last) segs.push(n - 1);
    return Object.assign({}, l, { commute: true, commuteSegs: segs });
  });
}

function _gdEmptyDayLegs(legs, dwells, inp, open, driving, win, fences, radiusFt) {
  const list = (legs || []);
  if (!list.length) return list;
  const { whA, whB, workDay } = _gdDayShape(inp);
  const ds = Number(inp && inp.dayStart);
  const clocks = (Array.isArray(inp && inp.clocks) ? inp.clocks : [])
    .map(c => c && { a: Number(c.start), b: Number(c.end) })
    .filter(c => c && c.a > 0 && c.b > c.a);
  const covered = (l) => clocks.some(c => Math.min(l.endTs, c.b) - Math.max(l.startTs, c.a) >= 60000);
  const inHours = (l) => workDay && ds > 0 &&
    Number(l.startTs) >= ds + whA && Number(l.endTs) <= ds + whB;
  // IT ASKS BEFORE IT DELETES, kept from the rule this replaces and named by
  // the owner himself: "except for Laurie which we now tag as family and flag
  // the question if it's work or personal." A day holding a NAMED held visit
  // still has something to ask about, and the drives either side of it are
  // part of the question, so they stay and rule 15's amber row asks. The gym
  // has no fence and nobody to name; there is no question to put to anybody,
  // which is exactly why this does not save it.
  const named = (d) => !!(d && d.fence && (d.fence.name || d.fence.clientId != null || d.fence.jobId != null));
  const asking = (dwells || []).some(d => d && d.held === true && named(d) &&
    !_gdIsBaseKind(d.kind) && d.kind !== 'office');
  return list.filter(l => !!l && (l.held !== true || covered(l) || inHours(l) || asking));
}

// ── Rule 15: a drive the day cannot vouch for is a question too ───────────
// Owner 2026-09-12, on a crew member's week: "Jack didn't work Thursday or
// Friday this last week why do we have mileage and time rows in there?"
//
// Rule 13 has asked that question about VISITS since 2026-09-04 and never
// once about the drives between them, so a held visit still produced claimed
// business miles either side of it. On his Friday: 266 minutes at Laurie
// Schonfeldt (the crew member is Jack SCHONFELDT) plus three drives to and
// from her address, 7.7 miles, all of it counted.
//
// The two ends are not symmetrical and that is the whole rule. A leg earns
// its miles from a BUSINESS END:
//   - a job fence: a job is work, whoever the client is
//   - the shop, or a supply place: a business address by definition
//   - a client whose visit that day was not itself held (rule 13 already
//     asked, and this reuses its answer rather than asking again)
// Anything else vouches for nothing: the house, a home office, and above all
// an end nobody ever saved (rule 14's `unsaved`).
//
// A manual clock running over the drive vouches for it too, same as rule 13:
// the person saying at the time that they are working outranks geography.
//
// HELD, NOT DROPPED, exactly like rule 13 and like a receipt-gated supply
// run. The row keeps its miles, its route and its place in the odometer
// story, and stays out of every money total until somebody answers. Losing
// the drive would break the log; claiming it would put a number on a tax
// return that nothing on the phone can stand behind.
function _gdHeldLegs(legs, dwells, inp, dayStart, fences, opts) {
  const heldClients = new Set();
  (dwells || []).forEach(d => {
    if (d && d.held && d.fence && d.fence.clientId != null) heldClients.add(String(d.fence.clientId));
  });
  const clocks = (Array.isArray(inp.clocks) ? inp.clocks : [])
    .map(c => c && { a: Number(c.start), b: Number(c.end) })
    .filter(c => c && c.a > 0 && c.b > c.a);
  const vouches = (e) => {
    if (!e || e.unsaved === true) return false;
    if (e.jobId != null) return true;
    if (e.kind === 'supply') return true;
    // ── A SHOP THAT IS YOUR HOUSE IS YOUR HOUSE (owner 2026-09-12) ───────
    // "How does a day with automatic drives end? Right now they can't and my
    // own account is proof."
    //
    // It couldn't, and this line is why. His shop fence sits 20 ft from his
    // home office, well inside the 600 ft radius, and the shop OUTRANKS the
    // home office, so every time he pulled into his own driveway the deriver
    // recorded an arrival at a business address. Rule 17 closes the workday at
    // the last business arrival plus the wrap, so coming home pushed the end
    // of the day out by another half hour, every time, forever. His 11
    // September: last real work at John Doe ended 17:23, and the evening that
    // followed sat inside the workday as 2h43m of on-site time.
    //
    // _gdShopIsHome has known the difference since 2026-09-04. Rule 7 asks it
    // before calling a round trip a round trip, rule 11 asks it before calling
    // a day a shift, and the live card asks it before drawing anything at all.
    // This was the one place that took `kind` at face value.
    if (e.kind === 'shop') return !_gdShopIsHome(e, fences, (opts && opts.radiusFt));
    // A client end is only as good as rule 13's answer about that visit. A
    // contact marked family does not vouch on its own: the whole point of the
    // mark is that being at that address is not evidence of work (rule 13).
    // It gets rule 13's own reprieve and no other: an open job or proposal on
    // the books is a reason to be there, so the drives come with it.
    if (e.clientId != null) {
      return (e.personal !== true || e.onBooks === true) && !heldClients.has(String(e.clientId));
    }
    return false;
  };
  return (legs || []).map(l => {
    if (!l || l.held) return l;
    // ── RULE 18: A LOOP'S TWO ENDS ARE ONE END, COUNTED TWICE ────────────
    // Owner 2026-09-13, on his 11 September: "tradedesk shop to shop can't
    // display that way so that's wrong, would have to be tradedesk shop to
    // unsaved address then unsaved address to tradedesk shop."
    //
    // He is describing the loophole in the founding rule. Section 17 opens
    // with "both ends saved or no leg," and a round trip does not violate
    // that, it SATISFIES it: rule 7 collapses the loop into one leg whose
    // from and to are the same saved fence, and the only place he actually
    // went is buried inside as a collapsed stop that nothing ever examines.
    // One business address at the kerb vouches for a trip that never reached
    // a business address at all, because the OR below reads the same fence
    // twice and finds it good both times.
    //
    // So a loop is held unless a clock covers it. Not a fourth rule stacked
    // on rules 7, 14 and 17: it is the founding rule asking the question it
    // meant to ask, which is where the trip WENT, not what it left from.
    // `unsavedVia` is already set at the point the round trip is built (rule
    // 7 and its house-loop twin) and means exactly this: the far end was
    // never saved.
    //
    // THIS UNDER-COUNTS ON PURPOSE, and the owner chose it with the trade
    // named (2026-09-13: "I don't want to ask, I want this to be fully
    // automatic when addresses are put in"). A first run to a supply house
    // nobody has saved comes back held rather than claimed. Held is not
    // deleted: the row stays on the log and on the map earning nothing, and
    // saving the address re-derives the day into two real legs. Clients are
    // always entered before anybody drives to them, so a customer is never
    // at risk; a parts store you have never saved is, and it shows up greyed
    // rather than silently.
    //
    // `business` is stamped on EVERY leg either way, held or not, because two
    // different questions were reading one flag. Rule 16 asks "did anything
    // today reach a business address", and it used to answer that by looking
    // for a leg rule 15 left alone, which was the same thing right up until
    // rule 18 started holding legs that DID touch one. Without this a day
    // whose only trip is yard -> somewhere unsaved -> yard is thrown away
    // whole rather than held, which is the opposite of what holding means.
    const business = vouches(l.from) || vouches(l.to);
    const loop = l.unsavedVia === true;
    if (!loop && business) return l.business === business ? l : Object.assign({}, l, { business });
    if (clocks.some(c => Math.min(l.endTs, c.b) - Math.max(l.startTs, c.a) >= 60000)) {
      return Object.assign({}, l, { business });
    }
    return Object.assign({}, l, { held: true, business });
  });
}

// Rule 14: the end of a traced leg that no fence could name. Shaped like a
// fence so the leg carries coordinates for the map and for the Save flow,
// and NOTHING else: no name, no address, no kind that any total could read
// as a place of business. `unsaved` is the fact every reader keys on.
function _gdUnsavedEnd(fix) {
  return { id: 'unsaved', kind: 'unsaved', name: '', addr: '', lat: Number(fix.lat), lng: Number(fix.lng), unsaved: true };
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
// ── A ROW IS KEYED BY ITS JOURNEY, NEVER BY THE STRUCTURE AROUND IT ───────
// Owner 2026-09-14: "a row's identity should not depend on a guess the app
// can change its mind about."
//
// Every automatic row names ONE journey, and a journey id is minted from the
// CoreMotion flip (who and when, _gdJourneys). That is a fact off the tape,
// not a reading of it, so the same flip mints the same id forever:
//
//   drive segment   the journey that STARTED it            'j-<uid>-<n>'
//   stop / dwell    the journey that ENDED there         'd-j-<uid>-<n>'
//   office          the fence and the window it carved   'o-<place>-<n>'
//   mileage leg     the chain's first journey (one row per leg, rule 6)
//
// WHY THIS, AND NOT THE OLD ':N' / ':sN'. Both of those indexed a row by the
// deriver's own inference: which chain a drive fell into, and how many stops
// it had decided were in front of it. Both are revisable, and both revised.
// Jack's 14 September, from the rows themselves:
//
//   14:42 derive   j-987ebc83-mu1925w4:0    drive 12:59:23 -> 13:14:01
//                  j-987ebc83-mu1925w4:s0   stop  13:14:01 -> 14:22:44
//                  j-987ebc83-mu1925w4:1    drive 14:22:44 -> 14:42:25
//   16:16 derive   j-987ebc83-mu1925w4      drive 12:59:23 -> 13:24:58
//                  d-j-987ebc83-mu1925w4    visit 13:24:58 -> 14:22:44
//                  j-987ebc83-mu1c1crh      drive 14:22:44 -> 14:42:25
//
// Three rows re-keyed for three drives nothing was wrong about. The ':1' and
// the 'mu1c1crh' rows are the SAME drive, minuted the same, named the same,
// under two keys; the sweep retired one and the day was right by luck. When
// the sweep cannot reach one (a `fixed_at` stamp, a derive with no tape) the
// old key survives as a GHOST, and his 13:14 stop sat on top of both the
// drive and the visit for the rest of the day.
//
// Under this rule both derives key that drive 'j-987ebc83-mu1925w4' and that
// stop 'd-j-987ebc83-mu1925w4', so the second derive UPDATES the first's
// rows. The stop and the visit are the same key on purpose: they are the
// same arrival, and the only difference between them is whether the place
// was saved yet. Saving the address is what turns one into the other, and it
// must not turn one row into two.
/**
 * geoSpanClaim(span, ctx) -> { claim, why }
 *
 * ONE PHONE, TWO BUSINESSES: which account may write this row.
 *
 * Owner 2026-09-10, after four of his own rows landed on the wrong company:
 * "I was at John Doe, but John Doe wasn't a client of sample co, only
 * tradedesk, so how could a mileage leg and time land there if that person
 * isn't in the system."
 *
 * They landed because nothing ever asked. Fence resolution decides a stop's
 * NAME; the OWNER of the row was whatever _geoCid() happened to be at derive
 * time. So an afternoon at a TradeDesk client, driven back to the TradeDesk
 * shop, was written to Sample Co with both ends blank, because Sample Co
 * cannot see either fence. The blanks were the evidence and nobody read them.
 *
 * The rule, in his terms: an account has no claim on a span it cannot
 * identify either end of. Since _geoDeriveFences builds only from the
 * signed-in account's own places, clients and jobs, "resolved to a fence" and
 * "owned by this account" are the same fact, which is what makes this
 * decidable without ever reading another business's data.
 *
 * WHY `shared` GATES IT. A single-account phone drives to unsaved addresses
 * constantly, and those legs are the whole point of the save-this-address
 * flow. Refusing them there would delete real work to solve a problem that
 * phone does not have. So the test only bites once more than one account has
 * claimed this device's tape inside the derive window.
 *
 * THE LADDER, for a span both accounts CAN see (the same client in both
 * books). Geography is silent there, so the tie-break is evidence, strongest
 * first:
 *   job    a job or estimate on the calendar at that fence that day. Intent,
 *          recorded before the ambiguity existed.
 *   clock  a manual clock open over the span. The person said they were
 *          working, and for whom.
 *   fence  the place is in this account's book and nothing stronger applies.
 *   hat    nothing resolved, single-account phone. Today's behaviour, kept.
 *
 * HONEST RESIDUAL, stated rather than hidden: when both accounts hold the
 * same client AND the same rung, both will claim, because neither can read
 * the other's books to break the tie. That writes a duplicate the Time Log
 * shows, which is a visible, fixable wrong answer. The failure it replaces
 * was a silent one in the wrong company's IRS log. Do not "solve" this by
 * having one account guess about the other's data; it cannot see it.
 *
 * span  a leg ({unsavedFrom, unsavedTo, from, to, startTs, endTs}) or a
 *       dwell ({fence, startTs, endTs}).
 * ctx   {shared, clocks:[{start,end}]}
 */
function geoSpanClaim(span, ctx) {
  const c = ctx || {};
  const sp = span || {};
  // A dwell is at a fence by construction: reaching one is what opens it.
  // A leg is identified when EITHER end is, because one known end is enough
  // to say whose road this was.
  const fence = sp.fence || null;
  const ends = [sp.from, sp.to].filter(Boolean);
  const identified = !!fence || ends.some(e => e && (e.clientId != null || e.jobId != null ||
    e.placeId != null || e.kind === 'shop' || e.kind === 'home_office' || e.kind === 'supply'));
  if (!identified) return { claim: !c.shared, why: c.shared ? 'none' : 'hat' };

  const scheduled = (fence && (fence.jobId != null || fence.scheduled === true)) ||
    ends.some(e => e && (e.jobId != null || e.scheduled === true));
  if (scheduled) return { claim: true, why: 'job' };

  const a = Number(sp.startTs), b = Number(sp.endTs);
  const clocked = Array.isArray(c.clocks) && a > 0 && b > a &&
    c.clocks.some(k => k && Number(k.start) < b && Number(k.end) > a);
  return { claim: true, why: clocked ? 'clock' : 'fence' };
}

// ── RULE 22: THE STOP SITS WHERE THE PHONE SAT, NOT WHERE ONE PING FELL ───
// Owner 2026-09-16: "Jack reported an issue where it tagged the house a few
// houses down they were previously at. How can we align the address better so
// the gps pings we get can center itself on a more probable address?"
//
// His 15 September, every fix inside that stop, in feet from Laurie
// Schonfeldt's saved pin:
//
//   07:59:25  748     still rolling
//   07:59:28  657
//   07:59:32  595
//   07:59:40  483
//   07:59:46  387
//   08:00:01  297     parked
//   08:01:09  296
//   08:01:34  295
//   08:15:36  295
//   08:15:38  300
//   09:04:28  250
//
// He parked and sat there for an hour, and the parked fixes agree with each
// other to within FIVE FEET. That is not noise. It is a different house, about
// 295 feet up the street, and the old 600 ft circle made her the only name in
// range, so she won.
//
// A dwell has dozens of fixes and the arrival fence was picked from exactly
// one of them: the one nearest the moment the tape flipped, which is the wake
// where iOS is most likely to hand back a cached position. The median of the
// whole stop is the better witness and costs nothing, and being a median it
// ignores the rolling-in fixes rather than being dragged by them.
//
// Two outcomes, and the second is the one that matters. A median landing on a
// DIFFERENT fence re-seats the stop there. A median landing on NO fence does
// not rename the dwell (rules 12, 13 and 20 all read d.fence and must keep a
// real one), it marks it, and geoDeriveRows writes the row as an unsaved stop:
// "Unsaved address" with the Save button, instead of the neighbour's name. A
// blank he can fill beats a wrong name he has to catch.
const _GD_RESEAT_MIN_FIXES = 3;
function _gdSpotOf(fixes, a, b, maxAccM) {
  const inside = [];
  for (const f of (fixes || [])) {
    if (!f || f.lat == null || f.lng == null || typeof f.ts !== 'number') continue;
    if (f.acc != null && Number(f.acc) > maxAccM) continue;
    if (f.ts < a || f.ts > b) continue;
    inside.push(f);
  }
  if (inside.length < _GD_RESEAT_MIN_FIXES) return null;
  const med = (nums) => {
    const v = nums.slice().sort((x, y) => x - y), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return { lat: med(inside.map(f => f.lat)), lng: med(inside.map(f => f.lng)), n: inside.length };
}
function _gdReseatDwells(dwells, fixes, fences, opts) {
  return (dwells || []).map((d) => {
    if (!d || d.open || !d.fence) return d;
    const spot = _gdSpotOf(fixes, d.startTs, d.endTs, opts.maxFixAccM);
    if (!spot) return d;
    const f = geoFenceAt(spot, fences, opts.radiusFt);
    // The spot rides along even when nothing moves, because rule 23 needs it:
    // the visits that teach a pin where it is are overwhelmingly the ones that
    // resolved correctly, and those used to return `d` untouched with the
    // middle of the stop thrown away.
    if (f && _gdSameFence(f, d.fence)) return Object.assign({}, d, { spot });
    if (f) return Object.assign({}, d, { fence: f, kind: String(f.kind || 'other'),
      name: f.name || '', reseated: true, spot });
    // Nowhere saved. Keep the fence for the rules, take the NAME off the row.
    return Object.assign({}, d, { farFromFence: true, spot });
  });
}

// ── RULE 23: A SAVED ADDRESS LEARNS WHERE IT ACTUALLY IS ──────────────────
// Owner 2026-09-16, after measuring his own account: "are we designing the
// learning pin on where the truck gets parked or where the most clusters sit
// while actively working on the house?"
//
// Neither, and that is the point. The pin is aimed at the MEASUREMENT. The
// matcher compares a stop's settled cluster against the fence, so the learned
// point has to live in the same space as that cluster or the offset comes
// straight back, smaller and harder to see. It is the same median rule 22
// already computes, remembered instead of thrown away.
//
// The numbers this is built on, from his own twenty visits to one client over
// three weeks, in feet from the saved pin: 59, 62, 62, 63, 64, 65, 67, 69, 69,
// 69, 74, 75, 77, 78, 79, 80, 80, 81, 84, 87. Mean 72, every visit inside 15
// ft of it. So there are two errors and only one of them is a problem: a
// SYSTEMATIC 72 ft, which is the gap between where the geocoder dropped the
// pin and where the truck actually sits, and a RANDOM 14 ft, which is the real
// precision. Learning the first away leaves the second, and 14 ft against a
// 60 ft lot is what separates two neighbours.
//
// THE GEOCODED ADDRESS IS NEVER TOUCHED. It is what the invoice says and what
// navigation routes to. The anchor is a second field, used only to decide
// which saved address a stop belongs to.
//
// Four guards, each against a specific way this could poison itself:
//  - ONE NAME IN RANGE. A stop whose cluster sits inside two fences teaches
//    neither. That is exactly the neighbour case, and it is the one that would
//    drag a pin onto the house next door and then keep confirming itself.
//  - IT MUST BE THE FENCE THE ROW SAYS. A re-seated or held stop teaches
//    nothing; only a visit that resolved cleanly on its own.
//  - LONG ENOUGH TO HAVE A MIDDLE. Ten minutes, on top of rule 22's three
//    fixes. A drive-by does not get a vote.
//  - NEVER FAR FROM THE PIN. A sighting past maxDriftFt is not a correction,
//    it is a different place, and averaging it in is how a pin walks away.
// And then the anchor itself needs THREE sightings agreeing within 40 ft. One
// visit never moves a pin, and the median of the agreeing ones is what lands,
// so a stray that clears every guard above still cannot shift it.
const GEO_ANCHOR = Object.freeze({
  minVisits: 3,        // one visit never moves a pin
  agreeFt: 40,         // his observed random error is 14 ft; this is generous
  keep: 10,            // sightings remembered per address
  minMs: 10 * 60000,   // a stop too short to have a cluster teaches nothing
  maxDriftFt: 150,     // past this it is a different place, not a correction
});

// Every fence containing this point, not just the winner. geoFenceAt answers
// "which one", this answers "how many", which is the ambiguity test.
function _gdFencesAt(pt, fences, radiusFt) {
  const out = [];
  if (!pt || pt.lat == null || pt.lng == null) return out;
  const r = Number(radiusFt) > 0 ? Number(radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  for (const f of (fences || [])) {
    if (!f || f.lat == null || f.lng == null) continue;
    if (_gdMiles(pt, f) * 5280 <= _gdFenceLimitFt(f, r)) out.push(f);
  }
  return out;
}

// The dwells on this day that are allowed to teach their fence where it is.
function geoAnchorSightings(dwells, fences, opts) {
  const o = opts || {};
  const r = Number(o.radiusFt) > 0 ? Number(o.radiusFt) : GEO_DERIVE_DEFAULTS.radiusFt;
  const minMs = Number(o.anchorMinMs) > 0 ? Number(o.anchorMinMs) : GEO_ANCHOR.minMs;
  const maxFt = Number(o.anchorMaxDriftFt) > 0 ? Number(o.anchorMaxDriftFt) : GEO_ANCHOR.maxDriftFt;
  const out = [];
  for (const d of (dwells || [])) {
    if (!d || d.open || !d.fence || !d.spot) continue;
    if (d.held || d.farFromFence || d.reseated || d.dismissed) continue;
    if (!(Number(d.endTs) - Number(d.startTs) >= minMs)) continue;
    const here = _gdFencesAt(d.spot, fences, r);
    if (here.length !== 1) continue;
    if (!_gdSameFence(here[0], d.fence)) continue;
    if (_gdMiles(d.spot, d.fence) * 5280 > maxFt) continue;
    out.push({ id: String(d.fence.id), lat: d.spot.lat, lng: d.spot.lng,
      ts: Number(d.startTs), n: Number(d.spot.n) || 0 });
  }
  return out;
}

// The anchor a list of sightings supports, or null while it is still learning.
function geoAnchorOf(seen, opts) {
  const o = opts || {};
  const min = Number(o.anchorMinVisits) > 0 ? Number(o.anchorMinVisits) : GEO_ANCHOR.minVisits;
  const agree = Number(o.anchorAgreeFt) > 0 ? Number(o.anchorAgreeFt) : GEO_ANCHOR.agreeFt;
  const list = (seen || []).filter(s => s && s.lat != null && s.lng != null &&
    isFinite(Number(s.lat)) && isFinite(Number(s.lng)));
  if (list.length < min) return null;
  const med = (nums) => {
    const v = nums.slice().sort((x, y) => x - y), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const pt = { lat: med(list.map(s => Number(s.lat))), lng: med(list.map(s => Number(s.lng))) };
  const near = list.filter(s => _gdMiles({ lat: Number(s.lat), lng: Number(s.lng) }, pt) * 5280 <= agree);
  if (near.length < min) return null;
  // Re-median on the agreeing ones only, so an outlier that survived the
  // filters above still contributes nothing to where the pin lands.
  return { lat: med(near.map(s => Number(s.lat))), lng: med(near.map(s => Number(s.lng))), n: near.length };
}

function geoDeriveRows(result, ids) {
  const cid = ids && ids.contractorId, uid = ids && ids.employeeId;
  const iso = ms => new Date(ms).toISOString();
  const time = [], shop = [], miles = [];
  // Whose row is this (geoSpanClaim above). Defaults keep every existing
  // caller and every existing test on the old path exactly: a phone with one
  // account claims everything it derives, as it always has.
  const claimCtx = { shared: !!(ids && ids.shared), clocks: (ids && ids.clocks) || [] };
  const held = [];
  for (const d of (result && result.dwells) || []) {
    const base = { contractor_user_id: cid, employee_user_id: uid,
      arrived_at: iso(d.startTs), departed_at: iso(d.endTs), minutes: d.minutes, client_key: d.id };
    const dClaim = geoSpanClaim(d, claimCtx);
    if (!dClaim.claim) { held.push({ kind: 'dwell', id: d.id, startTs: d.startTs, endTs: d.endTs }); continue; }
    if (d.kind === 'shop') { shop.push(base); continue; }
    const f = d.fence || {};
    time.push(Object.assign(base, {
      job_id: d.farFromFence ? null : (f.jobId != null ? String(f.jobId) : null),
      dest_place: d.farFromFence ? null : (f.jobId != null ? null : (d.name || null)),
      // No 'place-home' arm: rule 12 means a home_office dwell never reaches
      // here at all, so a branch for it would be a branch that cannot run.
      // js/timelog.js still READS 'place-home' on purpose, for the rows that
      // already carry it and for a hand-fixed one, which geo_replace_day
      // preserves across every re-derive.
      // 'client-held' is rule 13's question. The reader keeps it out of every
      // total and the dashboard asks; geo_replace_day carries the answer
      // (source, under fixed_at) across every rebuild after that.
      // A SUPPLY HOUSE IS NOT A JOB SITE (owner 2026-09-16, on the new Save
      // address chooser: "mark the timesheet as Supply House rather than
      // onsite"). It used to fall through to the bare 'place', which the
      // reader has no arm for, so a stop at Ferguson read "On site" on the
      // rail and counted as job-site labour on the split bar. The mileage side
      // already knew: a leg ending at a supply fence is a Supply run with a
      // receipt pending. Same fact, said on both screens.
      // Rule 22: the median of this stop's own fixes landed on no fence at
      // all, so the row does not borrow the name the arrival fix guessed.
      source: d.farFromFence ? 'unsaved'
        : d.kind === 'office' ? 'place-office'
        : d.held ? 'client-held'
        : (f.jobId != null ? 'geofence'
          : (f.clientId != null ? 'client'
            : (d.kind === 'supply' ? 'place-supply' : 'place'))),
    }));
  }
  for (const l of (result && result.legs) || []) {
    // NOT THIS ACCOUNT'S ROAD. A leg with neither end resolvable on a phone
    // more than one business has signed into is exactly the shape of the two
    // drives that landed on Sample Co: John Doe out, TradeDesk shop back,
    // both ends blank because that account holds neither place. Held here,
    // which leaves the stretch uncovered, and js/timelog.js already renders
    // an uncovered stretch as a question. A question beats a row in the wrong
    // company's mileage log.
    const lClaim = geoSpanClaim(l, claimCtx);
    if (!lClaim.claim) { held.push({ kind: 'leg', id: l.id, startTs: l.startTs, endTs: l.endTs }); continue; }
    // RULE 20: THE COMMUTE BILLS NOTHING, hop by hop. `commuteSegs` names which
    // driving segments of this leg are his own time: the first out of his house
    // in the morning, the last back to it at night. A leg whose every hop is
    // refused writes nothing at all; one that carries a customer stop in the
    // middle keeps the stop and loses only the hop into his driveway.
    //
    // THE MILEAGE GOES WITH IT. One mileage row covers the whole leg, at the
    // direct route between its two SAVED ends, and the house is one of those
    // ends whenever a hop is refused. There is no honest fraction of it to
    // keep: what remains ends at an address nobody saved, which rule 14
    // already refuses as a mileage endpoint.
    const commuteSegs = (l.commute === true)
      ? (Array.isArray(l.commuteSegs) ? l.commuteSegs : [0]) : [];
    const nDrives = (Array.isArray(l.drives) && l.drives.length) ? l.drives.length : 1;
    const allCommute = l.commute === true && commuteSegs.length >= nDrives;
    // ── A LEG IS ONLY EVER DROPPED WHOLE WHEN IT IS ONE DOOR-TO-DOOR HOP ──
    // Owner 2026-09-16, asking the only question that matters before a roll:
    // "no unsaved addresses with no option to fill?"
    //
    // There was one, and it was the worst shape this rule can take. A day
    // that goes house, an address nobody saved, house is ONE leg with TWO
    // hops, and both of them qualify: the first drive out of his house and
    // the last drive back to it. commuteSegs covered every hop, the leg was
    // dropped here, and six and a half hours of work at that address went
    // with it. No stop row, no Save this address button, nothing to fill in,
    // and a manual clock running over the whole thing did not save it.
    //
    // That is v1's mistake wearing a different hat, and the answer is the
    // same one: RULE 20 REFUSES A HOP, NEVER THE STOP BESIDE IT. A multi-hop
    // leg always has an interior stop, so it always falls through to the stop
    // rows below. Only the mileage row and the drive rows are refused, and
    // the mileage gate moved down beside the row it governs.
    if (allCommute && nDrives <= 1) continue;
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
      : [[l.startTs, l.endTs, (l.minutes || 0) * 60000, l.id, l.id]];
    // A segment entry is [startTs, endTs, autoMs, startJourney, endJourney].
    // The drive is keyed by the flip that began it and the stop after it by
    // the flip that ended it, which is the same id the dwell would carry if
    // that place were saved (see the identity rule at the top of this
    // section). A single-segment leg's drive key is the leg id, exactly as
    // it has always been, because the chain's first journey IS that segment.
    const segKey = sg => String((sg && sg[3]) || l.id);
    const stopKey = sg => 'd-' + String((sg && sg[4]) || l.id);
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
    // Rule 20 refuses a HOP, never the stop beside it. The refusal is applied
    // to the drive rows below and to the mileage, and deliberately NOT to
    // `segs`, because the gap between two segments is what writes the unsaved
    // stop: dropping the hop home out of this list would take the 43 minutes
    // he spent at that address with it.
    const isCommuteSeg = (sg) => {
      if (!commuteSegs.length) return false;
      const i = segsRaw.indexOf(sg);
      return i >= 0 && commuteSegs.indexOf(i) >= 0;
    };
    // ── THE TIME ROWS GET THE GATE THE MILEAGE ROWS ALREADY HAD ───────────
    // Owner 2026-09-13, on 193 minutes of his evening sitting in his hours
    // while the 11.7 miles under it stayed out of his deduction.
    //
    // Every gate built into this file protected MILEAGE. Rule 14 marks a
    // traced leg `addressUnknown` so no total claims it, rule 15 holds a leg
    // the day cannot vouch for, and rule 7 refuses a loop its miles outright.
    // None of that reached the time rows, which are pushed below with a flat
    // `source: 'drive'` and counted by every reader. Two outputs, one set of
    // gates, and time had none of them.
    //
    // One suffix carries it, because one predicate already owns what a source
    // MEANS (js/geo-track.js): `-held` is the family the reader keeps out of
    // every total, and 'client-held' has been in it since rule 13. A drive is
    // still a drive and reads as Drive time on the rail; it simply earns
    // nothing. Shown, never claimed, which is the same answer rule 14 gives
    // on the mileage side, in the same words.
    const hs = l.held === true ? '-held' : '';
    // ── EACH SEGMENT NAMES ITS OWN ENDS (owner report 2026-09-14) ─────────
    // Jack's Sunday read "JS Solutions shop to Bill Lorson" at 9:55 and then
    // again at 10:39, for the two halves of one journey that split at a stop
    // nobody saved. Neither row was that drive. The first ran shop to the
    // stop, the second stop to Bill Lorson, and the half-hour between them
    // was already sitting on the rail as its own Unsaved address row saying
    // so. The same trip, claimed three times, twice under the wrong ends.
    //
    // Nothing in this file was wrong about the DRIVE: `dest_place` above is
    // already per segment, null for one that ends at a stop. The labels came
    // from the mileage row, which is deliberately ONE row for the whole
    // collapsed leg (rule 6, the direct route through a personal stop), so
    // its from_name and to_name are the JOURNEY's ends and describe no
    // segment but a single-segment leg's. The reader had nothing else to
    // read, so it read the wrong thing.
    //
    // So the deriver says it, once, here: the ordered ends of every segment,
    // on the leg the reader already has in hand. An interior end is '' and
    // means exactly what the stop row between the two drives means, that
    // nobody saved it. The MILES are untouched: still one collapsed leg at
    // the direct route between the two saved fences, which is rule 6 and is
    // correct. Only the time rows stop borrowing labels that were never
    // theirs.
    const segEnds = segs.map((sg, i) => ({
      from: i === 0 ? (l.from.name || '') : '',
      to: i === segs.length - 1 ? (l.to.name || '') : '',
    }));
    segs.forEach((sg, i) => {
      const a = Number(sg[0]), b = Number(sg[1]);
      if (!(a > 0 && b > a)) return;
      if (isCommuteSeg(sg)) return;   // rule 20: his own time, not a drive row
      time.push({ contractor_user_id: cid, employee_user_id: uid, job_id: null,
        arrived_at: iso(a), departed_at: iso(b),
        minutes: Math.max(1, Math.round(Number(sg[2] || (b - a)) / 60000)),
        // Only the LAST segment actually reaches the destination; the ones
        // before it end at a stop nobody saved, and naming them for where he
        // eventually ended up would be the inference this rule exists to
        // avoid.
        dest_place: (i === segs.length - 1) ? (l.to.name || null) : null,
        // ── AND THE ROW NAMES WHERE IT STARTED (owner 2026-09-15) ────────
        // "The way it's titled is wrong, we should have fixed the title a
        // long time ago rather than last night."
        //
        // He is right, and the reason it took so long is the shape, not the
        // day it was noticed. A drive row has always carried only where it
        // ENDED, so a rail that wanted to say "shop to Bill Lorson" had to go
        // find the mileage leg, work out which segment this was, and read the
        // other end off THAT. Two tables to title one row. Everything that
        // followed came out of the join: the leg's from_name is the whole
        // journey's, so a split drive borrowed ends that were never its own
        // (fixed 2026-09-14 with segEnds, which is still a join); a day
        // derived before segEnds existed has nothing to read, so every one of
        // Jack's 14 September drives fell back to naming only its
        // destination, which is the report that prompted this; and a screen
        // holding time rows without mileage rows could never title them at
        // all.
        //
        // A row that describes a drive knows both of its ends. It says both.
        // Same rule as dest_place directly above, mirrored: only the FIRST
        // segment actually left the origin, and the ones after it start at a
        // stop nobody saved, which the row between them already says.
        origin_place: (i === 0) ? (l.from.name || null) : null,
        client_key: segKey(sg), source: 'drive' + hs });
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
        dest_place: null, client_key: stopKey(segs[i]), source: 'unsaved' + hs });
    }
    // A round trip writes time but never mileage (rule 7 as amended): both of
    // its endpoints are the same fence, and the place between them was never
    // saved.
    // Rule 14: a traced round trip is a row (shown, never claimed); a plain
    // same-fence loop is still nothing.
    if (l.roundTrip && !l.traced) continue;
    // Rule 20, the mileage half. Every hop of this leg is his own time, so
    // there are no business miles on it to write. The stop rows above already
    // landed, which is the whole reason this gate is here and not up with the
    // drive rows.
    if (allCommute) continue;
    // Rule 20 and the mileage row, which is ONE row for the whole leg at the
    // direct route between its two saved ends. A door-to-door commute never
    // reaches here (allCommute above dropped it). A CHAIN that merely ends at
    // his driveway does, and its miles are the day's real work with the last
    // hop riding along: shop, four customers, then home. Keeping the row
    // overstates it by that hop; dropping it would delete every business mile
    // he drove that afternoon. The row stays, and splitting mileage by hop is
    // the next change, not this one.
    // ── RULE 20 AND A CHAIN THAT ONLY PARTLY BILLS (owner 2026-09-16) ────
    // Run against his real Monday, the rule refused the last hop into his
    // driveway and then billed 4.4 miles to it anyway. One mileage row covers
    // the whole leg at the DIRECT route between its two SAVED ends, and his
    // house is one of those ends, so the row named his own driveway as a
    // business destination and charged the commute to the company.
    //
    // What he actually drove for work is the yard out to an address nobody
    // saved, and rule 14 already says what that is: a TRACED row. Breadcrumb
    // miles over the part that bills, shown on the log, claimed by nobody,
    // with a Save button that turns it into a real leg the moment he names
    // the stop. So this invents no third shape; it routes the case into the
    // one that already exists.
    const billSegs = segsRaw.filter(sg => !isCommuteSeg(sg));
    const partCommute = commuteSegs.length > 0 && billSegs.length > 0 &&
      billSegs.length < segsRaw.length;
    let cut = null;
    if (partCommute) {
      const a = Math.min.apply(null, billSegs.map(sg => Number(sg[0])));
      const b = Math.max.apply(null, billSegs.map(sg => Number(sg[1])));
      // WHICH END WENT. The refused hop is the first out of the house, the
      // last back into it, or both; whichever it was, that end of this row is
      // no longer a place he drove to on business.
      const lostFirst = isCommuteSeg(segsRaw[0]);
      const lostLast = isCommuteSeg(segsRaw[segsRaw.length - 1]);
      const via = Array.isArray(l.via) ? l.via : [];
      const stop = lostLast ? via[via.length - 1] : (lostFirst ? via[0] : null);
      // The breadcrumbs inside that window, summed. l.path is already cleaned
      // and thinned by _gdPath, so this is the same number a traced round trip
      // carries and needs no access to the raw fixes geoDeriveRows never has.
      //
      // THE STOP CLOSES THE LINE. A drive segment ends at the tape's flip to
      // onFoot and the fix that proves where he landed arrives SECONDS after
      // it, so a window that only trusts its own bounds can hold one point
      // and measure nothing. On a dense day that never shows; on a sparse one
      // the row silently vanished. The stop is where the billable part of
      // this leg actually ended, so it is the last point, always.
      const pts = (Array.isArray(l.path) ? l.path : [])
        .filter(pt => pt && pt[2] >= a && pt[2] <= b)
        .map(pt => ({ lat: pt[0], lng: pt[1] }));
      if (stop && stop.lat != null && stop.lng != null) {
        if (lostLast) pts.push({ lat: stop.lat, lng: stop.lng });
        else pts.unshift({ lat: stop.lat, lng: stop.lng });
      }
      let m = 0;
      for (let k = 1; k < pts.length; k++) m += _gdMiles(pts[k - 1], pts[k]);
      // And if even that leaves nothing to measure, the straight line between
      // the end he kept and the stop, which is the same last resort every
      // other miles branch in this file falls back to.
      if (!(m > 0) && stop) m = _gdMiles(lostLast ? l.from : l.to, stop);
      cut = {
        miles: Math.round(m * 10) / 10, milesFrom: m > 0 ? 'path' : 'none',
        startTs: a, endTs: b, lostFirst, lostLast,
        // The stop that is now this row's open end, and the coordinate its
        // Save button opens the lead form on.
        stop,
      };
      // Nothing traceable left once the commute is taken out: there is no
      // honest number to show, so there is no row. The stop rows above
      // already landed and still carry the time.
      if (!(cut.miles > 0)) continue;
    }
    miles.push(Object.assign({
      id: l.id, legKey: l.id, gps: true, date: result.day,
      from: (cut && cut.lostFirst) ? '' : (l.from.addr || l.from.name || ''),
      from_name: (cut && cut.lostFirst) ? '' : (l.from.name || ''),
      to: (cut && cut.lostLast) ? '' : (l.to.addr || l.to.name || ''),
      to_name: (cut && cut.lostLast) ? '' : (l.to.name || ''),
    }, segs.length > 1 ? {
      // The ends of each drive segment, in order (see segEnds above). Only
      // on a leg that actually split: a single-segment leg's ends ARE
      // from_name and to_name, and the rail already reads those.
      segEnds,
      // WHICH ROW IS WHICH SEGMENT. The rail row for a segment carries that
      // segment's own journey id, which no longer says the leg's id out
      // loud, so the leg says the segments' ids instead: same order as
      // segEnds, and how a drive row finds the trip it belongs to
      // (_mileLegSeg, js/mileage.js). One list, read by both screens.
      segKeys: segs.map(segKey),
    } : {}, l.traced ? {
      // THE ROW IS SHOWN, THE MILES ARE NOT CLAIMED (owner 2026-09-08: "only
      // things with addresses saved should update any totals"). Every total
      // in the app goes through addressedTrips (js/mileage.js), which drops
      // this flag; the row itself stays on the log and the map so the drive
      // is not a hole in the day. Which end is missing is named so the Save
      // button knows what it is saving, and a round trip through an unsaved
      // stop says `via`. Saving the address re-derives the day and the real
      // leg lands under this same id.
      addressUnknown: true,
      unsavedFrom: !!l.unsavedFrom, unsavedTo: !!l.unsavedTo, unsavedVia: !!l.unsavedVia,
    } : {}, (Array.isArray(l.via) && l.via.length) ? Object.assign({
      // WHERE HE ACTUALLY STOOD, in order, one per held stop. Carried on
      // EVERY leg that has them, not only a traced one: a leg that collapsed
      // through a stop and then reached a saved fence still leaves that stop
      // on the Time Log rail, and the Save button there needs somewhere to
      // send the lead form. The rail's row is keyed ':sN' against this same
      // leg (see the stop rows above), so N indexes straight into this.
      // `key` is the stop row's own client_key on the Time Log rail, so the
      // Save button matches on it instead of counting positions: a leg drops
      // an interior segment too short to be a drive, and a count would then
      // name the wrong stop.
      viaStops: l.via.map(v => ({ lat: v.lat, lng: v.lng, at: iso(v.ts), key: v.key || '' })),
    }, l.unsavedVia ? {
      // The MILEAGE row's own Save button and the stamp beside its "Unsaved
      // address": a round trip's two ends are the same fence, so the stop is
      // the only thing on it worth saving (owner 2026-09-09).
      viaCoord: { lat: l.via[0].lat, lng: l.via[0].lng }, viaIso: iso(l.via[0].ts),
    } : {}) : {}, {
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
    }, l.held ? {
      // ── RULE 15: nothing vouched for this drive ────────────────────────
      // Held, not dropped: the row keeps its miles, its route and its place
      // in the odometer story, and stays out of every money total until
      // somebody answers. The same shape a receipt-gated supply run has used
      // since 2026-08-17, and the same choke point reads both
      // (deductibleTrips / reimbursableTrips, js/mileage.js).
      //
      // The purpose is emptied deliberately. 'Business' was the fallback for
      // a destination the deriver could not name, which is precisely the
      // drive it has no standing to label.
      pendingPurpose: true, purpose: '',
    } : {}, l.to.kind === 'supply' ? {
      // THE RECEIPT IS THE PROOF, NOT THE DESTINATION (owner design
      // 2026-08-17, and owner 2026-09-05: "the receipt thing didn't stay
      // alive from my Home Depot run"). A leg that ends at a supply place is
      // HELD until the dashboard card gets its answer: scan the receipt, no
      // receipt, or personal. The engine used to set this; the one-writer
      // rewrite (2959bb3) deleted the engine and nothing set it again, so his
      // 28 August Home Depot leg landed as a plain Supply run and the card
      // never showed. The key is what the card groups visits by.
      pendingReceipt: true, supplyRunKey: String(result.day || '') + '|' + (l.to.name || 'Store'),
    } : {}, l.traced ? {
      // Named as what it is, so the log and the map can say "traced" rather
      // than pretending a breadcrumb sum is a routed distance.
      calc_method: 'derived-traced', gpsMiles: l.miles,
    } : {}, cut ? {
      // ── AND THE ROW AS IT ACTUALLY IS, ONCE THE COMMUTE IS TAKEN OUT ────
      // Last, so it overrides every field above that was computed from the
      // whole leg. It is the rule-14 shape exactly: breadcrumb miles over the
      // part that bills, named traced, address unknown at the end that went,
      // and out of every money total (pendingPurpose) until he saves the
      // stop. Saving it re-derives the day and the real leg lands under this
      // same id, which is what makes this recoverable rather than a write-off.
      miles: cut.miles, gpsMiles: cut.miles, calc_method: 'derived-traced',
      traced: true, addressUnknown: true,
      unsavedFrom: !!cut.lostFirst, unsavedTo: !!cut.lostLast, unsavedVia: false,
      startedIso: iso(cut.startTs), endedIso: iso(cut.endTs),
      loggedAt: iso(cut.startTs), created_at: iso(cut.startTs),
      mins: Math.max(1, Math.round((cut.endTs - cut.startTs) / 60000)),
      path: (Array.isArray(l.path) ? l.path : []).filter(pt => pt && pt[2] >= cut.startTs && pt[2] <= cut.endTs),
      // The open end is the STOP, not the house he was refused for driving
      // to, so the Save button opens the lead form where he actually stood.
      // toCoord and fromCoord are what _mileSaveAddress reads.
      toCoord: (cut.lostLast && cut.stop) ? { lat: cut.stop.lat, lng: cut.stop.lng } : { lat: l.to.lat, lng: l.to.lng },
      fromCoord: (cut.lostFirst && cut.stop) ? { lat: cut.stop.lat, lng: cut.stop.lng } : { lat: l.from.lat, lng: l.from.lng },
      // Nothing at the open end to resolve a purpose or a client against.
      pendingPurpose: true, purpose: '',
      _to: cut.lostLast ? { kind: '', clientId: null, jobId: null, placeId: null }
        : { kind: l.to.kind, clientId: l.to.clientId, jobId: l.to.jobId, placeId: l.to.placeId },
      client_id: cut.lostLast ? null : (l.to.clientId != null ? l.to.clientId : null),
      client_name: cut.lostLast ? '' : (l.to.clientId != null ? (l.to.name || '') : ''),
    } : {}));
  }
  // `held` is the spans this account declined, so the caller can say so
  // rather than the day quietly coming up short. Never written anywhere: the
  // whole point is that this account has no standing to write them.
  // ── THE ARRIVAL IS A FACT THE MOMENT IT HAPPENS (owner 2026-09-18) ────────
  // "I just want all the mileage and time sheets to show in real time server
  // side, arrivals on site, current time on site and when you drive and leave."
  //
  // Until now a dwell became a row only once it had BOTH ends, so a man four
  // hours into a job had no row at all and the timesheet ran permanently one
  // event behind the truck. That was never a rule about what is true, only
  // about what got stored: the deriver has always known who is on site and
  // since when (`result.open`), and has always thrown it away at this line.
  //
  // So the open dwell gets a row shaped exactly like the closed one, with the
  // two fields it genuinely does not have left NULL. A reader shows it as
  // running rather than as a number, which is the same call the yard row takes
  // (CLAUDE.md 18.2, and the owner's "show it, marked not final").
  //
  // It is returned SEPARATELY rather than pushed into job_time_entries, and
  // that is deliberate: geo_replace_day's overlap invariant builds a tstzrange
  // per row, and an unbounded upper bound overlaps everything after it. The
  // writer has to opt in knowingly. Until it does, this array is the shape
  // waiting for it and changes nothing for any existing caller.
  //
  // `counts` is the deriver's own answer to "would this bill if it closed
  // now" (_gdOpenCounts). A man standing in his own kitchen is on the map and
  // is not on the clock, and this reuses that judgement rather than making a
  // second one.
  const open = [];
  const _o = result && result.open;
  if (_o && _o.counts !== false && Number(_o.startTs || _o.sinceTs) > 0) {
    const _of = _o.fence || {};
    const _oid = _o.id || (_o.journeyId != null ? 'd-' + String(_o.journeyId) : null);
    if (_oid) {
      const _orow = { contractor_user_id: cid, employee_user_id: uid,
        arrived_at: iso(Number(_o.startTs || _o.sinceTs)),
        departed_at: null, minutes: null, client_key: String(_oid) };
      if (String(_o.kind) === 'shop') open.push(Object.assign(_orow, { _table: 'shop_time_entries' }));
      else open.push(Object.assign(_orow, {
        _table: 'job_time_entries',
        job_id: _of.jobId != null ? String(_of.jobId) : null,
        dest_place: _of.jobId != null ? null : (_o.name || null),
        source: 'open',
      }));
    }
  }

  return { job_time_entries: time, shop_time_entries: shop, td_mileage: miles, held, open };
}

export { geoDeriveDay, geoDeriveRows, geoFenceAt, geoSpanClaim };
