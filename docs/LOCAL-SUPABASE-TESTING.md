# Local Supabase for flow tests — per-worker isolation (the "all run + all pass" unblock)

## Quick start (the one-shot)

On the Proxmox HOST, once (lets Docker run in the LXC), then reboot the CT:
```bash
pct set 200 --features nesting=1,keyctl=1 && pct reboot 200
```
Inside LXC 200, from a clone of this repo:
```bash
bash scripts/setup-local-test-stack.sh     # Supabase stack (db reset + migrations)
```
Paste the `supabase status` block back to Claude. Then Claude wires the per-worker harness to those
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

## Property data — county assessor records (replaced the Zillow proxy, 2026-09-22)

**There is no property proxy any more, and nothing here runs on jarvis.** The old
`scripts/property-proxy.js` scraped Zillow from a home residential IP because Zillow
bot-challenges datacenter IPs. It is deleted. Zillow now serves a hard 403 to it, and
the "Kansas caveat" this section used to carry (KS returning null since ~late June
2026) was the first sign of the block, not a KS quirk.

Property facts come from the county assessor now, which is where they always
originated: Zillow buys county records from an aggregator, so the scraper was
laundering Shawnee County's own data back to us through two middlemen.

- **Load a county:** run the `Load County Assessor Data` workflow
  (`.github/workflows/county-load.yml`) with the config name, or locally:
  ```bash
  node scripts/county-load.js ks-shawnee --print     # check the field map, writes nothing
  node scripts/county-load.js ks-shawnee             # load the county
  node scripts/county-load.js ks-shawnee --enrich 250  # fill year built
  ```
- **Add a county:** copy `scripts/counties/ks-shawnee.json`, change the URLs and the
  field names, run `--print` until the columns look right. No code change.
- **Fill the whole county in the background (the drip).** The bulk layer lands every
  parcel in ~16 requests, but year built comes one address at a time, and 77,006 of
  those on a fixed timer is 5.3 hours of metronomic traffic: the exact shape that gets
  a range blocked. `scripts/setup-county-drip.sh` installs a systemd timer on jarvis
  that visits every 30 minutes (randomized), works only 07:00-21:00 local, caps each
  visit at 25 minutes, and leaves gaps of 12 to 60 seconds with an occasional few
  minute break. That is ~1,000 addresses a day, so Shawnee County lands in about
  eleven weeks with no hour that looks unusual from their side.
  ```bash
  sudo bash scripts/setup-county-drip.sh ks-shawnee   # then fill in /etc/tradedesk/county-drip.env
  journalctl -u county-drip.service -f                # watch it
  systemctl list-timers county-drip.timer             # next visit
  ```
  **It runs on jarvis but nothing waits on jarvis.** This is a pre-warm, not the live
  path: turn the box off and every lookup still works, it just asks the county on
  first touch instead of already knowing. That is the whole difference between this
  and the Zillow proxy that used to live there. It is NOT a GitHub Action because the
  pace means ~14 hours of wall clock a day, which would burn ~25,000 Actions minutes a
  month on a hosted runner and would starve the flow tests on the self-hosted one.
- **A county is asked about any one address exactly once, ever.** `county_claim_ask`
  (migration `20261033_county_ask_gate.sql`) records the ask itself, before the request
  goes out, so an address the county cannot answer (a vacant lot, an address it has no
  record of) is retired instead of being re-asked forever by every contractor who
  touches it. The API route and the loader both claim through it and share one daily
  cap per county (`COUNTY_DAILY_CAP`, default 500) as a circuit breaker. It fails
  closed: a crashed request leaves the address claimed rather than re-asking.
- **Lookups are a SQL join,** not a network call: `property_lookup` (migration
  `20261032_county_parcels.sql`) matches every address a contractor has in one round
  trip. `functions/api/property.js` is only the single-address enrichment path behind
  the "Look up property" button, and it needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
  in Cloudflare Pages env. `PROPERTY_TUNNEL_URL` is gone; delete it if it is still set.

## Hosted-runner mode — no jarvis needed (added 2026-08-21)

`.github/workflows/local-stack-hosted.yml` runs the same local-stack harness on
GitHub's own `ubuntu-latest` runners: the job boots a disposable Supabase stack
from `supabase/migrations/` with `supabase start`, reads the service/anon keys
from `supabase status` at run time (ZERO GitHub secrets), provisions the
per-worker pool + crew pool, and additionally seeds the **showcase account**:

- `e2e+showcase@tradedesk.local` owns "Showcase Painting" AND is an active
  `team_members` employee of worker 0's business — the dual-hat shape.
- One seeded workday: client, job, two GPS mileage legs (shop→job→shop), the
  matching drive + geofence rows in `job_time_entries`, and a manual clock
  entry — so Dashboard, Time Log, and Mileage all render real content.
- **`e2e+messy@tradedesk.local`** (added 2026-08-21): the SAME day, SAME job
  and coordinates, seeded chaotic instead of clean — 10 fragmented/jittery
  mileage legs instead of 2 (stop-start drives, near-zero jitter blips at
  lights), a dead-phone gap followed by a GPS-drift blip on reconnect, and
  the on-site stay logged as 5 separate fence exit/re-entry `job_time_entries`
  rows instead of one window, plus a manual clock entry overlapping the mess.
  Owner ask: prove the live reconcile/dedup sweep (`_geoReconcileFromMileage`
  → `_geoDedupTimeEntries`, `js/geo-track.js`) survives real-phone messiness
  against real Supabase rows, not just synthetic objects in an offline mock.

Default spec filter is `local-visual`, which matches BOTH
`tests/flow/local-visual.spec.js` (clean showcase day) and
`tests/flow/local-visual-messy.spec.js` (the messy comparison day, asserting
zero console errors and that the job still renders through the mess), so a
default run uploads clean and messy screenshots side by side in the same
`local-visual-shots` artifact. Dispatch with any other spec filter to run
that subset against the local stack instead. On-demand only (workflow_dispatch);
it pulls ~2GB of images, so it never runs per-push.
