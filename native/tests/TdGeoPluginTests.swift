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
// The region-wake tests below construct real CLCircularRegion /
// CLLocationManager values to drive the delegate the way iOS does.
// `@testable import TdGeo` does NOT re-export the plugin's own imports, so
// without this the whole test target fails to compile with "Cannot find
// 'CLLocationManager' in scope" (native-tests, 2026-08-31).
import CoreLocation
// UIApplication.applicationState, for the two flush tests that skip rather
// than assert vacuously when the host app is not foregrounded.
import UIKit
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
        wait(for: [done], timeout: 30)
        plugin = nil
        super.tearDown()
    }

    // NOTE on the 30s waits: every expectation here resolves in milliseconds on
    // a healthy machine, the generous timeout exists ONLY for the shared CI
    // simulator, which stalls for many seconds at a time under load (observed
    // live 2026-08-18: a passing call flagged as "timed out" at 5s while the
    // sim logged 24s of wall clock around it). wait() returns the moment the
    // expectation fulfills, so passing runs pay nothing for the headroom.

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
        wait(for: [exp], timeout: 30)
    }

    func testStartParked_emptyRegionsArmsZero() {
        let exp = expectation(description: "startParked empty")
        plugin.startParked(makeCall(options: ["regions": []], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testStartParked_noRegionsKeyAtAllDoesNotCrash() {
        let exp = expectation(description: "startParked no key")
        // The JS bridge can hand this call zero options at all, e.g. a
        // caller that forgot the payload entirely, not just an empty array.
        plugin.startParked(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testStartParked_malformedRegionsTypeDoesNotCrash() {
        let exp = expectation(description: "startParked wrong type")
        // A string where an array was expected, getArray returns nil, the
        // plugin must fall back to an empty list, never trap.
        plugin.startParked(makeCall(options: ["regions": "not-an-array"], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - the 18-region cap

    func testStartParked_capsAtEighteenRegardlessOfHowManyAreValid() {
        let exp = expectation(description: "startParked cap")
        let regions = (0..<40).map { region("r\($0)", lat: 37.0 + Double($0) * 0.001, lng: -97.0) }
        plugin.startParked(makeCall(options: ["regions": regions], onSuccess: { data in
            XCTAssertEqual(data?["armed"] as? Int, 18, "iOS only supports ~20 concurrent monitored regions, the plugin caps below that on purpose")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
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
        wait(for: [exp], timeout: 30)
    }

    // MARK: - stopAll / drainBuffer as no-ops when nothing is armed

    // MARK: - relaunch survival (the force-close story, owner 2026-08-27)

    func testStartParked_persistsTheArmedFlagWithoutVisits() {
        let exp = expectation(description: "startParked flag")
        plugin.startParked(makeCall(options: ["regions": [region("r1")]], onSuccess: { _ in
            let armed = UserDefaults.standard.dictionary(forKey: "td_geo_armed")
            XCTAssertNotNil(armed, "a relaunched process must know something was armed")
            XCTAssertEqual(armed?["visits"] as? Bool, false)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testStartEvents_persistsTheArmedFlagWithVisits() {
        let exp = expectation(description: "startEvents flag")
        plugin.startEvents(makeCall(options: ["regions": [region("r1")]], onSuccess: { _ in
            let armed = UserDefaults.standard.dictionary(forKey: "td_geo_armed")
            XCTAssertEqual(armed?["visits"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testStopAll_clearsTheArmedFlagSoARelaunchStaysDark() {
        let started = expectation(description: "start")
        plugin.startEvents(makeCall(options: ["regions": []], onSuccess: { _ in started.fulfill() }))
        wait(for: [started], timeout: 30)
        let stopped = expectation(description: "stop")
        plugin.stopAll(makeCall(onSuccess: { _ in
            XCTAssertNil(UserDefaults.standard.dictionary(forKey: "td_geo_armed"),
                         "tracking off means a relaunch must arm nothing")
            stopped.fulfill()
        }))
        wait(for: [stopped], timeout: 30)
    }

    func testLoad_withTheArmedFlagCountsTheRelaunchWakeAndDoesNotCrash() {
        UserDefaults.standard.set(["mode": "events", "visits": true], forKey: "td_geo_armed")
        let before = ((UserDefaults.standard.dictionary(forKey: "td_geo_wakes") as? [String: Int]) ?? [:])["relaunch"] ?? 0
        plugin.load()
        let after = ((UserDefaults.standard.dictionary(forKey: "td_geo_wakes") as? [String: Int]) ?? [:])["relaunch"] ?? 0
        XCTAssertEqual(after, before + 1, "a system relaunch with tracking armed is a counted wake")
        // Give the async main-queue re-arm a beat, then confirm nothing threw.
        let settle = expectation(description: "settle")
        DispatchQueue.main.async { settle.fulfill() }
        wait(for: [settle], timeout: 30)
    }

    func testLoad_withNoArmedFlagIsACompleteNoOp() {
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
        let before = ((UserDefaults.standard.dictionary(forKey: "td_geo_wakes") as? [String: Int]) ?? [:])["relaunch"] ?? 0
        plugin.load()
        let after = ((UserDefaults.standard.dictionary(forKey: "td_geo_wakes") as? [String: Int]) ?? [:])["relaunch"] ?? 0
        XCTAssertEqual(after, before, "no armed flag means the launch does nothing at all")
    }

    func testStopAll_whenNothingWasEverStartedResolvesCleanly() {
        let exp = expectation(description: "stopAll idle")
        plugin.stopAll(makeCall(onSuccess: { _ in exp.fulfill() }))
        wait(for: [exp], timeout: 30)
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
        wait(for: [exp], timeout: 30)
    }

    // MARK: - burstFix: seconds clamp (3...60) and double-start doesn't double-count

    func testBurstFix_clampsOutOfRangeSeconds() {
        let low = expectation(description: "burstFix low")
        plugin.burstFix(makeCall(options: ["seconds": -50], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 3, "below the floor must clamp up to 3, never go negative")
            low.fulfill()
        }))
        wait(for: [low], timeout: 30)

        let done = expectation(description: "burstFix low teardown")
        plugin.stopAll(makeCall(onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 30)

        let high = expectation(description: "burstFix high")
        plugin.burstFix(makeCall(options: ["seconds": 99999], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 60, "above the ceiling must clamp down to 60, never run indefinitely")
            high.fulfill()
        }))
        wait(for: [high], timeout: 30)
    }

    func testBurstFix_missingSecondsUsesDefaultTwelve() {
        let exp = expectation(description: "burstFix default")
        plugin.burstFix(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 12)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testBurstFix_calledTwiceRapidlyDoesNotDoubleCountRadioTime() {
        let first = expectation(description: "burstFix first")
        plugin.burstFix(makeCall(options: ["seconds": 30], onSuccess: { _ in first.fulfill() }))
        wait(for: [first], timeout: 30)

        // A second burst request while the first is still running must reset
        // the timer, not stack a second one, radio-time accounting assumes
        // exactly one active burst window at a time.
        let second = expectation(description: "burstFix second")
        plugin.burstFix(makeCall(options: ["seconds": 5], onSuccess: { data in
            XCTAssertEqual(data?["seconds"] as? Double, 5)
            second.fulfill()
        }))
        wait(for: [second], timeout: 30)
    }

    // MARK: - motionSince: graceful with no input

    func testMotionSince_withNoSinceMsDoesNotThrow() {
        let exp = expectation(description: "motionSince")
        plugin.motionSince(makeCall(options: [:], onSuccess: { data in
            XCTAssertNotNil(data?["available"], "must always report availability, even on a simulator with no motion coprocessor")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - openSettings: always resolves, never hangs or crashes

    // Can't assert the Settings app actually opened in headless CI (no way
    // to inspect what's on screen from XCTest here), the adversarial case
    // that matters is the promise contract: this must always resolve, never
    // reject and never hang, since the JS caller (dashboard.js) fires it
    // fire-and-forget from a tap with no retry logic of its own.
    func testOpenSettings_alwaysResolves() {
        let exp = expectation(description: "openSettings")
        plugin.openSettings(makeCall(method: "openSettings", onSuccess: { data in
            XCTAssertNotNil(data?["opened"], "must report whether it opened, never silently resolve empty")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - locationPermStatus: iOS's own vocabulary, never collapsed

    // The distinction this whole method exists for: whenInUse and always are
    // NOT the same grant. whenInUse logs nothing from a pocket, and the old JS
    // inference reported both as a flat "granted", so a phone that tracked
    // nothing looked identical to one that worked.
    func testLocationPermStatus_reportsOneOfTheFiveRealAuthorizationStates() {
        let exp = expectation(description: "locationPermStatus")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            let status = data?["status"] as? String
            XCTAssertNotNil(status, "must always report a status string")
            XCTAssertTrue(["notdetermined", "restricted", "denied", "wheninuse", "always"].contains(status ?? ""),
                          "status must be one of iOS's five real states, got \(status ?? "nil")")
            XCTAssertNotEqual(status, "granted", "the flattened web vocabulary must never reappear here")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Precise Location is a separate switch: a user can be `always` and still
    // have downgraded to reducedAccuracy, which is granted and useless at once
    // against fences measured in hundreds of feet. It must never be folded into
    // status, and it must always be present.
    func testLocationPermStatus_reportsAccuracySeparatelyFromAuthorization() {
        let exp = expectation(description: "locationPermStatus accuracy")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            let accuracy = data?["accuracy"] as? String
            XCTAssertNotNil(accuracy, "accuracy must always be reported, never omitted")
            XCTAssertTrue(["full", "reduced"].contains(accuracy ?? ""),
                          "accuracy must be full or reduced, got \(accuracy ?? "nil")")
            XCTAssertNotNil(data?["precise"] as? Bool, "precise must be a real boolean for a JS caller to test directly")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Read-only and argument-free: a caller that passes junk, or nothing, gets
    // the same answer rather than a rejection. Same contract as motionPermStatus.
    func testLocationPermStatus_ignoresJunkArgumentsAndNeverRejects() {
        let exp = expectation(description: "locationPermStatus junk args")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus",
                                           options: ["sinceMs": "not-a-number", "seconds": -5],
                                           onSuccess: { data in
            XCTAssertNotNil(data?["status"], "junk arguments must not change the answer")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Called repeatedly the way a foreground re-check will call it, with no
    // start/stop in between: it must stay consistent and never crash.
    func testLocationPermStatus_repeatedCallsAgreeAndNeverCrash() {
        var seen: [String] = []
        for i in 0..<5 {
            let exp = expectation(description: "locationPermStatus repeat \(i)")
            plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
                if let s = data?["status"] as? String { seen.append(s) }
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
        XCTAssertEqual(seen.count, 5, "every call must resolve")
        XCTAssertEqual(Set(seen).count, 1, "nothing changed in between, so the answer must not wobble")
    }

    // ── The third axis: device-wide Location Services ───────────────────────
    //
    // The per-app grant and the global switch in Settings > Privacy & Security
    // are independent. With Location Services off system-wide, authorizationStatus
    // still reports .authorizedAlways and not one fix will ever arrive, so
    // without this key a dead handset and a working one return identical
    // dictionaries. Reported as a real Bool, never as a string or a truthy
    // number, because the JS side stores a strict boolean and turns anything
    // else into null (unknown) on purpose.
    func testLocationPermStatus_reportsDeviceWideServicesAsARealBoolean() {
        let exp = expectation(description: "locationPermStatus servicesEnabled")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            XCTAssertNotNil(data?["servicesEnabled"], "the device-wide switch must always be present in a successful answer")
            XCTAssertTrue(data?["servicesEnabled"] is Bool, "must be a real Bool: the JS side stores anything else as unknown")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Every axis in ONE answer. A caller that has to make a second round trip
    // for the global switch can observe the two halves out of step, which is
    // the same class of bug as reading the native cache three times while a
    // refresh lands in the middle.
    func testLocationPermStatus_carriesAllThreeAxesInASingleResolve() {
        let exp = expectation(description: "locationPermStatus all axes")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            XCTAssertNotNil(data?["status"] as? String, "axis 1: this app's own grant")
            XCTAssertNotNil(data?["accuracy"] as? String, "axis 2: Precise Location")
            XCTAssertNotNil(data?["servicesEnabled"] as? Bool, "axis 3: device-wide Location Services")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // The global switch is read with CLLocationManager.locationServicesEnabled(),
    // which is NOT deprecated but DOES block the calling thread (Apple added a
    // main-thread runtime warning for exactly that reason, and it has been seen
    // to hang outright). The implementation dispatches it to a global queue.
    // Two things follow, and both are pinned here: the resolve must not arrive
    // on the main thread, and a call made FROM the main thread must still come
    // back rather than deadlock.
    func testLocationPermStatus_resolvesOffTheMainThread() {
        let exp = expectation(description: "locationPermStatus off-main")
        var wasMain = true
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { _ in
            wasMain = Thread.isMainThread
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
        XCTAssertFalse(wasMain, "the blocking services lookup must not run on, or resolve to, the main thread")
    }

    func testLocationPermStatus_calledFromTheMainThreadStillReturns() {
        let exp = expectation(description: "locationPermStatus from main")
        DispatchQueue.main.async {
            self.plugin.locationPermStatus(self.makeCall(method: "locationPermStatus", onSuccess: { data in
                XCTAssertNotNil(data?["servicesEnabled"], "a main-thread caller must still get the full answer")
                exp.fulfill()
            }))
        }
        wait(for: [exp], timeout: 30)
    }

    // The global switch cannot flip between two back-to-back reads in a test,
    // so the answer must not wobble either. Same guarantee the status axis
    // already carries, applied to the axis that was just added.
    func testLocationPermStatus_deviceWideSwitchDoesNotWobbleAcrossCalls() {
        var seen: [Bool] = []
        for i in 0..<5 {
            let exp = expectation(description: "servicesEnabled repeat \(i)")
            plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
                if let b = data?["servicesEnabled"] as? Bool { seen.append(b) }
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
        XCTAssertEqual(seen.count, 5, "every call must resolve with the switch present")
        XCTAssertEqual(Set(seen).count, 1, "nothing changed in between, so the answer must not wobble")
    }

    // Concurrency, per the input-class table: the dispatch means several calls
    // can be in flight at once, each holding its own CAPPluginCall. Every one
    // has to resolve exactly once, with a complete answer.
    func testLocationPermStatus_concurrentCallsAllResolveExactlyOnce() {
        var exps: [XCTestExpectation] = []
        for i in 0..<8 {
            let exp = expectation(description: "concurrent locationPermStatus \(i)")
            exps.append(exp)
            plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
                XCTAssertNotNil(data?["status"])
                XCTAssertNotNil(data?["servicesEnabled"])
                exp.fulfill()
            }))
        }
        wait(for: exps, timeout: 60)
    }

    // MARK: - requestPreciseTemp: ask for Precise Location, never hang on it

    // WHAT CI CAN AND CANNOT SEE. A simulator has no authorization granted, so
    // this never reaches requestTemporaryFullAccuracyAuthorization here, it
    // takes the unauthorized short-circuit. That is not a hole, it IS the
    // adversarial case: an unauthorized handset used to be the state where
    // Apple's completion handler may never fire at all, and a plugin that
    // simply forwarded the call would leave its CAPPluginCall unresolved
    // forever, which reads in the app as a tap that did nothing. Every test
    // here is therefore about the promise contract and the shape of the
    // answer, which is exactly what the JS side branches on.

    func testRequestPreciseTemp_alwaysResolvesWithACompleteAnswer() {
        let exp = expectation(description: "requestPreciseTemp")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            XCTAssertTrue(data?["supported"] is Bool, "supported must be a real Bool for a JS caller to test directly")
            XCTAssertTrue(data?["asked"] is Bool, "the caller has to know whether a dialog was actually spent")
            XCTAssertTrue(data?["precise"] is Bool)
            XCTAssertTrue(data?["temporary"] is Bool, "a session-scoped grant must be distinguishable from a permanent one")
            let accuracy = data?["accuracy"] as? String
            XCTAssertTrue(["full", "reduced"].contains(accuracy ?? ""),
                          "accuracy must be full or reduced, got \(accuracy ?? "nil")")
            XCTAssertNotNil(data?["reason"] as? String, "the branch taken must be nameable, or a silent no-op is indistinguishable from a refusal")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // precise and accuracy are two spellings of one fact. Two callers reading
    // different keys must never be able to disagree.
    func testRequestPreciseTemp_preciseAndAccuracyNeverContradictEachOther() {
        let exp = expectation(description: "requestPreciseTemp agreement")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            let precise = data?["precise"] as? Bool
            let accuracy = data?["accuracy"] as? String
            XCTAssertEqual(precise, accuracy == "full", "precise:\(String(describing: precise)) against accuracy:\(accuracy ?? "nil")")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // temporary:true is the whole reason this method reports more than a Bool.
    // It may only ever be true alongside an actual full-accuracy grant; a
    // "temporary" flag on a refusal would make the JS checklist show a
    // lapsing-grant nag to somebody who never got one.
    func testRequestPreciseTemp_temporaryIsNeverTrueWithoutFullAccuracy() {
        let exp = expectation(description: "requestPreciseTemp temporary")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            let temporary = (data?["temporary"] as? Bool) ?? false
            let precise = (data?["precise"] as? Bool) ?? false
            if temporary { XCTAssertTrue(precise, "temporary without precise is a grant that never happened") }
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // The device-capability gap, per the input-class table. The sub-iOS-14
    // branch cannot be reached on a modern simulator (nothing below the 14.0
    // deployment target exists to run on), so what is pinned is the CONTRACT
    // it has to satisfy: unsupported means "there is no reduced accuracy to
    // upgrade from", never "this phone cannot be precise", so it must answer
    // full/precise rather than leaving JS to guess which it meant.
    func testRequestPreciseTemp_unsupportedStillReportsFullAccuracy() {
        let exp = expectation(description: "requestPreciseTemp unsupported contract")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            if (data?["supported"] as? Bool) == false {
                XCTAssertEqual(data?["accuracy"] as? String, "full", "pre-iOS-14 has no reduced accuracy at all")
                XCTAssertEqual(data?["precise"] as? Bool, true)
                XCTAssertEqual(data?["asked"] as? Bool, false, "nothing to ask for means no dialog was spent")
            }
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // null/invalid input: a purposeKey of the wrong type, or absent entirely.
    // The key is what ties the call to Info.plist's
    // NSLocationTemporaryUsageDescriptionDictionary, and a missing one must
    // fall back to the built-in default rather than reject, because a
    // rejection here surfaces as a dead button on the setup checklist.
    func testRequestPreciseTemp_junkOrMissingPurposeKeyNeverRejects() {
        let cases: [[String: Any]] = [
            [:],
            ["purposeKey": 42],
            ["purposeKey": ""],
            ["purposeKey": ["nested": "object"]],
            ["unexpected": "junk"],
        ]
        for (i, opts) in cases.enumerated() {
            let exp = expectation(description: "requestPreciseTemp junk \(i)")
            plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", options: opts, onSuccess: { data in
                XCTAssertNotNil(data?["accuracy"], "case \(i) must still answer")
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
    }

    // Concurrency, per the input-class table: a double tap, or a checklist
    // repaint racing the tap that caused it, puts several of these in flight at
    // once. Every one holds its own CAPPluginCall and must resolve exactly
    // once, or the bridge leaks a pending promise.
    func testRequestPreciseTemp_concurrentCallsAllResolveExactlyOnce() {
        var exps: [XCTestExpectation] = []
        for i in 0..<8 {
            let exp = expectation(description: "concurrent requestPreciseTemp \(i)")
            exps.append(exp)
            plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
                XCTAssertNotNil(data?["accuracy"])
                exp.fulfill()
            }))
        }
        wait(for: exps, timeout: 60)
    }

    func testRequestPreciseTemp_repeatedCallsDoNotWobble() {
        var seen: [String] = []
        for i in 0..<5 {
            let exp = expectation(description: "requestPreciseTemp repeat \(i)")
            plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
                if let a = data?["accuracy"] as? String { seen.append(a) }
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
        XCTAssertEqual(seen.count, 5, "every call must resolve")
        XCTAssertEqual(Set(seen).count, 1, "nothing changed in between, so the answer must not wobble")
    }

    // Permission-denied path. Asking for accuracy must never disturb the
    // authorization axis itself: this is an upgrade to an existing grant, not
    // a second grant, and a version that quietly re-asked for authorization
    // would spend the one prompt iOS ever shows.
    func testRequestPreciseTemp_leavesTheAuthorizationStatusUntouched() {
        var before: String?
        let pre = expectation(description: "status before")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            before = data?["status"] as? String
            pre.fulfill()
        }))
        wait(for: [pre], timeout: 30)

        let ask = expectation(description: "requestPreciseTemp")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { _ in ask.fulfill() }))
        wait(for: [ask], timeout: 30)

        let post = expectation(description: "status after")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            XCTAssertEqual(data?["status"] as? String, before,
                           "the accuracy ask must not touch, or re-prompt for, the authorization grant")
            post.fulfill()
        }))
        wait(for: [post], timeout: 30)
    }

    // The two methods read the same CLLocationManager, so their accuracy
    // answers have to match. A JS caller asks for the upgrade and then
    // immediately re-reads status (_geoRequestPreciseTemp does exactly that);
    // if these two could disagree, the checklist would repaint into a state
    // the tap never produced.
    func testRequestPreciseTemp_agreesWithLocationPermStatusOnAccuracy() {
        var asked: String?
        let ask = expectation(description: "requestPreciseTemp accuracy")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            asked = data?["accuracy"] as? String
            ask.fulfill()
        }))
        wait(for: [ask], timeout: 30)

        let read = expectation(description: "locationPermStatus accuracy")
        plugin.locationPermStatus(makeCall(method: "locationPermStatus", onSuccess: { data in
            XCTAssertEqual(data?["accuracy"] as? String, asked, "one manager, one accuracy, two methods")
            read.fulfill()
        }))
        wait(for: [read], timeout: 30)
    }

    // Post-error / interrupted state: the engine torn down underneath it, the
    // way a backgrounded app or a stopAll from the JS layer leaves it. The
    // manager is rebuilt lazily by mgr(), so this must still answer rather
    // than resolve empty or hang.
    func testRequestPreciseTemp_stillAnswersAfterStopAll() {
        let stop = expectation(description: "stopAll first")
        plugin.stopAll(makeCall(onSuccess: { _ in stop.fulfill() }))
        wait(for: [stop], timeout: 30)

        let exp = expectation(description: "requestPreciseTemp after stopAll")
        plugin.requestPreciseTemp(makeCall(method: "requestPreciseTemp", onSuccess: { data in
            XCTAssertNotNil(data?["accuracy"], "a torn-down engine must still answer the accuracy question")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Registration is what makes the method reachable from JS at all. An
    // @objc func that never made it into pluginMethods is invisible to the
    // bridge, and the failure is silent: the JS side simply sees no such
    // method and falls back to Settings forever.
    func testRequestPreciseTemp_isRegisteredWithTheBridge() {
        XCTAssertTrue(plugin.pluginMethods.contains { $0.name == "requestPreciseTemp" },
                      "requestPreciseTemp must be in pluginMethods or JS can never call it")
    }

    // MARK: - motionPermStatus: read-only, never crashes, no arguments needed

    func testMotionPermStatus_resolvesWithStatusAndAvailability() {
        let exp = expectation(description: "motionPermStatus")
        plugin.motionPermStatus(makeCall(method: "motionPermStatus", onSuccess: { data in
            let status = data?["status"] as? String
            XCTAssertNotNil(status, "must always report a status string")
            XCTAssertTrue(["prompt", "restricted", "denied", "granted"].contains(status ?? ""),
                           "status must be one of the four documented values, got \(status ?? "nil")")
            XCTAssertNotNil(data?["available"], "must report device capability independent of authorization")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testMotionPermStatus_ignoresExtraneousOptions() {
        // Read-only status check, arguments in options should be harmless.
        let exp = expectation(description: "motionPermStatus with junk options")
        plugin.motionPermStatus(makeCall(method: "motionPermStatus", options: ["unexpected": "junk", "n": 42], onSuccess: { data in
            XCTAssertNotNil(data?["status"])
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - stats: reset actually zeroes the counters

    func testStats_resetTrueZeroesGpsOnMs() {
        // Rack up some measurable radio time first.
        let burst = expectation(description: "stats setup burst")
        plugin.burstFix(makeCall(options: ["seconds": 3], onSuccess: { _ in burst.fulfill() }))
        wait(for: [burst], timeout: 30)

        let stop = expectation(description: "stats setup stop")
        plugin.stopAll(makeCall(onSuccess: { _ in stop.fulfill() }))
        wait(for: [stop], timeout: 30)

        let reset = expectation(description: "stats reset")
        plugin.stats(makeCall(options: ["reset": true], onSuccess: { _ in reset.fulfill() }))
        wait(for: [reset], timeout: 30)

        let after = expectation(description: "stats after reset")
        plugin.stats(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["gpsOnMs"] as? Double, 0, "reset:true must actually zero the persisted counter, not just report it once")
            after.fulfill()
        }))
        wait(for: [after], timeout: 30)
    }

    // ── configureFlush (build 39: real-time ingest) ─────────────────────────
    // The flush lane's contract: config is all-or-nothing, and the watermark
    // only ever moves forward on acknowledged batches. The network itself is
    // exercised in the live flow test, not here; this stresses the plumbing
    // the same adversarial way as every other method in this file.

    func testConfigureFlushRejectsMissingArgs() {
        // Each required field absent must reject, never crash, and never
        // store a partial config a background wake would then flush with.
        UserDefaults.standard.removeObject(forKey: "td_geo_flush_cfg")
        let combos: [[String: Any]] = [
            [:],
            ["url": "https://x.example/functions/v1/ingest-geo"],
            ["url": "https://x.example", "userId": "u1"],
            ["url": "https://x.example", "userId": "u1", "deviceId": "d1"],
            ["url": "", "userId": "u1", "deviceId": "d1", "key": "k1"],
        ]
        for opts in combos {
            let rejected = expectation(description: "rejects \(opts.keys.sorted())")
            plugin.configureFlush(makeCall(
                options: opts,
                onSuccess: { _ in XCTFail("must reject incomplete config: \(opts)") },
                onError: { _ in rejected.fulfill() }
            ))
            wait(for: [rejected], timeout: 30)
        }
        XCTAssertNil(UserDefaults.standard.dictionary(forKey: "td_geo_flush_cfg"),
                     "an incomplete configure must not leave a stored config behind")
    }

    func testConfigureFlushStoresCompleteConfig() {
        let done = expectation(description: "configureFlush resolves")
        plugin.configureFlush(makeCall(
            options: ["url": "https://x.example/functions/v1/ingest-geo",
                      "userId": "u-test", "deviceId": "d-test", "key": "gfk_test"],
            onSuccess: { data in
                XCTAssertEqual(data?["configured"] as? Bool, true)
                done.fulfill()
            }
        ))
        wait(for: [done], timeout: 30)
        let cfg = UserDefaults.standard.dictionary(forKey: "td_geo_flush_cfg") as? [String: String]
        XCTAssertEqual(cfg?["userId"], "u-test")
        XCTAssertEqual(cfg?["key"], "gfk_test")
        UserDefaults.standard.removeObject(forKey: "td_geo_flush_cfg")
    }

    func testConfigureFlushDoubleCallLastWriterWins() {
        // Re-configuring (a new session, a rotated key) must replace, not
        // merge or duplicate: the same guard-race shape §11.2 tests in JS.
        for i in 1...5 {
            let done = expectation(description: "configure #\(i)")
            plugin.configureFlush(makeCall(
                options: ["url": "https://x.example/f", "userId": "u\(i)",
                          "deviceId": "d", "key": "k\(i)"],
                onSuccess: { _ in done.fulfill() }
            ))
            wait(for: [done], timeout: 30)
        }
        let cfg = UserDefaults.standard.dictionary(forKey: "td_geo_flush_cfg") as? [String: String]
        XCTAssertEqual(cfg?["userId"], "u5")
        XCTAssertEqual(cfg?["key"], "k5")
        UserDefaults.standard.removeObject(forKey: "td_geo_flush_cfg")
    }

    func testFlushDelegateFailedTaskLeavesWatermarkAndClearsInflight() {
        // Drive the REAL delegate method with a real (never-resumed) task:
        // no HTTP response means status 0, the failure branch, so the
        // watermark must not move and the inflight entry must be consumed
        // (a dead task that stayed inflight would block its ts range forever).
        let d = UserDefaults.standard
        d.set(2000.0, forKey: "td_geo_flush_ts")
        let session = URLSession.shared
        let task = session.dataTask(with: URL(string: "https://x.invalid/never-resumed")!)
        d.set([String(task.taskIdentifier): 5000.0], forKey: "td_geo_flush_inflight")
        plugin.urlSession(session, task: task, didCompleteWithError: nil)
        XCTAssertEqual(d.double(forKey: "td_geo_flush_ts"), 2000.0,
                       "a non-2xx completion must never advance the watermark")
        let inflight = (d.dictionary(forKey: "td_geo_flush_inflight") as? [String: Double]) ?? [:]
        XCTAssertNil(inflight[String(task.taskIdentifier)],
                     "the inflight entry is consumed either way, success or failure")
        d.removeObject(forKey: "td_geo_flush_ts")
        d.removeObject(forKey: "td_geo_flush_inflight")
    }

    func testFlushDelegateUnknownTaskIsANoOp() {
        // A callback for a task this plugin never sent (another library's
        // background session, a stale identifier) must change nothing.
        let d = UserDefaults.standard
        d.set(3000.0, forKey: "td_geo_flush_ts")
        d.removeObject(forKey: "td_geo_flush_inflight")
        let task = URLSession.shared.dataTask(with: URL(string: "https://x.invalid/unknown")!)
        plugin.urlSession(URLSession.shared, task: task, didCompleteWithError: nil)
        XCTAssertEqual(d.double(forKey: "td_geo_flush_ts"), 3000.0)
        d.removeObject(forKey: "td_geo_flush_ts")
    }

    // ── startHeartbeat / stopHeartbeat (build 39: shift liveness) ───────────

    func testHeartbeatClampsIntervalAndTtl() {
        // JS owns the numbers but the plugin still refuses garbage: a 1-second
        // interval would burn the battery the whole design exists to protect,
        // and a week-long ttl outlives any shift.
        let done = expectation(description: "startHeartbeat resolves")
        plugin.startHeartbeat(makeCall(
            options: ["intervalMs": 1000, "ttlMs": 999999999999],
            onSuccess: { data in
                XCTAssertEqual(data?["intervalMs"] as? Double, 60000, "floor is one minute")
                XCTAssertEqual(data?["ttlMs"] as? Double, 86400000, "ceiling is 24h")
                done.fulfill()
            }
        ))
        wait(for: [done], timeout: 30)
        let stopped = expectation(description: "teardown stopHeartbeat")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in stopped.fulfill() }))
        wait(for: [stopped], timeout: 30)
    }

    func testHeartbeatDoubleStartIsReplaceNotStack() {
        // Same guard-race shape as §11.2: N rapid starts must leave ONE timer,
        // provable by a single stop returning the session to off cleanly.
        for i in 1...5 {
            let done = expectation(description: "start #\(i)")
            plugin.startHeartbeat(makeCall(
                options: ["intervalMs": 60000],
                onSuccess: { data in
                    XCTAssertEqual(data?["on"] as? Bool, true)
                    done.fulfill()
                }
            ))
            wait(for: [done], timeout: 30)
        }
        let stopped = expectation(description: "one stop turns it off")
        plugin.stopHeartbeat(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["on"] as? Bool, false)
            stopped.fulfill()
        }))
        wait(for: [stopped], timeout: 30)
    }

    func testStopHeartbeatWithoutStartIsAGracefulNoOp() {
        let done = expectation(description: "unstarted stop resolves")
        plugin.stopHeartbeat(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["on"] as? Bool, false)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    // ── App lifecycle + silent push (owner 2026-08-27) ──────────────────────

    private func bufferCount(ofType t: String) -> Int {
        let buf = (UserDefaults.standard.array(forKey: "td_geo_fix_buffer") as? [[String: Any]]) ?? []
        return buf.filter { ($0["type"] as? String) == t }.count
    }

    // ── Motion transitions carry position (owner 2026-08-29) ────────────────
    // The tape is the day's clock now, so a transition with no position is
    // half a fact: the geofence cannot say WHERE the state changed. Every
    // motion row landed with lat/lon null before this (94 of 94 in the live
    // table), which is precisely why nothing could be rebuilt server-side.
    func testMotionEventsCarryKindAndPrevKind() {
        UserDefaults.standard.set(["mode": "events", "visits": true], forKey: "td_geo_armed")
        plugin.load()
        // Drive the recorder the way the activity handler does. The shape of
        // the row is the contract ingest-geo reads, so the shape is the test.
        let ev: [String: Any] = [
            "type": "motion", "ts": Double(Date().timeIntervalSince1970 * 1000),
            "kind": "automotive", "prevKind": "onFoot",
            "lat": 39.0103, "lng": -95.7790, "acc": 12.0, "fixAgeMs": 4000.0
        ]
        let before = bufferCount(ofType: "motion")
        plugin.recordForTest(ev)
        XCTAssertGreaterThan(bufferCount(ofType: "motion"), before)
        let buf = (UserDefaults.standard.array(forKey: "td_geo_fix_buffer") as? [[String: Any]]) ?? []
        let last = buf.last(where: { ($0["type"] as? String) == "motion" })
        XCTAssertEqual(last?["kind"] as? String, "automotive")
        XCTAssertEqual(last?["prevKind"] as? String, "onFoot",
                       "the edge, not just the destination state, is what names a boundary")
        XCTAssertNotNil(last?["lat"] as? Double, "a boundary with no position cannot be placed")
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
    }

    func testLifecycleEventsRecordOnlyWhenArmed() {
        // Armed: backgrounding writes an app-background row. record() persists
        // synchronously, so no waiting on a flush.
        UserDefaults.standard.set(["mode": "events", "visits": true], forKey: "td_geo_armed")
        plugin.load()
        let before = bufferCount(ofType: "app-background")
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        let armed = expectation(description: "armed background recorded")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            XCTAssertGreaterThan(self.bufferCount(ofType: "app-background"), before,
                                 "an armed device must record backgrounding")
            armed.fulfill()
        }
        wait(for: [armed], timeout: 30)
        // Unarmed: the same notification must write nothing. Tracking off
        // means no lifecycle surveillance, full stop.
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
        let quiet = bufferCount(ofType: "app-background")
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        let off = expectation(description: "unarmed background ignored")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            XCTAssertEqual(self.bufferCount(ofType: "app-background"), quiet,
                           "tracking off must record nothing")
            off.fulfill()
        }
        wait(for: [off], timeout: 30)
    }

    func testRelaunchRecordsALifecycleRowWhenArmed() {
        UserDefaults.standard.set(["mode": "events", "visits": false], forKey: "td_geo_armed")
        let before = bufferCount(ofType: "app-relaunch")
        plugin.load()
        XCTAssertGreaterThan(bufferCount(ofType: "app-relaunch"), before,
                             "an armed relaunch is the first sign of life after a kill and must be recorded")
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
    }

    func testSilentPushRecordsAPushPingOnlyWhenArmed() {
        UserDefaults.standard.set(["mode": "events", "visits": false], forKey: "td_geo_armed")
        plugin.load()
        let before = bufferCount(ofType: "push-ping")
        NotificationCenter.default.post(name: Notification.Name("TdSilentPush"), object: nil, userInfo: ["td": "geo-ping"])
        let armed = expectation(description: "push-ping recorded")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            XCTAssertGreaterThan(self.bufferCount(ofType: "push-ping"), before,
                                 "a silent push on an armed device must record a liveness event")
            armed.fulfill()
        }
        wait(for: [armed], timeout: 30)
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
        let quiet = bufferCount(ofType: "push-ping")
        NotificationCenter.default.post(name: Notification.Name("TdSilentPush"), object: nil, userInfo: ["td": "geo-ping"])
        let off = expectation(description: "unarmed push ignored")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            XCTAssertEqual(self.bufferCount(ofType: "push-ping"), quiet,
                           "tracking off must ignore the nudge")
            off.fulfill()
        }
        wait(for: [off], timeout: 30)
    }

    func testHeartbeatPersistsStateAndStopClearsIt() {
        // The whole point of the persisted dict: a force-quit or OS kill must
        // not silently end the shift's 30-minute beat (owner report
        // 2026-08-27, a full morning at a job with zero heartbeat events).
        let started = expectation(description: "heartbeat on")
        plugin.startHeartbeat(makeCall(options: ["intervalMs": 60000, "ttlMs": 3600000],
                                       onSuccess: { _ in started.fulfill() }))
        wait(for: [started], timeout: 30)
        let hb = UserDefaults.standard.dictionary(forKey: "td_geo_hb")
        XCTAssertNotNil(hb, "startHeartbeat must persist its state for load() to restore")
        XCTAssertEqual(hb?["intervalMs"] as? Double, 60000)
        XCTAssertEqual(hb?["ttlMs"] as? Double, 3600000)
        XCTAssertNotNil(hb?["startedAtMs"] as? Double)
        let stopped = expectation(description: "heartbeat off")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in stopped.fulfill() }))
        wait(for: [stopped], timeout: 30)
        XCTAssertNil(UserDefaults.standard.dictionary(forKey: "td_geo_hb"),
                     "stopHeartbeat must clear the persisted state or a home park would not survive a relaunch")
    }

    func testLoadRestoresAFreshHeartbeatAndDropsAnExpiredOne() {
        // Fresh: started 1 minute ago, ttl 1h. load() must bring the beat back
        // (one stop returns it to off, proving a timer existed to stop).
        UserDefaults.standard.set(["mode": "events", "visits": true], forKey: "td_geo_armed")
        UserDefaults.standard.set([
            "intervalMs": 60000.0, "ttlMs": 3600000.0,
            "startedAtMs": Date().timeIntervalSince1970 * 1000 - 60000
        ], forKey: "td_geo_hb")
        plugin.load()
        let wait1 = expectation(description: "restored beat stops")
        // Give load()'s main-queue hop a beat before asserting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.plugin.stopHeartbeat(self.makeCall(onSuccess: { data in
                XCTAssertEqual(data?["on"] as? Bool, false)
                wait1.fulfill()
            }))
        }
        wait(for: [wait1], timeout: 30)
        // Expired: started 2h ago, ttl 1h. load() must clear it, not restart it.
        UserDefaults.standard.set([
            "intervalMs": 60000.0, "ttlMs": 3600000.0,
            "startedAtMs": Date().timeIntervalSince1970 * 1000 - 7200000
        ], forKey: "td_geo_hb")
        plugin.load()
        let wait2 = expectation(description: "expired state cleared")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            XCTAssertNil(UserDefaults.standard.dictionary(forKey: "td_geo_hb"),
                         "an expired beat must be dropped at relaunch, never restarted")
            wait2.fulfill()
        }
        wait(for: [wait2], timeout: 30)
        UserDefaults.standard.removeObject(forKey: "td_geo_armed")
    }

    func testStopAllTearsDownHeartbeat() {
        // stopAll is the tracking kill switch; a heartbeat surviving it would
        // keep a location session alive after the user turned tracking off.
        let started = expectation(description: "heartbeat on")
        plugin.startHeartbeat(makeCall(options: ["intervalMs": 60000], onSuccess: { _ in started.fulfill() }))
        wait(for: [started], timeout: 30)
        let cleared = expectation(description: "stopAll resolves")
        plugin.stopAll(makeCall(onSuccess: { _ in cleared.fulfill() }))
        wait(for: [cleared], timeout: 30)
        // A second explicit stop after stopAll must read already-off.
        let after = expectation(description: "post-stopAll stop is off")
        plugin.stopHeartbeat(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["on"] as? Bool, false)
            after.fulfill()
        }))
        wait(for: [after], timeout: 30)
    }
}

// ── The wake is for the tape, so pull the tape ───────────────────────────────
//
// Region monitoring is the one location service Apple relaunches a force-quit
// app for, and that relaunch was doing nothing with itself: the delegate
// recorded the crossing and stopped, while the motion history it was woken to
// collect went unread, because motionSince() is JS-callable and a cold launch
// has no JS yet.
//
// These stress the backfill the same way the rest of this file stresses the
// plugin: real methods, adversarial input, no simulator UI. The coprocessor is
// unavailable on the simulator, which is itself one of the cases that has to
// not crash, so the tests that need real transitions assert the CONTRACT (the
// mark, the coordinate rule, the bounds) rather than a transition count.
extension TdGeoPluginTests {

    private var markKey: String { plugin.motionMarkKeyForTest }

    func testBackfillNeverThrowsWithNoCoprocessor() {
        // The simulator has no motion coprocessor. A wake there must be a
        // silent no-op, never a crash: iOS TERMINATES a process that touches
        // CoreMotion wrong, and a force-quit wake is exactly when nobody is
        // watching to notice.
        UserDefaults.standard.removeObject(forKey: markKey)
        plugin.backfillMotionHistoryForTest()
        plugin.backfillMotionHistoryForTest()
        XCTAssertTrue(true, "two backfills in a row did not crash the process")
    }

    func testBackfillMarkIsNeverMovedBackwards() {
        // A wake must never re-emit history a previous wake already pulled, and
        // the guard for that is a mark that only ever advances. If a backfill
        // could lower it, every subsequent wake would re-send the same days.
        let ahead = (Date().timeIntervalSince1970 * 1000) - 60_000
        UserDefaults.standard.set(ahead, forKey: markKey)
        plugin.backfillMotionHistoryForTest()
        let after = UserDefaults.standard.double(forKey: markKey)
        XCTAssertGreaterThanOrEqual(after, ahead,
            "the backfill mark moved backwards, so the next wake re-sends history")
    }

    func testBackfillMarkIsFlooredAtSevenDays() {
        // The coprocessor keeps about a week. A mark of 0 (a fresh install, or
        // a wiped defaults) must not ask for the epoch: queryActivityStarting
        // with a distant-past date is a pointless round trip at best.
        UserDefaults.standard.set(0.0, forKey: markKey)
        plugin.backfillMotionHistoryForTest()
        let after = UserDefaults.standard.double(forKey: markKey)
        let weekAgo = (Date().timeIntervalSince1970 * 1000) - 7 * 24 * 3600 * 1000
        XCTAssertTrue(after == 0 || after >= weekAgo,
            "a zero mark must floor to the coprocessor's own window, not the epoch")
    }

    func testBackfillMarkSurvivesAGarbageValue() {
        // §3.3 input classes: whatever is in defaults is not to be trusted.
        for junk in [Double.nan, -1, .infinity, 1e18] {
            UserDefaults.standard.set(junk, forKey: markKey)
            plugin.backfillMotionHistoryForTest()
        }
        XCTAssertTrue(true, "a corrupt mark never crashed the backfill")
    }

    func testBackfillFreshnessWindowIsBounded() {
        // The rule that keeps a backfilled row honest: only a transition within
        // this window of the wake may borrow the wake's coordinate. Wider and
        // an hours-old transition gets stamped with where the truck is NOW,
        // which reads exactly like a fact and is not one. CoreMotion history
        // carries no location of its own and iOS keeps none to pair with it.
        XCTAssertEqual(TdGeoPlugin.backfillFreshMsForTest, 90_000,
            "the freshness window is the whole guard against inventing a place")
    }

    func testRegionWakeRecordsTheCrossingBeforeTheBackfill() {
        // Order matters on a cold wake: the crossing is the fact we were woken
        // for and must be buffered even if the motion query never calls back.
        UserDefaults.standard.removeObject(forKey: "td_geo_fix_buffer")
        plugin.locationManager(CLLocationManager(),
                               didExitRegion: CLCircularRegion(
                                   center: CLLocationCoordinate2D(latitude: 39.03, longitude: -95.71),
                                   radius: 180, identifier: "place-1"))
        let buf = (UserDefaults.standard.array(forKey: "td_geo_fix_buffer") as? [[String: Any]]) ?? []
        XCTAssertTrue(buf.contains { ($0["type"] as? String) == "regionExit" },
            "the crossing must land whatever the coprocessor does afterwards")
    }

    // ── The urgent flush lane (owner 2026-08-31) ────────────────────────────
    // The debounce was a DispatchQueue.main.asyncAfter, and a backgrounded app
    // is suspended within milliseconds, so the timer never fired. Measured on
    // his phone: 2 to 3 second delivery while the app was open, then 1028,
    // 990, 888, 703 and 321 seconds for everything after he backgrounded it,
    // including two region crossings that had woken the app and been recorded
    // on time. They were recorded and then sat behind a timer with no process
    // left to fire on.
    //
    // XCTest cannot background a simulator, so what is asserted here is what a
    // plugin-level test can actually prove (§3.3): that a lane which now runs
    // on every crossing and every backgrounding is safe to run that often, and
    // from any queue, and with nothing to send.

    func testUrgentFlushIsSafeWithNoConfigAtAll() {
        // The common case on a fresh install: tracking armed before JS has
        // handed over the endpoint. It must be a no-op, never a crash on a
        // region wake.
        UserDefaults.standard.removeObject(forKey: plugin.flushCfgKeyForTest)
        plugin.flushUrgentlyForTest()
        XCTAssertTrue(true, "no config is a no-op, not a crash")
    }

    func testUrgentFlushIsSafeWithAnEmptyBuffer() {
        UserDefaults.standard.removeObject(forKey: plugin.bufferKeyForTest)
        plugin.flushUrgentlyForTest()
        XCTAssertTrue(true, "nothing to send is nothing to do")
    }

    func testUrgentFlushSurvivesAJunkConfig() {
        // Half a config is the shape a partial write leaves behind. Every
        // field is guarded, so this must fall through rather than force-unwrap.
        UserDefaults.standard.set(["url": "not a url"], forKey: plugin.flushCfgKeyForTest)
        plugin.flushUrgentlyForTest()
        UserDefaults.standard.set(["url": "https://example.invalid/f", "userId": "u"],
                                  forKey: plugin.flushCfgKeyForTest)
        plugin.flushUrgentlyForTest()
        UserDefaults.standard.removeObject(forKey: plugin.flushCfgKeyForTest)
        XCTAssertTrue(true, "a partial config never reaches the network")
    }

    func testUrgentFlushIsSafeOffTheMainThread() {
        // CoreLocation and CoreMotion callbacks are not guaranteed to be on
        // main, and this lane touches UIApplication, which is main-only.
        let done = expectation(description: "off-main flush returned")
        DispatchQueue.global(qos: .utility).async {
            self.plugin.flushUrgentlyForTest()
            self.plugin.scheduleFlushForTest()
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
    }

    func testRepeatedUrgentFlushesDoNotPileUp() {
        // It now runs on every crossing. A truck circling a block trips the
        // same fence repeatedly and must not leak background-task assertions
        // or crash on overlapping calls (§11.2, concurrent-call class).
        UserDefaults.standard.removeObject(forKey: plugin.flushCfgKeyForTest)
        for _ in 0..<25 { plugin.flushUrgentlyForTest() }
        XCTAssertTrue(true, "25 back-to-back urgent flushes are survivable")
    }

    func testRegionCrossingsStillRecordWithTheUrgentFlushInPlace() {
        // The regression guard for the change itself: adding the flush to both
        // delegate callbacks must not disturb what they were already for.
        UserDefaults.standard.removeObject(forKey: "td_geo_fix_buffer")
        UserDefaults.standard.removeObject(forKey: plugin.flushCfgKeyForTest)
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 39.03, longitude: -95.71),
            radius: 180, identifier: "place-1")
        plugin.locationManager(CLLocationManager(), didExitRegion: region)
        plugin.locationManager(CLLocationManager(), didEnterRegion: region)
        let buf = (UserDefaults.standard.array(forKey: "td_geo_fix_buffer") as? [[String: Any]]) ?? []
        XCTAssertTrue(buf.contains { ($0["type"] as? String) == "regionExit" })
        XCTAssertTrue(buf.contains { ($0["type"] as? String) == "regionEnter" })
    }

    // ── One flip, one id (owner rule 2026-08-31) ────────────────────────────
    // "we should only write one, ever ... one ID that runs through the journey
    // per core motion flip." The live stream already refused to emit an
    // unchanged kind, but its memory of the last kind was in-memory and reset
    // on every re-arm, and it is re-armed from three places. So one state
    // change was reported once per re-arm: his 1:19pm departure fired
    // automotive at 18:19:10.215, 18:20:35.529, .747 and .788. Four candidate
    // start instants, a key computed from the start millisecond, two writers,
    // two rows.

    func testLastMotionKindSurvivesANewPluginInstance() {
        // The regression guard for the actual bug. A fresh instance stands in
        // for a re-arm, which is what wiped the in-memory value.
        UserDefaults.standard.set("automotive", forKey: "td_geo_last_motion_kind")
        let fresh = TdGeoPlugin()
        XCTAssertEqual(UserDefaults.standard.string(forKey: "td_geo_last_motion_kind"), "automotive",
            "a new instance must not forget what state the phone was already in")
        _ = fresh
    }

    func testFlipIdsAreUniqueAndNotDerivedFromTheClock() {
        // Two flips in the same millisecond must still be two ids. A key
        // derived from the clock is exactly what could not do this.
        var seen = Set<String>()
        for _ in 0..<500 {
            UserDefaults.standard.removeObject(forKey: "td_geo_last_motion_kind")
            seen.insert(plugin.newFlipIdForTest())
        }
        XCTAssertEqual(seen.count, 500, "every flip gets its own id")
    }

    func testFlipIdShapeIsKeySafe() {
        // It goes straight into a database key and a URL-ish context, so it
        // must be short and free of anything that needs escaping.
        let id = plugin.newFlipIdForTest()
        XCTAssertTrue(id.hasPrefix("f"))
        XCTAssertEqual(id.count, 17, "f plus 16 hex characters")
        XCTAssertNil(id.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted),
            "no dashes, no punctuation, nothing to escape")
    }

    // ── THE DRIVE WINDOW (owner 2026-09-01) ─────────────────────────────────
    // "gps continuous should only fire when core motion goes automotive [and]
    // a gps ping ... then the 30 minute cron job keeps confirming."
    //
    // JS owns every decision. What Swift owns, and what these stress, is the
    // capability and the ONE thing JS cannot be trusted with: giving the radio
    // back when nobody remembers to ask. A phone left at
    // kCLLocationAccuracyBest overnight is the worst outcome this whole
    // feature can produce, so the cap gets adversarial coverage in every shape
    // it can be reached: malformed arguments, no arguments, double starts, an
    // app relaunched into an expired window, and a stopAll on top of it.

    func testSetSampling_driveArmsTheWindowAndReportsItsOwnTerms() {
        let done = expectation(description: "setSampling drive")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { data in
            XCTAssertEqual(data?["mode"] as? String, "drive")
            XCTAssertEqual(data?["distanceFilter"] as? Double,
                           TdGeoPlugin.driveFilterDefaultMForTest,
                           "the default filter is the plugin's, not the caller's guess")
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest(), "the window must be armed and persisted")
    }

    func testSetSampling_clampsAnAbsurdCapRatherThanTrustingIt() {
        // JS owns the number and the plugin still refuses garbage: a week-long
        // window is the exact failure the cap exists to prevent, so a caller
        // cannot ask for one.
        let done = expectation(description: "clamped")
        plugin.setSampling(makeCall(
            options: ["mode": "drive", "maxMs": 999_999_999_999.0],
            onSuccess: { data in
                XCTAssertEqual(data?["maxMs"] as? Double, TdGeoPlugin.samplingCapCeilingMsForTest,
                               "four hours is the ceiling, whatever was asked for")
                done.fulfill()
            }))
        wait(for: [done], timeout: 30)
    }

    func testSetSampling_clampsAFloorSoAOneMillisecondWindowIsImpossible() {
        let done = expectation(description: "floor")
        plugin.setSampling(makeCall(
            options: ["mode": "drive", "maxMs": 1.0],
            onSuccess: { data in
                XCTAssertEqual(data?["maxMs"] as? Double, TdGeoPlugin.samplingCapFloorMsForTest)
                done.fulfill()
            }))
        wait(for: [done], timeout: 30)
    }

    func testSetSampling_clampsTheDistanceFilterBothWays() {
        let cases: [(Double, Double)] = [(0.5, 5), (5000, 200)]
        for (asked, want) in cases {
            let done = expectation(description: "filter \(asked)")
            plugin.setSampling(makeCall(
                options: ["mode": "drive", "distanceFilter": asked],
                onSuccess: { data in
                    XCTAssertEqual(data?["distanceFilter"] as? Double, want)
                    done.fulfill()
                }))
            wait(for: [done], timeout: 30)
        }
    }

    func testSetSampling_noModeAtAllMeansCoarse_neverAccidentalDrive() {
        // A bridge call with no options must never turn the radio UP. Silence
        // reads as "go dark", the safe direction.
        let done = expectation(description: "no options")
        plugin.setSampling(makeCall(options: [:], onSuccess: { data in
            XCTAssertEqual(data?["mode"] as? String, "coarse")
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
        XCTAssertFalse(plugin.driveSamplingOnForTest())
    }

    func testSetSampling_junkModeIsCoarse_notARejection() {
        // Same contract locationPermStatus carries: always answer, never
        // reject, because a rejected promise on this path leaves JS unable to
        // tell "the radio is down" from "the bridge is broken".
        for junk in ["DRIVE ", "banana", "", "0"] {
            let done = expectation(description: "junk \(junk)")
            plugin.setSampling(makeCall(options: ["mode": junk], onSuccess: { data in
                XCTAssertEqual(data?["mode"] as? String, "coarse")
                done.fulfill()
            }))
            wait(for: [done], timeout: 30)
        }
    }

    func testSetSampling_modeIsCaseInsensitive() {
        let done = expectation(description: "DRIVE")
        plugin.setSampling(makeCall(options: ["mode": "DRIVE"], onSuccess: { data in
            XCTAssertEqual(data?["mode"] as? String, "drive")
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest())
    }

    func testSetSampling_wrongTypesDoNotCrashAndDoNotArmADrive() {
        let done = expectation(description: "wrong types")
        plugin.setSampling(makeCall(
            options: ["mode": 42, "maxMs": "later", "distanceFilter": [1, 2]],
            onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 30)
        XCTAssertFalse(plugin.driveSamplingOnForTest(), "a non-string mode is not \"drive\"")
    }

    func testSetSampling_repeatedDriveCallsAreOneWindow_notAStack() {
        // Same guard-race shape as 11.2. JS re-asserts every few minutes and on
        // every confirmation; N asserts must leave ONE window and ONE cap.
        for i in 1...8 {
            let done = expectation(description: "assert #\(i)")
            plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in done.fulfill() }))
            wait(for: [done], timeout: 30)
        }
        XCTAssertTrue(plugin.driveSamplingOnForTest())
        let off = expectation(description: "one close ends it")
        plugin.setSampling(makeCall(options: ["mode": "coarse"], onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
        XCTAssertFalse(plugin.driveSamplingOnForTest(),
                       "one close must end it however many times it was asserted")
    }

    func testSamplingState_reportsCoarseWhenNothingIsArmed() {
        let done = expectation(description: "state coarse")
        plugin.samplingState(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["mode"] as? String, "coarse")
            XCTAssertEqual(data?["remainingMs"] as? Double, 0)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testSamplingState_remainingNeverExceedsTheCapAndNeverGoesNegative() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "maxMs": 120000.0],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        let done = expectation(description: "state")
        plugin.samplingState(makeCall(onSuccess: { data in
            let left = data?["remainingMs"] as? Double ?? -1
            XCTAssertGreaterThan(left, 0)
            XCTAssertLessThanOrEqual(left, 120000.0)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testSamplingCapFiring_putsTheRadioBackWithoutAnybodyAsking() {
        // THE POINT OF THE WHOLE SAFETY CAP. JS is assumed absent here: this is
        // the app-killed-mid-drive case, and nothing but this timer is left.
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest())
        plugin.expireSamplingCapForTest()
        XCTAssertFalse(plugin.driveSamplingOnForTest(), "the cap must revert on its own")
        // ...and it says so on the tape, so the server and JS both learn about
        // a close neither of them asked for.
        let buf = (UserDefaults.standard.array(forKey: "td_geo_fix_buffer") as? [[String: Any]]) ?? []
        XCTAssertTrue(buf.contains { ($0["type"] as? String) == "sampling"
                                     && ($0["mode"] as? String) == "coarse" },
                      "a cap that fires silently is a cap nobody can debug")
    }

    func testSamplingCap_firingTwiceIsANoOpNotADoubleRefund() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        plugin.expireSamplingCapForTest()
        plugin.expireSamplingCapForTest()   // must not crash, must not re-record
        XCTAssertFalse(plugin.driveSamplingOnForTest())
    }

    func testSamplingRestore_anExpiredWindowIsClearedRatherThanResumed() {
        // A relaunch mid-drive resumes; a relaunch into a window that ran out
        // hours ago must NOT hand itself a fresh 45 minutes of Best accuracy.
        UserDefaults.standard.set([
            "mode": "drive",
            "startedAtMs": Date().timeIntervalSince1970 * 1000 - 10 * 3600_000,
            "maxMs": 60000.0,
            "filter": 30.0,
        ], forKey: plugin.samplingKeyForTest)
        plugin.restoreSamplingWindowForTest()
        let done = expectation(description: "settle")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 30)
        XCTAssertFalse(plugin.driveSamplingOnForTest(),
                       "the cap is judged from the ORIGINAL start, so this one is spent")
    }

    func testSamplingRestore_aLiveWindowComesBackAcrossARelaunch() {
        UserDefaults.standard.set([
            "mode": "drive",
            "startedAtMs": Date().timeIntervalSince1970 * 1000 - 1000,
            "maxMs": 600000.0,
            "filter": 30.0,
        ], forKey: plugin.samplingKeyForTest)
        plugin.restoreSamplingWindowForTest()
        let done = expectation(description: "settle")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest(),
                      "a drive that outlived the process keeps its route")
    }

    func testSamplingRestore_withNothingStoredIsACompleteNoOp() {
        UserDefaults.standard.removeObject(forKey: plugin.samplingKeyForTest)
        plugin.restoreSamplingWindowForTest()
        XCTAssertFalse(plugin.driveSamplingOnForTest())
    }

    func testSamplingRestore_corruptStoredStateNeverArmsADrive() {
        // UserDefaults is ours, but a half-written dictionary or an older
        // build's shape must fail closed, never into Best accuracy.
        let junkStates: [[String: Any]] = [
            ["mode": "drive"],                       // no start, no cap
            ["mode": 7, "startedAtMs": "x"],         // wrong types throughout
            [:],                                     // nothing at all
        ]
        for junk in junkStates {
            UserDefaults.standard.set(junk, forKey: plugin.samplingKeyForTest)
            plugin.restoreSamplingWindowForTest()
            let done = expectation(description: "settle")
            DispatchQueue.main.async { done.fulfill() }
            wait(for: [done], timeout: 30)
            XCTAssertFalse(plugin.driveSamplingOnForTest(),
                           "corrupt state must fail closed")
        }
    }

    func testStopAll_endsAnOpenDriveWindow() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        let stopped = expectation(description: "stopAll")
        plugin.stopAll(makeCall(onSuccess: { _ in stopped.fulfill() }))
        wait(for: [stopped], timeout: 30)
        XCTAssertFalse(plugin.driveSamplingOnForTest(),
                       "signing out must not leave the receiver up")
    }

    func testDriveWindow_countsItsOwnRadioTime() {
        // Battery is the named uninstall driver in this category, so the window
        // has to be measurable in the same currency every other engine is.
        UserDefaults.standard.set(0.0, forKey: "td_geo_gps_on_ms")
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        let wait1 = expectation(description: "a beat of radio")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { wait1.fulfill() }
        wait(for: [wait1], timeout: 30)
        plugin.expireSamplingCapForTest()
        XCTAssertGreaterThan(UserDefaults.standard.double(forKey: "td_geo_gps_on_ms"), 0,
                             "a window that costs radio must bill for it")
    }

    // ── The keepalive, which is the blue arrow (owner 2026-09-01) ───────────

    func testHeartbeatKeepalive_defaultsToOff() {
        // The owner's visible test: no standing background location session
        // means no status-bar indicator between drives. JS must ASK for the
        // keepalive; the plugin never assumes it.
        let done = expectation(description: "default")
        plugin.startHeartbeat(makeCall(options: ["intervalMs": 60000], onSuccess: { data in
            XCTAssertEqual(data?["keepalive"] as? Bool, false)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
        XCTAssertFalse(plugin.heartbeatKeepaliveForTest)
        let off = expectation(description: "teardown")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
    }

    func testHeartbeatKeepalive_isHonouredWhenExplicitlyAskedFor() {
        // The escape hatch: if drives start being missed, one JS argument and a
        // UAT roll puts the old behaviour back with no rebuild (3.2).
        let done = expectation(description: "on")
        plugin.startHeartbeat(makeCall(
            options: ["intervalMs": 60000, "keepalive": true],
            onSuccess: { data in
                XCTAssertEqual(data?["keepalive"] as? Bool, true)
                done.fulfill()
            }))
        wait(for: [done], timeout: 30)
        XCTAssertTrue(plugin.heartbeatKeepaliveForTest)
        let off = expectation(description: "teardown")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
        XCTAssertFalse(plugin.heartbeatKeepaliveForTest, "stopping clears it")
    }

    func testHeartbeatKeepalive_isPersistedSoARelaunchDoesNotInventOne() {
        let done = expectation(description: "start")
        plugin.startHeartbeat(makeCall(options: ["intervalMs": 60000], onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 30)
        let hb = UserDefaults.standard.dictionary(forKey: "td_geo_hb")
        XCTAssertEqual(hb?["keepalive"] as? Bool, false,
                       "a relaunch reads this; absent must never be read as on")
        let off = expectation(description: "teardown")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
    }

    func testHeartbeatAndDriveWindow_doNotFightOverTheReceiver() {
        // The heartbeat tick used to stamp 3km/99999 over whatever the radio
        // was doing every 30 minutes, which would have flattened the middle of
        // a long route. Ending a shift mid-leg must not cut the route either.
        let armed = expectation(description: "drive")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        let hb = expectation(description: "heartbeat on top")
        plugin.startHeartbeat(makeCall(options: ["intervalMs": 60000, "keepalive": true],
                                       onSuccess: { _ in hb.fulfill() }))
        wait(for: [hb], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest(), "the window survives a heartbeat arming")
        let off = expectation(description: "shift ends")
        plugin.stopHeartbeat(makeCall(onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest(),
                      "ending the shift must not end the drive that is still happening")
    }

    // ── Permission-denied and capability gaps (3.3's input-class table) ─────

    func testSetSampling_answersEvenWithLocationUnauthorized() {
        // The simulator runs these unauthorized. The contract is that the call
        // still RESOLVES with a complete answer: a JS layer waiting on a
        // promise that never settles is worse than a radio that never came up.
        let done = expectation(description: "unauthorized")
        plugin.setSampling(makeCall(options: ["mode": "drive"], onSuccess: { data in
            XCTAssertNotNil(data?["mode"])
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testSetSampling_concurrentCallsAllResolveExactlyOnce() {
        var n = 0
        let lock = NSLock()
        let all = expectation(description: "all resolve")
        all.expectedFulfillmentCount = 10
        for i in 0..<10 {
            let mode = i % 2 == 0 ? "drive" : "coarse"
            DispatchQueue.global().async {
                self.plugin.setSampling(self.makeCall(options: ["mode": mode], onSuccess: { _ in
                    lock.lock(); n += 1; lock.unlock()
                    all.fulfill()
                }))
            }
        }
        wait(for: [all], timeout: 30)
        XCTAssertEqual(n, 10, "every caller gets exactly one answer")
    }

    func testSetSampling_stillAnswersAfterStopAll() {
        let stopped = expectation(description: "stopAll")
        plugin.stopAll(makeCall(onSuccess: { _ in stopped.fulfill() }))
        wait(for: [stopped], timeout: 30)
        let done = expectation(description: "after")
        plugin.setSampling(makeCall(options: ["mode": "coarse"], onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 30)
    }

    // MARK: - the drive-window flush batch (owner 2026-09-01, "can't have that")
    //
    // The defect these guard: a 30m distance filter delivers a fix roughly
    // every two seconds, a 1.5s debounce coalesces nothing at that rate, and
    // the result was one upload per fix, 127 of them in a six-minute drive.
    // What must stay true is BOTH halves: breadcrumbs batch, and anything a
    // person actually watches still goes out on the old 1.5s.

    /// Arms a drive window and returns once the plugin has answered.
    private func armDrive(flushMs: Double? = nil, file: StaticString = #filePath, line: UInt = #line) {
        var opts: [String: Any] = ["mode": "drive"]
        if let f = flushMs { opts["flushMs"] = f }
        let armed = expectation(description: "arm drive")
        plugin.setSampling(makeCall(options: opts, onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        XCTAssertTrue(plugin.driveSamplingOnForTest(), file: file, line: line)
    }

    func testSetSampling_carriesTheJsSuppliedFlushInterval() {
        armDrive(flushMs: 20000)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(), 20, accuracy: 0.001)
    }

    func testSetSampling_withNoFlushMsKeepsTheOneAndAHalfSecondsItAlwaysHad() {
        // A shell running JS that predates flushMs must behave exactly as
        // before. This is the whole reason the default is not 20 seconds.
        armDrive()
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    func testSetSampling_clampsAnAbsurdFlushIntervalAtBothEnds() {
        armDrive(flushMs: 1)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceFloorMsForTest / 1000, accuracy: 0.001,
                       "a tiny value must not spin the uploads back up")
        armDrive(flushMs: 9_999_999)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceCeilingMsForTest / 1000, accuracy: 0.001,
                       "a huge value must not park the buffer for an hour")
    }

    func testSetSampling_flushMsOfWrongTypeFallsBackRatherThanCrashing() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "flushMs": "twenty seconds"],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    func testSamplingState_reportsTheFlushIntervalBackToJs() {
        armDrive(flushMs: 20000)
        let done = expectation(description: "state")
        plugin.samplingState(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["flushMs"] as? Double, 20000)
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testDriveFlushDelay_isTheDefaultWhenNoWindowIsArmedAtAll() {
        UserDefaults.standard.removeObject(forKey: plugin.samplingKeyForTest)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    func testDriveFlushDelay_survivesARelaunchMidDrive() {
        // restoreSamplingWindow rewrites nothing, so the interval JS chose has
        // to still be there after the process comes back.
        armDrive(flushMs: 20000)
        plugin.restoreSamplingWindowForTest()
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(), 20, accuracy: 0.001)
    }

    // The decision, asserted directly. scheduleFlush's own timer is gated on
    // UIApplication being .active, which is true of the test host in practice
    // but is not something a test may DEPEND on: a suite that quietly asserts
    // nothing whenever the simulator backgrounds the host is worse than no
    // suite. flushDelaySec is the whole rule, so that is what gets stressed,
    // and the two tests below that genuinely need the timer say so.

    func testFlushDelay_aDriveBreadcrumbWaitsForTheBatchWindow() {
        armDrive(flushMs: 20000)
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "fix"), 20, accuracy: 0.001)
    }

    func testFlushDelay_everyEventAPersonWatchesStaysOnTheLiveLaneMidDrive() {
        // The battery fix must not become the live-updates bug (2026-08-31)
        // wearing a different hat. Every one of these is something the owner
        // or a dispatcher is looking at a screen for.
        armDrive(flushMs: 20000)
        let live = TdGeoPlugin.flushDebounceMsForTest / 1000
        for t in ["regionEnter", "regionExit", "visit", "motion", "push-ping",
                  "heartbeat", "app-active", "app-background", "app-relaunch",
                  "app-terminate", "sampling"] {
            XCTAssertEqual(plugin.flushDelaySecForTest(for: t), live, accuracy: 0.001,
                           "\(t) must not be delayed by a drive")
        }
    }

    func testFlushDelay_breadcrumbsOutsideADriveAreNotBatched() {
        // No window armed: a `fix` is just an event and takes the normal lane.
        UserDefaults.standard.removeObject(forKey: plugin.samplingKeyForTest)
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "fix"),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    func testFlushDelay_anEmptyOrUnknownTypeIsTreatedAsLiveNotBatched() {
        armDrive(flushMs: 20000)
        let live = TdGeoPlugin.flushDebounceMsForTest / 1000
        XCTAssertEqual(plugin.flushDelaySecForTest(for: ""), live, accuracy: 0.001)
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "Fix"), live, accuracy: 0.001,
                       "the match is exact; a near miss must fail live, never silent")
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "something-new"), live, accuracy: 0.001)
    }

    func testFlushDelay_revertsTheInstantTheWindowCloses() {
        armDrive(flushMs: 20000)
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "fix"), 20, accuracy: 0.001)
        plugin.expireSamplingCapForTest()
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "fix"),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    func testFlushDelay_neverThrowsOnAGarbageSamplingDict() {
        // UserDefaults is writable by anything in the process, and a half
        // written dict from an older build must degrade to the safe interval.
        UserDefaults.standard.set(["mode": "drive", "flushMs": ["nope"]],
                                  forKey: plugin.samplingKeyForTest)
        XCTAssertEqual(plugin.flushDelaySecForTest(for: "fix"),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    // The two that need the real timer. Both assert nothing unless the host is
    // foregrounded, so they are written to SKIP rather than to pass vacuously.

    func testScheduleFlush_aFenceCrossingSupersedesAPendingBreadcrumbBatch() throws {
        // THE ONE THAT MATTERS. Without the earlier-deadline-wins rule the
        // pending 20s window would swallow the crossing and delay it.
        armDrive(flushMs: 20000)
        let done = expectation(description: "superseded")
        var skipped = false
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else {
                skipped = true; done.fulfill(); return
            }
            self.plugin.scheduleFlushForTest(type: "fix")
            let batched = self.plugin.flushDeadlineForTest?.timeIntervalSinceNow ?? -1
            XCTAssertGreaterThan(batched, 10)
            self.plugin.scheduleFlushForTest(type: "regionEnter")
            let live = self.plugin.flushDeadlineForTest?.timeIntervalSinceNow ?? -1
            XCTAssertLessThanOrEqual(live, 2.0, "an earlier deadline must win")
            done.fulfill()
        }
        wait(for: [done], timeout: 30)
        try XCTSkipIf(skipped, "host app was not foregrounded")
    }

    func testScheduleFlush_aSecondBreadcrumbNeverPushesTheDeadlineOut() throws {
        // The bound. A fix every two seconds re-arming a 20s window would park
        // the buffer for the length of the drive and land nothing until it
        // ended, which is a worse bug than the one being fixed.
        armDrive(flushMs: 20000)
        let done = expectation(description: "bounded")
        var skipped = false
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else {
                skipped = true; done.fulfill(); return
            }
            self.plugin.scheduleFlushForTest(type: "fix")
            let first = self.plugin.flushDeadlineForTest
            XCTAssertNotNil(first)
            self.plugin.scheduleFlushForTest(type: "fix")
            self.plugin.scheduleFlushForTest(type: "fix")
            XCTAssertEqual(self.plugin.flushDeadlineForTest, first,
                           "later breadcrumbs ride the window already open")
            done.fulfill()
        }
        wait(for: [done], timeout: 30)
        try XCTSkipIf(skipped, "host app was not foregrounded")
    }

    func testScheduleFlush_offTheMainThreadNeverCrashes() {
        // record() is called from CoreLocation and CoreMotion callbacks that
        // are on neither the main thread nor each other's. No state assertion
        // here on purpose: surviving the bounce is the claim.
        armDrive(flushMs: 20000)
        let done = expectation(description: "bounced")
        DispatchQueue.global().async {
            self.plugin.scheduleFlushForTest(type: "fix")
            self.plugin.scheduleFlushForTest(type: "regionExit")
            DispatchQueue.main.async { done.fulfill() }
        }
        wait(for: [done], timeout: 30)
    }

    func testFlushUrgently_clearsAPendingBreadcrumbBatch() {
        // Backgrounding mid-drive: the urgent lane sends now, and the debounced
        // timer behind it must not fire again and re-POST the same batch.
        armDrive(flushMs: 20000)
        let done = expectation(description: "cleared")
        DispatchQueue.main.async {
            self.plugin.scheduleFlushForTest(type: "fix")
            self.plugin.flushUrgentlyForTest()
            XCTAssertFalse(self.plugin.flushPendingForTest)
            XCTAssertNil(self.plugin.flushDeadlineForTest)
            done.fulfill()
        }
        wait(for: [done], timeout: 30)
    }

    func testRecord_aBreadcrumbStormNeverCrashes() {
        // 127 fixes was the real six-minute drive. Drive the same shape through
        // the real record() path: it must survive, and the buffer must hold
        // them, whatever the host's app state does to the flush lane.
        UserDefaults.standard.removeObject(forKey: plugin.bufferKeyForTest)
        armDrive(flushMs: 20000)
        let base = Double(Date().timeIntervalSince1970 * 1000)
        for i in 0..<127 {
            plugin.recordForTest(["type": "fix", "ts": base + Double(i)])
        }
        let buf = (UserDefaults.standard.array(forKey: plugin.bufferKeyForTest) as? [[String: Any]]) ?? []
        XCTAssertGreaterThanOrEqual(buf.filter { ($0["type"] as? String) == "fix" }.count, 100,
                                    "batching must never cost an event")
    }

    func testEndDriveSampling_putsBreadcrumbsBackOnTheLiveLane() {
        armDrive(flushMs: 20000)
        let off = expectation(description: "coarse")
        plugin.setSampling(makeCall(options: ["mode": "coarse"], onSuccess: { _ in off.fulfill() }))
        wait(for: [off], timeout: 30)
        XCTAssertEqual(plugin.driveFlushDelaySecForTest(),
                       TdGeoPlugin.flushDebounceMsForTest / 1000, accuracy: 0.001)
    }

    // MARK: - thermal state (owner 2026-09-01, "do we surface iOS device temp?")
    //
    // iOS has no temperature API. thermalState is what Apple exposes and it is
    // the number that matters, because it is the one the OS acts on. These
    // guard the two things that can actually break: the word mapping (a raw
    // enum crossing the bridge is an integer nobody can read) and the fact
    // that stats() answers at all on a device in any thermal state.

    func testThermalWord_mapsEveryAppleStateToItsOwnWord() {
        XCTAssertEqual(TdGeoPlugin.thermalWord(.nominal), "nominal")
        XCTAssertEqual(TdGeoPlugin.thermalWord(.fair), "fair")
        XCTAssertEqual(TdGeoPlugin.thermalWord(.serious), "serious")
        XCTAssertEqual(TdGeoPlugin.thermalWord(.critical), "critical")
        // Four distinct words: a mapping that collapsed two states would report
        // a throttling phone as a healthy one and nobody would ever know.
        let all = Set([ProcessInfo.ThermalState.nominal, .fair, .serious, .critical]
                        .map(TdGeoPlugin.thermalWord))
        XCTAssertEqual(all.count, 4)
    }

    func testStats_carriesThermalStateAsAWordJsCanRender() {
        let done = expectation(description: "stats")
        plugin.stats(makeCall(onSuccess: { data in
            let t = data?["thermalState"] as? String
            XCTAssertNotNil(t, "a bare enum across the bridge is an integer nobody can read")
            XCTAssertTrue(["nominal", "fair", "serious", "critical", "unknown"].contains(t ?? ""),
                          "got \(t ?? "nil")")
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testStats_thermalDoesNotDisplaceTheBatteryFields() {
        // Both ride the same call, and a phone that can answer one but not the
        // other has to keep reporting the one it has.
        let done = expectation(description: "stats")
        plugin.stats(makeCall(onSuccess: { data in
            XCTAssertNotNil(data?["thermalState"])
            XCTAssertNotNil(data?["batteryLevel"])
            XCTAssertNotNil(data?["charging"])
            XCTAssertNotNil(data?["gpsOnMs"])
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testStats_repeatedCallsAgreeAndNeverCrash() {
        // Read on every permission report, so it runs far more often than any
        // other stats consumer.
        var seen: [String] = []
        for _ in 0..<5 {
            let done = expectation(description: "stats")
            plugin.stats(makeCall(onSuccess: { data in
                seen.append((data?["thermalState"] as? String) ?? "nil")
                done.fulfill()
            }))
            wait(for: [done], timeout: 30)
        }
        XCTAssertEqual(seen.count, 5)
        XCTAssertFalse(seen.contains("nil"))
    }

    // MARK: - the drive-window accuracy tier (the other half of the battery fix)

    func testSetSampling_carriesTheJsSuppliedAccuracyTier() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "accuracy": "ten"],
                                    onSuccess: { data in
            XCTAssertEqual(data?["accuracy"] as? String, "ten")
            armed.fulfill()
        }))
        wait(for: [armed], timeout: 30)
        XCTAssertEqual(plugin.driveAccuracyNameForTest(), "ten")
    }

    func testAccuracyConstant_mapsTheThreeTiersAndNothingElse() {
        XCTAssertEqual(TdGeoPlugin.accuracyConstant("ten"), kCLLocationAccuracyNearestTenMeters)
        XCTAssertEqual(TdGeoPlugin.accuracyConstant("hundred"), kCLLocationAccuracyHundredMeters)
        XCTAssertEqual(TdGeoPlugin.accuracyConstant("best"), kCLLocationAccuracyBest)
        // A TYPO MUST COST BATTERY, NEVER ROUTE QUALITY. Anything unrecognised
        // falls back to Best, so the worst a bad string can do is spend power.
        XCTAssertEqual(TdGeoPlugin.accuracyConstant("tne"), kCLLocationAccuracyBest)
        XCTAssertEqual(TdGeoPlugin.accuracyConstant(""), kCLLocationAccuracyBest)
        XCTAssertEqual(TdGeoPlugin.accuracyConstant("kCLLocationAccuracyNearestTenMeters"),
                       kCLLocationAccuracyBest)
    }

    func testSetSampling_withNoAccuracyKeepsBest() {
        // A shell running JS that predates the key must behave as it does today.
        armDrive()
        XCTAssertEqual(plugin.driveAccuracyNameForTest(), "best")
    }

    func testSetSampling_accuracyOfWrongTypeFallsBackRatherThanCrashing() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "accuracy": 10],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        XCTAssertEqual(plugin.driveAccuracyNameForTest(), "best")
    }

    func testSamplingState_reportsTheAccuracyTierBackToJs() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "accuracy": "ten"],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        let done = expectation(description: "state")
        plugin.samplingState(makeCall(onSuccess: { data in
            XCTAssertEqual(data?["accuracy"] as? String, "ten")
            done.fulfill()
        }))
        wait(for: [done], timeout: 30)
    }

    func testDriveAccuracy_survivesARelaunchMidDrive() {
        // restoreSamplingWindow used to hardcode Best, which would have handed
        // every resumed drive the high-power receiver the window did not ask
        // for, for the rest of the trip.
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "accuracy": "ten"],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        plugin.restoreSamplingWindowForTest()
        XCTAssertEqual(plugin.driveAccuracyNameForTest(), "ten")
    }

    func testDriveAccuracy_isBestOnceTheWindowCloses() {
        let armed = expectation(description: "arm")
        plugin.setSampling(makeCall(options: ["mode": "drive", "accuracy": "ten"],
                                    onSuccess: { _ in armed.fulfill() }))
        wait(for: [armed], timeout: 30)
        plugin.expireSamplingCapForTest()
        XCTAssertEqual(plugin.driveAccuracyNameForTest(), "best")
    }
}
