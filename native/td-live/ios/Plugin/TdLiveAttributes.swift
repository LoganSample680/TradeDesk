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
        /// Epoch seconds the clock counts up from. Only read when `timer` is true.
        public var startedAt: Double
        /// Accent color as a hex string ("#2D5DA8"). JS owns the palette.
        public var tint: String

        public init(kind: String, title: String, detail: String, value: String,
                    timer: Bool, startedAt: Double, tint: String) {
            self.kind = kind
            self.title = title
            self.detail = detail
            self.value = value
            self.timer = timer
            self.startedAt = startedAt
            self.tint = tint
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
