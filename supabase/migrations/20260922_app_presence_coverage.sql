-- ════════════════════════════════════════════════════════════════════════
-- app_presence: push-blocked needs the device to have been alive THROUGH the
-- gap, not just alive now.
--
-- 20260921 shipped with a false positive I caught within the hour by reading
-- the data instead of the classifier. It called a device `push-blocked`
-- whenever silent pushes were stale and the device was writing in the last 40
-- minutes. Those two facts are also exactly what a phone looks like in the
-- first half hour AFTER the app comes back: the last answered ping is still
-- old, the writes are new, and no nudge has gone out yet to prove delivery
-- works again.
--
-- That is what happened. A device had taken one push-ping in 26 hours and was
-- writing radio rows every 30 seconds, and I read it as pushes being blocked.
-- The hourly counts said otherwise: it wrote NOTHING for 26 hours, the user
-- opened the app, and pings resumed on the very next tick. It was closed, not
-- blocked. Two states with the same 40-minute snapshot and opposite meanings.
--
-- The discriminator is coverage, not recency. A genuinely push-blocked device
-- keeps writing across the whole window in which it ignores nudges. A device
-- that was closed goes silent right after its last answered ping and only
-- reappears at the end. So count the distinct 30-minute buckets containing
-- the device own writes since its last answered ping and compare that against
-- how many nudges it has skipped:
--
--   covered almost every bucket  -> alive the whole time, ignoring pushes
--   covered almost none          -> it was gone, and this is its return
--
-- `back-online` is the new state for that return. It is deliberately not
-- `background`: delivery has not been demonstrated yet, and the next tick
-- settles it either way within 30 minutes.
-- ════════════════════════════════════════════════════════════════════════

create or replace view v_app_presence_raw as
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
       -- How much of the un-answered window the device was demonstrably
       -- awake for. One bucket per half hour, which is the nudge period, so
       -- this is directly comparable to the count of skipped nudges.
       count(distinct date_trunc('hour', g.created_at)
                      + interval '30 minutes'
                        * floor(extract(minute from g.created_at) / 30))
         filter (where g.type <> 'push-ping'
                   and g.created_at > (select max(p.created_at)
                                       from geo_events p
                                       where p.employee_user_id = g.employee_user_id
                                         and p.type = 'push-ping'))        as buckets_alive_since_ping,
       (select count(*) from v_app_open o
        where o.employee_user_id = g.employee_user_id
          and (o.opened_at at time zone 'America/Chicago')::date
              = (now() at time zone 'America/Chicago')::date)      as opens_today
from geo_events g
where g.created_at > now() - interval '14 days'
group by g.employee_user_id;

revoke all on v_app_presence_raw from anon, authenticated;

create or replace function app_presence()
returns table (
  contractor_user_id uuid,
  business           text,
  employee_user_id   uuid,
  person             text,
  role               text,
  state              text,
  state_detail       text,
  last_open_at       timestamptz,
  minutes_since_open numeric,
  opens_today        bigint,
  last_heard_at      timestamptz,
  minutes_since_heard numeric,
  last_ping_at       timestamptz,
  pings_missed       int,
  awake_buckets      bigint,
  last_terminate_at  timestamptz,
  app_version        text,
  battery_level      numeric,
  has_push_token     boolean,
  cron_ran_at        timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cron timestamptz;
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;

  select cw.ran_at into v_cron from cron_watermarks cw where cw.name = 'geo-ping';

  return query
  with tok as (
    select dt.user_id, count(*) as n
    from device_tokens dt where dt.invalid_at is null group by dt.user_id
  ),
  dev as (
    select distinct on (ds.user_id) ds.user_id, ds.app_version, ds.battery_level
    from device_status ds order by ds.user_id, ds.checked_at desc
  ),
  s as (
    select d.contractor_user_id, d.business, pd.employee_user_id, pd.person, pd.role,
           r.last_open_at, r.last_bg_at, r.last_terminate_at, r.last_relaunch_at,
           r.last_ping_at, r.last_write_at, r.self_writes_40m,
           coalesce(r.buckets_alive_since_ping, 0) as awake,
           r.opens_today,
           coalesce(tok.n, 0) > 0 as has_token,
           dev.app_version, dev.battery_level,
           -- Negative when the device answered more recently than the last
           -- recorded tick, which is normal; clamp so it reads as zero.
           greatest(floor(extract(epoch from
             (v_cron - coalesce(r.last_ping_at, v_cron))) / 1800)::int, 0) as missed
    from v_app_presence_raw r
    join v_person_dim pd on pd.employee_user_id = r.employee_user_id
    join v_account_dim d on d.contractor_user_id = pd.contractor_user_id
    left join tok on tok.user_id = r.employee_user_id
    left join dev on dev.user_id = r.employee_user_id
  )
  select s.contractor_user_id, s.business, s.employee_user_id, s.person, s.role,
         case
           when s.last_open_at is not null
                and s.last_open_at >= coalesce(s.last_bg_at, s.last_open_at)
                and now() - s.last_open_at < interval '3 minutes'      then 'foreground'
           when not s.has_token                                        then 'no-push-token'
           when v_cron is null
             or now() - v_cron > interval '45 minutes'                 then 'unknown-cron-down'
           when s.missed <= 1                                          then 'background'
           -- Awake for essentially every half hour it skipped a nudge.
           when s.missed >= 2 and s.awake >= s.missed - 1              then 'push-blocked'
           -- Writing now, but it cannot yet be shown it was here during the
           -- gap. The next nudge decides between background and push-blocked.
           when s.self_writes_40m > 0                                  then 'back-online'
           when coalesce(s.last_terminate_at, '-infinity') > coalesce(s.last_ping_at, '-infinity')
             or coalesce(s.last_relaunch_at, '-infinity') > coalesce(s.last_ping_at, '-infinity')
                                                                       then 'force-closed'
           else 'dark'
         end,
         case
           when not s.has_token
             then 'No registered device token, so no push was ever sent. Silence here means nothing.'
           when v_cron is null or now() - v_cron > interval '45 minutes'
             then 'The geo-ping cron has not run recently. Nobody was asked, so nobody failing to answer proves anything.'
           when s.missed >= 2 and s.awake >= s.missed - 1
             then 'Device was awake and writing through ' || s.awake || ' of the ' || s.missed
                  || ' half-hours it skipped a nudge. It is running and not taking silent pushes: check Background App Refresh and Low Power Mode, not the user.'
           when s.missed >= 2 and s.self_writes_40m > 0
             then 'Device went quiet after its last answered nudge and has just started writing again. Next tick confirms whether pushes are landing.'
           when coalesce(s.last_terminate_at, '-infinity') > coalesce(s.last_ping_at, '-infinity')
             then 'App reported its own termination after the last push it answered.'
           else null
         end,
         s.last_open_at,
         round(extract(epoch from (now() - s.last_open_at)) / 60, 1),
         s.opens_today,
         s.last_write_at,
         round(extract(epoch from (now() - s.last_write_at)) / 60, 1),
         s.last_ping_at,
         s.missed,
         s.awake,
         s.last_terminate_at,
         s.app_version,
         s.battery_level,
         s.has_token,
         v_cron
  from s
  order by s.contractor_user_id, s.last_write_at desc nulls last;
end;
$$;

comment on function app_presence() is
  'Live per-person app state: foreground, background, push-blocked, back-online, force-closed, dark, no-push-token, unknown-cron-down. push-blocked requires the device to have been awake through nearly every half-hour it skipped a nudge, which is what separates a phone ignoring pushes from a phone that was simply closed and has just come back.';

revoke execute on function app_presence() from public, anon;
grant  execute on function app_presence() to authenticated;
