import Foundation
import Capacitor
import LocalAuthentication

// TradeDesk handoff lock, the thin native half.
//
// THE MOMENT THIS PROTECTS: the contractor hands their unlocked phone to a
// client to sign. Everything they own is one back-swipe away, every other
// client, every margin, payroll, the bank connection. That handoff is the
// real exposure, not app launch, which is why TradeDesk has no launch lock:
// research on field crews is blunt that per-open friction just breeds shared
// logins and workarounds (see the Face ID research, 2026-08-11).
//
// Policy is .deviceOwnerAuthentication, NOT biometrics-only, on purpose: it
// falls back to the device passcode. Face ID fails in real conditions (sun
// glare, a face full of drywall dust, a cracked TrueDepth camera), and a lock
// with no way out would strand a contractor mid-job with a client watching.
@objc(TdLockPlugin)
public class TdLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdLockPlugin"
    public let jsName = "TdLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise)
    ]

    @objc func available(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
        var kind = "none"
        if ok {
            switch ctx.biometryType {
            case .faceID: kind = "face"
            case .touchID: kind = "touch"
            default: kind = "passcode"
            }
        }
        call.resolve(["available": ok, "kind": kind])
    }

    @objc func unlock(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock TradeDesk"
        // A FRESH context per attempt: LAContext caches a successful
        // evaluation, so reusing one would let a second unlock sail through
        // without the client's face ever being checked.
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            // No passcode set at all: there is nothing to authenticate
            // against, so refusing would trap the user out of their own app.
            call.resolve(["ok": true, "reason": "no-auth-configured"])
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            call.resolve(["ok": ok, "reason": ok ? "" : (error?.localizedDescription ?? "cancelled")])
        }
    }
}
