#!/usr/bin/env bash
# ── Install the county assessor drip on this machine ────────────────────────
#
# Fills a county's parcel records in the background at human pace, so a
# contractor's property lookup is an instant SQL join rather than a live request
# to a county server.
#
# WHAT THIS IS NOT: the Zillow proxy that used to live here. That thing was in
# the LIVE path, so the feature died whenever this box did. This is a pre-warm.
# Turn this machine off and every lookup still works; it just asks the county on
# first touch instead of already knowing. Nothing in the app waits on this host.
#
# Usage:
#   sudo bash scripts/setup-county-drip.sh ks-shawnee
#
set -euo pipefail

COUNTY="${1:-}"
REPO_DIR="${REPO_DIR:-/opt/tradedesk}"
ENV_DIR=/etc/tradedesk
ENV_FILE="$ENV_DIR/county-drip.env"

if [ -z "$COUNTY" ]; then
  echo "usage: sudo bash scripts/setup-county-drip.sh <county-config>" >&2
  echo "available configs:" >&2
  ls "$(dirname "$0")/counties" 2>/dev/null | sed 's/\.json$//' | sed 's/^/  /' >&2
  exit 1
fi

if [ ! -f "$(dirname "$0")/counties/${COUNTY}.json" ]; then
  echo "ERROR: no config at scripts/counties/${COUNTY}.json" >&2
  exit 1
fi

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run with sudo (it installs systemd units)" >&2
  exit 1
fi

command -v node >/dev/null || { echo "ERROR: node is not installed" >&2; exit 1; }

echo "[county-drip] repo dir : $REPO_DIR"
echo "[county-drip] county   : $COUNTY"

if [ ! -d "$REPO_DIR" ]; then
  echo "ERROR: $REPO_DIR does not exist. Clone the repo there, or set REPO_DIR=..." >&2
  exit 1
fi

# ── Credentials ─────────────────────────────────────────────────────────────
# Same two secrets the GitHub workflows already use, so there is nothing new to
# create. The file is root-only: SUPABASE_ACCESS_TOKEN can mint a service key.
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# Fill these in, then: sudo systemctl start county-drip.service
# Same values as the SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN repo secrets.
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
COUNTY=$COUNTY
# Shared with the live lookup route through td_county_asks: both draw on ONE
# budget, so this is the whole daily ceiling for this county, not just the drip's.
COUNTY_DAILY_CAP=1000
EOF
  chmod 600 "$ENV_FILE"
  echo "[county-drip] wrote $ENV_FILE (fill in the two Supabase values)"
else
  # Keep existing credentials, just point it at the county being installed.
  sed -i "s/^COUNTY=.*/COUNTY=$COUNTY/" "$ENV_FILE" || echo "COUNTY=$COUNTY" >> "$ENV_FILE"
  grep -q '^COUNTY=' "$ENV_FILE" || echo "COUNTY=$COUNTY" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[county-drip] kept existing $ENV_FILE, set COUNTY=$COUNTY"
fi

# ── Units ───────────────────────────────────────────────────────────────────
install -m 644 "$(dirname "$0")/county-drip.service" /etc/systemd/system/county-drip.service
install -m 644 "$(dirname "$0")/county-drip.timer"   /etc/systemd/system/county-drip.timer

# WorkingDirectory is baked as /opt/tradedesk; respect REPO_DIR if it differs.
if [ "$REPO_DIR" != "/opt/tradedesk" ]; then
  sed -i "s#^WorkingDirectory=.*#WorkingDirectory=$REPO_DIR#" /etc/systemd/system/county-drip.service
  sed -i "s#^ReadOnlyPaths=.*#ReadOnlyPaths=$REPO_DIR#"       /etc/systemd/system/county-drip.service
fi

systemctl daemon-reload
systemctl enable --now county-drip.timer

echo
echo "[county-drip] installed and enabled."
echo
if ! grep -q '^SUPABASE_ACCESS_TOKEN=.\+' "$ENV_FILE"; then
  echo "  NEXT: put the two Supabase values in $ENV_FILE, then:"
  echo "        sudo systemctl restart county-drip.timer"
  echo
fi
cat <<'EOF'
  Pace: a visit every 30 minutes (randomized), 07:00-21:00 local only, each
  visit at most 25 minutes, gaps of 12 to 60 seconds with an occasional few
  minute break. Roughly 1,000 addresses a day, so a 77,000 parcel county lands
  in about eleven weeks with no hour that looks unusual from the county's side.

  Watch it:    journalctl -u county-drip.service -f
  Next run:    systemctl list-timers county-drip.timer
  One visit:   sudo systemctl start county-drip.service
  Stop it:     sudo systemctl disable --now county-drip.timer

  Progress is in Supabase, not here: td_county_asks has one row per address
  ever asked, and nothing is asked twice. Stopping and restarting this timer
  loses no work and re-asks nothing.
EOF
