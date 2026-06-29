-- ─────────────────────────────────────────────────────────────────────────────
-- Product-analytics store (Phase 1) — the developer-facing telemetry layer.
--
-- THREE tables, all in `public` with an `analytics_` prefix (mirrors the existing
-- td_scope_rates pattern so PostgREST/anon-key config needs no change):
--
--   analytics_events       raw, append-only interaction telemetry (Phase 2 ingest
--                          writes here via the service role — clients NEVER write
--                          directly). Counts/timings only, never keystroke content.
--   analytics_metrics_daily nightly rollups the ops dashboard + Jarvis read. One row
--                          per (day, metric, scope) with a distribution + a value.
--   analytics_benchmarks   red/yellow/green thresholds per metric — the early-warning
--                          config that lights the dashboard and fires Slack tripwires.
--
-- SECURITY: RLS is ENABLED with NO anon/authenticated policies, so the anon key
-- (contractors, clients) can neither read nor write any analytics row. Only the
-- service role (the rollup edge function + the ops-dashboard backend) touches these
-- — service role bypasses RLS. This keeps cross-user analytics invisible to every
-- contractor while the developer aggregates across all of them.
--
-- Bare-DB / migration-lint safe: every object behind `if not exists`; RLS-enable +
-- the benchmark seed are idempotent. `psql -f` on an empty DB applies cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Raw interaction telemetry (Phase 2 ingest target) ───────────────────────
create table if not exists analytics_events (
  id              bigint generated always as identity primary key,
  contractor_hash text,                 -- anonymized contractor id (never the raw uid)
  session_id      text,                 -- per-app-session, for funnel stitching
  event           text not null,        -- 'click'|'scroll'|'keystroke'|'task_switch'|'bid_build'|...
  ctx             text,                 -- where: page id / task name
  value           numeric,              -- a count, a duration (ms), or a magnitude
  meta            jsonb,                -- small structured extras (NO PII, NO keystroke content)
  ts              timestamptz not null default now()
);
create index if not exists analytics_events_ts_idx     on analytics_events (ts);
create index if not exists analytics_events_event_idx  on analytics_events (event, ts);

-- ── Rolled-up daily metrics (dashboard + Jarvis read these) ─────────────────
create table if not exists analytics_metrics_daily (
  day        date    not null,
  metric     text    not null,          -- see analytics_benchmarks.metric
  scope      text    not null default 'global',  -- 'global' or an anonymized bucket
  n          integer not null default 0, -- sample count behind the numbers
  median     numeric,
  p25        numeric,
  p75        numeric,
  avg        numeric,
  value      numeric,                    -- for single-number metrics (rates, counts)
  updated_at timestamptz not null default now(),
  primary key (day, metric, scope)
);
create index if not exists analytics_metrics_daily_metric_idx on analytics_metrics_daily (metric, day);

-- ── Red/Yellow/Green thresholds per metric (the early-warning config) ───────
create table if not exists analytics_benchmarks (
  metric          text primary key,
  label           text,                 -- human label for the dashboard tile
  unit            text,                 -- 'hrs' | 'days' | 'count' | 'pct' | 'ms'
  lower_is_better boolean not null default true,  -- false for rates we want HIGH (e.g. sign rate)
  green_max       numeric,              -- <= green_max  → GREEN (or >= for higher-is-better)
  yellow_max      numeric,              -- <= yellow_max → YELLOW, else RED
  note            text
);

alter table analytics_events        enable row level security;
alter table analytics_metrics_daily enable row level security;
alter table analytics_benchmarks    enable row level security;

-- Intentionally NO anon/authenticated policies — service-role only. (RLS enabled
-- with zero policies = deny-all to anon/authenticated; service role bypasses RLS.)
-- If the ops dashboard later reads with the anon key, add an owner-scoped SELECT
-- policy here rather than opening it to all authenticated users.

-- ── Seed the starting benchmark set (idempotent). Tune thresholds as real data
-- lands; lower_is_better=false marks rates we want to be HIGH. ────────────────
insert into analytics_benchmarks (metric, label, unit, lower_is_better, green_max, yellow_max, note) values
  ('time_to_send_bid_min',        'Time to send a bid',            'min',   true,  20,   45,  'From estimate start to proposal sent.'),
  ('hub_open_count',              'Hub opens per proposal',        'count', false, 2,    1,   'Higher = more client engagement (lower_is_better=false).'),
  ('proposal_open_count',         'Proposal opens per bid',        'count', false, 2,    1,   'Times the client reopened the proposal.'),
  ('time_to_open_hub_hrs',        'Time to first hub open',        'hrs',   true,  6,    24,  'Send → client first opens the hub link.'),
  ('time_to_sign_from_hub_hrs',   'Hub open → signed',             'hrs',   true,  24,   72,  'Client opens hub to signature.'),
  ('time_to_sign_from_open_hrs',  'Proposal open → signed',        'hrs',   true,  24,   72,  'Client opens the proposal to signature.'),
  ('sign_rate_pct',               'Sign rate',                     'pct',   false, 60,   40,  'Signed / opened proposals (higher is better).'),
  ('time_to_pay_days',            'Time to pay after sign',        'days',  true,  3,    10,  'Signed → first payment lands.'),
  ('time_to_settle_days',         'Time to settle balance',        'days',  true,  14,   45,  'Signed → balance fully paid.'),
  ('liens_filed_rate_pct',        'Liens filed rate',              'pct',   true,  3,    8,   'Filed liens / completed jobs (lower is healthier).'),
  ('clicks_per_bid',              'Clicks to build a bid',         'count', true,  120,  200, 'Total interactions to complete one bid.'),
  ('task_switch_ms',              'Task-switch latency',           'ms',    true,  400,  900, 'Time to move between major tasks.')
on conflict (metric) do update set
  label = excluded.label, unit = excluded.unit, lower_is_better = excluded.lower_is_better,
  green_max = excluded.green_max, yellow_max = excluded.yellow_max, note = excluded.note;
