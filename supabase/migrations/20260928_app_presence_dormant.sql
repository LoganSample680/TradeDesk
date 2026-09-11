-- An account nobody is using is not a crew member who went dark.
--
-- Owner 2026-09-11, on a row reading "Blake Sample, dark, 20 pings missed":
-- "That's because she's not signed in anywhere."
--
-- ROOT CAUSE: app_presence() classified every silence as a device problem.
-- Its ladder covers foreground, no-push-token, unknown-cron-down,
-- push-blocked, back-online, force-closed and dark, and an unused account
-- falls through all of them into `dark`. The push still goes out every 30
-- minutes to a device token registered long ago, nobody is signed in to
-- answer it, and pings_missed climbs forever. At four people that is one
-- confusing row; at forty it is most of the alert list.
--
-- Auth cannot answer this, which is why the signal is activity and not
-- sessions. Checked on the account above the day this was written: 3 rows in
-- auth.sessions and 3 unrevoked refresh tokens, for an account its owner says
-- is signed in nowhere. Signing out on a device does not reliably clear
-- either, so "has a session" is not "is signed in".
--
-- THE SIGNAL: the most recent sign of life of ANY kind, which is the latest
-- of (app came to the foreground, the account wrote something, the device
-- reported its status). Quiet on all three for a week is a dormant account.
-- Seven days is deliberate: it survives a holiday week off the tools without
-- flipping, and a crew member who is genuinely on the job touches at least
-- one of the three every working day.
--
-- pings_missed is left TRUTHFUL. It really is the number of nudges that went
-- unanswered, and zeroing it here would hide the fact that the push lane is
-- still firing at a device that will never reply. The new `dormant_days`
-- column is what a reader uses to decide the number is not worth showing.

drop function if exists app_presence();

create or replace function app_presence()
returns table (
  contractor_user_id uuid, business text, employee_user_id uuid, person text,
  role text, state text, state_detail text,
  last_open_at timestamptz, minutes_since_open numeric, opens_today bigint,
  last_heard_at timestamptz, minutes_since_heard numeric,
  last_ping_at timestamptz, pings_missed integer, awake_buckets bigint,
  last_terminate_at timestamptz, app_version text, battery_level numeric,
  has_push_token boolean, cron_ran_at timestamptz,
  last_alive_at timestamptz, dormant_days numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cron timestamptz;
  -- A week of total silence. Named once so the number is arguable in one place.
  c_dormant_days constant numeric := 7;
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
    select distinct on (ds.user_id) ds.user_id, ds.app_version, ds.battery_level, ds.checked_at
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
           -- Any sign of life, whichever came last. A push the device answered
           -- is deliberately NOT one of these: the whole question is what to
           -- believe when those have stopped.
           greatest(r.last_open_at, r.last_write_at, dev.checked_at) as alive_at,
           -- Negative when the device answered more recently than the last
           -- recorded tick, which is normal; clamp so it reads as zero.
           greatest(floor(extract(epoch from
             (v_cron - coalesce(r.last_ping_at, v_cron))) / 1800)::int, 0) as missed
    from v_app_presence_raw r
    join v_person_dim pd on pd.employee_user_id = r.employee_user_id
    join v_account_dim d on d.contractor_user_id = pd.contractor_user_id
    left join tok on tok.user_id = r.employee_user_id
    left join dev on dev.user_id = r.employee_user_id
  ),
  t as (
    select s.*,
           case when s.alive_at is null then null
                else round(extract(epoch from (now() - s.alive_at)) / 86400.0, 1) end as quiet_days
    from s
  )
  select t.contractor_user_id, t.business, t.employee_user_id, t.person, t.role,
         case
           when t.last_open_at is not null
                and t.last_open_at >= coalesce(t.last_bg_at, t.last_open_at)
                and now() - t.last_open_at < interval '3 minutes'      then 'foreground'
           -- Dormant outranks every silence-based state below it. Nothing the
           -- device did or did not do can be read when nobody is using the
           -- account at all.
           when t.alive_at is null
             or t.quiet_days >= c_dormant_days                          then 'dormant'
           when not t.has_token                                         then 'no-push-token'
           when v_cron is null
             or now() - v_cron > interval '45 minutes'                  then 'unknown-cron-down'
           when t.missed <= 1                                           then 'background'
           -- Awake for essentially every half hour it skipped a nudge.
           when t.missed >= 2 and t.awake >= t.missed - 1               then 'push-blocked'
           -- Writing now, but it cannot yet be shown it was here during the
           -- gap. The next nudge decides between background and push-blocked.
           when t.self_writes_40m > 0                                   then 'back-online'
           when coalesce(t.last_terminate_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
             or coalesce(t.last_relaunch_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
                                                                        then 'force-closed'
           else 'dark'
         end,
         case
           when t.alive_at is null
             then 'This account has never opened the app, written anything, or reported a device. '
                  || case when t.has_token then 'A push token is registered, so the nudge is firing at a device that will never answer.'
                          else 'Nothing was ever sent to it.' end
           when t.quiet_days >= c_dormant_days
             then 'Nothing from this account for ' || t.quiet_days || ' days: no foreground, no writes, no device report. '
                  || case when t.has_token then 'The nudge is still firing at a stale token, so pings_missed will keep climbing and means nothing.'
                          else 'No push token either.' end
           when not t.has_token
             then 'No registered device token, so no push was ever sent. Silence here means nothing.'
           when v_cron is null or now() - v_cron > interval '45 minutes'
             then 'The geo-ping cron has not run recently. Nobody was asked, so nobody failing to answer proves anything.'
           when t.missed >= 2 and t.awake >= t.missed - 1
             then 'Device was awake and writing through ' || t.awake || ' of the ' || t.missed
                  || ' half-hours it skipped a nudge. It is running and not taking silent pushes: check Background App Refresh and Low Power Mode, not the user.'
           when t.missed >= 2 and t.self_writes_40m > 0
             then 'Device went quiet after its last answered nudge and has just started writing again. Next tick confirms whether pushes are landing.'
           when coalesce(t.last_terminate_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
             then 'App reported its own termination after the last push it answered.'
           else null
         end,
         t.last_open_at,
         round(extract(epoch from (now() - t.last_open_at)) / 60, 1),
         t.opens_today,
         t.last_write_at,
         round(extract(epoch from (now() - t.last_write_at)) / 60, 1),
         t.last_ping_at,
         t.missed,
         t.awake,
         t.last_terminate_at,
         t.app_version,
         t.battery_level,
         t.has_token,
         v_cron,
         t.alive_at,
         t.quiet_days
  from t
  order by t.contractor_user_id, t.last_write_at desc nulls last;
end;
$$;

revoke all on function app_presence() from anon, authenticated;
grant execute on function app_presence() to authenticated;
