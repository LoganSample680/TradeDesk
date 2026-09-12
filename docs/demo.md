# The live demo

The marketing page shows the real app, not pictures of it. `landing.html` puts
`index.html` in a frame with `?demo=1`, so a visitor plays with production
exactly as it stands. A merge to main rebuilds production and the frames serve
the new app on the next page load. There is no second copy of the app, no
snapshot and no screenshot, so the demo cannot drift from the product.

## The two frames

**The hero is a sandbox.** The three device mockups keep their hand-built
recreation as a still poster with a "Try it live" pill over it. Tap it and the
real app loads into whichever device is showing. From then on it is theirs: add
a client, reprice a line, move a job.

**The eight steps are a walkthrough.** The step list sits beside a second
frame. Tapping a step rebuilds the same sample job at that point in its life
and shows the screen that step is about. It stays live, so at step 3 a visitor
can tap "Send for signature" themselves instead of pressing Next.

The two frames are separate iframes, so they are separate copies: playing in
the hero never disturbs the walkthrough.

Both load on tap, never on first paint. The app is a few hundred KB of HTML
plus its scripts, and putting that behind the hero would cost the page its load
time on a phone signal. The recreation stays behind the frame as the poster, so
the hero is never empty before the tap, with no JS, or if a frame fails.

## Isolation, and why it is the important part

The demo runs **same origin** with the real app. Without a sandbox it would
share `localStorage` with the signed-in account on that device: it would read
the owner's real business and overwrite it.

So `index.html`'s head, before any other script parses, replaces
`window.localStorage` and `sessionStorage` with in-memory stores and removes
`indexedDB`. It must run that early because `js/cloud.js` reads storage at
parse time and `js/data.js` loads settings from it. If the sandbox cannot be
installed the demo refuses to boot rather than running against real storage.

That one mechanism delivers all of it:

- the demo cannot read or write the real account's data,
- every frame and every tab gets a private copy, so any number of visitors can
  be in the demo at once without touching each other,
- it resets on every load, because memory starts empty.

`supaEnabled()` returns false in demo mode (`js/cloud.js`), so no Supabase
client is ever constructed and nothing can leave the browser. The service
worker is not registered. `_tdAppCookie()` is a no-op, so trying the demo does
not turn `/` into the app for that visitor.

## The seed

`js/demo.js` builds one painting company and one job, walked from the first
call to paid. The rule is: everything up to and including the requested stage
exists, and nothing after it does. That is why a step can never show a record
belonging to a later step.

| Step | Stage | Screen |
|---|---|---|
| 1 | `lead` | client record |
| 2 | `estimate` | bid detail, unsigned |
| 3 | `sign` | bid detail, signed, deposit taken |
| 4 | `schedule` | calendar |
| 5 | `onsite` | time log, owner and crew |
| 6 | `change` | bid detail with the signed change order folded in |
| 7 | `invoice` | money, balance owing |
| 8 | `collect` | money, paid in full |

The seed is rebuilt from scratch for a stage every time, never stored and never
diffed, so a stage looks the same however the visitor arrived at it.

The record shapes are the ones the app's own writers produce, and several
details are load-bearing rather than cosmetic. An expense's `job_id` is the
**bid** id, not the job id. A change order is nested on the bid in
`changeOrders[]` and the bid's `amount` is already the new total. There is no
invoice record: "invoiced" is a `Closed Won` bid with a `completion_date` and a
balance. A time entry needs `open:false` or the app reads someone as still
clocked in. Both signature spellings (`signedName`/`signatureData` and
`signerName`/`sigData`) have to be set, because different screens read
different ones.

## Driving it

- `/?demo=1` boots at step 1.
- `/?demo=1&step=5` boots at a step.
- `postMessage({td:'demo', step:N})` from the parent page moves a running frame
  without reloading it. Same origin only.
- In the console: `tdDemoStage(n)`.

## Tests

`tests/e2e-demo.spec.js` (offline shards) proves the sandbox keeps the demo out
of real account data, that two demos never see each other, that all eight steps
land on their screen with that step's record and no console errors, and that
the money adds up. `tests/preview-smoke` proves the demo boots on the real
deploy, which is the one thing only a live origin can show.

The demo has no backend by design, so there is deliberately no `tests/flow`
spec for it: a live-backend test of a backend-free feature would prove nothing.

## What this replaced

The hero recreations and the eight step recreations were hand-built HTML that
had to be updated by hand whenever the app changed, and silently went stale
when nobody did. They are now the poster frame only. Nothing on the marketing
page claims to be a screenshot of the app any more.
