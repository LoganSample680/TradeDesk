// @ts-check
// ── Security lockdown (owner "go", 2026-09-27) ──────────────────────────────
//
// The public QR / intake form takes anonymous inserts into inbound_leads, and
// what a stranger typed there used to reach innerHTML in the contractor's own
// app: the new-lead toast, the review card, and after "Add to pipeline" every
// screen that prints the client. The root cause was that showToast, zConfirm,
// zAlert and zPrompt rendered their message as HTML. They are TEXT now, with
// an explicit {html:true} for markup the caller built itself.
//
// Also covered here, one describe each: the /img proxy only ever serves
// images, the _headers file carries the anti-framing headers, the service
// worker caches only the app shell, sign-out leaves nothing of the business on
// the phone, removing a crew member cuts access on the server, and a lead that
// merely CLAIMS a client_id is never merged into that customer.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P_IMG = '<img src=x onerror="window.__xss=1">';
const P_QUOTE = "');window.__xss=1;//";
const P_JS = 'javascript:window.__xss=1';

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
  return page;
}

test.describe('shared prompts render text by default', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.afterEach(async () => { assertNoErrors(page, 'security lockdown prompts'); });

  test('showToast: a hostile message is text, the HTML opt-in still renders markup', async () => {
    const r = await page.evaluate(async (P) => {
      document.querySelectorAll('.toast').forEach(t => t.remove());
      showToast(P, '✓', 60000);
      const t = document.querySelector('.toast:last-of-type');
      const plain = { imgs: t.querySelectorAll('.toast-msg img').length, text: t.querySelector('.toast-msg').textContent };
      showToast('Back <b class="opt-in">soon</b>', '✓', 60000, { html: true });
      const all = document.querySelectorAll('.toast');
      const optIn = !!all[all.length - 1].querySelector('.toast-msg b.opt-in');
      await new Promise(res => setTimeout(res, 150));
      document.querySelectorAll('.toast').forEach(x => x.remove());
      return { plain, optIn, xss: window.__xss === 1 };
    }, P_IMG);
    expect(r.plain.imgs).toBe(0);
    expect(r.plain.text).toBe(P_IMG);
    expect(r.optIn).toBe(true);
    expect(r.xss).toBe(false);
  });

  test('zConfirm, zAlert, zPrompt: message, title and button labels are text; {html:true} renders', async () => {
    const r = await page.evaluate(async (P) => {
      const out = {};
      const grab = () => { const o = document.querySelector('.zmodal-overlay:last-of-type'); const res = {
        imgs: o.querySelectorAll('img').length,
        msg: o.querySelector('.zmodal-msg').textContent,
        title: o.querySelector('.zmodal-title').textContent }; o.remove(); return res; };
      zConfirm(P, () => {}, { title: P, yes: P, no: P });
      const yes = document.querySelector('#zmodal-yes').textContent;
      const no = document.querySelector('.zmodal-cancel').textContent;
      out.confirm = Object.assign(grab(), { yes, no });
      zAlert(P, { title: P });
      out.alert = grab();
      zPrompt(P, () => {}, { title: P, placeholder: '"><img src=x onerror="window.__xss=1">' });
      out.promptPh = document.querySelector('#zprompt-inp').placeholder;
      out.prompt = grab();
      zAlert('<b class="opt-in">markup</b>', { title: '<i class="opt-t">t</i>', html: true });
      const o = document.querySelector('.zmodal-overlay:last-of-type');
      out.optIn = !!o.querySelector('.zmodal-msg b.opt-in') && !!o.querySelector('.zmodal-title i.opt-t');
      o.remove();
      await new Promise(res => setTimeout(res, 150));
      out.xss = window.__xss === 1;
      return out;
    }, P_IMG);
    for (const k of ['confirm', 'alert', 'prompt']) {
      expect(r[k].imgs, k).toBe(0);
      expect(r[k].msg, k).toBe(P_IMG);
      expect(r[k].title, k).toBe(P_IMG);
    }
    expect(r.confirm.yes).toBe(P_IMG);
    expect(r.confirm.no).toBe(P_IMG);
    expect(r.promptPh).toContain('<img');
    expect(r.optIn).toBe(true);
    expect(r.xss).toBe(false);
  });

  test('_jsArg carries a quote-breaking string into an inline handler intact', async () => {
    const r = await page.evaluate((P) => {
      window.__got = null;
      const d = document.createElement('div');
      d.innerHTML = '<button id="_jsarg_t" onclick="window.__got=(' + _jsArg(P) + ')">x</button>';
      document.body.appendChild(d);
      d.querySelector('button').click();
      d.remove();
      return { got: window.__got, xss: window.__xss === 1, nul: _jsArg(null), init: initials('<img src=x>') + '|' + initials('Ann <b>Lee</b>') };
    }, P_QUOTE);
    expect(r.got).toBe(P_QUOTE);
    expect(r.xss).toBe(false);
    expect(r.nul).toBe('&quot;&quot;');
    expect(r.init).not.toMatch(/[<>&"']/);
  });
});

test.describe('a hostile lead from the public form stays inert end to end', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.afterEach(async () => { assertNoErrors(page, 'security lockdown leads'); });

  // A chainable stub for every table, so update().eq() and select() resolve.
  const STUB = `(() => { const c = { eq: () => c, in: () => c, select: () => c, order: () => c, maybeSingle: () => Promise.resolve({ data: null, error: null }),
      update: () => c, then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; return () => c; })()`;

  test('new-lead toast, review card and Add to pipeline render the payload as text', async () => {
    const r = await page.evaluate(async ({ P, Q, J, STUB }) => {
      const savedFrom = _supa.from; _supa.from = eval(STUB);
      document.querySelectorAll('.toast').forEach(t => t.remove());
      const row = { id: 'lead-x1', status: 'pending', name: P, phone: Q, addr: P, notes: P, source: P };
      _pendingInbound = [];
      _onNewInboundLead(row);
      const toast = document.querySelector('.toast');
      const out = { toastImgs: toast ? toast.querySelectorAll('img').length : -1, toastText: toast ? toast.textContent : '' };
      const holder = document.createElement('div'); holder.id = '_sec_holder';
      holder.innerHTML = _inboundReviewHTML();
      document.body.appendChild(holder);
      out.cardImgs = holder.querySelectorAll('img').length;
      out.cardText = holder.textContent;
      out.jsHrefs = [...holder.querySelectorAll('[href]')].filter(a => /^\s*javascript:/i.test(a.getAttribute('href'))).length;
      const btn = holder.querySelector('button[data-inbound-id]');
      out.btnId = btn && btn.dataset.inboundId;
      btn.click();
      await new Promise(res => setTimeout(res, 400));
      holder.remove();
      const c = clients.find(x => x.name === P);
      out.promoted = !!c;
      out.promotedId = c && c.id;
      out.stillPending = _pendingInbound.length;
      out.docImgs = document.querySelectorAll('img[src="x"]').length;
      _supa.from = savedFrom;
      document.querySelectorAll('.toast,.zmodal-overlay').forEach(t => t.remove());
      out.xss = window.__xss === 1;
      void J;
      return out;
    }, { P: P_IMG, Q: P_QUOTE, J: P_JS, STUB });
    expect(r.toastImgs).toBe(0);
    expect(r.toastText).toContain(P_IMG);
    expect(r.cardImgs).toBe(0);
    expect(r.cardText).toContain(P_IMG);
    expect(r.cardText).toContain(P_QUOTE);
    expect(r.jsHrefs).toBe(0);
    expect(r.btnId).toBe('lead-x1');
    expect(r.promoted).toBe(true);
    expect(r.stillPending).toBe(0);
    expect(r.docImgs).toBe(0);
    expect(r.xss).toBe(false);
  });

  test('the promoted client is inert on the collect list, the lien text prompt and the review request', async () => {
    const r = await page.evaluate(async ({ P, Q, STUB }) => {
      const savedFrom = _supa.from; _supa.from = eval(STUB);
      const cid = 88001, bidId = 88002;
      clients.push({ id: cid, name: P, phone: Q, addr: P, created: todayKey(), clientToken: 'tok88001' });
      bids.push({ id: bidId, client_id: cid, client_name: P, amount: 900, status: 'Closed Won', completion_date: todayKey(), addr: P });
      liens.push({ id: 88003, bid_id: bidId, status: 'filed' });
      const out = {};
      // Collect list (finance.js openCollectModal)
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      openCollectModal();
      let ov = document.querySelector('.zmodal-overlay');
      out.collectImgs = ov ? ov.querySelectorAll('img').length : -1;
      out.collectText = ov ? ov.textContent.includes(P) : false;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      // Lien release: the "send release confirmation" confirm names the client (bids.js)
      releaseLien(bidId);
      document.querySelector('#zmodal-yes').click();
      await new Promise(res => setTimeout(res, 700));
      const sendOv = [...document.querySelectorAll('.zmodal-overlay')].find(o => o.textContent.includes('Send release confirmation text to'));
      out.lienFound = !!sendOv;
      out.lienImgs = sendOv ? sendOv.querySelectorAll('img').length : -1;
      out.lienText = sendOv ? sendOv.querySelector('.zmodal-msg').textContent.includes(P) : false;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      // Review request: the phone goes into an inline handler (jobs.js)
      const realSend = window._sendReviewRequest;
      let got = null; window._sendReviewRequest = (ph) => { got = ph; };
      showReviewRequestPrompt(cid);
      ov = document.querySelector('.zmodal-overlay');
      out.reviewImgs = ov ? ov.querySelectorAll('img').length : -1;
      const sendBtn = ov && [...ov.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('_sendReviewRequest'));
      if (sendBtn) sendBtn.click();
      out.reviewArg = got;
      window._sendReviewRequest = realSend;
      document.querySelectorAll('.zmodal-overlay,.toast').forEach(o => o.remove());
      // Clean up the fixtures.
      const bi = bids.findIndex(b => b.id === bidId); if (bi > -1) bids.splice(bi, 1);
      const li = liens.findIndex(l => l.id === 88003); if (li > -1) liens.splice(li, 1);
      const ci = clients.findIndex(c => c.id === cid); if (ci > -1) clients.splice(ci, 1);
      _supa.from = savedFrom;
      await new Promise(res => setTimeout(res, 150));
      out.xss = window.__xss === 1;
      return out;
    }, { P: P_IMG, Q: P_QUOTE, STUB });
    expect(r.collectImgs).toBe(0);
    expect(r.collectText).toBe(true);
    expect(r.lienFound).toBe(true);
    expect(r.lienImgs).toBe(0);
    expect(r.lienText).toBe(true);
    expect(r.reviewImgs).toBe(0);
    expect(r.reviewArg).toBe(P_QUOTE);
    expect(r.xss).toBe(false);
  });

  test('a crew name from the permission request toast is text', async () => {
    const r = await page.evaluate(async ({ P, STUB }) => {
      const savedFrom = _supa.from; _supa.from = eval(STUB);
      const savedUser = _supaUser; _supaUser = savedUser || { id: 'sec-owner' };
      document.querySelectorAll('.toast').forEach(t => t.remove());
      _pendingPermReqs = [{ id: 'req-sec-1', employee_name: P, employee_email: 'crew@example.com' }];
      await _approvePermissionRequest('req-sec-1');
      const t = [...document.querySelectorAll('.toast')].find(x => x.textContent.includes('Estimate access granted'));
      const out = { found: !!t, imgs: t ? t.querySelectorAll('img').length : -1, text: t ? t.textContent.includes(P) : false };
      document.querySelectorAll('.toast').forEach(x => x.remove());
      _supa.from = savedFrom; _supaUser = savedUser;
      await new Promise(res => setTimeout(res, 150));
      out.xss = window.__xss === 1;
      return out;
    }, { P: P_IMG, STUB });
    expect(r.found).toBe(true);
    expect(r.imgs).toBe(0);
    expect(r.text).toBe(true);
    expect(r.xss).toBe(false);
  });

  test('a lead that only CLAIMS a client_id is not merged; a matching hub token is', async () => {
    const r = await page.evaluate(async ({ STUB }) => {
      const savedFrom = _supa.from; _supa.from = eval(STUB);
      const realOpen = window.openClientDetail; window.openClientDetail = () => {};
      const cid = 88101;
      clients.push({ id: cid, name: 'Real Customer', notes: 'original', clientToken: 'tok-real-88101' });
      const c = clients.find(x => x.id === cid);
      _pendingInbound = []; _processedInboundIds.clear();
      const out = {};
      // 1. Guessed id, no token: queued for review, customer untouched.
      _onNewInboundLead({ id: 'g1', status: 'pending', client_id: cid, notes: 'INJECTED', source: 'onboard_link' });
      out.noTokenNotes = c.notes;
      out.noTokenQueued = _pendingInbound.some(x => x.id === 'g1');
      // 2. Wrong token: same.
      _onNewInboundLead({ id: 'g2', status: 'pending', client_id: cid, hub_token: 'nope', notes: 'INJECTED2', source: 'onboard_link' });
      out.wrongTokenNotes = c.notes;
      out.wrongTokenQueued = _pendingInbound.some(x => x.id === 'g2');
      // The review card says it is unverified and names the claimed customer.
      out.cardSaysUnverified = /Not verified/.test(_inboundReviewHTML());
      // 3. The real hub token: merged on its own, like before.
      _onNewInboundLead({ id: 'g3', status: 'pending', client_id: cid, hub_token: 'tok-real-88101', notes: 'from the hub', source: 'onboard_link' });
      out.tokenNotes = c.notes;
      out.tokenQueued = _pendingInbound.some(x => x.id === 'g3');
      _pendingInbound = []; _processedInboundIds.clear();
      const ci = clients.findIndex(x => x.id === cid); if (ci > -1) clients.splice(ci, 1);
      window.openClientDetail = realOpen; _supa.from = savedFrom;
      document.querySelectorAll('.toast').forEach(x => x.remove());
      return out;
    }, { STUB });
    expect(r.noTokenNotes).toBe('original');
    expect(r.noTokenQueued).toBe(true);
    expect(r.wrongTokenNotes).toBe('original');
    expect(r.wrongTokenQueued).toBe(true);
    expect(r.cardSaysUnverified).toBe(true);
    expect(r.tokenNotes).toBe('original\nfrom the hub');
    expect(r.tokenQueued).toBe(false);
  });

  test('removeEmployee deactivates the crew member on the server: RPC first, direct update as the fallback', async () => {
    const r = await page.evaluate(async () => {
      const savedFrom = _supa.from, savedRpc = _supa.rpc, savedUser = _supaUser;
      _supaUser = savedUser || { id: 'sec-owner' };
      const calls = [];
      _supa.from = (t) => { const c = {
        select: () => c, eq: (k, v) => { calls.push(['eq', t, k, v]); return c; },
        maybeSingle: () => Promise.resolve({ data: { id: 'm-77' }, error: null }),
        update: (v) => { calls.push(['update', t, v]); return c; },
        then: (f) => Promise.resolve({ data: null, error: null }).then(f) }; return c; };
      const savedEmps = S.employees;
      const out = {};
      // RPC present.
      S.employees = [{ id: 'e1', name: 'Gone', email: 'gone@example.com' }];
      _supa.rpc = (fn, args) => { calls.push(['rpc', fn, args]); return Promise.resolve({ data: null, error: null }); };
      out.okRes = await removeEmployee(0);
      out.okLocal = S.employees.length;
      out.okRpc = calls.filter(c => c[0] === 'rpc').map(c => [c[1], c[2]]);
      out.okUpdates = calls.filter(c => c[0] === 'update').length;
      calls.length = 0;
      // RPC missing (before the migration lands): falls back to active=false.
      S.employees = [{ id: 'e2', name: 'Gone Too', email: 'gone2@example.com' }];
      _supa.rpc = (fn, args) => { calls.push(['rpc', fn, args]); return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }); };
      out.fbRes = await removeEmployee(0);
      out.fbUpdate = calls.filter(c => c[0] === 'update').map(c => [c[1], c[2]]);
      out.fbEqId = calls.filter(c => c[0] === 'eq' && c[2] === 'id').map(c => c[3]);
      calls.length = 0;
      // Never invited (no email): local only, nothing sent.
      S.employees = [{ id: 'e3', name: 'Local Only' }];
      out.localRes = await removeEmployee(0);
      out.localCalls = calls.length;
      S.employees = savedEmps; _supa.from = savedFrom; _supa.rpc = savedRpc; _supaUser = savedUser;
      document.querySelectorAll('.toast,.zmodal-overlay').forEach(x => x.remove());
      return out;
    });
    expect(r.okRes).toBe(true);
    expect(r.okLocal).toBe(0);
    expect(r.okRpc).toEqual([['remove_crew_member', { p_member_id: 'm-77' }]]);
    expect(r.okUpdates).toBe(0);
    expect(r.fbRes).toBe(true);
    expect(r.fbUpdate).toEqual([['team_members', { active: false }]]);
    expect(r.fbEqId).toEqual(['m-77']);
    expect(r.localRes).toBe(false);
    expect(r.localCalls).toBe(0);
  });
});

test.describe('sign-out leaves nothing of the business on a shared phone', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.afterEach(async () => { assertNoErrors(page, 'security lockdown sign-out'); });

  test('zp3_S, zp3_logo, Venmo, Bitly, address, office and account caches are gone; device prefs stay', async () => {
    const r = await page.evaluate(() => {
      S.bname = 'Secret Plumbing'; S.baddr = '1 Private Rd'; S.officeLat = 37.1; S.officeLon = -97.2;
      S.venmoUser = 'secret-venmo'; S.bitlyKey = 'bitly-secret'; S.logoData = 'data:image/png;base64,AAAA';
      S.salesTaxRate = 9.5; S.darkMode = true; S.hapticsOff = true;
      contracts = [{ id: 1, name: 'c' }]; photos = [{ id: 2 }];
      saveAll();
      localStorage.setItem('zp3_logo', 'data:image/png;base64,BBBB');
      localStorage.setItem('zp3_acct_sec-uid', '{"user":{"id":"sec-uid"}}');
      localStorage.setItem('zp3_ops_since_sec-uid', '123');
      localStorage.setItem('zp3_remembered_login', '{"email":"me@example.com"}');
      const wasEmp = _isEmployee; _isEmployee = true; // the crew-phone case: saveAll skips the local write
      _wipeLocalAccountData();
      _isEmployee = wasEmp;
      const stored = JSON.parse(localStorage.getItem('zp3_S') || '{}');
      return {
        stored,
        mem: { bname: S.bname, baddr: S.baddr, officeLat: S.officeLat, venmo: S.venmoUser, bitly: S.bitlyKey, logo: S.logoData, tax: S.salesTaxRate, dark: S.darkMode, ts: S.settingsTs },
        logo: localStorage.getItem('zp3_logo'),
        acct: localStorage.getItem('zp3_acct_sec-uid'),
        ops: localStorage.getItem('zp3_ops_since_sec-uid'),
        contractsLs: localStorage.getItem('zp3_contracts'),
        photosLs: localStorage.getItem('zp3_photos'),
        contracts: contracts.length, photos: photos.length,
        remembered: localStorage.getItem('zp3_remembered_login'),
      };
    });
    expect(r.mem.bname).toBe('');
    expect(r.mem.baddr).toBe('');
    expect(r.mem.officeLat).toBe(0);
    expect(r.mem.venmo).toBeUndefined();
    expect(r.mem.bitly).toBe('');
    expect(r.mem.logo).toBe('');
    expect(r.mem.tax).toBe(0);
    expect(r.mem.ts).toBe(0);
    expect(r.mem.dark).toBe(true);
    expect(r.stored.bname).toBe('');
    expect(r.stored.baddr).toBe('');
    expect(r.stored.venmoUser).toBeUndefined();
    expect(r.stored.bitlyKey).toBe('');
    expect(r.stored.logoData).toBe('');
    expect(r.stored.officeLat).toBe(0);
    expect(r.stored.hapticsOff).toBe(true);
    expect(r.logo).toBeNull();
    expect(r.acct).toBeNull();
    expect(r.ops).toBeNull();
    expect(r.contractsLs).toBeNull();
    expect(r.photosLs).toBeNull();
    expect(r.contracts).toBe(0);
    expect(r.photos).toBe(0);
    expect(r.remembered).not.toBeNull();
  });
});

test.describe('static and edge rules (no browser)', () => {
  function loadImgFn(stubs) {
    const src = fs.readFileSync(path.join(ROOT, 'functions', 'img', '[[path]].js'), 'utf8').replace(/^export\s+/mg, '');
    return new Function('caches', 'fetch', src + '\nreturn onRequest;')(stubs.caches, stubs.fetch);
  }
  function cacheStub(hit) {
    const puts = [];
    return { puts, caches: { default: { match: async () => hit || undefined, put: async (k, v) => { puts.push(k.url); } } } };
  }
  const ctx = (url, next) => ({ request: new Request(url), waitUntil: undefined, next: next || (async () => new Response('static')) });

  test('/img proxy rejects text/html with 415, never caches it, and serves images with nosniff + a sandbox CSP', async () => {
    const c1 = cacheStub();
    const htmlFn = loadImgFn({ caches: c1.caches, fetch: async () => new Response('<script>alert(1)</script>', { headers: { 'Content-Type': 'text/html' } }) });
    const bad = await htmlFn(ctx('https://app.test/img/gallery/u1/evil.jpg'));
    expect(bad.status).toBe(415);
    expect(bad.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(c1.puts).toHaveLength(0);

    const c2 = cacheStub();
    const imgFn = loadImgFn({ caches: c2.caches, fetch: async () => new Response('PNG', { headers: { 'Content-Type': 'image/png' } }) });
    const ok = await imgFn(ctx('https://app.test/img/gallery/u1/photo-1.png'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('image/png');
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(ok.headers.get('Content-Disposition')).toBe('inline');
    const csp = ok.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(c2.puts).toHaveLength(1);

    // A poisoned entry cached before this fix is never served back.
    const c3 = cacheStub(new Response('<b>old</b>', { headers: { 'Content-Type': 'text/html' } }));
    let fetched = 0;
    const fn3 = loadImgFn({ caches: c3.caches, fetch: async () => { fetched++; return new Response('x', { headers: { 'Content-Type': 'text/html' } }); } });
    const r3 = await fn3(ctx('https://app.test/img/gallery/u1/old.jpg'));
    expect(fetched).toBe(1);
    expect(r3.status).toBe(415);

    // Missing content type is not assumed to be an image any more.
    const fn4 = loadImgFn({ caches: cacheStub().caches, fetch: async () => new Response('x') });
    const r4 = await fn4(ctx('https://app.test/img/gallery/u1/untyped'));
    expect(r4.status).toBe(415);

    // Non-gallery paths still fall through to static files.
    let nexted = false;
    const r5 = await imgFn(ctx('https://app.test/img/tim-dock.png', async () => { nexted = true; return new Response('static'); }));
    expect(nexted).toBe(true);
    expect(await r5.text()).toBe('static');
  });

  test('_headers frames the app to its own origin and sets nosniff and a referrer policy on every path', () => {
    const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
    const block = h.match(/^\/\*$\n((?:  .+\n)+)/m);
    expect(block, 'a /* rule').toBeTruthy();
    const b = block[1];
    expect(b).toMatch(/^  X-Frame-Options: SAMEORIGIN$/m);
    expect(b).toMatch(/^  X-Content-Type-Options: nosniff$/m);
    expect(b).toMatch(/^  Referrer-Policy: strict-origin-when-cross-origin$/m);
    const csp = (b.match(/^  Content-Security-Policy: (.+)$/m) || [])[1] || '';
    for (const d of ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    // Not script-src 'unsafe-inline' dressed up as protection.
    expect(csp).not.toContain('unsafe-inline');
  });

  test('the service worker caches only the app shell: never /img, /api or another origin', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const handlers = {};
    const self = { location: { origin: 'https://app.test' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] } };
    const cacheOps = [];
    const cachesStub = { match: async () => undefined, open: async () => ({ put: async (k) => { cacheOps.push(k.url || k); } }), keys: async () => [], delete: async () => true };
    new Function('self', 'caches', 'fetch', src)(self, cachesStub, async () => new Response('ok'));
    const intercepted = (url) => {
      let hit = false;
      handlers.fetch({ request: new Request(url), respondWith: () => { hit = true; } });
      return hit;
    };
    expect(intercepted('https://app.test/img/gallery/u1/photo.jpg')).toBe(false);
    expect(intercepted('https://app.test/img/tim.png')).toBe(false);
    expect(intercepted('https://app.test/api/rest/v1/td_clients')).toBe(false);
    expect(intercepted('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js')).toBe(false);
    expect(intercepted('https://fonts.gstatic.com/s/inter.woff2')).toBe(false);
    expect(intercepted('https://app.test/client.html?t=abc')).toBe(false);
    expect(intercepted('https://app.test/js/cloud.js')).toBe(true);
    expect(intercepted('https://app.test/css/timelog.css')).toBe(true);
    expect(intercepted('https://app.test/manifest.json')).toBe(true);
  });

  test('public pages load an exactly pinned supabase-js, never the floating @2 tag', () => {
    for (const f of ['client.html', 'intake.html', 'timesheet.html', 'contract-sign.html', 'sign.html']) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(html, f).not.toMatch(/supabase-js@2['"]/);
      expect(html, f).toMatch(/supabase-js@\d+\.\d+\.\d+\//);
    }
  });
});
