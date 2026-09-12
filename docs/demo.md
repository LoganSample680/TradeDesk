# The live demo

The marketing page shows the real app, not pictures of it. `landing.html` puts
`index.html` in a frame with `?demo=1`, so a visitor plays with production
exactly as it stands. A merge to main rebuilds production and the frames serve
the new app on the next page load. There is no second copy of the app, no
snapshot and no screenshot, so the demo cannot drift from the product.

## The theater

Both entry points open the same thing: a full-screen overlay with the real app
running at native size inside it, a labelled Close button, and Escape as the
second way out. The page behind stops scrolling while it is up.

The app is **not scaled**. The first version of this ran the demo inside the
decorative device mockups, a 390px app transformed down into a 260px picture of
a phone, and the owner's verdict was that it "really doesn't work". He was
right: the real UI was illegible at that size and there was no way back out of
it. The mockups are now what they always were, a poster you tap.

Both the hero's "Try it live" and the walkthrough's "Play the guided tour" open
the theater. Neither loads anything until it is tapped: the app is a few hundred
KB and putting that behind the hero would cost the page its load on a phone.

## The tour: eight chapters, played like a video

One chapter per stage of the job, in order:

| # | Chapter | Beats |
|---|---|---|
| 1 | Enter the lead | the client record, then the property it pulled |
| 2 | Build the proposal | the estimate, twice |
| 3 | The client signs | **presentation mode**, then the signed job |
| 4 | Schedule the work | the calendar, then the crew's view of it |
| 5 | On the job | drive time, then time on site |
| 6 | Change order | the extra work, then the moved contract total |
| 7 | Invoice | off the finished job, then the balance |
| 8 | Get paid | payment in, then the lien deadline |

Sixteen beats at 6.5 seconds each, so about two minutes end to end. The
narration strip shows the chapter chips, the line for the beat, a bar that
fills over it, and prev/play/next.

Chapter 3 beat 1 is the one worth knowing about. "What it looks like for clients
to sign" is not the contractor's bid detail, it is `_presentOpen`
(js/generic-estimate.js), the screen a contractor turns around and hands across
the kitchen table. It is rendered from this proposal by the app's own writer, so
it is literally the customer's view, down to the live "Approve & sign" button.
Its scene seeds the job **unsigned** on purpose, because the moment being shown
is the one before the signature.

**Pausing is not a stop.** The frame is the real app, so paused and "playing
with it yourself" are the same state; only the narration stops. That is what
lets one thing be both the demo and the how-to.

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
- `/?demo=1&step=5` boots at a step (the older 1-8 index).
- `/?demo=1&scene=present` boots at a named scene. The scenes are in
  `_TD_DEMO_SCENES` (js/demo.js): a scene is a stage to seed plus the screen to
  land on, which is how `present` seeds an unsigned proposal and still shows the
  client's view of it rather than the nearest numbered step.
- `postMessage({td:'demo', scene:'collect'})` from the parent page moves a
  running frame without reloading it. `{step:N}` still works. Same origin only.
- In the console: `tdDemoScene('present')` or `tdDemoStage(n)`.

## Tests

`tests/e2e-demo.spec.js` (offline shards) proves the sandbox keeps the demo out
of real account data, that two demos never see each other, that all eight
stages land on their screen with that stage's record and no console errors, and
that the money adds up. It also holds the theater to its shape: a full-viewport
overlay with both ways out, a frame that is never scaled, eight chapters in
order with the old step list deleted rather than hidden, the client-signs scene
opening presentation mode on an unsigned proposal, and a scene message steering
a running frame with no reload and no overlay left behind.
`tests/preview-smoke` proves the demo boots on the real deploy, which is the one
thing only a live origin can show.

The demo has no backend by design, so there is deliberately no `tests/flow`
spec for it: a live-backend test of a backend-free feature would prove nothing.

## What this replaced

The hero recreations and the eight step recreations were hand-built HTML that
had to be updated by hand whenever the app changed, and silently went stale
when nobody did. The eight step recreations are deleted (7.1 guards it); the
hero's are the poster frame only. Nothing on the marketing page claims to be a
screenshot of the app any more.

The eight numbered steps went with them. They were a list of abstract stages
beside a phone picture, and the walkthrough that drove them put the app in a
frame too small to read. The same eight stages are now eight narrated chapters
in the theater, which is the part that changed: not how many, but that each one
opens the real screen full size with a line of narration over it.
