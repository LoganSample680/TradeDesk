-- Crowdsourced scope-timing benchmarks.
-- Raw submissions go into td_scope_benchmarks (per-user, private).
-- Aggregated medians live in td_scope_rates (public-read, written only by the edge function
-- using the service role key).

create table if not exists td_scope_benchmarks (
  id           uuid         primary key default gen_random_uuid(),
  user_id      uuid         not null references auth.users(id) on delete cascade,
  scope_id     text         not null,
  trade        text         not null default 'painting',
  actual_hrs   numeric      not null check (actual_hrs > 0 and actual_hrs < 24),
  submitted_at timestamptz  default now()
);

alter table td_scope_benchmarks enable row level security;

drop policy if exists "own" on td_scope_benchmarks;
create policy "own" on td_scope_benchmarks
  for all
  using  (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

create index if not exists idx_scope_benchmarks_lookup
  on td_scope_benchmarks (scope_id, trade);

-- ─── Aggregate output ─────────────────────────────────────────────────────────
create table if not exists td_scope_rates (
  scope_id      text     not null,
  trade         text     not null,
  median_min    numeric  not null,
  p25_min       numeric,
  p75_min       numeric,
  sample_count  integer  not null default 0,
  updated_at    timestamptz default now(),
  primary key (scope_id, trade)
);

alter table td_scope_rates enable row level security;

drop policy if exists "public read" on td_scope_rates;
create policy "public read" on td_scope_rates
  for select using (true);
-- Writes done by edge function via service-role key (bypasses RLS).
