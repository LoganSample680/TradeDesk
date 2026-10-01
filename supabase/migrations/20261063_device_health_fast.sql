-- 20261063: the Phones card read every phone on the platform to show one
-- (owner 2026-10-01: "getting a cancelling statement due to statement timeout
-- on the ops portal ... on jacks account specifically").
--
-- Root cause: device_days_by_person (20261061) took only a date range, so the
-- person view, the month/year views and the account brief each scanned all
-- users' battery, stats, MetricKit and radio rows for 30 days and only then
-- kept one person or one account. The access check was also written per row,
-- so is_ops_admin() ran once for every one of those rows. Under the signed-in
-- role that was about two seconds a call, and the page makes four at once
-- (days, months, years, brief), past the 8 second limit for a signed-in user.
--
-- Now the people are picked first (the one person, or the account's owner
-- and crew list) and each one's rows come straight off the (employee, type,
-- ts) index, and the access check runs once per call. Measured on the real
-- data under a generic plan: the event scan went from about two seconds to
-- about 20 milliseconds. Same rows, same values: the new
-- arguments default to null, so a two-argument call means what it always did.
--
-- The functions are dropped and re-made because Postgres cannot add an
-- argument with create or replace. Nothing else references them by signature,
-- and the readers are re-made below in the same transaction.

drop function if exists public.device_rollup(date, date, text, text);
drop function if exists public.device_days_by_person(date, date);

create function public.device_days_by_person(p_from date, p_to date,
                                             p_person uuid default null, p_contractor uuid default null)
returns table (
  person_user_id     uuid,
  contractor_user_id uuid,
  day                date,
  drain_hr           numeric,
  batt_first         int,
  batt_last          int,
  batt_low           int,
  heat               text,
  low_power_days     int,
  bg_refresh         text,
  gps_min            int,
  kills              int,
  wakes              int,
  cpu_max            numeric,
  mem_max            numeric,
  apple_gps_min      int,
  apple_bg_loc_min   int,
  apple_cpu_min      numeric,
  ios_ended          int,
  ended_why          text,
  crashes            int,
  cell_mb            numeric,
  bars               numeric,
  loc_perm           text,
  network            text
)
language sql stable security definer set search_path = public as $$
  -- Whose phones, decided BEFORE any event is read: the one person asked
  -- for; else everyone on the account (its owner and its crew list); else
  -- everybody. The access check runs once here, not once per event.
  with who as (
    select p_person as uid where p_person is not null
    union
    select p_contractor where p_person is null and p_contractor is not null
    union
    select t.employee_user_id from team_members t
     where p_person is null and p_contractor is not null
       and t.contractor_user_id = p_contractor and t.employee_user_id is not null
    union
    select u.id from auth.users u where p_person is null and p_contractor is null
  ),
  allowed as (
    select uid from who
     where (select public.is_ops_admin()) or uid::text = (select auth.uid()::text)
  ),
  -- Each person's rows straight off the (employee, type, ts) index.
  ev as (
    select e.*, (e.ts at time zone 'America/Chicago') as lt
      from allowed w cross join lateral (
        select g.employee_user_id as uid, g.contractor_user_id as cid, g.type, g.ts, g.kind, g.region_id, g.detail
          from geo_events g
         where g.employee_user_id = w.uid
           and g.type in ('battery', 'push-ping', 'heartbeat', 'app-terminate', 'radio')
           and g.ts >= (p_from::timestamp at time zone 'America/Chicago')
           and g.ts <  ((p_to + 1)::timestamp at time zone 'America/Chicago')
           and (p_contractor is null or g.contractor_user_id = p_contractor)
      ) e
  ),
  -- Drain over the working day (6am to 6pm Central): percent lost per hour
  -- while NOT charging. Each step down between two readings counts its drop
  -- and its time; a step up (on the charger) counts neither, so a truck
  -- charger at noon cannot hide a bad morning. No number under an hour of
  -- discharge, rather than a wrong one.
  batt as (
    select uid, lt::date as d, ts, nullif((regexp_match(coalesce(kind, ''), '(\d+)'))[1], '')::int as pct
      from ev where type = 'battery' and extract(hour from lt) between 6 and 17
  ),
  bstep as (
    select uid, d, ts, pct,
           lag(pct) over (partition by uid, d order by ts) as prev,
           lag(ts)  over (partition by uid, d order by ts) as prev_ts
      from batt where pct is not null
  ),
  b as (
    select uid, d, (array_agg(pct order by ts))[1] as f, (array_agg(pct order by ts desc))[1] as l,
           min(pct) as lo,
           sum(case when prev > pct then prev - pct else 0 end) as drop_pct,
           sum(case when prev > pct then extract(epoch from ts - prev_ts) else 0 end) / 3600.0 as hrs
      from bstep group by uid, d
  ),
  st as (
    select uid, lt::date as d, ts, detail -> 'stats' as s
      from ev where type in ('push-ping', 'heartbeat') and detail ? 'stats'
  ),
  s2 as (
    select uid, d,
           max(case s ->> 'th' when 'critical' then 4 when 'serious' then 3 when 'fair' then 2 when 'nominal' then 1 end) as heat_n,
           case when bool_or((s ->> 'lp')::boolean) then 1 else 0 end as lp,
           (array_agg(s ->> 'bgr' order by ts desc) filter (where s ? 'bgr'))[1] as bgr,
           max((s ->> 'cpu')::numeric) as cpu, max((s ->> 'mem')::numeric) as mem,
           (array_agg(case s ->> 'loc' when 'always' then 'always' when 'whenInUse' then 'while using'
                                       when 'denied' then 'denied' when 'restricted' then 'restricted'
                                       when 'notDetermined' then 'not asked' end
                        || case when s ->> 'acc' = 'reduced' then ', approximate' else '' end
                      order by ts desc) filter (where s ? 'loc'))[1] as loc_perm,
           (array_agg(case when s ->> 'net' = 'cell' and s ? 'radio' then upper(s ->> 'radio')
                           when s ->> 'net' = 'cell' then 'cellular'
                           else s ->> 'net' end
                        || case when (s ->> 'lowData')::boolean then ', Low Data' else '' end
                      order by ts desc) filter (where s ? 'net'))[1] as network
      from st group by uid, d
  ),
  -- Apple's report, on the Central day its window started. Read from its own
  -- wider window: a report for the last day in range lands the day after.
  mxev as (
    select e.employee_user_id as uid, e.contractor_user_id as cid, e.type, e.detail,
           (to_timestamp(coalesce((e.detail ->> 'from')::numeric, extract(epoch from e.ts) * 1000 - 43200000) / 1000)
              at time zone 'America/Chicago')::date as d
      from allowed w
      join geo_events e on e.employee_user_id = w.uid
     where e.type in ('metrickit', 'mx-diag')
       and e.ts >= (p_from::timestamp at time zone 'America/Chicago')
       and e.ts <  ((p_to + 2)::timestamp at time zone 'America/Chicago')
       and (p_contractor is null or e.contractor_user_id = p_contractor)
  ),
  mxv as (
    select uid, cid, d, type, detail, k, v::numeric as v
      from mxev left join lateral jsonb_each_text(case when type = 'metrickit' then detail -> 'mx' end) j(k, v) on true
     where d between p_from and p_to
  ),
  mx as (
    select uid, cid, d,
           round(sum(v) filter (where k in ('loc_nav_s', 'loc_best_s')) / 60)::int as gps,
           round(sum(v) filter (where k = 'bg_loc_s') / 60)::int as bgloc,
           round(sum(v) filter (where k = 'cpu_s') / 60, 1) as cpu,
           (sum(v) filter (where k like 'bgx\_%' and k <> 'bgx_normal'))::int as ended,
           round(sum(v) filter (where k in ('cell_up_b', 'cell_down_b')) / 1000000, 1) as cell,
           round(avg(v) filter (where k = 'bars'), 1) as bars,
           bool_or(type = 'metrickit') as has_report
      from mxv group by uid, cid, d
  ),
  -- The reason iOS gave most often, in words.
  why as (
    select distinct on (uid, d) uid, d,
           case k when 'bgx_mem_pressure' then 'memory pressure' when 'bgx_mem_limit' then 'memory limit'
                  when 'bgx_cpu_limit' then 'CPU limit' when 'bgx_watchdog' then 'watchdog'
                  when 'bgx_task_timeout' then 'background task overran' when 'bgx_locked_file' then 'held a locked file'
                  when 'bgx_bad_access' then 'crash' when 'bgx_illegal' then 'crash' when 'bgx_abnormal' then 'abnormal exit' end as why
      from (select uid, d, k, sum(v) as n from mxv where k like 'bgx\_%' and k <> 'bgx_normal' group by uid, d, k) x
     where n > 0
     order by uid, d, n desc, k
  ),
  diag as (
    select uid, d, sum(coalesce((detail ->> 'crashes')::int, 0) + coalesce((detail ->> 'hangs')::int, 0))::int as n
      from mxev where type = 'mx-diag' and d between p_from and p_to group by uid, d
  ),
  life as (
    select uid, lt::date as d,
           count(*) filter (where type = 'app-terminate')::int as kills,
           count(*) filter (where type = 'push-ping')::int as wakes
      from ev group by uid, lt::date
  ),
  -- A session that never logged its own end (the app was killed with the
  -- receiver on) is counted to its next row or two hours, whichever is first,
  -- so one lost "off" cannot read as a whole day of GPS.
  radio as (
    select uid, lt::date as d, ts, (detail ->> 'on')::boolean as onn,
           lead(ts) over (partition by uid, region_id order by ts) as nxt
      from ev where type = 'radio' and region_id in ('drive', 'burst', 'js-watcher')
  ),
  -- The drive session and the live watcher often run at once, and it is one
  -- receiver: overlapping sessions are merged before they are added up, so
  -- two at once is counted once.
  ses as (
    select uid, d, ts as a, least(coalesce(nxt, ts + interval '2 hours'), ts + interval '2 hours') as z
      from radio where onn
  ),
  ses2 as (
    select *, max(z) over (partition by uid, d order by a, z rows between unbounded preceding and 1 preceding) as pz
      from ses
  ),
  ses3 as (
    select *, sum(case when pz is null or a > pz then 1 else 0 end) over (partition by uid, d order by a, z) as grp
      from ses2
  ),
  g as (
    select uid, d, round(sum(extract(epoch from (z - a))) / 60)::int as gm
      from (select uid, d, grp, min(a) as a, max(z) as z from ses3 group by uid, d, grp) m
     group by uid, d
  ),
  keys as (
    select distinct uid, cid, lt::date as d from ev
    union
    select distinct uid, cid, d from mxev where d between p_from and p_to
  )
  select k.uid, k.cid, k.d,
         case when b.hrs >= 1 then round(b.drop_pct / b.hrs::numeric, 1) end,
         b.f, b.l, b.lo,
         (array['nominal','fair','serious','critical'])[s2.heat_n],
         s2.lp, s2.bgr, coalesce(g.gm, 0), coalesce(life.kills, 0), coalesce(life.wakes, 0),
         s2.cpu, s2.mem,
         mx.gps, mx.bgloc, mx.cpu,
         case when mx.has_report then coalesce(mx.ended, 0) end, why.why,
         case when mx.has_report or diag.n is not null then coalesce(diag.n, 0) end,
         mx.cell, mx.bars, s2.loc_perm, s2.network
    from keys k
    left join b    on b.uid = k.uid and b.d = k.d
    left join s2   on s2.uid = k.uid and s2.d = k.d
    left join life on life.uid = k.uid and life.d = k.d
    left join g    on g.uid = k.uid and g.d = k.d
    left join mx   on mx.uid = k.uid and mx.d = k.d
    left join why  on why.uid = k.uid and why.d = k.d
    left join diag on diag.uid = k.uid and diag.d = k.d;
$$;

create or replace function public.ops_device_days(p_person uuid, p_from date, p_to date)
returns table (
  person_user_id uuid, contractor_user_id uuid, day date, drain_hr numeric,
  batt_first int, batt_last int, batt_low int, heat text, low_power_days int,
  bg_refresh text, gps_min int, kills int, wakes int, cpu_max numeric, mem_max numeric,
  apple_gps_min int, apple_bg_loc_min int, apple_cpu_min numeric, ios_ended int, ended_why text,
  crashes int, cell_mb numeric, bars numeric, loc_perm text, network text
)
language sql stable security definer set search_path = public as $$
  select * from public.device_days_by_person(p_from, p_to, p_person) where person_user_id = p_person order by day desc;
$$;

create or replace function public.ops_device_hours(p_person uuid, p_day date)
returns table (hour int, batt int, gps_min int, flips int, kills int, wakes int, heat text, cpu_max numeric)
language sql stable security definer set search_path = public as $$
  with ev as (
    select e.type, e.ts, e.kind, e.region_id, e.detail,
           extract(hour from (e.ts at time zone 'America/Chicago'))::int as h
      from geo_events e
     where e.employee_user_id = p_person
       and e.ts >= (p_day::timestamp at time zone 'America/Chicago')
       and e.ts <  ((p_day + 1)::timestamp at time zone 'America/Chicago')
       and ((select public.is_ops_admin()) or p_person::text = (select auth.uid()::text))
  ),
  radio as (
    select ts, (detail ->> 'on')::boolean as onn,
           lead(ts) over (partition by region_id order by ts) as nxt
      from ev where type = 'radio' and region_id in ('drive', 'burst', 'js-watcher')
  ),
  -- Same merge as the day view, then each hour takes only the part of a
  -- session that fell inside it, so a bar can never pass 60 minutes.
  ses as (select ts as a, least(coalesce(nxt, ts + interval '2 hours'), ts + interval '2 hours') as z from radio where onn),
  ses2 as (select *, max(z) over (order by a, z rows between unbounded preceding and 1 preceding) as pz from ses),
  ses3 as (select *, sum(case when pz is null or a > pz then 1 else 0 end) over (order by a, z) as grp from ses2),
  merged as (select min(a) as a, max(z) as z from ses3 group by grp),
  hours as (
    select h, (p_day::timestamp at time zone 'America/Chicago') + make_interval(hours => h) as hs
      from generate_series(0, 23) as h
  )
  select hs.h,
         (select nullif((regexp_match(coalesce(e.kind, ''), '(\d+)'))[1], '')::int from ev e
           where e.type = 'battery' and e.h <= hs.h order by e.ts desc limit 1),
         coalesce((select round(sum(extract(epoch from (least(m.z, hs.hs + interval '1 hour') - greatest(m.a, hs.hs)))) / 60)::int
                     from merged m where m.a < hs.hs + interval '1 hour' and m.z > hs.hs), 0),
         (select count(*)::int from ev e where e.type = 'motion' and e.h = hs.h),
         (select count(*)::int from ev e where e.type = 'app-terminate' and e.h = hs.h),
         (select count(*)::int from ev e where e.type = 'push-ping' and e.h = hs.h),
         (select (array['nominal','fair','serious','critical'])[max(case e.detail -> 'stats' ->> 'th' when 'critical' then 4 when 'serious' then 3 when 'fair' then 2 when 'nominal' then 1 end)]
            from ev e where e.h = hs.h and e.detail ? 'stats'),
         (select max((e.detail -> 'stats' ->> 'cpu')::numeric) from ev e where e.h = hs.h and e.detail ? 'stats')
    from hours hs
   order by hs.h;
$$;

create function public.device_rollup(p_from date, p_to date, p_grain text, p_by text,
                                     p_person uuid default null, p_contractor uuid default null)
returns table (
  person_user_id uuid, contractor_user_id uuid, period date, days int,
  drain_hr numeric, batt_low int, gps_min int, kills int, wakes int, heat text,
  low_power_days int, bg_refresh text, cpu_max numeric, mem_max numeric,
  apple_gps_min int, apple_bg_loc_min int, apple_cpu_min numeric, ios_ended int,
  ended_why text, crashes int, cell_mb numeric, bars numeric, loc_perm text, network text
)
language sql stable security definer set search_path = public as $$
  select case when p_by = 'account' then null else d.person_user_id end,
         d.contractor_user_id,
         case p_grain when 'day' then d.day
                      when 'month' then date_trunc('month', d.day)::date
                      when 'year' then date_trunc('year', d.day)::date
                      else p_from end,
         count(*)::int,
         round(avg(d.drain_hr), 1), min(d.batt_low),
         sum(d.gps_min)::int, sum(d.kills)::int, sum(d.wakes)::int,
         (array['nominal','fair','serious','critical'])[max(case d.heat when 'critical' then 4 when 'serious' then 3 when 'fair' then 2 when 'nominal' then 1 end)],
         sum(d.low_power_days)::int,
         (array_agg(d.bg_refresh order by d.day desc) filter (where d.bg_refresh is not null))[1],
         max(d.cpu_max), max(d.mem_max),
         sum(d.apple_gps_min)::int, sum(d.apple_bg_loc_min)::int, sum(d.apple_cpu_min),
         sum(d.ios_ended)::int, mode() within group (order by d.ended_why),
         sum(d.crashes)::int, sum(d.cell_mb), round(avg(d.bars), 1),
         (array_agg(d.loc_perm order by d.day desc) filter (where d.loc_perm is not null))[1],
         (array_agg(d.network order by d.day desc) filter (where d.network is not null))[1]
    from public.device_days_by_person(p_from, p_to, p_person, p_contractor) d
   where p_grain in ('day', 'month', 'year', 'all') and p_by in ('person', 'account')
   group by 1, 2, 3;
$$;

create or replace function public.ops_device_periods(p_person uuid, p_from date, p_to date, p_grain text)
returns table (
  person_user_id uuid, contractor_user_id uuid, period date, days int,
  drain_hr numeric, batt_low int, gps_min int, kills int, wakes int, heat text,
  low_power_days int, bg_refresh text, cpu_max numeric, mem_max numeric,
  apple_gps_min int, apple_bg_loc_min int, apple_cpu_min numeric, ios_ended int,
  ended_why text, crashes int, cell_mb numeric, bars numeric, loc_perm text, network text
)
language sql stable security definer set search_path = public as $$
  select * from public.device_rollup(p_from, p_to, p_grain, 'person', p_person)
   where person_user_id = p_person and p_grain in ('month', 'year')
   order by period desc;
$$;

revoke execute on function public.device_days_by_person(date, date, uuid, uuid) from public, anon;
grant execute on function public.device_days_by_person(date, date, uuid, uuid) to authenticated, service_role;
revoke execute on function public.device_rollup(date, date, text, text, uuid, uuid) from public, anon;
grant execute on function public.device_rollup(date, date, text, text, uuid, uuid) to authenticated, service_role;

-- The brief reads its own account only.
create or replace function public.ops_account_brief(p_target uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ops   record;
  v_use   record;
  v_fun   record;
  v_money record;
  v_acc   record;
  v_dev   record;
  v_time  jsonb;
  v_vals  jsonb;
  v_secs  jsonb;
  v_biz   text;
  v_trade text;
begin
  if not public.is_ops_admin() then
    raise exception 'ops brief: not authorized' using errcode = '42501';
  end if;

  select * into v_ops   from public.ops_by_contractor(p_from, p_to)    r where r.contractor_user_id = p_target;
  select * into v_use   from public.usage_by_contractor(p_from, p_to)  r where r.contractor_user_id = p_target;
  select * into v_fun   from public.funnel_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;
  select * into v_money from public.money_by_contractor(p_from, p_to)  r where r.contractor_user_id = p_target;
  select * into v_acc   from public.accuracy_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;
  -- Phones: the whole range for the whole account, rolled up by the same
  -- function the person's month and year views read (device_rollup).
  select * into v_dev from public.device_rollup(p_from, p_to, 'all', 'account', null, p_target) r
   where r.contractor_user_id = p_target;

  select d.business, d.trade into v_biz, v_trade
    from public.v_account_dim d where d.contractor_user_id = p_target;

  -- Every value once, keyed section.metric. The sections below and the flat
  -- objects at the end are both READ from this, so a number cannot appear
  -- twice with two different computations behind it.
  v_vals := jsonb_build_object(
    'work', jsonb_build_object(
      'people', v_ops.people, 'crew', v_ops.crew,
      'active_days', v_ops.active_days, 'days_clocked', v_ops.days_clocked,
      'avg_day_min', v_ops.avg_day_min, 'total_miles', v_ops.total_miles,
      'visits', v_ops.visits, 'avg_visit_min', v_ops.avg_visit_min,
      'unnamed_legs', v_ops.unnamed_legs, 'last_active', v_ops.last_active),
    'usage', jsonb_build_object(
      'sessions', v_use.sessions, 'active_days', v_use.active_days,
      'page_views', v_use.page_views, 'clicks', v_use.clicks,
      'avg_session_min', v_use.avg_session_min, 'avg_screens', v_use.avg_screens,
      'clicks_per_session', v_use.clicks_per_session,
      'last_version', v_use.last_version, 'last_seen', v_use.last_seen),
    'funnel', jsonb_build_object(
      'leads', v_fun.leads, 'bids_sent', v_fun.bids_sent, 'sent_opened', v_fun.sent_opened,
      'sent_signed', v_fun.sent_signed, 'signed_total', v_fun.signed_total,
      'signed_paid', v_fun.signed_paid,
      'open_rate', v_fun.open_rate, 'close_rate', v_fun.close_rate,
      'signed_value', v_fun.signed_value, 'avg_ticket', v_fun.avg_ticket),
    'money', jsonb_build_object(
      'signed_count', v_money.signed_count, 'signed_value', v_money.signed_value,
      'avg_ticket', v_money.avg_ticket, 'median_ticket', v_money.median_ticket,
      'deposits', v_money.deposits, 'stripe_fees', v_money.stripe_fees,
      'paid_count', v_money.paid_count, 'pending_count', v_money.pending_count,
      'declined', v_money.declined, 'cancelled', v_money.cancelled,
      'by_cash', v_money.by_cash, 'by_check', v_money.by_check, 'by_card', v_money.by_card),
    -- How often a day had to be corrected after it was over. A day cannot
    -- be graded until the next morning, so accuracy_by_contractor excludes
    -- today and these can be null on a one-day window.
    'accuracy', jsonb_build_object(
      'clean_pct', v_acc.clean_pct, 'added_late_min', v_acc.added_late_min,
      'retired_late_min', v_acc.retired_late_min,
      'added_late', v_acc.added_late, 'retired_late', v_acc.retired_late),
    'device', jsonb_build_object(
      'drain_hr', v_dev.drain_hr, 'batt_low', v_dev.batt_low, 'heat', v_dev.heat,
      'low_power_days', v_dev.low_power_days, 'bg_refresh', v_dev.bg_refresh,
      'gps_min', v_dev.gps_min, 'kills', v_dev.kills, 'wakes', v_dev.wakes,
      'cpu_max', v_dev.cpu_max, 'mem_max', v_dev.mem_max,
      'apple_gps_min', v_dev.apple_gps_min, 'apple_bg_loc_min', v_dev.apple_bg_loc_min,
      'apple_cpu_min', v_dev.apple_cpu_min, 'ios_ended', v_dev.ios_ended, 'ended_why', v_dev.ended_why,
      'crashes', v_dev.crashes, 'cell_mb', v_dev.cell_mb, 'bars', v_dev.bars,
      'loc_perm', v_dev.loc_perm, 'network', v_dev.network)
  );

  -- The timings, for THIS account. funnel_timing answers for everyone at once
  -- and starts at saved to sent, so it can say how fast a proposal goes out but
  -- never how long the proposal took to write. Both of those stages are logged
  -- (js/lifecycle.js names 'proposal_started>proposal_saved' "Time to write a
  -- proposal"), they were simply never read.
  with b as (
    select f.* from public.v_funnel_bid f where f.contractor_user_id = p_target
  ),
  starts as (
    select l.bid_id,
           min(l.ts) filter (where l.event = 'proposal_started') as started_at,
           min(l.ts) filter (where l.event = 'lead_created')     as lead_at
      from public.lifecycle_events l
     where l.contractor_user_id = p_target and l.bid_id is not null
     group by l.bid_id
  ),
  stages as (
    select 'lead to proposal'::text as stage, 1 as n,
           extract(epoch from (b.saved_at - s.lead_at))/60 as mins
      from b join starts s on s.bid_id = b.bid_id
     where b.saved_at is not null and s.lead_at is not null and b.saved_at::date between p_from and p_to
    union all
    select 'writing the proposal', 2, extract(epoch from (b.saved_at - s.started_at))/60
      from b join starts s on s.bid_id = b.bid_id
     where b.saved_at is not null and s.started_at is not null and b.saved_at::date between p_from and p_to
    union all
    select 'saved to sent', 3, extract(epoch from (b.sent_at - b.saved_at))/60
      from b where b.sent_at is not null and b.saved_at is not null and b.sent_at::date between p_from and p_to
    union all
    select 'sent to opened', 4, extract(epoch from (b.opened_at - b.sent_at))/60
      from b where b.opened_at is not null and b.sent_at is not null and b.sent_at::date between p_from and p_to
    union all
    select 'opened to signed', 5, extract(epoch from (b.signed_at - b.opened_at))/60
      from b where b.signed_at is not null and b.opened_at is not null and b.signed_at::date between p_from and p_to
    union all
    select 'signed to paid', 6, extract(epoch from (b.paid_at - b.signed_at))/60
      from b where b.paid_at is not null and b.signed_at is not null and b.paid_at::date between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage', t.stage, 'n', t.n_count,
           'median_min', t.median_min, 'p25_min', t.p25_min, 'p75_min', t.p75_min
         ) order by t.n), '[]'::jsonb)
    into v_time
    from (
      select stage, n,
             count(*)                                                              as n_count,
             round(percentile_cont(0.5)  within group (order by mins)::numeric, 1) as median_min,
             round(percentile_cont(0.25) within group (order by mins)::numeric, 1) as p25_min,
             round(percentile_cont(0.75) within group (order by mins)::numeric, 1) as p75_min
        from stages
       where mins is not null and mins >= 0
       group by stage, n
    ) t;

  -- Values, labelled and ordered by the definition list. A def whose value the
  -- brief does not compute renders as "not measured" rather than vanishing, so
  -- a half-added metric is visible instead of silently missing.
  select coalesce(jsonb_agg(s order by s->>'sort'), '[]'::jsonb) into v_secs
  from (
    select jsonb_build_object(
             'key', d.section,
             'label', d.section_label,
             'sort', lpad(d.section_sort::text, 3, '0'),
             'metrics', jsonb_agg(jsonb_build_object(
                 'key', d.key, 'label', d.label, 'fmt', d.fmt,
                 'value', v_vals -> d.section -> d.key
               ) order by d.sort)
           ) as s
      from public.ops_metric_defs() d
     group by d.section, d.section_label, d.section_sort
  ) x;

  return jsonb_build_object(
    'contractor_user_id', p_target,
    'business', coalesce(v_biz, v_ops.business, v_use.business),
    'trade',    coalesce(v_trade, v_use.trade),
    'range',    jsonb_build_object('from', p_from, 'to', p_to, 'days', (p_to - p_from) + 1),
    'sections', v_secs,
    'work',   v_vals -> 'work',
    'usage',  v_vals -> 'usage',
    'funnel', v_vals -> 'funnel',
    'money',  v_vals -> 'money',
    'device', v_vals -> 'device',
    'timing', v_time
  );
end;
$$;
