-- Fix: new-account creation fails with "new row violates row-level security
-- policy for table accounts". Onboarding (settings.js obSubmit) signs the user in
-- to get a live session, then inserts an accounts row with owner_id = the new
-- user's id. The INSERT policy must check owner_id = auth.uid() with EXPLICIT
-- ::text casts — a bare `owner_id = auth.uid()` compares uuid to text and rejects
-- every insert. 20260529 added these casts; this re-asserts them idempotently in
-- case that migration never reached production. Bare-DB / migration-lint safe.
do $$ begin
  if to_regclass('public.accounts') is not null then
    execute 'alter table accounts enable row level security';
    -- INSERT: the owner can create their own account row.
    execute 'drop policy if exists "Account owner can insert" on accounts';
    execute 'create policy "Account owner can insert" on accounts for insert with check (owner_id::text = auth.uid()::text)';
    -- UPDATE: the owner can edit their own account row.
    execute 'drop policy if exists "Account owner can update" on accounts';
    execute 'create policy "Account owner can update" on accounts for update using (owner_id::text = auth.uid()::text)';
  end if;
end $$;
