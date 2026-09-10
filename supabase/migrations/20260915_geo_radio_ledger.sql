-- THE RADIO LEDGER (owner 2026-09-08): "Do I have something that tells me
-- when the gps radio fires and the exact reason and time by user? If I
-- don't I need that."
--
-- He did not. Five things can turn the receiver on (the drive window, a
-- ping burst, the shift heartbeat's keepalive, the iOS 17 wake-on-move
-- stream, and the fence baseline) and exactly one of them left a row on the
-- server with a reason. The rest left counters. Finding out why his own
-- phone had burned six hours of navigation-grade GPS on a day he never
-- drove took reading fix cadences per hour and reasoning backwards.
--
-- Now every session change is a row: type 'radio', region_id = the session
-- name (so the dedupe key tells two sessions apart in the same millisecond
-- and a filter reads naturally), and `detail` carries what changed and why.
-- The plugin writes it at the line that touches CLLocationManager, because
-- that is the only place that knows the truth; JS supplies the reason,
-- because JS is the only place that knows why (CLAUDE.md 3.2).
--
--   detail: { on: bool, accuracy: text, reason: text, trigger: text,
--             source: 'native' | 'js' }
--
--   session     what                                   accuracy
--   drive       the drive window, continuous GPS       best / nearestTen
--   burst       a ping burst, seconds of Best          best
--   heartbeat   the shift keepalive session            3km
--   wake-stream the iOS 17 live-updates stream         otherNavigation
--   wake-moving the stream un-paused: the radio is     (same)
--               actually running, until iOS says still
--   fences      regions + significant change + visits  none (no receiver)
--   js-watcher  the live JS watcher (background plugin) best
--
-- Additive (CLAUDE.md 3.1): one nullable column, one partial index, one
-- function. Nothing renamed, nothing dropped, nothing production reads is
-- changed.

alter table geo_events add column if not exists detail jsonb;

create index if not exists geo_events_radio_idx
  on geo_events (employee_user_id, ts desc)
  where type = 'radio';

-- One person's radio day, paired: every ON with the OFF that ended it, or
-- open if nothing has. Pairing lives HERE and nowhere else (CLAUDE.md 7.3):
-- the app calls it over RPC under its own RLS (the person, the account
-- owner, a manager with the team permission), and the owner runs the same
-- function from the dashboard for any user id, which is how he pulls a
-- crew member on another account.
--
--   select * from geo_radio_day('30a2b589-...'::uuid, '2026-09-08');
--
-- A session opened before the day and still open into it is included; a
-- session that both opened and closed before the day is not. A repeated ON
-- with no OFF between (a re-assert) is one session, not two, so minutes
-- are never double counted. Minutes on an open session are counted to now,
-- capped at the end of the day asked for.
create or replace function geo_radio_day(p_uid uuid, p_day date)
returns table (
  session    text,
  on_at      timestamptz,
  off_at     timestamptz,
  minutes    numeric,
  accuracy   text,
  reason     text,
  off_reason text,
  trigger    text,
  source     text,
  open       boolean
)
language sql
stable
as $$
  with bounds as (
    select (p_day::timestamp at time zone 'America/Chicago')       as d0,
           ((p_day + 1)::timestamp at time zone 'America/Chicago') as d1
  ),
  r as (
    select e.ts,
           e.region_id                                        as session,
           coalesce((e.detail ->> 'on')::boolean, false)      as is_on,
           e.detail ->> 'accuracy'                            as accuracy,
           e.detail ->> 'reason'                              as reason,
           e.detail ->> 'trigger'                             as trigger,
           e.detail ->> 'source'                              as source,
           lag(coalesce((e.detail ->> 'on')::boolean, false))
             over (partition by e.region_id order by e.ts)    as prev_on
    from geo_events e, bounds b
    where e.employee_user_id = p_uid
      and e.type = 'radio'
      and e.ts >= b.d0 - interval '12 hours'
      and e.ts <  b.d1
  )
  select o.session,
         o.ts as on_at,
         f.ts as off_at,
         round(extract(epoch from (
           coalesce(f.ts, least(now(), (select d1 from bounds))) - o.ts
         )) / 60.0, 1) as minutes,
         o.accuracy,
         coalesce(o.reason, '')  as reason,
         coalesce(f.reason, '')  as off_reason,
         coalesce(o.trigger, '') as trigger,
         coalesce(o.source, '')  as source,
         (f.ts is null)          as open
  from r o
  left join lateral (
    select f.ts, f.reason
    from r f
    where f.session = o.session and not f.is_on and f.ts > o.ts
    order by f.ts
    limit 1
  ) f on true
  where o.is_on
    and coalesce(o.prev_on, false) = false
    and o.ts < (select d1 from bounds)
    and (f.ts is null or f.ts >= (select d0 from bounds))
  order by o.ts;
$$;
