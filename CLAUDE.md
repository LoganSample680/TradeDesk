# TradeDesk: Claude Code Instructions

> These rules are mandatory. They are not suggestions. Every rule applies on
> every task unless explicitly overridden in writing by the user in this session.

---

## What TradeDesk Is

TradeDesk is a white-label, mobile-first CRM built for trade contractors, painting,
electrical, plumbing, HVAC, landscaping, general contracting, covering the whole job
lifecycle: lead intake → estimate/proposal (T&M, BYO/custom, fixed-scope) → e-sign →
schedule → dispatch the crew → track time/mileage/materials on-site → invoice → collect
payment (Stripe) → change orders → lien protection → tax/1099 tooling → crew
geo-tracking. One account per contractor business; employees join as crew with
permission-gated access to money/estimates.

The product thesis: **out-execute ServiceTitan, Jobber, and Housecall Pro on UX**,
fewer taps, faster flows, a genuinely pleasant mobile experience, not by matching
their feature checklists line for line. §12's Flow Test Standard measures every click
for exactly this reason: the click count against a hard-gated baseline IS the product.
The full competitive set (QuoteIQ, DripJobs, FieldPulse, trade-specific tools, and
more) is at §16.1: check it before researching any new feature.

Backend: Supabase (Postgres + Auth + Storage + Edge Functions + Realtime). Frontend:
vanilla JS, no framework, deployed as static files on Cloudflare Pages. E2E-tested with
Playwright: offline-mocked shards gate every push; live-Supabase flow tests validate
real behavior on demand.

---

## Communication: plain English, always

Talk to the owner like a person, not a compiler. Every reply:

- **Plain English.** No jargon dumps. If a term is unavoidable, say it in one plain
  sentence too. Assume the owner is smart but not reading the code.
- **Lead with the answer.** First line = what happened / what to do. Details after,
  only if they help.
- **Short.** Cut everything that isn't load-bearing. Long walls of text lose the owner.
- **"What you need to do" is explicit.** If the owner has an action, put it in a short
  numbered list with the exact taps/values. If there's nothing for them to do, say so.
- **Name the thing that broke and the fix in one line each**, not a five-paragraph tour.
- **No status noise.** Don't narrate every CI poll or push. Report when something needs
  the owner or when a real result lands.
- **No em dashes. Ever.** Not in app copy, code comments, commit messages, PRs, or docs. Use a colon, comma, period, or parentheses instead. An em dash reads as machine-written; we write like a person.

This rule is mandatory and applies to every response, not just summaries.

### Answer length: short by default (owner mandate 2026-08-29)

Owner: "don't care to read through all this shit, need clear answers to my
question, short action items."

- **Answer the question first, in one or two sentences.** Then stop. Add detail
  only if it changes what the owner does next.
- **Hard default: 6 lines.** A findings report or a design proposal may go
  longer; nothing else may.
- **Brainstorming = answer + numbered action items.** No essays, no research
  dumps, no competitor tables unless asked.
- **Building = one line per thing changed, one line for what's next.**
- **Never re-state open items** the owner has already been told. Say them once.
- **No tallies, no scorekeeping, no narrating your own process.** He does not
  need to know how many bugs were found or how hard it was.
- **No status noise on webhooks** (§1.2 already says this): silence, not a
  paragraph about why silence.
- Tables only when comparing three or more things. Otherwise prose or a list.

---

## 0. The Loop (plain English: read this first)

How a change ships. Repeat until review is clean:

1. **Build it**, write the feature + its tests on the branch.
2. **Run the tests you just wrote, locally, right now.** One spec file, 5 to 13
   seconds (§5.2.1). Green before you push, always. This step exists because
   its absence is what turned single mistakes into four-minute CI rounds.
3. **Cloud gate**, the same tests, now against the REAL backend (Dev Supabase + Stripe).
   The app still runs on localhost, so still no Cloudflare cost. This seeds real data into
   Dev A/B for you to poke at.
4. **Build the preview**, ONE deliberate deploy. Cloudflare builds the real app. Comes
   AFTER the cloud gate (the cloud gate doesn't need it, don't pay for a build you might toss).
5. **Smoke the preview**, a tiny check that the *deploy itself* is healthy: right version
   (not a stale cache), `/api` works, maps load. Dozens of requests, not thousands.
6. **You review the live preview.** Anything off → back to step 1.

**Step 0.5: for anything with a visible surface, screenshot before you build a preview:**
new element, moved/resized/restyled element, new screen, animation, or any copy change
that shifts layout. Render the actual changed screen locally (headless-browser screenshot
against a local server, no Cloudflare build) and send it in chat for a reaction. Iterate
on the screenshot, not on live deploys. Skip this only when the change has no visual
surface (backend logic, sync fixes, test-only changes), those deploy on request as usual.
Reason: a Cloudflare build plus the app's version-watchdog (polls every 15s, auto-reloads
on any mismatch) means three quick visual fixes in a row is three forced reloads on
whatever device the owner is holding mid-review. A screenshot costs nothing and iterates
as fast as the conversation, save the deploy for the version already approved in principle.

**Two different "clouds", don't mix them up:**
- *Cloud gate* = real **backend** (Supabase, Stripe). App runs on localhost. Cheap.
- *Preview* = the real **front-end**, deployed on Cloudflare. The smoke checks this one.

**Plain rules:**
- Every dev commit carries `[CF-Pages-Skip]` so Cloudflare does NOT rebuild. Only the
  step-4 "ready" commit deploys.
- **Production lags on purpose.** It only updates when you say "deploy/promote," OR when
  you approve a PR merge, a merge to `main` IS the deploy signal (§14.1.1), no separate
  ask needed after. A *preview* is your branch's code; *production* is whatever's on
  `main`, never the same mid-work.
- **Never merge without you saying so**, not even when everything is green. Once you do
  say so, the merge itself ships it to production (§14.1.1): verify the merge commit
  didn't accidentally inherit a stray `[CF-Pages-Skip]` (squash-merge gotcha, §14.1.1).
- **One push, then WAIT** for the tests to report before the next push. Pushing mid-run
  kills the test that's running.

Everything below is the detailed version of the above.

---

## 1. Git Workflow: CI-Gated PR Flow

**Never push directly to `main`.** All changes go through a PR so CI must pass
before `main` is updated.

---

### 1.1 Step-by-Step: Execute Automatically After Every Push

#### Step 1: Push to the Feature Branch

```
git push -u origin claude/review-app-ux-flow-mRafw
```

#### Step 2: Ensure an Open PR Exists

Call `mcp__github__list_pull_requests` (state: open, head: the feature branch).

| Situation | Action |
|-----------|--------|
| No open PR found | Create one immediately via `mcp__github__create_pull_request`. Do not wait for the user to ask. |
| Open PR already exists | The push automatically re-triggers CI on it. Note the PR number. |

#### Step 3: Subscribe to PR Activity

Call `mcp__github__subscribe_pr_activity` immediately after opening or finding the
PR. This delivers CI results, review comments, and failures directly into the
conversation without polling.

#### Step 4: Wait for CI and Handle Results

GitHub Actions runs Playwright across WebKit + Chromium.

**✅ All shards pass:**

Report green to the user and wait for explicit merge approval. Do not merge.

**❌ Any shard fails, fetch the actual Playwright log:**

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
3. Push the fix and wait for CI to confirm a clean first-attempt pass, no
   retries triggered.

#### Step 5: Merge Only With Explicit User Approval

Never call `mcp__github__merge_pull_request` unless the user has said "merge it",
"ship it", "go ahead", or equivalent in this session.

Always ask first: *"All shards green, OK to merge?"*

---

### 1.2 Webhook Noise: Complete Silence on Non-Failure Events

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
  PRs (`claude/hotfix-err-*` branches) merge autonomously when fully green, see
  §13.1 for the exact rules. Everything else: no exceptions.

- **Verify CI by re-polling** `get_check_runs` and confirming every shard shows
  `status: completed, conclusion: success` before reporting green. Do not rely
  solely on webhook events, they can arrive out of order or with duplicate IDs.

---

### 1.5 What "CI Green" Means

| Requirement | Standard |
|-------------|----------|
| Hard failures | 0 across all WebKit and Chromium shards |
| Flaky tests | None, every test must pass on first attempt |
| Console errors | 0 new `console.error` calls introduced by the change |

---

### 1.6 Pushing Over In-Flight Runs Is Allowed (owner decision, 2026-07-26)

CI green is not a hard gate on when the next push can happen. Once a fix is
ready, push it, don't sit waiting on a prior run's offline shards or flow-local
job to finish first.

**Know the tradeoff, it's accepted now, not avoided:** this workflow's
`concurrency: cancel-in-progress` means a new push cancels/orphans whatever
offline-shard or flow-local run was still in progress on the branch. That run's
result never lands, and the runner minutes it already burned are wasted. That
used to be treated as a rule-breaking mistake; it's now just a known cost of
moving faster.

Judgment call, not a rule: if a run is seconds from finishing and its result
would be genuinely useful (e.g., confirming a fix just landed), it can be worth
a quick check first. But this is never a reason to hold a ready push.

---

## 2. Version Bumps

The pre-commit hook (`scripts/bump-version.js`) handles version bumps
automatically. **Do not manually edit version files.** The hook stages them as
part of every `git commit`.

**Version format:** `MM.DD.YY.NN`
- Date in US Central Time (`TZ='America/Chicago'`).
- `NN` resets to `1` at midnight CT and increments with each push on the same day.

**One-time setup after cloning:**
```
bash scripts/install-hooks.sh
```

**Fallback: only if the hook did not fire:**

If `git commit` output does NOT include `[bump-version]`, the hook is missing.
Run manually then re-commit:
```
node scripts/bump-version.js
```

---

## 3. Dev Branch

All development work goes on branch: `claude/review-app-ux-flow-mRafw`

Never commit or push to any other branch without explicit user permission.

### 3.1 The `uat` Branch: Stable UAT Environment (owner-established 2026-08-07)

`uat` is a permanent environment-pointer branch, NOT a review branch. Its only
job is giving Cloudflare Pages a stable alias that never changes with dev
branch names: `https://uat.tradedesk-cyp.pages.dev`. The TestFlight beta shell
points at this URL, so it must stay alive and stably named forever.

- **Rolling to UAT** (only when the owner asks): fast-forward `uat` to the dev
  branch tip, add one empty deploy commit WITHOUT `[CF-Pages-Skip]` so
  Cloudflare builds, push. `git checkout -B uat <dev-branch> && git commit
  --allow-empty -m "UAT deploy" && git push -u origin uat --force-with-lease`.
- **Never open a PR from `uat`**, and never develop on it. All work stays on
  the dev branch; `uat` only ever receives what the dev branch already has.
- Production is untouched by any of this: `main` still only moves via approved
  PR merge (§14.1.1), and the UAT roll is a separate, explicit owner ask.
- One shared Supabase serves dev/UAT/production (owner decision 2026-08-07):
  data written from any environment is live for all of them instantly; only
  CODE is gated by the merge to `main`. Therefore migrations must stay
  additive (never rename/drop what production code still reads), and new code
  must never rewrite existing records into shapes production can't read.

### 3.2 Minimum iOS Builds (owner rule, 2026-08-09)

The TestFlight app is a THIN SHELL: it loads the live UAT site
(capacitor.config.json server.url). Web code is never bundled into the build,
so every JS/HTML/CSS change ships instantly via a UAT roll (§3.1) with ZERO
iOS builds. Firing `ios-beta.yml` costs a ~15-minute macOS run and forces the
owner to update the app on every test device, so builds are rare and
deliberate, never reflexive.

**NEVER fire an iOS build without explicit owner approval in this session
(owner rule 2026-08-10).** Land the native changes, say "native changed,
build N is ready to fire," and WAIT for the owner's go-ahead. This mirrors
the merge rule (§1.4): green code lands freely, the expensive irreversible
step waits for a human yes. No exceptions, not even mid-debugging when the
owner is actively testing the very feature the build carries.

**An iOS build is needed ONLY when the native surface changes:**
- New or changed Swift plugin code (`native/td-geo/`, future plugins)
- `native/capacitor.config.json` or `native/package.json` (plugin versions)
- Info.plist entries, entitlements, app icon, or anything in `ios-beta.yml`
  that patches the generated project

**Everything else is a UAT roll, not a build.** If unsure, ask: does this
change any file under `native/` or the workflow's project patching? No means
no build.

**Keep the native layer dumb so this stays true.** A Swift plugin exposes
raw capability only (arm a region, buffer an event, report a fix); every
decision, threshold, timer, and behavior lives in JS behind
`Capacitor.registerPlugin`. TdGeo is the reference: park timing, fence radii,
and replay logic are all in `js/geo-track.js`, tunable forever without a
rebuild. Putting logic in Swift that could live in JS is a rule violation,
it converts free UAT iterations into paid builds.

**The floor is ~1 build/month:** TestFlight builds expire after 90 days, and
the monthly keep-alive cron (`ios-beta.yml` schedule) already covers that.
Batch pending native changes into the next needed build rather than firing
one per change.

### 3.3 Native Plugin Test Coverage (owner mandate, 2026-08-17)

A native change couldn't be tested without firing an actual signed TestFlight
build and poking at it by hand, and §3.2 makes that build itself rare and
gated on explicit approval, so it could never be the feedback loop for every
native change. Every `td-*` plugin now gets the same "tests ship in the same
commit" treatment §5.1 already mandates for the web app, via a dedicated
XCTest target, `TdNativeTests`.

**Scope, deliberately: plugin-level XCTest, not XCUITest.** No WKWebView
automation, no simulator UI driving. "Keep native dumb" (§3.2) means the
Swift layer is capability-only, arm a region, buffer an event, report a fix,
so stressing each plugin's methods directly IS stressing the native surface
that can actually break. The app's on-screen behavior is already covered by
the Playwright flow-test harness. This is also what keeps it cheap: no full
app launch, no signing, no App Store Connect, seconds not minutes, and it
never counts as "firing a build" under §3.2, it can run on every PR that
touches `native/` without anyone's approval.

**Every new or changed Swift plugin method ships adversarial XCTest coverage
in the SAME commit.** Test source lives permanently at `native/tests/`, one
file per plugin (`TdGeoPluginTests.swift` is the reference implementation,
mirroring how `tests/flow/estimate-build.spec.js` anchors the web flow-test
shape). Coverage follows the same input-class table §11.1 already mandates
for the web app, translated to native:

| Class | Native equivalent |
|---|---|
| null/invalid input | `@objc` methods called with malformed/missing `CAPPluginCall` args |
| concurrent calls | rapid repeated start/stop/register calls, same guard-variable race pattern as §11.2 |
| permission-denied path | simulated denied location/camera/mic/notification authorization, confirm graceful no-op, never a crash |
| post-error / interrupted state | simulated backgrounding or app-suspend mid-operation |
| boundary | zero pending events, buffer overflow, double-start/double-end |
| device-capability gaps | `isSupported`-style checks under simulated "unavailable" conditions |

**CI enforcement, same two-layer pattern as §12.8:**
- `.github/workflows/ios-native-tests.yml` is a hard-blocking check on every
  PR that touches `native/`: it injects the `TdNativeTests` target
  (`scripts/ios-add-native-tests.rb`, the same regenerate-the-project-fresh
  pattern as every other `ios-add-*.rb` script) and runs it against the iOS
  Simulator. This workflow is structurally independent from `ios-beta.yml`,
  no archive, no export, no signing, no `APPSTORE_*` secrets, so it can
  never accidentally fire a real build.
- `native-test-advisory` (in `.github/workflows/test.yml`, alongside
  `flow-test-advisory`) is a non-blocking `::warning::` when a plugin's
  Swift file changes with no matching `native/tests/*Tests.swift` change
  anywhere in the diff. Advisory only, for the same reason §12.8's job is:
  a hard gate here would false-positive on a drive-by plugin tweak and
  teach Claude to route around it.

---

## 4. Branch Protection (One-Time Setup by Repo Owner)

Go to **GitHub → Settings → Branches → Add rule** for `main`:

- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status check name: **E2E Tests / test**
- ✅ Require pull request before merging
- ✅ Do not allow bypassing the above settings

This makes it impossible for broken code to reach `main`, not even via direct push.

---

## 5. E2E Test Philosophy: New Features

The test suite is the quality gate. **Every new feature gets E2E tests.**

---

### 5.1 Tests Ship in the Same Commit as the Feature: Always

New feature code and its E2E tests are written together and committed together.
CI sees both at once, so the new tests cover the new code and the suite passes.

- **New features are never blocked by CI**, their tests arrive with them, not after.
- **CI only fails if something is actually broken**, a real regression, a console
  error, or a test written incorrectly.
- **Tests are proof of correctness, not a fence around the code.**

---

### 5.2 New Feature Checklist

1. Write the feature code on the feature branch.
2. Write E2E tests in the **same commit**: happy path + edge cases + an
   `assertNoErrors()` call to confirm zero console errors.
3. **Run the spec files you touched, locally, and get them green BEFORE you
   push.** See §5.2.1. This is not optional and it is not a judgement call.
4. Push → CI runs the full WebKit + Chromium suite automatically.
5. If CI fails → fetch logs, fix on the feature branch, push again. CI reruns.
6. When CI is green → merge via PR with explicit user approval.

### 5.2.1 Run the file you touched. Never run the whole suite. (owner mandate 2026-08-26)

This section used to say **"Never run tests locally"**, on the grounds that a
local run dumps hundreds of lines into context for no benefit. That was right
about the FULL suite and badly wrong about a single file, and the cost was paid
by the owner, in his own words: "tired of the iteration on iteration of these
tests failing and wasting my time."

**Measured on this repo, 2026-08-26, not estimated:**

| Command | Tests | Wall clock | Context |
|---|---|---|---|
| `npx playwright test tests/e2e-share-inbox.spec.js --project=chromium --reporter=line` | 12 | **5.6s** | ~15 lines |
| `npx playwright test tests/e2e-timelog.spec.js --project=chromium --reporter=line` | 245 | **12.5s** | 4 lines piped through `tail` |
| One CI round trip | 8,889 | **~4 min** | plus a red X the owner has to look at |

On the night this rule changed, EVERY CI failure but one was a test Claude had
written wrong: a stale assertion left behind when a field moved, a test that
seeded no data so its own comparison was meaningless, a scan written too
broadly, a stub missing a method the real code calls. Every one of them would
have surfaced in under thirteen seconds. Instead each cost a four-minute round
trip and a failure the owner had to watch land.

**The rule, now:**

- **Before every push**, run each `tests/*.spec.js` you added to or changed:
  `npx playwright test <file> --project=chromium --reporter=line 2>&1 | tail -20`
  Push only when it says passed. `--project=chromium` alone is enough for a
  pre-push check; CI still runs WebKit, and cross-browser differences are the
  part CI genuinely earns.
- **Run the specs that TEST what you changed, not just the ones you edited.**
  This is the gap that cost a CI round the same night the rule was written: the
  crew banner changed from hiding by ROLE to hiding by STATE, the spec that was
  edited passed, and `e2e-geo-send-coverage.spec.js` failed in CI still
  asserting the old rule. It was never opened, so it was never run, and it would
  have taken twelve seconds. Grep first:
  `grep -ln "<functionYouChanged>" tests/*.spec.js` and run every file it names.
  A behaviour change with no matching test update is not a passing change, it is
  a test that has not been told yet (§10.4 step 4).
- **Never run the full suite locally.** No bare `npx playwright test`. That is
  the case the original rule was written for and it is still correct: thousands
  of tests, six shards' worth of output, minutes of wall clock, and CI already
  does it for free on every push.
- **Never run `tests/flow/*` locally on a whim** (§12.8, §14.2): those hit the
  real backend and can exhaust the daily proxy quota in one run.
- `--reporter=line` and `| tail` are load-bearing. The default reporter is what
  made "hundreds of lines" true in the first place.

**Why this matters more than it sounds.** CI stops being where bugs are
discovered and becomes where they are confirmed. A red shard then means
something real broke, not that Claude fumbled an assertion, which is the only
way a green board keeps meaning anything.


---

### 5.2.2 The clock is pinned. It is not an input to the suite. (2026-08-26)

Owner: *"define how local tests can pass but ci fails, shouldn't be that way at
all."* He was right, and the bill came due the same night: three separate tests
failed in CI and passed locally, and the cause in every case was the wall clock.
CI ran them at 00:05, 00:08 and 00:25 Central; their fixtures were written as
"3 hours ago" and "50 minutes ago"; the scenario silently moved to the previous
day. Nothing was wrong with the code, the browser, or the shard. **The hour
decided the result.** 26 spec files build timestamps that way.

**`mockAllExternal` pins the page's idea of "now" to 10:00 Central.** Local and
CI now agree by construction instead of by luck.

- It is a fixed OFFSET, not a frozen or faked clock. Time still flows at 1x,
  every `setTimeout`, debounce and poll behaves exactly as in production, and an
  explicit `new Date('2026-08-21T...')` still means precisely that instant.
- It moves the time of DAY only, never the Central date, so every "is this
  today" comparison in the app is untouched.
- `TD_CLOCK_AT=HH:MM` re-pins it; `TD_CLOCK_AT=off` disables it for reproducing
  a time-of-day bug by hand.
- `mockAllExternal(page, {clock:'off'})` opts one spec out. Use it ONLY when the
  spec drives `page.clock` itself (`e2e-mileage-days.spec.js` is the sole case:
  two owners of `window.Date` means fastForward moves one clock while the
  assertions read the other). A spec that names its own start hour was never
  exposed to this class anyway.
- `tests/e2e-clock-pin.spec.js` guards the pin. It is shared infrastructure
  (§10.3): every spec boots through it, so a defect there is a silent defect
  everywhere.

**The `midnight clock` CI job is the other half.** It re-runs the date-sensitive
specs pinned to `TD_CLOCK_AT=00:20`, so a fixture that cannot survive midnight
fails on the PR that introduces it, in daylight, instead of on a red board at
1am three weeks later. It **derives** its file list by grepping for
`Date.now() - N`, so a new spec written the same way is covered the day it lands
and nobody has to remember the workflow file exists. Chromium only: this class
is arithmetic on dates and is identical in both engines.

**The rule for new tests:** never let the wall clock decide an outcome. Name the
instant (`'2026-08-21T17:00:00.000Z'`) rather than deriving it from `Date.now()`
wherever the test's meaning depends on which day it is. If a relative offset is
genuinely the clearer way to write it, the pin covers you, and the midnight job
proves it.

**Never compare a page timestamp against `Date.now()` on the NODE side.** The
page is pinned; the Playwright runner is not. Those are two different clocks and
an assertion that straddles them is meaningless, by however many hours the pin is
offset that minute. Return the page's own `now` out of the same `page.evaluate`
that produced the value and compare against that:

```js
const r = await page.evaluate(() => ({ now: Date.now(), arrivedAt: _geoArrivedAt }));
expect(Date.parse(r.arrivedAt)).toBeLessThanOrEqual(r.now - 4.5 * 60000);   // one clock
```

This bit immediately (`e2e-geo-park-reconcile`, shard 6, 2026-08-26) and it bit
because the pin was validated at `TD_CLOCK_AT=00:20`, where the offset happened
to be minutes, and never at the default, where it is hours. **Validate a clock
change at a LARGE offset**, or you have only proven it against a rounding error.

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
earlier shard runs, meaning CI results never appear in the PR.

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

- **Delete** the old code, functions, HTML elements, CSS, event handlers.
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

### 7.2 No Data Loss: Verify Before Removing UI

Before removing any UI that wrote to storage (`S.*`, localStorage, Supabase):

1. Confirm the underlying data key (`S.vehicles`, `maintenance`, etc.) is still
   read and written by the replacement code.
2. Confirm no migration is needed, existing user data loads correctly without
   the old UI present.
3. Call out in the PR description which data stores are affected and confirm no
   records are dropped.

---

### 7.3 Reuse the Existing Pattern, Never Hand-Roll a Parallel One

**Before building any new UI surface, sync store, or piece of logic, find the
closest thing already built and match it exactly, don't invent a new one that
happens to do something similar.**

This app already has proven, load-bearing conventions for the recurring
problems: `.zmodal-overlay`/`.zmodal` for a centered prompt, `_TD_TABLES`
(js/cloud.js) for anything that has to persist and sync like every other
account record, the setup-checklist chooser pattern for "pick one of two
paths, then go straight to the right form." A new feature almost never needs
a new pattern, it needs the existing one pointed at new data.

**Concrete incident this rule exists to prevent (2026-08-06):** a "what do
you want to schedule" chooser was built as a hand-rolled bottom sheet
(`position:fixed;align-items:flex-end`) instead of the app's actual centered-
modal convention (`.zmodal-overlay`, `align-items:center`, the same pair
`openPlaceModal` uses). It shipped, the owner asked for it centered, the
first fix only centered the TEXT inside the hand-rolled box, because the box
itself was never touched, so it still read as pinned to the bottom. The real
fix was to delete the hand-rolled shell and rebuild on `.zmodal-overlay`. Two
review passes to arrive at what copying the existing pattern would have given
for free on the first try.

**Before writing new modal/prompt/persistence code, answer:**

1. What existing surface does the SAME job (a prompt, a fork-in-two-paths
   chooser, a synced data store, a form)? Name it.
2. Does this new thing genuinely differ from it, or is it the same shape with
   different content? If the same shape, use the existing pattern's actual
   markup/classes/table registration, don't approximate it by hand from
   memory of what it roughly looks like.
3. If it does genuinely differ, say why in a comment, so the NEXT change
   knows the divergence was deliberate and not a shortcut.

This applies as much to data persistence as to UI: a new record type that
needs to survive sign-out/sign-in and sync across devices belongs in
`_TD_TABLES` (js/cloud.js) exactly like `td_bids`, `td_vehicles`, and
`td_places` already do, one array entry (`{t, get, set, tx}`), not a
one-off save path that happens to work today and quietly misses the sweep,
the cache-restore blocks, or the account-switch reset that the shared array
gets for free.

---

## 8. CSS Transitions Standard

**Every page navigation and panel reveal must use a CSS transition.**
Hard-cut `display:none → display:block` with no animation is not acceptable.

---

### 8.1 Page Transitions: `.pg.active`

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

This covers every call to `goPg()` automatically: no per-page work needed.

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
| `#pg-dash` | `.5s` `td-dash-enter` (scale) | Boot overlay reveal, must feel polished |

**Rule:** Only add a per-page override when there is a concrete reason
(elevated visual importance). Do not slow down pages arbitrarily. A slow fade
is NEVER the answer to async data (owner mandate 2026-08-09): pg-cal's old 5s
fade existed only to hide the grid awaiting the weather fetch; the fix was to
paint instantly with shimmer skeletons in the async slots and repaint once
when data lands. Waiting content gets a skeleton, never a slowed page.

---

### 8.4 Rules for New UI Elements

| Element type | Required transition |
|--------------|---------------------|
| New full-page view (`.pg`) | Inherited automatically via `.pg.active` |
| Modal / bottom sheet | Fade + slide-up: `opacity 0→1, translateY 16px→0`, duration `.22s` |
| Inline panel / card expansion | `max-height` or `opacity` transition, duration `.18s` |
| Toast / snackbar | Already handled by existing toast util |
| Skeleton loaders | The `.td-skel` shimmer (index.html) + `_tdSkelRows()` (utils.js): a light band sweeping left to right. MANDATORY for every async-loading surface (owner 2026-08-09), never a "Loading..." string, never a spinner, and exactly ONE swap to real content, no stacked reveals |

**Easing standard:** `cubic-bezier(.22, 1, .36, 1)` for entrances (spring-like,
snappy). `ease` for exits and fades. Never use `linear` for UI motion.

**Duration standard:** 150–220ms for entrances. 120–180ms for exits. Nothing
over 350ms except the boot overlay (.65s) and pages with documented async-load
reasons (see per-page overrides table above).

---

### 8.5 What Not to Do

- Do not use `setTimeout` + style changes to fake transitions. Use CSS.
- Do not add `transition: all`, always specify the exact property.
- Do not animate `display`, `visibility`, or `height` from `auto`, use
  `opacity`, `transform`, or `max-height` with a known value.

---

## 9. Feature Backlog

Features discussed and deferred, do not build unless user explicitly asks.
Survives conversation compacting so context is not lost between sessions.

### 9.1 Platform Expansion (Future)

**TradeDesk Comms (CRM Texting)**
- SMS layer via Telnyx or Bandwidth (wholesale rates, bundled into subscription)
- Automation triggers: proposal sent → auto-text, job day-before reminder, invoice overdue, change order approval request, deposit confirmed
- Number provisioning per contractor account
- **iMessage relay: RULED OUT 2026-08-26.** See §9.4.

**TradeDesk Payroll**
- W-2 employee payroll via Check (checkhq.com) for compliance/tax filing layer
- 1099 subcontractor payments via Stripe Payouts (ACH direct deposit)
- Payroll UI: employee management, hours entry, pay runs, pay stubs
- Replaces QuickBooks Payroll, contractor pays one TradeDesk bill
- Must handle: federal withholding, SS/Medicare, FUTA/SUTA, quarterly 941s, annual W-2s

### 9.2 Proposal & Job Document Chain

**Change Order Document**
- New document type linked to existing bid
- Native change order button in bid detail panel (biggest gap vs. ServiceTitan/Jobber/HCP)
- Client approval via new `change-order.html` signing portal (mirrors sign.html pattern)
- Numbered, dated, shows delta from original contract value
- Files: `js/change-orders.js` (new) + `change-order.html` (new) + `js/bids.js` + `js/data.js`

**Completion Invoice**
- Final document after work done, shows estimate vs. actual side by side
- Client signs off on final amount
- Files: `js/completion-invoice.js` (new) + `completion-invoice.html` (new) + `js/jobs.js`

**Range Estimate**
- Low/high price fields + "depends on" explanatory text on any proposal type
- No new files, touches `js/proposals.js`, `js/generic-estimate.js`, `sign.html`
- Client sees: "Estimated range: $X–$Y | Final price depends on: {notes}"

**NTE (Not-to-Exceed) Cap**
- T&M jobs only, contractor sets spending ceiling
- Alert at 90% of cap, hard stop + re-approval flow at 100%
- Partial code already exists: `_tmCalcNte()` in `js/generic-estimate.js`

### 9.3 AI Feature Layer

**Line Item Classification (Claude API)**
- Classifies each proposal line item: labor / materials / taxable service / equipment rental
- Debounced call on description entry, result cached by description hash
- Feeds sales tax calculation automatically
- Files: `js/ai-classify.js` (new) + Supabase Edge Function `classify-line-item`

### 9.4 TradeDesk Comms (SMS Infrastructure)

**Own the messaging layer, no Twilio, no SendBlue subscription**
- Build on Bandwidth API (Tier 1 carrier, not a reseller, ~$0.003-0.004/msg wholesale)
- TradeDesk provisions and manages contractor phone numbers via Bandwidth API
- Contractors see "TradeDesk Messaging," Bandwidth is invisible infrastructure
- Automation triggers: proposal sent, 24h unopened follow-up, signed confirmation,
  job day-before reminder, change order approval request, invoice overdue
- Files: `js/messaging/engine.js`, `templates.js`, `numbers.js`, `webhooks.js`
  + Supabase Edge Functions: `send-sms/`, `sms-webhook/`

**iMessage: RULED OUT (researched 2026-08-26). Do not build it. Do not
re-propose it without new evidence.** This section used to say "iMessage
delivery: Mac Mini on TradeDesk infra handles Apple protocol." That plan is
withdrawn for three reasons, in order of severity:

1. **It fails silently, which is disqualifying for this product.** There is no
   licensed way to send iMessage from third-party infrastructure; every service
   doing it is tolerated, not authorized. When Apple cuts it off, messages do
   not bounce, they vanish, and because the numbers stay registered to iMessage
   the client's iPhone keeps routing there even after the relay is dead. A
   payment request, a change order approval and a job reminder all stop arriving
   and nobody finds out until a customer says "you never told me." A CRM whose
   promise is that the job chain does not drop cannot ship a channel that fails
   invisibly.
2. **Apple bans the hardware, not just the account.** Beeper's own registration
   tool got users' real Macs blocked from iMessage; Beeper Mini was killed in
   days; Sunbird lasted under a day. One Apple ID plus one registered number per
   contractor is also exactly the fingerprint Apple flags as a spam farm.
3. **iMessage has no STOP handling and no consent record.** TCPA damages run
   $500 to $1,500 per message and the FCC requires honoring opt-outs by any
   reasonable method. Sending contractor follow-ups over it puts that exposure
   on TradeDesk with no compliance layer to point at.

**Apple Messages for Business: also ruled out (owner asked directly
2026-08-26, "would Apple messages be a good fit for this app in general").
No, and the eligibility problem is the SECOND reason, not the first.**

1. **It cannot start a conversation, which is the entire feature.** AMB is
   customer-initiated by design: the customer opens the thread. Every
   automation the owner actually wants is unattended OUTBOUND (on the way,
   payment reminder, escalation, post-job check-in). Apple's outbound
   additions are gated to approved use cases and to customers who already
   opted in through an existing thread. So even a contractor who somehow got
   approved still could not send the messages they came for.
2. **It is not obtainable at this size.** Approved MSPs are Salesforce,
   Zendesk, LivePerson, Quiq, Infobip. It needs a business register account
   with an administrator, technical contact and sponsoring executive, plus an
   Apple capability review of the platform and go-to-market plan. It is an
   enterprise support-desk channel, not a two-truck plumbing shop.

The channel is SMS, on 10DLC, with RCS verified sender layered on later for
the branding. That is the whole answer.

**What replaces it, and why the premise was wrong anyway:**

- **The app already sends blue bubbles.** Every client message goes out through
  an `sms:` deep link from the contractor's own phone (~32 call sites across
  proposals.js, bids.js, clients.js, jobs.js, cloud.js, dashboard.js). On iOS,
  Messages picks the transport, so iPhone to iPhone that link is ALREADY a blue
  iMessage from their real number with their name on it. Bubble colour was never
  the gap. **Keep this path; do not "upgrade" it into a platform send.**
- **The actual gap is that nothing comes back.** The reply never reaches
  TradeDesk, nothing is logged against the job beyond `autoLogContact`'s
  `last_contact_date` stamp, and a deep link can never send unattended at 8pm the
  night before a job. Build inbound capture and logging BEFORE outbound
  automation: it closes the real gap and needs no campaign approval to ship.
- **RCS is the answer to "green looks like spam," and it is free.** Live on all
  three US carriers and on iPhone since 18.1. Build on a carrier supporting RBM,
  turn on verified sender once iPhone coverage settles, and the brand name and
  logo land on both platforms with no new architecture.

**10DLC is the real work here, and it is bigger than the code.** Registration
takes 1 to 4 weeks end to end, so **a contractor cannot text on day one of
signup**: this collides directly with §9.9's onboarding restructure and needs a
designed "your texting is being approved" state. Sole proprietors (no EIN) are
throttled hard (1 number, 1 msg/sec, 1,000/day to T-Mobile), so onboarding needs
an EIN branch. TradeDesk registers as ISV on behalf of each customer using THEIR
details, which means EIN capture, opt-in language on `intake.html` and
`sign.html`, STOP/HELP handling, per-contractor consent records, and a
quarantine path when a campaign is rejected.

**Open decision for the owner, and it is the real one:** contractor's own number
or a TradeDesk-provisioned number. Own number keeps the blue bubbles and the
trust but makes logging and automation nearly impossible. Provisioned number
gives logging and automation but goes green. You cannot have both, and every
other question here follows from that answer.

**Competitive note:** no competitor in §16.1 does iMessage, all do 10DLC SMS,
and they all charge extra for texting (DripJobs +$25/mo, Workiz ~+$100/mo with a
message cap). Bundling unlimited texting into the base price is a sharper wedge
than bubble colour.

### 9.4.1 The automations the owner actually wants (stated 2026-08-26)

Opt-in per client, surfaced on the client hub. Three triggers, and they do NOT
share a consent standard, which is the thing most likely to go wrong here:

| Trigger | What it is | Consent standard |
|---|---|---|
| On the way | Transactional, tied to an appointment they booked | Implied by booking. Lowest risk. |
| Payment reminder, then escalation | Transactional, first-party debt | Implied. Watch frequency and escalation wording; FDCPA is third-party but state rules reach first-party. |
| Post-job check-in ("is that leak still dry?") | Service follow-up | **The one that drifts.** A genuine check-in is transactional. The moment it suggests booking again it is MARKETING and needs express written consent. Keep them separate features, not one template with a nicer ending. |

**What exists today:** `sendOMWText` (js/jobs.js:1891) and the mileage-side
equivalent are MANUAL: they open the Messages app with a prefilled body and the
contractor taps send. That is why they need no consent model and no carrier
registration. Automation is a different product, not a flag on this one: the
moment the app sends unattended, TradeDesk becomes the sender and inherits
10DLC registration, opt-out handling and consent records. There is currently NO
opt-in model anywhere in the schema (no `sms_opt_in`, no comms prefs).

**The post-job check-in is the differentiating one.** Competitors send review
requests; almost nobody asks "is the repair still holding" at day 7. For
plumbing and roofing that is both a real quality signal and the most natural
route to a review, and it is worth designing as its own trigger with its own
per-trade timing rather than folding into a generic follow-up.

**Do not build any of this before §16 research runs on the automation itself.**
The channel question is answered above; the open questions are per-trade timing,
escalation ladders, and where the opt-in lives so a client can turn it off in
one tap without emailing anybody.

### 9.5 Employee Geo-Tracking & Job Time-on-Site

**Real-time location tracking with consent controls and business-hours gating**

- **Business hours window**: `S.trackingHours = {start:'07:00', end:'18:00'}` per contractor.
  Device only sends GPS pings when current time is within the window, no background
  drain or off-hours tracking on personal phones.
- **Geo-fence auto clock-in/out**: When a GPS ping lands within ~300ft of a job address,
  log `arrivedAt`. When device moves away, log `departedAt`. Auto-calculates time-on-site
  per job per employee. Displayed on the job sheet and dispatch board.
- **Two-layer consent for personal phones**: (1) Contractor grants the employee a
  "Share location" permission in the Add/Edit member modal. (2) Employee must explicitly
  tap-accept location sharing in their daily view. Both layers required, no covert tracking.
  If employee declines, tracking silently disabled for that device.
- **Manager-only visibility**: Device map and location history only visible when
  `_employeeRecord?.permissions?.team` is true. Field workers cannot see each other's
  locations.
- **Mileage integration**: GPS track auto-generates mileage log entries for the employee's
  drive legs between job sites, feeds into the existing mileage tracker.
- **Implementation notes**:
  - Supabase Realtime channel per contractor_user_id for live ping delivery
  - Edge Function `track-location` receives pings, validates business hours server-side
  - `S.geoFenceRadius` (default 300ft) configurable per contractor
  - Files: `js/geo-track.js` (new), `js/cloud.js` (employee daily view hook),
    `js/jobs.js` (time-on-site display), Supabase Edge Function `track-location/`
  - New `location_pings` table: `{id, contractor_user_id, employee_user_id, lat, lon, job_id, arrived_at, departed_at, ts}`

### 9.6 Employee Offer Letters & Employment Agreements (HR doc chain)

**Run hiring paperwork out of TradeDesk, reuses the e-sign portal pattern.**
- New document type: employee offer letter / employment agreement, generated from
  data already in `team_members` (name, role, pay_type, pay_rate).
- Client signing portal pattern (`sign.html`) is directly reusable → new
  `employ-offer.html` signing page; numbered, dated, e-signed, stored like proposals.
- Covers: pay & schedule, at-will statement, conditions of employment,
  confidentiality, and **location-tracking consent**, this is the legal cover for
  the now-mandatory crew geo-tracking (employee agrees in writing at hire).
- Ties into the invite flow: send offer → employee signs → `?emp_invite=` activates
  their account, so signing the agreement IS the onboarding step.
- **Legal caution:** employment law is state-specific (at-will language, non-compete
  enforceability, wage-notice requirements e.g. NY/CA). Ship vetted templates with a
  prominent "not legal advice, have an attorney review" disclaimer, mirroring the
  tax tool's disclaimer. Do not auto-generate binding terms without it.
- Files: `js/employ-offer.js` (new) + `employ-offer.html` (new) + `js/cloud.js`
  (team_members hook) + a `employment_agreements` store.

### 9.7 Apprentice / Journeyman OJT Hour Logging (geo-fence → master sign-off → state export)

**Turn the geo-fence clock-in into licensable on-the-job training hours.** Most trades
(electrical, plumbing, HVAC) require documented OJT hours for apprentice→journeyman→master
licensure exams, often thousands of hours, frequently broken into work-category buckets.

- **Capture**: the existing geo-fence/time-on-site engine (§9.5, `job_time_entries`) already
  logs verified on-site minutes per employee per job. Tag each entry with a **work
  classification** (e.g. for electrical: service/conduit/troubleshooting) so hours roll up by
  the categories a state board wants.
- **Sign-off chain**: reuse the e-sign portal pattern (`sign.html`): accumulated hours get
  sent to the supervising **master/licensed supervisor** to e-sign off on (their license # on
  record), mirroring the proposal-signing audit trail (`signed_proposals`).
- **Export**: per-employee, date-ranged **OJT hours report**, exportable for the state
  apprenticeship board (PDF/CSV). Shows verified hours by category + supervisor attestation.
- **Open question (research first)**: per-state + per-trade requirements vary widely, total
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

- **Fix:** only sweep ids this device **explicitly deleted locally**, track a
  `_locallyDeletedIds[tbl]` Set populated at every delete site, and change the sweep to
  `prev ∩ _locallyDeletedIds`, never "known but now absent." Realtime-learned ids are
  then never sweep-eligible.
- **Blast radius:** every place an array shrinks (delete a bid/client/job/expense/…) must
  record the id. Miss one and a real delete won't propagate (row resurrects on other
  devices): so this is a careful, fully-tested refactor, not a quick patch (§10).
- Files: `js/cloud.js` (`supaSaveToCloud` sweep + `_applyRealtimeRecord`) + every delete
  call site. Re-enable the `offline-sync-race` spec when done.

### 9.9 Onboarding Restructure: Faster, Cleaner, Day-One-Ready (owner-approved backlog 2026-07-14)

The signup wizard grew to 11 steps; only ~4 carry day-one value (account, trade,
get-paid, booked-jobs). Collapse it to ~5 required screens and push everything
non-essential to a **dashboard setup checklist** the contractor finishes at their own
pace: matching the Jobber/Housecall "short signup, setup-as-you-go" pattern, but
KEEPING the two things that make them operational (payments + booked work) inside the
wizard, which is our edge.

- **Cut / demote screens:** Role (a solo signup is always Owner, infer it, ask only
  when they add a team), Review/confirm (create straight from the last step), Brand/logo
  (fold into Business info), and make **Vehicles optional** (today we force ≥1, mileage
  can wait). Defer license # + warranty period out of Business-info into "finish setup."
- **Target flow (11 → ~5):** Welcome → Account+core business (name/email/password/
  business/phone/state) → Trade → Get paid (toggles + Stripe) → Booked jobs → dashboard.
- **The big structural lever:** create the Supabase account **right after email/password**
  (not at the final step). Then the rest becomes a **resumable setup checklist**, a
  drop-off leaves a real account you can email back ("finish setting up"), and Stripe/jobs
  attach live instead of waiting for obSubmit. This also removes the "Stripe can't attach
  until the account exists" constraint that forced the current auto-launch-after-signup
  design (§ payment-opt-in work).
- **Blast radius / caution (§10):** moving account creation earlier reworks `obSubmit`
  (RLS timing, partial-account state, resume-from-checklist), and every current step's
  data must persist incrementally rather than in one final write. Careful, fully-tested
  refactor: architect with owner (§16), build with a **live signup flow test** (§12.8,
  currently missing, see below) proving zero console errors + data lands in the cloud.
- **Two lanes:** (1) quick wins, cut Role+Review, optional Vehicles, fold Brand, defer
  license/warranty (~7 screens, no architectural change); (2) full restructure, the
  above + early account creation + dashboard checklist. Owner chose the **full restructure**.
- Files: `js/settings.js` (`_ob`, `renderObStep`, `obStep*`, `obSubmit`), `index.html`
  (dashboard setup-checklist card), new live flow test `tests/flow/onboarding-signup-flow.spec.js`.

### 9.10 Dual-Hat Accounts: Crew by Day, Owner on the Side (slice 1 SHIPPED 2026-08-18)

**One login, two hats: a person who is crew on an employer's account AND owner of
their own side business.** Un-parked by the owner 2026-08-18 (first real beta user
is exactly this: plumber on his dad's crew by day, landscaping owner by night).

**Slice 1 (switcher + data wall) is built:** `loadAccountData` surfaces an owner
login's active crew links (`window._hatCrewLinks` / `_hatOwnsBusiness`) and honors
a persisted `zp3_hat_<uid>` choice; a crew hat is steered through the standard
crew-linking path (never a parallel one, §7.3). `window.switchHat` persists the
choice, clears `zp3_cloud_cache`/`zp3_delta_meta` (the hard wall), and hard-reloads;
the clean boot IS the reset machinery. Snapshots carry `_dataOwner` (the business
whose rows they hold) alongside `_owner` (the login): both hats share `_owner`, so
every data guard compares `_dataOwner`, which also fixed crew sessions' own offline
cache being wrongly rejected. UI: "Switch business" in the Settings header (owner
hat) and in the employee sign-out menu (crew hat). Tests: `tests/e2e-dual-hat.spec.js`.

**Still open (slices 2-3):**

- **Switcher**: profile menu flips between "Crew · {employer}" and "My business,"
  riding the existing account-switch reset machinery (arrays, caches, offline queues).
- **Hard wall**: employer never sees the side business; crew permissions gate the
  other direction. RLS already scopes per account, the switcher only picks context.
- **Tracking follows the hat**: crew mode logs drives/site time to the employer
  exactly as now; own-business mode logs to their own mileage/jobs and the employer
  sees nothing. Keeps payroll data clean and each business's IRS log separate.
- **Separate wallets**: own Stripe, invoices, taxes, subscription per business.
- **Growth loop**: "start your own business" one tap from the crew view, every
  moonlighting apprentice is a future subscriber; no competitor supports dual roles.
- **Blast radius (§10)**: cloud.js load/reset paths, geo attribution, offline
  queues, memberships lookup (team_members by user across accounts). Careful
  refactor, architect with owner (§16) in slices: (1) switcher + data wall,
  (2) tracking-follows-the-hat, (3) sign-up growth loop.

### 9.11 What Counts Toward Totals (owner rule, 2026-08-30)

**This is a RULE, not a backlog item.** It governs every paid-minute number on
the time log: the day rail, the week bars, the split bar, the weekly running
total and the OT calc. The second half of it is not enforced yet; that part is
the backlog piece.

Owner, verbatim: *"for totals, shop time always counts, home office time only
counts when the app is open."*

| Kind | Rule | Status |
|---|---|---|
| **Shop / yard** (`source:'shop'`) | Always counts. No extra condition on top of the workday itself. | Enforced today |
| **Home office** (`rawSource:'place-office'`) | Counts **only for the stretches the app was actually open.** Presence at a desk is not, by itself, work. | **NOT enforced.** Office dwell currently lands in the Supply/other bucket and counts in full |

**Why the office half cannot be built yet:** nothing records when the app was
open. `document.visibilityState` drives sync and the version watchdog
(js/cloud.js) but is never persisted, and `S.devices[].lastSeen` is a single
stamp, not a log of intervals. Enforcing this needs a **foreground-interval
log** written on every `visibilitychange` and intersected with the office dwell
at read time, the same read-time-derivation shape `_geoShopWrapMs` already uses
(§ shop auto clock-out, js/geo-track.js), so history re-grades itself instead
of needing a sweep to rewrite rows. Design with the owner (§16) before building.

**The one place this rule can collide with an older one, flagged rather than
silently resolved:** the shop auto clock-out (owner rule 2026-08-24,
`_geoShopWrapMs` in js/geo-track.js) already trims yard dwell to the day's last
verified work event plus `S.shopWrapMin`, because the phone sits at the yard
after hours (one session ran to 11:48pm and would have added 19h38m to a single
week). "Shop time always counts" is read as **"shop time needs no condition
beyond the workday,"** NOT as "pay yard dwell past the last run," which the
owner rejected by name with those numbers. If he ever means the wider reading,
the 2026-08-24 rule is what has to change, and he has to say so.

### 9.11 Same-Truck Detection: Who Rode With Whom (parked 2026-09-02, owner: "wait on it")

Owner asked whether iOS can tell that two people are in the same vehicle. It
cannot directly (no such API). The workable answer is correlation of what the
deriver already has: two people's CoreMotion tapes flip to automotive within
seconds of each other and their GPS breadcrumbs sit on top of each other for
the whole drive. Two phones cannot do that unless they share the truck.

- **Rule for the deriver (js/geo-derive.js):** two journeys on the same
  contractor account whose automotive spans overlap by most of their length
  AND whose fixes stay within a fence radius of each other for the span are
  ONE shared journey: one driver (the truck's assigned driver, else the
  owner, else whoever the truck record names) and N riders. Riders get a
  `drive-rider` time row and no mileage leg (the vehicle rows already shape
  this: `_geoDeriveVehicleRows`). No native change, no iOS build.
- **Not the answer:** vehicle Bluetooth (proves the paired driver only),
  Nearby Interaction / UWB (foreground only, both apps open), phone-to-phone
  Bluetooth proximity (lunch table looks like a truck cab).
- **Parked on purpose:** the owner has larger plans for mileage and time log
  intelligence and wants this designed inside that, not as a one-off rule.
  Do not build until he brings it back.

---

## 10. Patch-Chain Prohibition: No House-of-Cards Fixing

> "Fix A breaks B. Fix B breaks C. Fix C breaks A.", This loop is banned.

Every rule in this section is mandatory. Violating them is how 4-line fixes turn into
14-shard reruns.

---

### 10.1 Root Cause First: No Symptom Patches

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

### 10.2 Blast Radius Analysis: Before Any Change

Before modifying any file, enumerate:

1. **Callers**: every JS file that calls any function you're changing (`grep -r functionName js/`)
2. **Test coverage**, every spec file (`tests/*.spec.js`) that exercises the code path
3. **Shared infrastructure**, if you touch `tests/helpers.js` or the Supabase shim, list every
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
window._mmtCol_build = false;    // expanded: items render into HTML
window._mmtCol_pending = false;
window._mmtCol_collect = false;
```

Any test counting items in `#dash-money-feed` innerHTML without first expanding the
section will always get 0. This is a known footgun, not a bug, by design for UX.

---

### 10.7 Pre-Push Checklist: Non-Negotiable

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
| 8 | **Did I RUN every spec file I touched, locally, and see it pass?** (§5.2.1) | Yes, with output |
| 9 | Did I grep for every spec that EXERCISES the functions I changed, and run those too? | Yes, listed |

Row 8 is the one that pays for itself. It costs 5 to 13 seconds and it is the
difference between CI confirming your work and CI discovering your mistakes.

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
    // Call 10 times synchronously, guard should let exactly 1 through
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
> validated, and budgeted in one pass. A flow test is not "did it work", it is
> "did it work AND how much did it cost the user." Both, every time.

The live flow suite (`tests/flow/*.spec.js`, run via `playwright.flow.config.js`
against the deployed pages.dev preview) drives the REAL app against REAL Supabase.
No seeding hollow rows, every assertion comes from clicking the actual UI.

`tests/flow/estimate-build.spec.js` is the **reference implementation**. New flows
copy its shape.

---

### 12.1 `step()` Is the Heart of Every Flow: Mandatory

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
  the ratchet, count it honestly.
- `rule` returns `{ok, got}`. On `!ok`, `step()` throws a one-line `finding()`
  ticket (`[role][page] control → RULE … expected/got/suspect`): the exact
  substrate the agentic self-heal loop (§13) reads to fix the bug.
- Every step is pushed to the `_LEDGER` with its ms + interaction count.

**No raw `expect()` on a UI post-condition outside a `step()`.** If you are
asserting that an action produced a result, it is a step. Pre-flight setup
(`signIn`, `resetLedger`) and the final `report()` gate are the only exceptions.

Call `resetLedger()` in `beforeEach` so each test owns a clean ledger.

---

### 12.2 The Performance Ratchet: Clicks Hard-Gate, Time Advises

Every flow ends with:

```js
const rep = report(FLOW, BASELINE);            // BASELINE = require('./perf-baseline.json')
expect(rep.overBudget).toBe(false);            // HARD FAIL on click regression
```

`report()` prints the friction profile (slowest-first ledger, total ms, total
clicks) and grades total interactions against `tests/flow/perf-baseline.json`.

| Metric | Role | Why |
|--------|------|-----|
| **Interaction count** | **Deterministic HARD GATE** | The same flow always takes the same number of clicks. A PR that increases it is a UX regression and **fails CI today**, not a warning. |
| Wall-clock ms | Advisory (logged) | Network/CI jitter makes time non-deterministic. Tracked for trend, never gated. |

**The ratchet rule:** every PR must be **as fast or faster** than the last. A
flow's click count may only ever **ratchet DOWN** (the app gained leverage) or stay
flat. It may go **up only** when a deliberate new step is added, and then you
raise the baseline in the **same commit** with a one-line justification in the
`note`. Silent baseline inflation is a banned patch-chain move (§10).

---

### 12.3 Baselines: `tests/flow/perf-baseline.json`

- A flow **listed** in the baseline is hard-gated on `clicks`.
- A flow **not listed** is in **capture mode**, `report()` logs
  `BASELINE CAPTURE [flow]: N clicks` and does not gate. Copy that number into the
  file to start gating it. Capture first, gate second.
- Because `act()` returns a deterministic count, you can gate a flow the moment it
  is written, no live run required to discover the number.
- Improving the app (fewer clicks to the same outcome) means you **must** lower the
  baseline in the same PR, or the old budget silently permits the regression to
  creep back.

---

### 12.4 Scale Benchmarks: Find Where the App Gives No Leverage

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
6. Never wipe data, teardown is opt-in (`E2E_TEARDOWN=1`), off by default.

---

### 12.6 Physical Interaction Standard: Real Thumb, Real Scroll, Real Devices

Flow tests drive the app the way a person does: real taps, real key-by-key
typing, and real scrolling, never `page.evaluate(() => someFn())` to shortcut a
gesture. The helpers in `live-helpers.js` perform the physical action AND return
its honest cost so `act()` just sums them:

| Helper | Action | Cost returned |
|--------|--------|---------------|
| `tap(p, sel)` | scroll into view, then click | `1` (+1 if a scroll was needed) |
| `type(p, sel, text)` | scroll in, click, type key-by-key | `text.length` (+1 if scrolled) |
| `pick(p, sel, val)` | choose a `<select>` / date value | `1` (+scroll) |
| `scrollBy(p, dy)` | a deliberate scroll | `1` |

**You can't tap what you can't see**, every helper scrolls the target into view
first, and if the page physically moved, that counts as a real scroll. So the
SAME flow costs MORE on a phone than a laptop, and that delta is the UX signal.

**Three form factors, always** (`playwright.flow.config.js` projects): `mobile`
(390×844, webkit), `tablet` (820×1180, touch), `desktop` (1280×800). Every flow
runs on all three.

**Typing is key-by-key** (`pressSequentially`, never `fill`), so values are
entered exactly as a user would, which also exercises the auto-capitalize-on-
space behavior live.

---

### 12.7 Live Tests NEVER Clean Up Their Own Data: Leave It to Poke At

**Mandatory: a live flow test must not delete, soft-delete, or restore the records
it creates.** No end-of-test `bids = bids.filter(...)` + `supaSaveToCloud()`, no
`_supa.from('td_*').delete()`, no "restore the original value" block. The seed data
the test writes, bids, clients, jobs, expenses, vehicles, contracts, settings
changes, everything, **stays in the dev account on purpose**, so the owner can open
the app afterward and poke holes in exactly what the tests put in. The owner deletes
it manually on their own schedule.

- The ONLY data removal allowed is the explicit opt-in `teardownAll()` gated behind
  `E2E_TEARDOWN=1` (off by default), never inline per-test cleanup.
- **Resource** cleanup is still fine and expected: closing extra browser
  contexts/pages you opened (`ctx.close()`, `page.close()`) frees the runner and is
  not data, keep it.
- Use uniquely-tagged ids (`Date.now()*1000 + …`, `process.pid`) so the accumulating
  seed data never collides across runs/viewports, since it is never cleaned up.
- Rationale: cleanup hides the very thing the owner wants to inspect, and a failed
  assertion mid-test can leave half-cleaned state that's more confusing than just
  leaving it all. Leave everything; the owner curates the account by hand.

---

### 12.8 Every New Feature or Change Gets a Local-Runner Flow Test: Architected Together, Run Locally Before Ship (MANDATORY)

> Owner mandate (2026-07-13): offline shards prove functions in isolation; a live
> flow test on the **self-hosted local runner** (localhost:8788 → real Dev
> Supabase, `playwright.flow.config.js` / `flow-tests-selfhosted.yml`) is what
> proves the feature actually works end-to-end against the real backend. Both,
> every time, not one or the other.

For **every new feature AND every change to an existing flow**, before it's "good
to go":

1. **Architect the flow test together.** Claude proposes the flow-test design,
   which real user journey it drives, the `step()`s, the `rule`/`suspect` for each,
   the privacy/edge assertions, and confirms that shape **with the owner** before
   building it. This is a "you and I" step, not a Claude-only decision: the owner
   signs off on what the test covers so it exercises the journey that actually
   matters, not just the happy path Claude assumed.
2. **Build it against the real backend.** New `tests/flow/*.spec.js` following the
   `estimate-build.spec.js` reference shape (§12.1–12.6): `step()` on every action,
   honest interaction counts, `report()` + baseline gate, leaves its seed data
   (§12.7). Wire two-account/role journeys where the feature crosses accounts.
3. **Run it on the LOCAL RUNNER and confirm green**, the self-hosted runner
   (localhost → real Supabase, zero Cloudflare cost), NOT the cloud flow job and NOT
   just the offline shards. Report the actual green result. A feature is not "good
   to go" until its local-runner flow test passes for real.
4. **Then** proceed through the normal Loop (§0): offline shards + this flow run
   green → screenshot → owner review → deploy on request.

Skip this only for changes with genuinely no runtime user-flow surface (pure docs,
comments, a test-only edit). Everything a real user can touch gets a local-runner
flow test architected with the owner and run green first.

**CI-enforced visibility (added 2026-08-17):** this rule used to rely entirely on
Claude remembering it, and features have shipped without a flow test as a result.
`.github/workflows/test.yml` now runs a `flow-test-advisory` job on every PR: it
diffs the branch against its base and, if any of the feature-surface files
(`js/dashboard.js`, `js/mileage.js`, `js/clients.js`, `js/jobs.js`, `js/bids.js`,
`js/finance.js`, `js/geo-track.js`, `js/proposals.js`, `js/generic-estimate.js`)
changed with no matching `tests/flow/*.spec.js` change anywhere since the branch
diverged from main, it emits a `::warning::` annotation naming the files and
pointing back at this section. **It is advisory only, it never fails the check
or blocks a merge**, a hard gate here would false-positive on small bug fixes
already covered by existing tests and teach Claude to route around it. Seeing the
warning on a PR is the trigger to ask: does this change actually need the flow
test this section describes, or is it already covered? If it needs one, build it
per steps 1-4 above before calling the work done.

---

## 13. Agentic Self-Heal Loop (Slack → Claude → Regression Test → PR)

The endgame: a bug reported by a real user heals itself, forever.

1. **Report**: a user hits a bug; it lands in Slack (`#20`), or CI/console/prod
   surfaces a `console.error`.
2. **Ticket**: the failure is already in `finding()` shape
   (`[role][page] control → RULE … expected/got/suspect`) because every `step()`
   throws that format. Claude reads the suspect file:line directly.
3. **Fix**: Claude fixes the **root cause** (§10.1: never the symptom, never the
   test) on the feature branch.
4. **Regression test that runs forever**, the same commit adds a `step()` to the
   relevant flow asserting the bug can never return. This is non-negotiable: a fix
   without a permanent guarding step is incomplete.
5. **Push → CI → human approves merge.** Claude never merges without explicit
   approval (§1.5). The test now runs on every PR, forever.

The `finding()` → `suspect` → root-cause-fix → permanent-`step()` chain is what
makes the loop reliable instead of a guess-and-hope patch machine.

### 13.1 Hot Lane: Live-Error Hotfix PRs (standing merge authorization)

> Two PR lanes, by owner decision (2026-07-03): **hotfix PRs run hot end-to-end
> with no human in the loop; feature PRs still wait for explicit approval.**

**The pipeline (fully automatic):**

1. A live user hits an error (window error, unhandled rejection,
   `console.error`, or a DEAD BUTTON, a control whose FIRST click produces
   zero DOM/navigation/network effect, captured by `js/observability.js` →
   `error_log`).
2. `error-watch.yml` (INSTANT when the `GH_DISPATCH_TOKEN` function secret is
   set: ingest-telemetry fires it the moment the row lands; 15-min cron as
   the always-on fallback) opens a **hotfix PR** on a fresh
   `claude/hotfix-err-<id>` branch off `main`, body = the finding-shaped error
   report, and wakes the active agent session via a comment on the open
   feature PR.
3. The agent fixes the **root cause on the hotfix branch** (§10.1: never the
   symptom) and adds a **regression test in the same commit**. The test must
   reproduce the error's conditions and assert zero console errors, red
   before the fix, green after, so the error can never return silently.
4. One push, full result set (§1.6). All shards green **first-attempt**.
5. **The agent merges the hotfix PR autonomously.** This is the ONLY exception
   to §1.4's no-merge rule, granted in writing by the owner and scoped
   strictly to PRs whose head branch starts with `claude/hotfix-err-`. The
   merge builds production, the fix ships live immediately (that's the point
   of the lane). Never use `[CF-Pages-Skip]` on a hotfix merge.
6. `hotfix-resolve.yml` marks the fixed `error_log` rows resolved on merge.
   **The self-test:** if the same error ever fires again in production, it
   lands as a new unresolved row and error-watch opens a fresh hotfix round
   within 15 minutes, a fix that didn't hold surfaces itself.

**Hard limits of the lane:**
- Hotfix PRs contain the MINIMAL root-cause fix + its regression test.
  Nothing else, no refactors, no features, no drive-by cleanups.
- Feature work, migrations, and anything touching money flows or auth stay in
  the feature lane with explicit owner approval (§1.4 unchanged there).
- If the root cause is ambiguous, architecturally significant, or spans more
  than a small blast radius (§10.2), the agent STOPS and asks the owner
  instead of merging.

---

## 14. CI / Deploy Architecture & Cloudflare Build Cadence

Two independent systems, don't conflate them:

| System | What it does | Triggered by | Cost |
|--------|--------------|--------------|------|
| **Cloudflare Pages** | Builds + deploys the static app to `pages.dev` | **Every push** (by default) | Cloudflare Pages **build minutes** |
| **GitHub Actions, offline shards** | Mocked Playwright (6 shards, WebKit+Chromium) | Every push | GH Actions minutes |
| **GitHub Actions, Flow Tests** | Live Playwright vs the deployed `pages.dev` preview | On-demand (`run-flow` label / `workflow_dispatch`) + nightly | GH Actions minutes |
| **Supabase preview** | Supabase's own PR-integration check, NOT a migration push to the shared project (see §14.1.2) | Every push | Free |
| **`deploy-functions.yml`** | The ACTUAL `supabase db push` to the shared dev/UAT/prod project + edge functions | `main` push, or manual `workflow_dispatch` (§14.1.2) | GH Actions minutes |

**The flow tests run on GitHub Actions, NOT Cloudflare.** Cloudflare only ever
*deploys the app*. So a test-only / migration-only / docs-only push that triggers
a Cloudflare Pages build is **pure waste**, it rebuilds an app that didn't change.

**Fix: Build watch paths** (Cloudflare dashboard → Pages → Settings → Builds &
deployments → Build watch paths):
- **Include:** `index.html`, `client.html`, `sign.html`, `intake.html`, `js/**`, `sw.js`, `manifest*`, CSS
- **Exclude:** `tests/**`, `supabase/**`, `.github/**`, `*.md`, `playwright*.config.js`

**Per-commit skip:** put `[CF-Pages-Skip]` in the commit message to skip that
build. Use it for test-only / migration-only / docs-only commits.

### 14.1 Deploy Cadence: Default-Skip, Deploy On Request (MANDATORY)

Deployments are deliberate, never reflexive. The owner decides when the app
rebuilds.

- **Every commit Claude pushes carries `[CF-Pages-Skip]` in the message** so
  Cloudflare Pages does NOT rebuild the app. Offline shards + Migration lint +
  Supabase preview still run on each push (they're free / necessary gating).
- **The app preview rebuilds ONLY when the owner explicitly asks**, "deploy",
  "ready", "rebuild", "ship it", or equivalent. Then, and only then, push a
  deliberate build: a commit WITHOUT the skip token (or an empty
  `git commit --allow-empty -m "Deploy preview"` if the code is already pushed).
- This holds even for app-code (`js/**`, `*.html`) changes: land them with the
  skip token, tell the owner "app changed, say the word to deploy," and wait.
- Rationale: the owner keeps thinking of changes after the fact and wants to batch
  them into one intentional deploy instead of burning a Cloudflare build on every
  push. Respect that, never auto-deploy.

### 14.1.1 Merging a PR to `main` Always Builds: No Separate "Deploy" Ask Needed

Owner directive (2026-07-14): **merging a PR to `main` is itself the deploy
signal.** §1.4/§1.5 already require explicit owner permission before any merge;
by the time a merge happens, that approval already covers shipping it. Don't
also wait for a separate "deploy" word after merging; the merge IS the word.

- **The merge commit on `main` must NOT carry `[CF-Pages-Skip]`** anywhere in
  its message, or Cloudflare will skip the production build, silently leaving
  production on the old version even though `main` has the new code.
- **Squash-merge gotcha (the actual incident this rule captures):** GitHub's
  default squash-merge commit concatenates every squashed commit's message
  into the merged commit's body. Since every dev-branch commit intentionally
  carries `[CF-Pages-Skip]` per §14.1, that token ends up repeated throughout
  the squashed body, and Cloudflare's skip-detection scans the whole message,
  not just the first line. Result: a clean squash-merge with a skip-token-free
  *title* still skips the build, because the token survives in the *body*.
  **Fix:** when merging (`mcp__github__merge_pull_request` or equivalent),
  don't rely on the default squash body, either merge with a method that
  doesn't concatenate skipped messages, or verify after merging that the
  landed commit's message has zero `[CF-Pages-Skip]` occurrences (`git log -1
  main | grep -c CF-Pages-Skip` should be `0`). If it isn't, push a trivial
  no-skip commit (or empty `git commit --allow-empty`) to `main` immediately
  to force the production build.
- This is about `main`/production specifically, §14.1's skip-by-default rule
  for WIP pushes on feature branches (and for previews on request) is
  unchanged.

### 14.1.2 Migrations Aren't Gated Like Code: Dispatch `deploy-functions.yml` Directly

§3.1 already says only CODE is gated by the merge to `main`, migrations and
edge functions are supposed to be free to land on the shared Supabase project
ahead of a merge. But the only workflow that actually runs `supabase db push`
(`.github/workflows/deploy-functions.yml`) triggers on `push: branches:
[main]`, nothing else in this repo pushes migrations to the real project. In
practice that meant migrations silently piled up on a long-lived dev branch
(incident 2026-08-22: 5 migrations going back 9 days, including the RPC a
brand-new login gate depended on, none of them live) waiting on a `main`
merge nobody realized was blocking them, since the "Supabase Preview" check
in the PR checks list is a DIFFERENT thing (Supabase's own branch-preview
integration, not a push to the shared dev/UAT/prod database, see §3.1).

**The fix already exists in the workflow, it just wasn't documented:**
`deploy-functions.yml` also has a `workflow_dispatch: {}` trigger. Fire it
manually against your branch whenever a migration needs to be live for
testing (Dev/UAT) before the PR merges:

```
mcp__github__actions_run_trigger({ method: 'run_workflow', owner, repo,
  workflow_id: 'deploy-functions.yml', ref: '<your-branch>' })
```

This only runs `supabase db push` (idempotent, additive) + edge function
deploy + the Stripe webhook sync, against the ONE shared Supabase project.
It never touches `main`, app code, or Cloudflare, so it needs no more
caution than any other backend-only action, but it IS a shared-state change
(§ Executing actions with care), so still worth a quick heads-up to the
owner before firing it, same as any other action that touches live
infrastructure. Confirm success via `mcp__github__actions_get` /
`get_workflow_run` (the "Push database migrations" and "Deploy edge
functions" steps), the same way CI green is verified elsewhere (§1.4), don't
assume the dispatch succeeded just because it queued.

### 14.2 The `/api` Proxy Is Load-Bearing: Never Remove It

`functions/api/[[path]].js` is a Cloudflare Pages Function that reverse-proxies
`/api/*` → the Supabase project URL. The app sets `SUPA_URL = location.origin +
'/api'` (cloud.js), so **every** Supabase call, REST, auth, and realtime
WebSocket: routes through it.

- **Why it exists (real, observed, NOT theoretical):** without it, **AT&T Fiber
  could not load the app**, that network fails to reach `*.supabase.co` directly.
  Routing through the app's own Cloudflare domain (which the browser already
  resolved to load the page) fixes it. Do NOT "optimize" this away by calling
  Supabase directly, it re-breaks AT&T Fiber (and likely other carriers).
- **The cost:** every Supabase request is one Cloudflare Workers/Pages Functions
  invocation. The **free** plan caps at **100,000 requests/day per ACCOUNT** (shared
  across preview + production). Production burns this on every real user-action;
  the live flow suite burns it FAST.
- **Therefore Workers Paid ($5/mo → 10M/day) is a hard infra requirement**, not
  optional. It is cheaper and safer than removing the proxy.
- **Do not casually trigger the full live flow suite**, it can exhaust the daily
  account limit in one run and throttle the proxy for preview AND production until
  the UTC-midnight reset (or until Workers Paid is enabled). Run live specs in
  small subsets, and only with the owner's go-ahead.

### 14.3 Direct-Supabase Default + Auto-Fallback (validated 2026-06-28)

§14.2's "never call Supabase directly, it re-breaks AT&T Fiber" was **empirically
retired**: direct mode was tested on AT&T Fiber (the exact network the proxy was built
for) and a full lead→bid→send flow loaded fine and burned ZERO `/api` requests.

- **`SUPA_URL` now DEFAULTS to direct** (`https://<ref>.supabase.co`) in `js/cloud.js`,
  zero Cloudflare `/api` cost on any network that can resolve Supabase.
- **The `/api` proxy is RETAINED as a self-healing fallback:**
  - `supaInit()` probes `/auth/v1/health` (2.5s) before building the client; a DNS/
    network failure silently switches THAT session to the proxy, never an outage.
  - Manual override: `?supadirect=0` forces proxy, `?supadirect=1` forces direct
    (persisted in localStorage `zp3_supa_mode`).
- **Do NOT delete `functions/api/[[path]].js`**: it is the fallback. Removing it
  re-introduces the all-or-nothing risk for any carrier that can't resolve Supabase.
- This makes the 100k/day Pages-Functions limit a non-issue for normal use; Workers
  Paid is now optional, not required.

---

## 15. Layout & Visual Integrity Standard

The app is judged on how it **looks and holds together**, not just whether it works.
A render that bleeds off-screen, overlaps, or silently changes between commits is a
**defect**: the same severity as a broken function.

### 15.1 Hard Layout Rules: Every Screen, Every Device

- **Nothing bleeds off-screen.** No element may overflow the viewport width or cause
  horizontal scroll on any supported device (mobile 390px, tablet 820px, desktop).
  Use `box-sizing:border-box`, `min-width:0` on flex/grid children, `max-width:100%`,
  and wrap/truncate long text, never let content push past the edge.
- **Things stack and center correctly.** On narrow viewports, action areas, cards, and
  summary rails stack in a sane order and stay centered/aligned: no floating, no
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
- `documentElement.scrollWidth <= innerWidth + 1`, no horizontal bleed.
- No two interactive controls overlap (bounding-box intersection check).
- Exactly one primary action (e.g. one visible "Send proposal") per screen.
- Key containers stay within the viewport (`getBoundingClientRect().right <= innerWidth`).

A layout regression fails CI like any other bug.

---

## 16. New Feature Workflow: Research → Build → Screenshot → Approve

Building from assumption is banned for anything beyond a bug fix. This is the full,
ordered sequence for any genuinely new feature (a new document type, workflow, or
screen: not a bug fix, not a tweak to something that already exists):

1. **Understand the ask.** Restate what's actually being requested before researching
   or building anything. Resolve scope ambiguity first, don't guess and build.
2. **Research the competition.** Check the relevant names from the competitive set
   (§16.1) for this specific feature, do they have it? If yes: how do they solve it,
   what does their flow look like, what do *their own users* complain about doing it
   their way. If no: that's a gap worth exploiting, say so. Also pull real contractor
   feedback: trade-specific forums/subreddits (r/electricians, r/HVAC, r/Construction,
   etc.), G2/Capterra/App Store reviews of competitor products, contractor Facebook
   groups: not guesses about what "seems useful." Note what contractors love and hate
   about how existing tools (including ours) handle this today, both directions matter.
3. **Design how we beat them.** Synthesize the research into a concrete plan. The
   design must cite what it's based on, which competitor pattern, which piece of
   contractor feedback, not "this seemed like the right approach." If research turns
   up nothing decisive, say so explicitly and default to the simplest version that
   solves the stated problem, rather than skipping research because findings were thin.
4. **Build it with tests in the same commit.** Feature code + E2E tests (happy path,
   edge cases, `assertNoErrors()`) + live flow test coverage where the feature touches
   a real user flow, written together, per §5.1, never after.
5. **Run the tests and confirm they actually pass.** Offline shards clean, and the
   cloud gate (real backend) clean, before moving on, per the Loop (§0).
6. **Screenshot the UI/UX: not a live deploy.** Per §0 Step 0.5: render the actual
   changed screen locally and send it in chat for a reaction.
7. **The owner reviews the live screenshot.** "Yeah, that's good" → proceed to deploy
   per the normal Loop. "No, needs changes/additions" → back to step 4 (or step 3, if
   the direction itself needs to change), iterate on screenshots, not deploys, until
   approved.

**Scope:** genuinely new features only. Bug fixes, refactors, and small UX polish on
something that already exists don't need this full sequence, just the normal Loop.

### 16.1 The Competitive Set

Compiled via research agent 2026-07-10, not a guess, a real market scan (G2/Capterra
category pages, "alternatives to X" roundups, contractor forum/review sentiment).

**Primary: check for every feature.** Closest match on target customer (mobile-first,
small-to-mid trade contractor) and full-lifecycle scope:
- **Jobber**, clean workflow, fastest setup, the default "value" pick in every roundup.
- **Housecall Pro**, best mobile field-tech UX of the big players, the exact axis
  TradeDesk's UX thesis competes on.
- **ServiceTitan**, the enterprise ceiling: what "full-featured" looks like at scale.
- **QuoteIQ**, AI-forward, flat/budget pricing, same home-service segment.
- **DripJobs**, painting-leaning, automation-heavy CRM; **no dedicated mobile app**,
  a real gap to exploit.
- **FieldPulse**, closest on multi-trade breadth (HVAC/plumbing/electrical/GC) at the
  small-team tier.

**Trade-specific: check when the feature is trade-specific:**
- Roofing: AccuLynx, JobNimbus
- General contracting / remodeling: Buildertrend, Contractor Foreman, Houzz Pro, Joist
- Landscaping: Aspire (owned by ServiceTitan since 2021), LMN, Yardbook
- Painting: PaintScout (now "Bolster Built"), EstimateRocket

**Adjacent point-solutions, check when the feature overlaps their one job:**
- CompanyCam (jobsite photo docs), Levelset (lien waivers, directly relevant to
  §9.8/lien-protection work), Leap/SalesPro (in-home sales + financing).

**Also worth a scan:** FieldEdge, Workiz, Service Fusion, ServiceM8, Kickserv, Tradify,
simPRO (acquired by ServiceTitan in 2024, verify current product relationship before
citing as independent), mHelpDesk, Sera Systems.

---

## 17. Time and Mileage: One Deriver, One Writer (owner rule 2026-09-02)

Three weeks of Time Log patches never converged because three independent
observers (the phone's strict fence, its park resolver, and the server's
region ingest) each wrote rows for the same physical event, about twenty
sweeps then reconciled them on boot and on every Time Log open, and the reader
corrected the result on screen. Nothing anywhere stated what a row was
supposed to be. That design is gone. The rule now:

- **`js/geo-derive.js` is the only thing that decides what a drive or a dwell
  is.** `geoDeriveDay(tape, fixes, fences)` is pure: the CoreMotion tape and
  the GPS fixes in, dwells and legs out, same input same output same ids. The
  owner's spec is quoted in its header. One journey id per automotive flip.
  Both ends saved or no leg. A personal stop collapses to the direct route.
  Same fence both ends is a round trip. Unresolved by midnight writes nothing;
  the manual clock covers it. A dwell is a row only between an arrival and a
  departure, with one exception: app-open minutes inside a home-office fence
  are an Office row (rule 10, owner 2026-09-02) ONLY outside the working
  day: before the first drive, after the last real work, or on a day with
  no drive at all ("never office time unless it's outside of business hours
  and we're home actively with the app open"). Inside the working day the
  house is whatever the dwell says (the shop, a stop), never Office. Carved
  out of any surrounding home dwell and proven by fixes inside the fence.
- **`geo_replace_day` (Supabase RPC) is the only writer of automatic rows.**
  It replaces one person's automatic rows for one day in one transaction,
  refuses any set with an overlap, preserves manual clocks and hand-fixed
  rows, and carries hand-set attributes across a re-derived mileage leg.
- **The phone derives; the screens read.** Live: the automotive -> foot flip
  and the 30-minute push-ping re-derive today. Boot: the tape's seven-day
  window is re-derived once. `_geoEnqueue` is gated so no engine closer can
  write an automatic row again; manual and `fixed-*` rows still land.
- **The Time Log and Crew Cost read rows as stored.** The reader keeps
  exactly two passes: `_tlBlendManual` (the clock is the bracket, automatic
  rows overlay it, the remainder is Manual time) and `_tlFillUnaccounted` (a
  hole between rows is a question). Nothing else.
- **Never add a sweep, a reconciler, a dedup, or a reader-side correction.**
  If the day is wrong, the deriver is wrong: fix the rule there, add the case
  to `tests/e2e-geo-derive.spec.js`, and the boot rebuild repairs history.
  `tests/e2e-geo-derive-gone.spec.js` fails CI if any of the deleted names
  come back.
