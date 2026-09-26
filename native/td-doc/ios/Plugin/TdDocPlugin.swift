import Foundation
import Capacitor
import UIKit
#if canImport(VisionKit)
import VisionKit
#endif
import Vision
import MessageUI

// TradeDesk receipt scanner, the native half.
//
// This wraps VNDocumentCameraViewController: the exact document scanner in
// Notes, Files and Mail. It is meaningfully better than the canvas pipeline it
// replaces inside the app (owner, 2026-08-09: "I thought native iOS had a
// better more reliable way", and they were right):
//
//   • Apple's own edge detection rather than our Sobel filter on a downscaled
//     frame, so a receipt on a dark truck seat or a patterned counter is found.
//   • Auto-capture the moment the frame is steady and square, no shutter tap.
//   • Glare, shadow and low-light handling, and colour/contrast processing
//     tuned on Apple's own corpus.
//   • Corner adjustment and retake built in, so a bad page never costs the
//     whole capture.
//   • Multi-page in one session.
//
// The web canvas pipeline stays exactly where it was, as the browser fallback:
// this plugin does not exist there.
//
// Pages are written as JPEGs to Documents and returned as paths; JS reads them
// back through Capacitor.convertFileSrc, the same route the LiDAR scanner's
// photos already take.
@objc(TdDocPlugin)
public class TdDocPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdDocPlugin"
    public let jsName = "TdDoc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "composeEmail", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?
    private var pendingMail: CAPPluginCall?

    // ── On-device text recognition (owner 2026-08-11) ────────────────────────
    // Reads a scanned page with Apple's Vision OCR: under a second, free, and
    // it works with NO SIGNAL, which is the real win (basements, rural jobs,
    // parking garages, where a contractor most often photographs a receipt).
    //
    // Deliberately raw: this returns LINES OF TEXT, top to bottom, and makes
    // no attempt to decide which number is the total. That judgment is the
    // part OCR is bad at and belongs in JS (_rcptParseLines, js/finance.js)
    // where it is testable and tunable without a build. The AI pass still
    // runs and still wins on a messy receipt; this is what fills the fields
    // instantly and what carries the expense when there is no network.
    //
    // 2026-09-26 (supply house quotes): two additions, both still raw.
    //   • PDFs. A supply house emails its quote as a PDF, and Neenan's are
    //     SCANS with no text layer, so each page is rendered to an image and
    //     read. A path ending in .pdf, or `base64` with `mime`
    //     "application/pdf", takes that route; anything else is an image.
    //   • `boxes`: every piece of text with WHERE it sits (page, x, y, w, h,
    //     normalized 0..1, top-left origin). A quote is a table, and Vision
    //     returns a row's columns as separate observations; only their
    //     positions let JS put "3ea", "149505", the description and the two
    //     prices back on one row. Rebuilding the rows is JS's job
    //     (_supRowsFromBoxes, js/supply-list.js), tunable without a build.
    // `lines` keep their top-to-bottom order, so the receipt reader reads as before.
    @objc func recognizeText(_ call: CAPPluginCall) {
        let path = call.getString("path")
        let b64 = call.getString("base64")
        let mime = call.getString("mime") ?? ""
        guard path != nil || b64 != nil else { call.reject("no path"); return }
        guard #available(iOS 13.0, *) else { call.resolve(["lines": [], "boxes": [], "ok": false]); return }
        DispatchQueue.global(qos: .userInitiated).async {
            var images: [CGImage] = []
            if let path = path {
                images = TdDocPlugin.pageImages(path: path)
            } else if let b64 = b64, let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) {
                images = TdDocPlugin.pageImages(data: data, isPDF: mime == "application/pdf")
            }
            if images.isEmpty { call.resolve(["lines": [], "boxes": [], "ok": false]); return }
            var lines: [String] = []
            var boxes: [[String: Any]] = []
            for (i, cg) in images.enumerated() {
                let obs = TdDocPlugin.recognize(cg)
                for o in obs {
                    lines.append(o.text)
                    boxes.append(["text": o.text, "page": i, "x": o.x, "y": o.y, "w": o.w, "h": o.h])
                }
            }
            call.resolve(["lines": lines, "boxes": boxes, "ok": true, "pages": images.count])
        }
    }

    struct TextBox { let text: String; let x: Double; let y: Double; let w: Double; let h: Double }

    // Vision's rectangles are normalized with a BOTTOM-left origin. Flipped to
    // top-left here so JS reads y the way a page reads: down.
    static func topLeft(_ r: CGRect) -> (x: Double, y: Double, w: Double, h: Double) {
        let x = min(max(Double(r.minX), 0), 1)
        let y = min(max(1 - Double(r.maxY), 0), 1)
        return (x, y, min(max(Double(r.width), 0), 1), min(max(Double(r.height), 0), 1))
    }

    // Read one page. Top-to-bottom, then left-to-right within a line, so the
    // flat `lines` keep the order a receipt was always read in.
    @available(iOS 13.0, *)
    static func recognize(_ cg: CGImage) -> [TextBox] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate      // .fast loses small print, which is where totals live
        request.usesLanguageCorrection = false    // prices and SKUs are not words; correction mangles them
        if #available(iOS 16.0, *) {
            request.revision = VNRecognizeTextRequestRevision3
        }
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
        do { try handler.perform([request]) } catch { return [] }
        var out: [TextBox] = []
        for ob in (request.results ?? []) {
            guard let best = ob.topCandidates(1).first else { continue }
            let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let b = topLeft(ob.boundingBox)
            out.append(TextBox(text: text, x: b.x, y: b.y, w: b.w, h: b.h))
        }
        return out.sorted { abs($0.y - $1.y) > 0.004 ? $0.y < $1.y : $0.x < $1.x }
    }

    static func pageImages(path: String) -> [CGImage] {
        if path.lowercased().hasSuffix(".pdf") {
            guard let data = FileManager.default.contents(atPath: path) else { return [] }
            return pageImages(data: data, isPDF: true)
        }
        guard let image = UIImage(contentsOfFile: path), let cg = image.cgImage else { return [] }
        return [cg]
    }

    // A quote is rarely more than a few pages; the cap keeps a 200-page
    // statement someone shared by mistake from pinning the CPU.
    static let maxPages = 10

    static func pageImages(data: Data, isPDF: Bool) -> [CGImage] {
        if !isPDF {
            guard let image = UIImage(data: data), let cg = image.cgImage else { return [] }
            return [cg]
        }
        guard let provider = CGDataProvider(data: data as CFData),
              let doc = CGPDFDocument(provider) else { return [] }
        var out: [CGImage] = []
        let count = min(doc.numberOfPages, maxPages)
        if count < 1 { return [] }
        for n in 1...count {
            guard let page = doc.page(at: n) else { continue }
            if let cg = render(page) { out.append(cg) }
        }
        return out
    }

    // ~200 dpi for a letter page: small type on a scanned quote stays legible
    // to Vision, and the longest side is capped so a huge page cannot run the
    // phone out of memory.
    static func render(_ page: CGPDFPage) -> CGImage? {
        let box = page.getBoxRect(.mediaBox)
        if box.width <= 0 || box.height <= 0 { return nil }
        let scale = min(2.8, 2400 / max(box.width, box.height))
        let w = Int(box.width * scale), h = Int(box.height * scale)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -box.minX, y: -box.minY)
        ctx.drawPDFPage(page)
        return ctx.makeImage()
    }

    // ── Email from HIS mail app (owner 2026-09-26) ──────────────────────────
    // "Don't want to use my Resend thing, want it to open up the contractor's
    // own email app and send from there with the quote attached." Apple's
    // mail composer, prefilled: to, subject, body, one attachment. It sends
    // from his own account, lands in his own Sent folder, and the supply
    // house replies to him. Raw capability only: what goes in the email is
    // decided in JS (js/supply-list.js).
    //
    // Resolves {result: "sent" | "saved" | "cancelled" | "failed" | "unavailable"}.
    // "unavailable" means Apple Mail has no account on this phone (a Gmail- or
    // Outlook-only user); JS then offers the share sheet, where those apps are.
    @objc func composeEmail(_ call: CAPPluginCall) {
        guard let to = call.getString("to"), !to.isEmpty else { call.reject("no recipient"); return }
        var attachment: Data? = nil
        if let b64 = call.getString("attachmentBase64") {
            guard let d = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), !d.isEmpty else {
                call.reject("bad attachment"); return
            }
            attachment = d
        }
        DispatchQueue.main.async {
            guard MFMailComposeViewController.canSendMail() else {
                call.resolve(["result": "unavailable"]); return
            }
            if self.pendingMail != nil { call.reject("a mail is already open"); return }
            let vc = MFMailComposeViewController()
            vc.mailComposeDelegate = self
            vc.setToRecipients([to])
            vc.setSubject(call.getString("subject") ?? "")
            vc.setMessageBody(call.getString("body") ?? "", isHTML: false)
            if let data = attachment {
                vc.addAttachmentData(data, mimeType: call.getString("mime") ?? "application/pdf",
                                     fileName: call.getString("filename") ?? "Materials.pdf")
            }
            call.keepAlive = true
            self.pendingMail = call
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    static func mailResultName(_ r: MFMailComposeResult) -> String {
        switch r {
        case .sent: return "sent"
        case .saved: return "saved"
        case .cancelled: return "cancelled"
        case .failed: return "failed"
        @unknown default: return "failed"
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(VisionKit)
        if #available(iOS 13.0, *) {
            call.resolve(["available": VNDocumentCameraViewController.isSupported])
            return
        }
        #endif
        call.resolve(["available": false])
    }

    @objc func scanDocument(_ call: CAPPluginCall) {
        #if canImport(VisionKit)
        if #available(iOS 13.0, *) {
            guard VNDocumentCameraViewController.isSupported else {
                call.reject("document scanning not supported on this device")
                return
            }
            call.keepAlive = true
            pending = call
            DispatchQueue.main.async {
                let vc = VNDocumentCameraViewController()
                vc.delegate = self
                vc.modalPresentationStyle = .fullScreen
                self.bridge?.viewController?.present(vc, animated: true)
            }
            return
        }
        #endif
        call.reject("requires iOS 13")
    }

    fileprivate func finish(_ paths: [String], cancelled: Bool) {
        guard let call = pending else { return }
        pending = nil
        if cancelled && paths.isEmpty {
            // A cancel is a normal outcome, not an error: JS treats an empty
            // page list as "they backed out" and leaves the expense untouched.
            call.resolve(["pages": [], "cancelled": true])
        } else {
            call.resolve(["pages": paths, "cancelled": false])
        }
        bridge?.releaseCall(call)
    }
}

#if canImport(VisionKit)
@available(iOS 13.0, *)
extension TdDocPlugin: VNDocumentCameraViewControllerDelegate {
    public func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                             didFinishWith scan: VNDocumentCameraScan) {
        var paths: [String] = []
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        for i in 0..<scan.pageCount {
            let img = scan.imageOfPage(at: i)
            // 0.82 keeps text crisp enough for OCR while staying small enough
            // to upload from a job site on one bar of signal.
            guard let data = img.jpegData(compressionQuality: 0.82) else { continue }
            let url = dir.appendingPathComponent("td_rcpt_\(stamp)_\(i).jpg")
            do { try data.write(to: url); paths.append(url.path) } catch { continue }
        }
        controller.dismiss(animated: true) { [weak self] in
            self?.finish(paths, cancelled: false)
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true) { [weak self] in
            self?.finish([], cancelled: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                             didFailWithError error: Error) {
        controller.dismiss(animated: true) { [weak self] in
            self?.finish([], cancelled: true)
        }
    }
}
#endif

extension TdDocPlugin: MFMailComposeViewControllerDelegate {
    public func mailComposeController(_ controller: MFMailComposeViewController,
                                      didFinishWith result: MFMailComposeResult, error: Error?) {
        controller.dismiss(animated: true) { [weak self] in
            guard let self = self, let call = self.pendingMail else { return }
            self.pendingMail = nil
            call.resolve(["result": TdDocPlugin.mailResultName(result)])
            self.bridge?.releaseCall(call)
        }
    }
}
