// Adversarial coverage for TdImagePlugin (native/td-image/ios/Plugin/TdImagePlugin.swift).
//
// The plugin turns the full-size copy of a job photo into HEIC. What can go
// wrong, and what these pin:
//   - a real image in, a real HEIC out, same pixel size, smaller than JPEG
//   - the coordinates land in the file, with the right hemisphere refs
//   - garbage, empty, missing and wrong-typed input reject instead of crash
//   - a device that cannot write HEIC says so instead of producing nothing
//   - many encodes at once all resolve
import XCTest
import Capacitor
import ImageIO
import UIKit
@testable import TdImage

final class TdImagePluginTests: XCTestCase {
    var plugin: TdImagePlugin!

    override func setUp() { super.setUp(); plugin = TdImagePlugin() }
    override func tearDown() { plugin = nil; super.tearDown() }

    func makeCall(options: [String: Any] = [:],
                  onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
                  onError: @escaping (String) -> Void = { _ in }) -> CAPPluginCall {
        CAPPluginCall(callbackId: "test-\(UUID().uuidString)", methodName: "heic", options: options,
                      success: { r, _ in onSuccess(r?.data) },
                      error: { e in onError(e?.message ?? "(no message)") })
    }

    // A noisy 1200x900 JPEG, so the encoder has real detail to compress.
    // Scale 1 so the size is in pixels: the renderer otherwise draws at the
    // screen's scale and a 1200-point image comes out 3600 pixels wide.
    func sampleJpeg(w: Int = 1200, h: Int = 900) -> Data {
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let r = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: fmt)
        let img = r.image { ctx in
            for y in stride(from: 0, to: h, by: 12) {
                for x in stride(from: 0, to: w, by: 12) {
                    UIColor(hue: CGFloat((x * 7 + y * 3) % 360) / 360, saturation: 0.6, brightness: 0.8, alpha: 1).setFill()
                    ctx.fill(CGRect(x: x, y: y, width: 12, height: 12))
                }
            }
        }
        return img.jpegData(compressionQuality: 0.86)!
    }

    func props(_ d: Data) -> [String: Any] {
        let src = CGImageSourceCreateWithData(d as CFData, nil)!
        return (CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any]) ?? [:]
    }

    // ── the encoder ─────────────────────────────────────────────────────────

    func testEncodesSamePixelsSmallerThanJpeg() throws {
        try XCTSkipUnless(TdImagePlugin.canEncode(), "this simulator cannot write HEIC")
        let jpeg = sampleJpeg()
        let heic = try XCTUnwrap(TdImagePlugin.encodeHeic(jpeg, quality: 0.65))
        let src = try XCTUnwrap(CGImageSourceCreateWithData(heic as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(src) as String?, "public.heic")
        let p = props(heic)
        XCTAssertEqual(p[kCGImagePropertyPixelWidth as String] as? Int, 1200)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight as String] as? Int, 900)
        XCTAssertLessThan(heic.count, jpeg.count)
    }

    func testGpsLandsInTheFileWithHemisphereRefs() throws {
        try XCTSkipUnless(TdImagePlugin.canEncode(), "this simulator cannot write HEIC")
        let gps = TdImagePlugin.gpsDict(lat: 39.03, lon: -95.71, accM: 8, epochMs: 1790875230257)
        let heic = try XCTUnwrap(TdImagePlugin.encodeHeic(sampleJpeg(), quality: 0.65, gps: gps))
        let g = try XCTUnwrap(props(heic)[kCGImagePropertyGPSDictionary as String] as? [String: Any])
        XCTAssertEqual(g[kCGImagePropertyGPSLatitude as String] as? Double ?? 0, 39.03, accuracy: 0.0001)
        XCTAssertEqual(g[kCGImagePropertyGPSLatitudeRef as String] as? String, "N")
        XCTAssertEqual(g[kCGImagePropertyGPSLongitude as String] as? Double ?? 0, 95.71, accuracy: 0.0001)
        XCTAssertEqual(g[kCGImagePropertyGPSLongitudeRef as String] as? String, "W")
    }

    func testGarbageAndEmptyInputGiveNil() {
        XCTAssertNil(TdImagePlugin.encodeHeic(Data(), quality: 0.65))
        XCTAssertNil(TdImagePlugin.encodeHeic(Data("not an image".utf8), quality: 0.65))
    }

    func testOutOfRangeQualityIsClampedNotFatal() throws {
        try XCTSkipUnless(TdImagePlugin.canEncode(), "this simulator cannot write HEIC")
        XCTAssertNotNil(TdImagePlugin.encodeHeic(sampleJpeg(w: 200, h: 150), quality: -3))
        XCTAssertNotNil(TdImagePlugin.encodeHeic(sampleJpeg(w: 200, h: 150), quality: 40))
        XCTAssertNotNil(TdImagePlugin.encodeHeic(sampleJpeg(w: 200, h: 150), quality: .nan))
    }

    // ── gpsDict boundaries ──────────────────────────────────────────────────

    func testGpsDictRejectsUnusableFixes() {
        XCTAssertTrue(TdImagePlugin.gpsDict(lat: nil, lon: -95, accM: nil, epochMs: nil).isEmpty)
        XCTAssertTrue(TdImagePlugin.gpsDict(lat: 0, lon: 0, accM: nil, epochMs: nil).isEmpty)
        XCTAssertTrue(TdImagePlugin.gpsDict(lat: 91, lon: 10, accM: nil, epochMs: nil).isEmpty)
        XCTAssertTrue(TdImagePlugin.gpsDict(lat: .nan, lon: 10, accM: nil, epochMs: nil).isEmpty)
        let s = TdImagePlugin.gpsDict(lat: -33.9, lon: 151.2, accM: -1, epochMs: nil)
        XCTAssertEqual(s[kCGImagePropertyGPSLatitudeRef as String] as? String, "S")
        XCTAssertEqual(s[kCGImagePropertyGPSLongitudeRef as String] as? String, "E")
        XCTAssertNil(s[kCGImagePropertyGPSHPositioningError as String], "a negative accuracy is not written")
    }

    // ── the bridge surface ──────────────────────────────────────────────────

    func testIsAvailableAnswersTheCapability() {
        let exp = expectation(description: "resolved")
        plugin.isAvailable(makeCall(onSuccess: { r in
            XCTAssertEqual(r?["available"] as? Bool, TdImagePlugin.canEncode()); exp.fulfill()
        }))
        wait(for: [exp], timeout: 2)
    }

    func testMissingWrongTypedAndBadBase64Reject() {
        for opts: [String: Any] in [[:], ["data": 42], ["data": ""], ["data": "%%%not base64%%%"]] {
            let exp = expectation(description: "rejected \(opts)")
            plugin.heic(makeCall(options: opts, onSuccess: { _ in XCTFail("should reject \(opts)") },
                                 onError: { _ in exp.fulfill() }))
            wait(for: [exp], timeout: 5)
        }
    }

    func testValidImageThroughTheBridge() throws {
        try XCTSkipUnless(TdImagePlugin.canEncode(), "this simulator cannot write HEIC")
        let exp = expectation(description: "resolved")
        plugin.heic(makeCall(options: ["data": sampleJpeg().base64EncodedString(), "quality": 0.6, "lat": 39.0, "lon": -95.7],
                             onSuccess: { r in
            XCTAssertGreaterThan(r?["bytes"] as? Int ?? 0, 0)
            XCTAssertNotNil(Data(base64Encoded: r?["data"] as? String ?? ""))
            exp.fulfill()
        }, onError: { e in XCTFail(e) }))
        wait(for: [exp], timeout: 15)
    }

    func testConcurrentEncodesAllResolve() throws {
        try XCTSkipUnless(TdImagePlugin.canEncode(), "this simulator cannot write HEIC")
        let b64 = sampleJpeg(w: 400, h: 300).base64EncodedString()
        var exps: [XCTestExpectation] = []
        for i in 0..<8 {
            let e = expectation(description: "encode \(i)"); exps.append(e)
            plugin.heic(makeCall(options: ["data": b64], onSuccess: { _ in e.fulfill() }, onError: { m in XCTFail(m) }))
        }
        wait(for: exps, timeout: 30)
    }
}
