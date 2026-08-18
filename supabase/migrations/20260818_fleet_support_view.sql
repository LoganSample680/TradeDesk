-- Fleet support view (owner ask 2026-08-18): the tradedeskprosupport account
-- can list and READ every seeded test-fleet persona (tradedeskprosupport+tNN@,
-- created by tests/flow/fleet-seed.spec.js) through the app's existing Dev
-- Support View machinery (_devLoadUserAccount), so each persona's data can be
-- probed live without signing out.
--
-- Authorization model, all server-side:
--   • _fleet_support_caller(): the caller IS the support account (exact email,
--     never an alias, so no fleet persona can call this about the others).
--   • _fleet_member_uid(target): the target IS a fleet persona (plus-alias
--     pattern of the support inbox).
--   • fleet_support_roster(): tag + uid + business name for the switcher UI;
--     returns zero rows for anyone but the support account, which the client
--     treats as "not authorized, show nothing".
--   • One SELECT policy per td_* table + zj_data: support account reads fleet
--     rows. READ ONLY on purpose: probing is viewing; no write policies, so a
--     stray save from support view can never alter a persona's data.
-- Idempotent and bare-DB safe (to_regclass guards), like every migration here.

create or replace function public._fleet_support_caller() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists(
    select 1 from auth.users
    where id = auth.uid() and email = 'tradedeskprosupport@gmail.com'
  );
$$;

create or replace function public._fleet_member_uid(target uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists(
    select 1 from auth.users
    where id = target and email like 'tradedeskprosupport+t%@gmail.com'
  );
$$;

create or replace function public.fleet_support_roster()
returns table(tag text, user_id uuid, email text, business_name text)
language sql stable security definer set search_path = public, auth as $$
  select
    split_part(split_part(u.email, '+', 2), '@', 1) as tag,
    u.id as user_id,
    u.email,
    a.business_name
  from auth.users u
  left join public.accounts a on a.owner_id::text = u.id::text
  where public._fleet_support_caller()
    and u.email like 'tradedeskprosupport+t%@gmail.com'
  order by u.email;
$$;
grant execute on function public.fleet_support_roster() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'td_clients','td_bids','td_jobs','td_income','td_expenses','td_mileage',
    'td_payments','td_liens','td_time_entries','td_licenses','td_events',
    'td_contracts','td_agreements','td_photos','td_maintenance','td_vehicles',
    'td_places','td_scans','td_equipment','zj_data'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "fleet_support_read" on %I', t);
      execute format(
        'create policy "fleet_support_read" on %I for select using (public._fleet_support_caller() and public._fleet_member_uid(user_id))',
        t
      );
    end if;
  end loop;
  -- team_members rows hang off the CONTRACTOR uid, needed to probe the fleet's
  -- crew links (the dual-hat topology) from support view.
  if to_regclass('public.team_members') is not null then
    execute 'drop policy if exists "fleet_support_read" on team_members';
    execute 'create policy "fleet_support_read" on team_members for select using (public._fleet_support_caller() and public._fleet_member_uid(contractor_user_id))';
  end if;
end $$;
