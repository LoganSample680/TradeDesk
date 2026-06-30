-- td_ops — the custom offline-first oplog's op stream (oplog Phase 2).
--
-- Each row is a per-field create/update op stamped with a Hybrid Logical Clock (hlc), so
-- peers can converge field-by-field (concurrent edits to DIFFERENT fields of the same row
-- both survive). OBSERVE-ONLY until Phase 3 — the app pushes/pulls ops here to validate the
-- write path and advance its clock, but nothing authoritative reads them yet. Owner-scoped
-- RLS, same posture as the td_* tables (the real boundary is per-user row ownership).
-- Idempotent; safe to re-run.

create table if not exists td_ops (
  seq         bigint        generated always as identity primary key,
  hlc         text          not null,
  user_id     uuid          not null references auth.users(id) on delete cascade,
  op_table    text          not null,
  row_id      text          not null,
  fields      jsonb         not null default '{}',
  device_id   text,
  created_at  timestamptz   not null default now()
);

create index if not exists idx_td_ops_user_hlc on td_ops(user_id, hlc);

alter table td_ops enable row level security;

-- A from-migrations stack needs the role grant (hosted Supabase auto-grants; a raw CREATE
-- TABLE does not). RLS still enforces per-row ownership below. (seq is GENERATED ALWAYS AS
-- IDENTITY, so inserts need no sequence grant.)
grant select, insert, update, delete on td_ops to anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'td_ops' and policyname = 'td_ops_owner'
  ) then
    execute 'create policy td_ops_owner on td_ops
               for all to anon, authenticated
               using (auth.uid()::text = user_id::text)
               with check (auth.uid()::text = user_id::text)';
  end if;
end $$;
