import Foundation
import CallKit

// The Call Directory extension: a separate process iOS wakes on its own
// schedule to ask "what names do you have for phone numbers?"
//
// HARD CONSTRAINTS this file exists to respect:
//   1. Entries MUST be added in ascending numerical order or iOS throws the
//      whole set away. The app writes the table pre-sorted; this trusts that
//      order but guards it (see below) because a rejected set is invisible:
//      no crash, no message, calls just silently stay "Unknown".
//   2. This process has a small memory budget and NO network. The only input
//      is the shared App Group file the app wrote.
//   3. It runs when iOS decides, not when we do, so it must be cheap and
//      must never assume the app is running.
class CallDirectoryHandler: CXCallDirectoryProvider {

    static let appGroup = "group.app.tradedesk.beta"

    override func beginRequest(with context: CXCallDirectoryExtensionContext) {
        context.delegate = self

        // An incremental request expects a diff; a full request expects the
        // complete set. We always publish the complete set (the table is
        // small, and "replace everything" is the only model that cannot
        // drift), so an incremental request is first cleared to empty.
        if context.isIncremental {
            context.removeAllIdentificationEntries()
        }

        for entry in loadTable() {
            context.addIdentificationEntry(withNextSequentialPhoneNumber: entry.number, label: entry.label)
        }

        context.completeRequest()
    }

    private func loadTable() -> [(number: CXCallDirectoryPhoneNumber, label: String)] {
        guard let url = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
                .appendingPathComponent("callerid.tsv"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }

        var out: [(number: CXCallDirectoryPhoneNumber, label: String)] = []
        out.reserveCapacity(1024)
        var last: CXCallDirectoryPhoneNumber = 0
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, let number = CXCallDirectoryPhoneNumber(parts[0]) else { continue }
            let label = String(parts[1])
            guard !label.isEmpty else { continue }
            // The ordering guard: skip anything not strictly greater than the
            // last accepted number. Dropping one bad row costs one client's
            // caller ID; passing it on costs EVERY client's caller ID.
            guard number > last else { continue }
            last = number
            out.append((number: number, label: label))
        }
        return out
    }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
    func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
        // Nothing useful to do here: there is no UI and no network in this
        // process. iOS retries on its own schedule, and the app re-publishes
        // on every client change anyway.
    }
}
