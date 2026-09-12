// @ts-check
// ── The app and the public tool must tell a contractor the same thing ────────
//
// TradeDesk carries TWO lien datasets, for two different jobs: LIEN_RULES
// (js/constants.js) is numeric and computes an actual filing date inside the
// app, and STATES (tools/lien-deadlines.html) is prose and renders the public
// lookup tool. They were maintained by hand, separately, and by 2026-09-12 they
// had drifted on SEVEN states:
//
//   AK 120 vs 90 · AL 120 vs 180 · DE 180 vs 120 · MS 365 vs 90
//   NM 120 vs 90 · OK 90 vs 120 · WY 150 vs 120
//
// Mississippi is the one that shows why this matters: the app gave a
// contractor 365 days to file where the tool gave 90. Whichever was right, one
// of those two screens was going to cost somebody their lien rights, and
// nothing anywhere would have noticed.
//
// Both were reconciled to the SHORTER deadline of the pair. Where two
// unverified sources disagree, early is harmless and late is fatal.
//
// This spec is the reason it cannot happen again. It is not a test of whether
// the LAW is right (that is per-state research, tracked separately); it is a
// test that the two things we show a user cannot disagree with each other.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const root = path.join(__dirname, '..');

// Texas is the documented exception. Its rule is "the 15th day of the fourth
// month after the month the work stopped", which is not a number of days at
// all: the app stores 100 as a workable approximation and the tool states the
// real rule in words. Forcing those two into the same integer would make one of
// them wrong, so the pair is excluded by name rather than by a silent filter.
const NOT_A_DAY_COUNT = ['TX'];

const toDays = (txt) => {
  let m = /^(\d+)\s*days?/.exec(txt); if (m) return +m[1];
  m = /^(\d+)\s*months?/.exec(txt);   if (m) return +m[1] * 30;
  m = /^(\d+)\s*years?/.exec(txt);    if (m) return +m[1] * 365;
  return null;
};

test.describe('the lien datasets agree with each other', () => {
  const app = fs.readFileSync(path.join(root, 'js', 'constants.js'), 'utf8');
  const tool = fs.readFileSync(path.join(root, 'tools', 'lien-deadlines.html'), 'utf8');

  const RULES = Object.fromEntries([...app.matchAll(
    /^  ([A-Z]{2}):\{notice_days:(\d+),filing_deadline_days:(\d+)\}/gm)].map(m => [m[1], +m[3]]));
  const TOOL = Object.fromEntries([...tool.matchAll(
    /^  ([A-Z]{2}):\['([^']*)','([^']*)'/gm)].map(m => [m[1], { name: m[2], deadline: m[3] }]));

  test('both cover every state, and the same ones', () => {
    expect(Object.keys(RULES).length, 'app states').toBe(51);
    expect(Object.keys(TOOL).length, 'tool states').toBe(51);
    expect(Object.keys(RULES).sort()).toEqual(Object.keys(TOOL).sort());
  });

  test('no state is given two different deadlines', () => {
    const conflicts = [];
    for (const st of Object.keys(RULES)) {
      if (NOT_A_DAY_COUNT.includes(st)) continue;
      const days = toDays(TOOL[st].deadline);
      expect(days, `${st}: the tool's "${TOOL[st].deadline}" must be a parseable span`).not.toBeNull();
      if (days !== RULES[st]) conflicts.push(`${st}: app ${RULES[st]}d vs tool "${TOOL[st].deadline}"`);
    }
    expect(conflicts, `the app and the public tool disagree:\n  ${conflicts.join('\n  ')}`).toEqual([]);
  });

  test('every deadline is a sane span, not a typo', () => {
    for (const [st, d] of Object.entries(RULES)) {
      // The app's own remote-config guard (js/bids.js) already refuses anything
      // outside 30..400, so a value it would reject must never be the default.
      expect(d, `${st} filing_deadline_days`).toBeGreaterThanOrEqual(30);
      expect(d, `${st} filing_deadline_days`).toBeLessThanOrEqual(400);
    }
  });

  test('every state still cites a statute, so a claim can be checked', () => {
    const block = app.slice(app.indexOf('const LIEN_RULES={'));
    const cited = (block.slice(0, block.indexOf('\n};')).match(/\/\/.*§/g) || []).length;
    expect(cited, 'states carrying a statute citation').toBeGreaterThanOrEqual(49);
  });
});
