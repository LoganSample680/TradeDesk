# TradeDesk — Claude Code Instructions

> These rules are mandatory. They are not suggestions. Every rule applies on
> every task unless explicitly overridden in writing by the user in this session.

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

### 1.2 Non-Negotiable Rules

- **Every push must have an open PR.** Create one if it does not exist. Always.

- **Never merge to `main` without explicit user permission.** Not even when CI is
  fully green. This rule has no exceptions.

- **Verify CI by re-polling** `get_check_runs` and confirming every shard shows
  `status: completed, conclusion: success` before reporting green. Do not rely
  solely on webhook events — they can arrive out of order or with duplicate IDs.

---

### 1.3 What "CI Green" Means

| Requirement | Standard |
|-------------|----------|
| Hard failures | 0 across all WebKit and Chromium shards |
| Flaky tests | None — every test must pass on first attempt |
| Console errors | 0 new `console.error` calls introduced by the change |

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
