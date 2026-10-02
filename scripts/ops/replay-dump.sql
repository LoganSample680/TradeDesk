-- Replay dump: everything the server deriver reads for one person over a set
-- of Central days, as ONE json value, for scripts/ops/replay-on-time.mjs.
--
-- Read-only. Run it with the Supabase MCP execute_sql (or psql) against the
-- shared project, save the single `dump` value to a file, and hand that file
-- to the replay:
--
--   node scripts/ops/replay-on-time.mjs --dump jack.json
--
-- Edit the two values in `params` and nothing else. `days` is the list of
-- Central days to score; the evidence window for each is the deriver's own
-- (two hours before local midnight to the next midnight, derive-day.mjs).
--
-- Compact on purpose: one array per row, no repeated key names, so a week of
-- a busy phone fits in a few MB.
--   ev     [ts_ms, type, kind, lat, lon, region_id, staleMs, id, created_ms]
--          only the types derive-day.mjs reads (READ_TYPES there): the
--          diagnostic ledger (radio, heartbeat, wake-*) never reaches it.
--   pings  [ts_ms, lat, lon, accuracy, created_ms]   created_ms is null for
--          rows written before migration 20261059 gave the table a real
--          created_at (they all carry that migration's own instant); the
--          replay estimates those, and says so.
--   fences {day: geo_fences_for(cid, day)}  today's fence list, per day
--   clocks [start_time, end_time, open, personal, logged_by_uid]  the replay
--          shows a clock from its start and its end from the moment it passed
--          (td_time_entries keeps no created_at)
--   ws     geo_work_settings(cid)
with params as (
  select '987ebc83-1567-49e1-9dd3-b89b0cf9121b'::uuid as uid,
         array['2026-09-21','2026-09-22','2026-09-23','2026-09-28',
               '2026-09-29','2026-09-30','2026-10-01']::date[] as days
),
win as (
  select d,
         (d::timestamp at time zone 'America/Chicago') - interval '2 hours' as a,
         ((d + 1)::timestamp at time zone 'America/Chicago') as z
    from params, unnest(params.days) d
),
-- The contractor whose fences, clocks and settings apply: the account the
-- person's automatic rows are written under (themselves, for an owner).
who as (
  select p.uid,
         coalesce((select j.contractor_user_id from job_time_entries j
                    where j.employee_user_id = p.uid
                    order by j.arrived_at desc limit 1), p.uid) as cid
    from params p
),
ev as (
  select distinct on (e.id) e.*
    from geo_events e, who, win
   where e.employee_user_id = who.uid
     and e.ts >= win.a and e.ts < win.z
     and e.type = any(array['motion','regionEnter','regionExit','visit','push-ping',
       'clock-in','clock-out','app-active','app-background','app-terminate',
       'app-relaunch','fix'])
),
pg as (
  select distinct on (l.id) l.*
    from location_pings l, who, win
   where l.employee_user_id = who.uid
     and l.ts >= win.a and l.ts < win.z
)
select json_build_object(
  'v', 1,
  'uid', (select uid from who),
  'cid', (select cid from who),
  'days', (select json_agg(d order by d) from params, unnest(params.days) d),
  'ws', (select public.geo_work_settings(cid) from who),
  'ev', (select coalesce(json_agg(json_build_array(
            floor(extract(epoch from ev.ts) * 1000)::bigint, ev.type, ev.kind,
            ev.lat, ev.lon, ev.region_id,
            case when jsonb_typeof(ev.detail::jsonb) = 'object'
                 then (ev.detail::jsonb ->> 'staleMs')::numeric end,
            ev.id, floor(extract(epoch from ev.created_at) * 1000)::bigint)
          order by ev.ts, ev.id), '[]'::json) from ev),
  'pings', (select coalesce(json_agg(json_build_array(
            floor(extract(epoch from pg.ts) * 1000)::bigint, pg.lat, pg.lon, pg.accuracy,
            case when pg.created_at > pg.ts + interval '6 hours' then null
                 else floor(extract(epoch from pg.created_at) * 1000)::bigint end)
          order by pg.ts), '[]'::json) from pg),
  'fences', (select json_object_agg(win.d, (
               select coalesce(json_agg(f), '[]'::json)
                 from who, public.geo_fences_for(who.cid, win.d) f)) from win),
  'clocks', (select coalesce(json_agg(json_build_array(
               t.data->>'start_time', t.data->>'end_time',
               coalesce((t.data->>'open')::boolean, false),
               coalesce((t.data->>'personal')::boolean, false),
               t.data->>'logged_by_uid')), '[]'::json)
               from td_time_entries t, who
              where t.user_id = who.cid and t.deleted_at is null)
) as dump;
