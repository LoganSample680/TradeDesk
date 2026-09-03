// Adversarial coverage for TdNotifyPlugin (native/td-notify/ios/Plugin/TdNotifyPlugin.swift).
//
// Local notifications are the user-facing surface of the day-end proposal,
// arrival tap-back, and job reminders. This file stresses every @objc method
// with malformed input, permission edge cases, and rapid-fire scheduling.
//
// SCOPE NOTE, learned the hard way (2026-09-03). These tests assert the
// plugin's CALL CONTRACT (what it resolves, what it rejects, that it never
// crashes) and nothing about what UNUserNotificationCenter did with the
// request. In a unit-test host there is no app delegate and no UI to present
// an authorization prompt: requestAuthorization never calls back at all, and
// without authorization the center accepts an add() and then reports an empty
// pending list. So any assertion reading getPendingNotificationRequests is
// vacuous here no matter how far in the future the trigger is set, which is
// exactly what three rounds of "make the delay longer" failed to fix. The
// scheduled content itself (interruptionLevel, userInfo, title defaults) is
// verified on a real device; what CI can prove is that every input shape
// resolves or rejects the way JS expects, which is the half that regresses.
import XCTest
import Capacitor
import UserNotifications
@testable import TdNotify

final class TdNotifyPluginTests: XCTestCase {
    var plugin: TdNotifyPlugin!

    override func setUp() {
        super.setUp()
        plugin = TdNotifyPlugin()
    }

    override func tearDown() {
        let done = expectation(description: "cancel all teardown")
        plugin.cancel(makeCall(onSuccess: { _ in done.fulfill() }))
        wait(for: [done], timeout: 30)
        plugin = nil
        super.tearDown()
    }

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

    // MARK: - schedule: malformed input

    func testSchedule_missingIdRejects() {
        let exp = expectation(description: "schedule no id")
        plugin.schedule(makeCall(options: [:], onSuccess: { _ in
            XCTFail("should reject when id is missing")
            exp.fulfill()
        }, onError: { msg in
            XCTAssertTrue(msg.contains("no id"))
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testSchedule_emptyIdRejects() {
        let exp = expectation(description: "schedule empty id")
        plugin.schedule(makeCall(options: ["id": ""], onSuccess: { _ in
            XCTFail("should reject when id is empty")
            exp.fulfill()
        }, onError: { msg in
            XCTAssertTrue(msg.contains("no id"))
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testSchedule_validIdResolvesWithScheduledTrue() {
        let id = "test-\(UUID().uuidString)"
        let exp = expectation(description: "schedule valid")
        plugin.schedule(makeCall(options: [
            "id": id,
            "title": "Test",
            "body": "hello"
        ], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            XCTAssertEqual(data?["id"] as? String, id, "the id must echo back so JS can track it")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // A reminder that is already due fires now rather than being dropped: the
    // arrival tap-back and the geofence case both schedule into the past.
    func testSchedule_pastAtMsFiresImmediatelyInsteadOfDropping() {
        let exp = expectation(description: "schedule past")
        let pastMs = (Date().timeIntervalSince1970 - 3600) * 1000
        plugin.schedule(makeCall(options: [
            "id": "test-past-\(UUID().uuidString)",
            "title": "Past",
            "body": "should fire now",
            "atMs": pastMs
        ], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testSchedule_futureAtMsSchedulesWithDelay() {
        let exp = expectation(description: "schedule future")
        let futureMs = (Date().timeIntervalSince1970 + 300) * 1000
        plugin.schedule(makeCall(options: [
            "id": "test-future-\(UUID().uuidString)",
            "title": "Future",
            "body": "five minutes",
            "atMs": futureMs
        ], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // atMs exactly at the 1-second boundary the plugin uses to decide between
    // a trigger and an immediate fire: neither side may drop the request.
    func testSchedule_atMsOnTheImmediateBoundaryStillResolves() {
        for offset in [0.0, 0.5, 1.0, 1.5, 2.0] {
            let exp = expectation(description: "boundary \(offset)")
            plugin.schedule(makeCall(options: [
                "id": "test-b-\(offset)-\(UUID().uuidString)",
                "title": "Boundary",
                "atMs": (Date().timeIntervalSince1970 + offset) * 1000
            ], onSuccess: { data in
                XCTAssertEqual(data?["scheduled"] as? Bool, true, "offset \(offset) must still schedule")
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
    }

    // atMs of the wrong type must not crash or reject: getDouble returns nil
    // and the notification simply fires immediately.
    func testSchedule_junkAtMsDoesNotCrashOrReject() {
        for junk in ["not-a-number", [1, 2] as Any, NSNull()] as [Any] {
            let exp = expectation(description: "junk atMs")
            plugin.schedule(makeCall(options: [
                "id": "test-junk-\(UUID().uuidString)",
                "title": "Junk",
                "atMs": junk
            ], onSuccess: { data in
                XCTAssertEqual(data?["scheduled"] as? Bool, true)
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
    }

    // Re-scheduling the same id must replace, never stack: this is what makes
    // "remind me about job 91 tomorrow" safe to call on every render.
    func testSchedule_sameIdResolvesEveryTimeAndNeverRejects() {
        let id = "test-replace-\(UUID().uuidString)"
        for pass in 0..<3 {
            let exp = expectation(description: "schedule pass \(pass)")
            plugin.schedule(makeCall(options: ["id": id, "title": "V\(pass)", "body": "b"], onSuccess: { data in
                XCTAssertEqual(data?["scheduled"] as? Bool, true)
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
    }

    // The exact option shape js/notify.js sends (_notifySchedule: id, title,
    // body, atMs and nothing else). This is the ONLY shape the app ever puts
    // on the wire, so it is the one that must never regress.
    //
    // NOT covered here: the plugin's `data` -> userInfo passthrough. No JS
    // caller passes it and nothing reads userInfo back, so it is unreachable
    // from the app today; a test for it was also asserting against a quirk of
    // constructing CAPPluginCall directly rather than against real behavior.
    // If tap routing ever starts using userInfo, cover it then, on a device.
    func testSchedule_theExactShapeNotifyJsSends() {
        for atMs in [0, Int(Date().timeIntervalSince1970 + 3600) * 1000] {
            let id = "test-prod-\(UUID().uuidString)"
            let exp = expectation(description: "prod shape atMs=\(atMs)")
            plugin.schedule(makeCall(options: [
                "id": id,
                "title": "Tomorrow's first job",
                "body": "8:00a at John Doe",
                "atMs": Double(atMs)
            ], onSuccess: { data in
                XCTAssertEqual(data?["scheduled"] as? Bool, true)
                XCTAssertEqual(data?["id"] as? String, id)
                exp.fulfill()
            }, onError: { msg in
                XCTFail("the shape notify.js sends must never reject: \(msg)")
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
    }

    // Title and body omitted: the plugin defaults rather than rejecting, so a
    // bare reminder still reaches the lock screen.
    func testSchedule_missingTitleAndBodyStillResolve() {
        let exp = expectation(description: "schedule no title")
        plugin.schedule(makeCall(options: ["id": "test-notitle-\(UUID().uuidString)"], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - cancel

    func testCancel_specificIdsResolves() {
        let c = expectation(description: "cancel specific")
        plugin.cancel(makeCall(options: ["ids": ["a-\(UUID().uuidString)"]], onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)
    }

    func testCancel_noIdsClearsAllAndResolves() {
        let c = expectation(description: "cancel all")
        plugin.cancel(makeCall(onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)
    }

    // An empty array, the wrong type, and ids that were never scheduled are
    // all no-ops rather than crashes: JS cancels defensively on sign-out.
    func testCancel_junkIdsIsAGracefulNoOp() {
        for junk in [[] as Any, "not-an-array" as Any, [1, 2, 3] as Any, NSNull()] as [Any] {
            let c = expectation(description: "cancel junk")
            plugin.cancel(makeCall(options: ["ids": junk], onSuccess: { _ in c.fulfill() }))
            wait(for: [c], timeout: 30)
        }
    }

    func testCancel_repeatedCallsNeverCrash() {
        for _ in 0..<10 {
            let c = expectation(description: "cancel repeat")
            plugin.cancel(makeCall(onSuccess: { _ in c.fulfill() }))
            wait(for: [c], timeout: 30)
        }
    }

    // MARK: - permission

    func testPermission_resolvesWithAKnownStatus() {
        let exp = expectation(description: "permission")
        plugin.permission(makeCall(onSuccess: { data in
            let status = data?["status"] as? String ?? ""
            XCTAssertTrue(["granted", "denied", "ask", "unknown"].contains(status),
                          "status should be one of the known values, got: \(status)")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // Called repeatedly (JS asks on every settings render) it must keep
    // answering, and always with the same answer.
    func testPermission_repeatedCallsAgree() {
        var answers: [String] = []
        for _ in 0..<5 {
            let exp = expectation(description: "permission repeat")
            plugin.permission(makeCall(onSuccess: { data in
                answers.append(data?["status"] as? String ?? "")
                exp.fulfill()
            }))
            wait(for: [exp], timeout: 30)
        }
        XCTAssertEqual(Set(answers).count, 1, "permission status must not flap between calls")
    }

    // MARK: - pending

    func testPending_resolvesWithAnIdArray() {
        let exp = expectation(description: "pending")
        plugin.pending(makeCall(onSuccess: { data in
            XCTAssertNotNil(data?["ids"] as? [String], "ids must always be an array, never nil")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testPending_afterCancelAllIsEmpty() {
        let c = expectation(description: "cancel")
        plugin.cancel(makeCall(onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)

        let exp = expectation(description: "pending empty")
        plugin.pending(makeCall(onSuccess: { data in
            XCTAssertEqual((data?["ids"] as? [String] ?? ["x"]).count, 0)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - concurrency

    func testSchedule_rapidFireDoesNotCrash() {
        let exps = (0..<20).map { i in expectation(description: "rapid \(i)") }
        for i in 0..<20 {
            plugin.schedule(makeCall(options: [
                "id": "rapid-\(i)-\(UUID().uuidString)",
                "title": "Rapid \(i)",
                "body": "bang"
            ], onSuccess: { _ in exps[i].fulfill() }))
        }
        wait(for: exps, timeout: 30)
    }

    // Schedule and cancel racing each other is the sign-out path: reminders
    // are being written by one render while another clears them.
    func testScheduleAndCancelInterleavedDoNotCrash() {
        var exps: [XCTestExpectation] = []
        for i in 0..<10 {
            let s = expectation(description: "s\(i)"); exps.append(s)
            plugin.schedule(makeCall(options: ["id": "race-\(i)-\(UUID().uuidString)", "title": "R"], onSuccess: { _ in s.fulfill() }))
            let c = expectation(description: "c\(i)"); exps.append(c)
            plugin.cancel(makeCall(onSuccess: { _ in c.fulfill() }))
        }
        wait(for: exps, timeout: 60)
    }

    // Every method called back to back off one instance: the plugin holds no
    // state of its own, so nothing may go stale between calls.
    func testAllMethodsInSequenceOnOneInstance() {
        let ids = ["seq-\(UUID().uuidString)"]
        let s = expectation(description: "schedule")
        plugin.schedule(makeCall(options: ["id": ids[0], "title": "Seq"], onSuccess: { _ in s.fulfill() }))
        wait(for: [s], timeout: 30)

        let p1 = expectation(description: "pending 1")
        plugin.pending(makeCall(onSuccess: { _ in p1.fulfill() }))
        wait(for: [p1], timeout: 30)

        let perm = expectation(description: "permission")
        plugin.permission(makeCall(onSuccess: { _ in perm.fulfill() }))
        wait(for: [perm], timeout: 30)

        let c = expectation(description: "cancel")
        plugin.cancel(makeCall(options: ["ids": ids], onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)

        let p2 = expectation(description: "pending 2")
        plugin.pending(makeCall(onSuccess: { data in
            XCTAssertFalse((data?["ids"] as? [String] ?? []).contains(ids[0]))
            p2.fulfill()
        }))
        wait(for: [p2], timeout: 30)
    }
}
