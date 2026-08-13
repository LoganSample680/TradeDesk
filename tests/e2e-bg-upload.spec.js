// @ts-check
// ── Background upload (owner 2026-08-11) ─────────────────────────────────────
// iOS finishes the transfer with the app CLOSED, so results arrive when no JS
// is listening. Everything here defends the reconcile from the ledger.
//
// THE RULE: never mark a photo uploaded on hope. A photo marked done whose
// bytes never arrived is silently lost, and the local copy gets dropped with
// it, so only a RECORDED success clears one.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Background upload reconcile', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('ids survive a relaunch: they encode where the photo goes', async () => {
    const r = await page.evaluate(() => ({
      round: _bgUpParseId(_bgUpId(42, 3, 'u/42/site-1.jpg')),
      pathWithColons: _bgUpParseId(_bgUpId(7, 0, 'u/7/a:b.jpg')),
      junk: _bgUpParseId('nonsense'),
      empty: _bgUpParseId(''),
      nul: _bgUpParseId(null),
    }));
    expect(r.round).toEqual({ jobId: '42', idx: 3, storagePath: 'u/42/site-1.jpg' });
    expect(r.pathWithColons.storagePath, 'a colon in the path must not break parsing').toBe('u/7/a:b.jpg');
    expect(r.junk).toBe(null);
    expect(r.empty).toBe(null);
    expect(r.nul).toBe(null);
  });

  test('a recorded success clears the photo; a failure sends it back to the retry queue', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, savedJobs = jobs.slice();
      let cleared = [];
      try {
        jobs.length = 0;
        jobs.push({ id: 900, name: 'Up Job', photos: [
          { type: 'site', data: 'data:image/jpeg;base64,AAA', pendingUpload: true },
          { type: 'site', data: 'data:image/jpeg;base64,BBB', pendingUpload: true },
        ] });
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            results: () => Promise.resolve({ results: [
              { id: _bgUpId(900, 0, 'u/900/a.jpg'), ok: true, status: 200 },
              { id: _bgUpId(900, 1, 'u/900/b.jpg'), ok: false, status: 500 },
            ] }),
            clear: (o) => { cleared = cleared.concat(o.ids || []); return Promise.resolve(); },
          }),
        };
        const out = await _bgUpReconcile();
        const j = jobs.find(x => x.id === 900);
        return {
          applied: out.applied,
          okPhoto: { pending: j.photos[0].pendingUpload, path: j.photos[0].storagePath, hasData: !!j.photos[0].data },
          failPhoto: { pending: j.photos[1].pendingUpload, hasData: !!j.photos[1].data },
          clearedCount: cleared.length,
        };
      } finally { window.Capacitor = realCap; jobs.length = 0; savedJobs.forEach(x => jobs.push(x)); }
    });
    expect(r.applied).toBe(1);
    expect(r.okPhoto.pending, 'a recorded success is done').toBe(false);
    expect(r.okPhoto.path).toBe('u/900/a.jpg');
    expect(r.okPhoto.hasData, 'the local copy is dropped only after it landed').toBe(false);
    expect(r.failPhoto.pending, 'a failure goes back to the in-app retry queue').toBe(true);
    expect(r.failPhoto.hasData, 'and keeps its bytes so the retry has something to send').toBe(true);
    expect(r.clearedCount, 'both ledger entries are handled').toBe(2);
  });

  test('results with nowhere to land are dropped, never left to pile up', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, savedJobs = jobs.slice();
      let cleared = [];
      try {
        jobs.length = 0;
        jobs.push({ id: 901, name: 'Small', photos: [{ type: 'site', pendingUpload: true }] });
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            results: () => Promise.resolve({ results: [
              { id: _bgUpId(999, 0, 'u/999/gone.jpg'), ok: true, status: 200 },  // job deleted
              { id: _bgUpId(901, 9, 'u/901/nope.jpg'), ok: true, status: 200 },  // index gone
              { id: 'garbage', ok: true, status: 200 },                          // unparseable
            ] }),
            clear: (o) => { cleared = cleared.concat(o.ids || []); return Promise.resolve(); },
          }),
        };
        const out = await _bgUpReconcile();
        return { applied: out.applied, handled: out.handled, cleared: cleared.length };
      } finally { window.Capacitor = realCap; jobs.length = 0; savedJobs.forEach(x => jobs.push(x)); }
    });
    expect(r.applied, 'nothing to apply').toBe(0);
    expect(r.cleared, 'but all three stop being carried forever').toBe(3);
  });

  test('browser and PWA: no plugin, no reconcile, no error', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = undefined;
        const out = await _bgUpReconcile();
        const sent = await _bgUpSend(1, 0, 'p.jpg', 'AAA', 'image/jpeg', 'tok');
        return { applied: out.applied, capable: _bgUpCapable(), sent };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.applied).toBe(0);
    expect(r.capable).toBe(false);
    expect(r.sent, 'nothing to hand off to').toBe(false);
  });

  test('an empty ledger is a cheap no-op', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      let clears = 0;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            results: () => Promise.resolve({ results: [] }),
            clear: () => { clears++; return Promise.resolve(); },
          }),
        };
        const out = await _bgUpReconcile();
        return { applied: out.applied, clears };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.applied).toBe(0);
    expect(r.clears, 'nothing to clear means no round trip').toBe(0);
  });

  test('no console errors during background upload tests', async () => {
    assertNoErrors(page, 'background upload');
  });
});
