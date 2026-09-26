#!/usr/bin/env bash
# ── EVERY BRANCH STARTS FROM MAIN (owner 2026-09-26) ───────────────────────
# Runs at the start of every Claude Code session (.claude/settings.json,
# SessionStart). Prints a warning, which lands in the session's context, when
# the checked-out branch carries commits that only exist on uat.
#
# Why: a session whose branch was cut from uat drags every other session's
# half-tested work into its PR. PR #98 opened with 400 commits and a
# duplicate migration version for exactly that reason, and nothing said so
# until the checks went red. uat is where features are SHOWN (TestFlight
# points at it); main is where they are BUILT.
#
# Silent when the branch is clean, when there is no network, or when git is
# not ready. It never blocks a session, it only says what is wrong.
cd "$(dirname "$0")/.." 2>/dev/null || exit 0
branch="$(git branch --show-current 2>/dev/null)"
[ -z "$branch" ] && exit 0
[ "$branch" = "uat" ] && {
  echo "BRANCH CHECK: this session is ON uat. Never develop on uat (CLAUDE.md 3.1). Branch from origin/main."
  exit 0
}
git fetch -q origin main 2>/dev/null || exit 0
# The two commit shapes that only ever exist on uat: the roll's deploy commit
# and the roll's merge commit (scripts/uat-roll.sh writes both).
leaked="$(git log --format='%h %s' origin/main..HEAD 2>/dev/null \
  | grep -E "^[0-9a-f]+ (UAT deploy$|Merge (remote-tracking )?branch '.*' into uat$)" | head -3)"
if [ -n "$leaked" ]; then
  n="$(git rev-list --count origin/main..HEAD 2>/dev/null)"
  echo "BRANCH CHECK: '$branch' was started from uat, not main. It carries $n commits"
  echo "that are not on main, including uat roll commits:"
  echo "$leaked" | sed 's/^/  /'
  echo "Any PR from this branch will ship other sessions' unfinished work. Before"
  echo "building anything, tell the owner and restart the branch from origin/main"
  echo "(CLAUDE.md 3.1, 'Every branch starts from main')."
fi
exit 0
