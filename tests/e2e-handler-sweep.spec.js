// @ts-check
/**
 * HANDLER SWEEP — the fence against "a wired control throws on click and nobody
 * ever clicked it in a test." (See the Stripe Integrations "Manage" bug: an
 * inline onclick called a render fn with the wrong args → uncaught TypeError,
 * toasted in prod, invisible to tests because no test fired the real control.)
 *
 * The error NET is already complete — helpers.js hooks BOTH page.on('console')
 * and page.on('pageerror'), so any synchronous throw from a handler is caught.
 * What was missing was COVERAGE: nothing physically fired the control. This spec
 * closes that by walking the REAL DOM of every page + settings panel and firing
 * every VISIBLE wired control (onclick/onchange/onsubmit), asserting zero console
 * errors after each.
 *
 * It is DATA-DRIVEN from the live DOM, so it cannot fall behind: the moment
 * someone adds `<button onclick="foo()">`, the sweep clicks it. A throw here is a
 * real robustness gap (§12.1: a function called with its target absent / no args
 * must not throw), fixed at the ROOT, never by widening the skip-list.
 *
 * ISOLATION: a fired control may legitimately navigate/reload the app (a whole
 * different concern from a console error). So the sweep boots FRESH per screen
 * and re-verifies the app is loaded before every control — if a prior control
 * unloaded the page, it reboots and carries on with the NEXT control rather than
 * cascading a "goPg is undefined" failure into every later screen.
 */

const { test, expect, mockAllExternal, waitForAppBoot, goPg } = require('./helpers');

// Only skip controls that NAVIGATE away, redirect externally, sign out, or
// DESTROY data — a blind click on those is unsafe / leaves the screen. Anything
// that merely reveals a panel, toggles a setting, or opens an in-app modal MUST
// survive a click clean and is intentionally NOT skipped (that is the bug class
// we are fencing — _openStripeConnect reveals a panel and used to throw).
const SKIP = /goPg|goBack|goHome|goDash|navTo|switchPg|signOut|signout|logout|logOut|reload|supaShowLogin|showLogin|window\.open|location\s*[.=]|\.href|openUrl|mailto|tel:|delete[A-Z]|remove[A-Z]|wipe|clearData|clearAll|clearAllData|factoryReset|resetApp|eraseAll|export|downloadPdf|printProposal|window\.print|\.submit\(\s*\)/;

// Mirror of helpers.assertNoErrors's environmental-noise filter (network/CDN
// chatter that is not a code defect). Kept in sync deliberately.
function realErrors(list) {
  return (list || []).filter(e =>
    !e.includes('favicon') &&
    !e.includes('net::ERR') &&
    !e.includes('ERR_CONNECTION') &&
    !e.includes('Failed to load resource') &&
    !e.includes('checkNew') &&
    !e.includes('apple-mapkit') &&
    !e.includes('cdn.apple-mapkit') &&
    !e.includes('js.stripe.com') &&
    !e.includes('cdn.jsdelivr') &&
    !e.includes('AggregateError') &&
    !e.includes('JSON Parse error') &&
    !e.includes('Unhandled Promise Rejection')
  );
}

// "Booted" must mean FULLY loaded, not just navigation.js present. A fired
// control can reload the app; on the next tick window.goPg (navigation.js) exists
// while settings.js has not finished loading yet, so goPg('pg-settings') would
// throw `buildScopeDefaultsUI is not defined`. Require a settings.js symbol AND
// the booted-dashboard marker so we never navigate into a half-loaded page.
async function isBooted(page) {
  return page.evaluate(() =>
    typeof window.goPg === 'function' &&
    typeof window.buildScopeDefaultsUI === 'function' &&
    !!document.querySelector('#dash-greet')
  ).catch(() => false);
}

// Full reboot — a clean slate (used at the start of each screen, and to recover
// if a fired control navigated/reloaded the app out from under us).
async function bootFresh(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
}

// Fire the i-th visible, non-skipped wired control in the currently-open screen.
// Returns {done} once i is past the control count, else {handler}. A synchronous
// throw from the handler is reported to window.onerror (→ page.on('pageerror'))
// and does NOT propagate out of .click()/dispatchEvent, so we read the error
// buffer from Node after a tick rather than catching here. A navigation kicked
// off by the click destroys the execution context — caught and treated as "not a
// console error", the next iteration reboots.
async function fireNthControl(page, i, container) {
  return page.evaluate(({ idx, skipSrc, sel }) => {
    const skip = new RegExp(skipSrc);
    const root = (sel && document.querySelector(sel)) || document;
    const els = Array.from(root.querySelectorAll('[onclick],[onchange],[onsubmit]')).filter(el => {
      const vis = el.offsetParent !== null || el.getClientRects().length > 0;
      if (!vis) return false;
      const h = el.getAttribute('onclick') || el.getAttribute('onchange') || el.getAttribute('onsubmit') || '';
      return !skip.test(h);
    });
    if (idx >= els.length) return { done: true, total: els.length };
    const el = els[idx];
    const handler = el.getAttribute('onclick') || el.getAttribute('onchange') || el.getAttribute('onsubmit') || '';
    const evt = el.hasAttribute('onclick') ? 'click' : (el.hasAttribute('onchange') ? 'change' : 'submit');
    if (evt === 'click') el.click();
    else el.dispatchEvent(new Event(evt, { bubbles: true }));
    return { done: false, handler, tag: el.tagName, total: els.length };
  }, { idx: i, skipSrc: SKIP.source, sel: container || null })
    .catch(() => ({ done: false, handler: '(navigated)', tag: '', total: 0 }));
}

// gotoScreen: cheap navigation to the target screen, assuming the app is booted.
async function sweepScreen(page, label, gotoScreen, container) {
  const failures = [];
  const HARD_CAP = 60; // safety bound; no screen wires this many controls
  await bootFresh(page); // clean state per screen (state can't leak in from a prior screen)
  for (let i = 0; i < HARD_CAP; i++) {
    if (!(await isBooted(page))) await bootFresh(page); // a prior control navigated — recover
    await gotoScreen();
    await page.waitForTimeout(160);
    page._consoleErrors.length = 0;    // reset the net
    const r = await fireNthControl(page, i, container);
    if (r.done) break;
    await page.waitForTimeout(140);    // let pageerror/console flush to Node
    const errs = realErrors(page._consoleErrors);
    if (errs.length) failures.push(`"${r.handler}" (${r.tag}) → ${errs.join(' | ')}`);
  }
  return failures;
}

const SETTINGS_KEYS = ['about', 'biz', 'branding', 'cloud', 'data', 'dev',
  'integrations', 'legal', 'notifications', 'rates', 'taxes', 'trades'];

const PAGES = ['pg-dash', 'pg-leads', 'pg-clients', 'pg-proposals', 'pg-jobs',
  'pg-schedule', 'pg-money', 'pg-taxes', 'pg-tracker', 'pg-licensing',
  'pg-contracts', 'pg-gallery', 'pg-team', 'pg-dispatch', 'pg-checklist',
  'pg-cal', 'pg-settings'];

test.describe('handler sweep — settings panels', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  for (const key of SETTINGS_KEYS) {
    test(`every wired control in settings/${key} fires without a console error`, async () => {
      const gotoScreen = async () => {
        await goPg(page, 'pg-settings');
        await page.evaluate(k => { try { window._openSetDetail(k); } catch (e) {} }, key);
      };
      const failures = await sweepScreen(page, `settings/${key}`, gotoScreen, `#setd-${key}`);
      expect(failures, `settings/${key} controls that threw:\n${failures.join('\n')}`).toEqual([]);
    });
  }
});

test.describe('handler sweep — pages', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  for (const pg of PAGES) {
    test(`every wired control on ${pg} fires without a console error`, async () => {
      const gotoScreen = async () => { await goPg(page, pg); };
      const failures = await sweepScreen(page, pg, gotoScreen, '.pg.active');
      expect(failures, `${pg} controls that threw:\n${failures.join('\n')}`).toEqual([]);
    });
  }
});
