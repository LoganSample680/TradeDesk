#!/usr/bin/env bash
# ── KEEP A PR MERGEABLE WHEN MAIN MOVES (owner 2026-10-01) ─────────────────
#
# "how do we write in multiple sessions but ensure everything makes it to
# main."
#
# Every commit stamps the same three version lines, so the moment one PR
# merges, every other open PR conflicts with main on them and GitHub refuses
# to merge it. On 2026-10-01 that held #144 back until it was synced by hand,
# with a full CI round each time. This does that sync: merge main into the
# branch, let scripts/lib/stamp-merge.sh settle the stamp (the same resolver
# the uat roll uses), bump once, push. A conflict in real code stops it and
# names the files, because that one is a person's call.
#
#   bash scripts/pr-sync.sh <branch> [--push] [--only-if-conflicted]
#
#   --push                 push the synced branch (default: leave it local)
#   --only-if-conflicted   do nothing when main merges in cleanly; GitHub can
#                          merge that PR as it is, and a push would only buy a
#                          CI round
#
# Exit 0: synced (or nothing to do). Exit 2: real conflict, nothing changed.
# Exit 1: anything else went wrong.
set -uo pipefail
BRANCH="${1:-}"; shift || true
PUSH=0; ONLY_CONFLICTED=0
for a in "$@"; do
  case "$a" in
    --push) PUSH=1 ;;
    --only-if-conflicted) ONLY_CONFLICTED=1 ;;
    *) echo "pr-sync: unknown option $a" >&2; exit 1 ;;
  esac
done
case "$BRANCH" in
  ""|main|uat) echo "pr-sync: name a feature branch (not main, not uat)." >&2; exit 1 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/stamp-merge.sh
. "$HERE/lib/stamp-merge.sh"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "pr-sync: working tree is dirty. Commit or stash first." >&2; exit 1
fi
START="$(git rev-parse --abbrev-ref HEAD)"
restore() { git checkout -q "$START" 2>/dev/null || true; }

git fetch -q origin main "$BRANCH" || { echo "pr-sync: fetch failed." >&2; exit 1; }
git checkout -q -B "$BRANCH" "origin/$BRANCH" || { echo "pr-sync: cannot check out $BRANCH." >&2; exit 1; }
if git merge-base --is-ancestor origin/main HEAD; then
  echo "[pr-sync] $BRANCH already has main"; restore; exit 0
fi

if git merge --no-commit --no-ff -q origin/main >/dev/null 2>&1; then
  if [ "$ONLY_CONFLICTED" = "1" ]; then
    git merge --abort 2>/dev/null; restore
    echo "[pr-sync] $BRANCH merges main cleanly; left as it is"; exit 0
  fi
else
  REAL="$(resolve_stamp_conflicts)"
  if [ -n "$REAL" ]; then
    git merge --abort 2>/dev/null; restore
    echo "pr-sync: $BRANCH has real conflicts with main:" >&2
    printf '%s\n' "$REAL" | sed 's/^/    /' >&2
    exit 2
  fi
fi

# One bump on top of whichever stamp won, so the merged code never ships
# under a version a different build already used. --no-verify because the
# hook would bump a second time.
node "$HERE/bump-version.js" >/dev/null || { git merge --abort 2>/dev/null; restore; exit 1; }
git commit -q --no-verify -m "Merge main into $BRANCH [CF-Pages-Skip]" \
  || { echo "pr-sync: merge commit failed." >&2; git merge --abort 2>/dev/null; restore; exit 1; }

if [ "$PUSH" = "1" ]; then
  # No --force: a branch that moved while this ran is rejected, not clobbered.
  git push -q origin "HEAD:refs/heads/$BRANCH" || { echo "pr-sync: push rejected." >&2; restore; exit 1; }
fi
echo "[pr-sync] $BRANCH now has main ($(node -p "require('./version.json').version" 2>/dev/null))"
restore
exit 0
