#!/usr/bin/env ruby
# Adds the TdNativeTests unit-test target to the generated iOS project.
#
# WHY A SCRIPT: same reasoning as every other ios-add-*.rb script, ios-beta.yml
# regenerates the Xcode project from scratch every build (`npx cap add ios`),
# so nothing about the project is checked in. The test SOURCE lives
# permanently in the repo at native/tests/*.swift (one file per plugin); this
# script's only job is wiring those files into a fresh project as a proper
# "tests bundled with an application" unit-test target every run.
#
# This target is deliberately plugin-level XCTest, not XCUITest: it links
# directly against the App binary (TEST_HOST) and calls each TdXxxPlugin
# class's @objc methods directly with a real CAPPluginCall, no WKWebView, no
# simulator UI automation. "Keep native dumb" (CLAUDE.md §3.2) means the
# Swift layer IS the capability surface worth stressing; the app's on-screen
# behavior is already covered by the Playwright flow-test harness.
#
# Idempotent: re-running finds the existing target/scheme and leaves them
# alone, so a workflow retry can never produce two test targets.
require 'xcodeproj'
require 'fileutils'

TEST_TARGET = 'TdNativeTests'

REPO_ROOT = File.expand_path('..', __dir__)
TESTS_SRC_DIR = File.join(REPO_ROOT, 'native/tests')
PROJECT_PATH = [
  File.join(REPO_ROOT, 'native/ios/App/App.xcodeproj'),
  File.join(REPO_ROOT, 'ios/App/App.xcodeproj')
].find { |p| File.exist?(p) } or abort('[native-tests] no generated Xcode project found')
IOS_APP_DIR = File.dirname(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' } or abort('[native-tests] App target not found')

if project.targets.any? { |t| t.name == TEST_TARGET }
  puts "[native-tests] target #{TEST_TARGET} already present, nothing to do"
  exit 0
end

test_files = Dir.glob(File.join(TESTS_SRC_DIR, '*Tests.swift')).sort
if test_files.empty?
  puts '[native-tests] no native/tests/*Tests.swift files found, nothing to add'
  exit 0
end

dest_dir = File.join(IOS_APP_DIR, TEST_TARGET)
FileUtils.mkdir_p(dest_dir)
test_files.each { |f| FileUtils.cp(f, dest_dir) }

test_target = project.new_target(:unit_test_bundle, TEST_TARGET, :ios, ENV['IOS_MIN_TARGET'] || '15.0')

group = project.main_group.new_group(TEST_TARGET, TEST_TARGET)
test_target.add_file_references(test_files.map { |f| group.new_reference(File.basename(f)) })

app_bundle_id = app_target.build_configurations
                          .map { |c| c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] }
                          .compact.first || 'app.tradedesk.beta'

test_target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME']               = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER']  = "#{app_bundle_id}.nativetests"
  s['SWIFT_VERSION']              = '5.0'
  s['TARGETED_DEVICE_FAMILY']     = '1,2'
  s['CODE_SIGN_STYLE']            = 'Automatic'
  s['DEVELOPMENT_TEAM']           = ENV['APPLE_TEAM_ID'] if ENV['APPLE_TEAM_ID']
  # "Tests bundled with an application": runs inside the App process, so it
  # sees every symbol the App target links (Capacitor, every td-* pod), no
  # need to also link/import each plugin's own framework separately.
  s['TEST_HOST']                  = "$(BUILT_PRODUCTS_DIR)/App.app/App"
  s['BUNDLE_LOADER']              = '$(TEST_HOST)'
  s['GENERATE_INFOPLIST_FILE']    = 'YES'
end

test_target.add_dependency(app_target)

# Explicit shared scheme, rather than relying on Xcode's scheme
# autogeneration (which only fires inside Xcode.app itself, never reliable
# from headless `xcodebuild` on a CI runner that has never opened the
# project). add_test_target wires the Test action to this target so
# `xcodebuild test -scheme TdNativeTests` finds it deterministically.
scheme = Xcodeproj::XCScheme.new
scheme.add_test_target(test_target)
scheme.save_as(project.path, TEST_TARGET, true)

project.save
puts "[native-tests] added #{TEST_TARGET} (#{test_files.length} file(s): #{test_files.map { |f| File.basename(f) }.join(', ')})"
