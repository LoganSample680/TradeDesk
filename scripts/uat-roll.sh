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
# EXACTLY what scripts/bump-version.js rewrites, and it is three files, not
# two. js/cloud.js carries `const APP_VERSION=` and the hook stamps it on every
# commit on both sides, so it conflicts on every roll just like the other two.
# Missing it here meant this script stopped on a false conflict the very first
# time it ran for real (owner 2026-09-14, rolling the day's work).
STAMPED="version.json sw.js js/cloud.js"

if [ "$BRANCH" = "uat" ]; then
  echo "uat-roll: name the branch to roll, not uat itself." >&2; exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "uat-roll: working tree is dirty. Commit or stash first." >&2; exit 1
fi

# True when every conflicted hunk in the file is only the version stamp.
# Reads the conflict markers rather than trusting the filename, so a genuine
# change to js/cloud.js can never be silently resolved away in favour of one
# side.
stamp_only() {
  awk '
    /^<<<<<<< /   { inc = 1; next }
    /^=======$/   { next }
    /^>>>>>>> /   { inc = 0; next }
    inc {
      if ($0 ~ /^[[:space:]]*$/) next
      if ($0 ~ /APP_VERSION/) next
      if ($0 ~ /CACHE/) next
      if ($0 ~ /"version"/) next
      bad = 1
    }
    END { exit bad ? 1 : 0 }
  ' "$1"
}

# Resolve a version stamp INSIDE the conflict markers only, taking the incoming
# side of each hunk. This used to be `git checkout --theirs`, which replaces the
# WHOLE file with the branch's copy. stamp_only proves the CONFLICTS are only the
# version line, but git has already auto-merged every other change into the
# file by then, and --theirs threw those away with it. js/cloud.js is shared by
# every session, so any roll where uat had changed cloud.js elsewhere silently
# deleted that work. It nearly shipped deleting the Tim session's sign-out
# privacy fix (2026-09-22), caught only because the diff was read.
#
# Only ever called on a file stamp_only has cleared. On a file holding a real
# conflict it would quietly pick a side of the real code, which is the whole
# thing this script exists to never do.
resolve_stamp() {
  f="$1"
  grep -q '^<<<<<<< ' "$f" 2>/dev/null || { git add -- "$f" 2>/dev/null; return 0; }
  perl -0pi -e 's/^<<<<<<< [^\n]*\n.*?^=======\n(.*?)^>>>>>>> [^\n]*\n/$1/gms' "$f"
  if grep -q '^<<<<<<< \|^>>>>>>> ' "$f"; then
    echo "uat-roll: could not resolve the stamp in $f. Stopping." >&2; return 1
  fi
  git add -- "$f" 2>/dev/null || true
}

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
  UNMERGED="$(git diff --name-only --diff-filter=U)"
  REAL=""
  for f in $UNMERGED; do
    case " $STAMPED " in
      *" $f "*)
        # js/cloud.js is a REAL code file that happens to carry the stamp, so it
        # is not resolved on its name alone. Every conflicted hunk in it has to
        # be nothing but the version line; anything else is two sessions editing
        # the same code and belongs to a person.
        if stamp_only "$f"; then resolve_stamp "$f" || exit 1; continue; fi
        ;;
    esac
    REAL="$REAL$f"$'\n'
  done
  REAL="$(printf '%s' "$REAL" | sed '/^$/d')"
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

# ── NOTHING UAT HAD MAY VANISH (owner 2026-09-23: "I bet it has") ──────────
# It had. An audit of every roll found the --theirs bug above deleting code
# twice: the Tim session's sign-out privacy fix, and the call that starts the
# county property sync. Neither produced a conflict or a message. Fixing the
# resolver closes that one door; this closes the whole class, whatever the
# next cause turns out to be.
#
# The rule is simple and it is exact: a line that uat ADDED since the two
# branches last met cannot quietly disappear in a merge. The incoming branch
# never had that line, so it cannot have meant to delete it. If one is gone,
# something ate it, and the roll stops before the push rather than after.
#
# A human resolving a real conflict by rewriting uat's lines will trip this,
# on purpose: it prints exactly what would be lost. When that loss is the
# intent, UAT_ROLL_ALLOW_DROP=1 lets it through.
BASE="$(git merge-base origin/uat "$BRANCH" 2>/dev/null)"
if [ -n "$BASE" ] && [ "${UAT_ROLL_ALLOW_DROP:-0}" != "1" ]; then
  LOST=""
  for f in $(git diff --name-only "$BASE" origin/uat -- '*.js' '*.html' '*.css' '*.sql' '*.ts' 2>/dev/null); do
    git cat-file -e "HEAD:$f" 2>/dev/null || continue
    gone="$(perl -e '
      my ($base,$uat,$now)=@ARGV; my (%b,%n);
      open(B,"-|","git","show","$base") and do { while(<B>){$b{$_}=1} close B };
      open(N,"-|","git","show","$now")  and do { while(<N>){$n{$_}=1} close N };
      open(U,"-|","git","show","$uat") or exit;
      while(<U>){ next if /^\s*$/; next if /APP_VERSION|CACHE|"version"/;
        print "      - $_" if !$b{$_} && !$n{$_}; }
    ' "$BASE:$f" "origin/uat:$f" "HEAD:$f" 2>/dev/null | head -6)"
    [ -n "$gone" ] && LOST="$LOST    $f"$'\n'"$gone"$'\n'
  done
  if [ -n "$LOST" ]; then
    echo "" >&2
    echo "uat-roll: STOPPED. This roll would delete code that is live on UAT:" >&2
    printf '%s' "$LOST" >&2
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
  echo "[uat-roll] rolled uat to $BRANCH ($(node -p "require('./version.json').version" 2>/dev/null || echo '?'))"
  restore
else
  echo "" >&2
  echo "uat-roll: push rejected. Someone rolled while this ran." >&2
  echo "  Run this again; the merge will pick up their work." >&2
  restore; exit 1
fi
