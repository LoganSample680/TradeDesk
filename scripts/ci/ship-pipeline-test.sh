#!/usr/bin/env bash
# ── THE SHIP PIPELINE, PROVEN ON THROWAWAY REPOS (2026-10-01) ──────────────
# Builds small git histories in a temp dir and runs the real scripts against
# them: the stamp resolver (scripts/lib/stamp-merge.sh), the roll's drop check
# (scripts/lib/uat-drop-guard.sh), PR sync (scripts/pr-sync.sh) and the
# live-migration reader (scripts/ci/live-migrations-from-branches.sh). Each
# case says what the owner would have seen go wrong.
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAIL=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; FAIL=1; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

new_repo() {
  rm -rf "$T/origin.git" "$T/w"; git init -q --bare -b main "$T/origin.git"
  git clone -q "$T/origin.git" "$T/w" 2>/dev/null; cd "$T/w" || exit 1
  git checkout -q -b main
  mkdir -p scripts/lib scripts/ci js supabase/migrations
  cp "$SRC/scripts/lib/"*.sh scripts/lib/; cp "$SRC/scripts/pr-sync.sh" "$SRC/scripts/bump-version.js" scripts/
  echo '{"version":"10.01.26.1"}' > version.json
  echo "const CACHE = 'tradedesk-10.01.26.1';" > sw.js
  printf "const APP_VERSION='10.01.26.1';\n// 1\n// 2\n// 3\n// 4\nfunction shared(){return 1;}\n" > js/cloud.js
  printf 'a\nb\nc\n' > js/app.js
  git add -A; git commit -qm M0; git push -q origin main
}
stamp() { # set all three stamps to $1 and commit with message $2
  echo "{\"version\":\"$1\"}" > version.json
  sed -i "s/tradedesk-[^']*/tradedesk-$1/" sw.js
  sed -i "s/APP_VERSION='[^']*'/APP_VERSION='$1'/" js/cloud.js
  git add -A; git commit -qm "$2"
}

echo "stamp resolver"
new_repo
git checkout -q -b feat; echo d >> js/app.js; stamp 10.01.26.5 "feat work"
git checkout -q main; sed -i 's/return 1/return 2/' js/cloud.js; stamp 10.01.26.7 "main work"
git checkout -q feat
. scripts/lib/stamp-merge.sh
git merge -q main >/dev/null 2>&1
real="$(resolve_stamp_conflicts)"; rc=$?
[ "$rc" = 0 ] && [ -z "$real" ] && ok "a stamp-only clash resolves" || bad "a stamp-only clash resolves (rc=$rc real=$real)"
grep -q 'return 2' js/cloud.js && ok "main's real change to cloud.js survives the stamp fix" || bad "main's real change to cloud.js survives the stamp fix"
grep -q "10.01.26.7" version.json && ok "the incoming stamp wins" || bad "the incoming stamp wins"
git commit -qm merged
git checkout -q main; sed -i 's/^a$/A-main/' js/app.js; stamp 10.01.26.8 "main edits app"
git checkout -q feat; sed -i 's/^a$/A-feat/' js/app.js; git commit -qam "feat edits app"
git merge -q main >/dev/null 2>&1
real="$(resolve_stamp_conflicts)"; rc=$?
[ "$rc" = 1 ] && [ "$real" = "js/app.js" ] && ok "a real clash is named, not resolved" || bad "a real clash is named, not resolved (rc=$rc real=$real)"
git merge --abort

echo "drop check"
new_repo
git checkout -q -b x main; printf 'L1\nL2\nL3\n' > supabase/migrations/p.sql; git add -A; git commit -qm X1
git checkout -q -b g main; echo G > js/g.js; git add -A; git commit -qm G1
git checkout -q -b y main; echo Y-line > js/y.js; git add -A; git commit -qm Y1
git checkout -q -b uat main; git merge -q --no-edit x; git merge -q --no-edit g; git merge -q --no-edit y
git checkout -q -b z main; git merge -q --no-edit g; git merge -q --no-edit x
sed -i 's/^L2$/L2-rewritten/' supabase/migrations/p.sql; git commit -qam Z1
nb=$(git merge-base --all uat z | wc -l)
[ "$nb" -ge 2 ] && ok "the history has $nb equally good common ancestors (the 2026-10-01 shape)" || bad "test setup: expected 2+ merge bases, got $nb"
git checkout -q uat; git merge -q --no-edit z
. scripts/lib/uat-drop-guard.sh
lost="$(uat_lost_lines uat~1 z HEAD)"
[ -z "$lost" ] && ok "a branch rewriting lines it already had is not a drop" || bad "a branch rewriting lines it already had is not a drop: $lost"
git rm -q js/y.js 2>/dev/null; echo other > js/y.js; git add -A; git commit -q --amend --no-edit
lost="$(uat_lost_lines uat@{1}~1 z HEAD 2>/dev/null || true)"
[ -z "$lost" ] && lost="$(uat_lost_lines "$(git rev-parse HEAD^1)" z HEAD)"
printf '%s' "$lost" | grep -q 'Y-line' && ok "a line from a session the branch never saw is still caught" || bad "a line from a session the branch never saw is still caught: $lost"

echo "pr sync"
new_repo
git checkout -q -b claude/feat; echo e >> js/app.js; stamp 10.01.26.4 "feat"; git push -q origin claude/feat
git checkout -q main; sed -i 's/return 1/return 3/' js/cloud.js; stamp 10.01.26.9 "main moves"; git push -q origin main
bash scripts/pr-sync.sh claude/feat --push --only-if-conflicted >/dev/null 2>&1; rc=$?
git fetch -q origin
[ "$rc" = 0 ] && git merge-base --is-ancestor origin/main origin/claude/feat && ok "a stamp-only conflict is synced and pushed" || bad "a stamp-only conflict is synced and pushed (rc=$rc)"
git show origin/claude/feat:js/cloud.js | grep -q 'return 3' && ok "main's code is in the synced branch" || bad "main's code is in the synced branch"
v=$(git show origin/claude/feat:version.json); [ "$v" != '{"version":"10.01.26.9"}' ] && ok "the synced branch gets a fresh stamp ($v)" || bad "the synced branch gets a fresh stamp"
git show -s --format=%s origin/claude/feat | grep -q 'CF-Pages-Skip' && ok "the sync commit does not build a preview" || bad "the sync commit does not build a preview"
git checkout -q -B claude/two origin/main; sed -i 's/^b$/B-two/' js/app.js; git commit -qam two; git push -q origin claude/two
git checkout -q main; git pull -q origin main; sed -i 's/^b$/B-main/' js/app.js; stamp 10.01.26.10 "main edits b"; git push -q origin main
before=$(git rev-parse origin/claude/two)
bash scripts/pr-sync.sh claude/two --push >/dev/null 2>&1; rc=$?
git fetch -q origin
[ "$rc" = 2 ] && [ "$(git rev-parse origin/claude/two)" = "$before" ] && ok "a real conflict stops the sync and pushes nothing" || bad "a real conflict stops the sync and pushes nothing (rc=$rc)"
[ -z "$(git status --porcelain)" ] && ok "a stopped sync leaves the checkout clean" || bad "a stopped sync leaves the checkout clean"

echo "uat roll, end to end"
new_repo
mkdir -p "$T/tools/lib"; cp "$SRC/scripts/uat-roll.sh" "$T/tools/"; cp "$SRC/scripts/lib/"*.sh "$T/tools/lib/"
git checkout -q -b uat; echo U > js/u.js; stamp 10.01.26.3 "other session on uat"; git push -q origin uat
git checkout -q -b claude/r main; echo R > js/r.js; stamp 10.01.26.6 "this branch"; git push -q origin claude/r
bash "$T/tools/uat-roll.sh" claude/r >/dev/null 2>&1; rc=$?
git fetch -q origin
[ "$rc" = 0 ] && git merge-base --is-ancestor origin/claude/r origin/uat && ok "a roll with a stamp clash merges and pushes" || bad "a roll with a stamp clash merges and pushes (rc=$rc)"
git show origin/uat:js/u.js >/dev/null 2>&1 && ok "the other session's file is still on uat" || bad "the other session's file is still on uat"
[ "$(git show -s --format=%s origin/uat)" = "UAT deploy" ] && ok "the roll ends in a deploy commit that builds" || bad "the roll ends in a deploy commit that builds"

echo "test scope"
new_repo
mkdir -p tests
printf 'function shopWrap(){return 1;}\nfunction other(){return 2;}\n' > js/geo.js
printf "test('x', () => shopWrap());\n" > tests/e2e-wrap.spec.js
printf "test('y', () => other());\n" > tests/e2e-unrelated.spec.js
printf "test('z', () => 1);\n" > tests/e2e-geo.spec.js
for i in 1 2 3; do printf "test('g', () => other());\n" > tests/e2e-g$i.spec.js; done
git add -A; git commit -qm scope-base; B=$(git rev-parse HEAD)
scope() { TEST_SCOPE_MAX_PER_NAME=3 bash "$SRC/scripts/ci/test-scope.sh" "$B" HEAD; }
stamp 10.01.26.2 "a commit that only bumps the stamp"
[ "$(scope)" = "skip" ] && ok "a version stamp in cloud.js alone is not a change (was: the full suite on every PR)" || bad "stamp-only scope: $(scope)"
sed -i 's/return 1;/return 7;/' js/geo.js; git commit -qam "change shopWrap"
got="$(scope)"
echo "$got" | grep -q 'tests/e2e-wrap.spec.js' && ok "the spec that calls the changed function runs" || bad "function spec missing: $got"
echo "$got" | grep -q 'tests/e2e-geo.spec.js' && ok "the spec named after the file runs" || bad "filename spec missing: $got"
echo "$got" | grep -q 'e2e-unrelated' && bad "a spec for an untouched function was pulled in: $got" || ok "a spec for an untouched function stays out"
sed -i 's/return 2;/return 8;/' js/geo.js; git commit -qam "change other, named in 4 specs"
echo "$(scope)" | grep -q 'e2e-g1' && bad "a name in more specs than the limit pulled them all in" || ok "a name in too many specs is ignored, not run everywhere"
echo "// real" >> js/cloud.js; git commit -qam "real cloud change"
[ "$(scope)" = "full" ] && ok "a real change to a shared file still runs everything" || bad "real cloud change scope: $(scope)"

echo "live migrations"
got=$(printf '   Local | Remote | Time\n  ---|---|---\n   20261060 | 20261060 | x\n            | 20261061 | x\n   20261062 |          | x\n' \
  | bash "$SRC/scripts/ci/live-migrations-from-branches.sh" --list | tr '\n' ' ')
[ "$got" = "20261061 " ] && ok "only the version live on the database and missing here is picked" || bad "live-only versions: got '$got'"

[ "$FAIL" = 0 ] && echo "ship pipeline: all checks pass" || { echo "ship pipeline: FAILED"; exit 1; }
