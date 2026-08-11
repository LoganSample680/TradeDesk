import Foundation
import Capacitor
import CallKit

// TradeDesk caller ID, the app-side half.
//
// WHAT IT DOES: every client phone number saved in the app is published to a
// shared file that an iOS Call Directory extension reads, so an incoming call
// from a saved number rings as that client's name instead of "Unknown".
//
// WHY A SHARED FILE: the extension runs in its OWN process with a hard memory
// budget and no access to the app's sandbox or the network. The only channel
// between the two is the App Group container, so the app writes a sorted
// table there and asks iOS to reload the extension.
//
// THE ORDERING RULE (the thing that silently breaks this feature): iOS
// REJECTS the entire entry set unless numbers are added in strictly ascending
// numerical order. JS sorts before sending, and this re-sorts and de-dupes
// anyway, so no JS bug can ever brick a contractor's caller ID.
//
// Dumb by design (CLAUDE.md 3.2): this stores, sorts, and reloads. WHICH
// contacts get published and what the label says are entirely JS decisions
// (js/callerid.js), tunable forever without another build.
@objc(TdCallerIdPlugin)
public class TdCallerIdPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdCallerIdPlugin"
    public let jsName = "TdCallerId"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    // Kept in sync with scripts/ios-add-callerid-target.rb, which stamps the
    // same identifiers into the generated Xcode project.
    static let appGroup = "group.app.tradedesk.beta"
    static let extensionId = "app.tradedesk.beta.CallerId"

    static func tableUrl() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent("callerid.tsv")
    }

    // contacts: [{ number: <digits, E.164 without +>, label: "Client name" }]
    @objc func setContacts(_ call: CAPPluginCall) {
        let raw = call.getArray("contacts") as? [[String: Any]] ?? []
        DispatchQueue.global(qos: .utility).async {
            // Dictionary de-dupes by number (two clients sharing a phone is
            // real: a landlord and their property manager). Last label wins,
            // which matches JS order: the most recently touched record.
            var table: [Int64: String] = [:]
            for item in raw {
                var digits: Int64? = nil
                if let n = item["number"] as? NSNumber { digits = n.int64Value }
                else if let s = item["number"] as? String { digits = Int64(s.filter { $0.isNumber }) }
                guard let number = digits, number > 0 else { continue }
                // A tab or newline in a client name would corrupt the table's
                // own format, so they are flattened, not escaped: the label is
                // display text, never parsed back into fields.
                let label = (item["label"] as? String ?? "")
                    .replacingOccurrences(of: "\t", with: " ")
                    .replacingOccurrences(of: "\n", with: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard !label.isEmpty else { continue }
                table[number] = String(label.prefix(60))
            }
            guard let url = Self.tableUrl() else {
                call.reject("no app group container")
                return
            }
            var out = ""
            for number in table.keys.sorted() {
                out += "\(number)\t\(table[number]!)\n"
            }
            do {
                try out.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                call.reject("could not write the caller ID table: \(error.localizedDescription)")
                return
            }
            // Ask iOS to re-read the extension. A failure here is normal and
            // NOT an error to shout about: it is what happens when the user
            // has not enabled the extension in Settings yet. JS reads status
            // separately and decides whether to prompt.
            CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: Self.extensionId) { error in
                call.resolve([
                    "count": table.count,
                    "reloaded": error == nil,
                    "reason": error?.localizedDescription ?? ""
                ])
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: Self.extensionId) { status, error in
            var s = "unknown"
            if error == nil {
                switch status {
                case .enabled: s = "enabled"
                case .disabled: s = "disabled"
                default: s = "unknown"
                }
            }
            var count = 0
            if let url = Self.tableUrl(), let text = try? String(contentsOf: url, encoding: .utf8) {
                count = text.split(separator: "\n").count
            }
            call.resolve(["status": s, "count": count])
        }
    }

    // Opens Settings straight to the call-blocking-and-identification screen
    // (iOS 13.4+). Without this the instruction is a four-step scavenger hunt
    // through Settings, which is where a one-time setup step goes to die.
    @objc func openSettings(_ call: CAPPluginCall) {
        if #available(iOS 13.4, *) {
            CXCallDirectoryManager.sharedInstance.openSettings { error in
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve() }
            }
        } else {
            call.reject("needs iOS 13.4")
        }
    }
}
