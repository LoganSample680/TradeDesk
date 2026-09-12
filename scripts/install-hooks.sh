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
