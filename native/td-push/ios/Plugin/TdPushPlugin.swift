import Foundation
import Capacitor
import UIKit
import UserNotifications

// TradeDesk remote push, the thin native half.
//
// WHAT THIS UNLOCKS: until now the app could only notify about things the PHONE
// already knew (td-notify schedules locally: tomorrow's first job, an overdue
// invoice). Nothing that happens on a SERVER could reach it. A client signing a
// proposal, a payment landing, a crew member being dispatched: all of it was
// invisible until the contractor happened to open the app. That is survivable
// solo and not survivable with a crew.
//
// Capability only (CLAUDE.md 3.2): ask permission, hand JS the device token,
// and forward taps. WHO gets notified, what it says, and when, all live in JS
// (js/push.js) and the send-push Edge Function, so message copy and routing
// stay tunable through a UAT roll instead of a 15-minute macOS build.
@objc(TdPushPlugin)
public class TdPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdPushPlugin"
    public let jsName = "TdPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "badge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lastTap", returnType: CAPPluginReturnPromise)
    ]

    // A tap can arrive before the web layer has booted and attached listeners
    // (a cold launch FROM the notification is exactly that case). Holding the
    // last one lets JS ask for it on boot instead of missing the routing.
    private static var pendingTap: [String: Any]?

    override public func load() {
        // Capacitor's bridge posts these from its AppDelegate hooks; observing
        // them keeps this plugin out of the AppDelegate, which the build
        // regenerates from scratch every run.
        NotificationCenter.default.addObserver(
            self, selector: #selector(onToken(_:)),
            name: Notification.Name.capacitorDidRegisterForRemoteNotifications, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(onTokenFail(_:)),
            name: Notification.Name.capacitorDidFailToRegisterForRemoteNotifications, object: nil)
        UNUserNotificationCenter.current().delegate = self
    }

    @objc private func onToken(_ note: Notification) {
        guard let data = note.object as? Data else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        notifyListeners("token", data: ["token": token])
    }

    @objc private func onTokenFail(_ note: Notification) {
        let msg = (note.object as? Error)?.localizedDescription ?? "registration failed"
        notifyListeners("tokenError", data: ["error": msg])
    }

    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let state: String
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: state = "granted"
            case .denied: state = "denied"
            default: state = "ask"
            }
            call.resolve(["status": state])
        }
    }

    // Asks for permission if needed, then registers with APNs. The token comes
    // back asynchronously on the "token" listener, never as this promise's
    // value: iOS can take its time, and a promise that waited on the network
    // would hang the sign-in path that calls this.
    @objc func register(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, err in
            if let err = err {
                call.resolve(["granted": false, "error": err.localizedDescription]); return
            }
            guard granted else { call.resolve(["granted": false]); return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
                call.resolve(["granted": true])
            }
        }
    }

    // The red dot. JS owns what the number MEANS (unread money owed, unseen
    // dispatch changes); this only paints it. Zero clears it.
    @objc func badge(_ call: CAPPluginCall) {
        let n = call.getInt("count") ?? 0
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(n)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = n
            }
            call.resolve(["ok": true])
        }
    }

    // Cold-launch rescue: JS calls this once on boot to pick up a tap that
    // happened before it was listening. Reading it clears it, so a later reload
    // cannot re-navigate the contractor somewhere they already dismissed.
    @objc func lastTap(_ call: CAPPluginCall) {
        if let t = TdPushPlugin.pendingTap {
            TdPushPlugin.pendingTap = nil
            call.resolve(["tap": t])
        } else {
            call.resolve([:])
        }
    }
}

extension TdPushPlugin: UNUserNotificationCenterDelegate {
    // Foreground delivery. Showing the banner while the contractor is already
    // looking at the relevant screen would be noise, but this plugin cannot know
    // what is on screen, so it always shows and lets JS decide to dismiss. A
    // silently swallowed notification is the worse failure of the two.
    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                       willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        notifyListeners("received", data: ["payload": notification.request.content.userInfo])
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                       didReceive response: UNNotificationResponse,
                                       withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        var payload: [String: Any] = [:]
        for (k, v) in info { payload[String(describing: k)] = v }
        TdPushPlugin.pendingTap = payload
        notifyListeners("tapped", data: ["payload": payload])
        completionHandler()
    }
}
