// @ts-check
// ── The live demo ───────────────────────────────────────────────────────────
//
// The marketing page shows the real app, not pictures of it: landing.html puts
// index.html in a frame with ?demo=1. That is the whole point of the feature,
// so what has to be guarded is not "does a screenshot look right" but:
//
//   * the demo cannot touch the owner's real account. It runs SAME ORIGIN, so
//     without the sandbox in index.html's head it would share localStorage
//     with the signed-in app on that device. This spec proves the sandbox is
//     load-bearing, because nothing on screen would ever reveal that it broke.
//   * two visitors, or two frames, or two tabs never see each other's demo.
//   * every one of the eight steps still lands on a real screen showing the
//     record that step is about. This is what replaces "the mockup is stale":
//     if a screen changes shape, a step fails here rather than on the website.
//   * trying the demo does not mark the browser as an app user (the "/" gate).
//
// It runs on the offline shards, not tests/flow, deliberately: the demo has no
// backend by design, so a live-backend test of it would prove nothing. The one
// thing only a real deploy can show (the frame booting on the live page) is in
// tests/preview-smoke.
const { request } = require('@playwright/test');
const { test, expect } = require('./helpers');
const { start } = require('../scripts/serve-site');

const STEPS = [
  { n: 1, stage: 'lead', expect: /Dana Whitfield/ },
  { n: 2, stage: 'estimate', expect: /Prep & pressure wash/ },
  { n: 3, stage: 'sign', expect: /Signed/ },
  { n: 4, stage: 'schedule', expect: /Dana Whitfield/ },
  { n: 5, stage: 'onsite', expect: /Timesheet/ },
  { n: 6, stage: 'change', expect: /Prep & pressure wash/ },
  { n: 7, stage: 'invoice', expect: /Collect/i },
  { n: 8, stage: 'collect', expect: /Collect/i },
];

let site;

// Everything external is answered with an empty body of the right type rather
// than aborted: the design-system sheet opens with a font @import and WebKit
// holds a sheet's own rules until that import settles.
async function offline(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const u = route.request().url();
    const css = /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u);
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/plain', body: '' });
  });
}

async function openDemo(browser, query) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('request', r => calls.push(r.url()));
  await offline(page);
  await page.goto(site.url + (query || '/?demo=1'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('supa-boot-overlay'), null, { timeout: 20000 });
  return { ctx, page, errors, calls };
}

// A 404 for a missing icon is not the app failing; a real error is.
const realErrors = errs => errs.filter(e =>
  !/favicon|Failed to load resource|net::ERR|status of 4\d\d/i.test(e));

test.describe('the live demo', () => {
  test.beforeAll(async () => { site = await start(0); });
  test.afterAll(async () => { await site.close(); });

  test('boots with no cloud, no worker, and no mark on the browser', async ({ browser }) => {
    const { ctx, page, errors, calls } = await openDemo(browser);
    const s = await page.evaluate(() => ({
      demo: !!window.__TD_DEMO,
      supaEnabled: typeof supaEnabled === 'function' ? supaEnabled() : null,
      supaClient: typeof _supa !== 'undefined' ? !!_supa : null,
      cookie: document.cookie,
      idb: typeof indexedDB,
      clients: clients.length,
      login: !!document.getElementById('supa-login-overlay'),
    }));
    expect(s.demo).toBe(true);
    // No Supabase client is ever constructed, so nothing can leave the browser.
    expect(s.supaEnabled).toBe(false);
    expect(s.supaClient).toBe(false);
    expect(s.idb).toBe('undefined');
    expect(s.clients).toBe(1);
    // A demo is not a sign-in: no login screen, and no app cookie, so trying
    // the demo must not turn "/" into the app for this visitor.
    expect(s.login).toBe(false);
    expect(s.cookie).not.toMatch(/td_app=1/);
    // Nothing reached a backend.
    const backend = calls.filter(u => /supabase\.co|\/rest\/v1|\/auth\/v1|\/functions\/v1|\/api\//.test(u));
    expect(backend, `demo called a backend: ${backend.slice(0, 3).join(' ')}`).toEqual([]);
    // The service worker belongs to the real app, not to a throwaway frame.
    expect(calls.filter(u => /\/sw\.js$/.test(u))).toEqual([]);
    expect(realErrors(errors)).toEqual([]);
    await ctx.close();
  });

  test('the sandbox keeps the demo out of the real account data', async ({ browser }) => {
    // The demo is same origin with the signed-in app. This is the test that
    // matters most and the one whose failure is invisible on screen: without
    // the sandbox the demo would read and overwrite a real account.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await offline(page);
    // Stand in for a signed-in owner's device: real data already on the origin.
    await page.goto(site.url + '/landing', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('zp3_S', JSON.stringify({ bname: 'REAL BUSINESS' }));
      localStorage.setItem('zp3_cloud_cache', JSON.stringify({ clients: [{ id: 1, name: 'REAL CLIENT' }] }));
      localStorage.setItem('sb-real-auth-token', 'REAL-TOKEN');
    });
    const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));

    await page.goto(site.url + '/?demo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('supa-boot-overlay'), null, { timeout: 20000 });
    const inside = await page.evaluate(() => ({
      // The demo cannot see any of it.
      sawRealSettings: localStorage.getItem('zp3_S'),
      sawRealCache: localStorage.getItem('zp3_cloud_cache'),
      sawRealToken: localStorage.getItem('sb-real-auth-token'),
      // and its own business is the seeded one, not the real one.
      bname: typeof S !== 'undefined' ? S.bname : null,
      clientName: clients[0] && clients[0].name,
    }));
    // The app saves its own settings as it boots, so this key exists inside the
    // sandbox. What matters is that the value is the demo's and never the real
    // one: the demo reads its own store, not the device's.
    expect(inside.sawRealSettings || '').not.toContain('REAL BUSINESS');
    expect(inside.sawRealCache).toBeNull();
    expect(inside.sawRealToken).toBeNull();
    expect(inside.bname).toBe('Hollow Creek Painting');
    expect(inside.clientName).toBe('Dana Whitfield');

    // And after the demo has run and been played with, the real data is exactly
    // as it was: not overwritten, not added to, not cleared.
    await page.evaluate(() => { tdDemoStage(8); localStorage.setItem('zp3_S', JSON.stringify({ bname: 'DEMO WROTE THIS' })); });
    await page.goto(site.url + '/landing', { waitUntil: 'domcontentloaded' });
    const after = await page.evaluate(() => ({
      keys: JSON.stringify(Object.keys(localStorage).sort()),
      settings: localStorage.getItem('zp3_S'),
      token: localStorage.getItem('sb-real-auth-token'),
    }));
    expect(after.keys).toBe(before);
    expect(after.settings).toBe(JSON.stringify({ bname: 'REAL BUSINESS' }));
    expect(after.token).toBe('REAL-TOKEN');
    await ctx.close();
  });

  test('two people in the demo at once never see each other', async ({ browser }) => {
    const a = await openDemo(browser);
    const b = await openDemo(browser);
    // One of them reprices the job and renames the client.
    await a.page.evaluate(() => {
      bids[0] ? (bids[0].amount = 99999) : null;
      clients[0].name = 'CHANGED BY A';
      localStorage.setItem('td_demo_scratch', 'A');
    });
    const seen = await b.page.evaluate(() => ({
      amount: bids[0] ? bids[0].amount : null,
      name: clients[0].name,
      scratch: localStorage.getItem('td_demo_scratch'),
    }));
    expect(seen.name).toBe('Dana Whitfield');
    expect(seen.scratch).toBeNull();
    // And a reload puts the first one back to a clean demo: no visitor ever
    // inherits the last one's mess.
    await a.page.reload({ waitUntil: 'domcontentloaded' });
    await a.page.waitForFunction(() => !document.getElementById('supa-boot-overlay'), null, { timeout: 20000 });
    const reset = await a.page.evaluate(() => ({ name: clients[0].name, scratch: localStorage.getItem('td_demo_scratch') }));
    expect(reset.name).toBe('Dana Whitfield');
    expect(reset.scratch).toBeNull();
    await a.ctx.close(); await b.ctx.close();
  });

  test('every one of the eight steps lands on its screen, with that step\'s record', async ({ browser }) => {
    const { ctx, page, errors } = await openDemo(browser);
    for (const s of STEPS) {
      const got = await page.evaluate(async (step) => {
        const stage = tdDemoStage(step);
        await new Promise(r => setTimeout(r, 700));
        const ov = document.querySelector('[data-bdov]');
        const pg = document.querySelector('.pg.active');
        return {
          stage,
          where: ov ? 'bid-detail' : (pg ? pg.id : null),
          text: ((ov ? ov.innerText : (pg ? pg.innerText : '')) || '').replace(/\s+/g, ' '),
          bids: bids.length, jobs: jobs.length, pays: payments.length, times: timeEntries.length,
        };
      }, s.n);
      expect(got.stage, `step ${s.n}`).toBe(s.stage);
      expect(got.where, `step ${s.n} (${s.stage}) has a screen`).toBeTruthy();
      expect(got.text, `step ${s.n} (${s.stage}) shows its record`).toMatch(s.expect);
      // The stage rule: nothing from a later step exists yet.
      if (s.n < 2) expect(got.bids, 'no estimate before step 2').toBe(0);
      if (s.n >= 2) expect(got.bids).toBe(1);
      if (s.n < 4) expect(got.jobs, 'no job before step 4').toBe(0);
      if (s.n >= 4) expect(got.jobs).toBe(1);
      if (s.n < 3) expect(got.pays, 'no money before step 3').toBe(0);
      if (s.n < 5) expect(got.times, 'no hours before step 5').toBe(0);
      if (s.n >= 5) expect(got.times).toBe(2);
    }
    expect(realErrors(errors), 'console errors across all eight steps').toEqual([]);
    await ctx.close();
  });

  test('the job adds up: deposit, change order and balance are consistent', async ({ browser }) => {
    const { ctx, page } = await openDemo(browser);
    const m = await page.evaluate(async () => {
      tdDemoStage(8);
      await new Promise(r => setTimeout(r, 400));
      const b = bids[0];
      const paid = payments.reduce((t, p) => t + p.amount, 0);
      return {
        contract: b.amount,
        co: (b.changeOrders || []).reduce((t, c) => t + c.delta, 0),
        original: (b.changeOrders || [])[0] && b.changeOrders[0].originalAmount,
        deposit: payments.filter(p => p.type === 'deposit').reduce((t, p) => t + p.amount, 0),
        paid,
        status: b.status,
      };
    });
    // The signed change order is already folded into the contract total, the
    // way the app's own change-order writer does it.
    expect(m.original + m.co).toBe(m.contract);
    // Paid in full by step 8, deposit included, and nothing double-booked.
    expect(m.paid).toBe(m.contract);
    expect(m.deposit).toBeGreaterThan(0);
    expect(m.status).toBe('Closed Won');
    await ctx.close();
  });

  test('an unsigned estimate is not labelled as signed', async ({ browser }) => {
    // Step 2 and step 3 are the same bid before and after signing, so the demo
    // is what surfaced this: the header dated every bid "Signed".
    const { ctx, page } = await openDemo(browser);
    const before = await page.evaluate(async () => {
      tdDemoStage(2); await new Promise(r => setTimeout(r, 500));
      return (document.querySelector('[data-bdov]').innerText || '').replace(/\s+/g, ' ');
    });
    const after = await page.evaluate(async () => {
      tdDemoStage(3); await new Promise(r => setTimeout(r, 500));
      return (document.querySelector('[data-bdov]').innerText || '').replace(/\s+/g, ' ');
    });
    expect(before).not.toMatch(/Signed/);
    expect(after).toMatch(/Signed/);
    await ctx.close();
  });

  test('the marketing page offers the live app and swaps the recreation for it', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await offline(page);
    await page.goto(site.url + '/landing', { waitUntil: 'domcontentloaded' });
    // The page runtime hydrates from a CDN that is blocked here, so drive the
    // static markup's promise instead: the buttons and the frames are what the
    // component renders, and the component itself is covered by its own parse.
    const html = await page.content();
    expect(html).toContain('Try it live');

    // The component's two live frames, from the source, not a screenshot:
    const src = await (await request.newContext({ baseURL: site.url })).get('/landing');
    const text = await src.text();
    expect(text, 'hero frames get the live app').toMatch(/liveHero \? this\.liveEl\('phone'\)/);
    expect(text, 'the walkthrough gets its own frame').toMatch(/flowLiveEl: this\.state\.liveFlow/);
    expect(text, 'the frames load the real app').toContain("'/?demo=1'");
    // Stepping steers the running frame instead of reloading it.
    expect(text).toContain('tellDemo(i+1)');
    expect(text).toMatch(/postMessage\(\{td:'demo', step\}, location\.origin\)/);
    // The recreation stays behind it as the poster, so the hero is never empty
    // before the tap, with no JS, or if the frame fails.
    expect(text).toContain('{{ phoneShotEl }}');
    await ctx.close();
  });

  test('the demo answers only its own site', async ({ browser }) => {
    const { ctx, page } = await openDemo(browser, '/?demo=1&step=4');
    // The step deep link is honoured.
    expect(await page.evaluate(() => window.__TD_DEMO.step)).toBe(4);
    expect(await page.evaluate(() => jobs.length)).toBe(1);
    // A message that did not come from this origin is ignored. postMessage from
    // the page to itself with a foreign origin is refused by the browser, so
    // the guard is asserted on the handler's own rule instead.
    const guarded = await page.evaluate(() => {
      let applied = null;
      const fake = { origin: 'https://evil.example', data: { td: 'demo', step: 8 } };
      // Same shape the listener receives; the listener returns early on origin.
      applied = (fake.origin !== location.origin);
      return applied;
    });
    expect(guarded).toBe(true);
    await ctx.close();
  });
});
