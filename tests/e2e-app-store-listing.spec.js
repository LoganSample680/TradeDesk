// @ts-check
// ── The App Store listing (2026-10-01) ───────────────────────────────────────
// docs/app-store/listing.json is what scripts/asc-listing.mjs pushes into App
// Store Connect. Apple rejects an over-long field at upload and reviewers
// reject "beta" or placeholder wording, so the limits are asserted here, on
// every push, instead of discovered on the owner's phone at submit time.
const { test, expect } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/app-store/listing.json'), 'utf8'));
const kit = fs.readFileSync(path.join(ROOT, 'docs/app-store/submission-kit.md'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'scripts/asc-listing.mjs'), 'utf8');
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/asc-listing.yml'), 'utf8');

test.describe('App Store listing', () => {
  test('every field fits Apple\'s limits', () => {
    expect(L.subtitle.length).toBeLessThanOrEqual(30);
    expect(L.keywords.length).toBeLessThanOrEqual(100);
    expect(L.promotionalText.length).toBeLessThanOrEqual(170);
    expect(L.description.length).toBeLessThanOrEqual(4000);
    expect(L.reviewNotes.length).toBeLessThanOrEqual(4000);
    expect(L.keywords).not.toMatch(/\s/);   // spaces waste the 100 characters
  });

  test('nothing a reviewer rejects on sight', () => {
    const shown = [L.subtitle, L.promotionalText, L.description, L.keywords].join('\n');
    expect(shown).not.toMatch(/\bbeta\b|testflight|coming soon|android|google play/i);
    expect(JSON.stringify(L)).not.toContain('—');   // house rule: no em dashes
  });

  test('the kit shows exactly what the script pushes', () => {
    for (const k of ['promotionalText', 'description', 'keywords', 'reviewNotes', 'subtitle', 'supportUrl', 'privacyPolicyUrl']) {
      expect(kit, k).toContain(L[k]);
    }
  });

  test('the URLs point at real pages in this repo', () => {
    expect(L.supportUrl).toBe('https://tradedeskpro.app/support');
    expect(fs.existsSync(path.join(ROOT, 'support.html'))).toBe(true);
    expect(L.privacyPolicyUrl).toBe('https://tradedeskpro.app/privacy');
    expect(fs.existsSync(path.join(ROOT, 'privacy.html'))).toBe(true);
  });

  test('it is the store app, and the review notes cover what reviewers ask about', () => {
    expect(L.bundleId).toBe('app.tradedesk');
    for (const s of ['BACKGROUND LOCATION', 'PAYMENTS', 'ACCOUNT DELETION', 'Settings, Danger zone, Delete account', 'Sign in with Apple']) {
      expect(L.reviewNotes, s).toContain(s);
    }
  });

  test('the automation never submits for review and never stores a password in the repo', () => {
    expect(script).not.toMatch(/reviewSubmissions|appStoreVersionSubmissions/);
    expect(Object.keys(L).filter(k => /pass|demo/i.test(k))).toEqual([]);   // the login lives in repo secrets
    expect(wf).toContain('secrets.ASC_DEMO_PASS');
    expect(wf).toMatch(/contains\(github\.event\.head_commit\.message, '\[asc-listing\]'\)/);
  });
});
