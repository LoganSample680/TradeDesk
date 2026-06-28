# Observability & Slack — wiring guide

Everything nerdy you wanted in Slack: live errors, contractor interaction telemetry,
endpoint timings, and Proxmox box heartbeats — so decisions are data-driven and the
self-heal loop (CLAUDE.md §14) has a feed.

## What's built (committed)

| Piece | File | What it does |
|---|---|---|
| Client capture | `js/observability.js` | Catches runtime errors + unhandled rejections, batches click/scroll/timing telemetry, ships them to `ingest-telemetry`. **Inert on localhost** (zero test impact) and **never throws**. |
| Ingest sink | `supabase/functions/ingest-telemetry/` | Service-role function. Verifies the JWT, derives an **anonymized** `contractor_hash` (raw uid never enters analytics), writes `errors[]→error_log` and `events[]→analytics_events` (aggregated counts). |
| Slack delivery | `supabase/functions/slack-notify/` | Posts `{text, blocks?}` to `SLACK_WEBHOOK_URL`. The one place the webhook URL lives (server-side). |
| Error table | `supabase/migrations/20260702_error_log.sql` | `error_log` — deny-all to clients, service-role only (same pattern as `analytics_events`). |
| Box heartbeat | `scripts/proxmox-heartbeat.sh` | RAM / load / disk / GH-runner / running-LXC → Slack, on a cron. Alert mode for thresholds. |

Telemetry lands in `analytics_events` (already migrated) → `rollup-analytics` already
rolls it into `analytics_metrics_daily` for the future ops dashboard (R/Y/G vs
`analytics_benchmarks`).

## Activate (the steps that need YOU)

1. **Create a Slack Incoming Webhook** → copy the `https://hooks.slack.com/services/…` URL.

2. **Set it as a Supabase secret** (keeps it server-side):
   ```bash
   supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
   ```
   The functions deploy via `deploy-functions.yml` on push (or `supabase functions deploy ingest-telemetry slack-notify`). Until the secret is set, `slack-notify` no-ops gracefully and `ingest-telemetry` still records to the tables.

3. **Fan errors to Slack** — Supabase Dashboard → Database → **Webhooks** → new webhook:
   - Table `error_log`, event **INSERT**
   - Type **HTTP Request** → POST your `slack-notify` function URL, with a payload template like:
     ```json
     { "text": ":red_circle: *App error* `{{ record.kind }}` — {{ record.message }}\n`{{ record.app_version }}` · {{ record.url }}" }
     ```
   (Or use a DB trigger + `pg_net`; the webhook UI is simplest.)

4. **Heartbeat cron on jarvis** (Proxmox host):
   ```bash
   */15 * * * * SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." bash /root/TradeDesk/scripts/proxmox-heartbeat.sh
   # high-water alerts only:
   */5 * * * * ALERT_ONLY=1 RAM_MAX=90 DISK_MAX=92 SLACK_WEBHOOK_URL="..." bash /root/TradeDesk/scripts/proxmox-heartbeat.sh
   ```

5. **Deploy** the app (so `observability.js` ships) when you're ready — it only runs on
   deployed origins, not localhost.

## Still on the roadmap (next sessions)

- **Cloudflare usage → Slack**: a scheduled function polling the CF GraphQL Analytics
  API (needs a `CLOUDFLARE_API_TOKEN` secret) → daily `/api` request count + build
  minutes to Slack.
- **Flow-test telemetry → Slack**: post the `_LEDGER` interaction/timing profile +
  pass/fail from each self-hosted run to Slack (the data's already captured per run).
- **Self-heal**: `error_log` INSERT → repository_dispatch → Claude auto-fix PR (§14).
- **Ops dashboard site** + **Jarvis voice layer** (Analytics Phases 3 & 5).
