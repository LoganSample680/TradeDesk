#!/usr/bin/env ruby
# Adds the Siri / Shortcuts App Intents source file to the App target itself.
#
# WHY A SCRIPT: ios-beta.yml regenerates the Xcode project from scratch every
# build (`npx cap add ios`), so nothing about the project is checked in. Unlike
# the share/Live-Activity extensions (their own targets, their own scripts),
# App Intents are only discovered by Siri/Shortcuts/Spotlight when declared IN
# the host app target, so this adds a file reference to the EXISTING 'App'
# target rather than creating a new one.
#
# Idempotent: re-running finds the existing file reference and leaves it
# alone, so a workflow retry can never add it twice.
require 'xcodeproj'
require 'fileutils'

FILE_NAME = 'TdAppIntents.swift'

REPO_ROOT = File.expand_path('..', __dir__)
SRC = File.join(REPO_ROOT, 'native/td-intents/ios/AppIntents', FILE_NAME)
PROJECT_PATH = [
  File.join(REPO_ROOT, 'native/ios/App/App.xcodeproj'),
  File.join(REPO_ROOT, 'ios/App/App.xcodeproj')
].find { |p| File.exist?(p) } or abort('[app-intents] no generated Xcode project found')
IOS_APP_DIR = File.dirname(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' } or abort('[app-intents] App target not found')

if app_target.source_build_phase.files.any? { |f| f.file_ref && f.file_ref.path == FILE_NAME }
  puts "[app-intents] #{FILE_NAME} already in the App target, skipping"
  exit 0
end

dest = File.join(IOS_APP_DIR, 'App', FILE_NAME)
FileUtils.cp(SRC, dest)

app_group = project.main_group.find_subpath('App', true)
file_ref = app_group.new_reference(FILE_NAME)
app_target.add_file_references([file_ref])

project.save
puts "[app-intents] #{FILE_NAME} added to the App target"
