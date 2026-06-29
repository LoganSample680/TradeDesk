// @ts-check
// State maximum-deposit cap (home-improvement compliance — task #22).
// legal.js defines STATE_DEPOSIT_CAP (50 states + DC) plus _maxDeposit() and
// _depositCapNote(). _maxDeposit(state, amount) returns the largest legal deposit
// dollar amount; 'none'/unknown states return the full contract amount (no cap).
// Offline detector test: boots the real app (index.html) and exercises the pure
// helpers — no network, no Supabase writes.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('STATE_DEPOSIT_CAP — _maxDeposit + _depositCapNote', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test('helpers and data table exist', async () => {
    const r = await page.evaluate(() => ({
      fn: typeof _maxDeposit,
      note: typeof _depositCapNote,
      table: typeof STATE_DEPOSIT_CAP,
      ca: STATE_DEPOSIT_CAP && STATE_DEPOSIT_CAP.CA ? STATE_DEPOSIT_CAP.CA.rule : null,
    }));
    expect(r.fn).toBe('function');
    expect(r.note).toBe('function');
    expect(r.table).toBe('object');
    expect(r.ca).toBe('lesser');
    assertNoErrors(page, 'deposit-cap helpers present');
  });

  test('CA — lesser of $1,000 or 10% of contract', async () => {
    const r = await page.evaluate(() => ({
      big: _maxDeposit('CA', 20000),   // 10% = 2000, flat = 1000 → lesser = 1000
      small: _maxDeposit('CA', 5000),  // 10% = 500, flat = 1000 → lesser = 500
      lower: _maxDeposit('ca', 20000), // case-insensitive
    }));
    expect(r.big).toBe(1000);
    expect(r.small).toBe(500);
    expect(r.lower).toBe(1000);
    assertNoErrors(page, 'CA lesser-of cap');
  });

  test('MD — one-third (33.33%) of contract', async () => {
    const r = await page.evaluate(() => _maxDeposit('MD', 9000)); // 33.33% of 9000
    // 9000 * 33.33 / 100 = 2999.7 — within a dollar of 3000
    expect(r).toBeGreaterThan(2990);
    expect(r).toBeLessThanOrEqual(3000);
    assertNoErrors(page, 'MD pct cap');
  });

  test('PA and MA — one-third pct cap', async () => {
    const r = await page.evaluate(() => ({
      pa: _maxDeposit('PA', 12000), // ~3999.6
      ma: _maxDeposit('MA', 30000), // ~9999
    }));
    expect(r.pa).toBeGreaterThan(3990);
    expect(r.pa).toBeLessThanOrEqual(4000);
    expect(r.ma).toBeGreaterThan(9990);
    expect(r.ma).toBeLessThanOrEqual(10000);
    assertNoErrors(page, 'PA/MA pct cap');
  });

  test('NV — lesser of $1,000 or 10%', async () => {
    const r = await page.evaluate(() => ({
      big: _maxDeposit('NV', 50000), // 10% = 5000, flat = 1000 → 1000
      small: _maxDeposit('NV', 4000), // 10% = 400 → 400
    }));
    expect(r.big).toBe(1000);
    expect(r.small).toBe(400);
    assertNoErrors(page, 'NV lesser-of cap');
  });

  test("'none' state (TX) — no cap, returns full contract amount", async () => {
    const r = await page.evaluate(() => ({
      tx: _maxDeposit('TX', 10000),
      ks: _maxDeposit('KS', 8000),
    }));
    expect(r.tx).toBe(10000);
    expect(r.ks).toBe(8000);
    assertNoErrors(page, 'none-state no cap');
  });

  test('unknown / empty / nullish state — no crash, returns amount', async () => {
    const r = await page.evaluate(() => ({
      unknown: _maxDeposit('ZZ', 10000),
      empty: _maxDeposit('', 10000),
      nul: _maxDeposit(null, 7500),
      undef: _maxDeposit(undefined, 6000),
      noAmt: _maxDeposit('CA', undefined),
      negAmt: _maxDeposit('CA', -500),
    }));
    expect(r.unknown).toBe(10000);
    expect(r.empty).toBe(10000);
    expect(r.nul).toBe(7500);
    expect(r.undef).toBe(6000);
    expect(r.noAmt).toBe(0);  // 0 contract → 0 max
    expect(r.negAmt).toBe(0); // negative clamped to 0
    assertNoErrors(page, 'unknown-state graceful');
  });

  test('_depositCapNote returns a citation string for capped states and a no-cap string otherwise', async () => {
    const r = await page.evaluate(() => ({
      ca: _depositCapNote('CA'),
      md: _depositCapNote('MD'),
      tx: _depositCapNote('TX'),
      unknown: _depositCapNote('ZZ'),
      nul: _depositCapNote(null),
    }));
    expect(r.ca).toContain('California');
    expect(r.ca).toContain('§7159.5');
    expect(r.md).toContain('33.33');
    expect(r.tx.toLowerCase()).toContain('no statutory');
    expect(typeof r.unknown).toBe('string');
    expect(typeof r.nul).toBe('string');
    assertNoErrors(page, 'deposit-cap note string');
  });

  test('lookupDepositCap falls back to hardcoded value when table/_supa is absent', async () => {
    // This suite boots with mockAllExternal (no real Supabase writes). lookupDepositCap
    // must degrade to STATE_DEPOSIT_CAP on miss/error/no-supa and produce the SAME
    // max-deposit result the sync _maxDeposit gives — proving the live path is a
    // pure superset, never a behavior change offline.
    const r = await page.evaluate(async () => {
      const ca = await lookupDepositCap('CA');           // capped state
      const tx = await lookupDepositCap('TX');           // 'none' state
      const zz = await lookupDepositCap('ZZ');           // unknown → default no-cap
      // live helper vs sync helper must agree on the dollar amount
      const liveCaBig = await _maxDepositLive('CA', 20000);
      const syncCaBig = _maxDeposit('CA', 20000);
      const liveTx = await _maxDepositLive('TX', 10000);
      const syncTx = _maxDeposit('TX', 10000);
      const liveMd = await _maxDepositLive('MD', 9000);
      const syncMd = _maxDeposit('MD', 9000);
      return {
        liveExists: typeof lookupDepositCap === 'function',
        maxLiveExists: typeof _maxDepositLive === 'function',
        caRule: ca && ca.rule, caStatute: ca && ca.statute,
        txRule: tx && tx.rule, zzRule: zz && zz.rule,
        liveCaBig, syncCaBig, liveTx, syncTx, liveMd, syncMd,
      };
    });
    expect(r.liveExists).toBe(true);
    expect(r.maxLiveExists).toBe(true);
    // Fallback returns the hardcoded shape unchanged.
    expect(r.caRule).toBe('lesser');
    expect(r.caStatute).toContain('§7159.5');
    expect(r.txRule).toBe('none');
    expect(r.zzRule).toBe('none');
    // Live == sync on every class of state.
    expect(r.liveCaBig).toBe(r.syncCaBig);   // 1000
    expect(r.liveCaBig).toBe(1000);
    expect(r.liveTx).toBe(r.syncTx);         // 10000 (no cap)
    expect(r.liveTx).toBe(10000);
    expect(r.liveMd).toBe(r.syncMd);         // ~2999.7
    assertNoErrors(page, 'lookupDepositCap fallback');
  });

  test('cap never exceeds the contract amount', async () => {
    const r = await page.evaluate(() => ({
      // A pct cap on a tiny contract still cannot exceed it
      tiny: _maxDeposit('MD', 100),  // 33.33 of 100 = 33.33 ≤ 100
      caTiny: _maxDeposit('CA', 50), // 10% = 5, flat 1000 → lesser 5 ≤ 50
    }));
    expect(r.tiny).toBeLessThanOrEqual(100);
    expect(r.caTiny).toBe(5);
    assertNoErrors(page, 'cap bounded by amount');
  });
});
