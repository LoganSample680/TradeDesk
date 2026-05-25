# TradeDesk — Claude Instructions

## Git Workflow — CI-Gated PR Flow

**Never merge directly to main.** All changes go through a PR so CI must
pass before main is updated.

### Step-by-step

1. **Push** all changes to the feature branch:
   ```
   git push -u origin claude/review-app-ux-flow-mRafw
   ```

2. **Open (or update) a PR** from `claude/review-app-ux-flow-mRafw` → `main`.
   - If no PR exists, create one via the GitHub MCP tool (`mcp__github__create_pull_request`).
   - If one already exists, the push automatically re-triggers CI.

3. **Subscribe to PR activity** immediately after opening/finding the PR:
   Use `mcp__github__subscribe_pr_activity` so CI check results, review
   comments, and failures are delivered directly to Claude without polling.

4. **Wait for CI** — GitHub Actions runs Playwright (WebKit + Chromium).
   - ✅ All pass → merge the PR via `mcp__github__merge_pull_request`.
   - ❌ Any fail → read check run output via `mcp__github__pull_request_read`
     with `get_check_runs`, fix on the feature branch, push again.
     CI reruns automatically. Loop until green.
   - ⚠️ Flaky (fails then passes on retry) → investigate and fix before merging.

5. **Merge** only when CI is green:
   Use `mcp__github__merge_pull_request` with `merge_method: squash`.

### What "CI green" means
- 0 hard failures across WebKit and Chromium
- Flaky tests are resolved before merge
- Zero new console errors introduced by the change

---

## Version Bumps

Every commit must bump the version in all three places simultaneously:
- `js/cloud.js` — `APP_VERSION='MM.DD.YY.NN'`
- `sw.js` — `CACHE = 'tradedesk-MM.DD.YY.NN'`
- `version.json` — `{"version":"MM.DD.YY.NN"}`

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

New feature checklist:
1. Write the feature code on the feature branch
2. Add tests: happy path + edge cases + `assertNoErrors()` check
3. Run locally first: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test --project=chromium`
4. Push → CI runs full WebKit + Chromium suite
5. Fix any failures before merging to main

**Console error policy:** Any `console.error` a new feature introduces is
a test failure. `assertNoErrors()` enforces this across every describe
block. New code must not introduce new console errors.
