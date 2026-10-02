#!/usr/bin/env node
'use strict';
// ── THE VERSION IS STAMPED WHEN CLOUDFLARE BUILDS, NEVER IN A COMMIT ────────
//
// Owner 2026-10-02: "why are we getting all these conflicts". The pre-commit
// hook used to rewrite the same three lines (version.json, the sw.js CACHE
// name, APP_VERSION in js/cloud.js) on every commit of every branch, so any
// two branches always clashed there: every roll to uat, every PR main moved
// under. The committed copies are now a fixed placeholder that never changes,
// and this script writes the real version into the build Cloudflare is about
// to publish (scripts/cf-build.js calls it first).
//
// Same rules as before (CLAUDE.md section 2): MM.DD.YY.NN, the date in US
// Central, NN starting at 1 each Central day and going up by one per commit.
// Both are read from git instead of a counter in a file:
//   - the date is the Central day of the commit being built;
//   - NN is how many commits that build contains from that same Central day.
// So it is the same number on every machine that builds the same commit (the
// preview smoke recomputes it to check the deploy), and a new commit on top
// always moves it.
//
// Cloudflare may clone shallowly. A count that cannot see back to midnight
// would come out too small and repeat an earlier build's number, so the
// script deepens the clone to the start of the day first. If git still cannot
// see that far it falls back to the commit's Central clock time (HHMM), which
// still resets at midnight and still goes up within the day, and says so in
// version.json ("from": "clock").
//
//   node scripts/stamp-version.js           stamp the working tree
//   node scripts/stamp-version.js --print   print the version only

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TZ = 'America/Chicago';
// What the committed files hold. Shaped like a real version so every reader
// of the format keeps working on a plain checkout (local tests, local dev).
const PLACEHOLDER = '00.00.00.0';

const CENTRAL = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: '2-digit', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function central(ms) {
  const p = {};
  for (const x of CENTRAL.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { yy: p.year, mm: p.month, dd: p.day, hh: p.hour, mi: p.minute };
}

const dayKey = (ms) => { const c = central(ms); return `${c.mm}.${c.dd}.${c.yy}`; };

// Midnight Central of the day holding `ms`, as epoch ms. Midnight is 05:00
// or 06:00 UTC depending on daylight time, and is never the hour DST moves.
function centralMidnight(ms) {
  const c = central(ms);
  const y = 2000 + Number(c.yy), m = Number(c.mm) - 1, d = Number(c.dd);
  for (const h of [5, 6]) {
    const t = Date.UTC(y, m, d, h);
    const k = central(t);
    if (k.hh === '00' && k.mi === '00' && k.dd === c.dd) return t;
  }
  throw new Error(`stamp-version: no Central midnight found for ${new Date(ms).toISOString()}`);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// True when every commit at the shallow edge is older than `startSec`, i.e.
// nothing from the day being counted can be hiding beyond it.
function seesBackTo(cwd, startSec) {
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) !== 'true') return true;
  let edge = [];
  try { edge = fs.readFileSync(path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'shallow'])), 'utf8').split('\n').filter(Boolean); }
  catch (_e) { return false; }
  return edge.every((sha) => { try { return Number(git(cwd, ['show', '-s', '--format=%ct', sha])) < startSec; } catch (_e) { return false; } });
}

function deepen(cwd, sha, startSec) {
  const since = new Date((startSec - 3600) * 1000).toISOString();
  for (const args of [
    ['fetch', '-q', `--shallow-since=${since}`, 'origin', sha],
    ['fetch', '-q', `--shallow-since=${since}`, 'origin'],
    ['fetch', '-q', '--deepen=500', 'origin'],
  ]) {
    try { git(cwd, args); } catch (_e) { /* try the next way */ }
    if (seesBackTo(cwd, startSec)) return true;
  }
  return false;
}

// { version, sha, from } for the commit checked out in `cwd`.
function computeVersion(cwd, opts = {}) {
  const sha = git(cwd, ['rev-parse', 'HEAD']);
  const headMs = Number(git(cwd, ['show', '-s', '--format=%ct', sha])) * 1000;
  const day = dayKey(headMs);
  const startSec = Math.floor(centralMidnight(headMs) / 1000);
  const complete = seesBackTo(cwd, startSec) || (opts.deepen !== false && deepen(cwd, sha, startSec));
  if (!complete) {
    const c = central(headMs);
    return { version: `${day}.${Number(c.hh + c.mi)}`, sha, from: 'clock' };
  }
  const times = git(cwd, ['log', '--format=%ct', `--since=@${startSec}`, sha]).split('\n').filter(Boolean);
  const nn = times.filter((t) => dayKey(Number(t) * 1000) === day).length;
  return { version: `${day}.${Math.max(1, nn)}`, sha, from: 'git' };
}

// Write `info.version` into the three files the app reads it from. Each one
// must match exactly once: a pattern that silently stops matching would ship
// the placeholder, and the version watchdog would never reload anybody.
function stampFiles(root, info) {
  const v = info.version;
  const edits = [
    ['sw.js', /const CACHE = 'tradedesk-[^']+'/, `const CACHE = 'tradedesk-${v}'`],
    [path.join('js', 'cloud.js'), /const APP_VERSION='[^']+'/, `const APP_VERSION='${v}'`],
  ];
  for (const [rel, re, to] of edits) {
    const f = path.join(root, rel);
    const src = fs.readFileSync(f, 'utf8');
    const hits = src.match(new RegExp(re.source, 'g')) || [];
    if (hits.length !== 1) throw new Error(`stamp-version: expected one version line in ${rel}, found ${hits.length}`);
    fs.writeFileSync(f, src.replace(re, to), 'utf8');
  }
  fs.writeFileSync(path.join(root, 'version.json'),
    JSON.stringify({ version: v, sha: info.sha, from: info.from }) + '\n', 'utf8');
}

module.exports = { computeVersion, stampFiles, centralMidnight, dayKey, PLACEHOLDER };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const info = computeVersion(root);
  if (process.argv.includes('--print')) {
    process.stdout.write(info.version + '\n');
  } else {
    stampFiles(root, info);
    process.stdout.write(`[stamp-version] ${info.version} (${info.from}, ${info.sha.slice(0, 7)})\n`);
  }
}
