#!/usr/bin/env bash
# ── THE SAFE ROLL, AS ONE COMMAND (owner 2026-09-14) ───────────────────────
#
# "I need a better flow to run multiple sessions and ensure nothing gets fucked
# up."
#
# The old roll reset uat to one branch and force-pushed, which deletes whatever
# another session put there. This merges instead, so nothing can be lost, and
# it handles the one piece of friction that made a merge-roll annoying to do
# by hand: version.json and sw.js used to be rewritten by the pre-commit hook
# on BOTH branches, so they conflicted on every roll. Since 2026-10-02 the
# version is stamped by Cloudflare's build instead (scripts/stamp-version.js)
# and the committed lines never change, but a branch cut before that still
# carries old stamps. Their content does not matter, because the build
# overwrites them, so they are resolved in favour of the branch being rolled
# rather than put to a person.
#
#   bash scripts/uat-roll.sh [branch]     (default: the current branch)
#
# Everything else stops the roll and asks, because everything else is a real
# conflict between two sessions and a person has to decide.
set -uo pipefail
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
# The stamp resolver and the drop check live in scripts/lib, shared with
# scripts/pr-sync.sh, so the two merges every branch goes through (into uat,
# and main into the branch) resolve the stamp the same way.
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/stamp-merge.sh
. "$HERE/lib/stamp-merge.sh"
# shellcheck source=lib/uat-drop-guard.sh
. "$HERE/lib/uat-drop-guard.sh"

if [ "$BRANCH" = "uat" ]; then
  echo "uat-roll: name the branch to roll, not uat itself." >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "uat-roll: working tree is dirty. Commit or stash first." >&2; exit 1
fi

START="$(git rev-parse --abbrev-ref HEAD)"
restore() { git checkout -q "$START" 2>/dev/null || true; }

git fetch -q origin uat "$BRANCH" 2>/dev/null || true
# ── RESUME, DON'T RESTART (2026-09-23) ─────────────────────────────────────
# On a real conflict this script says "resolve them here, commit, then run
# this again". Run again, it used to begin with `checkout -B uat origin/uat`,
# which threw away the merge that had just been resolved, re-merged, hit the
# same conflict and stopped again, forever. The only way out was to finish the
# roll by hand, and a roll finished by hand is how code got deleted from uat.
#
# So if local uat already holds a finished merge of this branch on top of the
# remote, that is the resolved merge the message asked for: keep it and carry
# on to the checks and the push instead of starting over.
RESUME=0
if git rev-parse -q --verify refs/heads/uat >/dev/null \
   && [ "$(git rev-parse uat)" != "$(git rev-parse origin/uat)" ] \
   && git merge-base --is-ancestor origin/uat uat \
   && git merge-base --is-ancestor "$BRANCH" uat \
   && [ -z "$(git ls-files -u)" ]; then
  RESUME=1
fi

if [ "$RESUME" = "1" ]; then
  git checkout -q uat || { echo "uat-roll: cannot check out uat." >&2; exit 1; }
  echo "[uat-roll] resuming the merge you resolved on local uat"
else
git checkout -q -B uat origin/uat || { echo "uat-roll: cannot check out uat." >&2; exit 1; }

if ! git merge --no-edit -q "$BRANCH"; then
  # Only the stamped files may be resolved automatically.
  REAL="$(resolve_stamp_conflicts)"
  if [ -n "$REAL" ]; then
    echo "" >&2
    echo "uat-roll: STOPPED. Real conflicts between two sessions:" >&2
    echo "$REAL" | sed 's/^/    /' >&2
    echo "" >&2
    echo "  The version stamps are already resolved; only the files above are left." >&2
    echo "  Fix those, git add them, git commit, then run this again: it picks up" >&2
    echo "  your resolved merge and carries on. Do not force-push." >&2
    exit 1
  fi
  git commit -q --no-edit || { echo "uat-roll: merge commit failed." >&2; exit 1; }
fi
fi

# ── NOTHING UAT HAD MAY VANISH (scripts/lib/uat-drop-guard.sh) ───────────
# A human resolving a real conflict by rewriting lines only uat had will trip
# this, on purpose: it prints exactly what would be lost. When that loss is
# the intent, UAT_ROLL_ALLOW_DROP=1 lets it through.
if [ "${UAT_ROLL_ALLOW_DROP:-0}" != "1" ]; then
  LOST="$(uat_lost_lines origin/uat "$BRANCH" HEAD)"
  if [ -n "$LOST" ]; then
    echo "" >&2
    echo "uat-roll: STOPPED. This roll would delete code that is live on UAT:" >&2
    printf '%s\n' "$LOST" >&2
    echo "" >&2
    echo "  Nothing was pushed. If losing these lines is deliberate, re-run with" >&2
    echo "  UAT_ROLL_ALLOW_DROP=1. Otherwise the merge ate them: resolve by hand." >&2
    restore; exit 1
  fi
fi

# ── TWO FILES, ONE MIGRATION VERSION (2026-09-26) ──────────────────────────
# uat is where two sessions' migrations first meet, and no PR check runs on
# it, so this is the first place a shared version number can be seen. Two
# files with one version fail the second deploy with a unique violation
# (20261038 was taken twice on uat the day this was added). Stop before the
# push and name them; renaming one is the fix.
DUPES="$(ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename | sed 's/_.*//' | sort | uniq -d)"
if [ -n "$DUPES" ]; then
  echo "" >&2
  echo "uat-roll: STOPPED. Two migrations share a version number:" >&2
  for v in $DUPES; do ls supabase/migrations/${v}_*.sql | sed 's/^/    /' >&2; done
  echo "  Nothing was pushed. Give the one from this branch the next free number." >&2
  restore; exit 1
fi

# The deploy commit must NOT carry the skip token, or Cloudflare skips the
# build and uat silently stays on the old code (CLAUDE.md 14.1).
git commit -q --allow-empty -m "UAT deploy"

# No --force. A stale push is REJECTED rather than clobbering, which is the
# whole point; the pre-push guard checks containment on top of that.
if git push -q origin uat; then
  echo "[uat-roll] rolled uat to $BRANCH (Cloudflare stamps the version as it builds)"
  restore
else
  echo "" >&2
  echo "uat-roll: push rejected. Someone rolled while this ran." >&2
  echo "  Run this again; the merge will pick up their work." >&2
  restore; exit 1
fi
