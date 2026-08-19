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
// changing it in JS is a UAT roll. So nothing here interprets anything, with
// one deliberate exception: `dualTimer` is a boolean JS sets, not a string
// Swift parses, so branching on it is still "obeying a flag," not
// "interpreting a word."
//
// The single exception to "nothing here ticks on its own" is the clock.
// Text(timerInterval:) ticks on-device with the app closed and no updates
// spent, so a running job timer costs nothing. Pushing a new string every
// second would drain the battery and blow through ActivityKit's update
// budget in minutes.
//
// VISUAL PASS (2026-08-19, unverified against a real device/build, see the note
// at the bottom of this file): a frosted-glass material card carrying the real
// TradeDesk brand mark, plus a status-tinted glow ring, a kind "chip," and a
// light-catching edge border. Same colors the web app's #nav-logo-icon uses
// (--grad-mark, --text-cream) so the mark reads as the same logo, not a
// reinvented one.
//
// OWNER FEEDBACK ROUND 2 (2026-08-19, same day): "things are cutoff and don't
// want them to be, want full data" → title/detail now wrap to 2 lines instead
// of hard-truncating at 1. Plus: clocked-in cards now show TWO ticking clocks
// (time on site, time on this step) instead of one, per the owner's ask for
// on-site time detail. Both native/js sides changed together, see
// js/live-activity.js `_liveActClockIn` for the new `siteStartedAt`/
// `dualTimer` fields.

@available(iOS 16.1, *)
private func tdTint(_ hex: String) -> Color {
    let (r, g, b) = tdLiveHexComponents(hex)
    return Color(red: r, green: g, blue: b)
}

// The TradeDesk brand mark: the same gradient tile + tool glyph as the web
// app's #nav-logo-icon (index.html), redrawn here since a widget extension
// ships no asset catalog of its own (scripts/ios-add-live-target.rb only
// copies these three .swift files in). The exact SVG wrench path isn't worth
// hand-transcribing into a Bezier/arc Shape we can't compile-check here, so
// "wrench.and.screwdriver.fill" stands in: same silhouette family, guaranteed
// to exist in the SF Symbols set iOS 16.1 ships, zero build risk.
//
// `ringTint` is optional: when set, it turns the mark itself into the status
// indicator (blue = driving, green = clocked in, ...) via a soft glow ring, so
// the logo does double duty instead of needing a separate color rail.
@available(iOS 16.1, *)
private struct TdMark: View {
    var size: CGFloat = 32
    var ringTint: Color? = nil

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [tdTint("#2D5DA8"), tdTint("#1B3F7A")],
                    startPoint: UnitPoint(x: 0.15, y: 0),
                    endPoint: UnitPoint(x: 0.85, y: 1)
                )
            )
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(tdTint("#F5EFE2")) // --text-cream
            )
            .overlay(
                // A thin light seam so the tile reads as part of the same
                // glass material as the card, not a flat sticker on top of it.
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.22), lineWidth: 0.75)
            )
            .overlay(
                Group {
                    if let ringTint {
                        RoundedRectangle(cornerRadius: size * 0.28 + 3, style: .continuous)
                            .strokeBorder(ringTint, lineWidth: 1.5)
                            .frame(width: size + 6, height: size + 6)
                            .shadow(color: ringTint.opacity(0.55), radius: 3)
                    }
                }
            )
    }
}

// The right-hand readout: a live clock when JS asked for one, otherwise the
// finished string it sent ("12.4 mi"). Same component on the lock screen and in
// the expanded island so the two can never drift apart. Single-clock only; the
// CLOCKED IN card's two-clock layout is `DualReadout` below.
@available(iOS 16.1, *)
private struct Readout: View {
    let state: TdLiveAttributes.ContentState
    // @ScaledMetric, not a plain CGFloat: this number is what actually reads
    // Dynamic Type/accessibility text size settings. A literal .font(size:)
    // never scales on its own, an accessibility-size user would be stuck at
    // whatever point size a sighted designer picked, which is the whole gap
    // the owner flagged (2026-08-19: "needs to work with ADA text").
    @ScaledMetric var size: CGFloat = 22

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
        .foregroundStyle(tdTint(state.tint))
    }
}

// The CLOCKED IN readout: two independently-ticking clocks stacked with a tiny
// caption each, "on site" (since arrival, survives a scope switch) over "this
// step" (since the last clock-in call). Each uses the SAME
// Text(timerInterval:) mechanism as the single-clock Readout above, so both
// tick on-device with zero JS polling and zero extra ActivityKit updates:
// two clocks cost exactly what one did.
@available(iOS 16.1, *)
private struct DualReadout: View {
    let state: TdLiveAttributes.ContentState
    @ScaledMetric var captionSize: CGFloat = 8.5
    @ScaledMetric var numberSize: CGFloat = 15

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            row(caption: "ON SITE", start: state.siteStartedAt)
            row(caption: "THIS STEP", start: state.startedAt)
        }
    }

    private func row(caption: String, start: Double) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(caption)
                .font(.system(size: captionSize, weight: .heavy))
                .kerning(0.5)
                .foregroundStyle(.secondary)
            Text(
                timerInterval: Date(timeIntervalSince1970: start)...Date.distantFuture,
                countsDown: false
            )
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .font(.system(size: numberSize, weight: .bold, design: .rounded))
            .foregroundStyle(tdTint(state.tint))
            // .primary/.secondary get free vibrancy on a Material, a literal
            // Color does not, so on a light wallpaper this tint can wash out
            // to near-invisible (caught by rendering the card over several
            // real wallpaper types, not just the one dark photo in review).
            // A fixed dark shadow is what Apple's own glyphs-over-Material
            // widgets use for this, it holds contrast on light backgrounds
            // without changing how the tint reads on a dark one.
            .shadow(color: .black.opacity(0.35), radius: 1.5, x: 0, y: 0.5)
        }
    }
}

// A small uppercase status chip ("DRIVING", "CLOCKED IN") tinted to match the
// activity's color. Purely decorative styling around whatever string JS sent,
// it never reads or branches on the string itself.
@available(iOS 16.1, *)
private struct KindChip: View {
    let text: String
    let tint: Color
    @ScaledMetric var fontSize: CGFloat = 10

    var body: some View {
        Text(text)
            .font(.system(size: fontSize, weight: .heavy))
            .kerning(0.7)
            .foregroundStyle(tint)
            .shadow(color: .black.opacity(0.3), radius: 1, x: 0, y: 0.5) // see DualReadout's note
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(.regularMaterial, in: Capsule()) // its own backing, not just a flat tint fill, so the chip stays legible even when the card material itself is sitting on a light wallpaper
            .background(Capsule().fill(tint.opacity(0.16)))
            .overlay(Capsule().strokeBorder(tint.opacity(0.4), lineWidth: 0.75))
    }
}

@available(iOS 16.1, *)
struct TdLiveLockScreen: View {
    let state: TdLiveAttributes.ContentState
    @ScaledMetric private var titleSize: CGFloat = 17
    @ScaledMetric private var detailSize: CGFloat = 12.5
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var titleDetail: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(state.title)
                .font(.system(size: titleSize, weight: .bold))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if !state.detail.isEmpty {
                Text(state.detail)
                    .font(.system(size: detailSize))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var readout: some View {
        Group {
            if state.dualTimer {
                DualReadout(state: state)
            } else {
                Readout(state: state)
            }
        }
    }

    var body: some View {
        Group {
            // At an accessibility text size (the phone's own Larger Text
            // setting past the standard range, "so visuals aren't fucked" per
            // the owner 2026-08-19), squeezing the name between a fixed icon
            // and a fixed readout column runs out of room fast: measured
            // against a mockup of this exact layout, "Sarah Martinez-
            // Whitfield" was cut to "S / M" and the chip visually collided
            // with the readout above it. Past that threshold the card
            // switches to a stacked layout instead: icon/chip/readout share
            // one top row, and the name/detail get the FULL card width below
            // it rather than a squeezed middle column. Below the threshold
            // (the vast majority of users) nothing changes from the
            // side-by-side layout already reviewed.
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            TdMark(size: 34, ringTint: tdTint(state.tint))
                            KindChip(text: state.kind, tint: tdTint(state.tint))
                        }
                        Spacer(minLength: 8)
                        readout
                    }
                    titleDetail
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    TdMark(size: 34, ringTint: tdTint(state.tint))

                    // No fixed width here on purpose: this column takes
                    // whatever space is left after the mark and the readout,
                    // and now WRAPS instead of clipping when a real
                    // client/job name or scope label runs long ("Sarah
                    // Martinez-Whitfield" plus a multi-word scope easily
                    // clears one line). Owner feedback 2026-08-19: real data
                    // must never be cut.
                    VStack(alignment: .leading, spacing: 4) {
                        KindChip(text: state.kind, tint: tdTint(state.tint))
                        titleDetail
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    readout
                        // The two-clock column is wider than the single clock
                        // (it carries captions too); reserve enough room that
                        // neither clock's caption wraps mid-word, and that
                        // the clock digits don't reflow the title when they
                        // grow a digit at the one-hour mark.
                        .frame(minWidth: state.dualTimer ? 94 : 82, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        // Every size above is @ScaledMetric, so it grows with the phone's Text
        // Size / Larger Accessibility Sizes setting. Uncapped, an AX5 setting
        // (up to ~310% of the base point size) would make this card taller than
        // most lock screens have room for, alongside whatever else is showing.
        // Clamping to accessibility3 still gets a big, clearly-readable card at
        // the largest common accessibility sizes without guessing at a height
        // nobody has actually measured against a real device.
        .dynamicTypeSize(...DynamicTypeSize.accessibility3)
        // Glass card: a faint top-to-bottom sheen sits UNDER a real frosted
        // material, so the lock screen's wallpaper shows through blurred
        // instead of getting buried under flat black. ContainerRelativeShape
        // matches whatever corner radius the system gives the activity card
        // without us having to guess/hardcode one.
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.09), Color.black.opacity(0.05)],
                startPoint: .top, endPoint: .bottom
            )
        )
        .background(.ultraThinMaterial, in: ContainerRelativeShape())
        .overlay(
            ContainerRelativeShape()
                .strokeBorder(
                    LinearGradient(
                        colors: [Color.white.opacity(0.28), Color.white.opacity(0.03)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        // Low, not zero: some tint keeps the card legible over a bright/busy
        // wallpaper while still letting the material blur read as glass rather
        // than a flat panel.
        .activityBackgroundTint(Color.black.opacity(0.16))
        .activitySystemActionForegroundColor(tdTint(state.tint))
    }
}

// Two more small views purely so @ScaledMetric has a stored property to live
// on: it only tracks Dynamic Type changes correctly as a View's own property,
// not as a local variable inside a closure, so the two inline text blocks
// that used to sit directly in the Dynamic Island's expanded-region closures
// below are pulled out here, same reason Readout/DualReadout/KindChip above
// are their own types rather than inline code.
@available(iOS 16.1, *)
private struct DIKindLabel: View {
    let text: String
    let tint: Color
    @ScaledMetric var fontSize: CGFloat = 9

    var body: some View {
        Text(text)
            .font(.system(size: fontSize, weight: .heavy))
            .kerning(0.6)
            .foregroundStyle(tint)
            .lineLimit(1)
    }
}

@available(iOS 16.1, *)
private struct DITitleDetail: View {
    let title: String
    let detail: String
    @ScaledMetric var titleSize: CGFloat = 15
    @ScaledMetric var detailSize: CGFloat = 12

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.system(size: titleSize, weight: .bold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if !detail.isEmpty {
                Text(detail)
                    .font(.system(size: detailSize))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    VStack(alignment: .leading, spacing: 5) {
                        TdMark(size: 22)
                        DIKindLabel(text: context.state.kind, tint: tdTint(context.state.tint))
                    }
                    .padding(.leading, 4)
                    // Expanded has more room than compact but it's still a
                    // fixed-height sheet, not a scrolling lock screen: capped
                    // lower than the lock screen's accessibility3 so 3 regions
                    // side by side don't collide at the largest sizes.
                    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                        if context.state.dualTimer {
                            DualReadout(state: context.state, captionSize: 7.5, numberSize: 13)
                        } else {
                            Readout(state: context.state, size: 17)
                        }
                    }
                    .padding(.trailing, 4)
                    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                }
                DynamicIslandExpandedRegion(.center) {
                    DITitleDetail(title: context.state.title, detail: context.state.detail)
                        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                }
            } compactLeading: {
                // The brand mark stands in for the old plain dot, with the
                // status color demoted to a small corner badge (like an app's
                // notification dot) since there's no room for a full ring at
                // this size.
                TdMark(size: 20)
                    .overlay(alignment: .bottomTrailing) {
                        Circle()
                            .fill(tdTint(context.state.tint))
                            .frame(width: 6, height: 6)
                            .overlay(Circle().stroke(Color.black, lineWidth: 1))
                            .offset(x: 2, y: 2)
                    }
                    // compactLeading/compactTrailing/minimal sit inside the
                    // pill the OS itself draws around the sensor housing:
                    // there is no extra room to grow into regardless of the
                    // phone's text-size setting, so these three (unlike the
                    // lock screen and expanded regions above) are pinned to
                    // one fixed size on purpose, not accidentally left out of
                    // the accessibility pass. Apple's own first-party Live
                    // Activities do the same in this exact spot.
                    .dynamicTypeSize(.large)
            } compactTrailing: {
                // Compact has room for one clock, not two: the overall "on
                // site" number is the one that matters at a glance here, the
                // per-step breakdown is what the expanded island is for.
                Readout(state: context.state, size: 13)
                    .dynamicTypeSize(.large) // see compactLeading's note
            } minimal: {
                // Minimal is a ~16pt circle shared with whatever else is live, so
                // it gets the dot only. A truncated clock here reads as garbage.
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [tdTint(context.state.tint), tdTint(context.state.tint).opacity(0.55)],
                            center: .center, startRadius: 0, endRadius: 6
                        )
                    )
                    .frame(width: 8, height: 8)
            }
            .keylineTint(tdTint(context.state.tint))
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

// NOTE FOR THE NEXT BUILD (no macOS toolchain in this environment, so none of
// this has been compiled or run on a device): the glass-card look, the 2-line
// text wrap, and the dual-clock layout were all designed against Apple's
// documented Live Activity/WidgetKit APIs (Material, ContainerRelativeShape,
// background(_:in:), Text(timerInterval:)) but the exact corner radius,
// contrast over a real wallpaper, how much a 2-line title/detail plus two
// clocks grows the card's height, and DI compact-leading sizing all need a
// real screenshot to confirm before anyone trusts it. See the HTML mockup
// shipped alongside this change for the design the owner actually signed off
// on; treat this file as "should match that," not gospel. The compactTrailing
// region intentionally still shows one clock (the DI's compact state has no
// room for a caption'd pair); that is a deliberate scope call, not an
// oversight, confirm it reads fine on a real Dynamic Island before shipping.
