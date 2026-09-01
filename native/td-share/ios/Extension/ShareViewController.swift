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
            // vCards first, THEN images, then PDFs, then anything file-shaped.
            // Order is load-bearing: a vCard conforms to public.data, so asking
            // for .data first would hand back the right bytes under the wrong
            // name, and the app types a shared file by its extension. A
            // homeowner texting a photo, a supplier emailing a PDF invoice and
            // a contact shared out of Contacts are all real, and all belong here.
            let types: [UTType] = [.vCard, .image, .pdf, .fileURL, .data]
            guard let type = types.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else { continue }
            // What the file must be CALLED when the item arrives as raw bytes
            // with no URL to take a name from.
            let fallbackExt = Self.fallbackExtension(for: type)
            group.enter()
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { [weak self] item, _ in
                defer { group.leave() }
                guard let self = self, let dir = self.inboxDir() else { return }
                let stamp = Int(Date().timeIntervalSince1970 * 1000)
                if let url = item as? URL, let data = try? Data(contentsOf: url) {
                    let ext = url.pathExtension.isEmpty ? fallbackExt : url.pathExtension
                    try? data.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).\(ext)"))
                } else if let image = item as? UIImage, let jpg = image.jpegData(compressionQuality: 0.85) {
                    try? jpg.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).jpg"))
                } else if let data = item as? Data {
                    try? data.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).\(fallbackExt)"))
                } else if let text = item as? NSString, type == .vCard,
                          let data = (text as String).data(using: .utf8) {
                    // Contacts can hand a vCard over as a string rather than
                    // bytes; same card, different box.
                    try? data.write(to: dir.appendingPathComponent("td_share_\(stamp)_\(UUID().uuidString.prefix(6)).vcf"))
                }
            }
        }
        // Never hang the share sheet on a slow item: whatever landed is kept,
        // whatever did not is simply re-shareable.
        group.notify(queue: .main) { [weak self] in self?.finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.finish() }
    }

    // Kept next to the type list it mirrors: every entry there needs a name
    // here, or a shared item lands as .dat and the app cannot tell what it is.
    private static func fallbackExtension(for type: UTType) -> String {
        switch type {
        case .vCard:   return "vcf"
        case .image:   return "jpg"
        case .pdf:     return "pdf"
        default:       return type.preferredFilenameExtension ?? "dat"
        }
    }

    private var finished = false
    private func finish() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
