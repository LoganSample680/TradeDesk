-- On-time report: did each person's motion flips reach the server within
-- 10 seconds of happening? (owner goal 2026-09-23: "on time shit within 10
-- seconds 100% of the time")
--
-- Read-only. Run it with the Supabase MCP execute_sql (or psql) against the
-- shared project. The nightly routine runs it at the end of each workday and
-- reports the newest day against the six before it.
--
-- One row per person per Central day, working hours 6am to 6pm only.
--   lag            = created_at (server received) - ts (it happened)
--   pct_10s        = the goal. 100 is done.
--   late_on_open   = late flips that only arrived when the app was opened
--                    (the phone held them until a person touched it)
--   recovered      = flips the native backfill recovered (detail.hist), needs
--                    the build with the per-row seq uploader
with days as (
  select generate_series(
    (now() at time zone 'America/Chicago')::date - 6,
    (now() at time zone 'America/Chicago')::date,
    interval '1 day')::date as d
),
flips as (
  select e.employee_user_id uid,
         (e.ts at time zone 'America/Chicago')::date d,
         e.created_at,
         extract(epoch from (e.created_at - e.ts)) lag_s,
         coalesce((e.detail->>'hist')::boolean, false) hist
  from geo_events e
  join days on days.d = (e.ts at time zone 'America/Chicago')::date
  where e.type = 'motion'
    and extract(hour from e.ts at time zone 'America/Chicago') between 6 and 17
),
opens as (
  select employee_user_id uid, created_at
  from geo_events
  where type = 'app-active'
    and created_at > now() - interval '8 days'
)
select f.d,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) who,
  count(*) flips,
  round(100.0 * avg((f.lag_s <= 10)::int)) pct_10s,
  round(100.0 * avg((f.lag_s <= 120)::int)) pct_2m,
  round(percentile_cont(0.5) within group (order by f.lag_s)::numeric) med_s,
  round(percentile_cont(0.9) within group (order by f.lag_s)::numeric) p90_s,
  count(*) filter (where f.lag_s > 120 and exists (
    select 1 from opens o where o.uid = f.uid
      and o.created_at between f.created_at - interval '90 seconds'
                           and f.created_at + interval '5 seconds')) late_on_open,
  count(*) filter (where f.hist) recovered
from flips f
left join auth.users u on u.id = f.uid
group by f.d, who
order by who, f.d;
