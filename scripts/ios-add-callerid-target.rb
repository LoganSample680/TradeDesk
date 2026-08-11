#!/usr/bin/env ruby
# Adds the Caller ID app-extension target to the generated iOS project.
#
# WHY A SCRIPT: ios-beta.yml regenerates the Xcode project from scratch on
# every build (`npx cap add ios`), so nothing about the project is checked in.
# A Capacitor plugin can ship a pod, but an app EXTENSION needs its own target,
# its own bundle id, its own entitlements, and an embed phase in the app, none
# of which a pod can express. So the target is (re)built here each run.
#
# The xcodeproj gem is already on the runner: CocoaPods depends on it, and
# `npx cap sync ios` runs pod install.
#
# Idempotent: re-running finds the existing target and leaves it alone, so a
# workflow retry can never produce two extensions in one app.
require 'xcodeproj'
require 'fileutils'

APP_ID    = 'app.tradedesk.beta'
EXT_NAME  = 'CallerId'
EXT_ID    = "#{APP_ID}.#{EXT_NAME}"
APP_GROUP = "group.#{APP_ID}"

# Anchored to THIS FILE, not the working directory: ios-beta.yml runs every
# step from native/, while a human debugging runs from the repo root. Both
# must work or the failure is a confusing "no App target" instead of a clear
# path problem.
REPO_ROOT = File.expand_path('..', __dir__)
SRC_DIR   = File.join(REPO_ROOT, 'native/td-callerid/ios/Extension')
PROJECT_PATH = [
  File.join(REPO_ROOT, 'native/ios/App/App.xcodeproj'),
  File.join(REPO_ROOT, 'ios/App/App.xcodeproj')
].find { |p| File.exist?(p) } or abort('[callerid] no generated Xcode project found')
IOS_APP_DIR = File.dirname(File.dirname(PROJECT_PATH)) # .../ios/App

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' } or abort('no App target')

if project.targets.any? { |t| t.name == EXT_NAME }
  puts "[callerid] target #{EXT_NAME} already present, nothing to do"
  exit 0
end

# Copy the extension sources INTO the project tree. Referencing them across
# the repo works locally but leaves absolute paths in the project, which the
# archive step does not survive.
dest = File.join(IOS_APP_DIR, EXT_NAME)
FileUtils.mkdir_p(dest)
FileUtils.cp("#{SRC_DIR}/CallDirectoryHandler.swift", dest)
FileUtils.cp("#{SRC_DIR}/Info.plist", dest)
FileUtils.cp("#{SRC_DIR}/CallerId.entitlements", dest)

ext_target = project.new_target(:app_extension, EXT_NAME, :ios, '15.0')

group = project.main_group.new_group(EXT_NAME, EXT_NAME)
ext_target.add_file_references([group.new_reference('CallDirectoryHandler.swift')])
group.new_reference('Info.plist')
group.new_reference('CallerId.entitlements')

ext_target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER']       = EXT_ID
  s['INFOPLIST_FILE']                  = "#{EXT_NAME}/Info.plist"
  s['CODE_SIGN_ENTITLEMENTS']          = "#{EXT_NAME}/CallerId.entitlements"
  s['IPHONEOS_DEPLOYMENT_TARGET']      = '15.0'
  s['SWIFT_VERSION']                   = '5.0'
  s['TARGETED_DEVICE_FAMILY']          = '1,2'
  s['DEVELOPMENT_TEAM']                = ENV['APPLE_TEAM_ID'] if ENV['APPLE_TEAM_ID']
  s['CODE_SIGN_STYLE']                 = 'Automatic'
  # The extension is a plain Swift bundle with no pods; without this it
  # inherits the app's pod search paths and fails to link.
  s['SKIP_INSTALL']                    = 'YES'
end

# Embed the built extension in the app. dstSubfolderSpec 13 is PlugIns/,
# the only place iOS looks for app extensions.
app_target.add_dependency(ext_target)
embed = app_target.new_copy_files_build_phase('Embed App Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext_target.product_reference)

# The App Group has to exist on BOTH sides or the shared file is invisible to
# one of them, which reads as "caller ID silently does nothing".
app_ent = File.join(IOS_APP_DIR, 'App/App.entitlements')
if File.exist?(app_ent)
  plist = Xcodeproj::Plist.read_from_path(app_ent)
  groups = plist['com.apple.security.application-groups'] || []
  plist['com.apple.security.application-groups'] = (groups + [APP_GROUP]).uniq
  Xcodeproj::Plist.write_to_path(plist, app_ent)
  puts "[callerid] app group added to #{app_ent}"
else
  abort("[callerid] #{app_ent} missing: the entitlements step must run first")
end

project.save
puts "[callerid] added #{EXT_NAME} (#{EXT_ID}) and embedded it in App"
