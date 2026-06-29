#!/usr/bin/env bash
# TradeDesk Proxmox heartbeat → Slack.
# Posts box health (RAM / load / disk / GH-runner / running LXC count) to a Slack
# Incoming Webhook. Run on the Proxmox HOST (jarvis) so it can see pct/free/df.
#
# Setup:
#   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
#   bash scripts/proxmox-heartbeat.sh            # one-shot test
#   # then cron it, e.g. every 15 min:
#   */15 * * * * SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." bash /root/TradeDesk/scripts/proxmox-heartbeat.sh
#
# Alerts (not just heartbeats): pass a threshold to only post when RAM% or disk% is high:
#   ALERT_ONLY=1 RAM_MAX=90 DISK_MAX=90 SLACK_WEBHOOK_URL=... bash scripts/proxmox-heartbeat.sh
set -uo pipefail

WEBHOOK="${SLACK_WEBHOOK_URL:-}"
[ -z "$WEBHOOK" ] && { echo "SLACK_WEBHOOK_URL not set — skipping"; exit 0; }

host="$(hostname 2>/dev/null || echo '?')"
read -r mem_pct mem_str < <(free -m 2>/dev/null | awk '/Mem:/{printf "%.0f %d/%d MB (%.0f%%)", $3/$2*100, $3, $2, $3/$2*100}')
load="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo '?')"
read -r disk_pct disk_str < <(df -h / 2>/dev/null | awk 'NR==2{p=$5; gsub("%","",p); printf "%s %s/%s (%s)", p, $3, $2, $5}')
runner="$(systemctl is-active 'actions.runner.*' 2>/dev/null | head -1 || echo 'n/a')"
guests="$(pct list 2>/dev/null | awk 'NR>1 && $2=="running"' | wc -l 2>/dev/null || echo '?')"

# Optional alert gating
if [ "${ALERT_ONLY:-0}" = "1" ]; then
  hot=0
  [ "${mem_pct:-0}" -ge "${RAM_MAX:-90}" ] 2>/dev/null && hot=1
  [ "${disk_pct:-0}" -ge "${DISK_MAX:-90}" ] 2>/dev/null && hot=1
  [ "$hot" = "0" ] && { echo "within thresholds — no alert"; exit 0; }
fi

emoji=":satellite:"
[ "${mem_pct:-0}" -ge "${RAM_MAX:-90}" ] 2>/dev/null && emoji=":rotating_light:"
[ "${disk_pct:-0}" -ge "${DISK_MAX:-90}" ] 2>/dev/null && emoji=":rotating_light:"
[ "$runner" != "active" ] && [ "$runner" != "n/a" ] && emoji=":warning:"

python3 - "$WEBHOOK" "$emoji" "$host" "$mem_str" "$load" "$disk_str" "$runner" "$guests" <<'PY' || echo "post failed"
import json, sys, urllib.request
hook, emoji, host, mem, load, disk, runner, guests = sys.argv[1:9]
text = (f"{emoji} *jarvis heartbeat* — `{host}`\n"
        f"• RAM: {mem}\n• Load: {load}\n• Disk /: {disk}\n"
        f"• GH runner: {runner}\n• Running LXC: {guests}")
req = urllib.request.Request(hook, data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=10)
except Exception as e:
    print("post failed:", e); sys.exit(1)
PY
