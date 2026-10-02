#!/usr/bin/env node
'use strict';
// ── WHAT IS ON THE PHONES BUT NOT IN PRODUCTION (owner 2026-10-01) ─────────
//
// "ensure everything makes it to main." A roll puts a branch on uat, the
// owner tries it on TestFlight, and nothing ever says the PR was not merged.
// On 2026-10-01, 77 files differed between uat and main. This lists every
// branch that has work on uat and not on main, how old that work is, and the
// PR it is waiting on (or that it has none).
//
//   node scripts/uat-backlog.js            markdown report on stdout
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo  adds each branch's PR
//
// Needs every branch fetched (git fetch origin '+refs/heads/*:refs/remotes/origin/*').
const { execFileSync } = require('child_process');
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim(); } catch (_e) { return ''; } };
const isAnc = (a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b]); return true; } catch (_e) { return false; } };

const MAIN = 'origin/main', UAT = 'origin/uat';
const DAY = 86400000;
const now = Date.now();
const onUat = new Set(git('rev-list', '--no-merges', UAT, '^' + MAIN).split('\n').filter(Boolean));

async function prFor(branch) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const owner = repo.split('/')[0];
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}&per_page=5`,
    { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null;
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return { none: true };
  const open = list.find(p => p.state === 'open');
  if (open) return { number: open.number, open: true };
  const merged = list.find(p => p.merged_at);
  if (merged) return { number: merged.number, merged: true };
  return { number: list[0].number, closed: true };
}

(async () => {
  const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/claude/').split('\n').filter(Boolean);
  const rows = [];
  for (const b of branches) {
    if (isAnc(b, MAIN)) continue;
    // Only this branch's own commits that reached uat. A branch cut from uat
    // carries everyone else's commits too; those are reported under their
    // own branches, and this one is flagged instead.
    const own = git('rev-list', '--no-merges', b, '^' + MAIN).split('\n').filter(Boolean);
    const rolled = own.filter(c => onUat.has(c));
    if (!rolled.length) continue;
    const fromUat = /^(UAT deploy|Merge (remote-tracking )?branch '.*' into uat)$/m.test(git('log', '--format=%s', MAIN + '..' + b));
    const newest = Math.max(...rolled.map(c => Number(git('log', '-1', '--format=%ct', c)) * 1000));
    const pr = await prFor(b.replace(/^origin\//, ''));
    // A PR that merged (squashed, before merge commits were the rule) put its
    // work on main under different commits. Nothing is waiting on it.
    if (pr && pr.merged) continue;
    rows.push({ branch: b.replace(/^origin\//, ''), commits: rolled.length, days: Math.floor((now - newest) / DAY), pr, fromUat });
  }
  rows.sort((a, b) => b.days - a.days);
  const diff = git('diff', '--shortstat', MAIN, UAT);
  const out = [];
  out.push('## On UAT, not in production');
  out.push('');
  out.push(diff ? `UAT and main differ by ${diff.replace(/^\s+/, '')}.` : 'UAT and main hold the same code.');
  out.push('');
  if (!rows.length) out.push('Every branch on UAT is merged into main.');
  for (const r of rows) {
    const pr = !r.pr ? '' : r.pr.none ? ' **No PR.**' : r.pr.open ? ` PR #${r.pr.number} open.` : ` PR #${r.pr.number} closed without merging.`;
    const age = r.days === 0 ? 'today' : r.days === 1 ? '1 day old' : `${r.days} days old`;
    const flag = r.days >= 2 ? ' ⚠️' : '';
    out.push(`- \`${r.branch}\`: ${r.commits} commit${r.commits === 1 ? '' : 's'} on UAT, newest ${age}.${pr}${r.fromUat ? ' Started from uat, so it also carries other sessions\' work.' : ''}${flag}`);
  }
  out.push('');
  out.push('Each one reaches production only through its own PR merged into main (CLAUDE.md 3.1).');
  process.stdout.write(out.join('\n') + '\n');
})();
