-- Columns that say when a row last changed, so readers can ask for only what
-- changed (egress, 2026-10-01).
--
-- The usage page for 2026-09-30 showed about 180 MB, most of it the same rows
-- downloaded again and again: the server re-read a person's whole day of
-- location_pings on every rebuild, and Crew Cost re-read every job and shop
-- time entry each time it opened. Neither table could say which rows were new
-- or edited, so neither reader could ask for just those.
--
-- location_pings: insert-only, so a created_at is enough. Rows written
--   before this have none, and need none: a reader that keeps a day always
--   starts from a whole read.
-- job_time_entries, shop_time_entries: edited in place (hand fixes, answers,
--   soft deletes), so they get an updated_at kept current by a trigger on
--   every insert and update, the same shape td_time_entries already has.
--
-- Additive: no column production code reads is renamed or dropped, and no
-- existing value changes.
alter table public.location_pings add column if not exists created_at timestamptz default now();
create index if not exists location_pings_person_created_idx
  on public.location_pings (employee_user_id, created_at);

alter table public.job_time_entries add column if not exists updated_at timestamptz default now();
alter table public.shop_time_entries add column if not exists updated_at timestamptz default now();
create index if not exists job_time_entries_contractor_updated_idx
  on public.job_time_entries (contractor_user_id, updated_at);
create index if not exists shop_time_entries_contractor_updated_idx
  on public.shop_time_entries (contractor_user_id, updated_at);

create or replace function public.td_touch_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_time_entries_touch_updated_at on public.job_time_entries;
create trigger job_time_entries_touch_updated_at
  before insert or update on public.job_time_entries
  for each row execute function public.td_touch_row_updated_at();

drop trigger if exists shop_time_entries_touch_updated_at on public.shop_time_entries;
create trigger shop_time_entries_touch_updated_at
  before insert or update on public.shop_time_entries
  for each row execute function public.td_touch_row_updated_at();
