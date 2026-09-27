// @ts-check
// ── /beta cannot go live half-wired ─────────────────────────────────────────
//
// The page's whole job is one button: join the beta on TestFlight. The link
// itself only exists in App Store Connect, so the page was written before it
// was known, with TESTFLIGHT_JOIN_URL standing in for it.
//
// A placeholder href is a dead button, and a dead button on a page the owner
// pastes into an email is worse than no page. So this spec makes the unfinished
// state SAFE rather than trusting anyone to remember: while the placeholder is
// there, /beta must not be in the sitemap and must not be linked from the site,
// so nothing sends a person to it. The moment the placeholder is replaced, the
// same spec flips and demands a real TestFlight URL and a sitemap entry.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const beta = read('beta.html');
const sitemap = read('sitemap.xml');
const landing = read('landing.html');

const PLACEHOLDER = 'TESTFLIGHT_JOIN_URL';
const wired = !beta.includes(PLACEHOLDER);

test.describe('the beta page', () => {
  test('it is either fully wired or fully unreachable, never in between', () => {
    if (wired) {
      expect(beta, 'a real TestFlight public link')
        .toMatch(/https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+/);
      expect(sitemap, 'wired means indexable').toContain('https://tradedeskpro.app/beta');
    } else {
      // Unfinished. Nothing may point at it.
      expect(sitemap, 'an unwired page is not in the sitemap').not.toContain('/beta<');
      expect(landing, 'nothing on the landing page links to it yet').not.toContain('href="/beta"');
    }
  });

  test('the offer on the page is the offer the owner stated', () => {
    // Ten seats, free through the beta, $29.99 after, locked. These are the
    // numbers a person reads and decides on, so a typo here is a broken promise
    // rather than a cosmetic bug.
    expect(beta).toContain('ten contractors');
    expect(beta).toContain('$29.99');
    expect(beta).toContain('$99.99');
    expect(beta, 'no card is collected for the beta').toMatch(/No credit card/i);
  });

  test('it names the feedback path that actually carries the evidence', () => {
    // Owner, 2026-09-13: TestFlight's own screenshot feedback is the best
    // channel, because it delivers the picture, the device and the exact build
    // with it. An emailed "it broke" carries none of that, so the page has to
    // teach the gesture rather than just say "let us know".
    expect(beta).toMatch(/Share Beta Feedback/);
    expect(beta, 'the gesture, not just the feature name').toMatch(/[Ss]creenshot/);
  });

  test('a contractor without an iPhone is not turned away', () => {
    // TestFlight is iPhone-only and the web app is not. Sending an Android
    // contractor to a dead end would lose a tester for no reason.
    expect(beta).toMatch(/Not on an iPhone/i);
    expect(beta).toContain('href="/?signup=1"');
  });

  test('it carries no em dash', () => {
    // CLAUDE.md, the standing rule. This page is written to be pasted into an
    // email, which is exactly where a machine-written dash reads worst.
    expect(beta).not.toMatch(/&mdash;|—/);
  });
});
