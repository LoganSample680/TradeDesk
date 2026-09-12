#!/usr/bin/env node
// Tell the search engines to recrawl, instead of waiting to be noticed.
//
// WHY THIS EXISTS. On 2026-09-12 a live search for the site returned a summary
// written from the APP's internal pages (paint pricing tables, proposal terms,
// the client portal) rather than from the marketing page. The pages had just
// been marked noindex, but a noindex only takes effect when the crawler comes
// back and reads it, and "when it comes back" is normally weeks. Meanwhile the
// wrong description is what every AI assistant repeats, because they read the
// search index rather than the site.
//
// IndexNow is the fix for the waiting. One POST lists the URLs that changed and
// participating engines recrawl in hours: Bing, Yandex, Seznam, Naver. Bing is
// the one that matters most here, because it is what ChatGPT's search reads.
// Google does NOT participate, so Google still needs Search Console (submit the
// sitemap, and use URL removal to purge the stale app-page entries fast).
//
// The key is deliberately public. IndexNow authenticates by checking that
// https://<host>/<key>.txt exists and contains the key, which proves whoever is
// submitting controls the site. It is not a secret and must stay committed.
const fs = require('fs');
const path = require('path');

const HOST = 'tradedeskpro.app';
const root = path.join(__dirname, '..');

// The key is whichever <32-hex>.txt sits at the repo root, so rotating it means
// replacing that one file and nothing else.
const keyFile = fs.readdirSync(root).find(f => /^[0-9a-f]{8,128}\.txt$/.test(f));
if (!keyFile) {
  console.error('indexnow: no key file at the repo root (expected <hex>.txt)');
  process.exit(1);
}
const key = fs.readFileSync(path.join(root, keyFile), 'utf8').trim();
if (key !== path.basename(keyFile, '.txt')) {
  console.error(`indexnow: ${keyFile} must contain exactly its own name`);
  process.exit(1);
}

// Submit exactly what the sitemap claims, so there is one list and it cannot
// drift from the one the canonicals and the routing test already agree on.
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

// The pages that were wrongly indexed go in TOO, even though they are noindex
// now and are not in the sitemap. That is the whole point: a crawler has to
// fetch them again to see the noindex and drop them, and this is what asks.
// /ops is deliberately NOT here. This list exists for pages already IN the
// index that need re-fetching to see the noindex; the ops portal is new and was
// noindex from its first commit, so submitting it would invite a crawl of the
// one page least worth crawling rather than remove anything.
const PURGE = ['/index.html', '/sign', '/client', '/intake', '/contract-sign', '/timesheet']
  .map(p => `https://${HOST}${p}`);

const body = {
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${keyFile}`,
  urlList: [...new Set([...urlList, ...PURGE])],
};

if (process.env.DRY_RUN) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
}).then(async (r) => {
  const text = await r.text().catch(() => '');
  // 200 and 202 both mean accepted. Anything else is worth seeing in the log,
  // but it must never fail the deploy: this is a hint to a third party, not a
  // step the site depends on.
  console.log(`indexnow: ${r.status} ${r.statusText} for ${body.urlList.length} urls ${text.slice(0, 200)}`);
  if (!r.ok) console.log('::warning::IndexNow did not accept the submission');
}).catch((e) => {
  console.log(`::warning::IndexNow submission failed: ${e && e.message}`);
});
