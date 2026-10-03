#!/usr/bin/env bash
# ── A MIGRATION ALREADY LIVE FROM A BRANCH IS NOT A REASON TO STOP MAIN ─────
#
# CLAUDE.md 14.1.2 lets a branch push its migrations to the one shared
# project before it merges (deploy-functions.yml, workflow_dispatch). The
# next deploy from main then finds versions on the database that main has no
# file for, and `supabase db push` refuses to run at all: on 2026-10-01 it
# held #145's edge functions back until #143 merged.
#
# Those versions are already applied, so db push will not run them again; it
# only needs their files present to agree on history. This finds each one on
# whichever branch carries it and drops the file into the checkout for this
# run. Nothing is committed and nothing new is applied.
#
#   supabase migration list | bash scripts/ci/live-migrations-from-branches.sh
#
# A version no branch carries is left alone, so db push still stops on it the
# way it always did: that is a database somebody changed by hand.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

# `supabase migration list` prints "Local | Remote | Time" rows. A row with a
# remote version and no local one is the case this handles.
#
# TWO SOURCES, BECAUSE THE TABLE'S SHAPE IS NOT OURS (2026-10-02). On #154's
# merge this read the table, found nothing ("No live-only migrations"), and
# db push refused main's deploy over 20261064 anyway. The table's columns
# may be split by "|" or by "│" (U+2502), so both are read; and db push's own
# refusal names the versions in a fixed sentence ("migration repair --status
# reverted 20261064 ..."), which the workflow feeds in too (a dry run), so
# the answer no longer depends on how a table is drawn.
live_only() {
  local input; input="$(cat)"
  {
    printf '%s\n' "$input" | sed 's/│/|/g' | awk -F'|' 'NF >= 3 {
      l = $1; r = $2; gsub(/[[:space:]]/, "", l); gsub(/[[:space:]]/, "", r);
      if (l == "" && r ~ /^[0-9]+$/) print r
    }'
    printf '%s\n' "$input" | grep -oE 'repair --status reverted( [0-9]{8,})+' | grep -oE '[0-9]{8,}'
  } | sort -u
  # What came in, for the log, so a format nobody expected is visible the
  # first time instead of the third.
  printf '%s\n' "$input" | grep -E '[0-9]{8,}' | head -40 | sed 's/^/  in: /' >&2
}

VERSIONS="$(live_only)"
[ -z "$VERSIONS" ] && { echo "No live-only migrations."; exit 0; }
[ "${1:-}" = "--list" ] && { printf '%s\n' "$VERSIONS"; exit 0; }

git fetch -q --depth=1 origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null || true
for v in $VERSIONS; do
  found=""
  for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/); do
    path="$(git ls-tree --name-only "$b" supabase/migrations/ 2>/dev/null | grep "/${v}_" | head -1)"
    [ -n "$path" ] || continue
    git show "$b:$path" > "$path" && found="$b:$path" && break
  done
  if [ -n "$found" ]; then
    echo "::warning::Migration $v is live but not on this branch yet; using $found for history only."
  else
    echo "::error::Migration $v is live on the database and on no branch. Someone changed the database by hand."
  fi
done
exit 0
