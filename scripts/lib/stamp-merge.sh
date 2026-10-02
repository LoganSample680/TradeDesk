# shellcheck shell=bash
# ── THE VERSION STAMP, RESOLVED IN ONE PLACE (owner 2026-10-01) ─────────────
#
# "how do we write in multiple sessions but ensure everything makes it to main
# and everything rolls UAT with a version bump."
#
# The pre-commit hook used to rewrite the same three lines on every branch, so
# ANY two branches conflicted on them: every roll to uat and every PR that main
# moved under. Since 2026-10-02 Cloudflare stamps the version as it builds
# (scripts/stamp-version.js) and the committed lines are a placeholder that
# never changes, so new branches do not clash here at all. A branch cut before
# that still does, once, and its content never matters because the build
# overwrites it, so it is resolved by machine. Everything else in those files,
# and every other file, is still a person's call.
#
# Sourced by scripts/uat-roll.sh (merging a branch into uat) and
# scripts/pr-sync.sh (merging main into a PR branch). One resolver, two users,
# so a fix to one is a fix to both.

# EXACTLY what scripts/stamp-version.js writes.
STAMPED="version.json sw.js js/cloud.js"

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
# file by then, and --theirs threw those away with it. It nearly shipped
# deleting the Tim session's sign-out privacy fix (2026-09-22).
#
# Only ever called on a file stamp_only has cleared.
resolve_stamp() {
  f="$1"
  grep -q '^<<<<<<< ' "$f" 2>/dev/null || { git add -- "$f" 2>/dev/null; return 0; }
  perl -0pi -e 's/^<<<<<<< [^\n]*\n.*?^=======\n(.*?)^>>>>>>> [^\n]*\n/$1/gms' "$f"
  if grep -q '^<<<<<<< \|^>>>>>>> ' "$f"; then
    echo "stamp-merge: could not resolve the stamp in $f." >&2; return 1
  fi
  git add -- "$f" 2>/dev/null || true
}

# After a `git merge` that stopped on conflicts: resolve every file whose only
# conflict is the stamp, and print the files that hold a REAL conflict, one per
# line. Returns 1 when there is at least one real conflict.
resolve_stamp_conflicts() {
  local f real=""
  for f in $(git diff --name-only --diff-filter=U); do
    case " $STAMPED " in
      *" $f "*)
        if stamp_only "$f"; then resolve_stamp "$f" || return 1; continue; fi
        ;;
    esac
    real="$real$f"$'\n'
  done
  real="$(printf '%s' "$real" | sed '/^$/d')"
  [ -z "$real" ] && return 0
  printf '%s\n' "$real"
  return 1
}
