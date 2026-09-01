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

  test('picks the client, files every file, and clears ONLY what landed', async () => {
    // The destination changed from a job to a client (owner, 2026-09-01:
    // "images go to the client hub where images land where they are supposed
    // to"). A photo now lands in the global photos[] array carrying a
    // client_id and a null job_id, which is exactly what client.html renders
    // under "Other photos".
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, savedClients = clients.slice(), savedPhotos = photos.slice();
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
        clients.length = 0;
        clients.push({ id: 7001, name: 'Shared Client', addr: '1 Main St' });
        photos.length = 0;
        const n = await checkSharedInbox({ force: true });
        const shown = !!document.getElementById('_sharein-ov');
        const rows = document.querySelectorAll('#_sharein-ov ._si-client').length;
        document.querySelector('#_sharein-ov ._si-client').click();
        // The filing pipeline is genuinely async per file (read, compress,
        // upload, thumbnail). The overlay CLOSING is its completion signal; a
        // fixed sleep raced it and lost on a loaded webkit runner (2026-08-11).
        for (let w = 0; w < 80 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        const landed = photos.filter(p => String(p.client_id) === '7001');
        return {
          n, shown, rows,
          landed: landed.length,
          jobIds: landed.map(p => p.job_id),
          named: landed.every(p => p.client_name === 'Shared Client'),
          urls: landed.every(p => !!p.url && !!p.storagePath),
          reads: window.__reads.length,
          cleared: window.__cleared.slice(),
          gone: !document.getElementById('_sharein-ov'),
        };
      } finally {
        window.Capacitor = realCap;
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        photos.length = 0; savedPhotos.forEach(x => photos.push(x));
        document.getElementById('_sharein-ov')?.remove();
      }
    }, ITEMS);
    expect(r.n, 'both shared files are offered').toBe(2);
    expect(r.shown).toBe(true);
    expect(r.rows, 'the client is pickable').toBeGreaterThanOrEqual(1);
    expect(r.reads, 'each file is read back through the bridge').toBe(2);
    expect(r.landed, 'and lands in the gallery the client hub reads').toBe(2);
    expect(r.jobIds, 'a client photo carries no job, that is what puts it in the hub')
      .toEqual([null, null]);
    expect(r.named, 'the client name rides along so the hub can label it').toBe(true);
    expect(r.urls, 'a record with no url is a broken thumbnail forever').toBe(true);
    expect(r.cleared.sort(), 'ONLY the files that landed are removed').toEqual(['/g/td_share_1.jpg', '/g/td_share_2.jpg']);
    expect(r.gone).toBe(true);
  });

  test('a file that will not read is never deleted', async () => {
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, savedClients = clients.slice(), savedPhotos = photos.slice();
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
        clients.length = 0;
        clients.push({ id: 7002, name: 'Partial Client' });
        photos.length = 0;
        await checkSharedInbox({ force: true });
        document.querySelector('#_sharein-ov ._si-client').click();
        for (let w = 0; w < 80 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        return { landed: photos.filter(p => String(p.client_id) === '7002').length, cleared: window.__cleared.slice() };
      } finally {
        window.Capacitor = realCap;
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        photos.length = 0; savedPhotos.forEach(x => photos.push(x));
        document.getElementById('_sharein-ov')?.remove();
      }
    }, ITEMS);
    expect(r.landed, 'the readable one still lands').toBe(1);
    expect(r.cleared, 'the unreadable one stays for another try').toEqual(['/g/td_share_1.jpg']);
  });

  test('offline, a shared photo is never lost and never falsely confirmed', async () => {
    // There is no client-side pending-photo queue on purpose: the file is
    // already sitting in the App Group container, which IS a durable queue, so
    // a failed upload must leave it there rather than park megabytes of base64
    // in a synced table. The failure mode this guards is the ugly one: telling
    // the contractor the photo landed, clearing the inbox, and losing it.
    const r = await page.evaluate(async (items) => {
      const realCap = window.Capacitor, realSupa = window._supa;
      const savedClients = clients.slice(), savedPhotos = photos.slice();
      window.__cleared = [];
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            inbox: () => Promise.resolve({ items }),
            read: () => Promise.resolve({ b64: btoa('hi'), size: 2 }),
            clear: (o) => { window.__cleared = window.__cleared.concat(o.paths || []); return Promise.resolve(); },
          }),
        };
        clients.length = 0;
        clients.push({ id: 7003, name: 'Offline Client' });
        photos.length = 0;
        window._supa = null;                       // the backend is simply gone
        await checkSharedInbox({ force: true });
        document.querySelector('#_sharein-ov ._si-client').click();
        for (let w = 0; w < 80 && document.getElementById('_sharein-ov'); w++) await new Promise(res => setTimeout(res, 50));
        return { landed: photos.length, cleared: window.__cleared.slice() };
      } finally {
        window.Capacitor = realCap; window._supa = realSupa;
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        photos.length = 0; savedPhotos.forEach(x => photos.push(x));
        document.getElementById('_sharein-ov')?.remove();
      }
    }, ITEMS);
    expect(r.cleared, 'nothing may be deleted when nothing was uploaded').toEqual([]);
    expect(r.landed, 'and no phantom record is written').toBe(0);
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

  test('the prompt offers the receipt path before the client list', async () => {
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
        const jobIdx = html.indexOf('_si-client');
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

  // ── A contact shared from iOS Contacts (owner 2026-08-28) ─────────────────
  // The other contacts route is dead on iOS: the Web Contact Picker API has
  // never shipped in Safari or WKWebView, so js/clients.js hides that button
  // and an iPhone contractor had no way to import a contact at all. The share
  // sheet is the way in, and _parseVCard already read the address.
  // Real newlines, not escaped ones: _parseVCard anchors on ^FN / ^ADR with
  // the multiline flag, so a fixture carrying literal backslash-n parses as
  // one long line and silently matches nothing.
  const VCF = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Dana Reyes', 'TEL:785-555-0142',
    'EMAIL:dana@example.com', 'ADR;TYPE=HOME:;;418 SW Oakley Ave;Topeka;KS;66606;USA',
    'END:VCARD',
  ].join('\n');

  test('a shared .vcf becomes a client WITH the address off the contact card', async () => {
    const r = await page.evaluate(async (vcf) => {
      const realCap = window.Capacitor, realPrev = window._showImportPreview;
      let seen = null;
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => n === 'TdShare' ? {
          inbox: () => Promise.resolve({ items: [{ path: '/x/td_share_1_a.vcf' }] }),
          read: () => Promise.resolve({ b64: btoa(vcf), size: vcf.length }),
          clear: (o) => { window.__cleared = (o && o.paths) || []; return Promise.resolve(); },
        } : null };
        window._showImportPreview = (parsed) => { seen = parsed; };
        const n = await _shareInAsContacts([{ path: '/x/td_share_1_a.vcf' }]);
        return { n, seen, cleared: window.__cleared || [] };
      } finally { window.Capacitor = realCap; window._showImportPreview = realPrev; delete window.__cleared; }
    }, VCF);
    expect(r.n).toBe(1);
    expect(r.seen[0].name).toBe('Dana Reyes');
    expect(r.seen[0].phone).toContain('555-0142');
    expect(r.seen[0].addr, 'the whole point: the street off the contact').toBe('418 SW Oakley Ave');
    expect(r.seen[0].city).toBe('Topeka');
    expect(r.seen[0].state).toBe('KS');
    expect(r.seen[0].zip).toBe('66606');
    expect(r.cleared, 'a successful import clears the inbox').toContain('/x/td_share_1_a.vcf');
  });

  test('a file with no contact in it is NEVER cleared: it stays to try again', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor, realPrev = window._showImportPreview;
      let called = 0;
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => n === 'TdShare' ? {
          inbox: () => Promise.resolve({ items: [] }),
          read: () => Promise.resolve({ b64: btoa('not a contact at all'), size: 20 }),
          clear: (o) => { window.__cleared = (o && o.paths) || []; return Promise.resolve(); },
        } : null };
        window._showImportPreview = () => { called++; };
        const n = await _shareInAsContacts([{ path: '/x/td_share_2_b.vcf' }]);
        return { n, called, cleared: window.__cleared };
      } finally { window.Capacitor = realCap; window._showImportPreview = realPrev; delete window.__cleared; }
    });
    expect(r.n).toBe(0);
    expect(r.called, 'nothing parsed means no preview').toBe(0);
    expect(r.cleared, 'the file must survive for a retry').toBeUndefined();
  });

  test('a shared .vcf is typed as a contact, not as a JPEG', async () => {
    const t = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: (n) => n === 'TdShare' ? {
          read: () => Promise.resolve({ b64: btoa('BEGIN:VCARD'), size: 11 }),
        } : null };
        const b = await _shareInRead('/x/td_share_3_c.vcf');
        return b && b.type;
      } finally { window.Capacitor = realCap; }
    });
    expect(t).toBe('text/vcard');
  });

  test('the contact fork is offered ONLY when a contact is actually shared', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const [k, items] of [['vcf', [{ path: '/x/a.vcf' }]], ['photo', [{ path: '/x/a.jpg' }]]]) {
        document.getElementById('_si-ov')?.remove();
        _shareInAsking = false;
        _shareInPrompt(items);
        out[k] = !!document.getElementById('_si-contact');
        document.getElementById('_si-ov')?.remove();
        _shareInAsking = false;
      }
      return out;
    });
    expect(r.vcf, 'a shared contact must offer the client import').toBe(true);
    expect(r.photo, 'a photo must not offer "add as a client"').toBe(false);
  });

  test('a contact-only share asks the contact question and nothing else', async () => {
    // Leading with "A receipt / Reads the total off it" for a vCard is a
    // control whose value is not wired (15.1), and filing a .vcf into a job's
    // photo gallery buries the card where nobody looks. When every shared item
    // is a contact, the sheet asks the one thing that can actually happen.
    const r = await page.evaluate(() => {
      document.getElementById('_sharein-ov')?.remove();
      _shareInAsking = false;
      _shareInPrompt([{ path: '/x/a.vcf' }]);
      const ov = document.getElementById('_sharein-ov');
      const out = {
        contact: !!document.getElementById('_si-contact'),
        receipt: !!document.getElementById('_si-receipt'),
        jobs: ov ? ov.querySelectorAll('._si-client').length : -1,
        attachHdr: ov ? /Or add to a client/.test(ov.innerHTML) : true,
        title: ov ? (ov.querySelector('.zmodal-title') || {}).textContent : '',
        // Nothing may bleed off the edge of a phone (15.1).
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
      document.getElementById('_sharein-ov')?.remove();
      _shareInAsking = false;
      return out;
    });
    expect(r.contact, 'the only real action must still be offered').toBe(true);
    expect(r.receipt, 'a vCard has no total to read off it').toBe(false);
    expect(r.jobs, 'a contact card must not be offered as a job photo').toBe(0);
    expect(r.attachHdr, 'the attach-to-a-job header must go with its list').toBe(false);
    // The point is that the title names what was actually shared. Copy was
    // "1 contact card shared" and is now "1 contact shared" (it wrapped tight
    // against the modal edge at 390px); what must never come back is "1 file".
    expect(r.title).toContain('contact');
    expect(r.title, 'a contact is not a "file" to the person sharing it').not.toContain('file');
    expect(r.wide, 'the contact sheet must not bleed off a phone').toBe(false);
  });

  test('a mixed share still offers both forks', async () => {
    // The narrowing above keys off EVERY item being a contact. A receipt shared
    // alongside a contact is still a receipt, and must not lose its fork.
    const r = await page.evaluate(() => {
      document.getElementById('_sharein-ov')?.remove();
      _shareInAsking = false;
      _shareInPrompt([{ path: '/x/a.vcf' }, { path: '/x/b.jpg' }]);
      const ov = document.getElementById('_sharein-ov');
      const out = {
        contact: !!document.getElementById('_si-contact'),
        receipt: !!document.getElementById('_si-receipt'),
        attachHdr: ov ? /Or add to a client/.test(ov.innerHTML) : false,
      };
      document.getElementById('_sharein-ov')?.remove();
      _shareInAsking = false;
      return out;
    });
    expect(r.contact).toBe(true);
    expect(r.receipt, 'a photo in the same share still needs the receipt fork').toBe(true);
    expect(r.attachHdr).toBe(true);
  });

  test('a contact-only share never shows the sheet, it goes straight to the import', async () => {
    // Owner, 2026-09-01: make it smart about what was shared. A .vcf can only
    // ever be a contact, and the import preview it opens is itself the confirm
    // step, so asking "what is it?" in between was a tap that bought nothing.
    const r = await page.evaluate(async (vcf) => {
      const realCap = window.Capacitor, savedClients = clients.slice();
      const savedPreview = window._showImportPreview;
      window.__cleared = []; window.__preview = 0;
      try {
        window._showImportPreview = (list) => { window.__preview = list.length; };
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            inbox: () => Promise.resolve({ items: [{ path: '/x/td_share_c1.vcf' }] }),
            read: () => Promise.resolve({ b64: btoa(vcf), size: vcf.length }),
            clear: (o) => { window.__cleared = window.__cleared.concat(o.paths || []); return Promise.resolve(); },
          }),
        };
        _shareInAsking = false;
        const n = await checkSharedInbox({ force: true });
        return {
          n, preview: window.__preview,
          sheet: !!document.getElementById('_sharein-ov'),
          cleared: window.__cleared.slice(),
          asking: _shareInAsking,
        };
      } finally {
        window.Capacitor = realCap; window._showImportPreview = savedPreview;
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        document.getElementById('_sharein-ov')?.remove();
        _shareInAsking = false;
      }
    }, VCF);
    expect(r.sheet, 'no "what is it?" for something that can only be one thing').toBe(false);
    expect(r.preview, 'the import list opens directly').toBe(1);
    expect(r.cleared, 'and the card leaves the inbox once it is safely in the list')
      .toEqual(['/x/td_share_c1.vcf']);
    expect(r.asking, 'the guard must not stay latched or the next share is swallowed').toBe(false);
  });

  test('an UNREADABLE contact card still falls through to the sheet', async () => {
    // The only place with a Discard button is the sheet. Skipping straight to
    // the import for a card nothing can be parsed out of would toast the same
    // failure on every launch with no way to get rid of the file.
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            inbox: () => Promise.resolve({ items: [{ path: '/x/td_share_bad.vcf' }] }),
            read: () => Promise.resolve({ b64: btoa('this is not a vcard at all'), size: 26 }),
            clear: () => Promise.resolve(),
          }),
        };
        _shareInAsking = false;
        await checkSharedInbox({ force: true });
        return {
          sheet: !!document.getElementById('_sharein-ov'),
          discard: !!document.getElementById('_si-discard'),
        };
      } finally {
        window.Capacitor = realCap;
        document.getElementById('_sharein-ov')?.remove();
        _shareInAsking = false;
      }
    });
    expect(r.sheet, 'an unparseable card must still reach a screen').toBe(true);
    expect(r.discard, 'and that screen must offer the way out').toBe(true);
  });

  test('the client list is searchable, and still works after a search redraws it', async () => {
    // Twelve rows and no way to reach the rest is unusable at the 141 clients
    // the owner actually has. The redraw half matters just as much: handlers
    // bound to the buttons themselves would be destroyed by the first
    // keystroke, so the rows are wired by delegation and this proves it.
    const r = await page.evaluate(async () => {
      const savedClients = clients.slice(), realCap = window.Capacitor;
      try {
        clients.length = 0;
        for (let i = 0; i < 40; i++) clients.push({ id: 1750000000000 + i, name: 'Client ' + i, addr: i + ' Elm St' });
        clients.push({ id: 1760000000999, name: 'Zelda Nakamura', addr: '77 Kettle Ln' });
        window.__picked = null;
        window._shareInFileToClient = (items, id) => { window.__picked = String(id); return Promise.resolve({ done: 1, name: 'x' }); };
        document.getElementById('_sharein-ov')?.remove();
        _shareInAsking = false;
        _shareInPrompt([{ path: '/x/a.jpg' }]);
        const before = document.querySelectorAll('#_si-clist ._si-client').length;
        const box = document.getElementById('_si-csearch');
        box.value = 'Zelda';
        box.dispatchEvent(new Event('input'));
        const after = Array.from(document.querySelectorAll('#_si-clist ._si-client'));
        const names = after.map(b => b.querySelector('.si-t').textContent);
        after[0].click();
        for (let w = 0; w < 60 && !window.__picked; w++) await new Promise(res => setTimeout(res, 20));
        // And a search that matches an address, not a name.
        document.getElementById('_sharein-ov')?.remove();
        _shareInAsking = false;
        _shareInPrompt([{ path: '/x/a.jpg' }]);
        const b2 = document.getElementById('_si-csearch');
        b2.value = 'Kettle';
        b2.dispatchEvent(new Event('input'));
        const byAddr = Array.from(document.querySelectorAll('#_si-clist ._si-client'))
          .map(b => b.querySelector('.si-t').textContent);
        return { before, count: after.length, names, picked: window.__picked, byAddr };
      } finally {
        window.Capacitor = realCap;
        delete window._shareInFileToClient;
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        document.getElementById('_sharein-ov')?.remove();
        _shareInAsking = false;
      }
    });
    expect(r.before, 'the list still draws a capped page, not all 41 rows').toBe(12);
    expect(r.count, 'search narrows it').toBe(1);
    expect(r.names[0]).toBe('Zelda Nakamura');
    expect(r.picked, 'a row drawn BY the search must still be clickable').toBe('1760000000999');
    expect(r.byAddr, 'searching an address finds them too').toEqual(['Zelda Nakamura']);
  });

  test('no console errors during share inbox tests', async () => {
    assertNoErrors(page, 'share inbox');
  });
});
