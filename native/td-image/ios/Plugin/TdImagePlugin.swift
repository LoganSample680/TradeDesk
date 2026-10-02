import Foundation
import Capacitor
import ImageIO

// TradeDesk HEIC encoder (owner 2026-10-02: "keep 4k images but scale them
// down so they don't hit storage and egress as hard").
//
// WHY THIS EXISTS: the full-size copy of a job photo keeps every pixel, and a
// web view can only write it as JPEG, about 1 to 1.5 MB a shot even at 0.75.
// HEIC is the iPhone camera's own format and holds the same picture in about
// half the bytes, but only the OS can write it. So the photo goes in, HEIC
// comes out.
//
// Dumb by design (CLAUDE.md 3.2): one verb plus a capability check. Which
// photo, what quality, and whether HEIC is used at all are decided in
// js/photo-capture.js, so all of it is tunable without a build.
@objc(TdImagePlugin)
public class TdImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TdImagePlugin"
    public let jsName = "TdImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "heic", returnType: CAPPluginReturnPromise)
    ]

    static let heicType = "public.heic" as CFString

    // True when this device can write HEIC. Every iPhone since the 7 can; the
    // simulator on some hosts cannot, and JS then keeps the JPEG it already has.
    public static func canEncode() -> Bool {
        let types = (CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []
        return types.contains(heicType as String)
    }

    // The encoder itself, pure so it can be tested without the bridge.
    // `data` is any image ImageIO can read (the JPEG or PNG the web side has).
    // Orientation and any metadata already in it are carried across. `gps`
    // writes the coordinates into the file, the same promise the JPEG path
    // keeps: a photo that leaves the app still says where it was taken.
    // nil when the input is not an image or the device cannot write HEIC.
    public static func encodeHeic(_ data: Data, quality: Double, gps: [String: Any]? = nil) -> Data? {
        guard !data.isEmpty, canEncode(),
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(src) > 0 else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, heicType, 1, nil) else { return nil }
        let q = max(0.05, min(1.0, quality.isFinite ? quality : 0.65))
        var props: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: q]
        if let gps = gps, !gps.isEmpty { props[kCGImagePropertyGPSDictionary] = gps }
        CGImageDestinationAddImageFromSource(dest, src, 0, props as CFDictionary)
        guard CGImageDestinationFinalize(dest), out.length > 0 else { return nil }
        return out as Data
    }

    // The EXIF GPS block for a fix, in the form ImageIO wants (positive
    // magnitudes plus N/S and E/W refs). Empty when the fix is unusable.
    public static func gpsDict(lat: Double?, lon: Double?, accM: Double?, epochMs: Double?) -> [String: Any] {
        guard let lat = lat, let lon = lon, lat.isFinite, lon.isFinite,
              abs(lat) <= 90, abs(lon) <= 180, !(lat == 0 && lon == 0) else { return [:] }
        var d: [String: Any] = [
            kCGImagePropertyGPSLatitude as String: abs(lat),
            kCGImagePropertyGPSLatitudeRef as String: lat >= 0 ? "N" : "S",
            kCGImagePropertyGPSLongitude as String: abs(lon),
            kCGImagePropertyGPSLongitudeRef as String: lon >= 0 ? "E" : "W"
        ]
        if let a = accM, a.isFinite, a >= 0 { d[kCGImagePropertyGPSHPositioningError as String] = a }
        if let ms = epochMs, ms.isFinite, ms > 0 {
            let date = Date(timeIntervalSince1970: ms / 1000)
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "yyyy:MM:dd"
            d[kCGImagePropertyGPSDateStamp as String] = f.string(from: date)
            f.dateFormat = "HH:mm:ss"
            d[kCGImagePropertyGPSTimeStamp as String] = f.string(from: date)
        }
        return d
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": TdImagePlugin.canEncode()])
    }

    // { data: base64, quality?: 0..1, lat?, lon?, accM?, ts?: epoch ms }
    //   -> { data: base64 HEIC, bytes }
    // Off the main thread: a 12 MP encode takes a few hundred milliseconds.
    @objc func heic(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), !b64.isEmpty,
              let input = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
            call.reject("data must be a base64 image")
            return
        }
        let quality = call.getDouble("quality") ?? 0.65
        let gps = TdImagePlugin.gpsDict(lat: call.getDouble("lat"), lon: call.getDouble("lon"),
                                        accM: call.getDouble("accM"), epochMs: call.getDouble("ts"))
        DispatchQueue.global(qos: .userInitiated).async {
            guard let out = TdImagePlugin.encodeHeic(input, quality: quality, gps: gps) else {
                call.reject("could not encode HEIC")
                return
            }
            call.resolve(["data": out.base64EncodedString(), "bytes": out.count])
        }
    }
}
