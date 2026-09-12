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
