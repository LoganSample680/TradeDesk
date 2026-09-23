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
    const slot = el.querySelector('.brand-logo-slot');
    const img = slot && slot.querySelector('img');
    let bg = 'rgba(0, 0, 0, 0)'; for (let n = slot; n && n !== el; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)') { bg = b; break; } }
    const r = {
      html: d, text: el.innerText,
      img: img ? { src: img.getAttribute('src'), h: img.getBoundingClientRect().height } : null,
      mastheadBg: bg,
      nameColor: slot && !img ? getComputedStyle(slot.firstElementChild).color : null,
    };
    el.remove();
    return r;
  }, o || {});

  test('his logo sits on white paper, sized like a letterhead', async () => {
    const r = await doc({ logo: LOGO, brand: '#C2410C' });
    expect(r.img).not.toBe(null);
    expect(r.img.src).toBe(LOGO);
    expect(r.img.h).toBeLessThanOrEqual(64);
    expect(r.mastheadBg).toBe('rgb(255, 255, 255)');
    expect(r.text).toContain('Pruitt Plumbing');
  });

  test('no logo: his name is the mark, in his colour', async () => {
    const r = await doc({ brand: '#166534' });
    expect(r.img).toBe(null);
    expect(r.nameColor).toBe('rgb(22, 101, 52)');
  });

  test('his colour is the band, the accents and the price bar; no navy leaks', async () => {
    const r = await doc({ brand: '#166534' });
    expect(r.html).toContain('height:6px;background:rgb(22,101,52)');
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

  test('no console errors', async () => { assertNoErrors(page, 'white label'); });
});
