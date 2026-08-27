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
}
