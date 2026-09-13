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

  // Evaluate the real block rather than regexing the literal. Since 2026-09-13
  // LIEN_RULES is DERIVED: a verified state's value comes from LIEN_LAW (the
  // shortest window in that state), and the literal underneath it is only the
  // fallback for states nobody has verified yet. Reading the literal would test
  // a number the app no longer uses, which is worse than not testing at all.
  const _block = (() => {
    const a = app.indexOf('const LIEN_LAW=');
    const b = app.indexOf('})(', a);
    return app.slice(a, app.indexOf(');', b) + 2);
  })();
  const { LIEN_LAW, LIEN_RULES: _R } = new Function(_block + '; return {LIEN_LAW, LIEN_RULES};')();
  const RULES = Object.fromEntries(
    Object.entries(_R).filter(([k]) => /^[A-Z]{2}$/.test(k)).map(([k, v]) => [k, v.filing_deadline_days]));
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
      // A role-split state shows both windows ("4 months (prime) / 3 months
      // (sub)"). The app deliberately carries the SHORTER one, so compare
      // against the shortest span the tool shows rather than the first.
      const spans = TOOL[st].deadline.split('/').map(x => toDays(x.trim())).filter(n => n !== null);
      expect(spans.length, `${st}: the tool's "${TOOL[st].deadline}" must contain a parseable span`).toBeGreaterThan(0);
      const days = Math.min(...spans);
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
    // Two ways a state can carry a cite now: a verified LIEN_LAW entry, or the
    // legacy comment on its fallback line. Both count; neither may vanish.
    const legacy = (app.match(/\/\/ *[A-Z][^\n]*§/g) || []).length;
    const verified = Object.keys(LIEN_LAW).length;
    expect(legacy + verified, 'states carrying a statute citation').toBeGreaterThanOrEqual(49);
  });

  test('a verified state names the statute it was actually read from', () => {
    // The Kansas defect this whole model came out of: the app cited K.S.A.
    // 60-1105, which is the one-year ENFORCEMENT clock, as though it were the
    // filing deadline. Verified entries carry the section that was read, and
    // the source it was read from, so the claim can be checked by a person.
    for (const [st, L] of Object.entries(LIEN_LAW)) {
      expect(L.cite, `${st} cite`).toBeTruthy();
      expect(L.src, `${st} source`).toBeTruthy();
      expect(L.prime && L.prime.d, `${st} prime deadline`).toBeGreaterThan(0);
      expect(L.prime.anchor, `${st} anchor`).toBeTruthy();
    }
    expect(LIEN_LAW.KS.cite, 'Kansas cites the filing statutes, not 60-1105 alone')
      .toContain('60-1102');
    expect(RULES.KS, 'Kansas takes the shorter of prime 4 months and sub 3 months').toBe(90);
  });

  test('every jurisdiction was read from a statute, none left on a guess', () => {
    // On 2026-09-13 all 51 were verified against primary statutory text. This
    // test is the ratchet: a new jurisdiction, or one whose cite or source gets
    // dropped in a refactor, fails here rather than quietly shipping a number
    // nobody can check.
    const states = Object.keys(RULES);
    const missing = states.filter(st => !LIEN_LAW[st]);
    expect(missing, `jurisdictions with no verified entry: ${missing.join(', ')}`).toEqual([]);
    expect(states.length).toBe(51);
  });

  test('a role-split state takes the SHORTER window, never the longer', () => {
    // Filing early costs nothing. Filing late loses the money.
    for (const [st, L] of Object.entries(LIEN_LAW)) {
      if (!L.sub) continue;
      expect(RULES[st], `${st} must use the shorter of ${L.prime.d} and ${L.sub.d}`)
        .toBe(Math.min(L.prime.d, L.sub.d));
    }
  });
});
