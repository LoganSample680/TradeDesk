-- URGENT: Fix infinite recursion in account_users RLS policy.
--
-- The "Owner can manage memberships" policy was FOR ALL with a subquery that
-- SELECTs from account_users itself:
--
--   using (account_id in (select account_id from account_users where user_id = auth.uid() and role = 'owner'))
--
-- When ANY other table's policy queries account_users (e.g. vehicles, accounts,
-- account_config all do this), Postgres evaluates account_users policies —
-- including FOR ALL which covers SELECT — and that triggers the self-reference
-- again → error 42P17: infinite recursion.
--
-- Fix: drop the recursive FOR ALL policy. Replace write access (INSERT/UPDATE/DELETE)
-- with non-recursive policies that check ownership via the accounts table instead.

drop policy if exists "Owner can manage memberships" on account_users;

do $$ begin
  -- INSERT: new member can only be added to an account the caller owns
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner inserts memberships') then
    execute $p$
      create policy "Owner inserts memberships" on account_users for insert
        with check (
          account_id::text in (
            select id::text from accounts where owner_id::text = auth.uid()::text
          )
        )
    $p$;
  end if;

  -- UPDATE: can only update membership rows for accounts the caller owns
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner updates memberships') then
    execute $p$
      create policy "Owner updates memberships" on account_users for update
        using (
          account_id::text in (
            select id::text from accounts where owner_id::text = auth.uid()::text
          )
        )
    $p$;
  end if;

  -- DELETE: can only remove membership rows for accounts the caller owns
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner deletes memberships') then
    execute $p$
      create policy "Owner deletes memberships" on account_users for delete
        using (
          account_id::text in (
            select id::text from accounts where owner_id::text = auth.uid()::text
          )
        )
    $p$;
  end if;
end $$;
