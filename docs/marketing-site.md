# Marketing site and the "/" gate

The public marketing site for `https://tradedeskpro.app` lives in this repo's
root next to the app: 12 plain HTML pages, no build step, no npm. The pages were
designed in a separate project and copied here; this doc covers how they are
routed, how "/" is shared with the app, and how to deploy.

## One domain, and what "/" does

`tradedeskpro.app/` is both the app and the marketing home. `functions/index.js`
is a Cloudflare Pages Function mounted on "/" only, and it picks:

| Request | Serves |
|---|---|
| carries the `td_app=1` cookie | the app (`index.html`) |
| User-Agent contains `TradeDeskShell` (the iPhone shell) | the app |
| any query string: `?app=1`, `?signup=1`, `?emp_invite=`, OAuth `?code=`, and so on | the app |
| anything else (first visit, crawler, shared link) | the marketing page (`landing.html`) |

The app writes the cookie on every session-backed boot (`_tdAppCookie` in
`js/cloud.js`) and clears it when the account is wiped on sign-out. So a phone
that has used the app opens straight into it, a new desktop visitor gets the
landing page and taps Log in (`/?app=1`), and a signed-out browser is back on
the marketing page.

Two more guards so nobody is ever stranded on the marketing page:

- `landing.html` starts with an inline script that sends the Capacitor shell
  and standalone home-screen installs to `/?app=1` before anything renders.
  That covers the shell builds that predate the user-agent token.
- `manifest.json` starts the PWA at `/?app=1`.

`/landing` always shows the marketing page, cookie or not. That is how a
signed-in owner looks at it; its canonical tag names "/", so it is not a
duplicate in search.

`sw.js` never caches a response marked `X-TD-Page: landing` as the app's
offline fallback.

## Routing

Cloudflare Pages serves `foo.html` at `/foo`, so the on-disk layout is the URL
map. Nothing in `_redirects` is needed.

| Route | File |
|---|---|
| `/` | `landing.html` via the function (or `index.html`, the app) |
| `/compare` | `compare.html` |
| `/compare/jobber` | `compare/jobber.html` |
| `/compare/quoteiq` | `compare/quoteiq.html` |
| `/compare/dripjobs` | `compare/dripjobs.html` |
| `/compare/servicetitan` | `compare/servicetitan.html` |
| `/painting-contractor-software` | `painting-contractor-software.html` |
| `/plumbing-contractor-software` | `plumbing-contractor-software.html` |
| `/handyman-contractor-software` | `handyman-contractor-software.html` |
| `/tools/lien-deadlines` | `tools/lien-deadlines.html` |
| `/privacy` | `privacy.html` (the app's Settings and signup links still say `privacy.html`; Cloudflare 308s that to `/privacy`) |
| `/terms` | `terms.html` |

Root files: `robots.txt`, `sitemap.xml`, `llms.txt`.

Shared assets, loaded by absolute path from every page so nested routes resolve
them: `/support.js` (the page runtime) and
`/_ds/tradedesk-design-system-019e1e22-25c2-77a5-9117-5b4c4f7bd36d/` (only the
two files the pages load: `colors_and_type.css`, `_ds_bundle.js`).

`support.js` pulls React, ReactDOM and Babel from unpkg at runtime and hides the
static `<x-dc>` markup until React is up. If unpkg is unreachable the page is
blank and logs an error. Vendoring React under `js/vendor/` and pointing
`window.__resources` at it would remove that single point of failure; not done
yet.

## Legal pages

`privacy.html` and `terms.html` are the marketing versions and also what the
app links to. The privacy page carries the App Review disclosures the previous
version spelled out (the in-app deletion path "Settings, Danger zone, Delete
account", what an employer sees, the two-consent rule for personal phones);
`tests/e2e-legal-pages.spec.js` asserts them by text. The operator mailing
address is 2015 SW Randolph Avenue, Topeka, Kansas 66604.

## iPhone shell

`native/capacitor.config.json` appends `TradeDeskShell` to the WKWebView user
agent. That takes effect on the next iOS build (rule 3.2: builds are fired only
on explicit owner approval). Until that build ships, the landing guard above
covers the existing shell.

## Local preview and tests

```
node scripts/serve-site.js          # http://127.0.0.1:8790, Cloudflare rules + the "/" gate
npx playwright test tests/e2e-site-routing.spec.js tests/e2e-legal-pages.spec.js --project=chromium --reporter=line
```

`scripts/serve-site.js` mirrors Cloudflare's static rules (`.html` and trailing
slash 308 to the clean URL, misses 404) and evaluates the same `wantsApp()` the
function runs. The routing spec proves every route, every internal link, both
shared assets from nested routes, the root files, that the sitemap and llms.txt
only name real pages, the CTA targets, the "/" gate for every input class, the
landing guard, and that the landing FAQ JSON-LD matches the 19 visible
`<details>` items. Its second half boots the real app on the offline harness and
proves the cookie is set, `?signup=1` opens signup, and the wipe clears it.

## What an AI says TradeDesk is

An AI asked about contractor apps in September 2026 described tradedeskpro.app
as "a proposal/estimating tool aimed at painters, with Sherwin-Williams pricing,
e-signature proposals with ESIGN/UETA disclosures, client project portals and
lien deadline tracking," and listed two similarly-named products as if one of
them might also be us.

That summary was not written from the marketing page. It is `sign.html` plus
`client.html` plus the app's estimator. Those pages, and `index.html`,
`intake.html` and `contract-sign.html`, were fully crawlable with no meta
description, no canonical and no robots directive, so a crawler landing on one
had nothing to summarise but body text, and the body text of a painting proposal
is a painting proposal. Only `timesheet.html` was marked noindex.

All six now carry `<meta name="robots" content="noindex,nofollow">`. They are the
app and per-customer links, never pages search should rank, and an indexed
proposal or project hub is a privacy problem regardless of branding.

**noindex, deliberately not a robots.txt `Disallow`.** A disallowed page is never
fetched, so the crawler never reads the directive and anything already indexed
stays indexed. noindex is the one that removes them.

Two smaller signals went with it:

- The landing page declared **two** Organization nodes for one company: a full
  one at `#org` and an inline duplicate as the SoftwareApplication's publisher.
  The publisher now references `#org`, and the Organization and WebSite nodes
  carry `alternateName` so "TradeDesk" and "TradeDesk Pro" resolve to one entity.
- `llms.txt` opens with a "Which TradeDesk this is" section naming the one
  domain and denying the two descriptions that have actually been produced: that
  it is painting-only, and that it is an AI call-answering service.

`tests/e2e-site-routing.spec.js` guards all three, including the mirror case: a
noindex must never leak onto a page we want ranked.

Still open, needs the owner: whether TradeDesk owns the other domains using the
name. If it does, they should 301 to tradedeskpro.app, which collapses the
confusion at the source. If it does not, the defensive signals above are the
whole of the fix. No `sameAs` is claimed in the structured data because no
verified profile URLs were available.

## Getting a recrawl, rather than waiting for one

The noindex above was the right fix and it did nothing on the day it shipped,
because a noindex only takes effect when the crawler comes back and reads it.
A live search hours after the merge still returned a summary written from the
app's internals (paint pricing, proposal terms, the client portal). On a
crawler's own schedule that wait is weeks, and meanwhile the stale entry is
what every AI assistant repeats, because they read the search index, not the
site.

Three things shorten it:

- **IndexNow** (`scripts/indexnow.js`, `.github/workflows/indexnow.yml`). One
  POST asks the participating engines to recrawl, in hours rather than weeks:
  Bing, Yandex, Seznam, Naver. **Bing is the one that matters most, because it
  is what ChatGPT's search reads.** It fires on a push to `main` that touches
  any page, and only after waiting for Cloudflare to actually serve that
  version, or the crawlers are invited to look at the old build. The submission
  is the sitemap's URLs **plus** the six noindexed pages, which is the point: a
  crawler has to fetch those again to see the noindex and drop them.
  **Google does not participate in IndexNow** and still needs Search Console.
- **`lastmod` in `sitemap.xml`** (`scripts/sitemap-lastmod.js`, run by the
  pre-commit hook next to `bump-version.js`). Each date is the page's own last
  commit, or today when the commit in hand is what changes it. It is derived
  rather than typed on purpose: Google honours lastmod only while a site is
  consistently honest about it, and discounts it for good once a site is caught
  stamping today on everything. The routing spec fails on a future date.
- **`X-Robots-Tag` in `_headers`**, alongside each page's meta tag. A crawler
  that fetches without parsing the HTML still gets the header, and Cloudflare
  serves these at the clean URL (`/sign`) while the app links to them by
  filename (`/sign.html?t=...`), so both spellings carry the rule. The spec
  also asserts the mirror case: `/` must never pick one up, since that is the
  marketing page.

**The IndexNow key is public by design.** It authenticates by proving whoever
submits controls the site: the engine fetches `https://tradedeskpro.app/<key>.txt`
and checks it contains the key. It is not a secret and must stay committed.
Rotating it means replacing that one file; `scripts/indexnow.js` finds whichever
`<hex>.txt` is at the repo root.

**Still needs a human, and it is the fastest lever for Google:** Search Console
and Bing Webmaster Tools. Submit the sitemap, and use Search Console's **URL
removal** tool on `/index.html`, `/sign` and `/client` to purge the stale
entries in days instead of waiting for the recrawl to do it.

## The apex challenges /version.json sometimes

Cloudflare intermittently answers `/version.json` on `tradedeskpro.app` with its
"Just a moment..." managed challenge (403, an HTML body) when the client scores
as a bot. The preview smoke's headless browsers hit it: webkit alone on
2026-09-11, both engines on 2026-09-12. There is no engine bug here; the CI WAF
bypass header skips the custom WAF rules but not Cloudflare's bot protection.

The app is unaffected. Every reader of that file handles a non-answer:
`_checkVersionOnResume` and `_geoBgUpdateCheck` (js/cloud.js, js/geo-track.js)
return on `!r.ok`, and `_probeAndSync` and `_classifyCloudError` only care
whether the fetch throws, which a 403 does not. The worst case is one missed
15-second version check.

The smoke therefore gates on `APP_VERSION` (parsed from the bundle the origin
just served, which proves the deploy outright) and reports a challenged
`/version.json` as a warning instead of a deploy failure. A wrong version there
still fails. To make it answer in CI, the WAF skip rule for `x-e2e-bypass` has
to skip bot protection too, which is a Cloudflare dashboard change.

## Deliberate gaps (do not "fix")

- No `og:image` on any page: the 1200x630 asset does not exist yet. When it
  does, add `og:image` and `twitter:image` to all 12 pages and switch
  `twitter:card` to `summary_large_image`.
- No App Store links. The hero chip says the iPhone app is in beta because it is
  in TestFlight. Revisit at App Store launch (smart banner too).
- No phone number or call scheduling. Email only.
- The hero device mockups are hand-built recreations. They are now the poster
  frame behind the live demo, shown until a visitor taps "Try it live" and as
  the no-JS fallback. The `phoneShot`, `tabletShot`, `desktopShot` props still
  accept an image path if one is ever wanted instead (phone 524x1224, tablet
  744x1120, desktop 988x1090; `object-fit: cover`, top anchored).
- The landing FAQ JSON-LD must keep matching the visible `<details>` items.
  Markup-only Q&A risks a Google manual action. The spec guards this.

## The live demo

Built. The device frames and the eight-step walkthrough run the real app
(`/?demo=1`) rather than showing pictures of it, so they cannot go stale. See
`docs/demo.md`.
