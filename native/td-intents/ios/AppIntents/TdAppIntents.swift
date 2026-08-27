import AppIntents

// TradeDesk's Siri / Shortcuts / Spotlight quick actions (owner ask
// 2026-08-17). This file is injected into the App TARGET (not this plugin's
// own pod) by scripts/ios-add-app-intents.rb, run fresh every build the same
// way the Live Activity widget and share extension get added to the
// regenerated Xcode project: App Intents are only discovered by Siri/
// Shortcuts/Spotlight when declared in the host app, never in a framework or
// plugin pod.
//
// Deliberately thin (CLAUDE.md 3.2): every intent just stashes a route string
// in UserDefaults.standard and brings the app to the foreground. TdIntents.
// drain() (the plugin half, native/td-intents/ios/Plugin) hands that route to
// JS once on boot, and js/push.js's _pushRoute is the SAME dispatcher a push
// notification tap already uses (§7.3, one router, not two). No data entry
// happens natively: it lands the contractor on the right screen fast, the
// same discipline that keeps every decision, threshold, and behavior in JS.
//
// "td_pending_intent_route" MUST match the key TdIntentsPlugin.swift reads:
// two separate compilation units, no shared Swift constant to enforce it.

@available(iOS 16.0, *)
private func tdStashIntentRoute(_ route: String) {
    UserDefaults.standard.set(route, forKey: "td_pending_intent_route")
}

@available(iOS 16.0, *)
struct TdClockInIntent: AppIntent {
    static var title: LocalizedStringResource = "Clock In"
    static var description = IntentDescription("Open today's jobs to clock in.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        tdStashIntentRoute("clockin")
        return .result()
    }
}

@available(iOS 16.0, *)
struct TdLogExpenseIntent: AppIntent {
    static var title: LocalizedStringResource = "Log an Expense"
    static var description = IntentDescription("Open TradeDesk's expense scanner.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        tdStashIntentRoute("expense")
        return .result()
    }
}

@available(iOS 16.0, *)
struct TdAddLeadIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a Lead"
    static var description = IntentDescription("Open TradeDesk's new lead form.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        tdStashIntentRoute("lead")
        return .result()
    }
}

@available(iOS 16.0, *)
struct TdAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TdClockInIntent(),
            phrases: ["Clock in to \(.applicationName)", "\(.applicationName) clock in"],
            shortTitle: "Clock In",
            systemImageName: "clock.badge.checkmark"
        )
        AppShortcut(
            intent: TdLogExpenseIntent(),
            phrases: ["Log an expense in \(.applicationName)", "\(.applicationName) log expense"],
            shortTitle: "Log Expense",
            systemImageName: "receipt"
        )
        AppShortcut(
            intent: TdAddLeadIntent(),
            phrases: ["Add a lead in \(.applicationName)", "\(.applicationName) new lead"],
            shortTitle: "Add Lead",
            systemImageName: "person.badge.plus"
        )
    }
}
