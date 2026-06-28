-- error_log: runtime errors captured from the deployed app via the ingest-telemetry
-- edge function (service role) — for the ops dashboard, Slack tripwires, and the
-- agentic self-heal loop (CLAUDE.md §14).
--
-- RLS with ZERO policies = deny-all to anon/authenticated (same pattern as
-- analytics_events). Only the service role (ingest-telemetry) inserts; only the
-- dashboard / owner reads. A Supabase DB webhook on INSERT can fan new rows out to
-- Slack via the slack-notify function (see docs/OBSERVABILITY.md).

create table if not exists public.error_log (
  id          bigint generated always as identity primary key,
  user_id     uuid,                          -- which account hit it (ops only; not exposed)
  kind        text not null default 'error', -- error | unhandledrejection | console | endpoint
  message     text not null,
  stack       text,
  url         text,
  ua          text,
  context     jsonb,
  app_version text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists error_log_created_idx    on public.error_log (created_at desc);
create index if not exists error_log_unresolved_idx on public.error_log (created_at desc) where resolved = false;
-- Dedup helper: collapse repeats of the same message in dashboards/queries.
create index if not exists error_log_message_idx    on public.error_log (md5(message), created_at desc);

alter table public.error_log enable row level security;
-- Intentionally NO policies → deny-all to clients. Service role bypasses RLS to insert;
-- reads are service-role / dashboard only. Errors are ops data, never user-facing.
