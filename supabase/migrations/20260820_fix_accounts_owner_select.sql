-- Second, independent new-signup breaker (found live by the fleet seeder
-- 2026-08-18, still 403 AFTER 20260701's cast fix was applied):
--
-- obSubmit (and the seeder mirroring it) creates the account with
-- INSERT ... RETURNING (.select() on the insert). Postgres requires RETURNING
-- rows to be visible under a SELECT policy, and the ONLY select policy on
-- accounts ("Account members can read") needs an account_users membership row,
-- which onboarding can only insert AFTER it has the returned account id.
-- Chicken-and-egg: every fresh signup dies with the same misleading "new row
-- violates row-level security policy" error the WITH CHECK failure produces,
-- so it reads as an insert-policy bug when the failing half is the RETURNING
-- visibility.
--
-- Fix: the owner can always read their own accounts row. Idempotent, additive,
-- bare-DB safe.
do $$ begin
  if to_regclass('public.accounts') is not null then
    execute 'drop policy if exists "Account owner can read" on accounts';
    execute 'create policy "Account owner can read" on accounts for select using (owner_id::text = auth.uid()::text)';
  end if;
end $$;
