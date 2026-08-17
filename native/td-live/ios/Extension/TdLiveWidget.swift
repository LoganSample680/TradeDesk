import SwiftUI
import WidgetKit
import ActivityKit

// The drawing half of TradeDesk's Live Activities: the lock-screen card and the
// Dynamic Island. Runs in its own extension process, which is why the shared
// TdLiveAttributes.swift is copied in beside this file at build time.
//
// This file is LAYOUT ONLY, on purpose (CLAUDE.md 3.2). Every string it shows
// arrives finished from JS: the app decides that a drive is happening, what to
// call it, and what the readout says. Changing a word here would cost a
// 15-minute macOS build and a TestFlight update on every tester's phone;
// changing it in JS is a UAT roll. So nothing here interprets anything.
//
// The single exception is the clock. Text(timerInterval:) ticks on-device with
// the app closed and no updates spent, so a running job timer costs nothing.
// Pushing a new string every second would drain the battery and blow through
// ActivityKit's update budget in minutes.

@available(iOS 16.1, *)
private func tint(_ hex: String) -> Color {
    let (r, g, b) = tdLiveHexComponents(hex)
    return Color(red: r, green: g, blue: b)
}

// The right-hand readout: a live clock when JS asked for one, otherwise the
// finished string it sent ("12.4 mi"). Same component on the lock screen and in
// the expanded island so the two can never drift apart.
@available(iOS 16.1, *)
private struct Readout: View {
    let state: TdLiveAttributes.ContentState
    var size: CGFloat = 22

    var body: some View {
        Group {
            if state.timer {
                Text(
                    timerInterval: Date(timeIntervalSince1970: state.startedAt)...Date.distantFuture,
                    countsDown: false
                )
                // Monospaced digits or the whole card twitches sideways every
                // second as glyph widths change. On a lock screen that reads as
                // a broken app.
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
            } else {
                Text(state.value)
            }
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .foregroundStyle(tint(state.tint))
    }
}

@available(iOS 16.1, *)
struct TdLiveLockScreen: View {
    let state: TdLiveAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            // The colored rail is the whole visual identity at a glance: blue is
            // a drive, green is a running clock. JS picks the color.
            RoundedRectangle(cornerRadius: 3)
                .fill(tint(state.tint))
                .frame(width: 5)
                .frame(maxHeight: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text(state.kind)
                    .font(.system(size: 11, weight: .heavy))
                    .kerning(0.8)
                    .foregroundStyle(tint(state.tint))
                Text(state.title)
                    .font(.system(size: 17, weight: .bold))
                    .lineLimit(1)
                if !state.detail.isEmpty {
                    Text(state.detail)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 6)
            Readout(state: state)
                // The clock is the widest thing here and it grows a digit at the
                // one-hour mark. Reserving the room keeps the title from
                // reflowing mid-shift.
                .frame(minWidth: 82, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .activityBackgroundTint(Color.black.opacity(0.42))
        .activitySystemActionForegroundColor(tint(state.tint))
    }
}

@available(iOS 16.1, *)
struct TdLiveWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TdLiveAttributes.self) { context in
            TdLiveLockScreen(state: context.state)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.kind)
                        .font(.system(size: 11, weight: .heavy))
                        .kerning(0.8)
                        .foregroundStyle(tint(context.state.tint))
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Readout(state: context.state, size: 17)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.state.title)
                            .font(.system(size: 15, weight: .bold))
                            .lineLimit(1)
                        if !context.state.detail.isEmpty {
                            Text(context.state.detail)
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Circle()
                    .fill(tint(context.state.tint))
                    .frame(width: 8, height: 8)
            } compactTrailing: {
                Readout(state: context.state, size: 13)
            } minimal: {
                // Minimal is a ~16pt circle shared with whatever else is live, so
                // it gets the dot only. A truncated clock here reads as garbage.
                Circle()
                    .fill(tint(context.state.tint))
                    .frame(width: 8, height: 8)
            }
            .keylineTint(tint(context.state.tint))
        }
    }
}

@main
struct TdLiveBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            TdLiveWidget()
        }
    }
}
