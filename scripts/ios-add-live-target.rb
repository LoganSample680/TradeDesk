#!/usr/bin/env ruby
# Adds the Live Activity widget extension target to the generated iOS project.
#
# Same reasoning as ios-add-share-target.rb: ios-beta.yml regenerates the Xcode
# project from scratch every build (`npx cap add ios`), so nothing about the
# project is checked in, and a Capacitor plugin can ship a pod but not an app
# EXTENSION. A Live Activity's UI MUST live in a widget extension; ActivityKit
# will not render one from the app target.
#
# Idempotent: re-running finds the existing target and leaves it alone, so a
# workflow retry can never produce two widget extensions in one app.
require 'xcodeproj'
require 'fileutils'

APP_ID   = 'app.tradedesk.beta'
EXT_NAME = 'LiveExt'
EXT_ID   = "#{APP_ID}.live"
# Live Activities are iOS 16.1+. The app itself still targets 15, and the plugin
# reports unsupported below 16.1, so an older phone simply never sees a card.
EXT_MIN_IOS = '16.1'

REPO_ROOT = File.expand_path('..', __dir__)
SRC_DIR   = File.join(REPO_ROOT, 'native/td-live/ios/Extension')
# The attributes type must be compiled into BOTH sides: ActivityKit matches a
# running activity to its widget by this exact type, so the app and the
# extension have to agree on it. One file, two targets, never a second copy to
# drift out of sync.
ATTRS_SRC = File.join(REPO_ROOT, 'native/td-live/ios/Plugin/TdLiveAttributes.swift')

PROJECT_PATH = [
  File.join(REPO_ROOT, 'native/ios/App/App.xcodeproj'),
  File.join(REPO_ROOT, 'ios/App/App.xcodeproj')
].find { |p| File.exist?(p) } or abort('[live] no generated Xcode project found')
IOS_APP_DIR = File.dirname(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' } or abort('[live] no App target')

if project.targets.any? { |t| t.name == EXT_NAME }
  puts "[live] target #{EXT_NAME} already present, nothing to do"
  exit 0
end

dest = File.join(IOS_APP_DIR, EXT_NAME)
FileUtils.mkdir_p(dest)
FileUtils.cp("#{SRC_DIR}/TdLiveWidget.swift", dest)
FileUtils.cp("#{SRC_DIR}/Info.plist", dest)
FileUtils.cp(ATTRS_SRC, dest)

ext_target = project.new_target(:app_extension, EXT_NAME, :ios, EXT_MIN_IOS)

group = project.main_group.new_group(EXT_NAME, EXT_NAME)
ext_target.add_file_references([
  group.new_reference('TdLiveWidget.swift'),
  group.new_reference('TdLiveAttributes.swift')
])
group.new_reference('Info.plist')

# Match the app's marketing version or App Store Connect rejects the upload.
app_marketing = app_target.build_configurations
                          .map { |c| c.build_settings['MARKETING_VERSION'] }
                          .compact.first || '1.0'

ext_target.build_configurations.each do |config|
  s = config.build_settings
  # Without this the product is literally ".appex" and the archive dies with
  # "Multiple commands produce" (learned the expensive way on the share target).
  s['PRODUCT_NAME']               = '$(TARGET_NAME)'
  s['MARKETING_VERSION']          = app_marketing
  s['PRODUCT_BUNDLE_IDENTIFIER']  = EXT_ID
  s['INFOPLIST_FILE']             = "#{EXT_NAME}/Info.plist"
  s['IPHONEOS_DEPLOYMENT_TARGET'] = EXT_MIN_IOS
  s['SWIFT_VERSION']              = '5.0'
  s['TARGETED_DEVICE_FAMILY']     = '1,2'
  s['DEVELOPMENT_TEAM']           = ENV['APPLE_TEAM_ID'] if ENV['APPLE_TEAM_ID']
  s['CODE_SIGN_STYLE']            = 'Automatic'
  s['SKIP_INSTALL']               = 'YES'
  # A widget extension is pure SwiftUI with no pods. Without this it inherits
  # the app's pod search paths and fails to link.
  s['GENERATE_INFOPLIST_FILE']    = 'NO'
end

# SwiftUI and WidgetKit are not linked into a bare target by default.
frameworks = ext_target.frameworks_build_phase
%w[SwiftUI.framework WidgetKit.framework ActivityKit.framework].each do |fw|
  ref = project.frameworks_group.new_reference("System/Library/Frameworks/#{fw}")
  ref.source_tree = 'SDKROOT'
  build_file = frameworks.add_file_reference(ref)
  # ActivityKit only exists on 16.1+, and the app deploys to 15. Weak-linking it
  # lets the extension load on any OS the App Store hands it to.
  build_file.settings = { 'ATTRIBUTES' => ['Weak'] } if fw == 'ActivityKit.framework'
end

# Embed it in the app. PlugIns/ is the only place iOS looks for extensions.
app_target.add_dependency(ext_target)
embed = app_target.new_copy_files_build_phase('Embed Live Activity Extension')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext_target.product_reference)

project.save
puts "[live] added #{EXT_NAME} (#{EXT_ID}) targeting iOS #{EXT_MIN_IOS} and embedded it in App"
