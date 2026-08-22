// Adversarial coverage for TdDevicePlugin (native/td-device/ios/Plugin/TdDevicePlugin.swift).
//
// This plugin is the thinnest kind of "dumb" (CLAUDE.md §3.2): one method,
// no arguments, no state, no permission gate, it reads three OS facts
// (sysctl hardware identifier, UIDevice name, systemVersion) and hands them
// to JS untouched. Most of §3.3's input-class table (null/invalid input,
// permission-denied, post-error state, device-capability gaps) doesn't
// apply here, there is no input to be malformed and nothing to be denied.
// What DOES apply, and is worth nailing down permanently: the promise
// contract always resolves with all three keys populated and non-empty,
// concurrent calls never race or crash, and extraneous options are ignored
// rather than rejected (the same shape as TdGeoPlugin's motionPermStatus
// tests, which is also a read-only no-args-needed method).
import XCTest
import Capacitor
@testable import TdDevice

final class TdDevicePluginTests: XCTestCase {
    var plugin: TdDevicePlugin!

    override func setUp() {
        super.setUp()
        plugin = TdDevicePlugin()
    }

    override func tearDown() {
        plugin = nil
        super.tearDown()
    }

    // See TdGeoPluginTests.swift for why the 30s timeout: generous headroom
    // for a stalled shared CI simulator, paid for only on a genuine hang.
    func makeCall(
        options: [String: Any] = [:],
        onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
        onError: @escaping (String) -> Void = { msg in XCTFail("unexpected reject: \(msg)") }
    ) -> CAPPluginCall {
        CAPPluginCall(
            callbackId: "test-\(UUID().uuidString)",
            methodName: "info",
            options: options,
            success: { result, _ in onSuccess(result?.data) },
            error: { error in onError(error?.message ?? "(no error message)") }
        )
    }

    // MARK: - golden path: always resolves with all three keys, never empty

    func testInfo_resolvesWithAllThreeFieldsNonEmpty() {
        let exp = expectation(description: "info")
        plugin.info(makeCall(onSuccess: { data in
            let hwId = data?["hwId"] as? String
            let name = data?["name"] as? String
            let systemVersion = data?["systemVersion"] as? String
            XCTAssertNotNil(hwId)
            XCTAssertFalse(hwId?.isEmpty ?? true, "hardware identifier must never resolve empty")
            XCTAssertNotNil(name)
            XCTAssertNotNil(systemVersion)
            XCTAssertFalse(systemVersion?.isEmpty ?? true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // A real device/simulator identifier always contains a digit and a
    // comma (e.g. "iPhone17,2", "x86_64" on an Intel simulator host is the
    // one documented exception, so only assert the never-crashes/never-nil
    // contract, not a specific format).
    func testInfo_hardwareIdentifierNeverContainsControlCharactersOrGarbage() {
        let exp = expectation(description: "info format")
        plugin.info(makeCall(onSuccess: { data in
            let hwId = data?["hwId"] as? String ?? ""
            XCTAssertTrue(hwId.allSatisfy { $0.isLetter || $0.isNumber || $0 == "," || $0 == "_" },
                          "hwId '\(hwId)' contains unexpected characters, the utsname decode likely broke")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - extraneous options are ignored, never rejected

    func testInfo_ignoresExtraneousOptions() {
        let exp = expectation(description: "info with junk options")
        plugin.info(makeCall(options: ["unexpected": "junk", "n": 42], onSuccess: { data in
            XCTAssertNotNil(data?["hwId"])
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - concurrent calls (CLAUDE.md §11.2 shape, translated to native)

    func testRapidConcurrentCalls_allResolveConsistently() {
        let exp = expectation(description: "rapid info calls")
        var results: [String] = []
        let group = DispatchGroup()

        for _ in 0..<10 {
            group.enter()
            plugin.info(makeCall(onSuccess: { data in
                results.append(data?["hwId"] as? String ?? "")
                group.leave()
            }))
        }

        group.notify(queue: .main) {
            XCTAssertEqual(results.count, 10, "every concurrent call must resolve, none silently dropped")
            XCTAssertTrue(results.allSatisfy { !$0.isEmpty }, "no call should resolve with an empty hwId")
            XCTAssertEqual(Set(results).count, 1, "the same physical device must report the same identifier every time")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 30)
    }

    // MARK: - a fresh plugin instance reports the same identifier (no cached-state drift)

    func testInfo_freshInstanceReportsSameIdentifierAsFirst() {
        let first = expectation(description: "info first instance")
        var firstId = ""
        plugin.info(makeCall(onSuccess: { data in
            firstId = data?["hwId"] as? String ?? ""
            first.fulfill()
        }))
        wait(for: [first], timeout: 30)

        let second = expectation(description: "info second instance")
        let secondPlugin = TdDevicePlugin()
        secondPlugin.info(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["hwId"] as? String, firstId, "hardware identifier is a device fact, not plugin-instance state")
            second.fulfill()
        }))
        wait(for: [second], timeout: 30)
    }
}
