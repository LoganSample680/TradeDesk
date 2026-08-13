import Foundation
import Capacitor
import UIKit

// TradeDesk haptics, the thin native half of "the app feels physical".
//
// WHY THIS EXISTS: the web app already called navigator.vibrate() in six
// places (drag pickup, dashboard reorder, nav, sign-out). iOS has NEVER
// implemented the Vibration API in Safari or WKWebView, so every one of those
// calls was a silent no-op on the exact device our customers carry. This
// plugin makes them real, and gives the web side the full Taptic vocabulary
// instead of one blunt buzz.
//
// Dumb by design (CLAUDE.md 3.2): raw capability only, three verbs. WHICH
// moments deserve which feedback is entirely a JS decision (_tdHaptic in
// js/utils.js), so the feel of the app is tunable forever without a build.
@objc(TdHapticPlugin)
public class TdHapticPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdHapticPlugin"
    public let jsName = "TdHaptic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "select", returnType: CAPPluginReturnPromise)
    ]

    // Generators are held and re-prepared after every fire. A cold Taptic
    // engine takes a beat to spin up, so a freshly-allocated generator lands
    // its tap late enough to feel disconnected from the finger. Keeping them
    // warm is the whole difference between "native" and "web app in a box".
    private let lightGen = UIImpactFeedbackGenerator(style: .light)
    private let mediumGen = UIImpactFeedbackGenerator(style: .medium)
    private let heavyGen = UIImpactFeedbackGenerator(style: .heavy)
    private let noticeGen = UINotificationFeedbackGenerator()
    private let selectGen = UISelectionFeedbackGenerator()

    public override func load() {
        DispatchQueue.main.async {
            self.lightGen.prepare(); self.mediumGen.prepare(); self.selectGen.prepare()
        }
    }

    // A physical tap: light (a tick), medium (a control committed), heavy (a
    // big irreversible action). Unknown styles fall back to light rather than
    // rejecting: a haptic is never worth failing a user action over.
    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "heavy": self.heavyGen.impactOccurred(); self.heavyGen.prepare()
            case "medium": self.mediumGen.impactOccurred(); self.mediumGen.prepare()
            default: self.lightGen.impactOccurred(); self.lightGen.prepare()
            }
            call.resolve()
        }
    }

    // The outcome pattern: success (money collected, proposal sent), warning
    // (something needs attention), error (the save failed). These are the
    // system's own three-part rhythms, so they read as iOS, not as a buzz.
    @objc func notify(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"
        DispatchQueue.main.async {
            switch type {
            case "error": self.noticeGen.notificationOccurred(.error)
            case "warning": self.noticeGen.notificationOccurred(.warning)
            default: self.noticeGen.notificationOccurred(.success)
            }
            self.noticeGen.prepare()
            call.resolve()
        }
    }

    // The picker tick: a value changed under the thumb (a card slid past
    // another, a segment switched). Deliberately the lightest of the three.
    @objc func select(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.selectGen.selectionChanged()
            self.selectGen.prepare()
            call.resolve()
        }
    }
}
