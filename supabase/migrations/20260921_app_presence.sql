-- ════════════════════════════════════════════════════════════════════════
-- App presence: when each person last opened the app, and whether it is
-- still running on their phone.
--
-- Owner 2026-09-10: "want to surface a last opened date and time stamp when
-- the app went active, and flag an account by employee or user if it went
-- force closed."
--
-- Everything needed is already in geo_events and nothing reads it:
-- app-active, app-background, app-terminate, app-relaunch and push-ping are
-- all being written today.
--
-- THE FORCE-CLOSE TEST, and why it is not one comparison.
--
-- push-geo-ping sends a content-available push to every registered device
-- every ~30 minutes, and its own header states the rule this rests on: Apple
-- does not deliver silent pushes to an app the user force-quit. So a phone
-- that stops answering the nudge has stopped running the app.
--
-- That inference is only sound when the push was actually sent AND the phone
-- could have answered. Three things break it, and each gets its own state
-- rather than being folded into "force closed":
--
--   * No registered device token. Nothing was ever sent, so silence proves
--     nothing at all.
--   * The plugin is still writing on its own (fixes, radio, motion) while
--     pings are missing. A force-quit app cannot do that: iOS only wakes it
--     for a region or significant-location event, which is bursty, not a
--     steady cadence. Continuous writes plus missing pushes means PUSH is
--     blocked, not that the app is closed. Background App Refresh off and
--     Low Power Mode both do exactly this, and neither is a force quit.
--   * Nothing is arriving at all. Phone off, no signal, app deleted, signed
--     out. That is `dark`, and it deliberately refuses to claim force-close.
--
-- This distinction is not hypothetical. On the day this was written one of
-- three live devices had taken exactly ONE push-ping in 26 hours while the
-- other two took two an hour, and that same device was writing radio rows
-- every 30 seconds. Calling it force-closed would have been wrong and would
-- have hidden a real push-delivery problem behind a user-behavior label.
--
-- LIVENESS READS created_at, NOT ts. geo_events carries both, and the phone
-- buffers: fixes land with their real event time and a write time up to
-- several minutes later (observed: 164s). ts answers "when did this happen",
-- created_at answers "when did we last hear from this device". Only the
-- second one can decide whether a phone is alive right now.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Who each person is ───────────────────────────────────────────────────
create or replace view v_person_dim as
select p.employee_user_id,
       p.contractor_user_id,
       p.role,
       coalesce(nullif(btrim(t.name), ''), u.email, 'Unknown') as person,
       u.email
from v_person_account p
left join auth.users u on u.id = p.employee_user_id
left join lateral (
  select tm.name from team_members tm
  where tm.employee_user_id = p.employee_user_id
    and tm.contractor_user_id = p.contractor_user_id
  order by tm.joined_at desc nulls last limit 1
) t on true;

comment on view v_person_dim is
  'Employee to account, with the display name the roster knows them by. Falls back to the login email.';

revoke all on v_person_dim from anon, authenticated;

-- ── 1b. Opens, deduplicated ─────────────────────────────────────────────────
-- The native layer emits app-active more than once for a single foreground:
-- observed on 2026-09-10, two opens 0.9s apart both closing on the same
-- app-background, and several pairs firing in the same millisecond. Over two
-- days that turned 69 real opens into 83, so an undeduped "opened 41 times
-- today" would be a straight lie on the busiest account.
--
-- Consecutive opens inside 10 seconds are one open. This is a reader-side
-- patch over a native defect and is labelled as such: the actual fix is the
-- plugin not emitting twice, which needs an iOS build, so it waits. If that
-- lands, this collapses to a no-op rather than needing to be unwound.
create or replace view v_app_open as
select employee_user_id, device_id, ts as opened_at
from (
  select g.employee_user_id, g.device_id, g.ts,
         lag(g.ts) over (partition by g.employee_user_id, g.device_id order by g.ts) as prev_ts
  from geo_events g
  where g.type = 'app-active'
) w
where prev_ts is null or ts - prev_ts > interval '10 seconds';

comment on view v_app_open is
  'Every real app foreground. Consecutive app-active events inside 10 seconds are collapsed: the native plugin emits duplicates, and counting them raw overstates opens by about a sixth.';

revoke all on v_app_open from anon, authenticated;

-- ── 2. Raw presence signals per person ──────────────────────────────────────
-- One row per person, every timestamp the state machine needs. Fourteen days
-- is enough to answer "is it running now" without scanning the whole table.
create or replace view v_app_presence_raw as
select g.employee_user_id,
       max(g.ts) filter (where g.type = 'app-active')            as last_open_at,
       max(g.ts) filter (where g.type = 'app-background')        as last_bg_at,
       max(g.ts) filter (where g.type = 'app-terminate')         as last_terminate_at,
       max(g.ts) filter (where g.type = 'app-relaunch')          as last_relaunch_at,
       -- created_at from here down: these decide liveness, not history.
       max(g.created_at) filter (where g.type = 'push-ping')     as last_ping_at,
       max(g.created_at) filter (where g.type <> 'push-ping')    as last_self_write_at,
       max(g.created_at)                                         as last_write_at,
       count(*) filter (where g.type <> 'push-ping'
                          and g.created_at > now() - interval '40 minutes') as self_writes_40m,
       (select count(*) from v_app_open o
        where o.employee_user_id = g.employee_user_id
          and (o.opened_at at time zone 'America/Chicago')::date
              = (now() at time zone 'America/Chicago')::date)      as opens_today
from geo_events g
where g.created_at > now() - interval '14 days'
group by g.employee_user_id;

revoke all on v_app_presence_raw from anon, authenticated;

-- ── 3. The state machine ────────────────────────────────────────────────────
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

  -- Every staleness judgement is measured against the last time the nudge
  -- actually went out, never against wall clock. If the cron itself is down,
  -- nobody answered the last push because nobody was asked, and calling that
  -- a fleet of force-quits would be the single most misleading thing this
  -- function could do.
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
           r.last_ping_at, r.last_self_write_at, r.last_write_at,
           r.self_writes_40m, r.opens_today,
           coalesce(tok.n, 0) > 0 as has_token,
           dev.app_version, dev.battery_level
    from v_app_presence_raw r
    join v_person_dim pd on pd.employee_user_id = r.employee_user_id
    join v_account_dim d on d.contractor_user_id = pd.contractor_user_id
    left join tok on tok.user_id = r.employee_user_id
    left join dev on dev.user_id = r.employee_user_id
  )
  select s.contractor_user_id, s.business, s.employee_user_id, s.person, s.role,
         case
           -- Foreground is the app-active with no app-background after it.
           -- The pair fires within milliseconds on a quick switch away, so
           -- ordering decides this, not recency alone.
           when s.last_open_at is not null
                and s.last_open_at >= coalesce(s.last_bg_at, s.last_open_at)
                and now() - s.last_open_at < interval '3 minutes'      then 'foreground'
           when not s.has_token                                        then 'no-push-token'
           when v_cron is null
             or now() - v_cron > interval '45 minutes'                 then 'unknown-cron-down'
           when s.last_ping_at is not null
                and v_cron - s.last_ping_at <= interval '40 minutes'   then 'background'
           when s.self_writes_40m > 0                                  then 'push-blocked'
           when coalesce(s.last_terminate_at, '-infinity') > coalesce(s.last_ping_at, '-infinity')
             or coalesce(s.last_relaunch_at, '-infinity') > coalesce(s.last_ping_at, '-infinity')
                                                                       then 'force-closed'
           else 'dark'
         end,
         case
           when not s.has_token then 'No registered device token, so no push was ever sent. Silence here means nothing.'
           when v_cron is null or now() - v_cron > interval '45 minutes'
             then 'The geo-ping cron has not run recently. Nobody was asked, so nobody failing to answer proves anything.'
           when s.self_writes_40m > 0 and (s.last_ping_at is null or v_cron - s.last_ping_at > interval '40 minutes')
             then 'Device is still writing on its own but is not taking silent pushes. Check Background App Refresh and Low Power Mode, not the user.'
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
         -- Nudges go out every ~30 minutes, so this is how many the phone
         -- has now skipped. One is noise; three is a phone that is not there.
         greatest(floor(extract(epoch from (v_cron - coalesce(s.last_ping_at, v_cron))) / 1800)::int, 0),
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
  'Live per-person app state: foreground, background, push-blocked, force-closed, dark, no-push-token, unknown-cron-down. Staleness is measured against the last geo-ping cron tick, never wall clock. push-blocked is separated from force-closed on purpose: a device still writing its own fixes is running the app, and a missing silent push there is a delivery problem, not a user closing the app.';

-- ── 4. Every time the app was opened, and for how long ──────────────────────
-- app-active paired with the next app-background on the same device. The
-- unmatched trailing open is the session still running, and is returned with
-- a null close rather than dropped.
create or replace function app_open_log(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business    text,
  person      text,
  role        text,
  device_id   text,
  opened_at   timestamptz,
  closed_at   timestamptz,
  seconds_open numeric,
  still_open  boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  with closers as (
    select g.employee_user_id, g.device_id, g.ts
    from geo_events g
    where g.type in ('app-background', 'app-terminate')
      and g.ts::date between p_from and (p_to + 1)
  ),
  paired as (
    select o.employee_user_id, o.device_id, o.opened_at,
           (select min(x.ts) from closers x
            where x.employee_user_id = o.employee_user_id
              and x.device_id is not distinct from o.device_id
              and x.ts > o.opened_at) as closed_at
    from v_app_open o
    where (o.opened_at at time zone 'America/Chicago')::date between p_from and p_to
  )
  select pd.contractor_user_id, d.business, pd.person, pd.role,
         p.device_id, p.opened_at, p.closed_at,
         round(extract(epoch from (p.closed_at - p.opened_at))::numeric, 1),
         p.closed_at is null
  from paired p
  join v_person_dim pd on pd.employee_user_id = p.employee_user_id
  join v_account_dim d on d.contractor_user_id = pd.contractor_user_id
  order by p.opened_at desc;
end;
$$;

comment on function app_open_log(date, date) is
  'Every app-active paired with the app-background or app-terminate that closed it. A trailing unmatched open is returned with a null close and still_open true, never dropped.';

revoke execute on function app_presence()             from public, anon;
revoke execute on function app_open_log(date, date)   from public, anon;
grant  execute on function app_presence()             to authenticated;
grant  execute on function app_open_log(date, date)   to authenticated;
