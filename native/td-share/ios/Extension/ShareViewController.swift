import UIKit
import Social
import UniformTypeIdentifiers

// The share extension: no UI, no picker, no decisions.
//
// It runs in a separate, memory-starved process that iOS terminates without
// warning, so it does exactly ONE thing that must not fail: get the bytes into
// the App Group container. Which job they belong to is asked later, in the
// app, where the job list and the crew's context already are.
//
// Silence is deliberate. A share sheet that pops a picker, waits on a sync, or
// shows an error is a share sheet people stop using; this one closes instantly
// and the app says "3 photos are waiting" the next time it opens.
class ShareViewController: UIViewController {

    static let appGroup = "group.app.tradedesk.beta"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleAll()
    }

    private func inboxDir() -> URL? {
        guard let base = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else { return nil }
        let dir = base.appendingPathComponent("shared-inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func handleAll() {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard !providers.isEmpty else { finish(); return }

        let group = DispatchGroup()
        for provider in providers {
            // Images first, then PDFs, then anything file-shaped. A homeowner
            // texting a photo and a supplier emailing a PDF invoice are both
            // real, and both belong on a job.
            let types: [UTType] = [.image, .pdf, .fileURL, .data]
            guard let type = types.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else { continue }
            group.enter()
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { [weak self] item, _ in
                defer { group.leave() }
                guard let self = self, let dir = self.inboxDir() else { return }
                let stamp = Int(Date().timeIntervalSince1970 * 1000)
                if let url = item as? URL, let data = try? Data(contentsOf: url) {
                    let ext = url.pathExtension.isEmpty ? "dat" : url.pathExtension
                    try? data.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).\(ext)"))
                } else if let image = item as? UIImage, let jpg = image.jpegData(compressionQuality: 0.85) {
                    try? jpg.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).jpg"))
                } else if let data = item as? Data {
                    try? data.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).dat"))
                }
            }
        }
        // Never hang the share sheet on a slow item: whatever landed is kept,
        // whatever did not is simply re-shareable.
        group.notify(queue: .main) { [weak self] in self?.finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.finish() }
    }

    private var finished = false
    private func finish() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
