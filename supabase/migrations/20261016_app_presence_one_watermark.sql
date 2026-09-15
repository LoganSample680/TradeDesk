-- ── THE OPS LIGHTS TOOK TEN AND A HALF SECONDS, AND IT WAS ONE LINE ────────
--
-- Owner 2026-09-15: "the person status based on app active background or force
-- closed, it takes forever to show a state and defaults to black."
--
-- Measured, not guessed. EXPLAIN ANALYZE on v_app_presence_raw:
--
--   GroupAggregate  (actual time=133.195..10555.481 rows=3)
--     ->  Index Scan on geo_events  (actual time=3.719..252.887 rows=25128)
--     SubPlan 2
--       ->  Aggregate  (actual time=0.438..0.438 rows=1 loops=23421)
--             Index Scan on geo_events p
--               Index Cond: (employee_user_id = g.employee_user_id
--                            AND type = 'push-ping')
--   Execution Time: 10557.611 ms
--
-- Read the loops count. The correlated subquery that finds each person's last
-- push-ping sits inside a FILTER on an aggregate, so Postgres runs it ONCE PER
-- INPUT ROW rather than once per group: 23,421 index scans of about 951 rows
-- each, 0.438 ms apiece, which is 10.3 of the 10.5 seconds. Everything else in
-- the view costs a quarter of a second.
--
-- It is the same watermark every time for a given person. Computing it once
-- per person in a CTE and joining is the whole fix.
--
-- WHY THIS GETS WORSE ON ITS OWN. The inner scan is over every push-ping that
-- person has ever sent, and the outer row count is fourteen days of their
-- events. Both grow with use, and the cost is their product, so this was going
-- to be a minute by winter without anybody changing a line.
--
-- BEHAVIOUR IS UNCHANGED, deliberately including the two things that look like
-- bugs and are not:
--   - the watermark subquery is NOT windowed to fourteen days and the CTE is
--     not either, so a person whose last ping is older than the window is
--     compared against that older ping exactly as before.
--   - when a person has never had a push-ping, the old subquery returned NULL
--     and `created_at > NULL` is NULL, which FILTER reads as false. A LEFT JOIN
--     that finds no row gives NULL too, so the count is still zero.
-- Grouping by the joined watermark alongside employee_user_id is free: it is
-- functionally dependent on it, one value per group.
--
-- create or replace view may only APPEND columns, so the column list and its
-- order are reproduced exactly, including buckets_alive_since_ping staying
-- last for the reason 20260922 gives.

create or replace view v_app_presence_raw as
with ping as (
  -- One row per person: the last push-ping they ever answered. Once, here,
  -- instead of once per event row inside the aggregate below.
  select p.employee_user_id, max(p.created_at) as last_ping
  from geo_events p
  where p.type = 'push-ping'
  group by p.employee_user_id
)
select g.employee_user_id,
       max(g.ts) filter (where g.type = 'app-active')            as last_open_at,
       max(g.ts) filter (where g.type = 'app-background')        as last_bg_at,
       max(g.ts) filter (where g.type = 'app-terminate')         as last_terminate_at,
       max(g.ts) filter (where g.type = 'app-relaunch')          as last_relaunch_at,
       max(g.created_at) filter (where g.type = 'push-ping')     as last_ping_at,
       max(g.created_at) filter (where g.type <> 'push-ping')    as last_self_write_at,
       max(g.created_at)                                         as last_write_at,
       count(*) filter (where g.type <> 'push-ping'
                          and g.created_at > now() - interval '40 minutes') as self_writes_40m,
       (select count(*) from v_app_open o
        where o.employee_user_id = g.employee_user_id
          and (o.opened_at at time zone 'America/Chicago')::date
              = (now() at time zone 'America/Chicago')::date)      as opens_today,
       -- How much of the un-answered window the device was demonstrably
       -- awake for. One bucket per half hour, which is the nudge period, so
       -- this is directly comparable to the count of skipped nudges.
       --
       -- LAST, and it has to be. create or replace view may only APPEND
       -- columns: inserting this one above opens_today, which is where it
       -- reads better, fails with "cannot change name of view column" and
       -- takes the whole migration down with it.
       count(distinct date_trunc('hour', g.created_at)
                      + interval '30 minutes'
                        * floor(extract(minute from g.created_at) / 30))
         filter (where g.type <> 'push-ping'
                   and g.created_at > ping.last_ping)             as buckets_alive_since_ping
from geo_events g
left join ping on ping.employee_user_id = g.employee_user_id
where g.created_at > now() - interval '14 days'
group by g.employee_user_id, ping.last_ping;

revoke all on v_app_presence_raw from anon, authenticated;

-- The watermark CTE above reads every push-ping this account ever sent, per
-- person. geo_events_dedupe_uq leads with (employee_user_id, type, ts) so it
-- already serves that scan; this one adds created_at so the max comes off the
-- index instead of the heap, which is where the remaining quarter-second of
-- the read goes.
create index if not exists geo_events_person_type_created_idx
  on geo_events (employee_user_id, type, created_at desc);

comment on view v_app_presence_raw is
  'One row per person: the last app-active, background, terminate, relaunch and push-ping, plus how awake they have been since that ping. The push-ping watermark is a CTE and must stay one: as a correlated subquery inside the FILTER it ran once per event row and cost ten seconds (2026-09-15).';

-- ── ONE CALL, EVERY LIGHT (owner 2026-09-15) ───────────────────────────────
-- The other half of "it takes forever to show a state". app_presence() computes
-- presence for EVERY person on every call and ops_live_status then throws all
-- but one account's rows away, so asking about one business costs exactly what
-- asking about all of them costs. The portal was paying that price again on
-- every business you opened, and staring at grey dots until it came back.
--
-- p_target goes optional. Passed, it answers for that account exactly as
-- before; omitted, it answers for all of them, which the portal now asks for
-- once at load. Opening a business is then a repaint, not a round trip.
--
-- contractor_user_id joins the returned table, because a global answer that
-- does not say which business a person belongs to cannot be sorted into the
-- businesses. Additive for anyone already reading this by column name, and a
-- returns-table cannot be replaced in place, hence the drop.
drop function if exists public.ops_live_status(uuid);
create or replace function public.ops_live_status(p_target uuid default null)
returns table (
  contractor_user_id uuid,
  person_user_id uuid,
  state          text,
  presence       text,
  detail         text,
  last_open      timestamptz,
  last_bg        timestamptz,
  last_terminate timestamptz,
  last_heard     timestamptz,
  quiet_min      int,
  opens_today    bigint,
  app_version    text,
  battery_level  numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ops_admin() then
    raise exception 'ops live status: not authorized' using errcode = '42501';
  end if;

  return query
  select p.contractor_user_id,
         p.employee_user_id,
         case p.state
           when 'foreground'   then 'active'
           when 'background'   then 'background'
           -- Still running, just not answering pushes. A live app is amber,
           -- and the detail says which kind of amber it is.
           when 'push-blocked' then 'background'
           when 'force-closed' then 'closed'
           -- dark, no-push-token and unknown-cron-down are all "we do not
           -- know", and none of them earns a red light: two of them mean the
           -- silence proves nothing at all.
           else 'unknown'
         end,
         p.state,
         p.state_detail,
         p.last_open_at,
         p.last_bg_at,
         p.last_terminate_at,
         p.last_heard_at,
         case when p.minutes_since_heard is not null
              then floor(p.minutes_since_heard)::int end,
         p.opens_today,
         p.app_version,
         p.battery_level
    from public.app_presence() p
   where p_target is null or p.contractor_user_id = p_target;
end;
$$;

comment on function public.ops_live_status(uuid) is
  'The ops portal''s four lights, read straight from app_presence: active, background, closed, unknown. One account when given one, every account when not, because app_presence costs the same either way and the portal wants them all up front. Carries app_presence''s own seven-state answer and its explanation alongside, because push-blocked and background share a colour and not a cause. The rule lives in app_presence, never here and never in the page.';

revoke execute on function public.ops_live_status(uuid) from public, anon;
grant  execute on function public.ops_live_status(uuid) to authenticated;
