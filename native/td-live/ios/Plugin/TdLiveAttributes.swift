import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

// The shape of a TradeDesk Live Activity. Compiled into BOTH the app (via the
// TdLive pod) and the widget extension (the ruby target script copies this same
// file in), because ActivityKit matches an activity to its widget by this type.
//
// DUMB BY DESIGN (CLAUDE.md 3.2). Every field is a finished string JS already
// formatted, plus one epoch. Swift decides nothing: not the wording, not the
// units, not when it appears, not what counts as driving. That is the whole
// reason the geo thresholds and copy stay tunable through a UAT roll instead of
// costing a 15-minute macOS build every time a word changes.
//
// The ONE exception is startedAt, and it earns it: SwiftUI's Text(timerInterval:)
// ticks a clock on-device, every second, with the app closed and zero updates
// pushed. Sending a new string every second instead would drain the battery and
// hit ActivityKit's update budget within minutes.
@available(iOS 16.1, *)
public struct TdLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Small all-caps line: "DRIVING", "CLOCKED IN".
        public var kind: String
        /// The headline: the client or job this is about.
        public var title: String
        /// Supporting line under the title. Empty hides it.
        public var detail: String
        /// The right-hand readout when there is no running timer ("12.4 mi").
        /// Ignored while `timer` is true.
        public var value: String
        /// True = render a live counting clock from `startedAt` instead of `value`.
        public var timer: Bool
        /// Epoch seconds the clock counts up from. While `dualTimer` is true this
        /// is the CURRENT STEP's clock (resets on every scope switch); otherwise
        /// it's the one and only clock (the drive card, or clock cards before
        /// dual-timer existed). Only read when `timer` is true.
        public var startedAt: Double
        /// Epoch seconds the crew arrived on THIS SITE (the earliest clock-in for
        /// this job today), stable across scope switches within the same visit.
        /// Only read when `dualTimer` is true; defaults to `startedAt` so an
        /// older JS payload that never sends it still renders one sane clock.
        public var siteStartedAt: Double
        /// True = render TWO ticking clocks ("on site" total + "this step"),
        /// false = the single clock (or static `value`) exactly as before. Only
        /// ever true for the CLOCKED IN card; JS decides, Swift just obeys, same
        /// as `timer` (CLAUDE.md 3.2, nothing here interprets `kind`).
        public var dualTimer: Bool
        /// Accent color as a hex string ("#2D5DA8"). JS owns the palette.
        public var tint: String

        // ── Lock-screen "Next" / "Clock out" button fields (owner 2026-08-19) ──
        // Everything TdLiveNextScopeIntent (TdLiveWidget.swift) needs to act
        // with the app closed: which job, which account, who's clocked in,
        // and what's next, all embedded here so the button never fetches
        // anything before it can act. The `init` defaults below (empty
        // strings, isLastScope true = no button to show) only cover Swift
        // code that constructs a ContentState directly (stateFrom(call) in
        // TdLivePlugin.swift for a caller that omits one); they do NOT excuse
        // js/live-activity.js from sending every field on every update, this
        // struct's plain Codable synthesis still fails the WHOLE decode if
        // ActivityKit itself deserializes a payload missing a key, same
        // gotcha this file's header comment already documents for every
        // field above.
        /// The job this clock card is for.
        public var jobId: String
        /// The account (js/data.js _effectiveUid()), scopes the server write.
        public var contractorUserId: String
        /// The actual person clocked in. "" means the owner (matches
        /// js/jobs.js _tlLoggedByInfo's null-means-owner convention).
        public var loggedByUid: String
        /// The scope id currently active (mirrors ContentState.detail's label).
        public var currentScopeId: String
        /// The scope id "Next" advances to. "" means there is none: the
        /// button should read "Clock out" instead (see isLastScope).
        public var nextScopeId: String
        public var nextScopeLabel: String
        /// True once nextScopeId is empty: the button's label/action switch
        /// from "Next" to "Clock out". Sent explicitly rather than derived
        /// from nextScopeId.isEmpty in the view, so a future field never has
        /// to remember this exact derivation in two places.
        public var isLastScope: Bool
        /// Every scope AFTER nextScopeId, JSON-encoded ("[{"id":"...",
        /// "label":"..."}, ...]"), so a device can tap Next repeatedly with
        /// the app closed the whole time: each tap's local optimistic update
        /// pops this queue by one instead of needing a round trip just to
        /// learn what's next. A flat String, not a nested Codable array, on
        /// purpose: a malformed string just parses to an empty queue (falls
        /// back to "last scope"), where a strict array field failing to
        /// decode risks the WHOLE ContentState decode failing silently
        /// (this file's own documented ActivityKit gotcha).
        public var scopeQueue: String
        /// Whichever Supabase base URL the phone was using when this update
        /// was sent (direct or the /api proxy fallback, js/cloud.js
        /// SUPA_URL), so the button's request follows the same self-healing
        /// routing the app itself uses instead of a hardcoded URL that could
        /// drift out of sync with cloud.js's.
        public var supaBaseUrl: String

        public init(kind: String, title: String, detail: String, value: String,
                    timer: Bool, startedAt: Double, siteStartedAt: Double = 0,
                    dualTimer: Bool = false, tint: String,
                    jobId: String = "", contractorUserId: String = "",
                    loggedByUid: String = "", currentScopeId: String = "",
                    nextScopeId: String = "", nextScopeLabel: String = "",
                    isLastScope: Bool = true, scopeQueue: String = "[]",
                    supaBaseUrl: String = "") {
            self.kind = kind
            self.title = title
            self.detail = detail
            self.value = value
            self.timer = timer
            self.startedAt = startedAt
            self.siteStartedAt = siteStartedAt > 0 ? siteStartedAt : startedAt
            self.dualTimer = dualTimer
            self.tint = tint
            self.jobId = jobId
            self.contractorUserId = contractorUserId
            self.loggedByUid = loggedByUid
            self.currentScopeId = currentScopeId
            self.nextScopeId = nextScopeId
            self.nextScopeLabel = nextScopeLabel
            self.isLastScope = isLastScope
            self.scopeQueue = scopeQueue
            self.supaBaseUrl = supaBaseUrl
        }
    }

    /// Fixed for the life of the activity. Only used to tell two concurrent
    /// activities apart (a drive and a clocked-in job can both be live).
    public var channel: String

    public init(channel: String) {
        self.channel = channel
    }
}

// Hex to SwiftUI Color lives here so the app and the widget parse it the same
// way. Unparseable falls back to a neutral so a typo in JS can never render an
// invisible activity.
public func tdLiveHexComponents(_ hex: String) -> (Double, Double, Double) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return (0.18, 0.36, 0.66) }
    return (Double((v >> 16) & 0xFF) / 255.0,
            Double((v >> 8) & 0xFF) / 255.0,
            Double(v & 0xFF) / 255.0)
}
