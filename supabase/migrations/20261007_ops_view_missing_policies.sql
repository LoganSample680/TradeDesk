-- ════════════════════════════════════════════════════════════════════════
-- Four tables never got their read policy, and this is why.
--
-- 20261005's policy loop aborted partway through on the shared database
-- (42883: ops_view_target(text) does not exist, device_status.user_id is text
-- there). The statements that had already run stayed, so production ended up
-- with 32 of the 36 policies and none of the tables the loop had not reached:
-- account_config, deposit_caps, inbound_leads and job_assignments.
--
-- 20261006 fixed the cause. This closes the hole it left, and it is written to
-- be safe whatever state a given database is in: it re-runs the same loop over
-- the same list, so a database that already has all 36 simply gets them again.
--
-- AND IT CARRIES ITS OWN OVERLOAD NOW, which is the second half of the same
-- story. Two files claimed version 20261005 on two branches, with two
-- different fixes for the type mismatch: this branch added a text overload and
-- bound the policy as ops_view_target(col::text); main looked the column type
-- up and cast to uuid at the call site. Supabase keys schema_migrations on the
-- VERSION, so the shared database recorded main's and this branch's copy can
-- never run there. Every statement below that says ::text then resolves to a
-- signature that does not exist, and the push dies on the first one:
--
--   ERROR: function public.ops_view_target(text) does not exist (SQLSTATE 42883)
--
-- Reproduced before fixing, on a scratch database built from this repo's full
-- history with main's 20261005 substituted in, which is exactly the shape the
-- shared project is in.
--
-- So this file no longer assumes an overload it did not create. Defining it
-- here is additive and idempotent: a database that already has it gets the
-- same body again, and one that does not gains it. The comparison is the
-- ::text-both-sides form the repo already uses everywhere auth.uid() is
-- compared, so a column holding something that is not a uuid matches no user,
-- which is the right answer rather than an error.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.ops_view_target(target text)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select public.is_ops_admin()
     and exists (select 1 from auth.users u where u.id::text = target);
$$;

comment on function public.ops_view_target(text) is
  'ops_view_target(uuid) for tables whose owner column is text. The policies bind this one.';

revoke execute on function public.ops_view_target(text) from public, anon;
grant  execute on function public.ops_view_target(text) to authenticated;

-- account_config hangs off accounts.id rather than a login, so its policy has to
-- resolve the account's owner. It does that through a definer function, NOT a
-- subquery on accounts: a policy that reads another table needs the caller to
-- hold SELECT on that table, and a missing grant turns the whole read into
-- "permission denied for table accounts" (caught on a scratch database before
-- this shipped) instead of simply returning nothing.
create or replace function public.ops_view_account(p_account uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.accounts a
     where a.id = p_account
       and public.ops_view_target(a.owner_id::text)
  );
$$;

revoke execute on function public.ops_view_account(uuid) from public, anon;
grant  execute on function public.ops_view_account(uuid) to authenticated;

do $$
declare
  t   text;
  col text;
begin
  foreach t in array array[
    'td_clients','td_bids','td_jobs','td_income','td_expenses','td_mileage',
    'td_payments','td_liens','td_time_entries','td_licenses','td_events',
    'td_contracts','td_agreements','td_photos','td_maintenance','td_vehicles',
    'td_places','td_scans','td_equipment','td_timesheets','zj_data',
    'team_members','job_time_entries','shop_time_entries','job_assignments',
    'location_pings','geo_events','geo_route_miles','geo_device_state',
    'device_status','signed_proposals','proposal_views','inbound_leads',
    'account_config','deposit_caps','accounts'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    select c.column_name into col
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = t
       and c.column_name in ('contractor_user_id','user_id','owner_id','account_id')
     order by array_position(array['contractor_user_id','user_id','owner_id','account_id'], c.column_name)
     limit 1;
    if col is null then
      raise notice 'ops_view_read: % has no owner column, skipped', t;
      continue;
    end if;
    if t = 'account_config' then
      execute 'drop policy if exists "ops_view_read" on account_config';
      execute 'create policy "ops_view_read" on account_config for select to authenticated using (public.ops_view_account(account_id))';
      continue;
    end if;
    execute format('drop policy if exists "ops_view_read" on %I', t);
    execute format(
      'create policy "ops_view_read" on %I for select to authenticated using (public.ops_view_target(%I::text))',
      t, col);
  end loop;
end $$;
