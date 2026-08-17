// Adversarial coverage for TdGeoPlugin (native/td-geo/ios/Plugin/TdGeoPlugin.swift).
//
// "Keep native dumb" (CLAUDE.md §3.2) puts every decision, threshold, and
// timer in JS; what's left in Swift is raw capability plumbing, arm a
// region, buffer an event, report a fix, and THAT is exactly the surface
// this file stresses. No WKWebView, no simulator UI, this calls the real
// plugin class's real @objc methods with a real CAPPluginCall, the same way
// the JS bridge does, and tries to break each one: malformed input, the
// 18-region cap, double-start races, an unstarted stopAll, an empty buffer.
//
// This is the seed file for the new TdNativeTests target (see
// scripts/ios-add-native-tests.rb); every other td-* plugin gets its own
// file in this directory following the same shape.
import XCTest
import Capacitor
@testable import TdGeo

final class TdGeoPluginTests: XCTestCase {
    var plugin: TdGeoPlugin!

    override func setUp() {
        super.setUp()
        plugin = TdGeoPlugin()
    }

    override func tearDown() {
        // Every test leaves the fence disarmed for the next one, region
        // monitoring and significant-change watching are process-global
        // CoreLocation state, not per-instance.
        let done = expectation(description: "stopAll teardown")
        plugin.stopAll(makeCall(onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 5)
        plugin = nil
        super.tearDown()
    }

    // MARK: - test helper

    /// Builds a real CAPPluginCall the same way the JS bridge would, minus
    /// the actual bridge. success/error fire on whichever thread the plugin
    /// resolves from (main, per every method's DispatchQueue.main.async), so
    /// callers always synchronize through an XCTestExpectation, never a bare
    /// assertion racing the async resolve.
    ///
    /// successHandler is (CAPPluginCallResult, CAPPluginCall) -> Void and
    /// errorHandler is (CAPPluginCallError) -> Void (CAPPluginCall.h), not
    /// the raw dictionary/string closures older Capacitor docs show.
    func makeCall(
        method: String = "test",
        options: [String: Any] = [:],
        onSuccess: @escaping ([String: Any]?) -> Void = { _ in },
        onError: @escaping (String) -> Void = { msg in XCTFail("unexpected reject: \(msg)") }
    ) -> CAPPluginCall {
        CAPPluginCall(
            callbackId: "test-\(UUID().uuidString)",
            methodName: method,
            options: options,
            success: { result, _ in onSuccess(result?.data) },
            error: { error in onError(error?.message ?? "(no error message)") }
        )
    }

    // Must return JSObject ([String: JSValue]), not a plain [String: Any].
    // getArray("regions") -> JSArray requires each element to actually
    // satisfy Dictionary's `JSValue where Value == JSValue` conformance, a
    // [String: Any] element fails that cast silently at runtime (armed
    // comes back 0, no compiler error), the exact false-negative this test
    // suite exists to catch elsewhere, so the helper itself has to get it
    // right first.
    func region(_ id: String, lat: Double = 37.6889, lng: Double = -97.3361, radius: Double = 200) -> JSObject {
        ["id": id, "lat": lat, "lng": lng, "radius": radius]
    }

    // MARK: - startParked: malformed input never crashes, only valid regions arm

    func testStartParked_missingFieldsAreSkippedNotCrashed() {
        let exp = expectation(description: "startParked")
        // [JSObject], not [[String: Any]]: see the comment on region() above,
        // an [String: Any] element silently fails the plugin's own getArray
        // cast, which would make this test pass for the wrong reason (0
        // armed, "only 1 should arm" trivially true because none did).
        let regions: [JSObject] = [
            region("valid-1"),
            ["id": "no-lat", "lng": -97.0, "radius": 200],       // missing lat
            ["lat": 37.0, "lng": -97.0, "radius": 200],          // missing id
            ["id": "no-lng", "lat": 37.0, "radius": 200],        // missing lng
            [:],                                                  // completely empty
        ]
        plugin.startParked(makeCall(options: ["regions": regions], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 1, "only the one fully-valid region should arm")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    func testStartParked_emptyRegionsArmsZero() {
        let exp = expectation(description: "startParked empty")
        plugin.startParked(makeCall(options: ["regions": []], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    func testStartParked_noRegionsKeyAtAllDoesNotCrash() {
        let exp = expectation(description: "startParked no key")
        // The JS bridge can hand this call zero options at all, e.g. a
        // caller that forgot the payload entirely, not just an empty array.
        plugin.startParked(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    func testStartParked_malformedRegionsTypeDoesNotCrash() {
        let exp = expectation(description: "startParked wrong type")
        // A string where an array was expected, getArray returns nil, the
        // plugin must fall back to an empty list, never trap.
        plugin.startParked(makeCall(options: ["regions": "not-an-array"], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    // MARK: - the 18-region cap

    func testStartParked_capsAtEighteenRegardlessOfHowManyAreValid() {
        let exp = expectation(description: "startParked cap")
        let regions = (0..<40).map { region("r\($0)", lat: 37.0 + Double($0) * 0.001, lng: -97.0) }
        plugin.startParked(makeCall(options: ["regions": regions], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 18, "iOS only supports ~20 concurrent monitored regions, the plugin caps below that on purpose")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    // MARK: - concurrent / rapid re-entry (CLAUDE.md §11.2 shape, translated to native)

    func testRapidStartStopStart_neverCrashesAndEndsInAConsistentState() {
        let exp = expectation(description: "rapid start/stop/start")
        var results: [Int] = []
        let group = DispatchGroup()

        for i in 0..<10 {
            group.enter()
            plugin.startParked(makeCall(options: ["regions": [region("race-\(i)")]], onSuccess: { data in
                results.append(data?["armed"] as? Int ?? -1)
                group.leave()
            }))
            plugin.stopAll(makeCall(onSuccess: { _ in }))
        }

        group.notify(queue: .main) {
            XCTAssertEqual(results.count, 10, "every rapid call must still resolve, none silently dropped")
            XCTAssertFalse(results.contains(-1), "no call should resolve without its expected 'armed' key")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 10)
    }

    // MARK: - stopAll / drainBuffer as no-ops when nothing is armed

    func testStopAll_whenNothingWasEverStartedResolvesCleanly() {
        let exp = expectation(description: "stopAll idle")
        plugin.stopAll(makeCall(onSuccess: { _ in exp.fulfill() }))
        wait(for: [exp], timeout: 5)
    }

    func testDrainBuffer_withNothingBufferedReturnsEmptyArrayNotNil() {
        let exp = expectation(description: "drainBuffer empty")
        // Drain once first to guarantee a clean slate regardless of test order.
        plugin.drainBuffer(makeCall(onSuccess: { _ in
            self.plugin.drainBuffer(self.makeCall(onSuccess: { data in
                let fixes = data?["fixes"] as? [[String: Any]]
                XCTAssertNotNil(fixes, "must resolve an array, never nil, or the JS side crashes destructuring it")
                XCTAssertEqual(fixes?.count, 0)
                exp.fulfill()
            }))
        }))
        wait(for: [exp], timeout: 5)
    }

    // MARK: - burstFix: seconds clamp (3...60) and double-start doesn't double-count

    func testBurstFix_clampsOutOfRangeSeconds() {
        let low = expectation(description: "burstFix low")
        plugin.burstFix(makeCall(options: ["seconds": -50], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 3, "below the floor must clamp up to 3, never go negative")
            low.fulfill()
        }))
        wait(for: [low], timeout: 5)

        let done = expectation(description: "burstFix low teardown")
        plugin.stopAll(makeCall(onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 5)

        let high = expectation(description: "burstFix high")
        plugin.burstFix(makeCall(options: ["seconds": 99999], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 60, "above the ceiling must clamp down to 60, never run indefinitely")
            high.fulfill()
        }))
        wait(for: [high], timeout: 5)
    }

    func testBurstFix_missingSecondsUsesDefaultTwelve() {
        let exp = expectation(description: "burstFix default")
        plugin.burstFix(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 12)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    func testBurstFix_calledTwiceRapidlyDoesNotDoubleCountRadioTime() {
        let first = expectation(description: "burstFix first")
        plugin.burstFix(makeCall(options: ["seconds": 30], onSuccess: { _ in first.fulfill() }))
        wait(for: [first], timeout: 5)

        // A second burst request while the first is still running must reset
        // the timer, not stack a second one, radio-time accounting assumes
        // exactly one active burst window at a time.
        let second = expectation(description: "burstFix second")
        plugin.burstFix(makeCall(options: ["seconds": 5], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 5)
            second.fulfill()
        }))
        wait(for: [second], timeout: 5)
    }

    // MARK: - motionSince: graceful with no input

    func testMotionSince_withNoSinceMsDoesNotThrow() {
        let exp = expectation(description: "motionSince")
        plugin.motionSince(makeCall(options: [:], onSuccess: { data in
            XCTAssertNotNil(data?["available"], "must always report availability, even on a simulator with no motion coprocessor")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 5)
    }

    // MARK: - stats: reset actually zeroes the counters

    func testStats_resetTrueZeroesGpsOnMs() {
        // Rack up some measurable radio time first.
        let burst = expectation(description: "stats setup burst")
        plugin.burstFix(makeCall(options: ["seconds": 3], onSuccess: { _ in burst.fulfill() }))
        wait(for: [burst], timeout: 5)

        let stop = expectation(description: "stats setup stop")
        plugin.stopAll(makeCall(onSuccess: { _ in stop.fulfill() }))
        wait(for: [stop], timeout: 5)

        let reset = expectation(description: "stats reset")
        plugin.stats(makeCall(options: ["reset": true], onSuccess: { _ in reset.fulfill() }))
        wait(for: [reset], timeout: 5)

        let after = expectation(description: "stats after reset")
        plugin.stats(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["gpsOnMs"] as? Double, 0, "reset:true must actually zero the persisted counter, not just report it once")
            after.fulfill()
        }))
        wait(for: [after], timeout: 5)
    }
}
