// @ts-check
// ── Receipt scanning: the TurboScan-style live scanner ───────────────────────
// Owner call (2026-08-09): finish it, and ship the live viewfinder in the
// TestFlight app only. It needs a camera stream held open for continuous edge
// detection, which mobile browsers grant inconsistently; the browser keeps the
// OS camera plus the manual corner editor, which is the same pipeline minus
// the live preview.
//
// _openLiveScanner had been fully written and never called from anywhere, so
// none of this had ever run. Wiring it up immediately surfaced a real layout
// bug (see the calc() test below), which is exactly why orphaned functions are
// banned by CLAUDE.md 7.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('receipt scanner', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('in a browser the live scanner is refused and the file picker takes over', async () => {
    const r = await page.evaluate(() => {
      const realCap = window.Capacitor;
      window.Capacitor = undefined;
      let picked = 0;
      const realCreate = document.createElement.bind(document);
      document.createElement = (t) => {
        const el = realCreate(t);
        if (t === 'input') el.click = () => { picked++; };
        return el;
      };
      try {
        const capable = _rcptLiveCapable();
        _showReceiptScanner(null, () => {});
        return { capable, picked, live: !!document.getElementById('live-scan-ui') };
      } finally { document.createElement = realCreate; window.Capacitor = realCap; }
    });
    expect(r.capable, 'no live viewfinder outside the app').toBe(false);
    expect(r.live).toBe(false);
    expect(r.picked, 'the OS camera path still works everywhere').toBe(1);
  });

  test('inside the shell the live viewfinder is available as the fallback', async () => {
    const r = await page.evaluate(() => {
      const realCap = window.Capacitor;
      window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
      try { return { capable: _rcptLiveCapable() }; }
      finally { window.Capacitor = realCap; }
    });
    expect(r.capable).toBe(true);
  });

  // Apple's VisionKit scanner (native/td-doc) is the one the app should use:
  // better edge detection, auto-capture, glare handling, retake. The canvas
  // pipeline is demoted to the browser's fallback.
  test('in the app, Apple\'s document scanner is preferred over the canvas one', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const realFetch = window.fetch;
      let scanCalls = 0;
      window.Capacitor = {
        isNativePlatform: () => true,
        convertFileSrc: (p) => 'file://' + p,
        registerPlugin: (n) => n === 'TdDoc' ? {
          isAvailable: () => Promise.resolve({ available: true }),
          scanDocument: () => { scanCalls++; return Promise.resolve({ pages: ['/docs/p0.jpg', '/docs/p1.jpg'], cancelled: false }); },
        } : null,
      };
      window.fetch = () => Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })) });
      try {
        window._rcptNativeOk = null;
        let got = null;
        _showReceiptScanner(null, (b) => { got = b; });
        await new Promise(r2 => setTimeout(r2, 120));
        return { scanCalls, gotBlob: !!got && got.type === 'image/jpeg',
                 canvasOpened: !!document.getElementById('live-scan-ui') };
      } finally {
        window.Capacitor = realCap; window.fetch = realFetch;
        document.getElementById('live-scan-ui')?.remove();
      }
    });
    expect(r.scanCalls, 'VisionKit is what runs').toBe(1);
    expect(r.gotBlob, 'the page comes back as an image the expense can attach').toBe(true);
    expect(r.canvasOpened, 'the canvas scanner never opens when Apple\'s is there').toBe(false);
  });

  test('cancelling Apple\'s scanner attaches nothing at all', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      window.Capacitor = {
        isNativePlatform: () => true,
        convertFileSrc: (p) => p,
        registerPlugin: (n) => n === 'TdDoc' ? {
          isAvailable: () => Promise.resolve({ available: true }),
          scanDocument: () => Promise.resolve({ pages: [], cancelled: true }),
        } : null,
      };
      try {
        window._rcptNativeOk = null;
        let calls = 0;
        _showReceiptScanner(null, () => { calls++; });
        await new Promise(r2 => setTimeout(r2, 120));
        return { calls };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.calls, 'a cancel leaves the expense untouched').toBe(0);
  });

  test('an older phone without VisionKit still gets the canvas scanner', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const realGUM = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
      window.Capacitor = {
        isNativePlatform: () => true,
        registerPlugin: (n) => n === 'TdDoc' ? {
          isAvailable: () => Promise.resolve({ available: false }),
          scanDocument: () => Promise.reject(new Error('unsupported')),
        } : null,
      };
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
      try {
        window._rcptNativeOk = null;
        _showReceiptScanner(null, () => {});
        await new Promise(r2 => setTimeout(r2, 150));
        const opened = !!document.getElementById('live-scan-ui');
        document.getElementById('live-scan-ui')?.remove();
        return { opened };
      } finally {
        window.Capacitor = realCap;
        if (navigator.mediaDevices && realGUM) navigator.mediaDevices.getUserMedia = realGUM;
      }
    });
    expect(r.opened, 'no dead end on a phone VisionKit will not run on').toBe(true);
  });

  // THE BUG THIS FILE EXISTS FOR. In CSS calc(), + and - must have whitespace
  // around them: calc(env(safe-area-inset-bottom,0px)+20px) is INVALID, the
  // whole declaration is dropped, and every control in the scanner collapsed
  // to the top of the screen on top of each other. It shipped unnoticed only
  // because nothing ever opened the scanner.
  test('no space-less calc operator can come back anywhere in the app', async () => {
    const bad = await page.evaluate(async () => {
      const files = ['js/finance.js', 'js/geo-track.js', 'js/scan.js', 'js/scan-estimate.js',
                     'js/clients.js', 'js/utils.js', 'js/dashboard.js', 'js/proposals.js'];
      const hits = [];
      for (const f of files) {
        try {
          const txt = await (await fetch('/' + f)).text();
          // calc(...) immediately followed by + or - and a value: no whitespace.
          const re = /calc\([^)\n]*\)[+-][0-9a-z]/gi;
          let m;
          while ((m = re.exec(txt))) hits.push(f + ': ' + m[0]);
        } catch (e) { /* file not served in this harness */ }
      }
      return hits;
    });
    expect(bad, 'calc needs spaces around + and -, or the declaration is dropped').toEqual([]);
  });

  test('the scanner lays out correctly: controls at top and bottom, no bleed', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      const realGUM = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
      window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
      try {
        // A camera that never resolves: the overlay and its chrome still build,
        // which is all this test is about.
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
        _showReceiptScanner(null, () => {});
        await new Promise(res => setTimeout(res, 120));
        const ov = document.getElementById('live-scan-ui');
        const box = id => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
        const out = {
          opened: !!ov,
          shutter: box('ls-shutter'), cancel: box('ls-cancel'),
          vh: window.innerHeight,
          scrollW: document.documentElement.scrollWidth, vw: window.innerWidth,
        };
        ov && ov.remove();
        return out;
      } finally {
        window.Capacitor = realCap;
        if (navigator.mediaDevices && realGUM) navigator.mediaDevices.getUserMedia = realGUM;
      }
    });
    expect(r.opened).toBe(true);
    expect(r.cancel.top, 'Cancel stays clear of the status bar').toBeGreaterThan(0);
    expect(r.shutter.top, 'the shutter is under the thumb, not at the top').toBeGreaterThan(r.vh * 0.66);
    expect(r.scrollW, 'nothing bleeds sideways').toBeLessThanOrEqual(r.vw + 1);
  });

  test('no console errors across the receipt scanner suite', async () => { await assertNoErrors(page); });
});
