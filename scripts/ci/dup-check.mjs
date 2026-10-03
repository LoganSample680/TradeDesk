#!/usr/bin/env node
// Copied code check (owner 2026-10-01: "will the issues ever stop being
// found?"). Six audits in one day kept finding the same thing: a piece of
// logic written a second time next to a helper that already did it. This
// stops a new copy at the PR instead of at the next audit.
//
// Two checks, both judged against the base branch so code that was already
// there never fails a PR; only what the PR adds can.
//
// 1. A copied block. Five or more meaningful lines that also appear somewhere
//    else in the app. Blank lines, comments and bare closers ("}", "});")
//    are not meaningful, so ordinary boilerplate never trips it.
// 2. A known one-line copy. Each of these has a shared helper, and each one
//    caused a real bug before it was shared:
//      cents rounding by hand      use _cents (js/utils.js)
//      a hardcoded 25% deposit     use the bid's deposit helper
//      dollars built by hand       use fmt (js/utils.js)
//
// A line that really must differ says why with "dup-ok: <reason>" in a
// comment on that line. That is the whole escape hatch, and it is visible in
// review.
//
// Usage: node scripts/ci/dup-check.mjs <base-ref>     (default origin/main)
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'origin/main';
const WINDOW = 5;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// The app's own code and the customer pages. index.html is mostly markup and
// tests repeat setup on purpose, so neither is scanned for blocks.
const inScope = f => /^js\/[^/]+\.js$/.test(f) || /^(client|sign|contract-sign|timesheet|intake)\.html$/.test(f);

function filesAt(ref) {
  let out = '';
  try { out = ref ? git('ls-tree', '-r', '--name-only', ref) : git('ls-files'); } catch (_e) { return []; }
  return out.split('\n').filter(inScope);
}
function readAt(ref, f) {
  try { return ref ? git('show', ref + ':' + f) : git('show', 'HEAD:' + f); } catch (_e) { return ''; }
}

// A line worth comparing: trimmed, not blank, not a comment, not a bare
// closer, and long enough to say something.
function meaningful(line) {
  const t = line.trim();
  if (!t) return null;
  if (/^(\/\/|\/\*|\*|<!--)/.test(t)) return null;
  if (/dup-ok:/.test(t)) return null;
  if (t.replace(/[\s{}()\[\];,'"+`]/g, '').length < 12) return null;
  return t.replace(/\s+/g, ' ');
}

// Every five-line window of meaningful lines, keyed by its text.
function windows(ref, files) {
  const map = new Map();
  for (const f of files) {
    const lines = readAt(ref, f).split('\n');
    const kept = [];
    lines.forEach((l, i) => { const m = meaningful(l); if (m) kept.push({ t: m, n: i + 1 }); });
    for (let i = 0; i + WINDOW <= kept.length; i++) {
      const key = kept.slice(i, i + WINDOW).map(x => x.t).join('\n');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ f, from: kept[i].n, to: kept[i + WINDOW - 1].n });
    }
  }
  return map;
}

let failed = false;

// ── 1. Copied blocks ─────────────────────────────────────────────────────────
const head = windows(null, filesAt(null));
const base = windows(BASE, filesAt(BASE));
const found = [];
for (const [key, locs] of head) {
  if (locs.length < 2) continue;
  const before = (base.get(key) || []).length;
  if (locs.length > before) found.push(locs);
}
// A copy of N lines is N-4 overlapping windows. Report it once, as a range.
const seen = new Set();
const blocks = [];
for (const locs of found) {
  const id = locs.map(l => l.f + ':' + l.from).join('|');
  if (seen.has(id)) continue;
  seen.add(id);
  const prev = blocks.find(b => b.length === locs.length && b.every((x, i) => x.f === locs[i].f && locs[i].from <= x.to + 1 && locs[i].from >= x.from));
  if (prev) prev.forEach((x, i) => { x.to = Math.max(x.to, locs[i].to); });
  else blocks.push(locs.map(l => ({ ...l })));
}
for (const b of blocks) {
  failed = true;
  console.log('::error file=' + b[0].f + ',line=' + b[0].from + '::Copied block: the same ' + WINDOW + '+ lines are at ' +
    b.map(x => x.f + ':' + x.from + '-' + x.to).join(' and ') + '. Make it one shared function (CLAUDE.md 7.3).');
}

// ── 2. Known one-line copies, on the lines this PR adds ─────────────────────
const RULES = [
  { re: /Math\.round\((?:[^()]|\([^()]*\))*\*\s*100\s*\)\s*\/\s*100/, say: 'Cents rounding by hand: use _cents(n) from js/utils.js.' },
  { re: /dep[a-z_]*[^;\n]*\*\s*(?:0?\.25|25\s*\/\s*100)\b|\*\s*(?:0?\.25|25\s*\/\s*100)\b[^;\n]*dep/i, say: 'A hardcoded 25% deposit: use the bid\'s deposit helper.' },
  { re: /['"`]\$['"`]\s*\+[^;\n]*toLocaleString/, say: 'Dollars built by hand: use fmt(n) from js/utils.js.' },
];
let diff = '';
try { diff = git('diff', '-U0', BASE + '...HEAD', '--', 'js', 'client.html', 'sign.html', 'contract-sign.html', 'timesheet.html', 'intake.html'); }
catch (_e) { diff = ''; }
let file = '', lineNo = 0;
for (const l of diff.split('\n')) {
  if (l.startsWith('+++ ')) { file = l.slice(6); continue; }
  const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (h) { lineNo = Number(h[1]); continue; }
  if (l.startsWith('+') && !l.startsWith('+++')) {
    const t = l.slice(1);
    if (inScope(file) && !/dup-ok:/.test(t) && !/^\s*(\/\/|\*)/.test(t)) {
      for (const r of RULES) if (r.re.test(t)) {
        failed = true;
        console.log('::error file=' + file + ',line=' + lineNo + '::' + r.say + ' (or say why on the line with "dup-ok: <reason>")');
      }
    }
    lineNo++;
  }
}

if (failed) process.exit(1);
console.log('No new copied code.');
