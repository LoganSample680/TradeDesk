// @ts-check
/**
 * TIM AGAINST 240 REAL-SOUNDING JOB WALKS (owner 2026-09-28)
 *
 * "We need to run a shit ton of things through Tim so he knows how to place
 * this stuff. I can't teach Tim, Tim needs to pull what contractors would be
 * saying into a bid."
 *
 * tests/fixtures/tim-corpus/ holds 240 walks across eight trades, written the
 * way the phone hands them over: run-ons with no punctuation, full stops in the
 * middle of a phrase, "um", "no wait make it 8", prices said out loud, and the
 * trade words the phone mishears ("Sherman Williams", "roam ex", "core
 * protect"). Each one carries the lines an estimator would want.
 *
 * This is a RATCHET, the same idea as the click baseline (CLAUDE.md §12.2):
 *   - every walk in tests/fixtures/tim-corpus-passing.json must stay exactly
 *     right. A change to Tim that breaks one fails here, by name.
 *   - the share of lines Tim gets right across all 240 may not drop below the
 *     floor in that file.
 * When Tim gets better, add the newly passing ids and raise the floor in the
 * same commit. Never lower either to make a change pass.
 */
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const DIR = path.join(__dirname, 'fixtures', 'tim-corpus');
const WALKS = [].concat(...fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))));
const GATE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tim-corpus-passing.json'), 'utf8'));

test.describe('Tim against the trade corpus', () => {
  let page, results;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    results = await page.evaluate((walks) => {
      const norm = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9$'/.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
      return walks.map(w => {
        let got;
        try { got = timScopeBuild(w.said, { rejected: [] }).steps.map(s => s.text); } catch (e) { got = ['THREW ' + e.message]; }
        const g = got.map(norm), x = w.expect.map(norm);
        return { id: w.id, trade: w.trade, got, expect: w.expect, exact: g.length === x.length && g.every((v, i) => v === x[i]), hit: x.filter(l => g.includes(l)).length, of: x.length };
      });
    }, WALKS);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the corpus is all there and well formed', async () => {
    expect(WALKS.length).toBeGreaterThanOrEqual(240);
    const ids = new Set(WALKS.map(w => w.id));
    expect(ids.size).toBe(WALKS.length);
    for (const w of WALKS) {
      expect(typeof w.said, w.id).toBe('string');
      expect(Array.isArray(w.expect) && w.expect.length > 0, w.id).toBe(true);
    }
  });

  test('every walk Tim got right stays right', async () => {
    const byId = new Map(results.map(r => [r.id, r]));
    const broke = GATE.ids.filter(id => !byId.get(id) || !byId.get(id).exact)
      .map(id => { const r = byId.get(id); return r ? `${id}\n  want: ${r.expect.join(' | ')}\n  got:  ${r.got.join(' | ')}` : `${id}: missing`; });
    expect(broke, 'walks that used to come out right:\n' + broke.join('\n')).toEqual([]);
  });

  test('the share of lines Tim gets right does not drop', async () => {
    const hit = results.reduce((s, r) => s + r.hit, 0), of = results.reduce((s, r) => s + r.of, 0);
    expect(hit / of).toBeGreaterThanOrEqual(GATE.lineFloor);
  });

  test('no walk throws', async () => {
    expect(results.filter(r => /^THREW/.test(r.got[0] || '')).map(r => r.id)).toEqual([]);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tim corpus'); });
});
