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

  test('no console errors during share inbox tests', async () => {
    assertNoErrors(page, 'share inbox');
  });
});
