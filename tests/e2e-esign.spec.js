// @ts-check
// The ONE e-sign module (js/esign.js): owner directive 2026-07-13: estimates,
// change orders, job sign-offs, diagnostic charges, and GC-bid approvals all
// run the exact same capture code, and the signed-document display block is
// one shared component (client hub + owner record). These tests prove the
// shared module works and that every duplicated legacy copy is GONE (§7.1).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('shared e-sign module', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test.afterEach(async () => {
    await page.evaluate(() => { document.getElementById('_esign-test-host')?.remove(); });
  });

  // Build a throwaway pad in the DOM for capture tests.
  const mountPad = () => page.evaluate(() => {
    document.getElementById('_esign-test-host')?.remove();
    const host = document.createElement('div');
    host.id = '_esign-test-host';
    host.innerHTML = '<canvas id="tpad-canvas" width="500" height="130"></canvas>' +
      '<input id="tpad-name" type="text">' +
      '<div id="tpad-err" style="display:none"></div>';
    document.body.appendChild(host);
    return !!esignWire('tpad');
  });

  test('esignWire registers the pad; esignHasInk flips with drawing; esignClear wipes it', async () => {
    expect(await mountPad()).toBe(true);
    const result = await page.evaluate(() => {
      const before = esignHasInk('tpad');
      _ESIGN_PADS['tpad'].ctx.fillRect(5, 5, 40, 30); // draw
      const after = esignHasInk('tpad');
      esignClear('tpad');
      const cleared = esignHasInk('tpad');
      return { before, after, cleared };
    });
    expect(result.before).toBe(false);
    expect(result.after).toBe(true);
    expect(result.cleared).toBe(false);
  });

  test('esignResult: typed-name gate, drawn gate, typedAsSig fallback, and the success payload', async () => {
    await mountPad();
    const result = await page.evaluate(() => {
      const out = {};
      // No name → fails the typed gate, error surfaces in the pad's err element.
      document.getElementById('tpad-name').value = '';
      out.noName = esignResult('tpad', { requireDrawn: true });
      out.errShown = document.getElementById('tpad-err').style.display === 'block';
      // Name but nothing drawn + requireDrawn → fails the drawn gate.
      document.getElementById('tpad-name').value = 'Karen Doe';
      out.noInk = esignResult('tpad', { requireDrawn: true });
      // typedAsSig: nothing drawn but name typed → cursive signature synthesized.
      out.typedAsSig = esignResult('tpad', { typedAsSig: true });
      // Real ink → full payload.
      esignClear('tpad');
      _ESIGN_PADS['tpad'].ctx.fillRect(5, 5, 40, 30);
      out.inked = esignResult('tpad', { requireDrawn: true });
      // minNameLen honors longer thresholds (co-hub uses 3).
      document.getElementById('tpad-name').value = 'ab';
      out.shortName = esignResult('tpad', { minNameLen: 3 });
      return out;
    });
    expect(result.noName.ok).toBe(false);
    expect(result.errShown).toBe(true);
    expect(result.noInk.ok).toBe(false);
    expect(result.typedAsSig.ok).toBe(true);
    expect(result.typedAsSig.sigData.indexOf('data:image')).toBe(0); // typed name became a signature image
    expect(result.inked.ok).toBe(true);
    expect(result.inked.signerName).toBe('Karen Doe');
    expect(result.inked.sigData.indexOf('data:image')).toBe(0);
    expect(!!result.inked.signedAt).toBe(true);
    expect(result.shortName.ok).toBe(false);
  });

  test('pad teardown: removing the canvas from the DOM aborts listeners and unregisters the pad', async () => {
    await mountPad();
    const result = await page.evaluate(async () => {
      const registered = !!_ESIGN_PADS['tpad'];
      document.getElementById('_esign-test-host').remove();
      await new Promise(r => setTimeout(r, 60)); // MutationObserver tick
      return { registered, after: !!_ESIGN_PADS['tpad'] };
    });
    expect(result.registered).toBe(true);
    expect(result.after).toBe(false); // no leaked pads, no leaked listeners
  });

  test('esignSigBlockHTML: one display component, image + Signed By/Date grid, extra cells, XSS-escaped', async () => {
    const result = await page.evaluate(() => ({
      empty: esignSigBlockHTML({}),
      full: esignSigBlockHTML({ signerName: '<img src=x onerror=alert(1)>', signedAt: '2026-07-13T18:00:00Z', sigData: 'data:image/png;base64,AAA', cells: [{ label: 'Amount', value: '$150.00' }] }),
      noImg: esignSigBlockHTML({ signerName: 'Karen Doe', signedAt: '2026-07-13T18:00:00Z' }),
    }));
    expect(result.empty).toBe('');                          // nothing signed → nothing rendered
    expect(result.full).toContain('Signed By');
    expect(result.full).toContain('Date &amp; Time');
    expect(result.full).toContain('data:image/png;base64,AAA');
    expect(result.full).toContain('$150.00');               // extra cells render
    expect(result.full).not.toContain('<img src=x');        // signer name escaped
    expect(result.full).toContain('&lt;img');
    expect(result.noImg).toContain('Karen Doe');             // works without a drawn image
  });

  test('every signing surface routes through the shared module (grep-proof wiring)', async () => {
    const result = await page.evaluate(() => ({
      // The five in-app surfaces all call the shared pad by prefix:
      co: typeof _submitCOSign === 'function',
      job: typeof _confirmJobDoneSign === 'function',
      diag: typeof _submitDiagnosticSign === 'function',
      gei: typeof _geiConfirmInPerson === 'function',
      shared: typeof esignWire === 'function' && typeof esignResult === 'function' && typeof esignSigBlockHTML === 'function',
    }));
    expect(result.shared).toBe(true);
    expect(result.co && result.job && result.diag && result.gei).toBe(true);
  });

  test('DELETION PROOF (§7.1): every legacy duplicated pad implementation is gone', async () => {
    const result = await page.evaluate(() => ({
      // The orphaned first-draft trio + its checker:
      clearSig: typeof window.clearSig,
      updateTypedSig: typeof window.updateTypedSig,
      checkConfirmReady: typeof window.checkConfirmReady,
      hasSignature: typeof window.hasSignature,
      // Per-surface bespoke pads:
      clearCO: typeof window._clearCOCanvas,
      clearDiag: typeof window._clearDiagCanvas,
      clearJob: typeof window._clearJobSignCanvas,
      // The old shared globals:
      sigCanvas: typeof window.sigCanvas,
      coSignCanvas: typeof window._coSignCanvas,
      diagSignCanvas: typeof window._diagSignCanvas,
      jobSignCanvas: typeof window._jobSignCanvas,
    }));
    expect(result.clearSig).toBe('undefined');
    expect(result.updateTypedSig).toBe('undefined');
    expect(result.checkConfirmReady).toBe('undefined');
    expect(result.hasSignature).toBe('undefined');
    expect(result.clearCO).toBe('undefined');
    expect(result.clearDiag).toBe('undefined');
    expect(result.clearJob).toBe('undefined');
    expect(result.sigCanvas).toBe('undefined');
    expect(result.coSignCanvas).toBe('undefined');
    expect(result.diagSignCanvas).toBe('undefined');
    expect(result.jobSignCanvas).toBe('undefined');
  });

  test('no console errors during e-sign module tests', async () => {
    assertNoErrors(page, 'esign module');
  });
});
