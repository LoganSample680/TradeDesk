// @ts-check
/**
 * TIM'S MATERIALS AGAINST 120 SPOKEN LISTS (owner 2026-09-28)
 *
 * "Material part quantities and actual material is gonna be huge for speed."
 *
 * tests/fixtures/tim-materials/ holds walks said every way a tradesman says a
 * list: supply runs, job walks with the parts in them, "what we used" on an
 * invoice, run-ons with no commas, corrections ("no, 10 of them"), sizes before
 * the thing ("a 50 gallon Bradford White"), and brands the phone mishears.
 * Each carries the materials an estimator would put on the list: count, the
 * unit it is sold in, and the thing.
 *
 * The same ratchet as the scope corpus (tests/e2e-tim-corpus.spec.js):
 *   - every walk in tim-materials-passing.json keeps its list exactly right;
 *   - the share of items Tim gets right (count, unit, and the thing) may not
 *     drop below the floor there.
 * When Tim gets better, add the ids and raise the floor in the same commit.
 */
const fs = require('fs');
const path = require('path');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const DIR = path.join(__dirname, 'fixtures', 'tim-materials');
const WALKS = [].concat(...fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))));
const GATE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tim-materials-passing.json'), 'utf8'));

test.describe('Tim against the materials corpus', () => {
  let page, results;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    results = await page.evaluate((walks) => {
      const sing = w => w.replace(/(ss|sh|ch|x|z)es$/, '$1').replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
      const item = s => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9/.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map(sing).join(' ');
      const unit = u => ({ each: 'ea', feet: 'foot', ft: 'foot' }[String(u || 'ea').toLowerCase()] || String(u || 'ea').toLowerCase().replace(/s$/, ''));
      const key = x => x.item.split(' ').filter(w => w.length > 2 && !/^(?:the|and|for|with|inch|foot|amp|new|old)$/.test(w));
      return walks.map(w => {
        let got;
        try { got = timScopeBuild(w.said, { rejected: [] }).materials.map(m => ({ qty: +m.qty, unit: unit(m.unit), item: item(m.item), raw: m.qty + ' ' + m.unit + ' ' + m.item })); } catch (e) { got = [{ qty: 0, unit: '', item: 'THREW ' + e.message, raw: 'THREW' }]; }
        const want = (w.materials || []).map(m => ({ qty: +m.qty, unit: unit(m.unit), item: item(m.item), raw: m.qty + ' ' + m.unit + ' ' + m.item }));
        const used = new Set(); let exactHits = 0, right = 0; const used2 = new Set();
        want.forEach(x => { const i = got.findIndex((g, j) => !used.has(j) && g.qty === x.qty && g.unit === x.unit && g.item === x.item); if (i >= 0) { used.add(i); exactHits++; } });
        want.forEach(x => { const i = got.findIndex((g, j) => !used2.has(j) && g.qty === x.qty && g.unit === x.unit && (g.item === x.item || key(x).filter(k => g.item.split(' ').includes(k)).length >= Math.min(2, key(x).length))); if (i >= 0) { used2.add(i); right++; } });
        return { id: w.id, got: got.map(g => g.raw), want: want.map(x => x.raw), exact: exactHits === want.length && got.length === want.length, right, of: want.length };
      });
    }, WALKS);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the corpus is there and every walk lists materials', async () => {
    expect(WALKS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(WALKS.map(w => w.id)).size).toBe(WALKS.length);
    for (const w of WALKS) expect(Array.isArray(w.materials) && w.materials.length > 0, w.id).toBe(true);
  });

  test('every list Tim got right stays right', async () => {
    const byId = new Map(results.map(r => [r.id, r]));
    const broke = GATE.ids.filter(id => !byId.get(id) || !byId.get(id).exact)
      .map(id => { const r = byId.get(id); return r ? `${id}\n  want: ${r.want.join(' | ')}\n  got:  ${r.got.join(' | ')}` : `${id}: missing`; });
    expect(broke, 'lists that used to come out right:\n' + broke.join('\n')).toEqual([]);
  });

  test('the share of items Tim gets right does not drop', async () => {
    const right = results.reduce((s, r) => s + r.right, 0), of = results.reduce((s, r) => s + r.of, 0);
    expect(right / of).toBeGreaterThanOrEqual(GATE.itemFloor);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tim materials corpus'); });
});
