# Cloudflare Workers/Pages usage — exact per-request attribution

> "I want to see EXACTLY what caused Cloudflare Workers usage in the exact moment it happened."

Every `/api/*` hit is **one** Cloudflare Pages-Functions invocation — that's the metered
number that jumps to "6252" etc. The `/api` proxy (`functions/api/[[path]].js`) now writes
**one Workers Analytics Engine data-point per request**, so you can query down to the second
which endpoint, method, status, ray-id, country, and edge PoP drove any spike.

Workers Analytics Engine writes are **fire-and-forget and effectively free** (they are NOT a
separate billable Worker invocation), and the code **no-ops gracefully** until the binding
below exists — so nothing changes in prod until you wire it up.

## What each request records

| Field | Meaning |
|-------|---------|
| `timestamp` | automatic, second-precision (UTC) |
| `blob1` | endpoint, bucketed (`/rest/v1/td_bids`, `/auth/v1/token`, `/storage/v1/object/proposals`, `/functions/v1/...`) |
| `blob2` | HTTP method (`GET`/`POST`/`WS`/`OPTIONS`) |
| `blob3` | kind — `http` or `ws` (realtime WebSocket upgrade) |
| `blob4` | **`cf-ray`** — the exact Cloudflare request id (cross-reference a single request) |
| `blob5` | client country |
| `blob6` | edge PoP (`colo`) that served it |
| `double1` | upstream HTTP status |
| `double2` | upstream latency (ms) |
| `index1` | endpoint (the GROUP BY / sampling key) |

## One-time setup (YOU, in the Cloudflare dashboard)

1. **Pages → your project → Settings → Functions → Analytics Engine bindings → Add binding**
   - Variable name: **`API_ANALYTICS`** (must match the code exactly)
   - Dataset name: **`tradedesk_api`** (any name; used in the query `FROM` clause)
2. Redeploy the app (any deploy picks up the binding). Until then the proxy runs identically, just without recording.

Analytics Engine is included on the **Workers Paid** plan ($5/mo). On Free it may be unavailable —
if so, this is one more reason the $5 plan is worth it (and you already weigh that in CLAUDE.md §15.2).

## Querying — the SQL API

Create an API token (My Profile → API Tokens → *Account Analytics: Read*), then:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql" \
  -H "Authorization: Bearer <ANALYTICS_TOKEN>" \
  -d "SELECT blob1 AS endpoint, blob2 AS method, count() AS hits
      FROM tradedesk_api
      WHERE timestamp >= NOW() - INTERVAL '1' HOUR
      GROUP BY endpoint, method
      ORDER BY hits DESC"
```

**"What EXACTLY hit at 14:09:22 UTC?"** — narrow to the second:

```sql
SELECT timestamp, blob1 AS endpoint, blob2 AS method, double1 AS status, blob4 AS ray, blob5 AS country
FROM tradedesk_api
WHERE timestamp BETWEEN toDateTime('2026-06-28 14:09:20') AND toDateTime('2026-06-28 14:09:25')
ORDER BY timestamp ASC
```

**Per-minute usage trend (find the spike):**

```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' MINUTE) AS minute, count() AS invocations
FROM tradedesk_api
WHERE timestamp >= NOW() - INTERVAL '6' HOUR
GROUP BY minute ORDER BY minute DESC
```

## Live tail (real-time, while it's happening)

```bash
npx wrangler pages deployment tail --project-name <project>
```

Streams each Function invocation live (method, path, status, CPU time) — the real-time
counterpart to the historical Analytics Engine queries above.

## Next step (optional) — pipe it to Slack

A scheduled function can run the per-minute query every N minutes and post anomalies
(`invocations > threshold`, or a new endpoint appearing) to `slack-notify` — closing the loop
on the observability moat (CLAUDE.md §14, docs/OBSERVABILITY.md). Wire on request.
