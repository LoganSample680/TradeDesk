// @ts-check
/**
 * Code editions: the setting that decides whether the code engine can answer
 * anything at all.
 *
 * The hole this closes: `codeEval` reads `S.codeEditions[family]` and refuses
 * with 'no-edition' when it is missing, and until now NOTHING in the app ever
 * wrote it. Every value in every dataset could have been typed in, checked and
 * signed, and every contractor would still have got silence, because no screen
 * ever asked which edition his inspector enforces. That question cannot be
 * answered for him: five states have no state adoption at all (the city or the
 * county decides) and local amendments beat the state everywhere else.
 *
 * Also covered here: the three code modules are actually loaded by index.html
 * now. They were written, tested and never given a script tag, so the whole
 * subsystem was dark in the real app while its own specs passed.
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');
const { FAKE_NEC, useFakeCodes } = require('./fixtures/code-fake-verified');

/** Boot the app, then set which trade lines the account runs. */
async function boot(page, trades) {
  await mockAllExternal(page);
  // Both modules self-load their dataset file at script time; tests register
  // what they want instead, so the fetch never happens here.
  await page.addInitScript(function () {
    window.__necNoAutoLoad = true;
    window.__plumbNoAutoLoad = true;
  });
  await page.goto('/');
  await waitForAppBoot(page);
  await setTrades(page, trades || ['electrical']);
}

/** Trade lines live on _config, not on S. */
async function setTrades(page, trades) {
  await page.evaluate(function (t) {
    window._config = window._config || {};
    window._config.trade_lines = t;
  }, trades);
}

test.describe('Code editions setting', () => {

  test('the engine and both code modules are loaded by the app', async ({ page }) => {
    await boot(page);
    // The bug this catches: a module with a full spec suite and no script tag.
    const have = await page.evaluate(() => ({
      engine: typeof window.codeEval === 'function',
      nec: typeof window.necRegisterDataset === 'function',
      ipc: typeof window.codeIpcRegister === 'function',
      loadcalc: typeof window.loadcalcEstimate === 'function'
    }));
    expect(have).toEqual({ engine: true, nec: true, ipc: true, loadcalc: true });
  });

  test('with no edition chosen the engine answers nothing and says why', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      if (typeof S !== 'undefined' && S) delete S.codeEditions;
      return codeEval('nec', 'dwelling-load', { sqft: 2200 });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-edition');
    // And it tells the contractor what to do rather than just failing.
    expect(r.warnings.join(' ')).toMatch(/edition your inspector enforces/i);
  });

  test('choosing an edition is what turns the engine on', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => codeEval('nec', 'dwelling-load', { sqft: 2200 }).reason);
    expect(before).toBe('no-edition');

    await useFakeCodes(page);
    const after = await page.evaluate(() => codeEval('nec', 'dwelling-load', { sqft: 2200 }));
    // Whatever it now answers, it is no longer refusing for want of an edition.
    expect(after.reason).not.toBe('no-edition');
    expect(after.edition).toBe('FAKE');
  });

  test('setCodeEdition writes the choice and clearing it puts the engine back to silent', async ({ page }) => {
    await boot(page);
    await useFakeCodes(page);
    await page.evaluate(() => setCodeEdition('nec', 'FAKE'));
    expect(await page.evaluate(() => S.codeEditions.nec)).toBe('FAKE');

    await page.evaluate(() => setCodeEdition('nec', ''));
    const r = await page.evaluate(() => ({
      stored: S.codeEditions.nec,
      reason: codeEval('nec', 'dwelling-load', { sqft: 2200 }).reason
    }));
    expect(r.stored).toBeUndefined();
    expect(r.reason).toBe('no-edition');
  });

  test('the picker offers only the books this account\'s trades use', async ({ page }) => {
    await boot(page, ['painting']);
    // A painter is never asked which electrical code his inspector uses.
    expect(await page.evaluate(() => _codeFamiliesForAccount())).toEqual([]);

    await setTrades(page, ['electrical']);
    expect(await page.evaluate(() => _codeFamiliesForAccount())).toEqual(['nec']);

    await setTrades(page, ['plumbing']);
    expect(await page.evaluate(() => _codeFamiliesForAccount())).toEqual(['ipc', 'upc']);
  });

  test('the screen renders, and says plainly that nothing answers until it is set', async ({ page }) => {
    await boot(page);
    await goPg(page, 'pg-settings');
    await page.evaluate(() => renderSettingsCodes());
    const html = await page.locator('#set-codes-content').innerHTML();
    expect(html).toContain('Electrical');
    // The refusal is the honest default and the copy has to own it.
    expect(html).toMatch(/will not answer/i);
    expect(await page.textContent('#set-idx-codes-sub')).toMatch(/not set/i);
  });

  test('a trade with no code book gets an explanation, not an empty screen', async ({ page }) => {
    await boot(page, ['painting']);
    await goPg(page, 'pg-settings');
    await page.evaluate(() => renderSettingsCodes());
    const html = await page.locator('#set-codes-content').innerHTML();
    expect(html).toMatch(/None of your trades use a code book/i);
  });

  test('the summary line names what is chosen', async ({ page }) => {
    await boot(page);
    await goPg(page, 'pg-settings');
    await useFakeCodes(page);
    await page.evaluate(() => renderSettingsCodes());
    expect(await page.textContent('#set-idx-codes-sub')).toContain('NEC FAKE');
  });

  test('a real shipped dataset stays silent even once its edition is chosen', async ({ page }) => {
    await boot(page);
    // The verified gate is the point of the whole subsystem: picking an edition
    // must never be a way to talk an unchecked dataset into an answer.
    const r = await page.evaluate(() => {
      const unchecked = { family: 'nec', edition: '2023', verified: false, data: {}, rules: {} };
      codeRegister(unchecked);
      S.codeEditions = { nec: '2023' };
      return codeEval('nec', 'dwelling-load', { sqft: 2200 });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unverified');
  });

  test('editions accumulate rather than replace each other', async ({ page }) => {
    await boot(page);
    await useFakeCodes(page);
    const eds = await page.evaluate(() => {
      codeRegister(Object.assign({}, { family: 'nec', edition: 'FAKE2', verified: false, data: {}, rules: {} }));
      return codeEditions('nec');
    });
    // Existing work is judged under the code it was permitted under, so an old
    // edition can never be dropped when a new one lands.
    expect(eds).toContain('FAKE');
    expect(eds).toContain('FAKE2');
  });

  test('the fixture is unmistakably fake', async () => {
    // Guards rule 2 of tests/fixtures/code-fake-verified.js. If somebody ever
    // "improves" these into plausible numbers, this fails and asks why.
    expect(FAKE_NEC.edition).toBe('FAKE');
    expect(FAKE_NEC.verifiedBy).toMatch(/not a person/i);
    const amps = Object.values(FAKE_NEC.data.ampacity.cu).map(r => r[75]);
    expect(amps.every(a => a % 10 === 0)).toBe(true);
  });

  test('no console errors through the whole setting', async ({ page }) => {
    await boot(page);
    await goPg(page, 'pg-settings');
    await useFakeCodes(page);
    await page.evaluate(() => { renderSettingsCodes(); setCodeEdition('nec', 'FAKE'); setCodeEdition('nec', ''); });
    assertNoErrors(page, 'code editions');
  });
});
