// ── THE ON-SITE CARD, DECIDED ONCE, FOR BOTH RUNTIMES ──────────────────────
//
// Owner 2026-09-16: "live activities, if I'm in the ops portal it doesn't
// update live when I go to drive, how can we make live activities
// bulletproof?"
//
// It did not update because the card is published at the end of a derive
// (_geoOpenDwellPublish, js/geo-track.js) and a derive is refused outright
// while a support view is open, so the phone never got as far as saying
// anything. That guard is right: in ops view the clients and places arrays
// hold the OTHER account's records, so a derive there would name his stops
// after their customers. The answer is not to weaken it, it is to stop the
// lock screen depending on the app being on the right screen at all.
//
// The server already derives on every flush (derive-day.mjs) and already has
// a door that changes a card with the app closed (update-live-activity). This
// is the rule that connects them, and it is deliberately a SEPARATE, PURE
// file for the same reason js/geo-derive.js is: two runtimes drawing one card
// must not each hold their own opinion of what it says. js/live-activity.js
// (_liveActOnSite) is the other implementation of exactly this, and
// tests/e2e-live-card.spec.js holds the two to the same answers.
//
// ── WHAT THE SERVER CANNOT DO, STATED HERE SO NOBODY REDISCOVERS IT ───────
// ActivityKit refuses Activity.request() from a backgrounded app. A card can
// only be BORN in the foreground; that is an iOS rule, not ours, and it is
// already documented in js/live-activity.js (_liveActForeground). So the
// server may UPDATE a card that is up and END one, and it can never put one
// up. A drive that starts with no card showing still shows nothing until the
// app is next opened.

// The tints js/live-activity.js uses, by the same names. Copied rather than
// imported because that file is a browser script, and kept in one object so a
// change to either is a one-line diff in a test.
// The tints js/live-activity.js uses, by the same names. Copied rather than
// imported because that file is a browser script, and kept in one object so a
// change to either is a one-line diff in a test.
export const LIVE_TINT = Object.freeze({ onsite: "#F2A93B", drive: "#0085E7" });

// ── ONE CARD, THE SHAPE OF THE DAY RAIL (owner 2026-09-21) ─────────────────
//
// "I want a new one to throw down though, it mirrors the day rail."
//
// There used to be two cards and they could not both be right. 'onsite' was
// server-driven and knew where he was standing; 'drive' was phone-driven and
// knew the mileage tally, which only the phone has. So the lock screen said
// nothing at all for the whole drive whenever the app was asleep, which is
// most of every drive. Two cards, two owners, two ways to be stale, and the
// Dynamic Island only shows two at once with the clock card already holding
// one of them.
//
// One card now, and it says whatever the day rail's live row says: driving,
// or on site, or nothing. The words come from the server on every motion
// flip, so they are right with the app shut; the phone overlays the running
// miles when it happens to be awake. `value` is deliberately NOT part of
// liveCardSig below, so the phone's mileage overlay and the server's word
// push never fight over the same card.
//
// `rail` is the deriver's own output, narrowed: {open, pending}. open is the
// dwell he is standing in; pending is the chain he is still driving. They are
// the same two facts the Time Log's live row reads, which is what makes this
// a mirror rather than a second opinion.
export function railCardFor(rail, opts) {
  const o = (opts || {});
  const end = { channel: "rail", event: "end", state: {} };
  const r = rail || {};
  const d = r.open || null;
  const p = r.pending || null;

  // ── ON SITE, and it outranks the drive ────────────────────────────────
  // A dwell is a place he is standing; a pending chain is a drive that has
  // not closed yet. When the deriver hands back both, the dwell is the newer
  // fact and the one worth a card.
  // NOT COUNTED IS NOT A TIMER (owner 2026-09-24, rule 25). On a Time off day
  // the deriver says the stop earns nothing, and a clock running up from the
  // arrival reads as hours. It falls through to the drive, like the phone's
  // twin; home keeps its own answer inside.
  if (d && Number(d.sinceTs) > 0 && (d.atHome || d.counts !== false)) {
    // HOME IS NOT A CARD (owner 2026-09-03: "I need it to go away or be very
    // small, right now it's wasted space running when I'm home and done
    // working"). The deriver answers this, not this file: a home office and a
    // shop at one address are two fences and the shop outranks the home
    // office, so the dwell at his own house arrives here as kind 'shop' with
    // atHome set.
    if (d.atHome) return end;
    // A person CLOCKED IN already has the green clock card carrying the site
    // clock, and the island shows two cards at most, so the ON SITE face
    // yields rather than stacking a second timer for the same spot. The
    // DRIVING face below does NOT yield: "clocked in" and "on the road" are
    // two different facts and neither says the other.
    if (o.clockCardUp) return end;
    const since = Number(d.sinceTs);
    const kind = String(d.kind || "");
    const where = String(d.name || "") || (kind === "shop" ? "The shop" : "On site");
    const addr = (d.fence && d.fence.addr) ? String(d.fence.addr) : "";
    let arrived = "";
    try {
      arrived = new Intl.DateTimeFormat("en-US", {
        timeZone: o.tz || "America/Chicago", hour: "numeric", minute: "2-digit",
      }).format(new Date(since));
    } catch { arrived = ""; }
    const detail = (addr && addr !== where) ? addr : (arrived ? "Arrived " + arrived : "");
    return {
      channel: "rail",
      event: "update",
      state: {
        kind: kind === "shop" ? "AT THE SHOP" : "ON SITE",
        title: where,
        detail,
        // The miles the phone last put on this card, carried across so a word
        // push at an arrival does not blank a number the phone cannot
        // immediately replace. Empty from the server, which has none.
        value: String(o.value || ""),
        timer: true,
        startedAt: Math.floor(since / 1000),
        tint: LIVE_TINT.onsite,
      },
    };
  }

  // ── DRIVING ────────────────────────────────────────────────────────────
  // The engine tracks an ORIGIN, not a destination, so promising a
  // destination here would be inventing one and the lock screen and the app
  // would disagree the moment the guess was wrong. Same words the dashboard's
  // DRIVING banner uses.
  if (p && Number(p.startTs) > 0) {
    const org = (p.origin && p.origin.name) ? String(p.origin.name) : "";
    return {
      channel: "rail",
      event: "update",
      state: {
        kind: "DRIVING",
        title: "On the road",
        detail: org ? ("From " + org) : "Mileage is logging",
        // Only the phone can fill this: road miles come from a router on the
        // handset. The server ships the words and leaves the number alone.
        value: String(o.value || ""),
        timer: true,
        startedAt: Math.floor(Number(p.startTs) / 1000),
        tint: LIVE_TINT.drive,
      },
    };
  }

  return end;
}

// What makes this card DIFFERENT from the last one pushed. The start instant
// and the words, nothing else: the timer ticks on the phone, so re-pushing an
// unchanged card every thirty seconds would spend APNs budget and battery to
// say what the card is already saying.
//
// `value` is left out ON PURPOSE (owner 2026-09-21). It is the mileage tally,
// which only the phone can compute, so it changes constantly and the server
// can never match it. Including it would make every server push look like a
// change and re-blank the number the phone just wrote.
export function liveCardSig(card) {
  const c = card || {};
  const s = c.state || {};
  return [c.event || "", s.kind || "", s.title || "", s.detail || "",
    String(s.startedAt || 0)].join("|");
}

// ── EVERY FIELD, EVERY PUSH, ONE LIST ──────────────────────────────────────
// ActivityKit's Codable decode fails SILENTLY if one key is missing from a
// content-state, and the push is dropped with no visible error anywhere. That
// gotcha is documented in three places already (js/live-activity.js, the Swift
// attributes, update-live-activity), which is three places for the list to
// drift the next time TdLiveAttributes.ContentState gains a field. This is the
// list, once. Add a field to the Swift struct, add it here, and every sender
// ships it.
export function liveContentState(state) {
  const st = (state && typeof state === "object") ? state : {};
  const startedAt = Number(st.startedAt) || Math.floor(Date.now() / 1000);
  return {
    kind: String(st.kind ?? ""),
    title: String(st.title ?? "").slice(0, 60),
    detail: String(st.detail ?? "").slice(0, 60),
    value: String(st.value ?? ""),
    timer: !!st.timer,
    startedAt,
    siteStartedAt: Number(st.siteStartedAt) || startedAt,
    dualTimer: !!st.dualTimer,
    tint: String(st.tint ?? "#2D5DA8"),
    jobId: String(st.jobId ?? ""),
    contractorUserId: String(st.contractorUserId ?? ""),
    loggedByUid: String(st.loggedByUid ?? ""),
    currentScopeId: String(st.currentScopeId ?? ""),
    nextScopeId: String(st.nextScopeId ?? ""),
    nextScopeLabel: String(st.nextScopeLabel ?? ""),
    isLastScope: st.isLastScope !== undefined ? !!st.isLastScope : true,
    scopeQueue: String(st.scopeQueue ?? "[]"),
    supaBaseUrl: String(st.supaBaseUrl ?? ""),
  };
}
