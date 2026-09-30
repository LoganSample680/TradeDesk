// @ts-check
/**
 * Tim's answer key, replayed (owner 2026-09-29: "Tim is only going to get
 * smarter the more he's used").
 *
 * tests/fixtures/tim-fixes.json holds real sentences contractors said and
 * what Tim must make of them, most of them added by the nightly retrain from
 * the lines contractors fixed by hand. Every case runs on every push. A rule
 * change that fixes tonight's miss and breaks an old case fails here, which
 * is the whole point: Tim only ever gets better.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const KEY = require('./fixtures/tim-fixes.json');

test.describe('Tim answer key', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the key is well formed: every case has an id, a sentence and something to check', () => {
    const ids = new Set();
    KEY.cases.forEach(c => {
      expect(c.id && !ids.has(c.id), 'unique id ' + c.id).toBeTruthy(); ids.add(c.id);
      expect(typeof c.said === 'string' && c.said.length > 3, c.id).toBe(true);
      expect(!!(c.steps || c.notSteps || c.stepsContain || c.materials), c.id + ' checks something').toBe(true);
    });
  });

  for (const c of KEY.cases) {
    test(c.id, async () => {
      const r = await page.evaluate((said) => ({ steps: timSaySteps(said), mats: timSaidMaterials(said).map(m => m.qty + ' ' + m.unit + ' ' + m.item) }), c.said);
      const all = r.steps.join(' | ');
      (c.steps || []).forEach(s => expect(r.steps, c.id).toContain(s));
      (c.notSteps || []).forEach(s => expect(all, c.id).not.toContain(s));
      (c.stepsContain || []).forEach(s => expect(all.toLowerCase(), c.id).toContain(s.toLowerCase()));
      if (c.materials) expect(r.mats, c.id).toEqual(c.materials);
    });
  }

  test('a fixed line is logged as a fix with what Tim made and what was kept; the same fix twice is one row', async () => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('td_tim_send');
      const a = timLogFix('work', 'Replaced 10 feet of copper pipe with PEX a pipe', 'Replaced 10 feet of copper pipe with PEX-A pipe', 'qi', 'x1');
      const again = timLogFix('work', 'Replaced 10 feet of copper pipe with PEX a pipe', 'Replaced 10 feet of copper pipe with PEX-A pipe', 'qi', 'x1');
      const same = timLogFix('work', 'Did a walk-through', 'Did a walk-through', 'qi', 'x1');
      const q = JSON.parse(localStorage.getItem('td_tim_send') || '[]').filter(x => x.kind === 'fix');
      return { a: a && a.made, again, same, n: q.length };
    });
    expect(r.a).toEqual({ field: 'work', tim: 'Replaced 10 feet of copper pipe with PEX a pipe', kept: 'Replaced 10 feet of copper pipe with PEX-A pipe' });
    expect(r.again).toBeNull();
    expect(r.same).toBeNull();
    expect(r.n).toBe(1);
  });

  test('no console errors', async () => { assertNoErrors(page, 'tim answer key'); });
});
