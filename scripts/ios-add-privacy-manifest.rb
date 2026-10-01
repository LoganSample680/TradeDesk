# Adds native/PrivacyInfo.xcprivacy to the generated App target as a bundle
# resource. App Store uploads are checked for it; the project is regenerated
# every build (ios-beta.yml), so this runs every build too. Idempotent.
require 'xcodeproj'
require 'fileutils'

FILE_NAME = 'PrivacyInfo.xcprivacy'

REPO_ROOT = File.expand_path('..', __dir__)
SRC = File.join(REPO_ROOT, 'native', FILE_NAME)
PROJECT_PATH = [
  File.join(REPO_ROOT, 'native/ios/App/App.xcodeproj'),
  File.join(REPO_ROOT, 'ios/App/App.xcodeproj')
].find { |p| File.exist?(p) } or abort('[privacy] no generated Xcode project found')
IOS_APP_DIR = File.dirname(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' } or abort('[privacy] App target not found')

if app_target.resources_build_phase.files.any? { |f| f.file_ref && f.file_ref.path == FILE_NAME }
  puts "[privacy] #{FILE_NAME} already in the App target, skipping"
  exit 0
end

FileUtils.cp(SRC, File.join(IOS_APP_DIR, 'App', FILE_NAME))
file_ref = project.main_group.find_subpath('App', true).new_reference(FILE_NAME)
app_target.add_resources([file_ref])
project.save
puts "[privacy] added #{FILE_NAME} to the App target"
