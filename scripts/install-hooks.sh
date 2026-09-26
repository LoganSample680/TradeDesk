#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOK_FILE="$HOOKS_DIR/pre-commit"

mkdir -p "$HOOKS_DIR"

cat > "$HOOK_FILE" << 'HOOK'
#!/usr/bin/env bash
ROOT="$(git rev-parse --show-toplevel)"
node "$ROOT/scripts/bump-version.js"
node "$ROOT/scripts/sitemap-lastmod.js"
HOOK

chmod +x "$HOOK_FILE"

echo "[install-hooks] pre-commit hook installed at $HOOK_FILE"

# ── AND THE ONE THAT STOPS TWO SESSIONS DELETING EACH OTHER ────────────────
# The roll to uat used to reset the branch and force-push, which throws away
# whatever another session put there. --force-with-lease does not catch it:
# the lease only asks whether uat moved since the last fetch, so a session
# that fetched a moment ago passes it while still dropping thirty commits.
# scripts/uat-guard.sh checks CONTAINMENT instead, and git hands a pre-push
# hook exactly the two shas it needs.
PUSH_HOOK="$HOOKS_DIR/pre-push"
cat > "$PUSH_HOOK" << 'HOOK'
#!/usr/bin/env bash
ROOT="$(git rev-parse --show-toplevel)"
# stdin: <local ref> <local sha> <remote ref> <remote sha>, one line per ref.
while read -r _localref localsha remoteref remotesha; do
  case "$remoteref" in
    refs/heads/uat) bash "$ROOT/scripts/uat-guard.sh" "$localsha" "$remotesha" || exit 1 ;;
  esac
done
exit 0
HOOK
chmod +x "$PUSH_HOOK"
echo "[install-hooks] pre-push uat guard installed at $PUSH_HOOK"
