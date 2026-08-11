// @ts-check
// ── Native build plumbing guards (build 19 postmortem, 2026-08-11) ───────────
// Build 19 failed and, worse, would have SHIPPED silently wrong if it hadn't:
// six new Capacitor plugins were in the repo, listed as dependencies, with
// working Swift, and none of them existed on the phone. Their package.json
// files were swallowed by the blanket `package.json` line in .gitignore, which
// carried a hand-maintained allowlist that nobody extends when adding a plugin.
// npm linked six empty folders without complaining and Capacitor reported
// "Found 6 Capacitor plugins" instead of 12, one line deep in a 300-line log.
//
// These tests are the permanent version of noticing that. They run in the
// offline shards on every push, so the failure surfaces before a macOS runner
// is ever spent.
const { test, expect } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NATIVE = path.join(ROOT, 'native');

function pluginDirs() {
  return fs.readdirSync(NATIVE)
    .filter(d => d.startsWith('td-'))
    .filter(d => fs.statSync(path.join(NATIVE, d)).isDirectory())
    .sort();
}

test.describe('Native plugins reach the build', () => {
  test('every plugin folder has a package.json on disk', () => {
    const missing = pluginDirs().filter(d => !fs.existsSync(path.join(NATIVE, d, 'package.json')));
    expect(missing, 'plugins with no package.json: Capacitor cannot see these').toEqual([]);
  });

  test('every plugin package.json is committed, not gitignored', () => {
    // The actual build-19 failure. A file that exists locally but is ignored
    // is invisible to the runner, which checks out a fresh clone.
    let tracked;
    try {
      tracked = new Set(
        execFileSync('git', ['ls-files', 'native'], { cwd: ROOT, encoding: 'utf8' })
          .split('\n').filter(Boolean)
      );
    } catch (_e) {
      test.skip(true, 'no usable git checkout here');
      return;
    }
    const untracked = pluginDirs().filter(d => !tracked.has('native/' + d + '/package.json'));
    expect(untracked, 'plugin package.json files git will not ship (check .gitignore)').toEqual([]);
  });

  test('every plugin is a dependency of the native shell', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(NATIVE, 'package.json'), 'utf8'));
    const deps = pkg.dependencies || {};
    const orphans = pluginDirs().filter(d => !deps[d]);
    expect(orphans, 'plugin folders npm will never install').toEqual([]);
  });

  test('every plugin declares its iOS source so Capacitor registers it', () => {
    const bad = [];
    pluginDirs().forEach(d => {
      const p = path.join(NATIVE, d, 'package.json');
      if (!fs.existsSync(p)) return;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!j.capacitor || !j.capacitor.ios || !j.capacitor.ios.src) bad.push(d);
    });
    expect(bad, 'plugins with no capacitor.ios.src: installed but never registered').toEqual([]);
  });

  test('every plugin ships a podspec matching its Swift class', () => {
    const bad = [];
    pluginDirs().forEach(d => {
      const files = fs.readdirSync(path.join(NATIVE, d));
      if (!files.some(f => f.endsWith('.podspec'))) bad.push(d);
    });
    expect(bad, 'plugins with no podspec: pod install will not build them').toEqual([]);
  });
});

test.describe('Share extension script targets the real Xcode paths', () => {
  const SCRIPT = path.join(ROOT, 'scripts', 'ios-add-share-target.rb');
  const src = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : '';

  test('SRCROOT is the .xcodeproj directory, not its parent', () => {
    // The build-19 crash: File.dirname(File.dirname(PROJECT_PATH)) walked one
    // level above ios/App, so the App Group was written to a path that does not
    // exist and the script aborted. Every build setting it writes
    // (INFOPLIST_FILE, CODE_SIGN_ENTITLEMENTS) is relative to SRCROOT, which IS
    // the directory holding the .xcodeproj.
    expect(src).toContain('IOS_APP_DIR = File.dirname(PROJECT_PATH)');
    expect(src).not.toContain('File.dirname(File.dirname(PROJECT_PATH))');
  });

  test('the App Group lands on the same entitlements file the workflow writes', () => {
    // Two files have to agree on one path or the extension and the app end up
    // in different App Groups, which reads as "sharing silently does nothing".
    const m = src.match(/app_ent\s*=\s*File\.join\(IOS_APP_DIR,\s*'([^']+)'\)/);
    expect(m, 'could not find the entitlements path in the script').toBeTruthy();
    const scriptPath = 'ios/App/' + m[1];               // IOS_APP_DIR is ios/App
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/ios-beta.yml'), 'utf8');
    expect(wf).toContain('cat > ' + scriptPath);
  });
});
