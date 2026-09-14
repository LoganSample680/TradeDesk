#!/usr/bin/env bash
# ── THE SAFE ROLL, AS ONE COMMAND (owner 2026-09-14) ───────────────────────
#
# "I need a better flow to run multiple sessions and ensure nothing gets fucked
# up."
#
# The old roll reset uat to one branch and force-pushed, which deletes whatever
# another session put there. This merges instead, so nothing can be lost, and
# it handles the one piece of friction that makes a merge-roll annoying to do
# by hand: version.json and sw.js are rewritten by the pre-commit hook on BOTH
# branches, so they conflict on literally every roll. Their content does not
# matter, because the empty deploy commit below regenerates them, so they are
# resolved in favour of the branch being rolled rather than put to a person.
#
#   bash scripts/uat-roll.sh [branch]     (default: the current branch)
#
# Everything else stops the roll and asks, because everything else is a real
# conflict between two sessions and a person has to decide.
set -uo pipefail
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
STAMPED="version.json sw.js"

if [ "$BRANCH" = "uat" ]; then
  echo "uat-roll: name the branch to roll, not uat itself." >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "uat-roll: working tree is dirty. Commit or stash first." >&2; exit 1
fi

START="$(git rev-parse --abbrev-ref HEAD)"
restore() { git checkout -q "$START" 2>/dev/null || true; }

git fetch -q origin uat "$BRANCH" 2>/dev/null || true
git checkout -q -B uat origin/uat || { echo "uat-roll: cannot check out uat." >&2; exit 1; }

if ! git merge --no-edit -q "$BRANCH"; then
  # Only the stamped files may be resolved automatically.
  UNMERGED="$(git diff --name-only --diff-filter=U)"
  REAL="$(echo "$UNMERGED" | tr ' ' '\n' | grep -v -x -F -e version.json -e sw.js || true)"
  if [ -n "$REAL" ]; then
    echo "" >&2
    echo "uat-roll: STOPPED. Real conflicts between two sessions:" >&2
    echo "$REAL" | sed 's/^/    /' >&2
    echo "" >&2
    echo "  Resolve them here, commit, then run this again. Do not force-push." >&2
    exit 1
  fi
  for f in $STAMPED; do
    git checkout --theirs -- "$f" 2>/dev/null || true
    git add -- "$f" 2>/dev/null || true
  done
  git commit -q --no-edit || { echo "uat-roll: merge commit failed." >&2; exit 1; }
fi

# The deploy commit must NOT carry the skip token, or Cloudflare skips the
# build and uat silently stays on the old code (CLAUDE.md 14.1).
git commit -q --allow-empty -m "UAT deploy"

# No --force. A stale push is REJECTED rather than clobbering, which is the
# whole point; the pre-push guard checks containment on top of that.
if git push -q origin uat; then
  echo "[uat-roll] rolled uat to $BRANCH ($(node -p "require('./version.json').version" 2>/dev/null || echo '?'))"
  restore
else
  echo "" >&2
  echo "uat-roll: push rejected. Someone rolled while this ran." >&2
  echo "  Run this again; the merge will pick up their work." >&2
  restore; exit 1
fi
