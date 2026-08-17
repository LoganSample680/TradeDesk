import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

// TradeDesk Live Activities, the thin native half.
//
// THE MOMENT THIS SERVES: the phone is in a pocket or a truck mount and the app
// is closed. That is most of a contractor's day, and until now the app could say
// nothing during it. A Live Activity puts the running job clock or the active
// drive on the lock screen and in the Dynamic Island, where the contractor is
// already looking, with no tap at all.
//
// Capability only (CLAUDE.md 3.2): start, update, end, and report support. JS
// owns every word, every threshold, and every decision about WHEN an activity
// should exist. See js/live-activity.js. The one thing Swift owns is the ticking
// clock, because Text(timerInterval:) counts on-device with the app closed and
// no updates spent; pushing a string every second would burn the battery and
// exhaust ActivityKit's update budget in minutes.
//
// Channels: two activities can be live at once (driving to a job, and clocked in
// on one). `channel` keeps them apart so ending one never kills the other.
@objc(TdLivePlugin)
public class TdLivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdLivePlugin"
    public let jsName = "TdLive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise)
    ]

    // channel -> the live activity's id, so update/end can find it again.
    private var live: [String: String] = [:]
    // Activity ids whose APNs token stream is already being watched, so a
    // re-learned activity is never double-subscribed (each subscription would
    // re-emit every rotation to JS).
    private var watched: Set<String> = []

    // SERVER-DRIVEN UPDATES (owner 2026-08-17): an activity started with
    // push:true gets its own APNs token from ActivityKit. Every token (and
    // every rotation, iOS reissues them) is handed straight to JS, which
    // stores it server-side; the update-live-activity Edge Function then
    // changes or ends the card with the app closed. Capability only: WHAT
    // gets pushed and WHO may target it live in JS and the function.
    #if canImport(ActivityKit)
    @available(iOS 16.1, *)
    private func watchPushToken(_ activity: Activity<TdLiveAttributes>, channel: String) {
        guard !watched.contains(activity.id) else { return }
        watched.insert(activity.id)
        // Whatever token already exists arrives immediately; the stream then
        // delivers rotations for as long as the activity lives.
        if let t = activity.pushToken {
            let hex = t.map { String(format: "%02x", $0) }.joined()
            notifyListeners("activityToken", data: ["channel": channel, "token": hex])
        }
        Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                let hex = data.map { String(format: "%02x", $0) }.joined()
                self?.notifyListeners("activityToken", data: ["channel": channel, "token": hex])
            }
            self?.watched.remove(activity.id)
        }
    }
    #endif

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            // Two different answers, and JS needs both: the OS can support Live
            // Activities while the user has switched them off for this app in
            // Settings. Reporting one boolean would make a user-disabled phone
            // look like an old phone and send JS down the wrong path.
            call.resolve([
                "supported": true,
                "enabled": ActivityAuthorizationInfo().areActivitiesEnabled
            ])
            return
        }
        #endif
        call.resolve(["supported": false, "enabled": false])
    }

    #if canImport(ActivityKit)
    @available(iOS 16.1, *)
    private func stateFrom(_ call: CAPPluginCall) -> TdLiveAttributes.ContentState {
        TdLiveAttributes.ContentState(
            kind: call.getString("kind") ?? "",
            title: call.getString("title") ?? "",
            detail: call.getString("detail") ?? "",
            value: call.getString("value") ?? "",
            timer: call.getBool("timer") ?? false,
            // JS sends epoch SECONDS. Missing or nonsense falls back to now, so a
            // bad payload shows a clock from zero instead of one from 1970.
            startedAt: call.getDouble("startedAt") ?? Date().timeIntervalSince1970,
            tint: call.getString("tint") ?? "#2D5DA8"
        )
    }
    #endif

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["ok": false, "reason": "disabled"]); return
            }
            let channel = call.getString("channel") ?? "default"
            let state = stateFrom(call)
            // Restarting a channel that is already live is an UPDATE, never a
            // second activity: a reconnecting web layer calling start() twice
            // would otherwise stack duplicate cards on the lock screen.
            if let existing = live[channel] {
                Task {
                    for a in Activity<TdLiveAttributes>.activities where a.id == existing {
                        await a.update(using: state)
                    }
                    call.resolve(["ok": true, "id": existing, "reused": true])
                }
                return
            }
            do {
                let wantPush = call.getBool("push") ?? false
                let activity = try Activity.request(
                    attributes: TdLiveAttributes(channel: channel),
                    contentState: state,
                    pushType: wantPush ? .token : nil
                )
                live[channel] = activity.id
                if wantPush { watchPushToken(activity, channel: channel) }
                call.resolve(["ok": true, "id": activity.id, "reused": false])
            } catch {
                call.resolve(["ok": false, "reason": error.localizedDescription])
            }
            return
        }
        #endif
        call.resolve(["ok": false, "reason": "unsupported"])
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            let channel = call.getString("channel") ?? "default"
            let state = stateFrom(call)
            Task {
                var found = false
                for a in Activity<TdLiveAttributes>.activities where a.attributes.channel == channel {
                    await a.update(using: state)
                    // Re-learn the id: the app can be relaunched (or the plugin
                    // re-instantiated) while an activity from the previous run is
                    // still on the lock screen, and the in-memory map is empty.
                    self.live[channel] = a.id
                    // Re-learned across a relaunch: its token stream needs
                    // watching again too, or a rotation after relaunch would
                    // leave the server pushing at a dead token.
                    if a.pushToken != nil { self.watchPushToken(a, channel: channel) }
                    found = true
                }
                call.resolve(["ok": found])
            }
            return
        }
        #endif
        call.resolve(["ok": false])
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            let channel = call.getString("channel") ?? "default"
            Task {
                for a in Activity<TdLiveAttributes>.activities where a.attributes.channel == channel {
                    await a.end(dismissalPolicy: .immediate)
                }
                self.live.removeValue(forKey: channel)
                call.resolve(["ok": true])
            }
            return
        }
        #endif
        call.resolve(["ok": false])
    }

    // The safety net: sign-out, account switch, or a boot that finds stale cards
    // from a previous run. A drive activity outliving the session it belonged to
    // would leak one client's name onto the lock screen after a handoff.
    @objc func endAll(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            Task {
                for a in Activity<TdLiveAttributes>.activities {
                    await a.end(dismissalPolicy: .immediate)
                }
                self.live.removeAll()
                call.resolve(["ok": true])
            }
            return
        }
        #endif
        call.resolve(["ok": false])
    }
}
