# TradeDesk — Claude Instructions

## Git Workflow — CI-Gated PR Flow

**Never merge directly to main.** All changes go through a PR so CI must
pass before main is updated.

### Step-by-step — do this automatically after every push

1. **Push** all changes to the feature branch:
   ```
   git push -u origin claude/review-app-ux-flow-mRafw
   ```

2. **Immediately check for an open PR** via `mcp__github__list_pull_requests`
   (state: open, head: the feature branch).
   - **No open PR found** → create one immediately via `mcp__github__create_pull_request`.
     Do not wait for the user to ask. Do not skip this step.
   - **Open PR already exists** → the push automatically re-triggers CI on it.
     Note the PR number for the next steps.

3. **Subscribe to PR activity** immediately after opening/finding the PR:
   Use `mcp__github__subscribe_pr_activity` so CI check results, review
   comments, and failures are delivered directly to Claude without polling.

4. **Wait for CI** — GitHub Actions runs Playwright (WebKit + Chromium).
   - ✅ All pass → report green to the user and **wait for explicit merge approval**.
   - ❌ Any fail → read check run output via `mcp__github__pull_request_read`
     with `get_check_runs`, fix on the feature branch, push again.
     CI reruns automatically. Loop until green.
   - ⚠️ Flaky (fails then passes on retry) → investigate and fix before merging.

5. **Merge only with explicit user approval.**
   Never call `mcp__github__merge_pull_request` unless the user has said
   "merge it", "ship it", "go ahead", or equivalent in this session.
   Report CI results and ask: "All shards green — OK to merge?"

### Non-negotiable rules
- **Every push must have an open PR** — create one if it doesn't exist, always.
- **NEVER merge to main without explicit user permission** — not even when CI is
  fully green. Always ask first. This is non-negotiable.
- Always verify CI by re-polling `get_check_runs` and confirming every shard ID
  shows `status: completed, conclusion: success` before reporting green.
  Do not rely solely on webhook events — they can arrive out of order or
  with duplicate IDs.

### What "CI green" means
- 0 hard failures across WebKit and Chromium
- Flaky tests are resolved before merge
- Zero new console errors introduced by the change

---

## Version Bumps

The pre-commit hook (`scripts/bump-version.js`) handles this automatically.
**Do not manually edit version files** — the hook stages them as part of every
`git commit`. Zero token cost.

Run once after cloning: `bash scripts/install-hooks.sh`

### Fallback — only if hook didn't fire

If `git commit` output does NOT include `[bump-version]`, the hook is missing.
Run `node scripts/bump-version.js` manually, then re-commit.

Version format `MM.DD.YY.NN` — date in US Central Time (`TZ='America/Chicago'`),
`NN` resets to `1` at midnight CT, increments each push same day.

---

## Dev Branch

All development work goes on branch: `claude/review-app-ux-flow-mRafw`

---

## Branch Protection (one-time setup by repo owner)

Go to GitHub → Settings → Branches → Add rule for `main`:
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status check name: **E2E Tests / test**
- ✅ Require pull request before merging
- ✅ Do not allow bypassing the above settings

This makes it impossible for broken code to reach main — not even via
direct push.

---

## E2E Test Philosophy — New Features

The test suite is the quality gate. **Every new feature gets E2E tests.**

### Tests ship in the same commit as the feature — always

New feature code and its E2E tests are written together and committed
together. CI sees both at once, so the new tests cover the new code and
the suite passes. This means:

- **New features are never blocked by CI** — because their tests arrive
  with them, not after.
- **CI only fails if something is actually broken** — a real regression,
  a console error, or a test written incorrectly.
- **Tests are proof of correctness, not a fence around the code.**

### New feature checklist
1. Write the feature code on the feature branch
2. Write E2E tests for it in the **same commit**: happy path + edge cases
   + an `assertNoErrors()` call to confirm zero console errors
3. Run locally first: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test --project=chromium`
4. Push → CI runs the full WebKit + Chromium suite automatically
5. If CI fails → fix on the feature branch, push again, CI reruns
6. When CI is green → merge via PR

### Console error policy
Any `console.error` a new feature introduces is a test failure.
`assertNoErrors()` enforces this in every describe block. New code must
not introduce new console errors — if it does, fix the code, not the test.

---

## Code Removal & Cleanup Policy

**Dead code must be deleted, never hidden.**

When a feature is moved, replaced, or refactored:

- **Delete** the old code — functions, HTML elements, CSS, event handlers.
  Do not comment it out. Do not set `display:none`. Do not add `if(false)`.
- **Remove** every call site that referenced the deleted code.
  Search across all JS files and HTML before committing.
- **Never** leave orphaned functions defined but uncalled.

### Tests must verify the deletion

Every PR that removes or moves something must include E2E tests that
**assert the old thing no longer exists**:

```js
// Function removed → assert it's gone
const fnExists = await page.evaluate(() => typeof oldFunction === 'function');
expect(fnExists).toBe(false);

// HTML element removed → assert it's absent from the DOM
const count = await page.locator('#old-element-id').count();
expect(count).toBe(0);
```

These tests are not optional. CI must prove the old entry point is gone,
not just that the new one works.

### No data loss — verify before removing UI

Before removing any UI that wrote to storage (`S.*`, localStorage,
Supabase), confirm:
1. The underlying data key (`S.vehicles`, `maintenance`, etc.) is still
   read and written by the replacement code.
2. No migration is needed — existing user data loads correctly without
   the old UI present.
3. Call out in the PR description which data stores are affected and
   confirm no records are dropped.

### One commit per PR

Squash all work for a PR into **one commit** before pushing. Multiple
commits pushed in quick succession trigger `concurrency: cancel-in-progress`
and kill earlier shard runs — meaning CI results never appear in the PR.

**Workflow:**
1. Do all the work locally across as many commits as needed.
2. Before the final push: `git reset --soft HEAD~N` then recommit as one.
3. If already pushed: squash with `git reset --soft`, recommit, then
   `git push --force-with-lease`.
4. After a squash force-push, rebase onto `origin/main` if conflicts
   appear: `git checkout -B <branch> origin/main && git cherry-pick <sha>`.
