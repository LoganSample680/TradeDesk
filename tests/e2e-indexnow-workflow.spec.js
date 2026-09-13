// @ts-check
// ── The recrawl submission must actually get to run ──────────────────────────
//
// Two live failures, both of which ended with Bing never being told anything,
// and neither of which went red:
//
// 1. Run 1 (merge of #78) reported "cancelled". The job carried
//    timeout-minutes: 5 while the deploy wait below it polls for up to 10, so
//    GitHub killed it at 5m08s mid-wait and Submit was skipped.
// 2. Run 2 (the dispatch after #80) waited the full ten minutes and never once
//    read the version it was waiting for: forty lines of "serving '?'" on a
//    deploy that had gone live nine minutes earlier. It polled the public site
//    for /version.json, and Cloudflare answers a plain curl with a bot
//    challenge rather than the file. It warned and submitted anyway, which is
//    the only reason that run worked at all.
//
// The failure mode is what makes this worth a test: neither run went red, and
// the thing the workflow exists to do silently did not happen.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const root = path.join(__dirname, '..');
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'indexnow.yml'), 'utf8');
const waiter = fs.readFileSync(path.join(root, 'scripts', 'wait-for-deploy.js'), 'utf8');
// The waiter's header explains at length what it must NOT do, so the "does it
// probe the site" assertions read the CODE, not the comment describing the bug.
const waiterCode = waiter.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test.describe('the IndexNow workflow can finish what it starts', () => {
  test('the job timeout exceeds the deploy wait it has to sit through', () => {
    const timeoutMin = Number((wf.match(/^\s*timeout-minutes:\s*(\d+)/m) || [])[1]);
    const tries = Number((waiter.match(/^const TRIES = (\d+)/m) || [])[1]);
    const sleepMs = Number((waiter.match(/^const SLEEP_MS = (\d+)/m) || [])[1]);

    expect(timeoutMin, 'job declares a timeout').toBeGreaterThan(0);
    expect(tries, 'the waiter declares its try count').toBeGreaterThan(0);
    expect(sleepMs, 'the waiter declares its sleep').toBeGreaterThan(0);

    const waitMin = (tries * sleepMs) / 60000;
    // Strictly greater, with room for checkout and node startup. Equal is not
    // enough: the job would be killed on the last poll rather than submitting.
    expect(timeoutMin,
      `job timeout ${timeoutMin}m must exceed the ${waitMin}m wait, or Submit is skipped`
    ).toBeGreaterThan(waitMin + 2);
  });

  test('the wait never asks the public site, which cannot answer it', () => {
    // This is the run-2 regression. The site is behind a bot challenge, so a
    // probe of it reads as "not deployed yet" forever, every single time.
    expect(waiterCode, 'no probe of the live site').not.toMatch(/tradedeskpro\.app/);
    expect(waiterCode, 'no version.json comparison').not.toMatch(/version\.json/);
    expect(waiterCode, 'asks GitHub for the deployment instead').toMatch(/api\.github\.com/);
    expect(waiterCode, 'matched against this exact commit').toMatch(/GITHUB_SHA/);
  });

  test('the stale GitHub Pages mirror is never mistaken for the deploy', () => {
    // The repo is public and publishes a github.io mirror from the same
    // commits. Its deployment succeeds and means nothing, the same trap
    // preview-smoke.yml fell into on 2026-07-02.
    expect(waiterCode).toMatch(/github-pages/);
    expect(waiterCode, 'the mirror is skipped, not accepted').toMatch(/IGNORE_ENV/);
  });

  test('a slow deploy warns and still submits, rather than giving up', () => {
    // Waiting is a best effort. Never submitting is the worse outcome, so the
    // waiter falls through to Submit instead of failing the job.
    expect(waiterCode).toMatch(/::warning::no successful deployment/);
    expect(waiterCode, 'the waiter never exits non-zero').not.toMatch(/process\.exit\([1-9]/);
    expect(wf, 'Submit is not conditional on the wait succeeding')
      .toMatch(/- name: Submit\n\s+run: node scripts\/indexnow\.js/);
  });

  test('it only ever submits production', () => {
    expect(wf).toMatch(/branches:\s*\[main\]/);
    expect(wf, 'no preview URL is ever submitted').not.toMatch(/pages\.dev/);
  });
});
