-- Core per-record sync tables (td_*).
--
-- These tables back every primary data array in the app (clients, bids, jobs,
-- income, expenses, …) via the generic per-record sync pattern in js/cloud.js
-- (_TD_TABLES). On the cloud project they were created OUTSIDE version control
-- (dashboard / early untracked script), so they were never captured as a
-- migration. A fresh database — the local test stack, OR a future self-hosted
-- prod migration — therefore lacked them, and every REST read/write 404'd
-- (cloud-load never completes; the whole app appears to "hang" after sign-in).
--
-- This migration makes the schema fully reproducible. It is IDEMPOTENT and
-- SAFE on the existing cloud project: `create table if not exists` skips every
-- table that already exists, so prod is untouched; only a fresh DB gets them.
--
-- Shape mirrors the established td_agreements convention (20260618_contracts.sql):
--   (id text, user_id uuid -> auth.users, data jsonb, updated_at, deleted_at),
--   PK (id,user_id), RLS owner-only, partial index on live rows, realtime publish.

do $$
declare
  t text;
  tables text[] := array[
    'td_clients','td_bids','td_jobs','td_income','td_expenses','td_mileage',
    'td_payments','td_liens','td_time_entries','td_licenses','td_events',
    'td_contracts','td_agreements','td_photos'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create table if not exists %I (
         id          text         not null,
         user_id     uuid         not null references auth.users(id) on delete cascade,
         data        jsonb        not null default ''{}'',
         updated_at  timestamptz  not null default now(),
         deleted_at  timestamptz  default null,
         primary key (id, user_id)
       )', t);

    execute format('alter table %I enable row level security', t);

    -- Table-level privileges. RLS filters ROWS, but the role still needs a GRANT to
    -- touch the table at all. Supabase auto-grants dashboard-created tables; a raw
    -- CREATE TABLE in a migration does NOT, so without this every authenticated REST
    -- call 403s ("permission denied for table"). Idempotent on prod.
    execute format('grant select, insert, update, delete on %I to anon, authenticated, service_role', t);

    execute format('create index if not exists %I on %I (user_id) where deleted_at is null',
                   'idx_' || t || '_user', t);

    -- Owner-only access (equivalent to the existing policy on tables that already
    -- have one; harmless duplicate-by-value where a differently-named one exists).
    execute format('drop policy if exists "owner" on %I', t);
    execute format(
      'create policy "owner" on %I for all
         using (auth.uid()::text = user_id::text)
         with check (auth.uid()::text = user_id::text)', t);

    -- Realtime: deliver per-record changes to the owner's other devices.
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end $$;
