// @ts-check
// Observability/telemetry: the analytics + console-error capture layer.
// HARD RULE under test: observability is INERT on localhost (the test origin),
// so it can never add load, noise, or console-wrapping during any test run,
// and the app must tolerate its absence everywhere it's referenced.
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Telemetry layer', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('observability is inert on localhost, no _obs, no console.error wrapper', async () => {
    const r = await page.evaluate(() => ({
      obs: typeof window._obs,
      // Native console.error must be untouched on the test origin so Playwright's
      // console listeners and assertNoErrors see the real thing.
      consoleNative: String(console.error).includes('[native code]'),
    }));
    expect(r.obs).toBe('undefined');
    expect(r.consoleNative).toBe(true);
  });

  test('goPg page-view hook tolerates absent _obs (navigation still works)', async () => {
    await goPg(page, 'pg-team');
    const active = await page.evaluate(() => document.querySelector('.pg.active')?.id);
    expect(active).toBe('pg-team');
    await goPg(page, 'pg-dash');
    assertNoErrors(page, 'goPg with no _obs');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  ERROR-CAPTURE POLICY, regression for live errors 37 + 38 (hotfix lane)
//
//  37: "[MapKit] Initialization failed because the server returned error 503"
//     , Apple's own library logging Apple's own outage. The app already
//      degrades (Photon geocoding fallback); paging the hotfix lane for a
//      third-party 503 is a capture-policy bug, not an app bug.
//  38: "{}", console.error(object) serialized through bare JSON.stringify,
//      which yields "{}" for Errors/events/non-enumerable props. A report with
//      zero content can never be root-caused and re-pages the lane forever.
//
//  Observability is deliberately INERT on localhost, so these tests load the
//  real source into a Node sandbox with a production hostname and drive the
//  console hook directly. Every capture path is exercised against the actual
//  shipped file, not a copy of its logic.
// ════════════════════════════════════════════════════════════════════════════

test.describe('observability error-capture policy (Node sandbox on real source)', () => {
  const fs = require('fs');
  const path = require('path');

  function loadSandbox() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'observability.js'), 'utf8');
    const invocations = [];
    const thenable = { then() { return thenable; } };
    const consoleObj = { error() {}, log() {}, warn() {} };
    const windowObj = { addEventListener() {}, open() {} };
    const documentObj = { addEventListener() {}, querySelector: () => null, body: {}, visibilityState: 'visible' };
    const locationObj = { hostname: 'tradedeskpro.app', href: 'https://tradedeskpro.app/' };
    const supa = { functions: { invoke: (name, opts) => { invocations.push({ name, body: opts && opts.body }); return thenable; } } };
    const run = new Function(
      'window', 'location', 'document', 'console', 'performance',
      'setInterval', 'setTimeout', 'MutationObserver', 'XMLHttpRequest',
      '_supa', '_supaUser',
      src
    );
    run(
      windowObj, locationObj, documentObj, consoleObj,
      { now: () => 1234 },
      () => 0, () => 0,
      function () { return { observe() {}, disconnect() {} }; },
      function XMLHttpRequestStub() {},
      supa, { id: 'obs-test-user' }
    );
    return { consoleObj, invocations, windowObj };
  }

  test('sandbox installs the hooks (console wrapper + _obs) under a production hostname', () => {
    const { consoleObj, windowObj } = loadSandbox();
    expect(String(consoleObj.error)).not.toContain('error() {}'); // wrapped, not the stub
    expect(typeof windowObj._obs).toBe('object');
    expect(typeof windowObj._obs.error).toBe('function');
  });

  test('regression #37: MapKit transient 503 outage is NOT reported to error_log', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('[MapKit] Initialization failed because the server returned error 503 (Network Unavailable).');
    expect(invocations.length).toBe(0);
  });

  test('MapKit auth/token failures STILL report, the filter is outage-narrow, ours to fix stays ours', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('[MapKit] Initialization failed because the authorization token is invalid.');
    expect(invocations.length).toBe(1);
    expect(invocations[0].body.errors[0].message).toContain('authorization token');
  });

  test('regression #38: contentless "{}" reports are dropped, nothing to root-cause, never page the lane', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error({});
    expect(invocations.length).toBe(0);
  });

  test('objects with real content now serialize usefully instead of "{}"', () => {
    const { consoleObj, invocations } = loadSandbox();
    const err = new Error('boom in estimate calc');
    consoleObj.error(err);
    consoleObj.error({ message: 'nested failure detail' });
    expect(invocations.length).toBe(2);
    expect(invocations[0].body.errors[0].message).toContain('boom in estimate calc');
    expect(invocations[1].body.errors[0].message).toContain('nested failure detail');
  });

  test('plain string errors still report, and dedup still holds (one report per message)', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('real app failure on pg-est');
    consoleObj.error('real app failure on pg-est');
    expect(invocations.length).toBe(1);
    expect(invocations[0].body.errors[0].message).toContain('real app failure on pg-est');
  });

  // Hotfix (error_log 64,65): "ResizeObserver loop completed with undelivered
  // notifications" is a well-documented browser-internal race in the
  // ResizeObserver spec itself (fires whenever an observed element's own
  // resize handler triggers another resize within the same frame), not an
  // application bug. There is no app-code fix, every ResizeObserver user sees
  // it. Filtered at the shared _logError sink (same one both the console.error
  // wrapper and window's 'error'/'unhandledrejection' listeners call), so this
  // single test proves the filter for every capture path at once.
  test('regression #64/65: ResizeObserver loop noise is NOT reported to error_log', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('ResizeObserver loop completed with undelivered notifications.');
    expect(invocations.length).toBe(0);
  });

  test('the older "ResizeObserver loop limit exceeded" wording is also filtered', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('ResizeObserver loop limit exceeded');
    expect(invocations.length).toBe(0);
  });

  test('the ResizeObserver filter is narrow: unrelated messages mentioning it still report', () => {
    const { consoleObj, invocations } = loadSandbox();
    consoleObj.error('Failed to construct ResizeObserver: callback is not a function');
    expect(invocations.length).toBe(1);
    expect(invocations[0].body.errors[0].message).toContain('Failed to construct ResizeObserver');
  });
});
