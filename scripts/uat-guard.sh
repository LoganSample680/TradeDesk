#!/usr/bin/env bash
# ── UAT IS NEVER ALLOWED TO LOSE WORK (owner 2026-09-14) ────────────────────
#
# "I need a better flow to run multiple sessions and ensure nothing gets fucked
# up."
#
# The roll used to be `git checkout -B uat <dev>` + `push --force-with-lease`,
# which RESETS uat to one branch. With two sessions running, that silently
# deletes whatever the other one put there. It happened: uat carried a fix from
# another session that this branch did not have, and only a merge-base check
# before pushing caught it.
#
# --force-with-lease does not help. It only asks "has uat moved since I last
# fetched", and a session that fetched five seconds ago passes the lease while
# still throwing away 30 commits.
#
# So the check is containment, not freshness: whatever uat points at now must
# be an ANCESTOR of what is about to replace it. A merge-based roll satisfies
# that by construction; a reset does not.
#
# Exits 0 when the push is safe, 1 with an explanation when it is not.
set -uo pipefail
LOCAL_SHA="${1:-}"
REMOTE_SHA="${2:-}"

# All-zeroes means the branch is being created or deleted. Nothing to lose.
case "$REMOTE_SHA" in ''|*[!0]*) : ;; *) exit 0 ;; esac
[ -z "$LOCAL_SHA" ] && exit 0
case "$LOCAL_SHA" in *[!0]*) : ;; *) exit 0 ;; esac

# The remote may hold commits this clone has never fetched; ask for them by sha
# rather than trusting whatever happens to be in refs/remotes.
if ! git cat-file -e "${REMOTE_SHA}^{commit}" 2>/dev/null; then
  git fetch -q origin uat 2>/dev/null || true
fi
if ! git cat-file -e "${REMOTE_SHA}^{commit}" 2>/dev/null; then
  echo "uat-guard: cannot read the current uat commit ($REMOTE_SHA)." >&2
  echo "  Run: git fetch origin uat   then push again." >&2
  exit 1
fi

if git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL_SHA"; then
  exit 0
fi

LOST=$(git rev-list --count "${LOCAL_SHA}..${REMOTE_SHA}" 2>/dev/null || echo "?")
echo "" >&2
echo "uat-guard: REFUSED. This push drops $LOST commit(s) already on uat." >&2
echo "" >&2
git log --oneline -8 "${LOCAL_SHA}..${REMOTE_SHA}" 2>/dev/null | sed 's/^/    /' >&2
echo "" >&2
echo "  Another session almost certainly put those there." >&2
echo "" >&2
echo "  Roll by MERGING, which cannot lose them:" >&2
echo "    git checkout uat && git merge <your-branch>" >&2
echo "    git commit --allow-empty -m 'UAT deploy'" >&2
echo "    git push origin uat" >&2
echo "" >&2
exit 1
