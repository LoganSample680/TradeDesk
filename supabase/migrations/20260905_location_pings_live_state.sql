-- ── The live crew map needs the ping to say more than where ─────────────────
--
-- Owner 2026-09-05, on the Dispatch map: "like Life360 but better." Life360
-- shows a dot at an address. The thing that makes this better is that TradeDesk
-- already knows WHY somebody is standing there: which job, how long, whether
-- they are driving and how fast, and whether the phone that is reporting is
-- about to die. All of that exists in the engine at the moment a ping is
-- written (js/geo-track.js _geoWritePing) and none of it had anywhere to go.
--
-- location_pings was (lat, lon, accuracy, job_id, ts). A row could place a pin
-- and nothing more, so the map could only ever draw a dot with an age on it.
--
-- STRICTLY ADDITIVE (CLAUDE.md 3.1). One Supabase project serves dev, UAT and
-- production, so production code is reading this table right now: nothing is
-- renamed, nothing is dropped, and every new column is nullable with no
-- default, so a row written by an older build stays exactly as valid as it was.
-- The map treats a null state as "just a position", which is what every row
-- written before today is.
alter table location_pings add column if not exists state       text;
alter table location_pings add column if not exists dest        text;
alter table location_pings add column if not exists journey_id  text;
alter table location_pings add column if not exists speed_mph   numeric;
alter table location_pings add column if not exists battery     numeric;

comment on column location_pings.state is
  'What the engine believed at ping time: site | drive | shop | place | idle. Null on rows written before 2026-09-05.';
comment on column location_pings.dest is
  'Human label for what they are on or heading to, e.g. "Kitchen repaint, Alvarez". Display only, never joined on.';
comment on column location_pings.journey_id is
  'The open drive journey this ping belongs to (js/geo-derive.js), so the map can draw one trail per leg instead of a line through the whole day.';
comment on column location_pings.speed_mph is
  'Speed at the fix, mph, only while state = drive.';
comment on column location_pings.battery is
  'Reporting phone battery, 0..1, as CoreLocation''s host reports it. A pin about to go dark is the one thing a dispatcher cannot find out any other way.';

-- The map reads "the newest ping per employee since X", and with a trail it now
-- reads a run of them per employee. The existing index is (employee_user_id,
-- ts) which serves the per-person lookup; this one serves the map's own query,
-- which starts from the contractor and walks time.
create index if not exists location_pings_contractor_ts_idx
  on location_pings(contractor_user_id, ts desc);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Postgres only streams tables that are in the supabase_realtime publication.
-- location_pings never was, so js/day-map.js could subscribe all it liked and
-- receive nothing: the map loaded once when the tab opened and then sat there.
-- This is the whole difference between the data being live and the MAP being
-- live. RLS already gates it ("Contractor reads team location"), so publishing
-- the table exposes nothing a manager could not already read.
--
-- Same idempotent, environment-tolerant shape as 20260711_realtime_publication
-- _parity.sql: a duplicate add is swallowed, and a database without the
-- publication (a bare Postgres in Migration lint) is skipped rather than failed.
do $$ begin
  begin
    execute 'alter publication supabase_realtime add table location_pings';
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table  then null;
    when others           then null;
  end;
end $$;
