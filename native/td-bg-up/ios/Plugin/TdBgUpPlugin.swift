import Foundation
import Capacitor

// TradeDesk background upload, the thin native half.
//
// WHAT WE ALREADY HAD: a durable retry queue in JS (_drainPhotoQueue,
// js/jobs.js). Nothing is ever lost, but it only runs while the app is awake,
// so closing TradeDesk mid-upload parks a batch of jobsite photos until the
// next launch. On a 20-photo walkthrough over truck-stop signal that is the
// difference between "done before I pull away" and "still there tomorrow".
//
// WHAT THIS ADDS: iOS finishes the transfer with the app CLOSED. A background
// URLSession is owned by the system, survives suspension and termination, and
// resumes across a signal drop.
//
// The catch that shapes the whole design: a background session can only upload
// from a FILE, and the app may not be running when it finishes. So bytes are
// written to a temp file first, and every result is persisted to disk the
// moment it lands, because there may be no JS listening to hear it. JS
// reconciles from that ledger on the next boot (js/bg-upload.js).
@objc(TdBgUpPlugin)
public class TdBgUpPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "TdBgUpPlugin"
    public let jsName = "TdBgUp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "upload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "results", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise)
    ]

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: "app.tradedesk.beta.bgup")
        cfg.isDiscretionary = false          // the contractor is waiting on this, not the OS
        cfg.sessionSendsLaunchEvents = true  // wake the app to hear the result
        cfg.allowsCellularAccess = true      // a jobsite has no wifi
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // The ledger: uploadId -> {ok, status}. Written on every completion because
    // the app is frequently not running when one lands.
    private static func ledgerUrl() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("td_bgup_results.json")
    }
    private static let ledgerLock = NSLock()
    private static func readLedger() -> [String: [String: Any]] {
        guard let data = try? Data(contentsOf: ledgerUrl()),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return [:] }
        return obj
    }
    private static func writeLedger(_ l: [String: [String: Any]]) {
        guard let data = try? JSONSerialization.data(withJSONObject: l) else { return }
        try? data.write(to: ledgerUrl(), options: .atomic)
    }
    private static func record(_ id: String, ok: Bool, status: Int) {
        ledgerLock.lock(); defer { ledgerLock.unlock() }
        var l = readLedger()
        l[id] = ["ok": ok, "status": status, "ts": Date().timeIntervalSince1970 * 1000]
        writeLedger(l)
    }

    // JS hands over the bytes, the destination, and the headers it already
    // built (auth token included): this plugin knows nothing about Supabase.
    @objc func upload(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty,
              let urlStr = call.getString("url"), let url = URL(string: urlStr) else {
            call.reject("id and url required"); return
        }
        let headers = call.getObject("headers") as? [String: String] ?? [:]
        let method = call.getString("method") ?? "POST"

        // Source: an existing file path, or base64 the app already holds.
        var fileUrl: URL?
        if let path = call.getString("path"), FileManager.default.fileExists(atPath: path) {
            fileUrl = URL(fileURLWithPath: path)
        } else if let b64 = call.getString("b64"), let data = Data(base64Encoded: b64) {
            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent("td_bgup_\(id.replacingOccurrences(of: "/", with: "_"))")
            do { try data.write(to: tmp) } catch { call.reject("could not stage upload"); return }
            fileUrl = tmp
        }
        guard let body = fileUrl else { call.reject("no path or b64"); return }

        var req = URLRequest(url: url)
        req.httpMethod = method
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }

        let task = session.uploadTask(with: req, fromFile: body)
        // taskDescription is the ONLY field that survives into a delegate
        // callback after the app has been relaunched by the system.
        task.taskDescription = id
        task.resume()
        call.resolve(["queued": true, "id": id])
    }

    @objc func results(_ call: CAPPluginCall) {
        let l = Self.readLedger()
        var out: [[String: Any]] = []
        for (id, v) in l {
            out.append(["id": id, "ok": (v["ok"] as? Bool) ?? false,
                        "status": (v["status"] as? Int) ?? 0, "ts": (v["ts"] as? Double) ?? 0])
        }
        call.resolve(["results": out])
    }

    // Called once JS has folded a result into its own records. Ledger entries
    // are cleared BY ID so a result landing mid-reconcile is never dropped.
    @objc func clear(_ call: CAPPluginCall) {
        let ids = call.getArray("ids") as? [String] ?? []
        Self.ledgerLock.lock(); defer { Self.ledgerLock.unlock() }
        var l = Self.readLedger()
        if ids.isEmpty { l = [:] } else { for id in ids { l.removeValue(forKey: id) } }
        Self.writeLedger(l)
        call.resolve()
    }

    @objc func pending(_ call: CAPPluginCall) {
        session.getAllTasks { tasks in
            call.resolve(["ids": tasks.compactMap { $0.taskDescription }])
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let ok = error == nil && (200...299).contains(status)
        Self.record(id, ok: ok, status: status)
        // Tell JS too, for the common case where the app IS running; the
        // ledger covers the case where it is not.
        notifyListeners("done", data: ["id": id, "ok": ok, "status": status])
    }
}
