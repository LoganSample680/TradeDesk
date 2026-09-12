// @ts-check
// ── Marketing site routing, and the "/" gate ────────────────────────────────
//
// The 12 marketing pages ship as plain HTML in the repo root and are served at
// clean URLs by Cloudflare Pages (compare/jobber.html is /compare/jobber).
// "/" is the one URL the app and the marketing site both want, and
// functions/index.js decides: the app for a browser carrying the td_app cookie,
// the native shell's user agent, or any query string; the landing page for
// everyone else. Every page's canonical tag, the sitemap and llms.txt name the
// clean URLs, so the things that can silently drift are the hrefs between
// pages, the two shared assets loaded from every route (support.js and the _ds
// design-system folder), the root files, and that gate.
//
// scripts/serve-site.js mirrors Cloudflare's static rules and mounts the same
// wantsApp() the function uses, so the HTTP-level checks here run offline. The
// browser-level checks at the end boot the real app through the normal offline
// harness to prove the app side of the gate (cookie set on boot, ?signup=1).
const { request } = require('@playwright/test');
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { start, loadGate } = require('../scripts/serve-site');
const fs = require('fs');
const path = require('path');

const PUBLIC = 'https://tradedeskpro.app';
const DS = '/_ds/tradedesk-design-system-019e1e22-25c2-77a5-9117-5b4c4f7bd36d';

// HANDOFF table: the 12 routes, exactly.
const ROUTES = [
  '/',
  '/compare',
  '/compare/jobber',
  '/compare/quoteiq',
  '/compare/dripjobs',
  '/compare/servicetitan',
  '/painting-contractor-software',
  '/plumbing-contractor-software',
  '/handyman-contractor-software',
  '/tools/lien-deadlines',
  '/privacy',
  '/terms',
];

const decode = s => s.replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

let site, api;
const html = {};

test.describe('marketing site routing', () => {
  test.beforeAll(async () => {
    site = await start(0);
    api = await request.newContext({ baseURL: site.url });
    for (const r of ROUTES) {
      const res = await api.get(r);
      expect(res.status(), `GET ${r}`).toBe(200);
      html[r] = await res.text();
    }
  });

  test.afterAll(async () => {
    await api.dispose();
    await site.close();
  });

  test('every clean URL serves the page whose canonical names it', async () => {
    for (const r of ROUTES) {
      const canon = html[r].match(/<link rel="canonical" href="([^"]+)"/);
      expect(canon, `${r} has a canonical tag`).toBeTruthy();
      expect(canon[1], `canonical of ${r}`).toBe(PUBLIC + r);
      const og = html[r].match(/property="og:url" content="([^"]+)"/);
      expect(og && og[1], `og:url of ${r}`).toBe(PUBLIC + r);
    }
  });

  test('"/" is the landing page for a stranger and the app for everyone who uses it', async () => {
    const landing = await api.get('/');
    expect(landing.headers()['x-td-page']).toBe('landing');
    expect(landing.headers()['cache-control']).toContain('no-store');
    expect(await landing.text()).toContain('<link rel="canonical" href="https://tradedeskpro.app/">');

    const appCases = [
      ['/', { cookie: 'td_app=1' }, 'the td_app cookie'],
      ['/', { cookie: 'zp3_x=2; td_app=1; other=3' }, 'the cookie among others'],
      ['/', { 'user-agent': 'Mozilla/5.0 (iPhone) TradeDeskShell' }, 'the native shell user agent'],
      ['/?app=1', {}, 'the landing page Log in link'],
      ['/?signup=1', {}, 'the landing page signup CTA'],
      ['/?emp_invite=abc', {}, 'a crew invite deep link'],
      ['/?code=oauth', {}, 'an OAuth return'],
    ];
    for (const [url, headers, why] of appCases) {
      const res = await api.get(url, { headers });
      expect(res.headers()['x-td-page'], why).toBe('app');
      expect(await res.text(), why).toContain('id="supa-boot-overlay"');
    }
    const landingCases = [
      ['/', { cookie: 'td_app=0' }, 'a cleared cookie'],
      ['/', { cookie: 'xtd_app=1' }, 'a cookie that merely ends in the name'],
      ['/', { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' }, 'plain mobile Safari'],
    ];
    for (const [url, headers, why] of landingCases) {
      const res = await api.get(url, { headers });
      expect(res.headers()['x-td-page'], why).toBe('landing');
    }
    // /landing always shows the marketing page, cookie or not: that is how a
    // signed-in owner looks at it. Its canonical still names "/".
    const direct = await api.get('/landing', { headers: { cookie: 'td_app=1' } });
    expect(direct.status()).toBe(200);
    expect(await direct.text()).toContain('<link rel="canonical" href="https://tradedeskpro.app/">');
  });

  test('wantsApp() unit cases, straight from the function module', async () => {
    const { wantsApp } = loadGate();
    const req = (url, headers) => new Request('https://tradedeskpro.app' + url, { headers });
    expect(wantsApp(req('/'))).toBe(false);
    expect(wantsApp(req('/?'))).toBe(false);
    expect(wantsApp(req('/?app=1'))).toBe(true);
    expect(wantsApp(req('/', { cookie: 'td_app=1' }))).toBe(true);
    expect(wantsApp(req('/', { cookie: 'td_app=1; a=b' }))).toBe(true);
    expect(wantsApp(req('/', { cookie: 'td_app=10' }))).toBe(false);
    expect(wantsApp(req('/', { cookie: 'ztd_app=1' }))).toBe(false);
    expect(wantsApp(req('/', { 'user-agent': 'x TradeDeskShell/1' }))).toBe(true);
  });

  test('the landing page sends the native shell and home-screen installs to the app', async () => {
    // Before the cookie exists (first launch after this shipped) the shell's
    // WKWebView would otherwise show the marketing page. The guard runs first.
    const h = html['/'];
    const guardAt = h.indexOf("location.replace('/?app=1')");
    expect(guardAt).toBeGreaterThan(0);
    expect(h).toContain('isNativePlatform');
    expect(h).toContain("'(display-mode: standalone)'");
    expect(guardAt, 'guard runs before the page runtime loads').toBeLessThan(h.indexOf('<script src="/support.js">'));
    // The manifest's start_url carries the app flag too, so an installed PWA
    // never depends on the guard.
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.start_url).toBe('/?app=1');
    // And the service worker never caches the marketing page as the app.
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    expect(sw).toContain("r.headers.get('x-td-page') === 'landing'");
  });

  test('legacy file paths and trailing slashes redirect to the clean URL, unknown paths 404', async () => {
    const cases = [
      ['/index.html', '/'],
      ['/landing.html', '/landing'],
      ['/compare.html', '/compare'],
      ['/compare/', '/compare'],
      ['/compare/jobber.html', '/compare/jobber'],
      ['/compare/jobber/', '/compare/jobber'],
      ['/tools/lien-deadlines.html', '/tools/lien-deadlines'],
      ['/privacy.html', '/privacy'],
      ['/terms.html', '/terms'],
    ];
    for (const [from, to] of cases) {
      const res = await api.get(from, { maxRedirects: 0 });
      expect(res.status(), `${from} redirects`).toBe(308);
      expect(res.headers()['location'], `${from} -> ${to}`).toBe(to);
    }
    for (const missing of ['/compare/housecall-pro', '/for/plumbers', '/TradeDesk%20Landing.dc.html', '/nope']) {
      const res = await api.get(missing, { maxRedirects: 0 });
      expect(res.status(), `${missing} is not a page`).toBe(404);
    }
  });

  test('the replaced marketing and legal files are gone, not hidden (7.1)', async () => {
    // legal.css only styled the old privacy/terms pages.
    expect((await api.get('/legal.css')).status()).toBe(404);
    // The old landing linked the legal pages by filename; the new one never does.
    expect(html['/']).not.toMatch(/privacy\.html|terms\.html/);
    expect(html['/privacy']).not.toContain('legal.css');
    expect(html['/terms']).not.toContain('legal.css');
  });

  test('no page references another page by its old filename or the app by /index.html', async () => {
    for (const r of ROUTES) {
      expect(html[r], `${r} still has a .dc.html link`).not.toMatch(/\.dc\.html/);
      expect(html[r], `${r} still links /index.html`).not.toMatch(/href="\/index\.html/);
      expect(html[r], `${r} still loads a relative asset`).not.toMatch(/(src|href)="(\.\/|_ds\/)/);
      expect(html[r], `${r} still names a separate app origin`).not.toContain('app.tradedeskpro.app');
    }
  });

  test('every internal link on every page resolves to a real route', async () => {
    const seen = new Set();
    for (const r of ROUTES) {
      const hrefs = [...html[r].matchAll(/href="(\/[^"]*)"/g)].map(m => m[1]);
      expect(hrefs.length, `${r} has internal links`).toBeGreaterThan(0);
      for (const h of hrefs) {
        const pathOnly = h.split('#')[0].split('?')[0];
        if (seen.has(pathOnly)) continue;
        seen.add(pathOnly);
        const res = await api.get(pathOnly, { maxRedirects: 0 });
        expect(res.status(), `${r} links ${h}`).toBe(200);
      }
    }
    // Page links (not assets) must be clean URLs from the HANDOFF table.
    for (const p of seen) {
      if (p.startsWith(DS) || p === '/support.js') continue;
      expect(ROUTES, `link target ${p} is a listed route`).toContain(p);
    }
  });

  test('support.js and the design-system assets load by absolute path from every route', async () => {
    const assets = [
      ['/support.js', 'text/javascript'],
      [DS + '/colors_and_type.css', 'text/css'],
      [DS + '/_ds_bundle.js', 'text/javascript'],
    ];
    for (const [p, type] of assets) {
      const res = await api.get(p);
      expect(res.status(), p).toBe(200);
      expect(res.headers()['content-type'], p).toContain(type);
      expect((await res.body()).length, `${p} is not empty`).toBeGreaterThan(1000);
    }
    for (const r of ROUTES) {
      expect(html[r], `${r} loads /support.js`).toContain('<script src="/support.js"></script>');
      expect(html[r], `${r} loads the design-system css`).toContain(`href="${DS}/colors_and_type.css"`);
      // The bundle is only loaded where a page needs it; wherever it is, it is absolute.
      const bundle = html[r].match(/src="([^"]*_ds_bundle\.js)"/);
      if (bundle) expect(bundle[1]).toBe(DS + '/_ds_bundle.js');
    }
  });

  test('robots.txt, sitemap.xml and llms.txt are served from the root and agree with the canonicals', async () => {
    const robots = await api.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${PUBLIC}/sitemap.xml`);

    const sm = await api.get('/sitemap.xml');
    expect(sm.status()).toBe(200);
    expect(sm.headers()['content-type']).toContain('xml');
    const locs = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).sort();
    expect(locs).toEqual(ROUTES.map(r => PUBLIC + r).sort());

    const llms = await api.get('/llms.txt');
    expect(llms.status()).toBe(200);
    const urls = [...new Set([...(await llms.text()).matchAll(/https:\/\/tradedeskpro\.app[^\s)]*/g)].map(m => m[0]))];
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls) {
      const p = u.slice(PUBLIC.length) || '/';
      expect(ROUTES, `llms.txt links ${u}`).toContain(p);
    }
  });

  test('signup CTAs and Log in point at the app through the "/" gate, in exactly one form each', async () => {
    let signup = 0, login = 0;
    for (const r of ROUTES) {
      for (const m of html[r].matchAll(/href="(\/\?[^"]*)"/g)) {
        expect(['/?signup=1', '/?app=1'], `${r} app link ${m[1]}`).toContain(m[1]);
        if (m[1] === '/?signup=1') signup++; else login++;
      }
      expect(html[r], `${r} has no signup link off the gate`).not.toMatch(/href="(?!\/\?signup=1")[^"]*signup=1/);
    }
    expect(signup).toBeGreaterThan(0);
    expect(login).toBeGreaterThan(0);
    // The landing page's hero and header both carry a CTA.
    expect(html['/']).toContain('href="/?signup=1"');
    expect(html['/']).toContain('href="/?app=1"');
  });

  test('landing FAQ JSON-LD matches the 19 visible <details> items', async () => {
    const h = html['/'];
    const ldBlocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const nodes = ldBlocks.flatMap(b => b['@graph'] || [b]);
    const faq = nodes.find(n => n['@type'] === 'FAQPage');
    expect(faq, 'FAQPage node present').toBeTruthy();
    const names = faq.mainEntity.map(q => q.name);
    for (const q of faq.mainEntity) {
      expect(q['@type']).toBe('Question');
      expect(decode(q.acceptedAnswer.text).length, `answer for "${q.name}"`).toBeGreaterThan(10);
    }

    const start = h.indexOf('<section id="faq"');
    expect(start).toBeGreaterThan(0);
    const sec = h.slice(start, h.indexOf('</section>', start));
    const details = [...sec.matchAll(/<details[\s>]/g)].length;
    const summaries = [...sec.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)]
      .map(m => decode(m[1]).replace(/\s*\+$/, ''));

    expect(names.length).toBe(19);
    expect(details).toBe(19);
    expect(summaries.length).toBe(19);
    expect([...names].sort()).toEqual([...summaries].sort());
  });

  test('legal docs carry the operator mailing address, not the launch placeholder', async () => {
    for (const r of ['/privacy', '/terms']) {
      expect(html[r], r).not.toMatch(/\[MAILING ADDRESS/);
      expect(decode(html[r]), r).toContain('2015 SW Randolph Avenue, Topeka, Kansas 66604');
    }
  });

  test('nested routes resolve the stylesheet in a real browser', async ({ page }) => {
    // Only the local server is real. External requests are answered with an
    // empty body of the right type rather than aborted: colors_and_type.css
    // starts with an @import of Google Fonts, and WebKit does not apply the
    // sheet's own rules until that import settles, so an aborted import left
    // --ink unset at domcontentloaded (CI shard 3, 2026-09-11) where Chromium
    // had already applied it. The page runtime is stubbed too: this proves
    // path resolution from a nested route, not React hydration.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const u = route.request().url();
      const css = /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u);
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/plain', body: '' });
    });
    await page.route('**/support.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    for (const r of ['/compare/jobber', '/tools/lien-deadlines', '/']) {
      await page.goto(site.url + r, { waitUntil: 'load' });
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() !== '', null, { timeout: 10000 })
        .catch(() => {});
      const got = await page.evaluate(() => ({
        ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
        title: document.title,
        href: location.pathname,
      }));
      expect(got.ink, `${r} applied colors_and_type.css`).not.toBe('');
      expect(got.title.length, `${r} has a title`).toBeGreaterThan(5);
      expect(got.href).toBe(r);
    }
  });
});

// The app's half of the gate, on the normal offline harness (static server,
// mocked Supabase): a session-backed boot writes the cookie, the account wipe
// clears it, and ?signup=1 lands in signup instead of the login screen.
test.describe('the app side of the "/" gate', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test('a session-backed boot sets td_app=1', async () => {
    const cookie = await page.evaluate(() => document.cookie);
    expect(cookie).toMatch(/(^|;\s*)td_app=1(;|$)/);
  });

  test('?signup=1 opens signup directly and consumes the param', async () => {
    const r = await page.evaluate(async () => {
      history.replaceState(null, '', '/?signup=1');
      window._supaUser = null;
      localStorage.removeItem('zp3_session_backup');
      localStorage.removeItem('zp3_cloud_cache');
      await supaShowLogin({ force: true });
      return {
        login: !!document.getElementById('supa-login-overlay'),
        onboarding: !!document.getElementById('onboarding-overlay'),
        search: location.search,
      };
    });
    expect(r.login).toBe(false);
    expect(r.onboarding).toBe(true);
    expect(r.search).toBe('');
    await page.evaluate(() => { document.getElementById('onboarding-overlay')?.remove(); });
  });

  test('a plain login screen (no ?signup) still shows the login, not signup', async () => {
    const r = await page.evaluate(async () => {
      history.replaceState(null, '', '/');
      window._supaUser = null;
      await supaShowLogin({ force: true });
      const out = { login: !!document.getElementById('supa-login-overlay'), onboarding: !!document.getElementById('onboarding-overlay') };
      document.getElementById('supa-login-overlay')?.remove();
      return out;
    });
    expect(r.login).toBe(true);
    expect(r.onboarding).toBe(false);
  });

  test('wiping the account clears the cookie, so "/" shows the marketing page again', async () => {
    const cookie = await page.evaluate(() => {
      _tdAppCookie(false);
      return document.cookie;
    });
    expect(cookie).not.toMatch(/td_app=1/);
    const again = await page.evaluate(() => { _tdAppCookie(true); return document.cookie; });
    expect(again).toMatch(/td_app=1/);
    await assertNoErrors(page);
  });
});
