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

  test('every plugin ships a podspec', () => {
    const bad = [];
    pluginDirs().forEach(d => {
      const files = fs.readdirSync(path.join(NATIVE, d));
      if (!files.some(f => f.endsWith('.podspec'))) bad.push(d);
    });
    expect(bad, 'plugins with no podspec: pod install will not build them').toEqual([]);
  });

  test('every podspec is named exactly what Capacitor derives from the folder', () => {
    // CocoaPods refuses a podspec whose s.name does not match the name
    // Capacitor computed, and it refuses it at `pod install`, meaning a
    // fifteen-minute macOS run dies in the first minute. Capacitor's rule is
    // dash-to-PascalCase, so td-bgup becomes TdBgup, NOT TdBgUp: the capital U
    // is only legal if the folder itself is td-bg-up. That one letter cost a
    // build. Check it here, where it costs nothing.
    const expectName = d => d.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
    const bad = [];
    pluginDirs().forEach(d => {
      const want = expectName(d);
      const spec = fs.readdirSync(path.join(NATIVE, d)).find(f => f.endsWith('.podspec'));
      if (!spec) return;                       // covered by the test above
      const declared = (fs.readFileSync(path.join(NATIVE, d, spec), 'utf8')
        .match(/s\.name\s*=\s*'([^']+)'/) || [])[1];
      if (spec !== want + '.podspec' || declared !== want) {
        bad.push(d + ': has ' + spec + ' (s.name=' + declared + '), Capacitor wants ' + want);
      }
    });
    expect(bad, 'podspec names pod install will reject').toEqual([]);
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

  test('the extension target names its product', () => {
    // Without PRODUCT_NAME the product is literally ".appex", so the link step
    // and the wrapper-creation step claim the same output and Xcode aborts
    // with "Multiple commands produce". It archives fine right up until it
    // doesn't, and only on a macOS runner.
    expect(src).toMatch(/s\['PRODUCT_NAME'\]\s*=/);
  });

  test('the extension version is pinned to the app it ships inside', () => {
    // A mismatch here is not a build failure, it is an App Store Connect
    // REJECTION after the fifteen-minute archive has already been paid for.
    const plist = fs.readFileSync(
      path.join(ROOT, 'native/td-share/ios/Extension/Info.plist'), 'utf8');
    expect(plist, 'short version must follow the app, not a literal')
      .toContain('<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>');
    expect(src, 'MARKETING_VERSION must be copied from the App target')
      .toContain("s['MARKETING_VERSION']");

    // And the build number must be stamped on the extension at the same path
    // the script copies its Info.plist to, from the same run number the app
    // uses.
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/ios-beta.yml'), 'utf8');
    expect(wf).toContain('Set :CFBundleVersion ${{ github.run_number }}" ios/App/ShareExt/Info.plist');
    expect(wf).toContain('Set :CFBundleVersion ${{ github.run_number }}" "$PLIST"');
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

test.describe('Share extension accepts a contact card', () => {
  const PLIST = path.join(ROOT, 'native/td-share/ios/Extension/Info.plist');
  const SWIFT = path.join(ROOT, 'native/td-share/ios/Extension/ShareViewController.swift');
  const plist = fs.existsSync(PLIST) ? fs.readFileSync(PLIST, 'utf8') : '';
  const swift = fs.existsSync(SWIFT) ? fs.readFileSync(SWIFT, 'utf8') : '';

  // Pull the activation rule out of the plist without a plist parser: the value
  // is whatever follows the NSExtensionActivationRule key.
  const ruleM = plist.match(/<key>NSExtensionActivationRule<\/key>\s*([\s\S]*?)(?=\n\s*<key>|\n\s*<\/dict>)/);

  test('the rule is a predicate, not the convenience dictionary', () => {
    // Build 47 shipped the dictionary form, and Contacts never offered
    // TradeDesk. NSExtensionActivationSupportsFileWithMaxCount means "anything
    // that is NOT an image, movie, URL, or text"; a vCard conforms to
    // public.text, so it matched no supported class at all. Only a predicate
    // can name public.vcard.
    expect(ruleM, 'no NSExtensionActivationRule in the extension Info.plist').toBeTruthy();
    expect(ruleM[1].trim().startsWith('<string>'),
      'the rule must be a <string> predicate, a <dict> cannot express public.vcard').toBe(true);
    // Scoped to the rule VALUE on purpose: the comment above the key names the
    // old dictionary keys to explain why they are gone, and a whole-file scan
    // would fail on that comment.
    expect(ruleM[1]).not.toContain('NSExtensionActivationSupports');
  });

  test('the predicate names public.vcard', () => {
    expect(ruleM[1]).toContain('public.vcard');
  });

  test('the predicate still accepts the paths that already worked', () => {
    // Photos and file shares activated the extension before this change and
    // must keep doing so: narrowing the rule to fix Contacts would be a
    // regression that only shows up on a device.
    for (const uti of ['public.image', 'com.adobe.pdf', 'public.file-url', 'public.url']) {
      expect(ruleM[1], uti + ' dropped out of the activation rule').toContain(uti);
    }
  });

  test('the predicate does not blanket-accept text or data', () => {
    // Both public.text and public.data are ancestors of public.vcard, so either
    // one would fix Contacts by accident AND put TradeDesk in the share sheet
    // for every text selection in Notes and Safari. Accepting the contact is
    // the goal; becoming share-sheet noise is not.
    expect(ruleM[1]).not.toContain('"public.text"');
    expect(ruleM[1]).not.toContain('"public.data"');
  });

  test('the rule escapes its comparisons so the plist still parses', () => {
    // A raw >= in XML text is a parse error, and a plist that will not parse is
    // an extension iOS refuses to load, discovered on the runner at minute nine.
    expect(ruleM[1]).not.toMatch(/>=(?!;)/);
    expect(ruleM[1]).toContain('&gt;=');
  });

  test('the handler asks for the vCard type before the generic ones', () => {
    // A vCard conforms to public.data, so whichever type is requested FIRST
    // decides what the bytes get called. Ask for .data first and a contact
    // lands as td_share_*.dat, which share-inbox.js cannot recognise.
    const m = swift.match(/let types:\s*\[UTType\]\s*=\s*\[([^\]]+)\]/);
    expect(m, 'could not find the UTType preference list').toBeTruthy();
    const order = m[1].split(',').map(s => s.trim());
    expect(order[0]).toBe('.vCard');
    expect(order.indexOf('.vCard')).toBeLessThan(order.indexOf('.data'));
  });

  test('a vCard arriving as raw bytes is still named .vcf', () => {
    // The app types a shared file by its extension, so an unnamed item has to
    // be given the right one rather than the catch-all .dat the old code used.
    expect(swift).toMatch(/case \.vCard:\s*return "vcf"/);
    expect(swift, 'the raw-bytes branch must use the per-type fallback, not a literal .dat')
      .not.toMatch(/as\? Data \{[\s\S]{0,200}\)\.dat"/);
  });

  test('share-inbox types a .vcf as a contact card', () => {
    // The native half is pointless if the JS half files it as an unknown blob.
    const si = fs.readFileSync(path.join(ROOT, 'js/share-inbox.js'), 'utf8');
    expect(si).toMatch(/vcf[\s\S]{0,80}vcard/i);
  });
});
