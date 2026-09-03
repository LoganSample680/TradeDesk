// Adversarial coverage for TdNotifyPlugin (native/td-notify/ios/Plugin/TdNotifyPlugin.swift).
//
// Local notifications are the user-facing surface of the day-end proposal,
// arrival tap-back, and job reminders. This file stresses every @objc method
// with malformed input, permission edge cases, and rapid-fire scheduling.
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
        let exp = expectation(description: "schedule valid")
        plugin.schedule(makeCall(options: [
            "id": "test-\(UUID().uuidString)",
            "title": "Test",
            "body": "hello"
        ], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

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
        let id = "test-future-\(UUID().uuidString)"
        plugin.schedule(makeCall(options: [
            "id": id,
            "title": "Future",
            "body": "five minutes",
            "atMs": futureMs
        ], onSuccess: { data in
            XCTAssertEqual(data?["scheduled"] as? Bool, true)
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    func testSchedule_sameIdReplacesNotStacks() {
        let id = "test-replace-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000
        let first = expectation(description: "first schedule")
        plugin.schedule(makeCall(options: ["id": id, "title": "V1", "body": "first", "atMs": futureMs], onSuccess: { _ in first.fulfill() }))
        wait(for: [first], timeout: 30)

        let second = expectation(description: "second schedule")
        plugin.schedule(makeCall(options: ["id": id, "title": "V2", "body": "replaced", "atMs": futureMs], onSuccess: { _ in second.fulfill() }))
        wait(for: [second], timeout: 30)

        let check = expectation(description: "pending check")
        plugin.pending(makeCall(onSuccess: { data in
            let ids = data?["ids"] as? [String] ?? []
            let matches = ids.filter { $0 == id }
            XCTAssertLessThanOrEqual(matches.count, 1, "same id must not stack")
            check.fulfill()
        }))
        wait(for: [check], timeout: 30)
    }

    func testSchedule_interruptionLevelIsTimeSensitive() {
        guard #available(iOS 15.0, *) else { return }
        let exp = expectation(description: "schedule ts")
        let id = "test-ts-\(UUID().uuidString)"
        plugin.schedule(makeCall(options: [
            "id": id,
            "title": "Lock screen",
            "body": "should cut through Focus",
            "atMs": (Date().timeIntervalSince1970 + 3600) * 1000
        ], onSuccess: { _ in
            UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
                let req = reqs.first(where: { $0.identifier == id })
                XCTAssertNotNil(req, "notification should still be pending")
                if #available(iOS 15.0, *) {
                    XCTAssertEqual(req?.content.interruptionLevel, .timeSensitive,
                                   "notifications must cut through Focus modes")
                }
                exp.fulfill()
            }
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - schedule: data payload passthrough

    func testSchedule_dataPayloadLandsInUserInfo() {
        let exp = expectation(description: "schedule with data")
        let id = "test-data-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000

        let content = UNMutableNotificationContent()
        content.title = "Data test"
        content.body = "payload"
        content.sound = .default
        if #available(iOS 15.0, *) { content.interruptionLevel = .timeSensitive }
        content.userInfo = ["jobId": 42, "type": "day-end"]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            XCTAssertNil(error)
            UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
                let req = reqs.first(where: { $0.identifier == id })
                XCTAssertNotNil(req, "notification should be pending")
                XCTAssertEqual(req?.content.userInfo["jobId"] as? Int, 42)
                XCTAssertEqual(req?.content.userInfo["type"] as? String, "day-end")
                exp.fulfill()
            }
        }
        wait(for: [exp], timeout: 30)
    }

    // MARK: - cancel

    func testCancel_specificIdsRemovesOnlyThose() {
        let keepId = "test-keep-\(UUID().uuidString)"
        let dropId = "test-drop-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000

        let s1 = expectation(description: "schedule keep")
        plugin.schedule(makeCall(options: ["id": keepId, "title": "Keep", "body": "k", "atMs": futureMs], onSuccess: { _ in s1.fulfill() }))
        let s2 = expectation(description: "schedule drop")
        plugin.schedule(makeCall(options: ["id": dropId, "title": "Drop", "body": "d", "atMs": futureMs], onSuccess: { _ in s2.fulfill() }))
        wait(for: [s1, s2], timeout: 30)

        let c = expectation(description: "cancel drop")
        plugin.cancel(makeCall(options: ["ids": [dropId]], onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)

        let check = expectation(description: "pending after cancel")
        plugin.pending(makeCall(onSuccess: { data in
            let ids = data?["ids"] as? [String] ?? []
            XCTAssertTrue(ids.contains(keepId), "keep should survive")
            XCTAssertFalse(ids.contains(dropId), "drop should be gone")
            check.fulfill()
        }))
        wait(for: [check], timeout: 30)
    }

    func testCancel_noIdsClearsAll() {
        let id = "test-clearall-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000
        let s = expectation(description: "schedule")
        plugin.schedule(makeCall(options: ["id": id, "title": "T", "body": "b", "atMs": futureMs], onSuccess: { _ in s.fulfill() }))
        wait(for: [s], timeout: 30)

        let c = expectation(description: "cancel all")
        plugin.cancel(makeCall(onSuccess: { _ in c.fulfill() }))
        wait(for: [c], timeout: 30)

        let check = expectation(description: "pending empty")
        plugin.pending(makeCall(onSuccess: { data in
            let ids = data?["ids"] as? [String] ?? []
            XCTAssertEqual(ids.count, 0)
            check.fulfill()
        }))
        wait(for: [check], timeout: 30)
    }

    // MARK: - permission

    func testPermission_resolvesWithStatus() {
        let exp = expectation(description: "permission")
        plugin.permission(makeCall(onSuccess: { data in
            let status = data?["status"] as? String ?? ""
            XCTAssertTrue(["granted", "denied", "ask", "unknown"].contains(status),
                          "status should be one of the known values, got: \(status)")
            exp.fulfill()
        }))
        wait(for: [exp], timeout: 30)
    }

    // MARK: - pending

    func testPending_returnsScheduledIds() {
        let id = "test-pending-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000
        let s = expectation(description: "schedule")
        plugin.schedule(makeCall(options: ["id": id, "title": "P", "body": "p", "atMs": futureMs], onSuccess: { _ in s.fulfill() }))
        wait(for: [s], timeout: 30)

        let check = expectation(description: "pending")
        plugin.pending(makeCall(onSuccess: { data in
            let ids = data?["ids"] as? [String] ?? []
            XCTAssertTrue(ids.contains(id))
            check.fulfill()
        }))
        wait(for: [check], timeout: 30)
    }

    // MARK: - rapid-fire concurrent scheduling

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

    // MARK: - defaults when title/body omitted

    func testSchedule_missingTitleDefaultsToTradeDesk() {
        let id = "test-notitle-\(UUID().uuidString)"
        let futureMs = (Date().timeIntervalSince1970 + 3600) * 1000
        let exp = expectation(description: "schedule no title")
        plugin.schedule(makeCall(options: ["id": id, "atMs": futureMs], onSuccess: { _ in
            UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
                let req = reqs.first(where: { $0.identifier == id })
                XCTAssertNotNil(req, "notification should still be pending")
                XCTAssertEqual(req?.content.title, "TradeDesk")
                XCTAssertEqual(req?.content.body, "")
                exp.fulfill()
            }
        }))
        wait(for: [exp], timeout: 30)
    }
}
