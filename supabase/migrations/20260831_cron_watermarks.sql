-- Watermarks for cron-driven edge functions (first user: push-geo-ping's
-- 20-minute rate gate). One row per job name, service-role only: RLS is
-- enabled with no policies on purpose, clients have no business reading
-- when a cron last ran. Additive, touches nothing existing.
create table if not exists cron_watermarks (
  name text primary key,
  ran_at timestamptz not null default now()
);
alter table cron_watermarks enable row level security;
