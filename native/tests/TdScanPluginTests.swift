// Adversarial coverage for TdScanPlugin (native/td-scan/ios/Plugin/TdScanPlugin.swift).
//
// This is the largest plugin in the repo and until now the only one with no
// tests at all. §3.3 says every td-* plugin ships XCTest in the same commit as
// the change; td-scan predates that rule, and because its Swift had not been
// touched since, the advisory job never once flagged it.
//
// WHAT IS WORTH TESTING HERE, and what is not. RoomPlan needs a LiDAR device
// and a real room, so nothing below tries to drive a capture: a test that
// launches a session would be a test of the simulator. What it stresses is
// the part that is pure arithmetic and pure plumbing, which is exactly where
// the bugs that reach a proposal live:
//
//   yawDeg   the camera's bearing in the scene's own frame. Half of the
//            compass fix. Backwards, and every solar-gain direction JS
//            derives is wrong by an arbitrary per-scan amount, silently.
//   ftIn     what the live chips print on a wall. It is the number the
//            contractor reads off the glass and checks against his tape, so
//            an off-by-one-inch rounding here is the whole feature failing at
//            the one moment it is supposed to earn trust.
//   the @objc surface, called the way the bridge calls it, with the arguments
//            missing, wrong-typed, and repeated.
import XCTest
import Capacitor
import simd
import UIKit
@testable import TdScan

final class TdScanPluginTests: XCTestCase {
    var plugin: TdScanPlugin!

    override func setUp() {
        super.setUp()
        plugin = TdScanPlugin()
    }
    override func tearDown() {
        plugin = nil
        super.tearDown()
    }

    func makeCall(
        method: String = "test",
        options: [String: Any] = [:],
        onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
        onError: @escaping (String) -> Void = { _ in }
    ) -> CAPPluginCall {
        CAPPluginCall(
            callbackId: "test-\(UUID().uuidString)",
            methodName: method,
            options: options,
            success: { result, _ in onSuccess(result?.data) },
            error: { error in onError(error?.message ?? "(no error message)") }
        )
    }

    // A camera transform whose forward (-z of the camera) points along a given
    // scene bearing: 0 is the scene's -z, increasing clockwise toward +x.
    func cameraFacing(bearingDeg: Double) -> simd_float4x4 {
        let r = Float(bearingDeg * Double.pi / 180.0)
        // forward = (sin r, 0, -cos r); the third column is -forward.
        let fwd = simd_float3(sin(r), 0, -cos(r))
        let back = -fwd
        let up = simd_float3(0, 1, 0)
        let right = simd_normalize(simd_cross(up, back))
        return simd_float4x4(
            simd_float4(right.x, right.y, right.z, 0),
            simd_float4(up.x, up.y, up.z, 0),
            simd_float4(back.x, back.y, back.z, 0),
            simd_float4(0, 0, 0, 1))
    }

    // ── yawDeg: half of the compass, and the half that was missing ──────────

    @available(iOS 17.0, *)
    func testYawIsZeroLookingDownMinusZ() {
        // The scene's own zero. A phone that has not turned since the session
        // started reads zero here, which is what makes headingDeg subtractable.
        XCTAssertEqual(TdScanViewController.yawDeg(cameraFacing(bearingDeg: 0)), 0, accuracy: 0.01)
    }

    @available(iOS 17.0, *)
    func testYawFollowsTheCameraAllTheWayRound() {
        for b in [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0] {
            XCTAssertEqual(TdScanViewController.yawDeg(cameraFacing(bearingDeg: b)), b, accuracy: 0.01,
                           "camera facing \(b) should read \(b)")
        }
    }

    @available(iOS 17.0, *)
    func testYawIsAlwaysAPositiveBearing() {
        // Never a negative angle and never 360: JS subtracts this from a
        // compass reading, and a -90 there quietly becomes a 180 error.
        for b in [-90.0, -1.0, 359.9, 360.0, 720.0] {
            let y = TdScanViewController.yawDeg(cameraFacing(bearingDeg: b))
            XCTAssertGreaterThanOrEqual(y, 0)
            XCTAssertLessThan(y, 360)
        }
    }

    @available(iOS 17.0, *)
    func testYawIgnoresTiltAndHeight() {
        // A person scans holding the phone at an angle and at whatever height
        // they are. Neither may move the compass bearing.
        var t = cameraFacing(bearingDeg: 90)
        t.columns.3 = simd_float4(3, 1.6, -7, 1)      // moved across the room
        XCTAssertEqual(TdScanViewController.yawDeg(t), 90, accuracy: 0.01)
    }

    // ── ftIn: the number he reads off the wall ──────────────────────────────

    @available(iOS 17.0, *)
    func testFtInReadsLikeATape() {
        // 2.4384 m is exactly 8 ft. If this ever prints 7'12" the feature is
        // worse than useless: he checks it against a tape and stops believing
        // every other number on the screen.
        XCTAssertEqual(TdScanViewController.ftIn(2.4384), "8'0\"")
        XCTAssertEqual(TdScanViewController.ftIn(3.6576), "12'0\"")
        XCTAssertEqual(TdScanViewController.ftIn(0.3048), "1'0\"")
        XCTAssertEqual(TdScanViewController.ftIn(0.9144), "3'0\"")
    }

    @available(iOS 17.0, *)
    func testFtInCarriesTheInches() {
        XCTAssertEqual(TdScanViewController.ftIn(0.0254), "0'1\"")
        XCTAssertEqual(TdScanViewController.ftIn(0.1524), "0'6\"")
        // 12 ft 4 in
        XCTAssertEqual(TdScanViewController.ftIn(3.7592), "12'4\"")
    }

    @available(iOS 17.0, *)
    func testFtInNeverPrintsTwelveInches() {
        // The rounding case that produces 7'12". Walk a range and assert the
        // inches half is always 0 through 11, because one bad string here is
        // the moment the whole live readout loses him.
        var m: Float = 0
        while m < 6.0 {
            let s = TdScanViewController.ftIn(m)
            let parts = s.dropLast().split(separator: "'")
            XCTAssertEqual(parts.count, 2, "unparseable: \(s)")
            let inches = Int(parts[1]) ?? -1
            XCTAssertGreaterThanOrEqual(inches, 0, "\(s) from \(m) m")
            XCTAssertLessThanOrEqual(inches, 11, "\(s) from \(m) m")
            m += 0.0031    // a third of an inch, so rounding boundaries are hit
        }
    }

    @available(iOS 17.0, *)
    func testFtInSurvivesZeroAndNonsense() {
        XCTAssertEqual(TdScanViewController.ftIn(0), "0'0\"")
        // A surface RoomPlan reported with no size must not crash the overlay
        // mid-walk; it just reads as nothing.
        XCTAssertFalse(TdScanViewController.ftIn(Float.leastNonzeroMagnitude).isEmpty)
    }

    // ── The bridge surface, called the way the bridge calls it ──────────────

    func testReadFileWithoutAPathRejects() {
        let done = expectation(description: "reject")
        plugin.readFile(makeCall(method: "readFile",
                                 onSuccess: { _ in XCTFail("a missing path must not succeed") },
                                 onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 2)
    }

    func testReadFileWithAPathThatIsNotThereRejects() {
        let done = expectation(description: "reject")
        plugin.readFile(makeCall(method: "readFile",
                                 options: ["path": "/nope/not/a/file.usdz"],
                                 onSuccess: { _ in XCTFail("a missing file must not succeed") },
                                 onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 2)
    }

    func testReadFileWithAWrongTypedPathRejects() {
        // getString returns nil for a number, so this takes the same branch as
        // a missing argument rather than crashing on a cast.
        let done = expectation(description: "reject")
        plugin.readFile(makeCall(method: "readFile",
                                 options: ["path": 42],
                                 onSuccess: { _ in XCTFail("a numeric path must not succeed") },
                                 onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 2)
    }

    func testIsSupportedAlwaysAnswers() {
        // Never rejects, on any device. The web layer branches on this to
        // decide whether to offer scanning at all, so a reject here would
        // strand the whole feature behind an unhandled promise.
        let done = expectation(description: "answer")
        plugin.isSupported(makeCall(method: "isSupported",
                                    onSuccess: { data in
                                        XCTAssertNotNil(data?["supported"])
                                        done.fulfill()
                                    },
                                    onError: { m in XCTFail("isSupported rejected: \(m)") }))
        wait(for: [done], timeout: 2)
    }

    func testIsSupportedIsStableAcrossRepeatedCalls() {
        var answers: [Bool] = []
        for _ in 0..<5 {
            let done = expectation(description: "answer")
            plugin.isSupported(makeCall(method: "isSupported", onSuccess: { data in
                answers.append((data?["supported"] as? Bool) ?? false); done.fulfill()
            }))
            wait(for: [done], timeout: 2)
        }
        XCTAssertEqual(Set(answers).count, 1, "device capability must not flicker")
    }

    func testPendingDraftAnswersOnACleanInstall() {
        // No draft on disk is the ordinary case and must be an answer, not an
        // error: the app asks this on every boot.
        let done = expectation(description: "answer")
        plugin.pendingDraft(makeCall(method: "pendingDraft",
                                     onSuccess: { _ in done.fulfill() },
                                     onError: { m in XCTFail("pendingDraft rejected: \(m)") }))
        wait(for: [done], timeout: 2)
    }

    func testDiscardDraftIsSafeWithNothingToDiscard() {
        let done = expectation(description: "answer")
        plugin.discardDraft(makeCall(method: "discardDraft",
                                     onSuccess: { _ in done.fulfill() },
                                     onError: { m in XCTFail("discardDraft rejected: \(m)") }))
        wait(for: [done], timeout: 2)
    }

    func testDiscardDraftTwiceInARowIsStillSafe() {
        // The double-tap case. Deleting a file that is already gone must not
        // reject, or a jumpy thumb strands the boot path.
        for _ in 0..<2 {
            let done = expectation(description: "answer")
            plugin.discardDraft(makeCall(method: "discardDraft",
                                         onSuccess: { _ in done.fulfill() },
                                         onError: { m in XCTFail("second discard rejected: \(m)") }))
            wait(for: [done], timeout: 2)
        }
    }

    func testViewUsdzWithoutAPathRejects() {
        let done = expectation(description: "reject")
        plugin.viewUsdz(makeCall(method: "viewUsdz",
                                 onSuccess: { _ in XCTFail("a missing path must not succeed") },
                                 onError: { _ in done.fulfill() }))
        wait(for: [done], timeout: 2)
    }
}
