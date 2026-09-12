// @ts-check
// ── The recrawl submission must actually get to run ──────────────────────────
//
// The first live run of indexnow.yml, on the merge of #78, reported
// "cancelled" and submitted NOTHING. The job carried timeout-minutes: 5 while
// the deploy-wait loop below it was written to poll for up to 10 minutes, so
// GitHub killed the job at 5m08s in the middle of waiting and the Submit step
// was skipped.
//
// The failure mode is what makes this worth a test: the workflow did not go
// red, it went "cancelled", and the thing it exists to do silently did not
// happen. Bing was never told to recrawl and nobody would have noticed except
// by going and looking.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const wf = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'indexnow.yml'), 'utf8');

test.describe('the IndexNow workflow can finish what it starts', () => {
  test('the job timeout exceeds the deploy wait it has to sit through', () => {
    const timeoutMin = Number((wf.match(/^\s*timeout-minutes:\s*(\d+)/m) || [])[1]);
    const tries = Number((wf.match(/WAIT_TRIES:\s*(\d+)/) || [])[1]);
    const sleep = Number((wf.match(/WAIT_SLEEP:\s*(\d+)/) || [])[1]);

    expect(timeoutMin, 'job declares a timeout').toBeGreaterThan(0);
    expect(tries, 'wait loop declares its try count').toBeGreaterThan(0);
    expect(sleep, 'wait loop declares its sleep').toBeGreaterThan(0);

    const waitMin = (tries * sleep) / 60;
    // Strictly greater, with room for checkout and node startup. Equal is not
    // enough: the job would be killed on the last poll rather than submitting.
    expect(timeoutMin,
      `job timeout ${timeoutMin}m must exceed the ${waitMin}m wait loop, or Submit is skipped`
    ).toBeGreaterThan(waitMin + 2);
  });

  test('the loop is driven by those variables, not a second hardcoded number', () => {
    // The bug was two numbers that had to agree and nothing making them.
    expect(wf, 'loop count comes from WAIT_TRIES').toMatch(/seq 1 "\$WAIT_TRIES"/);
    expect(wf, 'sleep comes from WAIT_SLEEP').toMatch(/sleep "\$WAIT_SLEEP"/);
  });

  test('a slow deploy warns and still submits, rather than giving up', () => {
    // Waiting is a best effort. Never submitting is the worse outcome, so the
    // loop falls through to Submit instead of failing the job.
    expect(wf).toMatch(/::warning::deploy did not reach/);
    expect(wf, 'Submit is not conditional on the wait succeeding').toMatch(/- name: Submit\n\s+run: node scripts\/indexnow\.js/);
  });

  test('it only ever submits production', () => {
    expect(wf).toMatch(/branches:\s*\[main\]/);
    expect(wf, 'no preview URL is ever submitted').not.toMatch(/pages\.dev/);
  });
});
