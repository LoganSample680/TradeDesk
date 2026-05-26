-- Add viewer_type tracking to proposal_views so the contractor can see
-- whether it was THEM or the actual CLIENT who last opened the proposal link.
--
-- viewer_type: 'client' (default) or 'contractor'
-- client_opened_at: only set when a real client (no matching auth session) opens
-- contractor_opened_at: only set when the contractor opens (session matches contractorUserId)
--
-- NOTE: this migration is self-contained — it creates the table if it doesn't
-- exist yet (e.g. Supabase Preview branches that predate the table) and then
-- idempotently adds the columns. Safe to run on any DB state.

-- 1. Create the table if it was never created (fresh Preview branch)
create table if not exists proposal_views (
  id                   uuid primary key default gen_random_uuid(),
  contractor_user_id   uuid,
  bid_id               text,
  client_id            uuid,
  opened_at            timestamptz default now(),
  unique(contractor_user_id, bid_id)
);

-- Enable RLS if not already enabled
alter table proposal_views enable row level security;

-- 2. Add the new columns (no-op if they already exist)
alter table proposal_views
  add column if not exists viewer_type          text        default 'client',
  add column if not exists client_opened_at     timestamptz,
  add column if not exists contractor_opened_at timestamptz;

-- 3. Back-fill existing rows: assume all historic opens were by the client
--    (no way to distinguish before this migration)
update proposal_views
  set client_opened_at = opened_at,
      viewer_type = 'client'
  where client_opened_at is null
    and opened_at is not null;

-- 4. Policies (idempotent — skip if already present)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='proposal_views' and policyname='Contractor reads own views') then
    execute $p$ create policy "Contractor reads own views" on proposal_views for select
      using (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='proposal_views' and policyname='anon insert views') then
    execute $p$ create policy "anon insert views" on proposal_views for insert to anon with check (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='proposal_views' and policyname='auth insert views') then
    execute $p$ create policy "auth insert views" on proposal_views for insert to authenticated with check (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='proposal_views' and policyname='auth update views') then
    execute $p$ create policy "auth update views" on proposal_views for update to authenticated
      using (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
end $$;
