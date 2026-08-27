// @ts-check
// ── Share into a job (owner 2026-08-11) ──────────────────────────────────────
// Share > TradeDesk drops a photo into a shared inbox; the app asks which job.
//
// THE RULE THAT MATTERS MOST: nothing leaves the inbox until the bytes are
// safely on a job. iOS does not offer a shared file twice, so a premature
// delete loses a photo the crew cannot retake (they are off the site).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const ITEMS = [
  { path: '/g/td_share_1.jpg', name: 'td_share_1.jpg', size: 12, ts: 1 },
  { path: '/g/td_share_2.jpg', name: 'td_share_2.jpg', size: 12, ts: 2 },
];

// A stub whose read() streams a tiny payload in one chunk.
function stubCap(state) {
  return `window.Capacitor={isNativePlatform:()=>true,registerPlugin:(n)=>n==='TdShare'?{
    inbox:()=>Promise.resolve({items:${JSON.stringify(state.items)}}),
    read:(o)=>{window.__reads=(window.__reads||[]);window.__reads.push(o.path);
      return Promise.resolve({b64:btoa('hi'),size:2});},
    clear:(o)=>{window.__cleared=(window.__cleared||[]).concat(o&&o.paths?o.paths:['*ALL*']);return Promise.resolve();}
  }:null};`;
}

test.describe('Share inbox', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('browser and PWA: no plugin means no prompt and no error', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = undefined;
        const n = await checkSharedInbox({ force: true });
        return { n, ov: !!document.getElementById('_sharein-ov') };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.n).toBe(0);
    expect(r.ov).toBe(false);
  });

  test('picks the job, files every file, and clears ONLY what landed', async () => {
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, savedJobs = jobs.slice();
      window.__reads = []; window.__cleared = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdShare' ? {
            inbox: () => Promise.resolve({ items }),
            read: (o) => { window.__reads.push(o.path); return Promise.resolve({ b64: btoa('hi'), size: 2 }); },
            clear: (o) => { window.__cleared = window.__cleared.concat(o && o.paths ? o.paths : ['*ALL*']); return Promise.resolve(); },
          } : null,
        };
        jobs.length = 0;
        jobs.push({ id: 6001, name: 'Shared Job', client_id: null, status: 'upcoming', start: todayKey(), days: 1 });
        const n = await checkSharedInbox({ force: true });
        const shown = !!document.getElementById('_sharein-ov');
        const rows = document.querySelectorAll('#_sharein-ov ._si-job').length;
        document.querySelector('#_sharein-ov ._si-job').click();
        // The filing pipeline is genuinely async per file (read, attach,
        // compress). The overlay CLOSING is its completion signal; a fixed
        // sleep raced it and lost on a loaded webkit runner (2026-08-11).
        for (let w = 0; w < 80 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        const j = jobs.find(x => x.id === 6001);
        return {
          n, shown, rows,
          photos: (j.photos || []).length,
          reads: window.__reads.length,
          cleared: window.__cleared.slice(),
          gone: !document.getElementById('_sharein-ov'),
        };
      } finally {
        window.Capacitor = realCap; jobs.length = 0; savedJobs.forEach(x => jobs.push(x));
        document.getElementById('_sharein-ov')?.remove();
      }
    }, ITEMS);
    expect(r.n, 'both shared files are offered').toBe(2);
    expect(r.shown).toBe(true);
    expect(r.rows, "today's job is pickable").toBeGreaterThanOrEqual(1);
    expect(r.reads, 'each file is read back through the bridge').toBe(2);
    expect(r.photos, 'and lands on the job').toBe(2);
    expect(r.cleared.sort(), 'ONLY the files that landed are removed').toEqual(['/g/td_share_1.jpg', '/g/td_share_2.jpg']);
    expect(r.gone).toBe(true);
  });

  test('a file that will not read is never deleted', async () => {
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, savedJobs = jobs.slice();
      window.__cleared = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            inbox: () => Promise.resolve({ items }),
            // First file reads, second is unreadable (iOS reclaimed it).
            read: (o) => o.path.endsWith('1.jpg')
              ? Promise.resolve({ b64: btoa('hi'), size: 2 })
              : Promise.reject(new Error('gone')),
            clear: (o) => { window.__cleared = window.__cleared.concat(o.paths || []); return Promise.resolve(); },
          }),
        };
        jobs.length = 0;
        jobs.push({ id: 6002, name: 'Partial Job', status: 'upcoming', start: todayKey(), days: 1 });
        await checkSharedInbox({ force: true });
        document.querySelector('#_sharein-ov ._si-job').click();
        for (let w = 0; w < 80 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        const j = jobs.find(x => x.id === 6002);
        return { photos: (j.photos || []).length, cleared: window.__cleared.slice() };
      } finally {
        window.Capacitor = realCap; jobs.length = 0; savedJobs.forEach(x => jobs.push(x));
        document.getElementById('_sharein-ov')?.remove();
      }
    }, ITEMS);
    expect(r.photos, 'the readable one still lands').toBe(1);
    expect(r.cleared, 'the unreadable one stays for another try').toEqual(['/g/td_share_1.jpg']);
  });

  test('discard clears everything, Not now keeps it all', async () => {
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor;
      window.__cleared = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            inbox: () => Promise.resolve({ items }),
            read: () => Promise.resolve({ b64: btoa('hi'), size: 2 }),
            clear: (o) => { window.__cleared = window.__cleared.concat(o.paths || ['*ALL*']); return Promise.resolve(); },
          }),
        };
        await checkSharedInbox({ force: true });
        document.getElementById('_si-later').click();
        const afterLater = window.__cleared.length;
        await checkSharedInbox({ force: true });
        document.getElementById('_si-discard').click();
        for (let w = 0; w < 40 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        return { afterLater, afterDiscard: window.__cleared.length };
      } finally { window.Capacitor = realCap; document.getElementById('_sharein-ov')?.remove(); }
    }, ITEMS);
    expect(r.afterLater, 'Not now must never delete anything').toBe(0);
    expect(r.afterDiscard, 'discard removes them on purpose').toBe(2);
  });

  test('never interrupts mid-task: only on the dashboard, never over another popup', async () => {
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, startPg = document.querySelector('.pg.active')?.id;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({ inbox: () => Promise.resolve({ items }) }),
        };
        goPg('pg-money');
        const onOtherPage = await checkSharedInbox();
        goPg('pg-dash');
        const scrim = document.createElement('div');
        scrim.className = 'zmodal-overlay'; scrim.id = '_probe-ov';
        scrim.style.cssText = 'left:-9999px';
        document.body.appendChild(scrim);
        const overPopup = await checkSharedInbox();
        scrim.remove();
        const clean = await checkSharedInbox();
        document.getElementById('_sharein-ov')?.remove();
        return { onOtherPage, overPopup, clean };
      } finally {
        window.Capacitor = realCap; document.getElementById('_probe-ov')?.remove();
        document.getElementById('_sharein-ov')?.remove(); if (startPg) goPg(startPg);
      }
    }, ITEMS);
    expect(r.onOtherPage, 'never interrupts an estimate half-built').toBe(0);
    expect(r.overPopup, 'never stacks on another popup').toBe(0);
    expect(r.clean, 'asks when the coast is clear').toBe(2);
  });

  // ── Shared straight into an expense (owner ask 2026-08-26) ────────────────
  //
  // "Receipts from Home Depot pro accounts ... that can then drop expenses and
  // the actual receipt in, no scan needed."
  //
  // The share sheet delivers two different things and they are not the same
  // job. Forcing a receipt to become a job photo buries the money in a gallery,
  // which is the manual re-entry this whole feature exists to kill.

  test('the prompt offers the receipt path before the job list', async () => {
    const r = await page.evaluate(() => {
      // Jobs must exist or there IS no job list to be ahead of: the empty
      // state renders a tip instead of rows, indexOf returns -1, and the
      // ordering assertion becomes meaningless. (CI caught exactly that.)
      const savedJobs = window.jobs, savedClients = window.clients;
      try {
        window.clients = [{ id: 1, name: 'Marcy Feldman' }];
        window.jobs = [{ id: 11, name: 'Kitchen repaint', client_id: 1, addr: '412 Oak St',
                         start: (typeof todayKey === 'function' ? todayKey() : '') }];
        _shareInPrompt([{ path: '/x/a.jpg' }]);
        const ov = document.getElementById('_sharein-ov');
        const html = ov ? ov.innerHTML : '';
        const btn = document.getElementById('_si-receipt');
        const jobIdx = html.indexOf('_si-job');
        const rcIdx = html.indexOf('_si-receipt');
        return { has: !!btn, rcIdx, jobIdx,
                 text: btn ? btn.textContent : '' };
      } finally {
        document.getElementById('_sharein-ov')?.remove();
        window.jobs = savedJobs; window.clients = savedClients;
      }
    });
    expect(r.has, 'a receipt must not be forced into being a job photo').toBe(true);
    expect(r.jobIdx, 'the job list has to actually render, or the next assertion proves nothing')
      .toBeGreaterThan(-1);
    expect(r.rcIdx, 'the receipt is what someone went out of their way to share').toBeLessThan(r.jobIdx);
    expect(r.text).toMatch(/receipt/i);
  });

  // 15.1: nothing bleeds. The receipt button carries two stacked lines inside
  // a .btn, which is inline-flex + a fixed 36px height + white-space:nowrap,
  // and it pushed straight off the edge until it was overridden.
  test('the prompt does not bleed off screen at any supported width', async () => {
    for (const w of [390, 820]) {
      await page.setViewportSize({ width: w, height: 844 });
      const r = await page.evaluate(() => {
        try {
          _shareInPrompt([{ path: '/x/a.jpg' }, { path: '/x/b.jpg' }]);
          const btn = document.getElementById('_si-receipt');
          const br = btn.getBoundingClientRect();
          return { bleed: document.documentElement.scrollWidth - window.innerWidth,
                   right: br.right, inner: window.innerWidth,
                   h: Math.round(br.height) };
        } finally { document.getElementById('_sharein-ov')?.remove(); }
      });
      expect(r.bleed, 'horizontal bleed at ' + w).toBeLessThanOrEqual(1);
      expect(r.right, 'button past the edge at ' + w).toBeLessThanOrEqual(r.inner);
      expect(r.h, 'two lines must wrap, not collapse onto one at ' + w).toBeGreaterThan(40);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('a shared receipt is read on device, filed, and the inbox cleared', async () => {
    const r = await page.evaluate(async () => {
      const saved = { open: window.openExpenseFlow, ocr: window._rcptOcrLines,
                      parse: window._rcptParseLines, up: window._uploadReceiptToStorage,
                      comp: window.compressAndEncodeImage, st: window._expState,
                      render: window._renderExpPages, cap: window.Capacitor };
      const calls = { opened: 0, ocrPaths: [], cleared: [], uploaded: 0 };
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({
          read: ({ path }) => Promise.resolve({ b64: btoa('x'), size: 1 }),
          clear: ({ paths }) => { calls.cleared.push(...(paths || [])); return Promise.resolve({}); },
        }) };
        window._rcptOcrLines = (p) => { calls.ocrPaths.push(p); return Promise.resolve(['HOME DEPOT', 'TOTAL 128.44']); };
        window._rcptParseLines = () => ({ vendor: 'Home Depot', amount: '128.44' });
        window.compressAndEncodeImage = () => Promise.resolve('B64DATA');
        window._uploadReceiptToStorage = () => { calls.uploaded++; return Promise.resolve('key'); };
        window._renderExpPages = () => {};
        window._expState = { imagePages: [], imageData: null, hasReceipt: false };
        window.openExpenseFlow = () => {
          calls.opened++;
          ['em-vendor', 'em-amount'].forEach(id => {
            document.getElementById(id)?.remove();
            const i = document.createElement('input'); i.id = id; document.body.appendChild(i);
          });
        };
        const added = await _shareInAsReceipt([{ path: '/x/a.jpg' }, { path: '/x/b.jpg' }]);
        return { added, calls,
                 pages: window._expState.imagePages.length,
                 hasReceipt: window._expState.hasReceipt,
                 vendor: document.getElementById('em-vendor').value,
                 amount: document.getElementById('em-amount').value };
      } finally {
        window.openExpenseFlow = saved.open; window._rcptOcrLines = saved.ocr;
        window._rcptParseLines = saved.parse; window._uploadReceiptToStorage = saved.up;
        window.compressAndEncodeImage = saved.comp; window._expState = saved.st;
        window._renderExpPages = saved.render; window.Capacitor = saved.cap;
        ['em-vendor', 'em-amount'].forEach(id => document.getElementById(id)?.remove());
      }
    });
    expect(r.added, 'both pages of the receipt land').toBe(2);
    expect(r.calls.opened, 'it reuses the real expense flow, not a parallel one').toBe(1);
    expect(r.calls.ocrPaths, 'the FIRST page only: reading every page multiplies the wait')
      .toEqual(['/x/a.jpg']);
    expect(r.vendor, 'no scan needed is literal, the fields are filled before they look').toBe('Home Depot');
    expect(r.amount).toBe('128.44');
    expect(r.pages, 'several files are pages of ONE receipt, not several expenses').toBe(2);
    expect(r.hasReceipt).toBe(true);
    expect(r.calls.uploaded, 'the bytes go where every other receipt lives').toBe(2);
    expect(r.calls.cleared.sort(), 'and only then is the inbox cleared')
      .toEqual(['/x/a.jpg', '/x/b.jpg']);
  });

  test('a receipt that cannot be read is never cleared from the inbox', async () => {
    const r = await page.evaluate(async () => {
      const saved = { open: window.openExpenseFlow, ocr: window._rcptOcrLines,
                      st: window._expState, cap: window.Capacitor };
      const cleared = [];
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({
          read: () => Promise.resolve(null),
          clear: ({ paths }) => { cleared.push(...(paths || [])); return Promise.resolve({}); },
        }) };
        window._rcptOcrLines = () => Promise.reject(new Error('no vision'));
        window._expState = { imagePages: [], imageData: null, hasReceipt: false };
        window.openExpenseFlow = () => {};
        const added = await _shareInAsReceipt([{ path: '/x/a.jpg' }]);
        return { added, cleared };
      } finally {
        window.openExpenseFlow = saved.open; window._rcptOcrLines = saved.ocr;
        window._expState = saved.st; window.Capacitor = saved.cap;
      }
    });
    expect(r.added).toBe(0);
    expect(r.cleared, 'a shared file iOS never offers again is not something to be casual with')
      .toEqual([]);
  });

  test('OCR failing still opens the expense, just empty', async () => {
    const r = await page.evaluate(async () => {
      const saved = { open: window.openExpenseFlow, ocr: window._rcptOcrLines,
                      comp: window.compressAndEncodeImage, st: window._expState,
                      render: window._renderExpPages, up: window._uploadReceiptToStorage,
                      cap: window.Capacitor };
      let opened = 0;
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({
          read: () => Promise.resolve({ b64: btoa('x'), size: 1 }),
          clear: () => Promise.resolve({}),
        }) };
        window._rcptOcrLines = () => Promise.resolve([]);
        window.compressAndEncodeImage = () => Promise.resolve('B64');
        window._uploadReceiptToStorage = () => Promise.resolve('k');
        window._renderExpPages = () => {};
        window._expState = { imagePages: [], imageData: null, hasReceipt: false };
        window.openExpenseFlow = () => { opened++; };
        const added = await _shareInAsReceipt([{ path: '/x/a.jpg' }]);
        return { added, opened };
      } finally {
        window.openExpenseFlow = saved.open; window._rcptOcrLines = saved.ocr;
        window.compressAndEncodeImage = saved.comp; window._expState = saved.st;
        window._renderExpPages = saved.render; window._uploadReceiptToStorage = saved.up;
        window.Capacitor = saved.cap;
      }
    });
    expect(r.opened, 'an unreadable total is a typing job, not a dead end').toBe(1);
    expect(r.added).toBe(1);
  });

  test('no expense flow at all is a no-op, never a throw', async () => {
    const r = await page.evaluate(async () => {
      const saved = window.openExpenseFlow;
      try {
        window.openExpenseFlow = undefined;
        return { n: await _shareInAsReceipt([{ path: '/x/a.jpg' }]), threw: false };
      } catch (e) { return { threw: true, msg: String(e && e.message) }; }
      finally { window.openExpenseFlow = saved; }
    });
    expect(r.threw).toBe(false);
    expect(r.n).toBe(0);
  });

  test('no console errors during share inbox tests', async () => {
    assertNoErrors(page, 'share inbox');
  });
});
