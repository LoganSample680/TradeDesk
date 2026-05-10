#!/bin/bash
# Usage: ./push.sh "your commit message"
# Auto-computes MM.DD.YY.N version, updates index.html + version.json, commits, pushes.

set -e

MSG="${1:-update}"

# Date in Central time
DATE=$(TZ=America/Chicago date +'%m.%d.%y')
TODAY=$(TZ=America/Chicago date +'%Y-%m-%d')

# Count real (non-auto) commits to main today (after midnight Central)
git fetch origin main --quiet 2>/dev/null || true
N=$(git log --oneline --after="${TODAY}T00:00:00-06:00" origin/main \
    | grep -v '\[skip ci\]' \
    | wc -l | tr -d ' ')

# This commit will be N+1 (it hasn't landed on origin/main yet)
N=$((N + 1))
[ "$N" -lt 1 ] && N=1

VERSION="${DATE}.${N}"
echo "→ Version: v${VERSION}"

# Update index.html
sed -i "s/const APP_VERSION='[0-9][0-9]\.[0-9][0-9]\.[0-9][0-9]\.[0-9]*/const APP_VERSION='${VERSION}/g" index.html

# Update version.json
printf '{"version":"%s"}\n' "${VERSION}" > version.json

# Stage, commit, push
git add index.html version.json
git add -u
git diff --staged --quiet && echo "Nothing to commit" && exit 0
git commit -m "${MSG}

v${VERSION} — https://claude.ai/code/session_01YCddcL4939n7uTGe7mwdej"
git push -u origin main

echo "✓ Pushed v${VERSION}"
