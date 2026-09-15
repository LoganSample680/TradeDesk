#!/usr/bin/env node
// Keep <lastmod> in sitemap.xml true.
//
// Google treats lastmod as a recrawl signal ONLY while a site is consistently
// honest about it; a sitemap that stamps today on everything is discounted and
// the signal is lost for good. So this derives each date from the page's own
// history instead of letting anyone type one in: the file's last commit date,
// or today when this commit is the one changing it.
//
// Runs from the pre-commit hook next to bump-version.js and stages its result,
// so the dates track reality without anybody remembering they exist.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = execSync('git rev-parse --show-toplevel').toString().trim();
const smFile = path.join(root, 'sitemap.xml');
let xml = fs.readFileSync(smFile, 'utf8');

// Same convention as bump-version.js: the business runs on US Central, so
// "today" means today there, not wherever a runner happens to live.
//
// Every date this script emits goes through here, which is the point. It used to
// read a past commit's date with `git log %cs`, and %cs reports the date in the
// COMMIT'S OWN timezone, which on a UTC runner is UTC. So a commit made at 8:42pm
// Central was recorded as the next day, and the sitemap published a lastmod in
// the future. Google discounts lastmod permanently once it catches a site doing
// that, so this is not cosmetic. Two clocks in one file is the bug; there is now
// one.
const centralDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const today = centralDate(Date.now());

// Cloudflare Pages serves foo.html at /foo, so the route IS the file path.
// "/" is the marketing home, which is landing.html (index.html is the app).
const fileFor = (loc) => {
  const p = new URL(loc).pathname.replace(/^\/+|\/+$/g, '');
  return p === '' ? 'landing.html' : p + '.html';
};

const staged = new Set(
  execSync(`git -C "${root}" diff --cached --name-only`).toString().split('\n').filter(Boolean)
);

const dateFor = (rel) => {
  if (staged.has(rel)) return today;            // this commit is the change
  try {
    // %ct is the commit time as unix seconds, which carries no timezone of its
    // own, so converting it here puts it on the same clock as `today` above.
    const ts = execSync(`git -C "${root}" log -1 --format=%ct -- "${rel}"`).toString().trim();
    return ts ? centralDate(Number(ts) * 1000) : today;   // never committed yet
  } catch (_e) { return today; }
};

// Only stamp when run as the hook. Requiring this file (the test does) must not
// rewrite the sitemap or stage anything.
if (require.main === module) {
let changed = 0;
xml = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!loc) return block;
  const rel = fileFor(loc);
  if (!fs.existsSync(path.join(root, rel))) return block;
  const stamp = `    <lastmod>${dateFor(rel)}</lastmod>\n`;
  const next = /<lastmod>/.test(block)
    ? block.replace(/ *<lastmod>[^<]*<\/lastmod>\n?/, stamp)
    : block.replace(/(<\/loc>\n)/, `$1${stamp}`);
  if (next !== block) changed++;
  return next;
});

fs.writeFileSync(smFile, xml, 'utf8');
execSync(`git -C "${root}" add sitemap.xml`);
process.stdout.write(`[sitemap-lastmod] ${changed} url${changed === 1 ? '' : 's'} stamped\n`);
}

// Exported so the timezone rule can be tested directly rather than inferred from
// a sitemap that only goes wrong for five hours a day.
module.exports = { centralDate };
