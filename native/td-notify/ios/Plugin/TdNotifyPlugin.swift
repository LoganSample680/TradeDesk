import Foundation
import Capacitor
import UserNotifications

// TradeDesk local notifications, the thin native half.
//
// LOCAL, not push: everything here is scheduled ON the phone by the app, so
// there is no server, no APNs certificate, no per-message cost, and it works
// with no signal. That covers the things a contractor actually needs to be
// told: tomorrow's first job, an invoice that went past due, and the arrival
// tap-back from Apple Maps (iOS gives no way to foreground an app on arrival,
// but a notification the driver taps is the sanctioned equivalent).
//
// Dumb by design (CLAUDE.md 3.2): schedule, cancel, ask permission. WHAT gets
// scheduled, WHEN, and what it says are all JS decisions (js/notify.js), so
// the whole reminder system is tunable without another build.
@objc(TdNotifyPlugin)
public class TdNotifyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdNotifyPlugin"
    public let jsName = "TdNotify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise)
    ]

    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            var out = "unknown"
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: out = "granted"
            case .denied: out = "denied"
            case .notDetermined: out = "ask"
            @unknown default: out = "unknown"
            }
            call.resolve(["status": out])
        }
    }

    @objc func request(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    // ids are OURS, stable and reused on purpose: re-scheduling the same id
    // REPLACES that notification instead of stacking a duplicate. That is what
    // makes "remind me about job 91 tomorrow" safe to call on every render.
    // atMs omitted (or in the past) fires immediately, which is the arrival
    // and geofence case.
    @objc func schedule(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else { call.reject("no id"); return }
        let title = call.getString("title") ?? "TradeDesk"
        let body = call.getString("body") ?? ""
        let atMs = call.getDouble("atMs") ?? 0

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        // Focus modes (Do Not Disturb, Driving, Sleep) silently swallow a
        // normal local notification, which is exactly the state a contractor's
        // phone is in for the reminders that matter most: driving to the first
        // job, and the day-end proposal in the evening. Time Sensitive is the
        // sanctioned way through, and the entitlement is already declared in
        // ios-beta.yml. Without this line the entitlement does nothing.
        if #available(iOS 15.0, *) { content.interruptionLevel = .timeSensitive }
        if let payload = call.getObject("data") { content.userInfo = payload }

        var trigger: UNNotificationTrigger? = nil
        if atMs > 0 {
            let delay = (atMs / 1000.0) - Date().timeIntervalSince1970
            // Anything already due fires now rather than being dropped: a
            // reminder that arrives late still beats one that never arrives.
            if delay > 1 {
                trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
            }
        }

        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error { call.reject(error.localizedDescription) }
            else { call.resolve(["id": id, "scheduled": true]) }
        }
    }

    // ids omitted clears everything we scheduled. Used when the owner turns
    // reminders off, and on sign-out so the next account never inherits the
    // previous one's alerts.
    @objc func cancel(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        if let ids = call.getArray("ids") as? [String], !ids.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: ids)
        } else {
            center.removeAllPendingNotificationRequests()
        }
        call.resolve()
    }

    @objc func pending(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
            call.resolve(["ids": reqs.map { $0.identifier }])
        }
    }
}
