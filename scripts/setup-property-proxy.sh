#!/usr/bin/env bash
# One-shot: run the Zillow property-lookup proxy from jarvis's HOME residential IP
# (datacenter IPs get bot-challenged; a residential IP is the best shot) as a
# persistent systemd service, exposed to Cloudflare Pages via a cloudflared tunnel.
#
# Run as root on the box that has the HOME IP (jarvis host, or an LXC that NATs out
# the home connection, both present the residential IP). From a PERSISTENT clone of
# the repo (NOT the runner's ephemeral per-job workspace):
#     bash scripts/setup-property-proxy.sh
#
# After it prints the tunnel URL, set it in Cloudflare:
#     Pages → your project → Settings → Environment variables → PROPERTY_TUNNEL_URL = <url>
# (functions/api/property.js forwards /api/property → PROPERTY_TUNNEL_URL → this proxy.)
#
# NOTE on the Kansas issue: this gives the proxy a residential IP, which is necessary
# but may not be sufficient, Zillow changed something KS-specific (~late June). If KS
# still returns null after this, the durable fix is a licensed property API
# (Rentcast/Estated), a separate decision. MO/NC already work through this path.
set -uo pipefail

say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){ printf '   \033[32m✓\033[0m %s\n' "$*"; }
die(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null 2>&1 || die "node not found, install Node 20+ first"
[ -f "$REPO/scripts/property-proxy.js" ] || die "property-proxy.js not found in $REPO/scripts"

# ── 1. property-proxy as a systemd service (port 3001) ────────────────────────
say "Installing property-proxy systemd service (port 3001)"
cat >/etc/systemd/system/td-property-proxy.service <<EOF
[Unit]
Description=TradeDesk Zillow property-lookup proxy (home IP)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PORT=3001
WorkingDirectory=$REPO
ExecStart=$(command -v node) $REPO/scripts/property-proxy.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now td-property-proxy.service || die "failed to start property-proxy"
sleep 1
curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1 && ok "proxy responds on :3001" \
  || ok "proxy started (no /health route is fine, it serves /?address=...)"

# ── 2. cloudflared tunnel ─────────────────────────────────────────────────────
say "Checking cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(uname -m)"; case "$ARCH" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) die "unknown arch $ARCH";; esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${A}" \
    -o /usr/local/bin/cloudflared || die "cloudflared download failed"
  chmod +x /usr/local/bin/cloudflared
fi
ok "cloudflared $(cloudflared --version 2>/dev/null | head -1)"

# Quick tunnel (ephemeral URL, fine to start; the URL changes on restart). For a
# STABLE url, upgrade to a named tunnel: `cloudflared tunnel login && cloudflared
# tunnel create td-property` then route a hostname, see the runbook.
say "Installing cloudflared quick-tunnel service for :3001"
cat >/etc/systemd/system/td-property-tunnel.service <<EOF
[Unit]
Description=cloudflared quick tunnel → td-property-proxy :3001
After=network-online.target td-property-proxy.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now td-property-tunnel.service
sleep 6

say "Tunnel URL (set this as PROPERTY_TUNNEL_URL in Cloudflare Pages env)"
URL="$(journalctl -u td-property-tunnel.service --no-pager -n 80 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)"
if [ -n "$URL" ]; then
  echo "------------------------------------------------------------------"
  echo "PROPERTY_TUNNEL_URL=$URL"
  echo "------------------------------------------------------------------"
  ok "Quick test: curl \"$URL/property?addr=4703%20Pickett%20Rd,%20Saint%20Joseph,%20MO%2064503\""
else
  ok "Tunnel starting, get the URL with: journalctl -u td-property-tunnel.service | grep trycloudflare"
fi
echo "Reminder: quick-tunnel URLs change on restart. For production, use a NAMED tunnel"
echo "(stable hostname), see docs/LOCAL-SUPABASE-TESTING.md › property proxy."
