-- Standalone "Contracts" feature (js/agreements.js).
-- The global contracts[] array is already used by the maintenance / recurring-billing
-- feature (td_contracts). This feature stores its records in a dedicated agreements[]
-- array, synced through the per-record td_* pattern via a new td_agreements table.
--
-- E-signature reuses the existing public `proposals` storage bucket and the anon
-- INSERT/UPDATE storage policies created in 20260609_portfolio_cols_signed_proposals.sql,
-- so NO new bucket or storage policy is required. The signer (contract-sign.html) writes
-- the signed snapshot back to proposals/agreements/{user_id}/{id}_{token}.json under those
-- existing anon policies. Only the per-user sync table is added here.

create table if not exists td_agreements (
  id          text         not null,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  data        jsonb        not null default '{}',
  updated_at  timestamptz  not null default now(),
  deleted_at  timestamptz  default null,
  primary key (id, user_id)
);

alter table td_agreements enable row level security;

drop policy if exists "owner" on td_agreements;
create policy "owner" on td_agreements
  for all using (auth.uid()::text=user_id::text) with check (auth.uid()::text=user_id::text);

create index if not exists idx_td_agreements_user on td_agreements (user_id) where deleted_at is null;

-- Realtime: deliver per-record change events to the owner's other devices.
do $$
begin
  alter publication supabase_realtime add table td_agreements;
exception when duplicate_object then null;
end $$;
