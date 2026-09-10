-- ════════════════════════════════════════════════════════════════════════
-- The operations dashboard: one contract, so the front end never queries a
-- table directly.
--
-- Owner 2026-09-10: "how many app actives, how many clock ins and outs,
-- average day, total miles, average miles per day, time between processes,
-- CI doesn't get counted, so much data we have in here that we can build a
-- damn good looking dashboard on."
--
-- He is right about the data. The product tables are thin before launch (10
-- clients, 51 bids) and two of them are badly polluted by the live flow suite,
-- which leaves its seed data on purpose (CLAUDE.md 12.7): 611 signed proposals
-- against 51 bids is CI, not customers. But the OPERATIONAL tables are deep
-- and clean, because no test run drives a truck around Topeka: 20,728 geo
-- events, 4,736 pings, 370 time entries, 55 GPS mileage legs. Every metric he
-- named comes out of those.
--
-- WHY VIEWS AND NOT QUERIES IN THE DASHBOARD. Whatever builds the front end,
-- Claude Design or anyone else, builds against these names and these shapes.
-- Neither side can then break the other: a column rename here is caught here,
-- and a dashboard cannot quietly invent its own definition of "an active day"
-- that disagrees with the one the rest of the company quotes. One definition
-- per number, which is 7.3 applied to reporting.
--
-- ACCESS. These read across every account, so they are for the internal
-- dashboard only and are reached with the service role. They are deliberately
-- NOT exposed to the app: nothing in js/ should ever select from them.
-- ════════════════════════════════════════════════════════════════════════

-- ── Who is not a customer ───────────────────────────────────────────────────
-- Every view below excludes these. A hardcoded list inside each view would
-- rot the first time an account is added, and "CI doesn't get counted" has to
-- keep being true a year from now without anybody remembering this file.
create table if not exists analytics_internal_accounts (
  user_id  uuid primary key,
  note     text,
  added_at timestamptz not null default now()
);
comment on table analytics_internal_accounts is
  'Accounts that are ours, not customers: support, dev, and the fleet test logins. Every ops view excludes them. Add a row to hide an account from the dashboard; delete it to count them again.';

alter table analytics_internal_accounts enable row level security;

-- Seeded by email pattern rather than by a pasted list of uuids, so this is
-- reproducible on a fresh project and reviewable by eye.
insert into analytics_internal_accounts (user_id, note)
select id, 'seeded 2026-09-17: support / fleet test login'
from auth.users
where email ilike 'tradedeskprosupport%'
on conflict (user_id) do nothing;

-- ── 0. Which account does a person belong to ────────────────────────────────
-- td_time_entries and td_mileage are keyed by the PERSON, so a per-contractor
-- rollup needs the same resolution ingest-telemetry does: a crew member has a
-- team_members row naming their employer, anybody else is their own account.
-- A link to yourself is not a crew link, or an owner who added themselves to
-- their own team gets filed as their own employee.
create or replace view v_person_account as
select u.id as employee_user_id,
       coalesce(tm.cid, u.id) as contractor_user_id,
       case when tm.cid is not null then 'crew' else 'owner' end as role
from auth.users u
left join lateral (
  select t.contractor_user_id as cid
  from team_members t
  where t.employee_user_id = u.id and t.active and t.contractor_user_id <> u.id
  order by t.created_at desc limit 1
) tm on true;

-- ── 1. App actives ──────────────────────────────────────────────────────────
-- A person was ACTIVE on a day if the app itself produced a signal that day.
-- Two independent sources, unioned rather than picked between: the lifecycle
-- events the phone writes (app-active, app-relaunch) prove the app ran even
-- when the WebView was suspended and wrote no telemetry, and the telemetry
-- rows prove a person was looking at a screen. Either one is enough; a phone
-- that only answered a silent push is NOT active, because nobody opened it.
create or replace view v_app_active_day as
select d.day, d.contractor_user_id, d.employee_user_id, bool_or(d.opened) as opened
from (
  select (e.ts at time zone 'America/Chicago')::date as day,
         e.contractor_user_id, e.employee_user_id,
         (e.type in ('app-active','app-relaunch')) as opened
  from geo_events e
  where e.type in ('app-active','app-relaunch','app-background')
  union all
  select (a.ts at time zone 'America/Chicago')::date,
         a.contractor_user_id, a.employee_user_id, true
  from analytics_events a
  where a.source = 'app' and a.contractor_user_id is not null
) d
where d.employee_user_id not in (select user_id from analytics_internal_accounts)
group by d.day, d.contractor_user_id, d.employee_user_id;

-- ── 2. Clock ins and outs, and the length of a day ──────────────────────────
-- The manual clock is the person's own statement about their day, which is
-- why it and not the tape defines "a day worked" (CLAUDE.md 17: the clock is
-- the bracket). An open clock has no end yet and is counted as a punch but
-- contributes no minutes, so today never drags the average down.
create or replace view v_clock_day as
select (( (t.data->>'start_time')::timestamptz) at time zone 'America/Chicago')::date as day,
       t.user_id as employee_user_id,
       count(*)                                                as punches,
       count(*) filter (where t.data->>'end_time' is not null) as closed,
       sum(case when t.data->>'end_time' is not null
                then extract(epoch from ((t.data->>'end_time')::timestamptz
                                       - (t.data->>'start_time')::timestamptz))/60.0
           end)::numeric(10,1)                                 as worked_min,
       min((t.data->>'start_time')::timestamptz)               as first_in,
       max((t.data->>'end_time')::timestamptz)                 as last_out
from td_time_entries t
where t.deleted_at is null
  and t.data->>'start_time' is not null
  and t.user_id not in (select user_id from analytics_internal_accounts)
group by 1, 2;

-- ── 3. Miles ────────────────────────────────────────────────────────────────
-- ONLY ADDRESSED TRIPS COUNT (owner 2026-09-08). A traced leg with an end
-- nobody has named is shown on the log and claimed by nothing, so it is
-- counted separately here rather than folded in. Reporting them together is
-- exactly the mistake the flag exists to prevent.
create or replace view v_miles_day as
select (m.data->>'date')::date as day,
       m.user_id as employee_user_id,
       count(*) filter (where coalesce(m.data->>'addressUnknown','false') <> 'true') as legs,
       coalesce(sum((m.data->>'miles')::numeric)
                filter (where coalesce(m.data->>'addressUnknown','false') <> 'true'), 0)::numeric(10,1) as miles,
       count(*) filter (where m.data->>'addressUnknown' = 'true')       as legs_unnamed,
       coalesce(sum((m.data->>'miles')::numeric)
                filter (where m.data->>'addressUnknown' = 'true'), 0)::numeric(10,1) as miles_unnamed
from td_mileage m
where m.deleted_at is null
  and m.data->>'gps' = 'true'
  and m.data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
  and m.user_id not in (select user_id from analytics_internal_accounts)
group by 1, 2;

-- ── 4. Where the day went ───────────────────────────────────────────────────
-- The deriver's own rows, read as stored (CLAUDE.md 17: the screens read, they
-- never correct). Drive time, time standing at a customer, time at the yard,
-- and the stops nobody has named yet, which is the number that says how much
-- of the day is still a question.
create or replace view v_time_day as
select day, employee_user_id, contractor_user_id,
       sum(minutes) filter (where source = 'drive')                        as drive_min,
       sum(minutes) filter (where source in ('client','geofence','place'))  as site_min,
       sum(minutes) filter (where source = 'unsaved')                       as unnamed_min,
       sum(minutes) filter (where source = 'client-held')                   as held_min,
       count(*)     filter (where source = 'drive')                         as drives,
       count(*)     filter (where source in ('client','geofence','place'))  as visits
from (
  select (arrived_at at time zone 'America/Chicago')::date as day,
         employee_user_id, contractor_user_id, source, minutes
  from job_time_entries
  where departed_at is not null
) r
where employee_user_id not in (select user_id from analytics_internal_accounts)
group by day, employee_user_id, contractor_user_id;

create or replace view v_shop_day as
select (arrived_at at time zone 'America/Chicago')::date as day,
       employee_user_id, contractor_user_id,
       sum(minutes) as shop_min, count(*) as shop_visits
from shop_time_entries
where departed_at is not null
  and employee_user_id not in (select user_id from analytics_internal_accounts)
group by 1, 2, 3;

-- ── 5. Time between processes ───────────────────────────────────────────────
-- The gaps a person actually feels, per day: how long after clocking in the
-- first wheel turns, and how long a visit lasts. Both come off rows that
-- already exist; neither is derived twice.
create or replace view v_gap_day as
with first_drive as (
  select (arrived_at at time zone 'America/Chicago')::date as day,
         employee_user_id, min(arrived_at) as first_move
  from job_time_entries where source = 'drive' group by 1, 2
)
select c.day, c.employee_user_id,
       round(extract(epoch from (f.first_move - c.first_in))/60.0)::int as clockin_to_first_drive_min,
       t.site_min, t.visits,
       case when t.visits > 0 then round(t.site_min::numeric / t.visits, 1) end as avg_visit_min
from v_clock_day c
left join first_drive f on f.day = c.day and f.employee_user_id = c.employee_user_id
left join v_time_day  t on t.day = c.day and t.employee_user_id = c.employee_user_id;

-- ── 6. The one the dashboard reads ──────────────────────────────────────────
-- One row per person per day, every number above on it. A dashboard tile is a
-- column here, never a join written in the front end.
create or replace view v_ops_daily as
select coalesce(a.day, cl.day, mi.day, ti.day, sh.day)                       as day,
       coalesce(a.employee_user_id, cl.employee_user_id, mi.employee_user_id,
                ti.employee_user_id, sh.employee_user_id)                    as employee_user_id,
       -- Resolved for EVERY row, not just the ones whose source table carried
       -- it: the clock and the mileage tables are keyed by person alone.
       pa.contractor_user_id,
       pa.role,
       coalesce(a.opened, false)        as app_opened,
       coalesce(cl.punches, 0)          as clock_punches,
       coalesce(cl.closed, 0)           as clocks_closed,
       cl.worked_min,
       coalesce(mi.legs, 0)             as mileage_legs,
       coalesce(mi.miles, 0)            as miles,
       coalesce(mi.legs_unnamed, 0)     as mileage_legs_unnamed,
       ti.drive_min, ti.site_min, ti.unnamed_min, ti.held_min,
       coalesce(ti.drives, 0)           as drives,
       coalesce(ti.visits, 0)           as visits,
       coalesce(sh.shop_min, 0)         as shop_min
from            v_app_active_day a
full outer join v_clock_day  cl on cl.day = a.day  and cl.employee_user_id = a.employee_user_id
full outer join v_miles_day  mi on mi.day = coalesce(a.day, cl.day)  and mi.employee_user_id = coalesce(a.employee_user_id, cl.employee_user_id)
full outer join v_time_day   ti on ti.day = coalesce(a.day, cl.day, mi.day) and ti.employee_user_id = coalesce(a.employee_user_id, cl.employee_user_id, mi.employee_user_id)
full outer join v_shop_day   sh on sh.day = coalesce(a.day, cl.day, mi.day, ti.day) and sh.employee_user_id = coalesce(a.employee_user_id, cl.employee_user_id, mi.employee_user_id, ti.employee_user_id)
left join v_person_account pa on pa.employee_user_id = coalesce(a.employee_user_id, cl.employee_user_id, mi.employee_user_id, ti.employee_user_id, sh.employee_user_id);

comment on view v_ops_daily is
  'One row per person per day: app opened, clock punches, minutes worked, miles, drive/site/shop minutes. The dashboard''s main table. Internal accounts excluded.';

-- ── 7. The headline numbers, one row ────────────────────────────────────────
-- Averages are taken over the days that HAPPENED, never over the calendar. A
-- contractor who worked nine days last month has a nine-day average; dividing
-- by thirty would report him as half as busy as he is.
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
language sql stable security definer set search_path = public as $$
  select (p_to - p_from) + 1,
         count(distinct employee_user_id)::int,
         count(distinct contractor_user_id)::int,
         count(*) filter (where app_opened),
         sum(clock_punches),
         count(*) filter (where clocks_closed > 0),
         round(avg(worked_min) filter (where worked_min > 0), 1),
         round(sum(miles), 1),
         round(avg(miles) filter (where miles > 0), 1),
         count(*) filter (where miles > 0),
         sum(drive_min),
         sum(site_min),
         round((sum(site_min)::numeric / nullif(sum(visits), 0)), 1),
         sum(unnamed_min),
         sum(mileage_legs_unnamed)
  from v_ops_daily
  where day between p_from and p_to;
$$;

comment on function ops_summary(date, date) is
  'The dashboard header, one row. Averages are over days that happened, not over the calendar.';

-- ── 8. The same numbers, per contractor ─────────────────────────────────────
-- Owner 2026-09-10: "that's overall but want it by contractor." One row per
-- BUSINESS, with its crew folded in, because a two-truck shop's numbers are
-- the shop's numbers and not two people's. `people` says how many of them
-- there were, which is the count that turns a total into a rate.
create or replace function ops_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business           text,   -- the owner's email: settings are not queryable
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
language sql stable security definer set search_path = public as $$
  select d.contractor_user_id,
         -- The business NAME lives in the settings snapshot, not a table, so
         -- there is nothing to join to. The owner's email identifies the
         -- account unambiguously and is enough for an internal screen; the
         -- dashboard can show a friendlier label once settings are queryable.
         coalesce(o.email, d.contractor_user_id::text),
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
  left join auth.users o on o.id = d.contractor_user_id
  where d.day between p_from and p_to
    and d.contractor_user_id is not null
  group by d.contractor_user_id, o.email
  order by count(*) filter (where d.app_opened) desc;
$$;

comment on function ops_by_contractor(date, date) is
  'One row per business over a date range, crew folded in. The dashboard''s account list: sorted by active days, so the quiet accounts sink to the bottom where they belong.';
