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
export const LIVE_TINT = Object.freeze({ onsite: "#F2A93B" });

// The card an open dwell asks for, or an 'end' when it asks for none.
// `open` is the deriver's own open-dwell shape: {name, kind, sinceTs, atHome,
// fence:{addr}}. Returns {channel, event, state} and never null, so a caller
// that pushes on change never has to decide what "no card" means.
export function liveCardFor(open, opts) {
  const o = (opts || {});
  const end = { channel: "onsite", event: "end", state: {} };
  const d = open || null;
  if (!d) return end;
  // HOME IS NOT A CARD (owner 2026-09-03: "I need it to go away or be very
  // small, right now it's wasted space running when I'm home and done
  // working"). The deriver answers this, not this file: a home office and a
  // shop at one address are two fences and the shop outranks the home office,
  // so the dwell at his own house arrives here as kind 'shop' with atHome set.
  if (d.atHome) return end;
  const since = Number(d.sinceTs);
  if (!(since > 0)) return end;
  // A person CLOCKED IN already has the green clock card carrying the site
  // clock, and the island shows two cards at most, so the on-site card yields
  // rather than stacking a second timer for the same spot. The phone knows
  // this from _liveLast.clock; the server is told by the caller.
  if (o.clockCardUp) return end;

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
    channel: "onsite",
    event: "update",
    state: {
      kind: kind === "shop" ? "AT THE SHOP" : "ON SITE",
      title: where,
      detail,
      timer: true,
      startedAt: Math.floor(since / 1000),
      tint: LIVE_TINT.onsite,
    },
  };
}

// What makes this card DIFFERENT from the last one pushed. The arrival instant
// and the words, nothing else: the timer ticks on the phone, so re-pushing an
// unchanged card every thirty seconds would spend APNs budget and battery to
// say what the card is already saying.
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
