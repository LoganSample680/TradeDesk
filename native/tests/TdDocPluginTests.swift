// Adversarial coverage for TdDocPlugin.recognizeText
// (native/td-doc/ios/Plugin/TdDocPlugin.swift).
//
// WHY NOW (2026-09-26). recognizeText learned to open PDFs and to return
// where each piece of text sits, because supply house quotes arrive as
// scanned PDFs and a quote is a table (js/supply-list.js rebuilds the rows).
// The owner wants that read on the phone with no AI in it, so this is the
// whole reader, and these tests are what stands between a quote and a wrong
// price on a proposal.
//
// What is stressed: the PDF route (real PDFs drawn here, garbage, too many
// pages), the coordinate flip JS depends on, a real Vision read of drawn text
// (row order and the digits themselves), and the @objc surface called the
// way the bridge calls it: arguments missing, malformed, and many at once.
import XCTest
import Capacitor
import UIKit
import MessageUI
@testable import TdDoc

final class TdDocPluginTests: XCTestCase {
    var plugin: TdDocPlugin!

    override func setUp() {
        super.setUp()
        plugin = TdDocPlugin()
    }
    override func tearDown() {
        plugin = nil
        super.tearDown()
    }

    func makeCall(
        options: [String: Any] = [:],
        onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
        onError: @escaping (String) -> Void = { _ in }
    ) -> CAPPluginCall {
        CAPPluginCall(
            callbackId: "test-\(UUID().uuidString)",
            methodName: "recognizeText",
            options: options,
            success: { result, _ in onSuccess(result?.data) },
            error: { error in onError(error?.message ?? "(no error message)") }
        )
    }

    // A letter-size PDF with one line of large text per entry, top to bottom.
    func makePDF(pages: Int, lines: [String] = ["1ea 403386 ANODE ROD 161.708 161.71"]) -> Data {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        return renderer.pdfData { ctx in
            for _ in 0..<pages {
                ctx.beginPage()
                let attrs: [NSAttributedString.Key: Any] = [.font: UIFont(name: "Courier-Bold", size: 22) ?? UIFont.systemFont(ofSize: 22)]
                for (i, line) in lines.enumerated() {
                    (line as NSString).draw(at: CGPoint(x: 36, y: 60 + CGFloat(i) * 60), withAttributes: attrs)
                }
            }
        }
    }

    // ── Coordinates ─────────────────────────────────────────────────────────
    func testTopLeftFlipsTheYAxis() {
        // Vision: origin bottom-left. A box near the TOP of the page has a high minY.
        let b = TdDocPlugin.topLeft(CGRect(x: 0.1, y: 0.8, width: 0.3, height: 0.05))
        XCTAssertEqual(b.x, 0.1, accuracy: 1e-9)
        XCTAssertEqual(b.y, 0.15, accuracy: 1e-9)
        XCTAssertEqual(b.w, 0.3, accuracy: 1e-9)
        XCTAssertEqual(b.h, 0.05, accuracy: 1e-9)
    }

    func testTopLeftClampsOutOfRangeBoxes() {
        let b = TdDocPlugin.topLeft(CGRect(x: -0.2, y: 0.95, width: 1.5, height: 0.2))
        XCTAssertEqual(b.x, 0)
        XCTAssertEqual(b.y, 0)
        XCTAssertLessThanOrEqual(b.w, 1)
        XCTAssertLessThanOrEqual(b.h, 1)
    }

    // ── PDFs ────────────────────────────────────────────────────────────────
    func testPDFRendersOneImagePerPage() {
        XCTAssertEqual(TdDocPlugin.pageImages(data: makePDF(pages: 2), isPDF: true).count, 2)
    }

    func testPageCountIsCapped() {
        let imgs = TdDocPlugin.pageImages(data: makePDF(pages: TdDocPlugin.maxPages + 3), isPDF: true)
        XCTAssertEqual(imgs.count, TdDocPlugin.maxPages)
    }

    func testRenderedPageIsLargeEnoughToRead() {
        guard let cg = TdDocPlugin.pageImages(data: makePDF(pages: 1), isPDF: true).first else { return XCTFail("no page") }
        XCTAssertGreaterThanOrEqual(max(cg.width, cg.height), 2000)
        XCTAssertLessThanOrEqual(max(cg.width, cg.height), 2401)
    }

    func testGarbageNeverCrashes() {
        let junk = Data([0x00, 0x01, 0x02, 0xFF, 0x25, 0x50])
        XCTAssertTrue(TdDocPlugin.pageImages(data: junk, isPDF: true).isEmpty)
        XCTAssertTrue(TdDocPlugin.pageImages(data: junk, isPDF: false).isEmpty)
        XCTAssertTrue(TdDocPlugin.pageImages(data: Data(), isPDF: true).isEmpty)
        XCTAssertTrue(TdDocPlugin.pageImages(path: "/nonexistent/quote.pdf").isEmpty)
        XCTAssertTrue(TdDocPlugin.pageImages(path: "/nonexistent/photo.jpg").isEmpty)
    }

    func testPDFOnDiskIsReadFromItsPath() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("td_quote_\(UUID().uuidString).pdf")
        try makePDF(pages: 1).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(TdDocPlugin.pageImages(path: url.path).count, 1)
    }

    // ── Reading ─────────────────────────────────────────────────────────────
    func testReadsTheDigitsOfAQuoteRowInPageOrder() throws {
        guard #available(iOS 13.0, *) else { throw XCTSkip("Vision text needs iOS 13") }
        let pdf = makePDF(pages: 1, lines: ["1ea 403386 ANODE ROD 161.708 161.71", "3ea 149505 BALL VALVE 13.497 40.49"])
        guard let cg = TdDocPlugin.pageImages(data: pdf, isPDF: true).first else { return XCTFail("no page") }
        let boxes = TdDocPlugin.recognize(cg)
        XCTAssertFalse(boxes.isEmpty)
        let joined = boxes.map { $0.text }.joined(separator: " ")
        XCTAssertTrue(joined.contains("403386"), joined)
        XCTAssertTrue(joined.contains("161.71"), joined)
        // The first row reads above the second.
        let a = boxes.first { $0.text.contains("403386") }
        let b = boxes.first { $0.text.contains("149505") }
        if let a = a, let b = b { XCTAssertLessThan(a.y, b.y) }
        for bx in boxes {
            XCTAssertTrue((0...1).contains(bx.x) && (0...1).contains(bx.y), "normalized")
        }
    }

    // ── The bridge surface ──────────────────────────────────────────────────
    func testNoArgumentsRejects() {
        let done = expectation(description: "rejected")
        plugin.recognizeText(makeCall(onSuccess: { _ in XCTFail("should reject") }, onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 5)
    }

    func testMalformedBase64ResolvesEmpty() {
        let done = expectation(description: "resolved")
        plugin.recognizeText(makeCall(options: ["base64": "%%%not base64%%%", "mime": "application/pdf"], onSuccess: { r in
            XCTAssertEqual(r?["ok"] as? Bool, false)
            XCTAssertEqual((r?["boxes"] as? [Any])?.count, 0)
            done.fulfill()
        }))
        wait(for: [done], timeout: 10)
    }

    func testPDFAsBase64ReturnsBoxesWithPositions() {
        let done = expectation(description: "resolved")
        let b64 = makePDF(pages: 1).base64EncodedString()
        plugin.recognizeText(makeCall(options: ["base64": b64, "mime": "application/pdf"], onSuccess: { r in
            XCTAssertEqual(r?["ok"] as? Bool, true)
            XCTAssertEqual(r?["pages"] as? Int, 1)
            let boxes = (r?["boxes"] as? [[String: Any]]) ?? []
            XCTAssertFalse(boxes.isEmpty)
            if let first = boxes.first {
                for k in ["text", "page", "x", "y", "w", "h"] { XCTAssertNotNil(first[k], k) }
            }
            XCTAssertFalse(((r?["lines"] as? [String]) ?? []).isEmpty)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testManyReadsAtOnceAllAnswer() {
        let b64 = makePDF(pages: 1).base64EncodedString()
        var exps: [XCTestExpectation] = []
        for i in 0..<6 {
            let e = expectation(description: "read \(i)")
            exps.append(e)
            plugin.recognizeText(makeCall(options: ["base64": b64, "mime": "application/pdf"],
                                          onSuccess: { _ in e.fulfill() }, onError: { _ in e.fulfill() }))
        }
        wait(for: exps, timeout: 60)
    }

    // ── composeEmail ────────────────────────────────────────────────────────
    func mailCall(_ options: [String: Any], onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
                  onError: @escaping (String) -> Void = { _ in }) -> CAPPluginCall {
        CAPPluginCall(callbackId: "mail-\(UUID().uuidString)", methodName: "composeEmail", options: options,
                      success: { r, _ in onSuccess(r?.data) }, error: { e in onError(e?.message ?? "") })
    }

    func testComposeWithoutRecipientRejects() {
        let done = expectation(description: "rejected")
        plugin.composeEmail(mailCall([:], onSuccess: { _ in XCTFail("should reject") }, onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 5)
        let done2 = expectation(description: "rejected empty")
        plugin.composeEmail(mailCall(["to": ""], onSuccess: { _ in XCTFail("should reject") }, onError: { _ in done2.fulfill() }))
        wait(for: [done2], timeout: 5)
    }

    func testComposeWithBadAttachmentRejects() {
        let done = expectation(description: "rejected")
        plugin.composeEmail(mailCall(["to": "a@b.co", "attachmentBase64": "%%%"],
                                     onSuccess: { _ in XCTFail("should reject") }, onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 5)
    }

    // The simulator has no Mail account, which is exactly the Gmail-only
    // contractor's phone: it must answer "unavailable", never hang or crash.
    func testComposeWithNoMailAccountSaysUnavailable() throws {
        if MFMailComposeViewController.canSendMail() { throw XCTSkip("this device has a Mail account") }
        let done = expectation(description: "resolved")
        let pdf = makePDF(pages: 1).base64EncodedString()
        plugin.composeEmail(mailCall(["to": "quotes@supply.example", "subject": "Quote request", "body": "Hi",
                                      "attachmentBase64": pdf, "filename": "Materials.pdf"], onSuccess: { r in
            XCTAssertEqual(r?["result"] as? String, "unavailable")
            done.fulfill()
        }))
        wait(for: [done], timeout: 5)
    }

    func testComposeCalledManyTimesAlwaysAnswers() throws {
        if MFMailComposeViewController.canSendMail() { throw XCTSkip("would present real composers") }
        var exps: [XCTestExpectation] = []
        for i in 0..<8 {
            let e = expectation(description: "mail \(i)")
            exps.append(e)
            plugin.composeEmail(mailCall(["to": "a@b.co"], onSuccess: { _ in e.fulfill() }, onError: { _ in e.fulfill() }))
        }
        wait(for: exps, timeout: 10)
    }

    func testMailResultNames() {
        XCTAssertEqual(TdDocPlugin.mailResultName(.sent), "sent")
        XCTAssertEqual(TdDocPlugin.mailResultName(.saved), "saved")
        XCTAssertEqual(TdDocPlugin.mailResultName(.cancelled), "cancelled")
        XCTAssertEqual(TdDocPlugin.mailResultName(.failed), "failed")
    }
}
