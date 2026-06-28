# Local Supabase for flow tests — per-worker isolation (the "all run + all pass" unblock)

## Quick start (the one-shot)

On the Proxmox HOST, once (lets Docker run in the LXC), then reboot the CT:
```bash
pct set 200 --features nesting=1,keyctl=1 && pct reboot 200
```
Inside LXC 200, from a clone of this repo:
```bash
bash scripts/setup-local-test-stack.sh     # Supabase stack (db reset + migrations)
bash scripts/setup-property-proxy.sh        # Zillow proxy on the home IP + cloudflared tunnel
```
Paste the `supabase status` block (printed by the first script) + the `PROPERTY_TUNNEL_URL`
(printed by the second) back to Claude. Then Claude wires the per-worker harness to those
keys and you set the GitHub secret `SUPABASE_UPSTREAM` to the printed API URL. Details below.

---


The self-hosted flow suite fails not on app bugs but on **one shared dev account**: 3
Playwright workers hit the same Supabase `user_id`, so the (correct, multi-device)
realtime sync + soft-delete sweep make them clobber each other, and the channel storm
overloads the runner (→ "49 didn't run"). The fix is **one isolated account per worker**.
A local Supabase stack on jarvis gives unlimited throwaway accounts + a clean DB per run.

## Storage decision — use tmpfs (RAM), not a disk

The test DB is **disposable** (reset every run, zero durability needed), so its data dir
belongs in RAM:

- **tmpfs = zero disk writes** → no NVMe wear, and **no contention with Frigate's nonstop
  video writes on the HDD**. It's also the fastest option.
- Requirement: free RAM in the runner LXC. A throwaway test Postgres is small — budget
  **~1.5–2 GB** of tmpfs. Check headroom first: `free -m` inside LXC 200.
- Fallback if RAM is tight: the **NVMe** (wear is negligible — ~600 TBW rated vs. our
  MB/day). **Never the Frigate HDD** — mixed random+sequential on a spindle starves both.

## One-time setup on jarvis (inside the runner LXC)

```bash
# 1. Docker + Supabase CLI must be present (the runner already has Docker for nothing else;
#    install the CLI if missing):
#    https://supabase.com/docs/guides/local-development/cli/getting-started

# 2. Put Docker's volumes on tmpfs so the Postgres data dir lives in RAM.
#    Simplest: mount a tmpfs at the supabase db volume path, OR run Docker with a
#    tmpfs data-root for this stack. Recommended explicit tmpfs mount (2 GB):
sudo mkdir -p /mnt/supabase-tmpfs
sudo mount -t tmpfs -o size=2g tmpfs /mnt/supabase-tmpfs
#    (make it boot-persistent later via /etc/fstab once validated)

# 3. Bring up the local stack from the repo (it reads supabase/config.toml + applies
#    every migration in supabase/migrations/):
cd ~/TradeDesk
supabase start          # boots Postgres + GoTrue + PostgREST + Realtime + Storage + Kong
supabase db reset       # clean schema from migrations (do this between runs too)

# 4. Note the local API URL + keys it prints:
supabase status         # API URL → http://localhost:54321 ; anon key ; service_role key
```

To pin Postgres onto the tmpfs with the Supabase CLI, set the db volume to the tmpfs mount
(via `supabase/config.toml` `[db] ` or a Docker `--tmpfs /var/lib/postgresql/data` override
on the `supabase_db_*` container). I'll finalize the exact knob once you confirm the CLI
version from `supabase --version`.

## Point the test bridge at the local stack

`tests/flow/local-server.js` already proxies `/api/*` → `SUPABASE_UPSTREAM`. In the
self-hosted workflow (`.github/workflows/flow-tests-selfhosted.yml`) change the one secret:

```yaml
SUPABASE_UPSTREAM: http://localhost:54321     # was https://mwtsmctajhrrybblgorf.supabase.co
```

The app keeps calling `localhost:8788/api` exactly as today — only what it proxies TO
changes. Zero app-code change.

## Per-worker accounts (what I'll build — dormant behind a flag)

A Playwright `globalSetup` runs once before the suite when `E2E_LOCAL_STACK=1`:

1. `supabase db reset` (clean slate — no leftover seed clobber).
2. Using the **service_role** key + local GoTrue admin API, create one confirmed account
   per worker: `e2e+w0@local`, `e2e+w1@local`, … (count = `workers` in the flow config).
3. Write their ids to a small JSON the helpers read; `signIn()` picks the account for
   `testInfo.parallelIndex`. Distinct `user_id`s ⇒ the realtime channel + soft-delete sweep
   are naturally isolated, the storm is gone, and every clobber/lost-update spec passes for
   the right reason.

**When `E2E_LOCAL_STACK` is unset (today's cloud runs), nothing changes** — `signIn()`
behaves exactly as now, so the 125 passing tests are untouched. The whole mechanism is
opt-in and inert until you flip it.

## Why this also helps beyond tests

- Zero production-data pollution (§13.7 seed data stops accumulating in the real account).
- Zero prod auth rate-limits and **zero Cloudflare `/api` burn** from test runs.
- A clean, reset-able DB makes the "money-chain" proof spec (signed + audit + cancelled)
  reliable too.

Production stays on Supabase cloud — this is the **test/dev** environment only.

## Property proxy (Zillow) — home-IP lookup

`scripts/setup-property-proxy.sh` runs `scripts/property-proxy.js` on :3001 from jarvis's
**home residential IP** (Zillow bot-challenges datacenter IPs) and exposes it via a
cloudflared **quick tunnel**. Set the printed URL as `PROPERTY_TUNNEL_URL` in Cloudflare
Pages env; `functions/api/property.js` forwards `/api/property` → there.

- Quick-tunnel URLs **change on restart**. For a stable hostname, upgrade to a **named
  tunnel**:
  ```bash
  cloudflared tunnel login
  cloudflared tunnel create td-property
  cloudflared tunnel route dns td-property property.<your-domain>
  # then point the service at:  cloudflared tunnel run td-property  (ingress → :3001)
  ```
  and set `PROPERTY_TUNNEL_URL=https://property.<your-domain>` once, permanently.
- **Kansas caveat:** a home IP is necessary but may not be sufficient — Zillow changed
  something KS-specific (~late June 2026). MO/NC work through this path; if KS still returns
  null, the durable fix is a licensed property API (Rentcast/Estated), tracked separately.
- Manage: `systemctl status td-property-proxy td-property-tunnel`,
  `journalctl -u td-property-tunnel -f`.
