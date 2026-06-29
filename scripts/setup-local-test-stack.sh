#!/usr/bin/env bash
# One-shot: stand up a LOCAL Supabase stack inside the runner LXC for the flow tests.
# Run as root INSIDE LXC 200 (tradedesk-runner), from the repo root:
#     bash scripts/setup-local-test-stack.sh
#
# It is idempotent — safe to re-run. It does NOT touch production. When done it
# prints the local API URL + anon + service_role keys you paste back to Claude so the
# per-worker isolation harness can be wired + the SUPABASE_UPSTREAM secret pointed here.
#
# PREREQS (do these ONCE on the Proxmox HOST if not already, then reboot the CT):
#   pct set 200 --features nesting=1,keyctl=1     # lets Docker run inside the LXC
#   pct reboot 200
set -uo pipefail

say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){ printf '   \033[32m✓\033[0m %s\n' "$*"; }
die(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || die "cannot cd to repo"

# ── 1. Docker present + running ───────────────────────────────────────────────
say "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh || die "Docker install failed"
fi
docker info >/dev/null 2>&1 || { systemctl start docker 2>/dev/null || service docker start 2>/dev/null; sleep 2; }
docker info >/dev/null 2>&1 || die "Docker not running. In an LXC you need: pct set 200 --features nesting=1,keyctl=1 (on the host) then reboot the CT."
ok "Docker is running"

# ── 2. Supabase CLI present ───────────────────────────────────────────────────
say "Checking Supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  say "Installing Supabase CLI"
  ARCH="$(uname -m)"; case "$ARCH" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) die "unknown arch $ARCH";; esac
  # The release asset name includes the version, so resolve the real URL from the API
  # (the unversioned latest/download/<name> path 404s).
  URL="$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | grep -o "https://[^\"]*_linux_${A}\.tar\.gz" | head -1)"
  [ -n "$URL" ] || die "could not resolve Supabase CLI asset URL from the GitHub API"
  # The CLI ships as a `supabase` shim + a co-located `supabase-go` binary — they MUST
  # live in the same dir. Extract the WHOLE tarball and symlink both onto PATH (copying
  # only the shim makes it fail with "Could not find the supabase-go binary").
  mkdir -p /opt/supabase
  curl -fsSL "$URL" | tar xz -C /opt/supabase || die "Supabase CLI download/extract failed"
  ln -sf /opt/supabase/supabase /usr/local/bin/supabase || die "symlink failed"
  [ -f /opt/supabase/supabase-go ] && ln -sf /opt/supabase/supabase-go /usr/local/bin/supabase-go
fi
ok "Supabase CLI $(supabase --version 2>/dev/null | head -1)"

# ── 3. RAM check → decide tmpfs vs disk for the (disposable) Postgres data ─────
# The test DB is reset every run, so it needs ZERO durability. RAM-backed avoids
# both SSD wear AND contention with Frigate's nonstop HDD writes. We size a tmpfs
# only if there is comfortable headroom; otherwise fall back to on-disk (Docker's
# default location) and let you decide later.
say "Sizing storage"
FREE_MB="$(free -m | awk '/Mem:/{print $7}')"   # 'available' column
ok "Available RAM: ${FREE_MB} MB"
TMPFS_DIR=/mnt/supabase-tmpfs
USE_TMPFS=0
if [ "${FREE_MB:-0}" -ge 3000 ]; then
  USE_TMPFS=1
  mkdir -p "$TMPFS_DIR"
  if ! mountpoint -q "$TMPFS_DIR"; then
    mount -t tmpfs -o size=2g tmpfs "$TMPFS_DIR" || { USE_TMPFS=0; printf '   (tmpfs mount failed — using on-disk)\n'; }
  fi
  [ "$USE_TMPFS" = 1 ] && ok "Postgres data → tmpfs ($TMPFS_DIR, 2g) — no disk wear, no Frigate contention"
else
  ok "RAM tight (<3 GB free) → Postgres data stays on disk (Docker default). Never the Frigate HDD spindle if avoidable."
fi
# NOTE: pinning the supabase_db volume onto $TMPFS_DIR is a follow-up tweak-link we
# finalize against your CLI version (it manages its own named volume). For the first
# bring-up we let the CLI use its default; moving it to tmpfs is a 1-line volume swap.

# ── 4. Bring up the stack + apply all migrations ──────────────────────────────
say "Starting Supabase (Postgres + GoTrue + PostgREST + Realtime + Storage + Kong)"
[ -f supabase/config.toml ] || die "no supabase/config.toml — run from the repo root"
supabase start || die "supabase start failed (see output above)"
say "Resetting DB to a clean schema from supabase/migrations/ ($(ls supabase/migrations/*.sql | wc -l) migrations)"
supabase db reset || die "supabase db reset failed — a migration likely errored against a fresh DB; paste the output to Claude"

# ── 5. Print what Claude needs ────────────────────────────────────────────────
say "DONE — paste EVERYTHING below back to Claude"
echo "------------------------------------------------------------------"
supabase status
echo "------------------------------------------------------------------"
echo "tmpfs_in_use=$USE_TMPFS  free_ram_mb=$FREE_MB"
echo "Next: Claude wires the per-worker isolation harness to these keys, then you set"
echo "the GitHub secret  SUPABASE_UPSTREAM = <API URL above>  and run the flow suite."
