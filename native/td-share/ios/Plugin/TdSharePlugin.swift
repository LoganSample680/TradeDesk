import Foundation
import Capacitor

// TradeDesk share inbox, the app-side half.
//
// Crews photograph a jobsite with the normal Camera app out of habit, and a
// homeowner texts pictures of the leak. Today that means exporting and
// re-importing. With the share extension, Share > TradeDesk drops the file
// into a shared inbox, and this reads that inbox out so JS can ask the only
// question worth asking: which job?
//
// The extension deliberately has NO UI and no job picker. It runs in a
// memory-starved process that iOS kills without ceremony, so it does the one
// thing that must not fail (get the bytes somewhere safe) and hands every
// decision to the app, where the job list already lives (CLAUDE.md 3.2).
@objc(TdSharePlugin)
public class TdSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdSharePlugin"
    public let jsName = "TdShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "inbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    static let appGroup = "group.app.tradedesk.beta"

    static func inboxDir() -> URL? {
        guard let base = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = base.appendingPathComponent("shared-inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // What is waiting, oldest first: the order they were shared is the order a
    // person expects to file them in.
    @objc func inbox(_ call: CAPPluginCall) {
        guard let dir = Self.inboxDir(),
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else {
            call.resolve(["items": []]); return
        }
        var items: [[String: Any]] = []
        for name in names {
            let url = dir.appendingPathComponent(name)
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let when = (attrs?[.creationDate] as? Date)?.timeIntervalSince1970 ?? 0
            guard size > 0 else { continue }
            items.append(["path": url.path, "name": name, "size": size, "ts": when * 1000])
        }
        items.sort { (($0["ts"] as? Double) ?? 0) < (($1["ts"] as? Double) ?? 0) }
        call.resolve(["items": items])
    }

    // Chunked base64, the same bridge the scanner uses for mesh files: the
    // WebView cannot read the App Group container directly, and a whole photo
    // in one string is a memory spike on an older phone.
    @objc func read(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("no path"); return }
        let offset = call.getInt("offset") ?? 0
        let length = call.getInt("length") ?? 1_048_576
        DispatchQueue.global(qos: .userInitiated).async {
            guard let fh = FileHandle(forReadingAtPath: path) else { call.reject("no such file"); return }
            let size = ((try? FileManager.default.attributesOfItem(atPath: path)[.size]) as? NSNumber)?.intValue ?? 0
            fh.seek(toFileOffset: UInt64(max(0, offset)))
            let data = fh.readData(ofLength: length)
            fh.closeFile()
            call.resolve(["b64": data.base64EncodedString(), "size": size])
        }
    }

    // Called ONLY after JS has the bytes safely on a job. Deleting earlier
    // would lose a photo that iOS never gave us a second chance at.
    @objc func clear(_ call: CAPPluginCall) {
        if let paths = call.getArray("paths") as? [String], !paths.isEmpty {
            for p in paths { try? FileManager.default.removeItem(atPath: p) }
        } else if let dir = Self.inboxDir() {
            let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
            for n in names { try? FileManager.default.removeItem(at: dir.appendingPathComponent(n)) }
        }
        call.resolve()
    }
}
