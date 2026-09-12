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
  '/ai-answering-service-for-contractors',
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
    const urls = [...new Set([...(await llms.text()).matchAll(/https:\/\/tradedeskpro\.app[^\s)]*/g)]
      .map(m => m[0].replace(/[.,;:*\]]+$/, '')))];
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls) {
      const p = u.slice(PUBLIC.length) || '/';
      expect(ROUTES, `llms.txt links ${u}`).toContain(p);
    }
  });

  // A noindex only takes effect when the crawler comes back and reads it, and
  // on its own schedule that is weeks. These three are what shorten the wait.
  test('every sitemap URL carries an honest lastmod', async () => {
    const sm = await (await api.get('/sitemap.xml')).text();
    const blocks = [...sm.matchAll(/<url>[\s\S]*?<\/url>/g)].map(m => m[0]);
    expect(blocks.length).toBe(ROUTES.length);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    for (const b of blocks) {
      const loc = b.match(/<loc>([^<]+)<\/loc>/)[1];
      const mod = b.match(/<lastmod>([^<]+)<\/lastmod>/);
      expect(mod, `${loc} has a lastmod`).toBeTruthy();
      expect(mod[1], `${loc} lastmod is a W3C date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Google discounts lastmod for good once a site is caught stamping dates
      // it cannot justify, so a future date is worse than none at all.
      expect(mod[1] <= today, `${loc} lastmod ${mod[1]} is not in the future`).toBe(true);
    }
  });

  test('the IndexNow key is published and self-consistent', async () => {
    const root = path.join(__dirname, '..');
    const keyFile = fs.readdirSync(root).find(f => /^[0-9a-f]{8,128}\.txt$/.test(f));
    expect(keyFile, 'a key file at the repo root').toBeTruthy();
    // IndexNow authenticates by fetching https://host/<key>.txt and checking it
    // contains the key, so the file has to be served AND name itself.
    const res = await api.get('/' + keyFile);
    expect(res.status(), `GET /${keyFile}`).toBe(200);
    expect((await res.text()).trim()).toBe(path.basename(keyFile, '.txt'));
  });

  test('the recrawl submission covers the sitemap and the pages being purged', async () => {
    const out = require('child_process')
      .execSync('node scripts/indexnow.js', { cwd: path.join(__dirname, '..'), env: { ...process.env, DRY_RUN: '1' } })
      .toString();
    const body = JSON.parse(out);
    expect(body.host).toBe('tradedeskpro.app');
    expect(body.keyLocation).toBe(`https://tradedeskpro.app/${body.key}.txt`);
    for (const r of ROUTES) {
      expect(body.urlList, `submits ${r}`).toContain(PUBLIC + r);
    }
    // The wrongly-indexed pages are submitted precisely BECAUSE they are
    // noindex now: a crawler has to fetch them again to see it and drop them.
    for (const p of ['/index.html', '/sign', '/client', '/intake', '/contract-sign', '/timesheet']) {
      expect(body.urlList, `asks for a recrawl of ${p}`).toContain(PUBLIC + p);
    }
    expect(new Set(body.urlList).size, 'no duplicates').toBe(body.urlList.length);
  });

  test('_headers says noindex over HTTP too, at both spellings of every private path', async () => {
    const h = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');
    // Cloudflare serves these at the clean URL while the app links to them by
    // filename, so a rule on only one spelling covers only half the requests.
    for (const p of ['/sign', '/client', '/intake', '/contract-sign', '/timesheet', '/ops']) {
      for (const spelling of [p, p + '.html']) {
        const block = h.match(new RegExp('^' + spelling.replace(/[.]/g, '\\.') + '$\\n(  .+\\n)+', 'm'));
        expect(block, `a rule for ${spelling}`).toBeTruthy();
        expect(block[0], `${spelling} is noindex`).toMatch(/X-Robots-Tag: *noindex/);
      }
    }
    expect(h, 'the app itself').toMatch(/^\/index\.html$\n  X-Robots-Tag: *noindex/m);
    // The mirror image: "/" is the marketing page for a crawler and must never
    // pick up a noindex from a rule meant for the app.
    expect(h).not.toMatch(/^\/$\n(  .+\n)*  X-Robots-Tag/m);
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

  // An AI asked about TradeDesk in September 2026 came back describing it as a
  // proposal tool "aimed at painters" with e-signature disclosures and client
  // project portals. That is not the marketing page, it is a summary assembled
  // from sign.html, client.html and the app shell, which were fully crawlable
  // with no description of their own. They are per-customer links and the app,
  // not pages search should rank, and indexing a customer's proposal or project
  // hub is a privacy problem on its own.
  //
  // Deliberately noindex and NOT robots.txt Disallow: a disallowed page is never
  // fetched, so the crawler never reads the directive and anything already
  // indexed stays indexed. noindex is the one that removes them.
  test('the app and every customer link are noindex, the marketing pages are not', async () => {
    const PRIVATE = ['index.html', 'sign.html', 'client.html', 'intake.html', 'contract-sign.html', 'timesheet.html', 'ops.html'];
    for (const f of PRIVATE) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const tag = src.match(/<meta name="robots" content="([^"]+)"/);
      expect(tag, `${f} carries a robots meta`).toBeTruthy();
      expect(tag[1], `${f} robots value`).toMatch(/noindex/);
      // It must be in the head, before the crawler gives up reading.
      expect(src.indexOf('<meta name="robots"'), `${f} robots tag is in <head>`)
        .toBeLessThan(src.indexOf('</head>'));
    }
    // The mirror image: noindex must never leak onto a page we want ranked.
    for (const r of ROUTES) {
      expect(html[r], `${r} must stay indexable`).not.toMatch(/<meta name="robots"[^>]*noindex/);
    }
  });

  // The same confusion, one layer down: the page used to declare two
  // Organization nodes for one company (a full one at #org, plus an inline
  // duplicate as the app's publisher). One company, one entity, referenced by id.
  test('TradeDesk is one Organization in the structured data, not two', async () => {
    const h = html['/'];
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const nodes = blocks.flatMap(b => b['@graph'] || [b]);

    const orgs = nodes.filter(n => n['@type'] === 'Organization');
    expect(orgs.length, 'exactly one Organization node').toBe(1);
    expect(orgs[0]['@id']).toBe(PUBLIC + '/#org');
    expect(orgs[0].url).toBe(PUBLIC + '/');
    // "TradeDesk" and "TradeDesk Pro" have to resolve to the same company.
    expect(orgs[0].alternateName, 'the other spelling of the name').toContain('TradeDesk Pro');

    const app = nodes.find(n => n['@type'] === 'SoftwareApplication');
    expect(app, 'SoftwareApplication node present').toBeTruthy();
    expect(app.publisher, 'publisher references the one Organization').toEqual({ '@id': PUBLIC + '/#org' });
    expect(app.url).toBe(PUBLIC + '/');
  });

  // llms.txt is the file an AI reads to describe the product. It has to say
  // plainly which product this is and which two descriptions are wrong, because
  // both of those wrong descriptions have actually been produced.
  test('llms.txt states the one domain and denies the two wrong descriptions', async () => {
    const res = await api.get('/llms.txt');
    expect(res.status()).toBe(200);
    const t = await res.text();
    expect(t).toContain('https://tradedeskpro.app');
    expect(t, 'says it is not painting-only').toMatch(/not painting-only/i);
    expect(t, 'says it is not an answering service').toMatch(/not an AI call-answering/i);
    expect(t, 'no em dashes (CLAUDE.md)').not.toMatch(/\u2014/);
  });

  // Markup-only Q&A that does not match what a visitor sees risks a Google
  // manual action, which is why the landing page's FAQ is guarded the same way.
  // This page targets a question query, so its FAQ schema is the point of it.
  test('the AI answering page\'s FAQ schema matches its visible questions', async () => {
    const h = html['/ai-answering-service-for-contractors'];
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const nodes = blocks.flatMap(b => b['@graph'] || [b]);
    const faq = nodes.find(n => n['@type'] === 'FAQPage');
    expect(faq, 'FAQPage node present').toBeTruthy();

    const summaries = [...h.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(m => decode(m[1]));
    const answers = [...h.matchAll(/<\/summary><p>([\s\S]*?)<\/p>/g)].map(m => decode(m[1]));
    expect(summaries.length, 'visible questions').toBe(5);
    expect(faq.mainEntity.length, 'schema questions').toBe(summaries.length);
    expect(faq.mainEntity.map(q => q.name)).toEqual(summaries);
    expect(faq.mainEntity.map(q => decode(q.acceptedAnswer.text))).toEqual(answers);

    // It argues the category. Naming a competitor here is how a near-identical
    // name turns into a letter from somebody's lawyer (owner call 2026-09-12).
    expect(h.toLowerCase()).not.toContain('tradedeskpro.net');

    // The whole point is sending readers to the product.
    expect(h, 'links home').toMatch(/href="\/"/);
    expect(h, 'and to signup').toContain('/?signup=1');

    const art = nodes.find(n => n['@type'] === 'Article');
    expect(art && art.publisher).toEqual({ '@id': PUBLIC + '/#org' });
  });

  // Found live on 2026-09-12: seven marketing pages carried an EMPTY
  // <script data-dc-script> block, and the runtime rejects that by painting a
  // red error box over the page. support.js renders logicError with no
  // environment gate (support.js:1013), so every visitor to those pages saw
  // it. A page with no dynamic bindings simply has no such block, which is
  // what compare/jobber.html, privacy.html and terms.html already did (7.3).
  test('no page ships an empty dc-script block, which the runtime paints as an error', async () => {
    const bad = [];
    for (const r of ROUTES) {
      const m = html[r].match(/<script type="text\/x-dc"[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/);
      if (m && !m[1].trim()) bad.push(r);
    }
    expect(bad, `these render a red error banner: ${bad.join(', ')}`).toEqual([]);
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
