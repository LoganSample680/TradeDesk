// Coverage for TdSharePlugin's App Group name (native/td-share/ios/Plugin/TdSharePlugin.swift).
//
// The group used to be the literal "group.app.tradedesk.beta". The App Store
// app has its own bundle id (app.tradedesk), so the group is derived from the
// bundle now. If the app and its share extension ever disagree, shared photos
// land in a folder the app never reads, silently. These pin the derivation.
import XCTest
@testable import TdShare

final class TdSharePluginTests: XCTestCase {

    func testBetaBundleKeepsItsExistingGroup() {
        XCTAssertEqual(TdSharePlugin.group(forAppBundle: "app.tradedesk.beta"), "group.app.tradedesk.beta")
    }

    func testStoreBundleGetsItsOwnGroup() {
        XCTAssertEqual(TdSharePlugin.group(forAppBundle: "app.tradedesk"), "group.app.tradedesk")
    }

    func testMissingOrEmptyBundleFallsBackToBeta() {
        XCTAssertEqual(TdSharePlugin.group(forAppBundle: nil), "group.app.tradedesk.beta")
        XCTAssertEqual(TdSharePlugin.group(forAppBundle: ""), "group.app.tradedesk.beta")
    }

    func testLiveGroupFollowsTheHostApp() {
        // Hosted by App, so Bundle.main is the app this build was made for.
        XCTAssertEqual(TdSharePlugin.appGroup, "group." + (Bundle.main.bundleIdentifier ?? "app.tradedesk.beta"))
    }

    func testConcurrentReadsAgree() {
        let exp = expectation(description: "reads")
        exp.expectedFulfillmentCount = 20
        var seen = Set<String>()
        let lock = NSLock()
        for _ in 0..<20 {
            DispatchQueue.global().async {
                let g = TdSharePlugin.appGroup
                lock.lock(); seen.insert(g); lock.unlock()
                exp.fulfill()
            }
        }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(seen.count, 1)
    }
}
