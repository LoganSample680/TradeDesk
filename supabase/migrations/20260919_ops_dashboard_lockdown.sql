-- ════════════════════════════════════════════════════════════════════════
-- Ops dashboard: shut the door, then name the businesses.
--
-- 20260917 built the views and left them wide open. Every v_* ops view is
-- owned by postgres with no security_invoker, so it reads THROUGH the RLS on
-- job_time_entries, mileage_legs and analytics_events instead of under it,
-- and Supabase's default grants hand SELECT on all of them to anon and
-- authenticated. Anyone holding the publishable key could read every
-- contractor's hours, miles and job sites. ops_summary() and
-- ops_by_contractor() are security definer with no grant clause, which in
-- Postgres means EXECUTE to PUBLIC: same hole through a nicer door.
-- analytics_internal_accounts was worse still, anon could INSERT into it and
-- hide any account from the numbers.
--
-- This is a developer console, not a product surface. Nobody but a named
-- developer reads it, so the gate is an explicit allowlist and the views stop
-- being reachable at all. Three definer functions are the whole contract.
--
-- Second thing: ops_by_contractor labelled each business with the owner's
-- EMAIL, because when it was written I had not found the accounts table. The
-- name lives on accounts.business_name. Joined here.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Who is allowed to look ───────────────────────────────────────────────
create table if not exists analytics_admins (
  user_id uuid primary key,
  note    text,
  added_at timestamptz not null default now()
);

alter table analytics_admins enable row level security;

drop policy if exists analytics_admins_self on analytics_admins;
create policy analytics_admins_self on analytics_admins
  for select to authenticated
  using (user_id = auth.uid());

revoke all on analytics_admins from anon, authenticated;
grant select on analytics_admins to authenticated;

insert into analytics_admins (user_id, note)
select id, 'owner' from auth.users where email = 'logansample97@gmail.com'
on conflict (user_id) do nothing;

create or replace function is_ops_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from analytics_admins where user_id = auth.uid());
$$;

comment on function is_ops_admin() is
  'True when the caller is on the ops-dashboard allowlist. The only gate on the ops_* reporting functions.';

-- ── 2. Close the exclusion list ─────────────────────────────────────────────
-- An open INSERT here let anyone erase an account from every ops number.
alter table analytics_internal_accounts enable row level security;
revoke all on analytics_internal_accounts from anon, authenticated;

-- ── 3. Close the views ──────────────────────────────────────────────────────
-- They bypass RLS by construction. Nothing outside the database reads them
-- again; the functions below are the only way in.
revoke all on v_person_account, v_app_active_day, v_clock_day, v_miles_day,
              v_time_day, v_shop_day, v_gap_day, v_ops_daily
  from anon, authenticated;

-- ── 4. Close the functions ──────────────────────────────────────────────────
revoke execute on function ops_summary(date, date) from public, anon;
revoke execute on function ops_by_contractor(date, date) from public, anon;
grant  execute on function ops_summary(date, date) to authenticated;
grant  execute on function ops_by_contractor(date, date) to authenticated;
grant  execute on function is_ops_admin() to authenticated;

-- ── 5. Rebuild the two readers, gated, with real business names ─────────────
create or replace function ops_summary(p_from date, p_to date)
returns table (
  days              int,
  people            int,
  accounts          int,
  active_days       bigint,
  clock_punches     bigint,
  days_clocked      bigint,
  avg_day_min       numeric,
  total_miles       numeric,
  avg_miles_per_day numeric,
  days_driven       bigint,
  total_drive_min   bigint,
  total_site_min    bigint,
  avg_visit_min     numeric,
  unnamed_min       bigint,
  unnamed_legs      bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select (p_to - p_from) + 1,
         count(distinct d.employee_user_id)::int,
         count(distinct d.contractor_user_id)::int,
         count(*) filter (where d.app_opened),
         sum(d.clock_punches),
         count(*) filter (where d.clocks_closed > 0),
         round(avg(d.worked_min) filter (where d.worked_min > 0), 1),
         round(sum(d.miles), 1),
         round(avg(d.miles) filter (where d.miles > 0), 1),
         count(*) filter (where d.miles > 0),
         sum(d.drive_min),
         sum(d.site_min),
         round(sum(d.site_min)::numeric / nullif(sum(d.visits), 0), 1),
         sum(d.unnamed_min),
         sum(d.mileage_legs_unnamed)
  from v_ops_daily d
  where d.day between p_from and p_to;
end;
$$;

create or replace function ops_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business           text,
  people             int,
  crew               int,
  active_days        bigint,
  clock_punches      bigint,
  days_clocked       bigint,
  avg_day_min        numeric,
  total_miles        numeric,
  avg_miles_per_day  numeric,
  drive_min          bigint,
  site_min           bigint,
  shop_min           bigint,
  visits             bigint,
  avg_visit_min      numeric,
  unnamed_min        bigint,
  unnamed_legs       bigint,
  last_active        date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.contractor_user_id,
         -- The business's own name. Falls back to the owner's email only when
         -- an account row has never been written (a signup that never finished).
         coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown'),
         count(distinct d.employee_user_id)::int,
         count(distinct d.employee_user_id) filter (where d.role = 'crew')::int,
         count(*) filter (where d.app_opened),
         sum(d.clock_punches),
         count(*) filter (where d.clocks_closed > 0),
         round(avg(d.worked_min) filter (where d.worked_min > 0), 1),
         round(sum(d.miles), 1),
         round(avg(d.miles) filter (where d.miles > 0), 1),
         sum(d.drive_min), sum(d.site_min), sum(d.shop_min), sum(d.visits),
         round(sum(d.site_min)::numeric / nullif(sum(d.visits), 0), 1),
         sum(d.unnamed_min), sum(d.mileage_legs_unnamed),
         max(d.day) filter (where d.app_opened)
  from v_ops_daily d
  left join accounts a on a.owner_id = d.contractor_user_id
  left join auth.users u on u.id = d.contractor_user_id
  where d.day between p_from and p_to
    and d.contractor_user_id is not null
  group by d.contractor_user_id, a.business_name, u.email
  order by count(*) filter (where d.app_opened) desc;
end;
$$;

-- ── 6. The daily table, same gate ───────────────────────────────────────────
-- v_ops_daily is no longer readable from outside. This is how the dashboard
-- draws a trend line without a join written in the front end.
create or replace function ops_daily(p_from date, p_to date)
returns table (
  day                  date,
  contractor_user_id   uuid,
  business             text,
  employee_user_id     uuid,
  role                 text,
  app_opened           boolean,
  clock_punches        bigint,
  worked_min           bigint,
  miles                numeric,
  mileage_legs         bigint,
  mileage_legs_unnamed bigint,
  drive_min            bigint,
  site_min             bigint,
  shop_min             bigint,
  unnamed_min          bigint,
  drives               bigint,
  visits               bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.day, d.contractor_user_id,
         coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown'),
         d.employee_user_id, d.role,
         d.app_opened, d.clock_punches, d.worked_min,
         round(d.miles::numeric, 1), d.mileage_legs, d.mileage_legs_unnamed,
         d.drive_min, d.site_min, d.shop_min, d.unnamed_min,
         d.drives, d.visits
  from v_ops_daily d
  left join accounts a on a.owner_id = d.contractor_user_id
  left join auth.users u on u.id = d.contractor_user_id
  where d.day between p_from and p_to
  order by d.day, 3;
end;
$$;

comment on function ops_daily(date, date) is
  'One row per person per day for the ops dashboard. Allowlist-gated. Returns nothing to a caller who is not an ops admin.';

revoke execute on function ops_daily(date, date) from public, anon;
grant  execute on function ops_daily(date, date) to authenticated;
