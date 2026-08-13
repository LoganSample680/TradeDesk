import Foundation
import Capacitor
import UIKit
#if canImport(VisionKit)
import VisionKit
#endif
import Vision

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
        CAPPluginMethod(name: "recognizeText", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

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
    @objc func recognizeText(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("no path"); return }
        guard #available(iOS 13.0, *) else { call.resolve(["lines": [], "ok": false]); return }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let image = UIImage(contentsOfFile: path), let cg = image.cgImage else {
                call.resolve(["lines": [], "ok": false])
                return
            }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate      // .fast loses small print, which is where totals live
            request.usesLanguageCorrection = false    // prices and SKUs are not words; correction mangles them
            if #available(iOS 16.0, *) {
                request.revision = VNRecognizeTextRequestRevision3
            }
            let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
            do { try handler.perform([request]) }
            catch { call.resolve(["lines": [], "ok": false]); return }

            // Sort top-to-bottom: Vision returns observations in confidence
            // order, and receipt meaning is entirely positional (the total is
            // near the bottom, the vendor at the top). Vision's Y origin is
            // bottom-left, so descending Y is visual top-down.
            let observations = (request.results ?? [])
                .sorted { $0.boundingBox.midY > $1.boundingBox.midY }
            var lines: [String] = []
            for ob in observations {
                guard let best = ob.topCandidates(1).first else { continue }
                let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { lines.append(text) }
            }
            call.resolve(["lines": lines, "ok": true])
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
