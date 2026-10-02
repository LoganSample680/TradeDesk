// Coverage for TdBgUpPlugin's background session id (native/td-bg-up/ios/Plugin/TdBgUpPlugin.swift).
//
// It used to be the literal "app.tradedesk.beta.bgup". Two apps on one phone
// (TestFlight beta and the App Store app) must never share a background
// URLSession id, so it follows the bundle now.
import XCTest
@testable import TdBgUp

final class TdBgUpPluginTests: XCTestCase {

    func testSessionIdFollowsTheHostApp() {
        XCTAssertEqual(TdBgUpPlugin.sessionIdentifier, (Bundle.main.bundleIdentifier ?? "app.tradedesk.beta") + ".bgup")
    }

    func testSessionIdIsStableAcrossReads() {
        XCTAssertEqual(TdBgUpPlugin.sessionIdentifier, TdBgUpPlugin.sessionIdentifier)
        XCTAssertTrue(TdBgUpPlugin.sessionIdentifier.hasSuffix(".bgup"))
        XCTAssertFalse(TdBgUpPlugin.sessionIdentifier.hasPrefix(".bgup"))
    }
}
