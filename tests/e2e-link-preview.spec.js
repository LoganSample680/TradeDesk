// @ts-check
// The texted link wears the contractor's brand (owner 2026-09-30): his name
// and his logo, large, on the preview. lib/link-preview.mjs, run by
// functions/client.js and functions/sign.js. Offline: the storage fetch and
// the page are handed in, and HTMLRewriter is stood in for below.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = pathToFileURL(path.join(__dirname, '..', 'lib', 'link-preview.mjs')).href;
const U = '987ebc83-1567-49e1-9dd3-b89b0cf9121b', T = '51b0468a49734c7c408899edc55028b6';
const LOGO = 'https://mwtsmctajhrrybblgorf.supabase.co/storage/v1/object/public/gallery/' + U + '/branding/logo-837763362.png';
const PAGE = '<!DOCTYPE html><html><head><title>Your Project Hub</title><link rel="icon" href="favicon.ico"></head><body>hub</body></html>';

// Just enough HTMLRewriter for head append and title replace.
class FakeRewriter {
  constructor() { this.h = []; }
  on(sel, handler) { this.h.push([sel, handler]); return this; }
  transform(res) {
    const h = this.h;
    // A Response body cannot be a promise, so the stand-in hands back a
    // Response-like object whose text() resolves the rewritten page.
    return { headers: res.headers, text: async () => {
      let html = await res.text();
      for (const [sel, handler] of h) {
        handler.element({
          append: (x) => { if (sel === 'head') html = html.replace('</head>', x + '</head>'); },
          setInnerContent: (x) => { if (sel === 'title') html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + x.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</title>'); },
        });
      }
      return html;
    } };
  }
}

test.describe('Texted link preview: his name and his logo', () => {
  let L;
  test.beforeAll(async () => { L = await import(LIB); globalThis.HTMLRewriter = FakeRewriter; });

  const page = (ct = 'text/html; charset=utf-8') => async () => new Response(PAGE, { headers: { 'content-type': ct } });
  const req = (p) => new Request('https://uat.tradedesk-cyp.pages.dev' + p);

  test('the hub link: his name in the title, his logo as a large card, through our image route', async () => {
    let asked = '';
    const res = await L.brandedPage('client', req(`/client.html?t=${T}&u=${U}&c=1789397583261`), page(),
      async (url) => { asked = url; return { contractorName: 'Plumbing Solutions by JS', logoUrl: LOGO }; });
    const html = await res.text();
    expect(asked).toBe(`https://mwtsmctajhrrybblgorf.supabase.co/storage/v1/object/public/proposals/client-hub/${U}/1789397583261_${T}.json`);
    expect(html).toContain('<title>Plumbing Solutions by JS · Your Project Hub</title>');
    expect(html).toContain('Your photos, invoices and documents, all in one place.');
    expect(html).toContain(`<meta property="og:image" content="https://uat.tradedesk-cyp.pages.dev/img/gallery/${U}/branding/logo-837763362.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('og:title');
  });

  test('the sign link reads the proposal file', async () => {
    let asked = '';
    const res = await L.brandedPage('sign', req(`/sign.html?t=${T}&u=${U}&b=1790781036578005`), page(),
      async (url) => { asked = url; return { businessName: 'Plumbing Solutions by JS', logoUrl: LOGO }; });
    expect(asked).toContain(`/proposals/proposals/${U}/1790781036578005_${T}.json`);
    expect(await res.text()).toContain('Plumbing Solutions by JS: your proposal');
  });

  test('a name with markup in it is text, never markup', async () => {
    const res = await L.brandedPage('client', req(`/client.html?t=${T}&u=${U}&c=1`), page(),
      async () => ({ contractorName: '"><script>x</script>', logoUrl: LOGO }));
    const html = await res.text();
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  test('anything off serves the page untouched: bad link, no file, junk file, a logo from anywhere else, not HTML', async () => {
    const same = async (p, fetchJson, ct) => (await (await L.brandedPage(p.page, req(p.url), page(ct), fetchJson)).text()) === PAGE;
    const brand = async () => ({ contractorName: 'X', logoUrl: LOGO });
    expect(await same({ page: 'client', url: `/client.html?t=nope&u=${U}&c=1` }, brand)).toBe(true);
    expect(await same({ page: 'client', url: `/client.html?t=${T}&u=../../etc&c=1` }, brand)).toBe(true);
    expect(await same({ page: 'client', url: `/client.html?t=${T}&u=${U}&c=1` }, async () => null)).toBe(true);
    expect(await same({ page: 'client', url: `/client.html?t=${T}&u=${U}&c=1` }, async () => { throw new Error('down'); })).toBe(true);
    expect(await same({ page: 'client', url: `/client.html?t=${T}&u=${U}&c=1` }, async () => 'junk')).toBe(true);
    expect(await same({ page: 'client', url: `/client.html?t=${T}&u=${U}&c=1` }, brand, 'image/png')).toBe(true);
    const other = L.previewBrand({ contractorName: 'X', logoUrl: 'https://evil.test/x.png' }, 'https://a.test');
    expect(other).toEqual({ name: 'X', image: '' });
  });

  test('a logo saved through the /api proxy is still his logo (owner 2026-09-30, blank square on the card)', async () => {
    const viaProxy = 'https://uat.tradedesk-cyp.pages.dev/api/storage/v1/object/public/gallery/u1/branding/logo-9.jpg';
    const b = L.previewBrand({ contractorName: 'X', logoUrl: viaProxy }, 'https://a.test');
    expect(b.image).toBe('https://a.test/img/gallery/u1/branding/logo-9.jpg');
    // Only the gallery: another bucket through the proxy is not a logo.
    const notGallery = L.previewBrand({ contractorName: 'X', logoUrl: 'https://uat.tradedesk-cyp.pages.dev/api/storage/v1/object/public/proposals/x.png' }, 'https://a.test');
    expect(notGallery.image).toBe('');
  });

  test('the route files exist for both spellings of both pages', async () => {
    const fs = require('fs');
    for (const f of ['client.js', 'client.html.js', 'sign.js', 'sign.html.js'])
      expect(fs.existsSync(path.join(__dirname, '..', 'functions', f)), f).toBe(true);
  });
});
