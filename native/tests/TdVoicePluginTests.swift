// Adversarial coverage for TdVoicePlugin (native/td-voice/ios/Plugin/TdVoicePlugin.swift).
//
// What changed and is pinned here (2026-09-27, the "Earl" audit: a slow talker
// dictating a fifteen minute job lost words at every restart):
//
//  1. THE CANCEL RACE. A replaced recognition task still calls back after it is
//     cancelled, and that callback used to run stopEngine on the NEW session.
//     Every callback now carries its generation and only the current one is
//     heard. TdVoiceSessions is that rule, pure, so it is stressed directly.
//  2. PUNCTUATION. addsPunctuation on iOS 16 and later, so the words arrive as
//     sentences and js/tim-knowledge.js can split them into lines.
//  3. THE "ended" EVENT. Sent once when the current task really ends, carrying
//     the words and the generation. The plugin never restarts itself: that is
//     a JS decision (CLAUDE.md 3.2).
//
// SCOPE NOTE, same as TdNotifyPluginTests: a unit-test host has no UI to
// present a permission prompt, so nothing here calls request() and nothing
// asserts real recognition. What CI can prove is the call contract (resolve or
// reject, never crash) and the generation rule, which is the half that broke.
import XCTest
import Capacitor
import Speech
@testable import TdVoice

final class TdVoicePluginTests: XCTestCase {
    var plugin: TdVoicePlugin!

    override func setUp() {
        super.setUp()
        plugin = TdVoicePlugin()
    }

    override func tearDown() {
        plugin = nil
        super.tearDown()
    }

    // See TdGeoPluginTests.swift for why the 30s timeout: generous headroom
    // for a stalled shared CI simulator, paid for only on a genuine hang.
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

    // MARK: - TdVoiceSessions: golden path

    func testSessions_beginNumbersEachSessionAndOnlyTheLastIsCurrent() {
        let s = TdVoiceSessions()
        let a = s.begin()
        XCTAssertTrue(s.isCurrent(a))
        let b = s.begin()
        XCTAssertNotEqual(a, b)
        XCTAssertFalse(s.isCurrent(a), "the replaced session must never be heard again")
        XCTAssertTrue(s.isCurrent(b))
    }

    func testSessions_endIsClaimedExactlyOncePerSession() {
        let s = TdVoiceSessions()
        let g = s.begin()
        XCTAssertTrue(s.claimEnd(g))
        XCTAssertFalse(s.claimEnd(g), "a final followed by the cancel error must not say ended twice")
    }

    // MARK: - the cancel race itself

    func testSessions_staleCallbackAfterRestartCannotEndTheNewSession() {
        let s = TdVoiceSessions()
        let old = s.begin()
        let new = s.begin()             // JS restarted: the old task is cancelled
        XCTAssertFalse(s.isCurrent(old))
        XCTAssertFalse(s.claimEnd(old), "the old task's cancel error must not report ended")
        XCTAssertTrue(s.isCurrent(new), "the new session is untouched by the old callback")
        XCTAssertTrue(s.claimEnd(new))
    }

    func testSessions_invalidateAfterStopDropsLateCallbacks() {
        let s = TdVoiceSessions()
        let g = s.begin()
        s.invalidate()
        XCTAssertFalse(s.isCurrent(g))
        XCTAssertFalse(s.claimEnd(g))
    }

    // MARK: - boundary

    func testSessions_nothingIsCurrentBeforeTheFirstStart() {
        let s = TdVoiceSessions()
        XCTAssertFalse(s.isCurrent(0), "generation zero is 'never started', not a session")
        XCTAssertFalse(s.claimEnd(0))
        XCTAssertFalse(s.isCurrent(-1))
        XCTAssertFalse(s.claimEnd(Int.max))
    }

    func testSessions_aFutureGenerationIsNotCurrent() {
        let s = TdVoiceSessions()
        let g = s.begin()
        XCTAssertFalse(s.isCurrent(g + 1))
        XCTAssertFalse(s.claimEnd(g + 1))
    }

    // MARK: - concurrent calls (the same guard-variable race as CLAUDE.md 11.2)

    func testSessions_rapidRestartsLeaveExactlyOneLiveSession() {
        let s = TdVoiceSessions()
        var gens: [Int] = []
        for _ in 0..<500 { gens.append(s.begin()) }
        XCTAssertEqual(Set(gens).count, 500, "every start gets its own number")
        XCTAssertEqual(gens.filter { s.isCurrent($0) }.count, 1)
        XCTAssertEqual(gens.filter { s.claimEnd($0) }.count, 1, "only the live one can end")
    }

    // MARK: - punctuation and request settings

    func testMakeRequest_partialsOnAndPunctuationOnWhereAvailable() {
        let req = TdVoicePlugin.makeRequest(onDevice: false)
        XCTAssertTrue(req.shouldReportPartialResults)
        XCTAssertFalse(req.requiresOnDeviceRecognition)
        if #available(iOS 16, *) {
            XCTAssertTrue(req.addsPunctuation, "without punctuation a long monologue is one line")
        }
    }

    func testMakeRequest_onDeviceWhenTheRecogniserCan() {
        XCTAssertTrue(TdVoicePlugin.makeRequest(onDevice: true).requiresOnDeviceRecognition)
    }

    // MARK: - the ended payload

    func testEndedPayload_carriesTextGenerationAndReason() {
        let p = TdVoicePlugin.endedPayload(text: "Pull the old heater.", gen: 7, reason: "final")
        XCTAssertEqual(p["text"] as? String, "Pull the old heater.")
        XCTAssertEqual(p["gen"] as? Int, 7)
        XCTAssertEqual(p["reason"] as? String, "final")
    }

    func testEndedPayload_emptyTextIsStillAPayload() {
        let p = TdVoicePlugin.endedPayload(text: "", gen: 1, reason: "error")
        XCTAssertEqual(p["text"] as? String, "", "an error with no words still ends the session")
        XCTAssertEqual(p["reason"] as? String, "error")
    }

    // MARK: - available: capability flag, extraneous options ignored

    func testAvailable_reportsTheEndedEvent() {
        let exp = expectation(description: "available")
        plugin.available(makeCall(method: "available", options: ["junk": 42, "events": "nope"], onSuccess: { data in
            let events = data?["events"] as? [String] ?? []
            XCTAssertTrue(events.contains("ended"), "js/voice.js reads this to stop restarting on silence")
            XCTAssertNotNil(data?["status"] as? String)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - permission denied / not yet asked

    func testStart_withoutSpeechAuthorizationRejectsNeverCrashes() throws {
        if SFSpeechRecognizer.authorizationStatus() == .authorized {
            throw XCTSkip("this simulator already has speech authorised")
        }
        let exp = expectation(description: "start rejects")
        plugin.start(makeCall(method: "start", onSuccess: { _ in
            XCTFail("start must not resolve without speech authorisation")
            exp.fulfill()
        }, onError: { msg in
            XCTAssertTrue(msg.contains("not authorized"))
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
        XCTAssertEqual(plugin.sessions.current, 0, "a rejected start opens no session")
    }

    // MARK: - post-error / interrupted state: stop with nothing running

    func testStop_withNothingRunningResolvesEmptyText() {
        let exp = expectation(description: "stop")
        plugin.stop(makeCall(method: "stop", onSuccess: { data in
            XCTAssertEqual(data?["text"] as? String, "")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testStop_rapidRepeatedCallsAllResolve() {
        var exps: [XCTestExpectation] = []
        for i in 0..<5 {
            let e = expectation(description: "stop \(i)")
            exps.append(e)
            plugin.stop(makeCall(method: "stop", onSuccess: { _ in e.fulfill() }))
        }
        wait(for: exps, timeout: 30)
    }

    func testStop_invalidatesSoALateCallbackCannotSpeak() {
        let g = plugin.sessions.begin()
        let exp = expectation(description: "stop")
        plugin.stop(makeCall(method: "stop", onSuccess: { _ in exp.fulfill() }))
        wait(for: [exp], timeout: 30)
        XCTAssertFalse(plugin.sessions.isCurrent(g))
        XCTAssertFalse(plugin.sessions.claimEnd(g))
    }
}
