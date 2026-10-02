// @ts-check
// ── The version is stamped by the build, from git, by the old date rules ─────
//
// Owner 2026-10-02: "go fix version number, it should follow the same date
// rules I already have in place". The pre-commit hook used to rewrite the
// version on every commit of every branch, so any two branches clashed on it.
// Now scripts/cf-build.js stamps it into the build (scripts/stamp-version.js)
// and git holds a placeholder that never changes.
//
// What has to stay true, each tested on a throwaway repo with commit times
// chosen to the minute:
//   - MM.DD.YY of the commit's US Central day, NN = that day's commits in it
//   - NN back to 1 at Central midnight, in daylight time and out of it
//   - every new commit is a new version (the watchdog only reloads on change)
//   - a clone too shallow to see midnight is deepened, or says it guessed
//   - a build that cannot find a version line refuses rather than shipping
//     the placeholder, which no phone would ever be moved off
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('./helpers');

const root = path.join(__dirname, '..');
const { computeVersion, stampFiles, PLACEHOLDER } = require('../scripts/stamp-version');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...ENV, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  git(d, ['init', '-q', '-b', 'main']);
  return d;
}
// One commit at an exact instant (ISO, UTC).
function commitAt(d, iso, name = iso) {
  fs.writeFileSync(path.join(d, 'f.txt'), name + '\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', name], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}

test.describe('the build stamps MM.DD.YY.NN from git', () => {
  test('the date is the commit\'s Central day and NN counts that day\'s commits', () => {
    const d = repo();
    commitAt(d, '2026-10-01T20:00:00Z');                 // 1 Oct, 3pm CDT
    commitAt(d, '2026-10-02T14:00:00Z');                 // 2 Oct, 9am
    commitAt(d, '2026-10-02T15:00:00Z');
    commitAt(d, '2026-10-02T16:00:00Z');
    const v = computeVersion(d);
    expect(v.version).toBe('10.02.26.3');
    expect(v.from).toBe('git');
    expect(v.sha).toBe(git(d, ['rev-parse', 'HEAD']));
  });

  test('NN goes back to 1 at Central midnight, not UTC midnight', () => {
    const d = repo();
    commitAt(d, '2026-10-02T23:30:00Z');                 // 6:30pm CDT, still 2 Oct in Central
    commitAt(d, '2026-10-03T04:59:00Z');                 // 11:59pm CDT, 2 Oct
    expect(computeVersion(d).version).toBe('10.02.26.2');
    commitAt(d, '2026-10-03T05:01:00Z');                 // 12:01am CDT, 3 Oct
    expect(computeVersion(d).version).toBe('10.03.26.1');
  });

  test('the same holds in winter, when Central is six hours behind UTC', () => {
    const d = repo();
    commitAt(d, '2026-12-01T05:30:00Z');                 // 11:30pm CST, 30 Nov
    expect(computeVersion(d).version).toBe('11.30.26.1');
    commitAt(d, '2026-12-01T06:30:00Z');                 // 12:30am CST, 1 Dec
    expect(computeVersion(d).version).toBe('12.01.26.1');
  });

  test('every new commit is a new version, and the same commit is always the same one', () => {
    const d = repo();
    const seen = new Set();
    for (let h = 13; h < 20; h++) {
      commitAt(d, `2026-10-02T${h}:00:00Z`);
      const a = computeVersion(d).version, b = computeVersion(d).version;
      expect(a, 'the same commit gives the same version (the preview smoke relies on it)').toBe(b);
      expect(seen.has(a), `${a} was already used by an earlier build`).toBe(false);
      seen.add(a);
    }
  });

  test('commits merged in from a branch count toward the day', () => {
    const d = repo();
    commitAt(d, '2026-10-02T13:00:00Z', 'main 1');
    git(d, ['checkout', '-q', '-b', 'feat']);
    commitAt(d, '2026-10-02T14:00:00Z', 'feat 1');
    commitAt(d, '2026-10-02T15:00:00Z', 'feat 2');
    git(d, ['checkout', '-q', 'main']);
    git(d, ['merge', '-q', '--no-ff', '--no-edit', 'feat'], { GIT_AUTHOR_DATE: '2026-10-02T16:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T16:00:00Z' });
    expect(computeVersion(d).version).toBe('10.02.26.4');
  });

  test('a shallow clone is deepened back to midnight before it counts', () => {
    const src = repo();
    commitAt(src, '2026-10-01T20:00:00Z');
    for (let h = 13; h < 18; h++) commitAt(src, `2026-10-02T${h}:00:00Z`);
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-shallow-'));
    git(d, ['clone', '-q', '--depth=1', `file://${src}`, '.']);
    expect(git(d, ['rev-parse', '--is-shallow-repository'])).toBe('true');
    const v = computeVersion(d);
    expect(v).toMatchObject({ version: '10.02.26.5', from: 'git' });
  });

  test('a clone that cannot see back to midnight says it fell back to the clock', () => {
    const src = repo();
    commitAt(src, '2026-10-02T13:00:00Z');
    commitAt(src, '2026-10-02T19:32:00Z');               // 2:32pm CDT
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-cut-'));
    git(d, ['clone', '-q', '--depth=1', `file://${src}`, '.']);
    git(d, ['remote', 'remove', 'origin']);              // nowhere to deepen from
    const v = computeVersion(d);
    expect(v).toMatchObject({ version: '10.02.26.1432', from: 'clock' });
  });
});

test.describe('writing the stamp into the build', () => {
  function copyApp() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-app-'));
    fs.mkdirSync(path.join(d, 'js'));
    for (const f of ['sw.js', 'version.json', path.join('js', 'cloud.js')]) fs.copyFileSync(path.join(root, f), path.join(d, f));
    return d;
  }

  test('git holds the placeholder in all three places, never a real version', () => {
    expect(JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version).toBe(PLACEHOLDER);
    expect(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')).toContain(`const CACHE = 'tradedesk-${PLACEHOLDER}'`);
    expect(fs.readFileSync(path.join(root, 'js', 'cloud.js'), 'utf8')).toContain(`const APP_VERSION='${PLACEHOLDER}'`);
  });

  test('all three files get the same version, and version.json names the commit', () => {
    const d = copyApp();
    stampFiles(d, { version: '10.02.26.7', sha: 'abc1234def', from: 'git' });
    expect(JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8'))).toEqual({ version: '10.02.26.7', sha: 'abc1234def', from: 'git' });
    expect(fs.readFileSync(path.join(d, 'sw.js'), 'utf8')).toContain("const CACHE = 'tradedesk-10.02.26.7'");
    const cloud = fs.readFileSync(path.join(d, 'js', 'cloud.js'), 'utf8');
    expect(cloud).toContain("const APP_VERSION='10.02.26.7'");
    expect(cloud, 'the placeholder is gone from the build').not.toContain(`APP_VERSION='${PLACEHOLDER}'`);
  });

  test('a file whose version line has gone missing stops the build instead of shipping the placeholder', () => {
    const d = copyApp();
    const sw = path.join(d, 'sw.js');
    fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const CACHE = '[^']+'/, "const CACHE_NAME = 'x'"));
    expect(() => stampFiles(d, { version: '10.02.26.7', sha: 'a', from: 'git' })).toThrow(/sw\.js/);
  });

  test('Cloudflare\'s build script stamps first, even with no Supabase variables set', () => {
    const d = copyApp();
    fs.mkdirSync(path.join(d, 'scripts'));
    for (const f of ['cf-build.js', 'stamp-version.js']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(d, 'scripts', f));
    git(d, ['init', '-q', '-b', 'main']);
    git(d, ['add', '-A']);
    git(d, ['commit', '-q', '-m', 'built'], { GIT_AUTHOR_DATE: '2026-10-02T18:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T18:00:00Z' });
    const env = { ...ENV }; delete env.SUPABASE_URL; delete env.SUPABASE_ANON_KEY;
    const out = execFileSync('node', ['scripts/cf-build.js'], { cwd: d, env, encoding: 'utf8' });
    expect(out).toContain('Version 10.02.26.1');
    expect(JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8')).version).toBe('10.02.26.1');
    expect(fs.readFileSync(path.join(d, 'js', 'cloud.js'), 'utf8')).toContain("const APP_VERSION='10.02.26.1'");
  });

  test('commits no longer bump: the old bump script is gone and the hook only runs it where a branch still has it', () => {
    expect(fs.existsSync(path.join(root, 'scripts', 'bump-version.js'))).toBe(false);
    const hook = fs.readFileSync(path.join(root, 'scripts', 'install-hooks.sh'), 'utf8');
    expect(hook).toContain('[ -f "$ROOT/scripts/bump-version.js" ] && node "$ROOT/scripts/bump-version.js"');
    expect(fs.readFileSync(path.join(root, 'scripts', 'pr-sync.sh'), 'utf8')).not.toMatch(/^node .*bump-version/m);
  });
});
