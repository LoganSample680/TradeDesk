#!/usr/bin/env bash
# ── RUN THE TESTS THAT TEST WHAT CHANGED (owner 2026-10-02) ─────────────────
#
# "I really need tests to be smart so we only run tests that have something
# to do with what code was changed, not everything."
#
# The plan job already scoped PRs, and every PR still ran all ~8,900 tests.
# The reason: js/cloud.js is a high-impact file (a change to it really can
# break anything), and the pre-commit hook stamps the version into js/cloud.js
# on EVERY commit. So every PR "changed cloud.js" and got the full suite.
#
# Now a file whose only change is the version stamp does not count as
# changed, and a changed js file pulls in the specs that name the functions
# it changed, not just the specs whose filename happens to match. That is the
# §5.2.1 local rule ("grep for the function you changed and run every file it
# names"), done by the planner instead of remembered.
#
#   bash scripts/ci/test-scope.sh <base> <head>
#
# Prints exactly one of:
#   full                      run everything
#   skip                      nothing the offline suite covers changed
#   <spec> <spec> ...         run these files
set -uo pipefail
BASE="$1"; HEAD="${2:-HEAD}"
SPECS_DIR="${TEST_SCOPE_SPECS:-tests}"

# Shared files where a real change can break any test.
HIGH='^(tests/helpers\.js|js/cloud\.js|js/utils\.js|js/data\.js|index\.html|playwright\.config\.js)$'
# Past this many files a scoped run is most of the suite anyway.
MAX_FILES="${TEST_SCOPE_MAX:-80}"
# A name found in more specs than this says nothing about which ones matter
# ("render", "save"); it is dropped rather than pulling in half the suite.
MAX_PER_NAME="${TEST_SCOPE_MAX_PER_NAME:-25}"

# True when the file's diff touches nothing but the version stamp lines the
# hook rewrites (scripts/bump-version.js) or the sitemap lastmod stamps.
stamp_only() {
  local body
  body="$(git diff -U0 "$BASE" "$HEAD" -- "$1" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ')"
  [ -n "$body" ] || return 0
  ! printf '%s\n' "$body" | grep -vqE "APP_VERSION=|const CACHE = 'tradedesk-|\"version\":|<lastmod>"
}

CHANGED=""
for f in $(git diff --name-only "$BASE" "$HEAD"); do
  case "$f" in
    version.json|sw.js|js/cloud.js|sitemap.xml) stamp_only "$f" && continue ;;
  esac
  CHANGED="$CHANGED$f"$'\n'
done

if printf '%s' "$CHANGED" | grep -qE "$HIGH"; then echo full; exit 0; fi

PICK=""
add() { [ -f "$1" ] && PICK="$PICK$1"$'\n'; }

# Specs that changed.
for f in $(printf '%s' "$CHANGED" | grep -E "^$SPECS_DIR/[^/]+\.spec\.js$"); do add "$f"; done

for f in $(printf '%s' "$CHANGED" | grep -E '^(js/.*\.js|[^/]+\.html)$'); do
  # Specs named after the file.
  base="$(basename "$f" | sed -E 's/\.(js|html)$//')"
  for s in "$SPECS_DIR"/*"$base"*.spec.js; do add "$s"; done
  # Specs that name a function this diff defines or touches. The hunk header
  # carries the enclosing top-level function, the changed lines carry any
  # definition that was added, removed or edited.
  names="$(git diff -U0 "$BASE" "$HEAD" -- "$f" | perl -ne '
    if (/^@@[^@]*@@\s*(.*)$/) { $_ = $1 } elsif (!/^[+-]/ || /^(\+\+\+|---) /) { next }
    while (/\bfunction\s+([A-Za-z_\$][\w\$]{3,})/g) { print "$1\n" }
    while (/\b(?:const|let|var)\s+([A-Za-z_\$][\w\$]{3,})\s*=\s*(?:async\s*)?(?:function\b|\()/g) { print "$1\n" }
    while (/\bwindow\.([A-Za-z_\$][\w\$]{3,})\s*=/g) { print "$1\n" }
  ' | sort -u)"
  for n in $names; do
    hits="$(grep -lwF -- "$n" "$SPECS_DIR"/*.spec.js 2>/dev/null)"
    [ -z "$hits" ] && continue
    [ "$(printf '%s\n' "$hits" | wc -l)" -gt "$MAX_PER_NAME" ] && continue
    PICK="$PICK$hits"$'\n'
  done
done

PICK="$(printf '%s' "$PICK" | sed '/^$/d' | sort -u)"
if [ -z "$PICK" ]; then echo skip; exit 0; fi
if [ "$(printf '%s\n' "$PICK" | wc -l)" -gt "$MAX_FILES" ]; then echo full; exit 0; fi
printf '%s\n' "$PICK" | tr '\n' ' ' | sed 's/ $/\n/'
