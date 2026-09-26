// @ts-check
/**
 * THE APP NEVER SAYS "AI" (owner 2026-09-17)
 *
 * "we need to remove any reference to AI for anything here, receipt scanner ai
 * fills fields, all that shit gotta go."
 *
 * A contractor is told what the app DOES for him, not what is running behind
 * it. Three strings said otherwise and are gone: the receipt scanner tip
 * (index.html), the scanned-date confirmation (js/finance.js) and the
 * industrial scope helper's heading (js/generic-estimate.js).
 *
 * This is a SOURCE scan, the same shape as the UTC day-key guard in
 * e2e-utils-exhaustive.spec.js, because the copy that matters lives in string
 * literals across a dozen files and a per-screen test would only ever cover the
 * screens somebody remembered to open.
 *
 * WHAT IS DELIBERATELY NOT SCANNED, and why, so nobody "finishes the job" later
 * by deleting the wrong thing:
 *
 *   · privacy.html and terms.html. Receipt images really are sent to a third
 *     party for extraction. The disclosure is a legal obligation and removing
 *     it would be the one genuinely harmful edit in this whole sweep.
 *   · landing.html, compare/*, ai-answering-service-for-contractors.html. Those
 *     say AI about COMPETITORS, and the position is that TradeDesk deliberately
 *     does not answer your phone with a robot. Scrubbing the word there deletes
 *     the argument and an SEO page built on it.
 *   · Code comments and internal identifiers. Not user-facing, and a comment
 *     that cannot name what the code calls is a comment that lies.
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

// Anything a contractor or a client can actually read on a screen.
const APP_FILES = () => {
  const root = path.join(__dirname, '..');
  const js = fs.readdirSync(path.join(root, 'js'))
    .filter(f => f.endsWith('.js'))
    .map(f => 'js/' + f);
  const html = ['index.html', 'client.html', 'sign.html', 'contract-sign.html',
    'intake.html', 'ops.html'];
  return [...js, ...html].filter(f => fs.existsSync(path.join(root, f)));
};

// Vendored libraries are somebody else's source and are never read aloud to a
// contractor; xlsx alone would otherwise dominate every match.
const VENDORED = /^js\/(lib|vendor)\//;

// A line is only a finding if the term sits in something that RENDERS. Comment
// lines are skipped outright, and the remaining lines must carry the term
// inside a quoted string or between HTML tags.
const isComment = (line) => /^\s*(\/\/|\*|\/\*|<!--)/.test(line);

const TERMS = /\b(A\.?I\.?|Claude|Anthropic|GPT|LLM)\b/;

test.describe('no AI in anything a user reads', () => {
  test('app source carries no user-facing AI wording', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];
    APP_FILES().forEach(rel => {
      if (VENDORED.test(rel)) return;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        if (!TERMS.test(line)) return;
        // Inside a quoted string, or between tags: that is copy.
        const renders = /(['"`])[^'"`]*\b(A\.?I\.?|Claude|Anthropic|GPT|LLM)\b/.test(line)
          || />[^<]*\b(A\.?I\.?|Claude|Anthropic|GPT|LLM)\b[^<]*</.test(line);
        if (renders) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    });
    expect(offenders,
      'the app tells a contractor what it does for him, not what runs behind it; ' +
      'the disclosure belongs in privacy.html and stays there'
    ).toEqual([]);
  });

  test('the three strings that were removed read the way they should now', () => {
    const root = path.join(__dirname, '..');
    const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const fin = fs.readFileSync(path.join(root, 'js/finance.js'), 'utf8');
    const gei = fs.readFileSync(path.join(root, 'js/generic-estimate.js'), 'utf8');

    // The receipt tip still promises the outcome, it just does not name a robot.
    expect(idx).toContain('The vendor, amount, date and category fill themselves in.');
    expect(idx).not.toContain('AI reads the vendor');

    // The date confirmation still asks the same question.
    expect(fin).toContain('Date read as:');
    expect(fin).not.toContain('AI read date as');

    // The scope helper keeps its job, loses its label.
    expect(gei).toContain('Scope helper');
    expect(gei).not.toContain('AI Scope Helper');
  });

  test('the privacy disclosure is still there, because it has to be', () => {
    const root = path.join(__dirname, '..');
    const priv = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
    // If this ever fails, somebody scrubbed the one place the word is required.
    expect(priv).toContain('Anthropic');
    expect(priv.toLowerCase()).toContain('receipt');
  });
});
