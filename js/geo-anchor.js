// ── RULE 23, THE RECORD HALF: a saved address learns where it actually is ──
//
// Owner 2026-09-16, after we measured his own account: "the persons address
// should go off the maintenance pings we get when hes truly on site, thats
// where we pull the differentior."
//
// js/geo-derive.js holds the RULES (CLAUDE.md 17): which stops are allowed to
// teach (geoAnchorSightings) and what those sightings add up to (geoAnchorOf).
// Both are pure. This file is the only thing that reads and writes records,
// and it does nothing a rule did not already decide.
//
// WHAT IS STORED, and where, and why it is two fields and not one:
//   rec.lat / rec.lon     the geocoded address. NEVER TOUCHED. It is what the
//                         invoice says, what navigation routes to, and what
//                         the customer would recognise.
//   rec.anchorSeen[]      the last GEO_ANCHOR.keep clean sightings, each the
//                         median of one visit's settled pings.
//   rec.anchor            {lat,lng,n,at}: the median of the agreeing ones,
//                         used ONLY to decide which saved address a stop
//                         belongs to (js/geo-track.js, _geoDeriveFences).
//
// Clients and places only. A job fence is temporary and a job that outlives
// its dates has nothing to learn for; the built-in Settings shop has no record
// to carry the field, and _migrateShopToPlaces already lifts it into a real
// place row, which does.
//
// ONLY ON YOUR OWN ACCOUNT. A crew phone deriving its day at the employer's
// client would be writing to the employer's client record, which RLS may
// refuse and which would in any case let one device's habits rewrite another
// business's addresses. The employer's own phone learns the same addresses
// from its own visits.

// Which record a fence id belongs to, or null for the kinds that never learn.
function _geoAnchorRecFor(fenceId) {
  const id = String(fenceId || '');
  try {
    if (/^client-/.test(id) && typeof clients !== 'undefined' && Array.isArray(clients)) {
      const key = id.slice(7);
      return clients.find(c => c && String(c.id) === key) || null;
    }
    if (/^place-/.test(id) && typeof places !== 'undefined' && Array.isArray(places)) {
      const key = id.slice(6);
      return places.find(p => p && String(p.id) === key) || null;
    }
  } catch (_e) { }
  return null;
}

// The point a fence should actually stand on: the learned anchor when there is
// one, otherwise the geocoded pin. One function, so the fence builder and any
// screen that wants to explain itself read the same answer.
function _geoAnchorPoint(rec) {
  if (!rec) return null;
  const a = rec.anchor;
  if (!a || a.lat == null || a.lng == null) return null;
  const la = Number(a.lat), ln = Number(a.lng);
  if (!isFinite(la) || !isFinite(ln)) return null;
  return { lat: la, lng: ln, n: Number(a.n) || 0 };
}

// Is this device allowed to teach this account's addresses? (See the header.)
function _geoAnchorMayWrite() {
  try {
    if (typeof _geoViewingSomebodyElse === 'function' && _geoViewingSomebodyElse()) return false;
    if (typeof _supaUser === 'undefined' || !_supaUser) return false;
    if (typeof _geoCid === 'function' && String(_geoCid()) !== String(_supaUser.id)) return false;
  } catch (_e) { return false; }
  return true;
}

// ONE SIGHTING PER ADDRESS PER DAY. A day derives many times over (the live
// flip, the half-hourly ping, the boot rebuild), and without this the same
// visit would be counted as ten agreeing visits and satisfy minVisits on its
// own, which is precisely the "one visit never moves a pin" guard being
// defeated by the machinery rather than by evidence.
//
// The key is the BUSINESS day, the same one the deriver keys its rows on, and
// never a UTC one: an evening stop in Central is tomorrow in UTC, so a UTC key
// would file two evening visits under two different days and let one visit
// count twice. tests/e2e-utils-exhaustive.spec.js bans the UTC idiom in app
// source outright, and it caught this on the first push.
function _geoAnchorDayKey(ts) {
  const ms = Number(ts) || Date.now();
  try {
    if (typeof _geoDayKeyOf === 'function') return _geoDayKeyOf(ms, (typeof _geoBizTz === 'function') ? _geoBizTz() : null);
  } catch (_e) { }
  try { if (typeof dateKey === 'function') return dateKey(new Date(ms)); } catch (_e) { }
  return '';
}

// Fold this day's clean sightings into the records they belong to. Returns the
// number of records whose anchor actually moved, so a caller can tell whether
// the fence list is now stale. Never throws: a learning pass failing must
// never take a derive with it.
function geoAnchorRecord(res, fences, opts) {
  let moved = 0;
  try {
    if (!res || !_geoAnchorMayWrite()) return 0;
    if (typeof geoAnchorSightings !== 'function' || typeof geoAnchorOf !== 'function') return 0;
    const seenNow = geoAnchorSightings(res.dwells, fences, opts || {});
    if (!seenNow.length) return 0;
    const keep = (typeof GEO_ANCHOR !== 'undefined' && GEO_ANCHOR.keep) || 10;
    let dirty = false;
    for (const s of seenNow) {
      const rec = _geoAnchorRecFor(s.id);
      if (!rec) continue;
      const day = _geoAnchorDayKey(s.ts);
      // No day key, no sighting. An empty key would file every visit under one
      // name and turn the once-per-day guard into the opposite of itself.
      if (!day) continue;
      const list = Array.isArray(rec.anchorSeen) ? rec.anchorSeen.slice() : [];
      const at = list.findIndex(x => x && x.d === day);
      const row = { d: day, lat: s.lat, lng: s.lng, n: s.n };
      // A re-derive of the same day REPLACES that day's sighting rather than
      // adding one: the later run saw more of the stop, so it is the better
      // reading of the same visit, not a second visit.
      if (at >= 0) {
        const was = list[at];
        if (was && was.lat === row.lat && was.lng === row.lng) continue;
        list[at] = row;
      } else list.push(row);
      list.sort((a, b) => String(a.d).localeCompare(String(b.d)));
      while (list.length > keep) list.shift();
      rec.anchorSeen = list;
      const next = geoAnchorOf(list, opts || {});
      const prev = rec.anchor || null;
      const same = (!prev && !next) || (prev && next && prev.lat === next.lat && prev.lng === next.lng);
      if (next) rec.anchor = { lat: next.lat, lng: next.lng, n: next.n, at: new Date().toISOString() };
      else if (prev) delete rec.anchor;
      if (!same) moved++;
      dirty = true;
    }
    if (dirty && typeof saveAll === 'function') saveAll();
  } catch (_e) { return moved; }
  return moved;
}
