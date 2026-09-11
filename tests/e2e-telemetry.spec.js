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

  // The listener capture and the clock are ADDITIVE: every field this returned
  // before it returned still means the same thing, so the error-policy tests
  // below are untouched by the interaction tests above them.
  function loadSandbox() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'observability.js'), 'utf8');
    const invocations = [];
    const listeners = { window: {}, document: {} };
    const thenable = { then() { return thenable; } };
    const consoleObj = { error() {}, log() {}, warn() {} };
    const windowObj = { addEventListener(t, f) { (listeners.window[t] ||= []).push(f); }, open() {} };
    const documentObj = {
      addEventListener(t, f) { (listeners.document[t] ||= []).push(f); },
      querySelector: () => null, body: {}, visibilityState: 'visible',
    };
    const locationObj = { hostname: 'tradedeskpro.app', href: 'https://tradedeskpro.app/' };
    const supa = { functions: { invoke: (name, opts) => { invocations.push({ name, body: opts && opts.body }); return thenable; } } };
    // A controllable clock. Dwell is arithmetic on Date.now(), so a test that
    // let the wall clock decide would assert on whatever the runner took to
    // get there (CLAUDE.md 5.2.2: never let the clock decide an outcome).
    let nowMs = 1_700_000_000_000;
    const DateStub = function () { return new Date(nowMs); };
    DateStub.now = () => nowMs;
    const run = new Function(
      'window', 'location', 'document', 'console', 'performance',
      'setInterval', 'setTimeout', 'MutationObserver', 'XMLHttpRequest',
      '_supa', '_supaUser', 'Date',
      src
    );
    run(
      windowObj, locationObj, documentObj, consoleObj,
      { now: () => 1234 },
      () => 0, () => 0,
      function () { return { observe() {}, disconnect() {} }; },
      function XMLHttpRequestStub() {},
      supa, { id: 'obs-test-user' }, DateStub
    );
    const fire = (target, type, ev) => (listeners[target][type] || []).forEach((f) => f(ev));
    return {
      consoleObj, invocations, windowObj, documentObj, listeners, fire,
      advance: (ms) => { nowMs += ms; },
      // A click on a control shaped the way the app's controls are shaped.
      click: (el) => fire('document', 'click', { target: { closest: () => el } }),
      lastEvents: () => {
        for (let i = invocations.length - 1; i >= 0; i--) {
          if (invocations[i].body && invocations[i].body.events) return invocations[i].body.events;
        }
        return null;
      },
    };
  }

  test('sandbox installs the hooks (console wrapper + _obs) under a production hostname', () => {
    const { consoleObj, windowObj } = loadSandbox();
    expect(String(consoleObj.error)).not.toContain('error() {}'); // wrapped, not the stub
    expect(typeof windowObj._obs).toBe('object');
    expect(typeof windowObj._obs.error).toBe('function');
  });

  // ── Who is driving the app (owner 2026-09-10) ────────────────────────────
  // The flow suite drives the DEPLOYED app with a real login, so its steps
  // reach ingest-telemetry exactly like a contractor's taps do. Of the
  // seventeen event kinds in analytics_events on the day this was written, the
  // three highest-volume were the test harness, so every product metric built
  // on that table would have counted CI as customers.
  test('a real session flushes as the app, which is the default', () => {
    const { windowObj, invocations } = loadSandbox();
    windowObj._obs.track('lead_created', 'pg-clients');
    windowObj._obs.flush();
    const body = invocations[invocations.length - 1].body;
    expect(body.source, 'nothing said otherwise, so it is a person').toBe('app');
    expect(body.events[0].event).toBe('lead_created');
  });

  test('the harness says what it is, and every row after says it too', () => {
    const { windowObj, invocations } = loadSandbox();
    windowObj._obs.markTest();
    windowObj._obs.track('flow_step', 'estimate-build|open BYO');
    windowObj._obs.flush();
    expect(invocations[invocations.length - 1].body.source).toBe('test');
  });

  test('it is one way: a run cannot talk itself back into the product numbers', () => {
    const { windowObj, invocations } = loadSandbox();
    expect(typeof windowObj._obs.markTest).toBe('function');
    // There is no unmark, by design, and nothing else may set the source.
    const back = Object.keys(windowObj._obs).filter(k => /app|unmark|clearTest|setSource/i.test(k));
    expect(back, 'no way back to app once a session has declared itself').toEqual([]);
    windowObj._obs.markTest();
    windowObj._obs.markTest();
    windowObj._obs.track('flow_total', 'estimate-build', 42);
    windowObj._obs.flush();
    expect(invocations[invocations.length - 1].body.source).toBe('test');
  });

  test('the flow harness declares itself BEFORE it writes its first row', () => {
    const src = fs.readFileSync(path.join(__dirname, 'flow', 'live-helpers.js'), 'utf8');
    const mark = src.indexOf('_obs.markTest');
    const first = src.indexOf("_obs.track('flow_step'");
    expect(mark, 'the harness marks itself at all').toBeGreaterThan(-1);
    expect(mark, 'and does it before the first tracked row').toBeLessThan(first);
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

// ════════════════════════════════════════════════════════════════════════════
//  EVERY BUTTON, AND HOW LONG THEY SAT THERE (owner 2026-09-11)
//
//  "every button needs tracked and needs telemetry we can see, I need clicks,
//   I need to know how long they were on that page"
//
//  Before this, a click recorded only the page. `pg-tracker: 757 clicks` was
//  the whole story and nothing said whether those were the Income tab or the
//  Hiring tab. Two things are under test and one of them is a privacy rule:
//
//   1. The control is identified by ID or by the FUNCTION its onclick calls,
//      arguments stripped. Never by its text. On a client row that text is a
//      customer's name, and analytics_events is the table the anonymized
//      contractor hash exists to protect. A name landing in it would defeat
//      the hash sitting in the next column.
//   2. Dwell is real elapsed time on a screen, paused while the app is in the
//      background, so a phone in a pocket overnight cannot report a 9-hour
//      visit.
// ════════════════════════════════════════════════════════════════════════════

test.describe('control-level click + dwell telemetry', () => {
  const fs = require('fs');
  const path = require('path');

  function loadSandbox() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'observability.js'), 'utf8');
    const invocations = [];
    const listeners = { window: {}, document: {} };
    const thenable = { then() { return thenable; } };
    const consoleObj = { error() {}, log() {}, warn() {} };
    const windowObj = { addEventListener(t, f) { (listeners.window[t] ||= []).push(f); }, open() {} };
    // _page() reads the active .pg, which is how a click learns which screen it
    // happened on. A stub that always answers null would make every ctx in
    // here null and quietly prove nothing about the real thing.
    let curPage = null;
    const documentObj = {
      addEventListener(t, f) { (listeners.document[t] ||= []).push(f); },
      querySelector: (sel) => (sel === '.pg.active' && curPage ? { id: curPage } : null),
      body: {}, visibilityState: 'visible',
    };
    const locationObj = { hostname: 'tradedeskpro.app', href: 'https://tradedeskpro.app/' };
    const supa = { functions: { invoke: (name, opts) => { invocations.push({ name, body: opts && opts.body }); return thenable; } } };
    let nowMs = 1_700_000_000_000;
    const DateStub = function () { return new Date(nowMs); };
    DateStub.now = () => nowMs;
    const run = new Function(
      'window', 'location', 'document', 'console', 'performance',
      'setInterval', 'setTimeout', 'MutationObserver', 'XMLHttpRequest',
      '_supa', '_supaUser', 'Date',
      src
    );
    run(
      windowObj, locationObj, documentObj, consoleObj,
      { now: () => 1234 }, () => 0, () => 0,
      function () { return { observe() {}, disconnect() {} }; },
      function XMLHttpRequestStub() {},
      supa, { id: 'obs-test-user' }, DateStub
    );
    const fire = (target, type, ev) => (listeners[target][type] || []).forEach((f) => f(ev));
    return {
      windowObj, documentObj, invocations, fire,
      advance: (ms) => { nowMs += ms; },
      // Navigate the way the app does: js/navigation.js sets the active page
      // and fires the page event, so the sandbox does both too.
      page: (id) => { curPage = id; windowObj._obs.track('page', id); },
      click: (el) => fire('document', 'click', { target: { closest: () => el } }),
      hide: () => { documentObj.visibilityState = 'hidden'; fire('document', 'visibilitychange'); },
      show: () => { documentObj.visibilityState = 'visible'; fire('document', 'visibilitychange'); },
      events: () => {
        for (let i = invocations.length - 1; i >= 0; i--) {
          if (invocations[i].body && invocations[i].body.events) return invocations[i].body.events;
        }
        return [];
      },
    };
  }

  const btn = (attrs) => ({
    id: attrs.id || '',
    className: attrs.className || '',
    tagName: attrs.tagName || 'BUTTON',
    textContent: attrs.text || '',
    getAttribute: (k) => (k === 'onclick' ? (attrs.onclick || null) : null),
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  test('a control with an id is recorded by its id, and the page is unchanged', () => {
    const s = loadSandbox();
    s.page('pg-tracker');
    s.click(btn({ id: 'tr-t-mileage', text: 'Mileage' }));
    s.windowObj._obs.flush();
    const click = s.events().find((e) => e.event === 'click');
    expect(click, 'the click was recorded at all').toBeTruthy();
    expect(click.ctl, 'the control inside the page').toBe('#tr-t-mileage');
    expect(click.ctx, 'ctx is still the page, so usage_by_screen is untouched').toBe('pg-tracker');
  });

  test('a control with no id is recorded by the function it calls', () => {
    const s = loadSandbox();
    s.page('pg-clients');
    s.click(btn({ onclick: 'saveClient()', text: 'Save' }));
    s.windowObj._obs.flush();
    expect(s.events().find((e) => e.event === 'click').ctl).toBe('saveClient');
  });

  test('the arguments are stripped, which is where the customer ids live', () => {
    const s = loadSandbox();
    s.page('pg-client-detail');
    s.click(btn({ onclick: "openClientProposals(currentClientId, 'acct-9931')", text: 'Proposals' }));
    s.windowObj._obs.flush();
    const ctl = s.events().find((e) => e.event === 'click').ctl;
    expect(ctl).toBe('openClientProposals');
    expect(ctl).not.toContain('acct-9931');
    expect(ctl).not.toContain('(');
  });

  // THE PRIVACY RULE. This is the test that has to hold: a button's visible
  // label is frequently a person's name, and none of it may reach the table.
  test("a customer's name is on the button and reaches nothing in the payload", () => {
    const s = loadSandbox();
    s.page('pg-clients');
    s.click(btn({ onclick: 'openClient(4471)', text: 'Marcy Ruiz, 118 Oak St' }));
    s.windowObj._obs.flush();
    const wire = JSON.stringify(s.invocations[s.invocations.length - 1].body);
    expect(wire).not.toContain('Marcy');
    expect(wire).not.toContain('Ruiz');
    expect(wire).not.toContain('Oak St');
    expect(wire).not.toContain('4471');
    expect(wire, 'the control itself is still named').toContain('openClient');
  });

  test('a control with neither id nor onclick falls back to tag and class, never text', () => {
    const s = loadSandbox();
    s.page('pg-dash');
    s.click(btn({ className: 'qa qa-p', text: 'Blake Sample' }));
    s.windowObj._obs.flush();
    const ctl = s.events().find((e) => e.event === 'click').ctl;
    expect(ctl).toBe('button.qa');
    expect(ctl).not.toContain('Blake');
  });

  test('a click on nothing clickable is still counted for the page, with no control', () => {
    const s = loadSandbox();
    s.page('pg-dash');
    s.click(null);
    s.windowObj._obs.flush();
    const click = s.events().find((e) => e.event === 'click');
    expect(click, 'the page-level count is preserved, that is the old number').toBeTruthy();
    expect(click.ctl).toBe(null);
  });

  test('a malformed control does not throw and does not lose the click', () => {
    const s = loadSandbox();
    s.page('pg-dash');
    // No getAttribute, no tagName: nothing the identity ladder expects.
    expect(() => s.click({})).not.toThrow();
    s.windowObj._obs.flush();
    expect(s.events().some((e) => e.event === 'click')).toBe(true);
  });

  test('ten taps on one control are ONE event carrying the count, not ten rows', () => {
    const s = loadSandbox();
    s.page('pg-tracker');
    for (let i = 0; i < 10; i++) s.click(btn({ id: 'tr-t-income' }));
    s.windowObj._obs.flush();
    const clicks = s.events().filter((e) => e.event === 'click');
    expect(clicks.length, 'the server aggregates on event|ctx|ctl').toBe(10);
    expect(clicks.every((c) => c.ctl === '#tr-t-income')).toBe(true);
  });

  // ── Dwell ─────────────────────────────────────────────────────────────────

  test('leaving a page reports how long they were on it', () => {
    const s = loadSandbox();
    s.page('pg-tracker');
    s.advance(47_000);
    s.page('pg-dash');
    s.windowObj._obs.flush();
    const dwell = s.events().find((e) => e.event === 'dwell');
    expect(dwell.ctx).toBe('pg-tracker');
    expect(dwell.value).toBe(47);
  });

  test('the page event still fires alongside the dwell, so page views do not move', () => {
    const s = loadSandbox();
    s.page('pg-leads');
    s.advance(5_000);
    s.page('pg-jobs');
    s.windowObj._obs.flush();
    const pages = s.events().filter((e) => e.event === 'page').map((e) => e.ctx);
    expect(pages).toEqual(['pg-leads', 'pg-jobs']);
  });

  test('a phone in a pocket does not report a nine-hour visit', () => {
    const s = loadSandbox();
    s.page('pg-timelog');
    s.advance(20_000);
    s.hide();
    s.advance(9 * 3600 * 1000);   // overnight, app backgrounded
    s.show();
    s.advance(10_000);
    s.page('pg-dash');
    s.windowObj._obs.flush();
    const dwell = s.events().find((e) => e.event === 'dwell');
    expect(dwell.value, 'only the seconds the app was actually in front of them').toBe(30);
  });

  test('coming back to the same screen continues the visit, it is not a second one', () => {
    const s = loadSandbox();
    s.page('pg-est-generic');
    s.advance(30_000);
    s.hide(); s.advance(60_000); s.show();
    s.advance(30_000);
    s.page('pg-dash');
    s.windowObj._obs.flush();
    const dwells = s.events().filter((e) => e.event === 'dwell');
    expect(dwells.length, 'one visit, not two').toBe(1);
    expect(dwells[0].value).toBe(60);
  });

  test('closing the app closes the open visit', () => {
    const s = loadSandbox();
    s.page('pg-money');
    s.advance(12_000);
    s.fire('window', 'beforeunload');
    const dwell = s.events().find((e) => e.event === 'dwell');
    expect(dwell.ctx).toBe('pg-money');
    expect(dwell.value).toBe(12);
  });

  test('a glance too short to measure reports nothing', () => {
    const s = loadSandbox();
    s.page('pg-gallery');
    s.advance(400);                       // under a second
    s.page('pg-dash');
    s.windowObj._obs.flush();
    expect(s.events().some((e) => e.event === 'dwell')).toBe(false);
  });

  test('the same page twice in a row closes the first visit rather than merging them', () => {
    const s = loadSandbox();
    s.page('pg-dash');
    s.advance(10_000);
    s.page('pg-dash');
    s.advance(10_000);
    s.fire('window', 'beforeunload');
    const dwells = s.events().filter((e) => e.event === 'dwell');
    expect(dwells.length).toBe(2);
    expect(dwells.every((d) => d.value === 10)).toBe(true);
  });

  test('closing twice does not report the visit twice', () => {
    const s = loadSandbox();
    s.page('pg-taxes');
    s.advance(8_000);
    s.fire('window', 'beforeunload');
    s.advance(8_000);
    s.fire('window', 'beforeunload');
    expect(s.events().filter((e) => e.event === 'dwell').length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  THE PIPE FROM THE BUTTON TO THE ROLLUP
//
//  The client can name a control perfectly and it still reaches nothing if the
//  edge function drops the field or the rollup counts CI as a customer. These
//  assert the contract across the three files that have to agree, the same way
//  e2e-geo-ingest-contract guards the geo pipe.
// ════════════════════════════════════════════════════════════════════════════

test.describe('control telemetry: client → ingest → rollup contract', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const MIG = 'supabase/migrations/20260926_analytics_control_usage.sql';

  test('ingest-telemetry carries ctl through, and aggregates on it', () => {
    const src = read('supabase/functions/ingest-telemetry/index.ts');
    expect(src, 'the field is read off the event').toMatch(/ctl\s*=\s*ev\?\.ctl/);
    expect(src, 'and it is part of the aggregation key, or nine taps become nine rows')
      .toMatch(/const k = event \+ "\|" \+ \(ctx \|\| ""\) \+ "\|" \+ \(ctl \|\| ""\)/);
    // Both write paths have to carry it: the aggregated one and the one that
    // bypasses aggregation because the event came with its own number (dwell).
    const writes = src.match(/\{ \.\.\.stamp, event[^}]*\}/g) || [];
    expect(writes.length, 'two insert shapes exist').toBeGreaterThanOrEqual(2);
    expect(writes.every((w) => /\bctl\b/.test(w)), 'every one of them carries ctl').toBe(true);
  });

  test('ctl is additive: the column is nullable and usage_by_screen is not touched', () => {
    const mig = read(MIG);
    expect(mig).toMatch(/alter table analytics_events add column if not exists ctl text;/);
    expect(mig, 'no NOT NULL, which would reject ten weeks of existing rows').not.toMatch(/ctl text not null/i);
    expect(mig, 'the existing screen rollup is left alone').not.toMatch(/create or replace function usage_by_screen/i);
  });

  test('all three levels exist, and all three refuse a non-admin', () => {
    const mig = read(MIG);
    for (const fn of ['control_usage_summary', 'control_usage_by_trade', 'control_usage_by_contractor']) {
      expect(mig, fn + ' is defined').toMatch(new RegExp('create or replace function ' + fn));
      expect(mig, fn + ' is revoked from anon').toMatch(new RegExp('revoke all on function ' + fn + '\\(date, date\\)\\s+from anon'));
    }
    const gates = mig.match(/if not is_ops_admin\(\) then raise exception/g) || [];
    expect(gates.length, 'one gate per function, none of them skipped').toBe(3);
  });

  test('the flow suite is not a customer: the spine drops source=test', () => {
    const mig = read(MIG);
    expect(mig).toMatch(/create or replace view v_control_event/);
    expect(mig).toMatch(/coalesce\(e\.source, 'app'\) <> 'test'/);
    expect(mig, 'and internal accounts are out too').toMatch(/analytics_internal_accounts/);
  });

  test('a trade is the average of its businesses, not one loud shop', () => {
    const mig = read(MIG);
    expect(mig).toMatch(/clicks_per_business/);
    expect(mig).toMatch(/dwell_min_per_business/);
  });

  test('every screen the app can show has a name, and none of them is the code name', () => {
    const mig = read(MIG);
    const named = new Set([...mig.matchAll(/\('(pg-[a-z0-9-]+)',\s*'([^']+)'/g)].map((m) => m[1]));
    const html = read('index.html');
    const shown = [...html.matchAll(/<div class="pg"[^>]*id="(pg-[a-z0-9-]+)"/g)].map((m) => m[1]);
    const missing = shown.filter((id) => !named.has(id));
    expect(missing, 'a page with no label renders as its code name on the chart').toEqual([]);
    // pg-tracker is the one that started this: it says Books on screen.
    expect(mig).toMatch(/\('pg-tracker',\s*'Books'/);
  });

  test('the name table is not readable by the app, same as every other ops object', () => {
    const mig = read(MIG);
    expect(mig).toMatch(/revoke all on analytics_screen_names from anon, authenticated;/);
    expect(mig).toMatch(/revoke all on v_control_event from anon, authenticated;/);
  });
});
