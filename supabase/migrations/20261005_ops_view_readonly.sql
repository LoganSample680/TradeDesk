-- ════════════════════════════════════════════════════════════════════════
-- Ops support view: look at a real account through the real app, read only.
--
-- 20260819_fleet_support_view.sql already built exactly this shape, but only
-- for the 25 seeded fleet personas (tradedeskprosupport+tNN@). The owner needs
-- the same thing pointed at REAL accounts (Jack, Blake, Zach, anyone future),
-- opened as the PERSON sees it, switchable between the people on one account.
--
-- Authorization is the ops allowlist that already gates every ops_* reporting
-- function (analytics_admins / is_ops_admin(), 20260919). A link is never the
-- gate: a leaked URL is worthless to anyone not on that table.
--
-- READ ONLY, and it is the database that says so, not the client. Every policy
-- below is `for select`. No insert, update or delete policy is created for an
-- ops admin anywhere, so a stray save from support view cannot alter a single
-- row even if every client guard failed at once. Same posture the fleet view
-- has held since August.
--
-- Idempotent and bare-DB safe (to_regclass guards), like every migration here.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Who may look, and at what ────────────────────────────────────────────
-- is_ops_admin() answers "may this caller look at all". This wrapper adds the
-- only other condition: the target is a real signed-up user. Kept as its own
-- function so every policy states the same rule once.
create or replace function public.ops_view_target(target uuid)
returns boolean
language sql stable security definer set search_path = public, auth as $$
  -- ::text on both sides, the repo rule (20260701, 20260923): a bare
  -- uuid = auth.uid() silently matches nothing on a drifted schema.
  select public.is_ops_admin()
     and exists (select 1 from auth.users u where u.id::text = target::text);
$$;

comment on function public.ops_view_target(uuid) is
  'True when the caller is an ops admin and the target is a real user. The only gate on the read-only support view.';

revoke execute on function public.ops_view_target(uuid) from public, anon;
grant  execute on function public.ops_view_target(uuid) to authenticated;

-- ── 2. Read policies, one per table the app actually reads ──────────────────
-- Anything missed here does not break the view, it renders that screen empty,
-- which is worse than an error because it looks like the user has no data. The
-- geo/time tables are in the list for exactly that reason: the Time Log and the
-- day map are the screens this thing gets opened to look at.
--
-- The owning column is LOOKED UP, not assumed. The first cut of this migration
-- sorted the tables into a user_id list and a contractor_user_id list by hand
-- and td_timesheets was in the wrong one, so `create policy ... using
-- (ops_view_target(user_id))` failed on a column that table does not have and
-- took the whole migration down with it (Supabase preview, 42703). Whichever of
-- the three owner columns a table actually carries is the one its policy uses,
-- and a table carrying none is skipped instead of raising.
--
-- AND SO IS ITS TYPE (2026-09-12). The lookup above fixed the column NAME and
-- still assumed the type, which took the whole migration down a second time in
-- the same place: ops_view_target takes uuid, proposal_views.contractor_user_id
-- is text on the live project, so the policy asked for ops_view_target(text)
-- and Postgres has no such overload (42883). Every deploy since the portal
-- merged has failed on it, which is why the portal shipped with no read
-- policies at all.
--
-- It passed the migration lint because the lint is right and PRODUCTION has
-- drifted: 20200101000000_initial_schema.sql and 20260527 both declare that
-- column uuid, so a database built from this repo's own history has the type
-- the function wants and the live one does not. A lint cannot catch a schema
-- that disagrees with the migrations that built it.
--
-- So the type is looked up the same way the name is, and the value is cast
-- only when it is not already uuid. That is correct against both shapes, which
-- is what a migration facing a drifted database has to be. The cast is safe
-- here: all 546 rows hold a well-formed uuid and none is null.
do $$
declare
  t    text;
  col  text;
  ctyp text;
begin
  foreach t in array array[
    -- the per-record sync fabric plus the settings blob
    'td_clients','td_bids','td_jobs','td_income','td_expenses','td_mileage',
    'td_payments','td_liens','td_time_entries','td_licenses','td_events',
    'td_contracts','td_agreements','td_photos','td_maintenance','td_vehicles',
    'td_places','td_scans','td_equipment','td_timesheets','zj_data',
    -- the business's crew, their time, their day
    'team_members','job_time_entries','shop_time_entries','job_assignments',
    'location_pings','geo_events','geo_route_miles','geo_device_state',
    'device_status','signed_proposals','proposal_views','inbound_leads',
    'account_config','deposit_caps','accounts'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    select c.column_name, c.data_type into col, ctyp
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = t
       and c.column_name in ('contractor_user_id','user_id','owner_id')
     order by array_position(array['contractor_user_id','user_id','owner_id'], c.column_name)
     limit 1;
    if col is null then
      raise notice 'ops_view_read: % has no owner column, skipped', t;
      continue;
    end if;
    execute format('drop policy if exists "ops_view_read" on %I', t);
    execute format(
      'create policy "ops_view_read" on %I for select to authenticated using (public.ops_view_target(%I%s))',
      t, col, case when ctyp = 'uuid' then '' else '::uuid' end);
  end loop;
end $$;

-- ── 3. The roster: every business, every person on it ───────────────────────
-- One row per PERSON, because that is what the switcher switches between: the
-- owner is a row too (role 'owner'), so opening a business and switching to a
-- crew member are the same operation with a different row. Nobody is hardcoded
-- the way Zach's uid is in js/cloud.js today; a user who signs up tomorrow is
-- in this roster the moment they exist.
create or replace function public.ops_view_roster()
returns table (
  contractor_user_id uuid,
  business           text,
  person_user_id     uuid,
  person_name        text,
  person_email       text,
  role               text,
  permissions        jsonb,
  active             boolean,
  last_seen          timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  with owners as (
    select distinct on (z.user_id)
           z.user_id as contractor_user_id,
           coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown') as business,
           z.user_id as person_user_id,
           coalesce(nullif(btrim(u2.name), ''), u.email) as person_name,
           u.email as person_email,
           'owner'::text as role,
           '{}'::jsonb as permissions,
           true as active,
           z.updated_at as last_seen
      from zj_data z
      join auth.users u on u.id::text = z.user_id::text
      left join public.accounts a on a.owner_id::text = z.user_id::text
      left join public.users u2 on u2.id::text = z.user_id::text
     order by z.user_id, a.created_at desc nulls last
  ),
  crew as (
    select tm.contractor_user_id,
           coalesce(nullif(btrim(a.business_name), ''), ou.email, 'Unknown') as business,
           tm.employee_user_id as person_user_id,
           tm.name as person_name,
           tm.email as person_email,
           coalesce(nullif(tm.role, ''), 'crew') as role,
           coalesce(tm.permissions, '{}'::jsonb) as permissions,
           coalesce(tm.active, true) as active,
           tm.joined_at as last_seen
      from team_members tm
      left join public.accounts a on a.owner_id::text = tm.contractor_user_id::text
      left join auth.users ou on ou.id::text = tm.contractor_user_id::text
     where tm.employee_user_id is not null
  )
  select * from (
    select * from owners
    union all
    select * from crew
  ) r
  where public.is_ops_admin()
  order by r.business, (r.role <> 'owner'), r.person_name;
$$;

comment on function public.ops_view_roster() is
  'Every business and every person on it, for the support-view switcher. Returns zero rows for anyone not on the ops allowlist.';

revoke execute on function public.ops_view_roster() from public, anon;
grant  execute on function public.ops_view_roster() to authenticated;

-- ── 4. Every look is on the record ──────────────────────────────────────────
-- Support access to real customer data is disclosed in the Terms accepted at
-- signup. A disclosure with no log behind it is a promise nobody can check, so
-- each open writes a row: who looked, whose account, which person's view.
create table if not exists ops_view_log (
  id          bigserial primary key,
  viewer_id   uuid not null,
  target_uid  uuid not null,
  person_uid  uuid,
  business    text,
  opened_at   timestamptz not null default now()
);

alter table ops_view_log enable row level security;
revoke all on ops_view_log from anon, authenticated;

-- Definer insert: the log is not writable by hand, only by opening a view.
create or replace function public.ops_view_open(p_target uuid, p_person uuid)
returns void
language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.ops_view_target(p_target) then
    raise exception 'ops view: not authorized' using errcode = '42501';
  end if;
  insert into ops_view_log (viewer_id, target_uid, person_uid, business)
  select (auth.uid()::text)::uuid, p_target, p_person,
         (select coalesce(nullif(btrim(a.business_name), ''), u.email)
            from auth.users u
            left join public.accounts a on a.owner_id::text = p_target::text
           where u.id::text = p_target::text);
end;
$$;

revoke execute on function public.ops_view_open(uuid, uuid) from public, anon;
grant  execute on function public.ops_view_open(uuid, uuid) to authenticated;

-- ── 5. Storage: photos and receipts, or the view lies about what is there ───
-- Without these, every job photo and receipt 403s inside the support view and
-- the account looks emptier than it is.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "ops_view_read_objects" on storage.objects;
    create policy "ops_view_read_objects" on storage.objects
      for select to authenticated
      using (bucket_id in ('receipts','gallery','proposals') and public.is_ops_admin());
  end if;
end $$;
