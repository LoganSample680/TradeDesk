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

  // Owner review (2026-08-10) vs the Apple scanner: pointed at a sink, the
  // live overlay drew a giant skewed quad and claimed a receipt. The sanity
  // gate is what keeps the overlay quiet until a document is really there.
  test('a detected quad must look like a document before the UI believes it', async () => {
    const r = await page.evaluate(() => {
      const W = 1920, H = 1080;
      const rect = [{ x: 500, y: 200 }, { x: 1400, y: 210 }, { x: 1390, y: 900 }, { x: 510, y: 890 }];
      const tilted = rect.map(({ x, y }) => {
        const cx = 960, cy = 540, a = 0.3;
        return { x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
                 y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) };
      });
      const sliver = [{ x: 0, y: 0 }, { x: 1900, y: 40 }, { x: 1910, y: 90 }, { x: 20, y: 60 }];
      const bowtie = [{ x: 500, y: 200 }, { x: 1400, y: 900 }, { x: 1390, y: 210 }, { x: 510, y: 890 }];
      const tiny = [{ x: 900, y: 500 }, { x: 1000, y: 500 }, { x: 1000, y: 580 }, { x: 900, y: 580 }];
      const whole = [{ x: 2, y: 2 }, { x: 1918, y: 2 }, { x: 1918, y: 1078 }, { x: 2, y: 1078 }];
      return {
        rect: _rcptQuadSane(rect, W, H),
        tilted: _rcptQuadSane(tilted, W, H),
        sliver: _rcptQuadSane(sliver, W, H),
        bowtie: _rcptQuadSane(bowtie, W, H),
        tiny: _rcptQuadSane(tiny, W, H),
        whole: _rcptQuadSane(whole, W, H),
        junk: _rcptQuadSane(null, W, H) || _rcptQuadSane([{ x: 1, y: 1 }], W, H),
      };
    });
    expect(r.rect, 'a receipt-shaped quad passes').toBe(true);
    expect(r.tilted, 'tilted is fine, receipts sit crooked on seats').toBe(true);
    expect(r.sliver, 'a counter-edge sliver is not a document').toBe(false);
    expect(r.bowtie, 'self-crossing garbage is not a document').toBe(false);
    expect(r.tiny, 'a speck is not a document').toBe(false);
    expect(r.whole, 'the entire frame is clutter, not a document').toBe(false);
    expect(r.junk).toBe(false);
  });

  // Owner (2026-08-10): Apple's scanner ran, then the OLD canvas UI came up.
  // The page files were read through convertFileSrc, which cannot resolve
  // when the shell serves the remote UAT site; the read failed and the catch
  // resurrected the old scanner over a capture that already happened.
  test('native pages read through the plugin bridge, and a read failure never resurrects the old UI', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, realOk = _rcptNativeOk;
      try {
        const jpeg = btoa('JPEGDATA');
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => {
          if (n === 'TdDoc') return { isAvailable: async () => ({ available: true }),
            scanDocument: async () => ({ pages: ['/walk/p1.jpg', '/walk/p2.jpg'], cancelled: false }) };
          if (n === 'TdScan') return { readFile: async ({ offset }) => offset ? { b64: '', size: 8 } : { b64: jpeg, size: 8 } };
          return {};
        } };
        const all = [];
        await _rcptNativeScan(async b => { all.push(b.size); }, true);
        const first = [];
        await _rcptNativeScan(async b => { first.push(b.size); }, false);
        // Read failure: no plugin reader, and a convertFileSrc that throws,
        // so no network request happens (WebKit logs unsupported-scheme
        // fetches as console errors, which is noise, not the app failing).
        window.Capacitor = { isNativePlatform: () => true,
          convertFileSrc: () => { throw new Error('no bridge'); },
          registerPlugin: (n) => {
            if (n === 'TdDoc') return { isAvailable: async () => ({ available: true }),
              scanDocument: async () => ({ pages: ['/walk/px.jpg'], cancelled: false }) };
            if (n === 'TdScan') return {};
            return {};
          } };
        const none = [];
        await _rcptNativeScan(async b => { none.push(1); }, true);
        return {
          allPages: all.length, allBytes: all[0],
          firstOnly: first.length,
          noneDelivered: none.length,
          oldUiNotResurrected: !document.getElementById('live-scan-ui'),
        };
      } finally {
        window.Capacitor = realCap; _rcptNativeOk = realOk;
        document.getElementById('live-scan-ui')?.remove();
      }
    });
    expect(r.allPages, 'every page the user kept becomes an expense page').toBe(2);
    expect(r.allBytes, 'bytes arrive through the plugin reader, not convertFileSrc').toBe(8);
    expect(r.firstOnly, 'the AI path still reads one receipt').toBe(1);
    expect(r.noneDelivered).toBe(0);
    expect(r.oldUiNotResurrected, 'a read hiccup after a real capture never reopens the canvas scanner').toBe(true);
  });

  test('the expense chooser buttons carry no stale sublabels', async () => {
    const r = await page.evaluate(() => {
      openExpenseFlow();
      const ov = document.getElementById('expense-modal');
      const html = ov ? ov.innerHTML : '';
      if (typeof closeExpenseFlow === 'function') closeExpenseFlow(); else ov?.remove();
      return {
        opened: !!html,
        scan: /Scan receipt/.test(html), attach: /Attach photo/.test(html),
        aiGone: !/AI fills fields/.test(html),
        signInGone: !/No sign-in needed/.test(html),
      };
    });
    expect(r.opened).toBe(true);
    expect(r.scan).toBe(true);
    expect(r.attach).toBe(true);
    expect(r.aiGone, 'owner 2026-08-10: that sublabel goes away').toBe(true);
    expect(r.signInGone).toBe(true);
  });

  test('no console errors across the receipt scanner suite', async () => { await assertNoErrors(page); });
});
