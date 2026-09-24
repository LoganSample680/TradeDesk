// @ts-check
/**
 * The proposal is the contractor's document, not ours.
 *
 * Owner, 2026-09-23: "I want a redesign, it has to look great and be white
 * labeled for business logos". His logo sits on white paper, where a dark
 * logo reads (the old navy slab swallowed them); no logo and his name is the
 * mark in his colour; his colour is the band across the top, the accents and
 * the price bar. Nothing on the page says TradeDesk.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const LOGO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#111"/></svg>').toString('base64');

test.describe('the proposal, white-labelled', () => {
  let page, ctx;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  const doc = (o) => page.evaluate(async (o) => {
    const keep = { logoData: S.logoData, logoUrl: S.logoUrl, logoHash: S.logoHash, brandColor: S.brandColor, bname: S.bname, blic: S.blic };
    bids.length = 0; clients.length = 0;
    clients.push({ id: 97101, name: 'Hetty Green', addr: '412 Bell St, Topeka, KS 66603' });
    currentClientId = 97101; _activeTrade = 'plumbing';
    S.logoData = o.logo || ''; S.logoUrl = o.logoUrl || ''; S.logoHash = o.logoHash || '';
    S.brandColor = o.brand || ''; S.bname = 'Pruitt Plumbing'; S.blic = 'KS-PL-4471';
    openGenericEstimate(getClientById(97101), null, null, { mode: 'byo' });
    _geiIsFreeForm = true; _geiIsTM = false;
    _byoItems = [{ id: 1, section: 'Work', label: 'Set the new water heater', price: 1800, on: true }];
    _byoUpdateRail();
    let d = ''; const real = window._showProposalPreviewOverlay;
    window._showProposalPreviewOverlay = h => { d = h; };
    try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; Object.assign(S, keep); }
    const el = document.createElement('div'); el.innerHTML = d; document.body.appendChild(el);
    const slot = el.querySelector('.prop-mark');
    const img = slot && slot.querySelector('img');
    // What the logo sits on: the nearest painted background above the image.
    let bg = 'rgba(0, 0, 0, 0)'; for (let n = img ? img.parentElement : slot; n && n !== el; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)') { bg = b; break; } }
    const r = {
      html: d, text: el.innerText,
      img: img ? { src: img.getAttribute('src'), h: img.getBoundingClientRect().height } : null,
      mastheadBg: bg,
      // No logo: his name is the mark (no letter monogram, same rule as the hub).
      nameColor: slot && !img ? getComputedStyle(slot.querySelector('div > div')).color : null,
      hasMonogram: !!(slot && slot.querySelector('span')),
    };
    el.remove();
    return r;
  }, o || {});

  // Since the cover (2026-09-23, §10.4) the document opens on his colour and
  // his logo sits on a white plate on it: the same white paper under the logo,
  // on a page that is now his colour.
  test('his logo sits on white paper, sized like a letterhead', async () => {
    const r = await doc({ logo: LOGO, brand: '#C2410C' });
    expect(r.img).not.toBe(null);
    expect(r.img.src).toBe(LOGO);
    expect(r.img.h).toBeLessThanOrEqual(56);
    expect(r.mastheadBg).toBe('rgb(255, 255, 255)');
    expect(r.text).toContain('Pruitt Plumbing');
  });

  // Changed 2026-09-24 (§10.4): no letter monogram, the owner removed it from
  // the client hub as filler and the proposal follows. His name, white on his
  // colour, is the mark.
  test('no logo: his name is the mark, on his colour, no monogram', async () => {
    const r = await doc({ brand: '#166534' });
    expect(r.img).toBe(null);
    expect(r.hasMonogram).toBe(false);
    expect(r.nameColor).toBe('rgb(255, 255, 255)');
    expect(r.text).toContain('Pruitt Plumbing');
  });

  test('his colour is the band, the accents and the price bar; no navy leaks', async () => {
    const r = await doc({ brand: '#166534' });
    expect(r.html).toContain('class="prop-cover" style="background:rgb(22,101,52)');
    expect(r.html).toContain('background:rgb(22,101,52);color:#fff');
    expect(r.html).not.toMatch(/#1a365d|#2a4a7f/);
  });

  test('the hosted copy of his logo is used once it is current, not the embedded one', async () => {
    const r = await page.evaluate(() => typeof _hubHash === 'function');
    expect(r).toBe(true);
    const hash = await page.evaluate((l) => String(_hubHash(l)), LOGO);
    const d = await doc({ logo: LOGO, logoUrl: 'https://cdn.example/logo.png', logoHash: hash, brand: '#C2410C' });
    expect(d.img.src).toBe('https://cdn.example/logo.png');
  });

  test('nothing on his document says TradeDesk', async () => {
    const r = await doc({ logo: LOGO, brand: '#C2410C' });
    expect(r.text).not.toMatch(/tradedesk/i);
  });

  test('the licence reads as a licence', async () => {
    const r = await doc({});
    expect(r.text).toContain('Lic. KS-PL-4471');
  });

  // Jack's logo (owner, 2026-09-23: "look at the ugliness on jacks logo") is
  // drawn on its own black square. Laid out as a wordmark it is a hard black
  // box; as a rounded tile beside his name it is an app icon.
  const TILE = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#000"/><circle cx="60" cy="60" r="30" fill="#2D5DA8"/></svg>').toString('base64');
  const CLEAR = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="30" fill="#2D5DA8"/></svg>').toString('base64');

  const markOf = (logo) => page.evaluate(async (logo) => {
    const keep = { logoData: S.logoData, logoMeta: S.logoMeta };
    S.logoData = logo; S.logoMeta = null;
    const meta = await _logoEnsureMeta();
    const d = document.createElement('div');
    d.innerHTML = _propCover({ bname: 'Plumbing Solutions by JS', bphone: '785-409-8931', blic: '', accent: '#2D5DA8', label: 'Proposal', num: '1', date: '09/23/2026', name: 'Tracey Gillaspy', addr: '', phone: '', project: 'Kitchen sink drain repair', until: '10/23/2026' });
    document.body.appendChild(d);
    const img = d.querySelector('.prop-mark img');
    const r = { meta, radius: parseFloat(getComputedStyle(img).borderTopLeftRadius), beside: img.parentElement.style.display === 'flex' };
    d.remove(); Object.assign(S, keep);
    return r;
  }, logo);

  test('a logo on its own solid square is a rounded tile beside his name', async () => {
    const r = await markOf(TILE);
    expect(r.meta.solid).toBe(true);
    expect(r.beside).toBe(true);
    expect(r.radius).toBeGreaterThanOrEqual(12);
  });

  test('a transparent logo stays a wordmark, name underneath', async () => {
    const r = await markOf(CLEAR);
    expect(r.meta.solid).toBe(false);
    expect(r.beside).toBe(false);
  });

  test('his Title Case steps print as sentences, with the trade acronyms in capitals', async () => {
    const r = await page.evaluate(() => ['Cut Out Leaky Kitchen Sink Drain', 'Replace With Pvc', 'Check For Leaks', 'Run new pex and a gfci', 'Set a tankless, Navien NPE-240A'].map(_propSentence));
    expect(r).toEqual(['Cut out leaky kitchen sink drain', 'Replace with PVC', 'Check for leaks', 'Run new PEX and a GFCI', 'Set a tankless, Navien NPE-240A']);
  });

  test('a repair names itself: "Cut out leaky kitchen sink drain" is a kitchen sink drain repair', async () => {
    const r = await page.evaluate(() => [
      _propProjectTitle(['Cut Out Leaky Kitchen Sink Drain', 'Replace With Pvc'], 'plumbing'),
      _propProjectTitle(['fix the broken shutoff valve'], 'plumbing'),
      _propProjectTitle(['cut out the water damaged drywall in the basement and hang new board'], 'drywall'),
    ]);
    expect(r[0]).toBe('Kitchen sink drain repair');
    expect(r[1]).toBe('Shutoff valve repair');
    expect(r[2], 'a whole sentence is never a title').toBe(null);
  });

  // getBusinessName() falls back to 'TradeDesk'. An account with no name set
  // must get no name on its document and "Contractor" in its terms, never ours.
  test('no business name set: no TradeDesk on the page or in the terms', async () => {
    const r = await page.evaluate(async () => {
      const keep = { bname: S.bname, acct: window._account };
      S.bname = ''; try { _account = null; } catch (e) {}
      bids.length = 0; clients.length = 0;
      clients.push({ id: 97102, name: 'Hetty Green', addr: '412 Bell St, Topeka, KS 66603' });
      currentClientId = 97102; _activeTrade = 'plumbing';
      openGenericEstimate(getClientById(97102), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false;
      _byoItems = [{ id: 1, section: 'Work', label: 'Set the new water heater', price: 1800, on: true }];
      _byoUpdateRail();
      let d = ''; const real = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } finally { window._showProposalPreviewOverlay = real; }
      const terms = _geiBuildTermsHtml();
      S.bname = keep.bname; try { _account = keep.acct; } catch (e) {}
      return { d, terms };
    });
    expect(r.d).not.toMatch(/tradedesk/i);
    expect(r.terms).not.toMatch(/tradedesk/i);
    expect(r.terms).toContain('Contractor');
  });

  test('no console errors', async () => { assertNoErrors(page, 'white label'); });
});

// ── THE CUSTOMER'S SIDE: sign.html ─────────────────────────────────────────
const { FAKE_USER_ID } = require('./helpers');
test.describe('the signing page, white-labelled', () => {
  const LETTERHEAD = '<div><div class="prop-mark">Pruitt Plumbing</div><div>Scope of work</div></div>';
  const prop = {
    id: 777002, status: 'pending', businessName: 'Pruitt Plumbing', businessPhone: '785-555-0142',
    clientName: 'Hetty Green', clientAddr: '412 Bell St, Topeka, KS 66603', amount: 4200, deposit: 1050,
    estDays: 1, createdAt: new Date().toISOString(), signingToken: 'tok-wl2', contractorUserId: FAKE_USER_ID,
    clientId: 97103, proposalHtml: LETTERHEAD, termsHtml: '<div style="font-size:11px;line-height:2"><div>1. <strong>Change Orders:</strong> In writing.</div><div>2. <strong>Warranty:</strong> One year.</div></div>',
    trade: 'plumbing', surfaces: [], stripeConnectEnabled: false, brandColor: '#C2410C', state: 'KS',
  };
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, bypassCSP: true });
    page = await ctx.newPage();
    await page.addInitScript(d => { window.__mockProposalData = d; }, prop);
    await mockAllExternal(page, { proposalData: prop, bidId: 777002 });
    await page.goto(`/sign.html?key=proposals/${FAKE_USER_ID}/777002_tok-wl2.json`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
  });
  test.afterAll(async () => { await ctx.close(); });

  test('his colour runs the page, and the Approve button is his', async () => {
    const r = await page.evaluate(() => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      btn: getComputedStyle(document.getElementById('approve-btn')).backgroundColor,
    }));
    expect(r.accent.toLowerCase()).toBe('#c2410c');
    expect(r.btn).toBe('rgb(194, 65, 12)');
  });

  test('a document with its own letterhead is the hero: no second hero card above it', async () => {
    const shown = await page.evaluate(() => getComputedStyle(document.querySelector('#pg-sign .hero-card')).display);
    expect(shown).toBe('none');
  });

  test('the terms still open, in his colour, as readable clauses', async () => {
    const r = await page.evaluate(async () => {
      approveAndSign();
      await new Promise(res => setTimeout(res, 500));
      esignToggleTerms('sig');
      const body = document.getElementById('sig-terms-body');
      const btnLbl = body.parentElement.querySelector('button span');
      const clause = body.querySelector(':scope > div > div');
      return { open: getComputedStyle(body).display !== 'none', lbl: getComputedStyle(btnLbl).color, size: parseFloat(getComputedStyle(clause).fontSize), n: body.querySelectorAll(':scope > div > div').length };
    });
    expect(r.open).toBe(true);
    expect(r.lbl).toBe('rgb(194, 65, 12)');
    expect(r.size).toBeGreaterThanOrEqual(13);
    expect(r.n).toBe(2);
  });
});
