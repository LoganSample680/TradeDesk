import Foundation
import Capacitor
import UIKit

// TradeDesk device identity, dumb by design (CLAUDE.md §3.2): reads three
// raw OS facts and hands them to JS untouched.
//
// WHY THIS EXISTS: a new-phone layout bug ("tiles look smaller on the Pro
// Max") couldn't be reproduced because the web layer only ever sees
// navigator.userAgent, which iOS collapses to a bare "iPhone" on purpose,
// no model, no generation. UIDevice.current.model is just as useless (also
// "iPhone"). The one real signal is the sysctl hardware identifier
// (uname().machine, e.g. "iPhone17,2"), which is unique per hardware
// revision.
//
// NO marketing-name guessing here on purpose: Apple's internal identifier
// numbers do NOT line up with the marketing generation in any reliable
// pattern (confirmed while building this: the iPhone 17 Pro Max identifier
// is iPhone18,2, not iPhone17,x). A hand-typed "iPhone17,2 -> iPhone 17 Pro
// Max" table would be a guess dressed up as fact. JS owns whatever mapping
// it wants to build from real confirmed data instead, tunable forever
// without a rebuild, this plugin's only job is handing over the raw truth.
@objc(TdDevicePlugin)
public class TdDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdDevicePlugin"
    public let jsName = "TdDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    // Standard sysctl-via-utsname technique for the exact hardware
    // identifier. UIDevice.current.model only ever returns the generic
    // "iPhone" string on a real device, this is the only way to get the
    // real one without a private API.
    private func hardwareIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        let id = mirror.children.reduce("") { acc, element in
            guard let value = element.value as? Int8, value != 0 else { return acc }
            return acc + String(UnicodeScalar(UInt8(value)))
        }
        return id.isEmpty ? "unknown" : id
    }

    @objc func info(_ call: CAPPluginCall) {
        // UIDevice reads must happen on the main thread; hardwareIdentifier()
        // touches no UIKit state so it's safe from any thread, but keeping
        // everything in one dispatch avoids any doubt about call ordering.
        DispatchQueue.main.async {
            call.resolve([
                "hwId": self.hardwareIdentifier(),
                "name": UIDevice.current.name,
                "systemVersion": UIDevice.current.systemVersion
            ])
        }
    }
}
