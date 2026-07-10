# TradeDesk — Claude Code Instructions

> These rules are mandatory. They are not suggestions. Every rule applies on
> every task unless explicitly overridden in writing by the user in this session.

---

## What TradeDesk Is

TradeDesk is a white-label, mobile-first CRM built for trade contractors — painting,
electrical, plumbing, HVAC, landscaping, general contracting — covering the whole job
lifecycle: lead intake → estimate/proposal (T&M, BYO/custom, fixed-scope) → e-sign →
schedule → dispatch the crew → track time/mileage/materials on-site → invoice → collect
payment (Stripe) → change orders → lien protection → tax/1099 tooling → crew
geo-tracking. One account per contractor business; employees join as crew with
permission-gated access to money/estimates.

The product thesis: **out-execute ServiceTitan, Jobber, and Housecall Pro on UX** —
fewer taps, faster flows, a genuinely pleasant mobile experience — not by matching
their feature checklists line for line. §12's Flow Test Standard measures every click
for exactly this reason: the click count against a hard-gated baseline IS the product.
The full competitive set (QuoteIQ, DripJobs, FieldPulse, trade-specific tools, and
more) is at §16.1 — check it before researching any new feature.

Backend: Supabase (Postgres + Auth + Storage + Edge Functions + Realtime). Frontend:
vanilla JS, no framework, deployed as static files on Cloudflare Pages. E2E-tested with
Playwright — offline-mocked shards gate every push; live-Supabase flow tests validate
real behavior on demand.

---

## Communication — plain English, always

Talk to the owner like a person, not a compiler. Every reply:

- **Plain English.** No jargon dumps. If a term is unavoidable, say it in one plain
  sentence too. Assume the owner is smart but not reading the code.
- **Lead with the answer.** First line = what happened / what to do. Details after,
  only if they help.
- **Short.** Cut everything that isn't load-bearing. Long walls of text lose the owner.
- **"What you need to do" is explicit.** If the owner has an action, put it in a short
  numbered list with the exact taps/values. If there's nothing for them to do, say so.
- **Name the thing that broke and the fix in one line each** — not a five-paragraph tour.
- **No status noise.** Don't narrate every CI poll or push. Report when something needs
  the owner or when a real result lands.

This rule is mandatory and applies to every response, not just summaries.

---

## 0. The Loop (plain English — read this first)

How a change ships. Repeat until review is clean:

1. **Build it** — write the feature + its tests on the branch.
2. **Local tests** — flow tests on a local copy + the offline CI shards. Free, no Cloudflare.
3. **Cloud gate** — the same tests, now against the REAL backend (Dev Supabase + Stripe).
   The app still runs on localhost, so still no Cloudflare cost. This seeds real data into
   Dev A/B for you to poke at.
4. **Build the preview** — ONE deliberate deploy. Cloudflare builds the real app. Comes
   AFTER the cloud gate (the cloud gate doesn't need it — don't pay for a build you might toss).
5. **Smoke the preview** — a tiny check that the *deploy itself* is healthy: right version
   (not a stale cache), `/api` works, maps load. Dozens of requests, not thousands.
6. **You review the live preview.** Anything off → back to step 1.

**Step 0.5 — for anything with a visible surface, screenshot before you build a preview:**
new element, moved/resized/restyled element, new screen, animation, or any copy change
that shifts layout. Render the actual changed screen locally (headless-browser screenshot
against a local server — no Cloudflare build) and send it in chat for a reaction. Iterate
on the screenshot, not on live deploys. Skip this only when the change has no visual
surface (backend logic, sync fixes, test-only changes) — those deploy on request as usual.
Reason: a Cloudflare build plus the app's version-watchdog (polls every 15s, auto-reloads
on any mismatch) means three quick visual fixes in a row is three forced reloads on
whatever device the owner is holding mid-review. A screenshot costs nothing and iterates
as fast as the conversation — save the deploy for the version already approved in principle.

**Two different "clouds" — don't mix them up:**
- *Cloud gate* = real **backend** (Supabase, Stripe). App runs on localhost. Cheap.
- *Preview* = the real **front-end**, deployed on Cloudflare. The smoke checks this one.

**Plain rules:**
- Every dev commit carries `[CF-Pages-Skip]` so Cloudflare does NOT rebuild. Only the
  step-4 "ready" commit deploys.
- **Production lags on purpose.** It only updates when you say "deploy/promote." A *preview*
  is your branch's code; *production* is whatever you last shipped — never the same mid-work.
- **Never merge or deploy without you saying so** — not even when everything is green.
- **One push, then WAIT** for the tests to report before the next push. Pushing mid-run
  kills the test that's running.

Everything below is the detailed version of the above.

---

## 1. Git Workflow — CI-Gated PR Flow

**Never push directly to `main`.** All changes go through a PR so CI must pass
before `main` is updated.

---

### 1.1 Step-by-Step — Execute Automatically After Every Push

#### Step 1 — Push to the Feature Branch

```
git push -u origin claude/review-app-ux-flow-mRafw
```

#### Step 2 — Ensure an Open PR Exists

Call `mcp__github__list_pull_requests` (state: open, head: the feature branch).

| Situation | Action |
|-----------|--------|
| No open PR found | Create one immediately via `mcp__github__create_pull_request`. Do not wait for the user to ask. |
| Open PR already exists | The push automatically re-triggers CI on it. Note the PR number. |

#### Step 3 — Subscribe to PR Activity

Call `mcp__github__subscribe_pr_activity` immediately after opening or finding the
PR. This delivers CI results, review comments, and failures directly into the
conversation without polling.

#### Step 4 — Wait for CI and Handle Results

GitHub Actions runs Playwright across WebKit + Chromium.

**✅ All shards pass:**

Report green to the user and wait for explicit merge approval. Do not merge.

**❌ Any shard fails — fetch the actual Playwright log:**

1. Call `mcp__github__pull_request_read` with `get_check_runs` to identify the
   failing shard and retrieve its `html_url`.

2. Call `WebFetch` on that `html_url`:
   ```
   https://github.com/LoganSample680/TradeDesk/actions/runs/.../job/...
   ```
   Prompt: *"Extract all failing test names, assertion errors, and stack traces."*
   This returns the test name, `file:line`, and `Expected / Received` values
   needed to diagnose the failure.

3. Fix the root cause on the feature branch and push again.
   CI reruns automatically. Repeat until all shards are green.

**⚠️ Flaky test (fails on attempt 1 or 2, passes on retry):**

A test that "eventually passes" is **not** green.

1. Use the same `WebFetch` log steps above to get the failure output.
2. Identify and fix the root cause.
3. Push the fix and wait for CI to confirm a clean first-attempt pass — no
   retries triggered.

#### Step 5 — Merge Only With Explicit User Approval

Never call `mcp__github__merge_pull_request` unless the user has said "merge it",
"ship it", "go ahead", or equivalent in this session.

Always ask first: *"All shards green — OK to merge?"*

---

### 1.2 Webhook Noise — Complete Silence on Non-Failure Events

**Say nothing in response to any webhook event that requires no action.**

No acknowledgement, no "no action needed", no "waiting on shards", no
confirmation that a deploy succeeded. Zero output to the user.

The following events must produce **no response whatsoever**:

- Cloudflare Pages "build in progress" and "deploy successful" notifications
- Supabase preview ⏸️ (no migrations) and ✅ (all tasks passed)
- "Waiting on shards" status updates
- Any CI shard with `status: in_progress`
- CI shards completing with `conclusion: success`

**Only produce output for events that require action:**

| Event | Output |
|-------|--------|
| Shard `conclusion: failure` | What failed + what was fixed + pushed |
| Review comment requesting a change | What changed + pushed |
| CI shard stuck `in_progress` > 15 min | Flag to user |

When fixing a failure: report only the failing test name, the root cause,
and what was changed. Nothing else.

---

### 1.4 Non-Negotiable Rules

- **Every push must have an open PR.** Create one if it does not exist. Always.

- **Never merge to `main` without explicit user permission.** Not even when CI is
  fully green. ONE exception, granted in writing by the owner: live-error hotfix
  PRs (`claude/hotfix-err-*` branches) merge autonomously when fully green — see
  §13.1 for the exact rules. Everything else: no exceptions.

- **Verify CI by re-polling** `get_check_runs` and confirming every shard shows
  `status: completed, conclusion: success` before reporting green. Do not rely
  solely on webhook events — they can arrive out of order or with duplicate IDs.

---

### 1.5 What "CI Green" Means

| Requirement | Standard |
|-------------|----------|
| Hard failures | 0 across all WebKit and Chromium shards |
| Flaky tests | None — every test must pass on first attempt |
| Console errors | 0 new `console.error` calls introduced by the change |

---

### 1.6 NEVER Push Over In-Flight Tests — Wait for the Full Result Set

> One push, then **wait for the whole result set** before the next push. No exceptions.

After any push, **do not push, force-push, amend-and-force, or re-trigger anything**
on the branch until BOTH of these have come back for the **current HEAD**:

1. **All offline shards** (`test (1)`…`test (6)`) — every one `completed / success`.
   Not 5 of 6. Not "shard 4 passed." **All of them.**
2. **A real flow run** — EITHER the self-hosted **flow-local** (local-stack) run OR the
   **Supabase cloud** live flow run — `completed / success`.

Both gates. Offline-green alone is **not** enough to push again. Flow-green alone is
**not** enough either. Wait for both.

**Why this rule exists (and cost a wasted run):** force-pushing a new commit while a
prior flow run is still `in_progress` **cancels/orphans that run** (`concurrency:
cancel-in-progress`) — the result never lands, the self-hosted runner minutes are
burned, and we learn nothing. Every rapid-fire push throws away the test we were
waiting on.

**The only thing allowed while a run is in flight is reading status.** Poll
`get_check_runs`, read logs, investigate, draft the fix locally — but the fix **sits
uncommitted/unpushed** until the in-flight runs report. If a failure is obvious mid-run,
still wait for the run to finish before pushing the fix, so its result is recorded.

**Bootstrapping note:** the first push of a change is what starts CI — that's fine.
This rule bans the *second* push (and every push after) until the *first* one's full
result set (both gates above) is in.

---

## 2. Version Bumps

The pre-commit hook (`scripts/bump-version.js`) handles version bumps
automatically. **Do not manually edit version files.** The hook stages them as
part of every `git commit`.

**Version format:** `MM.DD.YY.NN`
— Date in US Central Time (`TZ='America/Chicago'`).
— `NN` resets to `1` at midnight CT and increments with each push on the same day.

**One-time setup after cloning:**
```
bash scripts/install-hooks.sh
```

**Fallback — only if the hook did not fire:**

If `git commit` output does NOT include `[bump-version]`, the hook is missing.
Run manually then re-commit:
```
node scripts/bump-version.js
```

---

## 3. Dev Branch

All development work goes on branch: `claude/review-app-ux-flow-mRafw`

Never commit or push to any other branch without explicit user permission.

---

## 4. Branch Protection (One-Time Setup by Repo Owner)

Go to **GitHub → Settings → Branches → Add rule** for `main`:

- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status check name: **E2E Tests / test**
- ✅ Require pull request before merging
- ✅ Do not allow bypassing the above settings

This makes it impossible for broken code to reach `main` — not even via direct push.

---

## 5. E2E Test Philosophy — New Features

The test suite is the quality gate. **Every new feature gets E2E tests.**

---

### 5.1 Tests Ship in the Same Commit as the Feature — Always

New feature code and its E2E tests are written together and committed together.
CI sees both at once, so the new tests cover the new code and the suite passes.

- **New features are never blocked by CI** — their tests arrive with them, not after.
- **CI only fails if something is actually broken** — a real regression, a console
  error, or a test written incorrectly.
- **Tests are proof of correctness, not a fence around the code.**

---

### 5.2 New Feature Checklist

1. Write the feature code on the feature branch.
2. Write E2E tests in the **same commit**: happy path + edge cases + an
   `assertNoErrors()` call to confirm zero console errors.
3. Push → CI runs the full WebKit + Chromium suite automatically.
4. If CI fails → fetch logs via WebFetch, fix on the feature branch, push again,
   CI reruns. Loop until green.
5. When CI is green → merge via PR with explicit user approval.

**Never run tests locally.** Push and let CI handle everything. Local test runs
dump hundreds of lines into context for no benefit — CI runs the same browsers
and reports back via webhook.

---

### 5.3 Console Error Policy

Any `console.error` a new feature introduces is a test failure.
`assertNoErrors()` enforces this in every describe block.

**Rule:** Fix the code, not the test. Never add a filter to `assertNoErrors()`
to hide a real error.

---

## 6. One Commit Per PR

Squash all work for a PR into **one commit** before pushing. Multiple commits
pushed in quick succession trigger `concurrency: cancel-in-progress` and kill
earlier shard runs — meaning CI results never appear in the PR.

**Workflow:**

1. Do all the work locally across as many commits as needed.
2. Before the final push: `git reset --soft HEAD~N` then recommit as one.
3. If already pushed: squash with `git reset --soft`, recommit, then
   `git push --force-with-lease`.
4. After a squash force-push, rebase onto `origin/main` if conflicts appear:
   ```
   git checkout -B <branch> origin/main && git cherry-pick <sha>
   ```

---

## 7. Code Removal & Cleanup Policy

**Dead code must be deleted, never hidden.**

When a feature is moved, replaced, or refactored:

- **Delete** the old code — functions, HTML elements, CSS, event handlers.
  Do not comment it out. Do not set `display:none`. Do not add `if(false)`.
- **Remove** every call site that referenced the deleted code.
  Search across all JS files and HTML before committing.
- **Never** leave orphaned functions defined but uncalled.

---

### 7.1 Tests Must Verify the Deletion

Every PR that removes or moves something must include E2E tests that assert
the old entry point no longer exists:

```js
// Function removed → assert it's gone
const fnExists = await page.evaluate(() => typeof oldFunction === 'function');
expect(fnExists).toBe(false);

// HTML element removed → assert it's absent from the DOM
const count = await page.locator('#old-element-id').count();
expect(count).toBe(0);
```

These tests are not optional. CI must prove the old entry point is gone, not
just that the new one works.

---

### 7.2 No Data Loss — Verify Before Removing UI

Before removing any UI that wrote to storage (`S.*`, localStorage, Supabase):

1. Confirm the underlying data key (`S.vehicles`, `maintenance`, etc.) is still
   read and written by the replacement code.
2. Confirm no migration is needed — existing user data loads correctly without
   the old UI present.
3. Call out in the PR description which data stores are affected and confirm no
   records are dropped.

---

## 8. CSS Transitions Standard

**Every page navigation and panel reveal must use a CSS transition.**
Hard-cut `display:none → display:block` with no animation is not acceptable.

---

### 8.1 Page Transitions — `.pg.active`

All app pages use the shared `td-pg-enter` keyframe, already defined globally:

```css
@keyframes td-pg-enter {
  from { opacity: 0; transform: translateY(7px); }
  to   { opacity: 1; transform: translateY(0); }
}

.pg.active {
  display: block;
  animation: td-pg-enter .2s cubic-bezier(.22, 1, .36, 1) both;
}
```

This covers every call to `goPg()` automatically — no per-page work needed.

---

### 8.2 Boot Overlay → Home Screen

The `supa-boot-overlay` fades out via `.td-fadeout` (`opacity:0; transition:opacity .65s cubic-bezier(.4,0,.2,1)`).
`#pg-dash` uses a dedicated `td-dash-enter` keyframe (scale `.97→1` + opacity, `.5s`) rather
than the generic slide-up, so the home screen feels like it's emerging rather than
jumping in. Both run concurrently for a smooth crossfade.

**Do not change these timings** without testing the sign-in → home transition visually.

### 8.3 Per-Page Overrides

Some pages require a longer entrance than the global `.2s` default:

| Page | Duration | Reason |
|------|----------|--------|
| `#pg-dash` | `.5s` `td-dash-enter` (scale) | Boot overlay reveal — must feel polished |
| `#pg-cal` | `5s` `td-pg-enter` | Weather fetch is async (can take 4–5s); slow fade ensures data lands before the page is fully visible |

**Rule:** Only add a per-page override when there is a concrete reason (async
data load, elevated visual importance). Do not slow down pages arbitrarily.

---

### 8.4 Rules for New UI Elements

| Element type | Required transition |
|--------------|---------------------|
| New full-page view (`.pg`) | Inherited automatically via `.pg.active` |
| Modal / bottom sheet | Fade + slide-up: `opacity 0→1, translateY 16px→0`, duration `.22s` |
| Inline panel / card expansion | `max-height` or `opacity` transition, duration `.18s` |
| Toast / snackbar | Already handled by existing toast util |
| Skeleton loaders | Fade out on data arrival: `opacity 1→0`, duration `.15s` |

**Easing standard:** `cubic-bezier(.22, 1, .36, 1)` for entrances (spring-like,
snappy). `ease` for exits and fades. Never use `linear` for UI motion.

**Duration standard:** 150–220ms for entrances. 120–180ms for exits. Nothing
over 350ms except the boot overlay (.65s) and pages with documented async-load
reasons (see per-page overrides table above).

---

### 8.5 What Not to Do

- Do not use `setTimeout` + style changes to fake transitions. Use CSS.
- Do not add `transition: all` — always specify the exact property.
- Do not animate `display`, `visibility`, or `height` from `auto` — use
  `opacity`, `transform`, or `max-height` with a known value.

---

## 9. Feature Backlog

Features discussed and deferred — do not build unless user explicitly asks.
Survives conversation compacting so context is not lost between sessions.

### 9.1 Platform Expansion (Future)

**TradeDesk Comms (CRM Texting)**
- SMS layer via Telnyx or Bandwidth (wholesale rates, bundled into subscription)
- iMessage delivery via Mac Mini on TradeDesk infra (no SendBlue dependency)
- Automation triggers: proposal sent → auto-text, job day-before reminder, invoice overdue, change order approval request, deposit confirmed
- Number provisioning per contractor account

**TradeDesk Payroll**
- W-2 employee payroll via Check (checkhq.com) for compliance/tax filing layer
- 1099 subcontractor payments via Stripe Payouts (ACH direct deposit)
- Payroll UI: employee management, hours entry, pay runs, pay stubs
- Replaces QuickBooks Payroll — contractor pays one TradeDesk bill
- Must handle: federal withholding, SS/Medicare, FUTA/SUTA, quarterly 941s, annual W-2s

### 9.2 Proposal & Job Document Chain

**Change Order Document**
- New document type linked to existing bid
- Native change order button in bid detail panel (biggest gap vs. ServiceTitan/Jobber/HCP)
- Client approval via new `change-order.html` signing portal (mirrors sign.html pattern)
- Numbered, dated, shows delta from original contract value
- Files: `js/change-orders.js` (new) + `change-order.html` (new) + `js/bids.js` + `js/data.js`

**Completion Invoice**
- Final document after work done — shows estimate vs. actual side by side
- Client signs off on final amount
- Files: `js/completion-invoice.js` (new) + `completion-invoice.html` (new) + `js/jobs.js`

**Range Estimate**
- Low/high price fields + "depends on" explanatory text on any proposal type
- No new files — touches `js/proposals.js`, `js/generic-estimate.js`, `sign.html`
- Client sees: "Estimated range: $X–$Y | Final price depends on: {notes}"

**NTE (Not-to-Exceed) Cap**
- T&M jobs only — contractor sets spending ceiling
- Alert at 90% of cap, hard stop + re-approval flow at 100%
- Partial code already exists: `_tmCalcNte()` in `js/generic-estimate.js`

### 9.3 AI Feature Layer

**Line Item Classification (Claude API)**
- Classifies each proposal line item: labor / materials / taxable service / equipment rental
- Debounced call on description entry, result cached by description hash
- Feeds sales tax calculation automatically
- Files: `js/ai-classify.js` (new) + Supabase Edge Function `classify-line-item`

### 9.4 TradeDesk Comms (SMS Infrastructure)

**Own the messaging layer — no Twilio, no SendBlue subscription**
- Build on Bandwidth API (Tier 1 carrier, not a reseller — ~$0.003-0.004/msg wholesale)
- TradeDesk provisions and manages contractor phone numbers via Bandwidth API
- Contractors see "TradeDesk Messaging," Bandwidth is invisible infrastructure
- Automation triggers: proposal sent, 24h unopened follow-up, signed confirmation,
  job day-before reminder, change order approval request, invoice overdue
- iMessage delivery: Mac Mini on TradeDesk infra handles Apple protocol (no SendBlue)
- Files: `js/messaging/engine.js`, `templates.js`, `numbers.js`, `webhooks.js`
  + Supabase Edge Functions: `send-sms/`, `sms-webhook/`

### 9.5 Employee Geo-Tracking & Job Time-on-Site

**Real-time location tracking with consent controls and business-hours gating**

- **Business hours window**: `S.trackingHours = {start:'07:00', end:'18:00'}` per contractor.
  Device only sends GPS pings when current time is within the window — no background
  drain or off-hours tracking on personal phones.
- **Geo-fence auto clock-in/out**: When a GPS ping lands within ~300ft of a job address,
  log `arrivedAt`. When device moves away, log `departedAt`. Auto-calculates time-on-site
  per job per employee. Displayed on the job sheet and dispatch board.
- **Two-layer consent for personal phones**: (1) Contractor grants the employee a
  "Share location" permission in the Add/Edit member modal. (2) Employee must explicitly
  tap-accept location sharing in their daily view. Both layers required — no covert tracking.
  If employee declines, tracking silently disabled for that device.
- **Manager-only visibility**: Device map and location history only visible when
  `_employeeRecord?.permissions?.team` is true. Field workers cannot see each other's
  locations.
- **Mileage integration**: GPS track auto-generates mileage log entries for the employee's
  drive legs between job sites — feeds into the existing mileage tracker.
- **Implementation notes**:
  - Supabase Realtime channel per contractor_user_id for live ping delivery
  - Edge Function `track-location` receives pings, validates business hours server-side
  - `S.geoFenceRadius` (default 300ft) configurable per contractor
  - Files: `js/geo-track.js` (new), `js/cloud.js` (employee daily view hook),
    `js/jobs.js` (time-on-site display), Supabase Edge Function `track-location/`
  - New `location_pings` table: `{id, contractor_user_id, employee_user_id, lat, lon, job_id, arrived_at, departed_at, ts}`

### 9.6 Employee Offer Letters & Employment Agreements (HR doc chain)

**Run hiring paperwork out of TradeDesk — reuses the e-sign portal pattern.**
- New document type: employee offer letter / employment agreement, generated from
  data already in `team_members` (name, role, pay_type, pay_rate).
- Client signing portal pattern (`sign.html`) is directly reusable → new
  `employ-offer.html` signing page; numbered, dated, e-signed, stored like proposals.
- Covers: pay & schedule, at-will statement, conditions of employment,
  confidentiality, and **location-tracking consent** — this is the legal cover for
  the now-mandatory crew geo-tracking (employee agrees in writing at hire).
- Ties into the invite flow: send offer → employee signs → `?emp_invite=` activates
  their account, so signing the agreement IS the onboarding step.
- **Legal caution:** employment law is state-specific (at-will language, non-compete
  enforceability, wage-notice requirements e.g. NY/CA). Ship vetted templates with a
  prominent "not legal advice — have an attorney review" disclaimer, mirroring the
  tax tool's disclaimer. Do not auto-generate binding terms without it.
- Files: `js/employ-offer.js` (new) + `employ-offer.html` (new) + `js/cloud.js`
  (team_members hook) + a `employment_agreements` store.

### 9.7 Apprentice / Journeyman OJT Hour Logging (geo-fence → master sign-off → state export)

**Turn the geo-fence clock-in into licensable on-the-job training hours.** Most trades
(electrical, plumbing, HVAC) require documented OJT hours for apprentice→journeyman→master
licensure exams — often thousands of hours, frequently broken into work-category buckets.

- **Capture**: the existing geo-fence/time-on-site engine (§9.5, `job_time_entries`) already
  logs verified on-site minutes per employee per job. Tag each entry with a **work
  classification** (e.g. for electrical: service/conduit/troubleshooting) so hours roll up by
  the categories a state board wants.
- **Sign-off chain**: reuse the e-sign portal pattern (`sign.html`) — accumulated hours get
  sent to the supervising **master/licensed supervisor** to e-sign off on (their license # on
  record), mirroring the proposal-signing audit trail (`signed_proposals`).
- **Export**: per-employee, date-ranged **OJT hours report**, exportable for the state
  apprenticeship board (PDF/CSV). Shows verified hours by category + supervisor attestation.
- **Open question (research first)**: per-state + per-trade requirements vary widely — total
  hours, category breakdowns, supervisor ratios, and the board's accepted report format. Build
  the capture + sign-off generically; the **state data model is the research piece** (start
  with the 2–3 states the first customers are in, not all 50). Ship with a "verify with your
  state board" disclaimer like the tax tool.
- **Files**: `js/ojt-hours.js` (new), `ojt-signoff.html` (new, mirrors sign.html), hooks in
  `js/geo-track.js` (classification tag) + `js/jobs.js`; new `ojt_hour_logs` +
  `ojt_signoffs` stores.

### 9.8 Concurrency-Safe Cloud Sweep (sync-engine refactor)

`supaSaveToCloud` does a full-account **soft-delete sweep**: it deletes any row in
`_lastKnownIds[tbl]` that isn't in THIS device's current in-memory snapshot. That's
correct for single-device use, but two simultaneous writers on one account delete each
other's rows, and a row learned via realtime (`_applyRealtimeRecord` adds it to
`_lastKnownIds`) can be swept on the next save even though a peer just created it
("realtime resurrection/clobber"). Surfaced by `offline-sync-race-flow.spec.js`
(`test.fixme`).

- **Fix:** only sweep ids this device **explicitly deleted locally** — track a
  `_locallyDeletedIds[tbl]` Set populated at every delete site, and change the sweep to
  `prev ∩ _locallyDeletedIds`, never "known but now absent." Realtime-learned ids are
  then never sweep-eligible.
- **Blast radius:** every place an array shrinks (delete a bid/client/job/expense/…) must
  record the id. Miss one and a real delete won't propagate (row resurrects on other
  devices) — so this is a careful, fully-tested refactor, not a quick patch (§10).
- Files: `js/cloud.js` (`supaSaveToCloud` sweep + `_applyRealtimeRecord`) + every delete
  call site. Re-enable the `offline-sync-race` spec when done.

---

## 10. Patch-Chain Prohibition — No House-of-Cards Fixing

> "Fix A breaks B. Fix B breaks C. Fix C breaks A." — This loop is banned.

Every rule in this section is mandatory. Violating them is how 4-line fixes turn into
14-shard reruns.

---

### 10.1 Root Cause First — No Symptom Patches

Before writing a single character of a fix, write this sentence:

> **Root cause: `<function/variable>` in `<file:line>` does `<wrong thing>` because `<reason>`.**

If you cannot complete that sentence, **stop**. You do not understand the failure.
Read more code. Do not guess. Do not patch the symptom and hope.

A "symptom patch" is any of these:
- Changing what value a test `expect()`s to match wrong behavior
- Adding `try/catch` around a failing assertion
- Adding `if (result.noEl) return;` to skip a test that should pass
- Changing `.toBe(1)` to `.toBe(0)` because the count came back 0

**Fix the code. Never fix the test to hide a bug.**
Exception: when the test assertion was provably wrong from the start (document the proof).

---

### 10.2 Blast Radius Analysis — Before Any Change

Before modifying any file, enumerate:

1. **Callers** — every JS file that calls any function you're changing (`grep -r functionName js/`)
2. **Test coverage** — every spec file (`tests/*.spec.js`) that exercises the code path
3. **Shared infrastructure** — if you touch `tests/helpers.js` or the Supabase shim, list every
   spec file that imports from it. They are ALL affected by every change to that file.

If blast radius spans more than 2 spec files, state it explicitly before writing the fix.

---

### 10.3 Shared Infrastructure Rule (`tests/helpers.js`)

`helpers.js` is imported by every spec file. It is high-voltage infrastructure.

**Before touching helpers.js:**
1. List every exported symbol you're changing
2. Grep each symbol across all spec files
3. For each test that uses that symbol, read its assertions and verify your change
   does not alter what the test receives

**After touching helpers.js:**
- Run the mental CI across every spec file before pushing
- Never assume "it only affects the test I'm fixing"

---

### 10.4 Test Assertion Change Protocol

When an assertion must change (the behavior intentionally changed, not a bug):

1. State the old behavior and why it was correct at the time
2. State the new behavior and why it's now the intended behavior
3. Update the assertion to match the new intended behavior
4. **Grep for every other test that asserts the same behavior** and update them all

Never update one assertion in isolation when the same behavior is asserted in 5 places.

---

### 10.5 The `addInitScript` Ordering Rule

`page.addInitScript()` calls run in the order they are added. Later calls overwrite earlier
ones for the same variable. This is the #1 source of test-setting-overwrite bugs.

**Rule:** If `bootApp`, `bootHub`, `mockAllExternal`, or any boot helper calls
`addInitScript`, any earlier `addInitScript` in the same test for the same variable
**will be overwritten**.

Before using `addInitScript` in a test, check whether the boot helper also sets that
variable. If it does, pass your data through the boot helper's options, not as a
separate `addInitScript`.

---

### 10.6 CSS/JS Section Collapse State

The `_mmtCol_<id>` window variables control whether Make Money Today sections render
their item cards into `innerHTML`. Default is `undefined`, which means **collapsed**
(items are NOT in the HTML). Tests that count occurrences in `innerHTML` must first
set the relevant section to expanded:

```js
window._mmtCol_build = false;    // expanded — items render into HTML
window._mmtCol_pending = false;
window._mmtCol_collect = false;
```

Any test counting items in `#dash-money-feed` innerHTML without first expanding the
section will always get 0. This is a known footgun — not a bug, by design for UX.

---

### 10.7 Pre-Push Checklist — Non-Negotiable

Run this before every `git push`. If any answer is "unsure", stop and read more code.

| # | Question | Required answer |
|---|----------|-----------------|
| 1 | What files did I change? | List them |
| 2 | What functions did I change in each? | List them |
| 3 | Which spec files have tests that call those functions? | Grep and list |
| 4 | For each such test: does my change alter what it asserts? | Yes/No per test |
| 5 | Did I update ALL affected assertions (not just one)? | Yes |
| 6 | Can I state the root cause of every failure I fixed in one sentence? | Yes |
| 7 | Does the fix change behavior beyond the minimum needed? | No |

---

## 11. Exhaustive Test Standard

**"Every major flow" is not enough. Every function gets tested.**

---

### 11.1 Coverage Requirements

For every global function in every `js/*.js` file, the test suite must cover:

| Input class | Examples |
|-------------|---------|
| Null / undefined | `fn(null)`, `fn(undefined)`, `fn()` |
| Empty | `fn([])`, `fn('')`, `fn(0)` |
| Boundary | `fn(-1)`, `fn(0)`, `fn(1)`, `fn(Number.MAX_SAFE_INTEGER)` |
| Type mismatch | `fn('string')` where number expected |
| Missing DOM | function called when its target element is absent |
| Valid / golden path | The normal happy-path input |
| Concurrent calls | Same function called N times without awaiting |
| Post-error state | Function called after a simulated failure |

---

### 11.2 Race Condition Test Pattern

Every guard variable (`_renderDashRunning`, `_saveRunning`, etc.) gets a concurrent-call test:

```js
test('guard prevents concurrent execution', async () => {
  const result = await page.evaluate(() => {
    let callCount = 0;
    const orig = renderDash;
    // Call 10 times synchronously — guard should let exactly 1 through
    for (let i = 0; i < 10; i++) { try { orig(); callCount++; } catch(e) {} }
    return { callCount };
  });
  expect(result.callCount).toBeGreaterThanOrEqual(1); // at least 1 completed
});
```

---

### 11.3 LocalStorage Corruption Tests

Every function that reads localStorage gets a corruption test:

```js
test('handles corrupted localStorage gracefully', async () => {
  await page.evaluate(() => {
    localStorage.setItem('zp3_est_full_draft', '{INVALID JSON{{{{');
  });
  // function must not throw, must not crash the page
  const ok = await page.evaluate(() => {
    try { loadEstFullDraft(); return true; } catch(e) { return false; }
  });
  expect(ok).toBe(true);
});
```

---

## 12. Flow Test Standard & Performance Ratchet

> This is how we take down ServiceTitan: every click in the live app is measured,
> validated, and budgeted in one pass. A flow test is not "did it work" — it is
> "did it work AND how much did it cost the user." Both, every time.

The live flow suite (`tests/flow/*.spec.js`, run via `playwright.flow.config.js`
against the deployed pages.dev preview) drives the REAL app against REAL Supabase.
No seeding hollow rows — every assertion comes from clicking the actual UI.

`tests/flow/estimate-build.spec.js` is the **reference implementation**. New flows
copy its shape.

---

### 12.1 `step()` Is the Heart of Every Flow — Mandatory

Every user-facing action in a flow test goes through `step()` from
`tests/flow/live-helpers.js`. It fuses validation and analytics into one pass so
they are the SAME data:

```js
await step(page, {
  label: 'client info → step 2',   // what the user is doing
  page:  'pg-est',                 // where
  role:  'contractor',             // who (employee flows assert lockout)
  suspect: 'paint-estimate.js validateAndGoStep2',  // file:fn to blame on failure
  ruleText: 'entering client info must advance to the surface builder',
  expected: 'surf-room-name visible',
  act:  async (p) => { /* perform clicks */ return 4; }, // RETURN interaction count
  rule: async (p) => ({ ok: <bool>, got: '<observed>' }), // post-condition
  abuse: async (p) => { /* optional adversarial probe */ },
});
```

- `act` performs the interaction and **returns the number of interactions**
  (clicks + keystrokes + programmatic step calls). This number is the currency of
  the ratchet — count it honestly.
- `rule` returns `{ok, got}`. On `!ok`, `step()` throws a one-line `finding()`
  ticket (`[role][page] control → RULE … expected/got/suspect`) — the exact
  substrate the agentic self-heal loop (§13) reads to fix the bug.
- Every step is pushed to the `_LEDGER` with its ms + interaction count.

**No raw `expect()` on a UI post-condition outside a `step()`.** If you are
asserting that an action produced a result, it is a step. Pre-flight setup
(`signIn`, `resetLedger`) and the final `report()` gate are the only exceptions.

Call `resetLedger()` in `beforeEach` so each test owns a clean ledger.

---

### 12.2 The Performance Ratchet — Clicks Hard-Gate, Time Advises

Every flow ends with:

```js
const rep = report(FLOW, BASELINE);            // BASELINE = require('./perf-baseline.json')
expect(rep.overBudget).toBe(false);            // HARD FAIL on click regression
```

`report()` prints the friction profile (slowest-first ledger, total ms, total
clicks) and grades total interactions against `tests/flow/perf-baseline.json`.

| Metric | Role | Why |
|--------|------|-----|
| **Interaction count** | **Deterministic HARD GATE** | The same flow always takes the same number of clicks. A PR that increases it is a UX regression and **fails CI today** — not a warning. |
| Wall-clock ms | Advisory (logged) | Network/CI jitter makes time non-deterministic. Tracked for trend, never gated. |

**The ratchet rule:** every PR must be **as fast or faster** than the last. A
flow's click count may only ever **ratchet DOWN** (the app gained leverage) or stay
flat. It may go **up only** when a deliberate new step is added — and then you
raise the baseline in the **same commit** with a one-line justification in the
`note`. Silent baseline inflation is a banned patch-chain move (§10).

---

### 12.3 Baselines — `tests/flow/perf-baseline.json`

- A flow **listed** in the baseline is hard-gated on `clicks`.
- A flow **not listed** is in **capture mode** — `report()` logs
  `BASELINE CAPTURE [flow]: N clicks` and does not gate. Copy that number into the
  file to start gating it. Capture first, gate second.
- Because `act()` returns a deterministic count, you can gate a flow the moment it
  is written — no live run required to discover the number.
- Improving the app (fewer clicks to the same outcome) means you **must** lower the
  baseline in the same PR, or the old budget silently permits the regression to
  creep back.

---

### 12.4 Scale Benchmarks — Find Where the App Gives No Leverage

Big-input flows exist to expose where the UX makes the user grind:
20-room full repaint, T&M with no template, BYO/custom line items the estimator
has no idea how to price. Each is its own baseline key
(`estimate-build/interior-20room`, `estimate-build/tm`, `estimate-build/byo`). A
high clicks-per-unit-of-output number is a **UX streamline target**, captured as a
finding, not a failure. The ledger tells us exactly which step costs the most.

---

### 12.5 New Flow Checklist

1. `resetLedger()` + `signIn(page)` in `beforeEach`.
2. Every user action wrapped in `step()` with an honest interaction count, a
   `rule`, and a `suspect` pointing at the code to blame.
3. End with `report(FLOW, BASELINE)` + `expect(rep.overBudget).toBe(false)`.
4. New flow → run once in capture mode, paste the click count into
   `perf-baseline.json` with a `note`, commit both together.
5. Employee/role flows: assert lockout inside `rule` (financials unreachable).
6. Never wipe data — teardown is opt-in (`E2E_TEARDOWN=1`), off by default.

---

### 12.6 Physical Interaction Standard — Real Thumb, Real Scroll, Real Devices

Flow tests drive the app the way a person does: real taps, real key-by-key
typing, and real scrolling — never `page.evaluate(() => someFn())` to shortcut a
gesture. The helpers in `live-helpers.js` perform the physical action AND return
its honest cost so `act()` just sums them:

| Helper | Action | Cost returned |
|--------|--------|---------------|
| `tap(p, sel)` | scroll into view, then click | `1` (+1 if a scroll was needed) |
| `type(p, sel, text)` | scroll in, click, type key-by-key | `text.length` (+1 if scrolled) |
| `pick(p, sel, val)` | choose a `<select>` / date value | `1` (+scroll) |
| `scrollBy(p, dy)` | a deliberate scroll | `1` |

**You can't tap what you can't see** — every helper scrolls the target into view
first, and if the page physically moved, that counts as a real scroll. So the
SAME flow costs MORE on a phone than a laptop, and that delta is the UX signal.

**Three form factors, always** (`playwright.flow.config.js` projects): `mobile`
(390×844, webkit), `tablet` (820×1180, touch), `desktop` (1280×800). Every flow
runs on all three.

**Typing is key-by-key** (`pressSequentially`, never `fill`), so values are
entered exactly as a user would — which also exercises the auto-capitalize-on-
space behavior live.

---

### 12.7 Live Tests NEVER Clean Up Their Own Data — Leave It to Poke At

**Mandatory: a live flow test must not delete, soft-delete, or restore the records
it creates.** No end-of-test `bids = bids.filter(...)` + `supaSaveToCloud()`, no
`_supa.from('td_*').delete()`, no "restore the original value" block. The seed data
the test writes — bids, clients, jobs, expenses, vehicles, contracts, settings
changes, everything — **stays in the dev account on purpose**, so the owner can open
the app afterward and poke holes in exactly what the tests put in. The owner deletes
it manually on their own schedule.

- The ONLY data removal allowed is the explicit opt-in `teardownAll()` gated behind
  `E2E_TEARDOWN=1` (off by default) — never inline per-test cleanup.
- **Resource** cleanup is still fine and expected: closing extra browser
  contexts/pages you opened (`ctx.close()`, `page.close()`) frees the runner and is
  not data — keep it.
- Use uniquely-tagged ids (`Date.now()*1000 + …`, `process.pid`) so the accumulating
  seed data never collides across runs/viewports, since it is never cleaned up.
- Rationale: cleanup hides the very thing the owner wants to inspect, and a failed
  assertion mid-test can leave half-cleaned state that's more confusing than just
  leaving it all. Leave everything; the owner curates the account by hand.

---

## 13. Agentic Self-Heal Loop (Slack → Claude → Regression Test → PR)

The endgame: a bug reported by a real user heals itself, forever.

1. **Report** — a user hits a bug; it lands in Slack (`#20`), or CI/console/prod
   surfaces a `console.error`.
2. **Ticket** — the failure is already in `finding()` shape
   (`[role][page] control → RULE … expected/got/suspect`) because every `step()`
   throws that format. Claude reads the suspect file:line directly.
3. **Fix** — Claude fixes the **root cause** (§10.1 — never the symptom, never the
   test) on the feature branch.
4. **Regression test that runs forever** — the same commit adds a `step()` to the
   relevant flow asserting the bug can never return. This is non-negotiable: a fix
   without a permanent guarding step is incomplete.
5. **Push → CI → human approves merge.** Claude never merges without explicit
   approval (§1.5). The test now runs on every PR, forever.

The `finding()` → `suspect` → root-cause-fix → permanent-`step()` chain is what
makes the loop reliable instead of a guess-and-hope patch machine.

### 13.1 Hot Lane — Live-Error Hotfix PRs (standing merge authorization)

> Two PR lanes, by owner decision (2026-07-03): **hotfix PRs run hot end-to-end
> with no human in the loop; feature PRs still wait for explicit approval.**

**The pipeline (fully automatic):**

1. A live user hits an error (window error, unhandled rejection,
   `console.error`, or a DEAD BUTTON — a control whose FIRST click produces
   zero DOM/navigation/network effect — captured by `js/observability.js` →
   `error_log`).
2. `error-watch.yml` (INSTANT when the `GH_DISPATCH_TOKEN` function secret is
   set — ingest-telemetry fires it the moment the row lands; 15-min cron as
   the always-on fallback) opens a **hotfix PR** on a fresh
   `claude/hotfix-err-<id>` branch off `main`, body = the finding-shaped error
   report, and wakes the active agent session via a comment on the open
   feature PR.
3. The agent fixes the **root cause on the hotfix branch** (§10.1 — never the
   symptom) and adds a **regression test in the same commit**. The test must
   reproduce the error's conditions and assert zero console errors — red
   before the fix, green after — so the error can never return silently.
4. One push, full result set (§1.6). All shards green **first-attempt**.
5. **The agent merges the hotfix PR autonomously.** This is the ONLY exception
   to §1.4's no-merge rule, granted in writing by the owner and scoped
   strictly to PRs whose head branch starts with `claude/hotfix-err-`. The
   merge builds production — the fix ships live immediately (that's the point
   of the lane). Never use `[CF-Pages-Skip]` on a hotfix merge.
6. `hotfix-resolve.yml` marks the fixed `error_log` rows resolved on merge.
   **The self-test:** if the same error ever fires again in production, it
   lands as a new unresolved row and error-watch opens a fresh hotfix round
   within 15 minutes — a fix that didn't hold surfaces itself.

**Hard limits of the lane:**
- Hotfix PRs contain the MINIMAL root-cause fix + its regression test.
  Nothing else — no refactors, no features, no drive-by cleanups.
- Feature work, migrations, and anything touching money flows or auth stay in
  the feature lane with explicit owner approval (§1.4 unchanged there).
- If the root cause is ambiguous, architecturally significant, or spans more
  than a small blast radius (§10.2), the agent STOPS and asks the owner
  instead of merging.

---

## 14. CI / Deploy Architecture & Cloudflare Build Cadence

Two independent systems — don't conflate them:

| System | What it does | Triggered by | Cost |
|--------|--------------|--------------|------|
| **Cloudflare Pages** | Builds + deploys the static app to `pages.dev` | **Every push** (by default) | Cloudflare Pages **build minutes** |
| **GitHub Actions — offline shards** | Mocked Playwright (6 shards, WebKit+Chromium) | Every push | GH Actions minutes |
| **GitHub Actions — Flow Tests** | Live Playwright vs the deployed `pages.dev` preview | On-demand (`run-flow` label / `workflow_dispatch`) + nightly | GH Actions minutes |
| **Supabase preview** | Applies new migrations to the preview branch | Every push | — |

**The flow tests run on GitHub Actions, NOT Cloudflare.** Cloudflare only ever
*deploys the app*. So a test-only / migration-only / docs-only push that triggers
a Cloudflare Pages build is **pure waste** — it rebuilds an app that didn't change.

**Fix — Build watch paths** (Cloudflare dashboard → Pages → Settings → Builds &
deployments → Build watch paths):
- **Include:** `index.html`, `client.html`, `sign.html`, `intake.html`, `js/**`, `sw.js`, `manifest*`, CSS
- **Exclude:** `tests/**`, `supabase/**`, `.github/**`, `*.md`, `playwright*.config.js`

**Per-commit skip:** put `[CF-Pages-Skip]` in the commit message to skip that
build. Use it for test-only / migration-only / docs-only commits.

### 14.1 Deploy Cadence — Default-Skip, Deploy On Request (MANDATORY)

Deployments are deliberate, never reflexive. The owner decides when the app
rebuilds.

- **Every commit Claude pushes carries `[CF-Pages-Skip]` in the message** so
  Cloudflare Pages does NOT rebuild the app. Offline shards + Migration lint +
  Supabase preview still run on each push (they're free / necessary gating).
- **The app preview rebuilds ONLY when the owner explicitly asks** — "deploy",
  "ready", "rebuild", "ship it", or equivalent. Then, and only then, push a
  deliberate build: a commit WITHOUT the skip token (or an empty
  `git commit --allow-empty -m "Deploy preview"` if the code is already pushed).
- This holds even for app-code (`js/**`, `*.html`) changes: land them with the
  skip token, tell the owner "app changed — say the word to deploy," and wait.
- Rationale: the owner keeps thinking of changes after the fact and wants to batch
  them into one intentional deploy instead of burning a Cloudflare build on every
  push. Respect that — never auto-deploy.

### 14.2 The `/api` Proxy Is Load-Bearing — Never Remove It

`functions/api/[[path]].js` is a Cloudflare Pages Function that reverse-proxies
`/api/*` → the Supabase project URL. The app sets `SUPA_URL = location.origin +
'/api'` (cloud.js), so **every** Supabase call — REST, auth, and realtime
WebSocket — routes through it.

- **Why it exists (real, observed, NOT theoretical):** without it, **AT&T Fiber
  could not load the app** — that network fails to reach `*.supabase.co` directly.
  Routing through the app's own Cloudflare domain (which the browser already
  resolved to load the page) fixes it. Do NOT "optimize" this away by calling
  Supabase directly — it re-breaks AT&T Fiber (and likely other carriers).
- **The cost:** every Supabase request is one Cloudflare Workers/Pages Functions
  invocation. The **free** plan caps at **100,000 requests/day per ACCOUNT** (shared
  across preview + production). Production burns this on every real user-action;
  the live flow suite burns it FAST.
- **Therefore Workers Paid ($5/mo → 10M/day) is a hard infra requirement**, not
  optional. It is cheaper and safer than removing the proxy.
- **Do not casually trigger the full live flow suite** — it can exhaust the daily
  account limit in one run and throttle the proxy for preview AND production until
  the UTC-midnight reset (or until Workers Paid is enabled). Run live specs in
  small subsets, and only with the owner's go-ahead.

### 14.3 Direct-Supabase Default + Auto-Fallback (validated 2026-06-28)

§14.2's "never call Supabase directly — it re-breaks AT&T Fiber" was **empirically
retired**: direct mode was tested on AT&T Fiber (the exact network the proxy was built
for) and a full lead→bid→send flow loaded fine and burned ZERO `/api` requests.

- **`SUPA_URL` now DEFAULTS to direct** (`https://<ref>.supabase.co`) in `js/cloud.js`
  — zero Cloudflare `/api` cost on any network that can resolve Supabase.
- **The `/api` proxy is RETAINED as a self-healing fallback:**
  - `supaInit()` probes `/auth/v1/health` (2.5s) before building the client; a DNS/
    network failure silently switches THAT session to the proxy — never an outage.
  - Manual override: `?supadirect=0` forces proxy, `?supadirect=1` forces direct
    (persisted in localStorage `zp3_supa_mode`).
- **Do NOT delete `functions/api/[[path]].js`** — it is the fallback. Removing it
  re-introduces the all-or-nothing risk for any carrier that can't resolve Supabase.
- This makes the 100k/day Pages-Functions limit a non-issue for normal use; Workers
  Paid is now optional, not required.

---

## 15. Layout & Visual Integrity Standard

The app is judged on how it **looks and holds together**, not just whether it works.
A render that bleeds off-screen, overlaps, or silently changes between commits is a
**defect** — the same severity as a broken function.

### 15.1 Hard Layout Rules — Every Screen, Every Device

- **Nothing bleeds off-screen.** No element may overflow the viewport width or cause
  horizontal scroll on any supported device (mobile 390px, tablet 820px, desktop).
  Use `box-sizing:border-box`, `min-width:0` on flex/grid children, `max-width:100%`,
  and wrap/truncate long text — never let content push past the edge.
- **Things stack and center correctly.** On narrow viewports, action areas, cards, and
  summary rails stack in a sane order and stay centered/aligned — no floating, no
  overlap, never two action bars on top of each other.
- **No duplicate or orphaned controls.** One primary Send action per screen, one total
  per screen. A control whose value isn't wired (shows `$0`/blank) must not ship.
- **Fixed/sticky elements never cover content.** A `position:fixed` bar must reserve its
  space (padding on the scroll container) so it can't overlap the buttons beneath it.

### 15.2 No Drastic Visual Change Without Explicit Approval

A screen's rendering **may not drastically change between commits** unless the owner
explicitly approved that visual change in writing this session. Refactors, "cleanups,"
and bug-fixes must preserve the existing look unless changing it **is** the point. If a
change alters layout, say so and get a yes first.

### 15.3 Layout Is Tested, Not Eyeballed

Every screen with a non-trivial layout gets an E2E layout assertion (run at mobile
390px + desktop) proving:
- `documentElement.scrollWidth <= innerWidth + 1` — no horizontal bleed.
- No two interactive controls overlap (bounding-box intersection check).
- Exactly one primary action (e.g. one visible "Send proposal") per screen.
- Key containers stay within the viewport (`getBoundingClientRect().right <= innerWidth`).

A layout regression fails CI like any other bug.

---

## 16. New Feature Workflow — Research → Build → Screenshot → Approve

Building from assumption is banned for anything beyond a bug fix. This is the full,
ordered sequence for any genuinely new feature (a new document type, workflow, or
screen — not a bug fix, not a tweak to something that already exists):

1. **Understand the ask.** Restate what's actually being requested before researching
   or building anything. Resolve scope ambiguity first — don't guess and build.
2. **Research the competition.** Check the relevant names from the competitive set
   (§16.1) for this specific feature — do they have it? If yes: how do they solve it,
   what does their flow look like, what do *their own users* complain about doing it
   their way. If no: that's a gap worth exploiting, say so. Also pull real contractor
   feedback — trade-specific forums/subreddits (r/electricians, r/HVAC, r/Construction,
   etc.), G2/Capterra/App Store reviews of competitor products, contractor Facebook
   groups — not guesses about what "seems useful." Note what contractors love and hate
   about how existing tools (including ours) handle this today — both directions matter.
3. **Design how we beat them.** Synthesize the research into a concrete plan. The
   design must cite what it's based on — which competitor pattern, which piece of
   contractor feedback — not "this seemed like the right approach." If research turns
   up nothing decisive, say so explicitly and default to the simplest version that
   solves the stated problem, rather than skipping research because findings were thin.
4. **Build it with tests in the same commit.** Feature code + E2E tests (happy path,
   edge cases, `assertNoErrors()`) + live flow test coverage where the feature touches
   a real user flow — written together, per §5.1, never after.
5. **Run the tests and confirm they actually pass.** Offline shards clean, and the
   cloud gate (real backend) clean, before moving on — per the Loop (§0).
6. **Screenshot the UI/UX — not a live deploy.** Per §0 Step 0.5: render the actual
   changed screen locally and send it in chat for a reaction.
7. **The owner reviews the live screenshot.** "Yeah, that's good" → proceed to deploy
   per the normal Loop. "No, needs changes/additions" → back to step 4 (or step 3, if
   the direction itself needs to change) — iterate on screenshots, not deploys, until
   approved.

**Scope:** genuinely new features only. Bug fixes, refactors, and small UX polish on
something that already exists don't need this full sequence — just the normal Loop.

### 16.1 The Competitive Set

Compiled via research agent 2026-07-10 — not a guess, a real market scan (G2/Capterra
category pages, "alternatives to X" roundups, contractor forum/review sentiment).

**Primary — check for every feature.** Closest match on target customer (mobile-first,
small-to-mid trade contractor) and full-lifecycle scope:
- **Jobber** — clean workflow, fastest setup, the default "value" pick in every roundup.
- **Housecall Pro** — best mobile field-tech UX of the big players — the exact axis
  TradeDesk's UX thesis competes on.
- **ServiceTitan** — the enterprise ceiling: what "full-featured" looks like at scale.
- **QuoteIQ** — AI-forward, flat/budget pricing, same home-service segment.
- **DripJobs** — painting-leaning, automation-heavy CRM; **no dedicated mobile app** —
  a real gap to exploit.
- **FieldPulse** — closest on multi-trade breadth (HVAC/plumbing/electrical/GC) at the
  small-team tier.

**Trade-specific — check when the feature is trade-specific:**
- Roofing: AccuLynx, JobNimbus
- General contracting / remodeling: Buildertrend, Contractor Foreman, Houzz Pro, Joist
- Landscaping: Aspire (owned by ServiceTitan since 2021), LMN, Yardbook
- Painting: PaintScout (now "Bolster Built"), EstimateRocket

**Adjacent point-solutions — check when the feature overlaps their one job:**
- CompanyCam (jobsite photo docs), Levelset (lien waivers — directly relevant to
  §9.8/lien-protection work), Leap/SalesPro (in-home sales + financing).

**Also worth a scan:** FieldEdge, Workiz, Service Fusion, ServiceM8, Kickserv, Tradify,
simPRO (acquired by ServiceTitan in 2024 — verify current product relationship before
citing as independent), mHelpDesk, Sera Systems.
