-- CO-OWNER (owner 2026-09-26): "both are technically owners, just one runs the
-- business and Jack does all the tech ... no data moves, it's all there."
--
-- A co-owner is a second login on a business that already exists. Their rows
-- stay filed under the login that created the business (nothing moves); they
-- join through the ordinary crew link, and the server treats them as an owner.
--
-- WHERE THE AUTHORITY LIVES: account_users, role 'owner'. Only the account's
-- real owner can write that table (existing "Owner inserts memberships"), so
-- nothing a crew member can edit makes anybody an owner. The Team page's
-- "Owner / Admin" role is the switch: a trigger mirrors it into account_users,
-- and a guard makes sure only an owner can set it.
--
-- Additive only: new functions, new policies, one policy narrowed (zj_data,
-- crew keeps reading Settings but can no longer overwrite them).

-- ── is_co_owner(boss): the one definition ──────────────────────────────────
-- True when the caller holds an owner membership on boss's account AND is
-- still an active member of boss's team. Deactivating them on the Team page
-- revokes everything at once.
create or replace function public.is_co_owner(boss uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid()::text is not null
     and boss is not null
     and auth.uid()::text <> boss::text
     and exists (
       select 1 from account_users au
       join accounts a on a.id = au.account_id
       where a.owner_id::text = boss::text
         and au.user_id::text = auth.uid()::text
         and au.role = 'owner')
     and exists (
       select 1 from team_members tm
       where tm.contractor_user_id::text = boss::text
         and tm.employee_user_id::text = auth.uid()::text
         and tm.active);
$$;
grant execute on function public.is_co_owner(uuid) to authenticated;

-- ── Every record table: a co-owner is never redacted ───────────────────────
-- crew_perm already answers true for a member with every box ticked; this
-- makes the answer not depend on the boxes for a co-owner. Body otherwise
-- identical to the live definition (mirror of js/cloud.js _employeeRedactedTables).
create or replace function public.crew_perm(boss uuid, tbl text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_co_owner(boss) or exists(
    select 1 from team_members tm
    where tm.employee_user_id::text = auth.uid()::text
      and tm.contractor_user_id = boss
      and tm.active
      and case tbl
        when 'td_bids'     then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'estimate')::boolean,false)
        when 'td_income'   then coalesce((tm.permissions->>'financials')::boolean,false)
        when 'td_payments' then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'collect')::boolean,false)
        when 'td_liens'    then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'collect')::boolean,false)
        when 'td_expenses' then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'expenses')::boolean,false)
        when 'td_mileage'  then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'mileage')::boolean,false)
        else true
      end
  );
$$;

-- ── Settings (zj_data): crew reads, only an owner writes ────────────────────
-- The old crew policy was ALL, so any active crew member could overwrite the
-- owner's whole Settings blob. The app never did; the server allowed it.
drop policy if exists employee_access_contractor_data on public.zj_data;
create policy crew_read_contractor_settings on public.zj_data for select
  using (exists (select 1 from team_members tm
                 where tm.employee_user_id::text = auth.uid()::text
                   and tm.contractor_user_id::text = zj_data.user_id::text
                   and tm.active));
create policy co_owner_manages_settings on public.zj_data for all
  using (public.is_co_owner(user_id))
  with check (public.is_co_owner(user_id));

-- ── The rest of the owner-only tables ───────────────────────────────────────
create policy co_owner_manages_team on public.team_members for all
  using (public.is_co_owner(contractor_user_id))
  with check (public.is_co_owner(contractor_user_id));
create policy co_owner_manages_job_time on public.job_time_entries for all
  using (public.is_co_owner(contractor_user_id))
  with check (public.is_co_owner(contractor_user_id));
create policy co_owner_reads_timesheets on public.td_timesheets for select
  using (public.is_co_owner(contractor_user_id));
create policy co_owner_bid_history on public.td_bids_history for all
  using (public.is_co_owner(contractor_user_id))
  with check (public.is_co_owner(contractor_user_id));
create policy co_owner_permission_requests on public.td_permission_requests for all
  using (public.is_co_owner(contractor_user_id))
  with check (public.is_co_owner(contractor_user_id));
create policy co_owner_crew_invites on public.crew_invites for all
  using (public.is_co_owner(contractor_user_id))
  with check (public.is_co_owner(contractor_user_id));

-- ── Guard: a crew member edits only their own location fields ──────────────
-- "Employee updates own record" had no column limit, so a crew member could
-- tick their own permission boxes (and with this change, make themselves an
-- owner). The owner and co-owners change anything; the server (no auth.uid)
-- changes anything; the member themself may only join (null -> me, active)
-- and write location status.
create or replace function public.team_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare me text := auth.uid()::text;
begin
  if me is null then return new; end if;
  if me = old.contractor_user_id::text or public.is_co_owner(old.contractor_user_id) then return new; end if;
  if new.contractor_user_id is distinct from old.contractor_user_id
     or new.role is distinct from old.role
     or new.permissions is distinct from old.permissions
     or new.pay_type is distinct from old.pay_type
     or new.pay_rate is distinct from old.pay_rate
     or new.email is distinct from old.email
     or new.name is distinct from old.name
     or (new.employee_user_id is distinct from old.employee_user_id
         and not (old.employee_user_id is null and new.employee_user_id::text = me))
     or (new.active is distinct from old.active
         and not (old.employee_user_id is null and new.employee_user_id::text = me and new.active))
  then
    raise exception 'team_members: only the business owner can change that';
  end if;
  return new;
end $$;
drop trigger if exists team_members_guard on public.team_members;
create trigger team_members_guard before update on public.team_members
  for each row execute function public.team_members_guard();

-- ── Owner / Admin on the Team page IS the switch ───────────────────────────
-- Picking the role ticks every box, and once the person has joined, gives
-- them the owner membership. Changing the role, deactivating or removing them
-- takes it away. Never touches the account's own owner row.
create or replace function public.team_members_owner_fill()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'owner' then
    new.permissions := coalesce(new.permissions, '{}'::jsonb) || jsonb_build_object(
      'leads',true,'estimate',true,'schedule',true,'collect',true,'clients',true,
      'expenses',true,'mileage',true,'financials',true,'team',true,'payroll',true);
  end if;
  return new;
end $$;
drop trigger if exists team_members_owner_fill on public.team_members;
create trigger team_members_owner_fill before insert or update on public.team_members
  for each row execute function public.team_members_owner_fill();

create or replace function public.team_members_owner_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare acct uuid; owner_uid text; r team_members%rowtype;
begin
  r := coalesce(new, old);
  select a.id, a.owner_id::text into acct, owner_uid from accounts a where a.owner_id::text = r.contractor_user_id::text limit 1;
  if acct is null then return null; end if;
  -- Whoever held it before (the old person on this row) loses it unless they still qualify.
  if tg_op in ('UPDATE','DELETE') and old.employee_user_id is not null
     and old.employee_user_id::text <> owner_uid
     and (tg_op = 'DELETE' or not (new.role = 'owner' and new.active and new.employee_user_id = old.employee_user_id)) then
    delete from account_users where account_id = acct and user_id::text = old.employee_user_id::text and role = 'owner';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.role = 'owner' and new.active and new.employee_user_id is not null
     and new.employee_user_id::text <> owner_uid
     and not exists (select 1 from account_users where account_id = acct and user_id::text = new.employee_user_id::text and role = 'owner') then
    insert into account_users(account_id, user_id, role) values (acct, new.employee_user_id, 'owner');
  end if;
  return null;
end $$;
drop trigger if exists team_members_owner_sync on public.team_members;
create trigger team_members_owner_sync after insert or update or delete on public.team_members
  for each row execute function public.team_members_owner_sync();
