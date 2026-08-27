import Foundation
import Capacitor

// TradeDesk Siri Shortcuts / App Intents, the drain half.
//
// The App Intents themselves (TdAppIntents.swift) run IN the App target, not
// this plugin's own pod target: Shortcuts/Spotlight only discover intents
// declared in the host app (see native/td-intents/ios/AppIntents, injected by
// scripts/ios-add-app-intents.rb). An intent's perform() can fire before the
// WebView exists at all (Siri launching the app cold), so it cannot call a
// Capacitor plugin method directly. It stashes a route string in
// UserDefaults.standard instead, same-process with the app so no App Group is
// needed, and this plugin hands it to JS once on boot, exactly the cold-launch
// rescue pattern TdPush already uses for a notification tap (pendingTap /
// lastTap). "td_pending_intent_route" MUST match the key TdAppIntents.swift
// writes: they are two separate compilation units, there is no shared Swift
// constant to enforce it.
@objc(TdIntentsPlugin)
public class TdIntentsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdIntentsPlugin"
    public let jsName = "TdIntents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise)
    ]

    private static let key = "td_pending_intent_route"

    // Reading clears it, so a later reload can never re-fire an intent the
    // contractor already acted on.
    @objc func drain(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        guard let route = defaults.string(forKey: TdIntentsPlugin.key) else {
            call.resolve([:]); return
        }
        defaults.removeObject(forKey: TdIntentsPlugin.key)
        call.resolve(["route": route])
    }
}
