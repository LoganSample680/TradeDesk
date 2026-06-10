-- portfolio_accepted / portfolio_pct have been written by sign.html's submitCash()
-- but never had a migration. Environments built from migrations alone reject the
-- whole upsert with PGRST204 (unknown column) — surfaced to the client as
-- "Something went wrong" on the cash/check confirm button.
alter table signed_proposals
  add column if not exists portfolio_accepted boolean default false,
  add column if not exists portfolio_pct numeric;

-- E-signable Notice of Cancellation (client hub Documents tab). Client signs the
-- rescission notice digitally; contractor side flags the bid as client-cancelled
-- and reverses recorded payments.
alter table signed_proposals
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_signed_name text;

-- Drawn signature image (data URL). The storage-JSON copy can be lost when the
-- anon storage update fails — the DB copy guarantees documents always render
-- the actual signature, not just the typed name.
alter table signed_proposals
  add column if not exists signature_data text;

-- Re-assert the COMPLETE policy set for signed_proposals (idempotent).
-- The live DB rejected inserts from BOTH anon and authenticated roles with
-- "new row violates row-level security policy" — RLS is enabled there but the
-- policies from 20260506/20260603 never landed (or were dropped). Because the
-- old sign.html swallowed upsert errors, every client signature since then
-- failed silently. Re-asserting the full set repairs any drift.
alter table public.signed_proposals enable row level security;

drop policy if exists "anon_select"     on public.signed_proposals;
drop policy if exists "anon_insert"     on public.signed_proposals;
drop policy if exists "anon_update"     on public.signed_proposals;
drop policy if exists "auth_insert"     on public.signed_proposals;
drop policy if exists "auth_select_own" on public.signed_proposals;
drop policy if exists "auth_update_own" on public.signed_proposals;

-- Anon (client): sign.html needs SELECT (already-signed check), INSERT (submit), UPDATE (notified_at)
create policy "anon_select" on public.signed_proposals
  for select to anon using (true);

create policy "anon_insert" on public.signed_proposals
  for insert to anon with check (true);

create policy "anon_update" on public.signed_proposals
  for update to anon using (true) with check (true);

-- Authenticated: in-app signing inserts; contractor reads/updates own rows only
create policy "auth_insert" on public.signed_proposals
  for insert to authenticated with check (true);

create policy "auth_select_own" on public.signed_proposals
  for select to authenticated
  using (contractor_user_id::text = auth.uid()::text);

create policy "auth_update_own" on public.signed_proposals
  for update to authenticated
  using (contractor_user_id::text = auth.uid()::text)
  with check (contractor_user_id::text = auth.uid()::text);
