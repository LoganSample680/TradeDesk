// @ts-check
/**
 * tools/code-entry.html: the thing that turns a purchased code book into a
 * dataset without anyone hand-editing JSON.
 *
 * It is a dev tool, not app surface, but it is the ONLY writer of the values
 * codeEval will one day answer permits from, so a defect here is a wrong
 * ampacity with a licensed name signed under it. That earns a spec.
 *
 * The case that already bit, and the reason this file exists: box sizes are
 * keyed "device-3x2x2.25" and "square-4.6875x1.25". A dot-joined path splits
 * those into segments that address nothing, so the first build silently
 * invented 13 new keys instead of filling the 13 real ones, and reported them
 * as already done. Paths are segment arrays now. The first test is that.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const TOOL = 'file://' + path.resolve(__dirname, '..', 'tools', 'code-entry.html');
const NEC = path.resolve(__dirname, '..', 'codes', 'nec-2023.json');
const IPC = path.resolve(__dirname, '..', 'codes', 'ipc-2021.json');

/** Open the tool with a dataset loaded and a clean localStorage. */
async function boot(page, file) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(TOOL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(TOOL);
  await page.setInputFiles('#file', file || NEC);
  await page.waitForSelector('#app:not([hidden])');
  return errors;
}

/** Put the cursor on a named slot, wherever it has moved to. */
async function slot(page, path) {
  await page.evaluate(p => {
    const i = FLAT.findIndex(f => f.path === p);
    if (i < 0) throw new Error('no slot ' + p);
    CUR = i; GRP = FLAT[i].group; render();
  }, path);
}

/** Type a value into the current field and commit it. */
async function enter(page, value) {
  await page.fill('#inp', value);
  await page.press('#inp', 'Enter');
}

test.describe('Code value entry tool', () => {

  test('a key containing a dot is filled in place, not forked into a new key', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => Object.keys(DOC.data.boxVolumeCuIn));
    expect(before).toContain('device-3x2x2.25');

    await page.click('.grp:has-text("boxVolumeCuIn")');
    await page.click('#rows tr:nth-child(2)');
    expect(await page.textContent('.path')).toBe('data.boxVolumeCuIn.device-3x2x2.25');
    await enter(page, '14');

    const after = await page.evaluate(() => DOC.data.boxVolumeCuIn);
    // Same key count: nothing was invented.
    expect(Object.keys(after).length).toBe(before.length);
    expect(after['device-3x2x2.25']).toBe(14);
    // And the neighbour that differs only by the dot is untouched.
    expect(after['device-3x2x2']).toBe(null);
  });

  test('a fresh dataset reports every value as unfilled', async ({ page }) => {
    await boot(page);
    // The dot bug made 13 leaves read as already done. Zero is the only right answer.
    // A grow slot is an empty table, which is not null and is not filled either,
    // so it is excluded here exactly as the progress counter excludes it.
    const n = await page.evaluate(() => FLAT.filter(f => !f.grow && getAt(f.seg) !== null).length);
    expect(n).toBe(0);
    expect(await page.textContent('#which')).toContain('0 of');
  });

  test('an empty table is grown from the row shape its own todo line declares', async ({ page }) => {
    await boot(page);
    // Table 310.15(B)(1) ships as an empty array, and nothing can be typed into
    // one. Its todo line says "rows {minC, maxC, f60, f75, f90}", so the tool
    // takes the fields from the file rather than from anything it knows.
    const i = await page.evaluate(() => FLAT.findIndex(f => f.path === 'data.tempCorrectionRows'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(n => FLAT[n].grow, i)).toBe('array');

    await page.evaluate(n => { CUR = n; GRP = FLAT[n].group; render(); }, i);
    await expect(page.locator('#grow')).toBeVisible();

    const before = await page.evaluate(() => FLAT.length);
    await page.click('#grow');
    const after = await page.evaluate(() => ({ rows: DOC.data.tempCorrectionRows, flat: FLAT.length }));
    expect(after.rows.length).toBe(1);
    expect(Object.keys(after.rows[0]).sort()).toEqual(['f60', 'f75', 'f90', 'maxC', 'minC']);
    // The new fields are blanks, never zeros.
    expect(Object.values(after.rows[0]).every(v => v === null)).toBe(true);
    expect(after.flat).toBeGreaterThan(before);
  });

  test('a table whose shape the file does not declare asks instead of guessing', async ({ page }) => {
    await boot(page);
    // Table 220.55's todo line names the table but not its columns. Inventing
    // them is exactly the failure this whole subsystem exists to prevent, so
    // the tool asks for the field names and adds nothing until it has them.
    const i = await page.evaluate(() => FLAT.findIndex(f => f.path === 'data.dwelling.cooking.colARows'));
    await page.evaluate(n => { CUR = n; GRP = FLAT[n].group; render(); }, i);
    await expect(page.locator('#inp')).toBeVisible();

    await page.click('#grow');
    expect(await page.evaluate(() => DOC.data.dwelling.cooking.colARows.length)).toBe(0);

    await page.fill('#inp', 'kw, pct');
    await page.click('#grow');
    const rows = await page.evaluate(() => DOC.data.dwelling.cooking.colARows);
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0])).toEqual(['kw', 'pct']);
  });

  test('a row added by mistake can be taken back off', async ({ page }) => {
    await boot(page);
    await slot(page, 'data.tempCorrectionRows');
    await page.click('#grow');
    await slot(page, 'data.tempCorrectionRows');
    await page.click('#grow');
    expect(await page.evaluate(() => DOC.data.tempCorrectionRows.length)).toBe(2);

    await slot(page, 'data.tempCorrectionRows');
    await page.click('#ungrow');
    await page.click('#ungrow');
    expect(await page.evaluate(() => DOC.data.tempCorrectionRows.length)).toBe(0);
    // And the slot survives its own table emptying out, or the table could
    // never be started again.
    expect(await page.evaluate(() => FLAT.some(f => f.path === 'data.tempCorrectionRows'))).toBe(true);
  });

  test('adding a row lands on that row, so the next thing typed is the row', async ({ page }) => {
    await boot(page);
    await slot(page, 'data.tempCorrectionRows');
    await page.click('#grow');
    // Not back on the slot: on the first blank of the row just created.
    expect(await page.textContent('.path')).toBe('data.tempCorrectionRows.0.minC');
    await enter(page, '21');
    expect(await page.evaluate(() => DOC.data.tempCorrectionRows[0].minC)).toBe(21);
  });

  test('an open map takes the keys the book prints, not keys the tool guessed', async ({ page }) => {
    await boot(page, IPC);
    // vent rows carry maxLengthFtByVentSize, whose keys are vent sizes: the book
    // decides them, so the tool must not pretend to know them.
    const i = await page.evaluate(() => FLAT.findIndex(f => f.path === 'vent.table'));
    await page.evaluate(n => { CUR = n; GRP = FLAT[n].group; render(); }, i);
    await page.click('#grow');
    const open = await page.evaluate(() => FLAT.find(f => f.grow === 'object' && f.path.indexOf('vent.table.0') === 0));
    expect(open).toBeTruthy();
    await page.evaluate(p => { CUR = FLAT.findIndex(f => f.path === p); render(); }, open.path);
    await page.fill('#inp', '1.5');
    await page.click('#grow');
    const map = await page.evaluate(() => DOC.vent.table[0].maxLengthFtByVentSize);
    expect(map).toEqual({ '1.5': null });
  });

  test('every null leaf in the file is reachable in the tool', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      let leaves = 0;
      (function walk(n) {
        if (n === null || typeof n !== 'object') { leaves++; return; }
        if (Array.isArray(n)) { n.forEach(walk); return; }
        Object.keys(n).forEach(k => walk(n[k]));
      })(DOC.data);
      return { leaves, flat: FLAT.length, grow: FLAT.filter(f => f.grow).length, groups: GROUPS.length };
    });
    // Every leaf is null in a fresh dataset, so the counts agree once the grow
    // slots are set aside: an empty table holds no leaves but is still one thing
    // the tool has to offer.
    expect(r.flat - r.grow).toBe(r.leaves);
    expect(r.grow).toBeGreaterThan(0);
    expect(r.groups).toBeGreaterThan(0);
  });

  test('a blank entry stays null rather than becoming zero', async ({ page }) => {
    await boot(page);
    await page.click('.grp:has-text("ampacity")');
    await enter(page, '20');
    expect(await page.evaluate(() => getAt(FLAT[CUR - 1] ? FLAT[CUR - 1].seg : []))).toBe(20);

    await page.click('#rows tr:first-child');
    await enter(page, '');
    // Null, not 0. A zero ampacity would compute; a null refuses.
    const v = await page.evaluate(() => DOC.data.ampacity.cu['1']['60']);
    expect(v).toBe(null);
  });

  test('a non-numeric value is kept verbatim, a numeric one becomes a number', async ({ page }) => {
    await boot(page);
    await page.click('.grp:has-text("ampacity")');
    await enter(page, '12.5');
    await page.click('#rows tr:nth-child(2)');
    await enter(page, '1/0');
    const r = await page.evaluate(() => [DOC.data.ampacity.cu['1']['60'], DOC.data.ampacity.cu['1']['75']]);
    expect(r[0]).toBe(12.5);
    expect(typeof r[0]).toBe('number');
    expect(r[1]).toBe('1/0');
  });

  test('each leaf carries the citation its own todo line names', async ({ page }) => {
    await boot(page);
    // 220.41 is the general lighting line. The tool must derive it from the
    // file, never from anything typed into the tool.
    expect(await page.textContent('.cite')).toBe('220.41');
    expect(await page.textContent('.path')).toBe('data.dwelling.generalLightingVaPerSqft');

    await page.click('.grp:has-text("ampacity")');
    expect(await page.textContent('.cite')).toContain('310.16');
  });

  test('all but a handful of values name the section they come from', async ({ page }) => {
    await boot(page);
    // Whoever types this is holding the book and needs to know which table to
    // turn to. A citation regex that quietly stops matching one family of paths
    // costs them nothing visible and hours of hunting: 796 conduit-fill values
    // lost theirs to a pattern that required a leading digit, and "Chapter 9
    // Table 4" does not have one.
    const r = await page.evaluate(() => {
      const vals = FLAT.filter(f => !f.grow);
      return { total: vals.length, cited: vals.filter(f => citeFor(f.seg).cite).length };
    });
    expect(r.total - r.cited).toBeLessThanOrEqual(5);
  });

  test('a leaf reads as its coordinate in the book, not as a JSON path', async ({ page }) => {
    await boot(page);
    await page.click('.grp:has-text("ampacity")');
    const label = await page.textContent('.lbl');
    expect(label).toContain('Copper');
    expect(label).toContain('AWG');
    expect(label).toContain('°C');
  });

  test('signing requires a name and records it with the date', async ({ page }) => {
    await boot(page);
    page.on('dialog', d => d.dismiss());
    await page.click('#sign');
    expect(await page.evaluate(() => DOC.verified)).toBe(false);

    await page.fill('#sn', 'Dana Reyes');
    await page.fill('#sl', 'KS-4417');
    await page.fill('#sd', '2026-09-07');
    await page.click('#sign');
    const r = await page.evaluate(() => ({ v: DOC.verified, by: DOC.verifiedBy, at: DOC.verifiedAt }));
    expect(r.v).toBe(true);
    expect(r.by).toBe('Dana Reyes (KS-4417)');
    expect(r.at).toBe('2026-09-07');
  });

  test('signing a partly filled file says so instead of hiding it', async ({ page }) => {
    await boot(page);
    await page.fill('#sn', 'Dana Reyes');
    await page.click('#sign');
    // Allowed, because every rule needing a null leaf refuses by name. But the
    // tool must never let it happen quietly.
    await expect(page.locator('#warn')).toBeVisible();
    expect(await page.textContent('#warn')).toMatch(/still blank/i);
  });

  test('the plumbing dataset loads on the same shape as the electrical one', async ({ page }) => {
    await boot(page, IPC);
    expect(await page.textContent('#which')).toContain('IPC 2021');
    const n = await page.evaluate(() => FLAT.length);
    expect(n).toBeGreaterThan(0);
  });

  test('a file with no family and edition is refused', async ({ page }) => {
    await boot(page);
    const msgs = [];
    page.on('dialog', d => { msgs.push(d.message()); d.dismiss(); });
    await page.evaluate(() => load('{"hello":"world"}'));
    expect(msgs.join(' ')).toMatch(/family and edition/i);
    // The good dataset is still loaded, not replaced by junk.
    expect(await page.evaluate(() => DOC.family)).toBe('nec');
  });

  test('invalid JSON is refused without breaking the page', async ({ page }) => {
    const errors = await boot(page);
    page.on('dialog', d => d.dismiss());
    await page.evaluate(() => load('{not json{{'));
    expect(await page.evaluate(() => DOC.family)).toBe('nec');
    expect(errors).toEqual([]);
  });

  test('no console errors through a full entry pass', async ({ page }) => {
    const errors = await boot(page);
    await page.click('.grp:has-text("ampacity")');
    for (const v of ['20', '25', '30', '', '35']) await enter(page, v);
    await page.click('.grp:has-text("dwelling")');
    await enter(page, '3');
    await page.fill('#sn', 'Dana Reyes');
    await page.click('#sign');
    expect(errors).toEqual([]);
  });
});
